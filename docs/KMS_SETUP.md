# KMS Setup Guide

This document explains how to configure the KMS provider for HIPAA-compliant
field-level encryption of patient data (PHI) in the ssewasswa-api.

For background on the envelope-encryption pattern and the cryptographic
contract, see [`HIPAA_COMPLIANCE.md`](./HIPAA_COMPLIANCE.md). This document
focuses on operational setup.

## Provider selection

Set the `KMS_PROVIDER` env var:

- `local` (default): Uses the `PHI_ENCRYPTION_KEY` or `ENCRYPTION_KEY` env var.
  The master key is stored in the environment. **For dev/staging only.**
- `aws`: Uses AWS KMS. The master key never leaves KMS. **For production.**

Backward-compat note: the legacy env-var names `PHI_KMS_PROVIDER` and
`PHI_KMS_KEY_ID` (written by the original Track A stub) are still honored if
the new short names are not set. New deployments should prefer the short
names.

| Setting | New name | Legacy name | Required? |
|---------|----------|-------------|-----------|
| Provider | `KMS_PROVIDER` | `PHI_KMS_PROVIDER` | No (defaults to `local`) |
| KMS master key ID/ARN | `AWS_KMS_KEY_ID` | `PHI_KMS_KEY_ID` | Only when `KMS_PROVIDER=aws` |
| AWS region | `AWS_REGION` | (same) | Only when `KMS_PROVIDER=aws` (defaults to `us-east-1`) |
| Local master key | `PHI_ENCRYPTION_KEY` | (same) | Only when `KMS_PROVIDER=local` |

## Local provider setup (dev)

```bash
# Generate a 32-byte (64 hex char) key
openssl rand -hex 32

# Set as env vars
export PHI_ENCRYPTION_KEY=<the 64-char hex string>
export KMS_PROVIDER=local
```

In local mode, `getDEK(tenantId)` derives a 32-byte DEK from
`PHI_ENCRYPTION_KEY` (or `ENCRYPTION_KEY`). `encryptDEK(dek)` returns
`local:<base64(dek)>` — this is **not** real encryption; the env-var key is
the master key. The `local:` prefix lets `decryptDEK` recognize the format
unambiguously (vs. raw base64 KMS ciphertext).

## AWS KMS provider setup (production)

### 1. Create a KMS key

In the AWS Console:

1. Go to **KMS** → **Customer managed keys** → **Create key**
2. Key type: **Symmetric**
3. Key usage: **Encrypt and decrypt**
4. Advanced options → Key material origin: **KMS**
5. Alias: `ssewasswa-phi-master-key`
6. Key administrators: your IAM user/role
7. Key usage permissions: the IAM role that runs the ssewasswa-api service

Copy the Key ID (e.g. `arn:aws:kms:us-east-1:123456789012:key/abcd-1234-...`).

### 2. Configure IAM permissions

The IAM role running ssewasswa-api needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:GenerateDataKey",
        "kms:DescribeKey"
      ],
      "Resource": "arn:aws:kms:us-east-1:123456789012:key/abcd-1234-..."
    }
  ]
}
```

Best practice: scope the `Resource` to the specific KMS key ARN (not
`"*"`). This prevents the ssewasswa-api role from using other KMS keys in
the account, even if the role is later over-granted.

### 3. Set env vars

```bash
export KMS_PROVIDER=aws
export AWS_KMS_KEY_ID=arn:aws:kms:us-east-1:123456789012:key/abcd-1234-...
export AWS_REGION=us-east-1
# AWS credentials are picked up from the standard credential provider chain:
#   1. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY env vars
#   2. ~/.aws/credentials file
#   3. IAM role attached to the EC2/ECS/EKS compute (recommended for Render)
```

On Render: set the env vars in the dashboard. `AWS_KMS_KEY_ID` should be
`sync: false` (set once, not regenerated). For credentials on Render, the
simplest path is to set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as
`sync: false` env vars pointing to an IAM user with the policy above. (If
Render ever adds native IAM role support for web services, switch to that.)

### 4. Migrate existing data (if any)

If you have existing PHI encrypted with the local provider, you need to
migrate to the AWS provider:

1. Set `KMS_PROVIDER=local` (the old provider) and boot the API.
2. For each tenant, read their `phi_encryption_key_id` (the `local:...` DEK).
3. Decrypt all PHI fields for that tenant (using the legacy local DEK).
4. Switch `KMS_PROVIDER=aws` and reboot.
5. Generate a new DEK with `generateNewDEK()` — returns the new encrypted DEK.
6. Update `tenants.phi_encryption_key_id` with the new encrypted DEK.
7. Re-encrypt all PHI fields for that tenant with the new DEK.
8. Verify by reading rows back through the API and confirming the plaintext
   matches.

A migration script (`scripts/migrate-kms-provider.js`) should be written to
automate this. **Status: TODO — not yet implemented.** The manual runbook
in [`HIPAA_COMPLIANCE.md`](./HIPAA_COMPLIANCE.md) §4.2 "Key rotation
runbook" is the interim process (it covers the same decrypt-with-old /
re-encrypt-with-new flow).

## Key rotation

Two independent rotation axes:

### KMS master key rotation

Rotate the KMS master key annually (HIPAA §164.312(a)(2)(iv) — "periodic
rotation"):

1. Create a new KMS key in AWS (same region).
2. Update `AWS_KMS_KEY_ID` to the new key ARN.
3. For each tenant, generate a new DEK with `generateNewDEK()` and update
   `tenants.phi_encryption_key_id` with the new encrypted DEK.
4. Re-encrypt all PHI for each tenant with the new DEK (using
   `rotatePHIKey` — see the HIPAA runbook; it's currently a stub, so the
   rotation is manual).
5. Schedule the old KMS key for deletion (with a 7-30 day grace period in
   case you missed a row).

Note: KMS supports **automatic key rotation** (annual, same key ARN, KMS
generates new key material internally). Enable this on your KMS key — it's
a one-click in the console and satisfies the "periodic rotation" requirement
without the per-tenant re-encryption step above. The per-tenant re-encryption
flow above is for when you want to switch to a *different* KMS key (e.g.
moving to a new account).

### Per-tenant DEK rotation

Per-tenant DEKs can be rotated independently of the KMS master key:

1. For the target tenant: `const { dek: newDek, encryptedDek } = await generateNewDEK();`
2. UPDATE `tenants.phi_encryption_key_id = $1 WHERE id = $2` with the new
   `encryptedDek`.
3. Re-encrypt all PHI rows for that tenant with `newDek`.
4. `invalidateDEK(tenantId)` so the next request re-decrypts.

Use cases: suspected DEK compromise, off-boarding a tenant (rotate then
disable), scheduled annual per-tenant rotation.

## How envelope encryption works

```
┌─────────────────────────────────────────────────────────┐
│  AWS KMS                                                 │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Master Key (never leaves KMS)                      │ │
│  │  ARN: arn:aws:kms:us-east-1:...:key/abcd-1234-...   │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                          │
                          │ encryptDEK(dek) → KMS.Encrypt()
                          │ decryptDEK(encryptedDek) → KMS.Decrypt()
                          ▼
┌─────────────────────────────────────────────────────────┐
│  ssewasswa-api (in memory)                              │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Per-tenant DEK (32 bytes, AES-256 key)             │ │
│  │  Cached for 5 minutes (DEK_CACHE_TTL_MS)            │ │
│  │  Map<tenantId, { dek, encryptedDek, expiresAt }>    │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                          │
                          │ encryptPHI(plaintext, ctx) → AES-256-GCM
                          │ decryptPHI(ciphertext, ctx) → AES-256-GCM
                          ▼
┌─────────────────────────────────────────────────────────┐
│  PostgreSQL                                              │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  tenants.phi_encryption_key_id (encrypted DEK)      │ │
│  │  patient_portal_users.full_name (PHI ciphertext)    │ │
│  │  patient_portal_users.date_of_birth (PHI ciphertext)│ │
│  │  consultations.diagnosis (PHI ciphertext)           │ │
│  │  prescriptions.notes (PHI ciphertext)               │ │
│  │  ...                                                │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

The master key never leaves KMS. The plaintext DEK is in memory only briefly
(cached for 5 min). At rest, only the encrypted DEK (in
`tenants.phi_encryption_key_id`) and the encrypted PHI (in the various
clinic tables) are stored.

## API reference

`src/lib/kms.js` exports:

| Function | Signature | Returns |
|----------|-----------|---------|
| `getDEK` | `(tenantId, storedEncryptedDek = null)` | `Promise<{ dek: Buffer, encryptedDek: string, isNew: boolean }>` |
| `encryptDEK` | `(dek: Buffer)` | `Promise<string>` — `local:<b64>` or base64 KMS ciphertext |
| `decryptDEK` | `(encryptedDek: string\|Buffer)` | `Promise<Buffer>` — 32-byte DEK |
| `warmDEKCache` | `(tenantId, storedEncryptedDek = null)` | `Promise<void>` — best-effort, errors logged not thrown |
| `generateNewDEK` | `()` | `Promise<{ dek: Buffer, encryptedDek: string }>` |
| `invalidateDEK` | `(tenantId)` | `void` — drops one tenant's cached DEK |
| `clearDEKCache` | `()` | `void` — drops all cached DEKs |
| `getKmsProvider` | `()` | `'aws'\|'local'\|'gcp'\|'azure'` (reads env live) |
| `KMS_PROVIDER` | (constant) | the resolved provider, frozen at module load |

## Verifying your setup

After setting the env vars, smoke-test:

```bash
# Local provider
KMS_PROVIDER=local PHI_ENCRYPTION_KEY=$(openssl rand -hex 32) \
  node -e "
    const { getDEK, clearDEKCache } = require('./src/lib/kms');
    (async () => {
      clearDEKCache();
      const { dek, encryptedDek, isNew } = await getDEK(1, null);
      console.log('DEK length:', dek.length, 'bytes');
      console.log('Encrypted DEK:', encryptedDek);
      console.log('Is new:', isNew);
    })();
  "

# AWS provider — requires real KMS access. Will make a real Encrypt API call.
KMS_PROVIDER=aws AWS_KMS_KEY_ID=arn:aws:kms:us-east-1:... \
  node -e "
    const { generateNewDEK, decryptDEK } = require('./src/lib/kms');
    (async () => {
      const { dek, encryptedDek } = await generateNewDEK();
      console.log('DEK length:', dek.length, 'bytes');
      console.log('Encrypted DEK (b64):', encryptedDek.substring(0, 40), '...');
      const decrypted = await decryptDEK(encryptedDek);
      console.log('Round-trip OK:', dek.equals(decrypted));
    })();
  "
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `KMS: local provider requires PHI_ENCRYPTION_KEY...` | `KMS_PROVIDER=local` (or unset) but no env key | Set `PHI_ENCRYPTION_KEY` (64 hex chars) |
| `KMS: KMS_PROVIDER=aws but AWS_KMS_KEY_ID ... is not set` | Forgot to set the KMS key ARN | Set `AWS_KMS_KEY_ID` (or legacy `PHI_KMS_KEY_ID`) |
| `AccessDeniedException` from KMS | IAM role missing `kms:Encrypt`/`kms:Decrypt` on the key | Add the IAM policy from §2 above |
| `KMSNotFoundException` | The KMS key ARN is wrong, or the key was deleted | Verify the ARN in the AWS console |
| `ThrottlingException` | KMS rate limit hit (rare for low-traffic APIs) | The 5-min DEK cache insulates you; if it persists, request a quota increase |
| `decryptDEK: cannot decrypt — unknown format` | The encrypted DEK string is malformed (truncated, wrong encoding) | Check the value in `tenants.phi_encryption_key_id`; if pre-rotation, decrypt with the old key first |
