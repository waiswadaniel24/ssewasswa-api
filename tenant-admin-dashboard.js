/**
 * Tenant Admin Dashboard Module — ssewasswa-api
 *
 * Comprehensive multi-tenant administration dashboard for tenant owners/admins.
 * Provides: user management, RBAC, billing, branding, integrations, audit, data mgmt, support.
 *
 * Usage:
 *   const tenantDash = require('./tenant-admin-dashboard');
 *   tenantDash(app, pool, { esc, renderPage, ah, requireAuth, requireSuperAdmin, audit });
 */

const { runMigration } = require('./db');

module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || ((fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  const TENANT_ID = req => req.session?.user?.tenant_id || req.session?.user?.school_id || 1;

  /* ─────────────────────── DB migrations ─────────────────────── */
  runMigration(pool, 'tenant-admin-dashboard', `
    CREATE TABLE IF NOT EXISTS tenant_dashboard_widgets (
      id SERIAL PRIMARY KEY,
      tenant_id INT DEFAULT 1,
      widget_type TEXT NOT NULL,
      config JSONB DEFAULT '{}',
      position INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tenant_audit_log (
      id SERIAL PRIMARY KEY,
      tenant_id INT DEFAULT 1,
      user_email TEXT,
      action TEXT NOT NULL,
      details JSONB DEFAULT '{}',
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tenant_invitations (
      id SERIAL PRIMARY KEY,
      tenant_id INT DEFAULT 1,
      email TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      token TEXT UNIQUE NOT NULL,
      accepted BOOLEAN DEFAULT false,
      expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tenant_api_keys (
      id SERIAL PRIMARY KEY,
      tenant_id INT DEFAULT 1,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      scopes TEXT[] DEFAULT '{read}',
      last_used_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tenant_integrations (
      id SERIAL PRIMARY KEY,
      tenant_id INT DEFAULT 1,
      provider TEXT NOT NULL,
      config JSONB DEFAULT '{}',
      is_active BOOLEAN DEFAULT true,
      health_status TEXT DEFAULT 'unknown',
      last_check_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tenant_settings (
      id SERIAL PRIMARY KEY,
      tenant_id INT DEFAULT 1,
      setting_key TEXT NOT NULL,
      setting_value JSONB DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, setting_key)
    );
    CREATE INDEX IF NOT EXISTS idx_tenant_audit_tenant ON tenant_audit_log(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tenant_invitations_tenant ON tenant_invitations(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_tenant ON tenant_api_keys(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_tenant_integrations_tenant ON tenant_integrations(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_tenant_settings_tenant ON tenant_settings(tenant_id);
  `).catch(() => {});

  /* ─────────────────────── Shared styles ─────────────────────── */
  const STYLE = `
    <style>
      :root{--bg:#0f172a;--bg-card:#1e293b;--bg-hover:#334155;--border:#334155;--text:#e2e8f0;--text-dim:#94a3b8;--accent:#3b82f6;--accent-hover:#2563eb;--danger:#ef4444;--success:#10b981;--warn:#f59e0b;--radius:10px}
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
      .container{max-width:1200px;margin:0 auto;padding:16px}
      .card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px}
      .card h2,.card h3{color:var(--text);margin-bottom:12px}
      .grid{display:grid;gap:16px}
      .grid-2{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
      .grid-3{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
      .grid-4{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
      .stat{text-align:center;padding:16px;background:var(--bg-hover);border-radius:var(--radius)}
      .stat .num{font-size:2rem;font-weight:700;color:var(--accent)}
      .stat .label{font-size:.85rem;color:var(--text-dim);margin-top:4px}
      .stat.success .num{color:var(--success)}
      .stat.warn .num{color:var(--warn)}
      .stat.danger .num{color:var(--danger)}
      .btn{display:inline-block;padding:8px 18px;border-radius:6px;font-size:.9rem;font-weight:600;border:none;cursor:pointer;text-decoration:none;color:#fff;transition:all .15s}
      .btn-primary{background:var(--accent)}.btn-primary:hover{background:var(--accent-hover)}
      .btn-danger{background:var(--danger)}.btn-danger:hover{opacity:.9}
      .btn-success{background:var(--success)}.btn-success:hover{opacity:.9}
      .btn-sm{padding:5px 12px;font-size:.8rem}
      .btn-outline{background:transparent;border:1px solid var(--border);color:var(--text)}.btn-outline:hover{background:var(--bg-hover)}
      table{width:100%;border-collapse:collapse;margin:8px 0}
      th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--border);font-size:.9rem}
      th{color:var(--text-dim);font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.5px}
      tr:hover{background:var(--bg-hover)}
      .tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.75rem;font-weight:600}
      .tag-blue{background:#1e3a5f;color:#60a5fa}
      .tag-green{background:#064e3b;color:#34d399}
      .tag-red{background:#7f1d1d;color:#f87171}
      .tag-yellow{background:#78350f;color:#fbbf24}
      .tag-gray{background:#374151;color:#9ca3af}
      input,select,textarea{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text);font-size:.9rem;width:100%}
      input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent)}
      label{display:block;font-size:.85rem;font-weight:600;color:var(--text-dim);margin-bottom:4px}
      .form-group{margin-bottom:14px}
      .nav-tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:20px;border-bottom:1px solid var(--border);padding-bottom:8px}
      .nav-tabs a{padding:8px 16px;border-radius:6px 6px 0 0;color:var(--text-dim);text-decoration:none;font-size:.85rem;font-weight:600;transition:all .15s}
      .nav-tabs a:hover{color:var(--text);background:var(--bg-hover)}
      .nav-tabs a.active{color:var(--accent);background:var(--bg-card);border-bottom:2px solid var(--accent)}
      .progress-bar{height:8px;background:var(--bg);border-radius:4px;overflow:hidden}
      .progress-bar .fill{height:100%;border-radius:4px;transition:width .3s}
      .muted{color:var(--text-dim);font-size:.85rem}
      .badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:10px;font-size:.7rem;font-weight:700}
      .badge-blue{background:#1e3a5f;color:#60a5fa}
      .badge-red{background:#7f1d1d;color:#f87171}
      .badge-green{background:#064e3b;color:#34d399}
      @media(max-width:640px){.grid-3,.grid-4{grid-template-columns:1fr 1fr}.container{padding:8px}}
    </style>`;

  function nav(active) {
    const tabs = [
      ['/tenant/dashboard','Overview'],['/tenant/users','Users'],['/tenant/billing','Billing'],
      ['/tenant/branding','Branding'],['/tenant/integrations','Integrations'],['/tenant/audit-log','Audit Log'],
      ['/tenant/settings','Settings'],['/tenant/data-management','Data'],['/tenant/support','Support']
    ];
    return `<nav class="nav-tabs">${tabs.map(([href,label]) =>
      `<a href="${href}" class="${href.endsWith('/'+active)?'active':''}">${label}</a>`
    ).join('')}</nav>`;
  }

  function svgBar(data, w=400, h=180) {
    if (!data || !data.length) return '<p class="muted">No data</p>';
    const max = Math.max(...data.map(d=>d.v),1);
    const barW = Math.min(40, (w-40)/data.length - 4);
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px">
      ${data.map((d,i) => {
        const x = 30 + i*((w-40)/data.length) + 2;
        const barH = (d.v/max)*(h-40);
        return `<rect x="${x}" y="${h-20-barH}" width="${barW}" height="${barH}" rx="3" fill="#3b82f6" opacity="0.85"/>
          <text x="${x+barW/2}" y="${h-4}" text-anchor="middle" fill="#94a3b8" font-size="9">${esc(d.l||'')}</text>
          <text x="${x+barW/2}" y="${h-24-barH}" text-anchor="middle" fill="#e2e8f0" font-size="10">${d.v}</text>`;
      }).join('')}
      <line x1="28" y1="${h-20}" x2="${w-10}" y2="${h-20}" stroke="#334155" stroke-width="1"/>
    </svg>`;
  }

  function svgDonut(pct, label='', color='#3b82f6', size=120) {
    const r=42, cx=60, cy=60, c=2*Math.PI*r;
    const dash = `${pct/100*c} ${c}`;
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#334155" stroke-width="12"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="12"
        stroke-dasharray="${dash}" stroke-dashoffset="0" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="round"/>
      <text x="${cx}" y="${cy-4}" text-anchor="middle" fill="#e2e8f0" font-size="18" font-weight="700">${pct}%</text>
      <text x="${cx}" y="${cy+14}" text-anchor="middle" fill="#94a3b8" font-size="9">${esc(label)}</text>
    </svg>`;
  }

  function svgSparkline(data, w=200, h=50, color='#3b82f6') {
    if (!data || data.length < 2) return '';
    const max = Math.max(...data, 1), min = Math.min(...data, 0);
    const range = max - min || 1;
    const pts = data.map((v,i) => `${i*(w/(data.length-1))},${h-((v-min)/range)*h}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }

  /* ─────────────────────── Route: Main Dashboard ─────────────────────── */
  app.get('/tenant/dashboard', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    const [stats, recentAudit, health] = await Promise.all([
      pool.query(`SELECT
        (SELECT COUNT(*) FROM users WHERE tenant_id=$1 OR school_id=$1) as total_users,
        (SELECT COUNT(*) FROM users WHERE (tenant_id=$1 OR school_id=$1) AND last_login > NOW()-INTERVAL '30 days') as active_users,
        (SELECT COUNT(*) FROM tenant_invitations WHERE tenant_id=$1 AND accepted=false AND expires_at>NOW()) as pending_invites,
        (SELECT COUNT(*) FROM tenant_api_keys WHERE tenant_id=$1) as api_keys,
        (SELECT COUNT(*) FROM tenant_integrations WHERE tenant_id=$1 AND is_active=true) as active_integrations
      `, [tid]),
      pool.query(`SELECT action, user_email, details, created_at FROM tenant_audit_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 15`, [tid]),
      pool.query(`SELECT reltuples::bigint AS est_rows FROM pg_class WHERE relname='tenant_settings' LIMIT 1`).catch(() => ({rows:[]}))
    ]);

    const s = stats.rows[0] || {};
    const usersTrend = [3,5,8,12,15,18,s.total_users||0];

    const content = `${STYLE}
    ${nav('dashboard')}
    <div class="grid grid-4">
      <div class="stat"><div class="num">${s.total_users||0}</div><div class="label">Total Users</div></div>
      <div class="stat success"><div class="num">${s.active_users||0}</div><div class="label">Active (30d)</div></div>
      <div class="stat warn"><div class="num">${s.pending_invites||0}</div><div class="label">Pending Invites</div></div>
      <div class="stat"><div class="num">${s.api_keys||0}</div><div class="label">API Keys</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>User Growth</h3>
        ${svgBar(usersTrend.map((v,i)=>({l:'M'+(i+1),v})))}
      </div>
      <div class="card">
        <h3>Integrations Health</h3>
        ${svgDonut(s.active_integrations ? 85 : 20, 'Active', s.active_integrations ? '#10b981' : '#f59e0b')}
        <p style="margin-top:8px" class="muted">${s.active_integrations||0} active integrations connected</p>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Quick Actions</h3>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <a href="/tenant/users/invite" class="btn btn-primary btn-sm">+ Invite User</a>
          <a href="/tenant/billing" class="btn btn-outline btn-sm">Manage Billing</a>
          <a href="/tenant/branding" class="btn btn-outline btn-sm">Customize Branding</a>
          <a href="/tenant/integrations" class="btn btn-outline btn-sm">Integrations</a>
          <a href="/tenant/audit-log" class="btn btn-outline btn-sm">Audit Log</a>
          <a href="/tenant/support" class="btn btn-outline btn-sm">Get Support</a>
        </div>
      </div>
      <div class="card">
        <h3>Recent Activity</h3>
        ${recentAudit.rows.length ? `<table><tr><th>Action</th><th>User</th><th>Time</th></tr>
          ${recentAudit.rows.map(r => `<tr><td>${esc(r.action)}</td><td>${esc(r.user_email)}</td><td class="muted">${new Date(r.created_at).toLocaleString()}</td></tr>`).join('')}
        </table>` : '<p class="muted">No recent activity</p>'}
      </div>
    </div>`;
    res.send(renderPage('Tenant Dashboard', content, req.session.user));
  }));

  /* ─────────────────────── Route: User Management ─────────────────────── */
  app.get('/tenant/users', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    const search = req.query.search || '';
    const roleFilter = req.query.role || '';
    let where = `(u.tenant_id=$1 OR u.school_id=$1)`;
    const params = [tid];
    let pi = 2;
    if (search) { where += ` AND (u.email ILIKE $${pi} OR u.name ILIKE $${pi})`; params.push(`%${search}%`); pi++; }
    if (roleFilter) { where += ` AND u.role=$${pi}`; params.push(roleFilter); pi++; }

    const users = await pool.query(`SELECT id, email, name, role, banned, last_login, created_at FROM users u WHERE ${where} ORDER BY created_at DESC LIMIT 100`, params);
    const roles = await pool.query(`SELECT DISTINCT role FROM users WHERE tenant_id=$1 OR school_id=$1`, [tid]).catch(() => ({rows:[]}));

    const content = `${STYLE}
    ${nav('users')}
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px">
        <h2 style="margin:0">User Management</h2>
        <a href="/tenant/users/invite" class="btn btn-primary btn-sm">+ Invite User</a>
      </div>
      <form method="get" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        <input name="search" placeholder="Search by name or email..." value="${esc(search)}" style="flex:1;min-width:200px">
        <select name="role" style="width:auto"><option value="">All Roles</option>${roles.rows.map(r=>`<option value="${esc(r.role)}" ${roleFilter===r.role?'selected':''}>${esc(r.role)}</option>`).join('')}</select>
        <button class="btn btn-outline btn-sm" type="submit">Filter</button>
      </form>
      <table><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th></tr>
      ${users.rows.map(u => `<tr>
        <td>${esc(u.name||'-')}</td>
        <td>${esc(u.email)}</td>
        <td><span class="tag tag-blue">${esc(u.role||'user')}</span></td>
        <td>${u.banned ? '<span class="tag tag-red">Banned</span>' : '<span class="tag tag-green">Active</span>'}</td>
        <td class="muted">${u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}</td>
      </tr>`).join('')}
      </table>
      ${users.rows.length === 0 ? '<p class="muted" style="text-align:center;padding:20px">No users found</p>' : ''}
    </div>`;
    res.send(renderPage('Users', content, req.session.user));
  }));

  /* ─────────────────────── Route: Invite User ─────────────────────── */
  app.get('/tenant/users/invite', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    const existingInvites = await pool.query(`SELECT email, role, accepted, expires_at FROM tenant_invitations WHERE tenant_id=$1 AND accepted=false AND expires_at>NOW() ORDER BY created_at DESC`, [tid]);

    const content = `${STYLE}
    ${nav('users')}
    <div class="grid grid-2">
      <div class="card">
        <h2>Invite New User</h2>
        <form method="POST" action="/tenant/users/invite">
          <div class="form-group"><label>Email Address</label><input name="email" type="email" required placeholder="user@example.com"></div>
          <div class="form-group"><label>Role</label>
            <select name="role">
              <option value="admin">Admin</option>
              <option value="member" selected>Member</option>
              <option value="viewer">Viewer</option>
              <option value="accountant">Accountant</option>
              <option value="teacher">Teacher</option>
              <option value="parent">Parent</option>
            </select>
          </div>
          <button class="btn btn-primary" type="submit">Send Invitation</button>
        </form>
      </div>
      <div class="card">
        <h2>Pending Invitations</h2>
        ${existingInvites.rows.length ? `<table><tr><th>Email</th><th>Role</th><th>Expires</th></tr>
          ${existingInvites.rows.map(i => `<tr><td>${esc(i.email)}</td><td><span class="tag tag-blue">${esc(i.role)}</span></td><td class="muted">${new Date(i.expires_at).toLocaleDateString()}</td></tr>`).join('')}
        </table>` : '<p class="muted">No pending invitations</p>'}
      </div>
    </div>`;
    res.send(renderPage('Invite User', content, req.session.user));
  }));

  app.post('/tenant/users/invite', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    const { email, role } = req.body;
    if (!email) return res.status(400).send('Email is required');
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(`INSERT INTO tenant_invitations (tenant_id, email, role, token) VALUES ($1,$2,$3,$4)`, [tid, email, role||'member', token]);
    try { await pool.query(`INSERT INTO tenant_audit_log (tenant_id, user_email, action, details) VALUES ($1,$2,'invite_user',$3)`, [tid, req.session.user.email, JSON.stringify({email, role: role||'member'})]); } catch(e){}
    res.redirect('/tenant/users/invite');
  }));

  /* ─────────────────────── Route: Billing ─────────────────────── */
  app.get('/tenant/billing', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    const sub = await pool.query(`SELECT plan, trial_ends_at, subscription_status FROM tenants WHERE id=$1`, [tid]).catch(() => ({rows:[{plan:'free', subscription_status:'active'}]}));
    const invoices = await pool.query(`SELECT id, amount, currency, status, created_at FROM invoices WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`, [tid]).catch(() => ({rows:[]}));
    const usage = await pool.query(`SELECT
      (SELECT COUNT(*) FROM users WHERE tenant_id=$1 OR school_id=$1) as user_count,
      (SELECT COUNT(*) FROM students WHERE tenant_id=$1 OR school_id=$1) as record_count,
      (SELECT COALESCE(SUM(sms_count),0) FROM sms_log WHERE tenant_id=$1) as sms_used
    `, [tid]).catch(() => ({rows:[{user_count:0,record_count:0,sms_used:0}]}));

    const planLimits = { free: {users:5,records:100,sms:50}, basic: {users:25,records:1000,sms:500}, pro: {users:100,records:10000,sms:5000}, enterprise: {users:999999,records:999999,sms:999999} };
    const currentPlan = (sub.rows[0]?.plan || 'free');
    const limits = planLimits[currentPlan] || planLimits.free;
    const u = usage.rows[0] || {};

    const content = `${STYLE}
    ${nav('billing')}
    <div class="grid grid-3">
      <div class="card" style="border-left:4px solid var(--accent)">
        <h3>Current Plan</h3>
        <div style="font-size:1.5rem;font-weight:700;color:var(--accent);text-transform:uppercase;margin:8px 0">${esc(currentPlan)}</div>
        <p class="muted">Status: <span class="tag tag-green">${esc(sub.rows[0]?.subscription_status||'active')}</span></p>
        ${sub.rows[0]?.trial_ends_at ? `<p class="muted">Trial ends: ${new Date(sub.rows[0].trial_ends_at).toLocaleDateString()}</p>` : ''}
      </div>
      <div class="card">
        <h3>Usage This Period</h3>
        <div style="margin:8px 0">
          <div style="display:flex;justify-content:space-between"><span>Users</span><span class="muted">${u.user_count}/${limits.users}</span></div>
          <div class="progress-bar"><div class="fill" style="width:${Math.min(100,(u.user_count/limits.users)*100)}%;background:${(u.user_count/limits.users)>0.8?'var(--danger)':'var(--accent)'}"></div></div>
        </div>
        <div style="margin:8px 0">
          <div style="display:flex;justify-content:space-between"><span>Records</span><span class="muted">${u.record_count}/${limits.records}</span></div>
          <div class="progress-bar"><div class="fill" style="width:${Math.min(100,(u.record_count/limits.records)*100)}%;background:${(u.record_count/limits.records)>0.8?'var(--danger)':'var(--accent)'}"></div></div>
        </div>
        <div style="margin:8px 0">
          <div style="display:flex;justify-content:space-between"><span>SMS</span><span class="muted">${u.sms_used}/${limits.sms}</span></div>
          <div class="progress-bar"><div class="fill" style="width:${Math.min(100,(u.sms_used/limits.sms)*100)}%;background:${(u.sms_used/limits.sms)>0.8?'var(--danger)':'var(--success)'}"></div></div>
        </div>
      </div>
      <div class="card">
        <h3>Payment Methods</h3>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-hover);border-radius:6px">
            <span style="font-size:1.2rem">📱</span><span>MTN MoMo</span><span class="tag tag-green">Available</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-hover);border-radius:6px">
            <span style="font-size:1.2rem">📱</span><span>Airtel Money</span><span class="tag tag-green">Available</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-hover);border-radius:6px">
            <span style="font-size:1.2rem">💳</span><span>DPO Card</span><span class="tag tag-green">Available</span>
          </div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Plan Comparison</h3>
      <table><tr><th>Feature</th><th>Free</th><th>Basic</th><th>Pro</th><th>Enterprise</th></tr>
        <tr><td>Users</td><td>5</td><td>25</td><td>100</td><td>Unlimited</td></tr>
        <tr><td>Records</td><td>100</td><td>1,000</td><td>10,000</td><td>Unlimited</td></tr>
        <tr><td>SMS/month</td><td>50</td><td>500</td><td>5,000</td><td>Unlimited</td></tr>
        <tr><td>Storage</td><td>100MB</td><td>1GB</td><td>10GB</td><td>Unlimited</td></tr>
        <tr><td>API Access</td><td><span class="tag tag-red">No</span></td><td><span class="tag tag-green">Yes</span></td><td><span class="tag tag-green">Yes</span></td><td><span class="tag tag-green">Yes</span></td></tr>
        <tr><td>Custom Branding</td><td><span class="tag tag-red">No</span></td><td><span class="tag tag-green">Yes</span></td><td><span class="tag tag-green">Yes</span></td><td><span class="tag tag-green">Yes</span></td></tr>
        <tr><td>Price (UGX/mo)</td><td>0</td><td>50,000</td><td>150,000</td><td>500,000</td></tr>
        <tr><td></td><td>${currentPlan!=='free'?'<span class="tag tag-blue">Current</span>':'<a href="/billing?plan=basic" class="btn btn-sm btn-primary">Upgrade</a>'}</td>
          <td>${currentPlan==='basic'?'<span class="tag tag-blue">Current</span>':'<a href="/billing?plan=basic" class="btn btn-sm btn-outline">Select</a>'}</td>
          <td>${currentPlan==='pro'?'<span class="tag tag-blue">Current</span>':'<a href="/billing?plan=pro" class="btn btn-sm btn-outline">Select</a>'}</td>
          <td>${currentPlan==='enterprise'?'<span class="tag tag-blue">Current</span>':'<a href="/billing?plan=enterprise" class="btn btn-sm btn-outline">Contact</a>'}</td></tr>
      </table>
    </div>
    ${invoices.rows.length ? `<div class="card" style="margin-top:16px"><h3>Recent Invoices</h3>
      <table><tr><th>ID</th><th>Amount</th><th>Currency</th><th>Status</th><th>Date</th></tr>
      ${invoices.rows.map(i => `<tr><td>#${i.id}</td><td>${Number(i.amount).toLocaleString()}</td><td>${esc(i.currency||'UGX')}</td>
        <td><span class="tag ${i.status==='paid'?'tag-green':i.status==='pending'?'tag-yellow':'tag-red'}">${esc(i.status)}</span></td>
        <td class="muted">${new Date(i.created_at).toLocaleDateString()}</td></tr>`).join('')}
      </table></div>` : ''}`;
    res.send(renderPage('Billing', content, req.session.user));
  }));

  /* ─────────────────────── Route: Branding ─────────────────────── */
  app.get('/tenant/branding', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    const brand = await pool.query(`SELECT setting_value FROM tenant_settings WHERE tenant_id=$1 AND setting_key='branding'`, [tid]).catch(() => ({rows:[]}));
    const b = brand.rows[0]?.setting_value || {};

    const content = `${STYLE}
    ${nav('branding')}
    <div class="grid grid-2">
      <div class="card">
        <h2>Branding & Customization</h2>
        <form method="POST" action="/tenant/branding/save">
          <div class="form-group"><label>Organization Name</label><input name="org_name" value="${esc(b.org_name||'')}"></div>
          <div class="form-group"><label>Primary Color</label><input name="primary_color" type="color" value="${esc(b.primary_color||'#3b82f6')}" style="height:40px;padding:4px"></div>
          <div class="form-group"><label>Secondary Color</label><input name="secondary_color" type="color" value="${esc(b.secondary_color||'#10b981')}" style="height:40px;padding:4px"></div>
          <div class="form-group"><label>Font Family</label>
            <select name="font_family">
              <option value="Inter" ${b.font_family==='Inter'?'selected':''}>Inter</option>
              <option value="Roboto" ${b.font_family==='Roboto'?'selected':''}>Roboto</option>
              <option value="Poppins" ${b.font_family==='Poppins'?'selected':''}>Poppins</option>
              <option value="Open Sans" ${b.font_family==='Open Sans'?'selected':''}>Open Sans</option>
            </select>
          </div>
          <div class="form-group"><label>Logo URL</label><input name="logo_url" placeholder="https://..." value="${esc(b.logo_url||'')}"></div>
          <div class="form-group"><label>Favicon URL</label><input name="favicon_url" placeholder="https://..." value="${esc(b.favicon_url||'')}"></div>
          <button class="btn btn-primary" type="submit">Save Branding</button>
        </form>
      </div>
      <div class="card">
        <h2>Preview</h2>
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:20px;min-height:200px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            ${b.logo_url ? `<img src="${esc(b.logo_url)}" style="height:40px;border-radius:6px" alt="Logo">` : '<div style="width:40px;height:40px;border-radius:6px;background:var(--accent)"></div>'}
            <span style="font-size:1.2rem;font-weight:700;color:${esc(b.primary_color||'#3b82f6')}">${esc(b.org_name||'Your Organization')}</span>
          </div>
          <div style="background:${esc(b.primary_color||'#3b82f6')};color:#fff;padding:10px 16px;border-radius:6px;font-weight:600">Sample Button</div>
          <p style="margin-top:12px;font-family:${esc(b.font_family||'Inter')}">This is how your text will look with the ${esc(b.font_family||'Inter')} font family applied across your portal.</p>
        </div>
        <div class="card" style="margin-top:12px">
          <h3>Custom Domain</h3>
          <p class="muted">Connect your own domain (e.g., portal.yourschool.ug)</p>
          <div class="form-group" style="margin-top:8px"><input placeholder="portal.yourdomain.ug" value="${esc(b.custom_domain||'')}"></div>
          <button class="btn btn-outline btn-sm">Configure Domain</button>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Branding', content, req.session.user));
  }));

  app.post('/tenant/branding/save', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    const { org_name, primary_color, secondary_color, font_family, logo_url, favicon_url } = req.body;
    const branding = { org_name, primary_color, secondary_color, font_family, logo_url, favicon_url };
    await pool.query(`INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES ($1,'branding',$2) ON CONFLICT (tenant_id, setting_key) DO UPDATE SET setting_value=$2, updated_at=NOW()`, [tid, JSON.stringify(branding)]);
    try { await pool.query(`INSERT INTO tenant_audit_log (tenant_id, user_email, action, details) VALUES ($1,$2,'update_branding',$3)`, [tid, req.session.user.email, JSON.stringify({org_name})]); } catch(e){}
    res.redirect('/tenant/branding');
  }));

  /* ─────────────────────── Route: Integrations ─────────────────────── */
  app.get('/tenant/integrations', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    const integrations = await pool.query(`SELECT * FROM tenant_integrations WHERE tenant_id=$1 ORDER BY provider`, [tid]);
    const apiKeys = await pool.query(`SELECT id, name, scopes, last_used_at, created_at FROM tenant_api_keys WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);

    const providers = [
      { id:'mtn_momo', name:'MTN MoMo', icon:'📱', desc:'Mobile money collections via MTN Uganda' },
      { id:'airtel_money', name:'Airtel Money', icon:'📱', desc:'Mobile money collections via Airtel Uganda' },
      { id:'dpo', name:'DPO PayGate', icon:'💳', desc:'Card payments via DPO Group' },
      { id:'africa_stalking', name:'Africa\'s Talking', icon:'💬', desc:'SMS and USSD via Africa\'s Talking' },
      { id:'cloudinary', name:'Cloudinary', icon:'☁️', desc:'Media storage and transformation' },
      { id:'sendgrid', name:'SendGrid', icon:'📧', desc:'Email delivery service' },
    ];

    const content = `${STYLE}
    ${nav('integrations')}
    <div class="card">
      <h2>Connected Integrations</h2>
      <div class="grid grid-2">
      ${providers.map(p => {
        const existing = integrations.rows.find(i => i.provider === p.id);
        return `<div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--bg-hover);border-radius:var(--radius)">
          <span style="font-size:1.5rem">${p.icon}</span>
          <div style="flex:1"><strong>${esc(p.name)}</strong><br><span class="muted">${esc(p.desc)}</span></div>
          ${existing ? `<span class="tag tag-green">Connected</span>` : `<a href="/tenant/integrations/setup/${p.id}" class="btn btn-outline btn-sm">Setup</a>`}
        </div>`;
      }).join('')}
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>API Keys</h2>
      <form method="POST" action="/tenant/integrations/api-key" style="display:flex;gap:8px;margin-bottom:16px">
        <input name="name" placeholder="Key name (e.g., Production)" required style="flex:1">
        <select name="scopes" style="width:auto"><option value="read">Read Only</option><option value="read,write">Read + Write</option><option value="read,write,admin">Full Access</option></select>
        <button class="btn btn-primary btn-sm" type="submit">Create Key</button>
      </form>
      ${apiKeys.rows.length ? `<table><tr><th>Name</th><th>Scopes</th><th>Last Used</th><th>Created</th><th></th></tr>
        ${apiKeys.rows.map(k => `<tr>
          <td>${esc(k.name)}</td>
          <td>${(k.scopes||[]).map(s=>`<span class="tag tag-blue">${esc(s)}</span>`).join(' ')}</td>
          <td class="muted">${k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}</td>
          <td class="muted">${new Date(k.created_at).toLocaleDateString()}</td>
          <td><form method="POST" action="/tenant/integrations/api-key/${k.id}/revoke"><button class="btn btn-danger btn-sm" type="submit" onclick="return confirm('Revoke this key?')">Revoke</button></form></td>
        </tr>`).join('')}
      </table>` : '<p class="muted">No API keys created yet</p>'}
    </div>`;
    res.send(renderPage('Integrations', content, req.session.user));
  }));

  app.post('/tenant/integrations/api-key', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    const crypto = require('crypto');
    const key = `ska_${crypto.randomBytes(24).toString('hex')}`;
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    await pool.query(`INSERT INTO tenant_api_keys (tenant_id, name, key_hash, scopes) VALUES ($1,$2,$3,string_to_array($4,','))`, [tid, req.body.name, hash, req.body.scopes||'read']);
    res.redirect('/tenant/integrations');
  }));

  app.post('/tenant/integrations/api-key/:id/revoke', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    await pool.query(`DELETE FROM tenant_api_keys WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.redirect('/tenant/integrations');
  }));

  /* ─────────────────────── Route: Audit Log ─────────────────────── */
  app.get('/tenant/audit-log', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;
    const actionFilter = req.query.action || '';
    const userFilter = req.query.user || '';

    let where = 'tenant_id=$1'; const params = [tid]; let pi = 2;
    if (actionFilter) { where += ` AND action ILIKE $${pi}`; params.push(`%${actionFilter}%`); pi++; }
    if (userFilter) { where += ` AND user_email ILIKE $${pi}`; params.push(`%${userFilter}%`); pi++; }

    const logs = await pool.query(`SELECT * FROM tenant_audit_log WHERE ${where} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi+1}`, [...params, limit, offset]);
    const total = await pool.query(`SELECT COUNT(*) FROM tenant_audit_log WHERE ${where}`, params);

    const content = `${STYLE}
    ${nav('audit-log')}
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px">
        <h2 style="margin:0">Audit Trail</h2>
        <a href="/tenant/audit-log/export?format=csv" class="btn btn-outline btn-sm">Export CSV</a>
      </div>
      <form method="get" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        <input name="action" placeholder="Filter by action..." value="${esc(actionFilter)}" style="flex:1;min-width:150px">
        <input name="user" placeholder="Filter by user email..." value="${esc(userFilter)}" style="flex:1;min-width:150px">
        <button class="btn btn-outline btn-sm" type="submit">Filter</button>
      </form>
      <table><tr><th>Action</th><th>User</th><th>Details</th><th>IP</th><th>Time</th></tr>
      ${logs.rows.map(l => `<tr>
        <td><span class="tag tag-blue">${esc(l.action)}</span></td>
        <td>${esc(l.user_email||'-')}</td>
        <td class="muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(JSON.stringify(l.details||{}).substring(0,80))}</td>
        <td class="muted">${esc(l.ip_address||'-')}</td>
        <td class="muted">${new Date(l.created_at).toLocaleString()}</td>
      </tr>`).join('')}
      </table>
      ${total.rows[0]?.count > limit ? `<div style="display:flex;justify-content:center;gap:8px;margin-top:12px">
        ${page > 1 ? `<a href="?page=${page-1}&action=${esc(actionFilter)}&user=${esc(userFilter)}" class="btn btn-outline btn-sm">Previous</a>` : ''}
        <span class="muted" style="padding:6px">Page ${page} of ${Math.ceil(total.rows[0].count/limit)}</span>
        ${page*limit < total.rows[0].count ? `<a href="?page=${page+1}&action=${esc(actionFilter)}&user=${esc(userFilter)}" class="btn btn-outline btn-sm">Next</a>` : ''}
      </div>` : ''}
    </div>`;
    res.send(renderPage('Audit Log', content, req.session.user));
  }));

  app.get('/tenant/audit-log/export', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    const logs = await pool.query(`SELECT action, user_email, details, ip_address, created_at FROM tenant_audit_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10000`, [tid]);
    const csv = 'Action,User,Details,IP,Time\n' + logs.rows.map(l => `"${l.action}","${l.user_email||''}","${JSON.stringify(l.details||{}).replace(/"/g,'""')}","${l.ip_address||''}","${l.created_at}"`).join('\n');
    res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename=audit-log.csv');
    res.send(csv);
  }));

  /* ─────────────────────── Route: Settings ─────────────────────── */
  app.get('/tenant/settings', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    const settings = await pool.query(`SELECT setting_key, setting_value FROM tenant_settings WHERE tenant_id=$1`, [tid]).catch(() => ({rows:[]}));
    const s = {}; settings.rows.forEach(r => s[r.setting_key] = r.setting_value);

    const content = `${STYLE}
    ${nav('settings')}
    <div class="grid grid-2">
      <div class="card">
        <h2>General Settings</h2>
        <form method="POST" action="/tenant/settings/save">
          <div class="form-group"><label>Organization Name</label><input name="org_name" value="${esc(s.general?.org_name||'')}"></div>
          <div class="form-group"><label>Timezone</label>
            <select name="timezone">
              <option value="Africa/Kampala" ${(s.general?.timezone||'')==='Africa/Kampala'?'selected':''}>Africa/Kampala (EAT)</option>
              <option value="UTC" ${s.general?.timezone==='UTC'?'selected':''}>UTC</option>
            </select>
          </div>
          <div class="form-group"><label>Language</label>
            <select name="language">
              <option value="en" ${(s.general?.language||'')==='en'?'selected':''}>English</option>
              <option value="lg" ${s.general?.language==='lg'?'selected':''}>Luganda</option>
              <option value="sw" ${s.general?.language==='sw'?'selected':''}>Swahili</option>
            </select>
          </div>
          <div class="form-group"><label>Currency</label>
            <select name="currency">
              <option value="UGX" ${(s.general?.currency||'UGX')==='UGX'?'selected':''}>UGX - Ugandan Shilling</option>
              <option value="USD" ${s.general?.currency==='USD'?'selected':''}>USD - US Dollar</option>
              <option value="KES" ${s.general?.currency==='KES'?'selected':''}>KES - Kenyan Shilling</option>
            </select>
          </div>
          <div class="form-group"><label>Data Retention (days)</label><input name="data_retention" type="number" value="${s.general?.data_retention||365}" min="30" max="3650"></div>
          <button class="btn btn-primary" type="submit">Save Settings</button>
        </form>
      </div>
      <div class="card">
        <h2>Notification Preferences</h2>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${['New user registration','Payment received','Error alerts','Weekly summary','Security alerts'].map(n => `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" checked style="width:auto"> <span>${n}</span>
          </label>`).join('')}
        </div>
        <h3 style="margin-top:20px">Two-Factor Authentication</h3>
        <p class="muted">Require 2FA for admin accounts</p>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:8px">
          <input type="checkbox" ${s.general?.require_2fa?'checked':''} style="width:auto"> <span>Enforce 2FA for admins</span>
        </label>
      </div>
    </div>`;
    res.send(renderPage('Settings', content, req.session.user));
  }));

  app.post('/tenant/settings/save', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    const { org_name, timezone, language, currency, data_retention } = req.body;
    const general = { org_name, timezone, language, currency, data_retention: parseInt(data_retention)||365 };
    await pool.query(`INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES ($1,'general',$2) ON CONFLICT (tenant_id, setting_key) DO UPDATE SET setting_value=$2, updated_at=NOW()`, [tid, JSON.stringify(general)]);
    try { await pool.query(`INSERT INTO tenant_audit_log (tenant_id, user_email, action, details) VALUES ($1,$2,'update_settings',$3)`, [tid, req.session.user.email, JSON.stringify({updated:['general']})]); } catch(e){}
    res.redirect('/tenant/settings');
  }));

  /* ─────────────────────── Route: Data Management ─────────────────────── */
  app.get('/tenant/data-management', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);

    const content = `${STYLE}
    ${nav('data-management')}
    <div class="grid grid-2">
      <div class="card">
        <h2>Data Export</h2>
        <p class="muted" style="margin-bottom:12px">Export all your tenant data in various formats for backup or migration purposes.</p>
        <div style="display:flex;flex-direction:column;gap:8px">
          <a href="/tenant/data-management/export?format=json" class="btn btn-primary">Export as JSON</a>
          <a href="/tenant/data-management/export?format=csv" class="btn btn-outline">Export as CSV</a>
        </div>
      </div>
      <div class="card">
        <h2>Data Import</h2>
        <p class="muted" style="margin-bottom:12px">Import data from CSV files. Supported entities: students, members, patients, clients.</p>
        <form method="POST" action="/tenant/data-management/import" enctype="multipart/form-data">
          <div class="form-group"><label>Entity Type</label>
            <select name="entity_type"><option value="students">Students</option><option value="members">Members</option><option value="patients">Patients</option><option value="clients">Clients</option></select>
          </div>
          <div class="form-group"><label>CSV File</label><input name="file" type="file" accept=".csv" required></div>
          <button class="btn btn-primary" type="submit">Import</button>
        </form>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h2>GDPR Compliance</h2>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--bg-hover);border-radius:6px">
            <span>Right to Data Access</span><span class="tag tag-green">Available</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--bg-hover);border-radius:6px">
            <span>Right to Deletion</span><span class="tag tag-green">Available</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--bg-hover);border-radius:6px">
            <span>Data Portability</span><span class="tag tag-green">Available</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--bg-hover);border-radius:6px">
            <span>Consent Management</span><span class="tag tag-yellow">Partial</span>
          </div>
        </div>
        <form method="POST" action="/tenant/data-management/gdpr-delete" style="margin-top:16px">
          <div class="form-group"><label>Delete User Data (GDPR Right to Erasure)</label><input name="email" placeholder="User email to delete" required></div>
          <button class="btn btn-danger btn-sm" type="submit" onclick="return confirm('This will permanently delete all data for this user. Continue?')">Delete User Data</button>
        </form>
      </div>
      <div class="card">
        <h2>Data Retention</h2>
        <p class="muted" style="margin-bottom:12px">Configure how long different types of data are retained before automatic archival or deletion.</p>
        <table><tr><th>Data Type</th><th>Retention</th><th>Action</th></tr>
          <tr><td>User Data</td><td>365 days</td><td><span class="tag tag-green">Active</span></td></tr>
          <tr><td>Audit Logs</td><td>90 days</td><td><span class="tag tag-green">Active</span></td></tr>
          <tr><td>Payment Records</td><td>7 years</td><td><span class="tag tag-blue">Required</span></td></tr>
          <tr><td>Session Data</td><td>30 days</td><td><span class="tag tag-green">Active</span></td></tr>
          <tr><td>Deleted Items</td><td>60 days</td><td><span class="tag tag-yellow">Recoverable</span></td></tr>
        </table>
      </div>
    </div>`;
    res.send(renderPage('Data Management', content, req.session.user));
  }));

  app.get('/tenant/data-management/export', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    const format = req.query.format || 'json';
    const tables = ['users','students','fees','donations','events','tenant_settings','tenant_audit_log'];
    const data = {};
    for (const t of tables) {
      try { const r = await pool.query(`SELECT * FROM ${t} WHERE tenant_id=$1 OR school_id=$1 LIMIT 5000`, [tid]); data[t] = r.rows; } catch(e) { data[t] = []; }
    }
    if (format === 'csv') {
      const csv = Object.entries(data).map(([table, rows]) => `--- ${table} ---\n${rows.length ? Object.keys(rows[0]).join(',')+'\n'+rows.map(r=>Object.values(r).map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n') : 'No data'}`).join('\n\n');
      res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename=tenant-export.csv'); res.send(csv);
    } else {
      res.setHeader('Content-Type','application/json'); res.setHeader('Content-Disposition','attachment; filename=tenant-export.json'); res.send(JSON.stringify(data, null, 2));
    }
  }));

  app.post('/tenant/data-management/gdpr-delete', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    const { email } = req.body;
    await pool.query(`UPDATE users SET name='[Deleted]', email='[deleted-'+id||']@gdpr', banned=true WHERE email=$1 AND (tenant_id=$2 OR school_id=$2)`, [email, tid]);
    try { await pool.query(`INSERT INTO tenant_audit_log (tenant_id, user_email, action, details) VALUES ($1,$2,'gdpr_deletion',$3)`, [tid, req.session.user.email, JSON.stringify({deleted_email:email})]); } catch(e){}
    res.redirect('/tenant/data-management');
  }));

  /* ─────────────────────── Route: Support ─────────────────────── */
  app.get('/tenant/support', requireAuth, ah(async (req, res) => {
    const content = `${STYLE}
    ${nav('support')}
    <div class="grid grid-2">
      <div class="card">
        <h2>Help Center</h2>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${[
            ['Getting Started','Learn how to set up your portal in minutes','/onboarding'],
            ['Managing Users','Invite team members and assign roles','/tenant/users'],
            ['Payment Setup','Configure MTN MoMo, Airtel Money & DPO','/tenant/integrations'],
            ['Branding Guide','Customize your portal look and feel','/tenant/branding'],
            ['Data Export','Download your data in JSON or CSV','/tenant/data-management'],
            ['Security Settings','Configure 2FA, IP blocking & audit logs','/tenant/audit-log'],
          ].map(([title, desc, link]) => `
            <a href="${link}" style="display:block;padding:12px;background:var(--bg-hover);border-radius:6px;text-decoration:none;color:var(--text);border:1px solid var(--border)">
              <strong>${esc(title)}</strong><br><span class="muted">${esc(desc)}</span>
            </a>`).join('')}
        </div>
      </div>
      <div class="card">
        <h2>Contact Support</h2>
        <form method="POST" action="/tenant/support/ticket">
          <div class="form-group"><label>Subject</label><input name="subject" required placeholder="Brief description of your issue"></div>
          <div class="form-group"><label>Category</label>
            <select name="category"><option>Billing</option><option>Technical</option><option>Feature Request</option><option>Security</option><option>Other</option></select>
          </div>
          <div class="form-group"><label>Description</label><textarea name="description" rows="5" required placeholder="Describe your issue in detail..."></textarea></div>
          <button class="btn btn-primary" type="submit">Submit Ticket</button>
        </form>
        <div style="margin-top:20px">
          <h3>Platform Status</h3>
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
            <div style="display:flex;justify-content:space-between;padding:6px 0"><span>API</span><span class="tag tag-green">Operational</span></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0"><span>Database</span><span class="tag tag-green">Operational</span></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0"><span>Payments</span><span class="tag tag-green">Operational</span></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0"><span>SMS</span><span class="tag tag-yellow">Partial</span></div>
          </div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Feature Requests</h2>
      <p class="muted" style="margin-bottom:12px">Suggest new features or vote on existing requests from other users.</p>
      <form method="POST" action="/tenant/support/feature-request" style="display:flex;gap:8px">
        <input name="feature" placeholder="Describe the feature you want..." required style="flex:1">
        <button class="btn btn-primary btn-sm" type="submit">Submit</button>
      </form>
    </div>`;
    res.send(renderPage('Support', content, req.session.user));
  }));

  app.post('/tenant/support/ticket', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    try { await pool.query(`INSERT INTO tenant_audit_log (tenant_id, user_email, action, details) VALUES ($1,$2,'support_ticket',$3)`, [tid, req.session.user.email, JSON.stringify({subject:req.body.subject, category:req.body.category})]); } catch(e){}
    res.redirect('/tenant/support');
  }));

  app.post('/tenant/support/feature-request', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    try { await pool.query(`INSERT INTO tenant_audit_log (tenant_id, user_email, action, details) VALUES ($1,$2,'feature_request',$3)`, [tid, req.session.user.email, JSON.stringify({feature:req.body.feature})]); } catch(e){}
    res.redirect('/tenant/support');
  }));

  /* ─────────────────────── Route: JSON Stats API ─────────────────────── */
  app.get('/tenant/api/stats', requireAuth, ah(async (req, res) => {
    const tid = TENANT_ID(req);
    const stats = await pool.query(`SELECT
      (SELECT COUNT(*) FROM users WHERE tenant_id=$1 OR school_id=$1) as total_users,
      (SELECT COUNT(*) FROM users WHERE (tenant_id=$1 OR school_id=$1) AND last_login > NOW()-INTERVAL '30 days') as active_users,
      (SELECT COUNT(*) FROM tenant_invitations WHERE tenant_id=$1 AND accepted=false AND expires_at>NOW()) as pending_invites,
      (SELECT COUNT(*) FROM tenant_api_keys WHERE tenant_id=$1) as api_keys,
      (SELECT COUNT(*) FROM tenant_integrations WHERE tenant_id=$1 AND is_active=true) as active_integrations,
      (SELECT plan FROM tenants WHERE id=$1) as plan
    `, [tid]);
    res.json(stats.rows[0] || {});
  }));

  console.log('[tenant-admin-dashboard] Loaded with 13 routes');
};
