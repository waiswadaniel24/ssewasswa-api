const { migrateQuery } = require('./db');
module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const { renderPage, ah, requireAuth, audit } = opts;

  /* ───────── helpers ───────── */
  const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (a, b) => b ? ((a / b) * 100).toFixed(1) : '0.0';
  const arrow = (v) => v >= 0 ? '▲' : '▼';
  const badgeCls = (v) => v >= 0 ? 'green' : 'red';

  function svgLineChart(data, w = 700, h = 300, color = '#4f46e5') {
    if (!data.length) return `<p class="text-sm text-gray-400">No data available</p>`;
    const vals = data.map(d => d.v);
    const mx = Math.max(...vals, 1);
    const mn = Math.min(...vals, 0);
    const range = mx - mn || 1;
    const px = 60, py = 30, pw = w - px - 20, ph = h - py - 40;
    const pts = data.map((d, i) => {
      const x = px + (i / (data.length - 1 || 1)) * pw;
      const y = py + ph - ((d.v - mn) / range) * ph;
      return { x, y };
    });
    const points = pts.map(p => `${p.x},${p.y}`).join(' ');
    const areaPoints = `${px},${py + ph} ${points} ${pts[pts.length - 1].x},${py + ph}`;
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const y = py + (ph / 4) * i;
      const val = mx - (range / 4) * i;
      grid += `<line x1="${px}" y1="${y}" x2="${w - 20}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/><text x="${px - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">${fmt(val)}</text>`;
    }
    let labels = '';
    data.forEach((d, i) => {
      if (data.length <= 14 || i % Math.ceil(data.length / 12) === 0)
        labels += `<text x="${pts[i].x}" y="${h - 8}" text-anchor="middle" font-size="10" fill="#6b7280">${esc(d.l)}</text>`;
    });
    let dots = pts.map((p, i) =>
      `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${color}" stroke="#fff" stroke-width="2"><title>${esc(data[i].l)}: ${fmt(data[i].v)}</title></circle>`
    ).join('');
    const gid = color.replace('#', '');
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px">` +
      `${grid}<defs><linearGradient id="ag${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.25"/><stop offset="100%" stop-color="${color}" stop-opacity="0.02"/></linearGradient></defs>` +
      `<polygon points="${areaPoints}" fill="url(#ag${gid})"/><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}${labels}</svg>`;
  }

  function svgMultiLineChart(series, w = 720, h = 310) {
    if (!series.length || !series[0].data.length) return `<p class="text-sm text-gray-400">No data available</p>`;
    const allVals = series.flatMap(s => s.data.map(d => d.v));
    const mx = Math.max(...allVals, 1), mn = Math.min(...allVals, 0);
    const range = mx - mn || 1;
    const px = 60, py = 30, pw = w - px - 20, ph = h - py - 50;
    const len = series[0].data.length;
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const y = py + (ph / 4) * i, val = mx - (range / 4) * i;
      grid += `<line x1="${px}" y1="${y}" x2="${w - 20}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/><text x="${px - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">${fmt(val)}</text>`;
    }
    let lines = '', labelSvg = '';
    series[0].data.forEach((d, i) => {
      if (len <= 14 || i % Math.ceil(len / 12) === 0) {
        const x = px + (i / (len - 1 || 1)) * pw;
        labelSvg += `<text x="${x}" y="${h - 8}" text-anchor="middle" font-size="10" fill="#6b7280">${esc(d.l)}</text>`;
      }
    });
    series.forEach(s => {
      const pts = s.data.map((d, i) => {
        const x = px + (i / (len - 1 || 1)) * pw;
        const y = py + ph - ((d.v - mn) / range) * ph;
        return `${x},${y}`;
      }).join(' ');
      lines += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    });
    let legend = '';
    series.forEach((s, i) => {
      const lx = px + i * 120;
      legend += `<line x1="${lx}" y1="${h - 24}" x2="${lx + 18}" y2="${h - 24}" stroke="${s.color}" stroke-width="2.5"/><text x="${lx + 22}" y="${h - 20}" font-size="10" fill="#374151">${esc(s.label)}</text>`;
    });
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px">${grid}${lines}${labelSvg}${legend}</svg>`;
  }

  function svgBarChart(data, w = 700, h = 280, colors = ['#4f46e5', '#a5b4fc'], legendLabels = ['Budget', 'Actual']) {
    if (!data.length) return `<p class="text-sm text-gray-400">No data available</p>`;
    const mx = Math.max(...data.map(d => Math.max(d.v1 || 0, d.v2 || 0)), 1);
    const px = 70, py = 20, pw = w - px - 20, ph = h - py - 55;
    const barW = Math.min(36, (pw / data.length) * 0.32);
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const y = py + (ph / 4) * i, val = mx - (mx / 4) * i;
      grid += `<line x1="${px}" y1="${y}" x2="${w - 20}" y2="${y}" stroke="#e5e7eb"/><text x="${px - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">${fmt(val)}</text>`;
    }
    let bars = '', labels = '';
    data.forEach((d, i) => {
      const cx = px + (i + 0.5) * (pw / data.length);
      const h1 = (d.v1 / mx) * ph, h2 = (d.v2 / mx) * ph;
      bars += `<rect x="${cx - barW - 1}" y="${py + ph - h1}" width="${barW}" height="${h1}" rx="3" fill="${colors[0]}" opacity="0.9"><title>${esc(d.l)} ${legendLabels[0]}: ${fmt(d.v1)}</title></rect>`;
      bars += `<rect x="${cx + 1}" y="${py + ph - h2}" width="${barW}" height="${h2}" rx="3" fill="${colors[1]}" opacity="0.9"><title>${esc(d.l)} ${legendLabels[1]}: ${fmt(d.v2)}</title></rect>`;
      labels += `<text x="${cx}" y="${h - 32}" text-anchor="middle" font-size="9" fill="#6b7280">${esc(d.l)}</text>`;
    });
    const lw = w / 2;
    const legend = `<rect x="${lw - 110}" y="${h - 16}" width="10" height="10" rx="2" fill="${colors[0]}"/><text x="${lw - 96}" y="${h - 7}" font-size="10">${esc(legendLabels[0])}</text>` +
      `<rect x="${lw + 10}" y="${h - 16}" width="10" height="10" rx="2" fill="${colors[1]}"/><text x="${lw + 24}" y="${h - 7}" font-size="10">${esc(legendLabels[1])}</text>`;
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px">${grid}${bars}${labels}${legend}</svg>`;
  }

  function svgAreaChart(data, w = 700, h = 280, color = '#4f46e5') {
    if (!data.length) return `<p class="text-sm text-gray-400">No data available</p>`;
    const vals = data.map(d => d.v);
    const mx = Math.max(...vals, 1), mn = Math.min(...vals, 0);
    const range = mx - mn || 1;
    const px = 60, py = 25, pw = w - px - 20, ph = h - py - 45;
    const pts = data.map((d, i) => ({ x: px + (i / (data.length - 1 || 1)) * pw, y: py + ph - ((d.v - mn) / range) * ph }));
    const area = `M${px},${py + ph} ` + pts.map(p => `L${p.x},${p.y}`).join(' ') + ` L${pts[pts.length - 1].x},${py + ph} Z`;
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const y = py + (ph / 4) * i, val = mx - (range / 4) * i;
      grid += `<line x1="${px}" y1="${y}" x2="${w - 20}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/><text x="${px - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">${fmt(val)}</text>`;
    }
    let labels = '';
    data.forEach((d, i) => {
      if (data.length <= 14 || i % Math.ceil(data.length / 12) === 0)
        labels += `<text x="${pts[i].x}" y="${h - 8}" text-anchor="middle" font-size="10" fill="#6b7280">${esc(d.l)}</text>`;
    });
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px">${grid}<defs><linearGradient id="aFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.4"/><stop offset="100%" stop-color="${color}" stop-opacity="0.05"/></linearGradient></defs><path d="${area}" fill="url(#aFill)"/>` +
      `<polyline points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"/>${labels}</svg>`;
  }

  function simpleMA(data, window = 3) {
    return data.map((_, i, a) => {
      const start = Math.max(0, i - window + 1);
      const slice = a.slice(start, i + 1);
      return { l: a[i].l, v: slice.reduce((s, d) => s + d.v, 0) / slice.length };
    });
  }

  function projectForward(data, months = 6) {
    if (data.length < 2) return [...data];
    const avgGrowth = data.slice(1).reduce((s, d, i) => s + (d.v - data[i].v) / (data[i].v || 1), 0) / (data.length - 1);
    const last = data[data.length - 1];
    const projected = [...data];
    for (let i = 1; i <= months; i++) {
      projected.push({ l: `+${i}m`, v: Math.round(last.v * (1 + avgGrowth * i) * 100) / 100 });
    }
    return projected;
  }

  function quarterLabel(m) { return m <= 3 ? 'Q1' : m <= 6 ? 'Q2' : m <= 9 ? 'Q3' : 'Q4'; }

  /* ───────── common styles ───────── */
  const CSS = `
    .fc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1rem}
    .fc-card{background:#fff;border:1px solid #e5e7eb;border-radius:.75rem;padding:1.25rem;box-shadow:0 1px 3px rgba(0,0,0,.06)}
    .fc-card h3{font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:.25rem}
    .fc-card .val{font-size:1.75rem;font-weight:700;color:#111827}
    .fc-card .sub{font-size:.8rem;color:#6b7280;margin-top:.15rem}
    .fc-badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:.7rem;font-weight:600}
    .fc-badge.green{background:#d1fae5;color:#065f46}
    .fc-badge.red{background:#fee2e2;color:#991b1b}
    .fc-badge.amber{background:#fef3c7;color:#92400e}
    .fc-badge.blue{background:#dbeafe;color:#1e40af}
    .fc-table{width:100%;border-collapse:collapse;font-size:.85rem}
    .fc-table th{text-align:left;padding:.6rem .75rem;background:#f9fafb;border-bottom:2px solid #e5e7eb;font-weight:600;color:#374151;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}
    .fc-table td{padding:.55rem .75rem;border-bottom:1px solid #f3f4f6;color:#374151}
    .fc-table tr:hover td{background:#f8faff}
    .nav-tabs{display:flex;gap:.25rem;border-bottom:2px solid #e5e7eb;padding:0 1rem;overflow-x:auto}
    .nav-tabs a{padding:.6rem 1rem;font-size:.82rem;font-weight:500;color:#6b7280;text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-2px;white-space:nowrap;transition:all .15s}
    .nav-tabs a:hover,.nav-tabs a.active{color:#4f46e5;border-bottom-color:#4f46e5}
    .chart-wrap{background:#fff;border:1px solid #e5e7eb;border-radius:.75rem;padding:1.25rem;margin:1rem 0}
    .section-title{font-size:1.1rem;font-weight:700;color:#111827;margin:1.5rem 0 .5rem}
    .two-col{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
    @media(max-width:640px){.fc-grid{grid-template-columns:1fr 1fr}.fc-card .val{font-size:1.3rem}.two-col{grid-template-columns:1fr}}`;

  const TABS = (active) => `
    <div class="nav-tabs">
      <a href="/school/forecast"${active === 'dashboard' ? ' class="active"' : ''}>📊 Dashboard</a>
      <a href="/school/forecast/revenue"${active === 'revenue' ? ' class="active"' : ''}>💰 Revenue</a>
      <a href="/school/forecast/expenses"${active === 'expenses' ? ' class="active"' : ''}>📉 Expenses</a>
      <a href="/school/forecast/cashflow"${active === 'cashflow' ? ' class="active"' : ''}>🏦 Cash Flow</a>
      <a href="/school/forecast/budget"${active === 'budget' ? ' class="active"' : ''}>📋 Budget</a>
      <a href="/school/forecast/fee-collection"${active === 'fee' ? ' class="active"' : ''}>🎓 Fees</a>
      <a href="/school/forecast/payroll"${active === 'payroll' ? ' class="active"' : ''}>👥 Payroll</a>
      <a href="/school/forecast/profitability"${active === 'profit' ? ' class="active"' : ''}>📈 Profit</a>
      <a href="/school/forecast/ar-aging"${active === 'ar' ? ' class="active"' : ''}>📋 A/R Aging</a>
      <a href="/school/forecast/scenarios"${active === 'scenarios' ? ' class="active"' : ''}>🔮 Scenarios</a>
      <a href="/school/forecast/export/csv"${active === 'export' ? ' class="active"' : ''}>⬇ Export</a>
    </div>`;

  /* ───────── seed sample data ───────── */
  async function ensureData(tid) {
    const cnt = await pool.query('SELECT COUNT(*) FROM financial_snapshots WHERE tenant_id=$1', [tid]);
    if (Number(cnt.rows[0].count) > 0) return;
    let base = 180000;
    for (let m = 0; m < 12; m++) {
      base += Math.round((Math.random() - 0.3) * 8000);
      const rev = base, exp = Math.round(rev * (0.72 + Math.random() * 0.1));
      const fee = Math.round(rev * 0.6), outstanding = Math.round(fee * (0.08 + Math.random() * 0.12));
      await pool.query(
        `INSERT INTO financial_snapshots (tenant_id,snapshot_date,total_revenue,total_expenses,net_income,fee_collected,fee_outstanding,payroll_cost) VALUES ($1,($2||'-01')::DATE,$3,$4,$5,$6,$7,$8)`,
        [tid, `2025-${String(m + 1).padStart(2, '0')}`, rev, exp, rev - exp, fee, outstanding, Math.round(exp * 0.45)]
      );
    }
    const depts = ['Academics', 'Administration', 'Operations', 'IT', 'Sports'];
    const cats = ['Salaries', 'Supplies', 'Maintenance', 'Utilities', 'Professional Dev'];
    for (const d of depts) {
      for (let m = 1; m <= 12; m++) {
        for (const c of cats) {
          const b = Math.round((Math.random() * 30000) + 5000);
          const a = Math.round(b * (0.85 + Math.random() * 0.35));
          await pool.query(
            `INSERT INTO budget_items (tenant_id,department,category,budgeted_amount,actual_amount,variance,fiscal_year,month) VALUES ($1,$2,$3,$4,$5,$6,'2025',$7)`,
            [tid, d, c, b, a, b - a, m]
          );
        }
      }
    }
  }

  /* ───────── auto-create tables ───────── */
  async function init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS financial_snapshots (
      id SERIAL PRIMARY KEY, tenant_id INT, snapshot_date DATE,
      total_revenue NUMERIC(14,2), total_expenses NUMERIC(14,2), net_income NUMERIC(14,2),
      fee_collected NUMERIC(14,2), fee_outstanding NUMERIC(14,2),
      payroll_cost NUMERIC(14,2), created_at TIMESTAMPTZ DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS financial_forecasts (
      id SERIAL PRIMARY KEY, tenant_id INT, forecast_type VARCHAR(50), period VARCHAR(20),
      projected_revenue NUMERIC(14,2), projected_expenses NUMERIC(14,2),
      confidence VARCHAR(20) DEFAULT 'medium', scenario_name VARCHAR(100),
      assumptions JSONB, created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS budget_items (
      id SERIAL PRIMARY KEY, tenant_id INT, department VARCHAR(100), category VARCHAR(100),
      budgeted_amount NUMERIC(14,2), actual_amount NUMERIC(14,2),
      variance NUMERIC(14,2), fiscal_year VARCHAR(10), month INT, created_at TIMESTAMPTZ DEFAULT NOW())`);
  }
  init().catch(console.error);

  /* ───────── 1. DASHBOARD ───────── */
  app.get('/school/forecast', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await ensureData(tid);
    const { rows: snap } = await pool.query('SELECT * FROM financial_snapshots WHERE tenant_id=$1 ORDER BY snapshot_date', [tid]);
    const latest = snap[snap.length - 1] || {};
    const prev = snap[snap.length - 2] || {};
    const revChg = ((latest.total_revenue - prev.total_revenue) / (prev.total_revenue || 1) * 100).toFixed(1);
    const expChg = ((latest.total_expenses - prev.total_expenses) / (prev.total_expenses || 1) * 100).toFixed(1);
    const totRev = snap.reduce((s, r) => s + Number(r.total_revenue), 0);
    const totExp = snap.reduce((s, r) => s + Number(r.total_expenses), 0);
    const netIncome = totRev - totExp;
    const healthPct = totRev ? ((totRev - totExp) / totRev * 100).toFixed(1) : 0;
    const avgRev = snap.length ? totRev / snap.length : 0;
    const totFee = snap.reduce((s, r) => s + Number(r.fee_collected), 0);
    const totOut = snap.reduce((s, r) => s + Number(r.fee_outstanding), 0);
    const totPay = snap.reduce((s, r) => s + Number(r.payroll_cost), 0);
    const revData = snap.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: Number(r.total_revenue) }));
    const expData = snap.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: Number(r.total_expenses) }));
    const incData = snap.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: Number(r.net_income) }));
    const projRev = projectForward(revData, 6);
    const maData = simpleMA(revData, 3);

    /* quarterly summary */
    const quarters = {};
    snap.forEach(r => {
      const m = r.snapshot_date.getMonth() + 1, q = quarterLabel(m);
      if (!quarters[q]) quarters[q] = { rev: 0, exp: 0 };
      quarters[q].rev += Number(r.total_revenue);
      quarters[q].exp += Number(r.total_expenses);
    });

    let html = `<style>${CSS}</style>${TABS('dashboard')}`;
    html += `<div style="padding:1rem;max-width:1200px;margin:0 auto">`;
    html += `<h2 style="font-size:1.4rem;font-weight:800;margin:.75rem 0 .25rem">📊 Financial Health Dashboard</h2>
      <p style="color:#6b7280;font-size:.85rem;margin-bottom:1rem">Real-time overview of your school's financial performance</p>`;
    html += `<div class="fc-grid">
      <div class="fc-card"><h3>Total Revenue (YTD)</h3><div class="val">$${fmt(totRev)}</div><div class="sub"><span class="fc-badge ${badgeCls(revChg)}">${arrow(revChg)} ${Math.abs(revChg)}%</span> vs prior month</div></div>
      <div class="fc-card"><h3>Total Expenses (YTD)</h3><div class="val">$${fmt(totExp)}</div><div class="sub"><span class="fc-badge ${badgeCls(-expChg)}">${arrow(expChg)} ${Math.abs(expChg)}%</span> vs prior month</div></div>
      <div class="fc-card"><h3>Net Income (YTD)</h3><div class="val" style="color:${netIncome >= 0 ? '#059669' : '#dc2626'}">$${fmt(netIncome)}</div><div class="sub">Margin: ${healthPct}%</div></div>
      <div class="fc-card"><h3>Monthly Avg Revenue</h3><div class="val">$${fmt(avgRev)}</div><div class="sub">Run rate: $${fmt(avgRev * 12)}</div></div>
      <div class="fc-card"><h3>Fee Outstanding</h3><div class="val" style="color:#d97706">$${fmt(latest.fee_outstanding)}</div><div class="sub">Collected: $${fmt(latest.fee_collected)}</div></div>
      <div class="fc-card"><h3>Payroll Cost</h3><div class="val">$${fmt(latest.payroll_cost)}</div><div class="sub">${pct(latest.payroll_cost, latest.total_expenses)}% of expenses</div></div>
      <div class="fc-card"><h3>Collection Rate</h3><div class="val">${pct(totFee, totFee + totOut)}%</div><div class="sub">Target: 90%</div></div>
      <div class="fc-card"><h3>Health Score</h3><div class="val" style="color:${Number(healthPct) > 20 ? '#059669' : Number(healthPct) > 10 ? '#d97706' : '#dc2626'}">${healthPct}%</div><div class="sub">Revenue surplus margin</div></div>
    </div>`;

    html += `<div class="section-title">Revenue, Expenses & Net Income</div>`;
    html += `<div class="chart-wrap">${svgMultiLineChart([
      { label: 'Revenue', color: '#4f46e5', data: revData },
      { label: 'Expenses', color: '#dc2626', data: expData },
      { label: 'Net Income', color: '#059669', data: incData }
    ])}</div>`;

    html += `<div class="section-title">Revenue Projection (6-Month Forecast)</div>`;
    html += `<div class="chart-wrap">${svgAreaChart(projRev, 720, 280, '#7c3aed')}</div>`;
    html += `<div class="section-title">3-Month Moving Average (Smoothed Revenue)</div>`;
    html += `<div class="chart-wrap">${svgLineChart(maData, 720, 260, '#0891b2')}</div>`;

    html += `<div class="section-title">Quarterly Summary</div>`;
    html += `<div class="two-col"><div class="fc-card"><h3>By Quarter</h3><table class="fc-table"><tr><th>Quarter</th><th>Revenue</th><th>Expenses</th><th>Net</th><th>Margin</th></tr>`;
    Object.entries(quarters).forEach(([q, d]) => {
      const ni = d.rev - d.exp, mg = pct(ni, d.rev);
      html += `<tr><td><strong>${q}</strong></td><td>$${fmt(d.rev)}</td><td>$${fmt(d.exp)}</td><td style="color:${ni >= 0 ? '#059669' : '#dc2626'}">$${fmt(ni)}</td><td>${mg}%</td></tr>`;
    });
    html += `</table></div>`;
    html += `<div class="fc-card"><h3>Key Metrics</h3><ul style="font-size:.85rem;color:#374151;padding-left:1.2rem;margin:.5rem 0">
      <li>YTD Revenue: <strong>$${fmt(totRev)}</strong></li>
      <li>YTD Expenses: <strong>$${fmt(totExp)}</strong></li>
      <li>YTD Net Income: <strong style="color:${netIncome >= 0 ? '#059669' : '#dc2626'}">$${fmt(netIncome)}</strong></li>
      <li>Total Fees Collected: <strong>$${fmt(totFee)}</strong></li>
      <li>Total Fees Outstanding: <strong style="color:#d97706">$${fmt(totOut)}</strong></li>
      <li>Total Payroll: <strong>$${fmt(totPay)}</strong> (${pct(totPay, totExp)}% of expenses)</li>
      <li>Annual Run Rate: <strong>$${fmt(avgRev * 12)}</strong></li>
    </ul></div></div>`;
    html += `</div>`;
    renderPage(req, res, 'Financial Forecast', html);
  }));

  /* ───────── 2. REVENUE ───────── */
  app.get('/school/forecast/revenue', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await ensureData(tid);
    const { rows } = await pool.query('SELECT * FROM financial_snapshots WHERE tenant_id=$1 ORDER BY snapshot_date', [tid]);
    const revData = rows.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: Number(r.total_revenue) }));
    const feeData = rows.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: Number(r.fee_collected) }));
    const maRev = simpleMA(revData, 3);
    const projRev = projectForward(revData, 6);
    const totRev = rows.reduce((s, r) => s + Number(r.total_revenue), 0);
    const avgRev = rows.length ? totRev / rows.length : 0;
    const growthRate = rows.length > 1 ? ((rows[rows.length - 1].total_revenue - rows[0].total_revenue) / rows[0].total_revenue * 100).toFixed(1) : 0;
    const minRev = Math.min(...rows.map(r => Number(r.total_revenue)));
    const maxRev = Math.max(...rows.map(r => Number(r.total_revenue)));

    let html = `<style>${CSS}</style>${TABS('revenue')}`;
    html += `<div style="padding:1rem;max-width:1200px;margin:0 auto">`;
    html += `<h2 style="font-size:1.4rem;font-weight:800;margin:.75rem 0">💰 Revenue Analysis</h2>`;
    html += `<div class="fc-grid">
      <div class="fc-card"><h3>Total Revenue</h3><div class="val">$${fmt(totRev)}</div></div>
      <div class="fc-card"><h3>Monthly Average</h3><div class="val">$${fmt(avgRev)}</div></div>
      <div class="fc-card"><h3>Growth Rate</h3><div class="val" style="color:#059669">${growthRate}%</div></div>
      <div class="fc-card"><h3>Latest Month</h3><div class="val">$${fmt(rows[rows.length - 1]?.total_revenue)}</div></div>
      <div class="fc-card"><h3>Low Month</h3><div class="val">$${fmt(minRev)}</div></div>
      <div class="fc-card"><h3>High Month</h3><div class="val">$${fmt(maxRev)}</div></div>
    </div>`;
    html += `<div class="section-title">Monthly Revenue Trend</div><div class="chart-wrap">${svgLineChart(revData)}</div>`;
    html += `<div class="section-title">Fee Collection vs Total Revenue</div>`;
    html += `<div class="chart-wrap">${svgBarChart(rows.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v1: Number(r.total_revenue), v2: Number(r.fee_collected) })), 720, 280, ['#4f46e5', '#10b981'], ['Revenue', 'Fees'])}</div>`;
    html += `<div class="section-title">6-Month Revenue Projection</div><div class="chart-wrap">${svgAreaChart(projRev, 720, 280, '#7c3aed')}</div>`;
    html += `<div class="section-title">3-Month Moving Average (Smoothed)</div><div class="chart-wrap">${svgLineChart(maRev, 720, 260, '#0891b2')}</div>`;

    html += `<div class="section-title">Monthly Breakdown</div><table class="fc-table"><tr><th>Month</th><th>Revenue</th><th>Fees</th><th>Net</th><th>MoM Change</th><th>Fee Ratio</th></tr>`;
    rows.forEach((r, i) => {
      const chg = i > 0 ? ((r.total_revenue - rows[i - 1].total_revenue) / rows[i - 1].total_revenue * 100).toFixed(1) : '-';
      const fr = pct(r.fee_collected, r.total_revenue);
      html += `<tr><td>${esc(r.snapshot_date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))}</td><td>$${fmt(r.total_revenue)}</td><td>$${fmt(r.fee_collected)}</td><td style="color:${r.net_income >= 0 ? '#059669' : '#dc2626'}">$${fmt(r.net_income)}</td><td><span class="fc-badge ${Number(chg) >= 0 ? 'green' : 'red'}">${chg}%</span></td><td>${fr}%</td></tr>`;
    });
    html += `</table></div>`;
    renderPage(req, res, 'Revenue Analysis', html);
  }));

  /* ───────── 3. EXPENSES ───────── */
  app.get('/school/forecast/expenses', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await ensureData(tid);
    const { rows: snap } = await pool.query('SELECT * FROM financial_snapshots WHERE tenant_id=$1 ORDER BY snapshot_date', [tid]);
    const { rows: depts } = await pool.query('SELECT department, SUM(actual_amount) as total FROM budget_items WHERE tenant_id=$1 GROUP BY department ORDER BY total DESC', [tid]);
    const { rows: cats } = await pool.query('SELECT category, SUM(actual_amount) as total FROM budget_items WHERE tenant_id=$1 GROUP BY category ORDER BY total DESC', [tid]);
    const expData = snap.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: Number(r.total_expenses) }));
    const payrollData = snap.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: Number(r.payroll_cost) }));
    const nonPayrollData = snap.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: Number(r.total_expenses) - Number(r.payroll_cost) }));
    const totExp = snap.reduce((s, r) => s + Number(r.total_expenses), 0);
    const projExp = projectForward(expData, 6);
    const totPay = snap.reduce((s, r) => s + Number(r.payroll_cost), 0);
    const avgExp = snap.length ? totExp / snap.length : 0;
    const expGrowth = snap.length > 1 ? ((snap[snap.length - 1].total_expenses - snap[0].total_expenses) / snap[0].total_expenses * 100).toFixed(1) : 0;

    let html = `<style>${CSS}</style>${TABS('expenses')}`;
    html += `<div style="padding:1rem;max-width:1200px;margin:0 auto"><h2 style="font-size:1.4rem;font-weight:800;margin:.75rem 0">📉 Expense Analysis</h2>`;
    html += `<div class="fc-grid">
      <div class="fc-card"><h3>Total Expenses</h3><div class="val">$${fmt(totExp)}</div></div>
      <div class="fc-card"><h3>Monthly Average</h3><div class="val">$${fmt(avgExp)}</div></div>
      <div class="fc-card"><h3>Payroll Ratio</h3><div class="val">${pct(totPay, totExp)}%</div></div>
      <div class="fc-card"><h3>Expense Growth</h3><div class="val" style="color:#dc2626">${expGrowth}%</div><div class="sub">Period over period</div></div>
    </div>`;
    html += `<div class="section-title">Expense Trends: Payroll vs Non-Payroll</div>`;
    html += `<div class="chart-wrap">${svgMultiLineChart([
      { label: 'Total Expenses', color: '#dc2626', data: expData },
      { label: 'Payroll', color: '#ea580c', data: payrollData },
      { label: 'Non-Payroll', color: '#d97706', data: nonPayrollData }
    ])}</div>`;
    html += `<div class="section-title">6-Month Expense Projection</div><div class="chart-wrap">${svgAreaChart(projExp, 720, 280, '#9333ea')}</div>`;

    html += `<div class="two-col">`;
    html += `<div class="fc-card"><h3>By Department</h3><div style="max-height:320px;overflow-y:auto"><table class="fc-table"><tr><th>Department</th><th>Total</th><th>%</th></tr>`;
    depts.forEach(d => { html += `<tr><td>${esc(d.department)}</td><td>$${fmt(d.total)}</td><td>${pct(d.total, totExp)}%</td></tr>`; });
    html += `</table></div></div>`;
    html += `<div class="fc-card"><h3>By Category</h3><div style="max-height:320px;overflow-y:auto"><table class="fc-table"><tr><th>Category</th><th>Total</th><th>%</th></tr>`;
    cats.forEach(c => { html += `<tr><td>${esc(c.category)}</td><td>$${fmt(c.total)}</td><td>${pct(c.total, totExp)}%</td></tr>`; });
    html += `</table></div></div></div></div>`;
    renderPage(req, res, 'Expense Analysis', html);
  }));

  /* ───────── 4. CASH FLOW ───────── */
  app.get('/school/forecast/cashflow', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await ensureData(tid);
    const { rows } = await pool.query('SELECT * FROM financial_snapshots WHERE tenant_id=$1 ORDER BY snapshot_date', [tid]);
    let cumCash = 0;
    const cfData = rows.map(r => {
      const inflow = Number(r.fee_collected) + Number(r.total_revenue) * 0.4;
      const outflow = Number(r.total_expenses);
      cumCash += inflow - outflow;
      return { l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: inflow, v2: outflow, cum: cumCash };
    });
    const cumData = cfData.map(d => ({ l: d.l, v: d.cum }));
    const netCF = cfData.map(d => ({ l: d.l, v: d.v - d.v2 }));
    const lastCF = cfData[cfData.length - 1] || {};
    const avgInflow = cfData.reduce((s, d) => s + d.v, 0) / (cfData.length || 1);
    const avgOutflow = cfData.reduce((s, d) => s + d.v2, 0) / (cfData.length || 1);
    const projCum = projectForward(cumData, 6);

    let html = `<style>${CSS}</style>${TABS('cashflow')}`;
    html += `<div style="padding:1rem;max-width:1200px;margin:0 auto"><h2 style="font-size:1.4rem;font-weight:800;margin:.75rem 0">🏦 Cash Flow Projections</h2>`;
    html += `<div class="fc-grid">
      <div class="fc-card"><h3>Current Cash Position</h3><div class="val" style="color:${lastCF.cum >= 0 ? '#059669' : '#dc2626'}">$${fmt(lastCF.cum)}</div></div>
      <div class="fc-card"><h3>Avg Monthly Inflow</h3><div class="val" style="color:#059669">$${fmt(avgInflow)}</div></div>
      <div class="fc-card"><h3>Avg Monthly Outflow</h3><div class="val" style="color:#dc2626">$${fmt(avgOutflow)}</div></div>
      <div class="fc-card"><h3>Monthly Net Flow</h3><div class="val" style="color:${avgInflow - avgOutflow >= 0 ? '#059669' : '#dc2626'}">$${fmt(avgInflow - avgOutflow)}</div><div class="sub">${avgInflow - avgOutflow >= 0 ? 'Surplus' : 'Deficit'}</div></div>
    </div>`;
    html += `<div class="section-title">Monthly Inflow vs Outflow</div>`;
    html += `<div class="chart-wrap">${svgBarChart(cfData.map(d => ({ l: d.l, v1: d.v, v2: d.v2 })), 720, 300, ['#059669', '#dc2626'], ['Inflow', 'Outflow'])}</div>`;
    html += `<div class="section-title">Cumulative Cash Position</div>`;
    html += `<div class="chart-wrap">${svgAreaChart(cumData, 720, 280, '#4f46e5')}</div>`;
    html += `<div class="section-title">6-Month Cash Position Projection</div>`;
    html += `<div class="chart-wrap">${svgLineChart(projCum, 720, 280, '#7c3aed')}</div>`;

    html += `<table class="fc-table"><tr><th>Month</th><th>Inflow</th><th>Outflow</th><th>Net Flow</th><th>Cumulative</th></tr>`;
    cfData.forEach(d => {
      const net = d.v - d.v2;
      html += `<tr><td>${esc(d.l)}</td><td style="color:#059669">$${fmt(d.v)}</td><td style="color:#dc2626">$${fmt(d.v2)}</td><td style="color:${net >= 0 ? '#059669' : '#dc2626'}">$${fmt(net)}</td><td style="font-weight:600">$${fmt(d.cum)}</td></tr>`;
    });
    html += `</table></div>`;
    renderPage(req, res, 'Cash Flow', html);
  }));

  /* ───────── 5. BUDGET VS ACTUAL ───────── */
  app.get('/school/forecast/budget', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await ensureData(tid);
    const { rows: deptBudget } = await pool.query('SELECT department, SUM(budgeted_amount) as budgeted, SUM(actual_amount) as actual, SUM(variance) as variance FROM budget_items WHERE tenant_id=$1 GROUP BY department ORDER BY budgeted DESC', [tid]);
    const { rows: catBudget } = await pool.query('SELECT category, SUM(budgeted_amount) as budgeted, SUM(actual_amount) as actual, SUM(variance) as variance FROM budget_items WHERE tenant_id=$1 GROUP BY category ORDER BY budgeted DESC', [tid]);
    const { rows: monthBudget } = await pool.query('SELECT month, SUM(budgeted_amount) as budgeted, SUM(actual_amount) as actual FROM budget_items WHERE tenant_id=$1 GROUP BY month ORDER BY month', [tid]);
    const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const totB = deptBudget.reduce((s, d) => s + Number(d.budgeted), 0);
    const totA = deptBudget.reduce((s, d) => s + Number(d.actual), 0);
    const varPct = ((totA - totB) / totB * 100).toFixed(1);
    const underBudget = deptBudget.filter(d => d.variance >= 0).length;
    const overBudget = deptBudget.filter(d => d.variance < 0).length;

    let html = `<style>${CSS}</style>${TABS('budget')}`;
    html += `<div style="padding:1rem;max-width:1200px;margin:0 auto"><h2 style="font-size:1.4rem;font-weight:800;margin:.75rem 0">📋 Budget vs Actual</h2>`;
    html += `<div class="fc-grid">
      <div class="fc-card"><h3>Total Budgeted</h3><div class="val">$${fmt(totB)}</div></div>
      <div class="fc-card"><h3>Total Actual</h3><div class="val">$${fmt(totA)}</div></div>
      <div class="fc-card"><h3>Variance</h3><div class="val" style="color:${totB - totA >= 0 ? '#059669' : '#dc2626'}">$${fmt(totB - totA)}</div><div class="sub">${varPct}% variance</div></div>
      <div class="fc-card"><h3>Adherence</h3><div class="val"><span class="fc-badge green">${underBudget} under</span> <span class="fc-badge red">${overBudget} over</span></div><div class="sub">By department</div></div>
    </div>`;
    html += `<div class="section-title">Budget vs Actual by Month</div>`;
    html += `<div class="chart-wrap">${svgBarChart(monthBudget.map(m => ({ l: mNames[m.month - 1], v1: Number(m.budgeted), v2: Number(m.actual) })))}</div>`;
    html += `<div class="two-col">`;
    html += `<div class="fc-card"><h3>By Department</h3><div style="max-height:340px;overflow-y:auto"><table class="fc-table"><tr><th>Dept</th><th>Budget</th><th>Actual</th><th>Var</th></tr>`;
    deptBudget.forEach(d => { html += `<tr><td>${esc(d.department)}</td><td>$${fmt(d.budgeted)}</td><td>$${fmt(d.actual)}</td><td><span class="fc-badge ${d.variance >= 0 ? 'green' : 'red'}">$${fmt(d.variance)}</span></td></tr>`; });
    html += `</table></div></div>`;
    html += `<div class="fc-card"><h3>By Category</h3><div style="max-height:340px;overflow-y:auto"><table class="fc-table"><tr><th>Category</th><th>Budget</th><th>Actual</th><th>Var</th></tr>`;
    catBudget.forEach(c => { html += `<tr><td>${esc(c.category)}</td><td>$${fmt(c.budgeted)}</td><td>$${fmt(c.actual)}</td><td><span class="fc-badge ${c.variance >= 0 ? 'green' : 'red'}">$${fmt(c.variance)}</span></td></tr>`; });
    html += `</table></div></div></div></div>`;
    renderPage(req, res, 'Budget vs Actual', html);
  }));

  /* ───────── 6. FEE COLLECTION ───────── */
  app.get('/school/forecast/fee-collection', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await ensureData(tid);
    const { rows } = await pool.query('SELECT * FROM financial_snapshots WHERE tenant_id=$1 ORDER BY snapshot_date', [tid]);
    const feeData = rows.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: Number(r.fee_collected) }));
    const outData = rows.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: Number(r.fee_outstanding) }));
    const rateData = rows.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: Number(r.fee_collected) / (Number(r.fee_collected) + Number(r.fee_outstanding)) * 100 }));
    const projFee = projectForward(feeData, 6);
    const totFee = rows.reduce((s, r) => s + Number(r.fee_collected), 0);
    const totOut = rows.reduce((s, r) => s + Number(r.fee_outstanding), 0);
    const avgRate = rows.length ? rows.reduce((s, r) => s + Number(r.fee_collected) / (Number(r.fee_collected) + Number(r.fee_outstanding)) * 100, 0) / rows.length : 0;
    const minRate = Math.min(...rateData.map(d => d.v));
    const maxRate = Math.max(...rateData.map(d => d.v));

    let html = `<style>${CSS}</style>${TABS('fee')}`;
    html += `<div style="padding:1rem;max-width:1200px;margin:0 auto"><h2 style="font-size:1.4rem;font-weight:800;margin:.75rem 0">🎓 Fee Collection Forecast</h2>`;
    html += `<div class="fc-grid">
      <div class="fc-card"><h3>Total Collected</h3><div class="val" style="color:#059669">$${fmt(totFee)}</div></div>
      <div class="fc-card"><h3>Total Outstanding</h3><div class="val" style="color:#dc2626">$${fmt(totOut)}</div></div>
      <div class="fc-card"><h3>Avg Collection Rate</h3><div class="val">${avgRate.toFixed(1)}%</div><div class="sub">Target: 90% | Range: ${minRate.toFixed(0)}%-${maxRate.toFixed(0)}%</div></div>
      <div class="fc-card"><h3>Projected +6mo</h3><div class="val" style="color:#4f46e5">$${fmt(projFee[projFee.length - 1].v)}</div></div>
    </div>`;
    html += `<div class="section-title">Collected vs Outstanding</div>`;
    html += `<div class="chart-wrap">${svgBarChart(rows.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v1: Number(r.fee_collected), v2: Number(r.fee_outstanding) })), 720, 280, ['#059669', '#dc2626'], ['Collected', 'Outstanding'])}</div>`;
    html += `<div class="section-title">Collection Rate Trend (%)</div><div class="chart-wrap">${svgLineChart(rateData, 720, 260, '#0891b2')}</div>`;
    html += `<div class="section-title">6-Month Fee Projection</div><div class="chart-wrap">${svgAreaChart(projFee, 720, 280, '#7c3aed')}</div>`;

    html += `<div class="section-title">Monthly Fee Detail</div><table class="fc-table"><tr><th>Month</th><th>Collected</th><th>Outstanding</th><th>Total Due</th><th>Rate</th></tr>`;
    rows.forEach(r => {
      const total = Number(r.fee_collected) + Number(r.fee_outstanding);
      const rate = pct(r.fee_collected, total);
      html += `<tr><td>${esc(r.snapshot_date.toLocaleDateString('en-US', { month: 'long' }))}</td><td style="color:#059669">$${fmt(r.fee_collected)}</td><td style="color:#dc2626">$${fmt(r.fee_outstanding)}</td><td>$${fmt(total)}</td><td><span class="fc-badge ${Number(rate) >= 85 ? 'green' : Number(rate) >= 75 ? 'amber' : 'red'}">${rate}%</span></td></tr>`;
    });
    html += `</table></div>`;
    renderPage(req, res, 'Fee Collection', html);
  }));

  /* ───────── 7. PAYROLL ───────── */
  app.get('/school/forecast/payroll', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await ensureData(tid);
    const { rows } = await pool.query('SELECT * FROM financial_snapshots WHERE tenant_id=$1 ORDER BY snapshot_date', [tid]);
    const payData = rows.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: Number(r.payroll_cost) }));
    const ratioData = rows.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: Number(r.payroll_cost) / Number(r.total_expenses) * 100 }));
    const nonPayData = rows.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: Number(r.total_expenses) - Number(r.payroll_cost) }));
    const projPay = projectForward(payData, 6);
    const totPay = rows.reduce((s, r) => s + Number(r.payroll_cost), 0);
    const totExp = rows.reduce((s, r) => s + Number(r.total_expenses), 0);
    const avgPay = totPay / (rows.length || 1);
    const avgRatio = rows.length ? ratioData.reduce((s, d) => s + d.v, 0) / rows.length : 0;
    const payGrowth = rows.length > 1 ? ((rows[rows.length - 1].payroll_cost - rows[0].payroll_cost) / rows[0].payroll_cost * 100).toFixed(1) : 0;

    let html = `<style>${CSS}</style>${TABS('payroll')}`;
    html += `<div style="padding:1rem;max-width:1200px;margin:0 auto"><h2 style="font-size:1.4rem;font-weight:800;margin:.75rem 0">👥 Payroll Cost Projections</h2>`;
    html += `<div class="fc-grid">
      <div class="fc-card"><h3>Total Payroll (YTD)</h3><div class="val">$${fmt(totPay)}</div></div>
      <div class="fc-card"><h3>Monthly Average</h3><div class="val">$${fmt(avgPay)}</div></div>
      <div class="fc-card"><h3>Payroll / Expense</h3><div class="val">${avgRatio.toFixed(1)}%</div><div class="sub"><span class="fc-badge ${avgRatio < 50 ? 'green' : 'amber'}">${avgRatio < 50 ? 'Healthy' : 'Elevated'}</span></div></div>
      <div class="fc-card"><h3>Payroll Growth</h3><div class="val" style="color:#ea580c">${payGrowth}%</div><div class="sub">Period over period</div></div>
    </div>`;
    html += `<div class="section-title">Payroll vs Non-Payroll Expenses</div>`;
    html += `<div class="chart-wrap">${svgBarChart(rows.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v1: Number(r.payroll_cost), v2: Number(r.total_expenses) - Number(r.payroll_cost) })), 720, 300, ['#ea580c', '#d97706'], ['Payroll', 'Non-Payroll'])}</div>`;
    html += `<div class="section-title">Payroll-to-Expense Ratio (%)</div><div class="chart-wrap">${svgLineChart(ratioData, 720, 260, '#d97706')}</div>`;
    html += `<div class="section-title">6-Month Payroll Projection</div><div class="chart-wrap">${svgAreaChart(projPay, 720, 280, '#9333ea')}</div>`;

    html += `<table class="fc-table"><tr><th>Month</th><th>Payroll</th><th>Total Exp</th><th>Non-Payroll</th><th>Ratio</th></tr>`;
    rows.forEach(r => {
      const np = Number(r.total_expenses) - Number(r.payroll_cost);
      const ratio = pct(r.payroll_cost, r.total_expenses);
      html += `<tr><td>${esc(r.snapshot_date.toLocaleDateString('en-US', { month: 'long' }))}</td><td>$${fmt(r.payroll_cost)}</td><td>$${fmt(r.total_expenses)}</td><td>$${fmt(np)}</td><td><span class="fc-badge ${Number(ratio) < 50 ? 'green' : 'amber'}">${ratio}%</span></td></tr>`;
    });
    html += `</table></div>`;
    renderPage(req, res, 'Payroll', html);
  }));

  /* ───────── 8. PROFITABILITY ───────── */
  app.get('/school/forecast/profitability', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await ensureData(tid);
    const { rows } = await pool.query('SELECT * FROM financial_snapshots WHERE tenant_id=$1 ORDER BY snapshot_date', [tid]);
    const revData = rows.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: Number(r.total_revenue) }));
    const marginData = rows.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v: Number(r.net_income) / Number(r.total_revenue) * 100 }));
    const projMargin = projectForward(marginData, 6);
    const totRev = rows.reduce((s, r) => s + Number(r.total_revenue), 0);
    const totExp = rows.reduce((s, r) => s + Number(r.total_expenses), 0);
    const netIncome = totRev - totExp;
    const avgMargin = rows.length ? rows.reduce((s, r) => s + Number(r.net_income) / Number(r.total_revenue) * 100, 0) / rows.length : 0;
    const roic = netIncome / totExp * 100;

    let html = `<style>${CSS}</style>${TABS('profit')}`;
    html += `<div style="padding:1rem;max-width:1200px;margin:0 auto"><h2 style="font-size:1.4rem;font-weight:800;margin:.75rem 0">📈 Profitability Analysis</h2>`;
    html += `<div class="fc-grid">
      <div class="fc-card"><h3>Gross Revenue</h3><div class="val">$${fmt(totRev)}</div></div>
      <div class="fc-card"><h3>Total Costs</h3><div class="val">$${fmt(totExp)}</div></div>
      <div class="fc-card"><h3>Net Income</h3><div class="val" style="color:${netIncome >= 0 ? '#059669' : '#dc2626'}">$${fmt(netIncome)}</div></div>
      <div class="fc-card"><h3>Avg Profit Margin</h3><div class="val">${avgMargin.toFixed(1)}%</div><div class="sub"><span class="fc-badge ${avgMargin > 15 ? 'green' : avgMargin > 8 ? 'amber' : 'red'}">${avgMargin > 15 ? 'Strong' : avgMargin > 8 ? 'Moderate' : 'Low'}</span></div></div>
      <div class="fc-card"><h3>Cost Efficiency</h3><div class="val">${pct(totExp, totRev)}%</div><div class="sub">Expense-to-revenue ratio</div></div>
      <div class="fc-card"><h3>ROIC Estimate</h3><div class="val">${roic.toFixed(1)}%</div><div class="sub">Return on invested cost</div></div>
    </div>`;
    html += `<div class="section-title">Revenue vs Costs</div>`;
    html += `<div class="chart-wrap">${svgBarChart(rows.map(r => ({ l: r.snapshot_date.toLocaleDateString('en-US', { month: 'short' }), v1: Number(r.total_revenue), v2: Number(r.total_expenses) })), 720, 300, ['#059669', '#dc2626'], ['Revenue', 'Costs'])}</div>`;
    html += `<div class="section-title">Profit Margin Trend (%)</div><div class="chart-wrap">${svgLineChart(marginData, 720, 260, '#4f46e5')}</div>`;
    html += `<div class="section-title">Projected Margin (6-Month)</div><div class="chart-wrap">${svgAreaChart(projMargin, 720, 280, '#7c3aed')}</div>`;

    html += `<div class="section-title">Monthly Profitability</div><table class="fc-table"><tr><th>Month</th><th>Revenue</th><th>Costs</th><th>Net Income</th><th>Margin</th><th>Status</th></tr>`;
    rows.forEach(r => {
      const m = Number(r.net_income) / Number(r.total_revenue) * 100;
      const status = m >= 15 ? 'Excellent' : m >= 8 ? 'Good' : m >= 0 ? 'Thin' : 'Loss';
      html += `<tr><td>${esc(r.snapshot_date.toLocaleDateString('en-US', { month: 'long' }))}</td><td>$${fmt(r.total_revenue)}</td><td>$${fmt(r.total_expenses)}</td><td style="color:${r.net_income >= 0 ? '#059669' : '#dc2626'};font-weight:600">$${fmt(r.net_income)}</td><td>${m.toFixed(1)}%</td><td><span class="fc-badge ${m >= 15 ? 'green' : m >= 8 ? 'blue' : m >= 0 ? 'amber' : 'red'}">${status}</span></td></tr>`;
    });
    html += `</table></div>`;
    renderPage(req, res, 'Profitability', html);
  }));

  /* ───────── 9. A/R AGING ───────── */
  app.get('/school/forecast/ar-aging', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await ensureData(tid);
    const { rows: all } = await pool.query('SELECT * FROM financial_snapshots WHERE tenant_id=$1 ORDER BY snapshot_date', [tid]);
    const snap = all[all.length - 1] || {};
    const outstanding = Number(snap.fee_outstanding) || 0;
    const aging = [
      { bucket: 'Current (0-30 days)', pct: 0.35, color: '#059669', risk: 'Low' },
      { bucket: '31-60 days', pct: 0.25, color: '#0891b2', risk: 'Low' },
      { bucket: '61-90 days', pct: 0.20, color: '#d97706', risk: 'Medium' },
      { bucket: '91-120 days', pct: 0.12, color: '#ea580c', risk: 'High' },
      { bucket: '120+ days', pct: 0.08, color: '#dc2626', risk: 'Critical' }
    ].map(a => ({ ...a, amount: outstanding * a.pct }));
    const barData = aging.map(a => ({ l: a.bucket.split(' ')[0] + '\n' + a.bucket.split(' ')[1], v: a.amount }));
    const collectible = aging.slice(0, 3).reduce((s, a) => s + a.amount, 0);
    const atRisk = aging.slice(3).reduce((s, a) => s + a.amount, 0);
    const totalFees = all.reduce((s, r) => s + Number(r.fee_outstanding), 0);
    const avgOutstanding = all.length ? totalFees / all.length : 0;
    const trend = all.length > 1 ? ((Number(snap.fee_outstanding) - Number(all[all.length - 2].fee_outstanding)) / Number(all[all.length - 2].fee_outstanding) * 100).toFixed(1) : 0;

    let html = `<style>${CSS}</style>${TABS('ar')}`;
    html += `<div style="padding:1rem;max-width:1200px;margin:0 auto"><h2 style="font-size:1.4rem;font-weight:800;margin:.75rem 0">📋 Accounts Receivable Aging</h2>`;
    html += `<div class="fc-grid">
      <div class="fc-card"><h3>Total Outstanding</h3><div class="val">$${fmt(outstanding)}</div><div class="sub"><span class="fc-badge ${badgeCls(-trend)}">${arrow(-trend)} ${Math.abs(trend)}%</span> vs prior month</div></div>
      <div class="fc-card"><h3>Collectible (0-90d)</h3><div class="val" style="color:#059669">$${fmt(collectible)}</div><div class="sub">${pct(collectible, outstanding)}% of total</div></div>
      <div class="fc-card"><h3>At Risk (90d+)</h3><div class="val" style="color:#dc2626">$${fmt(atRisk)}</div><div class="sub">${pct(atRisk, outstanding)}% of total</div></div>
      <div class="fc-card"><h3>Avg Outstanding</h3><div class="val">$${fmt(avgOutstanding)}</div></div>
    </div>`;
    html += `<div class="section-title">Aging Distribution</div><div class="chart-wrap">${svgBarChart(barData.map(d => ({ l: d.l, v1: d.v, v2: 0 })), 720, 280, ['#4f46e5', '#e5e7eb'], ['Outstanding', ''])}</div>`;
    html += `<div class="section-title">Detailed Aging Breakdown</div><table class="fc-table"><tr><th>Aging Bucket</th><th>Amount</th><th>% of Total</th><th>Risk Level</th><th>Action</th></tr>`;
    const actions = ['Monitor', 'Send reminder', 'Payment plan', 'Collections', 'Write-off review'];
    aging.forEach((a, i) => {
      html += `<tr><td><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${a.color};margin-right:6px;vertical-align:middle"></span>${esc(a.bucket)}</td><td style="font-weight:600">$${fmt(a.amount)}</td><td>${(a.pct * 100).toFixed(1)}%</td><td><span class="fc-badge ${a.risk === 'Low' ? 'green' : a.risk === 'Medium' ? 'amber' : 'red'}">${a.risk}</span></td><td>${actions[i]}</td></tr>`;
    });
    html += `</table>`;
    html += `<div class="fc-card" style="margin-top:1rem"><h3>📈 Recommendations</h3><ul style="font-size:.85rem;color:#374151;padding-left:1.2rem;margin:.5rem 0">
      <li><strong>Immediate:</strong> Send payment reminders for ${esc(aging[1].bucket)} balances ($${fmt(aging[1].amount)})</li>
      <li><strong>Short-term:</strong> Establish payment plans for ${esc(aging[2].bucket)} accounts ($${fmt(aging[2].amount)})</li>
      <li><strong>Escalation:</strong> Refer ${esc(aging[3].bucket)} accounts to collections ($${fmt(aging[3].amount)})</li>
      <li><strong>Policy:</strong> Review write-off criteria for ${esc(aging[4].bucket)} receivables ($${fmt(aging[4].amount)})</li>
      <li><strong>Prevention:</strong> Implement earlier follow-up for accounts approaching 60 days</li>
    </ul></div></div>`;
    renderPage(req, res, 'A/R Aging', html);
  }));

  /* ───────── 10. SCENARIOS ───────── */
  app.get('/school/forecast/scenarios', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await ensureData(tid);
    const { rows: saved } = await pool.query('SELECT * FROM financial_forecasts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20', [tid]);
    const { rows: snap } = await pool.query('SELECT * FROM financial_snapshots WHERE tenant_id=$1 ORDER BY snapshot_date', [tid]);
    const lastSnap = snap[snap.length - 1] || {};
    const baseRev = Number(lastSnap.total_revenue) || 0, baseExp = Number(lastSnap.total_expenses) || 0;
    const scenarios = [
      { name: 'Best Case', desc: 'Strong enrollment + cost optimization', revMult: 1.15, expMult: 0.95, conf: 'high', color: '#059669' },
      { name: 'Base Case', desc: 'Moderate growth aligned with trend', revMult: 1.05, expMult: 1.03, conf: 'medium', color: '#4f46e5' },
      { name: 'Conservative', desc: 'Flat enrollment, normal inflation', revMult: 1.00, expMult: 1.06, conf: 'medium', color: '#d97706' },
      { name: 'Worst Case', desc: 'Enrollment decline + cost increases', revMult: 0.92, expMult: 1.12, conf: 'low', color: '#dc2626' }
    ].map(s => ({
      ...s, projRev: baseRev * s.revMult, projExp: baseExp * s.expMult,
      netIncome: baseRev * s.revMult - baseExp * s.expMult,
      margin: ((baseRev * s.revMult - baseExp * s.expMult) / (baseRev * s.revMult) * 100).toFixed(1)
    }));

    let html = `<style>${CSS}</style>${TABS('scenarios')}`;
    html += `<div style="padding:1rem;max-width:1200px;margin:0 auto"><h2 style="font-size:1.4rem;font-weight:800;margin:.75rem 0">🔮 What-If Scenario Analysis</h2>`;
    html += `<p style="color:#6b7280;font-size:.85rem;margin-bottom:1rem">Model financial outcomes based on revenue and cost assumptions. Base figures: Revenue $${fmt(baseRev)} | Expenses $${fmt(baseExp)}</p>`;

    html += `<div class="section-title">Preset Scenarios</div><div class="fc-grid">`;
    scenarios.forEach(s => {
      html += `<div class="fc-card" style="border-left:4px solid ${s.color}"><h3>${esc(s.name)}</h3><div style="font-size:.75rem;color:#6b7280;margin-bottom:.4rem">${esc(s.desc)}</div><div class="val" style="font-size:1.3rem;color:${s.color}">$${fmt(s.netIncome)}</div><div class="sub">Proj Revenue: $${fmt(s.projRev)} | Proj Expenses: $${fmt(s.projExp)}<br>Margin: ${s.margin}% | Confidence: <span class="fc-badge ${s.conf === 'high' ? 'green' : s.conf === 'medium' ? 'amber' : 'red'}">${s.conf}</span></div></div>`;
    });
    html += `</div>`;

    /* scenario comparison chart */
    html += `<div class="section-title">Scenario Comparison</div>`;
    html += `<div class="chart-wrap">${svgBarChart(scenarios.map(s => ({ l: s.name.split(' ')[0], v1: s.projRev, v2: s.projExp })), 720, 300, ['#059669', '#dc2626'], ['Proj Revenue', 'Proj Expenses'])}</div>`;

    html += `<div class="section-title">Create Custom Scenario</div>`;
    html += `<form method="POST" action="/school/forecast/scenarios/create" class="fc-card" style="max-width:620px"><div style="display:grid;gap:.75rem">
      <div><label style="font-size:.8rem;font-weight:600;color:#374151">Scenario Name</label><input name="scenario_name" required placeholder="e.g. Merger Scenario" style="width:100%;padding:.5rem;border:1px solid #d1d5db;border-radius:.5rem;margin-top:.25rem"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
        <div><label style="font-size:.8rem;font-weight:600;color:#374151">Revenue Growth %</label><input name="rev_growth" type="number" step="0.1" value="5" style="width:100%;padding:.5rem;border:1px solid #d1d5db;border-radius:.5rem;margin-top:.25rem"></div>
        <div><label style="font-size:.8rem;font-weight:600;color:#374151">Expense Growth %</label><input name="exp_growth" type="number" step="0.1" value="3" style="width:100%;padding:.5rem;border:1px solid #d1d5db;border-radius:.5rem;margin-top:.25rem"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
        <div><label style="font-size:.8rem;font-weight:600;color:#374151">Forecast Period</label><select name="period" style="width:100%;padding:.5rem;border:1px solid #d1d5db;border-radius:.5rem;margin-top:.25rem"><option value="6-month">6 Months</option><option value="12-month" selected>12 Months</option><option value="24-month">24 Months</option></select></div>
        <div><label style="font-size:.8rem;font-weight:600;color:#374151">Confidence Level</label><select name="confidence" style="width:100%;padding:.5rem;border:1px solid #d1d5db;border-radius:.5rem;margin-top:.25rem"><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select></div>
      </div>
      <button type="submit" style="background:#4f46e5;color:#fff;padding:.6rem 1.5rem;border:none;border-radius:.5rem;font-weight:600;cursor:pointer;margin-top:.5rem">💾 Save Scenario</button>
    </div></form>`;

    if (saved.length) {
      html += `<div class="section-title">Saved Scenarios (${saved.length})</div><div class="chart-wrap"><table class="fc-table"><tr><th>Name</th><th>Period</th><th>Proj Revenue</th><th>Proj Expenses</th><th>Confidence</th><th>Created By</th><th>Date</th></tr>`;
      saved.forEach(s => { html += `<tr><td>${esc(s.scenario_name)}</td><td>${esc(s.period)}</td><td>$${fmt(s.projected_revenue)}</td><td>$${fmt(s.projected_expenses)}</td><td><span class="fc-badge ${s.confidence === 'high' ? 'green' : s.confidence === 'medium' ? 'amber' : 'red'}">${s.confidence}</span></td><td>${esc(s.created_by || '-')}</td><td>${esc(s.created_at?.toLocaleDateString())}</td></tr>`; });
      html += `</table></div>`;
    }
    html += `</div>`;
    renderPage(req, res, 'Scenarios', html);
  }));

  /* ───────── 11. CREATE SCENARIO ───────── */
  app.post('/school/forecast/scenarios/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { scenario_name, rev_growth, exp_growth, period, confidence } = req.body;
    const { rows: snap } = await pool.query('SELECT * FROM financial_snapshots WHERE tenant_id=$1 ORDER BY snapshot_date DESC LIMIT 1', [tid]);
    const last = snap[0] || {};
    const revGrowth = parseFloat(rev_growth) / 100 || 0.05;
    const expGrowth = parseFloat(exp_growth) / 100 || 0.03;
    const months = period === '24-month' ? 24 : period === '6-month' ? 6 : 12;
    const projRev = Number(last.total_revenue || 0) * (1 + revGrowth * months);
    const projExp = Number(last.total_expenses || 0) * (1 + expGrowth * months);
    await pool.query(
      `INSERT INTO financial_forecasts (tenant_id,forecast_type,period,projected_revenue,projected_expenses,confidence,scenario_name,assumptions,created_by) VALUES ($1,'scenario',$2,$3,$4,$5,$6,$7,$8)`,
      [tid, period, projRev, projExp, confidence || 'medium', scenario_name, JSON.stringify({ revGrowth, expGrowth, months, baseRev: last.total_revenue, baseExp: last.total_expenses }), req.session?.user?.email || 'system']
    );
    audit?.(req, 'forecast_scenario_create', { scenario_name, period, revGrowth, expGrowth });
    res.redirect('/school/forecast/scenarios');
  }));

  /* ───────── 12. EXPORT CSV ───────── */
  app.get('/school/forecast/export/csv', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await ensureData(tid);
    const { rows: snap } = await pool.query('SELECT * FROM financial_snapshots WHERE tenant_id=$1 ORDER BY snapshot_date', [tid]);
    const { rows: budget } = await pool.query('SELECT * FROM budget_items WHERE tenant_id=$1 ORDER BY department, month', [tid]);
    const { rows: forecasts } = await pool.query('SELECT * FROM financial_forecasts WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);

    let csv = 'FINANCIAL FORECAST EXPORT\n';
    csv += `Generated: ${new Date().toISOString()}\n`;
    csv += `Tenant: ${tid}\n\n`;

    csv += '=== FINANCIAL SNAPSHOTS ===\nDate,Revenue,Expenses,Net Income,Fees Collected,Fees Outstanding,Payroll Cost\n';
    snap.forEach(r => {
      csv += `${r.snapshot_date.toISOString().split('T')[0]},${r.total_revenue},${r.total_expenses},${r.net_income},${r.fee_collected},${r.fee_outstanding},${r.payroll_cost}\n`;
    });
    const totRev = snap.reduce((s, r) => s + Number(r.total_revenue), 0);
    const totExp = snap.reduce((s, r) => s + Number(r.total_expenses), 0);
    csv += `TOTAL,${totRev.toFixed(2)},${totExp.toFixed(2)},${(totRev - totExp).toFixed(2)}\n\n`;

    csv += '=== BUDGET ITEMS ===\nDepartment,Category,Budgeted,Actual,Variance,Fiscal Year,Month\n';
    budget.forEach(r => {
      csv += `"${r.department}","${r.category}",${r.budgeted_amount},${r.actual_amount},${r.variance},${r.fiscal_year},${r.month}\n`;
    });
    const totB = budget.reduce((s, r) => s + Number(r.budgeted_amount), 0);
    const totA = budget.reduce((s, r) => s + Number(r.actual_amount), 0);
    csv += `TOTAL,"-","${totB.toFixed(2)}","${totA.toFixed(2)}","${(totB - totA).toFixed(2)}\n\n`;

    csv += '=== SAVED FORECASTS ===\nType,Period,Projected Revenue,Projected Expenses,Confidence,Scenario,Assumptions,Created By,Created At\n';
    forecasts.forEach(r => {
      csv += `${r.forecast_type},${r.period},${r.projected_revenue},${r.projected_expenses},${r.confidence},"${r.scenario_name || ''}","${(r.assumptions || {}).toString?.() || ''}","${r.created_by || ''}","${r.created_at?.toISOString()}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="financial-forecast-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
    audit?.(req, 'forecast_csv_export', { snapCount: snap.length, budgetCount: budget.length, forecastCount: forecasts.length });
  }));
};
