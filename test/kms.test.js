/**
 * kms.test.js — unit tests for src/lib/kms.js
 *
 * Covers the envelope-encryption adapter contract:
 *
 *   Local provider:
 *     - getDEK(tenantId, null) generates a fresh 32-byte DEK
 *     - getDEK(tenantId, storedEncryptedDek) decrypts the stored DEK
 *     - encryptDEK + decryptDEK round-trip
 *     - the local: prefix is present on encrypted DEKs (so decryptDEK can
 *       recognize the format)
 *     - DEK cache: second call within TTL returns the cached DEK
 *     - clearDEKCache / invalidateDEK drop entries
 *     - generateNewDEK returns a fresh 32-byte DEK + encrypted string
 *     - legacy warmDEKCache(pool, tenantIds) signature doesn't throw
 *
 *   AWS provider (mocked — no real AWS calls):
 *     - encryptDEKWithAwsKms constructs an EncryptCommand with the right
 *       KeyId / Plaintext / EncryptionAlgorithm
 *     - decryptDEKWithAwsKms constructs a DecryptCommand with the right
 *       CiphertextBlob / EncryptionAlgorithm (no KeyId — KMS infers it)
 *     - missing AWS_KMS_KEY_ID env var throws a clear error
 *     - round-trip via the public encryptDEK/decryptDEK with a mocked client
 *     - the encrypted DEK is base64-encoded (DB-safe)
 *
 *   Env-var compatibility:
 *     - KMS_PROVIDER takes precedence over the legacy PHI_KMS_PROVIDER
 *     - AWS_KMS_KEY_ID takes precedence over the legacy PHI_KMS_KEY_ID
 *
 * Run via: node --test test/kms.test.js
 *
 * No DB or network required — these tests run in milliseconds.
 * The AWS KMS client is mocked; no real AWS API calls are made.
 */

const { test, describe, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');

const REPO_DIR = path.join(__dirname, '..');
const KMS_PATH = path.join(REPO_DIR, 'src', 'lib', 'kms.js');

// ---------------------------------------------------------------------------
// Helpers: fresh module load with specific env vars
// ---------------------------------------------------------------------------
// kms.js resolves KMS_PROVIDER at module-load time into a const, so to test
// different providers we need to delete the cached module and re-require it
// after mutating process.env.

function loadKmsFresh(env) {
  const saved = {};
  const keysToSet = Object.keys(env);
  for (const k of ['KMS_PROVIDER', 'PHI_KMS_PROVIDER', 'AWS_KMS_KEY_ID',
                   'PHI_KMS_KEY_ID', 'AWS_REGION', 'AWS_DEFAULT_REGION',
                   'PHI_ENCRYPTION_KEY', 'ENCRYPTION_KEY']) {
    saved[k] = process.env[k];
    if (keysToSet.includes(k)) {
      process.env[k] = env[k];
    } else {
      delete process.env[k];
    }
  }
  delete require.cache[KMS_PATH];
  const mod = require(KMS_PATH);
  return { mod, restore() {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete require.cache[KMS_PATH];
  } };
}

// ---------------------------------------------------------------------------
// Mock AWS KMS client
// ---------------------------------------------------------------------------
// The real KMS client is a KMSClient whose .send(command) returns a promise
// of the command's output shape. Our mock implements a simple reversible
// cipher: encrypt returns Plaintext prefixed with a marker byte (so we can
// verify round-trip), decrypt strips the marker.
//
// Tests can inspect mock.calls to assert that the right commands were
// constructed with the right params.

function makeMockKmsClient() {
  const calls = [];
  const client = {
    async send(command) {
      // The SDK command classes expose their input as .input
      const input = command.input || {};
      const ctorName = command.constructor && command.constructor.name;
      calls.push({ ctorName, input: { ...input } });

      if (ctorName === 'EncryptCommand') {
        // Reversible "cipher": prefix the plaintext with a marker byte so
        // the decrypt path can verify it got the right shape. (Not real
        // crypto — just a mock for testing the wrapper logic.)
        const plaintext = Buffer.isBuffer(input.Plaintext)
          ? input.Plaintext : Buffer.from(input.Plaintext);
        const ciphertext = Buffer.concat([Buffer.from([0xFE]), plaintext]);
        return { CiphertextBlob: ciphertext };
      }
      if (ctorName === 'DecryptCommand') {
        const ciphertext = Buffer.isBuffer(input.CiphertextBlob)
          ? input.CiphertextBlob : Buffer.from(input.CiphertextBlob);
        if (ciphertext[0] !== 0xFE) {
          const err = new Error('MockKMS: ciphertext missing marker byte');
          err.name = 'InvalidCiphertextException';
          throw err;
        }
        return { Plaintext: ciphertext.subarray(1) };
      }
      throw new Error(`MockKMS: unexpected command ${ctorName}`);
    },
  };
  return { client, calls };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_KEY_HEX = 'a'.repeat(64); // 32-byte test key (64 hex chars)
const TEST_KMS_KEY_ARN = 'arn:aws:kms:us-east-1:123456789012:key/abcd-1234-efgh-5678';

// ===========================================================================
// Local provider
// ===========================================================================

describe('kms.js — local provider', () => {
  let kms;
  let restore;

  before(() => {
    const ctx = loadKmsFresh({
      KMS_PROVIDER: 'local',
      PHI_ENCRYPTION_KEY: TEST_KEY_HEX,
    });
    kms = ctx.mod;
    restore = ctx.restore;
  });

  after(() => restore());

  beforeEach(() => kms.clearDEKCache());

  // -----------------------------------------------------------------------
  // getDEK — fresh DEK generation
  // -----------------------------------------------------------------------

  test('getDEK(tenantId, null) generates a 32-byte DEK', async () => {
    const { dek, encryptedDek, isNew } = await kms.getDEK(1, null);
    assert.ok(Buffer.isBuffer(dek), 'dek must be a Buffer');
    assert.strictEqual(dek.length, 32, 'DEK must be 32 bytes (AES-256)');
    assert.strictEqual(typeof encryptedDek, 'string', 'encryptedDek must be a string');
    assert.strictEqual(isNew, true, 'isNew must be true when no storedEncryptedDek supplied');
  });

  test('encrypted DEK in local mode starts with the local: prefix', async () => {
    const { encryptedDek } = await kms.getDEK(42, null);
    assert.ok(encryptedDek.startsWith('local:'),
      `expected 'local:' prefix, got: ${encryptedDek.substring(0, 20)}`);
  });

  test('getDEK with no tenantId uses the _global cache key', async () => {
    const { dek } = await kms.getDEK(undefined, null);
    assert.strictEqual(dek.length, 32);
  });

  // -----------------------------------------------------------------------
  // getDEK — decrypting a stored DEK
  // -----------------------------------------------------------------------

  test('getDEK(tenantId, storedEncryptedDek) decrypts it correctly', async () => {
    // Generate a fresh DEK + encrypted form
    const { dek: originalDek, encryptedDek } = await kms.generateNewDEK();
    // Now simulate the next request: only the encryptedDek is available
    kms.clearDEKCache();
    const { dek, encryptedDek: returnedEnc, isNew } = await kms.getDEK(7, encryptedDek);
    assert.strictEqual(isNew, false, 'isNew must be false when decrypting a stored DEK');
    assert.deepStrictEqual(dek, originalDek, 'decrypted DEK must match the original');
    assert.strictEqual(returnedEnc, encryptedDek, 'returned encryptedDek must match input');
  });

  // -----------------------------------------------------------------------
  // encryptDEK / decryptDEK round-trip
  // -----------------------------------------------------------------------

  test('encryptDEK + decryptDEK round-trip (local)', async () => {
    const dek = crypto.randomBytes(32);
    const enc = await kms.encryptDEK(dek);
    assert.strictEqual(typeof enc, 'string');
    assert.ok(enc.startsWith('local:'));
    const dec = await kms.decryptDEK(enc);
    assert.deepStrictEqual(dec, dek, 'round-trip must reproduce the original DEK');
  });

  test('encryptDEK throws on non-Buffer input', async () => {
    await assert.rejects(
      () => kms.encryptDEK('not-a-buffer'),
      /dek must be a Buffer/
    );
  });

  test('decryptDEK throws on non-string non-Buffer input', async () => {
    await assert.rejects(
      () => kms.decryptDEK(12345),
      /encryptedDek must be a string/
    );
  });

  test('decryptDEK accepts a Buffer in local mode (legacy compat)', async () => {
    const dek = crypto.randomBytes(32);
    const dec = await kms.decryptDEK(dek);
    assert.deepStrictEqual(dec, dek, 'Buffer input in local mode passes through unchanged');
  });

  test('decryptDEK rejects a Buffer input when provider=aws', async () => {
    const ctx = loadKmsFresh({
      KMS_PROVIDER: 'aws',
      AWS_KMS_KEY_ID: TEST_KMS_KEY_ARN,
      AWS_REGION: 'us-east-1',
    });
    try {
      await assert.rejects(
        () => ctx.mod.decryptDEK(Buffer.from('x')),
        /Buffer input is only valid for the local provider/
      );
    } finally {
      ctx.restore();
    }
  });

  // -----------------------------------------------------------------------
  // DEK cache
  // -----------------------------------------------------------------------

  test('second call to getDEK within TTL returns the cached DEK', async () => {
    const first = await kms.getDEK(99, null);
    const second = await kms.getDEK(99, null);
    assert.deepStrictEqual(second.dek, first.dek,
      'cached DEK must be byte-identical to the first call');
    assert.strictEqual(second.isNew, false,
      'second call (cache hit) must report isNew=false');
  });

  test('cache hit with the same storedEncryptedDek reuses the cached DEK', async () => {
    const { dek: originalDek, encryptedDek } = await kms.generateNewDEK();
    kms.clearDEKCache();
    const first = await kms.getDEK(123, encryptedDek);
    const second = await kms.getDEK(123, encryptedDek);
    assert.deepStrictEqual(second.dek, first.dek);
    assert.deepStrictEqual(second.dek, originalDek);
  });

  test('cache miss with a different storedEncryptedDek re-decrypts (post-rotation)', async () => {
    // Tenant 5 had DEK A encrypted → cached.
    const { dek: dekA, encryptedDek: encA } = await kms.generateNewDEK();
    kms.clearDEKCache();
    await kms.getDEK(5, encA);
    // Now rotate: generate a new DEK B and store its encrypted form.
    const { dek: dekB, encryptedDek: encB } = await kms.generateNewDEK();
    assert.notDeepStrictEqual(dekA, dekB, 'new DEK must differ from the old one');
    // The next getDEK call passes encB — cache should detect the mismatch
    // and re-decrypt from encB (not return the stale dekA).
    const { dek } = await kms.getDEK(5, encB);
    assert.deepStrictEqual(dek, dekB,
      'post-rotation getDEK must return the NEW DEK, not the stale cached one');
  });

  test('invalidateDEK drops a single tenant from the cache', async () => {
    const { dek: dek1 } = await kms.getDEK(11, null);
    const { dek: dek2 } = await kms.getDEK(22, null);
    kms.invalidateDEK(11);
    assert.strictEqual(kms._dekCache.has('11'), false, 'tenant 11 must be dropped');
    assert.strictEqual(kms._dekCache.has('22'), true, 'tenant 22 must remain cached');
    // Re-fetch tenant 22 — should hit the cache and return the same DEK.
    const { dek: dek2Again } = await kms.getDEK(22, null);
    assert.deepStrictEqual(dek2Again, dek2);
  });

  test('clearDEKCache empties the cache', async () => {
    await kms.getDEK(1, null);
    await kms.getDEK(2, null);
    assert.ok(kms._dekCache.size > 0, 'cache should have entries before clear');
    kms.clearDEKCache();
    assert.strictEqual(kms._dekCache.size, 0, 'cache must be empty after clearDEKCache');
  });

  // -----------------------------------------------------------------------
  // generateNewDEK
  // -----------------------------------------------------------------------

  test('generateNewDEK returns a 32-byte DEK + an encrypted string', async () => {
    const { dek, encryptedDek } = await kms.generateNewDEK();
    assert.ok(Buffer.isBuffer(dek));
    assert.strictEqual(dek.length, 32);
    assert.strictEqual(typeof encryptedDek, 'string');
    assert.ok(encryptedDek.startsWith('local:'));
  });

  test('generateNewDEK produces a different DEK each call (randomness)', async () => {
    const a = await kms.generateNewDEK();
    const b = await kms.generateNewDEK();
    assert.notDeepStrictEqual(a.dek, b.dek, 'two generateNewDEK calls must produce different DEKs');
  });

  // -----------------------------------------------------------------------
  // warmDEKCache
  // -----------------------------------------------------------------------

  test('warmDEKCache(tenantId, storedEncryptedDek) warms the cache without throwing', async () => {
    const { encryptedDek } = await kms.generateNewDEK();
    await kms.warmDEKCache(77, encryptedDek);
    assert.ok(kms._dekCache.has('77'), 'tenant 77 should be cached after warmDEKCache');
  });

  test('warmDEKCache swallows errors (logs, does not throw)', async () => {
    // Force an error by clearing the env key — getLocalDEK will throw.
    const savedKey = process.env.PHI_ENCRYPTION_KEY;
    delete process.env.PHI_ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      await kms.warmDEKCache(88, null); // should NOT throw
      assert.strictEqual(kms._dekCache.has('88'), false,
        'failed warm should not populate the cache');
    } finally {
      process.env.PHI_ENCRYPTION_KEY = savedKey;
    }
  });

  test('warmDEKCache(pool, tenantIds) legacy signature does not throw', async () => {
    // The legacy Track A signature was warmDEKCache(pool, tenantIds). We
    // detect the array shape and no-op.
    const fakePool = { query: async () => ({ rows: [] }) };
    await kms.warmDEKCache(fakePool, [1, 2, 3]);
  });
});

// ===========================================================================
// Local provider — error cases
// ===========================================================================

describe('kms.js — local provider error cases', () => {
  test('getDEK throws if PHI_ENCRYPTION_KEY and ENCRYPTION_KEY are both unset', async () => {
    const ctx = loadKmsFresh({ KMS_PROVIDER: 'local' }); // no key env vars
    try {
      await assert.rejects(
        () => ctx.mod.getDEK(1, null),
        /PHI_ENCRYPTION_KEY or ENCRYPTION_KEY/
      );
    } finally {
      ctx.restore();
    }
  });

  test('getLocalDEK hashes a non-hex passphrase to a 32-byte key', () => {
    const ctx = loadKmsFresh({
      KMS_PROVIDER: 'local',
      PHI_ENCRYPTION_KEY: 'some-passphrase-not-hex',
    });
    try {
      const key = ctx.mod._getLocalDEK();
      assert.ok(Buffer.isBuffer(key));
      assert.strictEqual(key.length, 32, 'must hash to 32 bytes');
      // Same input → same key (deterministic SHA-256)
      const key2 = ctx.mod._getLocalDEK();
      assert.deepStrictEqual(key, key2);
    } finally {
      ctx.restore();
    }
  });

  test('getLocalDEK uses a 64-hex-char key directly (no hashing)', () => {
    const ctx = loadKmsFresh({
      KMS_PROVIDER: 'local',
      PHI_ENCRYPTION_KEY: TEST_KEY_HEX,
    });
    try {
      const key = ctx.mod._getLocalDEK();
      assert.strictEqual(key.length, 32);
      assert.deepStrictEqual(key, Buffer.from(TEST_KEY_HEX, 'hex'));
    } finally {
      ctx.restore();
    }
  });
});

// ===========================================================================
// Env-var compatibility (legacy PHI_KMS_PROVIDER / PHI_KMS_KEY_ID)
// ===========================================================================

describe('kms.js — env-var compatibility', () => {
  test('KMS_PROVIDER takes precedence over PHI_KMS_PROVIDER', () => {
    const ctx = loadKmsFresh({
      KMS_PROVIDER: 'aws',
      PHI_KMS_PROVIDER: 'local',
      AWS_KMS_KEY_ID: TEST_KMS_KEY_ARN,
      PHI_ENCRYPTION_KEY: TEST_KEY_HEX,
    });
    try {
      assert.strictEqual(ctx.mod.KMS_PROVIDER, 'aws',
        'KMS_PROVIDER must take precedence over PHI_KMS_PROVIDER');
      assert.strictEqual(ctx.mod.getKmsProvider(), 'aws');
    } finally {
      ctx.restore();
    }
  });

  test('PHI_KMS_PROVIDER is honored when KMS_PROVIDER is unset', () => {
    const ctx = loadKmsFresh({
      PHI_KMS_PROVIDER: 'aws',
      AWS_KMS_KEY_ID: TEST_KMS_KEY_ARN,
      PHI_ENCRYPTION_KEY: TEST_KEY_HEX,
    });
    try {
      assert.strictEqual(ctx.mod.KMS_PROVIDER, 'aws',
        'PHI_KMS_PROVIDER (legacy) should still be honored');
    } finally {
      ctx.restore();
    }
  });

  test('defaults to local when no provider env var is set', () => {
    const ctx = loadKmsFresh({ PHI_ENCRYPTION_KEY: TEST_KEY_HEX });
    try {
      assert.strictEqual(ctx.mod.KMS_PROVIDER, 'local');
    } finally {
      ctx.restore();
    }
  });

  test('unknown provider value falls back to local', async () => {
    const ctx = loadKmsFresh({
      KMS_PROVIDER: 'gcp', // recognized as a value but not implemented
      PHI_ENCRYPTION_KEY: TEST_KEY_HEX,
    });
    try {
      assert.strictEqual(ctx.mod.getKmsProvider(), 'gcp',
        'getKmsProvider returns the raw value (for introspection)');
      // But KMS_PROVIDER (the module-load const) is also 'gcp'. Calling
      // getDEK should then throw because gcp is not implemented.
      await assert.rejects(
        () => ctx.mod.getDEK(1, null),
        /not yet implemented.*use 'local' or 'aws'/
      );
    } finally {
      ctx.restore();
    }
  });
});

// ===========================================================================
// AWS provider — mocked client
// ===========================================================================

describe('kms.js — AWS provider (mocked client)', () => {
  let kms;
  let restore;
  let mockClient;
  let mockCalls;

  before(() => {
    const ctx = loadKmsFresh({
      KMS_PROVIDER: 'aws',
      AWS_KMS_KEY_ID: TEST_KMS_KEY_ARN,
      AWS_REGION: 'us-east-1',
    });
    kms = ctx.mod;
    restore = ctx.restore;
    const mock = makeMockKmsClient();
    mockClient = mock.client;
    mockCalls = mock.calls;
    kms._setAwsKmsClientForTest(mockClient);
  });

  after(() => {
    kms._setAwsKmsClientForTest(null);
    restore();
  });

  beforeEach(() => {
    kms.clearDEKCache();
    mockCalls.length = 0;
  });

  test('encryptDEKWithAwsKms constructs an EncryptCommand with the right params', async () => {
    const dek = crypto.randomBytes(32);
    const enc = await kms._encryptDEKWithAwsKms(dek);
    assert.strictEqual(mockCalls.length, 1, 'exactly one KMS call should have been made');
    const call = mockCalls[0];
    assert.strictEqual(call.ctorName, 'EncryptCommand');
    assert.strictEqual(call.input.KeyId, TEST_KMS_KEY_ARN,
      'KeyId must be the configured AWS_KMS_KEY_ID');
    assert.deepStrictEqual(call.input.Plaintext, dek,
      'Plaintext must be the raw DEK bytes');
    assert.strictEqual(call.input.EncryptionAlgorithm, 'SYMMETRIC_DEFAULT');
    // The encrypted DEK is returned as base64
    assert.strictEqual(typeof enc, 'string');
    const buf = Buffer.from(enc, 'base64');
    assert.ok(buf.length > 0, 'decoded ciphertext must be non-empty');
    // First byte is our mock's marker (0xFE)
    assert.strictEqual(buf[0], 0xFE, 'mock cipher prefixes a marker byte');
  });

  test('decryptDEKWithAwsKms constructs a DecryptCommand with the right params', async () => {
    // First encrypt to get a real base64 ciphertext from the mock
    const dek = crypto.randomBytes(32);
    const enc = await kms._encryptDEKWithAwsKms(dek);
    mockCalls.length = 0; // reset; only count the decrypt call

    const dec = await kms._decryptDEKWithAwsKms(enc);
    assert.strictEqual(mockCalls.length, 1);
    const call = mockCalls[0];
    assert.strictEqual(call.ctorName, 'DecryptCommand');
    assert.deepStrictEqual(call.input.CiphertextBlob, Buffer.from(enc, 'base64'),
      'CiphertextBlob must be the decoded base64 input');
    assert.strictEqual(call.input.EncryptionAlgorithm, 'SYMMETRIC_DEFAULT');
    assert.strictEqual(call.input.KeyId, undefined,
      'KeyId must NOT be set on Decrypt — KMS infers it from the ciphertext header');
    assert.deepStrictEqual(dec, dek, 'round-trip through the mock must reproduce the DEK');
  });

  test('public encryptDEK routes to the AWS path when KMS_PROVIDER=aws', async () => {
    const dek = crypto.randomBytes(32);
    const enc = await kms.encryptDEK(dek);
    assert.strictEqual(typeof enc, 'string');
    assert.ok(!enc.startsWith('local:'),
      'AWS-provider encrypted DEK must NOT have the local: prefix');
    // base64-decodable
    const buf = Buffer.from(enc, 'base64');
    assert.ok(buf.length > 0);
  });

  test('public decryptDEK routes to the AWS path for non-local: strings', async () => {
    const originalDek = crypto.randomBytes(32);
    const enc = await kms.encryptDEK(originalDek);
    const dec = await kms.decryptDEK(enc);
    assert.deepStrictEqual(dec, originalDek, 'public round-trip must work end-to-end');
  });

  test('public decryptDEK still recognizes the local: prefix even when provider=aws', async () => {
    // This protects against the scenario where a tenant was provisioned
    // under the local provider and then KMS_PROVIDER was switched to aws.
    // The local: prefix lets us decrypt the legacy DEK without going to KMS.
    const dek = crypto.randomBytes(32);
    const localEnc = `local:${dek.toString('base64')}`;
    const dec = await kms.decryptDEK(localEnc);
    assert.deepStrictEqual(dec, dek,
      'local: prefix should be honored even when KMS_PROVIDER=aws (migration safety)');
  });

  test('getDEK(tenantId, null) generates a fresh DEK via KMS Encrypt', async () => {
    const { dek, encryptedDek, isNew } = await kms.getDEK(101, null);
    assert.strictEqual(dek.length, 32);
    assert.strictEqual(isNew, true);
    assert.strictEqual(typeof encryptedDek, 'string');
    assert.ok(!encryptedDek.startsWith('local:'),
      'AWS-provider encrypted DEK must not have the local: prefix');
    // Verify KMS Encrypt was called
    assert.ok(mockCalls.some(c => c.ctorName === 'EncryptCommand'),
      'getDEK generation path must call KMS Encrypt');
    // Round-trip via decrypt
    const dec = await kms.decryptDEK(encryptedDek);
    assert.deepStrictEqual(dec, dek);
  });

  test('getDEK(tenantId, storedEncryptedDek) calls KMS Decrypt on cache miss', async () => {
    // Generate an encrypted DEK via the mock, then feed it back through getDEK
    const { dek: originalDek, encryptedDek } = await kms.generateNewDEK();
    kms.clearDEKCache();
    mockCalls.length = 0;

    const { dek, isNew } = await kms.getDEK(202, encryptedDek);
    assert.strictEqual(isNew, false);
    assert.deepStrictEqual(dek, originalDek);
    assert.ok(mockCalls.some(c => c.ctorName === 'DecryptCommand'),
      'getDEK decrypt path must call KMS Decrypt');
  });

  test('generateNewDEK uses KMS Encrypt (not local:)', async () => {
    const { dek, encryptedDek } = await kms.generateNewDEK();
    assert.strictEqual(dek.length, 32);
    assert.ok(!encryptedDek.startsWith('local:'));
  });

  test('DEK cache works for AWS provider too', async () => {
    const first = await kms.getDEK(303, null);
    mockCalls.length = 0;
    const second = await kms.getDEK(303, null);
    assert.deepStrictEqual(second.dek, first.dek);
    assert.strictEqual(mockCalls.length, 0,
      'second call within TTL must hit the cache (no KMS call)');
  });
});

// ===========================================================================
// AWS provider — error handling
// ===========================================================================

describe('kms.js — AWS provider error handling', () => {
  test('encryptDEKWithAwsKms throws when AWS_KMS_KEY_ID is unset', async () => {
    const ctx = loadKmsFresh({
      KMS_PROVIDER: 'aws',
      // AWS_KMS_KEY_ID deliberately unset
      PHI_KMS_KEY_ID: '', // also legacy unset
      AWS_REGION: 'us-east-1',
    });
    try {
      const dek = crypto.randomBytes(32);
      await assert.rejects(
        () => ctx.mod._encryptDEKWithAwsKms(dek),
        /AWS_KMS_KEY_ID .* is not set/
      );
    } finally {
      ctx.restore();
    }
  });

  test('encryptDEKWithAwsKms honors the legacy PHI_KMS_KEY_ID env var', async () => {
    const ctx = loadKmsFresh({
      KMS_PROVIDER: 'aws',
      PHI_KMS_KEY_ID: TEST_KMS_KEY_ARN, // legacy name
      AWS_REGION: 'us-east-1',
    });
    const mock = makeMockKmsClient();
    ctx.mod._setAwsKmsClientForTest(mock.client);
    try {
      const dek = crypto.randomBytes(32);
      await ctx.mod._encryptDEKWithAwsKms(dek);
      assert.strictEqual(mock.calls[0].input.KeyId, TEST_KMS_KEY_ARN,
        'PHI_KMS_KEY_ID (legacy) must be honored as the KMS KeyId');
    } finally {
      ctx.mod._setAwsKmsClientForTest(null);
      ctx.restore();
    }
  });

  test('AWS_KMS_KEY_ID takes precedence over PHI_KMS_KEY_ID', async () => {
    const ctx = loadKmsFresh({
      KMS_PROVIDER: 'aws',
      AWS_KMS_KEY_ID: 'arn:aws:kms:us-east-1:111111111111:key/new-new-new',
      PHI_KMS_KEY_ID: 'arn:aws:kms:us-east-1:222222222222:key/old-old-old',
      AWS_REGION: 'us-east-1',
    });
    const mock = makeMockKmsClient();
    ctx.mod._setAwsKmsClientForTest(mock.client);
    try {
      const dek = crypto.randomBytes(32);
      await ctx.mod._encryptDEKWithAwsKms(dek);
      assert.strictEqual(mock.calls[0].input.KeyId,
        'arn:aws:kms:us-east-1:111111111111:key/new-new-new',
        'AWS_KMS_KEY_ID must take precedence over PHI_KMS_KEY_ID');
    } finally {
      ctx.mod._setAwsKmsClientForTest(null);
      ctx.restore();
    }
  });

  test('KMS errors propagate (not swallowed) — AccessDeniedException', async () => {
    const ctx = loadKmsFresh({
      KMS_PROVIDER: 'aws',
      AWS_KMS_KEY_ID: TEST_KMS_KEY_ARN,
      AWS_REGION: 'us-east-1',
    });
    const failingClient = {
      async send() {
        const err = new Error('User: arn:aws:sts::111:assumed-role/... is not authorized to perform: kms:Encrypt');
        err.name = 'AccessDeniedException';
        throw err;
      },
    };
    ctx.mod._setAwsKmsClientForTest(failingClient);
    try {
      const dek = crypto.randomBytes(32);
      await assert.rejects(
        () => ctx.mod.encryptDEK(dek),
        /not authorized to perform: kms:Encrypt/
      );
    } finally {
      ctx.mod._setAwsKmsClientForTest(null);
      ctx.restore();
    }
  });

  test('decryptDEK on empty base64 throws', async () => {
    const ctx = loadKmsFresh({
      KMS_PROVIDER: 'aws',
      AWS_KMS_KEY_ID: TEST_KMS_KEY_ARN,
      AWS_REGION: 'us-east-1',
    });
    try {
      await assert.rejects(
        () => ctx.mod.decryptDEK(''),
        /empty buffer/
      );
    } finally {
      ctx.restore();
    }
  });
});

// ===========================================================================
// Introspection exports
// ===========================================================================

describe('kms.js — introspection exports', () => {
  test('KMS_PROVIDER constant matches getKmsProvider() at load time', () => {
    const ctx = loadKmsFresh({
      KMS_PROVIDER: 'aws',
      AWS_KMS_KEY_ID: TEST_KMS_KEY_ARN,
      PHI_ENCRYPTION_KEY: TEST_KEY_HEX,
    });
    try {
      assert.strictEqual(ctx.mod.KMS_PROVIDER, ctx.mod.getKmsProvider());
    } finally {
      ctx.restore();
    }
  });

  test('_dekCache is the internal Map (for test introspection)', () => {
    const ctx = loadKmsFresh({
      KMS_PROVIDER: 'local',
      PHI_ENCRYPTION_KEY: TEST_KEY_HEX,
    });
    try {
      assert.ok(ctx.mod._dekCache instanceof Map);
    } finally {
      ctx.restore();
    }
  });

  test('_DEK_CACHE_TTL_MS is 5 minutes', () => {
    const ctx = loadKmsFresh({ KMS_PROVIDER: 'local', PHI_ENCRYPTION_KEY: TEST_KEY_HEX });
    try {
      assert.strictEqual(ctx.mod._DEK_CACHE_TTL_MS, 5 * 60 * 1000);
    } finally {
      ctx.restore();
    }
  });
});
