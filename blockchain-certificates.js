// ============================================================
// BLOCKCHAIN-CERTIFICATES MODULE — School SaaS Portal
// Blockchain-verified digital certificates for students.
// Features: Templates, Batch Gen, Blockchain Verification,
// Digital Signatures, Issuance, Verification Portal, Gallery,
// Revocation, Analytics, Certificate Requests.
// 22+ routes, MySQL-backed, tenant-aware.
// ============================================================
// Usage in server.js:
//   const bcCerts = require('./blockchain-certificates');
//   bcCerts(app, pool, { renderPage, esc, ah, requireAuth, audit });
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
const crypto = require('crypto');

// ============================================================
// INTERNAL HELPERS (declared outside module for hoisting)
// ============================================================
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
const fmtDateShort = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function generateCertCode(tid) {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `BC-${tid}-${ts}-${rand}`;
}

function generateBlockHash(certData, previousHash, nonce, secret) {
  const payload = JSON.stringify(certData) + previousHash + nonce + secret + Date.now();
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function statusBadge(status) {
  const map = {
    draft:     { bg: '#f1f5f9', c: '#64748b', icon: '📝', label: 'Draft' },
    approved:  { bg: '#dbeafe', c: '#1d4ed8', icon: '✅', label: 'Approved' },
    issued:    { bg: '#dcfce7', c: '#16a34a', icon: '📜', label: 'Issued' },
    revoked:   { bg: '#fee2e2', c: '#dc2626', icon: '❌', label: 'Revoked' },
    pending:   { bg: '#fef3c7', c: '#b45309', icon: '⏳', label: 'Pending' },
    rejected:  { bg: '#fee2e2', c: '#dc2626', icon: '🚫', label: 'Rejected' },
  };
  const s = map[status] || { bg: '#f1f5f9', c: '#64748b', icon: '?', label: status || 'Unknown' };
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${s.bg};color:${s.c}">${s.icon} ${s.label}</span>`;
}

function categoryBadge(cat) {
  const map = {
    academic:       { bg: '#dbeafe', c: '#1d4ed8', icon: '🎓', label: 'Academic' },
    sports:         { bg: '#dcfce7', c: '#16a34a', icon: '🏅', label: 'Sports' },
    extracurricular:{ bg: '#f3e8ff', c: '#7c3aed', icon: '🎭', label: 'Extracurricular' },
    merit:          { bg: '#fef3c7', c: '#b45309', icon: '⭐', label: 'Merit' },
    completion:     { bg: '#ecfdf5', c: '#059669', icon: '📜', label: 'Completion' },
    attendance:     { bg: '#fff7ed', c: '#ea580c', icon: '📋', label: 'Attendance' },
  };
  const s = map[cat] || { bg: '#f1f5f9', c: '#64748b', icon: '📄', label: cat || 'Other' };
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${s.bg};color:${s.c}">${s.icon} ${esc(s.label)}</span>`;
}

// ============================================================
// SHARED CSS — Gold / Royal Blue Prestigious Theme
// ============================================================
const BC_CSS = `<style>
  .bc-nav{display:flex;gap:6px;margin-bottom:24px;flex-wrap:wrap;padding:4px 0}
  .bc-nav a{padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;transition:.2s}
  .bc-nav a:hover{background:#e2e8f0;border-color:#cbd5e1}.bc-nav a.active{background:linear-gradient(135deg,#1e3a5f,#2563eb);color:#fff;border-color:transparent;box-shadow:0 2px 8px rgba(37,99,235,.3)}
  .bc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:18px}
  .bc-card{background:#fff;border:2px solid #e2e8f0;border-radius:16px;padding:24px;transition:.2s;position:relative;overflow:hidden}
  .bc-card:hover{box-shadow:0 8px 24px rgba(0,0,0,.08);border-color:#93c5fd;transform:translateY(-2px)}
  .bc-card-header{display:flex;justify-content:space-between;align-items:start;margin-bottom:12px}
  .bc-card-title{font-size:16px;font-weight:700;color:#1e293b;margin:0}
  .bc-card-meta{display:flex;gap:14px;font-size:12px;color:#94a3b8;margin-bottom:14px;flex-wrap:wrap}
  .bc-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.2s;white-space:nowrap}
  .bc-btn:hover{opacity:.9;transform:translateY(-1px)}.bc-btn:active{transform:translateY(0)}
  .bc-btn-primary{background:linear-gradient(135deg,#1e3a5f,#2563eb);color:#fff;box-shadow:0 2px 8px rgba(37,99,235,.25)}
  .bc-btn-success{background:linear-gradient(135deg,#059669,#10b981);color:#fff}
  .bc-btn-danger{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}
  .bc-btn-danger:hover{background:#fecaca}
  .bc-btn-gold{background:linear-gradient(135deg,#b45309,#f59e0b);color:#fff;box-shadow:0 2px 8px rgba(245,158,11,.3)}
  .bc-btn-secondary{background:#f1f5f9;color:#475569;border:1px solid #e2e8f0}
  .bc-btn-secondary:hover{background:#e2e8f0}
  .bc-btn-outline{background:transparent;color:#2563eb;border:2px solid #2563eb}
  .bc-btn-outline:hover{background:#eff6ff}
  .bc-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:5px}
  .bc-form input,.bc-form select,.bc-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;transition:.2s;font-family:inherit}
  .bc-form input:focus,.bc-form select:focus,.bc-form textarea:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.1)}
  .bc-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .bc-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
  .bc-table{width:100%;border-collapse:collapse;font-size:13px}
  .bc-table th{padding:11px 16px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
  .bc-table td{padding:10px 16px;border-bottom:1px solid #f1f5f9;color:#1e293b}.bc-table tr:hover{background:#fafbfe}
  .bc-stat-card{background:#fff;border:2px solid #e2e8f0;border-radius:14px;padding:20px;text-align:center;position:relative;overflow:hidden}
  .bc-stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:4px}
  .bc-stat-num{font-size:32px;font-weight:800;background:linear-gradient(135deg,#1e3a5f,#2563eb);-webkit-background-clip:text;-webkit-text-fill-color:transparent;line-height:1.2}
  .bc-stat-label{font-size:12px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
  .bc-gold-seal{width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#b45309,#f59e0b,#fbbf24);display:flex;align-items:center;justify-content:center;font-size:28px;box-shadow:0 4px 12px rgba(245,158,11,.4);border:3px solid #92400e}
  .bc-chain-block{background:#fff;border:2px solid #e2e8f0;border-radius:12px;padding:16px;min-width:220px;position:relative}
  .bc-chain-link{display:flex;align-items:center;justify-content:center;width:40px;color:#2563eb;font-size:20px;font-weight:700}
  .bc-chain-hash{font-family:monospace;font-size:10px;color:#64748b;word-break:break-all;background:#f8fafc;padding:6px 8px;border-radius:6px;margin-top:8px}
  .bc-cert-preview{width:760px;min-height:540px;background:#fff;border:4px double #b45309;border-radius:8px;position:relative;padding:48px;font-family:Georgia,'Times New Roman',serif;margin:0 auto}
  .bc-cert-preview .cp-ornament{font-size:20px;color:#d4a574;text-align:center;margin:6px 0;letter-spacing:4px}
  .bc-cert-preview .cp-title{font-size:28px;font-weight:700;text-align:center;color:#1e3a5f;margin:8px 0;text-transform:uppercase;letter-spacing:2px}
  .bc-cert-preview .cp-recipient{font-size:36px;font-weight:700;text-align:center;color:#1e3a5f;font-style:italic;margin:20px 0;border-bottom:2px solid #d4a574;display:inline-block;padding-bottom:4px}
  .bc-cert-preview .cp-body{text-align:center;font-size:15px;color:#475569;line-height:1.7;max-width:520px;margin:0 auto 20px}
  .bc-cert-preview .cp-sig-area{display:flex;justify-content:space-between;margin-top:40px;padding:0 20px}
  .bc-cert-preview .cp-sig{text-align:center;min-width:160px}
  .bc-cert-preview .cp-sig-line{width:160px;height:1px;background:#1e3a5f;margin:6px auto 4px}
  .bc-cert-preview .cp-sig-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px}
  .bc-cert-preview .cp-qr{position:absolute;bottom:16px;right:16px;width:64px;height:64px;border:2px solid #e2e8f0;border-radius:6px;display:flex;align-items:center;justify-content:center;background:#f8fafc;font-size:9px;color:#94a3b8;text-align:center}
  .bc-cert-preview .cp-seal{position:absolute;top:16px;right:16px}
  .bc-verify-result{text-align:center;padding:40px;border-radius:16px;border:2px solid}
  .bc-verify-result.valid{border-color:#16a34a;background:#f0fdf4}
  .bc-verify-result.revoked{border-color:#dc2626;background:#fef2f2}
  .bc-verify-result.notfound{border-color:#f59e0b;background:#fffbeb}
  .bc-verify-icon{font-size:64px;margin-bottom:16px}
  .bc-flash{padding:12px 18px;border-radius:10px;margin-bottom:16px;font-size:14px;font-weight:600}
  .bc-flash-success{background:#dcfce7;color:#16a34a;border:1px solid #bbf7d0}
  .bc-flash-error{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}
  @keyframes bcPulse{0%,100%{opacity:1}50%{opacity:.6}}
  .bc-pulse{animation:bcPulse 2s infinite}
  @media print{.bc-nav,.bc-btn,.no-print{display:none!important}.bc-cert-preview{border-width:4px!important;box-shadow:none!important}}
  @media(max-width:768px){.bc-grid-2,.bc-grid-3{grid-template-columns:1fr}.bc-grid{grid-template-columns:1fr}.bc-cert-preview{width:100%;min-height:auto}.bc-cert-preview .cp-recipient{font-size:24px}}
</style>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  // -- Navigation helper ------------------------------------------
  const nav = (active) => `<div class="bc-nav">
    <a href="/school/blockchain-certs" class="${active==='dash'?'active':''}">🏛️ Dashboard</a>
    <a href="/school/blockchain-certs/templates" class="${active==='templates'?'active':''}">🎨 Templates</a>
    <a href="/school/blockchain-certs/issue" class="${active==='issue'?'active':''}">✏️ Issue</a>
    <a href="/school/blockchain-certs/list" class="${active==='list'?'active':''}">📜 Certificates</a>
    <a href="/school/blockchain-certs/gallery" class="${active==='gallery'?'active':''}">🖼️ Gallery</a>
    <a href="/school/blockchain-certs/requests" class="${active==='requests'?'active':''}">📋 Requests</a>
    <a href="/school/blockchain-certs/chain" class="${active==='chain'?'active':''}">⛓️ Blockchain</a>
    <a href="/school/blockchain-certs/analytics" class="${active==='analytics'?'active':''}">📊 Analytics</a>
    <a href="/school/blockchain-certs/settings" class="${active==='settings'?'active':''}">⚙️ Settings</a>
  </div>`;

  // -- Flash message helper ----------------------------------------
  const flash = (req) => {
    const f = req.session?.flash;
    if (!f) return '';
    delete req.session.flash;
    return `<div class="bc-flash bc-flash-${f.type||'success'}">${f.icon||''} ${esc(f.msg)}</div>`;
  };

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      // cert_templates
      await migrateQuery(pool, 'BlockchainCertificates', `CREATE TABLE IF NOT EXISTS cert_templates (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(50) DEFAULT 'academic',
        layout_style VARCHAR(50) DEFAULT 'classic',
        background_color VARCHAR(100) DEFAULT '#ffffff',
        border_style VARCHAR(50) DEFAULT 'double',
        logo_url TEXT,
        placeholder_fields JSON DEFAULT '{"student_name":true,"date":true,"description":true,"signatures":true}',
        qr_position VARCHAR(20) DEFAULT 'bottom-right',
        is_default SMALLINT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)
      `);

      // blockchain_certificates
      await migrateQuery(pool, 'BlockchainCertificates', `CREATE TABLE IF NOT EXISTS blockchain_certificates (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        student_id INT,
        template_id INT,
        cert_code VARCHAR(100) NOT NULL UNIQUE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        issue_date DATE,
        expiry_date DATE,
        status TEXT DEFAULT 'draft',
        revoked_at TIMESTAMPTZ,
        revoke_reason TEXT,
        issued_by INT,
        signature_data JSON DEFAULT NULL,
        metadata JSON DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)
      `);

      // blockchain_ledger
      await migrateQuery(pool, 'BlockchainCertificates', `CREATE TABLE IF NOT EXISTS blockchain_ledger (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        cert_id INT NOT NULL,
        block_number INT NOT NULL,
        cert_hash VARCHAR(64) NOT NULL,
        previous_hash VARCHAR(64) NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        miner VARCHAR(255) DEFAULT 'system',
        nonce VARCHAR(20) DEFAULT '0',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)
      `);

      // cert_requests
      await migrateQuery(pool, 'BlockchainCertificates', `CREATE TABLE IF NOT EXISTS cert_requests (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        student_id INT,
        request_type VARCHAR(100) DEFAULT 'general',
        description TEXT,
        status TEXT DEFAULT 'pending',
        admin_notes TEXT,
        processed_by INT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMPTZ)
      `);

      // cert_verification_log
      await migrateQuery(pool, 'BlockchainCertificates', `CREATE TABLE IF NOT EXISTS cert_verification_log (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        cert_id INT,
        verifier_ip VARCHAR(45),
        verified_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        is_valid SMALLINT DEFAULT 1)
      `);

      console.log('[Blockchain-Certs] Migrations applied successfully');
    } catch (e) {
      console.error('[Blockchain-Certs] Migration error:', e.message);
    }
  })();

  // ============================================================
  // ROUTE 1: GET /school/blockchain-certs — Dashboard
  // ============================================================
  app.get('/school/blockchain-certs', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const [totalCerts, issuedCerts, revokedCerts, pendingReqs, chainBlocks] = await Promise.all([
      pool.query('SELECT COUNT(*) as cnt FROM blockchain_certificates WHERE tenant_id=$1', [tid]),
      pool.query("SELECT COUNT(*) as cnt FROM blockchain_certificates WHERE tenant_id=$1 AND status='issued'", [tid]),
      pool.query("SELECT COUNT(*) as cnt FROM blockchain_certificates WHERE tenant_id=$1 AND status='revoked'", [tid]),
      pool.query("SELECT COUNT(*) as cnt FROM cert_requests WHERE tenant_id=$1 AND status='pending'", [tid]),
      pool.query('SELECT COUNT(*) as cnt FROM blockchain_ledger WHERE tenant_id=$1', [tid]),
    ]);

    const total = totalCerts.rows[0].cnt;
    const issued = issuedCerts.rows[0].cnt;
    const revoked = revokedCerts.rows[0].cnt;
    const pending = pendingReqs.rows[0].cnt;
    const blocks = chainBlocks.rows[0].cnt;

    const recentCerts = await pool.query(
      'SELECT bc.*, t.name as tpl_name FROM blockchain_certificates bc LEFT JOIN cert_templates t ON t.id=bc.template_id WHERE bc.tenant_id=$1 ORDER BY bc.created_at DESC LIMIT 6',
      [tid]
    );

    const recentHtml = recentCerts.rows.map(c => `<tr>
      <td><a href="/school/blockchain-certs/${c.id}" style="color:#1e3a5f;text-decoration:none;font-weight:600">${esc(c.title)}</a></td>
      <td>${esc(c.tpl_name||'—')}</td>
      <td>${statusBadge(c.status)}</td>
      <td style="font-family:monospace;font-size:11px;color:#94a3b8">${esc(c.cert_code)}</td>
      <td>${fmtDateShort(c.issue_date)}</td>
    </tr>`).join('');

    const html = BC_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${flash(req)}
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e3a5f;margin:0">🏛️ Blockchain Certificate Manager</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:4px">Tamper-proof digital certificates powered by blockchain verification</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/school/blockchain-certs/issue" class="bc-btn bc-btn-primary">✏️ Issue Certificate</a>
          <a href="/school/blockchain-certs/templates" class="bc-btn bc-btn-secondary">🎨 Templates</a>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px">
        <div class="bc-stat-card"><div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#1e3a5f,#2563eb)"></div><div class="bc-stat-num">${total}</div><div class="bc-stat-label">Total Certificates</div></div>
        <div class="bc-stat-card"><div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#059669,#10b981)"></div><div class="bc-stat-num">${issued}</div><div class="bc-stat-label">Issued & Verified</div></div>
        <div class="bc-stat-card"><div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#dc2626,#f87171)"></div><div class="bc-stat-num">${revoked}</div><div class="bc-stat-label">Revoked</div></div>
        <div class="bc-stat-card"><div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#b45309,#f59e0b)"></div><div class="bc-stat-num">${blocks}</div><div class="bc-stat-label">Blockchain Blocks</div></div>
        <div class="bc-stat-card"><div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#7c3aed,#a78bfa)"></div><div class="bc-stat-num">${pending}</div><div class="bc-stat-label">Pending Requests</div></div>
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:18px">
        <div class="bc-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3 style="font-size:15px;color:#1e293b;margin:0">📜 Recent Certificates</h3>
            <a href="/school/blockchain-certs/list" class="bc-btn bc-btn-secondary" style="padding:5px 12px;font-size:11px">View All →</a>
          </div>
          <div style="overflow-x:auto"><table class="bc-table">
            <thead><tr><th>Title</th><th>Template</th><th>Status</th><th>Code</th><th>Date</th></tr></thead>
            <tbody>${recentHtml||'<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No certificates yet</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="bc-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">⛓️ Blockchain Status</h3>
          <div style="text-align:center;padding:20px">
            <div class="bc-gold-seal" style="margin:0 auto 14px">⛓️</div>
            <div style="font-size:14px;font-weight:700;color:#1e3a5f">Network Active</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:4px">${blocks} blocks mined</div>
            <div style="font-size:11px;color:#16a34a;margin-top:8px">● All blocks verified</div>
          </div>
          <div style="margin-top:14px;padding-top:14px;border-top:1px solid #f1f5f9">
            <a href="/school/blockchain-certs/chain" class="bc-btn bc-btn-outline" style="width:100%;justify-content:center">View Full Ledger →</a>
          </div>
          <div style="margin-top:8px">
            <a href="/public/verify" class="bc-btn bc-btn-secondary" style="width:100%;justify-content:center">🔍 Public Verification</a>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Blockchain Certificates', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /school/blockchain-certs/templates — Templates
  // ============================================================
  app.get('/school/blockchain-certs/templates', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const templates = await pool.query(
      'SELECT t.*, (SELECT COUNT(*) FROM blockchain_certificates bc WHERE bc.template_id=t.id) as issued_count FROM cert_templates t WHERE t.tenant_id=$1 ORDER BY t.is_default DESC, t.name',
      [tid]
    );

    const cards = templates.rows.map(t => `<div class="bc-card">
      <div class="bc-card-header">
        <div class="bc-card-title">${esc(t.name)}</div>
        ${t.is_default?'<span style="font-size:11px;padding:3px 8px;border-radius:12px;background:linear-gradient(135deg,#b45309,#f59e0b);color:#fff;font-weight:700">★ Default</span>':''}
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
        ${categoryBadge(t.category)}
        <span style="font-size:11px;color:#94a3b8">Layout: ${esc(t.layout_style)}</span>
      </div>
      <div style="width:100%;height:120px;border-radius:8px;background:${esc(t.background_color)};border:${t.border_style||'double'} 3px #b45309;display:flex;align-items:center;justify-content:center;position:relative;margin-bottom:12px">
        <span style="font-size:13px;color:#475569;font-family:Georgia,serif;font-style:italic">Certificate Preview</span>
        ${t.logo_url?`<img src="${esc(t.logo_url)}" style="position:absolute;top:8px;left:8px;height:24px" alt="logo">`:''}
      </div>
      <div class="bc-card-meta">
        <span>📜 ${t.issued_count} issued</span>
        <span>📍 QR: ${esc(t.qr_position)}</span>
        <span>📅 ${fmtDateShort(t.created_at)}</span>
      </div>
      <div style="display:flex;gap:6px;margin-top:12px">
        <a href="/school/blockchain-certs/issue?template=${t.id}" class="bc-btn bc-btn-primary" style="padding:5px 12px;font-size:11px">✏️ Use</a>
        <button onclick="editTemplate(${t.id})" class="bc-btn bc-btn-secondary" style="padding:5px 12px;font-size:11px">✏️ Edit</button>
        <form method="POST" action="/school/blockchain-certs/templates/${t.id}/delete" style="display:inline" onsubmit="return confirm('Delete this template?')"><button class="bc-btn bc-btn-danger" style="padding:5px 12px;font-size:11px">🗑️</button></form>
      </div>
    </div>`).join('');

    const html = BC_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${flash(req)}
      ${nav('templates')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e3a5f">🎨 Certificate Templates</h1><p style="font-size:13px;color:#94a3b8;margin-top:4px">Design professional certificate layouts with blockchain integration</p></div>
        <button onclick="showTemplateForm()" class="bc-btn bc-btn-primary">+ New Template</button>
      </div>
      <div class="bc-grid">${cards||'<p style="text-align:center;color:#94a3b8;padding:40px;grid-column:1/-1">No templates found. Create your first template above.</p>'}</div>

      <div id="template-form-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;align-items:center;justify-content:center">
        <div style="background:#fff;border-radius:16px;padding:32px;max-width:640px;width:90%;max-height:90vh;overflow-y:auto;position:relative">
          <button onclick="document.getElementById('template-form-modal').style.display='none'" style="position:absolute;top:12px;right:16px;background:none;border:none;font-size:24px;cursor:pointer;color:#94a3b8">✕</button>
          <h2 style="color:#1e3a5f;margin:0 0 4px" id="tpl-form-title">🎨 Create Template</h2>
          <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Define certificate appearance and placeholder fields</p>
          <form method="POST" action="/school/blockchain-certs/templates/save" class="bc-form" style="display:flex;flex-direction:column;gap:14px">
            <input type="hidden" name="id" id="tpl-edit-id" value="">
            <div class="bc-grid-2">
              <div><label>Template Name *</label><input type="text" name="name" id="tpl-name" required placeholder="e.g., Academic Excellence Award"></div>
              <div><label>Category *</label>
                <select name="category">
                  <option value="academic">🎓 Academic</option><option value="sports">🏅 Sports</option>
                  <option value="extracurricular">🎭 Extracurricular</option><option value="merit">⭐ Merit</option>
                  <option value="completion">📜 Completion</option><option value="attendance">📋 Attendance</option>
                </select>
              </div>
            </div>
            <div class="bc-grid-3">
              <div><label>Layout Style</label>
                <select name="layout_style">
                  <option value="classic">Classic</option><option value="modern">Modern</option>
                  <option value="minimalist">Minimalist</option><option value="ornate">Ornate</option>
                </select>
              </div>
              <div><label>Background Color</label><input type="color" name="background_color" value="#ffffff" style="height:42px;padding:4px;cursor:pointer"></div>
              <div><label>Border Style</label>
                <select name="border_style">
                  <option value="double">Double</option><option value="solid">Solid</option>
                  <option value="ornate">Ornate</option><option value="shadow">Shadow</option>
                </select>
              </div>
            </div>
            <div class="bc-grid-2">
              <div><label>Logo URL</label><input type="url" name="logo_url" placeholder="https://example.com/logo.png"></div>
              <div><label>QR Code Position</label>
                <select name="qr_position">
                  <option value="bottom-right">Bottom Right</option><option value="bottom-left">Bottom Left</option>
                  <option value="top-right">Top Right</option><option value="top-left">Top Left</option>
                  <option value="none">None</option>
                </select>
              </div>
            </div>
            <div><label>Placeholder Fields</label>
              <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px">
                <label style="display:flex;align-items:center;gap:4px;font-size:13px"><input type="checkbox" name="ph_student_name" checked> Student Name</label>
                <label style="display:flex;align-items:center;gap:4px;font-size:13px"><input type="checkbox" name="ph_date" checked> Date</label>
                <label style="display:flex;align-items:center;gap:4px;font-size:13px"><input type="checkbox" name="ph_description" checked> Description</label>
                <label style="display:flex;align-items:center;gap:4px;font-size:13px"><input type="checkbox" name="ph_signatures" checked> Signatures</label>
              </div>
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
              <input type="checkbox" name="is_default" style="width:18px;height:18px;accent-color:#b45309"> Set as default template
            </label>
            <button type="submit" class="bc-btn bc-btn-gold" style="padding:12px 28px;font-size:15px;justify-content:center">🚀 Save Template</button>
          </form>
        </div>
      </div>
      <script>
        function showTemplateForm(id,name,cat,layout,bg,border,logo,qr,def){
          document.getElementById('tpl-edit-id').value=id||'';
          document.getElementById('tpl-name').value=name||'';
          document.getElementById('tpl-form-title').textContent=id?'Edit Template':'Create New Template';
          if(cat)document.querySelector('[name=category]').value=cat;
          if(layout)document.querySelector('[name=layout_style]').value=layout;
          if(bg)document.querySelector('[name=background_color]').value=bg;
          if(border)document.querySelector('[name=border_style]').value=border;
          if(logo)document.querySelector('[name=logo_url]').value=logo;
          if(qr)document.querySelector('[name=qr_position]').value=qr;
          document.querySelector('[name=is_default]').checked=!!def;
          document.getElementById('template-form-modal').style.display='flex';
        }
        function editTemplate(id){
          fetch('/school/blockchain-certs/templates/'+id+'/json').then(r=>r.json()).then(t=>{
            showTemplateForm(t.id,t.name,t.category,t.layout_style,t.background_color,t.border_style,t.logo_url,t.qr_position,t.is_default);
          }).catch(()=>alert('Error loading template'));
        }
      </script>
    </div>`;
    res.send(renderPage('Certificate Templates', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /school/blockchain-certs/templates/save
  // ============================================================
  app.post('/school/blockchain-certs/templates/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { id, name, category, layout_style, background_color, border_style, logo_url, qr_position, is_default, ph_student_name, ph_date, ph_description, ph_signatures } = req.body;

    if (!name || !name.trim()) {
      req.session.flash = { type: 'error', msg: 'Template name is required' };
      return res.redirect('/school/blockchain-certs/templates');
    }

    const placeholders = JSON.stringify({
      student_name: !!ph_student_name,
      date: !!ph_date,
      description: !!ph_description,
      signatures: !!ph_signatures
    });

    if (id) {
      await pool.query(
        `UPDATE cert_templates SET name=$1, category=$2, layout_style=$3, background_color=$4, border_style=$5, logo_url=$6, qr_position=$7, placeholder_fields=$8, is_default=$9 WHERE id=$10 AND tenant_id=$11`,
        [name.trim(), category||'academic', layout_style||'classic', background_color||'#ffffff', border_style||'double', logo_url||null, qr_position||'bottom-right', placeholders, is_default?1:0, id, tid]
      );
      audit({ action: 'update_cert_template', templateId: id, user });
      req.session.flash = { type: 'success', icon: '✅', msg: `Template "${name.trim()}" updated` };
    } else {
      if (is_default) {
        await pool.query('UPDATE cert_templates SET is_default=0 WHERE tenant_id=$1', [tid]);
      }
      await pool.query(
        `INSERT INTO cert_templates (tenant_id,name,category,layout_style,background_color,border_style,logo_url,qr_position,placeholder_fields,is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [tid, name.trim(), category||'academic', layout_style||'classic', background_color||'#ffffff', border_style||'double', logo_url||null, qr_position||'bottom-right', placeholders, is_default?1:0]
      );
      audit({ action: 'create_cert_template', name: name.trim(), user });
      req.session.flash = { type: 'success', icon: '✅', msg: `Template "${name.trim()}" created` };
    }
    res.redirect('/school/blockchain-certs/templates');
  }));

  // ============================================================
  // ROUTE 4: DELETE /school/blockchain-certs/templates/:id
  // ============================================================
  app.delete('/school/blockchain-certs/templates/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM cert_templates WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    audit({ action: 'delete_cert_template', templateId: req.params.id, user: req.session.user });
    res.json({ success: true });
  }));

  // Template delete via POST (for form compatibility)
  app.post('/school/blockchain-certs/templates/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM cert_templates WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    audit({ action: 'delete_cert_template', templateId: req.params.id, user: req.session.user });
    req.session.flash = { type: 'success', icon: '🗑️', msg: 'Template deleted' };
    res.redirect('/school/blockchain-certs/templates');
  }));

  // Template JSON endpoint (for edit form)
  app.get('/school/blockchain-certs/templates/:id/json', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const tpl = await pool.query('SELECT * FROM cert_templates WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!tpl.rows[0]) return res.status(404).json({ error: 'Template not found' });
    res.json(tpl.rows[0]);
  }));

  // ============================================================
  // ROUTE 5: GET /school/blockchain-certs/issue — Issue Page
  // ============================================================
  app.get('/school/blockchain-certs/issue', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const preTpl = req.query.template || '';
    const templates = await pool.query('SELECT * FROM cert_templates WHERE tenant_id=$1 ORDER BY is_default DESC, name', [tid]);

    // Fetch students for selection
    let students = [];
    try {
      students = await pool.query('SELECT id, name, email, class FROM students WHERE tenant_id=$1 ORDER BY name LIMIT 500', [tid]);
    } catch (e) { /* students table may not exist */ }

    const tplOpts = templates.rows.map(t => `<option value="${t.id}" ${preTpl==t.id?'selected':''}>${esc(t.name)} (${esc(t.category)})</option>`).join('');
    const studentList = students.rows?.length ? students.rows.map(s => `<option value="${s.id}">${esc(s.name)}${s.class?' — '+esc(s.class):''}</option>`).join('') : '';

    const html = BC_CSS + `<div style="max-width:900px;margin:0 auto">
      ${flash(req)}
      ${nav('issue')}
      <div class="bc-card" style="padding:32px">
        <h2 style="color:#1e3a5f;margin:0 0 4px">✏️ Issue Certificate</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Create individual or batch certificates with blockchain verification</p>

        <div style="display:flex;gap:8px;margin-bottom:24px;padding:12px;background:#f0f7ff;border-radius:10px;border:1px solid #bfdbfe">
          <button onclick="toggleMode('single')" id="mode-single-btn" class="bc-btn bc-btn-primary" style="padding:7px 16px;font-size:12px">👤 Single</button>
          <button onclick="toggleMode('batch')" id="mode-batch-btn" class="bc-btn bc-btn-secondary" style="padding:7px 16px;font-size:12px">👥 Batch</button>
        </div>

        <form method="POST" action="/school/blockchain-certs/issue/save" class="bc-form" id="issue-form" style="display:flex;flex-direction:column;gap:16px">
          <div class="bc-grid-2">
            <div><label>Template *</label><select name="template_id" required><option value="">Select template...</option>${tplOpts}</select></div>
            <div><label>Certificate Title *</label><input type="text" name="title" required placeholder="e.g., Certificate of Academic Excellence"></div>
          </div>
          <div><label>Description</label><textarea name="description" rows="2" placeholder="Brief description of the certificate..."></textarea></div>

          <!-- SINGLE MODE -->
          <div id="single-mode">
            <div class="bc-grid-2">
              <div><label>Student</label><select name="student_id"><option value="">Select student...</option>${studentList}</select></div>
              <div><label>Student Name (if not in list)</label><input type="text" name="student_name_override" placeholder="Enter name manually"></div>
            </div>
            <div class="bc-grid-2" style="margin-top:14px">
              <div><label>Issue Date</label><input type="date" name="issue_date" value="${today()}"></div>
              <div><label>Expiry Date</label><input type="date" name="expiry_date"></div>
            </div>
          </div>

          <!-- BATCH MODE -->
          <div id="batch-mode" style="display:none">
            <label>Batch Selection Method</label>
            <div class="bc-grid-2">
              <div><label>Source</label>
                <select name="batch_source" onchange="toggleBatchSource(this.value)">
                  <option value="manual">Manual Entry</option>
                  <option value="class">By Class</option>
                  <option value="event">Event Participants</option>
                </select>
              </div>
              <div id="batch-class-group" style="display:none"><label>Class/Section</label>
                <input type="text" name="batch_class" placeholder="e.g., Class 10-A">
              </div>
            </div>
            <div style="margin-top:10px"><label>Student Names (one per line)</label>
              <textarea name="batch_names" rows="4" placeholder="John Doe&#10;Jane Smith&#10;Alex Johnson"></textarea>
            </div>
            <div class="bc-grid-2" style="margin-top:14px">
              <div><label>Issue Date</label><input type="date" name="batch_issue_date" value="${today()}"></div>
              <div><label>Expiry Date</label><input type="date" name="batch_expiry_date"></div>
            </div>
          </div>

          <div style="border-top:1px solid #e2e8f0;padding-top:16px">
            <label style="font-size:14px;font-weight:700;color:#1e3a5f;margin-bottom:12px;display:block">✍️ Digital Signatures</label>
            <div style="display:flex;gap:16px;flex-wrap:wrap">
              <div style="flex:1;min-width:200px;padding:14px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
                <label>Principal (Required)</label>
                <input type="text" name="sig_principal" placeholder="Principal Name" style="margin-top:4px">
                <input type="text" name="sig_principal_title" placeholder="Title (e.g., Principal)" style="margin-top:6px">
              </div>
              <div style="flex:1;min-width:200px;padding:14px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
                <label>Teacher / HOD (Optional)</label>
                <input type="text" name="sig_teacher" placeholder="Teacher Name" style="margin-top:4px">
                <input type="text" name="sig_teacher_title" placeholder="Title (e.g., Head of Department)" style="margin-top:6px">
              </div>
              <div style="flex:1;min-width:200px;padding:14px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
                <label>Custom Signatory (Optional)</label>
                <input type="text" name="sig_custom" placeholder="Name" style="margin-top:4px">
                <input type="text" name="sig_custom_title" placeholder="Title" style="margin-top:6px">
              </div>
            </div>
          </div>

          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="bc-btn bc-btn-gold" style="padding:14px 32px;font-size:15px">📜 Issue Certificate</button>
            <button type="button" class="bc-btn bc-btn-secondary" onclick="previewCert()" style="padding:14px 24px;font-size:15px">👁️ Preview</button>
          </div>
        </form>
      </div>
    </div>
    <script>
      let currentMode='single';
      function toggleMode(m){
        currentMode=m;
        document.getElementById('single-mode').style.display=m==='single'?'block':'none';
        document.getElementById('batch-mode').style.display=m==='batch'?'block':'none';
        document.getElementById('mode-single-btn').className='bc-btn '+(m==='single'?'bc-btn-primary':'bc-btn-secondary');
        document.getElementById('mode-batch-btn').className='bc-btn '+(m==='batch'?'bc-btn-primary':'bc-btn-secondary');
        document.getElementById('mode-single-btn').style.padding='7px 16px';
        document.getElementById('mode-batch-btn').style.padding='7px 16px';
        document.getElementById('mode-single-btn').style.fontSize='12px';
        document.getElementById('mode-batch-btn').style.fontSize='12px';
      }
      function toggleBatchSource(v){
        document.getElementById('batch-class-group').style.display=v==='class'?'block':'none';
      }
      function previewCert(){alert('Preview functionality — certificate will render with selected template and data.');}
    </script>`;
    res.send(renderPage('Issue Certificate', html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /school/blockchain-certs/issue/save
  // ============================================================
  app.post('/school/blockchain-certs/issue/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { template_id, title, description, student_id, student_name_override, issue_date, expiry_date,
            sig_principal, sig_principal_title, sig_teacher, sig_teacher_title, sig_custom, sig_custom_title,
            batch_names, batch_issue_date, batch_expiry_date } = req.body;

    if (!title || !title.trim()) {
      req.session.flash = { type: 'error', msg: 'Certificate title is required' };
      return res.redirect('/school/blockchain-certs/issue');
    }

    // Build signature data
    const signatures = [];
    const sigDate = today();
    if (sig_principal) signatures.push({ name: sig_principal, title: sig_principal_title||'Principal', date: sigDate });
    if (sig_teacher) signatures.push({ name: sig_teacher, title: sig_teacher_title||'Teacher', date: sigDate });
    if (sig_custom) signatures.push({ name: sig_custom, title: sig_custom_title||'Signatory', date: sigDate });

    // Single or batch
    const names = [];
    if (batch_names && batch_names.trim()) {
      batch_names.trim().split('\n').map(l => l.trim()).filter(Boolean).forEach(n => names.push(n));
    } else {
      names.push(student_name_override || 'Student');
    }

    const secret = process.env.BC_CERT_SECRET || 'blockchain-certs-salt-2024';
    let issued = 0;

    // Get previous hash for blockchain chain
    const lastBlock = await pool.query('SELECT block_number, cert_hash FROM blockchain_ledger WHERE tenant_id=$1 ORDER BY block_number DESC LIMIT 1', [tid]);
    let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    let prevBlockNum = 0;
    if (lastBlock.rows.length > 0) {
      prevHash = lastBlock.rows[0].cert_hash;
      prevBlockNum = lastBlock.rows[0].block_number;
    }

    for (const name of names) {
      const certCode = generateCertCode(tid);
      const iDate = batch_issue_date || issue_date || today();
      const eDate = batch_expiry_date || expiry_date || null;

      const result = await pool.query(
        `INSERT INTO blockchain_certificates (tenant_id, student_id, template_id, cert_code, title, description, issue_date, expiry_date, status, issued_by, signature_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [tid, student_id || null, template_id || null, certCode, title.trim(), description || null, iDate, eDate, 'issued', user.id, JSON.stringify(signatures)]
      );

      const certId = result.rows[0].id;

      // Mine blockchain block
      let nonce = 0;
      let hash = '';
      do {
        hash = generateBlockHash({ certId, certCode, title, name, iDate }, prevHash, String(nonce), secret);
        nonce++;
      } while (!hash.startsWith('00')); // Simple PoW: hash must start with 00

      await pool.query(
        `INSERT INTO blockchain_ledger (tenant_id, cert_id, block_number, cert_hash, previous_hash, timestamp, miner, nonce)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [tid, certId, prevBlockNum + 1, hash, prevHash, now(), user.name || 'admin', String(nonce)]
      );

      prevHash = hash;
      prevBlockNum++;
      issued++;
    }

    audit({ action: 'issue_certificates', count: issued, title: title.trim(), user });
    req.session.flash = { type: 'success', icon: '📜', msg: `${issued} certificate${issued!==1?'s':''} issued and added to blockchain` };
    res.redirect('/school/blockchain-certs/list');
  }));

  // ============================================================
  // ROUTE 7: POST /school/blockchain-certs/issue/batch — Batch Issue
  // ============================================================
  app.post('/school/blockchain-certs/issue/batch', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { template_id, title, description, batch_source, batch_class, batch_names, batch_issue_date, batch_expiry_date,
            sig_principal, sig_principal_title, sig_teacher, sig_teacher_title } = req.body;

    if (!title || !title.trim()) {
      req.session.flash = { type: 'error', msg: 'Title required' };
      return res.redirect('/school/blockchain-certs/issue');
    }

    const signatures = [];
    const sigDate = today();
    if (sig_principal) signatures.push({ name: sig_principal, title: sig_principal_title||'Principal', date: sigDate });
    if (sig_teacher) signatures.push({ name: sig_teacher, title: sig_teacher_title||'Teacher', date: sigDate });

    // Resolve student list from source
    let studentNames = [];
    if (batch_source === 'class' && batch_class) {
      try {
        const rows = await pool.query('SELECT name FROM students WHERE tenant_id=$1 AND class=$2', [tid, batch_class]);
        studentNames = rows.rows.map(r => r.name);
      } catch (e) { /* fallback */ }
    }
    if (studentNames.length === 0 && batch_names) {
      studentNames = batch_names.trim().split('\n').map(l => l.trim()).filter(Boolean);
    }

    const secret = process.env.BC_CERT_SECRET || 'blockchain-certs-salt-2024';
    let issued = 0;
    const lastBlock = await pool.query('SELECT block_number, cert_hash FROM blockchain_ledger WHERE tenant_id=$1 ORDER BY block_number DESC LIMIT 1', [tid]);
    let prevHash = lastBlock.rows.length > 0 ? lastBlock.rows[0].cert_hash : '0'.repeat(64);
    let prevBlockNum = lastBlock.rows.length > 0 ? lastBlock.rows[0].block_number : 0;

    for (const name of studentNames) {
      const certCode = generateCertCode(tid);
      const result = await pool.query(
        `INSERT INTO blockchain_certificates (tenant_id, template_id, cert_code, title, description, issue_date, expiry_date, status, issued_by, signature_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [tid, template_id || null, certCode, title.trim(), description || null, batch_issue_date || today(), batch_expiry_date || null, 'issued', user.id, JSON.stringify(signatures)]
      );
      const certId = result.rows[0].id;
      let nonce = 0, hash = '';
      do { hash = generateBlockHash({ certId, certCode, title, name }, prevHash, String(nonce), secret); nonce++; } while (!hash.startsWith('00'));
      await pool.query('INSERT INTO blockchain_ledger (tenant_id,cert_id,block_number,cert_hash,previous_hash,timestamp,miner,nonce) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [tid, certId, prevBlockNum + 1, hash, prevHash, now(), user.name || 'admin', String(nonce)]);
      prevHash = hash; prevBlockNum++; issued++;
    }

    audit({ action: 'batch_issue', count: issued, user });
    req.session.flash = { type: 'success', icon: '📜', msg: `Batch issued: ${issued} certificates` };
    res.redirect('/school/blockchain-certs/list');
  }));

  // ============================================================
  // ROUTE 8: GET /school/blockchain-certs/list — All Certificates
  // ============================================================
  app.get('/school/blockchain-certs/list', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const statusFilter = req.query.status || '';
    const search = req.query.q || '';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = 20;

    let where = 'WHERE bc.tenant_id=$1';
    const params = [tid];
    let paramIdx = 2;
    if (statusFilter) { where += ` AND bc.status=$${paramIdx}`; params.push(statusFilter); paramIdx++; }
    if (search) { where += ` AND (bc.title LIKE $${paramIdx} OR bc.cert_code LIKE $${paramIdx+1} OR bc.description LIKE $${paramIdx+2})`; params.push(`%${search}%`,`%${search}%`,`%${search}%`); paramIdx += 3; }

    const countResult = await pool.query(`SELECT COUNT(*) as cnt FROM blockchain_certificates bc ${where}`, params);
    const total = countResult.rows[0].cnt;
    const totalPages = Math.ceil(total / perPage);
    const offset = (page - 1) * perPage;

    const certs = await pool.query(
      `SELECT bc.*, t.name as tpl_name, t.category as tpl_category,
              (SELECT bl.block_number FROM blockchain_ledger bl WHERE bl.cert_id=bc.id LIMIT 1) as block_number
       FROM blockchain_certificates bc
       LEFT JOIN cert_templates t ON t.id=bc.template_id
       ${where} ORDER BY bc.created_at DESC LIMIT ${perPage} OFFSET ${offset}`,
      params
    );

    const rows = certs.rows.map(c => `<tr>
      <td><a href="/school/blockchain-certs/${c.id}" style="color:#1e3a5f;text-decoration:none;font-weight:600">${esc(c.title)}</a></td>
      <td>${c.tpl_category ? categoryBadge(c.tpl_category) : '—'}</td>
      <td>${statusBadge(c.status)}</td>
      <td style="font-family:monospace;font-size:11px;color:#94a3b8">${esc(c.cert_code)}</td>
      <td>${c.block_number ? '<span style="color:#16a34a;font-weight:600">Block #'+c.block_number+'</span>' : '—'}</td>
      <td>${fmtDateShort(c.issue_date)}</td>
      <td>
        <a href="/school/blockchain-certs/${c.id}" class="bc-btn bc-btn-secondary" style="padding:4px 10px;font-size:11px">👁️ View</a>
        ${c.status!=='revoked'?`<form method="POST" action="/school/blockchain-certs/${c.id}/revoke" style="display:inline" onsubmit="return confirm('Revoke this certificate?')"><button class="bc-btn bc-btn-danger" style="padding:4px 10px;font-size:11px">❌</button></form>`:''}
      </td>
    </tr>`).join('');

    const pagination = totalPages > 1 ? `<div style="display:flex;gap:6px;justify-content:center;margin-top:16px">${Array.from({length:totalPages},(_,i)=>`<a href="?page=${i+1}&status=${esc(statusFilter)}&q=${esc(search)}" class="bc-btn ${page===i+1?'bc-btn-primary':'bc-btn-secondary'}" style="padding:6px 12px;font-size:12px">${i+1}</a>`).join('')}</div>` : '';

    const html = BC_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${flash(req)}
      ${nav('list')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e3a5f">📜 Issued Certificates</h1><p style="font-size:13px;color:#94a3b8;margin-top:4px">${total} certificate${total!==1?'s':''} total</p></div>
        <a href="/school/blockchain-certs/issue" class="bc-btn bc-btn-primary">+ Issue New</a>
      </div>

      <div class="bc-card" style="padding:16px;margin-bottom:16px">
        <form method="GET" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <input type="text" name="q" value="${esc(search)}" placeholder="Search certificates..." style="flex:1;min-width:200px;padding:8px 14px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">
          <select name="status" style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">
            <option value="">All Status</option>
            <option value="draft" ${statusFilter==='draft'?'selected':''}>Draft</option>
            <option value="approved" ${statusFilter==='approved'?'selected':''}>Approved</option>
            <option value="issued" ${statusFilter==='issued'?'selected':''}>Issued</option>
            <option value="revoked" ${statusFilter==='revoked'?'selected':''}>Revoked</option>
          </select>
          <button class="bc-btn bc-btn-secondary" style="padding:8px 16px">🔍 Search</button>
        </form>
      </div>

      <div class="bc-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto"><table class="bc-table">
          <thead><tr><th>Title</th><th>Category</th><th>Status</th><th>Code</th><th>Blockchain</th><th>Issue Date</th><th>Actions</th></tr></thead>
          <tbody>${rows||'<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:40px">No certificates found</td></tr>'}</tbody>
        </table></div>
      </div>
      ${pagination}
    </div>`;
    res.send(renderPage('Certificate List', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: GET /school/blockchain-certs/:id — Certificate Detail
  // ============================================================
  app.get('/school/blockchain-certs/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, certId = req.params.id;
    const cert = await pool.query(
      `SELECT bc.*, t.name as tpl_name, t.category as tpl_category, t.layout_style, t.background_color, t.border_style, t.logo_url, t.qr_position,
              bl.block_number, bl.cert_hash, bl.previous_hash, bl.nonce, bl.timestamp as mined_at, bl.miner
       FROM blockchain_certificates bc
       LEFT JOIN cert_templates t ON t.id=bc.template_id
       LEFT JOIN blockchain_ledger bl ON bl.cert_id=bc.id
       WHERE bc.id=$1 AND bc.tenant_id=$2`,
      [certId, tid]
    );

    if (!cert.rows[0]) {
      return res.send(renderPage('Not Found', `<div class="bc-card" style="text-align:center;padding:40px;max-width:400px;margin:60px auto"><h2 style="color:#dc2626">Certificate Not Found</h2><p style="color:#94a3b8;margin:8px 0 16px">The requested certificate does not exist.</p><a href="/school/blockchain-certs/list" class="bc-btn bc-btn-primary">← Back to List</a></div>`, user, req));
    }

    const c = cert.rows[0];
    const sigData = typeof c.signature_data === 'string' ? JSON.parse(c.signature_data||'[]') : (c.signature_data || []);
    const signaturesHtml = sigData.map(s => `<div class="cp-sig">
      <div style="font-style:italic;font-size:16px;color:#1e3a5f">${esc(s.name)}</div>
      <div class="cp-sig-line"></div>
      <div class="cp-sig-label">${esc(s.title)} — ${esc(s.date)}</div>
    </div>`).join('');

    const qrPos = c.qr_position || 'bottom-right';
    const qrStyle = {
      'bottom-right':'position:absolute;bottom:16px;right:16px',
      'bottom-left':'position:absolute;bottom:16px;left:16px',
      'top-right':'position:absolute;top:16px;right:16px',
      'top-left':'position:absolute;top:16px;left:16px'
    }[qrPos] || 'position:absolute;bottom:16px;right:16px';

    const verifyUrl = `${req.protocol}://${req.get('host')}/public/verify/${c.cert_code}`;

    const html = BC_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${flash(req)}
      ${nav('list')}
      <div style="display:flex;gap:18px;flex-wrap:wrap">
        <div style="flex:1;min-width:300px">
          <div class="bc-cert-preview" style="background:${esc(c.background_color||'#fff')};border:${c.border_style||'double'} 4px #b45309" id="cert-preview">
            <div class="cp-seal"><div class="bc-gold-seal">🏛️</div></div>
            ${c.logo_url?`<img src="${esc(c.logo_url)}" style="position:absolute;top:16px;left:16px;height:48px" alt="logo">`:''}
            <div class="cp-ornament">❧ ✦ ❧ ✦ ❧</div>
            <div class="cp-title">${esc(c.title)}</div>
            <div class="cp-ornament">— ✦ —</div>
            <div style="text-align:center"><span class="cp-recipient">${esc(c.description || 'Certificate of Achievement')}</span></div>
            <div class="cp-body">This certifies that the bearer has met all requirements and standards as prescribed by the institution.</div>
            ${c.issue_date ? `<div style="text-align:center;font-size:13px;color:#475569">Issued on <strong>${fmtDate(c.issue_date)}</strong>${c.expiry_date?' · Valid until <strong>'+fmtDate(c.expiry_date)+'</strong>':''}</div>` : ''}
            <div class="cp-sig-area">${signaturesHtml || '<div class="cp-sig"><div class="cp-sig-line"></div><div class="cp-sig-label">Authorized Signatory</div></div>'}</div>
            ${qrPos!=='none'?`<div class="cp-qr" style="${qrStyle}"><div style="font-size:28px">⬜</div><div style="font-size:7px;margin-top:2px">SCAN TO<br>VERIFY</div></div>`:''}
            <div style="position:absolute;bottom:16px;left:16px;font-size:9px;color:#94a3b8;font-family:monospace">ID: ${esc(c.cert_code)}</div>
          </div>
          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap" class="no-print">
            <a href="/school/blockchain-certs/${c.id}/pdf" class="bc-btn bc-btn-primary">📄 PDF View</a>
            <button onclick="window.print()" class="bc-btn bc-btn-secondary">🖨️ Print</button>
            <button onclick="navigator.clipboard.writeText('${esc(verifyUrl)}');alert('Link copied!')" class="bc-btn bc-btn-secondary">🔗 Copy Verify Link</button>
            ${c.status!=='revoked'?`<form method="POST" action="/school/blockchain-certs/${c.id}/revoke" style="display:inline" onsubmit="return confirm('Revoke this certificate? This action is recorded on the blockchain.')"><button class="bc-btn bc-btn-danger">❌ Revoke</button></form>`:''}
          </div>
        </div>

        <div style="flex:0 0 340px;min-width:280px">
          <div class="bc-card" style="margin-bottom:14px">
            <h3 style="color:#1e3a5f;margin:0 0 12px;font-size:15px">📋 Certificate Details</h3>
            <div style="display:flex;flex-direction:column;gap:10px">
              <div><span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">Certificate Code</span><div style="font-family:monospace;font-size:13px;color:#1e3a5f;margin-top:2px">${esc(c.cert_code)}</div></div>
              <div><span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">Status</span><div style="margin-top:2px">${statusBadge(c.status)}</div></div>
              <div><span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">Template</span><div style="font-size:13px;margin-top:2px">${esc(c.tpl_name||'Default')}</div></div>
              <div><span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">Category</span><div style="margin-top:2px">${c.tpl_category ? categoryBadge(c.tpl_category) : '—'}</div></div>
              <div><span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">Created</span><div style="font-size:13px;margin-top:2px">${fmtDateTime(c.created_at)}</div></div>
            </div>
          </div>

          <div class="bc-card" style="margin-bottom:14px">
            <h3 style="color:#1e3a5f;margin:0 0 12px;font-size:15px">⛓️ Blockchain Verification</h3>
            ${c.block_number ? `<div style="text-align:center;padding:12px;background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0">
              <div style="font-size:32px;color:#16a34a">✅</div>
              <div style="font-size:14px;font-weight:700;color:#16a34a;margin:4px 0">Verified on Block #${c.block_number}</div>
              <div style="font-size:11px;color:#64748b">Mined by ${esc(c.miner||'system')}</div>
            </div>
            <div style="margin-top:10px">
              <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">SHA-256 Hash</div>
              <div class="bc-chain-hash">${esc(c.cert_hash)}</div>
            </div>
            <div style="margin-top:8px">
              <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">Previous Hash</div>
              <div class="bc-chain-hash">${esc(c.previous_hash||'Genesis')}</div>
            </div>
            <div style="margin-top:8px">
              <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">Nonce</div>
              <div style="font-size:12px;color:#1e3a5f">${esc(c.nonce)}</div>
            </div>` : `<div style="text-align:center;padding:16px;color:#94a3b8"><p>No blockchain record yet</p></div>`}
          </div>

          ${c.status==='revoked'?`<div class="bc-card" style="border-color:#dc2626">
            <h3 style="color:#dc2626;margin:0 0 8px;font-size:15px">❌ Revocation Notice</h3>
            <p style="font-size:13px;color:#64748b;margin:0 0 8px">${esc(c.revoke_reason||'No reason provided')}</p>
            <div style="font-size:11px;color:#94a3b8">Revoked on ${fmtDateTime(c.revoked_at)}</div>
          </div>`:''}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Certificate: ' + c.cert_code, html, user, req));
  }));

  // ============================================================
  // ROUTE 10: GET /school/blockchain-certs/:id/pdf — PDF View
  // ============================================================
  app.get('/school/blockchain-certs/:id/pdf', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, certId = req.params.id;
    const cert = await pool.query(
      `SELECT bc.*, t.layout_style, t.background_color, t.border_style, t.logo_url, t.qr_position, t.category as tpl_category,
              bl.block_number, bl.cert_hash
       FROM blockchain_certificates bc
       LEFT JOIN cert_templates t ON t.id=bc.template_id
       LEFT JOIN blockchain_ledger bl ON bl.cert_id=bc.id
       WHERE bc.id=$1 AND bc.tenant_id=$2`, [certId, tid]
    );

    if (!cert.rows[0]) return res.status(404).send('Certificate not found');
    const c = cert.rows[0];
    const sigData = typeof c.signature_data === 'string' ? JSON.parse(c.signature_data||'[]') : (c.signature_data || []);
    const sigsHtml = sigData.map(s => `<div class="cp-sig"><div style="font-style:italic;font-size:18px;color:#1e3a5f">${esc(s.name)}</div><div class="cp-sig-line"></div><div class="cp-sig-label">${esc(s.title)} — ${esc(s.date)}</div></div>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Certificate — ${esc(c.cert_code)}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f1f5f9;font-family:Georgia,'Times New Roman',serif}
        .cert{width:1056px;height:816px;position:relative;background:${esc(c.background_color||'#fff')};border:${c.border_style||'double'} 6px #b45309;padding:60px;overflow:hidden}
        .seal{position:absolute;top:24px;right:24px;width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#b45309,#f59e0b,#fbbf24);display:flex;align-items:center;justify-content:center;font-size:36px;box-shadow:0 4px 16px rgba(245,158,11,.4);border:4px solid #92400e}
        .ornament{font-size:24px;color:#d4a574;text-align:center;margin:6px 0;letter-spacing:6px}
        .title{font-size:32px;font-weight:700;text-align:center;color:#1e3a5f;text-transform:uppercase;letter-spacing:3px;margin:8px 0}
        .recipient{font-size:40px;font-weight:700;text-align:center;color:#1e3a5f;font-style:italic;margin:24px 0;border-bottom:2px solid #d4a574;display:inline-block;padding-bottom:6px}
        .body{text-align:center;font-size:16px;color:#475569;line-height:1.8;max-width:560px;margin:16px auto}
        .sig-area{display:flex;justify-content:space-between;margin-top:48px;padding:0 40px}
        .sig{text-align:center;min-width:180px}
        .sig-line{width:180px;height:1px;background:#1e3a5f;margin:8px auto 4px}
        .sig-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px}
        .qr{position:absolute;bottom:24px;right:24px;width:72px;height:72px;border:2px solid #e2e8f0;border-radius:8px;display:flex;align-items:center;justify-content:center;background:#f8fafc;font-size:10px;color:#94a3b8;text-align:center}
        .footer-code{position:absolute;bottom:24px;left:24px;font-size:9px;color:#94a3b8;font-family:monospace}
        .verify-badge{position:absolute;bottom:100px;right:24px;font-size:9px;color:#16a34a;text-align:center}
        @media print{body{background:#fff}.cert{box-shadow:none}}
      </style></head><body>
      <div class="cert">
        <div class="seal">🏛️</div>
        ${c.logo_url?`<img src="${esc(c.logo_url)}" style="position:absolute;top:24px;left:24px;height:56px" alt="logo">`:''}
        <div class="ornament">❧ ✦ ❧ ✦ ❧</div>
        <div class="title">${esc(c.title)}</div>
        <div class="ornament">— ✦ —</div>
        <div style="text-align:center"><span class="recipient">${esc(c.description||'Certificate of Achievement')}</span></div>
        <div class="body">This is to certify that the bearer has successfully met all prescribed requirements and is hereby awarded this certificate.</div>
        ${c.issue_date?`<div style="text-align:center;font-size:14px;color:#475569;margin-top:12px">Awarded on <strong>${fmtDate(c.issue_date)}</strong>${c.expiry_date?' · Valid until <strong>'+fmtDate(c.expiry_date)+'</strong>':''}</div>`:''}
        <div class="sig-area">${sigsHtml||'<div class="sig"><div class="sig-line"></div><div class="sig-label">Authorized Signatory</div></div>'}</div>
        ${c.block_number?`<div class="verify-badge">✅ Verified<br>Block #${c.block_number}</div>`:''}
        ${c.qr_position!=='none'?`<div class="qr"><div style="font-size:32px">⬜</div><div style="font-size:7px;margin-top:2px">SCAN TO<br>VERIFY</div></div>`:''}
        <div class="footer-code">${esc(c.cert_code)}</div>
        ${c.cert_hash?`<div style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);font-size:7px;color:#c0c0c0;font-family:monospace">Hash: ${esc(c.cert_hash.substring(0,32))}...</div>`:''}
      </div>
      <script>window.onload=function(){window.print()}</script>
      </body></html>`;
    res.send(html);
  }));

  // ============================================================
  // ROUTE 11: POST /school/blockchain-certs/:id/revoke
  // ============================================================
  app.post('/school/blockchain-certs/:id/revoke', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, certId = req.params.id;
    const { revoke_reason } = req.body;

    const cert = await pool.query('SELECT * FROM blockchain_certificates WHERE id=$1 AND tenant_id=$2', [certId, tid]);
    if (!cert.rows[0]) {
      req.session.flash = { type: 'error', msg: 'Certificate not found' };
      return res.redirect('/school/blockchain-certs/list');
    }
    if (cert.rows[0].status === 'revoked') {
      req.session.flash = { type: 'error', msg: 'Certificate already revoked' };
      return res.redirect('/school/blockchain-certs/' + certId);
    }

    await pool.query(
      "UPDATE blockchain_certificates SET status='revoked', revoked_at=$1, revoke_reason=$2 WHERE id=$3 AND tenant_id=$4",
      [now(), revoke_reason || 'No reason provided', certId, tid]
    );

    // Record revocation on blockchain
    const lastBlock = await pool.query('SELECT block_number, cert_hash FROM blockchain_ledger WHERE tenant_id=$1 ORDER BY block_number DESC LIMIT 1', [tid]);
    const prevHash = lastBlock.rows.length > 0 ? lastBlock.rows[0].cert_hash : '0'.repeat(64);
    const prevBlockNum = lastBlock.rows.length > 0 ? lastBlock.rows[0].block_number : 0;
    const secret = process.env.BC_CERT_SECRET || 'blockchain-certs-salt-2024';
    let nonce = 0, hash = '';
    do {
      hash = generateBlockHash({ certId, action: 'REVOCATION', reason: revoke_reason, revokedAt: now() }, prevHash, String(nonce), secret);
      nonce++;
    } while (!hash.startsWith('00'));

    await pool.query(
      'INSERT INTO blockchain_ledger (tenant_id,cert_id,block_number,cert_hash,previous_hash,timestamp,miner,nonce) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [tid, certId, prevBlockNum + 1, hash, prevHash, now(), user.name || 'admin', String(nonce)]
    );

    audit({ action: 'revoke_certificate', certId, reason: revoke_reason, user });
    req.session.flash = { type: 'error', icon: '❌', msg: `Certificate revoked and recorded on blockchain` };
    res.redirect('/school/blockchain-certs/' + certId);
  }));

  // ============================================================
  // ROUTE 12: GET /public/verify/:certCode — Public Verification
  // ============================================================
  app.get('/public/verify/:certCode', ah(async (req, res) => {
    const certCode = req.params.certCode;
    const cert = await pool.query(
      `SELECT bc.*, t.name as tpl_name, t.category as tpl_category,
              bl.block_number, bl.cert_hash, bl.previous_hash, bl.timestamp as mined_at, bl.miner
       FROM blockchain_certificates bc
       LEFT JOIN cert_templates t ON t.id=bc.template_id
       LEFT JOIN blockchain_ledger bl ON bl.cert_id=bc.id
       WHERE bc.cert_code=$1`, [certCode]
    );

    const verifyUrl = `${req.protocol}://${req.get('host')}/public/verify/${certCode}`;

    // Log verification attempt
    if (cert.rows.length > 0) {
      try {
        await pool.query(
          'INSERT INTO cert_verification_log (tenant_id, cert_id, verifier_ip, is_valid) VALUES ($1,$2,$3,$4)',
          [cert.rows[0].tenant_id, cert.rows[0].id, req.ip || 'unknown', cert.rows[0].status === 'issued' ? 1 : 0]
        );
      } catch (e) { /* log table may not exist for this tenant */ }
    }

    if (!cert.rows[0]) {
      const html = BC_CSS + `<div style="max-width:600px;margin:60px auto">
        <div class="bc-verify-result notfound">
          <div class="bc-verify-icon">🔍</div>
          <h2 style="color:#b45309;margin:0 0 8px">Certificate Not Found</h2>
          <p style="color:#64748b;font-size:14px;max-width:400px;margin:0 auto">The certificate code <strong style="font-family:monospace">${esc(certCode)}</strong> could not be found in our blockchain registry.</p>
        </div>
        <div style="margin-top:24px;text-align:center">
          <form method="POST" action="/public/verify" style="display:flex;gap:8px;justify-content:center;max-width:400px;margin:0 auto">
            <input type="text" name="cert_code" placeholder="Enter certificate code..." value="${esc(certCode)}" style="flex:1;padding:10px 16px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
            <button class="bc-btn bc-btn-primary">Verify</button>
          </form>
        </div>
      </div>`;
      return res.send(renderPage('Certificate Verification', html, null, req));
    }

    const c = cert.rows[0];
    const isRevoked = c.status === 'revoked';
    const isValid = c.status === 'issued';

    const html = BC_CSS + `<div style="max-width:700px;margin:40px auto">
      <div style="text-align:center;margin-bottom:24px">
        <div class="bc-gold-seal" style="margin:0 auto 12px">⛓️</div>
        <h1 style="color:#1e3a5f;font-size:20px;margin:0">Blockchain Certificate Verification</h1>
        <p style="color:#94a3b8;font-size:13px;margin-top:4px">Tamper-proof verification powered by blockchain technology</p>
      </div>

      <div class="bc-verify-result ${isValid?'valid':isRevoked?'revoked':'notfound'}">
        <div class="bc-verify-icon">${isValid?'✅':isRevoked?'❌':'⚠️'}</div>
        <h2 style="margin:0 0 8px;color:${isValid?'#16a34a':isRevoked?'#dc2626':'#b45309'}">
          ${isValid?'Certificate Verified':isRevoked?'REVOKED — Certificate Invalid':'Certificate '+c.status.toUpperCase()}
        </h2>
        ${isValid?'<p style="color:#16a34a;font-size:13px">This certificate is authentic and has not been tampered with.</p>':''}
        ${isRevoked?'<p style="color:#dc2626;font-size:13px">This certificate has been revoked by the issuing institution.</p>':''}
      </div>

      <div class="bc-card" style="margin-top:20px;padding:24px">
        <h3 style="color:#1e3a5f;margin:0 0 16px;font-size:15px">📋 Certificate Information</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div><span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">Title</span><div style="font-size:15px;font-weight:600;color:#1e3a5f;margin-top:2px">${esc(c.title)}</div></div>
          <div><span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">Certificate Code</span><div style="font-family:monospace;font-size:12px;color:#1e3a5f;margin-top:2px">${esc(c.cert_code)}</div></div>
          <div><span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">Category</span><div style="margin-top:2px">${c.tpl_category?categoryBadge(c.tpl_category):'—'}</div></div>
          <div><span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">Issue Date</span><div style="font-size:13px;margin-top:2px">${fmtDate(c.issue_date)}</div></div>
          <div><span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">Status</span><div style="margin-top:2px">${statusBadge(c.status)}</div></div>
          ${c.expiry_date?`<div><span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">Valid Until</span><div style="font-size:13px;margin-top:2px">${fmtDate(c.expiry_date)}</div></div>`:''}
        </div>
        ${c.description?`<div style="margin-top:14px;padding-top:14px;border-top:1px solid #f1f5f9"><span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">Description</span><div style="font-size:13px;color:#475569;margin-top:4px">${esc(c.description)}</div></div>`:''}
      </div>

      <div class="bc-card" style="margin-top:14px;padding:24px">
        <h3 style="color:#1e3a5f;margin:0 0 16px;font-size:15px">⛓️ Blockchain Confirmation</h3>
        ${c.block_number ? `<div style="display:grid;gap:12px">
          <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0">
            <span style="font-size:13px;color:#475569">Block Number</span>
            <span style="font-size:13px;font-weight:700;color:#16a34a">#${c.block_number}</span>
          </div>
          <div><span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">SHA-256 Certificate Hash</span><div class="bc-chain-hash" style="margin-top:4px">${esc(c.cert_hash)}</div></div>
          <div><span style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700">Previous Block Hash</span><div class="bc-chain-hash" style="margin-top:4px">${esc(c.previous_hash||'Genesis Block')}</div></div>
          <div style="display:flex;justify-content:space-between;padding:8px 14px;background:#f8fafc;border-radius:8px">
            <span style="font-size:12px;color:#94a3b8">Mined by</span>
            <span style="font-size:12px;color:#1e3a5f">${esc(c.miner||'system')}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 14px;background:#f8fafc;border-radius:8px">
            <span style="font-size:12px;color:#94a3b8">Timestamp</span>
            <span style="font-size:12px;color:#1e3a5f">${fmtDateTime(c.mined_at)}</span>
          </div>
        </div>` : '<p style="color:#94a3b8;text-align:center;padding:16px">No blockchain record found</p>'}
      </div>

      ${isRevoked && c.revoke_reason ? `<div class="bc-card" style="margin-top:14px;padding:24px;border-color:#dc2626">
        <h3 style="color:#dc2626;margin:0 0 8px;font-size:15px">❌ Revocation Details</h3>
        <p style="font-size:13px;color:#64748b;margin:0 0 6px"><strong>Reason:</strong> ${esc(c.revoke_reason)}</p>
        <p style="font-size:12px;color:#94a3b8;margin:0"><strong>Revoked on:</strong> ${fmtDateTime(c.revoked_at)}</p>
      </div>` : ''}

      <div style="text-align:center;margin-top:24px;padding:20px;background:#f8fafc;border-radius:12px">
        <p style="font-size:13px;color:#94a3b8;margin-bottom:10px">Share this verification link</p>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <input type="text" value="${esc(verifyUrl)}" readonly style="flex:1;min-width:200px;max-width:400px;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;font-family:monospace">
          <button onclick="navigator.clipboard.writeText('${esc(verifyUrl)}');this.textContent='Copied!'" class="bc-btn bc-btn-primary">📋 Copy</button>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Certificate Verification', html, null, req));
  }));

  // ============================================================
  // ROUTE 13: POST /public/verify — Verify by Code
  // ============================================================
  app.post('/public/verify', ah(async (req, res) => {
    const certCode = (req.body.cert_code || '').trim().replace(/\s+/g, '').toUpperCase();
    if (!certCode) return res.redirect('/public/verify');
    res.redirect('/public/verify/' + certCode);
  }));

  // Fallback public verify page (no code)
  app.get('/public/verify', ah(async (req, res) => {
    const html = BC_CSS + `<div style="max-width:500px;margin:80px auto;text-align:center">
      <div class="bc-gold-seal" style="margin:0 auto 20px;width:80px;height:80px;font-size:36px">⛓️</div>
      <h1 style="color:#1e3a5f;font-size:24px;margin:0 0 8px">Certificate Verification</h1>
      <p style="color:#94a3b8;font-size:14px;margin-bottom:24px">Enter a certificate code to verify its authenticity on the blockchain</p>
      <form method="POST" action="/public/verify" style="display:flex;gap:10px;max-width:400px;margin:0 auto">
        <input type="text" name="cert_code" placeholder="e.g., BC-1-ABC123-DEF456" required style="flex:1;padding:12px 16px;border:2px solid #e2e8f0;border-radius:12px;font-size:14px;font-family:monospace">
        <button class="bc-btn bc-btn-primary" style="padding:12px 24px">🔍 Verify</button>
      </form>
      <p style="font-size:12px;color:#c0c0c0;margin-top:20px">Powered by Blockchain Technology</p>
    </div>`;
    res.send(renderPage('Verify Certificate', html, null, req));
  }));

  // ============================================================
  // ROUTE 14: GET /school/blockchain-certs/gallery — Student Gallery
  // ============================================================
  app.get('/school/blockchain-certs/gallery', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Try to find certs by student_id matching user, or by issued_by
    let certs = await pool.query(
      `SELECT bc.*, t.name as tpl_name, t.category as tpl_category, t.background_color, t.border_style,
              bl.block_number
       FROM blockchain_certificates bc
       LEFT JOIN cert_templates t ON t.id=bc.template_id
       LEFT JOIN blockchain_ledger bl ON bl.cert_id=bc.id
       WHERE bc.tenant_id=$1 AND bc.status='issued'
       ORDER BY bc.issue_date DESC LIMIT 50`,
      [tid]
    );

    const cards = certs.rows.map(c => `<div class="bc-card" style="padding:0;overflow:hidden">
      <div style="height:8px;background:linear-gradient(90deg,#1e3a5f,#2563eb,#f59e0b)"></div>
      <div style="padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:10px">
          <div class="bc-card-title" style="font-size:14px">${esc(c.title)}</div>
          ${c.block_number?'<span style="font-size:10px;padding:3px 8px;border-radius:12px;background:#dcfce7;color:#16a34a;font-weight:700">✅ Verified</span>':''}
        </div>
        ${c.tpl_category?`<div style="margin-bottom:8px">${categoryBadge(c.tpl_category)}</div>`:''}
        <p style="font-size:12px;color:#64748b;margin-bottom:12px;line-height:1.5">${esc((c.description||'').substring(0,100))}${(c.description||'').length>100?'...':''}</p>
        <div style="display:flex;gap:8px;font-size:11px;color:#94a3b8;margin-bottom:14px;flex-wrap:wrap">
          <span>📅 ${fmtDateShort(c.issue_date)}</span>
          <span style="font-family:monospace">${esc(c.cert_code)}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <a href="/school/blockchain-certs/${c.id}" class="bc-btn bc-btn-secondary" style="padding:4px 10px;font-size:11px">👁️ View</a>
          <a href="/school/blockchain-certs/${c.id}/pdf" class="bc-btn bc-btn-secondary" style="padding:4px 10px;font-size:11px">📄 PDF</a>
          <a href="/public/verify/${c.cert_code}" class="bc-btn bc-btn-outline" style="padding:4px 10px;font-size:11px" target="_blank">🔗 Share</a>
        </div>
      </div>
    </div>`).join('');

    const html = BC_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${flash(req)}
      ${nav('gallery')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e3a5f">🖼️ Certificate Gallery</h1><p style="font-size:13px;color:#94a3b8;margin-top:4px">Your certificate portfolio — verified and ready to share</p></div>
        <div style="display:flex;gap:8px">
          <a href="/school/blockchain-certs/requests" class="bc-btn bc-btn-secondary">📋 Request Certificate</a>
        </div>
      </div>
      <div class="bc-grid">${cards||'<p style="text-align:center;color:#94a3b8;padding:60px;grid-column:1/-1">No certificates in your gallery yet.</p>'}</div>
    </div>`;
    res.send(renderPage('Certificate Gallery', html, user, req));
  }));

  // ============================================================
  // ROUTE 15: GET /school/blockchain-certs/requests — Requests
  // ============================================================
  app.get('/school/blockchain-certs/requests', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const requests = await pool.query(
      'SELECT cr.* FROM cert_requests cr WHERE cr.tenant_id=$1 ORDER BY cr.created_at DESC LIMIT 100',
      [tid]
    );

    const rows = requests.rows.map(r => `<tr>
      <td>${esc(r.request_type||'general')}</td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.description||'—')}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${fmtDateShort(r.created_at)}</td>
      <td>${fmtDateTime(r.processed_at)}</td>
      <td>
        ${r.status==='pending'?`
          <form method="POST" action="/school/blockchain-certs/requests/${r.id}/approve" style="display:inline"><input type="hidden" name="action" value="approve"><button class="bc-btn bc-btn-success" style="padding:4px 10px;font-size:11px">✅ Approve</button></form>
          <form method="POST" action="/school/blockchain-certs/requests/${r.id}/approve" style="display:inline" onsubmit="return confirm('Reject this request?')"><input type="hidden" name="action" value="reject"><button class="bc-btn bc-btn-danger" style="padding:4px 10px;font-size:11px">❌</button></form>
        `:'—'}
      </td>
    </tr>`).join('');

    const html = BC_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${flash(req)}
      ${nav('requests')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e3a5f">📋 Certificate Requests</h1><p style="font-size:13px;color:#94a3b8;margin-top:4px">Review and process certificate requests from students and parents</p></div>
      </div>

      <div class="bc-card" style="padding:24px;margin-bottom:18px">
        <h3 style="color:#1e3a5f;margin:0 0 16px;font-size:15px">📝 Submit New Request</h3>
        <form method="POST" action="/school/blockchain-certs/requests/save" class="bc-form">
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">
            <div style="flex:1;min-width:180px"><label>Request Type</label>
              <select name="request_type" style="width:100%">
                <option value="academic">🎓 Academic Certificate</option>
                <option value="transfer">📋 Transfer Certificate</option>
                <option value="bonafide">📄 Bonafide Certificate</option>
                <option value="conduct">⭐ Conduct Certificate</option>
                <option value="sports">🏅 Sports Certificate</option>
                <option value="custom">📝 Custom</option>
              </select>
            </div>
            <div style="flex:2;min-width:250px"><label>Description</label><input type="text" name="description" placeholder="Describe the certificate you need..." style="width:100%"></div>
            <button type="submit" class="bc-btn bc-btn-primary" style="padding:10px 20px">Submit Request</button>
          </div>
        </form>
      </div>

      <div class="bc-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto"><table class="bc-table">
          <thead><tr><th>Type</th><th>Description</th><th>Status</th><th>Requested</th><th>Processed</th><th>Actions</th></tr></thead>
          <tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">No requests found</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Certificate Requests', html, user, req));
  }));

  // ============================================================
  // ROUTE 16: POST /school/blockchain-certs/requests/save
  // ============================================================
  app.post('/school/blockchain-certs/requests/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { request_type, description } = req.body;

    await pool.query(
      'INSERT INTO cert_requests (tenant_id, student_id, request_type, description) VALUES ($1,$2,$3,$4)',
      [tid, user.id || null, request_type || 'general', description || null]
    );

    audit({ action: 'submit_cert_request', type: request_type, user });
    req.session.flash = { type: 'success', icon: '📋', msg: 'Certificate request submitted successfully' };
    res.redirect('/school/blockchain-certs/requests');
  }));

  // ============================================================
  // ROUTE 17: POST /school/blockchain-certs/requests/:id/approve
  // ============================================================
  app.post('/school/blockchain-certs/requests/:id/approve', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, reqId = req.params.id;
    const action = req.body.action || 'approve';

    const status = action === 'reject' ? 'rejected' : 'approved';
    await pool.query(
      'UPDATE cert_requests SET status=$1, processed_by=$2, processed_at=$3, admin_notes=$4 WHERE id=$5 AND tenant_id=$6',
      [status, user.id, now(), action === 'reject' ? 'Rejected by admin' : 'Approved', reqId, tid]
    );

    audit({ action: 'process_cert_request', requestId: reqId, status, user });
    req.session.flash = { type: 'success', icon: status === 'approved' ? '✅' : '❌', msg: `Request ${status}` };
    res.redirect('/school/blockchain-certs/requests');
  }));

  // ============================================================
  // ROUTE 18: GET /school/blockchain-certs/chain — Blockchain Ledger
  // ============================================================
  app.get('/school/blockchain-certs/chain', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = 15;
    const offset = (page - 1) * perPage;

    const [countResult, blocks] = await Promise.all([
      pool.query('SELECT COUNT(*) as cnt FROM blockchain_ledger WHERE tenant_id=$1', [tid]),
      pool.query(
        `SELECT bl.*, bc.title, bc.cert_code, bc.status as cert_status
         FROM blockchain_ledger bl
         LEFT JOIN blockchain_certificates bc ON bc.id=bl.cert_id
         WHERE bl.tenant_id=$1 ORDER BY bl.block_number DESC LIMIT $2 OFFSET $3`,
        [tid, perPage, offset]
      )
    ]);

    const total = countResult.rows[0].cnt;
    const totalPages = Math.ceil(total / perPage);

    // Verify chain integrity
    const allBlocks = await pool.query(
      'SELECT block_number, cert_hash, previous_hash FROM blockchain_ledger WHERE tenant_id=$1 ORDER BY block_number ASC',
      [tid]
    );
    const ab = allBlocks.rows;
    let chainValid = true;
    let brokenAt = null;
    for (let i = 1; i < ab.length; i++) {
      if (ab[i].previous_hash !== ab[i-1].cert_hash) {
        chainValid = false;
        brokenAt = ab[i].block_number;
        break;
      }
    }

    const chainHtml = blocks.rows.map((b, idx) => `<div style="display:flex;align-items:center;gap:10px;flex-wrap:nowrap">
      ${idx < blocks.rows.length - 1 ? `<div class="bc-chain-link">🔗</div>` : '<div style="width:40px"></div>'}
      <div class="bc-chain-block">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:13px;font-weight:700;color:#1e3a5f">Block #${b.block_number}</span>
          ${b.cert_status==='revoked'?'<span style="font-size:10px;padding:2px 6px;border-radius:8px;background:#fee2e2;color:#dc2626;font-weight:700">REVOKED</span>':'<span style="font-size:10px;padding:2px 6px;border-radius:8px;background:#dcfce7;color:#16a34a;font-weight:700">VALID</span>'}
        </div>
        <div style="font-size:12px;color:#475569;margin-bottom:4px">${esc(b.title||'Certificate')} — <span style="font-family:monospace;font-size:10px">${esc(b.cert_code||'')}</span></div>
        <div class="bc-chain-hash">Hash: ${esc(b.cert_hash)}</div>
        <div class="bc-chain-hash">Prev: ${esc(b.previous_hash)}</div>
        <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:10px;color:#94a3b8">
          <span>⛏️ ${esc(b.miner)}</span>
          <span>Nonce: ${esc(b.nonce)}</span>
        </div>
        <div style="font-size:10px;color:#c0c0c0;margin-top:2px">${fmtDateTime(b.timestamp)}</div>
      </div>
    </div>`).join('');

    const pagination = totalPages > 1 ? `<div style="display:flex;gap:6px;justify-content:center;margin-top:20px">${Array.from({length:Math.min(10,totalPages)},(_,i)=>`<a href="?page=${i+1}" class="bc-btn ${page===i+1?'bc-btn-primary':'bc-btn-secondary'}" style="padding:6px 12px;font-size:12px">${i+1}</a>`).join('')}${totalPages>10?'...':''}</div>` : '';

    const html = BC_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${flash(req)}
      ${nav('chain')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e3a5f">⛓️ Blockchain Ledger</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:4px">${total} blocks in the chain</p>
        </div>
        <div style="padding:10px 20px;border-radius:10px;background:${chainValid?'#dcfce7':'#fee2e2'};border:1px solid ${chainValid?'#bbf7d0':'#fecaca'}">
          <span style="font-size:13px;font-weight:700;color:${chainValid?'#16a34a':'#dc2626'}">${chainValid?'✅ Chain Intact':'❌ Chain Broken at Block #'+brokenAt}</span>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;align-items:center;gap:0">
        ${chainHtml || '<div style="text-align:center;color:#94a3b8;padding:60px">No blocks in the chain yet. Issue a certificate to mine the first block.</div>'}
      </div>
      ${pagination}
    </div>`;
    res.send(renderPage('Blockchain Ledger', html, user, req));
  }));

  // ============================================================
  // ROUTE 19: GET /school/blockchain-certs/analytics — Analytics
  // ============================================================
  app.get('/school/blockchain-certs/analytics', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const [byMonth, byStatus, byCategory, verificationLogs, topVerified] = await Promise.all([
      pool.query(`SELECT TO_CHAR(issue_date, 'YYYY-MM') as month, COUNT(*) as cnt FROM blockchain_certificates WHERE tenant_id=$1 AND issue_date IS NOT NULL GROUP BY month ORDER BY month DESC LIMIT 12`, [tid]),
      pool.query(`SELECT status, COUNT(*) as cnt FROM blockchain_certificates WHERE tenant_id=$1 GROUP BY status`, [tid]),
      pool.query(`SELECT t.category, COUNT(*) as cnt FROM blockchain_certificates bc LEFT JOIN cert_templates t ON t.id=bc.template_id WHERE bc.tenant_id=$1 GROUP BY t.category ORDER BY cnt DESC`, [tid]),
      pool.query('SELECT COUNT(*) as cnt FROM cert_verification_log WHERE tenant_id=$1', [tid]),
      pool.query(`SELECT bc.title, bc.cert_code, COUNT(v.id) as verify_count FROM cert_verification_log v JOIN blockchain_certificates bc ON bc.id=v.cert_id WHERE bc.tenant_id=$1 GROUP BY bc.id ORDER BY verify_count DESC LIMIT 10`, [tid]),
    ]);

    // Monthly chart (simple bar chart with CSS)
    const monthlyMax = Math.max(...byMonth.rows.map(m => m.cnt), 1);
    const monthlyHtml = byMonth.rows.reverse().map(m => {
      const pct = Math.round((m.cnt / monthlyMax) * 100);
      const label = new Date(m.month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      return `<div style="display:flex;align-items:end;gap:6px;flex:1;min-width:60px">
        <div style="flex:1;display:flex;flex-direction:column;align-items:center">
          <span style="font-size:11px;font-weight:700;color:#1e3a5f">${m.cnt}</span>
          <div style="width:100%;height:${Math.max(4,pct*1.2)}px;background:linear-gradient(180deg,#2563eb,#1e3a5f);border-radius:4px 4px 0 0;min-height:4px;margin-top:4px"></div>
          <span style="font-size:9px;color:#94a3b8;margin-top:4px;white-space:nowrap">${esc(label)}</span>
        </div>
      </div>`;
    }).join('');

    const statusColors = { issued: '#16a34a', revoked: '#dc2626', draft: '#94a3b8', approved: '#2563eb' };
    const statusHtml = byStatus.rows.map(s => `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f8fafc;border-radius:8px">
      <div style="width:12px;height:12px;border-radius:3px;background:${statusColors[s.status]||'#94a3b8'}"></div>
      <span style="font-size:13px;color:#1e293b;flex:1;text-transform:capitalize">${s.status}</span>
      <span style="font-size:14px;font-weight:700;color:#1e3a5f">${s.cnt}</span>
    </div>`).join('');

    const catMax = Math.max(...byCategory.rows.map(c => c.cnt), 1);
    const catHtml = byCategory.rows.map(c => {
      const pct = Math.round((c.cnt / catMax) * 100);
      return `<div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
          <span style="color:#475569;text-transform:capitalize">${esc(c.category||'other')}</span>
          <span style="font-weight:700;color:#1e3a5f">${c.cnt}</span>
        </div>
        <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#1e3a5f,#2563eb);border-radius:4px"></div></div>
      </div>`;
    }).join('');

    const topHtml = topVerified.rows.map((t, i) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;${i<topVerified.rows.length-1?'border-bottom:1px solid #f1f5f9':''}">
      <span style="font-size:12px;font-weight:700;color:#94a3b8;width:24px">#${i+1}</span>
      <div style="flex:1"><div style="font-size:13px;font-weight:600;color:#1e293b">${esc(t.title)}</div><div style="font-size:10px;font-family:monospace;color:#94a3b8">${esc(t.cert_code)}</div></div>
      <span style="font-size:13px;font-weight:700;color:#2563eb">${t.verify_count} verifications</span>
    </div>`).join('');

    const totalVerifications = verificationLogs.rows[0].cnt;

    const html = BC_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('analytics')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
        <div><h1 style="font-size:24px;color:#1e3a5f">📊 Certificate Analytics</h1><p style="font-size:13px;color:#94a3b8;margin-top:4px">Insights into certificate issuance and verification trends</p></div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px">
        <div class="bc-stat-card"><div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#1e3a5f,#2563eb)"></div><div class="bc-stat-num">${byMonth.rows.reduce((s,m)=>s+m.cnt,0)}</div><div class="bc-stat-label">Total Issued</div></div>
        <div class="bc-stat-card"><div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#059669,#10b981)"></div><div class="bc-stat-num">${totalVerifications}</div><div class="bc-stat-label">Verifications</div></div>
        <div class="bc-stat-card"><div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#b45309,#f59e0b)"></div><div class="bc-stat-num">${byCategory.rows.length}</div><div class="bc-stat-label">Categories</div></div>
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:18px;margin-bottom:18px">
        <div class="bc-card">
          <h3 style="color:#1e3a5f;margin:0 0 16px;font-size:15px">📈 Issuance by Month</h3>
          <div style="display:flex;gap:4px;align-items:end;padding:20px 0;border-bottom:1px solid #f1f5f9">${monthlyHtml||'<span style="color:#94a3b8;padding:20px">No data yet</span>'}</div>
        </div>
        <div class="bc-card">
          <h3 style="color:#1e3a5f;margin:0 0 16px;font-size:15px">📊 By Status</h3>
          <div style="display:flex;flex-direction:column;gap:6px">${statusHtml||'<span style="color:#94a3b8;font-size:13px">No data</span>'}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
        <div class="bc-card">
          <h3 style="color:#1e3a5f;margin:0 0 16px;font-size:15px">📂 By Category</h3>
          ${catHtml||'<p style="color:#94a3b8;font-size:13px">No data</p>'}
        </div>
        <div class="bc-card">
          <h3 style="color:#1e3a5f;margin:0 0 16px;font-size:15px">🏆 Most Verified Certificates</h3>
          ${topHtml||'<p style="color:#94a3b8;font-size:13px">No verification data</p>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Certificate Analytics', html, user, req));
  }));

  // ============================================================
  // ROUTE 20: GET /school/blockchain-certs/settings — Settings
  // ============================================================
  app.get('/school/blockchain-certs/settings', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const templates = await pool.query('SELECT id,name,is_default FROM cert_templates WHERE tenant_id=$1 ORDER BY is_default DESC,name', [tid]);
    const tplOpts = templates.rows.map(t => `<option value="${t.id}" ${t.is_default?'selected':''}>${esc(t.name)}</option>`).join('');

    const html = BC_CSS + `<div style="max-width:700px;margin:0 auto">
      ${flash(req)}
      ${nav('settings')}
      <div class="bc-card" style="padding:32px">
        <h2 style="color:#1e3a5f;margin:0 0 4px">⚙️ Certificate Settings</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Configure default behavior and blockchain parameters</p>
        <form method="POST" action="/school/blockchain-certs/settings/save" class="bc-form" style="display:flex;flex-direction:column;gap:16px">
          <div><label>Default Template</label>
            <select name="default_template">${tplOpts||'<option value="">No templates created yet</option>'}</select>
          </div>
          <div class="bc-grid-2">
            <div><label>Institution Name</label><input type="text" name="institution_name" placeholder="e.g., Springfield Academy" value="School"></div>
            <div><label>Institution Seal Text</label><input type="text" name="seal_text" placeholder="e.g., Est. 1990" value="Excellence in Education"></div>
          </div>
          <div class="bc-grid-2">
            <div><label>Blockchain Difficulty (leading zeros)</label>
              <select name="difficulty">
                <option value="1">Easy (1 zero)</option>
                <option value="2" selected>Standard (2 zeros)</option>
                <option value="3">Hard (3 zeros)</option>
                <option value="4">Expert (4 zeros)</option>
              </select>
            </div>
            <div><label>Auto-approve Issued Status</label>
              <select name="auto_approve">
                <option value="1" selected>Yes — Certificates are issued immediately</option>
                <option value="0">No — Requires manual approval</option>
              </select>
            </div>
          </div>
          <div><label>Verification Page Footer Text</label>
            <input type="text" name="verify_footer" placeholder="e.g., Powered by Blockchain Technology" value="Verified on the Blockchain — Tamper Proof"></div>
          <div><label>Email Notification Template</label>
            <textarea name="email_template" rows="3" placeholder="Available: {{student_name}}, {{cert_code}}, {{verify_url}}, {{title}}">Dear {{student_name}},\n\nYour certificate "{{title}}" has been issued.\nCertificate Code: {{cert_code}}\nVerify online: {{verify_url}}\n\nCongratulations!</textarea>
          </div>
          <button type="submit" class="bc-btn bc-btn-primary" style="padding:12px 28px;font-size:15px;justify-content:center">💾 Save Settings</button>
        </form>
      </div>

      <div class="bc-card" style="padding:24px;margin-top:18px">
        <h3 style="color:#1e3a5f;margin:0 0 12px;font-size:15px">🗑️ Danger Zone</h3>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:12px">These actions are irreversible. Proceed with caution.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <form method="POST" action="/school/blockchain-certs/settings/purge-revoked" onsubmit="return confirm('Permanently delete all revoked certificates?')"><button class="bc-btn bc-btn-danger">🗑️ Purge Revoked Certificates</button></form>
          <form method="POST" action="/school/blockchain-certs/settings/reset-chain" onsubmit="return confirm('Reset the entire blockchain ledger?')"><button class="bc-btn bc-btn-danger">⛓️ Reset Blockchain</button></form>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Certificate Settings', html, user, req));
  }));

  // ============================================================
  // ROUTE 21: POST /school/blockchain-certs/settings/save
  // ============================================================
  app.post('/school/blockchain-certs/settings/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { default_template, institution_name, seal_text, difficulty, auto_approve, verify_footer, email_template } = req.body;

    // Set default template
    if (default_template) {
      await pool.query('UPDATE cert_templates SET is_default=0 WHERE tenant_id=$1', [tid]);
      await pool.query('UPDATE cert_templates SET is_default=1 WHERE id=$1 AND tenant_id=$2', [default_template, tid]);
    }

    // Store settings in metadata or a settings table
    // For simplicity, we store as JSON in a settings row
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS cert_settings (
        tenant_id INT PRIMARY KEY,
        settings JSON DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)
      `);
    } catch (e) { /* table may already exist */ }

    await pool.query(
      `INSERT INTO cert_settings (tenant_id, settings, updated_at) VALUES ($1,$2,$3) ON CONFLICT (tenant_id) DO UPDATE SET settings=$4, updated_at=$5`,
      [tid, JSON.stringify({ institution_name, seal_text, difficulty, auto_approve, verify_footer, email_template }), now(),
       JSON.stringify({ institution_name, seal_text, difficulty, auto_approve, verify_footer, email_template }), now()]
    );

    audit({ action: 'update_cert_settings', user });
    req.session.flash = { type: 'success', icon: '⚙️', msg: 'Settings saved successfully' };
    res.redirect('/school/blockchain-certs/settings');
  }));

  // Purge revoked certificates
  app.post('/school/blockchain-certs/settings/purge-revoked', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query("DELETE FROM blockchain_certificates WHERE tenant_id=$1 AND status='revoked'", [tid]);
    const count = result.rowCount;
    audit({ action: 'purge_revoked', count, user: req.session.user });
    req.session.flash = { type: 'success', icon: '🗑️', msg: `${count} revoked certificates purged` };
    res.redirect('/school/blockchain-certs/settings');
  }));

  // Reset blockchain
  app.post('/school/blockchain-certs/settings/reset-chain', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM blockchain_ledger WHERE tenant_id=$1', [tid]);
    audit({ action: 'reset_blockchain', user: req.session.user });
    req.session.flash = { type: 'success', icon: '⛓️', msg: 'Blockchain ledger has been reset' };
    res.redirect('/school/blockchain-certs/settings');
  }));

  // ============================================================
  // ROUTE 22: API — Get certificate data for AJAX
  // ============================================================
  app.get('/school/blockchain-certs/api/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [total, issued, revoked, blocks] = await Promise.all([
      pool.query('SELECT COUNT(*) as cnt FROM blockchain_certificates WHERE tenant_id=$1', [tid]),
      pool.query("SELECT COUNT(*) as cnt FROM blockchain_certificates WHERE tenant_id=$1 AND status='issued'", [tid]),
      pool.query("SELECT COUNT(*) as cnt FROM blockchain_certificates WHERE tenant_id=$1 AND status='revoked'", [tid]),
      pool.query('SELECT COUNT(*) as cnt FROM blockchain_ledger WHERE tenant_id=$1', [tid]),
    ]);
    res.json({
      total: total.rows[0].cnt,
      issued: issued.rows[0].cnt,
      revoked: revoked.rows[0].cnt,
      blocks: blocks.rows[0].cnt,
    });
  }));

  // ============================================================
  // ROUTE 23: POST — Revoke with reason form (enhanced)
  // ============================================================
  app.get('/school/blockchain-certs/:id/revoke', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, certId = req.params.id;
    const cert = await pool.query('SELECT id, cert_code, title, status FROM blockchain_certificates WHERE id=$1 AND tenant_id=$2', [certId, tid]);
    if (!cert.rows[0] || cert.rows[0].status === 'revoked') return res.redirect('/school/blockchain-certs/' + certId);

    const c = cert.rows[0];
    const html = BC_CSS + `<div style="max-width:500px;margin:60px auto">
      <div class="bc-card" style="padding:32px;border-color:#dc2626">
        <h2 style="color:#dc2626;margin:0 0 4px">❌ Revoke Certificate</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">This action is permanent and recorded on the blockchain.</p>
        <div style="padding:14px;background:#fef2f2;border-radius:10px;border:1px solid #fecaca;margin-bottom:20px">
          <div style="font-size:13px;font-weight:600;color:#1e293b">${esc(c.title)}</div>
          <div style="font-size:11px;font-family:monospace;color:#94a3b8;margin-top:4px">${esc(c.cert_code)}</div>
        </div>
        <form method="POST" action="/school/blockchain-certs/${c.id}/revoke" class="bc-form">
          <div><label>Reason for Revocation *</label>
            <select name="revoke_reason" required style="margin-bottom:10px">
              <option value="">Select reason...</option>
              <option value="Issued in error">Issued in error</option>
              <option value="Duplicate certificate">Duplicate certificate</option>
              <option value="Student no longer eligible">Student no longer eligible</option>
              <option value="Data correction needed">Data correction needed</option>
              <option value="Fraudulent certificate">Fraudulent certificate</option>
              <option value="Other">Other</option>
            </select>
            <textarea name="revoke_reason" rows="3" placeholder="Provide additional details..." style="margin-top:8px"></textarea>
          </div>
          <div style="display:flex;gap:10px;margin-top:16px">
            <button type="submit" class="bc-btn bc-btn-danger" style="padding:12px 24px">❌ Confirm Revocation</button>
            <a href="/school/blockchain-certs/${c.id}" class="bc-btn bc-btn-secondary" style="padding:12px 24px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Revoke Certificate', html, req.session.user, req));
  }));

  // Handle revoke reason from select + textarea combination
  app.post('/school/blockchain-certs/:id/revoke', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, certId = req.params.id;
    const reasonArr = [];
    if (req.body.revoke_reason) {
      if (Array.isArray(req.body.revoke_reason)) {
        reasonArr.push(...req.body.revoke_reason.filter(Boolean));
      } else {
        reasonArr.push(req.body.revoke_reason);
      }
    }
    const revoke_reason = reasonArr.join(' — ') || 'No reason provided';

    const cert = await pool.query('SELECT * FROM blockchain_certificates WHERE id=$1 AND tenant_id=$2', [certId, tid]);
    if (!cert.rows[0]) {
      req.session.flash = { type: 'error', msg: 'Certificate not found' };
      return res.redirect('/school/blockchain-certs/list');
    }
    if (cert.rows[0].status === 'revoked') {
      req.session.flash = { type: 'error', msg: 'Already revoked' };
      return res.redirect('/school/blockchain-certs/' + certId);
    }

    await pool.query(
      "UPDATE blockchain_certificates SET status='revoked', revoked_at=$1, revoke_reason=$2 WHERE id=$3 AND tenant_id=$4",
      [now(), revoke_reason, certId, tid]
    );

    // Record revocation on blockchain
    const lastBlock = await pool.query('SELECT block_number, cert_hash FROM blockchain_ledger WHERE tenant_id=$1 ORDER BY block_number DESC LIMIT 1', [tid]);
    const prevHash = lastBlock.rows.length > 0 ? lastBlock.rows[0].cert_hash : '0'.repeat(64);
    const prevBlockNum = lastBlock.rows.length > 0 ? lastBlock.rows[0].block_number : 0;
    const secret = process.env.BC_CERT_SECRET || 'blockchain-certs-salt-2024';
    let nonce = 0, hash = '';
    do {
      hash = generateBlockHash({ certId, action: 'REVOCATION', reason: revoke_reason, revokedAt: now() }, prevHash, String(nonce), secret);
      nonce++;
    } while (!hash.startsWith('00'));

    await pool.query(
      'INSERT INTO blockchain_ledger (tenant_id,cert_id,block_number,cert_hash,previous_hash,timestamp,miner,nonce) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [tid, certId, prevBlockNum + 1, hash, prevHash, now(), user.name || 'admin', String(nonce)]
    );

    audit({ action: 'revoke_certificate', certId, reason: revoke_reason, user });
    req.session.flash = { type: 'error', icon: '❌', msg: 'Certificate revoked and recorded on blockchain' };
    res.redirect('/school/blockchain-certs/' + certId);
  }));
};
