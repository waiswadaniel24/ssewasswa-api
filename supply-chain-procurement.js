const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const C='#6366f1'; const CL='#818cf8'; const CBG='#eef2ff'; const CG='#059669'; const CR='#dc2626'; const CY='#d97706';

  async function initTables() {
    const tables = [
      `CREATE TABLE IF NOT EXISTS procurement_vendors (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, vendor_name VARCHAR(200), contact_person VARCHAR(150), email VARCHAR(150), phone VARCHAR(30), address TEXT, category VARCHAR(100), rating DECIMAL(3,2) DEFAULT 0, total_orders INT DEFAULT 0, total_spent DECIMAL(12,2) DEFAULT 0, status TEXT DEFAULT 'active', notes TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS procurement_requisitions (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, req_number VARCHAR(50) UNIQUE, requested_by INT, department VARCHAR(100), priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'draft', total_amount DECIMAL(12,2) DEFAULT 0, budget_code VARCHAR(50), justifications TEXT, approved_by INT, approved_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS procurement_requisition_items (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, requisition_id INT, item_name VARCHAR(200), description TEXT, quantity INT DEFAULT 1, unit VARCHAR(20), estimated_cost DECIMAL(10,2) DEFAULT 0, item_order INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS procurement_purchase_orders (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, po_number VARCHAR(50) UNIQUE, vendor_id INT, requisition_id INT, status TEXT DEFAULT 'draft', total_amount DECIMAL(12,2) DEFAULT 0, expected_date DATE, delivered_date DATE, payment_status TEXT DEFAULT 'unpaid', notes TEXT, created_by INT, approved_by INT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS procurement_po_items (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, po_id INT, item_name VARCHAR(200), quantity INT DEFAULT 1, unit_price DECIMAL(10,2) DEFAULT 0, total_price DECIMAL(10,2) DEFAULT 0, received_qty INT DEFAULT 0, item_order INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS procurement_rfq (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, rfq_number VARCHAR(50) UNIQUE, title VARCHAR(200), description TEXT, required_by DATE, status TEXT DEFAULT 'open', created_by INT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS procurement_rfq_quotes (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, rfq_id INT, vendor_id INT, quoted_amount DECIMAL(12,2) DEFAULT 0, delivery_days INT DEFAULT 0, validity_days INT DEFAULT 30, terms TEXT, status TEXT DEFAULT 'submitted', submitted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS procurement_contracts (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, vendor_id INT, contract_title VARCHAR(200), contract_type VARCHAR(50), start_date DATE, end_date DATE, total_value DECIMAL(12,2) DEFAULT 0, terms TEXT, renewal_reminder_days INT DEFAULT 30, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS procurement_budgets (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, department VARCHAR(100), budget_code VARCHAR(50), fiscal_year VARCHAR(10), total_budget DECIMAL(12,2) DEFAULT 0, committed DECIMAL(12,2) DEFAULT 0, spent DECIMAL(12,2) DEFAULT 0, remaining DECIMAL(12,2) GENERATED ALWAYS AS (total_budget - committed - spent) STORED, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, CONSTRAINT uk_dept_year UNIQUE (tenant_id, department, fiscal_year))`,
      `CREATE TABLE IF NOT EXISTS procurement_audit_log (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, action VARCHAR(50), entity_type VARCHAR(50), entity_id INT, user_id INT, old_values JSON, new_values JSON, ip_address VARCHAR(45), created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`
    ];
    for (const sql of tables) { try { await pool.query(sql); } catch(e) { console.warn('[Procurement] Table:', e.message); } }
  }
  initTables().catch(e => console.error('[Procurement] Migration init error:', e.message));

  // ─── Dashboard ────────────────────────────────────────────────────
  app.get('/school/procurement', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [reqs] = await pool.query('SELECT COUNT(*) as c, SUM(total_amount) as val FROM procurement_requisitions WHERE tenant_id=? AND status IN ("pending","approved")', [tid]);
    const [pos] = await pool.query('SELECT COUNT(*) as c, SUM(total_amount) as val FROM procurement_purchase_orders WHERE tenant_id=? AND status IN ("draft","sent","confirmed","partial")', [tid]);
    const [vendors] = await pool.query('SELECT COUNT(*) as c FROM procurement_vendors WHERE tenant_id=? AND status="active"', [tid]);
    const [rfqs] = await pool.query('SELECT COUNT(*) as c FROM procurement_rfq WHERE tenant_id=? AND status="open"', [tid]);
    const [budget] = await pool.query('SELECT SUM(total_budget) as total, SUM(committed) as committed, SUM(spent) as spent FROM procurement_budgets WHERE tenant_id=? AND fiscal_year=YEAR(CURDATE())', [tid]);
    res.send(renderPage('Procurement', `<div style="max-width:1200px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">📦 Supply Chain & Procurement</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px;margin-bottom:25px;">
        ${[{l:'Pending Requests',v:reqs[0].c,c:CY,sub:'$'+(reqs[0].val||0).toFixed(0)},{l:'Active POs',v:pos[0].c,c:C,sub:'$'+(pos[0].val||0).toFixed(0)},{l:'Active Vendors',v:vendors[0].c,c:CG},{l:'Open RFQs',v:rfqs[0].c,c:'#7c3aed'},{l:'Budget Utilization',v:budget[0].total?'$'+(budget[0].spent||0).toFixed(0):'$0',c:'#0891b2',sub:budget[0].total?'of $'+budget[0].total.toFixed(0):''}].map(s=>`<div style="background:${CBG};border-radius:12px;padding:20px;text-align:center;"><div style="font-size:1.8em;font-weight:bold;color:${s.c};">${s.v}</div><div style="color:#6b7280;font-size:0.9em;">${s.l}</div>${s.sub?`<div style="color:#9ca3af;font-size:0.75em;">${s.sub}</div>`:''}</div>`).join('')}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <a href="/school/procurement/requisitions/new" style="background:${CY};color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">+ New Requisition</a>
        <a href="/school/procurement/vendors" style="background:${C};color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">🏭 Vendors</a>
        <a href="/school/procurement/po" style="background:CG;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">📋 Purchase Orders</a>
        <a href="/school/procurement/rfq" style="background:#7c3aed;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">📋 RFQs</a>
        <a href="/school/procurement/budget" style="background:#0891b2;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">💰 Budget</a>
        <a href="/school/procurement/contracts" style="background:#be185d;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">📜 Contracts</a>
        <a href="/school/procurement/audit" style="background:#6b7280;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">🔍 Audit Log</a>
      </div>
    </div>`, req.session.user));
  }));

  // ─── Vendors ──────────────────────────────────────────────────────
  app.get('/school/procurement/vendors', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [vendors] = await pool.query('SELECT * FROM procurement_vendors WHERE tenant_id=? ORDER BY vendor_name', [tid]);
    res.send(renderPage('Vendors', `<div style="max-width:1200px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;"><h2 style="color:${C};">🏭 Vendors</h2><a href="/school/procurement/vendors/new" style="background:${C};color:white;text-decoration:none;padding:8px 16px;border-radius:8px;">+ Add Vendor</a></div>
      <table style="width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <thead><tr style="background:${CBG};"><th style="padding:12px;text-align:left;">Vendor</th><th>Contact</th><th>Category</th><th>Orders</th><th>Total Spent</th><th>Rating</th><th>Status</th></tr></thead>
        <tbody>${vendors.map(v=>`<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px;"><strong>${esc(v.vendor_name)}</strong></td><td style="padding:10px;font-size:0.85em;">${esc(v.contact_person)}<br>${esc(v.email||'')}<br>${esc(v.phone||'')}</td><td style="padding:10px;">${esc(v.category||'-')}</td><td style="padding:10px;">${v.total_orders}</td><td style="padding:10px;">$${(v.total_spent||0).toFixed(0)}</td><td style="padding:10px;">⭐ ${v.rating||'N/A'}</td><td style="padding:10px;color:${v.status==='active'?CG:v.status==='blacklisted'?CR:'#9ca3af'};">${v.status}</td></tr>`).join('')}</tbody>
      </table>
    </div>`, req.session.user));
  }));

  app.get('/school/procurement/vendors/new', requireAuth, ah(async (req, res) => {
    const categories = ['Stationery','Furniture','Electronics','Lab Supplies','Books','Cleaning','Food & Catering','IT Equipment','Sports','Maintenance','Uniforms','Transport','Other'];
    res.send(renderPage('Add Vendor', `<div style="max-width:700px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">🏭 Add Vendor</h2>
      <form method="POST" action="/school/procurement/vendors/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Vendor Name</label><input name="vendor_name" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Category</label><select name="category" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;">${categories.map(c=>`<option>${c}</option>`).join('')}</select></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Contact Person</label><input name="contact_person" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Email</label><input type="email" name="email" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Phone</label><input name="phone" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        </div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Address</label><textarea name="address" rows="2" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></textarea></div>
        <button type="submit" style="background:${C};color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Add Vendor</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/procurement/vendors/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const {vendor_name,contact_person,email,phone,address,category,notes,id} = req.body;
    if (id) {
      await pool.query('UPDATE procurement_vendors SET vendor_name=?,contact_person=?,email=?,phone=?,address=?,category=?,notes=? WHERE id=? AND tenant_id=?', [vendor_name,contact_person,email,phone,address,category,notes,id,tid]);
    } else {
      await pool.query('INSERT INTO procurement_vendors (tenant_id,vendor_name,contact_person,email,phone,address,category,notes) VALUES (?,?,?,?,?,?,?,?)', [tid,vendor_name,contact_person,email,phone,address,category,notes]);
    }
    res.redirect('/school/procurement/vendors');
  }));

  // ─── Requisitions ─────────────────────────────────────────────────
  app.get('/school/procurement/requisitions/new', requireAuth, ah(async (req, res) => {
    res.send(renderPage('New Requisition', `<div style="max-width:800px;margin:0 auto;padding:20px;">
      <h2 style="color:${CY};margin-bottom:20px;">📝 New Purchase Requisition</h2>
      <form method="POST" action="/school/procurement/requisitions/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Department</label><input name="department" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Priority</label><select name="priority" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"><option>low</option><option selected>medium</option><option>high</option><option>urgent</option></select></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Budget Code</label><input name="budget_code" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        </div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Justification</label><textarea name="justifications" rows="2" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></textarea></div>
        <h4 style="color:${C};margin:15px 0 10px;">Items</h4>
        <div id="items-container">
          <div style="display:grid;grid-template-columns:3fr 1fr 1fr 1fr auto;gap:10px;margin-bottom:10px;">
            <div><input name="item_name[]" placeholder="Item name" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;"></div>
            <div><input name="qty[]" type="number" value="1" min="1" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;"></div>
            <div><input name="unit[]" value="pcs" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;"></div>
            <div><input name="cost[]" type="number" step="0.01" placeholder="Unit cost" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;"></div>
          </div>
        </div>
        <button type="submit" style="background:${CY};color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Submit Requisition</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/procurement/requisitions/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const reqNum = 'REQ-' + Date.now().toString(36).toUpperCase();
    const items = Array.isArray(req.body.item_name) ? req.body.item_name : [req.body.item_name];
    const qtys = Array.isArray(req.body.qty) ? req.body.qty : [req.body.qty];
    const units = Array.isArray(req.body.unit) ? req.body.unit : [req.body.unit];
    const costs = Array.isArray(req.body.cost) ? req.body.cost : [req.body.cost];
    let total = 0;
    for (let i = 0; i < items.length; i++) { total += (parseFloat(qtys[i])||1) * (parseFloat(costs[i])||0); }
    const [result] = await pool.query('INSERT INTO procurement_requisitions (tenant_id,req_number,requested_by,department,priority,total_amount,budget_code,justifications,status) VALUES (?,?,"'+req.session.user.id+'",?,?,?,?,?,"pending")', [tid,reqNum,req.body.department,req.body.priority,total,req.body.budget_code,req.body.justifications]);
    for (let i = 0; i < items.length; i++) {
      if (items[i]) await pool.query('INSERT INTO procurement_requisition_items (tenant_id,requisition_id,item_name,description,quantity,unit,estimated_cost,item_order) VALUES (?,?,?,?,?,?,?,?)', [tid,result.insertId,items[i],'',qtys[i]||1,units[i]||'pcs',costs[i]||0,i]);
    }
    await pool.query('INSERT INTO procurement_audit_log (tenant_id,action,entity_type,entity_id,user_id,new_values) VALUES (?,"create","requisition",?,?,?)', [tid,req.session.user.id,req.session.user.id,JSON.stringify({req_number:reqNum,department:req.body.department,total:total})]);
    res.redirect('/school/procurement');
  }));

  // ─── Purchase Orders ──────────────────────────────────────────────
  app.get('/school/procurement/po', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [pos] = await pool.query('SELECT po.*, pv.vendor_name FROM procurement_purchase_orders po LEFT JOIN procurement_vendors pv ON pv.id=po.vendor_id WHERE po.tenant_id=? ORDER BY po.created_at DESC', [tid]);
    const sc = {draft:'#9ca3af',sent:CY,confirmed:'#3b82f6',partial:'#8b5cf6',delivered:CG,cancelled:CR};
    res.send(renderPage('Purchase Orders', `<div style="max-width:1200px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;"><h2 style="color:${C};">📋 Purchase Orders</h2></div>
      <div style="display:grid;gap:10px;">
        ${pos.map(p=>`<div style="background:white;border-radius:10px;padding:12px;border-left:4px solid ${sc[p.status]||'#9ca3af'};display:flex;justify-content:space-between;align-items:center;">
          <div><strong>${esc(p.po_number)}</strong> — ${esc(p.vendor_name||'No vendor')}<div style="color:#6b7280;font-size:0.8em;">$${(p.total_amount||0).toFixed(2)} • ${p.payment_status} payment • ${p.expected_date?'Expected: '+p.expected_date:''}</div></div>
          <span style="color:${sc[p.status]};font-weight:600;">${p.status}</span>
        </div>`).join('')||'<p style="color:#6b7280;">No purchase orders yet</p>'}
      </div>
    </div>`, req.session.user));
  }));

  // ─── RFQ ──────────────────────────────────────────────────────────
  app.get('/school/procurement/rfq', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [rfqs] = await pool.query('SELECT * FROM procurement_rfq WHERE tenant_id=? ORDER BY created_at DESC', [tid]);
    const sc = {open:CG,closed:'#9ca3af',awarded:'#ffd700',cancelled:CR};
    res.send(renderPage('RFQs', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;"><h2 style="color:#7c3aed;">📋 Requests for Quotation</h2><a href="/school/procurement/rfq/new" style="background:#7c3aed;color:white;text-decoration:none;padding:8px 16px;border-radius:8px;">+ New RFQ</a></div>
      <div style="display:grid;gap:10px;">
        ${rfqs.map(r=>`<div style="background:white;border-radius:10px;padding:12px;border:1px solid #e5e7eb;display:flex;justify-content:space-between;"><div><strong>${esc(r.rfq_number)}</strong> — ${esc(r.title)}<div style="color:#6b7280;font-size:0.8em;">${esc(r.description||'').substring(0,80)} • Required: ${r.required_date||'TBD'}</div></div><span style="color:${sc[r.status]};font-weight:600;">${r.status}</span></div>`).join('')||'<p style="color:#6b7280;">No RFQs</p>'}
      </div>
    </div>`, req.session.user));
  }));

  app.get('/school/procurement/rfq/new', requireAuth, ah(async (req, res) => {
    res.send(renderPage('New RFQ', `<div style="max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#7c3aed;margin-bottom:20px;">📋 New RFQ</h2>
      <form method="POST" action="/school/procurement/rfq/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Title</label><input name="title" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Description</label><textarea name="description" rows="3" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></textarea></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Required By</label><input type="date" name="required_by" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
        <button type="submit" style="background:#7c3aed;color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Create RFQ</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/procurement/rfq/save', requireAuth, ah(async (req, res) => {
    const rfqNum = 'RFQ-' + Date.now().toString(36).toUpperCase();
    await pool.query('INSERT INTO procurement_rfq (tenant_id,rfq_number,title,description,required_by,created_by) VALUES (?,?,?,?,?,?)', [req.session.user.tenant_id,rfqNum,req.body.title,req.body.description,req.body.required_by,req.session.user.id]);
    res.redirect('/school/procurement/rfq');
  }));

  // ─── Budget ───────────────────────────────────────────────────────
  app.get('/school/procurement/budget', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [budgets] = await pool.query('SELECT * FROM procurement_budgets WHERE tenant_id=? ORDER BY fiscal_year DESC, department', [tid]);
    res.send(renderPage('Budget', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <h2 style="color:#0891b2;margin-bottom:20px;">💰 Department Budgets</h2>
      <table style="width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <thead><tr style="background:${CBG};"><th style="padding:12px;text-align:left;">Department</th><th>Year</th><th>Total Budget</th><th>Committed</th><th>Spent</th><th>Remaining</th><th>Status</th></tr></thead>
        <tbody>${budgets.map(b=>{const pct=b.total_budget>0?((b.spent+b.committed)/b.total_budget*100).toFixed(0):0;const pc=pct>90?CR:pct>70?CY:CG;return `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px;"><strong>${esc(b.department)}</strong></td><td style="padding:10px;">${b.fiscal_year}</td><td style="padding:10px;">$${(b.total_budget||0).toFixed(0)}</td><td style="padding:10px;">$${(b.committed||0).toFixed(0)}</td><td style="padding:10px;">$${(b.spent||0).toFixed(0)}</td><td style="padding:10px;color:${pc};">$${(b.remaining||0).toFixed(0)}</td><td style="padding:10px;"><div style="background:#f3f4f6;border-radius:10px;height:8px;width:80px;"><div style="background:${pc};border-radius:10px;height:8px;width:${pct}%;"></div></div></td></tr>`;}).join('')||'<tr><td colspan="7" style="padding:20px;text-align:center;color:#9ca3af;">No budgets configured</td></tr>'}</tbody>
      </table>
    </div>`, req.session.user));
  }));

  // ─── Contracts ────────────────────────────────────────────────────
  app.get('/school/procurement/contracts', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [contracts] = await pool.query('SELECT pc.*, pv.vendor_name FROM procurement_contracts pc LEFT JOIN procurement_vendors pv ON pv.id=pc.vendor_id WHERE pc.tenant_id=? ORDER BY pc.end_date', [tid]);
    res.send(renderPage('Contracts', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <h2 style="color:#be185d;margin-bottom:20px;">📜 Vendor Contracts</h2>
      <div style="display:grid;gap:10px;">
        ${contracts.map(c=>`<div style="background:white;border-radius:10px;padding:12px;border:1px solid #e5e7eb;display:flex;justify-content:space-between;">
          <div><strong>${esc(c.contract_title)}</strong> — ${esc(c.vendor_name||'Unknown')}<div style="color:#6b7280;font-size:0.8em;">${c.contract_type} • $${(c.total_value||0).toFixed(0)} • ${c.start_date} → ${c.end_date}</div></div>
          <span style="color:${c.status==='active'?CG:c.status==='expired'?CR:'#9ca3af'};">${c.status}</span>
        </div>`).join('')||'<p style="color:#6b7280;">No contracts</p>'}
      </div>
    </div>`, req.session.user));
  }));

  // ─── Audit Log ────────────────────────────────────────────────────
  app.get('/school/procurement/audit', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [logs] = await pool.query('SELECT * FROM procurement_audit_log WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100', [tid]);
    res.send(renderPage('Audit Log', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <h2 style="color:#6b7280;margin-bottom:20px;">🔍 Procurement Audit Trail</h2>
      <div style="display:grid;gap:8px;">
        ${logs.map(l=>`<div style="background:white;border-radius:8px;padding:10px;border:1px solid #e5e7eb;font-size:0.85em;display:flex;gap:15px;"><span style="color:#9ca3af;min-width:130px;">${new Date(l.created_at).toLocaleString()}</span><span style="background:${CBG};color:${C};padding:2px 8px;border-radius:4px;">${l.action}</span><span style="color:#6b7280;">${l.entity_type} #${l.entity_id}</span><span>by User #${l.user_id}</span></div>`).join('')||'<p style="color:#9ca3af;">No audit entries</p>'}
      </div>
    </div>`, req.session.user));
  }));

  console.log('[Procurement] Module loaded — vendors, requisitions, POs, RFQs, budgets, contracts, audit');
};
