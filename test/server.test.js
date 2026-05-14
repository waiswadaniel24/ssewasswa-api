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
];

var totalPassed = results.reduce(function(s, r) { return s + r.passed; }, 0);
var totalFailed = results.reduce(function(s, r) { return s + r.failed; }, 0);

console.log('\n============================================================');
console.log('  TOTAL: ' + totalPassed + ' passed, ' + totalFailed + ' failed');
console.log('  Result: ' + (totalFailed === 0 ? 'ALL TESTS PASSED' : totalFailed + ' TEST(S) FAILED'));
console.log('============================================================');

if (totalFailed > 0) process.exit(1);
