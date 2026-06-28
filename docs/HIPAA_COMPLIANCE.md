# HIPAA Compliance — PHI Encryption Posture

This document describes the technical and organizational controls in place
for protecting Protected Health Information (PHI) in the ssewasswa-api
platform, what is covered by code, and what is **not** covered (and must
be handled organizationally before the platform can be operated as a
HIPAA-covered entity).

It is intended for:
- Security engineers reviewing the implementation
- Compliance officers preparing a SOC 2 / HITRUST audit
- DevOps staff running the platform in production
- Developers adding new PHI fields or tables

> **This is a technical reference, not legal advice.** HIPAA compliance is
> a combination of technical safeguards (this document), physical
> safeguards (datacenter controls at the cloud provider), and
> administrative safeguards (BAAs, workforce training, breach
> notification procedures). A covered entity must implement all three.

---

## 1. Scope — what counts as PHI on this platform

The platform stores Electronic Medical Record (EMR) data for tenants that
have the `clinic` / `hospital` / `health_center` business type. PHI is any
information in those tenants' records that could identify a patient and
relate to their health, including but not limited to:

| Table                  | PHI fields                                                                 |
| ---------------------- | -------------------------------------------------------------------------- |
| `patient_portal_users` | `full_name`, `date_of_birth`, `phone`, `address`, `email`, `emergency_contact_name`, `emergency_contact_phone` |
| `consultations`        | `chief_complaint`, `history`, `examination`, `diagnosis`, `treatment_plan`, `notes` |
| `prescriptions`        | `patient_name`, `diagnosis`, `notes`                                       |

The migration `migrations/000003_hipaa_phi_encryption.js` adds a
`phi_encrypted` boolean column to each of these tables so the platform can
distinguish ciphertext rows from legacy plaintext rows during a phased
backfill.

**Note on table naming:** the platform's de-facto "patients" table is
`patient_portal_users`. There is no table named `patients`. The
`/api/clinic/patients/*` endpoints in `src/routes/clinic-hipaa.js` map to
`patient_portal_users` under the hood.

---

## 2. Technical safeguards (what the code does)

### 2.1 Encryption algorithm

- **Algorithm:** AES-256-GCM (NIST SP 800-38D)
- **Key length:** 256 bits (32 bytes)
- **IV length:** 96 bits (12 bytes), freshly random per encryption
- **Auth tag length:** 128 bits (16 bytes)
- **Implementation:** Node.js `crypto.createCipheriv('aes-256-gcm', ...)` —
  the same primitive already used by `security-ops.js` for TOTP secret
  encryption in this codebase.
- **Ciphertext format:** `v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>` —
  versioned so future key rotations or algorithm upgrades can introduce
  `v2:` rows without breaking reads of `v1:` rows.

### 2.2 Key management

**Dev / staging / single-tenant demo:**
- The AES key is read from `process.env.PHI_ENCRYPTION_KEY` (preferred) or
  `process.env.ENCRYPTION_KEY` (fallback).
- Accepts either 64 hex chars (= 32 raw bytes, used directly) or any
  other string (SHA-256 hashed to a 32-byte key).
- See `src/lib/hipaa-encryption.js#getPHIKey()`.

**Production (target architecture):**
- **Envelope encryption with cloud KMS** — AWS KMS, Google Cloud KMS, or
  Azure Key Vault.
- The **master key** (Customer Master Key / Key Encryption Key) lives
  inside KMS and never leaves it. It can only be used via an authenticated
  KMS API call; it cannot be read out.
- A **per-tenant Data Encryption Key (DEK)** is generated locally, sent to
  KMS for encryption under the master key, and the resulting ciphertext is
  stored in `tenants.phi_encryption_key_id`.
- At boot, for each tenant, the platform fetches the encrypted DEK from
  the DB, sends it to KMS for decryption, and caches the plaintext DEK in
  process memory for the lifetime of the process. The plaintext DEK never
  touches disk or env vars.
- All PHI encrypt/decrypt operations use the in-memory DEK.
- See `src/lib/kms.js` for the adapter (currently a stub returning the
  local env-var key; the AWS KMS path is documented as a TODO with the
  full implementation plan in the file).

**Why per-tenant DEKs matter:** compromising tenant A's DEK does NOT
expose tenant B's PHI. This is cryptographic isolation between tenants,
stronger than row-level security alone.

### 2.3 AAD binding (ciphertext can't be moved between records)

Every `encryptPHI(plaintext, context)` call binds the ciphertext to its
context via AES-GCM Additional Authenticated Data (AAD):

```
context = { tenant_id, patient_id, field_name }
AAD     = Buffer.from(`${tenant_id}|${patient_id}|${field_name}`)
```

The auth tag covers both the ciphertext AND the AAD. Consequences:

- If an attacker with DB write access copies patient A's encrypted `phone`
  value into patient B's `phone` column, decryption of B's row throws
  (auth-tag mismatch — the AAD includes `patient_id`).
- If an attacker copies the `phone` value into the `address` column of
  the same row, decryption throws (AAD includes `field_name`).
- If an attacker copies the value across tenants, decryption throws (AAD
  includes `tenant_id`).

This is the cryptographic guarantee that ciphertexts can't be "moved"
between records undetected — a key HIPAA §164.312(c)(1) integrity
control.

The `decryptPHI` function deliberately **throws** on AAD mismatch rather
than returning null. A silent null would hide a security-critical event
(tampering or row corruption); a loud throw makes it impossible to ignore.

### 2.4 Audit logging (HIPAA §164.312(b))

Every `encryptPHI` and `decryptPHI` call made by the
`src/routes/clinic-hipaa.js` wrapper writes a row to
`phi_encryption_audit_log`:

```sql
CREATE TABLE phi_encryption_audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INT NOT NULL,
  table_name TEXT NOT NULL,
  record_id INT NOT NULL,
  field_name TEXT NOT NULL,     -- may be a comma-separated list
  action TEXT NOT NULL,         -- 'encrypt' | 'decrypt' | 'rotate'
  actor_user_id INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Indexes:
- `(tenant_id, created_at DESC)` — for the HIPAA audit dashboard.
- `(table_name, record_id, created_at DESC)` — for "who accessed patient
  X's PHI?" reports (HIPAA §164.528 right of access).
- `WHERE action = 'rotate'` — for the key-rotation runbook.

**Important behavior:** if the audit-log INSERT itself fails (e.g. DB
outage), the request does **not** fail — the access still happened, so
denying the response would be a worse outcome. The failure is logged to
`console.error` with the `[HIPAA]` prefix and treated as a separate
incident to investigate.

### 2.5 Phased rollout

The `phi_encrypted` boolean column on each PHI-bearing table is `false`
on legacy rows and `true` on rows written through the
`/api/clinic/*` endpoints. The `decryptPHI` function transparently
passes through values that don't start with `v1:`, so a request that
fetches a mix of ciphertext and legacy plaintext rows will correctly
return each value as-is — no need to take the table offline for a
big-bang backfill.

A follow-up task should write a one-shot backfill script that iterates
each PHI table in batches, encrypts the plaintext fields in place, and
flips `phi_encrypted` to `true`. See "Open issues" below.

---

## 3. Endpoints

The `/api/clinic/*` endpoints in `src/routes/clinic-hipaa.js` are the
HIPAA-compliant interface for reading and writing patient PHI:

| Method | Path                                | Behavior                                                    |
| ------ | ----------------------------------- | ----------------------------------------------------------- |
| GET    | `/api/clinic/patients`              | List patients (paginated); PHI decrypted on read            |
| GET    | `/api/clinic/patients/:id`          | Fetch one patient; PHI decrypted                            |
| POST   | `/api/clinic/patients`              | Create patient; PHI encrypted on write                      |
| PUT    | `/api/clinic/patients/:id`          | Update patient; PHI re-encrypted                            |
| GET    | `/api/clinic/consultations/:id`     | Fetch one consultation; PHI decrypted                       |
| POST   | `/api/clinic/consultations`         | Create consultation; PHI encrypted                          |
| GET    | `/api/clinic/prescriptions/:id`     | Fetch one prescription; PHI decrypted                       |
| POST   | `/api/clinic/prescriptions`         | Create prescription; PHI encrypted                          |
| GET    | `/api/clinic/hipaa/status`          | Per-table encryption counts + recent audit log (10 entries) |

All endpoints require an authenticated session (`requireAuth`) and a
non-banned user (`requireNotBanned`). Tenant isolation is enforced by
filtering every query on `tenant_id = req.session.user.tenant_id`.

**Two-step write pattern:** Because the AAD context requires the row's
`id` (which we only know after the INSERT), the POST handlers first
INSERT the non-PHI fields with `RETURNING id`, then UPDATE the PHI
fields with their ciphertext. This is a deliberate trade-off — it costs
one extra round-trip per write, but it lets us bind every ciphertext to
the row's actual id rather than a placeholder.

---

## 4. Key rotation runbook

Key rotation is required by HIPAA §164.312(a)(2)(iv). The recommended
cadence is annually, plus immediately upon any suspected key compromise.

### 4.1 Current state

`rotatePHIKey()` in `src/lib/hipaa-encryption.js` is a **stub that
throws**. The full implementation needs:

1. Accept both the old key AND the new key explicitly (NOT just from
   `process.env.PHI_ENCRYPTION_KEY`, which would already have been
   switched).
2. Iterate every row of a target table `WHERE tenant_id = $1 AND
   phi_encrypted = true`, in batches of ~1000, within a transaction per
   batch.
3. For each PHI column: `decryptPHI(value, ctx, oldKey)` then
   `encryptPHI(plaintext, ctx, newKey)`. UPDATE the row in place.
4. Append a `phi_encryption_audit_log` row with `action='rotate'` for
   each rotated row.
5. Support resuming from a checkpoint (store the last-processed `id` in
   a temp table) so a crash mid-rotation can resume without re-doing
   work.

### 4.2 Manual rotation procedure (until the stub is implemented)

Until the stub is implemented, rotation is a manual, scheduled,
operator-driven process:

1. **Generate the new key:**
   ```bash
   openssl rand -hex 32
   ```

2. **Schedule a maintenance window.** Rotation requires rewriting every
   encrypted row — on a multi-million-row table this can take hours.
   The platform stays up (the `phi_encrypted` flag lets reads of
   not-yet-rotated rows proceed normally), but writes to that table
   should be paused to avoid a race between the rotation script and new
   writes.

3. **Run a one-shot re-encryption script** (to be written — see Open
   issues) that iterates the table, decrypts with the old key, re-encrypts
   with the new key, and UPDATEs each row. The script must:
   - Use an explicit `--old-key` and `--new-key` argument (never read
     from env — env is for the active key, not the rotation source).
   - Run in batches inside transactions.
   - Write a `phi_encryption_audit_log` row with `action='rotate'` per
     batch.
   - Be idempotent: re-running on an already-rotated row should be a
     no-op (because the decrypt would fail with the old key — detect and
     skip).

4. **Switch `PHI_ENCRYPTION_KEY` in production** to the new key. Restart
   the app. New writes will use the new key.

5. **Verify** via `/api/clinic/hipaa/status` that all rows have
   `phi_encrypted = true` and that a sample of patients can be fetched
   and decrypted successfully.

6. **Securely destroy the old key.** It should not be recoverable from
   backups, env files, shell history, or git.

### 4.3 KMS-managed keys (production target)

When the KMS adapter is wired up (see `src/lib/kms.js`), rotation
becomes:

1. **Master-key rotation in KMS** — triggers KMS to re-encrypt all
   stored encrypted DEKs under the new master key. No application
   downtime. The plaintext DEKs (in app memory) do not change, so no
   row re-encryption is needed.
2. **Per-tenant DEK rotation** — generate a new DEK, encrypt with KMS,
   store in `tenants.phi_encryption_key_id`, then run the re-encryption
   script for that tenant only. Smaller blast radius than rotating a
   single global key.

---

## 5. What is NOT covered by code

HIPAA has administrative and physical safeguard requirements that no
code can satisfy on its own. The following MUST be in place
organizationally before this platform is operated as a HIPAA-covered
entity. None of them are blocked by this code, but they are not
implemented by it either.

### 5.1 Business Associate Agreements (BAAs)

HIPAA §164.308(b) and §164.502(e) require a BAA with every
subcontractor that creates, receives, maintains, or transmits PHI on
the covered entity's behalf. For this platform, BAAs are required with
at minimum:

- **Cloud hosting provider** (Render, AWS, GCP, Azure) — for compute,
  storage, and database infrastructure.
- **KMS provider** (AWS KMS, Google Cloud KMS, Azure Key Vault) —
  because the master key lives there.
- **Database provider** (managed Postgres on Render, RDS, Cloud SQL) —
  for at-rest storage of the (encrypted) PHI ciphertext and the audit
  log.
- **Email/SMS providers** used for OTP delivery — patient portal login
  codes are sent via SMS/email; the provider sees the phone number /
  email address, which is PHI when associated with a patient.
- **Error monitoring / logging** (Sentry, Datadog, etc.) — if any PHI
  appears in a stack trace or log line, the provider has accessed PHI.

Without signed BAAs in place, using these providers to handle PHI is a
HIPAA violation regardless of how good the encryption is.

### 5.2 Access controls for clinicians (HIPAA §164.312(a)(1))

The code enforces tenant isolation (every query filters on `tenant_id`)
and requires an authenticated session, but it does **not** enforce
role-based access within a tenant:

- A receptionist should not be able to read consultation notes (only
  clinicians).
- A pharmacist should be able to read prescriptions but not consultation
  histories.
- A billing clerk should see only the financial fields, not the clinical
  narrative.

The platform has an `rbac-manager.js` module — extending it with a
clinician-role check on `/api/clinic/*` is a follow-up. Until then,
**every authenticated user in the tenant can read every patient's full
PHI**, which is too broad for HIPAA §164.312(a)(1) ("Information Access
Management").

### 5.3 Breach notification procedure (HIPAA §164.400–414)

If PHI is disclosed without authorization (e.g. a bug returns another
patient's data, an employee misuses access, or the encryption key is
compromised), the covered entity must:

- Notify affected individuals within 60 days.
- Notify HHS.
- Notify the media if the breach affects 500+ residents of a state or
  jurisdiction.

The `phi_encryption_audit_log` is the primary evidence source for
investigating breaches — but the notification procedure itself is an
organizational runbook, not code. A draft runbook should be written and
rehearsed before launch.

### 5.4 Workforce training (HIPAA §164.530(b))

Every workforce member with access to PHI must receive training on:
- What PHI is
- The sanctioned uses and disclosures
- Sanctions for violations
- The breach reporting chain

Code can't deliver this — it's an HR / compliance function.

### 5.5 Data retention and disposal (HIPAA §164.530(j))

State laws vary on how long medical records must be retained (typically
6–10 years for adults). When records are deleted:

- The DB row is deleted, but the ciphertext must also be irrecoverable
  from backups.
- The audit log entry is retained (it's the legal record of who accessed
  what — it must NOT be deleted with the patient row).

A documented retention + disposal policy is required. The
`phi_encryption_audit_log` table is intentionally not cascaded on tenant
delete — operators must decide explicitly what to do with it.

### 5.6 Physical safeguards (HIPAA §164.310)

Datacenter access controls, facility security, workstation use policies,
and device & media controls are the responsibility of the cloud provider
(covered in their SOC 2 / HITRUST reports, which the covered entity
should review annually as part of vendor risk management).

---

## 6. Open issues / follow-up tasks

Tracked as code comments and worklog entries; repeated here for
visibility:

1. **KMS adapter is a stub.** `src/lib/kms.js` returns the local
   env-var key. The AWS KMS path (`getAwsDEK`, `encryptDEK`,
   `decryptDEK`, `warmDEKCache`) is documented as TODO with a full
   implementation plan but not yet wired up. **Required before
   multi-tenant production.**

2. **Key rotation is a stub.** `rotatePHIKey()` throws. The manual
   runbook in §4.2 above is the interim process. The full
   batched/transactional/resumable implementation is a follow-up task.

3. **Backfill script not yet written.** Existing plaintext rows in
   `patient_portal_users` / `consultations` / `prescriptions` need to be
   encrypted in place. The `phi_encrypted` column makes this safe
   (decryptPHI passes through plaintext), but the actual one-shot script
   that flips rows from `false` to `true` is a follow-up.

4. **RBAC within a tenant is not enforced.** See §5.2.

5. **Old inline `/clinic/*` UI routes in `server.js` still read
   plaintext.** The `/api/clinic/*` endpoints in
   `src/routes/clinic-hipaa.js` are the HIPAA-compliant interface. The
   existing inline UI routes (`/clinic/patient/:type/:id/ehr`, etc.)
   were not touched per the Conservative refactor policy. Migrating
   them to use the new encrypted endpoints is a follow-up.

6. **Audit-log integrity is not tamper-evident.** A privileged DB user
   could DELETE rows from `phi_encryption_audit_log` to cover their
   tracks. Mitigations to consider: append-only table permissions,
   hash-chaining of rows, or streaming to an external
   write-once-read-many log (e.g. AWS CloudWatch Logs with
   immutability).

7. **Field-level encryption does not protect against inference.** Even
   with the `notes` field encrypted, the existence of a row in
   `consultations` reveals that the patient was seen on a given date.
   Differential privacy / query auditing is out of scope for this
   implementation.

---

## 7. Quick reference — where the code lives

| Component                       | File                                              |
| ------------------------------- | ------------------------------------------------- |
| Encryption primitives           | `src/lib/hipaa-encryption.js`                     |
| KMS envelope-encryption adapter | `src/lib/kms.js`                                  |
| DB migration                    | `migrations/000003_hipaa_phi_encryption.js`       |
| Express route handlers          | `src/routes/clinic-hipaa.js`                      |
| Unit tests                      | `test/hipaa-encryption.test.js`                   |
| This document                   | `docs/HIPAA_COMPLIANCE.md`                        |

To run the tests:

```bash
cd /home/z/my-project/repo
node --test test/hipaa-encryption.test.js
```

To smoke-test the encryption module:

```bash
node -e "
  const { encryptPHI, decryptPHI, isEncrypted } = require('./src/lib/hipaa-encryption');
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  const ctx = { tenant_id: 1, patient_id: 100, field_name: 'name' };
  const enc = encryptPHI('John Doe', ctx);
  console.log('Encrypted:', enc);
  console.log('Is encrypted:', isEncrypted(enc));
  console.log('Decrypted:', decryptPHI(enc, ctx));
"
```
