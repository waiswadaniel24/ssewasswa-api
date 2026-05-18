/**
 * Visual Report Builder — School SaaS Portal
 * Drag-and-drop report designer with chart types, data sources, scheduling, and export.
 *
 * Features:
 *   - 8 data sources with predefined SQL queries (students, fees, attendance, grades, staff, events, library, transport)
 *   - 8 inline SVG chart types (bar, line, pie, donut, area, table, summary-kpi, comparison)
 *   - Report CRUD with filters, grouping, sorting
 *   - Schedule reports (daily / weekly / monthly) with email recipients
 *   - Export as print-ready HTML or CSV download
 *   - Clone/duplicate reports, run history tracking
 *   - Aggregation queries for KPI/comparison charts
 *
 * Routes: 15 total under /school/reports
 * Tables: visual_reports, report_schedules, report_run_history (auto-created)
 */
module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const { renderPage, ah, requireAuth, audit } = opts;

  /* ─── colour palette for charts ─── */
  const PAL = ['#4f46e5','#7c3aed','#2563eb','#0891b2','#059669','#d97706','#dc2626','#db2777','#6366f1','#8b5cf6','#0ea5e9','#14b8a6'];

  /* ─── PostgreSQL schema bootstrap ─── */
  const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS visual_reports (
    id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
    name VARCHAR(255) NOT NULL, description TEXT,
    data_source VARCHAR(50) NOT NULL DEFAULT 'students',
    chart_type VARCHAR(20) NOT NULL DEFAULT 'table',
    filters JSONB NOT NULL DEFAULT '{}',
    group_by VARCHAR(100), sort_by VARCHAR(100), sort_dir VARCHAR(4) DEFAULT 'DESC',
    is_public BOOLEAN NOT NULL DEFAULT false,
    created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS report_schedules (
    id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0, report_id INT REFERENCES visual_reports(id) ON DELETE CASCADE,
    frequency VARCHAR(20) DEFAULT 'weekly', day_of_week INT DEFAULT 1, time TIME DEFAULT '08:00',
    recipients JSONB DEFAULT '[]', is_active BOOLEAN DEFAULT true,
    last_run TIMESTAMPTZ, next_run TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS report_run_history (
    id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0, report_id INT,
    status VARCHAR(20), row_count INT, generated_by VARCHAR(255), duration_ms INT,
    file_path VARCHAR(500), created_at TIMESTAMPTZ DEFAULT NOW()
  );`;
  pool.query(INIT_SQL).catch(() => {});

  /* ─── aggregation SQL variants for summary/kpi reports ─── */
  const AGG_SOURCES = {
    students:   { sql: `SELECT class AS name, COUNT(*) AS count FROM students WHERE tenant_id=$1 GROUP BY class ORDER BY count DESC` },
    fees:       { sql: `SELECT f.status AS name, SUM(f.amount) AS count, SUM(f.paid) AS paid FROM fees f WHERE f.tenant_id=$1 GROUP BY f.status ORDER BY count DESC` },
    attendance: { sql: `SELECT a.status AS name, COUNT(*) AS count FROM attendance a WHERE a.tenant_id=$1 GROUP BY a.status ORDER BY count DESC` },
    grades:     { sql: `SELECT g.grade AS name, COUNT(*) AS count, ROUND(AVG(g.score),1) AS avg_score FROM grades g WHERE g.tenant_id=$1 GROUP BY g.grade ORDER BY count DESC` },
    staff:      { sql: `SELECT department AS name, COUNT(*) AS count FROM staff WHERE tenant_id=$1 GROUP BY department ORDER BY count DESC` },
    events:     { sql: `SELECT type AS name, COUNT(*) AS count FROM events WHERE tenant_id=$1 GROUP BY type ORDER BY count DESC` },
    library:    { sql: `SELECT l.status AS name, COUNT(*) AS count, SUM(l.fine) AS total_fine FROM library_loans l WHERE l.tenant_id=$1 GROUP BY l.status ORDER BY count DESC` },
    transport:  { sql: `SELECT r.name AS name, COUNT(*) AS count FROM transport_assignments t JOIN routes r ON r.id=t.route_id WHERE t.tenant_id=$1 GROUP BY r.name ORDER BY count DESC` }
  };

  /* ─── predefined data sources with SQL queries ─── */
  const DATA_SOURCES = {
    students:    { label:'Students',    icon:'🎓', cols:['name','class','section','gender','dob','status'],
      sql:`SELECT name, class, section, gender, dob, status FROM students WHERE tenant_id=$1` },
    fees:        { label:'Fees',        icon:'💰', cols:['student','term','amount','paid','balance','status'],
      sql:`SELECT s.name AS student, f.term, f.amount, f.paid, (f.amount - f.paid) AS balance, f.status FROM fees f JOIN students s ON s.id=f.student_id WHERE f.tenant_id=$1` },
    attendance:  { label:'Attendance',  icon:'📋', cols:['student','date','status','class','check_in','check_out'],
      sql:`SELECT s.name AS student, a.date, a.status, a.class, a.check_in, a.check_out FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.tenant_id=$1` },
    grades:      { label:'Grades',      icon:'📝', cols:['student','subject','exam','score','grade','term'],
      sql:`SELECT s.name AS student, g.subject, g.exam, g.score, g.grade, g.term FROM grades g JOIN students s ON s.id=g.student_id WHERE g.tenant_id=$1` },
    staff:       { label:'Staff',       icon:'👩‍🏫', cols:['name','department','role','email','phone','status'],
      sql:`SELECT name, department, role, email, phone, status FROM staff WHERE tenant_id=$1` },
    events:      { label:'Events',      icon:'🎉', cols:['title','type','start_date','end_date','venue','status'],
      sql:`SELECT title, type, start_date, end_date, venue, status FROM events WHERE tenant_id=$1` },
    library:     { label:'Library',     icon:'📚', cols:['book_title','student','issue_date','due_date','status','fine'],
      sql:`SELECT b.title AS book_title, s.name AS student, l.issue_date, l.due_date, l.status, l.fine FROM library_loans l JOIN books b ON b.id=l.book_id JOIN students s ON s.id=l.student_id WHERE l.tenant_id=$1` },
    transport:   { label:'Transport',   icon:'🚌', cols:['route','student','pickup','dropoff','driver','vehicle'],
      sql:`SELECT r.name AS route, s.name AS student, t.pickup, t.dropoff, d.name AS driver, v.plate AS vehicle FROM transport_assignments t JOIN students s ON s.id=t.student_id JOIN routes r ON r.id=t.route_id LEFT JOIN staff d ON d.id=r.driver_id LEFT JOIN vehicles v ON v.id=r.vehicle_id WHERE t.tenant_id=$1` }
  };

  /* ════════════════════════════════════════════════════════════════
     S V G   C H A R T   R E N D E R E R S
     ════════════════════════════════════════════════════════════════ */
  function autoDetectFields(rows) {
    if (!rows.length) return { lbl:'label', val:'value' };
    const keys = Object.keys(rows[0]);
    let lbl = keys.find(k => /name|title|label|subject|class|term|student|department|type|route/i.test(k)) || keys[0];
    let val = keys.find(k => typeof rows[0][k] === 'number') || keys[1];
    return { lbl, val };
  }

  /* ── shared SVG axis helpers ── */
  function svgAxes(W, H, P, maxV, lblCount) {
    const steps = lblCount || 5;
    let grid = '', labels = '';
    for (let i = 0; i <= steps; i++) {
      const y = H - P - (i / steps) * (H - P * 2);
      const v = ((maxV * i) / steps).toFixed(0);
      grid += `<line x1="${P}" y1="${y}" x2="${W - P}" y2="${y}" stroke="#e5e7eb" stroke-dasharray="4,3"/>`;
      labels += `<text x="${P - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#9ca3af">${v}</text>`;
    }
    return { grid, labels, baseline: `<line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#d1d5db"/>` };
  }

  /* ── BAR CHART ── */
  function svgBar(rows, lbl, val) {
    if (!rows.length) return emptyMsg();
    const W = 640, H = 300, P = 55;
    const maxV = Math.max(...rows.map(r => Number(r[val]) || 0)) || 1;
    const vis = rows.slice(0, 25);
    const gap = 6, bw = Math.max(10, Math.min(45, (W - P * 2 - vis.length * gap) / vis.length));
    const ax = svgAxes(W, H, P, maxV, 5);
    let bars = '';
    vis.forEach((r, i) => {
      const h = Math.max(2, (Number(r[val]) || 0) / maxV * (H - P * 2));
      const x = P + i * (bw + gap), y = H - P - h;
      const c = PAL[i % PAL.length];
      bars += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="${c}" rx="4" opacity="0.9"><title>${esc(r[lbl])}: ${Number(r[val]).toLocaleString()}</title></rect>`;
      bars += `<text x="${x + bw / 2}" y="${y - 6}" text-anchor="middle" font-size="10" font-weight="600" fill="#374151">${Number(r[val]).toLocaleString()}</text>`;
      bars += `<text x="${x + bw / 2}" y="${H - P + 16}" text-anchor="middle" font-size="9" fill="#6b7280" transform="rotate(-30 ${x + bw / 2} ${H - P + 16})">${esc(String(r[lbl]).slice(0, 12))}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="w-full" role="img" aria-label="Bar chart">${ax.grid}${ax.labels}${ax.baseline}${bars}</svg>`;
  }

  /* ── LINE CHART ── */
  function svgLine(rows, lbl, val) {
    if (!rows.length) return emptyMsg();
    const W = 640, H = 300, P = 55;
    const maxV = Math.max(...rows.map(r => Number(r[val]) || 0)) || 1;
    const vis = rows.slice(0, 40);
    const xStep = (W - P * 2) / Math.max(vis.length - 1, 1);
    const ax = svgAxes(W, H, P, maxV, 5);
    const pts = vis.map((r, i) => {
      const x = P + i * xStep, y = H - P - Math.max(0, (Number(r[val]) || 0) / maxV * (H - P * 2));
      return { x, y, r };
    });
    const polyline = pts.map(p => `${p.x},${p.y}`).join(' ');
    const dots = pts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="5" fill="#4f46e5" stroke="#fff" stroke-width="2.5"><title>${esc(p.r[lbl])}: ${p.r[val]}</title></circle>`).join('');
    const xLabels = pts.filter((_, i) => i % Math.ceil(pts.length / 10) === 0).map(p => `<text x="${p.x}" y="${H - P + 16}" text-anchor="middle" font-size="9" fill="#6b7280" transform="rotate(-30 ${p.x} ${H - P + 16})">${esc(String(p.r[lbl]).slice(0, 10))}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="w-full" role="img" aria-label="Line chart">${ax.grid}${ax.labels}${ax.baseline}<polyline points="${polyline}" fill="none" stroke="#4f46e5" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${dots}${xLabels}</svg>`;
  }

  /* ── PIE CHART ── */
  function svgPie(rows, lbl, val, donut) {
    if (!rows.length) return emptyMsg();
    const total = rows.reduce((s, r) => s + (Number(r[val]) || 0), 0) || 1;
    const vis = rows.slice(0, 10);
    let paths = '', cx = 140, cy = 140, r = 110, angle = -90;
    vis.forEach((item, i) => {
      const pct = (Number(item[val]) || 0) / total * 100;
      const sweep = pct / 100 * 360;
      const x1 = cx + r * Math.cos(angle * Math.PI / 180), y1 = cy + r * Math.sin(angle * Math.PI / 180);
      const x2 = cx + r * Math.cos((angle + sweep) * Math.PI / 180), y2 = cy + r * Math.sin((angle + sweep) * Math.PI / 180);
      const large = sweep > 180 ? 1 : 0;
      paths += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z" fill="${PAL[i % PAL.length]}" class="hover:opacity-80 cursor-pointer" style="transition:opacity .2s"><title>${esc(item[lbl])}: ${pct.toFixed(1)}% (${Number(item[val]).toLocaleString()})</title></path>`;
      angle += sweep;
    });
    if (donut) paths = `<circle cx="${cx}" cy="${cy}" r="${donut}" fill="#fff"/>${paths}`;
    const legend = vis.map((item, i) => {
      const pct = ((Number(item[val]) || 0) / total * 100).toFixed(1);
      return `<div class="flex items-center gap-2 text-sm"><span class="w-3.5 h-3.5 rounded flex-shrink-0" style="background:${PAL[i % PAL.length]}"></span><span class="text-gray-700">${esc(String(item[lbl]).slice(0, 20))}</span><span class="text-gray-400 ml-auto font-mono text-xs">${pct}%</span></div>`;
    }).join('');
    return `<div class="flex flex-col sm:flex-row items-center gap-6"><svg viewBox="0 0 280 280" class="w-56 h-56 flex-shrink-0" role="img" aria-label="${donut ? 'Donut' : 'Pie'} chart">${paths}</svg><div class="grid gap-2 min-w-[180px]">${legend}</div></div>`;
  }

  /* ── AREA CHART ── */
  function svgArea(rows, lbl, val) {
    if (!rows.length) return emptyMsg();
    const W = 640, H = 300, P = 55;
    const maxV = Math.max(...rows.map(r => Number(r[val]) || 0)) || 1;
    const vis = rows.slice(0, 40);
    const xStep = (W - P * 2) / Math.max(vis.length - 1, 1);
    const ax = svgAxes(W, H, P, maxV, 5);
    const pts = vis.map((r, i) => {
      const x = P + i * xStep, y = H - P - Math.max(0, (Number(r[val]) || 0) / maxV * (H - P * 2));
      return { x, y };
    });
    const linePts = pts.map(p => `${p.x},${p.y}`).join(' ');
    const areaD = `M${pts[0].x},${H - P} ` + pts.map(p => `L${p.x},${p.y}`).join(' ') + ` L${pts[pts.length - 1].x},${H - P} Z`;
    return `<svg viewBox="0 0 ${W} ${H}" class="w-full" role="img" aria-label="Area chart">
      <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4f46e5" stop-opacity="0.35"/><stop offset="100%" stop-color="#4f46e5" stop-opacity="0.03"/></linearGradient></defs>
      ${ax.grid}${ax.labels}${ax.baseline}
      <path d="${areaD}" fill="url(#areaGrad)"/>
      <polyline points="${linePts}" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linejoin="round"/>
    </svg>`;
  }

  /* ── KPI SUMMARY ── */
  function renderKPI(rows, lbl, val) {
    if (!rows.length) return emptyMsg();
    const cards = rows.slice(0, 8).map((r, i) => {
      const v = Number(r[val]) || 0;
      return `<div class="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
        <div class="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">${esc(String(r[lbl]).slice(0, 24))}</div>
        <div class="text-3xl font-bold" style="color:${PAL[i % PAL.length]}">${v.toLocaleString()}</div>
      </div>`;
    }).join('');
    return `<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">${cards}</div>`;
  }

  /* ── COMPARISON (side-by-side KPI with delta) ── */
  function renderComparison(rows, lbl, val) {
    if (rows.length < 2) return renderKPI(rows, lbl, val);
    const a = rows[0], b = rows[1];
    const va = Number(a[val]) || 0, vb = Number(b[val]) || 0;
    const diff = va - vb, pct = vb ? ((diff / vb) * 100).toFixed(1) : '—';
    const arrow = diff >= 0 ? '↑' : '↓', clr = diff >= 0 ? '#059669' : '#dc2626';
    return `<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div class="bg-white rounded-xl border-2 border-indigo-100 p-6 text-center">
        <div class="text-sm text-gray-500 mb-2">${esc(String(a[lbl]))}</div>
        <div class="text-4xl font-bold text-indigo-600">${va.toLocaleString()}</div>
      </div>
      <div class="bg-white rounded-xl border-2 border-gray-200 p-6 text-center">
        <div class="text-sm text-gray-500 mb-2">${esc(String(b[lbl]))}</div>
        <div class="text-4xl font-bold text-gray-700">${vb.toLocaleString()}</div>
      </div>
      <div class="md:col-span-2 flex items-center justify-center gap-4 py-4">
        <span class="text-3xl" style="color:${clr}">${arrow}</span>
        <span class="text-lg font-semibold" style="color:${clr}">${diff >= 0 ? '+' : ''}${diff.toLocaleString()} (${pct}%)</span>
      </div>
    </div>`;
  }

  /* ── DATA TABLE ── */
  function renderTable(rows) {
    if (!rows.length) return emptyMsg();
    const cols = Object.keys(rows[0]);
    const th = cols.map(c => `<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-b sticky top-0 z-10">${esc(c)}</th>`).join('');
    const tr = rows.slice(0, 200).map((r, i) => `<tr class="${i % 2 ? 'bg-gray-50/50' : ''} hover:bg-indigo-50/40 border-b border-gray-100 transition-colors">` +
      cols.map(c => `<td class="px-4 py-2.5 text-sm text-gray-700 whitespace-nowrap">${esc(String(r[c] ?? ''))}</td>`).join('') + '</tr>').join('');
    const extra = rows.length > 200 ? `<tr><td colspan="${cols.length}" class="px-4 py-3 text-center text-xs text-gray-400">Showing 200 of ${rows.length} rows</td></tr>` : '';
    return `<div class="overflow-x-auto max-h-[400px] overflow-y-auto rounded-xl border border-gray-200 shadow-sm" style="scrollbar-width:thin">
      <table class="min-w-full"><thead class="sticky top-0 z-10">${th}</thead><tbody>${tr}${extra}</tbody></table></div>`;
  }

  /* ── empty state ── */
  function emptyMsg() {
    return `<div class="flex flex-col items-center justify-center py-16 text-gray-400"><svg class="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><p class="text-lg font-medium">No data available</p><p class="text-sm mt-1">Try adjusting filters or data source</p></div>`;
  }

  /* ── chart dispatcher — selects renderer based on chart_type ── */
  function renderChart(type, rows, groupBy) {
    const { lbl, val } = autoDetectFields(rows);
    switch (type) {
      case 'bar': return svgBar(rows, lbl, val);
      case 'line': return svgLine(rows, lbl, val);
      case 'pie': return svgPie(rows, lbl, val, 0);
      case 'donut': return svgPie(rows, lbl, val, 55);
      case 'area': return svgArea(rows, lbl, val);
      case 'comparison': return renderComparison(rows, lbl, val);
      case 'summary-kpi': return renderKPI(rows, lbl, val);
      case 'table': default: return renderTable(rows);
    }
  }

  /* ─── data source info panel for create form ─── */
  function dataSourceInfoPanel() {
    const items = Object.entries(DATA_SOURCES).map(([k, v]) =>
      `<div class="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
        <span class="text-xl">${v.icon}</span>
        <div><div class="text-sm font-medium text-gray-700">${esc(v.label)}</div>
        <div class="text-xs text-gray-400">Columns: ${v.cols.join(', ')}</div></div></div>`
    ).join('');
    return `<details class="mt-4"><summary class="cursor-pointer text-sm text-indigo-600 hover:text-indigo-800 font-medium">View available data sources & columns</summary>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">${items}</div></details>`;
  }

  /* ─── run history snippet for report view ─── */
  async function runHistorySnippet(reportId, tid) {
    const { rows } = await pool.query(
      'SELECT * FROM report_run_history WHERE tenant_id=$1 AND report_id=$2 ORDER BY created_at DESC LIMIT 5', [tid, reportId]);
    if (!rows.length) return '';
    const rows_html = rows.map(h =>
      `<tr class="border-b border-gray-100"><td class="px-3 py-2 text-xs"><span class="px-2 py-0.5 rounded-full text-xs font-medium ${h.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${esc(h.status)}</span></td>
        <td class="px-3 py-2 text-xs text-gray-600">${h.row_count ?? 0} rows</td>
        <td class="px-3 py-2 text-xs text-gray-500 font-mono">${h.duration_ms ? h.duration_ms + 'ms' : '—'}</td>
        <td class="px-3 py-2 text-xs text-gray-400">${new Date(h.created_at).toLocaleString()}</td>
        <td class="px-3 py-2 text-xs text-gray-400">${esc(h.generated_by || '')}</td></tr>`
    ).join('');
    return `<details class="mt-4 bg-white border border-gray-200 rounded-xl overflow-hidden">
      <summary class="px-4 py-3 cursor-pointer hover:bg-gray-50 text-sm font-medium text-gray-700">📋 Recent Run History (${rows.length})</summary>
      <div class="overflow-x-auto"><table class="min-w-full text-sm"><thead><tr class="bg-gray-50 text-xs text-gray-500 uppercase"><th class="px-3 py-2 text-left">Status</th><th class="px-3 py-2 text-left">Rows</th><th class="px-3 py-2 text-left">Duration</th><th class="px-3 py-2 text-left">Date</th><th class="px-3 py-2 text-left">By</th></tr></thead><tbody>${rows_html}</tbody></table></div></details>`;
  }

  /* ─── helpers ─── */
  async function fetchReportData(src, tid, filters, groupBy, sortBy, sortDir) {
    const ds = DATA_SOURCES[src];
    if (!ds) return [];
    let sql = ds.sql, params = [tid], idx = 2;
    const f = filters || {};
    for (const [k, v] of Object.entries(f)) {
      if (v) { sql += ` AND CAST(${k} AS TEXT) ILIKE $${idx}`; params.push(`%${v}%`); idx++; }
    }
    if (groupBy) sql += ` GROUP BY ${groupBy}`;
    if (sortBy) sql += ` ORDER BY ${sortBy} ${sortDir === 'ASC' ? 'ASC' : 'DESC'}`;
    sql += ' LIMIT 500';
    const { rows } = await pool.query(sql, params);
    return rows;
  }

  function breadcrumb(items) {
    return `<nav class="flex items-center gap-2 text-sm text-gray-500 mb-5">${items.map((it, i) =>
      i < items.length - 1 ? `<a href="${it.href}" class="hover:text-indigo-600 transition-colors">${esc(it.label)}</a><span>/</span>` :
        `<span class="text-gray-800 font-medium">${esc(it.label)}</span>`
    ).join('')}</nav>`;
  }

  function scheduleForm(reportId) {
    return `<details class="mt-6 bg-white border border-gray-200 rounded-xl overflow-hidden">
      <summary class="px-5 py-3 cursor-pointer hover:bg-gray-50 font-medium text-gray-700 text-sm flex items-center gap-2">⏰ Schedule This Report</summary>
      <form method="POST" action="/school/reports/${reportId}/schedule" class="p-5 border-t bg-gray-50 space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label class="block text-xs font-medium text-gray-600 mb-1">Frequency</label><select name="frequency" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"><option value="daily">Daily</option><option value="weekly" selected>Weekly</option><option value="monthly">Monthly</option></select></div>
          <div><label class="block text-xs font-medium text-gray-600 mb-1">Day of Week (1=Mon)</label><input name="day_of_week" type="number" min="0" max="6" value="1" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"/></div>
          <div><label class="block text-xs font-medium text-gray-600 mb-1">Time</label><input name="time" type="time" value="08:00" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"/></div>
        </div>
        <div><label class="block text-xs font-medium text-gray-600 mb-1">Recipients (comma-separated emails)</label><input name="recipients" type="text" placeholder="admin@school.com, head@school.com" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"/></div>
        <button type="submit" class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">Save Schedule</button>
      </form>
    </details>`;
  }

  /* ════════════════════════════════════════════════════════════════
     R O U T E S
     ════════════════════════════════════════════════════════════════ */

  /* 1 ── GET /school/reports — Dashboard gallery */
  app.get('/school/reports', requireAuth, async (req, res) => {
    const tid = tenantId(req);
    const [reports, scheduled, recent] = await Promise.all([
      pool.query('SELECT * FROM visual_reports WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 24', [tid]),
      pool.query('SELECT s.*, r.name AS report_name FROM report_schedules s JOIN visual_reports r ON r.id=s.report_id WHERE s.tenant_id=$1 AND s.is_active=true ORDER BY s.next_run ASC', [tid]),
      pool.query('SELECT h.*, r.name AS report_name FROM report_run_history h JOIN visual_reports r ON r.id=h.report_id WHERE h.tenant_id=$1 ORDER BY h.created_at DESC LIMIT 12', [tid])
    ]);
    const srcCount = Object.keys(DATA_SOURCES).length;
    const activeSched = scheduled.rows.length;
    const totalRuns = recent.rows.length;
    const successRuns = recent.rows.filter(r => r.status === 'success').length;

    /* stat cards */
    const stats = [
      { label: 'Total Reports', value: reports.rows.length, color: '#4f46e5', icon: '📊' },
      { label: 'Data Sources', value: srcCount, color: '#7c3aed', icon: '🗄️' },
      { label: 'Active Schedules', value: activeSched, color: '#059669', icon: '⏰' },
      { label: 'Success Rate', value: totalRuns ? Math.round(successRuns / totalRuns * 100) + '%' : '—', color: '#d97706', icon: '✅' }
    ].map(s => `<div class="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow"><div class="flex items-center gap-3"><span class="text-2xl">${s.icon}</span><div><div class="text-xs text-gray-400 uppercase tracking-wide">${s.label}</div><div class="text-2xl font-bold" style="color:${s.color}">${s.value}</div></div></div></div>`).join('');

    /* report cards */
    const cards = reports.rows.map(r => {
      const ds = DATA_SOURCES[r.data_source];
      return `<div class="bg-white rounded-xl border border-gray-200 hover:shadow-lg transition-all duration-200 overflow-hidden group">
        <div class="h-1.5" style="background:${PAL[r.id % PAL.length]}"></div>
        <div class="p-4">
          <div class="flex items-start justify-between gap-2">
            <h3 class="font-semibold text-gray-800 text-sm leading-tight">${esc(r.name)}</h3>
            <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">${esc(r.chart_type)}</span>
          </div>
          <p class="text-xs text-gray-400 mt-1.5 line-clamp-2">${esc(r.description || 'No description')}</p>
          <div class="flex items-center gap-3 mt-3 text-xs text-gray-500">
            <span>${ds ? ds.icon : ''} ${ds ? ds.label : r.data_source}</span>
            <span>·</span>
            <span>${new Date(r.updated_at).toLocaleDateString()}</span>
          </div>
          <div class="flex gap-2 mt-3 pt-3 border-t border-gray-100">
            <a href="/school/reports/${r.id}" class="px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 text-xs font-medium transition-colors">View</a>
            <a href="/school/reports/${r.id}/edit" class="px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs transition-colors">Edit</a>
            <a href="/school/reports/${r.id}/export/pdf" class="px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs transition-colors">PDF</a>
            <button onclick="deleteReport(${r.id})" class="px-3 py-1.5 rounded-md border border-gray-200 text-red-500 hover:bg-red-50 text-xs transition-colors ml-auto">Delete</button>
          </div>
        </div>
      </div>`;
    }).join('');

    /* scheduled table */
    const schedRows = scheduled.rows.map(s => `<tr class="border-b border-gray-100 hover:bg-gray-50">
      <td class="px-4 py-2.5 text-sm font-medium text-gray-800">${esc(s.report_name)}</td>
      <td class="px-4 py-2.5 text-sm text-gray-600">${esc(s.frequency)}</td>
      <td class="px-4 py-2.5 text-sm text-gray-600">${esc(String(s.time || '08:00'))}</td>
      <td class="px-4 py-2.5 text-sm text-gray-600">${s.next_run ? new Date(s.next_run).toLocaleDateString() : '—'}</td>
    </tr>`).join('');

    /* recent runs */
    const histRows = recent.rows.map(h => `<tr class="border-b border-gray-100 hover:bg-gray-50">
      <td class="px-4 py-2.5 text-sm font-medium text-gray-800">${esc(h.report_name)}</td>
      <td class="px-4 py-2.5"><span class="px-2 py-0.5 rounded-full text-xs font-medium ${h.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${esc(h.status)}</span></td>
      <td class="px-4 py-2.5 text-sm text-gray-600">${h.row_count ?? 0} rows</td>
      <td class="px-4 py-2.5 text-sm text-gray-600 font-mono">${h.duration_ms ? h.duration_ms + 'ms' : ''}</td>
      <td class="px-4 py-2.5 text-xs text-gray-400">${new Date(h.created_at).toLocaleString()}</td>
    </tr>`).join('');

    const body = `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-3">
      <div><h1 class="text-2xl font-bold text-gray-900">📊 Report Builder</h1><p class="text-gray-500 text-sm mt-1">Design, schedule and export visual reports</p></div>
      <div class="flex gap-2">
        <a href="/school/reports/scheduled" class="px-4 py-2.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 text-sm font-medium">⏰ Schedules</a>
        <a href="/school/reports/create" class="px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium flex items-center gap-2 shadow-sm">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>New Report</a>
      </div>
    </div>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">${stats}</div>
    <h2 class="text-lg font-semibold text-gray-800 mb-4">Report Gallery</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">${cards || '<p class="col-span-full text-gray-400 text-center py-16">No reports yet. Create your first report to get started!</p>'}</div>
    <h2 class="text-lg font-semibold text-gray-800 mt-10 mb-3">⏰ Active Schedules</h2>
    ${scheduled.rows.length ? `<div class="overflow-x-auto rounded-xl border border-gray-200"><table class="min-w-full"><thead><tr class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider"><th class="px-4 py-3 text-left">Report</th><th class="px-4 py-3 text-left">Frequency</th><th class="px-4 py-3 text-left">Time</th><th class="px-4 py-3 text-left">Next Run</th></tr></thead><tbody>${schedRows}</tbody></table></div>` : '<p class="text-gray-400 text-sm">No active schedules configured.</p>'}
    <h2 class="text-lg font-semibold text-gray-800 mt-10 mb-3">🕐 Recent Runs</h2>
    ${recent.rows.length ? `<div class="overflow-x-auto rounded-xl border border-gray-200"><table class="min-w-full"><thead><tr class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider"><th class="px-4 py-3 text-left">Report</th><th class="px-4 py-3 text-left">Status</th><th class="px-4 py-3 text-left">Rows</th><th class="px-4 py-3 text-left">Duration</th><th class="px-4 py-3 text-left">Date</th></tr></thead><tbody>${histRows}</tbody></table></div>` : '<p class="text-gray-400 text-sm">No report runs recorded yet.</p>'}
    <script>
      async function deleteReport(id) {
        if (!confirm('Delete this report? This cannot be undone.')) return;
        const res = await fetch('/school/reports/' + id, { method: 'DELETE' });
        if (res.ok) location.reload(); else alert('Failed to delete');
      }
    </script>`;
    renderPage(req, res, 'Visual Reports', body, '/school/reports');
  });

  /* 2 ── GET /school/reports/create — Create form */
  app.get('/school/reports/create', requireAuth, (req, res) => {
    const srcOpts = Object.entries(DATA_SOURCES).map(([k, v]) => `<option value="${k}">${v.icon} ${esc(v.label)}</option>`).join('');
    const chartTypes = [
      { v: 'table', l: '📊 Data Table', d: 'Sortable tabular view' },
      { v: 'bar', l: '📊 Bar Chart', d: 'Vertical bars comparison' },
      { v: 'line', l: '📈 Line Chart', d: 'Trend over time' },
      { v: 'pie', l: '🥧 Pie Chart', d: 'Proportional segments' },
      { v: 'donut', l: '🍩 Donut Chart', d: 'Pie with hollow centre' },
      { v: 'area', l: '📉 Area Chart', d: 'Filled line trend' },
      { v: 'summary-kpi', l: '🔢 KPI Summary', d: 'Key metric cards' },
      { v: 'comparison', l: '⚖️ Comparison', d: 'Side-by-side delta' }
    ];
    const chartOpts = chartTypes.map(c => `<option value="${c.v}">${esc(c.l)} — ${c.d}</option>`).join('');
    const body = `
    ${breadcrumb([{ label: 'Reports', href: '/school/reports' }, { label: 'Create New' }])}
    <h1 class="text-2xl font-bold text-gray-900 mb-6">Create New Report</h1>
    <form method="POST" action="/school/reports/create" class="max-w-2xl space-y-5">
      <div class="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div><label class="block text-sm font-medium text-gray-700 mb-1">Report Name <span class="text-red-400">*</span></label><input name="name" required maxlength="255" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition" placeholder="e.g. Monthly Attendance Summary"/></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea name="description" rows="2" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" placeholder="Optional description of this report"></textarea></div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Data Source</label><select name="data_source" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-indigo-500">${srcOpts}</select></div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Chart Type</label><select name="chart_type" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-indigo-500">${chartOpts}</select></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Group By</label><input name="group_by" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-indigo-500" placeholder="e.g. class, term"/></div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Sort By</label><input name="sort_by" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-indigo-500" placeholder="e.g. name, date"/></div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Sort Direction</label><select name="sort_dir" class="w-full border border-gray-300 rounded-lg px-3 py-2.5"><option value="DESC">Descending ↓</option><option value="ASC">Ascending ↑</option></select></div>
        </div>
        <div class="bg-gray-50 rounded-lg p-4"><label class="block text-sm font-medium text-gray-700 mb-2">Filters <span class="text-xs text-gray-400">(key=value per line)</span></label><textarea name="filters" rows="3" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-indigo-500" placeholder="class=10&#10;status=active&#10;term=Term 1"></textarea></div>
        <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" name="is_public" value="true" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"/><span class="text-sm text-gray-700">Make this report publicly accessible</span></label>
      </div>
      <div class="flex gap-3"><button type="submit" class="px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium shadow-sm transition">Create Report</button><a href="/school/reports" class="px-6 py-2.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition">Cancel</a></div>
    </form>
    ${dataSourceInfoPanel()}`;
    renderPage(req, res, 'Create Report', body, '/school/reports');
  });

  /* 3 ── POST /school/reports/create — Save new report */
  app.post('/school/reports/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { name, description, data_source, chart_type, group_by, sort_by, sort_dir, is_public } = req.body;
    const filters = {};
    (req.body.filters || '').split('\n').forEach(line => { const [k, ...v] = line.split('='); if (k.trim()) filters[k.trim()] = v.join('=').trim(); });
    const { rows } = await pool.query(
      `INSERT INTO visual_reports (tenant_id,name,description,data_source,chart_type,filters,group_by,sort_by,sort_dir,is_public,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [tid, name, description || '', data_source || 'students', chart_type || 'table', JSON.stringify(filters), group_by || '', sort_by || '', sort_dir || 'DESC', is_public === 'true', req.session?.user?.email || '']);
    audit('report_created', { reportId: rows[0].id, name }, req);
    res.redirect(`/school/reports/${rows[0].id}`);
  }));

  /* 4 ── GET /school/reports/:id — View rendered report */
  app.get('/school/reports/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { rows: [r] } = await pool.query('SELECT * FROM visual_reports WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!r) return res.status(404).send('Report not found');
    const data = await fetchReportData(r.data_source, tid, r.filters, r.group_by, r.sort_by, r.sort_dir);
    const ds = DATA_SOURCES[r.data_source];
    /* fetch aggregated data for kpi/comparison charts */
    const aggKey = (r.chart_type === 'summary-kpi' || r.chart_type === 'comparison') && AGG_SOURCES[r.data_source] ? r.data_source : null;
    const aggData = aggKey ? (await pool.query(AGG_SOURCES[aggKey].sql, [tid])).rows : [];
    const displayData = aggData.length >= 2 ? aggData : data;
    const chart = renderChart(r.chart_type, displayData, r.group_by);

    /* active schedule info */
    const { rows: [sched] } = await pool.query('SELECT * FROM report_schedules WHERE tenant_id=$1 AND report_id=$2 AND is_active=true', [tid, r.id]);
    const schedBadge = sched ? `<span class="inline-flex items-center gap-1 px-3 py-1 bg-green-50 border border-green-200 rounded-full text-xs font-medium text-green-700">⏰ ${esc(sched.frequency)} at ${esc(String(sched.time||'08:00'))} · Next: ${sched.next_run?new Date(sched.next_run).toLocaleDateString():'—'}</span>` : '';

    const body = `
    ${breadcrumb([{ label: 'Reports', href: '/school/reports' }, { label: r.name }])}
    <div class="flex flex-col lg:flex-row lg:items-center justify-between mb-6 gap-4">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">${esc(r.name)}</h1>
        <p class="text-sm text-gray-500 mt-1">${esc(r.description || 'No description')} · ${ds ? ds.icon + ' ' + ds.label : r.data_source} · <span class="capitalize">${r.chart_type}</span></p>
        <div class="mt-2">${schedBadge}</div>
      </div>
      <div class="flex flex-wrap gap-2">
        <form method="POST" action="/school/reports/${r.id}/run"><button class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium shadow-sm transition flex items-center gap-1">▶ Run Now</button></form>
        <form method="POST" action="/school/reports/${r.id}/duplicate" style="display:inline"><button class="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm transition">📋 Duplicate</button></form>
        <a href="/school/reports/${r.id}/export/pdf" class="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm transition">📄 PDF</a>
        <a href="/school/reports/${r.id}/export/csv" class="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm transition">📥 CSV</a>
        <a href="/school/reports/${r.id}/edit" class="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm transition">✏️ Edit</a>
      </div>
    </div>
    <div class="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">${chart}</div>
    <div class="flex items-center justify-between mt-3">
      <p class="text-xs text-gray-400">${data.length} row(s) returned · Last updated ${new Date(r.updated_at).toLocaleString()}</p>
      <p class="text-xs text-gray-400">Created by ${esc(r.created_by || 'unknown')}</p>
    </div>
    ${scheduleForm(r.id)}
    ${await runHistorySnippet(r.id, tid)}
    <script>
      async function deleteReport(id) {
        if (!confirm('Delete this report permanently?')) return;
        const res = await fetch('/school/reports/' + id, { method: 'DELETE' });
        if (res.ok) window.location = '/school/reports'; else alert('Delete failed');
      }
    </script>`;
    renderPage(req, res, r.name, body, '/school/reports');
  }));

  /* 5 ── GET /school/reports/:id/edit — Edit form */
  app.get('/school/reports/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { rows: [r] } = await pool.query('SELECT * FROM visual_reports WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!r) return res.status(404).send('Report not found');
    const f = typeof r.filters === 'string' ? JSON.parse(r.filters) : (r.filters || {});
    const filterStr = Object.entries(f).map(([k, v]) => `${k}=${v}`).join('\n');
    const srcOpts = Object.entries(DATA_SOURCES).map(([k, v]) => `<option value="${k}" ${k === r.data_source ? 'selected' : ''}>${v.icon} ${esc(v.label)}</option>`).join('');
    const chartOpts = ['table', 'bar', 'line', 'pie', 'donut', 'area', 'summary-kpi', 'comparison'].map(c => `<option value="${c}" ${c === r.chart_type ? 'selected' : ''}>${c}</option>`).join('');
    const body = `
    ${breadcrumb([{ label: 'Reports', href: '/school/reports' }, { label: r.name, href: `/school/reports/${r.id}` }, { label: 'Edit' }])}
    <h1 class="text-2xl font-bold text-gray-900 mb-6">Edit Report</h1>
    <form method="POST" action="/school/reports/${r.id}/edit" class="max-w-2xl space-y-5">
      <div class="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div><label class="block text-sm font-medium text-gray-700 mb-1">Report Name</label><input name="name" value="${esc(r.name)}" required class="w-full border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-indigo-500"/></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea name="description" rows="2" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-indigo-500">${esc(r.description || '')}</textarea></div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Data Source</label><select name="data_source" class="w-full border border-gray-300 rounded-lg px-3 py-2.5">${srcOpts}</select></div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Chart Type</label><select name="chart_type" class="w-full border border-gray-300 rounded-lg px-3 py-2.5">${chartOpts}</select></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Group By</label><input name="group_by" value="${esc(r.group_by || '')}" class="w-full border border-gray-300 rounded-lg px-3 py-2.5"/></div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Sort By</label><input name="sort_by" value="${esc(r.sort_by || '')}" class="w-full border border-gray-300 rounded-lg px-3 py-2.5"/></div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Sort Direction</label><select name="sort_dir" class="w-full border border-gray-300 rounded-lg px-3 py-2.5"><option value="DESC" ${r.sort_dir === 'DESC' ? 'selected' : ''}>Descending</option><option value="ASC" ${r.sort_dir === 'ASC' ? 'selected' : ''}>Ascending</option></select></div>
        </div>
        <div class="bg-gray-50 rounded-lg p-4"><label class="block text-sm font-medium text-gray-700 mb-2">Filters</label><textarea name="filters" rows="3" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono">${esc(filterStr)}</textarea></div>
        <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" name="is_public" value="true" class="rounded border-gray-300 text-indigo-600" ${r.is_public ? 'checked' : ''}/><span class="text-sm text-gray-700">Public</span></label>
      </div>
      <div class="flex gap-3"><button type="submit" class="px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium shadow-sm">Save Changes</button><a href="/school/reports/${r.id}" class="px-6 py-2.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Cancel</a></div>
    </form>`;
    renderPage(req, res, 'Edit Report', body, '/school/reports');
  }));

  /* 6 ── POST /school/reports/:id/edit — Update report */
  app.post('/school/reports/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { name, description, data_source, chart_type, group_by, sort_by, sort_dir, is_public } = req.body;
    const filters = {};
    (req.body.filters || '').split('\n').forEach(line => { const [k, ...v] = line.split('='); if (k.trim()) filters[k.trim()] = v.join('=').trim(); });
    await pool.query(
      `UPDATE visual_reports SET name=$1,description=$2,data_source=$3,chart_type=$4,filters=$5,group_by=$6,sort_by=$7,sort_dir=$8,is_public=$9,updated_at=NOW() WHERE id=$10 AND tenant_id=$11`,
      [name, description || '', data_source || 'students', chart_type || 'table', JSON.stringify(filters), group_by || '', sort_by || '', sort_dir || 'DESC', is_public === 'true', req.params.id, tid]);
    audit('report_updated', { reportId: req.params.id, name }, req);
    res.redirect(`/school/reports/${req.params.id}`);
  }));

  /* 7 ── DELETE /school/reports/:id — Delete report */
  app.delete('/school/reports/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await pool.query('DELETE FROM visual_reports WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    audit('report_deleted', { reportId: req.params.id }, req);
    res.json({ ok: true });
  }));

  /* 8 ── POST /school/reports/:id/run — Execute report */
  app.post('/school/reports/:id/run', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { rows: [r] } = await pool.query('SELECT * FROM visual_reports WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    const t0 = Date.now();
    let data = [], status = 'success';
    try { data = await fetchReportData(r.data_source, tid, r.filters, r.group_by, r.sort_by, r.sort_dir); } catch (e) { status = 'error'; }
    const ms = Date.now() - t0;
    await pool.query('INSERT INTO report_run_history (tenant_id,report_id,status,row_count,generated_by,duration_ms) VALUES ($1,$2,$3,$4,$5,$6)',
      [tid, req.params.id, status, data.length, req.session?.user?.email || '', ms]);
    audit('report_run', { reportId: req.params.id, status, rowCount: data.length, durationMs: ms }, req);
    res.redirect(`/school/reports/${req.params.id}`);
  }));

  /* 9 ── GET /school/reports/:id/export/pdf — Print-ready HTML export */
  app.get('/school/reports/:id/export/pdf', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { rows: [r] } = await pool.query('SELECT * FROM visual_reports WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!r) return res.status(404).send('Report not found');
    const data = await fetchReportData(r.data_source, tid, r.filters, r.group_by, r.sort_by, r.sort_dir);
    const chart = renderChart(r.chart_type, data, r.group_by);
    const printHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(r.name)}</title>
      <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:48px;color:#111;max-width:1100px;margin:0 auto}
        @media print{body{padding:24px}button{display:none}}h1{font-size:26px;margin-bottom:6px;border-bottom:3px solid #4f46e5;padding-bottom:10px}
        .meta{color:#666;font-size:13px;margin-bottom:28px;display:flex;gap:16px;flex-wrap:wrap}
        table{width:100%;border-collapse:collapse;font-size:13px;margin-top:16px}th,td{border:1px solid #d1d5db;padding:8px 12px;text-align:left}
        th{background:#f3f4f6;font-weight:600;position:sticky;top:0}tr:nth-child(even){background:#f9fafb}
        svg{max-width:100%;height:auto}footer{margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;text-align:center}
        .badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;background:#eef2ff;color:#4f46e5;font-weight:600}</style></head>
      <body>
        <h1>${esc(r.name)}</h1>
        <div class="meta"><span>${esc(r.description || '')}</span><span class="badge">${esc(r.chart_type)}</span><span>Source: ${esc(r.data_source)}</span><span>Generated: ${new Date().toLocaleString()}</span><span>Rows: ${data.length}</span></div>
        ${chart.replace(/max-h-\[400px\] overflow-y-auto/g, '').replace(/hover:bg-indigo-50\/40/g, '')}
        <footer>School SaaS Portal — Visual Report Builder</footer>
        <button onclick="window.print()" style="position:fixed;top:20px;right:20px;padding:10px 20px;background:#4f46e5;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.15)">🖨 Print / Save as PDF</button>
        <script>window.onafterprint=()=>document.querySelector('button').style.display='none'<\/script>
      </body></html>`;
    res.type('html').set('Content-Disposition', `attachment; filename="${r.name.replace(/\s+/g, '_')}.html"`).send(printHtml);
  }));

  /* 10 ─ GET /school/reports/:id/export/csv — CSV download */
  app.get('/school/reports/:id/export/csv', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { rows: [r] } = await pool.query('SELECT * FROM visual_reports WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!r) return res.status(404).send('Report not found');
    const data = await fetchReportData(r.data_source, tid, r.filters, r.group_by, r.sort_by, r.sort_dir);
    if (!data.length) return res.status(404).send('No data to export');
    const cols = Object.keys(data[0]);
    const csv = [cols.join(','), ...data.map(row => cols.map(c => `"${String(row[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    res.type('csv').set('Content-Disposition', `attachment; filename="${r.name.replace(/\s+/g, '_')}.csv"`).send(csv);
  }));

  /* 11 ─ POST /school/reports/:id/schedule — Save schedule */
  app.post('/school/reports/:id/schedule', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { frequency, day_of_week, time, recipients } = req.body;
    const recips = (recipients || '').split(',').map(s => s.trim()).filter(Boolean);
    let nextRun = new Date();
    if (frequency === 'daily') nextRun.setDate(nextRun.getDate() + 1);
    else if (frequency === 'weekly') { const dow = parseInt(day_of_week) || 1; const diff = (dow - nextRun.getDay() + 7) % 7 || 7; nextRun.setDate(nextRun.getDate() + diff); }
    else nextRun.setMonth(nextRun.getMonth() + 1);
    if (time) { const [h, m] = time.split(':'); nextRun.setHours(parseInt(h) || 8, parseInt(m) || 0, 0, 0); }
    /* upsert: update existing or insert */
    const existing = await pool.query('SELECT id FROM report_schedules WHERE tenant_id=$1 AND report_id=$2', [tid, req.params.id]);
    if (existing.rows.length) {
      await pool.query('UPDATE report_schedules SET frequency=$1,day_of_week=$2,time=$3,recipients=$4,is_active=true,next_run=$5 WHERE id=$6',
        [frequency || 'weekly', day_of_week || 1, time || '08:00', JSON.stringify(recips), nextRun, existing.rows[0].id]);
    } else {
      await pool.query('INSERT INTO report_schedules (tenant_id,report_id,frequency,day_of_week,time,recipients,next_run) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [tid, req.params.id, frequency || 'weekly', day_of_week || 1, time || '08:00', JSON.stringify(recips), nextRun]);
    }
    audit('report_scheduled', { reportId: req.params.id, frequency }, req);
    res.redirect(`/school/reports/scheduled`);
  }));

  /* 12 ─ GET /school/reports/scheduled — Scheduled reports list */
  app.get('/school/reports/scheduled', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { rows: all } = await pool.query(
      'SELECT s.*, r.name AS report_name, r.chart_type, r.data_source FROM report_schedules s JOIN visual_reports r ON r.id=s.report_id WHERE s.tenant_id=$1 ORDER BY s.is_active DESC, s.next_run ASC', [tid]);
    const freqIcons = { daily: '📅', weekly: '📆', monthly: '🗓️' };
    const rows = all.map(s => `<tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td class="px-4 py-3 text-sm font-medium text-gray-800">${esc(s.report_name)}</td>
      <td class="px-4 py-3 text-sm text-gray-600">${freqIcons[s.frequency] || ''} <span class="capitalize">${esc(s.frequency)}</span></td>
      <td class="px-4 py-3 text-sm text-gray-600 font-mono">${esc(String(s.time || '08:00'))}</td>
      <td class="px-4 py-3 text-sm text-gray-600">${s.next_run ? new Date(s.next_run).toLocaleString() : '—'}</td>
      <td class="px-4 py-3 text-sm text-gray-500">${s.last_run ? new Date(s.last_run).toLocaleString() : '<span class="text-gray-300">Never</span>'}</td>
      <td class="px-4 py-3"><span class="px-2.5 py-1 rounded-full text-xs font-semibold ${s.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}">${s.is_active ? 'Active' : 'Paused'}</span></td>
      <td class="px-4 py-3"><div class="flex gap-2"><a href="/school/reports/${s.report_id}" class="text-indigo-600 hover:text-indigo-800 text-sm font-medium">View</a><button onclick="toggleSchedule(${s.id},${s.report_id})" class="text-xs text-gray-400 hover:text-red-600">${s.is_active ? 'Pause' : 'Resume'}</button></div></td>
    </tr>`).join('');
    const body = `
    ${breadcrumb([{ label: 'Reports', href: '/school/reports' }, { label: 'Schedules' }])}
    <div class="flex items-center justify-between mb-6">
      <div><h1 class="text-2xl font-bold text-gray-900">⏰ Scheduled Reports</h1><p class="text-sm text-gray-500 mt-1">${all.length} schedule(s) · ${all.filter(s => s.is_active).length} active</p></div>
      <a href="/school/reports" class="px-4 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 text-sm font-medium">&larr; All Reports</a>
    </div>
    ${all.length ? `<div class="overflow-x-auto rounded-xl border border-gray-200 shadow-sm"><table class="min-w-full">
      <thead><tr class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider"><th class="px-4 py-3 text-left">Report</th><th class="px-4 py-3 text-left">Frequency</th><th class="px-4 py-3 text-left">Time</th><th class="px-4 py-3 text-left">Next Run</th><th class="px-4 py-3 text-left">Last Run</th><th class="px-4 py-3 text-left">Status</th><th class="px-4 py-3 text-left">Actions</th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<div class="flex flex-col items-center justify-center py-16 text-gray-400"><p class="text-lg font-medium">No scheduled reports</p><p class="text-sm mt-1">Schedule a report from its view page.</p></div>'}
    <script>
      async function toggleSchedule(scheduleId, reportId) {
        const res = await fetch('/school/reports/' + reportId + '/schedule/toggle', { method: 'POST' });
        if (res.ok) location.reload(); else alert('Failed to toggle schedule');
      }
    </script>`;
    renderPage(req, res, 'Scheduled Reports', body, '/school/reports/scheduled');
  }));

  /* 14 ─ POST /school/reports/:id/duplicate — Clone a report */
  app.post('/school/reports/:id/duplicate', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { rows: [src] } = await pool.query('SELECT * FROM visual_reports WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!src) return res.status(404).json({ error: 'Report not found' });
    const { rows } = await pool.query(
      `INSERT INTO visual_reports (tenant_id,name,description,data_source,chart_type,filters,group_by,sort_by,sort_dir,is_public,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [tid, src.name + ' (Copy)', src.description || '', src.data_source, src.chart_type, JSON.stringify(src.filters || {}), src.group_by || '', src.sort_by || '', src.sort_dir || 'DESC', false, req.session?.user?.email || '']);
    audit('report_duplicated', { fromId: req.params.id, toId: rows[0].id }, req);
    res.redirect(`/school/reports/${rows[0].id}`);
  }));

  /* 15 ─ GET /school/reports/api/sources — Available data sources JSON */
  app.get('/school/reports/api/sources', requireAuth, (req, res) => {
    const list = Object.entries(DATA_SOURCES).map(([k, v]) => ({ key: k, label: v.label, icon: v.icon, columns: v.cols }));
    res.json({ sources: list });
  });

  /* 13 ─ POST /school/reports/:id/schedule/toggle — Pause/resume schedule */
  app.post('/school/reports/:id/schedule/toggle', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await pool.query('UPDATE report_schedules SET is_active = NOT is_active WHERE tenant_id=$1 AND report_id=$2', [tid, req.params.id]);
    audit('schedule_toggled', { reportId: req.params.id }, req);
    res.json({ ok: true });
  }));
};
