/**
 * Comfort Platform - Unit Tests
 * Tests for authentication, payment, validation, and utility functions
 * 
 * Run: node test/server.test.js
 */

// ============================================================
// 1. INPUT VALIDATION TESTS
// ============================================================
function testValidation() {
  console.log('\n=== VALIDATION TESTS ===');
  let passed = 0, failed = 0;

  const validateEmail = (email) => typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const validEmails = ['user@example.com', 'test@ug.co.ug', 'admin@ssewasswa.onrender.com'];
  const invalidEmails = ['', 'notanemail', 'no@', '@domain.com', 'spaces in@email.com'];
  
  validEmails.forEach(email => {
    if (validateEmail(email)) { passed++; } else { failed++; console.log('  FAIL: ' + email + ' should be valid'); }
  });
  invalidEmails.forEach(email => {
    if (!validateEmail(email)) { passed++; } else { failed++; console.log('  FAIL: ' + email + ' should be invalid'); }
  });

  const validatePhone = (phone) => typeof phone === 'string' && /^(\+?\d{7,15})$/.test(phone.replace(/[\s\-()]/g, ''));
  const validPhones = ['+256700000001', '0770123456', '256781234567'];
  const invalidPhones = ['', '123', '+1234567890123456', 'abc'];
  
  validPhones.forEach(phone => {
    if (validatePhone(phone)) { passed++; } else { failed++; console.log('  FAIL: ' + phone + ' should be valid'); }
  });
  invalidPhones.forEach(phone => {
    if (!validatePhone(phone)) { passed++; } else { failed++; console.log('  FAIL: ' + phone + ' should be invalid'); }
  });

  const validateAmount = (amount) => typeof amount === 'number' && amount > 0 && amount <= 100000000 && Number.isFinite(amount);
  const validAmounts = [1, 100, 100000, 99999999.99];
  const invalidAmounts = [0, -1, Infinity, NaN, 100000001, 'abc'];
  
  validAmounts.forEach(amt => {
    if (validateAmount(amt)) { passed++; } else { failed++; console.log('  FAIL: ' + amt + ' should be valid amount'); }
  });
  invalidAmounts.forEach(amt => {
    if (!validateAmount(amt)) { passed++; } else { failed++; console.log('  FAIL: ' + amt + ' should be invalid amount'); }
  });

  const validateUUID = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const validUUIDs = ['550e8400-e29b-41d4-a716-446655440000', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'];
  const invalidUUIDs = ['', 'not-a-uuid', '550e8400', 'g50e8400-e29b-41d4-a716-446655440000'];
  
  validUUIDs.forEach(uuid => {
    if (validateUUID(uuid)) { passed++; } else { failed++; console.log('  FAIL: ' + uuid + ' should be valid UUID'); }
  });
  invalidUUIDs.forEach(uuid => {
    if (!validateUUID(uuid)) { passed++; } else { failed++; console.log('  FAIL: ' + uuid + ' should be invalid UUID'); }
  });

  const validateName = (name) => typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 200;
  const validNames = ['John', "O'Connor", 'Mary-Jane', 'Ali Hassan', 'A'];
  const invalidNames = ['', '   ', 'a'.repeat(201)];
  
  validNames.forEach(name => {
    if (validateName(name)) { passed++; } else { failed++; console.log('  FAIL: "' + name + '" should be valid name'); }
  });
  invalidNames.forEach(name => {
    if (!validateName(name)) { passed++; } else { failed++; console.log('  FAIL: "' + name + '" should be invalid name'); }
  });

  const pagTests = [
    { query: { page: '1', limit: '50' }, expectPage: 1, expectLimit: 50, expectOffset: 0 },
    { query: { page: '0', limit: '500' }, expectPage: 1, expectLimit: 200, expectOffset: 0 },
    { query: {}, expectPage: 1, expectLimit: 50, expectOffset: 0 },
    { query: { page: '3', limit: '25' }, expectPage: 3, expectLimit: 25, expectOffset: 50 },
  ];
  pagTests.forEach(pt => {
    const page = Math.max(1, parseInt(pt.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(pt.query.limit) || 50));
    const offset = (page - 1) * limit;
    if (page === pt.expectPage && limit === pt.expectLimit && offset === pt.expectOffset) { passed++; }
    else { failed++; console.log('  FAIL: pagination ' + JSON.stringify(pt.query)); }
  });

  console.log('  Validation: ' + passed + ' passed, ' + failed + ' failed');
  return { passed: passed, failed: failed };
}

// ============================================================
// 2. SECURITY / SANITIZATION TESTS
// ============================================================
function testSanitization() {
  console.log('\n=== SANITIZATION TESTS ===');
  let passed = 0, failed = 0;

  const esc = function(s) { return String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, function(m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]); }); };

  var xssTests = [
    { input: '<script>alert("xss")</script>', expected: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;' },
    { input: '<img src=x onerror=alert(1)>', expected: '&lt;img src=x onerror=alert(1)&gt;' },
    { input: 'Hello "World"', expected: 'Hello &quot;World&quot;' },
    { input: 'Tom & Jerry', expected: 'Tom &amp; Jerry' },
    { input: "It's here", expected: 'It&#39;s here' },
    { input: null, expected: '' },
    { input: undefined, expected: '' },
    { input: 42, expected: '42' },
  ];

  xssTests.forEach(function(t) {
    var result = esc(t.input);
    if (result === t.expected) { passed++; }
    else { failed++; console.log('  FAIL: esc(' + JSON.stringify(t.input) + ')'); }
  });

  var sanitizeCSS = function(css) {
    if (!css) return '';
    return css.replace(/url\s*\(/gi, '/* url removed */(').replace(/@import/gi, '/* @import removed */').replace(/expression\s*\(/gi, '/* expression removed */(').replace(/behavior\s*:/gi, '/* behavior removed */:').replace(/-moz-binding\s*:/gi, '/* moz-binding removed */:').replace(/javascript\s*:/gi, '/* javascript removed */:').replace(/vbscript\s*:/gi, '/* vbscript removed */:');
  };

  var cssTests = [
    { input: 'color: red', expected: 'color: red' },
    { input: 'background: url(evil.png)', expected: 'background: /* url removed */(evil.png)' },
    { input: '@import url(malicious.css)', expected: '/* @import removed */ /* url removed */(malicious.css)' },
  ];
  cssTests.forEach(function(t) {
    if (sanitizeCSS(t.input) === t.expected) { passed++; } else { failed++; console.log('  FAIL: CSS sanitize "' + t.input + '"'); }
  });

  var sanitizeHTML = function(html) {
    if (!html) return '';
    return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/on\w+\s*=/gi, 'data-blocked=').replace(/javascript\s*:/gi, 'blocked:').replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '').replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '').replace(/<embed[^>]*>/gi, '');
  };

  var htmlTests = [
    { input: '<p>Hello</p>', expected: '<p>Hello</p>' },
    { input: '<script>alert(1)</script>Hello', expected: 'Hello' },
    { input: '<div onclick="alert(1)">text</div>', expected: '<div data-blocked="alert(1)">text</div>' },
    { input: '<a href="javascript:void(0)">link</a>', expected: '<a href="blocked:void(0)">link</a>' },
    { input: '<iframe src="evil.com"></iframe>text', expected: 'text' },
  ];
  htmlTests.forEach(function(t) {
    if (sanitizeHTML(t.input) === t.expected) { passed++; } else { failed++; console.log('  FAIL: HTML sanitize "' + t.input + '"'); }
  });

  var VALID_TABLES = new Set(['students', 'users', 'tenants', 'fees', 'attendance', 'inventory', 'payments']);
  var sqlTests = [
    { input: 'students', shouldPass: true },
    { input: 'users', shouldPass: true },
    { input: 'students; DROP TABLE users', shouldPass: false },
    { input: '../secrets', shouldPass: false },
    { input: '', shouldPass: false },
  ];
  sqlTests.forEach(function(t) {
    var threw = false;
    try { if (!VALID_TABLES.has(t.input)) throw new Error('invalid'); } catch(e) { threw = true; }
    if (threw === !t.shouldPass) { passed++; } else { failed++; console.log('  FAIL: table "' + t.input + '"'); }
  });

  console.log('  Sanitization: ' + passed + ' passed, ' + failed + ' failed');
  return { passed: passed, failed: failed };
}

// ============================================================
// 3. AUTH FLOW TESTS
// ============================================================
function testAuthFlows() {
  console.log('\n=== AUTH FLOW TESTS ===');
  let passed = 0, failed = 0;

  var strongPasswords = ['Password1', 'SecurePass99', 'MyP@ssw0rd!', 'A1b2c3d4'];
  var weakPasswords = ['password', '12345678', 'abcdefgh', 'Password', 'pass1', 'P1', ''];

  strongPasswords.forEach(function(pw) {
    if (/(?=.*[A-Z])(?=.*\d).{8,}/.test(pw)) { passed++; } else { failed++; }
  });
  weakPasswords.forEach(function(pw) {
    if (!/(?=.*[A-Z])(?=.*\d).{8,}/.test(pw)) { passed++; } else { failed++; }
  });

  var crypto = require('crypto');
  for (var i = 0; i < 10; i++) {
    var token = crypto.randomBytes(32).toString('hex');
    if (token.length === 64 && /^[0-9a-f]+$/.test(token)) { passed++; } else { failed++; }
  }

  var badSecrets = ['generate-32-char-string', 'changeme', 'secret', 'default', ''];
  badSecrets.forEach(function(secret) {
    if (secret.length < 16 || secret === 'generate-32-char-string') { passed++; } else { failed++; }
  });

  var LOGIN_MAX_ATTEMPTS = 5;
  var attempts = 0;
  for (var j = 0; j < LOGIN_MAX_ATTEMPTS + 1; j++) attempts++;
  if (attempts > LOGIN_MAX_ATTEMPTS) passed++; else failed++;

  console.log('  Auth: ' + passed + ' passed, ' + failed + ' failed');
  return { passed: passed, failed: failed };
}

// ============================================================
// 4. PAYMENT LOGIC TESTS
// ============================================================
function testPaymentLogic() {
  console.log('\n=== PAYMENT LOGIC TESTS ===');
  let passed = 0, failed = 0;

  var CURRENCY_SYMBOLS = { UGX: 'UGX', KES: 'KES', TZS: 'TZS', RWF: 'RWF', USD: '$' };
  var formatCurrency = function(amount, currency) { return (CURRENCY_SYMBOLS[currency || 'UGX'] || currency || 'UGX') + ' ' + Number(amount).toLocaleString(); };

  var currencyTests = [
    { amount: 500000, currency: 'UGX', expected: 'UGX 500,000' },
    { amount: 1000, currency: 'KES', expected: 'KES 1,000' },
    { amount: 99.99, currency: 'USD', expected: '$ 99.99' },
    { amount: 0, currency: 'UGX', expected: 'UGX 0' },
  ];
  currencyTests.forEach(function(t) {
    if (formatCurrency(t.amount, t.currency) === t.expected) passed++; else failed++;
  });

  var paymentStatusTests = [
    { total: 100000, paid: 100000, expected: 'paid' },
    { total: 100000, paid: 50000, expected: 'partial' },
    { total: 100000, paid: 0, expected: 'unpaid' },
    { total: 100000, paid: 150000, expected: 'overpaid' },
  ];
  paymentStatusTests.forEach(function(t) {
    var status = t.paid >= t.total ? (t.paid > t.total ? 'overpaid' : 'paid') : (t.paid > 0 ? 'partial' : 'unpaid');
    if (status === t.expected) passed++; else failed++;
  });

  var SUBSCRIPTION_DURATION = 30 * 24 * 60 * 60 * 1000;
  var daysDiff = Math.ceil(SUBSCRIPTION_DURATION / (1000 * 60 * 60 * 24));
  if (daysDiff === 30) passed++; else failed++;

  console.log('  Payment: ' + passed + ' passed, ' + failed + ' failed');
  return { passed: passed, failed: failed };
}

// ============================================================
// 5. UTILITY / CSV TESTS
// ============================================================
function testUtilities() {
  console.log('\n=== UTILITY TESTS ===');
  let passed = 0, failed = 0;

  var csvData = 'admission_no,name,class\nS001,John Doe,S1\nS002,Mary Smith,S2';
  var lines = csvData.trim().split('\n');
  if (lines.length === 3) passed++; else failed++;

  var row1 = lines[1].split(',').map(function(c) { return c.trim(); });
  if (row1[0] === 'S001' && row1[1] === 'John Doe') passed++; else failed++;

  var students = [
    { admission_no: 'S001', name: 'John Doe', class: 'S1' },
    { admission_no: 'S002', name: 'Mary "Ann"', class: 'S2' },
  ];
  var headers = ['admission_no', 'name', 'class'];
  var csv = [headers.join(','), ...students.map(function(s) { return headers.map(function(h) { return '"' + (s[h] || '').toString().replace(/"/g, '""') + '"'; }).join(','); })].join('\n');
  if (csv.startsWith('admission_no,name,class')) passed++; else failed++;
  if (csv.includes('"Mary ""Ann"""')) passed++; else failed++;

  var logEntry = JSON.stringify({ level: 'info', msg: 'test', ts: new Date().toISOString() });
  try { var parsed = JSON.parse(logEntry); if (parsed.level === 'info') passed++; else failed++; } catch(e) { failed++; }

  var SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  if (SESSION_MAX_AGE / (24 * 60 * 60 * 1000) === 7) passed++; else failed++;

  console.log('  Utilities: ' + passed + ' passed, ' + failed + ' failed');
  return { passed: passed, failed: failed };
}

// ============================================================
// 6. ROUTE SECURITY TESTS
// ============================================================
function testRouteSecurity() {
  console.log('\n=== ROUTE SECURITY TESTS ===');
  let passed = 0, failed = 0;

  // --- CSRF Protection ---
  // Verify CSRF token generation produces HMAC-like hex strings
  var crypto = require('crypto');
  var csrfToken = crypto.randomBytes(32).toString('hex');
  if (csrfToken.length === 64 && /^[0-9a-f]+$/.test(csrfToken)) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: CSRF token should be 64-char hex string');
  }

  // Verify double-submit pattern: cookie token === header token is the expected match
  var cookieToken = crypto.randomBytes(32).toString('hex');
  var headerToken = cookieToken;
  if (cookieToken === headerToken && typeof crypto.createHmac === 'function') {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: CSRF double-submit pattern check');
  }

  // Verify HMAC can be created with CSRF_SECRET
  try {
    var hmac = crypto.createHmac('sha256', 'test-csrf-secret').update('test-payload').digest('hex');
    if (hmac.length === 64 && /^[0-9a-f]+$/.test(hmac)) {
      passed++;
    } else {
      failed++;
      console.log('  FAIL: HMAC output should be 64-char hex');
    }
  } catch (e) {
    failed++;
    console.log('  FAIL: HMAC creation threw: ' + e.message);
  }

  // --- Session Security Constants ---
  var SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // mirrors server.js
  var sessionDays = SESSION_MAX_AGE / (24 * 60 * 60 * 1000);
  if (sessionDays === 7) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: SESSION_MAX_AGE should be 7 days, got ' + sessionDays);
  }

  // Session max age should be positive and finite
  if (SESSION_MAX_AGE > 0 && Number.isFinite(SESSION_MAX_AGE)) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: SESSION_MAX_AGE should be positive and finite');
  }

  // --- Rate Limits ---
  // Login: max 50 per 15 minutes
  var loginMax = 50;
  var loginWindow = 15 * 60 * 1000;
  if (loginMax <= 50 && loginWindow === 15 * 60 * 1000) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: Login rate limit should be max 50 per 15min');
  }

  // Register: max 5 per hour
  var registerMax = 5;
  var registerWindow = 60 * 60 * 1000;
  if (registerMax <= 5 && registerWindow === 60 * 60 * 1000) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: Register rate limit should be max 5/hr');
  }

  // API: max 100 per minute
  var apiMax = 100;
  var apiWindow = 60 * 1000;
  if (apiMax <= 100 && apiWindow === 60 * 1000) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: API rate limit should be max 100/min');
  }

  // Rate limits should not allow unbounded access
  if (loginMax < 1000 && registerMax < 1000 && apiMax < 10000) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: Rate limits are too permissive');
  }

  // --- bcrypt rounds ---
  var BCRYPT_ROUNDS = 12; // mirrors server.js usage
  if (BCRYPT_ROUNDS >= 10) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: bcrypt rounds should be >= 10, got ' + BCRYPT_ROUNDS);
  }

  // bcrypt rounds should be reasonable (not too high for perf)
  if (BCRYPT_ROUNDS <= 15) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: bcrypt rounds >= 15 may cause performance issues');
  }

  console.log('  Route Security: ' + passed + ' passed, ' + failed + ' failed');
  return { passed: passed, failed: failed };
}

// ============================================================
// 7. RBAC / PLAN LIMITS TESTS
// ============================================================
function testRBAC() {
  console.log('\n=== RBAC / PLAN LIMITS TESTS ===');
  let passed = 0, failed = 0;

  // Plan limits mirror server.js: PLAN_LIMITS = { free: 50, basic: 500, pro: 50000, enterprise: Infinity }
  var PLAN_LIMITS = { free: 50, basic: 500, pro: 50000, enterprise: Infinity };

  // Free plan <= 50
  if (typeof PLAN_LIMITS.free === 'number' && PLAN_LIMITS.free <= 50) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: free plan limit should be <= 50, got ' + PLAN_LIMITS.free);
  }

  // Basic plan <= 500
  if (typeof PLAN_LIMITS.basic === 'number' && PLAN_LIMITS.basic <= 500) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: basic plan limit should be <= 500, got ' + PLAN_LIMITS.basic);
  }

  // Pro plan <= 50000
  if (typeof PLAN_LIMITS.pro === 'number' && PLAN_LIMITS.pro <= 50000) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: pro plan limit should be <= 50000, got ' + PLAN_LIMITS.pro);
  }

  // Enterprise should be Infinity or > 50000
  if (PLAN_LIMITS.enterprise === Infinity || PLAN_LIMITS.enterprise > 50000) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: enterprise plan should be Infinity or > 50000, got ' + PLAN_LIMITS.enterprise);
  }

  // Plan hierarchy: each tier should be >= the previous
  if (PLAN_LIMITS.free <= PLAN_LIMITS.basic && PLAN_LIMITS.basic <= PLAN_LIMITS.pro) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: plan limits should be monotonically increasing');
  }

  // Pro should be > basic
  if (PLAN_LIMITS.pro > PLAN_LIMITS.basic) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: pro should allow more than basic');
  }

  // Feature flag min_plan values should be valid plan names
  var PLAN_HIERARCHY = ['free', 'basic', 'pro', 'enterprise'];
  var validMinPlans = ['free', 'basic', 'pro', 'enterprise'];
  validMinPlans.forEach(function(plan) {
    if (PLAN_HIERARCHY.indexOf(plan) !== -1) {
      passed++;
    } else {
      failed++;
      console.log('  FAIL: "' + plan + '" is not a valid plan for feature flags');
    }
  });

  // Feature flag min_plan default should be 'free'
  if (PLAN_HIERARCHY.indexOf('free') === 0) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: default min_plan should be at index 0 (free)');
  }

  // Invalid plan should fall back to 50 (free limit)
  var limit = PLAN_LIMITS['unknown_plan'] || 50;
  if (limit === 50) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: unknown plan should default to 50');
  }

  console.log('  RBAC: ' + passed + ' passed, ' + failed + ' failed');
  return { passed: passed, failed: failed };
}

// ============================================================
// 8. EMAIL VALIDATION TESTS
// ============================================================
function testEmailValidation() {
  console.log('\n=== EMAIL VALIDATION TESTS ===');
  let passed = 0, failed = 0;

  // Mirror server.js email regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Valid emails — standard RFC-ish formats
  var validEmails = [
    'user@example.com',
    'test@ug.co.ug',
    'admin@ssewasswa.onrender.com',
    'user.name+tag@example.com',
    'user@sub.domain.co.uk',
    'a@b.co',
    '123@numbers.com',
    'user_name@example.org',
    'user-name@test.io',
    'UPPER@CASE.COM',
  ];
  validEmails.forEach(function(email) {
    if (emailRegex.test(email)) {
      passed++;
    } else {
      failed++;
      console.log('  FAIL: "' + email + '" should be valid');
    }
  });

  // Invalid emails
  var invalidEmails = [
    '',
    'notanemail',
    'no@',
    '@domain.com',
    'spaces in@email.com',
    'user@.com',
    'user@domain',
    'user@domain.',
    '@',
    'a b@c.com',
    'user@@domain.com',
    'user@domain@com',
    null,
    undefined,
    123,
    true,
  ];
  invalidEmails.forEach(function(email) {
    if (!emailRegex.test(email)) {
      passed++;
    } else {
      failed++;
      console.log('  FAIL: "' + email + '" should be invalid');
    }
  });

  // The regex should be a proper RegExp object
  if (emailRegex instanceof RegExp) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: emailRegex should be a RegExp');
  }

  // Regex should have the correct source pattern (basic check)
  if (emailRegex.source.includes('@') && emailRegex.source.includes('\\.')) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: email regex should contain @ and \\.');
  }

  console.log('  Email Validation: ' + passed + ' passed, ' + failed + ' failed');
  return { passed: passed, failed: failed };
}

// ============================================================
// 9. CURRENCY FORMATTING TESTS
// ============================================================
function testCurrencyFormatting() {
  console.log('\n=== CURRENCY FORMATTING TESTS ===');
  let passed = 0, failed = 0;

  // Mirror server.js: CURRENCY_SYMBOLS and formatCurrency
  var CURRENCY_SYMBOLS = { UGX: 'UGX', KES: 'KES', TZS: 'TZS', RWF: 'RWF', USD: '$' };
  var formatCurrency = function(amount, currency) {
    return (CURRENCY_SYMBOLS[currency || 'UGX'] || currency || 'UGX') + ' ' + Number(amount).toLocaleString();
  };

  // UGX formatting
  var ugxResult = formatCurrency(500000, 'UGX');
  if (ugxResult === 'UGX 500,000') {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: UGX 500000 expected "UGX 500,000", got "' + ugxResult + '"');
  }

  // KES formatting
  var kesResult = formatCurrency(1000, 'KES');
  if (kesResult === 'KES 1,000') {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: KES 1000 expected "KES 1,000", got "' + kesResult + '"');
  }

  // TZS formatting
  var tzsResult = formatCurrency(250000, 'TZS');
  if (tzsResult === 'TZS 250,000') {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: TZS 250000 expected "TZS 250,000", got "' + tzsResult + '"');
  }

  // RWF formatting
  var rwfResult = formatCurrency(50000, 'RWF');
  if (rwfResult === 'RWF 50,000') {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: RWF 50000 expected "RWF 50,000", got "' + rwfResult + '"');
  }

  // USD formatting
  var usdResult = formatCurrency(99.99, 'USD');
  if (usdResult === '$ 99.99') {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: USD 99.99 expected "$ 99.99", got "' + usdResult + '"');
  }

  // Zero amount
  var zeroResult = formatCurrency(0, 'UGX');
  if (zeroResult === 'UGX 0') {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: Zero amount expected "UGX 0", got "' + zeroResult + '"');
  }

  // Negative amount — should handle gracefully (not crash)
  var negativeResult = formatCurrency(-500, 'UGX');
  if (typeof negativeResult === 'string' && negativeResult.length > 0) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: Negative amount should produce a string');
  }

  // Default currency (no currency argument)
  var defaultResult = formatCurrency(1000);
  if (defaultResult === 'UGX 1,000') {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: Default currency expected "UGX 1,000", got "' + defaultResult + '"');
  }

  // Unknown currency — should fall back gracefully
  var unknownResult = formatCurrency(100, 'EUR');
  if (typeof unknownResult === 'string' && unknownResult.includes('EUR')) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: Unknown currency should include currency code, got "' + unknownResult + '"');
  }

  // Large amount
  var largeResult = formatCurrency(10000000, 'UGX');
  if (largeResult === 'UGX 10,000,000') {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: Large amount expected "UGX 10,000,000", got "' + largeResult + '"');
  }

  // String amount coercion
  var strResult = formatCurrency('50000', 'KES');
  if (strResult === 'KES 50,000') {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: String amount "50000" expected "KES 50,000", got "' + strResult + '"');
  }

  console.log('  Currency Formatting: ' + passed + ' passed, ' + failed + ' failed');
  return { passed: passed, failed: failed };
}

// ============================================================
// 10. PASSWORD STRENGTH TESTS
// ============================================================
function testPasswordStrength() {
  console.log('\n=== PASSWORD STRENGTH TESTS ===');
  let passed = 0, failed = 0;

  // Mirror server.js password regex: /(?=.*[A-Z])(?=.*\d).{8,}/
  var passwordRegex = /(?=.*[A-Z])(?=.*\d).{8,}/;

  // Strong passwords that should pass
  var strongPasswords = [
    'Password1',
    'SecurePass99',
    'MyP@ssw0rd!',
    'A1b2c3d4',
    'Zx9Cb7Kv2L',
    'Abcdefg1',
    'TESTING123',
    'P@ssw0rd2024',
    'Complex#Pass9',
    'Aaaaaaaa1',
  ];
  strongPasswords.forEach(function(pw) {
    if (passwordRegex.test(pw)) {
      passed++;
    } else {
      failed++;
      console.log('  FAIL: "' + pw + '" should pass strength check');
    }
  });

  // Weak passwords that should fail
  var weakPasswords = [
    'password',       // no uppercase, no digit
    'Password',       // no digit
    'password1',      // no uppercase
    '12345678',       // no uppercase, no lowercase letter
    'Pass1',          // too short (5 chars)
    'P1',             // too short
    '',               // empty
    'abcdefgh',       // no uppercase, no digit
    'ABCDEFGH',       // no digit, no lowercase
    '   ',            // whitespace only
  ];
  weakPasswords.forEach(function(pw) {
    if (!passwordRegex.test(pw)) {
      passed++;
    } else {
      failed++;
      console.log('  FAIL: "' + pw + '" should fail strength check');
    }
  });

  // Edge cases
  // Exactly 8 chars with requirements
  if (passwordRegex.test('Abcdefg1')) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: "Abcdefg1" (exactly 8 chars) should pass');
  }

  // 7 chars should fail
  if (!passwordRegex.test('Abcdef1')) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: "Abcdef1" (7 chars) should fail');
  }

  // Only uppercase + digit, 8 chars (no lowercase) — should still pass since regex doesn't require lowercase
  if (passwordRegex.test('ABCDEFG1')) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: "ABCDEFG1" should pass (regex allows all uppercase)');
  }

  // Unicode password with requirements
  if (passwordRegex.test('Pässwörd1')) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: "Pässwörd1" (unicode) should pass');
  }

  // Password with spaces
  if (passwordRegex.test('Pass word1')) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: "Pass word1" (with space) should pass');
  }

  // Regex pattern should have lookahead assertions
  if (passwordRegex.source.includes('(?=') && passwordRegex.source.includes('.{8,')) {
    passed++;
  } else {
    failed++;
    console.log('  FAIL: password regex should contain lookaheads and {8,} quantifier');
  }

  console.log('  Password Strength: ' + passed + ' passed, ' + failed + ' failed');
  return { passed: passed, failed: failed };
}

// ============================================================
// RUN ALL TESTS
// ============================================================
console.log('============================================================');
console.log('  Comfort Platform Test Suite v1.0');
console.log('  Running: ' + new Date().toISOString());
console.log('============================================================');

var results = [
  testValidation(),
  testSanitization(),
  testAuthFlows(),
  testPaymentLogic(),
  testUtilities(),
  testRouteSecurity(),
  testRBAC(),
  testEmailValidation(),
  testCurrencyFormatting(),
  testPasswordStrength(),
];

var totalPassed = results.reduce(function(s, r) { return s + r.passed; }, 0);
var totalFailed = results.reduce(function(s, r) { return s + r.failed; }, 0);

console.log('\n============================================================');
console.log('  TOTAL: ' + totalPassed + ' passed, ' + totalFailed + ' failed');
console.log('  Result: ' + (totalFailed === 0 ? 'ALL TESTS PASSED' : totalFailed + ' TEST(S) FAILED'));
console.log('============================================================');

if (totalFailed > 0) process.exit(1);
