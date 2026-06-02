/**
 * Login Attempt Dashboard – Security Module
 * Tracks login attempts, manages account lockouts, detects brute-force attacks,
 * and provides a rich admin UI with SVG charts, CSV export, IP blocking, and more.
 *
 * Tables:
 *   login_attempts    (id, username, email, ip_address, user_agent, success,
 *                      fail_reason, user_id, locked, created_at, tenant_id)
 *   account_lockouts  (id, user_id, username, email, ip_address, lockout_reason,
 *                      locked_at, unlocked_at, unlocked_by, is_active,
 *                      failed_attempts, tenant_id)
 */

const { migrateQuery } = require('./db');
module.exports = function (app, pool, opts) {
  const esc = opts.esc;

  /* Auto-create tables */
  (async () => {
    try {
      await migrateQuery(pool, 'LoginAttemptDashboard', `CREATE TABLE IF NOT EXISTS login_attempts (
        id SERIAL PRIMARY KEY, username TEXT, email TEXT, ip_address TEXT,
        user_agent TEXT, success BOOLEAN DEFAULT false, fail_reason TEXT,
        user_id INT, locked BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(), tenant_id INT DEFAULT 1
      )`);
      await migrateQuery(pool, 'LoginAttemptDashboard', `CREATE TABLE IF NOT EXISTS account_lockouts (
        id SERIAL PRIMARY KEY, user_id INT, username TEXT, email TEXT,
        ip_address TEXT, lockout_reason TEXT,
        locked_at TIMESTAMPTZ DEFAULT NOW(), unlocked_at TIMESTAMPTZ,
        unlocked_by INT, is_active BOOLEAN DEFAULT true,
        failed_attempts INT DEFAULT 0, tenant_id INT DEFAULT 1
      )`);
      await migrateQuery(pool, 'LoginAttemptDashboard', `CREATE INDEX IF NOT EXISTS idx_la_tenant ON login_attempts(tenant_id)`);
      await migrateQuery(pool, 'LoginAttemptDashboard', `CREATE INDEX IF NOT EXISTS idx_la_created ON login_attempts(created_at)`);
      await migrateQuery(pool, 'LoginAttemptDashboard', `CREATE INDEX IF NOT EXISTS idx_al_tenant ON account_lockouts(tenant_id)`);
      await migrateQuery(pool, 'LoginAttemptDashboard', `CREATE INDEX IF NOT EXISTS idx_al_active ON account_lockouts(is_active)`);
      console.log('[LoginSecurity] Tables ready');
    } catch(e) { /* migration OK */ }
  })();

  /* ------------------------------------------------------------------ */
  /*  Helper – default security settings stored in a simple JS object   */
  /* ------------------------------------------------------------------ */
  let securitySettings = {
    max_failed_attempts: 5,
    lockout_duration_minutes: 30,
    brute_force_threshold: 10,
    brute_force_window_minutes: 15,
    auto_cleanup_days: 90,
    notify_on_lockout: true,
    notify_on_brute_force: true,
    block_ip_threshold: 20,
  };

  /* In-memory blocked IP set (persisted to DB table if desired) */
  const blockedIPs = new Set();

  /* ------------------------------------------------------------------ */
  /*  1. GET /admin/login-security/ – Main Dashboard                    */
  /* ------------------------------------------------------------------ */
  app.get('/admin/login-security/', async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || 1;

      /* KPI queries */
      const [[{ total_attempts }]] = await pool.query(
        `SELECT COUNT(*) AS total_attempts FROM login_attempts WHERE tenant_id = ${esc(tenantId)}`
      );
      const [[{ successful }]] = await pool.query(
        `SELECT COUNT(*) AS successful FROM login_attempts WHERE tenant_id = ${esc(tenantId)} AND success = true`
      );
      const [[{ failed }]] = await pool.query(
        `SELECT COUNT(*) AS failed FROM login_attempts WHERE tenant_id = ${esc(tenantId)} AND success = false`
      );
      const [[{ active_lockouts }]] = await pool.query(
        `SELECT COUNT(*) AS active_lockouts FROM account_lockouts WHERE tenant_id = ${esc(tenantId)} AND is_active = true`
      );
      const [[{ unique_ips }]] = await pool.query(
        `SELECT COUNT(DISTINCT ip_address) AS unique_ips FROM login_attempts WHERE tenant_id = ${esc(tenantId)}`
      );
      const [[{ suspicious_ips }]] = await pool.query(
        `SELECT COUNT(DISTINCT ip_address) AS suspicious_ips FROM login_attempts
          WHERE tenant_id = ${esc(tenantId)} AND success = false
          GROUP BY ip_address HAVING COUNT(*) > ${esc(securitySettings.max_failed_attempts)}`
      );
      const successRate = total_attempts > 0 ? ((successful / total_attempts) * 100).toFixed(1) : '100.0';

      /* Last 24h attempts by hour (for SVG chart) */
      const [hourly] = await pool.query(
        `SELECT EXTRACT(HOUR FROM created_at)::int AS hr,
                COUNT(*) AS cnt,
                COUNT(*) FILTER (WHERE success = true)  AS ok,
                COUNT(*) FILTER (WHERE success = false) AS fail
           FROM login_attempts
          WHERE tenant_id = ${esc(tenantId)}
            AND created_at > NOW() - INTERVAL '24 hours'
          GROUP BY hr ORDER BY hr`
      );

      /* Recent 10 attempts */
      const [recent] = await pool.query(
        `SELECT * FROM login_attempts WHERE tenant_id = ${esc(tenantId)}
          ORDER BY created_at DESC LIMIT 10`
      );

      /* Top 5 fail reasons */
      const [reasons] = await pool.query(
        `SELECT fail_reason, COUNT(*) AS cnt FROM login_attempts
          WHERE tenant_id = ${esc(tenantId)} AND success = false AND fail_reason IS NOT NULL
          GROUP BY fail_reason ORDER BY cnt DESC LIMIT 5`
      );

      /* Top 5 IPs by failed attempts */
      const [topIPs] = await pool.query(
        `SELECT ip_address, COUNT(*) AS cnt FROM login_attempts
          WHERE tenant_id = ${esc(tenantId)} AND success = false AND ip_address IS NOT NULL
          GROUP BY ip_address ORDER BY cnt DESC LIMIT 5`
      );

      res.send(opts.renderPage('Login Attempt Dashboard', `
        <style>
          .ls-card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;margin-bottom:20px}
          .ls-kpi{background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid #334155;border-radius:16px;padding:28px;text-align:center;transition:transform .2s,box-shadow .2s}
          .ls-kpi:hover{transform:translateY(-4px);box-shadow:0 8px 30px rgba(59,130,246,.15)}
          .ls-kpi .num{font-size:2.4rem;font-weight:700;color:#3b82f6;margin-bottom:4px}
          .ls-kpi .lbl{font-size:.85rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px}
          .ls-table{width:100%;border-collapse:collapse;color:#cbd5e1}
          .ls-table th{text-align:left;padding:10px 14px;font-size:.78rem;text-transform:uppercase;letter-spacing:.5px;color:#64748b;border-bottom:1px solid #334155}
          .ls-table td{padding:10px 14px;border-bottom:1px solid #1e293b;font-size:.88rem}
          .ls-table tr:hover td{background:#1e293b}
          .badge-ok{background:#065f46;color:#34d399;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .badge-fail{background:#7f1d1d;color:#f87171;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .badge-warn{background:#78350f;color:#fbbf24;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .ls-btn{background:#3b82f6;color:#fff;border:none;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:.88rem;transition:background .2s}
          .ls-btn:hover{background:#2563eb}
          .ls-btn-danger{background:#ef4444}.ls-btn-danger:hover{background:#dc2626}
          .ls-btn-sm{padding:5px 12px;font-size:.78rem}
          .ls-section-title{font-size:1.15rem;font-weight:600;color:#e2e8f0;margin-bottom:16px}
          .ls-flex{display:flex;gap:16px;flex-wrap:wrap}
          .ls-flex > *{flex:1;min-width:180px}
          .ls-chart-wrap{position:relative;width:100%;max-height:260px;overflow-x:auto}
        </style>

        <!-- KPI Row -->
        <div class="ls-flex" style="margin-bottom:24px">
          <div class="ls-kpi"><div class="num">${total_attempts}</div><div class="lbl">Total Attempts</div></div>
          <div class="ls-kpi"><div class="num" style="color:#34d399">${successful}</div><div class="lbl">Successful</div></div>
          <div class="ls-kpi"><div class="num" style="color:#f87171">${failed}</div><div class="lbl">Failed</div></div>
          <div class="ls-kpi"><div class="num" style="color:#fbbf24">${successRate}%</div><div class="lbl">Success Rate</div></div>
          <div class="ls-kpi"><div class="num" style="color:#c084fc">${active_lockouts}</div><div class="lbl">Active Lockouts</div></div>
          <div class="ls-kpi"><div class="num" style="color:#22d3ee">${unique_ips}</div><div class="lbl">Unique IPs</div></div>
          <div class="ls-kpi"><div class="num" style="color:#fb923c">${suspicious_ips || 0}</div><div class="lbl">Suspicious IPs</div></div>
        </div>

        <!-- 24-Hour Activity Chart -->
        <div class="ls-card">
          <div class="ls-section-title">Login Activity (Last 24 Hours)</div>
          <div class="ls-chart-wrap">
            <svg id="activityChart" width="100%" height="240" viewBox="0 0 960 240"></svg>
          </div>
        </div>

        <div class="ls-flex">
          <!-- Recent Attempts -->
          <div class="ls-card" style="min-width:60%">
            <div class="ls-section-title">Recent Attempts</div>
            <table class="ls-table">
              <thead><tr><th>Time</th><th>User</th><th>IP</th><th>Status</th><th>Reason</th></tr></thead>
              <tbody>
                ${recent.map(r => `<tr>
                  <td>${r.created_at ? new Date(r.created_at).toLocaleString() : '-'}</td>
                  <td>${esc(r.username) || esc(r.email) || '-'}</td>
                  <td style="font-family:monospace;font-size:.82rem">${esc(r.ip_address) || '-'}</td>
                  <td><span class="${r.success ? 'badge-ok' : 'badge-fail'}">${r.success ? 'Success' : 'Failed'}</span></td>
                  <td>${esc(r.fail_reason) || '-'}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>

          <!-- Top Fail Reasons -->
          <div class="ls-card">
            <div class="ls-section-title">Top Fail Reasons</div>
            <svg id="reasonsPie" width="100%" height="220" viewBox="0 0 320 220"></svg>
          </div>
        </div>

        <!-- Top Suspicious IPs -->
        <div class="ls-card">
          <div class="ls-section-title">Top Failed IPs</div>
          <table class="ls-table">
            <thead><tr><th>IP Address</th><th>Failed Attempts</th><th>Actions</th></tr></thead>
            <tbody>
              ${topIPs.map(r => `<tr>
                <td style="font-family:monospace">${esc(r.ip_address)}</td>
                <td><span class="badge-fail">${r.cnt}</span></td>
                <td>
                  <a href="/admin/login-security/by-ip/${esc(r.ip_address)}" class="ls-btn ls-btn-sm">View</a>
                  <button onclick="blockIP('${esc(r.ip_address)}')" class="ls-btn ls-btn-danger ls-btn-sm">Block</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>

        <!-- Quick Actions -->
        <div class="ls-card">
          <div class="ls-section-title">Quick Actions</div>
          <div class="ls-flex" style="gap:12px">
            <a href="/admin/login-security/lockouts" class="ls-btn">View Lockouts</a>
            <a href="/admin/login-security/suspicious" class="ls-btn" style="background:#f59e0b">Suspicious Activity</a>
            <a href="/admin/login-security/brute-force-alerts" class="ls-btn" style="background:#ef4444">Brute Force Alerts</a>
            <a href="/admin/login-security/export" class="ls-btn" style="background:#8b5cf6">Export CSV</a>
            <a href="/admin/login-security/settings" class="ls-btn" style="background:#64748b">Settings</a>
          </div>
        </div>

        <script>
          // Activity bar chart
          (function(){
            const data = ${JSON.stringify(hourly)};
            const svg = document.getElementById('activityChart');
            if(!data.length){ svg.innerHTML='<text x="480" y="120" fill="#64748b" text-anchor="middle" font-size="14">No data in last 24h</text>'; return; }
            let max = Math.max(...data.map(d=>d.cnt),1);
            const bw = 32, gap = 8, baseY = 220, startX = 40;
            let html = '';
            data.forEach((d,i)=>{
              const x = startX + i*(bw+gap);
              const hOk = (d.ok/max)*180, hFail = (d.fail/max)*180;
              html += '<rect x="'+x+'" y="'+(baseY-hOk)+'" width="'+bw+'" height="'+hOk+'" fill="#34d399" rx="3"/>';
              html += '<rect x="'+x+'" y="'+(baseY-hOk-hFail)+'" width="'+bw+'" height="'+hFail+'" fill="#f87171" rx="3"/>';
              html += '<text x="'+(x+bw/2)+'" y="'+(baseY+14)+'" fill="#64748b" font-size="10" text-anchor="middle">'+d.hr+'h</text>';
            });
            html += '<text x="10" y="30" fill="#34d399" font-size="12">● Success</text>';
            html += '<text x="110" y="30" fill="#f87171" font-size="12">● Failed</text>';
            svg.innerHTML = html;
          })();

          // Reasons donut
          (function(){
            const data = ${JSON.stringify(reasons)};
            const svg = document.getElementById('reasonsPie');
            if(!data.length){ svg.innerHTML='<text x="160" y="110" fill="#64748b" text-anchor="middle" font-size="13">No fail reasons</text>'; return; }
            const colors = ['#f87171','#fbbf24','#34d399','#60a5fa','#c084fc'];
            const cx=110,cy=100,r=70,total=data.reduce((s,d)=>s+d.cnt,0);
            let angle=-90;
            let html = '';
            data.forEach((d,i)=>{
              const sweep = (d.cnt/total)*360;
              const end = angle+sweep;
              const large = sweep>180?1:0;
              html += '<path d="M '+cx+' '+cy+' L '+cx+' '+cy+' A '+r+' '+r+' 0 '+large+' 1 '+(cx+r*Math.cos(end*Math.PI/180))+' '+(cy+r*Math.sin(end*Math.PI/180))+' Z" fill="'+colors[i%colors.length]+'" opacity="0.85"/>';
              const mid = angle+sweep/2;
              const lx = cx+(r+40)*Math.cos(mid*Math.PI/180);
              const ly = cy+(r+40)*Math.sin(mid*Math.PI/180);
              html += '<text x="'+lx+'" y="'+ly+'" fill="#cbd5e1" font-size="10" text-anchor="middle">'+(d.fail_reason||'Unknown').substring(0,15)+' ('+d.cnt+')</text>';
              angle = end;
            });
            html += '<circle cx="'+cx+'" cy="'+cy+'" r="40" fill="#0f172a"/>';
            html += '<text x="'+cx+'" y="'+(cy+4)+'" fill="#e2e8f0" font-size="16" font-weight="700" text-anchor="middle">'+total+'</text>';
            svg.innerHTML = html;
          })();

          async function blockIP(ip){
            if(!confirm('Block IP '+ip+'?')) return;
            const r = await fetch('/admin/login-security/block-ip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ip})});
            if(r.ok) alert('IP '+ip+' blocked'); else alert('Failed to block IP');
          }
        </script>
      `, req.session.user));
    } catch (err) {
      console.error('[login-security dashboard]', err);
      res.status(500).send('Dashboard error');
    }
  });

  /* ------------------------------------------------------------------ */
  /*  2. GET /admin/login-security/data – JSON with filters              */
  /* ------------------------------------------------------------------ */
  app.get('/admin/login-security/data', async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || 1;
      const { page = 1, limit = 50, success, username, ip_address, from, to } = req.query;
      const offset = (page - 1) * limit;
      let where = `WHERE tenant_id = ${esc(tenantId)}`;
      if (success !== undefined) where += ` AND success = ${esc(success === 'true')}`;
      if (username) where += ` AND username ILIKE ${esc('%' + username + '%')}`;
      if (ip_address) where += ` AND ip_address ILIKE ${esc('%' + ip_address + '%')}`;
      if (from) where += ` AND created_at >= ${esc(from)}`;
      if (to) where += ` AND created_at <= ${esc(to)}`;

      const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM login_attempts ${where}`);
      const [rows] = await pool.query(
        `SELECT * FROM login_attempts ${where} ORDER BY created_at DESC LIMIT ${esc(limit)} OFFSET ${esc(offset)}`
      );
      res.json({ total, page: +page, limit: +limit, data: rows });
    } catch (err) {
      console.error('[login-security data]', err);
      res.status(500).json({ error: 'Query failed' });
    }
  });

  /* ------------------------------------------------------------------ */
  /*  3. GET /admin/login-security/lockouts – Active lockouts            */
  /* ------------------------------------------------------------------ */
  app.get('/admin/login-security/lockouts', async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || 1;
      const { show_all } = req.query;
      let where = `WHERE tenant_id = ${esc(tenantId)}`;
      if (show_all !== '1') where += ` AND is_active = true`;

      const [lockouts] = await pool.query(
        `SELECT al.*,
                u.name AS unlocked_by_name
           FROM account_lockouts al
           LEFT JOIN users u ON u.id = al.unlocked_by
          ${where}
          ORDER BY al.locked_at DESC LIMIT 200`
      );

      res.send(opts.renderPage('Account Lockouts', `
        <style>
          .ls-card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;margin-bottom:20px}
          .ls-table{width:100%;border-collapse:collapse;color:#cbd5e1}
          .ls-table th{text-align:left;padding:10px 14px;font-size:.78rem;text-transform:uppercase;letter-spacing:.5px;color:#64748b;border-bottom:1px solid #334155}
          .ls-table td{padding:10px 14px;border-bottom:1px solid #1e293b;font-size:.88rem}
          .ls-table tr:hover td{background:#1e293b}
          .badge-ok{background:#065f46;color:#34d399;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .badge-fail{background:#7f1d1d;color:#f87171;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .ls-btn{background:#3b82f6;color:#fff;border:none;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:.88rem;transition:background .2s}
          .ls-btn:hover{background:#2563eb}
          .ls-btn-danger{background:#ef4444}.ls-btn-danger:hover{background:#dc2626}
          .ls-btn-sm{padding:5px 12px;font-size:.78rem}
          .ls-section-title{font-size:1.15rem;font-weight:600;color:#e2e8f0;margin-bottom:16px}
        </style>

        <div class="ls-card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="ls-section-title" style="margin:0">Active Lockouts (${lockouts.filter(l => l.is_active).length})</div>
            <div>
              <a href="/admin/login-security/lockouts?show_all=1" class="ls-btn ls-btn-sm" style="background:#64748b">Show All</a>
              <a href="/admin/login-security/lockouts" class="ls-btn ls-btn-sm">Active Only</a>
            </div>
          </div>
        </div>

        <div class="ls-card">
          <div id="bulkActions" style="margin-bottom:12px;display:none">
            <button onclick="bulkUnlock()" class="ls-btn" style="background:#10b981">Unlock Selected</button>
            <span id="selectedCount" style="color:#94a3b8;margin-left:10px"></span>
          </div>
          <table class="ls-table">
            <thead>
              <tr>
                <th><input type="checkbox" id="selectAll" onchange="toggleAll(this)"></th>
                <th>ID</th><th>User</th><th>Email</th><th>IP</th>
                <th>Reason</th><th>Failed</th><th>Locked At</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${lockouts.map(l => `<tr data-id="${l.id}">
                <td><input type="checkbox" class="lockout-check" value="${l.id}" onchange="updateBulkUI()"></td>
                <td>${l.id}</td>
                <td>${esc(l.username) || '-'}</td>
                <td>${esc(l.email) || '-'}</td>
                <td style="font-family:monospace;font-size:.82rem">${esc(l.ip_address) || '-'}</td>
                <td>${esc(l.lockout_reason) || '-'}</td>
                <td>${l.failed_attempts}</td>
                <td>${l.locked_at ? new Date(l.locked_at).toLocaleString() : '-'}</td>
                <td><span class="${l.is_active ? 'badge-fail' : 'badge-ok'}">${l.is_active ? 'Locked' : 'Unlocked'}</span></td>
                <td>
                  ${l.is_active ? `<button onclick="unlockAccount(${l.id})" class="ls-btn ls-btn-sm" style="background:#10b981">Unlock</button>` : `<span style="color:#64748b;font-size:.8rem">by ${esc(l.unlocked_by_name) || '-'}<br>${l.unlocked_at ? new Date(l.unlocked_at).toLocaleString() : ''}</span>`}
                </td>
              </tr>`).join('')}
              ${lockouts.length === 0 ? '<tr><td colspan="10" style="text-align:center;color:#64748b;padding:40px">No lockouts found</td></tr>' : ''}
            </tbody>
          </table>
        </div>

        <script>
          function toggleAll(el){
            document.querySelectorAll('.lockout-check').forEach(c=>c.checked=el.checked);
            updateBulkUI();
          }
          function updateBulkUI(){
            const checked = document.querySelectorAll('.lockout-check:checked');
            document.getElementById('bulkActions').style.display = checked.length ? 'block' : 'none';
            document.getElementById('selectedCount').textContent = checked.length + ' selected';
          }
          async function unlockAccount(id){
            if(!confirm('Unlock lockout #'+id+'?')) return;
            const r = await fetch('/admin/login-security/unlock/'+id,{method:'POST'});
            if(r.ok) location.reload(); else alert('Unlock failed');
          }
          async function bulkUnlock(){
            const ids = Array.from(document.querySelectorAll('.lockout-check:checked')).map(c=>c.value);
            if(!ids.length) return;
            if(!confirm('Unlock '+ids.length+' accounts?')) return;
            const r = await fetch('/admin/login-security/bulk-unlock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});
            if(r.ok) location.reload(); else alert('Bulk unlock failed');
          }
        </script>
      `, req.session.user));
    } catch (err) {
      console.error('[login-security lockouts]', err);
      res.status(500).send('Lockouts error');
    }
  });

  /* ------------------------------------------------------------------ */
  /*  4. POST /admin/login-security/unlock/:id – Unlock single          */
  /* ------------------------------------------------------------------ */
  app.post('/admin/login-security/unlock/:id', async (req, res) => {
    try {
      const lockoutId = req.params.id;
      const adminId = req.user?.id || 1;
      await pool.query(
        `UPDATE account_lockouts
           SET is_active = false,
               unlocked_at = NOW(),
               unlocked_by = ${esc(adminId)}
         WHERE id = ${esc(lockoutId)} AND is_active = true`
      );
      /* Also unlock the associated login_attempts record */
      const [[lockout]] = await pool.query(
        `SELECT user_id FROM account_lockouts WHERE id = ${esc(lockoutId)}`
      );
      if (lockout && lockout.user_id) {
        await pool.query(
          `UPDATE login_attempts SET locked = false
            WHERE user_id = ${esc(lockout.user_id)} AND locked = true`
        );
      }
      res.json({ success: true, message: 'Account unlocked' });
    } catch (err) {
      console.error('[login-security unlock]', err);
      res.status(500).json({ error: 'Unlock failed' });
    }
  });

  /* ------------------------------------------------------------------ */
  /*  5. POST /admin/login-security/bulk-unlock – Bulk unlock            */
  /* ------------------------------------------------------------------ */
  app.post('/admin/login-security/bulk-unlock', async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Provide an array of ids' });
      }
      const adminId = req.user?.id || 1;
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      await pool.query(
        `UPDATE account_lockouts
           SET is_active = false, unlocked_at = NOW(), unlocked_by = ${esc(adminId)}
         WHERE id IN (${placeholders}) AND is_active = true`,
        ids
      );
      /* Unlock associated login_attempts */
      const [lockouts] = await pool.query(
        `SELECT DISTINCT user_id FROM account_lockouts WHERE id = ANY($1)`, [ids]
      );
      const userIds = lockouts.map(l => l.user_id).filter(Boolean);
      if (userIds.length) {
        await pool.query(
          `UPDATE login_attempts SET locked = false
            WHERE user_id = ANY($1) AND locked = true`, [userIds]
        );
      }
      res.json({ success: true, unlocked: ids.length });
    } catch (err) {
      console.error('[login-security bulk-unlock]', err);
      res.status(500).json({ error: 'Bulk unlock failed' });
    }
  });

  /* ------------------------------------------------------------------ */
  /*  6. GET /admin/login-security/suspicious – Flagged IPs / users      */
  /* ------------------------------------------------------------------ */
  app.get('/admin/login-security/suspicious', async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || 1;
      const threshold = securitySettings.max_failed_attempts;

      /* Suspicious IPs (>5 failed attempts) */
      const [suspiciousIPs] = await pool.query(
        `SELECT ip_address,
                COUNT(*) AS fail_count,
                MIN(created_at) AS first_seen,
                MAX(created_at) AS last_seen,
                COUNT(DISTINCT username) AS users_targeted,
                BOOL_OR(locked) AS has_locked_account
           FROM login_attempts
          WHERE tenant_id = ${esc(tenantId)} AND success = false AND ip_address IS NOT NULL
          GROUP BY ip_address
         HAVING COUNT(*) > ${esc(threshold)}
          ORDER BY fail_count DESC`
      );

      /* Suspicious usernames (>5 failed attempts) */
      const [suspiciousUsers] = await pool.query(
        `SELECT username, email, COUNT(*) AS fail_count,
                MIN(created_at) AS first_seen,
                MAX(created_at) AS last_seen,
                COUNT(DISTINCT ip_address) AS ips_used,
                BOOL_OR(locked) AS is_locked
           FROM login_attempts
          WHERE tenant_id = ${esc(tenantId)} AND success = false AND username IS NOT NULL
          GROUP BY username, email
         HAVING COUNT(*) > ${esc(threshold)}
          ORDER BY fail_count DESC`
      );

      const blockedList = Array.from(blockedIPs);

      res.send(opts.renderPage('Suspicious Activity', `
        <style>
          .ls-card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;margin-bottom:20px}
          .ls-table{width:100%;border-collapse:collapse;color:#cbd5e1}
          .ls-table th{text-align:left;padding:10px 14px;font-size:.78rem;text-transform:uppercase;letter-spacing:.5px;color:#64748b;border-bottom:1px solid #334155}
          .ls-table td{padding:10px 14px;border-bottom:1px solid #1e293b;font-size:.88rem}
          .ls-table tr:hover td{background:#1e293b}
          .badge-fail{background:#7f1d1d;color:#f87171;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .badge-warn{background:#78350f;color:#fbbf24;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .badge-ok{background:#065f46;color:#34d399;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .ls-btn{background:#3b82f6;color:#fff;border:none;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:.88rem;transition:background .2s}
          .ls-btn:hover{background:#2563eb}
          .ls-btn-danger{background:#ef4444}.ls-btn-danger:hover{background:#dc2626}
          .ls-btn-sm{padding:5px 12px;font-size:.78rem}
          .ls-section-title{font-size:1.15rem;font-weight:600;color:#e2e8f0;margin-bottom:16px}
          .threat-bar{height:6px;border-radius:3px;background:#1e293b;overflow:hidden;margin-top:4px}
          .threat-bar-fill{height:100%;border-radius:3px;transition:width .4s}
        </style>

        <!-- Blocked IPs Banner -->
        ${blockedList.length ? `
        <div class="ls-card" style="border-color:#ef4444">
          <div class="ls-section-title" style="color:#f87171">Blocked IPs (${blockedList.length})</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${blockedList.map(ip => `<span style="background:#7f1d1d;color:#f87171;padding:4px 12px;border-radius:6px;font-family:monospace;font-size:.85rem">${esc(ip)}</span>`).join('')}
          </div>
        </div>` : ''}

        <!-- Suspicious IPs -->
        <div class="ls-card">
          <div class="ls-section-title">Suspicious IPs (> ${threshold} failed attempts) — ${suspiciousIPs.length} found</div>
          <table class="ls-table">
            <thead><tr><th>IP Address</th><th>Failed Count</th><th>Users Targeted</th><th>First Seen</th><th>Last Seen</th><th>Risk</th><th>Actions</th></tr></thead>
            <tbody>
              ${suspiciousIPs.map(r => {
                const risk = r.fail_count > 20 ? 'High' : r.fail_count > 10 ? 'Medium' : 'Low';
                const riskColor = r.fail_count > 20 ? '#ef4444' : r.fail_count > 10 ? '#fbbf24' : '#34d399';
                const riskPct = Math.min((r.fail_count / 30) * 100, 100);
                return `<tr>
                  <td style="font-family:monospace">${esc(r.ip_address)}</td>
                  <td><span class="badge-fail">${r.fail_count}</span></td>
                  <td>${r.users_targeted}</td>
                  <td style="font-size:.82rem">${r.first_seen ? new Date(r.first_seen).toLocaleDateString() : '-'}</td>
                  <td style="font-size:.82rem">${r.last_seen ? new Date(r.last_seen).toLocaleDateString() : '-'}</td>
                  <td>
                    <span style="color:${riskColor};font-weight:600">${risk}</span>
                    <div class="threat-bar"><div class="threat-bar-fill" style="width:${riskPct}%;background:${riskColor}"></div></div>
                  </td>
                  <td>
                    <a href="/admin/login-security/by-ip/${esc(r.ip_address)}" class="ls-btn ls-btn-sm">View All</a>
                    <button onclick="blockIP('${esc(r.ip_address)}')" class="ls-btn ls-btn-danger ls-btn-sm">Block</button>
                  </td>
                </tr>`;
              }).join('')}
              ${suspiciousIPs.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:40px">No suspicious IPs detected</td></tr>' : ''}
            </tbody>
          </table>
        </div>

        <!-- Suspicious Users -->
        <div class="ls-card">
          <div class="ls-section-title">Suspicious Usernames (> ${threshold} failed attempts) — ${suspiciousUsers.length} found</div>
          <table class="ls-table">
            <thead><tr><th>Username</th><th>Email</th><th>Failed Count</th><th>IPs Used</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              ${suspiciousUsers.map(r => `<tr>
                <td>${esc(r.username)}</td>
                <td style="font-size:.82rem">${esc(r.email) || '-'}</td>
                <td><span class="badge-warn">${r.fail_count}</span></td>
                <td>${r.ips_used}</td>
                <td><span class="${r.is_locked ? 'badge-fail' : 'badge-ok'}">${r.is_locked ? 'Locked' : 'Active'}</span></td>
                <td>
                  <a href="/admin/login-security/timeline?username=${encodeURIComponent(esc(r.username))}" class="ls-btn ls-btn-sm">Timeline</a>
                </td>
              </tr>`).join('')}
              ${suspiciousUsers.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:40px">No suspicious usernames</td></tr>' : ''}
            </tbody>
          </table>
        </div>

        <script>
          async function blockIP(ip){
            if(!confirm('Block IP '+ip+'? This will reject future logins from this address.')) return;
            const r = await fetch('/admin/login-security/block-ip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ip})});
            if(r.ok) location.reload(); else alert('Failed to block IP');
          }
        </script>
      `, req.session.user));
    } catch (err) {
      console.error('[login-security suspicious]', err);
      res.status(500).send('Suspicious activity error');
    }
  });

  /* ------------------------------------------------------------------ */
  /*  7. GET /admin/login-security/stats – Login statistics              */
  /* ------------------------------------------------------------------ */
  app.get('/admin/login-security/stats', async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || 1;

      /* Success vs failure totals */
      const [[totals]] = await pool.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE success = true)  AS successes,
                COUNT(*) FILTER (WHERE success = false) AS failures
           FROM login_attempts WHERE tenant_id = ${esc(tenantId)}`
      );

      /* Daily trend (last 30 days) */
      const [dailyTrend] = await pool.query(
        `SELECT DATE(created_at) AS day,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE success = true)  AS ok,
                COUNT(*) FILTER (WHERE success = false) AS fail
           FROM login_attempts
          WHERE tenant_id = ${esc(tenantId)} AND created_at > NOW() - INTERVAL '30 days'
          GROUP BY day ORDER BY day`
      );

      /* Peak hours */
      const [peakHours] = await pool.query(
        `SELECT EXTRACT(HOUR FROM created_at)::int AS hr,
                COUNT(*) AS cnt
           FROM login_attempts WHERE tenant_id = ${esc(tenantId)}
          GROUP BY hr ORDER BY cnt DESC LIMIT 10`
      );

      /* Day of week distribution */
      const [dowDist] = await pool.query(
        `SELECT EXTRACT(DOW FROM created_at)::int AS dow,
                COUNT(*) AS cnt,
                COUNT(*) FILTER (WHERE success = false) AS fail_cnt
           FROM login_attempts WHERE tenant_id = ${esc(tenantId)}
          GROUP BY dow ORDER BY dow`
      );

      /* Unique users who logged in (7d) */
      const [[{ weekly_active }]] = await pool.query(
        `SELECT COUNT(DISTINCT COALESCE(username, email)) AS weekly_active
           FROM login_attempts
          WHERE tenant_id = ${esc(tenantId)} AND success = true AND created_at > NOW() - INTERVAL '7 days'`
      );

      const [[{ monthly_active }]] = await pool.query(
        `SELECT COUNT(DISTINCT COALESCE(username, email)) AS monthly_active
           FROM login_attempts
          WHERE tenant_id = ${esc(tenantId)} AND success = true AND created_at > NOW() - INTERVAL '30 days'`
      );

      res.send(opts.renderPage('Login Statistics', `
        <style>
          .ls-card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;margin-bottom:20px}
          .ls-kpi{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;text-align:center}
          .ls-kpi .num{font-size:2rem;font-weight:700;color:#3b82f6}
          .ls-kpi .lbl{font-size:.8rem;color:#94a3b8;margin-top:4px}
          .ls-section-title{font-size:1.15rem;font-weight:600;color:#e2e8f0;margin-bottom:16px}
          .ls-flex{display:flex;gap:16px;flex-wrap:wrap}
          .ls-flex > *{flex:1;min-width:160px}
          .stat-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1e293b;color:#cbd5e1;font-size:.9rem}
          .stat-row:last-child{border-bottom:none}
        </style>

        <div class="ls-flex" style="margin-bottom:20px">
          <div class="ls-kpi"><div class="num">${totals.total}</div><div class="lbl">Total Attempts</div></div>
          <div class="ls-kpi"><div class="num" style="color:#34d399">${totals.successes}</div><div class="lbl">Successes</div></div>
          <div class="ls-kpi"><div class="num" style="color:#f87171">${totals.failures}</div><div class="lbl">Failures</div></div>
          <div class="ls-kpi"><div class="num" style="color:#fbbf24">${totals.total ? ((totals.successes / totals.total) * 100).toFixed(1) : '100'}%</div><div class="lbl">Success Rate</div></div>
          <div class="ls-kpi"><div class="num" style="color:#c084fc">${weekly_active}</div><div class="lbl">Weekly Active</div></div>
          <div class="ls-kpi"><div class="num" style="color:#22d3ee">${monthly_active}</div><div class="lbl">Monthly Active</div></div>
        </div>

        <!-- 30-Day Trend Chart -->
        <div class="ls-card">
          <div class="ls-section-title">30-Day Login Trend</div>
          <svg id="trendChart" width="100%" height="260" viewBox="0 0 960 260"></svg>
        </div>

        <div class="ls-flex">
          <!-- Peak Hours -->
          <div class="ls-card">
            <div class="ls-section-title">Peak Login Hours</div>
            <svg id="peakChart" width="100%" height="220" viewBox="0 0 360 220"></svg>
          </div>

          <!-- Day of Week -->
          <div class="ls-card">
            <div class="ls-section-title">Activity by Day of Week</div>
            <svg id="dowChart" width="100%" height="220" viewBox="0 0 360 220"></svg>
          </div>
        </div>

        <script>
          // 30-day trend area chart
          (function(){
            const data = ${JSON.stringify(dailyTrend)};
            const svg = document.getElementById('trendChart');
            if(!data.length){ svg.innerHTML='<text x="480" y="130" fill="#64748b" text-anchor="middle">No data</text>'; return; }
            let max = Math.max(...data.map(d=>d.total),1);
            const w=960,h=260,pad=50,chartW=w-pad*2,chartH=h-60;
            let html = '';
            // Grid lines
            for(let i=0;i<=4;i++){
              const y=pad+i*(chartH/4);
              html+='<line x1="'+pad+'" y1="'+y+'" x2="'+(w-pad)+'" y2="'+y+'" stroke="#334155" stroke-width=".5"/>';
              html+='<text x="'+(pad-8)+'" y="'+(y+4)+'" fill="#64748b" font-size="10" text-anchor="end">'+Math.round(max*(1-i/4))+'</text>';
            }
            // Success area
            let successPath='M'+pad+' '+(pad+chartH);
            let failPath='M'+pad+' '+(pad+chartH);
            data.forEach((d,i)=>{
              const x=pad+(i/(data.length-1))*chartW;
              const sy=pad+chartH-(d.ok/max)*chartH;
              const fy=pad+chartH-(d.fail/max)*chartH;
              successPath+=' L'+x+' '+sy;
              failPath+=' L'+x+' '+fy;
              if(i%5===0||i===data.length-1){
                html+='<text x="'+x+'" y="'+(h-10)+'" fill="#64748b" font-size="10" text-anchor="middle">'+d.day+'</text>';
              }
            });
            successPath+=' L'+(w-pad)+' '+(pad+chartH)+' Z';
            failPath+=' L'+(w-pad)+' '+(pad+chartH)+' Z';
            html+='<path d="'+failPath+'" fill="rgba(248,113,113,0.2)"/>';
            html+='<path d="'+successPath+'" fill="rgba(52,211,153,0.3)"/>';
            html+='<text x="'+(w-120)+'" y="30" fill="#34d399" font-size="11">● Successful</text>';
            html+='<text x="'+(w-120)+'" y="46" fill="#f87171" font-size="11">● Failed</text>';
            svg.innerHTML = html;
          })();

          // Peak hours bar chart
          (function(){
            const data = ${JSON.stringify(peakHours)};
            const svg = document.getElementById('peakChart');
            if(!data.length) return;
            let max = data[0].cnt;
            const days = ['12am','1am','2am','3am','4am','5am','6am','7am','8am','9am','10am','11am','12pm','1pm','2pm','3pm','4pm','5pm','6pm','7pm','8pm','9pm','10pm','11pm'];
            let html='';
            data.forEach((d,i)=>{
              const bw=28, x=20+i*34, h=(d.cnt/max)*160, y=190-h;
              const color = d.cnt===max ? '#fbbf24' : '#3b82f6';
              html+='<rect x="'+x+'" y="'+y+'" width="'+bw+'" height="'+h+'" fill="'+color+'" rx="4" opacity="0.85"/>';
              html+='<text x="'+(x+bw/2)+'" y="'+(y-4)+'" fill="#cbd5e1" font-size="10" text-anchor="middle">'+d.cnt+'</text>';
              html+='<text x="'+(x+bw/2)+'" y="'+(204)+'" fill="#64748b" font-size="9" text-anchor="middle">'+days[d.hr]+'</text>';
            });
            svg.innerHTML = html;
          })();

          // Day of week chart
          (function(){
            const data = ${JSON.stringify(dowDist)};
            const svg = document.getElementById('dowChart');
            const names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            let max = Math.max(...data.map(d=>d.cnt),1);
            let html='';
            data.forEach(d=>{
              const i=d.dow, bw=36, x=14+i*48, h=(d.cnt/max)*150, y=170-h;
              const failH = (d.fail_cnt/max)*150;
              html+='<rect x="'+x+'" y="'+y+'" width="'+bw+'" height="'+h+'" fill="#3b82f6" rx="4" opacity="0.85"/>';
              html+='<rect x="'+x+'" y="'+(y+h-failH)+'" width="'+bw+'" height="'+failH+'" fill="#f87171" rx="0" opacity="0.7"/>';
              html+='<text x="'+(x+bw/2)+'" y="'+(y-4)+'" fill="#cbd5e1" font-size="10" text-anchor="middle">'+d.cnt+'</text>';
              html+='<text x="'+(x+bw/2)+'" y="'+(186)+'" fill="#64748b" font-size="11" text-anchor="middle">'+names[i]+'</text>';
            });
            svg.innerHTML = html;
          })();
        </script>
      `, req.session.user));
    } catch (err) {
      console.error('[login-security stats]', err);
      res.status(500).send('Stats error');
    }
  });

  /* ------------------------------------------------------------------ */
  /*  8. GET /admin/login-security/export – Export CSV                   */
  /* ------------------------------------------------------------------ */
  app.get('/admin/login-security/export', async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || 1;
      const { from, to, success, username, format } = req.query;
      let where = `WHERE tenant_id = ${esc(tenantId)}`;
      if (from) where += ` AND created_at >= ${esc(from)}`;
      if (to) where += ` AND created_at <= ${esc(to)}`;
      if (success !== undefined) where += ` AND success = ${esc(success === 'true')}`;
      if (username) where += ` AND (username ILIKE ${esc('%' + username + '%')} OR email ILIKE ${esc('%' + username + '%')})`;

      const [rows] = await pool.query(
        `SELECT id, username, email, ip_address, user_agent, success, fail_reason,
                user_id, locked, created_at, tenant_id
           FROM login_attempts ${where} ORDER BY created_at DESC LIMIT 100000`
      );

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=login-attempts.json');
        return res.json(rows);
      }

      /* CSV */
      const header = 'ID,Username,Email,IP Address,User Agent,Success,Fail Reason,User ID,Locked,Created At,School ID\n';
      const csvBody = rows.map(r =>
        [r.id, csvEscape(r.username), csvEscape(r.email), csvEscape(r.ip_address),
         csvEscape(r.user_agent), r.success, csvEscape(r.fail_reason),
         r.user_id, r.locked, r.created_at, r.tenant_id].join(',')
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=login-attempts-${new Date().toISOString().slice(0,10)}.csv`);
      res.send(header + csvBody);
    } catch (err) {
      console.error('[login-security export]', err);
      res.status(500).send('Export error');
    }
  });

  function csvEscape(val) {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /* ------------------------------------------------------------------ */
  /*  9. DELETE /admin/login-security/cleanup – Clean old logs           */
  /* ------------------------------------------------------------------ */
  app.delete('/admin/login-security/cleanup', async (req, res) => {
    try {
      const { days = 90 } = req.body;
      const tenantId = req.user?.tenant_id || 1;
      const retainDays = Math.max(Number(days), 1);

      const [delAttempts] = await pool.query(
        `DELETE FROM login_attempts
          WHERE tenant_id = ${esc(tenantId)}
            AND created_at < NOW() - INTERVAL '${esc(retainDays)} days'
          RETURNING id`
      );
      const [delLockouts] = await pool.query(
        `DELETE FROM account_lockouts
          WHERE tenant_id = ${esc(tenantId)}
            AND is_active = false
            AND locked_at < NOW() - INTERVAL '${esc(retainDays)} days'
          RETURNING id`
      );

      res.json({
        success: true,
        deleted_attempts: delAttempts.length,
        deleted_lockouts: delLockouts.length,
        retained_days: retainDays,
        message: `Cleaned ${delAttempts.length} attempts and ${delLockouts.length} old lockouts older than ${retainDays} days`,
      });
    } catch (err) {
      console.error('[login-security cleanup]', err);
      res.status(500).json({ error: 'Cleanup failed' });
    }
  });

  /* ------------------------------------------------------------------ */
  /*  10. GET /admin/login-security/settings – Security settings         */
  /* ------------------------------------------------------------------ */
  app.get('/admin/login-security/settings', async (req, res) => {
    res.send(opts.renderPage('Security Settings', `
      <style>
        .ls-card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:28px;margin-bottom:20px}
        .ls-section-title{font-size:1.15rem;font-weight:600;color:#e2e8f0;margin-bottom:20px}
        .form-group{margin-bottom:20px}
        .form-group label{display:block;color:#94a3b8;font-size:.85rem;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px}
        .form-group input,.form-group select{width:100%;max-width:360px;background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:10px 14px;border-radius:8px;font-size:.95rem}
        .form-group input:focus{outline:none;border-color:#3b82f6}
        .form-group .hint{color:#64748b;font-size:.78rem;margin-top:4px}
        .ls-btn{background:#3b82f6;color:#fff;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:.9rem;transition:background .2s}
        .ls-btn:hover{background:#2563eb}
        .ls-btn-danger{background:#ef4444}.ls-btn-danger:hover{background:#dc2626}
        .ls-btn-sm{padding:6px 14px;font-size:.82rem}
        .toggle-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #1e293b}
        .toggle-row:last-child{border-bottom:none}
        .toggle-switch{position:relative;width:44px;height:24px;cursor:pointer}
        .toggle-switch input{display:none}
        .toggle-switch .slider{position:absolute;inset:0;background:#334155;border-radius:12px;transition:.3s}
        .toggle-switch .slider:before{content:'';position:absolute;width:18px;height:18px;left:3px;top:3px;background:#94a3b8;border-radius:50%;transition:.3s}
        .toggle-switch input:checked + .slider{background:#3b82f6}
        .toggle-switch input:checked + .slider:before{transform:translateX(20px);background:#fff}
      </style>

      <div class="ls-card">
        <div class="ls-section-title">Login Security Configuration</div>
        <form id="settingsForm">
          <div class="form-group">
            <label>Max Failed Attempts Before Lockout</label>
            <input type="number" name="max_failed_attempts" value="${securitySettings.max_failed_attempts}" min="1" max="50">
            <div class="hint">Number of consecutive failed login attempts before account is locked</div>
          </div>
          <div class="form-group">
            <label>Lockout Duration (minutes)</label>
            <input type="number" name="lockout_duration_minutes" value="${securitySettings.lockout_duration_minutes}" min="1" max="10080">
            <div class="hint">How long an account remains locked (max 10080 = 7 days)</div>
          </div>
          <div class="form-group">
            <label>Brute Force Threshold</label>
            <input type="number" name="brute_force_threshold" value="${securitySettings.brute_force_threshold}" min="5" max="100">
            <div class="hint">Failed attempts from one IP within the window to trigger brute-force alert</div>
          </div>
          <div class="form-group">
            <label>Brute Force Detection Window (minutes)</label>
            <input type="number" name="brute_force_window_minutes" value="${securitySettings.brute_force_window_minutes}" min="1" max="1440">
            <div class="hint">Time window for counting failed attempts for brute-force detection</div>
          </div>
          <div class="form-group">
            <label>Auto-Cleanup Retention (days)</label>
            <input type="number" name="auto_cleanup_days" value="${securitySettings.auto_cleanup_days}" min="7" max="365">
            <div class="hint">Login attempts older than this are eligible for cleanup</div>
          </div>
          <div class="form-group">
            <label>IP Block Threshold</label>
            <input type="number" name="block_ip_threshold" value="${securitySettings.block_ip_threshold}" min="10" max="200">
            <div class="hint">Failed attempts from one IP before it's flagged for blocking</div>
          </div>

          <div style="margin-top:24px;padding-top:20px;border-top:1px solid #334155">
            <div class="toggle-row">
              <div>
                <div style="color:#e2e8f0;font-weight:500">Notify on Account Lockout</div>
                <div style="color:#64748b;font-size:.82rem">Send notification when an account is auto-locked</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" name="notify_on_lockout" ${securitySettings.notify_on_lockout ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
            <div class="toggle-row">
              <div>
                <div style="color:#e2e8f0;font-weight:500">Notify on Brute Force Detection</div>
                <div style="color:#64748b;font-size:.82rem">Alert administrators when brute-force patterns are detected</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" name="notify_on_brute_force" ${securitySettings.notify_on_brute_force ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
          </div>

          <div style="margin-top:24px;display:flex;gap:12px">
            <button type="submit" class="ls-btn">Save Settings</button>
            <button type="button" onclick="runCleanup()" class="ls-btn ls-btn-danger">Run Cleanup Now</button>
          </div>
        </form>
      </div>

      <!-- Cleanup History Placeholder -->
      <div class="ls-card">
        <div class="ls-section-title">Maintenance</div>
        <p style="color:#94a3b8;font-size:.88rem">Use the cleanup button above to remove old login attempt records. Records older than <strong style="color:#e2e8f0">${securitySettings.auto_cleanup_days} days</strong> will be removed. Inactive lockout records are also cleaned.</p>
        <div style="margin-top:16px">
          <a href="/admin/login-security/export" class="ls-btn ls-btn-sm" style="background:#8b5cf6">Export All Data (CSV)</a>
          <a href="/admin/login-security/export?format=json" class="ls-btn ls-btn-sm" style="background:#6366f1">Export as JSON</a>
        </div>
      </div>

      <div id="toast" style="position:fixed;bottom:24px;right:24px;background:#065f46;color:#34d399;padding:14px 24px;border-radius:10px;display:none;font-weight:500;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,.3)"></div>

      <script>
        document.getElementById('settingsForm').addEventListener('submit', async function(e){
          e.preventDefault();
          const fd = new FormData(this);
          const data = {
            max_failed_attempts: +fd.get('max_failed_attempts'),
            lockout_duration_minutes: +fd.get('lockout_duration_minutes'),
            brute_force_threshold: +fd.get('brute_force_threshold'),
            brute_force_window_minutes: +fd.get('brute_force_window_minutes'),
            auto_cleanup_days: +fd.get('auto_cleanup_days'),
            block_ip_threshold: +fd.get('block_ip_threshold'),
            notify_on_lockout: !!fd.get('notify_on_lockout'),
            notify_on_brute_force: !!fd.get('notify_on_brute_force'),
          };
          const r = await fetch('/admin/login-security/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
          if(r.ok) showToast('Settings saved successfully');
          else showToast('Failed to save settings');
        });
        async function runCleanup(){
          const days = prompt('Delete records older than how many days?', ${securitySettings.auto_cleanup_days});
          if(!days) return;
          const r = await fetch('/admin/login-security/cleanup',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({days:+days})});
          if(r.ok){ const d = await r.json(); showToast('Cleaned '+d.deleted_attempts+' attempts, '+d.deleted_lockouts+' lockouts'); }
          else showToast('Cleanup failed');
        }
        function showToast(msg){
          const t = document.getElementById('toast');
          t.textContent = msg; t.style.display = 'block';
          setTimeout(()=>t.style.display='none', 3500);
        }
      </script>
    `, req.session.user));
  });

  /* ------------------------------------------------------------------ */
  /*  11. PUT /admin/login-security/settings – Update settings           */
  /* ------------------------------------------------------------------ */
  app.put('/admin/login-security/settings', async (req, res) => {
    try {
      const {
        max_failed_attempts,
        lockout_duration_minutes,
        brute_force_threshold,
        brute_force_window_minutes,
        auto_cleanup_days,
        block_ip_threshold,
        notify_on_lockout,
        notify_on_brute_force,
      } = req.body;

      /* Validate */
      if (max_failed_attempts < 1 || max_failed_attempts > 50) {
        return res.status(400).json({ error: 'max_failed_attempts must be 1-50' });
      }
      if (lockout_duration_minutes < 1 || lockout_duration_minutes > 10080) {
        return res.status(400).json({ error: 'lockout_duration_minutes must be 1-10080' });
      }

      Object.assign(securitySettings, {
        max_failed_attempts: Number(max_failed_attempts) || securitySettings.max_failed_attempts,
        lockout_duration_minutes: Number(lockout_duration_minutes) || securitySettings.lockout_duration_minutes,
        brute_force_threshold: Number(brute_force_threshold) || securitySettings.brute_force_threshold,
        brute_force_window_minutes: Number(brute_force_window_minutes) || securitySettings.brute_force_window_minutes,
        auto_cleanup_days: Number(auto_cleanup_days) || securitySettings.auto_cleanup_days,
        block_ip_threshold: Number(block_ip_threshold) || securitySettings.block_ip_threshold,
        notify_on_lockout: !!notify_on_lockout,
        notify_on_brute_force: !!notify_on_brute_force,
      });

      res.json({ success: true, settings: securitySettings });
    } catch (err) {
      console.error('[login-security settings update]', err);
      res.status(500).json({ error: 'Settings update failed' });
    }
  });

  /* ------------------------------------------------------------------ */
  /*  12. POST /admin/login-security/block-ip – Block IP                 */
  /* ------------------------------------------------------------------ */
  app.post('/admin/login-security/block-ip', async (req, res) => {
    try {
      const { ip } = req.body;
      if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
        return res.status(400).json({ error: 'Invalid IP address format' });
      }
      blockedIPs.add(ip);

      /* Optional: persist to a blocked_ips table if it exists */
      try {
        await pool.query(
          `INSERT INTO blocked_ips (ip_address, blocked_by, blocked_at, tenant_id)
           VALUES (${esc(ip)}, ${esc(req.user?.id || 1)}, NOW(), ${esc(req.user?.tenant_id || 1)})
           ON CONFLICT (ip_address) DO NOTHING`
        );
      } catch (_) {
        /* Table may not exist yet; that's fine, we keep in-memory */
      }

      /* Log the blocking action */
      try {
        await pool.query(
          `INSERT INTO login_attempts (username, ip_address, success, fail_reason, tenant_id)
           VALUES ('SYSTEM', ${esc(ip)}, false, 'IP_BLOCKED', ${esc(req.user?.tenant_id || 1)})`
        );
      } catch (_) { /* ignore */ }

      res.json({ success: true, message: `IP ${ip} blocked`, blocked_count: blockedIPs.size });
    } catch (err) {
      console.error('[login-security block-ip]', err);
      res.status(500).json({ error: 'Failed to block IP' });
    }
  });

  /* Middleware: check blocked IPs on login attempts */
  function isIPBlocked(ip) {
    return blockedIPs.has(ip);
  }

  /* ------------------------------------------------------------------ */
  /*  13. GET /admin/login-security/timeline – User login timeline       */
  /* ------------------------------------------------------------------ */
  app.get('/admin/login-security/timeline', async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || 1;
      const { username, user_id, email } = req.query;

      let where = `WHERE tenant_id = ${esc(tenantId)}`;
      if (user_id) {
        where += ` AND user_id = ${esc(user_id)}`;
      } else if (username) {
        where += ` AND username = ${esc(username)}`;
      } else if (email) {
        where += ` AND email = ${esc(email)}`;
      } else {
        return res.status(400).send('Provide username, user_id, or email');
      }

      const [timeline] = await pool.query(
        `SELECT * FROM login_attempts ${where} ORDER BY created_at DESC LIMIT 200`
      );
      const [[summary]] = await pool.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE success = true) AS successes,
                COUNT(*) FILTER (WHERE success = false) AS failures,
                COUNT(DISTINCT ip_address) AS unique_ips,
                MIN(created_at) AS first_seen,
                MAX(created_at) AS last_seen
           FROM login_attempts ${where}`
      );

      /* Check for active lockout */
      const lockoutWhere = summary.username
        ? `WHERE username = ${esc(username || '')} AND tenant_id = ${esc(tenantId)} AND is_active = true`
        : `WHERE user_id = ${esc(user_id)} AND tenant_id = ${esc(tenantId)} AND is_active = true`;
      const [activeLockout] = await pool.query(
        `SELECT * FROM account_lockouts ${lockoutWhere} LIMIT 1`
      );

      const targetUser = username || email || `User #${user_id}`;

      res.send(opts.renderPage(`Login Timeline: ${targetUser}`, `
        <style>
          .ls-card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;margin-bottom:20px}
          .ls-table{width:100%;border-collapse:collapse;color:#cbd5e1}
          .ls-table th{text-align:left;padding:10px 14px;font-size:.78rem;text-transform:uppercase;letter-spacing:.5px;color:#64748b;border-bottom:1px solid #334155}
          .ls-table td{padding:10px 14px;border-bottom:1px solid #1e293b;font-size:.88rem}
          .ls-table tr:hover td{background:#1e293b}
          .badge-ok{background:#065f46;color:#34d399;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .badge-fail{background:#7f1d1d;color:#f87171;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .ls-section-title{font-size:1.15rem;font-weight:600;color:#e2e8f0;margin-bottom:16px}
          .ls-flex{display:flex;gap:16px;flex-wrap:wrap}
          .ls-flex > *{flex:1;min-width:160px}
          .ls-kpi{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px;text-align:center}
          .ls-kpi .num{font-size:1.6rem;font-weight:700;color:#3b82f6}
          .ls-kpi .lbl{font-size:.78rem;color:#94a3b8;margin-top:2px}
          .timeline-dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:8px}
          .timeline-dot.ok{background:#34d399}
          .timeline-dot.fail{background:#f87171}
          .lockout-banner{background:linear-gradient(135deg,#7f1d1d,#450a0a);border:1px solid #ef4444;border-radius:12px;padding:20px;margin-bottom:20px;color:#fca5a5}
        </style>

        ${activeLockout.length ? `
        <div class="lockout-banner">
          <div style="font-weight:700;font-size:1.05rem;margin-bottom:6px">Account is LOCKED</div>
          <div>Reason: ${esc(activeLockout[0].lockout_reason) || 'Too many failed attempts'}</div>
          <div>Locked at: ${new Date(activeLockout[0].locked_at).toLocaleString()}</div>
          <div>Failed attempts: ${activeLockout[0].failed_attempts}</div>
          <button onclick="unlockAccount(${activeLockout[0].id})" style="margin-top:10px;background:#ef4444;color:#fff;border:none;padding:8px 20px;border-radius:8px;cursor:pointer">Unlock Account</button>
        </div>` : ''}

        <!-- Summary KPIs -->
        <div class="ls-flex" style="margin-bottom:20px">
          <div class="ls-kpi"><div class="num">${summary.total}</div><div class="lbl">Total Attempts</div></div>
          <div class="ls-kpi"><div class="num" style="color:#34d399">${summary.successes}</div><div class="lbl">Successes</div></div>
          <div class="ls-kpi"><div class="num" style="color:#f87171">${summary.failures}</div><div class="lbl">Failures</div></div>
          <div class="ls-kpi"><div class="num" style="color:#c084fc">${summary.unique_ips}</div><div class="lbl">Unique IPs</div></div>
          <div class="ls-kpi"><div class="num" style="color:#22d3ee">${summary.total ? ((summary.successes / summary.total) * 100).toFixed(1) : '-'}%</div><div class="lbl">Success Rate</div></div>
        </div>

        <!-- Hourly distribution chart -->
        <div class="ls-card">
          <div class="ls-section-title">Attempt Timeline</div>
          <svg id="timelineChart" width="100%" height="200" viewBox="0 0 960 200"></svg>
        </div>

        <!-- Detailed Table -->
        <div class="ls-card">
          <div class="ls-section-title">Detailed Log (${timeline.length} entries)</div>
          <table class="ls-table">
            <thead><tr><th>Time</th><th>IP</th><th>User Agent</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>
              ${timeline.map(r => `<tr>
                <td style="white-space:nowrap">${r.created_at ? new Date(r.created_at).toLocaleString() : '-'}</td>
                <td style="font-family:monospace;font-size:.82rem">${esc(r.ip_address) || '-'}</td>
                <td style="font-size:.8rem;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.user_agent || '')}">${esc(r.user_agent ? r.user_agent.substring(0, 60) + '...' : '-')}</td>
                <td><span class="timeline-dot ${r.success ? 'ok' : 'fail'}"></span>${r.success ? 'OK' : 'FAIL'}</td>
                <td>${esc(r.fail_reason) || '-'}</td>
              </tr>`).join('')}
              ${timeline.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:40px">No attempts found for this user</td></tr>' : ''}
            </tbody>
          </table>
        </div>

        <script>
          // Timeline scatter plot
          (function(){
            const data = ${JSON.stringify(timeline)};
            const svg = document.getElementById('timelineChart');
            if(!data.length){ svg.innerHTML='<text x="480" y="100" fill="#64748b" text-anchor="middle">No data</text>'; return; }
            const minT = new Date(data[data.length-1].created_at).getTime();
            const maxT = new Date(data[0].created_at).getTime();
            const range = maxT-minT||1;
            const pad=50,w=960,h=200;
            let html='';
            // Draw axes
            html+='<line x1="'+pad+'" y1="'+(h-30)+'" x2="'+(w-20)+'" y2="'+(h-30)+'" stroke="#334155"/>';
            html+='<line x1="'+pad+'" y1="10" x2="'+pad+'" y2="'+(h-30)+'" stroke="#334155"/>';
            // Scatter dots
            data.forEach((d,i)=>{
              const x = pad + ((new Date(d.created_at).getTime()-minT)/range)*(w-pad-40);
              const y = d.success ? 50 : 130;
              const color = d.success ? '#34d399' : '#f87171';
              html+='<circle cx="'+x+'" cy="'+y+'" r="4" fill="'+color+'" opacity="0.8"/>';
            });
            html+='<text x="'+pad+'" y="54" fill="#34d399" font-size="10">Success</text>';
            html+='<text x="'+pad+'" y="134" fill="#f87171" font-size="10">Failed</text>';
            html+='<text x="'+(w/2)+'" y="'+(h-8)+'" fill="#64748b" font-size="10" text-anchor="middle">Time →</text>';
            svg.innerHTML = html;
          })();

          async function unlockAccount(id){
            if(!confirm('Unlock this account?')) return;
            const r = await fetch('/admin/login-security/unlock/'+id,{method:'POST'});
            if(r.ok) location.reload(); else alert('Failed');
          }
        </script>
      `, req.session.user));
    } catch (err) {
      console.error('[login-security timeline]', err);
      res.status(500).send('Timeline error');
    }
  });

  /* ------------------------------------------------------------------ */
  /*  14. GET /admin/login-security/by-ip/:ip – Attempts from IP        */
  /* ------------------------------------------------------------------ */
  app.get('/admin/login-security/by-ip/:ip', async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || 1;
      const ipAddress = req.params.ip;

      const [attempts] = await pool.query(
        `SELECT * FROM login_attempts
          WHERE tenant_id = ${esc(tenantId)} AND ip_address = ${esc(ipAddress)}
          ORDER BY created_at DESC LIMIT 500`
      );
      const [[summary]] = await pool.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE success = true) AS successes,
                COUNT(*) FILTER (WHERE success = false) AS failures,
                COUNT(DISTINCT username) AS unique_users,
                COUNT(DISTINCT user_agent) AS unique_agents,
                MIN(created_at) AS first_seen,
                MAX(created_at) AS last_seen
           FROM login_attempts
          WHERE tenant_id = ${esc(tenantId)} AND ip_address = ${esc(ipAddress)}`
      );

      /* User agent breakdown */
      const [uaBreakdown] = await pool.query(
        `SELECT CASE
                  WHEN user_agent ILIKE '%Mobile%' OR user_agent ILIKE '%Android%' OR user_agent ILIKE '%iPhone%'
                    THEN 'Mobile'
                  WHEN user_agent ILIKE '%Tablet%' OR user_agent ILIKE '%iPad%'
                    THEN 'Tablet'
                  ELSE 'Desktop'
                END AS device_type,
                COUNT(*) AS cnt
           FROM login_attempts
          WHERE tenant_id = ${esc(tenantId)} AND ip_address = ${esc(ipAddress)}
          GROUP BY device_type ORDER BY cnt DESC`
      );

      const isBlocked = blockedIPs.has(ipAddress);
      const isSuspicious = summary.failures > securitySettings.max_failed_attempts;

      res.send(opts.renderPage(`IP Activity: ${ipAddress}`, `
        <style>
          .ls-card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;margin-bottom:20px}
          .ls-table{width:100%;border-collapse:collapse;color:#cbd5e1}
          .ls-table th{text-align:left;padding:10px 14px;font-size:.78rem;text-transform:uppercase;letter-spacing:.5px;color:#64748b;border-bottom:1px solid #334155}
          .ls-table td{padding:10px 14px;border-bottom:1px solid #1e293b;font-size:.88rem}
          .ls-table tr:hover td{background:#1e293b}
          .badge-ok{background:#065f46;color:#34d399;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .badge-fail{background:#7f1d1d;color:#f87171;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .badge-warn{background:#78350f;color:#fbbf24;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .ls-btn{background:#3b82f6;color:#fff;border:none;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:.88rem;transition:background .2s}
          .ls-btn:hover{background:#2563eb}
          .ls-btn-danger{background:#ef4444}.ls-btn-danger:hover{background:#dc2626}
          .ls-btn-sm{padding:5px 12px;font-size:.78rem}
          .ls-section-title{font-size:1.15rem;font-weight:600;color:#e2e8f0;margin-bottom:16px}
          .ls-flex{display:flex;gap:16px;flex-wrap:wrap}
          .ls-flex > *{flex:1;min-width:140px}
          .ls-kpi{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px;text-align:center}
          .ls-kpi .num{font-size:1.6rem;font-weight:700;color:#3b82f6}
          .ls-kpi .lbl{font-size:.78rem;color:#94a3b8;margin-top:2px}
          .ip-header{background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid #334155;border-radius:16px;padding:24px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center}
        </style>

        <!-- IP Header -->
        <div class="ip-header" style="border-color:${isBlocked ? '#ef4444' : isSuspicious ? '#f59e0b' : '#334155'}">
          <div>
            <div style="font-size:1.6rem;font-weight:700;font-family:monospace;color:#e2e8f0">${esc(ipAddress)}</div>
            <div style="color:#94a3b8;margin-top:4px">
              First seen: ${summary.first_seen ? new Date(summary.first_seen).toLocaleString() : 'Unknown'} |
              Last seen: ${summary.last_seen ? new Date(summary.last_seen).toLocaleString() : 'Unknown'}
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            ${isBlocked ? '<span class="badge-fail" style="font-size:.9rem;padding:6px 16px">BLOCKED</span>' : ''}
            ${isSuspicious ? '<span class="badge-warn" style="font-size:.9rem;padding:6px 16px">SUSPICIOUS</span>' : ''}
            ${!isBlocked ? `<button onclick="blockIP('${esc(ipAddress)}')" class="ls-btn ls-btn-danger">Block IP</button>` : ''}
          </div>
        </div>

        <!-- KPIs -->
        <div class="ls-flex" style="margin-bottom:20px">
          <div class="ls-kpi"><div class="num">${summary.total}</div><div class="lbl">Total Attempts</div></div>
          <div class="ls-kpi"><div class="num" style="color:#34d399">${summary.successes}</div><div class="lbl">Successes</div></div>
          <div class="ls-kpi"><div class="num" style="color:#f87171">${summary.failures}</div><div class="lbl">Failures</div></div>
          <div class="ls-kpi"><div class="num" style="color:#c084fc">${summary.unique_users}</div><div class="lbl">Unique Users</div></div>
          <div class="ls-kpi"><div class="num" style="color:#22d3ee">${summary.unique_agents}</div><div class="lbl">User Agents</div></div>
        </div>

        <!-- Device Type SVG -->
        <div class="ls-card">
          <div class="ls-section-title">Device Breakdown</div>
          <svg id="deviceChart" width="100%" height="140" viewBox="0 0 600 140"></svg>
        </div>

        <!-- Attempts Table -->
        <div class="ls-card">
          <div class="ls-section-title">All Attempts (${attempts.length})</div>
          <table class="ls-table">
            <thead><tr><th>Time</th><th>Username</th><th>User Agent</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>
              ${attempts.slice(0, 100).map(r => `<tr>
                <td style="white-space:nowrap;font-size:.82rem">${r.created_at ? new Date(r.created_at).toLocaleString() : '-'}</td>
                <td>${esc(r.username) || esc(r.email) || '-'}</td>
                <td style="font-size:.8rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.user_agent || '')}">${esc(r.user_agent ? r.user_agent.substring(0, 50) + '...' : '-')}</td>
                <td><span class="${r.success ? 'badge-ok' : 'badge-fail'}">${r.success ? 'OK' : 'FAIL'}</span></td>
                <td>${esc(r.fail_reason) || '-'}</td>
              </tr>`).join('')}
              ${attempts.length > 100 ? `<tr><td colspan="5" style="text-align:center;color:#64748b;padding:12px">Showing 100 of ${attempts.length} results</td></tr>` : ''}
              ${attempts.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:40px">No attempts from this IP</td></tr>' : ''}
            </tbody>
          </table>
        </div>

        <script>
          // Device type horizontal bar
          (function(){
            const data = ${JSON.stringify(uaBreakdown)};
            const svg = document.getElementById('deviceChart');
            const colors = {Desktop:'#3b82f6',Mobile:'#8b5cf6',Tablet:'#f59e0b'};
            const icons = {Desktop:'🖥',Mobile:'📱',Tablet:'📋'};
            const total = data.reduce((s,d)=>s+d.cnt,0)||1;
            let html='';
            let x=20;
            data.forEach(d=>{
              const w = (d.cnt/total)*520;
              const c = colors[d.device_type]||'#3b82f6';
              html+='<rect x="'+x+'" y="30" width="'+w+'" height="36" fill="'+c+'" rx="6" opacity="0.85"/>';
              html+='<text x="'+(x+8)+'" y="54" fill="#fff" font-size="12" font-weight="600">'+d.device_type+' ('+d.cnt+')</text>';
              x += w + 4;
            });
            html+='<text x="20" y="90" fill="#64748b" font-size="12">Total: '+total+' attempts from '+data.length+' device type(s)</text>';
            svg.innerHTML = html;
          })();

          async function blockIP(ip){
            if(!confirm('Block IP '+ip+'?')) return;
            const r = await fetch('/admin/login-security/block-ip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ip})});
            if(r.ok) location.reload(); else alert('Failed to block');
          }
        </script>
      `, req.session.user));
    } catch (err) {
      console.error('[login-security by-ip]', err);
      res.status(500).send('IP lookup error');
    }
  });

  /* ------------------------------------------------------------------ */
  /*  15. GET /admin/login-security/brute-force-alerts – BF detection    */
  /* ------------------------------------------------------------------ */
  app.get('/admin/login-security/brute-force-alerts', async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || 1;
      const threshold = securitySettings.brute_force_threshold;
      const windowMin = securitySettings.brute_force_window_minutes;

      /* IPs with > threshold failed attempts in the detection window */
      const [bfIPs] = await pool.query(
        `SELECT ip_address,
                COUNT(*) AS fail_count,
                MIN(created_at) AS first_attempt,
                MAX(created_at) AS last_attempt,
                COUNT(DISTINCT username) AS users_targeted,
                MAX(fail_reason) AS last_reason
           FROM login_attempts
          WHERE tenant_id = ${esc(tenantId)}
            AND success = false
            AND created_at > NOW() - INTERVAL '${esc(windowMin)} minutes'
            AND ip_address IS NOT NULL
          GROUP BY ip_address
         HAVING COUNT(*) >= ${esc(threshold)}
          ORDER BY fail_count DESC`
      );

      /* Users with > threshold failed attempts in the detection window */
      const [bfUsers] = await pool.query(
        `SELECT username, email,
                COUNT(*) AS fail_count,
                MIN(created_at) AS first_attempt,
                MAX(created_at) AS last_attempt,
                COUNT(DISTINCT ip_address) AS ips_used,
                BOOL_OR(locked) AS is_locked
           FROM login_attempts
          WHERE tenant_id = ${esc(tenantId)}
            AND success = false
            AND created_at > NOW() - INTERVAL '${esc(windowMin)} minutes'
            AND username IS NOT NULL
          GROUP BY username, email
         HAVING COUNT(*) >= ${esc(threshold)}
          ORDER BY fail_count DESC`
      );

      /* Recent lockouts created in the window */
      const [recentLockouts] = await pool.query(
        `SELECT * FROM account_lockouts
          WHERE tenant_id = ${esc(tenantId)}
            AND is_active = true
            AND locked_at > NOW() - INTERVAL '${esc(windowMin)} minutes'
          ORDER BY failed_attempts DESC`
      );

      const severityCounts = { critical: 0, high: 0, medium: 0 };
      bfIPs.forEach(r => {
        if (r.fail_count > 50) severityCounts.critical++;
        else if (r.fail_count > 30) severityCounts.high++;
        else severityCounts.medium++;
      });

      res.send(opts.renderPage('Brute Force Alerts', `
        <style>
          .ls-card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;margin-bottom:20px}
          .ls-table{width:100%;border-collapse:collapse;color:#cbd5e1}
          .ls-table th{text-align:left;padding:10px 14px;font-size:.78rem;text-transform:uppercase;letter-spacing:.5px;color:#64748b;border-bottom:1px solid #334155}
          .ls-table td{padding:10px 14px;border-bottom:1px solid #1e293b;font-size:.88rem}
          .ls-table tr:hover td{background:#1e293b}
          .badge-fail{background:#7f1d1d;color:#f87171;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .badge-warn{background:#78350f;color:#fbbf24;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .badge-ok{background:#065f46;color:#34d399;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .badge-critical{background:#450a0a;color:#fca5a5;padding:2px 10px;border-radius:999px;font-size:.78rem}
          .ls-btn{background:#3b82f6;color:#fff;border:none;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:.88rem;transition:background .2s}
          .ls-btn:hover{background:#2563eb}
          .ls-btn-danger{background:#ef4444}.ls-btn-danger:hover{background:#dc2626}
          .ls-btn-sm{padding:5px 12px;font-size:.78rem}
          .ls-section-title{font-size:1.15rem;font-weight:600;color:#e2e8f0;margin-bottom:16px}
          .ls-flex{display:flex;gap:16px;flex-wrap:wrap}
          .ls-flex > *{flex:1;min-width:140px}
          .ls-kpi{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px;text-align:center}
          .ls-kpi .num{font-size:1.6rem;font-weight:700}
          .ls-kpi .lbl{font-size:.78rem;color:#94a3b8;margin-top:2px}
          .alert-banner{background:linear-gradient(135deg,#450a0a,#1e293b);border:1px solid #ef4444;border-radius:12px;padding:20px;margin-bottom:20px}
          .pulse{animation:pulse 2s infinite}
          @keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
        </style>

        ${bfIPs.length > 0 ? `
        <div class="alert-banner">
          <div style="display:flex;align-items:center;gap:12px">
            <div class="pulse" style="width:12px;height:12px;border-radius:50%;background:#ef4444"></div>
            <div>
              <div style="font-weight:700;font-size:1.1rem;color:#fca5a5">ACTIVE BRUTE FORCE ATTACKS DETECTED</div>
              <div style="color:#94a3b8;margin-top:4px">${bfIPs.length} IP(s) exceeded ${threshold} failed attempts in the last ${windowMin} minutes</div>
            </div>
          </div>
        </div>` : `
        <div class="ls-card" style="border-color:#065f46;text-align:center;padding:40px">
          <div style="font-size:2rem;margin-bottom:8px">✅</div>
          <div style="color:#34d399;font-weight:600;font-size:1.1rem">No Active Brute Force Attacks</div>
          <div style="color:#64748b;font-size:.88rem;margin-top:4px">All clear in the last ${windowMin} minutes (threshold: ${threshold} attempts)</div>
        </div>`}

        <!-- Severity KPIs -->
        <div class="ls-flex" style="margin-bottom:20px">
          <div class="ls-kpi" style="border-color:#ef4444"><div class="num" style="color:#f87171">${severityCounts.critical}</div><div class="lbl">Critical (>50 attempts)</div></div>
          <div class="ls-kpi" style="border-color:#f59e0b"><div class="num" style="color:#fbbf24">${severityCounts.high}</div><div class="lbl">High (30-50 attempts)</div></div>
          <div class="ls-kpi" style="border-color:#3b82f6"><div class="num" style="color:#60a5fa">${severityCounts.medium}</div><div class="lbl">Medium (10-30 attempts)</div></div>
          <div class="ls-kpi"><div class="num" style="color:#c084fc">${bfIPs.length}</div><div class="lbl">Total Alert IPs</div></div>
          <div class="ls-kpi"><div class="num" style="color:#22d3ee">${bfUsers.length}</div><div class="lbl">Alert Users</div></div>
          <div class="ls-kpi"><div class="num" style="color:#fb923c">${recentLockouts.length}</div><div class="lbl">New Lockouts</div></div>
        </div>

        <!-- Attacking IPs Table -->
        <div class="ls-card">
          <div class="ls-section-title">Flagged IPs (Last ${windowMin} minutes, ≥ ${threshold} failures)</div>
          <table class="ls-table">
            <thead><tr><th>Severity</th><th>IP Address</th><th>Failed Count</th><th>Users Targeted</th><th>First</th><th>Last</th><th>Last Reason</th><th>Actions</th></tr></thead>
            <tbody>
              ${bfIPs.map(r => {
                const sev = r.fail_count > 50 ? 'critical' : r.fail_count > 30 ? 'high' : 'medium';
                const badge = sev === 'critical' ? 'badge-critical' : sev === 'high' ? 'badge-fail' : 'badge-warn';
                const label = sev === 'critical' ? 'CRITICAL' : sev === 'high' ? 'HIGH' : 'MEDIUM';
                return `<tr style="${sev === 'critical' ? 'background:rgba(239,68,68,.05)' : ''}">
                  <td><span class="${badge}">${label}</span></td>
                  <td style="font-family:monospace">${esc(r.ip_address)}</td>
                  <td><span class="badge-fail">${r.fail_count}</span></td>
                  <td>${r.users_targeted}</td>
                  <td style="font-size:.82rem">${r.first_attempt ? new Date(r.first_attempt).toLocaleTimeString() : '-'}</td>
                  <td style="font-size:.82rem">${r.last_attempt ? new Date(r.last_attempt).toLocaleTimeString() : '-'}</td>
                  <td style="font-size:.82rem">${esc(r.last_reason) || '-'}</td>
                  <td>
                    <a href="/admin/login-security/by-ip/${esc(r.ip_address)}" class="ls-btn ls-btn-sm">Details</a>
                    <button onclick="blockIP('${esc(r.ip_address)}')" class="ls-btn ls-btn-danger ls-btn-sm">Block</button>
                  </td>
                </tr>`;
              }).join('')}
              ${bfIPs.length === 0 ? '<tr><td colspan="8" style="text-align:center;color:#64748b;padding:40px">No brute-force IPs detected</td></tr>' : ''}
            </tbody>
          </table>
        </div>

        <!-- Targeted Users Table -->
        ${bfUsers.length ? `
        <div class="ls-card">
          <div class="ls-section-title">Targeted Users (Last ${windowMin} minutes)</div>
          <table class="ls-table">
            <thead><tr><th>Username</th><th>Email</th><th>Failed Count</th><th>IPs Used</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              ${bfUsers.map(r => `<tr>
                <td>${esc(r.username)}</td>
                <td style="font-size:.82rem">${esc(r.email) || '-'}</td>
                <td><span class="badge-warn">${r.fail_count}</span></td>
                <td>${r.ips_used}</td>
                <td><span class="${r.is_locked ? 'badge-fail' : 'badge-ok'}">${r.is_locked ? 'Locked' : 'Active'}</span></td>
                <td>
                  <a href="/admin/login-security/timeline?username=${encodeURIComponent(esc(r.username))}" class="ls-btn ls-btn-sm">Timeline</a>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}

        <!-- Recent Lockouts -->
        ${recentLockouts.length ? `
        <div class="ls-card">
          <div class="ls-section-title">Recent Auto-Lockouts (Last ${windowMin} minutes)</div>
          <table class="ls-table">
            <thead><tr><th>ID</th><th>User</th><th>IP</th><th>Failed</th><th>Reason</th><th>Locked At</th><th>Action</th></tr></thead>
            <tbody>
              ${recentLockouts.map(r => `<tr>
                <td>${r.id}</td>
                <td>${esc(r.username) || '-'}</td>
                <td style="font-family:monospace;font-size:.82rem">${esc(r.ip_address) || '-'}</td>
                <td><span class="badge-fail">${r.failed_attempts}</span></td>
                <td>${esc(r.lockout_reason) || '-'}</td>
                <td style="font-size:.82rem">${r.locked_at ? new Date(r.locked_at).toLocaleTimeString() : '-'}</td>
                <td><button onclick="unlockAccount(${r.id})" class="ls-btn ls-btn-sm" style="background:#10b981">Unlock</button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}

        <!-- Severity Distribution SVG -->
        <div class="ls-card">
          <div class="ls-section-title">Attack Severity Distribution</div>
          <svg id="severityChart" width="100%" height="160" viewBox="0 0 960 160"></svg>
        </div>

        <script>
          // Severity distribution horizontal bars
          (function(){
            const data = ${JSON.stringify(bfIPs)};
            const svg = document.getElementById('severityChart');
            if(!data.length){ svg.innerHTML='<text x="480" y="80" fill="#64748b" text-anchor="middle">No active alerts</text>'; return; }
            const maxC = Math.max(...data.map(d=>d.fail_count),1);
            let html='';
            const sorted = [...data].sort((a,b)=>b.fail_count-a.fail_count).slice(0,15);
            sorted.forEach((d,i)=>{
              const y = 8 + i*10;
              const w = (d.fail_count/maxC)*500;
              const color = d.fail_count>50?'#ef4444':d.fail_count>30?'#f59e0b':'#3b82f6';
              html+='<rect x="140" y="'+y+'" width="'+w+'" height="8" fill="'+color+'" rx="4" opacity="0.8"/>';
              html+='<text x="130" y="'+(y+8)+'" fill="#94a3b8" font-size="9" text-anchor="end" font-family="monospace">'+d.ip_address+'</text>';
              html+='<text x="'+(148+w)+'" y="'+(y+8)+'" fill="#cbd5e1" font-size="9">'+d.fail_count+'</text>';
            });
            svg.innerHTML = html;
          })();

          async function blockIP(ip){
            if(!confirm('Block IP '+ip+' immediately?')) return;
            const r = await fetch('/admin/login-security/block-ip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ip})});
            if(r.ok) location.reload(); else alert('Failed to block');
          }
          async function unlockAccount(id){
            if(!confirm('Unlock lockout #'+id+'?')) return;
            const r = await fetch('/admin/login-security/unlock/'+id,{method:'POST'});
            if(r.ok) location.reload(); else alert('Failed');
          }
        </script>
      `, req.session.user));
    } catch (err) {
      console.error('[login-security brute-force]', err);
      res.status(500).send('Brute force alerts error');
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Utility: record a login attempt (exposed for other modules)       */
  /* ------------------------------------------------------------------ */
  const securityModule = {
    settings: securitySettings,

    /**
     * Record a login attempt and auto-lock if threshold exceeded.
     * @returns {{ allowed: boolean, locked: boolean, lockoutId: number|null, remainingAttempts: number }}
     */
    async recordAttempt({ username, email, ip_address, user_agent, success, fail_reason, user_id, tenant_id = 1 }) {
      /* Check if IP is blocked */
      if (isIPBlocked(ip_address)) {
        await pool.query(
          `INSERT INTO login_attempts (username, email, ip_address, user_agent, success, fail_reason, user_id, locked, tenant_id)
           VALUES (${esc(username)}, ${esc(email)}, ${esc(ip_address)}, ${esc(user_agent)}, false, 'IP_BLOCKED', ${esc(user_id || null)}, false, ${esc(tenant_id)})`
        );
        return { allowed: false, locked: false, lockoutId: null, remainingAttempts: 0, reason: 'IP_BLOCKED' };
      }

      /* Insert the attempt */
      await pool.query(
        `INSERT INTO login_attempts (username, email, ip_address, user_agent, success, fail_reason, user_id, tenant_id)
         VALUES (${esc(username)}, ${esc(email)}, ${esc(ip_address)}, ${esc(user_agent)}, ${esc(success)}, ${esc(fail_reason)}, ${esc(user_id || null)}, ${esc(tenant_id)})`
      );

      if (success) {
        /* Clear any existing lockout on successful login */
        if (user_id) {
          await pool.query(
            `UPDATE account_lockouts SET is_active = false, unlocked_at = NOW(), unlocked_by = NULL
              WHERE user_id = ${esc(user_id)} AND is_active = true AND tenant_id = ${esc(tenant_id)}`
          );
        }
        return { allowed: true, locked: false, lockoutId: null, remainingAttempts: securitySettings.max_failed_attempts };
      }

      /* Count recent failures for this user */
      const userKey = username || email;
      let recentFailures = 0;
      if (userKey) {
        const [[{ cnt }]] = await pool.query(
          `SELECT COUNT(*) AS cnt FROM login_attempts
            WHERE tenant_id = ${esc(tenant_id)}
              AND (username = ${esc(userKey)} OR email = ${esc(userKey)})
              AND success = false
              AND created_at > NOW() - INTERVAL '${esc(securitySettings.lockout_duration_minutes * 2)} minutes'`
        );
        recentFailures = cnt;
      }

      const remaining = Math.max(securitySettings.max_failed_attempts - recentFailures, 0);

      /* Auto-lock if threshold exceeded */
      if (recentFailures >= securitySettings.max_failed_attempts) {
        /* Check for existing active lockout */
        const [existing] = await pool.query(
          `SELECT id FROM account_lockouts
            WHERE tenant_id = ${esc(tenant_id)}
              AND (username = ${esc(userKey)} OR email = ${esc(userKey)})
              AND is_active = true
            LIMIT 1`
        );

        if (existing.length === 0) {
          /* Create new lockout */
          const [inserted] = await pool.query(
            `INSERT INTO account_lockouts (user_id, username, email, ip_address, lockout_reason, failed_attempts, tenant_id)
             VALUES (${esc(user_id || null)}, ${esc(username)}, ${esc(email)}, ${esc(ip_address)},
                     ${esc('Exceeded max failed attempts')}, ${esc(recentFailures)}, ${esc(tenant_id)})
             RETURNING id`
          );

          /* Mark the user as locked in recent attempts */
          if (user_id) {
            await pool.query(
              `UPDATE login_attempts SET locked = true
                WHERE user_id = ${esc(user_id)} AND tenant_id = ${esc(tenant_id)}`
            );
          }

          return { allowed: false, locked: true, lockoutId: inserted[0]?.id, remainingAttempts: 0, reason: 'LOCKED' };
        }

        return { allowed: false, locked: true, lockoutId: existing[0].id, remainingAttempts: 0, reason: 'LOCKED' };
      }

      return { allowed: true, locked: false, lockoutId: null, remainingAttempts: remaining };
    },

    /** Check if a user is currently locked out */
    async isLockedOut({ username, email, user_id, tenant_id = 1 }) {
      let where = `WHERE tenant_id = ${esc(tenant_id)} AND is_active = true`;
      if (user_id) where += ` AND user_id = ${esc(user_id)}`;
      else if (username) where += ` AND username = ${esc(username)}`;
      else if (email) where += ` AND email = ${esc(email)}`;
      else return false;

      /* Auto-expire lockouts past duration */
      await pool.query(
        `UPDATE account_lockouts SET is_active = false, unlocked_at = NOW()
          ${where} AND locked_at < NOW() - INTERVAL '${esc(securitySettings.lockout_duration_minutes)} minutes'`
      );

      const [rows] = await pool.query(
        `SELECT * FROM account_lockouts ${where} LIMIT 1`
      );
      return rows.length > 0 ? rows[0] : false;
    },

    /** Check if an IP is blocked */
    isIPBlocked,

    /** Get current settings */
    getSettings() {
      return { ...securitySettings };
    },

    /** Get all blocked IPs */
    getBlockedIPs() {
      return Array.from(blockedIPs);
    },
  };

  return securityModule;
};
