/**
 * Fundraising Pro Module — Professional Fundraising Platform
 * Features: Social Sharing, Donor Dashboard, Payouts, Donor Wall, QR Codes,
 * Refunds, Embed Widget, Matching Donations, Comments, Thank You Messages,
 * Milestone Celebrations, Anonymous Donations, Deadline Reminders, Receipts
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  // =============================================
  // DATABASE MIGRATIONS
  // =============================================
  const migrations = [
    `CREATE TABLE IF NOT EXISTS campaign_comments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE, user_email TEXT NOT NULL, user_name TEXT, comment TEXT NOT NULL, is_public BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS campaign_payouts (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE, amount INTEGER NOT NULL, method TEXT DEFAULT 'mobile_money', phone TEXT, account_name TEXT, account_number TEXT, status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','processing','completed','rejected')), reference TEXT, notes TEXT, requested_by TEXT, processed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS matching_donations (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE, sponsor_name TEXT NOT NULL, sponsor_email TEXT, match_ratio NUMERIC DEFAULT 1, max_amount INTEGER NOT NULL, matched_so_far INTEGER DEFAULT 0, start_date DATE, end_date DATE, status TEXT DEFAULT 'active' CHECK (status IN ('active','paused','completed','expired')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS donation_receipts (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, donation_id INTEGER, campaign_id INTEGER, donor_name TEXT, donor_email TEXT, amount INTEGER, method TEXT, receipt_number TEXT UNIQUE, issued_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS donor_profiles (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, display_name TEXT, is_anonymous BOOLEAN DEFAULT false, total_donated INTEGER DEFAULT 0, donation_count INTEGER DEFAULT 0, campaigns_supported INTEGER DEFAULT 0, joined_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, user_email))`,
    `CREATE TABLE IF NOT EXISTS campaign_milestones (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE, milestone_type TEXT NOT NULL, percentage INTEGER, message TEXT, triggered_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS campaign_deadline_reminders (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE, reminder_type TEXT, sent_at TIMESTAMPTZ DEFAULT NOW())`,
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_campaign_comments_campaign ON campaign_comments(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_comments_tenant ON campaign_comments(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_payouts_campaign ON campaign_payouts(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_payouts_tenant ON campaign_payouts(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_matching_donations_campaign ON matching_donations(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_matching_donations_tenant ON matching_donations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_profiles_tenant ON donor_profiles(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_profiles_email ON donor_profiles(user_email)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_receipts_tenant ON donation_receipts(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_receipts_receipt ON donation_receipts(receipt_number)`,
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) { /* already exists OK */ }
    }
    console.log('[FundraisingPro] Migrations complete');
  })();

  // =============================================
  // HELPER: Generate receipt number
  // =============================================
  function generateReceiptNumber() {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return 'RCP-' + ts + '-' + rand;
  }

  // =============================================
  // HELPER: Check and trigger milestones
  // =============================================
  async function checkMilestones(campaignId, tenantId) {
    try {
      const camp = (await pool.query('SELECT c.*, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=c.id AND tenant_id=c.tenant_id) as raised FROM fundraising_campaigns c WHERE c.id=$1', [campaignId])).rows[0];
      if (!camp || !camp.target || camp.target <= 0) return;

      const pct = Math.round((parseInt(camp.raised) / parseInt(camp.target)) * 100);
      const milestones = [25, 50, 75, 100];
      const labels = { 25: 'Quarter Way', 50: 'Halfway There', 75: 'Almost There', 100: 'Goal Reached!' };

      for (const m of milestones) {
        if (pct >= m) {
          const exists = (await pool.query('SELECT id FROM campaign_milestones WHERE campaign_id=$1 AND percentage=$2 AND tenant_id=$3', [campaignId, m, tenantId])).rows[0];
          if (!exists) {
            await pool.query('INSERT INTO campaign_milestones(tenant_id,campaign_id,milestone_type,percentage,message) VALUES($1,$2,$3,$4,$5)',
              [tenantId, campaignId, 'percentage', m, labels[m] + ' - ' + m + '% of goal reached!']);

            // Notify campaign organizer and donors
            const orgUsers = (await pool.query('SELECT email FROM users WHERE tenant_id=$1 LIMIT 10', [tenantId])).rows;
            for (const u of orgUsers) {
              notify(tenantId, u.email, 'Milestone: ' + m + '% Reached!', labels[m] + ' Your campaign "' + camp.title + '" has reached ' + m + '% of its fundraising goal!', 'fundraising');
            }

            // Post as campaign update
            await pool.query('INSERT INTO campaign_updates(tenant_id,campaign_id,title,content,update_type,created_by) VALUES($1,$2,$3,$4,$5,$6)',
              [tenantId, campaignId, labels[m], 'This campaign has reached ' + m + '% of its fundraising goal! Thank you to all donors who made this possible.', 'milestone', 'system']);

            // If 100%, auto-close campaign
            if (m === 100) {
              await pool.query("UPDATE fundraising_campaigns SET status='completed' WHERE id=$1 AND tenant_id=$2", [campaignId, tenantId]);
            }
          }
        }
      }
    } catch(e) { console.warn('[Milestones]', e.message); }
  }

  // =============================================
  // HELPER: Process matching donations
  // =============================================
  async function processMatchingDonation(campaignId, tenantId, donationAmount) {
    try {
      const matches = (await pool.query("SELECT * FROM matching_donations WHERE campaign_id=$1 AND tenant_id=$2 AND status='active' AND matched_so_far < max_amount AND (start_date IS NULL OR start_date <= CURRENT_DATE) AND (end_date IS NULL OR end_date >= CURRENT_DATE)", [campaignId, tenantId])).rows;
      for (const match of matches) {
        const remaining = match.max_amount - match.matched_so_far;
        const matchedAmt = Math.min(Math.round(donationAmount * parseFloat(match.match_ratio)), remaining);
        if (matchedAmt > 0) {
          await pool.query('UPDATE matching_donations SET matched_so_far=matched_so_far+$1 WHERE id=$2 AND tenant_id=$3', [matchedAmt, match.id, tenantId]);
          // Record the matched donation
          await pool.query('INSERT INTO campaign_donations(tenant_id,campaign_id,donor_name,amount,method,message) VALUES($1,$2,$3,$4,$5,$6)',
            [tenantId, campaignId, match.sponsor_name + ' (Matched)', matchedAmt, 'matching', 'Matched donation - ' + match.match_ratio + 'x match from ' + match.sponsor_name]);
          // Update matching total
          if (match.matched_so_far + matchedAmt >= match.max_amount) {
            await pool.query("UPDATE matching_donations SET status='completed' WHERE id=$1 AND tenant_id=$2", [match.id, tenantId]);
          }
        }
      }
    } catch(e) { console.warn('[MatchingDonations]', e.message); }
  }

  // =============================================
  // HELPER: Send thank you notification
  // =============================================
  async function sendThankYou(tenantId, donorEmail, donorName, amount, campaignTitle) {
    try {
      if (donorEmail) {
        // In-app notification
        notify(tenantId, donorEmail, 'Thank You for Your Donation!', 'Your donation of UGX ' + (parseInt(amount)||0).toLocaleString() + ' to "' + campaignTitle + '" has been received. Thank you for your generosity!', 'fundraising');
        // Email
        if (sendEmail) {
          queueEmail ? null : null; // emails are queued in main server
          try { sendEmail(donorEmail, 'Thank You for Your Donation - ' + campaignTitle, '<div style="font-family:Arial;max-width:600px;margin:0 auto;padding:20px"><div style="background:linear-gradient(135deg,#059669,#10b981);padding:30px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:white;margin:0">Thank You!</h1></div><div style="background:white;padding:30px;border:1px solid #e2e8f0;border-radius:0 0 12px 12px"><p>Dear ' + esc(donorName || 'Donor') + ',</p><p>Thank you for your generous donation of <strong>UGX ' + (parseInt(amount)||0).toLocaleString() + '</strong> to <strong>' + esc(campaignTitle) + '</strong>.</p><p>Your contribution makes a real difference. You can track the campaign progress anytime on the platform.</p><p style="color:#64748b;font-size:13px;margin-top:30px">This receipt was generated by Comfort Platform.</p></div></div>'); } catch(e) {}
        }
      }
    } catch(e) { console.warn('[ThankYou]', e.message); }
  }

  // =============================================
  // HELPER: Update donor profile
  // =============================================
  async function updateDonorProfile(tenantId, donorEmail, donorName, amount) {
    try {
      if (!donorEmail) return;
      await pool.query(`INSERT INTO donor_profiles (tenant_id, user_email, display_name, total_donated, donation_count, campaigns_supported)
        VALUES ($1, $2, $3, $4, 1, 1)
        ON CONFLICT (tenant_id, user_email) DO UPDATE SET
          display_name = COALESCE(donor_profiles.display_name, $3),
          total_donated = donor_profiles.total_donated + $4,
          donation_count = donor_profiles.donation_count + 1`,
        [tenantId, donorEmail, donorName || 'Anonymous', amount || 0]);
      // Update campaigns_supported count
      await pool.query(`UPDATE donor_profiles SET campaigns_supported = (SELECT COUNT(DISTINCT campaign_id) FROM campaign_donations WHERE (donor_name = $1 OR message LIKE '%' || $2 || '%') AND tenant_id = $3) WHERE tenant_id = $3 AND user_email = $2`,
        [donorName || 'Anonymous', donorEmail, tenantId]);
    } catch(e) { console.warn('[DonorProfile]', e.message); }
  }

  // =============================================
  // 1. SOCIAL SHARING BUTTONS
  // =============================================
  // API endpoint to get share data for a campaign
  app.get('/api/campaigns/:id/share', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.json({ error: 'Not found' });
    const url = BASE_URL + '/discover/' + c.id;
    const text = 'Support "' + c.title + '" by ' + (c.org_name||'') + ' - Goal: UGX ' + (parseInt(c.target)||0).toLocaleString();
    res.json({
      campaign: c.title,
      org: c.org_name,
      url: url,
      text: text,
      whatsapp: 'https://wa.me/?text=' + encodeURIComponent(text + ' ' + url),
      twitter: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url),
      facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url),
      linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url),
      email: 'mailto:?subject=' + encodeURIComponent(text) + '&body=' + encodeURIComponent('I thought you might want to support this cause:\n\n' + text + '\n\n' + url),
      copyLink: url
    });
  }));

  // =============================================
  // 2. DONOR DASHBOARD
  // =============================================
  app.get('/my-donations/simple', requireAuth, ah(async (req, res) => {
    const email = req.session.user.email;
    const t = req.session.user.tenant_id;

    // Get all donations by this user across all tenants
    const myDonations = (await pool.query(`SELECT cd.*, fc.title as campaign_title, fc.category, t.name as org_name, t.subdomain
      FROM campaign_donations cd
      JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
      JOIN tenants t ON fc.tenant_id = t.id
      WHERE cd.donor_name = $1 OR cd.tenant_id = ANY(SELECT tenant_id FROM users WHERE email = $2)
      ORDER BY cd.donated_at DESC LIMIT 100`,
      [req.session.user.name || email, email])).rows;

    // Get donor profile
    let donorProfile = (await pool.query('SELECT * FROM donor_profiles WHERE user_email=$1 AND tenant_id=$2', [email, t])).rows[0];

    // Get receipts
    const receipts = (await pool.query('SELECT * FROM donation_receipts WHERE donor_email=$1 AND tenant_id=$2 ORDER BY issued_at DESC LIMIT 50', [email, t])).rows;

    const totalDonated = myDonations.reduce((s, d) => s + (parseInt(d.amount) || 0), 0);
    const campaignsCount = new Set(myDonations.map(d => d.campaign_id)).size;

    res.send(renderPage('My Donations', `
      <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981)">
        <h1>My Giving Dashboard</h1>
        <p>Track your donations and impact</p>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${totalDonated.toLocaleString()}</div><div>Total Donated</div></div>
        <div class="stat-card"><div class="stat-num">${myDonations.length}</div><div>Donations Made</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${campaignsCount}</div><div>Campaigns Supported</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${receipts.length}</div><div>Receipts</div></div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <a href="/discover" class="btn btn-green">Discover Campaigns</a>
        <a href="/investor/dashboard" class="btn btn-sm">Investor Dashboard</a>
        <a href="/donor-profile/edit" class="btn btn-sm">Edit Donor Profile</a>
      </div>
      <div class="card">
        <h2>Donation History</h2>
        ${myDonations.length ? '<table><tr><th>Campaign</th><th>Organization</th><th>Amount</th><th>Method</th><th>Date</th><th>Receipt</th></tr>' +
          myDonations.map(d => '<tr><td><strong>' + esc(d.campaign_title) + '</strong></td><td class="muted">' + esc(d.org_name) + '</td><td style="color:#059669;font-weight:700">UGX ' + (parseInt(d.amount)||0).toLocaleString() + '</td><td><span class="tag">' + esc(d.method) + '</span></td><td>' + (d.donated_at ? new Date(d.donated_at).toLocaleDateString() : '') + '</td><td><a href="/donations/receipt/' + d.id + '" class="btn btn-sm">View</a></td></tr>').join('') + '</table>' : '<p class="muted" style="text-align:center;padding:40px">No donations yet. <a href="/discover" class="btn btn-green">Browse Campaigns</a></p>'}
      </div>
      ${receipts.length > 0 ? '<div class="card" style="margin-top:20px"><h2>Receipts</h2><table><tr><th>Receipt #</th><th>Amount</th><th>Issued</th><th>Action</th></tr>' + receipts.map(r => '<tr><td><code>' + esc(r.receipt_number) + '</code></td><td>UGX ' + (parseInt(r.amount)||0).toLocaleString() + '</td><td>' + new Date(r.issued_at).toLocaleDateString() + '</td><td><a href="/donations/receipt/' + r.id + '" class="btn btn-sm">Download</a></td></tr>').join('') + '</table></div>' : ''}
    `, req.session.user));
  }));

  // Donor profile edit
  app.get('/donor-profile/edit', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const email = req.session.user.email;
    let profile = (await pool.query('SELECT * FROM donor_profiles WHERE user_email=$1 AND tenant_id=$2', [email, t])).rows[0];
    res.send(renderPage('Edit Donor Profile', `
      <div class="card" style="max-width:600px;margin:40px auto">
        <h2>Donor Profile</h2>
        <p class="muted" style="margin-bottom:20px">Customize how your name appears on donor walls and manage your giving preferences.</p>
        <form method="POST" action="/donor-profile/save">
          <div><label style="font-weight:600;display:block;margin-bottom:6px">Display Name</label><input name="display_name" value="${esc(profile?.display_name || req.session.user.name || '')}" placeholder="How should your name appear?" style="width:100%"></div>
          <div style="margin-top:16px"><label style="display:flex;align-items:center;gap:10px;cursor:pointer"><input type="checkbox" name="is_anonymous" ${profile?.is_anonymous ? 'checked' : ''}> Donate anonymously (your name won\'t appear on donor walls)</label></div>
          <button type="submit" class="btn btn-green" style="width:100%;margin-top:20px;padding:14px">Save Profile</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/donor-profile/save', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const email = req.session.user.email;
    const { display_name, is_anonymous } = req.body;
    await pool.query(`INSERT INTO donor_profiles (tenant_id, user_email, display_name, is_anonymous) VALUES ($1, $2, $3, $4)
      ON CONFLICT (tenant_id, user_email) DO UPDATE SET display_name = $3, is_anonymous = $4`,
      [t, email, display_name || req.session.user.name, !!is_anonymous]);
    await audit(req.session.user.email, 'donor_profile_updated', 'Updated donor profile for ' + email, t);
    res.redirect('/my-donations/simple');
  }));

  // =============================================
  // 3. CAMPAIGN PAYOUTS / WITHDRAWALS
  // =============================================
  app.get('/fundraising/:id/payout', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const c = (await pool.query('SELECT c.*, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=c.id AND tenant_id=c.tenant_id) as raised, (SELECT COALESCE(SUM(amount),0) FROM campaign_payouts WHERE campaign_id=c.id AND tenant_id=c.tenant_id AND status IN ($1,$2,$3)) as pending_payouts FROM fundraising_campaigns c WHERE c.id=$4 AND c.tenant_id=$5', ['pending','approved','processing', req.params.id, t])).rows[0];
    if (!c) return res.status(404).send('Not found');
    const available = parseInt(c.raised) - parseInt(c.pending_payouts || 0);
    const pastPayouts = (await pool.query('SELECT * FROM campaign_payouts WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY created_at DESC', [c.id, t])).rows;

    res.send(renderPage('Request Payout', `
      <div class="card" style="max-width:650px;margin:40px auto">
        <h2>Request Payout - ${esc(c.title)}</h2>
        <div class="stats" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:20px">
          <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${parseInt(c.raised).toLocaleString()}</div><div>Total Raised</div></div>
          <div class="stat-card"><div class="stat-num" style="color:#f59e0b">UGX ${parseInt(c.pending_payouts||0).toLocaleString()}</div><div>Pending Payouts</div></div>
          <div class="stat-card"><div class="stat-num" style="color:#4f46e5">UGX ${available.toLocaleString()}</div><div>Available</div></div>
        </div>
        ${available <= 0 ? '<div class="alert alert-info">No funds available for withdrawal at this time.</div>' : `
        <form method="POST" action="/fundraising/${c.id}/payout-save">
          <div><label style="font-weight:600;display:block;margin-bottom:6px">Amount to Withdraw (UGX) *</label><input name="amount" type="number" max="${available}" placeholder="${available}" required style="width:100%"></div>
          <div style="margin-top:12px"><label style="font-weight:600;display:block;margin-bottom:6px">Payment Method *</label><select name="method" style="width:100%"><option value="mobile_money">Mobile Money (MTN/Airtel)</option><option value="bank_transfer">Bank Transfer</option><option value="cash">Cash Pickup</option></select></div>
          <div style="margin-top:12px"><label style="font-weight:600;display:block;margin-bottom:6px">Phone / Account Number *</label><input name="phone" placeholder="256700000000 or account number" required style="width:100%"></div>
          <div style="margin-top:12px"><label style="font-weight:600;display:block;margin-bottom:6px">Account Name</label><input name="account_name" placeholder="Name on the account" style="width:100%"></div>
          <div style="margin-top:12px"><label style="font-weight:600;display:block;margin-bottom:6px">Notes</label><textarea name="notes" rows="2" placeholder="Any special instructions" style="width:100%"></textarea></div>
          <div class="alert alert-info" style="margin-top:16px">A 5% platform fee is deducted from all donations. Payouts are processed within 1-3 business days.</div>
          <button class="btn btn-green" style="width:100%;margin-top:16px;padding:14px;font-size:16px">Submit Payout Request</button>
        </form>`}
        ${pastPayouts.length > 0 ? '<h3 style="margin-top:30px">Payout History</h3><table><tr><th>Amount</th><th>Method</th><th>Status</th><th>Requested</th></tr>' + pastPayouts.map(p => '<tr><td>UGX ' + (parseInt(p.amount)||0).toLocaleString() + '</td><td>' + esc(p.method) + '</td><td><span class="tag" style="background:' + (p.status==='completed'?'#d1fae5;color:#065f46':p.status==='pending'?'#fef3c7;color:#92400e':p.status==='rejected'?'#fee2e2;color:#991b1b':'#dbeafe;color:#1e40af') + '">' + esc(p.status) + '</span></td><td>' + new Date(p.created_at).toLocaleDateString() + '</td></tr>').join('') + '</table>' : ''}
      </div>
    `, req.session.user));
  }));

  app.post('/fundraising/:id/payout-save', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { amount, method, phone, account_name, notes } = req.body;
    const c = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!c) return res.status(404).send('Not found');
    await pool.query('INSERT INTO campaign_payouts(tenant_id,campaign_id,amount,method,phone,account_name,account_number,notes,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [t, c.id, amount || 0, method || 'mobile_money', phone || '', account_name || '', phone || '', notes || '', req.session.user.email]);
    await audit(req.session.user.email, 'payout_requested', 'Requested payout of UGX ' + (parseInt(amount)||0).toLocaleString() + ' for campaign "' + c.title + '"', t);
    // Notify admins
    const admins = (await pool.query("SELECT email FROM users WHERE tenant_id=$1 AND role IN ('admin','super_admin')", [t])).rows;
    for (const a of admins) {
      notify(t, a.email, 'Payout Request', 'A payout of UGX ' + (parseInt(amount)||0).toLocaleString() + ' has been requested for campaign "' + c.title + '".', 'fundraising');
    }
    res.redirect('/fundraising/' + c.id);
  }));

  // Admin: Process payout requests
  app.get('/admin/payouts', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const payouts = (await pool.query('SELECT cp.*, fc.title as campaign_title FROM campaign_payouts cp JOIN fundraising_campaigns fc ON cp.campaign_id=fc.id WHERE cp.tenant_id=$1 ORDER BY cp.created_at DESC', [t])).rows;
    res.send(renderPage('Manage Payouts', `
      <div class="hero" style="background:linear-gradient(135deg,#7c3aed,#ec4899)"><h1>Manage Payouts</h1><p>Process withdrawal requests</p></div>
      <div class="card">
        ${payouts.length ? '<table><tr><th>Campaign</th><th>Amount</th><th>Method</th><th>Phone/Account</th><th>Status</th><th>Date</th><th>Actions</th></tr>' +
          payouts.map(p => '<tr><td>' + esc(p.campaign_title) + '</td><td style="font-weight:700">UGX ' + (parseInt(p.amount)||0).toLocaleString() + '</td><td>' + esc(p.method) + '</td><td>' + esc(p.phone || p.account_number || '-') + '</td><td><span class="tag" style="background:' + (p.status==='completed'?'#d1fae5;color:#065f46':p.status==='pending'?'#fef3c7;color:#92400e':'#fee2e2;color:#991b1b') + '">' + esc(p.status) + '</span></td><td>' + new Date(p.created_at).toLocaleDateString() + '</td><td>' + (p.status==='pending'?'<form method="POST" action="/admin/payouts/'+p.id+'/approve" style="display:inline"><button type="submit" class="btn btn-sm btn-green">Approve</button></form> <form method="POST" action="/admin/payouts/'+p.id+'/reject" style="display:inline"><button type="submit" class="btn btn-sm btn-red">Reject</button></form>':p.status==='approved'?'<form method="POST" action="/admin/payouts/'+p.id+'/complete" style="display:inline"><button type="submit" class="btn btn-sm btn-green">Mark Complete</button></form>':'') + '</td></tr>').join('') + '</table>' : '<p class="muted" style="text-align:center;padding:40px">No payout requests yet.</p>'}
      </div>
    `, req.session.user));
  }));

  app.post('/admin/payouts/:id/approve', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    await pool.query("UPDATE campaign_payouts SET status='approved', processed_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, t]);
    await audit(req.session.user.email, 'payout_approved', 'Approved payout #' + req.params.id, t);
    res.redirect('/admin/payouts');
  }));

  app.post('/admin/payouts/:id/complete', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const payout = (await pool.query('SELECT * FROM campaign_payouts WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!payout) return res.status(404).send('Not found');
    await pool.query("UPDATE campaign_payouts SET status='completed', processed_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, t]);
    await audit(req.session.user.email, 'payout_completed', 'Completed payout #' + req.params.id, t);
    // Notify requester
    if (payout.requested_by) {
      notify(t, payout.requested_by, 'Payout Completed', 'Your payout of UGX ' + (parseInt(payout.amount)||0).toLocaleString() + ' has been processed!', 'fundraising');
    }
    res.redirect('/admin/payouts');
  }));

  app.post('/admin/payouts/:id/reject', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    await pool.query("UPDATE campaign_payouts SET status='rejected', processed_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, t]);
    await audit(req.session.user.email, 'payout_rejected', 'Rejected payout #' + req.params.id, t);
    res.redirect('/admin/payouts');
  }));

  // =============================================
  // 4. DONOR WALL / RECOGNITION
  // =============================================
  app.get('/campaigns/:id/donors-list', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1 AND fc.is_public=true', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Not found');

    // Get donations with donor profiles (check if anonymous)
    const donations = (await pool.query(`SELECT cd.*, dp.is_anonymous, dp.display_name as profile_name
      FROM campaign_donations cd
      LEFT JOIN donor_profiles dp ON cd.donor_name = dp.display_name AND dp.tenant_id = fc.tenant_id
      JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
      WHERE cd.campaign_id = $1
      ORDER BY cd.amount DESC, cd.donated_at DESC LIMIT 100`, [c.id])).rows;

    // Simplified query that works
    const simpleDonations = (await pool.query('SELECT * FROM campaign_donations WHERE campaign_id=$1 AND tenant_id=$2 AND amount > 0 ORDER BY amount DESC, donated_at DESC LIMIT 100', [c.id, c.tenant_id])).rows;

    const totalDonors = simpleDonations.length;
    const topDonors = simpleDonations.slice(0, 10);

    res.send(renderPage('Donor Wall - ' + c.title, `
      <div class="hero" style="background:linear-gradient(135deg,#f59e0b,#ef4444)">
        <h1>Donor Wall</h1>
        <p>${esc(c.title)} by ${esc(c.org_name || '')}</p>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${totalDonors}</div><div>Generous Donors</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${simpleDonations.reduce((s,d)=>s+(parseInt(d.amount)||0),0).toLocaleString()}</div><div>Total Donated</div></div>
      </div>
      <div class="card">
        <h2>Top Supporters</h2>
        ${topDonors.length > 0 ? '<div class="grid">' + topDonors.map((d, i) => {
          const badge = i === 0 ? '<span style="font-size:24px">🥇</span>' : i === 1 ? '<span style="font-size:24px">🥈</span>' : i === 2 ? '<span style="font-size:24px">🥉</span>' : '';
          const name = d.donor_name === 'Anonymous' ? 'Anonymous Donor' : esc(d.donor_name);
          return '<div class="card" style="text-align:center;padding:20px">' + badge + '<h4 style="margin:8px 0">' + name + '</h4><div style="color:#059669;font-weight:700;font-size:18px">UGX ' + (parseInt(d.amount)||0).toLocaleString() + '</div>' + (d.message ? '<p class="muted" style="margin-top:8px;font-style:italic">"' + esc(d.message.substring(0,100)) + '"</p>' : '') + '</div>';
        }).join('') + '</div>' : '<p class="muted" style="text-align:center;padding:40px">No donors yet. Be the first to contribute!</p>'}

        <h3 style="margin-top:30px">All Donations</h3>
        ${simpleDonations.length > 0 ? '<table><tr><th>#</th><th>Donor</th><th>Amount</th><th>Message</th><th>Date</th></tr>' +
          simpleDonations.map((d, i) => '<tr><td>' + (i+1) + '</td><td>' + esc(d.donor_name === 'Anonymous' ? 'Anonymous Donor' : d.donor_name) + '</td><td style="font-weight:700;color:#059669">UGX ' + (parseInt(d.amount)||0).toLocaleString() + '</td><td class="muted">' + esc((d.message||'').substring(0,60)) + '</td><td>' + (d.donated_at ? new Date(d.donated_at).toLocaleDateString() : '') + '</td></tr>').join('') + '</table>' : ''}
      </div>
      <div style="text-align:center;margin-top:20px">
        <a href="/discover/${c.id}/donate" class="btn btn-green" style="padding:14px 40px;font-size:16px">Donate Now</a>
        <a href="/discover/${c.id}" class="btn btn-sm" style="margin-left:10px">Back to Campaign</a>
      </div>
    `, req.session.user));
  }));

  // =============================================
  // 5. QR CODES FOR CAMPAIGNS
  // =============================================
  app.get('/campaigns/:id/qr-simple', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Not found');
    const campaignUrl = BASE_URL + '/discover/' + c.id;
    const donateUrl = BASE_URL + '/discover/' + c.id + '/donate';

    // Generate QR code using a simple SVG-based approach (no external lib needed)
    const qrSvgUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(donateUrl);

    res.send(renderPage('QR Code - ' + c.title, `
      <div class="card" style="max-width:600px;margin:40px auto;text-align:center">
        <h2>QR Code for ${esc(c.title)}</h2>
        <p class="muted" style="margin-bottom:20px">Print this QR code on posters, flyers, or bulletins. Scanning it goes directly to the donation page.</p>
        <div style="background:white;padding:30px;border-radius:16px;display:inline-block;border:2px solid #e2e8f0;margin-bottom:20px">
          <img src="${qrSvgUrl}" alt="QR Code" style="width:250px;height:250px" onerror="this.parentElement.innerHTML='<p style=\\'color:#dc2626\\'>QR code service unavailable. Use the direct link below.</p>'">
        </div>
        <div style="margin-top:16px">
          <p><strong>Direct Link:</strong></p>
          <code style="background:#f1f5f9;padding:10px 16px;border-radius:8px;display:block;margin:10px 0;word-break:break-all">${donateUrl}</code>
        </div>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:20px;flex-wrap:wrap">
          <a href="${qrSvgUrl}" download="qr-campaign-${c.id}.png" class="btn btn-green">Download QR Image</a>
          <a href="/discover/${c.id}" class="btn btn-sm">View Campaign</a>
        </div>
        <div class="alert alert-info" style="margin-top:20px;text-align:left">
          <strong>Tips for using QR codes:</strong>
          <ul style="padding-left:20px;margin-top:8px">
            <li>Print on church bulletins and service programs</li>
            <li>Add to event posters and flyers</li>
            <li>Display on screens during services or events</li>
            <li>Include in email newsletters</li>
            <li>Place on donation boxes and collection points</li>
          </ul>
        </div>
      </div>
    `, req.session.user));
  }));

  // =============================================
  // 6. REFUND HANDLING
  // =============================================
  app.get('/admin/refunds', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const transactions = (await pool.query(`SELECT it.*, fc.title as campaign_title, i.full_name as investor_name
      FROM investment_transactions it
      JOIN fundraising_campaigns fc ON it.campaign_id = fc.id
      LEFT JOIN fundraising_investors i ON it.investor_email = i.user_email
      WHERE it.tenant_id = $1 AND it.status IN ('completed','pending')
      ORDER BY it.created_at DESC LIMIT 100`, [t])).rows;

    const refunded = (await pool.query(`SELECT it.*, fc.title as campaign_title
      FROM investment_transactions it
      JOIN fundraising_campaigns fc ON it.campaign_id = fc.id
      WHERE it.tenant_id = $1 AND it.status = 'refunded'
      ORDER BY it.created_at DESC LIMIT 50`, [t])).rows;

    res.send(renderPage('Refund Management', `
      <div class="hero" style="background:linear-gradient(135deg,#dc2626,#f59e0b)"><h1>Refund Management</h1><p>Process and track donation refunds</p></div>
      <div class="card">
        <h2>Active Transactions</h2>
        ${transactions.length ? '<table><tr><th>Campaign</th><th>Investor</th><th>Amount</th><th>Type</th><th>Status</th><th>Date</th><th>Action</th></tr>' +
          transactions.map(tx => '<tr><td>' + esc(tx.campaign_title) + '</td><td>' + esc(tx.investor_name || tx.investor_email) + '</td><td style="font-weight:700">UGX ' + (parseInt(tx.amount)||0).toLocaleString() + '</td><td><span class="tag">' + esc(tx.transaction_type) + '</span></td><td><span class="tag" style="background:' + (tx.status==='completed'?'#d1fae5;color:#065f46':'#fef3c7;color:#92400e') + '">' + esc(tx.status) + '</span></td><td>' + new Date(tx.created_at).toLocaleDateString() + '</td><td><form method="POST" action="/admin/refunds/' + tx.id + '/process" style="display:inline"><button type="submit" class="btn btn-sm btn-red" onclick="return confirm(\'Process refund for this transaction?\')">Refund</button></form></td></tr>').join('') + '</table>' : '<p class="muted">No active transactions to refund.</p>'}
      </div>
      ${refunded.length > 0 ? '<div class="card" style="margin-top:20px"><h2>Refund History</h2><table><tr><th>Campaign</th><th>Amount</th><th>Refunded</th></tr>' + refunded.map(tx => '<tr><td>' + esc(tx.campaign_title) + '</td><td>UGX ' + (parseInt(tx.amount)||0).toLocaleString() + '</td><td>' + new Date(tx.created_at).toLocaleDateString() + '</td></tr>').join('') + '</table></div>' : ''}
    `, req.session.user));
  }));

  app.post('/admin/refunds/:id/process', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const tx = (await pool.query('SELECT * FROM investment_transactions WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!tx) return res.status(404).send('Not found');
    // Mark as refunded
    await pool.query("UPDATE investment_transactions SET status='refunded' WHERE id=$1 AND tenant_id=$2", [req.params.id, t]);
    // Deduct from investor total
    if (tx.investor_email) {
      await pool.query('UPDATE fundraising_investors SET total_invested=GREATEST(0,total_invested-$1), campaigns_supported=GREATEST(0,campaigns_supported-1) WHERE user_email=$2 AND tenant_id=$3', [tx.amount, tx.investor_email, t]);
    }
    // Deduct platform fee back
    if (tx.platform_fee > 0) {
      await pool.query('UPDATE platform_wallet SET balance=GREATEST(0,balance-$1) WHERE id=1', [tx.platform_fee]);
    }
    // Notify investor
    if (tx.investor_email) {
      notify(t, tx.investor_email, 'Refund Processed', 'A refund of UGX ' + (parseInt(tx.amount)||0).toLocaleString() + ' has been processed for your transaction.', 'fundraising');
    }
    await audit(req.session.user.email, 'refund_processed', 'Refunded transaction #' + tx.id + ' amount UGX ' + tx.amount);
    res.redirect('/admin/refunds');
  }));

  // =============================================
  // 7. CAMPAIGN EMBED WIDGET
  // =============================================
  app.get('/campaigns/:id/embed-simple', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id AND tenant_id=fc.tenant_id) as raised FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Not found');
    const pct = c.target > 0 ? Math.min(100, Math.round(parseInt(c.raised||0)/parseInt(c.target||1)*100)) : 0;
    const donateUrl = BASE_URL + '/discover/' + c.id + '/donate';

    const embedIframe = '<iframe src="' + BASE_URL + '/campaigns/' + c.id + '/widget" width="400" height="520" frameborder="0" style="border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1)"></iframe>';

    res.send(renderPage('Embed Campaign - ' + c.title, `
      <div class="card" style="max-width:700px;margin:40px auto">
        <h2>Embed ${esc(c.title)} on Your Website</h2>
        <p class="muted" style="margin-bottom:20px">Copy and paste the code below to embed this campaign on your website, blog, or church page.</p>

        <h3>Preview</h3>
        <div style="border:2px dashed #e2e8f0;padding:20px;border-radius:12px;margin-bottom:20px;text-align:center">
          <div style="max-width:400px;margin:0 auto;background:white;border-radius:12px;padding:24px;box-shadow:0 4px 20px rgba(0,0,0,0.1);text-align:left">
            <h3 style="margin:0 0 8px">${esc(c.title)}</h3>
            <p style="color:#64748b;font-size:13px;margin:0 0 16px">by ${esc(c.org_name)}</p>
            <div style="background:#e2e8f0;height:12px;border-radius:6px;margin-bottom:8px"><div style="background:#059669;height:12px;border-radius:6px;width:${pct}%"></div></div>
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:16px"><span style="color:#059669;font-weight:700">UGX ${parseInt(c.raised||0).toLocaleString()}</span><span style="color:#64748b">of UGX ${parseInt(c.target||0).toLocaleString()}</span></div>
            <a href="${donateUrl}" style="display:block;text-align:center;padding:12px;background:#059669;color:white;border-radius:8px;text-decoration:none;font-weight:700">Donate Now</a>
          </div>
        </div>

        <h3>Embed Code</h3>
        <textarea readonly style="width:100%;height:100px;font-family:monospace;font-size:13px;padding:12px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc" onclick="this.select();document.execCommand('copy')">${esc(embedIframe)}</textarea>
        <p class="muted" style="font-size:12px;margin-top:8px">Click the code above to copy it to your clipboard.</p>

        <h3 style="margin-top:20px">Direct Link</h3>
        <code style="background:#f1f5f9;padding:10px 16px;border-radius:8px;display:block;word-break:break-all">${donateUrl}</code>

        <h3 style="margin-top:20px">Button Link (for websites)</h3>
        <textarea readonly style="width:100%;height:80px;font-family:monospace;font-size:13px;padding:12px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc" onclick="this.select()">&lt;a href="${donateUrl}" style="display:inline-block;padding:14px 28px;background:#059669;color:white;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px"&gt;Donate to ${esc(c.title)}&lt;/a&gt;</textarea>
      </div>
    `, req.session.user));
  }));

  // Embeddable widget endpoint
  app.get('/campaigns/:id/widget', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id AND tenant_id=fc.tenant_id) as raised FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1 AND fc.is_public=true', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Campaign not found');
    const pct = c.target > 0 ? Math.min(100, Math.round(parseInt(c.raised||0)/parseInt(c.target||1)*100)) : 0;
    const donateUrl = BASE_URL + '/discover/' + c.id + '/donate';

    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:20px;background:white}.widget{max-width:360px;margin:0 auto}h3{font-size:18px;margin-bottom:4px}.org{color:#64748b;font-size:13px;margin-bottom:16px}.bar{background:#e2e8f0;height:12px;border-radius:6px;margin-bottom:8px}.fill{background:#059669;height:12px;border-radius:6px;transition:width 0.5s}.amounts{display:flex;justify-content:space-between;font-size:13px;margin-bottom:16px}.raised{color:#059669;font-weight:700}.goal{color:#64748b}.btn{display:block;text-align:center;padding:14px;background:#059669;color:white;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px}.btn:hover{background:#047857}</style></head><body><div class="widget"><h3>${esc(c.title)}</h3><p class="org">by ${esc(c.org_name)}</p><div class="bar"><div class="fill" style="width:${pct}%"></div></div><div class="amounts"><span class="raised">UGX ${parseInt(c.raised||0).toLocaleString()}</span><span class="goal">of UGX ${parseInt(c.target||0).toLocaleString()}</span></div><p style="font-size:14px;color:#475569;margin-bottom:16px;line-height:1.5">${esc((c.description||'').substring(0,200))}</p><a href="${donateUrl}" target="_blank" class="btn">Donate Now</a></div></body></html>`);
  }));

  // =============================================
  // 8. MATCHING DONATIONS
  // =============================================
  app.get('/fundraising/:id/matching', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const c = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!c) return res.status(404).send('Not found');
    const matches = (await pool.query('SELECT * FROM matching_donations WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY created_at DESC', [c.id, t])).rows;

    res.send(renderPage('Matching Donations - ' + c.title, `
      <div class="card" style="max-width:700px;margin:40px auto">
        <h2>Matching Donations</h2>
        <p class="muted" style="margin-bottom:20px">When a sponsor matches donations, every donation is multiplied — doubling or tripling the impact!</p>
        <a href="/fundraising/${c.id}/matching/new" class="btn btn-green" style="margin-bottom:20px">+ Add Matching Sponsor</a>
        ${matches.length > 0 ? '<table><tr><th>Sponsor</th><th>Match Ratio</th><th>Max Amount</th><th>Matched So Far</th><th>Status</th><th>Actions</th></tr>' +
          matches.map(m => '<tr><td><strong>' + esc(m.sponsor_name) + '</strong>' + (m.sponsor_email ? '<br><span class="muted">' + esc(m.sponsor_email) + '</span>' : '') + '</td><td>' + m.match_ratio + 'x</td><td>UGX ' + (parseInt(m.max_amount)||0).toLocaleString() + '</td><td>UGX ' + (parseInt(m.matched_so_far)||0).toLocaleString() + '</td><td><span class="tag" style="background:' + (m.status==='active'?'#d1fae5;color:#065f46':m.status==='completed'?'#dbeafe;color:#1e40af':'#fef3c7;color:#92400e') + '">' + esc(m.status) + '</span></td><td>' + (m.status==='active'?'<form method="POST" action="/fundraising/matching/'+m.id+'/pause" style="display:inline"><button type="submit" class="btn btn-sm">Pause</button></form>':'') + (m.status==='paused'?'<form method="POST" action="/fundraising/matching/'+m.id+'/resume" style="display:inline"><button type="submit" class="btn btn-sm btn-green">Resume</button></form>':'') + '</td></tr>').join('') + '</table>' : '<p class="muted">No matching sponsors yet. Add a sponsor to double the impact of every donation!</p>'}
      </div>
    `, req.session.user));
  }));

  app.get('/fundraising/:id/matching/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const c = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
    if (!c) return res.status(404).send('Not found');
    res.send(renderPage('Add Matching Sponsor', `
      <div class="card" style="max-width:550px;margin:40px auto">
        <h2>Add Matching Sponsor</h2>
        <p class="muted" style="margin-bottom:20px">A matching sponsor pledges to match every donation at a specified ratio. E.g., 1x match = every UGX 1,000 donation becomes UGX 2,000.</p>
        <form method="POST" action="/fundraising/${c.id}/matching/save">
          <div><label style="font-weight:600;display:block;margin-bottom:6px">Sponsor Name *</label><input name="sponsor_name" placeholder="Company or individual name" required style="width:100%"></div>
          <div style="margin-top:12px"><label style="font-weight:600;display:block;margin-bottom:6px">Sponsor Email</label><input name="sponsor_email" type="email" placeholder="sponsor@example.com" style="width:100%"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
            <div><label style="font-weight:600;display:block;margin-bottom:6px">Match Ratio *</label><select name="match_ratio" style="width:100%"><option value="1">1x (Double)</option><option value="2">2x (Triple)</option><option value="0.5">0.5x (Half match)</option></select></div>
            <div><label style="font-weight:600;display:block;margin-bottom:6px">Maximum Amount (UGX) *</label><input name="max_amount" type="number" placeholder="5000000" required style="width:100%"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
            <div><label style="font-weight:600;display:block;margin-bottom:6px">Start Date</label><input name="start_date" type="date" style="width:100%"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:6px">End Date</label><input name="end_date" type="date" style="width:100%"></div>
          </div>
          <button class="btn btn-green" style="width:100%;margin-top:20px;padding:14px">Add Matching Sponsor</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/fundraising/:id/matching/save', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { sponsor_name, sponsor_email, match_ratio, max_amount, start_date, end_date } = req.body;
    await pool.query('INSERT INTO matching_donations(tenant_id,campaign_id,sponsor_name,sponsor_email,match_ratio,max_amount,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [t, req.params.id, sponsor_name, sponsor_email||null, match_ratio||1, max_amount||0, start_date||null, end_date||null]);
    await audit(req.session.user.email, 'matching_donation_added', 'Added matching sponsor "' + sponsor_name + '" to campaign #' + req.params.id, t);
    res.redirect('/fundraising/' + req.params.id + '/matching');
  }));

  app.post('/fundraising/matching/:id/pause', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    await pool.query("UPDATE matching_donations SET status='paused' WHERE id=$1 AND tenant_id=$2", [req.params.id, t]);
    await audit(req.session.user.email, 'matching_donation_paused', 'Paused matching donation #' + req.params.id, t);
    res.redirect('back');
  }));

  app.post('/fundraising/matching/:id/resume', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    await pool.query("UPDATE matching_donations SET status='active' WHERE id=$1 AND tenant_id=$2", [req.params.id, t]);
    await audit(req.session.user.email, 'matching_donation_resumed', 'Resumed matching donation #' + req.params.id, t);
    res.redirect('back');
  }));

  // =============================================
  // 9. CAMPAIGN COMMENTS / ENCOURAGEMENT
  // =============================================
  app.post('/campaigns/:id/comment', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { comment } = req.body;
    if (!comment || !comment.trim()) return res.redirect('back');
    const c = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!c) return res.status(404).send('Not found');
    await pool.query('INSERT INTO campaign_comments(tenant_id,campaign_id,user_email,user_name,comment) VALUES($1,$2,$3,$4,$5)',
      [t, req.params.id, req.session.user.email, req.session.user.name || 'Anonymous', comment.trim()]);
    res.redirect('back');
  }));

  app.get('/api/campaigns/:id/comments', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Not found');
    const comments = (await pool.query('SELECT * FROM campaign_comments WHERE campaign_id=$1 AND tenant_id=$2 AND is_public=true ORDER BY created_at DESC LIMIT 100', [c.id, c.tenant_id])).rows;

    res.send(renderPage('Comments - ' + c.title, `
      <div class="card" style="max-width:700px;margin:40px auto">
        <h2>Comments on ${esc(c.title)}</h2>
        <p class="muted">${comments.length} messages of encouragement</p>
        ${req.session.user ? '<form method="POST" action="/campaigns/' + c.id + '/comment" style="margin:20px 0"><textarea name="comment" rows="3" placeholder="Leave a message of encouragement..." style="width:100%;padding:12px;border-radius:8px;border:1px solid #e2e8f0" required></textarea><button class="btn btn-green btn-sm" style="margin-top:8px">Post Comment</button></form>' : '<p class="muted" style="margin:20px 0"><a href="/login">Log in</a> to leave a comment.</p>'}
        ${comments.length > 0 ? comments.map(cm => '<div style="background:#f8fafc;padding:16px;border-radius:10px;margin-bottom:10px;border-left:4px solid #059669"><strong>' + esc(cm.user_name || 'Anonymous') + '</strong><span class="muted" style="margin-left:10px;font-size:12px">' + (cm.created_at ? new Date(cm.created_at).toLocaleDateString() : '') + '</span><p style="margin:8px 0 0;line-height:1.6">' + esc(cm.comment) + '</p></div>').join('') : '<p class="muted" style="text-align:center;padding:40px">No comments yet. Be the first to encourage this campaign!</p>'}
      </div>
    `, req.session.user));
  }));

  // =============================================
  // 10. DONATION RECEIPT
  // =============================================
  app.get('/donations/receipt/:id', requireAuth, ah(async (req, res) => {
    const donation = (await pool.query('SELECT cd.*, fc.title as campaign_title, fc.id as campaign_id, t.name as org_name, t.email as org_email, t.address as org_address FROM campaign_donations cd JOIN fundraising_campaigns fc ON cd.campaign_id=fc.id JOIN tenants t ON fc.tenant_id=t.id WHERE cd.id=$1', [req.params.id])).rows[0];
    if (!donation) return res.status(404).send('Donation not found');

    // Generate or fetch receipt
    let receipt = (await pool.query('SELECT * FROM donation_receipts WHERE donation_id=$1 AND tenant_id=$2', [donation.id, donation.tenant_id])).rows[0];
    if (!receipt) {
      const receiptNo = generateReceiptNumber();
      await pool.query('INSERT INTO donation_receipts(tenant_id,donation_id,campaign_id,donor_name,donor_email,amount,method,receipt_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [donation.tenant_id, donation.id, donation.campaign_id, donation.donor_name, null, donation.amount, donation.method, receiptNo]);
      receipt = (await pool.query('SELECT * FROM donation_receipts WHERE donation_id=$1 AND tenant_id=$2', [donation.id, donation.tenant_id])).rows[0];
    }

    res.send(renderPage('Donation Receipt', `
      <div class="card" style="max-width:600px;margin:40px auto">
        <div style="text-align:center;border-bottom:2px solid #059669;padding-bottom:20px;margin-bottom:20px">
          <h1 style="color:#059669">Donation Receipt</h1>
          <p style="color:#64748b">Official Receipt from Comfort Platform</p>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:20px">
          <div><strong>Receipt No:</strong><br><code style="font-size:14px">${esc(receipt.receipt_number)}</code></div>
          <div style="text-align:right"><strong>Date:</strong><br>${new Date(receipt.issued_at).toLocaleDateString()}</div>
        </div>
        <table style="width:100%;margin-bottom:20px">
          <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><strong>Donor</strong></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${esc(donation.donor_name)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><strong>Campaign</strong></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${esc(donation.campaign_title)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><strong>Organization</strong></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${esc(donation.org_name)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><strong>Amount</strong></td><td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#059669;font-size:18px">UGX ${(parseInt(donation.amount)||0).toLocaleString()}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><strong>Payment Method</strong></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${esc(donation.method)}</td></tr>
          <tr><td style="padding:8px"><strong>Message</strong></td><td style="padding:8px">${esc(donation.message || 'No message')}</td></tr>
        </table>
        <div style="background:#f0fdf4;padding:16px;border-radius:8px;border:1px solid #bbf7d0;margin-bottom:20px">
          <p style="font-size:13px;color:#166534">This receipt confirms that your donation has been recorded. A 5% platform fee is applied to all donations to support the Comfort platform. For questions, contact support.</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button onclick="window.print()" class="btn btn-green">Print Receipt</button>
          <a href="/my-donations/simple" class="btn btn-sm">Back to My Donations</a>
          <a href="/discover/${donation.campaign_id}" class="btn btn-sm">View Campaign</a>
        </div>
      </div>
      <style>@media print{.hero,nav,footer,.btn{display:none!important}.card{box-shadow:none!important;border:none!important}}</style>
    `, req.session.user));
  }));

  // =============================================
  // 11. DEADLINE REMINDERS (cron-like check)
  // =============================================
  app.post('/api/cron/deadline-reminders', requireAuth, ah(async (req, res) => {
    try {
      // Find campaigns expiring in 3 days, 1 day, and today
      const reminders = [
        { days: 3, type: '3_days' },
        { days: 1, type: '1_day' },
        { days: 0, type: 'last_day' }
      ];
      let notified = 0;
      for (const r of reminders) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + r.days);
        const dateStr = targetDate.toISOString().split('T')[0];

        const campaigns = (await pool.query("SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.deadline = $1 AND fc.status = 'active' AND fc.is_public = true", [dateStr])).rows;
        for (const c of campaigns) {
          // Check if already sent
          const already = (await pool.query('SELECT id FROM campaign_deadline_reminders WHERE campaign_id=$1 AND reminder_type=$2 AND tenant_id=$3', [c.id, r.type, c.tenant_id])).rows[0];
          if (!already) {
            const label = r.days === 0 ? 'ends TODAY' : 'ends in ' + r.days + ' day' + (r.days > 1 ? 's' : '');
            // Notify org admins
            const admins = (await pool.query("SELECT email FROM users WHERE tenant_id=$1 AND role IN ('admin','super_admin')", [c.tenant_id])).rows;
            for (const a of admins) {
              notify(c.tenant_id, a.email, 'Campaign ' + label, 'Your campaign "' + c.title + '" ' + label + '! Take action to reach your goal.', 'fundraising');
            }
            await pool.query('INSERT INTO campaign_deadline_reminders(tenant_id,campaign_id,reminder_type) VALUES($1,$2,$3)', [c.tenant_id, c.id, r.type]);
            notified++;
          }
        }
      }
      res.json({ success: true, notified });
    } catch(e) {
      res.json({ success: false, error: e.message });
    }
  }));

  // =============================================
  // 12. ENHANCED CAMPAIGN DETAIL with Social + Donor Wall + Comments + Matching
  // =============================================
  // Hook into donation save to trigger: matching, milestones, thank you, donor profile, receipt
  // This is handled by patching into existing routes (see server.js integration)

  console.log('[FundraisingPro] All professional fundraising features loaded');
};
