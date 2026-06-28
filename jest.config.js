// jest.config.js
//
// Jest configuration for the ssewasswa-api cross-tenant boundary test suite.
//
// The existing test/ directory uses Node's built-in `node:test` runner for
// fast unit tests (health endpoint mocks, db.js migration logging, render.yaml
// validation). Jest + supertest is reserved for HTTP-level integration tests
// that need the full app running with a real database — specifically the
// cross-tenant boundary suite in test/jest/.
//
// The two test runners coexist:
//   - `npm test`          → runs node:test against test/*.test.js
//   - `npm run test:jest` → runs Jest against test/jest/**/*.test.js
//
// CI runs both (see .github/workflows/ci.yml).

module.exports = {
  // Use the Node environment (no jsdom — these tests don't need a DOM).
  testEnvironment: 'node',

  // Only discover tests under test/jest/. This prevents Jest from picking up
  // the node:test files in test/*.test.js (which use `require('node:test')`
  // and would error out under Jest).
  testMatch: ['**/test/jest/**/*.test.js'],

  // Coverage config (optional — used by `npm run test:jest -- --coverage`).
  // Routes are exercised end-to-end via supertest, so we exclude src/routes/
  // from the unit-test coverage metric (those handlers are covered by virtue
  // of the HTTP tests hitting them).
  collectCoverageFrom: [
    'src/**/*.js',
    'db.js',
    '!src/routes/**/*.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],

  // Shared setup file loaded after the test framework is installed in the
  // environment but before each test suite runs. Gives setup.js access to the
  // Jest globals (`beforeAll`, `afterAll`, etc.). Sets NODE_ENV, SESSION_SECRET,
  // CSRF_SECRET, ENCRYPTION_KEY; warns if DATABASE_URL is missing (the
  // cross-tenant suite will skip in that case).
  setupFilesAfterEnv: ['<rootDir>/test/jest/setup.js'],

  // Generous timeout — the cross-tenant suite spawns server.js as a
  // subprocess (which can take 30-60s to boot on a cold CI machine).
  testTimeout: 60000,

  // Serialize tests — the cross-tenant suite starts the app on a port and
  // creates DB records. Running suites in parallel would cause port conflicts
  // and tenant-data collisions. --maxWorkers=1 in the npm script enforces
  // this at the process level; this config is a belt-and-suspenders.
  maxWorkers: 1,

  // Verbose output so each test case is visible.
  verbose: true,
};
