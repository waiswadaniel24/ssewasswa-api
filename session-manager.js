/**
 * School SaaS Portal — Active Session Manager
 * View sessions, force-logout, device tracking, login history, suspicious activity.
 *
 * module.exports = function(app, pool, opts) { ... }
 *
 * opts: { esc, renderPage, ah, requireAuth, audit }
 */

module.exports = function (app, pool, opts) {
  const esc =
    opts.esc ||
    (s =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;'));

  const renderPage = opts.renderPage || ((_, __, body) => body);
  const ah = opts.ah || ((fn) => fn);
  const audit = opts.audit || (() => {});

  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const currentEmail = (req) => req.session?.user?.email || '';

  // ---------------------------------------------------------------------------
  // Inline CSS
  // ---------------------------------------------------------------------------
  const CSS = `
<link rel="stylesheet" href="/css/sk.css">
<style>
  :root {
    --primary: #4f46e5; --primary-light: #6366f1; --primary-dark: #4338ca;
    --danger: #ef4444; --success: #10b981; --warning: #f59e0b; --info: #06b6d4;
    --gray-50: #f9fafb; --gray-100: #f3f4f6; --gray-200: #e5e7eb;
    --gray-400: #9ca3af; --gray-600: #4b5563; --gray-800: #1f2937;
  }
  *, *::before, *::after { box-sizing: border-box; }
  .s-container { max-width: 1200px; margin: 0 auto; padding: 24px 16px; }
  .s-page-title { font-size: 1.75rem; font-weight: 700; color: var(--gray-800); margin-bottom: 4px; }
  .s-subtitle { color: var(--gray-600); margin-bottom: 24px; font-size: .92rem; }
  .s-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .s-card { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); padding: 20px; transition: box-shadow .2s; }
  .s-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,.12); }
  .s-card-label { font-size: .78rem; color: var(--gray-600); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
  .s-card-value { font-size: 1.8rem; font-weight: 700; color: var(--gray-800); }
  .s-card-icon { font-size: 1.5rem; margin-bottom: 8px; }
  .s-table-wrap { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); overflow: hidden; }
  .s-table { width: 100%; border-collapse: collapse; }
  .s-table th { background: var(--gray-50); padding: 10px 14px; text-align: left; font-size: .76rem; color: var(--gray-600); text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid var(--gray-200); white-space: nowrap; }
  .s-table td { padding: 10px 14px; border-bottom: 1px solid var(--gray-100); font-size: .86rem; color: var(--gray-800); vertical-align: middle; }
  .s-table tr:last-child td { border-bottom: none; }
  .s-table tr:hover { background: var(--gray-50); }
  .s-table-scroll { overflow-x: auto; max-height: 520px; overflow-y: auto; }
  .s-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: .73rem; font-weight: 600; white-space: nowrap; }
  .s-badge-green { background: #d1fae5; color: #065f46; }
  .s-badge-red { background: #fee2e2; color: #991b1b; }
  .s-badge-yellow { background: #fef3c7; color: #92400e; }
  .s-badge-blue { background: #dbeafe; color: #1e40af; }
  .s-badge-gray { background: var(--gray-100); color: var(--gray-600); }
  .s-badge-purple { background: #ede9fe; color: #5b21b6; }
  .s-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; font-size: .84rem; font-weight: 600; border: none; cursor: pointer; transition: all .15s; text-decoration: none; color: inherit; }
  .s-btn-primary { background: var(--primary); color: #fff; }
  .s-btn-primary:hover { background: var(--primary-dark); }
  .s-btn-danger { background: var(--danger); color: #fff; }
  .s-btn-danger:hover { background: #dc2626; }
  .s-btn-outline { background: transparent; border: 1px solid var(--gray-200); color: var(--gray-600); }
  .s-btn-outline:hover { background: var(--gray-50); }
  .s-btn-success { background: var(--success); color: #fff; }
  .s-btn-success:hover { background: #059669; }
  .s-btn-sm { padding: 4px 10px; font-size: .76rem; border-radius: 6px; }
  .s-flex { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 20px; }
  .s-flex-between { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  .s-input { padding: 8px 12px; border: 1px solid var(--gray-200); border-radius: 8px; font-size: .86rem; outline: none; transition: border-color .15s, box-shadow .15s; }
  .s-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(79,70,229,.1); }
  .s-select { padding: 8px 12px; border: 1px solid var(--gray-200); border-radius: 8px; font-size: .86rem; background: #fff; cursor: pointer; outline: none; }
  .s-section-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
  .s-section-title { font-size: 1.1rem; font-weight: 700; color: var(--gray-800); margin-bottom: 12px; }
  .s-empty { text-align: center; padding: 40px; color: var(--gray-400); font-size: .92rem; }
  .s-bar-chart { display: flex; align-items: flex-end; gap: 6px; height: 180px; padding: 0 4px; }
  .s-bar-col { display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 0; }
  .s-bar { width: 100%; max-width: 48px; background: var(--primary); border-radius: 6px 6px 0 0; min-height: 4px; transition: height .3s; }
  .s-bar-label { font-size: .68rem; color: var(--gray-600); margin-top: 6px; text-align: center; word-break: break-all; max-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .s-bar-val { font-size: .72rem; font-weight: 700; color: var(--gray-800); margin-bottom: 4px; }
  .s-form-group { margin-bottom: 18px; }
  .s-form-label { display: block; font-size: .84rem; font-weight: 600; color: var(--gray-800); margin-bottom: 5px; }
  .s-form-hint { font-size: .76rem; color: var(--gray-400); margin-top: 3px; }
  .s-toggle { position: relative; width: 44px; height: 24px; flex-shrink: 0; }
  .s-toggle input { opacity: 0; width: 0; height: 0; }
  .s-toggle-slider { position: absolute; inset: 0; background: var(--gray-200); border-radius: 999px; cursor: pointer; transition: background .2s; }
  .s-toggle-slider::before { content: ''; position: absolute; width: 18px; height: 18px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
  .s-toggle input:checked + .s-toggle-slider { background: var(--primary); }
  .s-toggle input:checked + .s-toggle-slider::before { transform: translateX(20px); }
  .s-policy-row { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--gray-100); gap: 16px; }
  .s-policy-row:last-child { border-bottom: none; }
  .s-divider { height: 1px; background: var(--gray-200); margin: 20px 0; }
  .s-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--gray-100); padding: 3px 10px; border-radius: 999px; font-size: .74rem; color: var(--gray-600); margin: 2px; }
  .s-alert { padding: 12px 16px; border-radius: 10px; font-size: .86rem; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  .s-alert-warning { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
  .s-alert-info { background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; }
  .s-alert-danger { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
  .s-alert-success { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
  .s-user-cell { display: flex; align-items: center; gap: 8px; }
  .s-avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--primary-light); color: #fff; display: flex; align-items: center; justify-content: center; font-size: .72rem; font-weight: 700; flex-shrink: 0; }
  .s-tabs { display: flex; gap: 0; border-bottom: 2px solid var(--gray-200); margin-bottom: 20px; }
  .s-tab { padding: 10px 20px; font-size: .86rem; font-weight: 600; color: var(--gray-600); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all .15s; text-decoration: none; }
  .s-tab:hover { color: var(--primary); }
  .s-tab-active { color: var(--primary); border-bottom-color: var(--primary); }
  code { font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: .82rem; background: var(--gray-50); padding: 2px 6px; border-radius: 4px; }
  @media (max-width: 768px) {
    .s-grid { grid-template-columns: 1fr 1fr; }
    .s-table th, .s-table td { padding: 8px 10px; font-size: .78rem; }
    .s-page-title { font-size: 1.4rem; }
  }
  @media (max-width: 480px) {
    .s-grid { grid-template-columns: 1fr; }
    .s-flex-between { flex-direction: column; align-items: flex-start; }
  }
</style>`;

  // ---------------------------------------------------------------------------
  // Helper functions
  // ---------------------------------------------------------------------------
  function deviceIcon(type) {
    if (!type) return '💻';
    const t = type.toLowerCase();
    return t === 'mobile' ? '📱' : t === 'tablet' ? '📋' : '💻';
  }

  function deviceTypeLabel(type) {
    if (!type) return 'Desktop';
    const t = type.toLowerCase();
    return t === 'mobile' ? 'Mobile' : t === 'tablet' ? 'Tablet' : 'Desktop';
  }

  function durationAgo(dt) {
    if (!dt) return '—';
    const diff = Math.floor((Date.now() - new Date(dt).getTime()) / 1000);
    if (diff < 0) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function sessionDuration(created) {
    if (!created) return '—';
    const mins = Math.floor((Date.now() - new Date(created).getTime()) / 60000);
    if (mins < 1) return '< 1 min';
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    const rm = mins % 60;
    return rm > 0 ? `${hrs}h ${rm}m` : `${hrs}h`;
  }

  function statusBadge(status) {
    const s = (status || '').toLowerCase();
    if (s === 'success') return '<span class="s-badge s-badge-green">✓ Success</span>';
    if (s === 'failed') return '<span class="s-badge s-badge-red">✗ Failed</span>';
    if (s === 'expired') return '<span class="s-badge s-badge-yellow">⧖ Expired</span>';
    if (s === 'locked') return '<span class="s-badge s-badge-red">🔒 Locked</span>';
    return `<span class="s-badge s-badge-gray">${esc(status)}</span>`;
  }

  function methodBadge(method) {
    const m = (method || '').toLowerCase();
    if (m === 'sso') return '<span class="s-badge s-badge-purple">SSO</span>';
    if (m === 'oauth') return '<span class="s-badge s-badge-blue">OAuth</span>';
    if (m === 'mfa') return '<span class="s-badge s-badge-green">MFA</span>';
    if (m === 'ldap') return '<span class="s-badge s-badge-yellow">LDAP</span>';
    return `<span class="s-badge s-badge-gray">${esc(method || 'Password')}</span>`;
  }

  function suspiciousReasonBadge(reason) {
    const r = (reason || '').toLowerCase();
    if (r.includes('new device')) return '<span class="s-badge s-badge-yellow">🔧 New Device</span>';
    if (r.includes('new location')) return '<span class="s-badge s-badge-blue">📍 New Location</span>';
    if (r.includes('multiple fail')) return '<span class="s-badge s-badge-red">❌ Multi-Failure</span>';
    if (r.includes('impossible travel')) return '<span class="s-badge s-badge-red">⚡ Impossible Travel</span>';
    if (r.includes('brute force')) return '<span class="s-badge s-badge-red">🔨 Brute Force</span>';
    if (r.includes('unusual time')) return '<span class="s-badge s-badge-yellow">🌙 Unusual Time</span>';
    return `<span class="s-badge s-badge-gray">${esc(reason)}</span>`;
  }

  function avatarLetter(email) {
    return (email || '?').charAt(0).toUpperCase();
  }

  function navBar(current) {
    return `<div class="s-tabs">
      <a href="/school/sessions" class="s-tab ${current === 'dashboard' ? 's-tab-active' : ''}">📊 Dashboard</a>
      <a href="/school/sessions/active" class="s-tab ${current === 'active' ? 's-tab-active' : ''}">🌐 Active</a>
      <a href="/school/sessions/login-history" class="s-tab ${current === 'history' ? 's-tab-active' : ''}">📜 History</a>
      <a href="/school/sessions/devices" class="s-tab ${current === 'devices' ? 's-tab-active' : ''}">💻 Devices</a>
      <a href="/school/sessions/suspicious" class="s-tab ${current === 'suspicious' ? 's-tab-active' : ''}">🚨 Suspicious</a>
      <a href="/school/sessions/geo" class="s-tab ${current === 'geo' ? 's-tab-active' : ''}">🌍 Geo</a>
      <a href="/school/sessions/policy" class="s-tab ${current === 'policy' ? 's-tab-active' : ''}">⚙️ Policy</a>
    </div>`;
  }

  function paginationHtml(page, totalPages, extraQuery) {
    let links = '';
    const cp = parseInt(page, 10);
    const start = Math.max(1, cp - 3);
    const end = Math.min(totalPages, cp + 3);
    if (start > 1) links += `<a href="?page=1${extraQuery}" class="s-btn s-btn-outline s-btn-sm">1</a>`;
    if (start > 2) links += `<span class="s-badge s-badge-gray">…</span>`;
    for (let i = start; i <= end; i++) {
      links += `<a href="?page=${i}${extraQuery}" class="s-btn ${i === cp ? 's-btn-primary' : 's-btn-outline'} s-btn-sm">${i}</a>`;
    }
    if (end < totalPages - 1) links += `<span class="s-badge s-badge-gray">…</span>`;
    if (end < totalPages) links += `<a href="?page=${totalPages}${extraQuery}" class="s-btn s-btn-outline s-btn-sm">${totalPages}</a>`;
    return links;
  }

  // ---------------------------------------------------------------------------
  // Table creation (async IIFE)
  // ---------------------------------------------------------------------------
  (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        tenant_id INT,
        user_email VARCHAR(255),
        session_id TEXT,
        ip_address VARCHAR(45),
        user_agent TEXT,
        device_type VARCHAR(20),
        browser VARCHAR(50),
        os VARCHAR(50),
        location VARCHAR(100),
        is_current BOOLEAN DEFAULT false,
        last_activity TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS login_history (
        id SERIAL PRIMARY KEY,
        tenant_id INT,
        user_email VARCHAR(255),
        ip_address VARCHAR(45),
        user_agent TEXT,
        device_type VARCHAR(20),
        browser VARCHAR(50),
        os VARCHAR(50),
        location VARCHAR(100),
        login_method VARCHAR(20),
        status VARCHAR(20) DEFAULT 'success',
        failure_reason TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS suspicious_logins (
        id SERIAL PRIMARY KEY,
        tenant_id INT,
        user_email VARCHAR(255),
        session_id TEXT,
        reason TEXT,
        ip_address VARCHAR(45),
        is_whitelisted BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS session_policies (
        id SERIAL PRIMARY KEY,
        tenant_id INT UNIQUE,
        max_concurrent_sessions INT DEFAULT 5,
        session_timeout_minutes INT DEFAULT 60,
        max_devices_per_user INT DEFAULT 3,
        enforce_ip_whitelist BOOLEAN DEFAULT false,
        allowed_ips TEXT[],
        require_mfa_for_new_device BOOLEAN DEFAULT true,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    // Performance indexes (add missing columns first in case table was created by another module)
    await pool.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`).catch(()=>{});
    await pool.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS tenant_id INT`).catch(()=>{});
    await pool.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS device_type VARCHAR(20)`).catch(()=>{});
    await pool.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS browser VARCHAR(50)`).catch(()=>{});
    await pool.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS os VARCHAR(50)`).catch(()=>{});
    await pool.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS location VARCHAR(100)`).catch(()=>{});
    await pool.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ DEFAULT NOW()`).catch(()=>{});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_us_tenant_active ON user_sessions(tenant_id, expires_at)`).catch(()=>{});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_us_tenant_email ON user_sessions(tenant_id, user_email)`).catch(()=>{});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_lh_tenant_created ON login_history(tenant_id, created_at DESC)`).catch(()=>{});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sl_tenant_wl ON suspicious_logins(tenant_id, is_whitelisted)`).catch(()=>{});
  })().catch((err) => console.error('[session-manager] Table creation error:', err));

  // ===========================================================================
  // ROUTES
  // ===========================================================================

  // ---------- 1. Dashboard ----------
  app.get('/school/sessions', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [ac, uc, dc, sc, recent, failed24] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM user_sessions WHERE tenant_id=$1 AND expires_at > NOW()`, [tid]),
      pool.query(`SELECT COUNT(DISTINCT user_email)::int AS n FROM user_sessions WHERE tenant_id=$1 AND expires_at > NOW()`, [tid]),
      pool.query(`SELECT COUNT(DISTINCT ip_address)::int AS n FROM user_sessions WHERE tenant_id=$1 AND expires_at > NOW()`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM suspicious_logins WHERE tenant_id=$1 AND is_whitelisted=false`, [tid]),
      pool.query(`SELECT user_email, device_type, browser, ip_address, location, created_at FROM login_history WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 8`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM login_history WHERE tenant_id=$1 AND status='failed' AND created_at > NOW() - INTERVAL '24 hours'`, [tid]),
    ]);
    const stats = { active: ac.rows[0].n, users: uc.rows[0].n, ips: dc.rows[0].n, suspicious: sc.rows[0].n, failed24: failed24.rows[0].n };
    const recentRows = recent.rows;

    const recentHtml = recentRows.length > 0
      ? recentRows.map((r) => `<tr>
          <td><div class="s-user-cell"><div class="s-avatar">${avatarLetter(r.user_email)}</div>${esc(r.user_email)}</div></td>
          <td>${deviceIcon(r.device_type)} ${esc(r.browser || '—')}</td>
          <td><code>${esc(r.ip_address)}</code></td>
          <td>${esc(r.location || '—')}</td>
          <td>${new Date(r.created_at).toLocaleString()}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="s-empty">No recent logins</td></tr>';

    const body = `${CSS}
<div class="s-container">
  <h1 class="s-page-title">🔒 Session Manager</h1>
  <p class="s-subtitle">Monitor active sessions, devices, and login security</p>

  <div class="s-grid">
    <div class="s-card">
      <div class="s-card-icon">🌐</div>
      <div class="s-card-label">Active Sessions</div>
      <div class="s-card-value">${stats.active}</div>
    </div>
    <div class="s-card">
      <div class="s-card-icon">👥</div>
      <div class="s-card-label">Unique Users</div>
      <div class="s-card-value">${stats.users}</div>
    </div>
    <div class="s-card">
      <div class="s-card-icon">📍</div>
      <div class="s-card-label">Unique IPs</div>
      <div class="s-card-value">${stats.ips}</div>
    </div>
    <div class="s-card">
      <div class="s-card-icon">⚠️</div>
      <div class="s-card-label">Suspicious</div>
      <div class="s-card-value" style="color:${stats.suspicious > 0 ? 'var(--danger)' : 'var(--success)'}">${stats.suspicious}</div>
    </div>
  </div>

  ${stats.failed24 > 0 ? `<div class="s-alert s-alert-danger">⚠️ ${stats.failed24} failed login attempts in the last 24 hours</div>` : ''}
  ${stats.suspicious > 0 ? `<div class="s-alert s-alert-warning">🚨 ${stats.suspicious} suspicious login${stats.suspicious > 1 ? 's' : ''} require review. <a href="/school/sessions/suspicious" style="font-weight:700">View details →</a></div>` : ''}

  <div class="s-section-title">Recent Logins</div>
  <div class="s-table-wrap"><table class="s-table">
    <thead><tr><th>User</th><th>Device</th><th>IP Address</th><th>Location</th><th>Time</th></tr></thead>
    <tbody>${recentHtml}</tbody>
  </table></div>

  <div class="s-flex" style="margin-top:24px">
    <a href="/school/sessions/active" class="s-btn s-btn-primary">📋 View Active Sessions</a>
    <a href="/school/sessions/login-history" class="s-btn s-btn-outline">📜 Full History</a>
    <a href="/school/sessions/suspicious" class="s-btn ${stats.suspicious > 0 ? 's-btn-danger' : 's-btn-outline'}">🚨 Suspicious</a>
    <a href="/school/sessions/devices" class="s-btn s-btn-outline">💻 Devices</a>
    <a href="/school/sessions/geo" class="s-btn s-btn-outline">🌍 Geographic</a>
    <a href="/school/sessions/policy" class="s-btn s-btn-outline">⚙️ Policy</a>
  </div>
</div>`;
    res.send(renderPage(req, res, body));
  }));

  // ---------- 2. Active Sessions ----------
  app.get('/school/sessions/active', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { search } = req.query;
    let query = `SELECT * FROM user_sessions WHERE tenant_id=$1 AND expires_at > NOW()`;
    const params = [tid];
    if (search) { query += ` AND (user_email ILIKE $2 OR ip_address ILIKE $2)`; params.push(`%${search}%`); }
    query += ` ORDER BY last_activity DESC`;
    const { rows } = await pool.query(query, params);

    let tableRows = '';
    if (!rows.length) {
      tableRows = '<tr><td colspan="9" class="s-empty">No active sessions found</td></tr>';
    } else {
      tableRows = rows.map((s) => `<tr>
        <td><div class="s-user-cell"><div class="s-avatar">${avatarLetter(s.user_email)}</div><div>${esc(s.user_email)}</div></div></td>
        <td>${deviceIcon(s.device_type)} <span class="s-chip">${esc(deviceTypeLabel(s.device_type))}</span></td>
        <td>${esc(s.browser || 'Unknown')}</td>
        <td>${esc(s.os || '—')}</td>
        <td><code>${esc(s.ip_address)}</code></td>
        <td>${esc(s.location || '—')}</td>
        <td>${sessionDuration(s.created_at)}</td>
        <td>${s.is_current ? '<span class="s-badge s-badge-green">● This session</span>' : durationAgo(s.last_activity)}</td>
        <td>
          ${s.is_current
            ? '<span class="s-badge s-badge-gray">Current</span>'
            : `<form method="POST" action="/school/sessions/${s.id}/terminate" style="display:inline" onsubmit="return confirm('Terminate this session for ${esc(s.user_email)}?')">
                <button class="s-btn s-btn-danger s-btn-sm">Terminate</button>
              </form>`}
        </td>
      </tr>`).join('');
    }

    const body = `${CSS}
<div class="s-container">
  ${navBar('active')}
  <div class="s-section-head">
    <div><h1 class="s-page-title">Active Sessions</h1><p class="s-subtitle">${rows.length} session${rows.length !== 1 ? 's' : ''} currently active</p></div>
    <div class="s-flex" style="margin-bottom:0">
      <form method="POST" action="/school/sessions/terminate-all" onsubmit="return confirm('Terminate ALL other sessions except yours?')" style="display:inline">
        <button class="s-btn s-btn-danger">🚫 Terminate All Others</button>
      </form>
    </div>
  </div>
  <form method="GET" class="s-flex" style="margin-bottom:16px">
    <input type="text" name="search" class="s-input" value="${esc(search || '')}" placeholder="Search by email or IP..." style="flex:1;max-width:320px">
    <button type="submit" class="s-btn s-btn-primary s-btn-sm">Search</button>
    ${search ? `<a href="/school/sessions/active" class="s-btn s-btn-outline s-btn-sm">Clear</a>` : ''}
  </form>
  <div class="s-table-wrap"><div class="s-table-scroll"><table class="s-table">
    <thead><tr><th>User</th><th>Device</th><th>Browser</th><th>OS</th><th>IP</th><th>Location</th><th>Duration</th><th>Last Activity</th><th>Action</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table></div></div>
</div>`;
    res.send(renderPage(req, res, body));
  }));

  // ---------- 3. Terminate Session ----------
  app.post('/school/sessions/:id/terminate', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const sid = parseInt(req.params.id, 10);
    const { rows } = await pool.query(`SELECT user_email, session_id FROM user_sessions WHERE id=$1 AND tenant_id=$2`, [sid, tid]);
    if (rows.length) {
      await pool.query(`UPDATE user_sessions SET expires_at=NOW() WHERE id=$1`, [sid]);
      audit(req, 'session_terminate', `Terminated session ${sid} for ${rows[0].user_email}`);
    }
    res.redirect('/school/sessions/active');
  }));

  // ---------- 4. Terminate All Others ----------
  app.post('/school/sessions/terminate-all', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = currentEmail(req);
    const mySid = req.sessionID || '';
    const { rows } = await pool.query(
      `UPDATE user_sessions SET expires_at=NOW() WHERE tenant_id=$1 AND user_email=$2 AND session_id != $3 AND expires_at > NOW() RETURNING id`,
      [tid, email, mySid]);
    audit(req, 'session_terminate_all', `Terminated ${rows.length} other sessions for ${email}`);
    res.redirect('/school/sessions/active');
  }));

  // ---------- 5. Terminate User Sessions ----------
  app.post('/school/sessions/terminate-user/:email', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.params.email;
    const { rows } = await pool.query(
      `UPDATE user_sessions SET expires_at=NOW() WHERE tenant_id=$1 AND user_email=$2 AND expires_at > NOW() RETURNING id`,
      [tid, email]);
    audit(req, 'session_terminate_user', `Terminated ${rows.length} sessions for ${email}`);
    res.redirect('/school/sessions/active');
  }));

  // ---------- 6. Login History ----------
  app.get('/school/sessions/login-history', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { date_from, date_to, search, status: statusFilter, page = '1' } = req.query;
    const limit = 25;
    const offset = (parseInt(page, 10) - 1) * limit;
    const conditions = ['tenant_id=$1'];
    const params = [tid];
    let pi = 2;
    if (date_from) { conditions.push(`created_at >= $${pi++}`); params.push(date_from); }
    if (date_to) { conditions.push(`created_at <= $${pi++}`); params.push(date_to + ' 23:59:59'); }
    if (search) { conditions.push(`(user_email ILIKE $${pi} OR ip_address ILIKE $${pi})`); params.push(`%${search}%`); pi++; }
    if (statusFilter) { conditions.push(`status = $${pi++}`); params.push(statusFilter); }
    const where = conditions.join(' AND ');
    const [cr, lr] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM login_history WHERE ${where}`, params),
      pool.query(`SELECT * FROM login_history WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params),
    ]);
    const total = cr.rows[0].n;
    const rows = lr.rows;
    const totalPages = Math.ceil(total / limit) || 1;
    const cp = parseInt(page, 10);
    const extraQ = `&date_from=${esc(date_from || '')}&date_to=${esc(date_to || '')}&search=${esc(search || '')}&status=${esc(statusFilter || '')}`;

    let tableRows = '';
    if (!rows.length) {
      tableRows = '<tr><td colspan="9" class="s-empty">No login records found</td></tr>';
    } else {
      tableRows = rows.map((h) => `<tr>
        <td><div class="s-user-cell"><div class="s-avatar">${avatarLetter(h.user_email)}</div>${esc(h.user_email)}</div></td>
        <td>${statusBadge(h.status)}</td>
        <td>${methodBadge(h.login_method)}</td>
        <td>${deviceIcon(h.device_type)} ${esc(h.browser || '—')}</td>
        <td>${esc(h.os || '—')}</td>
        <td><code>${esc(h.ip_address)}</code></td>
        <td>${esc(h.location || '—')}</td>
        <td>${h.failure_reason ? `<span class="s-badge s-badge-red">${esc(h.failure_reason)}</span>` : ''}</td>
        <td>${new Date(h.created_at).toLocaleString()}</td>
      </tr>`).join('');
    }

    const body = `${CSS}
<div class="s-container">
  ${navBar('history')}
  <h1 class="s-page-title">📜 Login History</h1>
  <p class="s-subtitle">${total} total records</p>
  <form method="GET" class="s-flex" style="margin-bottom:20px">
    <input type="date" name="date_from" class="s-input" value="${esc(date_from || '')}">
    <input type="date" name="date_to" class="s-input" value="${esc(date_to || '')}">
    <input type="text" name="search" class="s-input" value="${esc(search || '')}" placeholder="Email or IP...">
    <select name="status" class="s-select">
      <option value="">All Status</option>
      <option value="success" ${statusFilter === 'success' ? 'selected' : ''}>Success</option>
      <option value="failed" ${statusFilter === 'failed' ? 'selected' : ''}>Failed</option>
    </select>
    <button type="submit" class="s-btn s-btn-primary s-btn-sm">Filter</button>
    ${(date_from || date_to || search || statusFilter) ? `<a href="/school/sessions/login-history" class="s-btn s-btn-outline s-btn-sm">Reset</a>` : ''}
  </form>
  <div class="s-table-wrap"><div class="s-table-scroll"><table class="s-table">
    <thead><tr><th>User</th><th>Status</th><th>Method</th><th>Browser</th><th>OS</th><th>IP</th><th>Location</th><th>Reason</th><th>Time</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table></div></div>
  <div class="s-flex" style="margin-top:16px">${paginationHtml(page, totalPages, extraQ)}</div>
</div>`;
    res.send(renderPage(req, res, body));
  }));

  // ---------- 7. Devices ----------
  app.get('/school/sessions/devices', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [dr, br, or] = await Promise.all([
      pool.query(`SELECT device_type, COUNT(*)::int AS cnt FROM user_sessions WHERE tenant_id=$1 AND expires_at > NOW() GROUP BY device_type ORDER BY cnt DESC`, [tid]),
      pool.query(`SELECT browser, COUNT(*)::int AS cnt FROM user_sessions WHERE tenant_id=$1 AND expires_at > NOW() GROUP BY browser ORDER BY cnt DESC LIMIT 8`, [tid]),
      pool.query(`SELECT os, COUNT(*)::int AS cnt FROM user_sessions WHERE tenant_id=$1 AND expires_at > NOW() GROUP BY os ORDER BY cnt DESC LIMIT 8`, [tid]),
    ]);
    const devices = dr.rows;
    const browsers = br.rows;
    const osList = or.rows;
    const total = devices.reduce((s, d) => s + d.cnt, 0) || 1;

    function barHtml(items) {
      const maxVal = Math.max(...items.map((i) => i.cnt), 1);
      return items.map((it) => {
        const label = it.device_type || it.browser || it.os || 'Unknown';
        const h = Math.max(4, Math.round((it.cnt / maxVal) * 160));
        return `<div class="s-bar-col">
          <div class="s-bar-val">${it.cnt}</div>
          <div class="s-bar" style="height:${h}px"></div>
          <div class="s-bar-label">${esc(label)}</div>
        </div>`;
      }).join('');
    }

    const body = `${CSS}
<div class="s-container">
  ${navBar('devices')}
  <h1 class="s-page-title">💻 Device Overview</h1>
  <p class="s-subtitle">Browser, OS, and device type breakdown for active sessions</p>

  <div class="s-section-title">Device Types</div>
  <div class="s-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-bottom:32px">
    ${devices.map((d) => `<div class="s-card" style="text-align:center">
      <div style="font-size:2.2rem;margin-bottom:6px">${deviceIcon(d.device_type)}</div>
      <div style="font-weight:600;margin-bottom:2px">${esc(deviceTypeLabel(d.device_type))}</div>
      <div class="s-card-value">${d.cnt}</div>
      <div class="s-card-label">${Math.round(d.cnt / total * 100)}% of sessions</div>
    </div>`).join('')}
  </div>

  <div class="s-section-title">Browsers</div>
  <div class="s-card" style="padding:20px;margin-bottom:32px"><div class="s-bar-chart">${barHtml(browsers)}</div></div>

  <div class="s-section-title">Operating Systems</div>
  <div class="s-card" style="padding:20px;margin-bottom:24px"><div class="s-bar-chart">${barHtml(osList)}</div></div>
</div>`;
    res.send(renderPage(req, res, body));
  }));

  // ---------- 8. Suspicious Logins ----------
  app.get('/school/sessions/suspicious', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [flaggedR, whitelistedR] = await Promise.all([
      pool.query(`SELECT * FROM suspicious_logins WHERE tenant_id=$1 AND is_whitelisted=false ORDER BY created_at DESC`, [tid]),
      pool.query(`SELECT * FROM suspicious_logins WHERE tenant_id=$1 AND is_whitelisted=true ORDER BY created_at DESC LIMIT 20`, [tid]),
    ]);
    const flagged = flaggedR.rows;
    const whitelisted = whitelistedR.rows;

    let flaggedHtml = '';
    if (!flagged.length) {
      flaggedHtml = '<tr><td colspan="6" class="s-empty">🟢 No suspicious logins detected — all clear!</td></tr>';
    } else {
      flaggedHtml = flagged.map((s) => `<tr>
        <td><div class="s-user-cell"><div class="s-avatar" style="background:var(--warning)">${avatarLetter(s.user_email)}</div>${esc(s.user_email)}</div></td>
        <td>${suspiciousReasonBadge(s.reason)}</td>
        <td><code>${esc(s.ip_address)}</code></td>
        <td>${esc(s.session_id ? s.session_id.substring(0, 16) + '…' : '—')}</td>
        <td>${new Date(s.created_at).toLocaleString()}</td>
        <td>
          <form method="POST" action="/school/sessions/suspicious/${s.id}/whitelist" style="display:inline" onsubmit="return confirm('Whitelist this login as safe?')">
            <button class="s-btn s-btn-success s-btn-sm">✅ Whitelist</button>
          </form>
          <form method="POST" action="/school/sessions/terminate-user/${encodeURIComponent(s.user_email)}" style="display:inline" onsubmit="return confirm('Force-logout all sessions for ${esc(s.user_email)}?')">
            <button class="s-btn s-btn-danger s-btn-sm">🚫 Logout User</button>
          </form>
        </td>
      </tr>`).join('');
    }

    let wlHtml = '';
    if (whitelisted.length) {
      wlHtml = whitelisted.map((s) => `<tr>
        <td>${esc(s.user_email)}</td>
        <td>${suspiciousReasonBadge(s.reason)}</td>
        <td><code>${esc(s.ip_address)}</code></td>
        <td>${new Date(s.created_at).toLocaleString()}</td>
        <td><span class="s-badge s-badge-green">Whitelisted</span></td>
      </tr>`).join('');
    }

    const body = `${CSS}
<div class="s-container">
  ${navBar('suspicious')}
  <h1 class="s-page-title">🚨 Suspicious Logins</h1>
  <p class="s-subtitle">${flagged.length} flagged login${flagged.length !== 1 ? 's' : ''} pending review</p>

  ${flagged.length > 0 ? `<div class="s-alert s-alert-danger">⚠️ ${flagged.length} suspicious login${flagged.length > 1 ? 's' : ''} need attention. Review and whitelist or terminate.</div>` : `<div class="s-alert s-alert-success">✅ No suspicious logins detected. Your security looks good!</div>`}

  <div class="s-table-wrap"><div class="s-table-scroll"><table class="s-table">
    <thead><tr><th>User</th><th>Reason</th><th>IP Address</th><th>Session</th><th>Detected</th><th>Actions</th></tr></thead>
    <tbody>${flaggedHtml}</tbody>
  </table></div></div>

  ${whitelisted.length > 0 ? `
    <div class="s-divider"></div>
    <div class="s-section-title">Previously Whitelisted</div>
    <div class="s-table-wrap"><div class="s-table-scroll" style="max-height:280px"><table class="s-table">
      <thead><tr><th>User</th><th>Reason</th><th>IP</th><th>Date</th><th>Status</th></tr></thead>
      <tbody>${wlHtml}</tbody>
    </table></div></div>` : ''}
</div>`;
    res.send(renderPage(req, res, body));
  }));

  // ---------- 9. Whitelist Suspicious Login ----------
  app.post('/school/sessions/suspicious/:id/whitelist', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const sid = parseInt(req.params.id, 10);
    const { rows } = await pool.query(`SELECT user_email FROM suspicious_logins WHERE id=$1 AND tenant_id=$2`, [sid, tid]);
    if (rows.length) {
      await pool.query(`UPDATE suspicious_logins SET is_whitelisted=true WHERE id=$1 AND tenant_id=$2`, [sid, tid]);
      audit(req, 'suspicious_whitelist', `Whitelisted suspicious login #${sid} for ${rows[0].user_email}`);
    }
    res.redirect('/school/sessions/suspicious');
  }));

  // ---------- 10. Geographic Distribution ----------
  app.get('/school/sessions/geo', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [sr, hr] = await Promise.all([
      pool.query(`SELECT location, COUNT(*)::int AS cnt, COUNT(DISTINCT user_email)::int AS users FROM user_sessions WHERE tenant_id=$1 AND expires_at > NOW() GROUP BY location ORDER BY cnt DESC LIMIT 15`, [tid]),
      pool.query(`SELECT location, COUNT(*)::int AS cnt, COUNT(DISTINCT user_email)::int AS users FROM login_history WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '30 days' GROUP BY location ORDER BY cnt DESC LIMIT 15`, [tid]),
    ]);
    const sessLocs = sr.rows;
    const histLocs = hr.rows;
    const sessMax = Math.max(...sessLocs.map((l) => l.cnt), 1);
    const histMax = Math.max(...histLocs.map((l) => l.cnt), 1);

    function geoBar(items, maxVal, color) {
      return items.map((it) => {
        const h = Math.max(4, Math.round((it.cnt / maxVal) * 160));
        return `<div class="s-bar-col">
          <div class="s-bar-val">${it.cnt}</div>
          <div class="s-bar" style="height:${h}px;background:${color}"></div>
          <div class="s-bar-label" title="${esc(it.location || 'Unknown')}">${esc(it.location || 'Unknown')}</div>
        </div>`;
      }).join('');
    }

    function geoTable(items) {
      if (!items.length) return '<div class="s-empty">No data</div>';
      return `<table class="s-table"><thead><tr><th>#</th><th>Location</th><th>Sessions</th><th>Users</th><th>%</th></tr></thead><tbody>` +
        items.map((it, i) => `<tr>
          <td>${i + 1}</td>
          <td>📍 ${esc(it.location || 'Unknown')}</td>
          <td><strong>${it.cnt}</strong></td>
          <td>${it.users}</td>
          <td>${Math.round(it.cnt / items.reduce((s, x) => s + x.cnt, 0) * 100)}%</td>
        </tr>`).join('') +
        '</tbody></table>';
    }

    const body = `${CSS}
<div class="s-container">
  ${navBar('geo')}
  <h1 class="s-page-title">🌍 Geographic Distribution</h1>
  <p class="s-subtitle">Login locations for active sessions and 30-day history</p>

  <div class="s-section-title">Active Sessions by Location</div>
  <div class="s-card" style="padding:20px;margin-bottom:12px"><div class="s-bar-chart">${geoBar(sessLocs, sessMax, 'var(--primary)')}</div></div>
  <div class="s-table-wrap" style="margin-bottom:32px">${geoTable(sessLocs)}</div>

  <div class="s-divider"></div>
  <div class="s-section-title">Login History (30 days) by Location</div>
  <div class="s-card" style="padding:20px;margin-bottom:12px"><div class="s-bar-chart">${geoBar(histLocs, histMax, 'var(--success)')}</div></div>
  <div class="s-table-wrap">${geoTable(histLocs)}</div>
</div>`;
    res.send(renderPage(req, res, body));
  }));

  // ---------- 11. Session Policy (GET) ----------
  app.get('/school/sessions/policy', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [pr, sr] = await Promise.all([
      pool.query(`SELECT * FROM session_policies WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM user_sessions WHERE tenant_id=$1 AND expires_at > NOW()`, [tid]),
    ]);
    const p = pr.rows[0] || {
      max_concurrent_sessions: 5, session_timeout_minutes: 60, max_devices_per_user: 3,
      enforce_ip_whitelist: false, allowed_ips: [], require_mfa_for_new_device: true,
    };
    const allowedIps = Array.isArray(p.allowed_ips) ? p.allowed_ips.join(', ') : '';
    const activeSessions = sr.rows[0].n;
    const ipChips = Array.isArray(p.allowed_ips)
      ? p.allowed_ips.map((ip) => `<span class="s-chip">${esc(ip)}</span>`).join('')
      : '<span class="s-badge s-badge-gray">None configured</span>';

    const body = `${CSS}
<div class="s-container">
  ${navBar('policy')}
  <h1 class="s-page-title">⚙️ Session Policy</h1>
  <p class="s-subtitle">Configure session timeout, concurrent limits, and device restrictions</p>

  <div class="s-alert s-alert-info">ℹ️ ${activeSessions} sessions currently active. Policy changes apply to new sessions.</div>

  <div class="s-card" style="max-width:640px">
    <form method="POST" action="/school/sessions/policy">
      <div class="s-form-group">
        <label class="s-form-label">Max Concurrent Sessions Per User</label>
        <input type="number" name="max_concurrent_sessions" class="s-input" style="width:140px" value="${esc(String(p.max_concurrent_sessions))}" min="1" max="50">
        <div class="s-form-hint">When exceeded, the oldest session is terminated (1–50)</div>
      </div>
      <div class="s-form-group">
        <label class="s-form-label">Session Timeout (minutes)</label>
        <input type="number" name="session_timeout_minutes" class="s-input" style="width:140px" value="${esc(String(p.session_timeout_minutes))}" min="5" max="1440">
        <div class="s-form-hint">Idle timeout before session expires (5–1440 minutes)</div>
      </div>
      <div class="s-form-group">
        <label class="s-form-label">Max Devices Per User</label>
        <input type="number" name="max_devices_per_user" class="s-input" style="width:140px" value="${esc(String(p.max_devices_per_user))}" min="1" max="20">
        <div class="s-form-hint">Maximum distinct devices a user can log in from (1–20)</div>
      </div>
      <div class="s-divider"></div>
      <div class="s-policy-row">
        <div>
          <div class="s-form-label">Enforce IP Whitelist</div>
          <div style="font-size:.78rem;color:var(--gray-400)">Restrict logins to allowed IP addresses only</div>
        </div>
        <label class="s-toggle">
          <input type="checkbox" name="enforce_ip_whitelist" value="true" ${p.enforce_ip_whitelist ? 'checked' : ''}>
          <span class="s-toggle-slider"></span>
        </label>
      </div>
      <div class="s-form-group">
        <label class="s-form-label">Allowed IPs</label>
        <input type="text" name="allowed_ips" class="s-input" style="width:100%" value="${esc(allowedIps)}" placeholder="e.g. 192.168.1.0/24, 10.0.0.1">
        <div class="s-form-hint">Comma-separated IP addresses or CIDR ranges</div>
        <div style="margin-top:6px">${ipChips}</div>
      </div>
      <div class="s-policy-row">
        <div>
          <div class="s-form-label">Require MFA for New Device</div>
          <div style="font-size:.78rem;color:var(--gray-400)">Prompt multi-factor authentication when an unrecognized device is detected</div>
        </div>
        <label class="s-toggle">
          <input type="checkbox" name="require_mfa_for_new_device" value="true" ${p.require_mfa_for_new_device ? 'checked' : ''}>
          <span class="s-toggle-slider"></span>
        </label>
      </div>
      <div style="margin-top:24px;display:flex;gap:10px">
        <button type="submit" class="s-btn s-btn-primary">💾 Save Policy</button>
        <button type="reset" class="s-btn s-btn-outline">↩ Reset</button>
      </div>
    </form>
  </div>
</div>`;
    res.send(renderPage(req, res, body));
  }));

  // ---------- 12. Session Policy (POST) ----------
  app.post('/school/sessions/policy', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const maxConcurrent = Math.min(50, Math.max(1, parseInt(req.body.max_concurrent_sessions, 10) || 5));
    const timeout = Math.min(1440, Math.max(5, parseInt(req.body.session_timeout_minutes, 10) || 60));
    const maxDevices = Math.min(20, Math.max(1, parseInt(req.body.max_devices_per_user, 10) || 3));
    const enforceIp = req.body.enforce_ip_whitelist === 'true';
    const rawIps = (req.body.allowed_ips || '').split(',').map((s) => s.trim()).filter(Boolean);
    const requireMfa = req.body.require_mfa_for_new_device === 'true';

    await pool.query(`
      INSERT INTO session_policies (tenant_id, max_concurrent_sessions, session_timeout_minutes, max_devices_per_user, enforce_ip_whitelist, allowed_ips, require_mfa_for_new_device, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET
        max_concurrent_sessions=$2, session_timeout_minutes=$3, max_devices_per_user=$4,
        enforce_ip_whitelist=$5, allowed_ips=$6, require_mfa_for_new_device=$7, updated_at=NOW()`,
      [tid, maxConcurrent, timeout, maxDevices, enforceIp, rawIps, requireMfa]);

    audit(req, 'session_policy_update',
      `Updated session policy: timeout=${timeout}m, maxConcurrent=${maxConcurrent}, maxDevices=${maxDevices}, enforceIp=${enforceIp}, requireMfa=${requireMfa}`);
    res.redirect('/school/sessions/policy');
  }));

  // ---------- 13. API: Session Stats (JSON) ----------
  app.get('/school/sessions/api/stats', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [ac, uc, sc] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM user_sessions WHERE tenant_id=$1 AND expires_at > NOW()`, [tid]),
      pool.query(`SELECT COUNT(DISTINCT user_email)::int AS n FROM user_sessions WHERE tenant_id=$1 AND expires_at > NOW()`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM suspicious_logins WHERE tenant_id=$1 AND is_whitelisted=false`, [tid]),
    ]);
    res.json({
      activeSessions: ac.rows[0].n,
      uniqueUsers: uc.rows[0].n,
      suspiciousLogins: sc.rows[0].n,
      timestamp: new Date().toISOString(),
    });
  }));

  console.log('[session-manager] ✅ 13 routes registered under /school/sessions');
};
