// test/jest/setup.js
//
// Shared setup for all Jest test suites under test/jest/.
//
// This file is loaded ONCE per test file by Jest (via `setupFilesAfterEnv` in
// jest.config.js) after the test framework is installed in the environment.
// It has access to Jest globals like `beforeAll` / `afterAll`.
//
// Responsibilities:
// 1. Load .env if present (for local dev convenience).
// 2. Set sensible defaults for required env vars (NODE_ENV, SESSION_SECRET,
//    CSRF_SECRET, ENCRYPTION_KEY) so the app can boot without a real .env.
// 3. Warn loudly if DATABASE_URL is missing — the cross-tenant suite skips
//    itself when DATABASE_URL is unset, so this is informational only.
// 4. Suppress noisy console output from server.js during tests (migration
//    logs, [DB ...] logs) to keep Jest output readable. Real errors and
//    warnings are still passed through.

// Load env vars from .env if present (no-op if the file doesn't exist).
try {
  require('dotenv').config();
} catch (e) {
  // dotenv is in dependencies; if it's somehow missing, fall through silently.
}

// Set test env vars if not already set. Tests should be able to run without
// a .env file as long as DATABASE_URL is exported in the shell.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'jest-test-session-secret';
process.env.CSRF_SECRET = process.env.CSRF_SECRET || 'jest-test-csrf-secret';
// ENCRYPTION_KEY must be a 64-char hex string (32 bytes). The default 'a'×64
// is fine for tests — never used in production.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);

// If no DATABASE_URL, the cross-tenant suite will skip itself. Surface a
// helpful message so the developer knows how to enable the DB-backed tests.
if (!process.env.DATABASE_URL) {
  // Use originalConsoleWarn (captured below) if available, otherwise plain.
  const warnFn = (typeof console !== 'undefined' && console.warn) ? console.warn.bind(console) : console.log.bind(console);
  warnFn('[Jest setup] DATABASE_URL not set — DB-dependent tests will skip.');
  warnFn('[Jest setup] To run DB tests: export DATABASE_URL=postgres://localhost/ssewasswa_test');
  warnFn('[Jest setup] Then run: DATABASE_URL=$DATABASE_URL npm run migrate');
}

// ---------------------------------------------------------------------------
// Console noise suppression
// ---------------------------------------------------------------------------
//
// server.js logs a lot of [Migration], [DB ...], [Startup] messages while
// booting. These would dominate the Jest output and hide real test failures.
// We intercept console.log / console.warn / console.error and filter out the
// known-noisy patterns. Real errors and unexpected logs still pass through.
//
// We restore the originals in `afterAll` so a watch-mode session doesn't
// accumulate wrappers.

const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

// Patterns to suppress. Kept conservative — only the well-known boot-time
// noise from server.js, db.js, and the migration queue.
const SUPPRESS_LOG_PATTERNS = [
  /^\[Migration\]/,
  /^\[DB\b/,
  /^\[Startup\]/,
  /^\[Session\]/,
  /^\[SettingsSearch\]/,
  /Comfort Platform LIVE/,
  /running migrations before accepting traffic/,
  /Guard queue drained/,
  /MigrationQueue drain timeout/,
  /queued migrations\.\.\./,
];

const SUPPRESS_WARN_PATTERNS = [
  /^\[Migration\]/,
  /^\[DB\b/,
  /connect-pg-simple not available/,
];

function shouldSuppress(msg, patterns) {
  if (typeof msg !== 'string') return false;
  return patterns.some(p => p.test(msg));
}

console.log = (...args) => {
  const msg = args.length > 0 ? String(args[0]) : '';
  if (shouldSuppress(msg, SUPPRESS_LOG_PATTERNS)) return;
  originalConsoleLog(...args);
};

console.warn = (...args) => {
  const msg = args.length > 0 ? String(args[0]) : '';
  if (shouldSuppress(msg, SUPPRESS_WARN_PATTERNS)) return;
  originalConsoleWarn(...args);
};

// console.error is NOT suppressed — test failures and real errors should
// always be visible. (We keep the reference for symmetry / future use.)

// Restore the original console methods after all tests in the suite finish.
// Jest runs setup.js once per test file, so this afterAll fires per file.
afterAll(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});
