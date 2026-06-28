// src/lib/kms.js
//
// Cloud KMS envelope encryption adapter for PHI data encryption keys.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------------
// HIPAA §164.312(a)(2)(iv) requires that encryption keys be "periodically
// rotated" and §164.312(b) requires integrity controls. Storing a single
// hardcoded encryption key in a `.env` file does not satisfy either:
//   - Anyone with filesystem access to the host can read the key.
//   - Rotating the key requires rewriting every encrypted row by hand.
//   - There is no audit trail of key access.
//
// The production-grade pattern is **envelope encryption** with a cloud Key
// Management Service (KMS) — AWS KMS, Google Cloud KMS, or Azure Key Vault:
//
//   1. The MASTER KEY (a.k.a. Customer Master Key / Key Encryption Key)
//      lives inside KMS and NEVER leaves it. It cannot be read out — only
//      used to encrypt/decrypt via an authenticated KMS API call.
//   2. For each tenant, we generate a fresh DATA ENCRYPTION KEY (DEK) — a
//      32-byte AES-256 key — locally, in process memory.
//   3. We send the plaintext DEK to KMS, which returns the DEK encrypted
//      under the master key. This encrypted DEK is safe to store on disk.
//   4. We store the encrypted DEK in `tenants.phi_encryption_key_id`.
//   5. At boot, for each tenant we touch, we fetch the encrypted DEK from
//      the DB, send it to KMS for decryption, and cache the plaintext DEK
//      in memory for the lifetime of the process. The plaintext DEK never
//      touches disk or env vars.
//   6. All PHI encrypt/decrypt operations use the in-memory DEK via
//      `hipaa-encryption.js#getPHIKey()`, which reads from a process-level
//      cache populated by this module.
//
// Benefits:
//   - The master key never leaves KMS, so a host compromise does NOT
//     compromise historical PHI (KMS access can be revoked).
//   - Per-tenant DEKs mean compromising tenant A's DEK does NOT expose
//     tenant B's PHI — true cryptographic isolation between tenants.
//   - KMS access is auditable (CloudTrail / Cloud Audit Logs).
//   - Rotating the master key in KMS triggers a re-encrypt of all DEKs
//     without changing the DEKs themselves — fast.
//   - Rotating a single tenant's DEK only requires re-encrypting that
//     tenant's rows — manageable.
//
// ---------------------------------------------------------------------------
// CURRENT STATE: STUB
// ---------------------------------------------------------------------------
// This file currently implements ONLY the local-key fallback path:
//   - `getDEK()` reads `process.env.PHI_ENCRYPTION_KEY` (or ENCRYPTION_KEY)
//     directly, the way `hipaa-encryption.js#getPHIKey()` does.
//   - `encryptDEK()` and `decryptDEK()` are identity functions (no-op).
//
// This is acceptable for dev / staging / single-tenant demos. It is NOT
// acceptable for a production HIPAA-covered deployment — see the
// `TODO(PRODUCTION)` markers below for what needs to be wired up.
//
// The stub is intentionally shaped like the production API so that
// `hipaa-encryption.js` can call into it today and the swap to real KMS
// later is a drop-in replacement, not a rewrite.
// ---------------------------------------------------------------------------

'use strict';

// Lazy-loaded so test environments don't need the AWS SDK installed.
let _awsSdk = null;
function getAwsSdk() {
  if (!_awsSdk) {
    try {
      _awsSdk = require('@aws-sdk/client-kms');
    } catch (_e) {
      _awsSdk = null;
    }
  }
  return _awsSdk;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Resolve which KMS provider we're configured to use.
 *   - 'aws'     → AWS KMS (requires @aws-sdk/client-kms + AWS_REGION +
 *                 PHI_KMS_KEY_ID env vars)
 *   - 'gcp'     → Google Cloud KMS (TODO)
 *   - 'azure'   → Azure Key Vault (TODO)
 *   - 'local'   → No KMS — use env-var key directly (dev/staging only)
 *
 * @returns {'aws'|'gcp'|'azure'|'local'}
 */
function getKmsProvider() {
  const p = (process.env.PHI_KMS_PROVIDER || 'local').toLowerCase();
  if (p === 'aws' || p === 'gcp' || p === 'azure' || p === 'local') return p;
  return 'local';
}

// ---------------------------------------------------------------------------
// In-memory DEK cache
// ---------------------------------------------------------------------------
// Map<tenantId, Buffer>  — holds the plaintext 32-byte DEK for each tenant
// we've booted. Populated lazily by `getDEK(tenantId)`. Cleared only on
// process exit. NEVER serialized to disk or env vars.
const _dekCache = new Map();

/**
 * Drop a tenant's cached DEK. Called after a key-rotation event so the
 * next access re-decrypts from KMS.
 * @param {number|string} tenantId
 */
function invalidateDEK(tenantId) {
  _dekCache.delete(String(tenantId));
}

/** Drop all cached DEKs. Used in tests. */
function clearDEKCache() {
  _dekCache.clear();
}

// ---------------------------------------------------------------------------
// Local fallback (dev/staging)
// ---------------------------------------------------------------------------

/**
 * Resolve the DEK from a local env var when no KMS is configured.
 * This is what runs in dev / staging / single-tenant demos.
 *
 * @returns {Buffer} 32-byte AES key
 * @throws if neither env var is set
 */
function getLocalDEK() {
  const keyHex = process.env.PHI_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error(
      'KMS: local provider requires PHI_ENCRYPTION_KEY or ENCRYPTION_KEY env var. ' +
      "For production, set PHI_KMS_PROVIDER=aws and PHI_KMS_KEY_ID=<kms-key-arn>."
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(keyHex)) return Buffer.from(keyHex, 'hex');
  return require('crypto').createHash('sha256').update(keyHex).digest();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the plaintext Data Encryption Key (DEK) for a given tenant.
 *
 * Resolution order:
 *   1. If DEK is cached in memory for this tenant, return it.
 *   2. Otherwise, depending on provider:
 *      - 'local': read from env var (dev/staging).
 *      - 'aws':   SELECT phi_encryption_key_id FROM tenants WHERE id=$1,
 *                 call KMS decrypt(), cache + return plaintext.
 *      - 'gcp'/'azure': TODO(PRODUCTION).
 *
 * The returned Buffer is the 32-byte AES-256 key that
 * `hipaa-encryption.js#getPHIKey()` should use.
 *
 * NOTE: in the current stub, the `tenantId` parameter is IGNORED for the
 * 'local' provider (there's only one local key shared across tenants).
 * The production 'aws' implementation will use it to fetch the per-tenant
 * encrypted DEK from the `tenants` row.
 *
 * @param {number|string} [tenantId] optional tenant id (required for KMS providers)
 * @returns {Buffer} 32-byte DEK
 */
async function getDEK(tenantId) {
  const cacheKey = String(tenantId || '_global');
  if (_dekCache.has(cacheKey)) return _dekCache.get(cacheKey);

  const provider = getKmsProvider();
  let dek;

  if (provider === 'local') {
    dek = getLocalDEK();
  } else if (provider === 'aws') {
    dek = await getAwsDEK(tenantId);
  } else {
    // TODO(PRODUCTION): implement GCP / Azure providers.
    throw new Error(`KMS provider '${provider}' not yet implemented — use 'local' or 'aws'`);
  }

  _dekCache.set(cacheKey, dek);
  return dek;
}

/**
 * TODO(PRODUCTION): AWS KMS decrypt flow.
 *
 * Pseudocode for the production implementation:
 *
 *   1. const kms = new AWS.KMS({ region: process.env.AWS_REGION });
 *   2. const { rows } = await pool.query(
 *        'SELECT phi_encryption_key_id FROM tenants WHERE id = $1',
 *        [tenantId]
 *      );
 *   3. if (!rows.length || !rows[0].phi_encryption_key_id) {
 *        // First boot for this tenant — generate a fresh DEK and store
 *        // it encrypted under the KMS master key.
 *        const dek = crypto.randomBytes(32);
 *        const { CiphertextBlob } = await kms.encrypt({
 *          KeyId: process.env.PHI_KMS_KEY_ID,
 *          Plaintext: dek,
 *        }).promise();
 *        await pool.query(
 *          'UPDATE tenants SET phi_encryption_key_id = $1 WHERE id = $2',
 *          [CiphertextBlob.toString('base64'), tenantId]
 *        );
 *        return dek;
 *      }
 *   4. const encryptedDek = Buffer.from(
 *        rows[0].phi_encryption_key_id, 'base64'
 *      );
 *      const { Plaintext } = await kms.decrypt({
 *        CiphertextBlob: encryptedDek,
 *      }).promise();
 *      return Plaintext; // 32-byte DEK
 *
 * Error handling: KMS throttling (ThrottlingException) should be retried
 * with exponential backoff. KMS permission errors should fail loud — they
 * mean the IAM role on this host can't use the master key, which is a
 * deployment blocker, not a runtime error to swallow.
 *
 * @param {number|string} tenantId
 * @returns {Promise<Buffer>} 32-byte DEK
 */
async function getAwsDEK(tenantId) {
  const kms = getAwsSdk();
  if (!kms) {
    throw new Error(
      'KMS: AWS provider selected (PHI_KMS_PROVIDER=aws) but ' +
      "@aws-sdk/client-kms is not installed. Run `npm i @aws-sdk/client-kms`."
    );
  }
  throw new Error(
    `KMS: AWS provider not yet implemented for tenant ${tenantId}. ` +
    'See src/lib/kms.js#getAwsDEK TODO(PRODUCTION) for the implementation plan. ' +
    'Until then, use PHI_KMS_PROVIDER=local for dev/staging.'
  );
}

/**
 * Encrypt a plaintext DEK under the KMS master key. Used when generating
 * a fresh DEK for a new tenant.
 *
 * In the 'local' stub this is a no-op identity (we don't have a master
 * key to encrypt under — the DEK is the only key).
 *
 * @param {Buffer} _dek plaintext 32-byte DEK
 * @returns {Promise<Buffer|string>} encrypted DEK, suitable for storing
 *          in `tenants.phi_encryption_key_id`
 */
async function encryptDEK(_dek) {
  const provider = getKmsProvider();
  if (provider === 'local') {
    // No master key — return the DEK as-is. The caller (dev only) is
    // responsible for not writing this to disk in plaintext in production.
    return _dek;
  }
  if (provider === 'aws') {
    // TODO(PRODUCTION): call kms.encrypt({ KeyId, Plaintext: _dek })
    throw new Error('KMS encryptDEK for AWS not yet implemented — see src/lib/kms.js');
  }
  throw new Error(`KMS encryptDEK: provider '${provider}' not yet implemented`);
}

/**
 * Decrypt an encrypted DEK using the KMS master key. Used at boot to
 * recover the plaintext DEK from the value stored in
 * `tenants.phi_encryption_key_id`.
 *
 * In the 'local' stub this is a no-op identity.
 *
 * @param {Buffer|string} _encryptedDek
 * @returns {Promise<Buffer>} plaintext 32-byte DEK
 */
async function decryptDEK(_encryptedDek) {
  const provider = getKmsProvider();
  if (provider === 'local') {
    return Buffer.isBuffer(_encryptedDek) ? _encryptedDek : Buffer.from(_encryptedDek);
  }
  if (provider === 'aws') {
    // TODO(PRODUCTION): call kms.decrypt({ CiphertextBlob: _encryptedDek })
    throw new Error('KMS decryptDEK for AWS not yet implemented — see src/lib/kms.js');
  }
  throw new Error(`KMS decryptDEK: provider '${provider}' not yet implemented`);
}

// ---------------------------------------------------------------------------
// Boot-time initialization
// ---------------------------------------------------------------------------

/**
 * Warm the DEK cache for a list of tenants at boot. Called once from
 * server.js after the pool is ready, BEFORE accepting HTTP traffic, so
 * that the first PHI encrypt/decrypt doesn't pay the KMS round-trip
 * latency.
 *
 * In 'local' mode this is a no-op (the env-var key is read on demand).
 *
 * @param {import('pg').Pool} _pool
 * @param {number[]} _tenantIds
 */
async function warmDEKCache(_pool, _tenantIds) {
  const provider = getKmsProvider();
  if (provider === 'local') return; // nothing to warm
  // TODO(PRODUCTION): for each tenantId, call getDEK(tenantId) in
  // bounded-concurrency batches (e.g. p-limit(5)) to avoid hammering KMS
  // on a multi-tenant boot.
  throw new Error(`KMS warmDEKCache: provider '${provider}' not yet implemented`);
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
  getKmsProvider,
  getDEK,
  encryptDEK,
  decryptDEK,
  warmDEKCache,
  invalidateDEK,
  clearDEKCache,
  // Exported for tests / introspection (not for production callers):
  _getLocalDEK: getLocalDEK,
  _dekCache: _dekCache,
};
