// src/routes/apiv1.js
//
// Public v1 REST API routes (extracted from server.js as part of the
// Conservative route-extraction refactor — Track 1, Task t1).
//
// Behavior is identical to the original inline handlers in server.js.
// The module exports a factory that accepts a shared context object so the
// route handlers can close over the same `pool`, `apiAuth`, `ah`, `upload`,
// etc. that the rest of server.js uses — no behavior changes, no
// re-definitions.
//
// Mount point in server.js:
//   app.use('/api/v1', require('./src/routes/apiv1')(sharedCtx));
//
// NOTE: The `/api/v1/openapi.json` route is intentionally NOT extracted —
// it is a single ~285-line JSON spec route that is easier to keep inline.

module.exports = function createApiV1Router(ctx) {
  const express = require('express');
  const router = express.Router();
  const { pool, apiAuth, ah, upload } = ctx;

  // GET /api/v1/students
  router.get('/students', apiAuth, ah(async (req, res) => {
    const students = (await pool.query('SELECT id,admission_no,name,class,stream,gender FROM students WHERE tenant_id=$1 ORDER BY name LIMIT 100', [req.apiKey.tenant_id])).rows;
    res.json({ data: students });
  }));

  // POST /api/v1/students
  router.post('/students', apiAuth, ah(async (req, res) => {
    const { name, admission_no, class: cls, stream, gender } = req.body;
    const result = await pool.query('INSERT INTO students(tenant_id,name,admission_no,class,stream,gender) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [req.apiKey.tenant_id, name, admission_no, cls, stream, gender]);
    res.json({ data: result.rows[0] });
  }));

  // GET /api/v1/fees
  router.get('/fees', apiAuth, ah(async (req, res) => {
    const fees = (await pool.query('SELECT f.*,s.name as student_name FROM fees f LEFT JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 ORDER BY f.created_at DESC LIMIT 100', [req.apiKey.tenant_id])).rows;
    res.json({ data: fees });
  }));

  // POST /api/v1/fees/pay
  router.post('/fees/pay', apiAuth, ah(async (req, res) => {
    const { fee_id, amount } = req.body;
    await pool.query('UPDATE fees SET paid=paid+$1 WHERE id=$2 AND tenant_id=$3', [amount, fee_id, req.apiKey.tenant_id]);
    res.json({ success: true });
  }));

  // GET /api/v1/inventory
  router.get('/inventory', apiAuth, ah(async (req, res) => {
    const items = (await pool.query('SELECT * FROM inventory WHERE tenant_id=$1 ORDER BY name', [req.apiKey.tenant_id])).rows;
    res.json({ data: items });
  }));

  // POST /api/v1/sales
  router.post('/sales', apiAuth, ah(async (req, res) => {
    const { customer_name, total, paid, items } = req.body;
    const sale = await pool.query('INSERT INTO sales(tenant_id,customer_name,total,paid,status) VALUES($1,$2,$3,$4,$5) RETURNING *', [req.apiKey.tenant_id, customer_name, total, paid||0, paid>=total?'paid':'partial']);
    if (items && Array.isArray(items)) {
      for (const item of items) {
        await pool.query('INSERT INTO sale_items(sale_id,inventory_id,quantity,price) VALUES($1,$2,$3,$4)', [sale.rows[0].id, item.inventory_id, item.quantity, item.price]);
        await pool.query('UPDATE inventory SET quantity=quantity-$1 WHERE id=$2', [item.quantity, item.inventory_id]);
      }
    }
    res.json({ data: sale.rows[0] });
  }));

  // GET /api/v1/members
  router.get('/members', apiAuth, ah(async (req, res) => {
    const members = (await pool.query('SELECT * FROM church_members WHERE tenant_id=$1 ORDER BY name', [req.apiKey.tenant_id])).rows;
    res.json({ data: members });
  }));

  // POST /api/v1/donations
  router.post('/donations', apiAuth, ah(async (req, res) => {
    const { donor_name, amount, type, method } = req.body;
    const result = await pool.query('INSERT INTO donations(tenant_id,donor_name,amount,type,method,is_tithe) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [req.apiKey.tenant_id, donor_name, amount, type, method, type==='tithe']);
    res.json({ data: result.rows[0] });
  }));

  // GET /api/v1/invoices
  router.get('/invoices', apiAuth, ah(async (req, res) => {
    const invoices = (await pool.query('SELECT * FROM invoices WHERE tenant_id=$1 ORDER BY created_at DESC', [req.apiKey.tenant_id])).rows;
    res.json({ data: invoices });
  }));

  // POST /api/v1/campaigns
  router.post('/campaigns', apiAuth, ah(async (req, res) => {
    const { title, description, target, start_date, end_date } = req.body;
    const result = await pool.query('INSERT INTO campaigns(tenant_id,title,description,target,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [req.apiKey.tenant_id, title, description, target, start_date, end_date]);
    res.json({ data: result.rows[0] });
  }));

  // === API: CSV EXPORT STUDENTS ===
  // GET /api/v1/students/export
  router.get('/students/export', apiAuth, ah(async (req, res) => {
    const students = (await pool.query('SELECT admission_no,name,class,stream,gender,guardian_name,guardian_phone FROM students WHERE tenant_id=$1 ORDER BY name', [req.apiKey.tenant_id])).rows;
    const headers = ['admission_no', 'name', 'class', 'stream', 'gender', 'guardian_name', 'guardian_phone'];
    const csv = [headers.join(','), ...students.map(s => headers.map(h => `"${(s[h] || '').toString().replace(/"/g, '""')}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=students_export.csv');
    res.send(csv);
  }));

  // === API: CSV IMPORT STUDENTS ===
  // POST /api/v1/students/import
  router.post('/students/import', apiAuth, upload.single('csv_file'), ah(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'CSV file required (field: csv_file)' });
    const lines = req.file.buffer.toString('utf-8').trim().split('\n');
    let imported = 0, errors = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      if (cols.length >= 2) {
        try {
          await pool.query('INSERT INTO students(tenant_id,admission_no,name,class,stream,gender,guardian_name,guardian_phone) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
            [req.apiKey.tenant_id, cols[0], cols[1], cols[2] || '', cols[3] || '', cols[4] || '', cols[5] || '', cols[6] || '']);
          imported++;
        } catch { errors++; }
      }
    }
    res.json({ imported, errors, total: lines.length - 1 });
  }));

  // === API: CSV EXPORT INVENTORY ===
  // GET /api/v1/inventory/export
  router.get('/inventory/export', apiAuth, ah(async (req, res) => {
    const items = (await pool.query('SELECT name,sku,quantity,unit_price,category FROM inventory WHERE tenant_id=$1 ORDER BY name', [req.apiKey.tenant_id])).rows;
    const headers = ['name', 'sku', 'quantity', 'unit_price', 'category'];
    const csv = [headers.join(','), ...items.map(i => headers.map(h => `"${(i[h] || '').toString().replace(/"/g, '""')}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=inventory_export.csv');
    res.send(csv);
  }));

  // === API: CSV EXPORT MEMBERS ===
  // GET /api/v1/members/export
  router.get('/members/export', apiAuth, ah(async (req, res) => {
    const members = (await pool.query('SELECT name,phone,email,membership_type,status FROM church_members WHERE tenant_id=$1 ORDER BY name', [req.apiKey.tenant_id])).rows;
    const headers = ['name', 'phone', 'email', 'membership_type', 'status'];
    const csv = [headers.join(','), ...members.map(m => headers.map(h => `"${(m[h] || '').toString().replace(/"/g, '""')}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=members_export.csv');
    res.send(csv);
  }));

  return router;
};
