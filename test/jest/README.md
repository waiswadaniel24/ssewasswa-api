# Jest + supertest tests

These tests verify cross-tenant data boundaries at the HTTP level (unlike the
`node:test` tests in the parent `test/` directory, which verify at the SQL
level).

## What's here

| File | What it covers | DB required? |
|------|----------------|--------------|
| `setup.js` | Shared Jest setup — loads `.env`, sets default `SESSION_SECRET` / `CSRF_SECRET` / `ENCRYPTION_KEY`, warns if `DATABASE_URL` is missing, suppresses noisy `[Migration]` / `[DB ...]` / `[Startup]` logs. | No |
| `cross-tenant-boundaries.test.js` | The main deliverable. Spawns `server.js` as a subprocess, creates two tenants + users + students + fees + donations + API keys, then verifies via supertest that tenant A cannot see / fetch / update / delete tenant B's data — across 6 describe blocks (auth boundaries, API-key boundaries, session-based boundaries, tenant-ID tampering defense, public-verify boundaries, session-fixation prevention). 17 test cases total. | Yes — skips if `DATABASE_URL` unset |

## Running

```bash
# All Jest tests (skips DB-dependent tests if DATABASE_URL is not set)
npm run test:jest

# With coverage report
npm run test:jest -- --coverage

# Watch mode (for development)
npm run test:jest -- --watch
```

The `test:jest` script runs `jest --maxWorkers=1` because the cross-tenant
suite spawns `server.js` as a subprocess and creates DB records. Running
suites in parallel would cause port conflicts and tenant-data collisions.

## Test database setup

The cross-tenant boundary tests need a real Postgres database with the schema
migrated. To set one up locally:

```bash
# 1. Create a test database
createdb ssewasswa_test

# 2. Run migrations against it (uses node-pg-migrate)
DATABASE_URL=postgres://localhost/ssewasswa_test npm run migrate

# 3. Run the Jest suite
DATABASE_URL=postgres://localhost/ssewasswa_test npm run test:jest
```

The tests create two tenants, two users, two students, two fees, two
donations, and two API keys — each pair tagged with a unique per-run ID
(`${Date.now()}-${process.pid}`). They clean up after themselves via
`afterAll`, so they can be re-run against the same test DB without manual
cleanup.

## CI

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs both:
- `npm test` (node:test — fast unit tests, no DB needed) in the `test` job.
- `npm run test:jest` (Jest + supertest — HTTP-level integration tests) in
  the `integration-test` job, which spins up a `postgres:15` service
  container and runs migrations against it.

See the workflow file for the Postgres service container configuration.

## Why both Jest and node:test?

- **`node:test`** (in the parent `test/` directory) is for fast unit tests
  that don't need a running app — health endpoint mocks, `db.js` migration
  logging, `render.yaml` validation, multi-tenant isolation at the SQL level.
  These run in seconds and have zero npm dependencies.
- **`jest + supertest`** (in this `test/jest/` directory) is for integration
  tests that need the full app running and a real database. Jest's
  `describe.skip` and `setupFilesAfterEnv` hooks make it easy to skip the
  whole suite when `DATABASE_URL` is missing. supertest gives us real HTTP
  request/response semantics (status codes, headers, cookies, JSON bodies)
  that `node:test` + manual `http.request` doesn't handle as cleanly.

The two test runners coexist. `npm test` runs node:test; `npm run test:jest`
runs Jest. CI runs both.

## Skip behavior

The entire `cross-tenant-boundaries.test.js` suite skips cleanly (Jest reports
it as "skipped", exit code 0) when any of these is true:

| Condition | Reason |
|-----------|--------|
| `supertest` not installed | devDependencies not yet installed |
| `DATABASE_URL` not set | no test DB available |
| `bcryptjs` not installed | needed to hash test-user passwords |
| `pg` not installed | needed to seed the test DB |

This lets CI run Jest on every push without breaking when the Postgres
service container is unavailable (e.g., in a forked PR build).

## Notes / caveats

- The cross-tenant suite spawns `server.js` as a subprocess (rather than
  using `supertest(app)` directly) because `server.js` calls
  `server.listen()` at the bottom and does NOT `module.exports = app`. This
  mirrors the approach used by the existing `test/auth-flow.test.js`.
- The `/api/v1/fees/pay` and `/school/students/:id/update` / `/delete` routes
  respond with success (200/302) even when 0 rows are affected by their
  tenant-scoped `WHERE` clause. The tests assert on the DB state, not the
  HTTP response, to verify cross-tenant writes are actually blocked.
- The `setup.js` file suppresses `console.log` / `console.warn` for
  well-known boot-time noise patterns (`[Migration]`, `[DB ...]`,
  `[Startup]`, `[Session]`, `[SettingsSearch]`, "Comfort Platform LIVE",
  etc.). Real errors and unexpected logs still pass through. The originals
  are restored in `afterAll` so watch-mode sessions don't accumulate
  wrappers.
- Test cases: **17** across 6 describe blocks
  (auth boundaries × 4, API-key boundaries × 6, session-based boundaries × 5,
  tampering defense × 2, public-verify × 1, session-fixation × 2 — actually
  20 cases total; the "valid login as tenant A → 302 redirect" is a sanity
  check on the login flow that the session-based tests depend on).
