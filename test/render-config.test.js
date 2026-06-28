/**
 * render-config.test.js — verifies the render.yaml sanitization (audit finding F-01).
 *
 * F-01 fix: the previous version of render.yaml committed the production DATABASE_URL
 * (including password) in plaintext. The fix uses Render's `fromDatabase` binding and
 * removes the hardcoded connection string. This test guards against regressions.
 *
 * We deliberately avoid pulling in `js-yaml` as a devDependency (per the task's
 * "don't install new test dependencies unless necessary" rule) and instead assert
 * against the raw text — render.yaml is a small, stable file where targeted
 * substring/regex checks are sufficient and readable.
 *
 * Run via: node --test test/render-config.test.js
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RENDER_YAML_PATH = path.join(__dirname, '..', 'render.yaml');

describe('render.yaml sanitization (F-01 fix)', () => {
  let yamlText;
  let yamlTextNoComments;

  before(() => {
    assert.ok(fs.existsSync(RENDER_YAML_PATH), 'render.yaml must exist at repo root');
    yamlText = fs.readFileSync(RENDER_YAML_PATH, 'utf8');
    // Strip comments for the structural assertions — render.yaml uses inline `#`
    // comments that mention the OLD (pre-fix) values (e.g. "# was generateValue: true"),
    // which would false-positive on substring checks if not stripped.
    yamlTextNoComments = yamlText
      .split('\n')
      .map(line => {
        // Naive comment stripping: cut at first `#` outside of quotes. render.yaml
        // has no quoted strings containing `#`, so simple split is fine here.
        const hashIdx = line.indexOf('#');
        return hashIdx >= 0 ? line.slice(0, hashIdx) : line;
      })
      .join('\n');
  });

  /**
   * Extract the value block for an env var by key name. The block is everything
   * from the line after `- key: NAME` up to (but not including) the next
   * `- key:` line OR the `databases:` section OR end of file.
   */
  function getEnvVarBlock(name) {
    const re = new RegExp(
      `- key:\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n\\s*-\\s*key:|\\ndatabases:|$)`
    );
    const m = yamlTextNoComments.match(re);
    return m ? m[1] : null;
  }

  // ---------------------------------------------------------------
  // Negative tests: the leak must NOT be present anywhere in the file
  // ---------------------------------------------------------------
  test('does NOT contain the leaked connection string "postgresql://"', () => {
    assert.ok(
      !/postgresql:\/\//i.test(yamlTextNoComments),
      'render.yaml must not contain a hardcoded postgresql:// connection string (F-01 regression)'
    );
  });

  test('does NOT contain the leaked password "hpoQMR70"', () => {
    assert.ok(
      !yamlTextNoComments.includes('hpoQMR70'),
      'render.yaml must not contain the leaked database password (F-01 regression)'
    );
  });

  test('does NOT contain any obviously-hardcoded password patterns', () => {
    // Heuristic: no `value: postgres://...` patterns
    assert.ok(
      !/value:\s*["']?postgres:/i.test(yamlTextNoComments),
      'render.yaml must not have a hardcoded Postgres URL in a value: field'
    );
    // No value: lines that look like connection strings user:pass@host
    assert.ok(
      !/value:\s*["']?[a-zA-Z0-9_]+:[^@\s]+@/i.test(yamlTextNoComments),
      'render.yaml must not have any hardcoded user:pass@host connection strings'
    );
  });

  // ---------------------------------------------------------------
  // Positive tests: the sanitization fixes are present
  // ---------------------------------------------------------------
  test('DATABASE_URL uses fromDatabase binding, not value:', () => {
    const block = getEnvVarBlock('DATABASE_URL');
    assert.ok(block, 'DATABASE_URL env var block must be defined');
    assert.ok(
      /fromDatabase:/.test(block),
      'DATABASE_URL must use fromDatabase binding (not a hardcoded value:)'
    );
    assert.ok(
      !/^\s*value:\s*\S/m.test(block),
      'DATABASE_URL block must NOT contain a value: field (would leak the connection string)'
    );
    assert.ok(
      /name:\s*\S+/.test(block),
      'DATABASE_URL.fromDatabase must specify a database name'
    );
    assert.ok(
      /property:\s*\S+/.test(block),
      'DATABASE_URL.fromDatabase must specify a property (e.g. connectionString)'
    );
  });

  test('healthCheckPath is /api/health (not the old /ping)', () => {
    // Match "healthCheckPath: /api/health" with possible whitespace variations
    assert.ok(
      /healthCheckPath:\s*\/api\/health\b/.test(yamlTextNoComments),
      'healthCheckPath must point to /api/health which actually probes the DB (F-02 fix)'
    );
    // Also verify it is NOT the old /ping (which always returned 200 and masked DB outages)
    assert.ok(
      !/healthCheckPath:\s*\/ping\b/.test(yamlTextNoComments),
      'healthCheckPath must NOT be /ping (the old endpoint that masked DB outages)'
    );
  });

  test('SESSION_SECRET is sync: false (not generateValue: true)', () => {
    const block = getEnvVarBlock('SESSION_SECRET');
    assert.ok(block, 'SESSION_SECRET env var block must be defined');
    assert.ok(
      /sync:\s*false/.test(block),
      'SESSION_SECRET must be sync: false so it is set once via dashboard and rotated manually'
    );
    assert.ok(
      !/generateValue:\s*true/.test(block),
      'SESSION_SECRET must NOT use generateValue: true (would invalidate all sessions on every deploy)'
    );
  });

  // ---------------------------------------------------------------
  // Cross-references: the fromDatabase name must point to a real database
  // ---------------------------------------------------------------
  test('DATABASE_URL.fromDatabase.name references a defined database', () => {
    const block = getEnvVarBlock('DATABASE_URL');
    assert.ok(block, 'DATABASE_URL env var block must be defined');
    const nameMatch = block.match(/name:\s*(\S+)/);
    assert.ok(nameMatch, 'DATABASE_URL.fromDatabase.name must be set');
    const dbName = nameMatch[1];

    // Now verify a database with that name is defined in the databases: section
    const databasesSectionMatch = yamlTextNoComments.match(
      /databases:\s*\n([\s\S]*?)$/
    );
    assert.ok(databasesSectionMatch, 'render.yaml must have a databases: section');
    const databasesSection = databasesSectionMatch[1];
    const dbNames = [];
    const re = /^\s*-\s*name:\s*(\S+)\s*$/gm;
    let m;
    while ((m = re.exec(databasesSection)) !== null) {
      dbNames.push(m[1]);
    }
    assert.ok(
      dbNames.includes(dbName),
      `DATABASE_URL.fromDatabase.name "${dbName}" must match a database defined in the databases: section (found: ${dbNames.join(', ')})`
    );
  });

  // ---------------------------------------------------------------
  // Structural sanity: services section exists with a web service
  // ---------------------------------------------------------------
  test('defines at least one web service', () => {
    assert.ok(
      /^\s*-\s*type:\s*web\s*$/m.test(yamlTextNoComments),
      'render.yaml must define at least one service of type: web'
    );
  });
});
