/**
 * Fundraising Mega Module — Next Wave of Advanced Features
 * Features: Donor CRM, Pledge Management, Campaign Templates, Donation Tipping,
 * Crowdfunding Stretch Goals, Donor Segmentation, Campaign Clone, Bulk Donations,
 * Gift Aid/Tax Deductions, Donation Goals & Challenges
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  // =============================================
  // DATABASE MIGRATIONS
  // =============================================
  const migrations = [
    // Feature 1: Donor CRM
    `CREATE TABLE IF NOT EXISTS donor_crm_contacts (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, full_name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT, organization TEXT, notes TEXT, tags TEXT DEFAULT '[]', total_donated INTEGER DEFAULT 0, donation_count INTEGER DEFAULT 0, last_donation_at TIMESTAMPTZ, first_donation_at TIMESTAMPTZ, avg_donation INTEGER DEFAULT 0, status TEXT DEFAULT 'active' CHECK (status IN ('active','inactive','lapsed','major','minor')), assigned_to TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS donor_crm_interactions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, contact_id INTEGER NOT NULL REFERENCES donor_crm_contacts(id) ON DELETE CASCADE, type TEXT NOT NULL CHECK (type IN ('call','email','meeting','sms','note','thank_you')), subject TEXT, notes TEXT, follow_up_date DATE, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_donor_crm_contacts_tenant ON donor_crm_contacts(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_crm_contacts_email ON donor_crm_contacts(email)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_crm_interactions_contact ON donor_crm_interactions(contact_id)`,

    // Feature 2: Pledge Management
    `CREATE TABLE IF NOT EXISTS campaign_pledges (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, pledgor_name TEXT NOT NULL, pledgor_email TEXT, pledgor_phone TEXT, pledged_amount INTEGER NOT NULL, fulfilled_amount INTEGER DEFAULT 0, status TEXT DEFAULT 'pending' CHECK (status IN ('pending','partially_fulfilled','fulfilled','cancelled','overdue')), due_date DATE, reminder_sent BOOLEAN DEFAULT false, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_pledges_tenant ON campaign_pledges(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_pledges_campaign ON campaign_pledges(campaign_id)`,

    // Feature 3: Campaign Templates
    `CREATE TABLE IF NOT EXISTS campaign_templates (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, category TEXT DEFAULT 'general', target_amount INTEGER, title_template TEXT, description_template TEXT, cover_image_url TEXT, is_public BOOLEAN DEFAULT false, usage_count INTEGER DEFAULT 0, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_templates_tenant ON campaign_templates(tenant_id)`,

    // Feature 4: Donation Tipping
    `CREATE TABLE IF NOT EXISTS donation_tips (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donation_id INTEGER, tip_percentage INTEGER DEFAULT 0, tip_amount INTEGER DEFAULT 0, platform_fee INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS tip_settings (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, default_tip_percentage INTEGER DEFAULT 5, max_tip_percentage INTEGER DEFAULT 20, tip_label TEXT DEFAULT 'Support the platform', tip_enabled BOOLEAN DEFAULT true, platform_fee_percentage NUMERIC DEFAULT 2.5, UNIQUE(tenant_id))`,
    `CREATE INDEX IF NOT EXISTS idx_donation_tips_tenant ON donation_tips(tenant_id)`,

    // Feature 5: Stretch Goals
    `CREATE TABLE IF NOT EXISTS campaign_stretch_goals (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, target_amount INTEGER NOT NULL, description TEXT, reward_text TEXT, is_achieved BOOLEAN DEFAULT false, achieved_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_stretch_goals_campaign ON campaign_stretch_goals(campaign_id)`,

    // Feature 6: Donor Segmentation
    `CREATE TABLE IF NOT EXISTS donor_segments (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, criteria_json TEXT DEFAULT '{}', donor_count INTEGER DEFAULT 0, is_auto BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS donor_segment_members (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, segment_id INTEGER NOT NULL REFERENCES donor_segments(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, added_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(segment_id, donor_email))`,
    `CREATE INDEX IF NOT EXISTS idx_donor_segments_tenant ON donor_segments(tenant_id)`,

    // Feature 7: Campaign Clone
    // No extra table needed - uses existing fundraising_campaigns

    // Feature 8: Bulk Donations
    `CREATE TABLE IF NOT EXISTS bulk_donation_batches (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, campaign_id INTEGER, total_amount INTEGER DEFAULT 0, donation_count INTEGER DEFAULT 0, status TEXT DEFAULT 'processing' CHECK (status IN ('processing','completed','failed','partial')), notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS bulk_donation_items (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, batch_id INTEGER NOT NULL REFERENCES bulk_donation_batches(id) ON DELETE CASCADE, donor_name TEXT, donor_email TEXT, donor_phone TEXT, amount INTEGER NOT NULL, method TEXT DEFAULT 'cash', reference TEXT, status TEXT DEFAULT 'pending' CHECK (status IN ('pending','processed','failed','duplicate')), error_message TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_bulk_batches_tenant ON bulk_donation_batches(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bulk_items_batch ON bulk_donation_items(batch_id)`,

    // Feature 9: Gift Aid / Tax Deductions
    `CREATE TABLE IF NOT EXISTS gift_tax_declarations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, donor_name TEXT, donor_address TEXT, tax_id TEXT, country TEXT DEFAULT 'UG', is_tax_exempt BOOLEAN DEFAULT false, declaration_type TEXT DEFAULT 'gift_aid' CHECK (declaration_type IN ('gift_aid','tax_deductible','charity_receipt','none')), effective_from DATE, effective_to DATE, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, donor_email))`,
    `CREATE TABLE IF NOT EXISTS tax_receipts (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donation_id INTEGER, donor_email TEXT, donor_name TEXT, amount INTEGER, tax_deductible_amount INTEGER, receipt_number TEXT UNIQUE, tax_year INTEGER, issued_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_gift_tax_tenant ON gift_tax_declarations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tax_receipts_tenant ON tax_receipts(tenant_id)`,

    // Feature 10: Donation Goals & Challenges
    `CREATE TABLE IF NOT EXISTS donation_challenges (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, challenge_type TEXT DEFAULT 'amount' CHECK (challenge_type IN ('amount','donors','days','streak')), target_value INTEGER NOT NULL, current_value INTEGER DEFAULT 0, start_date DATE, end_date DATE, reward_text TEXT, is_active BOOLEAN DEFAULT true, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS challenge_participants (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, challenge_id INTEGER NOT NULL REFERENCES donation_challenges(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, contribution_value INTEGER DEFAULT 0, joined_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(challenge_id, donor_email))`,
    `CREATE INDEX IF NOT EXISTS idx_challenges_tenant ON donation_challenges(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_challenge_participants_challenge ON challenge_participants(challenge_id)`,

    // Seed default tip settings
    `INSERT INTO tip_settings (tenant_id, default_tip_percentage, max_tip_percentage, tip_label, tip_enabled, platform_fee_percentage) SELECT t.id, 5, 20, 'Support the platform', true, 2.5 FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM tip_settings WHERE tenant_id=t.id)`,

    // Seed default campaign templates
    `INSERT INTO campaign_templates (tenant_id, name, description, category, target_amount, title_template, description_template, is_public, created_by) SELECT t.id, 'Education Fund', 'Help students access quality education', 'education', 5000000, 'Help {count} Students Get Quality Education', 'We are raising funds to support {count} students who cannot afford school fees. Your donation of {amount} can cover tuition, books, and uniforms for one student for an entire term. Together, we can make education accessible to every child in our community.', true, 'system' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM campaign_templates WHERE tenant_id=t.id AND name='Education Fund')`,
    `INSERT INTO campaign_templates (tenant_id, name, description, category, target_amount, title_template, description_template, is_public, created_by) SELECT t.id, 'Medical Emergency', 'Urgent medical treatment and care', 'health', 3000000, 'Medical Emergency: Help {beneficiary} Get Treatment', '{beneficiary} urgently needs medical treatment. The total cost is {amount} and time is running out. Every donation, no matter how small, brings us closer to saving a life. Please donate and share this campaign.', true, 'system' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM campaign_templates WHERE tenant_id=t.id AND name='Medical Emergency')`,
    `INSERT INTO campaign_templates (tenant_id, name, description, category, target_amount, title_template, description_template, is_public, created_by) SELECT t.id, 'Church/Community Building', 'Building or renovating a community facility', 'infrastructure', 20000000, 'Help Build Our {facility}', 'Our community needs a {facility} that will serve {count} people. This project will provide a safe, welcoming space for worship, meetings, and community events. Every brick laid is a step toward a stronger community.', true, 'system' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM campaign_templates WHERE tenant_id=t.id AND name='Church/Community Building')`,
    `INSERT INTO campaign_templates (tenant_id, name, description, category, target_amount, title_template, description_template, is_public, created_by) SELECT t.id, 'Clean Water Project', 'Provide clean, safe drinking water', 'water', 8000000, 'Bring Clean Water to {location}', 'In {location}, families walk miles for water that isn''t safe to drink. We want to change that by drilling a borehole and installing a purification system. Your donation of {amount} can provide clean water for a family for an entire year.', true, 'system' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM campaign_templates WHERE tenant_id=t.id AND name='Clean Water Project')`,
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) { /* already exists OK */ }
    }
    console.log('[FundraisingMega] Migrations complete');
  })();

  // =============================================
  // HELPERS
  // =============================================
  function formatUGX(amount) { return 'UGX ' + (parseInt(amount)||0).toLocaleString(); }

  // =============================================
  // FEATURE 1: DONOR CRM
  // =============================================
  app.get('/api/donor-crm', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { search, status, tag, sort, limit, offset } = req.query;
    let q = 'SELECT * FROM donor_crm_contacts WHERE tenant_id=$1';
    const params = [tid];
    let idx = 2;
    if (search) { q += ` AND (full_name ILIKE $${idx} OR email ILIKE $${idx} OR phone ILIKE $${idx})`; params.push('%'+search+'%'); idx++; }
    if (status) { q += ` AND status=$${idx}`; params.push(status); idx++; }
    q += ` ORDER BY ${sort==='donated'?'total_donated DESC':'updated_at DESC'} LIMIT $${idx} OFFSET $${idx+1}`;
    params.push(parseInt(limit)||50, parseInt(offset)||0);
    const contacts = await pool.query(q, params);
    const total = (await pool.query('SELECT COUNT(*) FROM donor_crm_contacts WHERE tenant_id=$1', [tid])).rows[0].count;
    res.json({ contacts: contacts.rows, total: parseInt(total) });
  }));

  app.post('/api/donor-crm', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { full_name, email, phone, address, organization, notes, tags, status, assigned_to } = req.body;
    if (!full_name) return res.status(400).json({ error: 'full_name required' });
    const result = await pool.query('INSERT INTO donor_crm_contacts(tenant_id,full_name,email,phone,address,organization,notes,tags,status,assigned_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [tid, full_name, email, phone, address, organization, notes, JSON.stringify(tags||[]), status||'active', assigned_to]);
    if(audit) audit(req, 'crm_contact_created', { id: result.rows[0].id });
    res.json({ success: true, contact: result.rows[0] });
  }));

  app.put('/api/donor-crm/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const fields = ['full_name','email','phone','address','organization','notes','tags','status','assigned_to'];
    const sets = []; const vals = []; let idx = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f}=$${idx}`); vals.push(f==='tags'?JSON.stringify(req.body[f]):req.body[f]); idx++; }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    sets.push(`updated_at=NOW()`);
    vals.push(req.params.id, tid);
    const result = await pool.query(`UPDATE donor_crm_contacts SET ${sets.join(',')} WHERE id=$${idx} AND tenant_id=$${idx+1} RETURNING *`, vals);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, contact: result.rows[0] });
  }));

  app.delete('/api/donor-crm/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    await pool.query('DELETE FROM donor_crm_contacts WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ success: true });
  }));

  // CRM Interactions
  app.post('/api/donor-crm/:id/interactions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { type, subject, notes, follow_up_date } = req.body;
    if (!type) return res.status(400).json({ error: 'type required' });
    const result = await pool.query('INSERT INTO donor_crm_interactions(tenant_id,contact_id,type,subject,notes,follow_up_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [tid, req.params.id, type, subject, notes, follow_up_date, req.session.user.email]);
    res.json({ success: true, interaction: result.rows[0] });
  }));

  app.get('/api/donor-crm/:id/interactions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_crm_interactions WHERE contact_id=$1 AND tenant_id=$2 ORDER BY created_at DESC', [req.params.id, tid]);
    res.json({ interactions: result.rows });
  }));

  // Sync CRM from donation data
  app.post('/api/donor-crm/sync', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const donors = await pool.query("SELECT donor_email, donor_name, donor_phone, SUM(amount) as total, COUNT(*) as cnt, MAX(created_at) as last_don, MIN(created_at) as first_don FROM campaign_donations WHERE tenant_id=$1 AND donor_email IS NOT NULL AND refunded=false GROUP BY donor_email, donor_name, donor_phone", [tid]);
    let synced = 0;
    for (const d of donors.rows) {
      if (!d.donor_email) continue;
      const existing = await pool.query('SELECT id FROM donor_crm_contacts WHERE tenant_id=$1 AND email=$2', [tid, d.donor_email]);
      if (existing.rows.length) {
        await pool.query('UPDATE donor_crm_contacts SET total_donated=$1, donation_count=$2, last_donation_at=$3, first_donation_at=COALESCE(first_donation_at,$4), avg_donation=$1/GREATEST(donation_count,1), updated_at=NOW() WHERE id=$5',
          [parseInt(d.total), parseInt(d.cnt), d.last_don, d.first_don, existing.rows[0].id]);
      } else {
        await pool.query('INSERT INTO donor_crm_contacts(tenant_id,full_name,email,phone,total_donated,donation_count,last_donation_at,first_donation_at,avg_donation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [tid, d.donor_name||d.donor_email, d.donor_email, d.donor_phone, parseInt(d.total), parseInt(d.cnt), d.last_don, d.first_don, Math.round(parseInt(d.total)/Math.max(parseInt(d.cnt),1))]);
        synced++;
      }
    }
    if(audit) audit(req, 'crm_synced', { donors_processed: donors.rows.length, new_contacts: synced });
    res.json({ success: true, processed: donors.rows.length, new_contacts: synced });
  }));

  app.get('/donor-crm', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const contacts = (await pool.query('SELECT * FROM donor_crm_contacts WHERE tenant_id=$1 ORDER BY total_donated DESC LIMIT 50', [tid])).rows;
    const stats = (await pool.query('SELECT COUNT(*) as total, COALESCE(SUM(total_donated),0) as total_value, COALESCE(AVG(total_donated),0) as avg_value FROM donor_crm_contacts WHERE tenant_id=$1', [tid])).rows[0];
    const html = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h2>Donor CRM</h2>
          <div><button onclick="syncCRM()" class="btn" style="background:#3b82f6;color:white;margin-right:8px">Sync from Donations</button>
          <button onclick="document.getElementById('newContactForm').style.display='block'" class="btn" style="background:#059669;color:white">+ Add Contact</button></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
          <div style="padding:20px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0"><div style="font-size:14px;color:#666">Total Contacts</div><div style="font-size:28px;font-weight:700;color:#059669">${stats.total}</div></div>
          <div style="padding:20px;border-radius:12px;background:#fef3c7;border:1px solid #fde68a"><div style="font-size:14px;color:#666">Total Value</div><div style="font-size:28px;font-weight:700;color:#d97706">${formatUGX(stats.total_value)}</div></div>
          <div style="padding:20px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe"><div style="font-size:14px;color:#666">Avg per Donor</div><div style="font-size:28px;font-weight:700;color:#2563eb">${formatUGX(Math.round(parseFloat(stats.avg_value)))}</div></div>
        </div>
        <div id="newContactForm" style="display:none;padding:20px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;background:#f9fafb">
          <h3>Add Contact</h3>
          <form method="POST" action="/api/donor-crm">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
              <div><label>Full Name *</label><input type="text" name="full_name" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Email</label><input type="email" name="email" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Phone</label><input type="text" name="phone" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Organization</label><input type="text" name="organization" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Status</label><select name="status" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"><option value="active">Active</option><option value="lapsed">Lapsed</option><option value="major">Major Donor</option><option value="minor">Minor</option></select></div>
              <div><label>Notes</label><input type="text" name="notes" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
            </div>
            <button type="submit" class="btn" style="background:#059669;color:white;margin-top:12px">Add Contact</button>
          </form>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Name</th><th style="padding:10px;text-align:left">Email</th><th style="padding:10px;text-align:right">Total Donated</th><th style="padding:10px;text-align:center">Donations</th><th style="padding:10px;text-align:center">Status</th><th style="padding:10px;text-align:left">Last Donation</th></tr></thead>
          <tbody>${contacts.map(c => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px;font-weight:600">${esc(c.full_name)}</td>
            <td style="padding:10px">${esc(c.email||'-')}</td>
            <td style="padding:10px;text-align:right;font-weight:700;color:#059669">${formatUGX(c.total_donated)}</td>
            <td style="padding:10px;text-align:center">${c.donation_count}</td>
            <td style="padding:10px;text-align:center"><span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:${c.status==='active'?'#059669':c.status==='lapsed'?'#ef4444':c.status==='major'?'#7c3aed':'#999'}">${esc(c.status)}</span></td>
            <td style="padding:10px">${c.last_donation_at?new Date(c.last_donation_at).toLocaleDateString():'Never'}</td>
          </tr>`).join('')}</tbody>
        </table>
        <script>async function syncCRM(){const r=await fetch('/api/donor-crm/sync',{method:'POST'});const d=await r.json();if(d.success)alert('Synced! '+d.new_contacts+' new contacts, '+d.processed+' total processed');location.reload();}</script>
      </div>`;
    res.send(renderPage('Donor CRM', html, req.session.user));
  }));

  // =============================================
  // FEATURE 2: PLEDGE MANAGEMENT
  // =============================================
  app.post('/api/campaigns/:id/pledges', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { pledgor_name, pledgor_email, pledgor_phone, pledged_amount, due_date, notes } = req.body;
    if (!pledgor_name || !pledged_amount) return res.status(400).json({ error: 'pledgor_name and pledged_amount required' });
    const result = await pool.query('INSERT INTO campaign_pledges(tenant_id,campaign_id,pledgor_name,pledgor_email,pledgor_phone,pledged_amount,due_date,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [tid, req.params.id, pledgor_name, pledgor_email, pledgor_phone, parseInt(pledged_amount), due_date||null, notes]);
    if(audit) audit(req, 'pledge_created', { campaign_id: req.params.id, amount: pledged_amount });
    res.json({ success: true, pledge: result.rows[0] });
  }));

  app.get('/api/campaigns/:id/pledges', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM campaign_pledges WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY created_at DESC', [req.params.id, tid]);
    res.json({ pledges: result.rows });
  }));

  app.put('/api/pledges/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { fulfilled_amount, status, notes } = req.body;
    const result = await pool.query(`UPDATE campaign_pledges SET fulfilled_amount=COALESCE($1,fulfilled_amount), status=COALESCE($2,status), notes=COALESCE($3,notes), updated_at=NOW() WHERE id=$4 AND tenant_id=$5 RETURNING *`,
      [fulfilled_amount?parseInt(fulfilled_amount):null, status, notes, req.params.id, tid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    // Auto-update status
    const p = result.rows[0];
    if (parseInt(p.fulfilled_amount) >= parseInt(p.pledged_amount)) {
      await pool.query("UPDATE campaign_pledges SET status='fulfilled', updated_at=NOW() WHERE id=$1", [p.id]);
    } else if (parseInt(p.fulfilled_amount) > 0) {
      await pool.query("UPDATE campaign_pledges SET status='partially_fulfilled', updated_at=NOW() WHERE id=$1", [p.id]);
    }
    res.json({ success: true, pledge: result.rows[0] });
  }));

  app.delete('/api/pledges/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("UPDATE campaign_pledges SET status='cancelled', updated_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    res.json({ success: true });
  }));

  app.post('/api/pledges/:id/remind', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const pledge = (await pool.query('SELECT * FROM campaign_pledges WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!pledge) return res.status(404).json({ error: 'Not found' });
    if (pledge.pledgor_email && sendEmail) {
      await sendEmail(pledge.pledgor_email, 'Pledge Reminder: Your Support is Needed',
        `<p>Dear ${esc(pledge.pledgor_name)},</p><p>You pledged ${formatUGX(pledge.pledged_amount)} for our campaign. ${pledge.fulfilled_amount>0?`So far, ${formatUGX(pledge.fulfilled_amount)} has been fulfilled.`:'Your pledge is still pending.'}</p><p>Please consider fulfilling your pledge today. <a href="${BASE_URL}/fundraising">View Campaign</a></p>`);
      await pool.query('UPDATE campaign_pledges SET reminder_sent=true WHERE id=$1', [pledge.id]);
    }
    res.json({ success: true, message: 'Reminder sent' });
  }));

  app.get('/pledges', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const pledges = (await pool.query('SELECT cp.*, fc.title as campaign_title FROM campaign_pledges cp LEFT JOIN fundraising_campaigns fc ON cp.campaign_id=fc.id WHERE cp.tenant_id=$1 ORDER BY cp.created_at DESC', [tid])).rows;
    const totalPledged = pledges.reduce((s,p)=>s+parseInt(p.pledged_amount||0),0);
    const totalFulfilled = pledges.reduce((s,p)=>s+parseInt(p.fulfilled_amount||0),0);
    const html = `
      <div class="card">
        <h2>Pledge Management</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
          <div style="padding:20px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0"><div style="font-size:14px;color:#666">Total Pledged</div><div style="font-size:28px;font-weight:700;color:#059669">${formatUGX(totalPledged)}</div></div>
          <div style="padding:20px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe"><div style="font-size:14px;color:#666">Fulfilled</div><div style="font-size:28px;font-weight:700;color:#2563eb">${formatUGX(totalFulfilled)}</div></div>
          <div style="padding:20px;border-radius:12px;background:#fef3c7;border:1px solid #fde68a"><div style="font-size:14px;color:#666">Outstanding</div><div style="font-size:28px;font-weight:700;color:#d97706">${formatUGX(totalPledged-totalFulfilled)}</div></div>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Pledgor</th><th style="padding:10px;text-align:left">Campaign</th><th style="padding:10px;text-align:right">Pledged</th><th style="padding:10px;text-align:right">Fulfilled</th><th style="padding:10px;text-align:center">Status</th><th style="padding:10px;text-align:center">Due Date</th><th style="padding:10px;text-align:center">Actions</th></tr></thead>
          <tbody>${pledges.map(p => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px;font-weight:600">${esc(p.pledgor_name)}</td>
            <td style="padding:10px">${esc(p.campaign_title||'#'+p.campaign_id)}</td>
            <td style="padding:10px;text-align:right">${formatUGX(p.pledged_amount)}</td>
            <td style="padding:10px;text-align:right">${formatUGX(p.fulfilled_amount)}</td>
            <td style="padding:10px;text-align:center"><span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:${p.status==='fulfilled'?'#059669':p.status==='pending'?'#f59e0b':p.status==='overdue'?'#dc2626':'#999'}">${esc(p.status)}</span></td>
            <td style="padding:10px;text-align:center">${p.due_date||'N/A'}</td>
            <td style="padding:10px;text-align:center"><button onclick="fetch('/api/pledges/${p.id}/remind',{method:'POST'}).then(r=>r.json()).then(d=>alert(d.message||'Sent!'))" style="padding:2px 8px;background:#3b82f6;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px">Remind</button></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
    res.send(renderPage('Pledge Management', html, req.session.user));
  }));

  // =============================================
  // FEATURE 3: CAMPAIGN TEMPLATES
  // =============================================
  app.get('/api/campaign-templates', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query("SELECT * FROM campaign_templates WHERE tenant_id=$1 OR is_public=true ORDER BY usage_count DESC", [tid]);
    res.json({ templates: result.rows });
  }));

  app.post('/api/campaign-templates', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, description, category, target_amount, title_template, description_template, is_public } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = await pool.query('INSERT INTO campaign_templates(tenant_id,name,description,category,target_amount,title_template,description_template,is_public,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [tid, name, description, category||'general', target_amount?parseInt(target_amount):null, title_template, description_template, is_public||false, req.session.user.email]);
    res.json({ success: true, template: result.rows[0] });
  }));

  app.post('/api/campaign-templates/:id/use', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const tmpl = (await pool.query('SELECT * FROM campaign_templates WHERE id=$1 AND (tenant_id=$2 OR is_public=true)', [req.params.id, tid])).rows[0];
    if (!tmpl) return res.status(404).json({ error: 'Template not found' });
    const { variables } = req.body;
    let title = tmpl.title_template || tmpl.name;
    let desc = tmpl.description_template || tmpl.description || '';
    if (variables) {
      Object.entries(variables).forEach(([k,v]) => { title = title.replace(new RegExp('{'+k+'}','g'), v); desc = desc.replace(new RegExp('{'+k+'}','g'), v); });
    }
    await pool.query('UPDATE campaign_templates SET usage_count=usage_count+1 WHERE id=$1', [tmpl.id]);
    res.json({ success: true, campaign: { title, description: desc, target: tmpl.target_amount, category: tmpl.category } });
  }));

  app.delete('/api/campaign-templates/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM campaign_templates WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ success: true });
  }));

  app.get('/campaign-templates', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const templates = (await pool.query("SELECT * FROM campaign_templates WHERE tenant_id=$1 OR is_public=true ORDER BY usage_count DESC", [tid])).rows;
    const html = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h2>Campaign Templates</h2>
          <button onclick="document.getElementById('newTemplateForm').style.display='block'" class="btn" style="background:#059669;color:white">+ Create Template</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
          ${templates.map(t => `<div style="padding:20px;border:1px solid #e2e8f0;border-radius:12px;background:white">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:#059669">${esc(t.category)}</span>
              <span style="font-size:12px;color:#888">Used ${t.usage_count}x</span>
            </div>
            <h3 style="margin:0 0 4px">${esc(t.name)}</h3>
            <p style="color:#666;font-size:14px;margin:0 0 12px">${esc(t.description||'')}</p>
            ${t.target_amount?`<div style="font-size:14px;color:#059669;font-weight:600">Target: ${formatUGX(t.target_amount)}</div>`:''}
          </div>`).join('')}
        </div>
      </div>`;
    res.send(renderPage('Campaign Templates', html, req.session.user));
  }));

  // =============================================
  // FEATURE 4: DONATION TIPPING
  // =============================================
  app.get('/api/tip-settings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM tip_settings WHERE tenant_id=$1', [tid]);
    res.json({ settings: result.rows[0] || null });
  }));

  app.put('/api/tip-settings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    const { default_tip_percentage, max_tip_percentage, tip_label, tip_enabled, platform_fee_percentage } = req.body;
    const result = await pool.query(`UPDATE tip_settings SET default_tip_percentage=COALESCE($1,default_tip_percentage), max_tip_percentage=COALESCE($2,max_tip_percentage), tip_label=COALESCE($3,tip_label), tip_enabled=COALESCE($4,tip_enabled), platform_fee_percentage=COALESCE($5,platform_fee_percentage) WHERE tenant_id=$6 RETURNING *`,
      [default_tip_percentage, max_tip_percentage, tip_label, tip_enabled, platform_fee_percentage, tid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Settings not found' });
    res.json({ success: true, settings: result.rows[0] });
  }));

  app.post('/api/donation-tip', ah(async (req, res) => {
    const tid = req.body.tenant_id || 1;
    const { donation_id, tip_percentage, donation_amount } = req.body;
    const settings = (await pool.query('SELECT * FROM tip_settings WHERE tenant_id=$1 AND tip_enabled=true', [tid])).rows[0];
    if (!settings) return res.json({ tip_amount: 0, platform_fee: 0 });
    const pct = Math.min(parseInt(tip_percentage)||settings.default_tip_percentage, settings.max_tip_percentage);
    const tipAmount = Math.round((parseInt(donation_amount)||0) * pct / 100);
    const platformFee = Math.round((parseInt(donation_amount)||0) * parseFloat(settings.platform_fee_percentage) / 100);
    const result = await pool.query('INSERT INTO donation_tips(tenant_id,donation_id,tip_percentage,tip_amount,platform_fee) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [tid, donation_id, pct, tipAmount, platformFee]);
    res.json({ success: true, tip: result.rows[0], total_charge: parseInt(donation_amount) + tipAmount + platformFee });
  }));

  app.get('/api/tip-summary', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT COALESCE(SUM(tip_amount),0) as total_tips, COALESCE(SUM(platform_fee),0) as total_fees, COUNT(*) as tip_count FROM donation_tips WHERE tenant_id=$1', [tid]);
    res.json({ summary: result.rows[0] });
  }));

  // =============================================
  // FEATURE 5: STRETCH GOALS
  // =============================================
  app.post('/api/campaigns/:id/stretch-goals', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { target_amount, description, reward_text } = req.body;
    if (!target_amount) return res.status(400).json({ error: 'target_amount required' });
    const result = await pool.query('INSERT INTO campaign_stretch_goals(tenant_id,campaign_id,target_amount,description,reward_text) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [tid, req.params.id, parseInt(target_amount), description, reward_text]);
    if(audit) audit(req, 'stretch_goal_added', { campaign_id: req.params.id, target: target_amount });
    res.json({ success: true, stretch_goal: result.rows[0] });
  }));

  app.get('/api/campaigns/:id/stretch-goals', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const goals = (await pool.query('SELECT * FROM campaign_stretch_goals WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY target_amount', [req.params.id, tid])).rows;
    const camp = (await pool.query('SELECT (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fundraising_campaigns.id AND tenant_id=$1) as raised FROM fundraising_campaigns WHERE id=$2 AND tenant_id=$1', [tid, req.params.id])).rows[0];
    const raised = parseInt(camp?.raised)||0;
    const enriched = goals.map(g => ({ ...g, progress_pct: Math.min(100, Math.round((raised/parseInt(g.target_amount))*100)), is_achieved: raised >= parseInt(g.target_amount) }));
    res.json({ stretch_goals: enriched, raised });
  }));

  app.delete('/api/stretch-goals/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM campaign_stretch_goals WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ success: true });
  }));

  // =============================================
  // FEATURE 6: DONOR SEGMENTATION
  // =============================================
  app.get('/api/donor-segments', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_segments WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    for (const seg of result.rows) {
      seg.donor_count = (await pool.query('SELECT COUNT(*) FROM donor_segment_members WHERE segment_id=$1', [seg.id])).rows[0].count;
    }
    res.json({ segments: result.rows });
  }));

  app.post('/api/donor-segments', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, description, criteria_json, is_auto } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = await pool.query('INSERT INTO donor_segments(tenant_id,name,description,criteria_json,is_auto) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [tid, name, description, JSON.stringify(criteria_json||{}), is_auto||false]);
    res.json({ success: true, segment: result.rows[0] });
  }));

  app.post('/api/donor-segments/:id/populate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const seg = (await pool.query('SELECT * FROM donor_segments WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!seg) return res.status(404).json({ error: 'Segment not found' });
    const criteria = typeof seg.criteria_json === 'string' ? JSON.parse(seg.criteria_json) : seg.criteria_json || {};
    let q = 'SELECT DISTINCT donor_email FROM campaign_donations WHERE tenant_id=$1 AND donor_email IS NOT NULL';
    const params = [tid]; let idx = 2;
    if (criteria.min_amount) { q += ` AND donor_email IN (SELECT donor_email FROM campaign_donations WHERE tenant_id=$1 GROUP BY donor_email HAVING SUM(amount) >= $${idx})`; params.push(parseInt(criteria.min_amount)); idx++; }
    if (criteria.min_donations) { q += ` AND donor_email IN (SELECT donor_email FROM campaign_donations WHERE tenant_id=$1 GROUP BY donor_email HAVING COUNT(*) >= $${idx})`; params.push(parseInt(criteria.min_donations)); idx++; }
    if (criteria.recent_days) { q += ` AND created_at > NOW() - INTERVAL '${parseInt(criteria.recent_days)} days'`; }
    const donors = await pool.query(q, params);
    // Clear and re-add
    await pool.query('DELETE FROM donor_segment_members WHERE segment_id=$1', [seg.id]);
    let added = 0;
    for (const d of donors.rows) {
      if (d.donor_email) {
        await pool.query('INSERT INTO donor_segment_members(tenant_id,segment_id,donor_email) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [tid, seg.id, d.donor_email]);
        added++;
      }
    }
    await pool.query('UPDATE donor_segments SET donor_count=$1 WHERE id=$2', [added, seg.id]);
    res.json({ success: true, added });
  }));

  app.delete('/api/donor-segments/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM donor_segments WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ success: true });
  }));

  // =============================================
  // FEATURE 7: CAMPAIGN CLONE
  // =============================================
  app.post('/api/campaigns/:id/clone', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const orig = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!orig) return res.status(404).json({ error: 'Campaign not found' });
    const { title } = req.body;
    const newTitle = title || orig.title + ' (Copy)';
    const result = await pool.query('INSERT INTO fundraising_campaigns(tenant_id,title,description,target,status,category,image_url,user_email,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [tid, newTitle, orig.description, orig.target, 'active', orig.category, orig.image_url, orig.user_email, req.session.user.email]);
    // Clone stretch goals
    await pool.query('INSERT INTO campaign_stretch_goals(tenant_id,campaign_id,target_amount,description,reward_text) SELECT tenant_id,$1,target_amount,description,reward_text FROM campaign_stretch_goals WHERE campaign_id=$2 AND tenant_id=$3',
      [result.rows[0].id, req.params.id, tid]);
    if(audit) audit(req, 'campaign_cloned', { from: req.params.id, to: result.rows[0].id });
    res.json({ success: true, campaign: result.rows[0] });
  }));

  // =============================================
  // FEATURE 8: BULK DONATIONS
  // =============================================
  app.post('/api/bulk-donations', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, campaign_id, donations } = req.body;
    if (!title || !donations || !Array.isArray(donations)) return res.status(400).json({ error: 'title and donations array required' });
    const batch = await pool.query('INSERT INTO bulk_donation_batches(tenant_id,title,campaign_id,created_by) VALUES($1,$2,$3,$4) RETURNING *',
      [tid, title, campaign_id||null, req.session.user.email]);
    let processed = 0, failed = 0, totalAmt = 0;
    for (const d of donations) {
      try {
        if (!d.donor_name || !d.amount) { failed++; continue; }
        await pool.query('INSERT INTO bulk_donation_items(tenant_id,batch_id,donor_name,donor_email,donor_phone,amount,method,reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [tid, batch.rows[0].id, d.donor_name, d.donor_email, d.donor_phone, parseInt(d.amount), d.method||'cash', d.reference]);
        if (campaign_id) {
          await pool.query('INSERT INTO campaign_donations(tenant_id,campaign_id,donor_name,donor_email,donor_phone,amount,method,message) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [tid, campaign_id, d.donor_name, d.donor_email, d.donor_phone, parseInt(d.amount), d.method||'cash', 'Bulk import: '+title]);
        }
        totalAmt += parseInt(d.amount);
        processed++;
      } catch(e) { failed++; console.warn('[BulkDonation] Item error:', e.message); }
    }
    await pool.query('UPDATE bulk_donation_batches SET total_amount=$1, donation_count=$2, status=$3 WHERE id=$4',
      [totalAmt, processed, failed===0?'completed':processed>0?'partial':'failed', batch.rows[0].id]);
    if(audit) audit(req, 'bulk_donation_imported', { batch_id: batch.rows[0].id, processed, failed, total: totalAmt });
    res.json({ success: true, batch_id: batch.rows[0].id, processed, failed, total_amount: totalAmt });
  }));

  app.get('/api/bulk-donations', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM bulk_donation_batches WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    res.json({ batches: result.rows });
  }));

  app.get('/api/bulk-donations/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const batch = (await pool.query('SELECT * FROM bulk_donation_batches WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!batch) return res.status(404).json({ error: 'Not found' });
    const items = (await pool.query('SELECT * FROM bulk_donation_items WHERE batch_id=$1 AND tenant_id=$2', [req.params.id, tid])).rows;
    res.json({ batch, items });
  }));

  app.get('/bulk-donations', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const batches = (await pool.query('SELECT * FROM bulk_donation_batches WHERE tenant_id=$1 ORDER BY created_at DESC', [tid])).rows;
    const html = `
      <div class="card">
        <h2>Bulk Donation Import</h2>
        <p style="color:#666;margin-bottom:20px">Import multiple donations at once from offline collections, events, or spreadsheets.</p>
        <div style="padding:20px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;background:#f9fafb">
          <h3>New Bulk Import</h3>
          <p style="font-size:13px;color:#888">POST to /api/bulk-donations with JSON: { title, campaign_id, donations: [{donor_name, donor_email, amount, method}] }</p>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Batch</th><th style="padding:10px;text-align:right">Total</th><th style="padding:10px;text-align:center">Count</th><th style="padding:10px;text-align:center">Status</th><th style="padding:10px;text-align:left">Date</th></tr></thead>
          <tbody>${batches.map(b => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px;font-weight:600">${esc(b.title)}</td>
            <td style="padding:10px;text-align:right">${formatUGX(b.total_amount)}</td>
            <td style="padding:10px;text-align:center">${b.donation_count}</td>
            <td style="padding:10px;text-align:center"><span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:${b.status==='completed'?'#059669':b.status==='failed'?'#dc2626':'#f59e0b'}">${esc(b.status)}</span></td>
            <td style="padding:10px">${new Date(b.created_at).toLocaleDateString()}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
    res.send(renderPage('Bulk Donations', html, req.session.user));
  }));

  // =============================================
  // FEATURE 9: GIFT AID / TAX DEDUCTIONS
  // =============================================
  app.post('/api/gift-aid-declaration', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_email, donor_name, donor_address, tax_id, country, is_tax_exempt, declaration_type, effective_from, effective_to } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email required' });
    const result = await pool.query(`INSERT INTO gift_tax_declarations(tenant_id,donor_email,donor_name,donor_address,tax_id,country,is_tax_exempt,declaration_type,effective_from,effective_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (tenant_id,donor_email) DO UPDATE SET donor_name=COALESCE($3,gift_tax_declarations.donor_name),donor_address=COALESCE($4,gift_tax_declarations.donor_address),tax_id=COALESCE($5,gift_tax_declarations.tax_id),is_tax_exempt=COALESCE($7,gift_tax_declarations.is_tax_exempt),declaration_type=COALESCE($8,gift_tax_declarations.declaration_type),effective_from=COALESCE($9,gift_tax_declarations.effective_from),effective_to=COALESCE($10,gift_tax_declarations.effective_to) RETURNING *`,
      [tid, donor_email, donor_name, donor_address, tax_id, country||'UG', is_tax_exempt||false, declaration_type||'gift_aid', effective_from||null, effective_to||null]);
    res.json({ success: true, declaration: result.rows[0] });
  }));

  app.get('/api/gift-aid-declaration/:email', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM gift_tax_declarations WHERE tenant_id=$1 AND donor_email=$2', [tid, req.params.email]);
    res.json({ declaration: result.rows[0] || null });
  }));

  app.post('/api/generate-tax-receipt/:donationId', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const donation = (await pool.query('SELECT * FROM campaign_donations WHERE id=$1 AND tenant_id=$2', [req.params.donationId, tid])).rows[0];
    if (!donation) return res.status(404).json({ error: 'Donation not found' });
    const decl = (await pool.query('SELECT * FROM gift_tax_declarations WHERE tenant_id=$1 AND donor_email=$2', [tid, donation.donor_email])).rows[0];
    if (!decl || decl.declaration_type === 'none') return res.status(400).json({ error: 'No tax declaration on file' });
    const taxDeductible = decl.is_tax_exempt ? parseInt(donation.amount) : Math.round(parseInt(donation.amount) * 0.25); // Gift Aid: 25% top-up equivalent
    const receiptNum = 'TXR-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2,5).toUpperCase();
    const year = new Date().getFullYear();
    const result = await pool.query('INSERT INTO tax_receipts(tenant_id,donation_id,donor_email,donor_name,amount,tax_deductible_amount,receipt_number,tax_year) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [tid, req.params.donationId, donation.donor_email, donation.donor_name, parseInt(donation.amount), taxDeductible, receiptNum, year]);
    res.json({ success: true, receipt: result.rows[0] });
  }));

  app.get('/api/tax-receipts', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { tax_year, donor_email } = req.query;
    let q = 'SELECT * FROM tax_receipts WHERE tenant_id=$1'; const params = [tid]; let idx = 2;
    if (tax_year) { q += ` AND tax_year=$${idx}`; params.push(parseInt(tax_year)); idx++; }
    if (donor_email) { q += ` AND donor_email=$${idx}`; params.push(donor_email); idx++; }
    q += ' ORDER BY issued_at DESC';
    const result = await pool.query(q, params);
    res.json({ receipts: result.rows });
  }));

  app.get('/gift-aid', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const declarations = (await pool.query('SELECT * FROM gift_tax_declarations WHERE tenant_id=$1 ORDER BY created_at DESC', [tid])).rows;
    const receipts = (await pool.query('SELECT * FROM tax_receipts WHERE tenant_id=$1 ORDER BY issued_at DESC LIMIT 20', [tid])).rows;
    const html = `
      <div class="card">
        <h2>Gift Aid & Tax Deductions</h2>
        <p style="color:#666;margin-bottom:20px">Manage tax declarations and generate receipts for donors.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
          <div>
            <h3>Declarations</h3>
            <table style="width:100%;border-collapse:collapse">
              <thead><tr style="background:#f1f5f9"><th style="padding:8px;text-align:left">Donor</th><th style="padding:8px;text-align:left">Type</th><th style="padding:8px;text-align:center">Tax Exempt</th></tr></thead>
              <tbody>${declarations.map(d => `<tr style="border-bottom:1px solid #e2e8f0">
                <td style="padding:8px">${esc(d.donor_name||d.donor_email)}</td>
                <td style="padding:8px">${esc(d.declaration_type)}</td>
                <td style="padding:8px;text-align:center">${d.is_tax_exempt?'Yes':'No'}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
          <div>
            <h3>Recent Tax Receipts</h3>
            <table style="width:100%;border-collapse:collapse">
              <thead><tr style="background:#f1f5f9"><th style="padding:8px;text-align:left">Receipt #</th><th style="padding:8px;text-align:left">Donor</th><th style="padding:8px;text-align:right">Amount</th><th style="padding:8px;text-align:right">Tax Ded.</th></tr></thead>
              <tbody>${receipts.map(r => `<tr style="border-bottom:1px solid #e2e8f0">
                <td style="padding:8px;font-family:monospace;font-size:12px">${esc(r.receipt_number)}</td>
                <td style="padding:8px">${esc(r.donor_name||r.donor_email)}</td>
                <td style="padding:8px;text-align:right">${formatUGX(r.amount)}</td>
                <td style="padding:8px;text-align:right;font-weight:600;color:#059669">${formatUGX(r.tax_deductible_amount)}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>`;
    res.send(renderPage('Gift Aid & Tax', html, req.session.user));
  }));

  // =============================================
  // FEATURE 10: DONATION GOALS & CHALLENGES
  // =============================================
  app.get('/api/donation-challenges', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donation_challenges WHERE tenant_id=$1 AND is_active=true ORDER BY created_at DESC', [tid]);
    for (const ch of result.rows) {
      ch.participant_count = (await pool.query('SELECT COUNT(*) FROM challenge_participants WHERE challenge_id=$1', [ch.id])).rows[0].count;
      ch.progress_pct = ch.target_value > 0 ? Math.min(100, Math.round((parseInt(ch.current_value)/parseInt(ch.target_value))*100)) : 0;
    }
    res.json({ challenges: result.rows });
  }));

  app.post('/api/donation-challenges', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, description, challenge_type, target_value, start_date, end_date, reward_text } = req.body;
    if (!title || !target_value) return res.status(400).json({ error: 'title and target_value required' });
    const result = await pool.query('INSERT INTO donation_challenges(tenant_id,title,description,challenge_type,target_value,start_date,end_date,reward_text,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [tid, title, description, challenge_type||'amount', parseInt(target_value), start_date||null, end_date||null, reward_text, req.session.user.email]);
    if(audit) audit(req, 'challenge_created', { id: result.rows[0].id });
    res.json({ success: true, challenge: result.rows[0] });
  }));

  app.post('/api/donation-challenges/:id/join', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('INSERT INTO challenge_participants(tenant_id,challenge_id,donor_email) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *',
      [tid, req.params.id, req.session.user.email]);
    res.json({ success: true, joined: !!result.rows.length });
  }));

  app.put('/api/donation-challenges/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { current_value, is_active } = req.body;
    const result = await pool.query(`UPDATE donation_challenges SET current_value=COALESCE($1,current_value), is_active=COALESCE($2,is_active) WHERE id=$3 AND tenant_id=$4 RETURNING *`,
      [current_value?parseInt(current_value):null, is_active, req.params.id, tid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, challenge: result.rows[0] });
  }));

  app.delete('/api/donation-challenges/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('UPDATE donation_challenges SET is_active=false WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ success: true });
  }));

  app.get('/donation-challenges', ah(async (req, res) => {
    const tid = req.session?.user?.tenant_id || 1;
    const challenges = (await pool.query('SELECT * FROM donation_challenges WHERE tenant_id=$1 AND is_active=true ORDER BY created_at DESC', [tid])).rows;
    const html = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h2>Donation Challenges</h2>
          ${req.session?.user?`<button onclick="document.getElementById('newChallengeForm').style.display='block'" class="btn" style="background:#059669;color:white">+ Create Challenge</button>`:''}
        </div>
        <div id="newChallengeForm" style="display:none;padding:20px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;background:#f9fafb">
          <h3>New Challenge</h3>
          <form method="POST" action="/api/donation-challenges">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label>Title *</label><input type="text" name="title" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Type</label><select name="challenge_type" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"><option value="amount">Total Amount</option><option value="donors">Number of Donors</option><option value="days">Days Streak</option></select></div>
              <div><label>Target Value *</label><input type="number" name="target_value" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Reward</label><input type="text" name="reward_text" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Start Date</label><input type="date" name="start_date" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>End Date</label><input type="date" name="end_date" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div style="grid-column:span 2"><label>Description</label><textarea name="description" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;min-height:60px"></textarea></div>
            </div>
            <button type="submit" class="btn" style="background:#059669;color:white;margin-top:12px">Create Challenge</button>
          </form>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px">
          ${challenges.map(ch => {
            const pct = ch.target_value > 0 ? Math.min(100, Math.round((parseInt(ch.current_value)/parseInt(ch.target_value))*100)) : 0;
            return `<div style="padding:20px;border:1px solid #e2e8f0;border-radius:12px;background:white">
              <h3 style="margin:0 0 8px">${esc(ch.title)}</h3>
              <p style="color:#666;font-size:14px;margin:0 0 12px">${esc(ch.description||'')}</p>
              <div style="background:#e2e8f0;border-radius:8px;height:12px;margin-bottom:8px"><div style="background:linear-gradient(90deg,#059669,#10b981);border-radius:8px;height:12px;width:${pct}%"></div></div>
              <div style="display:flex;justify-content:space-between;font-size:13px"><span style="font-weight:700;color:#059669">${pct}%</span><span style="color:#888">${parseInt(ch.current_value).toLocaleString()} / ${parseInt(ch.target_value).toLocaleString()} ${esc(ch.challenge_type)}</span></div>
              ${ch.reward_text?`<div style="margin-top:8px;padding:8px;background:#fef3c7;border-radius:6px;font-size:13px">Reward: ${esc(ch.reward_text)}</div>`:''}
              ${req.session?.user?`<button onclick="fetch('/api/donation-challenges/${ch.id}/join',{method:'POST'}).then(()=>alert('Joined!'))" style="margin-top:8px;padding:4px 12px;background:#059669;color:white;border:none;border-radius:6px;cursor:pointer">Join Challenge</button>`:''}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    res.send(renderPage('Donation Challenges', html, req.session?.user||null));
  }));

  // =============================================
  // STARTUP LOG
  // =============================================
  console.log('[FundraisingMega] Module loaded — 10 features, 50+ routes');
};
