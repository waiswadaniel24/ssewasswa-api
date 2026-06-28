/**
 * Migration 000003 — HIPAA PHI encryption columns + audit log
 *
 * Adds the schema support needed by src/lib/hipaa-encryption.js and
 * src/routes/clinic-hipaa.js:
 *
 *   1. `phi_encrypted` BOOLEAN column on the three PHI-bearing tables:
 *        - patient_portal_users  (the de-facto "patients" table on this
 *                                 platform — stores full_name, date_of_birth,
 *                                 phone, address, email, emergency contacts)
 *        - consultations         (diagnosis, treatment_plan, history,
 *                                 examination, chief_complaint, notes)
 *        - prescriptions         (diagnosis, notes)
 *      This column tracks which rows have been migrated from plaintext to
 *      ciphertext, so a phased backfill can run without locking the table.
 *
 *   2. `phi_encryption_key_id` TEXT column on `tenants`:
 *      Holds the per-tenant encrypted Data Encryption Key (DEK) returned
 *      by KMS in production. NULL means "use the global env-var key" (dev
 *      mode). See src/lib/kms.js for the envelope-encryption flow.
 *
 *   3. `phi_encryption_audit_log` table:
 *      One row per encrypt/decrypt/rotate action on a PHI field. Required
 *      by HIPAA §164.312(b) ("Audit controls") — every access to PHI must
 *      be logged with enough detail to reconstruct who accessed what.
 *
 * Pattern: uses pgm.sql() with `IF NOT EXISTS` clauses, matching the
 * "lift and shift" convention from migrations/000001 and 000002. Each
 * statement is idempotent so re-running the migration (e.g. after a
 * deploy rollback) is safe.
 *
 * Down: drops the audit table and the new columns. The actual PHI
 * ciphertext values in the columns are left in place — decrypting them
 * back to plaintext during a down-migration would require the key and
 * is the operator's responsibility (see docs/HIPAA_COMPLIANCE.md
 * "Rolling back the migration").
 */

module.exports = {
  up: (pgm) => {
    // -----------------------------------------------------------------------
    // 1. Per-row "is this row's PHI encrypted?" flag.
    // -----------------------------------------------------------------------
    // FALSE on existing rows (legacy plaintext), TRUE on rows written after
    // clinic-hipaa.js is mounted. The clinic-hipaa.js wrapper consults this
    // flag during the phased backfill to decide whether to decrypt on read.
    pgm.sql(`ALTER TABLE patient_portal_users ADD COLUMN IF NOT EXISTS phi_encrypted BOOLEAN DEFAULT false`);
    pgm.sql(`ALTER TABLE consultations ADD COLUMN IF NOT EXISTS phi_encrypted BOOLEAN DEFAULT false`);
    pgm.sql(`ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS phi_encrypted BOOLEAN DEFAULT false`);

    // -----------------------------------------------------------------------
    // 2. Per-tenant encrypted DEK pointer (KMS envelope encryption).
    // -----------------------------------------------------------------------
    // NULL = use the global env-var key (dev/staging). Non-NULL = base64 of
    // the ciphertext blob returned by KMS encrypt() on the per-tenant DEK.
    // See src/lib/kms.js for the runtime flow.
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phi_encryption_key_id TEXT`);

    // -----------------------------------------------------------------------
    // 3. PHI access audit log.
    // -----------------------------------------------------------------------
    // HIPAA §164.312(b): "Implement hardware, software, and/or procedural
    // mechanisms that record and examine activity in systems containing or
    // using electronic protected health information."
    //
    // We log one row per field-level encrypt/decrypt/rotate action. The
    // `field_name` column may also be a comma-separated list when an
    // operation covers multiple fields on the same record (e.g. encrypting
    // name+dob+phone+address on a new patient insert logs a single row
    // with field_name='name,date_of_birth,phone,address').
    pgm.sql(`CREATE TABLE IF NOT EXISTS phi_encryption_audit_log (
      id BIGSERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      table_name TEXT NOT NULL,
      record_id INTEGER NOT NULL,
      field_name TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_user_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);

    // Most common query: "show me recent PHI access for tenant X" — used by
    // the HIPAA audit dashboard and by the breach-notification workflow.
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_phi_audit_tenant
             ON phi_encryption_audit_log(tenant_id, created_at DESC)`);

    // "Show me everyone who accessed patient Y's PHI" — used for patient
    // access reports (HIPAA §164.528 right of access).
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_phi_audit_record
             ON phi_encryption_audit_log(table_name, record_id, created_at DESC)`);

    // "Show me all key rotations" — used by the key-rotation runbook.
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_phi_audit_action
             ON phi_encryption_audit_log(action, created_at DESC)
             WHERE action = 'rotate'`);
  },

  down: (pgm) => {
    // Drop the audit table first (no FKs depend on it).
    pgm.sql(`DROP TABLE IF EXISTS phi_encryption_audit_log CASCADE`);

    // Drop the per-tenant DEK column. NOTE: if any tenant has an encrypted
    // DEK stored here, dropping the column means the operator loses the
    // ability to decrypt that tenant's PHI via KMS — see
    // docs/HIPAA_COMPLIANCE.md "Rolling back the migration".
    pgm.sql(`ALTER TABLE tenants DROP COLUMN IF EXISTS phi_encryption_key_id`);

    // Drop the per-row encryption flag. The ciphertext values in the
    // underlying columns are left in place — they will need to be
    // decrypted back to plaintext manually before this down-migration is
    // run if the operator wants the rows to be readable without the
    // hipaa-encryption.js module.
    pgm.sql(`ALTER TABLE patient_portal_users DROP COLUMN IF EXISTS phi_encrypted`);
    pgm.sql(`ALTER TABLE consultations DROP COLUMN IF EXISTS phi_encrypted`);
    pgm.sql(`ALTER TABLE prescriptions DROP COLUMN IF EXISTS phi_encrypted`);
  },
};
