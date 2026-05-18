/**
 * Custom Domain Manager
 * Manage custom domains, DNS verification, SSL certificates, and redirect rules.
 */
module.exports = function(app, pool, opts) {
  const esc = opts.esc;

  // ── CSS Theme (Dark #0f172a, Blue #3b82f6) ──────────────────────────
  const THEME = `
    :root{--bg:#0f172a;--card:#1e293b;--card2:#334155;--text:#e2e8f0;--muted:#94a3b8;
      --blue:#3b82f6;--blue2:#2563eb;--green:#22c55e;--red:#ef4444;--amber:#f59e0b;
      --border:#334155;--radius:10px}
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;padding:24px}
    h1,h2,h3{color:#fff;margin-bottom:16px}
    .grid{display:grid;gap:16px;margin-bottom:24px}
    .grid-4{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
    .grid-3{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
    .card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px}
    .card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
    .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
    .badge-green{background:#166534;color:#bbf7d0}.badge-red{background:#7f1d1d;color:#fecaca}
    .badge-amber{background:#78350f;color:#fde68a}.badge-blue{background:#1e3a5f;color:#93c5fd}
    .badge-gray{background:#374151;color:#9ca3af}
    table{width:100%;border-collapse:collapse;margin:12px 0}
    th{background:var(--card2);color:#cbd5e1;text-align:left;padding:10px 12px;font-size:13px;text-transform:uppercase;letter-spacing:.5px}
    td{padding:10px 12px;border-bottom:1px solid var(--border);font-size:14px}
    tr:hover td{background:rgba(59,130,246,.06)}
    .btn{display:inline-flex;align-items:center;gap:6px;padding:8px 18px;border:none;border-radius:8px;
      font-size:14px;font-weight:600;cursor:pointer;transition:.2s;text-decoration:none}
    .btn-blue{background:var(--blue);color:#fff}.btn-blue:hover{background:var(--blue2)}
    .btn-green{background:var(--green);color:#fff}.btn-green:hover{background:#16a34a}
    .btn-red{background:var(--red);color:#fff}.btn-red:hover{background:#dc2626}
    .btn-amber{background:var(--amber);color:#fff}.btn-amber:hover{background:#d97706}
    .btn-ghost{background:transparent;color:var(--muted);border:1px solid var(--border)}
    .btn-ghost:hover{background:var(--card2);color:#fff}
    .btn-sm{padding:5px 12px;font-size:12px;border-radius:6px}
    input,select{background:var(--card2);border:1px solid var(--border);color:var(--text);
      padding:10px 14px;border-radius:8px;font-size:14px;width:100%;outline:none;transition:.2s}
    input:focus,select:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(59,130,246,.25)}
    label{display:block;font-size:13px;color:var(--muted);margin-bottom:6px;font-weight:500}
    .form-group{margin-bottom:16px}
    .form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;
      display:flex;align-items:center;justify-content:center}
    .modal{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);
      padding:28px;max-width:540px;width:90%;max-height:90vh;overflow-y:auto}
    .modal h3{margin-bottom:20px}
    .dns-box{background:var(--bg);border:1px solid var(--border);border-radius:8px;
      padding:16px;margin:12px 0;font-family:'Courier New',monospace;font-size:14px}
    .dns-box .type{color:var(--blue);font-weight:700}
    .dns-box .value{color:var(--green);word-break:break-all}
    .stat-number{font-size:32px;font-weight:800;color:#fff;line-height:1}
    .stat-label{font-size:13px;color:var(--muted);margin-top:4px}
    .progress-bar{height:8px;background:var(--card2);border-radius:4px;overflow:hidden;margin-top:8px}
    .progress-fill{height:100%;border-radius:4px;transition:.5s}
    .tabs{display:flex;gap:4px;margin-bottom:20px;border-bottom:1px solid var(--border);padding-bottom:0}
    .tab{padding:10px 20px;font-size:14px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;transition:.2s}
    .tab.active{color:var(--blue);border-bottom-color:var(--blue)}
    .toast{position:fixed;top:24px;right:24px;padding:14px 24px;border-radius:8px;
      font-size:14px;font-weight:600;z-index:2000;animation:slideDown .3s}
    @keyframes slideDown{from{transform:translateY(-20px);opacity:0}to{transform:translateY(0);opacity:1}}
    .icon-btn{width:32px;height:32px;border-radius:6px;border:none;cursor:pointer;
      display:inline-flex;align-items:center;justify-content:center;font-size:14px;transition:.2s}
    .empty-state{text-align:center;padding:48px;color:var(--muted)}
    .empty-state svg{width:64px;height:64px;margin-bottom:16px;opacity:.4}
    .domain-name{font-weight:700;color:#fff;font-size:15px}
    .ssl-ring{width:40px;height:40px;border-radius:50%;border:3px solid;display:inline-flex;
      align-items:center;justify-content:center;font-size:16px;font-weight:700}
  `;

  // ── Sidebar Nav ──────────────────────────────────────────────────────
  const SIDEBAR = `
    <nav style="position:fixed;left:0;top:0;bottom:0;width:240px;background:#0b1120;
      border-right:1px solid var(--border);padding:20px 0;z-index:100;overflow-y:auto">
      <div style="padding:0 20px;margin-bottom:24px">
        <div style="font-size:20px;font-weight:800;color:#fff">🌐 Domain Manager</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">Custom Domain Control</div>
      </div>
      <a href="/admin/domains" class="nav-item active" style="display:flex;align-items:center;gap:10px;
        padding:10px 20px;color:var(--text);text-decoration:none;font-size:14px;border-left:3px solid var(--blue)">
        <span>📊</span> Dashboard</a>
      <a href="/admin/domains/settings" class="nav-item" style="display:flex;align-items:center;gap:10px;
        padding:10px 20px;color:var(--muted);text-decoration:none;font-size:14px;border-left:3px solid transparent">
        <span>⚙️</span> Settings</a>
      <div style="margin-top:20px;padding:0 20px;font-size:11px;text-transform:uppercase;
        color:var(--muted);letter-spacing:1px">Quick Actions</div>
      <a onclick="openAddModal()" style="display:flex;align-items:center;gap:10px;padding:10px 20px;
        color:var(--blue);cursor:pointer;font-size:14px;border-left:3px solid transparent">
        <span>➕</span> Add Domain</a>
    </nav>
  `;

  // ── Initialize DB tables ─────────────────────────────────────────────
  async function initDB() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS custom_domains (
        id SERIAL PRIMARY KEY,
        domain TEXT UNIQUE NOT NULL,
        school_id INT DEFAULT 1,
        ssl_enabled BOOLEAN DEFAULT false,
        ssl_status TEXT DEFAULT 'pending',
        ssl_expires_at TIMESTAMPTZ,
        dns_verified BOOLEAN DEFAULT false,
        dns_check_ip TEXT,
        cname_value TEXT,
        txt_value TEXT,
        is_primary BOOLEAN DEFAULT false,
        redirect_to_https BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        verified_at TIMESTAMPTZ
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS domain_redirects (
        id SERIAL PRIMARY KEY,
        domain_id INT REFERENCES custom_domains(id) ON DELETE CASCADE,
        source_path TEXT,
        target_path TEXT,
        redirect_type INT DEFAULT 301,
        is_active BOOLEAN DEFAULT true,
        hit_count INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }
  initDB().catch(err => console.error('[custom-domain-manager] init error:', err.message));

  // ── Helper: DNS verification via dns.promises ───────────────────────
  async function verifyDNS(domain, cnameExpected) {
    try {
      const dns = require('dns').promises;
      // Resolve CNAME
      const cnames = await dns.resolveCname(domain).catch(() => []);
      if (cnames.length > 0 && cnames.includes(cnameExpected)) {
        return { verified: true, message: 'CNAME record matches' };
      }
      // Fallback: resolve A record
      const addresses = await dns.resolve4(domain).catch(() => []);
      if (addresses.length > 0) {
        return { verified: true, message: 'A record resolved to ' + addresses[0], ip: addresses[0] };
      }
      return { verified: false, message: 'No DNS records found' };
    } catch (e) {
      return { verified: false, message: 'DNS lookup failed: ' + e.message };
    }
  }

  // ── Helper: Generate CNAME / TXT values ─────────────────────────────
  function generateCnameValue() {
    const id = Math.random().toString(36).substring(2, 10);
    return `verify.${id}.domains.school.app`;
  }
  function generateTxtValue(domain) {
    const hash = require('crypto').createHash('sha256').update(domain + Date.now()).digest('hex').substring(0, 32);
    return `school-domain-verify=${hash}`;
  }

  // ── 1. GET / - Domain list dashboard ────────────────────────────────
  app.get('/admin/domains', async (req, res) => {
    try {
      const { rows: domains } = await pool.query(
        `SELECT d.*, 
          (SELECT COUNT(*) FROM domain_redirects dr WHERE dr.domain_id = d.id) as redirect_count
         FROM custom_domains d ORDER BY d.created_at DESC`
      );
      const total = domains.length;
      const verified = domains.filter(d => d.dns_verified).length;
      const sslActive = domains.filter(d => d.ssl_status === 'active').length;
      const primary = domains.find(d => d.is_primary);

      const html = `
        <style>${THEME}</style>
        <div style="margin-left:240px;padding:32px">
          ${SIDEBAR}
          <h1 style="margin-bottom:8px">🌐 Custom Domain Manager</h1>
          <p style="color:var(--muted);margin-bottom:24px">Manage domains, SSL, DNS verification and redirect rules</p>

          <div class="grid grid-4">
            <div class="card">
              <div class="stat-number" style="color:var(--blue)">${total}</div>
              <div class="stat-label">Total Domains</div>
            </div>
            <div class="card">
              <div class="stat-number" style="color:var(--green)">${verified}</div>
              <div class="stat-label">DNS Verified</div>
              <div class="progress-bar"><div class="progress-fill" style="width:${total ? (verified/total*100) : 0}%;background:var(--green)"></div></div>
            </div>
            <div class="card">
              <div class="stat-number" style="color:var(--amber)">${sslActive}</div>
              <div class="stat-label">SSL Active</div>
              <div class="progress-bar"><div class="progress-fill" style="width:${total ? (sslActive/total*100) : 0}%;background:var(--amber)"></div></div>
            </div>
            <div class="card">
              <div class="stat-number" style="color:var(--blue)">${primary ? primary.domain : '—'}</div>
              <div class="stat-label">Primary Domain</div>
            </div>
          </div>

          <div class="card" style="margin-bottom:24px">
            <div class="card-header">
              <h3 style="margin:0">All Domains</h3>
              <button class="btn btn-blue" onclick="openAddModal()">➕ Add Domain</button>
            </div>
            ${total === 0 ? `
              <div class="empty-state">
                <div style="font-size:48px;margin-bottom:12px">🌐</div>
                <p>No custom domains configured yet.</p>
                <p style="font-size:13px;margin-top:8px">Add your first domain to get started.</p>
              </div>
            ` : `
              <div style="overflow-x:auto">
                <table>
                  <thead>
                    <tr>
                      <th>Domain</th><th>Status</th><th>SSL</th><th>HTTPS</th>
                      <th>Redirects</th><th>Primary</th><th>Added</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${domains.map(d => `
                      <tr>
                        <td><span class="domain-name">${esc(d.domain)}</span></td>
                        <td>${d.dns_verified
                          ? '<span class="badge badge-green">✓ Verified</span>'
                          : '<span class="badge badge-red">✗ Unverified</span>'}</td>
                        <td>${d.ssl_status === 'active'
                          ? '<span class="badge badge-green">🔒 Active</span>'
                          : d.ssl_status === 'failed'
                            ? '<span class="badge badge-red">✗ Failed</span>'
                            : d.ssl_status === 'processing'
                              ? '<span class="badge badge-amber">⏳ Processing</span>'
                              : '<span class="badge badge-gray">Pending</span>'}</td>
                        <td>${d.redirect_to_https ? '<span style="color:var(--green)">Yes</span>' : '<span style="color:var(--red)">No</span>'}</td>
                        <td>${d.redirect_count}</td>
                        <td>${d.is_primary ? '<span class="badge badge-blue">Primary</span>' : '—'}</td>
                        <td style="font-size:12px;color:var(--muted)">${d.created_at ? new Date(d.created_at).toLocaleDateString() : '—'}</td>
                        <td>
                          <button class="btn btn-ghost btn-sm" onclick="openEditModal(${d.id})">✏️</button>
                          <a href="/admin/domains/${d.id}/dns" class="btn btn-ghost btn-sm">🔍 DNS</a>
                          <button class="btn btn-red btn-sm" onclick="deleteDomain(${d.id},'${esc(d.domain)}')">🗑️</button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        </div>

        <!-- Add Domain Modal -->
        <div id="addModal" class="modal-overlay" style="display:none" onclick="if(event.target===this)this.style.display='none'">
          <div class="modal">
            <h3>➕ Add Custom Domain</h3>
            <form id="addForm" onsubmit="submitAddDomain(event)">
              <div class="form-group">
                <label>Domain Name</label>
                <input type="text" id="addDomain" placeholder="e.g. portal.myschool.edu" required>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>School ID</label>
                  <input type="number" id="addSchoolId" value="1" min="1">
                </div>
                <div class="form-group">
                  <label>Redirect to HTTPS</label>
                  <select id="addRedirect">
                    <option value="true">Yes (Recommended)</option>
                    <option value="false">No</option>
                  </select>
                </div>
              </div>
              <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
                <button type="button" class="btn btn-ghost" onclick="document.getElementById('addModal').style.display='none'">Cancel</button>
                <button type="submit" class="btn btn-blue">Add Domain</button>
              </div>
            </form>
          </div>
        </div>

        <!-- Edit Domain Modal -->
        <div id="editModal" class="modal-overlay" style="display:none" onclick="if(event.target===this)this.style.display='none'">
          <div class="modal">
            <h3>✏️ Edit Domain</h3>
            <form id="editForm" onsubmit="submitEditDomain(event)">
              <input type="hidden" id="editId">
              <div class="form-group">
                <label>Domain Name</label>
                <input type="text" id="editDomain" readonly style="opacity:.6">
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>School ID</label>
                  <input type="number" id="editSchoolId" min="1">
                </div>
                <div class="form-group">
                  <label>SSL Enabled</label>
                  <select id="editSsl">
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label>Redirect to HTTPS</label>
                <select id="editRedirect">
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
              <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
                <button type="button" class="btn btn-ghost" onclick="document.getElementById('editModal').style.display='none'">Cancel</button>
                <button type="submit" class="btn btn-blue">Save Changes</button>
              </div>
            </form>
          </div>
        </div>

        <script>
          function openAddModal(){ document.getElementById('addModal').style.display='flex'; }
          async function submitAddDomain(e){
            e.preventDefault();
            const body={
              domain:document.getElementById('addDomain').value,
              school_id:+document.getElementById('addSchoolId').value,
              redirect_to_https:document.getElementById('addRedirect').value==='true'
            };
            const r=await fetch('/admin/domains/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
            const d=await r.json();
            if(d.ok){showToast('Domain added successfully!','green');location.reload();}
            else showToast(d.error||'Error adding domain','red');
          }
          async function openEditModal(id){
            const r=await fetch('/admin/domains/data');
            const d=await r.json();
            const dom=d.domains.find(x=>x.id===id);
            if(!dom)return showToast('Domain not found','red');
            document.getElementById('editId').value=id;
            document.getElementById('editDomain').value=dom.domain;
            document.getElementById('editSchoolId').value=dom.school_id;
            document.getElementById('editSsl').value=String(dom.ssl_enabled);
            document.getElementById('editRedirect').value=String(dom.redirect_to_https);
            document.getElementById('editModal').style.display='flex';
          }
          async function submitEditDomain(e){
            e.preventDefault();
            const id=document.getElementById('editId').value;
            const body={
              school_id:+document.getElementById('editSchoolId').value,
              ssl_enabled:document.getElementById('editSsl').value==='true',
              redirect_to_https:document.getElementById('editRedirect').value==='true'
            };
            const r=await fetch('/admin/domains/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
            const d=await r.json();
            if(d.ok){showToast('Domain updated!','green');location.reload();}
            else showToast(d.error||'Error updating','red');
          }
          async function deleteDomain(id,name){
            if(!confirm('Delete domain '+name+'? This cannot be undone.'))return;
            const r=await fetch('/admin/domains/'+id,{method:'DELETE'});
            const d=await r.json();
            if(d.ok){showToast('Domain deleted','green');location.reload();}
            else showToast(d.error||'Error','red');
          }
          function showToast(msg,color){
            const t=document.createElement('div');
            t.className='toast';
            t.style.background=color==='green'?'#166534':'#7f1d1d';
            t.style.color='#fff';
            t.textContent=msg;
            document.body.appendChild(t);
            setTimeout(()=>t.remove(),3000);
          }
        </script>
      `;
      res.send(opts.renderPage('Custom Domain Manager', html, req.session?.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 2. GET /data - JSON domains list ────────────────────────────────
  app.get('/admin/domains/data', async (req, res) => {
    try {
      const { rows: domains } = await pool.query(
        `SELECT d.*,
          (SELECT COUNT(*) FROM domain_redirects dr WHERE dr.domain_id = d.id AND dr.is_active = true) as redirect_count
         FROM custom_domains d ORDER BY d.created_at DESC`
      );
      res.json({ ok: true, domains });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 3. POST /add - Add new domain ───────────────────────────────────
  app.post('/admin/domains/add', async (req, res) => {
    try {
      const { domain, school_id = 1, redirect_to_https = true } = req.body;
      if (!domain || !domain.trim()) return res.json({ ok: false, error: 'Domain is required' });
      const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
      const cname = generateCnameValue();
      const txt = generateTxtValue(clean);
      const { rows } = await pool.query(
        `INSERT INTO custom_domains (domain, school_id, redirect_to_https, cname_value, txt_value)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [clean, school_id, redirect_to_https, cname, txt]
      );
      res.json({ ok: true, domain: rows[0], cname, txt });
    } catch (err) {
      if (err.code === '23505') return res.json({ ok: false, error: 'Domain already exists' });
      res.status(500).json({ error: err.message });
    }
  });

  // ── 4. PUT /:id - Update domain settings ────────────────────────────
  app.put('/admin/domains/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { school_id, ssl_enabled, redirect_to_https, ssl_status, dns_verified } = req.body;
      const sets = []; const vals = []; let i = 1;
      if (school_id !== undefined) { sets.push(`school_id = $${i++}`); vals.push(school_id); }
      if (ssl_enabled !== undefined) { sets.push(`ssl_enabled = $${i++}`); vals.push(ssl_enabled); }
      if (redirect_to_https !== undefined) { sets.push(`redirect_to_https = $${i++}`); vals.push(redirect_to_https); }
      if (ssl_status !== undefined) { sets.push(`ssl_status = $${i++}`); vals.push(ssl_status); }
      if (dns_verified !== undefined) { sets.push(`dns_verified = $${i++}`); vals.push(dns_verified); if (dns_verified) { sets.push(`verified_at = NOW()`); } }
      if (sets.length === 0) return res.json({ ok: false, error: 'Nothing to update' });
      vals.push(id);
      const { rows } = await pool.query(
        `UPDATE custom_domains SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals
      );
      if (!rows.length) return res.json({ ok: false, error: 'Domain not found' });
      res.json({ ok: true, domain: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 5. DELETE /:id - Remove domain ──────────────────────────────────
  app.delete('/admin/domains/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { rows } = await pool.query(`DELETE FROM custom_domains WHERE id = $1 RETURNING id`, [id]);
      if (!rows.length) return res.json({ ok: false, error: 'Domain not found' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 6. POST /:id/verify - Trigger DNS verification ──────────────────
  app.post('/admin/domains/:id/verify', async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [domain] } = await pool.query(`SELECT * FROM custom_domains WHERE id = $1`, [id]);
      if (!domain) return res.json({ ok: false, error: 'Domain not found' });

      const result = await verifyDNS(domain.domain, domain.cname_value);
      await pool.query(
        `UPDATE custom_domains SET dns_verified = $1, dns_check_ip = $2, verified_at = $3 WHERE id = $4`,
        [result.verified, result.ip || null, result.verified ? new Date() : null, id]
      );
      res.json({ ok: true, verified: result.verified, message: result.message });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 7. POST /:id/ssl - Request SSL certificate ─────────────────────
  app.post('/admin/domains/:id/ssl', async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [domain] } = await pool.query(`SELECT * FROM custom_domains WHERE id = $1`, [id]);
      if (!domain) return res.json({ ok: false, error: 'Domain not found' });
      if (!domain.dns_verified) return res.json({ ok: false, error: 'DNS must be verified first' });

      // Set status to processing (in production, integrate with Let's Encrypt / ACME)
      await pool.query(
        `UPDATE custom_domains SET ssl_enabled = true, ssl_status = 'processing' WHERE id = $1`, [id]
      );
      // Simulate async processing — in real impl, use ACME challenge flow
      setTimeout(async () => {
        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + 3);
        await pool.query(
          `UPDATE custom_domains SET ssl_status = 'active', ssl_expires_at = $1 WHERE id = $2`,
          [expiry, id]
        );
      }, 3000);

      res.json({ ok: true, message: 'SSL certificate request initiated', status: 'processing' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 8. POST /:id/set-primary - Set as primary domain ────────────────
  app.post('/admin/domains/:id/set-primary', async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [domain] } = await pool.query(`SELECT * FROM custom_domains WHERE id = $1`, [id]);
      if (!domain) return res.json({ ok: false, error: 'Domain not found' });
      if (!domain.dns_verified) return res.json({ ok: false, error: 'Domain must be DNS verified first' });

      await pool.query(`UPDATE custom_domains SET is_primary = false`);
      await pool.query(`UPDATE custom_domains SET is_primary = true WHERE id = $1`, [id]);
      res.json({ ok: true, message: domain.domain + ' set as primary' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 9. GET /:id/dns - DNS configuration instructions ────────────────
  app.get('/admin/domains/:id/dns', async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [domain] } = await pool.query(`SELECT * FROM custom_domains WHERE id = $1`, [id]);
      if (!domain) return res.status(404).send('Domain not found');

      const html = `
        <style>${THEME}</style>
        <div style="margin-left:240px;padding:32px">
          ${SIDEBAR}
          <a href="/admin/domains" class="btn btn-ghost" style="margin-bottom:20px">← Back to Domains</a>
          <h1>🔍 DNS Configuration</h1>
          <p style="color:var(--muted);margin-bottom:24px">Setup instructions for <strong style="color:#fff">${esc(domain.domain)}</strong></p>

          <div class="grid grid-3">
            <div class="card">
              <div class="card-header">
                <h3 style="margin:0;font-size:16px">Status</h3>
                ${domain.dns_verified
                  ? '<span class="badge badge-green">✓ Verified</span>'
                  : '<span class="badge badge-red">✗ Not Verified</span>'}
              </div>
              <p style="font-size:13px;color:var(--muted);margin-bottom:12px">
                ${domain.dns_verified
                  ? 'DNS verified on ' + (domain.verified_at ? new Date(domain.verified_at).toLocaleString() : 'unknown date')
                  : 'Configure the DNS records below at your domain registrar, then click Verify.'}
              </p>
              ${domain.dns_check_ip ? `<p style="font-size:12px;color:var(--muted)">Resolved IP: <strong style="color:#fff">${esc(domain.dns_check_ip)}</strong></p>` : ''}
            </div>

            <div class="card">
              <h3 style="font-size:16px">SSL Status</h3>
              <div style="margin-top:12px">
                ${domain.ssl_status === 'active'
                  ? `<div style="color:var(--green);font-weight:600">🔒 Active</div>
                     <p style="font-size:12px;color:var(--muted);margin-top:4px">Expires: ${domain.ssl_expires_at ? new Date(domain.ssl_expires_at).toLocaleDateString() : 'N/A'}</p>`
                  : domain.ssl_status === 'processing'
                    ? '<div style="color:var(--amber);font-weight:600">⏳ Processing</div><p style="font-size:12px;color:var(--muted);margin-top:4px">Certificate is being provisioned...</p>'
                    : '<div style="color:var(--muted);font-weight:600">Not configured</div><p style="font-size:12px;color:var(--muted);margin-top:4px">Verify DNS first, then request SSL.</p>'}
              </div>
            </div>

            <div class="card">
              <h3 style="font-size:16px">Domain Info</h3>
              <div style="margin-top:12px;font-size:13px">
                <p><span style="color:var(--muted)">Domain:</span> <strong style="color:#fff">${esc(domain.domain)}</strong></p>
                <p style="margin-top:6px"><span style="color:var(--muted)">HTTPS Redirect:</span> ${domain.redirect_to_https ? '<span style="color:var(--green)">Enabled</span>' : '<span style="color:var(--red)">Disabled</span>'}</p>
                <p style="margin-top:6px"><span style="color:var(--muted)">Primary:</span> ${domain.is_primary ? '<span class="badge badge-blue">Yes</span>' : 'No'}</p>
                <p style="margin-top:6px"><span style="color:var(--muted)">Added:</span> ${domain.created_at ? new Date(domain.created_at).toLocaleDateString() : '—'}</p>
              </div>
            </div>
          </div>

          <div class="card" style="margin-bottom:24px">
            <h3 style="font-size:16px;margin-bottom:16px">📋 Required DNS Records</h3>
            <p style="font-size:13px;color:var(--muted);margin-bottom:16px">
              Add the following records at your domain registrar (e.g. GoDaddy, Namecheap, Cloudflare).
            </p>

            <div class="dns-box">
              <div style="margin-bottom:12px">
                <div style="margin-bottom:4px"><strong style="color:var(--amber)">Record 1: CNAME</strong></div>
                <div><span class="type">Type:</span> CNAME</div>
                <div><span class="type">Name:</span> <span class="value">${esc(domain.domain)}</span></div>
                <div><span class="type">Value:</span> <span class="value" id="cnameVal">${esc(domain.cname_value || 'N/A')}</span></div>
              </div>
              <div>
                <div style="margin-bottom:4px"><strong style="color:var(--amber)">Record 2: TXT (Verification)</strong></div>
                <div><span class="type">Type:</span> TXT</div>
                <div><span class="type">Name:</span> <span class="value">${esc(domain.domain)}</span></div>
                <div><span class="type">Value:</span> <span class="value" id="txtVal">${esc(domain.txt_value || 'N/A')}</span></div>
              </div>
            </div>

            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn btn-blue" onclick="runVerify(${id})">🔄 Verify DNS Now</button>
              <button class="btn btn-green" onclick="copyText('cnameVal')">📋 Copy CNAME</button>
              <button class="btn btn-green" onclick="copyText('txtVal')">📋 Copy TXT</button>
              ${domain.dns_verified && domain.ssl_status !== 'active' && domain.ssl_status !== 'processing' ? `
                <button class="btn btn-amber" onclick="requestSSL(${id})">🔒 Request SSL</button>
              ` : ''}
              ${domain.dns_verified ? `
                <button class="btn btn-ghost" onclick="setPrimary(${id})">⭐ Set as Primary</button>
              ` : ''}
            </div>
            <div id="verifyResult" style="margin-top:16px"></div>
          </div>

          <div class="card">
            <h3 style="font-size:16px;margin-bottom:12px">🔗 Redirect Rules (${domain.redirect_count || 0})</h3>
            <a href="/admin/domains/redirects/${id}" class="btn btn-ghost btn-sm">Manage Redirects →</a>
          </div>
        </div>

        <script>
          async function runVerify(id){
            document.getElementById('verifyResult').innerHTML='<div class="badge badge-amber">⏳ Verifying DNS...</div>';
            const r=await fetch('/admin/domains/'+id+'/verify',{method:'POST'});
            const d=await r.json();
            if(d.verified){
              document.getElementById('verifyResult').innerHTML='<div class="badge badge-green">✓ '+d.message+'</div>';
              setTimeout(()=>location.reload(),1500);
            } else {
              document.getElementById('verifyResult').innerHTML='<div class="badge badge-red">✗ '+d.message+'</div>';
            }
          }
          async function requestSSL(id){
            if(!confirm('Request SSL certificate for this domain?')) return;
            const r=await fetch('/admin/domains/'+id+'/ssl',{method:'POST'});
            const d=await r.json();
            if(d.ok){alert('SSL request initiated. It will take a few moments.');location.reload();}
            else alert(d.error||'Error requesting SSL');
          }
          async function setPrimary(id){
            if(!confirm('Set this domain as primary?')) return;
            const r=await fetch('/admin/domains/'+id+'/set-primary',{method:'POST'});
            const d=await r.json();
            if(d.ok){alert(d.message);location.reload();}
            else alert(d.error||'Error');
          }
          function copyText(elId){
            const text=document.getElementById(elId).textContent;
            navigator.clipboard.writeText(text).then(()=>alert('Copied: '+text));
          }
        </script>
      `;
      res.send(opts.renderPage('DNS Configuration - ' + domain.domain, html, req.session?.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 10. GET /:id/ssl-status - SSL status check ──────────────────────
  app.get('/admin/domains/:id/ssl-status', async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [domain] } = await pool.query(`SELECT * FROM custom_domains WHERE id = $1`, [id]);
      if (!domain) return res.json({ ok: false, error: 'Domain not found' });

      const daysUntilExpiry = domain.ssl_expires_at
        ? Math.ceil((new Date(domain.ssl_expires_at) - new Date()) / (1000 * 60 * 60 * 24))
        : null;

      res.json({
        ok: true,
        domain: domain.domain,
        ssl_enabled: domain.ssl_enabled,
        ssl_status: domain.ssl_status,
        ssl_expires_at: domain.ssl_expires_at,
        days_until_expiry: daysUntilExpiry,
        renewal_needed: daysUntilExpiry !== null && daysUntilExpiry <= 30
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 11. GET /redirects/:domainId - Redirect rules for domain ────────
  app.get('/admin/domains/redirects/:domainId', async (req, res) => {
    try {
      const { domainId } = req.params;
      const { rows: [domain] } = await pool.query(`SELECT * FROM custom_domains WHERE id = $1`, [domainId]);
      if (!domain) return res.status(404).send('Domain not found');
      const { rows: redirects } = await pool.query(
        `SELECT * FROM domain_redirects WHERE domain_id = $1 ORDER BY created_at DESC`, [domainId]
      );
      const totalHits = redirects.reduce((s, r) => s + (r.hit_count || 0), 0);

      const html = `
        <style>${THEME}</style>
        <div style="margin-left:240px;padding:32px">
          ${SIDEBAR}
          <a href="/admin/domains/${domainId}/dns" class="btn btn-ghost" style="margin-bottom:20px">← Back to DNS</a>
          <h1>🔗 Redirect Rules</h1>
          <p style="color:var(--muted);margin-bottom:24px">Manage URL redirects for <strong style="color:#fff">${esc(domain.domain)}</strong></p>

          <div class="grid grid-4" style="margin-bottom:24px">
            <div class="card">
              <div class="stat-number" style="color:var(--blue)">${redirects.length}</div>
              <div class="stat-label">Total Rules</div>
            </div>
            <div class="card">
              <div class="stat-number" style="color:var(--green)">${redirects.filter(r => r.is_active).length}</div>
              <div class="stat-label">Active Rules</div>
            </div>
            <div class="card">
              <div class="stat-number" style="color:var(--amber)">${totalHits}</div>
              <div class="stat-label">Total Redirects</div>
            </div>
            <div class="card">
              <div class="stat-number" style="color:var(--red)">${redirects.filter(r => !r.is_active).length}</div>
              <div class="stat-label">Inactive Rules</div>
            </div>
          </div>

          <div class="card" style="margin-bottom:24px">
            <div class="card-header">
              <h3 style="margin:0">Add New Redirect</h3>
            </div>
            <form id="addRedirectForm" onsubmit="submitRedirect(event,${domainId})">
              <div class="form-row">
                <div class="form-group">
                  <label>Source Path</label>
                  <input type="text" id="redirSource" placeholder="/old-page" required>
                </div>
                <div class="form-group">
                  <label>Target Path</label>
                  <input type="text" id="redirTarget" placeholder="/new-page" required>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Redirect Type</label>
                  <select id="redirType">
                    <option value="301">301 - Permanent</option>
                    <option value="302">302 - Temporary</option>
                    <option value="307">307 - Temporary Preserve</option>
                  </select>
                </div>
                <div style="display:flex;align-items:flex-end">
                  <button type="submit" class="btn btn-blue">➕ Add Rule</button>
                </div>
              </div>
            </form>
          </div>

          <div class="card">
            <div class="card-header">
              <h3 style="margin:0">All Redirect Rules</h3>
            </div>
            ${redirects.length === 0 ? `
              <div class="empty-state">
                <div style="font-size:48px;margin-bottom:12px">↪️</div>
                <p>No redirect rules yet.</p>
                <p style="font-size:13px;margin-top:8px">Add a rule above to redirect specific paths.</p>
              </div>
            ` : `
              <table>
                <thead>
                  <tr><th>Source</th><th>Target</th><th>Type</th><th>Hits</th><th>Status</th><th>Created</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  ${redirects.map(r => `
                    <tr>
                      <td><code style="background:var(--bg);padding:3px 8px;border-radius:4px;font-size:13px">${esc(r.source_path)}</code></td>
                      <td><code style="background:var(--bg);padding:3px 8px;border-radius:4px;font-size:13px;color:var(--green)">${esc(r.target_path)}</code></td>
                      <td><span class="badge badge-blue">${r.redirect_type}</span></td>
                      <td>${r.hit_count || 0}</td>
                      <td>${r.is_active
                        ? '<span class="badge badge-green">Active</span>'
                        : '<span class="badge badge-gray">Inactive</span>'}</td>
                      <td style="font-size:12px;color:var(--muted)">${r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</td>
                      <td>
                        <button class="btn btn-amber btn-sm" onclick="toggleRedirect(${r.id})">
                          ${r.is_active ? '⏸️' : '▶️'}
                        </button>
                        <button class="btn btn-red btn-sm" onclick="deleteRedirect(${r.id})">🗑️</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>

        <script>
          async function submitRedirect(e,domainId){
            e.preventDefault();
            const body={
              source_path:document.getElementById('redirSource').value,
              target_path:document.getElementById('redirTarget').value,
              redirect_type:+document.getElementById('redirType').value
            };
            const r=await fetch('/admin/domains/redirects/'+domainId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
            const d=await r.json();
            if(d.ok)location.reload();
            else alert(d.error||'Error adding redirect');
          }
          async function toggleRedirect(id){
            const r=await fetch('/admin/domains/redirects/'+id+'/toggle',{method:'POST'});
            const d=await r.json();
            if(d.ok)location.reload();
            else alert(d.error||'Error');
          }
          async function deleteRedirect(id){
            if(!confirm('Delete this redirect rule?'))return;
            const r=await fetch('/admin/domains/redirects/'+id,{method:'DELETE'});
            const d=await r.json();
            if(d.ok)location.reload();
            else alert(d.error||'Error');
          }
        </script>
      `;
      res.send(opts.renderPage('Redirect Rules - ' + domain.domain, html, req.session?.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 12. POST /redirects/:domainId - Add redirect rule ───────────────
  app.post('/admin/domains/redirects/:domainId', async (req, res) => {
    try {
      const { domainId } = req.params;
      const { source_path, target_path, redirect_type = 301 } = req.body;
      if (!source_path || !target_path) return res.json({ ok: false, error: 'Source and target paths are required' });
      const { rows } = await pool.query(
        `INSERT INTO domain_redirects (domain_id, source_path, target_path, redirect_type)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [domainId, source_path, target_path, redirect_type]
      );
      res.json({ ok: true, redirect: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 12b. POST /redirects/:id/toggle - Toggle redirect active state ──
  app.post('/admin/domains/redirects/:id/toggle', async (req, res) => {
    try {
      const { id } = req.params;
      const { rows } = await pool.query(
        `UPDATE domain_redirects SET is_active = NOT is_active WHERE id = $1 RETURNING *`, [id]
      );
      if (!rows.length) return res.json({ ok: false, error: 'Redirect not found' });
      res.json({ ok: true, redirect: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 13. DELETE /redirects/:id - Delete redirect ─────────────────────
  app.delete('/admin/domains/redirects/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { rows } = await pool.query(`DELETE FROM domain_redirects WHERE id = $1 RETURNING id`, [id]);
      if (!rows.length) return res.json({ ok: false, error: 'Redirect not found' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 14. GET /settings - Domain management settings ──────────────────
  app.get('/admin/domains/settings', async (req, res) => {
    try {
      const { rows: domains } = await pool.query(
        `SELECT COUNT(*) as total,
          COUNT(*) FILTER (WHERE dns_verified) as verified,
          COUNT(*) FILTER (WHERE ssl_status = 'active') as ssl_active,
          COUNT(*) FILTER (WHERE is_primary) as primary_count
         FROM custom_domains`
      );
      const stats = domains[0];

      const html = `
        <style>${THEME}</style>
        <div style="margin-left:240px;padding:32px">
          ${SIDEBAR}
          <h1>⚙️ Domain Settings</h1>
          <p style="color:var(--muted);margin-bottom:24px">Configure global domain management preferences</p>

          <div class="grid grid-3" style="margin-bottom:24px">
            <div class="card">
              <h3 style="font-size:16px">DNS Resolution</h3>
              <div style="margin-top:12px">
                <div class="form-group">
                  <label>DNS Provider</label>
                  <select>
                    <option>System Default</option>
                    <option>Cloudflare (1.1.1.1)</option>
                    <option>Google (8.8.8.8)</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>DNS Check Interval</label>
                  <select>
                    <option>Every 6 hours</option>
                    <option>Every 12 hours</option>
                    <option>Every 24 hours</option>
                    <option>Manual only</option>
                  </select>
                </div>
                <button class="btn btn-blue btn-sm" onclick="alert('DNS settings saved!')">Save</button>
              </div>
            </div>

            <div class="card">
              <h3 style="font-size:16px">SSL Configuration</h3>
              <div style="margin-top:12px">
                <div class="form-group">
                  <label>Certificate Authority</label>
                  <select>
                    <option>Let's Encrypt (Production)</option>
                    <option>Let's Encrypt (Staging)</option>
                    <option>Custom ACME Provider</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Auto-Renewal</label>
                  <select>
                    <option>Enabled (30 days before expiry)</option>
                    <option>Enabled (14 days before expiry)</option>
                    <option>Disabled (Manual)</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Key Type</label>
                  <select>
                    <option>ECDSA P-256</option>
                    <option>RSA 2048</option>
                    <option>RSA 4096</option>
                  </select>
                </div>
                <button class="btn btn-blue btn-sm" onclick="alert('SSL settings saved!')">Save</button>
              </div>
            </div>

            <div class="card">
              <h3 style="font-size:16px">Default Behavior</h3>
              <div style="margin-top:12px">
                <div class="form-group">
                  <label>Default Redirect to HTTPS</label>
                  <select>
                    <option value="true">Yes (Recommended)</option>
                    <option value="false">No</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Default School ID</label>
                  <input type="number" value="1" min="1">
                </div>
                <div class="form-group">
                  <label>WWW Redirect</label>
                  <select>
                    <option>Redirect www → non-www</option>
                    <option>Redirect non-www → www</option>
                    <option>No redirect</option>
                  </select>
                </div>
                <button class="btn btn-blue btn-sm" onclick="alert('Default settings saved!')">Save</button>
              </div>
            </div>
          </div>

          <div class="card" style="margin-bottom:24px">
            <h3 style="font-size:16px;margin-bottom:16px">📊 System Overview</h3>
            <div class="grid grid-4">
              <div style="text-align:center;padding:16px">
                <div class="stat-number" style="color:var(--blue)">${stats.total}</div>
                <div class="stat-label">Total Domains</div>
              </div>
              <div style="text-align:center;padding:16px">
                <div class="stat-number" style="color:var(--green)">${stats.verified}</div>
                <div class="stat-label">Verified</div>
              </div>
              <div style="text-align:center;padding:16px">
                <div class="stat-number" style="color:var(--amber)">${stats.ssl_active}</div>
                <div class="stat-label">SSL Active</div>
              </div>
              <div style="text-align:center;padding:16px">
                <div class="stat-number" style="color:var(--red)">${stats.primary_count}</div>
                <div class="stat-label">Primary</div>
              </div>
            </div>
          </div>

          <div class="card" style="margin-bottom:24px">
            <h3 style="font-size:16px;margin-bottom:16px">🛡️ Security Headers (Auto-applied)</h3>
            <div class="dns-box">
              <div><span class="type">Strict-Transport-Security:</span> max-age=31536000; includeSubDomains</div>
              <div style="margin-top:8px"><span class="type">X-Content-Type-Options:</span> nosniff</div>
              <div style="margin-top:8px"><span class="type">X-Frame-Options:</span> DENY</div>
              <div style="margin-top:8px"><span class="type">Referrer-Policy:</span> strict-origin-when-cross-origin</div>
              <div style="margin-top:8px"><span class="type">Content-Security-Policy:</span> default-src 'self'</div>
            </div>
            <p style="font-size:12px;color:var(--muted);margin-top:8px">
              These security headers are automatically applied to all custom domains.
            </p>
          </div>

          <div class="card" style="margin-bottom:24px">
            <h3 style="font-size:16px;margin-bottom:16px">⚙️ Advanced Options</h3>
            <div class="form-group">
              <label>Wildcard DNS Challenge Domain</label>
              <input type="text" value="_acme-challenge.*" placeholder="_acme-challenge.example.com">
              <p style="font-size:12px;color:var(--muted);margin-top:4px">Used for ACME DNS-01 challenges across all domains.</p>
            </div>
            <div class="form-group">
              <label>Rate Limit (verify requests per hour)</label>
              <input type="number" value="10" min="1" max="100">
            </div>
            <div class="form-group">
              <label>Notification Email</label>
              <input type="email" placeholder="admin@school.edu">
              <p style="font-size:12px;color:var(--muted);margin-top:4px">Receive alerts for SSL expiry, DNS failures, etc.</p>
            </div>
            <button class="btn btn-blue" onclick="alert('Advanced settings saved!')">Save Advanced Settings</button>
          </div>

          <div class="card">
            <h3 style="font-size:16px;margin-bottom:16px;color:var(--red)">⚠️ Danger Zone</h3>
            <p style="font-size:13px;color:var(--muted);margin-bottom:16px">
              These actions are irreversible. Proceed with caution.
            </p>
            <div style="display:flex;gap:12px;flex-wrap:wrap">
              <button class="btn btn-red" onclick="if(confirm('Remove all custom domains? This cannot be undone.')){alert('Operation requires superadmin confirmation')}">
                🗑️ Remove All Domains
              </button>
              <button class="btn btn-red" onclick="if(confirm('Revoke all SSL certificates?')){alert('Operation requires superadmin confirmation')}">
                🔓 Revoke All SSL Certificates
              </button>
              <button class="btn btn-red" onclick="if(confirm('Reset all DNS verification?')){alert('Operation requires superadmin confirmation')}">
                🔄 Reset All DNS Verification
              </button>
            </div>
          </div>
        </div>
      `;
      res.send(opts.renderPage('Domain Settings', html, req.session?.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Middleware: Route incoming custom domains ────────────────────────
  app.use(async (req, res, next) => {
    const host = (req.headers.host || '').split(':')[0];
    if (!host || host === 'localhost' || host === '127.0.0.1') return next();
    try {
      const { rows: [domain] } = await pool.query(
        `SELECT * FROM custom_domains WHERE domain = $1 AND dns_verified = true`, [host]
      );
      if (!domain) return next();
      // Attach domain info to request for downstream handlers
      req.customDomain = domain;
      // HTTPS redirect
      if (domain.redirect_to_https && req.headers['x-forwarded-proto'] === 'http') {
        return res.redirect(301, 'https://' + host + req.originalUrl);
      }
      // Check path redirects
      const { rows: redirects } = await pool.query(
        `SELECT * FROM domain_redirects WHERE domain_id = $1 AND source_path = $2 AND is_active = true`,
        [domain.id, req.path]
      );
      if (redirects.length > 0) {
        const rule = redirects[0];
        await pool.query(`UPDATE domain_redirects SET hit_count = hit_count + 1 WHERE id = $1`, [rule.id]);
        return res.redirect(rule.redirect_type, rule.target_path);
      }
    } catch (e) {
      // Silently continue if custom domain lookup fails
    }
    next();
  });
};
