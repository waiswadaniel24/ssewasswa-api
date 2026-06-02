/**
 * Anti-Bullying Module
 * Features: Anonymous Report Form, Case Management, Follow-up Tracking,
 *           Resource Library, Incident Map (SVG), Statistics (SVG Charts),
 *           Student Safety Tips, Crisis Protocol
 */

const { migrateQuery } = require('./db');
module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || (fn => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const requireCounsellor = opts.requireCounsellor || ((req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    const r = (req.session.user.role || '').toLowerCase();
    if (r !== 'counsellor' && r !== 'admin' && r !== 'superadmin') return res.status(403).send('Access denied');
    next();
  });
  const audit = opts.audit || (() => {});
  const queueEmail = opts.queueEmail || (() => {});
  const tid = () => req => req.session?.user?.tenant_id || 0;

  // ─── COLORS ────────────────────────────────────────────────────────────
  const C = {
    primary: '#4f46e5',
    primaryLight: '#6366f1',
    green: '#059669',
    greenLight: '#10b981',
    red: '#dc2626',
    redLight: '#ef4444',
    orange: '#f59e0b',
    orangeLight: '#fbbf24',
    blue: '#2563eb',
    purple: '#7c3aed',
    bg: '#f0f4ff',
    card: '#ffffff',
    text: '#1e293b',
    textMuted: '#64748b',
    border: '#e2e8f0'
  };

  const REPORT_TYPES = ['physical', 'verbal', 'cyber', 'social', 'other'];
  const LOCATIONS = ['classroom', 'corridor', 'playground', 'online', 'bus', 'toilet', 'cafeteria', 'sports_field', 'other'];
  const STATUSES = ['new', 'investigating', 'resolved', 'closed'];
  const RESOURCE_CATS = ['articles', 'videos', 'hotlines', 'coping_strategies', 'for_parents', 'for_teachers', 'legal_rights'];
  const URGENCY_LEVELS = ['low', 'medium', 'high', 'urgent'];

  const SAFETY_TIPS = [
    { title: 'Tell Someone You Trust', body: 'If you are being bullied, tell a parent, teacher, school counsellor, or another adult you trust. You do not have to face it alone. Speaking up is the first step to getting help.' },
    { title: 'Stay in Safe Areas', body: 'Whenever possible, stay in areas where adults are present. Bullies are less likely to target you when you are around teachers, staff, or other responsible adults.' },
    { title: 'Don\'t Retaliate', body: 'Responding with aggression can escalate the situation. Walk away if you can and report the incident instead. Your safety is the top priority.' },
    { title: 'Document Everything', body: 'Keep a record of every bullying incident including dates, times, locations, what happened, and who was involved. This evidence is important when reporting.' },
    { title: 'Use the Anonymous Report', body: 'You can submit a completely anonymous report through this system. No one will know it was you. Reports are taken seriously and investigated by trained staff.' },
    { title: 'Block Online Bullies', body: 'If cyberbullying occurs, block the person on all platforms immediately. Do not respond to their messages. Take screenshots before blocking for evidence.' },
    { title: 'Travel in Groups', body: 'There is safety in numbers. Walk to and from school with friends. Bullies rarely target groups of students.' },
    { title: 'Know Your Rights', body: 'Every student has the right to feel safe at school. Bullying is not your fault, and you have the right to a supportive learning environment.' },
    { title: 'Practice Self-Care', body: 'Being bullied is stressful. Make time for activities you enjoy, get enough sleep, eat well, and talk to people who make you feel good about yourself.' },
    { title: 'Remember: It Gets Better', body: 'Bullying can feel overwhelming, but it does get better. Many people who were bullied go on to live happy, successful lives. Reach out for support today.' },
    { title: 'Understand Cyber Safety', body: 'Never share personal information like your address or phone number online. Adjust your privacy settings on all social media accounts to control who can see your posts.' },
    { title: 'Support Others', body: 'If you see someone being bullied, speak up or report it. Being an upstander — not a bystander — helps create a safer school community for everyone.' }
  ];

  // ─── HELPERS ───────────────────────────────────────────────────────────
  function fmtDate(d) {
    return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  }
  function fmtDateTime(d) {
    return d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  }
  function statusBadge(s) {
    const m = {
      new: { bg: '#dbeafe', color: '#1d4ed8', label: 'New' },
      investigating: { bg: '#fef3c7', color: '#b45309', label: 'Investigating' },
      resolved: { bg: '#dcfce7', color: '#15803d', label: 'Resolved' },
      closed: { bg: '#f1f5f9', color: '#64748b', label: 'Closed' }
    };
    const v = m[s] || { bg: '#f1f5f9', color: '#64748b', label: s || 'Unknown' };
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${v.bg};color:${v.color}">${esc(v.label)}</span>`;
  }
  function urgencyBadge(u) {
    const m = {
      low: { bg: '#f1f5f9', color: '#64748b' },
      medium: { bg: '#fef3c7', color: '#b45309' },
      high: { bg: '#ffedd5', color: '#c2410c' },
      urgent: { bg: '#7f1d1d', color: '#ffffff' }
    };
    const v = m[u] || m.low;
    const icon = u === 'urgent' ? '\uD83D\uDD34' : u === 'high' ? '\u26A0\uFE0F' : u === 'medium' ? '\uD83D\uDFE1' : '\u26AA';
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${v.bg};color:${v.color}">${icon} ${esc(u)}</span>`;
  }
  function typeBadge(t) {
    const m = {
      physical: { bg: '#fee2e2', color: '#dc2626', icon: '\uD83E\uDDD1' },
      verbal: { bg: '#fef3c7', color: '#b45309', icon: '\uD83D\uDDE3' },
      cyber: { bg: '#ede9fe', color: '#7c3aed', icon: '\uD83D\uDCF1' },
      social: { bg: '#fce7f3', color: '#be185d', icon: '\uD83E\uDD1D' },
      other: { bg: '#f1f5f9', color: '#64748b', icon: '\uD83D\uDCCD' }
    };
    const v = m[t] || m.other;
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${v.bg};color:${v.color}">${v.icon} ${esc(t)}</span>`;
  }
  function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
  function getDailyTip() {
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
    return SAFETY_TIPS[dayOfYear % SAFETY_TIPS.length];
  }

  // ─── SVG CHART HELPERS ─────────────────────────────────────────────────
  function svgDonutChart(data, opts = {}) {
    const w = opts.width || 280;
    const h = opts.height || 280;
    const cx = w / 2, cy = h / 2;
    const outerR = opts.outerR || 110;
    const innerR = opts.innerR || 65;
    const total = data.reduce((s, d) => s + d.v, 0) || 1;
    const colors = opts.colors || ['#4f46e5', '#059669', '#f59e0b', '#dc2626', '#7c3aed', '#2563eb'];
    let arcs = '';
    let startAngle = -Math.PI / 2;
    data.forEach((d, i) => {
      if (d.v === 0) return;
      const sweep = (d.v / total) * Math.PI * 2;
      const endAngle = startAngle + sweep;
      const largeArc = sweep > Math.PI ? 1 : 0;
      const x1 = cx + outerR * Math.cos(startAngle);
      const y1 = cy + outerR * Math.sin(startAngle);
      const x2 = cx + outerR * Math.cos(endAngle);
      const y2 = cy + outerR * Math.sin(endAngle);
      const ix1 = cx + innerR * Math.cos(endAngle);
      const iy1 = cy + innerR * Math.sin(endAngle);
      const ix2 = cx + innerR * Math.cos(startAngle);
      const iy2 = cy + innerR * Math.sin(startAngle);
      const col = colors[i % colors.length];
      arcs += `<path d="M${x1},${y1} A${outerR},${outerR} 0 ${largeArc},1 ${x2},${y2} L${ix1},${iy1} A${innerR},${innerR} 0 ${largeArc},0 ${ix2},${iy2} Z" fill="${col}" stroke="#fff" stroke-width="2"><title>${esc(d.l)}: ${d.v} (${pct(d.v, total)}%)</title></path>`;
      const midAngle = startAngle + sweep / 2;
      const labelR = outerR + 18;
      const lx = cx + labelR * Math.cos(midAngle);
      const ly = cy + labelR * Math.sin(midAngle);
      if (d.v > 0) {
        arcs += `<text x="${lx}" y="${ly}" fill="${C.text}" text-anchor="middle" font-size="10" font-weight="600">${pct(d.v, total)}%</text>`;
      }
      startAngle = endAngle;
    });
    let legend = data.map((d, i) =>
      `<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px;font-size:12px;color:${C.text};"><span style="width:12px;height:12px;border-radius:3px;background:${colors[i % colors.length]};display:inline-block;"></span>${esc(d.l)} (${d.v})</span>`
    ).join('');
    return `<div style="text-align:center;">
      <svg width="${w}" height="${h}" role="img" aria-label="${esc(opts.title || 'Donut chart')}">
        <rect width="${w}" height="${h}" fill="${C.card}" rx="8"/>
        ${arcs}
        <circle cx="${cx}" cy="${cy}" r="${innerR - 1}" fill="${C.card}"/>
        <text x="${cx}" y="${cy - 6}" fill="${C.text}" text-anchor="middle" font-size="28" font-weight="800">${total}</text>
        <text x="${cx}" y="${cy + 14}" fill="${C.textMuted}" text-anchor="middle" font-size="11">Total</text>
        ${opts.title ? `<text x="${cx}" y="18" fill="${C.text}" text-anchor="middle" font-size="13" font-weight="bold">${esc(opts.title)}</text>` : ''}
      </svg>
      <div style="margin-top:8px;">${legend}</div>
    </div>`;
  }

  function svgBarChart(data, opts = {}) {
    const w = opts.width || 600;
    const h = opts.height || 260;
    const pad = { top: 35, right: 20, bottom: 45, left: 45 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;
    const maxV = opts.maxV || Math.max(...data.map(d => d.v), 1);
    const colorFn = opts.colorFn || (() => C.primary);
    if (!data.length) return `<svg width="${w}" height="${h}" role="img" aria-label="No data"><text x="${w/2}" y="${h/2}" fill="${C.textMuted}" text-anchor="middle">No data</text></svg>`;
    const barW = Math.min(50, (cw / data.length) * 0.65);
    const gap = cw / data.length;
    let gridLines = '';
    for (let i = 0; i <= 4; i++) {
      const v = (maxV / 4) * i;
      const y = pad.top + ch - (v / maxV) * ch;
      gridLines += `<line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" stroke="${C.border}" stroke-width="1" stroke-dasharray="4,4"/>`;
      gridLines += `<text x="${pad.left - 8}" y="${y + 4}" fill="${C.textMuted}" text-anchor="end" font-size="11">${Math.round(v)}</text>`;
    }
    let bars = '', labels = '';
    data.forEach((d, i) => {
      const x = pad.left + i * gap + gap / 2 - barW / 2;
      const barH = (d.v / maxV) * ch;
      const y = pad.top + ch - barH;
      const col = colorFn(d.v, d.l);
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(barH, 0)}" fill="${col}" rx="4"><title>${esc(d.l)}: ${d.v}</title></rect>`;
      if (d.v > 0) bars += `<text x="${x + barW / 2}" y="${y - 6}" fill="${C.text}" text-anchor="middle" font-size="11" font-weight="bold">${d.v}</text>`;
      labels += `<text x="${pad.left + i * gap + gap / 2}" y="${h - 8}" fill="${C.textMuted}" text-anchor="middle" font-size="10" transform="rotate(-25,${pad.left + i * gap + gap / 2},${h - 8})">${esc(d.l)}</text>`;
    });
    return `<svg width="${w}" height="${h}" role="img" aria-label="${esc(opts.title || 'Bar chart')}">
      <rect width="${w}" height="${h}" fill="${C.card}" rx="8"/>
      ${gridLines}${bars}${labels}
      ${opts.title ? `<text x="${w / 2}" y="20" fill="${C.text}" text-anchor="middle" font-size="13" font-weight="bold">${esc(opts.title)}</text>` : ''}
    </svg>`;
  }

  function svgLineChart(data, opts = {}) {
    const w = opts.width || 600;
    const h = opts.height || 240;
    const pad = { top: 30, right: 20, bottom: 40, left: 40 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;
    const maxV = opts.maxV || Math.max(...data.map(d => d.v), 1);
    const minV = opts.minV || 0;
    const color = opts.color || C.primary;
    if (!data.length) return `<svg width="${w}" height="${h}" role="img" aria-label="No data"><text x="${w/2}" y="${h/2}" fill="${C.textMuted}" text-anchor="middle">No data</text></svg>`;
    const points = data.map((d, i) => ({
      x: pad.left + (i / Math.max(data.length - 1, 1)) * cw,
      y: pad.top + ch - ((d.v - minV) / (maxV - minV)) * ch
    }));
    let gridLines = '';
    for (let i = 0; i <= 4; i++) {
      const v = minV + ((maxV - minV) / 4) * i;
      const y = pad.top + ch - ((v - minV) / (maxV - minV)) * ch;
      gridLines += `<line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" stroke="${C.border}" stroke-width="1" stroke-dasharray="4,4"/>`;
      gridLines += `<text x="${pad.left - 8}" y="${y + 4}" fill="${C.textMuted}" text-anchor="end" font-size="11">${Math.round(v)}</text>`;
    }
    const poly = points.map(p => `${p.x},${p.y}`).join(' ');
    const areaPoly = `${pad.left},${pad.top + ch} ${poly} ${points[points.length - 1].x},${pad.top + ch}`;
    let dots = points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${color}" stroke="#fff" stroke-width="2"><title>${p.v}</title></circle>`).join('');
    let labels = data.map((d, i) => `<text x="${points[i].x}" y="${h - 8}" fill="${C.textMuted}" text-anchor="middle" font-size="10" transform="rotate(-30,${points[i].x},${h - 8})">${esc(d.l)}</text>`).join('');
    return `<svg width="${w}" height="${h}" role="img" aria-label="${esc(opts.title || 'Line chart')}">
      <rect width="${w}" height="${h}" fill="${C.card}" rx="8"/>
      ${gridLines}
      <polygon points="${areaPoly}" fill="${color}" opacity="0.1"/>
      <polyline points="${poly}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}${labels}
      ${opts.title ? `<text x="${w / 2}" y="18" fill="${C.text}" text-anchor="middle" font-size="13" font-weight="bold">${esc(opts.title)}</text>` : ''}
    </svg>`;
  }

  function svgGaugeChart(value, opts = {}) {
    const w = opts.width || 220;
    const h = opts.height || 150;
    const cx = w / 2, cy = h - 30;
    const radius = 80;
    const startAngle = Math.PI;
    const endAngle = 0;
    const pctVal = Math.max(0, Math.min(100, value));
    const valAngle = startAngle - (pctVal / 100) * Math.PI;
    const color = pctVal >= 80 ? C.green : pctVal >= 60 ? C.primary : pctVal >= 40 ? C.orange : C.red;
    const bgArc = `M${cx - radius},${cy} A${radius},${radius} 0 0,1 ${cx + radius},${cy}`;
    const valArc = pctVal > 0
      ? `M${cx - radius},${cy} A${radius},${radius} 0 ${pctVal > 50 ? 1 : 0},1 ${cx + radius * Math.cos(valAngle)},${cy + radius * Math.sin(valAngle)}`
      : '';
    const needleX = cx + (radius - 15) * Math.cos(valAngle);
    const needleY = cy + (radius - 15) * Math.sin(valAngle);
    return `<svg width="${w}" height="${h}" role="img" aria-label="Gauge: ${pctVal}%">
      <rect width="${w}" height="${h}" fill="${C.card}" rx="8"/>
      <path d="${bgArc}" fill="none" stroke="${C.border}" stroke-width="16" stroke-linecap="round"/>
      <path d="${valArc}" fill="none" stroke="${color}" stroke-width="16" stroke-linecap="round"/>
      <line x1="${cx}" y1="${cy}" x2="${needleX}" y2="${needleY}" stroke="${C.text}" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="6" fill="${C.text}"/>
      <text x="${cx}" y="${cy - 25}" fill="${color}" text-anchor="middle" font-size="26" font-weight="800">${pctVal}%</text>
      ${opts.title ? `<text x="${cx}" y="${h - 8}" fill="${C.textMuted}" text-anchor="middle" font-size="11">${esc(opts.title)}</text>` : ''}
    </svg>`;
  }

  function svgHeatmap(locationData) {
    const w = 680, h = 380;
    const maxV = Math.max(...locationData.map(d => d.v), 1);
    const positions = {
      classroom: { x: 340, y: 110, label: 'Classroom', w: 100, h: 60 },
      corridor: { x: 200, y: 180, label: 'Corridor', w: 120, h: 40 },
      playground: { x: 480, y: 220, label: 'Playground', w: 120, h: 70 },
      online: { x: 80, y: 80, label: 'Online', w: 80, h: 50 },
      bus: { x: 560, y: 80, label: 'Bus', w: 70, h: 45 },
      toilet: { x: 140, y: 280, label: 'Toilet', w: 70, h: 50 },
      cafeteria: { x: 340, y: 280, label: 'Cafeteria', w: 100, h: 55 },
      sports_field: { x: 490, y: 310, label: 'Sports Field', w: 120, h: 50 }
    };
    let zones = '';
    const dataMap = {};
    locationData.forEach(d => { dataMap[d.l] = d.v; });
    Object.keys(positions).forEach(loc => {
      const p = positions[loc];
      const val = dataMap[loc] || 0;
      const intensity = val / maxV;
      const r = Math.round(220 + intensity * 35);
      const g = Math.round(38 - intensity * 20);
      const b = Math.round(38 - intensity * 20);
      const fillColor = val > 0 ? `rgba(${r},${g},${b},${Math.max(0.25, intensity)})` : 'rgba(100,116,139,0.15)';
      const strokeColor = val > 0 ? C.red : C.border;
      zones += `<rect x="${p.x - p.w/2}" y="${p.y - p.h/2}" width="${p.w}" height="${p.h}" rx="8" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${val > 0 ? 2 : 1}">
        <title>${esc(p.label)}: ${val} report${val !== 1 ? 's' : ''}</title>
      </rect>`;
      zones += `<text x="${p.x}" y="${p.y - 6}" fill="${val > 0 ? '#fff' : C.textMuted}" text-anchor="middle" font-size="12" font-weight="700">${p.label}</text>`;
      zones += `<text x="${p.x}" y="${p.y + 12}" fill="${val > 0 ? '#fca5a5' : C.textMuted}" text-anchor="middle" font-size="14" font-weight="800">${val}</text>`;
    });
    return `<svg width="${w}" height="${h}" role="img" aria-label="Bullying incident heatmap by location">
      <rect width="${w}" height="${h}" fill="${C.card}" rx="8"/>
      <text x="${w/2}" y="24" fill="${C.text}" text-anchor="middle" font-size="14" font-weight="bold">Incident Heatmap</text>
      <text x="${w/2}" y="40" fill="${C.textMuted}" text-anchor="middle" font-size="11">Darker zones indicate more reported incidents</text>
      <rect x="30" y="${h - 50}" width="200" height="14" rx="7" fill="url(#heatGrad)"/>
      <defs><linearGradient id="heatGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="rgba(100,116,139,0.3)"/>
        <stop offset="100%" stop-color="${C.red}"/>
      </linearGradient></defs>
      <text x="30" y="${h - 30}" fill="${C.textMuted}" font-size="10">Low</text>
      <text x="220" y="${h - 30}" fill="${C.textMuted}" font-size="10">High</text>
      ${zones}
    </svg>`;
  }

  // ─── SHARED LAYOUT ─────────────────────────────────────────────────────
  function pageShell(title, content, activeNav) {
    const navItems = [
      { href: '/anti-bullying', label: '\uD83D\uDCCA Dashboard', active: activeNav === 'dash' },
      { href: '/anti-bullying/report', label: '\uD83D\uDD12 Report', active: activeNav === 'report' },
      { href: '/anti-bullying/cases', label: '\uD83D\uDCDC Cases', active: activeNav === 'cases' },
      { href: '/anti-bullying/resources', label: '\uD83D\uDCDA Resources', active: activeNav === 'resources' },
      { href: '/anti-bullying/map', label: '\uD83D\uDDFA\uFE0F Map', active: activeNav === 'map' },
      { href: '/anti-bullying/statistics', label: '\uD83D\uDCCA Stats', active: activeNav === 'stats' },
      { href: '/anti-bullying/safety-tips', label: '\uD83D\uDEE1\uFE0F Tips', active: activeNav === 'tips' }
    ];
    let navHtml = navItems.map(n =>
      `<a href="${n.href}" style="display:inline-block;padding:8px 14px;margin:3px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;${n.active ? 'background:' + C.primary + ';color:#fff;' : 'color:' + C.text + ';background:#f1f5f9;'}" aria-current="${n.active ? 'page' : 'false'}">${n.label}</a>`
    ).join('');
    return `<div style="max-width:1100px;margin:0 auto;padding:20px;font-family:system-ui,-apple-system,sans-serif;color:${C.text};">
      <h1 style="color:${C.primary};margin-bottom:4px;font-size:26px;">${esc(title)}</h1>
      <p style="color:${C.textMuted};margin-bottom:16px;font-size:14px;">Safe schools start with speaking up. Every report matters.</p>
      <nav style="margin-bottom:24px;padding:12px;background:${C.card};border-radius:12px;border:1px solid ${C.border};display:flex;flex-wrap:wrap;" aria-label="Anti-Bullying Navigation">${navHtml}</nav>
      <div style="background:${C.card};border-radius:12px;border:1px solid ${C.border};padding:24px;">${content}</div>
    </div>`;
  }

  // ─── CRISIS PROTOCOL ───────────────────────────────────────────────────
  async function triggerCrisisProtocol(reportId, tenantId, description) {
    audit({ action: 'bullying_crisis_triggered', tenantId, detail: `Report #${reportId} flagged urgent` });
    const { rows: leads } = await pool.query(
      `SELECT email, display_name FROM users WHERE tenant_id = $1 AND (role = 'counsellor' OR role = 'admin' OR role = 'superadmin') AND email IS NOT NULL AND email != '' LIMIT 5`,
      [tenantId]
    );
    leads.forEach(u => {
      queueEmail({
        to: u.email,
        subject: '\uD83D\uDEA8 URGENT — Bullying Report Requires Immediate Action',
        body: `Dear ${u.display_name || 'Safeguarding Lead'},\n\nAn URGENT bullying report has been submitted (Report #${reportId}).\n\nDescription: ${description || 'See full details in the case management portal.'}\n\nPlease investigate immediately and follow your school's safeguarding protocol.\n\n— Anti-Bullying System\nThis is an automated alert.`
      });
    });
  }

  // ─── TABLE CREATION ────────────────────────────────────────────────────
  (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bullying_reports (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        report_type VARCHAR(50) NOT NULL,
        description TEXT NOT NULL,
        incident_date DATE,
        location VARCHAR(100),
        persons_involved TEXT,
        evidence_description TEXT,
        urgency VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'new',
        assigned_to INTEGER,
        assigned_by INTEGER,
        is_anonymous BOOLEAN DEFAULT true,
        reporter_ip VARCHAR(45),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_br_tenant ON bullying_reports(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_br_status ON bullying_reports(tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_br_type ON bullying_reports(tenant_id, report_type);
      CREATE INDEX IF NOT EXISTS idx_br_location ON bullying_reports(tenant_id, location);
      CREATE INDEX IF NOT EXISTS idx_br_urgency ON bullying_reports(urgency);
      CREATE INDEX IF NOT EXISTS idx_br_created ON bullying_reports(tenant_id, created_at);
    `);
    await migrateQuery(pool, 'AntiBullying', `
      CREATE TABLE IF NOT EXISTS bullying_case_notes (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        report_id INTEGER NOT NULL REFERENCES bullying_reports(id) ON DELETE CASCADE,
        note_type VARCHAR(30) NOT NULL DEFAULT 'note',
        content TEXT NOT NULL,
        follow_up_action TEXT,
        meeting_date DATE,
        welfare_check BOOLEAN DEFAULT false,
        welfare_status VARCHAR(30),
        outcome TEXT,
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_bcn_tenant_report ON bullying_case_notes(tenant_id, report_id);
      CREATE INDEX IF NOT EXISTS idx_bcn_type ON bullying_case_notes(tenant_id, note_type);
    `);
    await migrateQuery(pool, 'AntiBullying', `
      CREATE TABLE IF NOT EXISTS bullying_resources (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        title VARCHAR(300) NOT NULL,
        description TEXT,
        category VARCHAR(100) NOT NULL,
        content_type VARCHAR(50) DEFAULT 'article',
        url VARCHAR(500),
        body TEXT,
        is_active BOOLEAN DEFAULT true,
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_bres_tenant_cat ON bullying_resources(tenant_id, category);
      CREATE INDEX IF NOT EXISTS idx_bres_active ON bullying_resources(tenant_id, is_active);
    `);
  })();

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 1: GET /anti-bullying — Dashboard (Admin/Counsellor)
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/anti-bullying', requireCounsellor, ah(async (req, res) => {
    const t = tid(req)();
    const { rows: totalReports } = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM bullying_reports WHERE tenant_id = $1`, [t]
    );
    const { rows: newReports } = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM bullying_reports WHERE tenant_id = $1 AND status = 'new'`, [t]
    );
    const { rows: investigatingReports } = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM bullying_reports WHERE tenant_id = $1 AND status = 'investigating'`, [t]
    );
    const { rows: urgentReports } = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM bullying_reports WHERE tenant_id = $1 AND urgency = 'urgent' AND status IN ('new','investigating')`, [t]
    );
    const { rows: resolvedReports } = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM bullying_reports WHERE tenant_id = $1 AND status = 'resolved'`, [t]
    );
    const { rows: closedReports } = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM bullying_reports WHERE tenant_id = $1 AND status = 'closed'`, [t]
    );
    const total = totalReports[0].cnt;
    const resolutionRate = total > 0 ? pct(resolvedReports[0].cnt + closedReports[0].cnt, total) : 0;
    const { rows: recentReports } = await pool.query(
      `SELECT br.*, u.display_name as assigned_name
       FROM bullying_reports br
       LEFT JOIN users u ON u.id = br.assigned_to
       WHERE br.tenant_id = $1
       ORDER BY br.created_at DESC LIMIT 10`, [t]
    );
    const recentHtml = recentReports.map(r => `<tr>
      <td><a href="/anti-bullying/cases/${r.id}" style="color:${C.primary};text-decoration:none;font-weight:600;">#${r.id}</a></td>
      <td>${typeBadge(r.report_type)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${urgencyBadge(r.urgency)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc((r.description || '').slice(0, 80))}</td>
      <td style="font-size:12px;color:${C.textMuted};">${fmtDateTime(r.created_at)}</td>
    </tr>`).join('');
    const tip = getDailyTip();
    let urgentBanner = '';
    if (urgentReports[0].cnt > 0) {
      urgentBanner = `<div style="background:#7f1d1d;color:#fff;padding:14px 18px;border-radius:10px;margin-bottom:20px;display:flex;align-items:center;gap:10px;">
        <span style="font-size:24px;">\uD83D\uDEA8</span>
        <div><strong>${urgentReports[0].cnt} urgent report${urgentReports[0].cnt > 1 ? 's' : ''} require${urgentReports[0].cnt === 1 ? 's' : ''} immediate attention.</strong>
        <a href="/anti-bullying/cases?status=new&urgency=urgent" style="color:#fca5a5;text-decoration:underline;margin-left:8px;">View urgent cases \u2192</a></div>
      </div>`;
    }
    let html = `
      ${urgentBanner}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px;">
        <div style="background:linear-gradient(135deg,${C.primary},${C.primaryLight});padding:20px;border-radius:12px;color:#fff;">
          <div style="font-size:13px;opacity:0.9;">Total Reports</div>
          <div style="font-size:36px;font-weight:800;margin:4px 0;">${total}</div>
          <div style="font-size:12px;opacity:0.8;">All time</div>
        </div>
        <div style="background:linear-gradient(135deg,#1d4ed8,#3b82f6);padding:20px;border-radius:12px;color:#fff;">
          <div style="font-size:13px;opacity:0.9;">New</div>
          <div style="font-size:36px;font-weight:800;margin:4px 0;">${newReports[0].cnt}</div>
          <div style="font-size:12px;opacity:0.8;">Awaiting review</div>
        </div>
        <div style="background:linear-gradient(135deg,${C.orange},#fb923c);padding:20px;border-radius:12px;color:#fff;">
          <div style="font-size:13px;opacity:0.9;">Investigating</div>
          <div style="font-size:36px;font-weight:800;margin:4px 0;">${investigatingReports[0].cnt}</div>
          <div style="font-size:12px;opacity:0.8;">In progress</div>
        </div>
        <div style="background:linear-gradient(135deg,${C.red},C.redLight);padding:20px;border-radius:12px;color:#fff;">
          <div style="font-size:13px;opacity:0.9;">Urgent</div>
          <div style="font-size:36px;font-weight:800;margin:4px 0;">${urgentReports[0].cnt}</div>
          <div style="font-size:12px;opacity:0.8;">Immediate action needed</div>
        </div>
        <div style="background:linear-gradient(135deg,${C.green},${C.greenLight});padding:20px;border-radius:12px;color:#fff;">
          <div style="font-size:13px;opacity:0.9;">Resolved/Closed</div>
          <div style="font-size:36px;font-weight:800;margin:4px 0;">${resolvedReports[0].cnt + closedReports[0].cnt}</div>
          <div style="font-size:12px;opacity:0.8;">Resolution rate: ${resolutionRate}%</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
        <div>
          <h3 style="font-size:16px;margin-bottom:12px;">Recent Reports</h3>
          <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr>
              <th style="text-align:left;padding:8px;border-bottom:2px solid ${C.border};color:${C.textMuted};font-size:11px;">ID</th>
              <th style="text-align:left;padding:8px;border-bottom:2px solid ${C.border};color:${C.textMuted};font-size:11px;">Type</th>
              <th style="text-align:left;padding:8px;border-bottom:2px solid ${C.border};color:${C.textMuted};font-size:11px;">Status</th>
              <th style="text-align:left;padding:8px;border-bottom:2px solid ${C.border};color:${C.textMuted};font-size:11px;">Urgency</th>
              <th style="text-align:left;padding:8px;border-bottom:2px solid ${C.border};color:${C.textMuted};font-size:11px;">Description</th>
              <th style="text-align:left;padding:8px;border-bottom:2px solid ${C.border};color:${C.textMuted};font-size:11px;">Date</th>
            </tr></thead>
            <tbody>${recentHtml || '<tr><td colspan="6" style="padding:20px;text-align:center;color:${C.textMuted};">No reports yet</td></tr>'}</tbody>
          </table></div>
        </div>
        <div>
          <h3 style="font-size:16px;margin-bottom:12px;">\uD83D\uDCA1 Daily Safety Tip</h3>
          <div style="background:linear-gradient(135deg,${C.primary},#818cf8);color:#fff;padding:24px;border-radius:12px;">
            <h4 style="margin:0 0 8px;font-size:18px;">${esc(tip.title)}</h4>
            <p style="margin:0;font-size:14px;line-height:1.6;opacity:0.95;">${esc(tip.body)}</p>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <a href="/anti-bullying/report" style="padding:12px 24px;background:${C.primary};color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">\uD83D\uDD12 Submit Report</a>
        <a href="/anti-bullying/cases" style="padding:12px 24px;background:${C.green};color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">\uD83D\uDCDC Manage Cases</a>
        <a href="/anti-bullying/statistics" style="padding:12px 24px;background:${C.purple};color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">\uD83D\uDCCA View Statistics</a>
      </div>`;
    res.send(renderPage('Anti-Bullying Dashboard', pageShell('Anti-Bullying Dashboard', html, 'dash'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 2: GET /anti-bullying/report — Anonymous Report Form
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/anti-bullying/report', ah(async (req, res) => {
    const typeOptions = REPORT_TYPES.map(t =>
      `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</option>`
    ).join('');
    const locationOptions = LOCATIONS.map(l =>
      `<option value="${l}">${l.charAt(0).toUpperCase() + l.slice(1)}</option>`
    ).join('');
    let html = `
      <div style="max-width:640px;margin:0 auto;">
        <div style="text-align:center;padding:20px 0 24px;">
          <div style="font-size:48px;margin-bottom:8px;">\uD83D\uDEE1\uFE0F</div>
          <h2 style="font-size:22px;color:${C.text};margin:0 0 6px;">Anonymous Bullying Report</h2>
          <p style="color:${C.textMuted};font-size:14px;margin:0;">Your identity will NOT be recorded. All reports are completely anonymous.</p>
        </div>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;margin-bottom:20px;display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:20px;">\uD83D\uDD12</span>
          <div style="font-size:13px;color:#15803d;line-height:1.5;">
            <strong>Confidentiality guaranteed:</strong> This form does not ask for your name, student ID, or any identifying information. Reports are reviewed by trained school staff.
          </div>
        </div>
        <form method="POST" action="/anti-bullying/report" aria-label="Anonymous bullying report form">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div>
              <label for="br-type" style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Type of Bullying <span style="color:${C.red};">*</span></label>
              <select id="br-type" name="report_type" required style="width:100%;padding:12px;border:1px solid ${C.border};border-radius:8px;font-size:14px;box-sizing:border-box;background:#fff;">
                <option value="">Select type...</option>
                ${typeOptions}
              </select>
            </div>
            <div>
              <label for="br-urgency" style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Urgency Level <span style="color:${C.red};">*</span></label>
              <select id="br-urgency" name="urgency" required style="width:100%;padding:12px;border:1px solid ${C.border};border-radius:8px;font-size:14px;box-sizing:border-box;background:#fff;">
                <option value="low">Low — minor concern</option>
                <option value="medium" selected>Medium — ongoing issue</option>
                <option value="high">High — serious concern</option>
                <option value="urgent" style="color:${C.red};font-weight:bold;">\uD83D\uDD34 Urgent — immediate danger</option>
              </select>
            </div>
          </div>
          <div style="margin-bottom:16px;">
            <label for="br-desc" style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Description <span style="color:${C.red};">*</span></label>
            <textarea id="br-desc" name="description" required rows="5" maxlength="3000" placeholder="Please describe what happened in as much detail as you can. Include specific actions, words used, and how it made you feel..." style="width:100%;padding:12px;border:1px solid ${C.border};border-radius:8px;font-size:14px;resize:vertical;box-sizing:border-box;line-height:1.5;" aria-describedby="br-desc-hint"></textarea>
            <p id="br-desc-hint" style="font-size:12px;color:${C.textMuted};margin-top:4px;">Be as detailed as possible. The more information you provide, the better we can help.</p>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div>
              <label for="br-when" style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">When did it happen?</label>
              <input type="date" id="br-when" name="incident_date" style="width:100%;padding:12px;border:1px solid ${C.border};border-radius:8px;font-size:14px;box-sizing:border-box;" />
            </div>
            <div>
              <label for="br-where" style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Where did it happen?</label>
              <select id="br-where" name="location" style="width:100%;padding:12px;border:1px solid ${C.border};border-radius:8px;font-size:14px;box-sizing:border-box;background:#fff;">
                <option value="">Select location...</option>
                ${locationOptions}
              </select>
            </div>
          </div>
          <div style="margin-bottom:16px;">
            <label for="br-who" style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Who was involved? <span style="font-weight:400;color:${C.textMuted};">(optional)</span></label>
            <input type="text" id="br-who" name="persons_involved" maxlength="500" placeholder="Names or descriptions of people involved (do NOT include your name)" style="width:100%;padding:12px;border:1px solid ${C.border};border-radius:8px;font-size:14px;box-sizing:border-box;" />
          </div>
          <div style="margin-bottom:20px;">
            <label for="br-evidence" style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Evidence Description <span style="font-weight:400;color:${C.textMuted};">(optional)</span></label>
            <textarea id="br-evidence" name="evidence_description" rows="3" maxlength="1500" placeholder="Describe any evidence: screenshots, witnesses, physical marks, damaged items, etc." style="width:100%;padding:12px;border:1px solid ${C.border};border-radius:8px;font-size:14px;resize:vertical;box-sizing:border-box;"></textarea>
          </div>
          <div style="text-align:center;">
            <button type="submit" style="padding:14px 40px;background:${C.primary};color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;transition:background 0.2s;" onmouseover="this.style.background='#4338ca'" onmouseout="this.style.background='${C.primary}'">\uD83D\uDCE7 Submit Report</button>
            <p style="margin-top:12px;font-size:12px;color:${C.textMuted};">Your report will be reviewed by trained staff. If this is an emergency, please contact emergency services immediately.</p>
          </div>
        </form>
      </div>`;
    res.send(renderPage('Anonymous Report', pageShell('Anonymous Bullying Report', html, 'report'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 3: POST /anti-bullying/report — Submit Anonymous Report
  // ══════════════════════════════════════════════════════════════════════════
  app.post('/anti-bullying/report', ah(async (req, res) => {
    const t = req.session?.user?.tenant_id || 0;
    const reportType = (req.body.report_type || '').trim().toLowerCase();
    const urgency = (req.body.urgency || 'medium').toLowerCase();
    const description = (req.body.description || '').trim();
    if (!reportType || !REPORT_TYPES.includes(reportType) || !description) {
      return res.send(renderPage('Error', pageShell('Error', `<div style="text-align:center;padding:40px;"><p style="color:${C.red};font-size:16px;">Please fill in all required fields.</p><a href="/anti-bullying/report" style="color:${C.primary};margin-top:12px;display:inline-block;">Try again</a></div>`, 'report'), req));
    }
    const result = await pool.query(
      `INSERT INTO bullying_reports (tenant_id, report_type, description, incident_date, location, persons_involved, evidence_description, urgency, status, is_anonymous, reporter_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'new', true, $9) RETURNING id`,
      [t, reportType, description.slice(0, 3000), req.body.incident_date || null, req.body.location || null, req.body.persons_involved ? (req.body.persons_involved || '').trim().slice(0, 500) : null, req.body.evidence_description ? (req.body.evidence_description || '').trim().slice(0, 1500) : null, urgency, req.ip || null]
    );
    const reportId = result.rows[0].id;
    audit({ action: 'bullying_report_submitted', tenantId: t, detail: `Report #${reportId} type=${reportType} urgency=${urgency}` });
    if (urgency === 'urgent') {
      await triggerCrisisProtocol(reportId, t, description.slice(0, 200));
    }
    let html = `
      <div style="text-align:center;padding:40px 20px;">
        <div style="font-size:64px;margin-bottom:16px;">\u2705</div>
        <h2 style="font-size:24px;color:${C.green};margin:0 0 10px;">Report Submitted Successfully</h2>
        <p style="color:${C.textMuted};font-size:15px;max-width:500px;margin:0 auto 20px;line-height:1.6;">Thank you for speaking up. Your report (Reference #${reportId}) has been received and will be reviewed by trained school staff. This was completely anonymous.</p>
        ${urgency === 'urgent' ? `<div style="background:#fee2e2;border:1px solid #fecaca;border-radius:10px;padding:14px;margin-bottom:20px;max-width:500px;margin-left:auto;margin-right:auto;">
          <p style="color:${C.red};font-weight:600;margin:0;">\uD83D\uDEA8 Because this was marked as urgent, the safeguarding team has been notified immediately.</p>
        </div>` : ''}
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
          <a href="/anti-bullying/report" style="padding:12px 24px;background:${C.primary};color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Submit Another Report</a>
          <a href="/anti-bullying/safety-tips" style="padding:12px 24px;background:${C.green};color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">View Safety Tips</a>
        </div>
      </div>`;
    res.send(renderPage('Report Submitted', pageShell('Report Submitted', html, 'report'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 4: GET /anti-bullying/cases — Case Management
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/anti-bullying/cases', requireCounsellor, ah(async (req, res) => {
    const t = tid(req)();
    const filterStatus = (req.query.status || '').trim();
    const filterUrgency = (req.query.urgency || '').trim();
    const filterType = (req.query.type || '').trim();
    let where = 'WHERE br.tenant_id = $1';
    const params = [t];
    let pIdx = 2;
    if (filterStatus && STATUSES.includes(filterStatus)) { where += ` AND br.status = $${pIdx++}`; params.push(filterStatus); }
    if (filterUrgency && URGENCY_LEVELS.includes(filterUrgency)) { where += ` AND br.urgency = $${pIdx++}`; params.push(filterUrgency); }
    if (filterType && REPORT_TYPES.includes(filterType)) { where += ` AND br.report_type = $${pIdx++}`; params.push(filterType); }
    const { rows: reports } = await pool.query(
      `SELECT br.*, u.display_name as assigned_name
       FROM bullying_reports br
       LEFT JOIN users u ON u.id = br.assigned_to
       ${where} ORDER BY br.created_at DESC LIMIT 100`, params
    );
    const { rows: staff } = await pool.query(
      `SELECT id, display_name, email FROM users WHERE tenant_id = $1 AND (role = 'counsellor' OR role = 'admin' OR role = 'superadmin' OR role = 'teacher') ORDER BY display_name LIMIT 50`, [t]
    );
    const statusFilterHtml = STATUSES.map(s =>
      `<option value="${s}" ${filterStatus === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
    ).join('');
    const urgencyFilterHtml = URGENCY_LEVELS.map(u =>
      `<option value="${u}" ${filterUrgency === u ? 'selected' : ''}>${u.charAt(0).toUpperCase() + u.slice(1)}</option>`
    ).join('');
    const typeFilterHtml = REPORT_TYPES.map(ty =>
      `<option value="${ty}" ${filterType === ty ? 'selected' : ''}>${ty.charAt(0).toUpperCase() + ty.slice(1)}</option>`
    ).join('');
    const staffOptions = staff.map(s =>
      `<option value="${s.id}">${esc(s.display_name || s.email)}</option>`
    ).join('');
    const rowsHtml = reports.map(r => `<tr>
      <td><a href="/anti-bullying/cases/${r.id}" style="color:${C.primary};text-decoration:none;font-weight:600;">#${r.id}</a></td>
      <td>${typeBadge(r.report_type)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${urgencyBadge(r.urgency)}</td>
      <td>${esc(r.location || '—')}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc((r.description || '').slice(0, 60))}</td>
      <td style="font-size:12px;">${esc(r.assigned_name || 'Unassigned')}</td>
      <td style="font-size:12px;color:${C.textMuted};">${fmtDateTime(r.created_at)}</td>
    </tr>`).join('');
    let html = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <h2 style="font-size:20px;margin:0;">Case Management</h2>
        <a href="/anti-bullying/report" style="padding:10px 20px;background:${C.primary};color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">+ New Report</a>
      </div>
      <form method="GET" action="/anti-bullying/cases" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;align-items:end;">
        <div>
          <label style="display:block;font-size:11px;font-weight:600;color:${C.textMuted};margin-bottom:3px;">Status</label>
          <select name="status" style="padding:8px 12px;border:1px solid ${C.border};border-radius:6px;font-size:13px;"><option value="">All</option>${statusFilterHtml}</select>
        </div>
        <div>
          <label style="display:block;font-size:11px;font-weight:600;color:${C.textMuted};margin-bottom:3px;">Urgency</label>
          <select name="urgency" style="padding:8px 12px;border:1px solid ${C.border};border-radius:6px;font-size:13px;"><option value="">All</option>${urgencyFilterHtml}</select>
        </div>
        <div>
          <label style="display:block;font-size:11px;font-weight:600;color:${C.textMuted};margin-bottom:3px;">Type</label>
          <select name="type" style="padding:8px 12px;border:1px solid ${C.border};border-radius:6px;font-size:13px;"><option value="">All</option>${typeFilterHtml}</select>
        </div>
        <button type="submit" style="padding:8px 16px;background:${C.primary};color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;">Filter</button>
      </form>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr>
            <th style="text-align:left;padding:10px;border-bottom:2px solid ${C.border};color:${C.textMuted};font-size:11px;">ID</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid ${C.border};color:${C.textMuted};font-size:11px;">Type</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid ${C.border};color:${C.textMuted};font-size:11px;">Status</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid ${C.border};color:${C.textMuted};font-size:11px;">Urgency</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid ${C.border};color:${C.textMuted};font-size:11px;">Location</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid ${C.border};color:${C.textMuted};font-size:11px;">Description</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid ${C.border};color:${C.textMuted};font-size:11px;">Assigned</th>
            <th style="text-align:left;padding:10px;border-bottom:2px solid ${C.border};color:${C.textMuted};font-size:11px;">Created</th>
          </tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="8" style="padding:30px;text-align:center;color:${C.textMuted};">No reports match your filters</td></tr>'}</tbody>
        </table>
      </div>`;
    res.send(renderPage('Case Management', pageShell('Case Management', html, 'cases'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 5: GET /anti-bullying/cases/:id — Case Detail & Follow-up
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/anti-bullying/cases/:id', requireCounsellor, ah(async (req, res) => {
    const t = tid(req)();
    const reportId = parseInt(req.params.id);
    if (!reportId) return res.redirect('/anti-bullying/cases');
    const { rows: report } = await pool.query(
      `SELECT br.*, u.display_name as assigned_name, u2.display_name as assigned_by_name
       FROM bullying_reports br
       LEFT JOIN users u ON u.id = br.assigned_to
       LEFT JOIN users u2 ON u2.id = br.assigned_by
       WHERE br.id = $1 AND br.tenant_id = $2`, [reportId, t]
    );
    if (!report.length) return res.status(404).send('Report not found');
    const r = report[0];
    const { rows: notes } = await pool.query(
      `SELECT cn.*, u.display_name as author_name
       FROM bullying_case_notes cn
       LEFT JOIN users u ON u.id = cn.created_by
       WHERE cn.report_id = $1 AND cn.tenant_id = $2
       ORDER BY cn.created_at DESC`, [reportId, t]
    );
    const { rows: staff } = await pool.query(
      `SELECT id, display_name FROM users WHERE tenant_id = $1 AND (role = 'counsellor' OR role = 'admin' OR role = 'superadmin' OR role = 'teacher') ORDER BY display_name`, [t]
    );
    const staffOptions = staff.map(s =>
      `<option value="${s.id}" ${r.assigned_to === s.id ? 'selected' : ''}>${esc(s.display_name)}</option>`
    ).join('');
    const statusOptions = STATUSES.map(s =>
      `<option value="${s}" ${r.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
    ).join('');
    const notesHtml = notes.map(n => {
      const isFollowUp = n.note_type === 'follow_up';
      const isWelfare = n.note_type === 'welfare_check';
      return `<div style="padding:14px;border-radius:10px;border:1px solid ${C.border};margin-bottom:10px;background:${isFollowUp ? '#fffbeb' : isWelfare ? '#f0fdf4' : '#f8fafc'};">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:12px;font-weight:600;color:${C.primary};background:${C.primary}15;padding:2px 8px;border-radius:10px;">${esc(n.note_type.replace('_', ' '))}</span>
            ${isWelfare ? `<span style="font-size:11px;color:${n.welfare_status === 'safe' ? C.green : n.welfare_status === 'at_risk' ? C.red : C.orange};font-weight:600;">Welfare: ${esc(n.welfare_status || 'pending')}</span>` : ''}
          </div>
          <span style="font-size:11px;color:${C.textMuted};">${fmtDateTime(n.created_at)}</span>
        </div>
        ${n.author_name ? `<div style="font-size:12px;color:${C.textMuted};margin-bottom:4px;">By: ${esc(n.author_name)}</div>` : ''}
        <p style="margin:0 0 6px;font-size:14px;line-height:1.5;">${esc(n.content)}</p>
        ${n.follow_up_action ? `<div style="font-size:13px;color:${C.primary};"><strong>Follow-up action:</strong> ${esc(n.follow_up_action)}</div>` : ''}
        ${n.meeting_date ? `<div style="font-size:13px;color:${C.textMuted};"><strong>Meeting date:</strong> ${fmtDate(n.meeting_date)}</div>` : ''}
        ${n.outcome ? `<div style="font-size:13px;color:${C.green};"><strong>Outcome:</strong> ${esc(n.outcome)}</div>` : ''}
      </div>`;
    }).join('');
    let html = `
      <a href="/anti-bullying/cases" style="color:${C.primary};text-decoration:none;font-size:14px;display:inline-block;margin-bottom:16px;">\u2190 Back to Cases</a>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-bottom:24px;">
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
            <h2 style="font-size:20px;margin:0;">Report #${r.id}</h2>
            ${statusBadge(r.status)}
            ${urgencyBadge(r.urgency)}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
            <div><span style="font-size:12px;color:${C.textMuted};">Type:</span> ${typeBadge(r.report_type)}</div>
            <div><span style="font-size:12px;color:${C.textMuted};">Location:</span> <strong>${esc(r.location || 'Not specified')}</strong></div>
            <div><span style="font-size:12px;color:${C.textMuted};">Incident Date:</span> <strong>${fmtDate(r.incident_date)}</strong></div>
            <div><span style="font-size:12px;color:${C.textMuted};">Submitted:</span> <strong>${fmtDateTime(r.created_at)}</strong></div>
            <div><span style="font-size:12px;color:${C.textMuted};">Assigned To:</span> <strong>${esc(r.assigned_name || 'Unassigned')}</strong></div>
            <div><span style="font-size:12px;color:${C.textMuted};">Anonymous:</span> <strong>${r.is_anonymous ? 'Yes' : 'No'}</strong></div>
          </div>
          <div style="margin-bottom:16px;">
            <span style="font-size:12px;color:${C.textMuted};display:block;margin-bottom:4px;">Description:</span>
            <div style="background:#f8fafc;padding:14px;border-radius:8px;font-size:14px;line-height:1.6;border:1px solid ${C.border};">${esc(r.description)}</div>
          </div>
          ${r.persons_involved ? `<div style="margin-bottom:16px;"><span style="font-size:12px;color:${C.textMuted};display:block;margin-bottom:4px;">Persons Involved:</span><div style="background:#f8fafc;padding:14px;border-radius:8px;font-size:14px;border:1px solid ${C.border};">${esc(r.persons_involved)}</div></div>` : ''}
          ${r.evidence_description ? `<div style="margin-bottom:16px;"><span style="font-size:12px;color:${C.textMuted};display:block;margin-bottom:4px;">Evidence:</span><div style="background:#f8fafc;padding:14px;border-radius:8px;font-size:14px;border:1px solid ${C.border};">${esc(r.evidence_description)}</div></div>` : ''}
        </div>
        <div>
          <div style="background:#f8fafc;padding:16px;border-radius:10px;border:1px solid ${C.border};">
            <h3 style="font-size:15px;margin:0 0 12px;">Case Actions</h3>
            <form method="POST" action="/anti-bullying/cases/${r.id}/update">
              <div style="margin-bottom:10px;">
                <label for="case-status" style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Status</label>
                <select id="case-status" name="status" style="width:100%;padding:8px;border:1px solid ${C.border};border-radius:6px;font-size:13px;box-sizing:border-box;">${statusOptions}</select>
              </div>
              <div style="margin-bottom:10px;">
                <label for="case-assign" style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Assign To</label>
                <select id="case-assign" name="assigned_to" style="width:100%;padding:8px;border:1px solid ${C.border};border-radius:6px;font-size:13px;box-sizing:border-box;">
                  <option value="">Unassigned</option>
                  ${staffOptions}
                </select>
              </div>
              <button type="submit" style="width:100%;padding:10px;background:${C.primary};color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600;">Update Case</button>
            </form>
          </div>
        </div>
      </div>
      <h3 style="font-size:16px;margin:0 0 12px;">Case Notes & Follow-ups (${notes.length})</h3>
      ${notesHtml || '<p style="color:${C.textMuted};text-align:center;padding:20px;">No notes yet. Add the first note below.</p>'}
      <div style="background:#f8fafc;padding:20px;border-radius:10px;border:1px solid ${C.border};margin-top:16px;">
        <h3 style="font-size:15px;margin:0 0 12px;">Add Note / Follow-up</h3>
        <form method="POST" action="/anti-bullying/cases/${r.id}/note">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
            <div>
              <label for="note-type" style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Note Type</label>
              <select id="note-type" name="note_type" style="width:100%;padding:8px;border:1px solid ${C.border};border-radius:6px;font-size:13px;box-sizing:border-box;">
                <option value="note">General Note</option>
                <option value="follow_up">Follow-up</option>
                <option value="welfare_check">Welfare Check</option>
                <option value="meeting">Meeting</option>
              </select>
            </div>
            <div id="welfare-fields" style="display:none;">
              <label for="welfare-status" style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Welfare Status</label>
              <select id="welfare-status" name="welfare_status" style="width:100%;padding:8px;border:1px solid ${C.border};border-radius:6px;font-size:13px;box-sizing:border-box;">
                <option value="safe">Safe</option>
                <option value="monitoring">Monitoring</option>
                <option value="at_risk">At Risk</option>
              </select>
            </div>
          </div>
          <div style="margin-bottom:12px;">
            <label for="note-content" style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Content *</label>
            <textarea id="note-content" name="content" required rows="3" maxlength="2000" placeholder="Add your notes, observations, or details..." style="width:100%;padding:10px;border:1px solid ${C.border};border-radius:6px;font-size:14px;resize:vertical;box-sizing:border-box;"></textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
            <div>
              <label for="followup-action" style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Follow-up Action</label>
              <input type="text" id="followup-action" name="follow_up_action" maxlength="500" placeholder="e.g., Schedule meeting with student" style="width:100%;padding:8px;border:1px solid ${C.border};border-radius:6px;font-size:13px;box-sizing:border-box;" />
            </div>
            <div>
              <label for="meeting-date" style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Meeting Date</label>
              <input type="date" id="meeting-date" name="meeting_date" style="width:100%;padding:8px;border:1px solid ${C.border};border-radius:6px;font-size:13px;box-sizing:border-box;" />
            </div>
          </div>
          <div style="margin-bottom:12px;">
            <label for="note-outcome" style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Outcome</label>
            <input type="text" id="note-outcome" name="outcome" maxlength="500" placeholder="e.g., Student felt safer after meeting" style="width:100%;padding:8px;border:1px solid ${C.border};border-radius:6px;font-size:13px;box-sizing:border-box;" />
          </div>
          <button type="submit" style="padding:10px 24px;background:${C.green};color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600;">Add Note</button>
        </form>
      </div>
      <script>
        document.getElementById('note-type').addEventListener('change', function() {
          document.getElementById('welfare-fields').style.display = this.value === 'welfare_check' ? 'block' : 'none';
        });
      </script>`;
    res.send(renderPage(`Case #${reportId}`, pageShell(`Report #${reportId}`, html, 'cases'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 6: POST /anti-bullying/cases/:id/update — Update case status/assign
  // ══════════════════════════════════════════════════════════════════════════
  app.post('/anti-bullying/cases/:id/update', requireCounsellor, ah(async (req, res) => {
    const t = tid(req)();
    const reportId = parseInt(req.params.id);
    const status = (req.body.status || 'new').trim();
    const assignedTo = req.body.assigned_to ? parseInt(req.body.assigned_to) : null;
    if (!reportId || !STATUSES.includes(status)) return res.redirect('/anti-bullying/cases');
    await pool.query(
      `UPDATE bullying_reports SET status = $1, assigned_to = $2, assigned_by = $3, updated_at = NOW() WHERE id = $4 AND tenant_id = $5`,
      [status, assignedTo, req.session.user.id, reportId, t]
    );
    audit({ action: 'bullying_case_updated', tenantId: t, detail: `Report #${reportId} status=${status} assigned_to=${assignedTo}` });
    res.redirect(`/anti-bullying/cases/${reportId}`);
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 7: POST /anti-bullying/cases/:id/note — Add case note/follow-up
  // ══════════════════════════════════════════════════════════════════════════
  app.post('/anti-bullying/cases/:id/note', requireCounsellor, ah(async (req, res) => {
    const t = tid(req)();
    const reportId = parseInt(req.params.id);
    const noteType = (req.body.note_type || 'note').trim();
    const content = (req.body.content || '').trim();
    if (!reportId || !content) return res.redirect(`/anti-bullying/cases/${reportId}`);
    await pool.query(
      `INSERT INTO bullying_case_notes (tenant_id, report_id, note_type, content, follow_up_action, meeting_date, welfare_check, welfare_status, outcome, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [t, reportId, noteType, content.slice(0, 2000), req.body.follow_up_action ? (req.body.follow_up_action || '').trim().slice(0, 500) : null, req.body.meeting_date || null, noteType === 'welfare_check', noteType === 'welfare_check' ? (req.body.welfare_status || 'monitoring') : null, req.body.outcome ? (req.body.outcome || '').trim().slice(0, 500) : null, req.session.user.id]
    );
    audit({ action: 'bullying_note_added', tenantId: t, detail: `Report #${reportId} type=${noteType}` });
    res.redirect(`/anti-bullying/cases/${reportId}`);
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 8: GET /anti-bullying/resources — Resource Library
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/anti-bullying/resources', ah(async (req, res) => {
    const t = req.session?.user?.tenant_id || 0;
    const filterCat = (req.query.category || '').trim();
    let where = 'WHERE br.tenant_id = $1 AND br.is_active = true';
    const params = [t];
    if (filterCat) { where += ` AND br.category = $2`; params.push(filterCat); }
    const { rows: resources } = await pool.query(
      `SELECT * FROM bullying_resources br ${where} ORDER BY br.created_at DESC LIMIT 50`, params
    );
    const catLinks = RESOURCE_CATS.map(c => {
      const label = c.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
      return `<a href="/anti-bullying/resources?category=${c}" style="display:inline-block;padding:6px 14px;margin:3px;border-radius:20px;font-size:13px;text-decoration:none;font-weight:500;${filterCat === c ? 'background:' + C.primary + ';color:#fff;' : 'background:#f1f5f9;color:' + C.text + ';'}">${esc(label)}</a>`;
    }).join('');
    const resHtml = resources.map(r => {
      const typeIcon = r.content_type === 'video' ? '\uD83C\uDFAC' : r.content_type === 'hotline' ? '\uD83D\uDCDE' : '\uD83D\uDCD6';
      return `<div style="padding:16px;border-radius:10px;border:1px solid ${C.border};margin-bottom:10px;transition:box-shadow 0.2s;" onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.08)'" onmouseout="this.style.boxShadow='none'">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <span style="font-size:28px;">${typeIcon}</span>
          <div style="flex:1;">
            <h3 style="margin:0 0 4px;font-size:15px;">${esc(r.title)}</h3>
            <div style="display:flex;gap:6px;margin-bottom:6px;">
              <span style="font-size:11px;color:${C.primary};background:${C.primary}12;padding:2px 8px;border-radius:10px;">${esc(r.category.replace(/_/g, ' '))}</span>
              <span style="font-size:11px;color:${C.textMuted};">${esc(r.content_type)}</span>
            </div>
            ${r.description ? `<p style="margin:0 0 6px;font-size:13px;color:${C.textMuted};line-height:1.5;">${esc(r.description)}</p>` : ''}
            ${r.body ? `<p style="margin:0 0 8px;font-size:13px;color:${C.text};line-height:1.5;">${esc(r.body.slice(0, 300))}${r.body.length > 300 ? '...' : ''}</p>` : ''}
            ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" style="color:${C.primary};font-size:13px;text-decoration:none;font-weight:600;">\uD83D\uDD17 View Resource \u2197\uFE0F</a>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
    let html = `
      <div style="text-align:center;padding:10px 0 20px;">
        <div style="font-size:40px;">\uD83D\uDCDA</div>
        <h2 style="font-size:20px;margin:4px 0;">Anti-Bullying Resource Library</h2>
        <p style="color:${C.textMuted};font-size:14px;margin:0;">Articles, videos, hotlines, and coping strategies to help you understand and address bullying.</p>
      </div>
      <div style="margin-bottom:16px;">${catLinks}</div>
      ${resHtml || `<div style="text-align:center;padding:40px;color:${C.textMuted};"><p>No resources found in this category.</p></div>`}`;
    res.send(renderPage('Resources', pageShell('Resource Library', html, 'resources'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 9: GET /anti-bullying/map — Incident Map (SVG Heatmap)
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/anti-bullying/map', requireCounsellor, ah(async (req, res) => {
    const t = tid(req)();
    const { rows: locationData } = await pool.query(
      `SELECT LOWER(location) as loc, COUNT(*)::int as cnt
       FROM bullying_reports
       WHERE tenant_id = $1 AND location IS NOT NULL AND location != ''
       GROUP BY LOWER(location) ORDER BY cnt DESC`, [t]
    );
    const heatmapData = locationData.map(d => ({ l: d.loc, v: d.cnt }));
    const totalIncidents = locationData.reduce((s, d) => s + d.cnt, 0);
    const topLocation = locationData.length ? locationData[0] : { loc: 'N/A', cnt: 0 };
    const heatmapSvg = svgHeatmap(heatmapData);
    const locationBreakdown = locationData.map(d =>
      `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid ${C.border};">
        <span style="font-size:13px;flex:1;font-weight:500;">${esc(d.loc.charAt(0).toUpperCase() + d.loc.slice(1))}</span>
        <div style="width:120px;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden;">
          <div style="height:100%;background:${d.cnt === topLocation.cnt ? C.red : C.primary};border-radius:4px;width:${pct(d.cnt, topLocation.cnt)}%;"></div>
        </div>
        <span style="font-size:13px;font-weight:700;color:${C.text};min-width:30px;text-align:right;">${d.cnt}</span>
      </div>`
    ).join('');
    let html = `
      <div style="text-align:center;margin-bottom:20px;">
        <h2 style="font-size:20px;margin:0 0 4px;">Incident Location Map</h2>
        <p style="color:${C.textMuted};font-size:14px;">Visual breakdown of where bullying is most commonly reported</p>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;">
        <div style="overflow-x:auto;">${heatmapSvg}</div>
        <div>
          <h3 style="font-size:15px;margin:0 0 12px;">Location Breakdown</h3>
          <div style="background:#f8fafc;padding:14px;border-radius:10px;border:1px solid ${C.border};">
            <div style="margin-bottom:12px;">
              <div style="font-size:11px;color:${C.textMuted};text-transform:uppercase;font-weight:600;">Total Incidents</div>
              <div style="font-size:28px;font-weight:800;color:${C.primary};">${totalIncidents}</div>
            </div>
            <div style="margin-bottom:12px;">
              <div style="font-size:11px;color:${C.textMuted};text-transform:uppercase;font-weight:600;">Highest Risk Area</div>
              <div style="font-size:16px;font-weight:700;color:${C.red};">${esc(topLocation.loc.charAt(0).toUpperCase() + topLocation.loc.slice(1))} (${topLocation.cnt})</div>
            </div>
            ${locationBreakdown || '<p style="color:${C.textMuted};font-size:13px;">No location data available</p>'}
          </div>
        </div>
      </div>`;
    res.send(renderPage('Incident Map', pageShell('Incident Map', html, 'map'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 10: GET /anti-bullying/statistics — SVG Charts
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/anti-bullying/statistics', requireCounsellor, ah(async (req, res) => {
    const t = tid(req)();
    // Reports by type (donut)
    const { rows: byType } = await pool.query(
      `SELECT report_type, COUNT(*)::int as cnt FROM bullying_reports WHERE tenant_id = $1 GROUP BY report_type ORDER BY cnt DESC`, [t]
    );
    const typeColors = ['#dc2626', '#f59e0b', '#7c3aed', '#be185d', '#64748b'];
    const typeDonut = svgDonutChart(byType.map(d => ({ l: d.report_type, v: d.cnt })), { title: 'Reports by Type', colors: typeColors });
    // Reports by location (bar)
    const { rows: byLocation } = await pool.query(
      `SELECT location, COUNT(*)::int as cnt FROM bullying_reports WHERE tenant_id = $1 AND location IS NOT NULL AND location != '' GROUP BY location ORDER BY cnt DESC LIMIT 10`, [t]
    );
    const locationBar = svgBarChart(byLocation.map(d => ({ l: d.location, v: d.cnt })), {
      title: 'Reports by Location',
      colorFn: (v) => { const maxV = Math.max(...byLocation.map(d => d.cnt), 1); return v >= maxV * 0.8 ? C.red : v >= maxV * 0.5 ? C.orange : C.primary; }
    });
    // Monthly trend (line)
    const { rows: monthly } = await pool.query(
      `SELECT to_char(created_at, 'Mon YY') as month_label, COUNT(*)::int as cnt
       FROM bullying_reports WHERE tenant_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '12 months'
       GROUP BY to_char(created_at, 'Mon YY'), date_trunc('month', created_at)
       ORDER BY date_trunc('month', created_at)`, [t]
    );
    const monthlyLine = svgLineChart(monthly.map(d => ({ l: d.month_label, v: d.cnt })), {
      title: 'Monthly Trend (12 Months)', color: C.primary
    });
    // Resolution rate (gauge)
    const { rows: totalRes } = await pool.query(
      `SELECT COUNT(*)::int as total,
              COUNT(*) FILTER (WHERE status IN ('resolved','closed'))::int as resolved
       FROM bullying_reports WHERE tenant_id = $1`, [t]
    );
    const resolutionRate = pct(totalRes[0].resolved, totalRes[0].total);
    const resolutionGauge = svgGaugeChart(resolutionRate, { title: 'Resolution Rate' });
    // Urgency distribution
    const { rows: byUrgency } = await pool.query(
      `SELECT urgency, COUNT(*)::int as cnt FROM bullying_reports WHERE tenant_id = $1 GROUP BY urgency ORDER BY cnt DESC`, [t]
    );
    const urgencyColors = ['#64748b', '#f59e0b', '#f97316', '#dc2626'];
    const urgencyDonut = svgDonutChart(byUrgency.map(d => ({ l: d.urgency, v: d.cnt })), { title: 'By Urgency', colors: urgencyColors, width: 220, height: 220, outerR: 85, innerR: 50 });
    // Status distribution
    const { rows: byStatus } = await pool.query(
      `SELECT status, COUNT(*)::int as cnt FROM bullying_reports WHERE tenant_id = $1 GROUP BY status ORDER BY cnt DESC`, [t]
    );
    const statusColors = ['#1d4ed8', '#b45309', '#15803d', '#64748b'];
    const statusDonut = svgDonutChart(byStatus.map(d => ({ l: d.status, v: d.cnt })), { title: 'By Status', colors: statusColors, width: 220, height: 220, outerR: 85, innerR: 50 });
    // Average resolution time
    const { rows: avgResTime } = await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400)::numeric(5,1) as avg_days
       FROM bullying_reports WHERE tenant_id = $1 AND status IN ('resolved','closed') AND updated_at IS NOT NULL`, [t]
    );
    const avgDays = avgResTime[0].avg_days || 0;
    let html = `
      <div style="text-align:center;margin-bottom:24px;">
        <h2 style="font-size:20px;margin:0 0 4px;">Anti-Bullying Statistics</h2>
        <p style="color:${C.textMuted};font-size:14px;">Data-driven insights to improve school safety</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px;">
        <div style="text-align:center;padding:16px;background:linear-gradient(135deg,${C.primary},${C.primaryLight});border-radius:10px;color:#fff;">
          <div style="font-size:11px;opacity:0.9;">TOTAL REPORTS</div>
          <div style="font-size:30px;font-weight:800;">${totalRes[0].total}</div>
        </div>
        <div style="text-align:center;padding:16px;background:linear-gradient(135deg,${C.green},${C.greenLight});border-radius:10px;color:#fff;">
          <div style="font-size:11px;opacity:0.9;">RESOLVED</div>
          <div style="font-size:30px;font-weight:800;">${totalRes[0].resolved}</div>
        </div>
        <div style="text-align:center;padding:16px;background:linear-gradient(135deg,${C.red},${C.redLight});border-radius:10px;color:#fff;">
          <div style="font-size:11px;opacity:0.9;">URGENT</div>
          <div style="font-size:30px;font-weight:800;">${byUrgency.filter(u => u.urgency === 'urgent').reduce((s, u) => s + u.cnt, 0)}</div>
        </div>
        <div style="text-align:center;padding:16px;background:linear-gradient(135deg,${C.orange},#fb923c);border-radius:10px;color:#fff;">
          <div style="font-size:11px;opacity:0.9;">AVG RESOLUTION</div>
          <div style="font-size:30px;font-weight:800;">${avgDays}d</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
        <div>${typeDonut}</div>
        <div>${locationBar}</div>
      </div>
      <div style="margin-bottom:24px;">${monthlyLine}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-bottom:24px;align-items:start;">
        <div>${resolutionGauge}</div>
        <div>${urgencyDonut}</div>
        <div>${statusDonut}</div>
      </div>`;
    res.send(renderPage('Statistics', pageShell('Statistics', html, 'stats'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 11: GET /anti-bullying/safety-tips — Student Safety Tips
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/anti-bullying/safety-tips', ah(async (req, res) => {
    const dailyTip = getDailyTip();
    const tipsHtml = SAFETY_TIPS.map((tip, i) =>
      `<div style="padding:16px;border-radius:10px;border:1px solid ${C.border};margin-bottom:10px;background:${i === 0 ? 'linear-gradient(135deg,' + C.primary + ',' + C.primaryLight + ')' : '#fff'};color:${i === 0 ? '#fff' : C.text};transition:transform 0.15s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <span style="font-size:24px;${i === 0 ? '' : 'color:' + C.primary + ';'}">${i === 0 ? '\uD83D\uDD25' : '\uD83D\uDD31'}</span>
          <div>
            <h3 style="margin:0 0 6px;font-size:15px;">${esc(tip.title)}</h3>
            <p style="margin:0;font-size:14px;line-height:1.6;${i === 0 ? 'opacity:0.95;' : 'color:' + C.textMuted + ';'}">${esc(tip.body)}</p>
          </div>
        </div>
      </div>`
    ).join('');
    const hotlineSection = `
      <div style="background:#fee2e2;border:2px solid #fecaca;border-radius:12px;padding:20px;margin-top:20px;">
        <h3 style="font-size:18px;color:${C.red};margin:0 0 10px;">\uD83D\uDCDE Crisis Helplines</h3>
        <p style="color:${C.text};font-size:14px;margin:0 0 12px;line-height:1.5;">If you or someone you know is in immediate danger, please reach out:</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
          <div style="background:#fff;padding:12px;border-radius:8px;">
            <div style="font-weight:700;font-size:14px;color:${C.text};">Childline</div>
            <div style="font-size:16px;font-weight:800;color:${C.red};">0800 1111</div>
          </div>
          <div style="background:#fff;padding:12px;border-radius:8px;">
            <div style="font-weight:700;font-size:14px;color:${C.text};">Samaritans</div>
            <div style="font-size:16px;font-weight:800;color:${C.red};">116 123</div>
          </div>
          <div style="background:#fff;padding:12px;border-radius:8px;">
            <div style="font-weight:700;font-size:14px;color:${C.text};">NSPCC</div>
            <div style="font-size:16px;font-weight:800;color:${C.red};">0808 800 5000</div>
          </div>
          <div style="background:#fff;padding:12px;border-radius:8px;">
            <div style="font-weight:700;font-size:14px;color:${C.text};">Emergency</div>
            <div style="font-size:16px;font-weight:800;color:${C.red};">999 / 112</div>
          </div>
        </div>
      </div>`;
    let html = `
      <div style="text-align:center;padding:10px 0 20px;">
        <div style="font-size:40px;">\uD83D\uDEE1\uFE0F</div>
        <h2 style="font-size:20px;margin:4px 0;">Student Safety Tips</h2>
        <p style="color:${C.textMuted};font-size:14px;margin:0;">Knowledge is power. Learn how to protect yourself and others.</p>
      </div>
      <div style="background:linear-gradient(135deg,${C.primary},#818cf8);color:#fff;padding:20px;border-radius:12px;margin-bottom:20px;text-align:center;">
        <div style="font-size:11px;opacity:0.8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">\uD83D\uDCC5 Tip of the Day</div>
        <h3 style="margin:0 0 8px;font-size:18px;">${esc(dailyTip.title)}</h3>
        <p style="margin:0;font-size:14px;line-height:1.6;opacity:0.95;">${esc(dailyTip.body)}</p>
      </div>
      <h3 style="font-size:16px;margin:0 0 12px;">All Safety Tips</h3>
      ${tipsHtml}
      ${hotlineSection}`;
    res.send(renderPage('Safety Tips', pageShell('Safety Tips', html, 'tips'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 12: GET /anti-bullying/crisis — Crisis Protocol Reference
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/anti-bullying/crisis', requireCounsellor, ah(async (req, res) => {
    let html = `
      <div style="text-align:center;padding:10px 0 20px;">
        <div style="font-size:40px;">\uD83D\uDEA8</div>
        <h2 style="font-size:20px;margin:4px 0;">Crisis Protocol</h2>
        <p style="color:${C.textMuted};font-size:14px;margin:0;">Emergency procedures for urgent bullying situations</p>
      </div>
      <div style="background:#7f1d1d;color:#fff;padding:20px;border-radius:12px;margin-bottom:20px;">
        <h3 style="margin:0 0 8px;font-size:16px;">\uD83D\uDD34 When a Report is Flagged as URGENT</h3>
        <ol style="margin:0;padding-left:20px;line-height:1.8;font-size:14px;">
          <li>Immediate email alert sent to all designated safeguarding leads (counsellors &amp; admins)</li>
          <li>Report appears in the urgent queue on the dashboard with a red alert banner</li>
          <li>Assigned counsellor must initiate contact within <strong>24 hours</strong></li>
          <li>Welfare check must be scheduled and documented within <strong>48 hours</strong></li>
          <li>If physical danger is confirmed, local authorities must be notified immediately</li>
          <li>All actions must be recorded as case notes with timestamps</li>
        </ol>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div style="border:2px solid ${C.red};border-radius:12px;padding:18px;">
          <h3 style="font-size:15px;color:${C.red};margin:0 0 10px;">\uD83D\uDD04 Response Timeline</h3>
          <div style="border-left:3px solid ${C.red};padding-left:14px;margin-left:6px;">
            <div style="margin-bottom:12px;position:relative;">
              <span style="position:absolute;left:-22px;top:2px;width:12px;height:12px;border-radius:50%;background:${C.red};border:2px solid #fff;"></span>
              <div style="font-size:12px;font-weight:700;color:${C.red};">0-1 Hour</div>
              <div style="font-size:13px;color:${C.text};">Email alerts sent. Initial review of report.</div>
            </div>
            <div style="margin-bottom:12px;position:relative;">
              <span style="position:absolute;left:-22px;top:2px;width:12px;height:12px;border-radius:50%;background:${C.orange};border:2px solid #fff;"></span>
              <div style="font-size:12px;font-weight:700;color:${C.orange};">1-24 Hours</div>
              <div style="font-size:13px;color:${C.text};">Assign case. Begin initial investigation.</div>
            </div>
            <div style="margin-bottom:12px;position:relative;">
              <span style="position:absolute;left:-22px;top:2px;width:12px;height:12px;border-radius:50%;background:${C.primary};border:2px solid #fff;"></span>
              <div style="font-size:12px;font-weight:700;color:${C.primary};">24-48 Hours</div>
              <div style="font-size:13px;color:${C.text};">Conduct welfare check. Schedule meetings.</div>
            </div>
            <div style="margin-bottom:12px;position:relative;">
              <span style="position:absolute;left:-22px;top:2px;width:12px;height:12px;border-radius:50%;background:${C.green};border:2px solid #fff;"></span>
              <div style="font-size:12px;font-weight:700;color:${C.green};">1-2 Weeks</div>
              <div style="font-size:13px;color:${C.text};">Implement safety plan. Monitor situation.</div>
            </div>
            <div style="position:relative;">
              <span style="position:absolute;left:-22px;top:2px;width:12px;height:12px;border-radius:50%;background:#64748b;border:2px solid #fff;"></span>
              <div style="font-size:12px;font-weight:700;color:#64748b;">Ongoing</div>
              <div style="font-size:13px;color:${C.text};">Regular follow-ups until case is resolved.</div>
            </div>
          </div>
        </div>
        <div style="border:2px solid ${C.primary};border-radius:12px;padding:18px;">
          <h3 style="font-size:15px;color:${C.primary};margin:0 0 10px;">\uD83D\uDCDD Key Actions</h3>
          <ul style="margin:0;padding-left:18px;line-height:2;font-size:14px;color:${C.text};">
            <li>Document all communications and observations</li>
            <li>Keep parents/guardians informed (as appropriate)</li>
            <li>Ensure student safety is the top priority</li>
            <li>Involve external agencies when necessary</li>
            <li>Follow school safeguarding policy</li>
            <li>Maintain confidentiality of all parties</li>
            <li>Provide ongoing support to affected students</li>
            <li>Review and update anti-bullying policies regularly</li>
          </ul>
        </div>
      </div>
      <div style="background:#f8fafc;padding:16px;border-radius:10px;border:1px solid ${C.border};text-align:center;">
        <p style="font-size:14px;color:${C.textMuted};margin:0;">\uD83C\uDFE5 This crisis protocol is automatically triggered when any report is submitted with urgency level <strong style="color:${C.red};">URGENT</strong>.</p>
      </div>`;
    res.send(renderPage('Crisis Protocol', pageShell('Crisis Protocol', html, 'cases'), req));
  }));
};
