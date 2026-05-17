/**
 * Fundraising Ultimate7 Module — Advanced Giving & Event Revenue
 * Features: Crypto/Blockchain Donations, In-Kind Donations, Planned Giving/Bequests,
 * Board Giving Tracker, Event Ticketing System, Auction Platform,
 * Sponsorship Management, Donor Advised Funds (DAF)
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  const migrations = [
    // Feature 1: Crypto/Blockchain Donations
    `CREATE TABLE IF NOT EXISTS crypto_wallets (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, wallet_address TEXT NOT NULL, network TEXT NOT NULL, label TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS crypto_donations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, wallet_id INTEGER NOT NULL REFERENCES crypto_wallets(id) ON DELETE CASCADE, donor_name TEXT, donor_email TEXT, crypto_amount NUMERIC NOT NULL DEFAULT 0, crypto_currency TEXT NOT NULL, usd_value_at_time NUMERIC DEFAULT 0, tx_hash TEXT, status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','failed','expired')), confirmed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS crypto_transactions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donation_id INTEGER NOT NULL REFERENCES crypto_donations(id) ON DELETE CASCADE, tx_hash TEXT, from_address TEXT, to_address TEXT, amount NUMERIC NOT NULL DEFAULT 0, currency TEXT, block_number INTEGER, confirmed BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_crypto_wallets_tenant ON crypto_wallets(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_crypto_donations_tenant ON crypto_donations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_crypto_txns_tenant ON crypto_transactions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_crypto_donations_wallet ON crypto_donations(wallet_id)`,
    `CREATE INDEX IF NOT EXISTS idx_crypto_txns_donation ON crypto_transactions(donation_id)`,

    // Feature 2: In-Kind Donations
    `CREATE TABLE IF NOT EXISTS inkind_categories (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, icon TEXT)`,
    `CREATE TABLE IF NOT EXISTS inkind_donations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, donor_name TEXT NOT NULL, donor_email TEXT, donor_phone TEXT, category_id INTEGER NOT NULL REFERENCES inkind_categories(id) ON DELETE CASCADE, item_name TEXT NOT NULL, item_description TEXT, estimated_value NUMERIC DEFAULT 0, quantity INTEGER DEFAULT 1, condition TEXT DEFAULT 'good' CHECK (condition IN ('new','good','fair','poor')), received_date DATE, acknowledged BOOLEAN DEFAULT false, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_inkind_categories_tenant ON inkind_categories(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_inkind_donations_tenant ON inkind_donations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_inkind_donations_category ON inkind_donations(category_id)`,

    // Feature 3: Planned Giving / Bequests
    `CREATE TABLE IF NOT EXISTS planned_giving (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_name TEXT NOT NULL, donor_email TEXT, donor_phone TEXT, giving_type TEXT NOT NULL DEFAULT 'will' CHECK (giving_type IN ('will','trust','insurance','annuity','other')), description TEXT, estimated_value NUMERIC DEFAULT 0, expected_date DATE, attorney_name TEXT, attorney_contact TEXT, status TEXT DEFAULT 'active' CHECK (status IN ('active','realized','cancelled','expired')), notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS bequests (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, planned_giving_id INTEGER NOT NULL REFERENCES planned_giving(id) ON DELETE CASCADE, bequest_type TEXT NOT NULL, description TEXT, amount NUMERIC DEFAULT 0, beneficiary TEXT, received_date DATE, status TEXT DEFAULT 'pending' CHECK (status IN ('pending','received','partial','cancelled')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_planned_giving_tenant ON planned_giving(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bequests_tenant ON bequests(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bequests_planned ON bequests(planned_giving_id)`,

    // Feature 4: Board Giving Tracker
    `CREATE TABLE IF NOT EXISTS board_members (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, role TEXT DEFAULT 'member', term_start DATE, term_end DATE, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS board_giving_pledges (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, board_member_id INTEGER NOT NULL REFERENCES board_members(id) ON DELETE CASCADE, campaign_id INTEGER, amount_pledged NUMERIC NOT NULL DEFAULT 0, amount_paid NUMERIC DEFAULT 0, fiscal_year TEXT NOT NULL, status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','cancelled','overdue')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_board_members_tenant ON board_members(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_board_giving_tenant ON board_giving_pledges(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_board_giving_member ON board_giving_pledges(board_member_id)`,

    // Feature 5: Event Ticketing System
    `CREATE TABLE IF NOT EXISTS ticket_tiers (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, event_name TEXT NOT NULL, tier_name TEXT NOT NULL, price NUMERIC NOT NULL DEFAULT 0, quantity_available INTEGER NOT NULL DEFAULT 0, quantity_sold INTEGER DEFAULT 0, description TEXT, perks TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ticket_purchases (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, tier_id INTEGER NOT NULL REFERENCES ticket_tiers(id) ON DELETE CASCADE, buyer_name TEXT NOT NULL, buyer_email TEXT, buyer_phone TEXT, quantity INTEGER NOT NULL DEFAULT 1, total_amount NUMERIC NOT NULL DEFAULT 0, payment_method TEXT DEFAULT 'card', payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','refunded','failed')), qr_code TEXT, checked_in BOOLEAN DEFAULT false, checked_in_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_ticket_tiers_tenant ON ticket_tiers(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ticket_purchases_tenant ON ticket_purchases(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ticket_purchases_tier ON ticket_purchases(tier_id)`,

    // Feature 6: Auction Platform
    `CREATE TABLE IF NOT EXISTS auction_items (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, event_name TEXT NOT NULL, item_name TEXT NOT NULL, item_description TEXT, starting_bid NUMERIC NOT NULL DEFAULT 0, current_bid NUMERIC DEFAULT 0, bid_increment NUMERIC DEFAULT 0, buy_now_price NUMERIC, image_url TEXT, donor_name TEXT, category TEXT, status TEXT DEFAULT 'draft' CHECK (status IN ('draft','active','closed','cancelled')), auction_start TIMESTAMPTZ, auction_end TIMESTAMPTZ, winner_id INTEGER, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS auction_bids (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, item_id INTEGER NOT NULL REFERENCES auction_items(id) ON DELETE CASCADE, bidder_name TEXT NOT NULL, bidder_email TEXT, bidder_phone TEXT, amount NUMERIC NOT NULL DEFAULT 0, is_winning BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_auction_items_tenant ON auction_items(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_auction_bids_tenant ON auction_bids(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_auction_bids_item ON auction_bids(item_id)`,

    // Feature 7: Sponsorship Management
    `CREATE TABLE IF NOT EXISTS sponsorship_packages (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, event_name TEXT NOT NULL, package_name TEXT NOT NULL, price NUMERIC NOT NULL DEFAULT 0, benefits_json TEXT DEFAULT '[]', quantity_available INTEGER NOT NULL DEFAULT 0, quantity_sold INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS sponsorship_purchases (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, package_id INTEGER NOT NULL REFERENCES sponsorship_packages(id) ON DELETE CASCADE, sponsor_name TEXT NOT NULL, sponsor_email TEXT, sponsor_phone TEXT, company TEXT, amount NUMERIC NOT NULL DEFAULT 0, payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','refunded','failed')), fulfillment_status TEXT DEFAULT 'pending' CHECK (fulfillment_status IN ('pending','fulfilled','partial','cancelled')), notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_sponsor_packages_tenant ON sponsorship_packages(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sponsor_purchases_tenant ON sponsorship_purchases(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sponsor_purchases_package ON sponsorship_purchases(package_id)`,

    // Feature 8: Donor Advised Funds (DAF)
    `CREATE TABLE IF NOT EXISTS donor_advised_funds (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, fund_name TEXT NOT NULL, advisor_name TEXT NOT NULL, advisor_email TEXT, advisor_phone TEXT, initial_contribution NUMERIC NOT NULL DEFAULT 0, current_balance NUMERIC DEFAULT 0, total_granted NUMERIC DEFAULT 0, status TEXT DEFAULT 'active' CHECK (status IN ('active','closed','suspended')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS daf_grants (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, fund_id INTEGER NOT NULL REFERENCES donor_advised_funds(id) ON DELETE CASCADE, grant_to TEXT NOT NULL, purpose TEXT, amount NUMERIC NOT NULL DEFAULT 0, status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','disbursed','cancelled')), granted_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_daf_tenant ON donor_advised_funds(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_daf_grants_tenant ON daf_grants(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_daf_grants_fund ON daf_grants(fund_id)`,

    // Seed: 2 crypto wallets per tenant (Bitcoin, Ethereum)
    `INSERT INTO crypto_wallets (tenant_id, wallet_address, network, label, is_active) SELECT t.id, 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', 'Bitcoin', 'Bitcoin Main Wallet', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM crypto_wallets WHERE tenant_id=t.id AND label='Bitcoin Main Wallet')`,
    `INSERT INTO crypto_wallets (tenant_id, wallet_address, network, label, is_active) SELECT t.id, '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', 'Ethereum', 'Ethereum Main Wallet', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM crypto_wallets WHERE tenant_id=t.id AND label='Ethereum Main Wallet')`,

    // Seed: 5 in-kind categories per tenant
    `INSERT INTO inkind_categories (tenant_id, name, description, icon) SELECT t.id, 'Clothing', 'Apparel and wearable items', 'shirt' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM inkind_categories WHERE tenant_id=t.id AND name='Clothing')`,
    `INSERT INTO inkind_categories (tenant_id, name, description, icon) SELECT t.id, 'Food', 'Non-perishable food items and meals', 'utensils' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM inkind_categories WHERE tenant_id=t.id AND name='Food')`,
    `INSERT INTO inkind_categories (tenant_id, name, description, icon) SELECT t.id, 'Equipment', 'Tools, electronics, and equipment', 'wrench' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM inkind_categories WHERE tenant_id=t.id AND name='Equipment')`,
    `INSERT INTO inkind_categories (tenant_id, name, description, icon) SELECT t.id, 'Books', 'Books, textbooks, and educational materials', 'book' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM inkind_categories WHERE tenant_id=t.id AND name='Books')`,
    `INSERT INTO inkind_categories (tenant_id, name, description, icon) SELECT t.id, 'Medical Supplies', 'Medical and first aid supplies', 'heart-pulse' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM inkind_categories WHERE tenant_id=t.id AND name='Medical Supplies')`,
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) {}
    }
    console.log('[FundraisingUltimate7] Migrations complete — 8 features');
  })();

  // =============================================
  // FEATURE 1: CRYPTO/BLOCKCHAIN DONATIONS
  // =============================================

  // List wallets
  app.get('/api/crypto-wallets', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT id, tenant_id, wallet_address, network, label, is_active, created_at FROM crypto_wallets WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Add wallet
  app.post('/api/crypto-wallets', requireAuth, ah(async (req, res) => {
    const { wallet_address, network, label, is_active } = req.body;
    if (!wallet_address || !network) return res.status(400).json({ error: 'wallet_address and network required' });
    const r = await pool.query(`INSERT INTO crypto_wallets (tenant_id, wallet_address, network, label, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.session.user.tenant_id, esc(wallet_address), esc(network), esc(label||''), is_active ?? true]);
    await audit(req, 'create', 'crypto_wallets', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update wallet
  app.put('/api/crypto-wallets/:id', requireAuth, ah(async (req, res) => {
    const { wallet_address, network, label, is_active } = req.body;
    const r = await pool.query(`UPDATE crypto_wallets SET wallet_address=COALESCE($1,wallet_address), network=COALESCE($2,network), label=COALESCE($3,label), is_active=COALESCE($4,is_active) WHERE tenant_id=$5 AND id=$6 RETURNING *`, [wallet_address ? esc(wallet_address) : null, network ? esc(network) : null, label ? esc(label) : null, is_active, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Wallet not found' });
    await audit(req, 'update', 'crypto_wallets', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Delete wallet
  app.delete('/api/crypto-wallets/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`DELETE FROM crypto_wallets WHERE tenant_id=$1 AND id=$2 RETURNING id`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Wallet not found' });
    await audit(req, 'delete', 'crypto_wallets', req.params.id);
    res.json({ ok: true });
  }));

  // List crypto donations
  app.get('/api/crypto-donations', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT cd.*, cw.wallet_address, cw.network, cw.label as wallet_label FROM crypto_donations cd JOIN crypto_wallets cw ON cd.wallet_id=cw.id WHERE cd.tenant_id=$1 ORDER BY cd.created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Record crypto donation
  app.post('/api/crypto-donations', requireAuth, ah(async (req, res) => {
    const { campaign_id, wallet_id, donor_name, donor_email, crypto_amount, crypto_currency, usd_value_at_time, tx_hash } = req.body;
    if (!wallet_id || !crypto_amount || !crypto_currency) return res.status(400).json({ error: 'wallet_id, crypto_amount, and crypto_currency required' });
    const wallet = await pool.query(`SELECT id FROM crypto_wallets WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, wallet_id]);
    if (!wallet.rows.length) return res.status(400).json({ error: 'Wallet not found' });
    const r = await pool.query(`INSERT INTO crypto_donations (tenant_id, campaign_id, wallet_id, donor_name, donor_email, crypto_amount, crypto_currency, usd_value_at_time, tx_hash, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') RETURNING *`, [req.session.user.tenant_id, campaign_id || null, wallet_id, esc(donor_name || ''), esc(donor_email || ''), crypto_amount, esc(crypto_currency), usd_value_at_time || 0, esc(tx_hash || '')]);
    await audit(req, 'create', 'crypto_donations', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Confirm on-chain
  app.post('/api/crypto-donations/:id/confirm', requireAuth, ah(async (req, res) => {
    const { tx_hash, from_address, to_address, amount, currency, block_number } = req.body;
    const donation = await pool.query(`SELECT * FROM crypto_donations WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!donation.rows.length) return res.status(404).json({ error: 'Donation not found' });
    const txn = await pool.query(`INSERT INTO crypto_transactions (tenant_id, donation_id, tx_hash, from_address, to_address, amount, currency, block_number, confirmed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING *`, [req.session.user.tenant_id, req.params.id, esc(tx_hash || donation.rows[0].tx_hash || ''), esc(from_address || ''), esc(to_address || ''), amount || donation.rows[0].crypto_amount, esc(currency || donation.rows[0].crypto_currency), block_number || null]);
    const r = await pool.query(`UPDATE crypto_donations SET status='confirmed', confirmed_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    await audit(req, 'confirm', 'crypto_donations', r.rows[0].id);
    res.json({ donation: r.rows[0], transaction: txn.rows[0] });
  }));

  // Check status
  app.get('/api/crypto-donations/:id/status', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT id, status, confirmed_at, tx_hash FROM crypto_donations WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Donation not found' });
    const txns = await pool.query(`SELECT * FROM crypto_transactions WHERE tenant_id=$1 AND donation_id=$2 ORDER BY created_at DESC`, [req.session.user.tenant_id, req.params.id]);
    res.json({ ...r.rows[0], transactions: txns.rows });
  }));

  // Crypto donations UI page
  app.get('/crypto-donate', requireAuth, ah(async (req, res) => {
    const wallets = await pool.query(`SELECT * FROM crypto_wallets WHERE tenant_id=$1 AND is_active=true ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    const donations = await pool.query(`SELECT cd.*, cw.wallet_address, cw.network, cw.label as wallet_label FROM crypto_donations cd JOIN crypto_wallets cw ON cd.wallet_id=cw.id WHERE cd.tenant_id=$1 ORDER BY cd.created_at DESC LIMIT 25`, [req.session.user.tenant_id]);
    const stats = await pool.query(`SELECT COUNT(*) as total_donations, COALESCE(SUM(usd_value_at_time),0) as total_usd, COUNT(CASE WHEN status='confirmed' THEN 1 END) as confirmed, COUNT(CASE WHEN status='pending' THEN 1 END) as pending FROM crypto_donations WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Crypto Donations', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Crypto/Blockchain Donations</h2>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Donations</div><div class="text-2xl font-bold">${stats.rows[0]?.total_donations || 0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total USD Value</div><div class="text-2xl font-bold">$${Number(stats.rows[0]?.total_usd || 0).toLocaleString()}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Confirmed</div><div class="text-2xl font-bold text-green-600">${stats.rows[0]?.confirmed || 0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Pending</div><div class="text-2xl font-bold text-yellow-600">${stats.rows[0]?.pending || 0}</div></div>
        </div>
        <div class="bg-white p-4 rounded-lg shadow mb-6">
          <h3 class="font-semibold mb-2">Wallets</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            ${wallets.rows.map(w => `<div class="border rounded p-3"><div class="font-medium">${w.label || w.network}</div><div class="text-xs text-gray-500 font-mono break-all">${w.wallet_address}</div><span class="inline-block mt-1 px-2 py-0.5 text-xs rounded ${w.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}">${w.is_active ? 'Active' : 'Inactive'}</span></div>`).join('')}
          </div>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <h3 class="font-semibold p-4 pb-0">Recent Crypto Donations</h3>
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">ID</th><th class="p-3 text-left">Donor</th><th class="p-3 text-left">Amount</th><th class="p-3 text-left">USD Value</th><th class="p-3 text-left">Status</th><th class="p-3 text-left">Date</th></tr></thead>
            <tbody>${donations.rows.map(d => `<tr class="border-t"><td class="p-3">${d.id}</td><td class="p-3">${d.donor_name || '-'}</td><td class="p-3">${d.crypto_amount} ${d.crypto_currency}</td><td class="p-3">$${Number(d.usd_value_at_time || 0).toLocaleString()}</td><td class="p-3"><span class="px-2 py-0.5 rounded text-xs ${d.status === 'confirmed' ? 'bg-green-100 text-green-700' : d.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}">${d.status}</span></td><td class="p-3">${new Date(d.created_at).toLocaleDateString()}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

  // =============================================
  // FEATURE 2: IN-KIND DONATIONS
  // =============================================

  // List categories
  app.get('/api/inkind-categories', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM inkind_categories WHERE tenant_id=$1 ORDER BY name`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Add category
  app.post('/api/inkind-categories', requireAuth, ah(async (req, res) => {
    const { name, description, icon } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO inkind_categories (tenant_id, name, description, icon) VALUES ($1,$2,$3,$4) RETURNING *`, [req.session.user.tenant_id, esc(name), esc(description || ''), esc(icon || '')]);
    await audit(req, 'create', 'inkind_categories', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update category
  app.put('/api/inkind-categories/:id', requireAuth, ah(async (req, res) => {
    const { name, description, icon } = req.body;
    const r = await pool.query(`UPDATE inkind_categories SET name=COALESCE($1,name), description=COALESCE($2,description), icon=COALESCE($3,icon) WHERE tenant_id=$4 AND id=$5 RETURNING *`, [name ? esc(name) : null, description ? esc(description) : null, icon ? esc(icon) : null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Category not found' });
    await audit(req, 'update', 'inkind_categories', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Delete category
  app.delete('/api/inkind-categories/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`DELETE FROM inkind_categories WHERE tenant_id=$1 AND id=$2 RETURNING id`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Category not found' });
    await audit(req, 'delete', 'inkind_categories', req.params.id);
    res.json({ ok: true });
  }));

  // List in-kind donations
  app.get('/api/inkind-donations', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT ik.*, ic.name as category_name FROM inkind_donations ik JOIN inkind_categories ic ON ik.category_id=ic.id WHERE ik.tenant_id=$1 ORDER BY ik.created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Record in-kind donation
  app.post('/api/inkind-donations', requireAuth, ah(async (req, res) => {
    const { campaign_id, donor_name, donor_email, donor_phone, category_id, item_name, item_description, estimated_value, quantity, condition, received_date, notes } = req.body;
    if (!donor_name || !category_id || !item_name) return res.status(400).json({ error: 'donor_name, category_id, and item_name required' });
    const cat = await pool.query(`SELECT id FROM inkind_categories WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, category_id]);
    if (!cat.rows.length) return res.status(400).json({ error: 'Category not found' });
    const r = await pool.query(`INSERT INTO inkind_donations (tenant_id, campaign_id, donor_name, donor_email, donor_phone, category_id, item_name, item_description, estimated_value, quantity, condition, received_date, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [req.session.user.tenant_id, campaign_id || null, esc(donor_name), esc(donor_email || ''), esc(donor_phone || ''), category_id, esc(item_name), esc(item_description || ''), estimated_value || 0, quantity || 1, condition || 'good', received_date || null, esc(notes || '')]);
    await audit(req, 'create', 'inkind_donations', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update in-kind donation
  app.put('/api/inkind-donations/:id', requireAuth, ah(async (req, res) => {
    const { item_name, item_description, estimated_value, quantity, condition, notes } = req.body;
    const r = await pool.query(`UPDATE inkind_donations SET item_name=COALESCE($1,item_name), item_description=COALESCE($2,item_description), estimated_value=COALESCE($3,estimated_value), quantity=COALESCE($4,quantity), condition=COALESCE($5,condition), notes=COALESCE($6,notes) WHERE tenant_id=$7 AND id=$8 RETURNING *`, [item_name ? esc(item_name) : null, item_description ? esc(item_description) : null, estimated_value, quantity, condition ? esc(condition) : null, notes ? esc(notes) : null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'In-kind donation not found' });
    await audit(req, 'update', 'inkind_donations', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Acknowledge receipt
  app.put('/api/inkind-donations/:id/acknowledge', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE inkind_donations SET acknowledged=true WHERE tenant_id=$1 AND id=$2 RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'In-kind donation not found' });
    await audit(req, 'acknowledge', 'inkind_donations', r.rows[0].id);
    // Send acknowledgment email
    if (r.rows[0].donor_email) {
      try { await sendEmail(r.rows[0].donor_email, 'In-Kind Donation Acknowledged', `Dear ${r.rows[0].donor_name},\n\nThank you for your in-kind donation of "${r.rows[0].item_name}". We have received and acknowledged your generous contribution.\n\nEstimated value: $${Number(r.rows[0].estimated_value).toLocaleString()}\n\nWith gratitude,\nThe Team`); } catch(e) {}
    }
    res.json(r.rows[0]);
  }));

  // Summary stats
  app.get('/api/inkind-donations/summary', requireAuth, ah(async (req, res) => {
    const total = await pool.query(`SELECT COUNT(*) as total_items, COALESCE(SUM(estimated_value),0) as total_value, COALESCE(SUM(quantity),0) as total_quantity FROM inkind_donations WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    const byCategory = await pool.query(`SELECT ic.name, COUNT(ik.id) as count, COALESCE(SUM(ik.estimated_value),0) as value FROM inkind_categories ic LEFT JOIN inkind_donations ik ON ic.id=ik.category_id AND ik.tenant_id=$1 WHERE ic.tenant_id=$1 GROUP BY ic.name ORDER BY value DESC`, [req.session.user.tenant_id]);
    const acknowledged = await pool.query(`SELECT COUNT(CASE WHEN acknowledged THEN 1 END) as acknowledged, COUNT(CASE WHEN NOT acknowledged THEN 1 END) as unacknowledged FROM inkind_donations WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    res.json({ ...total.rows[0], by_category: byCategory.rows, acknowledgment: acknowledged.rows[0] });
  }));

  // In-kind donations UI page
  app.get('/inkind-donations', requireAuth, ah(async (req, res) => {
    const categories = await pool.query(`SELECT * FROM inkind_categories WHERE tenant_id=$1 ORDER BY name`, [req.session.user.tenant_id]);
    const donations = await pool.query(`SELECT ik.*, ic.name as category_name FROM inkind_donations ik JOIN inkind_categories ic ON ik.category_id=ic.id WHERE ik.tenant_id=$1 ORDER BY ik.created_at DESC LIMIT 25`, [req.session.user.tenant_id]);
    const summary = await pool.query(`SELECT COUNT(*) as total_items, COALESCE(SUM(estimated_value),0) as total_value, COUNT(CASE WHEN acknowledged THEN 1 END) as acknowledged, COUNT(CASE WHEN NOT acknowledged THEN 1 END) as unacknowledged FROM inkind_donations WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    renderPage(req, res, 'In-Kind Donations', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">In-Kind Donations</h2>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Items</div><div class="text-2xl font-bold">${summary.rows[0]?.total_items || 0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Value</div><div class="text-2xl font-bold">$${Number(summary.rows[0]?.total_value || 0).toLocaleString()}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Acknowledged</div><div class="text-2xl font-bold text-green-600">${summary.rows[0]?.acknowledged || 0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Unacknowledged</div><div class="text-2xl font-bold text-yellow-600">${summary.rows[0]?.unacknowledged || 0}</div></div>
        </div>
        <div class="bg-white p-4 rounded-lg shadow mb-6">
          <h3 class="font-semibold mb-2">Categories</h3>
          <div class="flex flex-wrap gap-2">
            ${categories.rows.map(c => `<span class="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm">${c.name}</span>`).join('')}
          </div>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">ID</th><th class="p-3 text-left">Donor</th><th class="p-3 text-left">Item</th><th class="p-3 text-left">Category</th><th class="p-3 text-left">Value</th><th class="p-3 text-left">Qty</th><th class="p-3 text-left">Condition</th><th class="p-3 text-left">Acknowledged</th></tr></thead>
            <tbody>${donations.rows.map(d => `<tr class="border-t"><td class="p-3">${d.id}</td><td class="p-3">${d.donor_name}</td><td class="p-3">${d.item_name}</td><td class="p-3">${d.category_name}</td><td class="p-3">$${Number(d.estimated_value).toLocaleString()}</td><td class="p-3">${d.quantity}</td><td class="p-3">${d.condition}</td><td class="p-3">${d.acknowledged ? '<span class="text-green-600">Yes</span>' : '<span class="text-yellow-600">No</span>'}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

  // =============================================
  // FEATURE 3: PLANNED GIVING / BEQUESTS
  // =============================================

  // List planned giving
  app.get('/api/planned-giving', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM planned_giving WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Create planned giving
  app.post('/api/planned-giving', requireAuth, ah(async (req, res) => {
    const { donor_name, donor_email, donor_phone, giving_type, description, estimated_value, expected_date, attorney_name, attorney_contact, notes } = req.body;
    if (!donor_name || !giving_type) return res.status(400).json({ error: 'donor_name and giving_type required' });
    const r = await pool.query(`INSERT INTO planned_giving (tenant_id, donor_name, donor_email, donor_phone, giving_type, description, estimated_value, expected_date, attorney_name, attorney_contact, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [req.session.user.tenant_id, esc(donor_name), esc(donor_email || ''), esc(donor_phone || ''), esc(giving_type), esc(description || ''), estimated_value || 0, expected_date || null, esc(attorney_name || ''), esc(attorney_contact || ''), esc(notes || '')]);
    await audit(req, 'create', 'planned_giving', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update planned giving
  app.put('/api/planned-giving/:id', requireAuth, ah(async (req, res) => {
    const { donor_name, donor_email, donor_phone, giving_type, description, estimated_value, expected_date, attorney_name, attorney_contact, status, notes } = req.body;
    const r = await pool.query(`UPDATE planned_giving SET donor_name=COALESCE($1,donor_name), donor_email=COALESCE($2,donor_email), donor_phone=COALESCE($3,donor_phone), giving_type=COALESCE($4,giving_type), description=COALESCE($5,description), estimated_value=COALESCE($6,estimated_value), expected_date=COALESCE($7,expected_date), attorney_name=COALESCE($8,attorney_name), attorney_contact=COALESCE($9,attorney_contact), status=COALESCE($10,status), notes=COALESCE($11,notes) WHERE tenant_id=$12 AND id=$13 RETURNING *`, [donor_name ? esc(donor_name) : null, donor_email ? esc(donor_email) : null, donor_phone ? esc(donor_phone) : null, giving_type ? esc(giving_type) : null, description ? esc(description) : null, estimated_value, expected_date, attorney_name ? esc(attorney_name) : null, attorney_contact ? esc(attorney_contact) : null, status ? esc(status) : null, notes ? esc(notes) : null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Planned giving not found' });
    await audit(req, 'update', 'planned_giving', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Delete planned giving
  app.delete('/api/planned-giving/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`DELETE FROM planned_giving WHERE tenant_id=$1 AND id=$2 RETURNING id`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Planned giving not found' });
    await audit(req, 'delete', 'planned_giving', req.params.id);
    res.json({ ok: true });
  }));

  // Add bequest
  app.post('/api/planned-giving/:id/bequest', requireAuth, ah(async (req, res) => {
    const pg = await pool.query(`SELECT id FROM planned_giving WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!pg.rows.length) return res.status(404).json({ error: 'Planned giving not found' });
    const { bequest_type, description, amount, beneficiary } = req.body;
    if (!bequest_type) return res.status(400).json({ error: 'bequest_type required' });
    const r = await pool.query(`INSERT INTO bequests (tenant_id, planned_giving_id, bequest_type, description, amount, beneficiary) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.session.user.tenant_id, req.params.id, esc(bequest_type), esc(description || ''), amount || 0, esc(beneficiary || '')]);
    await audit(req, 'create', 'bequests', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // List bequests for a planned giving
  app.get('/api/planned-giving/:id/bequests', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM bequests WHERE tenant_id=$1 AND planned_giving_id=$2 ORDER BY created_at DESC`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Mark as realized
  app.put('/api/planned-giving/:id/realize', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE planned_giving SET status='realized' WHERE tenant_id=$1 AND id=$2 RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Planned giving not found' });
    await audit(req, 'realize', 'planned_giving', r.rows[0].id);
    // Notify
    if (r.rows[0].donor_email) {
      try { await sendEmail(r.rows[0].donor_email, 'Planned Giving Realized', `Dear ${r.rows[0].donor_name},\n\nYour planned giving has been marked as realized. Thank you for your generous contribution.\n\nWith gratitude,\nThe Team`); } catch(e) {}
    }
    res.json(r.rows[0]);
  }));

  // Summary statistics
  app.get('/api/planned-giving/stats', requireAuth, ah(async (req, res) => {
    const total = await pool.query(`SELECT COUNT(*) as total, COALESCE(SUM(estimated_value),0) as total_estimated FROM planned_giving WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    const byType = await pool.query(`SELECT giving_type, COUNT(*) as count, COALESCE(SUM(estimated_value),0) as value FROM planned_giving WHERE tenant_id=$1 GROUP BY giving_type ORDER BY value DESC`, [req.session.user.tenant_id]);
    const byStatus = await pool.query(`SELECT status, COUNT(*) as count, COALESCE(SUM(estimated_value),0) as value FROM planned_giving WHERE tenant_id=$1 GROUP BY status`, [req.session.user.tenant_id]);
    const bequestStats = await pool.query(`SELECT COUNT(*) as total_bequests, COALESCE(SUM(amount),0) as total_bequest_value FROM bequests WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    res.json({ ...total.rows[0], by_type: byType.rows, by_status: byStatus.rows, bequests: bequestStats.rows[0] });
  }));

  // Planned giving UI page
  app.get('/planned-giving', requireAuth, ah(async (req, res) => {
    const records = await pool.query(`SELECT * FROM planned_giving WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 25`, [req.session.user.tenant_id]);
    const stats = await pool.query(`SELECT COUNT(*) as total, COALESCE(SUM(estimated_value),0) as total_estimated, COUNT(CASE WHEN status='active' THEN 1 END) as active, COUNT(CASE WHEN status='realized' THEN 1 END) as realized FROM planned_giving WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Planned Giving', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Planned Giving & Bequests</h2>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Plans</div><div class="text-2xl font-bold">${stats.rows[0]?.total || 0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Estimated Value</div><div class="text-2xl font-bold">$${Number(stats.rows[0]?.total_estimated || 0).toLocaleString()}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Active</div><div class="text-2xl font-bold text-blue-600">${stats.rows[0]?.active || 0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Realized</div><div class="text-2xl font-bold text-green-600">${stats.rows[0]?.realized || 0}</div></div>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">ID</th><th class="p-3 text-left">Donor</th><th class="p-3 text-left">Type</th><th class="p-3 text-left">Est. Value</th><th class="p-3 text-left">Expected Date</th><th class="p-3 text-left">Status</th><th class="p-3 text-left">Attorney</th></tr></thead>
            <tbody>${records.rows.map(r => `<tr class="border-t"><td class="p-3">${r.id}</td><td class="p-3">${r.donor_name}</td><td class="p-3"><span class="px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700">${r.giving_type}</span></td><td class="p-3">$${Number(r.estimated_value).toLocaleString()}</td><td class="p-3">${r.expected_date ? new Date(r.expected_date).toLocaleDateString() : '-'}</td><td class="p-3"><span class="px-2 py-0.5 rounded text-xs ${r.status === 'realized' ? 'bg-green-100 text-green-700' : r.status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}">${r.status}</span></td><td class="p-3">${r.attorney_name || '-'}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

  // =============================================
  // FEATURE 4: BOARD GIVING TRACKER
  // =============================================

  // List board members
  app.get('/api/board-members', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM board_members WHERE tenant_id=$1 ORDER BY name`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Add board member
  app.post('/api/board-members', requireAuth, ah(async (req, res) => {
    const { name, email, phone, role, term_start, term_end } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO board_members (tenant_id, name, email, phone, role, term_start, term_end) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.session.user.tenant_id, esc(name), esc(email || ''), esc(phone || ''), esc(role || 'member'), term_start || null, term_end || null]);
    await audit(req, 'create', 'board_members', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update board member
  app.put('/api/board-members/:id', requireAuth, ah(async (req, res) => {
    const { name, email, phone, role, term_start, term_end, is_active } = req.body;
    const r = await pool.query(`UPDATE board_members SET name=COALESCE($1,name), email=COALESCE($2,email), phone=COALESCE($3,phone), role=COALESCE($4,role), term_start=COALESCE($5,term_start), term_end=COALESCE($6,term_end), is_active=COALESCE($7,is_active) WHERE tenant_id=$8 AND id=$9 RETURNING *`, [name ? esc(name) : null, email ? esc(email) : null, phone ? esc(phone) : null, role ? esc(role) : null, term_start, term_end, is_active, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Board member not found' });
    await audit(req, 'update', 'board_members', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Delete board member
  app.delete('/api/board-members/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`DELETE FROM board_members WHERE tenant_id=$1 AND id=$2 RETURNING id`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Board member not found' });
    await audit(req, 'delete', 'board_members', req.params.id);
    res.json({ ok: true });
  }));

  // List board giving pledges
  app.get('/api/board-giving', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT bgp.*, bm.name as member_name, bm.email as member_email, bm.role as member_role FROM board_giving_pledges bgp JOIN board_members bm ON bgp.board_member_id=bm.id WHERE bgp.tenant_id=$1 ORDER BY bgp.created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Record pledge
  app.post('/api/board-giving', requireAuth, ah(async (req, res) => {
    const { board_member_id, campaign_id, amount_pledged, fiscal_year } = req.body;
    if (!board_member_id || !amount_pledged || !fiscal_year) return res.status(400).json({ error: 'board_member_id, amount_pledged, and fiscal_year required' });
    const member = await pool.query(`SELECT id FROM board_members WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, board_member_id]);
    if (!member.rows.length) return res.status(400).json({ error: 'Board member not found' });
    const r = await pool.query(`INSERT INTO board_giving_pledges (tenant_id, board_member_id, campaign_id, amount_pledged, amount_paid, fiscal_year) VALUES ($1,$2,$3,$4,0,$5) RETURNING *`, [req.session.user.tenant_id, board_member_id, campaign_id || null, amount_pledged, esc(fiscal_year)]);
    await audit(req, 'create', 'board_giving_pledges', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update pledge
  app.put('/api/board-giving/:id', requireAuth, ah(async (req, res) => {
    const { amount_pledged, fiscal_year, status } = req.body;
    const r = await pool.query(`UPDATE board_giving_pledges SET amount_pledged=COALESCE($1,amount_pledged), fiscal_year=COALESCE($2,fiscal_year), status=COALESCE($3,status) WHERE tenant_id=$4 AND id=$5 RETURNING *`, [amount_pledged, fiscal_year ? esc(fiscal_year) : null, status ? esc(status) : null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Pledge not found' });
    await audit(req, 'update', 'board_giving_pledges', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Record payment toward pledge
  app.post('/api/board-giving/:id/pay', requireAuth, ah(async (req, res) => {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });
    const pledge = await pool.query(`SELECT * FROM board_giving_pledges WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!pledge.rows.length) return res.status(404).json({ error: 'Pledge not found' });
    const newPaid = Number(pledge.rows[0].amount_paid) + Number(amount);
    const newStatus = newPaid >= Number(pledge.rows[0].amount_pledged) ? 'completed' : pledge.rows[0].status;
    const r = await pool.query(`UPDATE board_giving_pledges SET amount_paid=$1, status=$2 WHERE tenant_id=$3 AND id=$4 RETURNING *`, [newPaid, esc(newStatus), req.session.user.tenant_id, req.params.id]);
    await audit(req, 'payment', 'board_giving_pledges', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Participation rate
  app.get('/api/board-giving/participation', requireAuth, ah(async (req, res) => {
    const totalMembers = await pool.query(`SELECT COUNT(*) as total FROM board_members WHERE tenant_id=$1 AND is_active=true`, [req.session.user.tenant_id]);
    const givingMembers = await pool.query(`SELECT COUNT(DISTINCT board_member_id) as giving FROM board_giving_pledges WHERE tenant_id=$1 AND status IN ('active','completed')`, [req.session.user.tenant_id]);
    const totalPledged = await pool.query(`SELECT COALESCE(SUM(amount_pledged),0) as pledged, COALESCE(SUM(amount_paid),0) as paid FROM board_giving_pledges WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    const total = Number(totalMembers.rows[0]?.total || 0);
    const giving = Number(givingMembers.rows[0]?.giving || 0);
    const rate = total > 0 ? Math.round((giving / total) * 100) : 0;
    res.json({ total_members: total, giving_members: giving, participation_rate: rate, total_pledged: totalPledged.rows[0]?.pledged || 0, total_paid: totalPledged.rows[0]?.paid || 0 });
  }));

  // Board giving UI page
  app.get('/board-giving', requireAuth, ah(async (req, res) => {
    const members = await pool.query(`SELECT * FROM board_members WHERE tenant_id=$1 ORDER BY name`, [req.session.user.tenant_id]);
    const pledges = await pool.query(`SELECT bgp.*, bm.name as member_name, bm.role as member_role FROM board_giving_pledges bgp JOIN board_members bm ON bgp.board_member_id=bm.id WHERE bgp.tenant_id=$1 ORDER BY bgp.created_at DESC LIMIT 25`, [req.session.user.tenant_id]);
    const participation = await pool.query(`SELECT COUNT(DISTINCT bm.id) as total, COUNT(DISTINCT bgp.board_member_id) as giving FROM board_members bm LEFT JOIN board_giving_pledges bgp ON bm.id=bgp.board_member_id AND bgp.status IN ('active','completed') WHERE bm.tenant_id=$1 AND bm.is_active=true`, [req.session.user.tenant_id]);
    const totals = await pool.query(`SELECT COALESCE(SUM(amount_pledged),0) as pledged, COALESCE(SUM(amount_paid),0) as paid FROM board_giving_pledges WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    const totalM = Number(participation.rows[0]?.total || 0);
    const givingM = Number(participation.rows[0]?.giving || 0);
    const rate = totalM > 0 ? Math.round((givingM / totalM) * 100) : 0;
    renderPage(req, res, 'Board Giving', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Board Giving Tracker</h2>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Active Members</div><div class="text-2xl font-bold">${totalM}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Participation Rate</div><div class="text-2xl font-bold">${rate}%</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Pledged</div><div class="text-2xl font-bold">$${Number(totals.rows[0]?.pledged || 0).toLocaleString()}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Paid</div><div class="text-2xl font-bold text-green-600">$${Number(totals.rows[0]?.paid || 0).toLocaleString()}</div></div>
        </div>
        <div class="bg-white p-4 rounded-lg shadow mb-6">
          <h3 class="font-semibold mb-2">Board Members</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            ${members.rows.filter(m => m.is_active).map(m => `<div class="border rounded p-3"><div class="font-medium">${m.name}</div><div class="text-xs text-gray-500">${m.role} | ${m.email || 'No email'}</div></div>`).join('')}
          </div>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">ID</th><th class="p-3 text-left">Member</th><th class="p-3 text-left">Fiscal Year</th><th class="p-3 text-left">Pledged</th><th class="p-3 text-left">Paid</th><th class="p-3 text-left">Remaining</th><th class="p-3 text-left">Status</th></tr></thead>
            <tbody>${pledges.rows.map(p => `<tr class="border-t"><td class="p-3">${p.id}</td><td class="p-3">${p.member_name}</td><td class="p-3">${p.fiscal_year}</td><td class="p-3">$${Number(p.amount_pledged).toLocaleString()}</td><td class="p-3">$${Number(p.amount_paid).toLocaleString()}</td><td class="p-3">$${Number(p.amount_pledged - p.amount_paid).toLocaleString()}</td><td class="p-3"><span class="px-2 py-0.5 rounded text-xs ${p.status === 'completed' ? 'bg-green-100 text-green-700' : p.status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}">${p.status}</span></td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

  // =============================================
  // FEATURE 5: EVENT TICKETING SYSTEM
  // =============================================

  // List ticket tiers
  app.get('/api/ticket-tiers', requireAuth, ah(async (req, res) => {
    const { event } = req.query;
    let q = `SELECT * FROM ticket_tiers WHERE tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    if (event) { q += ` AND event_name=$2`; params.push(esc(event)); }
    q += ` ORDER BY price ASC`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  // Create tier
  app.post('/api/ticket-tiers', requireAuth, ah(async (req, res) => {
    const { event_name, tier_name, price, quantity_available, description, perks, is_active } = req.body;
    if (!event_name || !tier_name || price === undefined) return res.status(400).json({ error: 'event_name, tier_name, and price required' });
    const r = await pool.query(`INSERT INTO ticket_tiers (tenant_id, event_name, tier_name, price, quantity_available, quantity_sold, description, perks, is_active) VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8) RETURNING *`, [req.session.user.tenant_id, esc(event_name), esc(tier_name), price, quantity_available || 0, esc(description || ''), esc(perks || ''), is_active ?? true]);
    await audit(req, 'create', 'ticket_tiers', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update tier
  app.put('/api/ticket-tiers/:id', requireAuth, ah(async (req, res) => {
    const { event_name, tier_name, price, quantity_available, description, perks, is_active } = req.body;
    const r = await pool.query(`UPDATE ticket_tiers SET event_name=COALESCE($1,event_name), tier_name=COALESCE($2,tier_name), price=COALESCE($3,price), quantity_available=COALESCE($4,quantity_available), description=COALESCE($5,description), perks=COALESCE($6,perks), is_active=COALESCE($7,is_active) WHERE tenant_id=$8 AND id=$9 RETURNING *`, [event_name ? esc(event_name) : null, tier_name ? esc(tier_name) : null, price, quantity_available, description ? esc(description) : null, perks ? esc(perks) : null, is_active, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Ticket tier not found' });
    await audit(req, 'update', 'ticket_tiers', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Delete tier
  app.delete('/api/ticket-tiers/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`DELETE FROM ticket_tiers WHERE tenant_id=$1 AND id=$2 RETURNING id`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Ticket tier not found' });
    await audit(req, 'delete', 'ticket_tiers', req.params.id);
    res.json({ ok: true });
  }));

  // List ticket purchases
  app.get('/api/ticket-purchases', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT tp.*, tt.event_name, tt.tier_name FROM ticket_purchases tp JOIN ticket_tiers tt ON tp.tier_id=tt.id WHERE tp.tenant_id=$1 ORDER BY tp.created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Buy ticket
  app.post('/api/ticket-purchases', requireAuth, ah(async (req, res) => {
    const { tier_id, buyer_name, buyer_email, buyer_phone, quantity, payment_method } = req.body;
    if (!tier_id || !buyer_name) return res.status(400).json({ error: 'tier_id and buyer_name required' });
    const tier = await pool.query(`SELECT * FROM ticket_tiers WHERE tenant_id=$1 AND id=$2 AND is_active=true`, [req.session.user.tenant_id, tier_id]);
    if (!tier.rows.length) return res.status(400).json({ error: 'Ticket tier not found or inactive' });
    const qty = quantity || 1;
    const available = Number(tier.rows[0].quantity_available) - Number(tier.rows[0].quantity_sold);
    if (available < qty) return res.status(400).json({ error: `Only ${available} tickets available` });
    const totalAmount = Number(tier.rows[0].price) * qty;
    const qrCode = 'TKT-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const r = await pool.query(`INSERT INTO ticket_purchases (tenant_id, tier_id, buyer_name, buyer_email, buyer_phone, quantity, total_amount, payment_method, payment_status, qr_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'paid',$9) RETURNING *`, [req.session.user.tenant_id, tier_id, esc(buyer_name), esc(buyer_email || ''), esc(buyer_phone || ''), qty, totalAmount, esc(payment_method || 'card'), esc(qrCode)]);
    await pool.query(`UPDATE ticket_tiers SET quantity_sold=quantity_sold+$1 WHERE id=$2`, [qty, tier_id]);
    await audit(req, 'create', 'ticket_purchases', r.rows[0].id);
    // Send confirmation email
    if (buyer_email) {
      try { await sendEmail(buyer_email, 'Ticket Purchase Confirmation', `Dear ${buyer_name},\n\nYour ticket purchase is confirmed!\n\nEvent: ${tier.rows[0].event_name}\nTier: ${tier.rows[0].tier_name}\nQuantity: ${qty}\nTotal: $${totalAmount.toLocaleString()}\nQR Code: ${qrCode}\n\nThank you!`); } catch(e) {}
    }
    res.json(r.rows[0]);
  }));

  // Check-in
  app.post('/api/ticket-purchases/:id/checkin', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE ticket_purchases SET checked_in=true, checked_in_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Ticket purchase not found' });
    if (r.rows[0].checked_in && r.rows[0].checked_in_at) {
      // Already checked in, return info
    }
    await audit(req, 'checkin', 'ticket_purchases', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // QR code
  app.get('/api/ticket-purchases/:id/qr', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT tp.id, tp.qr_code, tp.buyer_name, tt.event_name, tt.tier_name, tp.quantity, tp.checked_in FROM ticket_purchases tp JOIN ticket_tiers tt ON tp.tier_id=tt.id WHERE tp.tenant_id=$1 AND tp.id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Ticket not found' });
    res.json(r.rows[0]);
  }));

  // Event stats
  app.get('/api/ticket-events/:event/stats', requireAuth, ah(async (req, res) => {
    const tiers = await pool.query(`SELECT id, tier_name, price, quantity_available, quantity_sold FROM ticket_tiers WHERE tenant_id=$1 AND event_name=$2`, [req.session.user.tenant_id, esc(req.params.event)]);
    const purchases = await pool.query(`SELECT COUNT(*) as total_purchases, COALESCE(SUM(total_amount),0) as total_revenue, COALESCE(SUM(quantity),0) as total_tickets, COUNT(CASE WHEN checked_in THEN 1 END) as checked_in FROM ticket_purchases tp JOIN ticket_tiers tt ON tp.tier_id=tt.id WHERE tp.tenant_id=$1 AND tt.event_name=$2`, [req.session.user.tenant_id, esc(req.params.event)]);
    res.json({ tiers: tiers.rows, ...purchases.rows[0] });
  }));

  // Event tickets UI page
  app.get('/event-tickets', requireAuth, ah(async (req, res) => {
    const tiers = await pool.query(`SELECT * FROM ticket_tiers WHERE tenant_id=$1 AND is_active=true ORDER BY event_name, price`, [req.session.user.tenant_id]);
    const purchases = await pool.query(`SELECT tp.*, tt.event_name, tt.tier_name FROM ticket_purchases tp JOIN ticket_tiers tt ON tp.tier_id=tt.id WHERE tp.tenant_id=$1 ORDER BY tp.created_at DESC LIMIT 25`, [req.session.user.tenant_id]);
    const stats = await pool.query(`SELECT COALESCE(SUM(quantity_sold),0) as total_sold, COALESCE(SUM(tt.quantity_sold * tt.price),0) as total_revenue FROM ticket_tiers tt WHERE tt.tenant_id=$1`, [req.session.user.tenant_id]);
    const events = await pool.query(`SELECT DISTINCT event_name FROM ticket_tiers WHERE tenant_id=$1 ORDER BY event_name`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Event Tickets', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Event Ticketing</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Tickets Sold</div><div class="text-2xl font-bold">${stats.rows[0]?.total_sold || 0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Revenue</div><div class="text-2xl font-bold">$${Number(stats.rows[0]?.total_revenue || 0).toLocaleString()}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Events</div><div class="text-2xl font-bold">${events.rows.length}</div></div>
        </div>
        <div class="bg-white p-4 rounded-lg shadow mb-6">
          <h3 class="font-semibold mb-2">Ticket Tiers</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            ${tiers.rows.map(t => `<div class="border rounded p-3"><div class="font-medium">${t.tier_name}</div><div class="text-xs text-gray-500">${t.event_name}</div><div class="text-lg font-bold mt-1">$${Number(t.price).toLocaleString()}</div><div class="text-xs">${t.quantity_sold}/${t.quantity_available} sold</div><div class="w-full bg-gray-200 rounded h-2 mt-1"><div class="bg-green-500 rounded h-2" style="width:${t.quantity_available > 0 ? Math.round((t.quantity_sold/t.quantity_available)*100) : 0}%"></div></div></div>`).join('')}
          </div>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <h3 class="font-semibold p-4 pb-0">Recent Purchases</h3>
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">ID</th><th class="p-3 text-left">Buyer</th><th class="p-3 text-left">Event</th><th class="p-3 text-left">Tier</th><th class="p-3 text-left">Qty</th><th class="p-3 text-left">Total</th><th class="p-3 text-left">Checked In</th></tr></thead>
            <tbody>${purchases.rows.map(p => `<tr class="border-t"><td class="p-3">${p.id}</td><td class="p-3">${p.buyer_name}</td><td class="p-3">${p.event_name}</td><td class="p-3">${p.tier_name}</td><td class="p-3">${p.quantity}</td><td class="p-3">$${Number(p.total_amount).toLocaleString()}</td><td class="p-3">${p.checked_in ? '<span class="text-green-600">Yes</span>' : '<span class="text-gray-400">No</span>'}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

  // =============================================
  // FEATURE 6: AUCTION PLATFORM
  // =============================================

  // List auction items
  app.get('/api/auction-items', requireAuth, ah(async (req, res) => {
    const { event, status } = req.query;
    let q = `SELECT * FROM auction_items WHERE tenant_id=$1`;
    const params = [req.session.user.tenant_id]; let idx = 2;
    if (event) { q += ` AND event_name=$${idx}`; params.push(esc(event)); idx++; }
    if (status) { q += ` AND status=$${idx}`; params.push(esc(status)); idx++; }
    q += ` ORDER BY created_at DESC`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  // Create auction item
  app.post('/api/auction-items', requireAuth, ah(async (req, res) => {
    const { event_name, item_name, item_description, starting_bid, bid_increment, buy_now_price, image_url, donor_name, category, auction_start, auction_end } = req.body;
    if (!event_name || !item_name || starting_bid === undefined) return res.status(400).json({ error: 'event_name, item_name, and starting_bid required' });
    const r = await pool.query(`INSERT INTO auction_items (tenant_id, event_name, item_name, item_description, starting_bid, current_bid, bid_increment, buy_now_price, image_url, donor_name, category, status, auction_start, auction_end) VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,'draft',$11,$12) RETURNING *`, [req.session.user.tenant_id, esc(event_name), esc(item_name), esc(item_description || ''), starting_bid, bid_increment || 0, buy_now_price || null, esc(image_url || ''), esc(donor_name || ''), esc(category || ''), auction_start || null, auction_end || null]);
    await audit(req, 'create', 'auction_items', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update auction item
  app.put('/api/auction-items/:id', requireAuth, ah(async (req, res) => {
    const { item_name, item_description, starting_bid, bid_increment, buy_now_price, image_url, donor_name, category, status, auction_start, auction_end } = req.body;
    const r = await pool.query(`UPDATE auction_items SET item_name=COALESCE($1,item_name), item_description=COALESCE($2,item_description), starting_bid=COALESCE($3,starting_bid), bid_increment=COALESCE($4,bid_increment), buy_now_price=COALESCE($5,buy_now_price), image_url=COALESCE($6,image_url), donor_name=COALESCE($7,donor_name), category=COALESCE($8,category), status=COALESCE($9,status), auction_start=COALESCE($10,auction_start), auction_end=COALESCE($11,auction_end) WHERE tenant_id=$12 AND id=$13 RETURNING *`, [item_name ? esc(item_name) : null, item_description ? esc(item_description) : null, starting_bid, bid_increment, buy_now_price, image_url ? esc(image_url) : null, donor_name ? esc(donor_name) : null, category ? esc(category) : null, status ? esc(status) : null, auction_start, auction_end, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Auction item not found' });
    await audit(req, 'update', 'auction_items', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Delete auction item
  app.delete('/api/auction-items/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`DELETE FROM auction_items WHERE tenant_id=$1 AND id=$2 RETURNING id`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Auction item not found' });
    await audit(req, 'delete', 'auction_items', req.params.id);
    res.json({ ok: true });
  }));

  // Place bid
  app.post('/api/auction-items/:id/bid', requireAuth, ah(async (req, res) => {
    const { bidder_name, bidder_email, bidder_phone, amount } = req.body;
    if (!bidder_name || !amount) return res.status(400).json({ error: 'bidder_name and amount required' });
    const item = await pool.query(`SELECT * FROM auction_items WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!item.rows.length) return res.status(404).json({ error: 'Auction item not found' });
    if (item.rows[0].status !== 'active') return res.status(400).json({ error: 'Auction item is not active' });
    if (Number(amount) <= Number(item.rows[0].current_bid)) return res.status(400).json({ error: `Bid must be higher than current bid of $${item.rows[0].current_bid}` });
    if (item.rows[0].bid_increment > 0 && Number(amount) < Number(item.rows[0].current_bid) + Number(item.rows[0].bid_increment)) return res.status(400).json({ error: `Bid must be at least $${Number(item.rows[0].current_bid) + Number(item.rows[0].bid_increment)} (current + increment)` });
    // Reset previous winning bids
    await pool.query(`UPDATE auction_bids SET is_winning=false WHERE item_id=$1 AND tenant_id=$2`, [req.params.id, req.session.user.tenant_id]);
    const bid = await pool.query(`INSERT INTO auction_bids (tenant_id, item_id, bidder_name, bidder_email, bidder_phone, amount, is_winning) VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *`, [req.session.user.tenant_id, req.params.id, esc(bidder_name), esc(bidder_email || ''), esc(bidder_phone || ''), amount]);
    await pool.query(`UPDATE auction_items SET current_bid=$1 WHERE id=$2`, [amount, req.params.id]);
    await audit(req, 'bid', 'auction_bids', bid.rows[0].id);
    res.json(bid.rows[0]);
  }));

  // List bids for an item
  app.get('/api/auction-items/:id/bids', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM auction_bids WHERE tenant_id=$1 AND item_id=$2 ORDER BY amount DESC, created_at DESC`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Buy now
  app.post('/api/auction-items/:id/buy-now', requireAuth, ah(async (req, res) => {
    const { bidder_name, bidder_email, bidder_phone } = req.body;
    if (!bidder_name) return res.status(400).json({ error: 'bidder_name required' });
    const item = await pool.query(`SELECT * FROM auction_items WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!item.rows.length) return res.status(404).json({ error: 'Auction item not found' });
    if (item.rows[0].status !== 'active') return res.status(400).json({ error: 'Auction item is not active' });
    if (!item.rows[0].buy_now_price) return res.status(400).json({ error: 'No buy-now price set' });
    await pool.query(`UPDATE auction_bids SET is_winning=false WHERE item_id=$1 AND tenant_id=$2`, [req.params.id, req.session.user.tenant_id]);
    const bid = await pool.query(`INSERT INTO auction_bids (tenant_id, item_id, bidder_name, bidder_email, bidder_phone, amount, is_winning) VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *`, [req.session.user.tenant_id, req.params.id, esc(bidder_name), esc(bidder_email || ''), esc(bidder_phone || ''), item.rows[0].buy_now_price]);
    const r = await pool.query(`UPDATE auction_items SET current_bid=$1, status='closed', winner_id=$2 WHERE id=$3 RETURNING *`, [item.rows[0].buy_now_price, bid.rows[0].id, req.params.id]);
    await audit(req, 'buy_now', 'auction_items', r.rows[0].id);
    if (bidder_email) {
      try { await sendEmail(bidder_email, 'Auction Purchase Confirmed', `Dear ${bidder_name},\n\nCongratulations! You have won the auction for "${item.rows[0].item_name}" at the buy-now price of $${Number(item.rows[0].buy_now_price).toLocaleString()}.\n\nThank you!`); } catch(e) {}
    }
    res.json({ item: r.rows[0], winning_bid: bid.rows[0] });
  }));

  // Close auction
  app.post('/api/auction-items/:id/close', requireAuth, ah(async (req, res) => {
    const item = await pool.query(`SELECT * FROM auction_items WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!item.rows.length) return res.status(404).json({ error: 'Auction item not found' });
    const winningBid = await pool.query(`SELECT * FROM auction_bids WHERE item_id=$1 AND tenant_id=$2 AND is_winning=true ORDER BY amount DESC LIMIT 1`, [req.params.id, req.session.user.tenant_id]);
    const winnerId = winningBid.rows.length ? winningBid.rows[0].id : null;
    const r = await pool.query(`UPDATE auction_items SET status='closed', winner_id=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *`, [winnerId, req.session.user.tenant_id, req.params.id]);
    await audit(req, 'close', 'auction_items', r.rows[0].id);
    if (winningBid.rows.length && winningBid.rows[0].bidder_email) {
      try { await sendEmail(winningBid.rows[0].bidder_email, 'Auction Won!', `Dear ${winningBid.rows[0].bidder_name},\n\nCongratulations! You won the auction for "${item.rows[0].item_name}" with a bid of $${Number(winningBid.rows[0].amount).toLocaleString()}.\n\nThank you!`); } catch(e) {}
    }
    res.json({ item: r.rows[0], winner: winningBid.rows[0] || null });
  }));

  // Auction event stats
  app.get('/api/auction-events/:event/stats', requireAuth, ah(async (req, res) => {
    const items = await pool.query(`SELECT COUNT(*) as total_items, COUNT(CASE WHEN status='active' THEN 1 END) as active, COUNT(CASE WHEN status='closed' THEN 1 END) as closed FROM auction_items WHERE tenant_id=$1 AND event_name=$2`, [req.session.user.tenant_id, esc(req.params.event)]);
    const bids = await pool.query(`SELECT COUNT(*) as total_bids, COALESCE(MAX(ab.amount),0) as highest_bid FROM auction_bids ab JOIN auction_items ai ON ab.item_id=ai.id WHERE ab.tenant_id=$1 AND ai.event_name=$2`, [req.session.user.tenant_id, esc(req.params.event)]);
    const revenue = await pool.query(`SELECT COALESCE(SUM(ai.current_bid),0) as total_revenue FROM auction_items ai WHERE ai.tenant_id=$1 AND ai.event_name=$2 AND ai.status='closed'`, [req.session.user.tenant_id, esc(req.params.event)]);
    res.json({ ...items.rows[0], ...bids.rows[0], ...revenue.rows[0] });
  }));

  // Auction UI page
  app.get('/auction', requireAuth, ah(async (req, res) => {
    const items = await pool.query(`SELECT * FROM auction_items WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 25`, [req.session.user.tenant_id]);
    const stats = await pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN status='active' THEN 1 END) as active, COUNT(CASE WHEN status='closed' THEN 1 END) as closed, COALESCE(SUM(CASE WHEN status='closed' THEN current_bid ELSE 0 END),0) as total_revenue FROM auction_items WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Auction Platform', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Auction Platform</h2>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Items</div><div class="text-2xl font-bold">${stats.rows[0]?.total || 0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Active Auctions</div><div class="text-2xl font-bold text-green-600">${stats.rows[0]?.active || 0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Closed</div><div class="text-2xl font-bold">${stats.rows[0]?.closed || 0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Revenue</div><div class="text-2xl font-bold">$${Number(stats.rows[0]?.total_revenue || 0).toLocaleString()}</div></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          ${items.rows.map(i => `<div class="bg-white rounded-lg shadow p-4">
            <div class="flex justify-between items-start"><h3 class="font-semibold">${i.item_name}</h3><span class="px-2 py-0.5 rounded text-xs ${i.status === 'active' ? 'bg-green-100 text-green-700' : i.status === 'closed' ? 'bg-gray-100 text-gray-700' : 'bg-yellow-100 text-yellow-700'}">${i.status}</span></div>
            <div class="text-xs text-gray-500 mt-1">${i.event_name}${i.category ? ' | ' + i.category : ''}</div>
            ${i.item_description ? `<p class="text-sm text-gray-600 mt-2">${i.item_description}</p>` : ''}
            <div class="mt-3 flex justify-between text-sm"><span>Starting: $${Number(i.starting_bid).toLocaleString()}</span><span class="font-bold">Current: $${Number(i.current_bid).toLocaleString()}</span></div>
            ${i.buy_now_price ? `<div class="text-sm text-blue-600 mt-1">Buy Now: $${Number(i.buy_now_price).toLocaleString()}</div>` : ''}
            ${i.donor_name ? `<div class="text-xs text-gray-400 mt-1">Donated by: ${i.donor_name}</div>` : ''}
          </div>`).join('')}
        </div>
      </div>`);
  }));

  // =============================================
  // FEATURE 7: SPONSORSHIP MANAGEMENT
  // =============================================

  // List sponsorship packages
  app.get('/api/sponsorship-packages', requireAuth, ah(async (req, res) => {
    const { event } = req.query;
    let q = `SELECT * FROM sponsorship_packages WHERE tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    if (event) { q += ` AND event_name=$2`; params.push(esc(event)); }
    q += ` ORDER BY price ASC`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  // Create package
  app.post('/api/sponsorship-packages', requireAuth, ah(async (req, res) => {
    const { event_name, package_name, price, benefits, quantity_available, is_active } = req.body;
    if (!event_name || !package_name || price === undefined) return res.status(400).json({ error: 'event_name, package_name, and price required' });
    const r = await pool.query(`INSERT INTO sponsorship_packages (tenant_id, event_name, package_name, price, benefits_json, quantity_available, quantity_sold, is_active) VALUES ($1,$2,$3,$4,$5,$6,0,$7) RETURNING *`, [req.session.user.tenant_id, esc(event_name), esc(package_name), price, JSON.stringify(benefits || []), quantity_available || 0, is_active ?? true]);
    await audit(req, 'create', 'sponsorship_packages', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update package
  app.put('/api/sponsorship-packages/:id', requireAuth, ah(async (req, res) => {
    const { event_name, package_name, price, benefits, quantity_available, is_active } = req.body;
    const r = await pool.query(`UPDATE sponsorship_packages SET event_name=COALESCE($1,event_name), package_name=COALESCE($2,package_name), price=COALESCE($3,price), benefits_json=COALESCE($4,benefits_json), quantity_available=COALESCE($5,quantity_available), is_active=COALESCE($6,is_active) WHERE tenant_id=$7 AND id=$8 RETURNING *`, [event_name ? esc(event_name) : null, package_name ? esc(package_name) : null, price, benefits ? JSON.stringify(benefits) : null, quantity_available, is_active, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Package not found' });
    await audit(req, 'update', 'sponsorship_packages', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Delete package
  app.delete('/api/sponsorship-packages/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`DELETE FROM sponsorship_packages WHERE tenant_id=$1 AND id=$2 RETURNING id`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Package not found' });
    await audit(req, 'delete', 'sponsorship_packages', req.params.id);
    res.json({ ok: true });
  }));

  // List sponsorship purchases
  app.get('/api/sponsorship-purchases', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT sp.*, ssp.package_name, ssp.event_name FROM sponsorship_purchases sp JOIN sponsorship_packages ssp ON sp.package_id=ssp.id WHERE sp.tenant_id=$1 ORDER BY sp.created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Purchase sponsorship
  app.post('/api/sponsorship-purchases', requireAuth, ah(async (req, res) => {
    const { package_id, sponsor_name, sponsor_email, sponsor_phone, company, amount, notes } = req.body;
    if (!package_id || !sponsor_name) return res.status(400).json({ error: 'package_id and sponsor_name required' });
    const pkg = await pool.query(`SELECT * FROM sponsorship_packages WHERE tenant_id=$1 AND id=$2 AND is_active=true`, [req.session.user.tenant_id, package_id]);
    if (!pkg.rows.length) return res.status(400).json({ error: 'Package not found or inactive' });
    const available = Number(pkg.rows[0].quantity_available) - Number(pkg.rows[0].quantity_sold);
    if (available <= 0) return res.status(400).json({ error: 'Package sold out' });
    const purchaseAmount = amount || pkg.rows[0].price;
    const r = await pool.query(`INSERT INTO sponsorship_purchases (tenant_id, package_id, sponsor_name, sponsor_email, sponsor_phone, company, amount, payment_status, fulfillment_status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,'paid','pending',$8) RETURNING *`, [req.session.user.tenant_id, package_id, esc(sponsor_name), esc(sponsor_email || ''), esc(sponsor_phone || ''), esc(company || ''), purchaseAmount, esc(notes || '')]);
    await pool.query(`UPDATE sponsorship_packages SET quantity_sold=quantity_sold+1 WHERE id=$1`, [package_id]);
    await audit(req, 'create', 'sponsorship_purchases', r.rows[0].id);
    // Send confirmation email
    if (sponsor_email) {
      const benefits = Array.isArray(pkg.rows[0].benefits_json) ? pkg.rows[0].benefits_json : JSON.parse(pkg.rows[0].benefits_json || '[]');
      try { await sendEmail(sponsor_email, 'Sponsorship Confirmed', `Dear ${sponsor_name},\n\nYour sponsorship for "${pkg.rows[0].package_name}" at "${pkg.rows[0].event_name}" is confirmed!\n\nAmount: $${Number(purchaseAmount).toLocaleString()}\nBenefits:\n${benefits.map(b => '- ' + b).join('\n')}\n\nThank you for your support!`); } catch(e) {}
    }
    res.json(r.rows[0]);
  }));

  // Mark fulfilled
  app.put('/api/sponsorship-purchases/:id/fulfill', requireAuth, ah(async (req, res) => {
    const { fulfillment_status } = req.body;
    const r = await pool.query(`UPDATE sponsorship_purchases SET fulfillment_status=COALESCE($1,fulfillment_status) WHERE tenant_id=$2 AND id=$3 RETURNING *`, [fulfillment_status ? esc(fulfillment_status) : null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Purchase not found' });
    await audit(req, 'fulfill', 'sponsorship_purchases', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Sponsorship event stats
  app.get('/api/sponsorship-events/:event/stats', requireAuth, ah(async (req, res) => {
    const packages = await pool.query(`SELECT id, package_name, price, quantity_available, quantity_sold FROM sponsorship_packages WHERE tenant_id=$1 AND event_name=$2`, [req.session.user.tenant_id, esc(req.params.event)]);
    const purchases = await pool.query(`SELECT COUNT(*) as total_purchases, COALESCE(SUM(sp.amount),0) as total_revenue, COUNT(CASE WHEN sp.fulfillment_status='fulfilled' THEN 1 END) as fulfilled FROM sponsorship_purchases sp JOIN sponsorship_packages ssp ON sp.package_id=ssp.id WHERE sp.tenant_id=$1 AND ssp.event_name=$2`, [req.session.user.tenant_id, esc(req.params.event)]);
    res.json({ packages: packages.rows, ...purchases.rows[0] });
  }));

  // Sponsorships UI page
  app.get('/sponsorships', requireAuth, ah(async (req, res) => {
    const packages = await pool.query(`SELECT * FROM sponsorship_packages WHERE tenant_id=$1 AND is_active=true ORDER BY event_name, price`, [req.session.user.tenant_id]);
    const purchases = await pool.query(`SELECT sp.*, ssp.package_name, ssp.event_name FROM sponsorship_purchases sp JOIN sponsorship_packages ssp ON sp.package_id=ssp.id WHERE sp.tenant_id=$1 ORDER BY sp.created_at DESC LIMIT 25`, [req.session.user.tenant_id]);
    const stats = await pool.query(`SELECT COALESCE(SUM(quantity_sold),0) as total_sold, COALESCE(SUM(sp.amount),0) as total_revenue FROM sponsorship_packages ssp LEFT JOIN sponsorship_purchases sp ON ssp.id=sp.package_id AND sp.tenant_id=$1 WHERE ssp.tenant_id=$1`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Sponsorships', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Sponsorship Management</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Sponsors</div><div class="text-2xl font-bold">${stats.rows[0]?.total_sold || 0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Revenue</div><div class="text-2xl font-bold">$${Number(stats.rows[0]?.total_revenue || 0).toLocaleString()}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Packages</div><div class="text-2xl font-bold">${packages.rows.length}</div></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          ${packages.rows.map(p => {
            const benefits = (() => { try { return JSON.parse(p.benefits_json || '[]'); } catch(e) { return []; } })();
            return `<div class="bg-white rounded-lg shadow p-4 border-t-4 border-emerald-500">
              <h3 class="font-semibold">${p.package_name}</h3>
              <div class="text-xs text-gray-500">${p.event_name}</div>
              <div class="text-2xl font-bold mt-2">$${Number(p.price).toLocaleString()}</div>
              <div class="text-xs text-gray-500 mt-1">${p.quantity_sold}/${p.quantity_available} sold</div>
              ${benefits.length ? `<ul class="mt-2 text-sm text-gray-600">${benefits.map(b => `<li class="flex items-start"><span class="text-emerald-500 mr-1">✓</span>${b}</li>`).join('')}</ul>` : ''}
            </div>`;
          }).join('')}
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <h3 class="font-semibold p-4 pb-0">Recent Sponsorships</h3>
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">ID</th><th class="p-3 text-left">Sponsor</th><th class="p-3 text-left">Company</th><th class="p-3 text-left">Package</th><th class="p-3 text-left">Amount</th><th class="p-3 text-left">Payment</th><th class="p-3 text-left">Fulfillment</th></tr></thead>
            <tbody>${purchases.rows.map(p => `<tr class="border-t"><td class="p-3">${p.id}</td><td class="p-3">${p.sponsor_name}</td><td class="p-3">${p.company || '-'}</td><td class="p-3">${p.package_name}</td><td class="p-3">$${Number(p.amount).toLocaleString()}</td><td class="p-3"><span class="px-2 py-0.5 rounded text-xs ${p.payment_status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}">${p.payment_status}</span></td><td class="p-3"><span class="px-2 py-0.5 rounded text-xs ${p.fulfillment_status === 'fulfilled' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}">${p.fulfillment_status}</span></td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

  // =============================================
  // FEATURE 8: DONOR ADVISED FUNDS (DAF)
  // =============================================

  // List funds
  app.get('/api/daf', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM donor_advised_funds WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Create fund
  app.post('/api/daf', requireAuth, ah(async (req, res) => {
    const { fund_name, advisor_name, advisor_email, advisor_phone, initial_contribution } = req.body;
    if (!fund_name || !advisor_name) return res.status(400).json({ error: 'fund_name and advisor_name required' });
    const contribution = initial_contribution || 0;
    const r = await pool.query(`INSERT INTO donor_advised_funds (tenant_id, fund_name, advisor_name, advisor_email, advisor_phone, initial_contribution, current_balance, total_granted) VALUES ($1,$2,$3,$4,$5,$6,$6,0) RETURNING *`, [req.session.user.tenant_id, esc(fund_name), esc(advisor_name), esc(advisor_email || ''), esc(advisor_phone || ''), contribution]);
    await audit(req, 'create', 'donor_advised_funds', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update fund
  app.put('/api/daf/:id', requireAuth, ah(async (req, res) => {
    const { fund_name, advisor_name, advisor_email, advisor_phone, status } = req.body;
    const r = await pool.query(`UPDATE donor_advised_funds SET fund_name=COALESCE($1,fund_name), advisor_name=COALESCE($2,advisor_name), advisor_email=COALESCE($3,advisor_email), advisor_phone=COALESCE($4,advisor_phone), status=COALESCE($5,status) WHERE tenant_id=$6 AND id=$7 RETURNING *`, [fund_name ? esc(fund_name) : null, advisor_name ? esc(advisor_name) : null, advisor_email ? esc(advisor_email) : null, advisor_phone ? esc(advisor_phone) : null, status ? esc(status) : null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Fund not found' });
    await audit(req, 'update', 'donor_advised_funds', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // List grants for a fund
  app.get('/api/daf/:id/grants', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM daf_grants WHERE tenant_id=$1 AND fund_id=$2 ORDER BY created_at DESC`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Recommend grant
  app.post('/api/daf/:id/grants', requireAuth, ah(async (req, res) => {
    const { grant_to, purpose, amount } = req.body;
    if (!grant_to || !amount) return res.status(400).json({ error: 'grant_to and amount required' });
    const fund = await pool.query(`SELECT * FROM donor_advised_funds WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!fund.rows.length) return res.status(404).json({ error: 'Fund not found' });
    if (fund.rows[0].status !== 'active') return res.status(400).json({ error: 'Fund is not active' });
    if (Number(amount) > Number(fund.rows[0].current_balance)) return res.status(400).json({ error: `Grant amount exceeds available balance of $${fund.rows[0].current_balance}` });
    const r = await pool.query(`INSERT INTO daf_grants (tenant_id, fund_id, grant_to, purpose, amount, status) VALUES ($1,$2,$3,$4,$5,'pending') RETURNING *`, [req.session.user.tenant_id, req.params.id, esc(grant_to), esc(purpose || ''), amount]);
    await audit(req, 'recommend_grant', 'daf_grants', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Approve grant
  app.put('/api/daf/grants/:id/approve', requireAuth, ah(async (req, res) => {
    const grant = await pool.query(`SELECT * FROM daf_grants WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!grant.rows.length) return res.status(404).json({ error: 'Grant not found' });
    if (grant.rows[0].status !== 'pending') return res.status(400).json({ error: 'Grant is not pending' });
    const fund = await pool.query(`SELECT * FROM donor_advised_funds WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, grant.rows[0].fund_id]);
    if (Number(grant.rows[0].amount) > Number(fund.rows[0].current_balance)) return res.status(400).json({ error: 'Insufficient balance' });
    const r = await pool.query(`UPDATE daf_grants SET status='approved', granted_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    // Deduct from fund balance
    await pool.query(`UPDATE donor_advised_funds SET current_balance=current_balance-$1, total_granted=total_granted+$1 WHERE id=$2`, [grant.rows[0].amount, grant.rows[0].fund_id]);
    await audit(req, 'approve_grant', 'daf_grants', r.rows[0].id);
    // Notify advisor
    if (fund.rows[0].advisor_email) {
      try { await sendEmail(fund.rows[0].advisor_email, 'DAF Grant Approved', `Dear ${fund.rows[0].advisor_name},\n\nYour grant recommendation has been approved:\n\nGrant To: ${grant.rows[0].grant_to}\nAmount: $${Number(grant.rows[0].amount).toLocaleString()}\nPurpose: ${grant.rows[0].purpose || 'N/A'}\n\nRemaining Balance: $${Number(Number(fund.rows[0].current_balance) - Number(grant.rows[0].amount)).toLocaleString()}`); } catch(e) {}
    }
    res.json(r.rows[0]);
  }));

  // Reject grant
  app.put('/api/daf/grants/:id/reject', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE daf_grants SET status='rejected' WHERE tenant_id=$1 AND id=$2 RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Grant not found' });
    await audit(req, 'reject_grant', 'daf_grants', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // DAF statistics
  app.get('/api/daf/stats', requireAuth, ah(async (req, res) => {
    const funds = await pool.query(`SELECT COUNT(*) as total_funds, COALESCE(SUM(initial_contribution),0) as total_contributions, COALESCE(SUM(current_balance),0) as total_balance, COALESCE(SUM(total_granted),0) as total_granted FROM donor_advised_funds WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    const grants = await pool.query(`SELECT COUNT(*) as total_grants, COUNT(CASE WHEN status='pending' THEN 1 END) as pending, COUNT(CASE WHEN status='approved' THEN 1 END) as approved, COUNT(CASE WHEN status='rejected' THEN 1 END) as rejected, COALESCE(SUM(CASE WHEN status IN ('approved','disbursed') THEN amount ELSE 0 END),0) as total_disbursed FROM daf_grants WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    res.json({ ...funds.rows[0], ...grants.rows[0] });
  }));

  // DAF UI page
  app.get('/daf', requireAuth, ah(async (req, res) => {
    const funds = await pool.query(`SELECT * FROM donor_advised_funds WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    const stats = await pool.query(`SELECT COUNT(*) as total_funds, COALESCE(SUM(initial_contribution),0) as total_contributions, COALESCE(SUM(current_balance),0) as total_balance, COALESCE(SUM(total_granted),0) as total_granted FROM donor_advised_funds WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    const recentGrants = await pool.query(`SELECT dg.*, daf.fund_name FROM daf_grants dg JOIN donor_advised_funds daf ON dg.fund_id=daf.id WHERE dg.tenant_id=$1 ORDER BY dg.created_at DESC LIMIT 15`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Donor Advised Funds', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Donor Advised Funds (DAF)</h2>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Funds</div><div class="text-2xl font-bold">${stats.rows[0]?.total_funds || 0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Contributions</div><div class="text-2xl font-bold">$${Number(stats.rows[0]?.total_contributions || 0).toLocaleString()}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Current Balance</div><div class="text-2xl font-bold text-green-600">$${Number(stats.rows[0]?.total_balance || 0).toLocaleString()}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Granted</div><div class="text-2xl font-bold text-blue-600">$${Number(stats.rows[0]?.total_granted || 0).toLocaleString()}</div></div>
        </div>
        <div class="bg-white p-4 rounded-lg shadow mb-6">
          <h3 class="font-semibold mb-2">Funds</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            ${funds.rows.map(f => `<div class="border rounded p-3">
              <div class="flex justify-between"><span class="font-medium">${f.fund_name}</span><span class="px-2 py-0.5 rounded text-xs ${f.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}">${f.status}</span></div>
              <div class="text-xs text-gray-500">Advisor: ${f.advisor_name}${f.advisor_email ? ' | ' + f.advisor_email : ''}</div>
              <div class="mt-2 flex gap-4 text-sm"><span>Contributed: $${Number(f.initial_contribution).toLocaleString()}</span><span>Balance: $${Number(f.current_balance).toLocaleString()}</span><span>Granted: $${Number(f.total_granted).toLocaleString()}</span></div>
            </div>`).join('')}
          </div>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <h3 class="font-semibold p-4 pb-0">Recent Grants</h3>
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">ID</th><th class="p-3 text-left">Fund</th><th class="p-3 text-left">Grant To</th><th class="p-3 text-left">Purpose</th><th class="p-3 text-left">Amount</th><th class="p-3 text-left">Status</th><th class="p-3 text-left">Date</th></tr></thead>
            <tbody>${recentGrants.rows.map(g => `<tr class="border-t"><td class="p-3">${g.id}</td><td class="p-3">${g.fund_name}</td><td class="p-3">${g.grant_to}</td><td class="p-3">${g.purpose || '-'}</td><td class="p-3">$${Number(g.amount).toLocaleString()}</td><td class="p-3"><span class="px-2 py-0.5 rounded text-xs ${g.status === 'approved' ? 'bg-green-100 text-green-700' : g.status === 'rejected' ? 'bg-red-100 text-red-700' : g.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}">${g.status}</span></td><td class="p-3">${new Date(g.created_at).toLocaleDateString()}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

  // =============================================
  // DASHBOARD NAVIGATION & SIMPLE DASHBOARDS
  // =============================================
  const navLinks = `
    <nav class="bg-white shadow mb-6 p-4 rounded-lg flex flex-wrap gap-2">
      <a href="/crypto-donate" class="px-3 py-1 bg-amber-100 text-amber-800 rounded hover:bg-amber-200">Crypto</a>
      <a href="/inkind-donations" class="px-3 py-1 bg-emerald-100 text-emerald-800 rounded hover:bg-emerald-200">In-Kind</a>
      <a href="/planned-giving" class="px-3 py-1 bg-purple-100 text-purple-800 rounded hover:bg-purple-200">Planned Giving</a>
      <a href="/board-giving" class="px-3 py-1 bg-blue-100 text-blue-800 rounded hover:bg-blue-200">Board Giving</a>
      <a href="/event-tickets" class="px-3 py-1 bg-rose-100 text-rose-800 rounded hover:bg-rose-200">Tickets</a>
      <a href="/auction" class="px-3 py-1 bg-orange-100 text-orange-800 rounded hover:bg-orange-200">Auction</a>
      <a href="/sponsorships" class="px-3 py-1 bg-teal-100 text-teal-800 rounded hover:bg-teal-200">Sponsorships</a>
      <a href="/daf" class="px-3 py-1 bg-cyan-100 text-cyan-800 rounded hover:bg-cyan-200">DAF</a>
    </nav>`;

  console.log('[FundraisingUltimate7] Loaded — 8 features, 70+ routes');
};
