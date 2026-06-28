/**
 * Tax Receipt Generator — ssewasswa-api (Gap 2)
 *
 * Generates 501(c)(3)-compliant tax-deductible receipts as PDFs for ANY US
 * donor — the generic US receipt that was previously MISSING from the
 * platform (the existing fundraising-mega.js handles UK Gift Aid, and
 * fundraising-ultimate10.js handles US IRA/QCD retirees, but a generic
 * 501(c)(3) receipt for a regular US individual donor was not implemented).
 *
 * PDF generation uses the existing `pdfkit` dependency (already in
 * package.json, no new deps required).
 *
 * === Routes (mounted at /api in server.js) ===
 *
 *   GET  /api/donations/:id/receipt/501c3
 *        Generates a PDF 501(c)(3) tax receipt for a specific donation.
 *        Auth required, tenant-scoped. Refuses to issue if the tenant has
 *        no EIN configured (IRS requirement).
 *
 *   GET  /api/donations/:id/receipt/ira
 *        Alias that points at the existing IRA/QCD receipt code in
 *        fundraising-ultimate10.js. Returns a JSON redirect because the
 *        legacy module uses a different export signature and cannot be
 *        invoked directly from this shared-context router.
 *
 *   GET  /api/donations/:id/receipt/gift-aid
 *        Alias that points at the existing UK Gift Aid receipt code in
 *        fundraising-mega.js. Same redirect pattern as the IRA alias.
 *
 *   POST /api/donations/:id/receipt/email
 *        Generates a receipt of the requested type and emails it to the
 *        donor. Uses the existing nodemailer setup. Body:
 *          { receipt_type: '501c3' | 'ira' | 'gift_aid' }
 *
 *   GET  /api/tenants/:id/receipts/summary
 *        Year-end summary of all donations + receipts for a tenant (for
 *        donor tax prep). Accepts ?year=YYYY (defaults to current year).
 *
 * === IRS Compliance Notes ===
 *
 * Per IRS Publication 1771, a 501(c)(3) charitable contribution receipt
 * MUST contain:
 *   1. Organization name (tenants.name)
 *   2. Organization address (tenants.address) — included in footer
 *   3. EIN (tenants.ein or tenants.tax_id) — required, endpoint 400s if missing
 *   4. Donor name (donations.donor_name)
 *   5. Donation amount (donations.amount)
 *   6. Date of contribution (donations.created_at)
 *   7. Statement whether goods/services were provided (IRC §170(f)(8))
 *   8. Good-faith estimate of value of goods/services (if any)
 *   9. Statement that contribution is tax-deductible under IRC §170
 *  10. Date of receipt issuance
 *  11. Signature of authorized official (placeholder if no signature image)
 *  12. Unique receipt number (format: R-YYYY-NNNNNN)
 *
 * The receipt also carries a footer disclaimer noting that the organization
 * does not provide tax advice (IRS recommends this for liability reasons).
 *
 * === Idempotency ===
 *
 * The tax_receipts table (migration 000004) is consulted BEFORE generating
 * a new receipt number. If a receipt has already been issued for the
 * (donation_id, receipt_type) pair, the existing receipt_number is reused
 * so that re-downloading a receipt does not generate a new number. The
 * issued_at timestamp on the original receipt is preserved.
 */

const express = require('express');
const PDFDocument = require('pdfkit');

module.exports = function (ctx) {
  const { pool, ah, requireAuth, audit, esc } = ctx;
  const router = express.Router();

  // =========================================================================
  // Helpers (exported via the module for unit testing)
  // =========================================================================

  /**
   * Generate a unique 501(c)(3) receipt number in the format R-YYYY-NNNNNN.
   * Example: R-2026-000123. The 6-digit zero-padded sequence is generated
   * randomly — in a high-volume deployment, replace this with a SEQUENCE
   * or a tenant-scoped counter to guarantee uniqueness.
   *
   * @param {number|Date} yearOrDate — year (number) or Date (year extracted)
   * @returns {string} receipt number matching /^R-\d{4}-\d{6}$/
   */
  function generateReceiptNumber(yearOrDate) {
    const year = (yearOrDate instanceof Date)
      ? yearOrDate.getFullYear()
      : (typeof yearOrDate === 'number' ? yearOrDate : new Date().getFullYear());
    const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    return `R-${year}-${random}`;
  }

  /**
   * Format an amount with the appropriate currency symbol.
   *
   * @param {number} amount — the amount to format (negative allowed for refunds)
   * @param {string} [currency='USD'] — ISO 4217 code
   * @returns {string} formatted currency, e.g. "$1,234" or "UGX 50,000"
   */
  function formatCurrency(amount, currency) {
    const symbols = { USD: '$', EUR: '€', GBP: '£', UGX: 'UGX ', KES: 'KES ', TZS: 'TZS ' };
    const sym = symbols[currency] || `${currency || 'USD'} `;
    const n = Number(amount) || 0;
    return `${sym}${n.toLocaleString('en-US')}`;
  }

  /**
   * Format a Date as a long-form US date string, e.g. "January 15, 2026".
   * Used for human-readable dates in the PDF receipt.
   *
   * @param {Date|string|number} d — date value (Date, ISO string, or epoch)
   * @returns {string} formatted date
   */
  function formatLongDate(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return '(invalid date)';
    return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  /**
   * Build the PDF document for a 501(c)(3) receipt and pipe it to the
   * supplied writable stream (typically the Express response). Extracted
   * into a helper so the email endpoint can reuse the same rendering logic
   * (writing to a Buffer instead of the response).
   *
   * @param {object} opts — { donation, tenant, receiptNumber, issuedDate }
   * @param {import('stream').Writable} writable — destination stream
   * @returns {Promise<void>} resolves when the PDF has been fully written
   */
  function build501c3Pdf(opts, writable) {
    return new Promise((resolve, reject) => {
      try {
        const { donation, tenant, receiptNumber, issuedDate } = opts;

        // IRS quid-pro-quo disclosure (IRC §170(f)(8))
        const goodsServicesProvided = Boolean(donation.goods_services_provided);
        const goodsServicesValue = Number(donation.goods_services_value || 0);
        const currency = donation.currency || tenant.currency || 'USD';
        const deductibleAmount = goodsServicesProvided
          ? Math.max(0, Number(donation.amount) - goodsServicesValue)
          : Number(donation.amount);

        const doc = new PDFDocument({
          size: 'LETTER',
          margins: { top: 72, bottom: 72, left: 72, right: 72 },
        });

        doc.on('end', resolve);
        doc.on('error', reject);
        doc.pipe(writable);

        // === Header ===
        doc.fontSize(20).font('Helvetica-Bold')
          .text(tenant.name || '(organization name not set)', { align: 'center' });
        if (tenant.address) {
          doc.moveDown(0.2).fontSize(9).font('Helvetica')
            .text(tenant.address, { align: 'center' });
        }
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica-Bold')
          .text('Official Tax Receipt — 501(c)(3) Charitable Contribution', { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(8).font('Helvetica')
          .text(`EIN: ${tenant.ein || tenant.tax_id || '(not set)'}`, { align: 'center' });
        doc.moveDown(1);

        // Horizontal rule
        const ruleY = doc.y;
        doc.moveTo(72, ruleY).lineTo(540, ruleY).stroke();
        doc.moveDown(1);

        // === Receipt details ===
        doc.fontSize(10).font('Helvetica-Bold').text('Receipt Details', 72, doc.y);
        doc.moveDown(0.4);
        doc.font('Helvetica').fontSize(9);
        doc.text(`Receipt Number: ${receiptNumber}`, 72);
        doc.text(`Date Issued: ${formatLongDate(issuedDate)}`, 72);
        doc.moveDown(0.8);

        // === Donor information ===
        doc.fontSize(10).font('Helvetica-Bold').text('Donor Information', 72, doc.y);
        doc.moveDown(0.4);
        doc.font('Helvetica').fontSize(9);
        doc.text(`Name: ${donation.donor_name || '(anonymous)'}`, 72);
        if (donation.donor_email) doc.text(`Email: ${donation.donor_email}`, 72);
        doc.moveDown(0.8);

        // === Donation details ===
        doc.fontSize(10).font('Helvetica-Bold').text('Donation Details', 72, doc.y);
        doc.moveDown(0.4);
        doc.font('Helvetica').fontSize(9);
        doc.text(`Date Received: ${formatLongDate(donation.created_at || donation.donated_at || issuedDate)}`, 72);
        doc.text(`Amount: ${formatCurrency(donation.amount, currency)}`, 72);
        if (donation.method) doc.text(`Payment Method: ${donation.method}`, 72);
        if (donation.reference) doc.text(`Transaction Reference: ${donation.reference}`, 72);
        if (donation.campaign_title) doc.text(`Campaign: ${donation.campaign_title}`, 72);
        doc.moveDown(0.8);

        // === Tax-deductibility statement (REQUIRED by IRS Pub 1771) ===
        doc.fontSize(10).font('Helvetica-Bold').text('Tax-Deductibility Statement', 72, doc.y);
        doc.moveDown(0.4);
        doc.font('Helvetica').fontSize(9);
        if (!goodsServicesProvided) {
          doc.text(
            `${tenant.name || 'This organization'} is a qualified organization under Section 170(c) of the Internal Revenue Code. ` +
            `No goods or services were provided by the organization in return for this contribution. ` +
            `The full amount of this donation (${formatCurrency(donation.amount, currency)}) is tax-deductible to the extent allowed by law.`,
            72, doc.y, { width: 468, align: 'justify' }
          );
        } else {
          doc.text(
            `Goods or services with a fair market value of ${formatCurrency(goodsServicesValue, currency)} ` +
            `were provided in exchange for this contribution. Only the portion of the donation exceeding this value ` +
            `(${formatCurrency(deductibleAmount, currency)}) is tax-deductible under Section 170 of the Internal Revenue Code.`,
            72, doc.y, { width: 468, align: 'justify' }
          );
        }
        doc.moveDown(0.8);

        // === Authorized signature ===
        doc.fontSize(10).font('Helvetica-Bold').text('Authorized Signature', 72, doc.y);
        doc.moveDown(0.4);
        doc.font('Helvetica').fontSize(9);
        doc.text('_______________________________', 72);
        doc.text(`Authorized Official, ${tenant.name || '(organization)'}`, 72);
        doc.text(`Date: ${formatLongDate(issuedDate)}`, 72);

        doc.moveDown(1.5);

        // === Footer disclaimer ===
        doc.fontSize(7).font('Helvetica-Oblique').fillColor('#666666');
        doc.text(
          `This receipt is issued by ${tenant.name || 'the organization'} (EIN ${tenant.ein || tenant.tax_id || 'N/A'}). ` +
          `Retain this receipt for your tax records. The organization does not provide tax advice; ` +
          `consult a tax professional regarding the deductibility of your contribution. ` +
          `Receipt generated electronically on ${issuedDate.toISOString()}.`,
          72, doc.y, { width: 468, align: 'center' }
        );

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // =========================================================================
  // Routes
  // =========================================================================

  // -------------------------------------------------------------------------
  // GET /api/donations/:id/receipt/501c3
  // -------------------------------------------------------------------------
  // Generates a 501(c)(3)-compliant PDF receipt for a specific donation.
  // Idempotent: if a 501c3 receipt was already issued for this donation,
  // reuses the existing receipt_number (and issued_at timestamp).
  // -------------------------------------------------------------------------
  router.get('/donations/:id/receipt/501c3', requireAuth, ah(async (req, res) => {
    const tid = req.session.user && req.session.user.tenant_id;
    const donationId = parseInt(req.params.id, 10);
    if (!tid) return res.status(401).json({ error: 'Not authenticated' });
    if (!Number.isInteger(donationId) || donationId <= 0) {
      return res.status(400).json({ error: 'Invalid donation id' });
    }

    // Fetch the donation + tenant (tenant-scoped — never leaks cross-tenant)
    const donationResult = await pool.query(
      `SELECT d.*, t.name AS tenant_name, t.address AS tenant_address,
              t.custom_domain, t.currency AS tenant_currency,
              COALESCE(t.ein, t.tax_id) AS tenant_ein,
              t.gift_aid_registered
       FROM donations d
       JOIN tenants t ON t.id = d.tenant_id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [donationId, tid]
    );
    if (!donationResult.rows.length) {
      return res.status(404).json({ error: 'Donation not found' });
    }
    const row = donationResult.rows[0];
    const donation = row;
    const tenant = {
      name: row.tenant_name,
      address: row.tenant_address,
      custom_domain: row.custom_domain,
      currency: row.tenant_currency,
      ein: row.tenant_ein,
      tax_id: row.tenant_ein, // alias for downstream code
      gift_aid_registered: row.gift_aid_registered,
    };

    // IRS requirement: a 501(c)(3) receipt MUST carry the organization's EIN.
    if (!tenant.ein) {
      return res.status(400).json({
        error: 'Tenant does not have an EIN configured. 501(c)(3) receipts require an EIN.',
        hint: 'Set the EIN via PATCH /api/tenants/:id (tenants.ein or tenants.tax_id column) or in the tenant admin dashboard.',
      });
    }

    // Optionally fetch the campaign title if the donation is tied to one.
    if (donation.campaign_id) {
      try {
        const campaignResult = await pool.query(
          'SELECT title FROM fundraising_campaigns WHERE id = $1 AND tenant_id = $2',
          [donation.campaign_id, tid]
        );
        if (campaignResult.rows.length) {
          donation.campaign_title = campaignResult.rows[0].title;
        }
      } catch (_e) {
        // fundraising_campaigns table may not exist on this tenant yet — non-fatal.
      }
    }

    // Idempotency: reuse an existing 501c3 receipt_number if one was already
    // issued for this donation.
    let receiptNumber = null;
    let issuedDate = new Date();
    let existingReceiptId = null;
    try {
      const existing = await pool.query(
        `SELECT id, receipt_number, issued_at FROM tax_receipts
         WHERE donation_id = $1 AND tenant_id = $2 AND receipt_type = '501c3'
         ORDER BY issued_at DESC LIMIT 1`,
        [donationId, tid]
      );
      if (existing.rows.length) {
        receiptNumber = existing.rows[0].receipt_number;
        issuedDate = new Date(existing.rows[0].issued_at);
        existingReceiptId = existing.rows[0].id;
      }
    } catch (_e) {
      // tax_receipts table may not exist yet (migration 000004 not run) — non-fatal.
      // We'll still generate the PDF, just without idempotency / persistence.
    }

    if (!receiptNumber) {
      receiptNumber = generateReceiptNumber(issuedDate);
    }

    // Stream the PDF to the response.
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${receiptNumber}.pdf"`);
    res.setHeader('X-Receipt-Number', receiptNumber);
    res.setHeader('X-Receipt-Type', '501c3');

    await build501c3Pdf({ donation, tenant, receiptNumber, issuedDate }, res);

    // Persist the receipt (idempotent insert — only if not already persisted).
    if (!existingReceiptId) {
      try {
        await pool.query(
          `INSERT INTO tax_receipts
             (tenant_id, donation_id, receipt_number, receipt_type,
              donor_name, donor_email, amount, tax_deductible_amount,
              currency, issued_at, issued_by_user_id)
           VALUES ($1, $2, $3, '501c3', $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (receipt_number) DO NOTHING`,
          [
            tid, donationId, receiptNumber,
            donation.donor_name || null,
            donation.donor_email || null,
            Number(donation.amount) || 0,
            donation.goods_services_provided
              ? Math.max(0, Number(donation.amount) - Number(donation.goods_services_value || 0))
              : Number(donation.amount) || 0,
            donation.currency || tenant.currency || 'USD',
            issuedDate,
            (req.session.user && req.session.user.id) || null,
          ]
        );
      } catch (_e) {
        // Persistence failure is non-fatal — the PDF was already streamed.
      }
    }

    // Audit log (uses the project's audit() signature: email, action, details, tenantId, req)
    try {
      await audit(
        req.session.user.email,
        'tax_receipt_generated',
        JSON.stringify({
          donation_id: donationId,
          receipt_number: receiptNumber,
          type: '501c3',
          amount: donation.amount,
          currency: donation.currency || tenant.currency || 'USD',
        }),
        tid,
        req
      );
    } catch (_e) { /* audit failure is non-fatal */ }
  }));

  // -------------------------------------------------------------------------
  // GET /api/donations/:id/receipt/ira
  // -------------------------------------------------------------------------
  // Alias for the existing IRA/QCD receipt code in fundraising-ultimate10.js.
  // The legacy module uses a different export signature
  // (function(app, pool, requireAuth, ...)) and is mounted directly on `app`
  // in server.js, so we cannot invoke it from this shared-context router.
  // Instead, we return a JSON redirect pointing the caller at the canonical
  // IRA endpoints (/api/ira-rollovers/:id/tax-documents).
  // -------------------------------------------------------------------------
  router.get('/donations/:id/receipt/ira', requireAuth, ah(async (req, res) => {
    const tid = req.session.user && req.session.user.tenant_id;
    const donationId = parseInt(req.params.id, 10);
    if (!tid) return res.status(401).json({ error: 'Not authenticated' });

    res.json({
      message: 'IRA/QCD receipts are generated by the legacy fundraising-ultimate10.js module.',
      donation_id: donationId,
      alias_for: '/api/ira-rollovers/:id/tax-documents',
      hint: 'Query the ira_rollovers table for the donation_id, then call GET /api/ira-rollovers/<rollover_id>/tax-documents to retrieve the IRA tax document.',
      receipt_type: 'ira',
    });
  }));

  // -------------------------------------------------------------------------
  // GET /api/donations/:id/receipt/gift-aid
  // -------------------------------------------------------------------------
  // Alias for the existing UK Gift Aid receipt code in fundraising-mega.js.
  // Same redirect pattern as the IRA alias — the legacy module is mounted
  // directly on `app` and cannot be invoked from this router.
  // -------------------------------------------------------------------------
  router.get('/donations/:id/receipt/gift-aid', requireAuth, ah(async (req, res) => {
    const tid = req.session.user && req.session.user.tenant_id;
    const donationId = parseInt(req.params.id, 10);
    if (!tid) return res.status(401).json({ error: 'Not authenticated' });

    // Check if tenant has registered for Gift Aid (HMRC requirement).
    let registered = false;
    try {
      const r = await pool.query(
        'SELECT gift_aid_registered FROM tenants WHERE id = $1',
        [tid]
      );
      registered = Boolean(r.rows[0] && r.rows[0].gift_aid_registered);
    } catch (_e) { /* column may not exist yet — non-fatal */ }

    res.json({
      message: 'Gift Aid receipts are generated by the legacy fundraising-mega.js module.',
      donation_id: donationId,
      alias_for: '/api/tax-receipts',
      gift_aid_registered: registered,
      hint: registered
        ? 'POST /api/tax-receipts with {donation_id, donor_name, donor_email, amount, tax_deductible_amount} to issue a Gift Aid receipt.'
        : 'Tenant has not registered for Gift Aid. Set tenants.gift_aid_registered = true via PATCH /api/tenants/:id first.',
      receipt_type: 'gift_aid',
    });
  }));

  // -------------------------------------------------------------------------
  // POST /api/donations/:id/receipt/email
  // -------------------------------------------------------------------------
  // Generates a 501(c)(3) receipt (or aliases IRA/Gift Aid) and emails it
  // to the donor's email address. Body: { receipt_type: '501c3' | 'ira' | 'gift_aid' }.
  //
  // For 501c3: generates the PDF, attaches it to a nodemailer message.
  // For ira/gift_aid: returns a redirect response (the legacy modules do
  // their own email sending — calling them from here would duplicate work).
  // -------------------------------------------------------------------------
  router.post('/donations/:id/receipt/email', requireAuth, ah(async (req, res) => {
    const tid = req.session.user && req.session.user.tenant_id;
    const donationId = parseInt(req.params.id, 10);
    const { receipt_type = '501c3' } = req.body || {};

    if (!tid) return res.status(401).json({ error: 'Not authenticated' });
    if (!Number.isInteger(donationId) || donationId <= 0) {
      return res.status(400).json({ error: 'Invalid donation id' });
    }
    if (!['501c3', 'ira', 'gift_aid'].includes(receipt_type)) {
      return res.status(400).json({ error: 'receipt_type must be 501c3, ira, or gift_aid' });
    }

    // IRA / Gift Aid: alias to legacy endpoints (which send their own emails).
    if (receipt_type === 'ira') {
      return res.json({
        message: 'IRA receipts are emailed by the legacy fundraising-ultimate10.js module.',
        donation_id: donationId,
        receipt_type,
        alias_for: '/api/ira-rollovers/:id/tax-documents',
      });
    }
    if (receipt_type === 'gift_aid') {
      return res.json({
        message: 'Gift Aid receipts are emailed by the legacy fundraising-mega.js module.',
        donation_id: donationId,
        receipt_type,
        alias_for: '/api/tax-receipts',
      });
    }

    // 501c3: generate the PDF to a Buffer and email it via nodemailer.
    const donationResult = await pool.query(
      `SELECT d.*, COALESCE(t.ein, t.tax_id) AS tenant_ein, t.name AS tenant_name,
              t.address AS tenant_address, t.currency AS tenant_currency
       FROM donations d
       JOIN tenants t ON t.id = d.tenant_id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [donationId, tid]
    );
    if (!donationResult.rows.length) {
      return res.status(404).json({ error: 'Donation not found' });
    }
    const row = donationResult.rows[0];
    const donation = row;
    const tenant = {
      name: row.tenant_name,
      address: row.tenant_address,
      currency: row.tenant_currency,
      ein: row.tenant_ein,
      tax_id: row.tenant_ein,
    };

    if (!tenant.ein) {
      return res.status(400).json({
        error: 'Tenant does not have an EIN configured. 501(c)(3) receipts require an EIN.',
      });
    }
    if (!donation.donor_email) {
      return res.status(400).json({
        error: 'Donation has no donor_email — cannot send receipt',
        hint: 'Set donations.donor_email via PATCH /api/donations/:id before calling this endpoint.',
      });
    }

    // Generate the receipt number (idempotent lookup, same as the GET endpoint).
    let receiptNumber = null;
    let issuedDate = new Date();
    try {
      const existing = await pool.query(
        `SELECT receipt_number, issued_at FROM tax_receipts
         WHERE donation_id = $1 AND tenant_id = $2 AND receipt_type = '501c3'
         ORDER BY issued_at DESC LIMIT 1`,
        [donationId, tid]
      );
      if (existing.rows.length) {
        receiptNumber = existing.rows[0].receipt_number;
        issuedDate = new Date(existing.rows[0].issued_at);
      }
    } catch (_e) { /* non-fatal */ }
    if (!receiptNumber) {
      receiptNumber = generateReceiptNumber(issuedDate);
    }

    // Render the PDF to an in-memory Buffer.
    const { Writable } = require('stream');
    const chunks = [];
    const bufferStream = new Writable({
      write(chunk, encoding, cb) { chunks.push(chunk); cb(); },
    });
    await build501c3Pdf({ donation, tenant, receiptNumber, issuedDate }, bufferStream);
    const pdfBuffer = Buffer.concat(chunks);

    // Send the email via nodemailer if configured. Look up the transport
    // the same way server.js does (it stores the configured transporter on
    // globalThis.comfortZoneMailer, set during server boot).
    let emailSent = false;
    let emailError = null;
    const mailer = (typeof globalThis !== 'undefined' && globalThis.comfortZoneMailer) || null;
    if (mailer && typeof mailer.sendMail === 'function') {
      try {
        await mailer.sendMail({
          from: process.env.SMTP_FROM || `"${tenant.name}" <noreply@ssewasswa.onrender.com>`,
          to: donation.donor_email,
          subject: `Tax Receipt ${receiptNumber} — ${tenant.name}`,
          text: `Dear ${donation.donor_name || 'Donor'},\n\n` +
                `Please find attached your 501(c)(3) tax receipt for your donation of ` +
                `${formatCurrency(donation.amount, donation.currency || tenant.currency || 'USD')} ` +
                `received on ${formatLongDate(donation.created_at || issuedDate)}.\n\n` +
                `Receipt Number: ${receiptNumber}\n` +
                `Organization: ${tenant.name}\n` +
                `EIN: ${tenant.ein}\n\n` +
                `Retain this receipt for your tax records. The organization does not provide ` +
                `tax advice; consult a tax professional regarding the deductibility of your contribution.\n\n` +
                `Thank you for your generosity.\n` +
                `${tenant.name}`,
          attachments: [
            {
              filename: `receipt-${receiptNumber}.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf',
            },
          ],
        });
        emailSent = true;
      } catch (e) {
        emailError = e.message;
      }
    } else {
      emailError = 'Mailer not configured (globalThis.comfortZoneMailer not set). Set SMTP_* env vars and restart the server.';
    }

    // Audit log.
    try {
      await audit(
        req.session.user.email,
        emailSent ? 'tax_receipt_emailed' : 'tax_receipt_email_failed',
        JSON.stringify({
          donation_id: donationId,
          receipt_number: receiptNumber,
          type: '501c3',
          donor_email: donation.donor_email,
          error: emailError,
        }),
        tid,
        req
      );
    } catch (_e) { /* non-fatal */ }

    if (emailSent) {
      res.json({
        message: `Receipt emailed to ${donation.donor_email}`,
        receipt_type: '501c3',
        donation_id: donationId,
        receipt_number: receiptNumber,
      });
    } else {
      res.status(502).json({
        error: 'Failed to send email',
        detail: emailError,
        receipt_number: receiptNumber,
        hint: 'The PDF was generated successfully but could not be emailed. Check SMTP_* env vars and server logs.',
      });
    }
  }));

  // -------------------------------------------------------------------------
  // GET /api/tenants/:id/receipts/summary
  // -------------------------------------------------------------------------
  // Year-end summary of all donations + receipts issued for a tenant.
  // Used by donors / accountants for tax prep. Accepts ?year=YYYY (defaults
  // to current year). Returns JSON; an Excel/CSV export can be added later.
  // -------------------------------------------------------------------------
  router.get('/tenants/:id/receipts/summary', requireAuth, ah(async (req, res) => {
    const sessionTid = req.session.user && req.session.user.tenant_id;
    const pathTid = parseInt(req.params.id, 10);
    if (!sessionTid) return res.status(401).json({ error: 'Not authenticated' });

    // Tenants can only fetch their own summary (no cross-tenant snooping).
    if (sessionTid !== pathTid) {
      return res.status(403).json({ error: 'Forbidden — can only view receipts summary for your own tenant' });
    }

    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    if (year < 1990 || year > 2100) {
      return res.status(400).json({ error: 'Invalid year (must be 1990-2100)' });
    }

    // Aggregate donations for the year.
    let donations = [];
    try {
      const r = await pool.query(
        `SELECT id, donor_name, donor_email, amount, currency, method, reference,
                created_at, goods_services_provided, goods_services_value
         FROM donations
         WHERE tenant_id = $1
           AND EXTRACT(YEAR FROM created_at) = $2
         ORDER BY created_at ASC`,
        [pathTid, year]
      );
      donations = r.rows;
    } catch (e) {
      return res.status(500).json({
        error: 'Failed to query donations',
        detail: e.message,
        hint: 'Run migration 000004 (npm run migrate) to ensure the donations table has the required columns.',
      });
    }

    // Aggregate receipts issued for the year.
    let receipts = [];
    try {
      const r = await pool.query(
        `SELECT id, donation_id, receipt_number, receipt_type, donor_name, donor_email,
                amount, tax_deductible_amount, currency, issued_at
         FROM tax_receipts
         WHERE tenant_id = $1
           AND EXTRACT(YEAR FROM issued_at) = $2
         ORDER BY issued_at ASC`,
        [pathTid, year]
      );
      receipts = r.rows;
    } catch (_e) {
      // tax_receipts table may not exist yet — non-fatal, return empty array.
    }

    // Compute totals.
    const totalDonated = donations.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
    const totalDeductible = donations.reduce((sum, d) => {
      const amt = Number(d.amount) || 0;
      if (d.goods_services_provided) {
        return sum + Math.max(0, amt - (Number(d.goods_services_value) || 0));
      }
      return sum + amt;
    }, 0);
    const totalReceiptsIssued = receipts.length;
    const donationsWithoutReceipt = donations.filter(
      (d) => !receipts.some((r) => r.donation_id === d.id)
    ).length;

    // Currency breakdown (donations may be in mixed currencies).
    const byCurrency = {};
    for (const d of donations) {
      const c = d.currency || 'USD';
      if (!byCurrency[c]) byCurrency[c] = { count: 0, total: 0, deductible: 0 };
      byCurrency[c].count += 1;
      byCurrency[c].total += Number(d.amount) || 0;
      if (d.goods_services_provided) {
        byCurrency[c].deductible += Math.max(0, (Number(d.amount) || 0) - (Number(d.goods_services_value) || 0));
      } else {
        byCurrency[c].deductible += Number(d.amount) || 0;
      }
    }

    res.json({
      tenant_id: pathTid,
      year,
      total_donations: donations.length,
      total_donated: totalDonated,
      total_tax_deductible: totalDeductible,
      total_receipts_issued: totalReceiptsIssued,
      donations_without_receipt: donationsWithoutReceipt,
      by_currency: byCurrency,
      donations,
      receipts,
      generated_at: new Date().toISOString(),
      disclaimer: 'This summary is provided for informational purposes only and does not constitute tax advice. Consult a tax professional regarding the deductibility of your contributions.',
    });
  }));

  // Expose helpers on the router so unit tests can reach them without
  // making HTTP requests. (Pattern used by other route modules in this repo.)
  router._generateReceiptNumber = generateReceiptNumber;
  router._formatCurrency = formatCurrency;
  router._formatLongDate = formatLongDate;
  router._build501c3Pdf = build501c3Pdf;

  return router;
};
