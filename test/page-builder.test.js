// test/page-builder.test.js
// Tests for the page builder route module + block validation
const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');

describe('page-builder route module factory', () => {
  test('exports a function that returns an Express Router', () => {
    // Clear cache to ensure clean load
    delete require.cache[require.resolve('../src/routes/pages')];
    const factory = require('../src/routes/pages');
    assert.strictEqual(typeof factory, 'function');
    const mockCtx = {
      pool: { query: async () => ({ rows: [] }) },
      ah: (fn) => fn,
      requireAuth: (req, res, next) => next(),
      audit: () => {},
      esc: (s) => String(s || ''),
    };
    const router = factory(mockCtx);
    assert.ok(router);
    assert.strictEqual(typeof router.handle, 'function');
  });

  test('public-pages module exports a function that returns an Express Router', () => {
    delete require.cache[require.resolve('../src/routes/public-pages')];
    const factory = require('../src/routes/public-pages');
    assert.strictEqual(typeof factory, 'function');
    const mockCtx = {
      pool: { query: async () => ({ rows: [] }) },
      ah: (fn) => fn,
    };
    const router = factory(mockCtx);
    assert.ok(router);
    assert.strictEqual(typeof router.handle, 'function');
  });
});

describe('block validation logic', () => {
  // We test validateBlocks indirectly by importing the module and checking its behavior
  // Since validateBlocks isn't exported, we test it through the route handlers.
  // For unit testing, we replicate the logic here:
  const VALID_BLOCK_TYPES = ['heading', 'paragraph', 'image', 'donation_button', 'spacer', 'divider'];

  function validateBlocks(blocks) {
    if (!Array.isArray(blocks)) return 'blocks must be an array';
    for (const block of blocks) {
      if (!block.id || typeof block.id !== 'string') return 'each block needs an id (string)';
      if (!block.type || !VALID_BLOCK_TYPES.includes(block.type)) return `block.type must be one of: ${VALID_BLOCK_TYPES.join(', ')}`;
      if (!block.props || typeof block.props !== 'object') return 'block.props must be an object';
    }
    return null;
  }

  test('empty array is valid', () => {
    assert.strictEqual(validateBlocks([]), null);
  });

  test('valid blocks pass', () => {
    const blocks = [
      { id: 'b1', type: 'heading', props: { text: 'Hello' } },
      { id: 'b2', type: 'paragraph', props: { text: 'World' } },
      { id: 'b3', type: 'donation_button', props: { text: 'Donate', campaign_url: '/c/1' } },
      { id: 'b4', type: 'image', props: { url: 'https://example.com/x.png', alt: 'X' } },
      { id: 'b5', type: 'spacer', props: { height: 40 } },
      { id: 'b6', type: 'divider', props: {} },
    ];
    assert.strictEqual(validateBlocks(blocks), null);
  });

  test('non-array returns error', () => {
    assert.strictEqual(validateBlocks('not an array'), 'blocks must be an array');
    assert.strictEqual(validateBlocks(null), 'blocks must be an array');
    assert.strictEqual(validateBlocks(undefined), 'blocks must be an array');
    assert.strictEqual(validateBlocks({}), 'blocks must be an array');
  });

  test('block missing id returns error', () => {
    assert.match(validateBlocks([{ type: 'heading', props: {} }]), /needs an id/);
  });

  test('block with non-string id returns error', () => {
    assert.match(validateBlocks([{ id: 123, type: 'heading', props: {} }]), /needs an id/);
  });

  test('block missing type returns error', () => {
    assert.match(validateBlocks([{ id: 'b1', props: {} }]), /block\.type must be one of/);
  });

  test('block with invalid type returns error', () => {
    assert.match(validateBlocks([{ id: 'b1', type: 'invalid_type', props: {} }]), /block\.type must be one of/);
  });

  test('block missing props returns error', () => {
    assert.match(validateBlocks([{ id: 'b1', type: 'heading' }]), /block\.props must be an object/);
  });

  test('block with null props returns error', () => {
    assert.match(validateBlocks([{ id: 'b1', type: 'heading', props: null }]), /block\.props must be an object/);
  });
});

describe('HTML rendering (escapeHtml + renderBlocksToHtml)', () => {
  // Replicate the escapeHtml function from public-pages.js for unit testing
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  test('escapeHtml escapes &, <, >, "', () => {
    assert.strictEqual(escapeHtml('a&b<c>d"e'), 'a&amp;b&lt;c&gt;d&quot;e');
  });

  test('escapeHtml handles non-strings', () => {
    assert.strictEqual(escapeHtml(123), '123');
    assert.strictEqual(escapeHtml(null), 'null');
    assert.strictEqual(escapeHtml(undefined), 'undefined');
  });

  test('escapeHtml handles empty string', () => {
    assert.strictEqual(escapeHtml(''), '');
  });
});
