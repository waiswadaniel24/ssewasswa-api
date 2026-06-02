/**
 * CAPTCHA Configuration Module — School SaaS Portal
 * Manage CAPTCHA providers, settings, verification logs, and widget previews.
 *
 * Usage:
 *   const captchaModule = require('./captcha-config');
 *   captchaModule(app, pool, { esc, renderPage, ah, requireAuth, audit });
 */

const { migrateQuery } = require('./db');
module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || ((fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  /* ─────────────────────── Constants ─────────────────────── */
  const PROVIDERS = [
    { id: 'recaptcha_v2', name: 'reCAPTCHA v2', type: 'Checkbox', free: true, score: false, description: 'Classic "I am not a robot" checkbox challenge.' },
    { id: 'recaptcha_v3', name: 'reCAPTCHA v3', type: 'Invisible', free: true, score: true, description: 'Invisible verification returning a risk score (0-1).' },
    { id: 'hcaptcha', name: 'hCaptcha', type: 'Checkbox', free: true, score: false, description: 'Privacy-focused CAPTCHA, GDPR compliant.' },
    { id: 'turnstile', name: 'Cloudflare Turnstile', type: 'Invisible', free: true, score: true, description: 'Serverless smart CAPTCHA by Cloudflare.' },
    { id: 'arkose', name: 'Arkose Labs FunCaptcha', type: 'Interactive', free: false, score: false, description: 'Enterprise puzzle-based fraud prevention.' }
  ];

  const THEMES = ['dark', 'light'];
  const SIZES = ['normal', 'compact', 'invisible'];
  const FAIL_ACTIONS = ['block', 'warn', 'challenge'];
  const PAGES = ['login', 'register', 'contact', 'password_reset', 'checkout', 'api', 'comment', 'form_submit'];

  /* ─────────────────────── DB migrations ─────────────────────── */
  (async function migrate() {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS captcha_settings (
          id SERIAL PRIMARY KEY,
          provider TEXT DEFAULT 'recaptcha_v2',
          site_key TEXT,
          secret_key TEXT,
          min_score FLOAT DEFAULT 0.5,
          enabled_pages JSONB DEFAULT '["login","register","contact"]',
          theme TEXT DEFAULT 'dark',
          size TEXT DEFAULT 'normal',
          is_active BOOLEAN DEFAULT true,
          fail_action TEXT DEFAULT 'block',
          custom_html TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ,
          school_id INT DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS captcha_verification_log (
          id SERIAL PRIMARY KEY,
          provider TEXT,
          action TEXT DEFAULT 'verify',
          ip_address TEXT,
          score FLOAT,
          success BOOLEAN,
          error_message TEXT,
          response_time_ms INT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          school_id INT DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_captcha_vlog_school ON captcha_verification_log(school_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_captcha_vlog_success ON captcha_verification_log(school_id, success);
        CREATE INDEX IF NOT EXISTS idx_captcha_settings_school ON captcha_settings(school_id);
      `);
      console.log('[captcha-config] Migrations complete.');
    } finally {
      client.release();
    }
  })().catch(() => {});

  /* ─────────────────────── Shared UI styles (dark theme) ─────────────────────── */
  const STYLE = `
    <style>
      :root{--bg:#0f172a;--bg-card:#1e293b;--bg-hover:#334155;--border:#334155;--text:#e2e8f0;--text-dim:#94a3b8;--accent:#3b82f6;--accent-hover:#2563eb;--danger:#ef4444;--success:#10b981;--warn:#f59e0b;--radius:10px}
      *{box-sizing:border-box;margin:0;padding:0}
      .cc-wrap{max-width:1100px;margin:0 auto;padding:24px 16px;font-family:system-ui,-apple-system,sans-serif;color:var(--text)}
      .cc-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:24px;margin-bottom:20px}
      .cc-card h2{margin:0 0 16px;font-size:1.3rem;color:#f1f5f9}
      .cc-card h3{margin:0 0 10px;font-size:1.05rem;color:#cbd5e1}
      .cc-btn{display:inline-block;padding:10px 20px;border-radius:6px;border:none;cursor:pointer;font-size:.9rem;font-weight:600;text-decoration:none;transition:all .15s}
      .cc-btn-primary{background:var(--accent);color:#fff}.cc-btn-primary:hover{background:var(--accent-hover)}
      .cc-btn-danger{background:var(--danger);color:#fff}.cc-btn-danger:hover{background:#dc2626}
      .cc-btn-outline{background:transparent;border:1px solid var(--border);color:var(--text-dim)}.cc-btn-outline:hover{background:var(--bg-hover);color:#fff}
      .cc-btn-success{background:var(--success);color:#fff}.cc-btn-success:hover{background:#059669}
      .cc-btn-warn{background:var(--warn);color:#000}.cc-btn-warn:hover{background:#d97706}
      .cc-btn:disabled{opacity:.5;cursor:not-allowed}
      .cc-tabs{display:flex;gap:4px;border-bottom:2px solid var(--border);margin-bottom:24px;flex-wrap:wrap}
      .cc-tab{padding:10px 16px;cursor:pointer;border:none;background:none;font-size:.9rem;color:var(--text-dim);border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s}
      .cc-tab.active{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}
      .cc-tab:hover{color:var(--accent)}
      .cc-table{width:100%;border-collapse:collapse;font-size:.88rem}
      .cc-table th{text-align:left;padding:10px 12px;background:#0f172a;font-weight:600;color:var(--text-dim);border-bottom:2px solid var(--border)}
      .cc-table td{padding:10px 12px;border-bottom:1px solid var(--border)}
      .cc-table tr:hover td{background:var(--bg-hover)}
      .cc-badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:.78rem;font-weight:600}
      .cc-badge-green{background:#065f46;color:#6ee7b7}
      .cc-badge-red{background:#7f1d1d;color:#fca5a5}
      .cc-badge-yellow{background:#78350f;color:#fcd34d}
      .cc-badge-blue{background:#1e3a5f;color:#93c5fd}
      .cc-input{padding:10px 14px;border:1px solid var(--border);border-radius:6px;font-size:.9rem;width:100%;max-width:380px;box-sizing:border-box;background:#0f172a;color:var(--text)}
      .cc-input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(59,130,246,.2)}
      .cc-select{padding:10px 14px;border:1px solid var(--border);border-radius:6px;font-size:.9rem;background:#0f172a;color:var(--text);min-width:180px}
      .cc-select:focus{outline:none;border-color:var(--accent)}
      .cc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
      .cc-stat{text-align:center;padding:20px}
      .cc-stat .num{font-size:2rem;font-weight:700;color:var(--accent)}
      .cc-stat .lbl{font-size:.82rem;color:var(--text-dim);margin-top:4px}
      .cc-flash{padding:12px 16px;border-radius:6px;margin-bottom:16px;font-size:.9rem}
      .cc-flash-ok{background:#065f46;color:#6ee7b7}
      .cc-flash-err{background:#7f1d1d;color:#fca5a5}
      .cc-flash-warn{background:#78350f;color:#fcd34d}
      .cc-empty{text-align:center;padding:32px;color:var(--text-dim);font-size:.92rem}
      .cc-toggle{position:relative;display:inline-block;width:52px;height:28px}
      .cc-toggle input{opacity:0;width:0;height:0}
      .cc-toggle .slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#475569;transition:.3s;border-radius:28px}
      .cc-toggle .slider:before{position:absolute;content:"";height:22px;width:22px;left:3px;bottom:3px;background:#fff;transition:.3s;border-radius:50%}
      .cc-toggle input:checked+.slider{background:var(--accent)}
      .cc-toggle input:checked+.slider:before{transform:translateX(24px)}
      .cc-mono{font-family:'SF Mono',Consolas,'Courier New',monospace;font-size:.88rem;background:#0f172a;padding:6px 10px;border-radius:4px;word-break:break-all}
      .cc-check{margin-right:6px}
      .cc-bar{height:8px;background:#1e293b;border-radius:4px;overflow:hidden}
      .cc-bar-fill{height:100%;border-radius:4px;transition:width .4s}
      .cc-provider-card{border:1px solid var(--border);border-radius:var(--radius);padding:20px;background:var(--bg-card);transition:border-color .2s}
      .cc-provider-card:hover{border-color:var(--accent)}
      .cc-provider-card.selected{border-color:var(--accent);box-shadow:0 0 0 2px rgba(59,130,246,.3)}
      .cc-preview-box{border:2px dashed var(--border);border-radius:var(--radius);padding:40px;text-align:center;min-height:180px;display:flex;align-items:center;justify-content:center;flex-direction:column}
      @media(max-width:640px){.cc-grid{grid-template-columns:1fr}.cc-tabs{gap:0}.cc-tab{padding:8px 10px;font-size:.82rem}}
    </style>
    <link rel="stylesheet" href="/css/sk.css">
  `;

  /* ─────────────────────── Shared UI helpers ─────────────────────── */
  const BASE = '/admin/captcha';

  function navTabs(active) {
    const tabs = [
      [BASE, 'Dashboard'],
      [BASE + '/settings', 'Settings'],
      [BASE + '/logs', 'Logs'],
      [BASE + '/providers', 'Providers'],
      [BASE + '/widget-preview', 'Widget Preview']
    ];
    return '<nav class="cc-tabs">' + tabs.map(([href, label]) =>
      '<a class="cc-tab' + (active === href ? ' active' : '') + '" href="' + href + '">' + esc(label) + '</a>'
    ).join('') + '</nav>';
  }

  function flashMsg(type, msg) {
    if (!msg) return '';
    const cls = type === 'error' ? 'err' : type === 'warn' ? 'warn' : 'ok';
    return '<div class="cc-flash cc-flash-' + cls + '">' + esc(msg) + '</div>';
  }

  function toggleHtml(name, checked, label) {
    return '<label class="cc-toggle" title="' + esc(label) + '"><input type="checkbox" name="' + esc(name) + '" ' + (checked ? 'checked' : '') + '><span class="slider"></span></label>';
  }

  function maskKey(key) {
    if (!key) return '••••••••';
    if (key.length <= 8) return '••••••••';
    return key.slice(0, 4) + '••••••••' + key.slice(-4);
  }

  async function getSettings(schoolId) {
    const r = await pool.query('SELECT * FROM captcha_settings WHERE school_id=$1 ORDER BY id DESC LIMIT 1', [schoolId]);
    return r.rows[0] || null;
  }

  async function ensureSettings(schoolId) {
    let s = await getSettings(schoolId);
    if (!s) {
      await pool.query('INSERT INTO captcha_settings (school_id) VALUES ($1)', [schoolId]);
      s = await getSettings(schoolId);
    }
    return s;
  }

  async function insertLog(data) {
    await pool.query(
      'INSERT INTO captcha_verification_log (school_id, provider, action, ip_address, score, success, error_message, response_time_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [data.school_id, data.provider, data.action || 'verify', data.ip, data.score, data.success, data.error, data.ms]
    );
  }

  /* ═══════════════════════ ROUTES ═══════════════════════ */

  /* ── 1. GET /admin/captcha — Configuration dashboard ───── */
  app.get(BASE, requireAuth, ah(async (req, res) => {
    const schoolId = req.session.user?.school_id || 1;
    const settings = await ensureSettings(schoolId);

    const statsRes = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE success=true) as passed,
        COUNT(*) FILTER (WHERE success=false) as failed,
        ROUND(AVG(score) FILTER (WHERE score IS NOT NULL)::numeric, 2) as avg_score,
        ROUND(AVG(response_time_ms)::numeric, 0) as avg_ms
      FROM captcha_verification_log WHERE school_id=$1 AND created_at > NOW() - INTERVAL '7 days')
    `, [schoolId]);
    const st = statsRes.rows[0];

    const recentRes = await pool.query(
      'SELECT id, provider, action, ip_address, score, success, error_message, response_time_ms, created_at FROM captcha_verification_log WHERE school_id=$1 ORDER BY created_at DESC LIMIT 8',
      [schoolId]
    );

    const passRate = st.total > 0 ? Math.round((st.passed / st.total) * 100) : 100;

    let content = STYLE + navTabs(BASE);
    content += '<h1 style="margin-bottom:20px;font-size:1.5rem">CAPTCHA Configuration</h1>';

    /* Stats row */
    content += '<div class="cc-grid">';
    content += '<div class="cc-card cc-stat"><div class="num">' + st.total + '</div><div class="lbl">Verifications (7d)</div></div>';
    content += '<div class="cc-card cc-stat"><div class="num" style="color:var(--success)">' + passRate + '%</div><div class="lbl">Pass Rate</div></div>';
    content += '<div class="cc-card cc-stat"><div class="num">' + (st.avg_score || '—') + '</div><div class="lbl">Avg Score</div></div>';
    content += '<div class="cc-card cc-stat"><div class="num">' + (st.avg_ms || '—') + '</div><div class="lbl">Avg Response (ms)</div></div>';
    content += '</div>';

    /* Current config summary */
    content += '<div class="cc-card"><h2>Current Configuration</h2>';
    content += '<table class="cc-table"><tbody>';
    content += '<tr><td style="font-weight:600;width:200px">Provider</td><td>' + esc(settings.provider || 'recaptcha_v2') + '</td></tr>';
    content += '<tr><td style="font-weight:600">Status</td><td>' + (settings.is_active
      ? '<span class="cc-badge cc-badge-green">Active</span>'
      : '<span class="cc-badge cc-badge-red">Inactive</span>') + '</td></tr>';
    content += '<tr><td style="font-weight:600">Site Key</td><td><code class="cc-mono">' + maskKey(settings.site_key) + '</code></td></tr>';
    content += '<tr><td style="font-weight:600">Secret Key</td><td><code class="cc-mono">' + maskKey(settings.secret_key) + '</code></td></tr>';
    content += '<tr><td style="font-weight:600">Min Score</td><td>' + (settings.min_score || 0.5) + '</td></tr>';
    content += '<tr><td style="font-weight:600">Theme</td><td>' + esc(settings.theme || 'dark') + '</td></tr>';
    content += '<tr><td style="font-weight:600">Size</td><td>' + esc(settings.size || 'normal') + '</td></tr>';
    content += '<tr><td style="font-weight:600">Fail Action</td><td>' + esc(settings.fail_action || 'block') + '</td></tr>';
    content += '<tr><td style="font-weight:600">Enabled Pages</td><td>' + esc(JSON.stringify(settings.enabled_pages || [])) + '</td></tr>';
    content += '<tr><td style="font-weight:600">Last Updated</td><td>' + (settings.updated_at ? esc(new Date(settings.updated_at).toLocaleString()) : 'Never') + '</td></tr>';
    content += '</tbody></table>';
    content += '<div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">';
    content += '<a class="cc-btn cc-btn-primary" href="' + BASE + '/settings">Edit Settings</a>';
    content += '<a class="cc-btn cc-btn-outline" href="' + BASE + '/providers">Compare Providers</a>';
    content += '<a class="cc-btn cc-btn-outline" href="' + BASE + '/widget-preview">Widget Preview</a>';
    content += '</div></div>';

    /* Recent activity */
    content += '<div class="cc-card"><h2>Recent Activity</h2>';
    if (recentRes.rows.length === 0) {
      content += '<div class="cc-empty">No verification attempts recorded yet.</div>';
    } else {
      content += '<div style="overflow-x:auto"><table class="cc-table"><thead><tr><th>ID</th><th>Provider</th><th>Action</th><th>Score</th><th>Result</th><th>IP</th><th>MS</th><th>Time</th></tr></thead><tbody>';
      for (const r of recentRes.rows) {
        content += '<tr>';
        content += '<td>#' + r.id + '</td>';
        content += '<td>' + esc(r.provider) + '</td>';
        content += '<td>' + esc(r.action) + '</td>';
        content += '<td>' + (r.score !== null ? r.score.toFixed(2) : '—') + '</td>';
        content += '<td><span class="cc-badge ' + (r.success ? 'cc-badge-green' : 'cc-badge-red') + '">' + (r.success ? 'Pass' : 'Fail') + '</span></td>';
        content += '<td>' + esc(r.ip_address || '—') + '</td>';
        content += '<td>' + (r.response_time_ms || '—') + '</td>';
        content += '<td>' + esc(new Date(r.created_at).toLocaleString()) + '</td>';
        content += '</tr>';
      }
      content += '</tbody></table></div>';
    }
    content += '</div>';

    res.send(renderPage('CAPTCHA Dashboard', content, req.session.user));
  }));

  /* ── 2. PUT /admin/captcha/settings — Update settings ──── */
  app.put(BASE + '/settings', requireAuth, ah(async (req, res) => {
    const schoolId = req.session.user?.school_id || 1;
    const { provider, site_key, secret_key, min_score, enabled_pages, theme, size, is_active, fail_action, custom_html } = req.body;

    if (provider && !PROVIDERS.find(p => p.id === provider)) {
      return res.status(400).json({ error: 'Invalid provider: ' + provider });
    }
    if (theme && !THEMES.includes(theme)) {
      return res.status(400).json({ error: 'Invalid theme: ' + theme });
    }
    if (size && !SIZES.includes(size)) {
      return res.status(400).json({ error: 'Invalid size: ' + size });
    }
    if (fail_action && !FAIL_ACTIONS.includes(fail_action)) {
      return res.status(400).json({ error: 'Invalid fail_action: ' + fail_action });
    }

    await ensureSettings(schoolId);

    let pages = enabled_pages;
    if (typeof pages === 'string') {
      try { pages = JSON.parse(pages); } catch (_) { pages = ['login', 'register', 'contact']; }
    }
    if (!Array.isArray(pages)) pages = ['login', 'register', 'contact'];

    await pool.query(
      `UPDATE captcha_settings SET
        provider=COALESCE($1,provider),
        site_key=COALESCE($2,site_key),
        secret_key=COALESCE($3,secret_key),
        min_score=COALESCE($4,min_score),
        enabled_pages=$5,
        theme=COALESCE($6,theme),
        size=COALESCE($7,size),
        is_active=COALESCE($8,is_active),
        fail_action=COALESCE($9,fail_action),
        custom_html=$10,
        updated_at=NOW()
      WHERE school_id=$11`,
      [provider, site_key, secret_key, min_score !== undefined ? parseFloat(min_score) : null, JSON.stringify(pages), theme, size, is_active !== undefined ? is_active : null, fail_action, custom_html || null, schoolId]
    );

    audit({ action: 'captcha_settings_updated', schoolId, provider });
    res.json({ success: true, message: 'CAPTCHA settings updated.' });
  }));

  /* ── 3. POST /admin/captcha/test — Test config ─────────── */
  app.post(BASE + '/test', requireAuth, ah(async (req, res) => {
    const schoolId = req.session.user?.school_id || 1;
    const settings = await ensureSettings(schoolId);
    const provider = settings.provider || 'recaptcha_v2';
    const siteKey = settings.site_key;
    const secretKey = settings.secret_key;

    if (!siteKey || !secretKey) {
      await insertLog({ school_id: schoolId, provider, action: 'test', ip: req.ip, score: null, success: false, error: 'Missing site_key or secret_key', ms: 0 });
      return res.json({ success: false, error: 'Site key and secret key are required before testing.' });
    }

    const startMs = Date.now();
    let success = false;
    let errorMsg = '';

    if (provider === 'recaptcha_v3') {
      try {
        const https = require('https');
        const result = await new Promise((resolve, reject) => {
          const data = 'secret=' + encodeURIComponent(secretKey) + '&response=test_token';
          const urlReq = https.request({
            hostname: 'www.google.com',
            path: '/recaptcha/api/siteverify',
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) }
          }, (urlRes) => {
            let body = '';
            urlRes.on('data', chunk => body += chunk);
            urlRes.on('end', () => resolve(JSON.parse(body)));
          });
          urlReq.on('error', reject);
          urlReq.write(data);
          urlReq.end();
        });
        if (result.success) {
          success = true;
        } else {
          errorMsg = (result['error-codes'] || []).join(', ');
        }
      } catch (e) {
        errorMsg = e.message;
      }
    } else {
      /* For non-v3, we simulate a config check */
      success = siteKey.length > 5 && secretKey.length > 5;
      if (!success) errorMsg = 'Keys appear too short. Verify they are correct.';
    }

    const elapsed = Date.now() - startMs;
    await insertLog({ school_id: schoolId, provider, action: 'test', ip: req.ip, score: null, success, error: errorMsg, ms: elapsed });

    res.json({ success, error: errorMsg, response_time_ms: elapsed, provider });
  }));

  /* ── 4. GET /admin/captcha/logs — Verification logs ────── */
  app.get(BASE + '/logs', requireAuth, ah(async (req, res) => {
    const schoolId = req.session.user?.school_id || 1;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 30;
    const offset = (page - 1) * limit;
    const filterSuccess = req.query.success;

    let where = 'WHERE school_id=$1';
    const params = [schoolId];
    if (filterSuccess === 'true' || filterSuccess === 'false') {
      where += ' AND success=$' + (params.length + 1);
      params.push(filterSuccess === 'true');
    }

    const countRes = await pool.query('SELECT COUNT(*) as total FROM captcha_verification_log ' + where, params);
    const total = parseInt(countRes.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    const logRes = await pool.query(
      'SELECT * FROM captcha_verification_log ' + where + ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2),
      [...params, limit, offset]
    );

    let content = STYLE + navTabs(BASE + '/logs');
    content += '<div class="cc-card"><h2>Verification Logs</h2>';

    /* Filters */
    content += '<div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
    content += '<span style="font-size:.85rem;color:var(--text-dim)">Filter:</span>';
    content += '<a class="cc-btn cc-btn-outline' + (!filterSuccess ? ' active' : '') + '" href="' + BASE + '/logs">All (' + total + ')</a>';
    const passCount = await pool.query('SELECT COUNT(*) as c FROM captcha_verification_log WHERE school_id=$1 AND success=true', [schoolId]);
    const failCount = await pool.query('SELECT COUNT(*) as c FROM captcha_verification_log WHERE school_id=$1 AND success=false', [schoolId]);
    content += '<a class="cc-btn cc-btn-outline" href="' + BASE + '/logs?success=true" style="color:var(--success)">Passed (' + passCount.rows[0].c + ')</a>';
    content += '<a class="cc-btn cc-btn-outline" href="' + BASE + '/logs?success=false" style="color:var(--danger)">Failed (' + failCount.rows[0].c + ')</a>';
    content += '</div>';

    if (logRes.rows.length === 0) {
      content += '<div class="cc-empty">No verification logs found.</div>';
    } else {
      content += '<div style="overflow-x:auto"><table class="cc-table"><thead><tr><th>ID</th><th>Provider</th><th>Action</th><th>IP</th><th>Score</th><th>Result</th><th>Error</th><th>MS</th><th>Time</th></tr></thead><tbody>';
      for (const r of logRes.rows) {
        content += '<tr>';
        content += '<td>#' + r.id + '</td>';
        content += '<td>' + esc(r.provider) + '</td>';
        content += '<td>' + esc(r.action) + '</td>';
        content += '<td>' + esc(r.ip_address || '—') + '</td>';
        content += '<td>' + (r.score !== null ? r.score.toFixed(2) : '—') + '</td>';
        content += '<td><span class="cc-badge ' + (r.success ? 'cc-badge-green' : 'cc-badge-red') + '">' + (r.success ? 'Pass' : 'Fail') + '</span></td>';
        content += '<td title="' + esc(r.error_message || '') + '">' + esc((r.error_message || '').slice(0, 40)) + '</td>';
        content += '<td>' + (r.response_time_ms || '—') + '</td>';
        content += '<td>' + esc(new Date(r.created_at).toLocaleString()) + '</td>';
        content += '</tr>';
      }
      content += '</tbody></table></div>';
    }

    /* Pagination */
    if (totalPages > 1) {
      content += '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
      content += '<span style="font-size:.85rem;color:var(--text-dim)">Page ' + page + ' of ' + totalPages + '</span>';
      if (page > 1) content += '<a class="cc-btn cc-btn-outline" href="' + BASE + '/logs?page=' + (page - 1) + (filterSuccess ? '&success=' + filterSuccess : '') + '">&laquo; Prev</a>';
      if (page < totalPages) content += '<a class="cc-btn cc-btn-outline" href="' + BASE + '/logs?page=' + (page + 1) + (filterSuccess ? '&success=' + filterSuccess : '') + '">Next &raquo;</a>';
      content += '</div>';
    }

    content += '<div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">';
    content += '<a class="cc-btn cc-btn-outline" href="' + BASE + '/export/logs">Export CSV</a>';
    content += '<form method="POST" action="' + BASE + '/cleanup-logs" style="display:inline" onsubmit="return confirm(\'Delete logs older than 30 days?\')">';
    content += '<button class="cc-btn cc-btn-danger" type="submit">Cleanup Old Logs</button></form>';
    content += '</div>';

    content += '</div>';
    res.send(renderPage('CAPTCHA Logs', content, req.session.user));
  }));

  /* ── 5. GET /admin/captcha/stats — Verification statistics ─ */
  app.get(BASE + '/stats', requireAuth, ah(async (req, res) => {
    const schoolId = req.session.user?.school_id || 1;

    const overallRes = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE success=true) as passed,
        COUNT(*) FILTER (WHERE success=false) as failed,
        ROUND(AVG(score) FILTER (WHERE score IS NOT NULL)::numeric, 3) as avg_score,
        ROUND(MIN(score) FILTER (WHERE score IS NOT NULL)::numeric, 3) as min_score,
        ROUND(MAX(score) FILTER (WHERE score IS NOT NULL)::numeric, 3) as max_score,
        ROUND(AVG(response_time_ms)::numeric, 0) as avg_ms
      FROM captcha_verification_log WHERE school_id=$1
    `, [schoolId]);
    const o = overallRes.rows[0];

    const byProviderRes = await pool.query(`
      SELECT provider, COUNT(*) as total, COUNT(*) FILTER (WHERE success=true) as passed,
             ROUND(AVG(score) FILTER (WHERE score IS NOT NULL)::numeric, 3) as avg_score
      FROM captcha_verification_log WHERE school_id=$1 GROUP BY provider ORDER BY total DESC
    `, [schoolId]);

    const dailyRes = await pool.query(`
      SELECT DATE(created_at) as day, COUNT(*) as total,
             COUNT(*) FILTER (WHERE success=true) as passed,
             ROUND(AVG(score) FILTER (WHERE score IS NOT NULL)::numeric, 3) as avg_score
      FROM captcha_verification_log WHERE school_id=$1 AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at) ORDER BY day DESC
    `, [schoolId]);

    const passRate = o.total > 0 ? Math.round((o.passed / o.total) * 100) : 0;
    const failRate = o.total > 0 ? 100 - passRate : 0;

    let content = STYLE + navTabs(BASE);
    content += '<div class="cc-card"><h2>Verification Statistics</h2>';

    /* Overall stats */
    content += '<h3>Overall Performance</h3>';
    content += '<div class="cc-grid" style="margin-bottom:20px">';
    content += '<div class="cc-card cc-stat"><div class="num">' + o.total + '</div><div class="lbl">Total Verifications</div></div>';
    content += '<div class="cc-card cc-stat"><div class="num" style="color:var(--success)">' + o.passed + '</div><div class="lbl">Passed</div></div>';
    content += '<div class="cc-card cc-stat"><div class="num" style="color:var(--danger)">' + o.failed + '</div><div class="lbl">Failed</div></div>';
    content += '<div class="cc-card cc-stat"><div class="num">' + passRate + '%</div><div class="lbl">Pass Rate</div></div>';
    content += '<div class="cc-card cc-stat"><div class="num">' + (o.avg_score || '—') + '</div><div class="lbl">Avg Score</div></div>';
    content += '<div class="cc-card cc-stat"><div class="num">' + (o.avg_ms || '—') + '</div><div class="lbl">Avg Response (ms)</div></div>';
    content += '</div>';

    /* Pass/fail bar */
    content += '<div style="margin-bottom:24px">';
    content += '<div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:.85rem"><span style="color:var(--success)">Pass: ' + passRate + '%</span><span style="color:var(--danger)">Fail: ' + failRate + '%</span></div>';
    content += '<div class="cc-bar" style="display:flex"><div class="cc-bar-fill" style="width:' + passRate + '%;background:var(--success)"></div><div class="cc-bar-fill" style="width:' + failRate + '%;background:var(--danger)"></div></div>';
    content += '</div>';

    /* By provider */
    if (byProviderRes.rows.length > 0) {
      content += '<h3>By Provider</h3>';
      content += '<div style="overflow-x:auto"><table class="cc-table"><thead><tr><th>Provider</th><th>Total</th><th>Passed</th><th>Pass Rate</th><th>Avg Score</th></tr></thead><tbody>';
      for (const p of byProviderRes.rows) {
        const pr = p.total > 0 ? Math.round((p.passed / p.total) * 100) : 0;
        content += '<tr><td><span class="cc-badge cc-badge-blue">' + esc(p.provider) + '</span></td>';
        content += '<td>' + p.total + '</td><td>' + p.passed + '</td>';
        content += '<td><div class="cc-bar" style="width:120px;display:inline-block;vertical-align:middle;margin-right:8px"><div class="cc-bar-fill" style="width:' + pr + '%;background:var(--accent)"></div></div>' + pr + '%</td>';
        content += '<td>' + (p.avg_score || '—') + '</td></tr>';
      }
      content += '</tbody></table></div>';
    }

    /* Daily breakdown */
    if (dailyRes.rows.length > 0) {
      content += '<h3 style="margin-top:24px">Daily Breakdown (Last 30 Days)</h3>';
      content += '<div style="overflow-x:auto"><table class="cc-table"><thead><tr><th>Date</th><th>Total</th><th>Passed</th><th>Pass Rate</th><th>Avg Score</th></tr></thead><tbody>';
      for (const d of dailyRes.rows) {
        const pr = d.total > 0 ? Math.round((d.passed / d.total) * 100) : 0;
        content += '<tr><td>' + esc(d.day) + '</td><td>' + d.total + '</td><td>' + d.passed + '</td>';
        content += '<td>' + pr + '%</td><td>' + (d.avg_score || '—') + '</td></tr>';
      }
      content += '</tbody></table></div>';
    }

    /* Score distribution */
    const scoreDistRes = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE score >= 0.9) as high,
        COUNT(*) FILTER (WHERE score >= 0.5 AND score < 0.9) as medium,
        COUNT(*) FILTER (WHERE score >= 0.1 AND score < 0.5) as low,
        COUNT(*) FILTER (WHERE score < 0.1) as very_low
      FROM captcha_verification_log WHERE school_id=$1 AND score IS NOT NULL
    `, [schoolId]);
    const sd = scoreDistRes.rows[0];
    const scoreTotal = parseInt(sd.high) + parseInt(sd.medium) + parseInt(sd.low) + parseInt(sd.very_low);

    content += '<h3 style="margin-top:24px">Score Distribution</h3>';
    content += '<div style="display:flex;gap:12px;flex-wrap:wrap">';
    const distItems = [
      { label: 'High (0.9-1.0)', val: sd.high, color: 'var(--success)' },
      { label: 'Medium (0.5-0.9)', val: sd.medium, color: 'var(--accent)' },
      { label: 'Low (0.1-0.5)', val: sd.low, color: 'var(--warn)' },
      { label: 'Very Low (<0.1)', val: sd.very_low, color: 'var(--danger)' }
    ];
    for (const item of distItems) {
      const pct = scoreTotal > 0 ? Math.round((parseInt(item.val) / scoreTotal) * 100) : 0;
      content += '<div style="flex:1;min-width:140px;background:var(--bg);border-radius:8px;padding:14px">';
      content += '<div style="font-size:.8rem;color:var(--text-dim)">' + item.label + '</div>';
      content += '<div style="font-size:1.4rem;font-weight:700;margin:4px 0;color:' + item.color + '">' + item.val + '</div>';
      content += '<div class="cc-bar"><div class="cc-bar-fill" style="width:' + pct + '%;background:' + item.color + '"></div></div>';
      content += '<div style="font-size:.78rem;color:var(--text-dim);margin-top:4px">' + pct + '%</div>';
      content += '</div>';
    }
    content += '</div>';

    content += '</div>';
    res.send(renderPage('CAPTCHA Statistics', content, req.session.user));
  }));

  /* ── 6. POST /admin/captcha/toggle — Enable/disable ────── */
  app.post(BASE + '/toggle', requireAuth, ah(async (req, res) => {
    const schoolId = req.session.user?.school_id || 1;
    const { is_active } = req.body;

    await ensureSettings(schoolId);
    const newActive = is_active !== 'false' && is_active !== false && is_active !== 0;
    await pool.query('UPDATE captcha_settings SET is_active=$1, updated_at=NOW() WHERE school_id=$2', [newActive, schoolId]);

    audit({ action: 'captcha_toggled', schoolId, is_active: newActive });
    await insertLog({ school_id: schoolId, provider: 'system', action: 'toggle', ip: req.ip, score: null, success: true, error: '', ms: 0 });

    const redirect = req.query.redirect || BASE;
    res.redirect(redirect + '?flash_type=ok&flash=CAPTCHA+' + (newActive ? 'enabled' : 'disabled') + '+successfully.');
  }));

  /* ── 7. GET /admin/captcha/providers — Provider comparison ─ */
  app.get(BASE + '/providers', requireAuth, ah(async (req, res) => {
    const schoolId = req.session.user?.school_id || 1;
    const settings = await ensureSettings(schoolId);
    const currentProvider = settings.provider || 'recaptcha_v2';

    let content = STYLE + navTabs(BASE + '/providers');
    content += '<div class="cc-card"><h2>Available Providers</h2>';
    content += '<p style="color:var(--text-dim);margin-bottom:20px;font-size:.9rem">Compare CAPTCHA providers and choose the best fit for your needs.</p>';

    content += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">';
    for (const p of PROVIDERS) {
      const isSelected = p.id === currentProvider;
      content += '<div class="cc-provider-card' + (isSelected ? ' selected' : '') + '">';
      content += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
      content += '<h3 style="margin:0;color:#f1f5f9">' + esc(p.name) + '</h3>';
      if (isSelected) content += '<span class="cc-badge cc-badge-green">Current</span>';
      content += '</div>';
      content += '<p style="font-size:.88rem;color:var(--text-dim);margin-bottom:12px">' + esc(p.description) + '</p>';
      content += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
      content += '<span class="cc-badge cc-badge-blue">' + esc(p.type) + '</span>';
      content += '<span class="cc-badge ' + (p.free ? 'cc-badge-green' : 'cc-badge-yellow') + '">' + (p.free ? 'Free' : 'Paid') + '</span>';
      if (p.score) content += '<span class="cc-badge cc-badge-blue">Score-based</span>';
      content += '</div>';

      if (!isSelected) {
        content += '<form method="POST" action="' + BASE + '/settings" style="margin-top:14px">';
        content += '<input type="hidden" name="provider" value="' + esc(p.id) + '">';
        content += '<input type="hidden" name="_method" value="put">';
        content += '<button class="cc-btn cc-btn-primary" type="submit">Switch to ' + esc(p.name) + '</button>';
        content += '</form>';
      }
      content += '</div>';
    }
    content += '</div>';

    /* Comparison table */
    content += '<h3 style="margin-top:28px;margin-bottom:12px">Feature Comparison</h3>';
    content += '<div style="overflow-x:auto"><table class="cc-table"><thead><tr><th>Feature</th>';
    for (const p of PROVIDERS) content += '<th>' + esc(p.name) + '</th>';
    content += '</tr></thead><tbody>';
    const features = [
      { name: 'Free Tier', vals: ['Yes', 'Yes', 'Yes', 'Yes', 'No'] },
      { name: 'Score-based', vals: ['No', 'Yes', 'No', 'Yes', 'No'] },
      { name: 'Invisible', vals: ['No', 'Yes', 'No', 'Yes', 'No'] },
      { name: 'GDPR Compliant', vals: ['Partial', 'Partial', 'Yes', 'Yes', 'Yes'] },
      { name: 'Accessibility', vals: ['Audio', 'Audio', 'Audio', 'Auto', 'Visual'] },
      { name: 'Bot Protection', vals: ['Good', 'Better', 'Good', 'Best', 'Best'] }
    ];
    for (const f of features) {
      content += '<tr><td style="font-weight:600">' + esc(f.name) + '</td>';
      for (const v of f.vals) content += '<td>' + esc(v) + '</td>';
      content += '</tr>';
    }
    content += '</tbody></table></div>';

    content += '</div>';
    res.send(renderPage('CAPTCHA Providers', content, req.session.user));
  }));

  /* ── 8. GET /admin/captcha/export/logs — Export CSV ─────── */
  app.get(BASE + '/export/logs', requireAuth, ah(async (req, res) => {
    const schoolId = req.session.user?.school_id || 1;
    const limit = parseInt(req.query.limit) || 10000;

    const logRes = await pool.query(
      'SELECT id, provider, action, ip_address, score, success, error_message, response_time_ms, created_at FROM captcha_verification_log WHERE school_id=$1 ORDER BY created_at DESC LIMIT $2',
      [schoolId, limit]
    );

    const headers = ['id', 'provider', 'action', 'ip_address', 'score', 'success', 'error_message', 'response_time_ms', 'created_at'];
    let csv = headers.join(',') + '\n';
    for (const r of logRes.rows) {
      const row = headers.map(h => {
        let val = String(r[h] === null ? '' : r[h]);
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          val = '"' + val.replace(/"/g, '""') + '"';
        }
        return val;
      });
      csv += row.join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=captcha_logs_' + new Date().toISOString().slice(0, 10) + '.csv');
    res.send(csv);

    audit({ action: 'captcha_logs_exported', schoolId, count: logRes.rows.length });
  }));

  /* ── 9. DELETE /admin/captcha/cleanup-logs — Cleanup ───── */
  app.delete(BASE + '/cleanup-logs', requireAuth, ah(async (req, res) => {
    const schoolId = req.session.user?.school_id || 1;
    const days = parseInt(req.body.days) || 30;

    const delRes = await pool.query(
      'DELETE FROM captcha_verification_log WHERE school_id=$1 AND created_at < NOW() - INTERVAL \'' + Math.max(1, days) + ' days\'',
      [schoolId]
    );

    audit({ action: 'captcha_logs_cleaned', schoolId, deleted: delRes.rowCount });
    res.json({ success: true, deleted: delRes.rowCount, message: 'Deleted ' + delRes.rowCount + ' log entries older than ' + days + ' days.' });
  }));

  /* Also support POST for cleanup (form submissions) */
  app.post(BASE + '/cleanup-logs', requireAuth, ah(async (req, res) => {
    const schoolId = req.session.user?.school_id || 1;
    const days = parseInt(req.body.days) || 30;

    const delRes = await pool.query(
      'DELETE FROM captcha_verification_log WHERE school_id=$1 AND created_at < NOW() - $2 * INTERVAL \'1 day\'',
      [schoolId, Math.max(1, days)]
    );

    audit({ action: 'captcha_logs_cleaned', schoolId, deleted: delRes.rowCount });
    const redirect = req.query.redirect || BASE + '/logs';
    res.redirect(redirect + '?flash_type=ok&flash=Deleted+' + delRes.rowCount + '+log+entries+older+than+' + days + '+days.');
  }));

  /* ── 10. POST /admin/captcha/simulate — Simulate verify ── */
  app.post(BASE + '/simulate', requireAuth, ah(async (req, res) => {
    const schoolId = req.session.user?.school_id || 1;
    const settings = await ensureSettings(schoolId);
    const { score, provider, action, fail_deliberately } = req.body;

    const simProvider = provider || settings.provider || 'recaptcha_v2';
    const simAction = action || 'verify';
    const simScore = score !== undefined ? parseFloat(score) : Math.round((Math.random() * 0.6 + 0.4) * 100) / 100;
    const minScore = settings.min_score || 0.5;
    const success = fail_deliberately === 'true' ? false : simScore >= minScore;

    const responseMs = Math.floor(Math.random() * 200) + 50;
    const errorMsg = success ? '' : 'Score ' + simScore.toFixed(2) + ' below minimum threshold ' + minScore;

    await insertLog({
      school_id: schoolId,
      provider: simProvider,
      action: simAction,
      ip: req.ip,
      score: simScore,
      success,
      error: errorMsg,
      ms: responseMs
    });

    audit({ action: 'captcha_simulated', schoolId, provider: simProvider, score: simScore, success });

    res.json({
      success,
      score: simScore,
      min_score: minScore,
      response_time_ms: responseMs,
      error: errorMsg,
      provider: simProvider,
      action: simAction
    });
  }));

  /* ── 11. GET /admin/captcha/widget-preview — Preview widget ─ */
  app.get(BASE + '/widget-preview', requireAuth, ah(async (req, res) => {
    const schoolId = req.session.user?.school_id || 1;
    const settings = await ensureSettings(schoolId);

    const provider = req.query.provider || settings.provider || 'recaptcha_v2';
    const theme = req.query.theme || settings.theme || 'dark';
    const size = req.query.size || settings.size || 'normal';

    let content = STYLE + navTabs(BASE + '/widget-preview');
    content += '<div class="cc-card"><h2>Widget Preview</h2>';
    content += '<p style="color:var(--text-dim);margin-bottom:20px;font-size:.9rem">Preview how the CAPTCHA widget will appear on your pages.</p>';

    /* Controls */
    content += '<div style="margin-bottom:20px;padding:16px;background:var(--bg);border-radius:8px">';
    content += '<form method="GET" action="' + BASE + '/widget-preview" style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end">';
    content += '<div><label style="font-size:.82rem;color:var(--text-dim);display:block;margin-bottom:4px">Provider</label>';
    content += '<select name="provider" class="cc-select">';
    for (const p of PROVIDERS) {
      content += '<option value="' + esc(p.id) + '"' + (p.id === provider ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }
    content += '</select></div>';
    content += '<div><label style="font-size:.82rem;color:var(--text-dim);display:block;margin-bottom:4px">Theme</label>';
    content += '<select name="theme" class="cc-select">';
    for (const t of THEMES) {
      content += '<option value="' + esc(t) + '"' + (t === theme ? ' selected' : '') + '>' + esc(t.charAt(0).toUpperCase() + t.slice(1)) + '</option>';
    }
    content += '</select></div>';
    content += '<div><label style="font-size:.82rem;color:var(--text-dim);display:block;margin-bottom:4px">Size</label>';
    content += '<select name="size" class="cc-select">';
    for (const s of SIZES) {
      content += '<option value="' + esc(s) + '"' + (s === size ? ' selected' : '') + '>' + esc(s.charAt(0).toUpperCase() + s.slice(1)) + '</option>';
    }
    content += '</select></div>';
    content += '<button class="cc-btn cc-btn-primary" type="submit">Update Preview</button>';
    content += '</form></div>';

    /* Preview box */
    const previewTheme = theme === 'dark' ? '#0f172a' : '#ffffff';
    const previewText = theme === 'dark' ? '#e2e8f0' : '#1f2937';
    const previewBorder = theme === 'dark' ? '#334155' : '#d1d5db';

    content += '<div class="cc-preview-box" style="background:' + previewTheme + ';border-color:' + previewBorder + '">';
    content += '<div style="color:' + previewText + '">';

    if (provider === 'recaptcha_v2' || provider === 'hcaptcha') {
      content += '<div style="border:2px solid ' + previewBorder + ';border-radius:4px;padding:16px;display:inline-flex;align-items:center;gap:12px;min-width:304px;min-height:78px;background:' + (theme === 'dark' ? '#1e293b' : '#f9fafb') + '">';
      content += '<div style="width:28px;height:28px;border:2px solid ' + (theme === 'dark' ? '#94a3b8' : '#6b7280') + ';border-radius:4px"></div>';
      content += '<div style="font-size:.9rem;color:' + previewText + '">I\'m not a robot</div>';
      content += '<div style="margin-left:auto;width:32px;height:32px;border:2px solid ' + (theme === 'dark' ? '#94a3b8' : '#6b7280') + ';border-radius:4px;background:' + (theme === 'dark' ? '#334155' : '#e5e7eb') + '"></div>';
      content += '</div>';
      content += '<div style="margin-top:12px;font-size:.78rem;color:' + previewText + ';opacity:.6">reCAPTCHA / hCaptcha Checkbox Widget</div>';
    } else if (provider === 'recaptcha_v3') {
      content += '<div style="text-align:center;padding:20px">';
      content += '<div style="font-size:2rem;margin-bottom:8px">&#x1F6E1;</div>';
      content += '<div style="font-size:.95rem;font-weight:600;color:' + previewText + '">Invisible Verification</div>';
      content += '<div style="font-size:.82rem;color:' + previewText + ';opacity:.7;margin-top:6px">reCAPTCHA v3 runs silently in the background.<br>No visible widget is shown to users.</div>';
      content += '<div style="margin-top:12px;padding:8px 16px;background:rgba(59,130,246,.15);border-radius:4px;font-size:.82rem;color:#93c5fd">Risk Score: 0.00 - 1.00</div>';
      content += '</div>';
    } else if (provider === 'turnstile') {
      content += '<div style="border:2px solid ' + previewBorder + ';border-radius:4px;padding:14px 20px;display:inline-flex;align-items:center;gap:10px;background:' + (theme === 'dark' ? '#1e293b' : '#f9fafb') + '">';
      content += '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="opacity:.8"><path d="M12 2L2 7l10 5 10-5-10-5z" stroke="' + (theme === 'dark' ? '#94a3b8' : '#6b7280') + '" stroke-width="2"/><path d="M2 17l10 5 10-5" stroke="' + (theme === 'dark' ? '#94a3b8' : '#6b7280') + '" stroke-width="2"/><path d="M2 12l10 5 10-5" stroke="' + (theme === 'dark' ? '#94a3b8' : '#6b7280') + '" stroke-width="2"/></svg>';
      content += '<span style="font-size:.88rem;color:' + previewText + '">Cloudflare Turnstile</span>';
      content += '<div style="width:24px;height:24px;border:2px solid ' + (theme === 'dark' ? '#94a3b8' : '#6b7280') + ';border-radius:3px"></div>';
      content += '</div>';
      content += '<div style="margin-top:10px;font-size:.78rem;color:' + previewText + ';opacity:.6">Smart, invisible CAPTCHA by Cloudflare</div>';
    } else if (provider === 'arkose') {
      content += '<div style="border:2px solid ' + previewBorder + ';border-radius:8px;padding:24px;text-align:center;background:' + (theme === 'dark' ? '#1e293b' : '#f9fafb') + ';min-width:300px">';
      content += '<div style="font-size:1.8rem;margin-bottom:8px">&#x1F9E9;</div>';
      content += '<div style="font-size:.95rem;font-weight:600;color:' + previewText + '">Arkose FunCaptcha</div>';
      content += '<div style="font-size:.82rem;color:' + previewText + ';opacity:.7;margin-top:6px">Interactive puzzle-based challenge</div>';
      content += '<div style="margin-top:12px;padding:10px 20px;background:var(--accent);border-radius:4px;color:#fff;font-weight:600;font-size:.88rem;display:inline-block">Verify</div>';
      content += '</div>';
      content += '<div style="margin-top:10px;font-size:.78rem;color:' + previewText + ';opacity:.6">Enterprise-grade fraud prevention</div>';
    }

    content += '</div></div>';

    /* Embed code */
    content += '<h3 style="margin-top:24px;margin-bottom:10px">Embed Code</h3>';
    let embedCode = '';
    if (provider === 'recaptcha_v2') {
      embedCode = '&lt;script src="https://www.google.com/recaptcha/api.js" async defer&gt;&lt;/script&gt;\n&lt;div class="g-recaptcha" data-sitekey="YOUR_SITE_KEY" data-theme="' + esc(theme) + '" data-size="' + esc(size) + '"&gt;&lt;/div&gt;';
    } else if (provider === 'recaptcha_v3') {
      embedCode = '&lt;script src="https://www.google.com/recaptcha/api.js?render=YOUR_SITE_KEY"&gt;&lt;/script&gt;\n&lt;script&gt;grecaptcha.ready(() =&gt; {\n  grecaptcha.execute(\'YOUR_SITE_KEY\', {action: \'submit\'}).then(token =&gt; { /* send to server */ });\n});&lt;/script&gt;';
    } else if (provider === 'hcaptcha') {
      embedCode = '&lt;script src="https://js.hcaptcha.com/1/api.js" async defer&gt;&lt;/script&gt;\n&lt;div class="h-captcha" data-sitekey="YOUR_SITE_KEY" data-theme="' + esc(theme) + '" data-size="' + esc(size) + '"&gt;&lt;/div&gt;';
    } else if (provider === 'turnstile') {
      embedCode = '&lt;script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer&gt;&lt;/script&gt;\n&lt;div class="cf-turnstile" data-sitekey="YOUR_SITE_KEY" data-theme="' + esc(theme) + '" data-size="' + esc(size) + '"&gt;&lt;/div&gt;';
    } else {
      embedCode = '&lt;!-- Arkose Labs FunCaptcha --&gt;\n&lt;script src="https://game-api.arkoselabs.com/v2/"&gt;&lt;/script&gt;';
    }
    content += '<pre style="background:#0f172a;border:1px solid var(--border);border-radius:8px;padding:16px;overflow-x:auto;font-size:.85rem;color:#93c5fd;line-height:1.5">' + embedCode + '</pre>';

    content += '</div>';
    res.send(renderPage('Widget Preview', content, req.session.user));
  }));

  /* ── 12. GET /admin/captcha/settings — Settings page ────── */
  app.get(BASE + '/settings', requireAuth, ah(async (req, res) => {
    const schoolId = req.session.user?.school_id || 1;
    const settings = await ensureSettings(schoolId);

    let content = STYLE + navTabs(BASE + '/settings');
    content += flashMsg(req.query.flash_type, req.query.flash);

    content += '<div class="cc-card"><h2>CAPTCHA Settings</h2>';
    content += '<form id="captchaSettingsForm" method="POST" action="' + BASE + '/settings">';

    /* Provider */
    content += '<div style="margin-bottom:20px"><label style="font-size:.88rem;font-weight:600;display:block;margin-bottom:6px">Provider</label>';
    content += '<select name="provider" class="cc-select" style="width:100%;max-width:380px">';
    for (const p of PROVIDERS) {
      content += '<option value="' + esc(p.id) + '"' + ((p.id === settings.provider) ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }
    content += '</select></div>';

    /* Keys */
    content += '<div style="margin-bottom:20px"><label style="font-size:.88rem;font-weight:600;display:block;margin-bottom:6px">Site Key</label>';
    content += '<input class="cc-input" name="site_key" value="' + esc(settings.site_key || '') + '" placeholder="Enter your site key"></div>';

    content += '<div style="margin-bottom:20px"><label style="font-size:.88rem;font-weight:600;display:block;margin-bottom:6px">Secret Key</label>';
    content += '<input class="cc-input" name="secret_key" type="password" value="' + esc(settings.secret_key || '') + '" placeholder="Enter your secret key"></div>';

    /* Min Score */
    content += '<div style="margin-bottom:20px"><label style="font-size:.88rem;font-weight:600;display:block;margin-bottom:6px">Minimum Score (v3/Turnstile)</label>';
    content += '<div style="display:flex;align-items:center;gap:12px">';
    content += '<input type="range" name="min_score" min="0" max="1" step="0.1" value="' + (settings.min_score || 0.5) + '" style="flex:1;max-width:200px" oninput="document.getElementById(\'scoreVal\').textContent=this.value">';
    content += '<span id="scoreVal" style="font-weight:600;color:var(--accent)">' + (settings.min_score || 0.5) + '</span>';
    content += '</div></div>';

    /* Enabled Pages */
    content += '<div style="margin-bottom:20px"><label style="font-size:.88rem;font-weight:600;display:block;margin-bottom:6px">Enabled Pages</label>';
    const enabledPages = settings.enabled_pages || ['login', 'register', 'contact'];
    content += '<div style="display:flex;flex-wrap:wrap;gap:12px">';
    for (const pg of PAGES) {
      const checked = enabledPages.includes(pg);
      content += '<label style="display:flex;align-items:center;gap:6px;font-size:.88rem;color:var(--text-dim);cursor:pointer">';
      content += '<input type="checkbox" name="enabled_pages" value="' + esc(pg) + '" ' + (checked ? 'checked' : '') + ' class="cc-check">';
      content += esc(pg.replace(/_/g, ' ')) + '</label>';
    }
    content += '</div></div>';

    /* Theme and Size */
    content += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">';
    content += '<div><label style="font-size:.88rem;font-weight:600;display:block;margin-bottom:6px">Theme</label>';
    content += '<select name="theme" class="cc-select" style="width:100%">';
    for (const t of THEMES) {
      content += '<option value="' + esc(t) + '"' + (t === settings.theme ? ' selected' : '') + '>' + esc(t.charAt(0).toUpperCase() + t.slice(1)) + '</option>';
    }
    content += '</select></div>';
    content += '<div><label style="font-size:.88rem;font-weight:600;display:block;margin-bottom:6px">Size</label>';
    content += '<select name="size" class="cc-select" style="width:100%">';
    for (const s of SIZES) {
      content += '<option value="' + esc(s) + '"' + (s === settings.size ? ' selected' : '') + '>' + esc(s.charAt(0).toUpperCase() + s.slice(1)) + '</option>';
    }
    content += '</select></div>';
    content += '</div>';

    /* Fail Action */
    content += '<div style="margin-bottom:20px"><label style="font-size:.88rem;font-weight:600;display:block;margin-bottom:6px">On Failure</label>';
    content += '<select name="fail_action" class="cc-select">';
    for (const fa of FAIL_ACTIONS) {
      content += '<option value="' + esc(fa) + '"' + (fa === settings.fail_action ? ' selected' : '') + '>' + esc(fa.charAt(0).toUpperCase() + fa.slice(1)) + ' — ' + (fa === 'block' ? 'Block the request entirely' : fa === 'warn' ? 'Show warning but allow' : 'Show additional challenge') + '</option>';
    }
    content += '</select></div>';

    /* Active Toggle */
    content += '<div style="margin-bottom:20px;display:flex;align-items:center;gap:12px">';
    content += toggleHtml('is_active', settings.is_active, 'CAPTCHA Active');
    content += '<span style="font-size:.88rem;color:var(--text-dim)">' + (settings.is_active ? 'CAPTCHA is currently <strong style="color:var(--success)">active</strong>' : 'CAPTCHA is currently <strong style="color:var(--danger)">inactive</strong>') + '</span>';
    content += '</div>';

    /* Custom HTML */
    content += '<div style="margin-bottom:20px"><label style="font-size:.88rem;font-weight:600;display:block;margin-bottom:6px">Custom HTML (optional)</label>';
    content += '<textarea name="custom_html" class="cc-input" rows="4" style="max-width:100%;min-width:100%;font-family:monospace" placeholder="Custom HTML to embed alongside the widget...">' + esc(settings.custom_html || '') + '</textarea></div>';

    content += '<div style="display:flex;gap:10px;flex-wrap:wrap;padding-top:16px;border-top:1px solid var(--border)">';
    content += '<button class="cc-btn cc-btn-primary" type="submit" onclick="saveSettings(event)">Save Settings</button>';
    content += '<a class="cc-btn cc-btn-outline" href="' + BASE + '/test" onclick="testConfig(event)">Test Configuration</a>';
    content += '<a class="cc-btn cc-btn-outline" href="' + BASE + '">Cancel</a>';
    content += '</div>';
    content += '</form></div>';

    /* Simulate section */
    content += '<div class="cc-card"><h2>Quick Test Simulation</h2>';
    content += '<p style="color:var(--text-dim);margin-bottom:16px;font-size:.9rem">Generate simulated verification entries to test your configuration.</p>';
    content += '<form method="POST" action="' + BASE + '/simulate" id="simForm">';
    content += '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">';
    content += '<div><label style="font-size:.82rem;color:var(--text-dim);display:block;margin-bottom:4px">Score (0-1)</label>';
    content += '<input class="cc-input" name="score" type="number" step="0.01" min="0" max="1" placeholder="Random" style="max-width:120px"></div>';
    content += '<div><label style="font-size:.82rem;color:var(--text-dim);display:block;margin-bottom:4px">Provider</label>';
    content += '<select name="provider" class="cc-select" style="max-width:180px">';
    for (const p of PROVIDERS) content += '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>';
    content += '</select></div>';
    content += '<label style="display:flex;align-items:center;gap:6px;font-size:.85rem;color:var(--text-dim)"><input type="checkbox" name="fail_deliberately" value="true"> Force fail</label>';
    content += '<button class="cc-btn cc-btn-warn" type="submit">Run Simulation</button>';
    content += '</div></form>';
    content += '<div id="simResult" style="margin-top:12px"></div></div>';

    /* JavaScript for settings form */
    content += '<script>';
    content += 'async function saveSettings(e){e.preventDefault();const f=document.getElementById("captchaSettingsForm");const fd=new FormData(f);const pages=fd.getAll("enabled_pages");const body={provider:fd.get("provider"),site_key:fd.get("site_key"),secret_key:fd.get("secret_key"),min_score:fd.get("min_score"),enabled_pages:JSON.stringify(pages),theme:fd.get("theme"),size:fd.get("size"),is_active:f.querySelector("[name=is_active]").checked,fail_action:fd.get("fail_action"),custom_html:fd.get("custom_html")};';
    content += 'try{const r=await fetch("' + BASE + '/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(d.success){document.getElementById("simResult").innerHTML=\'<div class="cc-flash cc-flash-ok">Settings saved successfully.</div>\';}else{document.getElementById("simResult").innerHTML=\'<div class="cc-flash cc-flash-err">\'+d.error+\'</div>\';}}catch(ex){document.getElementById("simResult").innerHTML=\'<div class="cc-flash cc-flash-err">\'+ex.message+\'</div>\';}}';
    content += 'async function testConfig(e){e.preventDefault();try{const r=await fetch("' + BASE + '/test",{method:"POST",headers:{"Content-Type":"application/json"}});const d=await r.json();document.getElementById("simResult").innerHTML=\'<div class="cc-flash \'+(d.success?"cc-flash-ok":"cc-flash-err")+\'">\'+(d.success?"Test passed!":"Test failed: "+d.error)+(d.response_time_ms?" ("+d.response_time_ms+"ms)":"")+"</div>";}catch(ex){document.getElementById("simResult").innerHTML=\'<div class="cc-flash cc-flash-err">\'+ex.message+\'</div>\';}}';
    content += 'document.getElementById("simForm").addEventListener("submit",async function(e){e.preventDefault();const fd=new FormData(this);const body=Object.fromEntries(fd);try{const r=await fetch("' + BASE + '/simulate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();document.getElementById("simResult").innerHTML=\'<div class="cc-flash \'+(d.success?"cc-flash-ok":"cc-flash-err")+\'">Simulation: \'+(d.success?"PASS":"FAIL")+\' | Score: \'+d.score.toFixed(2)+\' | Threshold: \'+d.min_score+\' | \'+d.response_time_ms+\'ms</div>\';}catch(ex){document.getElementById("simResult").innerHTML=\'<div class="cc-flash cc-flash-err">\'+ex.message+\'</div>\';}});';
    content += '</script>';

    content += '</div>';
    res.send(renderPage('CAPTCHA Settings', content, req.session.user));
  }));

  /* ── 13. POST /admin/captcha/reset — Reset to defaults ─── */
  app.post(BASE + '/reset', requireAuth, ah(async (req, res) => {
    const schoolId = req.session.user?.school_id || 1;

    await pool.query('DELETE FROM captcha_settings WHERE school_id=$1', [schoolId]);
    await pool.query('INSERT INTO captcha_settings (school_id, provider, site_key, secret_key, min_score, enabled_pages, theme, size, is_active, fail_action) VALUES ($1, \'recaptcha_v2\', NULL, NULL, 0.5, \'["login","register","contact"]\', \'dark\', \'normal\', true, \'block\')', [schoolId]);

    audit({ action: 'captcha_settings_reset', schoolId });
    await insertLog({ school_id: schoolId, provider: 'system', action: 'reset', ip: req.ip, score: null, success: true, error: '', ms: 0 });

    const redirect = req.query.redirect || BASE + '/settings';
    res.redirect(redirect + '?flash_type=ok&flash=CAPTCHA+settings+reset+to+defaults.');
  }));
};
