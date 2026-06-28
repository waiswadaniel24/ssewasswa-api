// src/routes/filters.js
//
// Saved filter preferences API (extracted from server.js as part of the
// Conservative route-extraction refactor — Track 1, Task t1).
//
// Behavior is identical to the original inline handlers in server.js.
// The module exports a factory that accepts a shared context object so the
// route handlers can close over the same `pool`, `requireAuth`, `ah`, etc.
// that the rest of server.js uses — no behavior changes, no re-definitions.
//
// Mount point in server.js:
//   app.use('/api/filters', require('./src/routes/filters')(sharedCtx));

module.exports = function createFiltersRouter(ctx) {
  const express = require('express');
  const router = express.Router();
  const { pool, requireAuth, ah } = ctx;

  // POST /api/filters/save — Save a filter combination
  router.post('/save', requireAuth, ah(async (req, res) => {
    const { name, page, filters, is_default } = req.body;
    const tenantId = req.session.user.tenant_id;
    const userId = req.session.user.id;
    if (!name || !page || !filters) return res.status(400).json({ error: 'name, page, and filters are required' });
    if (name.length > 100) return res.status(400).json({ error: 'name must be 100 characters or less' });
    if (page.length > 100) return res.status(400).json({ error: 'page must be 100 characters or less' });
    // If setting as default, clear any existing default for this page
    if (is_default) {
      await pool.query('UPDATE saved_filters SET is_default = false WHERE tenant_id = $1 AND user_id = $2 AND page = $3 AND is_default = true', [tenantId, userId, page]);
    }
    const result = await pool.query(
      'INSERT INTO saved_filters(tenant_id, user_id, name, page, filters, is_default) VALUES($1, $2, $3, $4, $5, $6) RETURNING id, name, page, filters, is_default, created_at',
      [tenantId, userId, name, page, JSON.stringify(filters), is_default || false]
    );
    res.json({ success: true, filter: result.rows[0] });
  }));

  // GET /api/filters/list?page=X — Get saved filters for current user + page
  router.get('/list', requireAuth, ah(async (req, res) => {
    const { page } = req.query;
    const tenantId = req.session.user.tenant_id;
    const userId = req.session.user.id;
    let query = 'SELECT id, name, page, filters, is_default, created_at, updated_at FROM saved_filters WHERE tenant_id = $1 AND user_id = $2';
    const params = [tenantId, userId];
    if (page) { query += ' AND page = $3'; params.push(page); }
    query += ' ORDER BY is_default DESC, created_at DESC';
    const result = await pool.query(query, params);
    res.json({ success: true, filters: result.rows });
  }));

  // POST /api/filters/apply/:id — Get a specific filter by ID
  router.post('/apply/:id', requireAuth, ah(async (req, res) => {
    const filterId = parseInt(req.params.id);
    const tenantId = req.session.user.tenant_id;
    const userId = req.session.user.id;
    const result = await pool.query('SELECT id, name, page, filters, is_default FROM saved_filters WHERE id = $1 AND tenant_id = $2 AND user_id = $3', [filterId, tenantId, userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Filter not found' });
    res.json({ success: true, filter: result.rows[0] });
  }));

  // POST /api/filters/delete/:id — Delete a saved filter
  router.post('/delete/:id', requireAuth, ah(async (req, res) => {
    const filterId = parseInt(req.params.id);
    const tenantId = req.session.user.tenant_id;
    const userId = req.session.user.id;
    const result = await pool.query('DELETE FROM saved_filters WHERE id = $1 AND tenant_id = $2 AND user_id = $3 RETURNING id', [filterId, tenantId, userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Filter not found' });
    res.json({ success: true });
  }));

  // POST /api/filters/default/:id — Set a filter as default for that page
  router.post('/default/:id', requireAuth, ah(async (req, res) => {
    const filterId = parseInt(req.params.id);
    const tenantId = req.session.user.tenant_id;
    const userId = req.session.user.id;
    // Get the filter to find its page
    const filter = await pool.query('SELECT page FROM saved_filters WHERE id = $1 AND tenant_id = $2 AND user_id = $3', [filterId, tenantId, userId]);
    if (!filter.rows.length) return res.status(404).json({ error: 'Filter not found' });
    const page = filter.rows[0].page;
    // Clear existing default
    await pool.query('UPDATE saved_filters SET is_default = false WHERE tenant_id = $1 AND user_id = $2 AND page = $3 AND is_default = true', [tenantId, userId, page]);
    // Set new default
    await pool.query('UPDATE saved_filters SET is_default = true, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 AND user_id = $3', [filterId, tenantId, userId]);
    res.json({ success: true });
  }));

  return router;
};
