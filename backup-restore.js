// ============================================================
// BACKUP, RESTORE & DATA EXPORT MODULE — SSEWASSWA Comfort Platform
// Full backup creation, restoration, data export (JSON/CSV/SQL),
// import validation, manual snapshots, scheduling, retention.
// ============================================================
// Usage in server.js:
//   const backupRestore = require('./backup-restore');
//   backupRestore(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt);
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
const { migrateQuery } = require('./db');
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
const fmtSize = (b) => { if (!b) return '0 B'; const u = ['B','KB','MB','GB']; const i = Math.floor(Math.log(b)/Math.log(1024)); return (b/Math.pow(1024,i)).toFixed(i>0?1:0)+' '+u[i]; };
const statusBadge = (s) => { const c = { completed:'#059669', failed:'#dc2626', partial:'#f59e0b' }; const bg = c[s]||'#64748b'; return `<span style="background:${bg}18;color:${bg};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600">${esc(s||'unknown')}</span>`; };

const TENANT_TABLES = [
  'users','students','employee_directory','marks','attendance','fees','fee_payments',
  'transactions','expense_claims','leave_requests','documents','saved_reports','report_exports',
  'document_shares','document_versions','notifications','audit_log'
];
const CONFIG_TABLES = ['users','students','employee_directory','saved_reports'];

const BR_CSS = `<style>
.br-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:24px}
.br-stat{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;text-align:center}
.br-stat-val{font-size:26px;font-weight:800;color:#1e293b}
.br-stat-lbl{font-size:11px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.3px}
.br-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.br-btn:hover{opacity:.9}
.br-btn-primary{background:#4f46e5;color:#fff}.br-btn-secondary{background:#f1f5f9;color:#475569}
.br-btn-danger{background:#fee2e2;color:#dc2626}.br-btn-success{background:#d1fae5;color:#065f46}
.br-btn-warning{background:#fef3c7;color:#92400e}
.br-tabs{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.br-tab{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;border:2px solid transparent;transition:.15s}
.br-tab:hover{background:#e2e8f0}.br-tab.active{color:#fff;border-color:transparent}
.br-tbl{width:100%;border-collapse:collapse;font-size:13px}
.br-tbl th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.3px;background:#f8fafc}
.br-tbl td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.br-tbl tr:hover{background:#f8fafc}
.br-drop{border:2px dashed #cbd5e1;border-radius:14px;padding:40px;text-align:center;transition:.2s;cursor:pointer}
.br-drop:hover{border-color:#6366f1;background:#eef2ff}
.br-modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.45);z-index:1000;align-items:center;justify-content:center}
.br-modal.show{display:flex}
.br-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:24px}
.br-check{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px}
.br-check input{accent-color:#4f46e5;width:16px;height:16px}
@media(max-width:768px){.br-stats{grid-template-columns:1fr 1fr}.br-tabs{gap:4px}}
</style>`;

const BR_JS = `<script>
function toggleBrModal(id){var m=document.getElementById(id);if(m)m.classList.toggle('show')}
function toggleAllChecks(el){var cbs=document.querySelectorAll('.br-tbl-check');cbs.forEach(function(c){c.checked=el.checked})}
</script>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function backupRestore(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt) {

  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  if (!ah) ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ============================================================
  // 1. DATABASE MIGRATIONS
  // ============================================================
  const migrations = [
    `CREATE TABLE IF NOT EXISTS backup_log (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      backup_type VARCHAR(20) DEFAULT 'full',
      tables_backed_up TEXT[], row_counts JSONB DEFAULT '{}',
      file_size INTEGER DEFAULT 0, status VARCHAR(20) DEFAULT 'pending',
      error_message TEXT, triggered_by VARCHAR(255),
      restored_at TIMESTAMPTZ, restore_status VARCHAR(20),
      snapshot_data JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `DO $$ BEGIN
      ALTER TABLE backup_log ADD COLUMN IF NOT EXISTS backup_type VARCHAR(20) DEFAULT 'full';
      ALTER TABLE backup_log ADD COLUMN IF NOT EXISTS tables_backed_up TEXT[];
      ALTER TABLE backup_log ADD COLUMN IF NOT EXISTS row_counts JSONB DEFAULT '{}';
      ALTER TABLE backup_log ADD COLUMN IF NOT EXISTS file_size INTEGER DEFAULT 0;
      ALTER TABLE backup_log ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';
      ALTER TABLE backup_log ADD COLUMN IF NOT EXISTS error_message TEXT;
      ALTER TABLE backup_log ADD COLUMN IF NOT EXISTS triggered_by VARCHAR(255);
      ALTER TABLE backup_log ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ;
      ALTER TABLE backup_log ADD COLUMN IF NOT EXISTS restore_status VARCHAR(20);
      ALTER TABLE backup_log ADD COLUMN IF NOT EXISTS snapshot_data JSONB DEFAULT '{}';
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;`,
    `CREATE TABLE IF NOT EXISTS data_snapshots (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      snapshot_name VARCHAR(255) NOT NULL, description TEXT,
      snapshot_type VARCHAR(20) DEFAULT 'manual',
      tables_included TEXT[], data JSONB DEFAULT '{}',
      created_by VARCHAR(255) NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_backup_log_tenant ON backup_log(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_backup_log_status ON backup_log(status)`,
    `CREATE INDEX IF NOT EXISTS idx_backup_log_created ON backup_log(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_snapshots_tenant ON data_snapshots(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_snapshots_type ON data_snapshots(snapshot_type)`
  ];

  (async () => {
    try { for (const sql of migrations) { try { await migrateQuery(pool, 'BackupRestore', sql); } catch(e) { /* skip */ } } logger.info({ msg:'[BackupRestore] Migrations applied', count: migrations.length }); }
    catch (e) { logger.error({ msg:'[BackupRestore] Migration error', error: e.message }); }
  })();

  // ============================================================
  // INTERNAL: Get tenant table row counts
  // ============================================================
  async function getTableCounts(tid) {
    const counts = {};
    const available = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'
      AND table_name = ANY($1)`, [TENANT_TABLES]);
    for (const t of available.rows) {
      try {
        const colRes = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name='tenant_id' LIMIT 1`, [t.table_name]);
        if (colRes.rows.length > 0) {
          const r = await pool.query(`SELECT COUNT(*) as cnt FROM "${t.table_name}" WHERE tenant_id=$1`, [tid]);
          counts[t.table_name] = parseInt(r.rows[0].cnt);
        }
      } catch(e) { /* table may not exist */ }
    }
    return counts;
  }

  async function getTableData(tid, table) {
    try {
      const colRes = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name='tenant_id' LIMIT 1`, [table]);
      if (colRes.rows.length === 0) return [];
      const res = await pool.query(`SELECT * FROM "${table}" WHERE tenant_id=$1 LIMIT 5000`, [tid]);
      return res.rows;
    } catch(e) { return []; }
  }

  async function getColumns(table) {
    const r = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 AND table_schema='public' ORDER BY ordinal_position`, [table]);
    return r.rows.map(c => ({ name: c.column_name, type: c.data_type }));
  }

  async function applyRetention(tid, maxBackups) {
    const max = parseInt(maxBackups) || 20;
    const total = (await pool.query('SELECT COUNT(*) as cnt FROM backup_log WHERE tenant_id=$1', [tid])).rows[0].cnt;
    if (total > max) {
      await pool.query(`DELETE FROM backup_log WHERE id IN (SELECT id FROM backup_log WHERE tenant_id=$1 ORDER BY created_at ASC LIMIT $2)`, [tid, total - max]);
    }
  }

  // ============================================================
  // ROUTE 1: GET /backups — Backup Dashboard
  // ============================================================
  app.get('/backups', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const backups = (await pool.query('SELECT * FROM backup_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [tid])).rows;
    const totalSize = backups.reduce((s,b) => s + (parseInt(b.file_size)||0), 0);
    const successCount = backups.filter(b => b.status === 'completed').length;
    const rate = backups.length > 0 ? ((successCount / backups.length) * 100).toFixed(1) : '0.0';
    const lastBackup = backups.length > 0 ? fmtDateTime(backups[0].created_at) : 'Never';

    const rowsHtml = backups.map(b => `<tr>
      <td>${fmtDateTime(b.created_at)}</td>
      <td><span style="font-weight:600">${esc(b.backup_type||'full')}</span></td>
      <td>${fmtSize(b.file_size)}</td>
      <td>${b.tables_backed_up ? b.tables_backed_up.slice(0,4).map(t=>`<span style="background:#eef2ff;color:#4f46e5;padding:1px 6px;border-radius:4px;font-size:11px;margin:1px;display:inline-block">${esc(t)}</span>`).join('') + (b.tables_backed_up.length>4?`<span style="font-size:11px;color:#94a3b8"> +${b.tables_backed_up.length-4}</span>`:'') : '-'}</td>
      <td>${statusBadge(b.status)}</td>
      <td style="white-space:nowrap">
        <a href="/backups/${b.id}" class="br-btn br-btn-secondary" style="padding:4px 10px;font-size:11px">View</a>
        <a href="/backups/${b.id}/download" class="br-btn br-btn-primary" style="padding:4px 10px;font-size:11px">Download</a>
      </td>
    </tr>`).join('');

    const html = `${BR_CSS}${BR_JS}
    <div style="max-width:1200px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">💾 Backup & Restore</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage backups, exports, and data snapshots</p></div>
        <form method="POST" action="/backups/create"><button type="submit" class="br-btn br-btn-primary">➕ Create Backup</button></form>
      </div>
      <div class="br-stats">
        <div class="br-stat"><div class="br-stat-val" style="color:#4f46e5">${backups.length}</div><div class="br-stat-lbl">Total Backups</div></div>
        <div class="br-stat"><div class="br-stat-val" style="color:#059669">${fmtSize(totalSize)}</div><div class="br-stat-lbl">Total Size</div></div>
        <div class="br-stat"><div class="br-stat-val" style="color:#f59e0b">${lastBackup}</div><div class="br-stat-lbl">Last Backup</div></div>
        <div class="br-stat"><div class="br-stat-val" style="color:#0891b2">${rate}%</div><div class="br-stat-lbl">Success Rate</div></div>
      </div>
      <div class="br-tabs">
        <a href="/backups" class="br-tab active" style="background:#4f46e5;color:#fff">💾 Backups</a>
        <a href="/backups/export" class="br-tab">📤 Export</a>
        <a href="/backups/import" class="br-tab">📥 Import</a>
        <a href="/backups/snapshots" class="br-tab">📸 Snapshots</a>
        <a href="/backups/schedule" class="br-tab">⏰ Schedule</a>
      </div>
      <div class="br-card">
        <h3 style="margin-bottom:14px;color:#1e293b">Backup History</h3>
        ${backups.length === 0 ? '<p style="text-align:center;padding:40px;color:#94a3b8">No backups yet. Create your first backup to get started.</p>' : `
        <div style="overflow-x:auto"><table class="br-tbl">
          <thead><tr><th>Date</th><th>Type</th><th>Size</th><th>Tables</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table></div>`}
      </div>
    </div>`;
    res.send(renderPage('Backup & Restore', html, user));
  }));

  // ============================================================
  // ROUTE 2: POST /backups/create — Create Backup
  // ============================================================
  app.post('/backups/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const backupType = req.body.backup_type || 'full';
    try {
      const counts = await getTableCounts(tid);
      const tables = Object.keys(counts);
      const snapshot = {};
      if (backupType === 'full' || backupType === 'tables') {
        for (const t of CONFIG_TABLES) {
          if (counts[t] !== undefined) {
            snapshot[t] = await getTableData(tid, t);
          }
        }
      }
      const sizeEst = JSON.stringify(snapshot).length;
      const result = await pool.query(
        `INSERT INTO backup_log (tenant_id, backup_type, tables_backed_up, row_counts, file_size, status, triggered_by, snapshot_data) VALUES ($1,$2,$3,$4,$5,'completed',$6,$7) RETURNING id`,
        [tid, backupType, tables, JSON.stringify(counts), sizeEst, user.email, JSON.stringify(snapshot)]
      );
      audit(user.email, 'backup_create', `Created ${backupType} backup #${result.rows[0].id} with ${tables.length} tables`);
      notify(user.email, 'Backup Created', `Your ${backupType} backup was created successfully with ${tables.length} tables.`);
      await applyRetention(tid, 20);
      res.redirect('/backups/' + result.rows[0].id);
    } catch(e) {
      logger.error({ msg: '[BackupRestore] Backup create failed', error: e.message });
      await pool.query(`INSERT INTO backup_log (tenant_id, backup_type, status, error_message, triggered_by) VALUES ($1,$2,'failed',$3,$4)`, [tid, backupType, e.message.slice(0,500), user.email]);
      res.redirect('/backups');
    }
  }));

  // ============================================================
  // ROUTE 3: GET /backups/:id — Backup Detail
  // ============================================================
  app.get('/backups/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const backup = (await pool.query('SELECT * FROM backup_log WHERE id=$1 AND tenant_id=$2', [parseInt(req.params.id), tid])).rows[0];
    if (!backup) return res.send(renderPage('Not Found', '<div class="br-card" style="text-align:center;padding:40px"><h2 style="color:#ef4444">Backup not found</h2><a href="/backups" class="br-btn br-btn-primary" style="margin-top:12px">Back</a></div>', user));
    const rc = typeof backup.row_counts === 'string' ? JSON.parse(backup.row_counts) : (backup.row_counts || {});
    const tableRows = Object.entries(rc).map(([t,c]) => `<tr><td style="font-weight:500">${esc(t)}</td><td>${Number(c).toLocaleString()}</td></tr>`).join('');
    const tablesList = (backup.tables_backed_up || []).map(t => `<span style="background:#eef2ff;color:#4f46e5;padding:3px 10px;border-radius:6px;font-size:12px;margin:2px;display:inline-block">${esc(t)}</span>`).join('');
    const html = `${BR_CSS}${BR_JS}
    <div style="max-width:900px;margin:0 auto">
      <a href="/backups" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">Back to Backups</a>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b">Backup #${backup.id}</h1><p style="font-size:13px;color:#94a3b8">${fmtDateTime(backup.created_at)}</p></div>
        <div style="display:flex;gap:8px">
          <a href="/backups/${backup.id}/download" class="br-btn br-btn-primary">Download JSON</a>
          ${backup.status==='completed'?`<button class="br-btn br-btn-danger" onclick="toggleBrModal('restore-modal')">Restore</button>`:''}
        </div>
      </div>
      <div class="br-stats">
        <div class="br-stat"><div class="br-stat-val" style="color:#4f46e5">${esc(backup.backup_type||'full')}</div><div class="br-stat-lbl">Type</div></div>
        <div class="br-stat"><div class="br-stat-val" style="color:#059669">${fmtSize(backup.file_size)}</div><div class="br-stat-lbl">Size</div></div>
        <div class="br-stat"><div class="br-stat-val" style="color:#f59e0b">${(backup.tables_backed_up||[]).length}</div><div class="br-stat-lbl">Tables</div></div>
        <div class="br-stat"><div class="br-stat-val">${statusBadge(backup.status)}</div><div class="br-stat-lbl">Status</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="br-card">
          <h3 style="margin-bottom:12px;color:#1e293b">Tables Included</h3>
          <div>${tablesList || '<span style="color:#94a3b8">None</span>'}</div>
        </div>
        <div class="br-card">
          <h3 style="margin-bottom:12px;color:#1e293b">Details</h3>
          <div style="font-size:13px;display:flex;flex-direction:column;gap:8px">
            <div><span style="color:#94a3b8">Triggered by:</span> <strong>${esc(backup.triggered_by||'-')}</strong></div>
            <div><span style="color:#94a3b8">Created:</span> ${fmtDateTime(backup.created_at)}</div>
            ${backup.restored_at ? `<div><span style="color:#94a3b8">Last restored:</span> ${fmtDateTime(backup.restored_at)}</div>` : ''}
            ${backup.error_message ? `<div><span style="color:#94a3b8">Error:</span> <span style="color:#ef4444">${esc(backup.error_message)}</span></div>` : ''}
          </div>
        </div>
      </div>
      ${tableRows ? `<div class="br-card"><h3 style="margin-bottom:12px;color:#1e293b">Row Counts per Table</h3><div style="overflow-x:auto"><table class="br-tbl"><thead><tr><th>Table</th><th>Rows</th></tr></thead><tbody>${tableRows}</tbody></table></div></div>` : ''}
    </div>
    <div id="restore-modal" class="br-modal">
      <div class="br-card" style="max-width:500px;width:90%">
        <h3 style="color:#dc2626;margin-bottom:12px">⚠ Confirm Restore</h3>
        <p style="font-size:13px;color:#475569;margin-bottom:16px">This will restore data from backup <strong>#${backup.id}</strong>. Tables: <strong>${(backup.tables_backed_up||[]).join(', ')}</strong></p>
        <p style="font-size:13px;color:#ef4446;margin-bottom:20px;background:#fef2f2;padding:12px;border-radius:8px">Existing data in these tables may be overwritten. This action cannot be undone.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="br-btn br-btn-secondary" onclick="toggleBrModal('restore-modal')">Cancel</button>
          <form method="POST" action="/backups/${backup.id}/restore"><button type="submit" class="br-btn br-btn-danger">Restore Now</button></form>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Backup Detail', html, user));
  }));

  // ============================================================
  // ROUTE 4: GET /backups/:id/download — Download Backup JSON
  // ============================================================
  app.get('/backups/:id/download', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const backup = (await pool.query('SELECT * FROM backup_log WHERE id=$1 AND tenant_id=$2', [parseInt(req.params.id), tid])).rows[0];
    if (!backup) return res.status(404).send('Backup not found');
    const rc = typeof backup.row_counts === 'string' ? JSON.parse(backup.row_counts) : (backup.row_counts || {});
    const sd = typeof backup.snapshot_data === 'string' ? JSON.parse(backup.snapshot_data) : (backup.snapshot_data || {});
    const exportData = { metadata: { id: backup.id, tenant_id: tid, type: backup.backup_type, created_at: backup.created_at, triggered_by: backup.triggered_by, platform: 'SSEWASSWA Comfort' }, tables_backed_up: backup.tables_backed_up, row_counts: rc, snapshot_data: sd };
    const json = JSON.stringify(exportData, null, 2);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="backup-${backup.id}-${new Date().toISOString().slice(0,10)}.json"`);
    res.send(json);
    audit(user.email, 'backup_download', `Downloaded backup #${backup.id}`);
  }));

  // ============================================================
  // ROUTE 5: POST /backups/:id/restore — Restore from Backup
  // ============================================================
  app.post('/backups/:id/restore', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, bid = parseInt(req.params.id);
    const backup = (await pool.query('SELECT * FROM backup_log WHERE id=$1 AND tenant_id=$2', [bid, tid])).rows[0];
    if (!backup) return res.redirect('/backups');
    try {
      const sd = typeof backup.snapshot_data === 'string' ? JSON.parse(backup.snapshot_data) : (backup.snapshot_data || {});
      let restored = 0;
      for (const [table, rows] of Object.entries(sd)) {
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const cols = await getColumns(table);
        const colNames = cols.map(c => c.name);
        for (const row of rows) {
          const vals = colNames.map(c => row[c]);
          const placeholders = colNames.map((_, i) => '$' + (i + 2)).join(',');
          try {
            await pool.query(`INSERT INTO "${table}" (${colNames.join(',')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, [tid, ...vals]);
            restored++;
          } catch(e) { /* skip row errors */ }
        }
      }
      await pool.query('UPDATE backup_log SET restored_at=NOW(), restore_status=$1 WHERE id=$2', ['completed', bid]);
      audit(user.email, 'backup_restore', `Restored backup #${bid}, ~${restored} records`);
      notify(user.email, 'Backup Restored', `Backup #${bid} restored. Approximately ${restored} records processed.`);
      res.redirect('/backups/' + bid);
    } catch(e) {
      await pool.query('UPDATE backup_log SET restore_status=$1 WHERE id=$2', ['failed', bid]);
      logger.error({ msg: '[BackupRestore] Restore failed', backupId: bid, error: e.message });
      res.redirect('/backups/' + bid);
    }
  }));

  // ============================================================
  // ROUTE 6: GET /backups/export — Full Data Export Page
  // ============================================================
  app.get('/backups/export', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const counts = await getTableCounts(tid);
    const tables = Object.entries(counts).sort((a,b) => b[1] - a[1]);
    const tableChecks = tables.map(([t,c]) => `<label class="br-check"><input type="checkbox" name="tables" value="${esc(t)}" checked> ${esc(t)} <span style="color:#94a3b8;margin-left:auto">(${Number(c).toLocaleString()} rows)</span></label>`).join('');
    const html = `${BR_CSS}
    <div style="max-width:800px;margin:0 auto">
      <a href="/backups" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">Back to Backups</a>
      <div class="br-card" style="padding:28px">
        <h2 style="margin-bottom:4px;color:#1e293b">📤 Export Data</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Select tables and format to export tenant data</p>
        <form method="GET" action="/backups/export/run" style="display:flex;flex-direction:column;gap:20px">
          <div>
            <label style="font-size:13px;font-weight:700;color:#475569;display:block;margin-bottom:8px">Tables to Export</label>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><input type="checkbox" onchange="toggleAllChecks(this)" checked style="accent-color:#4f46e5;width:16px;height:16px"><span style="font-size:13px;font-weight:600;color:#475569">Select All</span></div>
            <div style="max-height:300px;overflow-y:auto;background:#f8fafc;border-radius:10px;padding:12px;border:1px solid #e2e8f0">${tableChecks}</div>
          </div>
          <div>
            <label style="font-size:13px;font-weight:700;color:#475569;display:block;margin-bottom:8px">Export Format</label>
            <div style="display:flex;gap:12px;flex-wrap:wrap">
              <label class="br-check"><input type="radio" name="format" value="json" checked> JSON</label>
              <label class="br-check"><input type="radio" name="format" value="csv"> CSV</label>
              <label class="br-check"><input type="radio" name="format" value="sql"> SQL INSERT</label>
            </div>
          </div>
          <button type="submit" class="br-btn br-btn-primary" style="padding:12px 24px;font-size:14px;justify-content:center">🚀 Export Selected Data</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Export Data', html, user));
  }));

  // ============================================================
  // ROUTE 7: GET /backups/export/run — Execute Export Download
  // ============================================================
  app.get('/backups/export/run', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const tables = (req.query.tables || []).length ? (Array.isArray(req.query.tables) ? req.query.tables : [req.query.tables]) : [];
    const format = req.query.format || 'json';
    if (tables.length === 0) return res.redirect('/backups/export');
    try {
      if (format === 'json') {
        const data = { exported_at: new Date().toISOString(), tenant_id: tid, tables: {} };
        for (const t of tables) { data.tables[t] = await getTableData(tid, t); }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="export-${new Date().toISOString().slice(0,10)}.json"`);
        res.send(JSON.stringify(data, null, 2));
      } else if (format === 'csv') {
        const lines = [];
        for (const t of tables) {
          const rows = await getTableData(tid, t);
          if (rows.length === 0) continue;
          lines.push(`=== ${t} ===`);
          const headers = Object.keys(rows[0]);
          lines.push(headers.map(h => '"' + h.replace(/"/g, '""') + '"').join(','));
          rows.forEach(r => lines.push(headers.map(h => '"' + String(r[h] ?? '').replace(/"/g, '""') + '"').join(',')));
          lines.push('');
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="export-${new Date().toISOString().slice(0,10)}.csv"`);
        res.send(lines.join('\r\n'));
      } else {
        const stmts = [];
        stmts.push(`-- SSEWASSWA Comfort Platform - Data Export`);
        stmts.push(`-- Exported: ${new Date().toISOString()}`);
        stmts.push(`-- Tenant: ${tid}`);
        stmts.push('');
        for (const t of tables) {
          const rows = await getTableData(tid, t);
          if (rows.length === 0) continue;
          stmts.push(`-- Table: ${t} (${rows.length} rows)`);
          rows.forEach(r => {
            const cols = Object.keys(r);
            const vals = cols.map(c => { const v = r[c]; return v === null ? 'NULL' : typeof v === 'number' ? v : "'" + String(v).replace(/'/g, "''") + "'"; });
            stmts.push(`INSERT INTO "${t}" (${cols.map(c => '"' + c + '"').join(',')}) VALUES (${vals.join(',')});`);
          });
          stmts.push('');
        }
        res.setHeader('Content-Type', 'application/sql');
        res.setHeader('Content-Disposition', `attachment; filename="export-${new Date().toISOString().slice(0,10)}.sql"`);
        res.send(stmts.join('\n'));
      }
      audit(user.email, 'data_export', `Exported ${tables.length} tables as ${format.toUpperCase()}`);
    } catch(e) {
      logger.error({ msg: '[BackupRestore] Export failed', error: e.message });
      res.redirect('/backups/export');
    }
  }));

  // ============================================================
  // ROUTE 8: GET /backups/import — Import Data Page
  // ============================================================
  app.get('/backups/import', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const html = `${BR_CSS}
    <div style="max-width:800px;margin:0 auto">
      <a href="/backups" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">Back to Backups</a>
      <div class="br-card" style="padding:28px">
        <h2 style="margin-bottom:4px;color:#1e293b">📥 Import Data</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Upload a JSON backup file to import data</p>
        <form method="POST" action="/backups/import/upload" enctype="multipart/form-data" style="display:flex;flex-direction:column;gap:16px">
          <div class="br-drop" ondragover="event.preventDefault();this.style.borderColor='#4f46e5';this.style.background='#eef2ff'" ondragleave="this.style.borderColor='#cbd5e1';this.style.background='#fff'" ondrop="event.preventDefault();this.style.borderColor='#cbd5e1';this.style.background='#fff'">
            <div style="font-size:48px;margin-bottom:12px">📂</div>
            <p style="font-size:14px;color:#475569;font-weight:600;margin-bottom:4px">Drag & drop your JSON file here</p>
            <p style="font-size:12px;color:#94a3b8;margin-bottom:12px">or click to browse</p>
            <input type="file" name="import_file" accept=".json" required style="font-size:14px">
          </div>
          <div style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:14px;font-size:13px;color:#92400e">
            <strong>Note:</strong> Imported data will be validated against existing table structures. Only matching tables will be imported. Large tables (5000+ rows) will be truncated to the first 5000 rows.
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <a href="/backups" class="br-btn br-btn-secondary">Cancel</a>
            <button type="submit" class="br-btn br-btn-primary" style="padding:12px 24px">📤 Upload & Import</button>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Import Data', html, user));
  }));

  // ============================================================
  // ROUTE 9: POST /backups/import/upload — Process Import
  // ============================================================
  app.post('/backups/import/upload', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    if (!req.file) return res.redirect('/backups/import');
    try {
      const raw = req.file.buffer.toString('utf8');
      const data = JSON.parse(raw);
      const tables = data.tables || data.snapshot_data || {};
      let imported = 0, skipped = 0, errors = 0;
      const results = [];
      for (const [table, rows] of Object.entries(tables)) {
        if (!Array.isArray(rows)) { skipped++; continue; }
        const cols = await getColumns(table).catch(() => []);
        if (cols.length === 0) { skipped++; results.push({ table, status: 'skipped', reason: 'Table not found' }); continue; }
        let tableImported = 0;
        for (const row of rows.slice(0, 5000)) {
          const colNames = cols.map(c => c.name);
          const vals = colNames.map(c => row[c]);
          try {
            await pool.query(`INSERT INTO "${table}" (${colNames.join(',')}) VALUES (${colNames.map((_, i) => '$' + (i + 1)).join(',')}) ON CONFLICT DO NOTHING`, vals);
            tableImported++;
          } catch(e) { errors++; }
        }
        imported += tableImported;
        results.push({ table, status: 'imported', rows: tableImported });
      }
      await pool.query(`INSERT INTO backup_log (tenant_id, backup_type, tables_backed_up, row_counts, file_size, status, triggered_by) VALUES ($1,'import',$2,$3,$4,'completed',$5)`, [tid, Object.keys(tables), JSON.stringify({ imported, skipped, errors }), req.file.size, user.email]);
      audit(user.email, 'data_import', `Imported ${imported} records from ${Object.keys(tables).length} tables`);
      notify(user.email, 'Import Complete', `Imported ${imported} records. Skipped ${skipped} tables. ${errors} errors.`);
      const resultsHtml = results.map(r => `<tr><td>${esc(r.table)}</td><td>${statusBadge(r.status)}</td><td>${r.status==='imported'?r.rows + ' rows':esc(r.reason||'-')}</td></tr>`).join('');
      const html = `${BR_CSS}
      <div style="max-width:800px;margin:0 auto">
        <div class="br-stats">
          <div class="br-stat"><div class="br-stat-val" style="color:#059669">${imported}</div><div class="br-stat-lbl">Records Imported</div></div>
          <div class="br-stat"><div class="br-stat-val" style="color:#f59e0b">${skipped}</div><div class="br-stat-lbl">Tables Skipped</div></div>
          <div class="br-stat"><div class="br-stat-val" style="color:#dc2626">${errors}</div><div class="br-stat-lbl">Errors</div></div>
          <div class="br-stat"><div class="br-stat-val" style="color:#4f46e5">${results.length}</div><div class="br-stat-lbl">Tables Processed</div></div>
        </div>
        <div class="br-card"><h3 style="margin-bottom:12px">Import Results</h3><div style="overflow-x:auto"><table class="br-tbl"><thead><tr><th>Table</th><th>Status</th><th>Details</th></tr></thead><tbody>${resultsHtml}</tbody></table></div></div>
        <div style="margin-top:16px"><a href="/backups" class="br-btn br-btn-primary">Back to Backups</a></div>
      </div>`;
      res.send(renderPage('Import Results', html, user));
    } catch(e) {
      logger.error({ msg: '[BackupRestore] Import failed', error: e.message });
      const html = `${BR_CSS}<div class="br-card" style="max-width:600px;margin:60px auto;text-align:center"><div style="font-size:48px;margin-bottom:12px">❌</div><h2 style="color:#ef4444">Import Failed</h2><p style="color:#64748b;margin:12px 0">${esc(e.message)}</p><a href="/backups/import" class="br-btn br-btn-primary" style="margin-top:12px">Try Again</a></div>`;
      res.send(renderPage('Import Error', html, user));
    }
  }));

  // ============================================================
  // ROUTE 10: GET /backups/snapshots — Snapshots List
  // ============================================================
  app.get('/backups/snapshots', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const snapshots = (await pool.query('SELECT * FROM data_snapshots WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [tid])).rows;
    const rowsHtml = snapshots.map(s => `<tr>
      <td style="font-weight:600">${esc(s.snapshot_name)}</td>
      <td>${esc(s.snapshot_type||'manual')}</td>
      <td>${esc(s.description||'-').slice(0,80)}</td>
      <td>${(s.tables_included||[]).length} tables</td>
      <td>${fmtDateTime(s.created_at)}</td>
      <td style="white-space:nowrap"><a href="/backups/snapshots/${s.id}" class="br-btn br-btn-secondary" style="padding:4px 10px;font-size:11px">View</a></td>
    </tr>`).join('');
    const html = `${BR_CSS}
    <div style="max-width:1100px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><a href="/backups" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:8px">Back to Backups</a><h1 style="font-size:22px;color:#1e293b">📸 Data Snapshots</h1><p style="font-size:13px;color:#94a3b8">Manual snapshots of specific data points</p></div>
        <button class="br-btn br-btn-primary" onclick="toggleBrModal('snap-create-modal')">➕ Create Snapshot</button>
      </div>
      <div class="br-card">
        ${snapshots.length === 0 ? '<p style="text-align:center;padding:40px;color:#94a3b8">No snapshots yet. Create one to save a point-in-time data capture.</p>' : `
        <div style="overflow-x:auto"><table class="br-tbl"><thead><tr><th>Name</th><th>Type</th><th>Description</th><th>Tables</th><th>Created</th><th>Actions</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`}
      </div>
    </div>
    <div id="snap-create-modal" class="br-modal">
      <div class="br-card" style="max-width:500px;width:90%">
        <h3 style="margin-bottom:16px;color:#1e293b">Create Snapshot</h3>
        <form method="POST" action="/backups/snapshots/create" style="display:flex;flex-direction:column;gap:14px">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Snapshot Name *</label><input type="text" name="snapshot_name" required placeholder="e.g., Pre-term start" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3" placeholder="What is this snapshot for?" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;resize:vertical"></textarea></div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button type="button" class="br-btn br-btn-secondary" onclick="toggleBrModal('snap-create-modal')">Cancel</button>
            <button type="submit" class="br-btn br-btn-primary">Save Snapshot</button>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Data Snapshots', html, user));
  }));

  // ============================================================
  // ROUTE 11: POST /backups/snapshots/create — Create Snapshot
  // ============================================================
  app.post('/backups/snapshots/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const name = (req.body.snapshot_name || '').trim();
    const desc = (req.body.description || '').trim();
    if (!name) return res.redirect('/backups/snapshots');
    try {
      const snapshot = {};
      const included = [];
      for (const t of CONFIG_TABLES) {
        const rows = await getTableData(tid, t);
        if (rows.length > 0) { snapshot[t] = rows; included.push(t); }
      }
      await pool.query(`INSERT INTO data_snapshots (tenant_id, snapshot_name, description, snapshot_type, tables_included, data, created_by) VALUES ($1,$2,$3,'manual',$4,$5,$6)`, [tid, name, desc, included, JSON.stringify(snapshot), user.email]);
      audit(user.email, 'snapshot_create', `Created snapshot "${name}" with ${included.length} tables`);
      notify(user.email, 'Snapshot Created', `Snapshot "${name}" saved with ${included.length} tables.`);
      res.redirect('/backups/snapshots');
    } catch(e) {
      logger.error({ msg: '[BackupRestore] Snapshot create failed', error: e.message });
      res.redirect('/backups/snapshots');
    }
  }));

  // ============================================================
  // ROUTE 12: GET /backups/snapshots/:id — Snapshot Detail
  // ============================================================
  app.get('/backups/snapshots/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const snap = (await pool.query('SELECT * FROM data_snapshots WHERE id=$1 AND tenant_id=$2', [parseInt(req.params.id), tid])).rows[0];
    if (!snap) return res.send(renderPage('Not Found', '<div class="br-card" style="text-align:center;padding:40px"><h2 style="color:#ef4444">Snapshot not found</h2><a href="/backups/snapshots" class="br-btn br-btn-primary" style="margin-top:12px">Back</a></div>', user));
    const sd = typeof snap.data === 'string' ? JSON.parse(snap.data) : (snap.data || {});
    const tablesHtml = Object.entries(sd).map(([t, rows]) => `<tr><td style="font-weight:500">${esc(t)}</td><td>${Array.isArray(rows)?rows.length:0} records</td><td style="font-size:12px;color:#94a3b8">${fmtSize(JSON.stringify(rows).length)}</td></tr>`).join('');
    const html = `${BR_CSS}${BR_JS}
    <div style="max-width:900px;margin:0 auto">
      <a href="/backups/snapshots" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">Back to Snapshots</a>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b">${esc(snap.snapshot_name)}</h1><p style="font-size:13px;color:#94a3b8">${esc(snap.description||'')} — ${fmtDateTime(snap.created_at)}</p></div>
        <div style="display:flex;gap:8px">
          <a href="/backups/snapshots/${snap.id}/download" class="br-btn br-btn-primary">Download</a>
          <button class="br-btn br-btn-danger" onclick="toggleBrModal('snap-restore-modal')">Restore</button>
        </div>
      </div>
      <div class="br-stats">
        <div class="br-stat"><div class="br-stat-val" style="color:#4f46e5">${esc(snap.snapshot_type)}</div><div class="br-stat-lbl">Type</div></div>
        <div class="br-stat"><div class="br-stat-val" style="color:#059669">${(snap.tables_included||[]).length}</div><div class="br-stat-lbl">Tables</div></div>
        <div class="br-stat"><div class="br-stat-val" style="color:#f59e0b">${fmtSize(JSON.stringify(sd).length)}</div><div class="br-stat-lbl">Data Size</div></div>
        <div class="br-stat"><div class="br-stat-val" style="color:#64748b">${esc(snap.created_by)}</div><div class="br-stat-lbl">Created By</div></div>
      </div>
      <div class="br-card"><h3 style="margin-bottom:12px;color:#1e293b">Snapshot Contents</h3>
        <div style="overflow-x:auto"><table class="br-tbl"><thead><tr><th>Table</th><th>Records</th><th>Size</th></tr></thead><tbody>${tablesHtml}</tbody></table></div>
      </div>
    </div>
    <div id="snap-restore-modal" class="br-modal">
      <div class="br-card" style="max-width:480px;width:90%">
        <h3 style="color:#dc2626;margin-bottom:12px">⚠ Restore Snapshot</h3>
        <p style="font-size:13px;color:#475569;margin-bottom:16px">Restore "${esc(snap.snapshot_name)}"? Tables: <strong>${(snap.tables_included||[]).join(', ')}</strong></p>
        <p style="font-size:13px;color:#ef4446;margin-bottom:16px;background:#fef2f2;padding:10px;border-radius:8px">Existing records may be duplicated. Review carefully.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="br-btn br-btn-secondary" onclick="toggleBrModal('snap-restore-modal')">Cancel</button>
          <form method="POST" action="/backups/snapshots/${snap.id}/restore"><button type="submit" class="br-btn br-btn-danger">Restore Now</button></form>
        </div>
      </div>
    </div>
    <script>
    // Snapshot download handler
    document.querySelector('a[href*="/download"]')?.addEventListener('click', async function(e) {
      // let the link work normally
    });
    </script>`;
    res.send(renderPage('Snapshot Detail', html, user));
  }));

  // Snapshot download
  app.get('/backups/snapshots/:id/download', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const snap = (await pool.query('SELECT * FROM data_snapshots WHERE id=$1 AND tenant_id=$2', [parseInt(req.params.id), tid])).rows[0];
    if (!snap) return res.status(404).send('Not found');
    const sd = typeof snap.data === 'string' ? JSON.parse(snap.data) : (snap.data || {});
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="snapshot-${snap.snapshot_name.replace(/[^a-z0-9]/gi,'-')}-${new Date().toISOString().slice(0,10)}.json"`);
    res.send(JSON.stringify({ metadata: { name: snap.snapshot_name, description: snap.description, type: snap.snapshot_type, created_at: snap.created_at, created_by: snap.created_by }, tables: sd }, null, 2));
  }));

  // Snapshot restore
  app.post('/backups/snapshots/:id/restore', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const snap = (await pool.query('SELECT * FROM data_snapshots WHERE id=$1 AND tenant_id=$2', [parseInt(req.params.id), tid])).rows[0];
    if (!snap) return res.redirect('/backups/snapshots');
    try {
      const sd = typeof snap.data === 'string' ? JSON.parse(snap.data) : (snap.data || {});
      let cnt = 0;
      for (const [table, rows] of Object.entries(sd)) {
        if (!Array.isArray(rows)) continue;
        const cols = await getColumns(table).catch(() => []);
        if (cols.length === 0) continue;
        for (const row of rows.slice(0, 5000)) {
          const colNames = cols.map(c => c.name);
          const vals = colNames.map(c => row[c]);
          try { await pool.query(`INSERT INTO "${table}" (${colNames.join(',')}) VALUES (${colNames.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT DO NOTHING`, vals); cnt++; } catch(e) {}
        }
      }
      audit(user.email, 'snapshot_restore', `Restored snapshot "${snap.snapshot_name}", ~${cnt} records`);
      notify(user.email, 'Snapshot Restored', `"${snap.snapshot_name}" restored with ~${cnt} records.`);
      req.flash = req.flash || {}; req.flash.success = 'Snapshot restored successfully!';
      res.redirect('/backups/snapshots/' + snap.id);
    } catch(e) {
      logger.error({ msg: '[BackupRestore] Snapshot restore failed', error: e.message });
      res.redirect('/backups/snapshots/' + snap.id);
    }
  }));

  // ============================================================
  // ROUTE 13: GET /backups/schedule — Backup Schedule Config
  // ============================================================
  app.get('/backups/schedule', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const config = (await pool.query("SELECT * FROM system_settings WHERE tenant_id=$1 AND key IN ('backup_auto_enabled','backup_frequency','backup_retention')", [tid])).rows;
    const cfg = {};
    config.forEach(r => { cfg[r.key] = r.value; });
    const enabled = cfg.backup_auto_enabled === 'true';
    const frequency = cfg.backup_frequency || 'weekly';
    const retention = cfg.backup_retention || '20';
    const html = `${BR_CSS}
    <div style="max-width:700px;margin:0 auto">
      <a href="/backups" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">Back to Backups</a>
      <div class="br-card" style="padding:28px">
        <h2 style="margin-bottom:4px;color:#1e293b">⏰ Backup Schedule</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Configure automatic backup settings</p>
        <form method="POST" action="/backups/schedule/save" style="display:flex;flex-direction:column;gap:20px">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
            <div><div style="font-weight:700;color:#1e293b;font-size:14px">Automatic Backups</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Enable scheduled backups</div></div>
            <label style="position:relative;display:inline-block;width:48px;height:26px">
              <input type="checkbox" name="auto_enabled" ${enabled?'checked':''} style="opacity:0;width:0;height:0">
              <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:${enabled?'#4f46e5':'#cbd5e1'};border-radius:13px;transition:.3s"></span>
            </label>
          </div>
          <div>
            <label style="font-size:13px;font-weight:700;color:#475569;display:block;margin-bottom:8px">Frequency</label>
            <div style="display:flex;gap:12px">
              <label class="br-check" style="padding:12px 18px;border:2px solid ${frequency==='daily'?'#4f46e5':'#e2e8f0'};border-radius:10px;cursor:pointer;flex:1;text-align:center"><input type="radio" name="frequency" value="daily" ${frequency==='daily'?'checked':''}> Daily</label>
              <label class="br-check" style="padding:12px 18px;border:2px solid ${frequency==='weekly'?'#4f46e5':'#e2e8f0'};border-radius:10px;cursor:pointer;flex:1;text-align:center"><input type="radio" name="frequency" value="weekly" ${frequency==='weekly'?'checked':''}> Weekly</label>
              <label class="br-check" style="padding:12px 18px;border:2px solid ${frequency==='monthly'?'#4f46e5':'#e2e8f0'};border-radius:10px;cursor:pointer;flex:1;text-align:center"><input type="radio" name="frequency" value="monthly" ${frequency==='monthly'?'checked':''}> Monthly</label>
            </div>
          </div>
          <div>
            <label style="font-size:13px;font-weight:700;color:#475569;display:block;margin-bottom:8px">Retention Policy</label>
            <p style="font-size:12px;color:#94a3b8;margin-bottom:8px">Keep the last N automatic backups. Oldest will be deleted.</p>
            <input type="number" name="retention" value="${esc(retention)}" min="1" max="100" style="width:120px;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
          </div>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;font-size:13px;color:#166534">
            <strong>Storage Info:</strong> Automatic backups store configuration and reference data only (not message history or large transaction tables) to optimize storage.
          </div>
          <button type="submit" class="br-btn br-btn-primary" style="padding:12px 24px;font-size:14px;justify-content:center">Save Schedule Settings</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Backup Schedule', html, user));
  }));

  // ============================================================
  // ROUTE 14: POST /backups/schedule/save — Save Schedule Config
  // ============================================================
  app.post('/backups/schedule/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const autoEnabled = req.body.auto_enabled === 'on' ? 'true' : 'false';
    const frequency = ['daily','weekly','monthly'].includes(req.body.frequency) ? req.body.frequency : 'weekly';
    const retention = Math.min(100, Math.max(1, parseInt(req.body.retention) || 20));
    const upsert = `INSERT INTO system_settings (tenant_id, key, value, updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, key) DO UPDATE SET value=$3, updated_at=NOW(), updated_by=$4`;
    await pool.query(upsert, [tid, 'backup_auto_enabled', autoEnabled, user.email]);
    await pool.query(upsert, [tid, 'backup_frequency', frequency, user.email]);
    await pool.query(upsert, [tid, 'backup_retention', String(retention), user.email]);
    audit(user.email, 'backup_schedule_update', `Auto=${autoEnabled}, Freq=${frequency}, Retain=${retention}`);
    notify(user.email, 'Schedule Updated', `Backup schedule: ${autoEnabled==='true'?'Enabled':'Disabled'}, ${frequency}, keep ${retention}.`);
    res.redirect('/backups/schedule');
  }));
};
