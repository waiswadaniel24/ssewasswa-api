/**
 * University Application Tracker
 * Track university applications, requirements, deadlines, offers, scholarships, and documents.
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const C = '#4f46e5';
  const STATUSES = ['researching','applied','waiting','accepted','rejected','waitlisted','enrolled'];
  const STATUS_LABELS = {researching:'Researching',applied:'Applied',waiting:'Waiting',accepted:'Accepted',rejected:'Rejected',waitlisted:'Waitlisted',enrolled:'Enrolled'};
  const STATUS_COLORS = {researching:'#6b7280',applied:'#3b82f6',waiting:'#f59e0b',accepted:'#10b981',rejected:'#ef4444',waitlisted:'#8b5cf6',enrolled:'#4f46e5'};
  const REQ_TYPES = ['transcript','recommendation_letters','personal_statement','test_scores','portfolio','application_fee'];
  const REQ_LABELS = {transcript:'Official Transcript',recommendation_letters:'Recommendation Letters',personal_statement:'Personal Statement',test_scores:'Test Scores',portfolio:'Portfolio',application_fee:'Application Fee'};

  /* ── Table Creation ── */
  (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS university_applications (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1,
        student_id INTEGER NOT NULL, university_name TEXT NOT NULL,
        program TEXT NOT NULL DEFAULT '', degree TEXT NOT NULL DEFAULT '',
        deadline DATE, status TEXT NOT NULL DEFAULT 'researching',
        country TEXT NOT NULL DEFAULT 'USA', requirements_progress INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await migrateQuery(pool, 'UniversityTracker', `
      CREATE TABLE IF NOT EXISTS app_requirements (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1,
        application_id INTEGER NOT NULL REFERENCES university_applications(id) ON DELETE CASCADE,
        requirement_type TEXT NOT NULL, completed BOOLEAN NOT NULL DEFAULT false,
        completed_at TIMESTAMPTZ, notes TEXT NOT NULL DEFAULT ''
      )`);
    await migrateQuery(pool, 'UniversityTracker', `
      CREATE TABLE IF NOT EXISTS university_offers (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1,
        application_id INTEGER NOT NULL REFERENCES university_applications(id) ON DELETE CASCADE,
        offer_details TEXT NOT NULL DEFAULT '', scholarship_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        response_deadline DATE, enrollment_decision TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await migrateQuery(pool, 'UniversityTracker', `
      CREATE TABLE IF NOT EXISTS scholarship_applications_uni (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1,
        student_id INTEGER NOT NULL, scholarship_name TEXT NOT NULL,
        university_name TEXT NOT NULL DEFAULT '', amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        deadline DATE, status TEXT NOT NULL DEFAULT 'researching',
        notes TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
  })();

  /* ── SVG Chart Helpers ── */
  function svgDonut(data, w=220, h=220) {
    const total = data.reduce((s,d) => s + d.value, 0);
    if (total === 0) return `<svg width="${w}" height="${h}" role="img" aria-label="No data"><text x="${w/2}" y="${h/2}" text-anchor="middle" fill="#9ca3af" font-size="14">No data</text></svg>`;
    const cx = w/2, cy = h/2, r = 80, sw = 30;
    const circ = 2 * Math.PI * r;
    let offset = 0;
    let arcs = '';
    let legend = '';
    data.forEach(d => {
      const pct = d.value / total;
      if (pct <= 0) return;
      const dash = pct * circ;
      const gap = circ - dash;
      arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.color}" stroke-width="${sw}" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${-offset}" />`;
      offset += dash;
      legend += `<span style="display:inline-flex;align-items:center;gap:4px;margin:3px 8px 3px 0;font-size:12px;color:#374151;"><span style="width:10px;height:10px;border-radius:50%;background:${d.color};display:inline-block;"></span>${esc(d.label)} (${d.value})</span>`;
    });
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Applications by status">${arcs}<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="22" font-weight="bold" fill="#111827">${total}</text><text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="#6b7280">Total</text></svg><div style="display:flex;flex-wrap:wrap;margin-top:8px;">${legend}</div>`;
  }

  function svgBar(data, w=400, h=220) {
    if (!data.length) return `<svg width="${w}" height="${h}" role="img" aria-label="No data"><text x="${w/2}" y="${h/2}" text-anchor="middle" fill="#9ca3af" font-size="14">No data</text></svg>`;
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const barW = Math.min(40, (w - 60) / data.length - 8);
    const chartH = h - 50;
    let bars = '';
    let labels = '';
    data.forEach((d, i) => {
      const x = 40 + i * ((w - 60) / data.length);
      const barH = (d.value / maxVal) * (chartH - 20);
      const y = chartH - barH;
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${d.color || C}" opacity="0.85"><title>${esc(d.label)}: ${d.value}</title></rect>`;
      bars += `<text x="${x + barW/2}" y="${y - 4}" text-anchor="middle" font-size="11" fill="#374151">${d.value}</text>`;
      labels += `<text x="${x + barW/2}" y="${h - 8}" text-anchor="end" transform="rotate(-35,${x + barW/2},${h - 8})" font-size="10" fill="#6b7280">${esc(d.label.length > 12 ? d.label.slice(0,11) + '…' : d.label)}</text>`;
    });
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Bar chart"><line x1="40" y1="${chartH}" x2="${w}" y2="${chartH}" stroke="#e5e7eb" stroke-width="1"/>${bars}${labels}</svg>`;
  }

  function svgGauge(pct, label='', w=200, h=120) {
    const cx = w/2, cy = h - 20, r = 70;
    const startAngle = Math.PI, endAngle = 2 * Math.PI;
    const valAngle = startAngle + (Math.min(pct,100) / 100) * Math.PI;
    const arcPath = (a1, a2) => {
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      const large = (a2 - a1 > Math.PI) ? 1 : 0;
      return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
    };
    const bg = `<path d="${arcPath(startAngle, endAngle)}" fill="none" stroke="#e5e7eb" stroke-width="14" stroke-linecap="round"/>`;
    const gaugeColor = pct >= 50 ? '#10b981' : pct >= 25 ? '#f59e0b' : '#ef4444';
    const fg = `<path d="${arcPath(startAngle, valAngle)}" fill="none" stroke="${gaugeColor}" stroke-width="14" stroke-linecap="round"/>`;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label} ${pct.toFixed(1)}%">${bg}${fg}<text x="${cx}" y="${cy - 12}" text-anchor="middle" font-size="26" font-weight="bold" fill="#111827">${pct.toFixed(1)}%</text><text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="11" fill="#6b7280">${esc(label)}</text></svg>`;
  }

  function deadlineColor(dl) {
    if (!dl) return '#6b7280';
    const now = new Date(), d = new Date(dl);
    const diff = (d - now) / (1000 * 60 * 60 * 24);
    if (diff < 0) return '#ef4444';
    if (diff <= 7) return '#f59e0b';
    return '#10b981';
  }

  /* ── Main Dashboard ── */
  app.get('/university-tracker', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const uid = req.session.user.id;
    const { rows: apps } = await pool.query(
      'SELECT * FROM university_applications WHERE tenant_id=$1 AND student_id=$2 ORDER BY deadline NULLS LAST, created_at DESC', [tid, uid]);
    const { rows: schols } = await pool.query(
      'SELECT * FROM scholarship_applications_uni WHERE tenant_id=$1 AND student_id=$2 ORDER BY deadline NULLS LAST', [tid, uid]);
    const totalApps = apps.length;
    const accepted = apps.filter(a => a.status === 'accepted').length;
    const pending = apps.filter(a => ['applied','waiting','waitlisted'].includes(a.status)).length;
    const upcoming = apps.filter(a => a.deadline && new Date(a.deadline) >= new Date() && !['accepted','rejected','enrolled'].includes(a.status));
    upcoming.sort((a,b) => new Date(a.deadline) - new Date(b.deadline));
    const urgent = upcoming.slice(0, 5);
    const html = `
      <div style="max-width:1200px;margin:0 auto;padding:20px;">
        <h1 style="font-size:24px;font-weight:700;color:#111827;margin-bottom:4px;">University Application Tracker</h1>
        <p style="color:#6b7280;margin-bottom:20px;">Track and manage your university applications, deadlines, and offers.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px;">
          ${statCard('Total Applications', totalApps, C)}
          ${statCard('Accepted', accepted, '#10b981')}
          ${statCard('Pending', pending, '#f59e0b')}
          ${statCard('Scholarships', schols.length, '#8b5cf6')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
            <h2 style="font-size:16px;font-weight:600;color:#111827;margin-bottom:12px;">Upcoming Deadlines</h2>
            ${urgent.length ? urgent.map(a => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;">
              <div><div style="font-weight:500;color:#111827;">${esc(a.university_name)}</div><div style="font-size:12px;color:#6b7280;">${esc(a.program)} — ${esc(a.degree)}</div></div>
              <span style="background:${deadlineColor(a.deadline)};color:#fff;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:500;">${a.deadline ? new Date(a.deadline).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : 'N/A'}</span>
            </div>`).join('') : '<p style="color:#9ca3af;font-size:14px;">No upcoming deadlines.</p>'}
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
            <h2 style="font-size:16px;font-weight:600;color:#111827;margin-bottom:12px;">Recent Applications</h2>
            ${apps.slice(0, 5).map(a => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;">
              <div><div style="font-weight:500;color:#111827;">${esc(a.university_name)}</div><div style="font-size:12px;color:#6b7280;">${esc(a.program)}</div></div>
              <span style="color:${STATUS_COLORS[a.status]};font-size:12px;font-weight:500;">${STATUS_LABELS[a.status] || a.status}</span>
            </div>`).join('') || '<p style="color:#9ca3af;font-size:14px;">No applications yet.</p>'}
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <a href="/university-tracker/applications" style="background:${C};color:#fff;padding:8px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">Manage Applications</a>
          <a href="/university-tracker/calendar" style="background:#fff;color:${C};border:1px solid ${C};padding:8px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">Deadline Calendar</a>
          <a href="/university-tracker/offers" style="background:#fff;color:${C};border:1px solid ${C};padding:8px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">Acceptance Dashboard</a>
          <a href="/university-tracker/statistics" style="background:#fff;color:${C};border:1px solid ${C};padding:8px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">Statistics</a>
          <a href="/university-tracker/scholarships" style="background:#fff;color:${C};border:1px solid ${C};padding:8px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">Scholarships</a>
          <a href="/university-tracker/documents" style="background:#fff;color:${C};border:1px solid ${C};padding:8px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">Document Checklist</a>
          <a href="/university-tracker/counselor" style="background:#111827;color:#fff;padding:8px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">Counselor View</a>
        </div>
      </div>`;
    res.send(renderPage('University Tracker', html, req.session.user));
  }));

  function statCard(label, value, color) {
    return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
      <div style="font-size:28px;font-weight:700;color:${color};">${value}</div>
      <div style="font-size:13px;color:#6b7280;">${esc(label)}</div></div>`;
  }

  /* ── Applications CRUD ── */
  app.get('/university-tracker/applications', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const uid = req.session.user.id;
    const filter = req.query.status || '';
    let sql = 'SELECT * FROM university_applications WHERE tenant_id=$1 AND student_id=$2';
    const params = [tid, uid];
    if (filter) { sql += ' AND status=$3'; params.push(filter); }
    sql += ' ORDER BY deadline NULLS LAST, created_at DESC';
    const { rows: apps } = await pool.query(sql, params);
    const html = `
      <div style="max-width:1000px;margin:0 auto;padding:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h1 style="font-size:22px;font-weight:700;color:#111827;">My Applications</h1>
          <a href="/university-tracker/applications/new" style="background:${C};color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">+ Add Application</a>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">
          <a href="/university-tracker/applications" style="padding:5px 12px;border-radius:20px;font-size:12px;text-decoration:none;${!filter ? 'background:'+C+';color:#fff;' : 'background:#f3f4f6;color:#374151;'}">All</a>
          ${STATUSES.map(s => `<a href="/university-tracker/applications?status=${s}" style="padding:5px 12px;border-radius:20px;font-size:12px;text-decoration:none;${filter===s ? 'background:'+C+';color:#fff;' : 'background:#f3f4f6;color:#374151;'}">${STATUS_LABELS[s]}</a>`).join('')}
        </div>
        ${apps.length ? `<div style="display:flex;flex-direction:column;gap:10px;">
          ${apps.map(a => {
            const prog = a.requirements_progress || 0;
            return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div>
                  <a href="/university-tracker/applications/${a.id}" style="font-size:16px;font-weight:600;color:${C};text-decoration:none;">${esc(a.university_name)}</a>
                  <div style="font-size:13px;color:#6b7280;margin-top:2px;">${esc(a.program)} ${esc(a.degree ? '— ' + a.degree : '')} ${esc(a.country ? '(' + a.country + ')' : '')}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                  <span style="color:${STATUS_COLORS[a.status]};font-size:12px;font-weight:600;">${STATUS_LABELS[a.status]}</span>
                  ${a.deadline ? `<span style="background:${deadlineColor(a.deadline)};color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;">${new Date(a.deadline).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>` : ''}
                </div>
              </div>
              <div style="margin-top:10px;">
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#6b7280;margin-bottom:3px;">
                  <span>Requirements Progress</span><span>${prog}%</span>
                </div>
                <div style="background:#e5e7eb;border-radius:6px;height:8px;overflow:hidden;">
                  <div style="background:${C};height:100%;width:${prog}%;border-radius:6px;transition:width 0.3s;"></div>
                </div>
              </div>
              ${a.notes ? `<div style="font-size:12px;color:#6b7280;margin-top:8px;">${esc(a.notes)}</div>` : ''}
            </div>`;
          }).join('')}
        </div>` : '<div style="text-align:center;padding:40px;color:#9ca3af;">No applications found. <a href="/university-tracker/applications/new" style="color:'+C+';">Add your first application</a>.</div>'}
        <div style="margin-top:16px;"><a href="/university-tracker" style="color:${C};text-decoration:none;font-size:14px;">&larr; Back to Dashboard</a></div>
      </div>`;
    res.send(renderPage('Applications', html, req.session.user));
  }));

  /* ── New Application ── */
  app.get('/university-tracker/applications/new', requireAuth, ah(async (req, res) => {
    const html = `
      <div style="max-width:600px;margin:0 auto;padding:20px;">
        <h1 style="font-size:22px;font-weight:700;color:#111827;margin-bottom:16px;">Add New Application</h1>
        <form method="POST" action="/university-tracker/applications/new" style="display:flex;flex-direction:column;gap:14px;">
          <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">University Name *</label>
            <input name="university_name" required style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
          <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Program *</label>
            <input name="program" required style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Degree</label>
              <select name="degree" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
                <option value="">Select...</option><option>BS</option><option>BA</option><option>MS</option><option>MA</option><option>PhD</option><option>MBA</option><option>MD</option><option>JD</option><option>Other</option></select></div>
            <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Country</label>
              <input name="country" value="USA" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Deadline</label>
              <input name="deadline" type="date" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
            <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Status</label>
              <select name="status" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
                ${STATUSES.map(s => `<option value="${s}" ${s==='researching'?'selected':''}>${STATUS_LABELS[s]}</option>`).join('')}</select></div>
          </div>
          <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Notes</label>
            <textarea name="notes" rows="3" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;resize:vertical;"></textarea></div>
          <div style="display:flex;gap:8px;">
            <button type="submit" style="background:${C};color:#fff;padding:10px 20px;border:none;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;">Save Application</button>
            <a href="/university-tracker/applications" style="padding:10px 20px;border-radius:8px;font-size:14px;color:#374151;text-decoration:none;">Cancel</a>
          </div>
        </form>
      </div>`;
    res.send(renderPage('Add Application', html, req.session.user));
  }));

  app.post('/university-tracker/applications/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const uid = req.session.user.id;
    const { university_name, program, degree='', country='USA', deadline, status='researching', notes='' } = req.body;
    const { rows: [app] } = await pool.query(
      `INSERT INTO university_applications (tenant_id,student_id,university_name,program,degree,deadline,status,country,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [tid, uid, university_name, program, degree, deadline || null, status, country, notes]);
    // Create default requirement checklist
    for (const rt of REQ_TYPES) {
      await pool.query(
        'INSERT INTO app_requirements (tenant_id,application_id,requirement_type) VALUES ($1,$2,$3)', [tid, app.id, rt]);
    }
    audit('university_app:create', { applicationId: app.id, university: university_name }, req);
    res.redirect('/university-tracker/applications/' + app.id);
  }));

  /* ── View Single Application ── */
  app.get('/university-tracker/applications/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const { id } = req.params;
    const { rows: [app] } = await pool.query(
      'SELECT * FROM university_applications WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!app) return res.status(404).send('Application not found');
    const { rows: reqs } = await pool.query(
      'SELECT * FROM app_requirements WHERE application_id=$1 AND tenant_id=$2 ORDER BY id', [id, tid]);
    const completedReqs = reqs.filter(r => r.completed).length;
    const totalReqs = reqs.length || 1;
    const progressPct = Math.round((completedReqs / totalReqs) * 100);
    // Update progress
    await pool.query('UPDATE university_applications SET requirements_progress=$1 WHERE id=$2', [progressPct, id]);
    const html = `
      <div style="max-width:800px;margin:0 auto;padding:20px;">
        <a href="/university-tracker/applications" style="color:${C};text-decoration:none;font-size:14px;">&larr; All Applications</a>
        <div style="margin-top:12px;">
          <h1 style="font-size:22px;font-weight:700;color:#111827;">${esc(app.university_name)}</h1>
          <div style="display:flex;gap:12px;margin-top:6px;flex-wrap:wrap;">
            <span style="color:${STATUS_COLORS[app.status]};background:${STATUS_COLORS[app.status]}22;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:600;">${STATUS_LABELS[app.status]}</span>
            ${app.degree ? `<span style="color:#6b7280;font-size:13px;">${esc(app.degree)}</span>` : ''}
            ${app.country ? `<span style="color:#6b7280;font-size:13px;">${esc(app.country)}</span>` : ''}
          </div>
          <div style="font-size:14px;color:#374151;margin-top:4px;">${esc(app.program)}</div>
          ${app.deadline ? `<div style="font-size:13px;margin-top:4px;color:${deadlineColor(app.deadline)};">Deadline: ${new Date(app.deadline).toLocaleDateString('en-US',{weekday:'short',month:'long',day:'numeric',year:'numeric'})}</div>` : ''}
        </div>
        <div style="margin-top:20px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
          <h2 style="font-size:16px;font-weight:600;color:#111827;margin-bottom:12px;">Requirements Checklist</h2>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#6b7280;margin-bottom:4px;">
            <span>${completedReqs} of ${totalReqs} completed</span><span>${progressPct}%</span>
          </div>
          <div style="background:#e5e7eb;border-radius:6px;height:10px;overflow:hidden;margin-bottom:14px;">
            <div style="background:${C};height:100%;width:${progressPct}%;border-radius:6px;transition:width 0.3s;"></div>
          </div>
          <form method="POST" action="/university-tracker/requirements/update" style="display:flex;flex-direction:column;gap:6px;">
            ${reqs.map(r => `<label style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #f3f4f6;border-radius:8px;cursor:pointer;${r.completed ? 'background:#f0fdf4;' : ''}">
              <input type="hidden" name="req_id" value="${r.id}" />
              <input type="checkbox" name="completed_${r.id}" ${r.completed ? 'checked' : ''} onchange="this.form.submit()"
                style="width:18px;height:18px;accent-color:${C};" aria-label="${REQ_LABELS[r.requirement_type] || r.requirement_type}" />
              <span style="font-size:14px;color:#374151;font-weight:500;">${REQ_LABELS[r.requirement_type] || esc(r.requirement_type)}</span>
              ${r.completed && r.completed_at ? `<span style="font-size:11px;color:#6b7280;margin-left:auto;">Done ${new Date(r.completed_at).toLocaleDateString()}</span>` : ''}
            </label>`).join('')}
          </form>
        </div>
        ${app.notes ? `<div style="margin-top:16px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
          <h2 style="font-size:16px;font-weight:600;color:#111827;margin-bottom:8px;">Notes</h2>
          <p style="font-size:14px;color:#374151;white-space:pre-wrap;">${esc(app.notes)}</p>
        </div>` : ''}
        <div style="margin-top:16px;display:flex;gap:8px;">
          <form method="POST" action="/university-tracker/applications/${id}/delete" onsubmit="return confirm('Delete this application?')">
            <button style="background:#ef4444;color:#fff;padding:8px 16px;border:none;border-radius:8px;font-size:13px;cursor:pointer;">Delete</button>
          </form>
          <a href="/university-tracker/applications" style="padding:8px 16px;border-radius:8px;font-size:13px;color:#374151;text-decoration:none;">Back</a>
        </div>
      </div>`;
    res.send(renderPage(app.university_name, html, req.session.user));
  }));

  /* ── Update Requirements ── */
  app.post('/university-tracker/requirements/update', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const reqIds = Array.isArray(req.body.req_id) ? req.body.req_id : [req.body.req_id].filter(Boolean);
    for (const rid of reqIds) {
      const completed = req.body['completed_' + rid] === 'on';
      await pool.query(
        'UPDATE app_requirements SET completed=$1, completed_at=$2 WHERE id=$3 AND tenant_id=$4',
        [completed, completed ? new Date() : null, rid, tid]);
    }
    audit('university_req:update', { reqIds }, req);
    res.redirect('back');
  }));

  /* ── Delete Application ── */
  app.post('/university-tracker/applications/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    await pool.query('DELETE FROM university_applications WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    audit('university_app:delete', { id: req.params.id }, req);
    res.redirect('/university-tracker/applications');
  }));

  /* ── Deadline Calendar ── */
  app.get('/university-tracker/calendar', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const uid = req.session.user.id;
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const startDow = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const { rows: apps } = await pool.query(
      "SELECT * FROM university_applications WHERE tenant_id=$1 AND student_id=$2 AND deadline IS NOT NULL AND EXTRACT(MONTH FROM deadline)=$3 AND EXTRACT(YEAR FROM deadline)=$4 ORDER BY deadline",
      [tid, uid, month, year]);
    const monthName = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let cells = '';
    // Blank cells before first day
    for (let i = 0; i < startDow; i++) {
      cells += `<div style="min-height:80px;border:1px solid #f3f4f6;padding:4px;background:#fafafa;"></div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayApps = apps.filter(a => a.deadline && new Date(a.deadline).getDate() === d);
      const isToday = d === new Date().getDate() && month === new Date().getMonth() + 1 && year === new Date().getFullYear();
      let cellBg = isToday ? '#eef2ff' : '#fff';
      cells += `<div style="min-height:80px;border:1px solid ${isToday ? C+'44' : '#f3f4f6'};padding:4px;background:${cellBg};">
        <div style="font-size:12px;font-weight:${isToday ? '700' : '500'};color:${isToday ? C : '#374151'};">${d}</div>
        ${dayApps.map(a => `<a href="/university-tracker/applications/${a.id}" style="display:block;font-size:10px;padding:2px 4px;margin-top:2px;background:${deadlineColor(a.deadline)}22;color:${deadlineColor(a.deadline)};border-radius:4px;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(a.university_name)}">${esc(a.university_name)}</a>`).join('')}
      </div>`;
    }
    // Fill remaining cells
    const totalCells = startDow + daysInMonth;
    const remainder = totalCells % 7;
    if (remainder > 0) {
      for (let i = 0; i < 7 - remainder; i++) {
        cells += `<div style="min-height:80px;border:1px solid #f3f4f6;padding:4px;background:#fafafa;"></div>`;
      }
    }
    const html = `
      <div style="max-width:900px;margin:0 auto;padding:20px;">
        <a href="/university-tracker" style="color:${C};text-decoration:none;font-size:14px;">&larr; Dashboard</a>
        <h1 style="font-size:22px;font-weight:700;color:#111827;margin:12px 0 16px;">Deadline Calendar</h1>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <a href="/university-tracker/calendar?month=${prevMonth}&year=${prevYear}" style="background:#fff;border:1px solid #d1d5db;padding:6px 14px;border-radius:8px;text-decoration:none;color:#374151;font-size:14px;">&larr; Previous</a>
          <h2 style="font-size:18px;font-weight:600;color:#111827;">${esc(monthName)}</h2>
          <a href="/university-tracker/calendar?month=${nextMonth}&year=${nextYear}" style="background:#fff;border:1px solid #d1d5db;padding:6px 14px;border-radius:8px;text-decoration:none;color:#374151;font-size:14px;">Next &rarr;</a>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
          <div style="display:grid;grid-template-columns:repeat(7,1fr);">
            ${dayNames.map(d => `<div style="padding:8px;text-align:center;font-size:12px;font-weight:600;color:#6b7280;background:#f9fafb;border-bottom:1px solid #e5e7eb;">${d}</div>`).join('')}
            ${cells}
          </div>
        </div>
        <div style="display:flex;gap:16px;margin-top:12px;justify-content:center;">
          <span style="display:flex;align-items:center;gap:4px;font-size:12px;color:#6b7280;"><span style="width:12px;height:12px;border-radius:3px;background:#ef4444;display:inline-block;"></span>Past Due</span>
          <span style="display:flex;align-items:center;gap:4px;font-size:12px;color:#6b7280;"><span style="width:12px;height:12px;border-radius:3px;background:#f59e0b;display:inline-block;"></span>Within 7 Days</span>
          <span style="display:flex;align-items:center;gap:4px;font-size:12px;color:#6b7280;"><span style="width:12px;height:12px;border-radius:3px;background:#10b981;display:inline-block;"></span>More Than 7 Days</span>
        </div>
      </div>`;
    res.send(renderPage('Deadline Calendar', html, req.session.user));
  }));

  /* ── Acceptance / Offers Dashboard ── */
  app.get('/university-tracker/offers', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const uid = req.session.user.id;
    const { rows: apps } = await pool.query(
      "SELECT a.*, o.id as offer_id, o.offer_details, o.scholarship_amount, o.response_deadline, o.enrollment_decision FROM university_applications a LEFT JOIN university_offers o ON o.application_id = a.id AND o.tenant_id = a.tenant_id WHERE a.tenant_id=$1 AND a.student_id=$2 AND a.status IN ('accepted','enrolled','waitlisted') ORDER BY a.university_name",
      [tid, uid]);
    const acceptedApps = apps.filter(a => a.status === 'accepted' || a.status === 'enrolled');
    const totalScholarship = acceptedApps.reduce((s,a) => s + parseFloat(a.scholarship_amount || 0), 0);
    let comparisonRows = '';
    if (acceptedApps.length >= 2) {
      comparisonRows = `<h2 style="font-size:16px;font-weight:600;color:#111827;margin:20px 0 12px;">Side-by-Side Comparison</h2>
        <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="background:#f9fafb;">
            <th style="padding:10px;text-align:left;border:1px solid #e5e7eb;font-weight:600;color:#374151;">University</th>
            <th style="padding:10px;text-align:left;border:1px solid #e5e7eb;font-weight:600;color:#374151;">Program</th>
            <th style="padding:10px;text-align:left;border:1px solid #e5e7eb;font-weight:600;color:#374151;">Degree</th>
            <th style="padding:10px;text-align:right;border:1px solid #e5e7eb;font-weight:600;color:#374151;">Scholarship</th>
            <th style="padding:10px;text-align:left;border:1px solid #e5e7eb;font-weight:600;color:#374151;">Response Deadline</th>
            <th style="padding:10px;text-align:center;border:1px solid #e5e7eb;font-weight:600;color:#374151;">Decision</th>
          </tr></thead><tbody>
          ${acceptedApps.map(a => `<tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:10px;border:1px solid #e5e7eb;"><a href="/university-tracker/applications/${a.id}" style="color:${C};text-decoration:none;font-weight:500;">${esc(a.university_name)}</a></td>
            <td style="padding:10px;border:1px solid #e5e7eb;color:#374151;">${esc(a.program)}</td>
            <td style="padding:10px;border:1px solid #e5e7eb;color:#374151;">${esc(a.degree)}</td>
            <td style="padding:10px;border:1px solid #e5e7eb;color:#10b981;font-weight:600;text-align:right;">$${parseFloat(a.scholarship_amount||0).toLocaleString()}</td>
            <td style="padding:10px;border:1px solid #e5e7eb;color:${a.response_deadline ? deadlineColor(a.response_deadline) : '#6b7280'};">${a.response_deadline ? new Date(a.response_deadline).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'}</td>
            <td style="padding:10px;border:1px solid #e5e7eb;text-align:center;">
              <span style="color:${a.enrollment_decision==='accepted'?'#10b981':a.enrollment_decision==='declined'?'#ef4444':'#f59e0b'};font-weight:500;">${a.enrollment_decision || 'pending'}</span>
            </td>
          </tr>`).join('')}
          </tbody></table></div>`;
    }
    const html = `
      <div style="max-width:1000px;margin:0 auto;padding:20px;">
        <a href="/university-tracker" style="color:${C};text-decoration:none;font-size:14px;">&larr; Dashboard</a>
        <h1 style="font-size:22px;font-weight:700;color:#111827;margin:12px 0 16px;">Acceptance Dashboard</h1>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px;">
          ${statCard('Offers Received', acceptedApps.length, '#10b981')}
          ${statCard('Total Scholarship', '$' + totalScholarship.toLocaleString(), '#8b5cf6')}
          ${statCard('Waitlisted', apps.filter(a => a.status === 'waitlisted').length, '#f59e0b')}
        </div>
        ${acceptedApps.length ? `<div style="display:flex;flex-direction:column;gap:12px;">
          ${acceptedApps.map(a => `
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <a href="/university-tracker/applications/${a.id}" style="font-size:16px;font-weight:600;color:${C};text-decoration:none;">${esc(a.university_name)}</a>
                  <div style="font-size:13px;color:#6b7280;">${esc(a.program)} — ${esc(a.degree)}</div>
                </div>
                <span style="color:${STATUS_COLORS[a.status]};font-size:13px;font-weight:600;">${STATUS_LABELS[a.status]}</span>
              </div>
              ${a.offer_details ? `<div style="margin-top:8px;padding:10px;background:#f0fdf4;border-radius:8px;font-size:13px;color:#374151;">${esc(a.offer_details)}</div>` : ''}
              ${parseFloat(a.scholarship_amount||0) > 0 ? `<div style="margin-top:6px;font-size:14px;color:#10b981;font-weight:600;">Scholarship: $${parseFloat(a.scholarship_amount).toLocaleString()}</div>` : ''}
              ${a.response_deadline ? `<div style="margin-top:4px;font-size:12px;color:${deadlineColor(a.response_deadline)};">Respond by: ${new Date(a.response_deadline).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</div>` : ''}
              <form method="POST" action="/university-tracker/offers/update" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
                <input type="hidden" name="offer_id" value="${a.offer_id || ''}" />
                <input type="hidden" name="app_id" value="${a.id}" />
                <div><label style="font-size:11px;color:#6b7280;display:block;">Offer Details</label>
                  <textarea name="offer_details" rows="2" style="width:220px;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;box-sizing:border-box;">${esc(a.offer_details || '')}</textarea></div>
                <div><label style="font-size:11px;color:#6b7280;display:block;">Scholarship $</label>
                  <input name="scholarship_amount" type="number" step="0.01" value="${a.scholarship_amount || '0'}" style="width:100px;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;box-sizing:border-box;" /></div>
                <div><label style="font-size:11px;color:#6b7280;display:block;">Response Deadline</label>
                  <input name="response_deadline" type="date" value="${a.response_deadline || ''}" style="width:140px;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;box-sizing:border-box;" /></div>
                <div><label style="font-size:11px;color:#6b7280;display:block;">Enrollment</label>
                  <select name="enrollment_decision" style="padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;">
                    <option value="pending" ${a.enrollment_decision==='pending'||!a.enrollment_decision?'selected':''}>Pending</option>
                    <option value="accepted" ${a.enrollment_decision==='accepted'?'selected':''}>Accepted</option>
                    <option value="declined" ${a.enrollment_decision==='declined'?'selected':''}>Declined</option>
                  </select></div>
                <button type="submit" style="background:${C};color:#fff;padding:6px 14px;border:none;border-radius:6px;font-size:12px;cursor:pointer;">Update</button>
              </form>
            </div>`).join('')}
        </div>` : '<div style="text-align:center;padding:40px;color:#9ca3af;background:#fff;border:1px solid #e5e7eb;border-radius:12px;">No offers yet. Keep checking your applications!</div>'}
        ${comparisonRows}
        ${apps.filter(a => a.status === 'waitlisted').length ? `
          <h2 style="font-size:16px;font-weight:600;color:#111827;margin:20px 0 12px;">Waitlisted</h2>
          ${apps.filter(a => a.status === 'waitlisted').map(a => `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px;margin-bottom:8px;">
            <a href="/university-tracker/applications/${a.id}" style="font-weight:500;color:${C};text-decoration:none;">${esc(a.university_name)}</a>
            <span style="font-size:13px;color:#6b7280;margin-left:8px;">${esc(a.program)}</span>
          </div>`).join('')}` : ''}
      </div>`;
    res.send(renderPage('Acceptance Dashboard', html, req.session.user));
  }));

  app.post('/university-tracker/offers/update', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const { offer_id, app_id, offer_details, scholarship_amount, response_deadline, enrollment_decision } = req.body;
    if (offer_id) {
      await pool.query(
        'UPDATE university_offers SET offer_details=$1,scholarship_amount=$2,response_deadline=$3,enrollment_decision=$4 WHERE id=$5 AND tenant_id=$6',
        [offer_details, parseFloat(scholarship_amount) || 0, response_deadline || null, enrollment_decision, offer_id, tid]);
    } else {
      await pool.query(
        'INSERT INTO university_offers (tenant_id,application_id,offer_details,scholarship_amount,response_deadline,enrollment_decision) VALUES ($1,$2,$3,$4,$5,$6)',
        [tid, app_id, offer_details, parseFloat(scholarship_amount) || 0, response_deadline || null, enrollment_decision]);
    }
    if (enrollment_decision === 'accepted') {
      await pool.query('UPDATE university_applications SET status=$1 WHERE id=$2 AND tenant_id=$3', ['enrolled', app_id, tid]);
    }
    audit('university_offer:update', { offer_id, app_id }, req);
    res.redirect('/university-tracker/offers');
  }));

  /* ── Statistics ── */
  app.get('/university-tracker/statistics', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const uid = req.session.user.id;
    const { rows: apps } = await pool.query(
      'SELECT * FROM university_applications WHERE tenant_id=$1 AND student_id=$2', [tid, uid]);
    // By status
    const byStatus = STATUSES.map(s => ({ label: STATUS_LABELS[s], value: apps.filter(a => a.status === s).length, color: STATUS_COLORS[s] })).filter(d => d.value > 0);
    // By country
    const countryMap = {};
    apps.forEach(a => { countryMap[a.country] = (countryMap[a.country] || 0) + 1; });
    const countryColors = ['#4f46e5','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899'];
    const byCountry = Object.entries(countryMap).map(([k,v], i) => ({ label: k, value: v, color: countryColors[i % countryColors.length] })).sort((a,b) => b.value - a.value).slice(0, 8);
    // Acceptance rate
    const decided = apps.filter(a => ['accepted','rejected'].includes(a.status));
    const acceptedCount = apps.filter(a => a.status === 'accepted').length;
    const acceptanceRate = decided.length > 0 ? (acceptedCount / decided.length) * 100 : 0;
    // Top universities
    const uniList = apps.map(a => a.university_name);
    const uniCount = {};
    uniList.forEach(u => { uniCount[u] = (uniCount[u] || 0) + 1; });
    const topUnis = Object.entries(uniCount).sort((a,b) => b[1] - a[1]).slice(0, 10);
    const html = `
      <div style="max-width:1000px;margin:0 auto;padding:20px;">
        <a href="/university-tracker" style="color:${C};text-decoration:none;font-size:14px;">&larr; Dashboard</a>
        <h1 style="font-size:22px;font-weight:700;color:#111827;margin:12px 0 20px;">Application Statistics</h1>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center;">
            <h2 style="font-size:14px;font-weight:600;color:#374151;margin-bottom:12px;">Applications by Status</h2>
            <div style="display:flex;justify-content:center;">${svgDonut(byStatus, 200, 200)}</div>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center;">
            <h2 style="font-size:14px;font-weight:600;color:#374151;margin-bottom:12px;">Acceptance Rate</h2>
            <div style="display:flex;justify-content:center;">${svgGauge(acceptanceRate, decided.length ? acceptedCount + '/' + decided.length : 'N/A', 200, 120)}</div>
          </div>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:20px;">
          <h2 style="font-size:14px;font-weight:600;color:#374151;margin-bottom:12px;">Applications by Country</h2>
          <div style="display:flex;justify-content:center;">${svgBar(byCountry, 500, 220)}</div>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;">
          <h2 style="font-size:14px;font-weight:600;color:#374151;margin-bottom:12px;">Top Universities Applied To</h2>
          ${topUnis.length ? `<div style="display:flex;flex-direction:column;gap:8px;">
            ${topUnis.map(([name, count], i) => `<div style="display:flex;align-items:center;gap:12px;">
              <span style="font-size:14px;font-weight:700;color:${C};width:28px;text-align:center;">${i + 1}</span>
              <div style="flex:1;">
                <div style="font-size:14px;font-weight:500;color:#111827;">${esc(name)}</div>
                <div style="background:#e5e7eb;border-radius:4px;height:6px;margin-top:4px;overflow:hidden;">
                  <div style="background:${C};height:100%;width:${Math.round((count / topUnis[0][1]) * 100)}%;border-radius:4px;"></div>
                </div>
              </div>
              <span style="font-size:13px;color:#6b7280;">${count} app${count > 1 ? 's' : ''}</span>
            </div>`).join('')}
          </div>` : '<p style="color:#9ca3af;">No applications yet.</p>'}
        </div>
      </div>`;
    res.send(renderPage('Statistics', html, req.session.user));
  }));

  /* ── Counselor Dashboard ── */
  app.get('/university-tracker/counselor', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const isCounselor = req.session.user.role === 'counselor' || req.session.user.role === 'admin';
    const statusFilter = req.query.status || '';
    const uniFilter = req.query.university || '';
    let sql = 'SELECT a.*, u.name as student_name, u.email as student_email FROM university_applications a LEFT JOIN users u ON u.id = a.student_id WHERE a.tenant_id=$1';
    const params = [tid];
    if (!isCounselor) {
      sql += ' AND a.student_id=$2';
      params.push(req.session.user.id);
    }
    if (statusFilter) { sql += ` AND a.status=$${params.length + 1}`; params.push(statusFilter); }
    if (uniFilter) { sql += ` AND a.university_name ILIKE $${params.length + 1}`; params.push('%' + uniFilter + '%'); }
    sql += ' ORDER BY a.deadline NULLS LAST, a.student_name';
    const { rows: apps } = await pool.query(sql, params);
    const uniqueUnis = [...new Set(apps.map(a => a.university_name))].sort();
    const html = `
      <div style="max-width:1200px;margin:0 auto;padding:20px;">
        <a href="/university-tracker" style="color:${C};text-decoration:none;font-size:14px;">&larr; Dashboard</a>
        <h1 style="font-size:22px;font-weight:700;color:#111827;margin:12px 0 16px;">Counselor Dashboard</h1>
        <form method="GET" action="/university-tracker/counselor" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:end;">
          <div><label style="font-size:11px;color:#6b7280;display:block;">Status</label>
            <select name="status" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;">
              <option value="">All Statuses</option>
              ${STATUSES.map(s => `<option value="${s}" ${statusFilter===s?'selected':''}>${STATUS_LABELS[s]}</option>`).join('')}
            </select></div>
          <div><label style="font-size:11px;color:#6b7280;display:block;">University</label>
            <select name="university" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;">
              <option value="">All Universities</option>
              ${uniqueUnis.map(u => `<option value="${esc(u)}" ${uniFilter===u?'selected':''}>${esc(u)}</option>`).join('')}
            </select></div>
          <button type="submit" style="background:${C};color:#fff;padding:6px 16px;border:none;border-radius:8px;font-size:13px;cursor:pointer;">Filter</button>
          <a href="/university-tracker/counselor" style="padding:6px 16px;border-radius:8px;font-size:13px;color:${C};text-decoration:none;">Clear</a>
        </form>
        ${isCounselor ? '<div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#4338ca;">Viewing all student applications as counselor.</div>' : '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#92400e;">Note: Switch to counselor or admin role to view all students.</div>'}
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <thead><tr style="background:#f9fafb;">
              <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;">Student</th>
              <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;">University</th>
              <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;">Program</th>
              <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;">Degree</th>
              <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;">Deadline</th>
              <th style="padding:10px 12px;text-align:center;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;">Progress</th>
              <th style="padding:10px 12px;text-align:center;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;">Status</th>
            </tr></thead>
            <tbody>
            ${apps.map(a => `<tr style="border-bottom:1px solid #f3f4f6;">
              <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#374151;font-weight:500;">${esc(a.student_name || 'Student #' + a.student_id)}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;"><a href="/university-tracker/applications/${a.id}" style="color:${C};text-decoration:none;">${esc(a.university_name)}</a></td>
              <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#374151;">${esc(a.program)}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#374151;">${esc(a.degree)}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:${a.deadline ? deadlineColor(a.deadline) : '#6b7280'};">${a.deadline ? new Date(a.deadline).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:center;">
                <div style="display:flex;align-items:center;gap:6px;">
                  <div style="flex:1;background:#e5e7eb;border-radius:4px;height:6px;overflow:hidden;"><div style="background:${C};height:100%;width:${a.requirements_progress}%;border-radius:4px;"></div></div>
                  <span style="font-size:11px;color:#6b7280;">${a.requirements_progress}%</span>
                </div>
              </td>
              <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:center;">
                <span style="color:${STATUS_COLORS[a.status]};font-weight:600;">${STATUS_LABELS[a.status]}</span>
              </td>
            </tr>`).join('')}
            ${!apps.length ? `<tr><td colspan="7" style="padding:30px;text-align:center;color:#9ca3af;">No applications found.</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>`;
    res.send(renderPage('Counselor Dashboard', html, req.session.user));
  }));

  /* ── Document Checklist ── */
  app.get('/university-tracker/documents', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const uid = req.session.user.id;
    const { rows: apps } = await pool.query(
      'SELECT a.*, o.offer_details FROM university_applications a LEFT JOIN university_offers o ON o.application_id = a.id AND o.tenant_id = a.tenant_id WHERE a.tenant_id=$1 AND a.student_id=$2 ORDER BY a.university_name',
      [tid, uid]);
    const { rows: reqs } = await pool.query(
      'SELECT ar.*, a.university_name FROM app_requirements ar JOIN university_applications a ON a.id = ar.application_id WHERE ar.tenant_id=$1 AND a.student_id=$2 ORDER BY a.university_name, ar.requirement_type',
      [tid, uid]);
    // Build matrix
    const docTypes = [...new Set(reqs.map(r => r.requirement_type))];
    const uniNames = [...new Set(reqs.map(r => r.university_name))];
    const matrix = {};
    reqs.forEach(r => {
      if (!matrix[r.university_name]) matrix[r.university_name] = {};
      matrix[r.university_name][r.requirement_type] = r.completed;
    });
    const completedCount = reqs.filter(r => r.completed).length;
    const totalCount = reqs.length || 1;
    const overallPct = Math.round((completedCount / totalCount) * 100);
    const html = `
      <div style="max-width:1100px;margin:0 auto;padding:20px;">
        <a href="/university-tracker" style="color:${C};text-decoration:none;font-size:14px;">&larr; Dashboard</a>
        <h1 style="font-size:22px;font-weight:700;color:#111827;margin:12px 0 8px;">Document Checklist</h1>
        <p style="color:#6b7280;margin-bottom:16px;">Track which documents have been sent to each university.</p>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:13px;color:#6b7280;">Overall: ${completedCount}/${totalCount} (${overallPct}%)</span>
          </div>
          <div style="width:200px;background:#e5e7eb;border-radius:6px;height:8px;overflow:hidden;">
            <div style="background:${C};height:100%;width:${overallPct}%;border-radius:6px;"></div>
          </div>
        </div>
        ${uniNames.length ? `<div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <thead><tr style="background:#f9fafb;">
              <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;min-width:160px;">University</th>
              ${docTypes.map(dt => `<th style="padding:10px 8px;text-align:center;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;min-width:100px;font-size:11px;">${REQ_LABELS[dt] || esc(dt)}</th>`).join('')}
              <th style="padding:10px 8px;text-align:center;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;">Complete</th>
            </tr></thead>
            <tbody>
            ${uniNames.map(uni => {
              const row = matrix[uni] || {};
              const done = docTypes.filter(dt => row[dt]).length;
              return `<tr style="border-bottom:1px solid #f3f4f6;">
                <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-weight:500;color:#374151;">${esc(uni)}</td>
                ${docTypes.map(dt => {
                  const c = row[dt];
                  return `<td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">
                    <span style="display:inline-flex;width:24px;height:24px;border-radius:50%;align-items:center;justify-content:center;font-size:14px;${c ? 'background:#dcfce7;color:#16a34a;' : 'background:#fef2f2;color:#dc2626;'}" aria-label="${c ? 'Completed' : 'Pending'}">${c ? '✓' : '✗'}</span>
                  </td>`;
                }).join('')}
                <td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">
                  <span style="font-weight:600;color:${done === docTypes.length ? '#10b981' : '#f59e0b'};">${done}/${docTypes.length}</span>
                </td>
              </tr>`;
            }).join('')}
            </tbody></table>
        </div>` : '<div style="text-align:center;padding:40px;color:#9ca3af;">No applications with documents to track.</div>'}
        <div style="margin-top:16px;">
          <a href="/university-tracker/applications" style="color:${C};text-decoration:none;font-size:14px;">Manage Applications</a>
        </div>
      </div>`;
    res.send(renderPage('Document Checklist', html, req.session.user));
  }));

  /* ── Scholarship Tracking ── */
  app.get('/university-tracker/scholarships', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const uid = req.session.user.id;
    const { rows: schols } = await pool.query(
      'SELECT * FROM scholarship_applications_uni WHERE tenant_id=$1 AND student_id=$2 ORDER BY deadline NULLS LAST, created_at DESC',
      [tid, uid]);
    const totalAmount = schols.reduce((s,sc) => s + parseFloat(sc.amount || 0), 0);
    const wonSchols = schols.filter(s => s.status === 'awarded');
    const totalWon = wonSchols.reduce((s,sc) => s + parseFloat(sc.amount || 0), 0);
    const html = `
      <div style="max-width:1000px;margin:0 auto;padding:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <div>
            <a href="/university-tracker" style="color:${C};text-decoration:none;font-size:14px;">&larr; Dashboard</a>
            <h1 style="font-size:22px;font-weight:700;color:#111827;margin-top:8px;">Scholarship Tracking</h1>
          </div>
          <a href="/university-tracker/scholarships/new" style="background:${C};color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">+ Add Scholarship</a>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px;">
          ${statCard('Total Applied', schols.length, C)}
          ${statCard('Total Amount', '$' + totalAmount.toLocaleString(), '#8b5cf6')}
          ${statCard('Awards Won', wonSchols.length, '#10b981')}
          ${statCard('Total Won', '$' + totalWon.toLocaleString(), '#059669')}
        </div>
        ${schols.length ? `<div style="display:flex;flex-direction:column;gap:10px;">
          ${schols.map(s => {
            const sStatusColor = s.status === 'awarded' ? '#10b981' : s.status === 'rejected' ? '#ef4444' : s.status === 'submitted' ? '#3b82f6' : '#6b7280';
            const sStatusLabel = s.status === 'awarded' ? 'Awarded' : s.status === 'rejected' ? 'Rejected' : s.status === 'submitted' ? 'Submitted' : s.status === 'researching' ? 'Researching' : s.status.charAt(0).toUpperCase() + s.status.slice(1);
            return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div>
                  <div style="font-size:16px;font-weight:600;color:#111827;">${esc(s.scholarship_name)}</div>
                  ${s.university_name ? `<div style="font-size:13px;color:#6b7280;margin-top:2px;">${esc(s.university_name)}</div>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                  ${parseFloat(s.amount) > 0 ? `<span style="font-size:14px;font-weight:600;color:#8b5cf6;">$${parseFloat(s.amount).toLocaleString()}</span>` : ''}
                  <span style="color:${sStatusColor};font-size:12px;font-weight:600;background:${sStatusColor}18;padding:2px 10px;border-radius:20px;">${sStatusLabel}</span>
                </div>
              </div>
              ${s.deadline ? `<div style="font-size:12px;margin-top:6px;color:${deadlineColor(s.deadline)};">Deadline: ${new Date(s.deadline).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</div>` : ''}
              ${s.notes ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;">${esc(s.notes)}</div>` : ''}
              <div style="margin-top:8px;display:flex;gap:6px;">
                <form method="POST" action="/university-tracker/scholarships/${s.id}/status" style="display:inline;">
                  <select name="status" onchange="this.form.submit()" style="padding:3px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:11px;cursor:pointer;" aria-label="Change status">
                    ${['researching','submitted','awarded','rejected'].map(st => `<option value="${st}" ${s.status===st?'selected':''}>${st.charAt(0).toUpperCase()+st.slice(1)}</option>`).join('')}
                  </select>
                </form>
                <form method="POST" action="/university-tracker/scholarships/${s.id}/delete" onsubmit="return confirm('Delete this scholarship?')" style="display:inline;">
                  <button style="background:none;border:1px solid #fca5a5;color:#ef4444;padding:3px 10px;border-radius:6px;font-size:11px;cursor:pointer;">Delete</button>
                </form>
              </div>
            </div>`;
          }).join('')}
        </div>` : '<div style="text-align:center;padding:40px;color:#9ca3af;background:#fff;border:1px solid #e5e7eb;border-radius:12px;">No scholarship applications yet. <a href="/university-tracker/scholarships/new" style="color:'+C+';">Add one</a>.</div>'}
      </div>`;
    res.send(renderPage('Scholarships', html, req.session.user));
  }));

  app.get('/university-tracker/scholarships/new', requireAuth, ah(async (req, res) => {
    const html = `
      <div style="max-width:600px;margin:0 auto;padding:20px;">
        <h1 style="font-size:22px;font-weight:700;color:#111827;margin-bottom:16px;">Add Scholarship Application</h1>
        <form method="POST" action="/university-tracker/scholarships/new" style="display:flex;flex-direction:column;gap:14px;">
          <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Scholarship Name *</label>
            <input name="scholarship_name" required style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
          <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">University (optional)</label>
            <input name="university_name" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Amount ($)</label>
              <input name="amount" type="number" step="0.01" value="0" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
            <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Deadline</label>
              <input name="deadline" type="date" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
          </div>
          <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Status</label>
            <select name="status" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
              <option value="researching">Researching</option><option value="submitted">Submitted</option><option value="awarded">Awarded</option><option value="rejected">Rejected</option></select></div>
          <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Notes</label>
            <textarea name="notes" rows="3" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;resize:vertical;"></textarea></div>
          <div style="display:flex;gap:8px;">
            <button type="submit" style="background:${C};color:#fff;padding:10px 20px;border:none;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;">Save Scholarship</button>
            <a href="/university-tracker/scholarships" style="padding:10px 20px;border-radius:8px;font-size:14px;color:#374151;text-decoration:none;">Cancel</a>
          </div>
        </form>
      </div>`;
    res.send(renderPage('Add Scholarship', html, req.session.user));
  }));

  app.post('/university-tracker/scholarships/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const uid = req.session.user.id;
    const { scholarship_name, university_name='', amount='0', deadline, status='researching', notes='' } = req.body;
    await pool.query(
      'INSERT INTO scholarship_applications_uni (tenant_id,student_id,scholarship_name,university_name,amount,deadline,status,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [tid, uid, scholarship_name, university_name, parseFloat(amount) || 0, deadline || null, status, notes]);
    audit('scholarship:create', { scholarship_name }, req);
    res.redirect('/university-tracker/scholarships');
  }));

  app.post('/university-tracker/scholarships/:id/status', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    await pool.query('UPDATE scholarship_applications_uni SET status=$1 WHERE id=$2 AND tenant_id=$3', [req.body.status, req.params.id, tid]);
    audit('scholarship:status', { id: req.params.id, status: req.body.status }, req);
    res.redirect('/university-tracker/scholarships');
  }));

  app.post('/university-tracker/scholarships/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    await pool.query('DELETE FROM scholarship_applications_uni WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    audit('scholarship:delete', { id: req.params.id }, req);
    res.redirect('/university-tracker/scholarships');
  }));

  /* ── API: Reminder Emails (utility) ── */
  app.post('/university-tracker/api/remind', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const uid = req.session.user.id;
    const daysThreshold = parseInt(req.body.days) || 7;
    const { rows: apps } = await pool.query(
      'SELECT a.*, u.email as student_email, u.name as student_name FROM university_applications a LEFT JOIN users u ON u.id = a.student_id WHERE a.tenant_id=$1 AND a.student_id=$2 AND a.deadline IS NOT NULL AND a.deadline BETWEEN NOW() AND NOW() + ($3 || \' days\')::INTERVAL AND a.status NOT IN (\'accepted\',\'rejected\',\'enrolled\') ORDER BY a.deadline',
      [tid, uid, daysThreshold]);
    // In production, send email via opts.sendEmail or similar
    audit('university_reminders:sent', { count: apps.length, days: daysThreshold }, req);
    res.json({ success: true, reminders: apps.length, applications: apps.map(a => ({
      id: a.id, university: a.university_name, deadline: a.deadline,
      student: a.student_name, email: a.student_email
    }))});
  }));

  /* ── API: Bulk Status Update (counselor) ── */
  app.post('/university-tracker/api/bulk-status', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const { ids, status } = req.body;
    if (!ids || !Array.isArray(ids) || !status || !STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid request. Provide ids array and valid status.' });
    }
    await pool.query('UPDATE university_applications SET status=$1, updated_at=NOW() WHERE id = ANY($2) AND tenant_id=$3', [status, ids, tid]);
    audit('university_app:bulk_status', { ids, status }, req);
    res.json({ success: true, updated: ids.length, status });
  }));

  /* ── API: Get Application Stats (JSON) ── */
  app.get('/university-tracker/api/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const uid = req.session.user.id;
    const { rows: apps } = await pool.query(
      'SELECT * FROM university_applications WHERE tenant_id=$1 AND student_id=$2', [tid, uid]);
    const { rows: schols } = await pool.query(
      'SELECT * FROM scholarship_applications_uni WHERE tenant_id=$1 AND student_id=$2', [tid, uid]);
    const byStatus = {};
    STATUSES.forEach(s => { byStatus[s] = apps.filter(a => a.status === s).length; });
    const avgProgress = apps.length ? Math.round(apps.reduce((s,a) => s + (a.requirements_progress || 0), 0) / apps.length) : 0;
    res.json({
      totalApplications: apps.length,
      byStatus,
      averageProgress: avgProgress,
      scholarships: { total: schols.length, totalAmount: parseFloat(schols.reduce((s,sc) => s + parseFloat(sc.amount||0), 0).toFixed(2)) }
    });
  }));

  /* ── Edit Application ── */
  app.get('/university-tracker/applications/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const { id } = req.params;
    const { rows: [app] } = await pool.query(
      'SELECT * FROM university_applications WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!app) return res.status(404).send('Application not found');
    const html = `
      <div style="max-width:600px;margin:0 auto;padding:20px;">
        <a href="/university-tracker/applications/${id}" style="color:${C};text-decoration:none;font-size:14px;">&larr; Back to Application</a>
        <h1 style="font-size:22px;font-weight:700;color:#111827;margin:12px 0 16px;">Edit Application</h1>
        <form method="POST" action="/university-tracker/applications/${id}/edit" style="display:flex;flex-direction:column;gap:14px;">
          <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">University Name *</label>
            <input name="university_name" value="${esc(app.university_name)}" required style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
          <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Program *</label>
            <input name="program" value="${esc(app.program)}" required style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Degree</label>
              <select name="degree" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
                <option value="">Select...</option>
                ${['BS','BA','MS','MA','PhD','MBA','MD','JD','Other'].map(d => `<option ${app.degree===d?'selected':''}>${d}</option>`).join('')}
              </select></div>
            <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Country</label>
              <input name="country" value="${esc(app.country)}" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Deadline</label>
              <input name="deadline" type="date" value="${app.deadline || ''}" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
            <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Status</label>
              <select name="status" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
                ${STATUSES.map(s => `<option value="${s}" ${app.status===s?'selected':''}>${STATUS_LABELS[s]}</option>`).join('')}
              </select></div>
          </div>
          <div><label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:3px;">Notes</label>
            <textarea name="notes" rows="3" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;resize:vertical;">${esc(app.notes)}</textarea></div>
          <div style="display:flex;gap:8px;">
            <button type="submit" style="background:${C};color:#fff;padding:10px 20px;border:none;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;">Update Application</button>
            <a href="/university-tracker/applications/${id}" style="padding:10px 20px;border-radius:8px;font-size:14px;color:#374151;text-decoration:none;">Cancel</a>
          </div>
        </form>
      </div>`;
    res.send(renderPage('Edit Application', html, req.session.user));
  }));

  app.post('/university-tracker/applications/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const { id } = req.params;
    const { university_name, program, degree, country, deadline, status, notes } = req.body;
    await pool.query(
      `UPDATE university_applications SET university_name=$1,program=$2,degree=$3,country=$4,deadline=$5,status=$6,notes=$7,updated_at=NOW() WHERE id=$8 AND tenant_id=$9`,
      [university_name, program, degree, country, deadline || null, status, notes, id, tid]);
    // Auto-create offer if status changed to accepted/waitlisted
    if (['accepted', 'enrolled', 'waitlisted'].includes(status)) {
      const { rows: [existing] } = await pool.query(
        'SELECT id FROM university_offers WHERE application_id=$1 AND tenant_id=$2', [id, tid]);
      if (!existing) {
        await pool.query(
          'INSERT INTO university_offers (tenant_id,application_id) VALUES ($1,$2)', [tid, id]);
      }
    }
    audit('university_app:edit', { id, status }, req);
    res.redirect('/university-tracker/applications/' + id);
  }));

  /* ── Quick Status Update (AJAX-friendly) ── */
  app.post('/university-tracker/applications/:id/status', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 1;
    const { id } = req.params;
    const { status } = req.body;
    if (!status || !STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    await pool.query(
      'UPDATE university_applications SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
      [status, id, tid]);
    audit('university_app:status', { id, status }, req);
    res.json({ success: true, status });
  }));
};
