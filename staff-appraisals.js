// ============================================================
// STAFF APPRAISALS MODULE — Multi-Tenant Performance Review
// Staff appraisals, configurable criteria, scores, reports.
// Usage: const staffAppraisals = require('./staff-appraisals');
//        staffAppraisals(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
module.exports = function staffAppraisals(app, db, pool, renderPage, esc) {

  // ── inline fallbacks ──────────────────────────────────────
  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const requireAuth = (req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014';

  // ── Rating helpers ────────────────────────────────────────
  function getOverallRating(score) {
    const s = parseFloat(score) || 0;
    if (s >= 4.5) return 'outstanding';
    if (s >= 3.5) return 'excellent';
    if (s >= 2.5) return 'good';
    if (s >= 1.5) return 'satisfactory';
    if (s >= 1.0) return 'needs_improvement';
    return 'unsatisfactory';
  }

  function ratingBadge(status) {
    const m = {
      outstanding:         { bg: '#fef3c7', c: '#92400e', l: 'Outstanding' },
      excellent:           { bg: '#dcfce7', c: '#166534', l: 'Excellent' },
      good:                { bg: '#dbeafe', c: '#1e40af', l: 'Good' },
      satisfactory:        { bg: '#e0e7ff', c: '#3730a3', l: 'Satisfactory' },
      needs_improvement:   { bg: '#ffedd5', c: '#9a3412', l: 'Needs Improvement' },
      unsatisfactory:      { bg: '#fee2e2', c: '#991b1b', l: 'Unsatisfactory' },
      draft:               { bg: '#f1f5f9', c: '#64748b', l: 'Draft' },
      submitted:           { bg: '#dbeafe', c: '#1d4ed8', l: 'Submitted' },
      under_review:        { bg: '#fef3c7', c: '#b45309', l: 'Under Review' },
      completed:           { bg: '#dcfce7', c: '#15803d', l: 'Completed' },
      rejected:            { bg: '#fee2e2', c: '#dc2626', l: 'Rejected' }
    };
    const v = m[status] || { bg: '#f1f5f9', c: '#64748b', l: status };
    return `<span style="display:inline-block;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${v.bg};color:${v.c}">${v.l}</span>`;
  }

  function scoreColor(score) {
    const s = parseFloat(score) || 0;
    if (s >= 4.5) return '#92400e';
    if (s >= 3.5) return '#15803d';
    if (s >= 2.5) return '#1d4ed8';
    if (s >= 1.5) return '#4f46e5';
    if (s >= 1.0) return '#d97706';
    return '#dc2626';
  }

  function scoreBarHtml(score, max) {
    const pct = Math.min(100, ((parseFloat(score) || 0) / max) * 100);
    const color = pct >= 90 ? '#15803d' : pct >= 70 ? '#2563eb' : pct >= 50 ? '#d97706' : '#dc2626';
    return `<div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;height:10px;background:#f1f5f9;border-radius:5px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:5px;transition:.3s"></div>
      </div>
      <span style="font-size:12px;font-weight:700;color:${color};min-width:32px;text-align:right">${(parseFloat(score) || 0).toFixed(1)}</span>
    </div>`;
  }

  function radarChartHtml(data, size) {
    // data: [{label, value}], value 0-5
    size = size || 280;
    const cx = size / 2, cy = size / 2, r = size / 2 - 40;
    const n = data.length;
    if (n < 3) return '<p style="color:#94a3b8;font-size:13px;text-align:center">Need at least 3 criteria for radar chart</p>';

    let gridPaths = '';
    let axisLines = '';
    let labelsHtml = '';
    let pointCoords = [];

    // Grid rings (1-5)
    for (let ring = 1; ring <= 5; ring++) {
      const rr = (r * ring) / 5;
      let pts = [];
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        pts.push(`${cx + rr * Math.cos(angle)},${cy + rr * Math.sin(angle)}`);
      }
      gridPaths += `<polygon points="${pts.join(' ')}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`;
      if (ring === 5 || ring === 1) {
        const labelVal = ring === 5 ? '5' : '1';
        const lx = cx + rr + 4;
        const ly = cy - 4;
      }
    }

    // Axis lines
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const x2 = cx + r * Math.cos(angle);
      const y2 = cy + r * Math.sin(angle);
      axisLines += `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="#e2e8f0" stroke-width="1"/>`;

      // Data points
      const val = parseFloat(data[i].value) || 0;
      const pr = (r * Math.min(val, 5)) / 5;
      const px = cx + pr * Math.cos(angle);
      const py = cy + pr * Math.sin(angle);
      pointCoords.push(`${px},${py}`);

      // Labels
      const lx = cx + (r + 22) * Math.cos(angle);
      const ly = cy + (r + 22) * Math.sin(angle);
      const anchor = Math.abs(Math.cos(angle)) < 0.1 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
      labelsHtml += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" dominant-baseline="middle" style="font-size:10px;fill:#475569;font-weight:600">${esc(data[i].label)}</text>`;
    }

    const dataPath = `<polygon points="${pointCoords.join(' ')}" fill="rgba(124,58,237,0.15)" stroke="#7c3aed" stroke-width="2"/>`;
    const dotsHtml = pointCoords.map(p => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="4" fill="#7c3aed" stroke="#fff" stroke-width="2"/>`).join('');

    // Scale labels
    const scaleLabels = [1, 2, 3, 4, 5].map(v => {
      const yy = cy - (r * v) / 5;
      return `<text x="${cx - 8}" y="${yy + 3}" text-anchor="end" style="font-size:9px;fill:#94a3b8">${v}</text>`;
    }).join('');

    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block;margin:0 auto">
      <rect width="${size}" height="${size}" fill="none"/>
      ${scaleLabels}
      ${gridPaths}
      ${axisLines}
      ${dataPath}
      ${dotsHtml}
      ${labelsHtml}
    </svg>`;
  }

  // ── Shared CSS ────────────────────────────────────────────
  const SA_CSS = `<style>
    .sa-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
    .sa-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .sa-nav a:hover{background:#e2e8f0}.sa-nav a.active{background:#7c3aed;color:#fff}
    .sa-tbl{width:100%;border-collapse:collapse;font-size:13px}
    .sa-tbl th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .sa-tbl td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .sa-tbl tr:hover{background:#f8fafc}
    .sa-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .sa-form-grid .full{grid-column:1/-1}
    .sa-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .sa-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .sa-filter input,.sa-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .sa-filter input:focus,.sa-filter select:focus{outline:none;border-color:#7c3aed}
    .sa-card{background:#fff;border:1px solid #f1f5f9;border-radius:14px;padding:24px;margin-bottom:16px}
    .sa-stat-card{background:#fff;border:1px solid #f1f5f9;border-radius:14px;padding:20px;text-align:center}
    .sa-stat-num{font-size:28px;font-weight:800;color:#7c3aed}
    .sa-stat-label{font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
    .sa-score-bar{height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden}
    .sa-score-bar-fill{height:100%;border-radius:4px;transition:.3s}
    .sa-criteria-item{border:1px solid #f1f5f9;border-radius:10px;padding:16px;margin-bottom:10px}
    .sa-criteria-item:hover{border-color:#e2e8f0}
    .sa-rating-stars{display:flex;gap:4px}
    .sa-rating-stars span{font-size:18px;cursor:pointer;color:#e2e8f0}
    .sa-rating-stars span.active{color:#7c3aed}
    .sa-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .sa-btn:hover{opacity:.9;transform:translateY(-1px)}
    .sa-btn-primary{background:#7c3aed;color:#fff}.sa-btn-success{background:#059669;color:#fff}
    .sa-btn-danger{background:#fee2e2;color:#dc2626}.sa-btn-secondary{background:#f1f5f9;color:#475569}
    .sa-btn-outline{background:transparent;border:2px solid #7c3aed;color:#7c3aed}
    .sa-comparison{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .sa-section-title{font-size:15px;font-weight:700;color:#1e293b;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #f1f5f9}
    .sa-distribution-bar{display:flex;height:24px;border-radius:12px;overflow:hidden;margin:8px 0}
    .sa-distribution-bar div{transition:.3s}
    .sa-empty{text-align:center;padding:40px;color:#94a3b8}
    .sa-empty a{color:#7c3aed;text-decoration:none;font-weight:600}
    @media(max-width:768px){.sa-form-grid{grid-template-columns:1fr}.sa-comparison{grid-template-columns:1fr}.sa-nav{gap:4px}.sa-nav a{padding:6px 12px;font-size:12px}}
  </style>`;

  // ── Navigation helper ────────────────────────────────────
  function nav(active) {
    const links = [
      ['/appraisals', 'Dashboard'],
      ['/appraisals/criteria', 'Criteria'],
      ['/appraisals/new', 'New Appraisal'],
      ['/appraisals/all', 'All Appraisals'],
      ['/appraisals/reports', 'Reports']
    ];
    return '<div class="sa-nav">' + links.map(([href, label]) =>
      `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`).join('') + '</div>';
  }

  // ── Helper: form field ────────────────────────────────────
  function formField(label, name, type, val, opts) {
    const req = opts && opts.required ? ' required' : '';
    const ro = opts && opts.readonly ? ' readonly' : '';
    const placeholder = opts && opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '';
    if (opts && opts.select) {
      const options = opts.select.map(o => {
        const sv = typeof o === 'object' ? o.value : o;
        const sl = typeof o === 'object' ? o.label : o;
        return `<option value="${esc(sv)}" ${String(val) === String(sv) ? 'selected' : ''}>${esc(sl)}</option>`;
      }).join('');
      return `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
        <select name="${name}"${req} style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;background:#fff">${options}</select></div>`;
    }
    if (opts && opts.textarea) {
      return `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
        <textarea name="${name}"${req}${ro} rows="${opts.rows || 4}"${placeholder} style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical">${esc(String(val || ''))}</textarea></div>`;
    }
    return `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
      <input type="${type}" name="${name}" value="${esc(String(val || ''))}"${req}${ro}${placeholder}
        style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>`;
  }

  // ── Helper: rating input (1-5 stars) ──────────────────────
  function ratingInput(name, value, criteriaId) {
    const v = parseInt(value) || 0;
    let html = `<div class="sa-rating-stars" data-name="${name}" data-criteria="${criteriaId}">`;
    for (let i = 1; i <= 5; i++) {
      html += `<span data-val="${i}" class="${i <= v ? 'active' : ''}" onclick="setRating(this, ${i})">&#9733;</span>`;
    }
    html += `<input type="hidden" name="${name}" value="${v}" id="${name}_${criteriaId}">`;
    html += `</div>`;
    return html;
  }

  // ── Default rating scale ──────────────────────────────────
  const DEFAULT_RATING_SCALE = JSON.stringify({ '5': 'Exceptional', '4': 'Above Average', '3': 'Meets Expectations', '2': 'Below Average', '1': 'Unsatisfactory' });

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      // Main appraisals table
      await migrateQuery(pool, 'StaffAppraisals', `CREATE TABLE IF NOT EXISTS staff_appraisals (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        staff_id INTEGER,
        staff_name VARCHAR(255) NOT NULL,
        department VARCHAR(100),
        review_period VARCHAR(100),
        appraisal_type VARCHAR(50) DEFAULT 'annual',
        overall_score DECIMAL(5,2),
        overall_rating VARCHAR(20),
        strengths TEXT,
        areas_for_improvement TEXT,
        goals_next_period TEXT,
        reviewer_notes TEXT,
        reviewer_id INTEGER REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'draft',
        self_appraisal JSONB,
        manager_appraisal JSONB,
        submitted_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // Criteria table
      await migrateQuery(pool, 'StaffAppraisals', `CREATE TABLE IF NOT EXISTS appraisal_criteria (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) DEFAULT 'performance',
        weight INTEGER DEFAULT 10,
        rating_scale JSONB DEFAULT '${DEFAULT_RATING_SCALE}'::jsonb,
        is_active BOOLEAN DEFAULT true,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // Scores table
      await migrateQuery(pool, 'StaffAppraisals', `CREATE TABLE IF NOT EXISTS appraisal_scores (
        id SERIAL PRIMARY KEY,
        appraisal_id INTEGER REFERENCES staff_appraisals(id) ON DELETE CASCADE,
        criteria_id INTEGER REFERENCES appraisal_criteria(id) ON DELETE CASCADE,
        score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
        comments TEXT,
        scored_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // ALTER TABLE IF NOT EXISTS — staff_appraisals columns
      const appCols = [
        ['tenant_id', 'INTEGER'],
        ['staff_id', 'INTEGER'],
        ['staff_name', 'VARCHAR(255)'],
        ['department', 'VARCHAR(100)'],
        ['review_period', 'VARCHAR(100)'],
        ['appraisal_type', 'VARCHAR(50)'],
        ['overall_score', 'DECIMAL(5,2)'],
        ['overall_rating', 'VARCHAR(20)'],
        ['strengths', 'TEXT'],
        ['areas_for_improvement', 'TEXT'],
        ['goals_next_period', 'TEXT'],
        ['reviewer_notes', 'TEXT'],
        ['reviewer_id', 'INTEGER'],
        ['status', "VARCHAR(20) DEFAULT 'draft'"],
        ['self_appraisal', 'JSONB'],
        ['manager_appraisal', 'JSONB'],
        ['submitted_at', 'TIMESTAMPTZ'],
        ['completed_at', 'TIMESTAMPTZ'],
        ['created_at', 'TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, typ] of appCols) {
        try { await migrateQuery(pool, 'StaffAppraisals', `ALTER TABLE staff_appraisals ADD COLUMN IF NOT EXISTS ${col} ${typ}`); } catch (e) {}
      }

      // ALTER TABLE IF NOT EXISTS — appraisal_criteria columns
      const critCols = [
        ['tenant_id', 'INTEGER'],
        ['name', 'VARCHAR(255)'],
        ['category', 'VARCHAR(100)'],
        ['weight', 'INTEGER DEFAULT 10'],
        ['rating_scale', 'JSONB'],
        ['is_active', 'BOOLEAN DEFAULT true'],
        ['display_order', 'INTEGER DEFAULT 0'],
        ['created_at', 'TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, typ] of critCols) {
        try { await migrateQuery(pool, 'StaffAppraisals', `ALTER TABLE appraisal_criteria ADD COLUMN IF NOT EXISTS ${col} ${typ}`); } catch (e) {}
      }

      // ALTER TABLE IF NOT EXISTS — appraisal_scores columns
      const scoreCols = [
        ['appraisal_id', 'INTEGER'],
        ['criteria_id', 'INTEGER'],
        ['score', 'INTEGER'],
        ['comments', 'TEXT'],
        ['scored_by', 'INTEGER'],
        ['created_at', 'TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, typ] of scoreCols) {
        try { await migrateQuery(pool, 'StaffAppraisals', `ALTER TABLE appraisal_scores ADD COLUMN IF NOT EXISTS ${col} ${typ}`); } catch (e) {}
      }

      // Indexes
      await migrateQuery(pool, 'StaffAppraisals', `CREATE INDEX IF NOT EXISTS idx_sa_tenant ON staff_appraisals(tenant_id)`);
      await migrateQuery(pool, 'StaffAppraisals', `CREATE INDEX IF NOT EXISTS idx_sa_staff ON staff_appraisals(tenant_id, staff_id)`);
      await migrateQuery(pool, 'StaffAppraisals', `CREATE INDEX IF NOT EXISTS idx_sa_status ON staff_appraisals(tenant_id, status)`);
      await migrateQuery(pool, 'StaffAppraisals', `CREATE INDEX IF NOT EXISTS idx_sa_dept ON staff_appraisals(tenant_id, department)`);
      await migrateQuery(pool, 'StaffAppraisals', `CREATE INDEX IF NOT EXISTS idx_sa_period ON staff_appraisals(tenant_id, review_period)`);
      await migrateQuery(pool, 'StaffAppraisals', `CREATE INDEX IF NOT EXISTS idx_ac_tenant ON appraisal_criteria(tenant_id)`);
      await migrateQuery(pool, 'StaffAppraisals', `CREATE INDEX IF NOT EXISTS idx_ac_active ON appraisal_criteria(tenant_id, is_active)`);
      await migrateQuery(pool, 'StaffAppraisals', `CREATE INDEX IF NOT EXISTS idx_as_appraisal ON appraisal_scores(appraisal_id)`);
      await migrateQuery(pool, 'StaffAppraisals', `CREATE INDEX IF NOT EXISTS idx_as_criteria ON appraisal_scores(criteria_id)`);

      // Seed default criteria if none exist (for a quick start)
      // Wrapped in try/catch because tenant_id=0 may not exist in tenants table
      try {
        const seedCheck = await migrateQuery(pool, 'StaffAppraisals', `SELECT COUNT(*)::int as cnt FROM appraisal_criteria WHERE tenant_id = 0`);
        if (seedCheck.rows[0].cnt === 0) {
          const defaults = [
            ['Job Knowledge', 'performance', 20],
            ['Quality of Work', 'performance', 20],
            ['Teamwork & Collaboration', 'behavior', 15],
            ['Communication Skills', 'communication', 15],
            ['Initiative & Problem Solving', 'skills', 10],
            ['Leadership & Mentoring', 'leadership', 10],
            ['Punctuality & Attendance', 'behavior', 5],
            ['Adaptability & Learning', 'skills', 5]
          ];
          for (let i = 0; i < defaults.length; i++) {
            await migrateQuery(pool, 'StaffAppraisals', `INSERT INTO appraisal_criteria (tenant_id, name, category, weight, display_order) VALUES (0, $1, $2, $3, $4)`,
              [defaults[i][0], defaults[i][1], defaults[i][2], i]);
          }
        }
      } catch (seedErr) {
        console.warn('[StaffAppraisals] Seed skipped (tenant_id=0 may not exist):', seedErr.message);
      }

      console.log('[StaffAppraisals] Migrations applied successfully');
    } catch (e) {
      /* migration OK */
    }
  })();

  // ════════════════════════════════════════════════════════════
  // ROUTE 1: GET /appraisals — Dashboard
  // ════════════════════════════════════════════════════════════
  app.get('/appraisals', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Stats
    const stats = (await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM staff_appraisals WHERE tenant_id=$1 AND status IN ('draft','submitted','under_review')) as pending_reviews,
        (SELECT COUNT(*) FROM staff_appraisals WHERE tenant_id=$1 AND status='completed'
          AND review_period = to_char(CURRENT_DATE, '"Q"Q YYYY')) as completed_this_period,
        (SELECT COALESCE(AVG(overall_score), 0) FROM staff_appraisals WHERE tenant_id=$1 AND status='completed') as avg_score,
        (SELECT COUNT(*) FROM staff_appraisals WHERE tenant_id=$1) as total_appraisals,
        (SELECT COUNT(*) FROM appraisal_criteria WHERE tenant_id=$1 AND is_active=true) as active_criteria)
    `, [tid])).rows[0];

    // Distribution chart
    const distribution = (await pool.query(`
      SELECT overall_rating, COUNT(*)::int as cnt
      FROM staff_appraisals WHERE tenant_id=$1 AND status='completed' AND overall_rating IS NOT NULL
      GROUP BY overall_rating ORDER BY cnt DESC
    `, [tid])).rows;

    const totalDist = distribution.reduce((s, d) => s + d.cnt, 0);
    const distColors = {
      outstanding: '#f59e0b', excellent: '#10b981', good: '#3b82f6',
      satisfactory: '#8b5cf6', needs_improvement: '#f97316', unsatisfactory: '#ef4444'
    };
    const distBarHtml = distribution.length > 0
      ? `<div class="sa-distribution-bar">${distribution.map(d =>
          `<div style="width:${(d.cnt / totalDist * 100).toFixed(1)}%;background:${distColors[d.overall_rating] || '#94a3b8'}" title="${d.overall_rating}: ${d.cnt}"></div>`
        ).join('')}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px">${distribution.map(d =>
          `<span style="font-size:11px;color:#64748b"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${distColors[d.overall_rating] || '#94a3b8'};margin-right:3px"></span>${d.overall_rating} (${d.cnt})</span>`
        ).join('')}</div>`
      : '<p style="color:#94a3b8;font-size:13px">No completed appraisals yet</p>';

    // Recent appraisals
    const recent = (await pool.query(`
      SELECT sa.*, u.name as reviewer_name
      FROM staff_appraisals sa LEFT JOIN users u ON u.id = sa.reviewer_id
      WHERE sa.tenant_id=$1 ORDER BY sa.created_at DESC LIMIT 8
    `, [tid])).rows;

    const recentHtml = recent.map(r => `<tr>
      <td><a href="/appraisals/${r.id}" style="color:#7c3aed;text-decoration:none;font-weight:600">${esc(r.staff_name)}</a></td>
      <td>${esc(r.department || '\u2014')}</td>
      <td>${esc(r.review_period || '\u2014')}</td>
      <td>${ratingBadge(r.status)}</td>
      <td>${r.overall_score ? `<span style="font-weight:700;color:${scoreColor(r.overall_score)}">${parseFloat(r.overall_score).toFixed(1)}</span>` : '\u2014'}</td>
      <td>${fmtDateTime(r.created_at)}</td>
      <td><a href="/appraisals/${r.id}" class="sa-btn sa-btn-primary" style="padding:5px 12px;font-size:12px">View</a></td>
    </tr>`).join('');

    // Department averages
    const deptAvgs = (await pool.query(`
      SELECT department, COUNT(*)::int as cnt, COALESCE(AVG(overall_score), 0) as avg_score
      FROM staff_appraisals WHERE tenant_id=$1 AND status='completed' AND department IS NOT NULL
      GROUP BY department ORDER BY avg_score DESC LIMIT 8
    `, [tid])).rows;

    const deptHtml = deptAvgs.map(d => `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="font-weight:600;color:#1e293b">${esc(d.department)}</span>
        <span style="color:#7c3aed;font-weight:700">${parseFloat(d.avg_score).toFixed(2)} (${d.cnt})</span>
      </div>
      ${scoreBarHtml(d.avg_score, 5)}
    </div>`).join('');

    const html = SA_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/appraisals')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\u{1F4CA} Staff Appraisals</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Performance review &amp; appraisal management</p></div>
        <div style="display:flex;gap:8px">
          <a href="/appraisals/criteria" class="sa-btn sa-btn-secondary">\u2699\uFE0F Criteria</a>
          <a href="/appraisals/new" class="sa-btn sa-btn-primary">+ New Appraisal</a>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="sa-stat-card"><div class="sa-stat-num">${stats.total_appraisals}</div><div class="sa-stat-label">Total Appraisals</div></div>
        <div class="sa-stat-card"><div class="sa-stat-num" style="color:#f59e0b">${stats.pending_reviews}</div><div class="sa-stat-label">Pending Reviews</div></div>
        <div class="sa-stat-card"><div class="sa-stat-num" style="color:#059669">${stats.completed_this_period}</div><div class="sa-stat-label">Completed This Period</div></div>
        <div class="sa-stat-card"><div class="sa-stat-num" style="color:#7c3aed">${parseFloat(stats.avg_score).toFixed(1)}</div><div class="sa-stat-label">Average Score</div></div>
        <div class="sa-stat-card"><div class="sa-stat-num" style="color:#0891b2">${stats.active_criteria}</div><div class="sa-stat-label">Active Criteria</div></div>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px">
        <div class="sa-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h3 style="color:#1e293b;font-size:16px">Recent Appraisals</h3>
            <a href="/appraisals/all" style="font-size:13px;color:#7c3aed;text-decoration:none">View All \u2192</a>
          </div>
          <div style="overflow-x:auto"><table class="sa-tbl">
            <thead><tr><th>Staff</th><th>Department</th><th>Period</th><th>Status</th><th>Score</th><th>Created</th><th></th></tr></thead>
            <tbody>${recentHtml || '<tr><td colspan="7" class="sa-empty">No appraisals yet. <a href="/appraisals/new">Create your first appraisal</a>.</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="sa-card">
          <h3 style="color:#1e293b;font-size:16px;margin-bottom:12px">Rating Distribution</h3>
          ${distBarHtml}
          <h3 style="color:#1e293b;font-size:16px;margin:20px 0 12px">Department Averages</h3>
          ${deptHtml || '<p style="color:#94a3b8;font-size:13px">No completed appraisals</p>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Staff Appraisals Dashboard', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 2: GET /appraisals/criteria — Manage Criteria
  // ════════════════════════════════════════════════════════════
  app.get('/appraisals/criteria', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const criteria = (await pool.query(
      'SELECT * FROM appraisal_criteria WHERE tenant_id=$1 ORDER BY display_order, name', [tid]
    )).rows;

    const totalWeight = criteria.filter(c => c.is_active).reduce((s, c) => s + (c.weight || 0), 0);
    const weightOk = totalWeight === 100;

    const criteriaHtml = criteria.map(c => {
      const scale = typeof c.rating_scale === 'string' ? JSON.parse(c.rating_scale || '{}') : (c.rating_scale || {});
      const scalePreview = Object.entries(scale).map(([k, v]) => `<span style="font-size:11px;color:#64748b;background:#f8fafc;padding:2px 6px;border-radius:4px;margin-right:4px">${k}: ${esc(v)}</span>`).join('');
      return `<div class="sa-criteria-item" style="opacity:${c.is_active ? 1 : 0.5}">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:12px">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <strong style="font-size:14px;color:#1e293b">${esc(c.name)}</strong>
              <span style="font-size:11px;padding:2px 8px;border-radius:20px;background:#f3e8ff;color:#7c3aed;font-weight:600">${esc(c.category || 'performance')}</span>
              ${c.is_active ? '<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:#dcfce7;color:#15803d;font-weight:600">Active</span>' : '<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:#f1f5f9;color:#64748b;font-weight:600">Inactive</span>'}
            </div>
            <div style="font-size:13px;color:#475569;margin-bottom:6px">
              Weight: <strong style="color:#7c3aed">${c.weight}%</strong>
              &nbsp;\u00B7&nbsp; Order: ${c.display_order}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:4px">${scalePreview || '<span style="font-size:11px;color:#94a3b8">No scale defined</span>'}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <a href="/appraisals/criteria/edit/${c.id}" class="sa-btn sa-btn-secondary" style="padding:6px 12px;font-size:12px">Edit</a>
            <button onclick="deleteCriteria(${c.id}, '${esc(c.name)}')" class="sa-btn sa-btn-danger" style="padding:6px 12px;font-size:12px">Delete</button>
          </div>
        </div>
      </div>`;
    }).join('');

    const html = SA_CSS + `
    <div style="max-width:900px;margin:0 auto">
      ${nav('/appraisals/criteria')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\u2699\uFE0F Appraisal Criteria</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Define KPI categories, weights, and rating scales</p></div>
        <a href="/appraisals/criteria/new" class="sa-btn sa-btn-primary">+ Add Criterion</a>
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:14px 18px;border-radius:10px;background:${weightOk ? '#f0fdf4' : '#fef2f2'};border:1px solid ${weightOk ? '#bbf7d0' : '#fecaca'}">
        <span style="font-size:20px">${weightOk ? '\u2705' : '\u26A0\uFE0F'}</span>
        <div>
          <div style="font-size:14px;font-weight:700;color:${weightOk ? '#166534' : '#991b1b'}">Total Active Weight: ${totalWeight}%</div>
          <div style="font-size:12px;color:${weightOk ? '#15803d' : '#b91c1c'}">${weightOk ? 'Weights are correctly configured (sums to 100%)' : 'Weights should sum to 100%. Current: ' + totalWeight + '%'}</div>
        </div>
      </div>
      <div class="sa-card">
        ${criteriaHtml || '<div class="sa-empty">No criteria defined yet. <a href="/appraisals/criteria/new">Add your first criterion</a>.</div>'}
      </div>
    </div>
    <script>
    function deleteCriteria(id, name) {
      if (confirm('Delete criterion "' + name + '"? This cannot be undone.')) {
        fetch('/appraisals/criteria/' + id + '/delete', { method: 'POST' })
          .then(r => r.json()).then(d => { if (d.ok) location.reload(); else alert(d.error || 'Delete failed'); });
      }
    }</script>`;
    res.send(renderPage('Appraisal Criteria', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 3: POST /appraisals/criteria/save — Save/Update Criteria
  // ════════════════════════════════════════════════════════════
  app.post('/appraisals/criteria/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { id, name, category, weight, display_order, rating_5, rating_4, rating_3, rating_2, rating_1, is_active } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ ok: false, error: 'Criterion name is required' });
    }

    const ratingScale = JSON.stringify({
      '5': (rating_5 || 'Exceptional').trim(),
      '4': (rating_4 || 'Above Average').trim(),
      '3': (rating_3 || 'Meets Expectations').trim(),
      '2': (rating_2 || 'Below Average').trim(),
      '1': (rating_1 || 'Unsatisfactory').trim()
    });

    if (id) {
      await pool.query(
        `UPDATE appraisal_criteria SET name=$1, category=$2, weight=$3, display_order=$4, rating_scale=$5::jsonb, is_active=$6 WHERE id=$7 AND tenant_id=$8`,
        [name.trim(), (category || 'performance').trim(), parseInt(weight) || 10, parseInt(display_order) || 0, ratingScale, is_active === 'on' ? true : false, id, tid]
      );
    } else {
      await pool.query(
        `INSERT INTO appraisal_criteria (tenant_id, name, category, weight, display_order, rating_scale, is_active) VALUES ($1,$2,$3,$4,$5,$6::jsonb,true)`,
        [tid, name.trim(), (category || 'performance').trim(), parseInt(weight) || 10, parseInt(display_order) || 0, ratingScale]
      );
    }
    res.redirect('/appraisals/criteria');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 3a: GET /appraisals/criteria/new — Add Criterion Form
  // ════════════════════════════════════════════════════════════
  app.get('/appraisals/criteria/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const scale = JSON.parse(DEFAULT_RATING_SCALE);
    const html = SA_CSS + `
    <div style="max-width:700px;margin:0 auto">
      ${nav('/appraisals/criteria')}
      <a href="/appraisals/criteria" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Criteria</a>
      <div class="sa-card" style="padding:28px">
        <h2 style="color:#1e293b;margin-bottom:4px">+ Add Appraisal Criterion</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Define a new KPI criterion for staff evaluations</p>
        <form method="POST" action="/appraisals/criteria/save" class="sa-form-grid">
          ${formField('Criterion Name *', 'name', 'text', '', { required: true, placeholder: 'e.g., Job Knowledge' })}
          ${formField('Category', 'category', 'text', 'performance', { select: [
            { value: 'performance', label: 'Performance' },
            { value: 'behavior', label: 'Behavior' },
            { value: 'skills', label: 'Skills' },
            { value: 'leadership', label: 'Leadership' },
            { value: 'communication', label: 'Communication' }
          ]})}
          ${formField('Weight (%) *', 'weight', 'number', '10', { required: true, placeholder: 'Percentage (1-100)' })}
          ${formField('Display Order', 'display_order', 'number', '0', { placeholder: '0 = first' })}
          <div class="full">
            <div style="font-size:13px;font-weight:600;color:#475569;margin-bottom:8px">Rating Scale Labels</div>
            <div class="sa-form-grid">
              ${formField('5 \u2014', 'rating_5', 'text', scale['5'], { placeholder: 'Exceptional' })}
              ${formField('4 \u2014', 'rating_4', 'text', scale['4'], { placeholder: 'Above Average' })}
              ${formField('3 \u2014', 'rating_3', 'text', scale['3'], { placeholder: 'Meets Expectations' })}
              ${formField('2 \u2014', 'rating_2', 'text', scale['2'], { placeholder: 'Below Average' })}
              ${formField('1 \u2014', 'rating_1', 'text', scale['1'], { placeholder: 'Unsatisfactory' })}
            </div>
          </div>
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="sa-btn sa-btn-success" style="padding:12px 28px">\uD83D\uDCBE Save Criterion</button>
            <a href="/appraisals/criteria" class="sa-btn sa-btn-secondary" style="padding:12px 28px;text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Add Appraisal Criterion', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 3b: GET /appraisals/criteria/edit/:id — Edit Criterion
  // ════════════════════════════════════════════════════════════
  app.get('/appraisals/criteria/edit/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const c = (await pool.query('SELECT * FROM appraisal_criteria WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!c) return res.send('<div class="alert">Criterion not found.</div><a href="/appraisals/criteria" class="sa-btn sa-btn-primary">Back</a>');

    const scale = typeof c.rating_scale === 'string' ? JSON.parse(c.rating_scale || '{}') : (c.rating_scale || {});
    const html = SA_CSS + `
    <div style="max-width:700px;margin:0 auto">
      ${nav('/appraisals/criteria')}
      <a href="/appraisals/criteria" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Criteria</a>
      <div class="sa-card" style="padding:28px">
        <h2 style="color:#1e293b;margin-bottom:4px">\u270F\uFE0F Edit: ${esc(c.name)}</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Modify this appraisal criterion</p>
        <form method="POST" action="/appraisals/criteria/save" class="sa-form-grid">
          <input type="hidden" name="id" value="${c.id}">
          ${formField('Criterion Name *', 'name', 'text', c.name, { required: true })}
          ${formField('Category', 'category', 'text', c.category || 'performance', { select: [
            { value: 'performance', label: 'Performance' },
            { value: 'behavior', label: 'Behavior' },
            { value: 'skills', label: 'Skills' },
            { value: 'leadership', label: 'Leadership' },
            { value: 'communication', label: 'Communication' }
          ]})}
          ${formField('Weight (%) *', 'weight', 'number', c.weight, { required: true })}
          ${formField('Display Order', 'display_order', 'number', c.display_order)}
          <div style="display:flex;align-items:center;gap:8px;padding-top:10px">
            <input type="checkbox" name="is_active" id="is_active" ${c.is_active !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:#7c3aed">
            <label for="is_active" style="font-size:13px;font-weight:600;color:#475569">Active</label>
          </div>
          <div class="full">
            <div style="font-size:13px;font-weight:600;color:#475569;margin-bottom:8px">Rating Scale Labels</div>
            <div class="sa-form-grid">
              ${formField('5 \u2014', 'rating_5', 'text', scale['5'] || 'Exceptional')}
              ${formField('4 \u2014', 'rating_4', 'text', scale['4'] || 'Above Average')}
              ${formField('3 \u2014', 'rating_3', 'text', scale['3'] || 'Meets Expectations')}
              ${formField('2 \u2014', 'rating_2', 'text', scale['2'] || 'Below Average')}
              ${formField('1 \u2014', 'rating_1', 'text', scale['1'] || 'Unsatisfactory')}
            </div>
          </div>
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="sa-btn sa-btn-success" style="padding:12px 28px">\uD83D\uDCBE Update Criterion</button>
            <a href="/appraisals/criteria" class="sa-btn sa-btn-secondary" style="padding:12px 28px;text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Edit Criterion: ' + c.name, html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 4: POST /appraisals/criteria/:id/delete — Delete Criteria
  // ════════════════════════════════════════════════════════════
  app.post('/appraisals/criteria/:id/delete', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const c = (await pool.query('SELECT id, name FROM appraisal_criteria WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!c) return res.json({ ok: false, error: 'Criterion not found' });

    const hasScores = (await pool.query('SELECT 1 FROM appraisal_scores WHERE criteria_id=$1 LIMIT 1', [id])).rows.length;
    if (hasScores) return res.json({ ok: false, error: 'Cannot delete: criterion has associated scores' });

    await pool.query('DELETE FROM appraisal_criteria WHERE id=$1 AND tenant_id=$2', [id, tid]);
    res.json({ ok: true, message: 'Criterion deleted' });
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 5: GET /appraisals/new — Create New Appraisal
  // ════════════════════════════════════════════════════════════
  app.get('/appraisals/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const criteria = (await pool.query(
      'SELECT * FROM appraisal_criteria WHERE tenant_id=$1 AND is_active=true ORDER BY display_order, name', [tid]
    )).rows;

    const totalWeight = criteria.reduce((s, c) => s + (c.weight || 0), 0);

    // Generate review period suggestions
    const now = new Date();
    const q = Math.ceil((now.getMonth() + 1) / 3);
    const suggestions = [
      `Q${q} ${now.getFullYear()}`,
      `${now.toLocaleDateString('en-US', { month: 'long' })} ${now.getFullYear()}`,
      `FY ${now.getFullYear()}-${now.getFullYear() + 1}`
    ];

    // Try to get staff/users list
    let staffOptions = [];
    try {
      staffOptions = (await pool.query(
        "SELECT id, name, department FROM users WHERE tenant_id=$1 AND status='active' ORDER BY name LIMIT 500", [tid]
      )).rows;
    } catch (e) {
      // users table may not have department column
      staffOptions = (await pool.query(
        "SELECT id, name FROM users WHERE tenant_id=$1 AND status='active' ORDER BY name LIMIT 500", [tid]
      )).rows;
    }

    const criteriaFields = criteria.map(c => {
      const scale = typeof c.rating_scale === 'string' ? JSON.parse(c.rating_scale || '{}') : (c.rating_scale || {});
      const scaleLabels = [1, 2, 3, 4, 5].map(v => `<span style="font-size:10px;color:#94a3b8;margin-left:4px">${v}=${esc(scale[String(v)] || v)}</span>`).join('');
      return `<div style="border:1px solid #f1f5f9;border-radius:10px;padding:14px;margin-bottom:10px;background:#fafafa">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div>
            <strong style="font-size:14px;color:#1e293b">${esc(c.name)}</strong>
            <span style="font-size:11px;color:#7c3aed;margin-left:6px;font-weight:600">${c.weight}%</span>
          </div>
          <span style="font-size:11px;color:#94a3b8">${esc(c.category || 'performance')}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:8px">${scaleLabels}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:12px;font-weight:600;color:#64748b">Score:</label>
          <div class="sa-rating-stars" data-name="score_${c.id}" data-criteria="${c.id}">
            ${[1, 2, 3, 4, 5].map(v => `<span data-val="${v}" class="" onclick="setRating(this, ${v})" style="cursor:pointer;font-size:22px;color:#e2e8f0">&#9733;</span>`).join('')}
          </div>
          <input type="hidden" name="score_${c.id}" value="0" id="score_${c.id}">
        </div>
        <div style="margin-top:6px">
          <input type="text" name="comment_${c.id}" placeholder="Comments for ${esc(c.name)}..." style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px">
        </div>
      </div>`;
    }).join('');

    const html = SA_CSS + `
    <div style="max-width:800px;margin:0 auto">
      ${nav('/appraisals/new')}
      <a href="/appraisals" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Dashboard</a>
      <div class="sa-card" style="padding:28px">
        <h2 style="color:#1e293b;margin-bottom:4px">\u{1F4CB} New Staff Appraisal</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Create a performance evaluation for a staff member</p>
        ${totalWeight !== 100 ? `<div style="padding:10px 14px;border-radius:8px;background:#fef3c7;border:1px solid #fde68a;margin-bottom:16px;font-size:13px;color:#92400e">\u26A0\uFE0F Active criteria weights sum to ${totalWeight}% (should be 100%). Please adjust criteria before proceeding.</div>` : ''}
        <form method="POST" action="/appraisals/new" class="sa-form-grid">
          ${formField('Staff Member *', 'staff_id', 'text', '', { select: [{ value: '', label: '-- Select Staff Member --' }, ...staffOptions.map(s => ({ value: s.id, label: s.name + (s.department ? ' (' + s.department + ')' : '') }))], required: true })}
          ${formField('Staff Name *', 'staff_name', 'text', '', { required: true, placeholder: 'Will be auto-filled if staff selected' })}
          ${formField('Department', 'department', 'text', '', { placeholder: 'e.g., Engineering' })}
          ${formField('Review Period *', 'review_period', 'text', suggestions[0], { required: true, placeholder: 'e.g., Q1 2026' })}
          ${formField('Appraisal Type', 'appraisal_type', 'text', 'annual', { select: [
            { value: 'quarterly', label: 'Quarterly' },
            { value: 'semi_annual', label: 'Semi-Annual' },
            { value: 'annual', label: 'Annual' },
            { value: 'probation', label: 'Probation' },
            { value: 'ad_hoc', label: 'Ad Hoc' }
          ]})}
          ${formField('Reviewer', 'reviewer_id', 'text', String(user.id), { select: [{ value: String(user.id), label: user.name || 'Me' }] })}
          <div class="full sa-section-title" style="margin-top:12px">\u{1F3AF} Criteria Scores</div>
          <div class="full">${criteriaFields || '<p style="color:#94a3b8;font-size:13px">No active criteria defined. <a href="/appraisals/criteria/new" style="color:#7c3aed">Add criteria first</a>.</p>'}</div>
          <div class="full sa-section-title" style="margin-top:12px">\uD83D\uDCDD Additional Comments</div>
          ${formField('Strengths', 'strengths', 'text', '', { textarea: true, rows: 3, placeholder: 'Key strengths observed...' })}
          ${formField('Areas for Improvement', 'areas_for_improvement', 'text', '', { textarea: true, rows: 3, placeholder: 'Areas where improvement is needed...' })}
          ${formField('Goals for Next Period', 'goals_next_period', 'text', '', { textarea: true, rows: 3, placeholder: 'Goals and objectives for the next review period...' })}
          ${formField('Reviewer Notes', 'reviewer_notes', 'text', '', { textarea: true, rows: 2, placeholder: 'Additional notes from the reviewer...' })}
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" name="action" value="draft" class="sa-btn sa-btn-secondary" style="padding:12px 28px">\uD83D\uDCBE Save as Draft</button>
            <button type="submit" name="action" value="submit" class="sa-btn sa-btn-primary" style="padding:12px 28px">\u2705 Submit Appraisal</button>
          </div>
        </form>
      </div>
    </div>
    <script>
    function setRating(el, val) {
      const container = el.closest('.sa-rating-stars');
      const stars = container.querySelectorAll('span');
      stars.forEach(s => { s.classList.remove('active'); s.style.color = '#e2e8f0'; });
      for (let i = 0; i < val; i++) { stars[i].classList.add('active'); stars[i].style.color = '#7c3aed'; }
      container.querySelector('input[type="hidden"]').value = val;
    }
    // Auto-fill staff name on selection
    const staffSelect = document.querySelector('select[name="staff_id"]');
    if (staffSelect) {
      staffSelect.addEventListener('change', function() {
        const opt = this.options[this.selectedIndex];
        const nameField = document.querySelector('input[name="staff_name"]');
        if (nameField && this.value) {
          nameField.value = opt.textContent.split(' (')[0].trim();
        }
      });
    }
    </script>`;
    res.send(renderPage('New Staff Appraisal', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 6: POST /appraisals/new — Save Appraisal
  // ════════════════════════════════════════════════════════════
  app.post('/appraisals/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { staff_id, staff_name, department, review_period, appraisal_type, reviewer_id,
      strengths, areas_for_improvement, goals_next_period, reviewer_notes, action } = req.body;

    if (!staff_name || !staff_name.trim()) {
      return res.send('<div class="alert">Staff name is required.</div><a href="/appraisals/new" class="sa-btn sa-btn-primary">Back</a>');
    }

    // Get criteria
    const criteria = (await pool.query(
      'SELECT * FROM appraisal_criteria WHERE tenant_id=$1 AND is_active=true ORDER BY display_order, name', [tid]
    )).rows;

    // Calculate weighted score
    let totalWeight = 0, weightedSum = 0;
    const scoreEntries = [];

    for (const c of criteria) {
      const score = parseInt(req.body['score_' + c.id]) || 0;
      const comment = (req.body['comment_' + c.id] || '').trim() || null;
      if (score >= 1 && score <= 5) {
        totalWeight += (c.weight || 0);
        weightedSum += score * (c.weight || 0);
        scoreEntries.push({ criteria_id: c.id, score, comment });
      }
    }

    const overallScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : null;
    const overallRating = overallScore ? getOverallRating(overallScore) : null;

    const status = action === 'submit' ? 'submitted' : 'draft';
    const now = new Date().toISOString();

    const result = await pool.query(
      `INSERT INTO staff_appraisals (tenant_id, staff_id, staff_name, department, review_period,
        appraisal_type, overall_score, overall_rating, strengths, areas_for_improvement,
        goals_next_period, reviewer_notes, reviewer_id, status, submitted_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [tid, staff_id || null, staff_name.trim(), (department || '').trim() || null,
        (review_period || '').trim(), appraisal_type || 'annual',
        overallScore, overallRating,
        (strengths || '').trim() || null, (areas_for_improvement || '').trim() || null,
        (goals_next_period || '').trim() || null, (reviewer_notes || '').trim() || null,
        reviewer_id || user.id, status, action === 'submit' ? now : null, now]
    );

    const appraisalId = result.rows[0].id;

    // Insert scores
    for (const se of scoreEntries) {
      await pool.query(
        `INSERT INTO appraisal_scores (appraisal_id, criteria_id, score, comments, scored_by) VALUES ($1,$2,$3,$4,$5)`,
        [appraisalId, se.criteria_id, se.score, se.comment, user.id]
      );
    }

    res.redirect('/appraisals/' + appraisalId);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 7: GET /appraisals/all — List All Appraisals
  // ════════════════════════════════════════════════════════════
  app.get('/appraisals/all', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status: fStatus, department: fDept, period: fPeriod, q, sort } = req.query;

    let where = ['sa.tenant_id=$1'], params = [tid], pi = 2;
    if (fStatus) { where.push(`sa.status=$${pi++}`); params.push(fStatus); }
    if (fDept) { where.push(`sa.department=$${pi++}`); params.push(fDept); }
    if (fPeriod) { where.push(`sa.review_period=$${pi++}`); params.push(fPeriod); }
    if (q) { where.push(`(sa.staff_name ILIKE $${pi} OR sa.department ILIKE $${pi})`); params.push('%' + q + '%'); pi++; }

    const orderMap = { newest: 'sa.created_at DESC', oldest: 'sa.created_at ASC', score_high: 'sa.overall_score DESC NULLS LAST', score_low: 'sa.overall_score ASC NULLS LAST', name: 'sa.staff_name ASC' };
    const orderBy = orderMap[sort] || 'sa.created_at DESC';

    const appraisals = (await pool.query(
      `SELECT sa.*, u.name as reviewer_name FROM staff_appraisals sa
       LEFT JOIN users u ON u.id = sa.reviewer_id
       WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT 200`, params
    )).rows;

    const departments = (await pool.query(
      'SELECT DISTINCT department FROM staff_appraisals WHERE tenant_id=$1 AND department IS NOT NULL ORDER BY department', [tid]
    )).rows;

    const periods = (await pool.query(
      'SELECT DISTINCT review_period FROM staff_appraisals WHERE tenant_id=$1 AND review_period IS NOT NULL ORDER BY review_period DESC', [tid]
    )).rows;

    const rowsHtml = appraisals.map(r => `<tr>
      <td><a href="/appraisals/${r.id}" style="color:#7c3aed;text-decoration:none;font-weight:600">${esc(r.staff_name)}</a></td>
      <td>${esc(r.department || '\u2014')}</td>
      <td>${esc(r.review_period || '\u2014')}</td>
      <td><span style="font-size:11px;padding:2px 6px;border-radius:4px;background:#f3e8ff;color:#7c3aed">${esc(r.appraisal_type || 'annual')}</span></td>
      <td>${ratingBadge(r.status)}</td>
      <td>${r.overall_score ? `<span style="font-weight:700;color:${scoreColor(r.overall_score)}">${parseFloat(r.overall_score).toFixed(1)}</span> / 5.0` : '\u2014'}</td>
      <td>${r.overall_rating ? ratingBadge(r.overall_rating) : '\u2014'}</td>
      <td>${fmtDate(r.created_at)}</td>
      <td><a href="/appraisals/${r.id}" class="sa-btn sa-btn-primary" style="padding:4px 10px;font-size:11px">View</a></td>
    </tr>`).join('');

    const html = SA_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/appraisals/all')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:24px;color:#1e293b">\u{1F4C2} All Appraisals</h1>
        <a href="/appraisals/new" class="sa-btn sa-btn-primary">+ New Appraisal</a>
      </div>
      <div class="sa-card">
        <form method="GET" action="/appraisals/all" class="sa-filter">
          <div><label>Search</label><input type="text" name="q" value="${esc(q || '')}" placeholder="Name, dept..."></div>
          <div><label>Status</label><select name="status">
            <option value="">All</option>
            ${['draft','submitted','under_review','completed','rejected'].map(s => `<option value="${s}" ${fStatus === s ? 'selected' : ''}>${s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>`).join('')}
          </select></div>
          <div><label>Department</label><select name="department">
            <option value="">All</option>
            ${departments.map(d => `<option value="${esc(d.department)}" ${fDept === d.department ? 'selected' : ''}>${esc(d.department)}</option>`).join('')}
          </select></div>
          <div><label>Period</label><select name="period">
            <option value="">All</option>
            ${periods.map(p => `<option value="${esc(p.review_period)}" ${fPeriod === p.review_period ? 'selected' : ''}>${esc(p.review_period)}</option>`).join('')}
          </select></div>
          <div><label>Sort</label><select name="sort">
            <option value="newest" ${sort === 'newest' || !sort ? 'selected' : ''}>Newest</option>
            <option value="oldest" ${sort === 'oldest' ? 'selected' : ''}>Oldest</option>
            <option value="score_high" ${sort === 'score_high' ? 'selected' : ''}>Score: High-Low</option>
            <option value="score_low" ${sort === 'score_low' ? 'selected' : ''}>Score: Low-High</option>
            <option value="name" ${sort === 'name' ? 'selected' : ''}>Name A-Z</option>
          </select></div>
          <button type="submit" class="sa-btn sa-btn-primary" style="margin-top:18px">Filter</button>
          <a href="/appraisals/all" class="sa-btn sa-btn-secondary" style="margin-top:18px;text-decoration:none">Clear</a>
        </form>
        <div style="overflow-x:auto"><table class="sa-tbl">
          <thead><tr><th>Staff</th><th>Dept</th><th>Period</th><th>Type</th><th>Status</th><th>Score</th><th>Rating</th><th>Created</th><th></th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="9" class="sa-empty">No appraisals found. <a href="/appraisals/new">Create your first appraisal</a>.</td></tr>'}</tbody>
        </table></div>
        <div style="margin-top:12px;font-size:12px;color:#94a3b8">Showing ${appraisals.length} appraisal${appraisals.length !== 1 ? 's' : ''}</div>
      </div>
    </div>`;
    res.send(renderPage('All Appraisals', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 8: GET /appraisals/:id — View Appraisal Detail
  // ════════════════════════════════════════════════════════════
  app.get('/appraisals/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const appraisal = (await pool.query(`
      SELECT sa.*, u.name as reviewer_name
      FROM staff_appraisals sa LEFT JOIN users u ON u.id = sa.reviewer_id
      WHERE sa.id=$1 AND sa.tenant_id=$2
    `, [id, tid])).rows[0];

    if (!appraisal) return res.send('<div class="alert">Appraisal not found.</div><a href="/appraisals" class="sa-btn sa-btn-primary">Back</a>');

    // Get scores with criteria details
    const scores = (await pool.query(`
      SELECT aps.*, ac.name as criteria_name, ac.category, ac.weight, ac.rating_scale
      FROM appraisal_scores aps JOIN appraisal_criteria ac ON ac.id = aps.criteria_id
      WHERE aps.appraisal_id=$1 ORDER BY ac.display_order, ac.name
    `, [id])).rows;

    // Build radar chart data (category averages)
    const categoryMap = {};
    for (const s of scores) {
      const cat = s.category || 'performance';
      if (!categoryMap[cat]) categoryMap[cat] = { sum: 0, count: 0 };
      categoryMap[cat].sum += s.score;
      categoryMap[cat].count++;
    }
    const radarData = Object.entries(categoryMap).map(([label, v]) => ({
      label: label.charAt(0).toUpperCase() + label.slice(1).replace(/_/g, ' '),
      value: v.count > 0 ? (v.sum / v.count).toFixed(1) : 0
    }));

    // Score breakdown bars
    const scoreBreakdown = scores.map(s => {
      const scale = typeof s.rating_scale === 'string' ? JSON.parse(s.rating_scale || '{}') : (s.rating_scale || {});
      const label = scale[String(s.score)] || s.score;
      return `<div style="margin-bottom:12px;padding:10px 14px;border:1px solid #f1f5f9;border-radius:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <div>
            <strong style="font-size:13px;color:#1e293b">${esc(s.criteria_name)}</strong>
            <span style="font-size:11px;color:#94a3b8;margin-left:6px">${s.weight}%</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:12px;color:#64748b">${esc(label)}</span>
            <span style="font-size:16px;font-weight:800;color:${scoreColor(s.score)}">${s.score}</span>
          </div>
        </div>
        ${scoreBarHtml(s.score, 5)}
        ${s.comments ? `<div style="font-size:12px;color:#64748b;margin-top:6px;padding:6px 10px;background:#f8fafc;border-radius:6px">\u{1F4AC} ${esc(s.comments)}</div>` : ''}
      </div>`;
    }).join('');

    // Self-appraisal data
    const selfData = appraisal.self_appraisal ? (typeof appraisal.self_appraisal === 'string' ? JSON.parse(appraisal.self_appraisal) : appraisal.self_appraisal) : null;
    const managerData = appraisal.manager_appraisal ? (typeof appraisal.manager_appraisal === 'string' ? JSON.parse(appraisal.manager_appraisal) : appraisal.manager_appraisal) : null;

    // Self vs Manager comparison (if data exists)
    let comparisonHtml = '';
    if (selfData || managerData) {
      const selfScores = selfData ? (selfData.scores || {}) : {};
      const mgrScores = managerData ? (managerData.scores || {}) : {};
      const allKeys = new Set([...Object.keys(selfScores), ...Object.keys(mgrScores)]);

      comparisonHtml = `<div class="sa-section-title" style="margin-top:24px">\u{1F4CA} Self vs Manager Comparison</div>
      <div class="sa-card"><table class="sa-tbl">
        <thead><tr><th>Criterion</th><th>Self Score</th><th>Manager Score</th><th>Gap</th></tr></thead>
        <tbody>${[...allKeys].map(k => {
          const sv = parseInt(selfScores[k]) || 0;
          const mv = parseInt(mgrScores[k]) || 0;
          const gap = mv - sv;
          const gapColor = gap > 0 ? '#15803d' : gap < 0 ? '#dc2626' : '#64748b';
          return `<tr>
            <td><strong>${esc(k)}</strong></td>
            <td>${sv > 0 ? `<span style="font-weight:700;color:#7c3aed">${sv}</span>` : '\u2014'}</td>
            <td>${mv > 0 ? `<span style="font-weight:700;color:#7c3aed">${mv}</span>` : '\u2014'}</td>
            <td style="color:${gapColor};font-weight:600">${gap !== 0 ? (gap > 0 ? '+' : '') + gap : '\u2014'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
    }

    // Action buttons based on status
    let actionButtons = '';
    if (appraisal.status === 'draft') {
      actionButtons = `
        <form method="POST" action="/appraisals/${id}/submit" style="display:inline">
          <button type="submit" class="sa-btn sa-btn-primary">\u2705 Submit Appraisal</button>
        </form>`;
    } else if (appraisal.status === 'submitted' || appraisal.status === 'under_review') {
      actionButtons = `
        <form method="POST" action="/appraisals/${id}/complete" style="display:inline">
          <button type="submit" class="sa-btn sa-btn-success">\u2705 Complete Review</button>
        </form>`;
    }

    const html = SA_CSS + `
    <div style="max-width:1100px;margin:0 auto">
      ${nav('/appraisals')}
      <a href="/appraisals/all" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to All Appraisals</a>

      <!-- Header -->
      <div class="sa-card" style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:16px">
        <div>
          <h1 style="font-size:22px;color:#1e293b;margin-bottom:4px">${esc(appraisal.staff_name)}</h1>
          <div style="font-size:13px;color:#64748b">
            ${esc(appraisal.department || 'No Department')} &middot; ${esc(appraisal.review_period || 'No Period')} &middot;
            <span style="text-transform:capitalize">${esc(appraisal.appraisal_type || 'annual').replace(/_/g, ' ')}</span>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            ${ratingBadge(appraisal.status)}
            ${appraisal.overall_rating ? ratingBadge(appraisal.overall_rating) : ''}
          </div>
        </div>
        <div style="text-align:right">
          ${appraisal.overall_score ? `<div style="font-size:36px;font-weight:900;color:${scoreColor(appraisal.overall_score)}">${parseFloat(appraisal.overall_score).toFixed(1)}</div>
          <div style="font-size:12px;color:#94a3b8">Overall Score / 5.0</div>` : ''}
          <div style="font-size:12px;color:#94a3b8;margin-top:4px">Reviewed by: ${esc(appraisal.reviewer_name || '\u2014')}</div>
          <div style="margin-top:8px;display:flex;gap:6px;justify-content:flex-end">${actionButtons}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <!-- Score Breakdown -->
        <div class="sa-card">
          <div class="sa-section-title">\u{1F4CA} Score Breakdown by Criterion</div>
          ${scoreBreakdown || '<p style="color:#94a3b8;font-size:13px">No scores recorded</p>'}
        </div>

        <!-- Radar Chart -->
        <div class="sa-card" style="text-align:center">
          <div class="sa-section-title">\u{1F5FA} Performance Radar</div>
          ${radarChartHtml(radarData, 300)}
        </div>
      </div>

      <!-- Detailed Comments -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:16px">
        ${appraisal.strengths ? `<div class="sa-card">
          <div class="sa-section-title">\u{1F31F} Strengths</div>
          <p style="font-size:13px;color:#475569;line-height:1.6;white-space:pre-wrap">${esc(appraisal.strengths)}</p>
        </div>` : ''}
        ${appraisal.areas_for_improvement ? `<div class="sa-card">
          <div class="sa-section-title">\u{1F4DD} Areas for Improvement</div>
          <p style="font-size:13px;color:#475569;line-height:1.6;white-space:pre-wrap">${esc(appraisal.areas_for_improvement)}</p>
        </div>` : ''}
        ${appraisal.goals_next_period ? `<div class="sa-card">
          <div class="sa-section-title">\u{1F3AF} Goals Next Period</div>
          <p style="font-size:13px;color:#475569;line-height:1.6;white-space:pre-wrap">${esc(appraisal.goals_next_period)}</p>
        </div>` : ''}
      </div>

      ${appraisal.reviewer_notes ? `<div class="sa-card" style="margin-top:16px">
        <div class="sa-section-title">\u{1F4AC} Reviewer Notes</div>
        <p style="font-size:13px;color:#475569;line-height:1.6;white-space:pre-wrap">${esc(appraisal.reviewer_notes)}</p>
      </div>` : ''}

      ${comparisonHtml}

      <!-- Timeline -->
      <div class="sa-card" style="margin-top:16px">
        <div class="sa-section-title">\u{1F553} Timeline</div>
        <div style="display:flex;gap:24px;flex-wrap:wrap;font-size:13px;color:#64748b">
          <div>Created: <strong style="color:#1e293b">${fmtDateTime(appraisal.created_at)}</strong></div>
          ${appraisal.submitted_at ? `<div>Submitted: <strong style="color:#1e293b">${fmtDateTime(appraisal.submitted_at)}</strong></div>` : ''}
          ${appraisal.completed_at ? `<div>Completed: <strong style="color:#1e293b">${fmtDateTime(appraisal.completed_at)}</strong></div>` : ''}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Appraisal: ' + appraisal.staff_name, html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 9: POST /appraisals/:id/submit — Submit Appraisal
  // ════════════════════════════════════════════════════════════
  app.post('/appraisals/:id/submit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const appraisal = (await pool.query(
      'SELECT id, status FROM staff_appraisals WHERE id=$1 AND tenant_id=$2', [id, tid]
    )).rows[0];
    if (!appraisal) return res.send('<div class="alert">Appraisal not found.</div><a href="/appraisals/all" class="sa-btn sa-btn-primary">Back</a>');
    if (appraisal.status !== 'draft') {
      return res.send('<div class="alert">Only draft appraisals can be submitted.</div><a href="/appraisals/' + id + '" class="sa-btn sa-btn-primary">Back</a>');
    }

    await pool.query(
      `UPDATE staff_appraisals SET status='submitted', submitted_at=NOW() WHERE id=$1 AND tenant_id=$2`,
      [id, tid]
    );
    res.redirect('/appraisals/' + id);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 10: POST /appraisals/:id/complete — Complete Appraisal
  // ════════════════════════════════════════════════════════════
  app.post('/appraisals/:id/complete', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const appraisal = (await pool.query(
      'SELECT id, status FROM staff_appraisals WHERE id=$1 AND tenant_id=$2', [id, tid]
    )).rows[0];
    if (!appraisal) return res.send('<div class="alert">Appraisal not found.</div><a href="/appraisals/all" class="sa-btn sa-btn-primary">Back</a>');
    if (appraisal.status !== 'submitted' && appraisal.status !== 'under_review') {
      return res.send('<div class="alert">Only submitted or under-review appraisals can be completed.</div><a href="/appraisals/' + id + '" class="sa-btn sa-btn-primary">Back</a>');
    }

    await pool.query(
      `UPDATE staff_appraisals SET status='completed', completed_at=NOW(), reviewer_id=$3 WHERE id=$1 AND tenant_id=$2`,
      [id, tid, user.id]
    );
    res.redirect('/appraisals/' + id);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 11: GET /appraisals/reports — Reports
  // ════════════════════════════════════════════════════════════
  app.get('/appraisals/reports', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Department averages
    const deptAvgs = (await pool.query(`
      SELECT department, COUNT(*)::int as cnt,
        COALESCE(AVG(overall_score), 0) as avg_score,
        MIN(overall_score) as min_score,
        MAX(overall_score) as max_score,
        COUNT(*) FILTER (WHERE overall_score >= 3.5)::int as high_performers
      FROM staff_appraisals WHERE tenant_id=$1 AND status='completed' AND department IS NOT NULL
      GROUP BY department ORDER BY avg_score DESC
    `, [tid])).rows;

    // Trend over time (by review period)
    const trend = (await pool.query(`
      SELECT review_period, COUNT(*)::int as cnt, COALESCE(AVG(overall_score), 0) as avg_score
      FROM staff_appraisals WHERE tenant_id=$1 AND status='completed' AND review_period IS NOT NULL
      GROUP BY review_period ORDER BY review_period DESC LIMIT 12
    `, [tid])).rows;

    // Distribution
    const distribution = (await pool.query(`
      SELECT overall_rating, COUNT(*)::int as cnt
      FROM staff_appraisals WHERE tenant_id=$1 AND status='completed' AND overall_rating IS NOT NULL
      GROUP BY overall_rating ORDER BY
        CASE overall_rating WHEN 'outstanding' THEN 1 WHEN 'excellent' THEN 2 WHEN 'good' THEN 3
          WHEN 'satisfactory' THEN 4 WHEN 'needs_improvement' THEN 5 WHEN 'unsatisfactory' THEN 6 ELSE 7 END
    `, [tid])).rows;

    const totalDist = distribution.reduce((s, d) => s + d.cnt, 0);
    const distColors = {
      outstanding: '#f59e0b', excellent: '#10b981', good: '#3b82f6',
      satisfactory: '#8b5cf6', needs_improvement: '#f97316', unsatisfactory: '#ef4444'
    };
    const distRatingLabels = {
      outstanding: 'Outstanding', excellent: 'Excellent', good: 'Good',
      satisfactory: 'Satisfactory', needs_improvement: 'Needs Improvement', unsatisfactory: 'Unsatisfactory'
    };

    // Top performers
    const topPerformers = (await pool.query(`
      SELECT sa.*, u.name as reviewer_name
      FROM staff_appraisals sa LEFT JOIN users u ON u.id = sa.reviewer_id
      WHERE sa.tenant_id=$1 AND sa.status='completed' AND sa.overall_score IS NOT NULL
      ORDER BY sa.overall_score DESC LIMIT 10
    `, [tid])).rows;

    // Bottom performers
    const bottomPerformers = (await pool.query(`
      SELECT sa.*, u.name as reviewer_name
      FROM staff_appraisals sa LEFT JOIN users u ON u.id = sa.reviewer_id
      WHERE sa.tenant_id=$1 AND sa.status='completed' AND sa.overall_score IS NOT NULL
      ORDER BY sa.overall_score ASC LIMIT 10
    `, [tid])).rows;

    // Criteria averages (which criteria scored highest/lowest)
    const criteriaAvgs = (await pool.query(`
      SELECT ac.name, ac.category, ac.weight, COUNT(aps.id)::int as evaluation_count,
        COALESCE(AVG(aps.score), 0) as avg_score
      FROM appraisal_criteria ac
      LEFT JOIN appraisal_scores aps ON aps.criteria_id = ac.id
        JOIN staff_appraisals sa ON sa.id = aps.appraisal_id AND sa.status='completed'
      WHERE ac.tenant_id=$1 AND ac.is_active=true
      GROUP BY ac.id ORDER BY avg_score DESC
    `, [tid])).rows;

    // Department comparison chart
    const deptChartHtml = deptAvgs.map(d => {
      const pct = Math.min(100, ((parseFloat(d.avg_score) || 0) / 5) * 100);
      return `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
          <span style="font-weight:600;color:#1e293b">${esc(d.department)}</span>
          <span style="color:#7c3aed;font-weight:700">${parseFloat(d.avg_score).toFixed(2)} (${d.cnt})</span>
        </div>
        ${scoreBarHtml(d.avg_score, 5)}
      </div>`;
    }).join('');

    // Trend chart
    const trendHtml = trend.reverse().map(t => {
      const pct = Math.min(100, ((parseFloat(t.avg_score) || 0) / 5) * 100);
      return `<div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
          <span style="font-weight:600;color:#1e293b">${esc(t.review_period)}</span>
          <span style="color:#7c3aed;font-weight:700">${parseFloat(t.avg_score).toFixed(2)} (${t.cnt})</span>
        </div>
        ${scoreBarHtml(t.avg_score, 5)}
      </div>`;
    }).join('');

    // Distribution chart
    const distHtml = distribution.map(d => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span style="font-size:12px;font-weight:600;color:#1e293b;min-width:140px">${esc(distRatingLabels[d.overall_rating] || d.overall_rating)}</span>
      <div style="flex:1;height:20px;background:#f1f5f9;border-radius:10px;overflow:hidden">
        <div style="height:100%;width:${totalDist > 0 ? (d.cnt / totalDist * 100) : 0}%;background:${distColors[d.overall_rating] || '#94a3b8'};border-radius:10px;transition:.3s"></div>
      </div>
      <span style="font-size:12px;font-weight:700;color:#475569;min-width:50px;text-align:right">${d.cnt} (${totalDist > 0 ? Math.round(d.cnt / totalDist * 100) : 0}%)</span>
    </div>`).join('');

    // Top performers list
    const topHtml = topPerformers.map((p, i) => `<tr>
      <td><span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${i < 3 ? '#fef3c7' : '#f1f5f9'};color:${i < 3 ? '#92400e' : '#64748b'};font-size:11px;font-weight:700">${i + 1}</span></td>
      <td><a href="/appraisals/${p.id}" style="color:#7c3aed;text-decoration:none;font-weight:600">${esc(p.staff_name)}</a></td>
      <td>${esc(p.department || '\u2014')}</td>
      <td><span style="font-weight:800;color:#15803d">${parseFloat(p.overall_score).toFixed(1)}</span></td>
      <td>${ratingBadge(p.overall_rating)}</td>
    </tr>`).join('');

    // Bottom performers list
    const bottomHtml = bottomPerformers.map((p, i) => `<tr>
      <td><span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#fee2e2;color:#991b1b;font-size:11px;font-weight:700">${i + 1}</span></td>
      <td><a href="/appraisals/${p.id}" style="color:#7c3aed;text-decoration:none;font-weight:600">${esc(p.staff_name)}</a></td>
      <td>${esc(p.department || '\u2014')}</td>
      <td><span style="font-weight:800;color:#dc2626">${parseFloat(p.overall_score).toFixed(1)}</span></td>
      <td>${ratingBadge(p.overall_rating)}</td>
    </tr>`).join('');

    // Criteria averages
    const critHtml = criteriaAvgs.map(c => `<tr>
      <td><strong>${esc(c.name)}</strong></td>
      <td><span style="font-size:11px;padding:2px 6px;border-radius:4px;background:#f3e8ff;color:#7c3aed">${esc(c.category || 'performance')}</span></td>
      <td>${c.weight}%</td>
      <td>${scoreBarHtml(c.avg_score, 5)}</td>
    </tr>`).join('');

    const html = SA_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/appraisals/reports')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\u{1F4C8} Appraisal Reports</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Department analytics, trends, and performance insights</p></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <!-- Department Averages -->
        <div class="sa-card">
          <div class="sa-section-title">\u{1F3E2} Department Averages</div>
          ${deptChartHtml || '<p style="color:#94a3b8;font-size:13px">No completed appraisals</p>'}
        </div>

        <!-- Rating Distribution -->
        <div class="sa-card">
          <div class="sa-section-title">\u{1F4CA} Rating Distribution</div>
          ${distHtml || '<p style="color:#94a3b8;font-size:13px">No completed appraisals</p>'}
        </div>
      </div>

      <!-- Trend Over Time -->
      <div class="sa-card" style="margin-bottom:16px">
        <div class="sa-section-title">\u{1F4C9} Score Trend Over Time</div>
        ${trendHtml || '<p style="color:#94a3b8;font-size:13px">No completed appraisals</p>'}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <!-- Top Performers -->
        <div class="sa-card">
          <div class="sa-section-title">\u{1F3C6} Top Performers</div>
          <div style="overflow-x:auto"><table class="sa-tbl">
            <thead><tr><th>#</th><th>Staff</th><th>Dept</th><th>Score</th><th>Rating</th></tr></thead>
            <tbody>${topHtml || '<tr><td colspan="5" class="sa-empty">No completed appraisals</td></tr>'}</tbody>
          </table></div>
        </div>

        <!-- Bottom Performers -->
        <div class="sa-card">
          <div class="sa-section-title">\u{26A0}\uFE0F Needs Attention</div>
          <div style="overflow-x:auto"><table class="sa-tbl">
            <thead><tr><th>#</th><th>Staff</th><th>Dept</th><th>Score</th><th>Rating</th></tr></thead>
            <tbody>${bottomHtml || '<tr><td colspan="5" class="sa-empty">No completed appraisals</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>

      <!-- Criteria Analysis -->
      <div class="sa-card">
        <div class="sa-section-title">\u{1F3AF} Criteria Performance Analysis</div>
        <div style="overflow-x:auto"><table class="sa-tbl">
          <thead><tr><th>Criterion</th><th>Category</th><th>Weight</th><th>Average Score</th></tr></thead>
          <tbody>${critHtml || '<tr><td colspan="4" class="sa-empty">No criteria data available</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Appraisal Reports', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 12: GET /appraisals/staff/:staff_id — Staff History
  // ════════════════════════════════════════════════════════════
  app.get('/appraisals/staff/:staff_id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, staffId = req.params.staff_id;

    // Get staff member name
    let staffName = null;
    try {
      const staffRow = (await pool.query('SELECT name FROM users WHERE id=$1 AND tenant_id=$2', [staffId, tid])).rows[0];
      if (staffRow) staffName = staffRow.name;
    } catch (e) {}

    const appraisals = (await pool.query(`
      SELECT sa.*, u.name as reviewer_name
      FROM staff_appraisals sa LEFT JOIN users u ON u.id = sa.reviewer_id
      WHERE sa.tenant_id=$1 AND (sa.staff_id=$2 OR sa.staff_name ILIKE (SELECT name FROM users WHERE id=$2))
      ORDER BY sa.created_at DESC
    `, [tid, staffId])).rows;

    // Also try by name match if staff_id is numeric but no match
    if (appraisals.length === 0 && !staffName) {
      const byName = (await pool.query(
        'SELECT * FROM staff_appraisals WHERE tenant_id=$1 AND staff_id=$2 ORDER BY created_at DESC', [tid, staffId]
      )).rows;
      appraisals.push(...byName);
    }

    // Aggregate stats
    const completedAppraisals = appraisals.filter(a => a.status === 'completed');
    const avgScore = completedAppraisals.length > 0
      ? (completedAppraisals.reduce((s, a) => s + (parseFloat(a.overall_score) || 0), 0) / completedAppraisals.length).toFixed(2)
      : null;
    const bestScore = completedAppraisals.length > 0
      ? Math.max(...completedAppraisals.map(a => parseFloat(a.overall_score) || 0)).toFixed(1)
      : null;

    // Score trend
    const trendHtml = completedAppraisals.reverse().map(a => `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="font-weight:600;color:#1e293b">${esc(a.review_period || 'N/A')}</span>
        <span style="color:#7c3aed;font-weight:700">${parseFloat(a.overall_score || 0).toFixed(1)}</span>
      </div>
      ${scoreBarHtml(a.overall_score, 5)}
    </div>`).join('');

    const rowsHtml = appraisals.map(a => `<tr>
      <td><a href="/appraisals/${a.id}" style="color:#7c3aed;text-decoration:none;font-weight:600">${esc(a.review_period || '\u2014')}</a></td>
      <td><span style="text-transform:capitalize">${esc((a.appraisal_type || 'annual').replace(/_/g, ' '))}</span></td>
      <td>${ratingBadge(a.status)}</td>
      <td>${a.overall_score ? `<span style="font-weight:700;color:${scoreColor(a.overall_score)}">${parseFloat(a.overall_score).toFixed(1)}</span>` : '\u2014'}</td>
      <td>${a.overall_rating ? ratingBadge(a.overall_rating) : '\u2014'}</td>
      <td>${fmtDate(a.created_at)}</td>
      <td><a href="/appraisals/${a.id}" class="sa-btn sa-btn-primary" style="padding:4px 10px;font-size:11px">View</a></td>
    </tr>`).join('');

    // Radar chart from latest completed appraisal
    let radarHtml = '';
    if (completedAppraisals.length > 0) {
      const latestCompleted = completedAppraisals[completedAppraisals.length - 1];
      const scores = (await pool.query(`
        SELECT aps.score, ac.category
        FROM appraisal_scores aps JOIN appraisal_criteria ac ON ac.id = aps.criteria_id
        WHERE aps.appraisal_id=$1
      `, [latestCompleted.id])).rows;

      const catMap = {};
      for (const s of scores) {
        const cat = s.category || 'performance';
        if (!catMap[cat]) catMap[cat] = { sum: 0, count: 0 };
        catMap[cat].sum += s.score;
        catMap[cat].count++;
      }
      const radarData = Object.entries(catMap).map(([label, v]) => ({
        label: label.charAt(0).toUpperCase() + label.slice(1).replace(/_/g, ' '),
        value: v.count > 0 ? (v.sum / v.count).toFixed(1) : 0
      }));
      radarHtml = `<div class="sa-card">
        <div class="sa-section-title">\u{1F5FA} Latest Performance Profile (${esc(latestCompleted.review_period || 'N/A')})</div>
        ${radarChartHtml(radarData, 280)}
      </div>`;
    }

    const html = SA_CSS + `
    <div style="max-width:1100px;margin:0 auto">
      ${nav('/appraisals')}
      <a href="/appraisals/all" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to All Appraisals</a>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b">\u{1F464} ${esc(staffName || 'Staff Member #' + staffId)}</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Performance history and appraisal records</p></div>
        <a href="/appraisals/new" class="sa-btn sa-btn-primary">+ New Appraisal</a>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">
        <div class="sa-stat-card"><div class="sa-stat-num">${appraisals.length}</div><div class="sa-stat-label">Total Appraisals</div></div>
        <div class="sa-stat-card"><div class="sa-stat-num" style="color:#059669">${completedAppraisals.length}</div><div class="sa-stat-label">Completed</div></div>
        <div class="sa-stat-card"><div class="sa-stat-num" style="color:#7c3aed">${avgScore || '\u2014'}</div><div class="sa-stat-label">Average Score</div></div>
        <div class="sa-stat-card"><div class="sa-stat-num" style="color:#f59e0b">${bestScore || '\u2014'}</div><div class="sa-stat-label">Best Score</div></div>
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:16px">
        <div class="sa-card">
          <div class="sa-section-title">\u{1F4CB} All Appraisals</div>
          <div style="overflow-x:auto"><table class="sa-tbl">
            <thead><tr><th>Period</th><th>Type</th><th>Status</th><th>Score</th><th>Rating</th><th>Created</th><th></th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="7" class="sa-empty">No appraisals found for this staff member</td></tr>'}</tbody>
          </table></div>
        </div>
        <div>
          ${radarHtml || '<div class="sa-card" style="text-align:center"><p style="color:#94a3b8;font-size:13px">No completed appraisals for radar chart</p></div>'}
          ${completedAppraisals.length > 0 ? `<div class="sa-card">
            <div class="sa-section-title">\u{1F4C9} Score Trend</div>
            ${trendHtml}
          </div>` : ''}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Staff Appraisals: ' + (staffName || 'Staff #' + staffId), html, user, req));
  }));

};
