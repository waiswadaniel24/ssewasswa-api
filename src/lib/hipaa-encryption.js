// src/lib/hipaa-encryption.js
//
// HIPAA-compliant AES-256-GCM field-level encryption for PHI
// (Protected Health Information) in EMR records.
//
// Why this exists:
//   - The master summary of the platform promises that "sensitive healthcare
//     data (Electronic Medical Records) is symmetrically encrypted using
//     AES-256 keys managed by cloud KMS before being written to disk."
//   - The existing `security-ops.js` module uses AES-256-GCM only for TOTP
//     secrets at rest — patient data is stored in plaintext.
//   - `security-auth-dashboard.js` even shows the gap explicitly:
//     "PII Fields, AES-256, Partial" (line 529).
//   - This module closes that gap: it provides a dedicated PHI encryption
//     key (separate from the TOTP key), binds ciphertext to the specific
//     tenant + patient + field via AES-GCM Additional Authenticated Data
//     (AAD), and exposes hooks for KMS-managed keys + key rotation.
//
// Algorithm: AES-256-GCM (NIST SP 800-38D), 96-bit IV, 128-bit auth tag.
//   The same algorithm the existing `security-ops.js` uses for TOTP secrets,
//   so the crypto primitives are already proven in this codebase.
//
// Ciphertext format (single colon-delimited string, versioned):
//   v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
//
// AAD (Additional Authenticated Data) format:
//   "<tenant_id>|<patient_id>|<field_name>"
//   The auth tag covers both the ciphertext AND the AAD, so swapping a
//   ciphertext between two patients (or two fields) causes decryption to
//   throw — this is the cryptographic guarantee that ciphertexts can't be
//   "moved" between records undetected.
//
// Key management:
//   - Dev / test: PHI_ENCRYPTION_KEY or ENCRYPTION_KEY env var (64 hex chars).
//   - Production: KMS envelope encryption (see src/lib/kms.js). A per-tenant
//     Data Encryption Key (DEK) is generated, encrypted with the KMS master
//     key, stored in `tenants.phi_encryption_key_id`, and decrypted at boot
//     into process memory for the lifetime of the process. The master key
//     never leaves KMS.
//
// Module exports:
//   encryptPHI(plaintext, context) -> string | null | original
//   decryptPHI(ciphertext, context) -> string | null | original
//   isEncrypted(value)             -> boolean
//   rotatePHIKey(oldKeyHex, newKeyHex, pool, table, columns, tenantId)
//                                  -> throws (stub — see HIPAA_COMPLIANCE.md)
//   getPHIKey()                    -> Buffer (32 bytes)
//   ALGO                           -> 'aes-256-gcm' (exported for tests/docs)

'use strict';

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';
const IV_LENGTH = 12; // 96-bit IV — recommended by NIST SP 800-38D for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/**
 * Resolve the 32-byte (256-bit) AES key used to encrypt PHI fields.
 *
 * Resolution order:
 *   1. process.env.PHI_ENCRYPTION_KEY — dedicated PHI key (recommended)
 *   2. process.env.ENCRYPTION_KEY     — general-purpose app encryption key
 *      (acceptable as a fallback; ideally PHI gets its own key)
 *
 * Either env var may be:
 *   - 64 hex characters (= 32 raw bytes) — used directly
 *   - Any other length — SHA-256 hashed to produce a 32-byte key
 *
 * In production, `process.env.PHI_ENCRYPTION_KEY` should be populated at boot
 * by `src/lib/kms.js` (which decrypts the per-tenant DEK via KMS and stashes
 * it in process.env). The master key never leaves KMS.
 *
 * @returns {Buffer} 32-byte AES-256 key
 * @throws {Error} if neither env var is set
 */
function getPHIKey() {
  const keyHex = process.env.PHI_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (!keyHex || typeof keyHex !== 'string' || keyHex.length === 0) {
    throw new Error(
      'HIPAA encryption requires PHI_ENCRYPTION_KEY or ENCRYPTION_KEY env var. ' +
      'See docs/HIPAA_COMPLIANCE.md for setup instructions.'
    );
  }
  // If exactly 64 hex chars, use directly as raw 32 bytes. Otherwise hash to
  // produce a deterministic 32-byte key. This lets operators paste either a
  // raw hex key or an arbitrary passphrase-style string.
  if (/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    return Buffer.from(keyHex, 'hex');
  }
  return crypto.createHash('sha256').update(keyHex).digest();
}

// ---------------------------------------------------------------------------
// AAD (Additional Authenticated Data) construction
// ---------------------------------------------------------------------------

/**
 * Build the AAD buffer that binds a ciphertext to a specific
 * tenant + patient + field. Decryption with the wrong AAD throws —
 * this is the cryptographic guarantee that ciphertexts can't be moved
 * between records undetected.
 *
 * @param {{tenant_id: number|string, patient_id: number|string, field_name: string}} context
 * @returns {Buffer}
 */
function buildAAD(context) {
  if (!context || context.tenant_id == null || context.patient_id == null || !context.field_name) {
    throw new Error(
      'HIPAA encryption requires context = { tenant_id, patient_id, field_name } ' +
      'so ciphertexts are bound to a specific record (AAD).'
    );
  }
  return Buffer.from(`${context.tenant_id}|${context.patient_id}|${context.field_name}`, 'utf8');
}

// ---------------------------------------------------------------------------
// encrypt / decrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a PHI field value with AES-256-GCM, binding the ciphertext to the
 * supplied context via AAD.
 *
 * - null / undefined / empty string are returned as-is (we don't encrypt
 *   "no data" — that would just bloat the row and add audit-log noise).
 * - Non-string inputs are coerced to String (e.g. Date objects, numbers).
 * - The IV is a fresh 96-bit random buffer per call, so two encryptions of
 *   the same plaintext produce different ciphertexts.
 *
 * @param {string|null|undefined} plaintext
 * @param {{tenant_id, patient_id, field_name}} context
 * @returns {string} "v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>" or the original falsy value
 */
function encryptPHI(plaintext, context) {
  if (plaintext == null || plaintext === '') return plaintext;
  if (typeof plaintext !== 'string') plaintext = String(plaintext);

  const key = getPHIKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(buildAAD(context));
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Decrypt a value produced by `encryptPHI`. The context MUST match the
 * context used at encryption time (same tenant_id + patient_id + field_name)
 * or decryption throws (AES-GCM auth tag verification fails).
 *
 * - null / undefined / empty string are returned as-is.
 * - Values that don't start with "v1:" are returned unchanged (allows the
 *   function to be a safe no-op on legacy plaintext rows during a phased
 *   rollout — see HIPAA_COMPLIANCE.md "Phased rollout" section).
 *
 * @param {string|null|undefined} ciphertext
 * @param {{tenant_id, patient_id, field_name}} context
 * @returns {string|null|undefined} plaintext
 * @throws {Error} if the ciphertext format is invalid or the auth tag
 *                 verification fails (wrong key, wrong AAD, or tampering)
 */
function decryptPHI(ciphertext, context) {
  if (ciphertext == null || ciphertext === '') return ciphertext;
  if (typeof ciphertext !== 'string' || !ciphertext.startsWith(`${VERSION}:`)) {
    // Not encrypted by us — pass through (legacy plaintext during rollout).
    return ciphertext;
  }

  const parts = ciphertext.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid PHI ciphertext format — expected v1:<iv>:<authTag>:<enc>');
  }
  const [, ivHex, authTagHex, encHex] = parts;

  const key = getPHIKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid PHI ciphertext — IV or authTag length mismatch');
  }

  const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAAD(buildAAD(context));
  decipher.setAuthTag(authTag);
  // Let this throw on auth failure — the caller MUST know the record was
  // tampered with or moved. We do NOT silently return null (that would hide
  // a security-critical event).
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

/**
 * Returns true iff the value looks like a v1-encrypted PHI ciphertext.
 * Used to:
 *   - decide whether to call decryptPHI on a fetched row
 *   - decide whether a column needs re-encryption during key rotation
 *
 * @param {*} value
 * @returns {boolean}
 */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(`${VERSION}:`);
}

// ---------------------------------------------------------------------------
// Key rotation
// ---------------------------------------------------------------------------

/**
 * Re-encrypt all PHI fields in a single table for a single tenant. Used
 * during a key rotation event (e.g. suspected key compromise, scheduled
 * rotation per HIPAA §164.312(a)(2)(iv)).
 *
 * IMPORTANT: This is a STUB. The full implementation needs to:
 *   1. Load both the old key and the new key (NOT just from env — must
 *      support an explicit oldKeyHex so the rotation works even after
 *      process.env.PHI_ENCRYPTION_KEY has already been switched).
 *   2. Iterate every row of `tableName` WHERE tenant_id = tenantId AND
 *      phi_encrypted = true, in batches, within a transaction per batch.
 *   3. For each PHI column in `columns`, decrypt with the old key (using
 *      the row's patient_id in the AAD context) and re-encrypt with the
 *      new key. Update the row in place.
 *   4. Append an entry to `phi_encryption_audit_log` for each rotated row.
 *   5. Support resuming from a checkpoint (in case the rotation crashes
 *      mid-table on a multi-million-row table).
 *
 * See docs/HIPAA_COMPLIANCE.md "Key rotation runbook" for the manual process.
 *
 * @param {string} oldKeyHex  previous key (hex or passphrase)
 * @param {string} newKeyHex  new key (hex or passphrase)
 * @param {import('pg').Pool} pool
 * @param {string} tableName  e.g. 'patient_portal_users', 'consultations', 'prescriptions'
 * @param {string[]} columns  e.g. ['full_name', 'date_of_birth', 'phone', 'address']
 * @param {number} tenantId
 * @throws {Error} always — stub
 */
async function rotatePHIKey(oldKeyHex, newKeyHex, pool, tableName, columns, tenantId) {
  throw new Error(
    'rotatePHIKey is not yet implemented. Until it is, key rotation is a ' +
    'manual process — see docs/HIPAA_COMPLIANCE.md "Key rotation runbook". ' +
    'Track this stub as a HIPAA follow-up: implement batched, transactional, ' +
    'resumable re-encryption before going live with multi-tenant KMS keys.'
  );
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
  encryptPHI,
  decryptPHI,
  isEncrypted,
  rotatePHIKey,
  getPHIKey,
  buildAAD,
  ALGO,
  VERSION,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
};
