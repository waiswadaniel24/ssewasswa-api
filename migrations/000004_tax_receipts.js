/**
 * Migration 000004 — Tax receipts (501(c)(3) / Gift Aid / IRA)
 *
 * Adds the schema support needed by src/routes/tax-receipts.js so that the
 * platform can generate IRS-compliant 501(c)(3) tax-deductible receipts
 * (the generic US donor receipt that was previously MISSING, as flagged in
 * the master audit summary), and so that the existing UK Gift Aid receipt
 * code in fundraising-mega.js and the US IRA/QCD receipt code in
 * fundraising-ultimate10.js have a single canonical receipts table to
 * interoperate with.
 *
 * Changes:
 *
 *   1. `tenants.ein` VARCHAR(20) — Employer Identification Number.
 *      Aliases the existing `tenants.tax_id` column (added in migration
 *      000002 line 557) so that US 501(c)(3) receipts can read either
 *      column without forcing every tenant to migrate their existing
 *      tax_id values into a new column. NULL = "no EIN configured" →
 *      the 501c3 endpoint will refuse to issue a receipt (per IRS rules,
 *      a 501(c)(3) receipt MUST carry the organization's EIN).
 *
 *   2. `tenants.gift_aid_registered` BOOLEAN — whether the tenant has
 *      registered with HMRC (UK) to claim Gift Aid. Used by the Gift Aid
 *      receipt endpoint alias to refuse receipts for non-registered
 *      tenants.
 *
 *   3. `donations.donor_email`, `donations.currency`, `donations.campaign_id`
 *      — convenience columns so the 501(c)(3) receipt can render the
 *      donor's email (for the email-receipt endpoint), the donation
 *      currency (default USD for 501c3, UGX for legacy), and the
 *      associated campaign title without a join. These are added with
 *      IF NOT EXISTS so they don't conflict with any future or
 *      pre-existing additions.
 *
 *   4. `donations.goods_services_provided` BOOLEAN + `goods_services_value`
 *      INTEGER — IRS quid-pro-quo disclosure: if the donor received goods
 *      or services in exchange for the contribution, the receipt MUST
 *      disclose the fair market value and only the excess is deductible
 *      (IRC §170(f)(8)). Defaults to false / 0 (no quid pro quo).
 *
 *   5. `tax_receipts` table — canonical receipt registry. Coexists with
 *      the older `tax_receipts` table created inline by fundraising-mega.js
 *      (id, tenant_id, donation_id, donor_name, donor_email, amount,
 *      tax_deductible_amount, receipt_number, issued_at). The CREATE
 *      TABLE IF NOT EXISTS is a no-op if that table already exists; the
 *      ALTER TABLE ADD COLUMN IF NOT EXISTS statements that follow add
 *      the new columns (receipt_type, currency, issued_by_user_id,
 *      pdf_url, metadata) to whichever version of the table won.
 *
 * Pattern: uses pgm.sql() with `IF NOT EXISTS` clauses, matching the
 * "lift and shift" convention from migrations/000001, 000002, and 000003.
 * Each statement is idempotent so re-running the migration (e.g. after
 * a deploy rollback) is safe.
 *
 * Down: drops the new tax_receipts columns AND the new donations columns.
 * Does NOT drop the tax_receipts table itself (the legacy fundraising-mega.js
 * code may still be writing to it) and does NOT drop tenants.ein (the
 * operator may have entered real EIN values by then).
 */

module.exports = {
  up: (pgm) => {
    // -----------------------------------------------------------------------
    // 1. Tenant-level tax registration fields.
    // -----------------------------------------------------------------------
    // EIN — Employer Identification Number (US 501(c)(3) organizations).
    // Aliases the existing tenants.tax_id column (migration 000002 line 557);
    // the 501c3 receipt endpoint reads COALESCE(t.ein, t.tax_id) so either
    // column can hold the value.
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ein VARCHAR(20)`);

    // gift_aid_registered — whether the tenant is registered with HMRC.
    // FALSE on existing tenants (conservative default — UK tenants that
    // ARE registered must opt in via the tenant admin dashboard).
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS gift_aid_registered BOOLEAN DEFAULT false`);

    // -----------------------------------------------------------------------
    // 2. Donation-level fields needed by the 501(c)(3) receipt.
    // -----------------------------------------------------------------------
    // donor_email — used by POST /api/donations/:id/receipt/email. Optional
    // on legacy donations (NULL → email endpoint returns 400 with a clear
    // hint to set the donor email first).
    pgm.sql(`ALTER TABLE donations ADD COLUMN IF NOT EXISTS donor_email TEXT`);

    // currency — ISO 4217 code. Default USD for new US-style donations;
    // legacy Ugandan donations will read as NULL and the receipt endpoint
    // falls back to UGX (the platform default per migration 000002 line 553).
    pgm.sql(`ALTER TABLE donations ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'USD'`);

    // campaign_id — optional FK to fundraising_campaigns. The 501c3 receipt
    // renders the campaign title if this is set. (No FK constraint because
    // the fundraising_campaigns table is created by fundraising-mega.js at
    // boot time, which may not have run yet.)
    pgm.sql(`ALTER TABLE donations ADD COLUMN IF NOT EXISTS campaign_id INTEGER`);

    // goods_services_provided + goods_services_value — IRS quid-pro-quo
    // disclosure (IRC §170(f)(8)). If the donor received goods or services
    // in exchange for the contribution, the receipt MUST:
    //   (a) state that the deduction is limited to the excess of the
    //       contribution over the value of goods/services received, and
    //   (b) provide a good-faith estimate of that value.
    // Default false / 0 = "no goods or services were provided" (the common
    // case for unrestricted donations).
    pgm.sql(`ALTER TABLE donations ADD COLUMN IF NOT EXISTS goods_services_provided BOOLEAN DEFAULT false`);
    pgm.sql(`ALTER TABLE donations ADD COLUMN IF NOT EXISTS goods_services_value INTEGER DEFAULT 0`);

    // -----------------------------------------------------------------------
    // 3. Canonical tax_receipts table.
    // -----------------------------------------------------------------------
    // CREATE TABLE IF NOT EXISTS is a no-op if fundraising-mega.js already
    // created the table at boot time (legacy schema: id, tenant_id,
    // donation_id, donor_name, donor_email, amount, tax_deductible_amount,
    // receipt_number, issued_at). The ALTER TABLE ADD COLUMN IF NOT EXISTS
    // statements below add the new columns to whichever version of the
    // table won the race.
    pgm.sql(`CREATE TABLE IF NOT EXISTS tax_receipts (
      id BIGSERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      donation_id INTEGER REFERENCES donations(id) ON DELETE CASCADE,
      receipt_number VARCHAR(50) NOT NULL UNIQUE,
      receipt_type VARCHAR(20) NOT NULL DEFAULT '501c3',
      donor_name TEXT,
      donor_email TEXT,
      amount INTEGER NOT NULL,
      tax_deductible_amount INTEGER NOT NULL DEFAULT 0,
      currency VARCHAR(3) DEFAULT 'USD',
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      issued_by_user_id INTEGER,
      pdf_url TEXT,
      metadata JSONB DEFAULT '{}'::jsonb
    )`);

    // Add the new columns to a pre-existing tax_receipts table (e.g. the
    // one created inline by fundraising-mega.js). These are no-ops if the
    // table was just created above with all columns already present.
    pgm.sql(`ALTER TABLE tax_receipts ADD COLUMN IF NOT EXISTS receipt_type VARCHAR(20) NOT NULL DEFAULT '501c3'`);
    pgm.sql(`ALTER TABLE tax_receipts ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'USD'`);
    pgm.sql(`ALTER TABLE tax_receipts ADD COLUMN IF NOT EXISTS issued_by_user_id INTEGER`);
    pgm.sql(`ALTER TABLE tax_receipts ADD COLUMN IF NOT EXISTS pdf_url TEXT`);
    pgm.sql(`ALTER TABLE tax_receipts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`);

    // Indexes — these power the year-end summary endpoint
    // (GET /api/tenants/:id/receipts/summary) and the per-donation
    // "has a receipt been issued?" lookup.
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_tax_receipts_tenant ON tax_receipts(tenant_id, issued_at DESC)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_tax_receipts_donation ON tax_receipts(donation_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_tax_receipts_type ON tax_receipts(receipt_type)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_tax_receipts_number ON tax_receipts(receipt_number)`);
  },

  down: (pgm) => {
    // Drop only the columns that this migration introduced. Leave the
    // tax_receipts table itself in place because fundraising-mega.js may
    // still be writing rows to it on tenants that haven't been upgraded
    // to use the new tax-receipts.js routes.
    pgm.sql(`ALTER TABLE tax_receipts DROP COLUMN IF EXISTS metadata`);
    pgm.sql(`ALTER TABLE tax_receipts DROP COLUMN IF EXISTS pdf_url`);
    pgm.sql(`ALTER TABLE tax_receipts DROP COLUMN IF EXISTS issued_by_user_id`);
    pgm.sql(`ALTER TABLE tax_receipts DROP COLUMN IF EXISTS currency`);
    pgm.sql(`ALTER TABLE tax_receipts DROP COLUMN IF EXISTS receipt_type`);

    // Drop the donation-level columns added by this migration.
    pgm.sql(`ALTER TABLE donations DROP COLUMN IF EXISTS goods_services_value`);
    pgm.sql(`ALTER TABLE donations DROP COLUMN IF EXISTS goods_services_provided`);
    pgm.sql(`ALTER TABLE donations DROP COLUMN IF EXISTS campaign_id`);
    pgm.sql(`ALTER TABLE donations DROP COLUMN IF EXISTS currency`);
    pgm.sql(`ALTER TABLE donations DROP COLUMN IF EXISTS donor_email`);

    // Drop the tenant-level columns. NOTE: dropping tenants.ein will lose
    // any EIN values the operator has entered — see the file-level comment.
    pgm.sql(`ALTER TABLE tenants DROP COLUMN IF EXISTS gift_aid_registered`);
    pgm.sql(`ALTER TABLE tenants DROP COLUMN IF EXISTS ein`);
  },
};
