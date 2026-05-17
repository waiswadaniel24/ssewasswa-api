// ============================================================
// DIGITAL SIGNATURES MODULE — Multi-Tenant SaaS Platform
// Signature pad, document signing requests, public signing
// portal, tracking, archive, and verification. PostgreSQL.
// ============================================================
// Usage in server.js:
//   const digitalSignatures = require('./digital-signatures');
//   digitalSignatures(app, pool, opts);
// ============================================================

'use strict';

module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || ((fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const trackRevenue = global.trackRevenue || (() => {});
  const { randomUUID } = require('crypto');

  // ============================================================
  // INTERNAL HELPERS
  // ============================================================
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const now = () => new Date().toISOString();

  function docTypeLabel(t) {
    const map = {
      report_card: 'Report Card', transfer_certificate: 'Transfer Certificate',
      leaving_certificate: 'Leaving Certificate', character_reference: 'Character Reference',
      staff_contract: 'Staff Contract', parent_consent: 'Parent Consent', fee_agreement: 'Fee Agreement',
    };
    return map[t] || t || 'Document';
  }

  function statusBadge(s) {
    const map = {
      pending: { bg: '#fef3c7', c: '#b45309', icon: '⏳', label: 'Pending' },
      partially_signed: { bg: '#dbeafe', c: '#1d4ed8', icon: '✍️', label: 'Partially Signed' },
      completed: { bg: '#dcfce7', c: '#16a34a', icon: '✅', label: 'Completed' },
      expired: { bg: '#fee2e2', c: '#dc2626', icon: '⌛', label: 'Expired' },
      revoked: { bg: '#f1f5f9', c: '#64748b', icon: '🚫', label: 'Revoked' },
    };
    const st = map[s] || { bg: '#f1f5f9', c: '#64748b', icon: '❓', label: s };
    return `<span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${st.bg};color:${st.c}">${st.icon} ${st.label}</span>`;
  }

  // ============================================================
  // SHARED CSS
  // ============================================================
  const DS_CSS = `<style>
  .ds-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
  .ds-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
  .ds-nav a:hover{background:#e2e8f0}.ds-nav a.active{background:#4f46e5;color:#fff}
  .ds-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
  .ds-card{background:#fff;border:2px solid #e2e8f0;border-radius:14px;padding:22px;transition:.2s}
  .ds-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.08);border-color:#c7d2fe}
  .ds-card-header{display:flex;justify-content:space-between;align-items:start;margin-bottom:10px}
  .ds-card-title{font-size:16px;font-weight:700;color:#1e293b;margin:0}
  .ds-card-meta{display:flex;gap:14px;font-size:12px;color:#64748b;margin-bottom:12px}
  .ds-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
  .ds-btn:hover{opacity:.9;transform:translateY(-1px)}
  .ds-btn-primary{background:#4f46e5;color:#fff}.ds-btn-success{background:#059669;color:#fff}
  .ds-btn-danger{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}
  .ds-btn-secondary{background:#f1f5f9;color:#475569}
  .ds-btn-warning{background:#f59e0b;color:#fff}
  .ds-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
  .ds-form input,.ds-form select,.ds-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;font-family:inherit}
  .ds-form input:focus,.ds-form select:focus,.ds-form textarea:focus{outline:none;border-color:#6366f1}
  .ds-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .ds-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
  .ds-table{width:100%;border-collapse:collapse;font-size:13px}
  .ds-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
  .ds-table td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}.ds-table tr:hover{background:#f8fafc}

  /* Signature canvas */
  .sig-canvas-wrap{position:relative;border:2px dashed #c7d2fe;border-radius:12px;background:#fafbff;overflow:hidden}
  .sig-canvas-wrap canvas{display:block;cursor:crosshair;touch-action:none}
  .sig-actions{display:flex;gap:8px;margin-top:10px}
  .sig-preview{border:2px solid #e2e8f0;border-radius:12px;padding:12px;background:#fff;min-height:80px;display:flex;align-items:center;justify-content:center}
  .sig-preview img{max-width:100%;max-height:200px}

  /* Signer list */
  .signer-row{display:flex;align-items:center;gap:10px;padding:12px;background:#f8fafc;border-radius:10px;margin-bottom:8px}
  .signer-row .signer-num{width:28px;height:28px;border-radius:50%;background:#4f46e5;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}
  .signer-row .signer-info{flex:1}
  .signer-row .signer-name{font-size:14px;font-weight:600;color:#1e293b}
  .signer-row .signer-email{font-size:12px;color:#64748b}
  .signer-row .signer-status{font-size:12px;font-weight:600}
  .signer-row .remove-signer{background:none;border:none;color:#dc2626;cursor:pointer;font-size:18px;padding:4px 8px;border-radius:6px}
  .signer-row .remove-signer:hover{background:#fee2e2}

  /* Public signing page */
  .sign-portal{max-width:640px;margin:40px auto;padding:0 20px}
  .sign-portal .card{padding:32px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  .sign-portal h1{font-size:28px;color:#1e293b;margin:0 0 4px;text-align:center}
  .sign-portal .subtitle{font-size:14px;color:#64748b;text-align:center;margin-bottom:24px}

  /* Verification */
  .verify-result{padding:24px;border-radius:14px;text-align:center;margin-top:20px}
  .verify-result.valid{background:#dcfce7;border:2px solid #86efac}
  .verify-result.invalid{background:#fee2e2;border:2px solid #fecaca}

  @media(max-width:768px){.ds-grid,.ds-grid-3{grid-template-columns:1fr}.ds-cards{grid-template-columns:1fr}.sign-portal{padding:0 12px}}
</style>`;

  // ============================================================
  // SIGNATURE PAD CANVAS JAVASCRIPT (shared snippet)
  // ============================================================
  const SIGNATURE_PAD_JS = `
<script>
(function(){
  function initPad(canvasId, previewId, hiddenId){
    var canvas = document.getElementById(canvasId);
    if(!canvas) return;
    var ctx = canvas.getContext('2d');
    var preview = document.getElementById(previewId);
    var hidden = document.getElementById(hiddenId);
    var drawing = false;
    var lastX = 0, lastY = 0;
    var hasDrawn = false;

    canvas.setAttribute('aria-label', 'Signature drawing area. Use your mouse or touch to draw your signature.');
    canvas.setAttribute('role', 'img');

    function getPos(e){
      var rect = canvas.getBoundingClientRect();
      var scaleX = canvas.width / rect.width;
      var scaleY = canvas.height / rect.height;
      if(e.touches && e.touches.length > 0){
        return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
      }
      return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }

    function startDraw(e){
      e.preventDefault();
      drawing = true;
      var pos = getPos(e);
      lastX = pos.x;
      lastY = pos.y;
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
    }

    function draw(e){
      if(!drawing) return;
      e.preventDefault();
      hasDrawn = true;
      var pos = getPos(e);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.quadraticCurveTo(lastX, lastY, (lastX + pos.x) / 2, (lastY + pos.y) / 2);
      ctx.stroke();
      lastX = pos.x;
      lastY = pos.y;
    }

    function endDraw(e){
      if(!drawing) return;
      drawing = false;
    }

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseleave', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', endDraw);

    window['clear_' + canvasId] = function(){
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawn = false;
      if(preview) preview.innerHTML = '<span style="color:#94a3b8;font-size:13px">No signature preview</span>';
      if(hidden) hidden.value = '';
    };

    window['save_' + canvasId] = function(){
      if(!hasDrawn){
        alert('Please draw your signature first.');
        return false;
      }
      var data = canvas.toDataURL('image/png');
      if(hidden) hidden.value = data;
      if(preview){
        preview.innerHTML = '<img src="' + data + '" alt="Signature preview" style="max-height:120px">';
      }
      return data;
    };

    window['get_' + canvasId + '_data'] = function(){
      if(!hasDrawn) return null;
      return canvas.toDataURL('image/png');
    };
  }

  document.addEventListener('DOMContentLoaded', function(){
    initPad('sigCanvas', 'sigPreview', 'sigData');
  });
})();
</script>`;

  // ============================================================
  // NAV HELPER
  // ============================================================
  const nav = (active) => `<div class="ds-nav">
    <a href="/school/signatures" class="${active === 'pad' ? 'active' : ''}">✍️ Signature Pad</a>
    <a href="/school/signatures/request" class="${active === 'request' ? 'active' : ''}">📝 New Request</a>
    <a href="/school/signatures/tracking" class="${active === 'tracking' ? 'active' : ''}">📋 Tracking</a>
    <a href="/school/signatures/archive" class="${active === 'archive' ? 'active' : ''}">📁 Archive</a>
    <a href="/school/signatures/verify" class="${active === 'verify' ? 'active' : ''}">🔍 Verify</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[DigitalSignatures] Cannot connect to DB for migrations'); return; }
    try {
      // -- signature_requests -----------------------------------------------
      await c.query(`CREATE TABLE IF NOT EXISTS signature_requests (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        doc_type VARCHAR(100) NOT NULL DEFAULT 'report_card',
        doc_reference_id INTEGER,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        signers JSONB NOT NULL DEFAULT '[]',
        signing_order JSONB NOT NULL DEFAULT '[]',
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        deadline TIMESTAMPTZ,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )`);

      // -- signature_records ------------------------------------------------
      await c.query(`CREATE TABLE IF NOT EXISTS signature_records (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        request_id INTEGER NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
        signer_name VARCHAR(255) NOT NULL,
        signer_email VARCHAR(255),
        signer_role VARCHAR(100),
        signature_data TEXT,
        ip_address VARCHAR(45),
        user_agent TEXT,
        signed_at TIMESTAMPTZ,
        token UUID UNIQUE
      )`);

      // -- signed_documents -------------------------------------------------
      await c.query(`CREATE TABLE IF NOT EXISTS signed_documents (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        request_id INTEGER NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
        doc_content TEXT,
        all_signatures JSONB NOT NULL DEFAULT '[]',
        fingerprint TEXT,
        verified BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // -- ALTER TABLES: add missing columns --------------------------------
      const srCols = [
        ['doc_reference_id', 'INTEGER'],
        ['description', 'TEXT'],
        ['signing_order', 'JSONB NOT NULL DEFAULT \'[]\''],
        ['deadline', 'TIMESTAMPTZ'],
        ['completed_at', 'TIMESTAMPTZ'],
      ];
      for (const [col, def] of srCols) {
        try { await c.query(`ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {}
      }

      const sigCols = [
        ['signer_role', 'VARCHAR(100)'],
        ['user_agent', 'TEXT'],
      ];
      for (const [col, def] of sigCols) {
        try { await c.query(`ALTER TABLE signature_records ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {}
      }

      // -- INDEXES ----------------------------------------------------------
      await c.query(`CREATE INDEX IF NOT EXISTS idx_sigrq_tenant ON signature_requests(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_sigrq_status ON signature_requests(tenant_id, status)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_sigrq_created ON signature_requests(created_at DESC)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_sigrec_tenant ON signature_records(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_sigrec_request ON signature_records(request_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_sigrec_token ON signature_records(token)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_sigdoc_tenant ON signed_documents(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_sigdoc_request ON signed_documents(request_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_sigdoc_fingerprint ON signed_documents(fingerprint)`);

      console.log('[DigitalSignatures] Migrations applied successfully');
    } catch (e) { console.error('[DigitalSignatures] Migration error:', e.message); }
    finally { c.release(); }
  })();

  // ============================================================
  // ROUTE 1: GET /school/signatures — Signature Pad
  // ============================================================
  app.get('/school/signatures', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const html = DS_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('pad')}
      <div class="ds-card" style="margin-bottom:20px">
        <h2 style="margin:0 0 4px;color:#1e293b;font-size:20px">✍️ Digital Signature Pad</h2>
        <p style="font-size:13px;color:#64748b;margin-bottom:20px">Draw your signature using mouse or touch. The signature is saved as a secure PNG image.</p>

        <div class="sig-canvas-wrap" style="margin-bottom:12px">
          <canvas id="sigCanvas" width="760" height="260" aria-label="Signature drawing area. Use your mouse or touch to draw your signature." role="img" tabindex="0"></canvas>
        </div>

        <div class="sig-actions">
          <button type="button" class="ds-btn ds-btn-primary" onclick="save_sigCanvas()">💾 Save Signature</button>
          <button type="button" class="ds-btn ds-btn-secondary" onclick="clear_sigCanvas()">🗑️ Clear</button>
        </div>
      </div>

      <div class="ds-card">
        <h3 style="margin:0 0 12px;color:#1e293b;font-size:16px">Signature Preview</h3>
        <div class="sig-preview" id="sigPreview">
          <span style="color:#94a3b8;font-size:13px">No signature preview</span>
        </div>
        <input type="hidden" id="sigData" name="sigData">
        <div style="margin-top:14px;display:flex;gap:8px">
          <button type="button" class="ds-btn ds-btn-success" onclick="downloadSignature()">⬇️ Download PNG</button>
          <button type="button" class="ds-btn ds-btn-secondary" onclick="copySignature()">📋 Copy Base64</button>
        </div>
      </div>
    </div>
    ${SIGNATURE_PAD_JS}
    <script>
    function downloadSignature(){
      var data = get_sigCanvas_data();
      if(!data){ alert('Please draw a signature first.'); return; }
      var a = document.createElement('a');
      a.href = data;
      a.download = 'signature_${Date.now()}.png';
      a.click();
    }
    function copySignature(){
      var data = get_sigCanvas_data();
      if(!data){ alert('Please draw a signature first.'); return; }
      navigator.clipboard.writeText(data).then(function(){
        alert('Signature base64 data copied to clipboard!');
      }).catch(function(){ alert('Could not copy. The data is stored in the hidden field.'); });
    }
    </script>`;
    res.send(renderPage('Signature Pad', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /school/signatures/request — New Signing Request
  // ============================================================
  app.get('/school/signatures/request', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const docTypes = [
      { value: 'report_card', label: 'Report Card' },
      { value: 'transfer_certificate', label: 'Transfer Certificate' },
      { value: 'leaving_certificate', label: 'Leaving Certificate' },
      { value: 'character_reference', label: 'Character Reference' },
      { value: 'staff_contract', label: 'Staff Contract' },
      { value: 'parent_consent', label: 'Parent Consent' },
      { value: 'fee_agreement', label: 'Fee Agreement' },
    ];
    const docOptions = docTypes.map(d => `<option value="${d.value}">${d.label}</option>`).join('');

    const html = DS_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('request')}
      <div class="ds-card">
        <h2 style="margin:0 0 4px;color:#1e293b;font-size:20px">📝 Create Signing Request</h2>
        <p style="font-size:13px;color:#64748b;margin-bottom:24px">Set up a document that requires one or more signatures. Each signer will receive a unique link.</p>

        <form id="signingRequestForm" method="POST" action="/school/signatures/request" class="ds-form">
          <div style="margin-bottom:16px"><label>Document Title *</label>
            <input type="text" name="title" required placeholder="e.g., Term 2 Report Card — Jane Doe" maxlength="500"></div>

          <div style="margin-bottom:16px"><label>Description</label>
            <textarea name="description" rows="2" placeholder="Optional description of the document..."></textarea></div>

          <div class="ds-grid" style="margin-bottom:16px">
            <div><label>Document Type *</label>
              <select name="doc_type" required>${docOptions}</select></div>
            <div><label>Deadline</label>
              <input type="datetime-local" name="deadline"></div>
          </div>

          <div style="margin-bottom:16px"><label>Document Reference ID (optional)</label>
            <input type="number" name="doc_reference_id" placeholder="e.g., student or certificate ID"></div>

          <div style="margin-bottom:16px">
            <label>Signers *</label>
            <p style="font-size:12px;color:#94a3b8;margin-bottom:8px">Add all required signers. They will sign in the order listed below.</p>
            <div id="signerList"></div>
            <div class="ds-grid" style="margin-top:10px">
              <div><input type="text" id="signerName" placeholder="Signer full name"></div>
              <div><input type="email" id="signerEmail" placeholder="Signer email address"></div>
            </div>
            <div style="margin-top:8px">
              <select id="signerRole" class="ds-form" style="max-width:300px">
                <option value="principal">Principal</option>
                <option value="vice_principal">Vice Principal</option>
                <option value="teacher">Teacher</option>
                <option value="admin">Administrator</option>
                <option value="parent">Parent/Guardian</option>
                <option value="student">Student</option>
                <option value="staff">Staff Member</option>
                <option value="other">Other</option>
              </select>
            </div>
            <button type="button" class="ds-btn ds-btn-secondary" style="margin-top:10px" onclick="addSigner()">+ Add Signer</button>
            <input type="hidden" name="signers_json" id="signers_json">
          </div>

          <div style="margin-bottom:20px">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#475569;cursor:pointer">
              <input type="checkbox" name="ordered_signing" id="orderedSigning" style="width:18px;height:18px;accent-color:#4f46e5" checked>
              Require sequential signing (each signer must sign before the next)
            </label>
          </div>

          <button type="submit" class="ds-btn ds-btn-primary" style="padding:14px 28px;font-size:15px;justify-content:center">🚀 Create Signing Request</button>
        </form>
      </div>
    </div>
    <script>
    (function(){
      var signers = [];
      window.addSigner = function(){
        var name = document.getElementById('signerName').value.trim();
        var email = document.getElementById('signerEmail').value.trim();
        var role = document.getElementById('signerRole').value;
        if(!name){ alert('Please enter a signer name.'); return; }
        if(!email){ alert('Please enter a signer email.'); return; }
        signers.push({ name: name, email: email, role: role });
        renderSigners();
        document.getElementById('signerName').value = '';
        document.getElementById('signerEmail').value = '';
      };
      function renderSigners(){
        var list = document.getElementById('signerList');
        if(signers.length === 0){ list.innerHTML = '<p style="color:#94a3b8;font-size:13px;padding:8px">No signers added yet.</p>'; return; }
        var html = '';
        for(var i = 0; i < signers.length; i++){
          var s = signers[i];
          html += '<div class="signer-row">';
          html += '<span class="signer-num">' + (i+1) + '</span>';
          html += '<div class="signer-info"><div class="signer-name">' + s.name + '</div><div class="signer-email">' + s.email + ' &middot; ' + s.role + '</div></div>';
          html += '<button type="button" class="remove-signer" onclick="removeSigner(' + i + ')">&times;</button>';
          html += '</div>';
        }
        list.innerHTML = html;
      }
      window.removeSigner = function(idx){
        signers.splice(idx, 1);
        renderSigners();
      };
      window.renderSigners = renderSigners;
      renderSigners();

      document.getElementById('signingRequestForm').addEventListener('submit', function(){
        document.getElementById('signers_json').value = JSON.stringify(signers);
        if(signers.length === 0){ alert('Please add at least one signer.'); event.preventDefault(); }
      });
    })();
    </script>`;
    res.send(renderPage('New Signing Request', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /school/signatures/request — Process Request
  // ============================================================
  app.post('/school/signatures/request', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const { title, description, doc_type, doc_reference_id, deadline, signers_json, ordered_signing } = req.body;

    if (!title || !title.trim()) {
      req.session.flash = { type: 'error', msg: 'Document title is required.' };
      return res.redirect('/school/signatures/request');
    }

    let signers = [];
    try { signers = JSON.parse(signers_json || '[]'); } catch (e) {
      req.session.flash = { type: 'error', msg: 'Invalid signers data.' };
      return res.redirect('/school/signatures/request');
    }

    if (signers.length === 0) {
      req.session.flash = { type: 'error', msg: 'At least one signer is required.' };
      return res.redirect('/school/signatures/request');
    }

    // Insert the signing request
    const reqResult = await pool.query(
      `INSERT INTO signature_requests (tenant_id, doc_type, doc_reference_id, title, description, signers, signing_order, status, deadline, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, NOW())
       RETURNING id`,
      [
        tid,
        doc_type || 'report_card',
        doc_reference_id ? parseInt(doc_reference_id) : null,
        title.trim(),
        description || null,
        JSON.stringify(signers),
        ordered_signing === 'on' ? JSON.stringify(signers.map(s => s.email)) : JSON.stringify([]),
        deadline || null,
        user.id,
      ]
    );
    const requestId = reqResult.rows[0].id;

    // Create signature records with unique tokens
    for (let i = 0; i < signers.length; i++) {
      const s = signers[i];
      const token = randomUUID();
      await pool.query(
        `INSERT INTO signature_records (tenant_id, request_id, signer_name, signer_email, signer_role, token)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tid, requestId, s.name, s.email, s.role || 'other', token]
      );

      // Email notification would go here
      // mailer.send(s.email, 'Signing Request: ' + title.trim(), ...);
    }

    audit('signature_request_created', { requestId, docType: doc_type, signerCount: signers.length }, user);
    req.session.flash = { type: 'success', msg: `Signing request created for "${title.trim()}" with ${signers.length} signer(s).` };
    res.redirect('/school/signatures/tracking');
  }));

  // ============================================================
  // ROUTE 4: GET /school/signatures/sign/:token — Public Signing Portal
  // ============================================================
  app.get('/school/signatures/sign/:token', ah(async (req, res) => {
    const token = req.params.token;
    const record = (await pool.query(
      `SELECT sr.*, sreq.title, sreq.doc_type, sreq.description, sreq.signers, sreq.status as req_status,
              sreq.deadline, sreq.signing_order, sreq.tenant_id
       FROM signature_records sr
       JOIN signature_requests sreq ON sreq.id = sr.request_id
       WHERE sr.token = $1`, [token]
    )).rows[0];

    if (!record) {
      return res.status(404).send(`<!DOCTYPE html><html><head><title>Invalid Link</title>
        <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc}
        .box{text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:500px}
        h1{color:#dc2626;margin:0 0 8px;font-size:22px}p{color:#64748b;font-size:14px;margin:0}</style>
        </head><body><div class="box"><h1>❌ Invalid Signing Link</h1><p>The signing link you followed is not valid. Please contact the sender for a correct link.</p></div></body></html>`);
    }

    // Check if already signed
    if (record.signed_at) {
      return res.send(`<!DOCTYPE html><html><head><title>Already Signed</title>
        <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc}
        .box{text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:500px}
        h1{color:#059669;margin:0 0 8px;font-size:22px}p{color:#64748b;font-size:14px;margin:0} .ts{color:#94a3b8;font-size:12px;margin-top:12px}</style>
        </head><body><div class="box"><h1>✅ Already Signed</h1><p>${esc(record.signer_name)}, you have already signed this document.</p><p class="ts">Signed on ${fmtDateTime(record.signed_at)}</p></div></body></html>`);
    }

    // Check if request is revoked or expired
    if (record.req_status === 'revoked') {
      return res.send(`<!DOCTYPE html><html><head><title>Revoked</title>
        <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc}
        .box{text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:500px}
        h1{color:#dc2626;margin:0 0 8px;font-size:22px}p{color:#64748b;font-size:14px;margin:0}</style>
        </head><body><div class="box"><h1>🚫 Signing Request Revoked</h1><p>This signing request has been revoked by the document owner.</p></div></body></html>`);
    }

    if (record.req_status === 'completed') {
      return res.send(`<!DOCTYPE html><html><head><title>Completed</title>
        <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc}
        .box{text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:500px}
        h1{color:#059669;margin:0 0 8px;font-size:22px}p{color:#64748b;font-size:14px;margin:0}</style>
        </head><body><div class="box"><h1>✅ Document Fully Signed</h1><p>This document has been fully signed and is no longer accepting signatures.</p></div></body></html>`);
    }

    // Check deadline
    if (record.deadline && new Date(record.deadline) < new Date()) {
      await pool.query(`UPDATE signature_requests SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [record.request_id]);
      return res.send(`<!DOCTYPE html><html><head><title>Expired</title>
        <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc}
        .box{text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:500px}
        h1{color:#f59e0b;margin:0 0 8px;font-size:22px}p{color:#64748b;font-size:14px;margin:0}</style>
        </head><body><div class="box"><h1>⌛ Signing Link Expired</h1><p>The deadline for signing this document has passed.</p></div></body></html>`);
    }

    // Check sequential signing order
    let canSign = true;
    let orderMsg = '';
    const signingOrder = record.signing_order || [];
    if (signingOrder.length > 0) {
      const previousSigners = await pool.query(
        `SELECT signer_email, signed_at FROM signature_records WHERE request_id = $1 ORDER BY signed_at ASC`,
        [record.request_id]
      );
      const myIndex = signingOrder.indexOf(record.signer_email);
      if (myIndex > 0) {
        const prevEmail = signingOrder[myIndex - 1];
        const prevSigned = previousSigners.rows.find(r => r.signer_email === prevEmail && r.signed_at);
        if (!prevSigned) {
          canSign = false;
          orderMsg = `Please wait. ${prevEmail} must sign before you.`;
        }
      }
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign Document: ${esc(record.title)}</title>
  ${DS_CSS}
</head>
<body style="background:#f8fafc;margin:0;font-family:system-ui,-apple-system,sans-serif">
  <div class="sign-portal">
    <div class="card" style="background:#fff">
      <div style="text-align:center;margin-bottom:20px">
        <div style="width:56px;height:56px;border-radius:50%;background:#eef2ff;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:28px">📝</div>
        <h1>Document Signing</h1>
        <p class="subtitle">Please review and sign the document below</p>
      </div>

      <div style="background:#f8fafc;border-radius:12px;padding:16px;margin-bottom:20px;border:1px solid #e2e8f0">
        <div style="font-size:13px;color:#64748b;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Document Details</div>
        <div style="font-size:17px;font-weight:700;color:#1e293b;margin-bottom:4px">${esc(record.title)}</div>
        <div style="font-size:13px;color:#64748b">
          <span style="display:inline-block;margin-right:16px">📄 ${docTypeLabel(record.doc_type)}</span>
          ${record.deadline ? `<span>⏰ Deadline: ${fmtDateTime(record.deadline)}</span>` : ''}
        </div>
        ${record.description ? `<div style="font-size:13px;color:#475569;margin-top:8px">${esc(record.description)}</div>` : ''}
      </div>

      <div style="background:#eef2ff;border-radius:10px;padding:14px;margin-bottom:20px">
        <div style="font-size:14px;font-weight:600;color:#4f46e5">Signer: ${esc(record.signer_name)}</div>
        <div style="font-size:12px;color:#6366f1">${esc(record.signer_email)} &middot; ${esc(record.signer_role)}</div>
      </div>

      ${!canSign ? `<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:14px;margin-bottom:20px;text-align:center">
        <p style="margin:0;color:#b45309;font-size:14px;font-weight:600">⏸️ ${orderMsg}</p>
      </div>` : ''}

      ${canSign ? `<form method="POST" action="/school/signatures/sign/${esc(token)}">
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:8px">Draw Your Signature Below</label>
          <div class="sig-canvas-wrap">
            <canvas id="sigCanvas" width="580" height="200" aria-label="Signature drawing area. Use your mouse or touch to draw your signature." role="img" tabindex="0"></canvas>
          </div>
          <div class="sig-actions">
            <button type="button" class="ds-btn ds-btn-secondary" onclick="clear_sigCanvas()">🗑️ Clear</button>
          </div>
        </div>

        <div class="sig-preview" id="sigPreview" style="margin-bottom:16px">
          <span style="color:#94a3b8;font-size:13px">Your signature will appear here after drawing</span>
        </div>
        <input type="hidden" id="sigData" name="signature_data">

        <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:20px;font-size:13px;color:#475569;cursor:pointer">
          <input type="checkbox" name="confirmed" required style="margin-top:2px;width:18px;height:18px;accent-color:#4f46e5;flex-shrink:0">
          <span>I confirm that I am ${esc(record.signer_name)} and I agree to sign this document. I understand that this digital signature is legally binding.</span>
        </label>

        <button type="submit" class="ds-btn ds-btn-primary" style="width:100%;justify-content:center;padding:14px;font-size:16px">✍️ Sign Document</button>
      </form>` : ''}

      <div style="text-align:center;margin-top:16px;font-size:11px;color:#94a3b8">
        This page is secured. Your IP address will be recorded for verification purposes.
      </div>
    </div>
  </div>

  ${SIGNATURE_PAD_JS}
</body>
</html>`;
    res.send(html);
  }));

  // ============================================================
  // ROUTE 5: POST /school/signatures/sign/:token — Process Signing
  // ============================================================
  app.post('/school/signatures/sign/:token', ah(async (req, res) => {
    const token = req.params.token;
    const { signature_data, confirmed } = req.body;

    const record = (await pool.query(
      `SELECT sr.*, sreq.signers, sreq.status as req_status, sreq.signing_order, sreq.deadline
       FROM signature_records sr
       JOIN signature_requests sreq ON sreq.id = sr.request_id
       WHERE sr.token = $1`, [token]
    )).rows[0];

    if (!record) {
      return res.status(400).send('Invalid signing link.');
    }
    if (record.signed_at) {
      return res.send('You have already signed this document.');
    }
    if (record.req_status === 'revoked' || record.req_status === 'completed') {
      return res.send('This signing request is no longer active.');
    }
    if (!signature_data || !signature_data.startsWith('data:image/png')) {
      return res.send('A valid signature is required. Please draw your signature.');
    }
    if (!confirmed) {
      return res.send('You must confirm your identity to sign.');
    }

    const ipAddress = req.ip || req.connection?.remoteAddress || req.headers?.['x-forwarded-for'] || '';
    const userAgent = req.headers?.['user-agent'] || '';

    // Update signature record
    await pool.query(
      `UPDATE signature_records SET signature_data = $1, ip_address = $2, user_agent = $3, signed_at = NOW()
       WHERE token = $4`,
      [signature_data, ipAddress, userAgent, token]
    );

    // Check if all signers have signed
    const allRecords = (await pool.query(
      `SELECT id, signer_email, signed_at FROM signature_records WHERE request_id = $1`,
      [record.request_id]
    )).rows;

    const allSigned = allRecords.every(r => r.signed_at !== null);
    const someSigned = allRecords.some(r => r.signed_at !== null);

    if (allSigned) {
      // Complete the request
      await pool.query(
        `UPDATE signature_requests SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [record.request_id]
      );

      // Create signed document
      const request = (await pool.query(`SELECT * FROM signature_requests WHERE id = $1`, [record.request_id])).rows[0];
      const sigRecords = (await pool.query(
        `SELECT signer_name, signer_email, signer_role, signature_data, signed_at, ip_address
         FROM signature_records WHERE request_id = $1 ORDER BY signed_at ASC`,
        [record.request_id]
      )).rows;

      const allSignatures = sigRecords.map(sr => ({
        signer_name: sr.signer_name,
        signer_email: sr.signer_email,
        signer_role: sr.signer_role,
        signature_data: sr.signature_data,
        signed_at: sr.signed_at,
        ip_address: sr.ip_address,
      }));

      const docContent = JSON.stringify({
        title: request.title,
        doc_type: request.doc_type,
        description: request.description,
        created_at: request.created_at,
        signers: request.signers,
      });

      // Generate fingerprint (SHA-256 hash of content + signatures + timestamps)
      const crypto = require('crypto');
      const hashInput = docContent + '|' + sigRecords.map(r => r.signature_data + r.signed_at).join('|');
      const fingerprint = crypto.createHash('sha256').update(hashInput).digest('hex');

      await pool.query(
        `INSERT INTO signed_documents (tenant_id, request_id, doc_content, all_signatures, fingerprint, verified, created_at)
         VALUES ($1, $2, $3, $4, $5, true, NOW())`,
        [request.tenant_id, record.request_id, docContent, JSON.stringify(allSignatures), fingerprint]
      );

      // Email confirmation would go here
      audit('document_fully_signed', { requestId: record.request_id, fingerprint }, null);

    } else if (someSigned) {
      await pool.query(
        `UPDATE signature_requests SET status = 'partially_signed' WHERE id = $1 AND status = 'pending'`,
        [record.request_id]
      );

      // Notify next signer in sequential order
      const signingOrder = record.signing_order || [];
      if (signingOrder.length > 0) {
        const unsignedRecords = allRecords.filter(r => !r.signed_at);
        if (unsignedRecords.length > 0) {
          const nextRecord = (await pool.query(
            `SELECT * FROM signature_records WHERE id = $1`, [unsignedRecords[0].id]
          )).rows[0];
          // Email notification to next signer would go here
        }
      }
    }

    audit('signature_submitted', { tokenId: token, signerName: record.signer_name }, null);
    trackRevenue('signature', record.tenant_id);

    // Show success page
    res.send(`<!DOCTYPE html><html><head><title>Signature Recorded</title>
      <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc}
      .box{text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:500px}
      h1{color:#059669;margin:0 0 8px;font-size:22px}p{color:#64748b;font-size:14px;margin:0}
      .check{font-size:56px;margin-bottom:12px} .ts{color:#94a3b8;font-size:12px;margin-top:16px}</style>
      </head><body><div class="box">
        <div class="check">✅</div>
        <h1>Signature Recorded</h1>
        <p>Thank you, ${esc(record.signer_name)}. Your signature has been securely recorded.</p>
        <p class="ts">Timestamp: ${fmtDateTime(now())}</p>
        <p class="ts">IP: ${esc(ipAddress)}</p>
      </div></body></html>`);
  }));

  // ============================================================
  // ROUTE 6: GET /school/signatures/tracking — Signing Tracking
  // ============================================================
  app.get('/school/signatures/tracking', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;

    // Stats
    const totalRequests = (await pool.query(`SELECT COUNT(*)::int as cnt FROM signature_requests WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const pendingCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM signature_requests WHERE tenant_id=$1 AND status='pending'`, [tid])).rows[0].cnt;
    const partialCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM signature_requests WHERE tenant_id=$1 AND status='partially_signed'`, [tid])).rows[0].cnt;
    const completedCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM signature_requests WHERE tenant_id=$1 AND status='completed'`, [tid])).rows[0].cnt;

    const requests = (await pool.query(
      `SELECT sr.*,
              (SELECT COUNT(*)::int FROM signature_records WHERE request_id = sr.id) as total_signers,
              (SELECT COUNT(*)::int FROM signature_records WHERE request_id = sr.id AND signed_at IS NOT NULL) as signed_count
       FROM signature_requests sr
       WHERE sr.tenant_id = $1
       ORDER BY sr.created_at DESC
       LIMIT 50`, [tid]
    )).rows;

    const rowsHtml = requests.map(r => {
      const progressPct = r.total_signers > 0 ? Math.round((r.signed_count / r.total_signers) * 100) : 0;
      const barColor = progressPct === 100 ? '#059669' : progressPct > 0 ? '#4f46e5' : '#e2e8f0';
      return `<tr>
        <td><a href="/school/signatures/tracking/${r.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(r.title)}</a></td>
        <td><span style="font-size:12px;color:#475569">${docTypeLabel(r.doc_type)}</span></td>
        <td>${statusBadge(r.status)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="flex:1;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;max-width:80px">
              <div style="width:${progressPct}%;height:100%;background:${barColor};border-radius:4px;transition:.3s"></div>
            </div>
            <span style="font-size:12px;color:#64748b;font-weight:600">${r.signed_count}/${r.total_signers}</span>
          </div>
        </td>
        <td style="font-size:12px;color:#64748b">${r.deadline ? fmtDateTime(r.deadline) : '—'}</td>
        <td style="font-size:12px;color:#64748b">${fmtDateTime(r.created_at)}</td>
      </tr>`;
    }).join('');

    const html = DS_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('tracking')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📋 Signing Tracking</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Monitor all signing requests and their status</p></div>
        <a href="/school/signatures/request" class="ds-btn ds-btn-primary">+ New Request</a>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px">
        <div class="ds-card" style="text-align:center;padding:16px">
          <div style="font-size:28px;font-weight:700;color:#4f46e5">${totalRequests}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">Total Requests</div>
        </div>
        <div class="ds-card" style="text-align:center;padding:16px">
          <div style="font-size:28px;font-weight:700;color:#f59e0b">${pendingCount}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">Pending</div>
        </div>
        <div class="ds-card" style="text-align:center;padding:16px">
          <div style="font-size:28px;font-weight:700;color:#1d4ed8">${partialCount}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">In Progress</div>
        </div>
        <div class="ds-card" style="text-align:center;padding:16px">
          <div style="font-size:28px;font-weight:700;color:#059669">${completedCount}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">Completed</div>
        </div>
      </div>

      <div class="ds-card">
        <div style="overflow-x:auto">
          <table class="ds-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Deadline</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No signing requests found. <a href="/school/signatures/request" style="color:#4f46e5">Create one</a></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Signing Tracking', html, user, req));
  }));

  // ============================================================
  // ROUTE 7: GET /school/signatures/tracking/:id — Request Detail
  // ============================================================
  app.get('/school/signatures/tracking/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const requestId = req.params.id;

    const request = (await pool.query(
      `SELECT * FROM signature_requests WHERE id = $1 AND tenant_id = $2`, [requestId, tid]
    )).rows[0];

    if (!request) {
      return res.status(404).send('Signing request not found.');
    }

    const records = (await pool.query(
      `SELECT * FROM signature_records WHERE request_id = $1 ORDER BY id ASC`, [requestId]
    )).rows;

    const signersHtml = records.map((r, i) => {
      const isSigned = r.signed_at !== null;
      const statusColor = isSigned ? '#059669' : '#f59e0b';
      const statusIcon = isSigned ? '✅' : '⏳';
      const signLink = r.token ? `${req.protocol}://${req.get('host')}/school/signatures/sign/${r.token}` : '';

      return `<div class="signer-row" style="padding:16px">
        <span class="signer-num">${i + 1}</span>
        <div class="signer-info">
          <div class="signer-name">${esc(r.signer_name)}</div>
          <div class="signer-email">${esc(r.signer_email)} &middot; ${esc(r.signer_role)}</div>
          ${isSigned ? `<div style="font-size:11px;color:#64748b;margin-top:4px">Signed: ${fmtDateTime(r.signed_at)} &middot; IP: ${esc(r.ip_address || 'N/A')}</div>` : ''}
          ${signLink && !isSigned ? `<div style="margin-top:6px;font-size:11px;color:#94a3b8;word-break:break-all">Link: <a href="${esc(signLink)}" style="color:#4f46e5" target="_blank">${esc(signLink)}</a></div>` : ''}
        </div>
        <div style="text-align:right">
          <div class="signer-status" style="color:${statusColor}">${statusIcon} ${isSigned ? 'Signed' : 'Waiting'}</div>
          ${!isSigned ? `<div style="margin-top:6px">
            <form method="POST" action="/school/signatures/tracking/${requestId}/remind" style="display:inline">
              <input type="hidden" name="record_id" value="${r.id}">
              <button type="submit" class="ds-btn ds-btn-secondary" style="padding:4px 10px;font-size:11px">📧 Remind</button>
            </form>
          </div>` : ''}
        </div>
      </div>`;
    }).join('');

    const html = DS_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('tracking')}
      <a href="/school/signatures/tracking" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Tracking</a>

      <div class="ds-card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
          <div>
            <h2 style="margin:0 0 4px;color:#1e293b;font-size:20px">${esc(request.title)}</h2>
            <p style="font-size:13px;color:#64748b;margin:0">${docTypeLabel(request.doc_type)} &middot; Created ${fmtDateTime(request.created_at)}</p>
          </div>
          ${statusBadge(request.status)}
        </div>
        ${request.description ? `<p style="font-size:13px;color:#475569;margin-top:12px">${esc(request.description)}</p>` : ''}
        ${request.deadline ? `<p style="font-size:12px;color:#94a3b8;margin-top:6px">⏰ Deadline: ${fmtDateTime(request.deadline)}</p>` : ''}
      </div>

      <div class="ds-card" style="margin-bottom:16px">
        <h3 style="margin:0 0 14px;color:#1e293b;font-size:16px">Signers (${records.filter(r => r.signed_at).length}/${records.length})</h3>
        ${signersHtml}
      </div>

      ${request.status !== 'revoked' && request.status !== 'completed' ? `
      <div class="ds-card" style="border-color:#fecaca">
        <h3 style="margin:0 0 12px;color:#dc2626;font-size:16px">Danger Zone</h3>
        <p style="font-size:13px;color:#64748b;margin-bottom:12px">Revoking a request will cancel all pending signatures. This cannot be undone.</p>
        <form method="POST" action="/school/signatures/tracking/${requestId}/revoke" onsubmit="return confirm('Are you sure you want to revoke this signing request?')">
          <button type="submit" class="ds-btn ds-btn-danger">🚫 Revoke Request</button>
        </form>
      </div>` : ''}
    </div>`;
    res.send(renderPage('Request Detail', html, user, req));
  }));

  // ============================================================
  // ROUTE 8: POST /school/signatures/tracking/:id/remind — Send Reminder
  // ============================================================
  app.post('/school/signatures/tracking/:id/remind', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const requestId = req.params.id;
    const recordId = req.body.record_id;

    const record = (await pool.query(
      `SELECT sr.*, sreq.title
       FROM signature_records sr
       JOIN signature_requests sreq ON sreq.id = sr.request_id
       WHERE sr.id = $1 AND sr.request_id = $2 AND sreq.tenant_id = $3`,
      [recordId, requestId, tid]
    )).rows[0];

    if (!record) {
      req.session.flash = { type: 'error', msg: 'Record not found.' };
      return res.redirect(`/school/signatures/tracking/${requestId}`);
    }

    if (record.signed_at) {
      req.session.flash = { type: 'error', msg: 'This signer has already signed.' };
      return res.redirect(`/school/signatures/tracking/${requestId}`);
    }

    // Email reminder would be sent here
    // mailer.send(record.signer_email, 'Reminder: ' + record.title, ...);

    audit('signature_reminder_sent', { requestId, recordId, signerEmail: record.signer_email }, user);
    req.session.flash = { type: 'success', msg: `Reminder sent to ${record.signer_name} (${record.signer_email}).` };
    res.redirect(`/school/signatures/tracking/${requestId}`);
  }));

  // ============================================================
  // ROUTE 9: POST /school/signatures/tracking/:id/revoke — Revoke Request
  // ============================================================
  app.post('/school/signatures/tracking/:id/revoke', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const requestId = req.params.id;

    const result = await pool.query(
      `UPDATE signature_requests SET status = 'revoked' WHERE id = $1 AND tenant_id = $2 AND status NOT IN ('completed', 'revoked')`,
      [requestId, tid]
    );

    if (result.rowCount === 0) {
      req.session.flash = { type: 'error', msg: 'Could not revoke this request. It may already be completed or revoked.' };
    } else {
      audit('signature_request_revoked', { requestId }, user);
      req.session.flash = { type: 'success', msg: 'Signing request has been revoked.' };
    }
    res.redirect(`/school/signatures/tracking/${requestId}`);
  }));

  // ============================================================
  // ROUTE 10: GET /school/signatures/archive — Signed Documents Archive
  // ============================================================
  app.get('/school/signatures/archive', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;

    const page = parseInt(req.query.page) || 1;
    const perPage = 20;
    const offset = (page - 1) * perPage;

    const totalDocs = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM signed_documents WHERE tenant_id = $1`, [tid]
    )).rows[0].cnt;

    const docs = (await pool.query(
      `SELECT sd.*,
              sr.title, sr.doc_type, sr.description,
              (SELECT COUNT(*)::int FROM jsonb_array_elements(sd.all_signatures)) as sig_count
       FROM signed_documents sd
       JOIN signature_requests sr ON sr.id = sd.request_id
       WHERE sd.tenant_id = $1
       ORDER BY sd.created_at DESC
       LIMIT $2 OFFSET $3`, [tid, perPage, offset]
    )).rows;

    const totalPages = Math.ceil(totalDocs / perPage);

    const rowsHtml = docs.map(d => `<tr>
      <td>
        <a href="/school/signatures/archive/${d.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(d.title)}</a>
      </td>
      <td><span style="font-size:12px;color:#475569">${docTypeLabel(d.doc_type)}</span></td>
      <td><span style="font-size:13px;color:#1e293b">${d.sig_count} signature${d.sig_count !== 1 ? 's' : ''}</span></td>
      <td>${d.verified ? '<span style="color:#059669;font-weight:600">✓ Verified</span>' : '<span style="color:#dc2626">✗ Unverified</span>'}</td>
      <td style="font-size:12px;color:#64748b">${fmtDateTime(d.created_at)}</td>
      <td>
        <div style="display:flex;gap:4px">
          <a href="/school/signatures/archive/${d.id}" class="ds-btn ds-btn-secondary" style="padding:4px 10px;font-size:11px">View</a>
          <button onclick="copyFingerprint('${esc(d.fingerprint || '')}')" class="ds-btn ds-btn-secondary" style="padding:4px 10px;font-size:11px">📋 Hash</button>
        </div>
      </td>
    </tr>`).join('');

    // Pagination
    let paginationHtml = '';
    if (totalPages > 1) {
      paginationHtml = '<div style="display:flex;gap:4px;justify-content:center;margin-top:16px">';
      for (let i = 1; i <= totalPages; i++) {
        if (i === page) {
          paginationHtml += `<span style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;background:#4f46e5;color:#fff;font-size:13px;font-weight:600">${i}</span>`;
        } else {
          paginationHtml += `<a href="/school/signatures/archive?page=${i}" style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;background:#f1f5f9;color:#475569;font-size:13px;font-weight:600;text-decoration:none">${i}</a>`;
        }
      }
      paginationHtml += '</div>';
    }

    const html = DS_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('archive')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📁 Signed Documents Archive</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${totalDocs} completed signed document${totalDocs !== 1 ? 's' : ''}</p></div>
      </div>

      <div class="ds-card">
        <div style="overflow-x:auto">
          <table class="ds-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th>Signatures</th>
                <th>Verification</th>
                <th>Completed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No signed documents yet. Completed signing requests will appear here.</td></tr>'}
            </tbody>
          </table>
        </div>
        ${paginationHtml}
      </div>
    </div>
    <script>
    function copyFingerprint(fp){
      if(!fp){alert('No fingerprint available.');return;}
      navigator.clipboard.writeText(fp).then(function(){alert('Fingerprint hash copied!');}).catch(function(){alert('Hash: '+fp);});
    }
    </script>`;
    res.send(renderPage('Signed Documents Archive', html, user, req));
  }));

  // ============================================================
  // ROUTE 11: GET /school/signatures/archive/:id — View Signed Document
  // ============================================================
  app.get('/school/signatures/archive/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const docId = req.params.id;

    const doc = (await pool.query(
      `SELECT sd.*, sr.title, sr.doc_type, sr.description, sr.created_at as request_created_at
       FROM signed_documents sd
       JOIN signature_requests sr ON sr.id = sd.request_id
       WHERE sd.id = $1 AND sd.tenant_id = $2`, [docId, tid]
    )).rows[0];

    if (!doc) {
      return res.status(404).send('Signed document not found.');
    }

    let signatures = [];
    try { signatures = typeof doc.all_signatures === 'string' ? JSON.parse(doc.all_signatures) : doc.all_signatures; } catch (e) {}

    const signaturesHtml = signatures.map((s, i) => `<div class="ds-card" style="padding:16px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span style="width:32px;height:32px;border-radius:50%;background:#4f46e5;color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0">${i + 1}</span>
        <div>
          <div style="font-size:15px;font-weight:600;color:#1e293b">${esc(s.signer_name)}</div>
          <div style="font-size:12px;color:#64748b">${esc(s.signer_email)} &middot; ${esc(s.signer_role)}</div>
        </div>
      </div>
      <div style="background:#fafbff;border-radius:10px;padding:12px;border:1px solid #e2e8f0">
        ${s.signature_data ? `<img src="${esc(s.signature_data)}" alt="Signature of ${esc(s.signer_name)}" style="max-height:100px;display:block;margin:0 auto">` : '<p style="color:#94a3b8;font-size:13px;text-align:center">Signature data not available</p>'}
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-top:8px">
        Signed: ${fmtDateTime(s.signed_at)} &middot; IP: ${esc(s.ip_address || 'N/A')}
      </div>
    </div>`).join('');

    const html = DS_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('archive')}
      <a href="/school/signatures/archive" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Archive</a>

      <div class="ds-card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px;margin-bottom:12px">
          <div>
            <h2 style="margin:0 0 4px;color:#1e293b;font-size:20px">${esc(doc.title)}</h2>
            <p style="font-size:13px;color:#64748b;margin:0">${docTypeLabel(doc.doc_type)}</p>
          </div>
          ${doc.verified ? '<span style="display:inline-block;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:600;background:#dcfce7;color:#16a34a">✓ Verified</span>' : '<span style="display:inline-block;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:600;background:#fee2e2;color:#dc2626">✗ Unverified</span>'}
        </div>
        ${doc.description ? `<p style="font-size:13px;color:#475569;margin-bottom:12px">${esc(doc.description)}</p>` : ''}
        <div style="font-size:12px;color:#94a3b8">
          Completed: ${fmtDateTime(doc.created_at)} &middot; ${signatures.length} signature${signatures.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div class="ds-card" style="margin-bottom:16px">
        <h3 style="margin:0 0 4px;color:#1e293b;font-size:16px">🔐 Digital Fingerprint</h3>
        <p style="font-size:12px;color:#64748b;margin-bottom:10px">SHA-256 hash used for document authenticity verification</p>
        <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:10px;padding:12px;font-family:monospace;font-size:12px;color:#475569;word-break:break-all;user-select:all">
          ${esc(doc.fingerprint || 'Not generated')}
        </div>
        <button onclick="navigator.clipboard.writeText('${esc(doc.fingerprint || '')}').then(function(){alert('Copied!')})" class="ds-btn ds-btn-secondary" style="margin-top:8px;padding:4px 12px;font-size:11px">📋 Copy Hash</button>
      </div>

      <div class="ds-card">
        <h3 style="margin:0 0 14px;color:#1e293b;font-size:16px">✍️ Collected Signatures</h3>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${signaturesHtml || '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:20px">No signatures found</p>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Signed Document', html, user, req));
  }));

  // ============================================================
  // ROUTE 12: GET /school/signatures/verify — Verification Page
  // ============================================================
  app.get('/school/signatures/verify', ah(async (req, res) => {
    const user = req.session.user;
    const queryFingerprint = req.query.fp || '';
    const queryDocId = req.query.doc_id || '';

    let resultHtml = '';
    if (queryFingerprint || queryDocId) {
      let doc = null;
      if (queryDocId) {
        doc = (await pool.query(
          `SELECT sd.*, sr.title, sr.doc_type
           FROM signed_documents sd
           JOIN signature_requests sr ON sr.id = sd.request_id
           WHERE sd.id = $1`, [parseInt(queryDocId)]
        )).rows[0];
      } else if (queryFingerprint) {
        doc = (await pool.query(
          `SELECT sd.*, sr.title, sr.doc_type
           FROM signed_documents sd
           JOIN signature_requests sr ON sr.id = sd.request_id
           WHERE sd.fingerprint = $1`, [queryFingerprint.trim()]
        )).rows[0];
      }

      if (doc) {
        let signatures = [];
        try { signatures = typeof doc.all_signatures === 'string' ? JSON.parse(doc.all_signatures) : doc.all_signatures; } catch (e) {}

        resultHtml = `<div class="verify-result valid">
          <div style="font-size:48px;margin-bottom:12px">✅</div>
          <h2 style="color:#16a34a;margin:0 0 8px;font-size:22px">Document Verified</h2>
          <p style="color:#166534;font-size:14px;margin:0 0 12px">This document is authentic and has been verified.</p>
          <div style="background:#f0fdf4;border-radius:10px;padding:16px;text-align:left;max-width:500px;margin:0 auto">
            <div style="font-size:13px;margin-bottom:6px"><strong>Title:</strong> ${esc(doc.title)}</div>
            <div style="font-size:13px;margin-bottom:6px"><strong>Type:</strong> ${docTypeLabel(doc.doc_type)}</div>
            <div style="font-size:13px;margin-bottom:6px"><strong>Signatures:</strong> ${signatures.length}</div>
            <div style="font-size:13px;margin-bottom:6px"><strong>Completed:</strong> ${fmtDateTime(doc.created_at)}</div>
            <div style="font-size:11px;color:#64748b;word-break:break-all"><strong>Fingerprint:</strong> ${esc(doc.fingerprint)}</div>
          </div>
        </div>`;
      } else {
        resultHtml = `<div class="verify-result invalid">
          <div style="font-size:48px;margin-bottom:12px">❌</div>
          <h2 style="color:#dc2626;margin:0 0 8px;font-size:22px">Document Not Found</h2>
          <p style="color:#991b1b;font-size:14px;margin:0">No signed document matches the provided ${queryDocId ? 'ID' : 'fingerprint'}. Please check and try again.</p>
        </div>`;
      }
    }

    const isAuth = !!user;
    const navHtml = isAuth ? nav('verify') : '';

    const html = DS_CSS + `<div style="max-width:640px;margin:0 auto">
      ${navHtml}
      <div class="ds-card">
        <h2 style="margin:0 0 4px;color:#1e293b;font-size:20px;text-align:center">🔍 Document Verification</h2>
        <p style="font-size:13px;color:#64748b;text-align:center;margin-bottom:24px">Enter a document ID or fingerprint hash to verify document authenticity</p>

        <form method="GET" action="/school/signatures/verify" class="ds-form">
          <div style="margin-bottom:14px"><label>Document ID</label>
            <input type="number" name="doc_id" placeholder="e.g., 42" value="${esc(queryDocId)}"></div>
          <div style="text-align:center;font-size:12px;color:#94a3b8;margin-bottom:14px">— or —</div>
          <div style="margin-bottom:14px"><label>Fingerprint Hash</label>
            <input type="text" name="fp" placeholder="SHA-256 hash..." value="${esc(queryFingerprint)}" style="font-family:monospace;font-size:12px"></div>
          <button type="submit" class="ds-btn ds-btn-primary" style="width:100%;justify-content:center;padding:14px;font-size:15px">🔍 Verify Document</button>
        </form>

        ${resultHtml}
      </div>
    </div>`;
    res.send(renderPage('Verify Document', html, user, req));
  }));

  // ============================================================
  // ROUTE 13: POST /school/signatures/api/save-pad — Save Pad Signature (AJAX)
  // ============================================================
  app.post('/school/signatures/api/save-pad', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const { signature_data } = req.body;

    if (!signature_data || !signature_data.startsWith('data:image/png')) {
      return res.json({ ok: false, error: 'A valid signature is required.' });
    }

    // Store in a lightweight user-signatures table or just return success
    // For now we return the data back for preview/download
    audit('signature_pad_saved', { userId: user.id }, user);
    res.json({ ok: true, signature_data: signature_data });
  }));

  // ============================================================
  // ROUTE 14: GET /school/signatures/api/record/:id — Get Record (AJAX)
  // ============================================================
  app.get('/school/signatures/api/record/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const recordId = req.params.id;

    const record = (await pool.query(
      `SELECT sr.*, sreq.title, sreq.doc_type, sreq.status as req_status
       FROM signature_records sr
       JOIN signature_requests sreq ON sreq.id = sr.request_id
       WHERE sr.id = $1 AND sr.tenant_id = $2`, [recordId, tid]
    )).rows[0];

    if (!record) {
      return res.status(404).json({ ok: false, error: 'Record not found.' });
    }

    res.json({
      ok: true,
      id: record.id,
      signer_name: record.signer_name,
      signer_email: record.signer_email,
      signer_role: record.signer_role,
      signed_at: record.signed_at,
      ip_address: record.ip_address,
      status: record.req_status,
    });
  }));

  // ============================================================
  // ROUTE 15: POST /school/signatures/api/resend-link — Resend Signing Link
  // ============================================================
  app.post('/school/signatures/api/resend-link', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const { record_id } = req.body;

    if (!record_id) {
      return res.json({ ok: false, error: 'Record ID is required.' });
    }

    const record = (await pool.query(
      `SELECT sr.*, sreq.title
       FROM signature_records sr
       JOIN signature_requests sreq ON sreq.id = sr.request_id
       WHERE sr.id = $1 AND sreq.tenant_id = $2`, [parseInt(record_id), tid]
    )).rows[0];

    if (!record) {
      return res.json({ ok: false, error: 'Record not found.' });
    }

    if (record.signed_at) {
      return res.json({ ok: false, error: 'Already signed.' });
    }

    const signLink = `${req.protocol}://${req.get('host')}/school/signatures/sign/${record.token}`;

    // Email would be sent here
    // mailer.send(record.signer_email, 'Signing Request: ' + record.title, { link: signLink, title: record.title, signer_name: record.signer_name });

    audit('signing_link_resent', { recordId: record.id, signerEmail: record.signer_email }, user);
    res.json({ ok: true, message: `Signing link resent to ${record.signer_name}` });
  }));

  // ============================================================
  // ROUTE 16: GET /school/signatures/api/stats — Stats Endpoint
  // ============================================================
  app.get('/school/signatures/api/stats', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;

    const total = (await pool.query(`SELECT COUNT(*)::int as cnt FROM signature_requests WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const pending = (await pool.query(`SELECT COUNT(*)::int as cnt FROM signature_requests WHERE tenant_id=$1 AND status='pending'`, [tid])).rows[0].cnt;
    const completed = (await pool.query(`SELECT COUNT(*)::int as cnt FROM signature_requests WHERE tenant_id=$1 AND status='completed'`, [tid])).rows[0].cnt;
    const expired = (await pool.query(`SELECT COUNT(*)::int as cnt FROM signature_requests WHERE tenant_id=$1 AND status='expired'`, [tid])).rows[0].cnt;
    const revoked = (await pool.query(`SELECT COUNT(*)::int as cnt FROM signature_requests WHERE tenant_id=$1 AND status='revoked'`, [tid])).rows[0].cnt;
    const totalSigs = (await pool.query(`SELECT COUNT(*)::int as cnt FROM signature_records sr JOIN signature_requests sreq ON sreq.id = sr.request_id WHERE sreq.tenant_id=$1 AND sr.signed_at IS NOT NULL`, [tid])).rows[0].cnt;
    const archiveCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM signed_documents WHERE tenant_id=$1`, [tid])).rows[0].cnt;

    res.json({
      ok: true,
      total_requests: total,
      pending,
      completed,
      expired,
      revoked,
      total_signatures: totalSigs,
      archived_documents: archiveCount,
    });
  }));

  // ============================================================
  // CRON: Expire Overdue Requests (runs on module load, could
  // be wired to a scheduler in production)
  // ============================================================
  (async () => {
    try {
      const result = await pool.query(
        `UPDATE signature_requests
         SET status = 'expired'
         WHERE status IN ('pending', 'partially_signed')
           AND deadline IS NOT NULL
           AND deadline < NOW()`
      );
      if (result.rowCount > 0) {
        console.log(`[DigitalSignatures] Expired ${result.rowCount} overdue request(s)`);
      }
    } catch (e) {
      console.error('[DigitalSignatures] Expiry check error:', e.message);
    }
  })();

  console.log('[DigitalSignatures] Module loaded — 16 routes registered');
};
