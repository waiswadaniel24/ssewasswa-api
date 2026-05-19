/**
 * UI Foundation Module
 * ====================
 * Provides universal toast/snackbar notifications, loading overlays,
 * button state management, and skeleton loader CSS for the platform.
 *
 * The CSS and JS files are served from /public via express.static,
 * so this module primarily ensures cache-busting headers and provides
 * the server-side helper `uiFoundation()` for injecting references
 * into page layouts.
 *
 * Usage in server.js:
 *   const uiFoundation = require('./ui-foundation');
 *   uiFoundation(app, pool, { esc, renderPage, ... });
 */

module.exports = function(app, pool, opts) {
  opts = opts || {};
  var esc = opts.esc || String;

  // ── Cache-busting / versioned headers for UI foundation assets ──
  app.get('/ui-foundation.css', function(req, res, next) {
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
    res.setHeader('X-UI-Foundation', '1.0.0');
    next();
  });

  app.get('/ui-foundation.js', function(req, res, next) {
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
    res.setHeader('X-UI-Foundation', '1.0.0');
    next();
  });

  // ── Server-side helper: returns HTML snippet for <head> injection ──
  // This is attached to the opts object so renderPage can use it
  opts.uiFoundationHead = function() {
    return '<link rel="stylesheet" href="/ui-foundation.css">';
  };

  opts.uiFoundationBody = function() {
    return '<script src="/ui-foundation.js"></script>';
  };

  // Expose globally so renderPage can reference it
  global.uiFoundationHead = opts.uiFoundationHead;
  global.uiFoundationBody = opts.uiFoundationBody;

  console.log('[UIFoundation] Toast/Loading/Skeleton UI module loaded');
};
