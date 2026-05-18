// ============================================================
// === COMMUNICATION ANALYTICS — Email / SMS / Push Insights ===
// ============================================================
// Channel dashboards, campaign tracking, delivery & engagement
// reports, daily/weekly trends, channel comparison, CSV export,
// bounce analysis, SVG charts — dark themed UI
// ============================================================

module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const { renderPage, ah, requireAuth, audit } = opts;
  const prefix = '/admin/comm-analytics';

  // ── Schema bootstrap ──────────────────────────────────────────
  const initSQL = `
    CREATE TABLE IF NOT EXISTS communication_analytics (
      id SERIAL PRIMARY KEY,
      channel TEXT NOT NULL,
      campaign_id INT,
      subject TEXT,
      recipient_count INT DEFAULT 0,
      sent_count INT DEFAULT 0,
      delivered_count INT DEFAULT 0,
      opened_count INT DEFAULT 0,
      clicked_count INT DEFAULT 0,
      bounced_count INT DEFAULT 0,
      unsubscribed_count INT DEFAULT 0,
      complaint_count INT DEFAULT 0,
      avg_delivery_time_ms INT,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      school_id INT DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS communication_daily_stats (
      id SERIAL PRIMARY KEY,
      channel TEXT,
      stat_date DATE,
      sent INT DEFAULT 0,
      delivered INT DEFAULT 0,
      opened INT DEFAULT 0,
      clicked INT DEFAULT 0,
      bounced INT DEFAULT 0,
      school_id INT DEFAULT 1,
      UNIQUE(channel, stat_date)
    );
  `;
  pool.query(initSQL).catch(e => console.error('[comm-analytics] init error', e.message));

  // ── Shared dark-theme page wrapper ───────────────────────────
  function page(req, res, title, body, extraHead) {
    const css = `
      .ca-wrap{max-width:1080px;margin:0 auto;font-family:system-ui,sans-serif;color:#e2e8f0}
      .ca-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px}
      .ca-header h1{font-size:1.5rem;color:#f1f5f9;margin:0}
      .ca-hero{background:linear-gradient(135deg,#1e3a5f,#3b82f6);padding:32px;border-radius:16px;margin-bottom:24px;text-align:center}
      .ca-hero h1{color:#fff;margin:0 0 6px;font-size:1.8rem}
      .ca-hero p{color:rgba(255,255,255,.8);margin:0;font-size:1rem}
      .ca-btn{display:inline-block;padding:8px 18px;border-radius:8px;font-size:.85rem;font-weight:600;
        text-decoration:none;cursor:pointer;border:none;transition:all .15s}
      .ca-btn-primary{background:#3b82f6;color:#fff}.ca-btn-primary:hover{background:#2563eb}
      .ca-btn-outline{background:transparent;color:#3b82f6;border:1.5px solid #3b82f6}.ca-btn-outline:hover{background:#1e293b}
      .ca-btn-danger{background:#ef4444;color:#fff}.ca-btn-danger:hover{background:#dc2626}
      .ca-btn-success{background:#22c55e;color:#fff}.ca-btn-success:hover{background:#16a34a}
      .ca-btn-sm{padding:5px 12px;font-size:.78rem}
      .ca-card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px}
      .ca-card-title{font-size:1rem;font-weight:700;color:#f1f5f9;margin-bottom:12px}
      .ca-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
      .ca-stat{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px;text-align:center}
      .ca-stat .val{font-size:1.5rem;font-weight:800;color:#3b82f6}
      .ca-stat .lbl{font-size:.75rem;color:#94a3b8;margin-top:4px}
      .ca-table{width:100%;border-collapse:collapse;font-size:.85rem}
      .ca-table th{text-align:left;padding:10px;background:#0f172a;border-bottom:2px solid #334155;color:#94a3b8}
      .ca-table td{padding:10px;border-bottom:1px solid #1e293b;color:#cbd5e1}
      .ca-table tr:hover td{background:#1e293b}
      .ca-badge{display:inline-block;padding:3px 10px;border-radius:9999px;font-size:.72rem;font-weight:600}
      .ca-badge-email{background:#1e3a5f;color:#60a5fa}
      .ca-badge-sms{background:#1a3c2a;color:#4ade80}
      .ca-badge-push{background:#3c1a4f;color:#c084fc}
      .ca-empty{text-align:center;padding:48px 20px;color:#64748b}
      .ca-chart-wrap{overflow-x:auto;padding:8px 0}
      .ca-tabs{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
      .ca-tab{padding:8px 16px;border-radius:8px;font-size:.85rem;text-decoration:none;cursor:pointer;
        color:#94a3b8;background:#1e293b;border:1px solid #334155;transition:all .15s}
      .ca-tab.active,.ca-tab:hover{background:#3b82f6;color:#fff;border-color:#3b82f6}
      .ca-form-group{margin-bottom:14px}
      .ca-form-group label{display:block;font-weight:600;font-size:.85rem;color:#94a3b8;margin-bottom:4px}
      .ca-form-group input,.ca-form-group select{width:100%;padding:8px 12px;background:#0f172a;
        border:1px solid #334155;border-radius:8px;font-size:.9rem;color:#e2e8f0;box-sizing:border-box}
      .ca-progress{background:#334155;border-radius:6px;height:8px;overflow:hidden}
      .ca-progress-bar{height:100%;border-radius:6px;transition:width .4s}
      .ca-insight{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #1e293b;font-size:.9rem}
      .ca-insight-icon{width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:.8rem;flex-shrink:0}
      .ca-good{background:#14532d;color:#4ade80}.ca-warn{background:#713f12;color:#facc15}.ca-bad{background:#7f1d1d;color:#fca5a5}
    `;
    const head = `<style>${css}</style>${extraHead || ''}`;
    res.send(renderPage(title, head + `<div class="ca-wrap" style="background:#0f172a;min-height:100vh;padding:24px">${body}</div>`, req.session?.user));
  }

  // ── SVG Chart Builders ────────────────────────────────────────

  /** Horizontal bar chart */
  function buildBarSVG(data, width = 700, height = 300) {
    if (!data.length) return '<p class="ca-empty">No data</p>';
    const maxVal = Math.max(...data.map(d => d.value || 0), 1);
    const barH = Math.min(32, (height - 30) / data.length - 8);
    const padL = 120;
    let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family:system-ui,sans-serif">`;
    data.forEach((d, i) => {
      const y = 14 + i * (barH + 8);
      const barW = Math.max(4, (d.value / maxVal) * (width - padL - 20));
      const color = d.color || '#3b82f6';
      svg += `<text x="${padL - 8}" y="${y + barH / 2 + 4}" text-anchor="end" fill="#94a3b8" font-size="12">${esc(d.label)}</text>`;
      svg += `<rect x="${padL}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${color}" opacity="0.85"/>`;
      svg += `<text x="${padL + barW + 6}" y="${y + barH / 2 + 4}" fill="#e2e8f0" font-size="11" font-weight="600">${d.display || d.value}</text>`;
    });
    svg += '</svg>';
    return `<div class="ca-chart-wrap">${svg}</div>`;
  }

  /** Multi-line trend chart */
  function buildTrendSVG(rows, series, width = 780, height = 280) {
    if (!rows.length) return '<p class="ca-empty">No trend data</p>';
    const pad = { t: 20, r: 20, b: 44, l: 50 };
    const cw = width - pad.l - pad.r, ch = height - pad.t - pad.b;
    let maxV = 0;
    rows.forEach(r => series.forEach(s => { if ((r[s.key] || 0) > maxV) maxV = r[s.key]; }));
    maxV = maxV || 100;
    const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa', '#06b6d4'];
    let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family:system-ui,sans-serif">`;
    // Grid
    svg += `<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + ch}" stroke="#334155"/>`;
    svg += `<line x1="${pad.l}" y1="${pad.t + ch}" x2="${pad.l + cw}" y2="${pad.t + ch}" stroke="#334155"/>`;
    for (let i = 0; i <= 4; i++) {
      const yy = pad.t + ch - (ch * i / 4);
      svg += `<text x="${pad.l - 8}" y="${yy + 4}" text-anchor="end" fill="#64748b" font-size="10">${Math.round(maxV * i / 4)}</text>`;
      svg += `<line x1="${pad.l}" y1="${yy}" x2="${pad.l + cw}" y2="${yy}" stroke="#1e293b"/>`;
    }
    // Lines
    const xStep = rows.length > 1 ? cw / (rows.length - 1) : 0;
    series.forEach((s, si) => {
      const c = colors[si % colors.length];
      let pts = '';
      rows.forEach((r, ri) => {
        const px = pad.l + ri * xStep;
        const py = pad.t + ch - ((r[s.key] || 0) / maxV * ch);
        pts += `${px},${py} `;
      });
      svg += `<polyline points="${pts.trim()}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      rows.forEach((r, ri) => {
        const px = pad.l + ri * xStep;
        const py = pad.t + ch - ((r[s.key] || 0) / maxV * ch);
        svg += `<circle cx="${px}" cy="${py}" r="3" fill="${c}" stroke="#0f172a" stroke-width="1.5"/>`;
      });
    });
    // X labels
    rows.forEach((r, ri) => {
      const px = pad.l + ri * xStep;
      svg += `<text x="${px}" y="${pad.t + ch + 18}" text-anchor="middle" fill="#64748b" font-size="10">${String(r.date).slice(5)}</text>`;
    });
    // Legend
    series.forEach((s, si) => {
      const lx = pad.l + si * 120;
      svg += `<rect x="${lx}" y="${height - 12}" width="10" height="10" rx="2" fill="${colors[si % colors.length]}"/>`;
      svg += `<text x="${lx + 14}" y="${height - 3}" fill="#94a3b8" font-size="10">${esc(s.label)}</text>`;
    });
    svg += '</svg>';
    return `<div class="ca-chart-wrap">${svg}</div>`;
  }

  /** Donut / ring chart */
  function buildDonutSVG(segments, size = 180) {
    if (!segments.length) return '<p class="ca-empty">No data</p>';
    const cx = size / 2, cy = size / 2, r = size / 2 - 16, stroke = 28;
    const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
    const circumference = 2 * Math.PI * r;
    let offset = 0;
    let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="font-family:system-ui,sans-serif">`;
    segments.forEach(seg => {
      const pct = seg.value / total;
      const dash = pct * circumference;
      svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color || '#3b82f6'}" stroke-width="${stroke}" stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
      offset += dash;
    });
    svg += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="#f1f5f9" font-size="20" font-weight="800">${total.toLocaleString()}</text>`;
    svg += `<text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="#64748b" font-size="10">Total</text>`;
    svg += '</svg>';
    let legend = segments.map(seg => `<span style="margin-right:12px;font-size:.82rem"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${seg.color || '#3b82f6'};margin-right:4px"></span>${esc(seg.label)}: ${seg.value}</span>`).join('');
    return `<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">${svg}<div>${legend}</div></div>`;
  }

  /** Gauge chart for a single percentage */
  function buildGaugeSVG(pct, label, color, size = 160) {
    const cx = size / 2, cy = size / 2, r = size / 2 - 18;
    const circumference = 2 * Math.PI * r;
    const filled = Math.min(pct, 100) / 100 * circumference;
    let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="font-family:system-ui,sans-serif">`;
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1e293b" stroke-width="14"/>`;
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color || '#3b82f6'}" stroke-width="14" stroke-dasharray="${filled} ${circumference - filled}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/>`;
    svg += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" fill="#f1f5f9" font-size="22" font-weight="800">${pct.toFixed(1)}%</text>`;
    svg += `<text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="#64748b" font-size="10">${esc(label)}</text>`;
    svg += '</svg>';
    return svg;
  }

  // ── Helpers ───────────────────────────────────────────────────
  const CHANNELS = ['email', 'sms', 'push'];
  const CHANNEL_COLORS = { email: '#3b82f6', sms: '#22c55e', push: '#a78bfa' };
  const CHANNEL_ICONS = { email: '📧', sms: '💬', push: '🔔' };

  function pctRate(num, den) {
    if (!den || den === 0) return 0;
    return Math.round(num / den * 10000) / 100;
  }

  function seedDemoData() {
    // Insert sample daily stats for last 30 days if empty
    return pool.query('SELECT COUNT(*) FROM communication_daily_stats').then(r => {
      if (parseInt(r.rows[0].count) > 0) return;
      const vals = [];
      for (let d = 29; d >= 0; d--) {
        const dt = new Date(); dt.setDate(dt.getDate() - d);
        const ds = dt.toISOString().slice(0, 10);
        CHANNELS.forEach(ch => {
          const sent = ch === 'email' ? 400 + Math.round(Math.random() * 200) :
                       ch === 'sms' ? 200 + Math.round(Math.random() * 150) :
                       600 + Math.round(Math.random() * 300);
          const delivered = Math.round(sent * (0.88 + Math.random() * 0.10));
          const opened = Math.round(delivered * (0.20 + Math.random() * 0.25));
          const clicked = Math.round(opened * (0.10 + Math.random() * 0.15));
          const bounced = sent - delivered;
          vals.push(`('${ch}','${ds}',${sent},${delivered},${opened},${clicked},${bounced})`);
        });
      }
      const sql = `INSERT INTO communication_daily_stats (channel,stat_date,sent,delivered,opened,clicked,bounced) VALUES ${vals.join(',')} ON CONFLICT DO NOTHING`;
      return pool.query(sql).catch(() => {});
    }).then(() => {
      return pool.query('SELECT COUNT(*) FROM communication_analytics').then(r => {
        if (parseInt(r.rows[0].count) > 0) return;
        const subjects = ['Weekly Newsletter', 'Fee Reminder', 'Exam Schedule', 'Parent-Teacher Meeting',
          'Holiday Notice', 'Admissions Open', 'Sports Day', 'Report Card Ready', 'Fee Payment Due',
          'End of Term Update'];
        for (let i = 0; i < 20; i++) {
          const ch = CHANNELS[Math.floor(Math.random() * CHANNELS.length)];
          const subj = subjects[Math.floor(Math.random() * subjects.length)];
          const recip = 100 + Math.round(Math.random() * 900);
          const sent = Math.round(recip * (0.9 + Math.random() * 0.1));
          const del = Math.round(sent * (0.88 + Math.random() * 0.10));
          const open = Math.round(del * (0.18 + Math.random() * 0.30));
          const click = Math.round(open * (0.08 + Math.random() * 0.18));
          const bounce = sent - del;
          const unsub = Math.round(open * (0.01 + Math.random() * 0.03));
          const complaint = Math.round(open * Math.random() * 0.01);
          const dt = new Date(); dt.setDate(dt.getDate() - Math.floor(Math.random() * 30));
          pool.query(
            `INSERT INTO communication_analytics (channel,campaign_id,subject,recipient_count,sent_count,delivered_count,opened_count,clicked_count,bounced_count,unsubscribed_count,complaint_count,avg_delivery_time_ms,sent_at,school_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1)`,
            [ch, i + 1, subj, recip, sent, del, open, click, bounce, unsub, complaint, 200 + Math.round(Math.random() * 800), dt]).catch(() => {});
        }
      });
    }).catch(e => console.warn('[comm-analytics] seed error', e.message));
  }

  seedDemoData().catch(() => {});

  // ═══════════════════════════════════════════════════════════════
  // === 1. GET / — Dashboard with channel overview ===
  // ═══════════════════════════════════════════════════════════════
  app.get(`${prefix}`, requireAuth, ah(async (req, res) => {
    const totals = await pool.query(`
      SELECT channel,
        COALESCE(SUM(sent_count),0) AS sent,
        COALESCE(SUM(delivered_count),0) AS delivered,
        COALESCE(SUM(opened_count),0) AS opened,
        COALESCE(SUM(clicked_count),0) AS clicked,
        COALESCE(SUM(bounced_count),0) AS bounced,
        COALESCE(SUM(unsubscribed_count),0) AS unsubscribed,
        COALESCE(SUM(complaint_count),0) AS complaints
      FROM communication_analytics
      GROUP BY channel ORDER BY sent DESC`);
    const recent = await pool.query('SELECT * FROM communication_analytics ORDER BY created_at DESC LIMIT 10');
    const dailyTotals = await pool.query(`
      SELECT stat_date AS date,
        SUM(sent) AS sent, SUM(delivered) AS delivered,
        SUM(opened) AS opened, SUM(clicked) AS clicked, SUM(bounced) AS bounced
      FROM communication_daily_stats
      WHERE stat_date >= CURRENT_DATE - INTERVAL '14 days'
      GROUP BY stat_date ORDER BY stat_date`);

    const aggSent = totals.rows.reduce((s, r) => s + parseInt(r.sent), 0);
    const aggDel = totals.rows.reduce((s, r) => s + parseInt(r.delivered), 0);
    const aggOpen = totals.rows.reduce((s, r) => s + parseInt(r.opened), 0);
    const aggClick = totals.rows.reduce((s, r) => s + parseInt(r.clicked), 0);
    const aggBounce = totals.rows.reduce((s, r) => s + parseInt(r.bounced), 0);

    const trendChart = buildTrendSVG(dailyTotals.rows, [
      { key: 'sent', label: 'Sent' },
      { key: 'delivered', label: 'Delivered' },
      { key: 'opened', label: 'Opened' }
    ]);

    const donutChart = buildDonutSVG(totals.rows.map(r => ({
      label: r.channel, value: parseInt(r.sent), color: CHANNEL_COLORS[r.channel] || '#3b82f6'
    })));

    const gauges = `
      <div style="display:flex;gap:20px;flex-wrap:wrap;justify-content:center;margin:16px 0">
        ${buildGaugeSVG(pctRate(aggDel, aggSent), 'Delivery', '#22c55e')}
        ${buildGaugeSVG(pctRate(aggOpen, aggDel), 'Open', '#3b82f6')}
        ${buildGaugeSVG(pctRate(aggClick, aggOpen), 'Click', '#f59e0b')}
      </div>`;

    const channelCards = totals.rows.map(r => {
      const icon = CHANNEL_ICONS[r.channel] || '📡';
      const badge = `ca-badge ca-badge-${r.channel}`;
      const openRate = pctRate(r.opened, r.delivered);
      return `<div class="ca-card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div><span class="ca-badge ${badge}">${icon} ${esc(r.channel)}</span>
          <div style="font-size:1.4rem;font-weight:800;color:#f1f5f9;margin-top:6px">${Number(r.sent).toLocaleString()} sent</div>
        </div>
        <div style="display:flex;gap:20px;font-size:.85rem;color:#94a3b8">
          <div>Delivered: <strong style="color:#22c55e">${pctRate(r.delivered, r.sent)}%</strong></div>
          <div>Opened: <strong style="color:#3b82f6">${openRate}%</strong></div>
          <div>Bounced: <strong style="color:#ef4444">${Number(r.bounced)}</strong></div>
        </div>
        <a href="${prefix}/by-channel/${r.channel}" class="ca-btn ca-btn-outline ca-btn-sm">View →</a>
      </div>`;
    }).join('');

    const recentRows = recent.rows.map(r => `
      <tr><td><span class="ca-badge ca-badge-${r.channel}">${CHANNEL_ICONS[r.channel] || '📡'} ${esc(r.channel)}</span></td>
        <td>${esc(r.subject || '—')}</td>
        <td>${Number(r.sent_count).toLocaleString()}</td>
        <td style="color:#22c55e">${pctRate(r.delivered_count, r.sent_count)}%</td>
        <td style="color:#3b82f6">${pctRate(r.opened_count, r.delivered_count)}%</td>
        <td>${r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</td>
        <td><a href="${prefix}/campaign/${r.campaign_id}" class="ca-btn ca-btn-outline ca-btn-sm">Details</a></td>
      </tr>`).join('');

    const body = `
      <div class="ca-hero"><h1>Communication Analytics</h1><p>Track email, SMS & push notification performance across all campaigns</p></div>
      <div class="ca-stats">
        <div class="ca-stat"><div class="val">${aggSent.toLocaleString()}</div><div class="lbl">Total Sent</div></div>
        <div class="ca-stat"><div class="val" style="color:#22c55e">${pctRate(aggDel, aggSent)}%</div><div class="lbl">Delivery Rate</div></div>
        <div class="ca-stat"><div class="val" style="color:#3b82f6">${pctRate(aggOpen, aggDel)}%</div><div class="lbl">Open Rate</div></div>
        <div class="ca-stat"><div class="val" style="color:#f59e0b">${pctRate(aggClick, aggOpen)}%</div><div class="lbl">Click Rate</div></div>
        <div class="ca-stat"><div class="val" style="color:#ef4444">${aggBounce.toLocaleString()}</div><div class="lbl">Bounces</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="ca-card"><div class="ca-card-title">Channel Distribution</div>${donutChart}</div>
        <div class="ca-card"><div class="ca-card-title">Key Rate Gauges</div>${gauges}</div>
      </div>
      <div class="ca-card" style="margin-bottom:20px"><div class="ca-card-title">14-Day Sending Trend</div>${trendChart}</div>
      ${channelCards}
      <div class="ca-card"><div class="ca-card-title">Recent Campaigns</div>
        <div style="overflow-x:auto"><table class="ca-table">
          <thead><tr><th>Channel</th><th>Subject</th><th>Sent</th><th>Delivery</th><th>Open</th><th>Date</th><th></th></tr></thead>
          <tbody>${recentRows}</tbody>
        </table></div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
        <a href="${prefix}/data" class="ca-btn ca-btn-outline">JSON Data</a>
        <a href="${prefix}/comparison" class="ca-btn ca-btn-outline">Channel Comparison</a>
        <a href="${prefix}/top-campaigns" class="ca-btn ca-btn-outline">Top Campaigns</a>
        <a href="${prefix}/export" class="ca-btn ca-btn-primary">Export CSV</a>
        <a href="${prefix}/bounces" class="ca-btn ca-btn-danger ca-btn-sm">Bounce Analysis</a>
      </div>`;

    page(req, res, 'Communication Analytics', body);
  }));

  // ═══════════════════════════════════════════════════════════════
  // === 2. GET /data — JSON analytics data ===
  // ═══════════════════════════════════════════════════════════════
  app.get(`${prefix}/data`, requireAuth, ah(async (req, res) => {
    const { channel, days } = req.query;
    const dayFilter = days ? `WHERE created_at >= NOW() - INTERVAL '${parseInt(days) || 30} days'` : '';
    const chFilter = channel ? `${dayFilter ? 'AND' : 'WHERE'} channel = '${channel.replace(/[^a-z]/gi, '')}'` : '';
    const { rows } = await pool.query(`
      SELECT * FROM communication_analytics ${dayFilter ? dayFilter : ''} ${chFilter} ORDER BY created_at DESC LIMIT 200`);
    const daily = await pool.query(`
      SELECT * FROM communication_daily_stats ${dayFilter ? dayFilter.replace('created_at', 'stat_date') : ''} ${chFilter ? chFilter.replace('channel', 'channel') : ''} ORDER BY stat_date DESC LIMIT 90`);
    res.json({
      campaigns: rows,
      daily_stats: daily.rows,
      meta: { channel: channel || 'all', days: days || 'all', total: rows.length }
    });
  }));

  // ═══════════════════════════════════════════════════════════════
  // === 3. GET /by-channel/:channel — Channel-specific analytics ===
  // ═══════════════════════════════════════════════════════════════
  app.get(`${prefix}/by-channel/:channel`, requireAuth, ah(async (req, res) => {
    const ch = req.params.channel.replace(/[^a-z]/gi, '').toLowerCase();
    if (!CHANNELS.includes(ch)) return res.status(404).send('Invalid channel');
    const [totals, campaigns, daily] = await Promise.all([
      pool.query(`SELECT
          COALESCE(SUM(recipient_count),0) AS recipients,
          COALESCE(SUM(sent_count),0) AS sent,
          COALESCE(SUM(delivered_count),0) AS delivered,
          COALESCE(SUM(opened_count),0) AS opened,
          COALESCE(SUM(clicked_count),0) AS clicked,
          COALESCE(SUM(bounced_count),0) AS bounced,
          COALESCE(SUM(unsubscribed_count),0) AS unsubscribed,
          COALESCE(SUM(complaint_count),0) AS complaints,
          COALESCE(AVG(avg_delivery_time_ms),0) AS avg_time
        FROM communication_analytics WHERE channel = $1`, [ch]),
      pool.query('SELECT * FROM communication_analytics WHERE channel = $1 ORDER BY created_at DESC LIMIT 30', [ch]),
      pool.query(`SELECT stat_date AS date, sent, delivered, opened, clicked, bounced
        FROM communication_daily_stats WHERE channel = $1 AND stat_date >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY stat_date`, [ch])
    ]);

    const t = totals.rows[0];
    const sent = parseInt(t.sent), del = parseInt(t.delivered), open = parseInt(t.opened), click = parseInt(t.clicked);
    const trendChart = buildTrendSVG(daily.rows, [
      { key: 'sent', label: 'Sent' }, { key: 'delivered', label: 'Delivered' },
      { key: 'opened', label: 'Opened' }, { key: 'clicked', label: 'Clicked' }
    ]);

    const rows = campaigns.rows.map(c => `
      <tr><td>${esc(c.subject || '—')}</td><td>${Number(c.sent_count).toLocaleString()}</td>
        <td style="color:#22c55e">${pctRate(c.delivered_count, c.sent_count)}%</td>
        <td style="color:#3b82f6">${pctRate(c.opened_count, c.delivered_count)}%</td>
        <td style="color:#f59e0b">${pctRate(c.clicked_count, c.opened_count)}%</td>
        <td>${c.avg_delivery_time_ms || '—'}ms</td>
        <td>${c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</td>
        <td><a href="${prefix}/campaign/${c.campaign_id}" class="ca-btn ca-btn-outline ca-btn-sm">View</a></td>
      </tr>`).join('');

    const body = `
      <div class="ca-header"><h1>${CHANNEL_ICONS[ch]} ${ch.toUpperCase()} Channel Analytics</h1>
        <a href="${prefix}" class="ca-btn ca-btn-outline">← Dashboard</a></div>
      <div class="ca-stats">
        <div class="ca-stat"><div class="val">${sent.toLocaleString()}</div><div class="lbl">Sent</div></div>
        <div class="ca-stat"><div class="val" style="color:#22c55e">${pctRate(del, sent)}%</div><div class="lbl">Delivery</div></div>
        <div class="ca-stat"><div class="val" style="color:#3b82f6">${pctRate(open, del)}%</div><div class="lbl">Open Rate</div></div>
        <div class="ca-stat"><div class="val" style="color:#f59e0b">${pctRate(click, open)}%</div><div class="lbl">Click Rate</div></div>
        <div class="ca-stat"><div class="val">${parseInt(t.avg_time)}ms</div><div class="lbl">Avg Delivery</div></div>
        <div class="ca-stat"><div class="val" style="color:#ef4444">${parseInt(t.bounced)}</div><div class="lbl">Bounces</div></div>
      </div>
      <div class="ca-card" style="margin-bottom:20px"><div class="ca-card-title">30-Day Trend</div>${trendChart}</div>
      <div class="ca-card"><div class="ca-card-title">Campaigns (${campaigns.rows.length})</div>
        <div style="overflow-x:auto"><table class="ca-table">
          <thead><tr><th>Subject</th><th>Sent</th><th>Delivery</th><th>Open</th><th>Click</th><th>Delivery Time</th><th>Date</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
    page(req, res, `${ch.toUpperCase()} Analytics`, body);
  }));

  // ═══════════════════════════════════════════════════════════════
  // === 4. GET /campaign/:campaignId — Campaign detail analytics ===
  // ═══════════════════════════════════════════════════════════════
  app.get(`${prefix}/campaign/:campaignId`, requireAuth, ah(async (req, res) => {
    const cid = parseInt(req.params.campaignId);
    const { rows: [c] } = await pool.query('SELECT * FROM communication_analytics WHERE campaign_id = $1', [cid]);
    if (!c) return res.status(404).send('Campaign not found');

    const sent = parseInt(c.sent_count), del = parseInt(c.delivered_count);
    const open = parseInt(c.opened_count), click = parseInt(c.clicked_count);
    const bounce = parseInt(c.bounced_count), unsub = parseInt(c.unsubscribed_count);
    const funnelData = [
      { label: 'Recipients', value: c.recipient_count, color: '#6366f1' },
      { label: 'Sent', value: sent, color: '#3b82f6' },
      { label: 'Delivered', value: del, color: '#22c55e' },
      { label: 'Opened', value: open, color: '#f59e0b' },
      { label: 'Clicked', value: click, color: '#a78bfa' }
    ];
    const funnelChart = buildBarSVG(funnelData, 500, 200);
    const lossDonut = buildDonutSVG([
      { label: 'Delivered', value: del, color: '#22c55e' },
      { label: 'Bounced', value: bounce, color: '#ef4444' }
    ], 160);

    const body = `
      <div class="ca-header"><h1>Campaign #${cid}: ${esc(c.subject || 'Untitled')}</h1>
        <a href="${prefix}" class="ca-btn ca-btn-outline">← Dashboard</a></div>
      <div style="margin-bottom:8px"><span class="ca-badge ca-badge-${c.channel}">${CHANNEL_ICONS[c.channel] || '📡'} ${esc(c.channel)}</span>
        ${c.sent_at ? `<span style="color:#64748b;font-size:.85rem;margin-left:12px">Sent: ${new Date(c.sent_at).toLocaleString()}</span>` : ''}</div>
      <div class="ca-stats">
        <div class="ca-stat"><div class="val">${c.recipient_count.toLocaleString()}</div><div class="lbl">Recipients</div></div>
        <div class="ca-stat"><div class="val" style="color:#22c55e">${pctRate(del, sent)}%</div><div class="lbl">Delivery</div></div>
        <div class="ca-stat"><div class="val" style="color:#3b82f6">${pctRate(open, del)}%</div><div class="lbl">Open Rate</div></div>
        <div class="ca-stat"><div class="val" style="color:#f59e0b">${pctRate(click, open)}%</div><div class="lbl">Click Rate</div></div>
        <div class="ca-stat"><div class="val" style="color:#ef4444">${bounce}</div><div class="lbl">Bounced</div></div>
        <div class="ca-stat"><div class="val" style="color:#f472b6">${unsub}</div><div class="lbl">Unsubscribed</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:16px;margin-bottom:20px">
        <div class="ca-card"><div class="ca-card-title">Delivery Funnel</div>${funnelChart}</div>
        <div class="ca-card"><div class="ca-card-title">Delivery vs Bounces</div>${lossDonut}</div>
      </div>
      <div class="ca-card">
        <div class="ca-card-title">Full Metrics</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:.9rem;color:#cbd5e1">
          <div>Avg Delivery Time: <strong style="color:#f1f5f9">${c.avg_delivery_time_ms || 'N/A'}ms</strong></div>
          <div>Complaints: <strong style="color:#fca5a5">${c.complaint_count || 0}</strong></div>
          <div>School ID: <strong style="color:#f1f5f9">${c.school_id}</strong></div>
          <div>Created: <strong style="color:#f1f5f9">${c.created_at ? new Date(c.created_at).toLocaleString() : '—'}</strong></div>
        </div>
      </div>`;
    page(req, res, `Campaign #${cid}`, body);
  }));

  // ═══════════════════════════════════════════════════════════════
  // === 5. GET /stats — Aggregated statistics ===
  // ═══════════════════════════════════════════════════════════════
  app.get(`${prefix}/stats`, requireAuth, ah(async (req, res) => {
    const [byChannel, byDay, overall] = await Promise.all([
      pool.query(`SELECT channel,
          COUNT(*) AS campaigns,
          COALESCE(SUM(sent_count),0) AS sent,
          COALESCE(SUM(delivered_count),0) AS delivered,
          COALESCE(SUM(opened_count),0) AS opened,
          COALESCE(SUM(clicked_count),0) AS clicked,
          COALESCE(SUM(bounced_count),0) AS bounced
        FROM communication_analytics GROUP BY channel`),
      pool.query(`SELECT stat_date AS date,
          SUM(sent) AS sent, SUM(delivered) AS delivered, SUM(opened) AS opened, SUM(clicked) AS clicked, SUM(bounced) AS bounced
        FROM communication_daily_stats GROUP BY stat_date ORDER BY stat_date DESC LIMIT 30`),
      pool.query(`SELECT
          COALESCE(SUM(sent_count),0) AS sent,
          COALESCE(SUM(delivered_count),0) AS delivered,
          COALESCE(SUM(opened_count),0) AS opened,
          COALESCE(SUM(clicked_count),0) AS clicked,
          COALESCE(SUM(bounced_count),0) AS bounced,
          COALESCE(SUM(unsubscribed_count),0) AS unsub,
          COALESCE(SUM(complaint_count),0) AS complaints,
          COUNT(*) AS total_campaigns
        FROM communication_analytics`)
    ]);

    const o = overall.rows[0];
    const sent = parseInt(o.sent), del = parseInt(o.delivered), open = parseInt(o.opened), click = parseInt(o.clicked);

    const chRows = byChannel.rows.map(r => `
      <tr><td><span class="ca-badge ca-badge-${r.channel}">${esc(r.channel)}</span></td>
        <td>${r.campaigns}</td><td>${Number(r.sent).toLocaleString()}</td>
        <td style="color:#22c55e">${pctRate(r.delivered, r.sent)}%</td>
        <td style="color:#3b82f6">${pctRate(r.opened, r.delivered)}%</td>
        <td style="color:#f59e0b">${pctRate(r.clicked, r.opened)}%</td>
        <td style="color:#ef4444">${Number(r.bounced)}</td>
      </tr>`).join('');

    const dayRows = byDay.rows.slice(0, 14).map(r => `
      <tr><td>${r.date}</td><td>${Number(r.sent).toLocaleString()}</td><td>${Number(r.delivered).toLocaleString()}</td>
        <td>${Number(r.opened).toLocaleString()}</td><td>${Number(r.clicked).toLocaleString()}</td>
        <td style="color:#ef4444">${Number(r.bounced)}</td></tr>`).join('');

    const body = `
      <div class="ca-header"><h1>Aggregated Statistics</h1><a href="${prefix}" class="ca-btn ca-btn-outline">← Dashboard</a></div>
      <div class="ca-stats">
        <div class="ca-stat"><div class="val">${parseInt(o.total_campaigns)}</div><div class="lbl">Total Campaigns</div></div>
        <div class="ca-stat"><div class="val">${sent.toLocaleString()}</div><div class="lbl">Messages Sent</div></div>
        <div class="ca-stat"><div class="val" style="color:#22c55e">${pctRate(del, sent)}%</div><div class="lbl">Delivery Rate</div></div>
        <div class="ca-stat"><div class="val" style="color:#3b82f6">${pctRate(open, del)}%</div><div class="lbl">Open Rate</div></div>
        <div class="ca-stat"><div class="val" style="color:#f59e0b">${pctRate(click, open)}%</div><div class="lbl">CTR</div></div>
        <div class="ca-stat"><div class="val" style="color:#ef4444">${parseInt(o.complaints)}</div><div class="lbl">Complaints</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="ca-card"><div class="ca-card-title">By Channel</div>
          <div style="overflow-x:auto"><table class="ca-table">
            <thead><tr><th>Channel</th><th>Campaigns</th><th>Sent</th><th>Delivery</th><th>Open</th><th>CTR</th><th>Bounces</th></tr></thead>
            <tbody>${chRows}</tbody>
          </table></div>
        </div>
        <div class="ca-card"><div class="ca-card-title">Daily Summary (Last 14 days)</div>
          <div style="overflow-x:auto"><table class="ca-table">
            <thead><tr><th>Date</th><th>Sent</th><th>Del</th><th>Open</th><th>Click</th><th>Bounce</th></tr></thead>
            <tbody>${dayRows}</tbody>
          </table></div>
        </div>
      </div>`;
    page(req, res, 'Aggregated Statistics', body);
  }));

  // ═══════════════════════════════════════════════════════════════
  // === 6. GET /trends — Daily/weekly trends with SVG charts ===
  // ═══════════════════════════════════════════════════════════════
  app.get(`${prefix}/trends`, requireAuth, ah(async (req, res) => {
    const period = req.query.period || 'daily';
    const channel = req.query.channel || '';
    let groupBy = "stat_date";
    let interval = "CURRENT_DATE - INTERVAL '30 days'";
    if (period === 'weekly') groupBy = "DATE_TRUNC('week', stat_date)::date";
    if (period === 'monthly') { groupBy = "DATE_TRUNC('month', stat_date)::date"; interval = "CURRENT_DATE - INTERVAL '90 days'"; }

    const chFilter = channel ? `AND channel = '${channel.replace(/[^a-z]/gi, '')}'` : '';
    const { rows } = await pool.query(`
      SELECT ${groupBy} AS date,
        SUM(sent) AS sent, SUM(delivered) AS delivered, SUM(opened) AS opened,
        SUM(clicked) AS clicked, SUM(bounced) AS bounced
      FROM communication_daily_stats
      WHERE stat_date >= ${interval} ${chFilter}
      GROUP BY ${groupBy} ORDER BY date`);

    const sentChart = buildTrendSVG(rows, [
      { key: 'sent', label: 'Sent' }, { key: 'delivered', label: 'Delivered' }
    ]);
    const engageChart = buildTrendSVG(rows, [
      { key: 'opened', label: 'Opened' }, { key: 'clicked', label: 'Clicked' }, { key: 'bounced', label: 'Bounced' }
    ]);

    const tabs = ['daily', 'weekly', 'monthly'].map(p => `
      <a href="${prefix}/trends?period=${p}${channel ? '&channel=' + channel : ''}"
         class="ca-tab ${p === period ? 'active' : ''}">${p.charAt(0).toUpperCase() + p.slice(1)}</a>`).join('');

    const body = `
      <div class="ca-header"><h1>Trends & Patterns</h1><a href="${prefix}" class="ca-btn ca-btn-outline">← Dashboard</a></div>
      <div class="ca-tabs">${tabs}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
        ${CHANNELS.map(ch => `<a href="${prefix}/trends?period=${period}&channel=${ch}" class="ca-btn ${ch === channel ? 'ca-btn-primary' : 'ca-btn-outline'}">${CHANNEL_ICONS[ch]} ${ch.toUpperCase()}</a>`).join('')}
        <a href="${prefix}/trends?period=${period}" class="ca-btn ${!channel ? 'ca-btn-primary' : 'ca-btn-outline'}">All Channels</a>
      </div>
      <div class="ca-card" style="margin-bottom:16px"><div class="ca-card-title">Volume Trend (${period})</div>${sentChart}</div>
      <div class="ca-card" style="margin-bottom:16px"><div class="ca-card-title">Engagement Trend (${period})</div>${engageChart}</div>
      <div class="ca-card"><div class="ca-card-title">Data Table</div>
        <div style="overflow-x:auto"><table class="ca-table">
          <thead><tr><th>Date</th><th>Sent</th><th>Delivered</th><th>Opened</th><th>Clicked</th><th>Bounced</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td>${r.date}</td><td>${Number(r.sent).toLocaleString()}</td><td>${Number(r.delivered).toLocaleString()}</td><td>${Number(r.opened).toLocaleString()}</td><td>${Number(r.clicked).toLocaleString()}</td><td>${Number(r.bounced)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>`;
    page(req, res, 'Trends & Patterns', body);
  }));

  // ═══════════════════════════════════════════════════════════════
  // === 7. GET /comparison — Channel comparison ===
  // ═══════════════════════════════════════════════════════════════
  app.get(`${prefix}/comparison`, requireAuth, ah(async (req, res) => {
    const channels = await pool.query(`
      SELECT channel,
        COALESCE(SUM(sent_count),0) AS sent,
        COALESCE(SUM(delivered_count),0) AS delivered,
        COALESCE(SUM(opened_count),0) AS opened,
        COALESCE(SUM(clicked_count),0) AS clicked,
        COALESCE(SUM(bounced_count),0) AS bounced,
        COALESCE(SUM(unsubscribed_count),0) AS unsubscribed
      FROM communication_analytics GROUP BY channel`);

    const metrics = ['sent', 'delivered', 'opened', 'clicked', 'bounced', 'unsubscribed'];
    const metricLabels = { sent: 'Total Sent', delivered: 'Delivered', opened: 'Opened', clicked: 'Clicked', bounced: 'Bounced', unsubscribed: 'Unsubscribed' };

    let chartsHtml = '';
    metrics.forEach(m => {
      const data = channels.rows.map(r => ({
        label: r.channel.toUpperCase(),
        value: parseInt(r[m]),
        color: CHANNEL_COLORS[r.channel] || '#3b82f6',
        display: Number(r[m]).toLocaleString()
      }));
      chartsHtml += `<div class="ca-card"><div class="ca-card-title">${metricLabels[m]} by Channel</div>${buildBarSVG(data, 500, channels.rows.length * 40 + 30)}</div>`;
    });

    // Rate comparison table
    const rateRows = channels.rows.map(r => `
      <tr><td><span class="ca-badge ca-badge-${r.channel}">${CHANNEL_ICONS[r.channel]} ${esc(r.channel)}</span></td>
        <td style="color:#22c55e">${pctRate(r.delivered, r.sent)}%</td>
        <td style="color:#3b82f6">${pctRate(r.opened, r.delivered)}%</td>
        <td style="color:#f59e0b">${pctRate(r.clicked, r.opened)}%</td>
        <td style="color:#ef4444">${pctRate(r.bounced, r.sent)}%</td>
        <td style="color:#f472b6">${pctRate(r.unsubscribed, r.opened)}%</td>
      </tr>`).join('');

    const body = `
      <div class="ca-header"><h1>Channel Comparison</h1><a href="${prefix}" class="ca-btn ca-btn-outline">← Dashboard</a></div>
      <div class="ca-card" style="margin-bottom:20px"><div class="ca-card-title">Rate Comparison</div>
        <div style="overflow-x:auto"><table class="ca-table">
          <thead><tr><th>Channel</th><th>Delivery Rate</th><th>Open Rate</th><th>Click Rate</th><th>Bounce Rate</th><th>Unsub Rate</th></tr></thead>
          <tbody>${rateRows}</tbody>
        </table></div>
      </div>
      ${chartsHtml}`;
    page(req, res, 'Channel Comparison', body);
  }));

  // ═══════════════════════════════════════════════════════════════
  // === 8. GET /top-campaigns — Best performing campaigns ===
  // ═══════════════════════════════════════════════════════════════
  app.get(`${prefix}/top-campaigns`, requireAuth, ah(async (req, res) => {
    const sortBy = req.query.sort || 'opened';
    const allowed = { opened: 'opened_count', clicked: 'clicked_count', delivered: 'delivered_count' };
    const orderCol = allowed[sortBy] || 'opened_count';
    const { rows } = await pool.query(`
      SELECT * FROM communication_analytics
      WHERE sent_count > 0
      ORDER BY ${orderCol} / NULLIF(delivered_count,0) DESC NULLS LAST
      LIMIT 20`);

    const medals = ['🥇', '🥈', '🥉'];
    const listHtml = rows.map((c, i) => {
      const openRate = pctRate(c.opened_count, c.delivered_count);
      const clickRate = pctRate(c.clicked_count, c.opened_count);
      const delRate = pctRate(c.delivered_count, c.sent_count);
      const color = CHANNEL_COLORS[c.channel] || '#3b82f6';
      const medal = i < 3 ? `<span style="font-size:20px;margin-right:6px">${medals[i]}</span>` : '';
      return `<div class="ca-card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:10px">
          ${medal}<span class="ca-badge ca-badge-${c.channel}" style="min-width:70px">${CHANNEL_ICONS[c.channel]} ${esc(c.channel)}</span>
          <div><div style="font-weight:600;color:#f1f5f9">${esc(c.subject || 'Campaign #' + c.campaign_id)}</div>
            <div style="font-size:.78rem;color:#64748b">${Number(c.sent_count).toLocaleString()} sent · ${c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</div></div>
        </div>
        <div style="display:flex;gap:16px;font-size:.85rem">
          <div style="text-align:center"><div style="color:#22c55e;font-weight:700;font-size:1.1rem">${delRate}%</div><div style="color:#64748b;font-size:.7rem">Delivery</div></div>
          <div style="text-align:center"><div style="color:#3b82f6;font-weight:700;font-size:1.1rem">${openRate}%</div><div style="color:#64748b;font-size:.7rem">Open</div></div>
          <div style="text-align:center"><div style="color:#f59e0b;font-weight:700;font-size:1.1rem">${clickRate}%</div><div style="color:#64748b;font-size:.7rem">Click</div></div>
        </div>
        <a href="${prefix}/campaign/${c.campaign_id}" class="ca-btn ca-btn-outline ca-btn-sm">Details</a>
      </div>`;
    }).join('');

    const sortTabs = [
      { key: 'opened', label: 'Best Open Rate' },
      { key: 'clicked', label: 'Best Click Rate' },
      { key: 'delivered', label: 'Best Delivery' }
    ].map(s => `<a href="${prefix}/top-campaigns?sort=${s.key}" class="ca-tab ${s.key === sortBy ? 'active' : ''}">${s.label}</a>`).join('');

    const body = `
      <div class="ca-header"><h1>Top Campaigns</h1><a href="${prefix}" class="ca-btn ca-btn-outline">← Dashboard</a></div>
      <div class="ca-tabs">${sortTabs}</div>
      ${listHtml || '<div class="ca-empty">No campaigns yet. Start sending communications to see top performers.</div>'}`;
    page(req, res, 'Top Campaigns', body);
  }));

  // ═══════════════════════════════════════════════════════════════
  // === 9. GET /export — Export analytics CSV ===
  // ═══════════════════════════════════════════════════════════════
  app.get(`${prefix}/export`, requireAuth, ah(async (req, res) => {
    const channel = req.query.channel || '';
    const chFilter = channel ? `WHERE channel = '${channel.replace(/[^a-z]/gi, '')}'` : '';
    const { rows } = await pool.query(`SELECT * FROM communication_analytics ${chFilter} ORDER BY created_at DESC`);

    const headers = ['id', 'channel', 'campaign_id', 'subject', 'recipient_count', 'sent_count', 'delivered_count',
      'opened_count', 'clicked_count', 'bounced_count', 'unsubscribed_count', 'complaint_count',
      'avg_delivery_time_ms', 'sent_at', 'created_at', 'school_id'];
    const csvRows = [headers.join(',')];
    rows.forEach(r => {
      csvRows.push(headers.map(h => {
        let v = r[h] == null ? '' : String(r[h]);
        if (v.includes(',') || v.includes('"') || v.includes('\n')) v = '"' + v.replace(/"/g, '""') + '"';
        return v;
      }).join(','));
    });
    const csv = csvRows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="communication-analytics${channel ? '-' + channel : ''}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }));

  // ═══════════════════════════════════════════════════════════════
  // === 10. POST /refresh — Refresh analytics data ===
  // ═══════════════════════════════════════════════════════════════
  app.post(`${prefix}/refresh`, requireAuth, ah(async (req, res) => {
    // Re-seed demo data for demonstration; in production, this would
    // pull fresh stats from an external email/SMS/push provider API.
    await seedDemoData();
    audit(req, 'comm_analytics_refresh', 'Refreshed communication analytics data');
    res.json({ ok: true, message: 'Analytics data refreshed successfully' });
  }));

  // ═══════════════════════════════════════════════════════════════
  // === 11. GET /settings — Analytics settings ===
  // ═══════════════════════════════════════════════════════════════
  app.get(`${prefix}/settings`, requireAuth, ah(async (req, res) => {
    const tableCount = (await pool.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name IN ('communication_analytics','communication_daily_stats')")).rows[0].count;
    const rowCount = (await pool.query('SELECT COUNT(*) FROM communication_analytics')).rows[0].count;
    const dailyCount = (await pool.query('SELECT COUNT(*) FROM communication_daily_stats')).rows[0].count;

    const body = `
      <div class="ca-header"><h1>Analytics Settings</h1><a href="${prefix}" class="ca-btn ca-btn-outline">← Dashboard</a></div>
      <div class="ca-card">
        <div class="ca-card-title">System Information</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:.9rem;color:#cbd5e1">
          <div>Tables: <strong style="color:#f1f5f9">${tableCount}</strong></div>
          <div>Campaign Records: <strong style="color:#f1f5f9">${parseInt(rowCount).toLocaleString()}</strong></div>
          <div>Daily Stat Records: <strong style="color:#f1f5f9">${parseInt(dailyCount).toLocaleString()}</strong></div>
          <div>Channels Tracked: <strong style="color:#f1f5f9">${CHANNELS.join(', ')}</strong></div>
        </div>
      </div>
      <div class="ca-card">
        <div class="ca-card-title">Data Management</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button onclick="refreshData()" class="ca-btn ca-btn-primary">Refresh / Re-seed Data</button>
          <a href="${prefix}/export" class="ca-btn ca-btn-outline">Export All as CSV</a>
          <a href="${prefix}/export?channel=email" class="ca-btn ca-btn-outline">Export Email Only</a>
          <a href="${prefix}/export?channel=sms" class="ca-btn ca-btn-outline">Export SMS Only</a>
          <a href="${prefix}/export?channel=push" class="ca-btn ca-btn-outline">Export Push Only</a>
        </div>
      </div>
      <div class="ca-card">
        <div class="ca-card-title">Channel Configuration</div>
        ${CHANNELS.map(ch => `<div style="padding:10px 0;border-bottom:1px solid #1e293b;display:flex;justify-content:space-between;align-items:center">
          <div><span class="ca-badge ca-badge-${ch}" style="margin-right:8px">${CHANNEL_ICONS[ch]} ${esc(ch.toUpperCase())}</span>
            <span style="color:#64748b;font-size:.85rem">${ch === 'email' ? 'SMTP / SendGrid / Mailgun' : ch === 'sms' ? 'Twilio / Africa\'s Talking' : 'Firebase Cloud Messaging / Web Push'}</span></div>
          <span style="color:#22c55e;font-size:.8rem">● Active</span>
        </div>`).join('')}
      </div>
      <script>
      function refreshData(){fetch('${prefix}/refresh',{method:'POST'}).then(r=>r.json()).then(d=>{
        if(d.ok){alert('Data refreshed!');location.reload();}else{alert('Error: '+JSON.stringify(d));}
      }).catch(e=>alert('Network error'));}</script>`;
    page(req, res, 'Analytics Settings', body);
  }));

  // ═══════════════════════════════════════════════════════════════
  // === 12. GET /delivery-report — Delivery rate report ===
  // ═══════════════════════════════════════════════════════════════
  app.get(`${prefix}/delivery-report`, requireAuth, ah(async (req, res) => {
    const [byChannel, dailyDelivery, worstCampaigns] = await Promise.all([
      pool.query(`SELECT channel,
          COALESCE(SUM(sent_count),0) AS sent,
          COALESCE(SUM(delivered_count),0) AS delivered,
          COALESCE(SUM(bounced_count),0) AS bounced
        FROM communication_analytics GROUP BY channel`),
      pool.query(`SELECT stat_date AS date,
          SUM(sent) AS sent, SUM(delivered) AS delivered, SUM(bounced) AS bounced
        FROM communication_daily_stats
        WHERE stat_date >= CURRENT_DATE - INTERVAL '14 days'
        GROUP BY stat_date ORDER BY stat_date`),
      pool.query(`SELECT * FROM communication_analytics
        WHERE sent_count > 0
        ORDER BY bounced_count::float / NULLIF(sent_count, 0) DESC NULLS LAST
        LIMIT 10`)
    ]);

    const deliveryChart = buildTrendSVG(dailyDelivery.rows, [
      { key: 'sent', label: 'Sent' }, { key: 'delivered', label: 'Delivered' }, { key: 'bounced', label: 'Bounced' }
    ]);

    const deliveryDonut = buildDonutSVG(byChannel.rows.map(r => ({
      label: r.channel.toUpperCase() + ' Delivered',
      value: parseInt(r.delivered),
      color: CHANNEL_COLORS[r.channel] || '#3b82f6'
    })));

    const worstRows = worstCampaigns.rows.map(c => {
      const rate = pctRate(c.bounced_count, c.sent_count);
      return `<tr><td>${esc(c.subject || '#' + c.campaign_id)}</td>
        <td><span class="ca-badge ca-badge-${c.channel}">${esc(c.channel)}</span></td>
        <td>${Number(c.sent_count).toLocaleString()}</td>
        <td style="color:#ef4444;font-weight:600">${rate}%</td>
        <td>${Number(c.bounced_count)}</td></tr>`;
    }).join('');

    const body = `
      <div class="ca-header"><h1>Delivery Rate Report</h1><a href="${prefix}" class="ca-btn ca-btn-outline">← Dashboard</a></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="ca-card"><div class="ca-card-title">14-Day Delivery Trend</div>${deliveryChart}</div>
        <div class="ca-card"><div class="ca-card-title">Delivered by Channel</div>${deliveryDonut}</div>
      </div>
      <div class="ca-card"><div class="ca-card-title">Highest Bounce Campaigns</div>
        <div style="overflow-x:auto"><table class="ca-table">
          <thead><tr><th>Campaign</th><th>Channel</th><th>Sent</th><th>Bounce Rate</th><th>Bounces</th></tr></thead>
          <tbody>${worstRows}</tbody>
        </table></div>
      </div>`;
    page(req, res, 'Delivery Rate Report', body);
  }));

  // ═══════════════════════════════════════════════════════════════
  // === 13. GET /engagement-report — Engagement metrics ===
  // ═══════════════════════════════════════════════════════════════
  app.get(`${prefix}/engagement-report`, requireAuth, ah(async (req, res) => {
    const [byChannel, dailyEng, bestCampaigns] = await Promise.all([
      pool.query(`SELECT channel,
          COALESCE(SUM(delivered_count),0) AS delivered,
          COALESCE(SUM(opened_count),0) AS opened,
          COALESCE(SUM(clicked_count),0) AS clicked
        FROM communication_analytics GROUP BY channel`),
      pool.query(`SELECT stat_date AS date,
          SUM(opened) AS opened, SUM(clicked) AS clicked
        FROM communication_daily_stats
        WHERE stat_date >= CURRENT_DATE - INTERVAL '14 days'
        GROUP BY stat_date ORDER BY stat_date`),
      pool.query(`SELECT * FROM communication_analytics
        WHERE delivered_count > 0
        ORDER BY opened_count::float / NULLIF(delivered_count, 0) DESC NULLS LAST
        LIMIT 10`)
    ]);

    const engageChart = buildTrendSVG(dailyEng.rows, [
      { key: 'opened', label: 'Opened' }, { key: 'clicked', label: 'Clicked' }
    ]);

    const bestRows = bestCampaigns.rows.map(c => {
      const openR = pctRate(c.opened_count, c.delivered_count);
      const clickR = pctRate(c.clicked_count, c.opened_count);
      return `<tr><td>${esc(c.subject || '#' + c.campaign_id)}</td>
        <td><span class="ca-badge ca-badge-${c.channel}">${esc(c.channel)}</span></td>
        <td style="color:#3b82f6;font-weight:600">${openR}%</td>
        <td style="color:#f59e0b;font-weight:600">${clickR}%</td>
        <td>${Number(c.opened_count).toLocaleString()} / ${Number(c.clicked_count).toLocaleString()}</td></tr>`;
    }).join('');

    const insightHtml = byChannel.rows.map(r => {
      const openRate = pctRate(r.opened, r.delivered);
      const clickRate = pctRate(r.clicked, r.opened);
      const cls = openRate > 30 ? 'ca-good' : openRate > 15 ? 'ca-warn' : 'ca-bad';
      const icon = openRate > 30 ? '✓' : openRate > 15 ? '⚡' : '✗';
      return `<div class="ca-insight">
        <div class="ca-insight-icon ${cls}">${icon}</div>
        <span><strong>${esc(r.channel).toUpperCase()}</strong>: Open rate <strong style="color:#3b82f6">${openRate}%</strong>, Click rate <strong style="color:#f59e0b">${clickRate}%</strong></span>
      </div>`;
    }).join('');

    const body = `
      <div class="ca-header"><h1>Engagement Report</h1><a href="${prefix}" class="ca-btn ca-btn-outline">← Dashboard</a></div>
      <div class="ca-card" style="margin-bottom:16px"><div class="ca-card-title">14-Day Engagement Trend</div>${engageChart}</div>
      <div class="ca-card" style="margin-bottom:16px"><div class="ca-card-title">Channel Engagement Insights</div>${insightHtml}</div>
      <div class="ca-card"><div class="ca-card-title">Most Engaging Campaigns</div>
        <div style="overflow-x:auto"><table class="ca-table">
          <thead><tr><th>Campaign</th><th>Channel</th><th>Open Rate</th><th>CTR</th><th>Open / Click</th></tr></thead>
          <tbody>${bestRows}</tbody>
        </table></div>
      </div>`;
    page(req, res, 'Engagement Report', body);
  }));

  // ═══════════════════════════════════════════════════════════════
  // === 14. GET /bounces — Bounce analysis ===
  // ═══════════════════════════════════════════════════════════════
  app.get(`${prefix}/bounces`, requireAuth, ah(async (req, res) => {
    const [overall, byChannel, dailyBounces, topBouncers] = await Promise.all([
      pool.query(`SELECT
          COALESCE(SUM(sent_count),0) AS sent,
          COALESCE(SUM(bounced_count),0) AS bounced,
          COALESCE(SUM(delivered_count),0) AS delivered
        FROM communication_analytics`),
      pool.query(`SELECT channel,
          COALESCE(SUM(sent_count),0) AS sent,
          COALESCE(SUM(bounced_count),0) AS bounced
        FROM communication_analytics GROUP BY channel`),
      pool.query(`SELECT stat_date AS date, SUM(bounced) AS bounced, SUM(sent) AS sent
        FROM communication_daily_stats
        WHERE stat_date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY stat_date ORDER BY stat_date`),
      pool.query(`SELECT * FROM communication_analytics
        WHERE bounced_count > 0
        ORDER BY bounced_count DESC NULLS LAST
        LIMIT 15`)
    ]);

    const o = overall.rows[0];
    const totalBounced = parseInt(o.bounced);
    const totalSent = parseInt(o.sent);
    const overallRate = pctRate(totalBounced, totalSent);

    const bounceChart = buildTrendSVG(dailyBounces.rows, [
      { key: 'bounced', label: 'Bounced' }, { key: 'sent', label: 'Sent' }
    ]);

    const chBounces = buildBarSVG(byChannel.rows.map(r => ({
      label: r.channel.toUpperCase(),
      value: parseInt(r.bounced),
      color: CHANNEL_COLORS[r.channel] || '#ef4444',
      display: `${Number(r.bounced).toLocaleString()} (${pctRate(r.bounced, r.sent)}%)`
    })), 500, byChannel.rows.length * 40 + 30);

    const bounceRows = topBouncers.rows.map(c => {
      const rate = pctRate(c.bounced_count, c.sent_count);
      const cls = rate > 10 ? 'ca-bad' : rate > 5 ? 'ca-warn' : 'ca-good';
      const icon = rate > 10 ? '✗' : rate > 5 ? '⚡' : '✓';
      return `<tr><td>${esc(c.subject || '#' + c.campaign_id)}</td>
        <td><span class="ca-badge ca-badge-${c.channel}">${esc(c.channel)}</span></td>
        <td>${Number(c.sent_count).toLocaleString()}</td>
        <td style="color:#ef4444;font-weight:700">${Number(c.bounced_count)}</td>
        <td><div class="ca-progress" style="width:120px;display:inline-block;vertical-align:middle">
          <div class="ca-progress-bar" style="background:${rate > 10 ? '#ef4444' : rate > 5 ? '#f59e0b' : '#22c55e'};width:${Math.min(rate * 5, 100)}%"></div></div>
          <span style="margin-left:6px;font-weight:600">${rate}%</span></td>
        <td><span class="ca-insight-icon ${cls}" style="display:inline-flex;width:22px;height:22px;font-size:.7rem">${icon}</span></td>
      </tr>`;
    }).join('');

    const insights = [];
    if (overallRate > 8) insights.push({ cls: 'ca-bad', icon: '⚠', text: `Overall bounce rate is ${overallRate}%, which is above the 5% threshold. Review sender reputation and list hygiene.` });
    else if (overallRate > 5) insights.push({ cls: 'ca-warn', icon: '⚡', text: `Overall bounce rate is ${overallRate}%. Monitor closely and consider cleaning your contact lists.` });
    else insights.push({ cls: 'ca-good', icon: '✓', text: `Overall bounce rate is healthy at ${overallRate}%. Keep maintaining good list practices.` });

    byChannel.rows.forEach(r => {
      const chRate = pctRate(r.bounced, r.sent);
      if (chRate > 10) insights.push({ cls: 'ca-bad', icon: '⚠', text: `${r.channel.toUpperCase()} has a high bounce rate of ${chRate}%. Check for invalid addresses or domain issues.` });
    });

    const insightHtml = insights.map(i => `<div class="ca-insight">
      <div class="ca-insight-icon ${i.cls}">${i.icon}</div><span>${i.text}</span></div>`).join('');

    const body = `
      <div class="ca-header"><h1>Bounce Analysis</h1><a href="${prefix}" class="ca-btn ca-btn-outline">← Dashboard</a></div>
      <div class="ca-stats">
        <div class="ca-stat"><div class="val" style="color:#ef4444">${totalBounced.toLocaleString()}</div><div class="lbl">Total Bounces</div></div>
        <div class="ca-stat"><div class="val" style="color:#f59e0b">${overallRate}%</div><div class="lbl">Bounce Rate</div></div>
        <div class="ca-stat"><div class="val">${totalSent.toLocaleString()}</div><div class="lbl">Total Sent</div></div>
        <div class="ca-stat"><div class="val" style="color:#22c55e">${pctRate(parseInt(o.delivered), totalSent)}%</div><div class="lbl">Delivery Rate</div></div>
      </div>
      <div class="ca-card" style="margin-bottom:16px"><div class="ca-card-title">Bounce Insights</div>${insightHtml}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="ca-card"><div class="ca-card-title">30-Day Bounce Trend</div>${bounceChart}</div>
        <div class="ca-card"><div class="ca-card-title">Bounces by Channel</div>${chBounces}</div>
      </div>
      <div class="ca-card"><div class="ca-card-title">Top Bouncing Campaigns</div>
        <div style="overflow-x:auto"><table class="ca-table">
          <thead><tr><th>Campaign</th><th>Channel</th><th>Sent</th><th>Bounces</th><th>Bounce Rate</th><th></th></tr></thead>
          <tbody>${bounceRows}</tbody>
        </table></div>
      </div>`;
    page(req, res, 'Bounce Analysis', body);
  }));

  console.log('[CommAnalytics] LOADED: Dashboard, data API, channel analytics, campaign details, aggregated stats, trends, channel comparison, top campaigns, CSV export, refresh, settings, delivery report, engagement report, bounce analysis');
};
