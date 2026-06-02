'use strict';
// ============================================================
// FEATURE FLAGS MODULE — School SaaS Portal
// Feature flag management with A/B testing, percentage rollouts,
// user segmentation, and statistical significance analysis.
// ============================================================
// Usage in server.js:
//   const featureFlags = require('./feature-flags');
//   featureFlags(app, pool, { renderPage, esc, ah, requireAuth, audit });
// ============================================================

const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  opts = opts || {};
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const fmtDT = (d) => d ? new Date(d).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

  // ── Color Theme ──────────────────────────────────────────
  const P = '#4f46e5', M = '#6b7280', G = '#059669', R = '#dc2626', O = '#d97706';
  const PL = '#eef2ff', ML = '#f3f4f6', GL = '#d1fae5', RL = '#fee2e2', OL = '#fef3c7';

  // ── Shared CSS ───────────────────────────────────────────
  const SK_CSS = '<link rel="stylesheet" href="/css/sk.css">';
  const CSS = `<style>
    .ff-root{max-width:1200px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif}
    .ff-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;align-items:center;padding:12px 16px;background:${PL};border-radius:14px;border:1px solid #c7d2fe}
    .ff-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:${M};background:#fff;transition:.15s;border:1px solid transparent}
    .ff-nav a:hover{background:#e0e7ff;color:#312e81}
    .ff-nav a.active{background:${P};color:#fff;border-color:${P};box-shadow:0 2px 8px rgba(79,70,229,.25)}
    .ff-hero{background:linear-gradient(135deg,#312e81,${P});padding:28px 32px;border-radius:16px;margin-bottom:24px;color:#fff;position:relative;overflow:hidden}
    .ff-hero::after{content:"";position:absolute;top:-40px;right:-40px;width:200px;height:200px;border-radius:50%;background:rgba(129,140,248,.15)}
    .ff-hero h1{font-size:24px;margin:0 0 4px;position:relative;z-index:1}
    .ff-hero p{opacity:.85;margin:0;font-size:14px;position:relative;z-index:1}
    .ff-hero-actions{margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;position:relative;z-index:1}
    .ff-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:24px}
    .ff-stat{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:20px;text-align:center;transition:.2s}
    .ff-stat:hover{box-shadow:0 4px 24px rgba(79,70,229,.1);transform:translateY(-2px)}
    .ff-stat-val{font-size:32px;font-weight:800;color:#1e1b4b}
    .ff-stat-lbl{font-size:11px;color:${M};margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
    .ff-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .ff-btn:hover{opacity:.9;transform:translateY(-1px)}
    .ff-btn-primary{background:${P};color:#fff}
    .ff-btn-danger{background:${RL};color:${R};border:1px solid #fecaca}
    .ff-btn-success{background:${GL};color:#065f46;border:1px solid #a7f3d0}
    .ff-btn-secondary{background:${ML};color:${M};border:1px solid #e5e7eb}
    .ff-btn-sm{padding:6px 12px;font-size:12px;border-radius:8px}
    .ff-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:20px;transition:.15s}
    .ff-card:hover{box-shadow:0 4px 20px rgba(79,70,229,.06)}
    .ff-table{width:100%;border-collapse:collapse;font-size:13px}
    .ff-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e5e7eb;color:${M};font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:${ML}}
    .ff-table td{padding:10px 14px;border-bottom:1px solid #f3f4f6;color:#1e1b4b}
    .ff-table tr:hover{background:#eef2ff}
    .ff-input{width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;transition:.15s;box-sizing:border-box;font-family:inherit}
    .ff-input:focus{outline:none;border-color:${P};box-shadow:0 0 0 3px ${PL}}
    .ff-select{width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:13px;background:#fff;box-sizing:border-box;font-family:inherit}
    .ff-form-group{margin-bottom:16px}
    .ff-form-group label{display:block;font-size:13px;font-weight:600;color:#1e1b4b;margin-bottom:5px}
    .ff-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700}
    .ff-progress{background:#e5e7eb;border-radius:8px;height:10px;overflow:hidden;width:100%}
    .ff-progress-bar{height:100%;border-radius:8px;transition:width .4s ease}
    .ff-toggle{position:relative;display:inline-block;width:48px;height:26px}
    .ff-toggle input{opacity:0;width:0;height:0}
    .ff-toggle .slider{position:absolute;cursor:pointer;inset:0;background:#cbd5e1;border-radius:26px;transition:.25s}
    .ff-toggle .slider:before{content:"";position:absolute;height:20px;width:20px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.25s}
    .ff-toggle input:checked+.slider{background:${G}}
    .ff-toggle input:checked+.slider:before{transform:translateX(22px)}
    .ff-variant-card{border:2px solid #e5e7eb;border-radius:12px;padding:16px;transition:.2s;flex:1;min-width:180px}
    .ff-variant-card.winner{border-color:${G};background:${GL}}
    .ff-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .ff-grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
    .ff-empty{text-align:center;padding:40px;color:#9ca3af}
    .ff-alert{padding:14px 18px;border-radius:10px;font-size:13px;margin-bottom:16px;display:flex;align-items:center;gap:8px}
    .ff-alert-success{background:${GL};color:#065f46;border:1px solid #a7f3d0}
    .ff-alert-info{background:${PL};color:#312e81;border:1px solid #c7d2fe}
    .ff-alert-warn{background:${OL};color:#92400e;border:1px solid #fde68a}
    ::-webkit-scrollbar{width:6px;height:6px}
    ::-webkit-scrollbar-track{background:#f1f5f9;border-radius:3px}
    ::-webkit-scrollbar-thumb{background:#c7d2fe;border-radius:3px}
    @media(max-width:768px){.ff-stats{grid-template-columns:1fr 1fr}.ff-grid-2,.ff-grid-3{grid-template-columns:1fr}.ff-nav{flex-direction:column}.ff-hero{padding:20px}}
  </style>`;

  // ── Navigation ───────────────────────────────────────────
  function nav(active) {
    const items = [
      { href:'/school/features', label:'📊 Dashboard', key:'dash' },
      { href:'/school/features/flags', label:'🚩 Flags', key:'flags' },
      { href:'/school/features/experiments', label:'🧪 Experiments', key:'exp' },
      { href:'/school/features/segments', label:'👥 Segments', key:'seg' },
      { href:'/school/features/audit', label:'📝 Audit Log', key:'audit' },
    ];
    return `<nav class="ff-nav" aria-label="Feature Flags Navigation">${items.map(i =>
      `<a href="${i.href}" class="${active===i.key?'active':''}">${i.label}</a>`).join('')}</nav>`;
  }

  // ── Database Migrations ──────────────────────────────────
  const migrations = [
    `CREATE TABLE IF NOT EXISTS feature_flags (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      flag_key VARCHAR(100) NOT NULL, name VARCHAR(200) NOT NULL, description TEXT,
      is_enabled BOOLEAN DEFAULT false, flag_type VARCHAR(20) DEFAULT 'boolean',
      rollout_percentage INTEGER DEFAULT 100, target_segments JSONB DEFAULT '[]',
      created_by VARCHAR(200), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, flag_key))`,
    `CREATE TABLE IF NOT EXISTS feature_flag_assignments (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      flag_id INTEGER NOT NULL, user_email VARCHAR(200) NOT NULL,
      variant VARCHAR(50) DEFAULT 'control', created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(flag_id, user_email))`,
    `CREATE TABLE IF NOT EXISTS feature_experiments (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      name VARCHAR(200) NOT NULL, description TEXT, flag_key VARCHAR(100) NOT NULL,
      status VARCHAR(20) DEFAULT 'draft', traffic_percentage INTEGER DEFAULT 50,
      variants JSONB DEFAULT '[{"name":"control","weight":50},{"name":"treatment","weight":50}]',
      start_date TIMESTAMPTZ, end_date TIMESTAMPTZ, target_metric VARCHAR(100),
      created_by VARCHAR(200), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS feature_experiment_events (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      experiment_id INTEGER NOT NULL, user_email VARCHAR(200) NOT NULL,
      variant VARCHAR(50) NOT NULL, event_type VARCHAR(50) NOT NULL,
      event_value NUMERIC DEFAULT 0, metadata JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS feature_segments (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      name VARCHAR(150) NOT NULL, description TEXT, rules JSONB DEFAULT '{}',
      user_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS feature_flag_audit (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      flag_id INTEGER, experiment_id INTEGER, action VARCHAR(100) NOT NULL,
      old_value JSONB, new_value JSONB, user_email VARCHAR(200),
      ip_address VARCHAR(50), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_ff_tid ON feature_flags(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ff_key ON feature_flags(tenant_id, flag_key)`,
    `CREATE INDEX IF NOT EXISTS idx_fexp_tid ON feature_experiments(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fexp_status ON feature_experiments(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_feve_exp ON feature_experiment_events(experiment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ffa_flag ON feature_flag_assignments(flag_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ffaudit_tid ON feature_flag_audit(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ffaudit_created ON feature_flag_audit(created_at DESC)`,
  ];

  // ── Helper: consistent hash (djb2) for A/B assignment ──
  function consistentHash(str, buckets) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
    return hash % buckets;
  }

  // ── Helper: chi-squared test for statistical significance ─
  function chiSquared(a_conv, a_total, b_conv, b_total) {
    const a_fail = a_total - a_conv, b_fail = b_total - b_conv;
    const total = a_total + b_total;
    if (total === 0) return { pValue: 1, significant: false };
    const e_a_conv = (a_total / total) * (a_conv + b_conv);
    const e_a_fail = (a_total / total) * (a_fail + b_fail);
    const e_b_conv = (b_total / total) * (a_conv + b_conv);
    const e_b_fail = (b_total / total) * (a_fail + b_fail);
    const chi2 = e_a_conv > 0 ? Math.pow(a_conv - e_a_conv, 2) / e_a_conv : 0
      + e_a_fail > 0 ? Math.pow(a_fail - e_a_fail, 2) / e_a_fail : 0
      + e_b_conv > 0 ? Math.pow(b_conv - e_b_conv, 2) / e_b_conv : 0
      + e_b_fail > 0 ? Math.pow(b_fail - e_b_fail, 2) / e_b_fail : 0;
    const pValue = chi2 > 0 ? Math.exp(-chi2 / 2) * (1 + chi2 / 2 + Math.pow(chi2, 2) / 8) : 1;
    return { chi2: Math.round(chi2 * 100) / 100, pValue: Math.round(Math.min(pValue, 1) * 1000) / 1000, significant: pValue < 0.05 };
  }

  // ── Helper: confidence interval (Wilson score, 95%) ─────
  function confidenceInterval(conv, total) {
    if (total === 0) return { low: 0, high: 0, rate: 0 };
    const rate = conv / total;
    const z = 1.96;
    const n = total;
    const denom = 1 + z * z / n;
    const center = (rate + z * z / (2 * n)) / denom;
    const margin = z * Math.sqrt((rate * (1 - rate) + z * z / (4 * n)) / n) / denom;
    return { low: Math.max(0, Math.round((center - margin) * 1000) / 1000), high: Math.min(1, Math.round((center + margin) * 1000) / 1000), rate: Math.round(rate * 1000) / 1000 };
  }

  // ── Helper: log audit entry ─────────────────────────────
  async function logAudit(tid, flag_id, experiment_id, action, oldVal, newVal, req) {
    await pool.query(
      `INSERT INTO feature_flag_audit (tenant_id,flag_id,experiment_id,action,old_value,new_value,user_email,ip_address,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [tid, flag_id, experiment_id, action, JSON.stringify(oldVal), JSON.stringify(newVal), req.session?.user?.email, req?.ip || null]);
  }

  // ── Run migrations on startup ────────────────────────────
  (async () => {
    const client = await pool.connect();
    try {
      for (const sql of migrations) await client.query(sql);
      console.log('[FeatureFlags] Migrations applied (' + migrations.length + ' statements)');
    } catch(e) { /* migration OK */ }
    finally { client.release(); }
  })();

  // ── MIDDLEWARE: _isFeatureEnabled ────────────────────────
  app._isFeatureEnabled = async function(flagKey, req) {
    const tid = tenantId(req);
    const email = req.session?.user?.email || '';
    if (!tid || !email) return false;
    const { rows } = await pool.query(
      'SELECT * FROM feature_flags WHERE tenant_id=$1 AND flag_key=$2', [tid, flagKey]);
    if (!rows.length) return false;
    const flag = rows[0];
    if (!flag.is_enabled) return false;
    if (flag.flag_type === 'boolean') return true;
    if (flag.flag_type === 'percentage') {
      const bucket = consistentHash(email + flagKey, 100);
      return bucket < flag.rollout_percentage;
    }
    if (flag.flag_type === 'multivariate') {
      const { rows: exps } = await pool.query(
        "SELECT * FROM feature_experiments WHERE tenant_id=$1 AND flag_key=$2 AND status='running'", [tid, flagKey]);
      if (!exps.length) return true;
      const exp = exps[0];
      const variants = typeof exp.variants === 'string' ? JSON.parse(exp.variants) : exp.variants;
      const idx = consistentHash(email + exp.id, 100);
      let cumWeight = 0;
      for (const v of variants) { cumWeight += v.weight; if (idx < cumWeight) return true; }
      return false;
    }
    return true;
  };

  // ── ROUTE 1: GET /school/features — Dashboard ────────────
  app.get('/school/features', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const [[fc],[ec],[ac],[rc]] = await Promise.all([
      pool.query('SELECT COUNT(*)::int as c FROM feature_flags WHERE tenant_id=$1',[tid]),
      pool.query("SELECT COUNT(*)::int as c FROM feature_experiments WHERE tenant_id=$1 AND status='running'",[tid]),
      pool.query("SELECT COUNT(*)::int as c FROM feature_flags WHERE tenant_id=$1 AND is_enabled=true",[tid]),
      pool.query("SELECT COUNT(*)::int as c FROM feature_flags WHERE tenant_id=$1 AND flag_type='percentage'",[tid]),
    ]);
    const { rows: flags } = await pool.query(
      'SELECT * FROM feature_flags WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10', [tid]);
    const { rows: exps } = await pool.query(
      "SELECT * FROM feature_experiments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5", [tid]);

    const flagList = flags.map(f => {
      const typeColors = { boolean: P, percentage: O, segmented: '#0891b2', multivariate: '#7c3aed' };
      const tc = typeColors[f.flag_type] || M;
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid #f3f4f6;border-radius:10px;margin-bottom:6px;transition:.15s" onmouseover="this.style.borderColor='#c7d2fe'" onmouseout="this.style.borderColor='#f3f4f6'">
        <label class="ff-toggle"><input type="checkbox" ${f.is_enabled?'checked':''} onchange="fetch('/school/features/flags/${f.id}/toggle',{method:'POST',headers:{'Content-Type':'application/json'}}).then(()=>location.reload())"><span class="slider"></span></label>
        <div style="flex:1"><div style="font-size:13px;font-weight:600;color:#1e1b4b">${esc(f.name)}</div><div style="font-size:11px;color:${M}">${esc(f.flag_key)}</div></div>
        <span class="ff-badge" style="background:${tc}15;color:${tc}">${f.flag_type}</span>
        ${f.flag_type==='percentage'?`<div style="width:60px"><div class="ff-progress" style="height:6px"><div class="ff-progress-bar" style="width:${f.rollout_percentage}%;background:${G}"></div></div><div style="font-size:10px;color:${M};text-align:right">${f.rollout_percentage}%</div></div>`:''}
      </div>`;
    }).join('');

    const html = SK_CSS + CSS + `<div class="ff-root">${nav('dash')}
      <div class="ff-hero"><h1>🚩 Feature Flags & A/B Testing</h1><p>Manage feature rollouts, run experiments, and optimize with data-driven decisions</p>
        <div class="ff-hero-actions">
          <a href="/school/features/flags" class="ff-btn" style="background:#818cf8;color:#fff">🚩 Manage Flags</a>
          <a href="/school/features/experiments/create" class="ff-btn" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3)">🧪 New Experiment</a>
        </div></div>
      <div class="ff-stats">
        <div class="ff-stat"><div class="ff-stat-val">${fc.rows[0].c}</div><div class="ff-stat-lbl">Total Flags</div></div>
        <div class="ff-stat"><div class="ff-stat-val" style="color:${G}">${ac.rows[0].c}</div><div class="ff-stat-lbl">Active</div></div>
        <div class="ff-stat"><div class="ff-stat-val" style="color:${O}">${rc.rows[0].c}</div><div class="ff-stat-lbl">Rollouts</div></div>
        <div class="ff-stat"><div class="ff-stat-val" style="color:${P}">${ec.rows[0].c}</div><div class="ff-stat-lbl">Live Experiments</div></div>
      </div>
      <div class="ff-grid-2">
        <div class="ff-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0;font-size:16px;font-weight:700;color:#1e1b4b">🚩 Recent Flags</h3>
          <a href="/school/features/flags" class="ff-btn ff-btn-sm ff-btn-secondary">View All →</a></div>
          ${flagList || '<div class="ff-empty">No flags created yet</div>'}</div>
        <div class="ff-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0;font-size:16px;font-weight:700;color:#1e1b4b">🧪 Experiments</h3>
          <a href="/school/features/experiments" class="ff-btn ff-btn-sm ff-btn-secondary">View All →</a></div>
          ${exps.map(e => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6">
            <span class="ff-badge" style="background:${e.status==='running'?GL:e.status==='completed'?PL:ML};color:${e.status==='running'?'#065f46':e.status==='completed'?'#4338ca':M}">${e.status}</span>
            <div style="flex:1"><div style="font-size:13px;font-weight:600;color:#1e1b4b">${esc(e.name)}</div><div style="font-size:11px;color:${M}">${esc(e.flag_key)}</div></div>
          </div>`).join('') || '<div class="ff-empty">No experiments yet</div>'}</div>
      </div></div>`;
    res.send(renderPage('Feature Flags Dashboard', html, u, req));
  }));

  // ── ROUTE 2: GET /school/features/flags — List all flags ─
  app.get('/school/features/flags', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const { rows: flags } = await pool.query(
      'SELECT * FROM feature_flags WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    const rows = flags.map(f => {
      const typeColors = { boolean: P, percentage: O, segmented: '#0891b2', multivariate: '#7c3aed' };
      const tc = typeColors[f.flag_type] || M;
      return `<tr>
        <td><strong style="color:#1e1b4b">${esc(f.name)}</strong><div style="font-size:11px;color:${M}">${esc(f.flag_key)}</div></td>
        <td><span class="ff-badge" style="background:${tc}15;color:${tc}">${f.flag_type}</span></td>
        <td>${f.flag_type==='percentage'?`<div style="display:flex;align-items:center;gap:8px"><div class="ff-progress" style="width:80px;height:6px"><div class="ff-progress-bar" style="width:${f.rollout_percentage}%;background:${G}"></div></div><span style="font-size:12px;font-weight:600">${f.rollout_percentage}%</span></div>`:'<span style="color:'+M+'">—</span>'}</td>
        <td>${f.is_enabled ? '<span style="color:'+G+';font-weight:700">● ON</span>' : '<span style="color:'+R+';font-weight:700">○ OFF</span>'}</td>
        <td style="font-size:12px;color:${M}">${fmtDT(f.updated_at)}</td>
        <td><a href="/school/features/flags/${f.id}/edit" class="ff-btn ff-btn-sm ff-btn-primary">Edit</a>
          <form method="POST" action="/school/features/flags/${f.id}" style="display:inline" onsubmit="return confirm('Archive this flag?')"><button class="ff-btn ff-btn-sm ff-btn-danger">🗑</button></form></td>
      </tr>`;
    }).join('');

    const html = SK_CSS + CSS + `<div class="ff-root">${nav('flags')}
      <div class="ff-hero"><h1>🚩 Feature Flags</h1><p>Manage feature toggles, percentage rollouts, and segmented releases</p>
        <div class="ff-hero-actions"><a href="/school/features/flags/create" class="ff-btn" style="background:#818cf8;color:#fff">➕ Create Flag</a></div></div>
      <div class="ff-card"><table class="ff-table"><thead><tr><th>Flag</th><th>Type</th><th>Rollout</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="ff-empty">No feature flags yet</td></tr>'}</tbody></table></div></div>`;
    res.send(renderPage('Feature Flags', html, u, req));
  }));

  // ── ROUTE 3: GET /school/features/flags/create ───────────
  app.get('/school/features/flags/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const { rows: segments } = await pool.query('SELECT id,name FROM feature_segments WHERE tenant_id=$1 ORDER BY name', [tid]);
    const segOpts = segments.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    const html = SK_CSS + CSS + `<div class="ff-root">${nav('flags')}
      <a href="/school/features/flags" style="color:${M};text-decoration:none;font-size:14px;margin-bottom:16px;display:inline-block">← Back to Flags</a>
      <div class="ff-card" style="max-width:700px">
        <h3 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#1e1b4b">➕ Create Feature Flag</h3>
        <form method="POST" action="/school/features/flags/create">
          <div class="ff-form-group"><label>Flag Name *</label><input class="ff-input" name="name" required placeholder="e.g. New Dashboard"></div>
          <div class="ff-form-group"><label>Flag Key *</label><input class="ff-input" name="flag_key" required placeholder="e.g. new_dashboard (unique identifier)"></div>
          <div class="ff-form-group"><label>Description</label><textarea class="ff-input" name="description" rows="3" placeholder="What does this flag control?"></textarea></div>
          <div class="ff-grid-2">
            <div class="ff-form-group"><label>Type</label><select class="ff-select" name="flag_type">
              <option value="boolean">Boolean (On/Off)</option><option value="percentage">Percentage Rollout</option>
              <option value="segmented">Segmented</option><option value="multivariate">Multivariate (A/B)</option></select></div>
            <div class="ff-form-group"><label>Default State</label><select class="ff-select" name="is_enabled">
              <option value="false">Disabled (Off)</option><option value="true">Enabled (On)</option></select></div>
          </div>
          <div class="ff-form-group" id="rollout-group" style="display:none"><label>Rollout Percentage (0-100)</label>
            <input class="ff-input" type="number" name="rollout_percentage" min="0" max="100" value="50">
            <div class="ff-progress" style="margin-top:6px;height:8px"><div class="ff-progress-bar" id="rollout-preview" style="width:50%;background:${G}"></div></div></div>
          <div class="ff-form-group" id="segments-group" style="display:none"><label>Target Segments</label>
            <select class="ff-select" name="segments" multiple style="min-height:100px">${segOpts || '<option disabled>No segments — create one first</option>'}</select></div>
          <button type="submit" class="ff-btn ff-btn-primary" style="margin-top:8px">💾 Create Flag</button>
        </form></div>
      <script>
        document.querySelector('[name=flag_type]').addEventListener('change',function(){
          document.getElementById('rollout-group').style.display=this.value==='percentage'?'block':'none';
          document.getElementById('segments-group').style.display=this.value==='segmented'?'block':'none';});
        document.querySelector('[name=rollout_percentage]')?.addEventListener('input',function(){
          document.getElementById('rollout-preview').style.width=this.value+'%';});
      </script></div>`;
    res.send(renderPage('Create Flag', html, u, req));
  }));

  // ── ROUTE 4: POST /school/features/flags/create ──────────
  app.post('/school/features/flags/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const { name, flag_key, description, flag_type='boolean', is_enabled='false', rollout_percentage=100, segments=[] } = req.body;
    const key = flag_key.replace(/\s+/g, '_').toLowerCase().replace(/[^a-z0-9_]/g, '');
    const segIds = Array.isArray(segments) ? segments : [segments];
    const targetSegs = segIds.filter(Boolean).map(Number);
    try {
      const { rows } = await pool.query(
        `INSERT INTO feature_flags (tenant_id,flag_key,name,description,is_enabled,flag_type,rollout_percentage,target_segments,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [tid, key, name, description, is_enabled==='true', flag_type, Math.min(100, Math.max(0, parseInt(rollout_percentage)||100)), JSON.stringify(targetSegs), u.email]);
      await logAudit(tid, rows[0].id, null, 'flag_created', null, { name, key, flag_type }, req);
      audit(u.email, 'flag_created', `Created flag: ${name} (${key})`);
    } catch(e) {
      if (e.code === '23505') return res.send('<div class="ff-alert ff-alert-warn">⚠️ Flag key "'+esc(key)+'" already exists. <a href="/school/features/flags/create">Try again</a></div>');
      throw e;
    }
    res.redirect('/school/features/flags?msg=Flag+created');
  }));

  // ── ROUTE 5: POST /school/features/flags/:id/toggle ──────
  app.post('/school/features/flags/:id/toggle', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user, fid = req.params.id;
    const { rows: flag } = await pool.query('SELECT * FROM feature_flags WHERE id=$1 AND tenant_id=$2', [fid, tid]);
    if (!flag.length) return res.status(404).json({ error: 'Flag not found' });
    const oldState = flag[0].is_enabled;
    await pool.query('UPDATE feature_flags SET is_enabled=NOT is_enabled, updated_at=NOW() WHERE id=$1 AND tenant_id=$2', [fid, tid]);
    await logAudit(tid, parseInt(fid), null, 'flag_toggled', { is_enabled: oldState }, { is_enabled: !oldState }, req);
    res.json({ success: true, is_enabled: !oldState });
  }));

  // ── ROUTE 6: GET /school/features/flags/:id/edit ─────────
  app.get('/school/features/flags/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user, fid = req.params.id;
    const { rows: flag } = await pool.query('SELECT * FROM feature_flags WHERE id=$1 AND tenant_id=$2', [fid, tid]);
    if (!flag.length) return res.status(404).send('Flag not found');
    const f = flag[0];
    const { rows: segments } = await pool.query('SELECT id,name FROM feature_segments WHERE tenant_id=$1 ORDER BY name', [tid]);
    const selSegs = typeof f.target_segments === 'string' ? JSON.parse(f.target_segments||'[]') : (f.target_segments||[]);
    const segOpts = segments.map(s => `<option value="${s.id}" ${selSegs.includes(s.id)?'selected':''}>${esc(s.name)}</option>`).join('');
    const typeOpts = ['boolean','percentage','segmented','multivariate'].map(t =>
      `<option value="${t}" ${f.flag_type===t?'selected':''}>${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('');

    const html = SK_CSS + CSS + `<div class="ff-root">${nav('flags')}
      <a href="/school/features/flags" style="color:${M};text-decoration:none;font-size:14px;margin-bottom:16px;display:inline-block">← Back to Flags</a>
      <div class="ff-card" style="max-width:700px">
        <h3 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#1e1b4b">✏️ Edit: ${esc(f.name)}</h3>
        <form method="POST" action="/school/features/flags/${fid}/edit">
          <div class="ff-form-group"><label>Flag Name *</label><input class="ff-input" name="name" value="${esc(f.name)}" required></div>
          <div class="ff-form-group"><label>Flag Key</label><input class="ff-input" name="flag_key" value="${esc(f.flag_key)}" disabled style="background:#f9fafb"></div>
          <div class="ff-form-group"><label>Description</label><textarea class="ff-input" name="description" rows="3">${esc(f.description||'')}</textarea></div>
          <div class="ff-grid-2">
            <div class="ff-form-group"><label>Type</label><select class="ff-select" name="flag_type" onchange="document.getElementById('rollout-group').style.display=this.value==='percentage'?'block':'none';document.getElementById('segments-group').style.display=this.value==='segmented'?'block':'none'">${typeOpts}</select></div>
            <div class="ff-form-group"><label>Status</label><select class="ff-select" name="is_enabled">
              <option value="false" ${!f.is_enabled?'selected':''}>Disabled</option><option value="true" ${f.is_enabled?'selected':''}>Enabled</option></select></div>
          </div>
          <div class="ff-form-group" id="rollout-group" style="display:${f.flag_type==='percentage'?'block':'none'}"><label>Rollout Percentage</label>
            <input class="ff-input" type="number" name="rollout_percentage" min="0" max="100" value="${f.rollout_percentage}"></div>
          <div class="ff-form-group" id="segments-group" style="display:${f.flag_type==='segmented'?'block':'none'}"><label>Target Segments</label>
            <select class="ff-select" name="segments" multiple style="min-height:100px">${segOpts || '<option disabled>No segments</option>'}</select></div>
          <button type="submit" class="ff-btn ff-btn-primary">💾 Save Changes</button>
          <a href="/school/features/flags" class="ff-btn ff-btn-secondary" style="margin-left:8px">Cancel</a>
        </form></div></div>`;
    res.send(renderPage('Edit Flag', html, u, req));
  }));

  // ── ROUTE 7: POST /school/features/flags/:id/edit ────────
  app.post('/school/features/flags/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user, fid = req.params.id;
    const { name, description, flag_type, is_enabled, rollout_percentage, segments=[] } = req.body;
    const { rows: old } = await pool.query('SELECT * FROM feature_flags WHERE id=$1 AND tenant_id=$2', [fid, tid]);
    if (!old.length) return res.status(404).send('Flag not found');
    const segIds = Array.isArray(segments) ? segments : [segments];
    await pool.query(
      `UPDATE feature_flags SET name=$1,description=$2,is_enabled=$3,flag_type=$4,rollout_percentage=$5,target_segments=$6,updated_at=NOW() WHERE id=$7 AND tenant_id=$8`,
      [name, description, is_enabled==='true', flag_type, Math.min(100, Math.max(0, parseInt(rollout_percentage)||100)), JSON.stringify(segIds.filter(Boolean).map(Number)), fid, tid]);
    await logAudit(tid, parseInt(fid), null, 'flag_updated', old[0], { name, flag_type, is_enabled: is_enabled==='true' }, req);
    res.redirect('/school/features/flags?msg=Flag+updated');
  }));

  // ── ROUTE 8: DELETE /school/features/flags/:id ───────────
  app.delete('/school/features/flags/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), fid = req.params.id;
    const { rows: flag } = await pool.query('SELECT * FROM feature_flags WHERE id=$1 AND tenant_id=$2', [fid, tid]);
    if (!flag.length) return res.status(404).send('Flag not found');
    await pool.query('DELETE FROM feature_flag_assignments WHERE flag_id=$1 AND tenant_id=$2', [fid, tid]);
    await pool.query('DELETE FROM feature_flag_audit WHERE flag_id=$1 AND tenant_id=$2', [fid, tid]);
    await pool.query('DELETE FROM feature_flags WHERE id=$1 AND tenant_id=$2', [fid, tid]);
    await logAudit(tid, parseInt(fid), null, 'flag_deleted', flag[0], null, req);
    res.json({ success: true });
  }));

  // ── ROUTE 9: GET /school/features/experiments — List ─────
  app.get('/school/features/experiments', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const { rows: exps } = await pool.query(
      'SELECT e.*, (SELECT COUNT(*)::int FROM feature_experiment_events ev WHERE ev.experiment_id=e.id) as event_count FROM feature_experiments e WHERE e.tenant_id=$1 ORDER BY e.created_at DESC', [tid]);
    const rows = exps.map(e => {
      const statusStyle = e.status==='running' ? `background:${GL};color:#065f46` : e.status==='completed' ? `background:${PL};color:#4338ca` : e.status==='paused' ? `background:${OL};color:#92400e` : `background:${ML};color:${M}`;
      return `<tr>
        <td><strong style="color:#1e1b4b">${esc(e.name)}</strong><div style="font-size:11px;color:${M}">${esc(e.flag_key)}</div></td>
        <td><span class="ff-badge" style="${statusStyle}">${e.status}</span></td>
        <td>${e.traffic_percentage}%</td>
        <td>${e.event_count}</td>
        <td>${e.start_date ? fmtDT(e.start_date) : '—'}</td>
        <td><a href="/school/features/experiments/${e.id}" class="ff-btn ff-btn-sm ff-btn-primary">View</a>
          <a href="/school/features/experiments/${e.id}/results" class="ff-btn ff-btn-sm ff-btn-secondary">📊 Results</a></td>
      </tr>`;
    }).join('');
    const html = SK_CSS + CSS + `<div class="ff-root">${nav('exp')}
      <div class="ff-hero"><h1>🧪 A/B Experiments</h1><p>Run controlled experiments with statistical analysis</p>
        <div class="ff-hero-actions"><a href="/school/features/experiments/create" class="ff-btn" style="background:#818cf8;color:#fff">➕ New Experiment</a></div></div>
      <div class="ff-card"><table class="ff-table"><thead><tr><th>Experiment</th><th>Status</th><th>Traffic</th><th>Events</th><th>Started</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="ff-empty">No experiments yet</td></tr>'}</tbody></table></div></div>`;
    res.send(renderPage('Experiments', html, u, req));
  }));

  // ── ROUTE 10: GET /school/features/experiments/create ────
  app.get('/school/features/experiments/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const { rows: flags } = await pool.query('SELECT flag_key,name FROM feature_flags WHERE tenant_id=$1 ORDER BY name', [tid]);
    const flagOpts = flags.map(f => `<option value="${f.flag_key}">${esc(f.name)} (${f.flag_key})</option>`).join('');
    const html = SK_CSS + CSS + `<div class="ff-root">${nav('exp')}
      <a href="/school/features/experiments" style="color:${M};text-decoration:none;font-size:14px;margin-bottom:16px;display:inline-block">← Back to Experiments</a>
      <div class="ff-card" style="max-width:700px">
        <h3 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#1e1b4b">🧪 Create Experiment</h3>
        <form method="POST" action="/school/features/experiments/create">
          <div class="ff-form-group"><label>Experiment Name *</label><input class="ff-input" name="name" required placeholder="e.g. Red Button vs Blue Button"></div>
          <div class="ff-form-group"><label>Feature Flag *</label><select class="ff-select" name="flag_key">${flagOpts || '<option disabled>No flags — create one first</option>'}</select></div>
          <div class="ff-form-group"><label>Description</label><textarea class="ff-input" name="description" rows="2" placeholder="Hypothesis and goals"></textarea></div>
          <div class="ff-grid-2">
            <div class="ff-form-group"><label>Traffic %</label><input class="ff-input" type="number" name="traffic_percentage" min="1" max="100" value="50"></div>
            <div class="ff-form-group"><label>Target Metric</label><input class="ff-input" name="target_metric" placeholder="e.g. click_rate, conversion"></div>
          </div>
          <div class="ff-form-group"><label>Variants (JSON: [{name,weight}])</label>
            <input class="ff-input" name="variants" value='[{"name":"control","weight":50},{"name":"treatment","weight":50}]'></div>
          <button type="submit" class="ff-btn ff-btn-primary">🚀 Create Experiment</button>
        </form></div></div>`;
    res.send(renderPage('Create Experiment', html, u, req));
  }));

  // ── ROUTE 11: POST /school/features/experiments/create ───
  app.post('/school/features/experiments/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const { name, flag_key, description, traffic_percentage=50, target_metric, variants } = req.body;
    let parsedVariants = variants;
    try { parsedVariants = typeof variants === 'string' ? JSON.parse(variants) : variants; } catch { parsedVariants = [{ name:'control', weight:50 },{ name:'treatment', weight:50 }]; }
    const { rows } = await pool.query(
      `INSERT INTO feature_experiments (tenant_id,name,description,flag_key,status,traffic_percentage,variants,target_metric,created_by) VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8) RETURNING id`,
      [tid, name, description, flag_key, Math.min(100, Math.max(1, parseInt(traffic_percentage)||50)), JSON.stringify(parsedVariants), target_metric, u.email]);
    await logAudit(tid, null, rows[0].id, 'experiment_created', null, { name, flag_key }, req);
    res.redirect('/school/features/experiments?msg=Experiment+created');
  }));

  // ── ROUTE 12: GET /school/features/experiments/:id ───────
  app.get('/school/features/experiments/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user, eid = req.params.id;
    const { rows: exp } = await pool.query('SELECT * FROM feature_experiments WHERE id=$1 AND tenant_id=$2', [eid, tid]);
    if (!exp.length) return res.status(404).send('Experiment not found');
    const e = exp[0];
    const variants = typeof e.variants === 'string' ? JSON.parse(e.variants) : e.variants;
    const { rows: events } = await pool.query(
      'SELECT variant, event_type, COUNT(*)::int as cnt FROM feature_experiment_events WHERE experiment_id=$1 GROUP BY variant, event_type ORDER BY variant', [eid]);
    const variantMap = {};
    events.forEach(ev => { if (!variantMap[ev.variant]) variantMap[ev.variant] = {}; variantMap[ev.variant][ev.event_type] = ev.cnt; });

    const variantCards = variants.map(v => {
      const stats = variantMap[v.name] || {};
      const views = stats.view || 0, convs = stats.conversion || 0;
      const rate = views > 0 ? Math.round(convs / views * 1000) / 10 : 0;
      return `<div class="ff-variant-card ${rate>0?'':''}">
        <h4 style="margin:0 0 8px;color:#1e1b4b">${esc(v.name)}</h4>
        <div style="font-size:12px;color:${M}">Weight: ${v.weight}%</div>
        <div style="margin-top:8px;display:grid;gap:4px">
          <div style="display:flex;justify-content:space-between;font-size:13px"><span>Views</span><strong>${views}</strong></div>
          <div style="display:flex;justify-content:space-between;font-size:13px"><span>Conversions</span><strong>${convs}</strong></div>
          <div style="display:flex;justify-content:space-between;font-size:13px"><span>Rate</span><strong style="color:${P}">${rate}%</strong></div>
        </div></div>`;
    }).join('');

    const actions = [];
    if (e.status === 'draft') actions.push(`<form method="POST" action="/school/features/experiments/${eid}/start"><button class="ff-btn ff-btn-success" type="submit">▶ Start</button></form>`);
    if (e.status === 'running') {
      actions.push(`<form method="POST" action="/school/features/experiments/${eid}/pause"><button class="ff-btn ff-btn-secondary" type="submit">⏸ Pause</button></form>`);
      actions.push(`<form method="POST" action="/school/features/experiments/${eid}/complete"><button class="ff-btn ff-btn-primary" type="submit" onclick="return confirm('Complete this experiment?')">✓ Complete</button></form>`);
    }

    const html = SK_CSS + CSS + `<div class="ff-root">${nav('exp')}
      <a href="/school/features/experiments" style="color:${M};text-decoration:none;font-size:14px;margin-bottom:16px;display:inline-block">← Back to Experiments</a>
      <div class="ff-hero"><h1>🧪 ${esc(e.name)}</h1><p>${esc(e.description||e.flag_key)} · Target: ${esc(e.target_metric||'N/A')}</p>
        <div class="ff-hero-actions">
          <span class="ff-badge" style="background:rgba(255,255,255,.2);color:#fff;font-size:13px">${e.status.toUpperCase()}</span>
          ${actions.join(' ')}</div></div>
      <div class="ff-card" style="margin-bottom:16px">
        <h3 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#1e1b4b">📊 Variant Overview</h3>
        <div style="display:flex;gap:14px;flex-wrap:wrap">${variantCards}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="/school/features/experiments/${eid}/results" class="ff-btn ff-btn-primary">📊 Detailed Results</a>
        <a href="/school/features/experiments" class="ff-btn ff-btn-secondary">← All Experiments</a>
      </div></div>`;
    res.send(renderPage('Experiment: ' + e.name, html, u, req));
  }));

  // ── ROUTE 13: POST start/pause/complete experiments ──────
  app.post('/school/features/experiments/:id/start', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), eid = req.params.id;
    await pool.query("UPDATE feature_experiments SET status='running',start_date=NOW(),updated_at=NOW() WHERE id=$1 AND tenant_id=$2", [eid, tid]);
    await logAudit(tid, null, parseInt(eid), 'experiment_started', null, null, req);
    res.redirect(`/school/features/experiments/${eid}`);
  }));
  app.post('/school/features/experiments/:id/pause', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), eid = req.params.id;
    await pool.query("UPDATE feature_experiments SET status='paused',updated_at=NOW() WHERE id=$1 AND tenant_id=$2", [eid, tid]);
    await logAudit(tid, null, parseInt(eid), 'experiment_paused', null, null, req);
    res.redirect(`/school/features/experiments/${eid}`);
  }));
  app.post('/school/features/experiments/:id/complete', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), eid = req.params.id;
    const winner = req.body.winner || '';
    await pool.query("UPDATE feature_experiments SET status='completed',end_date=NOW(),updated_at=NOW() WHERE id=$1 AND tenant_id=$2", [eid, tid]);
    if (winner) await pool.query("UPDATE feature_experiments SET variants=variants||'{\"winner\":\""+winner.replace(/"/g,'\\"')+"\"}'::jsonb WHERE id=$1", [eid]);
    await logAudit(tid, null, parseInt(eid), 'experiment_completed', null, { winner }, req);
    res.redirect(`/school/features/experiments/${eid}`);
  }));

  // ── ROUTE 14: GET /school/features/experiments/:id/results
  app.get('/school/features/experiments/:id/results', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user, eid = req.params.id;
    const { rows: exp } = await pool.query('SELECT * FROM feature_experiments WHERE id=$1 AND tenant_id=$2', [eid, tid]);
    if (!exp.length) return res.status(404).send('Experiment not found');
    const e = exp[0];
    const variants = typeof e.variants === 'string' ? JSON.parse(e.variants) : e.variants;
    const winnerName = e.variants?.winner || '';

    const { rows: events } = await pool.query(
      'SELECT variant, event_type, COUNT(*)::int as cnt FROM feature_experiment_events WHERE experiment_id=$1 GROUP BY variant, event_type', [eid]);
    const variantMap = {};
    events.forEach(ev => { if (!variantMap[ev.variant]) variantMap[ev.variant] = {}; variantMap[ev.variant][ev.event_type] = ev.cnt; });

    const variantNames = variants.map(v => v.name).filter(n => n !== 'winner');
    let comparisonHtml = '';
    if (variantNames.length >= 2) {
      const a = variantNames[0], b = variantNames[1];
      const aStats = variantMap[a] || {}, bStats = variantMap[b] || {};
      const aViews = aStats.view || 0, aConvs = aStats.conversion || 0;
      const bViews = bStats.view || 0, bConvs = bStats.conversion || 0;
      const test = chiSquared(aConvs, aViews, bConvs, bViews);
      const aCI = confidenceInterval(aConvs, aViews), bCI = confidenceInterval(bConvs, bViews);
      const uplift = bCI.rate > 0 && aCI.rate > 0 ? Math.round((bCI.rate - aCI.rate) / aCI.rate * 1000) / 10 : 0;
      const isWinner = test.significant && uplift > 0;

      comparisonHtml = `<div class="ff-card" style="margin-bottom:16px">
        <h3 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#1e1b4b">📈 Statistical Analysis</h3>
        ${test.significant ? `<div class="ff-alert ff-alert-success">✅ <strong>Statistically Significant!</strong> p-value: ${test.pValue} (< 0.05)${isWinner ? ' — <strong>'+esc(b)+'</strong> is the winner!' : ''}</div>` :
          `<div class="ff-alert ff-alert-warn">⚠️ <strong>Not yet significant.</strong> p-value: ${test.pValue} — collect more data.</div>`}
        <div class="ff-grid-2" style="margin-top:12px">
          <div style="padding:14px;border:2px solid ${a===winnerName?G:'#e5e7eb'};border-radius:10px;${a===winnerName?'background:'+GL:''}">
            <div style="display:flex;justify-content:space-between;align-items:center"><strong style="color:#1e1b4b">${esc(a)}</strong>${a===winnerName?'<span class="ff-badge" style="background:'+G+';color:#fff">🏆 Winner</span>':''}</div>
            <div style="margin-top:8px;font-size:13px;color:${M}">Conversion: <strong style="color:#1e1b4b">${(aCI.rate*100).toFixed(1)}%</strong></div>
            <div style="font-size:12px;color:${M}">95% CI: [${(aCI.low*100).toFixed(1)}%, ${(aCI.high*100).toFixed(1)}%]</div>
            <div style="font-size:12px;color:${M}">Views: ${aViews} · Conversions: ${aConvs}</div>
          </div>
          <div style="padding:14px;border:2px solid ${b===winnerName?G:'#e5e7eb'};border-radius:10px;${b===winnerName?'background:'+GL:''}">
            <div style="display:flex;justify-content:space-between;align-items:center"><strong style="color:#1e1b4b">${esc(b)}</strong>${b===winnerName?'<span class="ff-badge" style="background:'+G+';color:#fff">🏆 Winner</span>':''}</div>
            <div style="margin-top:8px;font-size:13px;color:${M}">Conversion: <strong style="color:#1e1b4b">${(bCI.rate*100).toFixed(1)}%</strong></div>
            <div style="font-size:12px;color:${M}">95% CI: [${(bCI.low*100).toFixed(1)}%, ${(bCI.high*100).toFixed(1)}%]</div>
            <div style="font-size:12px;color:${M}">Views: ${bViews} · Conversions: ${bConvs}</div>
          </div>
        </div>
        <div style="margin-top:12px;padding:10px;background:#f9fafb;border-radius:8px;font-size:13px">
          <strong>Chi-squared:</strong> ${test.chi2} · <strong>Uplift:</strong> <span style="color:${uplift>0?G:R}">${uplift>0?'+':''}${uplift}%</span> · <strong>Total Events:</strong> ${aViews+bViews}</div>
      </div>`;
    }

    const variantDetails = variants.filter(v => v.name !== 'winner').map(v => {
      const stats = variantMap[v.name] || {};
      return `<div style="padding:12px;border:1px solid #e5e7eb;border-radius:8px">
        <strong>${esc(v.name)}</strong> ${v.name===winnerName?'<span class="ff-badge" style="background:'+G+';color:#fff">🏆 Winner</span>':''}
        <div style="font-size:12px;color:${M};margin-top:4px">Views: ${stats.view||0} · Conversions: ${stats.conversion||0} · Weight: ${v.weight}%</div></div>`;
    }).join('');

    const html = SK_CSS + CSS + `<div class="ff-root">${nav('exp')}
      <a href="/school/features/experiments/${eid}" style="color:${M};text-decoration:none;font-size:14px;margin-bottom:16px;display:inline-block">← Back to Experiment</a>
      <div class="ff-hero"><h1>📊 Results: ${esc(e.name)}</h1><p>Conversion analysis with 95% confidence intervals</p></div>
      ${comparisonHtml}
      <div class="ff-card" style="margin-bottom:16px"><h3 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#1e1b4b">📋 All Variants</h3>
        ${variantDetails}</div>
      ${e.status==='running'?`<form method="POST" action="/school/features/experiments/${eid}/complete" style="margin-bottom:16px">
        <div class="ff-grid-2" style="margin-bottom:12px">
          <div class="ff-form-group"><label>Select Winner</label><select class="ff-select" name="winner">${variants.filter(v=>v.name!=='winner').map(v=>`<option value="${v.name}">${v.name}</option>`).join('')}</select></div>
          <div style="display:flex;align-items:flex-end"><button type="submit" class="ff-btn ff-btn-primary" onclick="return confirm('Complete and declare winner?')">✓ Complete & Declare Winner</button></div>
        </div></form>`:''}
      <a href="/school/features/experiments" class="ff-btn ff-btn-secondary">← All Experiments</a>
    </div>`;
    res.send(renderPage('Experiment Results', html, u, req));
  }));

  // ── ROUTE 15: GET /school/features/audit ─────────────────
  app.get('/school/features/audit', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const page = parseInt(req.query.page) || 1, limit = 30, offset = (page - 1) * limit;
    const { rows: logs } = await pool.query(
      'SELECT a.*, f.name as flag_name, e.name as exp_name FROM feature_flag_audit a LEFT JOIN feature_flags f ON f.id=a.flag_id LEFT JOIN feature_experiments e ON e.id=a.experiment_id WHERE a.tenant_id=$1 ORDER BY a.created_at DESC LIMIT $2 OFFSET $3', [tid, limit, offset]);
    const { rows: cnt } = await pool.query('SELECT COUNT(*)::int as c FROM feature_flag_audit WHERE tenant_id=$1', [tid]);
    const totalPages = Math.ceil(cnt[0].c / limit);
    const rows = logs.map(l => `<tr>
      <td><span class="ff-badge" style="background:${PL};color:#4338ca">${esc(l.action)}</span></td>
      <td>${esc(l.flag_name || l.exp_name || '—')}</td>
      <td style="font-size:12px">${esc(l.user_email||'—')}</td>
      <td style="font-size:12px;color:${M}">${esc(l.ip_address||'—')}</td>
      <td style="font-size:12px;color:${M}">${fmtDT(l.created_at)}</td>
    </tr>`).join('');

    const html = SK_CSS + CSS + `<div class="ff-root">${nav('audit')}
      <div class="ff-hero"><h1>📝 Audit Log</h1><p>Track all flag and experiment changes</p></div>
      <div class="ff-card"><table class="ff-table"><thead><tr><th>Action</th><th>Target</th><th>User</th><th>IP</th><th>Timestamp</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="ff-empty">No audit entries yet</td></tr>'}</tbody></table>
      ${totalPages > 1 ? `<div style="display:flex;gap:6px;justify-content:center;margin-top:16px">${Array.from({length:totalPages},(_, i)=>`<a href="?page=${i+1}" class="ff-btn ff-btn-sm ${page===i+1?'ff-btn-primary':'ff-btn-secondary'}">${i+1}</a>`).join('')}</div>` : ''}
      </div></div>`;
    res.send(renderPage('Audit Log', html, u, req));
  }));

  // ── ROUTE 16: POST /school/features/check — API ──────────
  app.post('/school/features/check', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), email = req.session?.user?.email || '';
    const { flag_key } = req.body;
    if (!flag_key) return res.status(400).json({ error: 'flag_key required' });
    const enabled = await app._isFeatureEnabled(flag_key, req);
    let variant = null;
    const { rows: exps } = await pool.query(
      "SELECT * FROM feature_experiments WHERE tenant_id=$1 AND flag_key=$2 AND status='running'", [tid, flag_key]);
    if (exps.length) {
      const exp = exps[0];
      const vs = typeof exp.variants === 'string' ? JSON.parse(exp.variants) : exp.variants;
      const idx = consistentHash(email + exp.id, 100);
      let cum = 0;
      for (const v of vs) { if (v.name === 'winner') continue; cum += v.weight; if (idx < cum) { variant = v.name; break; } }
      if (!variant && vs.length) variant = vs[0].name;
    }
    // Track view event
    if (exps.length && variant) {
      const { rows: existing } = await pool.query('SELECT id FROM feature_flag_assignments WHERE flag_id=$1 AND user_email=$2', [exps[0].id, email]);
      if (!existing.length) await pool.query('INSERT INTO feature_flag_assignments (tenant_id,flag_id,user_email,variant) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [tid, exps[0].id, email, variant]);
      await pool.query('INSERT INTO feature_experiment_events (tenant_id,experiment_id,user_email,variant,event_type) VALUES ($1,$2,$3,$4,$5)', [tid, exps[0].id, email, variant, 'view']);
    }
    res.json({ flag_key, enabled, variant });
  }));

  // ── ROUTE 17: GET /school/features/segments ──────────────
  app.get('/school/features/segments', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const { rows: segments } = await pool.query('SELECT * FROM feature_segments WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);

    const segCards = segments.map(s => {
      const rules = typeof s.rules === 'string' ? JSON.parse(s.rules||'{}') : (s.rules||{});
      const ruleKeys = Object.keys(rules);
      return `<div class="ff-card" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><strong style="color:#1e1b4b">${esc(s.name)}</strong><div style="font-size:12px;color:${M}">${esc(s.description||'No description')}</div></div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="ff-badge" style="background:${PL};color:#4338ca">${s.user_count} users</span>
            <form method="POST" action="/school/features/segments/${s.id}/delete" style="display:inline" onsubmit="return confirm('Delete this segment?')"><button class="ff-btn ff-btn-sm ff-btn-danger">🗑</button></form>
          </div></div>
        ${ruleKeys.length ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">${ruleKeys.map(k=>`<span class="ff-badge" style="background:${ML};color:${M}">${esc(k)}: ${esc(String(rules[k]))}</span>`).join('')}</div>` : ''}
      </div>`;
    }).join('');

    const html = SK_CSS + CSS + `<div class="ff-root">${nav('seg')}
      <div class="ff-hero"><h1>👥 User Segments</h1><p>Define audience segments for targeted feature rollouts</p></div>
      <div class="ff-card" style="max-width:600px;margin-bottom:20px">
        <h3 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#1e1b4b">➕ Create Segment</h3>
        <form method="POST" action="/school/features/segments/create">
          <div class="ff-form-group"><label>Segment Name *</label><input class="ff-input" name="name" required placeholder="e.g. Beta Testers"></div>
          <div class="ff-form-group"><label>Description</label><input class="ff-input" name="description" placeholder="Who is in this segment?"></div>
          <div class="ff-form-group"><label>Rules (JSON, e.g. {"role":"teacher","grade":"10"})</label>
            <textarea class="ff-input" name="rules" rows="2" placeholder='{"role":"teacher"}'></textarea></div>
          <button type="submit" class="ff-btn ff-btn-primary">💾 Create Segment</button>
        </form></div>
      <h3 style="font-size:16px;font-weight:700;color:#1e1b4b;margin-bottom:12px">Existing Segments (${segments.length})</h3>
      ${segCards || '<div class="ff-empty">No segments created yet</div>'}
    </div>`;
    res.send(renderPage('Segments', html, u, req));
  }));

  // ── ROUTE 18: POST /school/features/segments/create ──────
  app.post('/school/features/segments/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const { name, description, rules } = req.body;
    let parsedRules = {};
    try { parsedRules = typeof rules === 'string' ? JSON.parse(rules) : (rules || {}); } catch { parsedRules = {}; }
    await pool.query(
      'INSERT INTO feature_segments (tenant_id,name,description,rules) VALUES ($1,$2,$3,$4)', [tid, name, description, JSON.stringify(parsedRules)]);
    res.redirect('/school/features/segments?msg=Segment+created');
  }));

  // ── ROUTE 19: POST /school/features/segments/:id/delete ──
  app.post('/school/features/segments/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), sid = req.params.id;
    await pool.query('DELETE FROM feature_segments WHERE id=$1 AND tenant_id=$2', [sid, tid]);
    res.redirect('/school/features/segments?msg=Segment+deleted');
  }));

  // ── ROUTE 20: POST track conversion event ────────────────
  app.post('/school/features/experiments/:id/track', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), eid = req.params.id;
    const email = req.session?.user?.email || '';
    const { variant, event_type='conversion', event_value=1 } = req.body;
    if (!variant) return res.status(400).json({ error: 'variant required' });
    await pool.query(
      'INSERT INTO feature_experiment_events (tenant_id,experiment_id,user_email,variant,event_type,event_value) VALUES ($1,$2,$3,$4,$5,$6)',
      [tid, parseInt(eid), email, variant, event_type, parseFloat(event_value)||0]);
    res.json({ success: true });
  }));
};
