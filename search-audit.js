// ============================================================
// GLOBAL SEARCH & AUDIT LOG VIEWER MODULE — SSEWASSWA Comfort Platform
// Unified cross-entity search, advanced filtering, autocomplete API,
// audit log viewer with export, and audit statistics dashboard.
// ============================================================
// Usage in server.js:
//   const searchAudit = require('./search-audit');
//   searchAudit(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt);
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
const fmtDT = (d) => d ? new Date(d).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '-';
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '-';
const highlight = (text, q) => {
  if (!text || !q) return esc(String(text || ''));
  const safe = esc(String(text));
  const pattern = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try { return safe.replace(new RegExp('(' + pattern + ')', 'gi'), '<mark style="background:#fef08a;padding:0 2px;border-radius:2px">$1</mark>'); }
  catch { return safe; }
};

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function searchAudit(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt) {
  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  if (!ah) ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ============================================================
  // SEARCH ENTITY DEFINITIONS
  // ============================================================
  const SEARCH_ENTITIES = [
    { key:'students', label:'Students', icon:'🎓', color:'#4f46e5', link:'/students?id=',
      sql:'SELECT id, name, email, class||\' \'||stream as sub, \'Student\' as _type FROM students WHERE tenant_id=$1 AND (name ILIKE $2 OR email ILIKE $2 OR class ILIKE $2 OR stream ILIKE $2) LIMIT 30',
      fields:['name','email','class','stream'] },
    { key:'users', label:'Staff/Users', icon:'👤', color:'#7c3aed', link:'/users/edit?id=',
      sql:'SELECT id, name, email, role as sub, \'User\' as _type FROM users WHERE tenant_id=$1 AND (name ILIKE $2 OR email ILIKE $2 OR role ILIKE $2) LIMIT 30',
      fields:['name','email','role'] },
    { key:'employees', label:'Employees', icon:'💼', color:'#0891b2', link:'/hr/employee?id=',
      sql:'SELECT id, name, email, department||\' — \'||position as sub, \'Employee\' as _type FROM employee_directory WHERE tenant_id=$1 AND (name ILIKE $2 OR email ILIKE $2 OR department ILIKE $2 OR position ILIKE $2) LIMIT 30',
      fields:['name','email','department','position'] },
    { key:'members', label:'Members', icon:'👥', color:'#059669', link:'/members?id=',
      sql:'SELECT id, name, email, phone||\' | \'||membership_type as sub, \'Member\' as _type FROM members WHERE tenant_id=$1 AND (name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2 OR membership_type ILIKE $2) LIMIT 30',
      fields:['name','email','phone','membership_type'] },
    { key:'patients', label:'Patients', icon:'🏥', color:'#dc2626', link:'/clinic/patient?id=',
      sql:'SELECT id, full_name as name, patient_id as sub, phone as email, \'Patient\' as _type FROM clinic_patients WHERE tenant_id=$1 AND (full_name ILIKE $2 OR patient_id ILIKE $2 OR phone ILIKE $2) LIMIT 30',
      fields:['full_name','patient_id','phone'] },
    { key:'inventory', label:'Inventory', icon:'📦', color:'#ea580c', link:'/inventory/item?id=',
      sql:'SELECT id, item_name as name, category||\' | SKU: \'||sku as sub, \'\' as email, \'Item\' as _type FROM inventory WHERE tenant_id=$1 AND (item_name ILIKE $2 OR category ILIKE $2 OR sku ILIKE $2) LIMIT 30',
      fields:['item_name','category','sku'] },
    { key:'fees', label:'Fees', icon:'💰', color:'#ca8a04', link:'/fees?id=',
      sql:'SELECT id, student_name as name, status||\' | \'||amount::text as sub, \'\' as email, \'Fee\' as _type FROM fees WHERE tenant_id=$1 AND (student_name ILIKE $2 OR status ILIKE $2) LIMIT 30',
      fields:['student_name','status','amount'] },
    { key:'fee_payments', label:'Payments', icon:'💳', color:'#16a34a', link:'/payments?id=',
      sql:'SELECT id, payer_name as name, status||\' | \'||amount::text as sub, \'\' as email, \'Payment\' as _type FROM fee_payments WHERE tenant_id=$1 AND (payer_name ILIKE $2 OR status ILIKE $2) LIMIT 30',
      fields:['payer_name','status','amount'] },
    { key:'reservations', label:'Reservations', icon:'🏨', color:'#2563eb', link:'/hotel/reservation?id=',
      sql:'SELECT id, guest_name as name, status||\' | \'||COALESCE(guest_email,\'\') as sub, guest_email as email, \'Reservation\' as _type FROM hotel_reservations WHERE tenant_id=$1 AND (guest_name ILIKE $2 OR guest_email ILIKE $2 OR status ILIKE $2) LIMIT 30',
      fields:['guest_name','guest_email','status'] },
    { key:'orders', label:'Orders', icon:'🍽️', color:'#9333ea', link:'/restaurant/order?id=',
      sql:'SELECT id, customer_name as name, status as sub, \'\' as email, \'Order\' as _type FROM restaurant_orders WHERE tenant_id=$1 AND (customer_name ILIKE $2 OR status ILIKE $2) LIMIT 30',
      fields:['customer_name','status'] },
    { key:'products', label:'Products', icon:'🛍️', color:'#e11d48', link:'/retail/product?id=',
      sql:'SELECT id, name, category||\' | \'||COALESCE(brand,\'\') as sub, \'\' as email, \'Product\' as _type FROM retail_products WHERE tenant_id=$1 AND (name ILIKE $2 OR category ILIKE $2 OR brand ILIKE $2) LIMIT 30',
      fields:['name','category','brand'] },
    { key:'retail_sales', label:'Retail Sales', icon:'🧾', color:'#0d9488', link:'/retail/sale?id=',
      sql:'SELECT id, receipt_number as name, customer_name as sub, \'\' as email, \'Sale\' as _type FROM retail_sales WHERE tenant_id=$1 AND (receipt_number ILIKE $2 OR customer_name ILIKE $2) LIMIT 30',
      fields:['receipt_number','customer_name'] },
    { key:'appointments', label:'Appointments', icon:'💇', color:'#d946ef', link:'/salon/appointment?id=',
      sql:'SELECT id, client_name as name, status as sub, \'\' as email, \'Appointment\' as _type FROM salon_appointments WHERE tenant_id=$1 AND (client_name ILIKE $2 OR status ILIKE $2) LIMIT 30',
      fields:['client_name','status'] },
    { key:'pharmacy', label:'Pharmacy', icon:'💊', color:'#475569', link:'/pharmacy/drug?id=',
      sql:'SELECT id, name, generic_name||\' | \'||COALESCE(category,\'\') as sub, \'\' as email, \'Drug\' as _type FROM pharmacy_drugs WHERE tenant_id=$1 AND (name ILIKE $2 OR generic_name ILIKE $2 OR category ILIKE $2) LIMIT 30',
      fields:['name','generic_name','category'] },
    { key:'gym', label:'Gym Members', icon:'🏋️', color:'#f97316', link:'/gym/member?id=',
      sql:'SELECT id, name, email, status as sub, \'Gym Member\' as _type FROM gym_members WHERE tenant_id=$1 AND (name ILIKE $2 OR email ILIKE $2 OR status ILIKE $2) LIMIT 30',
      fields:['name','email','status'] },
    { key:'announcements', label:'Announcements', icon:'📢', color:'#6366f1', link:'/announcements?id=',
      sql:'SELECT id, title as name, LEFT(content,80) as sub, \'\' as email, \'Announcement\' as _type FROM announcements WHERE tenant_id=$1 AND (title ILIKE $2 OR content ILIKE $2) LIMIT 30',
      fields:['title','content'] },
    { key:'chat', label:'Chat Messages', icon:'💬', color:'#0ea5e9', link:'#',
      sql:'SELECT id, sender_email as name, LEFT(message_text,100) as sub, \'\' as email, \'Message\' as _type FROM chat_messages WHERE tenant_id=$1 AND (message_text ILIKE $2 OR sender_email ILIKE $2) LIMIT 30',
      fields:['message_text','sender_email'] },
  ];

  // ============================================================
  // SHARED CSS
  // ============================================================
  const SA_CSS = `<style>
.sa-wrap{max-width:1200px;margin:0 auto}
.sa-search-box{display:flex;gap:0;margin-bottom:24px;max-width:700px;margin-left:auto;margin-right:auto}
.sa-search-box input{flex:1;padding:14px 20px;border:2px solid #e2e8f0;border-right:none;border-radius:12px 0 0 12px;font-size:15px;outline:none;transition:.15s}
.sa-search-box input:focus{border-color:#6366f1}
.sa-search-box button{padding:14px 28px;background:#6366f1;color:#fff;border:2px solid #6366f1;border-radius:0 12px 12px 0;font-size:15px;font-weight:600;cursor:pointer}
.sa-search-box button:hover{background:#4f46e5}
.sa-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
.sa-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.sa-nav a:hover{background:#e2e8f0}
.sa-nav a.active{background:#6366f1;color:#fff}
.sa-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}
.sa-stat{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center}
.sa-stat-val{font-size:24px;font-weight:800;color:#1e293b}
.sa-stat-lbl{font-size:11px;color:#94a3b8;margin-top:2px}
.sa-group{margin-bottom:24px}
.sa-group-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid #f1f5f9}
.sa-group-count{background:#f1f5f9;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600;color:#64748b}
.sa-result{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:10px;transition:.1s;text-decoration:none;color:inherit}
.sa-result:hover{background:#f8fafc}
.sa-result-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.sa-result-name{font-size:14px;font-weight:600;color:#1e293b}
.sa-result-sub{font-size:12px;color:#94a3b8;margin-top:1px}
.sa-badge{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600}
.sa-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.sa-filter label{font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:2px}
.sa-filter input,.sa-filter select{padding:8px 12px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;outline:none}
.sa-filter input:focus,.sa-filter select:focus{border-color:#6366f1}
table.sa-table{width:100%;border-collapse:collapse;font-size:13px}
.sa-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#475569;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.3px;background:#f8fafc}
.sa-table td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.sa-table tr:hover{background:#f8fafc}
.sa-empty{text-align:center;padding:60px 20px;color:#94a3b8}
.sa-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.sa-btn:hover{opacity:.85}
.sa-btn-primary{background:#6366f1;color:#fff}
.sa-btn-secondary{background:#f1f5f9;color:#475569}
.sa-charts{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}
.sa-chart{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px}
.sa-chart-title{font-size:14px;font-weight:700;color:#1e293b;margin-bottom:12px}
@media(max-width:768px){.sa-charts{grid-template-columns:1fr}.sa-search-box{flex-direction:column}.sa-search-box input{border-radius:12px;border-right:2px solid #e2e8f0}.sa-search-box button{border-radius:12px}}
</style>`;

  // ============================================================
  // CORE SEARCH ENGINE
  // ============================================================
  async function performSearch(tenantId, query, typeFilter) {
    const q = '%' + query.trim() + '%';
    const results = {};
    const entities = typeFilter && typeFilter !== 'all'
      ? SEARCH_ENTITIES.filter(e => e.key === typeFilter)
      : SEARCH_ENTITIES;
    const promises = entities.map(async (entity) => {
      try {
        const res = await pool.query(entity.sql, [tenantId, q]);
        if (res.rows.length > 0) results[entity.key] = { meta: entity, rows: res.rows };
      } catch (err) {
        // Table may not exist in this tenant — silently skip
      }
    });
    await Promise.all(promises);
    return results;
  }

  function renderResultRow(row, meta, query) {
    const name = esc(row.name || row.full_name || 'Untitled');
    const sub = esc(row.sub || row.email || '');
    const hlName = highlight(row.name || row.full_name || '', query);
    const hlSub = highlight(row.sub || '', query);
    const emailPart = row.email ? '<span style="color:#94a3b8;font-size:12px">' + highlight(row.email, query) + '</span>' : '';
    return `<a href="${meta.link}${row.id}" class="sa-result">
      <div class="sa-result-icon" style="background:${meta.color}15">${meta.icon}</div>
      <div style="flex:1;min-width:0">
        <div class="sa-result-name">${hlName}</div>
        ${hlSub ? '<div class="sa-result-sub">' + hlSub + '</div>' : ''}
        ${emailPart}
      </div>
      <span class="sa-badge" style="background:${meta.color}18;color:${meta.color}">${esc(meta.label)}</span>
    </a>`;
  }

  // ============================================================
  // ROUTE 1: GET /search — Global Search Page
  // ============================================================
  app.get('/search', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const q = (req.query.q || '').trim();
    const typeFilter = req.query.type || 'all';

    let results = {};
    if (q.length >= 2) {
      results = await performSearch(tid, q, typeFilter);
    }

    const totalResults = Object.values(results).reduce((s, g) => s + g.rows.length, 0);
    const groupedHtml = Object.entries(results).sort((a, b) => b[1].rows.length - a[1].rows.length).map(([key, group]) => {
      const m = group.meta;
      return `<div class="sa-group">
        <div class="sa-group-head">
          <span style="font-size:18px">${m.icon}</span>
          <span style="font-weight:700;color:#1e293b">${esc(m.label)}</span>
          <span class="sa-group-count">${group.rows.length} result${group.rows.length !== 1 ? 's' : ''}</span>
          <div style="flex:1"></div>
          <a href="/search?q=${encodeURIComponent(q)}&type=${key}" class="sa-btn sa-btn-secondary" style="font-size:12px;padding:4px 12px">View All</a>
        </div>
        ${group.rows.slice(0, 8).map(row => renderResultRow(row, m, q)).join('')}
        ${group.rows.length > 8 ? '<div style="text-align:center;padding:8px"><a href="/search/advanced?q=' + encodeURIComponent(q) + '&type=' + key + '" style="color:#6366f1;font-size:13px;font-weight:600;text-decoration:none">Show all ' + group.rows.length + ' results →</a></div>' : ''}
      </div>`;
    }).join('');

    const html = SA_CSS + `<div class="sa-wrap">
      <div style="text-align:center;margin-bottom:8px">
        <h1 style="font-size:26px;color:#1e293b">🔍 Global Search</h1>
        <p style="font-size:13px;color:#94a3b8">Search across students, staff, members, inventory, orders, and more</p>
      </div>
      <form action="/search" method="GET" class="sa-search-box">
        <input type="text" name="q" value="${esc(q)}" placeholder="Search for students, staff, invoices, patients..." autocomplete="off" autofocus>
        <button type="submit">Search</button>
      </form>
      <div style="text-align:center;margin-bottom:20px">
        <div class="sa-nav" style="justify-content:center">
          ${SEARCH_ENTITIES.slice(0, 8).map(e => `<a href="/search?q=${encodeURIComponent(q)}&type=${e.key}" class="${typeFilter === e.key ? 'active' : ''}">${e.icon} ${e.label}</a>`).join('')}
        </div>
      </div>
      ${q.length >= 2 ? `
        <div class="sa-stats">
          <div class="sa-stat"><div class="sa-stat-val" style="color:#6366f1">${totalResults}</div><div class="sa-stat-lbl">Total Results</div></div>
          <div class="sa-stat"><div class="sa-stat-val" style="color:#059669">${Object.keys(results).length}</div><div class="sa-stat-lbl">Entity Types</div></div>
          <div class="sa-stat"><div class="sa-stat-val" style="color:#f59e0b">${q.split(' ').length}</div><div class="sa-stat-lbl">Keywords</div></div>
        </div>
        ${totalResults > 0 ? groupedHtml : `<div class="sa-empty"><div style="font-size:48px;margin-bottom:12px">🔍</div><p>No results found for "<strong>${esc(q)}</strong>"</p><p style="font-size:13px;margin-top:8px">Try different keywords or broaden your search</p></div>`}
      ` : `<div class="sa-empty"><div style="font-size:48px;margin-bottom:12px">🔎</div><p>Enter at least 2 characters to search</p><p style="font-size:13px;margin-top:8px">Searches across ${SEARCH_ENTITIES.length} entity types in your organization</p></div>`}
      <div style="margin-top:20px;text-align:center">
        <a href="/search/advanced" class="sa-btn sa-btn-secondary">Advanced Search</a>
        <a href="/audit-log" class="sa-btn sa-btn-secondary" style="margin-left:8px">📋 Audit Log</a>
      </div>
    </div>`;
    res.send(renderPage('Global Search' + (q ? ' — ' + q : ''), html, user));
    audit(user.email, 'search', 'Global search: ' + q);
  }));

  // ============================================================
  // ROUTE 2: GET /search/advanced — Advanced Search Form
  // ============================================================
  app.get('/search/advanced', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const q = (req.query.q || '').trim();
    const typeFilter = req.query.type || 'all';
    const statusFilter = (req.query.status || '').trim();
    const dateFrom = req.query.date_from || '';
    const dateTo = req.query.date_to || '';
    const sortBy = req.query.sort || 'name';
    const perPage = Math.min(100, Math.max(10, parseInt(req.query.per_page) || 25));
    const page = Math.max(1, parseInt(req.query.page) || 1);

    let results = {};
    let flatRows = [];
    if (q.length >= 2) {
      results = await performSearch(tid, q, typeFilter);
      Object.entries(results).forEach(([key, group]) => {
        group.rows.forEach(row => {
          flatRows.push({ ...row, _entity_key: key, _entity_meta: group.meta });
        });
      });
      // Sort
      flatRows.sort((a, b) => {
        if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
        return 0;
      });
      flatRows = flatRows.slice((page - 1) * perPage, page * perPage);
    }
    const totalFlat = Object.values(results).reduce((s, g) => s + g.rows.length, 0);
    const totalPages = Math.ceil(totalFlat / perPage);

    const typeOptions = [{ key:'all', label:'All Entities' }, ...SEARCH_ENTITIES.map(e => ({ key:e.key, label:e.icon + ' ' + e.label }))];
    const tableHtml = flatRows.length ? `<table class="sa-table"><thead><tr>
      <th>Type</th><th>Name / ID</th><th>Details</th><th>Sub-info</th><th>Actions</th>
    </tr></thead><tbody>${flatRows.map(row => {
      const m = row._entity_meta;
      return `<tr>
        <td><span class="sa-badge" style="background:${m.color}18;color:${m.color}">${m.icon} ${esc(m.label)}</span></td>
        <td style="font-weight:600">${highlight(row.name || row.full_name || '', q)}</td>
        <td>${highlight(row.sub || '', q)}</td>
        <td>${highlight(row.email || '', q)}</td>
        <td><a href="${m.link}${row.id}" class="sa-btn sa-btn-primary" style="padding:4px 12px;font-size:12px">View</a></td>
      </tr>`;
    }).join('')}</tbody></table>` : (q.length >= 2 ? '<div class="sa-empty"><p>No results found.</p></div>' : '');

    const paginationHtml = totalPages > 1 ? `<div style="display:flex;justify-content:center;gap:8px;align-items:center;margin-top:16px">
      <span style="font-size:13px;color:#64748b">Page ${page} of ${totalPages} (${totalFlat} total)</span>
      ${page > 1 ? `<a href="/search/advanced?q=${encodeURIComponent(q)}&type=${typeFilter}&sort=${sortBy}&per_page=${perPage}&page=${page-1}" class="sa-btn sa-btn-secondary">← Prev</a>` : ''}
      ${page < totalPages ? `<a href="/search/advanced?q=${encodeURIComponent(q)}&type=${typeFilter}&sort=${sortBy}&per_page=${perPage}&page=${page+1}" class="sa-btn sa-btn-primary">Next →</a>` : ''}
    </div>` : '';

    const html = SA_CSS + `<div class="sa-wrap">
      <a href="/search" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Search</a>
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:4px">🧩 Advanced Search</h1>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Multi-field search with filters and sorting</p>
      <div class="card" style="margin-bottom:20px">
        <form method="GET" action="/search/advanced">
          <div class="sa-filter">
            <div style="flex:1;min-width:200px"><label>Keyword</label><input type="text" name="q" value="${esc(q)}" placeholder="Search keyword..." style="width:100%"></div>
            <div><label>Entity Type</label><select name="type" style="width:180px">${typeOptions.map(o => '<option value="' + o.key + '"' + (typeFilter === o.key ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('')}</select></div>
            <div><label>Status</label><input type="text" name="status" value="${esc(statusFilter)}" placeholder="e.g. active" style="width:120px"></div>
            <div><label>Date From</label><input type="date" name="date_from" value="${esc(dateFrom)}" style="width:150px"></div>
            <div><label>Date To</label><input type="date" name="date_to" value="${esc(dateTo)}" style="width:150px"></div>
            <div><label>Sort By</label><select name="sort" style="width:130px">
              <option value="name"${sortBy==='name'?' selected':''}>Name</option>
              <option value="date"${sortBy==='date'?' selected':''}>Date</option>
              <option value="amount"${sortBy==='amount'?' selected':''}>Amount</option>
            </select></div>
            <div><label>Per Page</label><select name="per_page" style="width:90px">
              ${[10,25,50,100].map(n => '<option value="'+n+'"'+(perPage===n?' selected':'')+'>'+n+'</option>').join('')}
            </select></div>
            <button type="submit" class="sa-btn sa-btn-primary" style="margin-top:auto">🔍 Search</button>
            <a href="/search/advanced" class="sa-btn sa-btn-secondary" style="margin-top:auto">Clear</a>
          </div>
        </form>
      </div>
      ${q.length >= 2 ? `<div class="sa-stats">
        <div class="sa-stat"><div class="sa-stat-val" style="color:#6366f1">${totalFlat}</div><div class="sa-stat-lbl">Results</div></div>
        <div class="sa-stat"><div class="sa-stat-val" style="color:#059669">${Object.keys(results).length}</div><div class="sa-stat-lbl">Types Matched</div></div>
      </div>` : ''}
      <div class="card">${tableHtml}</div>
      ${paginationHtml}
    </div>`;
    res.send(renderPage('Advanced Search', html, user));
    if (q.length >= 2) audit(user.email, 'search', 'Advanced search: ' + q + ' type=' + typeFilter);
  }));

  // ============================================================
  // ROUTE 3: GET /search/api — JSON Autocomplete API
  // ============================================================
  app.get('/search/api', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const q = (req.query.q || '').trim();
    const typeFilter = req.query.type || 'all';

    if (q.length < 2) return res.json({ results: [], query: q, total: 0 });

    const results = await performSearch(tid, q, typeFilter);
    const flat = [];
    Object.entries(results).forEach(([key, group]) => {
      group.rows.slice(0, 20).forEach(row => {
        flat.push({
          type: key, typeLabel: group.meta.label, icon: group.meta.icon,
          color: group.meta.color, id: row.id,
          name: row.name || row.full_name || '',
          email: row.email || '', sub: row.sub || '',
          link: group.meta.link + row.id
        });
      });
    });

    res.json({ results: flat.slice(0, 20), query: q, total: flat.length });
  }));

  // ============================================================
  // AUDIT LOG HELPERS
  // ============================================================
  function buildAuditWhere(req, params, paramIdx) {
    const tid = req.session.user.tenant_id;
    const isSuper = req.session.user.role === 'super_admin';
    const conditions = [];
    let pi = paramIdx;
    if (!isSuper) { conditions.push('tenant_id = $' + pi++); params.push(tid); }
    const u = (req.query.user || '').trim();
    const a = (req.query.action || '').trim();
    const s = (req.query.severity || '').trim();
    const df = (req.query.date_from || '').trim();
    const dt = (req.query.date_to || '').trim();
    if (u) { conditions.push('user_email ILIKE $' + pi++); params.push('%' + u + '%'); }
    if (a) { conditions.push('action ILIKE $' + pi++); params.push('%' + a + '%'); }
    if (s) { conditions.push('severity = $' + pi++); params.push(s); }
    if (df) { conditions.push('created_at >= $' + pi++); params.push(df); }
    if (dt) { conditions.push('created_at <= $' + pi++); params.push(dt + ' 23:59:59'); }
    return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', pi, filters: { user: u, action: a, severity: s, date_from: df, date_to: dt } };
  }

  function severityBadge(s) {
    const m = { critical:'background:#dc2626;color:#fff', warning:'background:#f59e0b;color:#fff', info:'background:#3b82f6;color:#fff', security:'background:#7c3aed;color:#fff' };
    return '<span class="sa-badge" style="' + (m[s] || m.info) + '">' + esc(s || 'info') + '</span>';
  }

  function filterBar(filters, extra) {
    const u = encodeURIComponent(filters.user), a = encodeURIComponent(filters.action), s = encodeURIComponent(filters.severity), df = encodeURIComponent(filters.date_from), dt = encodeURIComponent(filters.date_to);
    const qs = 'user=' + u + '&action=' + a + '&severity=' + s + '&date_from=' + df + '&date_to=' + dt;
    return `<div class="card" style="margin-bottom:16px"><form method="GET" action="${extra || '/audit-log'}" class="sa-filter">
      <div><label>User</label><input name="user" value="${esc(filters.user)}" placeholder="Filter by email..." style="width:170px"></div>
      <div><label>Action</label><input name="action" value="${esc(filters.action)}" placeholder="e.g. login, create..." style="width:170px"></div>
      <div><label>Severity</label><select name="severity" style="width:130px">
        <option value="">All Levels</option>
        <option value="info"${filters.severity==='info'?' selected':''}>Info</option>
        <option value="warning"${filters.severity==='warning'?' selected':''}>Warning</option>
        <option value="critical"${filters.severity==='critical'?' selected':''}>Critical</option>
        <option value="security"${filters.severity==='security'?' selected':''}>Security</option>
      </select></div>
      <div><label>From</label><input name="date_from" type="date" value="${esc(filters.date_from)}" style="width:145px"></div>
      <div><label>To</label><input name="date_to" type="date" value="${esc(filters.date_to)}" style="width:145px"></div>
      <button type="submit" class="sa-btn sa-btn-primary">Apply</button>
      <a href="${extra || '/audit-log'}" class="sa-btn sa-btn-secondary">Clear</a>
    </form></div>`;
  }

  // ============================================================
  // ROUTE 4: GET /audit-log — Audit Log Viewer
  // ============================================================
  app.get('/audit-log', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const params = [];
    const { where, pi, filters } = buildAuditWhere(req, params, 1);
    const countRes = await pool.query('SELECT COUNT(*) as cnt FROM audit_logs ' + where, params);
    const total = parseInt(countRes.rows[0].cnt);
    const totalPages = Math.ceil(total / limit);

    const dataParams = [...params, limit, offset];
    const logRes = await pool.query('SELECT * FROM audit_logs ' + where + ' ORDER BY created_at DESC LIMIT $' + pi + ' OFFSET $' + (pi + 1), dataParams);
    const logs = logRes.rows;

    const sevCounts = { critical: 0, warning: 0, info: 0, security: 0 };
    logs.forEach(l => { if (sevCounts[l.severity] !== undefined) sevCounts[l.severity]++; });

    const u = encodeURIComponent(filters.user), a = encodeURIComponent(filters.action), s = encodeURIComponent(filters.severity), df = encodeURIComponent(filters.date_from), dt = encodeURIComponent(filters.date_to);
    const qs = 'user=' + u + '&action=' + a + '&severity=' + s + '&date_from=' + df + '&date_to=' + dt;
    const pageLink = (p) => '/audit-log?' + qs + '&page=' + p;

    const rowsHtml = logs.map(l => `<tr${l.severity === 'critical' ? ' style="background:#fef2f2"' : ''}>
      <td style="white-space:nowrap;font-size:12px;color:#64748b">${fmtDT(l.created_at)}</td>
      <td style="font-weight:500">${esc(l.user_email || '-')}</td>
      <td><span class="sa-badge" style="background:#f1f5f9;color:#475569">${esc(l.action || '-')}</span></td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.details || '')}">${esc((l.details || '').substring(0, 100))}</td>
      <td style="font-family:monospace;font-size:12px;color:#94a3b8">${esc(l.ip_address || '-')}</td>
      <td>${severityBadge(l.severity)}</td>
    </tr>`).join('');

    const html = SA_CSS + `<div class="sa-wrap">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📋 Audit Log</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${total.toLocaleString()} events recorded</p></div>
        <div style="display:flex;gap:8px">
          <a href="/audit-log/export?${qs}" class="sa-btn sa-btn-primary">📥 Export CSV</a>
          <a href="/audit-log/stats" class="sa-btn sa-btn-secondary">📊 Statistics</a>
        </div>
      </div>
      <div class="sa-stats">
        <div class="sa-stat"><div class="sa-stat-val" style="color:#6366f1">${total}</div><div class="sa-stat-lbl">Total Events</div></div>
        <div class="sa-stat"><div class="sa-stat-val" style="color:#dc2626">${sevCounts.critical}</div><div class="sa-stat-lbl">Critical</div></div>
        <div class="sa-stat"><div class="sa-stat-val" style="color:#f59e0b">${sevCounts.warning}</div><div class="sa-stat-lbl">Warnings</div></div>
        <div class="sa-stat"><div class="sa-stat-val" style="color:#3b82f6">${sevCounts.info}</div><div class="sa-stat-lbl">Info</div></div>
        <div class="sa-stat"><div class="sa-stat-val" style="color:#7c3aed">${sevCounts.security}</div><div class="sa-stat-lbl">Security</div></div>
      </div>
      ${filterBar(filters)}
      <div class="card"><div style="overflow-x:auto"><table class="sa-table">
        <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Details</th><th>IP Address</th><th>Severity</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table></div>
      ${logs.length === 0 ? '<div class="sa-empty"><p>No audit events found for the selected filters.</p></div>' : ''}</div>
      ${totalPages > 1 ? `<div style="display:flex;justify-content:center;gap:8px;align-items:center;margin-top:16px">
        <span style="font-size:13px;color:#64748b">Page ${page} of ${totalPages}</span>
        ${page > 1 ? '<a href="' + pageLink(page-1) + '" class="sa-btn sa-btn-secondary">← Prev</a>' : ''}
        ${page < totalPages ? '<a href="' + pageLink(page+1) + '" class="sa-btn sa-btn-primary">Next →</a>' : ''}
      </div>` : ''}
      <div style="margin-top:16px"><a href="/search" class="sa-btn sa-btn-secondary">🔍 Global Search</a></div>
    </div>`;
    res.send(renderPage('Audit Log', html, user));
  }));

  // ============================================================
  // ROUTE 5: GET /audit-log/export — CSV Export
  // ============================================================
  app.get('/audit-log/export', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const params = [];
    const { where } = buildAuditWhere(req, params, 1);
    const result = await pool.query('SELECT * FROM audit_logs ' + where + ' ORDER BY created_at DESC LIMIT 50000', params);
    const headers = ['Timestamp','User Email','Action','Details','IP Address','User Agent','Resource Type','Resource ID','Severity'];
    const lines = [headers.map(h => '"' + h + '"').join(',')];
    result.rows.forEach(r => {
      lines.push([
        r.created_at ? new Date(r.created_at).toISOString() : '',
        r.user_email || '', r.action || '',
        (r.details || '').replace(/"/g, '""'),
        r.ip_address || '', (r.user_agent || '').replace(/"/g, '""'),
        r.resource_type || '', r.resource_id || '', r.severity || 'info'
      ].map(v => '"' + v + '"').join(','));
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log-' + new Date().toISOString().slice(0, 10) + '.csv"');
    res.send(lines.join('\r\n'));
    audit(user.email, 'data_export', 'Exported ' + result.rows.length + ' audit log entries');
  }));

  // ============================================================
  // ROUTE 6: GET /audit-log/stats — Audit Statistics Dashboard
  // ============================================================
  app.get('/audit-log/stats', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const isSuper = user.role === 'super_admin';
    const tenantWhere = isSuper ? '' : 'WHERE tenant_id = $1';
    const tenantParams = isSuper ? [] : [tid];

    // Core stats
    const totalRes = (await pool.query('SELECT COUNT(*) as cnt FROM audit_logs ' + tenantWhere, tenantParams)).rows[0];
    const usersRes = (await pool.query('SELECT COUNT(DISTINCT user_email) as cnt FROM audit_logs ' + tenantWhere, tenantParams)).rows[0];
    const topUserRes = (await pool.query('SELECT user_email, COUNT(*) as cnt FROM audit_logs ' + (tenantWhere ? tenantWhere + ' AND ' : 'WHERE ') + ' user_email IS NOT NULL GROUP BY user_email ORDER BY cnt DESC LIMIT 1', tenantParams)).rows[0];
    const topActionRes = (await pool.query('SELECT action, COUNT(*) as cnt FROM audit_logs ' + (tenantWhere ? tenantWhere + ' AND ' : 'WHERE ') + ' action IS NOT NULL GROUP BY action ORDER BY cnt DESC LIMIT 1', tenantParams)).rows[0];

    // Activity timeline — last 30 days
    const timelineRes = (await pool.query(
      `SELECT DATE(created_at) as day, COUNT(*) as cnt FROM audit_logs ` +
      (isSuper ? 'WHERE' : 'WHERE tenant_id = $1 AND') + ` created_at >= NOW() - INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY day`,
      isSuper ? [] : [tid]
    )).rows;

    // Top 10 users by activity
    const topUsersRes = (await pool.query(
      `SELECT user_email, COUNT(*) as cnt FROM audit_logs ` +
      (isSuper ? 'WHERE' : 'WHERE tenant_id = $1 AND') + ` user_email IS NOT NULL GROUP BY user_email ORDER BY cnt DESC LIMIT 10`,
      isSuper ? [] : [tid]
    )).rows;

    // Action type distribution
    const actionDistRes = (await pool.query(
      `SELECT action, COUNT(*) as cnt FROM audit_logs ` +
      (isSuper ? 'WHERE' : 'WHERE tenant_id = $1 AND') + ` action IS NOT NULL GROUP BY action ORDER BY cnt DESC LIMIT 8`,
      isSuper ? [] : [tid]
    )).rows;

    // Severity breakdown
    const sevRes = (await pool.query(
      `SELECT severity, COUNT(*) as cnt FROM audit_logs ` +
      (isSuper ? 'WHERE' : 'WHERE tenant_id = $1') + ` GROUP BY severity ORDER BY cnt DESC`,
      isSuper ? [] : [tid]
    )).rows;

    // === SVG CHART BUILDERS ===

    // Bar chart — Activity Timeline (30 days)
    const maxDay = Math.max(...timelineRes.map(r => r.cnt), 1);
    const barW = 22, barGap = 4, chartH = 140, chartW = Math.min(700, timelineRes.length * (barW + barGap));
    let timelineSvg = `<svg width="${chartW}" height="${chartH + 40}" viewBox="0 0 ${chartW} ${chartH + 40}">`;
    timelineSvg += `<rect width="${chartW}" height="${chartH + 40}" fill="none"/>`;
    // Grid lines
    for (let i = 0; i <= 4; i++) {
      const y = 10 + (chartH / 4) * i;
      timelineSvg += `<line x1="0" y1="${y}" x2="${chartW}" y2="${y}" stroke="#f1f5f9" stroke-width="1"/>`;
    }
    timelineRes.forEach((r, i) => {
      const h = Math.max(2, (r.cnt / maxDay) * chartH);
      const x = i * (barW + barGap);
      const y = 10 + chartH - h;
      const dayLabel = r.day ? r.day.slice(5) : '';
      timelineSvg += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="#6366f1" opacity="0.8"><title>${esc(r.day)}: ${r.cnt} events</title></rect>`;
      if (i % 5 === 0) timelineSvg += `<text x="${x + barW/2}" y="${chartH + 26}" text-anchor="middle" font-size="9" fill="#94a3b8">${dayLabel}</text>`;
    });
    timelineSvg += '</svg>';

    // Bar chart — Top Users
    const maxUser = Math.max(...topUsersRes.map(r => r.cnt), 1);
    let usersSvg = `<svg width="350" height="${Math.min(320, topUsersRes.length * 32)}" viewBox="0 0 350 ${Math.min(320, topUsersRes.length * 32)}">`;
    topUsersRes.forEach((r, i) => {
      const y = i * 32;
      const w = Math.max(4, (r.cnt / maxUser) * 220);
      usersSvg += `<text x="0" y="${y + 14}" font-size="12" fill="#475569" font-weight="500">${esc((r.user_email || '').split('@')[0])}</text>`;
      usersSvg += `<rect x="120" y="${y + 2}" width="${w}" height="16" rx="4" fill="#4f46e5" opacity="0.8"><title>${esc(r.user_email)}: ${r.cnt}</title></rect>`;
      usersSvg += `<text x="${124 + w}" y="${y + 14}" font-size="11" fill="#64748b">${r.cnt}</text>`;
    });
    usersSvg += '</svg>';

    // Donut chart — Action Distribution
    const totalActions = actionDistRes.reduce((s, r) => s + r.cnt, 0) || 1;
    const donutColors = ['#6366f1','#06b6d4','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#64748b'];
    let donutPath = '';
    let cumPct = 0;
    const cx = 90, cy = 90, r = 70, sw = 28;
    actionDistRes.forEach((r, i) => {
      const pct = r.cnt / totalActions;
      const startAngle = cumPct * 360 - 90;
      const endAngle = (cumPct + pct) * 360 - 90;
      const s1 = (startAngle * Math.PI) / 180, e1 = (endAngle * Math.PI) / 180;
      const large = pct > 0.5 ? 1 : 0;
      const x1 = cx + r * Math.cos(s1), y1 = cy + r * Math.sin(s1);
      const x2 = cx + r * Math.cos(e1), y2 = cy + r * Math.sin(e1);
      donutPath += `<path d="M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2}" fill="none" stroke="${donutColors[i % donutColors.length]}" stroke-width="${sw}" opacity="0.85"><title>${esc(r.action)}: ${r.cnt} (${(pct * 100).toFixed(1)}%)</title></path>`;
      cumPct += pct;
    });
    const actionLegend = actionDistRes.map((r, i) =>
      `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><div style="width:12px;height:12px;border-radius:3px;background:${donutColors[i % donutColors.length]}"></div><span style="font-size:12px;color:#475569">${esc(r.action)}</span><span style="font-size:11px;color:#94a3b8;margin-left:auto">${r.cnt}</span></div>`
    ).join('');
    const donutSvg = `<svg width="180" height="180" viewBox="0 0 180 180"><circle cx="${cx}" cy="${cy}" r="${r - sw/2}" fill="#f8fafc"/>${donutPath}<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="18" font-weight="800" fill="#1e293b">${totalActions}</text></svg>`;

    // Pie chart — Severity
    const sevColors = { info:'#3b82f6', warning:'#f59e0b', critical:'#dc2626', security:'#7c3aed' };
    const totalSev = sevRes.reduce((s, r) => s + r.cnt, 0) || 1;
    let piePath = '';
    let sCum = 0;
    const pcx = 90, pcy = 90, pr = 75;
    sevRes.forEach((r, i) => {
      const pct = r.cnt / totalSev;
      const startA = sCum * 360 - 90;
      const endA = (sCum + pct) * 360 - 90;
      const s1 = (startA * Math.PI) / 180, e1 = (endA * Math.PI) / 180;
      const large = pct > 0.5 ? 1 : 0;
      const x1 = pcx + pr * Math.cos(s1), y1 = pcy + pr * Math.sin(s1);
      const x2 = pcx + pr * Math.cos(e1), y2 = pcy + pr * Math.sin(e1);
      piePath += pct >= 1 ? `<circle cx="${pcx}" cy="${pcy}" r="${pr}" fill="${sevColors[r.severity] || '#64748b'}"/>` :
        `<path d="M${pcx} ${pcy} L${x1} ${y1} A${pr} ${pr} 0 ${large} 1 ${x2} ${y2} Z" fill="${sevColors[r.severity] || '#64748b'}" opacity="0.85"><title>${esc(r.severity)}: ${r.cnt} (${(pct*100).toFixed(1)}%)</title></path>`;
      sCum += pct;
    });
    const sevLegend = sevRes.map(r =>
      `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><div style="width:12px;height:12px;border-radius:3px;background:${sevColors[r.severity] || '#64748b'}"></div><span style="font-size:12px;color:#475569;text-transform:capitalize">${esc(r.severity || 'info')}</span><span style="font-size:11px;color:#94a3b8;margin-left:auto">${r.cnt} (${(r.cnt / totalSev * 100).toFixed(1)}%)</span></div>`
    ).join('');
    const pieSvg = `<svg width="180" height="180" viewBox="0 0 180 180">${piePath}</svg>`;

    const html = SA_CSS + `<div class="sa-wrap">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📊 Audit Statistics</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Activity insights and trends</p></div>
        <div style="display:flex;gap:8px">
          <a href="/audit-log" class="sa-btn sa-btn-secondary">📋 View Logs</a>
          <a href="/audit-log/export" class="sa-btn sa-btn-primary">📥 Export</a>
        </div>
      </div>

      <div class="sa-stats">
        <div class="sa-stat"><div class="sa-stat-val" style="color:#6366f1">${Number(totalRes.cnt).toLocaleString()}</div><div class="sa-stat-lbl">Total Actions</div></div>
        <div class="sa-stat"><div class="sa-stat-val" style="color:#059669">${Number(usersRes.cnt).toLocaleString()}</div><div class="sa-stat-lbl">Unique Users</div></div>
        <div class="sa-stat"><div class="sa-stat-val" style="color:#f59e0b" style="font-size:16px">${esc((topUserRes.user_email || '-').split('@')[0])}</div><div class="sa-stat-lbl">Most Active User</div></div>
        <div class="sa-stat"><div class="sa-stat-val" style="color:#7c3aed">${esc(topActionRes.action || '-')}</div><div class="sa-stat-lbl">Most Common Action</div></div>
      </div>

      <div class="sa-chart"><div class="sa-chart-title">📈 Activity Timeline (Last 30 Days)</div>
        <div style="overflow-x:auto">${timelineSvg}</div>
      </div>

      <div class="sa-charts">
        <div class="sa-chart"><div class="sa-chart-title">👥 Top Users by Activity</div>
          <div style="overflow-x:auto">${usersSvg}</div>
        </div>
        <div class="sa-chart">
          <div class="sa-chart-title">🏷️ Action Type Distribution</div>
          <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
            <div>${donutSvg}</div>
            <div style="flex:1;min-width:120px">${actionLegend}</div>
          </div>
        </div>
      </div>

      <div class="sa-charts">
        <div class="sa-chart">
          <div class="sa-chart-title">⚠️ Severity Breakdown</div>
          <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
            <div>${pieSvg}</div>
            <div style="flex:1;min-width:120px">${sevLegend}</div>
          </div>
        </div>
        <div class="sa-chart">
          <div class="sa-chart-title">📋 Recent Critical Events</div>
          ${(await pool.query(
            `SELECT user_email, action, details, created_at, ip_address FROM audit_logs ` +
            (isSuper ? 'WHERE' : 'WHERE tenant_id = $1 AND') + ` severity = 'critical' ORDER BY created_at DESC LIMIT 8`,
            isSuper ? [] : [tid]
          )).rows.map(r => `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9">
            <div style="display:flex;justify-content:space-between"><span style="font-weight:600;font-size:13px;color:#dc2626">${esc(r.action || '')}</span><span style="font-size:11px;color:#94a3b8">${fmtDT(r.created_at)}</span></div>
            <div style="font-size:12px;color:#64748b">${esc(r.user_email || '')} ${r.ip_address ? '• ' + esc(r.ip_address) : ''}</div>
            <div style="font-size:11px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px">${esc((r.details || '').substring(0, 100))}</div>
          </div>`).join('') || '<p style="color:#94a3b8;text-align:center;padding:20px">No critical events 🎉</p>'}
        </div>
      </div>

      <div style="margin-top:20px;text-align:center">
        <a href="/audit-log" class="sa-btn sa-btn-secondary">📋 Back to Audit Log</a>
        <a href="/search" class="sa-btn sa-btn-secondary" style="margin-left:8px">🔍 Global Search</a>
      </div>
    </div>`;
    res.send(renderPage('Audit Statistics', html, user));
    audit(user.email, 'view', 'Viewed audit statistics dashboard');
  }));

  // ============================================================
  // DONE
  // ============================================================
  logger.info('[SearchAudit] Module loaded — 6 routes registered');
};
