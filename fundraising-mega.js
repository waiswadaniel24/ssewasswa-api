// ============================================================
// FUNDRAISING MEGA MODULE
// 10 Comprehensive Fundraising Features
// ============================================================
// 1. Donor CRM
// 2. Pledge Management
// 3. Campaign Templates
// 4. Donation Tipping
// 5. Crowdfunding Stretch Goals
// 6. Donor Segmentation
// 7. Campaign Clone
// 8. Bulk Donations
// 9. Gift Aid / Tax Deductions
// 10. Donation Goals & Challenges
// ============================================================

module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {

  // =============================================
  // DATABASE MIGRATIONS
  // =============================================
  const migrations = [
    // 1. Donor CRM
    `CREATE TABLE IF NOT EXISTS donor_crm_contacts (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      company TEXT,
      notes TEXT,
      tags_json TEXT DEFAULT '[]',
      last_contacted TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS donor_crm_interactions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL REFERENCES donor_crm_contacts(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'call',
      subject TEXT NOT NULL,
      notes TEXT,
      interaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 2. Pledge Management
    `CREATE TABLE IF NOT EXISTS campaign_pledges_mega (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      campaign_id INTEGER NOT NULL,
      donor_name TEXT NOT NULL,
      donor_email TEXT,
      amount_pledged INTEGER NOT NULL DEFAULT 0,
      amount_fulfilled INTEGER NOT NULL DEFAULT 0,
      due_date DATE,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','partially_fulfilled','fulfilled','overdue','cancelled')),
      reminded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 3. Campaign Templates
    `CREATE TABLE IF NOT EXISTS campaign_templates (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      title_template TEXT NOT NULL,
      story_template TEXT NOT NULL,
      goal_suggestion INTEGER DEFAULT 0,
      settings_json TEXT DEFAULT '{}',
      usage_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 4. Donation Tipping
    `CREATE TABLE IF NOT EXISTS donation_tips (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      donation_id INTEGER,
      tip_amount INTEGER NOT NULL DEFAULT 0,
      tip_percentage NUMERIC(5,2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS tip_settings (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL UNIQUE,
      default_percentage NUMERIC(5,2) DEFAULT 10,
      custom_percentages_json TEXT DEFAULT '[5,10,15,20]',
      enabled BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 5. Crowdfunding Stretch Goals
    `CREATE TABLE IF NOT EXISTS campaign_stretch_goals (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      campaign_id INTEGER NOT NULL,
      goal_amount INTEGER NOT NULL,
      description TEXT NOT NULL,
      unlocked BOOLEAN DEFAULT false,
      unlocked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 6. Donor Segmentation
    `CREATE TABLE IF NOT EXISTS donor_segments (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      criteria_json TEXT DEFAULT '{}',
      member_count INTEGER DEFAULT 0,
      is_dynamic BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS donor_segment_members (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      segment_id INTEGER NOT NULL REFERENCES donor_segments(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      donor_name TEXT,
      added_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 8. Bulk Donations
    `CREATE TABLE IF NOT EXISTS bulk_donation_batches (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      filename TEXT,
      total_rows INTEGER DEFAULT 0,
      processed INTEGER DEFAULT 0,
      errors INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS bulk_donation_items (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      batch_id INTEGER NOT NULL REFERENCES bulk_donation_batches(id) ON DELETE CASCADE,
      donor_name TEXT,
      donor_email TEXT,
      amount INTEGER DEFAULT 0,
      method TEXT DEFAULT 'cash',
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','processed','error')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 9. Gift Aid / Tax Deductions
    `CREATE TABLE IF NOT EXISTS gift_tax_declarations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      donor_name TEXT NOT NULL,
      donor_email TEXT,
      tax_number TEXT,
      declaration_date DATE DEFAULT CURRENT_DATE,
      is_eligible BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS tax_receipts (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      donation_id INTEGER,
      donor_name TEXT NOT NULL,
      donor_email TEXT,
      amount INTEGER NOT NULL DEFAULT 0,
      tax_deductible_amount INTEGER NOT NULL DEFAULT 0,
      receipt_number TEXT UNIQUE NOT NULL,
      issued_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 10. Donation Goals & Challenges
    `CREATE TABLE IF NOT EXISTS donation_challenges (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      challenge_type TEXT DEFAULT 'individual' CHECK (challenge_type IN ('individual','team','community','match')),
      target_amount INTEGER NOT NULL DEFAULT 0,
      current_amount INTEGER NOT NULL DEFAULT 0,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS challenge_participants (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      challenge_id INTEGER NOT NULL REFERENCES donation_challenges(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      donor_name TEXT,
      amount_contributed INTEGER DEFAULT 0,
      joined_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_donor_crm_contacts_tenant ON donor_crm_contacts(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_crm_interactions_tenant ON donor_crm_interactions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_crm_interactions_contact ON donor_crm_interactions(contact_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_pledges_mega_tenant ON campaign_pledges_mega(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_pledges_mega_campaign ON campaign_pledges_mega(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_templates_tenant ON campaign_templates(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_tips_tenant ON donation_tips(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tip_settings_tenant ON tip_settings(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_stretch_goals_tenant ON campaign_stretch_goals(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_stretch_goals_campaign ON campaign_stretch_goals(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_segments_tenant ON donor_segments(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_segment_members_tenant ON donor_segment_members(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_segment_members_segment ON donor_segment_members(segment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bulk_donation_batches_tenant ON bulk_donation_batches(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bulk_donation_items_tenant ON bulk_donation_items(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bulk_donation_items_batch ON bulk_donation_items(batch_id)`,
    `CREATE INDEX IF NOT EXISTS idx_gift_tax_declarations_tenant ON gift_tax_declarations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tax_receipts_tenant ON tax_receipts(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tax_receipts_receipt ON tax_receipts(receipt_number)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_challenges_tenant ON donation_challenges(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_challenge_participants_tenant ON challenge_participants(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_challenge_participants_challenge ON challenge_participants(challenge_id)`,
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) { /* already exists OK */ }
    }
    console.log('[FundraisingMega] Migrations complete');

    // Seed campaign templates for all existing tenants
    try {
      const tenants = (await pool.query('SELECT id FROM tenants')).rows;
      for (const t of tenants) {
        const existing = (await pool.query('SELECT COUNT(*) as cnt FROM campaign_templates WHERE tenant_id=$1', [t.id])).rows[0];
        if (parseInt(existing.cnt) === 0) {
          const seeds = [
            { name: 'Education Fund', category: 'Education', description: 'Help students access quality education through scholarships, school supplies, and tuition support.', title_template: 'Help [Student Name] Achieve Their Educational Dreams', story_template: 'Every child deserves access to quality education. [Student Name] dreams of becoming [aspiration] but faces financial barriers that stand in the way. With your support, we can provide tuition, books, uniforms, and the resources needed to help them succeed. Education changes everything — join us in making a difference.', goal_suggestion: 5000000, settings_json: '{"category":"education","allow_recurring":true,"show_progress_bar":true}' },
            { name: 'Medical Emergency', category: 'Medical', description: 'Raise funds for urgent medical treatment, surgeries, and healthcare expenses.', title_template: 'Support [Patient Name]\'s Medical Treatment', story_template: '[Patient Name] is facing a serious medical condition that requires immediate treatment. The cost of [treatment type] is beyond what the family can afford alone. Time is critical — every donation, no matter the size, brings them one step closer to recovery and a healthy future. Please help save a life today.', goal_suggestion: 10000000, settings_json: '{"category":"medical","allow_recurring":false,"show_progress_bar":true,"urgent":true}' },
            { name: 'Church & Community', category: 'Church/Community', description: 'Fund church building projects, community outreach, events, and ministry programs.', title_template: 'Build Our Community: [Project Name]', story_template: 'Our church/community has been a beacon of hope for [number] families. Now we need your help to [project description — build, renovate, expand, launch program]. Together, we can create a space that serves generations to come. Every contribution is a brick in this vision — will you be part of it?', goal_suggestion: 20000000, settings_json: '{"category":"church_community","allow_recurring":true,"show_progress_bar":true,"allow_pledges":true}' },
            { name: 'Clean Water Initiative', category: 'Clean Water', description: 'Provide clean, safe drinking water to communities through wells, filters, and infrastructure.', title_template: 'Bring Clean Water to [Community Name]', story_template: 'In [Community Name], [number] families walk miles every day just to access water — and it is not even safe to drink. Waterborne diseases affect [percentage]% of children under five. With your help, we can drill a well, install purification systems, and transform the health of an entire community. Clean water is a right, not a privilege — let us make it happen.', goal_suggestion: 8000000, settings_json: '{"category":"clean_water","allow_recurring":true,"show_progress_bar":true,"show_impact_counter":true}' },
          ];
          for (const s of seeds) {
            await pool.query('INSERT INTO campaign_templates(tenant_id,name,category,description,title_template,story_template,goal_suggestion,settings_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
              [t.id, s.name, s.category, s.description, s.title_template, s.story_template, s.goal_suggestion, s.settings_json]);
          }
        }
      }
    } catch(e) { console.warn('[FundraisingMega] Template seed error:', e.message); }

    // Seed default tip settings for all tenants
    try {
      const tenants = (await pool.query('SELECT id FROM tenants')).rows;
      for (const t of tenants) {
        const existing = (await pool.query('SELECT COUNT(*) as cnt FROM tip_settings WHERE tenant_id=$1', [t.id])).rows[0];
        if (parseInt(existing.cnt) === 0) {
          await pool.query('INSERT INTO tip_settings(tenant_id,default_percentage,custom_percentages_json,enabled) VALUES($1,$2,$3,$4)',
            [t.id, 10, '[5,10,15,20]', true]);
        }
      }
    } catch(e) { console.warn('[FundraisingMega] Tip settings seed error:', e.message); }

    console.log('[FundraisingMega] Seeds complete');
  })();

  // =============================================
  // HELPER: Generate receipt number
  // =============================================
  function generateReceiptNumber() {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return 'TXR-' + ts + '-' + rand;
  }

  // =============================================
  // HELPER: Check and unlock stretch goals
  // =============================================
  async function checkStretchGoals(campaignId, tenantId) {
    try {
      const camp = (await pool.query('SELECT target FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [campaignId, tenantId])).rows[0];
      if (!camp) return;
      const raised = (await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM campaign_donations WHERE campaign_id=$1', [campaignId])).rows[0]?.total || 0;
      const totalRaised = parseInt(raised);
      const goals = (await pool.query('SELECT * FROM campaign_stretch_goals WHERE campaign_id=$1 AND tenant_id=$2 AND unlocked=false ORDER BY goal_amount ASC', [campaignId, tenantId])).rows;
      for (const g of goals) {
        if (totalRaised >= parseInt(g.goal_amount)) {
          await pool.query('UPDATE campaign_stretch_goals SET unlocked=true, unlocked_at=NOW() WHERE id=$1', [g.id]);
          // Notify
          const admins = (await pool.query("SELECT email FROM users WHERE tenant_id=$1 AND role IN ('admin','super_admin')", [tenantId])).rows;
          for (const a of admins) {
            notify(tenantId, a.email, 'Stretch Goal Unlocked!', 'The stretch goal "' + esc(g.description) + '" (UGX ' + parseInt(g.goal_amount).toLocaleString() + ') has been unlocked!', 'fundraising');
          }
        }
      }
    } catch(e) { console.warn('[StretchGoals Check]', e.message); }
  }

  // ===========================================================
  // FEATURE 1: DONOR CRM
  // ===========================================================

  // GET all contacts
  app.get('/api/donor-crm', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const search = req.query.search || '';
    let q, params;
    if (search) {
      q = `SELECT * FROM donor_crm_contacts WHERE tenant_id=$1 AND (name ILIKE $2 OR email ILIKE $2 OR company ILIKE $2) ORDER BY created_at DESC`;
      params = [t, '%' + search + '%'];
    } else {
      q = `SELECT * FROM donor_crm_contacts WHERE tenant_id=$1 ORDER BY created_at DESC`;
      params = [t];
    }
    const contacts = (await pool.query(q, params)).rows;
    res.json(contacts);
  }));

  // POST create contact
  app.post('/api/donor-crm', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, email, phone, address, company, notes, tags_json } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    const result = await pool.query(
      'INSERT INTO donor_crm_contacts(tenant_id,name,email,phone,address,company,notes,tags_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [t, esc(name), esc(email || ''), esc(phone || ''), esc(address || ''), esc(company || ''), esc(notes || ''), tags_json || '[]']
    );
    await audit(req.session.user.email, 'donor_crm_contact_created', 'Created CRM contact: ' + name, t);
    res.json(result.rows[0]);
  }));

  // PUT update contact
  app.put('/api/donor-crm', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, name, email, phone, address, company, notes, tags_json } = req.body;
    if (!id) return res.status(400).json({ error: 'Contact ID is required' });
    const existing = (await pool.query('SELECT * FROM donor_crm_contacts WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Contact not found' });
    const result = await pool.query(
      'UPDATE donor_crm_contacts SET name=$1,email=$2,phone=$3,address=$4,company=$5,notes=$6,tags_json=$7 WHERE id=$8 AND tenant_id=$9 RETURNING *',
      [esc(name || existing.name), esc(email !== undefined ? email : existing.email), esc(phone !== undefined ? phone : existing.phone),
       esc(address !== undefined ? address : existing.address), esc(company !== undefined ? company : existing.company),
       esc(notes !== undefined ? notes : existing.notes), tags_json !== undefined ? tags_json : existing.tags_json, id, t]
    );
    await audit(req.session.user.email, 'donor_crm_contact_updated', 'Updated CRM contact: ' + (name || existing.name), t);
    res.json(result.rows[0]);
  }));

  // DELETE contact
  app.delete('/api/donor-crm', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Contact ID is required' });
    const existing = (await pool.query('SELECT * FROM donor_crm_contacts WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Contact not found' });
    await pool.query('DELETE FROM donor_crm_contacts WHERE id=$1 AND tenant_id=$2', [id, t]);
    await audit(req.session.user.email, 'donor_crm_contact_deleted', 'Deleted CRM contact: ' + existing.name, t);
    res.json({ success: true });
  }));

  // POST add interaction
  app.post('/api/donor-crm/:id/interactions', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const contactId = req.params.id;
    const contact = (await pool.query('SELECT * FROM donor_crm_contacts WHERE id=$1 AND tenant_id=$2', [contactId, t])).rows[0];
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    const { type, subject, notes, interaction_date } = req.body;
    if (!subject || !subject.trim()) return res.status(400).json({ error: 'Subject is required' });
    const result = await pool.query(
      'INSERT INTO donor_crm_interactions(tenant_id,contact_id,type,subject,notes,interaction_date) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, contactId, esc(type || 'call'), esc(subject), esc(notes || ''), interaction_date || 'CURRENT_DATE']
    );
    // Update last_contacted
    await pool.query('UPDATE donor_crm_contacts SET last_contacted=NOW() WHERE id=$1', [contactId]);
    await audit(req.session.user.email, 'donor_crm_interaction_added', 'Added interaction for contact: ' + contact.name, t);
    res.json(result.rows[0]);
  }));

  // GET interactions for contact
  app.get('/api/donor-crm/:id/interactions', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const contactId = req.params.id;
    const contact = (await pool.query('SELECT * FROM donor_crm_contacts WHERE id=$1 AND tenant_id=$2', [contactId, t])).rows[0];
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    const interactions = (await pool.query('SELECT * FROM donor_crm_interactions WHERE contact_id=$1 AND tenant_id=$2 ORDER BY interaction_date DESC, created_at DESC', [contactId, t])).rows;
    res.json(interactions);
  }));

  // POST sync CRM from existing donors
  app.post('/api/donor-crm/sync', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    let synced = 0;
    // Sync from campaign_donations donors
    try {
      const donors = (await pool.query(`SELECT DISTINCT donor_name, donor_email FROM campaign_donations WHERE tenant_id=$1 AND donor_name IS NOT NULL AND donor_name != 'Anonymous'`, [t])).rows;
      for (const d of donors) {
        const exists = (await pool.query('SELECT id FROM donor_crm_contacts WHERE tenant_id=$1 AND email=$2', [t, d.donor_email || ''])).rows[0];
        if (!exists) {
          await pool.query('INSERT INTO donor_crm_contacts(tenant_id,name,email,tags_json) VALUES($1,$2,$3,$4)',
            [t, esc(d.donor_name), esc(d.donor_email || ''), '["donor"]']);
          synced++;
        }
      }
    } catch(e) { /* campaign_donations may not exist */ }
    // Sync from pledge donors
    try {
      const pledgers = (await pool.query('SELECT DISTINCT donor_name, donor_email FROM campaign_pledges_mega WHERE tenant_id=$1 AND donor_email IS NOT NULL', [t])).rows;
      for (const p of pledgers) {
        const exists = (await pool.query('SELECT id FROM donor_crm_contacts WHERE tenant_id=$1 AND email=$2', [t, p.donor_email || ''])).rows[0];
        if (!exists) {
          await pool.query('INSERT INTO donor_crm_contacts(tenant_id,name,email,tags_json) VALUES($1,$2,$3,$4)',
            [t, esc(p.donor_name), esc(p.donor_email || ''), '["pledger"]']);
          synced++;
        }
      }
    } catch(e) { /* ignore */ }
    await audit(req.session.user.email, 'donor_crm_synced', 'Synced ' + synced + ' contacts from existing data', t);
    res.json({ synced });
  }));

  // Donor CRM UI
  app.get('/donor-crm', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const search = req.query.search || '';
    let q, params;
    if (search) {
      q = `SELECT * FROM donor_crm_contacts WHERE tenant_id=$1 AND (name ILIKE $2 OR email ILIKE $2 OR company ILIKE $2) ORDER BY created_at DESC`;
      params = [t, '%' + search + '%'];
    } else {
      q = `SELECT * FROM donor_crm_contacts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`;
      params = [t];
    }
    const contacts = (await pool.query(q, params)).rows;
    const totalContacts = contacts.length;

    res.send(renderPage('Donor CRM', `
      <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981)">
        <h1>Donor CRM</h1>
        <p>Manage your donor relationships and interactions</p>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#059669">${totalContacts}</div><div>Total Contacts</div></div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;align-items:center">
        <form method="GET" action="/donor-crm" style="display:flex;gap:8px;flex:1;min-width:200px">
          <input name="search" value="${esc(search)}" placeholder="Search contacts..." style="flex:1;padding:10px 14px;border-radius:8px;border:1px solid #e2e8f0">
          <button class="btn btn-sm" type="submit">Search</button>
        </form>
        <button class="btn btn-green" onclick="document.getElementById('addContactModal').style.display='flex'">+ Add Contact</button>
        <form method="POST" action="/api/donor-crm/sync" style="display:inline"><button type="submit" class="btn btn-sm">Sync from Donations</button></form>
      </div>
      <div class="card">
        ${contacts.length ? '<table><tr><th>Name</th><th>Email</th><th>Phone</th><th>Company</th><th>Tags</th><th>Last Contacted</th><th>Actions</th></tr>' +
          contacts.map(c => '<tr><td><strong>' + esc(c.name) + '</strong></td><td>' + esc(c.email || '-') + '</td><td>' + esc(c.phone || '-') + '</td><td>' + esc(c.company || '-') + '</td><td>' + (c.tags_json ? JSON.parse(c.tags_json).map(tg => '<span class="tag">' + esc(tg) + '</span>').join(' ') : '-') + '</td><td>' + (c.last_contacted ? new Date(c.last_contacted).toLocaleDateString() : 'Never') + '</td><td><a href="/donor-crm/' + c.id + '" class="btn btn-sm">View</a></td></tr>').join('') + '</table>' : '<p class="muted" style="text-align:center;padding:40px">No contacts yet. Add your first donor contact or sync from existing donations.</p>'}
      </div>
      <div id="addContactModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;align-items:center;justify-content:center">
        <div class="card" style="max-width:500px;width:90%;margin:0 auto;max-height:90vh;overflow-y:auto">
          <h2>Add Contact</h2>
          <form id="addContactForm">
            <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Name *</label><input name="name" required style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"></div>
            <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Email</label><input name="email" type="email" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"></div>
            <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Phone</label><input name="phone" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"></div>
            <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Address</label><input name="address" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"></div>
            <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Company</label><input name="company" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"></div>
            <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Notes</label><textarea name="notes" rows="3" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"></textarea></div>
            <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Tags (comma-separated)</label><input name="tags" placeholder="donor, major, corporate" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"></div>
            <div style="display:flex;gap:10px;margin-top:16px">
              <button type="submit" class="btn btn-green" style="flex:1">Save Contact</button>
              <button type="button" class="btn btn-sm" onclick="document.getElementById('addContactModal').style.display='none'" style="flex:1">Cancel</button>
            </div>
          </form>
        </div>
      </div>
      <script>
        document.getElementById('addContactForm').addEventListener('submit', async function(e) {
          e.preventDefault();
          const fd = new FormData(this);
          const tags = fd.get('tags') ? fd.get('tags').split(',').map(t=>t.trim()).filter(Boolean) : [];
          const res = await fetch('/api/donor-crm', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:fd.get('name'),email:fd.get('email'),phone:fd.get('phone'),address:fd.get('address'),company:fd.get('company'),notes:fd.get('notes'),tags_json:JSON.stringify(tags)})});
          if(res.ok) location.reload(); else { const d=await res.json(); alert(d.error||'Error saving contact'); }
        });
      </script>
    `, req.session.user));
  }));

  // Donor CRM Contact Detail UI
  app.get('/donor-crm/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const contact = (await pool.query('SELECT * FROM donor_crm_contacts WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!contact) return res.status(404).send('Contact not found');
    const interactions = (await pool.query('SELECT * FROM donor_crm_interactions WHERE contact_id=$1 AND tenant_id=$2 ORDER BY interaction_date DESC, created_at DESC', [req.params.id, t])).rows;

    // Get related donations
    let relatedDonations = [];
    try {
      if (contact.email) {
        relatedDonations = (await pool.query('SELECT cd.*, fc.title as campaign_title FROM campaign_donations cd LEFT JOIN fundraising_campaigns fc ON cd.campaign_id=fc.id WHERE cd.tenant_id=$1 AND (cd.donor_email=$2 OR cd.donor_name=$3) ORDER BY cd.donated_at DESC LIMIT 20', [t, contact.email, contact.name])).rows;
      }
    } catch(e) { /* campaign_donations may not exist */ }

    const totalDonated = relatedDonations.reduce((s, d) => s + (parseInt(d.amount) || 0), 0);

    res.send(renderPage(esc(contact.name) + ' - Donor CRM', `
      <div style="display:flex;gap:12px;margin-bottom:20px">
        <a href="/donor-crm" class="btn btn-sm">&larr; Back to CRM</a>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="card">
          <h2>${esc(contact.name)}</h2>
          ${contact.email ? '<p><strong>Email:</strong> ' + esc(contact.email) + '</p>' : ''}
          ${contact.phone ? '<p><strong>Phone:</strong> ' + esc(contact.phone) + '</p>' : ''}
          ${contact.address ? '<p><strong>Address:</strong> ' + esc(contact.address) + '</p>' : ''}
          ${contact.company ? '<p><strong>Company:</strong> ' + esc(contact.company) + '</p>' : ''}
          ${contact.notes ? '<p><strong>Notes:</strong> ' + esc(contact.notes) + '</p>' : ''}
          ${contact.tags_json ? '<p><strong>Tags:</strong> ' + JSON.parse(contact.tags_json).map(tg => '<span class="tag">' + esc(tg) + '</span>').join(' ') + '</p>' : ''}
          <p class="muted">Last contacted: ${contact.last_contacted ? new Date(contact.last_contacted).toLocaleDateString() : 'Never'}</p>
        </div>
        <div class="card">
          <h3>Donation Summary</h3>
          <div class="stats" style="grid-template-columns:1fr 1fr">
            <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${totalDonated.toLocaleString()}</div><div>Total Donated</div></div>
            <div class="stat-card"><div class="stat-num">${relatedDonations.length}</div><div>Donations</div></div>
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:20px">
        <h2>Interactions <button class="btn btn-sm btn-green" onclick="document.getElementById('addInteractionForm').style.display='block'" style="margin-left:10px">+ Log Interaction</button></h2>
        <div id="addInteractionForm" style="display:none;margin-bottom:20px;padding:16px;background:#f8fafc;border-radius:8px">
          <form id="interactionForm">
            <div style="margin-bottom:10px"><label style="font-weight:600;display:block;margin-bottom:4px">Type</label><select name="type" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"><option value="call">Phone Call</option><option value="email">Email</option><option value="meeting">Meeting</option><option value="note">Note</option><option value="donation">Donation</option></select></div>
            <div style="margin-bottom:10px"><label style="font-weight:600;display:block;margin-bottom:4px">Subject *</label><input name="subject" required style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"></div>
            <div style="margin-bottom:10px"><label style="font-weight:600;display:block;margin-bottom:4px">Notes</label><textarea name="notes" rows="3" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"></textarea></div>
            <div style="margin-bottom:10px"><label style="font-weight:600;display:block;margin-bottom:4px">Date</label><input name="interaction_date" type="date" value="${new Date().toISOString().split('T')[0]}" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"></div>
            <button type="submit" class="btn btn-green">Save Interaction</button>
          </form>
        </div>
        ${interactions.length ? '<table><tr><th>Type</th><th>Subject</th><th>Notes</th><th>Date</th></tr>' +
          interactions.map(i => '<tr><td><span class="tag">' + esc(i.type) + '</span></td><td><strong>' + esc(i.subject) + '</strong></td><td class="muted">' + esc((i.notes || '').substring(0, 80)) + '</td><td>' + new Date(i.interaction_date).toLocaleDateString() + '</td></tr>').join('') + '</table>' : '<p class="muted" style="text-align:center;padding:20px">No interactions logged yet.</p>'}
      </div>
      ${relatedDonations.length > 0 ? '<div class="card" style="margin-top:20px"><h2>Related Donations</h2><table><tr><th>Campaign</th><th>Amount</th><th>Date</th></tr>' +
        relatedDonations.map(d => '<tr><td>' + esc(d.campaign_title || 'Campaign #' + d.campaign_id) + '</td><td style="color:#059669;font-weight:700">UGX ' + (parseInt(d.amount)||0).toLocaleString() + '</td><td>' + (d.donated_at ? new Date(d.donated_at).toLocaleDateString() : '-') + '</td></tr>').join('') + '</table></div>' : ''}
      <script>
        document.getElementById('interactionForm').addEventListener('submit', async function(e) {
          e.preventDefault();
          const fd = new FormData(this);
          const res = await fetch('/api/donor-crm/${req.params.id}/interactions', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:fd.get('type'),subject:fd.get('subject'),notes:fd.get('notes'),interaction_date:fd.get('interaction_date')})});
          if(res.ok) location.reload(); else { const d=await res.json(); alert(d.error||'Error saving interaction'); }
        });
      </script>
    `, req.session.user));
  }));

  // ===========================================================
  // FEATURE 2: PLEDGE MANAGEMENT
  // ===========================================================

  // POST create pledge
  app.post('/api/campaigns/:id/pledges', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = req.params.id;
    const { donor_name, donor_email, amount_pledged, due_date, status } = req.body;
    if (!donor_name || !donor_name.trim()) return res.status(400).json({ error: 'Donor name is required' });
    if (!amount_pledged || parseInt(amount_pledged) <= 0) return res.status(400).json({ error: 'Pledge amount must be greater than zero' });
    const result = await pool.query(
      'INSERT INTO campaign_pledges_mega(tenant_id,campaign_id,donor_name,donor_email,amount_pledged,due_date,status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [t, campaignId, esc(donor_name), esc(donor_email || ''), parseInt(amount_pledged), due_date || null, status || 'pending']
    );
    await audit(req.session.user.email, 'pledge_created', 'Created pledge of UGX ' + parseInt(amount_pledged).toLocaleString() + ' by ' + donor_name, t);
    res.json(result.rows[0]);
  }));

  // GET pledges for campaign
  app.get('/api/campaigns/:id/pledges', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = req.params.id;
    const pledges = (await pool.query('SELECT * FROM campaign_pledges_mega WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY created_at DESC', [campaignId, t])).rows;
    res.json(pledges);
  }));

  // PUT update pledge
  app.put('/api/campaigns/:id/pledges', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = req.params.id;
    const { pledge_id, donor_name, donor_email, amount_pledged, amount_fulfilled, due_date, status } = req.body;
    if (!pledge_id) return res.status(400).json({ error: 'Pledge ID is required' });
    const existing = (await pool.query('SELECT * FROM campaign_pledges_mega WHERE id=$1 AND campaign_id=$2 AND tenant_id=$3', [pledge_id, campaignId, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Pledge not found' });
    const result = await pool.query(
      'UPDATE campaign_pledges_mega SET donor_name=$1,donor_email=$2,amount_pledged=$3,amount_fulfilled=$4,due_date=$5,status=$6 WHERE id=$7 AND tenant_id=$8 RETURNING *',
      [esc(donor_name || existing.donor_name), esc(donor_email !== undefined ? donor_email : existing.donor_email),
       amount_pledged !== undefined ? parseInt(amount_pledged) : existing.amount_pledged,
       amount_fulfilled !== undefined ? parseInt(amount_fulfilled) : existing.amount_fulfilled,
       due_date !== undefined ? due_date : existing.due_date,
       status || existing.status, pledge_id, t]
    );
    // Auto-update status if fulfilled matches pledged
    if (parseInt(result.rows[0].amount_fulfilled) >= parseInt(result.rows[0].amount_pledged)) {
      await pool.query("UPDATE campaign_pledges_mega SET status='fulfilled' WHERE id=$1", [pledge_id]);
      result.rows[0].status = 'fulfilled';
    }
    await audit(req.session.user.email, 'pledge_updated', 'Updated pledge #' + pledge_id, t);
    res.json(result.rows[0]);
  }));

  // DELETE pledge
  app.delete('/api/campaigns/:id/pledges', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = req.params.id;
    const { pledge_id } = req.body;
    if (!pledge_id) return res.status(400).json({ error: 'Pledge ID is required' });
    const existing = (await pool.query('SELECT * FROM campaign_pledges_mega WHERE id=$1 AND campaign_id=$2 AND tenant_id=$3', [pledge_id, campaignId, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Pledge not found' });
    await pool.query('DELETE FROM campaign_pledges_mega WHERE id=$1 AND tenant_id=$2', [pledge_id, t]);
    await audit(req.session.user.email, 'pledge_deleted', 'Deleted pledge #' + pledge_id + ' by ' + existing.donor_name, t);
    res.json({ success: true });
  }));

  // POST remind pledge donor
  app.post('/api/pledges/:id/remind', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const pledge = (await pool.query('SELECT * FROM campaign_pledges_mega WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!pledge) return res.status(404).json({ error: 'Pledge not found' });
    const remaining = parseInt(pledge.amount_pledged) - parseInt(pledge.amount_fulfilled);
    // Update reminded_at
    await pool.query('UPDATE campaign_pledges_mega SET reminded_at=NOW() WHERE id=$1', [pledge.id]);
    // Send email if available
    if (pledge.donor_email && sendEmail) {
      let campaignTitle = 'our campaign';
      try {
        const camp = (await pool.query('SELECT title FROM fundraising_campaigns WHERE id=$1', [pledge.campaign_id])).rows[0];
        if (camp) campaignTitle = camp.title;
      } catch(e) {}
      try {
        await sendEmail(pledge.donor_email, 'Pledge Reminder - ' + campaignTitle,
          '<div style="font-family:Arial;max-width:600px;margin:0 auto;padding:20px"><h2 style="color:#059669">Pledge Reminder</h2><p>Dear ' + esc(pledge.donor_name) + ',</p><p>This is a friendly reminder about your pledge of <strong>UGX ' + parseInt(pledge.amount_pledged).toLocaleString() + '</strong> to <strong>' + esc(campaignTitle) + '</strong>.</p><p>Remaining amount: <strong>UGX ' + remaining.toLocaleString() + '</strong></p>' +
          (pledge.due_date ? '<p>Due date: <strong>' + new Date(pledge.due_date).toLocaleDateString() + '</strong></p>' : '') +
          '<p>Thank you for your generous support!</p></div>');
      } catch(e) { console.warn('[PledgeReminder Email]', e.message); }
    }
    // Send SMS if phone available
    try {
      const contact = (await pool.query('SELECT phone FROM donor_crm_contacts WHERE tenant_id=$1 AND email=$2 LIMIT 1', [t, pledge.donor_email])).rows[0];
      if (contact && contact.phone && sendSMS) {
        await sendSMS(contact.phone, 'Hi ' + pledge.donor_name + ', this is a reminder about your pledge of UGX ' + parseInt(pledge.amount_pledged).toLocaleString() + '. Remaining: UGX ' + remaining.toLocaleString() + '. Thank you for your support!');
      }
    } catch(e) {}
    // Notify in-app
    if (pledge.donor_email) {
      notify(t, pledge.donor_email, 'Pledge Reminder', 'This is a reminder about your pledge of UGX ' + parseInt(pledge.amount_pledged).toLocaleString() + '. Remaining: UGX ' + remaining.toLocaleString(), 'fundraising');
    }
    await audit(req.session.user.email, 'pledge_reminded', 'Sent reminder for pledge #' + pledge.id + ' to ' + pledge.donor_name, t);
    res.json({ success: true, reminded_at: new Date().toISOString() });
  }));

  // Pledges UI
  app.get('/pledges', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = req.query.campaign || '';
    let pledges, campaigns = [];
    try {
      campaigns = (await pool.query('SELECT id, title FROM fundraising_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
    } catch(e) {}
    if (campaignId) {
      pledges = (await pool.query('SELECT pm.*, fc.title as campaign_title FROM campaign_pledges_mega pm LEFT JOIN fundraising_campaigns fc ON pm.campaign_id=fc.id WHERE pm.campaign_id=$1 AND pm.tenant_id=$2 ORDER BY pm.created_at DESC', [campaignId, t])).rows;
    } else {
      pledges = (await pool.query('SELECT pm.*, fc.title as campaign_title FROM campaign_pledges_mega pm LEFT JOIN fundraising_campaigns fc ON pm.campaign_id=fc.id WHERE pm.tenant_id=$1 ORDER BY pm.created_at DESC LIMIT 200', [t])).rows;
    }
    const totalPledged = pledges.reduce((s, p) => s + parseInt(p.amount_pledged || 0), 0);
    const totalFulfilled = pledges.reduce((s, p) => s + parseInt(p.amount_fulfilled || 0), 0);
    const overduePledges = pledges.filter(p => p.due_date && new Date(p.due_date) < new Date() && p.status !== 'fulfilled' && p.status !== 'cancelled').length;

    res.send(renderPage('Pledge Management', `
      <div class="hero" style="background:linear-gradient(135deg,#7c3aed,#a78bfa)">
        <h1>Pledge Management</h1>
        <p>Track and manage donor pledges</p>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#7c3aed">UGX ${totalPledged.toLocaleString()}</div><div>Total Pledged</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${totalFulfilled.toLocaleString()}</div><div>Fulfilled</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">UGX ${(totalPledged - totalFulfilled).toLocaleString()}</div><div>Outstanding</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${overduePledges}</div><div>Overdue</div></div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;align-items:center">
        <select id="campaignFilter" onchange="location.href='/pledges?campaign='+this.value" style="padding:10px 14px;border-radius:8px;border:1px solid #e2e8f0">
          <option value="">All Campaigns</option>
          ${campaigns.map(c => '<option value="' + c.id + '"' + (campaignId == c.id ? ' selected' : '') + '>' + esc(c.title) + '</option>').join('')}
        </select>
      </div>
      <div class="card">
        ${pledges.length ? '<table><tr><th>Donor</th><th>Campaign</th><th>Pledged</th><th>Fulfilled</th><th>Remaining</th><th>Due Date</th><th>Status</th><th>Actions</th></tr>' +
          pledges.map(p => {
            const remaining = parseInt(p.amount_pledged) - parseInt(p.amount_fulfilled);
            const statusColors = { pending: '#fef3c7;color:#92400e', fulfilled: '#d1fae5;color:#065f46', partially_fulfilled: '#dbeafe;color:#1e40af', overdue: '#fee2e2;color:#991b1b', cancelled: '#f1f5f9;color:#64748b' };
            return '<tr><td><strong>' + esc(p.donor_name) + '</strong>' + (p.donor_email ? '<br><span class="muted">' + esc(p.donor_email) + '</span>' : '') + '</td><td>' + esc(p.campaign_title || 'Campaign #' + p.campaign_id) + '</td><td style="font-weight:700">UGX ' + parseInt(p.amount_pledged).toLocaleString() + '</td><td style="color:#059669">UGX ' + parseInt(p.amount_fulfilled).toLocaleString() + '</td><td>' + (remaining > 0 ? 'UGX ' + remaining.toLocaleString() : '-') + '</td><td>' + (p.due_date ? new Date(p.due_date).toLocaleDateString() : '-') + '</td><td><span class="tag" style="background:' + (statusColors[p.status] || statusColors.pending) + '">' + esc(p.status) + '</span></td><td><button class="btn btn-sm" onclick="remindPledge(' + p.id + ')">Remind</button></td></tr>';
          }).join('') + '</table>' : '<p class="muted" style="text-align:center;padding:40px">No pledges yet.</p>'}
      </div>
      <script>
        async function remindPledge(id) {
          const res = await fetch('/api/pledges/'+id+'/remind', {method:'POST',headers:{'Content-Type':'application/json'}});
          if(res.ok) { alert('Reminder sent!'); location.reload(); } else { const d=await res.json(); alert(d.error||'Error sending reminder'); }
        }
      </script>
    `, req.session.user));
  }));

  // ===========================================================
  // FEATURE 3: CAMPAIGN TEMPLATES
  // ===========================================================

  // GET all templates
  app.get('/api/campaign-templates', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const category = req.query.category || '';
    let q, params;
    if (category) {
      q = 'SELECT * FROM campaign_templates WHERE tenant_id=$1 AND category=$2 ORDER BY usage_count DESC, created_at DESC';
      params = [t, category];
    } else {
      q = 'SELECT * FROM campaign_templates WHERE tenant_id=$1 ORDER BY usage_count DESC, created_at DESC';
      params = [t];
    }
    const templates = (await pool.query(q, params)).rows;
    res.json(templates);
  }));

  // POST create template
  app.post('/api/campaign-templates', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, category, description, title_template, story_template, goal_suggestion, settings_json } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    if (!title_template || !title_template.trim()) return res.status(400).json({ error: 'Title template is required' });
    if (!story_template || !story_template.trim()) return res.status(400).json({ error: 'Story template is required' });
    const result = await pool.query(
      'INSERT INTO campaign_templates(tenant_id,name,category,description,title_template,story_template,goal_suggestion,settings_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [t, esc(name), esc(category || 'General'), esc(description || ''), esc(title_template), esc(story_template), parseInt(goal_suggestion) || 0, settings_json || '{}']
    );
    await audit(req.session.user.email, 'campaign_template_created', 'Created template: ' + name, t);
    res.json(result.rows[0]);
  }));

  // DELETE template
  app.delete('/api/campaign-templates', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Template ID is required' });
    const existing = (await pool.query('SELECT * FROM campaign_templates WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Template not found' });
    await pool.query('DELETE FROM campaign_templates WHERE id=$1 AND tenant_id=$2', [id, t]);
    await audit(req.session.user.email, 'campaign_template_deleted', 'Deleted template: ' + existing.name, t);
    res.json({ success: true });
  }));

  // POST use template (creates campaign from template)
  app.post('/api/campaign-templates/:id/use', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const template = (await pool.query('SELECT * FROM campaign_templates WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!template) return res.status(404).json({ error: 'Template not found' });
    // Increment usage count
    await pool.query('UPDATE campaign_templates SET usage_count=usage_count+1 WHERE id=$1', [template.id]);
    // Return the template data so the client can use it to create a campaign
    const { title, story, customizations } = req.body;
    const finalTitle = title || template.title_template;
    const finalStory = story || template.story_template;
    res.json({
      template_id: template.id,
      category: template.category,
      title: finalTitle,
      story: finalStory,
      target: template.goal_suggestion,
      settings: template.settings_json,
      customizations: customizations || {}
    });
  }));

  // Campaign Templates UI
  app.get('/campaign-templates', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const templates = (await pool.query('SELECT * FROM campaign_templates WHERE tenant_id=$1 ORDER BY category, usage_count DESC', [t])).rows;
    const categories = [...new Set(templates.map(tp => tp.category))];

    res.send(renderPage('Campaign Templates', `
      <div class="hero" style="background:linear-gradient(135deg,#0ea5e9,#38bdf8)">
        <h1>Campaign Templates</h1>
        <p>Start your campaign with a proven template</p>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <button class="btn btn-green" onclick="document.getElementById('addTemplateModal').style.display='flex'">+ Create Template</button>
        ${categories.map(c => '<a href="/campaign-templates?category=' + encodeURIComponent(c) + '" class="btn btn-sm">' + esc(c) + '</a>').join('')}
      </div>
      <div class="grid">
        ${templates.map(tp => `
          <div class="card" style="display:flex;flex-direction:column">
            <div style="padding:4px 10px;background:#f0fdf4;color:#059669;border-radius:6px;display:inline-block;font-size:12px;margin-bottom:8px;width:fit-content">${esc(tp.category)}</div>
            <h3 style="margin:0 0 8px">${esc(tp.name)}</h3>
            <p class="muted" style="font-size:13px;flex:1">${esc((tp.description || '').substring(0, 120))}${(tp.description || '').length > 120 ? '...' : ''}</p>
            <div style="margin-top:12px;font-size:13px"><strong>Goal Suggestion:</strong> UGX ${parseInt(tp.goal_suggestion || 0).toLocaleString()}</div>
            <div style="margin-top:4px;font-size:13px" class="muted">Used ${tp.usage_count} time${tp.usage_count !== 1 ? 's' : ''}</div>
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn btn-green btn-sm" onclick="useTemplate(${tp.id})" style="flex:1">Use Template</button>
              <button class="btn btn-sm" onclick="previewTemplate(${tp.id})" style="flex:1">Preview</button>
              <button class="btn btn-sm" onclick="deleteTemplate(${tp.id})" style="color:#dc2626">Delete</button>
            </div>
          </div>
        `).join('')}
      </div>
      ${templates.length === 0 ? '<div class="card"><p class="muted" style="text-align:center;padding:40px">No templates yet. Create your first campaign template or use the seeded templates.</p></div>' : ''}
      <div id="addTemplateModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;align-items:center;justify-content:center">
        <div class="card" style="max-width:600px;width:90%;margin:0 auto;max-height:90vh;overflow-y:auto">
          <h2>Create Campaign Template</h2>
          <form id="templateForm">
            <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Template Name *</label><input name="name" required style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"></div>
            <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Category *</label><select name="category" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"><option value="Education">Education</option><option value="Medical">Medical</option><option value="Church/Community">Church/Community</option><option value="Clean Water">Clean Water</option><option value="General">General</option><option value="Environment">Environment</option><option value="Disaster Relief">Disaster Relief</option></select></div>
            <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="2" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"></textarea></div>
            <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Title Template *</label><input name="title_template" required placeholder="e.g. Help [Name] Achieve Their Dreams" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"></div>
            <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Story Template *</label><textarea name="story_template" required rows="5" placeholder="Write your story template here. Use [placeholders] for variable content." style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"></textarea></div>
            <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Goal Suggestion (UGX)</label><input name="goal_suggestion" type="number" placeholder="5000000" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0"></div>
            <div style="display:flex;gap:10px;margin-top:16px">
              <button type="submit" class="btn btn-green" style="flex:1">Save Template</button>
              <button type="button" class="btn btn-sm" onclick="document.getElementById('addTemplateModal').style.display='none'" style="flex:1">Cancel</button>
            </div>
          </form>
        </div>
      </div>
      <div id="previewModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;align-items:center;justify-content:center">
        <div class="card" style="max-width:700px;width:90%;margin:0 auto;max-height:90vh;overflow-y:auto">
          <h2 id="previewTitle"></h2>
          <div id="previewBody" style="white-space:pre-wrap;line-height:1.8"></div>
          <button class="btn btn-sm" onclick="document.getElementById('previewModal').style.display='none'" style="margin-top:16px">Close</button>
        </div>
      </div>
      <script>
        document.getElementById('templateForm').addEventListener('submit', async function(e) {
          e.preventDefault();
          const fd = new FormData(this);
          const res = await fetch('/api/campaign-templates', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:fd.get('name'),category:fd.get('category'),description:fd.get('description'),title_template:fd.get('title_template'),story_template:fd.get('story_template'),goal_suggestion:fd.get('goal_suggestion')})});
          if(res.ok) location.reload(); else { const d=await res.json(); alert(d.error||'Error saving template'); }
        });
        async function useTemplate(id) {
          const title = prompt('Enter a title for your new campaign:');
          if(!title) return;
          const res = await fetch('/api/campaign-templates/'+id+'/use', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:title})});
          if(res.ok) { const d=await res.json(); alert('Template loaded! Use this data to create your campaign:\\nTitle: '+d.title+'\\nGoal: UGX '+d.target.toLocaleString()); location.reload(); }
          else { const d=await res.json(); alert(d.error||'Error using template'); }
        }
        const templateData = ${JSON.stringify(templates)};
        async function previewTemplate(id) {
          const tp = templateData.find(t=>t.id===id);
          if(!tp) return;
          document.getElementById('previewTitle').textContent = tp.name;
          document.getElementById('previewBody').innerHTML = '<h3>Title:</h3><p>'+tp.title_template+'</p><h3>Story:</h3><p>'+tp.story_template+'</p><h3>Goal:</h3><p>UGX '+(parseInt(tp.goal_suggestion)||0).toLocaleString()+'</p>';
          document.getElementById('previewModal').style.display = 'flex';
        }
        async function deleteTemplate(id) {
          if(!confirm('Are you sure you want to delete this template?')) return;
          const res = await fetch('/api/campaign-templates', {method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})});
          if(res.ok) location.reload(); else alert('Error deleting template');
        }
      </script>
    `, req.session.user));
  }));

  // ===========================================================
  // FEATURE 4: DONATION TIPPING
  // ===========================================================

  // GET tip settings
  app.get('/api/tip-settings', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    let settings = (await pool.query('SELECT * FROM tip_settings WHERE tenant_id=$1', [t])).rows[0];
    if (!settings) {
      // Auto-create default
      await pool.query('INSERT INTO tip_settings(tenant_id,default_percentage,custom_percentages_json,enabled) VALUES($1,$2,$3,$4) ON CONFLICT (tenant_id) DO NOTHING', [t, 10, '[5,10,15,20]', true]);
      settings = (await pool.query('SELECT * FROM tip_settings WHERE tenant_id=$1', [t])).rows[0];
    }
    res.json(settings);
  }));

  // PUT update tip settings
  app.put('/api/tip-settings', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { default_percentage, custom_percentages_json, enabled } = req.body;
    const result = await pool.query(
      `INSERT INTO tip_settings(tenant_id,default_percentage,custom_percentages_json,enabled) VALUES($1,$2,$3,$4)
       ON CONFLICT (tenant_id) DO UPDATE SET default_percentage=$2,custom_percentages_json=$3,enabled=$4
       RETURNING *`,
      [t, parseFloat(default_percentage) || 10, custom_percentages_json || '[5,10,15,20]', enabled !== undefined ? !!enabled : true]
    );
    await audit(req.session.user.email, 'tip_settings_updated', 'Updated tip settings', t);
    res.json(result.rows[0]);
  }));

  // POST record a donation tip
  app.post('/api/donation-tip', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donation_id, tip_amount, tip_percentage } = req.body;
    if (!tip_amount || parseInt(tip_amount) <= 0) return res.status(400).json({ error: 'Tip amount must be greater than zero' });
    const result = await pool.query(
      'INSERT INTO donation_tips(tenant_id,donation_id,tip_amount,tip_percentage) VALUES($1,$2,$3,$4) RETURNING *',
      [t, donation_id || null, parseInt(tip_amount), parseFloat(tip_percentage) || 0]
    );
    await audit(req.session.user.email, 'donation_tip_recorded', 'Recorded tip of UGX ' + parseInt(tip_amount).toLocaleString(), t);
    res.json(result.rows[0]);
  }));

  // GET tip summary
  app.get('/api/tip-summary', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const totalTips = (await pool.query('SELECT COALESCE(SUM(tip_amount),0) as total FROM donation_tips WHERE tenant_id=$1', [t])).rows[0]?.total || 0;
    const tipCount = (await pool.query('SELECT COUNT(*) as cnt FROM donation_tips WHERE tenant_id=$1', [t])).rows[0]?.cnt || 0;
    const avgPercentage = (await pool.query('SELECT COALESCE(AVG(tip_percentage),0) as avg FROM donation_tips WHERE tenant_id=$1 AND tip_percentage > 0', [t])).rows[0]?.avg || 0;
    const recentTips = (await pool.query('SELECT * FROM donation_tips WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20', [t])).rows;
    res.json({
      total_tips: parseInt(totalTips),
      tip_count: parseInt(tipCount),
      average_percentage: parseFloat(avgPercentage).toFixed(1),
      recent_tips: recentTips
    });
  }));

  // ===========================================================
  // FEATURE 5: CROWDFUNDING STRETCH GOALS
  // ===========================================================

  // POST create stretch goal
  app.post('/api/campaigns/:id/stretch-goals', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = req.params.id;
    const { goal_amount, description } = req.body;
    if (!goal_amount || parseInt(goal_amount) <= 0) return res.status(400).json({ error: 'Goal amount must be greater than zero' });
    if (!description || !description.trim()) return res.status(400).json({ error: 'Description is required' });
    const result = await pool.query(
      'INSERT INTO campaign_stretch_goals(tenant_id,campaign_id,goal_amount,description) VALUES($1,$2,$3,$4) RETURNING *',
      [t, campaignId, parseInt(goal_amount), esc(description)]
    );
    await audit(req.session.user.email, 'stretch_goal_created', 'Created stretch goal UGX ' + parseInt(goal_amount).toLocaleString() + ' for campaign #' + campaignId, t);
    res.json(result.rows[0]);
  }));

  // GET stretch goals for campaign
  app.get('/api/campaigns/:id/stretch-goals', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = req.params.id;
    const goals = (await pool.query('SELECT * FROM campaign_stretch_goals WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY goal_amount ASC', [campaignId, t])).rows;
    // Include current raised amount
    let raised = 0;
    try {
      const raisedResult = (await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM campaign_donations WHERE campaign_id=$1', [campaignId])).rows[0];
      raised = parseInt(raisedResult.total);
    } catch(e) {}
    res.json({ raised, goals });
  }));

  // DELETE stretch goal
  app.delete('/api/campaigns/:id/stretch-goals', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { goal_id } = req.body;
    if (!goal_id) return res.status(400).json({ error: 'Goal ID is required' });
    const existing = (await pool.query('SELECT * FROM campaign_stretch_goals WHERE id=$1 AND campaign_id=$2 AND tenant_id=$3', [goal_id, req.params.id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Stretch goal not found' });
    await pool.query('DELETE FROM campaign_stretch_goals WHERE id=$1 AND tenant_id=$2', [goal_id, t]);
    await audit(req.session.user.email, 'stretch_goal_deleted', 'Deleted stretch goal: ' + existing.description, t);
    res.json({ success: true });
  }));

  // ===========================================================
  // FEATURE 6: DONOR SEGMENTATION
  // ===========================================================

  // GET all segments
  app.get('/api/donor-segments', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const segments = (await pool.query('SELECT * FROM donor_segments WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
    // Attach member count
    for (const seg of segments) {
      const count = (await pool.query('SELECT COUNT(*) as cnt FROM donor_segment_members WHERE segment_id=$1 AND tenant_id=$2', [seg.id, t])).rows[0]?.cnt || 0;
      seg.live_member_count = parseInt(count);
    }
    res.json(segments);
  }));

  // POST create segment
  app.post('/api/donor-segments', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, criteria_json, is_dynamic, members } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Segment name is required' });
    const result = await pool.query(
      'INSERT INTO donor_segments(tenant_id,name,description,criteria_json,is_dynamic) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [t, esc(name), esc(description || ''), criteria_json || '{}', !!is_dynamic]
    );
    const segment = result.rows[0];
    // Add initial members if provided
    if (members && Array.isArray(members) && members.length > 0) {
      for (const m of members) {
        if (m.donor_email) {
          await pool.query('INSERT INTO donor_segment_members(tenant_id,segment_id,donor_email,donor_name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
            [t, segment.id, esc(m.donor_email), esc(m.donor_name || '')]);
        }
      }
      await pool.query('UPDATE donor_segments SET member_count=$1 WHERE id=$2', [members.length, segment.id]);
    }
    await audit(req.session.user.email, 'donor_segment_created', 'Created segment: ' + name, t);
    res.json(segment);
  }));

  // PUT update segment
  app.put('/api/donor-segments', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, name, description, criteria_json, is_dynamic } = req.body;
    if (!id) return res.status(400).json({ error: 'Segment ID is required' });
    const existing = (await pool.query('SELECT * FROM donor_segments WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Segment not found' });
    const result = await pool.query(
      'UPDATE donor_segments SET name=$1,description=$2,criteria_json=$3,is_dynamic=$4 WHERE id=$5 AND tenant_id=$6 RETURNING *',
      [esc(name || existing.name), esc(description !== undefined ? description : existing.description),
       criteria_json !== undefined ? criteria_json : existing.criteria_json,
       is_dynamic !== undefined ? !!is_dynamic : existing.is_dynamic, id, t]
    );
    await audit(req.session.user.email, 'donor_segment_updated', 'Updated segment: ' + (name || existing.name), t);
    res.json(result.rows[0]);
  }));

  // DELETE segment
  app.delete('/api/donor-segments', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Segment ID is required' });
    const existing = (await pool.query('SELECT * FROM donor_segments WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Segment not found' });
    await pool.query('DELETE FROM donor_segments WHERE id=$1 AND tenant_id=$2', [id, t]);
    await audit(req.session.user.email, 'donor_segment_deleted', 'Deleted segment: ' + existing.name, t);
    res.json({ success: true });
  }));

  // POST refresh dynamic segment
  app.post('/api/donor-segments/:id/refresh', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const segment = (await pool.query('SELECT * FROM donor_segments WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!segment) return res.status(404).json({ error: 'Segment not found' });
    if (!segment.is_dynamic) return res.status(400).json({ error: 'Segment is not dynamic. Only dynamic segments can be refreshed.' });

    let criteria = {};
    try { criteria = JSON.parse(segment.criteria_json); } catch(e) {}

    // Clear existing members
    await pool.query('DELETE FROM donor_segment_members WHERE segment_id=$1 AND tenant_id=$2', [segment.id, t]);

    let addedCount = 0;

    // Refresh based on criteria
    if (criteria.min_donations || criteria.min_total || criteria.donor_type) {
      try {
        let donorQ = `SELECT donor_email, donor_name, SUM(amount) as total, COUNT(*) as count FROM campaign_donations WHERE tenant_id=$1 AND donor_email IS NOT NULL AND donor_email != '' AND donor_name != 'Anonymous' GROUP BY donor_email, donor_name`;
        const donors = (await pool.query(donorQ, [t])).rows;

        for (const d of donors) {
          const total = parseInt(d.total) || 0;
          const count = parseInt(d.count) || 0;
          let matches = true;
          if (criteria.min_donations && count < parseInt(criteria.min_donations)) matches = false;
          if (criteria.min_total && total < parseInt(criteria.min_total)) matches = false;
          if (matches) {
            await pool.query('INSERT INTO donor_segment_members(tenant_id,segment_id,donor_email,donor_name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
              [t, segment.id, esc(d.donor_email), esc(d.donor_name)]);
            addedCount++;
          }
        }
      } catch(e) { /* campaign_donations may not exist */ }
    }

    // Also try from CRM contacts if criteria has tags
    if (criteria.tags && Array.isArray(criteria.tags) && criteria.tags.length > 0) {
      try {
        const contacts = (await pool.query('SELECT * FROM donor_crm_contacts WHERE tenant_id=$1', [t])).rows;
        for (const c of contacts) {
          let contactTags = [];
          try { contactTags = JSON.parse(c.tags_json || '[]'); } catch(e) {}
          if (criteria.tags.some(tag => contactTags.includes(tag))) {
            if (c.email) {
              await pool.query('INSERT INTO donor_segment_members(tenant_id,segment_id,donor_email,donor_name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
                [t, segment.id, esc(c.email), esc(c.name)]);
              addedCount++;
            }
          }
        }
      } catch(e) {}
    }

    // Update member count
    await pool.query('UPDATE donor_segments SET member_count=$1 WHERE id=$2', [addedCount, segment.id]);
    await audit(req.session.user.email, 'donor_segment_refreshed', 'Refreshed segment: ' + segment.name + ' (' + addedCount + ' members)', t);
    res.json({ success: true, member_count: addedCount });
  }));

  // ===========================================================
  // FEATURE 7: CAMPAIGN CLONE
  // ===========================================================

  app.post('/api/campaigns/:id/clone', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = req.params.id;
    const { title } = req.body;

    // Fetch original campaign
    const original = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [campaignId, t])).rows[0];
    if (!original) return res.status(404).json({ error: 'Campaign not found' });

    const newTitle = title || 'Copy of ' + original.title;

    // Deep copy the campaign
    const cloned = await pool.query(
      `INSERT INTO fundraising_campaigns(tenant_id, title, story, category, target, image_url, is_public, deadline, status, created_by)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9) RETURNING *`,
      [t, esc(newTitle), original.story || '', original.category || '', original.target || 0, original.image_url || '', original.is_public !== false, original.deadline || null, req.session.user.email]
    );

    // Clone stretch goals if any
    const stretchGoals = (await pool.query('SELECT * FROM campaign_stretch_goals WHERE campaign_id=$1 AND tenant_id=$2', [campaignId, t])).rows;
    for (const sg of stretchGoals) {
      await pool.query('INSERT INTO campaign_stretch_goals(tenant_id,campaign_id,goal_amount,description) VALUES($1,$2,$3,$4)',
        [t, cloned.rows[0].id, sg.goal_amount, sg.description]);
    }

    // Clone reward tiers if they exist
    try {
      const tiers = (await pool.query('SELECT * FROM campaign_reward_tiers WHERE campaign_id=$1 AND tenant_id=$2', [campaignId, t])).rows;
      for (const tr of tiers) {
        await pool.query('INSERT INTO campaign_reward_tiers(tenant_id,campaign_id,title,description,min_amount,max_amount,reward_type,reward_details,image_url,estimated_delivery,quantity_available,is_active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
          [t, cloned.rows[0].id, tr.title, tr.description, tr.min_amount, tr.max_amount, tr.reward_type, tr.reward_details, tr.image_url, tr.estimated_delivery, tr.quantity_available, tr.is_active, tr.sort_order]);
      }
    } catch(e) { /* campaign_reward_tiers may not exist */ }

    await audit(req.session.user.email, 'campaign_cloned', 'Cloned campaign #' + campaignId + ' as "' + newTitle + '"', t);
    res.json({ success: true, original_id: campaignId, new_campaign: cloned.rows[0] });
  }));

  // ===========================================================
  // FEATURE 8: BULK DONATIONS
  // ===========================================================

  // POST create bulk donation batch
  app.post('/api/bulk-donations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { filename, items } = req.body;

    // Create batch
    const batchResult = await pool.query(
      'INSERT INTO bulk_donation_batches(tenant_id,filename,total_rows,status) VALUES($1,$2,$3,$4) RETURNING *',
      [t, esc(filename || 'manual-upload'), (items || []).length, 'pending']
    );
    const batch = batchResult.rows[0];

    // Insert items
    let validCount = 0;
    if (items && Array.isArray(items)) {
      for (const item of items) {
        if (item.donor_name && item.amount && parseInt(item.amount) > 0) {
          await pool.query(
            'INSERT INTO bulk_donation_items(tenant_id,batch_id,donor_name,donor_email,amount,method,status) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [t, batch.id, esc(item.donor_name), esc(item.donor_email || ''), parseInt(item.amount), esc(item.method || 'cash'), 'pending']
          );
          validCount++;
        }
      }
    }

    // Update batch total
    await pool.query('UPDATE bulk_donation_batches SET total_rows=$1 WHERE id=$2', [validCount, batch.id]);

    await audit(req.session.user.email, 'bulk_donation_created', 'Created bulk donation batch #' + batch.id + ' (' + validCount + ' items)', t);
    res.json({ batch_id: batch.id, total_items: validCount });
  }));

  // GET bulk donation batches
  app.get('/api/bulk-donations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const batches = (await pool.query('SELECT * FROM bulk_donation_batches WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
    // Attach items for each batch
    for (const b of batches) {
      b.items = (await pool.query('SELECT * FROM bulk_donation_items WHERE batch_id=$1 AND tenant_id=$2 ORDER BY created_at', [b.id, t])).rows;
    }
    res.json(batches);
  }));

  // POST process a bulk donation batch
  app.post('/api/bulk-donations/:id/process', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const batchId = req.params.id;

    const batch = (await pool.query('SELECT * FROM bulk_donation_batches WHERE id=$1 AND tenant_id=$2', [batchId, t])).rows[0];
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    if (batch.status === 'completed') return res.status(400).json({ error: 'Batch already processed' });

    // Mark as processing
    await pool.query("UPDATE bulk_donation_batches SET status='processing' WHERE id=$1", [batchId]);

    const items = (await pool.query('SELECT * FROM bulk_donation_items WHERE batch_id=$1 AND tenant_id=$2 AND status=$3', [batchId, t, 'pending'])).rows;
    let processed = 0;
    let errors = 0;

    for (const item of items) {
      try {
        // Create individual donations for each item
        // Find or use the first active campaign for this tenant
        let campaignId = req.body.campaign_id;
        if (!campaignId) {
          try {
            const campaign = (await pool.query("SELECT id FROM fundraising_campaigns WHERE tenant_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1", [t])).rows[0];
            campaignId = campaign ? campaign.id : null;
          } catch(e) {}
        }
        if (!campaignId) {
          await pool.query("UPDATE bulk_donation_items SET status='error' WHERE id=$1", [item.id]);
          errors++;
          continue;
        }

        // Insert the donation
        await pool.query('INSERT INTO campaign_donations(tenant_id,campaign_id,donor_name,amount,method,message) VALUES($1,$2,$3,$4,$5,$6)',
          [t, campaignId, item.donor_name, item.amount, item.method || 'cash', 'Bulk import - Batch #' + batchId]);

        await pool.query("UPDATE bulk_donation_items SET status='processed' WHERE id=$1", [item.id]);
        processed++;
      } catch(e) {
        await pool.query("UPDATE bulk_donation_items SET status='error' WHERE id=$1", [item.id]);
        errors++;
      }
    }

    // Update batch status
    const finalStatus = errors === 0 ? 'completed' : (processed > 0 ? 'completed' : 'failed');
    await pool.query('UPDATE bulk_donation_batches SET processed=$1,errors=$2,status=$3 WHERE id=$4',
      [processed, errors, finalStatus, batchId]);

    await audit(req.session.user.email, 'bulk_donation_processed', 'Processed batch #' + batchId + ': ' + processed + ' processed, ' + errors + ' errors', t);
    res.json({ batch_id: batchId, processed, errors, status: finalStatus });
  }));

  // ===========================================================
  // FEATURE 9: GIFT AID / TAX DEDUCTIONS
  // ===========================================================

  // GET all declarations
  app.get('/api/gift-tax-declarations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const declarations = (await pool.query('SELECT * FROM gift_tax_declarations WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
    res.json(declarations);
  }));

  // POST create declaration
  app.post('/api/gift-tax-declarations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_name, donor_email, tax_number, declaration_date, is_eligible } = req.body;
    if (!donor_name || !donor_name.trim()) return res.status(400).json({ error: 'Donor name is required' });
    const result = await pool.query(
      'INSERT INTO gift_tax_declarations(tenant_id,donor_name,donor_email,tax_number,declaration_date,is_eligible) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(donor_name), esc(donor_email || ''), esc(tax_number || ''), declaration_date || 'CURRENT_DATE', !!is_eligible]
    );
    await audit(req.session.user.email, 'tax_declaration_created', 'Created tax declaration for: ' + donor_name, t);
    res.json(result.rows[0]);
  }));

  // PUT update declaration
  app.put('/api/gift-tax-declarations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, donor_name, donor_email, tax_number, declaration_date, is_eligible } = req.body;
    if (!id) return res.status(400).json({ error: 'Declaration ID is required' });
    const existing = (await pool.query('SELECT * FROM gift_tax_declarations WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Declaration not found' });
    const result = await pool.query(
      'UPDATE gift_tax_declarations SET donor_name=$1,donor_email=$2,tax_number=$3,declaration_date=$4,is_eligible=$5 WHERE id=$6 AND tenant_id=$7 RETURNING *',
      [esc(donor_name || existing.donor_name), esc(donor_email !== undefined ? donor_email : existing.donor_email),
       esc(tax_number !== undefined ? tax_number : existing.tax_number),
       declaration_date || existing.declaration_date,
       is_eligible !== undefined ? !!is_eligible : existing.is_eligible, id, t]
    );
    await audit(req.session.user.email, 'tax_declaration_updated', 'Updated tax declaration #' + id, t);
    res.json(result.rows[0]);
  }));

  // GET tax receipts
  app.get('/api/tax-receipts', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const donor_email = req.query.donor_email || '';
    let q, params;
    if (donor_email) {
      q = 'SELECT * FROM tax_receipts WHERE tenant_id=$1 AND donor_email=$2 ORDER BY issued_at DESC';
      params = [t, donor_email];
    } else {
      q = 'SELECT * FROM tax_receipts WHERE tenant_id=$1 ORDER BY issued_at DESC LIMIT 100';
      params = [t];
    }
    const receipts = (await pool.query(q, params)).rows;
    res.json(receipts);
  }));

  // POST issue tax receipt
  app.post('/api/tax-receipts', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donation_id, donor_name, donor_email, amount, tax_deductible_amount } = req.body;
    if (!donor_name || !donor_name.trim()) return res.status(400).json({ error: 'Donor name is required' });
    if (!amount || parseInt(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });

    const receiptNumber = generateReceiptNumber();
    const deductible = tax_deductible_amount !== undefined ? parseInt(tax_deductible_amount) : parseInt(amount);

    const result = await pool.query(
      'INSERT INTO tax_receipts(tenant_id,donation_id,donor_name,donor_email,amount,tax_deductible_amount,receipt_number) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [t, donation_id || null, esc(donor_name), esc(donor_email || ''), parseInt(amount), deductible, receiptNumber]
    );

    // Send email if available
    if (donor_email && sendEmail) {
      try {
        await sendEmail(donor_email, 'Tax Receipt - ' + receiptNumber,
          '<div style="font-family:Arial;max-width:600px;margin:0 auto;padding:20px"><div style="background:linear-gradient(135deg,#059669,#10b981);padding:30px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:white;margin:0">Tax Receipt</h1></div><div style="background:white;padding:30px;border:1px solid #e2e8f0;border-radius:0 0 12px 12px"><p>Dear ' + esc(donor_name) + ',</p><p>Thank you for your donation. Here is your tax receipt:</p><table style="width:100%;border-collapse:collapse;margin:16px 0"><tr style="background:#f8fafc"><td style="padding:10px;border:1px solid #e2e8f0"><strong>Receipt Number</strong></td><td style="padding:10px;border:1px solid #e2e8f0">' + receiptNumber + '</td></tr><tr><td style="padding:10px;border:1px solid #e2e8f0"><strong>Donation Amount</strong></td><td style="padding:10px;border:1px solid #e2e8f0">UGX ' + parseInt(amount).toLocaleString() + '</td></tr><tr style="background:#f0fdf4"><td style="padding:10px;border:1px solid #e2e8f0"><strong>Tax Deductible Amount</strong></td><td style="padding:10px;border:1px solid #e2e8f0;color:#059669;font-weight:700">UGX ' + deductible.toLocaleString() + '</td></tr><tr><td style="padding:10px;border:1px solid #e2e8f0"><strong>Date Issued</strong></td><td style="padding:10px;border:1px solid #e2e8f0">' + new Date().toLocaleDateString() + '</td></tr></table><p style="color:#64748b;font-size:13px">Please retain this receipt for your tax records.</p></div></div>');
      } catch(e) { console.warn('[TaxReceipt Email]', e.message); }
    }

    await audit(req.session.user.email, 'tax_receipt_issued', 'Issued tax receipt ' + receiptNumber + ' for ' + donor_name, t);
    res.json(result.rows[0]);
  }));

  // ===========================================================
  // FEATURE 10: DONATION GOALS & CHALLENGES
  // ===========================================================

  // GET all challenges
  app.get('/api/donation-challenges', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const activeOnly = req.query.active === 'true';
    let q, params;
    if (activeOnly) {
      q = 'SELECT * FROM donation_challenges WHERE tenant_id=$1 AND is_active=true ORDER BY created_at DESC';
      params = [t];
    } else {
      q = 'SELECT * FROM donation_challenges WHERE tenant_id=$1 ORDER BY created_at DESC';
      params = [t];
    }
    const challenges = (await pool.query(q, params)).rows;
    // Attach participant count
    for (const ch of challenges) {
      const pcount = (await pool.query('SELECT COUNT(*) as cnt, COALESCE(SUM(amount_contributed),0) as total FROM challenge_participants WHERE challenge_id=$1 AND tenant_id=$2', [ch.id, t])).rows[0];
      ch.participant_count = parseInt(pcount.cnt);
      ch.participants_total = parseInt(pcount.total);
    }
    res.json(challenges);
  }));

  // POST create challenge
  app.post('/api/donation-challenges', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, challenge_type, target_amount, start_date, end_date } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Challenge name is required' });
    if (!target_amount || parseInt(target_amount) <= 0) return res.status(400).json({ error: 'Target amount must be greater than zero' });
    if (!start_date) return res.status(400).json({ error: 'Start date is required' });
    if (!end_date) return res.status(400).json({ error: 'End date is required' });

    const result = await pool.query(
      'INSERT INTO donation_challenges(tenant_id,name,description,challenge_type,target_amount,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [t, esc(name), esc(description || ''), esc(challenge_type || 'individual'), parseInt(target_amount), start_date, end_date]
    );
    await audit(req.session.user.email, 'donation_challenge_created', 'Created challenge: ' + name, t);
    res.json(result.rows[0]);
  }));

  // PUT update challenge
  app.put('/api/donation-challenges', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, name, description, challenge_type, target_amount, start_date, end_date, is_active, current_amount } = req.body;
    if (!id) return res.status(400).json({ error: 'Challenge ID is required' });
    const existing = (await pool.query('SELECT * FROM donation_challenges WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Challenge not found' });

    const result = await pool.query(
      `UPDATE donation_challenges SET name=$1,description=$2,challenge_type=$3,target_amount=$4,start_date=$5,end_date=$6,is_active=$7,current_amount=$8 WHERE id=$9 AND tenant_id=$10 RETURNING *`,
      [esc(name || existing.name), esc(description !== undefined ? description : existing.description),
       esc(challenge_type || existing.challenge_type),
       target_amount !== undefined ? parseInt(target_amount) : existing.target_amount,
       start_date || existing.start_date, end_date || existing.end_date,
       is_active !== undefined ? !!is_active : existing.is_active,
       current_amount !== undefined ? parseInt(current_amount) : existing.current_amount, id, t]
    );
    await audit(req.session.user.email, 'donation_challenge_updated', 'Updated challenge: ' + (name || existing.name), t);
    res.json(result.rows[0]);
  }));

  // DELETE challenge
  app.delete('/api/donation-challenges', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Challenge ID is required' });
    const existing = (await pool.query('SELECT * FROM donation_challenges WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Challenge not found' });
    await pool.query('DELETE FROM donation_challenges WHERE id=$1 AND tenant_id=$2', [id, t]);
    await audit(req.session.user.email, 'donation_challenge_deleted', 'Deleted challenge: ' + existing.name, t);
    res.json({ success: true });
  }));

  // POST join a challenge
  app.post('/api/challenges/:id/join', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const challengeId = req.params.id;
    const { donor_email, donor_name, amount_contributed } = req.body;

    const challenge = (await pool.query('SELECT * FROM donation_challenges WHERE id=$1 AND tenant_id=$2 AND is_active=true', [challengeId, t])).rows[0];
    if (!challenge) return res.status(404).json({ error: 'Challenge not found or not active' });

    // Check if challenge is within date range
    const now = new Date();
    if (now < new Date(challenge.start_date) || now > new Date(challenge.end_date)) {
      return res.status(400).json({ error: 'Challenge is not currently active (outside date range)' });
    }

    const email = donor_email || req.session.user.email;
    const name = donor_name || req.session.user.name || '';

    // Check if already joined
    const existing = (await pool.query('SELECT * FROM challenge_participants WHERE challenge_id=$1 AND donor_email=$2 AND tenant_id=$3', [challengeId, email, t])).rows[0];
    if (existing) {
      // Update contribution instead
      const contrib = parseInt(amount_contributed) || 0;
      if (contrib > 0) {
        await pool.query('UPDATE challenge_participants SET amount_contributed=amount_contributed+$1 WHERE id=$2', [contrib, existing.id]);
        await pool.query('UPDATE donation_challenges SET current_amount=current_amount+$1 WHERE id=$2', [contrib, challengeId]);
        // Check if challenge target reached
        const updated = (await pool.query('SELECT * FROM donation_challenges WHERE id=$1', [challengeId])).rows[0];
        if (parseInt(updated.current_amount) >= parseInt(updated.target_amount)) {
          notify(t, email, 'Challenge Target Reached!', 'The challenge "' + updated.name + '" has reached its target of UGX ' + parseInt(updated.target_amount).toLocaleString() + '!', 'fundraising');
        }
      }
      await audit(req.session.user.email, 'challenge_contribution_updated', 'Updated contribution to challenge: ' + challenge.name, t);
      return res.json({ success: true, message: 'Contribution updated' });
    }

    const contrib = parseInt(amount_contributed) || 0;
    const result = await pool.query(
      'INSERT INTO challenge_participants(tenant_id,challenge_id,donor_email,donor_name,amount_contributed) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [t, challengeId, esc(email), esc(name), contrib]
    );

    // Update challenge current_amount
    if (contrib > 0) {
      await pool.query('UPDATE donation_challenges SET current_amount=current_amount+$1 WHERE id=$2', [contrib, challengeId]);
    }

    // Check if challenge target reached
    const updatedChallenge = (await pool.query('SELECT * FROM donation_challenges WHERE id=$1', [challengeId])).rows[0];
    if (parseInt(updatedChallenge.current_amount) >= parseInt(updatedChallenge.target_amount)) {
      // Notify all participants
      const participants = (await pool.query('SELECT donor_email FROM challenge_participants WHERE challenge_id=$1 AND tenant_id=$2', [challengeId, t])).rows;
      for (const p of participants) {
        notify(t, p.donor_email, 'Challenge Target Reached!', 'The challenge "' + updatedChallenge.name + '" has reached its target of UGX ' + parseInt(updatedChallenge.target_amount).toLocaleString() + '!', 'fundraising');
      }
    }

    await audit(req.session.user.email, 'challenge_joined', 'Joined challenge: ' + challenge.name, t);
    res.json(result.rows[0]);
  }));

  // ===========================================================
  // PUBLIC-FACING API ROUTES (no auth required)
  // These provide data for the frontend widgets/pages
  // ===========================================================

  // Public: Get stretch goals for a campaign
  app.get('/api/public/campaigns/:id/stretch-goals', ah(async (req, res) => {
    const campaignId = req.params.id;
    const goals = (await pool.query('SELECT sg.*, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=$1) as raised FROM campaign_stretch_goals sg WHERE sg.campaign_id=$1 ORDER BY sg.goal_amount ASC', [campaignId])).rows;
    res.json(goals.map(g => ({
      id: g.id,
      goal_amount: parseInt(g.goal_amount),
      description: g.description,
      unlocked: g.unlocked,
      unlocked_at: g.unlocked_at,
      raised: parseInt(g.raised),
      progress: Math.min(100, Math.round(parseInt(g.raised) / parseInt(g.goal_amount) * 100))
    })));
  }));

  // Public: Get active challenges
  app.get('/api/public/challenges', ah(async (req, res) => {
    const tenantId = req.query.tenant_id;
    if (!tenantId) return res.json([]);
    const challenges = (await pool.query("SELECT id, name, description, challenge_type, target_amount, current_amount, start_date, end_date FROM donation_challenges WHERE tenant_id=$1 AND is_active=true AND end_date >= CURRENT_DATE ORDER BY created_at DESC", [tenantId])).rows;
    res.json(challenges);
  }));

  // Public: Get tip settings for donation form
  app.get('/api/public/tip-settings', ah(async (req, res) => {
    const tenantId = req.query.tenant_id;
    if (!tenantId) return res.json({ enabled: false, default_percentage: 10, custom_percentages: [5, 10, 15, 20] });
    const settings = (await pool.query('SELECT * FROM tip_settings WHERE tenant_id=$1', [tenantId])).rows[0];
    if (!settings) return res.json({ enabled: false, default_percentage: 10, custom_percentages: [5, 10, 15, 20] });
    let customPercentages = [5, 10, 15, 20];
    try { customPercentages = JSON.parse(settings.custom_percentages_json); } catch(e) {}
    res.json({
      enabled: settings.enabled,
      default_percentage: parseFloat(settings.default_percentage),
      custom_percentages: customPercentages
    });
  }));

  console.log('[FundraisingMega] All 10 features loaded');
};
