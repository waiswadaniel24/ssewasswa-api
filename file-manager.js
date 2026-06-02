// ============================================================
// FILE & DOCUMENT MANAGER MODULE — Comfort Platform
// Google Drive / Dropbox-like file browser with folders, tags,
// sharing, versioning, search, bulk operations, and storage stats.
// ============================================================
// Usage in server.js:
//   const fileManager = require('./file-manager');
//   fileManager(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt);
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
const { migrateQuery } = require('./db');
const CATEGORIES = ['Invoices','Receipts','Contracts','Reports','Policies','Letters','Certificates','Photos','Other'];

function fileIcon(ext) {
  if (!ext) return { icon: '📄', color: '#94a3b8' };
  const e = ext.toLowerCase().replace('.','');
  const map = {
    pdf: { icon: '📕', color: '#ef4444' }, doc: { icon: '📘', color: '#3b82f6' }, docx: { icon: '📘', color: '#3b82f6' },
    xls: { icon: '📗', color: '#22c55e' }, xlsx: { icon: '📗', color: '#22c55e' }, csv: { icon: '📗', color: '#22c55e' },
    ppt: { icon: '📙', color: '#f97316' }, pptx: { icon: '📙', color: '#f97316' },
    jpg: { icon: '🖼️', color: '#a855f7' }, jpeg: { icon: '🖼️', color: '#a855f7' }, png: { icon: '🖼️', color: '#a855f7' },
    gif: { icon: '🖼️', color: '#a855f7' }, svg: { icon: '🖼️', color: '#a855f7' }, webp: { icon: '🖼️', color: '#a855f7' },
    mp4: { icon: '🎬', color: '#ec4899' }, mov: { icon: '🎬', color: '#ec4899' }, avi: { icon: '🎬', color: '#ec4899' },
    mp3: { icon: '🎵', color: '#8b5cf6' }, wav: { icon: '🎵', color: '#8b5cf6' },
    zip: { icon: '📦', color: '#f59e0b' }, rar: { icon: '📦', color: '#f59e0b' }, '7z': { icon: '📦', color: '#f59e0b' },
    txt: { icon: '📝', color: '#64748b' }, rtf: { icon: '📝', color: '#64748b' },
    html: { icon: '🌐', color: '#06b6d4' }, css: { icon: '🌐', color: '#06b6d4' }, js: { icon: '🌐', color: '#06b6d4' },
  };
  return map[e] || { icon: '📄', color: '#94a3b8' };
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function relativeTime(dateStr) {
  if (!dateStr) return '';
  const now = new Date(), d = new Date(dateStr);
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff/86400) + 'd ago';
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:d.getFullYear()!==now.getFullYear()?'numeric':undefined});
}

function categoryBadge(cat) {
  const colors = {Invoices:'#ef4444',Receipts:'#f59e0b',Contracts:'#3b82f6',Reports:'#8b5cf6',Policies:'#06b6d4',Letters:'#ec4899',Certificates:'#22c55e',Photos:'#a855f7',Other:'#64748b'};
  const c = colors[cat] || '#64748b';
  return `<span style="background:${c}18;color:${c};padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600">${esc(cat||'Other')}</span>`;
}

// Shared styles
const FM_CSS = `<style>
.fm-layout{display:grid;grid-template-columns:260px 1fr;gap:16px;max-width:1400px;margin:0 auto}
.fm-sidebar{display:flex;flex-direction:column;gap:12px}
.fm-main{min-width:0}
.fm-sidebar .card{padding:16px}
.fm-breadcrumb{display:flex;align-items:center;gap:6px;font-size:13px;color:#64748b;margin-bottom:12px;flex-wrap:wrap}
.fm-breadcrumb a{color:#4f46e5;text-decoration:none;font-weight:500}
.fm-breadcrumb a:hover{text-decoration:underline}
.fm-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.fm-toolbar input[type=text]{flex:1;min-width:180px;padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px}
.fm-toolbar input[type=text]:focus{outline:none;border-color:#6366f1}
.fm-btn{padding:8px 16px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px;transition:.15s}
.fm-btn:hover{opacity:.9}
.fm-btn-primary{background:#4f46e5;color:#fff}
.fm-btn-secondary{background:#f1f5f9;color:#475569}
.fm-btn-danger{background:#fee2e2;color:#dc2626}
.fm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.fm-grid-item{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;cursor:pointer;transition:.15s;text-decoration:none;color:inherit;display:block}
.fm-grid-item:hover{border-color:#c7d2fe;box-shadow:0 4px 12px rgba(99,102,241,.08);transform:translateY(-1px)}
.fm-grid-icon{font-size:36px;margin-bottom:8px}
.fm-grid-name{font-size:14px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fm-grid-meta{font-size:12px;color:#94a3b8;margin-top:4px}
.fm-list{width:100%;border-collapse:collapse;font-size:13px}
.fm-list th{padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
.fm-list td{padding:10px 12px;border-bottom:1px solid #f1f5f9}
.fm-list tr:hover{background:#f8fafc}
.fm-list input[type=checkbox]{accent-color:#4f46e5;width:16px;height:16px}
.fm-folder-tree{list-style:none;padding:0;margin:0}
.fm-folder-tree li{padding:4px 0}
.fm-folder-tree a{display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:6px;color:#475569;text-decoration:none;font-size:13px;transition:.1s}
.fm-folder-tree a:hover{background:#f1f5f9;color:#1e293b}
.fm-folder-tree a.active{background:#eef2ff;color:#4f46e5;font-weight:600}
.fm-sidebar-label{font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.fm-tag{display:inline-block;background:#f1f5f9;color:#475569;padding:3px 10px;border-radius:20px;font-size:11px;margin:2px;text-decoration:none;transition:.1s}
.fm-tag:hover{background:#eef2ff;color:#4f46e5}
.fm-storage-bar{height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;margin-top:8px}
.fm-storage-fill{height:100%;border-radius:4px;transition:width .3s}
.fm-empty{text-align:center;padding:60px 20px;color:#94a3b8}
.fm-empty-icon{font-size:48px;margin-bottom:12px}
.fm-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:16px}
.fm-stat{text-align:center;padding:14px;background:#fff;border:1px solid #e2e8f0;border-radius:12px}
.fm-stat-val{font-size:24px;font-weight:700;color:#1e293b}
.fm-stat-lbl{font-size:11px;color:#94a3b8;margin-top:2px}
.fm-cat-link{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;text-decoration:none;color:#475569;font-size:13px;transition:.1s}
.fm-cat-link:hover,.fm-cat-link.active{background:#f1f5f9;color:#1e293b}
.fm-cat-count{margin-left:auto;background:#f1f5f9;padding:2px 8px;border-radius:10px;font-size:11px;color:#64748b;font-weight:600}
.fm-check-all{display:flex;align-items:center;gap:8px}
.fm-bulk-bar{background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;padding:10px 16px;margin-bottom:12px;display:none;align-items:center;gap:12px;font-size:13px}
.fm-bulk-bar.show{display:flex}
@media(max-width:768px){.fm-layout{grid-template-columns:1fr}.fm-sidebar{display:none}}
</style>`;

const FM_JS = `<script>
function toggleView(v){var g=document.getElementById('fm-grid'),l=document.getElementById('fm-list');if(!g||!l)return;if(v==='grid'){g.style.display='';l.style.display='none'}else{g.style.display='none';l.style.display=''}}
function toggleBulkBar(){var c=document.querySelectorAll('.fm-item-check:checked');var b=document.getElementById('fm-bulk-bar');if(!b)return;b.classList.toggle('show',c.length>0);var s=document.getElementById('fm-bulk-count');if(s)s.textContent=c.length}
function toggleAllCheck(el){document.querySelectorAll('.fm-item-check').forEach(function(c){c.checked=el.checked});toggleBulkBar()}
</script>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function fileManager(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt) {

  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  if (!ah) ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ============================================================
  // 1. DATABASE MIGRATIONS
  // ============================================================
  const migrations = [
    `CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(500) NOT NULL, description TEXT,
      category VARCHAR(50) DEFAULT 'Other',
      file_url TEXT, file_type VARCHAR(100), file_size INTEGER DEFAULT 0,
      uploaded_by VARCHAR(255) NOT NULL, tags TEXT[],
      is_public BOOLEAN DEFAULT false, version INTEGER DEFAULT 1,
      parent_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
      folder_path TEXT DEFAULT '/', is_deleted BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS document_shares (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      shared_with_email VARCHAR(255) NOT NULL, shared_by_email VARCHAR(255) NOT NULL,
      permission VARCHAR(10) DEFAULT 'view', expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS document_versions (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      file_url TEXT, file_size INTEGER, version_number INTEGER NOT NULL,
      uploaded_by VARCHAR(255), changelog TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `DO $$ BEGIN
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES documents(id) ON DELETE SET NULL;
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder_path TEXT DEFAULT '/';
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS tags TEXT[];
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_type VARCHAR(100);
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_size INTEGER DEFAULT 0;
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;`,
    `CREATE INDEX IF NOT EXISTS idx_docs_tenant ON documents(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_docs_parent ON documents(parent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_docs_category ON documents(category)`,
    `CREATE INDEX IF NOT EXISTS idx_docs_path ON documents(folder_path)`,
    `CREATE INDEX IF NOT EXISTS idx_docs_deleted ON documents(is_deleted)`,
    `CREATE INDEX IF NOT EXISTS idx_shares_doc ON document_shares(document_id)`,
    `CREATE INDEX IF NOT EXISTS idx_shares_with ON document_shares(shared_with_email)`,
    `CREATE INDEX IF NOT EXISTS idx_versions_doc ON document_versions(document_id)`
  ];

  (async () => {
    try { for (const sql of migrations) { try { await migrateQuery(pool, 'FileManager', sql); } catch(e) { /* skip individual errors */ } } logger.info({ msg:'[FileManager] Migrations applied', count: migrations.length }); }
    catch (e) { logger.error({ msg:'[FileManager] Migration error', error: e.message }); }
  })();

  // ============================================================
  // INTERNAL HELPERS
  // ============================================================
  async function getFolders(tenantId, parentId) {
    const result = await pool.query(
      `SELECT id, name, folder_path FROM documents WHERE tenant_id=$1 AND parent_id ${parentId==='root'?'IS NULL':'=$2'} AND is_deleted=false ORDER BY name`,
      parentId === 'root' ? [tenantId] : [tenantId, parseInt(parentId)]
    );
    return result.rows;
  }

  async function getFolderTree(tenantId, parentId, depth) {
    if (depth > 5) return '';
    const folders = await getFolders(tenantId, parentId);
    if (folders.length === 0) return '';
    const indent = depth * 16;
    const subHtmls = await Promise.all(folders.map(async f => {
      const sub = await getFolderTree(tenantId, f.id, depth + 1);
      return `<li><a href="/files/folder/${encodeURIComponent(f.folder_path)}" style="padding-left:${8+indent}px">📁 ${esc(f.name)}</a>${sub ? '<ul class="fm-folder-tree">' + sub + '</ul>' : ''}</li>`;
    }));
    return subHtmls.join('');
  }

  async function getTagCloud(tenantId) {
    const result = await pool.query(
      `SELECT unnest(tags) AS tag, COUNT(*) AS cnt FROM documents WHERE tenant_id=$1 AND is_deleted=false AND tags::text <> '{}' GROUP BY tag ORDER BY cnt DESC LIMIT 25`,
      [tenantId]
    );
    return result.rows;
  }

  async function getStorageStats(tenantId) {
    const result = await pool.query(
      `SELECT category, COUNT(*) AS file_count, COALESCE(SUM(file_size),0) AS total_size FROM documents WHERE tenant_id=$1 AND is_deleted=false AND file_url IS NOT NULL GROUP BY category ORDER BY total_size DESC`,
      [tenantId]
    );
    return result.rows;
  }

  function breadcrumbHtml(path) {
    const parts = path.split('/').filter(Boolean);
    let html = `<a href="/files">📁 Root</a>`;
    let accumulated = '';
    parts.forEach(p => {
      accumulated += '/' + p;
      html += ` <span style="color:#cbd5e1">/</span> <a href="/files/folder/${encodeURIComponent(accumulated)}">${esc(p)}</a>`;
    });
    return html;
  }

  // ============================================================
  // ROUTE 1: GET /files — Document browser
  // ============================================================
  app.get('/files', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const viewMode = req.query.view || 'grid';
    const filterCat = req.query.category || '';
    const searchQ = req.query.q || '';
    const parentFilter = 'root';

    let whereParts = ['d.tenant_id=$1', 'd.is_deleted=false', 'd.parent_id IS NULL'];
    let params = [tid];
    let pi = 2;

    if (filterCat) { whereParts.push(`d.category=$${pi++}`); params.push(filterCat); }
    if (searchQ) { whereParts.push(`(d.name ILIKE $${pi} OR d.description ILIKE $${pi})`); params.push('%' + searchQ + '%'); }
    const where = whereParts.join(' AND ');

    const folders = await getFolders(tid, 'root');
    const documents = (await pool.query(
      `SELECT d.*, (SELECT COUNT(*) FROM document_shares WHERE document_id=d.id) AS share_count FROM documents d WHERE ${where} ORDER BY d.created_at DESC LIMIT 200`,
      params
    )).rows;
    const allStats = await getStorageStats(tid);
    const totalSize = allStats.reduce((s,c) => s + parseInt(c.total_size), 0);
    const totalFiles = allStats.reduce((s,c) => s + parseInt(c.file_count), 0);
    const catCounts = {};
    CATEGORIES.forEach(c => catCounts[c] = 0);
    allStats.forEach(s => catCounts[s.category] = parseInt(s.file_count));
    const tags = await getTagCloud(tid);
    const storageLimit = 5 * 1024 * 1024 * 1024; // 5 GB
    const usagePct = Math.min(100, (totalSize / storageLimit * 100)).toFixed(1);

    const folderCards = folders.map(f => `
      <a href="/files/folder/${encodeURIComponent(f.folder_path)}" class="fm-grid-item" style="text-decoration:none;color:inherit">
        <div class="fm-grid-icon">📁</div>
        <div class="fm-grid-name">${esc(f.name)}</div>
        <div class="fm-grid-meta">Folder</div>
      </a>`).join('');

    const gridItems = documents.map(d => {
      const fi = fileIcon(d.file_type);
      const ext = d.file_type ? d.file_type.split('.').pop() : '';
      return `<a href="/files/${d.id}" class="fm-grid-item" style="text-decoration:none;color:inherit">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <input type="checkbox" class="fm-item-check" value="${d.id}" onclick="event.stopPropagation();toggleBulkBar()">
          ${d.is_public ? '<span style="font-size:10px;background:#dcfce7;color:#16a34a;padding:1px 6px;border-radius:4px">🌐</span>' : ''}
        </div>
        <div class="fm-grid-icon" style="margin-top:8px">${fi.icon}</div>
        <div class="fm-grid-name" title="${esc(d.name)}">${esc(d.name)}</div>
        <div class="fm-grid-meta">${formatSize(d.file_size)} · ${relativeTime(d.created_at)}</div>
        <div style="margin-top:6px">${categoryBadge(d.category)}</div>
        ${d.share_count > 0 ? '<div style="font-size:11px;color:#4f46e5;margin-top:4px">🔗 ' + d.share_count + ' shared</div>' : ''}
      </a>`;
    }).join('');

    const listRows = documents.map(d => {
      const fi = fileIcon(d.file_type);
      return `<tr>
        <td><input type="checkbox" class="fm-item-check" value="${d.id}" onchange="toggleBulkBar()"></td>
        <td><a href="/files/${d.id}" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:inherit"><span>${fi.icon}</span><span style="font-weight:500">${esc(d.name)}</span></a></td>
        <td>${formatSize(d.file_size)}</td>
        <td><span style="font-size:12px;color:#64748b">${esc(d.file_type||'-')}</span></td>
        <td>${categoryBadge(d.category)}</td>
        <td style="font-size:12px;color:#64748b">${relativeTime(d.created_at)}</td>
        <td>${d.share_count > 0 ? '<span style="color:#4f46e5;font-size:12px">🔗 '+d.share_count+'</span>' : '-'}</td>
        <td>
          <a href="/files/${d.id}/edit" class="fm-btn fm-btn-secondary" style="padding:4px 10px;font-size:11px">Edit</a>
          <form method="POST" action="/files/${d.id}/delete" style="display:inline" onsubmit="return confirm('Delete ${esc(d.name)}?')"><button class="fm-btn fm-btn-danger" style="padding:4px 10px;font-size:11px">Del</button></form>
        </td>
      </tr>`;
    }).join('');

    const treeHtml = await getFolderTree(tid, 'root', 0);

    const html = `${FM_CSS}${FM_JS}
    <div style="max-width:1400px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📁 File Manager</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">All your documents and files</p></div>
        <div style="display:flex;gap:8px">
          <a href="/files/recent" class="fm-btn fm-btn-secondary">🕐 Recent</a>
          <a href="/files/shared" class="fm-btn fm-btn-secondary">🔗 Shared</a>
          <a href="/files/upload" class="fm-btn fm-btn-primary">⬆ Upload</a>
        </div>
      </div>

      <div class="fm-stats">
        <div class="fm-stat"><div class="fm-stat-val">${totalFiles}</div><div class="fm-stat-lbl">Total Files</div></div>
        <div class="fm-stat"><div class="fm-stat-val">${folders.length}</div><div class="fm-stat-lbl">Folders</div></div>
        <div class="fm-stat"><div class="fm-stat-val">${formatSize(totalSize)}</div><div class="fm-stat-lbl">Storage Used</div></div>
        <div class="fm-stat"><div class="fm-stat-val">${usagePct}%</div><div class="fm-stat-lbl">of ${formatSize(storageLimit)}</div></div>
      </div>

      <div class="fm-layout">
        <div class="fm-sidebar">
          <div class="card">
            <div class="fm-sidebar-label">Categories</div>
            <a href="/files" class="fm-cat-link ${!filterCat?'active':''}">📁 All Files <span class="fm-cat-count">${totalFiles}</span></a>
            ${CATEGORIES.map(c => `<a href="/files?category=${encodeURIComponent(c)}" class="fm-cat-link ${filterCat===c?'active':''}">${esc(c)} <span class="fm-cat-count">${catCounts[c]}</span></a>`).join('')}
          </div>
          <div class="card">
            <div class="fm-sidebar-label">Folders</div>
            <ul class="fm-folder-tree">
              <li><a href="/files">📁 Root</a>${treeHtml?'<ul class="fm-folder-tree">'+treeHtml+'</ul>':''}</li>
            </ul>
            <a href="/files" class="fm-btn fm-btn-secondary" style="width:100%;justify-content:center;margin-top:8px" onclick="document.getElementById('folder-create-modal').style.display='block';return false">➕ New Folder</a>
          </div>
          <div class="card">
            <div class="fm-sidebar-label">Storage</div>
            <div style="font-size:13px;color:#1e293b;font-weight:600">${formatSize(totalSize)} / ${formatSize(storageLimit)}</div>
            <div class="fm-storage-bar"><div class="fm-storage-fill" style="width:${usagePct}%;background:${usagePct>80?'#ef4444':usagePct>50?'#f59e0b':'#22c55e'}"></div></div>
            ${allStats.slice(0,4).map(s => `<div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-top:4px"><span>${esc(s.category)}</span><span>${formatSize(s.total_size)}</span></div>`).join('')}
          </div>
          ${tags.length > 0 ? `<div class="card"><div class="fm-sidebar-label">Tags</div><div>${tags.map(t => `<a href="/files/search?q=${encodeURIComponent(t.tag)}" class="fm-tag">${esc(t.tag)} <span style="color:#94a3b8">${t.cnt}</span></a>`).join('')}</div></div>` : ''}
        </div>

        <div class="fm-main">
          <div class="card">
            <div class="fm-breadcrumb">${breadcrumbHtml('/')}</div>
            <form method="GET" action="/files/search" class="fm-toolbar">
              <input type="text" name="q" placeholder="Search files..." value="${esc(searchQ)}">
              <a href="/files/upload" class="fm-btn fm-btn-primary">⬆ Upload</a>
              <a href="/files" class="fm-btn fm-btn-secondary" onclick="document.getElementById('folder-create-modal').style.display='block';return false">📁 New Folder</a>
              <select name="category" onchange="this.form.action='/files';this.form.submit()" style="padding:8px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff">
                <option value="">All Categories</option>
                ${CATEGORIES.map(c => `<option value="${esc(c)}" ${filterCat===c?'selected':''}>${esc(c)}</option>`).join('')}
              </select>
              <button type="button" class="fm-btn fm-btn-secondary" onclick="toggleView('grid')">▦</button>
              <button type="button" class="fm-btn fm-btn-secondary" onclick="toggleView('list')">☰</button>
            </form>

            <div class="fm-check-all" style="margin-bottom:8px;font-size:12px;color:#64748b">
              <input type="checkbox" onchange="toggleAllCheck(this)"> Select all
            </div>

            <div id="fm-bulk-bar" class="fm-bulk-bar">
              <span><strong id="fm-bulk-count">0</strong> selected</span>
              <form method="POST" action="/files/bulk-delete" style="display:inline"><button class="fm-btn fm-btn-danger" style="padding:6px 12px;font-size:12px">🗑 Delete</button></form>
              <form method="POST" action="/files/bulk-share" style="display:inline"><button class="fm-btn fm-btn-secondary" style="padding:6px 12px;font-size:12px">🔗 Share</button></form>
            </div>

            ${folderCards + gridItems === '' ? '<div class="fm-empty"><div class="fm-empty-icon">📂</div><h3 style="color:#64748b">No files here</h3><p style="color:#94a3b8;font-size:13px;margin-top:4px">Upload a file or create a folder to get started</p><a href="/files/upload" class="fm-btn fm-btn-primary" style="margin-top:12px">⬆ Upload File</a></div>' : `
            <div id="fm-grid" class="fm-grid" style="${viewMode==='list'?'display:none':''}">${folderCards}${gridItems}</div>
            <div id="fm-list" style="display:${viewMode==='list'?'':'none'};overflow-x:auto">
              <table class="fm-list">
                <thead><tr><th></th><th>Name</th><th>Size</th><th>Type</th><th>Category</th><th>Uploaded</th><th>Shared</th><th>Actions</th></tr></thead>
                <tbody>${listRows}</tbody>
              </table>
            </div>`}
          </div>
        </div>
      </div>
    </div>

    <div id="folder-create-modal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.4);z-index:1000;align-items:center;justify-content:center">
      <div class="card" style="padding:24px;max-width:420px;width:90%"><h3 style="margin-bottom:16px;color:#1e293b">📁 Create New Folder</h3>
        <form method="POST" action="/files/folder/create"><div style="margin-bottom:12px"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Folder Name</label><input type="text" name="name" required placeholder="My Folder" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
        <div style="margin-bottom:12px"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Parent Folder</label><select name="parent_id" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"><option value="">Root (/)</option></select></div>
        <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="fm-btn fm-btn-secondary" onclick="document.getElementById('folder-create-modal').style.display='none'">Cancel</button><button type="submit" class="fm-btn fm-btn-primary">Create</button></div></form>
      </div>
    </div><script>document.getElementById('folder-create-modal').style.display='none';</script`;

    res.send(renderPage('File Manager', html, user));
  }));

  // ============================================================
  // ROUTE 2: GET /files/upload — Upload form
  // ============================================================
  app.get('/files/upload', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const folders = await getFolders(tid, 'root');
    const currentFolder = req.query.folder || '';

    const html = `${FM_CSS}
    <div style="max-width:700px;margin:0 auto">
      <a href="/files" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-bottom:16px">← Back to Files</a>
      <div class="card" style="padding:24px">
        <h2 style="margin-bottom:4px;color:#1e293b">⬆ Upload Document</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Upload a new file to your document library</p>
        <form method="POST" action="/files/upload" enctype="multipart/form-data" style="display:flex;flex-direction:column;gap:16px">
          <div>
            <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">File *</label>
            <div style="border:2px dashed #cbd5e1;border-radius:12px;padding:32px;text-align:center;transition:.2s" onmouseover="this.style.borderColor='#6366f1'" onmouseout="this.style.borderColor='#cbd5e1'">
              <div style="font-size:36px;margin-bottom:8px">📎</div>
              <input type="file" name="file" required style="font-size:14px">
              <p style="font-size:12px;color:#94a3b8;margin-top:4px">Max 50 MB per file</p>
            </div>
          </div>
          <div>
            <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Document Name *</label>
            <input type="text" name="name" required placeholder="e.g., Q4 Financial Report" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
          </div>
          <div>
            <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="3" placeholder="Brief description..." style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;resize:vertical"></textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Category</label>
              <select name="category" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
                ${CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Folder</label>
              <select name="parent_id" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
                <option value="">Root (/)</option>
                ${folders.map(f => `<option value="${f.id}" ${currentFolder==f.id?'selected':''}>${esc(f.name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div>
            <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Tags (comma-separated)</label>
            <input type="text" name="tags" placeholder="finance, Q4, urgent" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" name="is_public" id="is_public" style="accent-color:#4f46e5;width:18px;height:18px">
            <label for="is_public" style="font-size:14px;color:#475569;cursor:pointer">Make this document publicly accessible</label>
          </div>
          <button type="submit" class="fm-btn fm-btn-primary" style="padding:12px 24px;font-size:15px;justify-content:center">🚀 Upload Document</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Upload Document', html, user));
  }));

  // ============================================================
  // ROUTE 3: POST /files/upload — Handle upload
  // ============================================================
  app.post('/files/upload', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    if (!req.file && !req.body.file_content) {
      return res.send(renderPage('Upload Error', '<div class="card"><p style="color:#ef4444">No file provided.</p><a href="/files/upload" class="fm-btn fm-btn-primary" style="margin-top:12px">← Try Again</a></div>', user));
    }
    const name = (req.body.name || req.file?.originalname || 'Untitled').trim();
    const description = (req.body.description || '').trim();
    const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'Other';
    const parentId = req.body.parent_id ? parseInt(req.body.parent_id) : null;
    const tagStr = (req.body.tags || '').trim();
    const tags = tagStr ? tagStr.split(',').map(t => t.trim()).filter(Boolean) : [];
    const isPublic = req.body.is_public === 'on' || req.body.is_public === 'true';

    let fileUrl = '', fileType = '', fileSize = 0;
    if (req.file) {
      fileUrl = 'data:' + req.file.mimetype + ';base64,' + req.file.buffer.toString('base64');
      fileType = req.file.originalname.split('.').pop();
      fileSize = req.file.size;
    } else {
      fileUrl = req.body.file_content || '';
      fileType = req.body.file_type || '';
      fileSize = parseInt(req.body.file_size) || 0;
    }

    let folderPath = '/';
    if (parentId) {
      const parent = (await pool.query('SELECT folder_path FROM documents WHERE id=$1 AND tenant_id=$2', [parentId, tid])).rows[0];
      if (parent) folderPath = parent.folder_path + '/' + name.replace(/[^a-zA-Z0-9._-]/g, '_');
    }

    const result = await pool.query(
      `INSERT INTO documents (tenant_id, name, description, category, file_url, file_type, file_size, uploaded_by, tags, is_public, parent_id, folder_path) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [tid, name, description, category, fileUrl, fileType, fileSize, user.email, tags, isPublic, parentId, folderPath]
    );
    const docId = result.rows[0].id;

    await pool.query(
      `INSERT INTO document_versions (document_id, file_url, file_size, version_number, uploaded_by, changelog) VALUES ($1,$2,$3,$4,$5,$6)`,
      [docId, fileUrl, fileSize, 1, user.email, 'Initial upload']
    );

    audit(user.email, 'document_upload', `Uploaded document #${docId}: ${name}`);
    logger.info({ msg:'[FileManager] File uploaded', docId, name, by: user.email, tenant: tid });
    req.flash = req.flash || {}; req.flash.success = 'Document uploaded successfully!';
    res.redirect('/files/' + docId);
  }));

  // ============================================================
  // ROUTE 4: GET /files/:id — Document detail
  // ============================================================
  app.get('/files/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, docId = parseInt(req.params.id);
    const doc = (await pool.query('SELECT * FROM documents WHERE id=$1 AND tenant_id=$2 AND is_deleted=false', [docId, tid])).rows[0];
    if (!doc) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#ef4444">Document not found</h2><a href="/files" class="fm-btn fm-btn-primary" style="margin-top:12px">← Files</a></div>', user));

    const versions = (await pool.query(
      'SELECT * FROM document_versions WHERE document_id=$1 ORDER BY version_number DESC', [docId]
    )).rows;
    const shares = (await pool.query(
      'SELECT ds.*, u.name AS shared_with_name FROM document_shares ds LEFT JOIN users u ON u.email=ds.shared_with_email WHERE ds.document_id=$1', [docId]
    )).rows;
    const fi = fileIcon(doc.file_type);
    const isImage = /^image\/(png|jpe?g|gif|svg|webp)/.test(doc.file_type) || ['jpg','jpeg','png','gif','svg','webp'].includes((doc.file_type||'').toLowerCase());
    const previewHtml = isImage && doc.file_url
      ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center;margin-bottom:16px"><img src="${esc(doc.file_url)}" alt="${esc(doc.name)}" style="max-width:100%;max-height:400px;border-radius:8px;object-fit:contain"></div>`
      : (doc.file_type === 'txt' || doc.file_type === 'md')
        ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:16px;white-space:pre-wrap;font-family:monospace;font-size:13px;max-height:400px;overflow-y:auto">Preview not available inline</div>`
        : `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:40px;text-align:center;margin-bottom:16px"><div style="font-size:64px;margin-bottom:8px">${fi.icon}</div><p style="color:#64748b;font-size:14px">Preview not available for this file type</p><a href="/files/download/${doc.id}" class="fm-btn fm-btn-primary" style="margin-top:12px">📥 Download</a></div>`;

    const html = `${FM_CSS}
    <div style="max-width:900px;margin:0 auto">
      <a href="/files" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-bottom:16px">← Back to Files</a>

      <div class="card" style="padding:24px;margin-bottom:16px">
        <div style="display:flex;align-items:start;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="font-size:48px">${fi.icon}</div>
            <div>
              <h2 style="color:#1e293b;margin:0">${esc(doc.name)}</h2>
              <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
                ${categoryBadge(doc.category)}
                <span style="font-size:12px;color:#94a3b8">${formatSize(doc.file_size)}</span>
                <span style="font-size:12px;color:#94a3b8">v${doc.version}</span>
                ${doc.is_public ? '<span style="font-size:11px;background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:4px;font-weight:600">🌐 Public</span>' : ''}
              </div>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <a href="/files/download/${doc.id}" class="fm-btn fm-btn-primary">📥 Download</a>
            <a href="/files/${doc.id}/edit" class="fm-btn fm-btn-secondary">✏️ Edit</a>
            <form method="POST" action="/files/${doc.id}/delete" onsubmit="return confirm('Delete this document permanently?')"><button class="fm-btn fm-btn-danger">🗑 Delete</button></form>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:12px">📋 Details</h3>
          <div style="font-size:13px;display:flex;flex-direction:column;gap:8px">
            ${doc.description ? `<div><span style="color:#94a3b8;display:block;font-size:11px;text-transform:uppercase;margin-bottom:2px">Description</span>${esc(doc.description)}</div>` : ''}
            <div><span style="color:#94a3b8;font-size:11px">Uploaded by</span><div>${esc(doc.uploaded_by)}</div></div>
            <div><span style="color:#94a3b8;font-size:11px">Created</span><div>${new Date(doc.created_at).toLocaleString()}</div></div>
            <div><span style="color:#94a3b8;font-size:11px">Last updated</span><div>${new Date(doc.updated_at).toLocaleString()}</div></div>
            <div><span style="color:#94a3b8;font-size:11px">Folder</span><div>${esc(doc.folder_path||'/')}</div></div>
            ${doc.tags && doc.tags.length > 0 ? `<div><span style="color:#94a3b8;font-size:11px">Tags</span><div style="margin-top:4px">${doc.tags.map(t => `<span class="fm-tag">${esc(t)}</span>`).join('')}</div></div>` : ''}
          </div>
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:12px">🔗 Share (${shares.length})</h3>
          ${shares.length === 0 ? '<p style="font-size:13px;color:#94a3b8">Not shared with anyone yet</p>' : `<div style="font-size:13px">${shares.map(s => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9">
              <div><span style="font-weight:500">${esc(s.shared_with_name || s.shared_with_email)}</span><br><span style="font-size:11px;color:#94a3b8">${s.permission} · ${s.expires_at ? 'until ' + new Date(s.expires_at).toLocaleDateString() : 'no expiry'}</span></div>
              <form method="POST" action="/files/${doc.id}/share" style="display:inline"><input type="hidden" name="remove_share" value="${s.id}"><button class="fm-btn fm-btn-danger" style="padding:4px 8px;font-size:11px">✕</button></form>
            </div>`).join('')}</div>`}
          <form method="POST" action="/files/${doc.id}/share" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            <input type="email" name="shared_with_email" placeholder="user@email.com" required style="flex:1;min-width:150px;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">
            <select name="permission" style="padding:8px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">
              <option value="view">View</option><option value="edit">Edit</option>
            </select>
            <button type="submit" class="fm-btn fm-btn-primary" style="padding:8px 12px">Share</button>
          </form>
        </div>
      </div>

      <div class="card" style="padding:20px;margin-top:16px">
        <h3 style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:12px">📜 Version History (${versions.length})</h3>
        ${versions.length === 0 ? '<p style="font-size:13px;color:#94a3b8">No versions recorded</p>' : `<div style="font-size:13px">${versions.map(v => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f1f5f9">
            <div><span style="font-weight:600;color:#4f46e5">v${v.version_number}</span> — ${esc(v.changelog || 'No changelog')}<br><span style="font-size:11px;color:#94a3b8">${esc(v.uploaded_by)} · ${relativeTime(v.created_at)} · ${formatSize(v.file_size)}</span></div>
            ${v.file_url ? `<a href="/files/download/${doc.id}?version=${v.version_number}" class="fm-btn fm-btn-secondary" style="padding:4px 10px;font-size:11px">📥</a>` : ''}
          </div>`).join('')}</div>`}
      </div>
    </div>`;
    res.send(renderPage(doc.name, html, user));
  }));

  // ============================================================
  // ROUTE 5: GET /files/:id/edit — Edit metadata
  // ============================================================
  app.get('/files/:id/edit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, docId = parseInt(req.params.id);
    const doc = (await pool.query('SELECT * FROM documents WHERE id=$1 AND tenant_id=$2 AND is_deleted=false', [docId, tid])).rows[0];
    if (!doc) return res.redirect('/files');
    const folders = (await pool.query(
      `SELECT id, name, folder_path FROM documents WHERE tenant_id=$1 AND parent_id IS NULL AND is_deleted=false AND id!=$2 ORDER BY name`,
      [tid, docId]
    )).rows;

    const html = `${FM_CSS}
    <div style="max-width:700px;margin:0 auto">
      <a href="/files/${docId}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-bottom:16px">← Back to Document</a>
      <div class="card" style="padding:24px">
        <h2 style="margin-bottom:20px;color:#1e293b">✏️ Edit Document</h2>
        <form method="POST" action="/files/${docId}/edit" style="display:flex;flex-direction:column;gap:16px">
          <div>
            <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Name *</label>
            <input type="text" name="name" required value="${esc(doc.name)}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
          </div>
          <div>
            <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="3" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;resize:vertical">${esc(doc.description||'')}</textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Category</label>
              <select name="category" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
                ${CATEGORIES.map(c => `<option value="${esc(c)}" ${doc.category===c?'selected':''}>${esc(c)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Move to Folder</label>
              <select name="parent_id" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
                <option value="">Root (/)</option>
                ${folders.map(f => `<option value="${f.id}" ${doc.parent_id===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div>
            <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Tags (comma-separated)</label>
            <input type="text" name="tags" value="${esc((doc.tags||[]).join(', '))}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" name="is_public" id="edit_public" ${doc.is_public?'checked':''} style="accent-color:#4f46e5;width:18px;height:18px">
            <label for="edit_public" style="font-size:14px;color:#475569;cursor:pointer">Public document</label>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <a href="/files/${docId}" class="fm-btn fm-btn-secondary">Cancel</a>
            <button type="submit" class="fm-btn fm-btn-primary" style="padding:12px 24px">💾 Save Changes</button>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Edit - ' + doc.name, html, user));
  }));

  // ============================================================
  // ROUTE 6: POST /files/:id/edit — Update document
  // ============================================================
  app.post('/files/:id/edit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, docId = parseInt(req.params.id);
    const doc = (await pool.query('SELECT * FROM documents WHERE id=$1 AND tenant_id=$2 AND is_deleted=false', [docId, tid])).rows[0];
    if (!doc) return res.redirect('/files');

    const name = (req.body.name || '').trim();
    if (!name) return res.redirect('/files/' + docId + '/edit');

    const description = (req.body.description || '').trim();
    const category = CATEGORIES.includes(req.body.category) ? req.body.category : doc.category;
    const parentId = req.body.parent_id ? parseInt(req.body.parent_id) : null;
    const tagStr = (req.body.tags || '').trim();
    const tags = tagStr ? tagStr.split(',').map(t => t.trim()).filter(Boolean) : [];
    const isPublic = req.body.is_public === 'on' || req.body.is_public === 'true';

    let folderPath = '/';
    if (parentId) {
      const parent = (await pool.query('SELECT folder_path FROM documents WHERE id=$1 AND tenant_id=$2', [parentId, tid])).rows[0];
      folderPath = parent ? parent.folder_path + '/' + name.replace(/[^a-zA-Z0-9._-]/g, '_') : '/';
    }

    await pool.query(
      `UPDATE documents SET name=$1, description=$2, category=$3, parent_id=$4, folder_path=$5, tags=$6, is_public=$7, updated_at=NOW() WHERE id=$8 AND tenant_id=$9`,
      [name, description, category, parentId, folderPath, tags, isPublic, docId, tid]
    );
    audit(user.email, 'document_edit', `Updated document #${docId}: ${name}`);
    res.redirect('/files/' + docId);
  }));

  // ============================================================
  // ROUTE 7: POST /files/:id/delete — Delete document
  // ============================================================
  app.post('/files/:id/delete', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, docId = parseInt(req.params.id);
    const doc = (await pool.query('SELECT name FROM documents WHERE id=$1 AND tenant_id=$2 AND is_deleted=false', [docId, tid])).rows[0];
    if (!doc) return res.redirect('/files');
    await pool.query('UPDATE documents SET is_deleted=true, updated_at=NOW() WHERE id=$1 AND tenant_id=$2', [docId, tid]);
    audit(user.email, 'document_delete', `Deleted document #${docId}: ${doc.name}`);
    logger.info({ msg:'[FileManager] File deleted', docId, name: doc.name, by: user.email, tenant: tid });
    res.redirect('/files');
  }));

  // ============================================================
  // ROUTE 8: POST /files/:id/share — Share / remove share
  // ============================================================
  app.post('/files/:id/share', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, docId = parseInt(req.params.id);
    const doc = (await pool.query('SELECT id FROM documents WHERE id=$1 AND tenant_id=$2 AND is_deleted=false', [docId, tid])).rows[0];
    if (!doc) return res.redirect('/files');

    if (req.body.remove_share) {
      await pool.query('DELETE FROM document_shares WHERE id=$1 AND document_id=$2', [parseInt(req.body.remove_share), docId]);
      audit(user.email, 'share_remove', `Removed share on document #${docId}`);
    } else {
      const email = (req.body.shared_with_email || '').trim().toLowerCase();
      const permission = req.body.permission === 'edit' ? 'edit' : 'view';
      if (!email) return res.redirect('/files/' + docId);
      await pool.query(
        `INSERT INTO document_shares (document_id, shared_with_email, shared_by_email, permission, created_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT DO NOTHING`,
        [docId, email, user.email, permission]
      );
      audit(user.email, 'document_share', `Shared document #${docId} with ${email} (${permission})`);
      if (notify) { try { notify(tid, email, 'Document Shared', `${user.email} shared "${doc.name || 'a document'}" with you.`, 'files'); } catch(_){} }
    }
    res.redirect('/files/' + docId);
  }));

  // ============================================================
  // ROUTE 9: GET /files/folder/:path — Navigate folder
  // ============================================================
  app.get('/files/folder/:path', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const folderPath = '/' + req.params.path, viewMode = req.query.view || 'grid';
    const parentFolder = (await pool.query('SELECT id,name,folder_path FROM documents WHERE tenant_id=$1 AND folder_path=$2 AND is_deleted=false LIMIT 1', [tid, folderPath])).rows[0];
    const folders = parentFolder ? await getFolders(tid, parentFolder.id) : [];
    const documents = parentFolder ? (await pool.query(
      `SELECT d.*, (SELECT COUNT(*) FROM document_shares WHERE document_id=d.id) AS share_count FROM documents d WHERE d.tenant_id=$1 AND d.parent_id=$2 AND d.is_deleted=false AND d.file_url IS NOT NULL ORDER BY d.created_at DESC LIMIT 200`, [tid, parentFolder.id]
    )).rows : [];
    const folderCards = folders.map(f => `<a href="/files/folder${encodeURIComponent(f.folder_path)}" class="fm-grid-item" style="text-decoration:none;color:inherit"><div class="fm-grid-icon">📁</div><div class="fm-grid-name">${esc(f.name)}</div><div class="fm-grid-meta">Folder</div></a>`).join('');
    const gridItems = documents.map(d => { const fi = fileIcon(d.file_type); return `<a href="/files/${d.id}" class="fm-grid-item" style="text-decoration:none;color:inherit"><div class="fm-grid-icon">${fi.icon}</div><div class="fm-grid-name">${esc(d.name)}</div><div class="fm-grid-meta">${formatSize(d.file_size)} · ${relativeTime(d.created_at)}</div><div style="margin-top:6px">${categoryBadge(d.category)}</div></a>`; }).join('');
    const listRows = documents.map(d => { const fi = fileIcon(d.file_type); return `<tr><td><a href="/files/${d.id}" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:inherit"><span>${fi.icon}</span><span style="font-weight:500">${esc(d.name)}</span></a></td><td>${formatSize(d.file_size)}</td><td>${categoryBadge(d.category)}</td><td style="font-size:12px;color:#64748b">${relativeTime(d.created_at)}</td><td>${d.share_count>0?'🔗':'-'}</td></tr>`; }).join('');
    const html = `${FM_CSS}${FM_JS}
    <div style="max-width:1100px;margin:0 auto"><a href="/files" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-bottom:16px">← Back to Files</a>
      <div class="card"><div class="fm-breadcrumb">${breadcrumbHtml(folderPath)}</div>
        <div class="fm-toolbar"><h2 style="font-size:18px;color:#1e293b">📁 ${esc(parentFolder?parentFolder.name:'Unknown')}</h2><div style="margin-left:auto;display:flex;gap:8px"><a href="/files/upload?folder=${parentFolder?parentFolder.id:''}" class="fm-btn fm-btn-primary">⬆ Upload Here</a><button type="button" class="fm-btn fm-btn-secondary" onclick="toggleView('grid')">▦</button><button type="button" class="fm-btn fm-btn-secondary" onclick="toggleView('list')">☰</button></div></div>
        ${folderCards+gridItems===''?'<div class="fm-empty"><div class="fm-empty-icon">📂</div><h3 style="color:#64748b">Empty folder</h3><p style="font-size:13px;color:#94a3b8;margin-top:4px">Upload files or create subfolders</p></div>':`<div id="fm-grid" class="fm-grid" style="${viewMode==='list'?'display:none':''}">${folderCards}${gridItems}</div><div id="fm-list" style="display:${viewMode==='list'?'':'none'};overflow-x:auto"><table class="fm-list"><thead><tr><th>Name</th><th>Size</th><th>Category</th><th>Uploaded</th><th>Shared</th></tr></thead><tbody>${listRows}</tbody></table></div>`}
      </div></div>`;
    res.send(renderPage('Folder - ' + (parentFolder ? parentFolder.name : 'Unknown'), html, user));
  }));

  // ============================================================
  // ROUTE 10: POST /files/folder/create — Create folder
  // ============================================================
  app.post('/files/folder/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const name = (req.body.name || '').trim();
    if (!name) return res.redirect('/files');
    const parentId = req.body.parent_id ? parseInt(req.body.parent_id) : null;
    let folderPath = '/' + name.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (parentId) {
      const parent = (await pool.query('SELECT folder_path FROM documents WHERE id=$1 AND tenant_id=$2', [parentId, tid])).rows[0];
      if (parent) folderPath = parent.folder_path + '/' + name.replace(/[^a-zA-Z0-9._-]/g, '_');
    }
    await pool.query(
      `INSERT INTO documents (tenant_id, name, category, uploaded_by, parent_id, folder_path, file_url) VALUES ($1,$2,'Other',$3,$4,$5,NULL)`,
      [tid, name, user.email, parentId, folderPath]
    );
    audit(user.email, 'folder_create', `Created folder: ${name} at ${folderPath}`);
    res.redirect('/files');
  }));

  // ============================================================
  // ROUTE 11: GET /files/download/:id — Download endpoint
  // ============================================================
  app.get('/files/download/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, docId = parseInt(req.params.id);
    const doc = (await pool.query('SELECT * FROM documents WHERE id=$1 AND tenant_id=$2 AND is_deleted=false', [docId, tid])).rows[0];
    if (!doc || !doc.file_url) return res.status(404).send('File not found');

    let fileData = doc.file_url;
    let mimeType = doc.file_type || 'application/octet-stream';

    if (doc.file_url.startsWith('data:')) {
      const commaIdx = doc.file_url.indexOf(',');
      if (commaIdx > 0) {
        const metaPart = doc.file_url.substring(0, commaIdx);
        const mimeMatch = metaPart.match(/data:([^;]+)/);
        if (mimeMatch) mimeType = mimeMatch[1];
        fileData = doc.file_url.substring(commaIdx + 1);
      }
    }

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${doc.name.replace(/"/g, '\\"')}"`);
    res.setHeader('Content-Length', doc.file_size || Buffer.from(fileData, 'base64').length);
    res.send(Buffer.from(fileData, 'base64'));
    audit(user.email, 'document_download', `Downloaded document #${docId}: ${doc.name}`);
  }));

  // ============================================================
  // ROUTE 12: GET /files/search — Search documents
  // ============================================================
  app.get('/files/search', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const q = (req.query.q || '').trim(), filterCat = req.query.category || '', viewMode = req.query.view || 'grid';
    if (!q && !filterCat) return res.redirect('/files');
    let whereParts = ['d.tenant_id=$1', 'd.is_deleted=false'], params = [tid], pi = 2;
    if (q) { whereParts.push(`(d.name ILIKE $${pi} OR d.description ILIKE $${pi} OR $${pi} = ANY(d.tags))`); params.push('%' + q + '%'); pi++; }
    if (filterCat) { whereParts.push(`d.category=$${pi++}`); params.push(filterCat); }
    const documents = (await pool.query(
      `SELECT d.*, (SELECT COUNT(*) FROM document_shares WHERE document_id=d.id) AS share_count FROM documents d WHERE ${whereParts.join(' AND ')} ORDER BY d.created_at DESC LIMIT 200`, params
    )).rows;
    const gridItems = documents.map(d => { const fi = fileIcon(d.file_type); return `<a href="/files/${d.id}" class="fm-grid-item" style="text-decoration:none;color:inherit"><div class="fm-grid-icon">${fi.icon}</div><div class="fm-grid-name">${esc(d.name)}</div><div class="fm-grid-meta">${formatSize(d.file_size)} · ${relativeTime(d.created_at)}</div><div style="margin-top:6px">${categoryBadge(d.category)}</div></a>`; }).join('');
    const listRows = documents.map(d => { const fi = fileIcon(d.file_type); return `<tr><td><a href="/files/${d.id}" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:inherit"><span>${fi.icon}</span><span style="font-weight:500">${esc(d.name)}</span></a></td><td>${formatSize(d.file_size)}</td><td>${categoryBadge(d.category)}</td><td style="font-size:12px;color:#64748b">${relativeTime(d.created_at)}</td><td>${d.share_count>0?'🔗':'-'}</td></tr>`; }).join('');
    const html = `${FM_CSS}${FM_JS}
    <div style="max-width:1100px;margin:0 auto"><a href="/files" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-bottom:16px">← Back to Files</a>
      <div class="card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px"><h2 style="color:#1e293b">🔍 Search Results: "${esc(q)}"${filterCat?' in '+esc(filterCat):''}</h2><span style="font-size:13px;color:#94a3b8">${documents.length} result${documents.length===1?'':'s'}</span></div>
        <form method="GET" action="/files/search" class="fm-toolbar"><input type="text" name="q" value="${esc(q)}" placeholder="Search..."><select name="category" style="padding:8px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"><option value="">All Categories</option>${CATEGORIES.map(c=>`<option value="${esc(c)}" ${filterCat===c?'selected':''}>${esc(c)}</option>`).join('')}</select><button class="fm-btn fm-btn-primary" type="submit">Search</button><button type="button" class="fm-btn fm-btn-secondary" onclick="toggleView('grid')">▦</button><button type="button" class="fm-btn fm-btn-secondary" onclick="toggleView('list')">☰</button></form>
        ${documents.length===0?'<div class="fm-empty"><div class="fm-empty-icon">🔍</div><h3 style="color:#64748b">No documents found</h3><p style="font-size:13px;color:#94a3b8">Try a different search term or category</p></div>':`<div id="fm-grid" class="fm-grid" style="${viewMode==='list'?'display:none':''}">${gridItems}</div><div id="fm-list" style="display:${viewMode==='list'?'':'none'};overflow-x:auto"><table class="fm-list"><thead><tr><th>Name</th><th>Size</th><th>Category</th><th>Uploaded</th><th>Shared</th></tr></thead><tbody>${listRows}</tbody></table></div>`}
      </div></div>`;
    res.send(renderPage('Search - ' + (q || filterCat), html, user));
  }));

  // ============================================================
  // ROUTE 13: GET /files/shared — Files shared with me
  // ============================================================
  app.get('/files/shared', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, viewMode = req.query.view || 'grid';
    const documents = (await pool.query(
      `SELECT d.*, ds.permission AS my_permission, ds.shared_by_email, ds.expires_at AS share_expires
       FROM document_shares ds JOIN documents d ON d.id = ds.document_id
       WHERE ds.shared_with_email=$1 AND d.tenant_id=$2 AND d.is_deleted=false ORDER BY ds.created_at DESC LIMIT 200`, [user.email, tid]
    )).rows;
    const gridItems = documents.map(d => {
      const fi = fileIcon(d.file_type), expired = d.share_expires && new Date(d.share_expires) < new Date();
      return `<a href="/files/${d.id}" class="fm-grid-item" style="text-decoration:none;color:inherit;${expired?'opacity:.5':''}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:10px;padding:2px 8px;border-radius:4px;font-weight:600;background:${d.my_permission==='edit'?'#dbeafe;color:#1e40af':'#f1f5f9;color:#475569'}">${esc(d.my_permission)}</span>${expired?'<span style="font-size:10px;background:#fee2e2;color:#dc2626;padding:2px 6px;border-radius:4px">Expired</span>':''}</div>
        <div class="fm-grid-icon">${fi.icon}</div><div class="fm-grid-name">${esc(d.name)}</div><div class="fm-grid-meta">${formatSize(d.file_size)} · by ${esc(d.shared_by_email)}</div><div style="margin-top:6px">${categoryBadge(d.category)}</div></a>`;
    }).join('');
    const listRows = documents.map(d => {
      const fi = fileIcon(d.file_type), expired = d.share_expires && new Date(d.share_expires) < new Date();
      return `<tr style="${expired?'opacity:.5':''}"><td><a href="/files/${d.id}" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:inherit"><span>${fi.icon}</span><span style="font-weight:500">${esc(d.name)}</span></a></td><td>${formatSize(d.file_size)}</td><td>${categoryBadge(d.category)}</td><td style="font-size:12px;color:#64748b">${esc(d.shared_by_email)}</td><td><span style="font-size:12px;padding:2px 8px;border-radius:4px;background:${d.my_permission==='edit'?'#dbeafe;color:#1e40af':'#f1f5f9;color:#475569'}">${esc(d.my_permission)}</span></td></tr>`;
    }).join('');
    const html = `${FM_CSS}${FM_JS}
    <div style="max-width:1100px;margin:0 auto"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px"><div><h1 style="font-size:24px;color:#1e293b">🔗 Shared With Me</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${documents.length} document${documents.length===1?'':'s'} shared</p></div><div style="display:flex;gap:8px"><a href="/files" class="fm-btn fm-btn-secondary">📁 My Files</a><a href="/files/recent" class="fm-btn fm-btn-secondary">🕐 Recent</a><button type="button" class="fm-btn fm-btn-secondary" onclick="toggleView('grid')">▦</button><button type="button" class="fm-btn fm-btn-secondary" onclick="toggleView('list')">☰</button></div></div><div class="card">${documents.length===0?'<div class="fm-empty"><div class="fm-empty-icon">🔗</div><h3 style="color:#64748b">No shared documents</h3><p style="font-size:13px;color:#94a3b8">When others share documents with you, they will appear here</p></div>':`<div id="fm-grid" class="fm-grid" style="${viewMode==='list'?'display:none':''}">${gridItems}</div><div id="fm-list" style="display:${viewMode==='list'?'':'none'};overflow-x:auto"><table class="fm-list"><thead><tr><th>Name</th><th>Size</th><th>Category</th><th>Shared By</th><th>Permission</th></tr></thead><tbody>${listRows}</tbody></table></div>`}</div></div>`;
    res.send(renderPage('Shared Files', html, user));
  }));

  // ============================================================
  // ROUTE 14: GET /files/recent — Recently uploaded files
  // ============================================================
  app.get('/files/recent', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, viewMode = req.query.view || 'grid';
    const documents = (await pool.query(
      `SELECT d.*, (SELECT COUNT(*) FROM document_shares WHERE document_id=d.id) AS share_count
       FROM documents d WHERE d.tenant_id=$1 AND d.is_deleted=false AND d.file_url IS NOT NULL
       AND d.created_at >= NOW() - INTERVAL '30 days' ORDER BY d.created_at DESC LIMIT 100`, [tid]
    )).rows;
    const gridItems = documents.map(d => { const fi = fileIcon(d.file_type); return `<a href="/files/${d.id}" class="fm-grid-item" style="text-decoration:none;color:inherit"><div class="fm-grid-icon">${fi.icon}</div><div class="fm-grid-name">${esc(d.name)}</div><div class="fm-grid-meta">${formatSize(d.file_size)} · ${relativeTime(d.created_at)}</div><div style="margin-top:6px">${categoryBadge(d.category)}</div></a>`; }).join('');
    const listRows = documents.map(d => { const fi = fileIcon(d.file_type); return `<tr><td><a href="/files/${d.id}" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:inherit"><span>${fi.icon}</span><span style="font-weight:500">${esc(d.name)}</span></a></td><td>${formatSize(d.file_size)}</td><td>${categoryBadge(d.category)}</td><td style="font-size:12px;color:#64748b">${esc(d.uploaded_by)}</td><td style="font-size:12px;color:#64748b">${relativeTime(d.created_at)}</td></tr>`; }).join('');
    const html = `${FM_CSS}${FM_JS}
    <div style="max-width:1100px;margin:0 auto"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px"><div><h1 style="font-size:24px;color:#1e293b">🕐 Recent Files</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Files uploaded in the last 30 days</p></div><div style="display:flex;gap:8px"><a href="/files" class="fm-btn fm-btn-secondary">📁 All Files</a><a href="/files/shared" class="fm-btn fm-btn-secondary">🔗 Shared</a><button type="button" class="fm-btn fm-btn-secondary" onclick="toggleView('grid')">▦</button><button type="button" class="fm-btn fm-btn-secondary" onclick="toggleView('list')">☰</button></div></div><div class="card">${documents.length===0?'<div class="fm-empty"><div class="fm-empty-icon">🕐</div><h3 style="color:#64748b">No recent files</h3><p style="font-size:13px;color:#94a3b8">Files uploaded in the last 30 days will appear here</p><a href="/files/upload" class="fm-btn fm-btn-primary" style="margin-top:12px">⬆ Upload File</a></div>':`<div id="fm-grid" class="fm-grid" style="${viewMode==='list'?'display:none':''}">${gridItems}</div><div id="fm-list" style="display:${viewMode==='list'?'':'none'};overflow-x:auto"><table class="fm-list"><thead><tr><th>Name</th><th>Size</th><th>Category</th><th>Uploaded By</th><th>Date</th></tr></thead><tbody>${listRows}</tbody></table></div>`}</div></div>`;
    res.send(renderPage('Recent Files', html, user));
  }));

  // ============================================================
  // BONUS: POST /files/bulk-delete — Bulk delete
  // ============================================================
  app.post('/files/bulk-delete', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const ids = Array.isArray(req.body.selected) ? req.body.selected.map(Number) : (req.body.selected ? [parseInt(req.body.selected)] : []);
    if (ids.length === 0) return res.redirect('/files');
    await pool.query(`UPDATE documents SET is_deleted=true, updated_at=NOW() WHERE id=ANY($1) AND tenant_id=$2`, [ids, tid]);
    audit(user.email, 'bulk_delete', `Bulk deleted ${ids.length} documents`);
    res.redirect('/files');
  }));

  app.post('/files/bulk-share', requireAuth, ah(async (req, res) => {
    const ids = req.body.selected_ids || req.body.selected;
    if (!ids) return res.redirect('/files');
    res.redirect('/files?share_ids=' + encodeURIComponent(JSON.stringify(Array.isArray(ids) ? ids : [ids])));
  }));

  logger.info({ msg: '[FileManager] Module loaded', routes: 16 });
};
