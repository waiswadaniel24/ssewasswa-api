/**
 * Parent Workshop & Training Module
 * SaaS School Portal – Workshop scheduling, registration, attendance, resources, feedback, certificates
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:14px}.btn:hover{background:#3730a3}.btn-sm{padding:5px 12px;font-size:12px}.btn-danger{background:#dc2626}.btn-danger:hover{background:#b91c1c}.btn-success{background:#059669}.btn-success:hover{background:#047857}.btn-outline{background:transparent;border:1px solid #d1d5db;color:#374151}.btn-outline:hover{background:#f3f4f6}table{width:100%;border-collapse:collapse}th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-size:14px}th{background:#f9fafb;font-weight:600;color:#374151}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;font-size:14px}textarea{resize:vertical;min-height:80px}.badge{display:inline-block;padding:2px 10px;border-radius:9999px;font-size:12px;font-weight:500}.badge-green{background:#d1fae5;color:#065f46}.badge-yellow{background:#fef3c7;color:#92400e}.badge-red{background:#fee2e2;color:#991b1b}.badge-blue{background:#dbeafe;color:#1e40af}.badge-gray{background:#f3f4f6;color:#4b5563}.grid{display:grid;gap:16px}.grid-2{grid-template-columns:1fr 1fr}.grid-3{grid-template-columns:1fr 1fr 1fr}.grid-4{grid-template-columns:1fr 1fr 1fr 1fr}.stat-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1);text-align:center}.stat-card .num{font-size:28px;font-weight:700;color:#4f46e5}.stat-card .lbl{font-size:13px;color:#6b7280;margin-top:4px}.flex{display:flex;align-items:center;gap:8px}.mt-1{margin-top:8px}.mt-2{margin-top:16px}.mb-1{margin-bottom:8px}.mb-2{margin-bottom:16px}.text-right{text-align:right}.text-center{text-align:center}.text-sm{font-size:13px}.text-muted{color:#6b7280}.fw-600{font-weight:600}.w-full{width:100%}.gap-1{gap:8px}.gap-2{gap:16px}</style><div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#4f46e5">School</a> &rsaquo; Parent Workshop</div>';

  /* ─── TOPICS ─── */
  const TOPICS = [
    'parenting-skills', 'digital-literacy', 'child-psychology', 'nutrition-health',
    'special-needs', 'academic-support', 'behavioral-management', 'financial-literacy',
    'communication-skills', 'stress-management', 'career-guidance', 'safety-awareness'
  ];
  const TOPIC_LABELS = {
    'parenting-skills': 'Parenting Skills',
    'digital-literacy': 'Digital Literacy',
    'child-psychology': 'Child Psychology',
    'nutrition-health': 'Nutrition & Health',
    'special-needs': 'Special Needs',
    'academic-support': 'Academic Support',
    'behavioral-management': 'Behavioral Management',
    'financial-literacy': 'Financial Literacy',
    'communication-skills': 'Communication Skills',
    'stress-management': 'Stress Management',
    'career-guidance': 'Career Guidance',
    'safety-awareness': 'Safety Awareness'
  };
  const MODES = ['in-person', 'virtual', 'hybrid'];
  const STATUSES = ['draft', 'published', 'registration-open', 'in-progress', 'completed', 'cancelled'];

  function statusBadge(s) {
    const m = {
      'draft': ['badge-gray', 'Draft'],
      'published': ['badge-blue', 'Published'],
      'registration-open': ['badge-green', 'Registration Open'],
      'in-progress': ['badge-yellow', 'In Progress'],
      'completed': ['badge-green', 'Completed'],
      'cancelled': ['badge-red', 'Cancelled']
    };
    const [cls, lbl] = m[s] || ['badge-gray', s];
    return `<span class="badge ${cls}">${esc(lbl)}</span>`;
  }

  function modeBadge(m) {
    const colors = { 'in-person': '#059669', 'virtual': '#2563eb', 'hybrid': '#7c3aed' };
    const icons = { 'in-person': '&#x1f3e2;', 'virtual': '&#x1f4bb;', 'hybrid': '&#x1f517;' };
    return `<span style="display:inline-flex;align-items:center;gap:4px;color:${colors[m] || GRAY};font-weight:500;font-size:13px">${icons[m] || ''} ${esc(m)}</span>`;
  }

  /* ─── AUTO TABLE CREATION ─── */
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS parent_workshops (
          id BIGSERIAL PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          topic VARCHAR(64) NOT NULL DEFAULT 'parenting-skills',
          speaker VARCHAR(255),
          speaker_bio TEXT,
          date DATE NOT NULL,
          time TIME NOT NULL,
          duration INT NOT NULL DEFAULT 60,
          venue VARCHAR(255),
          meeting_link VARCHAR(512),
          max_participants INT DEFAULT 50,
          mode TEXT NOT NULL DEFAULT 'in-person',
          status TEXT NOT NULL DEFAULT 'draft',
          cover_image VARCHAR(512),
          recording_url VARCHAR(512),
          certificate_template TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await migrateQuery(pool, 'ParentWorkshop', `
        CREATE TABLE IF NOT EXISTS workshop_registrations (
          id BIGSERIAL PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          workshop_id BIGINT NOT NULL,
          parent_id BIGINT NOT NULL,
          parent_name VARCHAR(255),
          parent_email VARCHAR(255),
          registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          attended SMALLINT DEFAULT 0,
          attended_at TIMESTAMP NULL,
          feedback_score SMALLINT DEFAULT NULL,
          feedback_comment TEXT,
          certificate_issued SMALLINT DEFAULT 0,
          certificate_issued_at TIMESTAMP NULL,
          CONSTRAINT uk_workshop_parent UNIQUE (workshop_id, parent_id)
        )
      `);
      await migrateQuery(pool, 'ParentWorkshop', `
        CREATE TABLE IF NOT EXISTS workshop_resources (
          id BIGSERIAL PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          workshop_id BIGINT NOT NULL,
          title VARCHAR(255) NOT NULL,
          file_type VARCHAR(64) DEFAULT 'pdf',
          file_url VARCHAR(512),
          description TEXT,
          sort_order INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('[ParentWorkshop] Tables ready');
    } catch(e) { console.warn('[ParentWorkshop] Migration warning:', e.message); }
  })();

  /* ════════════════════════════════════════════
     ROUTE: Dashboard
     ════════════════════════════════════════════ */
  app.get('/school/parent-workshop', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { rows: stats } = await pool.query(`
      SELECT
        COUNT(*) AS total_workshops,
        SUM(CASE WHEN status='registration-open' THEN 1 ELSE 0 END) AS open_reg,
        SUM(CASE WHEN status='in-progress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN date >= CURRENT_DATE THEN 1 ELSE 0 END) AS upcoming
      FROM parent_workshops WHERE tenant_id = $1`, [tid]);
    const { rows: regStats } = await pool.query(`
      SELECT
        COUNT(*) AS total_registrations,
        SUM(attended) AS total_attended,
        ROUND(AVG(feedback_score), 1) AS avg_feedback,
        SUM(certificate_issued) AS total_certificates
      FROM workshop_registrations wr
      JOIN parent_workshops w ON w.id = wr.workshop_id AND w.tenant_id = $1
      WHERE wr.tenant_id = $2`, [tid, tid]);
    const { rows: recent } = await pool.query(`
      SELECT id, title, topic, date, time, mode, status, speaker,
        (SELECT COUNT(*) FROM workshop_registrations WHERE workshop_id = parent_workshops.id) AS reg_count
      FROM parent_workshops WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 5`, [tid]);
    const { rows: topTopics } = await pool.query(`
      SELECT topic, COUNT(*) AS cnt FROM parent_workshops WHERE tenant_id = $1 GROUP BY topic ORDER BY cnt DESC LIMIT 5`, [tid]);
    const s = stats[0], r = regStats[0];
    res.send(renderPage(req, 'Parent Workshops', SKIP + `
      <h2 style="margin-bottom:20px">Parent Workshop & Training</h2>
      <div class="grid grid-4">
        <div class="stat-card"><div class="num">${s.total_workshops}</div><div class="lbl">Total Workshops</div></div>
        <div class="stat-card"><div class="num">${s.open_reg}</div><div class="lbl">Open for Registration</div></div>
        <div class="stat-card"><div class="num">${r.total_registrations || 0}</div><div class="lbl">Total Registrations</div></div>
        <div class="stat-card"><div class="num">${r.avg_feedback || '—'}</div><div class="lbl">Avg Feedback Score</div></div>
      </div>
      <div class="grid grid-4 mt-2">
        <div class="stat-card"><div class="num">${s.upcoming}</div><div class="lbl">Upcoming</div></div>
        <div class="stat-card"><div class="num">${r.total_attended || 0}</div><div class="lbl">Total Attended</div></div>
        <div class="stat-card"><div class="num">${r.total_certificates || 0}</div><div class="lbl">Certificates Issued</div></div>
        <div class="stat-card"><div class="num">${s.completed}</div><div class="lbl">Completed</div></div>
      </div>
      <div class="grid grid-2 mt-2">
        <div class="card">
          <h3>Recent Workshops</h3>
          ${recent.length ? `<table><tr><th>Title</th><th>Date</th><th>Mode</th><th>Status</th><th>Regs</th><th></th></tr>
          ${recent.map(w => `<tr>
            <td><strong>${esc(w.title)}</strong><br><span class="text-sm text-muted">${esc(TOPIC_LABELS[w.topic] || w.topic)}</span></td>
            <td>${w.date}</td>
            <td>${modeBadge(w.mode)}</td>
            <td>${statusBadge(w.status)}</td>
            <td class="text-center">${w.reg_count}</td>
            <td><a href="/school/parent-workshop/workshops/${w.id}" class="btn btn-sm btn-outline">View</a></td>
          </tr>`).join('')}</table>` : '<p class="text-muted">No workshops yet.</p>'}
          <div class="mt-2"><a href="/school/parent-workshop/workshops" class="btn">Manage Workshops</a>
            <a href="/school/parent-workshop/create" class="btn btn-outline" style="margin-left:8px">Create Workshop</a></div>
        </div>
        <div class="card">
          <h3>Popular Topics</h3>
          ${topTopics.length ? topTopics.map(t => `
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6">
              <span>${esc(TOPIC_LABELS[t.topic] || t.topic)}</span>
              <span class="fw-600">${t.cnt} workshops</span>
            </div>`).join('') : '<p class="text-muted">No data.</p>'}
          <div class="mt-2" style="display:flex;gap:8px">
            <a href="/school/parent-workshop/calendar" class="btn btn-outline">Calendar View</a>
            <a href="/school/parent-workshop/speakers" class="btn btn-outline">Speakers</a>
          </div>
        </div>
      </div>
    `));
  }));

  /* ════════════════════════════════════════════
     ROUTE: Create Workshop (form)
     ════════════════════════════════════════════ */
  app.get('/school/parent-workshop/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const topicOptions = TOPICS.map(t => `<option value="${t}">${esc(TOPIC_LABELS[t])}</option>`).join('');
    const modeOptions = MODES.map(m => `<option value="${m}">${esc(m)}</option>`).join('');
    res.send(renderPage(req, 'Create Workshop', SKIP + `
      <h2 style="margin-bottom:20px">Create New Workshop</h2>
      <div class="card" style="max-width:800px">
        <form method="POST" action="/school/parent-workshop/create">
          <div class="grid grid-2">
            <div><label class="fw-600">Title *</label><input type="text" name="title" required placeholder="e.g. Effective Parenting Strategies"></div>
            <div><label class="fw-600">Topic *</label><select name="topic" required>${topicOptions}</select></div>
          </div>
          <div class="mt-1"><label class="fw-600">Description</label><textarea name="description" rows="3" placeholder="Workshop description..."></textarea></div>
          <div class="grid grid-2 mt-1">
            <div><label class="fw-600">Date *</label><input type="date" name="date" required></div>
            <div><label class="fw-600">Time *</label><input type="time" name="time" required></div>
          </div>
          <div class="grid grid-2 mt-1">
            <div><label class="fw-600">Duration (minutes) *</label><input type="number" name="duration" value="60" min="15" max="480" required></div>
            <div><label class="fw-600">Max Participants</label><input type="number" name="max_participants" value="50" min="1"></div>
          </div>
          <div class="grid grid-2 mt-1">
            <div><label class="fw-600">Mode *</label><select name="mode" required>${modeOptions}</select></div>
            <div><label class="fw-600">Venue</label><input type="text" name="venue" placeholder="e.g. School Auditorium"></div>
          </div>
          <div class="mt-1"><label class="fw-600">Meeting Link (virtual/hybrid)</label><input type="url" name="meeting_link" placeholder="https://zoom.us/j/..."></div>
          <div class="grid grid-2 mt-1">
            <div><label class="fw-600">Speaker Name</label><input type="text" name="speaker" placeholder="e.g. Dr. Sarah Johnson"></div>
            <div><label class="fw-600">Speaker Bio</label><input type="text" name="speaker_bio" placeholder="Brief bio of the speaker"></div>
          </div>
          <div class="grid grid-2 mt-1">
            <div><label class="fw-600">Cover Image URL</label><input type="url" name="cover_image" placeholder="https://..."></div>
            <div><label class="fw-600">Initial Status</label>
              <select name="status">
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="registration-open">Open Registration</option>
              </select>
            </div>
          </div>
          <div class="mt-2 flex gap-1">
            <button type="submit" class="btn">Create Workshop</button>
            <a href="/school/parent-workshop" class="btn btn-outline">Cancel</a>
          </div>
        </form>
      </div>
    `));
  }));

  /* ════════════════════════════════════════════
     ROUTE: Create Workshop (POST handler)
     ════════════════════════════════════════════ */
  app.post('/school/parent-workshop/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { title, description, topic, speaker, speaker_bio, date, time, duration, venue,
      meeting_link, max_participants, mode, status, cover_image } = req.body;
    const validStatuses = ['draft', 'published', 'registration-open'];
    const st = validStatuses.includes(status) ? status : 'draft';
    const { rows: result } = await pool.query(`
      INSERT INTO parent_workshops (tenant_id, title, description, topic, speaker, speaker_bio,
        date, time, duration, venue, meeting_link, max_participants, mode, status, cover_image)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id`,
      [tid, title, description || null, topic || 'parenting-skills', speaker || null, speaker_bio || null,
        date, time, parseInt(duration) || 60, venue || null, meeting_link || null,
        parseInt(max_participants) || 50, mode || 'in-person', st, cover_image || null]);
    audit(req, 'parent_workshop_create', { workshop_id: result[0].id, title, topic });
    res.redirect('/school/parent-workshop/workshops');
  }));

  /* ════════════════════════════════════════════
     ROUTE: List Workshops
     ════════════════════════════════════════════ */
  app.get('/school/parent-workshop/workshops', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { topic, status, mode, q } = req.query;
    let paramIdx = 1;
    let where = `WHERE w.tenant_id = $${paramIdx++}`;
    const params = [tid];
    if (topic && TOPICS.includes(topic)) { where += ` AND w.topic = $${paramIdx++}`; params.push(topic); }
    if (status && STATUSES.includes(status)) { where += ` AND w.status = $${paramIdx++}`; params.push(status); }
    if (mode && MODES.includes(mode)) { where += ` AND w.mode = $${paramIdx++}`; params.push(mode); }
    if (q) { where += ` AND (w.title LIKE $${paramIdx++} OR w.speaker LIKE $${paramIdx++})`; params.push(`%${q}%`, `%${q}%`); }
    const { rows: workshops } = await pool.query(`
      SELECT w.*,
        (SELECT COUNT(*) FROM workshop_registrations wr WHERE wr.workshop_id = w.id) AS reg_count,
        (SELECT SUM(wr.attended) FROM workshop_registrations wr WHERE wr.workshop_id = w.id) AS attend_count
      FROM parent_workshops w ${where} ORDER BY w.date DESC, w.time ASC`, params);
    const topicFilter = TOPICS.map(t => `<option value="${t}" ${topic === t ? 'selected' : ''}>${esc(TOPIC_LABELS[t])}</option>`).join('');
    const statusFilter = STATUSES.map(s => `<option value="${s}" ${status === s ? 'selected' : ''}>${s}</option>`).join('');
    const modeFilter = MODES.map(m => `<option value="${m}" ${mode === m ? 'selected' : ''}>${m}</option>`).join('');
    res.send(renderPage(req, 'Workshops', SKIP + `
      <div class="flex mb-2" style="justify-content:space-between">
        <h2>Workshops (${workshops.length})</h2>
        <a href="/school/parent-workshop/create" class="btn">+ New Workshop</a>
      </div>
      <div class="card">
        <form method="GET" class="flex gap-1" style="flex-wrap:wrap;align-items:end">
          <div style="flex:1;min-width:200px"><label class="text-sm text-muted">Search</label>
            <input type="text" name="q" value="${esc(q || '')}" placeholder="Search title or speaker..."></div>
          <div style="min-width:160px"><label class="text-sm text-muted">Topic</label><select name="topic"><option value="">All Topics</option>${topicFilter}</select></div>
          <div style="min-width:160px"><label class="text-sm text-muted">Status</label><select name="status"><option value="">All</option>${statusFilter}</select></div>
          <div style="min-width:140px"><label class="text-sm text-muted">Mode</label><select name="mode"><option value="">All</option>${modeFilter}</select></div>
          <button type="submit" class="btn btn-sm">Filter</button>
          <a href="/school/parent-workshop/workshops" class="btn btn-sm btn-outline">Clear</a>
        </form>
      </div>
      ${workshops.length ? `<div class="card"><table>
        <tr><th>Title / Topic</th><th>Date & Time</th><th>Speaker</th><th>Mode</th><th>Regs / Attend</th><th>Status</th><th>Actions</th></tr>
        ${workshops.map(w => `<tr>
          <td><strong>${esc(w.title)}</strong><br><span class="text-sm text-muted">${esc(TOPIC_LABELS[w.topic] || w.topic)}</span></td>
          <td>${w.date}<br><span class="text-sm text-muted">${w.time} · ${w.duration}min</span></td>
          <td>${esc(w.speaker || '—')}</td>
          <td>${modeBadge(w.mode)}</td>
          <td class="text-center">${w.reg_count} / ${w.attend_count || 0}</td>
          <td>${statusBadge(w.status)}</td>
          <td class="flex gap-1" style="flex-wrap:wrap">
            <a href="/school/parent-workshop/workshops/${w.id}" class="btn btn-sm btn-outline">View</a>
            <a href="/school/parent-workshop/workshops/${w.id}/edit" class="btn btn-sm btn-outline">Edit</a>
            <a href="/school/parent-workshop/attendees/${w.id}" class="btn btn-sm btn-outline">Attendees</a>
            <a href="/school/parent-workshop/resources?workshop_id=${w.id}" class="btn btn-sm btn-outline">Resources</a>
          </td>
        </tr>`).join('')}
      </table></div>` : '<div class="card"><p class="text-muted text-center">No workshops found.</p></div>'}
    `));
  }));

  /* ════════════════════════════════════════════
     ROUTE: View Single Workshop
     ════════════════════════════════════════════ */
  app.get('/school/parent-workshop/workshops/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id, wid = parseInt(req.params.id);
    const { rows } = await pool.query(`SELECT * FROM parent_workshops WHERE id = $1 AND tenant_id = $2`, [wid, tid]);
    if (!rows.length) return res.status(404).send('Workshop not found');
    const w = rows[0];
    const { rows: regs } = await pool.query(`
      SELECT id, parent_name, parent_email, registered_at, attended, feedback_score, feedback_comment, certificate_issued
      FROM workshop_registrations WHERE workshop_id = $1 AND tenant_id = $2 ORDER BY registered_at DESC`, [wid, tid]);
    const { rows: resources } = await pool.query(`
      SELECT * FROM workshop_resources WHERE workshop_id = $1 AND tenant_id = $2 ORDER BY sort_order ASC`, [wid, tid]);
    const attendedCount = regs.filter(r => r.attended).length;
    const feedbackCount = regs.filter(r => r.feedback_score).length;
    const avgFeedback = feedbackCount > 0 ? (regs.reduce((s, r) => s + (r.feedback_score || 0), 0) / feedbackCount).toFixed(1) : '—';
    const certCount = regs.filter(r => r.certificate_issued).length;
    res.send(renderPage(req, w.title, SKIP + `
      <div class="flex mb-2" style="justify-content:space-between;align-items:center">
        <div>
          <h2>${esc(w.title)}</h2>
          <div class="flex gap-1 mt-1">${statusBadge(w.status)} ${modeBadge(w.mode)}
            <span class="badge badge-gray">${esc(TOPIC_LABELS[w.topic] || w.topic)}</span></div>
        </div>
        <div class="flex gap-1">
          <a href="/school/parent-workshop/workshops/${w.id}/edit" class="btn btn-outline">Edit</a>
          <a href="/school/parent-workshop/register/${w.id}" class="btn btn-success">Register Parent</a>
        </div>
      </div>
      <div class="grid grid-3">
        <div class="stat-card"><div class="num">${regs.length}</div><div class="lbl">Registered</div></div>
        <div class="stat-card"><div class="num">${attendedCount}</div><div class="lbl">Attended</div></div>
        <div class="stat-card"><div class="num">${avgFeedback}</div><div class="lbl">Avg Feedback (${feedbackCount})</div></div>
      </div>
      <div class="grid grid-2 mt-2">
        <div class="card">
          <h3>Workshop Details</h3>
          <table><tr><td class="fw-600" style="width:140px">Date & Time</td><td>${w.date} at ${w.time} (${w.duration} min)</td></tr>
            <tr><td class="fw-600">Venue</td><td>${esc(w.venue || '—')}</td></tr>
            <tr><td class="fw-600">Meeting Link</td><td>${w.meeting_link ? `<a href="${esc(w.meeting_link)}" target="_blank" style="color:${P}">Join Meeting</a>` : '—'}</td></tr>
            <tr><td class="fw-600">Speaker</td><td>${esc(w.speaker || '—')}${w.speaker_bio ? `<br><span class="text-sm text-muted">${esc(w.speaker_bio)}</span>` : ''}</td></tr>
            <tr><td class="fw-600">Max Participants</td><td>${w.max_participants}</td></tr>
            <tr><td class="fw-600">Recording</td><td>${w.recording_url ? `<a href="${esc(w.recording_url)}" target="_blank" style="color:${P}">Watch Recording</a>` : '—'}</td></tr>
            <tr><td class="fw-600">Certificates</td><td>${certCount} issued</td></tr></table>
          ${w.description ? `<div class="mt-1"><strong>Description</strong><p class="text-muted">${esc(w.description)}</p></div>` : ''}
        </div>
        <div class="card">
          <h3>Quick Actions</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            <a href="/school/parent-workshop/attendees/${w.id}" class="btn btn-outline w-full">Manage Attendees & Attendance</a>
            <a href="/school/parent-workshop/resources?workshop_id=${w.id}" class="btn btn-outline w-full">Manage Resources</a>
            <a href="/school/parent-workshop/feedback?workshop_id=${w.id}" class="btn btn-outline w-full">View Feedback</a>
            <a href="/school/parent-workshop/certificates?workshop_id=${w.id}" class="btn btn-outline w-full">Issue Certificates</a>
            ${w.status === 'completed' && !w.recording_url ? `<a href="/school/parent-workshop/workshops/${w.id}/recording" class="btn btn-outline w-full">Upload Recording</a>` : ''}
          </div>
        </div>
      </div>
      <div class="grid grid-2 mt-2">
        <div class="card">
          <h3>Registrations (${regs.length})</h3>
          ${regs.length ? `<table><tr><th>Parent</th><th>Registered</th><th>Attended</th><th>Score</th></tr>
          ${regs.slice(0, 10).map(r => `<tr>
            <td>${esc(r.parent_name || '—')}<br><span class="text-sm text-muted">${esc(r.parent_email || '')}</span></td>
            <td class="text-sm">${r.registered_at ? new Date(r.registered_at).toLocaleDateString() : '—'}</td>
            <td>${r.attended ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-gray">No</span>'}</td>
            <td>${r.feedback_score ? `<span class="fw-600">${r.feedback_score}/5</span>` : '—'}</td>
          </tr>`).join('')}</table>
          ${regs.length > 10 ? `<p class="text-sm text-muted mt-1">Showing 10 of ${regs.length} <a href="/school/parent-workshop/attendees/${w.id}">View all</a></p>` : ''}
          ` : '<p class="text-muted">No registrations yet.</p>'}
        </div>
        <div class="card">
          <h3>Resources (${resources.length})</h3>
          ${resources.length ? resources.map(res => `
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6">
              <div>
                <strong>${esc(res.title)}</strong>
                <span class="badge badge-gray">${esc(res.file_type)}</span>
                ${res.description ? `<br><span class="text-sm text-muted">${esc(res.description)}</span>` : ''}
              </div>
              ${res.file_url ? `<a href="${esc(res.file_url)}" target="_blank" class="btn btn-sm btn-outline">Download</a>` : ''}
            </div>`).join('') : '<p class="text-muted">No resources uploaded.</p>'}
        </div>
      </div>
    `));
  }));

  /* ════════════════════════════════════════════
     ROUTE: Edit Workshop (form)
     ════════════════════════════════════════════ */
  app.get('/school/parent-workshop/workshops/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id, wid = parseInt(req.params.id);
    const { rows } = await pool.query(`SELECT * FROM parent_workshops WHERE id = $1 AND tenant_id = $2`, [wid, tid]);
    if (!rows.length) return res.status(404).send('Workshop not found');
    const w = rows[0];
    const topicOpts = TOPICS.map(t => `<option value="${t}" ${w.topic === t ? 'selected' : ''}>${esc(TOPIC_LABELS[t])}</option>`).join('');
    const modeOpts = MODES.map(m => `<option value="${m}" ${w.mode === m ? 'selected' : ''}>${esc(m)}</option>`).join('');
    const statusOpts = STATUSES.map(s => `<option value="${s}" ${w.status === s ? 'selected' : ''}>${s}</option>`).join('');
    res.send(renderPage(req, 'Edit Workshop', SKIP + `
      <h2 style="margin-bottom:20px">Edit: ${esc(w.title)}</h2>
      <div class="card" style="max-width:800px">
        <form method="POST" action="/school/parent-workshop/workshops/${w.id}/edit">
          <div class="grid grid-2">
            <div><label class="fw-600">Title *</label><input type="text" name="title" value="${esc(w.title)}" required></div>
            <div><label class="fw-600">Topic *</label><select name="topic" required>${topicOpts}</select></div>
          </div>
          <div class="mt-1"><label class="fw-600">Description</label><textarea name="description" rows="3">${esc(w.description || '')}</textarea></div>
          <div class="grid grid-2 mt-1">
            <div><label class="fw-600">Date *</label><input type="date" name="date" value="${w.date}" required></div>
            <div><label class="fw-600">Time *</label><input type="time" name="time" value="${w.time}" required></div>
          </div>
          <div class="grid grid-2 mt-1">
            <div><label class="fw-600">Duration (min)</label><input type="number" name="duration" value="${w.duration}" min="15" max="480"></div>
            <div><label class="fw-600">Max Participants</label><input type="number" name="max_participants" value="${w.max_participants}" min="1"></div>
          </div>
          <div class="grid grid-2 mt-1">
            <div><label class="fw-600">Mode *</label><select name="mode" required>${modeOpts}</select></div>
            <div><label class="fw-600">Status *</label><select name="status" required>${statusOpts}</select></div>
          </div>
          <div class="mt-1"><label class="fw-600">Venue</label><input type="text" name="venue" value="${esc(w.venue || '')}"></div>
          <div class="mt-1"><label class="fw-600">Meeting Link</label><input type="url" name="meeting_link" value="${esc(w.meeting_link || '')}"></div>
          <div class="grid grid-2 mt-1">
            <div><label class="fw-600">Speaker</label><input type="text" name="speaker" value="${esc(w.speaker || '')}"></div>
            <div><label class="fw-600">Speaker Bio</label><input type="text" name="speaker_bio" value="${esc(w.speaker_bio || '')}"></div>
          </div>
          <div class="grid grid-2 mt-1">
            <div><label class="fw-600">Cover Image URL</label><input type="url" name="cover_image" value="${esc(w.cover_image || '')}"></div>
            <div><label class="fw-600">Recording URL</label><input type="url" name="recording_url" value="${esc(w.recording_url || '')}"></div>
          </div>
          <div class="mt-2 flex gap-1">
            <button type="submit" class="btn">Save Changes</button>
            <a href="/school/parent-workshop/workshops/${w.id}" class="btn btn-outline">Cancel</a>
            <button type="submit" name="action" value="delete" class="btn btn-danger" style="margin-left:auto"
              onclick="return confirm('Delete this workshop? This cannot be undone.')">Delete</button>
          </div>
        </form>
      </div>
    `));
  }));

  /* ════════════════════════════════════════════
     ROUTE: Edit Workshop (POST)
     ════════════════════════════════════════════ */
  app.post('/school/parent-workshop/workshops/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id, wid = parseInt(req.params.id);
    if (req.body.action === 'delete') {
      await pool.query(`DELETE FROM workshop_resources WHERE workshop_id = $1 AND tenant_id = $2`, [wid, tid]);
      await pool.query(`DELETE FROM workshop_registrations WHERE workshop_id = $1 AND tenant_id = $2`, [wid, tid]);
      await pool.query(`DELETE FROM parent_workshops WHERE id = $1 AND tenant_id = $2`, [wid, tid]);
      audit(req, 'parent_workshop_delete', { workshop_id: wid });
      return res.redirect('/school/parent-workshop/workshops');
    }
    const { title, description, topic, speaker, speaker_bio, date, time, duration, venue,
      meeting_link, max_participants, mode, status, cover_image, recording_url } = req.body;
    await pool.query(`
      UPDATE parent_workshops SET title=$1, description=$2, topic=$3, speaker=$4, speaker_bio=$5,
        date=$6, time=$7, duration=$8, venue=$9, meeting_link=$10, max_participants=$11, mode=$12, status=$13,
        cover_image=$14, recording_url=$15
      WHERE id = $16 AND tenant_id = $17`,
      [title, description || null, topic || 'parenting-skills', speaker || null, speaker_bio || null,
        date, time, parseInt(duration) || 60, venue || null, meeting_link || null,
        parseInt(max_participants) || 50, mode || 'in-person', status || 'draft',
        cover_image || null, recording_url || null, wid, tid]);
    audit(req, 'parent_workshop_update', { workshop_id: wid });
    res.redirect(`/school/parent-workshop/workshops/${wid}`);
  }));

  /* ════════════════════════════════════════════
     ROUTE: Upload Recording
     ════════════════════════════════════════════ */
  app.get('/school/parent-workshop/workshops/:id/recording', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id, wid = parseInt(req.params.id);
    const { rows } = await pool.query(`SELECT id, title FROM parent_workshops WHERE id = $1 AND tenant_id = $2`, [wid, tid]);
    if (!rows.length) return res.status(404).send('Workshop not found');
    res.send(renderPage(req, 'Upload Recording', SKIP + `
      <div class="card" style="max-width:600px">
        <h2>Upload Recording: ${esc(rows[0].title)}</h2>
        <form method="POST" action="/school/parent-workshop/workshops/${wid}/recording">
          <div class="mt-1"><label class="fw-600">Recording URL *</label>
            <input type="url" name="recording_url" required placeholder="https://... (YouTube, Vimeo, etc.)"></div>
          <div class="mt-2"><button type="submit" class="btn">Save Recording</button>
            <a href="/school/parent-workshop/workshops/${wid}" class="btn btn-outline">Cancel</a></div>
        </form>
      </div>
    `));
  }));

  app.post('/school/parent-workshop/workshops/:id/recording', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id, wid = parseInt(req.params.id);
    const { recording_url } = req.body;
    await pool.query(`UPDATE parent_workshops SET recording_url = $1 WHERE id = $2 AND tenant_id = $3`,
      [recording_url, wid, tid]);
    audit(req, 'workshop_recording_upload', { workshop_id: wid });
    res.redirect(`/school/parent-workshop/workshops/${wid}`);
  }));

  /* ════════════════════════════════════════════
     ROUTE: Register Parent (form + POST)
     ════════════════════════════════════════════ */
  app.get('/school/parent-workshop/register/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id, wid = parseInt(req.params.id);
    const { rows } = await pool.query(`SELECT * FROM parent_workshops WHERE id = $1 AND tenant_id = $2`, [wid, tid]);
    if (!rows.length) return res.status(404).send('Workshop not found');
    const w = rows[0];
    const { rows: existing } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM workshop_registrations WHERE workshop_id = $1 AND tenant_id = $2`, [wid, tid]);
    const spotsLeft = Math.max(0, w.max_participants - existing[0].cnt);
    res.send(renderPage(req, 'Register Parent', SKIP + `
      <div class="card" style="max-width:600px">
        <h2>Register Parent: ${esc(w.title)}</h2>
        <div class="mt-1" style="padding:12px;background:#f0fdf4;border-radius:8px">
          <strong>${esc(w.title)}</strong> · ${w.date} at ${w.time} · ${modeBadge(w.mode)}
          <br><span class="text-sm text-muted">${spotsLeft} spots remaining</span>
        </div>
        <form method="POST" action="/school/parent-workshop/register/${wid}">
          <div class="grid grid-2 mt-1">
            <div><label class="fw-600">Parent Name *</label><input type="text" name="parent_name" required></div>
            <div><label class="fw-600">Parent Email *</label><input type="email" name="parent_email" required></div>
          </div>
          <div class="mt-1"><label class="fw-600">Parent ID</label><input type="number" name="parent_id" placeholder="Optional - link to existing parent record"></div>
          <div class="mt-2"><button type="submit" class="btn">Register</button>
            <a href="/school/parent-workshop/workshops/${wid}" class="btn btn-outline">Cancel</a></div>
        </form>
      </div>
    `));
  }));

  app.post('/school/parent-workshop/register/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id, wid = parseInt(req.params.id);
    const { parent_name, parent_email, parent_id } = req.body;
    const { rows: ws } = await pool.query(`SELECT max_participants FROM parent_workshops WHERE id = $1 AND tenant_id = $2`, [wid, tid]);
    if (!ws.length) return res.status(404).send('Workshop not found');
    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*) AS c FROM workshop_registrations WHERE workshop_id = $1 AND tenant_id = $2`, [wid, tid]);
    if (cnt[0].c >= ws[0].max_participants) {
      return res.send(renderPage(req, 'Registration Full', SKIP + '<div class="card"><p>This workshop has reached maximum capacity.</p><a href="/school/parent-workshop/workshops" class="btn btn-outline">Back</a></div>'));
    }
    try {
      await pool.query(`
        INSERT INTO workshop_registrations (tenant_id, workshop_id, parent_id, parent_name, parent_email)
        VALUES ($1, $2, $3, $4, $5)`,
        [tid, wid, parent_id || null, parent_name, parent_email]);
      audit(req, 'workshop_register', { workshop_id: wid, parent_name, parent_email });
      if (parent_email && queueEmail) {
        queueEmail({ to: parent_email, subject: 'Workshop Registration Confirmed',
          html: `<p>You have been registered for <strong>${esc(parent_name)}</strong>.</p><p>Please check the workshop details in the portal.</p>` });
      }
    } catch(e) {
      if (e.code === '23505') {
        return res.send(renderPage(req, 'Already Registered', SKIP +
          '<div class="card"><p>This parent is already registered for this workshop.</p><a href="/school/parent-workshop" class="btn btn-outline">Back</a></div>'));
      }
      throw e;
    }
    res.redirect(`/school/parent-workshop/attendees/${wid}`);
  }));

  /* ════════════════════════════════════════════
     ROUTE: Manage Attendees & Attendance
     ════════════════════════════════════════════ */
  app.get('/school/parent-workshop/attendees/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id, wid = parseInt(req.params.id);
    const { rows: ws } = await pool.query(`SELECT id, title, max_participants FROM parent_workshops WHERE id = $1 AND tenant_id = $2`, [wid, tid]);
    if (!ws.length) return res.status(404).send('Workshop not found');
    const w = ws[0];
    const { rows: regs } = await pool.query(`
      SELECT * FROM workshop_registrations WHERE workshop_id = $1 AND tenant_id = $2 ORDER BY registered_at DESC`, [wid, tid]);
    const attended = regs.filter(r => r.attended).length;
    res.send(renderPage(req, `Attendees: ${w.title}`, SKIP + `
      <div class="flex mb-2" style="justify-content:space-between;align-items:center">
        <div><h2>Attendees: ${esc(w.title)}</h2>
          <span class="text-sm text-muted">${regs.length} registered · ${attended} attended · ${w.max_participants} max</span></div>
        <div class="flex gap-1">
          <a href="/school/parent-workshop/register/${wid}" class="btn btn-success">+ Add Parent</a>
          <a href="/school/parent-workshop/workshops/${wid}" class="btn btn-outline">Back</a>
        </div>
      </div>
      ${regs.length ? `<div class="card">
        <form method="POST" action="/school/parent-workshop/attendees/${wid}/bulk">
          <table><tr><th><input type="checkbox" id="selectAll" onchange="document.querySelectorAll('.att-check').forEach(c=>c.checked=this.checked)"></th>
            <th>Parent</th><th>Email</th><th>Registered</th><th>Attended</th><th>Feedback</th><th>Certificate</th><th>Actions</th></tr>
          ${regs.map(r => `<tr>
            <td><input type="checkbox" class="att-check" name="ids" value="${r.id}"></td>
            <td>${esc(r.parent_name || '—')}</td>
            <td class="text-sm">${esc(r.parent_email || '—')}</td>
            <td class="text-sm">${r.registered_at ? new Date(r.registered_at).toLocaleDateString() : '—'}</td>
            <td>${r.attended
              ? `<span class="badge badge-green">Yes</span><br><span class="text-sm text-muted">${r.attended_at ? new Date(r.attended_at).toLocaleString() : ''}</span>`
              : `<form method="POST" action="/school/parent-workshop/attendees/${r.id}/attend" style="display:inline"><button class="btn btn-sm btn-outline">Mark</button></form>`}</td>
            <td>${r.feedback_score ? `${r.feedback_score}/5` : '<span class="text-muted">—</span>'}
              ${r.feedback_comment ? `<br><span class="text-sm text-muted">${esc(r.feedback_comment.substring(0, 50))}${r.feedback_comment.length > 50 ? '...' : ''}</span>` : ''}</td>
            <td>${r.certificate_issued ? '<span class="badge badge-green">Issued</span>' : '<span class="badge badge-gray">Pending</span>'}</td>
            <td>
              <form method="POST" action="/school/parent-workshop/attendees/${r.id}/remove" style="display:inline"
                onsubmit="return confirm('Remove this registration?')"><button class="btn btn-sm btn-danger">Remove</button></form>
            </td>
          </tr>`).join('')}</table>
          <div class="mt-2 flex gap-1">
            <button type="submit" name="bulk_action" value="mark-attended" class="btn btn-sm">Mark Selected Attended</button>
            <button type="submit" name="bulk_action" value="remove" class="btn btn-sm btn-danger">Remove Selected</button>
          </div>
        </form>
      </div>` : '<div class="card"><p class="text-muted text-center">No registrations yet. <a href="/school/parent-workshop/register/' + wid + '">Register a parent</a>.</p></div>'}
    `));
  }));

  /* Bulk attendee actions */
  app.post('/school/parent-workshop/attendees/:id/bulk', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id, wid = parseInt(req.params.id);
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [parseInt(req.body.ids)].filter(Boolean);
    if (!ids.length) return res.redirect(`/school/parent-workshop/attendees/${wid}`);
    if (req.body.bulk_action === 'mark-attended') {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      await pool.query(`UPDATE workshop_registrations SET attended = 1, attended_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND tenant_id = $${ids.length + 1}`,
        [...ids, tid]);
      audit(req, 'workshop_bulk_attend', { workshop_id: wid, count: ids.length });
    } else if (req.body.bulk_action === 'remove') {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      await pool.query(`DELETE FROM workshop_registrations WHERE id IN (${placeholders}) AND tenant_id = $${ids.length + 1}`, [...ids, tid]);
      audit(req, 'workshop_bulk_remove', { workshop_id: wid, count: ids.length });
    }
    res.redirect(`/school/parent-workshop/attendees/${wid}`);
  }));

  /* Mark single attendee */
  app.post('/school/parent-workshop/attendees/:rid/attend', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id, rid = parseInt(req.params.rid);
    await pool.query(`UPDATE workshop_registrations SET attended = 1, attended_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`, [rid, tid]);
    const { rows: reg } = await pool.query(`SELECT workshop_id FROM workshop_registrations WHERE id = $1 AND tenant_id = $2`, [rid, tid]);
    audit(req, 'workshop_mark_attended', { registration_id: rid });
    if (reg.length) res.redirect(`/school/parent-workshop/attendees/${reg[0].workshop_id}`);
    else res.redirect('/school/parent-workshop');
  }));

  /* Remove single attendee */
  app.post('/school/parent-workshop/attendees/:rid/remove', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id, rid = parseInt(req.params.rid);
    const { rows: reg } = await pool.query(`SELECT workshop_id FROM workshop_registrations WHERE id = $1 AND tenant_id = $2`, [rid, tid]);
    await pool.query(`DELETE FROM workshop_registrations WHERE id = $1 AND tenant_id = $2`, [rid, tid]);
    audit(req, 'workshop_remove_attendee', { registration_id: rid });
    res.redirect(`/school/parent-workshop/attendees/${reg.length ? reg[0].workshop_id : 0}`);
  }));

  /* ════════════════════════════════════════════
     ROUTE: Resources Management
     ════════════════════════════════════════════ */
  app.get('/school/parent-workshop/resources', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { workshop_id } = req.query;
    if (workshop_id) {
      const wid = parseInt(workshop_id);
      const { rows: ws } = await pool.query(`SELECT id, title FROM parent_workshops WHERE id = $1 AND tenant_id = $2`, [wid, tid]);
      if (!ws.length) return res.status(404).send('Workshop not found');
      const { rows: resources } = await pool.query(
        `SELECT * FROM workshop_resources WHERE workshop_id = $1 AND tenant_id = $2 ORDER BY sort_order ASC`, [wid, tid]);
      res.send(renderPage(req, 'Workshop Resources', SKIP + `
        <div class="flex mb-2" style="justify-content:space-between;align-items:center">
          <h2>Resources: ${esc(ws[0].title)}</h2>
          <div class="flex gap-1">
            <a href="/school/parent-workshop/resources/add?workshop_id=${wid}" class="btn">+ Add Resource</a>
            <a href="/school/parent-workshop/workshops/${wid}" class="btn btn-outline">Back</a>
          </div>
        </div>
        ${resources.length ? `<div class="card"><table>
          <tr><th>Title</th><th>Type</th><th>Description</th><th>Actions</th></tr>
          ${resources.map(r => `<tr>
            <td><strong>${esc(r.title)}</strong>${r.file_url ? `<br><a href="${esc(r.file_url)}" target="_blank" class="text-sm" style="color:${P}">View File</a>` : ''}</td>
            <td><span class="badge badge-gray">${esc(r.file_type)}</span></td>
            <td class="text-sm text-muted">${esc(r.description || '—')}</td>
            <td>
              <form method="POST" action="/school/parent-workshop/resources/${r.id}/delete" style="display:inline"
                onsubmit="return confirm('Delete this resource?')"><button class="btn btn-sm btn-danger">Delete</button></form>
            </td>
          </tr>`).join('')}
        </table></div>` : '<div class="card"><p class="text-muted text-center">No resources yet.</p></div>'}
      `));
    } else {
      /* All resources across workshops */
      const { rows: resources } = await pool.query(`
        SELECT r.*, w.title AS workshop_title
        FROM workshop_resources r
        JOIN parent_workshops w ON w.id = r.workshop_id AND w.tenant_id = r.tenant_id
        WHERE r.tenant_id = $1 ORDER BY r.created_at DESC LIMIT 50`, [tid]);
      res.send(renderPage(req, 'All Resources', SKIP + `
        <h2 style="margin-bottom:16px">All Workshop Resources (${resources.length})</h2>
        ${resources.length ? `<div class="card"><table>
          <tr><th>Resource</th><th>Workshop</th><th>Type</th><th>Added</th></tr>
          ${resources.map(r => `<tr>
            <td><strong>${esc(r.title)}</strong>${r.file_url ? ` <a href="${esc(r.file_url)}" target="_blank" class="text-sm" style="color:${P}">View</a>` : ''}</td>
            <td><a href="/school/parent-workshop/workshops/${r.workshop_id}" style="color:${P}">${esc(r.workshop_title)}</a></td>
            <td><span class="badge badge-gray">${esc(r.file_type)}</span></td>
            <td class="text-sm">${new Date(r.created_at).toLocaleDateString()}</td>
          </tr>`).join('')}
        </table></div>` : '<div class="card"><p class="text-muted text-center">No resources found.</p></div>'}
      `));
    }
  }));

  /* Add resource form */
  app.get('/school/parent-workshop/resources/add', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id, wid = parseInt(req.query.workshop_id);
    const { rows: ws } = await pool.query(`SELECT id, title FROM parent_workshops WHERE id = $1 AND tenant_id = $2`, [wid, tid]);
    if (!ws.length) return res.status(404).send('Workshop not found');
    const fileTypes = ['pdf', 'doc', 'ppt', 'video', 'audio', 'image', 'spreadsheet', 'link', 'other'];
    const typeOpts = fileTypes.map(t => `<option value="${t}">${t.toUpperCase()}</option>`).join('');
    res.send(renderPage(req, 'Add Resource', SKIP + `
      <div class="card" style="max-width:600px">
        <h2>Add Resource: ${esc(ws[0].title)}</h2>
        <form method="POST" action="/school/parent-workshop/resources/add">
          <input type="hidden" name="workshop_id" value="${wid}">
          <div class="mt-1"><label class="fw-600">Title *</label><input type="text" name="title" required></div>
          <div class="grid grid-2 mt-1">
            <div><label class="fw-600">File Type *</label><select name="file_type" required>${typeOpts}</select></div>
            <div><label class="fw-600">Sort Order</label><input type="number" name="sort_order" value="0"></div>
          </div>
          <div class="mt-1"><label class="fw-600">File URL</label><input type="url" name="file_url" placeholder="https://..."></div>
          <div class="mt-1"><label class="fw-600">Description</label><textarea name="description" rows="2"></textarea></div>
          <div class="mt-2"><button type="submit" class="btn">Add Resource</button>
            <a href="/school/parent-workshop/resources?workshop_id=${wid}" class="btn btn-outline">Cancel</a></div>
        </form>
      </div>
    `));
  }));

  app.post('/school/parent-workshop/resources/add', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { workshop_id, title, file_type, file_url, description, sort_order } = req.body;
    await pool.query(`
      INSERT INTO workshop_resources (tenant_id, workshop_id, title, file_type, file_url, description, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tid, parseInt(workshop_id), title, file_type || 'pdf', file_url || null, description || null, parseInt(sort_order) || 0]);
    audit(req, 'workshop_resource_add', { workshop_id, title });
    res.redirect(`/school/parent-workshop/resources?workshop_id=${workshop_id}`);
  }));

  app.post('/school/parent-workshop/resources/:rid/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id, rid = parseInt(req.params.rid);
    const { rows: r } = await pool.query(`SELECT workshop_id FROM workshop_resources WHERE id = $1 AND tenant_id = $2`, [rid, tid]);
    await pool.query(`DELETE FROM workshop_resources WHERE id = $1 AND tenant_id = $2`, [rid, tid]);
    audit(req, 'workshop_resource_delete', { resource_id: rid });
    res.redirect(`/school/parent-workshop/resources?workshop_id=${r.length ? r[0].workshop_id : ''}`);
  }));

  /* ════════════════════════════════════════════
     ROUTE: Feedback
     ════════════════════════════════════════════ */
  app.get('/school/parent-workshop/feedback', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { workshop_id } = req.query;
    let paramIdx = 1;
    let where = `WHERE wr.tenant_id = $${paramIdx++} AND wr.feedback_score IS NOT NULL`;
    const params = [tid];
    if (workshop_id) { where += ` AND wr.workshop_id = $${paramIdx++}`; params.push(parseInt(workshop_id)); }
    const { rows: feedback } = await pool.query(`
      SELECT wr.*, w.title AS workshop_title, w.topic, w.date
      FROM workshop_registrations wr
      JOIN parent_workshops w ON w.id = wr.workshop_id AND w.tenant_id = wr.tenant_id
      ${where} ORDER BY wr.registered_at DESC`, params);
    const { rows: summary } = await pool.query(`
      SELECT w.id, w.title, w.topic, COUNT(*) AS fb_count, ROUND(AVG(wr.feedback_score),1) AS avg_score,
        COUNT(CASE WHEN wr.feedback_score=5 THEN 1 END) AS five_star
      FROM workshop_registrations wr
      JOIN parent_workshops w ON w.id = wr.workshop_id AND w.tenant_id = wr.tenant_id
      WHERE wr.tenant_id = $1 AND wr.feedback_score IS NOT NULL
      GROUP BY w.id ORDER BY avg_score DESC`, [tid]);
    res.send(renderPage(req, 'Workshop Feedback', SKIP + `
      <h2 style="margin-bottom:16px">Workshop Feedback</h2>
      <div class="card">
        <h3>Feedback Summary by Workshop</h3>
        ${summary.length ? `<table><tr><th>Workshop</th><th>Topic</th><th>Responses</th><th>Avg Score</th><th>5-Star</th></tr>
        ${summary.map(s => `<tr>
          <td><a href="/school/parent-workshop/feedback?workshop_id=${s.id}" style="color:${P}">${esc(s.title)}</a></td>
          <td>${esc(TOPIC_LABELS[s.topic] || s.topic)}</td>
          <td class="text-center">${s.fb_count}</td>
          <td><strong>${s.avg_score}</strong> / 5</td>
          <td class="text-center">${s.five_star}</td>
        </tr>`).join('')}</table>` : '<p class="text-muted">No feedback submitted yet.</p>'}
      </div>
      ${workshop_id ? `<div class="card mt-2">
        <h3>Detailed Feedback (${feedback.length} responses)</h3>
        ${feedback.length ? `<table><tr><th>Parent</th><th>Workshop</th><th>Score</th><th>Comment</th><th>Date</th></tr>
        ${feedback.map(f => `<tr>
          <td>${esc(f.parent_name || '—')}<br><span class="text-sm text-muted">${esc(f.parent_email || '')}</span></td>
          <td class="text-sm">${esc(f.workshop_title)}</td>
          <td><span class="fw-600" style="color:${f.feedback_score >= 4 ? '#059669' : f.feedback_score >= 3 ? '#d97706' : '#dc2626'}">${f.feedback_score}/5</span>
            ${'&#x2605;'.repeat(f.feedback_score)}</td>
          <td class="text-sm">${esc(f.feedback_comment || '—')}</td>
          <td class="text-sm">${f.date}</td>
        </tr>`).join('')}</table>` : '<p class="text-muted">No feedback for this workshop.</p>'}
      </div>` : ''}
    `));
  }));

  /* Submit feedback (for parent portal use) */
  app.post('/school/parent-workshop/feedback/:rid', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id, rid = parseInt(req.params.rid);
    const { score, comment } = req.body;
    const s = Math.min(5, Math.max(1, parseInt(score) || 5));
    await pool.query(`UPDATE workshop_registrations SET feedback_score = $1, feedback_comment = $2 WHERE id = $3 AND tenant_id = $4`,
      [s, comment || null, rid, tid]);
    audit(req, 'workshop_feedback_submit', { registration_id: rid, score: s });
    const { rows: reg } = await pool.query(`SELECT workshop_id, parent_email FROM workshop_registrations WHERE id = $1 AND tenant_id = $2`, [rid, tid]);
    if (reg.length && queueEmail && reg[0].parent_email) {
      queueEmail({ to: reg[0].parent_email, subject: 'Thank you for your feedback!',
        html: '<p>Thank you for providing feedback on the workshop. Your input helps us improve future sessions.</p>' });
    }
    res.redirect('/school/parent-workshop');
  }));

  /* ════════════════════════════════════════════
     ROUTE: Certificates
     ════════════════════════════════════════════ */
  app.get('/school/parent-workshop/certificates', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { workshop_id, action } = req.query;
    if (action === 'issue' && workshop_id) {
      /* Issue certificates to all attended participants */
      const wid = parseInt(workshop_id);
      const { rowCount: result } = await pool.query(`
        UPDATE workshop_registrations SET certificate_issued = 1, certificate_issued_at = CURRENT_TIMESTAMP
        WHERE workshop_id = $1 AND tenant_id = $2 AND attended = 1 AND certificate_issued = 0`, [wid, tid]);
      audit(req, 'workshop_certificates_issue_bulk', { workshop_id: wid, count: result });
      return res.redirect(`/school/parent-workshop/certificates?workshop_id=${wid}`);
    }
    let paramIdx = 1;
    let where = `WHERE wr.tenant_id = $${paramIdx++} AND wr.certificate_issued = 1`;
    const params = [tid];
    if (workshop_id) { where += ` AND wr.workshop_id = $${paramIdx++}`; params.push(parseInt(workshop_id)); }
    const { rows: certs } = await pool.query(`
      SELECT wr.*, w.title AS workshop_title, w.topic, w.date, w.speaker
      FROM workshop_registrations wr
      JOIN parent_workshops w ON w.id = wr.workshop_id AND w.tenant_id = wr.tenant_id
      ${where} ORDER BY wr.certificate_issued_at DESC`, params);
    const { rows: workshops } = await pool.query(`
      SELECT w.id, w.title, w.date,
        COUNT(*) AS total_attended,
        SUM(wr.certificate_issued) AS certs_issued
      FROM parent_workshops w
      JOIN workshop_registrations wr ON wr.workshop_id = w.id AND wr.tenant_id = w.tenant_id
      WHERE w.tenant_id = $1 AND wr.attended = 1
      GROUP BY w.id ORDER BY w.date DESC`, [tid]);
    res.send(renderPage(req, 'Certificates', SKIP + `
      <h2 style="margin-bottom:16px">Workshop Certificates</h2>
      <div class="card">
        <h3>Certificates by Workshop</h3>
        ${workshops.length ? `<table><tr><th>Workshop</th><th>Date</th><th>Attended</th><th>Certificates</th><th>Action</th></tr>
        ${workshops.map(ws => `<tr>
          <td><a href="/school/parent-workshop/certificates?workshop_id=${ws.id}" style="color:${P}">${esc(ws.title)}</a></td>
          <td>${ws.date}</td>
          <td class="text-center">${ws.total_attended}</td>
          <td class="text-center">${ws.certs_issued}</td>
          <td><a href="/school/parent-workshop/certificates?workshop_id=${ws.id}&action=issue" class="btn btn-sm btn-success"
            onclick="return confirm('Issue certificates to all attended participants?')">Issue All</a></td>
        </tr>`).join('')}</table>` : '<p class="text-muted">No completed workshops with attendees.</p>'}
      </div>
      ${workshop_id ? `<div class="card mt-2">
        <h3>Issued Certificates (${certs.length})</h3>
        ${certs.length ? `<table><tr><th>Parent</th><th>Workshop</th><th>Date</th><th>Issued</th></tr>
        ${certs.map(c => `<tr>
          <td>${esc(c.parent_name || '—')}<br><span class="text-sm text-muted">${esc(c.parent_email || '')}</span></td>
          <td class="text-sm">${esc(c.workshop_title)}<br><span class="text-sm text-muted">${esc(c.speaker || '')}</span></td>
          <td>${c.date}</td>
          <td class="text-sm">${c.certificate_issued_at ? new Date(c.certificate_issued_at).toLocaleDateString() : '—'}</td>
        </tr>`).join('')}</table>` : '<p class="text-muted">No certificates issued for this workshop.</p>'}
      </div>` : ''}
    `));
  }));

  /* ════════════════════════════════════════════
     ROUTE: Calendar View
     ════════════════════════════════════════════ */
  app.get('/school/parent-workshop/calendar', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
    const { rows: workshops } = await pool.query(`
      SELECT * FROM parent_workshops WHERE tenant_id = $1 AND date >= $2 AND date <= $3 ORDER BY date, time`, [tid, startDate, endDate]);
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const monthName = monthNames[month - 1] || 'January';
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const prevM = month === 1 ? 12 : month - 1;
    const prevY = month === 1 ? year - 1 : year;
    const nextM = month === 12 ? 1 : month + 1;
    const nextY = month === 12 ? year + 1 : year;
    const workshopByDay = {};
    workshops.forEach(w => {
      const day = new Date(w.date).getDate();
      if (!workshopByDay[day]) workshopByDay[day] = [];
      workshopByDay[day].push(w);
    });
    let calCells = '';
    for (let i = 0; i < firstDay; i++) calCells += '<td style="background:#f9fafb;padding:8px;min-height:80px"></td>';
    for (let d = 1; d <= daysInMonth; d++) {
      const ws = workshopByDay[d] || [];
      calCells += `<td style="padding:4px;border:1px solid #e5e7eb;vertical-align:top;min-height:80px">
        <div style="font-weight:600;font-size:13px;margin-bottom:4px">${d}</div>
        ${ws.map(w => `<div style="background:${w.status === 'completed' ? '#d1fae5' : w.status === 'registration-open' ? '#dbeafe' : '#fef3c7'};padding:3px 6px;border-radius:4px;margin-bottom:2px;font-size:11px">
          <a href="/school/parent-workshop/workshops/${w.id}" style="color:#1f2937;text-decoration:none">${esc(w.title.substring(0, 20))}${w.title.length > 20 ? '...' : ''}</a>
          <br><span class="text-muted">${w.time}</span>
        </div>`).join('')}
      </td>`;
    }
    const totalCells = firstDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 0; i < remaining; i++) calCells += '<td style="background:#f9fafb;padding:8px"></td>';
    res.send(renderPage(req, 'Workshop Calendar', SKIP + `
      <div class="flex mb-2" style="justify-content:space-between;align-items:center">
        <h2>Workshop Calendar</h2>
        <a href="/school/parent-workshop" class="btn btn-outline">Back to Dashboard</a>
      </div>
      <div class="card">
        <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:16px">
          <a href="/school/parent-workshop/calendar?month=${prevM}&year=${prevY}" class="btn btn-sm btn-outline">&larr; ${monthNames[prevM - 1]}</a>
          <h3>${monthName} ${year}</h3>
          <a href="/school/parent-workshop/calendar?month=${nextM}&year=${nextY}" class="btn btn-sm btn-outline">${monthNames[nextM - 1]} &rarr;</a>
        </div>
        <table style="table-layout:fixed;width:100%">
          <tr style="background:#f3f4f6"><th style="padding:8px;text-align:center">Sun</th><th style="padding:8px;text-align:center">Mon</th>
            <th style="padding:8px;text-align:center">Tue</th><th style="padding:8px;text-align:center">Wed</th>
            <th style="padding:8px;text-align:center">Thu</th><th style="padding:8px;text-align:center">Fri</th>
            <th style="padding:8px;text-align:center">Sat</th></tr>
          <tr>${calCells.substring(0, calCells.indexOf('</tr>'))}</tr>
        </table>
        <div style="margin-top:12px;display:flex;gap:16px;font-size:12px">
          <span><span style="display:inline-block;width:12px;height:12px;background:#d1fae5;border-radius:2px"></span> Completed</span>
          <span><span style="display:inline-block;width:12px;height:12px;background:#dbeafe;border-radius:2px"></span> Open</span>
          <span><span style="display:inline-block;width:12px;height:12px;background:#fef3c7;border-radius:2px"></span> Other</span>
        </div>
      </div>
      <div class="card mt-2">
        <h3>Upcoming Workshops</h3>
        ${workshops.filter(w => new Date(w.date) >= new Date()).length
          ? `<table><tr><th>Title</th><th>Date</th><th>Time</th><th>Mode</th><th>Status</th><th></th></tr>
          ${workshops.filter(w => new Date(w.date) >= new Date()).map(w => `<tr>
            <td>${esc(w.title)}</td><td>${w.date}</td><td>${w.time}</td>
            <td>${modeBadge(w.mode)}</td><td>${statusBadge(w.status)}</td>
            <td><a href="/school/parent-workshop/workshops/${w.id}" class="btn btn-sm btn-outline">View</a></td>
          </tr>`).join('')}</table>`
          : '<p class="text-muted">No upcoming workshops this month.</p>'}
      </div>
    `));
  }));

  /* ════════════════════════════════════════════
     ROUTE: Speakers
     ════════════════════════════════════════════ */
  app.get('/school/parent-workshop/speakers', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { rows: speakers } = await pool.query(`
      SELECT speaker, speaker_bio, COUNT(*) AS workshop_count,
        MIN(date) AS first_workshop, MAX(date) AS last_workshop,
        ROUND(AVG(wr.feedback_score), 1) AS avg_feedback
      FROM parent_workshops w
      LEFT JOIN workshop_registrations wr ON wr.workshop_id = w.id AND wr.tenant_id = w.tenant_id AND wr.feedback_score IS NOT NULL
      WHERE w.tenant_id = $1 AND w.speaker IS NOT NULL AND w.speaker != ''
      GROUP BY speaker, speaker_bio
      ORDER BY workshop_count DESC`, [tid]);
    const { rows: workshopsBySpeaker } = await pool.query(`
      SELECT speaker, w.id, w.title, w.date, w.topic, w.status
      FROM parent_workshops w
      WHERE w.tenant_id = $1 AND w.speaker IS NOT NULL AND w.speaker != ''
      ORDER BY w.date DESC`, [tid]);
    const speakerWorkshops = {};
    workshopsBySpeaker.forEach(w => {
      if (!speakerWorkshops[w.speaker]) speakerWorkshops[w.speaker] = [];
      speakerWorkshops[w.speaker].push(w);
    });
    res.send(renderPage(req, 'Speakers', SKIP + `
      <div class="flex mb-2" style="justify-content:space-between;align-items:center">
        <h2>Workshop Speakers (${speakers.length})</h2>
        <a href="/school/parent-workshop" class="btn btn-outline">Back</a>
      </div>
      ${speakers.length ? `<div class="grid grid-2">
        ${speakers.map(s => `<div class="card">
          <h3 style="margin-bottom:4px">${esc(s.speaker)}</h3>
          ${s.speaker_bio ? `<p class="text-sm text-muted mb-1">${esc(s.speaker_bio)}</p>` : ''}
          <div class="flex gap-1 mt-1" style="flex-wrap:wrap">
            <span class="badge badge-blue">${s.workshop_count} workshops</span>
            <span class="badge badge-green">Avg feedback: ${s.avg_feedback || '—'}</span>
            <span class="badge badge-gray">${s.first_workshop} – ${s.last_workshop}</span>
          </div>
          ${(speakerWorkshops[s.speaker] || []).length ? `<div class="mt-1">
            <strong class="text-sm">Recent sessions:</strong>
            <ul style="margin:4px 0;padding-left:20px;font-size:13px">
              ${speakerWorkshops[s.speaker].slice(0, 3).map(ws => `<li>
                <a href="/school/parent-workshop/workshops/${ws.id}" style="color:${P}">${esc(ws.title)}</a>
                (${ws.date}) ${statusBadge(ws.status)}
              </li>`).join('')}
            </ul>
          </div>` : ''}
        </div>`).join('')}
      </div>` : '<div class="card"><p class="text-muted text-center">No speakers listed yet. Add speakers when creating workshops.</p></div>'}
    `));
  }));

  /* ════════════════════════════════════════════
     ROUTE: Public Workshop Listing (parent-facing)
     ════════════════════════════════════════════ */
  app.get('/school/parent-workshop/public', requireAuth, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { rows: workshops } = await pool.query(`
      SELECT id, title, description, topic, speaker, date, time, duration, venue, mode, max_participants, cover_image,
        (SELECT COUNT(*) FROM workshop_registrations WHERE workshop_id = parent_workshops.id) AS reg_count
      FROM parent_workshops
      WHERE tenant_id = $1 AND status IN ('published','registration-open')
      AND date >= CURRENT_DATE
      ORDER BY date ASC, time ASC`, [tid]);
    const topicTabs = [...new Set(workshops.map(w => w.topic))];
    res.send(renderPage(req, 'Upcoming Workshops', SKIP + `
      <h2 style="margin-bottom:4px">Upcoming Parent Workshops</h2>
      <p class="text-muted mb-2">Register for workshops to enhance your parenting skills and knowledge</p>
      ${topicTabs.length > 1 ? `<div class="flex gap-1 mb-2" style="flex-wrap:wrap">
        <span class="badge badge-blue" style="padding:6px 14px;cursor:pointer;font-size:13px" onclick="document.querySelectorAll('.ws-card').forEach(c=>c.style.display='block')">All</span>
        ${topicTabs.map(t => `<span class="badge badge-gray" style="padding:6px 14px;cursor:pointer;font-size:13px"
          onclick="document.querySelectorAll('.ws-card').forEach(c=>c.style.display='none');document.querySelectorAll('.ws-${t}').forEach(c=>c.style.display='block')">${esc(TOPIC_LABELS[t] || t)}</span>`).join('')}
      </div>` : ''}
      ${workshops.length ? `<div class="grid grid-2">
        ${workshops.map(w => `<div class="card ws-card ws-${w.topic}">
          ${w.cover_image ? `<img src="${esc(w.cover_image)}" style="width:100%;height:140px;object-fit:cover;border-radius:8px;margin-bottom:12px" alt="${esc(w.title)}">` : ''}
          <div class="flex gap-1 mb-1">${modeBadge(w.mode)} <span class="badge badge-gray">${esc(TOPIC_LABELS[w.topic] || w.topic)}</span></div>
          <h3>${esc(w.title)}</h3>
          ${w.description ? `<p class="text-sm text-muted">${esc(w.description.substring(0, 120))}${w.description.length > 120 ? '...' : ''}</p>` : ''}
          <div class="text-sm mt-1" style="color:${GRAY}">
            <div>&#x1f4c5; ${w.date} at ${w.time} (${w.duration} min)</div>
            ${w.venue ? `<div>&#x1f3e2; ${esc(w.venue)}</div>` : ''}
            ${w.speaker ? `<div>&#x1f468;&#x200d;&#x1f3eb; ${esc(w.speaker)}</div>` : ''}
            <div>&#x1f465; ${w.reg_count}/${w.max_participants} registered</div>
          </div>
          <div class="mt-2">
            ${w.status === 'registration-open'
              ? `<a href="/school/parent-workshop/register/${w.id}" class="btn btn-success w-full">Register Now</a>`
              : `<span class="badge badge-yellow">Coming Soon</span>`}
          </div>
        </div>`).join('')}
      </div>` : '<div class="card text-center"><p class="text-muted">No upcoming workshops available at this time. Check back soon!</p></div>'}
    `));
  }));

  /* ════════════════════════════════════════════
     ROUTE: API – Workshop Stats (JSON)
     ════════════════════════════════════════════ */
  app.get('/school/parent-workshop/api/stats', requireAuth, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { rows: ws } = await pool.query(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status='registration-open' THEN 1 ELSE 0 END) AS open
      FROM parent_workshops WHERE tenant_id = $1`, [tid]);
    const { rows: reg } = await pool.query(`
      SELECT COUNT(*) AS registrations, SUM(attended) AS attended,
        ROUND(AVG(feedback_score),1) AS avg_feedback, SUM(certificate_issued) AS certificates
      FROM workshop_registrations wr
      JOIN parent_workshops w ON w.id = wr.workshop_id AND w.tenant_id = wr.tenant_id
      WHERE wr.tenant_id = $1`, [tid]);
    res.json({ workshops: ws[0], registrations: reg[0] || {} });
  }));

  /* ════════════════════════════════════════════
     ROUTE: API – Export Registrations CSV
     ════════════════════════════════════════════ */
  app.get('/school/parent-workshop/api/export/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id, wid = parseInt(req.params.id);
    const { rows: ws } = await pool.query(`SELECT title FROM parent_workshops WHERE id = $1 AND tenant_id = $2`, [wid, tid]);
    if (!ws.length) return res.status(404).json({ error: 'Workshop not found' });
    const { rows: regs } = await pool.query(`
      SELECT parent_name, parent_email, registered_at, attended, attended_at,
        feedback_score, feedback_comment, certificate_issued
      FROM workshop_registrations WHERE workshop_id = $1 AND tenant_id = $2 ORDER BY registered_at`, [wid, tid]);
    const header = 'Parent Name,Email,Registered,Attended,Attended At,Feedback Score,Comment,Certificate Issued\n';
    const rows = regs.map(r =>
      `"${(r.parent_name || '').replace(/"/g, '""')}","${(r.parent_email || '').replace(/"/g, '""')}","${r.registered_at || ''}","${r.attended ? 'Yes' : 'No'}","${r.attended_at || ''}","${r.feedback_score || ''}","${(r.feedback_comment || '').replace(/"/g, '""')}","${r.certificate_issued ? 'Yes' : 'No'}"`
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="workshop-${wid}-registrations.csv"`);
    res.send(header + rows);
    audit(req, 'workshop_export_csv', { workshop_id: wid, count: regs.length });
  }));

  console.log('[ParentWorkshop] Module loaded – /school/parent-workshop/*');
};
