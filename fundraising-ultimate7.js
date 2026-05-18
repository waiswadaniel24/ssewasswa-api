/**
 * Fundraising Ultimate7 — Advanced Donation Types & Events
 * Crypto, In-Kind, Planned Giving, Board Giving, Event Ticketing,
 * Auction Platform, Sponsorship Management, Donor Advised Funds
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const migrations = [
    `CREATE TABLE IF NOT EXISTS crypto_wallets (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, wallet_address TEXT NOT NULL, network TEXT NOT NULL, label TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS crypto_donations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, wallet_id INTEGER REFERENCES crypto_wallets(id), donor_name TEXT, donor_email TEXT, crypto_amount NUMERIC, crypto_currency TEXT, usd_value_at_time NUMERIC, tx_hash TEXT, status TEXT DEFAULT 'pending', confirmed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS crypto_transactions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donation_id INTEGER, tx_hash TEXT, from_address TEXT, to_address TEXT, amount NUMERIC, currency TEXT, block_number TEXT, confirmed BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_crypto_wallets_tenant ON crypto_wallets(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_crypto_donations_tenant ON crypto_donations(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS inkind_categories (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, icon TEXT)`,
    `CREATE TABLE IF NOT EXISTS inkind_donations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, donor_name TEXT, donor_email TEXT, donor_phone TEXT, category_id INTEGER REFERENCES inkind_categories(id), item_name TEXT NOT NULL, item_description TEXT, estimated_value NUMERIC, quantity INTEGER DEFAULT 1, condition TEXT DEFAULT 'good', received_date DATE, acknowledged BOOLEAN DEFAULT false, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_inkind_cat_tenant ON inkind_categories(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_inkind_don_tenant ON inkind_donations(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS planned_giving (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_name TEXT, donor_email TEXT, donor_phone TEXT, giving_type TEXT DEFAULT 'will' CHECK(giving_type IN ('will','trust','insurance','annuity','other')), description TEXT, estimated_value NUMERIC, expected_date DATE, attorney_name TEXT, attorney_contact TEXT, status TEXT DEFAULT 'active', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS bequests (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, planned_giving_id INTEGER REFERENCES planned_giving(id), bequest_type TEXT, description TEXT, amount NUMERIC, beneficiary TEXT, received_date DATE, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_planned_giving_tenant ON planned_giving(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS board_members (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, role TEXT DEFAULT 'member', term_start DATE, term_end DATE, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS board_giving_pledges (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, board_member_id INTEGER REFERENCES board_members(id), campaign_id INTEGER, amount_pledged NUMERIC, amount_paid NUMERIC DEFAULT 0, fiscal_year TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_board_members_tenant ON board_members(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS ticket_tiers (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, event_name TEXT NOT NULL, tier_name TEXT NOT NULL, price NUMERIC NOT NULL, quantity_available INTEGER, quantity_sold INTEGER DEFAULT 0, description TEXT, perks TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ticket_purchases (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, tier_id INTEGER REFERENCES ticket_tiers(id), buyer_name TEXT NOT NULL, buyer_email TEXT, buyer_phone TEXT, quantity INTEGER DEFAULT 1, total_amount NUMERIC, payment_method TEXT, payment_status TEXT DEFAULT 'pending', qr_code TEXT, checked_in BOOLEAN DEFAULT false, checked_in_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_ticket_tiers_tenant ON ticket_tiers(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ticket_purchases_tenant ON ticket_purchases(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS auction_items (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, event_name TEXT, item_name TEXT NOT NULL, item_description TEXT, starting_bid NUMERIC, current_bid NUMERIC, bid_increment NUMERIC DEFAULT 10000, buy_now_price NUMERIC, image_url TEXT, donor_name TEXT, category TEXT, status TEXT DEFAULT 'open', auction_start TIMESTAMPTZ, auction_end TIMESTAMPTZ, winner_id INTEGER, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS auction_bids (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, item_id INTEGER REFERENCES auction_items(id), bidder_name TEXT, bidder_email TEXT, bidder_phone TEXT, amount NUMERIC NOT NULL, is_winning BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_auction_items_tenant ON auction_items(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_auction_bids_tenant ON auction_bids(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS sponsorship_packages (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, event_name TEXT, package_name TEXT NOT NULL, price NUMERIC NOT NULL, benefits_json TEXT DEFAULT '[]', quantity_available INTEGER, quantity_sold INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS sponsorship_purchases (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, package_id INTEGER REFERENCES sponsorship_packages(id), sponsor_name TEXT NOT NULL, sponsor_email TEXT, sponsor_phone TEXT, company TEXT, amount NUMERIC, payment_status TEXT DEFAULT 'pending', fulfillment_status TEXT DEFAULT 'pending', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_sponsor_pkg_tenant ON sponsorship_packages(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS donor_advised_funds (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, fund_name TEXT NOT NULL, advisor_name TEXT, advisor_email TEXT, advisor_phone TEXT, initial_contribution NUMERIC DEFAULT 0, current_balance NUMERIC DEFAULT 0, total_granted NUMERIC DEFAULT 0, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS daf_grants (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, fund_id INTEGER REFERENCES donor_advised_funds(id), grant_to TEXT NOT NULL, purpose TEXT, amount NUMERIC NOT NULL, status TEXT DEFAULT 'pending', granted_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_daf_tenant ON donor_advised_funds(tenant_id)`,
    // Seeds)
    `INSERT INTO crypto_wallets (tenant_id, wallet_address, network, label) SELECT t.id, 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', 'bitcoin', 'Bitcoin Wallet' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM crypto_wallets WHERE tenant_id=t.id AND network='bitcoin')`,
    `INSERT INTO crypto_wallets (tenant_id, wallet_address, network, label) SELECT t.id, '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', 'ethereum', 'Ethereum Wallet' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM crypto_wallets WHERE tenant_id=t.id AND network='ethereum')`,
    `INSERT INTO inkind_categories (tenant_id, name, description, icon) SELECT t.id, 'Clothing', 'Clothes, shoes, textiles', 'shirt' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM inkind_categories WHERE tenant_id=t.id AND name='Clothing')`,
    `INSERT INTO inkind_categories (tenant_id, name, description, icon) SELECT t.id, 'Food', 'Non-perishable food items', 'utensils' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM inkind_categories WHERE tenant_id=t.id AND name='Food')`,
    `INSERT INTO inkind_categories (tenant_id, name, description, icon) SELECT t.id, 'Equipment', 'Office, school, or medical equipment', 'wrench' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM inkind_categories WHERE tenant_id=t.id AND name='Equipment')`,
    `INSERT INTO inkind_categories (tenant_id, name, description, icon) SELECT t.id, 'Books', 'Textbooks and reading materials', 'book' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM inkind_categories WHERE tenant_id=t.id AND name='Books')`,
    `INSERT INTO inkind_categories (tenant_id, name, description, icon) SELECT t.id, 'Medical Supplies', 'First aid, medicine, medical equipment', 'heart-pulse' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM inkind_categories WHERE tenant_id=t.id AND name='Medical Supplies')`,
  ];
  (async () => { for (const q of migrations) { try { await pool.query(q); } catch(e){} } console.log('[FundraisingUltimate7] Migrations complete — 8 features'); })();

  // FEATURE 1: CRYPTO DONATIONS
  app.get('/api/crypto-wallets', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM crypto_wallets WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.post('/api/crypto-wallets', requireAuth, ah(async (req, res) => {
    const { wallet_address, network, label } = req.body;
    if (!wallet_address || !network) return res.status(400).json({ error: 'wallet_address and network required' });
    const r = await pool.query('INSERT INTO crypto_wallets (tenant_id, wallet_address, network, label) VALUES ($1,$2,$3,$4) RETURNING *', [req.session.user.tenant_id, esc(wallet_address), esc(network), esc(label||'')]);
    await audit(req.session.user.email, 'create', 'crypto_wallets id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/crypto-wallets/:id', requireAuth, ah(async (req, res) => {
    const { label, is_active } = req.body;
    const r = await pool.query('UPDATE crypto_wallets SET label=COALESCE($1,label), is_active=COALESCE($2,is_active) WHERE tenant_id=$3 AND id=$4 RETURNING *', [label?esc(label):null, is_active, req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));
  app.delete('/api/crypto-wallets/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM crypto_wallets WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'crypto_wallets id=' + req.params.id); res.json({ ok: true });
  }));
  app.get('/api/crypto-donations', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM crypto_donations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.post('/api/crypto-donations', requireAuth, ah(async (req, res) => {
    const { campaign_id, wallet_id, donor_name, donor_email, crypto_amount, crypto_currency, usd_value, tx_hash } = req.body;
    const r = await pool.query('INSERT INTO crypto_donations (tenant_id,campaign_id,wallet_id,donor_name,donor_email,crypto_amount,crypto_currency,usd_value_at_time,tx_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [req.session.user.tenant_id, campaign_id||null, wallet_id||null, esc(donor_name||''), esc(donor_email||''), crypto_amount||0, esc(crypto_currency||'BTC'), usd_value||0, esc(tx_hash||'')]);
    await audit(req.session.user.email, 'create', 'crypto_donations id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.post('/api/crypto-donations/:id/confirm', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE crypto_donations SET status=$1, confirmed_at=NOW() WHERE tenant_id=$2 AND id=$3 RETURNING *', ['confirmed', req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'crypto_donations id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.get('/crypto-donate', requireAuth, ah(async (req, res) => {
    const wallets = await pool.query('SELECT * FROM crypto_wallets WHERE tenant_id=$1 AND is_active=true', [req.session.user.tenant_id]);
    const donations = await pool.query('SELECT * FROM crypto_donations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20', [req.session.user.tenant_id]);
    renderPage(req, res, 'Crypto Donations', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Crypto Donations</h1><div class="grid grid-cols-1 md:grid-cols-2 gap-6"><div class="bg-white rounded-lg shadow p-6"><h2 class="text-lg font-semibold mb-4">Wallets</h2><a href="/api/crypto-wallets" class="text-emerald-600">API: /api/crypto-wallets</a></div><div class="bg-white rounded-lg shadow p-6"><h2 class="text-lg font-semibold mb-4">Recent Donations</h2><p>${donations.rows.length} crypto donations</p></div></div></div>`);
  }));

  // FEATURE 2: IN-KIND DONATIONS
  app.get('/api/inkind-categories', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM inkind_categories WHERE tenant_id=$1 ORDER BY name', [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.post('/api/inkind-categories', requireAuth, ah(async (req, res) => {
    const { name, description, icon } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query('INSERT INTO inkind_categories (tenant_id,name,description,icon) VALUES ($1,$2,$3,$4) RETURNING *', [req.session.user.tenant_id, esc(name), esc(description||''), esc(icon||'')]);
    await audit(req.session.user.email, 'create', 'inkind_categories id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/inkind-categories/:id', requireAuth, ah(async (req, res) => {
    const { name, description } = req.body;
    const r = await pool.query('UPDATE inkind_categories SET name=COALESCE($1,name), description=COALESCE($2,description) WHERE tenant_id=$3 AND id=$4 RETURNING *', [name?esc(name):null, description?esc(description):null, req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));
  app.delete('/api/inkind-categories/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM inkind_categories WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'inkind_categories id=' + req.params.id); res.json({ ok: true });
  }));
  app.get('/api/inkind-donations', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT d.*, c.name as category_name FROM inkind_donations d LEFT JOIN inkind_categories c ON d.category_id=c.id WHERE d.tenant_id=$1 ORDER BY d.created_at DESC LIMIT 50', [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.post('/api/inkind-donations', requireAuth, ah(async (req, res) => {
    const { campaign_id, donor_name, donor_email, donor_phone, category_id, item_name, item_description, estimated_value, quantity, condition, notes } = req.body;
    if (!item_name) return res.status(400).json({ error: 'item_name required' });
    const r = await pool.query('INSERT INTO inkind_donations (tenant_id,campaign_id,donor_name,donor_email,donor_phone,category_id,item_name,item_description,estimated_value,quantity,condition,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *', [req.session.user.tenant_id, campaign_id||null, esc(donor_name||''), esc(donor_email||''), esc(donor_phone||''), category_id||null, esc(item_name), esc(item_description||''), estimated_value||0, quantity||1, esc(condition||'good'), esc(notes||'')]);
    await audit(req.session.user.email, 'create', 'inkind_donations id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/inkind-donations/:id', requireAuth, ah(async (req, res) => {
    const { item_name, estimated_value, notes } = req.body;
    const r = await pool.query('UPDATE inkind_donations SET item_name=COALESCE($1,item_name), estimated_value=COALESCE($2,estimated_value), notes=COALESCE($3,notes) WHERE tenant_id=$4 AND id=$5 RETURNING *', [item_name?esc(item_name):null, estimated_value||null, notes?esc(notes):null, req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));
  app.put('/api/inkind-donations/:id/acknowledge', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE inkind_donations SET acknowledged=true WHERE tenant_id=$1 AND id=$2 RETURNING *', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'inkind_donations id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.get('/api/inkind-donations/summary', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT COUNT(*) as total_items, SUM(estimated_value) as total_value, COUNT(CASE WHEN acknowledged THEN 1 END) as acknowledged FROM inkind_donations WHERE tenant_id=$1', [req.session.user.tenant_id]);
    res.json(r.rows[0]);
  }));
  app.get('/inkind-donations', requireAuth, ah(async (req, res) => {
    const cats = await pool.query('SELECT * FROM inkind_categories WHERE tenant_id=$1', [req.session.user.tenant_id]);
    const donations = await pool.query('SELECT * FROM inkind_donations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20', [req.session.user.tenant_id]);
    renderPage(req, res, 'In-Kind Donations', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">In-Kind Donations</h1><div class="grid grid-cols-1 md:grid-cols-3 gap-4"><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">${cats.rows.length} Categories</h3></div><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">${donations.rows.length} Donations</h3></div></div></div>`);
  }));

  // FEATURE 3: PLANNED GIVING / BEQUESTS
  app.get('/api/planned-giving', requireAuth, ah(async (req, res) => { const r = await pool.query('SELECT * FROM planned_giving WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]); res.json(r.rows); }));
  app.post('/api/planned-giving', requireAuth, ah(async (req, res) => {
    const { donor_name, donor_email, donor_phone, giving_type, description, estimated_value, expected_date, attorney_name, attorney_contact, notes } = req.body;
    const r = await pool.query('INSERT INTO planned_giving (tenant_id,donor_name,donor_email,donor_phone,giving_type,description,estimated_value,expected_date,attorney_name,attorney_contact,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *', [req.session.user.tenant_id, esc(donor_name||''), esc(donor_email||''), esc(donor_phone||''), giving_type||'will', esc(description||''), estimated_value||0, expected_date||null, esc(attorney_name||''), esc(attorney_contact||''), esc(notes||'')]);
    await audit(req.session.user.email, 'create', 'planned_giving id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/planned-giving/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE planned_giving SET donor_name=COALESCE($1,donor_name), estimated_value=COALESCE($2,estimated_value), status=COALESCE($3,status) WHERE tenant_id=$4 AND id=$5 RETURNING *', [req.body.donor_name?esc(req.body.donor_name):null, req.body.estimated_value||null, req.body.status||null, req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));
  app.delete('/api/planned-giving/:id', requireAuth, ah(async (req, res) => { await pool.query('DELETE FROM planned_giving WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]); await audit(req.session.user.email, 'delete', 'planned_giving id=' + req.params.id); res.json({ ok: true }); }));
  app.post('/api/planned-giving/:id/bequest', requireAuth, ah(async (req, res) => {
    const { bequest_type, description, amount, beneficiary } = req.body;
    const r = await pool.query('INSERT INTO bequests (tenant_id,planned_giving_id,bequest_type,description,amount,beneficiary) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [req.session.user.tenant_id, req.params.id, esc(bequest_type||''), esc(description||''), amount||0, esc(beneficiary||'')]);
    await audit(req.session.user.email, 'create', 'bequests id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.get('/api/planned-giving/:id/bequests', requireAuth, ah(async (req, res) => { const r = await pool.query('SELECT * FROM bequests WHERE tenant_id=$1 AND planned_giving_id=$2', [req.session.user.tenant_id, req.params.id]); res.json(r.rows); }));
  app.put('/api/planned-giving/:id/realize', requireAuth, ah(async (req, res) => { const r = await pool.query('UPDATE planned_giving SET status=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *', ['realized', req.session.user.tenant_id, req.params.id]); await audit(req.session.user.email, 'update', 'planned_giving id=' + req.params.id); res.json(r.rows[0]); }));
  app.get('/api/planned-giving/stats', requireAuth, ah(async (req, res) => { const r = await pool.query('SELECT COUNT(*) as total, SUM(estimated_value) as total_value, COUNT(CASE WHEN status=$1 THEN 1 END) as realized FROM planned_giving WHERE tenant_id=$2', ['realized', req.session.user.tenant_id]); res.json(r.rows[0]); }));
  app.get('/planned-giving', requireAuth, ah(async (req, res) => { renderPage(req, res, 'Planned Giving', '<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Planned Giving & Bequests</h1><p>API: /api/planned-giving</p></div>'); }));

  // FEATURE 4: BOARD GIVING
  app.get('/api/board-members', requireAuth, ah(async (req, res) => { const r = await pool.query('SELECT * FROM board_members WHERE tenant_id=$1 ORDER BY name', [req.session.user.tenant_id]); res.json(r.rows); }));
  app.post('/api/board-members', requireAuth, ah(async (req, res) => {
    const { name, email, phone, role, term_start, term_end } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query('INSERT INTO board_members (tenant_id,name,email,phone,role,term_start,term_end) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [req.session.user.tenant_id, esc(name), esc(email||''), esc(phone||''), esc(role||'member'), term_start||null, term_end||null]);
    await audit(req.session.user.email, 'create', 'board_members id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/board-members/:id', requireAuth, ah(async (req, res) => {
    const { name, email, role, is_active } = req.body;
    const r = await pool.query('UPDATE board_members SET name=COALESCE($1,name), email=COALESCE($2,email), role=COALESCE($3,role), is_active=COALESCE($4,is_active) WHERE tenant_id=$5 AND id=$6 RETURNING *', [name?esc(name):null, email?esc(email):null, role?esc(role):null, is_active, req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));
  app.delete('/api/board-members/:id', requireAuth, ah(async (req, res) => { await pool.query('DELETE FROM board_members WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]); await audit(req.session.user.email, 'delete', 'board_members id=' + req.params.id); res.json({ ok: true }); }));
  app.get('/api/board-giving', requireAuth, ah(async (req, res) => { const r = await pool.query('SELECT p.*, m.name as member_name FROM board_giving_pledges p JOIN board_members m ON p.board_member_id=m.id WHERE p.tenant_id=$1 ORDER BY p.created_at DESC', [req.session.user.tenant_id]); res.json(r.rows); }));
  app.post('/api/board-giving', requireAuth, ah(async (req, res) => {
    const { board_member_id, campaign_id, amount_pledged, fiscal_year } = req.body;
    const r = await pool.query('INSERT INTO board_giving_pledges (tenant_id,board_member_id,campaign_id,amount_pledged,fiscal_year) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.session.user.tenant_id, board_member_id, campaign_id||null, amount_pledged||0, esc(fiscal_year||'2025')]);
    await audit(req.session.user.email, 'create', 'board_giving_pledges id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/board-giving/:id', requireAuth, ah(async (req, res) => { const { amount_pledged, status } = req.body; const r = await pool.query('UPDATE board_giving_pledges SET amount_pledged=COALESCE($1,amount_pledged), status=COALESCE($2,status) WHERE tenant_id=$3 AND id=$4 RETURNING *', [amount_pledged||null, status||null, req.session.user.tenant_id, req.params.id]); res.json(r.rows[0]); }));
  app.post('/api/board-giving/:id/pay', requireAuth, ah(async (req, res) => {
    const { amount } = req.body;
    const r = await pool.query('UPDATE board_giving_pledges SET amount_paid=amount_paid+$1 WHERE tenant_id=$2 AND id=$3 RETURNING *', [amount||0, req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'board_giving_pledges id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.get('/api/board-giving/participation', requireAuth, ah(async (req, res) => {
    const members = await pool.query('SELECT COUNT(*) as total FROM board_members WHERE tenant_id=$1 AND is_active=true', [req.session.user.tenant_id]);
    const giving = await pool.query('SELECT COUNT(DISTINCT board_member_id) as giving FROM board_giving_pledges WHERE tenant_id=$1 AND amount_paid > 0', [req.session.user.tenant_id]);
    const total = parseInt(members.rows[0]?.total||0), gave = parseInt(giving.rows[0]?.giving||0);
    res.json({ total_members: total, members_gave: gave, participation_rate: total > 0 ? ((gave/total)*100).toFixed(1) : 0 });
  }));
  app.get('/board-giving', requireAuth, ah(async (req, res) => { renderPage(req, res, 'Board Giving', '<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Board Giving Tracker</h1><p>API: /api/board-members, /api/board-giving</p></div>'); }));

  // FEATURE 5: EVENT TICKETING
  app.get('/api/ticket-tiers', requireAuth, ah(async (req, res) => { const r = await pool.query('SELECT * FROM ticket_tiers WHERE tenant_id=$1 ORDER BY price', [req.session.user.tenant_id]); res.json(r.rows); }));
  app.post('/api/ticket-tiers', requireAuth, ah(async (req, res) => {
    const { event_name, tier_name, price, quantity_available, description, perks } = req.body;
    if (!tier_name || !price) return res.status(400).json({ error: 'tier_name and price required' });
    const r = await pool.query('INSERT INTO ticket_tiers (tenant_id,event_name,tier_name,price,quantity_available,description,perks) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [req.session.user.tenant_id, esc(event_name||''), esc(tier_name), price, quantity_available||100, esc(description||''), esc(perks||'')]);
    await audit(req.session.user.email, 'create', 'ticket_tiers id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/ticket-tiers/:id', requireAuth, ah(async (req, res) => { const r = await pool.query('UPDATE ticket_tiers SET tier_name=COALESCE($1,tier_name), price=COALESCE($2,price), is_active=COALESCE($3,is_active) WHERE tenant_id=$4 AND id=$5 RETURNING *', [req.body.tier_name?esc(req.body.tier_name):null, req.body.price||null, req.body.is_active, req.session.user.tenant_id, req.params.id]); res.json(r.rows[0]); }));
  app.delete('/api/ticket-tiers/:id', requireAuth, ah(async (req, res) => { await pool.query('DELETE FROM ticket_tiers WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]); await audit(req.session.user.email, 'delete', 'ticket_tiers id=' + req.params.id); res.json({ ok: true }); }));
  app.get('/api/ticket-purchases', requireAuth, ah(async (req, res) => { const r = await pool.query('SELECT p.*, t.tier_name, t.event_name FROM ticket_purchases p JOIN ticket_tiers t ON p.tier_id=t.id WHERE p.tenant_id=$1 ORDER BY p.created_at DESC LIMIT 50', [req.session.user.tenant_id]); res.json(r.rows); }));
  app.post('/api/ticket-purchases', requireAuth, ah(async (req, res) => {
    const { tier_id, buyer_name, buyer_email, buyer_phone, quantity, payment_method } = req.body;
    const qty = quantity || 1;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tier = await client.query('SELECT * FROM ticket_tiers WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [req.session.user.tenant_id, tier_id]);
      if (!tier.rows.length) { await client.query('ROLLBACK'); client.release(); return res.status(404).json({ error: 'Tier not found' }); }
      if (parseFloat(tier.rows[0].quantity_sold) + qty > parseFloat(tier.rows[0].quantity_available)) { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'Not enough tickets available' }); }
      const total = qty * parseFloat(tier.rows[0].price);
      const qr = 'TKT-' + Math.random().toString(36).substring(2,10);
      const r = await client.query('INSERT INTO ticket_purchases (tenant_id,tier_id,buyer_name,buyer_email,buyer_phone,quantity,total_amount,payment_method,qr_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [req.session.user.tenant_id, tier_id, esc(buyer_name||''), esc(buyer_email||''), esc(buyer_phone||''), qty, total, esc(payment_method||'online'), qr]);
      await client.query('UPDATE ticket_tiers SET quantity_sold=quantity_sold+$1 WHERE id=$2 AND tenant_id=$3', [qty, tier_id, req.session.user.tenant_id]);
      await client.query('COMMIT');
      client.release();
      await audit(req.session.user.email, 'create', 'ticket_purchases id=' + r.rows[0].id); res.json(r.rows[0]);
    } catch(e) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      return res.status(500).json({ error: e.message });
    }
  }));
  app.post('/api/ticket-purchases/:id/checkin', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE ticket_purchases SET checked_in=true, checked_in_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'ticket_purchases id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.get('/event-tickets', requireAuth, ah(async (req, res) => { renderPage(req, res, 'Event Tickets', '<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Event Ticketing</h1><p>API: /api/ticket-tiers, /api/ticket-purchases</p></div>'); }));

  // FEATURE 6: AUCTION PLATFORM
  app.get('/api/auction-items', requireAuth, ah(async (req, res) => { const r = await pool.query('SELECT * FROM auction_items WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]); res.json(r.rows); }));
  app.post('/api/auction-items', requireAuth, ah(async (req, res) => {
    const { event_name, item_name, item_description, starting_bid, bid_increment, buy_now_price, donor_name, category, auction_end } = req.body;
    if (!item_name) return res.status(400).json({ error: 'item_name required' });
    const r = await pool.query('INSERT INTO auction_items (tenant_id,event_name,item_name,item_description,starting_bid,current_bid,bid_increment,buy_now_price,donor_name,category,auction_end) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *', [req.session.user.tenant_id, esc(event_name||''), esc(item_name), esc(item_description||''), starting_bid||0, starting_bid||0, bid_increment||10000, buy_now_price||null, esc(donor_name||''), esc(category||''), auction_end||null]);
    await audit(req.session.user.email, 'create', 'auction_items id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/auction-items/:id', requireAuth, ah(async (req, res) => { const r = await pool.query('UPDATE auction_items SET item_name=COALESCE($1,item_name), status=COALESCE($2,status) WHERE tenant_id=$3 AND id=$4 RETURNING *', [req.body.item_name?esc(req.body.item_name):null, req.body.status||null, req.session.user.tenant_id, req.params.id]); res.json(r.rows[0]); }));
  app.delete('/api/auction-items/:id', requireAuth, ah(async (req, res) => { await pool.query('DELETE FROM auction_items WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]); await audit(req.session.user.email, 'delete', 'auction_items id=' + req.params.id); res.json({ ok: true }); }));
  app.post('/api/auction-items/:id/bid', requireAuth, ah(async (req, res) => {
    const { bidder_name, bidder_email, amount } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const item = await client.query('SELECT * FROM auction_items WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [req.session.user.tenant_id, req.params.id]);
      if (!item.rows.length) { await client.query('ROLLBACK'); client.release(); return res.status(404).json({ error: 'Item not found' }); }
      if (parseFloat(amount) <= parseFloat(item.rows[0].current_bid)) { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'Bid must exceed current bid' }); }
      await client.query('UPDATE auction_bids SET is_winning=false WHERE item_id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
      const r = await client.query('INSERT INTO auction_bids (tenant_id,item_id,bidder_name,bidder_email,amount,is_winning) VALUES ($1,$2,$3,$4,$5,true) RETURNING *', [req.session.user.tenant_id, req.params.id, esc(bidder_name||''), esc(bidder_email||''), amount]);
      await client.query('UPDATE auction_items SET current_bid=$1 WHERE id=$2 AND tenant_id=$3', [amount, req.params.id, req.session.user.tenant_id]);
      await client.query('COMMIT');
      client.release();
      await audit(req.session.user.email, 'create', 'auction_bids id=' + r.rows[0].id); res.json(r.rows[0]);
    } catch(e) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      return res.status(500).json({ error: e.message });
    }
  }));
  app.get('/api/auction-items/:id/bids', requireAuth, ah(async (req, res) => { const r = await pool.query('SELECT * FROM auction_bids WHERE tenant_id=$1 AND item_id=$2 ORDER BY amount DESC', [req.session.user.tenant_id, req.params.id]); res.json(r.rows); }));
  app.post('/api/auction-items/:id/buy-now', requireAuth, ah(async (req, res) => {
    const { bidder_name, bidder_email } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const item = await client.query('SELECT * FROM auction_items WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [req.session.user.tenant_id, req.params.id]);
      if (!item.rows.length || !item.rows[0].buy_now_price) { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'Buy now not available' }); }
      if (item.rows[0].status !== 'open' && item.rows[0].status !== 'active') { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'Item no longer available for purchase' }); }
      await client.query('UPDATE auction_items SET current_bid=buy_now_price, status=$1, winner_id=NULL WHERE id=$2 AND tenant_id=$3', ['sold', req.params.id, req.session.user.tenant_id]);
      await client.query('COMMIT');
      client.release();
      await audit(req.session.user.email, 'update', 'auction_items id=' + req.params.id); res.json({ message: 'Item purchased!', price: item.rows[0].buy_now_price });
    } catch(e) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      return res.status(500).json({ error: e.message });
    }
  }));
  app.post('/api/auction-items/:id/close', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE auction_items SET status=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *', ['closed', req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'auction_items id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.get('/auction', requireAuth, ah(async (req, res) => { renderPage(req, res, 'Auctions', '<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Auction Platform</h1><p>API: /api/auction-items, /api/auction-items/:id/bid</p></div>'); }));

  // FEATURE 7: SPONSORSHIP MANAGEMENT
  app.get('/api/sponsorship-packages', requireAuth, ah(async (req, res) => { const r = await pool.query('SELECT * FROM sponsorship_packages WHERE tenant_id=$1 ORDER BY price', [req.session.user.tenant_id]); res.json(r.rows); }));
  app.post('/api/sponsorship-packages', requireAuth, ah(async (req, res) => {
    const { event_name, package_name, price, benefits_json, quantity_available } = req.body;
    if (!package_name || !price) return res.status(400).json({ error: 'package_name and price required' });
    const r = await pool.query('INSERT INTO sponsorship_packages (tenant_id,event_name,package_name,price,benefits_json,quantity_available) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [req.session.user.tenant_id, esc(event_name||''), esc(package_name), price, JSON.stringify(benefits_json||[]), quantity_available||10]);
    await audit(req.session.user.email, 'create', 'sponsorship_packages id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/sponsorship-packages/:id', requireAuth, ah(async (req, res) => { const r = await pool.query('UPDATE sponsorship_packages SET package_name=COALESCE($1,package_name), price=COALESCE($2,price), is_active=COALESCE($3,is_active) WHERE tenant_id=$4 AND id=$5 RETURNING *', [req.body.package_name?esc(req.body.package_name):null, req.body.price||null, req.body.is_active, req.session.user.tenant_id, req.params.id]); res.json(r.rows[0]); }));
  app.delete('/api/sponsorship-packages/:id', requireAuth, ah(async (req, res) => { await pool.query('DELETE FROM sponsorship_packages WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]); await audit(req.session.user.email, 'delete', 'sponsorship_packages id=' + req.params.id); res.json({ ok: true }); }));
  app.get('/api/sponsorship-purchases', requireAuth, ah(async (req, res) => { const r = await pool.query('SELECT p.*, pkg.package_name, pkg.event_name FROM sponsorship_purchases p JOIN sponsorship_packages pkg ON p.package_id=pkg.id WHERE p.tenant_id=$1 ORDER BY p.created_at DESC', [req.session.user.tenant_id]); res.json(r.rows); }));
  app.post('/api/sponsorship-purchases', requireAuth, ah(async (req, res) => {
    const { package_id, sponsor_name, sponsor_email, sponsor_phone, company, amount, payment_method } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const pkg = await client.query('SELECT * FROM sponsorship_packages WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [req.session.user.tenant_id, package_id]);
      if (!pkg.rows.length) { await client.query('ROLLBACK'); client.release(); return res.status(404).json({ error: 'Package not found' }); }
      if (parseFloat(pkg.rows[0].quantity_sold) + 1 > parseFloat(pkg.rows[0].quantity_available)) { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'No sponsorship packages available' }); }
      const r = await client.query('INSERT INTO sponsorship_purchases (tenant_id,package_id,sponsor_name,sponsor_email,sponsor_phone,company,amount,payment_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [req.session.user.tenant_id, package_id, esc(sponsor_name||''), esc(sponsor_email||''), esc(sponsor_phone||''), esc(company||''), amount||0, 'pending']);
      await client.query('UPDATE sponsorship_packages SET quantity_sold=quantity_sold+1 WHERE id=$1 AND tenant_id=$2', [package_id, req.session.user.tenant_id]);
      await client.query('COMMIT');
      client.release();
      await audit(req.session.user.email, 'create', 'sponsorship_purchases id=' + r.rows[0].id); res.json(r.rows[0]);
    } catch(e) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      return res.status(500).json({ error: e.message });
    }
  }));
  app.put('/api/sponsorship-purchases/:id/fulfill', requireAuth, ah(async (req, res) => { const r = await pool.query('UPDATE sponsorship_purchases SET fulfillment_status=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *', ['fulfilled', req.session.user.tenant_id, req.params.id]); await audit(req.session.user.email, 'update', 'sponsorship_purchases id=' + req.params.id); res.json(r.rows[0]); }));
  app.get('/sponsorships', requireAuth, ah(async (req, res) => { renderPage(req, res, 'Sponsorships', '<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Sponsorship Management</h1><p>API: /api/sponsorship-packages, /api/sponsorship-purchases</p></div>'); }));

  // FEATURE 8: DONOR ADVISED FUNDS
  app.get('/api/daf', requireAuth, ah(async (req, res) => { const r = await pool.query('SELECT * FROM donor_advised_funds WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]); res.json(r.rows); }));
  app.post('/api/daf', requireAuth, ah(async (req, res) => {
    const { fund_name, advisor_name, advisor_email, advisor_phone, initial_contribution } = req.body;
    if (!fund_name) return res.status(400).json({ error: 'fund_name required' });
    const r = await pool.query('INSERT INTO donor_advised_funds (tenant_id,fund_name,advisor_name,advisor_email,advisor_phone,initial_contribution,current_balance) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *', [req.session.user.tenant_id, esc(fund_name), esc(advisor_name||''), esc(advisor_email||''), esc(advisor_phone||''), initial_contribution||0]);
    await audit(req.session.user.email, 'create', 'donor_advised_funds id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/daf/:id', requireAuth, ah(async (req, res) => { const r = await pool.query('UPDATE donor_advised_funds SET fund_name=COALESCE($1,fund_name), status=COALESCE($2,status) WHERE tenant_id=$3 AND id=$4 RETURNING *', [req.body.fund_name?esc(req.body.fund_name):null, req.body.status||null, req.session.user.tenant_id, req.params.id]); res.json(r.rows[0]); }));
  app.get('/api/daf/:id/grants', requireAuth, ah(async (req, res) => { const r = await pool.query('SELECT * FROM daf_grants WHERE tenant_id=$1 AND fund_id=$2 ORDER BY created_at DESC', [req.session.user.tenant_id, req.params.id]); res.json(r.rows); }));
  app.post('/api/daf/:id/grants', requireAuth, ah(async (req, res) => {
    const { grant_to, purpose, amount } = req.body;
    if (!grant_to || !amount) return res.status(400).json({ error: 'grant_to and amount required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const fund = await client.query('SELECT * FROM donor_advised_funds WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [req.session.user.tenant_id, req.params.id]);
      if (!fund.rows.length) { await client.query('ROLLBACK'); client.release(); return res.status(404).json({ error: 'Fund not found' }); }
      if (parseFloat(amount) > parseFloat(fund.rows[0].current_balance)) { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'Insufficient balance' }); }
      const r = await client.query('INSERT INTO daf_grants (tenant_id,fund_id,grant_to,purpose,amount) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.session.user.tenant_id, req.params.id, esc(grant_to), esc(purpose||''), amount]);
      await client.query('UPDATE donor_advised_funds SET current_balance=current_balance-$1, total_granted=total_granted+$1 WHERE id=$2 AND tenant_id=$3', [amount, req.params.id, req.session.user.tenant_id]);
      await client.query('COMMIT');
      client.release();
      await audit(req.session.user.email, 'create', 'daf_grants id=' + r.rows[0].id); res.json(r.rows[0]);
    } catch(e) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      return res.status(500).json({ error: e.message });
    }
  }));
  app.put('/api/daf/grants/:id/approve', requireAuth, ah(async (req, res) => { const r = await pool.query('UPDATE daf_grants SET status=$1, granted_at=NOW() WHERE tenant_id=$2 AND id=$3 RETURNING *', ['approved', req.session.user.tenant_id, req.params.id]); await audit(req.session.user.email, 'update', 'daf_grants id=' + req.params.id); res.json(r.rows[0]); }));
  app.put('/api/daf/grants/:id/reject', requireAuth, ah(async (req, res) => { const r = await pool.query('UPDATE daf_grants SET status=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *', ['rejected', req.session.user.tenant_id, req.params.id]); await audit(req.session.user.email, 'update', 'daf_grants id=' + req.params.id); res.json(r.rows[0]); }));
  app.get('/api/daf/stats', requireAuth, ah(async (req, res) => { const r = await pool.query('SELECT COUNT(*) as total_funds, SUM(current_balance) as total_balance, SUM(total_granted) as total_granted FROM donor_advised_funds WHERE tenant_id=$1', [req.session.user.tenant_id]); res.json(r.rows[0]); }));
  app.get('/daf', requireAuth, ah(async (req, res) => { renderPage(req, res, 'Donor Advised Funds', '<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Donor Advised Funds</h1><p>API: /api/daf</p></div>'); }));

  console.log('[FundraisingUltimate7] 8 features registered — Crypto, In-Kind, Planned Giving, Board Giving, Ticketing, Auctions, Sponsorships, DAF');
};
