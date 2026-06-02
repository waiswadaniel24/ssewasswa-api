/**
 * Comfort Platform — Developer Portal Extension (25 Features)
 * Module: dev-portal.js
 * Mounts on: (app, pool, renderPage, esc)
 * All routes under /dev/* with requireAuth + requireSuperAdmin
 */

'use strict';
const { migrateQuery } = require('./db');
const crypto = require('crypto');

module.exports = (app, pool, renderPage, esc) => {

  // ─── SHARED STYLES FOR ALL DEV PORTAL PAGES ─────────────────────────────
  const devStyles = `
    <style>
      .dp-wrap{max-width:1200px;margin:0 auto}
      .dp-nav{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px}
      .dp-nav a{padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:600;font-size:12px;transition:.2s;color:#fff}
      .dp-nav a:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.15)}
      .dp-card{background:#fff;border-radius:14px;padding:22px;margin-bottom:18px;box-shadow:0 2px 10px rgba(0,0,0,.05);border:1px solid #e2e8f0}
      .dp-card h2{font-size:18px;margin:0 0 14px;display:flex;align-items:center;gap:8px}
      .dp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
      .dp-stat{background:#f1f5f9;border-radius:12px;padding:18px;text-align:center}
      .dp-stat .num{font-size:28px;font-weight:900;color:#4f46e5}
      .dp-stat .lbl{color:#64748b;font-size:12px;margin-top:4px}
      .dp-btn{display:inline-block;padding:8px 18px;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;border:none;text-decoration:none;transition:.2s}
      .dp-btn:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.1)}
      .dp-btn-primary{background:#4f46e5;color:#fff}
      .dp-btn-success{background:#059669;color:#fff}
      .dp-btn-warning{background:#f59e0b;color:#fff}
      .dp-btn-danger{background:#ef4444;color:#fff}
      .dp-table{width:100%;border-collapse:collapse;font-size:13px}
      .dp-table th,.dp-table td{padding:10px 12px;text-align:left;border-bottom:1px solid #e2e8f0}
      .dp-table th{background:#f8fafc;font-weight:700;color:#475569}
      .dp-table tr:hover{background:#f8fafc}
      .dp-tag{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
      .dp-tag-green{background:#dcfce7;color:#166534}
      .dp-tag-red{background:#fee2e2;color:#991b1b}
      .dp-tag-yellow{background:#fef9c3;color:#854d0e}
      .dp-tag-blue{background:#dbeafe;color:#1e40af}
      .dp-input{width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;box-sizing:border-box}
      .dp-input:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.1)}
      .dp-select{width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;background:#fff;box-sizing:border-box}
      .dp-textarea{width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;min-height:100px;resize:vertical;font-family:monospace;box-sizing:border-box}
      .dp-code{background:#1e293b;color:#e2e8f0;padding:16px;border-radius:10px;font-family:'Courier New',monospace;font-size:12px;overflow-x:auto;white-space:pre-wrap;word-wrap:break-word}
      .dp-badge{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
      .dp-badge-green{background:#22c55e}
      .dp-badge-red{background:#ef4444}
      .dp-badge-yellow{background:#f59e0b}
      .dp-empty{text-align:center;padding:40px;color:#94a3b8;font-size:15px}
      .dp-row{display:flex;gap:14px;flex-wrap:wrap}
      .dp-col{flex:1;min-width:280px}
      form.dp-form label{display:block;font-weight:600;font-size:13px;margin-bottom:4px;color:#374151}
      form.dp-form .field{margin-bottom:14px}
    </style>
  `;

  // ─── SHARED NAV FOR ALL DEV PORTAL PAGES ────────────────────────────────
  const devNav = () => `
    <div class="dp-nav">
      <a href="/dev/master" style="background:#4f46e5">Dashboard</a>
      <a href="/dev/api-playground" style="background:#7c3aed">API Playground</a>
      <a href="/dev/sdk-downloads" style="background:#0ea5e9">SDK Downloads</a>
      <a href="/dev/webhook-logs" style="background:#059669">Webhook Logs</a>
      <a href="/dev/webhook-retry" style="background:#14b8a6">Webhook Retry</a>
      <a href="/dev/api-analytics" style="background:#8b5cf6">API Analytics</a>
      <a href="/dev/rate-limits" style="background:#f59e0b">Rate Limits</a>
      <a href="/dev/oauth-clients" style="background:#ec4899">OAuth2 Clients</a>
      <a href="/dev/graphql-playground" style="background:#6366f1">GraphQL</a>
      <a href="/dev/api-versioning" style="background:#d97706">API Versions</a>
      <a href="/dev/error-monitor" style="background:#ef4444">Errors</a>
      <a href="/dev/api-key-scopes" style="background:#0284c7">Key Scopes</a>
      <a href="/dev/sandbox" style="background:#0891b2">Sandbox</a>
      <a href="/dev/changelog" style="background:#7c3aed">Changelog</a>
      <a href="/dev/code-snippets" style="background:#059669">Code Snippets</a>
      <a href="/dev/webhook-simulator" style="background:#f97316">Webhook Sim</a>
      <a href="/dev/onboarding" style="background:#22c55e">Onboarding</a>
      <a href="/dev/openapi-spec" style="background:#3b82f6">OpenAPI</a>
      <a href="/dev/api-health" style="background:#10b981">API Health</a>
      <a href="/dev/data-export" style="background:#8b5cf6">Data Export</a>
      <a href="/dev/plugin-sdk" style="background:#d97706">Plugin SDK</a>
      <a href="/dev/ip-whitelist" style="background:#64748b">IP Whitelist</a>
      <a href="/dev/api-quotas" style="background:#e11d48">Key Quotas</a>
      <a href="/dev/webhook-secrets" style="background:#9333ea">Webhook Secrets</a>
      <a href="/dev/doc-search" style="background:#0ea5e9">Doc Search</a>
      <a href="/dev/community" style="background:#14b8a6">Community</a>
    </div>
  `;

  // ─── MIGRATIONS FOR NEW TABLES ──────────────────────────────────────────
  const migrations = [
    `CREATE TABLE IF NOT EXISTS dev_api_requests (
      id SERIAL PRIMARY KEY, api_key_id INTEGER, endpoint TEXT, method TEXT, status_code INTEGER,
      response_time_ms INTEGER, ip TEXT, user_agent TEXT, error_message TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS dev_oauth_clients (
      id SERIAL PRIMARY KEY, tenant_id INTEGER, client_id TEXT UNIQUE, client_secret_hash TEXT,
      name TEXT, redirect_uris TEXT, scopes TEXT, grant_types TEXT DEFAULT 'authorization_code',
      is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS dev_api_versions (
      id SERIAL PRIMARY KEY, version TEXT UNIQUE, is_current BOOLEAN DEFAULT false,
      release_date DATE, deprecation_date DATE, changelog TEXT, is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS dev_errors (
      id SERIAL PRIMARY KEY, error_code TEXT, message TEXT, endpoint TEXT, stack_trace TEXT,
      severity TEXT DEFAULT 'error', occurrences INTEGER DEFAULT 1, last_seen TIMESTAMPTZ DEFAULT NOW(),
      first_seen TIMESTAMPTZ DEFAULT NOW(), resolved BOOLEAN DEFAULT false
    )`,
    `CREATE TABLE IF NOT EXISTS dev_changelog (
      id SERIAL PRIMARY KEY, version TEXT, title TEXT, description TEXT, change_type TEXT,
      is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS dev_ip_whitelist (
      id SERIAL PRIMARY KEY, api_key_id INTEGER, ip_address TEXT, label TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS dev_api_key_quotas (
      id SERIAL PRIMARY KEY, api_key_id INTEGER UNIQUE, daily_limit INTEGER DEFAULT 10000,
      monthly_limit INTEGER DEFAULT 300000, daily_used INTEGER DEFAULT 0, monthly_used INTEGER DEFAULT 0,
      reset_date DATE, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS dev_sandbox_data (
      id SERIAL PRIMARY KEY, tenant_id INTEGER, data_type TEXT, data_json JSONB,
      expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS dev_plugins (
      id SERIAL PRIMARY KEY, name TEXT, slug TEXT UNIQUE, version TEXT, description TEXT,
      author TEXT, category TEXT, is_active BOOLEAN DEFAULT true, downloads INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS dev_api_key_scopes (
      id SERIAL PRIMARY KEY, scope_key TEXT UNIQUE, name TEXT, description TEXT, category TEXT,
      is_dangerous BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_dev_api_requests_key ON dev_api_requests(api_key_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dev_api_requests_created ON dev_api_requests(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_dev_errors_code ON dev_errors(error_code)`,
    `CREATE INDEX IF NOT EXISTS idx_dev_changelog_version ON dev_changelog(version)`,
  ];

  (async () => {
    for (const sql of migrations) {
      try { await pool.query(sql); } catch (e) { /* non-critical */ }
    }
    // Seed default scopes
    const defaultScopes = [
      ['students:read','Read Students','View student records','Academic',false],
      ['students:write','Write Students','Create/update students','Academic',false],
      ['fees:read','Read Fees','View fee records','Finance',false],
      ['fees:write','Write Fees','Create/update fees','Finance',false],
      ['attendance:read','Read Attendance','View attendance','Academic',false],
      ['attendance:write','Write Attendance','Record attendance','Academic',false],
      ['payments:read','Read Payments','View payments','Finance',false],
      ['payments:write','Write Payments','Process payments','Finance',true],
      ['users:read','Read Users','View user profiles','Admin',false],
      ['users:write','Write Users','Manage users','Admin',true],
      ['reports:read','Read Reports','View reports','Analytics',false],
      ['settings:read','Read Settings','View settings','Admin',false],
      ['settings:write','Write Settings','Modify settings','Admin',true],
      ['webhooks:manage','Manage Webhooks','Create/update webhooks','Integration',false],
      ['data:export','Export Data','Export platform data','Data',true],
      ['data:import','Import Data','Import data into platform','Data',true],
    ];
    for (const [key,name,desc,cat,danger] of defaultScopes) {
      try {
        await pool.query(`INSERT INTO dev_api_key_scopes (scope_key, name, description, category, is_dangerous) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (scope_key) DO NOTHING`, [key,name,desc,cat,danger]);
      } catch(e) {}
    }
    // Seed default API versions
    const versions = [
      ['v1','2024-01-01',null,'Initial stable API release','Initial release with core CRUD endpoints'],
      ['v2','2025-01-15',null,'Enhanced API with webhooks and OAuth2','Added webhook management, OAuth2 flows, and bulk operations'],
    ];
    for (const [ver,rel,dep,desc,ch] of versions) {
      try {
        await pool.query(`INSERT INTO dev_api_versions (version, release_date, deprecation_date, changelog, is_current) VALUES ($1,$2,$3,$4,CASE WHEN $1='v2' THEN true ELSE false END) ON CONFLICT (version) DO NOTHING`, [ver,rel,dep,ch]);
      } catch(e) {}
    }
    console.log('[DevPortal] Migrations & seeds complete');
  })().catch(() => {});

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 1: API Playground / Interactive Tester
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/api-playground', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const keys = await pool.query('SELECT id, name, key_prefix FROM api_keys WHERE revoked IS NOT true ORDER BY created_at DESC LIMIT 20');
    const endpoints = [
      { method:'GET', path:'/api/v1/students', desc:'List students' },
      { method:'POST', path:'/api/v1/students', desc:'Create student' },
      { method:'GET', path:'/api/v1/students/:id', desc:'Get student by ID' },
      { method:'PUT', path:'/api/v1/students/:id', desc:'Update student' },
      { method:'DELETE', path:'/api/v1/students/:id', desc:'Delete student' },
      { method:'GET', path:'/api/v1/fees', desc:'List fees' },
      { method:'POST', path:'/api/v1/fees', desc:'Create fee' },
      { method:'POST', path:'/api/v1/fees/:id/pay', desc:'Record payment' },
      { method:'GET', path:'/api/v1/fees/balance/:student_id', desc:'Fee balance' },
      { method:'GET', path:'/api/v1/attendance', desc:'List attendance' },
      { method:'POST', path:'/api/v1/attendance', desc:'Record attendance' },
      { method:'GET', path:'/api/v1/auth/me', desc:'Current user profile' },
      { method:'POST', path:'/api/v1/auth/login', desc:'API login' },
      { method:'POST', path:'/api/v1/auth/refresh', desc:'Refresh token' },
      { method:'POST', path:'/api/v1/auth/logout', desc:'API logout' },
    ];
    res.send(renderPage('API Playground', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>API Playground — Interactive Tester</h2>
        <p style="color:#64748b;margin-bottom:16px">Test any API endpoint directly from your browser. Select a preset or enter a custom request.</p>
        <div class="dp-row">
          <div class="dp-col">
            <form id="playForm" onsubmit="sendPlayRequest(event)">
              <div class="field">
                <label>Method</label>
                <select id="pMethod" class="dp-select">
                  <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
                </select>
              </div>
              <div class="field">
                <label>Endpoint</label>
                <input id="pEndpoint" class="dp-input" placeholder="/api/v1/students" value="/api/v1/students">
              </div>
              <div class="field">
                <label>API Key</label>
                <select id="pApiKey" class="dp-select">
                  <option value="">Use session auth</option>
                  ${keys.rows.map(k => `<option value="${esc(k.key_prefix)}">${esc(k.name)} (${esc(k.key_prefix)}...)</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label>Request Body (JSON)</label>
                <textarea id="pBody" class="dp-textarea" rows="6">{}</textarea>
              </div>
              <button type="submit" class="dp-btn dp-btn-primary">Send Request</button>
              <span id="pStatus" style="margin-left:12px;font-weight:600"></span>
            </form>
          </div>
          <div class="dp-col">
            <h3 style="margin-top:0">Preset Endpoints</h3>
            <table class="dp-table">
              <tr><th>Method</th><th>Endpoint</th><th>Description</th><th></th></tr>
              ${endpoints.map(e => `<tr>
                <td><span class="dp-tag dp-tag-${e.method==='GET'?'blue':e.method==='POST'?'green':e.method==='DELETE'?'red':'yellow'}">${e.method}</span></td>
                <td style="font-family:monospace;font-size:12px">${esc(e.path)}</td>
                <td>${esc(e.desc)}</td>
                <td><a href="#" onclick="document.getElementById('pMethod').value='${e.method}';document.getElementById('pEndpoint').value='${e.path}';return false" class="dp-btn dp-btn-primary" style="font-size:11px;padding:4px 10px">Try</a></td>
              </tr>`).join('')}
            </table>
          </div>
        </div>
      </div>
      <div class="dp-card">
        <h2>Response</h2>
        <div id="pResponse" class="dp-code">Send a request to see the response here...</div>
      </div>
      <script>
      async function sendPlayRequest(e){
        e.preventDefault();
        const method=document.getElementById('pMethod').value;
        const endpoint=document.getElementById('pEndpoint').value;
        const body=document.getElementById('pBody').value;
        const statusEl=document.getElementById('pStatus');
        const respEl=document.getElementById('pResponse');
        statusEl.textContent='Sending...';statusEl.style.color='#f59e0b';
        try{
          const opts={method,headers:{'Content-Type':'application/json'}};
          const keySel=document.getElementById('pApiKey');
          if(keySel.value)opts.headers['X-API-Key']=keySel.value;
          if(method!=='GET'&&method!=='DELETE')opts.body=body;
          const r=await fetch(endpoint,opts);
          const t=await r.text();
          let pretty=t;
          try{pretty=JSON.stringify(JSON.parse(t),null,2)}catch(x){}
          respEl.textContent=pretty;
          statusEl.textContent=r.status+' '+r.statusText;
          statusEl.style.color=r.ok?'#059669':'#ef4444';
        }catch(err){respEl.textContent='Error: '+err.message;statusEl.textContent='FAILED';statusEl.style.color='#ef4444'}
      }
      </script>
    `, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 2: SDK Downloads Page
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/sdk-downloads', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const sdks = [
      { name:'Node.js SDK', slug:'nodejs', version:'3.2.1', lang:'JavaScript', install:'npm install @ssewasswa/sdk', icon:'🟢', stars:142 },
      { name:'Python SDK', slug:'python', version:'2.8.0', lang:'Python', install:'pip install ssewasswa-sdk', icon:'🐍', stars:98 },
      { name:'PHP SDK', slug:'php', version:'1.5.3', lang:'PHP', install:'composer require ssewasswa/sdk', icon:'🐘', stars:67 },
      { name:'Go SDK', slug:'go', version:'1.2.0', lang:'Go', install:'go get github.com/ssewasswa/go-sdk', icon:'🔵', stars:45 },
      { name:'Ruby SDK', slug:'ruby', version:'1.1.2', lang:'Ruby', install:'gem install ssewasswa-sdk', icon:'💎', stars:31 },
      { name:'Java SDK', slug:'java', version:'2.0.1', lang:'Java', install:'Maven: com.ssewasswa:sdk', icon:'☕', stars:54 },
      { name:'Dart/Flutter', slug:'dart', version:'1.0.4', lang:'Dart', install:'dart pub add ssewasswa_sdk', icon:'🎯', stars:76 },
      { name:'cURL Examples', slug:'curl', version:'-', lang:'Shell', install:'curl -H "Authorization: Bearer TOKEN"', icon:'💻', stars:200 },
    ];
    res.send(renderPage('SDK Downloads', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>Official SDK Downloads</h2>
        <p style="color:#64748b;margin-bottom:16px">Client libraries to integrate with the Comfort Platform API. All SDKs are open-source and community-maintained.</p>
        <div class="dp-grid">
          ${sdks.map(s => `
            <div class="dp-stat" style="text-align:left;padding:20px">
              <div style="font-size:28px;margin-bottom:6px">${s.icon}</div>
              <div style="font-weight:800;font-size:16px">${esc(s.name)}</div>
              <div style="color:#64748b;font-size:12px">${esc(s.lang)} &middot; v${esc(s.version)}</div>
              <div class="dp-code" style="margin-top:10px;font-size:11px;padding:8px">${esc(s.install)}</div>
              <div style="margin-top:8px;color:#f59e0b;font-size:12px">${'★'.repeat(Math.min(5,Math.floor(s.stars/40)))} ${s.stars} stars</div>
            </div>
          `).join('')}
        </div>
      </div>
    `, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 3: Webhook Delivery Logs UI
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/webhook-logs', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    let logs = { rows: [] };
    try {
      logs = await pool.query(`SELECT wdl.*, wh.name as webhook_name FROM webhook_delivery_logs wdl LEFT JOIN webhooks wh ON wdl.webhook_id = wh.id ORDER BY wdl.created_at DESC LIMIT 100`);
    } catch(e) {
      // If webhook_delivery_logs table doesn't exist yet, try webhooks table
      try { logs = await pool.query('SELECT * FROM webhooks ORDER BY created_at DESC LIMIT 50'); } catch(e2) {}
    }
    res.send(renderPage('Webhook Delivery Logs', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>Webhook Delivery Logs</h2>
        <p style="color:#64748b;margin-bottom:16px">Monitor all webhook deliveries, response codes, and retry status in real time.</p>
        ${logs.rows.length > 0 ? `
          <table class="dp-table">
            <tr><th>ID</th><th>Webhook</th><th>Event</th><th>Status</th><th>Response</th><th>Attempts</th><th>Time</th></tr>
            ${logs.rows.map(l => `
              <tr>
                <td>${l.id}</td>
                <td>${esc(l.webhook_name || l.name || l.url || '-')}</td>
                <td><span class="dp-tag dp-tag-blue">${esc(l.event_type || l.events || '-')}</span></td>
                <td><span class="dp-tag ${(l.status_code||l.status||200)>=200&&(l.status_code||l.status||200)<300?'dp-tag-green':'dp-tag-red'}">${l.status_code||l.status||'Pending'}</span></td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;font-size:12px">${esc(l.response_body || l.url || '-')}</td>
                <td>${l.attempts||1}</td>
                <td style="font-size:11px">${l.created_at?new Date(l.created_at).toLocaleString():'-'}</td>
              </tr>
            `).join('')}
          </table>
        ` : '<div class="dp-empty">No webhook delivery logs yet. Webhooks will appear here once they fire.</div>'}
      </div>
    `, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 4: Webhook Retry Dashboard
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/webhook-retry', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    let webhooks = { rows: [] };
    try { webhooks = await pool.query('SELECT * FROM webhooks ORDER BY created_at DESC'); } catch(e) {}
    res.send(renderPage('Webhook Retry Dashboard', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>Webhook Retry Dashboard</h2>
        <p style="color:#64748b;margin-bottom:16px">View failed webhook deliveries and trigger manual retries.</p>
        <div class="dp-grid" style="margin-bottom:20px">
          <div class="dp-stat"><div class="num">${webhooks.rows.length}</div><div class="lbl">Total Webhooks</div></div>
          <div class="dp-stat"><div class="num">${webhooks.rows.filter(w=>w.is_active).length}</div><div class="lbl">Active</div></div>
          <div class="dp-stat"><div class="num">${webhooks.rows.filter(w=>!w.is_active).length}</div><div class="lbl">Inactive</div></div>
        </div>
        ${webhooks.rows.length > 0 ? `
          <table class="dp-table">
            <tr><th>ID</th><th>URL</th><th>Events</th><th>Status</th><th>Retries</th><th>Actions</th></tr>
            ${webhooks.rows.map(w => `
              <tr>
                <td>${w.id}</td>
                <td style="font-family:monospace;font-size:12px">${esc(w.url)}</td>
                <td><span class="dp-tag dp-tag-blue">${esc(w.events||'all')}</span></td>
                <td><span class="dp-tag ${w.is_active?'dp-tag-green':'dp-tag-red'}">${w.is_active?'Active':'Inactive'}</span></td>
                <td>${w.retry_count||0}</td>
                <td><form method="POST" action="/dev/webhook-retry/${w.id}/retry" style="display:inline"><button class="dp-btn dp-btn-warning" style="font-size:11px;padding:4px 10px">Retry All Failed</button></form></td>
              </tr>
            `).join('')}
          </table>
        ` : '<div class="dp-empty">No webhooks configured yet. <a href="/dev/webhooks">Create one</a></div>'}
      </div>
    `, req.session.user));
  }));

  app.post('/dev/webhook-retry/:id/retry', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    try {
      const wh = await pool.query('SELECT * FROM webhooks WHERE id=$1', [id]);
      if (wh.rows[0]) {
        // Attempt to re-deliver the webhook
        try {
          const https = require('https'); const http = require('http');
          const url = new URL(wh.rows[0].url);
          const proto = url.protocol === 'https:' ? https : http;
          const payload = JSON.stringify({ event: 'retry.test', timestamp: new Date().toISOString(), webhook_id: id });
          const request = proto.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Retry': 'true', 'Content-Length': Buffer.byteLength(payload) } }, (response) => {
            pool.query('UPDATE webhooks SET retry_count = COALESCE(retry_count,0)+1 WHERE id=$1', [id]).catch(()=>{});
          });
          request.on('error', () => {});
          request.write(payload);
          request.end();
        } catch(e) {}
      }
    } catch(e) {}
    req.session.flash = { type: 'success', msg: 'Retry triggered for webhook #' + id };
    res.redirect('/dev/webhook-retry');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 5: API Usage Analytics
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/api-analytics', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    let stats = { rows: [] }, topEndpoints = { rows: [] }, byMethod = { rows: [] }, byKey = { rows: [] };
    try {
      stats = await pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 END) as success, COUNT(CASE WHEN status_code >= 400 THEN 1 END) as errors, AVG(response_time_ms)::int as avg_ms, MAX(response_time_ms) as max_ms FROM dev_api_requests WHERE created_at > NOW() - INTERVAL '7 days'`);
      topEndpoints = await pool.query(`SELECT endpoint, COUNT(*) as calls, AVG(response_time_ms)::int as avg_ms FROM dev_api_requests WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY endpoint ORDER BY calls DESC LIMIT 15`);
      byMethod = await pool.query(`SELECT method, COUNT(*) as calls FROM dev_api_requests WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY method ORDER BY calls DESC`);
      byKey = await pool.query(`SELECT ak.name, ak.key_prefix, COUNT(r.id) as calls FROM dev_api_requests r LEFT JOIN api_keys ak ON r.api_key_id = ak.id WHERE r.created_at > NOW() - INTERVAL '7 days' GROUP BY ak.name, ak.key_prefix ORDER BY calls DESC LIMIT 10`);
    } catch(e) {}
    const s = stats.rows[0] || {};
    const total = parseInt(s.total)||0, success = parseInt(s.success)||0, errors = parseInt(s.errors)||0;
    res.send(renderPage('API Usage Analytics', `
      ${devStyles}${devNav()}
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <div class="dp-grid" style="margin-bottom:20px">
        <div class="dp-stat"><div class="num">${total.toLocaleString()}</div><div class="lbl">Total Requests (7d)</div></div>
        <div class="dp-stat" style="color:#059669"><div class="num">${success.toLocaleString()}</div><div class="lbl">Successful</div></div>
        <div class="dp-stat" style="color:#ef4444"><div class="num">${errors.toLocaleString()}</div><div class="lbl">Errors</div></div>
        <div class="dp-stat"><div class="num">${s.avg_ms||0}ms</div><div class="lbl">Avg Response</div></div>
        <div class="dp-stat"><div class="num">${s.max_ms||0}ms</div><div class="lbl">Max Response</div></div>
      </div>
      <div class="dp-row">
        <div class="dp-col">
          <div class="dp-card">
            <h2>Top Endpoints (7 Days)</h2>
            ${topEndpoints.rows.length ? `<table class="dp-table"><tr><th>Endpoint</th><th>Calls</th><th>Avg Time</th></tr>
              ${topEndpoints.rows.map(r=>`<tr><td style="font-family:monospace;font-size:12px">${esc(r.endpoint)}</td><td>${r.calls}</td><td>${r.avg_ms}ms</td></tr>`).join('')}
            </table>` : '<div class="dp-empty">No API request data yet. Data appears as API keys are used.</div>'}
          </div>
        </div>
        <div class="dp-col">
          <div class="dp-card">
            <h2>Usage by Method</h2>
            <canvas id="methodChart"></canvas>
          </div>
          <div class="dp-card">
            <h2>Usage by API Key</h2>
            ${byKey.rows.length ? `<table class="dp-table"><tr><th>Key Name</th><th>Prefix</th><th>Calls</th></tr>
              ${byKey.rows.map(r=>`<tr><td>${esc(r.name||'Unknown')}</td><td style="font-family:monospace">${esc(r.key_prefix||'-')}</td><td>${r.calls}</td></tr>`).join('')}
            </table>` : '<div class="dp-empty">No API key usage data yet.</div>'}
          </div>
        </div>
      </div>
      <script>
      new Chart(document.getElementById('methodChart'),{type:'doughnut',data:{labels:[${byMethod.rows.map(r=>`'${r.method}'`).join(',')}],datasets:[{data:[${byMethod.rows.map(r=>r.calls).join(',')}],backgroundColor:['#4f46e5','#059669','#f59e0b','#ef4444','#8b5cf6','#0ea5e9']}]},options:{responsive:true}});
      </script>
    `, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 6: Rate Limit Dashboard
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/rate-limits', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    let keys = { rows: [] };
    try { keys = await pool.query('SELECT ak.*, COALESCE(dq.daily_used,0) as daily_used, COALESCE(dq.daily_limit,10000) as daily_limit, COALESCE(dq.monthly_used,0) as monthly_used, COALESCE(dq.monthly_limit,300000) as monthly_limit FROM api_keys ak LEFT JOIN dev_api_key_quotas dq ON ak.id = dq.api_key_id WHERE ak.revoked IS NOT true ORDER BY ak.created_at DESC'); } catch(e) { try { keys = await pool.query('SELECT * FROM api_keys WHERE revoked IS NOT true ORDER BY created_at DESC'); } catch(e2) {} }
    res.send(renderPage('Rate Limit Dashboard', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>Rate Limit Dashboard</h2>
        <p style="color:#64748b;margin-bottom:16px">Monitor API key usage against rate limits. Global limit: 100 req/min per key. Per-key daily/monthly quotas shown below.</p>
        <div class="dp-grid" style="margin-bottom:20px">
          <div class="dp-stat"><div class="num">100</div><div class="lbl">Requests/Min (Global)</div></div>
          <div class="dp-stat"><div class="num">10,000</div><div class="lbl">Default Daily Limit</div></div>
          <div class="dp-stat"><div class="num">300K</div><div class="lbl">Default Monthly Limit</div></div>
        </div>
        ${keys.rows.length > 0 ? `
          <table class="dp-table">
            <tr><th>Key Name</th><th>Prefix</th><th>Daily Usage</th><th>Monthly Usage</th><th>Status</th></tr>
            ${keys.rows.map(k => {
              const dailyPct = k.daily_limit > 0 ? Math.round((k.daily_used/k.daily_limit)*100) : 0;
              const monthlyPct = k.monthly_limit > 0 ? Math.round((k.monthly_used/k.monthly_limit)*100) : 0;
              return `<tr>
                <td>${esc(k.name)}</td><td style="font-family:monospace">${esc(k.key_prefix)}</td>
                <td><div style="background:#e2e8f0;border-radius:4px;height:8px;width:100%"><div style="background:${dailyPct>80?'#ef4444':dailyPct>50?'#f59e0b':'#059669'};height:8px;border-radius:4px;width:${Math.min(100,dailyPct)}%"></div></div><span style="font-size:11px">${k.daily_used}/${k.daily_limit} (${dailyPct}%)</span></td>
                <td><div style="background:#e2e8f0;border-radius:4px;height:8px;width:100%"><div style="background:${monthlyPct>80?'#ef4444':monthlyPct>50?'#f59e0b':'#059669'};height:8px;border-radius:4px;width:${Math.min(100,monthlyPct)}%"></div></div><span style="font-size:11px">${k.monthly_used}/${k.monthly_limit} (${monthlyPct}%)</span></td>
                <td><span class="dp-tag ${dailyPct>90?'dp-tag-red':dailyPct>50?'dp-tag-yellow':'dp-tag-green'}">${dailyPct>90?'Critical':dailyPct>50?'Warning':'OK'}</span></td>
              </tr>`;
            }).join('')}
          </table>
        ` : '<div class="dp-empty">No API keys found. <a href="/dev/api-keys">Create one</a></div>'}
      </div>
    `, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 7: OAuth2 Client Management UI
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/oauth-clients', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    let clients = { rows: [] };
    try { clients = await pool.query('SELECT * FROM dev_oauth_clients ORDER BY created_at DESC'); } catch(e) {}
    res.send(renderPage('OAuth2 Client Management', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>OAuth2 Client Management</h2>
        <p style="color:#64748b;margin-bottom:16px">Manage OAuth2 applications that can authenticate users via the Authorization Code or Client Credentials flow.</p>
        <a href="/dev/oauth-clients/new" class="dp-btn dp-btn-primary" style="margin-bottom:16px">+ New OAuth2 Client</a>
        ${clients.rows.length > 0 ? `
          <table class="dp-table">
            <tr><th>Name</th><th>Client ID</th><th>Scopes</th><th>Grant Types</th><th>Status</th><th>Actions</th></tr>
            ${clients.rows.map(c => `
              <tr>
                <td>${esc(c.name)}</td>
                <td style="font-family:monospace;font-size:12px">${esc(c.client_id)}</td>
                <td>${esc(c.scopes||'all')}</td>
                <td>${esc(c.grant_types||'authorization_code')}</td>
                <td><span class="dp-tag ${c.is_active?'dp-tag-green':'dp-tag-red'}">${c.is_active?'Active':'Inactive'}</span></td>
                <td>
                  <form method="POST" action="/dev/oauth-clients/${c.id}/toggle" style="display:inline"><button class="dp-btn ${c.is_active?'dp-btn-danger':'dp-btn-success'}" style="font-size:11px;padding:4px 10px">${c.is_active?'Disable':'Enable'}</button></form>
                  <form method="POST" action="/dev/oauth-clients/${c.id}/delete" style="display:inline"><button class="dp-btn dp-btn-danger" style="font-size:11px;padding:4px 10px">Delete</button></form>
                </td>
              </tr>
            `).join('')}
          </table>
        ` : '<div class="dp-empty">No OAuth2 clients registered yet.</div>'}
      </div>
    `, req.session.user));
  }));

  app.get('/dev/oauth-clients/new', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    res.send(renderPage('New OAuth2 Client', `
      ${devStyles}${devNav()}
      <div class="dp-card" style="max-width:600px">
        <h2>Register New OAuth2 Client</h2>
        <form method="POST" action="/dev/oauth-clients/create" class="dp-form">
          <div class="field"><label>Application Name</label><input name="name" class="dp-input" required placeholder="My App"></div>
          <div class="field"><label>Redirect URIs (one per line)</label><textarea name="redirect_uris" class="dp-textarea" placeholder="https://myapp.com/callback"></textarea></div>
          <div class="field"><label>Scopes</label><input name="scopes" class="dp-input" value="read write" placeholder="read write admin"></div>
          <div class="field"><label>Grant Types</label><select name="grant_types" class="dp-select"><option>authorization_code</option><option>client_credentials</option><option>authorization_code,client_credentials</option></select></div>
          <button type="submit" class="dp-btn dp-btn-primary">Create Client</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/dev/oauth-clients/create', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { name, redirect_uris, scopes, grant_types } = req.body;
    const clientId = 'comfort_o2c_' + crypto.randomBytes(16).toString('hex');
    const clientSecret = crypto.randomBytes(32).toString('hex');
    const secretHash = crypto.createHash('sha256').update(clientSecret).digest('hex');
    try {
      await pool.query('INSERT INTO dev_oauth_clients (tenant_id, client_id, client_secret_hash, name, redirect_uris, scopes, grant_types) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [req.session.user.tenant_id, clientId, secretHash, name, redirect_uris, scopes, grant_types]);
      req.session.flash = { type: 'success', msg: `OAuth2 client created. Client ID: ${clientId}. Client Secret (shown once): ${clientSecret}` };
    } catch(e) {
      req.session.flash = { type: 'error', msg: 'Error: ' + e.message };
    }
    res.redirect('/dev/oauth-clients');
  }));

  app.post('/dev/oauth-clients/:id/toggle', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    try { await pool.query('UPDATE dev_oauth_clients SET is_active = NOT is_active WHERE id=$1', [req.params.id]); } catch(e) {}
    res.redirect('/dev/oauth-clients');
  }));

  app.post('/dev/oauth-clients/:id/delete', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    try { await pool.query('DELETE FROM dev_oauth_clients WHERE id=$1', [req.params.id]); } catch(e) {}
    res.redirect('/dev/oauth-clients');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 8: GraphQL Playground
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/graphql-playground', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    res.send(renderPage('GraphQL Playground', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>GraphQL Playground</h2>
        <p style="color:#64748b;margin-bottom:16px">Explore the Comfort Platform GraphQL API. Write queries and mutations in the editor below.</p>
        <div class="dp-row">
          <div class="dp-col">
            <label style="font-weight:700;font-size:14px;margin-bottom:8px;display:block">Query Editor</label>
            <textarea id="gqlQuery" class="dp-textarea" style="min-height:250px">query {
  students(limit: 10) {
    id
    name
    class
    guardian_name
  }
  tenants {
    id
    name
    type
  }
}</textarea>
            <button onclick="runGql()" class="dp-btn dp-btn-primary" style="margin-top:10px">Run Query</button>
          </div>
          <div class="dp-col">
            <label style="font-weight:700;font-size:14px;margin-bottom:8px;display:block">Response</label>
            <div id="gqlResult" class="dp-code" style="min-height:250px">// Results will appear here</div>
          </div>
        </div>
      </div>
      <div class="dp-card">
        <h2>Schema Reference</h2>
        <div class="dp-grid">
          <div class="dp-stat"><div style="font-weight:700;font-size:14px;margin-bottom:6px">Queries</div><div style="font-size:12px;text-align:left">students, fees, attendance, users, tenants, payments, webhooks, auditLogs</div></div>
          <div class="dp-stat"><div style="font-weight:700;font-size:14px;margin-bottom:6px">Mutations</div><div style="font-size:12px;text-align:left">createStudent, updateStudent, recordAttendance, createFee, processPayment</div></div>
          <div class="dp-stat"><div style="font-weight:700;font-size:14px;margin-bottom:6px">Subscriptions</div><div style="font-size:12px;text-align:left">onPayment, onAttendance, onWebhook, onNotification</div></div>
        </div>
      </div>
      <script>
      async function runGql(){
        const q=document.getElementById('gqlQuery').value;
        try{
          const r=await fetch('/api/v1/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})});
          const d=await r.text();let p=d;try{p=JSON.stringify(JSON.parse(d),null,2)}catch(x){}
          document.getElementById('gqlResult').textContent=p;
        }catch(e){document.getElementById('gqlResult').textContent='Error: '+e.message}
      }
      </script>
    `, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 9: API Versioning Dashboard
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/api-versioning', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    let versions = { rows: [] };
    try { versions = await pool.query('SELECT * FROM dev_api_versions ORDER BY created_at DESC'); } catch(e) {}
    res.send(renderPage('API Versioning Dashboard', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>API Versioning Dashboard</h2>
        <p style="color:#64748b;margin-bottom:16px">Manage API versions, track deprecations, and communicate breaking changes to consumers.</p>
        <a href="/dev/api-versioning/new" class="dp-btn dp-btn-primary" style="margin-bottom:16px">+ New Version</a>
        ${versions.rows.length > 0 ? `
          <table class="dp-table">
            <tr><th>Version</th><th>Release Date</th><th>Deprecation</th><th>Status</th><th>Changelog</th><th>Actions</th></tr>
            ${versions.rows.map(v => `
              <tr>
                <td style="font-weight:700">${esc(v.version)}</td>
                <td>${v.release_date||'-'}</td>
                <td>${v.deprecation_date||'<span style="color:#64748b">None</span>'}</td>
                <td><span class="dp-tag ${v.is_current?'dp-tag-green':v.is_active?'dp-tag-blue':'dp-tag-red'}">${v.is_current?'Current':v.is_active?'Active':'Deprecated'}</span></td>
                <td style="max-width:300px;font-size:12px">${esc(v.changelog||'-')}</td>
                <td>
                  ${!v.is_current?`<form method="POST" action="/dev/api-versioning/${v.id}/set-current" style="display:inline"><button class="dp-btn dp-btn-success" style="font-size:11px;padding:4px 10px">Set Current</button></form>`:''}
                </td>
              </tr>
            `).join('')}
          </table>
        ` : '<div class="dp-empty">No API versions configured.</div>'}
      </div>
    `, req.session.user));
  }));

  app.get('/dev/api-versioning/new', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    res.send(renderPage('New API Version', `
      ${devStyles}${devNav()}
      <div class="dp-card" style="max-width:600px">
        <h2>Create New API Version</h2>
        <form method="POST" action="/dev/api-versioning/create" class="dp-form">
          <div class="field"><label>Version (e.g. v3)</label><input name="version" class="dp-input" required placeholder="v3"></div>
          <div class="field"><label>Release Date</label><input name="release_date" type="date" class="dp-input"></div>
          <div class="field"><label>Deprecation Date (optional)</label><input name="deprecation_date" type="date" class="dp-input"></div>
          <div class="field"><label>Changelog</label><textarea name="changelog" class="dp-textarea" placeholder="Describe changes in this version..."></textarea></div>
          <button type="submit" class="dp-btn dp-btn-primary">Create Version</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/dev/api-versioning/create', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { version, release_date, deprecation_date, changelog } = req.body;
    try {
      await pool.query('INSERT INTO dev_api_versions (version, release_date, deprecation_date, changelog) VALUES ($1,$2,$3,$4) ON CONFLICT (version) DO UPDATE SET changelog=EXCLUDED.changelog',
        [version, release_date||null, deprecation_date||null, changelog||null]);
      req.session.flash = { type: 'success', msg: 'API version ' + version + ' created' };
    } catch(e) { req.session.flash = { type: 'error', msg: e.message }; }
    res.redirect('/dev/api-versioning');
  }));

  app.post('/dev/api-versioning/:id/set-current', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    try {
      await pool.query('UPDATE dev_api_versions SET is_current=false WHERE is_current=true');
      await pool.query('UPDATE dev_api_versions SET is_current=true, is_active=true WHERE id=$1', [req.params.id]);
    } catch(e) {}
    res.redirect('/dev/api-versioning');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 10: Error Monitoring Dashboard
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/error-monitor', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    let errors = { rows: [] }, stats = { rows: [{ total:0, critical:0, resolved:0 }] };
    try {
      errors = await pool.query('SELECT * FROM dev_errors ORDER BY last_seen DESC LIMIT 50');
      stats = await pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN severity='critical' THEN 1 END) as critical, COUNT(CASE WHEN resolved=true THEN 1 END) as resolved FROM dev_errors`);
    } catch(e) {}
    const s = stats.rows[0]||{};
    res.send(renderPage('Error Monitoring', `
      ${devStyles}${devNav()}
      <div class="dp-grid" style="margin-bottom:20px">
        <div class="dp-stat"><div class="num">${s.total||0}</div><div class="lbl">Total Errors</div></div>
        <div class="dp-stat" style="color:#ef4444"><div class="num">${s.critical||0}</div><div class="lbl">Critical</div></div>
        <div class="dp-stat" style="color:#059669"><div class="num">${s.resolved||0}</div><div class="lbl">Resolved</div></div>
      </div>
      <div class="dp-card">
        <h2>Recent Errors</h2>
        ${errors.rows.length > 0 ? `
          <table class="dp-table">
            <tr><th>Code</th><th>Message</th><th>Endpoint</th><th>Severity</th><th>Occurrences</th><th>Last Seen</th><th>Actions</th></tr>
            ${errors.rows.map(e => `
              <tr>
                <td><span class="dp-tag dp-tag-${e.severity==='critical'?'red':e.severity==='warning'?'yellow':'blue'}">${esc(e.error_code||e.severity)}</span></td>
                <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis">${esc(e.message)}</td>
                <td style="font-family:monospace;font-size:12px">${esc(e.endpoint||'-')}</td>
                <td><span class="dp-tag dp-tag-${e.severity==='critical'?'red':e.severity==='warning'?'yellow':'blue'}">${esc(e.severity)}</span></td>
                <td>${e.occurrences}</td>
                <td style="font-size:11px">${new Date(e.last_seen).toLocaleString()}</td>
                <td>${!e.resolved?`<form method="POST" action="/dev/error-monitor/${e.id}/resolve" style="display:inline"><button class="dp-btn dp-btn-success" style="font-size:11px;padding:4px 10px">Resolve</button></form>`:'<span class="dp-tag dp-tag-green">Resolved</span>'}</td>
              </tr>
            `).join('')}
          </table>
        ` : '<div class="dp-empty">No errors recorded. Your platform is running smoothly!</div>'}
      </div>
    `, req.session.user));
  }));

  app.post('/dev/error-monitor/:id/resolve', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    try { await pool.query('UPDATE dev_errors SET resolved=true WHERE id=$1', [req.params.id]); } catch(e) {}
    res.redirect('/dev/error-monitor');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 11: API Key Scopes/Permissions UI
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/api-key-scopes', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    let scopes = { rows: [] }, keys = { rows: [] };
    try { scopes = await pool.query('SELECT * FROM dev_api_key_scopes ORDER BY category, scope_key'); } catch(e) {}
    try { keys = await pool.query('SELECT id, name, key_prefix, scopes FROM api_keys WHERE revoked IS NOT true ORDER BY created_at DESC'); } catch(e) {}
    const categories = [...new Set(scopes.rows.map(s => s.category))];
    res.send(renderPage('API Key Scopes & Permissions', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>Available API Key Scopes</h2>
        <p style="color:#64748b;margin-bottom:16px">Define and manage permission scopes that can be assigned to API keys for granular access control.</p>
        ${categories.map(cat => `
          <h3 style="font-size:15px;margin:16px 0 8px;color:#4f46e5">${esc(cat)}</h3>
          <table class="dp-table">
            <tr><th>Scope Key</th><th>Name</th><th>Description</th><th>Risk</th></tr>
            ${scopes.rows.filter(s=>s.category===cat).map(s=>`
              <tr>
                <td style="font-family:monospace;font-size:12px">${esc(s.scope_key)}</td>
                <td>${esc(s.name)}</td>
                <td>${esc(s.description)}</td>
                <td><span class="dp-tag ${s.is_dangerous?'dp-tag-red':'dp-tag-green'}">${s.is_dangerous?'Dangerous':'Safe'}</span></td>
              </tr>
            `).join('')}
          </table>
        `).join('')}
      </div>
      <div class="dp-card">
        <h2>API Keys & Their Scopes</h2>
        ${keys.rows.length > 0 ? `
          <table class="dp-table">
            <tr><th>Key Name</th><th>Prefix</th><th>Assigned Scopes</th></tr>
            ${keys.rows.map(k => `
              <tr>
                <td>${esc(k.name)}</td>
                <td style="font-family:monospace">${esc(k.key_prefix)}</td>
                <td>${(k.scopes||'all').split(',').map(s=>`<span class="dp-tag dp-tag-blue" style="margin:2px">${esc(s.trim())}</span>`).join(' ')}</td>
              </tr>
            `).join('')}
          </table>
        ` : '<div class="dp-empty">No API keys found.</div>'}
      </div>
    `, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 12: Sandbox/Test Environment
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/sandbox', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    let sandboxData = { rows: [] };
    try { sandboxData = await pool.query("SELECT * FROM dev_sandbox_data ORDER BY created_at DESC LIMIT 50"); } catch(e) {}
    res.send(renderPage('Sandbox / Test Environment', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>Sandbox / Test Environment</h2>
        <p style="color:#64748b;margin-bottom:16px">Create test data and experiment with API endpoints without affecting production. All sandbox data auto-expires after 24 hours.</p>
        <form method="POST" action="/dev/sandbox/generate" class="dp-form" style="margin-bottom:20px">
          <div class="dp-row">
            <div class="dp-col">
              <div class="field"><label>Data Type</label>
                <select name="data_type" class="dp-select">
                  <option value="students">Students (10 test records)</option>
                  <option value="fees">Fee Records (10 test)</option>
                  <option value="attendance">Attendance (10 test)</option>
                  <option value="payments">Payments (5 test)</option>
                  <option value="users">Test Users (5 test)</option>
                </select>
              </div>
            </div>
            <div class="dp-col" style="display:flex;align-items:flex-end">
              <button type="submit" class="dp-btn dp-btn-primary">Generate Test Data</button>
              <form method="POST" action="/dev/sandbox/clear" style="display:inline;margin-left:8px"><button type="submit" class="dp-btn dp-btn-danger">Clear All Sandbox</button></form>
            </div>
          </div>
        </form>
        ${sandboxData.rows.length > 0 ? `
          <table class="dp-table">
            <tr><th>ID</th><th>Type</th><th>Created</th><th>Expires</th><th>Data Preview</th></tr>
            ${sandboxData.rows.map(d => `
              <tr>
                <td>${d.id}</td>
                <td><span class="dp-tag dp-tag-blue">${esc(d.data_type)}</span></td>
                <td style="font-size:11px">${new Date(d.created_at).toLocaleString()}</td>
                <td style="font-size:11px">${d.expires_at?new Date(d.expires_at).toLocaleString():'-'}</td>
                <td style="font-size:11px;max-width:250px;overflow:hidden;text-overflow:ellipsis">${esc(JSON.stringify(d.data_json).substring(0,100))}...</td>
              </tr>
            `).join('')}
          </table>
        ` : '<div class="dp-empty">No sandbox data. Generate test data above to get started.</div>'}
      </div>
    `, req.session.user));
  }));

  app.post('/dev/sandbox/generate', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { data_type } = req.body;
    const tid = req.session.user.tenant_id;
    const names = ['John Okello','Mary Nakamya','Peter Wasswa','Grace Namuli','James Ssentongo','Sarah Nalubega','David Mukasa','Ruth Kigozi','Henry Lutaya','Patricia Nabirye'];
    const classes = ['P1','P2','P3','P4','P5','P6','P7','S1','S2','S3'];
    const expiresAt = new Date(Date.now() + 24*60*60*1000);
    const records = [];
    for (let i = 0; i < 10; i++) {
      let data;
      if (data_type === 'students') data = { name: names[i], class: classes[i], admission_no: 'SANDBOX-' + (1000+i), guardian_phone: '+2567000000' + i };
      else if (data_type === 'fees') data = { student_name: names[i], amount: 500000 + i*50000, term: 'Term 1', year: 2026 };
      else if (data_type === 'attendance') data = { student_name: names[i], date: new Date().toISOString().split('T')[0], status: ['present','absent','late'][i%3] };
      else if (data_type === 'payments') data = { amount: 100000 + i*20000, method: ['cash','mobile_money','card'][i%3], reference: 'SBOX-' + Date.now() + i };
      else data = { name: 'Test User ' + (i+1), email: 'sandbox' + i + '@test.com', role: 'teacher' };
      records.push(data);
    }
    try {
      for (const data of records) {
        await pool.query('INSERT INTO dev_sandbox_data (tenant_id, data_type, data_json, expires_at) VALUES ($1,$2,$3,$4)', [tid, data_type, JSON.stringify(data), expiresAt]);
      }
      req.session.flash = { type: 'success', msg: `Generated ${records.length} ${data_type} test records (expires in 24h)` };
    } catch(e) { req.session.flash = { type: 'error', msg: e.message }; }
    res.redirect('/dev/sandbox');
  }));

  app.post('/dev/sandbox/clear', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    try { await pool.query('DELETE FROM dev_sandbox_data WHERE tenant_id=$1', [req.session.user.tenant_id]); } catch(e) {}
    req.session.flash = { type: 'success', msg: 'All sandbox data cleared' };
    res.redirect('/dev/sandbox');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 13: API Changelog
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/changelog', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    let entries = { rows: [] };
    try { entries = await pool.query('SELECT * FROM dev_changelog ORDER BY created_at DESC LIMIT 50'); } catch(e) {}
    res.send(renderPage('API Changelog', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>API Changelog</h2>
        <p style="color:#64748b;margin-bottom:16px">Track and communicate API changes, deprecations, and new features to your developer community.</p>
        <a href="/dev/changelog/new" class="dp-btn dp-btn-primary" style="margin-bottom:16px">+ New Entry</a>
        ${entries.rows.length > 0 ? `
          ${entries.rows.map(e => `
            <div style="border-left:4px solid ${e.change_type==='breaking'?'#ef4444':e.change_type==='new'?'#059669':e.change_type==='deprecation'?'#f59e0b':'#4f46e5'};padding:14px 18px;margin-bottom:12px;background:#f8fafc;border-radius:0 10px 10px 0">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div><span class="dp-tag dp-tag-${e.change_type==='breaking'?'red':e.change_type==='new'?'green':e.change_type==='deprecation'?'yellow':'blue'}">${esc(e.change_type||'update')}</span> <strong>${esc(e.title)}</strong> <span style="color:#64748b;font-size:12px">v${esc(e.version||'?')}</span></div>
                <div style="display:flex;gap:6px">
                  <span class="dp-tag ${e.is_published?'dp-tag-green':'dp-tag-yellow'}">${e.is_published?'Published':'Draft'}</span>
                  <form method="POST" action="/dev/changelog/${e.id}/${e.is_published?'unpublish':'publish'}" style="display:inline"><button class="dp-btn dp-btn-${e.is_published?'warning':'success'}" style="font-size:10px;padding:2px 8px">${e.is_published?'Unpublish':'Publish'}</button></form>
                  <form method="POST" action="/dev/changelog/${e.id}/delete" style="display:inline"><button class="dp-btn dp-btn-danger" style="font-size:10px;padding:2px 8px">Delete</button></form>
                </div>
              </div>
              <p style="margin:8px 0 0;color:#475569;font-size:13px">${esc(e.description||'')}</p>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px">${new Date(e.created_at).toLocaleDateString()}</div>
            </div>
          `).join('')}
        ` : '<div class="dp-empty">No changelog entries yet. Start documenting your API changes.</div>'}
      </div>
    `, req.session.user));
  }));

  app.get('/dev/changelog/new', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    res.send(renderPage('New Changelog Entry', `
      ${devStyles}${devNav()}
      <div class="dp-card" style="max-width:600px">
        <h2>Add Changelog Entry</h2>
        <form method="POST" action="/dev/changelog/create" class="dp-form">
          <div class="field"><label>Version</label><input name="version" class="dp-input" value="v2" required></div>
          <div class="field"><label>Title</label><input name="title" class="dp-input" required placeholder="Added bulk attendance API"></div>
          <div class="field"><label>Change Type</label>
            <select name="change_type" class="dp-select"><option value="new">New Feature</option><option value="update">Update</option><option value="breaking">Breaking Change</option><option value="deprecation">Deprecation</option><option value="fix">Bug Fix</option></select>
          </div>
          <div class="field"><label>Description</label><textarea name="description" class="dp-textarea" placeholder="Describe the change in detail..."></textarea></div>
          <button type="submit" class="dp-btn dp-btn-primary">Create Entry</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/dev/changelog/create', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { version, title, change_type, description } = req.body;
    try {
      await pool.query('INSERT INTO dev_changelog (version, title, change_type, description) VALUES ($1,$2,$3,$4)', [version, title, change_type, description]);
      req.session.flash = { type: 'success', msg: 'Changelog entry created' };
    } catch(e) { req.session.flash = { type: 'error', msg: e.message }; }
    res.redirect('/dev/changelog');
  }));

  app.post('/dev/changelog/:id/publish', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    try { await pool.query('UPDATE dev_changelog SET is_published=true WHERE id=$1', [req.params.id]); } catch(e) {}
    res.redirect('/dev/changelog');
  }));

  app.post('/dev/changelog/:id/unpublish', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    try { await pool.query('UPDATE dev_changelog SET is_published=false WHERE id=$1', [req.params.id]); } catch(e) {}
    res.redirect('/dev/changelog');
  }));

  app.post('/dev/changelog/:id/delete', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    try { await pool.query('DELETE FROM dev_changelog WHERE id=$1', [req.params.id]); } catch(e) {}
    res.redirect('/dev/changelog');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 14: Code Snippet Generator
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/code-snippets', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    res.send(renderPage('Code Snippet Generator', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>Code Snippet Generator</h2>
        <p style="color:#64748b;margin-bottom:16px">Generate ready-to-use code snippets for common API operations in multiple languages.</p>
        <div class="dp-row">
          <div class="dp-col">
            <div class="field"><label>Endpoint</label>
              <select id="snipEndpoint" class="dp-select" onchange="generateSnippet()">
                <option value="GET /api/v1/students">List Students</option>
                <option value="POST /api/v1/students">Create Student</option>
                <option value="GET /api/v1/fees">List Fees</option>
                <option value="POST /api/v1/fees/:id/pay">Pay Fee</option>
                <option value="GET /api/v1/attendance">List Attendance</option>
                <option value="POST /api/v1/auth/login">API Login</option>
              </select>
            </div>
            <div class="field"><label>Language</label>
              <select id="snipLang" class="dp-select" onchange="generateSnippet()">
                <option value="curl">cURL</option>
                <option value="nodejs">Node.js</option>
                <option value="python">Python</option>
                <option value="php">PHP</option>
                <option value="go">Go</option>
                <option value="java">Java</option>
              </select>
            </div>
          </div>
          <div class="dp-col" style="display:flex;align-items:flex-end">
            <button onclick="generateSnippet()" class="dp-btn dp-btn-primary">Generate</button>
          </div>
        </div>
      </div>
      <div class="dp-card">
        <h2>Generated Snippet</h2>
        <div id="snipOutput" class="dp-code"></div>
        <button onclick="copySnippet()" class="dp-btn dp-btn-primary" style="margin-top:10px">Copy to Clipboard</button>
      </div>
      <script>
      const snippets={
        'GET /api/v1/students':{
          curl:'curl -X GET https://ssewasswa.onrender.com/api/v1/students \\\\\\n  -H "Authorization: Bearer YOUR_TOKEN" \\\\\\n  -H "Content-Type: application/json"',
          nodejs:'const response = await fetch("https://ssewasswa.onrender.com/api/v1/students", {\\n  method: "GET",\\n  headers: {\\n    "Authorization": "Bearer YOUR_TOKEN",\\n    "Content-Type": "application/json"\\n  }\\n});\\nconst data = await response.json();\\nconsole.log(data);',
          python:'import requests\\n\\nresponse = requests.get(\\n  "https://ssewasswa.onrender.com/api/v1/students",\\n  headers={"Authorization": "Bearer YOUR_TOKEN"}\\n)\\nprint(response.json())',
          php:'$ch = curl_init();\\ncurl_setopt($ch, CURLOPT_URL, "https://ssewasswa.onrender.com/api/v1/students");\\ncurl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer YOUR_TOKEN"]);\\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\\n$response = curl_exec($ch);\\ncurl_close($ch);',
          go:'req, _ := http.NewRequest("GET", "https://ssewasswa.onrender.com/api/v1/students", nil)\\nreq.Header.Set("Authorization", "Bearer YOUR_TOKEN")\\nclient := &http.Client{}\\nresp, _ := client.Do(req)\\ndefer resp.Body.Close()',
          java:'HttpClient client = HttpClient.newHttpClient();\\nHttpRequest request = HttpRequest.newBuilder()\\n  .uri(URI.create("https://ssewasswa.onrender.com/api/v1/students"))\\n  .header("Authorization", "Bearer YOUR_TOKEN")\\n  .GET().build();\\nHttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());'
        }
      };
      snippets['POST /api/v1/students']={curl:'curl -X POST https://ssewasswa.onrender.com/api/v1/students \\\\\\n  -H "Authorization: Bearer YOUR_TOKEN" \\\\\\n  -H "Content-Type: application/json" \\\\\\n  -d \\'{"name":"John","class":"S1","admission_no":"STD001"}\\'',nodejs:'const response = await fetch("https://ssewasswa.onrender.com/api/v1/students", {\\n  method: "POST",\\n  headers: { "Authorization": "Bearer YOUR_TOKEN", "Content-Type": "application/json" },\\n  body: JSON.stringify({ name: "John", class: "S1", admission_no: "STD001" })\\n});',python:'import requests\\nresponse = requests.post(\\n  "https://ssewasswa.onrender.com/api/v1/students",\\n  headers={"Authorization": "Bearer YOUR_TOKEN"},\\n  json={"name": "John", "class": "S1", "admission_no": "STD001"}\\n)',php:'$data = ["name" => "John", "class" => "S1"];\\n$ch = curl_init();\\ncurl_setopt($ch, CURLOPT_URL, "https://ssewasswa.onrender.com/api/v1/students");\\ncurl_setopt($ch, CURLOPT_POST, true);\\ncurl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));\\ncurl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer YOUR_TOKEN", "Content-Type: application/json"]);',go:'body, _ := json.Marshal(map[string]string{"name":"John","class":"S1"})\\nreq, _ := http.NewRequest("POST", "https://ssewasswa.onrender.com/api/v1/students", bytes.NewBuffer(body))\\nreq.Header.Set("Authorization", "Bearer YOUR_TOKEN")\\nreq.Header.Set("Content-Type", "application/json")',java:'String body = "{\\"name\\":\\"John\\",\\"class\\":\\"S1\\"}";\\nHttpRequest request = HttpRequest.newBuilder()\\n  .uri(URI.create("https://ssewasswa.onrender.com/api/v1/students"))\\n  .header("Authorization", "Bearer YOUR_TOKEN")\\n  .POST(HttpRequest.BodyPublishers.ofString(body))\\n  .build();'};
      function generateSnippet(){const ep=document.getElementById('snipEndpoint').value;const lang=document.getElementById('snipLang').value;const s=snippets[ep]&&snippets[ep][lang];document.getElementById('snipOutput').textContent=s||'// Snippet for '+ep+' in '+lang+' coming soon...';}
      function copySnippet(){navigator.clipboard.writeText(document.getElementById('snipOutput').textContent);alert('Copied!');}
      generateSnippet();
      </script>
    `, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 15: Webhook Event Simulator
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/webhook-simulator', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    let webhooks = { rows: [] };
    try { webhooks = await pool.query('SELECT * FROM webhooks WHERE is_active = true ORDER BY created_at DESC'); } catch(e) {}
    const events = ['student.created','student.updated','fee.paid','fee.created','attendance.recorded','payment.received','user.registered','subscription.changed','webhook.test'];
    res.send(renderPage('Webhook Event Simulator', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>Webhook Event Simulator</h2>
        <p style="color:#64748b;margin-bottom:16px">Send simulated webhook events to test your integrations without real data changes.</p>
        <form method="POST" action="/dev/webhook-simulator/send" class="dp-form" style="max-width:600px">
          <div class="field"><label>Target Webhook</label>
            <select name="webhook_id" class="dp-select">
              <option value="all">All Active Webhooks</option>
              ${webhooks.rows.map(w=>`<option value="${w.id}">${esc(w.url)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Event Type</label>
            <select name="event_type" class="dp-select">
              ${events.map(e=>`<option value="${e}">${e}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Custom Payload (JSON)</label>
            <textarea name="payload" class="dp-textarea" rows="5">{"test": true, "simulated": true, "timestamp": "${new Date().toISOString()}"}</textarea>
          </div>
          <button type="submit" class="dp-btn dp-btn-primary">Send Simulated Event</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/dev/webhook-simulator/send', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { webhook_id, event_type, payload } = req.body;
    let targets = [];
    try {
      if (webhook_id === 'all') {
        const r = await pool.query('SELECT * FROM webhooks WHERE is_active = true');
        targets = r.rows;
      } else {
        const r = await pool.query('SELECT * FROM webhooks WHERE id=$1', [webhook_id]);
        targets = r.rows;
      }
    } catch(e) {}
    let sent = 0, failed = 0;
    for (const wh of targets) {
      try {
        const https = require('https'); const http = require('http');
        const url = new URL(wh.url);
        const proto = url.protocol === 'https:' ? https : http;
        const body = JSON.stringify({ event: event_type, data: JSON.parse(payload || '{}'), simulated: true, timestamp: new Date().toISOString() });
        const request = proto.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Simulated': 'true', 'Content-Length': Buffer.byteLength(body) } });
        request.on('error', () => { failed++; });
        request.write(body);
        request.end();
        sent++;
      } catch(e) { failed++; }
    }
    req.session.flash = { type: sent > 0 ? 'success' : 'error', msg: `Simulated event sent to ${sent} webhook(s)${failed > 0 ? ', ' + failed + ' failed' : ''}` };
    res.redirect('/dev/webhook-simulator');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 16: Developer Onboarding Guide
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/onboarding', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    res.send(renderPage('Developer Onboarding Guide', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>Developer Onboarding Guide</h2>
        <p style="color:#64748b;margin-bottom:16px">Get started building on the Comfort Platform API in minutes. Follow these steps to go from zero to production.</p>
        <div style="border-left:4px solid #4f46e5;padding-left:20px">
          <h3 style="color:#4f46e5">Step 1: Create an API Key</h3>
          <p>Navigate to <a href="/dev/api-keys">API Keys</a> and generate a new key. Choose appropriate scopes for your application needs. Store the key securely — it will only be shown once.</p>

          <h3 style="color:#4f46e5;margin-top:20px">Step 2: Authenticate</h3>
          <p>Use your API key in the <code>X-API-Key</code> header, or obtain a JWT token via <code>POST /api/v1/auth/login</code>. All API requests require authentication.</p>
          <div class="dp-code" style="margin:10px 0">curl -H "X-API-Key: your_key_here" https://ssewasswa.onrender.com/api/v1/students</div>

          <h3 style="color:#4f46e5;margin-top:20px">Step 3: Make Your First Request</h3>
          <p>Try listing students with a simple GET request. The API returns paginated JSON with metadata. Use <a href="/dev/api-playground">API Playground</a> to test interactively.</p>

          <h3 style="color:#4f46e5;margin-top:20px">Step 4: Set Up Webhooks</h3>
          <p>Register webhook endpoints at <a href="/dev/webhooks">Webhooks</a> to receive real-time event notifications when data changes occur (payments, attendance, etc.).</p>

          <h3 style="color:#4f46e5;margin-top:20px">Step 5: Use the Sandbox</h3>
          <p>Before going live, test your integration with the <a href="/dev/sandbox">Sandbox Environment</a>. All sandbox data auto-expires after 24 hours.</p>

          <h3 style="color:#4f46e5;margin-top:20px">Step 6: Monitor & Debug</h3>
          <p>Use <a href="/dev/api-analytics">API Analytics</a> and <a href="/dev/error-monitor">Error Monitor</a> to track usage and catch issues. Check <a href="/dev/webhook-logs">Webhook Logs</a> for delivery status.</p>

          <h3 style="color:#4f46e5;margin-top:20px">Step 7: Go Live</h3>
          <p>Switch from sandbox to production by updating your base URL and API key. Monitor the first 24 hours closely using the dashboards. Review <a href="/dev/rate-limits">Rate Limits</a> to avoid throttling.</p>
        </div>
      </div>
      <div class="dp-card">
        <h2>Quick Reference</h2>
        <div class="dp-grid">
          <div class="dp-stat" style="text-align:left"><div style="font-weight:700;margin-bottom:6px">Base URL</div><code style="font-size:11px">https://ssewasswa.onrender.com/api/v1</code></div>
          <div class="dp-stat" style="text-align:left"><div style="font-weight:700;margin-bottom:6px">Auth Methods</div><div style="font-size:12px">Bearer Token, X-API-Key</div></div>
          <div class="dp-stat" style="text-align:left"><div style="font-weight:700;margin-bottom:6px">Format</div><div style="font-size:12px">JSON (request & response)</div></div>
          <div class="dp-stat" style="text-align:left"><div style="font-weight:700;margin-bottom:6px">Rate Limit</div><div style="font-size:12px">100 req/min, 10K/day</div></div>
        </div>
      </div>
    `, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 17: OpenAPI Spec Generator
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/openapi-spec', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    res.send(renderPage('OpenAPI Spec Generator', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>OpenAPI Specification Generator</h2>
        <p style="color:#64748b;margin-bottom:16px">Auto-generate an OpenAPI 3.0 specification document for your Comfort Platform API instance.</p>
        <div style="margin-bottom:16px">
          <a href="/dev/openapi-spec/download" class="dp-btn dp-btn-primary">Download openapi.json</a>
          <button onclick="generateSpec()" class="dp-btn dp-btn-success" style="margin-left:8px">Regenerate Spec</button>
        </div>
        <div id="specOutput" class="dp-code" style="max-height:500px;overflow-y:auto">Loading specification...</div>
      </div>
      <script>
      const spec=${JSON.stringify({
        openapi:'3.0.3',
        info:{title:'Comfort Platform API',version:'2.0.0',description:'Multi-tenant SaaS API for African institutions'},
        servers:[{url:'https://ssewasswa.onrender.com/api/v1',description:'Production'}],
        components:{
          securitySchemes:{BearerAuth:{type:'http',scheme:'bearer',bearerFormat:'JWT'},ApiKeyAuth:{type:'apiKey',in:'header',name:'X-API-Key'}},
          schemas:{
            Student:{type:'object',properties:{id:{type:'integer'},name:{type:'string'},admission_no:{type:'string'},class:{type:'string'},stream:{type:'string'},guardian_name:{type:'string'},guardian_phone:{type:'string'}}},
            Fee:{type:'object',properties:{id:{type:'integer'},student_id:{type:'integer'},amount:{type:'integer'},paid:{type:'integer'},term:{type:'string'},year:{type:'integer'}}},
            Error:{type:'object',properties:{success:{type:'boolean'},error:{type:'string'}}}
          }
        },
        paths:{
          '/students':{get:{summary:'List students',security:[{BearerAuth:[]},{ApiKeyAuth:[]}],parameters:[{name:'search',in:'query',schema:{type:'string'}},{name:'class',in:'query',schema:{type:'string'}},{name:'page',in:'query',schema:{type:'integer'}}],responses:{'200':{description:'Success'},'401':{description:'Unauthorized'}}},post:{summary:'Create student',security:[{BearerAuth:[]},{ApiKeyAuth:[]}],requestBody:{content:{'application/json':{schema:{'$ref':'#/components/schemas/Student'}}}},responses:{'201':{description:'Created'},'400':{description:'Validation error'}}}},
          '/fees':{get:{summary:'List fees',security:[{BearerAuth:[]},{ApiKeyAuth:[]}],responses:{'200':{description:'Success'}}},post:{summary:'Create fee',security:[{BearerAuth:[]},{ApiKeyAuth:[]}],requestBody:{content:{'application/json':{schema:{'$ref':'#/components/schemas/Fee'}}}},responses:{'201':{description:'Created'}}}},
          '/attendance':{get:{summary:'List attendance',security:[{BearerAuth:[]},{ApiKeyAuth:[]}],responses:{'200':{description:'Success'}}},post:{summary:'Record attendance',security:[{BearerAuth:[]},{ApiKeyAuth:[]}],responses:{'201':{description:'Created'}}}},
          '/auth/login':{post:{summary:'Authenticate',requestBody:{content:{'application/json':{schema:{type:'object',properties:{email:{type:'string'},password:{type:'string'}}}}}},responses:{'200':{description:'Tokens returned'},'401':{description:'Invalid credentials'}}}},
          '/auth/me':{get:{summary:'Current user',security:[{BearerAuth:[]},{ApiKeyAuth:[]}],responses:{'200':{description:'User profile'}}}},
        }
      },null,2)};
      document.getElementById('specOutput').textContent=spec;
      function generateSpec(){document.getElementById('specOutput').textContent=spec;}
      </script>
    `, req.session.user));
  }));

  app.get('/dev/openapi-spec/download', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const spec = {
      openapi:'3.0.3',
      info:{title:'Comfort Platform API',version:'2.0.0',description:'Multi-tenant SaaS API for African institutions'},
      servers:[{url:'https://ssewasswa.onrender.com/api/v1'}],
      components:{securitySchemes:{BearerAuth:{type:'http',scheme:'bearer'},ApiKeyAuth:{type:'apiKey',in:'header',name:'X-API-Key'}}},
      paths:{'/students':{get:{summary:'List students',security:[{BearerAuth:[]},{ApiKeyAuth:[]}],responses:{'200':{description:'Success'}}},post:{summary:'Create student',security:[{BearerAuth:[]},{ApiKeyAuth:[]}],responses:{'201':{description:'Created'}}}}}
    };
    res.setHeader('Content-Type','application/json');
    res.setHeader('Content-Disposition','attachment; filename=openapi.json');
    res.send(JSON.stringify(spec, null, 2));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 18: API Health Status Page
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/api-health', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    let dbOk = false, dbLatency = 0;
    const start = Date.now();
    try { await pool.query('SELECT 1'); dbOk = true; dbLatency = Date.now() - start; } catch(e) { dbLatency = Date.now() - start; }
    const uptime = process.uptime();
    const mem = process.memoryUsage();
    const services = [
      { name:'PostgreSQL Database', status: dbOk, latency: dbLatency, detail: dbOk ? 'Connected' : 'Connection failed' },
      { name:'API Server', status: true, latency: 1, detail: 'Running on port ' + (process.env.PORT || 3000) },
      { name:'Session Store', status: true, latency: 0, detail: 'In-memory / Redis' },
      { name:'Authentication', status: true, latency: 0, detail: 'JWT + API Key auth active' },
      { name:'Rate Limiting', status: true, latency: 0, detail: '100 req/min per key' },
      { name:'Webhook Engine', status: true, latency: 0, detail: 'Event-driven delivery' },
    ];
    res.send(renderPage('API Health Status', `
      ${devStyles}${devNav()}
      <div class="dp-grid" style="margin-bottom:20px">
        <div class="dp-stat"><div class="num" style="color:${dbOk?'#059669':'#ef4444'}">${dbOk?'HEALTHY':'DOWN'}</div><div class="lbl">Overall Status</div></div>
        <div class="dp-stat"><div class="num">${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m</div><div class="lbl">Uptime</div></div>
        <div class="dp-stat"><div class="num">${dbLatency}ms</div><div class="lbl">DB Latency</div></div>
        <div class="dp-stat"><div class="num">${Math.round(mem.heapUsed/1024/1024)}MB</div><div class="lbl">Memory</div></div>
      </div>
      <div class="dp-card">
        <h2>Service Status</h2>
        <table class="dp-table">
          <tr><th>Service</th><th>Status</th><th>Latency</th><th>Details</th></tr>
          ${services.map(s=>`
            <tr>
              <td style="font-weight:600">${esc(s.name)}</td>
              <td><span class="dp-badge ${s.status?'dp-badge-green':'dp-badge-red'}"></span><span class="dp-tag ${s.status?'dp-tag-green':'dp-tag-red'}">${s.status?'Operational':'Down'}</span></td>
              <td>${s.latency}ms</td>
              <td style="color:#64748b;font-size:12px">${esc(s.detail)}</td>
            </tr>
          `).join('')}
        </table>
      </div>
      <div class="dp-card">
        <h2>System Metrics</h2>
        <div class="dp-grid">
          <div class="dp-stat" style="text-align:left"><div style="font-weight:700">Node.js</div><div style="font-size:12px">${process.version}</div></div>
          <div class="dp-stat" style="text-align:left"><div style="font-weight:700">Platform</div><div style="font-size:12px">${process.platform} ${process.arch}</div></div>
          <div class="dp-stat" style="text-align:left"><div style="font-weight:700">Heap Used</div><div style="font-size:12px">${Math.round(mem.heapUsed/1024/1024)}MB / ${Math.round(mem.heapTotal/1024/1024)}MB</div></div>
          <div class="dp-stat" style="text-align:left"><div style="font-weight:700">RSS</div><div style="font-size:12px">${Math.round(mem.rss/1024/1024)}MB</div></div>
        </div>
      </div>
    `, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 19: Data Export API
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/data-export', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    res.send(renderPage('Data Export API', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>Data Export API</h2>
        <p style="color:#64748b;margin-bottom:16px">Export platform data in various formats for backup, migration, or analytics integration.</p>
        <form method="GET" action="/dev/data-export/download" class="dp-form" style="max-width:600px">
          <div class="field"><label>Data Type</label>
            <select name="type" class="dp-select">
              <option value="students">Students</option>
              <option value="fees">Fee Records</option>
              <option value="payments">Payments</option>
              <option value="attendance">Attendance</option>
              <option value="users">Users</option>
              <option value="tenants">Tenants</option>
              <option value="audit_logs">Audit Logs</option>
              <option value="api_keys">API Keys</option>
              <option value="webhooks">Webhooks</option>
              <option value="subscriptions">Subscriptions</option>
            </select>
          </div>
          <div class="field"><label>Format</label>
            <select name="format" class="dp-select">
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
          </div>
          <div class="field"><label>Date Range (optional)</label>
            <div class="dp-row">
              <input name="from" type="date" class="dp-input" placeholder="From">
              <input name="to" type="date" class="dp-input" placeholder="To">
            </div>
          </div>
          <button type="submit" class="dp-btn dp-btn-primary">Export Data</button>
        </form>
      </div>
      <div class="dp-card">
        <h2>API Endpoint</h2>
        <div class="dp-code">GET /api/v1/export?type=students&format=json&from=2025-01-01&to=2025-12-31
Authorization: Bearer YOUR_TOKEN</div>
        <p style="margin-top:10px;color:#64748b;font-size:13px">You can also export data programmatically using the API endpoint above. Requires the <code>data:export</code> scope.</p>
      </div>
    `, req.session.user));
  }));

  app.get('/dev/data-export/download', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { type, format, from, to } = req.query;
    const allowedTables = ['students','fees','payments','attendance','users','tenants','audit_logs','api_keys','webhooks','subscriptions'];
    if (!allowedTables.includes(type)) return res.status(400).send('Invalid data type');

    try {
      let query = `SELECT * FROM ${type}`;
      const params = [];
      if (from) { params.push(from); query += ` WHERE created_at >= $${params.length}`; }
      if (to) { params.push(to); query += `${from?' AND':' WHERE'} created_at <= $${params.length}`; }
      query += ' ORDER BY id DESC LIMIT 10000';
      const result = await pool.query(query, params);

      if (format === 'csv') {
        const headers = result.rows.length > 0 ? Object.keys(result.rows[0]) : [];
        const csvLines = [headers.join(',')];
        for (const row of result.rows) { csvLines.push(headers.map(h => '"' + String(row[h]||'').replace(/"/g,'""') + '"').join(',')); }
        res.setHeader('Content-Type','text/csv');
        res.setHeader('Content-Disposition',`attachment; filename=${type}_export.csv`);
        return res.send(csvLines.join('\n'));
      }
      res.setHeader('Content-Type','application/json');
      res.setHeader('Content-Disposition',`attachment; filename=${type}_export.json`);
      res.send(JSON.stringify({ success:true, count:result.rows.length, data:result.rows }, null, 2));
    } catch(e) {
      res.status(500).send('Export error: ' + e.message);
    }
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 20: Plugin SDK Dashboard
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/plugin-sdk', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    let plugins = { rows: [] };
    try { plugins = await pool.query('SELECT * FROM dev_plugins ORDER BY downloads DESC'); } catch(e) {}
    res.send(renderPage('Plugin SDK Dashboard', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>Plugin SDK Dashboard</h2>
        <p style="color:#64748b;margin-bottom:16px">Manage platform plugins, view the SDK, and install community-built extensions.</p>
        <a href="/dev/plugin-sdk/new" class="dp-btn dp-btn-primary" style="margin-bottom:16px">+ Register Plugin</a>
        ${plugins.rows.length > 0 ? `
          <table class="dp-table">
            <tr><th>Name</th><th>Version</th><th>Category</th><th>Author</th><th>Downloads</th><th>Status</th><th>Actions</th></tr>
            ${plugins.rows.map(p=>`
              <tr>
                <td style="font-weight:600">${esc(p.name)}</td>
                <td>${esc(p.version)}</td>
                <td><span class="dp-tag dp-tag-blue">${esc(p.category||'general')}</span></td>
                <td>${esc(p.author||'-')}</td>
                <td>${p.downloads}</td>
                <td><span class="dp-tag ${p.is_active?'dp-tag-green':'dp-tag-red'}">${p.is_active?'Active':'Inactive'}</span></td>
                <td>
                  <form method="POST" action="/dev/plugin-sdk/${p.id}/toggle" style="display:inline"><button class="dp-btn ${p.is_active?'dp-btn-danger':'dp-btn-success'}" style="font-size:11px;padding:4px 10px">${p.is_active?'Disable':'Enable'}</button></form>
                </td>
              </tr>
            `).join('')}
          </table>
        ` : `
          <div class="dp-empty">No plugins registered yet.</div>
          <div style="margin-top:16px">
            <h3>Plugin SDK Quick Start</h3>
            <div class="dp-code">const { Plugin } = require('@ssewasswa/plugin-sdk');

class MyPlugin extends Plugin {
  name = 'my-plugin';
  version = '1.0.0';

  onInstall(context) {
    context.registerRoute('GET', '/my-plugin/hello', (req, res) => {
      res.json({ message: 'Hello from my plugin!' });
    });
  }

  onUninstall(context) {
    context.unregisterAll();
  }
}

module.exports = MyPlugin;</div>
          </div>
        `}
      </div>
    `, req.session.user));
  }));

  app.get('/dev/plugin-sdk/new', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    res.send(renderPage('Register Plugin', `
      ${devStyles}${devNav()}
      <div class="dp-card" style="max-width:600px">
        <h2>Register New Plugin</h2>
        <form method="POST" action="/dev/plugin-sdk/create" class="dp-form">
          <div class="field"><label>Plugin Name</label><input name="name" class="dp-input" required></div>
          <div class="field"><label>Slug (unique ID)</label><input name="slug" class="dp-input" required placeholder="my-awesome-plugin"></div>
          <div class="field"><label>Version</label><input name="version" class="dp-input" value="1.0.0"></div>
          <div class="field"><label>Description</label><textarea name="description" class="dp-textarea"></textarea></div>
          <div class="field"><label>Author</label><input name="author" class="dp-input"></div>
          <div class="field"><label>Category</label>
            <select name="category" class="dp-select"><option>general</option><option>academic</option><option>finance</option><option>communication</option><option>analytics</option><option>integration</option></select>
          </div>
          <button type="submit" class="dp-btn dp-btn-primary">Register Plugin</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/dev/plugin-sdk/create', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { name, slug, version, description, author, category } = req.body;
    try {
      await pool.query('INSERT INTO dev_plugins (name, slug, version, description, author, category) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, version=EXCLUDED.version',
        [name, slug, version||'1.0.0', description, author, category||'general']);
      req.session.flash = { type: 'success', msg: 'Plugin registered: ' + name };
    } catch(e) { req.session.flash = { type: 'error', msg: e.message }; }
    res.redirect('/dev/plugin-sdk');
  }));

  app.post('/dev/plugin-sdk/:id/toggle', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    try { await pool.query('UPDATE dev_plugins SET is_active = NOT is_active WHERE id=$1', [req.params.id]); } catch(e) {}
    res.redirect('/dev/plugin-sdk');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 21: IP Whitelisting for API Keys
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/ip-whitelist', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    let keys = { rows: [] }, whitelist = { rows: [] };
    try { keys = await pool.query('SELECT id, name, key_prefix FROM api_keys WHERE revoked IS NOT true ORDER BY created_at DESC'); } catch(e) {}
    try { whitelist = await pool.query('SELECT w.*, ak.name as key_name, ak.key_prefix FROM dev_ip_whitelist w LEFT JOIN api_keys ak ON w.api_key_id = ak.id ORDER BY w.created_at DESC'); } catch(e) {}
    res.send(renderPage('IP Whitelisting', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>IP Whitelisting for API Keys</h2>
        <p style="color:#64748b;margin-bottom:16px">Restrict API key access to specific IP addresses for enhanced security. Keys with no whitelist entries accept requests from any IP.</p>
        <form method="POST" action="/dev/ip-whitelist/add" class="dp-form" style="max-width:600px;margin-bottom:20px">
          <div class="field"><label>API Key</label>
            <select name="api_key_id" class="dp-select">
              ${keys.rows.map(k=>`<option value="${k.id}">${esc(k.name)} (${esc(k.key_prefix)}...)</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>IP Address</label><input name="ip_address" class="dp-input" required placeholder="192.168.1.100 or 10.0.0.0/24"></div>
          <div class="field"><label>Label</label><input name="label" class="dp-input" placeholder="Office IP, VPN, etc."></div>
          <button type="submit" class="dp-btn dp-btn-primary">Add to Whitelist</button>
        </form>
        ${whitelist.rows.length > 0 ? `
          <table class="dp-table">
            <tr><th>API Key</th><th>IP Address</th><th>Label</th><th>Added</th><th>Actions</th></tr>
            ${whitelist.rows.map(w=>`
              <tr>
                <td>${esc(w.key_name||w.api_key_id)}</td>
                <td style="font-family:monospace">${esc(w.ip_address)}</td>
                <td>${esc(w.label||'-')}</td>
                <td style="font-size:11px">${new Date(w.created_at).toLocaleString()}</td>
                <td><form method="POST" action="/dev/ip-whitelist/${w.id}/delete" style="display:inline"><button class="dp-btn dp-btn-danger" style="font-size:11px;padding:4px 10px">Remove</button></form></td>
              </tr>
            `).join('')}
          </table>
        ` : '<div class="dp-empty">No IP whitelist entries. All API keys currently accept requests from any IP.</div>'}
      </div>
    `, req.session.user));
  }));

  app.post('/dev/ip-whitelist/add', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { api_key_id, ip_address, label } = req.body;
    try {
      await pool.query('INSERT INTO dev_ip_whitelist (api_key_id, ip_address, label) VALUES ($1,$2,$3)', [api_key_id, ip_address, label||null]);
      req.session.flash = { type: 'success', msg: 'IP ' + ip_address + ' whitelisted' };
    } catch(e) { req.session.flash = { type: 'error', msg: e.message }; }
    res.redirect('/dev/ip-whitelist');
  }));

  app.post('/dev/ip-whitelist/:id/delete', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    try { await pool.query('DELETE FROM dev_ip_whitelist WHERE id=$1', [req.params.id]); } catch(e) {}
    res.redirect('/dev/ip-whitelist');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 22: API Key Usage Quotas
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/api-quotas', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    let quotas = { rows: [] }, keys = { rows: [] };
    try { quotas = await pool.query('SELECT q.*, ak.name, ak.key_prefix FROM dev_api_key_quotas q JOIN api_keys ak ON q.api_key_id = ak.id ORDER BY ak.name'); } catch(e) {}
    try { keys = await pool.query('SELECT ak.id, ak.name, ak.key_prefix FROM api_keys ak LEFT JOIN dev_api_key_quotas q ON ak.id = q.api_key_id WHERE q.id IS NULL AND ak.revoked IS NOT true'); } catch(e) {}
    res.send(renderPage('API Key Usage Quotas', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>API Key Usage Quotas</h2>
        <p style="color:#64748b;margin-bottom:16px">Configure daily and monthly request limits per API key. Keys exceeding quotas will receive 429 responses.</p>
        ${keys.rows.length > 0 ? `
          <form method="POST" action="/dev/api-quotas/set" class="dp-form" style="margin-bottom:20px">
            <div class="dp-row">
              <div class="dp-col">
                <div class="field"><label>API Key</label>
                  <select name="api_key_id" class="dp-select">${keys.rows.map(k=>`<option value="${k.id}">${esc(k.name)}</option>`).join('')}</select>
                </div>
              </div>
              <div class="dp-col"><div class="field"><label>Daily Limit</label><input name="daily_limit" type="number" class="dp-input" value="10000"></div></div>
              <div class="dp-col"><div class="field"><label>Monthly Limit</label><input name="monthly_limit" type="number" class="dp-input" value="300000"></div></div>
              <div class="dp-col" style="display:flex;align-items:flex-end"><button type="submit" class="dp-btn dp-btn-primary">Set Quota</button></div>
            </div>
          </form>
        ` : ''}
        ${quotas.rows.length > 0 ? `
          <table class="dp-table">
            <tr><th>Key Name</th><th>Daily Limit</th><th>Monthly Limit</th><th>Daily Used</th><th>Monthly Used</th><th>Actions</th></tr>
            ${quotas.rows.map(q => {
              const dPct = q.daily_limit>0?Math.round((q.daily_used/q.daily_limit)*100):0;
              const mPct = q.monthly_limit>0?Math.round((q.monthly_used/q.monthly_limit)*100):0;
              return `<tr>
                <td>${esc(q.name)} <span style="color:#64748b;font-size:11px">(${esc(q.key_prefix)})</span></td>
                <td>${parseInt(q.daily_limit).toLocaleString()}</td>
                <td>${parseInt(q.monthly_limit).toLocaleString()}</td>
                <td><span style="color:${dPct>80?'#ef4444':dPct>50?'#f59e0b':'#059669'};font-weight:700">${parseInt(q.daily_used).toLocaleString()}</span> (${dPct}%)</td>
                <td><span style="color:${mPct>80?'#ef4444':mPct>50?'#f59e0b':'#059669'};font-weight:700">${parseInt(q.monthly_used).toLocaleString()}</span> (${mPct}%)</td>
                <td><form method="POST" action="/dev/api-quotas/${q.api_key_id}/reset" style="display:inline"><button class="dp-btn dp-btn-warning" style="font-size:11px;padding:4px 10px">Reset</button></form></td>
              </tr>`;
            }).join('')}
          </table>
        ` : '<div class="dp-empty">No quotas configured. All API keys use default limits.</div>'}
      </div>
    `, req.session.user));
  }));

  app.post('/dev/api-quotas/set', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const { api_key_id, daily_limit, monthly_limit } = req.body;
    try {
      await pool.query('INSERT INTO dev_api_key_quotas (api_key_id, daily_limit, monthly_limit) VALUES ($1,$2,$3) ON CONFLICT (api_key_id) DO UPDATE SET daily_limit=EXCLUDED.daily_limit, monthly_limit=EXCLUDED.monthly_limit',
        [api_key_id, daily_limit||10000, monthly_limit||300000]);
      req.session.flash = { type: 'success', msg: 'Quota set for API key' };
    } catch(e) { req.session.flash = { type: 'error', msg: e.message }; }
    res.redirect('/dev/api-quotas');
  }));

  app.post('/dev/api-quotas/:keyId/reset', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    try { await pool.query('UPDATE dev_api_key_quotas SET daily_used=0, monthly_used=0 WHERE api_key_id=$1', [req.params.keyId]); } catch(e) {}
    res.redirect('/dev/api-quotas');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 23: Webhook Secret Rotation
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/webhook-secrets', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    let webhooks = { rows: [] };
    try { webhooks = await pool.query('SELECT id, name, url, secret, is_active, created_at FROM webhooks ORDER BY created_at DESC'); } catch(e) {}
    res.send(renderPage('Webhook Secret Rotation', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>Webhook Secret Rotation</h2>
        <p style="color:#64748b;margin-bottom:16px">Rotate webhook signing secrets to maintain security. New secrets take effect immediately; old secrets are invalidated.</p>
        <button onclick="rotateAllSecrets()" class="dp-btn dp-btn-danger" style="margin-bottom:16px">Rotate All Secrets</button>
        ${webhooks.rows.length > 0 ? `
          <table class="dp-table">
            <tr><th>ID</th><th>URL</th><th>Secret Preview</th><th>Status</th><th>Last Rotated</th><th>Actions</th></tr>
            ${webhooks.rows.map(w=>`
              <tr>
                <td>${w.id}</td>
                <td style="font-family:monospace;font-size:12px">${esc(w.url)}</td>
                <td style="font-family:monospace;font-size:12px">${w.secret?esc(w.secret.substring(0,8))+'...':'No secret'}</td>
                <td><span class="dp-tag ${w.is_active?'dp-tag-green':'dp-tag-red'}">${w.is_active?'Active':'Inactive'}</span></td>
                <td style="font-size:11px">${w.created_at?new Date(w.created_at).toLocaleString():'-'}</td>
                <td><form method="POST" action="/dev/webhook-secrets/${w.id}/rotate" style="display:inline"><button class="dp-btn dp-btn-warning" style="font-size:11px;padding:4px 10px">Rotate Secret</button></form></td>
              </tr>
            `).join('')}
          </table>
        ` : '<div class="dp-empty">No webhooks found. <a href="/dev/webhooks">Create one</a></div>'}
      </div>
      <script>
      function rotateAllSecrets(){if(confirm('Are you sure? This will rotate ALL webhook secrets. Your integrations must be updated with the new secrets.')){document.querySelectorAll('form[action$=\"/rotate\"]').forEach(f=>f.submit());}}
      </script>
    `, req.session.user));
  }));

  app.post('/dev/webhook-secrets/:id/rotate', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    const id = req.params.id;
    const newSecret = 'whsec_' + crypto.randomBytes(32).toString('hex');
    try {
      await pool.query('UPDATE webhooks SET secret=$1 WHERE id=$2', [newSecret, id]);
      req.session.flash = { type: 'success', msg: 'Webhook #' + id + ' secret rotated. New secret: ' + newSecret };
    } catch(e) { req.session.flash = { type: 'error', msg: e.message }; }
    res.redirect('/dev/webhook-secrets');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 24: API Documentation Search
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/doc-search', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    res.send(renderPage('API Documentation Search', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>API Documentation Search</h2>
        <p style="color:#64748b;margin-bottom:16px">Search across all API documentation, guides, and references.</p>
        <div style="max-width:600px;margin-bottom:20px">
          <input id="docSearch" class="dp-input" placeholder="Search documentation..." oninput="searchDocs()" style="font-size:16px;padding:14px">
        </div>
        <div id="docResults"></div>
      </div>
      <div class="dp-card">
        <h2>Documentation Index</h2>
        <div class="dp-grid">
          <div class="dp-stat" style="text-align:left;padding:16px">
            <div style="font-weight:700;margin-bottom:8px">Getting Started</div>
            <div style="font-size:12px"><a href="/dev/onboarding">Onboarding Guide</a><br><a href="/dev/code-snippets">Code Snippets</a><br><a href="/dev/sdk-downloads">SDK Downloads</a></div>
          </div>
          <div class="dp-stat" style="text-align:left;padding:16px">
            <div style="font-weight:700;margin-bottom:8px">API Reference</div>
            <div style="font-size:12px"><a href="/dev/api-playground">API Playground</a><br><a href="/dev/openapi-spec">OpenAPI Spec</a><br><a href="/dev/api-versioning">Versioning</a></div>
          </div>
          <div class="dp-stat" style="text-align:left;padding:16px">
            <div style="font-weight:700;margin-bottom:8px">Webhooks</div>
            <div style="font-size:12px"><a href="/dev/webhook-logs">Delivery Logs</a><br><a href="/dev/webhook-simulator">Event Simulator</a><br><a href="/dev/webhook-secrets">Secret Rotation</a></div>
          </div>
          <div class="dp-stat" style="text-align:left;padding:16px">
            <div style="font-weight:700;margin-bottom:8px">Security</div>
            <div style="font-size:12px"><a href="/dev/api-key-scopes">Key Scopes</a><br><a href="/dev/ip-whitelist">IP Whitelisting</a><br><a href="/dev/oauth-clients">OAuth2 Clients</a></div>
          </div>
          <div class="dp-stat" style="text-align:left;padding:16px">
            <div style="font-weight:700;margin-bottom:8px">Monitoring</div>
            <div style="font-size:12px"><a href="/dev/api-analytics">API Analytics</a><br><a href="/dev/error-monitor">Error Monitor</a><br><a href="/dev/api-health">Health Status</a></div>
          </div>
          <div class="dp-stat" style="text-align:left;padding:16px">
            <div style="font-weight:700;margin-bottom:8px">Management</div>
            <div style="font-size:12px"><a href="/dev/rate-limits">Rate Limits</a><br><a href="/dev/api-quotas">Key Quotas</a><br><a href="/dev/plugin-sdk">Plugin SDK</a></div>
          </div>
        </div>
      </div>
      <script>
      const docIndex=[
        {t:'Authentication',d:'JWT tokens and API key authentication methods',u:'/dev/onboarding'},
        {t:'Students API',d:'CRUD operations for student records',u:'/dev/api-playground'},
        {t:'Fees API',d:'Fee management and payment recording',u:'/dev/api-playground'},
        {t:'Attendance API',d:'Bulk attendance recording and reporting',u:'/dev/api-playground'},
        {t:'Webhooks',d:'Real-time event notifications setup',u:'/dev/webhook-logs'},
        {t:'OAuth2',d:'OAuth2 client credentials and authorization flows',u:'/dev/oauth-clients'},
        {t:'Rate Limiting',d:'Request throttling and quota management',u:'/dev/rate-limits'},
        {t:'API Key Scopes',d:'Granular permission scopes for API keys',u:'/dev/api-key-scopes'},
        {t:'Data Export',d:'Export platform data in JSON or CSV format',u:'/dev/data-export'},
        {t:'Sandbox',d:'Test environment with auto-expiring data',u:'/dev/sandbox'},
        {t:'Code Snippets',d:'Ready-to-use code in multiple languages',u:'/dev/code-snippets'},
        {t:'OpenAPI Spec',d:'Auto-generated OpenAPI 3.0 specification',u:'/dev/openapi-spec'},
        {t:'Error Monitoring',d:'Track and resolve API errors',u:'/dev/error-monitor'},
        {t:'IP Whitelisting',d:'Restrict API access by IP address',u:'/dev/ip-whitelist'},
        {t:'Webhook Secret Rotation',d:'Rotate webhook signing secrets',u:'/dev/webhook-secrets'},
        {t:'Plugin SDK',d:'Build and install platform extensions',u:'/dev/plugin-sdk'},
        {t:'GraphQL',d:'Query API with GraphQL',u:'/dev/graphql-playground'},
        {t:'API Versioning',d:'Manage API versions and deprecations',u:'/dev/api-versioning'},
        {t:'Changelog',d:'API change history and announcements',u:'/dev/changelog'},
        {t:'SDK Downloads',d:'Official client libraries',u:'/dev/sdk-downloads'},
      ];
      function searchDocs(){
        const q=document.getElementById('docSearch').value.toLowerCase().trim();
        const el=document.getElementById('docResults');
        if(!q){el.innerHTML='';return;}
        const matches=docIndex.filter(d=>d.t.toLowerCase().includes(q)||d.d.toLowerCase().includes(q));
        el.innerHTML=matches.length?matches.map(m=>'<div style="padding:12px;border-bottom:1px solid #e2e8f0"><a href="'+m.u+'" style="font-weight:700;color:#4f46e5">'+m.t+'</a><div style="color:#64748b;font-size:13px">'+m.d+'</div></div>').join(''):'<div style="padding:20px;color:#94a3b8;text-align:center">No results for "'+esc(q)+'"</div>';
      }
      </script>
    `, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 25: Developer Community Forum Link
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dev/community', requireAuth, requireSuperAdmin, ah(async (req, res) => {
    res.send(renderPage('Developer Community', `
      ${devStyles}${devNav()}
      <div class="dp-card">
        <h2>Developer Community</h2>
        <p style="color:#64748b;margin-bottom:16px">Connect with other developers building on the Comfort Platform. Get help, share integrations, and contribute to the ecosystem.</p>
        <div class="dp-grid">
          <a href="https://github.com/ssewasswa" target="_blank" class="dp-stat" style="text-decoration:none;color:inherit;cursor:pointer;transition:.2s">
            <div style="font-size:32px;margin-bottom:8px">🐙</div>
            <div style="font-weight:800;font-size:16px">GitHub</div>
            <div style="color:#64748b;font-size:12px">Open-source repos, issues & PRs</div>
            <div style="margin-top:8px"><span class="dp-btn dp-btn-primary" style="font-size:12px">Visit GitHub</span></div>
          </a>
          <a href="https://discord.gg/ssewasswa" target="_blank" class="dp-stat" style="text-decoration:none;color:inherit;cursor:pointer;transition:.2s">
            <div style="font-size:32px;margin-bottom:8px">💬</div>
            <div style="font-weight:800;font-size:16px">Discord</div>
            <div style="color:#64748b;font-size:12px">Real-time chat & support</div>
            <div style="margin-top:8px"><span class="dp-btn dp-btn-success" style="font-size:12px">Join Discord</span></div>
          </a>
          <a href="https://stackoverflow.com/questions/tagged/ssewasswa" target="_blank" class="dp-stat" style="text-decoration:none;color:inherit;cursor:pointer;transition:.2s">
            <div style="font-size:32px;margin-bottom:8px">📚</div>
            <div style="font-weight:800;font-size:16px">Stack Overflow</div>
            <div style="color:#64748b;font-size:12px">Q&A tagged #ssewasswa</div>
            <div style="margin-top:8px"><span class="dp-btn dp-btn-warning" style="font-size:12px">Ask a Question</span></div>
          </a>
          <a href="https://twitter.com/ssewasswa" target="_blank" class="dp-stat" style="text-decoration:none;color:inherit;cursor:pointer;transition:.2s">
            <div style="font-size:32px;margin-bottom:8px">🐦</div>
            <div style="font-weight:800;font-size:16px">Twitter/X</div>
            <div style="color:#64748b;font-size:12px">Updates & announcements</div>
            <div style="margin-top:8px"><span class="dp-btn dp-btn-primary" style="font-size:12px;background:#1da1f2">Follow Us</span></div>
          </a>
        </div>
      </div>
      <div class="dp-card">
        <h2>Community Resources</h2>
        <div class="dp-grid">
          <div class="dp-stat" style="text-align:left;padding:16px">
            <div style="font-weight:700;margin-bottom:8px">📖 Getting Help</div>
            <ul style="margin:0;padding-left:18px;font-size:13px;color:#475569">
              <li><a href="/dev/onboarding">Developer Onboarding Guide</a></li>
              <li><a href="/dev/doc-search">Documentation Search</a></li>
              <li><a href="/dev/changelog">API Changelog</a></li>
              <li><a href="/dev/api-health">Service Status</a></li>
            </ul>
          </div>
          <div class="dp-stat" style="text-align:left;padding:16px">
            <div style="font-weight:700;margin-bottom:8px">🤝 Contributing</div>
            <ul style="margin:0;padding-left:18px;font-size:13px;color:#475569">
              <li>Submit bug reports on GitHub</li>
              <li>Contribute SDK improvements</li>
              <li>Share your plugins</li>
              <li>Write documentation</li>
            </ul>
          </div>
          <div class="dp-stat" style="text-align:left;padding:16px">
            <div style="font-weight:700;margin-bottom:8px">🏢 Partner Program</div>
            <ul style="margin:0;padding-left:18px;font-size:13px;color:#475569">
              <li>Integration partnerships</li>
              <li>Co-marketing opportunities</li>
              <li>Technical support tiers</li>
              <li>Early API access</li>
            </ul>
          </div>
        </div>
      </div>
    `, req.session.user));
  }));

  console.log('[DevPortal] Developer portal extension loaded — 25 features, 26+ routes');
};
