/**
 * Migration 000008 — Stripe Connect onboarding (Gap 7)
 *
 * Adds the per-tenant Stripe Connect account columns required by
 * src/routes/stripe-connect.js and already-consumed by src/routes/payments-stripe.js
 * (Track B reads `tenants.stripe_account_id` to decide whether to attach
 * `transfer_data.destination` + `application_fee_amount` to a PaymentIntent).
 *
 * Schema additions on `tenants`:
 *   - stripe_account_id          VARCHAR(100)  Stripe Express Account ID (acct_...)
 *                                            NULL until the tenant clicks
 *                                            "Connect Stripe" and we create
 *                                            the account via the Stripe API.
 *   - stripe_onboarding_complete BOOLEAN      Mirror of Stripe's
 *                                            `details_submitted` flag — set
 *                                            true once the tenant has finished
 *                                            the onboarding form.
 *   - stripe_charges_enabled     BOOLEAN      Mirror of Stripe's
 *                                            `charges_enabled` flag — true
 *                                            means the tenant can accept
 *                                            payments.
 *   - stripe_payouts_enabled     BOOLEAN      Mirror of Stripe's
 *                                            `payouts_enabled` flag — true
 *                                            means Stripe will pay out to
 *                                            the tenant's bank account.
 *   - stripe_details_submitted   BOOLEAN      Mirror of Stripe's
 *                                            `details_submitted` flag —
 *                                            alias of onboarding_complete.
 *
 * New table `stripe_connect_audit`:
 *   One row per Stripe Connect lifecycle event for a tenant
 *   (account_created, account_updated, account_deauthorized).
 *   Required for tenant-visible audit history and for debugging
 *   "why isn't my Stripe account accepting payments?" tickets.
 *
 * Pattern: uses pgm.sql() with `IF NOT EXISTS` clauses, matching the
 * convention from migrations/000001, 000002, 000003. Each statement is
 * idempotent so re-running the migration (e.g. after a deploy rollback)
 * is safe.
 *
 * Down: drops the audit table but DOES NOT drop the tenants columns —
 * a tenant may have already connected a real Stripe account, and dropping
 * the column would orphan the account on Stripe's side. The operator must
 * explicitly DROP COLUMN if they want to remove the data.
 */

module.exports = {
  up: (pgm) => {
    // -----------------------------------------------------------------------
    // 1. Per-tenant Stripe Connect account columns.
    // -----------------------------------------------------------------------
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_account_id VARCHAR(100)`);
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_onboarding_complete BOOLEAN DEFAULT false`);
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN DEFAULT false`);
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN DEFAULT false`);
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_details_submitted BOOLEAN DEFAULT false`);

    // -----------------------------------------------------------------------
    // 2. Stripe Connect lifecycle audit log.
    // -----------------------------------------------------------------------
    // One row per event in the Connect lifecycle for a tenant:
    //   - account_created       — tenant clicked "Connect Stripe" for the
    //                             first time; we created an Express Account.
    //   - account_updated       — Stripe sent account.updated webhook;
    //                             charges/payouts flags may have changed.
    //   - account_deauthorized  — tenant revoked the platform's access to
    //                             their Stripe account; we cleared the
    //                             tenant's stripe_* columns.
    pgm.sql(`
      CREATE TABLE IF NOT EXISTS stripe_connect_audit (
        id BIGSERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        account_id VARCHAR(100),
        details JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Most common query: "show me the recent Connect events for tenant X"
    // — used by the tenant's payment-settings page and by support.
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_stripe_audit_tenant
             ON stripe_connect_audit(tenant_id, created_at DESC)`);
  },

  down: (pgm) => {
    // Drop the audit table first (FK depends on tenants, not vice versa).
    pgm.sql(`DROP TABLE IF EXISTS stripe_connect_audit`);

    // INTENTIONALLY DO NOT drop the tenants.stripe_* columns.
    //
    // A tenant may have already connected a real Stripe account and may
    // already be receiving payouts. Dropping the column would orphan the
    // Express account on Stripe's side (the platform would lose the
    // account_id and could no longer route payments to it).
    //
    // If an operator truly wants to wipe Connect data for a tenant, they
    // should run a SQL UPDATE to set stripe_account_id = NULL (which the
    // account_deauthorized webhook handler already does) and then DROP
    // the columns manually after verifying no production traffic depends
    // on them.
  },
};
