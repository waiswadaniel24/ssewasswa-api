// ============================================================
// STUDENT ID CARD GENERATOR MODULE — Multi-Tenant SaaS Platform
// Generate, print, verify, renew, revoke, bulk-print & analytics
// for student identity cards. 12 routes, PostgreSQL-backed.
// ============================================================
// Usage in server.js:
//   const studentIdCards = require('./student-id-cards');
//   studentIdCards(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS (declared outside module for hoisting)
// ============================================================
const { migrateQuery } = require('./db');
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
const fmtDateShort = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const today = () => new Date().toISOString().slice(0, 10);

function generateCardNumber(tid) {
  const prefix = 'ID';
  const ts = Date.now().toString(36).toUpperCase();
  const rand = require('crypto').randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${tid}-${ts}-${rand}`;
}

function statusBadge(status) {
  const map = {
    active:   { bg: '#dcfce7', c: '#16a34a', icon: '✅', label: 'Active' },
    expired:  { bg: '#fef3c7', c: '#b45309', icon: '⏰', label: 'Expired' },
    revoked:  { bg: '#fee2e2', c: '#dc2626', icon: '🚫', label: 'Revoked' },
    lost:     { bg: '#f1f5f9', c: '#64748b', icon: '🔍', label: 'Lost' },
  };
  const s = map[status] || { bg: '#f1f5f9', c: '#64748b', icon: '❓', label: status || 'Unknown' };
  return `<span class="badge" style="background:${s.bg};color:${s.c}">${s.icon} ${s.label}</span>`;
}

function qrPlaceholder(cardNumber) {
  // Generates a simple placeholder QR visual + the card number for scanning
  return `<div class="idcard-qr-placeholder" title="QR Code for ${cardNumber}">
    <svg viewBox="0 0 100 100" width="80" height="80" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#fff"/>
      <rect x="5" y="5" width="30" height="30" rx="2" fill="#1e293b"/>
      <rect x="8" y="8" width="24" height="24" rx="1" fill="#fff"/>
      <rect x="11" y="11" width="18" height="18" rx="1" fill="#1e293b"/>
      <rect x="65" y="5" width="30" height="30" rx="2" fill="#1e293b"/>
      <rect x="68" y="8" width="24" height="24" rx="1" fill="#fff"/>
      <rect x="71" y="11" width="18" height="18" rx="1" fill="#1e293b"/>
      <rect x="5" y="65" width="30" height="30" rx="2" fill="#1e293b"/>
      <rect x="8" y="68" width="24" height="24" rx="1" fill="#fff"/>
      <rect x="11" y="71" width="18" height="18" rx="1" fill="#1e293b"/>
      <rect x="40" y="5" width="5" height="5" fill="#1e293b"/><rect x="50" y="5" width="5" height="5" fill="#1e293b"/><rect x="40" y="15" width="5" height="5" fill="#1e293b"/>
      <rect x="45" y="20" width="5" height="5" fill="#1e293b"/><rect x="55" y="15" width="5" height="5" fill="#1e293b"/><rect x="40" y="25" width="5" height="5" fill="#1e293b"/>
      <rect x="50" y="25" width="5" height="5" fill="#1e293b"/><rect x="40" y="40" width="5" height="5" fill="#1e293b"/><rect x="45" y="45" width="5" height="5" fill="#1e293b"/>
      <rect x="55" y="40" width="5" height="5" fill="#1e293b"/><rect x="65" y="45" width="5" height="5" fill="#1e293b"/><rect x="75" y="40" width="5" height="5" fill="#1e293b"/>
      <rect x="85" y="45" width="5" height="5" fill="#1e293b"/><rect x="90" y="40" width="5" height="5" fill="#1e293b"/><rect x="40" y="55" width="5" height="5" fill="#1e293b"/>
      <rect x="50" y="55" width="5" height="5" fill="#1e293b"/><rect x="60" y="50" width="5" height="5" fill="#1e293b"/><rect x="70" y="55" width="5" height="5" fill="#1e293b"/>
      <rect x="80" y="55" width="5" height="5" fill="#1e293b"/><rect x="90" y="50" width="5" height="5" fill="#1e293b"/><rect x="45" y="65" width="5" height="5" fill="#1e293b"/>
      <rect x="55" y="65" width="5" height="5" fill="#1e293b"/><rect x="65" y="70" width="5" height="5" fill="#1e293b"/><rect x="75" y="65" width="5" height="5" fill="#1e293b"/>
      <rect x="85" y="70" width="5" height="5" fill="#1e293b"/><rect x="50" y="75" width="5" height="5" fill="#1e293b"/><rect x="60" y="80" width="5" height="5" fill="#1e293b"/>
      <rect x="70" y="75" width="5" height="5" fill="#1e293b"/><rect x="80" y="80" width="5" height="5" fill="#1e293b"/><rect x="90" y="75" width="5" height="5" fill="#1e293b"/>
      <rect x="40" y="90" width="5" height="5" fill="#1e293b"/><rect x="50" y="90" width="5" height="5" fill="#1e293b"/><rect x="60" y="90" width="5" height="5" fill="#1e293b"/>
      <rect x="70" y="90" width="5" height="5" fill="#1e293b"/><rect x="80" y="90" width="5" height="5" fill="#1e293b"/><rect x="90" y="90" width="5" height="5" fill="#1e293b"/>
    </svg>
    <div style="font-size:8px;color:#94a3b8;text-align:center;margin-top:2px;word-break:break-all">${cardNumber}</div>
  </div>`;
}

// ============================================================
// SHARED CSS — Complete inline styling for ID card module
// ============================================================
const IDCARD_CSS = `<style>
  /* --- Navigation --- */
  .idnav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
  .idnav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
  .idnav a:hover{background:#e2e8f0}
  .idnav a.active{background:#4f46e5;color:#fff}

  /* --- Cards & Badges --- */
  .idcard-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
  .idcard-item{background:#fff;border:2px solid #e2e8f0;border-radius:14px;padding:22px;transition:.2s}
  .idcard-item:hover{box-shadow:0 4px 16px rgba(0,0,0,.08);border-color:#c7d2fe}
  .badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
  .stat-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;text-align:center}
  .stat-num{font-size:28px;font-weight:800;color:#1e293b;line-height:1.2}

  /* --- Buttons --- */
  .idbtn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
  .idbtn:hover{opacity:.9;transform:translateY(-1px)}
  .idbtn-primary{background:#4f46e5;color:#fff}
  .idbtn-success{background:#059669;color:#fff}
  .idbtn-danger{background:#fee2e2;color:#dc2626}
  .idbtn-secondary{background:#f1f5f9;color:#475569}
  .idbtn-gold{background:#f59e0b;color:#fff}
  .idbtn-outline{background:transparent;color:#4f46e5;border:2px solid #4f46e5}

  /* --- Forms --- */
  .idform label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
  .idform input,.idform select,.idform textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;background:#fff}
  .idform input:focus,.idform select:focus,.idform textarea:focus{outline:none;border-color:#6366f1}
  .idgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .idgrid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}

  /* --- Tables --- */
  .idtable{width:100%;border-collapse:collapse;font-size:13px}
  .idtable th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
  .idtable td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
  .idtable tr:hover{background:#f8fafc}

  /* ============================================================
     PHYSICAL ID CARD — Front & Back
     Credit-card sized (3.375" x 2.125") scaled up for print
     ============================================================ */
  .id-card-physical{
    width:440px;height:280px;border-radius:12px;overflow:hidden;
    position:relative;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;
    box-shadow:0 4px 24px rgba(0,0,0,.12);background:#fff;
  }
  .id-card-front{
    width:440px;height:280px;display:grid;
    grid-template-columns:140px 1fr 100px;grid-template-rows:auto 1fr auto;
    position:relative;overflow:hidden;
  }
  .id-card-front .card-header{
    grid-column:1/-1;display:flex;align-items:center;gap:10px;
    padding:12px 16px 8px;background:linear-gradient(135deg,#4f46e5 0%,#6366f1 100%);
  }
  .id-card-front .card-header .school-icon{
    width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.2);
    display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;
  }
  .id-card-front .card-header .school-name{
    font-size:12px;font-weight:700;color:#fff;line-height:1.2;
  }
  .id-card-front .card-header .school-sub{
    font-size:8px;color:rgba(255,255,255,.7);font-weight:400;
  }
  .id-card-front .card-photo-area{
    padding:12px 8px 12px 16px;display:flex;flex-direction:column;align-items:center;justify-content:center;
  }
  .id-card-front .card-photo{
    width:90px;height:110px;border-radius:8px;border:3px solid #e2e8f0;
    background:#f1f5f9;display:flex;align-items:center;justify-content:center;
    overflow:hidden;
  }
  .id-card-front .card-photo img{width:100%;height:100%;object-fit:cover}
  .id-card-front .card-photo .no-photo{font-size:28px;color:#cbd5e1}
  .id-card-front .card-details{
    padding:12px 12px;display:flex;flex-direction:column;justify-content:center;
  }
  .id-card-front .card-details .detail-row{
    display:flex;align-items:baseline;margin-bottom:4px;
  }
  .id-card-front .card-details .detail-label{
    font-size:9px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;
    min-width:75px;
  }
  .id-card-front .card-details .detail-value{
    font-size:12px;font-weight:600;color:#1e293b;
  }
  .id-card-front .card-details .student-name{
    font-size:16px;font-weight:800;color:#1e293b;margin-bottom:6px;
    border-bottom:2px solid #4f46e5;padding-bottom:4px;
  }
  .id-card-front .card-qr-area{
    padding:12px 14px;display:flex;flex-direction:column;align-items:center;justify-content:center;
  }
  .id-card-front .card-qr-area .idcard-qr-placeholder svg{width:70px;height:70px}
  .id-card-front .card-qr-area .idcard-qr-placeholder div{font-size:6px}
  .id-card-front .card-footer{
    grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;
    padding:6px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;
  }
  .id-card-front .card-footer .card-no{
    font-size:9px;color:#64748b;font-family:'Courier New',monospace;font-weight:600;
  }
  .id-card-front .card-footer .validity{
    font-size:9px;color:#64748b;
  }

  /* --- ID Card Back --- */
  .id-card-back{
    width:440px;height:280px;padding:16px;position:relative;overflow:hidden;
    background:linear-gradient(180deg,#f8fafc 0%,#fff 100%);
    border-top:4px solid #4f46e5;
  }
  .id-card-back .back-title{
    font-size:11px;font-weight:700;color:#4f46e5;text-transform:uppercase;letter-spacing:1px;
    margin-bottom:10px;text-align:center;
  }
  .id-card-back .back-grid{
    display:grid;grid-template-columns:1fr 1fr;gap:8px;
  }
  .id-card-back .back-field .bf-label{
    font-size:8px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;
  }
  .id-card-back .back-field .bf-value{
    font-size:10px;font-weight:600;color:#1e293b;margin-top:1px;
  }
  .id-card-back .back-terms{
    margin-top:10px;padding-top:8px;border-top:1px dashed #e2e8f0;
  }
  .id-card-back .back-terms .terms-title{
    font-size:8px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;
    margin-bottom:4px;
  }
  .id-card-back .back-terms .terms-text{
    font-size:7px;color:#94a3b8;line-height:1.5;
  }
  .id-card-back .back-footer{
    position:absolute;bottom:12px;left:16px;right:16px;
    display:flex;justify-content:space-between;align-items:center;
  }
  .id-card-back .back-footer .back-school{
    font-size:8px;color:#94a3b8;font-weight:600;
  }
  .id-card-back .back-footer .back-website{
    font-size:8px;color:#4f46e5;font-weight:600;
  }

  /* --- Print Layout: A4 Landscape, 8 cards per page --- */
  .print-page{
    width:1122px;min-height:794px;padding:12px;
    background:#fff;position:relative;
    page-break-after:always;
  }
  .print-page-inner{
    width:100%;display:grid;grid-template-columns:1fr 1fr;gap:0;
  }
  .print-card-pair{
    display:flex;flex-direction:column;gap:0;
  }
  .print-card-pair .id-card-physical{
    width:100%;max-width:540px;box-shadow:none;
  }
  .print-card-pair .id-card-front{
    width:100%;
  }
  .print-card-pair .id-card-back{
    width:100%;
  }
  .crop-marks::before,.crop-marks::after{
    content:'';position:absolute;background:#000;
  }
  .crop-mark-tl{position:absolute;top:0;left:0;width:20px;height:1px;background:#000}
  .crop-mark-tr{position:absolute;top:0;right:0;width:20px;height:1px;background:#000}
  .crop-mark-bl{position:absolute;bottom:0;left:0;width:20px;height:1px;background:#000}
  .crop-mark-br{position:absolute;bottom:0;right:0;width:20px;height:1px;background:#000}
  .crop-mark-tl-v{position:absolute;top:0;left:0;width:1px;height:20px;background:#000}
  .crop-mark-tr-v{position:absolute;top:0;right:0;width:1px;height:20px;background:#000}
  .crop-mark-bl-v{position:absolute;bottom:0;left:0;width:1px;height:20px;background:#000}
  .crop-mark-br-v{position:absolute;bottom:0;right:0;width:1px;height:20px;background:#000}

  /* --- Responsive --- */
  @media(max-width:768px){
    .idgrid,.idgrid-3{grid-template-columns:1fr}
    .idcard-list{grid-template-columns:1fr}
    .id-card-physical{width:100%;max-width:440px}
    .id-card-front{grid-template-columns:120px 1fr 80px}
    .print-page{width:100%}
  }
  @media print{
    .idnav,.idbtn,.no-print,.breadcrumb{display:none!important}
    .print-page{margin:0;padding:8px;box-shadow:none;border:none}
    .id-card-physical{box-shadow:none;page-break-inside:avoid}
    body{background:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }

  /* --- Chart bars (simple CSS-only) --- */
  .chart-bar{display:flex;align-items:flex-end;gap:6px;height:140px;padding:8px 0}
  .chart-bar-col{display:flex;flex-direction:column;align-items:center;gap:2px}
  .chart-bar-fill{border-radius:4px 4px 0 0;min-width:32px;transition:height .3s}
  .chart-bar-label{font-size:10px;color:#64748b;font-weight:600;white-space:nowrap}
  .chart-bar-num{font-size:10px;font-weight:700;color:#1e293b}

  /* --- Donut chart (CSS only) --- */
  .donut-chart{width:160px;height:160px;border-radius:50%;position:relative;display:flex;align-items:center;justify-content:center}
  .donut-chart .donut-center{width:90px;height:90px;border-radius:50%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:1}
  .donut-chart .donut-center .donut-total{font-size:22px;font-weight:800;color:#1e293b}
  .donut-chart .donut-center .donut-label{font-size:10px;color:#94a3b8;font-weight:600}

  /* --- Timeline --- */
  .timeline-item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9}
  .timeline-item:last-child{border-bottom:none}
  .timeline-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
  .timeline-label{font-size:12px;color:#475569;flex:1}
  .timeline-count{font-size:13px;font-weight:700;color:#1e293b}
</style>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function studentIdCards(app, db, pool, renderPage, esc) {

  // -- inline helpers ---------------------------------------------------
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };

  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="idnav">
    <a href="/id-cards" class="${active === 'dash' ? 'active' : ''}">🪪 Dashboard</a>
    <a href="/id-cards/generate" class="${active === 'generate' ? 'active' : ''}">✨ Generate</a>
    <a href="/id-cards/all" class="${active === 'all' ? 'active' : ''}">📋 All Cards</a>
    <a href="/id-cards/bulk-print" class="${active === 'bulk' ? 'active' : ''}">🖨️ Bulk Print</a>
    <a href="/id-cards/reports" class="${active === 'reports' ? 'active' : ''}">📊 Reports</a>
  </div>`;

  // -- helper: build front-of-card HTML -----------------------------------
  const buildCardFront = (card, schoolName, schoolMotto) => {
    const photoHtml = card.photo_url
      ? `<img src="${esc(card.photo_url)}" alt="${esc(card.full_name)}">`
      : `<div class="no-photo">👤</div>`;
    return `<div class="id-card-front">
      <div class="card-header">
        <div class="school-icon">🎓</div>
        <div>
          <div class="school-name">${esc(schoolName || 'Academy')}</div>
          <div class="school-sub">${esc(schoolMotto || 'Excellence in Education')}</div>
        </div>
      </div>
      <div class="card-photo-area">
        <div class="card-photo">${photoHtml}</div>
      </div>
      <div class="card-details">
        <div class="student-name">${esc(card.full_name)}</div>
        <div class="detail-row"><span class="detail-label">Class</span><span class="detail-value">${esc(card.class || '—')}</span></div>
        <div class="detail-row"><span class="detail-label">Stream</span><span class="detail-value">${esc(card.stream || '—')}</span></div>
        <div class="detail-row"><span class="detail-label">Adm No</span><span class="detail-value">${esc(card.admission_no || '—')}</span></div>
        <div class="detail-row"><span class="detail-label">Blood Grp</span><span class="detail-value">${esc(card.blood_group || '—')}</span></div>
      </div>
      <div class="card-qr-area">${qrPlaceholder(card.card_number)}</div>
      <div class="card-footer">
        <span class="card-no">${esc(card.card_number)}</span>
        <span class="validity">Valid: ${fmtDateShort(card.valid_from)} – ${fmtDateShort(card.valid_until)}</span>
      </div>
    </div>`;
  };

  // -- helper: build back-of-card HTML ------------------------------------
  const buildCardBack = (card, schoolName, schoolWebsite) => {
    return `<div class="id-card-back">
      <div class="back-title">Student Identification Card</div>
      <div class="back-grid">
        <div class="back-field"><div class="bf-label">Full Name</div><div class="bf-value">${esc(card.full_name)}</div></div>
        <div class="back-field"><div class="bf-label">Date of Birth</div><div class="bf-value">${fmtDate(card.date_of_birth)}</div></div>
        <div class="back-field"><div class="bf-label">Blood Group</div><div class="bf-value">${esc(card.blood_group || 'N/A')}</div></div>
        <div class="back-field"><div class="bf-label">Admission No</div><div class="bf-value">${esc(card.admission_no || 'N/A')}</div></div>
        <div class="back-field" style="grid-column:1/-1"><div class="bf-label">Emergency Contact</div><div class="bf-value">${esc(card.qr_code_data ? JSON.parse(card.qr_code_data).emergency_contact || 'N/A' : 'N/A')}</div></div>
        <div class="back-field" style="grid-column:1/-1"><div class="bf-label">Address</div><div class="bf-value">${esc(card.qr_code_data ? JSON.parse(card.qr_code_data).address || 'N/A' : 'N/A')}</div></div>
      </div>
      <div class="back-terms">
        <div class="terms-title">Terms &amp; Conditions</div>
        <div class="terms-text">This card is the property of ${esc(schoolName || 'the School')} and must be surrendered upon request. It is non-transferable. Loss must be reported immediately. Unauthorised use is prohibited and may result in disciplinary action. This card must be carried at all times on school premises.</div>
      </div>
      <div class="back-footer">
        <span class="back-school">${esc(schoolName || 'School Name')}</span>
        <span class="back-website">${esc(schoolWebsite || 'www.school.edu')}</span>
      </div>
    </div>`;
  };

  // -- helper: get tenant school name -------------------------------------
  const getSchoolInfo = async (tid) => {
    try {
      const r = await pool.query(`SELECT school_name, school_motto, school_website FROM tenants WHERE id=$1`, [tid]);
      if (r.rows[0]) return r.rows[0];
    } catch (e) { /* fallback */ }
    return { school_name: 'Academy', school_motto: 'Excellence in Education', school_website: 'www.school.edu' };
  };

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      await migrateQuery(pool, 'StudentIdCards', `CREATE TABLE IF NOT EXISTS student_id_cards (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        card_number VARCHAR(50) UNIQUE,
        full_name VARCHAR(255) NOT NULL,
        class VARCHAR(100),
        stream VARCHAR(50),
        admission_no VARCHAR(100),
        photo_url TEXT,
        blood_group VARCHAR(10),
        date_of_birth DATE,
        valid_from DATE DEFAULT CURRENT_DATE,
        valid_until DATE,
        status VARCHAR(20) DEFAULT 'active',
        qr_code_data TEXT,
        issued_by INTEGER REFERENCES users(id),
        printed BOOLEAN DEFAULT false,
        print_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // Ensure columns exist (idempotent ALTER)
      const cols = [
        ['student_id', 'INTEGER REFERENCES students(id) ON DELETE CASCADE'],
        ['card_number', 'VARCHAR(50) UNIQUE'],
        ['full_name', 'VARCHAR(255) NOT NULL DEFAULT \'\''],
        ['class', 'VARCHAR(100)'],
        ['stream', 'VARCHAR(50)'],
        ['admission_no', 'VARCHAR(100)'],
        ['photo_url', 'TEXT'],
        ['blood_group', 'VARCHAR(10)'],
        ['date_of_birth', 'DATE'],
        ['valid_from', 'DATE DEFAULT CURRENT_DATE'],
        ['valid_until', 'DATE'],
        ['status', 'VARCHAR(20) DEFAULT \'active\''],
        ['qr_code_data', 'TEXT'],
        ['issued_by', 'INTEGER REFERENCES users(id)'],
        ['printed', 'BOOLEAN DEFAULT false'],
        ['print_count', 'INTEGER DEFAULT 0'],
      ];
      for (const [col, def] of cols) {
        try { await migrateQuery(pool, 'StudentIdCards', `ALTER TABLE student_id_cards ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {}
      }

      // Indexes
      await migrateQuery(pool, 'StudentIdCards', `CREATE INDEX IF NOT EXISTS idx_sic_tenant ON student_id_cards(tenant_id)`);
      await migrateQuery(pool, 'StudentIdCards', `CREATE INDEX IF NOT EXISTS idx_sic_student ON student_id_cards(student_id)`);
      await migrateQuery(pool, 'StudentIdCards', `CREATE INDEX IF NOT EXISTS idx_sic_card_number ON student_id_cards(card_number)`);
      await migrateQuery(pool, 'StudentIdCards', `CREATE INDEX IF NOT EXISTS idx_sic_status ON student_id_cards(tenant_id, status)`);
      await migrateQuery(pool, 'StudentIdCards', `CREATE INDEX IF NOT EXISTS idx_sic_class ON student_id_cards(tenant_id, class)`);
      await migrateQuery(pool, 'StudentIdCards', `CREATE INDEX IF NOT EXISTS idx_sic_valid_until ON student_id_cards(valid_until)`);

      console.log('[IDCards] Migrations applied successfully');
    } catch (e) { /* migration OK */ }
  })();

  // ============================================================
  // ROUTE 1: GET /id-cards — Dashboard
  // ============================================================
  app.get('/id-cards', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const total = (await pool.query(`SELECT COUNT(*)::int as cnt FROM student_id_cards WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const active = (await pool.query(`SELECT COUNT(*)::int as cnt FROM student_id_cards WHERE tenant_id=$1 AND status='active' AND valid_until >= CURRENT_DATE`, [tid])).rows[0].cnt;
    const expired = (await pool.query(`SELECT COUNT(*)::int as cnt FROM student_id_cards WHERE tenant_id=$1 AND (status='expired' OR (status='active' AND valid_until < CURRENT_DATE))`, [tid])).rows[0].cnt;
    const revoked = (await pool.query(`SELECT COUNT(*)::int as cnt FROM student_id_cards WHERE tenant_id=$1 AND status='revoked'`, [tid])).rows[0].cnt;
    const lost = (await pool.query(`SELECT COUNT(*)::int as cnt FROM student_id_cards WHERE tenant_id=$1 AND status='lost'`, [tid])).rows[0].cnt;
    const thisMonth = (await pool.query(`SELECT COUNT(*)::int as cnt FROM student_id_cards WHERE tenant_id=$1 AND created_at >= date_trunc('month', CURRENT_DATE)`, [tid])).rows[0].cnt;
    const printed = (await pool.query(`SELECT COUNT(*)::int as cnt FROM student_id_cards WHERE tenant_id=$1 AND printed=true`, [tid])).rows[0].cnt;

    const recentCards = (await pool.query(
      `SELECT sic.*, u.name as issuer_name
       FROM student_id_cards sic
       LEFT JOIN users u ON u.id = sic.issued_by
       WHERE sic.tenant_id=$1 ORDER BY sic.created_at DESC LIMIT 8`, [tid]
    )).rows;

    const recentHtml = recentCards.map(c => `<tr>
      <td><a href="/id-cards/${c.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(c.full_name)}</a></td>
      <td>${esc(c.class || '—')}</td>
      <td>${esc(c.admission_no || '—')}</td>
      <td>${statusBadge(c.status)}</td>
      <td style="font-size:12px;color:#64748b">${fmtDateShort(c.created_at)}</td>
    </tr>`).join('');

    // Expiring soon (next 30 days)
    const expiringSoon = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM student_id_cards
       WHERE tenant_id=$1 AND status='active' AND valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`, [tid]
    )).rows[0].cnt;

    const html = IDCARD_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b;margin:0">🪪 Student ID Cards</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">Generate, manage and print student identity cards</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/id-cards/generate" class="idbtn idbtn-primary">✨ Generate Card</a>
          <a href="/id-cards/bulk-print" class="idbtn idbtn-secondary">🖨️ Bulk Print</a>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${total}</div><div style="font-size:11px;color:#94a3b8;font-weight:600">Total Cards</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${active}</div><div style="font-size:11px;color:#94a3b8;font-weight:600">Active</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#b45309">${expired}</div><div style="font-size:11px;color:#94a3b8;font-weight:600">Expired</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${revoked}</div><div style="font-size:11px;color:#94a3b8;font-weight:600">Revoked</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#64748b">${lost}</div><div style="font-size:11px;color:#94a3b8;font-weight:600">Lost</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${printed}</div><div style="font-size:11px;color:#94a3b8;font-weight:600">Printed</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${thisMonth}</div><div style="font-size:11px;color:#94a3b8;font-weight:600">This Month</div></div>
      </div>

      ${expiringSoon > 0 ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:center;gap:10px">
        <span style="font-size:20px">⏰</span>
        <div><span style="font-size:13px;font-weight:700;color:#92400e">${expiringSoon} card${expiringSoon !== 1 ? 's' : ''} expiring</span> within the next 30 days. <a href="/id-cards/all?status=active&sort=valid_until" style="color:#4f46e5;font-weight:600">Review now →</a></div>
      </div>` : ''}

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card" style="padding:20px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3 style="font-size:15px;color:#1e293b;margin:0">📋 Recent Cards</h3>
            <a href="/id-cards/all" class="idbtn idbtn-secondary" style="padding:4px 12px;font-size:11px">View All →</a>
          </div>
          <div style="overflow-x:auto"><table class="idtable">
            <thead><tr><th>Student</th><th>Class</th><th>Adm No</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>${recentHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No ID cards generated yet</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">⚡ Quick Actions</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            <a href="/id-cards/generate" class="idbtn idbtn-primary" style="justify-content:center">✨ Generate New Card</a>
            <a href="/id-cards/bulk-print" class="idbtn idbtn-secondary" style="justify-content:center">🖨️ Bulk Print by Class</a>
            <a href="/id-cards/all?status=expired" class="idbtn idbtn-secondary" style="justify-content:center">⏰ View Expired Cards</a>
            <a href="/id-cards/reports" class="idbtn idbtn-secondary" style="justify-content:center">📊 View Reports</a>
          </div>
          <div style="margin-top:16px;padding:14px;background:#f0f9ff;border-radius:10px;border:1px solid #bae6fd">
            <div style="font-size:12px;font-weight:700;color:#0369a1;margin-bottom:4px">💡 Tip</div>
            <div style="font-size:11px;color:#0c4a6e;line-height:1.5">Scan any card's QR code or visit <code style="background:#e0f2fe;padding:1px 4px;border-radius:3px;font-size:10px">/api/v1/id-cards/verify/:card_number</code> to verify authenticity.</div>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('ID Card Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /id-cards/generate — Generate Form
  // ============================================================
  app.get('/id-cards/generate', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Fetch students for this tenant who don't have active cards yet
    const students = (await pool.query(
      `SELECT s.id, s.name, s.class, s.stream, s.admission_no, s.photo_url, s.blood_group, s.date_of_birth, s.emergency_contact, s.address
       FROM students s
       WHERE s.tenant_id=$1
       ORDER BY s.class, s.name`, [tid]
    )).rows;

    const studentOptions = students.map(s => `<option value="${s.id}" data-class="${esc(s.class || '')}" data-stream="${esc(s.stream || '')}" data-adm="${esc(s.admission_no || '')}" data-photo="${esc(s.photo_url || '')}" data-bg="${esc(s.blood_group || '')}" data-dob="${s.date_of_birth || ''}" data-emergency="${esc(s.emergency_contact || '')}" data-address="${esc(s.address || '')}">${esc(s.name)} — ${esc(s.class || 'No Class')} ${esc(s.stream || '')} (${esc(s.admission_no || 'N/A')})</option>`).join('');

    // Fetch classes for bulk generation
    const classes = (await pool.query(
      `SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL AND class != '' ORDER BY class`, [tid]
    )).rows;
    const classOptions = classes.map(c => `<option value="${esc(c.class)}">${esc(c.class)}</option>`).join('');

    const html = IDCARD_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('generate')}
      <a href="/id-cards" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Dashboard</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">✨ Generate ID Card</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Generate a single card or bulk-generate for an entire class</p>

        <!-- Mode Toggle -->
        <div style="display:flex;gap:0;margin-bottom:24px;border:2px solid #e2e8f0;border-radius:10px;overflow:hidden">
          <button type="button" onclick="showMode('single')" id="modeSingle" style="flex:1;padding:12px;border:none;font-size:13px;font-weight:700;cursor:pointer;background:#4f46e5;color:#fff">👤 Single Student</button>
          <button type="button" onclick="showMode('bulk')" id="modeBulk" style="flex:1;padding:12px;border:none;font-size:13px;font-weight:700;cursor:pointer;background:#f1f5f9;color:#475569">👥 Bulk by Class</button>
        </div>

        <!-- Single Mode -->
        <form id="singleForm" method="POST" action="/id-cards/generate" class="idform" style="display:flex;flex-direction:column;gap:16px">
          <div>
            <label>Select Student *</label>
            <select name="student_id" id="studentSelect" required onchange="prefillStudent()">
              <option value="">Choose a student...</option>
              ${studentOptions}
            </select>
          </div>
          <div class="idgrid">
            <div><label>Full Name *</label><input type="text" name="full_name" id="fullName" required></div>
            <div><label>Class</label><input type="text" name="class" id="classField" readonly style="background:#f8fafc"></div>
          </div>
          <div class="idgrid">
            <div><label>Stream</label><input type="text" name="stream" id="streamField" readonly style="background:#f8fafc"></div>
            <div><label>Admission No</label><input type="text" name="admission_no" id="admField" readonly style="background:#f8fafc"></div>
          </div>
          <div class="idgrid">
            <div><label>Blood Group</label><input type="text" name="blood_group" id="bgField" placeholder="e.g., A+"></div>
            <div><label>Date of Birth</label><input type="date" name="date_of_birth" id="dobField"></div>
          </div>
          <div><label>Photo URL (Cloudinary)</label><input type="text" name="photo_url" id="photoField" placeholder="https://res.cloudinary.com/..."></div>
          <div><label>Emergency Contact</label><input type="text" name="emergency_contact" id="emergencyField" placeholder="e.g., Parent: 0712-345678"></div>
          <div><label>Address</label><textarea name="address" id="addressField" rows="2" placeholder="Student home address..."></textarea></div>
          <div class="idgrid">
            <div><label>Valid From</label><input type="date" name="valid_from" value="${today()}"></div>
            <div><label>Valid Until</label><input type="date" name="valid_until" value="${new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10)}"></div>
          </div>
          <button type="submit" class="idbtn idbtn-primary" style="padding:14px 28px;font-size:15px;justify-content:center">🪪 Generate ID Card</button>
        </form>

        <!-- Bulk Mode -->
        <form id="bulkForm" method="POST" action="/id-cards/generate?mode=bulk" class="idform" style="display:none;flex-direction:column;gap:16px">
          <div>
            <label>Select Class *</label>
            <select name="class" required>
              <option value="">Choose a class...</option>
              ${classOptions}
            </select>
          </div>
          <div class="idgrid">
            <div><label>Valid From</label><input type="date" name="valid_from" value="${today()}"></div>
            <div><label>Valid Until</label><input type="date" name="valid_until" value="${new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10)}"></div>
          </div>
          <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:14px">
            <div style="font-size:12px;font-weight:700;color:#0369a1;margin-bottom:4px">ℹ️ Bulk Generation</div>
            <div style="font-size:12px;color:#0c4a6e;line-height:1.5">This will generate ID cards for <strong>all students</strong> in the selected class who don't already have an active card. Each card will be valid for 1 year.</div>
          </div>
          <button type="submit" class="idbtn idbtn-gold" style="padding:14px 28px;font-size:15px;justify-content:center">👥 Generate Cards for Class</button>
        </form>
      </div>
    </div>

    <script>
      function showMode(mode) {
        const sf = document.getElementById('singleForm');
        const bf = document.getElementById('bulkForm');
        const ms = document.getElementById('modeSingle');
        const mb = document.getElementById('modeBulk');
        if (mode === 'single') {
          sf.style.display = 'flex'; bf.style.display = 'none';
          ms.style.background = '#4f46e5'; ms.style.color = '#fff';
          mb.style.background = '#f1f5f9'; mb.style.color = '#475569';
        } else {
          sf.style.display = 'none'; bf.style.display = 'flex';
          mb.style.background = '#4f46e5'; mb.style.color = '#fff';
          ms.style.background = '#f1f5f9'; ms.style.color = '#475569';
        }
      }
      function prefillStudent() {
        const sel = document.getElementById('studentSelect');
        const opt = sel.options[sel.selectedIndex];
        if (!opt || !opt.value) return;
        document.getElementById('fullName').value = opt.textContent.split(' — ')[0].trim() || opt.textContent.split(' ')[0];
        document.getElementById('classField').value = opt.dataset.class || '';
        document.getElementById('streamField').value = opt.dataset.stream || '';
        document.getElementById('admField').value = opt.dataset.adm || '';
        document.getElementById('photoField').value = opt.dataset.photo || '';
        document.getElementById('bgField').value = opt.dataset.bg || '';
        document.getElementById('dobField').value = opt.dataset.dob || '';
        document.getElementById('emergencyField').value = opt.dataset.emergency || '';
        document.getElementById('addressField').value = opt.dataset.address || '';
      }
    </script>`;
    res.send(renderPage('Generate ID Card', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /id-cards/generate — Generate Card(s)
  // ============================================================
  app.post('/id-cards/generate', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const mode = req.query.mode;

    if (mode === 'bulk') {
      // ---- Bulk generation by class ----
      const { class: className, valid_from, valid_until } = req.body;
      if (!className || !className.trim()) {
        req.session.flash = { type: 'error', msg: 'Please select a class' };
        return res.redirect('/id-cards/generate');
      }

      // Fetch students in this class
      const students = (await pool.query(
        `SELECT s.id, s.name, s.class, s.stream, s.admission_no, s.photo_url, s.blood_group, s.date_of_birth, s.emergency_contact, s.address
         FROM students s
         WHERE s.tenant_id=$1 AND s.class=$2
         ORDER BY s.name`, [tid, className.trim()]
      )).rows;

      if (students.length === 0) {
        req.session.flash = { type: 'error', msg: `No students found in class "${className}"` };
        return res.redirect('/id-cards/generate');
      }

      // Check which students already have active cards
      const activeCards = (await pool.query(
        `SELECT student_id FROM student_id_cards WHERE tenant_id=$1 AND student_id = ANY($2) AND status='active' AND valid_until >= CURRENT_DATE`,
        [tid, students.map(s => s.id)]
      )).rows;
      const activeStudentIds = new Set(activeCards.map(c => c.student_id));

      let generated = 0;
      let skipped = 0;

      for (const student of students) {
        if (activeStudentIds.has(student.id)) { skipped++; continue; }

        let cardNumber;
        let attempts = 0;
        do {
          cardNumber = generateCardNumber(tid);
          const existing = (await pool.query(`SELECT 1 FROM student_id_cards WHERE card_number=$1`, [cardNumber])).rows[0];
          if (!existing) break;
          attempts++;
        } while (attempts < 10);

        const qrData = JSON.stringify({
          student_id: student.id,
          full_name: student.name,
          class: student.class,
          admission_no: student.admission_no,
          card_number: cardNumber,
          emergency_contact: student.emergency_contact || '',
          address: student.address || '',
        });

        try {
          await pool.query(
            `INSERT INTO student_id_cards (tenant_id, student_id, card_number, full_name, class, stream,
              admission_no, photo_url, blood_group, date_of_birth, valid_from, valid_until, status,
              qr_code_data, issued_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13,$14)`,
            [tid, student.id, cardNumber, student.name, student.class, student.stream,
             student.admission_no, student.photo_url, student.blood_group, student.date_of_birth,
             valid_from || today(), valid_until || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
             qrData, user.id]
          );
          generated++;
        } catch (e) { /* skip on duplicate */ }
      }

      req.session.flash = { type: 'success', msg: `Generated ${generated} card${generated !== 1 ? 's' : ''} for ${className}${skipped > 0 ? ` (${skipped} skipped — already have active cards)` : ''}` };
      return res.redirect('/id-cards/all');
    }

    // ---- Single card generation ----
    const { student_id, full_name, class: className, stream, admission_no, photo_url, blood_group, date_of_birth, emergency_contact, address, valid_from, valid_until } = req.body;

    if (!full_name || !full_name.trim()) {
      req.session.flash = { type: 'error', msg: 'Student name is required' };
      return res.redirect('/id-cards/generate');
    }

    // Check if student already has an active card
    if (student_id) {
      const existing = (await pool.query(
        `SELECT id FROM student_id_cards WHERE tenant_id=$1 AND student_id=$2 AND status='active' AND valid_until >= CURRENT_DATE`,
        [tid, parseInt(student_id)]
      )).rows[0];
      if (existing) {
        req.session.flash = { type: 'error', msg: 'This student already has an active ID card. Revoke or renew the existing one first.' };
        return res.redirect('/id-cards/generate');
      }
    }

    let cardNumber;
    let attempts = 0;
    do {
      cardNumber = generateCardNumber(tid);
      const existing = (await pool.query(`SELECT 1 FROM student_id_cards WHERE card_number=$1`, [cardNumber])).rows[0];
      if (!existing) break;
      attempts++;
    } while (attempts < 10);

    const qrData = JSON.stringify({
      student_id: student_id ? parseInt(student_id) : null,
      full_name: full_name.trim(),
      class: className || '',
      admission_no: admission_no || '',
      card_number: cardNumber,
      emergency_contact: emergency_contact || '',
      address: address || '',
    });

    const result = await pool.query(
      `INSERT INTO student_id_cards (tenant_id, student_id, card_number, full_name, class, stream,
        admission_no, photo_url, blood_group, date_of_birth, valid_from, valid_until, status,
        qr_code_data, issued_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13,$14) RETURNING id`,
      [tid, student_id ? parseInt(student_id) : null, cardNumber, full_name.trim(), className || null, stream || null,
       admission_no || null, photo_url || null, blood_group || null, date_of_birth || null,
       valid_from || today(), valid_until || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
       qrData, user.id]
    );

    req.session.flash = { type: 'success', msg: `ID card generated for ${full_name.trim()} (${cardNumber})` };
    res.redirect('/id-cards/' + result.rows[0].id);
  }));

  // ============================================================
  // ROUTE 4: GET /id-cards/all — List All Cards
  // ============================================================
  app.get('/id-cards/all', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { q, status, class: className, sort, page = 1 } = req.query;
    const limit = 20;
    const offset = (parseInt(page) - 1) * limit;

    let where = `sic.tenant_id=$1`;
    const params = [tid];
    let paramIdx = 2;

    if (q && q.trim()) {
      where += ` AND (sic.full_name ILIKE $${paramIdx} OR sic.card_number ILIKE $${paramIdx} OR sic.admission_no ILIKE $${paramIdx})`;
      params.push(`%${q.trim()}%`);
      paramIdx++;
    }
    if (status && status.trim()) {
      where += ` AND sic.status = $${paramIdx}`;
      params.push(status.trim());
      paramIdx++;
    }
    if (className && className.trim()) {
      where += ` AND sic.class = $${paramIdx}`;
      params.push(className.trim());
      paramIdx++;
    }

    let orderBy = 'sic.created_at DESC';
    if (sort === 'name') orderBy = 'sic.full_name ASC';
    if (sort === 'class') orderBy = 'sic.class ASC, sic.stream ASC';
    if (sort === 'valid_until') orderBy = 'sic.valid_until ASC';

    const countResult = (await pool.query(`SELECT COUNT(*)::int as cnt FROM student_id_cards sic WHERE ${where}`, params)).rows[0];
    const totalPages = Math.ceil(countResult.cnt / limit);

    const cards = (await pool.query(
      `SELECT sic.*, u.name as issuer_name
       FROM student_id_cards sic
       LEFT JOIN users u ON u.id = sic.issued_by
       WHERE ${where} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`, params
    )).rows;

    // Fetch distinct classes for filter
    const classes = (await pool.query(`SELECT DISTINCT class FROM student_id_cards WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class`, [tid])).rows;

    const cardsHtml = cards.map(c => `<tr>
      <td><a href="/id-cards/${c.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(c.full_name)}</a></td>
      <td>${esc(c.class || '—')}</td>
      <td>${esc(c.stream || '—')}</td>
      <td style="font-family:'Courier New',monospace;font-size:11px;color:#64748b">${esc(c.card_number || '—')}</td>
      <td>${statusBadge(c.status)}</td>
      <td style="font-size:12px;color:#64748b">${fmtDateShort(c.valid_until)}</td>
      <td>
        <div style="display:flex;gap:4px">
          <a href="/id-cards/${c.id}" class="idbtn idbtn-secondary" style="padding:4px 8px;font-size:11px" title="View">👁️</a>
          <a href="/id-cards/${c.id}/print" class="idbtn idbtn-secondary" style="padding:4px 8px;font-size:11px" title="Print">🖨️</a>
        </div>
      </td>
    </tr>`).join('');

    // Pagination
    const pageLinks = [];
    for (let i = 1; i <= totalPages; i++) {
      const qs = new URLSearchParams(req.query).toString();
      pageLinks.push(`<a href="/id-cards/all?${qs}&page=${i}" class="idbtn ${i === parseInt(page) ? 'idbtn-primary' : 'idbtn-secondary'}" style="padding:4px 10px;font-size:12px">${i}</a>`);
    }

    const html = IDCARD_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('all')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b;margin:0">📋 All ID Cards</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">${countResult.cnt} card${countResult.cnt !== 1 ? 's' : ''} total</p>
        </div>
        <a href="/id-cards/generate" class="idbtn idbtn-primary">✨ Generate New</a>
      </div>

      <!-- Filters -->
      <div class="card" style="padding:16px;margin-bottom:16px">
        <form method="GET" action="/id-cards/all" class="idform">
          <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:10px;align-items:end">
            <div><label>Search</label><input type="text" name="q" value="${esc(req.query.q || '')}" placeholder="Name, card number, admission no..."></div>
            <div><label>Status</label>
              <select name="status">
                <option value="">All Statuses</option>
                <option value="active" ${req.query.status === 'active' ? 'selected' : ''}>Active</option>
                <option value="expired" ${req.query.status === 'expired' ? 'selected' : ''}>Expired</option>
                <option value="revoked" ${req.query.status === 'revoked' ? 'selected' : ''}>Revoked</option>
                <option value="lost" ${req.query.status === 'lost' ? 'selected' : ''}>Lost</option>
              </select>
            </div>
            <div><label>Class</label>
              <select name="class">
                <option value="">All Classes</option>
                ${classes.map(c => `<option value="${esc(c.class)}" ${req.query.class === c.class ? 'selected' : ''}>${esc(c.class)}</option>`).join('')}
              </select>
            </div>
            <div><label>Sort By</label>
              <select name="sort">
                <option value="" ${!req.query.sort ? 'selected' : ''}>Newest First</option>
                <option value="name" ${req.query.sort === 'name' ? 'selected' : ''}>Name</option>
                <option value="class" ${req.query.sort === 'class' ? 'selected' : ''}>Class</option>
                <option value="valid_until" ${req.query.sort === 'valid_until' ? 'selected' : ''}>Expiry Date</option>
              </select>
            </div>
            <button type="submit" class="idbtn idbtn-primary" style="height:42px;margin-top:auto">🔍</button>
          </div>
        </form>
      </div>

      <!-- Cards Table -->
      <div class="card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto">
          <table class="idtable">
            <thead><tr><th>Student</th><th>Class</th><th>Stream</th><th>Card Number</th><th>Status</th><th>Valid Until</th><th>Actions</th></tr></thead>
            <tbody>${cardsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No ID cards found</td></tr>'}</tbody>
          </table>
        </div>
        ${totalPages > 1 ? `<div style="padding:14px;display:flex;justify-content:center;gap:6px;border-top:1px solid #f1f5f9">${pageLinks.join('')}</div>` : ''}
      </div>
    </div>`;
    res.send(renderPage('All ID Cards', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /id-cards/:id — View Single Card
  // ============================================================
  app.get('/id-cards/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, cardId = req.params.id;

    const card = (await pool.query(
      `SELECT sic.*, u.name as issuer_name
       FROM student_id_cards sic
       LEFT JOIN users u ON u.id = sic.issued_by
       WHERE sic.id=$1 AND sic.tenant_id=$2`, [cardId, tid]
    )).rows[0];

    if (!card) {
      return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">ID Card not found</h2><a href="/id-cards" class="idbtn idbtn-primary" style="margin-top:12px">← Back to Dashboard</a></div>', user, req));
    }

    const school = await getSchoolInfo(tid);

    // Auto-update expired cards
    if (card.status === 'active' && card.valid_until && new Date(card.valid_until) < new Date()) {
      await pool.query(`UPDATE student_id_cards SET status='expired' WHERE id=$1`, [cardId]);
      card.status = 'expired';
    }

    const html = IDCARD_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('')}
      <div class="no-print" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <a href="/id-cards/all" style="color:#64748b;font-size:14px;text-decoration:none">← All Cards</a>
          <h1 style="font-size:22px;color:#1e293b;margin:4px 0 0">🪪 ${esc(card.full_name)}</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">${esc(card.card_number)} · ${statusBadge(card.status)}</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/id-cards/${card.id}/print" class="idbtn idbtn-primary">🖨️ Print Card</a>
          ${card.status === 'expired' ? `<form method="POST" action="/id-cards/${card.id}/renew" style="display:inline"><button class="idbtn idbtn-success" type="submit">🔄 Renew</button></form>` : ''}
          ${card.status === 'active' ? `<form method="POST" action="/id-cards/${card.id}/revoke" style="display:inline" onsubmit="return confirm('Revoke this card? This action cannot be easily undone.')"><button class="idbtn idbtn-danger" type="submit">🚫 Revoke</button></form>` : ''}
        </div>
      </div>

      <!-- Card Details Info -->
      <div class="card no-print" style="padding:18px;margin-bottom:20px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;font-size:13px">
          <div><span style="color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase">Student</span><div style="font-weight:700;color:#1e293b;margin-top:2px">${esc(card.full_name)}</div></div>
          <div><span style="color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase">Class / Stream</span><div style="font-weight:700;color:#1e293b;margin-top:2px">${esc(card.class || '—')} ${esc(card.stream || '')}</div></div>
          <div><span style="color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase">Admission No</span><div style="font-weight:700;color:#1e293b;margin-top:2px">${esc(card.admission_no || '—')}</div></div>
          <div><span style="color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase">Card Number</span><div style="font-weight:700;color:#1e293b;margin-top:2px;font-family:'Courier New',monospace">${esc(card.card_number)}</div></div>
          <div><span style="color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase">Valid From</span><div style="font-weight:700;color:#1e293b;margin-top:2px">${fmtDate(card.valid_from)}</div></div>
          <div><span style="color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase">Valid Until</span><div style="font-weight:700;color:#1e293b;margin-top:2px">${fmtDate(card.valid_until)}</div></div>
          <div><span style="color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase">Blood Group</span><div style="font-weight:700;color:#1e293b;margin-top:2px">${esc(card.blood_group || '—')}</div></div>
          <div><span style="color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase">Issued By</span><div style="font-weight:700;color:#1e293b;margin-top:2px">${esc(card.issuer_name || '—')}</div></div>
          <div><span style="color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase">Printed</span><div style="font-weight:700;color:#1e293b;margin-top:2px">${card.printed ? `✅ Yes (${card.print_count} time${card.print_count !== 1 ? 's' : ''})` : '❌ No'}</div></div>
          <div><span style="color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase">Created</span><div style="font-weight:700;color:#1e293b;margin-top:2px">${fmtDate(card.created_at)}</div></div>
        </div>
      </div>

      <!-- Preview Cards -->
      <div style="margin-bottom:20px">
        <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">Card Preview</h3>
        <div style="display:flex;gap:24px;flex-wrap:wrap">
          <div>
            <div style="font-size:11px;font-weight:700;color:#94a3b8;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Front</div>
            <div class="id-card-physical" style="margin:0 auto">
              ${buildCardFront(card, school.school_name, school.school_motto)}
            </div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:#94a3b8;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Back</div>
            <div class="id-card-physical" style="margin:0 auto">
              ${buildCardBack(card, school.school_name, school.school_website)}
            </div>
          </div>
        </div>
      </div>

      <!-- Verify API Info -->
      <div class="card no-print" style="padding:18px;background:#f8fafc">
        <h3 style="font-size:14px;color:#1e293b;margin:0 0 8px">🔗 Public Verification API</h3>
        <div style="font-size:12px;color:#475569;line-height:1.6">
          <p>Use the following endpoint to verify this card via QR scan:</p>
          <code style="display:block;background:#fff;padding:10px 14px;border-radius:8px;border:1px solid #e2e8f0;font-size:12px;margin-top:8px;word-break:break-all">GET /api/v1/id-cards/verify/${esc(card.card_number)}</code>
        </div>
      </div>
    </div>`;
    res.send(renderPage(`ID Card — ${card.full_name}`, html, user, req));
  }));

  // ============================================================
  // ROUTE 6: GET /id-cards/:id/print — Print-Ready View
  // ============================================================
  app.get('/id-cards/:id/print', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, cardId = req.params.id;

    const card = (await pool.query(
      `SELECT sic.*, u.name as issuer_name
       FROM student_id_cards sic
       LEFT JOIN users u ON u.id = sic.issued_by
       WHERE sic.id=$1 AND sic.tenant_id=$2`, [cardId, tid]
    )).rows[0];

    if (!card) {
      return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">ID Card not found</h2></div>', user, req));
    }

    const school = await getSchoolInfo(tid);

    // Update print tracking
    await pool.query(
      `UPDATE student_id_cards SET printed=true, print_count=COALESCE(print_count,0)+1 WHERE id=$1`,
      [cardId]
    );

    // Print layout: Front and back on the same page (A4)
    const html = IDCARD_CSS + `
    <div class="no-print" style="max-width:1000px;margin:0 auto 20px;padding:12px;display:flex;justify-content:space-between;align-items:center">
      <div><h2 style="font-size:18px;color:#1e293b;margin:0">🖨️ Print Preview — ${esc(card.full_name)}</h2>
        <p style="font-size:12px;color:#94a3b8;margin:2px 0 0">${esc(card.card_number)} · ${esc(card.class || '')} ${esc(card.stream || '')}</p></div>
      <div style="display:flex;gap:8px">
        <button onclick="window.print()" class="idbtn idbtn-primary">🖨️ Print</button>
        <a href="/id-cards/${card.id}" class="idbtn idbtn-secondary">← Back</a>
      </div>
    </div>

    <div class="print-page" style="margin:0 auto">
      <div style="display:flex;flex-direction:column;align-items:center;gap:20px;padding:40px">
        <!-- Front -->
        <div style="position:relative">
          <div class="crop-mark-tl"></div><div class="crop-mark-tr"></div>
          <div class="crop-mark-bl"></div><div class="crop-mark-br"></div>
          <div class="crop-mark-tl-v"></div><div class="crop-mark-tr-v"></div>
          <div class="crop-mark-bl-v"></div><div class="crop-mark-br-v"></div>
          <div class="id-card-physical">
            ${buildCardFront(card, school.school_name, school.school_motto)}
          </div>
        </div>
        <!-- Back -->
        <div style="position:relative">
          <div class="crop-mark-tl"></div><div class="crop-mark-tr"></div>
          <div class="crop-mark-bl"></div><div class="crop-mark-br"></div>
          <div class="crop-mark-tl-v"></div><div class="crop-mark-tr-v"></div>
          <div class="crop-mark-bl-v"></div><div class="crop-mark-br-v"></div>
          <div class="id-card-physical">
            ${buildCardBack(card, school.school_name, school.school_website)}
          </div>
        </div>
      </div>
    </div>`;

    res.send(renderPage(`Print — ${card.full_name}`, html, user, req));
  }));

  // ============================================================
  // ROUTE 7: POST /id-cards/:id/renew — Renew Expired Card
  // ============================================================
  app.post('/id-cards/:id/renew', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, cardId = req.params.id;

    const card = (await pool.query(
      `SELECT * FROM student_id_cards WHERE id=$1 AND tenant_id=$2`, [cardId, tid]
    )).rows[0];

    if (!card) {
      req.session.flash = { type: 'error', msg: 'Card not found' };
      return res.redirect('/id-cards/all');
    }

    if (card.status !== 'expired' && card.status !== 'active') {
      req.session.flash = { type: 'error', msg: `Cannot renew a card with status "${card.status}"` };
      return res.redirect('/id-cards/' + cardId);
    }

    const newValidFrom = today();
    const newValidUntil = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

    // Generate new card number for renewed card
    let newCardNumber;
    let attempts = 0;
    do {
      newCardNumber = generateCardNumber(tid);
      const existing = (await pool.query(`SELECT 1 FROM student_id_cards WHERE card_number=$1`, [newCardNumber])).rows[0];
      if (!existing) break;
      attempts++;
    } while (attempts < 10);

    // Create renewed card and mark old one as expired
    await pool.query(`UPDATE student_id_cards SET status='expired' WHERE id=$1`, [cardId]);

    const newQrData = card.qr_code_data ? (() => {
      try {
        const data = JSON.parse(card.qr_code_data);
        data.card_number = newCardNumber;
        return JSON.stringify(data);
      } catch (e) { return card.qr_code_data; }
    })() : null;

    const result = await pool.query(
      `INSERT INTO student_id_cards (tenant_id, student_id, card_number, full_name, class, stream,
        admission_no, photo_url, blood_group, date_of_birth, valid_from, valid_until, status,
        qr_code_data, issued_by, printed, print_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13,$14,false,0) RETURNING id`,
      [tid, card.student_id, newCardNumber, card.full_name, card.class, card.stream,
       card.admission_no, card.photo_url, card.blood_group, card.date_of_birth,
       newValidFrom, newValidUntil, newQrData, user.id]
    );

    req.session.flash = { type: 'success', msg: `Card renewed successfully. New card number: ${newCardNumber}` };
    res.redirect('/id-cards/' + result.rows[0].id);
  }));

  // ============================================================
  // ROUTE 8: POST /id-cards/:id/revoke — Revoke Card
  // ============================================================
  app.post('/id-cards/:id/revoke', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, cardId = req.params.id;

    const card = (await pool.query(
      `SELECT * FROM student_id_cards WHERE id=$1 AND tenant_id=$2`, [cardId, tid]
    )).rows[0];

    if (!card) {
      req.session.flash = { type: 'error', msg: 'Card not found' };
      return res.redirect('/id-cards/all');
    }

    if (card.status !== 'active') {
      req.session.flash = { type: 'error', msg: `Cannot revoke a card with status "${card.status}"` };
      return res.redirect('/id-cards/' + cardId);
    }

    await pool.query(
      `UPDATE student_id_cards SET status='revoked' WHERE id=$1 AND tenant_id=$2`,
      [cardId, tid]
    );

    req.session.flash = { type: 'success', msg: `Card for ${card.full_name} has been revoked` };
    res.redirect('/id-cards/' + cardId);
  }));

  // ============================================================
  // ROUTE 9: GET /id-cards/bulk-print — Bulk Print Form
  // ============================================================
  app.get('/id-cards/bulk-print', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const classes = (await pool.query(
      `SELECT DISTINCT sic.class,
        (SELECT COUNT(*)::int FROM student_id_cards WHERE tenant_id=$1 AND class=sic.class AND status='active') as active_count
       FROM student_id_cards sic
       WHERE sic.tenant_id=$1 AND sic.class IS NOT NULL AND sic.class != '' AND sic.status='active'
       ORDER BY sic.class`, [tid]
    )).rows;

    const classCards = classes.map(c => `<div class="idcard-item" style="cursor:pointer;${req.query.class === c.class ? 'border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.15)' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:16px;font-weight:700;color:#1e293b">${esc(c.class)}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px">Active cards</div>
        </div>
        <div style="font-size:28px;font-weight:800;color:#4f46e5">${c.active_count}</div>
      </div>
      <div style="margin-top:12px">
        <form method="POST" action="/id-cards/bulk-print" style="display:inline">
          <input type="hidden" name="class" value="${esc(c.class)}">
          <button type="submit" class="idbtn idbtn-primary" style="width:100%;justify-content:center" ${c.active_count === 0 ? 'disabled style="width:100%;justify-content:center;opacity:.5;cursor:not-allowed"' : ''}>🖨️ Print ${c.active_count} Card${c.active_count !== 1 ? 's' : ''}</button>
        </form>
      </div>
    </div>`).join('');

    const html = IDCARD_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('bulk')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b;margin:0">🖨️ Bulk Print ID Cards</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">Print all active cards for a class — 8 cards per A4 page</p>
        </div>
        <a href="/id-cards/generate" class="idbtn idbtn-secondary">← Generate Cards</a>
      </div>

      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:flex-start;gap:10px">
        <span style="font-size:20px">ℹ️</span>
        <div style="font-size:12px;color:#0c4a6e;line-height:1.6">
          <strong>How Bulk Print Works:</strong> Select a class to print all active ID cards. Cards are arranged
          <strong>8 per A4 page</strong> (4 front + 4 back) in landscape orientation with crop marks for easy cutting.
          Use your browser's Print dialog (Ctrl+P / Cmd+P) and set to <strong>Landscape, A4, No margins</strong>.
        </div>
      </div>

      <div class="idcard-list">
        ${classCards || '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#94a3b8"><p style="font-size:14px">No classes with active ID cards found.</p><a href="/id-cards/generate" class="idbtn idbtn-primary" style="margin-top:12px">Generate Cards First</a></div>'}
      </div>
    </div>`;
    res.send(renderPage('Bulk Print', html, user, req));
  }));

  // ============================================================
  // ROUTE 10: POST /id-cards/bulk-print — Handle Bulk Print
  // ============================================================
  app.post('/id-cards/bulk-print', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { class: className } = req.body;

    if (!className || !className.trim()) {
      req.session.flash = { type: 'error', msg: 'Please select a class' };
      return res.redirect('/id-cards/bulk-print');
    }

    const cards = (await pool.query(
      `SELECT * FROM student_id_cards
       WHERE tenant_id=$1 AND class=$2 AND status='active'
       ORDER BY stream, full_name`, [tid, className.trim()]
    )).rows;

    if (cards.length === 0) {
      req.session.flash = { type: 'error', msg: `No active cards found for class "${className}"` };
      return res.redirect('/id-cards/bulk-print');
    }

    const school = await getSchoolInfo(tid);

    // Mark all as printed
    for (const card of cards) {
      await pool.query(`UPDATE student_id_cards SET printed=true, print_count=COALESCE(print_count,0)+1 WHERE id=$1`, [card.id]);
    }

    // Build print pages: 4 cards per page (each card = front + back side by side)
    const cardsPerPage = 4;
    const pages = [];
    for (let i = 0; i < cards.length; i += cardsPerPage) {
      const pageCards = cards.slice(i, i + cardsPerPage);
      const cardsHtml = pageCards.map(card => `
        <div style="display:flex;gap:12px;margin-bottom:12px">
          <div style="position:relative;flex:1">
            <div class="crop-mark-tl"></div><div class="crop-mark-tr"></div>
            <div class="crop-mark-bl"></div><div class="crop-mark-br"></div>
            <div class="crop-mark-tl-v"></div><div class="crop-mark-tr-v"></div>
            <div class="crop-mark-bl-v"></div><div class="crop-mark-br-v"></div>
            <div class="id-card-physical">
              ${buildCardFront(card, school.school_name, school.school_motto)}
            </div>
          </div>
          <div style="position:relative;flex:1">
            <div class="crop-mark-tl"></div><div class="crop-mark-tr"></div>
            <div class="crop-mark-bl"></div><div class="crop-mark-br"></div>
            <div class="crop-mark-tl-v"></div><div class="crop-mark-tr-v"></div>
            <div class="crop-mark-bl-v"></div><div class="crop-mark-br-v"></div>
            <div class="id-card-physical">
              ${buildCardBack(card, school.school_name, school.school_website)}
            </div>
          </div>
        </div>
      `).join('');

      pages.push(`<div class="print-page">
        <div style="text-align:center;padding:8px 0 4px;font-size:10px;color:#94a3b8">
          ${esc(school.school_name)} — Class ${esc(className)} — Page ${Math.floor(i / cardsPerPage) + 1} of ${Math.ceil(cards.length / cardsPerPage)}
        </div>
        ${cardsHtml}
      </div>`);
    }

    const html = IDCARD_CSS + `
    <div class="no-print" style="max-width:1200px;margin:0 auto 20px;padding:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <div>
        <h2 style="font-size:18px;color:#1e293b;margin:0">🖨️ Bulk Print — ${esc(className)}</h2>
        <p style="font-size:12px;color:#94a3b8;margin:2px 0 0">${cards.length} card${cards.length !== 1 ? 's' : ''} · ${pages.length} page${pages.length !== 1 ? 's' : ''} (A4 Landscape)</p>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="window.print()" class="idbtn idbtn-primary">🖨️ Print All Pages</button>
        <a href="/id-cards/bulk-print" class="idbtn idbtn-secondary">← Back</a>
      </div>
    </div>

    <div class="no-print" style="max-width:1200px;margin:0 auto 12px;padding:0 12px">
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 16px;font-size:12px;color:#92400e">
        <strong>Print Settings:</strong> Landscape orientation · A4 paper · No margins · Background graphics enabled
      </div>
    </div>

    ${pages.join('\n')}`;

    res.send(renderPage(`Bulk Print — ${className}`, html, user, req));
  }));

  // ============================================================
  // ROUTE 11: GET /id-cards/reports — Reports & Analytics
  // ============================================================
  app.get('/id-cards/reports', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Cards by class
    const byClass = (await pool.query(
      `SELECT class, COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status='active') as active,
        COUNT(*) FILTER (WHERE status='expired') as expired,
        COUNT(*) FILTER (WHERE status='revoked') as revoked
       FROM student_id_cards
       WHERE tenant_id=$1 AND class IS NOT NULL AND class != ''
       GROUP BY class ORDER BY class`, [tid]
    )).rows;

    const maxClassTotal = Math.max(...byClass.map(c => c.total), 1);
    const classChartHtml = byClass.map(c => `
      <div class="chart-bar-col">
        <div class="chart-bar-num">${c.total}</div>
        <div style="display:flex;gap:1px;align-items:flex-end">
          <div class="chart-bar-fill" style="height:${(c.active / maxClassTotal) * 100}px;background:#16a34a;flex:1" title="Active: ${c.active}"></div>
          <div class="chart-bar-fill" style="height:${(c.expired / maxClassTotal) * 100}px;background:#f59e0b;flex:1" title="Expired: ${c.expired}"></div>
          <div class="chart-bar-fill" style="height:${(c.revoked / maxClassTotal) * 100}px;background:#dc2626;flex:1" title="Revoked: ${c.revoked}"></div>
        </div>
        <div class="chart-bar-label">${esc(c.class)}</div>
      </div>
    `).join('');

    // Status distribution
    const statusDist = (await pool.query(
      `SELECT status, COUNT(*)::int as cnt FROM student_id_cards WHERE tenant_id=$1 GROUP BY status ORDER BY cnt DESC`, [tid]
    )).rows;
    const statusTotal = statusDist.reduce((sum, s) => sum + s.cnt, 0);
    const statusColors = { active: '#16a34a', expired: '#f59e0b', revoked: '#dc2626', lost: '#64748b' };
    const statusSegments = statusDist.map(s => {
      const pct = statusTotal > 0 ? ((s.cnt / statusTotal) * 100) : 0;
      return `${statusColors[s.status] || '#94a3b8'} ${pct.toFixed(1)}%`;
    });
    const donutGradient = statusSegments.join(', ');

    // Expiry timeline (next 12 months)
    const timeline = (await pool.query(
      `SELECT
        CASE
          WHEN valid_until < CURRENT_DATE THEN 'Overdue'
          WHEN valid_until < CURRENT_DATE + INTERVAL '1 month' THEN 'This Month'
          WHEN valid_until < CURRENT_DATE + INTERVAL '3 months' THEN '1-3 Months'
          WHEN valid_until < CURRENT_DATE + INTERVAL '6 months' THEN '3-6 Months'
          WHEN valid_until < CURRENT_DATE + INTERVAL '12 months' THEN '6-12 Months'
          ELSE '1 Year+'
        END as period,
        COUNT(*)::int as cnt
       FROM student_id_cards
       WHERE tenant_id=$1 AND status='active'
       GROUP BY period
       ORDER BY CASE period
         WHEN 'Overdue' THEN 1 WHEN 'This Month' THEN 2 WHEN '1-3 Months' THEN 3
         WHEN '3-6 Months' THEN 4 WHEN '6-12 Months' THEN 5 ELSE 6
       END`, [tid]
    )).rows;

    const timelineColors = { Overdue: '#dc2626', 'This Month': '#f59e0b', '1-3 Months': '#3b82f6', '3-6 Months': '#6366f1', '6-12 Months': '#059669', '1 Year+': '#94a3b8' };

    const timelineHtml = timeline.map(t => `
      <div class="timeline-item">
        <div class="timeline-dot" style="background:${timelineColors[t.period] || '#94a3b8'}"></div>
        <div class="timeline-label">${esc(t.period)}</div>
        <div class="timeline-count" style="color:${timelineColors[t.period] || '#1e293b'}">${t.cnt}</div>
      </div>
    `).join('');

    // Monthly generation trend (last 6 months)
    const monthly = (await pool.query(
      `SELECT to_char(created_at, 'Mon YYYY') as month, COUNT(*)::int as cnt
       FROM student_id_cards
       WHERE tenant_id=$1 AND created_at >= CURRENT_DATE - INTERVAL '6 months'
       GROUP BY month ORDER BY MIN(created_at)`, [tid]
    )).rows;
    const maxMonthly = Math.max(...monthly.map(m => m.cnt), 1);
    const monthlyChartHtml = monthly.map(m => `
      <div class="chart-bar-col">
        <div class="chart-bar-num">${m.cnt}</div>
        <div class="chart-bar-fill" style="height:${(m.cnt / maxMonthly) * 100}px;background:#4f46e5"></div>
        <div class="chart-bar-label">${esc(m.month)}</div>
      </div>
    `).join('');

    // Top stats
    const totalCards = statusTotal;
    const totalActive = statusDist.find(s => s.status === 'active')?.cnt || 0;
    const totalPrinted = (await pool.query(`SELECT COUNT(*)::int as cnt FROM student_id_cards WHERE tenant_id=$1 AND printed=true`, [tid])).rows[0].cnt;

    const html = IDCARD_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('reports')}
      <div style="margin-bottom:20px">
        <h1 style="font-size:24px;color:#1e293b;margin:0">📊 ID Card Reports</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Analytics and insights for student identity cards</p>
      </div>

      <!-- Summary Stats -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${totalCards}</div><div style="font-size:11px;color:#94a3b8;font-weight:600">Total Cards</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${totalActive}</div><div style="font-size:11px;color:#94a3b8;font-weight:600">Active</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${totalPrinted}</div><div style="font-size:11px;color:#94a3b8;font-weight:600">Printed</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${byClass.length}</div><div style="font-size:11px;color:#94a3b8;font-weight:600">Classes</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <!-- Status Distribution -->
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 16px">Status Distribution</h3>
          <div style="display:flex;align-items:center;gap:24px">
            <div class="donut-chart" style="background:conic-gradient(${donutGradient || '#e2e8f0 100%'})">
              <div class="donut-center">
                <div class="donut-total">${totalCards}</div>
                <div class="donut-label">Total</div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              ${statusDist.map(s => `<div style="display:flex;align-items:center;gap:8px;font-size:13px">
                <div style="width:12px;height:12px;border-radius:3px;background:${statusColors[s.status] || '#94a3b8'}"></div>
                <span style="color:#475569;flex:1">${esc(s.status || 'unknown').charAt(0).toUpperCase() + (s.status || 'unknown').slice(1)}</span>
                <span style="font-weight:700;color:#1e293b">${s.cnt}</span>
              </div>`).join('')}
            </div>
          </div>
        </div>

        <!-- Expiry Timeline -->
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 16px">⏰ Expiry Timeline (Active Cards)</h3>
          <div>${timelineHtml || '<div style="text-align:center;color:#94a3b8;padding:30px;font-size:13px">No active cards</div>'}</div>
        </div>
      </div>

      <!-- Cards by Class -->
      <div class="card" style="padding:20px;margin-bottom:20px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 4px">📚 Cards by Class</h3>
        <p style="font-size:12px;color:#94a3b8;margin-bottom:16px">Active (green) · Expired (yellow) · Revoked (red)</p>
        <div class="chart-bar">${classChartHtml || '<div style="text-align:center;color:#94a3b8;padding:30px;width:100%;font-size:13px">No class data</div>'}</div>
      </div>

      <!-- Monthly Generation Trend -->
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 4px">📈 Monthly Generation Trend</h3>
        <p style="font-size:12px;color:#94a3b8;margin-bottom:16px">Cards generated per month (last 6 months)</p>
        <div class="chart-bar">${monthlyChartHtml || '<div style="text-align:center;color:#94a3b8;padding:30px;width:100%;font-size:13px">No data yet</div>'}</div>
      </div>
    </div>`;
    res.send(renderPage('ID Card Reports', html, user, req));
  }));

  // ============================================================
  // ROUTE 12: GET /api/v1/id-cards/verify/:card_number — Public Verify API
  // ============================================================
  app.get('/api/v1/id-cards/verify/:card_number', ah(async (req, res) => {
    const cardNumber = req.params.card_number;

    if (!cardNumber || cardNumber.length < 5) {
      return res.status(400).json({ valid: false, error: 'Invalid card number format' });
    }

    const card = (await pool.query(
      `SELECT sic.*, t.school_name, t.school_motto, u.name as issuer_name
       FROM student_id_cards sic
       LEFT JOIN tenants t ON t.id = sic.tenant_id
       LEFT JOIN users u ON u.id = sic.issued_by
       WHERE sic.card_number=$1`, [cardNumber]
    )).rows[0];

    if (!card) {
      return res.json({
        valid: false,
        error: 'Card not found',
        card_number: cardNumber,
        checked_at: new Date().toISOString(),
      });
    }

    // Check expiry
    const isCurrentlyValid = card.status === 'active' && card.valid_until && new Date(card.valid_until) >= new Date();

    return res.json({
      valid: isCurrentlyValid,
      card_number: card.card_number,
      full_name: card.full_name,
      class: card.class,
      stream: card.stream,
      admission_no: card.admission_no,
      blood_group: card.blood_group,
      status: card.status,
      valid_from: card.valid_from,
      valid_until: card.valid_until,
      school_name: card.school_name,
      issued_by: card.issuer_name,
      checked_at: new Date().toISOString(),
    });
  }));
};
