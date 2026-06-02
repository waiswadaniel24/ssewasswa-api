// ============================================================
// GALLERY MODULE — Multi-Tenant SaaS Platform "Comfort Zone"
// Photo and media gallery management with albums, photo grid,
// upload metadata, tags, and storage overview.
// ============================================================
'use strict';

const { migrateQuery } = require('./db');
module.exports = function gallery(app, db, pool, renderPage, esc) {
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const genToken = () => require('crypto').randomBytes(24).toString('hex');

  // -- shared CSS -------------------------------------------------------
  const GL_CSS = `<style>
    .gl-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;align-items:center}
    .gl-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .gl-nav a:hover{background:#e2e8f0}.gl-nav a.active{background:#0891b2;color:#fff}
    .gl-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px}
    .gl-stat{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;text-align:center;transition:.15s}
    .gl-stat:hover{box-shadow:0 2px 12px rgba(0,0,0,.05)}
    .gl-stat-val{font-size:28px;font-weight:800;color:#1e293b}.gl-stat-lbl{font-size:11px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.3px}
    .gl-album-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px}
    .gl-album-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;transition:.2s;cursor:pointer}
    .gl-album-card:hover{box-shadow:0 4px 20px rgba(0,0,0,.08);transform:translateY(-2px)}
    .gl-album-cover{height:200px;background:#e2e8f0;position:relative;overflow:hidden}
    .gl-album-cover img{width:100%;height:100%;object-fit:cover}
    .gl-album-cover .placeholder{display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-size:48px}
    .gl-album-count{position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,.6);color:#fff;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;backdrop-filter:blur(4px)}
    .gl-album-body{padding:16px}
    .gl-album-name{font-size:16px;font-weight:700;color:#1e293b;margin-bottom:4px}
    .gl-album-desc{font-size:12px;color:#94a3b8;line-height:1.5;margin-bottom:10px}
    .gl-album-meta{font-size:11px;color:#64748b;display:flex;gap:12px}
    .gl-photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
    .gl-photo-card{position:relative;border-radius:12px;overflow:hidden;background:#e2e8f0;aspect-ratio:1;cursor:pointer;transition:.2s;border:2px solid transparent}
    .gl-photo-card:hover{border-color:#0891b2;box-shadow:0 4px 16px rgba(0,0,0,.1);transform:scale(1.02)}
    .gl-photo-card img{width:100%;height:100%;object-fit:cover}
    .gl-photo-card .placeholder{display:flex;align-items:center;justify-content:center;height:100%;color:#cbd5e1;font-size:40px}
    .gl-photo-overlay{position:absolute;bottom:0;left:0;right:0;padding:10px;background:linear-gradient(transparent,rgba(0,0,0,.7));color:#fff;font-size:11px}
    .gl-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .gl-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .gl-filter input,.gl-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .gl-filter input:focus,.gl-filter select:focus{outline:none;border-color:#0891b2}
    .gl-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
    .gl-form input,.gl-form select,.gl-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}
    .gl-form input:focus,.gl-form select:focus,.gl-form textarea:focus{outline:none;border-color:#0891b2}
    .gl-tag{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:#e0f2fe;color:#0891b2;margin:2px}
    .gl-detail{display:grid;grid-template-columns:2fr 1fr;gap:20px}
    .gl-detail-img{width:100%;max-height:500px;object-fit:contain;border-radius:12px;background:#f8fafc}
    .gl-upload-row{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:10px;align-items:end}
    @media(max-width:768px){.gl-album-grid{grid-template-columns:1fr}.gl-photo-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}.gl-detail{grid-template-columns:1fr}.gl-upload-row{grid-template-columns:1fr}.gl-stats{grid-template-columns:1fr 1fr}}
  </style>`;

  // -- navigation helper ------------------------------------------------
  const glNav = (active) => `<div class="gl-nav">
    <a href="/gallery" class="${active === 'dashboard' ? 'active' : ''}">🏠 Dashboard</a>
    <a href="/gallery/albums" class="${active === 'albums' ? 'active' : ''}">📂 Albums</a>
    <a href="/gallery/photos" class="${active === 'photos' ? 'active' : ''}">🖼 All Photos</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      await migrateQuery(pool, 'Gallery', `CREATE TABLE IF NOT EXISTS gallery_albums (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255), description TEXT, cover_url TEXT,
        is_public BOOLEAN DEFAULT true, photo_count INTEGER DEFAULT 0,
        created_by INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Gallery', `CREATE TABLE IF NOT EXISTS gallery_tags (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        photo_id INTEGER, tag VARCHAR(100), created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Gallery', `CREATE TABLE IF NOT EXISTS gallery_photos (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        album_id INTEGER, title VARCHAR(255), description TEXT,
        url TEXT, thumbnail_url TEXT, file_name VARCHAR(255), file_size INTEGER,
        width INTEGER, height INTEGER, mime_type VARCHAR(100),
        uploaded_by INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // ALTER TABLE columns
      const albumCols = [
        ['tenant_id', 'INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE'],
        ['name', 'VARCHAR(255)'], ['description', 'TEXT'], ['cover_url', 'TEXT'],
        ['is_public', 'BOOLEAN DEFAULT true'], ['photo_count', 'INTEGER DEFAULT 0'],
        ['created_by', 'INTEGER'], ['created_at', 'TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of albumCols) { try { await migrateQuery(pool, 'Gallery', `ALTER TABLE gallery_albums ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {} }
      const photoCols = [
        ['tenant_id', 'INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE'],
        ['album_id', 'INTEGER'], ['title', 'VARCHAR(255)'], ['description', 'TEXT'],
        ['url', 'TEXT'], ['thumbnail_url', 'TEXT'], ['file_name', 'VARCHAR(255)'],
        ['file_size', 'INTEGER'], ['width', 'INTEGER'], ['height', 'INTEGER'],
        ['mime_type', 'VARCHAR(100)'], ['uploaded_by', 'INTEGER'], ['created_at', 'TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of photoCols) { try { await migrateQuery(pool, 'Gallery', `ALTER TABLE gallery_photos ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {} }
      const tagCols = [
        ['tenant_id', 'INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE'],
        ['photo_id', 'INTEGER'], ['tag', 'VARCHAR(100)'], ['created_at', 'TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of tagCols) { try { await migrateQuery(pool, 'Gallery', `ALTER TABLE gallery_tags ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {} }
      // Indexes
      await migrateQuery(pool, 'Gallery', `CREATE INDEX IF NOT EXISTS idx_ga_tenant ON gallery_albums(tenant_id)`);
      await migrateQuery(pool, 'Gallery', `CREATE INDEX IF NOT EXISTS idx_gp_tenant ON gallery_photos(tenant_id)`);
      await migrateQuery(pool, 'Gallery', `CREATE INDEX IF NOT EXISTS idx_gp_album ON gallery_photos(album_id)`);
      await migrateQuery(pool, 'Gallery', `CREATE INDEX IF NOT EXISTS idx_gt_photo ON gallery_tags(photo_id)`);
      await migrateQuery(pool, 'Gallery', `CREATE INDEX IF NOT EXISTS idx_gt_tenant ON gallery_tags(tenant_id)`);
      console.log('[Gallery] Migrations applied');
    } catch (e) { console.error('[Gallery] Migration error:', e.message); }
  })();

  // ============================================================
  // ROUTE 1: GET /gallery — Dashboard
  // ============================================================
  app.get('/gallery', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const totalAlbums = (await pool.query(`SELECT COUNT(*)::int as cnt FROM gallery_albums WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const totalPhotos = (await pool.query(`SELECT COUNT(*)::int as cnt FROM gallery_photos WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const publicAlbums = (await pool.query(`SELECT COUNT(*)::int as cnt FROM gallery_albums WHERE tenant_id=$1 AND is_public=true`, [tid])).rows[0].cnt;
    const totalSize = (await pool.query(`SELECT COALESCE(SUM(file_size),0)::bigint as total FROM gallery_photos WHERE tenant_id=$1`, [tid])).rows[0].total;
    const recentPhotos = (await pool.query(`SELECT gp.*, ga.name as album_name FROM gallery_photos gp LEFT JOIN gallery_albums ga ON ga.id = gp.album_id WHERE gp.tenant_id=$1 ORDER BY gp.created_at DESC LIMIT 8`, [tid])).rows;
    const recentAlbums = (await pool.query(`SELECT * FROM gallery_albums WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 4`, [tid])).rows;

    const albumCards = recentAlbums.map(a => `<div class="gl-album-card" onclick="location.href='/gallery/albums/${esc(a.id)}'">
      <div class="gl-album-cover">
        ${a.cover_url ? `<img src="${esc(a.cover_url)}" alt="${esc(a.name)}" loading="lazy">` : '<div class="placeholder">📷</div>'}
        <div class="gl-album-count">📷 ${a.photo_count || 0}</div>
      </div>
      <div class="gl-album-body">
        <div class="gl-album-name">${esc(a.name || 'Untitled')}</div>
        <div class="gl-album-desc">${esc(a.description || 'No description')}</div>
        <div class="gl-album-meta"><span>📅 ${fmtDate(a.created_at)}</span>${a.is_public ? '<span>🌐 Public</span>' : '<span>🔒 Private</span>'}</div>
      </div>
    </div>`).join('');

    const photoCards = recentPhotos.map(p => `<div class="gl-photo-card" onclick="location.href='/gallery/photos/${esc(p.id)}'">
      ${p.url ? `<img src="${esc(p.thumbnail_url || p.url)}" alt="${esc(p.title || p.file_name)}" loading="lazy">` : '<div class="placeholder">🖼</div>'}
      <div class="gl-photo-overlay">${esc(p.title || p.file_name || 'Photo')}</div>
    </div>`).join('');

    function formatSize(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      let i = 0; let size = bytes;
      while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
      return size.toFixed(1) + ' ' + units[i];
    }

    const html = GL_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${glNav('dashboard')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🖼 Gallery</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage photos and media albums</p></div>
        <a href="/gallery/albums" class="btn btn-green">📂 Manage Albums</a>
      </div>
      <div class="gl-stats">
        <div class="gl-stat"><div class="gl-stat-val">${totalAlbums}</div><div class="gl-stat-lbl">Albums</div></div>
        <div class="gl-stat"><div class="gl-stat-val" style="color:#0891b2">${totalPhotos}</div><div class="gl-stat-lbl">Photos</div></div>
        <div class="gl-stat"><div class="gl-stat-val" style="color:#22c55e">${publicAlbums}</div><div class="gl-stat-lbl">Public Albums</div></div>
        <div class="gl-stat"><div class="gl-stat-val" style="color:#f59e0b">${formatSize(totalSize)}</div><div class="gl-stat-lbl">Storage Used</div></div>
      </div>
      <h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">📷 Recent Photos</h2>
      <div class="gl-photo-grid" style="margin-bottom:24px">${photoCards || '<div class="card" style="text-align:center;padding:40px;grid-column:1/-1"><p style="color:#94a3b8">No photos yet</p></div>'}</div>
      <h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">📂 Recent Albums</h2>
      <div class="gl-album-grid">${albumCards || '<div class="card" style="text-align:center;padding:40px;grid-column:1/-1"><p style="color:#94a3b8">No albums yet</p></div>'}</div>
    </div>`;
    res.send(renderPage('Gallery', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /gallery/albums — Album List
  // ============================================================
  app.get('/gallery/albums', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const albums = (await pool.query(
      `SELECT ga.*, u.name as creator_name FROM gallery_albums ga LEFT JOIN users u ON u.id = ga.created_by WHERE ga.tenant_id=$1 ORDER BY ga.created_at DESC`, [tid]
    )).rows;

    const albumCards = albums.map(a => `<div class="gl-album-card" onclick="location.href='/gallery/albums/${esc(a.id)}'">
      <div class="gl-album-cover">
        ${a.cover_url ? `<img src="${esc(a.cover_url)}" alt="${esc(a.name)}" loading="lazy">` : '<div class="placeholder">📷</div>'}
        <div class="gl-album-count">📷 ${a.photo_count || 0}</div>
      </div>
      <div class="gl-album-body">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <div class="gl-album-name">${esc(a.name || 'Untitled')}</div>
          <div style="display:flex;gap:4px">
            ${a.is_public ? '<span class="badge" style="background:#dcfce7;color:#16a34a;font-size:10px">🌐</span>' : '<span class="badge" style="background:#fee2e2;color:#dc2626;font-size:10px">🔒</span>'}
          </div>
        </div>
        <div class="gl-album-desc">${esc(a.description || 'No description')}</div>
        <div class="gl-album-meta">
          <span>📅 ${fmtDate(a.created_at)}</span>
          <span>by ${esc(a.creator_name || 'Admin')}</span>
        </div>
        <div style="margin-top:10px;display:flex;gap:6px">
          <form method="POST" action="/gallery/albums/${a.id}/delete" onsubmit="return confirm('Delete this album and all its photos?')" style="display:inline">
            <button class="btn btn-red btn-sm" style="padding:4px 10px;font-size:11px">🗑 Delete</button>
          </form>
        </div>
      </div>
    </div>`).join('');

    const html = GL_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${glNav('albums')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:22px;color:#1e293b">📂 Albums (${albums.length})</h1>
        <a href="#new-album-form" class="btn btn-green">➕ New Album</a>
      </div>
      <div class="card" style="padding:24px;margin-bottom:20px" id="new-album-form">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">➕ Create New Album</h3>
        <form method="POST" action="/gallery/albums" class="gl-form" style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">
          <div style="flex:2;min-width:200px"><label>Album Name *</label><input type="text" name="name" required placeholder="Album name"></div>
          <div style="flex:3;min-width:200px"><label>Description</label><input type="text" name="description" placeholder="Brief description"></div>
          <div style="min-width:120px"><label>Cover URL</label><input type="url" name="cover_url" placeholder="https://..."></div>
          <div style="display:flex;align-items:center;gap:8px;padding:0 14px"><label style="display:flex;align-items:center;gap:4px;font-size:12px;color:#475569;white-space:nowrap;margin:0"><input type="checkbox" name="is_public" checked> Public</label></div>
          <button type="submit" class="btn btn-green" style="height:42px">Create</button>
        </form>
      </div>
      <div class="gl-album-grid">${albumCards || '<div class="card" style="text-align:center;padding:48px;grid-column:1/-1"><p style="color:#94a3b8;font-size:16px">No albums yet. Create your first album above!</p></div>'}</div>
    </div>`;
    res.send(renderPage('Albums', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /gallery/albums — Create Album
  // ============================================================
  app.post('/gallery/albums', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, description, cover_url, is_public } = req.body;
    if (!name || !name.trim()) return res.redirect('/gallery/albums');
    await pool.query(
      `INSERT INTO gallery_albums (tenant_id, name, description, cover_url, is_public, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, name.trim(), (description || '').trim() || null, (cover_url || '').trim() || null, is_public !== 'off', user.id]
    );
    res.redirect('/gallery/albums');
  }));

  // ============================================================
  // ROUTE 4: GET /gallery/albums/:id — View Album
  // ============================================================
  app.get('/gallery/albums/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, albumId = req.params.id;
    const album = (await pool.query(`SELECT ga.*, u.name as creator_name FROM gallery_albums ga LEFT JOIN users u ON u.id = ga.created_by WHERE ga.id=$1 AND ga.tenant_id=$2`, [albumId, tid])).rows[0];
    if (!album) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#dc2626">Album not found</h2><a href="/gallery/albums" class="btn btn-sm" style="margin-top:12px">← Back to Albums</a></div>', user, req));

    const photos = (await pool.query(`SELECT * FROM gallery_photos WHERE album_id=$1 AND tenant_id=$2 ORDER BY created_at DESC`, [albumId, tid])).rows;
    const flash = req.session?.flash; req.session.flash = null;

    const photoCards = photos.map(p => `<div class="gl-photo-card" onclick="location.href='/gallery/photos/${esc(p.id)}'">
      ${p.url ? `<img src="${esc(p.thumbnail_url || p.url)}" alt="${esc(p.title || p.file_name)}" loading="lazy">` : '<div class="placeholder">🖼</div>'}
      <div class="gl-photo-overlay">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span>${esc(p.title || p.file_name || 'Photo')}</span>
          <form method="POST" action="/gallery/photos/${p.id}/delete" onclick="event.stopPropagation()" onsubmit="return confirm('Delete this photo?')" style="display:inline"><button class="btn btn-red btn-sm" style="padding:2px 8px;font-size:10px;line-height:1">✕</button></form>
        </div>
      </div>
    </div>`).join('');

    const html = GL_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${glNav('albums')}
      <a href="/gallery/albums" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Albums</a>
      ${flash ? `<div style="background:#dcfce7;color:#16a34a;padding:12px 18px;border-radius:10px;margin-bottom:16px;font-size:13px">${esc(flash.msg)}</div>` : ''}
      <div class="card" style="padding:20px;margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
          <div>
            <h1 style="font-size:22px;color:#1e293b;margin:0 0 4px">${esc(album.name || 'Untitled Album')}</h1>
            <p style="font-size:13px;color:#94a3b8;margin:0">${esc(album.description || 'No description')}</p>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            ${album.is_public ? '<span class="badge" style="background:#dcfce7;color:#16a34a">🌐 Public</span>' : '<span class="badge" style="background:#fee2e2;color:#dc2626">🔒 Private</span>'}
            <span style="font-size:12px;color:#64748b">by ${esc(album.creator_name || 'Admin')}</span>
          </div>
        </div>
      </div>
      <div class="card" style="padding:20px;margin-bottom:20px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">📤 Add Photos (Metadata)</h3>
        <form method="POST" action="/gallery/albums/${albumId}/upload" class="gl-form">
          <div class="gl-upload-row">
            <div><label>Title *</label><input type="text" name="title" required placeholder="Photo title"></div>
            <div><label>URL *</label><input type="url" name="url" required placeholder="https://example.com/photo.jpg"></div>
            <div><label>Thumbnail URL</label><input type="url" name="thumbnail_url" placeholder="Optional thumbnail"></div>
            <div><label>Tags (comma-sep)</label><input type="text" name="tags" placeholder="nature, landscape"></div>
          </div>
          <div class="gl-upload-row">
            <div><label>Description</label><input type="text" name="description" placeholder="Photo description"></div>
            <div><label>File Name</label><input type="text" name="file_name" placeholder="photo.jpg"></div>
            <div><label>File Size (bytes)</label><input type="number" name="file_size" placeholder="1024000"></div>
            <button type="submit" class="btn btn-green" style="height:42px;margin-top:0">Add Photo</button>
          </div>
        </form>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <h2 style="font-size:18px;color:#1e293b;margin:0">📷 Photos (${photos.length})</h2>
      </div>
      <div class="gl-photo-grid">${photoCards || '<div class="card" style="text-align:center;padding:48px;grid-column:1/-1"><p style="color:#94a3b8;font-size:16px">No photos in this album yet. Add photos above!</p></div>'}</div>
    </div>`;
    res.send(renderPage(album.name || 'Album', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: POST /gallery/albums/:id/upload — Add Photo Metadata
  // ============================================================
  app.post('/gallery/albums/:id/upload', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, albumId = req.params.id;
    const { title, url, thumbnail_url, description, file_name, file_size, tags } = req.body;
    if (!title || !title.trim() || !url || !url.trim()) { req.session.flash = { msg: 'Title and URL are required.' }; return res.redirect('/gallery/albums/' + albumId); }
    const album = (await pool.query(`SELECT id FROM gallery_albums WHERE id=$1 AND tenant_id=$2`, [albumId, tid])).rows[0];
    if (!album) return res.redirect('/gallery/albums');
    const result = await pool.query(
      `INSERT INTO gallery_photos (tenant_id, album_id, title, description, url, thumbnail_url, file_name, file_size, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [tid, albumId, title.trim(), (description || '').trim() || null, url.trim(), (thumbnail_url || '').trim() || null, (file_name || '').trim() || null, parseInt(file_size) || null, user.id]
    );
    if (tags && tags.trim()) {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      for (const tag of tagList) {
        await pool.query(`INSERT INTO gallery_tags (tenant_id, photo_id, tag) VALUES ($1,$2,$3)`, [tid, result.rows[0].id, tag]);
      }
    }
    await pool.query(`UPDATE gallery_albums SET photo_count = photo_count + 1 WHERE id=$1`, [albumId]);
    const photo = (await pool.query(`SELECT url FROM gallery_photos WHERE id=$1`, [result.rows[0].id])).rows[0];
    if (photo?.url && !album.cover_url) {
      await pool.query(`UPDATE gallery_albums SET cover_url=$1 WHERE id=$2`, [photo.url, albumId]);
    }
    req.session.flash = { msg: 'Photo added successfully!' };
    res.redirect('/gallery/albums/' + albumId);
  }));

  // ============================================================
  // ROUTE 6: POST /gallery/albums/:id/delete — Delete Album
  // ============================================================
  app.post('/gallery/albums/:id/delete', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, albumId = req.params.id;
    await pool.query(`DELETE FROM gallery_tags WHERE photo_id IN (SELECT id FROM gallery_photos WHERE album_id=$1 AND tenant_id=$2)`, [albumId, tid]);
    await pool.query(`DELETE FROM gallery_photos WHERE album_id=$1 AND tenant_id=$2`, [albumId, tid]);
    await pool.query(`DELETE FROM gallery_albums WHERE id=$1 AND tenant_id=$2`, [albumId, tid]);
    res.redirect('/gallery/albums');
  }));

  // ============================================================
  // ROUTE 7: GET /gallery/photos — All Photos Grid
  // ============================================================
  app.get('/gallery/photos', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const search = (req.query.search || '').trim();
    const tagFilter = (req.query.tag || '').trim();

    let where = ['gp.tenant_id=$1'], params = [tid], pi = 2;
    if (search) { where.push(`(gp.title ILIKE $${pi} OR gp.description ILIKE $${pi})`); params.push(`%${search}%`); pi++; }
    if (tagFilter) { where.push(`gp.id IN (SELECT photo_id FROM gallery_tags WHERE tag=$${pi} AND tenant_id=$1)`); params.push(tagFilter); pi++; }

    const allTags = (await pool.query(`SELECT tag, COUNT(*)::int as cnt FROM gallery_tags WHERE tenant_id=$1 GROUP BY tag ORDER BY cnt DESC LIMIT 20`, [tid])).rows;
    const photos = (await pool.query(
      `SELECT gp.*, ga.name as album_name FROM gallery_photos gp LEFT JOIN gallery_albums ga ON ga.id = gp.album_id WHERE ${where.join(' AND ')} ORDER BY gp.created_at DESC LIMIT 100`, params
    )).rows;

    const photoCards = photos.map(p => `<div class="gl-photo-card" onclick="location.href='/gallery/photos/${esc(p.id)}'">
      ${p.url ? `<img src="${esc(p.thumbnail_url || p.url)}" alt="${esc(p.title || p.file_name)}" loading="lazy">` : '<div class="placeholder">🖼</div>'}
      <div class="gl-photo-overlay">
        <div>${esc(p.title || p.file_name || 'Photo')}</div>
        ${p.album_name ? `<div style="opacity:.8;margin-top:2px">📂 ${esc(p.album_name)}</div>` : ''}
      </div>
    </div>`).join('');

    const tagCloud = allTags.map(t => `<a href="/gallery/photos?tag=${esc(t.tag)}" class="gl-tag" style="text-decoration:none;cursor:pointer;${t.tag === tagFilter ? 'background:#0891b2;color:#fff' : ''}">${esc(t.tag)} (${t.cnt})</a>`).join('');

    const html = GL_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${glNav('photos')}
      <h1 style="font-size:22px;color:#1e293b;margin-bottom:16px">🖼 All Photos (${photos.length})</h1>
      ${tagCloud ? `<div style="margin-bottom:16px">${tagCloud}</div>` : ''}
      <div class="gl-filter">
        <div><label>Search</label><form method="GET" action="/gallery/photos" style="display:flex;gap:6px">
          <input type="text" name="search" value="${esc(search)}" placeholder="Search photos..." style="width:240px">
          <button type="submit" class="btn btn-blue btn-sm">🔍</button>
          ${tagFilter ? `<a href="/gallery/photos" class="btn btn-sm" style="background:#f1f5f9;color:#475569">Clear Tag</a>` : ''}
        </form></div>
      </div>
      <div class="gl-photo-grid">${photoCards || '<div class="card" style="text-align:center;padding:48px;grid-column:1/-1"><p style="color:#94a3b8;font-size:16px">No photos found</p></div>'}</div>
    </div>`;
    res.send(renderPage('All Photos', html, user, req));
  }));

  // ============================================================
  // ROUTE 8: GET /gallery/photos/:id — Photo Detail
  // ============================================================
  app.get('/gallery/photos/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, photoId = req.params.id;
    const photo = (await pool.query(
      `SELECT gp.*, ga.name as album_name, ga.id as album_id, u.name as uploader_name FROM gallery_photos gp LEFT JOIN gallery_albums ga ON ga.id = gp.album_id LEFT JOIN users u ON u.id = gp.uploaded_by WHERE gp.id=$1 AND gp.tenant_id=$2`, [photoId, tid]
    )).rows[0];
    if (!photo) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#dc2626">Photo not found</h2><a href="/gallery/photos" class="btn btn-sm" style="margin-top:12px">← Back to Photos</a></div>', user, req));

    const tags = (await pool.query(`SELECT * FROM gallery_tags WHERE photo_id=$1 AND tenant_id=$2`, [photoId, tid])).rows;
    const tagHtml = tags.map(t => `<span class="gl-tag">${esc(t.tag)}</span>`).join('');

    function formatSize(bytes) {
      if (!bytes || bytes === 0) return 'N/A';
      const units = ['B', 'KB', 'MB', 'GB'];
      let i = 0; let size = bytes;
      while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
      return size.toFixed(1) + ' ' + units[i];
    }

    const html = GL_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${glNav('')}
      <a href="${photo.album_id ? '/gallery/albums/' + photo.album_id : '/gallery/photos'}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back</a>
      <div class="gl-detail">
        <div class="card" style="padding:20px;text-align:center">
          ${photo.url ? `<img src="${esc(photo.url)}" alt="${esc(photo.title || 'Photo')}" class="gl-detail-img" style="max-width:100%">` : '<div style="height:300px;background:#f1f5f9;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:48px">🖼</div>'}
          ${photo.description ? `<p style="text-align:left;font-size:14px;color:#475569;line-height:1.6;margin-top:16px;white-space:pre-wrap">${esc(photo.description)}</p>` : ''}
        </div>
        <div>
          <div class="card" style="padding:20px;margin-bottom:14px">
            <h2 style="font-size:18px;color:#1e293b;margin:0 0 12px">${esc(photo.title || 'Untitled')}</h2>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
              <div><span class="muted">Album:</span> ${photo.album_name ? `<a href="/gallery/albums/${esc(photo.album_id)}" style="color:#0891b2;text-decoration:none;font-weight:600">${esc(photo.album_name)}</a>` : '—'}</div>
              <div><span class="muted">Uploaded by:</span> ${esc(photo.uploader_name || 'Unknown')}</div>
              <div><span class="muted">Date:</span> ${fmtDateTime(photo.created_at)}</div>
              <div><span class="muted">File:</span> ${esc(photo.file_name || 'N/A')}</div>
              <div><span class="muted">Size:</span> ${formatSize(photo.file_size)}</div>
              <div><span class="muted">Dimensions:</span> ${photo.width && photo.height ? photo.width + ' × ' + photo.height + 'px' : 'N/A'}</div>
              <div><span class="muted">Type:</span> ${esc(photo.mime_type || 'N/A')}</div>
            </div>
            ${photo.url ? `<div style="margin-top:12px"><a href="${esc(photo.url)}" target="_blank" class="btn btn-blue btn-sm">🔗 Open Original</a></div>` : ''}
          </div>
          ${tagHtml ? `<div class="card" style="padding:20px;margin-bottom:14px"><h3 style="font-size:14px;color:#1e293b;margin:0 0 8px">🏷 Tags</h3><div>${tagHtml}</div></div>` : ''}
          <div class="card" style="padding:20px">
            <form method="POST" action="/gallery/photos/${photoId}/delete" onsubmit="return confirm('Delete this photo permanently?')">
              <button class="btn btn-red" style="width:100%">🗑 Delete Photo</button>
            </form>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage(photo.title || 'Photo', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: POST /gallery/photos/:id/delete — Delete Photo
  // ============================================================
  app.post('/gallery/photos/:id/delete', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, photoId = req.params.id;
    const photo = (await pool.query(`SELECT id, album_id FROM gallery_photos WHERE id=$1 AND tenant_id=$2`, [photoId, tid])).rows[0];
    if (!photo) return res.redirect('/gallery/photos');
    await pool.query(`DELETE FROM gallery_tags WHERE photo_id=$1 AND tenant_id=$2`, [photoId, tid]);
    await pool.query(`DELETE FROM gallery_photos WHERE id=$1 AND tenant_id=$2`, [photoId, tid]);
    if (photo.album_id) {
      const count = (await pool.query(`SELECT COUNT(*)::int as cnt FROM gallery_photos WHERE album_id=$1`, [photo.album_id])).rows[0].cnt;
      await pool.query(`UPDATE gallery_albums SET photo_count=$1 WHERE id=$2`, [count, photo.album_id]);
    }
    res.redirect(photo.album_id ? '/gallery/albums/' + photo.album_id : '/gallery/photos');
  }));

  // ============================================================
  // ROUTE 10: GET /gallery/api/albums — JSON API
  // ============================================================
  app.get('/gallery/api/albums', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const albums = (await pool.query(
      `SELECT id, name, description, cover_url, is_public, photo_count, created_at FROM gallery_albums WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]
    )).rows;
    res.json({ success: true, data: albums });
  }));
};
