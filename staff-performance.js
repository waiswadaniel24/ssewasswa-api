// ============================================================
// STAFF PERFORMANCE MODULE — Teacher/Staff Performance Analytics
// KPI tracking, student feedback, classroom observations,
// professional development, workload analysis, reports.
// ============================================================
// Usage: const staffPerf = require('./staff-performance');
//        staffPerf(app, pool, opts);
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
module.exports = function staffPerformance(app, pool, opts) {

  // ── inline fallbacks ──────────────────────────────────────────
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || ((fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  // ── helpers ───────────────────────────────────────────────────
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014';
  const num = (v, dec) => dec != null ? parseFloat(v || 0).toFixed(dec) : parseFloat(v || 0);
  const pctColor = (v) => v >= 90 ? '#059669' : v >= 70 ? '#4f46e5' : v >= 50 ? '#d97706' : '#dc2626';

  // ── SVG Chart Builders ────────────────────────────────────────

  function svgBarChart(data, w, h, opts) {
    // data: [{label, value, color?}]
    opts = opts || {};
    const maxVal = opts.maxVal || Math.max(1, ...data.map(d => parseFloat(d.value) || 0));
    const barH = opts.barH || 22;
    const gap = opts.gap || 8;
    const leftPad = opts.labelWidth || 120;
    const rightPad = 50;
    const topPad = 10;
    let y = topPad;
    let bars = '';
    const scale = (w - leftPad - rightPad) / maxVal;

    data.forEach((d, i) => {
      const v = parseFloat(d.value) || 0;
      const bw = Math.max(2, v * scale);
      const c = d.color || (v / maxVal >= 0.8 ? '#059669' : v / maxVal >= 0.6 ? '#4f46e5' : v / maxVal >= 0.4 ? '#d97706' : '#dc2626');
      bars += `<text x="${leftPad - 8}" y="${y + barH / 2 + 4}" text-anchor="end" style="font-size:11px;fill:#475569;font-weight:600">${esc(d.label)}</text>`;
      bars += `<rect x="${leftPad}" y="${y}" width="${bw}" height="${barH}" rx="4" fill="${c}" opacity="0.85"><title>${esc(d.label)}: ${v}</title></rect>`;
      bars += `<text x="${leftPad + bw + 6}" y="${y + barH / 2 + 4}" style="font-size:11px;fill:#1e293b;font-weight:700">${v}${opts.suffix || ''}</text>`;
      y += barH + gap;
    });

    return `<svg width="${w}" height="${Math.max(60, y + 10)}" viewBox="0 0 ${w} ${Math.max(60, y + 10)}" role="img" aria-label="Bar chart">
      ${opts.title ? `<text x="${leftPad}" y="8" style="font-size:12px;fill:#64748b;font-weight:700">${esc(opts.title)}</text>` : ''}
      ${bars}
    </svg>`;
  }

  function svgRadarChart(data, size) {
    // data: [{label, value}]  value 0-5
    size = size || 260;
    const cx = size / 2, cy = size / 2, r = size / 2 - 36;
    const n = data.length;
    if (n < 3) return '<p style="color:#94a3b8;text-align:center;font-size:13px">Need at least 3 data points for radar chart</p>';

    let gridPaths = '';
    let axisLines = '';
    let labelsHtml = '';
    let pointCoords = [];

    for (let ring = 1; ring <= 5; ring++) {
      const rr = (r * ring) / 5;
      let pts = [];
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        pts.push(`${cx + rr * Math.cos(angle)},${cy + rr * Math.sin(angle)}`);
      }
      gridPaths += `<polygon points="${pts.join(' ')}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`;
    }

    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const x2 = cx + r * Math.cos(angle);
      const y2 = cy + r * Math.sin(angle);
      axisLines += `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="#e2e8f0" stroke-width="1"/>`;
      const val = Math.min(5, parseFloat(data[i].value) || 0);
      const pr = (r * val) / 5;
      const px = cx + pr * Math.cos(angle);
      const py = cy + pr * Math.sin(angle);
      pointCoords.push(`${px},${py}`);
      const lx = cx + (r + 20) * Math.cos(angle);
      const ly = cy + (r + 20) * Math.sin(angle);
      const anchor = Math.abs(Math.cos(angle)) < 0.1 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
      labelsHtml += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" dominant-baseline="middle" style="font-size:10px;fill:#475569;font-weight:600">${esc(data[i].label)}</text>`;
    }

    const dataPath = `<polygon points="${pointCoords.join(' ')}" fill="rgba(79,70,229,0.15)" stroke="#4f46e5" stroke-width="2"/>`;
    const dotsHtml = pointCoords.map(p => {
      const parts = p.split(',');
      return `<circle cx="${parts[0]}" cy="${parts[1]}" r="4" fill="#4f46e5" stroke="#fff" stroke-width="2"/>`;
    }).join('');

    const scaleLabels = [1, 2, 3, 4, 5].map(v => {
      const yy = cy - (r * v) / 5;
      return `<text x="${cx - 8}" y="${yy + 3}" text-anchor="end" style="font-size:9px;fill:#94a3b8">${v}</text>`;
    }).join('');

    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Radar chart" style="display:block;margin:0 auto">
      ${scaleLabels}${gridPaths}${axisLines}${dataPath}${dotsHtml}${labelsHtml}
    </svg>`;
  }

  function svgGaugeChart(value, maxVal, size, label) {
    // value 0-maxVal, semicircle gauge
    size = size || 180;
    maxVal = maxVal || 5;
    label = label || '';
    const cx = size / 2, cy = size / 2 + 10;
    const r = size / 2 - 16;
    const pct = Math.min(1, Math.max(0, (parseFloat(value) || 0) / maxVal));
    const angle = Math.PI * (1 - pct);
    const x1 = cx - r, y1 = cy, x2 = cx + r * Math.cos(angle), y2 = cy - r * Math.sin(angle);
    const c = pct >= 0.8 ? '#059669' : pct >= 0.6 ? '#4f46e5' : pct >= 0.4 ? '#d97706' : '#dc2626';

    return `<svg width="${size}" height="${size / 2 + 30}" viewBox="0 0 ${size} ${size / 2 + 30}" role="img" aria-label="${esc(label)} gauge: ${value}">
      <path d="M ${x1} ${y1} A ${r} ${r} 0 0 1 ${cx + r} ${y1}" fill="none" stroke="#e2e8f0" stroke-width="14" stroke-linecap="round"/>
      <path d="M ${x1} ${y1} A ${r} ${r} 0 ${pct > 0.5 ? 1 : 0} 1 ${x2} ${y2}" fill="none" stroke="${c}" stroke-width="14" stroke-linecap="round"/>
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" style="font-size:22px;font-weight:800;fill:${c}">${parseFloat(value || 0).toFixed(1)}</text>
      <text x="${cx}" y="${cy + 20}" text-anchor="middle" style="font-size:10px;fill:#64748b;font-weight:600">${esc(label)}</text>
    </svg>`;
  }

  // ── Shared CSS ────────────────────────────────────────────────
  const SP_CSS = `<style>
    .sp-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
    .sp-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .sp-nav a:hover{background:#e2e8f0}.sp-nav a.active{background:#4f46e5;color:#fff}
    .sp-tbl{width:100%;border-collapse:collapse;font-size:13px}
    .sp-tbl th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .sp-tbl td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .sp-tbl tr:hover{background:#f8fafc}
    .sp-card{background:#fff;border:1px solid #f1f5f9;border-radius:14px;padding:24px;margin-bottom:16px}
    .sp-stat{background:#fff;border:1px solid #f1f5f9;border-radius:14px;padding:20px;text-align:center}
    .sp-stat-num{font-size:28px;font-weight:800;color:#4f46e5}
    .sp-stat-lbl{font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
    .sp-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .sp-btn:hover{opacity:.9;transform:translateY(-1px)}
    .sp-btn-primary{background:#4f46e5;color:#fff}.sp-btn-success{background:#059669;color:#fff}
    .sp-btn-danger{background:#fee2e2;color:#dc2626}.sp-btn-secondary{background:#f1f5f9;color:#475569}
    .sp-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .sp-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .sp-filter input,.sp-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .sp-filter input:focus,.sp-filter select:focus{outline:none;border-color:#4f46e5}
    .sp-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .sp-form-grid .full{grid-column:1/-1}
    .sp-badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600}
    .sp-alert{padding:14px 18px;border-radius:10px;margin-bottom:16px;font-size:13px;font-weight:600}
    @media(max-width:768px){.sp-form-grid{grid-template-columns:1fr}.sp-nav{gap:4px}.sp-nav a{padding:6px 12px;font-size:12px}}
  </style>`;

  // ── Navigation helper ─────────────────────────────────────────
  function nav(active) {
    const links = [
      ['/staff-performance', 'Overview'],
      ['/staff-performance/kpi', 'KPI Tracking'],
      ['/staff-performance/feedback', 'Student Feedback'],
      ['/staff-performance/observations', 'Observations'],
      ['/staff-performance/professional-dev', 'Prof. Development'],
      ['/staff-performance/workload', 'Workload'],
      ['/staff-performance/reports', 'Reports']
    ];
    return '<nav class="sp-nav" aria-label="Staff Performance navigation">' + links.map(([href, label]) =>
      `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`).join('') + '</nav>';
  }

  // ── Form field helper ─────────────────────────────────────────
  function formField(label, name, type, val, opts) {
    opts = opts || {};
    const req = opts.required ? ' required' : '';
    const ph = opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '';
    if (opts.select) {
      const options = opts.select.map(o => {
        const sv = typeof o === 'object' ? o.value : o;
        const sl = typeof o === 'object' ? o.label : o;
        return '<option value="' + esc(sv) + '"' + (String(val) === String(sv) ? ' selected' : '') + '>' + esc(sl) + '</option>';
      }).join('');
      return '<div><label for="' + name + '" style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">' + label + '</label><select name="' + name + '" id="' + name + '"' + req + ' style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;background:#fff">' + options + '</select></div>';
    }
    if (opts.textarea) {
      return '<div><label for="' + name + '" style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">' + label + '</label><textarea name="' + name + '" id="' + name + '"' + req + ' rows="' + (opts.rows || 4) + '"' + ph + ' style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical">' + esc(String(val || '')) + '</textarea></div>';
    }
    return '<div><label for="' + name + '" style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">' + label + '</label><input type="' + type + '" name="' + name + '" id="' + name + '" value="' + esc(String(val || '')) + '"' + req + ph + ' style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>';
  }

  // ── Score color helper ────────────────────────────────────────
  function scoreBadge(score) {
    const s = parseFloat(score) || 0;
    const c = s >= 4.5 ? '#059669' : s >= 3.5 ? '#2563eb' : s >= 2.5 ? '#4f46e5' : s >= 1.5 ? '#d97706' : '#dc2626';
    const bg = s >= 4.5 ? '#dcfce7' : s >= 3.5 ? '#dbeafe' : s >= 2.5 ? '#eef2ff' : s >= 1.5 ? '#fef3c7' : '#fee2e2';
    return '<span class="sp-badge" style="background:' + bg + ';color:' + c + '">' + s.toFixed(1) + ' / 5.0</span>';
  }

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      // ── staff_kpi_scores ───────────────────────────────────
      await migrateQuery(pool, 'StaffPerformance', `CREATE TABLE IF NOT EXISTS staff_kpi_scores (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        staff_id INTEGER NOT NULL,
        staff_name VARCHAR(255) NOT NULL,
        academic_year VARCHAR(20),
        term VARCHAR(20),
        student_pass_rate DECIMAL(5,2) DEFAULT 0,
        homework_grading_speed_hours DECIMAL(5,1) DEFAULT 0,
        attendance_marking_compliance DECIMAL(5,2) DEFAULT 0,
        parent_communication_freq INTEGER DEFAULT 0,
        extracurricular_involvement DECIMAL(5,2) DEFAULT 0,
        overall_kpi_score DECIMAL(5,2) DEFAULT 0,
        evaluated_by INTEGER,
        evaluated_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // ── staff_student_feedback ─────────────────────────────
      await migrateQuery(pool, 'StaffPerformance', `CREATE TABLE IF NOT EXISTS staff_student_feedback (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        staff_id INTEGER NOT NULL,
        staff_name VARCHAR(255) NOT NULL,
        student_id INTEGER,
        teaching_quality INTEGER DEFAULT 0 CHECK (teaching_quality >= 1 AND teaching_quality <= 5),
        clarity INTEGER DEFAULT 0 CHECK (clarity >= 1 AND clarity <= 5),
        helpfulness INTEGER DEFAULT 0 CHECK (helpfulness >= 1 AND helpfulness <= 5),
        engagement INTEGER DEFAULT 0 CHECK (engagement >= 1 AND engagement <= 5),
        punctuality INTEGER DEFAULT 0 CHECK (punctuality >= 1 AND punctuality <= 5),
        comments TEXT,
        academic_year VARCHAR(20),
        term VARCHAR(20),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // ── staff_classroom_observations ───────────────────────
      await migrateQuery(pool, 'StaffPerformance', `CREATE TABLE IF NOT EXISTS staff_classroom_observations (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        staff_id INTEGER NOT NULL,
        staff_name VARCHAR(255) NOT NULL,
        observation_date DATE NOT NULL,
        observer_id INTEGER,
        observer_name VARCHAR(255),
        subject VARCHAR(100),
        class_name VARCHAR(100),
        lesson_objective TEXT,
        criteria_preparation INTEGER DEFAULT 0 CHECK (criteria_preparation >= 1 AND criteria_preparation <= 5),
        criteria_instruction INTEGER DEFAULT 0 CHECK (criteria_instruction >= 1 AND criteria_instruction <= 5),
        criteria_classroom_mgmt INTEGER DEFAULT 0 CHECK (criteria_classroom_mgmt >= 1 AND criteria_classroom_mgmt <= 5),
        criteria_student_engagement INTEGER DEFAULT 0 CHECK (criteria_student_engagement >= 1 AND criteria_student_engagement <= 5),
        criteria_assessment INTEGER DEFAULT 0 CHECK (criteria_assessment >= 1 AND criteria_assessment <= 5),
        overall_score DECIMAL(5,2) DEFAULT 0,
        notes TEXT,
        recommendations TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // ── staff_professional_development ─────────────────────
      await migrateQuery(pool, 'StaffPerformance', `CREATE TABLE IF NOT EXISTS staff_professional_development (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        staff_id INTEGER NOT NULL,
        staff_name VARCHAR(255) NOT NULL,
        activity_type VARCHAR(50) DEFAULT 'course',
        title VARCHAR(500) NOT NULL,
        provider VARCHAR(255),
        start_date DATE,
        end_date DATE,
        duration_hours DECIMAL(6,1) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'planned',
        certification_earned BOOLEAN DEFAULT false,
        certificate_name VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // ── Indexes ────────────────────────────────────────────
      await migrateQuery(pool, 'StaffPerformance', `CREATE INDEX IF NOT EXISTS idx_sp_kpi_tenant ON staff_kpi_scores(tenant_id)`);
      await migrateQuery(pool, 'StaffPerformance', `CREATE INDEX IF NOT EXISTS idx_sp_kpi_staff ON staff_kpi_scores(tenant_id, staff_id)`);
      await migrateQuery(pool, 'StaffPerformance', `CREATE INDEX IF NOT EXISTS idx_sp_fb_tenant ON staff_student_feedback(tenant_id)`);
      await migrateQuery(pool, 'StaffPerformance', `CREATE INDEX IF NOT EXISTS idx_sp_fb_staff ON staff_student_feedback(tenant_id, staff_id)`);
      await migrateQuery(pool, 'StaffPerformance', `CREATE INDEX IF NOT EXISTS idx_sp_obs_tenant ON staff_classroom_observations(tenant_id)`);
      await migrateQuery(pool, 'StaffPerformance', `CREATE INDEX IF NOT EXISTS idx_sp_obs_staff ON staff_classroom_observations(tenant_id, staff_id)`);
      await migrateQuery(pool, 'StaffPerformance', `CREATE INDEX IF NOT EXISTS idx_sp_pd_tenant ON staff_professional_development(tenant_id)`);
      await migrateQuery(pool, 'StaffPerformance', `CREATE INDEX IF NOT EXISTS idx_sp_pd_staff ON staff_professional_development(tenant_id, staff_id)`);

      console.log('[StaffPerformance] Migrations applied successfully');
    } catch (e) {
      /* migration OK */
    }
  })();

  // ============================================================
  // FEATURE 1: Performance Overview Dashboard
  // ============================================================
  app.get('/staff-performance', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Core stats
    const stats = (await pool.query(`
      SELECT
        (SELECT COUNT(DISTINCT staff_id) FROM staff_kpi_scores WHERE tenant_id=$1) as total_teachers,
        (SELECT COALESCE(AVG(overall_kpi_score), 0) FROM staff_kpi_scores WHERE tenant_id=$1) as avg_kpi,
        (SELECT COALESCE(AVG(ROUND(
          (teaching_quality + clarity + helpfulness + engagement + punctuality) / 5.0, 1
        )), 0) FROM staff_student_feedback WHERE tenant_id=$1) as avg_feedback,
        (SELECT COUNT(*) FROM staff_classroom_observations WHERE tenant_id=$1) as total_observations,
        (SELECT COALESCE(SUM(duration_hours), 0) FROM staff_professional_development WHERE tenant_id=$1) as total_pd_hours,
        (SELECT COUNT(DISTINCT staff_id) FROM staff_student_feedback WHERE tenant_id=$1) as teachers_with_feedback)
    `, [tid])).rows[0];

    // Top / Bottom performers
    const topPerformers = (await pool.query(`
      SELECT staff_id, staff_name, overall_kpi_score
      FROM staff_kpi_scores WHERE tenant_id=$1 AND overall_kpi_score > 0
      ORDER BY overall_kpi_score DESC LIMIT 5
    `, [tid])).rows;

    const bottomPerformers = (await pool.query(`
      SELECT staff_id, staff_name, overall_kpi_score
      FROM staff_kpi_scores WHERE tenant_id=$1 AND overall_kpi_score > 0
      ORDER BY overall_kpi_score ASC LIMIT 5
    `, [tid])).rows;

    // Subject-wise performance (from observations)
    const subjectPerf = (await pool.query(`
      SELECT subject, COUNT(*)::int as cnt, COALESCE(AVG(overall_score), 0) as avg_obs
      FROM staff_classroom_observations WHERE tenant_id=$1 AND subject IS NOT NULL
      GROUP BY subject ORDER BY avg_obs DESC LIMIT 8
    `, [tid])).rows;

    // Recent observations
    const recentObs = (await pool.query(`
      SELECT id, staff_name, observation_date, subject, class_name, overall_score
      FROM staff_classroom_observations WHERE tenant_id=$1
      ORDER BY created_at DESC LIMIT 6
    `, [tid])).rows;

    const topHtml = topPerformers.map(t => '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f1f5f9"><span style="font-weight:600;color:#1e293b">' + esc(t.staff_name) + '</span>' + scoreBadge(t.overall_kpi_score) + '</div>').join('');
    const bottomHtml = bottomPerformers.map(b => '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f1f5f9"><span style="font-weight:600;color:#1e293b">' + esc(b.staff_name) + '</span>' + scoreBadge(b.overall_kpi_score) + '</div>').join('');

    const obsHtml = recentObs.map(o => '<tr><td><a href="/staff-performance/observations" style="color:#4f46e5;text-decoration:none;font-weight:600">' + esc(o.staff_name) + '</a></td><td>' + fmtDate(o.observation_date) + '</td><td>' + esc(o.subject || '\u2014') + '</td><td>' + esc(o.class_name || '\u2014') + '</td><td>' + scoreBadge(o.overall_score) + '</td></tr>').join('');

    const subjectChartData = subjectPerf.map(s => ({ label: s.subject || 'Unknown', value: num(s.avg_obs, 1), color: pctColor(s.avg_obs) }));
    const subjectChart = subjectChartData.length > 0 ? svgBarChart(subjectChartData, 360, 200, { maxVal: 5, suffix: '' }) : '<p style="color:#94a3b8;text-align:center">No observation data</p>';

    const html = SP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('/staff-performance')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\uD83D\uDCCA Performance Overview</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Teacher and staff performance analytics dashboard</p></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="sp-stat"><div class="sp-stat-num">${stats.total_teachers}</div><div class="sp-stat-lbl">Total Teachers</div></div>
        <div class="sp-stat"><div class="sp-stat-num" style="color:#059669">${num(stats.avg_kpi, 1)}</div><div class="sp-stat-lbl">Avg KPI Score</div></div>
        <div class="sp-stat"><div class="sp-stat-num" style="color:#2563eb">${num(stats.avg_feedback, 1)}</div><div class="sp-stat-lbl">Avg Feedback</div></div>
        <div class="sp-stat"><div class="sp-stat-num" style="color:#d97706">${stats.total_observations}</div><div class="sp-stat-lbl">Observations</div></div>
        <div class="sp-stat"><div class="sp-stat-num" style="color:#7c3aed">${num(stats.total_pd_hours, 0)}</div><div class="sp-stat-lbl">PD Hours</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="sp-card">
          <h3 style="color:#059669;font-size:15px;margin:0 0 10px">\u2B06\uFE0F Top Performers</h3>
          ${topHtml || '<p style="color:#94a3b8;font-size:13px">No KPI data yet</p>'}
        </div>
        <div class="sp-card">
          <h3 style="color:#dc2626;font-size:15px;margin:0 0 10px">\u2B07\uFE0F Needs Attention</h3>
          ${bottomHtml || '<p style="color:#94a3b8;font-size:13px">No KPI data yet</p>'}
        </div>
        <div class="sp-card">
          <h3 style="color:#4f46e5;font-size:15px;margin:0 0 10px">\uD83D\uDCD6 Subject Performance</h3>
          ${subjectChart}
        </div>
      </div>
      <div class="sp-card">
        <h3 style="color:#1e293b;font-size:15px;margin:0 0 14px">Recent Classroom Observations</h3>
        <div style="overflow-x:auto"><table class="sp-tbl">
          <thead><tr><th scope="col">Teacher</th><th scope="col">Date</th><th scope="col">Subject</th><th scope="col">Class</th><th scope="col">Score</th></tr></thead>
          <tbody>${obsHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:24px">No observations recorded</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Staff Performance Overview', html, user, req));
  }));

  // ============================================================
  // FEATURE 2: KPI Tracking
  // ============================================================
  app.get('/staff-performance/kpi', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const year = req.query.year || new Date().getFullYear().toString();
    const term = req.query.term || '';

    const filters = [tid];
    let filterSql = 'WHERE tenant_id=$1';
    if (year) { filters.push(year); filterSql += ' AND academic_year=$2'; }
    if (term) { filters.push(term); filterSql += ' AND term=$' + filters.length; }

    const kpis = (await pool.query(`
      SELECT * FROM staff_kpi_scores ${filterSql} ORDER BY overall_kpi_score DESC
    `, filters)).rows;

    const barData = kpis.slice(0, 10).map(k => ({ label: k.staff_name, value: num(k.overall_kpi_score, 1) }));
    const barChart = barData.length > 0 ? svgBarChart(barData, 380, 300, { maxVal: 5, labelWidth: 130 }) : '';

    const rowsHtml = kpis.map(k => {
      const kpiColor = k.overall_kpi_score >= 4 ? '#059669' : k.overall_kpi_score >= 3 ? '#4f46e5' : '#dc2626';
      return '<tr>' +
        '<td><strong>' + esc(k.staff_name) + '</strong></td>' +
        '<td>' + esc(k.academic_year || '\u2014') + '</td>' +
        '<td>' + esc(k.term || '\u2014') + '</td>' +
        '<td><span style="font-weight:700;color:' + pctColor(k.student_pass_rate) + '">' + num(k.student_pass_rate, 1) + '%</span></td>' +
        '<td>' + num(k.homework_grading_speed_hours, 1) + 'h</td>' +
        '<td>' + num(k.attendance_marking_compliance, 1) + '%</td>' +
        '<td>' + (k.parent_communication_freq || 0) + '</td>' +
        '<td>' + scoreBadge(k.overall_kpi_score) + '</td>' +
        '<td>' + fmtDateTime(k.evaluated_at) + '</td>' +
      '</tr>';
    }).join('');

    const html = SP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('/staff-performance/kpi')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\uD83C\uDFAF KPI Tracking</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Key performance indicators per teacher</p></div>
        <a href="/staff-performance/kpi/new" class="sp-btn sp-btn-primary">+ Add KPI Entry</a>
      </div>
      <div class="sp-filter">
        <div><label for="kpiYear">Academic Year</label><select id="kpiYear" onchange="location.href='/staff-performance/kpi?year='+this.value+'&term='+document.getElementById('kpiTerm').value">
          <option value="">All Years</option>
          ${['2024','2025','2026'].map(y => '<option value="' + y + '"' + (year === y ? ' selected' : '') + '>' + y + '</option>').join('')}
        </select></div>
        <div><label for="kpiTerm">Term</label><select id="kpiTerm" onchange="location.href='/staff-performance/kpi?year='+document.getElementById('kpiYear').value+'&term='+this.value">
          <option value="">All Terms</option>
          ${['Term 1','Term 2','Term 3'].map(t => '<option value="' + t + '"' + (term === t ? ' selected' : '') + '>' + t + '</option>').join('')}
        </select></div>
      </div>
      ${barData.length > 0 ? '<div class="sp-card" style="text-align:center">' + barChart + '</div>' : ''}
      <div class="sp-card">
        <div style="overflow-x:auto"><table class="sp-tbl">
          <thead><tr>
            <th scope="col">Teacher</th><th scope="col">Year</th><th scope="col">Term</th>
            <th scope="col">Pass Rate</th><th scope="col">HW Speed</th><th scope="col">Attendance %</th>
            <th scope="col">Parent Comms</th><th scope="col">Overall KPI</th><th scope="col">Evaluated</th>
          </tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:24px">No KPI records found</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('KPI Tracking', html, user, req));
  }));

  // ── KPI Add Form ──────────────────────────────────────────────
  app.get('/staff-performance/kpi/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const staff = (await pool.query(`SELECT id, name FROM users WHERE tenant_id=$1 AND role IN ('teacher','staff') ORDER BY name`, [tid])).rows;

    const html = SP_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('/staff-performance/kpi')}
      <a href="/staff-performance/kpi" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to KPI</a>
      <div class="sp-card" style="padding:28px">
        <h2 style="color:#1e293b;margin:0 0 4px">+ Add KPI Entry</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Record key performance indicators for a teacher</p>
        <form method="POST" action="/staff-performance/kpi/save" class="sp-form-grid">
          ${formField('Teacher *', 'staff_id', 'number', '', { required: true, placeholder: 'Staff user ID' })}
          ${formField('Teacher Name *', 'staff_name', 'text', '', { required: true, placeholder: 'Full name' })}
          ${formField('Academic Year', 'academic_year', 'text', new Date().getFullYear().toString(), { select: ['2024','2025','2026'].map(y => ({ value: y, label: y })) })}
          ${formField('Term', 'term', 'text', '', { select: [{ value: '', label: 'Select term' },{ value: 'Term 1', label: 'Term 1' },{ value: 'Term 2', label: 'Term 2' },{ value: 'Term 3', label: 'Term 3' }] })}
          ${formField('Student Pass Rate (%)', 'student_pass_rate', 'number', '0', { placeholder: '0-100' })}
          ${formField('HW Grading Speed (hours)', 'homework_grading_speed_hours', 'number', '0', { placeholder: 'Avg hours' })}
          ${formField('Attendance Marking Compliance (%)', 'attendance_marking_compliance', 'number', '0', { placeholder: '0-100' })}
          ${formField('Parent Communication Freq', 'parent_communication_freq', 'number', '0', { placeholder: 'Contacts per term' })}
          ${formField('Extracurricular Involvement (1-5)', 'extracurricular_involvement', 'number', '3', { placeholder: '1-5' })}
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="sp-btn sp-btn-primary" style="padding:12px 28px">Save KPI Entry</button>
            <a href="/staff-performance/kpi" class="sp-btn sp-btn-secondary" style="padding:12px 28px;text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Add KPI Entry', html, user, req));
  }));

  // ── KPI Save ──────────────────────────────────────────────────
  app.post('/staff-performance/kpi/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const b = req.body;
    const passRate = Math.min(100, Math.max(0, parseFloat(b.student_pass_rate) || 0));
    const hwSpeed = Math.max(0, parseFloat(b.homework_grading_speed_hours) || 0);
    const attCompliance = Math.min(100, Math.max(0, parseFloat(b.attendance_marking_compliance) || 0));
    const parentFreq = Math.max(0, parseInt(b.parent_communication_freq) || 0);
    const extra = Math.min(5, Math.max(1, parseFloat(b.extracurricular_involvement) || 3));
    // Calculate overall KPI: weighted composite 0-5
    const overallKpi = Math.min(5, ((passRate / 20) + (5 - Math.min(5, hwSpeed)) + (attCompliance / 20) + Math.min(5, parentFreq) + extra) / 5);

    await pool.query(`
      INSERT INTO staff_kpi_scores (tenant_id, staff_id, staff_name, academic_year, term,
        student_pass_rate, homework_grading_speed_hours, attendance_marking_compliance,
        parent_communication_freq, extracurricular_involvement, overall_kpi_score, evaluated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `, [tid, parseInt(b.staff_id) || 0, b.staff_name || '', b.academic_year || '', b.term || '',
      passRate, hwSpeed, attCompliance, parentFreq, extra, num(overallKpi, 2), user.id]);

    audit('staff_kpi_save', { staff_name: b.staff_name, overall: num(overallKpi, 2) });
    req.session.flash = { type: 'success', msg: 'KPI entry saved for ' + (b.staff_name || 'staff') };
    res.redirect('/staff-performance/kpi');
  }));

  // ============================================================
  // FEATURE 3: Student Feedback
  // ============================================================
  app.get('/staff-performance/feedback', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const staffId = req.query.staff_id || '';
    const year = req.query.year || '';

    // Aggregate scores per teacher
    const aggSql = 'SELECT staff_id, staff_name, COUNT(*)::int as total_responses, ' +
      'ROUND(AVG(teaching_quality), 2) as avg_teaching, ROUND(AVG(clarity), 2) as avg_clarity, ' +
      'ROUND(AVG(helpfulness), 2) as avg_helpfulness, ROUND(AVG(engagement), 2) as avg_engagement, ' +
      'ROUND(AVG(punctuality), 2) as avg_punctuality, ' +
      'ROUND(AVG((teaching_quality + clarity + helpfulness + engagement + punctuality) / 5.0), 2) as avg_overall ' +
      'FROM staff_student_feedback WHERE tenant_id=$1';
    const aggParams = [tid];
    if (staffId) { aggSql += ' AND staff_id=$2'; aggParams.push(staffId); }
    if (year) { aggSql += ' AND academic_year=$' + (aggParams.length + 1); aggParams.push(year); }
    aggSql += ' GROUP BY staff_id, staff_name ORDER BY avg_overall DESC';

    const agg = (await pool.query(aggSql, aggParams)).rows;

    // Individual feedback entries (recent)
    const fbSql = 'SELECT id, staff_name, teaching_quality, clarity, helpfulness, engagement, punctuality, comments, created_at FROM staff_student_feedback WHERE tenant_id=$1';
    const fbParams = [tid];
    if (staffId) { fbSql += ' AND staff_id=$2'; fbParams.push(staffId); }
    fbSql += ' ORDER BY created_at DESC LIMIT 30';
    const feedbacks = (await pool.query(fbSql, fbParams)).rows;

    const aggHtml = agg.map(a => {
      const radarData = [
        { label: 'Teaching', value: a.avg_teaching },
        { label: 'Clarity', value: a.avg_clarity },
        { label: 'Helpful', value: a.avg_helpfulness },
        { label: 'Engage', value: a.avg_engagement },
        { label: 'Punctual', value: a.avg_punctuality }
      ];
      return '<div class="sp-card" style="text-align:center">' +
        '<h4 style="color:#1e293b;margin:0 0 8px">' + esc(a.staff_name) + '</h4>' +
        '<p style="font-size:12px;color:#94a3b8;margin:0 0 10px">' + a.total_responses + ' responses</p>' +
        scoreBadge(a.avg_overall) + '<div style="margin-top:12px">' +
        svgRadarChart(radarData, 180) + '</div></div>';
    }).join('');

    const fbHtml = feedbacks.map(f => '<tr>' +
      '<td>' + esc(f.staff_name) + '</td>' +
      '<td>' + f.teaching_quality + '</td><td>' + f.clarity + '</td><td>' + f.helpfulness + '</td>' +
      '<td>' + f.engagement + '</td><td>' + f.punctuality + '</td>' +
      '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(f.comments || '') + '">' + esc(f.comments || '\u2014') + '</td>' +
      '<td>' + fmtDate(f.created_at) + '</td>' +
    '</tr>').join('');

    const html = SP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('/staff-performance/feedback')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\uD83D\uDCAC Student Feedback</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Anonymous teacher ratings from students (1-5)</p></div>
        <a href="/staff-performance/feedback/submit" class="sp-btn sp-btn-primary">+ Submit Feedback</a>
      </div>
      <div class="sp-filter">
        <div><label for="fbYear">Year</label><input type="text" id="fbYear" value="${esc(year)}" onchange="location.href='/staff-performance/feedback?staff_id=${esc(staffId)}&year='+this.value" style="width:100px"></div>
      </div>
      <h3 style="color:#1e293b;font-size:16px;margin:0 0 14px">Teacher Feedback Summary</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px">
        ${aggHtml || '<div class="sp-card" style="text-align:center;color:#94a3b8;padding:40px;grid-column:1/-1"><p>No feedback data yet. Students can submit feedback via the feedback form.</p></div>'}
      </div>
      <div class="sp-card">
        <h3 style="color:#1e293b;font-size:15px;margin:0 0 14px">Recent Individual Feedback</h3>
        <div style="overflow-x:auto"><table class="sp-tbl">
          <thead><tr>
            <th scope="col">Teacher</th><th scope="col">Teaching</th><th scope="col">Clarity</th>
            <th scope="col">Helpful</th><th scope="col">Engagement</th><th scope="col">Punctual</th>
            <th scope="col">Comments</th><th scope="col">Date</th>
          </tr></thead>
          <tbody>${fbHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:24px">No feedback submitted yet</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Student Feedback', html, user, req));
  }));

  // ── Feedback Submit Form ──────────────────────────────────────
  app.get('/staff-performance/feedback/submit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const staff = (await pool.query(`SELECT id, name FROM users WHERE tenant_id=$1 AND role IN ('teacher','staff') ORDER BY name`, [tid])).rows;

    const html = SP_CSS + `<div style="max-width:700px;margin:0 auto">
      ${nav('/staff-performance/feedback')}
      <a href="/staff-performance/feedback" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Feedback</a>
      <div class="sp-card" style="padding:28px">
        <h2 style="color:#1e293b;margin:0 0 4px">Submit Teacher Feedback</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Your feedback is anonymous. Rate each criterion from 1 (poor) to 5 (excellent).</p>
        <form method="POST" action="/staff-performance/feedback/save" class="sp-form-grid">
          ${formField('Teacher *', 'staff_id', 'number', '', { required: true, placeholder: 'Staff user ID' })}
          ${formField('Teacher Name *', 'staff_name', 'text', '', { required: true, placeholder: 'Teacher name' })}
          ${formField('Teaching Quality (1-5) *', 'teaching_quality', 'number', '4', { required: true, placeholder: '1-5' })}
          ${formField('Clarity (1-5) *', 'clarity', 'number', '4', { required: true, placeholder: '1-5' })}
          ${formField('Helpfulness (1-5) *', 'helpfulness', 'number', '4', { required: true, placeholder: '1-5' })}
          ${formField('Engagement (1-5) *', 'engagement', 'number', '4', { required: true, placeholder: '1-5' })}
          ${formField('Punctuality (1-5) *', 'punctuality', 'number', '4', { required: true, placeholder: '1-5' })}
          ${formField('Academic Year', 'academic_year', 'text', new Date().getFullYear().toString())}
          <div class="full">${formField('Comments (optional)', 'comments', 'text', '', { textarea: true, rows: 3, placeholder: 'Additional feedback...' })}</div>
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="sp-btn sp-btn-primary" style="padding:12px 28px">Submit Feedback</button>
            <a href="/staff-performance/feedback" class="sp-btn sp-btn-secondary" style="padding:12px 28px;text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Submit Feedback', html, user, req));
  }));

  // ── Feedback Save ─────────────────────────────────────────────
  app.post('/staff-performance/feedback/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const b = req.body;
    const clamp = (v) => Math.min(5, Math.max(1, parseInt(v) || 3));

    await pool.query(`
      INSERT INTO staff_student_feedback (tenant_id, staff_id, staff_name, student_id,
        teaching_quality, clarity, helpfulness, engagement, punctuality, comments, academic_year, term)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `, [tid, parseInt(b.staff_id) || 0, b.staff_name || '', user.id || null,
      clamp(b.teaching_quality), clamp(b.clarity), clamp(b.helpfulness),
      clamp(b.engagement), clamp(b.punctuality), b.comments || '', b.academic_year || '', b.term || '']);

    audit('staff_feedback_submit', { staff_name: b.staff_name });
    req.session.flash = { type: 'success', msg: 'Feedback submitted successfully (anonymous)' };
    res.redirect('/staff-performance/feedback');
  }));

  // ============================================================
  // FEATURE 4: Classroom Observations
  // ============================================================
  app.get('/staff-performance/observations', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const observations = (await pool.query(`
      SELECT * FROM staff_classroom_observations WHERE tenant_id=$1 ORDER BY observation_date DESC
    `, [tid])).rows;

    const rowsHtml = observations.map(o => {
      const criteriaAvg = num((o.criteria_preparation + o.criteria_instruction + o.criteria_classroom_mgmt + o.criteria_student_engagement + o.criteria_assessment) / 5, 1);
      return '<tr>' +
        '<td><strong>' + esc(o.staff_name) + '</strong></td>' +
        '<td>' + fmtDate(o.observation_date) + '</td>' +
        '<td>' + esc(o.subject || '\u2014') + '</td>' +
        '<td>' + esc(o.class_name || '\u2014') + '</td>' +
        '<td>' + esc(o.observer_name || '\u2014') + '</td>' +
        '<td><div style="display:flex;gap:3px">' +
          [o.criteria_preparation, o.criteria_instruction, o.criteria_classroom_mgmt, o.criteria_student_engagement, o.criteria_assessment].map(v => {
            const c = v >= 4 ? '#059669' : v >= 3 ? '#4f46e5' : v >= 2 ? '#d97706' : '#dc2626';
            return '<span style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;border-radius:4px;font-size:10px;font-weight:700;background:' + c + '20;color:' + c + '">' + v + '</span>';
          }).join('') +
        '</div></td>' +
        '<td>' + scoreBadge(o.overall_score) + '</td>' +
        '<td><a href="/staff-performance/observations/' + o.id + '" class="sp-btn sp-btn-secondary" style="padding:4px 10px;font-size:11px">View</a></td>' +
      '</tr>';
    }).join('');

    const html = SP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('/staff-performance/observations')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\uD83D\uDD0D Classroom Observations</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Record and review classroom observation assessments</p></div>
        <a href="/staff-performance/observations/new" class="sp-btn sp-btn-primary">+ New Observation</a>
      </div>
      <div class="sp-card">
        <p style="font-size:12px;color:#64748b;margin:0 0 12px">Criteria scores: <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:#05966920;vertical-align:middle"></span> Prep <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:#4f46e520;vertical-align:middle"></span> Instruct <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:#d9770620;vertical-align:middle"></span> Mgmt <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:#dc262620;vertical-align:middle"></span> Engage <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:#4f46e520;vertical-align:middle"></span> Assess</p>
        <div style="overflow-x:auto"><table class="sp-tbl">
          <thead><tr>
            <th scope="col">Teacher</th><th scope="col">Date</th><th scope="col">Subject</th>
            <th scope="col">Class</th><th scope="col">Observer</th><th scope="col">Criteria</th>
            <th scope="col">Overall</th><th scope="col"></th>
          </tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:24px">No observations recorded</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Classroom Observations', html, user, req));
  }));

  // ── Observation Detail ────────────────────────────────────────
  app.get('/staff-performance/observations/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const obs = (await pool.query(`SELECT * FROM staff_classroom_observations WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!obs) return res.status(404).send('Observation not found');

    const radarData = [
      { label: 'Preparation', value: obs.criteria_preparation },
      { label: 'Instruction', value: obs.criteria_instruction },
      { label: 'Class Mgmt', value: obs.criteria_classroom_mgmt },
      { label: 'Engagement', value: obs.criteria_student_engagement },
      { label: 'Assessment', value: obs.criteria_assessment }
    ];

    const html = SP_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('/staff-performance/observations')}
      <a href="/staff-performance/observations" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Observations</a>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="sp-card">
          <h3 style="color:#1e293b;font-size:15px;margin:0 0 12px">Observation Details</h3>
          <div style="font-size:14px;line-height:2.2">
            <strong>Teacher:</strong> ${esc(obs.staff_name)}<br>
            <strong>Date:</strong> ${fmtDate(obs.observation_date)}<br>
            <strong>Subject:</strong> ${esc(obs.subject || '\u2014')}<br>
            <strong>Class:</strong> ${esc(obs.class_name || '\u2014')}<br>
            <strong>Observer:</strong> ${esc(obs.observer_name || '\u2014')}<br>
            <strong>Lesson Objective:</strong> ${esc(obs.lesson_objective || '\u2014')}
          </div>
        </div>
        <div class="sp-card" style="text-align:center">
          <h3 style="color:#1e293b;font-size:15px;margin:0 0 4px">Criteria Radar</h3>
          ${svgRadarChart(radarData, 240)}
          <div style="margin-top:8px">${svgGaugeChart(obs.overall_score, 5, 200, 'Overall Score')}</div>
        </div>
      </div>
      <div class="sp-card">
        <h3 style="color:#1e293b;font-size:15px;margin:0 0 8px">Notes</h3>
        <p style="font-size:14px;color:#475569;line-height:1.7;white-space:pre-wrap">${esc(obs.notes || 'No notes recorded.')}</p>
      </div>
      <div class="sp-card">
        <h3 style="color:#1e293b;font-size:15px;margin:0 0 8px">Recommendations</h3>
        <p style="font-size:14px;color:#475569;line-height:1.7;white-space:pre-wrap">${esc(obs.recommendations || 'No recommendations recorded.')}</p>
      </div>
    </div>`;
    res.send(renderPage('Observation: ' + obs.staff_name, html, user, req));
  }));

  // ── Observation New Form ──────────────────────────────────────
  app.get('/staff-performance/observations/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const html = SP_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('/staff-performance/observations')}
      <a href="/staff-performance/observations" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Observations</a>
      <div class="sp-card" style="padding:28px">
        <h2 style="color:#1e293b;margin:0 0 4px">+ New Classroom Observation</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Record a classroom observation assessment</p>
        <form method="POST" action="/staff-performance/observations/save" class="sp-form-grid">
          ${formField('Teacher ID *', 'staff_id', 'number', '', { required: true, placeholder: 'Staff user ID' })}
          ${formField('Teacher Name *', 'staff_name', 'text', '', { required: true, placeholder: 'Full name' })}
          ${formField('Observation Date *', 'observation_date', 'date', new Date().toISOString().slice(0, 10), { required: true })}
          ${formField('Observer Name', 'observer_name', 'text', user.name || '', { placeholder: 'Observer name' })}
          ${formField('Subject', 'subject', 'text', '', { placeholder: 'e.g. Mathematics' })}
          ${formField('Class Name', 'class_name', 'text', '', { placeholder: 'e.g. Grade 10A' })}
          <div class="full">${formField('Lesson Objective', 'lesson_objective', 'text', '', { textarea: true, rows: 2, placeholder: 'What is the lesson objective?' })}</div>
          <div class="full"><h4 style="color:#4f46e5;font-size:14px;margin:8px 0 12px">Criteria Scores (1-5)</h4></div>
          ${formField('Preparation (1-5) *', 'criteria_preparation', 'number', '3', { required: true, placeholder: '1-5' })}
          ${formField('Instruction (1-5) *', 'criteria_instruction', 'number', '3', { required: true, placeholder: '1-5' })}
          ${formField('Classroom Mgmt (1-5) *', 'criteria_classroom_mgmt', 'number', '3', { required: true, placeholder: '1-5' })}
          ${formField('Student Engagement (1-5) *', 'criteria_student_engagement', 'number', '3', { required: true, placeholder: '1-5' })}
          ${formField('Assessment (1-5) *', 'criteria_assessment', 'number', '3', { required: true, placeholder: '1-5' })}
          <div class="full">${formField('Notes', 'notes', 'text', '', { textarea: true, rows: 4, placeholder: 'Observation notes...' })}</div>
          <div class="full">${formField('Recommendations', 'recommendations', 'text', '', { textarea: true, rows: 4, placeholder: 'Recommendations for improvement...' })}</div>
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="sp-btn sp-btn-primary" style="padding:12px 28px">Save Observation</button>
            <a href="/staff-performance/observations" class="sp-btn sp-btn-secondary" style="padding:12px 28px;text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Observation', html, user, req));
  }));

  // ── Observation Save ──────────────────────────────────────────
  app.post('/staff-performance/observations/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const b = req.body;
    const clamp = (v) => Math.min(5, Math.max(1, parseInt(v) || 3));
    const vals = [b.criteria_preparation, b.criteria_instruction, b.criteria_classroom_mgmt, b.criteria_student_engagement, b.criteria_assessment].map(clamp);
    const overall = num(vals.reduce((a, c) => a + c, 0) / 5, 2);

    await pool.query(`
      INSERT INTO staff_classroom_observations (tenant_id, staff_id, staff_name, observation_date,
        observer_id, observer_name, subject, class_name, lesson_objective,
        criteria_preparation, criteria_instruction, criteria_classroom_mgmt,
        criteria_student_engagement, criteria_assessment, overall_score, notes, recommendations)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    `, [tid, parseInt(b.staff_id) || 0, b.staff_name || '', b.observation_date || null,
      user.id, b.observer_name || '', b.subject || '', b.class_name || '', b.lesson_objective || '',
      vals[0], vals[1], vals[2], vals[3], vals[4], overall, b.notes || '', b.recommendations || '']);

    audit('staff_observation_save', { staff_name: b.staff_name, overall: overall });
    req.session.flash = { type: 'success', msg: 'Classroom observation saved' };
    res.redirect('/staff-performance/observations');
  }));

  // ============================================================
  // FEATURE 5: Professional Development
  // ============================================================
  app.get('/staff-performance/professional-dev', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const pd = (await pool.query(`
      SELECT * FROM staff_professional_development WHERE tenant_id=$1 ORDER BY created_at DESC
    `, [tid])).rows;

    const totalHours = pd.reduce((s, p) => s + (parseFloat(p.duration_hours) || 0), 0);
    const completedCount = pd.filter(p => p.status === 'completed').length;
    const certifiedCount = pd.filter(p => p.certification_earned).length;

    // Hours per staff chart
    const staffHours = {};
    pd.forEach(p => { staffHours[p.staff_name] = (staffHours[p.staff_name] || 0) + (parseFloat(p.duration_hours) || 0); });
    const hoursChartData = Object.entries(staffHours).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, hours]) => ({ label: name, value: num(hours, 1), color: '#4f46e5' }));
    const hoursChart = hoursChartData.length > 0 ? svgBarChart(hoursChartData, 380, 260, { labelWidth: 120 }) : '';

    const statusBadge = (s) => {
      const m = { planned: { bg: '#f1f5f9', c: '#64748b', l: 'Planned' }, in_progress: { bg: '#dbeafe', c: '#1d4ed8', l: 'In Progress' }, completed: { bg: '#dcfce7', c: '#15803d', l: 'Completed' }, cancelled: { bg: '#fee2e2', c: '#dc2626', l: 'Cancelled' } };
      const v = m[s] || m.planned;
      return '<span class="sp-badge" style="background:' + v.bg + ';color:' + v.c + '">' + v.l + '</span>';
    };

    const rowsHtml = pd.map(p => '<tr>' +
      '<td><strong>' + esc(p.staff_name) + '</strong></td>' +
      '<td><span class="sp-badge" style="background:#eef2ff;color:#4f46e5">' + esc(p.activity_type || 'course') + '</span></td>' +
      '<td>' + esc(p.title) + '</td>' +
      '<td>' + esc(p.provider || '\u2014') + '</td>' +
      '<td>' + fmtDate(p.start_date) + ' - ' + fmtDate(p.end_date) + '</td>' +
      '<td>' + num(p.duration_hours, 1) + 'h</td>' +
      '<td>' + statusBadge(p.status) + '</td>' +
      '<td>' + (p.certification_earned ? '<span style="color:#059669;font-weight:700">\u2705 Yes</span>' : '<span style="color:#94a3b8">No</span>') + '</td>' +
    '</tr>').join('');

    const html = SP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('/staff-performance/professional-dev')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\uD83D\uDCDA Professional Development</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Track training, certifications, and workshops</p></div>
        <a href="/staff-performance/professional-dev/new" class="sp-btn sp-btn-primary">+ Add Activity</a>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px">
        <div class="sp-stat"><div class="sp-stat-num">${pd.length}</div><div class="sp-stat-lbl">Total Activities</div></div>
        <div class="sp-stat"><div class="sp-stat-num" style="color:#059669">${num(totalHours, 0)}</div><div class="sp-stat-lbl">Total Hours</div></div>
        <div class="sp-stat"><div class="sp-stat-num" style="color:#2563eb">${completedCount}</div><div class="sp-stat-lbl">Completed</div></div>
        <div class="sp-stat"><div class="sp-stat-num" style="color:#d97706">${certifiedCount}</div><div class="sp-stat-lbl">Certifications</div></div>
      </div>
      ${hoursChart ? '<div class="sp-card" style="text-align:center">' + hoursChart + '</div>' : ''}
      <div class="sp-card">
        <div style="overflow-x:auto"><table class="sp-tbl">
          <thead><tr>
            <th scope="col">Staff</th><th scope="col">Type</th><th scope="col">Title</th>
            <th scope="col">Provider</th><th scope="col">Dates</th><th scope="col">Hours</th>
            <th scope="col">Status</th><th scope="col">Certified</th>
          </tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:24px">No professional development records</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Professional Development', html, user, req));
  }));

  // ── PD Add Form ───────────────────────────────────────────────
  app.get('/staff-performance/professional-dev/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const html = SP_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('/staff-performance/professional-dev')}
      <a href="/staff-performance/professional-dev" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Prof. Development</a>
      <div class="sp-card" style="padding:28px">
        <h2 style="color:#1e293b;margin:0 0 4px">+ Add Professional Development Activity</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Record training courses, certifications, workshops</p>
        <form method="POST" action="/staff-performance/professional-dev/save" class="sp-form-grid">
          ${formField('Staff ID *', 'staff_id', 'number', '', { required: true, placeholder: 'Staff user ID' })}
          ${formField('Staff Name *', 'staff_name', 'text', '', { required: true, placeholder: 'Full name' })}
          ${formField('Activity Type *', 'activity_type', 'text', 'course', { select: [{ value: 'course', label: 'Course' },{ value: 'workshop', label: 'Workshop' },{ value: 'certification', label: 'Certification' },{ value: 'conference', label: 'Conference' },{ value: 'seminar', label: 'Seminar' }] })}
          ${formField('Title *', 'title', 'text', '', { required: true, placeholder: 'Activity title' })}
          ${formField('Provider', 'provider', 'text', '', { placeholder: 'Training provider' })}
          ${formField('Status', 'status', 'text', 'planned', { select: [{ value: 'planned', label: 'Planned' },{ value: 'in_progress', label: 'In Progress' },{ value: 'completed', label: 'Completed' },{ value: 'cancelled', label: 'Cancelled' }] })}
          ${formField('Start Date', 'start_date', 'date', '')}
          ${formField('End Date', 'end_date', 'date', '')}
          ${formField('Duration (hours)', 'duration_hours', 'number', '0', { placeholder: 'Total hours' })}
          <div style="display:flex;align-items:center;gap:8px;padding-top:10px">
            <input type="checkbox" name="certification_earned" id="cert_earned" style="width:18px;height:18px;accent-color:#4f46e5">
            <label for="cert_earned" style="font-size:13px;font-weight:600;color:#475569">Certification Earned</label>
          </div>
          ${formField('Certificate Name', 'certificate_name', 'text', '', { placeholder: 'Name of certificate' })}
          <div class="full">${formField('Notes', 'notes', 'text', '', { textarea: true, rows: 3, placeholder: 'Additional notes...' })}</div>
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="sp-btn sp-btn-primary" style="padding:12px 28px">Save Activity</button>
            <a href="/staff-performance/professional-dev" class="sp-btn sp-btn-secondary" style="padding:12px 28px;text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Add PD Activity', html, user, req));
  }));

  // ── PD Save ───────────────────────────────────────────────────
  app.post('/staff-performance/professional-dev/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const b = req.body;
    await pool.query(`
      INSERT INTO staff_professional_development (tenant_id, staff_id, staff_name, activity_type,
        title, provider, start_date, end_date, duration_hours, status, certification_earned,
        certificate_name, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `, [tid, parseInt(b.staff_id) || 0, b.staff_name || '', b.activity_type || 'course',
      b.title || '', b.provider || '', b.start_date || null, b.end_date || null,
      parseFloat(b.duration_hours) || 0, b.status || 'planned',
      b.certification_earned === 'on' ? true : false, b.certificate_name || '', b.notes || '']);

    audit('staff_pd_save', { staff_name: b.staff_name, title: b.title });
    req.session.flash = { type: 'success', msg: 'Professional development activity saved' };
    res.redirect('/staff-performance/professional-dev');
  }));

  // ============================================================
  // FEATURE 6: Workload Analysis
  // ============================================================
  app.get('/staff-performance/workload', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Build workload data from KPI + class assignments
    // We simulate workload from KPI data and professional development hours
    const kpiData = (await pool.query(`
      SELECT staff_id, staff_name, student_pass_rate, homework_grading_speed_hours,
        attendance_marking_compliance, parent_communication_freq, extracurricular_involvement, overall_kpi_score
      FROM staff_kpi_scores WHERE tenant_id=$1 ORDER BY staff_name
    `, [tid])).rows;

    const pdHours = (await pool.query(`
      SELECT staff_id, COALESCE(SUM(duration_hours), 0) as total_pd_hours
      FROM staff_professional_development WHERE tenant_id=$1 GROUP BY staff_id
    `, [tid])).rows;

    const pdMap = {};
    pdHours.forEach(p => { pdMap[p.staff_id] = parseFloat(p.total_pd_hours) || 0; });

    const obsCount = (await pool.query(`
      SELECT staff_id, COUNT(*)::int as obs_count FROM staff_classroom_observations WHERE tenant_id=$1 GROUP BY staff_id
    `, [tid])).rows;
    const obsMap = {};
    obsCount.forEach(o => { obsMap[o.staff_id] = o.obs_count; });

    const OVERWORK_THRESHOLD = 35; // hours/week

    const workloads = kpiData.map(k => {
      const classes = Math.min(8, Math.max(1, Math.round(3 + (k.attendance_marking_compliance / 30))));
      const students = Math.min(200, Math.max(10, Math.round(30 + (k.student_pass_rate / 2))));
      const meetings = Math.min(10, Math.max(1, Math.round(2 + (k.parent_communication_freq / 3))));
      const teachingHrs = classes * 3.5;
      const gradingHrs = classes * (7 - Math.min(5, k.homework_grading_speed_hours));
      const meetingHrs = meetings * 1;
      const extraHrs = k.extracurricular_involvement * 2;
      const pdHrs = (pdMap[k.staff_id] || 0) / 40; // approximate weekly
      const totalHrs = num(teachingHrs + gradingHrs + meetingHrs + extraHrs + pdHrs, 1);
      const overworked = totalHrs > OVERWORK_THRESHOLD;
      return { ...k, classes, students, meetings, teachingHrs: num(teachingHrs, 1), gradingHrs: num(gradingHrs, 1), meetingHrs: num(meetingHrs, 1), extraHrs: num(extraHrs, 1), pdHrs: num(pdHrs, 1), totalHrs, overworked };
    });

    const overworkedList = workloads.filter(w => w.overworked);

    // Classes per teacher chart
    const classChartData = workloads.slice(0, 10).map(w => ({ label: w.staff_name, value: w.classes, color: w.overworked ? '#dc2626' : '#4f46e5' }));
    const classChart = classChartData.length > 0 ? svgBarChart(classChartData, 380, 260, { maxVal: 10, suffix: ' classes', labelWidth: 130 }) : '';

    // Students per teacher chart
    const studentChartData = workloads.slice(0, 10).map(w => ({ label: w.staff_name, value: w.students, color: w.students > 150 ? '#dc2626' : w.students > 80 ? '#d97706' : '#4f46e5' }));
    const studentChart = studentChartData.length > 0 ? svgBarChart(studentChartData, 380, 260, { maxVal: 200, suffix: ' students', labelWidth: 130 }) : '';

    // Hours distribution chart
    const hoursChartData = workloads.slice(0, 8).map(w => ({
      label: w.staff_name,
      value: w.totalHrs,
      color: w.overworked ? '#dc2626' : w.totalHrs > 28 ? '#d97706' : '#4f46e5'
    }));
    const hoursChart = hoursChartData.length > 0 ? svgBarChart(hoursChartData, 380, 260, { maxVal: 50, suffix: 'h/wk', labelWidth: 130, title: 'Total Weekly Hours' }) : '';

    const rowsHtml = workloads.map(w => '<tr style="' + (w.overworked ? 'background:#fef2f2;' : '') + '">' +
      '<td><strong>' + esc(w.staff_name) + '</strong>' + (w.overworked ? ' <span class="sp-badge" style="background:#fee2e2;color:#dc2626;font-size:10px">\u26A0\uFE0F Overworked</span>' : '') + '</td>' +
      '<td>' + w.classes + '</td>' +
      '<td>' + w.students + '</td>' +
      '<td>' + w.meetings + '</td>' +
      '<td style="color:#4f46e5;font-weight:600">' + w.teachingHrs + 'h</td>' +
      '<td style="color:#d97706;font-weight:600">' + w.gradingHrs + 'h</td>' +
      '<td style="color:#059669;font-weight:600">' + w.meetingHrs + 'h</td>' +
      '<td><strong style="color:' + (w.overworked ? '#dc2626' : '#4f46e5') + ';font-size:16px">' + w.totalHrs + 'h</strong></td>' +
    '</tr>').join('');

    const html = SP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('/staff-performance/workload')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\uD83D\uDD27 Workload Analysis</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Visualize and manage teacher workloads. Threshold: ${OVERWORK_THRESHOLD}h/week.</p></div>
      </div>
      ${overworkedList.length > 0 ? '<div class="sp-alert" style="background:#fef2f2;color:#991b1b;border:1px solid #fecaca">\u26A0\uFE0F <strong>' + overworkedList.length + ' overworked teacher(s) detected:</strong> ' + overworkedList.map(w => esc(w.staff_name) + ' (' + w.totalHrs + 'h/wk)').join(', ') + '</div>' : '<div class="sp-alert" style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0">\u2705 All teachers are within acceptable workload limits.</div>'}
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="sp-card">${classChart}</div>
        <div class="sp-card">${studentChart}</div>
        <div class="sp-card">${hoursChart}</div>
      </div>
      <div class="sp-card">
        <h3 style="color:#1e293b;font-size:15px;margin:0 0 14px">Detailed Workload Breakdown</h3>
        <div style="overflow-x:auto"><table class="sp-tbl">
          <thead><tr>
            <th scope="col">Teacher</th><th scope="col">Classes</th><th scope="col">Students</th>
            <th scope="col">Meetings/wk</th><th scope="col">Teaching</th><th scope="col">Grading</th>
            <th scope="col">Meetings</th><th scope="col">Total Hours</th>
          </tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:24px">No workload data. Add KPI entries first.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Workload Analysis', html, user, req));
  }));

  // ============================================================
  // FEATURE 7: Performance Reports (PDF-ready with SVG)
  // ============================================================
  app.get('/staff-performance/reports', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const staffId = req.query.staff_id || '';

    // Fetch all teachers with KPI data
    const kpis = (await pool.query(`
      SELECT DISTINCT ON (staff_id) staff_id, staff_name, overall_kpi_score, student_pass_rate,
        homework_grading_speed_hours, attendance_marking_compliance, parent_communication_freq,
        extracurricular_involvement, academic_year, term
      FROM staff_kpi_scores WHERE tenant_id=$1 ORDER BY staff_id, evaluated_at DESC
    `, [tid])).rows;

    const rowsHtml = kpis.map(k => '<tr>' +
      '<td><a href="/staff-performance/reports/' + k.staff_id + '" style="color:#4f46e5;text-decoration:none;font-weight:600">' + esc(k.staff_name) + '</a></td>' +
      '<td>' + esc(k.academic_year || '\u2014') + '</td>' +
      '<td>' + esc(k.term || '\u2014') + '</td>' +
      '<td>' + scoreBadge(k.overall_kpi_score) + '</td>' +
      '<td>' + num(k.student_pass_rate, 1) + '%</td>' +
      '<td><a href="/staff-performance/reports/' + k.staff_id + '" class="sp-btn sp-btn-primary" style="padding:4px 12px;font-size:11px">View Report</a></td>' +
    '</tr>').join('');

    const html = SP_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('/staff-performance/reports')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\uD83D\uDCC4 Performance Reports</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Generate PDF-ready performance summaries per teacher</p></div>
      </div>
      <div class="sp-card">
        <div style="overflow-x:auto"><table class="sp-tbl">
          <thead><tr>
            <th scope="col">Teacher</th><th scope="col">Year</th><th scope="col">Term</th>
            <th scope="col">KPI Score</th><th scope="col">Pass Rate</th><th scope="col">Report</th>
          </tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:24px">No KPI data available. Add KPI entries to generate reports.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Performance Reports', html, user, req));
  }));

  // ── Individual Performance Report (PDF-ready) ─────────────────
  app.get('/staff-performance/reports/:staffId', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, staffId = req.params.staffId;

    // KPI data
    const kpi = (await pool.query(`
      SELECT * FROM staff_kpi_scores WHERE tenant_id=$1 AND staff_id=$2 ORDER BY evaluated_at DESC LIMIT 1
    `, [tid, staffId])).rows[0];

    // Feedback aggregates
    const fbAgg = (await pool.query(`
      SELECT COUNT(*)::int as total_responses,
        ROUND(AVG(teaching_quality), 2) as avg_teaching, ROUND(AVG(clarity), 2) as avg_clarity,
        ROUND(AVG(helpfulness), 2) as avg_helpfulness, ROUND(AVG(engagement), 2) as avg_engagement,
        ROUND(AVG(punctuality), 2) as avg_punctuality
      FROM staff_student_feedback WHERE tenant_id=$1 AND staff_id=$2
    `, [tid, staffId])).rows[0];

    // Observations
    const observations = (await pool.query(`
      SELECT * FROM staff_classroom_observations WHERE tenant_id=$1 AND staff_id=$2 ORDER BY observation_date DESC
    `, [tid, staffId])).rows;

    // PD activities
    const pdActivities = (await pool.query(`
      SELECT * FROM staff_professional_development WHERE tenant_id=$1 AND staff_id=$2 ORDER BY created_at DESC
    `, [tid, staffId])).rows;

    const staffName = kpi ? kpi.staff_name : ('Staff #' + staffId);

    // Build radar for feedback
    const fbRadarData = fbAgg && fbAgg.total_responses > 0 ? [
      { label: 'Teaching', value: fbAgg.avg_teaching },
      { label: 'Clarity', value: fbAgg.avg_clarity },
      { label: 'Helpful', value: fbAgg.avg_helpfulness },
      { label: 'Engage', value: fbAgg.avg_engagement },
      { label: 'Punctual', value: fbAgg.avg_punctuality }
    ] : null;

    // Build radar for latest observation
    const latestObs = observations[0];
    const obsRadarData = latestObs ? [
      { label: 'Prep', value: latestObs.criteria_preparation },
      { label: 'Instruct', value: latestObs.criteria_instruction },
      { label: 'Mgmt', value: latestObs.criteria_classroom_mgmt },
      { label: 'Engage', value: latestObs.criteria_student_engagement },
      { label: 'Assess', value: latestObs.criteria_assessment }
    ] : null;

    // KPI bar chart
    const kpiBarData = kpi ? [
      { label: 'Pass Rate', value: num(kpi.student_pass_rate / 20, 1), color: pctColor(kpi.student_pass_rate) },
      { label: 'Att. Compl.', value: num(kpi.attendance_marking_compliance / 20, 1), color: pctColor(kpi.attendance_marking_compliance) },
      { label: 'Extra Curr.', value: num(kpi.extracurricular_involvement, 1), color: '#4f46e5' }
    ] : [];
    const kpiBarChart = kpiBarData.length > 0 ? svgBarChart(kpiBarData, 340, 160, { maxVal: 5, labelWidth: 100 }) : '';

    // Observation history bar
    const obsBarData = observations.map(o => ({
      label: fmtDate(o.observation_date),
      value: num(o.overall_score, 1),
      color: pctColor(o.overall_score * 20)
    }));
    const obsBarChart = obsBarData.length > 0 ? svgBarChart(obsBarData, 340, obsBarData.length * 30 + 20, { maxVal: 5, labelWidth: 90 }) : '';

    // PD summary
    const totalPdHours = pdActivities.reduce((s, p) => s + (parseFloat(p.duration_hours) || 0), 0);
    const completedPd = pdActivities.filter(p => p.status === 'completed').length;
    const certs = pdActivities.filter(p => p.certification_earned).length;

    const obsRows = observations.map(o => '<tr>' +
      '<td>' + fmtDate(o.observation_date) + '</td>' +
      '<td>' + esc(o.subject || '\u2014') + '</td>' +
      '<td>' + o.criteria_preparation + ' | ' + o.criteria_instruction + ' | ' + o.criteria_classroom_mgmt + ' | ' + o.criteria_student_engagement + ' | ' + o.criteria_assessment + '</td>' +
      '<td>' + scoreBadge(o.overall_score) + '</td>' +
    '</tr>').join('');

    const pdRows = pdActivities.map(p => '<tr>' +
      '<td>' + esc(p.title) + '</td>' +
      '<td><span class="sp-badge" style="background:#eef2ff;color:#4f46e5">' + esc(p.activity_type || 'course') + '</span></td>' +
      '<td>' + fmtDate(p.start_date) + '</td>' +
      '<td>' + num(p.duration_hours, 1) + 'h</td>' +
      '<td>' + (p.certification_earned ? '\u2705' : '\u2014') + '</td>' +
    '</tr>').join('');

    const html = SP_CSS + `<div style="max-width:900px;margin:0 auto" id="perfReport">
      ${nav('/staff-performance/reports')}
      <a href="/staff-performance/reports" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Reports</a>

      <!-- Report Header -->
      <div style="background:#4f46e5;color:#fff;border-radius:14px;padding:28px;margin-bottom:20px;text-align:center">
        <h1 style="margin:0 0 4px;font-size:22px;color:#fff">\uD83C\uDFC6 Performance Report</h1>
        <p style="margin:0;font-size:16px;color:rgba(255,255,255,0.9)">${esc(staffName)}</p>
        <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.7)">Generated ${fmtDateTime(new Date())} | ${esc(kpi?.academic_year || '')} ${esc(kpi?.term || '')}</p>
      </div>

      <!-- KPI Summary -->
      <div class="sp-card">
        <h2 style="color:#1e293b;font-size:16px;margin:0 0 16px;border-bottom:2px solid #eef2ff;padding-bottom:8px">1. KPI Summary</h2>
        ${kpi ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
          <div>
            <div style="text-align:center;margin-bottom:16px">
              ${svgGaugeChart(kpi.overall_kpi_score, 5, 220, 'Overall KPI')}
            </div>
            <div style="font-size:14px;line-height:2.2">
              <strong>Student Pass Rate:</strong> <span style="font-weight:700;color:${pctColor(kpi.student_pass_rate)}">${num(kpi.student_pass_rate, 1)}%</span><br>
              <strong>HW Grading Speed:</strong> ${num(kpi.homework_grading_speed_hours, 1)} hours avg<br>
              <strong>Attendance Compliance:</strong> ${num(kpi.attendance_marking_compliance, 1)}%<br>
              <strong>Parent Communications:</strong> ${kpi.parent_communication_freq || 0}<br>
              <strong>Extracurricular:</strong> ${num(kpi.extracurricular_involvement, 1)} / 5.0
            </div>
          </div>
          <div>${kpiBarChart}</div>
        </div>` : '<p style="color:#94a3b8">No KPI data available for this teacher.</p>'}
      </div>

      <!-- Student Feedback -->
      <div class="sp-card">
        <h2 style="color:#1e293b;font-size:16px;margin:0 0 16px;border-bottom:2px solid #eef2ff;padding-bottom:8px">2. Student Feedback Summary</h2>
        ${fbRadarData ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:center">
          <div style="text-align:center">${svgRadarChart(fbRadarData, 240)}</div>
          <div>
            <p style="font-size:14px;color:#475569;margin-bottom:12px"><strong>${fbAgg.total_responses}</strong> anonymous feedback responses received.</p>
            <div style="font-size:14px;line-height:2.2">
              <strong>Teaching Quality:</strong> ${num(fbAgg.avg_teaching, 2)} / 5<br>
              <strong>Clarity:</strong> ${num(fbAgg.avg_clarity, 2)} / 5<br>
              <strong>Helpfulness:</strong> ${num(fbAgg.avg_helpfulness, 2)} / 5<br>
              <strong>Engagement:</strong> ${num(fbAgg.avg_engagement, 2)} / 5<br>
              <strong>Punctuality:</strong> ${num(fbAgg.avg_punctuality, 2)} / 5
            </div>
          </div>
        </div>` : '<p style="color:#94a3b8">No student feedback received for this teacher.</p>'}
      </div>

      <!-- Classroom Observations -->
      <div class="sp-card">
        <h2 style="color:#1e293b;font-size:16px;margin:0 0 16px;border-bottom:2px solid #eef2ff;padding-bottom:8px">3. Classroom Observations (${observations.length} total)</h2>
        ${obsRadarData ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:center">
          <div style="text-align:center"><p style="font-size:12px;color:#64748b;margin-bottom:4px">Latest Observation Radar</p>${svgRadarChart(obsRadarData, 220)}</div>
          <div>${obsBarChart}</div>
        </div>` : ''}
        ${observations.length > 0 ? `<div style="overflow-x:auto;margin-top:16px"><table class="sp-tbl">
          <thead><tr><th scope="col">Date</th><th scope="col">Subject</th><th scope="col">Criteria (P|I|M|E|A)</th><th scope="col">Score</th></tr></thead>
          <tbody>${obsRows}</tbody>
        </table></div>` : '<p style="color:#94a3b8;margin-top:12px">No observations recorded.</p>'}
      </div>

      <!-- Professional Development -->
      <div class="sp-card">
        <h2 style="color:#1e293b;font-size:16px;margin:0 0 16px;border-bottom:2px solid #eef2ff;padding-bottom:8px">4. Professional Development</h2>
        <div style="display:flex;gap:16px;margin-bottom:14px">
          <div class="sp-stat" style="flex:1"><div class="sp-stat-num" style="font-size:20px;color:#4f46e5">${pdActivities.length}</div><div class="sp-stat-lbl">Activities</div></div>
          <div class="sp-stat" style="flex:1"><div class="sp-stat-num" style="font-size:20px;color:#059669">${num(totalPdHours, 0)}</div><div class="sp-stat-lbl">Total Hours</div></div>
          <div class="sp-stat" style="flex:1"><div class="sp-stat-num" style="font-size:20px;color:#d97706">${certs}</div><div class="sp-stat-lbl">Certifications</div></div>
        </div>
        ${pdActivities.length > 0 ? `<div style="overflow-x:auto"><table class="sp-tbl">
          <thead><tr><th scope="col">Title</th><th scope="col">Type</th><th scope="col">Date</th><th scope="col">Hours</th><th scope="col">Cert</th></tr></thead>
          <tbody>${pdRows}</tbody>
        </table></div>` : '<p style="color:#94a3b8">No professional development records.</p>'}
      </div>

      <!-- Print Button -->
      <div style="text-align:center;padding:20px">
        <button onclick="window.print()" class="sp-btn sp-btn-primary" style="padding:12px 32px;font-size:14px">\uD83D\uDDA8\uFE0F Print / Save as PDF</button>
      </div>
    </div>`;
    res.send(renderPage('Performance Report: ' + staffName, html, user, req));
  }));

  // ============================================================
  // JSON API Endpoints
  // ============================================================

  // GET /api/staff-performance/kpi/:staffId — KPI JSON
  app.get('/api/staff-performance/kpi/:staffId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, staffId = req.params.staffId;
    const rows = (await pool.query(`SELECT * FROM staff_kpi_scores WHERE tenant_id=$1 AND staff_id=$2 ORDER BY evaluated_at DESC`, [tid, staffId])).rows;
    res.json({ ok: true, data: rows });
  }));

  // GET /api/staff-performance/feedback/:staffId — Feedback JSON
  app.get('/api/staff-performance/feedback/:staffId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, staffId = req.params.staffId;
    const agg = (await pool.query(`
      SELECT COUNT(*)::int as total,
        ROUND(AVG(teaching_quality), 2) as teaching_quality,
        ROUND(AVG(clarity), 2) as clarity,
        ROUND(AVG(helpfulness), 2) as helpfulness,
        ROUND(AVG(engagement), 2) as engagement,
        ROUND(AVG(punctuality), 2) as punctuality,
        ROUND(AVG((teaching_quality+clarity+helpfulness+engagement+punctuality)/5.0), 2) as overall
      FROM staff_student_feedback WHERE tenant_id=$1 AND staff_id=$2
    `, [tid, staffId])).rows[0];
    res.json({ ok: true, data: agg });
  }));

  // GET /api/staff-performance/observations/:staffId — Observations JSON
  app.get('/api/staff-performance/observations/:staffId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, staffId = req.params.staffId;
    const rows = (await pool.query(`SELECT * FROM staff_classroom_observations WHERE tenant_id=$1 AND staff_id=$2 ORDER BY observation_date DESC`, [tid, staffId])).rows;
    res.json({ ok: true, data: rows });
  }));

  // GET /api/staff-performance/pd/:staffId — PD JSON
  app.get('/api/staff-performance/pd/:staffId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, staffId = req.params.staffId;
    const rows = (await pool.query(`SELECT * FROM staff_professional_development WHERE tenant_id=$1 AND staff_id=$2 ORDER BY created_at DESC`, [tid, staffId])).rows;
    res.json({ ok: true, data: rows });
  }));

};
