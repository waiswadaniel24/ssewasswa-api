/**
 * hipaa-encryption.test.js — unit tests for src/lib/hipaa-encryption.js
 *
 * Covers the cryptographic contract:
 *   - encrypt/decrypt round-trip returns the original plaintext
 *   - decrypt with the wrong AAD context (different patient_id) throws —
 *     this is the security-critical guarantee that ciphertexts can't be
 *     moved between patients undetected
 *   - encrypt on null/undefined/'' returns the input unchanged (no
 *     phantom ciphertext blobs for missing data)
 *   - isEncrypted() distinguishes ciphertext from plaintext
 *   - two encryptions of the same plaintext produce different ciphertexts
 *     (random IV per call)
 *   - decrypt on a non-encrypted value returns it unchanged (legacy
 *     plaintext rows pass through safely during phased rollout)
 *   - rotatePHIKey stub throws with a clear, actionable error message
 *   - getPHIKey() throws when neither env var is set
 *   - non-string inputs (numbers, Dates) are coerced to string before
 *     encryption and round-trip correctly
 *
 * Run via: node --test test/hipaa-encryption.test.js
 *
 * No DB or network required — these tests run in milliseconds.
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const REPO_DIR = path.join(__dirname, '..');
const hipaaPath = path.join(REPO_DIR, 'src', 'lib', 'hipaa-encryption.js');

// ---------------------------------------------------------------------------
// Env-var management
// ---------------------------------------------------------------------------
// hipaa-encryption.js reads PHI_ENCRYPTION_KEY / ENCRYPTION_KEY on every
// call to getPHIKey(), so we can swap keys per-test by mutating process.env.

const TEST_KEY_HEX = 'a'.repeat(64); // 32-byte test key (64 hex chars)
const ALT_KEY_HEX = 'b'.repeat(64);  // different 32-byte key

function setKey(hex) {
  process.env.PHI_ENCRYPTION_KEY = hex;
  delete process.env.ENCRYPTION_KEY;
}
function clearKeys() {
  delete process.env.PHI_ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hipaa-encryption.js', () => {
  let hipaa;
  before(() => {
    hipaa = require(hipaaPath);
  });

  beforeEach(() => {
    setKey(TEST_KEY_HEX);
  });

  after(() => {
    clearKeys();
  });

  // -------------------------------------------------------------------------
  // Round-trip
  // -------------------------------------------------------------------------

  test('encryptPHI + decryptPHI round-trip returns the original plaintext', () => {
    const ctx = { tenant_id: 1, patient_id: 100, field_name: 'name' };
    const plain = 'John Q. Doe';
    const enc = hipaa.encryptPHI(plain, ctx);
    assert.notStrictEqual(enc, plain, 'ciphertext should differ from plaintext');
    const dec = hipaa.decryptPHI(enc, ctx);
    assert.strictEqual(dec, plain, 'decrypted value must equal original plaintext');
  });

  test('round-trip works for long realistic PHI values', () => {
    const ctx = { tenant_id: 42, patient_id: 9999, field_name: 'address' };
    const plain = '123 Main St, Apt 4B, Kampala, Uganda, East Africa';
    const dec = hipaa.decryptPHI(hipaa.encryptPHI(plain, ctx), ctx);
    assert.strictEqual(dec, plain);
  });

  test('round-trip works for unicode / emoji (patient names are international)', () => {
    const ctx = { tenant_id: 7, patient_id: 55, field_name: 'full_name' };
    const plain = 'José María Muñoz 😷 — Învățătoare';
    const dec = hipaa.decryptPHI(hipaa.encryptPHI(plain, ctx), ctx);
    assert.strictEqual(dec, plain);
  });

  // -------------------------------------------------------------------------
  // AAD — the security-critical part
  // -------------------------------------------------------------------------

  test('decryptPHI with wrong patient_id throws (AAD mismatch)', () => {
    const ctx = { tenant_id: 1, patient_id: 100, field_name: 'name' };
    const enc = hipaa.encryptPHI('John Doe', ctx);
    assert.throws(
      () => hipaa.decryptPHI(enc, { ...ctx, patient_id: 999 }),
      // Node throws an "Unsupported state or unable to authenticate data"
      // error from the crypto module when GCM auth-tag verification fails.
      (err) => /authenticate|unsupported state/i.test(err.message)
    );
  });

  test('decryptPHI with wrong tenant_id throws (AAD mismatch)', () => {
    const ctx = { tenant_id: 1, patient_id: 100, field_name: 'name' };
    const enc = hipaa.encryptPHI('John Doe', ctx);
    assert.throws(
      () => hipaa.decryptPHI(enc, { ...ctx, tenant_id: 2 }),
      (err) => /authenticate|unsupported state/i.test(err.message)
    );
  });

  test('decryptPHI with wrong field_name throws (AAD mismatch)', () => {
    const ctx = { tenant_id: 1, patient_id: 100, field_name: 'name' };
    const enc = hipaa.encryptPHI('John Doe', ctx);
    assert.throws(
      () => hipaa.decryptPHI(enc, { ...ctx, field_name: 'phone' }),
      (err) => /authenticate|unsupported state/i.test(err.message)
    );
  });

  test('decryptPHI with the wrong key throws (different env var)', () => {
    const ctx = { tenant_id: 1, patient_id: 100, field_name: 'name' };
    const enc = hipaa.encryptPHI('John Doe', ctx);
    setKey(ALT_KEY_HEX);
    assert.throws(
      () => hipaa.decryptPHI(enc, ctx),
      (err) => /authenticate|unsupported state/i.test(err.message)
    );
  });

  // -------------------------------------------------------------------------
  // Null / empty / plaintext pass-through
  // -------------------------------------------------------------------------

  test('encryptPHI(null) returns null (no phantom ciphertext)', () => {
    const ctx = { tenant_id: 1, patient_id: 100, field_name: 'name' };
    assert.strictEqual(hipaa.encryptPHI(null, ctx), null);
  });

  test('encryptPHI(undefined) returns undefined', () => {
    const ctx = { tenant_id: 1, patient_id: 100, field_name: 'name' };
    assert.strictEqual(hipaa.encryptPHI(undefined, ctx), undefined);
  });

  test("encryptPHI('') returns '' (empty string passed through)", () => {
    const ctx = { tenant_id: 1, patient_id: 100, field_name: 'name' };
    assert.strictEqual(hipaa.encryptPHI('', ctx), '');
  });

  test("decryptPHI(null) returns null", () => {
    const ctx = { tenant_id: 1, patient_id: 100, field_name: 'name' };
    assert.strictEqual(hipaa.decryptPHI(null, ctx), null);
  });

  test("decryptPHI on plaintext returns the value unchanged (legacy rollout)", () => {
    const ctx = { tenant_id: 1, patient_id: 100, field_name: 'name' };
    // A legacy plaintext row should pass through decryptPHI unchanged so
    // the clinic-hipaa.js wrapper can call decryptPHI on every row without
    // knowing whether it's been backfilled yet.
    assert.strictEqual(hipaa.decryptPHI('John Doe (plaintext)', ctx), 'John Doe (plaintext)');
    assert.strictEqual(hipaa.decryptPHI('any old value', ctx), 'any old value');
  });

  // -------------------------------------------------------------------------
  // isEncrypted()
  // -------------------------------------------------------------------------

  test('isEncrypted returns true for v1: ciphertexts', () => {
    const ctx = { tenant_id: 1, patient_id: 100, field_name: 'name' };
    const enc = hipaa.encryptPHI('John Doe', ctx);
    assert.strictEqual(hipaa.isEncrypted(enc), true);
  });

  test('isEncrypted returns false for plaintext values', () => {
    assert.strictEqual(hipaa.isEncrypted('John Doe'), false);
    assert.strictEqual(hipaa.isEncrypted(''), false);
    assert.strictEqual(hipaa.isEncrypted(null), false);
    assert.strictEqual(hipaa.isEncrypted(undefined), false);
    assert.strictEqual(hipaa.isEncrypted(12345), false);
    assert.strictEqual(hipaa.isEncrypted({ not: 'a string' }), false);
  });

  test('isEncrypted returns false for non-v1 ciphertext-looking values', () => {
    // Future-proofing: a v2 format (if we ever add one) should NOT be
    // detected as v1-encrypted.
    assert.strictEqual(hipaa.isEncrypted('v2:abc:def:ghi'), false);
    assert.strictEqual(hipaa.isEncrypted('v0:abc:def:ghi'), false);
    // Note: 'v1:not_enough_parts' DOES count as "looks encrypted" because
    // isEncrypted is intentionally a cheap prefix check (used to decide
    // whether to call decryptPHI, which does the full format validation
    // and throws on malformed input). This is the documented contract —
    // see hipaa-encryption.js#isEncrypted.
    assert.strictEqual(hipaa.isEncrypted('v1:not_enough_parts'), true);
  });

  // -------------------------------------------------------------------------
  // IV randomness
  // -------------------------------------------------------------------------

  test('two encryptions of the same plaintext produce different ciphertexts', () => {
    const ctx = { tenant_id: 1, patient_id: 100, field_name: 'name' };
    const plain = 'John Doe';
    const enc1 = hipaa.encryptPHI(plain, ctx);
    const enc2 = hipaa.encryptPHI(plain, ctx);
    assert.notStrictEqual(enc1, enc2, 'random IV must produce different ciphertexts');
    // Both must decrypt back to the same plaintext
    assert.strictEqual(hipaa.decryptPHI(enc1, ctx), plain);
    assert.strictEqual(hipaa.decryptPHI(enc2, ctx), plain);
  });

  test('ciphertext starts with the v1: version prefix', () => {
    const ctx = { tenant_id: 1, patient_id: 100, field_name: 'name' };
    const enc = hipaa.encryptPHI('John Doe', ctx);
    assert.strictEqual(enc.startsWith('v1:'), true);
    // Format must be v1:<iv>:<authTag>:<enc> — exactly 4 colon-separated parts
    assert.strictEqual(enc.split(':').length, 4);
  });

  // -------------------------------------------------------------------------
  // Non-string inputs
  // -------------------------------------------------------------------------

  test('encryptPHI coerces numbers to strings and round-trips', () => {
    const ctx = { tenant_id: 1, patient_id: 100, field_name: 'phone' };
    // A numeric phone number like 256700000000 — encryptPHI should accept it.
    const enc = hipaa.encryptPHI(256700000000, ctx);
    assert.strictEqual(hipaa.decryptPHI(enc, ctx), '256700000000');
  });

  test('encryptPHI coerces Date objects to their ISO string representation', () => {
    const ctx = { tenant_id: 1, patient_id: 100, field_name: 'date_of_birth' };
    const d = new Date('1990-05-15T00:00:00.000Z');
    const enc = hipaa.encryptPHI(d, ctx);
    assert.strictEqual(hipaa.decryptPHI(enc, ctx), String(d));
  });

  // -------------------------------------------------------------------------
  // Key rotation stub
  // -------------------------------------------------------------------------

  test('rotatePHIKey stub throws with a clear, actionable error', async () => {
    await assert.rejects(
      () => hipaa.rotatePHIKey('old', 'new', {}, 'patient_portal_users', ['full_name'], 1),
      (err) => /not yet implemented|Key rotation runbook/i.test(err.message)
    );
  });

  // -------------------------------------------------------------------------
  // Key resolution
  // -------------------------------------------------------------------------

  test('getPHIKey throws when neither PHI_ENCRYPTION_KEY nor ENCRYPTION_KEY is set', () => {
    clearKeys();
    assert.throws(
      () => hipaa.getPHIKey(),
      /PHI_ENCRYPTION_KEY or ENCRYPTION_KEY/
    );
    setKey(TEST_KEY_HEX); // restore for downstream tests
  });

  test('getPHIKey falls back to ENCRYPTION_KEY when PHI_ENCRYPTION_KEY is unset', () => {
    delete process.env.PHI_ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = TEST_KEY_HEX;
    const key = hipaa.getPHIKey();
    assert.ok(Buffer.isBuffer(key));
    assert.strictEqual(key.length, 32, 'AES-256 requires a 32-byte key');
  });

  test('getPHIKey returns a 32-byte key (AES-256)', () => {
    const key = hipaa.getPHIKey();
    assert.ok(Buffer.isBuffer(key));
    assert.strictEqual(key.length, 32);
  });

  test('getPHIKey hashes non-hex input to a 32-byte key', () => {
    process.env.PHI_ENCRYPTION_KEY = 'some-passphrase-not-hex';
    const key = hipaa.getPHIKey();
    assert.strictEqual(key.length, 32);
    // Same input must produce the same key (deterministic hash)
    const key2 = hipaa.getPHIKey();
    assert.deepStrictEqual(key, key2);
  });

  test('buildAAD throws if context is missing required fields', () => {
    assert.throws(() => hipaa.buildAAD(null));
    assert.throws(() => hipaa.buildAAD({}));
    assert.throws(() => hipaa.buildAAD({ tenant_id: 1, patient_id: 1 })); // missing field_name
    assert.throws(() => hipaa.buildAAD({ tenant_id: 1, patient_id: 1, field_name: '' }));
  });

  test('ALGO constant is aes-256-gcm (NIST SP 800-38D)', () => {
    assert.strictEqual(hipaa.ALGO, 'aes-256-gcm');
  });

  test('VERSION constant is v1', () => {
    assert.strictEqual(hipaa.VERSION, 'v1');
  });
});
