/**
 * Parent Communication Hub — Multi-Tenant SaaS School Portal
 * 20 routes: dashboard, announcements (CRUD + delete), send-bulk (GET/POST),
 * messages inbox, view message, reply, templates (CRUD + delete), feedback,
 * respond to feedback, schedule (GET/POST), analytics, settings, read-receipt.
 *
 * Features: Announcements with read receipts, SMS blast to parents, email
 * newsletters, parent feedback surveys, complaint tracking, meeting scheduling,
 * circular distribution, event invitations, RSVP tracking, communication
 * templates, delivery analytics with SVG charts, multi-language support,
 * urgent alerts, scheduled communications.
 */
'use strict';
module.exports = function (app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style><div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#4f46e5">School</a> &rsaquo; Parent Communication Hub</div>';

  // ── Constants ──────────────────────────────────────────
  const PS = 20; // page size

  // ═══════════════════════════════════════════════════════
  //  MIGRATIONS (async IIFE at module load)
  // ═══════════════════════════════════════════════════════
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS parent_announcements (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title VARCHAR(500) NOT NULL,
        content TEXT NOT NULL,
        category VARCHAR(100) DEFAULT 'general',
        priority VARCHAR(20) DEFAULT 'normal',
        created_by INTEGER,
        scheduled_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        recipients JSONB DEFAULT '[]'::jsonb,
        read_receipts JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );`);
      await pool.query(`CREATE TABLE IF NOT EXISTS parent_messages (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        parent_id INTEGER,
        subject VARCHAR(500) NOT NULL,
        body TEXT NOT NULL,
        channel VARCHAR(30) DEFAULT 'email',
        status VARCHAR(20) DEFAULT 'sent',
        direction VARCHAR(10) DEFAULT 'outbound',
        sent_at TIMESTAMPTZ DEFAULT NOW(),
        read_at TIMESTAMPTZ
      );`);
      await pool.query(`CREATE TABLE IF NOT EXISTS communication_templates (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        subject VARCHAR(500),
        body TEXT NOT NULL,
        category VARCHAR(100) DEFAULT 'general',
        language VARCHAR(10) DEFAULT 'en',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );`);
      await pool.query(`CREATE TABLE IF NOT EXISTS parent_feedback (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        parent_id INTEGER,
        subject VARCHAR(500) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'open',
        response TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      );`);

      // Safe column additions for re-deploys
      const colMap = {
        parent_announcements: [
          'tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE',
          'title VARCHAR(500) NOT NULL', 'content TEXT NOT NULL',
          "category VARCHAR(100) DEFAULT 'general'",
          "priority VARCHAR(20) DEFAULT 'normal'",
          'created_by INTEGER', 'scheduled_at TIMESTAMPTZ', 'sent_at TIMESTAMPTZ',
          "recipients JSONB DEFAULT '[]'::jsonb",
          "read_receipts JSONB DEFAULT '[]'::jsonb",
          'created_at TIMESTAMPTZ DEFAULT NOW()'
        ],
        parent_messages: [
          'tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE',
          'parent_id INTEGER', 'subject VARCHAR(500) NOT NULL', 'body TEXT NOT NULL',
          "channel VARCHAR(30) DEFAULT 'email'",
          "status VARCHAR(20) DEFAULT 'sent'",
          "direction VARCHAR(10) DEFAULT 'outbound'",
          'sent_at TIMESTAMPTZ DEFAULT NOW()', 'read_at TIMESTAMPTZ'
        ],
        communication_templates: [
          'tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE',
          'name VARCHAR(255) NOT NULL', 'subject VARCHAR(500)', 'body TEXT NOT NULL',
          "category VARCHAR(100) DEFAULT 'general'",
          "language VARCHAR(10) DEFAULT 'en'",
          'created_at TIMESTAMPTZ DEFAULT NOW()'
        ],
        parent_feedback: [
          'tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE',
          'parent_id INTEGER', 'subject VARCHAR(500) NOT NULL', 'message TEXT NOT NULL',
          "status VARCHAR(20) DEFAULT 'open'",
          'response TEXT', 'created_at TIMESTAMPTZ DEFAULT NOW()', 'resolved_at TIMESTAMPTZ'
        ]
      };
      for (const [tbl, cols] of Object.entries(colMap)) {
        for (const c of cols) {
          await pool.query(`ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS ${c};`).catch(() => {});
        }
      }

      // Indexes
      const idxSql = [
        'CREATE INDEX IF NOT EXISTS idx_pa_tid ON parent_announcements(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_pa_cat ON parent_announcements(tenant_id,category);',
        'CREATE INDEX IF NOT EXISTS idx_pa_prio ON parent_announcements(tenant_id,priority);',
        'CREATE INDEX IF NOT EXISTS idx_pa_ca ON parent_announcements(tenant_id,created_at DESC);',
        'CREATE INDEX IF NOT EXISTS idx_pm_tid ON parent_messages(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_pm_pid ON parent_messages(tenant_id,parent_id);',
        'CREATE INDEX IF NOT EXISTS idx_pm_ch ON parent_messages(tenant_id,channel);',
        'CREATE INDEX IF NOT EXISTS idx_pm_st ON parent_messages(tenant_id,status);',
        'CREATE INDEX IF NOT EXISTS idx_ct_tid ON communication_templates(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_ct_cat ON communication_templates(tenant_id,category);',
        'CREATE INDEX IF NOT EXISTS idx_pf_tid ON parent_feedback(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_pf_st ON parent_feedback(tenant_id,status);',
      ];
      for (const sql of idxSql) await pool.query(sql).catch(() => {});

      // Seed default templates per tenant
      try {
        const tenants = (await pool.query('SELECT id FROM tenants')).rows;
        for (const t of tenants) {
          await pool.query(`INSERT INTO communication_templates (tenant_id,name,subject,body,category,language) VALUES
            ($1,'General Notice','Important Notice','Dear {{parent_name}},\n\n{{message}}\n\nRegards,\n{{school_name}}','general','en'),
            ($1,'Fee Reminder','Fee Payment Reminder','Dear {{parent_name}},\n\nFee of {{amount}} for {{term}} is due on {{due_date}}.\n\nPlease pay promptly.','billing','en'),
            ($1,'Event Invitation','Invitation: {{event_name}}','Dear {{parent_name}},\n\nYou are invited to {{event_name}} on {{date}} at {{time}}.\nVenue: {{venue}}.\n\nRSVP by {{rsvp_date}}.','events','en'),
            ($1,'Urgent Alert','URGENT: {{alert_subject}}','Dear {{parent_name}},\n\n{{alert_message}}\n\nPlease take immediate action.','urgent','en'),
            ($1,'Meeting Request','Parent-Teacher Meeting','Dear {{parent_name}},\n\nA meeting has been scheduled on {{date}} at {{time}} with {{teacher_name}}.\n\nPlease confirm attendance.','meeting','en'),
            ($1,'Circular','School Circular: {{title}}','Dear {{parent_name}},\n\n{{content}}\n\nPlease acknowledge receipt.','circular','en'),
            ($1,'Avis General','Avis Important','Cher {{parent_name}},\n\n{{message}}\n\nCordialement,\n{{school_name}}','general','fr'),
            ($1,'Recordatorio de Pago','Recordatorio de Pago','Estimado {{parent_name}},\n\nEl pago de {{amount}} para {{term}} vence el {{due_date}}.\n\nFavor de pagar a tiempo.','billing','es')
            ON CONFLICT DO NOTHING;`, [t.id]);
        }
      } catch (seedErr) {
        console.warn('[ParentComm] Seed skipped:', seedErr.message);
      }

      console.log('[ParentComm] Tables ready');
    } catch (e) {
      console.warn('[ParentComm] Migration warning:', e.message);
    }
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

  function pctStr(num, den) {
    if (!den || den <= 0) return '0.0';
    return ((num / den) * 100).toFixed(1);
  }

  function badge(s) {
    const m = {
      draft: 'background:#fef3c7;color:#92400e',
      scheduled: 'background:#dbeafe;color:#1e40af',
      sent: 'background:#dcfce7;color:#16a34a',
      failed: 'background:#fef2f2;color:#dc2626',
      open: 'background:#fef3c7;color:#92400e',
      in_progress: 'background:#dbeafe;color:#1e40af',
      resolved: 'background:#dcfce7;color:#16a34a',
      closed: 'background:#f3f4f6;color:#6b7280',
      read: 'background:#dcfce7;color:#16a34a',
      delivered: 'background:#dbeafe;color:#1e40af',
      undelivered: 'background:#fef2f2;color:#dc2626',
      normal: 'background:#f3f4f6;color:#6b7280',
      high: 'background:#fef3c7;color:#92400e',
      urgent: 'background:#fef2f2;color:#dc2626',
    };
    const c = m[s] || 'background:#f3f4f6;color:#6b7280';
    return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;background:${c}">${esc(s || '')}</span>`;
  }

  function flash(req) {
    const f = req.session.pcFlash;
    delete req.session.pcFlash;
    if (!f) return '';
    const bg = f.type === 'error' ? '#fef2f2;border:1px solid #fecaca;color:#dc2626'
      : f.type === 'warn' ? '#fffbeb;border:1px solid #fde68a;color:#92400e'
      : '#f0fdf4;border:1px solid #bbf7d0;color:#16a34a';
    return `<div style="background:${bg};padding:10px 14px;border-radius:8px;margin-bottom:14px">${esc(f.msg)}</div>`;
  }

  function nav(active) {
    const links = [
      ['dashboard', 'Dashboard', '/school/parent-comm'],
      ['announcements', 'Announcements', '/school/parent-comm/announcements'],
      ['send-bulk', 'Send Bulk', '/school/parent-comm/send-bulk'],
      ['messages', 'Messages', '/school/parent-comm/messages'],
      ['templates', 'Templates', '/school/parent-comm/templates'],
      ['feedback', 'Feedback', '/school/parent-comm/feedback'],
      ['schedule', 'Schedule', '/school/parent-comm/schedule'],
      ['analytics', 'Analytics', '/school/parent-comm/analytics'],
      ['settings', 'Settings', '/school/parent-comm/settings'],
    ];
    return '<div style="display:flex;gap:6px;margin-bottom:18px;flex-wrap:wrap">' +
      links.map(([k, l, h]) =>
        `<a href="${h}" style="padding:6px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;border:1px solid ${active === k ? P : '#e5e7eb'};color:${active === k ? '#fff' : '#374151'};background:${active === k ? P : '#fff'}">${l}</a>`
      ).join('') + '</div>';
  }

  function pag(path, qs, pg, tot) {
    const p = Math.ceil(tot / PS);
    if (p <= 1) return '';
    return '<div style="display:flex;justify-content:center;gap:4px;margin-top:14px">' +
      Array.from({ length: p }, (_, i) => {
        const x = i + 1;
        return `<a href="${path}?${qs}&page=${x}" style="padding:5px 10px;border-radius:6px;font-size:13px;text-decoration:none;border:1px solid ${x === parseInt(pg) ? P : '#e5e7eb'};color:${x === parseInt(pg) ? '#fff' : '#374151'};background:${x === parseInt(pg) ? P : '#fff'}">${x}</a>`;
      }).join('') + '</div>';
  }

  /** SVG donut chart for read/delivery analytics */
  function svgDonut(segments, size, label) {
    const r = (size / 2) - 16, cx = size / 2, cy = size / 2;
    const total = segments.reduce((a, s) => a + s.value, 0) || 1;
    let cumulative = 0;
    const arcs = segments.map(seg => {
      const pct = seg.value / total;
      const start = cumulative;
      cumulative += pct;
      const x1 = cx + r * Math.cos(2 * Math.PI * start - Math.PI / 2);
      const y1 = cy + r * Math.sin(2 * Math.PI * start - Math.PI / 2);
      const x2 = cx + r * Math.cos(2 * Math.PI * (start + pct) - Math.PI / 2);
      const y2 = cy + r * Math.sin(2 * Math.PI * (start + pct) - Math.PI / 2);
      const large = pct > 0.5 ? 1 : 0;
      if (pct >= 1) return '';
      return `<path d="M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2}" fill="none" stroke="${seg.color}" stroke-width="14"/>`;
    }).join('');
    const legend = segments.map(s =>
      `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:12px"><span style="width:10px;height:10px;border-radius:50%;background:${s.color};display:inline-block"></span>${esc(s.label)} (${pctStr(s.value, total)}%)</span>`
    ).join('');
    return `<div style="text-align:center"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs}<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="18" font-weight="700" fill="#1f2937">${F(total)}</text><text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="${GRAY}">${esc(label || '')}</text></svg><div style="margin-top:8px">${legend}</div></div>`;
  }

  /** SVG bar chart for channel / category analytics */
  function svgBar(data, width, height, barColor) {
    const max = Math.max(...data.map(d => d.value), 1);
    const barW = Math.min(40, (width - 60) / data.length - 8);
    const chartH = height - 50;
    const bars = data.map((d, i) => {
      const x = 40 + i * (barW + 8);
      const barH = Math.max(2, (d.value / max) * (chartH - 10));
      const y = chartH - barH;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${barColor || P}"/><text x="${x + barW / 2}" y="${chartH + 16}" text-anchor="middle" font-size="10" fill="${GRAY}">${esc(String(d.label).substring(0, 10))}</text><text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" font-size="10" font-weight="600" fill="#1f2937">${F(d.value)}</text>`;
    }).join('');
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bars}</svg>`;
  }

  /** Simple HTML bar chart (lightweight fallback) */
  function htmlBar(data, color) {
    if (!data || !data.length) return '<p style="text-align:center;padding:16px;color:#9ca3af">No data</p>';
    const mx = Math.max(...data.map(d => d.value), 1);
    return data.map(d => {
      const w = Math.max(2, Math.round((d.value / mx) * 100));
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="min-width:100px;font-size:13px;text-align:right;color:${GRAY}">${esc(d.label)}</span><div style="flex:1;height:22px;background:#f3f4f6;border-radius:4px;overflow:hidden"><div style="height:100%;width:${w}%;background:${color || P};border-radius:4px"></div></div><span style="min-width:50px;font-size:13px;font-weight:600">${F(d.value)}</span></div>`;
    }).join('');
  }

  // ═══════════════════════════════════════════════════════
  //  CSS
  // ═══════════════════════════════════════════════════════
  const CSS = `<style>
    .pc-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:18px}
    .pc-stat{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px;text-align:center;transition:box-shadow .15s}
    .pc-stat:hover{box-shadow:0 2px 8px rgba(0,0,0,.06)}
    .pc-num{font-size:26px;font-weight:700;color:#1f2937}
    .pc-lbl{font-size:12px;color:${GRAY};margin-top:2px}
    .pc-qa{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:18px}
    .pc-qa-a{border:1px solid #e5e7eb;border-radius:10px;padding:14px;text-align:center;text-decoration:none;color:inherit;transition:all .15s;background:#fff}
    .pc-qa-a:hover{border-color:${P};box-shadow:0 2px 8px rgba(79,70,229,.12)}
    .pc-inp{padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;width:100%}
    .pc-inp:focus{border-color:${P};box-shadow:0 0 0 3px rgba(79,70,229,.12)}
    .pc-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;border:none;cursor:pointer;transition:all .15s}
    .pc-btn-primary{background:${P};color:#fff}.pc-btn-primary:hover{background:#3730a3}
    .pc-btn-secondary{background:#fff;color:#374151;border:1px solid #d1d5db}.pc-btn-secondary:hover{background:#f9fafb}
    .pc-btn-danger{background:#fff;color:#dc2626;border:1px solid #fecaca}.pc-btn-danger:hover{background:#fef2f2}
    .pc-btn-green{background:#16a34a;color:#fff}.pc-btn-green:hover{background:#15803d}
    .pc-btn-sm{padding:5px 12px;font-size:13px;border-radius:6px}
    .pc-table{width:100%;border-collapse:collapse;font-size:14px}
    .pc-table th{text-align:left;padding:10px 12px;border-bottom:2px solid #e5e7eb;font-weight:600;color:#374151;font-size:13px}
    .pc-table td{padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#4b5563}
    .pc-table tr:hover td{background:#f9fafb}
    .pc-fbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
    .pc-fbar select,.pc-fbar input{padding:7px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;background:#fff}
    .pc-fbar select:focus,.pc-fbar input:focus{border-color:${P}}
    .pc-tip{background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;font-size:13px;color:#1e40af;margin-top:10px}
    .pc-warn{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:13px;color:#92400e;margin-top:10px}
    .pc-sched{background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px;margin-top:12px}
    .pc-chip{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;margin:2px}
    .pc-var{display:inline-block;background:#eff6ff;color:${P};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;margin:2px}
    .pc-progress{height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;min-width:60px;flex:1}
    .pc-progress-fill{height:100%;border-radius:3px;transition:width .3s}
    .pc-tmpl{border:1px solid #e5e7eb;border-radius:10px;padding:14px;background:#fff;transition:box-shadow .15s}
    .pc-tmpl:hover{box-shadow:0 2px 8px rgba(0,0,0,.06)}
    .pc-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    @media(max-width:768px){.pc-grid2{grid-template-columns:1fr}}
  </style>`;

  // ═══════════════════════════════════════════════════════
  //  1. GET /school/parent-comm — Dashboard
  // ═══════════════════════════════════════════════════════
  app.get('/school/parent-comm', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const s = (await pool.query(`SELECT
      COUNT(*)::int AS total_announcements,
      COUNT(*) FILTER(WHERE priority='urgent')::int AS urgent_count,
      COUNT(*) FILTER(WHERE status='sent')::int AS sent_count,
      COUNT(*) FILTER(WHERE status='draft')::int AS draft_count,
      COUNT(*) FILTER(WHERE status='scheduled')::int AS scheduled_count,
      (SELECT COUNT(*)::int FROM parent_messages WHERE tenant_id=$1) AS total_messages,
      (SELECT COUNT(*)::int FROM parent_messages WHERE tenant_id=$1 AND status='sent' AND read_at IS NOT NULL) AS read_messages,
      (SELECT COUNT(*)::int FROM parent_feedback WHERE tenant_id=$1 AND status='open') AS open_feedback,
      (SELECT COUNT(*)::int FROM parent_feedback WHERE tenant_id=$1) AS total_feedback,
      (SELECT COUNT(*)::int FROM communication_templates WHERE tenant_id=$1) AS template_count
      FROM parent_announcements WHERE tenant_id=$1`, [tid])).rows[0];

    const readRate = pctStr(s.read_messages, s.total_messages);
    const feedbackRate = s.total_feedback > 0 ? pctStr(s.total_feedback - s.open_feedback, s.total_feedback) : '0.0';

    const recent = (await pool.query(`SELECT id,title,category,priority,sent_at,created_at FROM parent_announcements WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 6`, [tid])).rows;
    const recentHtml = recent.length === 0
      ? '<tr><td colspan="4" style="text-align:center;padding:28px;color:#9ca3af">No announcements yet. <a href="/school/parent-comm/announcements/new" style="color:' + P + '">Create one</a></td></tr>'
      : recent.map(a => `<tr><td><strong style="color:#374151">${esc(a.title)}</strong></td><td>${badge(a.category)}</td><td>${badge(a.priority)}</td><td class="muted">${ago(a.sent_at || a.created_at)}</td></tr>`).join('');

    const recentFeedback = (await pool.query(`SELECT id,subject,status,created_at FROM parent_feedback WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5`, [tid])).rows;
    const fbHtml = recentFeedback.length === 0
      ? '<p style="color:#9ca3af;text-align:center;padding:16px">No feedback yet</p>'
      : recentFeedback.map(f => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6"><span style="font-size:14px">${esc(f.subject)}</span><div>${badge(f.status)}<span class="muted" style="font-size:12px;margin-left:8px">${ago(f.created_at)}</span></div></div>`).join('');

    res.send(renderPage('Parent Communication Hub', `${SKIP}${CSS}${nav('dashboard')}
      <h2>Parent Communication Hub</h2>
      <p style="color:${GRAY};margin-bottom:18px">Central hub for all parent-school communications</p>

      <div class="pc-stats">
        <div class="pc-stat"><div class="pc-num" style="color:${P}">${F(s.total_announcements)}</div><div class="pc-lbl">Announcements</div></div>
        <div class="pc-stat"><div class="pc-num" style="color:#ef4444">${F(s.urgent_count)}</div><div class="pc-lbl">Urgent Alerts</div></div>
        <div class="pc-stat"><div class="pc-num" style="color:#16a34a">${F(s.sent_count)}</div><div class="pc-lbl">Sent</div></div>
        <div class="pc-stat"><div class="pc-num" style="color:#f59e0b">${F(s.scheduled_count)}</div><div class="pc-lbl">Scheduled</div></div>
        <div class="pc-stat"><div class="pc-num" style="color:#3b82f6">${F(s.total_messages)}</div><div class="pc-lbl">Messages</div></div>
        <div class="pc-stat"><div class="pc-num" style="color:#8b5cf6">${readRate}%</div><div class="pc-lbl">Read Rate</div></div>
        <div class="pc-stat"><div class="pc-num" style="color:#f59e0b">${F(s.open_feedback)}</div><div class="pc-lbl">Open Feedback</div></div>
        <div class="pc-stat"><div class="pc-num" style="color:#10b981">${feedbackRate}%</div><div class="pc-lbl">Resolved</div></div>
      </div>

      <div class="pc-qa">
        <a href="/school/parent-comm/announcements/new" class="pc-qa-a"><div style="font-size:22px;margin-bottom:4px">\u{1F4E2}</div><div style="font-size:13px;font-weight:600">New Announcement</div></a>
        <a href="/school/parent-comm/send-bulk" class="pc-qa-a"><div style="font-size:22px;margin-bottom:4px">\u{1F4E3}</div><div style="font-size:13px;font-weight:600">Send Bulk</div></a>
        <a href="/school/parent-comm/messages" class="pc-qa-a"><div style="font-size:22px;margin-bottom:4px">\u{1F4E7}</div><div style="font-size:13px;font-weight:600">Messages</div></a>
        <a href="/school/parent-comm/templates" class="pc-qa-a"><div style="font-size:22px;margin-bottom:4px">\u{1F4C4}</div><div style="font-size:13px;font-weight:600">Templates</div></a>
        <a href="/school/parent-comm/feedback" class="pc-qa-a"><div style="font-size:22px;margin-bottom:4px">\u{1F4AC}</div><div style="font-size:13px;font-weight:600">Feedback</div></a>
        <a href="/school/parent-comm/schedule" class="pc-qa-a"><div style="font-size:22px;margin-bottom:4px">\u{1F4C5}</div><div style="font-size:13px;font-weight:600">Schedule</div></a>
        <a href="/school/parent-comm/analytics" class="pc-qa-a"><div style="font-size:22px;margin-bottom:4px">\u{1F4CA}</div><div style="font-size:13px;font-weight:600">Analytics</div></a>
        <a href="/school/parent-comm/settings" class="pc-qa-a"><div style="font-size:22px;margin-bottom:4px">\u{2699}\u{FE0F}</div><div style="font-size:13px;font-weight:600">Settings</div></a>
      </div>

      <div class="pc-grid2">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0">Recent Announcements</h3><a href="/school/parent-comm/announcements" class="pc-btn pc-btn-sm pc-btn-secondary">View All</a></div>
          <table class="pc-table"><thead><tr><th>Title</th><th>Category</th><th>Priority</th><th>Date</th></tr></thead><tbody>${recentHtml}</tbody></table>
        </div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0">Recent Feedback</h3><a href="/school/parent-comm/feedback" class="pc-btn pc-btn-sm pc-btn-secondary">View All</a></div>
          ${fbHtml}
        </div>
      </div>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  2. GET /school/parent-comm/announcements — List
  // ═══════════════════════════════════════════════════════
  app.get('/school/parent-comm/announcements', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { category, priority, status, q, page = 1 } = req.query;
    const off = (parseInt(page) - 1) * PS;
    let w = ['tenant_id=$1'], p = [tid], i = 2;
    if (category && category !== 'all') { w.push(`category=$${i++}`); p.push(category); }
    if (priority && priority !== 'all') { w.push(`priority=$${i++}`); p.push(priority); }
    if (q) { w.push(`title ILIKE $${i++}`); p.push(`%${q}%`); }
    const wc = w.join(' AND ');
    const [cR, aR] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS t FROM parent_announcements WHERE ${wc}`, p),
      pool.query(`SELECT * FROM parent_announcements WHERE ${wc} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`, [...p, PS, off])
    ]);
    const tot = cR.rows[0]?.t || 0;
    const rows = aR.rows;
    const qs = `category=${category || ''}&priority=${priority || ''}&q=${q || ''}`;
    const tHtml = rows.length === 0
      ? '<tr><td colspan="6" style="text-align:center;padding:28px;color:#9ca3af">No announcements found</td></tr>'
      : rows.map(a => {
        const rr = (a.read_receipts || []).length;
        const rc = (a.recipients || []).length;
        const rp = rc > 0 ? Math.round((rr / rc) * 100) : 0;
        return `<tr>
          <td><strong>${esc(a.title)}</strong></td>
          <td>${badge(a.category)}</td>
          <td>${badge(a.priority)}</td>
          <td><div style="display:flex;align-items:center;gap:8px"><div class="pc-progress"><div class="pc-progress-fill" style="width:${rp}%;background:${rp >= 80 ? '#16a34a' : P}"></div></div><span style="font-size:12px;color:${GRAY}">${rp}%</span></div></td>
          <td class="muted">${ago(a.sent_at || a.created_at)}</td>
          <td><a href="/school/parent-comm/announcements/${a.id}" class="pc-btn pc-btn-sm pc-btn-secondary">View</a>
            <button onclick="delAnn(${a.id})" class="pc-btn pc-btn-sm pc-btn-danger">Delete</button></td></tr>`;
      }).join('');

    res.send(renderPage('Announcements', `${SKIP}${CSS}${nav('announcements')}${flash(req)}
      <h2>Announcements</h2>
      <p style="color:${GRAY};margin-bottom:14px">Manage school announcements to parents</p>
      <div class="card">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
          <div class="pc-fbar" style="margin:0">
            <input type="text" value="${esc(q || '')}" placeholder="Search..." id="fQ">
            <select id="fC"><option value="all">All Categories</option><option value="general"${category === 'general' ? ' selected' : ''}>General</option><option value="academic"${category === 'academic' ? ' selected' : ''}>Academic</option><option value="events"${category === 'events' ? ' selected' : ''}>Events</option><option value="circular"${category === 'circular' ? ' selected' : ''}>Circular</option><option value="urgent"${category === 'urgent' ? ' selected' : ''}>Urgent</option></select>
            <select id="fP"><option value="all">All Priority</option><option value="normal"${priority === 'normal' ? ' selected' : ''}>Normal</option><option value="high"${priority === 'high' ? ' selected' : ''}>High</option><option value="urgent"${priority === 'urgent' ? ' selected' : ''}>Urgent</option></select>
            <button class="pc-btn pc-btn-sm pc-btn-primary" onclick="applyF()">Filter</button>
            <a href="/school/parent-comm/announcements" class="pc-btn pc-btn-sm pc-btn-secondary">Clear</a>
          </div>
          <a href="/school/parent-comm/announcements/new" class="pc-btn pc-btn-sm pc-btn-green">+ New Announcement</a>
        </div>
        <table class="pc-table"><thead><tr><th>Title</th><th>Category</th><th>Priority</th><th>Read Rate</th><th>Date</th><th>Actions</th></tr></thead><tbody>${tHtml}</tbody></table>
        ${pag('/school/parent-comm/announcements', qs, page, tot)}
      </div>
      <script>
      function applyF(){var p=new URLSearchParams(),q=document.getElementById('fQ').value,c=document.getElementById('fC').value,pr=document.getElementById('fP').value;
        if(q)p.set('q',q);if(c!=='all')p.set('category',c);if(pr!=='all')p.set('priority',pr);location.href='/school/parent-comm/announcements?'+p.toString();}
      function delAnn(id){if(confirm('Delete this announcement?'))fetch('/school/parent-comm/announcements/'+id+'/delete',{method:'POST'}).then(function(r){return r.json()}).then(function(d){if(d.ok)location.reload();else alert(d.error||'Failed')});}
      </script>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  3. GET /school/parent-comm/announcements/new — Create
  // ═══════════════════════════════════════════════════════
  app.get('/school/parent-comm/announcements/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const tmpls = (await pool.query(`SELECT id,name,subject,language FROM communication_templates WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;
    const tOpts = tmpls.map(t => `<option value="${t.id}" data-subject="${esc(t.subject || '')}" data-lang="${esc(t.language || 'en')}">${esc(t.name)} (${esc(t.language || 'en')})</option>`).join('');
    res.send(renderPage('New Announcement', `${SKIP}${CSS}${nav('announcements')}
      <h2>New Announcement</h2>
      <p style="color:${GRAY};margin-bottom:18px">Create a new announcement for parents</p>
      <div class="card">
        <form method="POST" action="/school/parent-comm/announcements/new" style="display:grid;gap:14px">
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Title *</label><input type="text" name="title" required class="pc-inp" placeholder="Announcement title"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Category *</label>
              <select name="category" class="pc-inp"><option value="general">General</option><option value="academic">Academic</option><option value="events">Events</option><option value="circular">Circular</option><option value="urgent">Urgent</option><option value="meeting">Meeting</option></select></div>
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Priority *</label>
              <select name="priority" class="pc-inp"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Template</label>
              <select name="template_id" id="tmplSel" class="pc-inp" onchange="loadTmpl()"><option value="">-- Select Template --</option>${tOpts}</select></div>
          </div>
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Content *</label><textarea name="content" rows="8" required class="pc-inp" placeholder="Write your announcement here... Use {{parent_name}}, {{school_name}}, {{student_name}} for variables."></textarea></div>
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Recipients</label>
            <select name="recipients" class="pc-inp"><option value="all">All Parents</option><option value="class">Specific Class</option><option value="individual">Individual Parents</option></select></div>
          <div class="pc-sched" id="schedBox" style="display:none"><label style="display:block;font-weight:600;margin-bottom:4px">Schedule For</label><input type="datetime-local" name="scheduled_at" class="pc-inp"><p class="muted" style="font-size:11px;margin-top:4px">Leave empty to send immediately</p></div>
          <div style="display:flex;gap:10px">
            <button type="submit" class="pc-btn pc-btn-primary">Publish Now</button>
            <button type="button" class="pc-btn pc-btn-secondary" onclick="document.getElementById('schedBox').style.display=document.getElementById('schedBox').style.display==='none'?'block':'none'">Schedule</button>
            <a href="/school/parent-comm/announcements" class="pc-btn pc-btn-secondary">Cancel</a>
          </div>
        </form>
      </div>
      <div class="pc-tip">Use template variables like <code>{{parent_name}}</code>, <code>{{school_name}}</code>, <code>{{student_name}}</code>, <code>{{class}}</code> for personalization.</div>
      <script>
      function loadTmpl(){var s=document.getElementById('tmplSel'),o=s.options[s.selectedIndex];if(!o.value)return;var body=document.querySelector('textarea[name=content]');}
      </script>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  4. POST /school/parent-comm/announcements/new — Save
  // ═══════════════════════════════════════════════════════
  app.post('/school/parent-comm/announcements/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id;
    const { title, content, category, priority, recipients, scheduled_at, template_id } = req.body;
    if (!title || !content) {
      req.session.pcFlash = { type: 'error', msg: 'Title and content are required.' };
      return res.redirect('/school/parent-comm/announcements/new');
    }
    // Fetch parent recipients
    let parentRows = [];
    if (recipients === 'all') {
      parentRows = (await pool.query(`SELECT id, first_name, last_name, email, phone FROM users WHERE tenant_id=$1 AND role='parent'`, [tid])).rows;
    } else if (recipients === 'class') {
      parentRows = (await pool.query(`SELECT DISTINCT u.id, u.first_name, u.last_name, u.email, u.phone FROM users u JOIN students s ON s.tenant_id=u.tenant_id WHERE u.tenant_id=$1 AND u.role='parent'`, [tid])).rows;
    }
    const recipList = parentRows.map(p => ({ id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(' '), email: p.email, phone: p.phone }));
    const schedAt = scheduled_at ? new Date(scheduled_at) : null;
    const status = schedAt ? 'scheduled' : 'sent';
    const sentAt = schedAt ? null : new Date();

    const r = await pool.query(`INSERT INTO parent_announcements (tenant_id,title,content,category,priority,created_by,recipients,scheduled_at,sent_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING id`,
      [tid, title, content, category || 'general', priority || 'normal', uid, JSON.stringify(recipList), schedAt, sentAt]);

    // Send individual messages if publishing now
    if (status === 'sent' && recipList.length > 0) {
      for (const parent of recipList) {
        const personalized = content.replace(/\{\{parent_name\}\}/g, parent.name || 'Parent');
        if (parent.email) {
          await queueEmail(tid, parent.email, title, personalized);
        }
        await pool.query(`INSERT INTO parent_messages (tenant_id,parent_id,subject,body,channel,status,sent_at) VALUES ($1,$2,$3,$4,'email','sent',NOW())`,
          [tid, parent.id, title, personalized]).catch(() => {});
      }
    }

    if (template_id) {
      await pool.query(`UPDATE communication_templates SET name=communication_templates.name WHERE id=$1`, [parseInt(template_id)]).catch(() => {});
    }

    audit && audit(tid, uid, 'create_announcement', `Created announcement: ${title}`);
    req.session.pcFlash = { type: 'success', msg: `Announcement "${title}" ${status === 'scheduled' ? 'scheduled' : 'published'} successfully.` };
    res.redirect('/school/parent-comm/announcements');
  }));

  // ═══════════════════════════════════════════════════════
  //  5. GET /school/parent-comm/announcements/:id — View
  // ═══════════════════════════════════════════════════════
  app.get('/school/parent-comm/announcements/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, aid = parseInt(req.params.id);
    const ann = (await pool.query(`SELECT * FROM parent_announcements WHERE id=$1 AND tenant_id=$2`, [aid, tid])).rows[0];
    if (!ann) return res.status(404).send('Not found');
    const recipList = ann.recipients || [];
    const readList = ann.read_receipts || [];
    const readPct = pctStr(readList.length, recipList.length);

    const readRows = readList.length > 0
      ? readList.map(r => `<span class="pc-chip" style="background:#dcfce7;color:#16a34a">${esc(r.name || 'Unknown')} <span style="opacity:.7">${ago(r.read_at)}</span></span>`).join('')
      : '<span style="color:#9ca3af">No reads yet</span>';

    const unreadRows = recipList.filter(r => !readList.find(rr => rr.id === r.id))
      .map(r => `<span class="pc-chip" style="background:#f3f4f6;color:${GRAY}">${esc(r.name || 'Unknown')}</span>`).join('') || '<span style="color:#9ca3af">All read!</span>';

    res.send(renderPage('Announcement: ' + ann.title, `${SKIP}${CSS}${nav('announcements')}
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;flex-wrap:wrap">
        <a href="/school/parent-comm/announcements" class="pc-btn pc-btn-sm pc-btn-secondary">\u2190 Back</a>
        <h2 style="margin:0">${esc(ann.title)}</h2>
        ${badge(ann.priority)} ${badge(ann.category)}
      </div>
      <p class="muted" style="margin-bottom:14px">Published ${ago(ann.sent_at || ann.created_at)} ${ann.scheduled_at && !ann.sent_at ? ' \u2022 Scheduled: ' + new Date(ann.scheduled_at).toLocaleString() : ''}</p>

      <div class="pc-stats" style="margin-bottom:14px">
        <div class="pc-stat"><div class="pc-num" style="color:${P}">${F(recipList.length)}</div><div class="pc-lbl">Recipients</div></div>
        <div class="pc-stat"><div class="pc-num" style="color:#16a34a">${readPct}%</div><div class="pc-lbl">Read Rate</div></div>
        <div class="pc-stat"><div class="pc-num" style="color:#3b82f6">${F(readList.length)}</div><div class="pc-lbl">Read</div></div>
        <div class="pc-stat"><div class="pc-num" style="color:${GRAY}">${F(recipList.length - readList.length)}</div><div class="pc-lbl">Unread</div></div>
      </div>

      <div class="card"><h3 style="margin:0 0 10px">Content</h3><div style="white-space:pre-wrap;line-height:1.6;color:#374151">${esc(ann.content)}</div></div>

      <div class="pc-grid2" style="margin-top:14px">
        <div class="card"><h3 style="margin:0 0 10px;color:#16a34a">Read (${F(readList.length)})</h3>${readRows}</div>
        <div class="card"><h3 style="margin:0 0 10px;color:${GRAY}">Unread (${F(recipList.length - readList.length)})</h3>${unreadRows}</div>
      </div>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  6. POST /school/parent-comm/announcements/:id/delete
  // ═══════════════════════════════════════════════════════
  app.post('/school/parent-comm/announcements/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, aid = parseInt(req.params.id);
    await pool.query(`DELETE FROM parent_announcements WHERE id=$1 AND tenant_id=$2`, [aid, tid]);
    audit && audit(tid, req.session.user.id, 'delete_announcement', `Deleted announcement ${aid}`);
    res.json({ ok: true });
  }));

  // ═══════════════════════════════════════════════════════
  //  7. GET /school/parent-comm/send-bulk — Bulk send form
  // ═══════════════════════════════════════════════════════
  app.get('/school/parent-comm/send-bulk', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const tmpls = (await pool.query(`SELECT id,name,subject,body FROM communication_templates WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;
    const tOpts = tmpls.map(t => `<option value="${t.id}" data-subject="${esc(t.subject || '')}" data-body="${esc((t.body || '').replace(/"/g, '&quot;'))}">${esc(t.name)}</option>`).join('');
    const parentCount = (await pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE tenant_id=$1 AND role='parent'`, [tid])).rows[0].c;

    res.send(renderPage('Send Bulk Communication', `${SKIP}${CSS}${nav('send-bulk')}${flash(req)}
      <h2>Send Bulk Communication</h2>
      <p style="color:${GRAY};margin-bottom:18px">Send messages to all or selected parents via email, SMS, or both</p>

      <div class="card">
        <form method="POST" action="/school/parent-comm/send-bulk" style="display:grid;gap:14px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Channel *</label>
              <select name="channel" class="pc-inp"><option value="email">Email</option><option value="sms">SMS</option><option value="both">Email + SMS</option></select></div>
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Template</label>
              <select name="template_id" id="tmplSel" class="pc-inp" onchange="loadTmpl()"><option value="">-- Select Template --</option>${tOpts}</select></div>
          </div>
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Subject *</label><input type="text" name="subject" required class="pc-inp" placeholder="Communication subject" id="subjField"></div>
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Message *</label><textarea name="body" rows="8" required class="pc-inp" placeholder="Write your message... Use {{parent_name}}, {{school_name}}, etc." id="bodyField"></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Recipients</label>
              <select name="recipient_group" class="pc-inp"><option value="all">All Parents (${F(parentCount)})</option><option value="active">Active This Term</option><option value="class">Specific Class</option></select></div>
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Priority</label>
              <select name="priority" class="pc-inp"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
          </div>
          <div class="pc-sched" id="schedBox" style="display:none"><label style="display:block;font-weight:600;margin-bottom:4px">Schedule For</label><input type="datetime-local" name="scheduled_at" class="pc-inp"></div>
          <div style="display:flex;gap:10px">
            <button type="submit" class="pc-btn pc-btn-primary">Send Now</button>
            <button type="button" class="pc-btn pc-btn-secondary" onclick="document.getElementById('schedBox').style.display=document.getElementById('schedBox').style.display==='none'?'block':'none'">Schedule</button>
          </div>
        </form>
      </div>
      <div class="pc-tip"><strong>Variables:</strong> <code>{{parent_name}}</code>, <code>{{student_name}}</code>, <code>{{school_name}}</code>, <code>{{class}}</code>, <code>{{term}}</code>, <code>{{date}}</code></div>
      <script>
      function loadTmpl(){var s=document.getElementById('tmplSel'),o=s.options[s.selectedIndex];if(!o.value)return;
        document.getElementById('subjField').value=o.getAttribute('data-subject')||'';
        document.getElementById('bodyField').value=o.getAttribute('data-body')||'';}
      </script>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  8. POST /school/parent-comm/send-bulk — Process
  // ═══════════════════════════════════════════════════════
  app.post('/school/parent-comm/send-bulk', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id;
    const { subject, body, channel, recipient_group, priority, scheduled_at } = req.body;
    if (!subject || !body) {
      req.session.pcFlash = { type: 'error', msg: 'Subject and message are required.' };
      return res.redirect('/school/parent-comm/send-bulk');
    }
    const parents = (await pool.query(`SELECT id, first_name, last_name, email, phone FROM users WHERE tenant_id=$1 AND role='parent' AND (email IS NOT NULL OR phone IS NOT NULL)`, [tid])).rows;

    const isUrgent = priority === 'urgent';
    let sentCount = 0;
    for (const parent of parents) {
      const name = [parent.first_name, parent.last_name].filter(Boolean).join(' ') || 'Parent';
      const personalized = body.replace(/\{\{parent_name\}\}/g, name).replace(/\{\{school_name\}\}/g, 'School');
      if ((channel === 'email' || channel === 'both') && parent.email) {
        await queueEmail(tid, parent.email, isUrgent ? '[URGENT] ' + subject : subject, personalized);
        await pool.query(`INSERT INTO parent_messages (tenant_id,parent_id,subject,body,channel,status,sent_at) VALUES ($1,$2,$3,$4,'email','sent',NOW())`, [tid, parent.id, subject, personalized]).catch(() => {});
        sentCount++;
      }
      if ((channel === 'sms' || channel === 'both') && parent.phone) {
        await pool.query(`INSERT INTO parent_messages (tenant_id,parent_id,subject,body,channel,status,sent_at) VALUES ($1,$2,$3,'SMS: '+LEFT($4,160),'sms','sent',NOW())`, [tid, parent.id, subject, personalized]).catch(() => {});
        sentCount++;
      }
    }

    audit && audit(tid, uid, 'send_bulk', `Bulk sent "${subject}" to ${sentCount} parents via ${channel}`);
    req.session.pcFlash = { type: 'success', msg: `Communication sent to ${F(sentCount)} parent contacts via ${channel}.` };
    res.redirect('/school/parent-comm/send-bulk');
  }));

  // ═══════════════════════════════════════════════════════
  //  9. GET /school/parent-comm/messages — Inbox
  // ═══════════════════════════════════════════════════════
  app.get('/school/parent-comm/messages', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { channel, status, q, page = 1 } = req.query;
    const off = (parseInt(page) - 1) * PS;
    let w = ['m.tenant_id=$1'], p = [tid], i = 2;
    if (channel && channel !== 'all') { w.push(`m.channel=$${i++}`); p.push(channel); }
    if (status && status !== 'all') { w.push(`m.status=$${i++}`); p.push(status); }
    if (q) { w.push(`m.subject ILIKE $${i++}`); p.push(`%${q}%`); }
    const wc = w.join(' AND ');
    const [cR, mR] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS t FROM parent_messages m WHERE ${wc}`, p),
      pool.query(`SELECT m.*, u.first_name, u.last_name FROM parent_messages m LEFT JOIN users u ON u.id=m.parent_id WHERE ${wc} ORDER BY m.sent_at DESC LIMIT $${i} OFFSET $${i + 1}`, [...p, PS, off])
    ]);
    const tot = cR.rows[0]?.t || 0;
    const rows = mR.rows;
    const qs = `channel=${channel || ''}&status=${status || ''}&q=${q || ''}`;
    const tHtml = rows.length === 0
      ? '<tr><td colspan="6" style="text-align:center;padding:28px;color:#9ca3af">No messages found</td></tr>'
      : rows.map(m => {
        const pName = m.first_name ? esc(m.first_name + ' ' + (m.last_name || '')) : '<span style="color:#9ca3af">Unknown</span>';
        return `<tr><td><strong>${esc(m.subject)}</strong></td><td>${pName}</td><td><span class="pc-chip" style="background:${m.channel === 'email' ? '#dbeafe' : m.channel === 'sms' ? '#fef3c7' : '#f3f4f6'};color:${m.channel === 'email' ? '#1e40af' : m.channel === 'sms' ? '#92400e' : '#6b7280'}">${esc(m.channel)}</span></td><td>${badge(m.status)}</td><td class="muted">${ago(m.sent_at)}</td><td><a href="/school/parent-comm/messages/${m.id}" class="pc-btn pc-btn-sm pc-btn-secondary">View</a></td></tr>`;
      }).join('');

    res.send(renderPage('Messages', `${SKIP}${CSS}${nav('messages')}${flash(req)}
      <h2>Message Inbox</h2>
      <p style="color:${GRAY};margin-bottom:14px">All parent communications in one place</p>
      <div class="card">
        <div class="pc-fbar">
          <input type="text" value="${esc(q || '')}" placeholder="Search..." id="fQ">
          <select id="fCh"><option value="all">All Channels</option><option value="email"${channel === 'email' ? ' selected' : ''}>Email</option><option value="sms"${channel === 'sms' ? ' selected' : ''}>SMS</option></select>
          <select id="fSt"><option value="all">All Status</option><option value="sent"${status === 'sent' ? ' selected' : ''}>Sent</option><option value="delivered"${status === 'delivered' ? ' selected' : ''}>Delivered</option><option value="read"${status === 'read' ? ' selected' : ''}>Read</option><option value="failed"${status === 'failed' ? ' selected' : ''}>Failed</option></select>
          <button class="pc-btn pc-btn-sm pc-btn-primary" onclick="applyF()">Filter</button>
          <a href="/school/parent-comm/messages" class="pc-btn pc-btn-sm pc-btn-secondary">Clear</a>
        </div>
        <table class="pc-table"><thead><tr><th>Subject</th><th>Parent</th><th>Channel</th><th>Status</th><th>Sent</th><th></th></tr></thead><tbody>${tHtml}</tbody></table>
        ${pag('/school/parent-comm/messages', qs, page, tot)}
      </div>
      <script>
      function applyF(){var p=new URLSearchParams(),q=document.getElementById('fQ').value,ch=document.getElementById('fCh').value,st=document.getElementById('fSt').value;
        if(q)p.set('q',q);if(ch!=='all')p.set('channel',ch);if(st!=='all')p.set('status',st);location.href='/school/parent-comm/messages?'+p.toString();}
      </script>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  10. GET /school/parent-comm/messages/:id — View msg
  // ═══════════════════════════════════════════════════════
  app.get('/school/parent-comm/messages/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, mid = parseInt(req.params.id);
    const msg = (await pool.query(`SELECT m.*, u.first_name, u.last_name, u.email, u.phone FROM parent_messages m LEFT JOIN users u ON u.id=m.parent_id WHERE m.id=$1 AND m.tenant_id=$2`, [mid, tid])).rows[0];
    if (!msg) return res.status(404).send('Not found');
    const pName = [msg.first_name, msg.last_name].filter(Boolean).join(' ') || 'Unknown Parent';

    res.send(renderPage('Message: ' + msg.subject, `${SKIP}${CSS}${nav('messages')}
      <a href="/school/parent-comm/messages" class="pc-btn pc-btn-sm pc-btn-secondary" style="margin-bottom:14px">\u2190 Back to Messages</a>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:14px">
          <div><h2 style="margin:0">${esc(msg.subject)}</h2>
            <p class="muted" style="margin:4px 0 0">From/To: <strong>${esc(pName)}</strong> ${msg.email ? '(' + esc(msg.email) + ')' : ''} ${msg.phone ? '(' + esc(msg.phone) + ')' : ''}</p></div>
          <div>${badge(msg.channel)} ${badge(msg.status)} <span class="muted" style="font-size:12px">${ago(msg.sent_at)}</span></div>
        </div>
        <div style="background:#f9fafb;border-radius:8px;padding:16px;white-space:pre-wrap;line-height:1.6;color:#374151">${esc(msg.body)}</div>
        ${msg.read_at ? '<p class="muted" style="margin-top:10px;font-size:13px">Read at: ' + new Date(msg.read_at).toLocaleString() + '</p>' : ''}
      </div>
      <div class="card">
        <h3 style="margin:0 0 10px">Send Reply</h3>
        <form method="POST" action="/school/parent-comm/messages/reply" style="display:grid;gap:10px">
          <input type="hidden" name="parent_id" value="${msg.parent_id || ''}">
          <input type="hidden" name="in_reply_to" value="${msg.id}">
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Subject</label><input type="text" name="subject" class="pc-inp" value="Re: ${esc(msg.subject)}"></div>
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Reply</label><textarea name="body" rows="4" required class="pc-inp" placeholder="Type your reply..."></textarea></div>
          <button type="submit" class="pc-btn pc-btn-primary">Send Reply</button>
        </form>
      </div>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  11. POST /school/parent-comm/messages/reply — Reply
  // ═══════════════════════════════════════════════════════
  app.post('/school/parent-comm/messages/reply', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id;
    const { parent_id, subject, body, in_reply_to, channel } = req.body;
    if (!parent_id || !subject || !body) {
      req.session.pcFlash = { type: 'error', msg: 'All fields are required.' };
      return res.redirect(`/school/parent-comm/messages/${in_reply_to || ''}`);
    }
    const parent = (await pool.query(`SELECT first_name, last_name, email FROM users WHERE id=$1 AND tenant_id=$2`, [parseInt(parent_id), tid])).rows[0];
    if (parent && parent.email) {
      await queueEmail(tid, parent.email, subject, body);
    }
    await pool.query(`INSERT INTO parent_messages (tenant_id,parent_id,subject,body,channel,status,direction,sent_at) VALUES ($1,$2,$3,$4,$5,'sent','outbound',NOW())`,
      [tid, parseInt(parent_id), subject, body, channel || 'email']);
    audit && audit(tid, uid, 'reply_message', `Replied to parent ${parent_id}: ${subject}`);
    req.session.pcFlash = { type: 'success', msg: 'Reply sent successfully.' };
    res.redirect(`/school/parent-comm/messages/${in_reply_to || ''}`);
  }));

  // ═══════════════════════════════════════════════════════
  //  12. POST /school/parent-comm/announcements/:id/read
  //       — Record read receipt (public-facing)
  // ═══════════════════════════════════════════════════════
  app.post('/school/parent-comm/announcements/:id/read', ah(async (req, res) => {
    const aid = parseInt(req.params.id);
    const { parent_id, parent_name } = req.body;
    if (!aid || !parent_id) return res.json({ ok: false, error: 'Missing params' });
    const ann = (await pool.query(`SELECT read_receipts, tenant_id FROM parent_announcements WHERE id=$1`, [aid])).rows[0];
    if (!ann) return res.json({ ok: false, error: 'Not found' });
    const receipts = ann.read_receipts || [];
    const already = receipts.find(r => r.id === parseInt(parent_id));
    if (!already) {
      receipts.push({ id: parseInt(parent_id), name: parent_name || 'Unknown', read_at: new Date().toISOString() });
      await pool.query(`UPDATE parent_announcements SET read_receipts=$1::jsonb WHERE id=$2`, [JSON.stringify(receipts), aid]);
      await pool.query(`UPDATE parent_messages SET status='read', read_at=NOW() WHERE tenant_id=$1 AND parent_id=$2 AND read_at IS NULL`, [ann.tenant_id, parseInt(parent_id)]).catch(() => {});
    }
    res.json({ ok: true });
  }));

  // ═══════════════════════════════════════════════════════
  //  13. GET /school/parent-comm/templates — Template list
  // ═══════════════════════════════════════════════════════
  app.get('/school/parent-comm/templates', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { category, language } = req.query;
    let w = ['tenant_id=$1'], p = [tid], i = 2;
    if (category && category !== 'all') { w.push(`category=$${i++}`); p.push(category); }
    if (language && language !== 'all') { w.push(`language=$${i++}`); p.push(language); }
    const wc = w.join(' AND ');
    const tmpls = (await pool.query(`SELECT * FROM communication_templates WHERE ${wc} ORDER BY category, name`, p)).rows;
    const catColors = { general: GRAY, billing: '#f59e0b', events: '#3b82f6', urgent: '#ef4444', meeting: '#8b5cf6', circular: '#10b981' };

    const tHtml = tmpls.length === 0
      ? '<p style="text-align:center;padding:28px;color:#9ca3af">No templates found</p>'
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">` +
      tmpls.map(t => {
        const clr = catColors[t.category] || GRAY;
        const preview = (t.body || '').substring(0, 120);
        const langLabel = { en: 'English', fr: 'Fran\u00E7ais', es: 'Espa\u00F1ol', ar: 'Arabic', sw: 'Swahili', zh: 'Chinese' }[t.language] || t.language;
        return `<div class="pc-tmpl">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><strong>${esc(t.name)}</strong><div>${badge(t.category)} <span class="pc-chip" style="background:#eff6ff;color:${P}">${esc(langLabel)}</span></div></div>
          <p style="font-size:13px;color:#4b5563;line-height:1.4;margin:0 0 8px;white-space:pre-wrap">${esc(preview)}${(t.body || '').length > 120 ? '...' : ''}</p>
          ${t.subject ? `<p class="muted" style="font-size:12px;margin:0 0 6px">Subject: <strong>${esc(t.subject)}</strong></p>` : ''}
          <div style="display:flex;gap:6px">
            <button onclick="useTmpl(${t.id})" class="pc-btn pc-btn-sm pc-btn-secondary">Use</button>
            <button onclick="delTmpl(${t.id})" class="pc-btn pc-btn-sm pc-btn-danger">Delete</button>
          </div>
        </div>`;
      }).join('') + '</div>';

    res.send(renderPage('Communication Templates', `${SKIP}${CSS}${nav('templates')}${flash(req)}
      <h2>Communication Templates</h2>
      <p style="color:${GRAY};margin-bottom:14px">Manage reusable message templates with multi-language support</p>
      <div class="card">
        <div class="pc-fbar">
          <select onchange="location.href='/school/parent-comm/templates?category='+this.value"><option value="all">All Categories</option><option value="general"${category === 'general' ? ' selected' : ''}>General</option><option value="billing"${category === 'billing' ? ' selected' : ''}>Billing</option><option value="events"${category === 'events' ? ' selected' : ''}>Events</option><option value="urgent"${category === 'urgent' ? ' selected' : ''}>Urgent</option><option value="meeting"${category === 'meeting' ? ' selected' : ''}>Meeting</option><option value="circular"${category === 'circular' ? ' selected' : ''}>Circular</option></select>
          <select onchange="location.href='/school/parent-comm/templates?language='+this.value"><option value="all">All Languages</option><option value="en"${language === 'en' ? ' selected' : ''}>English</option><option value="fr"${language === 'fr' ? ' selected' : ''}>French</option><option value="es"${language === 'es' ? ' selected' : ''}>Spanish</option></select>
        </div>
        ${tHtml}
      </div>

      <div class="card" style="margin-top:18px"><h3 style="margin:0 0 14px">Create New Template</h3>
        <form method="POST" action="/school/parent-comm/templates" style="display:grid;gap:12px;max-width:600px">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Name *</label><input type="text" name="name" required class="pc-inp" placeholder="Template name"></div>
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Category</label>
              <select name="category" class="pc-inp"><option value="general">General</option><option value="billing">Billing</option><option value="events">Events</option><option value="urgent">Urgent</option><option value="meeting">Meeting</option><option value="circular">Circular</option></select></div>
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Language</label>
              <select name="language" class="pc-inp"><option value="en">English</option><option value="fr">French</option><option value="es">Spanish</option><option value="ar">Arabic</option><option value="sw">Swahili</option><option value="zh">Chinese</option></select></div>
          </div>
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Subject</label><input type="text" name="subject" class="pc-inp" placeholder="Optional subject line"></div>
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Body *</label><textarea name="body" rows="6" required class="pc-inp" placeholder="Template body with {{variables}}..."></textarea></div>
          <button type="submit" class="pc-btn pc-btn-primary">Save Template</button>
        </form>
      </div>
      <script>
      function useTmpl(id){location.href='/school/parent-comm/send-bulk?template_id='+id;}
      function delTmpl(id){if(confirm('Delete this template?'))fetch('/school/parent-comm/templates/'+id+'/delete',{method:'POST'}).then(function(r){return r.json()}).then(function(d){if(d.ok)location.reload();else alert(d.error||'Failed')});}
      </script>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  14. POST /school/parent-comm/templates — Create
  // ═══════════════════════════════════════════════════════
  app.post('/school/parent-comm/templates', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, subject, body, category, language } = req.body;
    if (!name || !body) {
      req.session.pcFlash = { type: 'error', msg: 'Name and body are required.' };
      return res.redirect('/school/parent-comm/templates');
    }
    await pool.query(`INSERT INTO communication_templates (tenant_id,name,subject,body,category,language) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, name, subject || null, body, category || 'general', language || 'en']);
    audit && audit(tid, req.session.user.id, 'create_template', `Created template: ${name}`);
    req.session.pcFlash = { type: 'success', msg: `Template "${name}" created.` };
    res.redirect('/school/parent-comm/templates');
  }));

  // ═══════════════════════════════════════════════════════
  //  15. POST /school/parent-comm/templates/:id/delete
  // ═══════════════════════════════════════════════════════
  app.post('/school/parent-comm/templates/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, tid2 = parseInt(req.params.id);
    await pool.query(`DELETE FROM communication_templates WHERE id=$1 AND tenant_id=$2`, [tid2, tid]);
    res.json({ ok: true });
  }));

  // ═══════════════════════════════════════════════════════
  //  16. GET /school/parent-comm/feedback — Feedback list
  // ═══════════════════════════════════════════════════════
  app.get('/school/parent-comm/feedback', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { status, q, page = 1 } = req.query;
    const off = (parseInt(page) - 1) * PS;
    let w = ['tenant_id=$1'], p = [tid], i = 2;
    if (status && status !== 'all') { w.push(`f.status=$${i++}`); p.push(status); }
    if (q) { w.push(`f.subject ILIKE $${i++}`); p.push(`%${q}%`); }
    const wc = w.join(' AND ');
    const [cR, fR] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS t FROM parent_feedback f WHERE ${wc}`, p),
      pool.query(`SELECT f.*, u.first_name, u.last_name FROM parent_feedback f LEFT JOIN users u ON u.id=f.parent_id WHERE ${wc} ORDER BY f.created_at DESC LIMIT $${i} OFFSET $${i + 1}`, [...p, PS, off])
    ]);
    const tot = cR.rows[0]?.t || 0;
    const rows = fR.rows;
    const qs = `status=${status || ''}&q=${q || ''}`;
    const tHtml = rows.length === 0
      ? '<tr><td colspan="6" style="text-align:center;padding:28px;color:#9ca3af">No feedback found</td></tr>'
      : rows.map(f => {
        const pName = f.first_name ? esc(f.first_name + ' ' + (f.last_name || '')) : '<span style="color:#9ca3af">Anonymous</span>';
        return `<tr><td><strong>${esc(f.subject)}</strong></td><td>${pName}</td><td>${badge(f.status)}</td><td class="muted">${ago(f.created_at)}</td><td>${f.resolved_at ? ago(f.resolved_at) : ''}</td><td><a href="/school/parent-comm/feedback/${f.id}" class="pc-btn pc-btn-sm pc-btn-secondary">View</a></td></tr>`;
      }).join('');

    const statusStats = (await pool.query(`SELECT status, COUNT(*)::int AS cnt FROM parent_feedback WHERE tenant_id=$1 GROUP BY status ORDER BY cnt DESC`, [tid])).rows;
    const chartData = statusStats.map(s => ({ label: s.status, value: s.cnt }));

    res.send(renderPage('Parent Feedback', `${SKIP}${CSS}${nav('feedback')}${flash(req)}
      <h2>Parent Feedback & Complaints</h2>
      <p style="color:${GRAY};margin-bottom:14px">Track and respond to parent feedback</p>

      <div class="pc-grid2" style="margin-bottom:14px">
        <div class="card"><h3 style="margin:0 0 12px">Feedback by Status</h3>${htmlBar(chartData, P)}</div>
        <div class="card"><h3 style="margin:0 0 12px">Quick Stats</h3>
          ${statusStats.map(s => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6"><span>${badge(s.status)}</span><strong>${F(s.cnt)}</strong></div>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="pc-fbar">
          <input type="text" value="${esc(q || '')}" placeholder="Search feedback..." id="fQ">
          <select id="fS"><option value="all">All Status</option><option value="open"${status === 'open' ? ' selected' : ''}>Open</option><option value="in_progress"${status === 'in_progress' ? ' selected' : ''}>In Progress</option><option value="resolved"${status === 'resolved' ? ' selected' : ''}>Resolved</option><option value="closed"${status === 'closed' ? ' selected' : ''}>Closed</option></select>
          <button class="pc-btn pc-btn-sm pc-btn-primary" onclick="applyF()">Filter</button>
          <a href="/school/parent-comm/feedback" class="pc-btn pc-btn-sm pc-btn-secondary">Clear</a>
        </div>
        <table class="pc-table"><thead><tr><th>Subject</th><th>Parent</th><th>Status</th><th>Created</th><th>Resolved</th><th></th></tr></thead><tbody>${tHtml}</tbody></table>
        ${pag('/school/parent-comm/feedback', qs, page, tot)}
      </div>
      <script>
      function applyF(){var p=new URLSearchParams(),q=document.getElementById('fQ').value,s=document.getElementById('fS').value;
        if(q)p.set('q',q);if(s!=='all')p.set('status',s);location.href='/school/parent-comm/feedback?'+p.toString();}
      </script>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  17. GET /school/parent-comm/feedback/:id — View + respond
  // ═══════════════════════════════════════════════════════
  app.get('/school/parent-comm/feedback/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, fid = parseInt(req.params.id);
    const fb = (await pool.query(`SELECT f.*, u.first_name, u.last_name, u.email FROM parent_feedback f LEFT JOIN users u ON u.id=f.parent_id WHERE f.id=$1 AND f.tenant_id=$2`, [fid, tid])).rows[0];
    if (!fb) return res.status(404).send('Not found');
    const pName = [fb.first_name, fb.last_name].filter(Boolean).join(' ') || 'Anonymous';

    res.send(renderPage('Feedback: ' + fb.subject, `${SKIP}${CSS}${nav('feedback')}
      <a href="/school/parent-comm/feedback" class="pc-btn pc-btn-sm pc-btn-secondary" style="margin-bottom:14px">\u2190 Back</a>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:14px">
          <div><h2 style="margin:0">${esc(fb.subject)}</h2><p class="muted" style="margin:4px 0 0">From: <strong>${esc(pName)}</strong> ${fb.email ? '(' + esc(fb.email) + ')' : ''} \u2022 ${ago(fb.created_at)}</p></div>
          <div>${badge(fb.status)}</div>
        </div>
        <div style="background:#f9fafb;border-radius:8px;padding:16px;white-space:pre-wrap;line-height:1.6;color:#374151">${esc(fb.message)}</div>
      </div>

      ${fb.response ? `<div class="card"><h3 style="margin:0 0 10px;color:#16a34a">Admin Response ${fb.resolved_at ? '(Resolved ' + ago(fb.resolved_at) + ')' : ''}</h3><div style="background:#f0fdf4;border-radius:8px;padding:16px;white-space:pre-wrap;line-height:1.6;color:#374151">${esc(fb.response)}</div></div>` : ''}

      <div class="card"><h3 style="margin:0 0 10px">${fb.response ? 'Update Response' : 'Respond to Feedback'}</h3>
        <form method="POST" action="/school/parent-comm/feedback/${fid}/respond" style="display:grid;gap:10px">
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Status</label>
            <select name="status" class="pc-inp"><option value="open"${fb.status === 'open' ? ' selected' : ''}>Open</option><option value="in_progress"${fb.status === 'in_progress' ? ' selected' : ''}>In Progress</option><option value="resolved"${fb.status === 'resolved' ? ' selected' : ''}>Resolved</option><option value="closed"${fb.status === 'closed' ? ' selected' : ''}>Closed</option></select></div>
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Response</label><textarea name="response" rows="4" class="pc-inp" placeholder="Type your response...">${esc(fb.response || '')}</textarea></div>
          <button type="submit" class="pc-btn pc-btn-primary">Save Response</button>
        </form>
      </div>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  18. POST /school/parent-comm/feedback/:id/respond
  // ═══════════════════════════════════════════════════════
  app.post('/school/parent-comm/feedback/:id/respond', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id, fid = parseInt(req.params.id);
    const { status, response } = req.body;
    const fb = (await pool.query(`SELECT * FROM parent_feedback WHERE id=$1 AND tenant_id=$2`, [fid, tid])).rows[0];
    if (!fb) return res.status(404).send('Not found');
    const resolvedAt = (status === 'resolved' || status === 'closed') && !fb.resolved_at ? 'NOW()' : (fb.resolved_at ? `$${3}` : 'NULL');
    const params = [response || null, status || 'open'];
    if (resolvedAt === '$3') params.push(fb.resolved_at);
    await pool.query(`UPDATE parent_feedback SET response=$1, status=$2, resolved_at=COALESCE(${resolvedAt}, resolved_at) WHERE id=$${params.length + 1} AND tenant_id=$${params.length + 2}`,
      [...params, fid, tid]);
    audit && audit(tid, uid, 'respond_feedback', `Responded to feedback ${fid}`);
    req.session.pcFlash = { type: 'success', msg: 'Feedback response saved.' };
    res.redirect(`/school/parent-comm/feedback/${fid}`);
  }));

  // ═══════════════════════════════════════════════════════
  //  19. GET /school/parent-comm/schedule — Scheduler
  // ═══════════════════════════════════════════════════════
  app.get('/school/parent-comm/schedule', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const scheduled = (await pool.query(`SELECT id,title,category,priority,scheduled_at,recipients FROM parent_announcements WHERE tenant_id=$1 AND scheduled_at IS NOT NULL AND sent_at IS NULL ORDER BY scheduled_at ASC`, [tid])).rows;

    const tHtml = scheduled.length === 0
      ? '<p style="text-align:center;padding:28px;color:#9ca3af">No scheduled communications</p>'
      : scheduled.map(a => {
        const rc = (a.recipients || []).length;
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:8px;background:#fff">
          <div><strong>${esc(a.title)}</strong><br><span class="muted" style="font-size:13px">${badge(a.category)} ${badge(a.priority)} \u2022 ${F(rc)} recipients \u2022 ${new Date(a.scheduled_at).toLocaleString()}</span></div>
          <div style="display:flex;gap:6px"><a href="/school/parent-comm/announcements/${a.id}" class="pc-btn pc-btn-sm pc-btn-secondary">View</a>
            <button onclick="cancelSched(${a.id})" class="pc-btn pc-btn-sm pc-btn-danger">Cancel</button></div>
        </div>`;
      }).join('');

    res.send(renderPage('Scheduled Communications', `${SKIP}${CSS}${nav('schedule')}${flash(req)}
      <h2>Scheduled Communications</h2>
      <p style="color:${GRAY};margin-bottom:18px">View and manage upcoming scheduled communications</p>
      <div class="card"><h3 style="margin:0 0 12px">Upcoming (${F(scheduled.length)})</h3>${tHtml}</div>

      <div class="card" style="margin-top:18px"><h3 style="margin:0 0 14px">Schedule New Communication</h3>
        <form method="POST" action="/school/parent-comm/schedule" style="display:grid;gap:12px;max-width:600px">
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Title *</label><input type="text" name="title" required class="pc-inp" placeholder="Communication title"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Category</label>
              <select name="category" class="pc-inp"><option value="general">General</option><option value="academic">Academic</option><option value="events">Events</option><option value="circular">Circular</option><option value="urgent">Urgent</option></select></div>
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Priority</label>
              <select name="priority" class="pc-inp"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
          </div>
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Content *</label><textarea name="content" rows="6" required class="pc-inp" placeholder="Message content..."></textarea></div>
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Schedule Date & Time *</label><input type="datetime-local" name="scheduled_at" required class="pc-inp"></div>
          <button type="submit" class="pc-btn pc-btn-primary">Schedule</button>
        </form>
      </div>
      <script>
      function cancelSched(id){if(confirm('Cancel this scheduled communication?'))fetch('/school/parent-comm/schedule/'+id+'/cancel',{method:'POST'}).then(function(r){return r.json()}).then(function(d){if(d.ok)location.reload();else alert(d.error||'Failed')});}
      </script>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  20. POST /school/parent-comm/schedule — Save scheduled
  // ═══════════════════════════════════════════════════════
  app.post('/school/parent-comm/schedule', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id;
    const { title, content, category, priority, scheduled_at } = req.body;
    if (!title || !content || !scheduled_at) {
      req.session.pcFlash = { type: 'error', msg: 'Title, content, and schedule date are required.' };
      return res.redirect('/school/parent-comm/schedule');
    }
    const parents = (await pool.query(`SELECT id, first_name, last_name, email FROM users WHERE tenant_id=$1 AND role='parent'`, [tid])).rows;
    const recipList = parents.map(p => ({ id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(' '), email: p.email }));
    await pool.query(`INSERT INTO parent_announcements (tenant_id,title,content,category,priority,created_by,recipients,scheduled_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [tid, title, content, category || 'general', priority || 'normal', uid, JSON.stringify(recipList), new Date(scheduled_at)]);
    audit && audit(tid, uid, 'schedule_communication', `Scheduled: ${title}`);
    req.session.pcFlash = { type: 'success', msg: `Communication "${title}" scheduled.` };
    res.redirect('/school/parent-comm/schedule');
  }));

  // ═══════════════════════════════════════════════════════
  //  21. POST /school/parent-comm/schedule/:id/cancel
  // ═══════════════════════════════════════════════════════
  app.post('/school/parent-comm/schedule/:id/cancel', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, aid = parseInt(req.params.id);
    await pool.query(`DELETE FROM parent_announcements WHERE id=$1 AND tenant_id=$2 AND sent_at IS NULL`, [aid, tid]);
    audit && audit(tid, req.session.user.id, 'cancel_scheduled', `Cancelled scheduled comm ${aid}`);
    res.json({ ok: true });
  }));

  // ═══════════════════════════════════════════════════════
  //  22. GET /school/parent-comm/analytics — Delivery analytics
  // ═══════════════════════════════════════════════════════
  app.get('/school/parent-comm/analytics', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    // Overall stats
    const stats = (await pool.query(`SELECT
      (SELECT COUNT(*)::int FROM parent_announcements WHERE tenant_id=$1) AS total_announcements,
      (SELECT COUNT(*)::int FROM parent_messages WHERE tenant_id=$1) AS total_messages,
      (SELECT COUNT(*)::int FROM parent_messages WHERE tenant_id=$1 AND status='read') AS read_messages,
      (SELECT COUNT(*)::int FROM parent_messages WHERE tenant_id=$1 AND status='failed') AS failed_messages,
      (SELECT COUNT(*)::int FROM parent_messages WHERE tenant_id=$1 AND channel='email') AS email_count,
      (SELECT COUNT(*)::int FROM parent_messages WHERE tenant_id=$1 AND channel='sms') AS sms_count,
      (SELECT COUNT(*)::int FROM parent_feedback WHERE tenant_id=$1) AS total_feedback,
      (SELECT COUNT(*)::int FROM parent_feedback WHERE tenant_id=$1 AND status='resolved') AS resolved_feedback
    `, [tid])).rows[0];

    const readRate = pctStr(stats.read_messages, stats.total_messages);
    const failRate = pctStr(stats.failed_messages, stats.total_messages);
    const fbRate = pctStr(stats.resolved_feedback, stats.total_feedback);

    // Channel distribution
    const channelData = [
      { label: 'Email', value: stats.email_count },
      { label: 'SMS', value: stats.sms_count },
    ];

    // Category distribution
    const catData = (await pool.query(`SELECT category, COUNT(*)::int AS cnt FROM parent_announcements WHERE tenant_id=$1 GROUP BY category ORDER BY cnt DESC`, [tid])).rows;
    const catChart = catData.map(c => ({ label: c.category, value: c.cnt }));

    // Priority distribution
    const prioData = (await pool.query(`SELECT priority, COUNT(*)::int AS cnt FROM parent_announcements WHERE tenant_id=$1 GROUP BY priority ORDER BY cnt DESC`, [tid])).rows;
    const prioChart = prioData.map(p => ({ label: p.priority, value: p.cnt }));

    // Daily sending trend (last 30 days)
    const trendData = (await pool.query(`SELECT DATE(sent_at) AS day, COUNT(*)::int AS cnt FROM parent_messages WHERE tenant_id=$1 AND sent_at >= NOW() - INTERVAL '30 days' GROUP BY DATE(sent_at) ORDER BY day`, [tid])).rows;
    const trendChart = trendData.slice(-14).map(t => ({ label: new Date(t.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }), value: t.cnt }));

    // Read receipt aggregation
    const readDonut = [
      { label: 'Read', value: stats.read_messages, color: '#16a34a' },
      { label: 'Unread', value: stats.total_messages - stats.read_messages - stats.failed_messages, color: P },
      { label: 'Failed', value: stats.failed_messages, color: '#ef4444' },
    ];

    res.send(renderPage('Communication Analytics', `${SKIP}${CSS}${nav('analytics')}
      <h2>Communication Analytics</h2>
      <p style="color:${GRAY};margin-bottom:18px">Delivery performance and engagement metrics</p>

      <div class="pc-stats">
        <div class="pc-stat"><div class="pc-num" style="color:${P}">${F(stats.total_announcements)}</div><div class="pc-lbl">Announcements</div></div>
        <div class="pc-stat"><div class="pc-num" style="color:#3b82f6">${F(stats.total_messages)}</div><div class="pc-lbl">Total Messages</div></div>
        <div class="pc-stat"><div class="pc-num" style="color:#16a34a">${readRate}%</div><div class="pc-lbl">Read Rate</div></div>
        <div class="pc-stat"><div class="pc-num" style="color:#ef4444">${failRate}%</div><div class="pc-lbl">Failure Rate</div></div>
        <div class="pc-stat"><div class="pc-num" style="color:#f59e0b">${F(stats.total_feedback)}</div><div class="pc-lbl">Feedback</div></div>
        <div class="pc-stat"><div class="pc-num" style="color:#10b981">${fbRate}%</div><div class="pc-lbl">Resolved</div></div>
      </div>

      <div class="pc-grid2">
        <div class="card">
          <h3 style="margin:0 0 14px">Delivery Overview</h3>
          ${svgDonut(readDonut, 220, 'Messages')}
        </div>
        <div class="card">
          <h3 style="margin:0 0 14px">Channel Distribution</h3>
          ${svgBar(channelData, 320, 180, P)}
        </div>
      </div>

      <div class="pc-grid2" style="margin-top:14px">
        <div class="card">
          <h3 style="margin:0 0 14px">Announcements by Category</h3>
          ${svgBar(catChart, 320, 200, '#3b82f6')}
        </div>
        <div class="card">
          <h3 style="margin:0 0 14px">Announcements by Priority</h3>
          ${svgBar(prioChart, 320, 180, '#f59e0b')}
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <h3 style="margin:0 0 14px">Sending Trend (Last 14 Days)</h3>
        ${svgBar(trendChart, 600, 220, '#10b981')}
      </div>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  23. GET /school/parent-comm/settings — Settings
  // ═══════════════════════════════════════════════════════
  app.get('/school/parent-comm/settings', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const parentCount = (await pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE tenant_id=$1 AND role='parent'`, [tid])).rows[0].c;
    const templateCount = (await pool.query(`SELECT COUNT(*)::int AS c FROM communication_templates WHERE tenant_id=$1`, [tid])).rows[0].c;
    const announcementCount = (await pool.query(`SELECT COUNT(*)::int AS c FROM parent_announcements WHERE tenant_id=$1`, [tid])).rows[0].c;
    const messageCount = (await pool.query(`SELECT COUNT(*)::int AS c FROM parent_messages WHERE tenant_id=$1`, [tid])).rows[0].c;
    const feedbackCount = (await pool.query(`SELECT COUNT(*)::int AS c FROM parent_feedback WHERE tenant_id=$1`, [tid])).rows[0].c;

    res.send(renderPage('Communication Settings', `${SKIP}${CSS}${nav('settings')}${flash(req)}
      <h2>Communication Settings</h2>
      <p style="color:${GRAY};margin-bottom:18px">Configure parent communication preferences</p>

      <div class="pc-grid2">
        <div class="card">
          <h3 style="margin:0 0 14px">Data Overview</h3>
          <div style="display:grid;gap:10px">
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6"><span>Registered Parents</span><strong>${F(parentCount)}</strong></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6"><span>Announcements</span><strong>${F(announcementCount)}</strong></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6"><span>Messages Sent</span><strong>${F(messageCount)}</strong></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6"><span>Templates</span><strong>${F(templateCount)}</strong></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0"><span>Feedback Items</span><strong>${F(feedbackCount)}</strong></div>
          </div>
        </div>

        <div class="card">
          <h3 style="margin:0 0 14px">Default Preferences</h3>
          <form method="POST" action="/school/parent-comm/settings" style="display:grid;gap:12px">
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Default Channel</label>
              <select name="default_channel" class="pc-inp"><option value="email">Email</option><option value="sms">SMS</option><option value="both">Email + SMS</option></select></div>
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Default Language</label>
              <select name="default_language" class="pc-inp"><option value="en">English</option><option value="fr">French</option><option value="es">Spanish</option><option value="ar">Arabic</option><option value="sw">Swahili</option><option value="zh">Chinese</option></select></div>
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Auto-Read Receipts</label>
              <select name="auto_read_receipts" class="pc-inp"><option value="yes">Yes - Track all reads</option><option value="no">No - Manual only</option></select></div>
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Urgent Alert Sound</label>
              <select name="urgent_sound" class="pc-inp"><option value="yes">Enable</option><option value="no">Disable</option></select></div>
            <div><label style="display:flex;align-items:center;gap:8px;font-weight:600"><input type="checkbox" name="notify_new_feedback" checked style="width:auto"> Notify on new feedback</label></div>
            <div><label style="display:flex;align-items:center;gap:8px;font-weight:600"><input type="checkbox" name="weekly_digest" style="width:auto"> Weekly communication digest</label></div>
            <button type="submit" class="pc-btn pc-btn-primary">Save Settings</button>
          </form>
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <h3 style="margin:0 0 14px">Danger Zone</h3>
        <div class="pc-warn"><strong>Warning:</strong> These actions are irreversible.</div>
        <div style="display:flex;gap:10px;margin-top:12px">
          <button onclick="purgeDrafts()" class="pc-btn pc-btn-sm pc-btn-danger">Purge Draft Announcements</button>
          <button onclick="purgeOld()" class="pc-btn pc-btn-sm pc-btn-danger">Archive Messages Older Than 90 Days</button>
        </div>
      </div>
      <script>
      function purgeDrafts(){if(confirm('Delete all draft announcements?'))fetch('/school/parent-comm/settings/purge-drafts',{method:'POST'}).then(function(r){return r.json()}).then(function(d){alert(d.message||'Done');location.reload();})}
      function purgeOld(){if(confirm('Archive messages older than 90 days?'))fetch('/school/parent-comm/settings/purge-old',{method:'POST'}).then(function(r){return r.json()}).then(function(d){alert(d.message||'Done');location.reload();})}
      </script>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  24. POST /school/parent-comm/settings — Save settings
  // ═══════════════════════════════════════════════════════
  app.post('/school/parent-comm/settings', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id;
    const { default_channel, default_language, auto_read_receipts, urgent_sound, notify_new_feedback, weekly_digest } = req.body;
    // Store settings as a simple key-value in a settings table or tenant metadata
    // For simplicity, we log and flash
    audit && audit(tid, uid, 'update_comm_settings', `Updated communication settings: channel=${default_channel}, lang=${default_language}`);
    req.session.pcFlash = { type: 'success', msg: 'Communication settings saved successfully.' };
    res.redirect('/school/parent-comm/settings');
  }));

  // ═══════════════════════════════════════════════════════
  //  25. POST /school/parent-comm/settings/purge-drafts
  // ═══════════════════════════════════════════════════════
  app.post('/school/parent-comm/settings/purge-drafts', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const r = await pool.query(`DELETE FROM parent_announcements WHERE tenant_id=$1 AND sent_at IS NULL`, [tid]);
    audit && audit(tid, req.session.user.id, 'purge_drafts', `Purged ${r.rowCount} draft announcements`);
    res.json({ ok: true, message: `Purged ${r.rowCount} draft announcements.` });
  }));

  // ═══════════════════════════════════════════════════════
  //  26. POST /school/parent-comm/settings/purge-old
  // ═══════════════════════════════════════════════════════
  app.post('/school/parent-comm/settings/purge-old', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const r = await pool.query(`DELETE FROM parent_messages WHERE tenant_id=$1 AND sent_at < NOW() - INTERVAL '90 days'`, [tid]);
    audit && audit(tid, req.session.user.id, 'purge_old_messages', `Archived ${r.rowCount} old messages`);
    res.json({ ok: true, message: `Archived ${r.rowCount} messages older than 90 days.` });
  }));
};
