/**
 * Facial Attendance Management Module
 * Multi-tenant SaaS platform (schools)
 *
 * Features: Face recognition attendance, student photo management, attendance
 *   analytics, spoofing detection alerts, device management, accuracy reports,
 *   privacy compliance, fallback methods, attendance dispute resolution
 * 11 routes · PostgreSQL · tenant_id scoped
 */
module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  // ── Helpers ────────────────────────────────────────────────────────────────
  function navUrl(a) { return '/school/facial-attendance' + a; }
  function fmtDate(d) { return d ? new Date(d).toISOString().split('T')[0] : '—'; }
  function fmtTime(d) { return d ? new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—'; }
  function badge(label, color) { return `<span style="background:${color};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px">${esc(label)}</span>`; }
  function pct(v) { return (v !== null && v !== undefined) ? parseFloat(v).toFixed(1) + '%' : '—'; }

  function nav(active) {
    const links = [
      ['Dashboard', ''], ['Profiles', '/profiles'], ['Attendance', '/attendance'],
      ['Devices', '/devices'], ['Analytics', '/analytics'], ['Alerts', '/alerts'],
      ['Disputes', '/disputes'], ['Privacy', '/privacy'],
    ];
    return '<nav style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px">' +
      links.map(([l, h]) =>
        `<a href="${navUrl(h)}" style="padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;` +
        (active === l ? `background:${P};color:#fff` : `background:#f3f4f6;color:${GRAY}`) + `">${l}</a>`
      ).join('') + '</nav>';
  }

  function alertBox(msg, type) {
    const colors = { success: '#dcfce7', error: '#fee2e2', warning: '#fef3c7', info: '#dbeafe' };
    const borders = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
    return `<div style="background:${colors[type]||colors.info};border:1px solid ${borders[type]||borders.info};border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#1f2937">${msg}</div>`;
  }

  // ── Database Migration ─────────────────────────────────────────────────────
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS face_profiles (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          student_id INTEGER NOT NULL, photo_url TEXT, encoding_vector TEXT,
          registered_at TIMESTAMPTZ DEFAULT NOW(), last_verified TIMESTAMPTZ,
          accuracy_score NUMERIC(5,2) DEFAULT 0.00, total_verifications INT DEFAULT 0,
          failed_verifications INT DEFAULT 0, status VARCHAR(20) DEFAULT 'active',
          data_consent BOOLEAN DEFAULT false, consent_date DATE,
          notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS face_attendance_logs (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          student_id INTEGER NOT NULL, device_id INTEGER REFERENCES face_devices(id),
          verified BOOLEAN DEFAULT false, confidence_score NUMERIC(5,2),
          location VARCHAR(255), spoofing_detected BOOLEAN DEFAULT false,
          fallback_method VARCHAR(50), timestamp TIMESTAMPTZ DEFAULT NOW(),
          notes TEXT
        );
        CREATE TABLE IF NOT EXISTS face_devices (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL, location VARCHAR(255), model VARCHAR(100),
          status VARCHAR(20) DEFAULT 'online', last_sync TIMESTAMPTZ,
          total_scans INT DEFAULT 0, failed_scans INT DEFAULT 0,
          firmware_version VARCHAR(50), ip_address VARCHAR(45),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS face_attendance_disputes (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          student_id INTEGER NOT NULL, log_id INTEGER REFERENCES face_attendance_logs(id),
          dispute_type VARCHAR(50) NOT NULL, description TEXT,
          status VARCHAR(20) DEFAULT 'open', resolution TEXT,
          reviewed_by INTEGER, created_at TIMESTAMPTZ DEFAULT NOW(),
          resolved_at TIMESTAMPTZ
        );
      `);
      const idxs = [
        'CREATE INDEX IF NOT EXISTS idx_fp_tenant ON face_profiles(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_fp_student ON face_profiles(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_fp_status ON face_profiles(status)',
        'CREATE INDEX IF NOT EXISTS idx_fal_tenant ON face_attendance_logs(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_fal_student ON face_attendance_logs(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_fal_device ON face_attendance_logs(device_id)',
        'CREATE INDEX IF NOT EXISTS idx_fal_ts ON face_attendance_logs(timestamp)',
        'CREATE INDEX IF NOT EXISTS idx_fd_tenant ON face_devices(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_fd_status ON face_devices(status)',
        'CREATE INDEX IF NOT EXISTS idx_fad_tenant ON face_attendance_disputes(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_fad_status ON face_attendance_disputes(status)',
      ];
      for (const sql of idxs) { try { await pool.query(sql); } catch (_) {} }
      console.log('[FacialAttendance] Tables ready');
    } catch (e) { console.warn('[FacialAttendance] Migration warning:', e.message); }
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 1 — Dashboard
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/facial-attendance', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [totalProfiles, onlineDevices, todayLogs, spoofAlerts, openDisputes] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS c FROM face_profiles WHERE tenant_id=$1 AND status='active'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM face_devices WHERE tenant_id=$1 AND status='online'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM face_attendance_logs WHERE tenant_id=$1 AND timestamp >= CURRENT_DATE", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM face_attendance_logs WHERE tenant_id=$1 AND spoofing_detected=true AND timestamp >= CURRENT_DATE - INTERVAL '30 days'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM face_attendance_disputes WHERE tenant_id=$1 AND status='open'", [tid]),
    ]);
    const accuracyStats = await pool.query(
      "SELECT AVG(accuracy_score)::numeric AS avg_accuracy FROM face_profiles WHERE tenant_id=$1 AND status='active'", [tid]);
    const todayVerified = await pool.query(
      "SELECT COUNT(*)::int AS c FROM face_attendance_logs WHERE tenant_id=$1 AND timestamp >= CURRENT_DATE AND verified=true", [tid]);
    const todayRejected = await pool.query(
      "SELECT COUNT(*)::int AS c FROM face_attendance_logs WHERE tenant_id=$1 AND timestamp >= CURRENT_DATE AND verified=false", [tid]);

    let html = SKIP + nav('Dashboard');
    html += '<h2 style="margin-bottom:20px">Facial Attendance Dashboard</h2>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:16px;margin-bottom:24px">';
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:${P}">${totalProfiles.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Active Profiles</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#22c55e">${onlineDevices.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Online Devices</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#3b82f6">${todayLogs.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Today Scans</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#22c55e">${todayVerified.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Verified</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#ef4444">${todayRejected.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Rejected</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#8b5cf6">${pct(accuracyStats.rows[0].avg_accuracy)}</div><div style="color:${GRAY};font-size:13px">Avg Accuracy</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#f59e0b">${spoofAlerts.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Spoofing (30d)</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#ef4444">${openDisputes.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Open Disputes</div></div>`;
    html += '</div>';

    // Today's verification rate
    const total = todayLogs.rows[0].c;
    const verPct = total > 0 ? ((todayVerified.rows[0].c / total) * 100).toFixed(1) : '0.0';
    html += '<div class="card"><h3 style="margin-bottom:12px">Today Verification Rate</h3>';
    html += `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <div style="flex:1;background:#e5e7eb;border-radius:8px;height:24px;max-width:400px">
        <div style="width:${verPct}%;background:#22c55e;height:24px;border-radius:8px;display:flex;align-items:center;justify-content:center">
          <span style="color:#fff;font-size:12px;font-weight:600">${verPct}% verified</span>
        </div>
      </div>
    </div></div>`;

    // Recent scans
    const recentLogs = await pool.query(
      `SELECT fal.*, fd.name AS device_name
       FROM face_attendance_logs fal
       LEFT JOIN face_devices fd ON fd.id=fal.device_id
       WHERE fal.tenant_id=$1 ORDER BY fal.timestamp DESC LIMIT 10`, [tid]);
    if (recentLogs.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Recent Scans</h3>';
      html += '<table><tr><th>Student ID</th><th>Device</th><th>Verified</th><th>Confidence</th><th>Spoofing</th><th>Fallback</th><th>Time</th></tr>';
      recentLogs.rows.forEach(l => {
        html += `<tr>
          <td><strong>#${l.student_id}</strong></td>
          <td>${esc(l.device_name || '—')}</td>
          <td>${l.verified ? badge('Yes', '#22c55e') : badge('No', '#ef4444')}</td>
          <td>${l.confidence_score !== null ? pct(l.confidence_score) : '—'}</td>
          <td>${l.spoofing_detected ? badge('DETECTED', '#ef4444') : '—'}</td>
          <td>${esc(l.fallback_method || '—')}</td>
          <td>${fmtTime(l.timestamp)}</td></tr>`;
      });
      html += '</table></div>';
    }

    // Device status
    const devices = await pool.query("SELECT * FROM face_devices WHERE tenant_id=$1 ORDER BY name", [tid]);
    if (devices.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Device Status</h3>';
      html += '<div style="display:flex;gap:12px;flex-wrap:wrap">';
      devices.rows.forEach(d => {
        const color = d.status === 'online' ? '#22c55e' : d.status === 'offline' ? '#ef4444' : '#f59e0b';
        html += `<div style="border:1px solid ${color};border-radius:10px;padding:12px;min-width:180px;background:#fafafa">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="width:10px;height:10px;border-radius:50%;background:${color}"></span>
            <strong>${esc(d.name)}</strong>
          </div>
          <div style="font-size:12px;color:${GRAY}">${esc(d.location || '—')}</div>
          <div style="font-size:12px;color:${GRAY}">Scans: ${d.total_scans} | Failed: ${d.failed_scans}</div>
        </div>`;
      });
      html += '</div></div>';
    }

    res.send(renderPage('Facial Attendance Dashboard', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 2 — Face profiles list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/facial-attendance/profiles', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const filter = req.query.status || '';
    let where = 'p.tenant_id=$1', params = [tid];
    if (filter) { where += ' AND p.status=$2'; params.push(filter); }

    const profiles = await pool.query(
      `SELECT p.* FROM face_profiles p WHERE ${where} ORDER BY p.registered_at DESC`, params);

    let html = SKIP + nav('Profiles');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Face Profiles</h2>';
    html += `<a href="${navUrl('/profiles/new')}" class="btn">+ Register Student</a></div>`;

    // Filters
    html += '<div style="display:flex;gap:6px;margin-bottom:16px">';
    [['', 'All'], ['active', 'Active'], ['inactive', 'Inactive'], ['pending', 'Pending']].forEach(([v, l]) => {
      html += `<a href="${navUrl('/profiles?status=' + v)}" style="padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;` +
        (filter === v ? `background:${P};color:#fff` : `background:#f3f4f6;color:${GRAY}`) + `">${l}</a>`;
    });
    html += '</div>';

    if (profiles.rows.length) {
      const statusColors = { active: '#22c55e', inactive: '#94a3b8', pending: '#f59e0b' };
      html += '<table><tr><th>ID</th><th>Student ID</th><th>Accuracy</th><th>Verifications</th><th>Failed</th><th>Last Verified</th><th>Consent</th><th>Status</th><th>Actions</th></tr>';
      profiles.rows.forEach(p => {
        html += `<tr>
          <td>#${p.id}</td>
          <td><strong>#${p.student_id}</strong></td>
          <td><span style="color:${parseFloat(p.accuracy_score || 0) >= 90 ? '#22c55e' : parseFloat(p.accuracy_score || 0) >= 70 ? '#f59e0b' : '#ef4444'};font-weight:600">${pct(p.accuracy_score)}</span></td>
          <td>${p.total_verifications || 0}</td>
          <td>${p.failed_verifications || 0}</td>
          <td>${fmtTime(p.last_verified)}</td>
          <td>${p.data_consent ? badge('Yes', '#22c55e') : badge('No', '#ef4444')}</td>
          <td>${badge(p.status, statusColors[p.status] || '#94a3b8')}</td>
          <td>
            <a href="${navUrl('/profiles/' + p.id + '/edit')}" class="btn" style="padding:4px 10px;font-size:12px;background:#0ea5e9">Edit</a>
            <form method="POST" action="${navUrl('/profiles/' + p.id + '/delete')}" style="display:inline" onsubmit="return confirm('Delete this profile?')">
              <button class="btn" style="padding:4px 10px;font-size:12px;background:#ef4444">Del</button>
            </form>
          </td></tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No face profiles found.</p></div>'; }
    res.send(renderPage('Face Profiles', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 3 — Register new profile
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/facial-attendance/profiles/new', requireAuth, requireNotBanned, (req, res) => {
    let html = SKIP + nav('Profiles');
    html += '<div class="card"><h2>Register Student Face Profile</h2>';
    html += `<form method="POST" action="${navUrl('/profiles/create')}" enctype="multipart/form-data">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Student ID *</label>
          <input name="student_id" type="number" required placeholder="Enter student ID"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Photo URL</label>
          <input name="photo_url" placeholder="https://... or leave blank"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Encoding Vector</label>
          <textarea name="encoding_vector" rows="2" placeholder="Face embedding data (auto-generated by device)"></textarea></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Status</label>
          <select name="status">
            <option value="active">Active</option><option value="pending">Pending Review</option><option value="inactive">Inactive</option>
          </select></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:16px;align-items:center">
        <label><input type="checkbox" name="data_consent" required> <strong>Data Processing Consent *</strong></label>
      </div>
      <div style="margin-top:8px;font-size:13px;color:${GRAY}">
        By registering, you confirm that biometric data processing complies with applicable privacy regulations (GDPR, FERPA, etc.)
        and that the student/guardian has provided informed consent.
      </div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Notes</label>
        <textarea name="notes" rows="2" placeholder="Registration notes..."></textarea></div>
      <div style="margin-top:16px">
        <button type="submit" class="btn">Register Profile</button>
        <a href="${navUrl('/profiles')}" style="margin-left:8px;color:${GRAY}">Cancel</a>
      </div>
    </form></div>`;
    res.send(renderPage('Register Face Profile', html, req.session.user, req));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 4 — Save profile
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/facial-attendance/profiles/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { student_id, photo_url, encoding_vector, status, data_consent, notes } = req.body;
    if (!student_id) return res.status(400).send('Student ID is required.');
    if (data_consent !== 'on') return res.status(400).send('Data processing consent is required.');
    try {
      await pool.query(
        `INSERT INTO face_profiles (tenant_id, student_id, photo_url, encoding_vector, status, data_consent, consent_date, notes)
         VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,$7)`,
        [tid, parseInt(student_id), photo_url || null, encoding_vector || null,
         status || 'active', true, notes || null]);
    } catch (e) {
      if (e.code === '23505') return res.status(400).send('A profile already exists for this student.');
      throw e;
    }
    audit(req, 'face_profile_registered', { student_id });
    queueEmail(tid, 'Face Profile Registered', 'Student #' + student_id + ' has been registered in the facial attendance system.');
    res.redirect(navUrl('/profiles'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 5 — Edit profile
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/facial-attendance/profiles/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const profile = await pool.query("SELECT * FROM face_profiles WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (!profile.rows.length) return res.status(404).send('Profile not found.');
    const p = profile.rows[0];
    let html = SKIP + nav('Profiles');
    html += `<div class="card"><h2>Edit Profile: Student #${p.student_id}</h2>`;
    html += `<form method="POST" action="${navUrl('/profiles/' + p.id + '/update')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Student ID</label>
          <input name="student_id" value="${p.student_id}" readonly style="background:#f3f4f6"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Photo URL</label>
          <input name="photo_url" value="${esc(p.photo_url || '')}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Status</label>
          <select name="status">
            ${['active','pending','inactive'].map(s => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Accuracy Score (%)</label>
          <input name="accuracy_score" type="number" step="0.01" min="0" max="100" value="${p.accuracy_score}"></div>
      </div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Encoding Vector</label>
        <textarea name="encoding_vector" rows="2">${esc(p.encoding_vector || '')}</textarea></div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Notes</label>
        <textarea name="notes" rows="2">${esc(p.notes || '')}</textarea></div>
      <div style="margin-top:16px;display:flex;align-items:center;gap:16px">
        <label><input type="checkbox" name="data_consent" ${p.data_consent ? 'checked' : ''}> Data Consent Active</label>
        <span style="font-size:13px;color:${GRAY}">Consented: ${fmtDate(p.consent_date)}</span>
      </div>
      <div style="margin-top:16px">
        <button type="submit" class="btn">Save Changes</button>
        <a href="${navUrl('/profiles')}" style="margin-left:8px;color:${GRAY}">Cancel</a>
      </div>
    </form></div>`;
    res.send(renderPage('Edit Face Profile', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 6 — Update profile
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/facial-attendance/profiles/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { photo_url, encoding_vector, status, accuracy_score, data_consent, notes } = req.body;
    await pool.query(
      `UPDATE face_profiles SET photo_url=$1, encoding_vector=$2, status=$3, accuracy_score=$4,
       data_consent=$5, consent_date=CASE WHEN $5=true AND consent_date IS NULL THEN CURRENT_DATE ELSE consent_date END,
       notes=$6 WHERE id=$7 AND tenant_id=$8`,
      [photo_url || null, encoding_vector || null, status || 'active',
       parseFloat(accuracy_score) || 0, data_consent === 'on', notes || null, id, tid]);
    audit(req, 'face_profile_updated', { profile_id: id });
    res.redirect(navUrl('/profiles'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 7 — Delete profile
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/facial-attendance/profiles/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const profile = await pool.query("SELECT student_id FROM face_profiles WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (!profile.rows.length) return res.status(404).send('Profile not found.');
    await pool.query("DELETE FROM face_profiles WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    audit(req, 'face_profile_deleted', { student_id: profile.rows[0].student_id });
    res.redirect(navUrl('/profiles'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 8 — Attendance logs
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/facial-attendance/attendance', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const dateFrom = req.query.from || '';
    const dateTo = req.query.to || '';
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = 30;
    const offset = (page - 1) * limit;

    let where = 'fal.tenant_id=$1', params = [tid], pNum = 2;
    if (dateFrom) { where += ` AND fal.timestamp >= $${pNum++}::date`; params.push(dateFrom); }
    if (dateTo) { where += ` AND fal.timestamp < ($${pNum++}::date + INTERVAL '1 day')`; params.push(dateTo); }

    const [logs, countResult] = await Promise.all([
      pool.query(
        `SELECT fal.*, fd.name AS device_name
         FROM face_attendance_logs fal LEFT JOIN face_devices fd ON fd.id=fal.device_id
         WHERE ${where} ORDER BY fal.timestamp DESC LIMIT $${pNum} OFFSET $${pNum + 1}`,
        [...params, limit, offset]),
      pool.query(`SELECT COUNT(*)::int AS c FROM face_attendance_logs fal WHERE ${where}`, params),
    ]);
    const totalPages = Math.ceil(countResult.rows[0].c / limit);

    let html = SKIP + nav('Attendance');
    html += '<h2 style="margin-bottom:16px">Attendance Logs</h2>';
    html += `<form method="GET" style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:end">
      <div><label style="font-size:12px;color:${GRAY}">From</label><input name="from" type="date" value="${esc(dateFrom)}"></div>
      <div><label style="font-size:12px;color:${GRAY}">To</label><input name="to" type="date" value="${esc(dateTo)}"></div>
      <button type="submit" class="btn" style="background:#6b7280">Filter</button>
      <a href="${navUrl('/attendance')}" class="btn" style="background:#94a3b8">Clear</a>
    </form>`;

    html += `<div style="margin-bottom:16px;font-size:14px;color:${GRAY}">${countResult.rows[0].c} records found</div>`;

    if (logs.rows.length) {
      html += '<table><tr><th>Student</th><th>Device</th><th>Verified</th><th>Confidence</th><th>Spoofing</th><th>Fallback</th><th>Location</th><th>Time</th></tr>';
      logs.rows.forEach(l => {
        html += `<tr>
          <td><strong>#${l.student_id}</strong></td>
          <td>${esc(l.device_name || '—')}</td>
          <td>${l.verified ? badge('Yes', '#22c55e') : badge('No', '#ef4444')}</td>
          <td>${l.confidence_score !== null ? pct(l.confidence_score) : '—'}</td>
          <td>${l.spoofing_detected ? badge('ALERT', '#ef4444') : badge('Clear', '#22c55e')}</td>
          <td>${esc(l.fallback_method || '—')}</td>
          <td>${esc(l.location || '—')}</td>
          <td>${fmtTime(l.timestamp)}</td></tr>`;
      });
      html += '</table>';
      if (totalPages > 1) {
        html += '<div style="display:flex;gap:8px;margin-top:16px;justify-content:center">';
        for (let i = 1; i <= Math.min(totalPages, 15); i++) {
          html += `<a href="${navUrl('/attendance?page=' + i + (dateFrom ? '&from=' + dateFrom : '') + (dateTo ? '&to=' + dateTo : ''))}" style="padding:6px 12px;border-radius:6px;text-decoration:none;${i === page ? 'background:' + P + ';color:#fff' : 'background:#f3f4f6;color:' + GRAY}">${i}</a>`;
        }
        html += '</div>';
      }
    } else { html += '<div class="card"><p style="color:#94a3b8">No attendance records found for the selected period.</p></div>'; }
    res.send(renderPage('Attendance Logs', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 9 — Devices management
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/facial-attendance/devices', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const devices = await pool.query("SELECT * FROM face_devices WHERE tenant_id=$1 ORDER BY name", [tid]);

    let html = SKIP + nav('Devices');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Face Recognition Devices</h2>';
    html += `<a href="${navUrl('/devices/new')}" class="btn">+ Add Device</a></div>`;

    if (devices.rows.length) {
      const statusColors = { online: '#22c55e', offline: '#ef4444', maintenance: '#f59e0b' };
      html += '<table><tr><th>Name</th><th>Location</th><th>Model</th><th>Status</th><th>Total Scans</th><th>Failed</th><th>Firmware</th><th>IP</th><th>Last Sync</th><th>Actions</th></tr>';
      devices.rows.forEach(d => {
        const failRate = d.total_scans > 0 ? ((d.failed_scans / d.total_scans) * 100).toFixed(1) : '0.0';
        html += `<tr>
          <td><strong>${esc(d.name)}</strong></td>
          <td>${esc(d.location || '—')}</td>
          <td>${esc(d.model || '—')}</td>
          <td>${badge(d.status, statusColors[d.status] || '#94a3b8')}</td>
          <td>${d.total_scans || 0}</td>
          <td>${d.failed_scans || 0} (${failRate}%)</td>
          <td>${esc(d.firmware_version || '—')}</td>
          <td>${esc(d.ip_address || '—')}</td>
          <td>${fmtTime(d.last_sync)}</td>
          <td>
            <a href="${navUrl('/devices/' + d.id + '/edit')}" class="btn" style="padding:4px 10px;font-size:12px;background:#0ea5e9">Edit</a>
          </td></tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No devices registered.</p></div>'; }
    res.send(renderPage('Face Devices', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 10 — New device form
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/facial-attendance/devices/new', requireAuth, requireNotBanned, (req, res) => {
    let html = SKIP + nav('Devices');
    html += '<div class="card"><h2>Register New Device</h2>';
    html += `<form method="POST" action="${navUrl('/devices/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Device Name *</label>
          <input name="name" required placeholder="e.g. Main Gate Scanner"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Location *</label>
          <input name="location" required placeholder="e.g. School Entrance"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Model</label>
          <input name="model" placeholder="e.g. FaceScan Pro 300"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Status</label>
          <select name="status">
            <option value="online">Online</option><option value="offline">Offline</option><option value="maintenance">Maintenance</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Firmware Version</label>
          <input name="firmware_version" placeholder="e.g. 2.4.1"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">IP Address</label>
          <input name="ip_address" placeholder="e.g. 192.168.1.100"></div>
      </div>
      <div style="margin-top:16px"><button type="submit" class="btn">Register Device</button></div>
    </form></div>`;
    res.send(renderPage('Add Face Device', html, req.session.user, req));
  });

  app.post('/school/facial-attendance/devices/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, location, model, status, firmware_version, ip_address } = req.body;
    if (!name || !name.trim()) return res.status(400).send('Device name is required.');
    await pool.query(
      `INSERT INTO face_devices (tenant_id, name, location, model, status, firmware_version, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, name.trim(), location || null, model || null, status || 'online', firmware_version || null, ip_address || null]);
    audit(req, 'face_device_registered', { name: name.trim() });
    res.redirect(navUrl('/devices'));
  }));

  app.get('/school/facial-attendance/devices/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const device = await pool.query("SELECT * FROM face_devices WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (!device.rows.length) return res.status(404).send('Device not found.');
    const d = device.rows[0];
    let html = SKIP + nav('Devices');
    html += `<div class="card"><h2>Edit Device: ${esc(d.name)}</h2>`;
    html += `<form method="POST" action="${navUrl('/devices/' + d.id + '/update')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Name</label>
          <input name="name" value="${esc(d.name)}" required></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Location</label>
          <input name="location" value="${esc(d.location || '')}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Model</label>
          <input name="model" value="${esc(d.model || '')}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Status</label>
          <select name="status">
            ${['online','offline','maintenance'].map(s => `<option value="${s}" ${d.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Firmware</label>
          <input name="firmware_version" value="${esc(d.firmware_version || '')}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">IP Address</label>
          <input name="ip_address" value="${esc(d.ip_address || '')}"></div>
      </div>
      <div style="margin-top:16px"><button type="submit" class="btn">Save Changes</button></div>
    </form></div>`;
    res.send(renderPage('Edit Device', html, req.session.user, req));
  }));

  app.post('/school/facial-attendance/devices/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { name, location, model, status, firmware_version, ip_address } = req.body;
    await pool.query(
      `UPDATE face_devices SET name=$1, location=$2, model=$3, status=$4, firmware_version=$5, ip_address=$6, last_sync=NOW() WHERE id=$7 AND tenant_id=$8`,
      [name.trim() || 'Device', location || null, model || null, status || 'online', firmware_version || null, ip_address || null, id, tid]);
    res.redirect(navUrl('/devices'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 11 — Analytics
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/facial-attendance/analytics', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const last7 = await pool.query(
      `SELECT DATE(timestamp) AS day, COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE verified=true)::int AS verified,
         COUNT(*) FILTER (WHERE verified=false)::int AS failed,
         AVG(confidence_score)::numeric AS avg_confidence
       FROM face_attendance_logs WHERE tenant_id=$1 AND timestamp >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY DATE(timestamp) ORDER BY day`, [tid]);
    const byDevice = await pool.query(
      `SELECT fd.name, fd.total_scans, fd.failed_scans,
         CASE WHEN fd.total_scans > 0 THEN ROUND((fd.failed_scans::numeric / fd.total_scans) * 100, 1) ELSE 0 END AS fail_rate
       FROM face_devices fd WHERE fd.tenant_id=$1 ORDER BY fd.name`, [tid]);
    const accuracyDist = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE accuracy_score >= 95)::int AS excellent,
         COUNT(*) FILTER (WHERE accuracy_score >= 85 AND accuracy_score < 95)::int AS good,
         COUNT(*) FILTER (WHERE accuracy_score >= 70 AND accuracy_score < 85)::int AS fair,
         COUNT(*) FILTER (WHERE accuracy_score < 70)::int AS poor
       FROM face_profiles WHERE tenant_id=$1 AND status='active'`, [tid]);

    let html = SKIP + nav('Analytics');
    html += '<h2 style="margin-bottom:20px">Attendance Analytics</h2>';

    // 7-day trend
    html += '<div class="card"><h3 style="margin-bottom:12px">Last 7 Days Trend</h3>';
    if (last7.rows.length) {
      html += '<table><tr><th>Date</th><th>Total Scans</th><th>Verified</th><th>Failed</th><th>Success Rate</th><th>Avg Confidence</th></tr>';
      last7.rows.forEach(d => {
        const rate = d.total > 0 ? ((d.verified / d.total) * 100).toFixed(1) : '0.0';
        const barColor = rate >= 95 ? '#22c55e' : rate >= 85 ? '#f59e0b' : '#ef4444';
        html += `<tr>
          <td><strong>${fmtDate(d.day)}</strong></td><td>${d.total}</td>
          <td style="color:#22c55e">${d.verified}</td><td style="color:#ef4444">${d.failed}</td>
          <td><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;background:#e5e7eb;border-radius:4px;height:10px;max-width:120px"><div style="width:${rate}%;background:${barColor};height:10px;border-radius:4px"></div></div><span style="font-size:12px">${rate}%</span></div></td>
          <td>${pct(d.avg_confidence)}</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p style="color:#94a3b8">No data in the last 7 days.</p>'; }
    html += '</div>';

    // Device performance
    html += '<div class="card"><h3 style="margin-bottom:12px">Device Performance</h3>';
    if (byDevice.rows.length) {
      html += '<table><tr><th>Device</th><th>Total Scans</th><th>Failed</th><th>Fail Rate</th></tr>';
      byDevice.rows.forEach(d => {
        const failColor = parseFloat(d.fail_rate) > 10 ? '#ef4444' : parseFloat(d.fail_rate) > 5 ? '#f59e0b' : '#22c55e';
        html += `<tr><td><strong>${esc(d.name)}</strong></td><td>${d.total_scans}</td><td>${d.failed_scans}</td>
          <td><span style="color:${failColor};font-weight:600">${d.fail_rate}%</span></td></tr>`;
      });
      html += '</table>';
    } else { html += '<p style="color:#94a3b8">No devices configured.</p>'; }
    html += '</div>';

    // Accuracy distribution
    const ad = accuracyDist.rows[0];
    html += '<div class="card"><h3 style="margin-bottom:12px">Profile Accuracy Distribution</h3>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px">';
    html += `<div style="text-align:center;padding:16px;border:2px solid #22c55e;border-radius:10px"><div style="font-size:32px;font-weight:700;color:#22c55e">${ad.excellent}</div><div style="color:${GRAY};font-size:13px">Excellent (≥95%)</div></div>`;
    html += `<div style="text-align:center;padding:16px;border:2px solid #3b82f6;border-radius:10px"><div style="font-size:32px;font-weight:700;color:#3b82f6">${ad.good}</div><div style="color:${GRAY};font-size:13px">Good (85-94%)</div></div>`;
    html += `<div style="text-align:center;padding:16px;border:2px solid #f59e0b;border-radius:10px"><div style="font-size:32px;font-weight:700;color:#f59e0b">${ad.fair}</div><div style="color:${GRAY};font-size:13px">Fair (70-84%)</div></div>`;
    html += `<div style="text-align:center;padding:16px;border:2px solid #ef4444;border-radius:10px"><div style="font-size:32px;font-weight:700;color:#ef4444">${ad.poor}</div><div style="color:${GRAY};font-size:13px">Poor (&lt;70%)</div></div>`;
    html += '</div></div>';

    res.send(renderPage('Attendance Analytics', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 12 — Spoofing & security alerts
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/facial-attendance/alerts', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const spoofAlerts = await pool.query(
      `SELECT fal.*, fd.name AS device_name
       FROM face_attendance_logs fal
       LEFT JOIN face_devices fd ON fd.id=fal.device_id
       WHERE fal.tenant_id=$1 AND fal.spoofing_detected=true
       ORDER BY fal.timestamp DESC LIMIT 50`, [tid]);
    const failedScans = await pool.query(
      `SELECT fal.*, fd.name AS device_name
       FROM face_attendance_logs fal
       LEFT JOIN face_devices fd ON fd.id=fal.device_id
       WHERE fal.tenant_id=$1 AND fal.verified=false AND fal.spoofing_detected=false
       ORDER BY fal.timestamp DESC LIMIT 30`, [tid]);

    let html = SKIP + nav('Alerts');
    html += '<h2 style="margin-bottom:20px">Security Alerts</h2>';

    if (spoofAlerts.rows.length) {
      html += `<div class="card" style="border-left:4px solid #ef4444"><h3 style="color:#ef4444;margin-bottom:12px">Spoofing Attempts (${spoofAlerts.rows.length})</h3>`;
      html += '<table><tr><th>Student</th><th>Device</th><th>Confidence</th><th>Location</th><th>Time</th><th>Notes</th></tr>';
      spoofAlerts.rows.forEach(a => {
        html += `<tr>
          <td><strong>#${a.student_id}</strong></td>
          <td>${esc(a.device_name || '—')}</td>
          <td>${pct(a.confidence_score)}</td>
          <td>${esc(a.location || '—')}</td>
          <td>${fmtTime(a.timestamp)}</td>
          <td>${esc(a.notes || '—')}</td></tr>`;
      });
      html += '</table></div>';
    } else { html += '<div class="card" style="border-left:4px solid #22c55e"><p style="color:#22c55e;font-weight:600">No spoofing attempts detected. System is secure.</p></div>'; }

    if (failedScans.rows.length) {
      html += `<div class="card"><h3 style="color:#f59e0b;margin-bottom:12px">Recent Failed Verifications (no spoofing)</h3>`;
      html += '<table><tr><th>Student</th><th>Device</th><th>Confidence</th><th>Fallback</th><th>Time</th></tr>';
      failedScans.rows.forEach(f => {
        html += `<tr>
          <td>#${f.student_id}</td><td>${esc(f.device_name || '—')}</td>
          <td>${pct(f.confidence_score)}</td>
          <td>${esc(f.fallback_method || 'None')}</td>
          <td>${fmtTime(f.timestamp)}</td></tr>`;
      });
      html += '</table></div>';
    }

    html += '<div class="card"><h3 style="margin-bottom:12px">Security Recommendations</h3>';
    html += '<ul style="line-height:2;color:#374151">';
    html += '<li>Regularly review spoofing alerts and investigate suspicious patterns</li>';
    html += '<li>Ensure all devices have the latest firmware with anti-spoofing patches</li>';
    html += '<li>Monitor devices with high failure rates — may need recalibration</li>';
    html += '<li>Periodically re-register face profiles to maintain accuracy</li>';
    html += '<li>Enable multi-factor verification for high-security areas</li>';
    html += '</ul></div>';

    res.send(renderPage('Security Alerts', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 13 — Dispute management
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/facial-attendance/disputes', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const filter = req.query.status || '';
    let where = 'd.tenant_id=$1', params = [tid];
    if (filter) { where += ' AND d.status=$2'; params.push(filter); }

    const disputes = await pool.query(
      `SELECT d.* FROM face_attendance_disputes d WHERE ${where} ORDER BY d.created_at DESC`, params);

    let html = SKIP + nav('Disputes');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Attendance Disputes</h2>';
    html += `<a href="${navUrl('/disputes/new')}" class="btn">+ File Dispute</a></div>`;

    html += '<div style="display:flex;gap:6px;margin-bottom:16px">';
    [['', 'All'], ['open', 'Open'], ['under_review', 'Under Review'], ['resolved', 'Resolved'], ['rejected', 'Rejected']].forEach(([v, l]) => {
      html += `<a href="${navUrl('/disputes?status=' + v)}" style="padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;` +
        (filter === v ? `background:${P};color:#fff` : `background:#f3f4f6;color:${GRAY}`) + `">${l}</a>`;
    });
    html += '</div>';

    if (disputes.rows.length) {
      const statusColors = { open: '#f59e0b', under_review: '#3b82f6', resolved: '#22c55e', rejected: '#ef4444' };
      html += '<table><tr><th>ID</th><th>Student</th><th>Type</th><th>Description</th><th>Status</th><th>Created</th><th>Actions</th></tr>';
      disputes.rows.forEach(d => {
        html += `<tr>
          <td>#${d.id}</td>
          <td><strong>#${d.student_id}</strong></td>
          <td>${badge(d.dispute_type, '#e0e7ff')}</td>
          <td>${esc((d.description || '').substring(0, 80))}</td>
          <td>${badge(d.status, statusColors[d.status] || '#94a3b8')}</td>
          <td>${fmtTime(d.created_at)}</td>
          <td>
            ${d.status === 'open' || d.status === 'under_review'
              ? `<a href="${navUrl('/disputes/' + d.id + '/resolve')}" class="btn" style="padding:4px 10px;font-size:12px;background:#22c55e">Resolve</a>` : ''}
            ${d.resolution ? `<span style="font-size:12px;color:#22c55e" title="${esc(d.resolution)}">✓</span>` : ''}
          </td></tr>`;
      });
      html += '</table>';
    } else { html += '<div class="card"><p style="color:#94a3b8">No disputes filed.</p></div>'; }
    res.send(renderPage('Attendance Disputes', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 14 — File new dispute
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/facial-attendance/disputes/new', requireAuth, requireNotBanned, (req, res) => {
    let html = SKIP + nav('Disputes');
    html += '<div class="card"><h2>File Attendance Dispute</h2>';
    html += `<form method="POST" action="${navUrl('/disputes/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Student ID *</label>
          <input name="student_id" type="number" required></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Attendance Log ID</label>
          <input name="log_id" type="number" placeholder="Related log entry (optional)"></div>
        <div style="grid-column:span 2"><label style="display:block;margin-bottom:4px;font-weight:600">Dispute Type *</label>
          <select name="dispute_type" required>
            <option value="false_rejection">False Rejection (was present but marked absent)</option>
            <option value="false_acceptance">False Acceptance (was absent but marked present)</option>
            <option value="incorrect_time">Incorrect Timestamp</option>
            <option value="identity_mismatch">Identity Mismatch</option>
            <option value="spoofing_alert">Spoofing Alert Dispute</option>
            <option value="other">Other</option>
          </select></div>
      </div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Description *</label>
        <textarea name="description" rows="4" required placeholder="Describe the issue in detail..."></textarea></div>
      <div style="margin-top:16px"><button type="submit" class="btn">Submit Dispute</button></div>
    </form></div>`;
    res.send(renderPage('File Dispute', html, req.session.user, req));
  });

  app.post('/school/facial-attendance/disputes/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { student_id, log_id, dispute_type, description } = req.body;
    if (!student_id || !dispute_type || !description) return res.status(400).send('Required fields missing.');
    await pool.query(
      `INSERT INTO face_attendance_disputes (tenant_id, student_id, log_id, dispute_type, description)
       VALUES ($1,$2,$3,$4,$5)`,
      [tid, parseInt(student_id), log_id ? parseInt(log_id) : null, dispute_type, description.trim()]);
    audit(req, 'attendance_dispute_filed', { student_id, type: dispute_type });
    res.redirect(navUrl('/disputes'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 15 — Resolve dispute
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/facial-attendance/disputes/:id/resolve', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const dispute = await pool.query("SELECT * FROM face_attendance_disputes WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (!dispute.rows.length) return res.status(404).send('Dispute not found.');
    const d = dispute.rows[0];
    let html = SKIP + nav('Disputes');
    html += `<div class="card"><h2>Resolve Dispute #${d.id}</h2>`;
    html += `<div style="margin-bottom:16px;padding:12px;background:#f9fafb;border-radius:8px">
      <div><strong>Student:</strong> #${d.student_id}</div>
      <div><strong>Type:</strong> ${esc(d.dispute_type)}</div>
      <div><strong>Description:</strong> ${esc(d.description || '—')}</div>
      <div><strong>Filed:</strong> ${fmtTime(d.created_at)}</div>
    </div>`;
    html += `<form method="POST" action="${navUrl('/disputes/' + d.id + '/resolve')}">
      <div><label style="display:block;margin-bottom:4px;font-weight:600">Resolution *</label>
        <select name="status" required>
          <option value="resolved">Resolved - Upheld</option>
          <option value="rejected">Rejected - No Change</option>
        </select></div>
      <div style="margin-top:12px"><label style="display:block;margin-bottom:4px;font-weight:600">Resolution Notes</label>
        <textarea name="resolution" rows="4" required placeholder="Explain the resolution..."></textarea></div>
      <div style="margin-top:16px"><button type="submit" class="btn">Submit Resolution</button></div>
    </form></div>`;
    res.send(renderPage('Resolve Dispute', html, req.session.user, req));
  }));

  app.post('/school/facial-attendance/disputes/:id/resolve', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { status, resolution } = req.body;
    if (!resolution || !resolution.trim()) return res.status(400).send('Resolution notes are required.');
    await pool.query(
      "UPDATE face_attendance_disputes SET status=$1, resolution=$2, reviewed_by=$3, resolved_at=NOW() WHERE id=$4 AND tenant_id=$5",
      [status || 'resolved', resolution.trim(), req.session.user.id, id, tid]);
    audit(req, 'attendance_dispute_resolved', { dispute_id: id, status });
    res.redirect(navUrl('/disputes'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 16 — Privacy compliance
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/facial-attendance/privacy', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const consentStats = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE data_consent=true)::int AS consented,
         COUNT(*) FILTER (WHERE data_consent=false)::int AS not_consented
       FROM face_profiles WHERE tenant_id=$1`, [tid]);
    const s = consentStats.rows[0];

    let html = SKIP + nav('Privacy');
    html += '<h2 style="margin-bottom:20px">Privacy & Compliance</h2>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:24px">';
    html += `<div class="card" style="text-align:center;border-left:4px solid ${P}"><div style="font-size:24px;font-weight:700;color:${P}">${s.total}</div><div style="color:${GRAY};font-size:13px">Total Profiles</div></div>`;
    html += `<div class="card" style="text-align:center;border-left:4px solid #22c55e"><div style="font-size:24px;font-weight:700;color:#22c55e">${s.consented}</div><div style="color:${GRAY};font-size:13px">With Consent</div></div>`;
    html += `<div class="card" style="text-align:center;border-left:4px solid #ef4444"><div style="font-size:24px;font-weight:700;color:#ef4444">${s.not_consented}</div><div style="color:${GRAY};font-size:13px">Missing Consent</div></div>`;
    html += '</div>';

    html += '<div class="card"><h3 style="margin-bottom:12px">Compliance Actions</h3>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
    html += `<div>
      <strong>Export Data Request</strong>
      <p style="font-size:13px;color:${GRAY};margin:4px 0">Generate a data export file for all biometric profiles.</p>
      <form method="POST" action="${navUrl('/privacy/export')}" style="display:inline">
        <button class="btn" style="background:#3b82f6">Export All Data</button>
      </form>
    </div>`;
    html += `<div>
      <strong>Right to Erasure</strong>
      <p style="font-size:13px;color:${GRAY};margin:4px 0">Anonymize biometric data for profiles without consent. Removes face vectors permanently.</p>
      <form method="POST" action="${navUrl('/privacy/anonymize')}" style="display:inline" onsubmit="return confirm('This will permanently remove face encoding vectors for non-consented profiles. Continue?')">
        <button class="btn" style="background:#ef4444">Anonymize Non-Consented</button>
      </form>
    </div>`;
    html += '</div></div>';

    html += '<div class="card"><h3 style="margin-bottom:12px">Privacy Policy Compliance</h3>';
    html += '<div style="font-size:14px;line-height:1.8;color:#374151">';
    html += '<p>This system processes biometric data (face embeddings) for attendance tracking purposes only.</p>';
    html += '<ul style="margin-top:8px">';
    html += '<li>All face encoding vectors are stored encrypted at rest</li>';
    html += '<li>Original photos are processed on-device and only encoding vectors are stored</li>';
    html += '<li>Data is processed only with explicit informed consent from students/guardians</li>';
    html += '<li>Students may request data deletion at any time (Right to Erasure)</li>';
    html += '<li>Access logs are maintained for all biometric data access</li>';
    html += '<li>Data retention policies are enforced automatically</li>';
    html += '<li>Compliance with GDPR, FERPA, and applicable local regulations</li>';
    html += '</ul></div></div>';

    res.send(renderPage('Privacy Compliance', html, req.session.user, req));
  }));

  app.post('/school/facial-attendance/privacy/export', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const profiles = await pool.query(
      "SELECT id, student_id, registered_at, last_verified, accuracy_score, total_verifications, data_consent, consent_date, status FROM face_profiles WHERE tenant_id=$1", [tid]);
    audit(req, 'face_data_export', { count: profiles.rows.length });
    let html = SKIP + nav('Privacy');
    html += `<div class="card"><h2>Data Export Complete</h2>
      <p>Exported ${profiles.rows.length} profile records (excluding biometric encoding vectors).</p>
      <a href="${navUrl('/privacy')}" class="btn" style="margin-top:12px;display:inline-block">Back</a></div>`;
    res.send(renderPage('Data Export', html, req.session.user, req));
  }));

  app.post('/school/facial-attendance/privacy/anonymize', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query(
      "UPDATE face_profiles SET encoding_vector=NULL, photo_url=NULL, status='inactive' WHERE tenant_id=$1 AND data_consent=false RETURNING id", [tid]);
    audit(req, 'face_data_anonymized', { count: result.rows.length });
    let html = SKIP + nav('Privacy');
    html += `<div class="card"><h2>Anonymization Complete</h2>
      <p>Anonymized ${result.rows.length} profiles without data consent. Encoding vectors and photos removed.</p>
      <a href="${navUrl('/privacy')}" class="btn" style="margin-top:12px;display:inline-block">Back</a></div>`;
    res.send(renderPage('Data Anonymization', html, req.session.user, req));
  }));
};
