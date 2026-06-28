# Tests

This directory contains the integration test suite for the ssewasswa-api
refactoring effort (audit findings F-06, F-07, F-08, and the README's
multi-tenant isolation claim).

The tests use Node's built-in `node:test` runner (no Jest / Mocha / Tap
dependency). They auto-discover any `*.test.js` file in this directory.

## Running tests

```bash
# All tests — runs everything that doesn't need a real DB by default.
# Tests that require TEST_DATABASE_URL skip themselves when it's unset.
npm test

# Run a specific file
node --test test/health.test.js

# Run only the no-DB tests (fast, safe to run anywhere)
node --test test/health.test.js test/db-migration-logging.test.js test/render-config.test.js

# Run everything (including DB-backed tests) against a local test Postgres
TEST_DATABASE_URL=postgres://localhost/ssewasswa_test node --test test/
```

## Test files

| File | What it covers | DB required? |
|------|----------------|--------------|
| `health.test.js` | `/ping`, `HEAD /ping`, `/api/health` in ok/degraded/down states (audit F-08) | No — DB is mocked via `_pg-mock.js` |
| `db-migration-logging.test.js` | `db.js#migrateQuery` logs `[MIGRATION FAILED]` loudly but does not reject (audit F-07) | No — uses a fake in-process pool |
| `render-config.test.js` | `render.yaml` no longer contains leaked secrets, uses `fromDatabase` binding, `healthCheckPath: /api/health`, `SESSION_SECRET: sync: false` (audit F-01) | No |
| `multi-tenant-isolation.test.js` | Two tenants cannot see each other's `students` rows (README claim, never tested before — audit F-06) | Yes — skips if `TEST_DATABASE_URL` unset |
| `auth-flow.test.js` | `/api/auth/register` → `/api/auth/login` → `/api/auth/me` → `/api/auth/logout` flow (audit F-06) | Yes — skips if `TEST_DATABASE_URL` unset |
| `_pg-mock.js` | Test helper (NOT a test file). Preloaded via `node --require` to mock the `pg` module so `health.test.js` can boot server.js without a real DB. | n/a |
| `hipaa-encryption.test.js` | AES-256-GCM encrypt/decrypt round-trip, AAD mismatch throws, null/empty/legacy pass-through, IV randomness, key resolution (Track A) | No |
| `kms.test.js` | KMS envelope-encryption adapter (Gap 8): local provider getDEK/encryptDEK/decryptDEK round-trip, DEK cache TTL, env-var precedence (KMS_PROVIDER vs PHI_KMS_PROVIDER), AWS KMS Encrypt/Decrypt via mocked client, error propagation | No — AWS client is mocked, no real AWS calls |
| `server.test.js` | Legacy unit tests for input validation, copied from the original repo. Kept for backwards compatibility. | No |

## Test database setup

The `auth-flow` and `multi-tenant-isolation` tests need a real Postgres
database. To set one up locally:

```bash
# 1. Create a test database
createdb ssewasswa_test

# 2. Set the env var
export TEST_DATABASE_URL=postgres://localhost/ssewasswa_test

# 3. Run migrations against the test DB (uses node-pg-migrate)
DATABASE_URL=$TEST_DATABASE_URL npm run migrate

# 4. Run the tests
npm test
```

The tests are written to be idempotent — they create their own tenants /
students with unique per-run identifiers and clean up after themselves, so
they can be re-run against the same test DB without manual cleanup.

## How the DB mock works (for `health.test.js`)

`health.test.js` spawns `server.js` as a subprocess with
`node --require test/_pg-mock.js server.js`. The preload hook intercepts
`require('pg')` and returns a `MockPool` whose `query()` method:

- Returns `{ rows: [{ n: 374 }] }` for the `/api/health` table-count probe
  when the state file contains `ok`.
- Returns `{ rows: [{ n: 0 }] }` when the state file contains `degraded`.
- Throws `Error("mock: DB unreachable")` when the state file contains
  `down`.
- Returns `{ rows: [] }` for all other queries (migrations, session store
  setup) so the server boots in milliseconds instead of timing out on
  hundreds of failing migration attempts.

The state file path is passed via `PG_MOCK_STATE_FILE`; the test writes
`ok` / `degraded` / `down` to it before each scenario.

## Notes / caveats

- The `/api/health` "down" test waits for `server.js` to reach the LIVE
  state (after the startup migration drain). This is necessary because
  `server.js` wraps `pool.query` in a startup guard that converts thrown
  errors into `{ rows: [] }` resolutions — which would make `/api/health`
  return `degraded` instead of `down` until the guard is disabled.
- `auth-flow.test.js` calls `/api/auth/register`, `/api/auth/login`,
  `/api/auth/me`, `/api/auth/logout`. These endpoints are part of the
  Track 1 refactor scope and may not exist on the current `main` branch.
  If they don't exist, the tests will fail with 404 — that's expected
  and the tests are ready to pass once the endpoints land.
- No new npm dependencies were added. The tests use only `node:test`,
  `node:assert`, `node:http`, `node:fs`, `node:os`, `node:path`,
  `node:child_process`, and the existing `pg` package (already in
  `dependencies`).
