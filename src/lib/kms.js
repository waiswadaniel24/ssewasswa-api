// src/lib/kms.js
//
// KMS envelope-encryption adapter for HIPAA PHI data encryption keys.
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
// Management Service (KMS):
//
//   1. The MASTER KEY (a.k.a. Customer Master Key / Key Encryption Key)
//      lives inside AWS KMS and NEVER leaves it. It cannot be read out —
//      only used to encrypt/decrypt via an authenticated KMS API call.
//   2. For each tenant, we generate a fresh DATA ENCRYPTION KEY (DEK) — a
//      32-byte AES-256 key — locally, in process memory.
//   3. We send the plaintext DEK to KMS, which returns the DEK encrypted
//      under the master key. This encrypted DEK is safe to store on disk.
//   4. We store the encrypted DEK in `tenants.phi_encryption_key_id`.
//   5. At boot, for each tenant we touch, we fetch the encrypted DEK from
//      the DB, send it to KMS for decryption, and cache the plaintext DEK
//      in memory for the lifetime of the process (TTL-bounded). The
//      plaintext DEK never touches disk or env vars.
//   6. All PHI encrypt/decrypt operations use the in-memory DEK via
//      `hipaa-encryption.js#getPHIKey()` (which can be wired to read
//      from the per-tenant DEK cache instead of process.env — see the
//      "Wiring into hipaa-encryption.js" note at the bottom of this file).
//
// Benefits:
//   - The master key never leaves KMS, so a host compromise does NOT
//     compromise historical PHI (KMS access can be revoked).
//   - Per-tenant DEKs mean compromising tenant A's DEK does NOT expose
//     tenant B's PHI — true cryptographic isolation between tenants.
//   - KMS access is auditable (CloudTrail).
//   - Rotating the master key in KMS triggers a re-encrypt of all DEKs
//     without changing the DEKs themselves — fast.
//   - Rotating a single tenant's DEK only requires re-encrypting that
//     tenant's rows — manageable.
//
// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------
// Set the KMS_PROVIDER env var (or the legacy PHI_KMS_PROVIDER):
//   - 'local' (default): Uses the PHI_ENCRYPTION_KEY/ENCRYPTION_KEY env var.
//     The master key is stored in the environment. **For dev/staging only.**
//   - 'aws': Uses AWS KMS. The master key never leaves KMS. Requires
//     AWS_KMS_KEY_ID (or legacy PHI_KMS_KEY_ID) env var and AWS credentials
//     (via env vars, IAM role, or ~/.aws/credentials). **For production.**
//
// Env-var compatibility:
//   This module reads BOTH the new short names (KMS_PROVIDER, AWS_KMS_KEY_ID)
//   and the legacy PHI_KMS_PROVIDER / PHI_KMS_KEY_ID names written by the
//   original Track A stub. New deployments should prefer the short names.
//
// ---------------------------------------------------------------------------
// DEK cache
// ---------------------------------------------------------------------------
// DEKs are cached in memory for 5 minutes (DEK_CACHE_TTL_MS) to avoid
// hitting KMS on every request. The cache key is the tenantId. After a
// key-rotation event, call invalidateDEK(tenantId) (or clearDEKCache()) so
// the next access re-decrypts from KMS.
//
// The cache stores { dek, encryptedDek, expiresAt } per tenant.
// The plaintext DEK never touches disk or env vars.
// ---------------------------------------------------------------------------

'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Resolve which KMS provider we're configured to use.
 *
 * Reads KMS_PROVIDER first (new short name), then PHI_KMS_PROVIDER (legacy).
 *
 * @returns {'aws'|'local'}  (gcp/azure are recognized as values but not
 *                            implemented — getDEK throws if selected)
 */
function getKmsProvider() {
  const raw = (process.env.KMS_PROVIDER || process.env.PHI_KMS_PROVIDER || 'local')
    .toString().toLowerCase().trim();
  if (raw === 'aws' || raw === 'gcp' || raw === 'azure' || raw === 'local') return raw;
  return 'local';
}

// Resolve the provider ONCE at module load. Subsequent calls to encryptDEK /
// decryptDEK use this constant so that swapping providers mid-process is
// impossible (avoids the footgun of decrypting with the wrong provider after
// an env-var swap). getKmsProvider() is still exported for tests/operators
// that want to introspect the resolved value.
const KMS_PROVIDER = getKmsProvider();

const DEK_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Resolve the AWS KMS key ID (master key ARN or key ID).
 * Reads AWS_KMS_KEY_ID first, then the legacy PHI_KMS_KEY_ID.
 * @returns {string|undefined}
 */
function getKmsKeyId() {
  return process.env.AWS_KMS_KEY_ID || process.env.PHI_KMS_KEY_ID;
}

// ---------------------------------------------------------------------------
// AWS KMS client (lazy-loaded — only initialized when provider='aws')
// ---------------------------------------------------------------------------

let _awsKmsClient = null;

/**
 * Lazily construct the AWS KMS client. We defer construction so that:
 *   - Tests for the 'local' provider never require @aws-sdk/client-kms
 *   - A misconfigured AWS_REGION env var only blows up when actually used
 * @returns {Promise<import('@aws-sdk/client-kms').KMSClient>}
 */
async function getAwsKmsClient() {
  if (_awsKmsClient) return _awsKmsClient;
  const { KMSClient } = require('@aws-sdk/client-kms');
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  _awsKmsClient = new KMSClient({ region });
  return _awsKmsClient;
}

// Test hook: allow tests to inject a mock client without monkey-patching
// the SDK. Set via `_setAwsKmsClientForTest(mockClient)`.
function _setAwsKmsClientForTest(client) {
  _awsKmsClient = client;
}

// ---------------------------------------------------------------------------
// In-memory DEK cache
// ---------------------------------------------------------------------------
// Map<tenantId, { dek: Buffer, encryptedDek: string, expiresAt: number }>
const _dekCache = new Map();

/**
 * Drop a tenant's cached DEK. Called after a key-rotation event so the
 * next access re-decrypts from KMS.
 * @param {number|string} tenantId
 */
function invalidateDEK(tenantId) {
  _dekCache.delete(String(tenantId));
}

/** Drop all cached DEKs. Used in tests and after a global key rotation. */
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
 * Used directly by the legacy `getDEK(tenantId)` single-arg form, and as a
 * fallback when no storedEncryptedDek is provided to the new getDEK().
 *
 * @returns {Buffer} 32-byte AES key
 * @throws if neither env var is set
 */
function getLocalDEK() {
  const keyHex = process.env.PHI_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error(
      'KMS: local provider requires PHI_ENCRYPTION_KEY or ENCRYPTION_KEY env var. ' +
      "For production, set KMS_PROVIDER=aws and AWS_KMS_KEY_ID=<kms-key-arn>."
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(keyHex)) return Buffer.from(keyHex, 'hex');
  return crypto.createHash('sha256').update(keyHex).digest();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the Data Encryption Key (DEK) for a tenant.
 *
 * Two calling conventions:
 *   1. NEW: `getDEK(tenantId, storedEncryptedDek)` → returns
 *      `{ dek, encryptedDek, isNew }`. This is the canonical envelope-
 *      encryption flow: if the tenant already has an encrypted DEK in the
 *      DB, decrypt it; otherwise generate a new DEK, encrypt it, and return
 *      both (caller is responsible for persisting `encryptedDek` into
 *      `tenants.phi_encryption_key_id`).
 *   2. LEGACY: `getDEK(tenantId)` → returns the same `{ dek, encryptedDek,
 *      isNew }` object, with `encryptedDek` populated from the local
 *      provider (the DEK base64-encoded with the `local:` prefix). For the
 *      'local' provider the DEK is derived from PHI_ENCRYPTION_KEY/ENCRYPTION_KEY
 *      and is the same for every tenant.
 *
 * DEKs are cached per-tenant for DEK_CACHE_TTL_MS (5 min) to avoid hitting
 * KMS on every request. If the caller passes a `storedEncryptedDek` that
 * differs from the cached one, the cache is invalidated and re-decrypted
 * (so post-rotation calls pick up the new key automatically).
 *
 * @param {number|string} tenantId
 * @param {string|null} [storedEncryptedDek]  the encrypted DEK from
 *        `tenants.phi_encryption_key_id` (null/undefined if not yet created)
 * @returns {Promise<{ dek: Buffer, encryptedDek: string, isNew: boolean }>}
 *          `dek` is a 32-byte plaintext AES-256 key. `encryptedDek` is the
 *          base64-encoded ciphertext suitable for DB storage. `isNew` is
 *          true when a fresh DEK was just generated (caller must persist).
 */
async function getDEK(tenantId, storedEncryptedDek = null) {
  const cacheKey = String(tenantId == null ? '_global' : tenantId);

  // 1) Cache hit (and still fresh) for the same encryptedDek → reuse.
  const cached = _dekCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const cachedEnc = cached.encryptedDek;
    const incomingEnc = storedEncryptedDek;
    // If the caller passed the SAME encrypted DEK that's cached (or none at
    // all), reuse the cached plaintext DEK. If they passed a DIFFERENT one
    // (post-rotation), fall through and re-decrypt.
    if (incomingEnc == null || incomingEnc === cachedEnc) {
      return { dek: cached.dek, encryptedDek: cached.encryptedDek, isNew: false };
    }
  }

  // 2) Caller handed us an existing encrypted DEK → decrypt it.
  if (storedEncryptedDek) {
    const dek = await decryptDEK(storedEncryptedDek);
    _dekCache.set(cacheKey, {
      dek,
      encryptedDek: storedEncryptedDek,
      expiresAt: Date.now() + DEK_CACHE_TTL_MS,
    });
    return { dek, encryptedDek: storedEncryptedDek, isNew: false };
  }

  // 3) No stored DEK → generate a fresh 32-byte DEK and encrypt it under
  //    the master key. The caller MUST persist `encryptedDek` into the
  //    tenants row (isNew=true signals this).
  let dek;
  let encryptedDek;

  if (KMS_PROVIDER === 'local') {
    // For the local provider, derive a deterministic DEK from the env-var
    // master key (so all tenants share the same DEK in dev — fine for
    // single-tenant demos). If you want per-tenant DEKs in local mode
    // (e.g. for a more realistic staging test), set KMS_PROVIDER=aws and
    // use a real (or LocalStack) KMS.
    dek = getLocalDEK();
    encryptedDek = await encryptDEK(dek);
  } else if (KMS_PROVIDER === 'aws') {
    dek = crypto.randomBytes(32); // 256-bit AES key
    encryptedDek = await encryptDEK(dek);
  } else {
    throw new Error(
      `KMS provider '${KMS_PROVIDER}' not yet implemented — use 'local' or 'aws'`
    );
  }

  _dekCache.set(cacheKey, {
    dek,
    encryptedDek,
    expiresAt: Date.now() + DEK_CACHE_TTL_MS,
  });
  return { dek, encryptedDek, isNew: true };
}

/**
 * Encrypt a plaintext DEK under the KMS master key. Used when generating a
 * fresh DEK for a new tenant (or during key rotation).
 *
 * - local: returns `local:<base64(dek)>` (NOT secure — dev only; the master
 *   key is the env var, so the "encryption" is just base64 encoding with a
 *   version prefix so decryptDEK can recognize it).
 * - aws: calls `KMS.Encrypt` with `EncryptionAlgorithm: SYMMETRIC_DEFAULT`
 *   and returns the ciphertext blob as base64 (for DB storage).
 *
 * @param {Buffer} dek  32-byte plaintext DEK
 * @returns {Promise<string>}  base64-encoded ciphertext suitable for DB storage
 */
async function encryptDEK(dek) {
  if (!Buffer.isBuffer(dek)) {
    throw new Error('encryptDEK: dek must be a Buffer');
  }

  if (KMS_PROVIDER === 'aws') {
    return encryptDEKWithAwsKms(dek);
  }

  if (KMS_PROVIDER === 'local') {
    // `local:` prefix lets decryptDEK recognize the format unambiguously
    // (vs. raw base64 KMS ciphertext).
    return `local:${dek.toString('base64')}`;
  }

  throw new Error(`KMS encryptDEK: provider '${KMS_PROVIDER}' not yet implemented`);
}

/**
 * Decrypt an encrypted DEK using the master key.
 *
 * - local: strips the `local:` prefix and base64-decodes. For backward
 *   compat with the original Track A stub (which returned Buffers as-is),
 *   a Buffer input in local mode is returned unchanged.
 * - aws: calls `KMS.Decrypt` with `EncryptionAlgorithm: SYMMETRIC_DEFAULT`.
 *   The KeyId is NOT required — KMS infers it from the ciphertext header.
 *
 * @param {string|Buffer} encryptedDek  base64 string from the DB (or, for
 *        legacy local-mode callers, a Buffer)
 * @returns {Promise<Buffer>}  32-byte plaintext DEK
 */
async function decryptDEK(encryptedDek) {
  // Legacy local-mode compat: a raw Buffer input in local mode is the DEK
  // itself (the original stub returned Buffers as-is). Pass through.
  if (Buffer.isBuffer(encryptedDek)) {
    if (KMS_PROVIDER !== 'local') {
      throw new Error('decryptDEK: Buffer input is only valid for the local provider');
    }
    return encryptedDek;
  }
  if (typeof encryptedDek !== 'string') {
    throw new Error('decryptDEK: encryptedDek must be a string (or Buffer in local mode)');
  }

  // Local-provider ciphertext: `local:<base64>`
  if (encryptedDek.startsWith('local:')) {
    const b64 = encryptedDek.substring('local:'.length);
    return Buffer.from(b64, 'base64');
  }

  if (KMS_PROVIDER === 'aws') {
    // Assume it's a base64-encoded KMS ciphertext blob.
    return decryptDEKWithAwsKms(encryptedDek);
  }

  // In local mode, a string without the `local:` prefix is ambiguous —
  // could be a legacy base64 DEK from before the prefix was added. Try to
  // decode it as base64 (this preserves the original Track A behavior of
  // "return Buffer.from(encryptedDek)").
  if (KMS_PROVIDER === 'local') {
    try {
      return Buffer.from(encryptedDek, 'base64');
    } catch (_e) {
      // fall through to error
    }
  }

  throw new Error(
    `decryptDEK: cannot decrypt — unknown format ` +
    `(provider=${KMS_PROVIDER}, prefix=${encryptedDek.substring(0, 20)}...)`
  );
}

// ---------------------------------------------------------------------------
// AWS KMS implementation
// ---------------------------------------------------------------------------

/**
 * Encrypt a DEK with the AWS KMS master key.
 *
 * Uses SYMMETRIC_DEFAULT (AES-256-GCM inside KMS). The KMS key must be a
 * symmetric encryption key (key spec=SYMMETRIC_DEFAULT), which is the
 * default when you create a KMS key in the AWS Console.
 *
 * @param {Buffer} dek  32-byte plaintext DEK
 * @returns {Promise<string>}  base64-encoded KMS ciphertext blob
 * @throws if AWS_KMS_KEY_ID env var is missing, or KMS returns an error
 *         (e.g. AccessDeniedException, ThrottlingException — these should
 *         fail loud; they mean the IAM role on this host can't use the
 *         master key, which is a deployment blocker, not a runtime error
 *         to swallow).
 */
async function encryptDEKWithAwsKms(dek) {
  const kmsKeyId = getKmsKeyId();
  if (!kmsKeyId) {
    throw new Error(
      'KMS: KMS_PROVIDER=aws but AWS_KMS_KEY_ID (or PHI_KMS_KEY_ID) env var is not set. ' +
      'Set it to the ARN of your KMS master key, e.g. ' +
      'arn:aws:kms:us-east-1:123456789012:key/abcd-1234-...'
    );
  }

  const { EncryptCommand } = require('@aws-sdk/client-kms');
  const client = await getAwsKmsClient();

  const command = new EncryptCommand({
    KeyId: kmsKeyId,
    Plaintext: dek,
    EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
  });

  const response = await client.send(command);
  if (!response.CiphertextBlob) {
    throw new Error('KMS Encrypt returned no CiphertextBlob');
  }

  // Return as base64 for DB storage. KMS ciphertext blobs are binary and
  // can contain bytes that don't survive a TEXT column without base64.
  return Buffer.from(response.CiphertextBlob).toString('base64');
}

/**
 * Decrypt a DEK with the AWS KMS master key.
 *
 * KeyId is intentionally NOT supplied — KMS infers the key from the
 * ciphertext header. This means rotating the master key works seamlessly:
 * old ciphertexts decrypt against whichever key originally encrypted them
 * (as long as that key is still enabled).
 *
 * @param {string} encryptedDekB64  base64-encoded KMS ciphertext blob
 * @returns {Promise<Buffer>}  32-byte plaintext DEK
 * @throws if KMS returns an error (AccessDeniedException, KMSNotFoundException
 *         if the key was deleted, etc.)
 */
async function decryptDEKWithAwsKms(encryptedDekB64) {
  const { DecryptCommand } = require('@aws-sdk/client-kms');
  const client = await getAwsKmsClient();

  let ciphertextBlob;
  try {
    ciphertextBlob = Buffer.from(encryptedDekB64, 'base64');
  } catch (e) {
    throw new Error(`decryptDEK: encryptedDek is not valid base64: ${e.message}`);
  }
  if (ciphertextBlob.length === 0) {
    throw new Error('decryptDEK: encryptedDek decoded to empty buffer');
  }

  const command = new DecryptCommand({
    CiphertextBlob: ciphertextBlob,
    EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
    // KeyId is optional for decryption — KMS infers from the ciphertext
    // header. We omit it so old ciphertexts (encrypted under a previous
    // master key) still decrypt after rotation, as long as that key is
    // still enabled.
  });

  const response = await client.send(command);
  if (!response.Plaintext) {
    throw new Error('KMS Decrypt returned no Plaintext');
  }

  return Buffer.from(response.Plaintext);
}

// ---------------------------------------------------------------------------
// Boot-time initialization & key rotation
// ---------------------------------------------------------------------------

/**
 * Warm the DEK cache for a tenant (call at app startup or login).
 *
 * Two calling conventions:
 *   - NEW: `warmDEKCache(tenantId, storedEncryptedDek)` — warms a single
 *     tenant's DEK. If storedEncryptedDek is null/undefined, a fresh DEK
 *     is generated (and the caller is responsible for persisting it).
 *   - LEGACY: `warmDEKCache(pool, tenantIds)` — no-op in local mode (the
 *     env-var key is read on demand). In AWS mode, the original Track A
 *     stub threw; this implementation accepts the call but does nothing,
 *     because the new pattern is for the per-request handler to call
 *     getDEK(tenantId, storedEncryptedDek) with the encrypted DEK fetched
 *     from the tenants row. A proper pool-backed batch warmer is left as
 *     a follow-up (see TODO inside).
 *
 * Failures are caught and logged — a KMS outage at boot must not crash
 * the app (the first request will retry via getDEK()).
 *
 * @param {number|string|import('pg').Pool} tenantIdOrPool
 * @param {string|null|number[]} storedEncryptedDekOrTenantIds
 */
async function warmDEKCache(tenantIdOrPool, storedEncryptedDekOrTenantIds) {
  // Legacy signature: warmDEKCache(pool, tenantIds)
  if (Array.isArray(storedEncryptedDekOrTenantIds)) {
    // TODO(PRODUCTION): for each tenantId, fetch the encrypted DEK from
    // the DB via the supplied pool and call getDEK(tenantId, encDek) in
    // bounded-concurrency batches (e.g. p-limit(5)) to avoid hammering
    // KMS on a multi-tenant boot. For now, no-op — the per-request
    // handler calls getDEK(tenantId, storedEncryptedDek) directly.
    return;
  }

  // New signature: warmDEKCache(tenantId, storedEncryptedDek)
  const tenantId = tenantIdOrPool;
  const storedEncryptedDek = storedEncryptedDekOrTenantIds;
  try {
    await getDEK(tenantId, storedEncryptedDek);
  } catch (e) {
    console.warn(
      `[KMS] Failed to warm DEK cache for tenant ${tenantId}:`,
      e.message
    );
  }
}

/**
 * Generate a fresh DEK and return both the plaintext and the encrypted form.
 *
 * Used during:
 *   - New-tenant onboarding (when `tenants.phi_encryption_key_id` is NULL)
 *   - Per-tenant DEK rotation (re-encrypt all PHI rows with the new DEK,
 *     then UPDATE tenants.phi_encryption_key_id with the new encryptedDek)
 *
 * Does NOT touch the cache — the caller decides whether to invalidate the
 * old DEK (via invalidateDEK(tenantId)) before or after persisting.
 *
 * @returns {Promise<{ dek: Buffer, encryptedDek: string }>}
 */
async function generateNewDEK() {
  const dek = crypto.randomBytes(32); // 256-bit AES key
  const encryptedDek = await encryptDEK(dek);
  return { dek, encryptedDek };
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
  // Public API (canonical):
  getDEK,
  encryptDEK,
  decryptDEK,
  warmDEKCache,
  generateNewDEK,
  invalidateDEK,
  clearDEKCache,

  // Introspection:
  getKmsProvider,        // reads env live (returns 'aws'|'local'|'gcp'|'azure')
  KMS_PROVIDER,          // resolved-at-load constant (the one encrypt/decrypt use)

  // Test exports (not for production callers):
  _getLocalDEK: getLocalDEK,
  _getAwsKmsClient: getAwsKmsClient,
  _setAwsKmsClientForTest: _setAwsKmsClientForTest,
  _encryptDEKWithAwsKms: encryptDEKWithAwsKms,
  _decryptDEKWithAwsKms: decryptDEKWithAwsKms,
  _dekCache: _dekCache,
  _DEK_CACHE_TTL_MS: DEK_CACHE_TTL_MS,
};

// ---------------------------------------------------------------------------
// Wiring into hipaa-encryption.js (forward-looking note)
// ---------------------------------------------------------------------------
// hipaa-encryption.js#getPHIKey() currently reads process.env.PHI_ENCRYPTION_KEY
// directly. For full per-tenant envelope encryption, callers of encryptPHI /
// decryptPHI should resolve the DEK first via `await getDEK(tenantId,
// storedEncryptedDek)` and either:
//   (a) set process.env.PHI_ENCRYPTION_KEY = dek.toString('hex') for the
//       duration of the request (simple, but leaks the DEK to any code that
//       reads process.env), OR
//   (b) better — extend hipaa-encryption.js to accept a key parameter on
//       encryptPHI/decryptPHI, defaulting to getPHIKey() if not supplied
//       (a small follow-up change to hipaa-encryption.js).
//
// Option (b) is the recommended path; this KMS module is the prerequisite.
// ---------------------------------------------------------------------------
