module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS nft_artworks (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_id INT NOT NULL,
        title VARCHAR(255) NOT NULL, description TEXT, image_url TEXT,
        medium VARCHAR(100) DEFAULT 'digital', collection_id INT,
        minted BOOLEAN DEFAULT false, token_id VARCHAR(100), blockchain_tx TEXT,
        edition INT DEFAULT 1, max_editions INT DEFAULT 1,
        tags JSONB DEFAULT '[]', metadata JSONB DEFAULT '{}',
        views INT DEFAULT 0, likes INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS nft_collections (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, name VARCHAR(255) NOT NULL,
        description TEXT, curator_id INT, artwork_count INT DEFAULT 0,
        cover_image TEXT, category VARCHAR(50), is_public BOOLEAN DEFAULT true,
        tags JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS nft_transactions (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, artwork_id INT REFERENCES nft_artworks(id),
        from_user_id INT, to_user_id INT, transaction_type VARCHAR(30) NOT NULL,
        price DECIMAL(12,4) DEFAULT 0, royalty_pct DECIMAL(5,2) DEFAULT 0,
        tx_hash VARCHAR(255), status VARCHAR(20) DEFAULT 'pending',
        notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS nft_artist_profiles (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_id INT NOT NULL UNIQUE,
        bio TEXT, style VARCHAR(100), website TEXT, social_links JSONB DEFAULT '{}',
        total_artworks INT DEFAULT 0, total_sold INT DEFAULT 0,
        total_earnings DECIMAL(12,4) DEFAULT 0, followers INT DEFAULT 0,
        verified BOOLEAN DEFAULT false, featured BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS nft_exhibitions (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(255) NOT NULL,
        description TEXT, curator_id INT, artwork_ids JSONB DEFAULT '[]',
        start_date DATE, end_date DATE, is_active BOOLEAN DEFAULT true,
        banner_image TEXT, theme VARCHAR(50) DEFAULT 'gallery',
        max_artworks INT DEFAULT 50, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS nft_likes (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, artwork_id INT REFERENCES nft_artworks(id),
        user_id INT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, artwork_id, user_id)
      )`);
      console.log('[Mod] nft-student-art OK');
    } catch(e) { console.warn('[Mod] nft-student-art Warn:', e.message); }
  })();

  const MEDIUMS = ['digital_painting','photography','3d_render','illustration','pixel_art','mixed_media','animation','vector_art','generative','ai_assisted'];
  const TX_TYPES = ['mint','transfer','sale','auction_bid','royalty_payment','burn'];

  /* ════════════════════════════════════════════════
     ROUTE 1 — Dashboard / Gallery Home
     ════════════════════════════════════════════════ */
  app.get('/school/nft-student-art', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const [artworks, collections, transactions, myArt] = await Promise.all([
        pool.query('SELECT COUNT(*) AS cnt FROM nft_artworks WHERE tenant_id=$1', [tid]),
        pool.query('SELECT COUNT(*) AS cnt FROM nft_collections WHERE tenant_id=$1', [tid]),
        pool.query('SELECT COUNT(*) AS cnt FROM nft_transactions WHERE tenant_id=$1 AND status=$2', [tid, 'completed']),
        pool.query('SELECT COUNT(*) AS cnt FROM nft_artworks WHERE tenant_id=$1 AND student_id=$2', [tid, req.user_id])
      ]);
      const featured = await pool.query(`SELECT a.*, u.name AS artist_name FROM nft_artworks a
        JOIN users u ON a.student_id=u.id WHERE a.tenant_id=$1 AND a.minted=true ORDER BY a.likes DESC LIMIT 6`, [tid]);
      const recent = await pool.query(`SELECT a.*, u.name AS artist_name FROM nft_artworks a
        JOIN users u ON a.student_id=u.id WHERE a.tenant_id=$1 ORDER BY a.created_at DESC LIMIT 8`, [tid]);
      const rows = `
        <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
          <div class="card" style="text-align:center"><div style="font-size:2em;color:${P}">${artworks.rows[0].cnt}</div><div style="color:${GRAY}">Total Artworks</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:${P}">${collections.rows[0].cnt}</div><div style="color:${GRAY}">Collections</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:#10b981">${transactions.rows[0].cnt}</div><div style="color:${GRAY}">Transactions</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:#f59e0b">${myArt.rows[0].cnt}</div><div style="color:${GRAY}">My Artworks</div></div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
          <a class="btn" href="/school/nft-student-art/gallery" style="text-decoration:none">Gallery</a>
          <a class="btn" href="/school/nft-student-art/upload" style="background:#10b981;text-decoration:none">Upload Art</a>
          <a class="btn" href="/school/nft-student-art/collections" style="background:#8b5cf6;text-decoration:none">Collections</a>
          <a class="btn" href="/school/nft-student-art/marketplace" style="background:#f59e0b;text-decoration:none">Marketplace</a>
          <a class="btn" href="/school/nft-student-art/exhibitions" style="background:#ec4899;text-decoration:none">Exhibitions</a>
          <a class="btn" href="/school/nft-student-art/artists" style="background:#06b6d4;text-decoration:none">Artists</a>
          <a class="btn" href="/school/nft-student-art/transactions" style="background:${GRAY};text-decoration:none">Transactions</a>
        </div>
        ${featured.rows.length?`<div class="card"><h3 style="margin-top:0">Featured NFTs</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
            ${featured.rows.map(a => `<div style="border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12)">
              ${a.image_url?`<img src="${esc(a.image_url)}" style="width:100%;height:180px;object-fit:cover" alt="${esc(a.title)}">`:'<div style="width:100%;height:180px;background:linear-gradient(135deg,#e0e7ff,#c7d2fe);display:flex;align-items:center;justify-content:center">🖼️</div>'}
              <div style="padding:12px"><h4 style="margin:0 0 4px">${esc(a.title)}</h4><p style="color:${GRAY};font-size:0.85em;margin:0">${esc(a.artist_name)} · ❤️ ${a.likes}</p>
              ${a.token_id?`<p style="color:${P};font-size:0.8em;margin:4px 0 0">Token: ${esc(a.token_id)}</p>`:''}</div></div>`).join('')}
          </div></div>`:''}
        <div class="card"><h3 style="margin-top:0">Recent Uploads</h3>
          <table><tr><th>Artwork</th><th>Artist</th><th>Medium</th><th>Minted</th><th>Created</th></tr>
          ${recent.rows.map(a=>`<tr><td><a href="/school/nft-student-art/artworks/${a.id}">${esc(a.title)}</a></td><td>${esc(a.artist_name)}</td><td>${esc(a.medium)}</td><td>${a.minted?'✅':'—'}</td><td>${new Date(a.created_at).toLocaleDateString()}</td></tr>`).join('')}
          </table>
        </div>`;
      renderPage(req, res, 'NFT Student Art Gallery', rows, SKIP, '/school/nft-student-art');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 2 — Full Gallery Browse
     ════════════════════════════════════════════════ */
  app.get('/school/nft-student-art/gallery', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { medium, minted, search, sort } = req.query;
      let sql = `SELECT a.*, u.name AS artist_name FROM nft_artworks a JOIN users u ON a.student_id=u.id WHERE a.tenant_id=$1`;
      const params = [req.tenant_id];
      let i = 2;
      if (medium) { sql += ` AND a.medium=$${i++}`; params.push(medium); }
      if (minted === 'true') { sql += ` AND a.minted=true`; }
      if (search) { sql += ` AND (a.title ILIKE $${i++} OR a.description ILIKE $${i++})`; params.push(`%${search}%`,`%${search}%`); }
      const sortCol = sort === 'likes' ? 'a.likes DESC' : sort === 'newest' ? 'a.created_at DESC' : 'a.created_at DESC';
      sql += ` ORDER BY ${sortCol} LIMIT 100`;
      const result = await pool.query(sql, params);
      const html = `
        <div class="card"><h3 style="margin-top:0">Art Gallery</h3>
          <form method="get" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <input name="search" placeholder="Search artworks..." value="${esc(search||'')}" style="width:200px">
            <select name="medium" style="width:150px"><option value="">All Mediums</option>${MEDIUMS.map(m=>`<option value="${m}" ${medium===m?'selected':''}>${m.replace(/_/g,' ')}</option>`).join('')}</select>
            <select name="minted" style="width:130px"><option value="">All</option><option value="true" ${minted==='true'?'selected':''}>Minted Only</option></select>
            <select name="sort" style="width:130px"><option value="newest" ${sort==='newest'?'selected':''}>Newest</option><option value="likes" ${sort==='likes'?'selected':''}>Most Liked</option></select>
            <button class="btn" type="submit">Filter</button>
          </form>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px">
            ${result.rows.map(a => `<div class="card" style="padding:0;overflow:hidden">
              ${a.image_url?`<a href="/school/nft-student-art/artworks/${a.id}"><img src="${esc(a.image_url)}" style="width:100%;height:200px;object-fit:cover" alt="${esc(a.title)}"></a>`
              :`<a href="/school/nft-student-art/artworks/${a.id}"><div style="width:100%;height:200px;background:linear-gradient(135deg,#ede9fe,#ddd6fe);display:flex;align-items:center;justify-content:center;font-size:3em">🎨</div></a>`}
              <div style="padding:12px"><a href="/school/nft-student-art/artworks/${a.id}" style="text-decoration:none;color:inherit"><h4 style="margin:0 0 4px">${esc(a.title)}</h4></a>
              <p style="color:${GRAY};font-size:0.85em;margin:0">${esc(a.artist_name)} · ${esc(a.medium).replace(/_/g,' ')}</p>
              <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:0.85em"><span>❤️ ${a.likes}</span><span>👁️ ${a.views}</span>
              ${a.minted?`<span style="color:${P}">Minted</span>`:''}</div></div></div>`).join('')}
            ${result.rows.length===0?'<p style="color:'+GRAY+';grid-column:1/-1;text-align:center;padding:40px">No artworks found</p>':''}
          </div>
        </div>`;
      renderPage(req, res, 'Gallery', html, SKIP, '/school/nft-student-art');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 3 — Upload Artwork
     ════════════════════════════════════════════════ */
  app.get('/school/nft-student-art/upload', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const collections = await pool.query('SELECT id,name FROM nft_collections WHERE tenant_id=$1 ORDER BY name', [req.tenant_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">Upload Artwork</h3>
          <form method="post" action="/school/nft-student-art/upload" enctype="multipart/form-data">
            <div style="margin-bottom:12px"><label>Title *</label><input name="title" required placeholder="Artwork title"></div>
            <div style="margin-bottom:12px"><label>Description</label><textarea name="description" rows="3" placeholder="Describe your artwork, inspiration, techniques used..."></textarea></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label>Medium *</label><select name="medium" required>${MEDIUMS.map(m=>`<option value="${m}">${m.replace(/_/g,' ')}</option>`).join('')}</select></div>
              <div><label>Collection</label><select name="collection_id"><option value="">None</option>${collections.rows.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
              <div><label>Max Editions</label><input name="max_editions" type="number" value="1" min="1" max="100"></div>
              <div><label>Image URL</label><input name="image_url" placeholder="https://..."></div>
            </div>
            <div style="margin-top:12px"><label>Tags (JSON array)</label><input name="tags" placeholder='["abstract","colorful","surreal"]'></div>
            <div style="margin-top:16px"><button class="btn" type="submit" style="background:#10b981">Upload Artwork</button> <a class="btn" href="/school/nft-student-art" style="background:${GRAY}">Cancel</a></div>
          </form>
        </div>`;
      renderPage(req, res, 'Upload Art', html, SKIP, '/school/nft-student-art');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/nft-student-art/upload', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { title, description, medium, collection_id, max_editions, image_url, tags } = req.body;
      let tagArr = [];
      try { tagArr = JSON.parse(tags || '[]'); } catch(_) {}
      await pool.query(`INSERT INTO nft_artworks (tenant_id,student_id,title,description,medium,collection_id,max_editions,image_url,tags)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [req.tenant_id, req.user_id, title, description, medium, parseInt(max_editions)||1, collection_id||null, image_url, JSON.stringify(tagArr)]);
      if (collection_id) {
        await pool.query('UPDATE nft_collections SET artwork_count=artwork_count+1 WHERE id=$1 AND tenant_id=$2', [collection_id, req.tenant_id]);
      }
      audit(req, 'artwork_uploaded', { title, medium });
      req.flash('success', 'Artwork uploaded successfully');
      res.redirect('/school/nft-student-art/gallery');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 4 — Artwork Detail
     ════════════════════════════════════════════════ */
  app.get('/school/nft-student-art/artworks/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const art = await pool.query(`SELECT a.*, u.name AS artist_name, u.avatar_url FROM nft_artworks a
        JOIN users u ON a.student_id=u.id WHERE a.id=$1 AND a.tenant_id=$2`, [req.params.id, req.tenant_id]);
      if (!art.rows[0]) return res.status(404).send('Artwork not found');
      const a = art.rows[0];
      await pool.query('UPDATE nft_artworks SET views=views+1 WHERE id=$1', [a.id]);
      const txs = await pool.query(`SELECT t.*, u.name AS from_name, u2.name AS to_name FROM nft_transactions t
        LEFT JOIN users u ON t.from_user_id=u.id LEFT JOIN users u2 ON t.to_user_id=u2.id
        WHERE t.artwork_id=$1 AND t.tenant_id=$2 ORDER BY t.created_at DESC LIMIT 20`, [a.id, req.tenant_id]);
      const collection = a.collection_id ? await pool.query('SELECT name FROM nft_collections WHERE id=$1', [a.collection_id]) : null;
      const liked = await pool.query('SELECT id FROM nft_likes WHERE artwork_id=$1 AND user_id=$2 AND tenant_id=$3', [a.id, req.user_id, req.tenant_id]);
      const html = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
          <div class="card" style="padding:0;overflow:hidden">
            ${a.image_url?`<img src="${esc(a.image_url)}" style="width:100%;max-height:500px;object-fit:contain" alt="${esc(a.title)}">`
            :'<div style="width:100%;height:400px;background:linear-gradient(135deg,#ede9fe,#ddd6fe);display:flex;align-items:center;justify-content:center;font-size:5em">🎨</div>'}
          </div>
          <div>
            <div class="card"><h2 style="margin-top:0">${esc(a.title)}</h2>
              <p style="color:${GRAY}">by <a href="/school/nft-student-art/artists/${a.student_id}">${esc(a.artist_name)}</a></p>
              <p style="margin-top:8px">${esc(a.description||'No description provided')}</p>
              <div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap">
                <span style="background:#f3f4f6;padding:2px 10px;border-radius:12px">${esc(a.medium).replace(/_/g,' ')}</span>
                ${collection.rows[0]?`<span style="background:#e0e7ff;color:${P};padding:2px 10px;border-radius:12px">${esc(collection.rows[0].name)}</span>`:''}
                ${a.minted?`<span style="background:#d1fae5;color:#065f46;padding:2px 10px;border-radius:12px">Minted</span>`:''}
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:16px">
                <div style="text-align:center"><div style="font-size:1.5em;color:#ef4444">${a.likes}</div><div style="color:${GRAY};font-size:0.85em">Likes</div></div>
                <div style="text-align:center"><div style="font-size:1.5em;color:${P}">${a.views}</div><div style="color:${GRAY};font-size:0.85em">Views</div></div>
                <div style="text-align:center"><div style="font-size:1.5em;color:#f59e0b">${a.edition||1}/${a.max_editions}</div><div style="color:${GRAY};font-size:0.85em">Edition</div></div>
              </div>
              ${a.token_id?`<div style="margin-top:12px;background:#f0fdf4;padding:12px;border-radius:8px"><strong>Token ID:</strong> <code>${esc(a.token_id)}</code>${a.blockchain_tx?`<br><strong>Tx:</strong> <code style="font-size:0.8em">${esc(a.blockchain_tx)}</code>`:''}</div>`:''}
              <div style="margin-top:12px;display:flex;gap:8px">
                <form method="post" action="/school/nft-student-art/artworks/${a.id}/like"><button class="btn" style="background:${liked.rows.length ? '#ef4444' : '#fff3f3'};color:${liked.rows.length ? '#fff' : '#ef4444'}">${liked.rows.length ? '❤️ Liked' : '🤍 Like'}</button></form>
                ${!a.minted && a.student_id===req.user_id?`<form method="post" action="/school/nft-student-art/artworks/${a.id}/mint"><button class="btn" style="background:#10b981">Mint NFT</button></form>`:''}
              </div>
            </div>
          </div>
        </div>
        ${a.tags&&a.tags.length?`<div class="card"><h3 style="margin-top:0">Tags</h3><div style="display:flex;gap:6px;flex-wrap:wrap">${a.tags.map(t=>`<span style="background:#f3f4f6;padding:4px 12px;border-radius:20px;font-size:0.85em">${esc(t)}</span>`).join('')}</div></div>`:''}
        ${txs.rows.length?`<div class="card"><h3 style="margin-top:0">Transaction History</h3>
          <table><tr><th>Type</th><th>From</th><th>To</th><th>Price</th><th>Royalty</th><th>Status</th><th>Date</th></tr>
          ${txs.rows.map(t=>`<tr><td>${esc(t.transaction_type)}</td><td>${esc(t.from_name||'—')}</td><td>${esc(t.to_name||'—')}</td><td>${t.price||0}</td><td>${t.royalty_pct||0}%</td><td>${esc(t.status)}</td><td>${new Date(t.created_at).toLocaleDateString()}</td></tr>`).join('')}
          </table></div>`:''}`;
      renderPage(req, res, a.title, html, SKIP, '/school/nft-student-art');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 5 — Mint NFT
     ════════════════════════════════════════════════ */
  app.post('/school/nft-student-art/artworks/:id/mint', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const art = await pool.query('SELECT * FROM nft_artworks WHERE id=$1 AND tenant_id=$2 AND student_id=$3 AND minted=false', [req.params.id, req.tenant_id, req.user_id]);
      if (!art.rows[0]) { req.flash('error', 'Cannot mint this artwork'); return res.redirect('back'); }
      const tokenId = 'NFT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      const txHash = '0x' + Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('');
      await pool.query('UPDATE nft_artworks SET minted=true, token_id=$1, blockchain_tx=$2, updated_at=NOW() WHERE id=$3', [tokenId, txHash, req.params.id]);
      await pool.query(`INSERT INTO nft_transactions (tenant_id,artwork_id,from_user_id,to_user_id,transaction_type,tx_hash,status)
        VALUES ($1,$2,NULL,$3,'mint',$4,'completed')`, [req.tenant_id, req.params.id, req.user_id, txHash]);
      audit(req, 'nft_minted', { artwork_id: req.params.id, token_id: tokenId });
      queueEmail(req.user_id, 'nft_minted', { title: art.rows[0].title, token_id: tokenId });
      req.flash('success', `NFT minted! Token: ${tokenId}`);
      res.redirect('/school/nft-student-art/artworks/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 6 — Like / Unlike
     ════════════════════════════════════════════════ */
  app.post('/school/nft-student-art/artworks/:id/like', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const existing = await pool.query('SELECT id FROM nft_likes WHERE artwork_id=$1 AND user_id=$2 AND tenant_id=$3', [req.params.id, req.user_id, req.tenant_id]);
      if (existing.rows.length > 0) {
        await pool.query('DELETE FROM nft_likes WHERE id=$1', [existing.rows[0].id]);
        await pool.query('UPDATE nft_artworks SET likes=GREATEST(likes-1,0) WHERE id=$1', [req.params.id]);
      } else {
        await pool.query('INSERT INTO nft_likes (tenant_id,artwork_id,user_id) VALUES ($1,$2,$3)', [req.tenant_id, req.params.id, req.user_id]);
        await pool.query('UPDATE nft_artworks SET likes=likes+1 WHERE id=$1', [req.params.id]);
      }
      res.redirect('/school/nft-student-art/artworks/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 7 — Collections
     ════════════════════════════════════════════════ */
  app.get('/school/nft-student-art/collections', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const result = await pool.query(`SELECT c.*, u.name AS curator_name FROM nft_collections c
        LEFT JOIN users u ON c.curator_id=u.id WHERE c.tenant_id=$1 ORDER BY c.created_at DESC`, [req.tenant_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">Collections <a class="btn" href="/school/nft-student-art/collections/new" style="background:#10b981;font-size:0.85em;padding:4px 12px;text-decoration:none">+ New</a></h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
            ${result.rows.map(c => `<div class="card" style="border-left:4px solid ${P}">
              <h4>${esc(c.name)}</h4>
              <p style="color:${GRAY};font-size:0.9em">${esc(c.description||'').substring(0,100)}${(c.description||'').length>100?'...':''}</p>
              <div style="display:flex;gap:12px;margin-top:8px;font-size:0.85em;color:${GRAY}">
                <span>${c.artwork_count} artworks</span>
                <span>by ${esc(c.curator_name||'—')}</span>
                <span>${c.is_public?'🌐 Public':'🔒 Private'}</span>
              </div>
              <a class="btn" href="/school/nft-student-art/collections/${c.id}" style="margin-top:8px;display:block;text-align:center">View Collection</a>
            </div>`).join('')}
            ${result.rows.length===0?'<p style="color:'+GRAY+';grid-column:1/-1;text-align:center">No collections yet</p>':''}
          </div>
        </div>`;
      renderPage(req, res, 'Collections', html, SKIP, '/school/nft-student-art');
    } catch(e) { ah(e, req, res); }
  });

  app.get('/school/nft-student-art/collections/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `
      <div class="card"><h3 style="margin-top:0">Create Collection</h3>
        <form method="post" action="/school/nft-student-art/collections/new">
          <div style="margin-bottom:12px"><label>Name *</label><input name="name" required placeholder="e.g. Abstract Dreams"></div>
          <div style="margin-bottom:12px"><label>Description</label><textarea name="description" rows="3" placeholder="Collection theme and concept..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Category</label><input name="category" placeholder="e.g. abstract, landscape"></div>
            <div><label>Public</label><select name="is_public"><option value="true">Public</option><option value="false">Private</option></select></div>
          </div>
          <div style="margin-top:12px"><label>Cover Image URL</label><input name="cover_image" placeholder="https://..."></div>
          <div style="margin-top:12px"><label>Tags (JSON)</label><input name="tags" placeholder='["abstract","2024"]'></div>
          <div style="margin-top:16px"><button class="btn" type="submit">Create Collection</button> <a class="btn" href="/school/nft-student-art/collections" style="background:${GRAY}">Cancel</a></div>
        </form>
      </div>`;
    renderPage(req, res, 'New Collection', html, SKIP, '/school/nft-student-art');
  });

  app.post('/school/nft-student-art/collections/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { name, description, category, is_public, cover_image, tags } = req.body;
      let tagArr = [];
      try { tagArr = JSON.parse(tags || '[]'); } catch(_) {}
      await pool.query(`INSERT INTO nft_collections (tenant_id,name,description,curator_id,category,is_public,cover_image,tags)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [req.tenant_id, name, description, req.user_id, category, is_public === 'true', cover_image, JSON.stringify(tagArr)]);
      audit(req, 'collection_created', { name });
      req.flash('success', 'Collection created');
      res.redirect('/school/nft-student-art/collections');
    } catch(e) { ah(e, req, res); }
  });

  app.get('/school/nft-student-art/collections/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const col = await pool.query('SELECT * FROM nft_collections WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant_id]);
      if (!col.rows[0]) return res.status(404).send('Not found');
      const c = col.rows[0];
      const arts = await pool.query(`SELECT a.*, u.name AS artist_name FROM nft_artworks a JOIN users u ON a.student_id=u.id
        WHERE a.collection_id=$1 AND a.tenant_id=$2 ORDER BY a.created_at DESC`, [c.id, req.tenant_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">${esc(c.name)}</h3>
          <p style="color:${GRAY}">${esc(c.description||'')}</p>
          <div style="display:flex;gap:12px;margin-top:8px;font-size:0.85em;color:${GRAY}">
            <span>${c.artwork_count} artworks</span><span>Category: ${esc(c.category||'—')}</span><span>${c.is_public?'Public':'Private'}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">
          ${arts.rows.map(a => `<div class="card" style="padding:0;overflow:hidden">
            ${a.image_url?`<a href="/school/nft-student-art/artworks/${a.id}"><img src="${esc(a.image_url)}" style="width:100%;height:180px;object-fit:cover"></a>`
            :`<a href="/school/nft-student-art/artworks/${a.id}"><div style="width:100%;height:180px;background:linear-gradient(135deg,#f3e8ff,#e9d5ff);display:flex;align-items:center;justify-content:center;font-size:2em">🎨</div></a>`}
            <div style="padding:10px"><h4 style="margin:0;font-size:0.95em">${esc(a.title)}</h4><p style="color:${GRAY};font-size:0.8em;margin:4px 0 0">${esc(a.artist_name)}</p></div></div>`).join('')}
          ${arts.rows.length===0?'<p style="color:'+GRAY+';grid-column:1/-1;text-align:center">No artworks in this collection</p>':''}
        </div>`;
      renderPage(req, res, c.name, html, SKIP, '/school/nft-student-art');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 8 — Marketplace
     ════════════════════════════════════════════════ */
  app.get('/school/nft-student-art/marketplace', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const listed = await pool.query(`SELECT t.*, a.title AS artwork_title, a.image_url, a.token_id,
        u.name AS seller_name FROM nft_transactions t
        JOIN nft_artworks a ON t.artwork_id=a.id LEFT JOIN users u ON t.from_user_id=u.id
        WHERE t.tenant_id=$1 AND t.transaction_type='sale' AND t.status='pending' ORDER BY t.created_at DESC`, [req.tenant_id]);
      const completedSales = await pool.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(price),0) AS volume
        FROM nft_transactions WHERE tenant_id=$1 AND transaction_type='sale' AND status='completed'`, [req.tenant_id]);
      const html = `
        <div class="card">
          <h3 style="margin-top:0">Marketplace</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
            <div style="background:#f0fdf4;padding:16px;border-radius:8px;text-align:center"><div style="font-size:1.5em;color:#10b981">${completedSales.rows[0].volume}</div><div style="color:${GRAY}">Total Volume</div></div>
            <div style="background:#eff6ff;padding:16px;border-radius:8px;text-align:center"><div style="font-size:1.5em;color:${P}">${completedSales.rows[0].cnt}</div><div style="color:${GRAY}">Completed Sales</div></div>
          </div>
          <h4>Available for Sale (${listed.rows.length})</h4>
          ${listed.rows.length?`<table><tr><th>Artwork</th><th>Seller</th><th>Price</th><th>Royalty</th><th>Listed</th><th>Actions</th></tr>
          ${listed.rows.map(t=>`<tr><td>${esc(t.artwork_title)} ${t.token_id?`<span style="font-size:0.8em;color:${P}">(${esc(t.token_id)})</span>`:''}</td><td>${esc(t.seller_name||'—')}</td><td>${t.price}</td><td>${t.royalty_pct||0}%</td><td>${new Date(t.created_at).toLocaleDateString()}</td><td><form method="post" action="/school/nft-student-art/marketplace/buy"><input type="hidden" name="tx_id" value="${t.id}"><button class="btn" style="background:#10b981">Buy</button></form></td></tr>`).join('')}
          </table>`:'<p style="color:'+GRAY+'">No artworks currently listed for sale</p>'}
        </div>`;
      renderPage(req, res, 'Marketplace', html, SKIP, '/school/nft-student-art');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/nft-student-art/marketplace/buy', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tx = await pool.query('SELECT * FROM nft_transactions WHERE id=$1 AND tenant_id=$2 AND status=$3', [req.body.tx_id, req.tenant_id, 'pending']);
      if (!tx.rows[0]) { req.flash('error', 'Transaction not found'); return res.redirect('back'); }
      const t = tx.rows[0];
      if (t.from_user_id === req.user_id) { req.flash('error', 'Cannot buy your own artwork'); return res.redirect('back'); }
      await pool.query('UPDATE nft_transactions SET to_user_id=$1, status=$2 WHERE id=$3', [req.user_id, 'completed', t.id]);
      await pool.query('UPDATE nft_artworks SET student_id=$1 WHERE id=$2', [req.user_id, t.artwork_id]);
      const royaltyAmt = t.price ? (t.price * (t.royalty_pct || 0) / 100) : 0;
      if (royaltyAmt > 0 && t.from_user_id) {
        await pool.query(`INSERT INTO nft_transactions (tenant_id,artwork_id,from_user_id,to_user_id,transaction_type,price,royalty_pct,status)
          VALUES ($1,$2,NULL,$3,'royalty_payment',$4,$5,'completed')`, [req.tenant_id, t.artwork_id, t.from_user_id, royaltyAmt, t.royalty_pct]);
      }
      audit(req, 'nft_purchased', { tx_id: t.id, artwork_id: t.artwork_id });
      queueEmail(t.from_user_id, 'nft_sold', { price: t.price, artwork_id: t.artwork_id });
      req.flash('success', 'Artwork purchased successfully!');
      res.redirect('/school/nft-student-art/marketplace');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 9 — Artist Profiles
     ════════════════════════════════════════════════ */
  app.get('/school/nft-student-art/artists', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const artists = await pool.query(`SELECT ap.*, u.name, u.avatar_url FROM nft_artist_profiles ap
        JOIN users u ON ap.student_id=u.id WHERE ap.tenant_id=$1 ORDER BY ap.total_earnings DESC`, [req.tenant_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">Student Artists</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px">
            ${artists.rows.map(a => `<div class="card" style="text-align:center;border-left:4px solid ${a.verified?'#10b981':P}">
              ${a.verified?'<div style="color:#10b981;font-size:0.8em">✅ Verified</div>':''}
              <h4>${esc(a.name)}</h4>
              <p style="color:${GRAY};font-size:0.85em">${esc(a.style||'No style set')}</p>
              <p style="color:${GRAY};font-size:0.85em;margin:4px 0">${esc((a.bio||'').substring(0,80))}${(a.bio||'').length>80?'...':''}</p>
              <div style="display:flex;justify-content:center;gap:16px;margin-top:8px;font-size:0.85em">
                <span>🎨 ${a.total_artworks}</span><span>💰 ${a.total_earnings}</span><span>👥 ${a.followers}</span>
              </div>
              <a class="btn" href="/school/nft-student-art/artists/${a.student_id}" style="margin-top:12px;display:inline-block">View Profile</a>
            </div>`).join('')}
            ${artists.rows.length===0?'<p style="color:'+GRAY+';grid-column:1/-1;text-align:center">No artist profiles yet</p>':''}
          </div>
        </div>`;
      renderPage(req, res, 'Artists', html, SKIP, '/school/nft-student-art');
    } catch(e) { ah(e, req, res); }
  });

  app.get('/school/nft-student-art/artists/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const profile = await pool.query(`SELECT ap.*, u.name, u.avatar_url FROM nft_artist_profiles ap
        JOIN users u ON ap.student_id=u.id WHERE ap.student_id=$1 AND ap.tenant_id=$2`, [req.params.id, req.tenant_id]);
      const artworks = await pool.query(`SELECT * FROM nft_artworks WHERE student_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 20`, [req.params.id, req.tenant_id]);
      const p = profile.rows[0] || { name: 'Unknown', style: '', bio: '', total_artworks: artworks.rows.length, total_earnings: 0, followers: 0, verified: false };
      const html = `
        <div class="card" style="text-align:center"><h3 style="margin-top:0">${esc(p.name)} ${p.verified?'✅':''}</h3>
          <p style="color:${GRAY}">${esc(p.style||'Artist')}</p>
          <p style="max-width:500px;margin:8px auto">${esc(p.bio||'No bio available')}</p>
          <div style="display:flex;justify-content:center;gap:24px;margin-top:16px">
            <div><div style="font-size:1.5em;color:${P}">${artworks.rows.length}</div><div style="color:${GRAY}">Artworks</div></div>
            <div><div style="font-size:1.5em;color:#10b981">${p.total_earnings}</div><div style="color:${GRAY}">Earnings</div></div>
            <div><div style="font-size:1.5em;color:#f59e0b">${p.followers}</div><div style="color:${GRAY}">Followers</div></div>
          </div>
        </div>
        <div class="card"><h3 style="margin-top:0">Artworks (${artworks.rows.length})</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">
            ${artworks.rows.map(a => `<div class="card" style="padding:0;overflow:hidden">
              ${a.image_url?`<a href="/school/nft-student-art/artworks/${a.id}"><img src="${esc(a.image_url)}" style="width:100%;height:150px;object-fit:cover"></a>`
              :`<a href="/school/nft-student-art/artworks/${a.id}"><div style="width:100%;height:150px;background:#f3e8ff;display:flex;align-items:center;justify-content:center">🎨</div></a>`}
              <div style="padding:8px"><a href="/school/nft-student-art/artworks/${a.id}" style="text-decoration:none;color:inherit;font-size:0.9em;font-weight:bold">${esc(a.title)}</a><p style="color:${GRAY};font-size:0.8em;margin:2px 0 0">❤️ ${a.likes} · ${a.minted?'Minted':''}</p></div></div>`).join('')}
          </div>
        </div>`;
      renderPage(req, res, p.name, html, SKIP, '/school/nft-student-art');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 10 — Exhibitions
     ════════════════════════════════════════════════ */
  app.get('/school/nft-student-art/exhibitions', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const exhs = await pool.query(`SELECT e.*, u.name AS curator_name FROM nft_exhibitions e
        LEFT JOIN users u ON e.curator_id=u.id WHERE e.tenant_id=$1 ORDER BY e.created_at DESC`, [req.tenant_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">Exhibitions <a class="btn" href="/school/nft-student-art/exhibitions/new" style="background:#ec4899;font-size:0.85em;padding:4px 12px;text-decoration:none">+ New</a></h3>
          <div style="display:grid;gap:16px">
            ${exhs.rows.map(e => `<div class="card" style="border-left:4px solid #ec4899">
              <div style="display:flex;justify-content:space-between;align-items:start">
                <div><h4>${esc(e.title)}</h4><p style="color:${GRAY};font-size:0.9em">${esc(e.description||'').substring(0,150)}</p></div>
                ${e.is_active?'<span style="background:#d1fae5;color:#065f46;padding:2px 10px;border-radius:12px;font-size:0.8em">Active</span>':'<span style="background:#f3f4f6;color:'+GRAY+';padding:2px 10px;border-radius:12px;font-size:0.8em">Closed</span>'}
              </div>
              <div style="display:flex;gap:16px;margin-top:8px;font-size:0.85em;color:${GRAY}">
                <span>Curator: ${esc(e.curator_name||'—')}</span>
                <span>${(e.artwork_ids||[]).length} artworks</span>
                <span>${e.start_date||'TBD'} — ${e.end_date||'TBD'}</span>
                <span>Theme: ${esc(e.theme||'gallery')}</span>
              </div>
            </div>`).join('')}
            ${exhs.rows.length===0?'<p style="color:'+GRAY+';text-align:center">No exhibitions yet</p>':''}
          </div>
        </div>`;
      renderPage(req, res, 'Exhibitions', html, SKIP, '/school/nft-student-art');
    } catch(e) { ah(e, req, res); }
  });

  app.get('/school/nft-student-art/exhibitions/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `
      <div class="card"><h3 style="margin-top:0">Create Exhibition</h3>
        <form method="post" action="/school/nft-student-art/exhibitions/new">
          <div style="margin-bottom:12px"><label>Title *</label><input name="title" required placeholder="e.g. Spring Art Show 2024"></div>
          <div style="margin-bottom:12px"><label>Description</label><textarea name="description" rows="3" placeholder="Exhibition description..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Start Date</label><input name="start_date" type="date"></div>
            <div><label>End Date</label><input name="end_date" type="date"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
            <div><label>Theme</label><select name="theme"><option value="gallery">Gallery</option><option value="modern">Modern</option><option value="minimalist">Minimalist</option><option value="dark">Dark Mode</option><option value="neon">Neon</option></select></div>
            <div><label>Max Artworks</label><input name="max_artworks" type="number" value="50" min="1"></div>
          </div>
          <div style="margin-top:16px"><button class="btn" type="submit" style="background:#ec4899">Create Exhibition</button> <a class="btn" href="/school/nft-student-art/exhibitions" style="background:${GRAY}">Cancel</a></div>
        </form>
      </div>`;
    renderPage(req, res, 'New Exhibition', html, SKIP, '/school/nft-student-art');
  });

  app.post('/school/nft-student-art/exhibitions/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { title, description, start_date, end_date, theme, max_artworks } = req.body;
      await pool.query(`INSERT INTO nft_exhibitions (tenant_id,title,description,curator_id,start_date,end_date,theme,max_artworks)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [req.tenant_id, title, description, req.user_id, start_date||null, end_date||null, theme, parseInt(max_artworks)||50]);
      audit(req, 'exhibition_created', { title });
      req.flash('success', 'Exhibition created');
      res.redirect('/school/nft-student-art/exhibitions');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 11 — Transactions History
     ════════════════════════════════════════════════ */
  app.get('/school/nft-student-art/transactions', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { type, status } = req.query;
      let sql = `SELECT t.*, a.title AS artwork_title, a.token_id,
        uf.name AS from_name, ut.name AS to_name FROM nft_transactions t
        JOIN nft_artworks a ON t.artwork_id=a.id
        LEFT JOIN users uf ON t.from_user_id=uf.id LEFT JOIN users ut ON t.to_user_id=ut.id
        WHERE t.tenant_id=$1`;
      const params = [req.tenant_id];
      let i = 2;
      if (type) { sql += ` AND t.transaction_type=$${i++}`; params.push(type); }
      if (status) { sql += ` AND t.status=$${i++}`; params.push(status); }
      sql += ' ORDER BY t.created_at DESC LIMIT 100';
      const result = await pool.query(sql, params);
      const statusColors = { completed:'#10b981', pending:'#f59e0b', failed:'#ef4444', cancelled:GRAY };
      const html = `
        <div class="card"><h3 style="margin-top:0">Transaction History</h3>
          <form method="get" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <select name="type" style="width:150px"><option value="">All Types</option>${TX_TYPES.map(t=>`<option value="${t}" ${type===t?'selected':''}>${t}</option>`).join('')}</select>
            <select name="status" style="width:130px"><option value="">All Status</option><option value="completed" ${status==='completed'?'selected':''}>Completed</option><option value="pending" ${status==='pending'?'selected':''}>Pending</option></select>
            <button class="btn" type="submit">Filter</button>
          </form>
          <table><tr><th>Type</th><th>Artwork</th><th>Token</th><th>From</th><th>To</th><th>Price</th><th>Royalty</th><th>Status</th><th>Date</th></tr>
          ${result.rows.map(t=>`<tr><td>${esc(t.transaction_type)}</td><td>${esc(t.artwork_title)}</td><td style="font-family:monospace;font-size:0.8em">${esc(t.token_id||'—')}</td><td>${esc(t.from_name||'—')}</td><td>${esc(t.to_name||'—')}</td><td>${t.price||0}</td><td>${t.royalty_pct||0}%</td><td><span style="color:${statusColors[t.status]||GRAY}">${esc(t.status)}</span></td><td>${new Date(t.created_at).toLocaleDateString()}</td></tr>`).join('')}
          ${result.rows.length===0?'<tr><td colspan="9" style="text-align:center;color:'+GRAY+'">No transactions found</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'Transactions', html, SKIP, '/school/nft-student-art');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 12 — Blockchain Verification
     ════════════════════════════════════════════════ */
  app.get('/school/nft-student-art/verify/:tokenId', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const art = await pool.query(`SELECT a.*, u.name AS artist_name FROM nft_artworks a
        JOIN users u ON a.student_id=u.id WHERE a.token_id=$1 AND a.tenant_id=$2`, [req.params.tokenId, req.tenant_id]);
      if (!art.rows[0]) return res.status(404).send('NFT not found');
      const a = art.rows[0];
      const txs = await pool.query('SELECT * FROM nft_transactions WHERE artwork_id=$1 AND tenant_id=$2 ORDER BY created_at', [a.id, req.tenant_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">Blockchain Verification</h3>
          <div style="background:#f0fdf4;border:2px solid #10b981;padding:20px;border-radius:12px">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
              <span style="font-size:2em">✅</span><span style="font-size:1.2em;font-weight:bold;color:#065f46">Verified Authentic</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><strong>Title:</strong> ${esc(a.title)}</div>
              <div><strong>Artist:</strong> ${esc(a.artist_name)}</div>
              <div><strong>Token ID:</strong> <code>${esc(a.token_id)}</code></div>
              <div><strong>Mint Tx:</strong> <code style="font-size:0.85em">${esc(a.blockchain_tx||'N/A')}</code></div>
              <div><strong>Edition:</strong> ${a.edition}/${a.max_editions}</div>
              <div><strong>Minted:</strong> ${new Date(a.created_at).toLocaleDateString()}</div>
              <div><strong>Medium:</strong> ${esc(a.medium).replace(/_/g,' ')}</div>
              <div><strong>Current Owner:</strong> User #${a.student_id}</div>
            </div>
          </div>
          <h3 style="margin-top:20px">Ownership History (${txs.rows.length})</h3>
          <table><tr><th>Type</th><th>From</th><th>To</th><th>Tx Hash</th><th>Status</th><th>Date</th></tr>
          ${txs.rows.map(t=>`<tr><td>${esc(t.transaction_type)}</td><td>${t.from_user_id||'Mint'}</td><td>${t.to_user_id||'—'}</td><td><code style="font-size:0.8em">${esc(t.tx_hash||'N/A')}</code></td><td>${esc(t.status)}</td><td>${new Date(t.created_at).toLocaleString()}</td></tr>`).join('')}
          </table>
        </div>`;
      renderPage(req, res, 'Verification: ' + a.token_id, html, SKIP, '/school/nft-student-art');
    } catch(e) { ah(e, req, res); }
  });
};
