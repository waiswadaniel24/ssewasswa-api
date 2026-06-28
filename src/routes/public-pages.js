// src/routes/public-pages.js
// Renders published pages at /p/:slug (no auth required)
const express = require('express');

module.exports = function (ctx) {
  const { pool, ah } = ctx;
  const router = express.Router();

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderBlocksToHtml(page) {
    const blocks = page.blocks || [];
    const blockHtml = blocks.map(b => {
      switch (b.type) {
        case 'heading':
          return `<h1 style="font-size:2.5rem;margin:1rem 0;color:#0f172a">${escapeHtml(b.props.text || '')}</h1>`;
        case 'paragraph':
          return `<p style="font-size:1rem;line-height:1.6;margin:1rem 0;color:#182030">${escapeHtml(b.props.text || '')}</p>`;
        case 'image':
          return `<img src="${escapeHtml(b.props.url || '')}" alt="${escapeHtml(b.props.alt || '')}" style="max-width:100%;height:auto;margin:1rem 0;border-radius:0.5rem" />`;
        case 'donation_button':
          return `<a href="${escapeHtml(b.props.campaign_url || '#')}" style="display:inline-block;padding:0.75rem 2rem;background:#10b981;color:white;text-decoration:none;border-radius:0.5rem;font-weight:bold;margin:1rem 0">${escapeHtml(b.props.text || 'Donate Now')}</a>`;
        case 'spacer':
          return `<div style="height:${b.props.height || 20}px"></div>`;
        case 'divider':
          return `<hr style="border:none;border-top:1px solid #e2e8f0;margin:2rem 0" />`;
        default:
          return '';
      }
    }).join('\n');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.description || '')}">
</head>
<body style="font-family:Inter,system-ui,sans-serif;max-width:800px;margin:0 auto;padding:2rem;background:#f8fafc">
  ${blockHtml}
</body>
</html>`;
  }

  // GET /p/:slug — render a published page as HTML
  router.get('/p/:slug', ah(async (req, res) => {
    const result = await pool.query(
      'SELECT * FROM pages WHERE slug = $1 AND is_published = true LIMIT 1',
      [req.params.slug]
    );
    if (!result.rows.length) return res.status(404).send('Page not found');
    res.set('Content-Type', 'text/html').send(renderBlocksToHtml(result.rows[0]));
  }));

  // GET /api/public/pages/:slug — JSON API for SPA rendering
  router.get('/api/public/pages/:slug', ah(async (req, res) => {
    const result = await pool.query(
      'SELECT * FROM pages WHERE slug = $1 AND is_published = true LIMIT 1',
      [req.params.slug]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Page not found' });
    res.json(result.rows[0]);
  }));

  return router;
};
