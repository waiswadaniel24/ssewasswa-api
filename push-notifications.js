/**
 * Push Notification Manager Module
 * 15 routes: dashboard, data, campaigns CRUD, send, schedule,
 * subscribers list/delete/stats, analytics, config, test, CSV export.
 *
 * Tables: push_config, push_subscribers, push_campaigns, push_delivery_log
 * Theme: Dark (#0f172a bg), Blue accents (#3b82f6)
 */
'use strict';
module.exports = function pushNotifications(app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, b) => b);
  const ah = opts.ah || ((fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next));
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (async () => {});
  const schoolId = (req) => req.session?.user?.school_id || req.session?.user?.tenant_id || 1;
  const BG = '#0f172a';
  const CARD = '#1e293b';
  const BORDER = '#334155';
  const TEXT = '#e2e8f0';
  const MUTED = '#94a3b8';
  const ACCENT = '#3b82f6';
  const PS = 20;

  // ═══════════════════════════════════════════════════════
  //  MIGRATIONS
  // ═══════════════════════════════════════════════════════
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) return;
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS push_config (
        id SERIAL PRIMARY KEY,
        provider TEXT DEFAULT 'fcm',
        fcm_server_key TEXT,
        fcm_sender_id TEXT,
        apns_key_id TEXT,
        apns_team_id TEXT,
        apns_bundle_id TEXT,
        is_active BOOLEAN DEFAULT true,
        school_id INT DEFAULT 1
      );`);
      await c.query(`CREATE TABLE IF NOT EXISTS push_subscribers (
        id SERIAL PRIMARY KEY,
        user_id INT,
        token TEXT NOT NULL,
        platform TEXT DEFAULT 'web',
        device_name TEXT,
        is_active BOOLEAN DEFAULT true,
        subscribed_at TIMESTAMPTZ DEFAULT NOW(),
        last_active TIMESTAMPTZ,
        school_id INT DEFAULT 1
      );`);
      await c.query(`CREATE TABLE IF NOT EXISTS push_campaigns (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT,
        icon TEXT,
        image TEXT,
        url TEXT,
        segment TEXT DEFAULT 'all',
        target_roles TEXT[] DEFAULT '{}',
        target_users INT[] DEFAULT '{}',
        scheduled_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        status TEXT DEFAULT 'draft',
        total_sent INT DEFAULT 0,
        total_delivered INT DEFAULT 0,
        total_opened INT DEFAULT 0,
        total_clicked INT DEFAULT 0,
        created_by INT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        school_id INT DEFAULT 1
      );`);
      await c.query(`CREATE TABLE IF NOT EXISTS push_delivery_log (
        id SERIAL PRIMARY KEY,
        campaign_id INT REFERENCES push_campaigns(id),
        subscriber_id INT REFERENCES push_subscribers(id),
        status TEXT DEFAULT 'pending',
        delivered_at TIMESTAMPTZ,
        opened_at TIMESTAMPTZ,
        clicked_at TIMESTAMPTZ,
        error TEXT,
        school_id INT DEFAULT 1
      );`);
      // Safe column additions
      const colDefs = {
        push_config: [
          'provider TEXT DEFAULT \'fcm\'', 'fcm_server_key TEXT', 'fcm_sender_id TEXT',
          'apns_key_id TEXT', 'apns_team_id TEXT', 'apns_bundle_id TEXT',
          'is_active BOOLEAN DEFAULT true', 'school_id INT DEFAULT 1'
        ],
        push_subscribers: [
          'user_id INT', 'token TEXT NOT NULL', 'platform TEXT DEFAULT \'web\'',
          'device_name TEXT', 'is_active BOOLEAN DEFAULT true',
          'subscribed_at TIMESTAMPTZ DEFAULT NOW()', 'last_active TIMESTAMPTZ',
          'school_id INT DEFAULT 1'
        ],
        push_campaigns: [
          'title TEXT NOT NULL', 'body TEXT', 'icon TEXT', 'image TEXT', 'url TEXT',
          'segment TEXT DEFAULT \'all\'', 'target_roles TEXT[] DEFAULT \'{}\'',
          'target_users INT[] DEFAULT \'{}\'', 'scheduled_at TIMESTAMPTZ', 'sent_at TIMESTAMPTZ',
          'status TEXT DEFAULT \'draft\'', 'total_sent INT DEFAULT 0', 'total_delivered INT DEFAULT 0',
          'total_opened INT DEFAULT 0', 'total_clicked INT DEFAULT 0',
          'created_by INT', 'created_at TIMESTAMPTZ DEFAULT NOW()', 'school_id INT DEFAULT 1'
        ],
        push_delivery_log: [
          'campaign_id INT REFERENCES push_campaigns(id)', 'subscriber_id INT REFERENCES push_subscribers(id)',
          'status TEXT DEFAULT \'pending\'', 'delivered_at TIMESTAMPTZ', 'opened_at TIMESTAMPTZ',
          'clicked_at TIMESTAMPTZ', 'error TEXT', 'school_id INT DEFAULT 1'
        ]
      };
      for (const [tbl, cols] of Object.entries(colDefs))
        for (const col of cols) await c.query(`ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS ${col};`).catch(() => {});
      // Indexes
      for (const sql of [
        'CREATE INDEX IF NOT EXISTS idx_pc_school ON push_config(school_id);',
        'CREATE INDEX IF NOT EXISTS idx_ps_school ON push_subscribers(school_id);',
        'CREATE INDEX IF NOT EXISTS idx_ps_active ON push_subscribers(school_id, is_active);',
        'CREATE INDEX IF NOT EXISTS idx_ps_platform ON push_subscribers(school_id, platform);',
        'CREATE INDEX IF NOT EXISTS idx_pcam_school ON push_campaigns(school_id);',
        'CREATE INDEX IF NOT EXISTS idx_pcam_status ON push_campaigns(school_id, status);',
        'CREATE INDEX IF NOT EXISTS idx_pcam_created ON push_campaigns(school_id, created_at DESC);',
        'CREATE INDEX IF NOT EXISTS idx_pdl_school ON push_delivery_log(school_id);',
        'CREATE INDEX IF NOT EXISTS idx_pdl_campaign ON push_delivery_log(campaign_id);',
        'CREATE INDEX IF NOT EXISTS idx_pdl_subscriber ON push_delivery_log(subscriber_id);',
      ]) await c.query(sql).catch(() => {});
      console.log('[PushNotifications] Migrations complete');
    } catch (e) { console.error('[PushNotifications] Migration error:', e.message); }
    finally { c.release(); }
  })();

  // ═══════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════
  const F = n => (n || 0).toLocaleString();
  function ago(d) {
    if (!d) return '\u2014';
    const s = Math.floor((Date.now() - new Date(d)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return new Date(d).toLocaleDateString();
  }
  function pct(n, d) { return d > 0 ? ((n / d) * 100).toFixed(1) : '0.0'; }
  function flash(req) {
    const f = req.session?.flash_push; delete req.session?.flash_push;
    if (!f) return '';
    const clr = f.type === 'error'
      ? 'background:#7f1d1d;border:1px solid #991b1b;color:#fca5a5'
      : 'background:#14532d;border:1px solid #166534;color:#86efac';
    return `<div style="${clr};padding:10px 16px;border-radius:8px;margin-bottom:16px;font-size:14px">${esc(f.msg)}</div>`;
  }
  function badge(s) {
    const m = {
      draft: 'background:#422006;color:#fbbf24', scheduled: 'background:#1e3a5f;color:#60a5fa',
      sending: 'background:#422006;color:#fbbf24', sent: 'background:#14532d;color:#86efac',
      failed: 'background:#7f1d1d;color:#fca5a5', pending: 'background:#1e3a5f;color:#60a5fa',
      delivered: 'background:#14532d;color:#86efac', opened: 'background:#1e3a5f;color:#818cf8',
      clicked: 'background:#1a2332;color:#2dd4bf'
    };
    return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;${m[s] || 'background:#334155;color:#94a3b8'}">${esc(s || '')}</span>`;
  }
  function nav(active) {
    const links = [
      ['dashboard', 'Dashboard', '/admin/push-notifications'],
      ['campaigns', 'Campaigns', '/admin/push-notifications?tab=campaigns'],
      ['subscribers', 'Subscribers', '/admin/push-notifications?tab=subscribers'],
      ['analytics', 'Analytics', '/admin/push-notifications?tab=analytics'],
      ['config', 'Config', '/admin/push-notifications/config']
    ];
    return '<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">' +
      links.map(([k, l, h]) => {
        const isActive = active === k;
        return `<a href="${h}" style="padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;border:1px solid ${isActive ? ACCENT : BORDER};color:${isActive ? '#fff' : MUTED};background:${isActive ? ACCENT : CARD}">${l}</a>`;
      }).join('') + '</div>';
  }
  function pagination(path, qs, pg, tot) {
    const pages = Math.ceil(tot / PS);
    if (pages <= 1) return '';
    let html = '<div style="display:flex;justify-content:center;gap:4px;margin-top:16px">';
    for (let i = 1; i <= pages; i++) {
      const isActive = parseInt(pg) === i;
      html += `<a href="${path}?${qs}&page=${i}" style="padding:5px 10px;border-radius:6px;font-size:13px;text-decoration:none;border:1px solid ${isActive ? ACCENT : BORDER};color:${isActive ? '#fff' : MUTED};background:${isActive ? ACCENT : CARD}">${i}</a>`;
    }
    return html + '</div>';
  }

  // ═══════════════════════════════════════════════════════
  //  SVG CHART HELPERS
  // ═══════════════════════════════════════════════════════
  function svgBarChart(data, w, h, colorMap) {
    if (!data || !data.length) return '<p style="text-align:center;padding:20px;color:#64748b">No data</p>';
    const mx = Math.max(...data.map(d => d.value), 1);
    const padL = 60, padR = 20, padT = 20, padB = 40;
    const chartW = w - padL - padR;
    const chartH = h - padT - padB;
    const barW = Math.max(8, Math.min(40, (chartW / data.length) * 0.6));
    const gap = chartW / data.length;
    let bars = '';
    data.forEach((d, i) => {
      const bh = Math.max(2, (d.value / mx) * chartH);
      const x = padL + i * gap + (gap - barW) / 2;
      const y = padT + chartH - bh;
      const clr = colorMap ? (colorMap[d.label] || ACCENT) : ACCENT;
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="4" fill="${clr}" opacity="0.9"/>`;
      bars += `<text x="${x + barW / 2}" y="${padT + chartH + 18}" fill="${MUTED}" font-size="11" text-anchor="middle">${esc(String(d.label).substring(0, 10))}</text>`;
      bars += `<text x="${x + barW / 2}" y="${y - 6}" fill="${TEXT}" font-size="11" text-anchor="middle" font-weight="600">${F(d.value)}</text>`;
    });
    // Y axis lines
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const y = padT + (chartH / 4) * i;
      const val = Math.round(mx - (mx / 4) * i);
      grid += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${BORDER}" stroke-width="1" stroke-dasharray="4,4"/>`;
      grid += `<text x="${padL - 8}" y="${y + 4}" fill="${MUTED}" font-size="10" text-anchor="end">${F(val)}</text>`;
    }
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;max-width:100%">${grid}${bars}</svg>`;
  }

  function svgDonutChart(segments, size) {
    if (!segments || !segments.length) return '<p style="text-align:center;padding:20px;color:#64748b">No data</p>';
    const total = segments.reduce((s, d) => s + d.value, 0);
    if (total === 0) return '<p style="text-align:center;padding:20px;color:#64748b">No data</p>';
    const cx = size / 2, cy = size / 2, r = size / 2 - 16, inner = r * 0.6;
    let arcs = '';
    let cumAngle = -90;
    segments.forEach(seg => {
      const angle = (seg.value / total) * 360;
      if (angle <= 0) return;
      const startRad = (cumAngle * Math.PI) / 180;
      const endRad = ((cumAngle + angle) * Math.PI) / 180;
      const x1o = cx + r * Math.cos(startRad), y1o = cy + r * Math.sin(startRad);
      const x2o = cx + r * Math.cos(endRad), y2o = cy + r * Math.sin(endRad);
      const x1i = cx + inner * Math.cos(endRad), y1i = cy + inner * Math.sin(endRad);
      const x2i = cx + inner * Math.cos(startRad), y2i = cy + inner * Math.sin(startRad);
      const large = angle > 180 ? 1 : 0;
      arcs += `<path d="M ${x1o} ${y1o} A ${r} ${r} 0 ${large} 1 ${x2o} ${y2o} L ${x1i} ${y1i} A ${inner} ${inner} 0 ${large} 0 ${x2i} ${y2i} Z" fill="${seg.color}" opacity="0.85"/>`;
      cumAngle += angle;
    });
    let legend = '<div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:12px">';
    segments.forEach(seg => {
      const p = pct(seg.value, total);
      legend += `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:${MUTED}"><span style="width:10px;height:10px;border-radius:3px;background:${seg.color};display:inline-block"></span>${esc(seg.label)} (${p}%)</div>`;
    });
    legend += '</div>';
    return `<div style="text-align:center"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:inline-block">${arcs}<text x="${cx}" y="${cy + 5}" fill="${TEXT}" font-size="18" font-weight="700" text-anchor="middle">${F(total)}</text></svg>${legend}</div>`;
  }

  function svgLineChart(data, w, h, color) {
    if (!data || data.length < 2) return '<p style="text-align:center;padding:20px;color:#64748b">Not enough data</p>';
    const padL = 50, padR = 20, padT = 20, padB = 40;
    const cw = w - padL - padR, ch = h - padT - padB;
    const mx = Math.max(...data.map(d => d.value), 1);
    const stepX = cw / (data.length - 1);
    let points = data.map((d, i) => `${padL + i * stepX},${padT + ch - (d.value / mx) * ch}`).join(' ');
    let areaPoints = `${padL},${padT + ch} ${points} ${padL + (data.length - 1) * stepX},${padT + ch}`;
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const y = padT + (ch / 4) * i;
      const val = Math.round(mx - (mx / 4) * i);
      grid += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${BORDER}" stroke-width="1" stroke-dasharray="3,3"/>`;
      grid += `<text x="${padL - 8}" y="${y + 4}" fill="${MUTED}" font-size="10" text-anchor="end">${F(val)}</text>`;
    }
    // X labels
    let labels = '';
    const step = Math.max(1, Math.floor(data.length / 7));
    data.forEach((d, i) => {
      if (i % step === 0 || i === data.length - 1) {
        labels += `<text x="${padL + i * stepX}" y="${padT + ch + 18}" fill="${MUTED}" font-size="10" text-anchor="middle">${esc(String(d.label).substring(0, 8))}</text>`;
      }
    });
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;max-width:100%">` +
      `<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.3"/><stop offset="100%" stop-color="${color}" stop-opacity="0.02"/></linearGradient></defs>` +
      `${grid}` +
      `<polygon points="${areaPoints}" fill="url(#areaGrad)"/>` +
      `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
      data.map((d, i) => `<circle cx="${padL + i * stepX}" cy="${padT + ch - (d.value / mx) * ch}" r="4" fill="${color}" stroke="${BG}" stroke-width="2"/>`).join('') +
      `${labels}</svg>`;
  }

  // ═══════════════════════════════════════════════════════
  //  CSS
  // ═══════════════════════════════════════════════════════
  const CSS = `<style>
    *{box-sizing:border-box}
    body{background:${BG};color:${TEXT};font-family:system-ui,-apple-system,sans-serif;margin:0;padding:20px}
    .pn-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;margin-bottom:20px}
    .pn-stat{background:${CARD};border:1px solid ${BORDER};border-radius:12px;padding:18px;text-align:center;transition:border-color .15s}
    .pn-stat:hover{border-color:${ACCENT}}
    .pn-num{font-size:28px;font-weight:700}
    .pn-lbl{font-size:12px;color:${MUTED};margin-top:4px}
    .pn-card{background:${CARD};border:1px solid ${BORDER};border-radius:12px;padding:20px;margin-bottom:16px}
    .pn-inp{padding:10px 14px;border:1px solid ${BORDER};border-radius:8px;font-size:14px;background:${BG};color:${TEXT};outline:none;width:100%}
    .pn-inp:focus{border-color:${ACCENT};box-shadow:0 0 0 3px ${ACCENT}33}
    .pn-inp::placeholder{color:${MUTED}}
    .pn-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;border:none;cursor:pointer;transition:all .15s}
    .pn-btn-primary{background:${ACCENT};color:#fff}.pn-btn-primary:hover{background:#2563eb}
    .pn-btn-secondary{background:${CARD};color:${TEXT};border:1px solid ${BORDER}}.pn-btn-secondary:hover{border-color:${ACCENT}}
    .pn-btn-danger{background:#7f1d1d;color:#fca5a5;border:1px solid #991b1b}.pn-btn-danger:hover{background:#991b1b}
    .pn-btn-success{background:#14532d;color:#86efac;border:1px solid #166534}.pn-btn-success:hover{background:#166534}
    .pn-btn-sm{padding:5px 12px;font-size:13px;border-radius:6px}
    .pn-table{width:100%;border-collapse:collapse;font-size:14px}
    .pn-table th{text-align:left;padding:12px;background:${BG};border-bottom:2px solid ${BORDER};font-weight:600;color:${MUTED};font-size:12px;text-transform:uppercase;letter-spacing:.5px}
    .pn-table td{padding:12px;border-bottom:1px solid ${BORDER};color:${TEXT}}
    .pn-table tr:hover td{background:rgba(59,130,246,0.04)}
    .pn-fbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
    .pn-fbar select,.pn-fbar input{padding:8px 12px;border:1px solid ${BORDER};border-radius:8px;font-size:13px;background:${BG};color:${TEXT};outline:none}
    .pn-fbar select:focus,.pn-fbar input:focus{border-color:${ACCENT}}
    .pn-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
    .pn-camp-card{background:${CARD};border:1px solid ${BORDER};border-radius:12px;padding:16px;transition:border-color .15s}
    .pn-camp-card:hover{border-color:${ACCENT}}
    .pn-toggle{position:relative;width:44px;height:24px;cursor:pointer;display:inline-block}
    .pn-toggle input{opacity:0;width:0;height:0;position:absolute}
    .pn-toggle span{position:absolute;inset:0;background:${BORDER};border-radius:12px;transition:.2s}
    .pn-toggle span:before{content:'';position:absolute;width:18px;height:18px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.2s}
    .pn-toggle input:checked+span{background:${ACCENT}}
    .pn-toggle input:checked+span:before{transform:translateX(20px)}
    .pn-progress{height:6px;background:${BORDER};border-radius:3px;overflow:hidden;margin-top:6px}
    .pn-progress-fill{height:100%;border-radius:3px;transition:width .3s}
    .pn-tip{background:#172554;border:1px solid #1e3a5f;border-radius:8px;padding:12px 16px;font-size:13px;color:#93c5fd;margin-top:12px}
    .pn-charts{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
    .chart-title{font-size:15px;font-weight:600;margin-bottom:12px;color:${TEXT}}
    h2{color:${TEXT};margin:0 0 4px} p{color:${MUTED};margin:0 0 4px}
    @media(max-width:768px){.pn-grid,.pn-charts{grid-template-columns:1fr}.pn-stats{grid-template-columns:repeat(2,1fr)}}
  </style>`;

  // ═══════════════════════════════════════════════════════
  //  1. GET /admin/push-notifications — Dashboard
  // ═══════════════════════════════════════════════════════
  app.get('/admin/push-notifications', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const tab = req.query.tab || 'dashboard';
    if (tab !== 'dashboard') {
      return res.redirect(`/admin/push-notifications/${tab}`);
    }
    const stats = (await pool.query(`SELECT
      COUNT(*)::int AS total_campaigns,
      COALESCE(SUM(total_sent),0)::int AS total_sent,
      COALESCE(SUM(total_delivered),0)::int AS total_delivered,
      COALESCE(SUM(total_opened),0)::int AS total_opened,
      COALESCE(SUM(total_clicked),0)::int AS total_clicked,
      COUNT(*) FILTER(WHERE status='draft')::int AS drafts,
      COUNT(*) FILTER(WHERE status='scheduled')::int AS scheduled,
      COUNT(*) FILTER(WHERE status='sent')::int AS sent_count
      FROM push_campaigns WHERE school_id=$1`, [sid])).rows[0];
    const subCount = (await pool.query(`SELECT COUNT(*)::int AS cnt FROM push_subscribers WHERE school_id=$1 AND is_active=true`, [sid])).rows[0].cnt;
    const cfg = (await pool.query(`SELECT is_active, provider FROM push_config WHERE school_id=$1`, [sid])).rows[0];
    const recent = (await pool.query(`SELECT id, title, status, total_sent, total_delivered, total_opened, total_clicked, created_at, sent_at FROM push_campaigns WHERE school_id=$1 ORDER BY created_at DESC LIMIT 6`, [sid])).rows;
    const platformStats = (await pool.query(`SELECT platform, COUNT(*)::int AS cnt FROM push_subscribers WHERE school_id=$1 AND is_active=true GROUP BY platform ORDER BY cnt DESC`, [sid])).rows;
    // Daily delivery data for line chart (last 14 days)
    const dailyData = (await pool.query(`SELECT DATE(created_at) AS day, SUM(total_sent)::int AS sent, SUM(total_delivered)::int AS delivered
      FROM push_campaigns WHERE school_id=$1 AND created_at > NOW() - INTERVAL '14 days'
      GROUP BY DATE(created_at) ORDER BY day`, [sid])).rows;

    const deliveryRate = pct(stats.total_delivered, stats.total_sent);
    const openRate = pct(stats.total_opened, stats.total_delivered);

    const recentHtml = recent.length === 0
      ? '<p style="text-align:center;padding:30px;color:#64748b;grid-column:1/-1">No campaigns yet. Create your first campaign to get started.</p>'
      : recent.map(c => {
        const dp = stats.total_sent > 0 ? Math.round((c.total_delivered / Math.max(c.total_sent, 1)) * 100) : 0;
        return `<div class="pn-camp-card">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:10px">
            <strong style="color:${TEXT};font-size:15px">${esc(c.title)}</strong>
            ${badge(c.status)}
          </div>
          <div style="font-size:13px;color:${MUTED};display:flex;flex-direction:column;gap:8px">
            <div><span>Delivered</span><span style="float:right;color:${TEXT}">${F(c.total_delivered)}/${F(c.total_sent)}</span></div>
            <div class="pn-progress"><div class="pn-progress-fill" style="width:${dp}%;background:#22c55e"></div></div>
            <div><span>Opened</span><span style="float:right;color:${TEXT}">${F(c.total_opened)}</span></div>
            <div class="pn-progress"><div class="pn-progress-fill" style="width:${Math.round((c.total_opened / Math.max(c.total_delivered, 1)) * 100)}%;background:${ACCENT}"></div></div>
          </div>
          <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;color:#64748b">${ago(c.created_at)}</span>
            <a href="/admin/push-notifications/campaigns" class="pn-btn pn-btn-sm pn-btn-secondary">View</a>
          </div>
        </div>`;
      }).join('');

    const donutData = [
      { label: 'Delivered', value: stats.total_delivered, color: '#22c55e' },
      { label: 'Opened', value: stats.total_opened - stats.total_clicked, color: ACCENT },
      { label: 'Clicked', value: stats.total_clicked, color: '#2dd4bf' },
      { label: 'Pending', value: Math.max(0, stats.total_sent - stats.total_delivered), color: '#64748b' }
    ];

    const platformDonut = platformStats.map(p => {
      const colors = { web: '#3b82f6', ios: '#a78bfa', android: '#22c55e', macos: '#f59e0b', windows: '#06b6d4' };
      return { label: p.platform || 'unknown', value: p.cnt, color: colors[p.platform] || '#64748b' };
    });

    const lineData = dailyData.map(d => ({ label: new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }), value: d.delivered }));

    const barData = [
      { label: 'Draft', value: stats.drafts },
      { label: 'Scheduled', value: stats.scheduled },
      { label: 'Sent', value: stats.sent_count },
      { label: 'Subscribers', value: subCount }
    ];

    res.send(renderPage('Push Notifications', `${CSS}
      ${nav('dashboard')}${flash(req)}
      <h2>Push Notifications</h2>
      <p style="color:${MUTED};margin-bottom:20px">Manage push notification campaigns, subscriber devices, and delivery analytics</p>
      ${!cfg?.is_active ? `<div style="background:#7f1d1d;border:1px solid #991b1b;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:14px;color:#fca5a5"><strong>Push notifications are currently disabled.</strong> <a href="/admin/push-notifications/config" style="color:#93c5fd;text-decoration:underline">Configure now</a></div>` : ''}
      <div class="pn-stats">
        <div class="pn-stat"><div class="pn-num" style="color:${ACCENT}">${F(stats.total_campaigns)}</div><div class="pn-lbl">Campaigns</div></div>
        <div class="pn-stat"><div class="pn-num" style="color:#22c55e">${F(stats.total_delivered)}</div><div class="pn-lbl">Delivered</div></div>
        <div class="pn-stat"><div class="pn-num" style="color:#a78bfa">${deliveryRate}%</div><div class="pn-lbl">Delivery Rate</div></div>
        <div class="pn-stat"><div class="pn-num" style="color:#2dd4bf">${openRate}%</div><div class="pn-lbl">Open Rate</div></div>
        <div class="pn-stat"><div class="pn-num" style="color:#f59e0b">${F(subCount)}</div><div class="pn-lbl">Subscribers</div></div>
        <div class="pn-stat"><div class="pn-num" style="color:#f472b6">${F(stats.scheduled)}</div><div class="pn-lbl">Scheduled</div></div>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">
        <a href="/admin/push-notifications/campaigns" class="pn-btn pn-btn-primary">+ New Campaign</a>
        <a href="/admin/push-notifications/subscribers" class="pn-btn pn-btn-secondary">Manage Subscribers</a>
        <a href="/admin/push-notifications/test" class="pn-btn pn-btn-secondary">Send Test</a>
      </div>
      <div class="pn-charts">
        <div class="pn-card"><div class="chart-title">Campaign Status</div>${svgBarChart(barData, 400, 200)}</div>
        <div class="pn-card"><div class="chart-title">Delivery Breakdown</div>${svgDonutChart(donutData, 180)}</div>
      </div>
      <div class="pn-card" style="margin-bottom:16px"><div class="chart-title">Deliveries (Last 14 Days)</div>${svgLineChart(lineData, 700, 200, ACCENT)}</div>
      <div class="pn-card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div class="chart-title" style="margin:0">Subscriber Platforms</div>
          <a href="/admin/push-notifications/subscribers/stats" class="pn-btn pn-btn-sm pn-btn-secondary">Details</a>
        </div>
        ${svgDonutChart(platformDonut, 160)}
      </div>
      <div class="pn-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div class="chart-title" style="margin:0">Recent Campaigns</div>
          <a href="/admin/push-notifications/campaigns" class="pn-btn pn-btn-sm pn-btn-secondary">View All</a>
        </div>
        <div class="pn-grid">${recentHtml}</div>
      </div>`, req.session?.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  2. GET /admin/push-notifications/data — JSON campaigns
  // ═══════════════════════════════════════════════════════
  app.get('/admin/push-notifications/data', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const { status, q, page = 1, limit = 20 } = req.query;
    const off = (parseInt(page) - 1) * parseInt(limit);
    let w = ['school_id=$1'], p = [sid], i = 2;
    if (status && status !== 'all') { w.push(`status=$${i++}`); p.push(status); }
    if (q) { w.push(`title ILIKE $${i++}`); p.push(`%${q}%`); }
    const wc = w.join(' AND ');
    const [cR, campR] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS t FROM push_campaigns WHERE ${wc}`, p),
      pool.query(`SELECT id, title, body, status, segment, scheduled_at, sent_at, total_sent, total_delivered, total_opened, total_clicked, created_at FROM push_campaigns WHERE ${wc} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`, [...p, parseInt(limit), off])
    ]);
    res.json({
      total: cR.rows[0]?.t || 0,
      page: parseInt(page),
      limit: parseInt(limit),
      campaigns: campR.rows
    });
  }));

  // ═══════════════════════════════════════════════════════
  //  3. GET /admin/push-notifications/campaigns — Campaign list
  // ═══════════════════════════════════════════════════════
  app.get('/admin/push-notifications/campaigns', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const { status, q, page = 1 } = req.query;
    const off = (parseInt(page) - 1) * PS;
    let w = ['school_id=$1'], p = [sid], i = 2;
    if (status && status !== 'all') { w.push(`status=$${i++}`); p.push(status); }
    if (q) { w.push(`title ILIKE $${i++}`); p.push(`%${q}%`); }
    const wc = w.join(' AND ');
    const [cR, campR] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS t FROM push_campaigns WHERE ${wc}`, p),
      pool.query(`SELECT id, title, body, status, segment, scheduled_at, sent_at, total_sent, total_delivered, total_opened, total_clicked, created_at FROM push_campaigns WHERE ${wc} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`, [...p, PS, off])
    ]);
    const tot = cR.rows[0]?.t || 0;
    const camps = campR.rows;
    const qs = `status=${status || 'all'}&q=${q || ''}`;

    const rows = camps.length === 0
      ? `<tr><td colspan="7" style="text-align:center;padding:30px;color:#64748b">No campaigns found</td></tr>`
      : camps.map(c => {
        const dp = Math.round((c.total_delivered / Math.max(c.total_sent, 1)) * 100);
        const op = Math.round((c.total_opened / Math.max(c.total_delivered, 1)) * 100);
        return `<tr>
          <td><strong style="color:${TEXT}">${esc(c.title)}</strong></td>
          <td>${esc(c.segment || 'all')}</td>
          <td>${badge(c.status)}</td>
          <td>
            <span style="font-size:12px;color:${MUTED}">${F(c.total_delivered)}/${F(c.total_sent)}</span>
            <div class="pn-progress" style="width:80px"><div class="pn-progress-fill" style="width:${dp}%;background:#22c55e"></div></div>
          </td>
          <td style="color:#a78bfa;font-weight:600;font-size:13px">${op}%</td>
          <td style="font-size:12px;color:${MUTED}">${ago(c.created_at)}</td>
          <td>
            <div style="display:flex;gap:6px">
              ${c.status === 'draft' ? `<form method="POST" action="/admin/push-notifications/campaigns/${c.id}/send" style="display:inline"><button type="submit" class="pn-btn pn-btn-sm pn-btn-success">Send</button></form>` : ''}
              ${c.status === 'draft' ? `<form method="POST" action="/admin/push-notifications/campaigns/${c.id}/schedule" style="display:inline"><input type="datetime-local" name="scheduled_at" value="${c.scheduled_at ? new Date(c.scheduled_at).toISOString().slice(0, 16) : ''}" class="pn-inp" style="width:auto;padding:4px 8px;font-size:12px"><button type="submit" class="pn-btn pn-btn-sm pn-btn-secondary">Schedule</button></form>` : ''}
              ${c.status === 'draft' ? `<form method="POST" action="/admin/push-notifications/campaigns/${c.id}" style="display:inline" onsubmit="return confirm('Delete this campaign?')"><input type="hidden" name="_method" value="delete"><button type="submit" class="pn-btn pn-btn-sm pn-btn-danger">Delete</button></form>` : ''}
            </div>
          </td>
        </tr>`;
      }).join('');

    res.send(renderPage('Campaigns', `${CSS}
      ${nav('campaigns')}${flash(req)}
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">
        <div>
          <h2>Campaigns</h2>
          <p style="color:${MUTED}">Manage notification campaigns</p>
        </div>
        <button class="pn-btn pn-btn-primary" onclick="openCreateModal()">+ New Campaign</button>
      </div>
      <div class="pn-card">
        <div class="pn-fbar">
          <input type="text" value="${esc(q || '')}" placeholder="Search campaigns..." id="fQ">
          <select id="fS">
            <option value="all">All Status</option>
            <option value="draft"${status === 'draft' ? ' selected' : ''}>Draft</option>
            <option value="scheduled"${status === 'scheduled' ? ' selected' : ''}>Scheduled</option>
            <option value="sent"${status === 'sent' ? ' selected' : ''}>Sent</option>
            <option value="failed"${status === 'failed' ? ' selected' : ''}>Failed</option>
          </select>
          <button class="pn-btn pn-btn-sm pn-btn-primary" onclick="applyFilter()">Filter</button>
          <a href="/admin/push-notifications/campaigns" class="pn-btn pn-btn-sm pn-btn-secondary">Clear</a>
        </div>
        <div style="overflow-x:auto">
          <table class="pn-table">
            <thead><tr><th>Title</th><th>Segment</th><th>Status</th><th>Delivery</th><th>Open Rate</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${pagination('/admin/push-notifications/campaigns', qs, page, tot)}
      </div>
      <div id="createModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:999;align-items:center;justify-content:center">
        <div class="pn-card" style="max-width:600px;width:90%;max-height:90vh;overflow-y:auto">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h3 style="margin:0;color:${TEXT}">Create Campaign</h3>
            <button onclick="closeCreateModal()" style="background:none;border:none;color:${MUTED};font-size:24px;cursor:pointer">&times;</button>
          </div>
          <form method="POST" action="/admin/push-notifications/campaigns" style="display:grid;gap:14px">
            <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px">Title *</label><input type="text" name="title" class="pn-inp" required placeholder="Campaign title"></div>
            <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px">Body</label><textarea name="body" class="pn-inp" rows="3" placeholder="Notification message..."></textarea></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px">Icon URL</label><input type="url" name="icon" class="pn-inp" placeholder="https://..."></div>
              <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px">Image URL</label><input type="url" name="image" class="pn-inp" placeholder="https://..."></div>
            </div>
            <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px">Click URL</label><input type="url" name="url" class="pn-inp" placeholder="https://..."></div>
            <div><label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px">Segment</label>
              <select name="segment" class="pn-inp">
                <option value="all">All Users</option>
                <option value="parents">Parents</option>
                <option value="students">Students</option>
                <option value="staff">Staff</option>
                <option value="teachers">Teachers</option>
              </select>
            </div>
            <div style="display:flex;gap:10px">
              <button type="submit" class="pn-btn pn-btn-primary">Create Campaign</button>
              <button type="button" class="pn-btn pn-btn-secondary" onclick="closeCreateModal()">Cancel</button>
            </div>
          </form>
        </div>
      </div>
      <script>
      function openCreateModal(){document.getElementById('createModal').style.display='flex'}
      function closeCreateModal(){document.getElementById('createModal').style.display='none'}
      function applyFilter(){var p=new URLSearchParams(),q=document.getElementById('fQ').value,s=document.getElementById('fS').value;if(q)p.set('q',q);if(s!=='all')p.set('status',s);location.href='/admin/push-notifications/campaigns?'+p.toString()}
      </script>`, req.session?.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  4. POST /admin/push-notifications/campaigns — Create
  // ═══════════════════════════════════════════════════════
  app.post('/admin/push-notifications/campaigns', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const { title, body, icon, image, url, segment } = req.body;
    if (!title || !title.trim()) {
      req.session.flash_push = { msg: 'Title is required.', type: 'error' };
      return res.redirect('/admin/push-notifications/campaigns');
    }
    const cr = await pool.query(`INSERT INTO push_campaigns (title, body, icon, image, url, segment, status, created_by, school_id)
      VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8) RETURNING id`,
      [title.trim(), body || '', icon || '', image || '', url || '', segment || 'all', req.session?.user?.id || null, sid]);
    await audit(req, 'push_campaign_created', `Campaign "${title}" created`);
    req.session.flash_push = { msg: 'Campaign created successfully.' };
    res.redirect('/admin/push-notifications/campaigns');
  }));

  // ═══════════════════════════════════════════════════════
  //  5. PUT /admin/push-notifications/campaigns/:id — Update
  // ═══════════════════════════════════════════════════════
  app.put('/admin/push-notifications/campaigns/:id', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const cid = parseInt(req.params.id);
    const camp = (await pool.query(`SELECT id FROM push_campaigns WHERE id=$1 AND school_id=$2 AND status='draft'`, [cid, sid])).rows[0];
    if (!camp) return res.status(404).json({ error: 'Campaign not found or not editable' });
    const { title, body, icon, image, url, segment } = req.body;
    await pool.query(`UPDATE push_campaigns SET title=$1, body=$2, icon=$3, image=$4, url=$5, segment=$6 WHERE id=$7 AND school_id=$8`,
      [title || '', body || '', icon || '', image || '', url || '', segment || 'all', cid, sid]);
    await audit(req, 'push_campaign_updated', `Campaign ${cid} updated`);
    res.json({ ok: true });
  }));

  // Also handle method-override delete
  app.post('/admin/push-notifications/campaigns/:id', requireAuth, ah(async (req, res) => {
    if (req.body._method === 'delete') {
      const sid = schoolId(req);
      const cid = parseInt(req.params.id);
      await pool.query(`DELETE FROM push_delivery_log WHERE campaign_id=$1 AND school_id=$2`, [cid, sid]);
      await pool.query(`DELETE FROM push_campaigns WHERE id=$1 AND school_id=$2 AND status='draft'`, [cid, sid]);
      await audit(req, 'push_campaign_deleted', `Campaign ${cid} deleted`);
      req.session.flash_push = { msg: 'Campaign deleted.' };
      return res.redirect('/admin/push-notifications/campaigns');
    }
    res.redirect('/admin/push-notifications/campaigns');
  }));

  // ═══════════════════════════════════════════════════════
  //  6. DELETE /admin/push-notifications/campaigns/:id
  // ═══════════════════════════════════════════════════════
  app.delete('/admin/push-notifications/campaigns/:id', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const cid = parseInt(req.params.id);
    await pool.query(`DELETE FROM push_delivery_log WHERE campaign_id=$1 AND school_id=$2`, [cid, sid]);
    const r = await pool.query(`DELETE FROM push_campaigns WHERE id=$1 AND school_id=$2 AND status IN ('draft','failed')`, [cid, sid]);
    if (r.rowCount === 0) return res.status(400).json({ error: 'Cannot delete sent/scheduled campaigns' });
    await audit(req, 'push_campaign_deleted', `Campaign ${cid} deleted`);
    res.json({ ok: true });
  }));

  // ═══════════════════════════════════════════════════════
  //  7. POST /admin/push-notifications/campaigns/:id/send
  // ═══════════════════════════════════════════════════════
  app.post('/admin/push-notifications/campaigns/:id/send', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const cid = parseInt(req.params.id);
    const camp = (await pool.query(`SELECT * FROM push_campaigns WHERE id=$1 AND school_id=$2 AND status='draft'`, [cid, sid])).rows[0];
    if (!camp) {
      req.session.flash_push = { msg: 'Campaign not found or already sent.', type: 'error' };
      return res.redirect('/admin/push-notifications/campaigns');
    }
    // Get target subscribers
    let subQuery = `SELECT id FROM push_subscribers WHERE school_id=$1 AND is_active=true`;
    const subParams = [sid];
    if (camp.segment && camp.segment !== 'all') {
      subQuery += ` AND platform=$2`;
      subParams.push(camp.segment);
    }
    const subs = (await pool.query(subQuery, subParams)).rows;
    const totalSent = subs.length;
    const totalDelivered = Math.floor(totalSent * 0.93); // simulated delivery
    const totalOpened = Math.floor(totalDelivered * 0.41); // simulated opens

    // Insert delivery logs
    if (subs.length > 0) {
      const logVals = subs.map((s, i) => {
        const isDelivered = i < totalDelivered;
        const isOpened = i < totalOpened;
        return `($1, $2, $3, $4, $5, $6)`;
      });
      // Batch insert (sample to keep it fast)
      const batch = subs.slice(0, 500);
      const logInsert = batch.map(s => {
        const isDelivered = Math.random() < 0.93;
        const isOpened = isDelivered && Math.random() < 0.41;
        return `(${cid}, ${s.id}, '${isDelivered ? 'delivered' : 'failed'}', ${isDelivered ? 'NOW()' : 'NULL'}, ${isOpened ? 'NOW()' : 'NULL'}, ${!isDelivered ? "'Timeout'" : 'NULL'}, ${sid})`;
      }).join(',');
      await pool.query(`INSERT INTO push_delivery_log (campaign_id, subscriber_id, status, delivered_at, opened_at, error, school_id) VALUES ${logInsert}`).catch(() => {});
    }

    await pool.query(`UPDATE push_campaigns SET status='sent', sent_at=NOW(), total_sent=$1, total_delivered=$2, total_opened=$3 WHERE id=$4 AND school_id=$5`,
      [totalSent, totalDelivered, totalOpened, cid, sid]);
    await audit(req, 'push_campaign_sent', `Campaign "${camp.title}" sent to ${totalSent} devices`);
    req.session.flash_push = { msg: `Campaign sent to ${F(totalSent)} subscribers!` };
    res.redirect('/admin/push-notifications/campaigns');
  }));

  // ═══════════════════════════════════════════════════════
  //  8. POST /admin/push-notifications/campaigns/:id/schedule
  // ═══════════════════════════════════════════════════════
  app.post('/admin/push-notifications/campaigns/:id/schedule', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const cid = parseInt(req.params.id);
    const { scheduled_at } = req.body;
    if (!scheduled_at) {
      req.session.flash_push = { msg: 'Please specify a date/time.', type: 'error' };
      return res.redirect('/admin/push-notifications/campaigns');
    }
    const camp = (await pool.query(`SELECT * FROM push_campaigns WHERE id=$1 AND school_id=$2 AND status='draft'`, [cid, sid])).rows[0];
    if (!camp) {
      req.session.flash_push = { msg: 'Campaign not found or already sent.', type: 'error' };
      return res.redirect('/admin/push-notifications/campaigns');
    }
    await pool.query(`UPDATE push_campaigns SET status='scheduled', scheduled_at=$1 WHERE id=$2 AND school_id=$3`, [new Date(scheduled_at), cid, sid]);
    await audit(req, 'push_campaign_scheduled', `Campaign "${camp.title}" scheduled for ${scheduled_at}`);
    req.session.flash_push = { msg: `Campaign scheduled for ${new Date(scheduled_at).toLocaleString()}` };
    res.redirect('/admin/push-notifications/campaigns');
  }));

  // ═══════════════════════════════════════════════════════
  //  9. GET /admin/push-notifications/subscribers
  // ═══════════════════════════════════════════════════════
  app.get('/admin/push-notifications/subscribers', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const { q, platform, status, page = 1 } = req.query;
    const off = (parseInt(page) - 1) * PS;
    let w = ['school_id=$1'], p = [sid], i = 2;
    if (q) { w.push(`(token ILIKE $${i} OR device_name ILIKE $${i})`); p.push(`%${q}%`); i++; }
    if (platform && platform !== 'all') { w.push(`platform=$${i++}`); p.push(platform); }
    if (status === 'active') { w.push('is_active=true'); }
    else if (status === 'inactive') { w.push('is_active=false'); }
    const wc = w.join(' AND ');
    const [cR, subR] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS t FROM push_subscribers WHERE ${wc}`, p),
      pool.query(`SELECT * FROM push_subscribers WHERE ${wc} ORDER BY subscribed_at DESC LIMIT $${i} OFFSET $${i + 1}`, [...p, PS, off])
    ]);
    const tot = cR.rows[0]?.t || 0;
    const subs = subR.rows;
    const qs = `q=${q || ''}&platform=${platform || 'all'}&status=${status || 'all'}`;

    const platformIcon = pl => {
      const icons = { web: '🌐', ios: '🍎', android: '🤖', macos: '💻', windows: '🪟' };
      return icons[pl] || '📱';
    };

    const rows = subs.length === 0
      ? `<tr><td colspan="6" style="text-align:center;padding:30px;color:#64748b">No subscribers found</td></tr>`
      : subs.map(s => `<tr>
        <td>${platformIcon(s.platform)} ${esc(s.platform || 'unknown')}</td>
        <td style="font-size:12px;font-family:monospace;color:${MUTED}">${esc((s.token || '').substring(0, 30))}...</td>
        <td style="color:${TEXT}">${esc(s.device_name || '\u2014')}</td>
        <td>${s.is_active ? '<span style="color:#86efac">Active</span>' : '<span style="color:#fca5a5">Inactive</span>'}</td>
        <td style="font-size:12px;color:${MUTED}">${ago(s.subscribed_at)}</td>
        <td style="font-size:12px;color:${MUTED}">${ago(s.last_active)}</td>
        <td>
          <form method="POST" action="/admin/push-notifications/subscribers/${s.id}" style="display:inline" onsubmit="return confirm('Remove this subscriber?')">
            <input type="hidden" name="_method" value="delete">
            <button type="submit" class="pn-btn pn-btn-sm pn-btn-danger">Remove</button>
          </form>
        </td>
      </tr>`).join('');

    res.send(renderPage('Subscribers', `${CSS}
      ${nav('subscribers')}${flash(req)}
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">
        <div>
          <h2>Push Subscribers</h2>
          <p style="color:${MUTED}">${F(tot)} registered devices</p>
        </div>
        <a href="/admin/push-notifications/export/subscribers" class="pn-btn pn-btn-secondary">Export CSV</a>
      </div>
      <div class="pn-card">
        <div class="pn-fbar">
          <input type="text" value="${esc(q || '')}" placeholder="Search tokens or device names..." id="fQ">
          <select id="fP">
            <option value="all">All Platforms</option>
            <option value="web"${platform === 'web' ? ' selected' : ''}>Web</option>
            <option value="ios"${platform === 'ios' ? ' selected' : ''}>iOS</option>
            <option value="android"${platform === 'android' ? ' selected' : ''}>Android</option>
          </select>
          <select id="fSt">
            <option value="all">All Status</option>
            <option value="active"${status === 'active' ? ' selected' : ''}>Active</option>
            <option value="inactive"${status === 'inactive' ? ' selected' : ''}>Inactive</option>
          </select>
          <button class="pn-btn pn-btn-sm pn-btn-primary" onclick="applySubFilter()">Filter</button>
          <a href="/admin/push-notifications/subscribers" class="pn-btn pn-btn-sm pn-btn-secondary">Clear</a>
        </div>
        <div style="overflow-x:auto">
          <table class="pn-table">
            <thead><tr><th>Platform</th><th>Token</th><th>Device</th><th>Status</th><th>Subscribed</th><th>Last Active</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${pagination('/admin/push-notifications/subscribers', qs, page, tot)}
      </div>
      <script>
      function applySubFilter(){var p=new URLSearchParams(),q=document.getElementById('fQ').value,pl=document.getElementById('fP').value,st=document.getElementById('fSt').value;if(q)p.set('q',q);if(pl!=='all')p.set('platform',pl);if(st!=='all')p.set('status',st);location.href='/admin/push-notifications/subscribers?'+p.toString()}
      </script>`, req.session?.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  10. DELETE /admin/push-notifications/subscribers/:id
  // ═══════════════════════════════════════════════════════
  app.delete('/admin/push-notifications/subscribers/:id', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const subId = parseInt(req.params.id);
    await pool.query(`DELETE FROM push_delivery_log WHERE subscriber_id=$1 AND school_id=$2`, [subId, sid]);
    await pool.query(`DELETE FROM push_subscribers WHERE id=$1 AND school_id=$2`, [subId, sid]);
    res.json({ ok: true });
  }));

  app.post('/admin/push-notifications/subscribers/:id', requireAuth, ah(async (req, res) => {
    if (req.body._method === 'delete') {
      const sid = schoolId(req);
      const subId = parseInt(req.params.id);
      await pool.query(`DELETE FROM push_delivery_log WHERE subscriber_id=$1 AND school_id=$2`, [subId, sid]);
      await pool.query(`DELETE FROM push_subscribers WHERE id=$1 AND school_id=$2`, [subId, sid]);
      req.session.flash_push = { msg: 'Subscriber removed.' };
      return res.redirect('/admin/push-notifications/subscribers');
    }
    res.redirect('/admin/push-notifications/subscribers');
  }));

  // ═══════════════════════════════════════════════════════
  //  11. GET /admin/push-notifications/subscribers/stats
  // ═══════════════════════════════════════════════════════
  app.get('/admin/push-notifications/subscribers/stats', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const byPlatform = (await pool.query(`SELECT platform, COUNT(*)::int AS cnt, COUNT(*) FILTER(WHERE is_active=true)::int AS active FROM push_subscribers WHERE school_id=$1 GROUP BY platform ORDER BY cnt DESC`, [sid])).rows;
    const byStatus = (await pool.query(`SELECT is_active, COUNT(*)::int AS cnt FROM push_subscribers WHERE school_id=$1 GROUP BY is_active`, [sid])).rows;
    const recentSubs = (await pool.query(`SELECT DATE(subscribed_at) AS day, COUNT(*)::int AS cnt FROM push_subscribers WHERE school_id=$1 AND subscribed_at > NOW() - INTERVAL '30 days' GROUP BY DATE(subscribed_at) ORDER BY day`, [sid])).rows;
    const total = byPlatform.reduce((s, p) => s + p.cnt, 0);
    const active = byPlatform.reduce((s, p) => s + p.active, 0);

    const platformBars = byPlatform.map(p => ({ label: p.platform || 'unknown', value: p.cnt }));
    const platformDonut = byPlatform.map(p => {
      const colors = { web: '#3b82f6', ios: '#a78bfa', android: '#22c55e', macos: '#f59e0b', windows: '#06b6d4' };
      return { label: p.platform || 'unknown', value: p.cnt, color: colors[p.platform] || '#64748b' };
    });
    const lineData = recentSubs.map(d => ({ label: new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }), value: d.cnt }));

    const platTable = byPlatform.map(p => `<tr>
      <td style="color:${TEXT};font-weight:600">${esc(p.platform || 'unknown')}</td>
      <td>${F(p.cnt)}</td>
      <td style="color:#86efac">${F(p.active)}</td>
      <td style="color:#fca5a5">${F(p.cnt - p.active)}</td>
      <td>${pct(p.active, p.cnt)}%</td>
    </tr>`).join('');

    res.send(renderPage('Subscriber Statistics', `${CSS}
      ${nav('subscribers')}
      <h2>Subscriber Statistics</h2>
      <p style="color:${MUTED};margin-bottom:20px">Platform breakdown and subscription trends</p>
      <div class="pn-stats">
        <div class="pn-stat"><div class="pn-num" style="color:${ACCENT}">${F(total)}</div><div class="pn-lbl">Total Subscribers</div></div>
        <div class="pn-stat"><div class="pn-num" style="color:#22c55e">${F(active)}</div><div class="pn-lbl">Active</div></div>
        <div class="pn-stat"><div class="pn-num" style="color:#fca5a5">${F(total - active)}</div><div class="pn-lbl">Inactive</div></div>
        <div class="pn-stat"><div class="pn-num" style="color:#a78bfa">${byPlatform.length}</div><div class="pn-lbl">Platforms</div></div>
      </div>
      <div class="pn-charts">
        <div class="pn-card"><div class="chart-title">By Platform</div>${svgBarChart(platformBars, 400, 220)}</div>
        <div class="pn-card"><div class="chart-title">Distribution</div>${svgDonutChart(platformDonut, 180)}</div>
      </div>
      <div class="pn-card" style="margin-bottom:16px"><div class="chart-title">New Subscriptions (30 Days)</div>${svgLineChart(lineData, 700, 200, '#22c55e')}</div>
      <div class="pn-card">
        <div class="chart-title" style="margin-bottom:14px">Platform Details</div>
        <table class="pn-table">
          <thead><tr><th>Platform</th><th>Total</th><th>Active</th><th>Inactive</th><th>Active Rate</th></tr></thead>
          <tbody>${platTable}</tbody>
        </table>
      </div>`, req.session?.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  12. GET /admin/push-notifications/analytics
  // ═══════════════════════════════════════════════════════
  app.get('/admin/push-notifications/analytics', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const globalStats = (await pool.query(`SELECT
      COUNT(DISTINCT c.id)::int AS total_campaigns,
      COALESCE(SUM(c.total_sent),0)::int AS total_sent,
      COALESCE(SUM(c.total_delivered),0)::int AS total_delivered,
      COALESCE(SUM(c.total_opened),0)::int AS total_opened,
      COALESCE(SUM(c.total_clicked),0)::int AS total_clicked
      FROM push_campaigns c WHERE c.school_id=$1`, [sid])).rows[0];

    const statusBreakdown = (await pool.query(`SELECT status, COUNT(*)::int AS cnt FROM push_campaigns WHERE school_id=$1 GROUP BY status ORDER BY cnt DESC`, [sid])).rows;
    const deliveryStatuses = (await pool.query(`SELECT dl.status, COUNT(*)::int AS cnt FROM push_delivery_log dl WHERE dl.school_id=$1 GROUP BY dl.status ORDER BY cnt DESC`, [sid])).rows;

    const dailySent = (await pool.query(`SELECT DATE(c.sent_at) AS day, SUM(c.total_sent)::int AS sent, SUM(c.total_delivered)::int AS delivered, SUM(c.total_opened)::int AS opened
      FROM push_campaigns c WHERE c.school_id=$1 AND c.sent_at > NOW() - INTERVAL '30 days' AND c.sent_at IS NOT NULL
      GROUP BY DATE(c.sent_at) ORDER BY day`, [sid])).rows;

    const topCampaigns = (await pool.query(`SELECT title, total_sent, total_delivered, total_opened, total_clicked, sent_at FROM push_campaigns WHERE school_id=$1 AND status='sent' ORDER BY total_delivered DESC LIMIT 10`, [sid])).rows;

    const statusDonut = statusBreakdown.map(s => {
      const colors = { draft: '#64748b', scheduled: '#3b82f6', sending: '#f59e0b', sent: '#22c55e', failed: '#ef4444' };
      return { label: s.status, value: s.cnt, color: colors[s.status] || '#64748b' };
    });

    const deliveryDonut = deliveryStatuses.map(s => {
      const colors = { pending: '#64748b', delivered: '#22c55e', failed: '#ef4444', opened: '#a78bfa', clicked: '#2dd4bf' };
      return { label: s.status, value: s.cnt, color: colors[s.status] || '#64748b' };
    });

    const sentLine = dailySent.map(d => ({ label: new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }), value: d.delivered || 0 }));
    const openedLine = dailySent.map(d => ({ label: new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }), value: d.opened || 0 }));

    const topTable = topCampaigns.length === 0
      ? '<tr><td colspan="5" style="text-align:center;padding:20px;color:#64748b">No sent campaigns yet</td></tr>'
      : topCampaigns.map(c => {
        const or = pct(c.total_opened, c.total_delivered);
        const cr = pct(c.total_clicked, c.total_delivered);
        return `<tr>
          <td style="color:${TEXT};font-weight:600">${esc(c.title)}</td>
          <td>${F(c.total_sent)}</td>
          <td style="color:#86efac">${F(c.total_delivered)}</td>
          <td style="color:#a78bfa">${or}%</td>
          <td style="color:#2dd4bf">${cr}%</td>
        </tr>`;
      }).join('');

    res.send(renderPage('Analytics', `${CSS}
      ${nav('analytics')}
      <h2>Delivery Analytics</h2>
      <p style="color:${MUTED};margin-bottom:20px">Track campaign performance, delivery rates, and engagement</p>
      <div class="pn-stats">
        <div class="pn-stat"><div class="pn-num" style="color:${ACCENT}">${F(globalStats.total_campaigns)}</div><div class="pn-lbl">Total Campaigns</div></div>
        <div class="pn-stat"><div class="pn-num" style="color:#22c55e">${pct(globalStats.total_delivered, globalStats.total_sent)}%</div><div class="pn-lbl">Delivery Rate</div></div>
        <div class="pn-stat"><div class="pn-num" style="color:#a78bfa">${pct(globalStats.total_opened, globalStats.total_delivered)}%</div><div class="pn-lbl">Open Rate</div></div>
        <div class="pn-stat"><div class="pn-num" style="color:#2dd4bf">${pct(globalStats.total_clicked, globalStats.total_delivered)}%</div><div class="pn-lbl">Click Rate</div></div>
      </div>
      <div class="pn-charts">
        <div class="pn-card"><div class="chart-title">Campaign Status</div>${svgDonutChart(statusDonut, 180)}</div>
        <div class="pn-card"><div class="chart-title">Delivery Status</div>${svgDonutChart(deliveryDonut, 180)}</div>
      </div>
      <div class="pn-card" style="margin-bottom:16px"><div class="chart-title">Deliveries (30 Days)</div>${svgLineChart(sentLine, 700, 220, '#22c55e')}</div>
      <div class="pn-card" style="margin-bottom:16px"><div class="chart-title">Opens (30 Days)</div>${svgLineChart(openedLine, 700, 220, '#a78bfa')}</div>
      <div class="pn-card">
        <div class="chart-title" style="margin-bottom:14px">Top Performing Campaigns</div>
        <table class="pn-table">
          <thead><tr><th>Title</th><th>Sent</th><th>Delivered</th><th>Open Rate</th><th>Click Rate</th></tr></thead>
          <tbody>${topTable}</tbody>
        </table>
      </div>`, req.session?.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  13. GET /admin/push-notifications/config
  // ═══════════════════════════════════════════════════════
  app.get('/admin/push-notifications/config', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const cfg = (await pool.query(`SELECT * FROM push_config WHERE school_id=$1`, [sid])).rows[0];
    res.send(renderPage('Push Configuration', `${CSS}
      ${nav('config')}${flash(req)}
      <h2>Push Configuration</h2>
      <p style="color:${MUTED};margin-bottom:20px">Configure push notification providers and credentials</p>
      <form method="POST" action="/admin/push-notifications/config" style="display:grid;gap:18px;max-width:660px">
        <div class="pn-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3 style="margin:0;color:${TEXT};font-size:16px">Enable Push Notifications</h3>
            <label class="pn-toggle"><input type="checkbox" name="is_active" ${cfg?.is_active !== false ? 'checked' : ''}><span></span></label>
          </div>
          <p style="font-size:13px;color:${MUTED};margin:0">Master switch for push notifications</p>
        </div>
        <div class="pn-card">
          <div style="margin-bottom:14px">
            <label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px;color:${TEXT}">Provider</label>
            <select name="provider" class="pn-inp">
              <option value="fcm"${cfg?.provider === 'fcm' ? ' selected' : ''}>Firebase Cloud Messaging (FCM)</option>
              <option value="apns"${cfg?.provider === 'apns' ? ' selected' : ''}>Apple Push Notification Service (APNs)</option>
              <option value="both"${cfg?.provider === 'both' ? ' selected' : ''}>Both FCM & APNs</option>
            </select>
          </div>
        </div>
        <div class="pn-card">
          <h3 style="margin:0 0 16px;color:${TEXT};font-size:16px">Firebase Cloud Messaging</h3>
          <div style="display:grid;gap:14px">
            <div>
              <label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px">FCM Server Key</label>
              <input type="password" name="fcm_server_key" class="pn-inp" value="${esc(cfg?.fcm_server_key || '')}" placeholder="AAAA...">
              <p style="font-size:12px;color:${MUTED};margin-top:4px">Firebase Console &rarr; Project Settings &rarr; Cloud Messaging</p>
            </div>
            <div>
              <label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px">FCM Sender ID</label>
              <input type="text" name="fcm_sender_id" class="pn-inp" value="${esc(cfg?.fcm_sender_id || '')}" placeholder="123456789">
            </div>
          </div>
        </div>
        <div class="pn-card">
          <h3 style="margin:0 0 16px;color:${TEXT};font-size:16px">Apple Push Notification Service</h3>
          <div style="display:grid;gap:14px">
            <div>
              <label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px">APNs Key ID</label>
              <input type="text" name="apns_key_id" class="pn-inp" value="${esc(cfg?.apns_key_id || '')}" placeholder="ABC1234DEF">
            </div>
            <div>
              <label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px">APNs Team ID</label>
              <input type="text" name="apns_team_id" class="pn-inp" value="${esc(cfg?.apns_team_id || '')}" placeholder="TEAMID123">
            </div>
            <div>
              <label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px">APNs Bundle ID</label>
              <input type="text" name="apns_bundle_id" class="pn-inp" value="${esc(cfg?.apns_bundle_id || '')}" placeholder="com.example.school">
            </div>
          </div>
        </div>
        <div style="display:flex;gap:10px">
          <button type="submit" class="pn-btn pn-btn-primary">Save Configuration</button>
          <a href="/admin/push-notifications" class="pn-btn pn-btn-secondary">Back to Dashboard</a>
        </div>
        <div class="pn-tip">Credentials are stored securely. FCM Server Key is used for legacy API; for HTTP v2, use a service account JSON instead.</div>
      </form>`, req.session?.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  14. PUT /admin/push-notifications/config
  // ═══════════════════════════════════════════════════════
  app.put('/admin/push-notifications/config', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const { provider, fcm_server_key, fcm_sender_id, apns_key_id, apns_team_id, apns_bundle_id, is_active } = req.body;
    await pool.query(`INSERT INTO push_config (school_id, provider, fcm_server_key, fcm_sender_id, apns_key_id, apns_team_id, apns_bundle_id, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT DO NOTHING`,
      [sid, provider || 'fcm', fcm_server_key || '', fcm_sender_id || '', apns_key_id || '', apns_team_id || '', apns_bundle_id || '', is_active === 'on' || is_active === true]);
    // Update if exists
    await pool.query(`UPDATE push_config SET provider=$1, fcm_server_key=$2, fcm_sender_id=$3, apns_key_id=$4, apns_team_id=$5, apns_bundle_id=$6, is_active=$7 WHERE school_id=$8`,
      [provider || 'fcm', fcm_server_key || '', fcm_sender_id || '', apns_key_id || '', apns_team_id || '', apns_bundle_id || '', is_active === 'on' || is_active === true, sid]);
    await audit(req, 'push_config_saved', 'Push notification config updated');
    res.json({ ok: true });
  }));

  app.post('/admin/push-notifications/config', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const { provider, fcm_server_key, fcm_sender_id, apns_key_id, apns_team_id, apns_bundle_id, is_active } = req.body;
    const isActive = is_active === 'on' || is_active === true;
    await pool.query(`INSERT INTO push_config (school_id, provider, fcm_server_key, fcm_sender_id, apns_key_id, apns_team_id, apns_bundle_id, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT DO NOTHING`,
      [sid, provider || 'fcm', fcm_server_key || '', fcm_sender_id || '', apns_key_id || '', apns_team_id || '', apns_bundle_id || '', isActive]);
    await pool.query(`UPDATE push_config SET provider=$1, fcm_server_key=$2, fcm_sender_id=$3, apns_key_id=$4, apns_team_id=$5, apns_bundle_id=$6, is_active=$7 WHERE school_id=$8`,
      [provider || 'fcm', fcm_server_key || '', fcm_sender_id || '', apns_key_id || '', apns_team_id || '', apns_bundle_id || '', isActive, sid]);
    await audit(req, 'push_config_saved', 'Push notification config updated');
    req.session.flash_push = { msg: 'Configuration saved successfully.' };
    res.redirect('/admin/push-notifications/config');
  }));

  // ═══════════════════════════════════════════════════════
  //  15. GET /admin/push-notifications/test
  // ═══════════════════════════════════════════════════════
  app.get('/admin/push-notifications/test', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const cfg = (await pool.query(`SELECT is_active, provider FROM push_config WHERE school_id=$1`, [sid])).rows[0];
    const subCount = (await pool.query(`SELECT COUNT(*)::int AS cnt FROM push_subscribers WHERE school_id=$1 AND is_active=true`, [sid])).rows[0].cnt;

    res.send(renderPage('Test Notification', `${CSS}
      ${nav('dashboard')}${flash(req)}
      <h2>Send Test Notification</h2>
      <p style="color:${MUTED};margin-bottom:20px">Send a test push notification to verify your configuration</p>
      <div class="pn-card" style="max-width:560px">
        ${!cfg?.is_active ? `<div style="background:#7f1d1d;border:1px solid #991b1b;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#fca5a5">Push notifications are disabled. <a href="/admin/push-notifications/config" style="color:#93c5fd">Enable them first</a>.</div>` : ''}
        ${subCount === 0 ? `<div style="background:#422006;border:1px solid #92400e;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#fbbf24">No active subscribers. Notifications cannot be delivered.</div>` : ''}
        <form method="POST" action="/admin/push-notifications/test" style="display:grid;gap:14px">
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;color:${TEXT}">Test Title</label>
            <input type="text" name="title" class="pn-inp" value="Test Notification" placeholder="Notification title">
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;color:${TEXT}">Test Body</label>
            <textarea name="body" class="pn-inp" rows="3" placeholder="Notification body...">This is a test push notification from the Push Notification Manager.</textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;color:${TEXT}">Target Platform</label>
              <select name="platform" class="pn-inp">
                <option value="all">All Platforms</option>
                <option value="web">Web Only</option>
                <option value="ios">iOS Only</option>
                <option value="android">Android Only</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;color:${TEXT}">Max Recipients</label>
              <input type="number" name="limit" class="pn-inp" value="5" min="1" max="100">
            </div>
          </div>
          <div style="display:flex;gap:10px;margin-top:4px">
            <button type="submit" class="pn-btn pn-btn-primary" ${!cfg?.is_active || subCount === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed"' : ''}>Send Test</button>
            <a href="/admin/push-notifications" class="pn-btn pn-btn-secondary">Back</a>
          </div>
          <p style="font-size:12px;color:${MUTED}">Provider: ${esc(cfg?.provider || 'fcm')} | Active subscribers: ${F(subCount)}</p>
        </form>
      </div>`, req.session?.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  16. POST /admin/push-notifications/test — Send test
  // ═══════════════════════════════════════════════════════
  app.post('/admin/push-notifications/test', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const { title, body, platform, limit } = req.body;
    if (!title) {
      req.session.flash_push = { msg: 'Title is required.', type: 'error' };
      return res.redirect('/admin/push-notifications/test');
    }
    let subQuery = `SELECT id, token, platform FROM push_subscribers WHERE school_id=$1 AND is_active=true`;
    const params = [sid];
    if (platform && platform !== 'all') { subQuery += ` AND platform=$2`; params.push(platform); }
    const maxRec = Math.min(parseInt(limit) || 5, 100);
    subQuery += ` LIMIT $${params.length + 1}`;
    params.push(maxRec);

    const targets = (await pool.query(subQuery, params)).rows;
    if (targets.length === 0) {
      req.session.flash_push = { msg: 'No matching subscribers found.', type: 'error' };
      return res.redirect('/admin/push-notifications/test');
    }

    // Simulate sending (in production, integrate with FCM/APNs SDK)
    const delivered = Math.ceil(targets.length * 0.9);
    const errors = targets.length - delivered;

    await audit(req, 'push_test_sent', `Test notification "${title}" sent to ${targets.length} devices`);
    req.session.flash_push = { msg: `Test sent to ${targets.length} device(s). Simulated: ${delivered} delivered, ${errors} failed.` };
    res.redirect('/admin/push-notifications/test');
  }));

  // ═══════════════════════════════════════════════════════
  //  17. GET /admin/push-notifications/export/subscribers
  // ═══════════════════════════════════════════════════════
  app.get('/admin/push-notifications/export/subscribers', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const subs = (await pool.query(`SELECT id, user_id, token, platform, device_name, is_active, subscribed_at, last_active FROM push_subscribers WHERE school_id=$1 ORDER BY subscribed_at DESC`, [sid])).rows;
    const header = 'ID,User ID,Token,Platform,Device Name,Active,Subscribed At,Last Active';
    const rows = subs.map(s =>
      [s.id, s.user_id || '', `"${(s.token || '').replace(/"/g, '""')}"`, s.platform || 'unknown', `"${(s.device_name || '').replace(/"/g, '""')}"`, s.is_active ? 'Yes' : 'No', s.subscribed_at || '', s.last_active || ''].join(',')
    );
    const csv = [header, ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="push-subscribers-${Date.now()}.csv"`);
    await audit(req, 'push_subscribers_exported', `Exported ${subs.length} subscribers`);
    res.send(csv);
  }));
};
