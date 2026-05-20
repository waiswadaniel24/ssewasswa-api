# Task r1: FIX THE PWA INSTALL BUTTON

## Summary
Fixed the PWA install button on the landing page. The root cause was that the `beforeinstallprompt` event listener was placed in a `<script>` tag at the bottom of the body, causing it to miss the event which fires early in the page lifecycle when Chrome evaluates PWA criteria.

## Root Cause
The `beforeinstallprompt` event fires when Chrome determines the site meets PWA installability criteria. This can happen before body scripts execute. The previous implementation placed the listener at the bottom of the page (line 632 in public-portal.js), so the event was fired and lost before the listener was registered.

## Files Changed
1. **public-portal.js** — Main landing page
   - Added early `beforeinstallprompt` capture in `<head>` inline script
   - Added PWA meta tags (theme-color, apple-mobile-web-app-*, apple-touch-icon)
   - Rewrote PWA install logic with showToast, debug logging, browser-specific fallback
   - Fixed SW registration from `/sw.js?v=4` to `/sw.js`
   - Fixed float install button missing `display:flex`

2. **public/sw.js** — Service worker
   - Bumped version from v8.0 to v9.0 (forces cache refresh and SW re-registration)

3. **server.js** — Express server
   - Updated fallback SW inline code from v8.0 to v9.0

4. **worklog.md** — Added detailed task record
