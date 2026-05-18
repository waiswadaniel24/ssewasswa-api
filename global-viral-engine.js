// ============================================================
// === GLOBAL VIRAL ENGINE — Make Comfort Zone Go Worldwide ===
// ============================================================
// Global Search, Embeddable Widgets, Link Shortener, QR Codes,
// Live Chat, Referral Contests, Push Opt-in, Trending Topics,
// Badge System, Social Share API, Translate Helper, UGC Gallery
// ============================================================

// === DATABASE MIGRATIONS ===
const GLOBAL_VIRAL_MIGRATIONS = [
  // Global Search
  `CREATE TABLE IF NOT EXISTS global_search_logs (
    id SERIAL PRIMARY KEY, query TEXT NOT NULL, results_count INTEGER DEFAULT 0,
    ip_address TEXT, user_agent TEXT, country TEXT DEFAULT 'UG',
    clicked_result TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Link Shortener)
  `CREATE TABLE IF NOT EXISTS short_links (
    id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, original_url TEXT NOT NULL,
    title TEXT, clicks INTEGER DEFAULT 0, created_by TEXT, is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMPTZ, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS short_link_clicks (
    id SERIAL PRIMARY KEY, link_id INTEGER REFERENCES short_links(id) ON DELETE CASCADE,
    ip_address TEXT, country TEXT DEFAULT 'UG', referrer TEXT, user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Embeddable Widgets)
  `CREATE TABLE IF NOT EXISTS embed_widgets (
    id SERIAL PRIMARY KEY, widget_type TEXT NOT NULL, resource_id INTEGER,
    code TEXT UNIQUE, views INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
    domains TEXT[] DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Live Chat Rooms)
  `CREATE TABLE IF NOT EXISTS chat_rooms (
    id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT,
    category TEXT DEFAULT 'general', is_active BOOLEAN DEFAULT true,
    members_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY, room_id INTEGER REFERENCES chat_rooms(id) ON DELETE CASCADE,
    user_email TEXT, username TEXT NOT NULL, message TEXT NOT NULL,
    message_type TEXT DEFAULT 'text', is_pinned BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Referral Contests)
  `CREATE TABLE IF NOT EXISTS referral_contests (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT,
    start_date DATE, end_date DATE, prize TEXT, prize_value INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active', winner_email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Push Subscriptions (public)
  `CREATE TABLE IF NOT EXISTS public_push_subscriptions (
    id SERIAL PRIMARY KEY, endpoint TEXT UNIQUE NOT NULL, p256dh_key TEXT,
    auth_key TEXT, ip_address TEXT, country TEXT DEFAULT 'UG',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Trending Topics)
  `CREATE TABLE IF NOT EXISTS trending_topics (
    id SERIAL PRIMARY KEY, tag TEXT UNIQUE NOT NULL, mention_count INTEGER DEFAULT 0,
    category TEXT DEFAULT 'general', last_mentioned TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // UGC Gallery)
  `CREATE TABLE IF NOT EXISTS ugc_gallery (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT,
    image_url TEXT, category TEXT DEFAULT 'general', submitted_by TEXT,
    upvotes INTEGER DEFAULT 0, downvotes INTEGER DEFAULT 0,
    is_approved BOOLEAN DEFAULT false, is_featured BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Social Share Tracking)
  `CREATE TABLE IF NOT EXISTS social_shares (
    id SERIAL PRIMARY KEY, content_type TEXT, content_id INTEGER,
    platform TEXT NOT NULL, share_url TEXT, ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Badge Embeds)
  `CREATE TABLE IF NOT EXISTS badge_embeds (
    id SERIAL PRIMARY KEY, badge_type TEXT NOT NULL, tenant_name TEXT,
    style TEXT DEFAULT 'light', domain TEXT, impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
  )`
];
GLOBAL_VIRAL_MIGRATIONS.forEach(m => migrations.push(m));
['global_search_logs','short_links','short_link_clicks','embed_widgets','chat_rooms','chat_messages',
 'referral_contests','public_push_subscriptions','trending_topics','ugc_gallery','social_shares',
 'badge_embeds'].forEach(t => VALID_TABLES.add(t));

const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

// ============================================================
// === 1. GLOBAL SEARCH — Search Everything From One Box ===
// ============================================================
app.get('/search', ah(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    return res.send(renderPage('Search', `
      <div style="max-width:800px;margin:0 auto;padding:40px 20px;text-align:center">
        <h1 style="font-size:2.5em;margin-bottom:8px">Search Comfort Zone</h1>
        <p style="color:#64748b;margin-bottom:32px">Find blog posts, polls, quizzes, forum topics, jobs, stories, and more</p>
        <form method="GET" action="/search" style="display:flex;gap:8px;max-width:600px;margin:0 auto">
          <input type="text" name="q" placeholder="Search anything..." required
            style="flex:1;padding:16px 20px;border:2px solid #e2e8f0;border-radius:12px;font-size:16px;outline:none"
            onfocus="this.style.borderColor='#4f46e5'" onblur="this.style.borderColor='#e2e8f0'">
          <button type="submit" class="btn" style="padding:16px 32px;font-size:16px;border-radius:12px">Search</button>
        </form>
        <div style="margin-top:40px;display:flex;flex-wrap:wrap;gap:8px;justify-content:center">
          ${['Education','Health','Business','Technology','Jobs','Scholarships','Uganda','Schools','Churches','Fees'].map(t =>
            '<a href="/search?q='+encodeURIComponent(t)+'" style="padding:8px 16px;background:#f1f5f9;border-radius:20px;text-decoration:none;color:#475569;font-size:14px">'+t+'</a>'
          ).join('')}
        </div>
      </div>`, req.session.user));
  }

  // Log search
  pool.query('INSERT INTO global_search_logs(query, ip_address, user_agent) VALUES($1,$2,$3)', [q, req.ip, req.headers['user-agent']]).catch(() => {});

  const like = '%' + q + '%';
  const limit = 20;
  const [blogResults, pollResults, quizResults, forumResults, storyResults, jobResults, oppResults] = await Promise.all([
    pool.query(`SELECT title, slug, excerpt, 'blog' as type, '/blog/' || slug as url FROM auto_blog_posts WHERE is_published=true AND (title ILIKE $1 OR excerpt ILIKE $1) LIMIT $2`, [like, limit]).then(r => r.rows),
    pool.query(`SELECT title || ' (' || total_votes || ' votes)' as title, description as excerpt, 'poll' as type, '/polls#poll-' || id as url FROM polls WHERE is_active=true AND title ILIKE $1 LIMIT $2`, [like, limit]).then(r => r.rows),
    pool.query(`SELECT title, description as excerpt, 'quiz' as type, '/quizzes/' || id as url FROM quizzes WHERE is_published=true AND title ILIKE $1 LIMIT $2`, [like, limit]).then(r => r.rows),
    pool.query(`SELECT title, LEFT(body,150) as excerpt, 'forum' as type, '/forum/topic/' || id as url FROM forum_topics WHERE (title ILIKE $1 OR body ILIKE $1) LIMIT $2`, [like, limit]).then(r => r.rows),
    pool.query(`SELECT title, LEFT(story,150) as excerpt, 'story' as type, '/stories' as url FROM user_stories WHERE is_approved=true AND title ILIKE $1 LIMIT $2`, [like, limit]).then(r => r.rows),
    pool.query(`SELECT title, LEFT(description,150) as excerpt, 'job' as type, '/jobs' as url FROM scraped_jobs WHERE (title ILIKE $1 OR description ILIKE $1) LIMIT $2`, [like, limit]).then(r => r.rows),
    pool.query(`SELECT title, LEFT(description,150) as excerpt, 'opportunity' as type, '/opportunities' as url FROM scraped_opportunities WHERE (title ILIKE $1 OR description ILIKE $1) LIMIT $2`, [like, limit]).then(r => r.rows),
  ]).catch(() => [[],[],[],[],[],[],[]]);

  const allResults = [
    ...blogResults.map(r => ({...r, icon:'📰', color:'#4f46e5'})),
    ...pollResults.map(r => ({...r, icon:'📊', color:'#059669'})),
    ...quizResults.map(r => ({...r, icon:'🧠', color:'#7c3aed'})),
    ...forumResults.map(r => ({...r, icon:'💬', color:'#f59e0b'})),
    ...storyResults.map(r => ({...r, icon:'⭐', color:'#ec4899'})),
    ...jobResults.map(r => ({...r, icon:'💼', color:'#0ea5e9'})),
    ...oppResults.map(r => ({...r, icon:'🎯', color:'#10b981'}))
  ];

  // Update trending
  pool.query('INSERT INTO trending_topics(tag, mention_count, last_mentioned) VALUES($1,1,NOW()) ON CONFLICT(tag) DO UPDATE SET mention_count=trending_topics.mention_count+1, last_mentioned=NOW()', [q]).catch(() => {});

  res.send(renderPage('Search: ' + esc(q), `
    <div style="max-width:800px;margin:0 auto;padding:20px">
      <form method="GET" action="/search" style="margin-bottom:24px">
        <input type="text" name="q" value="${esc(q)}" placeholder="Search..."
          style="width:100%;padding:14px 20px;border:2px solid #e2e8f0;border-radius:12px;font-size:16px;outline:none">
      </form>
      <p style="color:#64748b;margin-bottom:16px">${allResults.length} result${allResults.length!==1?'s':''} for "${esc(q)}"</p>
      ${allResults.length === 0 ? '<div style="text-align:center;padding:60px 20px"><p style="font-size:1.2em;color:#64748b">No results found. Try different keywords.</p><p style="margin-top:8px"><a href="/discover" class="btn">Browse Content</a></p></div>' :
        allResults.map(r => `
          <a href="${r.url}" style="display:block;padding:16px;margin-bottom:8px;border-radius:12px;text-decoration:none;border:1px solid #e2e8f0;transition:all 0.2s"
            onmouseover="this.style.borderColor='${r.color}';this.style.boxShadow='0 2px 8px ${r.color}22'" onmouseout="this.style.borderColor='#e2e8f0';this.style.boxShadow='none'">
            <div style="display:flex;align-items:start;gap:12px">
              <span style="font-size:1.5em">${r.icon}</span>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;color:#1e293b;margin-bottom:4px">${esc(r.title)}</div>
                <div style="color:#64748b;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.excerpt || '')}</div>
                <span style="display:inline-block;margin-top:6px;padding:2px 8px;background:${r.color}15;color:${r.color};border-radius:4px;font-size:12px;text-transform:uppercase;font-weight:600">${r.type}</span>
              </div>
            </div>
          </a>
        `).join('')}
    </div>`, req.session.user));
}));

// ============================================================
// === 2. LINK SHORTENER — Viral Short Links + Analytics ===
// ============================================================
app.get('/shorten', (req, res) => {
  res.send(renderPage('Link Shortener', `
    <div style="max-width:600px;margin:0 auto;padding:40px 20px;text-align:center">
      <h1 style="font-size:2em;margin-bottom:8px">🔗 Link Shortener</h1>
      <p style="color:#64748b;margin-bottom:32px">Create short, trackable links for sharing anywhere</p>
      <form method="POST" action="/shorten" style="display:flex;flex-direction:column;gap:12px;text-align:left">
        <input type="url" name="url" placeholder="Paste your long URL here..." required
          style="padding:16px;border:2px solid #e2e8f0;border-radius:12px;font-size:16px;outline:none">
        <input type="text" name="title" placeholder="Title (optional)" maxlength="100"
          style="padding:12px;border:2px solid #e2e8f0;border-radius:12px;outline:none">
        <input type="text" name="custom_code" placeholder="Custom code (optional, e.g. my-link)" maxlength="20"
          pattern="[a-zA-Z0-9_-]+" style="padding:12px;border:2px solid #e2e8f0;border-radius:12px;outline:none">
        <button type="submit" class="btn" style="padding:14px;font-size:16px;border-radius:12px">Shorten Link</button>
      </form>
      <div style="margin-top:32px;padding:20px;background:#f8fafc;border-radius:12px;text-align:left">
        <h3 style="margin-bottom:8px">✨ Features</h3>
        <ul style="color:#475569;line-height:2">
          <li>Instant short links — share anywhere</li>
          <li>Click tracking with country & referrer data</li>
          <li>UTM parameters auto-appended</li>
          <li>QR code included for every link</li>
          <li>Optional expiration dates</li>
        </ul>
      </div>
    </div>`, req.session.user));
});

app.post('/shorten', (req, res, next) => { if (!req.session || !req.session.user) return res.status(401).send('Login required to create short links'); next(); }, ah(async (req, res) => {
  const { url, title, custom_code } = req.body;
  if (!url) return res.redirect('/shorten');
  let code = custom_code ? custom_code.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 20) : null;
  if (!code) code = require('crypto').randomBytes(3).toString('base64url');
  try {
    await pool.query('INSERT INTO short_links(code, original_url, title, created_by) VALUES($1,$2,$3,$4)', [code, url, title, req.session.user?.email || 'anonymous']);
  } catch(e) {
    if (e.code === '23505') code = require('crypto').randomBytes(4).toString('base64url');
    else return res.redirect('/shorten');
  }
  const shortUrl = BASE_URL + '/s/' + code;
  res.send(renderPage('Link Created!', `
    <div style="max-width:500px;margin:0 auto;padding:60px 20px;text-align:center">
      <div style="font-size:4em;margin-bottom:16px">✅</div>
      <h1 style="margin-bottom:8px">Link Shortened!</h1>
      <div style="padding:20px;background:#f1f5f9;border-radius:12px;margin:24px 0">
        <div style="font-size:1.4em;font-weight:700;color:#4f46e5;word-break:break-all">${esc(shortUrl)}</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button onclick="navigator.clipboard.writeText('${shortUrl}');this.textContent='Copied!'" class="btn">Copy Link</button>
        <a href="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shortUrl)}" target="_blank" class="btn" style="background:#059669">Get QR Code</a>
        <a href="https://wa.me/?text=${encodeURIComponent(shortUrl)}" target="_blank" class="btn" style="background:#25d366;color:white">Share WhatsApp</a>
        <a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(shortUrl)}" target="_blank" class="btn" style="background:#1da1f2;color:white">Share Twitter</a>
      </div>
      <p style="margin-top:24px"><a href="/shorten" class="btn" style="background:transparent;color:#4f46e5;border:2px solid #4f46e5">Create Another</a></p>
    </div>`, req.session.user));
}));

// Redirect handler
app.get('/s/:code', ah(async (req, res) => {
  const link = (await pool.query('SELECT * FROM short_links WHERE code=$1 AND is_active=true', [req.params.code])).rows[0];
  if (!link) return res.redirect('/404');
  await pool.query('UPDATE short_links SET clicks=clicks+1 WHERE id=$1', [link.id]);
  await pool.query('INSERT INTO short_link_clicks(link_id, ip_address, referrer, user_agent) VALUES($1,$2,$3,$4)',
    [link.id, req.ip, req.headers.referer || 'Direct', req.headers['user-agent']]);
  let redirectUrl = link.original_url;
  if (link.utm_source) {
    const sep = redirectUrl.includes('?') ? '&' : '?';
    redirectUrl += sep + 'utm_source=' + link.utm_source + '&utm_medium=' + (link.utm_medium || 'shortlink');
  }
  // Validate URL: only allow http/https, block javascript: and data: URLs
  try {
    const parsed = new URL(redirectUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).send('Invalid redirect URL');
    }
  } catch (e) {
    return res.status(400).send('Invalid redirect URL');
  }
  res.redirect(redirectUrl);
}));

// ============================================================
// === 3. QR CODE GENERATOR — Free QR For Any URL ===
// ============================================================
app.get('/qr', (req, res) => {
  const url = req.query.url || '';
  res.send(renderPage('QR Code Generator', `
    <div style="max-width:500px;margin:0 auto;padding:40px 20px;text-align:center">
      <h1 style="font-size:2em;margin-bottom:8px">📱 QR Code Generator</h1>
      <p style="color:#64748b;margin-bottom:24px">Generate QR codes for any URL — free & instant</p>
      <form method="GET" action="/qr" style="display:flex;gap:8px;margin-bottom:32px">
        <input type="url" name="url" value="${esc(url)}" placeholder="Enter any URL..." required
          style="flex:1;padding:14px;border:2px solid #e2e8f0;border-radius:12px;font-size:16px;outline:none">
        <button type="submit" class="btn" style="border-radius:12px">Generate</button>
      </form>
      ${url ? `
        <div style="padding:24px;background:white;border:2px solid #e2e8f0;border-radius:16px;display:inline-block">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(url)}&color=4f46e5"
            alt="QR Code" style="border-radius:8px">
          <p style="margin-top:12px;color:#64748b;font-size:14px;word-break:break-all">${esc(url)}</p>
        </div>
        <div style="margin-top:16px;display:flex;gap:8px;justify-content:center">
          <a href="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(url)}&color=4f46e5&format=svg&download=1"
            download class="btn" style="background:#059669">Download SVG</a>
          <a href="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(url)}&color=4f46e5&format=png&download=1"
            download class="btn" style="background:#4f46e5">Download PNG</a>
        </div>
      ` : ''}
      <div style="margin-top:32px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));display:grid;gap:12px">
        ${[{label:'Schools',url:'/register?type=school'},{label:'Churches',url:'/register?type=church'},{label:'Businesses',url:'/register?type=business'},{label:'Health',url:'/register?type=health'}].map(item => `
          <a href="/qr?url=${encodeURIComponent(BASE_URL + item.url)}" style="padding:12px;background:#f1f5f9;border-radius:10px;text-decoration:none;color:#1e293b;font-weight:600">${item.label}</a>
        `).join('')}
      </div>
    </div>`, req.session.user));
});

// ============================================================
// === 4. LIVE GLOBAL CHAT — Real-Time Discussion Rooms ===
// ============================================================
app.get('/chat', ah(async (req, res) => {
  const rooms = (await pool.query(`SELECT r.*, (SELECT COUNT(*) FROM chat_messages WHERE room_id=r.id) as message_count,
    (SELECT MAX(created_at) FROM chat_messages WHERE room_id=r.id) as last_activity
    FROM chat_rooms r WHERE r.is_active=true ORDER BY message_count DESC`)).rows;

  res.send(renderPage('Live Chat', `
    <div style="max-width:900px;margin:0 auto;padding:20px">
      <h1 style="text-align:center;margin-bottom:4px">💬 Global Chat Rooms</h1>
      <p style="text-align:center;color:#64748b;margin-bottom:24px">Join conversations with people from around the world</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px">
        ${rooms.map(r => `
          <a href="/chat/${r.id}" style="display:block;padding:20px;border:2px solid #e2e8f0;border-radius:16px;text-decoration:none;transition:all 0.2s"
            onmouseover="this.style.borderColor='#4f46e5';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='#e2e8f0';this.style.transform='none'">
            <h3 style="color:#1e293b;margin-bottom:4px">${esc(r.name)}</h3>
            <p style="color:#64748b;font-size:14px;margin-bottom:8px">${esc(r.description || '')}</p>
            <div style="display:flex;gap:16px;font-size:13px;color:#94a3b8">
              <span>${r.message_count || 0} messages</span>
              <span style="text-transform:capitalize">${esc(r.category || 'general')}</span>
            </div>
          </a>
        `).join('')}
        ${rooms.length === 0 ? '<p style="color:#94a3b8;grid-column:1/-1;text-align:center;padding:40px">No chat rooms yet. They will be created automatically!</p>' : ''}
      </div>
      <div style="margin-top:32px;padding:20px;background:#f8fafc;border-radius:12px">
        <h3>🌐 Chat Guidelines</h3>
        <ul style="color:#475569;line-height:2">
          <li>Be respectful and constructive</li>
          <li>No spam, links to malicious sites, or inappropriate content</li>
          <li>Help others — share knowledge freely</li>
          <li>Use the room that matches your topic</li>
        </ul>
      </div>
    </div>`, req.session.user));
}));

app.get('/chat/:roomId', ah(async (req, res) => {
  const room = (await pool.query('SELECT * FROM chat_rooms WHERE id=$1 AND is_active=true', [req.params.roomId])).rows[0];
  if (!room) return res.redirect('/chat');
  const messages = (await pool.query('SELECT * FROM chat_messages WHERE room_id=$1 ORDER BY created_at DESC LIMIT 100', [room.id])).rows.reverse();
  const username = req.session.user ? (req.session.user.name || req.session.user.email.split('@')[0]) : 'Guest_' + Math.random().toString(36).substring(2,6);

  res.send(renderPage('Chat: ' + room.name, `
    <div style="max-width:800px;margin:0 auto;padding:20px;display:flex;flex-direction:column;height:calc(100vh - 100px)">
      <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:2px solid #e2e8f0">
        <div>
          <a href="/chat" style="color:#4f46e5;text-decoration:none">&larr; Back</a>
          <h2 style="margin:4px 0">${esc(room.name)}</h2>
        </div>
        <span style="color:#94a3b8;font-size:14px" id="online-count">💬 ${messages.length} messages</span>
      </div>
      <div id="messages" style="flex:1;overflow-y:auto;padding:16px 0;display:flex;flex-direction:column;gap:8px">
        ${messages.map(m => {
          const isMe = m.user_email === req.session.user?.email;
          return `<div style="display:flex;${isMe?'flex-direction:row-reverse':''};gap:8px">
            <div style="max-width:70%;padding:10px 14px;border-radius:12px;${isMe?'background:#4f46e5;color:white':'background:#f1f5f9;color:#1e293b'}">
              <div style="font-size:12px;font-weight:600;opacity:0.7;margin-bottom:2px">${esc(m.username)}</div>
              <div>${esc(m.message)}</div>
              <div style="font-size:11px;opacity:0.5;margin-top:4px">${new Date(m.created_at).toLocaleTimeString()}</div>
            </div>
          </div>`;
        }).join('')}
      </div>
      <form id="chat-form" style="display:flex;gap:8px;padding-top:12px;border-top:2px solid #e2e8f0">
        <input type="text" id="msg-input" placeholder="Type a message..." autocomplete="off"
          style="flex:1;padding:14px;border:2px solid #e2e8f0;border-radius:12px;font-size:16px;outline:none" required>
        <button type="submit" class="btn" style="padding:14px 24px;border-radius:12px">Send</button>
      </form>
      <input type="hidden" id="room-id" value="${room.id}">
      <input type="hidden" id="username" value="${esc(username)}">
      <input type="hidden" id="user-email" value="${req.session.user?.email || ''}">
    </div>
    <script>
      const form = document.getElementById('chat-form');
      const input = document.getElementById('msg-input');
      const container = document.getElementById('messages');
      const roomId = document.getElementById('room-id').value;
      const username = document.getElementById('username').value;
      const userEmail = document.getElementById('user-email').value;

      form.onsubmit = async (e) => {
        e.preventDefault();
        const msg = input.value.trim();
        if (!msg) return;
        input.value = '';
        // Optimistic render
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;flex-direction:row-reverse;gap:8px';
        div.innerHTML = '<div style="max-width:70%;padding:10px 14px;border-radius:12px;background:#4f46e5;color:white"><div style="font-size:12px;font-weight:600;opacity:0.7;margin-bottom:2px">'+username+'</div><div>'+msg.replace(/</g,'&lt;')+'</div><div style="font-size:11px;opacity:0.5;margin-top:4px">just now</div></div>';
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        try {
          await fetch('/chat/'+roomId+'/send', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,username:username,email:userEmail})});
        } catch(err) {}
      };
      container.scrollTop = container.scrollHeight;

      // Poll for new messages every 3s
      let lastId = ${messages.length > 0 ? messages[messages.length-1].id : 0};
      setInterval(async () => {
        try {
          const r = await fetch('/chat/'+roomId+'/messages?after='+lastId);
          const data = await r.json();
          data.forEach(m => {
            const isMe = m.user_email === userEmail;
            const div = document.createElement('div');
            div.style.cssText = 'display:flex;'+(isMe?'flex-direction:row-reverse;':'')+'gap:8px';
            div.innerHTML = '<div style="max-width:70%;padding:10px 14px;border-radius:12px;'+(isMe?'background:#4f46e5;color:white':'background:#f1f5f9;color:#1e293b')+'"><div style="font-size:12px;font-weight:600;opacity:0.7;margin-bottom:2px">'+(m.username||'Guest')+'</div><div>'+(m.message||'').replace(/</g,'&lt;')+'</div><div style="font-size:11px;opacity:0.5;margin-top:4px">'+new Date(m.created_at).toLocaleTimeString()+'</div></div>';
            container.appendChild(div);
            lastId = m.id;
          });
          container.scrollTop = container.scrollHeight;
        } catch(e) {}
      }, 3000);
    </script>`, req.session.user));
}));

app.post('/chat/:roomId/send', (req, res, next) => { if (!req.session || !req.session.user) return res.status(401).json({error:'Login required to send messages'}); next(); }, ah(async (req, res) => {
  const { message, username, email } = req.body;
  if (!message || !message.trim()) return res.json({error:'Empty message'});
  const room = (await pool.query('SELECT id FROM chat_rooms WHERE id=$1 AND is_active=true', [req.params.roomId])).rows[0];
  if (!room) return res.json({error:'Room not found'});
  const result = (await pool.query('INSERT INTO chat_messages(room_id, user_email, username, message) VALUES($1,$2,$3,$4) RETURNING *',
    [room.id, email || null, (username || 'Guest').substring(0, 50), message.trim().substring(0, 2000)])).rows[0];
  await pool.query("UPDATE chat_rooms SET members_count=(SELECT COUNT(DISTINCT user_email) FROM chat_messages WHERE room_id=$1 AND created_at > NOW() - interval '1 hour') WHERE id=$1", [room.id]);
  res.json(result);
}));

app.get('/chat/:roomId/messages', ah(async (req, res) => {
  const afterId = parseInt(req.query.after) || 0;
  const msgs = (await pool.query('SELECT * FROM chat_messages WHERE room_id=$1 AND id > $2 ORDER BY id ASC LIMIT 50', [req.params.roomId, afterId])).rows;
  res.json(msgs);
}));

// ============================================================
// === 5. EMBEDDABLE WIDGETS — Let Anyone Embed Our Content ===
// ============================================================
app.get('/embed/poll/:id', ah(async (req, res) => {
  const poll = (await pool.query('SELECT * FROM polls WHERE id=$1 AND is_active=true', [req.params.id])).rows[0];
  if (!poll) return res.status(404).send('Poll not found');
  const options = (await pool.query('SELECT * FROM poll_options WHERE poll_id=$1 ORDER BY id', [poll.id])).rows;
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#fff;padding:16px;border-radius:12px}
    h3{margin-bottom:12px;font-size:16px}button{width:100%;padding:10px;margin:4px 0;border:2px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer;font-size:14px;text-align:left;transition:all 0.2s}
    button:hover{border-color:#4f46e5;background:#f8fafc}.bar{height:6px;border-radius:3px;background:#4f46e5;margin-top:4px;transition:width 0.5s}
    .credit{text-align:center;margin-top:12px;font-size:11px;color:#94a3b8}a{color:#4f46e5;text-decoration:none}</style></head>
    <body><h3>${esc(poll.question)}</h3><div id="options">${options.map(o => '<button data-id="'+o.id+'">'+esc(o.option_text)+'</button>').join('')}</div>
    <div id="results" style="display:none">${options.map(o => '<div style="margin:8px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><span>'+esc(o.option_text)+'</span><span class="pct">0%</span></div><div style="background:#f1f5f9;border-radius:3px;height:6px"><div class="bar" style="width:0%"></div></div></div>').join('')}</div>
    <div class="credit">Powered by <a href="${BASE_URL}" target="_blank">Comfort Zone</a></div>
    <script>
    document.querySelectorAll('#options button').forEach(btn=>{
      btn.onclick=async()=>{
        const id=btn.dataset.id;
        try{const r=await fetch('${BASE_URL}/api/polls/vote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({option_id:id,poll_id:${poll.id}})});
        const data=await r.json();
        if(data.results){document.getElementById('options').style.display='none';document.getElementById('results').style.display='block';
        const total=data.results.reduce((s,r)=>s+r.count,0);
        document.querySelectorAll('#results > div').forEach((div,i)=>{if(data.results[i]){const pct=total>0?Math.round(data.results[i].count/total*100):0;div.querySelector('.pct').textContent=pct+'%';div.querySelector('.bar').style.width=pct+'%'}});}}
        catch(e){alert('Already voted!');}};});</script></body></html>`);
}));

app.get('/embed/quiz/:id', ah(async (req, res) => {
  const quiz = (await pool.query('SELECT * FROM quizzes WHERE id=$1 AND is_published=true', [req.params.id])).rows[0];
  if (!quiz) return res.status(404).send('Quiz not found');
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#fff;padding:16px;border-radius:12px}
    h3{margin-bottom:12px}.q-card{border:2px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px;display:none}
    .q-card.active{display:block}button{padding:10px 20px;border:none;border-radius:8px;cursor:pointer;font-size:14px}
    .btn-primary{background:#4f46e5;color:white}.btn-option{width:100%;margin:4px 0;background:#f8fafc;border:2px solid #e2e8f0;text-align:left}
    .btn-option:hover{border-color:#4f46e5}.score{text-align:center;font-size:2em;padding:24px}
    .credit{text-align:center;margin-top:12px;font-size:11px;color:#94a3b8}a{color:#4f46e5;text-decoration:none}</style></head>
    <body><h3>${esc(quiz.title)}</h3><p style="color:#64748b;margin-bottom:16px">${esc(quiz.description||'')}</p><div id="quiz-area"></div><div id="score" class="score" style="display:none"></div>
    <div class="credit">Powered by <a href="${BASE_URL}" target="_blank">Comfort Zone</a></div>
    <script>
    fetch('${BASE_URL}/quizzes/${quiz.id}').then(r=>r.text()).then(html=>{
      const parser=new DOMParser();const doc=parser.parseFromString(html,'text/html');
      const questions=[...doc.querySelectorAll('[data-question]')];
      const area=document.getElementById('quiz-area');
      questions.forEach((q,i)=>{
        const card=document.createElement('div');card.className='q-card'+(i===0?' active':'');
        card.dataset.question=q.dataset.question;
        card.innerHTML='<p style="font-weight:600;margin-bottom:8px">'+q.querySelector('b')?.textContent+'</p>';
        q.querySelectorAll('label').forEach(label=>{const btn=document.createElement('button');btn.className='btn-option';btn.textContent=label.textContent.trim();btn.onclick=()=>{card.querySelectorAll('.btn-option').forEach(b=>b.style.borderColor='#e2e8f0');btn.style.borderColor='#4f46e5';btn.dataset.selected='true'};card.appendChild(btn)});
        const next=document.createElement('button');next.className='btn-primary';next.style.marginTop='8px';next.textContent=i<questions.length-1?'Next':'See Results';
        next.onclick=()=>{area.querySelectorAll('.q-card').forEach(c=>c.classList.remove('active'));if(i<questions.length-1)card.nextElementSibling?.classList.add('active')};
        card.appendChild(next);area.appendChild(card)});}).catch(e=>{document.getElementById('quiz-area').innerHTML='<p>Failed to load quiz. <a href="${BASE_URL}/quizzes/${quiz.id}">Take it here</a></p>';});
    </script></body></html>`);
}));

// ============================================================
// === 6. REFERRAL CONTESTS — Monthly Viral Competitions ===
// ============================================================
app.get('/contests', ah(async (req, res) => {
  const contests = (await pool.query('SELECT * FROM referral_contests ORDER BY start_date DESC LIMIT 10')).rows;
  const leaderboard = contests.length > 0 ? (await pool.query(
    'SELECT r.referrer_email as email, COUNT(*) as referrals FROM referrals r JOIN referral_contests rc ON r.created_at BETWEEN rc.start_date AND COALESCE(rc.end_date, NOW()) GROUP BY r.referrer_email ORDER BY referrals DESC LIMIT 20'
  )).rows : [];

  res.send(renderPage('Referral Contests', `
    <div style="max-width:800px;margin:0 auto;padding:20px">
      <div style="text-align:center;margin-bottom:32px">
        <h1 style="font-size:2em">🏆 Referral Contests</h1>
        <p style="color:#64748b;margin-top:8px">Invite friends and win prizes every month!</p>
        ${req.session.user ? '<a href="/dashboard" class="btn" style="margin-top:16px;background:#4f46e5">Get Your Referral Link</a>' : '<a href="/register" class="btn" style="margin-top:16px;background:#4f46e5">Sign Up to Participate</a>'}
      </div>

      <div style="display:grid;gap:16px">
        ${contests.map(c => `
          <div style="padding:20px;border:2px solid ${c.status==='active'?'#059669':'#e2e8f0'};border-radius:16px">
            <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:8px">
              <h3>${esc(c.title)}</h3>
              <span style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;text-transform:uppercase;background:${c.status==='active'?'#d1fae5;color:#059669':'#f1f5f9;color:#64748b'}">${c.status}</span>
            </div>
            <p style="color:#64748b;margin:8px 0">${esc(c.description || '')}</p>
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px">
              ${c.start_date ? '<span style="font-size:13px;color:#94a3b8">📅 Starts: '+c.start_date+'</span>' : ''}
              ${c.end_date ? '<span style="font-size:13px;color:#94a3b8">📅 Ends: '+c.end_date+'</span>' : ''}
              ${c.prize ? '<span style="font-size:13px;font-weight:600;color:#059669">🎁 Prize: '+esc(c.prize)+'</span>' : ''}
            </div>
          </div>
        `).join('')}
      </div>

      ${leaderboard.length > 0 ? `
        <div style="margin-top:32px">
          <h2 style="margin-bottom:16px">🏅 Top Referrers</h2>
          <div style="display:grid;gap:8px">
            ${leaderboard.map((l,i) => `
              <div style="display:flex;align-items:center;gap:12px;padding:12px;background:${i<3?'#fffbeb;border:1px solid #f59e0b':'#f8fafc'};border-radius:10px">
                <span style="font-size:1.5em">${i<3?'🥇🥈🥉'[i]:'#'+(i+1)}</span>
                <span style="flex:1;font-weight:600">${esc(l.email.split('@')[0])}</span>
                <span style="color:#4f46e5;font-weight:700">${l.referrals} referrals</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>`, req.session.user));
}));

// ============================================================
// === 7. TRENDING TOPICS — What's Hot Right Now ===
// ============================================================
app.get('/trending', ah(async (req, res) => {
  const topics = (await pool.query('SELECT * FROM trending_topics ORDER BY mention_count DESC LIMIT 30')).rows;

  res.send(renderPage('Trending Topics', `
    <div style="max-width:800px;margin:0 auto;padding:20px">
      <h1 style="text-align:center;margin-bottom:4px">🔥 Trending Topics</h1>
      <p style="text-align:center;color:#64748b;margin-bottom:24px">What people are searching for right now</p>
      <div style="display:grid;gap:8px">
        ${topics.map((t,i) => `
          <a href="/search?q=${encodeURIComponent(t.tag)}" style="display:flex;align-items:center;gap:16px;padding:14px 16px;border:1px solid #e2e8f0;border-radius:12px;text-decoration:none;transition:all 0.2s"
            onmouseover="this.style.borderColor='#4f46e5'" onmouseout="this.style.borderColor='#e2e8f0'">
            <span style="font-size:1.3em;color:#94a3b8;font-weight:700;min-width:32px">${i+1}</span>
            <div style="flex:1">
              <span style="font-weight:600;color:#1e293b">${esc(t.tag)}</span>
              <span style="color:#94a3b8;font-size:13px;margin-left:8px">${t.mention_count} searches</span>
            </div>
            <span style="padding:4px 8px;background:#f1f5f9;border-radius:4px;font-size:12px;color:#64748b;text-transform:capitalize">${esc(t.category || 'general')}</span>
          </a>
        `).join('')}
        ${topics.length === 0 ? '<p style="text-align:center;color:#94a3b8;padding:40px">No trending topics yet. Start searching!</p>' : ''}
      </div>
    </div>`, req.session.user));
}));

// ============================================================
// === 8. UGC GALLERY — User-Generated Content Wall ===
// ============================================================
app.get('/gallery', ah(async (req, res) => {
  const cat = req.query.cat || 'all';
  const items = cat === 'all'
    ? (await pool.query('SELECT * FROM ugc_gallery WHERE is_approved=true ORDER BY is_featured DESC, upvotes DESC LIMIT 60')).rows
    : (await pool.query('SELECT * FROM ugc_gallery WHERE is_approved=true AND category=$1 ORDER BY is_featured DESC, upvotes DESC LIMIT 60', [cat])).rows;

  const categories = (await pool.query('SELECT DISTINCT category FROM ugc_gallery WHERE is_approved=true')).rows.map(r => r.category);

  res.send(renderPage('Community Gallery', `
    <div style="max-width:1000px;margin:0 auto;padding:20px">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="font-size:2em">📸 Community Gallery</h1>
        <p style="color:#64748b;margin-top:4px">Photos, stories, and moments from our community</p>
        ${req.session.user ? '<a href="/gallery/submit" class="btn" style="margin-top:12px;background:#4f46e5">Submit Your Content</a>' : ''}
      </div>
      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;justify-content:center">
        <a href="/gallery" class="btn ${cat==='all'?'':'btn-sm'}" style="${cat==='all'?'background:#4f46e5':''};padding:8px 16px;border-radius:20px;font-size:14px">All</a>
        ${categories.map(c => '<a href="/gallery?cat='+encodeURIComponent(c)+'" style="padding:8px 16px;background:#f1f5f9;border-radius:20px;text-decoration:none;color:#475569;font-size:14px;cursor:pointer">'+esc(c)+'</a>').join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
        ${items.map(item => `
          <div style="border:2px solid ${item.is_featured?'#f59e0b':'#e2e8f0'};border-radius:16px;overflow:hidden;transition:transform 0.2s"
            onmouseover="this.style.transform='translateY(-4px)'" onmouseout="this.style.transform='none'">
            ${item.image_url ? '<img src="'+esc(item.image_url)+'" alt="'+esc(item.title)+'" style="width:100%;height:200px;object-fit:cover">' : '<div style="height:200px;background:linear-gradient(135deg,#4f46e5,#7c3aed);display:flex;align-items:center;justify-content:center;color:white;font-size:3em">📷</div>'}
            <div style="padding:16px">
              <h3 style="margin-bottom:4px">${esc(item.title)}</h3>
              <p style="color:#64748b;font-size:14px;margin-bottom:8px">${esc(item.description || '').substring(0,100)}</p>
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:13px;color:#94a3b8">by ${esc((item.submitted_by||'anonymous').split('@')[0])}</span>
                <span style="color:#4f46e5;font-weight:600">▲ ${item.upvotes}</span>
              </div>
            </div>
          </div>
        `).join('')}
        ${items.length === 0 ? '<p style="text-align:center;color:#94a3b8;grid-column:1/-1;padding:40px">No gallery items yet. Be the first to submit!</p>' : ''}
      </div>
    </div>`, req.session.user));
}));

app.get('/gallery/submit', requireAuth, (req, res) => {
  res.send(renderPage('Submit to Gallery', `
    <div style="max-width:600px;margin:0 auto;padding:40px 20px">
      <h1 style="margin-bottom:24px">📸 Submit to Community Gallery</h1>
      <form method="POST" action="/gallery/submit" enctype="multipart/form-data" style="display:flex;flex-direction:column;gap:12px">
        <input type="text" name="title" placeholder="Title" required maxlength="100" style="padding:14px;border:2px solid #e2e8f0;border-radius:12px;outline:none">
        <textarea name="description" placeholder="Description" rows="3" maxlength="500" style="padding:14px;border:2px solid #e2e8f0;border-radius:12px;outline:none;resize:vertical"></textarea>
        <input type="url" name="image_url" placeholder="Image URL (direct link)" style="padding:14px;border:2px solid #e2e8f0;border-radius:12px;outline:none">
        <select name="category" style="padding:14px;border:2px solid #e2e8f0;border-radius:12px;outline:none">
          <option value="general">General</option><option value="school">School Life</option><option value="event">Events</option>
          <option value="achievement">Achievements</option><option value="community">Community</option><option value="culture">Culture</option>
          <option value="sports">Sports</option><option value="business">Business</option>
        </select>
        <button type="submit" class="btn" style="padding:14px;border-radius:12px;font-size:16px">Submit for Review</button>
      </form>
      <p style="margin-top:16px;color:#64748b;font-size:14px">Submissions are reviewed before appearing publicly.</p>
    </div>`, req.session.user));
});

app.post('/gallery/submit', requireAuth, ah(async (req, res) => {
  const { title, description, image_url, category } = req.body;
  if (!title) return res.redirect('/gallery/submit');
  await pool.query('INSERT INTO ugc_gallery(title, description, image_url, category, submitted_by) VALUES($1,$2,$3,$4,$5)',
    [title, description || '', image_url || '', category || 'general', req.session.user.email]);
  res.send(renderPage('Submitted!', `
    <div style="max-width:500px;margin:0 auto;padding:60px 20px;text-align:center">
      <div style="font-size:4em;margin-bottom:16px">🎉</div>
      <h1>Thank You!</h1>
      <p style="color:#64748b;margin:16px 0">Your submission is being reviewed. Once approved, it will appear in the <a href="/gallery" style="color:#4f46e5">Community Gallery</a>.</p>
      <a href="/gallery" class="btn">View Gallery</a>
    </div>`, req.session.user));
}));

// ============================================================
// === 9. BADGE / SHIELD SYSTEM — "Powered by" Embeds ===
// ============================================================
app.get('/badge', (req, res) => {
  const style = req.query.style || 'light';
  const name = req.query.name || 'Comfort Zone';
  res.send(renderPage('Get Your Badge', `
    <div style="max-width:600px;margin:0 auto;padding:40px 20px;text-align:center">
      <h1 style="font-size:2em;margin-bottom:8px">🏷️ Comfort Zone Badge</h1>
      <p style="color:#64748b;margin-bottom:32px">Show the world you use Comfort Zone — embed our badge on your website</p>

      <div style="margin-bottom:32px">
        <p style="font-weight:600;margin-bottom:12px">Preview:</p>
        ${[
          {label:'Light',bg:'#fff',color:'#1e293b',border:'#e2e8f0'},
          {label:'Dark',bg:'#1e293b',color:'#fff',border:'#374151'},
          {label:'Color',bg:'#4f46e5',color:'#fff',border:'#4f46e5'}
        ].map(s => `
          <div style="display:inline-block;margin:8px;padding:8px 4px;background:${s.bg};border:2px solid ${s.border};border-radius:8px">
            <a href="${BASE_URL}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:${s.color};font-size:14px;font-weight:600;font-family:system-ui,sans-serif">
              <span style="font-size:18px">✅</span>
              <span>Powered by ${esc(name)}</span>
            </a>
          </div>
        `).join('')}
      </div>

      <div style="text-align:left;padding:20px;background:#f8fafc;border-radius:12px">
        <h3 style="margin-bottom:12px">Copy the HTML code:</h3>
        <pre style="background:#1e293b;color:#e2e8f0;padding:16px;border-radius:8px;overflow-x:auto;font-size:13px;line-height:1.6">&lt;a href="${BASE_URL}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:#1e293b;font-size:14px;font-weight:600;font-family:system-ui,sans-serif;padding:8px 16px;border:2px solid #e2e8f0;border-radius:8px"&gt;
  &lt;span style="font-size:18px"&gt;✅&lt;/span&gt;
  &lt;span&gt;Powered by ${esc(name)}&lt;/span&gt;
&lt;/a&gt;</pre>
      </div>

      <div style="margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <a href="/register" class="btn" style="background:#4f46e5">Sign Up Free</a>
        <a href="/features" class="btn">View Features</a>
      </div>
    </div>`, req.session.user));
});

// ============================================================
// === 10. SOCIAL SHARE API — Unified Share Tracking ===
// ============================================================
app.post('/api/share', ah(async (req, res) => {
  const { content_type, content_id, platform, share_url } = req.body;
  if (!platform || !share_url) return res.json({error:'Missing fields'});
  await pool.query('INSERT INTO social_shares(content_type, content_id, platform, share_url, ip_address) VALUES($1,$2,$3,$4,$5)',
    [content_type || null, content_id || null, platform.substring(0, 30), share_url, req.ip]);
  await trackRevenue('social_share', 0.001, 'Share on ' + platform, content_id);
  res.json({ok:true});
}));

// ============================================================
// === 11. PUSH NOTIFICATION OPT-IN (For Visitors) ===
// ============================================================
app.post('/api/push/subscribe', ah(async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint) return res.json({error:'Missing endpoint'});
  try {
    await pool.query('INSERT INTO public_push_subscriptions(endpoint, p256dh_key, auth_key, ip_address) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [endpoint, keys?.p256dh || null, keys?.auth || null, req.ip]);
    res.json({ok:true, message:'Subscribed!'});
  } catch(e) {
    res.json({ok:true});
  }
}));

// ============================================================
// === 12. TRANSLATE HELPER — Multi-Language Support ===
// ============================================================
app.get('/translate', (req, res) => {
  res.send(renderPage('Language', `
    <div style="max-width:500px;margin:0 auto;padding:60px 20px;text-align:center">
      <h1 style="font-size:2em;margin-bottom:16px">🌐 Choose Language</h1>
      <p style="color:#64748b;margin-bottom:32px">Select your preferred language</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:400px;margin:0 auto">
        ${[
          {code:'en',label:'English',flag:'🇬🇧'},{code:'sw',label:'Swahili',flag:'🇹🇿'},
          {code:'fr',label:'French',flag:'🇫🇷'},{code:'ar',label:'Arabic',flag:'🇸🇦'},
          {code:'lg',label:'Luganda',flag:'🇺🇬'},{code:'ny',label:'Chichewa',flag:'🇲🇼'},
          {code:'am',label:'Amharic',flag:'🇪🇹'},{code:'ha',label:'Hausa',flag:'🇳🇬'}
        ].map(l => `
          <a href="#" onclick="document.cookie='lang=${l.code};path=/;max-age=31536000';location.reload();return false"
            style="display:flex;align-items:center;gap:12px;padding:16px;border:2px solid #e2e8f0;border-radius:12px;text-decoration:none;transition:all 0.2s"
            onmouseover="this.style.borderColor='#4f46e5'" onmouseout="this.style.borderColor='#e2e8f0'">
            <span style="font-size:2em">${l.flag}</span>
            <span style="font-weight:600;color:#1e293b">${l.label}</span>
          </a>
        `).join('')}
      </div>
      <p style="margin-top:24px;color:#94a3b8;font-size:14px">Note: Full translations are coming soon. Selecting a language saves your preference.</p>
    </div>`, req.session.user));
});

// ============================================================
// === SEED DATA ===
// ============================================================
async function seedGlobalViralData() {
  // Chat rooms
  const rooms = [
    ['General Chat', 'Talk about anything — meet new people from around the world', 'general'],
    ['Education', 'School management, learning tips, exams, scholarships', 'education'],
    ['Business', 'Entrepreneurship, marketing, finance, growing your business', 'business'],
    ['Technology', 'Tech news, coding, apps, internet, gadgets', 'technology'],
    ['Health', 'Health tips, wellness, clinic management, mental health', 'health'],
    ['Faith & Church', 'Church management, faith discussions, events', 'faith'],
    ['Jobs & Careers', 'Job hunting, career advice, CV tips, interviews', 'careers'],
    ['Uganda', 'Local news, events, culture, and community in Uganda', 'uganda']
  ];
  for (const [name, desc, cat] of rooms) {
    await pool.query('INSERT INTO chat_rooms(name, description, category) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [name, desc, cat]).catch(() => {});
  }

  // Referral contests
  const contests = [
    ['May 2026 Referral Blitz', 'Invite 10 friends and win 1 month free Pro plan!', '2026-05-01', '2026-05-31', '1 Month Free Pro Plan', 150000],
    ['June 2026 Growth Challenge', 'Top 3 referrers get premium badges + featured listing', '2026-06-01', '2026-06-30', 'Premium Badge + Featured Listing', 100000]
  ];
  for (const [title, desc, start, end, prize, value] of contests) {
    await pool.query('INSERT INTO referral_contests(title, description, start_date, end_date, prize, prize_value) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [title, desc, start, end, prize, value]).catch(() => {});
  }

  // Trending seed
  const trendingTags = ['school management', 'Comfort Zone', 'fees payment', 'online exams', 'attendance tracking', 'report cards', 'Uganda schools', 'church management', 'business tools', 'free software'];
  for (const tag of trendingTags) {
    await pool.query('INSERT INTO trending_topics(tag, mention_count) VALUES($1,0) ON CONFLICT DO NOTHING', [tag]).catch(() => {});
  }

  // UGC gallery seeds
  const galleryItems = [
    ['School Graduation Day', 'Beautiful moments from our annual graduation ceremony', 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=600', 'school', 'admin@comfort.zone', true, true],
    ['Community Sports Day', 'Annual inter-school sports competition', 'https://images.unsplash.com/photo-1461896836934-bd45ba8c7e62?w=600', 'sports', 'admin@comfort.zone', true, false],
    ['Church Worship Night', 'An amazing night of praise and worship', 'https://images.unsplash.com/photo-1438232992991-995b7058bbb3?w=600', 'culture', 'admin@comfort.zone', true, false],
  ];
  for (const [title, desc, img, cat, by, approved, featured] of galleryItems) {
    await pool.query('INSERT INTO ugc_gallery(title, description, image_url, category, submitted_by, is_approved, is_featured) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
      [title, desc, img, cat, by, approved, featured]).catch(() => {});
  }

  console.log('[GlobalViral] Default data seeded: 8 chat rooms, 2 contests, 10 trending topics, 3 gallery items');
}

seedGlobalViralData().catch(e => console.warn('[GlobalViral] Seed error:', e.message));
console.log('[GlobalViral] LOADED: Global Search, Link Shortener, QR Generator, Live Chat (8 rooms), Referral Contests, Trending Topics, UGC Gallery, Badge System, Social Share API, Push Opt-in, Language Picker, Embeddable Widgets');
