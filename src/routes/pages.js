// src/routes/pages.js
// Page builder — drag-and-drop page editor backend
// Each page is a JSON array of blocks: [{ id, type, props }, ...]
// Block types: heading, paragraph, image, donation_button, spacer, divider
const express = require('express');

module.exports = function (ctx) {
  const { pool, ah, requireAuth, audit, esc } = ctx;
  const router = express.Router();

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

  // GET /api/pages — list pages for the current tenant
  router.get('/', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query(
      'SELECT id, slug, title, description, is_published, page_type, created_at, updated_at FROM pages WHERE tenant_id = $1 ORDER BY updated_at DESC',
      [tid]
    );
    res.json({ pages: result.rows });
  }));

  // GET /api/pages/:slug — get a specific page (draft view, auth required)
  router.get('/:slug', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM pages WHERE tenant_id = $1 AND slug = $2', [tid, req.params.slug]);
    if (!result.rows.length) return res.status(404).json({ error: 'Page not found' });
    res.json(result.rows[0]);
  }));

  // POST /api/pages — create a new page
  router.post('/', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { slug, title, description, blocks = [], page_type = 'custom' } = req.body;
    if (!slug || !title) return res.status(400).json({ error: 'slug and title are required' });
    if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'slug must be lowercase letters, numbers, and hyphens only' });

    const validationError = validateBlocks(blocks);
    if (validationError) return res.status(400).json({ error: validationError });

    try {
      const result = await pool.query(
        `INSERT INTO pages (tenant_id, slug, title, description, blocks, page_type)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [tid, slug, esc(title), description ? esc(description) : null, JSON.stringify(blocks), page_type]
      );
      await audit(req, 'page_create', { page_id: result.rows[0].id, slug });
      res.status(201).json(result.rows[0]);
    } catch (e) {
      if (e.message.includes('uq_pages_tenant_slug')) {
        return res.status(409).json({ error: 'A page with that slug already exists for this tenant' });
      }
      throw e;
    }
  }));

  // PUT /api/pages/:id — update page (blocks, title, etc.)
  router.put('/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const id = parseInt(req.params.id, 10);
    const { slug, title, description, blocks, page_type } = req.body;

    if (blocks) {
      const validationError = validateBlocks(blocks);
      if (validationError) return res.status(400).json({ error: validationError });
    }

    const result = await pool.query(
      `UPDATE pages SET
         slug = COALESCE($1, slug),
         title = COALESCE($2, title),
         description = COALESCE($3, description),
         blocks = COALESCE($4, blocks),
         page_type = COALESCE($5, page_type),
         updated_at = NOW()
       WHERE id = $6 AND tenant_id = $7 RETURNING *`,
      [slug, title ? esc(title) : null, description !== undefined ? esc(description) : null,
       blocks ? JSON.stringify(blocks) : null, page_type, id, tid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Page not found' });
    await audit(req, 'page_update', { page_id: id });
    res.json(result.rows[0]);
  }));

  // POST /api/pages/:id/publish
  router.post('/:id/publish', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const id = parseInt(req.params.id, 10);
    const result = await pool.query(
      `UPDATE pages SET is_published = true, published_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Page not found' });
    await audit(req, 'page_publish', { page_id: id, slug: result.rows[0].slug });
    res.json(result.rows[0]);
  }));

  // POST /api/pages/:id/unpublish
  router.post('/:id/unpublish', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const id = parseInt(req.params.id, 10);
    const result = await pool.query(
      `UPDATE pages SET is_published = false, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Page not found' });
    res.json(result.rows[0]);
  }));

  // DELETE /api/pages/:id
  router.delete('/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const id = parseInt(req.params.id, 10);
    const result = await pool.query('DELETE FROM pages WHERE id = $1 AND tenant_id = $2 RETURNING id', [id, tid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Page not found' });
    await audit(req, 'page_delete', { page_id: id });
    res.json({ message: 'Page deleted', id });
  }));

  return router;
};
