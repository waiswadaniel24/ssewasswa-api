// ============================================================
// ACADEMIC INTEGRITY MODULE — Multi-Tenant SaaS School Portal
// Plagiarism detection dashboard, case management, honor code
// tracking, violation reporting, investigation workflow, penalty
// management, student integrity scores, appeal process, report
// archive, similarity score tracking, source verification, faculty
// training records, integrity pledge management, analytics/trends.
// ============================================================
// Usage in server.js:
//   const academicIntegrity = require('./academic-integrity');
//   academicIntegrity(app, pool, { esc, renderPage, ah, requireAuth,
//     requireNotBanned, audit, queueEmail, uiT });
// ============================================================

'use strict';

module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || (fn => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const requireNotBanned = opts.requireNotBanned || ((req, res, next) => next());
  const audit = opts.audit || (() => {});
  const queueEmail = opts.queueEmail || (() => {});
  const uiT = opts.uiT || (() => '');

  // ─── CONSTANTS ──────────────────────────────────────────────────────────
  const P = '#4f46e5', GRAY = '#6b7280';
  const C = {
    primary: '#4f46e5', primaryLight: '#6366f1', green: '#059669',
    greenLight: '#10b981', red: '#dc2626', redLight: '#ef4444',
    orange: '#f59e0b', orangeLight: '#fbbf24', blue: '#2563eb',
    purple: '#7c3aed', bg: '#f0f4ff', card: '#ffffff',
    text: '#1e293b', textMuted: '#64748b', border: '#e2e8f0'
  };

  const CASE_TYPES = ['plagiarism', 'cheating', 'fabrication', 'facilitation', 'collusion', 'self_plagiarism', 'other'];
  const STATUSES = ['reported', 'under_review', 'investigating', 'evidence_gathering', 'hearing_scheduled', 'adjudicated', 'appealed', 'resolved', 'dismissed'];
  const SEVERITIES = ['minor', 'moderate', 'major', 'critical'];
  const PENALTY_TYPES = ['warning', 'zero_grade', 'assignment_resubmit', 'course_fail', 'suspension', 'expulsion', 'probation', 'community_service', 'ethics_course', 'academic_retake'];
  const APPEAL_STATUSES = ['none', 'pending', 'under_review', 'approved', 'denied'];
  const PLEDGE_CONTEXTS = ['enrollment', 'course', 'exam', 'assignment', 'thesis', 'general'];

  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style><div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#4f46e5">School</a> &rsaquo; Academic Integrity</div>';

  // ─── HELPERS ────────────────────────────────────────────────────────────
  function fmtDate(d) {
    return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  }
  function fmtDateTime(d) {
    return d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  }
  function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

  function statusBadge(s) {
    const m = {
      reported: { bg: '#dbeafe', color: '#1d4ed8', label: 'Reported' },
      under_review: { bg: '#fef3c7', color: '#b45309', label: 'Under Review' },
      investigating: { bg: '#ffedd5', color: '#c2410c', label: 'Investigating' },
      evidence_gathering: { bg: '#fce7f3', color: '#be185d', label: 'Evidence Gathering' },
      hearing_scheduled: { bg: '#ede9fe', color: '#7c3aed', label: 'Hearing Scheduled' },
      adjudicated: { bg: '#e0e7ff', color: '#4338ca', label: 'Adjudicated' },
      appealed: { bg: '#fef9c3', color: '#a16207', label: 'Appealed' },
      resolved: { bg: '#dcfce7', color: '#15803d', label: 'Resolved' },
      dismissed: { bg: '#f1f5f9', color: '#64748b', label: 'Dismissed' }
    };
    const v = m[s] || { bg: '#f1f5f9', color: '#64748b', label: s || 'Unknown' };
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${v.bg};color:${v.color}">${esc(v.label)}</span>`;
  }

  function severityBadge(s) {
    const m = {
      minor: { bg: '#f1f5f9', color: '#475569', icon: '⚪' },
      moderate: { bg: '#fef3c7', color: '#92400e', icon: '🟡' },
      major: { bg: '#ffedd5', color: '#c2410c', icon: '🟠' },
      critical: { bg: '#fee2e2', color: '#991b1b', icon: '🔴' }
    };
    const v = m[s] || m.minor;
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${v.bg};color:${v.color}">${v.icon} ${esc(s)}</span>`;
  }

  function similarityColor(score) {
    if (score >= 75) return C.red;
    if (score >= 50) return C.orange;
    if (score >= 25) return '#eab308';
    return C.green;
  }

  function getTid(req) { return req.session?.user?.tenant_id || req.tenant?.id || 0; }
  function getUserId(req) { return req.session?.user?.id || req.user?.id || 0; }

  // ─── SVG CHART HELPERS ──────────────────────────────────────────────────
  function svgBarChart(data, opts = {}) {
    const w = opts.width || 600, h = opts.height || 260;
    const pad = { top: 35, right: 20, bottom: 45, left: 45 };
    const cw = w - pad.left - pad.right, ch = h - pad.top - pad.bottom;
    const maxV = opts.maxV || Math.max(...data.map(d => d.v), 1);
    const color = opts.color || C.primary;
    if (!data.length) return `<svg width="${w}" height="${h}"><text x="${w/2}" y="${h/2}" fill="${C.textMuted}" text-anchor="middle">No data</text></svg>`;
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
      const c = d.c || color;
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(barH, 0)}" fill="${c}" rx="4"><title>${esc(d.l)}: ${d.v}</title></rect>`;
      if (d.v > 0) bars += `<text x="${x + barW / 2}" y="${y - 6}" fill="${C.text}" text-anchor="middle" font-size="11" font-weight="bold">${d.v}</text>`;
      labels += `<text x="${pad.left + i * gap + gap / 2}" y="${h - 8}" fill="${C.textMuted}" text-anchor="middle" font-size="10" transform="rotate(-25,${pad.left + i * gap + gap / 2},${h - 8})">${esc(d.l)}</text>`;
    });
    return `<svg width="${w}" height="${h}" role="img" aria-label="${esc(opts.title || 'Bar chart')}">
      <rect width="${w}" height="${h}" fill="${C.card}" rx="8"/>
      ${gridLines}${bars}${labels}
      ${opts.title ? `<text x="${w / 2}" y="20" fill="${C.text}" text-anchor="middle" font-size="13" font-weight="bold">${esc(opts.title)}</text>` : ''}
    </svg>`;
  }

  function svgDonutChart(data, opts = {}) {
    const w = opts.width || 280, h = opts.height || 280;
    const cx = w / 2, cy = h / 2, outerR = opts.outerR || 110, innerR = opts.innerR || 65;
    const total = data.reduce((s, d) => s + d.v, 0) || 1;
    const colors = opts.colors || ['#4f46e5', '#059669', '#f59e0b', '#dc2626', '#7c3aed', '#2563eb'];
    let arcs = '';
    let startAngle = -Math.PI / 2;
    data.forEach((d, i) => {
      if (d.v === 0) return;
      const sweep = (d.v / total) * Math.PI * 2;
      const endAngle = startAngle + sweep;
      const largeArc = sweep > Math.PI ? 1 : 0;
      const x1 = cx + outerR * Math.cos(startAngle), y1 = cy + outerR * Math.sin(startAngle);
      const x2 = cx + outerR * Math.cos(endAngle), y2 = cy + outerR * Math.sin(endAngle);
      const ix1 = cx + innerR * Math.cos(endAngle), iy1 = cy + innerR * Math.sin(endAngle);
      const ix2 = cx + innerR * Math.cos(startAngle), iy2 = cy + innerR * Math.sin(startAngle);
      const col = colors[i % colors.length];
      arcs += `<path d="M${x1},${y1} A${outerR},${outerR} 0 ${largeArc},1 ${x2},${y2} L${ix1},${iy1} A${innerR},${innerR} 0 ${largeArc},0 ${ix2},${iy2} Z" fill="${col}" stroke="#fff" stroke-width="2"><title>${esc(d.l)}: ${d.v} (${pct(d.v, total)}%)</title></path>`;
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

  function svgLineChart(data, opts = {}) {
    const w = opts.width || 600, h = opts.height || 240;
    const pad = { top: 30, right: 20, bottom: 40, left: 40 };
    const cw = w - pad.left - pad.right, ch = h - pad.top - pad.bottom;
    const maxV = opts.maxV || Math.max(...data.map(d => d.v), 1);
    const color = opts.color || C.primary;
    if (!data.length) return `<svg width="${w}" height="${h}"><text x="${w/2}" y="${h/2}" fill="${C.textMuted}" text-anchor="middle">No data</text></svg>`;
    const points = data.map((d, i) => ({
      x: pad.left + (i / Math.max(data.length - 1, 1)) * cw,
      y: pad.top + ch - (d.v / maxV) * ch
    }));
    const poly = points.map(p => `${p.x},${p.y}`).join(' ');
    const areaPoly = `${pad.left},${pad.top + ch} ${poly} ${points[points.length - 1].x},${pad.top + ch}`;
    let gridLines = '';
    for (let i = 0; i <= 4; i++) {
      const v = (maxV / 4) * i;
      const y = pad.top + ch - (v / maxV) * ch;
      gridLines += `<line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" stroke="${C.border}" stroke-width="1" stroke-dasharray="4,4"/>`;
      gridLines += `<text x="${pad.left - 8}" y="${y + 4}" fill="${C.textMuted}" text-anchor="end" font-size="11">${Math.round(v)}</text>`;
    }
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

  // ─── SHARED LAYOUT ──────────────────────────────────────────────────────
  function pageShell(title, content, activeNav) {
    const navItems = [
      { href: '/school/academic-integrity', label: '📊 Dashboard', active: activeNav === 'dash' },
      { href: '/school/academic-integrity/cases', label: '📁 Cases', active: activeNav === 'cases' },
      { href: '/school/academic-integrity/report-violation', label: '🚨 Report', active: activeNav === 'report' },
      { href: '/school/academic-integrity/plagiarism-reports', label: '🔍 Plagiarism', active: activeNav === 'plag' },
      { href: '/school/academic-integrity/pledges', label: '✋ Pledges', active: activeNav === 'pledges' },
      { href: '/school/academic-integrity/appeals', label: '⚖️ Appeals', active: activeNav === 'appeals' },
      { href: '/school/academic-integrity/scores', label: '📈 Scores', active: activeNav === 'scores' },
      { href: '/school/academic-integrity/analytics', label: '📉 Analytics', active: activeNav === 'analytics' },
      { href: '/school/academic-integrity/settings', label: '⚙️ Settings', active: activeNav === 'settings' }
    ];
    let navHtml = navItems.map(n =>
      `<a href="${n.href}" style="display:inline-block;padding:8px 14px;margin:2px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:500;${n.active ? 'background:' + C.primary + ';color:#fff;' : 'color:' + C.text + ';background:#f1f5f9;'}" aria-current="${n.active ? 'page' : 'false'}">${n.label}</a>`
    ).join('');
    return `<div style="max-width:1200px;margin:0 auto;padding:20px;font-family:system-ui,-apple-system,sans-serif;color:${C.text};">
      ${SKIP}
      <h1 style="color:${C.primary};margin:0 0 4px;font-size:24px;">${esc(title)}</h1>
      <p style="color:${C.textMuted};margin:0 0 16px;font-size:14px;">Upholding academic excellence through transparency and accountability.</p>
      <nav style="margin-bottom:24px;padding:12px;background:${C.card};border-radius:12px;border:1px solid ${C.border};display:flex;flex-wrap:wrap;" aria-label="Academic Integrity Navigation">${navHtml}</nav>
      <div style="background:${C.card};border-radius:12px;border:1px solid ${C.border};padding:24px;">${content}</div>
    </div>`;
  }

  // ─── DATABASE MIGRATIONS ────────────────────────────────────────────────
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS integrity_cases (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          student_id INTEGER NOT NULL,
          case_type VARCHAR(50) NOT NULL,
          description TEXT NOT NULL,
          evidence JSONB DEFAULT '[]',
          status VARCHAR(30) DEFAULT 'reported',
          severity VARCHAR(20) DEFAULT 'moderate',
          penalty VARCHAR(100),
          reported_by INTEGER NOT NULL,
          investigated_by INTEGER,
          notes TEXT,
          hearing_date TIMESTAMPTZ,
          hearing_notes TEXT,
          appeal_status VARCHAR(20) DEFAULT 'none',
          appeal_reason TEXT,
          appeal_decided_by INTEGER,
          appeal_outcome TEXT,
          appeal_decided_at TIMESTAMPTZ,
          similarity_score DECIMAL(5,2),
          source_details JSONB DEFAULT '[]',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          resolved_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_ic_tenant ON integrity_cases(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ic_student ON integrity_cases(tenant_id, student_id);
        CREATE INDEX IF NOT EXISTS idx_ic_status ON integrity_cases(tenant_id, status);
        CREATE INDEX IF NOT EXISTS idx_ic_type ON integrity_cases(tenant_id, case_type);
        CREATE INDEX IF NOT EXISTS idx_ic_severity ON integrity_cases(tenant_id, severity);
        CREATE INDEX IF NOT EXISTS idx_ic_created ON integrity_cases(tenant_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_ic_reported ON integrity_cases(tenant_id, reported_by);
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS integrity_pledges (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          student_id INTEGER NOT NULL,
          pledge_text TEXT NOT NULL,
          context VARCHAR(50) DEFAULT 'general',
          course_id INTEGER,
          exam_id INTEGER,
          assignment_id INTEGER,
          signed_at TIMESTAMPTZ DEFAULT NOW(),
          ip_address VARCHAR(45),
          user_agent TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ip_tenant ON integrity_pledges(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ip_student ON integrity_pledges(tenant_id, student_id);
        CREATE INDEX IF NOT EXISTS idx_ip_context ON integrity_pledges(tenant_id, context);
        CREATE INDEX IF NOT EXISTS idx_ip_signed ON integrity_pledges(tenant_id, signed_at);
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS plagiarism_reports (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          submission_id INTEGER NOT NULL,
          student_id INTEGER NOT NULL,
          assignment_id INTEGER,
          course_id INTEGER,
          similarity_score DECIMAL(5,2) NOT NULL DEFAULT 0,
          word_count INTEGER DEFAULT 0,
          matched_sources JSONB DEFAULT '[]',
          report_data JSONB DEFAULT '{}',
          status VARCHAR(20) DEFAULT 'pending',
          reviewed_by INTEGER,
          reviewed_at TIMESTAMPTZ,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_pr_tenant ON plagiarism_reports(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_pr_submission ON plagiarism_reports(tenant_id, submission_id);
        CREATE INDEX IF NOT EXISTS idx_pr_student ON plagiarism_reports(tenant_id, student_id);
        CREATE INDEX IF NOT EXISTS idx_pr_score ON plagiarism_reports(tenant_id, similarity_score);
        CREATE INDEX IF NOT EXISTS idx_pr_status ON plagiarism_reports(tenant_id, status);
        CREATE INDEX IF NOT EXISTS idx_pr_course ON plagiarism_reports(tenant_id, course_id);
        CREATE INDEX IF NOT EXISTS idx_pr_created ON plagiarism_reports(tenant_id, created_at);
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS integrity_settings (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          honor_code TEXT DEFAULT 'I pledge to uphold the highest standards of academic integrity in all my work. I will not plagiarize, cheat, or assist others in academic dishonesty.',
          auto_flag_threshold DECIMAL(5,2) DEFAULT 25.00,
          penalty_matrix JSONB DEFAULT '{}'::jsonb,
          require_pledge_for_submissions BOOLEAN DEFAULT true,
          require_pledge_for_exams BOOLEAN DEFAULT true,
          faculty_training_required BOOLEAN DEFAULT false,
          anonymous_reporting BOOLEAN DEFAULT true,
          notification_emails JSONB DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_iset_tenant ON integrity_settings(tenant_id);
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS faculty_training (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          faculty_id INTEGER NOT NULL,
          training_type VARCHAR(100) NOT NULL,
          training_title VARCHAR(255) NOT NULL,
          description TEXT,
          completed BOOLEAN DEFAULT false,
          completed_at TIMESTAMPTZ,
          due_date DATE,
          certificate_url VARCHAR(500),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_ft_tenant ON faculty_training(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ft_faculty ON faculty_training(tenant_id, faculty_id);
        CREATE INDEX IF NOT EXISTS idx_ft_completed ON faculty_training(tenant_id, completed);
      `);

      console.log('[AcademicIntegrity] Tables ready');
    } catch (e) { console.warn('[AcademicIntegrity] Migration warning:', e.message); }
  })();

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 1: GET /school/academic-integrity — Dashboard
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/school/academic-integrity', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req);
    const [totalCases, openCases, recentCases, typeBreakdown, severityBreakdown, recentPlag] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS cnt FROM integrity_cases WHERE tenant_id=$1`, [t]),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM integrity_cases WHERE tenant_id=$1 AND status NOT IN ('resolved','dismissed')`, [t]),
      pool.query(`SELECT ic.*, u.name AS student_name, ur.name AS reporter_name
        FROM integrity_cases ic
        LEFT JOIN users u ON u.id=ic.student_id
        LEFT JOIN users ur ON ur.id=ic.reported_by
        WHERE ic.tenant_id=$1 ORDER BY ic.created_at DESC LIMIT 8`, [t]),
      pool.query(`SELECT case_type, COUNT(*)::int AS cnt FROM integrity_cases WHERE tenant_id=$1 GROUP BY case_type ORDER BY cnt DESC`, [t]),
      pool.query(`SELECT severity, COUNT(*)::int AS cnt FROM integrity_cases WHERE tenant_id=$1 GROUP BY severity ORDER BY cnt DESC`, [t]),
      pool.query(`SELECT pr.*, u.name AS student_name FROM plagiarism_reports pr
        LEFT JOIN users u ON u.id=pr.student_id
        WHERE pr.tenant_id=$1 ORDER BY pr.created_at DESC LIMIT 5`, [t])
    ]);
    const total = totalCases.rows[0].cnt;
    const open = openCases.rows[0].cnt;
    const typeData = typeBreakdown.rows.map(r => ({ l: r.case_type.replace(/_/g, ' '), v: r.cnt }));
    const sevData = severityBreakdown.rows.map(r => ({ l: r.severity, v: r.cnt, c: r.severity === 'critical' ? C.red : r.severity === 'major' ? C.orange : r.severity === 'moderate' ? '#eab308' : C.green }));

    const recentHtml = recentCases.rows.map(r => `<tr>
      <td><a href="/school/academic-integrity/cases" style="color:${C.primary};font-weight:600;">#${r.id}</a></td>
      <td>${esc(r.student_name || 'Unknown')}</td>
      <td>${esc(r.case_type?.replace(/_/g, ' ') || 'N/A')}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${severityBadge(r.severity)}</td>
      <td style="font-size:12px;color:${C.textMuted};">${fmtDateTime(r.created_at)}</td>
    </tr>`).join('');

    const plagHtml = recentPlag.rows.map(r => {
      const sc = parseFloat(r.similarity_score);
      return `<tr>
        <td>#${r.id}</td>
        <td>${esc(r.student_name || 'Unknown')}</td>
        <td style="font-weight:700;color:${similarityColor(sc)};">${sc.toFixed(1)}%</td>
        <td>${statusBadge(r.status)}</td>
        <td style="font-size:12px;color:${C.textMuted};">${fmtDateTime(r.created_at)}</td>
      </tr>`;
    }).join('');

    const avgScore = recentPlag.rows.length > 0
      ? (recentPlag.rows.reduce((s, r) => s + parseFloat(r.similarity_score), 0) / recentPlag.rows.length).toFixed(1)
      : '—';

    let html = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px;">
        <div style="background:linear-gradient(135deg,${C.primary},${C.primaryLight});padding:20px;border-radius:12px;color:#fff;">
          <div style="font-size:13px;opacity:0.9;">Total Cases</div>
          <div style="font-size:36px;font-weight:800;margin:4px 0;">${total}</div>
          <div style="font-size:12px;opacity:0.8;">All time</div>
        </div>
        <div style="background:linear-gradient(135deg,#b45309,${C.orange});padding:20px;border-radius:12px;color:#fff;">
          <div style="font-size:13px;opacity:0.9;">Open Cases</div>
          <div style="font-size:36px;font-weight:800;margin:4px 0;">${open}</div>
          <div style="font-size:12px;opacity:0.8;">Require attention</div>
        </div>
        <div style="background:linear-gradient(135deg,${C.red},${C.redLight});padding:20px;border-radius:12px;color:#fff;">
          <div style="font-size:13px;opacity:0.9;">Avg Similarity</div>
          <div style="font-size:36px;font-weight:800;margin:4px 0;">${avgScore}%</div>
          <div style="font-size:12px;opacity:0.8;">Recent reports</div>
        </div>
        <div style="background:linear-gradient(135deg,${C.green},${C.greenLight});padding:20px;border-radius:12px;color:#fff;">
          <div style="font-size:13px;opacity:0.9;">Resolution Rate</div>
          <div style="font-size:36px;font-weight:800;margin:4px 0;">${pct(total - open, total)}%</div>
          <div style="font-size:12px;opacity:0.8;">${total - open} of ${total}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
        <div>
          <h3 style="font-size:16px;margin-bottom:12px;">Cases by Type</h3>
          ${typeData.length > 0 ? svgDonutChart(typeData, { title: 'Case Types' }) : '<p style="color:' + C.textMuted + '">No cases recorded yet.</p>'}
        </div>
        <div>
          <h3 style="font-size:16px;margin-bottom:12px;">Cases by Severity</h3>
          ${sevData.length > 0 ? svgBarChart(sevData, { title: 'Severity Distribution' }) : '<p style="color:' + C.textMuted + '">No cases recorded yet.</p>'}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
        <div>
          <h3 style="font-size:16px;margin-bottom:12px;">Recent Cases</h3>
          <div style="overflow-x:auto;"><table><thead><tr>
            <th>ID</th><th>Student</th><th>Type</th><th>Status</th><th>Severity</th><th>Date</th>
          </tr></thead><tbody>${recentHtml || '<tr><td colspan="6" style="text-align:center;color:' + C.textMuted + ';padding:20px;">No cases yet</td></tr>'}</tbody></table></div>
        </div>
        <div>
          <h3 style="font-size:16px;margin-bottom:12px;">Recent Plagiarism Reports</h3>
          <div style="overflow-x:auto;"><table><thead><tr>
            <th>ID</th><th>Student</th><th>Score</th><th>Status</th><th>Date</th>
          </tr></thead><tbody>${plagHtml || '<tr><td colspan="5" style="text-align:center;color:' + C.textMuted + ';padding:20px;">No reports yet</td></tr>'}</tbody></table></div>
        </div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <a href="/school/academic-integrity/report-violation" style="padding:12px 24px;background:${C.red};color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">🚨 Report Violation</a>
        <a href="/school/academic-integrity/cases" style="padding:12px 24px;background:${C.primary};color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">📁 View All Cases</a>
        <a href="/school/academic-integrity/plagiarism-reports" style="padding:12px 24px;background:${C.purple};color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">🔍 Plagiarism Reports</a>
        <a href="/school/academic-integrity/analytics" style="padding:12px 24px;background:${C.green};color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">📉 Analytics</a>
      </div>`;
    res.send(renderPage('Academic Integrity Dashboard', pageShell('Academic Integrity Dashboard', html, 'dash'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 2: GET /school/academic-integrity/cases — Case List
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/school/academic-integrity/cases', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req);
    const { status: qStatus, severity: qSev, type: qType, page, limit } = req.query;
    const pn = Math.max(1, parseInt(page) || 1), ln = Math.min(100, Math.max(1, parseInt(limit) || 25));
    const offset = (pn - 1) * ln;

    let sql = `SELECT ic.*, u.name AS student_name, ur.name AS reporter_name, ui.name AS investigator_name
               FROM integrity_cases ic
               LEFT JOIN users u ON u.id=ic.student_id
               LEFT JOIN users ur ON ur.id=ic.reported_by
               LEFT JOIN users ui ON ui.id=ic.investigated_by
               WHERE ic.tenant_id=$1`;
    const params = [t];
    let pi = 2;
    if (qStatus && STATUSES.includes(qStatus)) { sql += ` AND ic.status=$${pi}`; params.push(qStatus); pi++; }
    if (qSev && SEVERITIES.includes(qSev)) { sql += ` AND ic.severity=$${pi}`; params.push(qSev); pi++; }
    if (qType && CASE_TYPES.includes(qType)) { sql += ` AND ic.case_type=$${pi}`; params.push(qType); pi++; }

    sql += ` ORDER BY ic.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`;
    params.push(ln, offset);

    const [rows, cnt] = await Promise.all([
      pool.query(sql, params),
      pool.query(`SELECT COUNT(*)::int AS total FROM integrity_cases WHERE tenant_id=$1`, [t])
    ]);
    const total = cnt.rows[0].total;
    const pages = Math.ceil(total / ln);

    const statusFilter = STATUSES.map(s =>
      `<option value="${s}" ${qStatus === s ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`
    ).join('');
    const sevFilter = SEVERITIES.map(s =>
      `<option value="${s}" ${qSev === s ? 'selected' : ''}>${s}</option>`
    ).join('');
    const typeFilter = CASE_TYPES.map(c =>
      `<option value="${c}" ${qType === c ? 'selected' : ''}>${c.replace(/_/g, ' ')}</option>`
    ).join('');

    const rowsHtml = rows.rows.map(r => `<tr>
      <td><a href="/school/academic-integrity/investigate/${r.id}" style="color:${C.primary};font-weight:600;">#${r.id}</a></td>
      <td>${esc(r.student_name || 'Unknown')}</td>
      <td>${esc(r.case_type?.replace(/_/g, ' ') || 'N/A')}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${severityBadge(r.severity)}</td>
      <td>${esc(r.penalty || '—')}</td>
      <td>${esc(r.reporter_name || '—')}</td>
      <td style="font-size:12px;color:${C.textMuted};">${fmtDateTime(r.created_at)}</td>
    </tr>`).join('');

    let pagination = '';
    if (pages > 1) {
      pagination = `<div style="display:flex;gap:4px;justify-content:center;margin-top:16px;">`;
      for (let i = 1; i <= pages; i++) {
        pagination += `<a href="/school/academic-integrity/cases?page=${i}&status=${qStatus || ''}&severity=${qSev || ''}&type=${qType || ''}" style="padding:6px 12px;border-radius:6px;text-decoration:none;font-size:13px;${i === pn ? 'background:' + C.primary + ';color:#fff;' : 'background:#f1f5f9;color:' + C.text + ';'}">${i}</a>`;
      }
      pagination += '</div>';
    }

    let html = `
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;align-items:center;">
        <label style="font-size:13px;font-weight:600;">Filters:</label>
        <select onchange="location.href='/school/academic-integrity/cases?status='+this.value" style="width:auto;padding:6px 12px;border:1px solid ${C.border};border-radius:6px;">
          <option value="">All Statuses</option>${statusFilter}
        </select>
        <select onchange="location.href='/school/academic-integrity/cases?severity='+this.value" style="width:auto;padding:6px 12px;border:1px solid ${C.border};border-radius:6px;">
          <option value="">All Severities</option>${sevFilter}
        </select>
        <select onchange="location.href='/school/academic-integrity/cases?type='+this.value" style="width:auto;padding:6px 12px;border:1px solid ${C.border};border-radius:6px;">
          <option value="">All Types</option>${typeFilter}
        </select>
        <a href="/school/academic-integrity/report-violation" class="btn" style="margin-left:auto;">+ Report Violation</a>
      </div>
      <div style="overflow-x:auto;"><table>
        <thead><tr>
          <th>ID</th><th>Student</th><th>Type</th><th>Status</th><th>Severity</th><th>Penalty</th><th>Reported By</th><th>Date</th>
        </tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:' + C.textMuted + ';padding:30px;">No cases found</td></tr>'}</tbody>
      </table></div>
      <p style="font-size:13px;color:${C.textMuted};margin-top:8px;">Showing ${rows.rows.length} of ${total} cases</p>
      ${pagination}`;
    res.send(renderPage('Integrity Cases', pageShell('Integrity Cases', html, 'cases'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 3: GET /school/academic-integrity/report-violation — Report Form
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/school/academic-integrity/report-violation', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req);
    const typeOpts = CASE_TYPES.map(c => `<option value="${c}">${c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>`).join('');
    const sevOpts = SEVERITIES.map(s => `<option value="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('');

    let html = `
      <div style="max-width:700px;margin:0 auto;">
        <div style="text-align:center;padding:16px 0 20px;">
          <div style="font-size:48px;margin-bottom:8px;">🛡️</div>
          <h2 style="font-size:22px;color:${C.text};margin:0 0 6px;">Report Academic Integrity Violation</h2>
          <p style="color:${C.textMuted};font-size:14px;margin:0;">All reports are taken seriously and investigated thoroughly.</p>
        </div>
        <form method="POST" action="/school/academic-integrity/report-violation">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div>
              <label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Student ID <span style="color:${C.red};">*</span></label>
              <input type="number" name="student_id" required placeholder="Student user ID" />
            </div>
            <div>
              <label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Violation Type <span style="color:${C.red};">*</span></label>
              <select name="case_type" required><option value="">Select type...</option>${typeOpts}</select>
            </div>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Severity <span style="color:${C.red};">*</span></label>
            <select name="severity" required>${sevOpts}</select>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Description <span style="color:${C.red};">*</span></label>
            <textarea name="description" required rows="5" maxlength="5000" placeholder="Provide a detailed description of the violation, including the assignment/exam, what was observed, and any relevant context..."></textarea>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Evidence (JSON array of URLs or descriptions)</label>
            <textarea name="evidence" rows="3" placeholder='["https://example.com/evidence1.jpg","Screenshot of chat logs"]'></textarea>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Similarity Score (if applicable, 0-100)</label>
            <input type="number" name="similarity_score" min="0" max="100" step="0.1" placeholder="e.g. 45.5" />
          </div>
          <div style="margin-bottom:20px;">
            <label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Source Details (JSON array of matched sources)</label>
            <textarea name="source_details" rows="3" placeholder='[{"url":"https://source.com","title":"Source Title","match_pct":32}]'></textarea>
          </div>
          <div style="text-align:center;">
            <button type="submit" class="btn" style="padding:12px 40px;font-size:16px;">🚨 Submit Report</button>
            <p style="margin-top:12px;font-size:12px;color:${C.textMuted};">This report will create a formal integrity case that will be reviewed by authorized staff.</p>
          </div>
        </form>
      </div>`;
    res.send(renderPage('Report Violation', pageShell('Report Academic Integrity Violation', html, 'report'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 4: POST /school/academic-integrity/report-violation — Submit Report
  // ══════════════════════════════════════════════════════════════════════════
  app.post('/school/academic-integrity/report-violation', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req), uid = getUserId(req);
    const { student_id, case_type, severity, description, evidence, similarity_score, source_details } = req.body;
    if (!student_id) return res.status(400).send('Student ID is required.');
    if (!case_type || !CASE_TYPES.includes(case_type)) return res.status(400).send('Invalid violation type.');
    if (!severity || !SEVERITIES.includes(severity)) return res.status(400).send('Invalid severity.');
    if (!description || !description.trim()) return res.status(400).send('Description is required.');

    let parsedEvidence = [];
    try { if (evidence) parsedEvidence = Array.isArray(evidence) ? evidence : JSON.parse(evidence); } catch { parsedEvidence = []; }
    let parsedSources = [];
    try { if (source_details) parsedSources = Array.isArray(source_details) ? source_details : JSON.parse(source_details); } catch { parsedSources = []; }

    const result = await pool.query(
      `INSERT INTO integrity_cases (tenant_id, student_id, case_type, description, evidence, severity, reported_by, similarity_score, source_details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [t, student_id, case_type, description.trim(), JSON.stringify(parsedEvidence), severity, uid,
       similarity_score ? parseFloat(similarity_score) : null, JSON.stringify(parsedSources)]
    );

    audit({ action: 'integrity_violation_reported', tenantId: t, userId: uid, detail: `Case #${result.rows[0].id} for student ${student_id}: ${case_type}` });

    const { rows: settings } = await pool.query(`SELECT notification_emails FROM integrity_settings WHERE tenant_id=$1 LIMIT 1`, [t]);
    if (settings.rows[0]?.notification_emails) {
      let emails = settings.rows[0].notification_emails;
      if (typeof emails === 'string') { try { emails = JSON.parse(emails); } catch { emails = []; } }
      emails.forEach(email => {
        queueEmail({
          to: email,
          subject: `New Academic Integrity Case #${result.rows[0].id} Reported`,
          body: `A new academic integrity violation has been reported.\n\nCase ID: #${result.rows[0].id}\nType: ${case_type}\nSeverity: ${severity}\nStudent ID: ${student_id}\nDescription: ${description.trim().substring(0, 300)}\n\nPlease review at /school/academic-integrity/investigate/${result.rows[0].id}`
        });
      });
    }

    res.redirect('/school/academic-integrity/cases');
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 5: GET /school/academic-integrity/investigate/:id — Investigate
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/school/academic-integrity/investigate/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req), uid = getUserId(req);
    const caseId = req.params.id;
    const { rows } = await pool.query(
      `SELECT ic.*, u.name AS student_name, ur.name AS reporter_name, ui.name AS investigator_name
       FROM integrity_cases ic
       LEFT JOIN users u ON u.id=ic.student_id
       LEFT JOIN users ur ON ur.id=ic.reported_by
       LEFT JOIN users ui ON ui.id=ic.investigated_by
       WHERE ic.id=$1 AND ic.tenant_id=$2`, [caseId, t]
    );
    if (!rows[0]) return res.status(404).send('Case not found.');
    const c = rows[0];

    let evidenceHtml = '<p style="color:' + C.textMuted + '">No evidence attached.</p>';
    let evidenceList = [];
    try { evidenceList = typeof c.evidence === 'string' ? JSON.parse(c.evidence) : (Array.isArray(c.evidence) ? c.evidence : []); } catch { evidenceList = []; }
    if (evidenceList.length > 0) {
      evidenceHtml = '<ul>' + evidenceList.map(e => `<li style="margin-bottom:4px;">${esc(typeof e === 'string' ? e : JSON.stringify(e))}</li>`).join('') + '</ul>';
    }

    let sourceHtml = '<p style="color:' + C.textMuted + '">No matched sources.</p>';
    let sourceList = [];
    try { sourceList = typeof c.source_details === 'string' ? JSON.parse(c.source_details) : (Array.isArray(c.source_details) ? c.source_details : []); } catch { sourceList = []; }
    if (sourceList.length > 0) {
      sourceHtml = '<table><thead><tr><th>Source</th><th>Match %</th></tr></thead><tbody>' +
        sourceList.map(s => `<tr><td>${esc(s.url || s.title || 'Unknown')}</td><td style="font-weight:700;">${s.match_pct || '—'}%</td></tr>`).join('') +
        '</tbody></table>';
    }

    const statusOpts = STATUSES.map(s => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>`).join('');
    const penaltyOpts = PENALTY_TYPES.map(p => `<option value="${p}" ${c.penalty === p ? 'selected' : ''}>${p.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>`).join('');

    let html = `
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:24px;">
        <div>
          <h3 style="font-size:18px;margin-bottom:16px;">Case #${c.id} — ${esc(c.case_type?.replace(/_/g, ' ') || 'N/A')}</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
            <div><strong>Student:</strong> ${esc(c.student_name || 'ID: ' + c.student_id)}</div>
            <div><strong>Severity:</strong> ${severityBadge(c.severity)}</div>
            <div><strong>Status:</strong> ${statusBadge(c.status)}</div>
            <div><strong>Reported By:</strong> ${esc(c.reporter_name || '—')}</div>
            <div><strong>Investigated By:</strong> ${esc(c.investigator_name || '—')}</div>
            <div><strong>Similarity Score:</strong> <span style="font-weight:700;color:${similarityColor(parseFloat(c.similarity_score || 0))};">${c.similarity_score || 'N/A'}%</span></div>
            <div><strong>Penalty:</strong> ${esc(c.penalty?.replace(/_/g, ' ') || 'Not assigned')}</div>
            <div><strong>Created:</strong> ${fmtDateTime(c.created_at)}</div>
            <div><strong>Resolved:</strong> ${fmtDateTime(c.resolved_at)}</div>
            <div><strong>Appeal:</strong> ${statusBadge(c.appeal_status || 'none')}</div>
          </div>
          <div style="margin-bottom:20px;">
            <h4 style="font-size:15px;margin-bottom:8px;">Description</h4>
            <div style="background:#f9fafb;padding:14px;border-radius:8px;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(c.description || '')}</div>
          </div>
          <div style="margin-bottom:20px;">
            <h4 style="font-size:15px;margin-bottom:8px;">Evidence</h4>
            ${evidenceHtml}
          </div>
          <div style="margin-bottom:20px;">
            <h4 style="font-size:15px;margin-bottom:8px;">Matched Sources</h4>
            ${sourceHtml}
          </div>
          ${c.notes ? `<div style="margin-bottom:20px;"><h4 style="font-size:15px;margin-bottom:8px;">Investigation Notes</h4><div style="background:#fffbeb;padding:14px;border-radius:8px;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(c.notes)}</div></div>` : ''}
        </div>
        <div>
          <div style="background:#f9fafb;padding:16px;border-radius:10px;margin-bottom:16px;">
            <h4 style="font-size:15px;margin-bottom:12px;">Update Case</h4>
            <form method="POST" action="/school/academic-integrity/investigate/${c.id}">
              <div style="margin-bottom:12px;">
                <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;">Status</label>
                <select name="status">${statusOpts}</select>
              </div>
              <div style="margin-bottom:12px;">
                <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;">Penalty</label>
                <select name="penalty"><option value="">Select penalty...</option>${penaltyOpts}</select>
              </div>
              <div style="margin-bottom:12px;">
                <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;">Notes</label>
                <textarea name="notes" rows="4" placeholder="Add investigation notes...">${esc(c.notes || '')}</textarea>
              </div>
              <button type="submit" class="btn" style="width:100%;">Save Changes</button>
            </form>
          </div>
          <div style="background:#f0f4ff;padding:16px;border-radius:10px;">
            <h4 style="font-size:15px;margin-bottom:12px;">Quick Actions</h4>
            <a href="/school/academic-integrity/penalize/${c.id}" class="btn" style="display:block;text-align:center;margin-bottom:8px;background:${C.red};">⚡ Assign Penalty</a>
            ${c.appeal_status === 'none' || c.appeal_status === 'denied' ? `<a href="/school/academic-integrity/appeals?case_id=${c.id}" class="btn" style="display:block;text-align:center;background:${C.orange};">⚖️ Process Appeal</a>` : ''}
          </div>
        </div>
      </div>`;
    res.send(renderPage('Investigate Case #' + c.id, pageShell('Case #' + c.id, html, 'cases'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 6: POST /school/academic-integrity/investigate/:id — Update Case
  // ══════════════════════════════════════════════════════════════════════════
  app.post('/school/academic-integrity/investigate/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req), uid = getUserId(req);
    const { status, penalty, notes } = req.body;
    const caseId = req.params.id;
    const exists = await pool.query(`SELECT id FROM integrity_cases WHERE id=$1 AND tenant_id=$2`, [caseId, t]);
    if (!exists.rows[0]) return res.status(404).send('Case not found.');

    const resolveAt = (status === 'resolved' || status === 'dismissed') ? 'NOW()' : null;
    await pool.query(
      `UPDATE integrity_cases SET status=COALESCE($1,status), penalty=COALESCE(NULLIF($2,''),penalty),
       notes=COALESCE($3,notes), investigated_by=$4, resolved_at=COALESCE(${resolveAt ? 'NOW()' : 'resolved_at'},resolved_at),
       updated_at=NOW() WHERE id=$5 AND tenant_id=$6`,
      [status || null, penalty || null, notes || null, uid, caseId, t]
    );
    audit({ action: 'integrity_case_updated', tenantId: t, userId: uid, detail: `Case #${caseId} updated to status=${status}` });
    res.redirect('/school/academic-integrity/investigate/' + caseId);
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 7: GET /school/academic-integrity/penalize/:id — Penalty Assignment
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/school/academic-integrity/penalize/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req);
    const { rows } = await pool.query(
      `SELECT ic.*, u.name AS student_name FROM integrity_cases ic
       LEFT JOIN users u ON u.id=ic.student_id
       WHERE ic.id=$1 AND ic.tenant_id=$2`, [req.params.id, t]
    );
    if (!rows[0]) return res.status(404).send('Case not found.');
    const c = rows[0];
    const penaltyOpts = PENALTY_TYPES.map(p =>
      `<option value="${p}" ${c.penalty === p ? 'selected' : ''}>${p.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>`
    ).join('');

    let html = `
      <div style="max-width:600px;margin:0 auto;">
        <h3 style="font-size:18px;margin-bottom:16px;">Assign Penalty — Case #${c.id}</h3>
        <div style="background:#fff7ed;border:1px solid #fed7aa;padding:14px;border-radius:10px;margin-bottom:20px;">
          <strong>Student:</strong> ${esc(c.student_name || 'ID: ' + c.student_id)}<br>
          <strong>Type:</strong> ${esc(c.case_type?.replace(/_/g, ' ') || 'N/A')}<br>
          <strong>Current Penalty:</strong> ${esc(c.penalty?.replace(/_/g, ' ') || 'None assigned')}<br>
          <strong>Current Status:</strong> ${statusBadge(c.status)}
        </div>
        <form method="POST" action="/school/academic-integrity/penalize/${c.id}">
          <div style="margin-bottom:16px;">
            <label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Penalty Type <span style="color:${C.red};">*</span></label>
            <select name="penalty" required>${penaltyOpts}</select>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Additional Notes</label>
            <textarea name="notes" rows="4" placeholder="Explain the penalty rationale..."></textarea>
          </div>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">
              <input type="checkbox" name="resolve_case" value="1" checked style="width:auto;"> Mark case as resolved
            </label>
          </div>
          <div style="display:flex;gap:12px;">
            <button type="submit" class="btn" style="background:${C.red};">⚡ Assign Penalty</button>
            <a href="/school/academic-integrity/investigate/${c.id}" style="padding:8px 16px;background:#f1f5f9;border-radius:8px;text-decoration:none;color:${C.text};">Cancel</a>
          </div>
        </form>
      </div>`;
    res.send(renderPage('Penalize Case', pageShell('Assign Penalty', html, 'cases'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 8: POST /school/academic-integrity/penalize/:id — Apply Penalty
  // ══════════════════════════════════════════════════════════════════════════
  app.post('/school/academic-integrity/penalize/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req), uid = getUserId(req);
    const { penalty, notes, resolve_case } = req.body;
    if (!penalty) return res.status(400).send('Penalty type is required.');
    const caseId = req.params.id;
    const exists = await pool.query(`SELECT id, student_id FROM integrity_cases WHERE id=$1 AND tenant_id=$2`, [caseId, t]);
    if (!exists.rows[0]) return res.status(404).send('Case not found.');

    const resolve = resolve_case === '1';
    await pool.query(
      `UPDATE integrity_cases SET penalty=$1, notes=COALESCE($2,notes), investigated_by=$3,
       status=$4, resolved_at=$5, updated_at=NOW() WHERE id=$6 AND tenant_id=$7`,
      [penalty, notes || null, uid, resolve ? 'resolved' : 'adjudicated',
       resolve ? 'NOW()' : null, caseId, t]
    );

    audit({ action: 'integrity_penalty_assigned', tenantId: t, userId: uid, detail: `Case #${caseId}: penalty=${penalty}` });

    const { rows: student } = await pool.query(`SELECT email, name FROM users WHERE id=$1`, [exists.rows[0].student_id]);
    if (student.rows[0]?.email) {
      queueEmail({
        to: student.rows[0].email,
        subject: `Academic Integrity Case #${caseId} — Penalty Assigned`,
        body: `Dear ${student.rows[0].name},\n\nA penalty has been assigned in relation to academic integrity case #${caseId}.\n\nPenalty: ${penalty.replace(/_/g, ' ')}\n${notes ? 'Notes: ' + notes + '\n' : ''}You have the right to appeal this decision. Please contact the academic integrity office for more information.\n\n— Academic Integrity Office`
      });
    }

    res.redirect('/school/academic-integrity/investigate/' + caseId);
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 9: GET /school/academic-integrity/appeals — Appeals Management
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/school/academic-integrity/appeals', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req);
    const caseId = req.query.case_id;

    let sql = `SELECT ic.*, u.name AS student_name, ui.name AS appeal_decider_name
               FROM integrity_cases ic
               LEFT JOIN users u ON u.id=ic.student_id
               LEFT JOIN users ui ON ui.id=ic.appeal_decided_by
               WHERE ic.tenant_id=$1 AND ic.appeal_status != 'none'`;
    const params = [t];
    if (caseId) { sql += ` AND ic.id=$2`; params.push(caseId); }
    sql += ` ORDER BY ic.created_at DESC`;

    const { rows } = await pool.query(sql, params);
    const rowsHtml = rows.map(r => `<tr>
      <td><a href="/school/academic-integrity/investigate/${r.id}" style="color:${C.primary};font-weight:600;">#${r.id}</a></td>
      <td>${esc(r.student_name || 'ID: ' + r.student_id)}</td>
      <td>${statusBadge(r.appeal_status)}</td>
      <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.appeal_reason || '—')}</td>
      <td>${esc(r.appeal_outcome || '—')}</td>
      <td>${esc(r.appeal_decider_name || '—')}</td>
      <td style="font-size:12px;color:${C.textMuted};">${fmtDateTime(r.appeal_decided_at)}</td>
    </tr>`).join('');

    let formHtml = '';
    if (caseId) {
      formHtml = `
        <div style="max-width:600px;margin:20px auto;background:#f9fafb;padding:20px;border-radius:10px;">
          <h3 style="margin-bottom:12px;">Process Appeal for Case #${esc(caseId)}</h3>
          <form method="POST" action="/school/academic-integrity/appeals">
            <input type="hidden" name="case_id" value="${esc(caseId)}" />
            <div style="margin-bottom:12px;">
              <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;">Decision</label>
              <select name="appeal_status">
                <option value="approved">Approve Appeal</option>
                <option value="denied">Deny Appeal</option>
                <option value="under_review">Request More Review</option>
              </select>
            </div>
            <div style="margin-bottom:12px;">
              <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;">Outcome Notes</label>
              <textarea name="appeal_outcome" rows="3" placeholder="Describe the appeal decision rationale..."></textarea>
            </div>
            <button type="submit" class="btn" style="background:${C.orange};">⚖️ Submit Appeal Decision</button>
          </form>
        </div>`;
    }

    let html = `
      <div style="margin-bottom:16px;display:flex;gap:12px;align-items:center;">
        <h3 style="font-size:18px;margin:0;">Appeals (${rows.length})</h3>
      </div>
      <div style="overflow-x:auto;"><table>
        <thead><tr>
          <th>Case</th><th>Student</th><th>Appeal Status</th><th>Reason</th><th>Outcome</th><th>Decided By</th><th>Date</th>
        </tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:' + C.textMuted + ';padding:30px;">No appeals filed</td></tr>'}</tbody>
      </table></div>
      ${formHtml}`;
    res.send(renderPage('Appeals', pageShell('Appeals Management', html, 'appeals'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 10: POST /school/academic-integrity/appeals — Submit Appeal Decision
  // ══════════════════════════════════════════════════════════════════════════
  app.post('/school/academic-integrity/appeals', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req), uid = getUserId(req);
    const { case_id, appeal_status, appeal_outcome } = req.body;
    if (!case_id) return res.status(400).send('Case ID is required.');
    if (!appeal_status || !APPEAL_STATUSES.includes(appeal_status)) return res.status(400).send('Invalid appeal status.');

    const exists = await pool.query(`SELECT id FROM integrity_cases WHERE id=$1 AND tenant_id=$2`, [case_id, t]);
    if (!exists.rows[0]) return res.status(404).send('Case not found.');

    const isFinal = appeal_status === 'approved' || appeal_status === 'denied';
    await pool.query(
      `UPDATE integrity_cases SET appeal_status=$1, appeal_outcome=$2, appeal_decided_by=$3,
       appeal_decided_at=$4, status=$5, updated_at=NOW() WHERE id=$6 AND tenant_id=$7`,
      [appeal_status, appeal_outcome || null, uid, isFinal ? 'NOW()' : null,
       appeal_status === 'approved' ? 'appealed' : null, case_id, t]
    );

    audit({ action: 'integrity_appeal_decided', tenantId: t, userId: uid, detail: `Case #${case_id}: appeal=${appeal_status}` });
    res.redirect('/school/academic-integrity/appeals');
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 11: GET /school/academic-integrity/pledges — Pledge Management
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/school/academic-integrity/pledges', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req);
    const { rows: settings } = await pool.query(`SELECT honor_code FROM integrity_settings WHERE tenant_id=$1 LIMIT 1`, [t]);
    const honorCode = settings.rows[0]?.honor_code || 'I pledge to uphold the highest standards of academic integrity.';

    const { rows: recentPledges } = await pool.query(
      `SELECT ip.*, u.name AS student_name FROM integrity_pledges ip
       LEFT JOIN users u ON u.id=ip.student_id
       WHERE ip.tenant_id=$1 ORDER BY ip.signed_at DESC LIMIT 25`, [t]
    );

    const { rows: contextStats } = await pool.query(
      `SELECT context, COUNT(*)::int AS cnt FROM integrity_pledges WHERE tenant_id=$1 GROUP BY context ORDER BY cnt DESC`, [t]
    );

    const contextData = contextStats.map(r => ({ l: r.context, v: r.cnt }));
    const pledgesHtml = recentPledges.map(p => `<tr>
      <td>#${p.id}</td>
      <td>${esc(p.student_name || 'ID: ' + p.student_id)}</td>
      <td>${statusBadge(p.context)}</td>
      <td style="font-size:12px;color:${C.textMuted};">${fmtDateTime(p.signed_at)}</td>
      <td style="font-size:12px;color:${C.textMuted};">${esc(p.ip_address || '—')}</td>
    </tr>`).join('');

    const contextOpts = PLEDGE_CONTEXTS.map(c => `<option value="${c}">${c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>`).join('');

    let html = `
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:24px;">
        <div>
          <h3 style="font-size:18px;margin-bottom:16px;">Recent Pledges</h3>
          <div style="overflow-x:auto;"><table>
            <thead><tr><th>ID</th><th>Student</th><th>Context</th><th>Signed At</th><th>IP</th></tr></thead>
            <tbody>${pledgesHtml || '<tr><td colspan="5" style="text-align:center;color:' + C.textMuted + ';padding:30px;">No pledges signed</td></tr>'}</tbody>
          </table></div>
        </div>
        <div>
          <h3 style="font-size:16px;margin-bottom:12px;">Pledges by Context</h3>
          ${contextData.length > 0 ? svgDonutChart(contextData, { title: 'Pledge Contexts' }) : '<p style="color:' + C.textMuted + '">No data.</p>'}
          <div style="margin-top:20px;background:#f0f4ff;padding:16px;border-radius:10px;">
            <h4 style="font-size:15px;margin-bottom:12px;">Current Honor Code</h4>
            <div style="font-size:13px;line-height:1.6;color:${C.textMuted};font-style:italic;">"${esc(honorCode)}"</div>
          </div>
        </div>
      </div>
      <div style="margin-top:24px;max-width:600px;margin-left:auto;margin-right:auto;">
        <h3 style="font-size:16px;margin-bottom:12px;">Sign Integrity Pledge</h3>
        <form method="POST" action="/school/academic-integrity/pledges">
          <div style="margin-bottom:12px;">
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;">Student ID</label>
            <input type="number" name="student_id" required placeholder="Student user ID" />
          </div>
          <div style="margin-bottom:12px;">
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;">Context</label>
            <select name="context">${contextOpts}</select>
          </div>
          <div style="margin-bottom:12px;">
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;">Custom Pledge Text (optional)</label>
            <textarea name="pledge_text" rows="3" placeholder="Leave blank to use default honor code...">${esc(honorCode)}</textarea>
          </div>
          <button type="submit" class="btn" style="background:${C.green};">✋ Sign Pledge</button>
        </form>
      </div>`;
    res.send(renderPage('Integrity Pledges', pageShell('Integrity Pledges', html, 'pledges'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 12: POST /school/academic-integrity/pledges — Sign Pledge
  // ══════════════════════════════════════════════════════════════════════════
  app.post('/school/academic-integrity/pledges', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req);
    const { student_id, context, pledge_text } = req.body;
    if (!student_id) return res.status(400).send('Student ID is required.');
    if (!context || !PLEDGE_CONTEXTS.includes(context)) return res.status(400).send('Invalid context.');

    const { rows: settings } = await pool.query(`SELECT honor_code FROM integrity_settings WHERE tenant_id=$1 LIMIT 1`, [t]);
    const text = pledge_text?.trim() || settings.rows[0]?.honor_code || 'I pledge to uphold academic integrity.';

    await pool.query(
      `INSERT INTO integrity_pledges (tenant_id, student_id, pledge_text, context, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [t, student_id, text, context, req.ip || null, req.headers?.['user-agent'] || null]
    );

    audit({ action: 'integrity_pledge_signed', tenantId: t, detail: `Student ${student_id} signed pledge for ${context}` });
    res.redirect('/school/academic-integrity/pledges');
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 13: GET /school/academic-integrity/plagiarism-reports — Plagiarism
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/school/academic-integrity/plagiarism-reports', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req);
    const { min_score, status: qStatus, page } = req.query;
    const pn = Math.max(1, parseInt(page) || 1), ln = 25;
    const offset = (pn - 1) * ln;

    let sql = `SELECT pr.*, u.name AS student_name, ur.name AS reviewer_name
               FROM plagiarism_reports pr
               LEFT JOIN users u ON u.id=pr.student_id
               LEFT JOIN users ur ON ur.id=pr.reviewed_by
               WHERE pr.tenant_id=$1`;
    const params = [t]; let pi = 2;
    if (min_score) { sql += ` AND pr.similarity_score >= $${pi}`; params.push(parseFloat(min_score)); pi++; }
    if (qStatus) { sql += ` AND pr.status = $${pi}`; params.push(qStatus); pi++; }
    sql += ` ORDER BY pr.similarity_score DESC, pr.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`;
    params.push(ln, offset);

    const [rows, cnt] = await Promise.all([
      pool.query(sql, params),
      pool.query(`SELECT COUNT(*)::int AS total FROM plagiarism_reports WHERE tenant_id=$1`, [t])
    ]);

    const rowsHtml = rows.rows.map(r => {
      const sc = parseFloat(r.similarity_score);
      let sourcesHtml = '';
      let srcList = [];
      try { srcList = typeof r.matched_sources === 'string' ? JSON.parse(r.matched_sources) : (Array.isArray(r.matched_sources) ? r.matched_sources : []); } catch { srcList = []; }
      if (srcList.length > 0) {
        sourcesHtml = '<div style="margin-top:6px;font-size:11px;color:' + C.textMuted + ';">Sources: ' +
          srcList.slice(0, 3).map(s => esc(s.title || s.url || 'Unknown')).join(', ') +
          (srcList.length > 3 ? ` +${srcList.length - 3} more` : '') + '</div>';
      }
      return `<tr>
        <td>#${r.id}</td>
        <td>${esc(r.student_name || 'ID: ' + r.student_id)}</td>
        <td style="font-weight:700;color:${similarityColor(sc)};font-size:16px;">${sc.toFixed(1)}%</td>
        <td>${r.word_count || '—'}</td>
        <td>${statusBadge(r.status)}</td>
        <td style="font-size:12px;color:${C.textMuted};">${fmtDateTime(r.created_at)}</td>
        <td>${sourcesHtml}</td>
      </tr>`;
    }).join('');

    const scoreRanges = [
      { label: 'Critical (75%+)', min: 75, color: C.red },
      { label: 'High (50-74%)', min: 50, color: C.orange },
      { label: 'Medium (25-49%)', min: 25, color: '#eab308' },
      { label: 'Low (0-24%)', min: 0, color: C.green }
    ];
    const scoreFilterHtml = scoreRanges.map(s =>
      `<a href="/school/academic-integrity/plagiarism-reports?min_score=${s.min}" style="display:inline-block;padding:4px 12px;margin:2px;border-radius:6px;font-size:12px;font-weight:600;background:${s.color};color:#fff;text-decoration:none;">${s.label}</a>`
    ).join('');

    let html = `
      <div style="margin-bottom:16px;">
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
          <strong style="font-size:13px;">Quick Filters:</strong>
          <a href="/school/academic-integrity/plagiarism-reports" style="padding:4px 12px;margin:2px;border-radius:6px;font-size:12px;background:#f1f5f9;color:${C.text};text-decoration:none;">All</a>
          ${scoreFilterHtml}
        </div>
      </div>
      <div style="overflow-x:auto;"><table>
        <thead><tr><th>ID</th><th>Student</th><th>Similarity</th><th>Words</th><th>Status</th><th>Date</th><th>Sources</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:' + C.textMuted + ';padding:30px;">No plagiarism reports</td></tr>'}</tbody>
      </table></div>
      <p style="font-size:13px;color:${C.textMuted};margin-top:8px;">Showing ${rows.rows.length} of ${cnt.rows[0].total} reports</p>`;
    res.send(renderPage('Plagiarism Reports', pageShell('Plagiarism Reports', html, 'plag'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 14: GET /school/academic-integrity/student-score/:id — Student Score
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/school/academic-integrity/student-score/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req);
    const studentId = req.params.id;

    const [cases, plagReports, pledges, studentInfo] = await Promise.all([
      pool.query(`SELECT * FROM integrity_cases WHERE tenant_id=$1 AND student_id=$2 ORDER BY created_at DESC`, [t, studentId]),
      pool.query(`SELECT * FROM plagiarism_reports WHERE tenant_id=$1 AND student_id=$2 ORDER BY created_at DESC`, [t, studentId]),
      pool.query(`SELECT * FROM integrity_pledges WHERE tenant_id=$1 AND student_id=$2 ORDER BY signed_at DESC`, [t, studentId]),
      pool.query(`SELECT name, email FROM users WHERE id=$1 LIMIT 1`, [studentId])
    ]);

    const student = studentInfo.rows[0];
    const totalCases = cases.rows.length;
    const resolvedCases = cases.rows.filter(c => c.status === 'resolved' || c.status === 'dismissed').length;
    const criticalCases = cases.rows.filter(c => c.severity === 'critical' || c.severity === 'major').length;
    const avgSimilarity = plagReports.rows.length > 0
      ? (plagReports.rows.reduce((s, r) => s + parseFloat(r.similarity_score), 0) / plagReports.rows.length).toFixed(1)
      : '0.0';
    const pledgeCount = pledges.rows.length;

    // Integrity score: start at 100, deduct points for violations
    let score = 100;
    cases.rows.forEach(c => {
      if (c.severity === 'critical') score -= 25;
      else if (c.severity === 'major') score -= 15;
      else if (c.severity === 'moderate') score -= 8;
      else score -= 3;
      if (c.status === 'dismissed') score += (c.severity === 'critical' ? 25 : c.severity === 'major' ? 15 : c.severity === 'moderate' ? 8 : 3);
      if (c.appeal_status === 'approved') score += 10;
    });
    score = Math.max(0, Math.min(100, score + (pledgeCount * 2)));

    const scoreColor = score >= 80 ? C.green : score >= 60 ? '#eab308' : score >= 40 ? C.orange : C.red;
    const scoreLabel = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Needs Improvement' : 'At Risk';

    const casesHtml = cases.rows.map(c => `<tr>
      <td><a href="/school/academic-integrity/investigate/${c.id}" style="color:${C.primary};font-weight:600;">#${c.id}</a></td>
      <td>${esc(c.case_type?.replace(/_/g, ' ') || 'N/A')}</td>
      <td>${statusBadge(c.status)}</td>
      <td>${severityBadge(c.severity)}</td>
      <td>${esc(c.penalty?.replace(/_/g, ' ') || '—')}</td>
      <td style="font-size:12px;color:${C.textMuted};">${fmtDateTime(c.created_at)}</td>
    </tr>`).join('');

    const plagHtml = plagReports.rows.map(r => {
      const sc = parseFloat(r.similarity_score);
      return `<tr>
        <td>#${r.id}</td>
        <td style="font-weight:700;color:${similarityColor(sc)};">${sc.toFixed(1)}%</td>
        <td>${r.word_count || '—'}</td>
        <td>${statusBadge(r.status)}</td>
        <td style="font-size:12px;color:${C.textMuted};">${fmtDateTime(r.created_at)}</td>
      </tr>`;
    }).join('');

    let html = `
      <div style="display:flex;gap:24px;align-items:flex-start;margin-bottom:24px;">
        <div style="text-align:center;background:linear-gradient(135deg,${scoreColor},${scoreColor}dd);padding:24px 32px;border-radius:16px;color:#fff;min-width:180px;">
          <div style="font-size:13px;opacity:0.9;">Integrity Score</div>
          <div style="font-size:48px;font-weight:800;margin:4px 0;">${score}</div>
          <div style="font-size:14px;font-weight:600;">${scoreLabel}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;flex:1;">
          <div style="background:#f9fafb;padding:14px;border-radius:10px;text-align:center;">
            <div style="font-size:12px;color:${C.textMuted};">Total Cases</div>
            <div style="font-size:24px;font-weight:700;color:${C.text};">${totalCases}</div>
          </div>
          <div style="background:#f9fafb;padding:14px;border-radius:10px;text-align:center;">
            <div style="font-size:12px;color:${C.textMuted};">Resolved</div>
            <div style="font-size:24px;font-weight:700;color:${C.green};">${resolvedCases}</div>
          </div>
          <div style="background:#f9fafb;padding:14px;border-radius:10px;text-align:center;">
            <div style="font-size:12px;color:${C.textMuted};">Critical/Major</div>
            <div style="font-size:24px;font-weight:700;color:${C.red};">${criticalCases}</div>
          </div>
          <div style="background:#f9fafb;padding:14px;border-radius:10px;text-align:center;">
            <div style="font-size:12px;color:${C.textMuted};">Avg Similarity</div>
            <div style="font-size:24px;font-weight:700;color:${similarityColor(parseFloat(avgSimilarity))};">${avgSimilarity}%</div>
          </div>
          <div style="background:#f9fafb;padding:14px;border-radius:10px;text-align:center;">
            <div style="font-size:12px;color:${C.textMuted};">Pledges Signed</div>
            <div style="font-size:24px;font-weight:700;color:${C.primary};">${pledgeCount}</div>
          </div>
          <div style="background:#f9fafb;padding:14px;border-radius:10px;text-align:center;">
            <div style="font-size:12px;color:${C.textMuted};">Penalties</div>
            <div style="font-size:24px;font-weight:700;color:${C.orange};">${cases.rows.filter(c => c.penalty).length}</div>
          </div>
        </div>
      </div>
      <h3 style="font-size:16px;margin-bottom:12px;">Violation History</h3>
      <div style="overflow-x:auto;margin-bottom:24px;"><table>
        <thead><tr><th>Case</th><th>Type</th><th>Status</th><th>Severity</th><th>Penalty</th><th>Date</th></tr></thead>
        <tbody>${casesHtml || '<tr><td colspan="6" style="text-align:center;color:' + C.textMuted + ';padding:20px;">No violations — excellent record!</td></tr>'}</tbody>
      </table></div>
      <h3 style="font-size:16px;margin-bottom:12px;">Plagiarism Reports</h3>
      <div style="overflow-x:auto;"><table>
        <thead><tr><th>Report</th><th>Similarity</th><th>Words</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>${plagHtml || '<tr><td colspan="5" style="text-align:center;color:' + C.textMuted + ';padding:20px;">No plagiarism reports</td></tr>'}</tbody>
      </table></div>`;
    res.send(renderPage('Student Integrity Score', pageShell(`Integrity Score — ${esc(student?.name || 'Student #' + studentId)}`, html, 'scores'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 15: GET /school/academic-integrity/scores — All Student Scores
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/school/academic-integrity/scores', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req);
    const { rows } = await pool.query(
      `SELECT ic.student_id, u.name AS student_name,
              COUNT(*)::int AS total_cases,
              COUNT(*) FILTER (WHERE ic.severity IN ('major','critical'))::int AS serious_cases,
              COUNT(*) FILTER (WHERE ic.status = 'dismissed')::int AS dismissed_cases,
              COALESCE(AVG(pr.similarity_score), 0)::decimal(5,2) AS avg_similarity
       FROM integrity_cases ic
       LEFT JOIN users u ON u.id=ic.student_id
       LEFT JOIN plagiarism_reports pr ON pr.student_id=ic.student_id AND pr.tenant_id=ic.tenant_id
       WHERE ic.tenant_id=$1
       GROUP BY ic.student_id, u.name
       ORDER BY serious_cases DESC, total_cases DESC
       LIMIT 100`, [t]
    );

    const rowsHtml = rows.map(r => {
      let score = 100;
      score -= (parseInt(r.total_cases) - parseInt(r.dismissed_cases)) * 8;
      score -= parseInt(r.serious_cases) * 12;
      score = Math.max(0, Math.min(100, score));
      const sc = parseFloat(r.avg_similarity);
      return `<tr>
        <td>${esc(r.student_name || 'ID: ' + r.student_id)}</td>
        <td><a href="/school/academic-integrity/student-score/${r.student_id}" style="font-weight:700;color:${score >= 80 ? C.green : score >= 60 ? '#eab308' : score >= 40 ? C.orange : C.red};">${score}</a></td>
        <td>${r.total_cases}</td>
        <td style="color:${parseInt(r.serious_cases) > 0 ? C.red : C.textMuted};">${r.serious_cases}</td>
        <td style="color:${similarityColor(sc)};">${sc.toFixed(1)}%</td>
        <td><a href="/school/academic-integrity/student-score/${r.student_id}" style="color:${C.primary};font-size:12px;">View Profile →</a></td>
      </tr>`;
    }).join('');

    let html = `
      <h3 style="font-size:18px;margin-bottom:16px;">Student Integrity Scores</h3>
      <p style="font-size:13px;color:${C.textMuted};margin-bottom:16px;">Composite scores based on violation history, severity, dismissals, and plagiarism similarity averages. Click a student to view their full profile.</p>
      <div style="overflow-x:auto;"><table>
        <thead><tr><th>Student</th><th>Score</th><th>Total Cases</th><th>Serious</th><th>Avg Similarity</th><th>Actions</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:' + C.textMuted + ';padding:30px;">No student data yet</td></tr>'}</tbody>
      </table></div>`;
    res.send(renderPage('Student Scores', pageShell('Student Integrity Scores', html, 'scores'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 16: GET /school/academic-integrity/settings — Settings
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/school/academic-integrity/settings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req);
    const { rows: existing } = await pool.query(`SELECT * FROM integrity_settings WHERE tenant_id=$1 LIMIT 1`, [t]);
    const s = existing.rows[0] || {};
    const { rows: training } = await pool.query(
      `SELECT ft.*, u.name AS faculty_name FROM faculty_training ft
       LEFT JOIN users u ON u.id=ft.faculty_id
       WHERE ft.tenant_id=$1 ORDER BY ft.created_at DESC LIMIT 20`, [t]
    );

    let notificationEmails = [];
    try { notificationEmails = typeof s.notification_emails === 'string' ? JSON.parse(s.notification_emails) : (Array.isArray(s.notification_emails) ? s.notification_emails : []); } catch { notificationEmails = []; }

    const trainingHtml = training.map(tr => `<tr>
      <td>${esc(tr.faculty_name || 'ID: ' + tr.faculty_id)}</td>
      <td>${esc(tr.training_type)}</td>
      <td>${esc(tr.training_title)}</td>
      <td>${tr.completed ? '<span style="color:' + C.green + ';font-weight:600;">✓ Complete</span>' : '<span style="color:' + C.orange + ';font-weight:600;">⏳ Pending</span>'}</td>
      <td>${tr.due_date ? fmtDate(tr.due_date) : '—'}</td>
      <td>${fmtDateTime(tr.completed_at)}</td>
    </tr>`).join('');

    let html = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        <div>
          <h3 style="font-size:18px;margin-bottom:16px;">Honor Code &amp; Configuration</h3>
          <form method="POST" action="/school/academic-integrity/settings">
            <div style="margin-bottom:16px;">
              <label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Honor Code</label>
              <textarea name="honor_code" rows="5">${esc(s.honor_code || '')}</textarea>
            </div>
            <div style="margin-bottom:16px;">
              <label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Auto-Flag Similarity Threshold (%)</label>
              <input type="number" name="auto_flag_threshold" min="0" max="100" step="0.1" value="${s.auto_flag_threshold || 25}" />
            </div>
            <div style="margin-bottom:12px;">
              <label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">Notification Emails (one per line)</label>
              <textarea name="notification_emails" rows="3" placeholder="admin@school.com\ndean@school.com">${notificationEmails.join('\n')}</textarea>
            </div>
            <div style="margin-bottom:12px;">
              <label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">
                <input type="checkbox" name="require_pledge_for_submissions" value="1" ${s.require_pledge_for_submissions ? 'checked' : ''} style="width:auto;">
                Require pledge for submissions
              </label>
            </div>
            <div style="margin-bottom:12px;">
              <label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">
                <input type="checkbox" name="require_pledge_for_exams" value="1" ${s.require_pledge_for_exams ? 'checked' : ''} style="width:auto;">
                Require pledge for exams
              </label>
            </div>
            <div style="margin-bottom:12px;">
              <label style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;">
                <input type="checkbox" name="anonymous_reporting" value="1" ${s.anonymous_reporting !== false ? 'checked' : ''} style="width:auto;">
                Allow anonymous reporting
              </label>
            </div>
            <button type="submit" class="btn">💾 Save Settings</button>
          </form>
        </div>
        <div>
          <h3 style="font-size:18px;margin-bottom:16px;">Faculty Training Records</h3>
          <div style="overflow-x:auto;"><table>
            <thead><tr><th>Faculty</th><th>Type</th><th>Title</th><th>Status</th><th>Due</th><th>Completed</th></tr></thead>
            <tbody>${trainingHtml || '<tr><td colspan="6" style="text-align:center;color:' + C.textMuted + ';padding:20px;">No training records</td></tr>'}</tbody>
          </table></div>
          <div style="margin-top:16px;background:#f0f4ff;padding:16px;border-radius:10px;">
            <h4 style="font-size:15px;margin-bottom:12px;">Add Faculty Training</h4>
            <form method="POST" action="/school/academic-integrity/settings/training">
              <div style="margin-bottom:8px;">
                <input type="number" name="faculty_id" placeholder="Faculty user ID" required style="width:100%;padding:8px;border:1px solid ${C.border};border-radius:8px;box-sizing:border-box;" />
              </div>
              <div style="margin-bottom:8px;">
                <input type="text" name="training_type" placeholder="Training Type (e.g., Plagiarism Detection)" required style="width:100%;padding:8px;border:1px solid ${C.border};border-radius:8px;box-sizing:border-box;" />
              </div>
              <div style="margin-bottom:8px;">
                <input type="text" name="training_title" placeholder="Training Title" required style="width:100%;padding:8px;border:1px solid ${C.border};border-radius:8px;box-sizing:border-box;" />
              </div>
              <div style="margin-bottom:8px;">
                <label style="font-size:12px;">Due Date</label>
                <input type="date" name="due_date" style="width:100%;padding:8px;border:1px solid ${C.border};border-radius:8px;box-sizing:border-box;" />
              </div>
              <button type="submit" class="btn" style="background:${C.purple};font-size:13px;">+ Add Training</button>
            </form>
          </div>
        </div>
      </div>`;
    res.send(renderPage('Integrity Settings', pageShell('Academic Integrity Settings', html, 'settings'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 17: POST /school/academic-integrity/settings — Save Settings
  // ══════════════════════════════════════════════════════════════════════════
  app.post('/school/academic-integrity/settings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req), uid = getUserId(req);
    const { honor_code, auto_flag_threshold, notification_emails, require_pledge_for_submissions, require_pledge_for_exams, anonymous_reporting } = req.body;
    const emails = (notification_emails || '').split('\n').map(e => e.trim()).filter(e => e.length > 0);

    const existing = await pool.query(`SELECT id FROM integrity_settings WHERE tenant_id=$1 LIMIT 1`, [t]);
    if (existing.rows[0]) {
      await pool.query(
        `UPDATE integrity_settings SET honor_code=$1, auto_flag_threshold=$2, notification_emails=$3,
         require_pledge_for_submissions=$4, require_pledge_for_exams=$5, anonymous_reporting=$6, updated_at=NOW()
         WHERE tenant_id=$7`,
        [honor_code || '', auto_flag_threshold ? parseFloat(auto_flag_threshold) : 25,
         JSON.stringify(emails), require_pledge_for_submissions === '1',
         require_pledge_for_exams === '1', anonymous_reporting !== '0', t]
      );
    } else {
      await pool.query(
        `INSERT INTO integrity_settings (tenant_id, honor_code, auto_flag_threshold, notification_emails, require_pledge_for_submissions, require_pledge_for_exams, anonymous_reporting)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [t, honor_code || '', auto_flag_threshold ? parseFloat(auto_flag_threshold) : 25,
         JSON.stringify(emails), require_pledge_for_submissions === '1',
         require_pledge_for_exams === '1', anonymous_reporting !== '0']
      );
    }
    audit({ action: 'integrity_settings_updated', tenantId: t, userId: uid });
    res.redirect('/school/academic-integrity/settings');
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 18: POST /school/academic-integrity/settings/training — Add Training
  // ══════════════════════════════════════════════════════════════════════════
  app.post('/school/academic-integrity/settings/training', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req);
    const { faculty_id, training_type, training_title, due_date } = req.body;
    if (!faculty_id || !training_type || !training_title) return res.status(400).send('Faculty ID, training type, and title are required.');

    await pool.query(
      `INSERT INTO faculty_training (tenant_id, faculty_id, training_type, training_title, due_date)
       VALUES ($1,$2,$3,$4,$5)`,
      [t, faculty_id, training_type.trim(), training_title.trim(), due_date || null]
    );
    audit({ action: 'integrity_training_added', tenantId: t, detail: `Training "${training_title}" for faculty ${faculty_id}` });
    res.redirect('/school/academic-integrity/settings');
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 19: GET /school/academic-integrity/analytics — Analytics & Trends
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/school/academic-integrity/analytics', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req);
    const months = parseInt(req.query.months) || 6;
    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - months);

    const [monthlyCases, monthlyPlag, typeBreakdown, penaltyBreakdown, topStudents] = await Promise.all([
      pool.query(
        `SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, COUNT(*)::int AS cnt
         FROM integrity_cases WHERE tenant_id=$1 AND created_at >= $2
         GROUP BY TO_CHAR(created_at, 'YYYY-MM') ORDER BY month`, [t, fromDate.toISOString()]
      ),
      pool.query(
        `SELECT TO_CHAR(created_at, 'YYYY-MM') AS month,
                COUNT(*)::int AS report_cnt,
                COALESCE(AVG(similarity_score), 0)::decimal(5,2) AS avg_score
         FROM plagiarism_reports WHERE tenant_id=$1 AND created_at >= $2
         GROUP BY TO_CHAR(created_at, 'YYYY-MM') ORDER BY month`, [t, fromDate.toISOString()]
      ),
      pool.query(
        `SELECT case_type, COUNT(*)::int AS cnt FROM integrity_cases
         WHERE tenant_id=$1 GROUP BY case_type ORDER BY cnt DESC`, [t]
      ),
      pool.query(
        `SELECT penalty, COUNT(*)::int AS cnt FROM integrity_cases
         WHERE tenant_id=$1 AND penalty IS NOT NULL GROUP BY penalty ORDER BY cnt DESC`, [t]
      ),
      pool.query(
        `SELECT ic.student_id, u.name AS student_name, COUNT(*)::int AS case_count
         FROM integrity_cases ic LEFT JOIN users u ON u.id=ic.student_id
         WHERE ic.tenant_id=$1 GROUP BY ic.student_id, u.name
         ORDER BY case_count DESC LIMIT 10`, [t]
      )
    ]);

    const caseLineData = monthlyCases.rows.map(r => ({ l: r.month, v: r.cnt }));
    const plagLineData = monthlyPlag.rows.map(r => ({ l: r.month, v: parseFloat(r.avg_score) }));
    const typeData = typeBreakdown.rows.map(r => ({ l: r.case_type.replace(/_/g, ' '), v: r.cnt }));
    const penaltyData = penaltyBreakdown.rows.map(r => ({ l: (r.penalty || 'Unknown').replace(/_/g, ' '), v: r.cnt }));

    const topStudentsHtml = topStudents.rows.map((r, i) =>
      `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:${i % 2 === 0 ? '#f9fafb' : '#fff'};border-radius:6px;margin-bottom:4px;">
        <span style="font-size:13px;"><strong>${i + 1}.</strong> ${esc(r.student_name || 'ID: ' + r.student_id)}</span>
        <span style="font-size:13px;font-weight:700;color:${r.case_count > 3 ? C.red : r.case_count > 1 ? C.orange : C.text};">${r.case_count} case${r.case_count !== 1 ? 's' : ''}</span>
      </div>`
    ).join('');

    const totalCasesAll = monthlyCases.rows.reduce((s, r) => s + r.cnt, 0);
    const avgMonthly = monthlyCases.rows.length > 0 ? Math.round(totalCasesAll / monthlyCases.rows.length) : 0;
    const avgPlagScore = monthlyPlag.rows.length > 0
      ? (monthlyPlag.rows.reduce((s, r) => s + parseFloat(r.avg_score), 0) / monthlyPlag.rows.length).toFixed(1)
      : '0.0';

    let html = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px;">
        <div style="background:#f0f4ff;padding:16px;border-radius:10px;text-align:center;">
          <div style="font-size:12px;color:${C.textMuted};">Cases (${months}mo)</div>
          <div style="font-size:28px;font-weight:800;color:${C.primary};">${totalCasesAll}</div>
        </div>
        <div style="background:#f0f4ff;padding:16px;border-radius:10px;text-align:center;">
          <div style="font-size:12px;color:${C.textMuted};">Avg/Month</div>
          <div style="font-size:28px;font-weight:800;color:${C.blue};">${avgMonthly}</div>
        </div>
        <div style="background:#f0f4ff;padding:16px;border-radius:10px;text-align:center;">
          <div style="font-size:12px;color:${C.textMuted};">Avg Plag Score</div>
          <div style="font-size:28px;font-weight:800;color:${similarityColor(parseFloat(avgPlagScore))};">${avgPlagScore}%</div>
        </div>
        <div style="background:#f0f4ff;padding:16px;border-radius:10px;text-align:center;">
          <div style="font-size:12px;color:${C.textMuted};">Unique Students</div>
          <div style="font-size:28px;font-weight:800;color:${C.purple};">${topStudents.rows.length}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
        <div>
          <h3 style="font-size:16px;margin-bottom:12px;">Cases Over Time</h3>
          ${caseLineData.length > 0 ? svgLineChart(caseLineData, { title: 'Monthly Cases', color: C.primary }) : '<p style="color:' + C.textMuted + '">No data in selected period.</p>'}
        </div>
        <div>
          <h3 style="font-size:16px;margin-bottom:12px;">Avg Similarity Score Trend</h3>
          ${plagLineData.length > 0 ? svgLineChart(plagLineData, { title: 'Avg Similarity %', color: C.red, maxV: 100 }) : '<p style="color:' + C.textMuted + '">No data in selected period.</p>'}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
        <div>
          <h3 style="font-size:16px;margin-bottom:12px;">Violation Types</h3>
          ${typeData.length > 0 ? svgDonutChart(typeData, { title: 'Types' }) : '<p style="color:' + C.textMuted + '">No data.</p>'}
        </div>
        <div>
          <h3 style="font-size:16px;margin-bottom:12px;">Penalty Distribution</h3>
          ${penaltyData.length > 0 ? svgBarChart(penaltyData, { title: 'Penalties', color: C.orange }) : '<p style="color:' + C.textMuted + '">No penalties assigned yet.</p>'}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div>
          <h3 style="font-size:16px;margin-bottom:12px;">Top Students by Case Count</h3>
          ${topStudentsHtml || '<p style="color:' + C.textMuted + '">No data.</p>'}
        </div>
        <div>
          <h3 style="font-size:16px;margin-bottom:12px;">Period</h3>
          <div style="background:#f9fafb;padding:16px;border-radius:10px;">
            <form method="GET" action="/school/academic-integrity/analytics">
              <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Show last N months</label>
              <select name="months" style="width:auto;padding:8px 12px;border:1px solid ${C.border};border-radius:8px;margin-bottom:8px;">
                <option value="3" ${months === 3 ? 'selected' : ''}>3 months</option>
                <option value="6" ${months === 6 ? 'selected' : ''}>6 months</option>
                <option value="12" ${months === 12 ? 'selected' : ''}>12 months</option>
                <option value="24" ${months === 24 ? 'selected' : ''}>24 months</option>
              </select>
              <button type="submit" class="btn" style="font-size:13px;">Refresh</button>
            </form>
          </div>
          <div style="margin-top:16px;background:#f0fdf4;border:1px solid #bbf7d0;padding:16px;border-radius:10px;">
            <h4 style="font-size:14px;color:${C.green};margin-bottom:8px;">💡 Recommendations</h4>
            <ul style="font-size:13px;color:${C.text};line-height:1.8;padding-left:20px;">
              <li>Review the honor code annually with all students and faculty.</li>
              <li>Conduct plagiarism detection workshops before major submission deadlines.</li>
              <li>Monitor similarity score trends — sudden increases may indicate new sources.</li>
              <li>Use the pledge system for all high-stakes assessments.</li>
              <li>Ensure all faculty complete integrity training within the first semester.</li>
            </ul>
          </div>
        </div>
      </div>`;
    res.send(renderPage('Integrity Analytics', pageShell('Analytics & Trends', html, 'analytics'), req));
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 20: POST /school/academic-integrity/source-verify — Source Verification
  // ══════════════════════════════════════════════════════════════════════════
  app.post('/school/academic-integrity/source-verify', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = getTid(req), uid = getUserId(req);
    const { report_id, sources, notes } = req.body;
    if (!report_id) return res.status(400).send('Report ID is required.');

    const exists = await pool.query(`SELECT id FROM plagiarism_reports WHERE id=$1 AND tenant_id=$2`, [report_id, t]);
    if (!exists.rows[0]) return res.status(404).send('Report not found.');

    let parsedSources = [];
    try { if (sources) parsedSources = Array.isArray(sources) ? sources : JSON.parse(sources); } catch { parsedSources = []; }

    await pool.query(
      `UPDATE plagiarism_reports SET matched_sources=$1, status='reviewed', reviewed_by=$2, reviewed_at=NOW(), notes=COALESCE($3,notes)
       WHERE id=$4 AND tenant_id=$5`,
      [JSON.stringify(parsedSources), uid, notes || null, report_id, t]
    );
    audit({ action: 'plagiarism_sources_verified', tenantId: t, userId: uid, detail: `Report #${report_id} sources verified` });
    res.json({ success: true, message: 'Sources verified and report updated.' });
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 21: POST /school/academic-integrity/api/plagiarism-check — API Endpoint
  // ══════════════════════════════════════════════════════════════════════════
  app.post('/school/academic-integrity/api/plagiarism-check', requireAuth, ah(async (req, res) => {
    const t = getTid(req), uid = getUserId(req);
    const { submission_id, student_id, assignment_id, course_id, similarity_score, word_count, matched_sources, report_data } = req.body;
    if (!submission_id || !student_id) return res.status(400).json({ success: false, error: 'submission_id and student_id are required.' });
    if (similarity_score === undefined) return res.status(400).json({ success: false, error: 'similarity_score is required.' });

    let parsedSources = [];
    try { if (matched_sources) parsedSources = Array.isArray(matched_sources) ? matched_sources : JSON.parse(matched_sources); } catch { parsedSources = []; }
    let parsedData = {};
    try { if (report_data) parsedData = typeof report_data === 'string' ? JSON.parse(report_data) : report_data; } catch { parsedData = {}; }

    const result = await pool.query(
      `INSERT INTO plagiarism_reports (tenant_id, submission_id, student_id, assignment_id, course_id, similarity_score, word_count, matched_sources, report_data, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [t, submission_id, student_id, assignment_id || null, course_id || null,
       parseFloat(similarity_score), word_count ? parseInt(word_count) : null,
       JSON.stringify(parsedSources), JSON.stringify(parsedData), 'pending']
    );

    const { rows: settings } = await pool.query(`SELECT auto_flag_threshold FROM integrity_settings WHERE tenant_id=$1 LIMIT 1`, [t]);
    const threshold = settings.rows[0]?.auto_flag_threshold || 25;
    const score = parseFloat(similarity_score);

    let autoFlagged = false;
    if (score >= threshold) {
      await pool.query(
        `INSERT INTO integrity_cases (tenant_id, student_id, case_type, description, status, severity, reported_by, similarity_score, source_details)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [t, student_id, 'plagiarism',
         `Auto-flagged: Submission #${submission_id} has ${score.toFixed(1)}% similarity score, exceeding the ${threshold}% threshold.`,
         'reported', score >= 75 ? 'major' : score >= 50 ? 'moderate' : 'minor', uid, score, JSON.stringify(parsedSources)]
      );
      autoFlagged = true;
    }

    audit({ action: 'plagiarism_report_created', tenantId: t, userId: uid, detail: `Report #${result.rows[0].id}, score=${score}%, auto_flagged=${autoFlagged}` });
    res.json({ success: true, report: result.rows[0], auto_flagged, threshold });
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 22: GET /school/academic-integrity/api/case/:id — API Get Case
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/school/academic-integrity/api/case/:id', requireAuth, ah(async (req, res) => {
    const t = getTid(req);
    const { rows } = await pool.query(
      `SELECT * FROM integrity_cases WHERE id=$1 AND tenant_id=$2`, [req.params.id, t]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Case not found.' });
    res.json({ success: true, case: rows[0] });
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 23: POST /school/academic-integrity/api/pledge — API Sign Pledge
  // ══════════════════════════════════════════════════════════════════════════
  app.post('/school/academic-integrity/api/pledge', requireAuth, ah(async (req, res) => {
    const t = getTid(req);
    const { student_id, pledge_text, context, course_id, exam_id, assignment_id } = req.body;
    if (!student_id) return res.status(400).json({ success: false, error: 'student_id is required.' });
    if (!context || !PLEDGE_CONTEXTS.includes(context)) return res.status(400).json({ success: false, error: 'Invalid context.' });

    const { rows: settings } = await pool.query(`SELECT honor_code FROM integrity_settings WHERE tenant_id=$1 LIMIT 1`, [t]);
    const text = pledge_text?.trim() || settings.rows[0]?.honor_code || 'I pledge to uphold academic integrity.';

    const result = await pool.query(
      `INSERT INTO integrity_pledges (tenant_id, student_id, pledge_text, context, course_id, exam_id, assignment_id, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [t, student_id, text, context, course_id || null, exam_id || null, assignment_id || null, req.ip || null, req.headers?.['user-agent'] || null]
    );

    res.json({ success: true, pledge_id: result.rows[0].id, message: 'Pledge signed successfully.' });
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 24: POST /school/academic-integrity/api/appeal — File Appeal API
  // ══════════════════════════════════════════════════════════════════════════
  app.post('/school/academic-integrity/api/appeal', requireAuth, ah(async (req, res) => {
    const t = getTid(req), uid = getUserId(req);
    const { case_id, reason } = req.body;
    if (!case_id) return res.status(400).json({ success: false, error: 'case_id is required.' });
    if (!reason || !reason.trim()) return res.status(400).json({ success: false, error: 'Appeal reason is required.' });

    const exists = await pool.query(`SELECT id, status, appeal_status, student_id FROM integrity_cases WHERE id=$1 AND tenant_id=$2`, [case_id, t]);
    if (!exists.rows[0]) return res.status(404).json({ success: false, error: 'Case not found.' });
    if (exists.rows[0].appeal_status === 'pending' || exists.rows[0].appeal_status === 'approved')
      return res.status(400).json({ success: false, error: 'An appeal is already pending or was approved.' });

    await pool.query(
      `UPDATE integrity_cases SET appeal_status='pending', appeal_reason=$1, status='appealed', updated_at=NOW()
       WHERE id=$2 AND tenant_id=$3`,
      [reason.trim(), case_id, t]
    );

    audit({ action: 'integrity_appeal_filed', tenantId: t, userId: uid, detail: `Appeal filed for case #${case_id}` });

    const { rows: notifEmails } = await pool.query(`SELECT notification_emails FROM integrity_settings WHERE tenant_id=$1 LIMIT 1`, [t]);
    if (notifEmails.rows[0]?.notification_emails) {
      let emails = notifEmails.rows[0].notification_emails;
      if (typeof emails === 'string') { try { emails = JSON.parse(emails); } catch { emails = []; } }
      emails.forEach(email => {
        queueEmail({
          to: email,
          subject: `New Appeal Filed — Case #${case_id}`,
          body: `An appeal has been filed for academic integrity case #${case_id}.\n\nReason: ${reason.trim()}\n\nPlease review at /school/academic-integrity/appeals?case_id=${case_id}`
        });
      });
    }

    res.json({ success: true, message: 'Appeal filed successfully.' });
  }));

  console.log('[AcademicIntegrity] Module loaded — 24 routes registered');
};
