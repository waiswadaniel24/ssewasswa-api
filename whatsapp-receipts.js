/**
 * WhatsApp Receipt Sharing Module — Multi-Tenant SaaS Platform
 * Send fee receipts, invoices, payment confirmations via WhatsApp
 * (using wa.me deep links as primary method, WhatsApp API integration ready).
 * 8 routes: dashboard, send fee receipt, send invoice, send payment confirmation,
 * bulk send, history, resend, and template management.
 *
 * Usage in server.js:
 *   const whatsappReceipts = require('./whatsapp-receipts');
 *   whatsappReceipts(app, db, pool, renderPage, esc);
 */

'use strict';

module.exports = function whatsappReceipts(app, db, pool, renderPage, esc) {

  // ── Inline fallbacks & middleware ──────────────────────────────────
  const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
  };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // ── Constants ─────────────────────────────────────────────────────
  const WA_GREEN = '#25D366';
  const WA_GREEN_DARK = '#128C7E';
  const WA_GREEN_LIGHT = '#DCF8C6';
  const WA_BG = '#ECE5DD';
  const PER_PAGE = 25;
  const VALID_TYPES = ['fee_receipt', 'invoice', 'payment_confirmation', 'report_card', 'certificate'];

  // ── Formatters ────────────────────────────────────────────────────
  const F = (n) => Number(n || 0).toLocaleString();
  const fmtMoney = (n, cur) => {
    const amt = Number(n || 0).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (cur || 'UGX') + ' ' + amt;
  };
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const ago = (d) => {
    if (!d) return '—';
    const s = Math.floor((Date.now() - new Date(d)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return new Date(d).toLocaleDateString();
  };

  // ══════════════════════════════════════════════════════════════════
  //  PHONE NUMBER VALIDATION & FORMATTING (Uganda)
  // ══════════════════════════════════════════════════════════════════

  /** Validate a phone number: 10-12 digits after stripping non-digit chars */
  function validatePhone(phone) {
    if (!phone) return { valid: false, error: 'Phone number is required' };
    const cleaned = (phone || '').replace(/[^0-9+]/g, '');
    const digits = cleaned.replace(/^\+/, '');
    if (digits.length < 9 || digits.length > 15) {
      return { valid: false, error: 'Invalid phone number length. Expected 9-15 digits.' };
    }
    // Validate starts with known Uganda prefixes
    const ugPrefixes = ['256', '07', '077', '078', '070', '075', '076', '074', '073', '020', '039', '033', '031', '041', '043', '044', '045', '046', '047', '048'];
    const startsOk = ugPrefixes.some(p => digits.startsWith(p));
    if (!startsOk && !digits.startsWith('25') && !digits.startsWith('7')) {
      return { valid: false, error: 'Phone number does not appear to be a valid Uganda number.' };
    }
    return { valid: true, cleaned };
  }

  /** Convert any Uganda phone format to international 256XXXXXXXXX */
  function normalizePhone(phone) {
    let digits = (phone || '').replace(/[^0-9]/g, '');
    if (digits.startsWith('256')) return digits;
    if (digits.startsWith('+256')) return digits.substring(1);
    if (digits.startsWith('07') && digits.length === 10) return '256' + digits.substring(1);
    if (digits.startsWith('7') && digits.length === 9) return '256' + digits;
    if (digits.startsWith('0') && digits.length === 10) return '256' + digits.substring(1);
    return digits;
  }

  // ══════════════════════════════════════════════════════════════════
  //  WHATSAPP DEEP LINK GENERATION
  // ══════════════════════════════════════════════════════════════════

  /** Generate wa.me deep link with pre-filled message */
  function generateWaLink(phone, message) {
    const normalized = normalizePhone(phone);
    const encoded = encodeURIComponent(message);
    return `https://wa.me/${normalized}?text=${encoded}`;
  }

  // ══════════════════════════════════════════════════════════════════
  //  MESSAGE TEMPLATE ENGINE
  // ══════════════════════════════════════════════════════════════════

  /** Default message templates (used when no custom templates exist) */
  const DEFAULT_TEMPLATES = {
    fee_receipt: `📋 *FEE RECEIPT*
━━━━━━━━━━━━━━━━━━━
🏫 *{{school_name}}*

*Receipt No:* {{receipt_number}}
*Date:* {{payment_date}}

*Student:* {{student_name}}
*Class:* {{class_name}}
*Admission No:* {{admission_number}}

━━━━━━━━━━━━━━━━━━━
💰 *FEE DETAILS*
*Term:* {{term}}
*Total Fees:* {{total_fees}}
*Amount Paid:* {{amount_paid}}
*Balance:* {{balance}}

━━━━━━━━━━━━━━━━━━━
💳 *PAYMENT INFO*
*Method:* {{payment_method}}
*Reference:* {{reference}}

Thank you for your payment! 🙏
Contact us: {{school_phone}} | {{school_email}}`,

    invoice: `📄 *INVOICE*
━━━━━━━━━━━━━━━━━━━
🏫 *{{school_name}}*

*Invoice No:* {{invoice_number}}
*Date:* {{invoice_date}}
*Due Date:* {{due_date}}

*Client:* {{client_name}}
*Phone:* {{client_phone}}

━━━━━━━━━━━━━━━━━━━
📝 *ITEMS*
{{items_list}}

━━━━━━━━━━━━━━━━━━━
💰 *TOTAL: {{total_amount}}*

*Balance Due:* {{balance_due}}

Please make payment before the due date.
Contact: {{school_phone}} | {{school_email}}`,

    payment_confirmation: `✅ *PAYMENT CONFIRMATION*
━━━━━━━━━━━━━━━━━━━
🏫 *{{school_name}}*

*Transaction Ref:* {{reference}}
*Date:* {{payment_date}}

*Student:* {{student_name}}
*Class:* {{class_name}}

━━━━━━━━━━━━━━━━━━━
💰 *PAYMENT DETAILS*
*Amount:* {{amount_paid}}
*Method:* {{payment_method}}
*For:* {{term}} Fees

*Previous Balance:* {{previous_balance}}
*New Balance:* {{new_balance}}

━━━━━━━━━━━━━━━━━━━
This serves as your official payment confirmation.
For queries, contact: {{school_phone}}
Thank you! 🙏`,

    report_card: `📊 *REPORT CARD*
━━━━━━━━━━━━━━━━━━━
🏫 *{{school_name}}*

*Student:* {{student_name}}
*Class:* {{class_name}}
*Term:* {{term}}
*Year:* {{year}}

━━━━━━━━━━━━━━━━━━━
📋 *PERFORMANCE SUMMARY*
{{subjects_summary}}

*Total Marks:* {{total_marks}}/{{max_marks}}
*Average:* {{average}}
*Grade:* {{grade}}
*Position:* {{position}} of {{total_students}}

━━━━━━━━━━━━━━━━━━━
*Teacher's Comment:* {{comment}}

*Principal:* {{principal_name}}
Sign & return acknowledgment.
Contact: {{school_phone}}`,

    certificate: `🎓 *CERTIFICATE*
━━━━━━━━━━━━━━━━━━━
🏫 *{{school_name}}*

This is to certify that

*{{student_name}}*
Admission No: {{admission_number}}

has successfully completed the
*{{course_name}}* program.

━━━━━━━━━━━━━━━━━━━
*Grade/Division:* {{grade}}
*Year:* {{year}}

Awarded on *{{award_date}}*

*Principal:* {{principal_name}}
*Verification Code:* {{verification_code}}

Contact: {{school_phone}}`
  };

  /** Render a message template by substituting variables */
  function renderTemplate(template, vars) {
    let msg = template || '';
    for (const [key, val] of Object.entries(vars || {})) {
      msg = msg.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), String(val ?? 'N/A'));
    }
    return msg;
  }

  // ══════════════════════════════════════════════════════════════════
  //  CSS STYLES (WhatsApp green theme)
  // ══════════════════════════════════════════════════════════════════

  const WA_CSS = `<style>
    .wa-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
    .wa-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#374151;background:#f3f4f6;transition:.15s;border:1px solid #e5e7eb}
    .wa-nav a:hover{background:#e5e7eb;border-color:#d1d5db}
    .wa-nav a.active{background:${WA_GREEN};color:#fff;border-color:${WA_GREEN_DARK}}
    .wa-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px;margin-bottom:20px}
    .wa-stat{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:18px;text-align:center;transition:box-shadow .2s}
    .wa-stat:hover{box-shadow:0 4px 12px rgba(0,0,0,.06)}
    .wa-stat-icon{font-size:28px;margin-bottom:6px}
    .wa-stat-num{font-size:26px;font-weight:800;color:#1f2937}
    .wa-stat-lbl{font-size:12px;color:#6b7280;margin-top:4px}
    .wa-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:22px;margin-bottom:18px;transition:box-shadow .15s}
    .wa-card:hover{box-shadow:0 2px 10px rgba(0,0,0,.04)}
    .wa-card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
    .wa-card-header h3{margin:0;font-size:16px;color:#1f2937}
    .wa-table{width:100%;border-collapse:collapse;font-size:13px}
    .wa-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e5e7eb;color:#6b7280;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f9fafb;white-space:nowrap}
    .wa-table td{padding:10px 14px;border-bottom:1px solid #f3f4f6;color:#1f2937}
    .wa-table tr:hover{background:#f9fafb}
    .wa-badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700}
    .wa-badge-sent{background:#dcfce7;color:#16a34a}
    .wa-badge-delivered{background:#dbeafe;color:#2563eb}
    .wa-badge-read{background:#ede9fe;color:#7c3aed}
    .wa-badge-failed{background:#fee2e2;color:#dc2626}
    .wa-badge-pending{background:#fef9c3;color:#a16207}
    .wa-badge-wa{background:${WA_GREEN_LIGHT};color:${WA_GREEN_DARK}}
    .wa-badge-api{background:#dbeafe;color:#2563eb}
    .wa-badge-sms{background:#fef3c7;color:#d97706}
    .wa-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .wa-form-grid .full{grid-column:1/-1}
    .wa-input{width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;box-sizing:border-box;outline:none;transition:border-color .15s}
    .wa-input:focus{border-color:${WA_GREEN};box-shadow:0 0 0 3px rgba(37,211,102,.12)}
    .wa-textarea{width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;box-sizing:border-box;outline:none;resize:vertical;min-height:100px;font-family:monospace;transition:border-color .15s}
    .wa-textarea:focus{border-color:${WA_GREEN};box-shadow:0 0 0 3px rgba(37,211,102,.12)}
    .wa-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .wa-btn:hover{opacity:.9;transform:translateY(-1px)}
    .wa-btn-primary{background:${WA_GREEN};color:#fff}
    .wa-btn-secondary{background:#f3f4f6;color:#374151;border:1px solid #e5e7eb}
    .wa-btn-danger{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}
    .wa-btn-sm{padding:6px 14px;font-size:12px;border-radius:8px}
    .wa-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .wa-filter label{display:block;font-size:12px;font-weight:600;color:#6b7280;margin-bottom:4px}
    .wa-filter input,.wa-filter select{padding:9px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:13px;background:#fff}
    .wa-filter input:focus,.wa-filter select:focus{outline:none;border-color:${WA_GREEN}}
    .wa-preview{background:#f0fdf4;border:2px solid #bbf7d0;border-radius:12px;padding:16px;white-space:pre-wrap;font-size:14px;line-height:1.6;color:#1f2937;max-height:400px;overflow-y:auto;font-family:monospace}
    .wa-phone-input{display:flex;gap:8px;align-items:center}
    .wa-phone-prefix{padding:10px 14px;background:#f3f4f6;border:2px solid #e5e7eb;border-radius:10px 0 0 10px;font-size:14px;font-weight:600;color:#6b7280;white-space:nowrap}
    .wa-phone-input .wa-input{border-radius:0 10px 10px 0}
    .wa-quick-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
    .wa-type-card{border:2px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center;cursor:pointer;transition:.2s;min-width:140px}
    .wa-type-card:hover{border-color:${WA_GREEN};box-shadow:0 4px 12px rgba(37,211,102,.1)}
    .wa-type-card.selected{border-color:${WA_GREEN};background:#f0fdf4}
    .wa-type-card-icon{font-size:28px;margin-bottom:6px}
    .wa-type-card-name{font-size:13px;font-weight:700;color:#1f2937}
    .wa-bulk-progress{background:#f3f4f6;border-radius:10px;overflow:hidden;height:10px;margin:10px 0}
    .wa-bulk-fill{height:100%;background:${WA_GREEN};border-radius:10px;transition:width .3s}
    .wa-template-card{border:1px solid #e5e7eb;border-radius:12px;padding:18px;background:#fff;transition:box-shadow .15s}
    .wa-template-card:hover{box-shadow:0 2px 10px rgba(0,0,0,.05)}
    .wa-chip{display:inline-block;background:#eff6ff;color:#1e40af;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;margin:2px}
    .wa-tip{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 16px;font-size:13px;color:#92400e;margin-top:10px}
    .wa-tip strong{color:#78350f}
    .wa-flash{background:#f0fdf4;border:1px solid #bbf7d0;color:#16a34a;padding:10px 16px;border-radius:10px;margin-bottom:14px;font-size:14px}
    .wa-flash-error{background:#fef2f2;border:1px solid #fecaca;color:#dc2626;padding:10px 16px;border-radius:10px;margin-bottom:14px;font-size:14px}
    .wa-empty{text-align:center;padding:50px 20px;color:#9ca3af}
    .wa-empty-icon{font-size:48px;margin-bottom:12px;opacity:.5}
    .wa-pagination{display:flex;gap:6px;justify-content:center;margin-top:16px}
    .wa-pagination a,.wa-pagination span{padding:8px 14px;border-radius:8px;font-size:13px;text-decoration:none;color:#374151;background:#f3f4f6}
    .wa-pagination a:hover{background:#e5e7eb}
    .wa-pagination span.current{background:${WA_GREEN};color:#fff}
    .wa-bar-chart{display:flex;flex-direction:column;gap:6px}
    .wa-bar-row{display:flex;align-items:center;gap:10px}
    .wa-bar-label{min-width:120px;font-size:13px;text-align:right;color:#6b7280}
    .wa-bar-track{flex:1;height:22px;background:#f3f4f6;border-radius:4px;overflow:hidden}
    .wa-bar-fill{height:100%;border-radius:4px;transition:width .3s}
    .wa-bar-val{min-width:50px;font-size:13px;font-weight:700;text-align:right}
    @media(max-width:768px){
      .wa-stats{grid-template-columns:1fr 1fr}
      .wa-form-grid{grid-template-columns:1fr}
      .wa-quick-actions{flex-direction:column}
      .wa-filter{flex-direction:column}
      .wa-type-card{min-width:auto}
    }
    @media print{.wa-no-print{display:none!important}}
  </style>`;

  // ══════════════════════════════════════════════════════════════════
  //  UI HELPERS
  // ══════════════════════════════════════════════════════════════════

  /** Navigation bar with active state */
  function nav(active) {
    const links = [
      ['/whatsapp-receipts', 'Dashboard', '📊'],
      ['/whatsapp-receipts/send-fee-receipt', 'Fee Receipt', '📋'],
      ['/whatsapp-receipts/send-invoice', 'Invoice', '📄'],
      ['/whatsapp-receipts/send-payment-confirmation', 'Payment', '✅'],
      ['/whatsapp-receipts/bulk-send', 'Bulk Send', '📨'],
      ['/whatsapp-receipts/history', 'History', '📜'],
      ['/whatsapp-receipts/templates', 'Templates', '📝'],
    ];
    return '<nav class="wa-nav">' +
      links.map(([href, label, icon]) =>
        `<a href="${href}" class="${active === href ? 'active' : ''}">${icon} ${label}</a>`
      ).join('') + '</nav>';
  }

  /** Status badge for receipt log */
  function statusBadge(status) {
    const m = {
      sent: 'wa-badge wa-badge-sent',
      delivered: 'wa-badge wa-badge-delivered',
      read: 'wa-badge wa-badge-read',
      failed: 'wa-badge wa-badge-failed',
      pending: 'wa-badge wa-badge-pending',
    };
    return `<span class="${m[status] || 'wa-badge'}">${esc(status || 'pending')}</span>`;
  }

  /** Delivery method badge */
  function methodBadge(method) {
    const m = {
      wa_link: 'wa-badge wa-badge-wa',
      wa_api: 'wa-badge wa-badge-api',
      sms_fallback: 'wa-badge wa-badge-sms',
    };
    const labels = { wa_link: 'wa.me Link', wa_api: 'WhatsApp API', sms_fallback: 'SMS Fallback' };
    return `<span class="${m[method] || 'wa-badge'}">${esc(labels[method] || method || 'wa.me Link')}</span>`;
  }

  /** Receipt type icon */
  function typeIcon(type) {
    const m = { fee_receipt: '📋', invoice: '📄', payment_confirmation: '✅', report_card: '📊', certificate: '🎓' };
    return m[type] || '📨';
  }

  /** Receipt type label */
  function typeLabel(type) {
    const m = { fee_receipt: 'Fee Receipt', invoice: 'Invoice', payment_confirmation: 'Payment Confirmation', report_card: 'Report Card', certificate: 'Certificate' };
    return m[type] || type;
  }

  /** Pagination HTML */
  function paginationHTML(currentPage, totalPages, baseUrl) {
    if (totalPages <= 1) return '';
    let html = '<div class="wa-pagination">';
    if (currentPage > 1) html += `<a href="${baseUrl}?page=${currentPage - 1}">&laquo; Prev</a>`;
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);
    for (let i = start; i <= end; i++) {
      html += i === currentPage
        ? `<span class="current">${i}</span>`
        : `<a href="${baseUrl}?page=${i}">${i}</a>`;
    }
    if (currentPage < totalPages) html += `<a href="${baseUrl}?page=${currentPage + 1}">Next &raquo;</a>`;
    html += '</div>';
    return html;
  }

  /** Flash message */
  function flash(req) {
    const f = req.session.flash;
    delete req.session.flash;
    if (!f) return '';
    const cls = f.type === 'error' ? 'wa-flash-error' : 'wa-flash';
    return `<div class="${cls}">${esc(f.msg)}</div>`;
  }

  /** Simple HTML bar chart */
  function barChart(data, color) {
    if (!data || !data.length) return '<p class="muted" style="text-align:center;padding:20px">No data</p>';
    const mx = Math.max(...data.map(d => d.value), 1);
    return '<div class="wa-bar-chart">' +
      data.map(d => {
        const pct = Math.round((d.value / mx) * 100);
        return `<div class="wa-bar-row">
          <span class="wa-bar-label">${esc(d.label)}</span>
          <div class="wa-bar-track"><div class="wa-bar-fill" style="width:${pct}%;background:${color || WA_GREEN}"></div></div>
          <span class="wa-bar-val">${F(d.value)}</span>
        </div>`;
      }).join('') + '</div>';
  }

  // ══════════════════════════════════════════════════════════════════
  //  DATABASE MIGRATIONS (async IIFE at module load)
  // ══════════════════════════════════════════════════════════════════
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[WhatsAppReceipts] Cannot connect to DB'); return; }
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS whatsapp_receipt_log (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        recipient_phone VARCHAR(20) NOT NULL,
        recipient_name VARCHAR(255),
        receipt_type VARCHAR(50),
        entity_id INTEGER,
        message_text TEXT,
        delivery_method VARCHAR(20) DEFAULT 'wa_link',
        status VARCHAR(20) DEFAULT 'pending',
        sent_by INTEGER REFERENCES users(id),
        sent_at TIMESTAMPTZ DEFAULT NOW(),
        error_message TEXT
      );`);

      await c.query(`CREATE TABLE IF NOT EXISTS whatsapp_templates (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        receipt_type VARCHAR(50) NOT NULL,
        template_name VARCHAR(255) NOT NULL,
        template_content TEXT NOT NULL,
        variables TEXT[],
        is_default BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );`);

      // ALTER TABLE IF NOT EXISTS for safe re-deploys — whatsapp_receipt_log
      const logCols = [
        'tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE',
        'recipient_phone VARCHAR(20) NOT NULL',
        'recipient_name VARCHAR(255)',
        'receipt_type VARCHAR(50)',
        'entity_id INTEGER',
        'message_text TEXT',
        'delivery_method VARCHAR(20) DEFAULT \'wa_link\'',
        'status VARCHAR(20) DEFAULT \'pending\'',
        'sent_by INTEGER REFERENCES users(id)',
        'sent_at TIMESTAMPTZ DEFAULT NOW()',
        'error_message TEXT',
      ];
      for (const col of logCols) {
        await c.query(`ALTER TABLE whatsapp_receipt_log ADD COLUMN IF NOT EXISTS ${col};`).catch(() => {});
      }

      // ALTER TABLE IF NOT EXISTS — whatsapp_templates
      const tmplCols = [
        'tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE',
        'receipt_type VARCHAR(50) NOT NULL',
        'template_name VARCHAR(255) NOT NULL',
        'template_content TEXT NOT NULL',
        'variables TEXT[]',
        'is_default BOOLEAN DEFAULT false',
        'is_active BOOLEAN DEFAULT true',
        'created_by INTEGER REFERENCES users(id)',
        'created_at TIMESTAMPTZ DEFAULT NOW()',
        'updated_at TIMESTAMPTZ DEFAULT NOW()',
      ];
      for (const col of tmplCols) {
        await c.query(`ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS ${col};`).catch(() => {});
      }

      // Indexes
      for (const sql of [
        'CREATE INDEX IF NOT EXISTS idx_wa_log_tid ON whatsapp_receipt_log(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_wa_log_tid_type ON whatsapp_receipt_log(tenant_id, receipt_type);',
        'CREATE INDEX IF NOT EXISTS idx_wa_log_tid_status ON whatsapp_receipt_log(tenant_id, status);',
        'CREATE INDEX IF NOT EXISTS idx_wa_log_sent_at ON whatsapp_receipt_log(tenant_id, sent_at DESC);',
        'CREATE INDEX IF NOT EXISTS idx_wa_tmpl_tid ON whatsapp_templates(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_wa_tmpl_tid_type ON whatsapp_templates(tenant_id, receipt_type);',
        'CREATE INDEX IF NOT EXISTS idx_wa_tmpl_active ON whatsapp_templates(tenant_id, is_active);',
      ]) {
        await c.query(sql).catch(() => {});
      }

      // Seed default templates for tenant_id 0 (system defaults)
      // Wrapped in try/catch because tenant_id=0 may not exist in tenants table
      try {
        for (const [type, content] of Object.entries(DEFAULT_TEMPLATES)) {
          const vars = [...content.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i);
          await c.query(`
            INSERT INTO whatsapp_templates (tenant_id, receipt_type, template_name, template_content, variables, is_default)
            VALUES (0, $1, $2, $3, $4, true)
            ON CONFLICT DO NOTHING;
          `, [type, typeLabel(type) + ' - Default', content, vars]);
        }
      } catch (seedErr) {
        console.warn('[WhatsAppReceipts] Seed skipped (tenant_id=0 may not exist):', seedErr.message);
      }

      console.log('[WhatsAppReceipts] Migrations applied successfully');
    } catch (e) {
      console.error('[WhatsAppReceipts] Migration error:', e.message);
    } finally {
      c.release();
    }
  })();

  // ══════════════════════════════════════════════════════════════════
  //  INTERNAL: GET TEMPLATE FOR TENANT
  // ══════════════════════════════════════════════════════════════════
  async function getTemplate(tid, receiptType) {
    const { rows } = await pool.query(
      `SELECT * FROM whatsapp_templates
       WHERE tenant_id IN ($1, 0) AND receipt_type = $2 AND is_active = true
       ORDER BY tenant_id DESC, is_default DESC
       LIMIT 1`,
      [tid, receiptType]
    );
    return rows[0] || null;
  }

  /** Log a WhatsApp receipt send attempt */
  async function logSend(tid, data) {
    const { rows } = await pool.query(
      `INSERT INTO whatsapp_receipt_log (tenant_id, recipient_phone, recipient_name, receipt_type, entity_id, message_text, delivery_method, status, sent_by, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [tid, data.phone, data.name, data.receiptType, data.entityId, data.messageText, data.method || 'wa_link', data.status || 'sent', data.sentBy, data.errorMessage || null]
    );
    return rows[0];
  }

  // ══════════════════════════════════════════════════════════════════
  //  ROUTE 1: GET /whatsapp-receipts — Dashboard
  // ══════════════════════════════════════════════════════════════════
  app.get('/whatsapp-receipts', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;

    // Aggregate stats
    const stats = (await pool.query(`
      SELECT
        COUNT(*)::int AS total_sent,
        COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
        COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
        COUNT(*) FILTER (WHERE status = 'read')::int AS read_count,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE sent_at >= date_trunc('day', NOW()))::int AS today,
        COUNT(*) FILTER (WHERE sent_at >= date_trunc('week', NOW()))::int AS this_week
      FROM whatsapp_receipt_log WHERE tenant_id = $1
    `, [tid])).rows[0];

    // By type breakdown for chart
    const byType = (await pool.query(`
      SELECT receipt_type, COUNT(*)::int AS cnt
      FROM whatsapp_receipt_log WHERE tenant_id = $1
      GROUP BY receipt_type ORDER BY cnt DESC
    `, [tid])).rows;

    // By method breakdown
    const byMethod = (await pool.query(`
      SELECT delivery_method, COUNT(*)::int AS cnt
      FROM whatsapp_receipt_log WHERE tenant_id = $1
      GROUP BY delivery_method ORDER BY cnt DESC
    `, [tid])).rows;

    // Daily sends this month (last 14 days)
    const dailySends = (await pool.query(`
      SELECT DATE(sent_at) AS day, COUNT(*)::int AS cnt
      FROM whatsapp_receipt_log
      WHERE tenant_id = $1 AND sent_at >= NOW() - INTERVAL '14 days'
      GROUP BY DATE(sent_at) ORDER BY day DESC
    `, [tid])).rows;

    // Recent 10 sends
    const recent = (await pool.query(`
      SELECT wrl.*, u.first_name AS sender_first, u.last_name AS sender_last
      FROM whatsapp_receipt_log wrl
      LEFT JOIN users u ON u.id = wrl.sent_by
      WHERE wrl.tenant_id = $1
      ORDER BY wrl.sent_at DESC LIMIT 10
    `, [tid])).rows;

    const successRate = (stats.total_sent > 0)
      ? (((stats.sent + stats.delivered + stats.read_count) / stats.total_sent) * 100).toFixed(1)
      : '0.0';

    const typeChartData = VALID_TYPES.map(t => ({
      label: typeLabel(t),
      value: byType.find(r => r.receipt_type === t)?.cnt || 0,
    }));

    const methodChartData = ['wa_link', 'wa_api', 'sms_fallback'].map(m => ({
      label: { wa_link: 'wa.me Link', wa_api: 'WhatsApp API', sms_fallback: 'SMS' }[m],
      value: byMethod.find(r => r.delivery_method === m)?.cnt || 0,
    }));

    const recentRows = recent.length === 0
      ? `<tr><td colspan="7" class="wa-empty" style="padding:40px">
           <div class="wa-empty-icon">📱</div>
           <p style="margin:0">No receipts sent yet</p>
           <a href="/whatsapp-receipts/send-fee-receipt" class="wa-btn wa-btn-primary" style="margin-top:12px">Send First Receipt</a>
         </td></tr>`
      : recent.map(r => `<tr>
          <td>${typeIcon(r.receipt_type)} ${esc(typeLabel(r.receipt_type))}</td>
          <td style="font-weight:600">${esc(r.recipient_name || '—')}</td>
          <td style="font-family:monospace;font-size:12px">${esc(r.recipient_phone)}</td>
          <td>${statusBadge(r.status)}</td>
          <td>${methodBadge(r.delivery_method)}</td>
          <td class="muted" style="font-size:12px">${ago(r.sent_at)}</td>
          <td>
            <button onclick="previewMsg(${r.id})" class="wa-btn wa-btn-secondary wa-btn-sm" title="Preview">👁</button>
            ${r.status === 'failed' ? `<a href="/whatsapp-receipts/resend/${r.id}" class="wa-btn wa-btn-primary wa-btn-sm" title="Resend">🔄</a>` : ''}
          </td>
        </tr>`).join('');

    const quickActions = [
      { href: '/whatsapp-receipts/send-fee-receipt', icon: '📋', label: 'Send Fee Receipt', color: WA_GREEN },
      { href: '/whatsapp-receipts/send-invoice', icon: '📄', label: 'Send Invoice', color: '#3b82f6' },
      { href: '/whatsapp-receipts/send-payment-confirmation', icon: '✅', label: 'Payment Confirmation', color: '#8b5cf6' },
      { href: '/whatsapp-receipts/bulk-send', icon: '📨', label: 'Bulk Send', color: '#f59e0b' },
      { href: '/whatsapp-receipts/history', icon: '📜', label: 'View History', color: '#6b7280' },
      { href: '/whatsapp-receipts/templates', icon: '📝', label: 'Manage Templates', color: '#06b6d4' },
    ];

    const html = WA_CSS + nav('/whatsapp-receipts') + flash(req) + `
      <div style="max-width:1200px;margin:0 auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
          <div>
            <h1 style="font-size:24px;color:#1f2937;margin:0">📱 WhatsApp Receipts</h1>
            <p style="font-size:13px;color:#6b7280;margin-top:2px">Send fee receipts, invoices, and payment confirmations via WhatsApp</p>
          </div>
          <div style="display:flex;gap:8px">
            <a href="/whatsapp-receipts/bulk-send" class="wa-btn wa-btn-primary">📨 Bulk Send</a>
            <a href="/whatsapp-receipts/templates" class="wa-btn wa-btn-secondary">📝 Templates</a>
          </div>
        </div>

        <!-- Stats -->
        <div class="wa-stats">
          <div class="wa-stat"><div class="wa-stat-icon">📤</div><div class="wa-stat-num" style="color:${WA_GREEN}">${F(stats.total_sent)}</div><div class="wa-stat-lbl">Total Sent</div></div>
          <div class="wa-stat"><div class="wa-stat-icon">✅</div><div class="wa-stat-num" style="color:#16a34a">${F(stats.sent)}</div><div class="wa-stat-lbl">Sent (wa.me)</div></div>
          <div class="wa-stat"><div class="wa-stat-icon">📥</div><div class="wa-stat-num" style="color:#2563eb">${F(stats.delivered)}</div><div class="wa-stat-lbl">Delivered</div></div>
          <div class="wa-stat"><div class="wa-stat-icon">👁</div><div class="wa-stat-num" style="color:#7c3aed">${F(stats.read_count)}</div><div class="wa-stat-lbl">Read</div></div>
          <div class="wa-stat"><div class="wa-stat-icon">❌</div><div class="wa-stat-num" style="color:#dc2626">${F(stats.failed)}</div><div class="wa-stat-lbl">Failed</div></div>
          <div class="wa-stat"><div class="wa-stat-icon">📈</div><div class="wa-stat-num" style="color:#f59e0b">${successRate}%</div><div class="wa-stat-lbl">Success Rate</div></div>
          <div class="wa-stat"><div class="wa-stat-icon">📅</div><div class="wa-stat-num" style="color:#3b82f6">${F(stats.today)}</div><div class="wa-stat-lbl">Today</div></div>
          <div class="wa-stat"><div class="wa-stat-icon">📆</div><div class="wa-stat-num" style="color:#8b5cf6">${F(stats.this_week)}</div><div class="wa-stat-lbl">This Week</div></div>
        </div>

        <!-- Quick Actions -->
        <div class="wa-quick-actions">
          ${quickActions.map(a => `<a href="${a.href}" class="wa-type-card" style="border-color:${a.color}20;text-decoration:none;color:inherit">
            <div class="wa-type-card-icon">${a.icon}</div>
            <div class="wa-type-card-name">${a.label}</div>
          </a>`).join('')}
        </div>

        <!-- Charts Row -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px">
          <div class="wa-card">
            <div class="wa-card-header"><h3>📊 Sends by Type</h3></div>
            ${barChart(typeChartData, WA_GREEN)}
          </div>
          <div class="wa-card">
            <div class="wa-card-header"><h3>📶 Delivery Method</h3></div>
            ${barChart(methodChartData, '#3b82f6')}
          </div>
        </div>

        <!-- Recent Sends -->
        <div class="wa-card">
          <div class="wa-card-header">
            <h3>📜 Recent Sends</h3>
            <a href="/whatsapp-receipts/history" style="font-size:13px;color:${WA_GREEN};text-decoration:none;font-weight:600">View All &rarr;</a>
          </div>
          <div style="overflow-x:auto">
            <table class="wa-table">
              <thead><tr><th>Type</th><th>Recipient</th><th>Phone</th><th>Status</th><th>Method</th><th>Sent</th><th></th></tr></thead>
              <tbody>${recentRows}</tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Preview Modal -->
      <div id="previewModal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:9999;align-items:center;justify-content:center">
        <div style="background:#fff;border-radius:16px;max-width:500px;width:90%;max-height:80vh;overflow:hidden;display:flex;flex-direction:column">
          <div style="padding:16px 20px;background:${WA_GREEN};color:#fff;display:flex;justify-content:space-between;align-items:center">
            <strong style="font-size:16px">📱 Message Preview</strong>
            <button onclick="document.getElementById('previewModal').style.display='none'" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer">&times;</button>
          </div>
          <div style="padding:20px;overflow-y:auto">
            <div id="previewContent" class="wa-preview" style="max-height:50vh"></div>
          </div>
        </div>
      </div>

      <script>
      function previewMsg(id){
        fetch('/whatsapp-receipts/history/message/'+id).then(r=>r.json()).then(d=>{
          if(d.message){document.getElementById('previewContent').textContent=d.message;document.getElementById('previewModal').style.display='flex'}
        }).catch(()=>{});
      }
      document.getElementById('previewModal').addEventListener('click',function(e){if(e.target===this)this.style.display='none'});
      </script>`;

    res.send(renderPage('WhatsApp Receipts Dashboard', html, req.session.user, req));
  }));

  // ══════════════════════════════════════════════════════════════════
  //  ROUTE 2: POST /whatsapp-receipts/send-fee-receipt — Send Fee Receipt
  // ══════════════════════════════════════════════════════════════════
  app.post('/whatsapp-receipts/send-fee-receipt', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { recipient_phone, recipient_name, student_name, class_name, admission_number,
      receipt_number, term, total_fees, amount_paid, balance,
      payment_date, payment_method, payment_reference, school_name,
      school_phone, school_email, delivery_method, test_mode } = req.body;

    // Validate phone
    const phoneCheck = validatePhone(recipient_phone);
    if (!phoneCheck.valid) {
      req.session.flash = { msg: phoneCheck.error, type: 'error' };
      return res.redirect('/whatsapp-receipts/send-fee-receipt');
    }

    const phone = normalizePhone(recipient_phone);
    const method = delivery_method === 'wa_api' ? 'wa_api' : 'wa_link';

    // Get template
    const tmpl = await getTemplate(tid, 'fee_receipt');
    const templateContent = tmpl ? tmpl.template_content : DEFAULT_TEMPLATES.fee_receipt;

    const vars = {
      school_name: school_name || req.session.user.tenant_name || 'Our School',
      receipt_number: receipt_number || 'RCT-' + Date.now().toString(36).toUpperCase(),
      payment_date: payment_date || fmtDate(new Date()),
      student_name: student_name || recipient_name || 'N/A',
      class_name: class_name || 'N/A',
      admission_number: admission_number || 'N/A',
      term: term || 'Term 1',
      total_fees: fmtMoney(total_fees),
      amount_paid: fmtMoney(amount_paid),
      balance: fmtMoney(balance || (Number(total_fees || 0) - Number(amount_paid || 0))),
      payment_method: payment_method || 'Cash',
      reference: payment_reference || 'N/A',
      school_phone: school_phone || '',
      school_email: school_email || '',
    };

    const messageText = renderTemplate(templateContent, vars);

    // Test mode — return preview
    if (test_mode === 'on') {
      const waLink = generateWaLink(phone, messageText);
      return res.send(renderPage('Preview Fee Receipt', WA_CSS + nav('/whatsapp-receipts/send-fee-receipt') + `
        <div style="max-width:700px;margin:0 auto">
          <a href="/whatsapp-receipts/send-fee-receipt" style="color:#6b7280;text-decoration:none;font-size:14px">&larr; Back to Form</a>
          <div class="wa-card" style="margin-top:14px">
            <div class="wa-card-header"><h3>📱 Message Preview</h3><span class="wa-badge wa-badge-wa">Test Mode</span></div>
            <div class="wa-preview">${esc(messageText)}</div>
          </div>
          <div class="wa-card">
            <div class="wa-card-header"><h3>Target</h3></div>
            <p style="margin:0"><strong>Phone:</strong> <code>${esc(phone)}</code> &nbsp; <strong>Name:</strong> ${esc(recipient_name || '—')}</p>
          </div>
          <div class="wa-card">
            <div class="wa-card-header"><h3>WhatsApp Link</h3></div>
            <p style="margin:0;font-size:12px;word-break:break-all;color:#6b7280">${esc(waLink)}</p>
          </div>
          <div style="margin-top:14px;display:flex;gap:10px">
            <a href="${esc(waLink)}" target="_blank" rel="noopener" class="wa-btn wa-btn-primary">📱 Open in WhatsApp</a>
            <a href="/whatsapp-receipts/send-fee-receipt" class="wa-btn wa-btn-secondary">&larr; Edit & Send</a>
          </div>
        </div>`, req.session.user, req));
    }

    // Log the send
    await logSend(tid, {
      phone, name: recipient_name, receiptType: 'fee_receipt', entityId: null,
      messageText, method, status: 'sent', sentBy: uid,
    });

    // Generate wa.me link for redirect
    const waLink = generateWaLink(phone, messageText);
    req.session.flash = { msg: `Fee receipt sent to ${esc(recipient_name || phone)} successfully!` };

    // Redirect to wa.me link (opens WhatsApp with pre-filled message)
    res.redirect(waLink);
  }));

  // Also serve GET form for fee receipt
  app.get('/whatsapp-receipts/send-fee-receipt', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const tmpl = await getTemplate(tid, 'fee_receipt');
    const vars = tmpl ? (tmpl.variables || []) : Object.keys(DEFAULT_TEMPLATES.fee_receipt.match(/\{\{(\w+)\}\}/g).map(m => m.replace(/[{}]/g, '')));

    const html = WA_CSS + nav('/whatsapp-receipts/send-fee-receipt') + flash(req) + `
      <div style="max-width:900px;margin:0 auto">
        <a href="/whatsapp-receipts" style="color:#6b7280;text-decoration:none;font-size:14px">&larr; Dashboard</a>
        <h2 style="margin:8px 0 4px">📋 Send Fee Receipt</h2>
        <p class="muted" style="margin-bottom:18px">Send a fee payment receipt to a parent or guardian via WhatsApp</p>

        <form method="POST" action="/whatsapp-receipts/send-fee-receipt" style="display:grid;gap:16px">
          <!-- Recipient Info -->
          <div class="wa-card">
            <div class="wa-card-header"><h3>📱 Recipient</h3></div>
            <div class="wa-form-grid">
              <div>
                <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Phone Number *</label>
                <div class="wa-phone-input">
                  <span class="wa-phone-prefix">+256</span>
                  <input type="tel" name="recipient_phone" required placeholder="7XX XXX XXX" class="wa-input" style="flex:1">
                </div>
              </div>
              <div>
                <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Recipient Name</label>
                <input type="text" name="recipient_name" placeholder="Parent/Guardian Name" class="wa-input">
              </div>
            </div>
          </div>

          <!-- Student Info -->
          <div class="wa-card">
            <div class="wa-card-header"><h3>🎓 Student Details</h3></div>
            <div class="wa-form-grid">
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Student Name *</label><input type="text" name="student_name" required placeholder="John Mukasa" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Class</label><input type="text" name="class_name" placeholder="P.5A" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Admission Number</label><input type="text" name="admission_number" placeholder="ADM/2024/001" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Term</label>
                <select name="term" class="wa-input">
                  <option value="Term 1">Term 1</option><option value="Term 2">Term 2</option><option value="Term 3">Term 3</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Fee Details -->
          <div class="wa-card">
            <div class="wa-card-header"><h3>💰 Fee Details</h3></div>
            <div class="wa-form-grid">
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Total Fees (UGX)</label><input type="number" name="total_fees" placeholder="1500000" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Amount Paid (UGX) *</label><input type="number" name="amount_paid" required placeholder="500000" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Receipt Number</label><input type="text" name="receipt_number" placeholder="Auto-generated" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Payment Date</label><input type="date" name="payment_date" value="${new Date().toISOString().split('T')[0]}" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Payment Method</label>
                <select name="payment_method" class="wa-input">
                  <option value="Cash">Cash</option><option value="MTN MoMo">MTN MoMo</option><option value="Airtel Money">Airtel Money</option><option value="Bank Transfer">Bank Transfer</option><option value="Cheque">Cheque</option><option value="Card">Card</option>
                </select>
              </div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Reference Number</label><input type="text" name="payment_reference" placeholder="Transaction reference" class="wa-input"></div>
            </div>
          </div>

          <!-- School Info -->
          <div class="wa-card">
            <div class="wa-card-header"><h3>🏫 School Info</h3></div>
            <div class="wa-form-grid">
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">School Name</label><input type="text" name="school_name" placeholder="${esc(req.session.user.tenant_name || 'School Name')}" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">School Phone</label><input type="tel" name="school_phone" placeholder="+256 XXX XXX XXX" class="wa-input"></div>
              <div class="full"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">School Email</label><input type="email" name="school_email" placeholder="info@school.ac.ug" class="wa-input"></div>
            </div>
          </div>

          <!-- Options -->
          <div class="wa-card">
            <div class="wa-card-header"><h3>⚙️ Options</h3></div>
            <div style="display:flex;gap:20px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" name="test_mode" style="width:18px;height:18px;accent-color:${WA_GREEN}">
                <span style="font-size:14px;color:#374151">Test mode (preview only, don't send)</span>
              </label>
              <div>
                <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Delivery Method</label>
                <select name="delivery_method" class="wa-input" style="width:auto">
                  <option value="wa_link">wa.me Link (Open WhatsApp)</option>
                  <option value="wa_api">WhatsApp API (if configured)</option>
                </select>
              </div>
            </div>
          </div>

          <div style="display:flex;gap:10px">
            <button type="submit" class="wa-btn wa-btn-primary" style="padding:14px 32px;font-size:16px">📱 Send Receipt</button>
            <button type="submit" class="wa-btn wa-btn-secondary" style="padding:14px 32px" onclick="document.querySelector('input[name=test_mode]').checked=true;this.form.submit()">👁 Test / Preview</button>
            <a href="/whatsapp-receipts" class="wa-btn wa-btn-secondary" style="padding:14px 20px">Cancel</a>
          </div>
        </form>
      </div>`;

    res.send(renderPage('Send Fee Receipt', html, req.session.user, req));
  }));

  // ══════════════════════════════════════════════════════════════════
  //  ROUTE 3: POST /whatsapp-receipts/send-invoice — Send Invoice
  // ══════════════════════════════════════════════════════════════════
  app.post('/whatsapp-receipts/send-invoice', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { recipient_phone, recipient_name, client_name, invoice_number,
      invoice_date, due_date, items_list, total_amount, balance_due,
      school_name, school_phone, school_email, delivery_method, test_mode } = req.body;

    const phoneCheck = validatePhone(recipient_phone);
    if (!phoneCheck.valid) {
      req.session.flash = { msg: phoneCheck.error, type: 'error' };
      return res.redirect('/whatsapp-receipts/send-invoice');
    }

    const phone = normalizePhone(recipient_phone);
    const method = delivery_method === 'wa_api' ? 'wa_api' : 'wa_link';

    const tmpl = await getTemplate(tid, 'invoice');
    const templateContent = tmpl ? tmpl.template_content : DEFAULT_TEMPLATES.invoice;

    const vars = {
      school_name: school_name || req.session.user.tenant_name || 'Our School',
      invoice_number: invoice_number || 'INV-' + Date.now().toString(36).toUpperCase(),
      invoice_date: invoice_date || fmtDate(new Date()),
      due_date: due_date || fmtDate(new Date(Date.now() + 30 * 86400000)),
      client_name: client_name || recipient_name || 'N/A',
      client_phone: phone,
      items_list: (items_list || 'Item 1 — UGX 500,000\nItem 2 — UGX 300,000'),
      total_amount: fmtMoney(total_amount),
      balance_due: fmtMoney(balance_due || total_amount),
      school_phone: school_phone || '',
      school_email: school_email || '',
    };

    const messageText = renderTemplate(templateContent, vars);

    if (test_mode === 'on') {
      const waLink = generateWaLink(phone, messageText);
      return res.send(renderPage('Preview Invoice', WA_CSS + nav('/whatsapp-receipts/send-invoice') + `
        <div style="max-width:700px;margin:0 auto">
          <a href="/whatsapp-receipts/send-invoice" style="color:#6b7280;text-decoration:none;font-size:14px">&larr; Back</a>
          <div class="wa-card" style="margin-top:14px"><div class="wa-card-header"><h3>📱 Invoice Preview</h3><span class="wa-badge wa-badge-wa">Test</span></div>
          <div class="wa-preview">${esc(messageText)}</div></div>
          <div style="margin-top:14px;display:flex;gap:10px">
            <a href="${esc(waLink)}" target="_blank" rel="noopener" class="wa-btn wa-btn-primary">📱 Open in WhatsApp</a>
            <a href="/whatsapp-receipts/send-invoice" class="wa-btn wa-btn-secondary">&larr; Edit</a>
          </div>
        </div>`, req.session.user, req));
    }

    await logSend(tid, { phone, name: recipient_name, receiptType: 'invoice', entityId: null, messageText, method, status: 'sent', sentBy: uid });
    const waLink = generateWaLink(phone, messageText);
    req.session.flash = { msg: `Invoice sent to ${esc(recipient_name || phone)}!` };
    res.redirect(waLink);
  }));

  // GET form for invoice
  app.get('/whatsapp-receipts/send-invoice', requireAuth, ah(async (req, res) => {
    const html = WA_CSS + nav('/whatsapp-receipts/send-invoice') + flash(req) + `
      <div style="max-width:900px;margin:0 auto">
        <a href="/whatsapp-receipts" style="color:#6b7280;text-decoration:none;font-size:14px">&larr; Dashboard</a>
        <h2 style="margin:8px 0 4px">📄 Send Invoice</h2>
        <p class="muted" style="margin-bottom:18px">Send an invoice to a client or parent via WhatsApp</p>

        <form method="POST" action="/whatsapp-receipts/send-invoice" style="display:grid;gap:16px">
          <div class="wa-card">
            <div class="wa-card-header"><h3>📱 Recipient</h3></div>
            <div class="wa-form-grid">
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Phone Number *</label>
                <div class="wa-phone-input"><span class="wa-phone-prefix">+256</span><input type="tel" name="recipient_phone" required placeholder="7XX XXX XXX" class="wa-input" style="flex:1"></div></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Client Name</label><input type="text" name="client_name" placeholder="Client/Organization Name" class="wa-input"></div>
            </div>
          </div>

          <div class="wa-card">
            <div class="wa-card-header"><h3>📄 Invoice Details</h3></div>
            <div class="wa-form-grid">
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Invoice Number</label><input type="text" name="invoice_number" placeholder="Auto-generated" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Invoice Date</label><input type="date" name="invoice_date" value="${new Date().toISOString().split('T')[0]}" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Due Date</label><input type="date" name="due_date" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Total Amount (UGX) *</label><input type="number" name="total_amount" required placeholder="800000" class="wa-input"></div>
              <div class="full"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Items List</label>
                <textarea name="items_list" class="wa-textarea" placeholder="Item 1 — UGX 500,000&#10;Item 2 — UGX 300,000&#10;Item 3 — UGX 200,000" rows="4"></textarea></div>
            </div>
          </div>

          <div class="wa-card">
            <div class="wa-card-header"><h3>🏫 School Info</h3></div>
            <div class="wa-form-grid">
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">School Name</label><input type="text" name="school_name" placeholder="${esc(req.session.user.tenant_name || '')}" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">School Phone</label><input type="tel" name="school_phone" class="wa-input"></div>
              <div class="full"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">School Email</label><input type="email" name="school_email" class="wa-input"></div>
            </div>
          </div>

          <div class="wa-card">
            <div class="wa-card-header"><h3>⚙️ Options</h3></div>
            <div style="display:flex;gap:20px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" name="test_mode" style="width:18px;height:18px;accent-color:${WA_GREEN}"><span style="font-size:14px">Test mode</span></label>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Delivery Method</label>
                <select name="delivery_method" class="wa-input" style="width:auto"><option value="wa_link">wa.me Link</option><option value="wa_api">WhatsApp API</option></select></div>
            </div>
          </div>

          <div style="display:flex;gap:10px">
            <button type="submit" class="wa-btn wa-btn-primary" style="padding:14px 32px;font-size:16px">📱 Send Invoice</button>
            <button type="submit" class="wa-btn wa-btn-secondary" style="padding:14px 32px" onclick="document.querySelector('input[name=test_mode]').checked=true;this.form.submit()">👁 Preview</button>
          </div>
        </form>
      </div>`;
    res.send(renderPage('Send Invoice', html, req.session.user, req));
  }));

  // ══════════════════════════════════════════════════════════════════
  //  ROUTE 4: POST /whatsapp-receipts/send-payment-confirmation
  // ══════════════════════════════════════════════════════════════════
  app.post('/whatsapp-receipts/send-payment-confirmation', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { recipient_phone, recipient_name, student_name, class_name,
      reference, payment_date, amount_paid, payment_method, term,
      previous_balance, new_balance, school_name, school_phone,
      delivery_method, test_mode } = req.body;

    const phoneCheck = validatePhone(recipient_phone);
    if (!phoneCheck.valid) {
      req.session.flash = { msg: phoneCheck.error, type: 'error' };
      return res.redirect('/whatsapp-receipts/send-payment-confirmation');
    }

    const phone = normalizePhone(recipient_phone);
    const method = delivery_method === 'wa_api' ? 'wa_api' : 'wa_link';

    const tmpl = await getTemplate(tid, 'payment_confirmation');
    const templateContent = tmpl ? tmpl.template_content : DEFAULT_TEMPLATES.payment_confirmation;

    const vars = {
      school_name: school_name || req.session.user.tenant_name || 'Our School',
      reference: reference || 'PAY-' + Date.now().toString(36).toUpperCase(),
      payment_date: payment_date || fmtDate(new Date()),
      student_name: student_name || recipient_name || 'N/A',
      class_name: class_name || 'N/A',
      amount_paid: fmtMoney(amount_paid),
      payment_method: payment_method || 'Cash',
      term: term || 'Term 1',
      previous_balance: fmtMoney(previous_balance || 0),
      new_balance: fmtMoney(new_balance || 0),
      school_phone: school_phone || '',
    };

    const messageText = renderTemplate(templateContent, vars);

    if (test_mode === 'on') {
      const waLink = generateWaLink(phone, messageText);
      return res.send(renderPage('Preview Confirmation', WA_CSS + nav('/whatsapp-receipts/send-payment-confirmation') + `
        <div style="max-width:700px;margin:0 auto">
          <a href="/whatsapp-receipts/send-payment-confirmation" style="color:#6b7280;text-decoration:none;font-size:14px">&larr; Back</a>
          <div class="wa-card" style="margin-top:14px"><div class="wa-card-header"><h3>📱 Payment Confirmation Preview</h3><span class="wa-badge wa-badge-wa">Test</span></div>
          <div class="wa-preview">${esc(messageText)}</div></div>
          <div style="margin-top:14px;display:flex;gap:10px">
            <a href="${esc(waLink)}" target="_blank" rel="noopener" class="wa-btn wa-btn-primary">📱 Open in WhatsApp</a>
            <a href="/whatsapp-receipts/send-payment-confirmation" class="wa-btn wa-btn-secondary">&larr; Edit</a>
          </div>
        </div>`, req.session.user, req));
    }

    await logSend(tid, { phone, name: recipient_name, receiptType: 'payment_confirmation', entityId: null, messageText, method, status: 'sent', sentBy: uid });
    const waLink = generateWaLink(phone, messageText);
    req.session.flash = { msg: `Payment confirmation sent to ${esc(recipient_name || phone)}!` };
    res.redirect(waLink);
  }));

  // GET form for payment confirmation
  app.get('/whatsapp-receipts/send-payment-confirmation', requireAuth, ah(async (req, res) => {
    const html = WA_CSS + nav('/whatsapp-receipts/send-payment-confirmation') + flash(req) + `
      <div style="max-width:900px;margin:0 auto">
        <a href="/whatsapp-receipts" style="color:#6b7280;text-decoration:none;font-size:14px">&larr; Dashboard</a>
        <h2 style="margin:8px 0 4px">✅ Send Payment Confirmation</h2>
        <p class="muted" style="margin-bottom:18px">Confirm a payment and notify the parent/guardian via WhatsApp</p>

        <form method="POST" action="/whatsapp-receipts/send-payment-confirmation" style="display:grid;gap:16px">
          <div class="wa-card">
            <div class="wa-card-header"><h3>📱 Recipient</h3></div>
            <div class="wa-form-grid">
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Phone Number *</label>
                <div class="wa-phone-input"><span class="wa-phone-prefix">+256</span><input type="tel" name="recipient_phone" required placeholder="7XX XXX XXX" class="wa-input" style="flex:1"></div></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Recipient Name</label><input type="text" name="recipient_name" placeholder="Parent/Guardian Name" class="wa-input"></div>
            </div>
          </div>

          <div class="wa-card">
            <div class="wa-card-header"><h3>🎓 Student Details</h3></div>
            <div class="wa-form-grid">
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Student Name *</label><input type="text" name="student_name" required class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Class</label><input type="text" name="class_name" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Term</label>
                <select name="term" class="wa-input"><option value="Term 1">Term 1</option><option value="Term 2">Term 2</option><option value="Term 3">Term 3</option></select></div>
            </div>
          </div>

          <div class="wa-card">
            <div class="wa-card-header"><h3>💰 Payment Details</h3></div>
            <div class="wa-form-grid">
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Amount Paid (UGX) *</label><input type="number" name="amount_paid" required class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Payment Method</label>
                <select name="payment_method" class="wa-input"><option>Cash</option><option>MTN MoMo</option><option>Airtel Money</option><option>Bank Transfer</option><option>Cheque</option><option>Card</option></select></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Reference Number</label><input type="text" name="reference" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Payment Date</label><input type="date" name="payment_date" value="${new Date().toISOString().split('T')[0]}" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Previous Balance</label><input type="number" name="previous_balance" value="0" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">New Balance</label><input type="number" name="new_balance" value="0" class="wa-input"></div>
            </div>
          </div>

          <div class="wa-card">
            <div class="wa-card-header"><h3>⚙️ Options</h3></div>
            <div style="display:flex;gap:20px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" name="test_mode" style="width:18px;height:18px;accent-color:${WA_GREEN}"><span style="font-size:14px">Test mode</span></label>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Delivery Method</label>
                <select name="delivery_method" class="wa-input" style="width:auto"><option value="wa_link">wa.me Link</option><option value="wa_api">WhatsApp API</option></select></div>
            </div>
          </div>

          <div style="display:flex;gap:10px">
            <button type="submit" class="wa-btn wa-btn-primary" style="padding:14px 32px;font-size:16px">📱 Send Confirmation</button>
            <button type="submit" class="wa-btn wa-btn-secondary" style="padding:14px 32px" onclick="document.querySelector('input[name=test_mode]').checked=true;this.form.submit()">👁 Preview</button>
          </div>
        </form>
      </div>`;
    res.send(renderPage('Send Payment Confirmation', html, req.session.user, req));
  }));

  // ══════════════════════════════════════════════════════════════════
  //  ROUTE 5: POST /whatsapp-receipts/bulk-send — Bulk Send
  // ══════════════════════════════════════════════════════════════════
  app.get('/whatsapp-receipts/bulk-send', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    // Get classes for dropdown
    const classes = (await pool.query(`
      SELECT DISTINCT class_name FROM users WHERE tenant_id = $1 AND class_name IS NOT NULL AND class_name != ''
      UNION SELECT DISTINCT class FROM students WHERE tenant_id = $1 AND class IS NOT NULL AND class != ''
      ORDER BY class_name LIMIT 50
    `, [tid])).rows.map(r => r.class_name || r.class).filter(Boolean);

    const classOptions = classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

    const html = WA_CSS + nav('/whatsapp-receipts/bulk-send') + flash(req) + `
      <div style="max-width:900px;margin:0 auto">
        <a href="/whatsapp-receipts" style="color:#6b7280;text-decoration:none;font-size:14px">&larr; Dashboard</a>
        <h2 style="margin:8px 0 4px">📨 Bulk Send</h2>
        <p class="muted" style="margin-bottom:18px">Send receipts to multiple recipients at once</p>

        <div class="wa-card" style="margin-bottom:18px">
          <h3 style="margin:0 0 8px">⚠️ Important</h3>
          <p style="font-size:13px;color:#6b7280;margin:0">Bulk send generates individual WhatsApp links for each recipient. You will need to click each link to open WhatsApp. For high-volume sends, consider setting up the WhatsApp Business API.</p>
        </div>

        <form method="POST" action="/whatsapp-receipts/bulk-send" style="display:grid;gap:16px">
          <!-- Target Selection -->
          <div class="wa-card">
            <div class="wa-card-header"><h3>🎯 Target Audience</h3></div>
            <div class="wa-form-grid">
              <div>
                <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Send To *</label>
                <select name="target_group" class="wa-input" id="targetGroup" onchange="toggleTarget()">
                  <option value="class">By Class</option>
                  <option value="outstanding">Parents with Outstanding Fees</option>
                  <option value="all_parents">All Parents</option>
                  <option value="custom">Custom Phone List</option>
                </select>
              </div>
              <div id="classSelect">
                <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Class</label>
                <select name="class_name" class="wa-input">
                  <option value="">— Select Class —</option>
                  ${classOptions}
                </select>
              </div>
            </div>
            <div id="customPhones" style="display:none;margin-top:14px">
              <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Phone Numbers (one per line)</label>
              <textarea name="custom_phones" class="wa-textarea" rows="6" placeholder="0771234567&#10;0782345678&#10;0703456789"></textarea>
            </div>
          </div>

          <!-- Receipt Type -->
          <div class="wa-card">
            <div class="wa-card-header"><h3>📋 Receipt Type</h3></div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">
              ${VALID_TYPES.map(t => `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;transition:.15s">
                <input type="radio" name="receipt_type" value="${t}" ${t === 'fee_receipt' ? 'checked' : ''} style="accent-color:${WA_GREEN};width:18px;height:18px">
                <span style="font-size:14px">${typeIcon(t)} ${typeLabel(t)}</span>
              </label>`).join('')}
            </div>
          </div>

          <!-- Common Message Fields -->
          <div class="wa-card">
            <div class="wa-card-header"><h3>📝 Message Fields</h3></div>
            <div class="wa-form-grid">
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Term</label>
                <select name="term" class="wa-input"><option value="Term 1">Term 1</option><option value="Term 2">Term 2</option><option value="Term 3">Term 3</option></select></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Payment Method</label>
                <select name="payment_method" class="wa-input"><option>Cash</option><option>MTN MoMo</option><option>Airtel Money</option><option>Bank Transfer</option></select></div>
              <div class="full"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Custom Note (optional, appended to message)</label>
                <textarea name="custom_note" class="wa-textarea" rows="2" placeholder="Additional message for all recipients..."></textarea></div>
            </div>
          </div>

          <div class="wa-tip">
            <strong>💡 Tip:</strong> For the "outstanding fees" option, the system will look up parents with unpaid balances from the fees table and send personalized reminder messages.
          </div>

          <div style="display:flex;gap:10px">
            <button type="submit" class="wa-btn wa-btn-primary" style="padding:14px 32px;font-size:16px">📨 Generate Bulk Links</button>
            <a href="/whatsapp-receipts" class="wa-btn wa-btn-secondary" style="padding:14px 20px">Cancel</a>
          </div>
        </form>
      </div>

      <script>
      function toggleTarget(){
        var g=document.getElementById('targetGroup').value;
        document.getElementById('classSelect').style.display=(g==='class')?'block':'none';
        document.getElementById('customPhones').style.display=(g==='custom')?'block':'none';
      }
      </script>`;
    res.send(renderPage('Bulk Send', html, req.session.user, req));
  }));

  app.post('/whatsapp-receipts/bulk-send', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { target_group, class_name, receipt_type, term, payment_method,
      custom_note, custom_phones } = req.body;

    let recipients = [];

    try {
      if (target_group === 'custom') {
        // Parse custom phone list
        const phones = (custom_phones || '').split(/[\n,]/).map(p => p.trim()).filter(Boolean);
        recipients = phones.map(p => {
          const normalized = normalizePhone(p);
          return { phone: normalized, name: '', student_name: '' };
        }).filter(r => validatePhone(r.phone).valid);

      } else if (target_group === 'class') {
        if (!class_name) {
          req.session.flash = { msg: 'Please select a class', type: 'error' };
          return res.redirect('/whatsapp-receipts/bulk-send');
        }
        const { rows } = await pool.query(
          `SELECT u.phone, u.first_name, u.last_name, u.class_name
           FROM users u WHERE u.tenant_id = $1 AND (u.role = 'parent' OR u.role = 'student')
           AND u.phone IS NOT NULL AND u.phone != ''
           AND (u.class_name = $2 OR u.class = $2)
           LIMIT 200`,
          [tid, class_name]
        );
        recipients = rows.map(r => ({
          phone: normalizePhone(r.phone),
          name: [r.first_name, r.last_name].filter(Boolean).join(' '),
          student_name: [r.first_name, r.last_name].filter(Boolean).join(' '),
          class_name: r.class_name,
        }));

      } else if (target_group === 'outstanding') {
        // Look for users with outstanding fees from the fees table if it exists
        let feeQuery;
        try {
          const { rows } = await pool.query(`
            SELECT u.phone, u.first_name, u.last_name, f.balance, f.total_fees, f.amount_paid
            FROM users u
            LEFT JOIN LATERAL (
              SELECT * FROM fees WHERE tenant_id = $1 AND student_id = u.id
              ORDER BY created_at DESC LIMIT 1
            ) f ON true
            WHERE u.tenant_id = $1 AND (u.role = 'parent' OR u.role = 'student')
            AND u.phone IS NOT NULL AND u.phone != ''
            AND (f.balance > 0 OR f.balance IS NULL)
            LIMIT 200
          `, [tid]);
          recipients = rows.map(r => ({
            phone: normalizePhone(r.phone),
            name: [r.first_name, r.last_name].filter(Boolean).join(' '),
            student_name: [r.first_name, r.last_name].filter(Boolean).join(' '),
            balance: r.balance,
            total_fees: r.total_fees,
            amount_paid: r.amount_paid,
          }));
        } catch (e) {
          // fees table might not exist, fall back to all parents
          const { rows } = await pool.query(
            `SELECT phone, first_name, last_name FROM users
             WHERE tenant_id = $1 AND (role = 'parent' OR role = 'student')
             AND phone IS NOT NULL AND phone != ''
             LIMIT 200`,
            [tid]
          );
          recipients = rows.map(r => ({
            phone: normalizePhone(r.phone),
            name: [r.first_name, r.last_name].filter(Boolean).join(' '),
            student_name: [r.first_name, r.last_name].filter(Boolean).join(' '),
          }));
        }

      } else if (target_group === 'all_parents') {
        const { rows } = await pool.query(
          `SELECT phone, first_name, last_name, class_name FROM users
           WHERE tenant_id = $1 AND role = 'parent'
           AND phone IS NOT NULL AND phone != ''
           LIMIT 200`,
          [tid]
        );
        recipients = rows.map(r => ({
          phone: normalizePhone(r.phone),
          name: [r.first_name, r.last_name].filter(Boolean).join(' '),
          student_name: [r.first_name, r.last_name].filter(Boolean).join(' '),
          class_name: r.class_name,
        }));
      }

      // Filter valid phones
      recipients = recipients.filter(r => validatePhone(r.phone).valid);

      if (recipients.length === 0) {
        req.session.flash = { msg: 'No valid recipients found. Please check your selection.', type: 'error' };
        return res.redirect('/whatsapp-receipts/bulk-send');
      }

      if (recipients.length > 200) {
        req.session.flash = { msg: 'Too many recipients (max 200). Please narrow your selection.', type: 'error' };
        return res.redirect('/whatsapp-receipts/bulk-send');
      }

      // Get template
      const tmpl = await getTemplate(tid, receipt_type);
      const templateContent = tmpl ? tmpl.template_content : (DEFAULT_TEMPLATES[receipt_type] || DEFAULT_TEMPLATES.fee_receipt);

      // Generate messages and log sends
      const results = [];
      for (const rec of recipients) {
        const vars = {
          school_name: req.session.user.tenant_name || 'Our School',
          student_name: rec.student_name || rec.name || 'N/A',
          class_name: rec.class_name || 'N/A',
          term: term || 'Term 1',
          total_fees: fmtMoney(rec.total_fees),
          amount_paid: fmtMoney(rec.amount_paid),
          balance: fmtMoney(rec.balance),
          payment_method: payment_method || 'Cash',
          payment_date: fmtDate(new Date()),
          receipt_number: 'RCT-' + Date.now().toString(36).toUpperCase(),
          school_phone: '',
        };
        const messageText = renderTemplate(templateContent, vars);
        if (custom_note) vars.custom_note = custom_note;

        const waLink = generateWaLink(rec.phone, messageText);
        const logEntry = await logSend(tid, {
          phone: rec.phone, name: rec.name, receiptType: receipt_type,
          entityId: null, messageText, method: 'wa_link', status: 'sent', sentBy: uid,
        });
        results.push({ ...rec, waLink, logId: logEntry.id });
      }

      // Show results page
      const resultsHtml = results.map((r, i) => `<tr>
        <td>${i + 1}</td>
        <td style="font-weight:600">${esc(r.name || '—')}</td>
        <td style="font-family:monospace;font-size:12px">${esc(r.phone)}</td>
        <td><a href="${esc(r.waLink)}" target="_blank" rel="noopener" class="wa-btn wa-btn-primary wa-btn-sm">📱 Open</a></td>
      </tr>`).join('');

      const html = WA_CSS + nav('/whatsapp-receipts/bulk-send') + `
        <div style="max-width:900px;margin:0 auto">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
            <div style="font-size:36px">✅</div>
            <div>
              <h2 style="margin:0">Bulk Send Generated</h2>
              <p class="muted" style="margin:0">${F(results.length)} WhatsApp links generated for ${esc(typeLabel(receipt_type))}</p>
            </div>
          </div>

          <div class="wa-card" style="margin-bottom:18px;background:#f0fdf4;border-color:#bbf7d0">
            <p style="margin:0;font-size:14px;color:#16a34a"><strong>💡 Next step:</strong> Click each "Open" button to open WhatsApp with the pre-filled message. The recipient will receive the formatted receipt when you hit send in WhatsApp.</p>
          </div>

          <div class="wa-card">
            <div class="wa-card-header">
              <h3>📨 Generated Links (${F(results.length)})</h3>
              <button onclick="document.querySelectorAll('a[target=_blank]').forEach(a=>window.open(a.href))" class="wa-btn wa-btn-secondary wa-btn-sm">Open All (pop-ups)</button>
            </div>
            <div style="overflow-x:auto;max-height:500px;overflow-y:auto">
              <table class="wa-table">
                <thead><tr><th>#</th><th>Recipient</th><th>Phone</th><th>Action</th></tr></thead>
                <tbody>${resultsHtml}</tbody>
              </table>
            </div>
          </div>

          <div style="margin-top:18px;display:flex;gap:10px">
            <a href="/whatsapp-receipts/history" class="wa-btn wa-btn-secondary">📜 View History</a>
            <a href="/whatsapp-receipts/bulk-send" class="wa-btn wa-btn-primary">📨 Send More</a>
          </div>
        </div>`;

      res.send(renderPage('Bulk Send Results', html, req.session.user, req));

    } catch (e) {
      req.session.flash = { msg: 'Error generating bulk send: ' + e.message, type: 'error' };
      res.redirect('/whatsapp-receipts/bulk-send');
    }
  }));

  // ══════════════════════════════════════════════════════════════════
  //  ROUTE 6: GET /whatsapp-receipts/history — View Send History
  // ══════════════════════════════════════════════════════════════════
  app.get('/whatsapp-receipts/history', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { status, receipt_type, delivery_method, q, page = 1, date_from, date_to } = req.query;
    const offset = (parseInt(page) - 1) * PER_PAGE;

    // Build WHERE clause
    let where = ['tenant_id = $1'];
    let params = [tid];
    let idx = 2;

    if (status && status !== 'all') { where.push(`status = $${idx++}`); params.push(status); }
    if (receipt_type && receipt_type !== 'all') { where.push(`receipt_type = $${idx++}`); params.push(receipt_type); }
    if (delivery_method && delivery_method !== 'all') { where.push(`delivery_method = $${idx++}`); params.push(delivery_method); }
    if (q) { where.push(`(recipient_name ILIKE $${idx} OR recipient_phone ILIKE $${idx} OR message_text ILIKE $${idx})`); params.push(`%${q}%`); idx++; }
    if (date_from) { where.push(`sent_at >= $${idx++}`); params.push(date_from); }
    if (date_to) { where.push(`sent_at < ($${idx++}::date + INTERVAL '1 day')`); params.push(date_to); }

    const whereClause = where.join(' AND ');

    const [countRes, logsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM whatsapp_receipt_log WHERE ${whereClause}`, params),
      pool.query(`SELECT * FROM whatsapp_receipt_log WHERE ${whereClause} ORDER BY sent_at DESC LIMIT $${idx} OFFSET $${idx + 1}`, [...params, PER_PAGE, offset]),
    ]);

    const total = countRes.rows[0]?.total || 0;
    const logs = logsRes.rows;
    const totalPages = Math.ceil(total / PER_PAGE);

    // Status counts for filter tabs
    const statusCounts = (await pool.query(`
      SELECT status, COUNT(*)::int AS cnt FROM whatsapp_receipt_log WHERE tenant_id = $1 GROUP BY status
    `, [tid])).rows;

    const rows = logs.length === 0
      ? `<tr><td colspan="8" class="wa-empty" style="padding:50px">
           <div class="wa-empty-icon">📜</div>
           <p style="margin:0">No receipts found</p>
         </td></tr>`
      : logs.map(l => `<tr>
          <td>${typeIcon(l.receipt_type)} ${esc(typeLabel(l.receipt_type))}</td>
          <td style="font-weight:600">${esc(l.recipient_name || '—')}</td>
          <td style="font-family:monospace;font-size:12px">${esc(l.recipient_phone)}</td>
          <td>${statusBadge(l.status)}</td>
          <td>${methodBadge(l.delivery_method)}</td>
          <td style="font-size:12px;color:#6b7280">${l.error_message ? esc(l.error_message.substring(0, 40)) + (l.error_message.length > 40 ? '...' : '') : '—'}</td>
          <td class="muted" style="font-size:12px">${fmtDateTime(l.sent_at)}</td>
          <td>
            <button onclick="previewMsg(${l.id})" class="wa-btn wa-btn-secondary wa-btn-sm" title="Preview">👁</button>
            ${l.status === 'failed' ? `<a href="/whatsapp-receipts/resend/${l.id}" class="wa-btn wa-btn-primary wa-btn-sm" title="Resend">🔄</a>` : ''}
          </td>
        </tr>`).join('');

    const html = WA_CSS + nav('/whatsapp-receipts/history') + flash(req) + `
      <div style="max-width:1200px;margin:0 auto">
        <h1 style="font-size:24px;color:#1f2937;margin:0 0 6px">📜 Send History</h1>
        <p class="muted" style="margin-bottom:16px">View all sent receipts with filters and search</p>

        <!-- Status Tabs -->
        <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
          <a href="/whatsapp-receipts/history" class="wa-btn ${!status || status === 'all' ? 'wa-btn-primary' : 'wa-btn-secondary'} wa-btn-sm">All (${F(total)})</a>
          ${statusCounts.map(sc => `<a href="/whatsapp-receipts/history?status=${sc.status}" class="wa-btn ${status === sc.status ? 'wa-btn-primary' : 'wa-btn-secondary'} wa-btn-sm">${esc(sc.status)} (${F(sc.cnt)})</a>`).join('')}
        </div>

        <!-- Filters -->
        <div class="wa-card" style="margin-bottom:14px">
          <div class="wa-filter">
            <div><label>Search</label><input type="text" name="q" value="${esc(q || '')}" placeholder="Name, phone, message..."></div>
            <div><label>Type</label>
              <select name="type">
                <option value="all">All Types</option>
                ${VALID_TYPES.map(t => `<option value="${t}" ${receipt_type === t ? 'selected' : ''}>${typeIcon(t)} ${typeLabel(t)}</option>`).join('')}
              </select>
            </div>
            <div><label>Method</label>
              <select name="method">
                <option value="all">All Methods</option>
                <option value="wa_link" ${delivery_method === 'wa_link' ? 'selected' : ''}>wa.me Link</option>
                <option value="wa_api" ${delivery_method === 'wa_api' ? 'selected' : ''}>WhatsApp API</option>
                <option value="sms_fallback" ${delivery_method === 'sms_fallback' ? 'selected' : ''}>SMS Fallback</option>
              </select>
            </div>
            <div><label>From</label><input type="date" name="date_from" value="${esc(date_from || '')}"></div>
            <div><label>To</label><input type="date" name="date_to" value="${esc(date_to || '')}"></div>
            <button onclick="applyFilter()" class="wa-btn wa-btn-primary wa-btn-sm">Filter</button>
            <a href="/whatsapp-receipts/history" class="wa-btn wa-btn-secondary wa-btn-sm">Clear</a>
          </div>
        </div>

        <!-- Table -->
        <div class="wa-card">
          <div class="wa-card-header">
            <h3>Results (${F(total)})</h3>
            <span class="muted" style="font-size:12px">Page ${page} of ${totalPages || 1}</span>
          </div>
          <div style="overflow-x:auto">
            <table class="wa-table">
              <thead><tr><th>Type</th><th>Recipient</th><th>Phone</th><th>Status</th><th>Method</th><th>Error</th><th>Sent</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ${paginationHTML(parseInt(page), totalPages, '/whatsapp-receipts/history?' + new URLSearchParams({ status: status || '', receipt_type: receipt_type || '', delivery_method: delivery_method || '', q: q || '', date_from: date_from || '', date_to: date_to || '' }).toString())}
        </div>
      </div>

      <!-- Preview Modal -->
      <div id="previewModal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:9999;align-items:center;justify-content:center">
        <div style="background:#fff;border-radius:16px;max-width:500px;width:90%;max-height:80vh;overflow:hidden;display:flex;flex-direction:column">
          <div style="padding:16px 20px;background:${WA_GREEN};color:#fff;display:flex;justify-content:space-between;align-items:center">
            <strong>📱 Message Preview</strong>
            <button onclick="document.getElementById('previewModal').style.display='none'" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer">&times;</button>
          </div>
          <div style="padding:20px;overflow-y:auto"><div id="previewContent" class="wa-preview" style="max-height:50vh"></div></div>
        </div>
      </div>

      <script>
      function applyFilter(){
        var p=new URLSearchParams();
        var q=document.querySelector('input[name=q]').value;
        var type=document.querySelector('select[name=type]').value;
        var method=document.querySelector('select[name=method]').value;
        var from=document.querySelector('input[name=date_from]').value;
        var to=document.querySelector('input[name=date_to]').value;
        if(q)p.set('q',q);if(type!=='all')p.set('receipt_type',type);if(method!=='all')p.set('delivery_method',method);if(from)p.set('date_from',from);if(to)p.set('date_to',to);
        location.href='/whatsapp-receipts/history?'+p.toString();
      }
      function previewMsg(id){
        fetch('/whatsapp-receipts/history/message/'+id).then(r=>r.json()).then(d=>{
          if(d.message){document.getElementById('previewContent').textContent=d.message;document.getElementById('previewModal').style.display='flex'}
        }).catch(()=>{});
      }
      document.getElementById('previewModal').addEventListener('click',function(e){if(e.target===this)this.style.display='none'});
      </script>`;

    res.send(renderPage('Send History', html, req.session.user, req));
  }));

  // API endpoint to fetch a single message text for preview
  app.get('/whatsapp-receipts/history/message/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query(
      `SELECT message_text FROM whatsapp_receipt_log WHERE id = $1 AND tenant_id = $2`,
      [parseInt(req.params.id), tid]
    );
    if (rows.length === 0) return res.json({ error: 'Not found' });
    res.json({ message: rows[0].message_text });
  }));

  // ══════════════════════════════════════════════════════════════════
  //  ROUTE 7: POST /whatsapp-receipts/resend/:id — Resend Failed
  // ══════════════════════════════════════════════════════════════════
  app.post('/whatsapp-receipts/resend/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const logId = parseInt(req.params.id);

    const { rows } = await pool.query(
      `SELECT * FROM whatsapp_receipt_log WHERE id = $1 AND tenant_id = $2`,
      [logId, tid]
    );
    const log = rows[0];

    if (!log) {
      req.session.flash = { msg: 'Receipt log entry not found.', type: 'error' };
      return res.redirect('/whatsapp-receipts/history');
    }

    // Validate phone again
    const phoneCheck = validatePhone(log.recipient_phone);
    if (!phoneCheck.valid) {
      req.session.flash = { msg: 'Cannot resend: ' + phoneCheck.error, type: 'error' };
      return res.redirect('/whatsapp-receipts/history');
    }

    const phone = normalizePhone(log.recipient_phone);
    const waLink = generateWaLink(phone, log.message_text);

    // Update the old log entry status
    await pool.query(
      `UPDATE whatsapp_receipt_log SET status = 'sent', error_message = NULL, sent_at = NOW(), sent_by = $1 WHERE id = $2 AND tenant_id = $3`,
      [uid, logId, tid]
    );

    // Log new entry
    await logSend(tid, {
      phone, name: log.recipient_name, receiptType: log.receipt_type,
      entityId: log.entity_id, messageText: log.message_text,
      method: log.delivery_method || 'wa_link', status: 'sent', sentBy: uid,
    });

    req.session.flash = { msg: `Receipt resent to ${esc(log.recipient_name || phone)}!` };
    res.redirect(waLink);
  }));

  // ══════════════════════════════════════════════════════════════════
  //  ROUTE 8: GET /whatsapp-receipts/templates — Template Management
  // ══════════════════════════════════════════════════════════════════
  app.get('/whatsapp-receipts/templates', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;

    const templates = (await pool.query(
      `SELECT wt.*, u.first_name AS creator_first, u.last_name AS creator_last
       FROM whatsapp_templates wt
       LEFT JOIN users u ON u.id = wt.created_by
       WHERE wt.tenant_id IN ($1, 0)
       ORDER BY wt.tenant_id ASC, wt.receipt_type ASC, wt.is_default DESC, wt.created_at DESC`,
      [tid]
    )).rows;

    // Group by type
    const grouped = {};
    for (const t of templates) {
      if (!grouped[t.receipt_type]) grouped[t.receipt_type] = [];
      grouped[t.receipt_type].push(t);
    }

    const typeColorMap = {
      fee_receipt: WA_GREEN,
      invoice: '#3b82f6',
      payment_confirmation: '#8b5cf6',
      report_card: '#f59e0b',
      certificate: '#ec4899',
    };

    const groupedHtml = Object.entries(grouped).map(([type, tmpls]) => `
      <div style="margin-bottom:24px">
        <h3 style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <span style="font-size:20px">${typeIcon(type)}</span>
          <span style="color:#1f2937">${typeLabel(type)}</span>
          <span style="font-size:12px;color:#6b7280;font-weight:400">(${tmpls.length} template${tmpls.length !== 1 ? 's' : ''})</span>
        </h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px">
          ${tmpls.map(t => {
            const isSystem = t.tenant_id === 0;
            const isDefault = t.is_default;
            const color = typeColorMap[t.receipt_type] || '#6b7280';
            const vars = (t.variables || []).map(v => `<span class="wa-chip">{{${esc(v)}}}</span>`).join(' ');
            return `<div class="wa-template-card" style="${isDefault ? 'border-color:' + color + '60' : ''}">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <strong style="font-size:14px;color:#1f2937">${esc(t.template_name)}</strong>
                <div style="display:flex;gap:4px">
                  ${isSystem ? '<span class="wa-badge" style="background:#f3f4f6;color:#6b7280">System</span>' : ''}
                  ${isDefault ? '<span class="wa-badge" style="background:#dcfce7;color:#16a34a">Default</span>' : ''}
                  ${t.is_active ? '<span class="wa-badge" style="background:#dbeafe;color:#2563eb">Active</span>' : '<span class="wa-badge" style="background:#f3f4f6;color:#6b7280">Inactive</span>'}
                </div>
              </div>
              <pre style="font-size:12px;color:#4b5563;line-height:1.5;white-space:pre-wrap;word-break:break-word;background:#f9fafb;border:1px solid #f3f4f6;border-radius:8px;padding:12px;margin:8px 0;max-height:150px;overflow-y:auto;font-family:monospace">${esc((t.template_content || '').substring(0, 300))}${(t.template_content || '').length > 300 ? '\n...' : ''}</pre>
              <div style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:8px">${vars}</div>
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#9ca3af">
                <span>${t.creator_first ? esc(t.creator_first + ' ' + (t.creator_last || '')) : 'System'}</span>
                <span>${ago(t.created_at)}</span>
              </div>
              ${!isSystem ? `
              <div style="margin-top:10px;display:flex;gap:6px">
                <button onclick="editTemplate(${t.id})" class="wa-btn wa-btn-secondary wa-btn-sm">✏️ Edit</button>
                <button onclick="toggleTemplate(${t.id})" class="wa-btn wa-btn-sm" style="background:${t.is_active ? '#fee2e2;color:#dc2626' : '#dcfce7;color:#16a34a'}">${t.is_active ? 'Disable' : 'Enable'}</button>
                <button onclick="setDefault(${t.id})" class="wa-btn wa-btn-secondary wa-btn-sm">⭐ Set Default</button>
                <button onclick="deleteTemplate(${t.id})" class="wa-btn wa-btn-danger wa-btn-sm">🗑</button>
              </div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>
    `).join('');

    const html = WA_CSS + nav('/whatsapp-receipts/templates') + flash(req) + `
      <div style="max-width:1200px;margin:0 auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
          <div>
            <h1 style="font-size:24px;color:#1f2937;margin:0">📝 Message Templates</h1>
            <p class="muted" style="margin:0 0 2px">Customize WhatsApp receipt message templates with variables</p>
          </div>
          <button onclick="document.getElementById('addForm').style.display='block';document.getElementById('addForm').scrollIntoView({behavior:'smooth'})" class="wa-btn wa-btn-primary">+ New Template</button>
        </div>

        <div class="wa-tip" style="margin-bottom:20px">
          <strong>📖 Variables:</strong> Use <code>{{variable_name}}</code> placeholders in your templates. They will be replaced with actual data when sending. Available variables depend on the receipt type.
        </div>

        ${groupedHtml || '<div class="wa-empty"><div class="wa-empty-icon">📝</div><p>No templates found</p></div>'}

        <!-- Add/Edit Template Form -->
        <div id="addForm" class="wa-card" style="display:none;margin-top:24px;border:2px solid ${WA_GREEN}40">
          <div class="wa-card-header">
            <h3 id="formTitle">➕ New Template</h3>
            <button onclick="document.getElementById('addForm').style.display='none'" style="background:none;border:none;font-size:18px;cursor:pointer;color:#6b7280">&times;</button>
          </div>
          <form method="POST" action="/whatsapp-receipts/templates/save" style="display:grid;gap:14px">
            <input type="hidden" name="template_id" id="templateId" value="">
            <div class="wa-form-grid">
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Template Name *</label>
                <input type="text" name="template_name" id="templateName" required placeholder="e.g., Fee Receipt - Colorful" class="wa-input"></div>
              <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Receipt Type *</label>
                <select name="receipt_type" id="templateType" class="wa-input" required>
                  ${VALID_TYPES.map(t => `<option value="${t}">${typeIcon(t)} ${typeLabel(t)}</option>`).join('')}
                </select></div>
            </div>
            <div>
              <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Template Content *</label>
              <textarea name="template_content" id="templateContent" required class="wa-textarea" rows="12"
                placeholder="Use {{variable}} for dynamic fields. Use *text* for bold in WhatsApp."></textarea>
              <div style="margin-top:4px;font-size:12px;color:#6b7280">Use *text* for bold, _text_ for italic in WhatsApp formatting</div>
            </div>
            <div>
              <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Variables (comma-separated)</label>
              <input type="text" name="variables" id="templateVars" class="wa-input" placeholder="school_name, student_name, amount_paid, balance">
              <div style="margin-top:4px;font-size:12px;color:#6b7280">These will be extracted automatically from {{ }} placeholders too</div>
            </div>
            <div>
              <button type="button" onclick="previewTemplate()" class="wa-btn wa-btn-secondary wa-btn-sm">👁 Preview with Sample Data</button>
            </div>
            <div id="tmplPreview" class="wa-preview" style="display:none"></div>
            <div style="display:flex;gap:10px">
              <button type="submit" class="wa-btn wa-btn-primary">💾 Save Template</button>
              <button type="button" onclick="document.getElementById('addForm').style.display='none'" class="wa-btn wa-btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      </div>

      <script>
      function editTemplate(id){
        fetch('/whatsapp-receipts/templates/'+id).then(r=>r.json()).then(t=>{
          if(!t||!t.id)return;
          document.getElementById('templateId').value=t.id;
          document.getElementById('templateName').value=t.template_name||'';
          document.getElementById('templateType').value=t.receipt_type||'fee_receipt';
          document.getElementById('templateContent').value=t.template_content||'';
          document.getElementById('templateVars').value=(t.variables||[]).join(', ');
          document.getElementById('formTitle').textContent='✏️ Edit Template';
          document.getElementById('addForm').style.display='block';
          document.getElementById('addForm').scrollIntoView({behavior:'smooth'});
        }).catch(()=>{});
      }
      function toggleTemplate(id){
        fetch('/whatsapp-receipts/templates/'+id+'/toggle',{method:'POST'}).then(()=>location.reload());
      }
      function setDefault(id){
        fetch('/whatsapp-receipts/templates/'+id+'/default',{method:'POST'}).then(()=>location.reload());
      }
      function deleteTemplate(id){
        if(confirm('Delete this template permanently?'))fetch('/whatsapp-receipts/templates/'+id,{method:'DELETE'}).then(()=>location.reload());
      }
      function previewTemplate(){
        var content=document.getElementById('templateContent').value;
        var sampleData={school_name:'Demo School',student_name:'John Mukasa',class_name:'P.5A',admission_number:'ADM/2024/001',
          receipt_number:'RCT-001',payment_date:'${fmtDate(new Date())}',term:'Term 1',total_fees:fmtMoney(1500000),
          amount_paid:fmtMoney(500000),balance:fmtMoney(1000000),payment_method:'MTN MoMo',reference:'TXN-ABC123',
          school_phone:'+256 771 234 567',school_email:'info@demo.ug',invoice_number:'INV-001',invoice_date:'${fmtDate(new Date())}',
          due_date:'${fmtDate(new Date(Date.now() + 30 * 86400000))}',client_name:'Mary Nakamya',client_phone:'+256 782 345 678',
          items_list:'Tuition — UGX 1,200,000\\nUniform — UGX 150,000\\nBooks — UGX 100,000',total_amount:fmtMoney(1450000),
          balance_due:fmtMoney(1450000),previous_balance:fmtMoney(500000),new_balance:fmtMoney(0),
          subjects_summary:'Mathematics: 85/100\\nEnglish: 78/100\\nScience: 92/100',total_marks:'255',max_marks:'300',
          average:'85%',grade:'A',position:'3',total_students:'45',comment:'Excellent performance',principal_name:'Dr. James Okello',
          course_name:'Primary Education',year:'2024',award_date:'${fmtDate(new Date())}',verification_code:'CERT-2024-XYZ'};
        var preview=content;
        for(var key in sampleData){preview=preview.replace(new RegExp('{{'+key+'}}','g'),sampleData[key]);}
        document.getElementById('tmplPreview').textContent=preview||'(empty)';
        document.getElementById('tmplPreview').style.display='block';
      }
      </script>`;

    res.send(renderPage('Message Templates', html, req.session.user, req));
  }));

  // API: Get single template for editing
  app.get('/whatsapp-receipts/templates/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query(
      `SELECT * FROM whatsapp_templates WHERE id = $1 AND tenant_id IN ($2, 0)`,
      [parseInt(req.params.id), tid]
    );
    if (rows.length === 0) return res.json({ error: 'Not found' });
    res.json(rows[0]);
  }));

  // Save template (create or update)
  app.post('/whatsapp-receipts/templates/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { template_id, template_name, receipt_type, template_content, variables } = req.body;

    if (!template_name || !receipt_type || !template_content) {
      req.session.flash = { msg: 'Template name, type, and content are required.', type: 'error' };
      return res.redirect('/whatsapp-receipts/templates');
    }

    // Extract variables from template content
    const extractedVars = [...(template_content || '').matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i);
    const manualVars = typeof variables === 'string' ? variables.split(',').map(v => v.trim()).filter(Boolean) : [];
    const allVars = [...new Set([...extractedVars, ...manualVars])];

    if (template_id) {
      // Update existing
      await pool.query(`
        UPDATE whatsapp_templates SET
          template_name = $1, template_content = $2, variables = $3, updated_at = NOW()
        WHERE id = $4 AND tenant_id = $5
      `, [template_name.trim(), template_content, allVars, parseInt(template_id), tid]);
    } else {
      // Create new
      await pool.query(`
        INSERT INTO whatsapp_templates (tenant_id, receipt_type, template_name, template_content, variables, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [tid, receipt_type, template_name.trim(), template_content, allVars, uid]);
    }

    req.session.flash = { msg: `Template "${template_name}" saved successfully!` };
    res.redirect('/whatsapp-receipts/templates');
  }));

  // Toggle template active/inactive
  app.post('/whatsapp-receipts/templates/:id/toggle', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(
      `UPDATE whatsapp_templates SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1 AND tenant_id IN ($2, 0)`,
      [parseInt(req.params.id), tid]
    );
    res.json({ ok: true });
  }));

  // Set template as default
  app.post('/whatsapp-receipts/templates/:id/default', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const tmplId = parseInt(req.params.id);

    // Get the receipt type of this template
    const { rows } = await pool.query(
      `SELECT receipt_type FROM whatsapp_templates WHERE id = $1 AND tenant_id IN ($2, 0)`,
      [tmplId, tid]
    );
    if (rows.length === 0) { res.json({ error: 'Not found' }); return; }

    const rType = rows[0].receipt_type;

    // Clear all defaults for this type (tenant scope)
    await pool.query(
      `UPDATE whatsapp_templates SET is_default = false, updated_at = NOW() WHERE receipt_type = $1 AND tenant_id = $2`,
      [rType, tid]
    );

    // Set this as default
    await pool.query(
      `UPDATE whatsapp_templates SET is_default = true, is_active = true, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [tmplId, tid]
    );

    res.json({ ok: true });
  }));

  // Delete template
  app.delete('/whatsapp-receipts/templates/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(
      `DELETE FROM whatsapp_templates WHERE id = $1 AND tenant_id = $2 AND is_default = false`,
      [parseInt(req.params.id), tid]
    );
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════════════════════════════
  //  API: JSON stats endpoint (for external dashboards)
  // ══════════════════════════════════════════════════════════════════
  app.get('/api/whatsapp-receipts/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const stats = (await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
        COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
        COUNT(*) FILTER (WHERE status = 'read')::int AS read_count,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE sent_at >= date_trunc('day', NOW()))::int AS today
      FROM whatsapp_receipt_log WHERE tenant_id = $1
    `, [tid])).rows[0];

    const byType = (await pool.query(`
      SELECT receipt_type, COUNT(*)::int AS cnt FROM whatsapp_receipt_log
      WHERE tenant_id = $1 GROUP BY receipt_type ORDER BY cnt DESC
    `, [tid])).rows;

    res.json({ stats, byType });
  }));

};
