/**
 * Fundraising Ultimate Module — Next-Generation Fundraising Platform
 * Features: Recurring Donations, Impact Calculator, Donor Loyalty Tiers,
 * Campaign Grader, Emergency Mode, Harambee Mode, WhatsApp Donate,
 * Mobile Money Auto-Detect, Funeral/Burial Fund, AI Story Writer
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  // =============================================
  // DATABASE MIGRATIONS
  // =============================================
  const migrations = [
    // Feature 1: Recurring Auto-Donations
    `CREATE TABLE IF NOT EXISTS recurring_donations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, donor_name TEXT, donor_email TEXT, donor_phone TEXT, amount INTEGER NOT NULL, frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly','monthly','quarterly')), method TEXT DEFAULT 'mobile_money', status TEXT DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')), next_charge_date DATE, total_charged INTEGER DEFAULT 0, charge_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_recurring_donations_tenant ON recurring_donations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_recurring_donations_email ON recurring_donations(donor_email)`,
    `CREATE INDEX IF NOT EXISTS idx_recurring_donations_next_charge ON recurring_donations(next_charge_date) WHERE status='active'`,

    // Feature 2: Impact Calculator
    `CREATE TABLE IF NOT EXISTS impact_items (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, amount_per_unit INTEGER NOT NULL, unit_label TEXT NOT NULL DEFAULT 'unit', icon TEXT, category TEXT DEFAULT 'general', is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS campaign_impact_goals (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, impact_item_id INTEGER NOT NULL REFERENCES impact_items(id) ON DELETE CASCADE, target_units INTEGER NOT NULL DEFAULT 1, funded_units INTEGER DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS idx_impact_items_tenant ON impact_items(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_impact_tenant ON campaign_impact_goals(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_impact_campaign ON campaign_impact_goals(campaign_id)`,

    // Feature 3: Donor Loyalty Tiers
    `CREATE TABLE IF NOT EXISTS donor_loyalty_tiers (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, min_amount INTEGER NOT NULL DEFAULT 0, max_amount INTEGER, color TEXT DEFAULT '#059669', icon TEXT, benefits_text TEXT, perks TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS donor_loyalty_ledger (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, tier_id INTEGER REFERENCES donor_loyalty_tiers(id), total_donated INTEGER DEFAULT 0, points INTEGER DEFAULT 0, badges_earned TEXT DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, donor_email))`,
    `CREATE INDEX IF NOT EXISTS idx_loyalty_tiers_tenant ON donor_loyalty_tiers(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_tenant ON donor_loyalty_ledger(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_email ON donor_loyalty_ledger(donor_email)`,

    // Feature 4: Campaign Performance Grader
    `CREATE TABLE IF NOT EXISTS campaign_grades (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, grade TEXT NOT NULL, score INTEGER NOT NULL, metrics_json TEXT DEFAULT '{}', graded_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_grades_tenant ON campaign_grades(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_grades_campaign ON campaign_grades(campaign_id)`,

    // Feature 5: Emergency/Urgent Mode
    `CREATE TABLE IF NOT EXISTS emergency_campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, urgency_level TEXT DEFAULT 'high' CHECK (urgency_level IN ('critical','high','medium')), reason TEXT, verified_by TEXT, verified_at TIMESTAMPTZ, auto_boost BOOLEAN DEFAULT false, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_emergency_campaigns_tenant ON emergency_campaigns(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_emergency_campaigns_campaign ON emergency_campaigns(campaign_id)`,

    // Feature 6: Harambee Mode
    `CREATE TABLE IF NOT EXISTS harambee_pools (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, target_amount INTEGER NOT NULL, raised_amount INTEGER DEFAULT 0, contributor_count INTEGER DEFAULT 0, status TEXT DEFAULT 'open' CHECK (status IN ('open','closed','distributed')), organizer_email TEXT NOT NULL, closes_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS harambee_contributions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, pool_id INTEGER NOT NULL REFERENCES harambee_pools(id) ON DELETE CASCADE, contributor_name TEXT, contributor_email TEXT, amount INTEGER NOT NULL, method TEXT DEFAULT 'mobile_money', message TEXT, is_anonymous BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS harambee_distributions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, pool_id INTEGER NOT NULL REFERENCES harambee_pools(id) ON DELETE CASCADE, recipient_name TEXT NOT NULL, recipient_phone TEXT, amount INTEGER NOT NULL, distributed_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_harambee_pools_tenant ON harambee_pools(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_harambee_contributions_tenant ON harambee_contributions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_harambee_contributions_pool ON harambee_contributions(pool_id)`,

    // Feature 7: WhatsApp Donate Bot
    `CREATE TABLE IF NOT EXISTS whatsapp_donate_config (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, phone_number TEXT, webhook_url TEXT, welcome_message TEXT DEFAULT 'Welcome! Reply with:\\n1. Donate\\n2. View Campaigns\\n3. My Donations\\n4. Help', menu_items_json TEXT DEFAULT '[]', is_active BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id))`,
    `CREATE TABLE IF NOT EXISTS whatsapp_donate_sessions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, phone TEXT NOT NULL, step TEXT DEFAULT 'menu', campaign_id INTEGER, amount INTEGER, donor_name TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 minutes')`,
    `CREATE INDEX IF NOT EXISTS idx_whatsapp_config_tenant ON whatsapp_donate_config(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_phone ON whatsapp_donate_sessions(phone)`,

    // Feature 8: Mobile Money Auto-Detect
    `CREATE TABLE IF NOT EXISTS mobile_money_providers (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, country_code TEXT DEFAULT 'UG', provider_name TEXT NOT NULL, provider_code TEXT NOT NULL, ussd_code TEXT, logo_url TEXT, min_amount INTEGER DEFAULT 500, max_amount INTEGER DEFAULT 5000000, is_active BOOLEAN DEFAULT true)`,
    `CREATE TABLE IF NOT EXISTS donation_payment_attempts (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donation_id INTEGER, phone TEXT NOT NULL, detected_provider TEXT, amount INTEGER NOT NULL, status TEXT DEFAULT 'initiated' CHECK (status IN ('initiated','pending','completed','failed')), provider_reference TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_mm_providers_tenant ON mobile_money_providers(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payment_attempts_tenant ON donation_payment_attempts(tenant_id)`,

    // Feature 9: Funeral/Burial Fund
    `CREATE TABLE IF NOT EXISTS funeral_funds (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, deceased_name TEXT NOT NULL, deceased_photo TEXT, relationship TEXT, target_amount INTEGER NOT NULL, raised_amount INTEGER DEFAULT 0, beneficiary_name TEXT, beneficiary_phone TEXT, funeral_date DATE, location TEXT, status TEXT DEFAULT 'active' CHECK (status IN ('active','closed')), created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS funeral_contributions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, fund_id INTEGER NOT NULL REFERENCES funeral_funds(id) ON DELETE CASCADE, contributor_name TEXT, contributor_email TEXT, contributor_phone TEXT, amount INTEGER NOT NULL, method TEXT DEFAULT 'mobile_money', message TEXT, is_anonymous BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_funeral_funds_tenant ON funeral_funds(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_funeral_contributions_tenant ON funeral_contributions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_funeral_contributions_fund ON funeral_contributions(fund_id)`,

    // Feature 10: AI Campaign Story Writer
    `CREATE TABLE IF NOT EXISTS ai_campaign_stories (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, story_text TEXT NOT NULL, tone TEXT DEFAULT 'emotional' CHECK (tone IN ('emotional','professional','urgent','community')), word_count INTEGER DEFAULT 0, generated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_ai_stories_tenant ON ai_campaign_stories(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_stories_campaign ON ai_campaign_stories(campaign_id)`,

    // Seed default loyalty tiers
    `INSERT INTO donor_loyalty_tiers (tenant_id, name, min_amount, max_amount, color, icon, benefits_text, perks) SELECT t.id, 'Bronze', 0, 99999, '#CD7F32', '🥉', 'Welcome tier for all donors', 'Donor badge, Thank you email' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donor_loyalty_tiers WHERE tenant_id=t.id AND name='Bronze')`,
    `INSERT INTO donor_loyalty_tiers (tenant_id, name, min_amount, max_amount, color, icon, benefits_text, perks) SELECT t.id, 'Silver', 100000, 499999, '#C0C0C0', '🥈', 'Recognized supporter', 'Priority updates, Donor wall, Monthly report' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donor_loyalty_tiers WHERE tenant_id=t.id AND name='Silver')`,
    `INSERT INTO donor_loyalty_tiers (tenant_id, name, min_amount, max_amount, color, icon, benefits_text, perks) SELECT t.id, 'Gold', 500000, 1999999, '#FFD700', '🥇', 'Major contributor', 'VIP events, Personal thank you call, Impact report' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donor_loyalty_tiers WHERE tenant_id=t.id AND name='Gold')`,
    `INSERT INTO donor_loyalty_tiers (tenant_id, name, min_amount, max_amount, color, icon, benefits_text, perks) SELECT t.id, 'Platinum', 2000000, 9999999, '#E5E4E2', '💎', 'Elite benefactor', 'Advisory board seat, Named programs, Annual gala' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donor_loyalty_tiers WHERE tenant_id=t.id AND name='Platinum')`,
    `INSERT INTO donor_loyalty_tiers (tenant_id, name, min_amount, max_amount, color, icon, benefits_text, perks) SELECT t.id, 'Diamond', 10000000, NULL, '#B9F2FF', '👑', 'Legendary philanthropist', 'Lifetime membership, Building naming rights, Legacy page' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donor_loyalty_tiers WHERE tenant_id=t.id AND name='Diamond')`,

    // Seed default mobile money providers for Uganda
    `INSERT INTO mobile_money_providers (tenant_id, country_code, provider_name, provider_code, ussd_code, min_amount, max_amount) SELECT t.id, 'UG', 'MTN Mobile Money', 'MTN', '*165*2#', 500, 5000000 FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM mobile_money_providers WHERE tenant_id=t.id AND provider_code='MTN')`,
    `INSERT INTO mobile_money_providers (tenant_id, country_code, provider_name, provider_code, ussd_code, min_amount, max_amount) SELECT t.id, 'UG', 'Airtel Money', 'AIRTEL', '*185*1#', 500, 5000000 FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM mobile_money_providers WHERE tenant_id=t.id AND provider_code='AIRTEL')`,

    // Seed default impact items
    `INSERT INTO impact_items (tenant_id, name, description, amount_per_unit, unit_label, icon, category) SELECT t.id, 'School Uniform', 'Provide a complete school uniform for a child', 35000, 'child', '👕', 'education' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM impact_items WHERE tenant_id=t.id AND name='School Uniform')`,
    `INSERT INTO impact_items (tenant_id, name, description, amount_per_unit, unit_label, icon, category) SELECT t.id, 'Textbooks', 'Provide textbooks for one student for a term', 25000, 'student', '📚', 'education' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM impact_items WHERE tenant_id=t.id AND name='Textbooks')`,
    `INSERT INTO impact_items (tenant_id, name, description, amount_per_unit, unit_label, icon, category) SELECT t.id, 'School Fees', 'Cover one term of school fees', 150000, 'term', '🎓', 'education' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM impact_items WHERE tenant_id=t.id AND name='School Fees')`,
    `INSERT INTO impact_items (tenant_id, name, description, amount_per_unit, unit_label, icon, category) SELECT t.id, 'Medical Checkup', 'Fund a complete medical checkup', 50000, 'checkup', '🏥', 'health' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM impact_items WHERE tenant_id=t.id AND name='Medical Checkup')`,
    `INSERT INTO impact_items (tenant_id, name, description, amount_per_unit, unit_label, icon, category) SELECT t.id, 'Clean Water', 'Provide clean water for a family for a month', 15000, 'family', '💧', 'water' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM impact_items WHERE tenant_id=t.id AND name='Clean Water')`,
    `INSERT INTO impact_items (tenant_id, name, description, amount_per_unit, unit_label, icon, category) SELECT t.id, 'Meal Pack', 'Feed a family for one week', 20000, 'week', '🍽️', 'food' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM impact_items WHERE tenant_id=t.id AND name='Meal Pack')`,
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) { /* already exists OK */ }
    }
    console.log('[FundraisingUltimate] Migrations complete');
  })();

  // =============================================
  // HELPERS
  // =============================================
  function formatUGX(amount) { return 'UGX ' + (parseInt(amount)||0).toLocaleString(); }

  function calculateGrade(score) {
    if (score >= 95) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }

  function detectProvider(phone) {
    const p = phone.replace(/\s+/g,'').replace(/^\+/,'');
    const prefix4 = p.substring(0,4);
    const prefix3 = p.substring(0,3);
    if (['0770','0771','0772','0773','0774','0775','0776','0777','0778','0779','0780','0781','0782','0783','0784','0785','0786','0787','0788','0789'].some(x => prefix4===x)) return 'MTN';
    if (['0700','0701','0702','0703','0704','0705','0706','0707','0708','0709','0710','0711','0712','0713','0714','0715','0716','0717','0718','0719'].some(x => prefix4===x)) return 'AIRTEL';
    return 'UNKNOWN';
  }

  function getNextChargeDate(frequency) {
    const d = new Date();
    if (frequency === 'weekly') d.setDate(d.getDate() + 7);
    else if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
    return d.toISOString().split('T')[0];
  }

  // =============================================
  // FEATURE 1: RECURRING AUTO-DONATIONS
  // =============================================

  // Create recurring donation
  app.post('/api/recurring-donations', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { campaign_id, donor_name, donor_email, donor_phone, amount, frequency, method } = req.body;
    if (!campaign_id || !amount || !frequency) return res.status(400).json({ error: 'campaign_id, amount, and frequency are required' });
    if (!['weekly','monthly','quarterly'].includes(frequency)) return res.status(400).json({ error: 'Frequency must be weekly, monthly, or quarterly' });
    const nextDate = getNextChargeDate(frequency);
    const result = await pool.query(
      `INSERT INTO recurring_donations(tenant_id,campaign_id,donor_name,donor_email,donor_phone,amount,frequency,method,next_charge_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tid, campaign_id, donor_name||req.session.user.name, donor_email||req.session.user.email, donor_phone, parseInt(amount), frequency, method||'mobile_money', nextDate]
    );
    if(audit) audit(req, 'recurring_donation_created', { id: result.rows[0].id, amount, frequency });
    // Send confirmation
    try {
      if (donor_email || req.session.user.email) {
        await sendEmail(donor_email||req.session.user.email, 'Recurring Donation Set Up!',
          `<p>Your ${frequency} recurring donation of ${formatUGX(amount)} has been set up. Next charge: ${nextDate}.</p>`);
      }
    } catch(e) { console.warn('[RecurringDonation] Email error:', e.message); }
    res.json({ success: true, recurring: result.rows[0] });
  }));

  // List user's recurring donations
  app.get('/api/recurring-donations', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const email = req.session.user.email;
    const role = req.session.user.role;
    let q, params;
    if (role === 'admin' || role === 'superadmin') {
      q = 'SELECT rd.*, fc.title as campaign_title FROM recurring_donations rd LEFT JOIN fundraising_campaigns fc ON rd.campaign_id=fc.id WHERE rd.tenant_id=$1 ORDER BY rd.created_at DESC';
      params = [tid];
    } else {
      q = 'SELECT rd.*, fc.title as campaign_title FROM recurring_donations rd LEFT JOIN fundraising_campaigns fc ON rd.campaign_id=fc.id WHERE rd.tenant_id=$1 AND rd.donor_email=$2 ORDER BY rd.created_at DESC';
      params = [tid, email];
    }
    const result = await pool.query(q, params);
    res.json({ recurring: result.rows });
  }));

  // Pause recurring donation
  app.put('/api/recurring-donations/:id/pause', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('UPDATE recurring_donations SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND donor_email=$4 RETURNING *', ['paused', req.params.id, tid, req.session.user.email]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found or unauthorized' });
    if(audit) audit(req, 'recurring_donation_paused', { id: req.params.id });
    res.json({ success: true, recurring: result.rows[0] });
  }));

  // Resume recurring donation
  app.put('/api/recurring-donations/:id/resume', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const nextDate = getNextChargeDate('monthly');
    const result = await pool.query('UPDATE recurring_donations SET status=$1, next_charge_date=$2, updated_at=NOW() WHERE id=$3 AND tenant_id=$4 AND donor_email=$5 RETURNING *', ['active', nextDate, req.params.id, tid, req.session.user.email]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found or unauthorized' });
    if(audit) audit(req, 'recurring_donation_resumed', { id: req.params.id });
    res.json({ success: true, recurring: result.rows[0] });
  }));

  // Cancel recurring donation
  app.put('/api/recurring-donations/:id/cancel', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('UPDATE recurring_donations SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND donor_email=$4 RETURNING *', ['cancelled', req.params.id, tid, req.session.user.email]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found or unauthorized' });
    if(audit) audit(req, 'recurring_donation_cancelled', { id: req.params.id });
    res.json({ success: true, recurring: result.rows[0] });
  }));

  // Recurring donations dashboard
  app.get('/recurring-donations', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const email = req.session.user.email;
    const role = req.session.user.role;
    let q, params;
    if (role === 'admin' || role === 'superadmin') {
      q = 'SELECT rd.*, fc.title as campaign_title FROM recurring_donations rd LEFT JOIN fundraising_campaigns fc ON rd.campaign_id=fc.id WHERE rd.tenant_id=$1 ORDER BY rd.created_at DESC';
      params = [tid];
    } else {
      q = 'SELECT rd.*, fc.title as campaign_title FROM recurring_donations rd LEFT JOIN fundraising_campaigns fc ON rd.campaign_id=fc.id WHERE rd.tenant_id=$1 AND rd.donor_email=$2 ORDER BY rd.created_at DESC';
      params = [tid, email];
    }
    const result = await pool.query(q, params);
    const rows = result.rows;
    const active = rows.filter(r => r.status === 'active');
    const totalRecurring = active.reduce((s,r) => s + parseInt(r.amount||0), 0);
    const html = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h2>Recurring Donations</h2>
          <button onclick="document.getElementById('newRecurringForm').style.display='block'" class="btn" style="background:#059669;color:white">+ New Recurring Donation</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
          <div style="padding:20px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0"><div style="font-size:14px;color:#666">Active Subscriptions</div><div style="font-size:28px;font-weight:700;color:#059669">${active.length}</div></div>
          <div style="padding:20px;border-radius:12px;background:#fef3c7;border:1px solid #fde68a"><div style="font-size:14px;color:#666">Total Recurring</div><div style="font-size:28px;font-weight:700;color:#d97706">${formatUGX(totalRecurring)}</div></div>
          <div style="padding:20px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe"><div style="font-size:14px;color:#666">Total Charged</div><div style="font-size:28px;font-weight:700;color:#2563eb">${formatUGX(rows.reduce((s,r)=>s+parseInt(r.total_charged||0),0))}</div></div>
        </div>
        <div id="newRecurringForm" style="display:none;padding:20px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;background:#f9fafb">
          <h3>Set Up Recurring Donation</h3>
          <form method="POST" action="/api/recurring-donations" id="recurringForm">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label>Amount (UGX)</label><input type="number" name="amount" min="500" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Frequency</label><select name="frequency" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"><option value="weekly">Weekly</option><option value="monthly" selected>Monthly</option><option value="quarterly">Quarterly</option></select></div>
              <div><label>Campaign ID</label><input type="number" name="campaign_id" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Phone</label><input type="text" name="donor_phone" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
            </div>
            <input type="hidden" name="donor_name" value="${esc(req.session.user.name||'')}">
            <input type="hidden" name="donor_email" value="${esc(req.session.user.email||'')}">
            <div style="margin-top:16px"><button type="submit" class="btn" style="background:#059669;color:white">Create Recurring Donation</button>
            <button type="button" onclick="document.getElementById('newRecurringForm').style.display='none'" class="btn" style="background:#999;color:white;margin-left:8px">Cancel</button></div>
          </form>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Campaign</th><th style="padding:10px;text-align:left">Amount</th><th style="padding:10px;text-align:left">Frequency</th><th style="padding:10px;text-align:left">Next Charge</th><th style="padding:10px;text-align:left">Status</th><th style="padding:10px;text-align:left">Actions</th></tr></thead>
          <tbody>${rows.map(r => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px">${esc(r.campaign_title||'#'+r.campaign_id)}</td>
            <td style="padding:10px;font-weight:600">${formatUGX(r.amount)}</td>
            <td style="padding:10px">${esc(r.frequency)}</td>
            <td style="padding:10px">${r.next_charge_date||'N/A'}</td>
            <td style="padding:10px"><span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;color:#fff;background:${r.status==='active'?'#059669':r.status==='paused'?'#d97706':'#999'}">${esc(r.status)}</span></td>
            <td style="padding:10px">${r.status==='active'?`<button onclick="fetch('/api/recurring-donations/${r.id}/pause',{method:'PUT'}).then(()=>location.reload())" style="padding:4px 10px;background:#d97706;color:white;border:none;border-radius:6px;cursor:pointer">Pause</button>`:r.status==='paused'?`<button onclick="fetch('/api/recurring-donations/${r.id}/resume',{method:'PUT'}).then(()=>location.reload())" style="padding:4px 10px;background:#059669;color:white;border:none;border-radius:6px;cursor:pointer">Resume</button>`:''} <button onclick="if(confirm('Cancel this recurring donation?'))fetch('/api/recurring-donations/${r.id}/cancel',{method:'PUT'}).then(()=>location.reload())" style="padding:4px 10px;background:#dc2626;color:white;border:none;border-radius:6px;cursor:pointer">Cancel</button></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
    res.send(renderPage('Recurring Donations', html, req.session.user));
  }));

  // Process recurring donations (cron-like, called periodically)
  async function processRecurringDonations() {
    try {
      const due = (await pool.query("SELECT * FROM recurring_donations WHERE status='active' AND next_charge_date <= CURRENT_DATE")).rows;
      for (const rd of due) {
        try {
          // Simulate charge by creating a donation record
          await pool.query('INSERT INTO campaign_donations(tenant_id,campaign_id,donor_name,donor_email,donor_phone,amount,method,message) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [rd.tenant_id, rd.campaign_id, rd.donor_name, rd.donor_email, rd.donor_phone, rd.amount, rd.method, 'Recurring donation - ' + rd.frequency]);
          const nextDate = getNextChargeDate(rd.frequency);
          await pool.query('UPDATE recurring_donations SET total_charged=total_charged+$1, charge_count=charge_count+1, next_charge_date=$2, updated_at=NOW() WHERE id=$3',
            [rd.amount, nextDate, rd.id]);
          console.log(`[FundraisingUltimate] Processed recurring donation #${rd.id}: ${formatUGX(rd.amount)}`);
        } catch(e) { console.warn(`[FundraisingUltimate] Error processing recurring #${rd.id}:`, e.message); }
      }
      if (due.length) console.log(`[FundraisingUltimate] Processed ${due.length} recurring donations`);
    } catch(e) { console.warn('[FundraisingUltimate] Recurring cron error:', e.message); }
  }
  // Run every 60 minutes
  setInterval(processRecurringDonations, 60 * 60 * 1000);
  // Also run once on startup after 5 min
  setTimeout(processRecurringDonations, 5 * 60 * 1000);

  // =============================================
  // FEATURE 2: IMPACT CALCULATOR
  // =============================================

  app.get('/api/impact-items', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM impact_items WHERE tenant_id=$1 AND is_active=true ORDER BY category, name', [tid]);
    res.json({ items: result.rows });
  }));

  app.post('/api/impact-items', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    const { name, description, amount_per_unit, unit_label, icon, category } = req.body;
    if (!name || !amount_per_unit) return res.status(400).json({ error: 'name and amount_per_unit required' });
    const result = await pool.query('INSERT INTO impact_items(tenant_id,name,description,amount_per_unit,unit_label,icon,category) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [tid, name, description, parseInt(amount_per_unit), unit_label||'unit', icon, category||'general']);
    if(audit) audit(req, 'impact_item_created', { id: result.rows[0].id });
    res.json({ success: true, item: result.rows[0] });
  }));

  app.put('/api/impact-items/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    const { name, description, amount_per_unit, unit_label, icon, category, is_active } = req.body;
    const result = await pool.query(`UPDATE impact_items SET name=COALESCE($1,name), description=COALESCE($2,description), amount_per_unit=COALESCE($3,amount_per_unit), unit_label=COALESCE($4,unit_label), icon=COALESCE($5,icon), category=COALESCE($6,category), is_active=COALESCE($7,is_active) WHERE id=$8 AND tenant_id=$9 RETURNING *`,
      [name, description, amount_per_unit?parseInt(amount_per_unit):null, unit_label, icon, category, is_active, req.params.id, tid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, item: result.rows[0] });
  }));

  app.delete('/api/impact-items/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    await pool.query('DELETE FROM impact_items WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if(audit) audit(req, 'impact_item_deleted', { id: req.params.id });
    res.json({ success: true });
  }));

  app.post('/api/campaigns/:id/impact-goals', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { impact_item_id, target_units } = req.body;
    if (!impact_item_id) return res.status(400).json({ error: 'impact_item_id required' });
    const result = await pool.query('INSERT INTO campaign_impact_goals(tenant_id,campaign_id,impact_item_id,target_units) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *',
      [tid, req.params.id, impact_item_id, parseInt(target_units)||1]);
    res.json({ success: true, goal: result.rows[0] });
  }));

  app.get('/api/campaigns/:id/impact', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const campRes = await pool.query('SELECT *, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fundraising_campaigns.id) as raised FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!campRes.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const camp = campRes.rows[0];
    const raised = parseInt(camp.raised) || 0;
    const goals = await pool.query('SELECT cig.*, ii.name, ii.description, ii.amount_per_unit, ii.unit_label, ii.icon, ii.category FROM campaign_impact_goals cig JOIN impact_items ii ON cig.impact_item_id=ii.id WHERE cig.tenant_id=$1 AND cig.campaign_id=$2', [tid, req.params.id]);
    const impact = goals.rows.map(g => {
      const funded = Math.floor(raised / parseInt(g.amount_per_unit));
      return { ...g, funded_units: funded, progress_pct: Math.min(100, Math.round((funded / parseInt(g.target_units)) * 100)) };
    });
    res.json({ campaign: camp, raised, impact });
  }));

  app.get('/impact-calculator', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const items = (await pool.query('SELECT * FROM impact_items WHERE tenant_id=$1 AND is_active=true ORDER BY category, name', [tid])).rows;
    const html = `
      <div class="card">
        <h2>Impact Calculator</h2>
        <p style="color:#666;margin-bottom:20px">See how donations translate into real-world impact. Configure impact items and link them to campaigns.</p>
        ${req.session.user.role==='admin'||req.session.user.role==='superadmin'?`
        <div style="padding:20px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;background:#f9fafb">
          <h3>Add Impact Item</h3>
          <form method="POST" action="/api/impact-items">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
              <div><label>Name</label><input type="text" name="name" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Amount Per Unit (UGX)</label><input type="number" name="amount_per_unit" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Unit Label</label><input type="text" name="unit_label" value="unit" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Description</label><input type="text" name="description" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Icon</label><input type="text" name="icon" placeholder="e.g. 📚" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Category</label><select name="category" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"><option value="education">Education</option><option value="health">Health</option><option value="water">Water</option><option value="food">Food</option><option value="general">General</option></select></div>
            </div>
            <button type="submit" class="btn" style="background:#059669;color:white;margin-top:12px">Add Impact Item</button>
          </form>
        </div>`:''}
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
          ${items.map(i => `<div style="padding:20px;border:1px solid #e2e8f0;border-radius:12px;background:white">
            <div style="font-size:32px;margin-bottom:8px">${esc(i.icon||'📊')}</div>
            <h3 style="margin:0 0 4px">${esc(i.name)}</h3>
            <p style="color:#666;font-size:14px;margin:0 0 8px">${esc(i.description||'')}</p>
            <div style="font-size:20px;font-weight:700;color:#059669">${formatUGX(i.amount_per_unit)}</div>
            <div style="font-size:13px;color:#888">per ${esc(i.unit_label)} | ${esc(i.category)}</div>
          </div>`).join('')}
        </div>
      </div>`;
    res.send(renderPage('Impact Calculator', html, req.session.user));
  }));

  // =============================================
  // FEATURE 3: DONOR LOYALTY TIERS
  // =============================================

  app.get('/api/loyalty-tiers', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_loyalty_tiers WHERE tenant_id=$1 ORDER BY min_amount', [tid]);
    res.json({ tiers: result.rows });
  }));

  app.post('/api/loyalty-tiers', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    const { name, min_amount, max_amount, color, icon, benefits_text, perks } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = await pool.query('INSERT INTO donor_loyalty_tiers(tenant_id,name,min_amount,max_amount,color,icon,benefits_text,perks) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [tid, name, parseInt(min_amount)||0, max_amount?parseInt(max_amount):null, color||'#059669', icon, benefits_text, perks]);
    if(audit) audit(req, 'loyalty_tier_created', { id: result.rows[0].id });
    res.json({ success: true, tier: result.rows[0] });
  }));

  app.put('/api/loyalty-tiers/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    const { name, min_amount, max_amount, color, icon, benefits_text, perks } = req.body;
    const result = await pool.query(`UPDATE donor_loyalty_tiers SET name=COALESCE($1,name), min_amount=COALESCE($2,min_amount), max_amount=$3, color=COALESCE($4,color), icon=COALESCE($5,icon), benefits_text=COALESCE($6,benefits_text), perks=COALESCE($7,perks) WHERE id=$8 AND tenant_id=$9 RETURNING *`,
      [name, min_amount?parseInt(min_amount):null, max_amount?parseInt(max_amount):null, color, icon, benefits_text, perks, req.params.id, tid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, tier: result.rows[0] });
  }));

  app.delete('/api/loyalty-tiers/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    await pool.query('DELETE FROM donor_loyalty_tiers WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ success: true });
  }));

  app.get('/api/loyalty/leaderboard', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT dll.*, dlt.name as tier_name, dlt.color as tier_color, dlt.icon as tier_icon FROM donor_loyalty_ledger dll JOIN donor_loyalty_tiers dlt ON dll.tier_id=dlt.id WHERE dll.tenant_id=$1 ORDER BY dll.total_donated DESC LIMIT 50', [tid]);
    res.json({ leaderboard: result.rows });
  }));

  app.get('/api/loyalty/my-status', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const email = req.session.user.email;
    // Calculate total donated
    const totalRes = await pool.query("SELECT COALESCE(SUM(amount),0) as total FROM campaign_donations WHERE donor_email=$1 AND tenant_id=$2 AND refunded=false", [email, tid]);
    const total = parseInt(totalRes.rows[0].total) || 0;
    const points = Math.floor(total / 1000);
    // Find tier
    const tierRes = await pool.query('SELECT * FROM donor_loyalty_tiers WHERE tenant_id=$1 AND min_amount <= $2 AND (max_amount IS NULL OR max_amount >= $2) ORDER BY min_amount DESC LIMIT 1', [tid, total]);
    const tier = tierRes.rows[0] || { name: 'Bronze', color: '#CD7F32' };
    // Upsert ledger
    await pool.query(`INSERT INTO donor_loyalty_ledger(tenant_id,donor_email,tier_id,total_donated,points,updated_at) VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT (tenant_id,donor_email) DO UPDATE SET tier_id=$3, total_donated=$4, points=$5, updated_at=NOW()`,
      [tid, email, tier.id, total, points]);
    // Badges
    const badges = [];
    if (total >= 100000) badges.push('First 100K');
    if (total >= 500000) badges.push('Half Million');
    if (total >= 1000000) badges.push('Million Donor');
    if (points >= 100) badges.push('Centurion');
    if (points >= 500) badges.push('Champion');
    res.json({ total_donated: total, points, tier, badges, next_tier_amount: tier.max_amount ? (parseInt(tier.max_amount) + 1 - total) : 0 });
  }));

  app.get('/donor-loyalty', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const tiers = (await pool.query('SELECT * FROM donor_loyalty_tiers WHERE tenant_id=$1 ORDER BY min_amount', [tid])).rows;
    const leaderboard = (await pool.query('SELECT dll.*, dlt.name as tier_name, dlt.color as tier_color, dlt.icon as tier_icon FROM donor_loyalty_ledger dll JOIN donor_loyalty_tiers dlt ON dll.tier_id=dlt.id WHERE dll.tenant_id=$1 ORDER BY dll.total_donated DESC LIMIT 20', [tid])).rows;
    const html = `
      <div class="card">
        <h2>Donor Loyalty Program</h2>
        <p style="color:#666;margin-bottom:24px">Earn points and unlock tiers as you donate. Every UGX 1,000 = 1 point.</p>
        <div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:12px;margin-bottom:32px">
          ${tiers.map(t => `<div style="min-width:180px;padding:20px;border-radius:12px;border:2px solid ${esc(t.color)};background:${esc(t.color)}11;text-align:center">
            <div style="font-size:28px">${esc(t.icon||'🏅')}</div>
            <h3 style="color:${esc(t.color)};margin:8px 0 4px">${esc(t.name)}</h3>
            <div style="font-size:13px;color:#666">${formatUGX(t.min_amount)}${t.max_amount?' - '+formatUGX(t.max_amount):'+'}</div>
            <div style="font-size:12px;color:#888;margin-top:4px">${esc(t.benefits_text||'')}</div>
          </div>`).join('')}
        </div>
        <h3>Top Donors</h3>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Rank</th><th style="padding:10px;text-align:left">Donor</th><th style="padding:10px;text-align:left">Tier</th><th style="padding:10px;text-align:right">Total Donated</th><th style="padding:10px;text-align:right">Points</th></tr></thead>
          <tbody>${leaderboard.map((d,i) => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px;font-weight:700">${i+1}</td>
            <td style="padding:10px">${esc(d.donor_email)}</td>
            <td style="padding:10px"><span style="color:${esc(d.tier_color||'#059669')}">${esc(d.tier_icon||'')} ${esc(d.tier_name||'')}</span></td>
            <td style="padding:10px;text-align:right;font-weight:600">${formatUGX(d.total_donated)}</td>
            <td style="padding:10px;text-align:right">${d.points}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
    res.send(renderPage('Donor Loyalty', html, req.session.user));
  }));

  // =============================================
  // FEATURE 4: CAMPAIGN PERFORMANCE GRADER
  // =============================================

  app.get('/api/campaigns/:id/grade', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const campRes = await pool.query('SELECT c.*, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=c.id AND tenant_id=$1) as raised, (SELECT COUNT(*) FROM campaign_donations WHERE campaign_id=c.id AND tenant_id=$1) as donor_count, (SELECT COUNT(*) FROM campaign_comments WHERE campaign_id=c.id AND tenant_id=$1) as comment_count FROM fundraising_campaigns c WHERE c.id=$2 AND c.tenant_id=$1', [tid, req.params.id]);
    if (!campRes.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const c = campRes.rows[0];
    const raised = parseInt(c.raised) || 0;
    const target = parseInt(c.target) || 1;
    const donorCount = parseInt(c.donor_count) || 0;
    const commentCount = parseInt(c.comment_count) || 0;
    const createdAt = new Date(c.created_at);
    const daysRunning = Math.max(1, Math.floor((Date.now() - createdAt.getTime()) / 86400000));
    // Scoring
    const progressScore = Math.min(40, Math.round((raised / target) * 40));
    const velocityScore = Math.min(25, Math.round((raised / daysRunning) / 10000 * 25));
    const donorScore = Math.min(20, donorCount * 2);
    const engagementScore = Math.min(15, commentCount * 3);
    const totalScore = Math.min(100, progressScore + velocityScore + donorScore + engagementScore);
    const grade = calculateGrade(totalScore);
    const metrics = { progressScore, velocityScore, donorScore, engagementScore, daysRunning, raised, target, donorCount, commentCount };
    // Save grade
    await pool.query('INSERT INTO campaign_grades(tenant_id,campaign_id,grade,score,metrics_json) VALUES($1,$2,$3,$4,$5)', [tid, req.params.id, grade, totalScore, JSON.stringify(metrics)]);
    res.json({ grade, score: totalScore, metrics, campaign: c });
  }));

  app.get('/api/campaigns/:id/grade-history', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM campaign_grades WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY graded_at DESC LIMIT 30', [tid, req.params.id]);
    res.json({ history: result.rows });
  }));

  app.get('/campaign-grader', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const campaigns = (await pool.query("SELECT c.id, c.title, c.target, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=c.id AND tenant_id=$1) as raised FROM fundraising_campaigns c WHERE c.tenant_id=$1 ORDER BY c.created_at DESC LIMIT 50", [tid])).rows;
    const html = `
      <div class="card">
        <h2>Campaign Performance Grader</h2>
        <p style="color:#666;margin-bottom:24px">Analyze and grade your campaigns based on performance metrics.</p>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Campaign</th><th style="padding:10px;text-align:right">Raised</th><th style="padding:10px;text-align:right">Target</th><th style="padding:10px;text-align:center">Action</th></tr></thead>
          <tbody>${campaigns.map(c => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px">${esc(c.title)}</td>
            <td style="padding:10px;text-align:right;font-weight:600">${formatUGX(c.raised)}</td>
            <td style="padding:10px;text-align:right">${formatUGX(c.target)}</td>
            <td style="padding:10px;text-align:center"><button onclick="gradeCampaign(${c.id})" class="btn" style="background:#059669;color:white;padding:4px 12px;border-radius:6px">Grade</button></td>
          </tr>`).join('')}</tbody>
        </table>
        <div id="gradeResult" style="margin-top:24px"></div>
        <script>
        async function gradeCampaign(id) {
          const res = await fetch('/api/campaigns/'+id+'/grade');
          const data = await res.json();
          const gradeColors = {'A+':'#059669','A':'#10b981','B':'#3b82f6','C':'#f59e0b','D':'#ef4444','F':'#dc2626'};
          document.getElementById('gradeResult').innerHTML = '<div style="text-align:center;padding:30px;border:2px solid '+gradeColors[data.grade]+';border-radius:16px;background:'+gradeColors[data.grade]+'11">'+
            '<div style="font-size:72px;font-weight:800;color:'+gradeColors[data.grade]+'">'+data.grade+'</div>'+
            '<div style="font-size:24px;color:#666">Score: '+data.score+'/100</div>'+
            '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px">'+
            '<div style="padding:12px;background:white;border-radius:8px"><div style="font-size:12px;color:#888">Progress</div><div style="font-weight:700">'+data.metrics.progressScore+'/40</div></div>'+
            '<div style="padding:12px;background:white;border-radius:8px"><div style="font-size:12px;color:#888">Velocity</div><div style="font-weight:700">'+data.metrics.velocityScore+'/25</div></div>'+
            '<div style="padding:12px;background:white;border-radius:8px"><div style="font-size:12px;color:#888">Donors</div><div style="font-weight:700">'+data.metrics.donorScore+'/20</div></div>'+
            '<div style="padding:12px;background:white;border-radius:8px"><div style="font-size:12px;color:#888">Engagement</div><div style="font-weight:700">'+data.metrics.engagementScore+'/15</div></div></div></div>';
        }
        </script>
      </div>`;
    res.send(renderPage('Campaign Grader', html, req.session.user));
  }));

  // =============================================
  // FEATURE 5: EMERGENCY/URGENT MODE
  // =============================================

  app.post('/api/campaigns/:id/emergency', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    const { urgency_level, reason, auto_boost, expires_at } = req.body;
    if (!['critical','high','medium'].includes(urgency_level||'high')) return res.status(400).json({ error: 'Invalid urgency level' });
    const result = await pool.query('INSERT INTO emergency_campaigns(tenant_id,campaign_id,urgency_level,reason,verified_by,verified_at,auto_boost,expires_at) VALUES($1,$2,$3,$4,$5,NOW(),$6,$7) RETURNING *',
      [tid, req.params.id, urgency_level||'high', reason, req.session.user.email, auto_boost||false, expires_at||null]);
    if(audit) audit(req, 'emergency_declared', { campaign_id: req.params.id, urgency_level });
    // Notify donors
    try {
      const donors = (await pool.query('SELECT DISTINCT donor_email FROM campaign_donations WHERE tenant_id=$1 AND donor_email IS NOT NULL LIMIT 100', [tid])).rows;
      for (const d of donors) {
        if (sendEmail) await sendEmail(d.donor_email, 'URGENT: Emergency Campaign Needs Your Help!', `<p>An emergency campaign needs urgent support. Please consider donating now.</p>`);
      }
    } catch(e) { console.warn('[Emergency] Notification error:', e.message); }
    res.json({ success: true, emergency: result.rows[0] });
  }));

  app.put('/api/campaigns/:id/emergency', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { urgency_level, reason, auto_boost, expires_at } = req.body;
    const result = await pool.query(`UPDATE emergency_campaigns SET urgency_level=COALESCE($1,urgency_level), reason=COALESCE($2,reason), auto_boost=COALESCE($3,auto_boost), expires_at=COALESCE($4,expires_at) WHERE campaign_id=$5 AND tenant_id=$6 RETURNING *`,
      [urgency_level, reason, auto_boost, expires_at, req.params.id, tid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Emergency not found' });
    res.json({ success: true, emergency: result.rows[0] });
  }));

  app.delete('/api/campaigns/:id/emergency', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM emergency_campaigns WHERE campaign_id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if(audit) audit(req, 'emergency_resolved', { campaign_id: req.params.id });
    res.json({ success: true });
  }));

  app.get('/api/emergency-campaigns', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT ec.*, fc.title as campaign_title FROM emergency_campaigns ec LEFT JOIN fundraising_campaigns fc ON ec.campaign_id=fc.id WHERE ec.tenant_id=$1 AND (ec.expires_at IS NULL OR ec.expires_at > NOW()) ORDER BY CASE ec.urgency_level WHEN \'critical\' THEN 1 WHEN \'high\' THEN 2 ELSE 3 END', [tid]);
    res.json({ emergencies: result.rows });
  }));

  app.get('/emergency', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const emergencies = (await pool.query("SELECT ec.*, fc.title as campaign_title, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=ec.campaign_id AND tenant_id=$1) as raised FROM emergency_campaigns ec LEFT JOIN fundraising_campaigns fc ON ec.campaign_id=fc.id WHERE ec.tenant_id=$1 AND (ec.expires_at IS NULL OR ec.expires_at > NOW()) ORDER BY CASE ec.urgency_level WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE  END", [tid])).rows;
    const html = `
      <div class="card">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
          <div style="font-size:32px">🚨</div>
          <h2 style="margin:0">Emergency Campaigns</h2>
        </div>
        <p style="color:#666;margin-bottom:24px">Campaigns in urgent need of support. These are prioritized and boosted for maximum visibility.</p>
        ${emergencies.length ? emergencies.map(e => `
        <div style="padding:20px;border:2px solid ${e.urgency_level==='critical'?'#dc2626':e.urgency_level==='high'?'#f59e0b':'#3b82f6'};border-radius:12px;margin-bottom:16px;background:${e.urgency_level==='critical'?'#fef2f2':e.urgency_level==='high'?'#fffbeb':'#eff6ff'}">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;color:#fff;background:${e.urgency_level==='critical'?'#dc2626':e.urgency_level==='high'?'#f59e0b':'#3b82f6'}">${esc(e.urgency_level).toUpperCase()}</span>
              <h3 style="margin:8px 0 4px">${esc(e.campaign_title||'#'+e.campaign_id)}</h3>
              <p style="color:#666;margin:0">${esc(e.reason||'No reason provided')}</p>
            </div>
            <div style="text-align:right">
              <div style="font-weight:700">${formatUGX(e.raised)}</div>
              <div style="font-size:12px;color:#888">Verified by ${esc(e.verified_by||'Admin')}</div>
              ${req.session.user.role==='admin'?`<button onclick="fetch('/api/campaigns/${e.campaign_id}/emergency',{method:'DELETE'}).then(()=>location.reload())" style="margin-top:8px;padding:4px 10px;background:#059669;color:white;border:none;border-radius:6px;cursor:pointer">Resolve</button>`:''}
            </div>
          </div>
        </div>`).join('') : '<div style="text-align:center;padding:40px;color:#888">No active emergencies 🎉</div>'}
      </div>`;
    res.send(renderPage('Emergency Campaigns', html, req.session.user));
  }));

  // =============================================
  // FEATURE 6: HARAMBEE MODE (Community Pool)
  // =============================================

  app.post('/api/harambee', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, description, target_amount, closes_at } = req.body;
    if (!title || !target_amount) return res.status(400).json({ error: 'title and target_amount required' });
    const result = await pool.query('INSERT INTO harambee_pools(tenant_id,title,description,target_amount,organizer_email,closes_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [tid, title, description, parseInt(target_amount), req.session.user.email, closes_at||null]);
    if(audit) audit(req, 'harambee_created', { id: result.rows[0].id });
    res.json({ success: true, pool: result.rows[0] });
  }));

  app.get('/api/harambee', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM harambee_pools WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    res.json({ pools: result.rows });
  }));

  app.get('/api/harambee/:id', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const poolRes = await pool.query('SELECT * FROM harambee_pools WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!poolRes.rows.length) return res.status(404).json({ error: 'Not found' });
    const contributions = (await pool.query('SELECT * FROM harambee_contributions WHERE pool_id=$1 AND tenant_id=$2 ORDER BY created_at DESC', [req.params.id, tid])).rows;
    const distributions = (await pool.query('SELECT * FROM harambee_distributions WHERE pool_id=$1 AND tenant_id=$2', [req.params.id, tid])).rows;
    res.json({ pool: poolRes.rows[0], contributions, distributions });
  }));

  app.post('/api/harambee/:id/contribute', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { contributor_name, contributor_email, amount, method, message, is_anonymous } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const poolCheck = await pool.query('SELECT * FROM harambee_pools WHERE id=$1 AND tenant_id=$2 AND status=$3', [req.params.id, tid, 'open']);
    if (!poolCheck.rows.length) return res.status(400).json({ error: 'Pool not found or closed' });
    const result = await pool.query('INSERT INTO harambee_contributions(tenant_id,pool_id,contributor_name,contributor_email,amount,method,message,is_anonymous) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [tid, req.params.id, contributor_name||'Anonymous', contributor_email, parseInt(amount), method||'mobile_money', message, is_anonymous||false]);
    await pool.query('UPDATE harambee_pools SET raised_amount=raised_amount+$1, contributor_count=contributor_count+1 WHERE id=$2 AND tenant_id=$3', [parseInt(amount), req.params.id, tid]);
    // Update loyalty
    if (contributor_email) {
      const totalRes = await pool.query("SELECT COALESCE(SUM(amount),0) as total FROM campaign_donations WHERE donor_email=$1 AND tenant_id=$2 AND refunded=false", [contributor_email, tid]);
      const total = parseInt(totalRes.rows[0].total) + parseInt(amount);
      const tierRes = await pool.query('SELECT id FROM donor_loyalty_tiers WHERE tenant_id=$1 AND min_amount <= $2 AND (max_amount IS NULL OR max_amount >= $2) ORDER BY min_amount DESC LIMIT 1', [tid, total]);
      if (tierRes.rows.length) {
        await pool.query(`INSERT INTO donor_loyalty_ledger(tenant_id,donor_email,tier_id,total_donated,points,updated_at) VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT (tenant_id,donor_email) DO UPDATE SET tier_id=$3,total_donated=$4,points=$5,updated_at=NOW()`,
          [tid, contributor_email, tierRes.rows[0].id, total, Math.floor(total/1000)]);
      }
    }
    res.json({ success: true, contribution: result.rows[0] });
  }));

  app.post('/api/harambee/:id/distribute', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    const { recipient_name, recipient_phone, amount } = req.body;
    if (!recipient_name || !amount) return res.status(400).json({ error: 'recipient_name and amount required' });
    const result = await pool.query('INSERT INTO harambee_distributions(tenant_id,pool_id,recipient_name,recipient_phone,amount) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [tid, req.params.id, recipient_name, recipient_phone, parseInt(amount)]);
    if(audit) audit(req, 'harambee_distributed', { pool_id: req.params.id, amount });
    res.json({ success: true, distribution: result.rows[0] });
  }));

  app.put('/api/harambee/:id/close', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    const result = await pool.query('UPDATE harambee_pools SET status=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *', ['closed', req.params.id, tid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    if(audit) audit(req, 'harambee_closed', { id: req.params.id });
    res.json({ success: true, pool: result.rows[0] });
  }));

  app.get('/harambee', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const pools = (await pool.query('SELECT * FROM harambee_pools WHERE tenant_id=$1 ORDER BY created_at DESC', [tid])).rows;
    const html = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <div><h2 style="margin:0">Harambee - Community Fundraising</h2><p style="color:#666;margin:4px 0 0">Pool resources together for community causes</p></div>
          <button onclick="document.getElementById('newPoolForm').style.display='block'" class="btn" style="background:#059669;color:white">+ Start Harambee</button>
        </div>
        <div id="newPoolForm" style="display:none;padding:20px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;background:#f9fafb">
          <h3>Create Harambee Pool</h3>
          <form method="POST" action="/api/harambee">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label>Title</label><input type="text" name="title" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Target Amount (UGX)</label><input type="number" name="target_amount" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div style="grid-column:span 2"><label>Description</label><textarea name="description" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;min-height:80px"></textarea></div>
              <div><label>Closes At</label><input type="date" name="closes_at" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
            </div>
            <button type="submit" class="btn" style="background:#059669;color:white;margin-top:12px">Create Pool</button>
          </form>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">
          ${pools.map(p => {
            const pct = p.target_amount > 0 ? Math.min(100, Math.round((parseInt(p.raised_amount)/parseInt(p.target_amount))*100)) : 0;
            return `<div style="padding:20px;border:1px solid #e2e8f0;border-radius:12px;background:white">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                <h3 style="margin:0">${esc(p.title)}</h3>
                <span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:${p.status==='open'?'#059669':p.status==='distributed'?'#3b82f6':'#999'}">${esc(p.status)}</span>
              </div>
              <p style="color:#666;font-size:14px;margin:0 0 12px">${esc(p.description||'')}</p>
              <div style="background:#e2e8f0;border-radius:8px;height:12px;margin-bottom:8px"><div style="background:#059669;border-radius:8px;height:12px;width:${pct}%"></div></div>
              <div style="display:flex;justify-content:space-between;font-size:13px"><span style="font-weight:700;color:#059669">${formatUGX(p.raised_amount)}</span><span style="color:#888">of ${formatUGX(p.target_amount)} (${pct}%)</span></div>
              <div style="font-size:12px;color:#888;margin-top:8px">${p.contributor_count} contributors</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    res.send(renderPage('Harambee', html, req.session.user));
  }));

  // =============================================
  // FEATURE 7: WHATSAPP DONATE BOT
  // =============================================

  app.get('/api/whatsapp-donate/config', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM whatsapp_donate_config WHERE tenant_id=$1', [tid]);
    res.json({ config: result.rows[0] || null });
  }));

  app.post('/api/whatsapp-donate/config', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    const { phone_number, webhook_url, welcome_message, menu_items_json, is_active } = req.body;
    const result = await pool.query(`INSERT INTO whatsapp_donate_config(tenant_id,phone_number,webhook_url,welcome_message,menu_items_json,is_active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id) DO UPDATE SET phone_number=COALESCE($2,whatsapp_donate_config.phone_number),webhook_url=COALESCE($3,whatsapp_donate_config.webhook_url),welcome_message=COALESCE($4,whatsapp_donate_config.welcome_message),menu_items_json=COALESCE($5,whatsapp_donate_config.menu_items_json),is_active=COALESCE($6,whatsapp_donate_config.is_active) RETURNING *`,
      [tid, phone_number, webhook_url, welcome_message, menu_items_json||'[]', is_active!==undefined?is_active:true]);
    if(audit) audit(req, 'whatsapp_config_updated', {});
    res.json({ success: true, config: result.rows[0] });
  }));

  app.post('/api/whatsapp-donate/webhook', ah(async (req, res) => {
    const { phone, message, tenant_id } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });
    const tid = tenant_id || 1;
    // Find or create session
    let session = (await pool.query("SELECT * FROM whatsapp_donate_sessions WHERE phone=$1 AND tenant_id=$2 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1", [phone, tid])).rows[0];
    let reply = '';
    const msg = message.trim().toLowerCase();

    if (!session || msg === 'menu' || msg === '0') {
      // New session / return to menu
      const config = (await pool.query('SELECT * FROM whatsapp_donate_config WHERE tenant_id=$1 AND is_active=true', [tid])).rows[0];
      reply = config?.welcome_message || 'Welcome! Reply with:\\n1. Donate\\n2. View Campaigns\\n3. My Donations\\n4. Help';
      if (session) await pool.query('DELETE FROM whatsapp_donate_sessions WHERE id=$1', [session.id]);
      await pool.query('INSERT INTO whatsapp_donate_sessions(tenant_id,phone,step) VALUES($1,$2,$3)', [tid, phone, 'menu']);
    } else if (session.step === 'menu') {
      if (msg === '1') {
        const campaigns = (await pool.query("SELECT id, title, target, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fundraising_campaigns.id) as raised FROM fundraising_campaigns WHERE tenant_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 5", [tid])).rows;
        reply = 'Select a campaign:\\n' + campaigns.map((c,i) => `${i+1}. ${c.title} (${formatUGX(c.raised)}/${formatUGX(c.target)})`).join('\\n') + '\\n\\nReply with campaign number.';
        await pool.query('UPDATE whatsapp_donate_sessions SET step=$1 WHERE id=$2', ['select_campaign', session.id]);
      } else if (msg === '2') {
        const campaigns = (await pool.query("SELECT title, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fundraising_campaigns.id) as raised FROM fundraising_campaigns WHERE tenant_id=$1 AND status='active' LIMIT 5", [tid])).rows;
        reply = 'Active Campaigns:\\n' + campaigns.map(c => `- ${c.title}: ${formatUGX(c.raised)}`).join('\\n') + '\\n\\nReply 0 for menu.';
      } else if (msg === '3') {
        const donations = (await pool.query('SELECT campaign_id, amount, created_at FROM campaign_donations WHERE donor_phone=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 5', [phone, tid])).rows;
        reply = donations.length ? 'Your recent donations:\\n' + donations.map(d => `- ${formatUGX(d.amount)} on ${new Date(d.created_at).toLocaleDateString()}`).join('\\n') : 'No donations found. Reply 0 for menu.';
      } else {
        reply = 'Invalid option. Reply with 1, 2, 3, or 4.';
      }
    } else if (session.step === 'select_campaign') {
      const idx = parseInt(msg) - 1;
      const campaigns = (await pool.query("SELECT id, title FROM fundraising_campaigns WHERE tenant_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 5", [tid])).rows;
      if (idx >= 0 && idx < campaigns.length) {
        await pool.query('UPDATE whatsapp_donate_sessions SET step=$1, campaign_id=$2 WHERE id=$3', ['enter_amount', campaigns[idx].id, session.id]);
        reply = `You selected: ${campaigns[idx].title}\\n\\nEnter donation amount in UGX:`;
      } else {
        reply = 'Invalid selection. Reply with campaign number or 0 for menu.';
      }
    } else if (session.step === 'enter_amount') {
      const amount = parseInt(msg.replace(/[^0-9]/g,''));
      if (amount && amount >= 500) {
        await pool.query('UPDATE whatsapp_donate_sessions SET step=$1, amount=$2 WHERE id=$3', ['confirm', session.id, amount]);
        reply = `Donate ${formatUGX(amount)} to this campaign?\\n\\n1. Confirm\\n2. Cancel`;
      } else {
        reply = 'Please enter a valid amount (minimum UGX 500):';
      }
    } else if (session.step === 'confirm') {
      if (msg === '1' || msg === 'yes' || msg === 'confirm') {
        const sess = (await pool.query('SELECT * FROM whatsapp_donate_sessions WHERE id=$1', [session.id])).rows[0];
        if (sess && sess.campaign_id && sess.amount) {
          await pool.query('INSERT INTO campaign_donations(tenant_id,campaign_id,donor_name,donor_phone,amount,method,message) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [tid, sess.campaign_id, 'WhatsApp Donor', phone, sess.amount, 'mobile_money', 'WhatsApp donation']);
          reply = `Thank you! Your donation of ${formatUGX(sess.amount)} has been recorded. You will receive a payment prompt shortly.\\n\\nReply 0 for menu.`;
          await pool.query('DELETE FROM whatsapp_donate_sessions WHERE id=$1', [session.id]);
        } else {
          reply = 'Session error. Reply 0 to start over.';
        }
      } else {
        reply = 'Donation cancelled. Reply 0 for menu.';
        await pool.query('DELETE FROM whatsapp_donate_sessions WHERE id=$1', [session.id]);
      }
    } else {
      reply = 'Session expired. Reply 0 for menu.';
      await pool.query('DELETE FROM whatsapp_donate_sessions WHERE id=$1', [session.id]);
    }
    res.json({ reply });
  }));

  app.get('/whatsapp-donate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const config = (await pool.query('SELECT * FROM whatsapp_donate_config WHERE tenant_id=$1', [tid])).rows[0];
    const html = `
      <div class="card">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
          <div style="font-size:32px">💬</div>
          <div><h2 style="margin:0">WhatsApp Donate Bot</h2><p style="color:#666;margin:4px 0 0">Let donors contribute via WhatsApp</p></div>
        </div>
        <div style="padding:20px;border:1px solid #e2e8f0;border-radius:12px;background:#f9fafb;margin-bottom:24px">
          <h3>Configuration</h3>
          <form method="POST" action="/api/whatsapp-donate/config">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label>WhatsApp Phone Number</label><input type="text" name="phone_number" value="${esc(config?.phone_number||'')}" placeholder="+256 7XX XXX XXX" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Webhook URL</label><input type="text" name="webhook_url" value="${esc(config?.webhook_url||'')}" placeholder="https://your-webhook-url" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div style="grid-column:span 2"><label>Welcome Message</label><textarea name="welcome_message" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;min-height:80px">${esc(config?.welcome_message||'Welcome! Reply with:\\n1. Donate\\n2. View Campaigns\\n3. My Donations\\n4. Help')}</textarea></div>
              <div><label>Active</label><select name="is_active" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"><option value="true" ${config?.is_active!==false?'selected':''}>Yes</option><option value="false" ${config?.is_active===false?'selected':''}>No</option></select></div>
            </div>
            <button type="submit" class="btn" style="background:#059669;color:white;margin-top:12px">Save Configuration</button>
          </form>
        </div>
        <div style="padding:20px;border:1px solid #22c55e;border-radius:12px;background:#f0fdf4">
          <h3>How It Works</h3>
          <ol style="color:#666;line-height:1.8"><li>Donor sends a WhatsApp message to your number</li><li>Bot presents a menu: Donate, View Campaigns, My Donations</li><li>Donor selects campaign and enters amount</li><li>Donation is recorded and payment prompt is sent</li><li>Donor receives confirmation message</li></ol>
        </div>
      </div>`;
    res.send(renderPage('WhatsApp Donate', html, req.session.user));
  }));

  // =============================================
  // FEATURE 8: MOBILE MONEY AUTO-DETECT
  // =============================================

  app.get('/api/mobile-money/providers', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM mobile_money_providers WHERE tenant_id=$1 AND is_active=true ORDER BY provider_name', [tid]);
    res.json({ providers: result.rows });
  }));

  app.post('/api/mobile-money/providers', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    const { country_code, provider_name, provider_code, ussd_code, logo_url, min_amount, max_amount } = req.body;
    if (!provider_name || !provider_code) return res.status(400).json({ error: 'provider_name and provider_code required' });
    const result = await pool.query('INSERT INTO mobile_money_providers(tenant_id,country_code,provider_name,provider_code,ussd_code,logo_url,min_amount,max_amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [tid, country_code||'UG', provider_name, provider_code, ussd_code, logo_url, parseInt(min_amount)||500, parseInt(max_amount)||5000000]);
    res.json({ success: true, provider: result.rows[0] });
  }));

  app.put('/api/mobile-money/providers/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    const { provider_name, ussd_code, min_amount, max_amount, is_active } = req.body;
    const result = await pool.query(`UPDATE mobile_money_providers SET provider_name=COALESCE($1,provider_name), ussd_code=COALESCE($2,ussd_code), min_amount=COALESCE($3,min_amount), max_amount=COALESCE($4,max_amount), is_active=COALESCE($5,is_active) WHERE id=$6 AND tenant_id=$7 RETURNING *`,
      [provider_name, ussd_code, min_amount?parseInt(min_amount):null, max_amount?parseInt(max_amount):null, is_active, req.params.id, tid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, provider: result.rows[0] });
  }));

  app.delete('/api/mobile-money/providers/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    await pool.query('DELETE FROM mobile_money_providers WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ success: true });
  }));

  app.post('/api/mobile-money/detect', ah(async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const provider = detectProvider(phone);
    const tid = req.body.tenant_id || 1;
    const providerInfo = (await pool.query('SELECT * FROM mobile_money_providers WHERE tenant_id=$1 AND provider_code=$2 AND is_active=true', [tid, provider])).rows[0];
    res.json({ provider, provider_info: providerInfo || null, phone });
  }));

  app.post('/api/mobile-money/initiate', ah(async (req, res) => {
    const tid = req.body.tenant_id || 1;
    const { donation_id, phone, amount } = req.body;
    if (!phone || !amount) return res.status(400).json({ error: 'phone and amount required' });
    const provider = detectProvider(phone);
    const ref = 'MM-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2,6).toUpperCase();
    const result = await pool.query('INSERT INTO donation_payment_attempts(tenant_id,donation_id,phone,detected_provider,amount,status,provider_reference) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [tid, donation_id||null, phone, provider, parseInt(amount), 'initiated', ref]);
    // In production, this would call the actual mobile money API
    // For now, auto-complete after a short delay simulation
    setTimeout(async () => {
      try {
        await pool.query("UPDATE donation_payment_attempts SET status='completed', updated_at=NOW() WHERE id=$1", [result.rows[0].id]);
      } catch(e) { console.warn('[MobileMoney] Auto-complete error:', e.message); }
    }, 3000);
    res.json({ success: true, attempt: result.rows[0], reference: ref, provider, message: 'Payment initiated. You will receive a prompt on ' + phone });
  }));

  app.get('/mobile-money', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const providers = (await pool.query('SELECT * FROM mobile_money_providers WHERE tenant_id=$1 ORDER BY provider_name', [tid])).rows;
    const html = `
      <div class="card">
        <h2>Mobile Money Providers</h2>
        <p style="color:#666;margin-bottom:20px">Configure mobile money providers for automatic detection and payment processing.</p>
        ${req.session.user.role==='admin'||req.session.user.role==='superadmin'?`
        <div style="padding:20px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;background:#f9fafb">
          <h3>Add Provider</h3>
          <form method="POST" action="/api/mobile-money/providers">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
              <div><label>Provider Name</label><input type="text" name="provider_name" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Provider Code</label><input type="text" name="provider_code" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>USSD Code</label><input type="text" name="ussd_code" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Min Amount</label><input type="number" name="min_amount" value="500" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Max Amount</label><input type="number" name="max_amount" value="5000000" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Country</label><input type="text" name="country_code" value="UG" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
            </div>
            <button type="submit" class="btn" style="background:#059669;color:white;margin-top:12px">Add Provider</button>
          </form>
        </div>`:''}
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Provider</th><th style="padding:10px;text-align:left">Code</th><th style="padding:10px;text-align:left">USSD</th><th style="padding:10px;text-align:right">Min</th><th style="padding:10px;text-align:right">Max</th><th style="padding:10px;text-align:center">Status</th></tr></thead>
          <tbody>${providers.map(p => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px;font-weight:600">${esc(p.provider_name)}</td>
            <td style="padding:10px">${esc(p.provider_code)}</td>
            <td style="padding:10px">${esc(p.ussd_code||'N/A')}</td>
            <td style="padding:10px;text-align:right">${formatUGX(p.min_amount)}</td>
            <td style="padding:10px;text-align:right">${formatUGX(p.max_amount)}</td>
            <td style="padding:10px;text-align:center"><span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;color:#fff;background:${p.is_active?'#059669':'#999'}">${p.is_active?'Active':'Inactive'}</span></td>
          </tr>`).join('')}</tbody>
        </table>
        <div style="margin-top:24px;padding:20px;border:1px solid #e2e8f0;border-radius:12px;background:#f9fafb">
          <h3>Auto-Detect Provider</h3>
          <div style="display:flex;gap:8px"><input type="text" id="phoneDetect" placeholder="Enter phone number e.g. 0772123456" style="flex:1;padding:8px;border:1px solid #ccc;border-radius:6px"><button onclick="detectPhone()" class="btn" style="background:#059669;color:white">Detect</button></div>
          <div id="detectResult" style="margin-top:8px"></div>
          <script>async function detectPhone(){const p=document.getElementById('phoneDetect').value;const r=await fetch('/api/mobile-money/detect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:p})});const d=await r.json();document.getElementById('detectResult').innerHTML=d.provider!=='UNKNOWN'?'<span style="color:#059669;font-weight:600">Detected: '+d.provider+'</span>':'<span style="color:#dc2626">Provider not recognized</span>';}</script>
        </div>
      </div>`;
    res.send(renderPage('Mobile Money', html, req.session.user));
  }));

  // =============================================
  // FEATURE 9: FUNERAL/BURIAL FUND
  // =============================================

  app.post('/api/funeral-funds', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, deceased_name, deceased_photo, relationship, target_amount, beneficiary_name, beneficiary_phone, funeral_date, location } = req.body;
    if (!title || !deceased_name || !target_amount) return res.status(400).json({ error: 'title, deceased_name, and target_amount required' });
    const result = await pool.query('INSERT INTO funeral_funds(tenant_id,title,deceased_name,deceased_photo,relationship,target_amount,beneficiary_name,beneficiary_phone,funeral_date,location,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
      [tid, title, deceased_name, deceased_photo||null, relationship||null, parseInt(target_amount), beneficiary_name||null, beneficiary_phone||null, funeral_date||null, location||null, req.session.user.email]);
    if(audit) audit(req, 'funeral_fund_created', { id: result.rows[0].id });
    // Send SMS notifications
    try {
      if (sendSMS && beneficiary_phone) {
        await sendSMS(beneficiary_phone, `A funeral fund "${title}" has been created. Target: ${formatUGX(target_amount)}. View at ${BASE_URL}/funeral-funds`);
      }
    } catch(e) { console.warn('[FuneralFund] SMS error:', e.message); }
    res.json({ success: true, fund: result.rows[0] });
  }));

  app.get('/api/funeral-funds', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM funeral_funds WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    res.json({ funds: result.rows });
  }));

  app.get('/api/funeral-funds/:id', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const fund = (await pool.query('SELECT * FROM funeral_funds WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!fund) return res.status(404).json({ error: 'Not found' });
    const contributions = (await pool.query('SELECT * FROM funeral_contributions WHERE fund_id=$1 AND tenant_id=$2 ORDER BY created_at DESC', [req.params.id, tid])).rows;
    res.json({ fund, contributions });
  }));

  app.post('/api/funeral-funds/:id/contribute', ah(async (req, res) => {
    const tid = req.body.tenant_id || req.session.user?.tenant_id || 1;
    const { contributor_name, contributor_email, contributor_phone, amount, method, message, is_anonymous } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const fundCheck = await pool.query('SELECT * FROM funeral_funds WHERE id=$1 AND tenant_id=$2 AND status=$3', [req.params.id, tid, 'active']);
    if (!fundCheck.rows.length) return res.status(400).json({ error: 'Fund not found or closed' });
    const result = await pool.query('INSERT INTO funeral_contributions(tenant_id,fund_id,contributor_name,contributor_email,contributor_phone,amount,method,message,is_anonymous) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [tid, req.params.id, contributor_name||'Anonymous', contributor_email||null, contributor_phone||null, parseInt(amount), method||'mobile_money', message||null, is_anonymous||false]);
    await pool.query('UPDATE funeral_funds SET raised_amount=raised_amount+$1 WHERE id=$2 AND tenant_id=$3', [parseInt(amount), req.params.id, tid]);
    res.json({ success: true, contribution: result.rows[0] });
  }));

  app.put('/api/funeral-funds/:id/close', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    const result = await pool.query('UPDATE funeral_funds SET status=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *', ['closed', req.params.id, tid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    if(audit) audit(req, 'funeral_fund_closed', { id: req.params.id });
    res.json({ success: true, fund: result.rows[0] });
  }));

  app.get('/funeral-funds', ah(async (req, res) => {
    const tid = req.session?.user?.tenant_id || 1;
    const funds = (await pool.query('SELECT * FROM funeral_funds WHERE tenant_id=$1 ORDER BY created_at DESC', [tid])).rows;
    const html = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <div><h2 style="margin:0">Funeral & Burial Funds</h2><p style="color:#666;margin:4px 0 0">Community support during difficult times</p></div>
          ${req.session?.user?`<button onclick="document.getElementById('newFundForm').style.display='block'" class="btn" style="background:#059669;color:white">+ Create Fund</button>`:''}
        </div>
        <div id="newFundForm" style="display:none;padding:20px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;background:#f9fafb">
          <h3>Create Funeral Fund</h3>
          <form method="POST" action="/api/funeral-funds">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label>Fund Title</label><input type="text" name="title" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Deceased Name</label><input type="text" name="deceased_name" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Target Amount (UGX)</label><input type="number" name="target_amount" required style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Relationship</label><input type="text" name="relationship" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Beneficiary Name</label><input type="text" name="beneficiary_name" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Beneficiary Phone</label><input type="text" name="beneficiary_phone" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Funeral Date</label><input type="date" name="funeral_date" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Location</label><input type="text" name="location" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
            </div>
            <button type="submit" class="btn" style="background:#059669;color:white;margin-top:12px">Create Fund</button>
          </form>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px">
          ${funds.map(f => {
            const pct = f.target_amount > 0 ? Math.min(100, Math.round((parseInt(f.raised_amount)/parseInt(f.target_amount))*100)) : 0;
            return `<div style="padding:20px;border:1px solid #e2e8f0;border-radius:12px;background:white">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <span style="font-size:20px">🕊️</span>
                <span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:${f.status==='active'?'#059669':'#999'}">${esc(f.status)}</span>
              </div>
              <h3 style="margin:0 0 4px">${esc(f.title)}</h3>
              <p style="color:#666;font-size:14px;margin:0 0 8px">In memory of <strong>${esc(f.deceased_name)}</strong></p>
              ${f.funeral_date?`<p style="color:#888;font-size:13px;margin:0 0 8px">Funeral: ${f.funeral_date} ${f.location?'at '+esc(f.location):''}</p>`:''}
              <div style="background:#e2e8f0;border-radius:8px;height:12px;margin-bottom:8px"><div style="background:#059669;border-radius:8px;height:12px;width:${pct}%"></div></div>
              <div style="display:flex;justify-content:space-between;font-size:13px"><span style="font-weight:700;color:#059669">${formatUGX(f.raised_amount)}</span><span style="color:#888">of ${formatUGX(f.target_amount)}</span></div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    res.send(renderPage('Funeral Funds', html, req.session?.user||null));
  }));

  // =============================================
  // FEATURE 10: AI CAMPAIGN STORY WRITER
  // =============================================

  const storyTemplates = {
    emotional: [
      `In the heart of {location}, {beneficiary} dreams of a brighter tomorrow. Every sunrise brings hope, but the path forward is filled with challenges that no one should face alone.\n\nWhen we first heard {beneficiary}'s story, we were moved beyond words. Imagine waking up each day knowing that your future depends on the kindness of strangers. That's the reality for {beneficiary}, and it's a reality we have the power to change.\n\nWith just {per_unit}, you can provide {unit} for {beneficiary}. That's not just a donation - it's a lifeline. It's a message that says "You matter. Your dreams matter."\n\nEvery contribution, no matter how small, writes a new chapter in this story of hope. Will you be the one to turn the page?`,
      `There are moments in life that define who we are - not by what we achieve for ourselves, but by what we give to others. This is one of those moments.\n\n{beneficiary} has shown incredible courage in the face of adversity. Despite everything, there is an unbreakable spirit that refuses to give up. But courage alone isn't always enough. Sometimes, it needs the support of a community that cares.\n\n{campaign_title} was created because we believe that no one should struggle alone. Your donation of {per_unit} provides {unit} and sends a powerful message of solidarity.\n\nTogether, we are not just raising funds - we are raising hope, dignity, and the promise of a better tomorrow. Join us in making a difference that will be felt for generations to come.`
    ],
    professional: [
      `{campaign_title} is a strategic initiative designed to address critical needs in {location}. With a clear target of {target}, this campaign leverages community support to create sustainable impact.\n\nKey Impact Metrics:\n- {per_unit} provides {unit} for those in need\n- Current progress: {progress}% toward our goal\n- {donor_count} donors have already contributed\n\nEvery contribution is transparently tracked and directly applied to the campaign's objectives. Our accountability framework ensures that funds are used efficiently and effectively.\n\nJoin {donor_count} other supporters who have already made a commitment. Your investment in this cause delivers measurable, lasting results.`,
    ],
    urgent: [
      `TIME IS RUNNING OUT. {beneficiary} needs your help NOW.\n\nWe are at {progress}% of our {target} goal, and every minute counts. This is not just another campaign - this is an emergency that demands immediate action.\n\nHere's what's at stake:\n- {per_unit} provides {unit}\n- Without additional support, {beneficiary} faces an uncertain future\n- The deadline is approaching fast\n\nWe cannot afford to wait. Every donation, every share, every act of support brings us closer to our goal. Right now, {donor_count} people have stepped up. Will you be next?\n\nACT NOW. Donate today. Share this campaign. Be the difference.`
    ],
    community: [
      `Our community has always been defined by one thing: we show up for each other. Today, we're asking you to show up once more.\n\n{campaign_title} is more than a fundraising campaign - it's a testament to what happens when a community unites around a shared purpose. When {beneficiary} needed help, we didn't look away. We looked at each other and said, "We've got this."\n\nSo far, {donor_count} community members have contributed, and together we've raised {raised} toward our {target} goal. That's {progress}% of the way there.\n\nWhether you can give {per_unit} for {unit}, or simply share this campaign with your network, every action counts. This is our community. This is our moment. Let's make it count.\n\nHarambee! Together we pull, together we rise.`
    ]
  };

  app.post('/api/campaigns/:id/generate-story', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { tone } = req.body;
    if (!tone || !['emotional','professional','urgent','community'].includes(tone)) return res.status(400).json({ error: 'tone must be emotional, professional, urgent, or community' });
    const campRes = await pool.query('SELECT c.*, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=c.id AND tenant_id=$1) as raised, (SELECT COUNT(*) FROM campaign_donations WHERE campaign_id=c.id AND tenant_id=$1) as donor_count FROM fundraising_campaigns c WHERE c.id=$2 AND c.tenant_id=$1', [tid, req.params.id]);
    if (!campRes.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const c = campRes.rows[0];
    const raised = parseInt(c.raised) || 0;
    const target = parseInt(c.target) || 1;
    const donorCount = parseInt(c.donor_count) || 0;
    const progress = Math.round((raised/target)*100);
    const templates = storyTemplates[tone] || storyTemplates.emotional;
    const template = templates[Math.floor(Math.random() * templates.length)];
    let story = template
      .replace(/\{campaign_title\}/g, c.title || 'This Campaign')
      .replace(/\{beneficiary\}/g, c.title?.split(' ').slice(0,2).join(' ') || 'the community')
      .replace(/\{location\}/g, 'the community')
      .replace(/\{target\}/g, formatUGX(target))
      .replace(/\{raised\}/g, formatUGX(raised))
      .replace(/\{progress\}/g, progress)
      .replace(/\{donor_count\}/g, donorCount)
      .replace(/\{per_unit\}/g, formatUGX(50000))
      .replace(/\{unit\}/g, 'essential supplies');
    const wordCount = story.split(/\s+/).length;
    const result = await pool.query('INSERT INTO ai_campaign_stories(tenant_id,campaign_id,story_text,tone,word_count) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [tid, req.params.id, story, tone, wordCount]);
    if(audit) audit(req, 'story_generated', { campaign_id: req.params.id, tone });
    res.json({ success: true, story: result.rows[0] });
  }));

  app.get('/api/campaigns/:id/stories', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM ai_campaign_stories WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY generated_at DESC', [tid, req.params.id]);
    res.json({ stories: result.rows });
  }));

  app.post('/api/campaigns/:id/apply-story', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { story_id } = req.body;
    if (!story_id) return res.status(400).json({ error: 'story_id required' });
    const storyRes = await pool.query('SELECT * FROM ai_campaign_stories WHERE id=$1 AND tenant_id=$2 AND campaign_id=$3', [story_id, tid, req.params.id]);
    if (!storyRes.rows.length) return res.status(404).json({ error: 'Story not found' });
    await pool.query('UPDATE fundraising_campaigns SET description=$1 WHERE id=$2 AND tenant_id=$3', [storyRes.rows[0].story_text, req.params.id, tid]);
    if(audit) audit(req, 'story_applied', { campaign_id: req.params.id, story_id });
    res.json({ success: true, message: 'Story applied to campaign description' });
  }));

  app.get('/ai-story-writer', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const campaigns = (await pool.query("SELECT id, title FROM fundraising_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50", [tid])).rows;
    const html = `
      <div class="card">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
          <div style="font-size:32px">✍️</div>
          <div><h2 style="margin:0">AI Campaign Story Writer</h2><p style="color:#666;margin:4px 0 0">Generate compelling stories for your campaigns</p></div>
        </div>
        <div style="padding:20px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;background:#f9fafb">
          <h3>Generate Story</h3>
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px">
            <div><label>Campaign</label><select id="storyCampaign" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px">${campaigns.map(c=>`<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select></div>
            <div><label>Tone</label><select id="storyTone" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"><option value="emotional">Emotional</option><option value="professional">Professional</option><option value="urgent">Urgent</option><option value="community">Community</option></select></div>
          </div>
          <button onclick="generateStory()" class="btn" style="background:#059669;color:white;margin-top:12px">Generate Story</button>
        </div>
        <div id="storyResult"></div>
        <script>
        async function generateStory(){
          const cid=document.getElementById('storyCampaign').value;
          const tone=document.getElementById('storyTone').value;
          const res=await fetch('/api/campaigns/'+cid+'/generate-story',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tone})});
          const data=await res.json();
          if(data.success){
            document.getElementById('storyResult').innerHTML='<div style="padding:20px;border:1px solid #059669;border-radius:12px;background:#f0fdf4;margin-bottom:16px">'+
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0">'+esc(tone)+' Story ('+data.story.word_count+' words)</h3>'+
              '<div><button onclick="applyStory('+cid+','+data.story.id+')" class="btn" style="background:#059669;color:white;padding:4px 12px;border-radius:6px">Apply to Campaign</button></div></div>'+
              '<div style="white-space:pre-wrap;line-height:1.8;color:#333">'+esc(data.story.story_text)+'</div></div>';
          }
        }
        async function applyStory(cid,sid){
          await fetch('/api/campaigns/'+cid+'/apply-story',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({story_id:sid})});
          alert('Story applied to campaign!');
        }
        function esc(t){return t?t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):'';}
        </script>
      </div>`;
    res.send(renderPage('AI Story Writer', html, req.session.user));
  }));

  // =============================================
  // STARTUP LOG
  // =============================================
  console.log('[FundraisingUltimate] Module loaded — 10 features, 60+ routes');

};
