/**
 * School SaaS Portal — API Key Management & Webhook Configuration
 * Combined integration management module with full CRUD, analytics, delivery tracking,
 * rate limiting, and HMAC-signed webhook dispatch.
 *
 * Tables: integration_api_keys, integration_webhooks, integration_webhook_deliveries,
 *         integration_activity_log
 */
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;

  /* ── Crypto helpers ─────────────────────────────────────────── */
  const crypto = require('crypto');
  const ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
  const encKey = Buffer.from(ENCRYPTION_KEY.slice(0,64), 'hex');
  const ALGO = 'aes-256-cbc';

  function encryptKey(plaintext) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGO, encKey, iv);
    let enc = cipher.update(plaintext, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { encrypted: enc, iv: iv.toString('hex') };
  }

  function decryptKey(encrypted, ivHex) {
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGO, encKey, iv);
    let dec = decipher.update(encrypted, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  }

  function hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  function generateApiKey() {
    return 'cz_' + crypto.randomBytes(16).toString('hex');
  }

  function generateWebhookSecret() {
    return 'whsec_' + crypto.randomBytes(24).toString('hex');
  }

  function signPayload(payload, secret) {
    const ts = Math.floor(Date.now() / 1000).toString();
    const data = ts + '.' + JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
    return { 'X-Webhook-Signature': `sha256=${sig}`, 'X-Webhook-Timestamp': ts };
  }

  function verifySignature(payload, secret, signature, timestamp) {
    const data = timestamp + '.' + payload;
    const expected = crypto.createHmac('sha256', secret).update(data).digest('hex');
    const tsAge = Math.floor(Date.now() / 1000) - parseInt(timestamp);
    if (tsAge > 300) return false; // Reject payloads older than 5 minutes
    return crypto.timingSafeEqual(Buffer.from(`sha256=${expected}`), Buffer.from(signature));
  }

  /* ── Rate limiter (in-memory, per key) ──────────────────────── */
  const rateStore = new Map();
  const RATE_LIMIT = 1000;
  const RATE_WINDOW = 60000;

  function checkRateLimit(keyHash) {
    const now = Date.now();
    const entry = rateStore.get(keyHash) || { count: 0, windowStart: now };
    if (now - entry.windowStart > RATE_WINDOW) { entry.count = 0; entry.windowStart = now; }
    entry.count++;
    rateStore.set(keyHash, entry);
    return entry.count <= RATE_LIMIT;
  }

  /* ── Event catalog ──────────────────────────────────────────── */
  const EVENT_CATALOG = [
    { name: 'payment.received', desc: 'Triggered when a payment is successfully processed', category: 'Finance' },
    { name: 'student.enrolled', desc: 'Triggered when a new student is enrolled', category: 'Students' },
    { name: 'attendance.marked', desc: 'Triggered when attendance is recorded for a class', category: 'Attendance' },
    { name: 'fee.overdue', desc: 'Triggered when a fee installment becomes overdue', category: 'Finance' },
    { name: 'exam.published', desc: 'Triggered when exam results are published', category: 'Academics' },
    { name: 'report.generated', desc: 'Triggered when a report card is generated', category: 'Academics' },
    { name: 'user.created', desc: 'Triggered when a new user account is created', category: 'Users' },
    { name: 'announcement.posted', desc: 'Triggered when a new announcement is posted', category: 'Communication' }
  ];

  const VALID_PERMISSIONS = ['read','write','admin','students','fees','attendance'];

  /* ── Database migrations ────────────────────────────────────── */
  async function migrate() {
    await pool.query(`CREATE TABLE IF NOT EXISTS integration_api_keys (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      name VARCHAR(255) NOT NULL, key_hash VARCHAR(64) NOT NULL,
      key_prefix VARCHAR(8) NOT NULL, secret_iv VARCHAR(32) NOT NULL,
      encrypted_secret TEXT NOT NULL, permissions JSONB DEFAULT '[]'::jsonb,
      is_active BOOLEAN DEFAULT true, last_used_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ, request_count INTEGER DEFAULT 0,
      created_by INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS integration_webhooks (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      name VARCHAR(255) NOT NULL, url TEXT NOT NULL,
      events TEXT[] DEFAULT '{}', secret VARCHAR(255) NOT NULL,
      is_active BOOLEAN DEFAULT true, failure_count INTEGER DEFAULT 0,
      last_delivery_at TIMESTAMPTZ, last_status_code INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS integration_webhook_deliveries (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      webhook_id INTEGER REFERENCES integration_webhooks(id),
      event_type VARCHAR(100) NOT NULL, payload JSONB,
      response_status INTEGER, response_body TEXT,
      duration_ms INTEGER, success BOOLEAN DEFAULT false,
      attempt INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS integration_activity_log (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      activity_type VARCHAR(50) NOT NULL, key_id INTEGER, webhook_id INTEGER,
      details TEXT, ip_address VARCHAR(45), created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON integration_api_keys(tenant_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON integration_api_keys(key_hash)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_webhooks_tenant ON integration_webhooks(tenant_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_webhook ON integration_webhook_deliveries(webhook_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_tenant ON integration_activity_log(tenant_id)`);
  }

  migrate().catch(e => console.error('Integration migration error:', e));

  /* ── Activity logger ────────────────────────────────────────── */
  async function logActivity(tid, type, keyId, webhookId, details, ip) {
    try {
      await pool.query(`INSERT INTO integration_activity_log (tenant_id,activity_type,key_id,webhook_id,details,ip_address) VALUES ($1,$2,$3,$4,$5,$6)`, [tid, type, keyId, webhookId, details, ip]);
    } catch(_) {}
  }

  /* ── API authentication middleware (exported for external use) ─ */
  app._authenticateApiKey = async function(apiKey) {
    const keyHash = hashKey(apiKey);
    const { rows } = await pool.query(
      'SELECT k.*, u.name as creator_name FROM integration_api_keys k LEFT JOIN users u ON u.id=k.created_by WHERE k.key_hash=$1 AND k.is_active=true', [keyHash]);
    if (!rows.length) return { error: 'Invalid or revoked API key', status: 401 };
    const key = rows[0];
    if (key.expires_at && new Date(key.expires_at) < new Date()) return { error: 'API key has expired', status: 403 };
    if (!checkRateLimit(keyHash)) return { error: `Rate limit exceeded (${RATE_LIMIT} req/min)`, status: 429 };
    await pool.query('UPDATE integration_api_keys SET request_count=request_count+1, last_used_at=NOW() WHERE id=$1', [key.id]);
    return { ok: true, key, permissions: key.permissions || [] };
  };

  /* ── UI Stylesheet ──────────────────────────────────────────── */
  const CSS = `
    <link rel="stylesheet" href="/css/sk.css">
    <style>
    .int-tabs{display:flex;gap:0;border-bottom:2px solid #e5e7eb;margin-bottom:24px}
    .int-tab{padding:10px 20px;cursor:pointer;font-weight:600;color:#6b7280;border-bottom:2px solid transparent;margin-bottom:-2px;transition:.2s;text-decoration:none}
    .int-tab:hover,.int-tab.active{color:#4f46e5;border-bottom-color:#4f46e5}
    .int-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:16px}
    .int-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;border:none;transition:.2s;text-decoration:none}
    .int-btn-primary{background:#4f46e5;color:#fff}.int-btn-primary:hover{background:#4338ca}
    .int-btn-danger{background:#ef4444;color:#fff}.int-btn-danger:hover{background:#dc2626}
    .int-btn-ghost{background:transparent;color:#4f46e5;border:1px solid #4f46e5}.int-btn-ghost:hover{background:#f5f3ff}
    .int-btn-sm{padding:5px 10px;font-size:12px}
    .int-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
    .int-badge-green{background:#dcfce7;color:#166534}.int-badge-red{background:#fee2e2;color:#991b1b}
    .int-badge-gray{background:#f3f4f6;color:#374151}.int-badge-blue{background:#dbeafe;color:#1e40af}
    .int-table{width:100%;border-collapse:collapse;font-size:14px}
    .int-table th{text-align:left;padding:10px 12px;background:#f9fafb;border-bottom:2px solid #e5e7eb;font-weight:600;color:#374151}
    .int-table td{padding:10px 12px;border-bottom:1px solid #f3f4f6}
    .int-table tr:hover td{background:#faf5ff}
    .int-toggle{position:relative;width:44px;height:24px;cursor:pointer;display:inline-block;vertical-align:middle}
    .int-toggle input{opacity:0;width:0;height:0}
    .int-toggle .slider{position:absolute;inset:0;background:#d1d5db;border-radius:24px;transition:.3s}
    .int-toggle .slider::before{content:'';position:absolute;width:18px;height:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.3s}
    .int-toggle input:checked+.slider{background:#4f46e5}
    .int-toggle input:checked+.slider::before{transform:translateX(20px)}
    .int-stat{text-align:center;padding:16px}.int-stat-val{font-size:28px;font-weight:700;color:#4f46e5}.int-stat-label{font-size:12px;color:#6b7280;margin-top:4px}
    .int-copy{cursor:pointer;padding:2px 6px;background:#f3f4f6;border-radius:4px;font-size:12px;color:#6b7280;border:none}
    .int-copy:hover{background:#e5e7eb}
    .int-input,.int-select{padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;width:100%;outline:none;transition:.2s;box-sizing:border-box}
    .int-input:focus,.int-select:focus{border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.1)}
    .int-form-group{margin-bottom:16px}.int-form-label{display:block;font-weight:500;margin-bottom:4px;font-size:14px;color:#374151}
    .int-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
    .int-chip{display:inline-block;padding:3px 8px;background:#f5f3ff;color:#6d28d9;border-radius:6px;font-size:12px;margin:2px}
    .int-event-cat{font-size:11px;font-weight:700;text-transform:uppercase;color:#9ca3af;margin:16px 0 8px}
    .int-bar{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin-top:4px}
    .int-bar-fill{height:100%;background:#4f46e5;border-radius:4px;transition:.3s}
    .int-bar-fill.warn{background:#f59e0b}.int-bar-fill.err{background:#ef4444}
    .int-activity-item{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;align-items:flex-start}
    .int-activity-time{color:#9ca3af;font-size:12px;white-space:nowrap;min-width:100px}
    .int-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1000;display:flex;align-items:center;justify-content:center}
    .int-modal{background:#fff;border-radius:12px;padding:24px;max-width:500px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.15)}
    .int-modal h3{margin:0 0 16px}.int-modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
    .int-notify{position:fixed;top:16px;right:16px;z-index:2000;padding:12px 20px;border-radius:8px;color:#fff;font-size:14px;font-weight:500;opacity:0;transition:opacity .3s;pointer-events:none}
    .int-notify.show{opacity:1}.int-notify.success{background:#22c55e}.int-notify.error{background:#ef4444}
    .int-filter{display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap}
    .int-filter select{padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px}
    .int-scroll{max-height:500px;overflow-y:auto;scrollbar-width:thin}
    .int-scroll::-webkit-scrollbar{width:6px}.int-scroll::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:3px}
    .int-summary-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px}
    .int-summary-row:last-child{border:none}
    .int-summary-label{color:#6b7280}.int-summary-val{font-weight:600;color:#374151}
    .int-empty{text-align:center;padding:40px 20px;color:#9ca3af}
    .int-empty-icon{font-size:40px;margin-bottom:8px}
    </style>`;

  function layout(activeTab, content, user) {
    const tabs = [
      { id: 'dashboard', label: 'Dashboard', href: '/school/integrations' },
      { id: 'keys', label: 'API Keys', href: '/school/integrations/keys' },
      { id: 'webhooks', label: 'Webhooks', href: '/school/integrations/webhooks' },
      { id: 'activity', label: 'Activity', href: '/school/integrations/activity' }
    ];
    const tabHtml = tabs.map(t => `<a class="int-tab ${activeTab===t.id?'active':''}" href="${t.href}">${t.label}</a>`).join('');
    return `${CSS}<div style="max-width:1100px;margin:0 auto;padding:0 16px"><h2 style="margin:0 0 20px;display:flex;align-items:center;gap:10px">
      <svg width="24" height="24" fill="none" stroke="#4f46e5" stroke-width="2" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      Integrations</h2>
      <div class="int-tabs">${tabHtml}</div>${content}</div>
    <div id="int-notify" class="int-notify"></div>
    <script>
    function notify(msg,type){var n=document.getElementById('int-notify');n.textContent=msg;n.className='int-notify '+type+' show';setTimeout(function(){n.className='int-notify'},3000)}
    function copyToClip(text){navigator.clipboard.writeText(text).then(function(){notify('Copied to clipboard!','success')})}
    </script>`;
  }

  /* ══════════════════════════════════════════════════════════════
     ROUTE 1 — Dashboard
     ══════════════════════════════════════════════════════════════ */
  app.get('/school/integrations', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [keys] = await pool.query('SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE is_active) as active, COUNT(*) FILTER(WHERE expires_at IS NOT NULL AND expires_at < NOW()) as expired FROM integration_api_keys WHERE tenant_id=$1', [tid]);
    const [hooks] = await pool.query('SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE is_active) as active, COALESCE(SUM(failure_count),0) as total_failures FROM integration_webhooks WHERE tenant_id=$1', [tid]);
    const [reqs] = await pool.query('SELECT COALESCE(SUM(request_count),0) as total FROM integration_api_keys WHERE tenant_id=$1', [tid]);
    const [dels] = await pool.query('SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE success=true) as successful, COUNT(*) FILTER(WHERE success=false AND attempt<3) as retryable, COALESCE(AVG(duration_ms),0) as avg_ms FROM integration_webhook_deliveries WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL \'7 days\'', [tid]);
    const [acts] = await pool.query('SELECT activity_type, details, created_at FROM integration_activity_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10', [tid]);
    const actRows = acts.rows.map(a => `<div class="int-activity-item"><div class="int-activity-time">${a.created_at ? new Date(a.created_at).toLocaleString():''}</div><div>${esc(a.details)}</div></div>`).join('');
    const body = `<div class="int-grid">
      <div class="int-card int-stat"><div class="int-stat-val">${keys.rows[0].total}</div><div class="int-stat-label">API Keys <span style="color:#22c55e">(${keys.rows[0].active} active)</span></div></div>
      <div class="int-card int-stat"><div class="int-stat-val">${hooks.rows[0].total}</div><div class="int-stat-label">Webhooks <span style="color:#22c55e">(${hooks.rows[0].active} active)</span></div></div>
      <div class="int-card int-stat"><div class="int-stat-val">${parseInt(reqs.rows[0].total).toLocaleString()}</div><div class="int-stat-label">Total API Requests</div></div>
      <div class="int-card int-stat"><div class="int-stat-val">${EVENT_CATALOG.length}</div><div class="int-stat-label">Event Types Available</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:0">
    <div class="int-card"><h3 style="margin:0 0 12px;font-size:15px">Delivery Stats (7 days)</h3>
      <div class="int-summary-row"><span class="int-summary-label">Total Deliveries</span><span class="int-summary-val">${dels.rows[0].total}</span></div>
      <div class="int-summary-row"><span class="int-summary-label">Successful</span><span class="int-summary-val" style="color:#22c55e">${dels.rows[0].successful}</span></div>
      <div class="int-summary-row"><span class="int-summary-label">Retryable Failures</span><span class="int-summary-val" style="color:#f59e0b">${dels.rows[0].retryable}</span></div>
      <div class="int-summary-row"><span class="int-summary-label">Avg Response Time</span><span class="int-summary-val">${Math.round(dels.rows[0].avg_ms)}ms</span></div>
      <div class="int-summary-row"><span class="int-summary-label">Total Webhook Failures</span><span class="int-summary-val" style="color:${parseInt(hooks.rows[0].total_failures)>0?'#ef4444':'#22c55e'}">${hooks.rows[0].total_failures}</span></div>
      ${parseInt(hooks.rows[0].total_failures) > 0 ? '<a href="/school/integrations/webhooks" class="int-btn int-btn-sm int-btn-danger" style="margin-top:8px">Review Failed Webhooks</a>' : ''}
    </div>
    <div class="int-card"><h3 style="margin:0 0 12px;font-size:15px">Recent Activity</h3>
      <div class="int-scroll" style="max-height:250px">${actRows || '<div class="int-empty"><div class="int-empty-icon">&#x1F4CB;</div>No recent activity</div>'}</div>
    </div>
    </div>
    <div class="int-card" style="margin-top:16px"><h3 style="margin:0 0 12px;font-size:15px">Quick Actions</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="int-btn int-btn-primary" href="/school/integrations/keys">+ New API Key</a>
        <a class="int-btn int-btn-ghost" href="/school/integrations/webhooks">+ New Webhook</a>
        <a class="int-btn int-btn-ghost" href="/school/integrations/events">Browse Events</a>
        <a class="int-btn int-btn-ghost" href="/school/integrations/activity">View All Activity</a>
      </div>
    </div>`;
    res.send(renderPage('Integrations', layout('dashboard', body, req.session.user), req.session.user));
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 2 — List API Keys
     ══════════════════════════════════════════════════════════════ */
  app.get('/school/integrations/keys', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { rows } = await pool.query('SELECT id, name, key_prefix, permissions, is_active, last_used_at, expires_at, request_count, created_at FROM integration_api_keys WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    const rowsHtml = rows.length === 0 ? '<tr><td colspan="7"><div class="int-empty"><div class="int-empty-icon">&#x1F511;</div>No API keys yet. Create your first key to get started.</div></td></tr>' :
      rows.map(k => {
        const expired = k.expires_at && new Date(k.expires_at) < new Date();
        const status = !k.is_active ? '<span class="int-badge int-badge-gray">Revoked</span>' : expired ? '<span class="int-badge int-badge-red">Expired</span>' : '<span class="int-badge int-badge-green">Active</span>';
        const perms = (k.permissions||[]).map(p => `<span class="int-chip">${esc(p)}</span>`).join('');
        const expInfo = k.expires_at ? `<br><span style="font-size:11px;color:${expired?'#ef4444':'#9ca3af'}">Exp: ${new Date(k.expires_at).toLocaleDateString()}</span>` : '';
        return `<tr><td><strong>${esc(k.name)}</strong><br><code style="font-size:12px;color:#6b7280">${esc(k.key_prefix)}...</code><button class="int-copy" onclick="copyToClip('${esc(k.key_prefix)}')">Copy prefix</button>${expInfo}</td><td>${perms}</td><td>${status}</td><td>${parseInt(k.request_count).toLocaleString()}</td><td>${k.last_used_at ? new Date(k.last_used_at).toLocaleDateString():'Never'}</td>
        <td><nobr><a class="int-btn int-btn-sm int-btn-ghost" href="/school/integrations/keys/${k.id}/usage">Usage</a>
        <button class="int-btn int-btn-sm int-btn-ghost" onclick="regenKey(${k.id})">Regen</button>
        <button class="int-btn int-btn-sm int-btn-danger" onclick="revokeKey(${k.id})">Revoke</button></nobr></td></tr>`;
      }).join('');
    const body = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="margin:0">API Keys</h3>
      <a class="int-btn int-btn-primary" href="/school/integrations/keys/create">+ Create Key</a></div>
    <div class="int-card"><table class="int-table"><thead><tr><th>Key</th><th>Permissions</th><th>Status</th><th>Requests</th><th>Last Used</th><th>Actions</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
    <div id="int-modal-area"></div>
    <script>
    function revokeKey(id){if(confirm('Revoke this API key? This cannot be undone.'))fetch('/school/integrations/keys/'+id+'/revoke',{method:'POST',headers:{'Content-Type':'application/json'}}).then(function(r){return r.json()}).then(function(d){if(d.ok){notify('Key revoked','success');setTimeout(function(){location.reload()},500)}else alert(d.error)}).catch(function(e){alert(e)})}
    function regenKey(id){if(confirm('Regenerate secret? The old key will stop working immediately.'))fetch('/school/integrations/keys/'+id+'/regenerate',{method:'POST',headers:{'Content-Type':'application/json'}}).then(function(r){return r.json()}).then(function(d){if(d.key){document.getElementById('int-modal-area').innerHTML='<div class=int-modal-bg onclick=closeModal()><div class=int-modal onclick=event.stopPropagation()><h3>New API Key</h3><p style=color:#ef4444;font-weight:600>Save this key now. It cannot be shown again.</p><input class=int-input readonly value='+d.key+' id=regen-key style=margin:12px 0><div class=int-modal-actions><button class=int-btn int-btn-sm int-btn-primary onclick=copyToClip(document.getElementById(\\'regen-key\\').value)>Copy</button><button class=int-btn int-btn-sm int-btn-ghost onclick=closeModal()>Close</button></div></div></div>'}else alert(d.error)}).catch(function(e){alert(e)})}
    function closeModal(){document.getElementById('int-modal-area').innerHTML=''}
    </script>`;
    res.send(renderPage('API Keys', layout('keys', body, req.session.user), req.session.user));
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 3 — Create API Key (GET + POST)
     ══════════════════════════════════════════════════════════════ */
  app.get('/school/integrations/keys/create', requireAuth, ah(async (req, res) => {
    const permChecks = VALID_PERMISSIONS.map(p => `<label style="display:flex;align-items:center;gap:6px;font-size:14px"><input type="checkbox" name="permissions" value="${p}"> ${p}</label>`).join('');
    const body = `<div class="int-card" style="max-width:560px"><h3 style="margin:0 0 16px">Create API Key</h3>
    <form method="POST" action="/school/integrations/keys/create">
      <div class="int-form-group"><label class="int-form-label">Key Name</label><input class="int-input" name="name" required placeholder="e.g. Student Portal Integration"></div>
      <div class="int-form-group"><label class="int-form-label">Permissions</label><div style="display:flex;flex-wrap:wrap;gap:8px">${permChecks}</div><p style="font-size:12px;color:#9ca3af;margin-top:4px">Select granular permissions for this key</p></div>
      <div class="int-form-group"><label class="int-form-label">Expires In</label><select class="int-select" name="expires"><option value="30">30 Days</option><option value="90">90 Days</option><option value="365" selected>1 Year</option><option value="0">Never</option></select></div>
      <button type="submit" class="int-btn int-btn-primary">Generate Key</button>
      <a href="/school/integrations/keys" class="int-btn int-btn-ghost" style="margin-left:8px">Cancel</a>
    </form></div>`;
    res.send(renderPage('Create API Key', layout('keys', body, req.session.user), req.session.user));
  }));

  app.post('/school/integrations/keys/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), uid = req.session.user.id;
    const name = (req.body.name||'').trim();
    const permissions = Array.isArray(req.body.permissions) ? req.body.permissions : [req.body.permissions].filter(Boolean);
    const expDays = parseInt(req.body.expires) || 0;
    if (!name) return res.redirect('/school/integrations/keys/create');
    if (!permissions.length) return res.redirect('/school/integrations/keys/create');
    const fullKey = generateApiKey();
    const keyHash = hashKey(fullKey);
    const prefix = fullKey.slice(0, 8);
    const { encrypted, iv } = encryptKey(fullKey);
    const expiresAt = expDays > 0 ? new Date(Date.now() + expDays*86400000).toISOString() : null;
    const { rows } = await pool.query(`INSERT INTO integration_api_keys (tenant_id,name,key_hash,key_prefix,secret_iv,encrypted_secret,permissions,is_active,expires_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9) RETURNING id`, [tid, name, keyHash, prefix, iv, encrypted, JSON.stringify(permissions), expiresAt, uid]);
    await logActivity(tid, 'key.created', rows[0].id, null, `API key "${name}" created with permissions: ${permissions.join(', ')}`, req.ip);
    audit(req, 'integration_key_created', { keyId: rows[0].id, name, permissions });
    const body = `<div class="int-card" style="border:2px solid #4f46e5;max-width:600px"><h3 style="margin:0 0 8px">&#x2705; API Key Created</h3>
      <p style="color:#ef4444;font-weight:600;margin-bottom:12px">Copy this key now. You will not be able to see it again.</p>
      <div style="background:#f9fafb;padding:12px;border-radius:8px;font-family:monospace;font-size:13px;word-break:break-all;display:flex;align-items:center;gap:8px">
      <code id="new-key" style="flex:1">${esc(fullKey)}</code>
      <button class="int-btn int-btn-sm int-btn-primary" onclick="copyToClip(document.getElementById('new-key').textContent)">Copy</button></div>
      <div style="margin-top:12px;font-size:13px;color:#6b7280"><strong>Permissions:</strong> ${(permissions||[]).map(p=>'<span class="int-chip">'+esc(p)+'</span>').join('')}</div>
      ${expiresAt ? '<div style="margin-top:8px;font-size:13px;color:#6b7280"><strong>Expires:</strong> '+new Date(expiresAt).toLocaleDateString()+'</div>' : ''}
      <div style="margin-top:16px"><a href="/school/integrations/keys" class="int-btn int-btn-ghost">Back to Keys</a></div></div>`;
    res.send(renderPage('Key Created', layout('keys', body, req.session.user), req.session.user));
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 4 — Revoke API Key
     ══════════════════════════════════════════════════════════════ */
  app.post('/school/integrations/keys/:id/revoke', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), id = parseInt(req.params.id);
    const { rows } = await pool.query('UPDATE integration_api_keys SET is_active=false WHERE id=$1 AND tenant_id=$2 RETURNING name', [id, tid]);
    if (!rows.length) return res.json({ error: 'Key not found' });
    await logActivity(tid, 'key.revoked', id, null, `API key "${rows[0].name}" revoked`, req.ip);
    audit(req, 'integration_key_revoked', { keyId: id, name: rows[0].name });
    res.json({ ok: true });
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 5 — Regenerate API Key Secret
     ══════════════════════════════════════════════════════════════ */
  app.post('/school/integrations/keys/:id/regenerate', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), id = parseInt(req.params.id);
    const { rows } = await pool.query('SELECT name FROM integration_api_keys WHERE id=$1 AND tenant_id=$2 AND is_active=true', [id, tid]);
    if (!rows.length) return res.json({ error: 'Key not found or inactive' });
    const newKey = generateApiKey();
    const keyHash = hashKey(newKey);
    const prefix = newKey.slice(0, 8);
    const { encrypted, iv } = encryptKey(newKey);
    await pool.query('UPDATE integration_api_keys SET key_hash=$1, key_prefix=$2, secret_iv=$3, encrypted_secret=$4, request_count=0 WHERE id=$5 AND tenant_id=$6', [keyHash, prefix, iv, encrypted, id, tid]);
    await logActivity(tid, 'key.regenerated', id, null, `API key "${rows[0].name}" secret regenerated`, req.ip);
    audit(req, 'integration_key_regenerated', { keyId: id, name: rows[0].name });
    res.json({ ok: true, key: newKey });
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 6 — API Key Usage Analytics
     ══════════════════════════════════════════════════════════════ */
  app.get('/school/integrations/keys/:id/usage', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), id = parseInt(req.params.id);
    const { rows: keys } = await pool.query('SELECT name, key_prefix, permissions, request_count, is_active, expires_at, created_at, last_used_at FROM integration_api_keys WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!keys.length) return res.status(404).send('Key not found');
    const k = keys[0];
    const { rows: days } = await pool.query(`SELECT DATE(created_at) as day, COUNT(*) as cnt
      FROM integration_activity_log WHERE tenant_id=$1 AND key_id=$2 AND activity_type='api.request'
      AND created_at > NOW() - INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY day`, [tid, id]);
    const maxCnt = Math.max(...days.map(d => parseInt(d.cnt)), 1);
    const totalRecent = days.reduce((s, d) => s + parseInt(d.cnt), 0);
    const avgDaily = days.length > 0 ? Math.round(totalRecent / days.length) : 0;
    const barHtml = days.map(d => {
      const cnt = parseInt(d.cnt);
      const pct = Math.round((cnt / maxCnt) * 100);
      const barClass = cnt > 800 ? 'err' : cnt > 500 ? 'warn' : '';
      return `<div style="display:flex;align-items:center;gap:8px;font-size:13px"><span style="min-width:80px;color:#6b7280">${d.day}</span><div class="int-bar" style="flex:1"><div class="int-bar-fill ${barClass}" style="width:${pct}%"></div></div><span style="min-width:50px;text-align:right">${cnt.toLocaleString()}</span></div>`;
    }).join('');
    const perms = (k.permissions||[]).map(p => `<span class="int-chip">${esc(p)}</span>`).join('');
    const body = `<a href="/school/integrations/keys" style="color:#4f46e5;font-size:14px">&larr; Back to Keys</a>
    <div class="int-card" style="margin-top:12px"><div style="display:flex;justify-content:space-between;align-items:start"><div><h3 style="margin:0 0 4px">${esc(k.name)}</h3><code style="color:#6b7280;font-size:13px">${esc(k.key_prefix)}...</code></div>${k.is_active ? '<span class="int-badge int-badge-green">Active</span>' : '<span class="int-badge int-badge-gray">Inactive</span>'}</div>
    <div style="margin-top:12px">${perms}</div>
    <div class="int-grid" style="margin-top:16px">
      <div class="int-stat"><div class="int-stat-val">${parseInt(k.request_count).toLocaleString()}</div><div class="int-stat-label">Total Requests</div></div>
      <div class="int-stat"><div class="int-stat-val">${totalRecent.toLocaleString()}</div><div class="int-stat-label">Last 30 Days</div></div>
      <div class="int-stat"><div class="int-stat-val">${avgDaily}</div><div class="int-stat-label">Avg Daily</div></div>
      <div class="int-stat"><div class="int-stat-val" style="font-size:16px">${k.last_used_at ? new Date(k.last_used_at).toLocaleDateString():'N/A'}</div><div class="int-stat-label">Last Used</div></div>
    </div></div>
    <div class="int-card" style="margin-top:16px"><h3 style="margin:0 0 16px">Daily Requests (Last 30 Days)</h3>
    <div style="margin-bottom:8px;font-size:12px;color:#9ca3af">Rate limit: ${RATE_LIMIT} requests/minute per key</div>
    <div class="int-scroll">${barHtml || '<div class="int-empty">No activity recorded yet</div>'}</div></div>`;
    res.send(renderPage('Key Usage', layout('keys', body, req.session.user), req.session.user));
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 7 — List Webhooks
     ══════════════════════════════════════════════════════════════ */
  app.get('/school/integrations/webhooks', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { rows } = await pool.query('SELECT id, name, url, events, is_active, failure_count, last_delivery_at, last_status_code, created_at FROM integration_webhooks WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    const rowsHtml = rows.length === 0 ? '<tr><td colspan="6"><div class="int-empty"><div class="int-empty-icon">&#x1F514;</div>No webhooks configured. Create one to receive event notifications.</div></td></tr>' :
      rows.map(w => {
        const statusBadge = w.is_active ? '<span class="int-badge int-badge-green">Active</span>' : '<span class="int-badge int-badge-gray">Inactive</span>';
        const events = (w.events||[]).map(e => `<span class="int-chip">${esc(e)}</span>`).join('');
        const failStyle = w.failure_count > 5 ? 'color:#ef4444;font-weight:700' : w.failure_count > 0 ? 'color:#f59e0b' : '';
        const lastStatus = w.last_status_code ? (w.last_status_code < 300 ? '<span class="int-badge int-badge-green">'+w.last_status_code+'</span>' : '<span class="int-badge int-badge-red">'+w.last_status_code+'</span>') : '-';
        const lastDel = w.last_delivery_at ? new Date(w.last_delivery_at).toLocaleString() : 'Never';
        return `<tr><td><strong>${esc(w.name)}</strong><br><code style="font-size:11px;color:#6b7280;max-width:240px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(w.url)}">${esc(w.url)}</code></td><td>${events}</td><td>${statusBadge}</td><td style="${failStyle}">${w.failure_count}</td><td>${lastStatus}<br><span style="font-size:11px;color:#9ca3af">${lastDel}</span></td>
        <td><nobr><label class="int-toggle" title="Toggle active"><input type="checkbox" ${w.is_active?'checked':''} onchange="toggleWh(${w.id},this.checked)"><span class="slider"></span></label>
        <button class="int-btn int-btn-sm int-btn-ghost" onclick="testWh(${w.id})">Test</button>
        <a class="int-btn int-btn-sm int-btn-ghost" href="/school/integrations/webhooks/${w.id}/log">Log</a>
        <button class="int-btn int-btn-sm int-btn-danger" onclick="delWh(${w.id})">Del</button></nobr></td></tr>`;
      }).join('');
    const body = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="margin:0">Webhooks</h3>
      <a class="int-btn int-btn-primary" href="/school/integrations/webhooks/create">+ Create Webhook</a></div>
    <div class="int-card"><table class="int-table"><thead><tr><th>Webhook</th><th>Events</th><th>Status</th><th>Fails</th><th>Last Delivery</th><th>Actions</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
    <script>
    function toggleWh(id,active){fetch('/school/integrations/webhooks/'+id+'/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_active:active})}).then(function(){notify(active?'Webhook enabled':'Webhook disabled',active?'success':'error');setTimeout(function(){location.reload()},500)})}
    function testWh(id){notify('Sending test ping...','success');fetch('/school/integrations/webhooks/'+id+'/test',{method:'POST',headers:{'Content-Type':'application/json'}}).then(function(r){return r.json()}).then(function(d){notify(d.ok?'Test sent! HTTP '+d.status+' ('+d.duration+'ms)':'Error: '+d.error,d.ok?'success':'error')}).catch(function(e){notify('Network error','error')})}
    function delWh(id){if(confirm('Delete this webhook permanently?'))fetch('/school/integrations/webhooks/'+id+'/delete',{method:'POST',headers:{'Content-Type':'application/json'}}).then(function(r){return r.json()}).then(function(d){if(d.ok){notify('Webhook deleted','success');setTimeout(function(){location.reload()},500)}else alert(d.error)}).catch(function(e){alert(e)})}
    </script>`;
    res.send(renderPage('Webhooks', layout('webhooks', body, req.session.user), req.session.user));
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 8 — Create Webhook (GET + POST)
     ══════════════════════════════════════════════════════════════ */
  app.get('/school/integrations/webhooks/create', requireAuth, ah(async (req, res) => {
    const evtChecks = EVENT_CATALOG.map(e => `<label style="display:flex;align-items:center;gap:6px;font-size:14px"><input type="checkbox" name="events" value="${e.name}"> <span style="font-weight:500">${esc(e.name)}</span><span style="color:#9ca3af;font-size:12px">— ${esc(e.desc)}</span></label>`).join('');
    const body = `<div class="int-card" style="max-width:620px"><h3 style="margin:0 0 16px">Create Webhook</h3>
    <form method="POST" action="/school/integrations/webhooks/create">
      <div class="int-form-group"><label class="int-form-label">Webhook Name</label><input class="int-input" name="name" required placeholder="e.g. Payment Notifications"></div>
      <div class="int-form-group"><label class="int-form-label">Endpoint URL</label><input class="int-input" name="url" required placeholder="https://example.com/webhook" pattern="https://.+"><p style="font-size:12px;color:#9ca3af;margin-top:4px">Must be a valid HTTPS URL</p></div>
      <div class="int-form-group"><label class="int-form-label">Events to Subscribe</label><div style="display:flex;flex-direction:column;gap:6px">${evtChecks}</div></div>
      <button type="submit" class="int-btn int-btn-primary">Create Webhook</button>
      <a href="/school/integrations/webhooks" class="int-btn int-btn-ghost" style="margin-left:8px">Cancel</a>
    </form></div>`;
    res.send(renderPage('Create Webhook', layout('webhooks', body, req.session.user), req.session.user));
  }));

  app.post('/school/integrations/webhooks/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const name = (req.body.name||'').trim(), url = (req.body.url||'').trim();
    const events = Array.isArray(req.body.events) ? req.body.events : [req.body.events].filter(Boolean);
    if (!name || !url || !events.length) return res.redirect('/school/integrations/webhooks/create');
    if (!url.startsWith('https://')) return res.redirect('/school/integrations/webhooks/create');
    const secret = generateWebhookSecret();
    const { rows } = await pool.query(`INSERT INTO integration_webhooks (tenant_id,name,url,events,secret) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [tid, name, url, events, secret]);
    await logActivity(tid, 'webhook.created', null, rows[0].id, `Webhook "${name}" created for events: ${events.join(', ')}`, req.ip);
    audit(req, 'webhook_created', { webhookId: rows[0].id, name, events, url });
    const body = `<div class="int-card" style="border:2px solid #4f46e5;max-width:600px"><h3 style="margin:0 0 8px">&#x2705; Webhook Created</h3>
      <p style="margin-bottom:12px">Use this signing secret to verify webhook payloads:</p>
      <div style="background:#f9fafb;padding:12px;border-radius:8px;font-family:monospace;font-size:13px;display:flex;align-items:center;gap:8px">
      <code id="wh-secret" style="flex:1;word-break:break-all">${esc(secret)}</code>
      <button class="int-btn int-btn-sm int-btn-primary" onclick="copyToClip(document.getElementById('wh-secret').textContent)">Copy</button></div>
      <div style="margin-top:12px"><strong>Endpoint:</strong> <code style="font-size:13px">${esc(url)}</code></div>
      <div style="margin-top:8px"><strong>Events:</strong> ${events.map(e=>'<span class="int-chip">'+esc(e)+'</span>').join('')}</div>
      <div style="margin-top:16px"><a href="/school/integrations/webhooks" class="int-btn int-btn-ghost">Back to Webhooks</a></div></div>`;
    res.send(renderPage('Webhook Created', layout('webhooks', body, req.session.user), req.session.user));
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 9 — Edit Webhook (POST, JSON body for partial updates)
     ══════════════════════════════════════════════════════════════ */
  app.post('/school/integrations/webhooks/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), id = parseInt(req.params.id);
    const updates = []; const vals = []; let idx = 1;
    if (req.body.name !== undefined) { updates.push(`name=$${idx++}`); vals.push((req.body.name||'').trim()); }
    if (req.body.url !== undefined) { updates.push(`url=$${idx++}`); vals.push((req.body.url||'').trim()); }
    if (req.body.events !== undefined) { const ev = Array.isArray(req.body.events) ? req.body.events : JSON.parse(req.body.events||'[]'); updates.push(`events=$${idx++}`); vals.push(ev); }
    if (req.body.is_active !== undefined) { updates.push(`is_active=$${idx++}`); vals.push(req.body.is_active === true || req.body.is_active === 'true'); }
    if (req.body.secret !== undefined && req.body.secret === 'rotate') {
      const newSecret = generateWebhookSecret();
      updates.push(`secret=$${idx++}`); vals.push(newSecret);
      vals.push(newSecret); // pass back to caller
      vals.push(id, tid);
      const { rows } = await pool.query(`UPDATE integration_webhooks SET ${updates.join(',')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING id`, vals);
      if (!rows.length) return res.json({ error: 'Webhook not found' });
      await logActivity(tid, 'webhook.secret_rotated', null, id, 'Webhook secret rotated', req.ip);
      return res.json({ ok: true, new_secret: newSecret });
    }
    if (!updates.length) return res.json({ error: 'No fields to update' });
    vals.push(id, tid);
    const { rows } = await pool.query(`UPDATE integration_webhooks SET ${updates.join(',')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING id`, vals);
    if (!rows.length) return res.json({ error: 'Webhook not found' });
    await logActivity(tid, 'webhook.updated', null, id, 'Webhook configuration updated', req.ip);
    res.json({ ok: true });
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 10 — Delete Webhook
     ══════════════════════════════════════════════════════════════ */
  app.post('/school/integrations/webhooks/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), id = parseInt(req.params.id);
    const { rows } = await pool.query('DELETE FROM integration_webhooks WHERE id=$1 AND tenant_id=$2 RETURNING name', [id, tid]);
    if (!rows.length) return res.json({ error: 'Webhook not found' });
    await logActivity(tid, 'webhook.deleted', null, id, `Webhook "${rows[0].name}" deleted`, req.ip);
    audit(req, 'webhook_deleted', { webhookId: id, name: rows[0].name });
    res.json({ ok: true });
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 11 — Test Webhook (send test.ping)
     ══════════════════════════════════════════════════════════════ */
  app.post('/school/integrations/webhooks/:id/test', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), id = parseInt(req.params.id);
    const { rows } = await pool.query('SELECT url, secret, name FROM integration_webhooks WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!rows.length) return res.json({ error: 'Webhook not found' });
    const wh = rows[0];
    const payload = { event: 'test.ping', tenant_id: tid, webhook_name: wh.name, timestamp: new Date().toISOString(), message: 'Webhook test from School SaaS Portal' };
    const headers = { 'Content-Type': 'application/json', ...signPayload(payload, wh.secret), 'X-Webhook-Event': 'test.ping' };
    const start = Date.now();
    try {
      const resp = await fetch(wh.url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
      const duration = Date.now() - start;
      const respBody = await resp.text();
      await pool.query(`INSERT INTO integration_webhook_deliveries (tenant_id,webhook_id,event_type,payload,response_status,response_body,duration_ms,success) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [tid, id, 'test.ping', JSON.stringify(payload), resp.status, respBody, duration, resp.status < 400]);
      await pool.query('UPDATE integration_webhooks SET last_delivery_at=NOW(), last_status_code=$1 WHERE id=$2', [resp.status, id]);
      await logActivity(tid, 'webhook.test', null, id, `Test ping to "${wh.name}": HTTP ${resp.status} (${duration}ms)`, req.ip);
      res.json({ ok: true, status: resp.status, duration });
    } catch (e) {
      const duration = Date.now() - start;
      await pool.query(`INSERT INTO integration_webhook_deliveries (tenant_id,webhook_id,event_type,payload,response_status,response_body,duration_ms,success) VALUES ($1,$2,$3,$4,0,$5,$6,false)`, [tid, id, 'test.ping', JSON.stringify(payload), e.message, duration]);
      await logActivity(tid, 'webhook.test_failed', null, id, `Test ping failed: ${e.message}`, req.ip);
      res.json({ ok: false, error: e.message });
    }
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 12 — Webhook Delivery Log
     ══════════════════════════════════════════════════════════════ */
  app.get('/school/integrations/webhooks/:id/log', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), id = parseInt(req.params.id);
    const { rows: wh } = await pool.query('SELECT name, url FROM integration_webhooks WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!wh.length) return res.status(404).send('Webhook not found');
    const [stats] = await pool.query('SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE success=true) as ok, COALESCE(AVG(duration_ms),0) as avg_ms FROM integration_webhook_deliveries WHERE tenant_id=$1 AND webhook_id=$2', [tid, id]);
    const { rows: logs } = await pool.query('SELECT id, event_type, response_status, duration_ms, success, attempt, created_at FROM integration_webhook_deliveries WHERE tenant_id=$1 AND webhook_id=$2 ORDER BY created_at DESC LIMIT 100', [tid, id]);
    const s = stats.rows[0];
    const logsHtml = logs.length === 0 ? '<div class="int-empty"><div class="int-empty-icon">&#x1F4E6;</div>No deliveries recorded. Send a test ping to get started.</div>' :
      logs.map(l => {
        const httpBadge = !l.response_status ? '<span class="int-badge int-badge-gray">N/A</span>' : l.response_status < 300 ? '<span class="int-badge int-badge-green">'+l.response_status+'</span>' : '<span class="int-badge int-badge-red">'+l.response_status+'</span>';
        return `<tr><td>${esc(l.event_type)}</td><td>${l.success ? '<span class="int-badge int-badge-green">Success</span>' : '<span class="int-badge int-badge-red">Failed</span>'}</td>
        <td>${httpBadge}</td><td>${l.duration_ms}ms</td><td>${l.attempt || 1}/3</td><td>${new Date(l.created_at).toLocaleString()}</td>
        ${!l.success && l.attempt < 3 ? `<td><button class="int-btn int-btn-sm int-btn-ghost" onclick="retryDl(${l.id},${id})">Retry</button></td>` : '<td>-</td>'}</tr>`;
      }).join('');
    const body = `<a href="/school/integrations/webhooks" style="color:#4f46e5;font-size:14px">&larr; Back to Webhooks</a>
    <div class="int-card" style="margin-top:12px"><h3 style="margin:0 0 4px">Delivery Log — ${esc(wh[0].name)}</h3><code style="font-size:12px;color:#6b7280">${esc(wh[0].url)}</code>
    <div class="int-grid" style="margin-top:12px">
      <div class="int-stat"><div class="int-stat-val">${parseInt(s.total).toLocaleString()}</div><div class="int-stat-label">Total Deliveries</div></div>
      <div class="int-stat"><div class="int-stat-val" style="color:#22c55e">${parseInt(s.ok).toLocaleString()}</div><div class="int-stat-label">Successful</div></div>
      <div class="int-stat"><div class="int-stat-val">${Math.round(s.avg_ms)}ms</div><div class="int-stat-label">Avg Response</div></div>
    </div></div>
    <div class="int-card" style="margin-top:16px"><div class="int-scroll"><table class="int-table"><thead><tr><th>Event</th><th>Status</th><th>HTTP</th><th>Duration</th><th>Attempt</th><th>Time</th><th>Retry</th></tr></thead><tbody>${logsHtml}</tbody></table></div></div>
    <script>function retryDl(deliveryId,whId){notify('Retrying delivery...','success');fetch('/school/integrations/webhooks/'+whId+'/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delivery_id:deliveryId})}).then(function(r){return r.json()}).then(function(d){if(d.ok){notify('Retry sent! HTTP '+d.status,'success');setTimeout(function(){location.reload()},800)}else notify(d.error,'error')})}</script>`;
    res.send(renderPage('Webhook Log', layout('webhooks', body, req.session.user), req.session.user));
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 13 — Retry Failed Delivery
     ══════════════════════════════════════════════════════════════ */
  app.post('/school/integrations/webhooks/:id/retry', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), id = parseInt(req.params.id);
    const deliveryId = parseInt(req.body.delivery_id);
    if (!deliveryId) return res.json({ error: 'delivery_id required' });
    const { rows: deliveries } = await pool.query('SELECT event_type, payload, attempt FROM integration_webhook_deliveries WHERE id=$1 AND tenant_id=$2 AND success=false', [deliveryId, tid]);
    if (!deliveries.length) return res.json({ error: 'Delivery not found or already succeeded' });
    const { rows: whs } = await pool.query('SELECT url, secret FROM integration_webhooks WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!whs.length) return res.json({ error: 'Webhook not found' });
    const wh = whs[0], dl = deliveries[0];
    const payload = typeof dl.payload === 'string' ? JSON.parse(dl.payload) : dl.payload;
    const headers = { 'Content-Type': 'application/json', ...signPayload(payload, wh.secret), 'X-Webhook-Event': dl.event_type };
    const newAttempt = (dl.attempt || 1) + 1;
    if (newAttempt > 3) return res.json({ error: 'Max retry attempts (3) exceeded' });
    const backoff = Math.min(Math.pow(2, newAttempt - 1) * 1000, 5000); // exponential backoff
    const start = Date.now();
    try {
      const resp = await fetch(wh.url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
      const duration = Date.now() - start;
      const respBody = await resp.text();
      await pool.query(`INSERT INTO integration_webhook_deliveries (tenant_id,webhook_id,event_type,payload,response_status,response_body,duration_ms,success,attempt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [tid, id, dl.event_type, JSON.stringify(payload), resp.status, respBody, duration, resp.status < 400, newAttempt]);
      await pool.query('UPDATE integration_webhooks SET last_delivery_at=NOW(), last_status_code=$1, failure_count=CASE WHEN $2 THEN 0 ELSE failure_count+1 END WHERE id=$3', [resp.status, resp.status < 400, id]);
      await logActivity(tid, 'webhook.retry', null, id, `Retry #${newAttempt} for ${dl.event_type}: HTTP ${resp.status} (${duration}ms, backoff ${backoff}ms)`, req.ip);
      res.json({ ok: true, status: resp.status, attempt: newAttempt, duration });
    } catch (e) {
      const duration = Date.now() - start;
      await pool.query(`INSERT INTO integration_webhook_deliveries (tenant_id,webhook_id,event_type,payload,response_status,response_body,duration_ms,success,attempt) VALUES ($1,$2,$3,$4,0,$5,$6,false,$7)`, [tid, id, dl.event_type, JSON.stringify(payload), e.message, duration, newAttempt]);
      res.json({ ok: false, error: e.message, attempt: newAttempt });
    }
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 14 — Event Types Catalog
     ══════════════════════════════════════════════════════════════ */
  app.get('/school/integrations/events', requireAuth, ah(async (req, res) => {
    const byCategory = {};
    EVENT_CATALOG.forEach(e => { (byCategory[e.category] = byCategory[e.category] || []).push(e); });
    const catHtml = Object.entries(byCategory).map(([cat, evts]) => `<div class="int-event-cat">${esc(cat)}</div>
      <table class="int-table" style="margin-bottom:8px"><thead><tr><th style="width:220px">Event</th><th>Description</th></tr></thead><tbody>
      ${evts.map(e => `<tr><td><code style="font-size:13px;color:#4f46e5">${esc(e.name)}</code></td><td>${esc(e.desc)}</td></tr>`).join('')}
      </tbody></table>`).join('');
    const body = `<div class="int-card"><h3 style="margin:0 0 4px">Available Event Types</h3>
      <p style="color:#6b7280;font-size:14px;margin-bottom:16px">Subscribe to these events via webhooks to receive real-time notifications.</p>
      <div style="background:#f5f3ff;border:1px solid #e0e7ff;border-radius:8px;padding:16px;margin-bottom:16px">
        <div style="font-weight:600;color:#4f46e5;margin-bottom:8px">Webhook Signature Verification</div>
        <p style="font-size:13px;color:#374151;margin:0 0 8px">Each webhook payload is signed with HMAC-SHA256. Verify signatures by computing:</p>
        <code style="font-size:12px;display:block;background:#fff;padding:8px;border-radius:4px">HMAC-SHA256( timestamp + "." + raw_body, webhook_secret )</code>
        <div style="margin-top:12px;font-size:13px"><strong>Headers sent with every delivery:</strong>
        <div style="margin-top:4px"><code style="color:#6d28d9">X-Webhook-Signature</code> — HMAC-SHA256 signature (format: sha256=...)<br>
        <code style="color:#6d28d9">X-Webhook-Event</code> — Event type identifier (e.g. payment.received)<br>
        <code style="color:#6d28d9">X-Webhook-Timestamp</code> — Unix epoch seconds of payload generation</div></div>
      </div>
      ${catHtml}</div>`;
    res.send(renderPage('Event Types', layout('dashboard', body, req.session.user), req.session.user));
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 15 — Activity Feed
     ══════════════════════════════════════════════════════════════ */
  app.get('/school/integrations/activity', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const filterType = req.query.type || '';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;
    const where = filterType ? ' AND a.activity_type LIKE $3' : '';
    const vals = [tid, limit, offset];
    if (filterType) vals.push(filterType + '%');
    const [countRes] = await pool.query(`SELECT COUNT(*) as total FROM integration_activity_log a WHERE a.tenant_id=$1${where}`, filterType ? [tid, filterType+'%'] : [tid]);
    const { rows } = await pool.query(`SELECT a.activity_type, a.details, a.ip_address, a.created_at,
      k.name as key_name, k.key_prefix, w.name as webhook_name
      FROM integration_activity_log a
      LEFT JOIN integration_api_keys k ON k.id = a.key_id
      LEFT JOIN integration_webhooks w ON w.id = a.webhook_id
      WHERE a.tenant_id=$1 ${filterType ? 'AND a.activity_type LIKE $4' : ''}
      ORDER BY a.created_at DESC LIMIT $2 OFFSET $3`, vals);
    const total = parseInt(countRes.rows[0].total);
    const totalPages = Math.ceil(total / limit);
    const typeBadge = t => {
      if (t.startsWith('key.')) return `<span class="int-badge int-badge-blue">API Key</span>`;
      if (t.startsWith('webhook.')) return '<span class="int-badge" style="background:#fef3c7;color:#92400e">Webhook</span>';
      return `<span class="int-badge int-badge-gray">${esc(t)}</span>`;
    };
    const rowsHtml = rows.length === 0 ? '<div class="int-empty"><div class="int-empty-icon">&#x1F4DC;</div>No activity recorded yet.</div>' :
      rows.map(a => `<div class="int-activity-item">
        <div class="int-activity-time">${a.created_at ? new Date(a.created_at).toLocaleString():''}</div>
        <div>${typeBadge(a.activity_type)} ${esc(a.details)}${a.ip_address ? '<span style="color:#d1d5db;margin-left:8px;font-size:11px">'+esc(a.ip_address)+'</span>' : ''}</div></div>`).join('');
    const pageLinks = [];
    if (page > 1) pageLinks.push(`<a class="int-btn int-btn-sm int-btn-ghost" href="?page=${page-1}${filterType?'&type='+filterType:''}">&larr; Previous</a>`);
    pageLinks.push(`<span style="font-size:13px;color:#6b7280">Page ${page} of ${totalPages} (${total} entries)</span>`);
    if (page < totalPages) pageLinks.push(`<a class="int-btn int-btn-sm int-btn-ghost" href="?page=${page+1}${filterType?'&type='+filterType:''}">Next &rarr;</a>`);
    const body = `<div class="int-filter">
      <h3 style="margin:0">Activity Feed</h3>
      <select onchange="location.href='/school/integrations/activity?type='+this.value">
        <option value="" ${!filterType?'selected':''}>All Types</option>
        <option value="key" ${filterType==='key'?'selected':''}>API Keys</option>
        <option value="webhook" ${filterType==='webhook'?'selected':''}>Webhooks</option>
      </select></div>
    <div class="int-card"><div class="int-scroll">${rowsHtml}</div></div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:12px">${pageLinks.join('')}</div>`;
    res.send(renderPage('Activity', layout('activity', body, req.session.user), req.session.user));
  }));

  /* ══════════════════════════════════════════════════════════════
     PUBLIC UTILITY — Dispatch Webhook Event
     Call from other modules: app._dispatchWebhook('payment.received', tenantId, payload)
     ══════════════════════════════════════════════════════════════ */
  app._dispatchWebhook = async function(eventType, tid, payload) {
    if (!tid || !eventType) return [];
    const { rows } = await pool.query('SELECT id, url, secret, events FROM integration_webhooks WHERE tenant_id=$1 AND is_active=true', [tid]);
    const results = [];
    for (const wh of rows) {
      if (!wh.events || !wh.events.includes(eventType)) continue;
      const fullPayload = { event: eventType, tenant_id: tid, timestamp: new Date().toISOString(), data: payload };
      const headers = { 'Content-Type': 'application/json', ...signPayload(fullPayload, wh.secret), 'X-Webhook-Event': eventType };
      const start = Date.now();
      try {
        const resp = await fetch(wh.url, { method: 'POST', headers, body: JSON.stringify(fullPayload), signal: AbortSignal.timeout(10000) });
        const dur = Date.now() - start;
        const respBody = await resp.text();
        await pool.query(`INSERT INTO integration_webhook_deliveries (tenant_id,webhook_id,event_type,payload,response_status,response_body,duration_ms,success) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [tid, wh.id, eventType, JSON.stringify(fullPayload), resp.status, respBody, dur, resp.status < 400]);
        await pool.query('UPDATE integration_webhooks SET last_delivery_at=NOW(), last_status_code=$1, failure_count=CASE WHEN $2 THEN 0 ELSE failure_count+1 END WHERE id=$3', [resp.status, resp.status < 400, wh.id]);
        results.push({ webhookId: wh.id, status: resp.status, duration: dur, success: resp.status < 400 });
      } catch (e) {
        const dur = Date.now() - start;
        await pool.query(`INSERT INTO integration_webhook_deliveries (tenant_id,webhook_id,event_type,payload,response_status,response_body,duration_ms,success) VALUES ($1,$2,$3,$4,0,$5,$6,false)`, [tid, wh.id, eventType, JSON.stringify(fullPayload), e.message, dur]);
        await pool.query('UPDATE integration_webhooks SET failure_count=failure_count+1 WHERE id=$1', [wh.id]);
        results.push({ webhookId: wh.id, status: 0, error: e.message, success: false });
      }
    }
    return results;
  };
};
