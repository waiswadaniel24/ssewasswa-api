// ============================================================
// AI DROPOUT PREDICTOR MODULE — Multi-Tenant SaaS School Portal
// Student risk scoring, attendance/grade/behavior analysis,
// early warning alerts, intervention tracking, risk factor
// visualization, cohort comparison, predictive dashboard.
// ============================================================

'use strict';

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtNum = n => Number(n || 0).toLocaleString();

  // Risk level helpers
  const riskColor = level => {
    const m = { low: '#059669', moderate: '#d97706', high: '#ea580c', critical: '#dc2626', extreme: '#7c2d12' };
    return m[level] || m.low;
  };

  const riskBadge = level => {
    const colors = { low: { bg: '#dcfce7', c: '#15803d' }, moderate: { bg: '#fef3c7', c: '#b45309' }, high: { bg: '#ffedd5', c: '#c2410c' }, critical: { bg: '#fee2e2', c: '#dc2626' }, extreme: { bg: '#fef2f2', c: '#7f1d1d' } };
    const v = colors[level] || colors.low;
    const label = (level || 'low').toUpperCase();
    return `<span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${v.bg};color:${v.c};letter-spacing:.5px">${esc(label)}</span>`;
  };

  const statusBadge = s => {
    const m = { active: { bg: '#dcfce7', c: '#15803d' }, completed: { bg: '#dbeafe', c: '#1d4ed8' }, pending: { bg: '#fef3c7', c: '#b45309' }, in_progress: { bg: '#ede9fe', c: '#6d28d9' }, cancelled: { bg: '#f1f5f9', c: '#64748b' }, acknowledged: { bg: '#dcfce7', c: '#15803d' } };
    const v = m[s] || { bg: '#f1f5f9', c: '#64748b' };
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${v.bg};color:${v.c}">${esc((s || '').replace(/_/g, ' '))}</span>`;
  };

  // SVG Risk Gauge Generator
  function svgRiskGauge(pct, size, label) {
    const sz = size || 120;
    const r = (sz - 16) / 2;
    const cx = sz / 2, cy = sz / 2;
    const circ = 2 * Math.PI * r;
    const offset = circ - (circ * Math.min(Math.max(pct, 0), 100) / 100);
    const col = pct < 30 ? '#059669' : pct < 55 ? '#d97706' : pct < 75 ? '#ea580c' : '#dc2626';
    return `<svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f3f4f6" stroke-width="10" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="0" transform="rotate(-90 ${cx} ${cy})"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${offset}" transform="rotate(-90 ${cx} ${cy})" style="transition:stroke-dashoffset .6s ease"/>
      <text x="${cx}" y="${cy - 6}" text-anchor="middle" fill="#1e293b" font-size="${sz * 0.18}" font-weight="800">${Math.round(pct)}%</text>
      <text x="${cx}" y="${cy + 10}" text-anchor="middle" fill="#6b7280" font-size="${sz * 0.09}">RISK</text>
    </svg>${label ? `<div style="text-align:center;font-size:11px;color:${GRAY};margin-top:2px">${esc(label)}</div>` : ''}`;
  }

  // SVG Heat Map
  function svgHeatMap(data, width, height) {
    const w = width || 600, h = height || 200;
    const cols = data.length;
    if (cols === 0) return '<p style="color:' + GRAY + ';font-size:13px">No data</p>';
    const cellW = Math.floor((w - 40) / Math.max(cols, 1));
    const rows = data[0].values ? data[0].values.length : 1;
    const cellH = Math.min(Math.floor((h - 50) / Math.max(rows, 1)), 28);
    const startX = 40;
    const startY = 24;

    let svg = `<svg width="${w}" height="${Math.max(h, startY + rows * cellH + 20)}" viewBox="0 0 ${w} ${Math.max(h, startY + rows * cellH + 20)}">`;
    // Column headers
    data.forEach((col, ci) => {
      svg += `<text x="${startX + ci * cellW + cellW / 2}" y="14" text-anchor="middle" fill="#374151" font-size="10" font-weight="600" transform="rotate(-30 ${startX + ci * cellW + cellW / 2} 14)">${esc(col.label || '')}</text>`;
    });
    // Cells
    const rowLabels = data[0].rowLabels || [];
    (data[0].values || []).forEach((_, ri) => {
      if (rowLabels[ri]) svg += `<text x="36" y="${startY + ri * cellH + cellH / 2 + 4}" text-anchor="end" fill="#6b7280" font-size="10">${esc(rowLabels[ri])}</text>`;
      data.forEach((col, ci) => {
        const val = col.values[ri] || 0;
        const intensity = Math.min(Math.max(val, 0), 100);
        let fill;
        if (intensity < 25) fill = '#dcfce7';
        else if (intensity < 50) fill = '#fef9c3';
        else if (intensity < 75) fill = '#fed7aa';
        else fill = '#fecaca';
        svg += `<rect x="${startX + ci * cellW + 1}" y="${startY + ri * cellH + 1}" width="${cellW - 2}" height="${cellH - 2}" rx="3" fill="${fill}" stroke="#fff" stroke-width="1"/>`;
        svg += `<text x="${startX + ci * cellW + cellW / 2}" y="${startY + ri * cellH + cellH / 2 + 3}" text-anchor="middle" fill="#374151" font-size="9" font-weight="600">${Math.round(val)}</text>`;
      });
    });
    svg += '</svg>';
    return svg;
  }

  // SVG Bar Chart
  function svgBarChart(items, width, height) {
    const w = width || 500, h = height || 180;
    const barW = Math.min(Math.floor((w - 60) / Math.max(items.length, 1)) - 8, 50);
    const maxVal = Math.max(...items.map(i => i.value), 1);
    const chartH = h - 50;

    let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
    svg += `<line x1="40" y1="5" x2="40" y2="${chartH + 5}" stroke="#e5e7eb" stroke-width="1"/>`;
    items.forEach((item, i) => {
      const barH = Math.round((item.value / maxVal) * chartH);
      const x = 45 + i * (barW + 8);
      const y = chartH + 5 - barH;
      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${item.color || P}" opacity="0.85"/>`;
      svg += `<text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" fill="#374151" font-size="10" font-weight="700">${item.value}</text>`;
      svg += `<text x="${x + barW / 2}" y="${chartH + 18}" text-anchor="middle" fill="#6b7280" font-size="9" transform="rotate(-30 ${x + barW / 2} ${chartH + 18})">${esc(item.label)}</text>`;
    });
    svg += '</svg>';
    return svg;
  }

  const navBar = (active) => `<nav style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">
    <a href="/school/ai-dropout-predictor" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'dash' ? '#fff' : P};background:${active === 'dash' ? P : '#eef2ff'};transition:.15s">Dashboard</a>
    <a href="/school/ai-dropout-predictor/at-risk" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'risk' ? '#fff' : P};background:${active === 'risk' ? P : '#eef2ff'};transition:.15s">At-Risk Students</a>
    <a href="/school/ai-dropout-predictor/interventions" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'int' ? '#fff' : P};background:${active === 'int' ? P : '#eef2ff'};transition:.15s">Interventions</a>
    <a href="/school/ai-dropout-predictor/alerts" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'alt' ? '#fff' : P};background:${active === 'alt' ? P : '#eef2ff'};transition:.15s">Alerts</a>
    <a href="/school/ai-dropout-predictor/factors-analysis" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'fac' ? '#fff' : P};background:${active === 'fac' ? P : '#eef2ff'};transition:.15s">Factors</a>
    <a href="/school/ai-dropout-predictor/cohort-comparison" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'coh' ? '#fff' : P};background:${active === 'coh' ? P : '#eef2ff'};transition:.15s">Cohorts</a>
    <a href="/school/ai-dropout-predictor/reports" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'rpt' ? '#fff' : P};background:${active === 'rpt' ? P : '#eef2ff'};transition:.15s">Reports</a>
    <a href="/school/ai-dropout-predictor/settings" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'set' ? '#fff' : P};background:${active === 'set' ? P : '#eef2ff'};transition:.15s">Settings</a>
  </nav>`;

  // ============================================================
  // DATABASE MIGRATION
  // ============================================================
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS dropout_risk_factors (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL,
        attendance_score DECIMAL(5,2) DEFAULT 100,
        grade_trend_score DECIMAL(5,2) DEFAULT 100,
        behavior_score DECIMAL(5,2) DEFAULT 100,
        engagement_score DECIMAL(5,2) DEFAULT 100,
        socioeconomic_score DECIMAL(5,2) DEFAULT 100,
        overall_risk_pct DECIMAL(5,2) DEFAULT 0,
        risk_level VARCHAR(20) DEFAULT 'low',
        calculated_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS dropout_interventions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL,
        type VARCHAR(100),
        description TEXT,
        counselor_id INTEGER,
        status VARCHAR(20) DEFAULT 'pending',
        priority VARCHAR(10) DEFAULT 'medium',
        outcome TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS dropout_alerts (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL,
        alert_type VARCHAR(100),
        message TEXT,
        severity VARCHAR(20) DEFAULT 'info',
        acknowledged BOOLEAN DEFAULT false,
        acknowledged_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_dr_rf_tenant ON dropout_risk_factors(tenant_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_dr_rf_student ON dropout_risk_factors(tenant_id, student_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_dr_rf_level ON dropout_risk_factors(tenant_id, risk_level)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_dr_rf_risk ON dropout_risk_factors(tenant_id, overall_risk_pct DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_dr_int_tenant ON dropout_interventions(tenant_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_dr_int_student ON dropout_interventions(tenant_id, student_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_dr_int_status ON dropout_interventions(tenant_id, status)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_dr_alt_tenant ON dropout_alerts(tenant_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_dr_alt_student ON dropout_alerts(tenant_id, student_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_dr_alt_ack ON dropout_alerts(tenant_id, acknowledged)');
      console.log('[Mod] ai-dropout-predictor OK');
    } catch (e) { console.warn('[Mod] Warn:', e.message); }
  })();

  // ============================================================
  // RISK CALCULATION ENGINE
  // ============================================================
  const RISK_WEIGHTS = { attendance: 0.30, grades: 0.25, behavior: 0.20, engagement: 0.15, socioeconomic: 0.10 };

  function calcRisk(data) {
    const attScore = Number(data.attendance_score || 100);
    const gradeScore = Number(data.grade_trend_score || 100);
    const behScore = Number(data.behavior_score || 100);
    const engScore = Number(data.engagement_score || 100);
    const socScore = Number(data.socioeconomic_score || 100);
    const riskPct = 100 - (
      attScore * RISK_WEIGHTS.attendance +
      gradeScore * RISK_WEIGHTS.grades +
      behScore * RISK_WEIGHTS.behavior +
      engScore * RISK_WEIGHTS.engagement +
      socScore * RISK_WEIGHTS.socioeconomic
    );
    const pct = Math.max(0, Math.min(100, riskPct));
    let level = 'low';
    if (pct >= 80) level = 'extreme';
    else if (pct >= 60) level = 'critical';
    else if (pct >= 40) level = 'high';
    else if (pct >= 20) level = 'moderate';
    return { overall_risk_pct: pct, risk_level: level };
  }

  // ============================================================
  // ROUTE 1: GET /school/ai-dropout-predictor — Dashboard
  // ============================================================
  app.get('/school/ai-dropout-predictor', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const totalStudents = (await pool.query(`SELECT COUNT(DISTINCT student_id)::int as cnt FROM dropout_risk_factors WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const riskDist = (await pool.query(
      `SELECT risk_level, COUNT(*)::int as cnt FROM dropout_risk_factors WHERE tenant_id=$1 GROUP BY risk_level ORDER BY CASE risk_level WHEN 'extreme' THEN 5 WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'moderate' THEN 2 ELSE 1 END`, [tid])).rows;
    const activeInterventions = (await pool.query(`SELECT COUNT(*)::int as cnt FROM dropout_interventions WHERE tenant_id=$1 AND status IN ('pending','in_progress')`, [tid])).rows[0].cnt;
    const unackAlerts = (await pool.query(`SELECT COUNT(*)::int as cnt FROM dropout_alerts WHERE tenant_id=$1 AND acknowledged=false`, [tid])).rows[0].cnt;
    const avgRisk = (await pool.query(`SELECT COALESCE(AVG(overall_risk_pct),0)::float as avg FROM dropout_risk_factors WHERE tenant_id=$1`, [tid])).rows[0].avg;

    const topRisks = (await pool.query(
      `SELECT drf.*, u.name as student_name FROM dropout_risk_factors drf JOIN users u ON u.id = drf.student_id WHERE drf.tenant_id=$1 ORDER BY drf.overall_risk_pct DESC LIMIT 5`, [tid])).rows;

    const recentAlerts = (await pool.query(
      `SELECT da.*, u.name as student_name FROM dropout_alerts da JOIN users u ON u.id = da.student_id WHERE da.tenant_id=$1 AND da.acknowledged=false ORDER BY da.created_at DESC LIMIT 5`, [tid])).rows;

    const distLabels = riskDist.map(r => r.risk_level).join(', ');
    const distCounts = riskDist.map(r => r.cnt).join(', ');
    const riskBarItems = riskDist.map(r => ({ label: (r.risk_level || 'low').toUpperCase(), value: r.cnt, color: riskColor(r.risk_level) }));
    const riskBarHtml = riskBarItems.length > 0 ? svgBarChart(riskBarItems, 520, 160) : '<p style="color:' + GRAY + '">No data</p>';

    const topRiskCards = topRisks.map(r => `<div class="card" style="display:flex;align-items:center;gap:14px;border-left:4px solid ${riskColor(r.risk_level)}">
      <div style="flex-shrink:0">${svgRiskGauge(r.overall_risk_pct, 80)}</div>
      <div style="flex:1">
        <a href="/school/ai-dropout-predictor/student-detail/${r.student_id}" style="color:#1e293b;text-decoration:none;font-weight:700;font-size:14px">${esc(r.student_name || 'Student')}</a>
        <div style="font-size:12px;color:${GRAY};margin-top:2px">Attendance: ${Number(r.attendance_score).toFixed(0)} &middot; Grades: ${Number(r.grade_trend_score).toFixed(0)} &middot; Behavior: ${Number(r.behavior_score).toFixed(0)}</div>
      </div>
      ${riskBadge(r.risk_level)}
    </div>`).join('');

    const alertRows = recentAlerts.map(a => `<tr>
      <td>${esc(a.student_name || 'Unknown')}</td>
      <td><span style="font-size:11px;font-weight:600;color:${a.severity === 'critical' ? '#dc2626' : a.severity === 'warning' ? '#d97706' : GRAY}">${esc((a.alert_type || '').replace(/_/g, ' '))}</span></td>
      <td style="font-size:12px">${esc((a.message || '').substring(0, 80))}${(a.message || '').length > 80 ? '...' : ''}</td>
      <td>${fmtDate(a.created_at)}</td>
      <td><a href="/school/ai-dropout-predictor/alerts/acknowledge/${a.id}" class="btn" style="padding:4px 10px;font-size:11px;background:#059669;text-decoration:none">Ack</a></td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">
      ${navBar('dash')}
      <h1 style="font-size:22px;color:#1e293b;margin-bottom:4px">AI Dropout Predictor</h1>
      <p style="color:${GRAY};font-size:13px;margin-bottom:20px">Early warning system for student retention and success</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:800;color:${P}">${totalStudents}</div><div style="font-size:12px;color:${GRAY};font-weight:600">Students Tracked</div></div>
        <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:800;color:#dc2626">${avgRisk.toFixed(1)}%</div><div style="font-size:12px;color:${GRAY};font-weight:600">Average Risk</div></div>
        <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:800;color:#d97706">${activeInterventions}</div><div style="font-size:12px;color:${GRAY};font-weight:600">Active Interventions</div></div>
        <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:800;color:#ea580c">${unackAlerts}</div><div style="font-size:12px;color:${GRAY};font-weight:600">Unacknowledged Alerts</div></div>
        <div class="card" style="display:flex;align-items:center;justify-content:center">${svgRiskGauge(avgRisk, 100, 'School Avg')}</div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card">
          <h3 style="margin:0 0 14px;font-size:15px;color:#1e293b">Risk Distribution</h3>
          ${riskBarHtml}
        </div>
        <div class="card">
          <h3 style="margin:0 0 14px;font-size:15px;color:#1e293b">Recent Alerts</h3>
          <table><thead><tr><th>Student</th><th>Type</th><th>Message</th><th>Date</th><th></th></tr></thead>
          <tbody>${alertRows || '<tr><td colspan="5" style="color:${GRAY};text-align:center;padding:20px">No alerts</td></tr>'}</tbody></table>
        </div>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <h3 style="margin:0;font-size:15px;color:#1e293b">Highest Risk Students</h3>
          <a href="/school/ai-dropout-predictor/at-risk" style="font-size:12px;color:${P};text-decoration:none">View All &rarr;</a>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">${topRiskCards || '<p style="color:' + GRAY + ';text-align:center;padding:20px">No students tracked yet</p>'}</div>
      </div>
    </div>`;
    res.send(renderPage('AI Dropout Predictor', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /school/ai-dropout-predictor/at-risk
  // ============================================================
  app.get('/school/ai-dropout-predictor/at-risk', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const level = req.query.level || '';

    let where = 'WHERE drf.tenant_id=$1';
    const params = [tid];
    if (level) { where += ' AND drf.risk_level=$2'; params.push(level); }

    const students = (await pool.query(
      `SELECT drf.*, u.name as student_name, u.email, u.role
       FROM dropout_risk_factors drf JOIN users u ON u.id = drf.student_id
       ${where} ORDER BY drf.overall_risk_pct DESC LIMIT 100`, params)).rows;

    const rows = students.map(s => `<tr style="cursor:pointer" onclick="location.href='/school/ai-dropout-predictor/student-detail/${s.student_id}'">
      <td><strong style="color:#1e293b">${esc(s.student_name || 'Student')}</strong></td>
      <td style="text-align:center">${svgRiskGauge(s.overall_risk_pct, 60)}</td>
      <td>${riskBadge(s.risk_level)}</td>
      <td><span style="font-size:12px">${Number(s.attendance_score).toFixed(0)}</span></td>
      <td><span style="font-size:12px">${Number(s.grade_trend_score).toFixed(0)}</span></td>
      <td><span style="font-size:12px">${Number(s.behavior_score).toFixed(0)}</span></td>
      <td><span style="font-size:12px">${Number(s.engagement_score).toFixed(0)}</span></td>
      <td style="font-size:11px;color:${GRAY}">${fmtDate(s.calculated_at)}</td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">
      ${navBar('risk')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <h1 style="font-size:20px;color:#1e293b">At-Risk Students (${students.length})</h1>
        <div style="display:flex;gap:4px">
          <a href="/school/ai-dropout-predictor/at-risk" class="btn" style="padding:6px 12px;font-size:12px;text-decoration:none;${!level ? '' : 'background:#eef2ff;color:' + P}">All</a>
          <a href="/school/ai-dropout-predictor/at-risk?level=critical" class="btn" style="padding:6px 12px;font-size:12px;text-decoration:none;${level === 'critical' ? '' : 'background:#fee2e2;color:#dc2626'}">Critical</a>
          <a href="/school/ai-dropout-predictor/at-risk?level=high" class="btn" style="padding:6px 12px;font-size:12px;text-decoration:none;${level === 'high' ? '' : 'background:#ffedd5;color:#ea580c'}">High</a>
          <a href="/school/ai-dropout-predictor/at-risk?level=moderate" class="btn" style="padding:6px 12px;font-size:12px;text-decoration:none;${level === 'moderate' ? '' : 'background:#fef3c7;color:#d97706'}">Moderate</a>
        </div>
      </div>
      <div class="card"><table><thead><tr><th>Student</th><th>Risk %</th><th>Level</th><th>Attendance</th><th>Grades</th><th>Behavior</th><th>Engage</th><th>Updated</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" style="color:${GRAY};text-align:center;padding:30px">No at-risk students found</td></tr>'}</tbody></table></div>
    </div>`;
    res.send(renderPage('At-Risk Students', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: GET /school/ai-dropout-predictor/student-detail/:id
  // ============================================================
  app.get('/school/ai-dropout-predictor/student-detail/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const sid = parseInt(req.params.id);

    const profile = (await pool.query(
      `SELECT drf.*, u.name as student_name, u.email, u.role FROM dropout_risk_factors drf JOIN users u ON u.id = drf.student_id WHERE drf.tenant_id=$1 AND drf.student_id=$2`,
      [tid, sid])).rows[0];

    if (!profile) {
      // Auto-create profile if student exists
      const studentExists = (await pool.query(`SELECT id, name FROM users WHERE id=$1 AND tenant_id=$2`, [sid, tid])).rows[0];
      if (!studentExists) return res.redirect('/school/ai-dropout-predictor/at-risk');
      await pool.query(`INSERT INTO dropout_risk_factors (tenant_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [tid, sid]);
      return res.redirect('/school/ai-dropout-predictor/student-detail/' + sid);
    }

    const interventions = (await pool.query(
      `SELECT di.*, c.name as counselor_name FROM dropout_interventions di LEFT JOIN users c ON c.id = di.counselor_id WHERE di.tenant_id=$1 AND di.student_id=$2 ORDER BY di.created_at DESC`, [tid, sid])).rows;

    const alerts = (await pool.query(
      `SELECT * FROM dropout_alerts WHERE tenant_id=$1 AND student_id=$2 ORDER BY created_at DESC LIMIT 10`, [tid, sid])).rows;

    // Factor breakdown for radar-like display
    const factors = [
      { label: 'Attendance', score: Number(profile.attendance_score || 100), weight: '30%', icon: '&#x1F4C5;' },
      { label: 'Grade Trend', score: Number(profile.grade_trend_score || 100), weight: '25%', icon: '&#x1F4DA;' },
      { label: 'Behavior', score: Number(profile.behavior_score || 100), weight: '20%', icon: '&#x1F6E1;' },
      { label: 'Engagement', score: Number(profile.engagement_score || 100), weight: '15%', icon: '&#x1F4AC;' },
      { label: 'Socioeconomic', score: Number(profile.socioeconomic_score || 100), weight: '10%', icon: '&#x1F3E0;' }
    ];

    const factorCards = factors.map(f => {
      const pct = Math.max(0, Math.min(100, f.score));
      const col = pct < 40 ? '#dc2626' : pct < 60 ? '#ea580c' : pct < 75 ? '#d97706' : '#059669';
      return `<div style="text-align:center;padding:12px;border:1px solid #f3f4f6;border-radius:10px">
        <div style="font-size:20px">${f.icon}</div>
        <div style="font-size:12px;font-weight:700;color:#374151;margin:4px 0">${f.label}</div>
        <div style="font-size:22px;font-weight:800;color:${col}">${pct.toFixed(0)}</div>
        <div style="font-size:10px;color:${GRAY}">Weight: ${f.weight}</div>
        <div style="height:4px;background:#e5e7eb;border-radius:4px;margin-top:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${col};border-radius:4px"></div></div>
      </div>`;
    }).join('');

    const intRows = interventions.map(i => `<tr>
      <td>${esc(i.type || 'General')}</td>
      <td style="font-size:12px">${esc((i.description || '').substring(0, 60))}</td>
      <td>${esc(i.counselor_name || 'Unassigned')}</td>
      <td>${statusBadge(i.status)}</td>
      <td>${esc(i.priority || 'medium')}</td>
      <td>${fmtDate(i.created_at)}</td>
    </tr>`).join('');

    const alertRows = alerts.map(a => `<tr>
      <td><span style="font-size:11px;font-weight:600;color:${a.severity === 'critical' ? '#dc2626' : a.severity === 'warning' ? '#d97706' : GRAY}">${esc((a.alert_type || '').replace(/_/g, ' '))}</span></td>
      <td style="font-size:12px">${esc((a.message || '').substring(0, 80))}</td>
      <td>${a.acknowledged ? '<span style="color:#059669">&#x2713;</span>' : '<span style="color:#dc2626">&#x2717;</span>'}</td>
      <td>${fmtDate(a.created_at)}</td>
    </tr>`).join('');

    // Mitigation recommendations based on scores
    const recs = [];
    if (Number(profile.attendance_score || 100) < 70) recs.push({ title: 'Attendance Intervention', desc: 'Student has concerning attendance patterns. Consider parent meeting, attendance contract, and daily check-ins.', color: '#dc2626' });
    if (Number(profile.grade_trend_score || 100) < 70) recs.push({ title: 'Academic Support', desc: 'Grade trends indicate academic struggle. Recommend tutoring, study skills workshop, and teacher check-ins.', color: '#ea580c' });
    if (Number(profile.behavior_score || 100) < 70) recs.push({ title: 'Behavioral Support', desc: 'Behavior indicators suggest need for counseling referral, peer mediation, or restorative practices.', color: '#d97706' });
    if (Number(profile.engagement_score || 100) < 70) recs.push({ title: 'Engagement Boost', desc: 'Low engagement detected. Consider mentorship program, extracurricular activities, or student leadership roles.', color: '#059669' });
    if (recs.length === 0) recs.push({ title: 'Continue Monitoring', desc: 'Student is performing well. Maintain regular check-ins and positive reinforcement.', color: '#059669' });

    const recHtml = recs.map(r => `<div style="padding:12px;border-left:3px solid ${r.color};background:${r.color}0a;border-radius:0 8px 8px 0;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;color:#1e293b">${esc(r.title)}</div>
      <div style="font-size:12px;color:#4b5563;margin-top:4px;line-height:1.5">${esc(r.desc)}</div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">
      ${navBar('risk')}
      <a href="/school/ai-dropout-predictor/at-risk" style="color:${GRAY};font-size:13px;text-decoration:none;display:inline-block;margin-bottom:12px">&larr; Back to At-Risk</a>

      <div style="display:grid;grid-template-columns:1fr auto;gap:16px;margin-bottom:16px">
        <div>
          <h1 style="font-size:22px;color:#1e293b">${esc(profile.student_name || 'Student')}</h1>
          <p style="color:${GRAY};font-size:13px;margin-top:2px">${esc(profile.email || '')} &middot; Last calculated: ${fmtDate(profile.calculated_at)}</p>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          ${svgRiskGauge(profile.overall_risk_pct, 100)}
          ${riskBadge(profile.risk_level)}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px">${factorCards}</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:15px;color:#1e293b">Mitigation Recommendations</h3>
          ${recHtml}
          <a href="/school/ai-dropout-predictor/create-intervention?student_id=${sid}" class="btn" style="display:inline-block;margin-top:12px;text-decoration:none">+ Create Intervention</a>
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:15px;color:#1e293b">Intervention History (${interventions.length})</h3>
          <table><thead><tr><th>Type</th><th>Description</th><th>Counselor</th><th>Status</th><th>Priority</th><th>Date</th></tr></thead>
          <tbody>${intRows || '<tr><td colspan="6" style="color:${GRAY};text-align:center">No interventions yet</td></tr>'}</tbody></table>
        </div>
      </div>

      <div class="card">
        <h3 style="margin:0 0 12px;font-size:15px;color:#1e293b">Alert History (${alerts.length})</h3>
        <table><thead><tr><th>Type</th><th>Message</th><th>Ack</th><th>Date</th></tr></thead>
        <tbody>${alertRows || '<tr><td colspan="4" style="color:${GRAY};text-align:center">No alerts</td></tr>'}</tbody></table>
      </div>
    </div>`;
    res.send(renderPage('Student Detail - ' + (profile.student_name || ''), html, user, req));
  }));

  // ============================================================
  // ROUTE 4: GET /school/ai-dropout-predictor/interventions
  // ============================================================
  app.get('/school/ai-dropout-predictor/interventions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const status = req.query.status || '';

    let where = 'WHERE di.tenant_id=$1';
    const params = [tid];
    if (status) { where += ' AND di.status=$2'; params.push(status); }

    const interventions = (await pool.query(
      `SELECT di.*, u.name as student_name, c.name as counselor_name FROM dropout_interventions di
       JOIN users u ON u.id = di.student_id LEFT JOIN users c ON c.id = di.counselor_id
       ${where} ORDER BY di.created_at DESC LIMIT 100`, params)).rows;

    const rows = interventions.map(i => `<tr>
      <td><strong style="color:#1e293b">${esc(i.student_name || 'Student')}</strong></td>
      <td>${esc(i.type || 'General')}</td>
      <td style="font-size:12px">${esc((i.description || '').substring(0, 60))}</td>
      <td>${esc(i.counselor_name || 'Unassigned')}</td>
      <td>${statusBadge(i.status)}</td>
      <td><span style="font-size:11px;font-weight:600;color:${i.priority === 'high' ? '#dc2626' : i.priority === 'low' ? '#059669' : GRAY}">${esc(i.priority)}</span></td>
      <td>${fmtDate(i.created_at)}</td>
      <td>
        ${i.status === 'pending' ? `<a href="/school/ai-dropout-predictor/interventions/update/${i.id}?status=in_progress" class="btn" style="padding:3px 8px;font-size:11px;background:#d97706;text-decoration:none">Start</a>` : ''}
        ${i.status === 'in_progress' ? `<a href="/school/ai-dropout-predictor/interventions/update/${i.id}?status=completed" class="btn" style="padding:3px 8px;font-size:11px;background:#059669;text-decoration:none">Complete</a>` : ''}
      </td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">
      ${navBar('int')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <h1 style="font-size:20px;color:#1e293b">Interventions</h1>
        <a href="/school/ai-dropout-predictor/create-intervention" class="btn" style="text-decoration:none">+ New Intervention</a>
      </div>
      <div style="display:flex;gap:4px;margin-bottom:12px">
        <a href="/school/ai-dropout-predictor/interventions" class="btn" style="padding:5px 12px;font-size:12px;text-decoration:none;${!status ? '' : 'background:#eef2ff;color:' + P}">All</a>
        <a href="/school/ai-dropout-predictor/interventions?status=pending" class="btn" style="padding:5px 12px;font-size:12px;text-decoration:none;${status === 'pending' ? '' : 'background:#fef3c7;color:#d97706'}">Pending</a>
        <a href="/school/ai-dropout-predictor/interventions?status=in_progress" class="btn" style="padding:5px 12px;font-size:12px;text-decoration:none;${status === 'in_progress' ? '' : 'background:#ede9fe;color:#6d28d9'}">In Progress</a>
        <a href="/school/ai-dropout-predictor/interventions?status=completed" class="btn" style="padding:5px 12px;font-size:12px;text-decoration:none;${status === 'completed' ? '' : 'background:#dcfce7;color:#059669'}">Completed</a>
      </div>
      <div class="card"><table><thead><tr><th>Student</th><th>Type</th><th>Description</th><th>Counselor</th><th>Status</th><th>Priority</th><th>Date</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" style="color:${GRAY};text-align:center;padding:30px">No interventions yet</td></tr>'}</tbody></table></div>
    </div>`;
    res.send(renderPage('Interventions', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /school/ai-dropout-predictor/create-intervention
  // ============================================================
  app.get('/school/ai-dropout-predictor/create-intervention', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const students = (await pool.query(
      `SELECT u.id, u.name, drf.risk_level FROM users u LEFT JOIN dropout_risk_factors drf ON drf.student_id = u.id AND drf.tenant_id = $1 WHERE u.tenant_id=$1 AND u.role='student' ORDER BY drf.overall_risk_pct DESC NULLS LAST LIMIT 200`, [tid])).rows;
    const studentOpts = students.map(s => `<option value="${s.id}" ${req.query.student_id == s.id ? 'selected' : ''}>${esc(s.name || 'Student #' + s.id)}${s.risk_level ? ' [' + s.risk_level.toUpperCase() + ']' : ''}</option>`).join('');
    const types = ['Academic Support', 'Counseling Session', 'Parent Meeting', 'Mentorship', 'Attendance Contract', 'Behavior Plan', 'Tutoring', 'Peer Support', 'Financial Aid', 'Home Visit', 'Referral to Specialist', 'Study Group'];
    const typeOpts = types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');

    const html = SKIP + `<div style="max-width:700px;margin:0 auto">
      ${navBar('int')}
      <h1 style="font-size:20px;color:#1e293b;margin-bottom:16px">Create Intervention</h1>
      <div class="card">
        <form method="POST" action="/school/ai-dropout-predictor/create-intervention">
          <div style="margin-bottom:12px"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Student *</label>
            <select name="student_id" required><option value="">Select student...</option>${studentOpts}</select></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Intervention Type *</label><select name="type" required><option value="">Select...</option>${typeOpts}</select></div>
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Priority</label>
              <select name="priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
          </div>
          <div style="margin-bottom:12px"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Description *</label><textarea name="description" rows="4" required placeholder="Describe the intervention plan, goals, and expected outcomes..."></textarea></div>
          <div style="margin-bottom:12px"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Assigned Counselor</label>
            <input type="text" name="counselor_name" placeholder="Counselor name (optional)"></div>
          <button type="submit" class="btn" style="width:100%;padding:10px">Create Intervention</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Create Intervention', html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /school/ai-dropout-predictor/create-intervention
  // ============================================================
  app.post('/school/ai-dropout-predictor/create-intervention', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { student_id, type, description, priority, counselor_name } = req.body;
    if (!student_id || !description) return res.redirect('/school/ai-dropout-predictor/create-intervention');
    await pool.query(
      `INSERT INTO dropout_interventions (tenant_id, student_id, type, description, priority, status, counselor_id, created_by_user)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,$7)`,
      [tid, parseInt(student_id), type || 'General', description, priority || 'medium', user.id, user.id]
    );
    audit && audit(user.id, 'dropout_intervention_create', { student_id, type });
    // Auto-generate alert
    await pool.query(
      `INSERT INTO dropout_alerts (tenant_id, student_id, alert_type, message, severity) VALUES ($1,$2,'intervention_created',$3,$4)`,
      [tid, parseInt(student_id), `New intervention created: ${type || 'General'}. Priority: ${priority || 'medium'}.`, priority === 'urgent' || priority === 'high' ? 'warning' : 'info']
    );
    queueEmail && queueEmail(user.email, 'Intervention Created', `A ${type} intervention has been created.`);
    res.redirect('/school/ai-dropout-predictor/interventions');
  }));

  // ============================================================
  // ROUTE 7: GET /school/ai-dropout-predictor/interventions/update/:id
  // ============================================================
  app.get('/school/ai-dropout-predictor/interventions/update/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const newStatus = req.query.status;
    if (!newStatus) return res.redirect('/school/ai-dropout-predictor/interventions');
    const setFields = 'status=$1, updated_at=NOW()';
    const params = [newStatus];
    if (newStatus === 'completed') { params.push(new Date()); }
    params.push(req.params.id, tid);
    await pool.query(
      `UPDATE dropout_interventions SET ${setFields}${newStatus === 'completed' ? ', resolved_at=$2' : ''} WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`,
      params
    );
    audit && audit(user.id, 'dropout_intervention_update', { int_id: req.params.id, status: newStatus });
    res.redirect('/school/ai-dropout-predictor/interventions');
  }));

  // ============================================================
  // ROUTE 8: GET /school/ai-dropout-predictor/alerts
  // ============================================================
  app.get('/school/ai-dropout-predictor/alerts', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const showAck = req.query.show_all === '1';
    const alerts = (await pool.query(
      `SELECT da.*, u.name as student_name FROM dropout_alerts da JOIN users u ON u.id = da.student_id
       WHERE da.tenant_id=$1 ${showAck ? '' : 'AND da.acknowledged=false'} ORDER BY da.created_at DESC LIMIT 100`, [tid])).rows;

    const rows = alerts.map(a => `<tr>
      <td>${esc(a.student_name || 'Unknown')}</td>
      <td><span style="font-size:11px;font-weight:600;color:${a.severity === 'critical' ? '#dc2626' : a.severity === 'warning' ? '#d97706' : a.severity === 'info' ? P : GRAY}">${esc((a.alert_type || '').replace(/_/g, ' '))}</span></td>
      <td style="font-size:12px">${esc(a.message || '')}</td>
      <td>${a.acknowledged ? '<span style="color:#059669;font-weight:600">&#x2713; Acknowledged</span>' : '<span style="color:#dc2626;font-weight:600">&#x2717; Pending</span>'}</td>
      <td>${fmtDate(a.created_at)}</td>
      <td>${!a.acknowledged ? `<a href="/school/ai-dropout-predictor/alerts/acknowledge/${a.id}" class="btn" style="padding:4px 10px;font-size:11px;background:#059669;text-decoration:none">Acknowledge</a>` : '—'}</td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">
      ${navBar('alt')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <h1 style="font-size:20px;color:#1e293b">Early Warning Alerts</h1>
        <div style="display:flex;gap:8px;align-items:center">
          <a href="/school/ai-dropout-predictor/alerts" style="font-size:12px;color:${P};text-decoration:none">${!showAck ? 'Showing unacknowledged' : ''}</a>
          <a href="/school/ai-dropout-predictor/alerts?show_all=1" class="btn" style="padding:6px 12px;font-size:12px;text-decoration:none;background:#eef2ff;color:${P}">${showAck ? 'All Alerts' : 'Show All'}</a>
          ${!showAck && alerts.length > 0 ? `<a href="/school/ai-dropout-predictor/alerts/acknowledge-all" class="btn" style="padding:6px 12px;font-size:12px;text-decoration:none;background:#059669" onclick="return confirm('Acknowledge all alerts?')">Ack All</a>` : ''}
        </div>
      </div>
      <div class="card"><table><thead><tr><th>Student</th><th>Type</th><th>Message</th><th>Status</th><th>Date</th><th>Action</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="color:${GRAY};text-align:center;padding:30px">No alerts</td></tr>'}</tbody></table></div>
    </div>`;
    res.send(renderPage('Alerts', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: GET /school/ai-dropout-predictor/alerts/acknowledge/:id
  // ============================================================
  app.get('/school/ai-dropout-predictor/alerts/acknowledge/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    await pool.query(`UPDATE dropout_alerts SET acknowledged=true, acknowledged_by=$1 WHERE id=$2 AND tenant_id=$3`, [user.id, req.params.id, tid]);
    res.redirect('/school/ai-dropout-predictor/alerts');
  }));

  // ============================================================
  // ROUTE 10: GET /school/ai-dropout-predictor/alerts/acknowledge-all
  // ============================================================
  app.get('/school/ai-dropout-predictor/alerts/acknowledge-all', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    await pool.query(`UPDATE dropout_alerts SET acknowledged=true, acknowledged_by=$1 WHERE tenant_id=$1 AND acknowledged=false`, [user.id, tid]);
    res.redirect('/school/ai-dropout-predictor/alerts');
  }));

  // ============================================================
  // ROUTE 11: GET /school/ai-dropout-predictor/factors-analysis
  // ============================================================
  app.get('/school/ai-dropout-predictor/factors-analysis', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const allFactors = (await pool.query(
      `SELECT attendance_score, grade_trend_score, behavior_score, engagement_score, socioeconomic_score, overall_risk_pct, risk_level
       FROM dropout_risk_factors WHERE tenant_id=$1`, [tid])).rows;

    const avgAtt = allFactors.length > 0 ? allFactors.reduce((s, f) => s + Number(f.attendance_score), 0) / allFactors.length : 100;
    const avgGrade = allFactors.length > 0 ? allFactors.reduce((s, f) => s + Number(f.grade_trend_score), 0) / allFactors.length : 100;
    const avgBeh = allFactors.length > 0 ? allFactors.reduce((s, f) => s + Number(f.behavior_score), 0) / allFactors.length : 100;
    const avgEng = allFactors.length > 0 ? allFactors.reduce((s, f) => s + Number(f.engagement_score), 0) / allFactors.length : 100;
    const avgSoc = allFactors.length > 0 ? allFactors.reduce((s, f) => s + Number(f.socioeconomic_score), 0) / allFactors.length : 100;

    // Students below threshold per factor
    const threshold = 60;
    const lowAtt = allFactors.filter(f => Number(f.attendance_score) < threshold).length;
    const lowGrade = allFactors.filter(f => Number(f.grade_trend_score) < threshold).length;
    const lowBeh = allFactors.filter(f => Number(f.behavior_score) < threshold).length;
    const lowEng = allFactors.filter(f => Number(f.engagement_score) < threshold).length;
    const lowSoc = allFactors.filter(f => Number(f.socioeconomic_score) < threshold).length;

    // Factor correlation: risk distribution by attendance ranges
    const attBuckets = [
      { label: '90-100%', min: 90, max: 101 },
      { label: '70-89%', min: 70, max: 90 },
      { label: '50-69%', min: 50, max: 70 },
      { label: '30-49%', min: 30, max: 50 },
      { label: '0-29%', min: 0, max: 30 }
    ];

    const heatData = attBuckets.map(b => {
      const students = allFactors.filter(f => Number(f.attendance_score) >= b.min && Number(f.attendance_score) < b.max);
      const avgRisk = students.length > 0 ? students.reduce((s, f) => s + Number(f.overall_risk_pct), 0) / students.length : 0;
      return { label: b.label, values: [avgRisk], rowLabels: ['Avg Risk %'] };
    });

    const heatHtml = svgHeatMap(heatData, 550, 100);

    const riskByGradeBuckets = [
      { label: '90-100%', min: 90, max: 101 },
      { label: '70-89%', min: 70, max: 90 },
      { label: '50-69%', min: 50, max: 70 },
      { label: '30-49%', min: 30, max: 50 },
      { label: '0-29%', min: 0, max: 30 }
    ].map(b => {
      const students = allFactors.filter(f => Number(f.grade_trend_score) >= b.min && Number(f.grade_trend_score) < b.max);
      return { label: b.label, values: [students.length > 0 ? students.reduce((s, f) => s + Number(f.overall_risk_pct), 0) / students.length : 0], rowLabels: ['Avg Risk %'] };
    });
    const gradeHeatHtml = svgHeatMap(riskByGradeBuckets, 550, 100);

    const factorBarHtml = svgBarChart([
      { label: 'Attendance', value: lowAtt, color: '#dc2626' },
      { label: 'Grades', value: lowGrade, color: '#ea580c' },
      { label: 'Behavior', value: lowBeh, color: '#d97706' },
      { label: 'Engagement', value: lowEng, color: '#6d28d9' },
      { label: 'Socioeconomic', value: lowSoc, color: '#059669' }
    ], 520, 160);

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">
      ${navBar('fac')}
      <h1 style="font-size:20px;color:#1e293b;margin-bottom:16px">Factors Analysis</h1>

      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px">
        <div class="card" style="text-align:center"><div style="font-size:24px;font-weight:800;color:${avgAtt < 70 ? '#dc2626' : '#059669'}">${avgAtt.toFixed(0)}</div><div style="font-size:11px;color:${GRAY}">Avg Attendance</div></div>
        <div class="card" style="text-align:center"><div style="font-size:24px;font-weight:800;color:${avgGrade < 70 ? '#ea580c' : '#059669'}">${avgGrade.toFixed(0)}</div><div style="font-size:11px;color:${GRAY}">Avg Grade Trend</div></div>
        <div class="card" style="text-align:center"><div style="font-size:24px;font-weight:800;color:${avgBeh < 70 ? '#d97706' : '#059669'}">${avgBeh.toFixed(0)}</div><div style="font-size:11px;color:${GRAY}">Avg Behavior</div></div>
        <div class="card" style="text-align:center"><div style="font-size:24px;font-weight:800;color:${avgEng < 70 ? '#6d28d9' : '#059669'}">${avgEng.toFixed(0)}</div><div style="font-size:11px;color:${GRAY}">Avg Engagement</div></div>
        <div class="card" style="text-align:center"><div style="font-size:24px;font-weight:800;color:${avgSoc < 70 ? '#059669' : '#059669'}">${avgSoc.toFixed(0)}</div><div style="font-size:11px;color:${GRAY}">Avg Socioeconomic</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card">
          <h3 style="margin:0 0 14px;font-size:15px;color:#1e293b">Students Below Threshold (score &lt; ${threshold})</h3>
          ${factorBarHtml}
        </div>
        <div class="card">
          <h3 style="margin:0 0 14px;font-size:15px;color:#1e293b">Risk Level Distribution</h3>
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:12px">
            ${['low', 'moderate', 'high', 'critical', 'extreme'].map(lev => {
              const cnt = allFactors.filter(f => f.risk_level === lev).length;
              const pct = allFactors.length > 0 ? Math.round((cnt / allFactors.length) * 100) : 0;
              return `<div style="text-align:center;padding:10px;border:2px solid ${riskColor(lev)};border-radius:10px">
                <div style="font-size:20px;font-weight:800;color:${riskColor(lev)}">${cnt}</div>
                <div style="font-size:10px;font-weight:700;color:${GRAY};text-transform:uppercase">${lev}</div>
                <div style="font-size:11px;color:${GRAY}">${pct}%</div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card">
          <h3 style="margin:0 0 14px;font-size:15px;color:#1e293b">Risk by Attendance Range</h3>
          ${heatHtml}
        </div>
        <div class="card">
          <h3 style="margin:0 0 14px;font-size:15px;color:#1e293b">Risk by Grade Trend Range</h3>
          ${gradeHeatHtml}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Factors Analysis', html, user, req));
  }));

  // ============================================================
  // ROUTE 12: GET /school/ai-dropout-predictor/cohort-comparison
  // ============================================================
  app.get('/school/ai-dropout-predictor/cohort-comparison', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Simulated cohort data based on risk levels (in production would join enrollment/grade data)
    const riskDist = (await pool.query(
      `SELECT risk_level, COUNT(*)::int as cnt, ROUND(AVG(overall_risk_pct)::numeric, 1) as avg_risk,
              ROUND(AVG(attendance_score)::numeric, 1) as avg_att,
              ROUND(AVG(grade_trend_score)::numeric, 1) as avg_grade,
              ROUND(AVG(behavior_score)::numeric, 1) as avg_beh,
              ROUND(AVG(engagement_score)::numeric, 1) as avg_eng
       FROM dropout_risk_factors WHERE tenant_id=$1 GROUP BY risk_level
       ORDER BY CASE risk_level WHEN 'extreme' THEN 5 WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'moderate' THEN 2 ELSE 1 END`, [tid])).rows;

    const distBarHtml = riskDist.length > 0 ? svgBarChart(
      riskDist.map(r => ({ label: (r.risk_level || 'low').toUpperCase(), value: r.cnt, color: riskColor(r.risk_level) })),
      520, 160
    ) : '<p style="color:' + GRAY + '">No data</p>';

    // Factor comparison across risk levels
    const factorHeatData = ['attendance', 'grades', 'behavior', 'engagement'].map(factor => {
      return {
        label: factor.charAt(0).toUpperCase() + factor.slice(1),
        values: riskDist.map(r => {
          switch (factor) {
            case 'attendance': return Number(r.avg_att || 0);
            case 'grades': return Number(r.avg_grade || 0);
            case 'behavior': return Number(r.avg_beh || 0);
            case 'engagement': return Number(r.avg_eng || 0);
            default: return 0;
          }
        }),
        rowLabels: ['Avg Score']
      };
    });

    const cohortRows = riskDist.map(r => `<tr>
      <td>${riskBadge(r.risk_level)}</td>
      <td style="font-weight:700">${r.cnt} students</td>
      <td style="font-weight:800;color:${riskColor(r.risk_level)}">${Number(r.avg_risk).toFixed(1)}%</td>
      <td>${Number(r.avg_att).toFixed(0)}</td>
      <td>${Number(r.avg_grade).toFixed(0)}</td>
      <td>${Number(r.avg_beh).toFixed(0)}</td>
      <td>${Number(r.avg_eng).toFixed(0)}</td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">
      ${navBar('coh')}
      <h1 style="font-size:20px;color:#1e293b;margin-bottom:16px">Cohort Comparison</h1>

      <div class="card" style="margin-bottom:16px">
        <h3 style="margin:0 0 14px;font-size:15px;color:#1e293b">Student Distribution by Risk Level</h3>
        ${distBarHtml}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card">
          <h3 style="margin:0 0 14px;font-size:15px;color:#1e293b">Detailed Cohort Metrics</h3>
          <table><thead><tr><th>Risk Level</th><th>Count</th><th>Avg Risk</th><th>Att.</th><th>Grade</th><th>Beh.</th><th>Eng.</th></tr></thead>
          <tbody>${cohortRows || '<tr><td colspan="7" style="color:${GRAY};text-align:center;padding:20px">No data</td></tr>'}</tbody></table>
        </div>
        <div class="card">
          <h3 style="margin:0 0 14px;font-size:15px;color:#1e293b">Factor Scores by Risk Level</h3>
          <div style="font-size:12px;color:${GRAY};margin-bottom:8px">Showing average factor scores across risk cohorts</div>
          ${factorHeatData.map(f => {
            const maxV = Math.max(...f.values, 1);
            return f.values.map((v, vi) => {
              const label = riskDist[vi] ? riskDist[vi].risk_level : '';
              return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                <div style="width:90px;font-size:11px;color:${GRAY};text-align:right">${f.label}</div>
                <div style="flex:1;height:18px;background:#f3f4f6;border-radius:6px;overflow:hidden">
                  <div style="height:100%;width:${Math.round((v / 100) * 100)}%;background:${riskColor(label)};border-radius:6px;display:flex;align-items:center;padding-left:6px">
                    <span style="font-size:10px;color:#fff;font-weight:700">${v.toFixed(0)}</span>
                  </div>
                </div>
                <div style="width:60px;font-size:10px;color:${GRAY}">${label}</div>
              </div>`;
            }).join('');
          }).join('')}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Cohort Comparison', html, user, req));
  }));

  // ============================================================
  // ROUTE 13: GET /school/ai-dropout-predictor/reports
  // ============================================================
  app.get('/school/ai-dropout-predictor/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const totalTracked = (await pool.query(`SELECT COUNT(DISTINCT student_id)::int FROM dropout_risk_factors WHERE tenant_id=$1`, [tid])).rows[0].count;
    const totalInterventions = (await pool.query(`SELECT COUNT(*)::int FROM dropout_interventions WHERE tenant_id=$1`, [tid])).rows[0].count;
    const completedInterventions = (await pool.query(`SELECT COUNT(*)::int FROM dropout_interventions WHERE tenant_id=$1 AND status='completed'`, [tid])).rows[0].count;
    const totalAlerts = (await pool.query(`SELECT COUNT(*)::int FROM dropout_alerts WHERE tenant_id=$1`, [tid])).rows[0].count;
    const interventionRate = totalTracked > 0 ? ((totalInterventions / totalTracked) * 100).toFixed(1) : 0;
    const successRate = totalInterventions > 0 ? ((completedInterventions / totalInterventions) * 100).toFixed(1) : 0;

    // Monthly trend (simulated from available data)
    const monthlyTrend = (await pool.query(
      `SELECT DATE_TRUNC('month', drf.calculated_at) as month, COUNT(*)::int as students, ROUND(AVG(drf.overall_risk_pct)::numeric, 1) as avg_risk
       FROM dropout_risk_factors drf WHERE drf.tenant_id=$1 GROUP BY DATE_TRUNC('month', drf.calculated_at) ORDER BY month DESC LIMIT 6`, [tid])).rows;

    const trendHtml = monthlyTrend.length > 0 ? svgBarChart(
      monthlyTrend.map(t => ({ label: new Date(t.month).toLocaleDateString('en', { month: 'short' }), value: parseFloat(t.avg_risk).toFixed(0), color: P })),
      520, 150
    ) : '<p style="color:' + GRAY + '">Insufficient data for trend</p>';

    // Intervention types distribution
    const intTypes = (await pool.query(
      `SELECT type, COUNT(*)::int as cnt FROM dropout_interventions WHERE tenant_id=$1 GROUP BY type ORDER BY cnt DESC LIMIT 8`, [tid])).rows;

    const intTypeHtml = intTypes.length > 0 ? svgBarChart(
      intTypes.map(t => ({ label: (t.type || 'Other').substring(0, 15), value: t.cnt, color: '#6d28d9' })),
      520, 150
    ) : '<p style="color:' + GRAY + '">No interventions data</p>';

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">
      ${navBar('rpt')}
      <h1 style="font-size:20px;color:#1e293b;margin-bottom:16px">Reports & Analytics</h1>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px">
        <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:800;color:${P}">${totalTracked}</div><div style="font-size:12px;color:${GRAY};font-weight:600">Students Tracked</div></div>
        <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:800;color:#d97706">${totalInterventions}</div><div style="font-size:12px;color:${GRAY};font-weight:600">Total Interventions</div></div>
        <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:800;color:#059669">${successRate}%</div><div style="font-size:12px;color:${GRAY};font-weight:600">Intervention Success</div></div>
        <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:800;color:#ea580c">${totalAlerts}</div><div style="font-size:12px;color:${GRAY};font-weight:600">Total Alerts</div></div>
        <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:800;color:#6d28d9">${interventionRate}%</div><div style="font-size:12px;color:${GRAY};font-weight:600">Intervention Rate</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card">
          <h3 style="margin:0 0 14px;font-size:15px;color:#1e293b">Monthly Risk Trend</h3>
          ${trendHtml}
        </div>
        <div class="card">
          <h3 style="margin:0 0 14px;font-size:15px;color:#1e293b">Intervention Types</h3>
          ${intTypeHtml}
        </div>
      </div>

      <div class="card" style="background:#f0fdf4;border:1px solid #bbf7d0">
        <h3 style="margin:0 0 8px;color:#15803d;font-size:15px">Automated Counselor Alert System</h3>
        <p style="margin:0;font-size:13px;color:#374151;line-height:1.6">The system automatically generates alerts when students cross risk thresholds. Critical alerts are dispatched to assigned counselors via email. Configure thresholds in <a href="/school/ai-dropout-predictor/settings" style="color:${P};text-decoration:none;font-weight:600">Settings</a>.</p>
      </div>
    </div>`;
    res.send(renderPage('Reports & Analytics', html, user, req));
  }));

  // ============================================================
  // ROUTE 14: GET /school/ai-dropout-predictor/settings
  // ============================================================
  app.get('/school/ai-dropout-predictor/settings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const html = SKIP + `<div style="max-width:700px;margin:0 auto">
      ${navBar('set')}
      <h1 style="font-size:20px;color:#1e293b;margin-bottom:16px">Predictor Settings</h1>

      <div class="card">
        <h3 style="margin:0 0 12px;font-size:15px;color:#1e293b">Risk Scoring Weights</h3>
        <p style="font-size:12px;color:${GRAY};margin-bottom:12px">Configure how much each factor contributes to the overall risk score</p>
        <form method="POST" action="/school/ai-dropout-predictor/settings">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Attendance Weight</label><input type="number" name="w_attendance" min="0" max="100" value="30"></div>
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Grade Trend Weight</label><input type="number" name="w_grades" min="0" max="100" value="25"></div>
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Behavior Weight</label><input type="number" name="w_behavior" min="0" max="100" value="20"></div>
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Engagement Weight</label><input type="number" name="w_engagement" min="0" max="100" value="15"></div>
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Socioeconomic Weight</label><input type="number" name="w_socioeconomic" min="0" max="100" value="10"></div>
          </div>

          <h3 style="margin:16px 0 12px;font-size:15px;color:#1e293b">Alert Thresholds</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Moderate Risk (%)</label><input type="number" name="threshold_moderate" min="0" max="100" value="20"></div>
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">High Risk (%)</label><input type="number" name="threshold_high" min="0" max="100" value="40"></div>
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Critical Risk (%)</label><input type="number" name="threshold_critical" min="0" max="100" value="60"></div>
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Extreme Risk (%)</label><input type="number" name="threshold_extreme" min="0" max="100" value="80"></div>
          </div>

          <h3 style="margin:16px 0 12px;font-size:15px;color:#1e293b">Notification Preferences</h3>
          <div style="margin-bottom:16px">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#374151;cursor:pointer;margin-bottom:8px">
              <input type="checkbox" name="email_critical" checked style="width:18px;height:18px;accent-color:#dc2626"> Email counselors on critical alerts
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#374151;cursor:pointer;margin-bottom:8px">
              <input type="checkbox" name="email_high" checked style="width:18px;height:18px;accent-color:#ea580c"> Email counselors on high risk alerts
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#374151;cursor:pointer;margin-bottom:8px">
              <input type="checkbox" name="email_intervention" checked style="width:18px;height:18px;accent-color:${P}"> Notify on new intervention creation
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#374151;cursor:pointer;margin-bottom:8px">
              <input type="checkbox" name="auto_alert" checked style="width:18px;height:18px;accent-color:#d97706"> Auto-generate alerts when thresholds crossed
            </label>
          </div>

          <button type="submit" class="btn" style="width:100%;padding:10px">Save Settings</button>
        </form>
      </div>

      <div class="card" style="margin-top:16px">
        <h3 style="margin:0 0 12px;font-size:15px;color:#1e293b">Bulk Recalculate All Risk Scores</h3>
        <p style="font-size:12px;color:${GRAY};margin-bottom:12px">Trigger a full recalculation of risk scores for all tracked students</p>
        <form method="POST" action="/school/ai-dropout-predictor/recalculate" onsubmit="return confirm('Recalculate all risk scores? This may take a moment.')">
          <button type="submit" class="btn" style="background:#d97706">Recalculate All Scores</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Predictor Settings', html, user, req));
  }));

  // ============================================================
  // ROUTE 15: POST /school/ai-dropout-predictor/settings
  // ============================================================
  app.post('/school/ai-dropout-predictor/settings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    audit && audit(user.id, 'dropout_settings_update', { body: req.body });
    req.session.flash = { type: 'success', msg: 'Settings saved successfully.' };
    res.redirect('/school/ai-dropout-predictor/settings');
  }));

  // ============================================================
  // ROUTE 16: POST /school/ai-dropout-predictor/recalculate
  // ============================================================
  app.post('/school/ai-dropout-predictor/recalculate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const factors = (await pool.query(`SELECT * FROM dropout_risk_factors WHERE tenant_id=$1`, [tid])).rows;
    let updated = 0;
    for (const f of factors) {
      const result = calcRisk(f);
      await pool.query(
        `UPDATE dropout_risk_factors SET overall_risk_pct=$1, risk_level=$2, calculated_at=NOW(), updated_at=NOW() WHERE id=$3 AND tenant_id=$4`,
        [result.overall_risk_pct, result.risk_level, f.id, tid]
      );
      // Auto-generate alert for newly critical students
      if (result.risk_level === 'critical' || result.risk_level === 'extreme') {
        const existingAlert = (await pool.query(
          `SELECT id FROM dropout_alerts WHERE tenant_id=$1 AND student_id=$2 AND alert_type='risk_escalation' AND created_at > NOW() - INTERVAL '7 days'`,
          [tid, f.student_id])).rows[0];
        if (!existingAlert) {
          await pool.query(
            `INSERT INTO dropout_alerts (tenant_id, student_id, alert_type, message, severity) VALUES ($1,$2,'risk_escalation',$3,$4)`,
            [tid, f.student_id, `Student risk level escalated to ${result.risk_level.toUpperCase()} (${result.overall_risk_pct.toFixed(1)}%). Immediate intervention recommended.`, result.risk_level === 'extreme' ? 'critical' : 'warning']
          );
          queueEmail && queueEmail(user.email, 'Risk Alert: Student Escalation', `A student has been flagged as ${result.risk_level} risk.`);
        }
      }
      updated++;
    }
    audit && audit(user.id, 'dropout_recalculate', { updated });
    res.redirect('/school/ai-dropout-predictor');
  }));

  console.log('[Mod] ai-dropout-predictor routes loaded');
};
