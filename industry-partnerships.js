module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS industry_partners (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, company_name VARCHAR(255),
        industry VARCHAR(100), contact_person VARCHAR(255), email VARCHAR(255),
        phone VARCHAR(50), website TEXT, partnership_type VARCHAR(100),
        mou_start DATE, mou_end DATE, status VARCHAR(50) DEFAULT 'active',
        notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS partnership_activities (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, partner_id INT NOT NULL,
        activity_type VARCHAR(100), description TEXT, date DATE,
        participants INT DEFAULT 0, outcome TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS guest_lectures (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, partner_id INT NOT NULL,
        speaker_name VARCHAR(255), topic VARCHAR(255), description TEXT,
        date DATE, venue VARCHAR(255), audience VARCHAR(100),
        participant_count INT DEFAULT 0, recording_url TEXT,
        status VARCHAR(50) DEFAULT 'scheduled', created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS partnership_scholarships (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, partner_id INT NOT NULL,
        scholarship_name VARCHAR(255), description TEXT, amount DECIMAL(10,2),
        slots INT DEFAULT 1, criteria TEXT, application_deadline DATE,
        status VARCHAR(50) DEFAULT 'open', created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('[Mod] industry-partnerships OK');
    } catch(e) { console.warn('[Mod] industry-partnerships Warn:', e.message); }
  })();

  const PREFIX = '/school/industry-partnerships';

  // ─── 1. Dashboard ───
  app.get(PREFIX, requireAuth, requireNotBanned, async (req, res) => {
    try {
      const [partners, activities, lectures, scholarships] = await Promise.all([
        pool.query('SELECT * FROM industry_partners WHERE tenant_id=$1 ORDER BY company_name', [req.tenant.id]),
        pool.query(`SELECT pa.*, ip.company_name FROM partnership_activities pa
          JOIN industry_partners ip ON ip.id = pa.partner_id
          WHERE pa.tenant_id=$1 ORDER BY pa.date DESC LIMIT 10`, [req.tenant.id]),
        pool.query(`SELECT gl.*, ip.company_name FROM guest_lectures gl
          JOIN industry_partners ip ON ip.id = gl.partner_id
          WHERE gl.tenant_id=$1 ORDER BY gl.date DESC LIMIT 5`, [req.tenant.id]),
        pool.query(`SELECT ps.*, ip.company_name FROM partnership_scholarships ps
          JOIN industry_partners ip ON ip.id = ps.partner_id
          WHERE ps.tenant_id=$1 AND ps.status=$2`, [req.tenant.id, 'open'])
      ]);
      const activePartners = partners.rows.filter(p => p.status === 'active').length;
      const expiringMOUs = partners.rows.filter(p => {
        if (!p.mou_end) return false;
        const diff = (new Date(p.mou_end) - new Date()) / (1000 * 60 * 60 * 24);
        return diff >= 0 && diff <= 90;
      });

      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:4px">Industry Partnerships</h2>
          <p style="color:${GRAY}">Manage company partnerships, collaborations, and engagements</p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:20px">
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:${P}">${partners.rows.length}</div>
            <div style="color:${GRAY}">Total Partners</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#059669">${activePartners}</div>
            <div style="color:${GRAY}">Active Partners</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:${P}">${activities.rows.length}</div>
            <div style="color:${GRAY}">Activities</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#d97706">${scholarships.rows.length}</div>
            <div style="color:${GRAY}">Open Scholarships</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
          <a href="${PREFIX}/partners/new" class="btn" style="background:#059669">+ Add Partner</a>
          <a href="${PREFIX}/guest-lectures/new" class="btn" style="background:#7c3aed">+ Schedule Lecture</a>
          <a href="${PREFIX}/scholarships/new" class="btn" style="background:#d97706">+ Add Scholarship</a>
          <a href="${PREFIX}/analytics" class="btn" style="background:#0891b2">Analytics</a>
        </div>
        ${expiringMOUs.length ? `<div class="card" style="border-left:4px solid #dc2626;background:#fef2f2">
          <h3 style="color:#dc2626;margin-bottom:8px">&#9888; Expiring MOUs (within 90 days)</h3>
          ${expiringMOUs.map(p => `<div style="display:flex;justify-content:space-between;padding:4px 0">
            <strong>${esc(p.company_name)}</strong>
            <span>Expires: ${p.mou_end.toLocaleDateString()}</span>
          </div>`).join('')}
        </div>` : ''}
        <div class="card">
          <h3 style="margin-bottom:12px">Partners</h3>
          ${partners.rows.length ? `<table>
            <tr><th>Company</th><th>Industry</th><th>Type</th><th>MOU Period</th><th>Status</th><th>Actions</th></tr>
            ${partners.rows.map(p => `<tr>
              <td><strong>${esc(p.company_name)}</strong>${p.contact_person ? `<br><span style="color:${GRAY};font-size:.85em">${esc(p.contact_person)}</span>` : ''}</td>
              <td>${esc(p.industry || '-')}</td>
              <td>${esc(p.partnership_type || '-')}</td>
              <td>${p.mou_start ? p.mou_start.toLocaleDateString() : '-'} to ${p.mou_end ? p.mou_end.toLocaleDateString() : '-'}</td>
              <td><span style="background:${p.status === 'active' ? '#dcfce7' : p.status === 'expired' ? '#fee2e2' : '#fef3c7'};padding:2px 10px;border-radius:20px;font-size:.85em">${p.status}</span></td>
              <td>
                <a href="${PREFIX}/partners/${p.id}" class="btn" style="padding:4px 10px;font-size:.85em">View</a>
                <a href="${PREFIX}/partners/edit/${p.id}" class="btn" style="padding:4px 10px;font-size:.85em;background:#d97706">Edit</a>
              </td>
            </tr>`).join('')}
          </table>` : '<p style="color:${GRAY}">No partners registered yet.</p>'}
        </div>
        ${lectures.rows.length ? `<div class="card">
          <h3 style="margin-bottom:12px">Upcoming Guest Lectures</h3>
          <table><tr><th>Speaker</th><th>Company</th><th>Topic</th><th>Date</th><th>Venue</th><th>Status</th></tr>
          ${lectures.rows.map(l => `<tr>
            <td>${esc(l.speaker_name)}</td><td>${esc(l.company_name)}</td>
            <td>${esc(l.topic)}</td><td>${l.date ? l.date.toLocaleDateString() : '-'}</td>
            <td>${esc(l.venue || '-')}</td>
            <td><span style="background:${l.status === 'scheduled' ? '#dbeafe' : l.status === 'completed' ? '#dcfce7' : '#fef3c7'};padding:2px 10px;border-radius:20px;font-size:.85em">${l.status}</span></td>
          </tr>`).join('')}
          </table>
        </div>` : ''}
        ${scholarships.rows.length ? `<div class="card">
          <h3 style="margin-bottom:12px">Open Scholarships</h3>
          <table><tr><th>Scholarship</th><th>Company</th><th>Amount</th><th>Slots</th><th>Deadline</th></tr>
          ${scholarships.rows.map(s => `<tr>
            <td>${esc(s.scholarship_name)}</td><td>${esc(s.company_name)}</td>
            <td style="font-weight:700;color:#059669">$${parseFloat(s.amount || 0).toLocaleString()}</td>
            <td>${s.slots}</td><td>${s.application_deadline ? s.application_deadline.toLocaleDateString() : '-'}</td>
          </tr>`).join('')}
          </table>
        </div>` : ''}
      `;
      res.send(renderPage(req, 'Industry Partnerships', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 2. Add Partner ───
  app.get(PREFIX + '/partners/new', requireAuth, requireNotBanned, async (req, res) => {
    const body = `
      ${SKIP}
      <div class="card">
        <h2 style="color:${P};margin-bottom:16px">Add Industry Partner</h2>
        <form method="POST" action="${PREFIX}/partners/new">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Company Name *</label>
              <input type="text" name="company_name" required></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Industry</label>
              <input type="text" name="industry" placeholder="e.g., Technology, Healthcare"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Contact Person</label>
              <input type="text" name="contact_person"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Email</label>
              <input type="email" name="email"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Phone</label>
              <input type="tel" name="phone"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Website</label>
              <input type="url" name="website"></div>
          </div>
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Partnership Type</label>
            <select name="partnership_type">
              <option value="MOU">Memorandum of Understanding (MOU)</option>
              <option value="Internship">Internship Pipeline</option>
              <option value="Research">Research Collaboration</option>
              <option value="Curriculum">Curriculum Development</option>
              <option value="Equipment">Equipment Donation</option>
              <option value="Guest Lecture">Guest Lectures</option>
              <option value="Scholarship">Scholarship Program</option>
              <option value="Advisory">Advisory Board</option>
              <option value="Mentorship">Mentorship Program</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">MOU Start Date</label>
              <input type="date" name="mou_start"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">MOU End Date</label>
              <input type="date" name="mou_end"></div>
          </div>
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Notes</label>
            <textarea name="notes" rows="3" placeholder="Additional notes about this partnership..."></textarea>
          </div>
          <div style="display:flex;gap:8px">
            <button type="submit" class="btn">Add Partner</button>
            <a href="${PREFIX}" class="btn" style="background:${GRAY};text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
    `;
    res.send(renderPage(req, 'Add Partner', body));
  });

  app.post(PREFIX + '/partners/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { company_name, industry, contact_person, email, phone, website, partnership_type, mou_start, mou_end, notes } = req.body;
      const result = await pool.query(
        `INSERT INTO industry_partners (tenant_id, company_name, industry, contact_person, email, phone, website, partnership_type, mou_start, mou_end, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [req.tenant.id, company_name, industry, contact_person, email, phone, website, partnership_type, mou_start, mou_end, notes]
      );
      audit(req, 'partner_added', { partner_id: result.rows[0].id, company_name });
      res.redirect(PREFIX);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 3. Partner Detail ───
  app.get(PREFIX + '/partners/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const partner = await pool.query('SELECT * FROM industry_partners WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
      if (!partner.rows.length) return res.status(404).send('Partner not found');
      const p = partner.rows[0];
      const [activities, lectures, scholarships] = await Promise.all([
        pool.query('SELECT * FROM partnership_activities WHERE tenant_id=$1 AND partner_id=$2 ORDER BY date DESC', [req.tenant.id, p.id]),
        pool.query('SELECT * FROM guest_lectures WHERE tenant_id=$1 AND partner_id=$2 ORDER BY date DESC', [req.tenant.id, p.id]),
        pool.query('SELECT * FROM partnership_scholarships WHERE tenant_id=$1 AND partner_id=$2 ORDER BY created_at DESC', [req.tenant.id, p.id])
      ]);

      const body = `
        ${SKIP}
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
            <div>
              <h2 style="color:${P};margin-bottom:4px">${esc(p.company_name)}</h2>
              <p style="color:${GRAY}">${esc(p.industry || '')} &bull; ${esc(p.partnership_type || '')}</p>
            </div>
            <span style="background:${p.status === 'active' ? '#dcfce7' : p.status === 'expired' ? '#fee2e2' : '#fef3c7'};padding:4px 16px;border-radius:20px;font-weight:600">${p.status.toUpperCase()}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:20px">
          <div class="card"><strong>Contact:</strong> ${esc(p.contact_person || '-')}</div>
          <div class="card"><strong>Email:</strong> ${esc(p.email || '-')}</div>
          <div class="card"><strong>Phone:</strong> ${esc(p.phone || '-')}</div>
          <div class="card"><strong>MOU:</strong> ${p.mou_start ? p.mou_start.toLocaleDateString() : '-'} to ${p.mou_end ? p.mou_end.toLocaleDateString() : '-'}</div>
        </div>
        ${p.website ? `<div class="card"><strong>Website:</strong> <a href="${esc(p.website)}" target="_blank" style="color:${P}">${esc(p.website)}</a></div>` : ''}
        ${p.notes ? `<div class="card"><strong>Notes:</strong> ${esc(p.notes)}</div>` : ''}
        <div style="display:flex;gap:8px;margin-bottom:20px">
          <a href="${PREFIX}/partners/edit/${p.id}" class="btn" style="background:#d97706">Edit Partner</a>
          <a href="${PREFIX}/activities/new/${p.id}" class="btn" style="background:#059669">+ Log Activity</a>
          <a href="${PREFIX}/guest-lectures/new/${p.id}" class="btn" style="background:#7c3aed">+ Schedule Lecture</a>
        </div>
        <div class="card">
          <h3 style="margin-bottom:12px">Activities (${activities.rows.length})</h3>
          ${activities.rows.length ? `<table>
            <tr><th>Type</th><th>Description</th><th>Date</th><th>Participants</th><th>Outcome</th></tr>
            ${activities.rows.map(a => `<tr>
              <td>${esc(a.activity_type)}</td>
              <td>${esc((a.description || '').substring(0, 100))}</td>
              <td>${a.date ? a.date.toLocaleDateString() : '-'}</td>
              <td>${a.participants || 0}</td>
              <td>${esc((a.outcome || '').substring(0, 80))}</td>
            </tr>`).join('')}
          </table>` : '<p style="color:${GRAY}">No activities logged yet.</p>'}
        </div>
        ${lectures.rows.length ? `<div class="card">
          <h3 style="margin-bottom:12px">Guest Lectures</h3>
          <table><tr><th>Speaker</th><th>Topic</th><th>Date</th><th>Venue</th><th>Audience</th><th>Status</th></tr>
          ${lectures.rows.map(l => `<tr>
            <td>${esc(l.speaker_name)}</td><td>${esc(l.topic)}</td>
            <td>${l.date ? l.date.toLocaleDateString() : '-'}</td>
            <td>${esc(l.venue || '-')}</td><td>${esc(l.audience || '-')}</td>
            <td>${l.status}</td>
          </tr>`).join('')}
          </table>
        </div>` : ''}
        ${scholarships.rows.length ? `<div class="card">
          <h3 style="margin-bottom:12px">Scholarships</h3>
          <table><tr><th>Name</th><th>Amount</th><th>Slots</th><th>Deadline</th><th>Status</th></tr>
          ${scholarships.rows.map(s => `<tr>
            <td>${esc(s.scholarship_name)}</td><td>$${parseFloat(s.amount || 0).toLocaleString()}</td>
            <td>${s.slots}</td><td>${s.application_deadline ? s.application_deadline.toLocaleDateString() : '-'}</td>
            <td>${s.status}</td>
          </tr>`).join('')}
          </table>
        </div>` : ''}
        <a href="${PREFIX}" class="btn" style="display:inline-block;margin-top:8px">&larr; Back</a>
      `;
      res.send(renderPage(req, p.company_name, body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 4. Edit Partner ───
  app.get(PREFIX + '/partners/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const partner = await pool.query('SELECT * FROM industry_partners WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
      if (!partner.rows.length) return res.status(404).send('Partner not found');
      const p = partner.rows[0];
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Edit Partner: ${esc(p.company_name)}</h2>
          <form method="POST" action="${PREFIX}/partners/edit/${p.id}">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Company Name *</label>
                <input type="text" name="company_name" value="${esc(p.company_name)}" required></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Industry</label>
                <input type="text" name="industry" value="${esc(p.industry || '')}"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Contact Person</label>
                <input type="text" name="contact_person" value="${esc(p.contact_person || '')}"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Email</label>
                <input type="email" name="email" value="${esc(p.email || '')}"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Phone</label>
                <input type="tel" name="phone" value="${esc(p.phone || '')}"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Website</label>
                <input type="url" name="website" value="${esc(p.website || '')}"></div>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Partnership Type</label>
              <select name="partnership_type">
                ${['MOU','Internship','Research','Curriculum','Equipment','Guest Lecture','Scholarship','Advisory','Mentorship','Other'].map(t =>
                  `<option value="${t}" ${p.partnership_type === t ? 'selected' : ''}>${t}</option>`
                ).join('')}
              </select>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">MOU Start</label>
                <input type="date" name="mou_start" value="${p.mou_start ? p.mou_start.toISOString().split('T')[0] : ''}"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">MOU End</label>
                <input type="date" name="mou_end" value="${p.mou_end ? p.mou_end.toISOString().split('T')[0] : ''}"></div>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Status</label>
              <select name="status">
                ${['active','inactive','expired','pending'].map(s => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Notes</label>
              <textarea name="notes" rows="3">${esc(p.notes || '')}</textarea>
            </div>
            <button type="submit" class="btn">Save Changes</button>
            <a href="${PREFIX}/partners/${p.id}" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'Edit Partner', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/partners/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { company_name, industry, contact_person, email, phone, website, partnership_type, mou_start, mou_end, status, notes } = req.body;
      await pool.query(
        `UPDATE industry_partners SET company_name=$1, industry=$2, contact_person=$3, email=$4, phone=$5,
         website=$6, partnership_type=$7, mou_start=$8, mou_end=$9, status=$10, notes=$11, updated_at=NOW()
         WHERE id=$12 AND tenant_id=$13`,
        [company_name, industry, contact_person, email, phone, website, partnership_type, mou_start, mou_end, status, notes, req.params.id, req.tenant.id]
      );
      audit(req, 'partner_updated', { partner_id: req.params.id });
      res.redirect(PREFIX + '/partners/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 5. Log Activity ───
  app.get(PREFIX + '/activities/new/:partnerId', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const partner = await pool.query('SELECT company_name FROM industry_partners WHERE id=$1 AND tenant_id=$2', [req.params.partnerId, req.tenant.id]);
      if (!partner.rows.length) return res.status(404).send('Partner not found');
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Log Activity with ${esc(partner.rows[0].company_name)}</h2>
          <form method="POST" action="${PREFIX}/activities/new/${req.params.partnerId}">
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Activity Type</label>
              <select name="activity_type">
                <option value="Meeting">Meeting</option>
                <option value="Workshop">Workshop</option>
                <option value="Site Visit">Site Visit</option>
                <option value="Collaboration">Collaboration Project</option>
                <option value="Equipment">Equipment Donation</option>
                <option value="Internship">Internship Placement</option>
                <option value="Curriculum">Curriculum Review</option>
                <option value="Mentorship">Mentorship Session</option>
                <option value="Career Fair">Career Fair</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Description</label>
              <textarea name="description" rows="4" placeholder="Describe the activity..." required></textarea>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Date</label>
                <input type="date" name="date" value="${new Date().toISOString().split('T')[0]}" required></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Number of Participants</label>
                <input type="number" name="participants" min="0" value="0"></div>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Outcome / Impact</label>
              <textarea name="outcome" rows="3" placeholder="What was the result or impact?"></textarea>
            </div>
            <button type="submit" class="btn">Log Activity</button>
            <a href="${PREFIX}/partners/${req.params.partnerId}" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'Log Activity', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/activities/new/:partnerId', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { activity_type, description, date, participants, outcome } = req.body;
      await pool.query(
        'INSERT INTO partnership_activities (tenant_id, partner_id, activity_type, description, date, participants, outcome) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [req.tenant.id, req.params.partnerId, activity_type, description, date, participants || 0, outcome]
      );
      audit(req, 'activity_logged', { partner_id: req.params.partnerId, type: activity_type });
      res.redirect(PREFIX + '/partners/' + req.params.partnerId);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 6. Guest Lecture Scheduling ───
  app.get(PREFIX + '/guest-lectures/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const partners = await pool.query('SELECT id, company_name FROM industry_partners WHERE tenant_id=$1 AND status=$2 ORDER BY company_name', [req.tenant.id, 'active']);
      const prefill = req.query.partner || '';
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Schedule Guest Lecture</h2>
          <form method="POST" action="${PREFIX}/guest-lectures/new">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Partner Company *</label>
                <select name="partner_id" required>
                  <option value="">-- Select Company --</option>
                  ${partners.rows.map(p => `<option value="${p.id}" ${p.id == prefill ? 'selected' : ''}>${esc(p.company_name)}</option>`).join('')}
                </select></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Speaker Name *</label>
                <input type="text" name="speaker_name" required></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Topic *</label>
                <input type="text" name="topic" required></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Date *</label>
                <input type="date" name="date" required></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Venue</label>
                <input type="text" name="venue" placeholder="e.g., Main Auditorium"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Target Audience</label>
                <select name="audience">
                  <option value="All Students">All Students</option>
                  <option value="Senior Students">Senior Students</option>
                  <option value="STEM Students">STEM Students</option>
                  <option value="Business Students">Business Students</option>
                  <option value="Faculty">Faculty Only</option>
                  <option value="Parents & Students">Parents & Students</option>
                </select></div>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Description</label>
              <textarea name="description" rows="3" placeholder="Brief description of the lecture content..."></textarea>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Recording URL (optional)</label>
              <input type="url" name="recording_url" placeholder="Link to lecture recording">
            </div>
            <button type="submit" class="btn">Schedule Lecture</button>
            <a href="${PREFIX}" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'Schedule Guest Lecture', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/guest-lectures/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { partner_id, speaker_name, topic, description, date, venue, audience, recording_url } = req.body;
      await pool.query(
        `INSERT INTO guest_lectures (tenant_id, partner_id, speaker_name, topic, description, date, venue, audience, recording_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [req.tenant.id, partner_id, speaker_name, topic, description, date, venue, audience, recording_url]
      );
      audit(req, 'guest_lecture_scheduled', { speaker_name, topic });
      res.redirect(PREFIX);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 7. Scholarships ───
  app.get(PREFIX + '/scholarships/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const partners = await pool.query('SELECT id, company_name FROM industry_partners WHERE tenant_id=$1 AND status=$2 ORDER BY company_name', [req.tenant.id, 'active']);
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Add Partnership Scholarship</h2>
          <form method="POST" action="${PREFIX}/scholarships/new">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Partner Company *</label>
                <select name="partner_id" required>
                  <option value="">-- Select Company --</option>
                  ${partners.rows.map(p => `<option value="${p.id}">${esc(p.company_name)}</option>`).join('')}
                </select></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Scholarship Name *</label>
                <input type="text" name="scholarship_name" required></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Amount ($)</label>
                <input type="number" name="amount" step="0.01" min="0"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Available Slots</label>
                <input type="number" name="slots" min="1" value="1"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Application Deadline</label>
                <input type="date" name="application_deadline"></div>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Description</label>
              <textarea name="description" rows="3" placeholder="Describe the scholarship purpose and coverage..."></textarea>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Eligibility Criteria</label>
              <textarea name="criteria" rows="3" placeholder="GPA requirements, field of study, etc..."></textarea>
            </div>
            <button type="submit" class="btn">Add Scholarship</button>
            <a href="${PREFIX}" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'Add Scholarship', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/scholarships/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { partner_id, scholarship_name, description, amount, slots, criteria, application_deadline } = req.body;
      await pool.query(
        `INSERT INTO partnership_scholarships (tenant_id, partner_id, scholarship_name, description, amount, slots, criteria, application_deadline)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.tenant.id, partner_id, scholarship_name, description, amount, slots || 1, criteria, application_deadline]
      );
      audit(req, 'scholarship_added', { scholarship_name, amount });
      res.redirect(PREFIX);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 8. Analytics ───
  app.get(PREFIX + '/analytics', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const [industryStats, typeStats, activityStats, totalParticipants, lectureStats] = await Promise.all([
        pool.query(`SELECT industry, COUNT(*) as partners FROM industry_partners WHERE tenant_id=$1 AND status=$2 GROUP BY industry ORDER BY partners DESC`, [req.tenant.id, 'active']),
        pool.query(`SELECT partnership_type, COUNT(*) as cnt FROM industry_partners WHERE tenant_id=$1 GROUP BY partnership_type ORDER BY cnt DESC`, [req.tenant.id]),
        pool.query(`SELECT activity_type, COUNT(*) as cnt, SUM(participants) as total_participants FROM partnership_activities WHERE tenant_id=$1 GROUP BY activity_type ORDER BY cnt DESC`, [req.tenant.id]),
        pool.query('SELECT COALESCE(SUM(participants),0) as total FROM partnership_activities WHERE tenant_id=$1', [req.tenant.id]),
        pool.query(`SELECT COUNT(*) as total, SUM(participant_count) as total_attendees FROM guest_lectures WHERE tenant_id=$1`, [req.tenant.id])
      ]);
      const maxIndustry = industryStats.rows.length ? industryStats.rows[0].partners : 1;
      const totalScholarships = await pool.query('SELECT COALESCE(SUM(amount),0) as total, SUM(slots) as slots FROM partnership_scholarships WHERE tenant_id=$1 AND status=$2', [req.tenant.id, 'open']);

      const body = `
        ${SKIP}
        <style>.bar{height:20px;border-radius:10px;background:${P};transition:width .3s}</style>
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Partnership Analytics</h2>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:20px">
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:${P}">${totalParticipants.rows[0].total}</div>
            <div style="color:${GRAY}">Total Activity Participants</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#059669">${lectureStats.rows[0].total}</div>
            <div style="color:${GRAY}">Guest Lectures</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#d97706">${parseInt(lectureStats.rows[0].total_attendees || 0)}</div>
            <div style="color:${GRAY}">Lecture Attendees</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#7c3aed">$${parseFloat(totalScholarships.rows[0].total || 0).toLocaleString()}</div>
            <div style="color:${GRAY}">Available Scholarships</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card">
            <h3 style="margin-bottom:12px">Partners by Industry</h3>
            ${industryStats.rows.map(s => `<div style="margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;margin-bottom:2px;font-size:.9em"><span>${esc(s.industry || 'Other')}</span><span>${s.partners}</span></div>
              <div style="background:#e5e7eb;border-radius:10px;height:20px"><div class="bar" style="width:${Math.round((s.partners / maxIndustry) * 100)}%"></div></div>
            </div>`).join('') || '<p style="color:${GRAY}">No data</p>'}
          </div>
          <div class="card">
            <h3 style="margin-bottom:12px">Partnership Types</h3>
            ${typeStats.rows.map(s => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e5e7eb">
              <span>${esc(s.partnership_type)}</span><span style="font-weight:600">${s.cnt}</span>
            </div>`).join('') || '<p style="color:${GRAY}">No data</p>'}
          </div>
          <div class="card">
            <h3 style="margin-bottom:12px">Activity Types</h3>
            ${activityStats.rows.map(s => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e5e7eb">
              <span>${esc(s.activity_type)}</span>
              <span><strong>${s.cnt}</strong> <span style="color:${GRAY}">(${s.total_participants} participants)</span></span>
            </div>`).join('') || '<p style="color:${GRAY}">No data</p>'}
          </div>
          <div class="card">
            <h3 style="margin-bottom:12px">Scholarship Summary</h3>
            <div style="padding:12px;background:#f0fdf4;border-radius:8px;text-align:center">
              <div style="font-size:1.5em;font-weight:700;color:#059669">$${parseFloat(totalScholarships.rows[0].total || 0).toLocaleString()}</div>
              <div style="color:${GRAY}">Total Available</div>
              <div style="margin-top:8px;font-size:.9em">${totalScholarships.rows[0].slots || 0} open slots across ${scholarships.rows.length || 0} scholarships</div>
            </div>
          </div>
        </div>
        <a href="${PREFIX}" class="btn" style="display:inline-block;margin-top:16px">&larr; Back</a>
      `;
      res.send(renderPage(req, 'Partnership Analytics', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 9. Advisory Board ───
  app.get(PREFIX + '/advisory-board', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const advisors = await pool.query(
        `SELECT ip.* FROM industry_partners ip
         WHERE ip.tenant_id=$1 AND ip.partnership_type=$2 AND ip.status=$3
         ORDER BY ip.company_name`, [req.tenant.id, 'Advisory', 'active']);

      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Advisory Board</h2>
          <p style="color:${GRAY}">Industry advisors contributing to school governance and strategy</p>
        </div>
        ${advisors.rows.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
          ${advisors.rows.map(a => `
            <div class="card" style="border-left:4px solid ${P}">
              <h3 style="color:${P}">${esc(a.company_name)}</h3>
              <p style="color:${GRAY};margin:4px 0">${esc(a.industry || '')}</p>
              <p><strong>Contact:</strong> ${esc(a.contact_person || '-')}</p>
              <p><strong>Email:</strong> ${esc(a.email || '-')}</p>
              <p><strong>Phone:</strong> ${esc(a.phone || '-')}</p>
              <a href="${PREFIX}/partners/${a.id}" class="btn" style="margin-top:8px;padding:4px 10px;font-size:.85em">View Details</a>
            </div>
          `).join('')}
        </div>` : '<div class="card"><p style="color:${GRAY}">No advisory board members configured. Add a partner with "Advisory" partnership type.</p></div>'}
        <a href="${PREFIX}" class="btn" style="display:inline-block;margin-top:16px">&larr; Back</a>
      `;
      res.send(renderPage(req, 'Advisory Board', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 10. Equipment Donations ───
  app.get(PREFIX + '/equipment', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const donations = await pool.query(
        `SELECT pa.*, ip.company_name FROM partnership_activities pa
         JOIN industry_partners ip ON ip.id = pa.partner_id
         WHERE pa.tenant_id=$1 AND pa.activity_type=$2
         ORDER BY pa.date DESC`, [req.tenant.id, 'Equipment']);

      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Equipment Donations</h2>
          <p style="color:${GRAY}">Track equipment and resource donations from industry partners</p>
        </div>
        <div class="card">
          <a href="${PREFIX}/equipment/new" class="btn" style="background:#059669">+ Log Equipment Donation</a>
        </div>
        ${donations.rows.length ? `<table>
          <tr><th>Company</th><th>Description</th><th>Date</th><th>Outcome/Details</th></tr>
          ${donations.rows.map(d => `<tr>
            <td>${esc(d.company_name)}</td>
            <td>${esc(d.description || '-')}</td>
            <td>${d.date ? d.date.toLocaleDateString() : '-'}</td>
            <td>${esc(d.outcome || '-')}</td>
          </tr>`).join('')}
        </table>` : '<div class="card"><p style="color:${GRAY}">No equipment donations recorded yet.</p></div>'}
        <a href="${PREFIX}" class="btn" style="display:inline-block;margin-top:16px">&larr; Back</a>
      `;
      res.send(renderPage(req, 'Equipment Donations', body));
    } catch(e) { ah(e, req, res); }
  });

  app.get(PREFIX + '/equipment/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const partners = await pool.query('SELECT id, company_name FROM industry_partners WHERE tenant_id=$1 AND status=$2 ORDER BY company_name', [req.tenant.id, 'active']);
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Log Equipment Donation</h2>
          <form method="POST" action="${PREFIX}/equipment/new">
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Partner Company *</label>
              <select name="partner_id" required>
                <option value="">-- Select Company --</option>
                ${partners.rows.map(p => `<option value="${p.id}">${esc(p.company_name)}</option>`).join('')}
              </select>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Equipment Description *</label>
              <textarea name="description" rows="3" placeholder="Describe the equipment donated..." required></textarea>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Date</label>
              <input type="date" name="date" value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Estimated Value / Additional Details</label>
              <textarea name="outcome" rows="2" placeholder="Estimated value, condition, etc."></textarea>
            </div>
            <button type="submit" class="btn">Log Donation</button>
            <a href="${PREFIX}/equipment" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'Log Equipment', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/equipment/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { partner_id, description, date, outcome } = req.body;
      await pool.query(
        'INSERT INTO partnership_activities (tenant_id, partner_id, activity_type, description, date, outcome) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.tenant.id, partner_id, 'Equipment', description, date, outcome]
      );
      audit(req, 'equipment_donation_logged', { partner_id });
      res.redirect(PREFIX + '/equipment');
    } catch(e) { ah(e, req, res); }
  });
};
