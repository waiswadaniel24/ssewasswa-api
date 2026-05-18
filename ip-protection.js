/**
 * IP Whitelist/Blacklist Protection Module — School SaaS Portal
 * Features: IP rules management, block logging, bulk import/export,
 * real-time IP checking, protection settings, CIDR range support.
 *
 * Usage: const ipProtection = require('./ip-protection');
 *        ipProtection(app, pool, { esc, renderPage, ah, requireAuth, audit });
 */
module.exports = function(app, pool, opts) {
  /* ── Helpers ────────────────────────────────────────────────── */
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const isAdmin = (req) => { const r = req.session?.user?.role; return r === 'admin' || r === 'super_admin'; };

  /* ── Color Theme — Dark + Blue (#3b82f6) ────────────────────── */
  const C = {
    bg:       '#0f172a',
    surface:  '#1e293b',
    surface2: '#334155',
    border:   '#475569',
    text:     '#f1f5f9',
    textDim:  '#94a3b8',
    textMuted:'#64748b',
    primary:  '#3b82f6',
    primaryBg:'#1e3a5f',
    green:    '#22c55e',
    greenBg:  '#14532d',
    red:      '#ef4444',
    redBg:    '#7f1d1d',
    amber:    '#f59e0b',
    amberBg:  '#78350f',
    purple:   '#a855f7',
    purpleBg: '#581c87',
    cyan:     '#06b6d4',
    cyanBg:   '#164e63',
    white:    '#ffffff',
  };

  /* ── Inline CSS ─────────────────────────────────────────────── */
  const CSS = `
  .ip-root{max-width:1100px;margin:0 auto;padding:24px 16px;font-family:system-ui,-apple-system,sans-serif;color:${C.text};background:${C.bg};min-height:60vh;border-radius:12px}
  .ip-card{background:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:20px;margin-bottom:16px;transition:border-color .2s}
  .ip-card:hover{border-color:${C.primary}}
  .ip-hero{background:linear-gradient(135deg,#1e3a5f,${C.primary});padding:28px 32px;border-radius:14px;margin-bottom:20px;color:#fff;position:relative;overflow:hidden}
  .ip-hero::after{content:'';position:absolute;top:-50px;right:-50px;width:200px;height:200px;border-radius:50%;background:rgba(59,130,246,.15)}
  .ip-hero h1{font-size:1.6rem;font-weight:800;margin:0 0 4px;position:relative;z-index:1}
  .ip-hero p{opacity:.85;margin:0;font-size:.9rem;position:relative;z-index:1}
  .ip-hero-actions{margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;position:relative;z-index:1}
  .ip-nav{display:flex;gap:4px;margin-bottom:20px;flex-wrap:wrap;padding:10px 14px;background:${C.surface};border-radius:12px;border:1px solid ${C.border}}
  .ip-nav a{padding:8px 16px;border-radius:8px;font-size:.8rem;font-weight:600;text-decoration:none;color:${C.textDim};background:${C.surface2};transition:.15s;border:1px solid transparent}
  .ip-nav a:hover{color:#fff;background:${C.primaryBg};border-color:${C.primary}}
  .ip-nav a.active{background:${C.primary};color:#fff;border-color:${C.primary};box-shadow:0 2px 8px rgba(59,130,246,.3)}
  .ip-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}
  .ip-stat{background:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:18px;text-align:center;transition:.2s}
  .ip-stat:hover{border-color:${C.primary};transform:translateY(-2px)}
  .ip-stat-icon{font-size:28px;margin-bottom:6px}
  .ip-stat-val{font-size:28px;font-weight:800;color:#fff}
  .ip-stat-lbl{font-size:.7rem;color:${C.textMuted};margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
  .ip-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:8px;font-size:.8rem;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
  .ip-btn:hover{opacity:.9;transform:translateY(-1px)}
  .ip-btn-primary{background:${C.primary};color:#fff}
  .ip-btn-success{background:${C.green};color:#fff}
  .ip-btn-danger{background:${C.red};color:#fff}
  .ip-btn-secondary{background:${C.surface2};color:${C.textDim};border:1px solid ${C.border}}
  .ip-btn-amber{background:${C.amber};color:#000}
  .ip-btn-sm{padding:6px 12px;font-size:.75rem;border-radius:6px}
  .ip-table{width:100%;border-collapse:collapse;font-size:.8rem}
  .ip-table th{padding:10px 12px;text-align:left;border-bottom:2px solid ${C.border};color:${C.textDim};font-weight:700;font-size:.7rem;text-transform:uppercase;letter-spacing:.5px;background:${C.surface2}}
  .ip-table td{padding:10px 12px;border-bottom:1px solid rgba(71,85,105,.4);color:${C.text}}
  .ip-table tr:nth-child(even){background:rgba(51,65,85,.3)}
  .ip-table tr:hover{background:${C.primaryBg}}
  .ip-form-group{margin-bottom:14px}
  .ip-form-group label{display:block;font-size:.8rem;font-weight:600;color:${C.text};margin-bottom:4px}
  .ip-input{width:100%;padding:10px 14px;border:2px solid ${C.border};border-radius:8px;font-size:.85rem;transition:.15s;box-sizing:border-box;font-family:inherit;background:${C.surface2};color:${C.text};border:1px solid ${C.border}}
  .ip-input:focus{outline:none;border-color:${C.primary};box-shadow:0 0 0 3px rgba(59,130,246,.2)}
  .ip-input::placeholder{color:${C.textMuted}}
  .ip-select{width:100%;padding:10px 14px;border:1px solid ${C.border};border-radius:8px;font-size:.85rem;background:${C.surface2};color:${C.text};box-sizing:border-box;font-family:inherit}
  .ip-select:focus{outline:none;border-color:${C.primary}}
  .ip-textarea{width:100%;padding:10px 14px;border:1px solid ${C.border};border-radius:8px;font-size:.85rem;resize:vertical;box-sizing:border-box;font-family:inherit;background:${C.surface2};color:${C.text};min-height:80px}
  .ip-textarea:focus{outline:none;border-color:${C.primary}}
  .ip-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .ip-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
  .ip-alert{padding:14px 18px;border-radius:8px;font-size:.85rem;margin-bottom:16px;display:flex;align-items:center;gap:8px}
  .ip-alert-success{background:${C.greenBg};color:${C.green};border:1px solid rgba(34,197,94,.3)}
  .ip-alert-error{background:${C.redBg};color:${C.red};border:1px solid rgba(239,68,68,.3)}
  .ip-alert-info{background:${C.primaryBg};color:#93c5fd;border:1px solid rgba(59,130,246,.3)}
  .ip-alert-warn{background:${C.amberBg};color:${C.amber};border:1px solid rgba(245,158,11,.3)}
  .ip-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.7rem;font-weight:700;text-transform:capitalize}
  .ip-badge-wl{background:${C.greenBg};color:${C.green}}
  .ip-badge-bl{background:${C.redBg};color:${C.red}}
  .ip-badge-on{background:${C.greenBg};color:${C.green}}
  .ip-badge-off{background:${C.surface2};color:${C.textMuted}}
  .ip-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
  .ip-filter label{display:block;font-size:.7rem;font-weight:600;color:${C.textMuted};margin-bottom:3px}
  .ip-filter input,.ip-filter select{padding:8px 12px;border:1px solid ${C.border};border-radius:8px;font-size:.8rem;background:${C.surface2};color:${C.text};font-family:inherit}
  .ip-filter input:focus,.ip-filter select:focus{outline:none;border-color:${C.primary}}
  .ip-pagination{display:flex;justify-content:space-between;align-items:center;margin-top:14px;flex-wrap:wrap;gap:8px;font-size:.8rem;color:${C.textDim}}
  .ip-empty{text-align:center;padding:40px 20px;color:${C.textMuted}}
  .ip-empty-icon{font-size:48px;margin-bottom:10px}
  .ip-code{background:${C.surface2};padding:4px 8px;border-radius:4px;font-family:monospace;font-size:.78rem;color:${C.cyan}}
  .ip-scroll{max-height:400px;overflow-y:auto}
  .ip-timeline{position:relative;padding-left:24px;margin:12px 0}
  .ip-timeline::before{content:'';position:absolute;left:7px;top:4px;bottom:4px;width:2px;background:${C.border}}
  .ip-tl-item{position:relative;margin-bottom:10px;padding:8px 12px;background:${C.surface2};border-radius:8px;font-size:.8rem;border-left:3px solid ${C.primary}}
  .ip-tl-item::before{content:'';position:absolute;left:-24px;top:12px;width:10px;height:10px;border-radius:50%;background:${C.primary};border:2px solid ${C.surface}}
  .ip-tl-time{font-size:.7rem;color:${C.textMuted};margin-top:3px}
  .ip-flex{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .ip-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:.72rem;font-weight:600;cursor:pointer;transition:.15s;border:1px solid ${C.border};background:${C.surface2};color:${C.textDim};text-decoration:none}
  .ip-chip:hover,.ip-chip.active{border-color:${C.primary};color:${C.primary};background:${C.primaryBg}}
  .ip-progress{height:8px;background:${C.surface2};border-radius:4px;overflow:hidden;margin:6px 0}
  .ip-progress-bar{height:100%;background:${C.primary};border-radius:4px;transition:width .4s}
  @media(max-width:768px){
    .ip-grid-2,.ip-grid-3{grid-template-columns:1fr}
    .ip-nav{flex-direction:column;align-items:stretch}
    .ip-stats{grid-template-columns:1fr 1fr}
    .ip-hero{padding:20px}
  }
  `;

  /* ── SQL Migrations ─────────────────────────────────────────── */
  const MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS ip_rules(
    id SERIAL PRIMARY KEY,
    ip_address TEXT NOT NULL,
    ip_range TEXT,
    rule_type TEXT NOT NULL CHECK (rule_type IN ('whitelist','blacklist')),
    reason TEXT,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMPTZ,
    hit_count INT DEFAULT 0,
    last_hit_at TIMESTAMPTZ,
    created_by INT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    school_id INT DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS ip_block_log(
    id SERIAL PRIMARY KEY,
    ip_address TEXT,
    rule_id INT,
    path TEXT,
    method TEXT,
    user_agent TEXT,
    blocked BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    school_id INT DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_iprules_addr ON ip_rules(ip_address);
  CREATE INDEX IF NOT EXISTS idx_iprules_type ON ip_rules(rule_type);
  CREATE INDEX IF NOT EXISTS idx_iprules_active ON ip_rules(is_active);
  CREATE INDEX IF NOT EXISTS idx_iprules_school ON ip_rules(school_id);
  CREATE INDEX IF NOT EXISTS idx_ipblock_ip ON ip_block_log(ip_address);
  CREATE INDEX IF NOT EXISTS idx_ipblock_time ON ip_block_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_ipblock_school ON ip_block_log(school_id);
  CREATE INDEX IF NOT EXISTS idx_ipblock_blocked ON ip_block_log(blocked);
  `;

  async function runMigrations() {
    const stmts = MIGRATIONS.trim().split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of stmts) { try { await pool.query(stmt); } catch(e) { console.error('[IPProtection] Migration error:', e.message); } }
  }
  runMigrations().catch(console.error);

  /* ── Utility Helpers ────────────────────────────────────────── */
  function wrapHTML(title, body, req) {
    return renderPage(title, `<style>${CSS}</style><div class="ip-root">${body}</div>`, req.session?.user, req);
  }

  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '\u2014'; }
  function fmtDateTime(d) { return d ? new Date(d).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '\u2014'; }
  function fmtRelative(d) {
    if (!d) return '';
    const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s/60) + 'm ago';
    if (s < 86400) return Math.floor(s/3600) + 'h ago';
    return Math.floor(s/86400) + 'd ago';
  }

  function ruleTypeBadge(type) {
    return type === 'whitelist'
      ? `<span class="ip-badge ip-badge-wl">\u2705 Whitelist</span>`
      : `<span class="ip-badge ip-badge-bl">\u{1F6AB} Blacklist</span>`;
  }

  function activeBadge(active) {
    return active ? `<span class="ip-badge ip-badge-on">Active</span>` : `<span class="ip-badge ip-badge-off">Inactive</span>`;
  }

  function navHTML(active) {
    const tabs = [
      ['/admin/ip-protection',        '\u{1F3E0} Dashboard'],
      ['/admin/ip-protection/data',   '\u{1F4CB} Rules'],
      ['/admin/ip-protection/block-log','\u{1F4DD} Block Log'],
      ['/admin/ip-protection/settings','\u2699\uFE0F Settings'],
    ];
    return `<nav class="ip-nav">${tabs.map(([href, label]) =>
      `<a class="${href === active ? 'active' : ''}" href="${href}">${label}</a>`
    ).join('')}</nav>`;
  }

  /* ── IP matching helpers (supports single IP & CIDR) ────────── */
  function ipToNum(ip) {
    const parts = ip.split('.').map(Number);
    return ((parts[0]||0) << 24) | ((parts[1]||0) << 16) | ((parts[2]||0) << 8) | (parts[3]||0);
  }

  function isIpInCIDR(ip, cidr) {
    if (!cidr || !ip) return false;
    if (cidr.indexOf('/') === -1) return ip === cidr;
    const [range, bits] = cidr.split('/');
    const mask = ~((1 << (32 - parseInt(bits))) - 1) >>> 0;
    return (ipToNum(ip) & mask) === (ipToNum(range) & mask);
  }

  function isValidIp(ip) {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(o => +o >= 0 && +o <= 255);
  }

  function isValidCIDR(cidr) {
    if (!cidr || cidr.indexOf('/') === -1) return false;
    const [ip, bits] = cidr.split('/');
    if (!isValidIp(ip)) return false;
    const b = parseInt(bits);
    return b >= 0 && b <= 32;
  }

  function getClientIp(req) {
    return req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.connection?.remoteAddress || req.socket?.remoteAddress || '127.0.0.1';
  }

  /* ── Log a blocked request to ip_block_log ──────────────────── */
  async function logBlock(ip, ruleId, req, blocked) {
    try {
      await pool.query(
        'INSERT INTO ip_block_log(ip_address, rule_id, path, method, user_agent, blocked, school_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [ip, ruleId, req.originalUrl || req.path, req.method, req.headers?.['user-agent'] || '', blocked !== false, 1]
      );
    } catch(e) { /* silent */ }
  }

  /* ── Increment hit_count on a rule ──────────────────────────── */
  async function incrementHits(ruleId) {
    try { await pool.query('UPDATE ip_rules SET hit_count = COALESCE(hit_count,0) + 1, last_hit_at = NOW() WHERE id = $1', [ruleId]); } catch(e) { /* silent */ }
  }

  /* ── Exported middleware: check IP against rules ─────────────── */
  async function checkIpMiddleware(req, res, next) {
    try {
      const ip = getClientIp(req);
      const now = new Date();
      const rules = await pool.query(
        "SELECT * FROM ip_rules WHERE is_active = true AND (expires_at IS NULL OR expires_at > $1) ORDER BY created_at ASC",
        [now]
      );
      let blocked = false;
      let matchedRule = null;
      let whitelisted = false;

      for (const rule of rules.rows) {
        if (rule.ip_address && ip === rule.ip_address) {
          if (rule.rule_type === 'blacklist') { blocked = true; matchedRule = rule; }
          else if (rule.rule_type === 'whitelist') { whitelisted = true; break; }
        }
        if (rule.ip_range && isIpInCIDR(ip, rule.ip_range)) {
          if (rule.rule_type === 'blacklist') { blocked = true; matchedRule = rule; }
          else if (rule.rule_type === 'whitelist') { whitelisted = true; break; }
        }
      }

      if (matchedRule) {
        await incrementHits(matchedRule.id);
        await logBlock(ip, matchedRule.id, req, true);
        return res.status(403).send(renderPage('Access Denied',
          `<style>${CSS}</style><div class="ip-root" style="text-align:center;padding:80px 20px">
            <div style="font-size:64px;margin-bottom:16px">\u{1F6AB}</div>
            <h1 style="color:${C.red};margin-bottom:8px">Access Denied</h1>
            <p style="color:${C.textDim};margin-bottom:20px">Your IP address <span class="ip-code">${esc(ip)}</span> has been blocked by security policy.</p>
            <p style="color:${C.textMuted};font-size:.8rem">Reason: ${esc(matchedRule.reason || 'No reason specified')}</p>
            <p style="color:${C.textMuted};font-size:.75rem;margin-top:12px">If you believe this is an error, contact your system administrator.</p>
          </div>`,
          req.session?.user, req
        ));
      }

      req.ipWhitelisted = whitelisted;
      next();
    } catch(e) { next(); }
  }

  /* ══════════════════════════════════════════════════════════════
     ROUTES
     ══════════════════════════════════════════════════════════════ */

  /* 1 ─ GET /admin/ip-protection — Dashboard ──────────────────── */
  app.get('/admin/ip-protection', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const stats = await Promise.all([
      pool.query("SELECT COUNT(*)::int as c FROM ip_rules"),
      pool.query("SELECT COUNT(*)::int as c FROM ip_rules WHERE is_active = true"),
      pool.query("SELECT COUNT(*)::int as c FROM ip_rules WHERE rule_type = 'whitelist'"),
      pool.query("SELECT COUNT(*)::int as c FROM ip_rules WHERE rule_type = 'blacklist'"),
      pool.query("SELECT COUNT(*)::int as c FROM ip_block_log WHERE blocked = true"),
      pool.query("SELECT COUNT(*)::int as c FROM ip_block_log WHERE created_at >= NOW() - INTERVAL '24 hours'"),
      pool.query("SELECT COUNT(*)::int as c FROM ip_rules WHERE expires_at IS NOT NULL AND expires_at <= NOW()"),
      pool.query("SELECT COUNT(*)::int as c FROM ip_rules WHERE hit_count > 0 ORDER BY hit_count DESC LIMIT 1"),
    ]);
    const totalRules    = stats[0].rows[0].c;
    const activeRules   = stats[1].rows[0].c;
    const whitelistCnt  = stats[2].rows[0].c;
    const blacklistCnt  = stats[3].rows[0].c;
    const totalBlocks   = stats[4].rows[0].c;
    const blocks24h     = stats[5].rows[0].c;
    const expiredRules  = stats[6].rows[0].c;

    const recentBlocks = await pool.query(
      'SELECT * FROM ip_block_log WHERE blocked = true ORDER BY created_at DESC LIMIT 8'
    );
    const topRules = await pool.query(
      'SELECT * FROM ip_rules ORDER BY hit_count DESC LIMIT 5'
    );

    const myIp = getClientIp(req);

    const blockTimeline = recentBlocks.rows.map(b => `
      <div class="ip-tl-item">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="ip-code">${esc(b.ip_address)}</span>
          <span style="color:${C.textMuted};font-size:.75rem">${esc(b.method)} ${esc(b.path || '/')}</span>
        </div>
        <div class="ip-tl-time">${fmtRelative(b.created_at)}</div>
      </div>
    `).join('');

    const topRulesHtml = topRules.rows.map(r => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(71,85,105,.3)">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="ip-code">${esc(r.ip_address)}</span>
          ${ruleTypeBadge(r.rule_type)}
        </div>
        <div style="text-align:right">
          <span style="font-weight:700;color:${C.amber}">${r.hit_count || 0}</span>
          <span style="color:${C.textMuted};font-size:.7rem;margin-left:4px">hits</span>
        </div>
      </div>
    `).join('');

    res.send(wrapHTML('IP Protection Dashboard', `
      <div class="ip-hero">
        <h1>\u{1F6E1}\uFE0F IP Protection</h1>
        <p>Whitelist, blacklist, and monitor access by IP address</p>
        <div class="ip-hero-actions">
          <a href="/admin/ip-protection/data" class="ip-btn" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.25)">\u{1F4CB} Manage Rules</a>
          <a href="/admin/ip-protection/block-log" class="ip-btn" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.25)">\u{1F4DD} Block Log</a>
          <a href="/admin/ip-protection/my-ip" class="ip-btn" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.25)">My IP: ${esc(myIp)}</a>
        </div>
      </div>

      ${navHTML('/admin/ip-protection')}

      <div class="ip-stats">
        <div class="ip-stat"><div class="ip-stat-icon">\u{1F4CB}</div><div class="ip-stat-val">${totalRules}</div><div class="ip-stat-lbl">Total Rules</div></div>
        <div class="ip-stat"><div class="ip-stat-icon">\u2705</div><div class="ip-stat-val">${activeRules}</div><div class="ip-stat-lbl">Active Rules</div></div>
        <div class="ip-stat"><div class="ip-stat-icon">\u{1F49A}</div><div class="ip-stat-val">${whitelistCnt}</div><div class="ip-stat-lbl">Whitelisted</div></div>
        <div class="ip-stat"><div class="ip-stat-icon">\u{1F534}</div><div class="ip-stat-val">${blacklistCnt}</div><div class="ip-stat-lbl">Blacklisted</div></div>
        <div class="ip-stat"><div class="ip-stat-icon">\u{1F6AB}</div><div class="ip-stat-val">${totalBlocks}</div><div class="ip-stat-lbl">Total Blocks</div></div>
        <div class="ip-stat"><div class="ip-stat-icon">\u{1F552}</div><div class="ip-stat-val">${blocks24h}</div><div class="ip-stat-lbl">Last 24h</div></div>
      </div>

      ${expiredRules > 0 ? `<div class="ip-alert ip-alert-warn">\u26A0\uFE0F ${expiredRules} rule(s) have expired. Consider removing or extending them.</div>` : ''}
      ${blocks24h > 50 ? `<div class="ip-alert ip-alert-error">\u{1F6A8} High block volume: ${blocks24h} blocks in the last 24 hours. Review your rules.</div>` : ''}

      <div class="ip-grid-2">
        <div class="ip-card">
          <div class="ip-flex" style="margin-bottom:14px">
            <h3 style="margin:0;font-size:.95rem">\u{1F4CA} Top Hit Rules</h3>
            <a href="/admin/ip-protection/data" class="ip-btn ip-btn-sm ip-btn-secondary">View All</a>
          </div>
          ${topRulesHtml || '<div class="ip-empty">No rules with hits yet.</div>'}
        </div>
        <div class="ip-card">
          <div class="ip-flex" style="margin-bottom:14px">
            <h3 style="margin:0;font-size:.95rem">\u{1F4DD} Recent Blocks</h3>
            <a href="/admin/ip-protection/block-log" class="ip-btn ip-btn-sm ip-btn-secondary">View All</a>
          </div>
          <div class="ip-timeline">${blockTimeline || '<div class="ip-empty">No recent blocks.</div>'}</div>
        </div>
      </div>
    `, req));
  }));

  /* 2 ─ GET /admin/ip-protection/data — Rules JSON + UI ──────── */
  app.get('/admin/ip-protection/data', requireAuth, ah(async (req, res) => {
    const format = req.query.format;
    const search = (req.query.search || '').trim();
    const typeFilter = req.query.type || '';
    const activeFilter = req.query.active || '';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];
    let idx = 1;
    if (search) { conditions.push(`(ip_address ILIKE $${idx} OR reason ILIKE $${idx})`); params.push('%' + search + '%'); idx++; }
    if (typeFilter) { conditions.push(`rule_type = $${idx}`); params.push(typeFilter); idx++; }
    if (activeFilter === 'active') { conditions.push('is_active = true'); }
    else if (activeFilter === 'inactive') { conditions.push('is_active = false'); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const countResult = await pool.query(`SELECT COUNT(*)::int as c FROM ip_rules ${where}`, params);
    const total = countResult.rows[0].c;
    const totalPages = Math.ceil(total / limit);

    const rulesResult = await pool.query(
      `SELECT * FROM ip_rules ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, limit, offset]
    );
    const rules = rulesResult.rows;

    // If JSON requested
    if (format === 'json') {
      return res.json({ success: true, data: rules, total, page, totalPages });
    }

    const rulesTableHtml = rules.map(r => `
      <tr>
        <td><span class="ip-code">${esc(r.ip_address)}</span>${r.ip_range ? `<br><span style="font-size:.7rem;color:${C.textMuted}">Range: ${esc(r.ip_range)}</span>` : ''}</td>
        <td>${ruleTypeBadge(r.rule_type)}</td>
        <td>${activeBadge(r.is_active)}</td>
        <td style="font-size:.75rem;color:${C.textDim}">${esc(r.reason || '\u2014')}</td>
        <td style="text-align:center"><span style="font-weight:700;color:${C.amber}">${r.hit_count || 0}</span></td>
        <td style="font-size:.75rem;color:${C.textDim}">${r.expires_at ? fmtDate(r.expires_at) : 'Never'}</td>
        <td style="font-size:.75rem;color:${C.textDim}">${fmtDateTime(r.created_at)}</td>
        <td style="white-space:nowrap">
          <form method="POST" action="/admin/ip-protection/${r.id}/toggle" style="display:inline">
            <button class="ip-btn ip-btn-sm ${r.is_active ? 'ip-btn-secondary' : 'ip-btn-success'}" type="submit">${r.is_active ? 'Disable' : 'Enable'}</button>
          </form>
          <a href="/admin/ip-protection/edit/${r.id}" class="ip-btn ip-btn-sm ip-btn-secondary" style="margin-left:4px">Edit</a>
          <form method="POST" action="/admin/ip-protection/${r.id}/delete" style="display:inline;margin-left:4px" onsubmit="return confirm('Delete this rule?')">
            <button class="ip-btn ip-btn-sm ip-btn-danger" type="submit">Del</button>
          </form>
        </td>
      </tr>
    `).join('');

    res.send(wrapHTML('IP Rules', `
      <div class="ip-hero">
        <h1>\u{1F4CB} IP Rules</h1>
        <p>Manage ${total} whitelist and blacklist rules</p>
        <div class="ip-hero-actions">
          <a href="/admin/ip-protection/add" class="ip-btn" style="background:#fff;color:${C.primary}">\u2795 Add Rule</a>
          <a href="/admin/ip-protection/bulk-add" class="ip-btn" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.25)">\u{1F4E5} Bulk Add</a>
          <a href="/admin/ip-protection/import" class="ip-btn" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.25)">\u{1F4C2} Import CSV</a>
          <a href="/admin/ip-protection/data?format=json" class="ip-btn" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.25)">API JSON</a>
        </div>
      </div>

      ${navHTML('/admin/ip-protection/data')}

      <div class="ip-filter">
        <div>
          <label>Search</label>
          <input name="search" value="${esc(search)}" placeholder="IP or reason...">
        </div>
        <div>
          <label>Type</label>
          <select name="type">
            <option value="">All Types</option>
            <option value="whitelist" ${typeFilter==='whitelist'?'selected':''}>Whitelist</option>
            <option value="blacklist" ${typeFilter==='blacklist'?'selected':''}>Blacklist</option>
          </select>
        </div>
        <div>
          <label>Status</label>
          <select name="active">
            <option value="">All</option>
            <option value="active" ${activeFilter==='active'?'selected':''}>Active</option>
            <option value="inactive" ${activeFilter==='inactive'?'selected':''}>Inactive</option>
          </select>
        </div>
        <button class="ip-btn ip-btn-primary" type="submit" onclick="this.closest('form')?.submit()" style="align-self:end">Filter</button>
        <a href="/admin/ip-protection/data" class="ip-btn ip-btn-secondary" style="align-self:end">Clear</a>
      </div>

      <div class="ip-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="ip-table">
            <thead>
              <tr><th>IP Address</th><th>Type</th><th>Status</th><th>Reason</th><th>Hits</th><th>Expires</th><th>Created</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${rulesTableHtml || '<tr><td colspan="8" class="ip-empty">No rules found. Add your first rule above.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="ip-pagination">
        <span>Page ${page} of ${totalPages} (${total} rules)</span>
        <div>
          ${page > 1 ? `<a href="/admin/ip-protection/data?page=${page-1}&search=${encodeURIComponent(search)}&type=${encodeURIComponent(typeFilter)}&active=${encodeURIComponent(activeFilter)}" class="ip-btn ip-btn-sm ip-btn-secondary">\u2190 Prev</a>` : ''}
          ${page < totalPages ? `<a href="/admin/ip-protection/data?page=${page+1}&search=${encodeURIComponent(search)}&type=${encodeURIComponent(typeFilter)}&active=${encodeURIComponent(activeFilter)}" class="ip-btn ip-btn-sm ip-btn-primary">Next \u2192</a>` : ''}
        </div>
      </div>
    `, req));
  }));

  /* 3 ─ POST /admin/ip-protection/add — Add Rule ──────────────── */
  app.post('/admin/ip-protection/add', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const { ip_address, ip_range, rule_type, reason, expires_at, is_active } = req.body;

    if (!ip_address || !rule_type) {
      return res.send(wrapHTML('Error', '<div class="ip-alert ip-alert-error">IP address and rule type are required.</div><a href="/admin/ip-protection/add" class="ip-btn ip-btn-secondary">\u2190 Back</a>', req));
    }

    if (!isValidIp(ip_address) && !isValidCIDR(ip_address)) {
      return res.send(wrapHTML('Error', `<div class="ip-alert ip-alert-error">Invalid IP address format: ${esc(ip_address)}. Use format like 192.168.1.1 or 10.0.0.0/24.</div><a href="/admin/ip-protection/add" class="ip-btn ip-btn-secondary">\u2190 Back</a>`, req));
    }

    if (!['whitelist', 'blacklist'].includes(rule_type)) {
      return res.send(wrapHTML('Error', '<div class="ip-alert ip-alert-error">Rule type must be whitelist or blacklist.</div><a href="/admin/ip-protection/add" class="ip-btn ip-btn-secondary">\u2190 Back</a>', req));
    }

    // If the input is a CIDR, store it in ip_range and extract base IP
    let finalIp = ip_address;
    let finalRange = ip_range || '';
    if (ip_address.indexOf('/') !== -1) {
      finalRange = ip_address;
      finalIp = ip_address.split('/')[0];
    }

    await pool.query(
      'INSERT INTO ip_rules(ip_address, ip_range, rule_type, reason, expires_at, is_active, created_by, school_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [finalIp, finalRange, rule_type, reason || null, expires_at || null, is_active !== 'false', user?.id, 1]
    );

    audit('ip_rule_add', { ip: finalIp, range: finalRange, type: rule_type, school_id: 1 });
    res.redirect('/admin/ip-protection/data?msg=Rule+added+successfully');
  }));

  /* GET form page for adding */
  app.get('/admin/ip-protection/add', requireAuth, ah(async (req, res) => {
    const msg = req.query.msg || '';
    res.send(wrapHTML('Add IP Rule', `
      <div class="ip-hero"><h1>\u2795 Add IP Rule</h1><p>Create a new whitelist or blacklist rule</p></div>
      ${navHTML('/admin/ip-protection/data')}
      ${msg ? `<div class="ip-alert ip-alert-success">${esc(msg)}</div>` : ''}
      <div class="ip-grid-2">
        <div class="ip-card">
          <form method="POST" action="/admin/ip-protection/add">
            <div class="ip-form-group">
              <label>IP Address <span style="color:${C.red}">*</span></label>
              <input class="ip-input" name="ip_address" required placeholder="e.g. 192.168.1.100 or 10.0.0.0/24">
            </div>
            <div class="ip-form-group">
              <label>CIDR Range (optional)</label>
              <input class="ip-input" name="ip_range" placeholder="e.g. 10.0.0.0/16 (auto-filled if IP contains /)">
            </div>
            <div class="ip-form-group">
              <label>Rule Type <span style="color:${C.red}">*</span></label>
              <select class="ip-select" name="rule_type" required>
                <option value="">-- Select --</option>
                <option value="whitelist">Whelist (allow access)</option>
                <option value="blacklist">Blacklist (block access)</option>
              </select>
            </div>
            <div class="ip-form-group">
              <label>Reason / Notes</label>
              <textarea class="ip-textarea" name="reason" placeholder="Why is this IP being added?"></textarea>
            </div>
            <div class="ip-grid-2">
              <div class="ip-form-group">
                <label>Expires At</label>
                <input class="ip-input" name="expires_at" type="datetime-local">
              </div>
              <div class="ip-form-group">
                <label>Active</label>
                <select class="ip-select" name="is_active">
                  <option value="true">Yes, active immediately</option>
                  <option value="false">No, create as inactive</option>
                </select>
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="ip-btn ip-btn-primary" type="submit">\u2713 Save Rule</button>
              <a href="/admin/ip-protection/data" class="ip-btn ip-btn-secondary">Cancel</a>
            </div>
          </form>
        </div>
        <div class="ip-card">
          <h3 style="font-size:.9rem;margin:0 0 12px">\u{1F4D6} Quick Guide</h3>
          <div style="font-size:.8rem;color:${C.textDim};line-height:1.7">
            <p><strong style="color:${C.green}">Whitelist:</strong> Only whitelisted IPs can access the system (strict mode).</p>
            <p><strong style="color:${C.red}">Blacklist:</strong> Listed IPs are blocked from accessing the system.</p>
            <p><strong>Single IP:</strong> <span class="ip-code">192.168.1.100</span></p>
            <p><strong>CIDR Range:</strong> <span class="ip-code">10.0.0.0/24</span> blocks 10.0.0.0 \u2013 10.0.0.255</p>
            <p><strong>Common Ranges:</strong></p>
            <ul style="padding-left:18px;margin:4px 0">
              <li><span class="ip-code">192.168.0.0/16</span> \u2014 Private network</li>
              <li><span class="ip-code">10.0.0.0/8</span> \u2014 Class A private</li>
              <li><span class="ip-code">172.16.0.0/12</span> \u2014 Class B private</li>
            </ul>
          </div>
        </div>
      </div>
    `, req));
  }));

  /* 4 ─ PUT /admin/ip-protection/:id — Update Rule ────────────── */
  app.put('/admin/ip-protection/:id', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const { ip_address, ip_range, rule_type, reason, expires_at, is_active } = req.body;

    const existing = await pool.query('SELECT * FROM ip_rules WHERE id = $1', [id]);
    if (!existing.rowCount) return res.status(404).json({ success: false, error: 'Rule not found' });

    let finalIp = ip_address || existing.rows[0].ip_address;
    let finalRange = ip_range !== undefined ? ip_range : existing.rows[0].ip_range;
    if (finalIp && finalIp.indexOf('/') !== -1) {
      finalRange = finalIp;
      finalIp = finalIp.split('/')[0];
    }

    await pool.query(
      'UPDATE ip_rules SET ip_address=$1, ip_range=$2, rule_type=$3, reason=$4, expires_at=$5, is_active=$6 WHERE id=$7',
      [finalIp, finalRange, rule_type || existing.rows[0].rule_type, reason !== undefined ? reason : existing.rows[0].reason,
       expires_at !== undefined ? expires_at : existing.rows[0].expires_at,
       is_active !== undefined ? is_active : existing.rows[0].is_active, id]
    );

    audit('ip_rule_update', { id, ip: finalIp });
    res.json({ success: true, message: 'Rule updated' });
  }));

  /* GET edit page */
  app.get('/admin/ip-protection/edit/:id', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const result = await pool.query('SELECT * FROM ip_rules WHERE id = $1', [id]);
    if (!result.rowCount) return res.send(wrapHTML('Not Found', '<div class="ip-alert ip-alert-error">Rule not found.</div><a href="/admin/ip-protection/data" class="ip-btn ip-btn-secondary">\u2190 Back</a>', req));
    const r = result.rows[0];
    const expiresVal = r.expires_at ? new Date(r.expires_at).toISOString().slice(0, 16) : '';

    res.send(wrapHTML('Edit IP Rule', `
      <div class="ip-hero"><h1>\u270F\uFE0F Edit Rule #${r.id}</h1><p>Modifying ${esc(r.ip_address)} ${ruleTypeBadge(r.rule_type)}</p></div>
      ${navHTML('/admin/ip-protection/data')}
      <div class="ip-card" style="max-width:600px">
        <form method="POST" action="/admin/ip-protection/${r.id}?_method=PUT">
          <div class="ip-form-group">
            <label>IP Address</label>
            <input class="ip-input" name="ip_address" value="${esc(r.ip_address)}" required>
          </div>
          <div class="ip-form-group">
            <label>CIDR Range</label>
            <input class="ip-input" name="ip_range" value="${esc(r.ip_range || '')}">
          </div>
          <div class="ip-form-group">
            <label>Rule Type</label>
            <select class="ip-select" name="rule_type">
              <option value="whitelist" ${r.rule_type==='whitelist'?'selected':''}>Whitelist</option>
              <option value="blacklist" ${r.rule_type==='blacklist'?'selected':''}>Blacklist</option>
            </select>
          </div>
          <div class="ip-form-group">
            <label>Reason</label>
            <textarea class="ip-textarea" name="reason">${esc(r.reason || '')}</textarea>
          </div>
          <div class="ip-grid-2">
            <div class="ip-form-group">
              <label>Expires At</label>
              <input class="ip-input" name="expires_at" type="datetime-local" value="${esc(expiresVal)}">
            </div>
            <div class="ip-form-group">
              <label>Active</label>
              <select class="ip-select" name="is_active">
                <option value="true" ${r.is_active?'selected':''}>Active</option>
                <option value="false" ${!r.is_active?'selected':''}>Inactive</option>
              </select>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="ip-btn ip-btn-primary" type="submit">\u2713 Update Rule</button>
            <a href="/admin/ip-protection/data" class="ip-btn ip-btn-secondary">Cancel</a>
          </div>
        </form>
      </div>
    `, req));
  }));

  /* 5 ─ DELETE /admin/ip-protection/:id — Delete Rule ─────────── */
  app.delete('/admin/ip-protection/:id', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    await pool.query('DELETE FROM ip_rules WHERE id = $1', [id]);
    audit('ip_rule_delete', { id });
    res.json({ success: true, message: 'Rule deleted' });
  }));

  app.post('/admin/ip-protection/:id/delete', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM ip_rules WHERE id = $1', [parseInt(req.params.id)]);
    audit('ip_rule_delete', { id: req.params.id });
    res.redirect('/admin/ip-protection/data?msg=Rule+deleted');
  }));

  /* 6 ─ POST /admin/ip-protection/:id/toggle ──────────────────── */
  app.post('/admin/ip-protection/:id/toggle', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const result = await pool.query('UPDATE ip_rules SET is_active = NOT is_active WHERE id = $1 RETURNING is_active', [id]);
    if (result.rowCount) {
      audit('ip_rule_toggle', { id, new_state: result.rows[0].is_active });
    }
    res.redirect('/admin/ip-protection/data?msg=Rule+toggled');
  }));

  /* 7 ─ POST /admin/ip-protection/bulk-add — Bulk Add ─────────── */
  app.get('/admin/ip-protection/bulk-add', requireAuth, ah(async (req, res) => {
    res.send(wrapHTML('Bulk Add IP Rules', `
      <div class="ip-hero"><h1>\u{1F4E5} Bulk Add Rules</h1><p>Add multiple IP rules at once</p></div>
      ${navHTML('/admin/ip-protection/data')}
      <div class="ip-grid-2">
        <div class="ip-card">
          <form method="POST" action="/admin/ip-protection/bulk-add">
            <div class="ip-form-group">
              <label>Rule Type <span style="color:${C.red}">*</span></label>
              <select class="ip-select" name="rule_type" required>
                <option value="blacklist">Blacklist</option>
                <option value="whitelist">Whitelist</option>
              </select>
            </div>
            <div class="ip-form-group">
              <label>IP Addresses (one per line) <span style="color:${C.red}">*</span></label>
              <textarea class="ip-textarea" name="ips" required rows="12" placeholder="192.168.1.100&#10;10.0.0.5&#10;172.16.0.0/16&#10;203.0.113.50"></textarea>
              <p style="font-size:.72rem;color:${C.textMuted};margin:4px 0 0">Supports single IPs and CIDR notation, one per line.</p>
            </div>
            <div class="ip-form-group">
              <label>Reason (applied to all)</label>
              <input class="ip-input" name="reason" placeholder="e.g. Suspicious activity detected">
            </div>
            <div style="display:flex;gap:8px">
              <button class="ip-btn ip-btn-primary" type="submit">\u2713 Add All Rules</button>
              <a href="/admin/ip-protection/data" class="ip-btn ip-btn-secondary">Cancel</a>
            </div>
          </form>
        </div>
        <div class="ip-card">
          <h3 style="font-size:.9rem;margin:0 0 12px">\u{1F4A1} Tips</h3>
          <ul style="font-size:.8rem;color:${C.textDim};line-height:2;padding-left:18px">
            <li>One IP or CIDR range per line</li>
            <li>Blank lines are ignored</li>
            <li>Duplicate IPs are skipped automatically</li>
            <li>Invalid entries are reported but won't break the batch</li>
            <li>Use CIDR ranges to block entire subnets efficiently</li>
          </ul>
          <h3 style="font-size:.9rem;margin:20px 0 12px">\u{1F4CB} Example Batch</h3>
          <div class="ip-code" style="padding:12px;border-radius:8px;line-height:1.8;white-space:pre-wrap">192.168.1.0/24
10.0.0.100
172.16.5.0/28
203.0.113.42
198.51.100.0/24</div>
        </div>
      </div>
    `, req));
  }));

  app.post('/admin/ip-protection/bulk-add', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const { rule_type, ips, reason } = req.body;
    if (!rule_type || !ips) return res.status(400).send('Rule type and IPs required');

    const lines = ips.split(/[\n,]+/).map(l => l.trim()).filter(Boolean);
    let added = 0, skipped = 0, invalid = 0;

    for (const line of lines) {
      if (!isValidIp(line) && !isValidCIDR(line)) { invalid++; continue; }

      let finalIp = line, finalRange = '';
      if (line.indexOf('/') !== -1) { finalRange = line; finalIp = line.split('/')[0]; }

      // Skip duplicates
      const dup = await pool.query('SELECT 1 FROM ip_rules WHERE ip_address = $1 AND ip_range = $2', [finalIp, finalRange]);
      if (dup.rowCount) { skipped++; continue; }

      await pool.query(
        'INSERT INTO ip_rules(ip_address, ip_range, rule_type, reason, is_active, created_by, school_id) VALUES($1,$2,$3,$4,true,$5,$6)',
        [finalIp, finalRange, rule_type, reason || null, user?.id, 1]
      );
      added++;
    }

    audit('ip_bulk_add', { rule_type, added, skipped, invalid });
    res.redirect(`/admin/ip-protection/data?msg=Bulk+added:+${added}+added,+${skipped}+skipped,+${invalid}+invalid`);
  }));

  /* 8 ─ GET /admin/ip-protection/block-log — Block Log ────────── */
  app.get('/admin/ip-protection/block-log', requireAuth, ah(async (req, res) => {
    const search = (req.query.search || '').trim();
    const blockedFilter = req.query.blocked || '';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];
    let idx = 1;
    if (search) { conditions.push(`ip_address ILIKE $${idx}`); params.push('%' + search + '%'); idx++; }
    if (blockedFilter === 'true') { conditions.push('blocked = true'); }
    else if (blockedFilter === 'false') { conditions.push('blocked = false'); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const countResult = await pool.query(`SELECT COUNT(*)::int as c FROM ip_block_log ${where}`, params);
    const total = countResult.rows[0].c;
    const totalPages = Math.ceil(total / limit);

    const logsResult = await pool.query(
      `SELECT bl.*, ir.rule_type, ir.reason as rule_reason FROM ip_block_log bl LEFT JOIN ip_rules ir ON ir.id = bl.rule_id ${where} ORDER BY bl.created_at DESC LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, limit, offset]
    );
    const logs = logsResult.rows;

    const logsHtml = logs.map(l => `
      <tr>
        <td><span class="ip-code">${esc(l.ip_address)}</span></td>
        <td><span style="color:${l.blocked ? C.red : C.green};font-weight:700">${l.blocked ? '\u{1F6AB} Blocked' : '\u2705 Allowed'}</span></td>
        <td style="font-size:.75rem;color:${C.textDim}">${esc(l.method || '-')} ${esc(l.path || '/')}</td>
        <td style="font-size:.7rem;color:${C.textMuted};max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.user_agent || '')}">${esc((l.user_agent || '').substring(0, 40))}</td>
        <td style="font-size:.75rem;color:${C.textDim}">${esc(l.rule_reason || '\u2014')}</td>
        <td style="font-size:.75rem;color:${C.textDim}">${fmtDateTime(l.created_at)}</td>
      </tr>
    `).join('');

    res.send(wrapHTML('Block Log', `
      <div class="ip-hero">
        <h1>\u{1F4DD} Block Log</h1>
        <p>${total} access log entries recorded</p>
        <div class="ip-hero-actions">
          <a href="/admin/ip-protection/block-log/export" class="ip-btn" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.25)">Export CSV</a>
          <form method="POST" action="/admin/ip-protection/cleanup" style="display:inline" onsubmit="return confirm('Delete logs older than 30 days?')">
            <button class="ip-btn" style="background:rgba(239,68,68,.8);color:#fff">Cleanup Old Logs</button>
          </form>
        </div>
      </div>

      ${navHTML('/admin/ip-protection/block-log')}

      <div class="ip-filter">
        <div>
          <label>Search IP</label>
          <input name="search" value="${esc(search)}" placeholder="Filter by IP...">
        </div>
        <div>
          <label>Status</label>
          <select name="blocked">
            <option value="">All</option>
            <option value="true" ${blockedFilter==='true'?'selected':''}>Blocked</option>
            <option value="false" ${blockedFilter==='false'?'selected':''}>Allowed</option>
          </select>
        </div>
        <button class="ip-btn ip-btn-primary" onclick="location.href='/admin/ip-protection/block-log?search='+encodeURIComponent(document.querySelector('[name=search]').value)+'&blocked='+document.querySelector('[name=blocked]').value">Filter</button>
        <a href="/admin/ip-protection/block-log" class="ip-btn ip-btn-secondary">Clear</a>
      </div>

      <div class="ip-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="ip-table">
            <thead><tr><th>IP Address</th><th>Status</th><th>Request</th><th>User Agent</th><th>Rule</th><th>Time</th></tr></thead>
            <tbody>
              ${logsHtml || '<tr><td colspan="6" class="ip-empty">No log entries found.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="ip-pagination">
        <span>Page ${page} of ${totalPages} (${total} entries)</span>
        <div>
          ${page > 1 ? `<a href="/admin/ip-protection/block-log?page=${page-1}&search=${encodeURIComponent(search)}&blocked=${encodeURIComponent(blockedFilter)}" class="ip-btn ip-btn-sm ip-btn-secondary">\u2190 Prev</a>` : ''}
          ${page < totalPages ? `<a href="/admin/ip-protection/block-log?page=${page+1}&search=${encodeURIComponent(search)}&blocked=${encodeURIComponent(blockedFilter)}" class="ip-btn ip-btn-sm ip-btn-primary">Next \u2192</a>` : ''}
        </div>
      </div>
    `, req));
  }));

  /* 9 ─ GET /admin/ip-protection/block-log/export ─────────────── */
  app.get('/admin/ip-protection/block-log/export', requireAuth, ah(async (req, res) => {
    const result = await pool.query(
      'SELECT bl.*, ir.rule_type, ir.reason as rule_reason FROM ip_block_log bl LEFT JOIN ip_rules ir ON ir.id = bl.rule_id ORDER BY bl.created_at DESC LIMIT 50000'
    );
    const headers = ['ID','IP Address','Rule ID','Path','Method','User Agent','Blocked','Rule Type','Rule Reason','Created At'];
    const csvRows = [headers.map(h => '"'+h+'"').join(',')];
    for (const r of result.rows) {
      csvRows.push([
        r.id, r.ip_address, r.rule_id, (r.path||'').replace(/"/g,'""'), r.method,
        (r.user_agent||'').replace(/"/g,'""'), r.blocked, r.rule_type,
        (r.rule_reason||'').replace(/"/g,'""'), r.created_at ? new Date(r.created_at).toISOString() : ''
      ].map(v => '"'+(v||'')+'"').join(','));
    }
    const filename = `ip-block-log-${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvRows.join('\n'));
    audit('ip_block_log_export', { count: result.rowCount });
  }));

  /* 10 ─ GET /admin/ip-protection/my-ip ───────────────────────── */
  app.get('/admin/ip-protection/my-ip', requireAuth, ah(async (req, res) => {
    const ip = getClientIp(req);
    const headers = JSON.stringify(req.headers, null, 2);

    // Check if this IP matches any rule
    const rules = await pool.query("SELECT * FROM ip_rules WHERE (ip_address = $1 OR ip_range IS NOT NULL) AND is_active = true ORDER BY hit_count DESC", [ip]);
    let matchStatus = 'No matching rules';
    const matchingRules = rules.rows.filter(r => ip === r.ip_address || (r.ip_range && isIpInCIDR(ip, r.ip_range)));

    res.send(wrapHTML('My IP Info', `
      <div class="ip-hero">
        <h1>\u{1F310} Your IP Information</h1>
        <p>View details about your current connection</p>
      </div>
      ${navHTML('/admin/ip-protection')}

      <div class="ip-card" style="text-align:center;padding:30px">
        <div style="font-size:48px;margin-bottom:12px">\u{1F4E1}</div>
        <div style="font-size:2.5rem;font-weight:800;color:${C.primary};font-family:monospace;letter-spacing:2px">${esc(ip)}</div>
        <p style="color:${C.textDim};font-size:.85rem;margin-top:8px">Your detected IP address</p>
      </div>

      <div class="ip-grid-2">
        <div class="ip-card">
          <h3 style="font-size:.9rem;margin:0 0 12px">\u{1F50D} Rule Matches (${matchingRules.length})</h3>
          ${matchingRules.length === 0 ? '<p style="color:'+C.textDim+';font-size:.85rem">Your IP does not match any active rules.</p>' :
            matchingRules.map(r => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(71,85,105,.3)">
                <div style="display:flex;align-items:center;gap:8px">
                  <span class="ip-code">${esc(r.ip_address)}</span>
                  ${ruleTypeBadge(r.rule_type)}
                </div>
                ${activeBadge(r.is_active)}
              </div>
            `).join('')
          }
        </div>
        <div class="ip-card">
          <h3 style="font-size:.9rem;margin:0 0 12px">\u{1F4E2} Request Headers</h3>
          <div style="font-size:.72rem;color:${C.textMuted};max-height:300px;overflow-y:auto;background:${C.surface2};padding:12px;border-radius:8px;font-family:monospace;white-space:pre-wrap">${esc(headers)}</div>
        </div>
      </div>
    `, req));
  }));

  /* 11 ─ POST /admin/ip-protection/check — Check IP ───────────── */
  app.get('/admin/ip-protection/check', requireAuth, ah(async (req, res) => {
    const checkIp = (req.query.ip || '').trim() || getClientIp(req);
    let matchResult = null;

    if (checkIp) {
      const rules = await pool.query(
        "SELECT * FROM ip_rules WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at ASC"
      );
      for (const rule of rules.rows) {
        if (rule.ip_address && checkIp === rule.ip_address) {
          matchResult = { matched: true, rule, matchType: 'exact' }; break;
        }
        if (rule.ip_range && isIpInCIDR(checkIp, rule.ip_range)) {
          matchResult = { matched: true, rule, matchType: 'range' }; break;
        }
      }
    }

    res.send(wrapHTML('Check IP', `
      <div class="ip-hero"><h1>\u{1F50D} IP Checker</h1><p>Test whether an IP is allowed or blocked</p></div>
      ${navHTML('/admin/ip-protection')}

      <div class="ip-card" style="max-width:600px">
        <form method="GET" action="/admin/ip-protection/check" style="display:flex;gap:8px;align-items:end">
          <div style="flex:1">
            <label style="display:block;font-size:.8rem;font-weight:600;color:${C.text};margin-bottom:4px">IP Address to Check</label>
            <input class="ip-input" name="ip" value="${esc(checkIp)}" placeholder="Enter IP to test...">
          </div>
          <button class="ip-btn ip-btn-primary" type="submit">Check</button>
        </form>
      </div>

      ${checkIp ? `
        <div class="ip-card" style="text-align:center;padding:30px;margin-top:16px">
          <div style="font-size:36px;margin-bottom:8px">${matchResult ? (matchResult.rule.rule_type === 'blacklist' ? '\u{1F6AB}' : '\u2705') : '\u2705'}</div>
          <div style="font-size:1.8rem;font-weight:800;color:${matchResult ? (matchResult.rule.rule_type === 'blacklist' ? C.red : C.green) : C.green};font-family:monospace">${esc(checkIp)}</div>
          <p style="margin:12px 0;font-size:.9rem;color:${matchResult ? (matchResult.rule.rule_type === 'blacklist' ? C.red : C.green) : C.textDim}">
            ${matchResult
              ? (matchResult.rule.rule_type === 'blacklist'
                ? `<strong>BLOCKED</strong> by ${esc(matchResult.rule.reason || 'blacklist rule')} (${matchResult.matchType} match)`
                : `<strong>WHITELISTED</strong> by ${esc(matchResult.rule.reason || 'whitelist rule')} (${matchResult.matchType} match)`)
              : 'No matching rules found \u2014 <strong>ALLOWED</strong>'}
          </p>
          ${matchResult ? `
            <div style="text-align:left;margin-top:16px;padding:14px;background:${C.surface2};border-radius:8px;font-size:.8rem">
              <p><strong>Rule ID:</strong> ${matchResult.rule.id}</p>
              <p><strong>Type:</strong> ${ruleTypeBadge(matchResult.rule.rule_type)}</p>
              <p><strong>IP:</strong> <span class="ip-code">${esc(matchResult.rule.ip_address)}</span></p>
              ${matchResult.rule.ip_range ? `<p><strong>Range:</strong> <span class="ip-code">${esc(matchResult.rule.ip_range)}</span></p>` : ''}
              <p><strong>Hits:</strong> ${matchResult.rule.hit_count || 0}</p>
              <p><strong>Created:</strong> ${fmtDateTime(matchResult.rule.created_at)}</p>
            </div>
          ` : ''}
        </div>
      ` : ''}
    `, req));
  }));

  /* 12 ─ POST /admin/ip-protection/import — Import CSV ────────── */
  app.get('/admin/ip-protection/import', requireAuth, ah(async (req, res) => {
    res.send(wrapHTML('Import IP Rules', `
      <div class="ip-hero"><h1>\u{1F4C2} Import Rules from CSV</h1><p>Upload a CSV file to bulk-import IP rules</p></div>
      ${navHTML('/admin/ip-protection/data')}

      <div class="ip-grid-2">
        <div class="ip-card">
          <form method="POST" action="/admin/ip-protection/import" enctype="multipart/form-data">
            <div class="ip-form-group">
              <label>Default Rule Type</label>
              <select class="ip-select" name="rule_type">
                <option value="blacklist">Blacklist</option>
                <option value="whitelist">Whitelist</option>
              </select>
            </div>
            <div class="ip-form-group">
              <label>CSV File <span style="color:${C.red}">*</span></label>
              <input type="file" name="csvfile" accept=".csv,.txt" required style="width:100%;padding:10px;border:1px dashed ${C.border};border-radius:8px;background:${C.surface2};color:${C.text};font-size:.85rem">
            </div>
            <div class="ip-form-group">
              <label>Default Reason</label>
              <input class="ip-input" name="reason" placeholder="Applied to all imported rules">
            </div>
            <button class="ip-btn ip-btn-primary" type="submit">\u{1F4E4} Upload & Import</button>
          </form>
        </div>
        <div class="ip-card">
          <h3 style="font-size:.9rem;margin:0 0 12px">\u{1F4C4} CSV Format</h3>
          <p style="font-size:.8rem;color:${C.textDim};margin-bottom:12px">Your CSV should have one IP address per row. The first row is treated as a header if it contains text.</p>
          <div class="ip-code" style="padding:12px;border-radius:8px;font-size:.78rem;line-height:1.8;white-space:pre-wrap">ip_address,reason
192.168.1.100,Suspicious login attempts
10.0.0.5,Unauthorized access
172.16.0.0/16,Blocked subnet
203.0.113.42,Malware source</div>
          <p style="font-size:.75rem;color:${C.textMuted};margin-top:12px">Only the first column (ip_address) is required. If a second column exists, it will be used as the reason. If your CSV has a header row, it will be automatically skipped.</p>
        </div>
      </div>
    `, req));
  }));

  app.post('/admin/ip-protection/import', requireAuth, ah(async (req, res) => {
    if (!req.files || !req.files.csvfile) {
      return res.send(wrapHTML('Error', '<div class="ip-alert ip-alert-error">No file uploaded.</div><a href="/admin/ip-protection/import" class="ip-btn ip-btn-secondary">\u2190 Back</a>', req));
    }

    const user = req.session.user;
    const { rule_type, reason } = req.body;
    const fileData = req.files.csvfile.data.toString('utf8');
    const lines = fileData.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);

    let added = 0, skipped = 0, invalid = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));

      // Skip header row
      if (i === 0 && (parts[0] || '').toLowerCase() === 'ip_address') continue;

      const ip = parts[0];
      const rowReason = parts[1] || reason || null;

      if (!ip) continue;
      if (!isValidIp(ip) && !isValidCIDR(ip)) { invalid++; continue; }

      let finalIp = ip, finalRange = '';
      if (ip.indexOf('/') !== -1) { finalRange = ip; finalIp = ip.split('/')[0]; }

      const dup = await pool.query('SELECT 1 FROM ip_rules WHERE ip_address = $1 AND ip_range = $2', [finalIp, finalRange]);
      if (dup.rowCount) { skipped++; continue; }

      await pool.query(
        'INSERT INTO ip_rules(ip_address, ip_range, rule_type, reason, is_active, created_by, school_id) VALUES($1,$2,$3,$4,true,$5,$6)',
        [finalIp, finalRange, rule_type || 'blacklist', rowReason, user?.id, 1]
      );
      added++;
    }

    audit('ip_csv_import', { rule_type, added, skipped, invalid, file_size: req.files.csvfile.size });
    res.redirect(`/admin/ip-protection/data?msg=Import:+${added}+added,+${skipped}+skipped,+${invalid}+invalid`);
  }));

  /* 13 ─ DELETE /admin/ip-protection/cleanup — Cleanup Logs ───── */
  app.delete('/admin/ip-protection/cleanup', requireAuth, ah(async (req, res) => {
    const days = parseInt(req.query.days) || 30;
    const result = await pool.query(
      'DELETE FROM ip_block_log WHERE created_at < NOW() - ($1 || \' days\')::INTERVAL RETURNING id',
      [days]
    );
    audit('ip_cleanup', { days, deleted: result.rowCount });
    res.json({ success: true, deleted: result.rowCount, message: `Removed ${result.rowCount} log entries older than ${days} days` });
  }));

  app.post('/admin/ip-protection/cleanup', requireAuth, ah(async (req, res) => {
    const days = parseInt(req.body.days) || 30;
    const result = await pool.query(
      'DELETE FROM ip_block_log WHERE created_at < NOW() - ($1 || \' days\')::INTERVAL RETURNING id',
      [days]
    );
    audit('ip_cleanup', { days, deleted: result.rowCount });
    res.redirect(`/admin/ip-protection/block-log?msg=Cleaned+${result.rowCount}+entries+older+than+${days}+days`);
  }));

  /* 14 ─ GET /admin/ip-protection/settings — Settings ─────────── */
  app.get('/admin/ip-protection/settings', requireAuth, ah(async (req, res) => {
    const myIp = getClientIp(req);
    const totalRules = (await pool.query('SELECT COUNT(*)::int as c FROM ip_rules')).rows[0].c;
    const activeRules = (await pool.query('SELECT COUNT(*)::int as c FROM ip_rules WHERE is_active = true')).rows[0].c;
    const expiredRules = (await pool.query("SELECT COUNT(*)::int as c FROM ip_rules WHERE expires_at IS NOT NULL AND expires_at <= NOW()")).rows[0].c;
    const totalLogs = (await pool.query('SELECT COUNT(*)::int as c FROM ip_block_log')).rows[0].c;

    res.send(wrapHTML('Protection Settings', `
      <div class="ip-hero">
        <h1>\u2699\uFE0F Protection Settings</h1>
        <p>Configure IP protection behavior and maintenance</p>
      </div>
      ${navHTML('/admin/ip-protection/settings')}

      <div class="ip-grid-2">
        <div class="ip-card">
          <h3 style="font-size:.9rem;margin:0 0 14px">\u{1F4CA} System Overview</h3>
          <div style="font-size:.85rem;line-height:2.2;color:${C.textDim}">
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(71,85,105,.3)">
              <span>Your IP</span><span class="ip-code">${esc(myIp)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(71,85,105,.3)">
              <span>Total Rules</span><span style="font-weight:700;color:#fff">${totalRules}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(71,85,105,.3)">
              <span>Active Rules</span><span style="font-weight:700;color:${C.green}">${activeRules}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(71,85,105,.3)">
              <span>Expired Rules</span><span style="font-weight:700;color:${expiredRules > 0 ? C.amber : C.textDim}">${expiredRules}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:6px 0">
              <span>Block Log Entries</span><span style="font-weight:700;color:#fff">${totalLogs.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div class="ip-card">
          <h3 style="font-size:.9rem;margin:0 0 14px">\u{1F5D1} Maintenance</h3>
          <div style="display:flex;flex-direction:column;gap:10px">
            <form method="POST" action="/admin/ip-protection/cleanup" onsubmit="return confirm('Delete logs older than 30 days? This cannot be undone.')">
              <input type="hidden" name="days" value="30">
              <button class="ip-btn ip-btn-danger" type="submit" style="width:100%;justify-content:center">
                \u{1F5D1} Clean Logs (30+ days)
              </button>
            </form>
            <form method="POST" action="/admin/ip-protection/cleanup" onsubmit="return confirm('Delete logs older than 90 days?')">
              <input type="hidden" name="days" value="90">
              <button class="ip-btn ip-btn-secondary" type="submit" style="width:100%;justify-content:center">
                \u{1F5D1} Clean Logs (90+ days)
              </button>
            </form>
            <a href="/admin/ip-protection/block-log/export" class="ip-btn ip-btn-primary" style="width:100%;justify-content:center">
              \u{1F4E5} Export All Block Logs (CSV)
            </a>
          </div>
        </div>
      </div>

      <div class="ip-grid-2" style="margin-top:16px">
        <div class="ip-card">
          <h3 style="font-size:.9rem;margin:0 0 14px">\u{1F6E1}\uFE0F How IP Protection Works</h3>
          <div style="font-size:.8rem;color:${C.textDim};line-height:1.8">
            <p style="margin-bottom:10px">The IP protection module runs as middleware, checking every incoming request against your configured rules.</p>
            <ol style="padding-left:18px">
              <li>Rules are evaluated in order of creation (oldest first)</li>
              <li>Each request's IP is compared against single IPs and CIDR ranges</li>
              <li><strong style="color:${C.green}">Whitelist</strong> rules allow access from specific IPs</li>
              <li><strong style="color:${C.red}">Blacklist</strong> rules block access from specific IPs</li>
              <li>Blocked requests receive a 403 response with an explanation</li>
              <li>All block events are logged for review and auditing</li>
              <li>Rules can have optional expiration dates</li>
              <li>Expired rules are automatically skipped during evaluation</li>
            </ol>
          </div>
        </div>

        <div class="ip-card">
          <h3 style="font-size:.9rem;margin:0 0 14px">\u{1F4A1} Best Practices</h3>
          <div style="font-size:.8rem;color:${C.textDim};line-height:1.8">
            <ul style="padding-left:18px">
              <li>Whitelist known admin IPs for added security</li>
              <li>Blacklist IPs that show repeated suspicious behavior</li>
              <li>Use CIDR ranges to efficiently block entire subnets</li>
              <li>Set expiration dates on temporary blocks</li>
              <li>Review block logs regularly for emerging threats</li>
              <li>Clean up old logs periodically to save storage</li>
              <li>Test rules with the IP Checker before activating</li>
              <li>Document reasons for each rule for audit trails</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="ip-card" style="margin-top:16px">
        <h3 style="font-size:.9rem;margin:0 0 14px">\u{1F517} Middleware Integration</h3>
        <p style="font-size:.8rem;color:${C.textDim};margin-bottom:12px">To activate IP protection in your server, use the exported middleware:</p>
        <div class="ip-code" style="padding:16px;border-radius:8px;font-size:.78rem;line-height:1.8;white-space:pre-wrap;overflow-x:auto">const ipProtection = require('./ip-protection');
const ipModule = ipProtection(app, pool, { esc, renderPage, ah, requireAuth, audit });

// Add middleware to all routes (or specific ones):
app.use(ipModule.checkIpMiddleware);</div>
      </div>
    `, req));
  }));

  /* ── Export the middleware function for external use ─────────── */
  return { checkIpMiddleware, isIpInCIDR, getClientIp };
};
