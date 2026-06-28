// src/routes/sync-api.js
//
// Offline sync API (extracted from server.js as part of the Conservative
// route-extraction refactor — Track 1, Task t1).
//
// Behavior is identical to the original inline handlers in server.js.
// The module exports a factory that accepts a shared context object so the
// route handlers can close over the same `pool`, `requireAuth`, `ah`, etc.
// that the rest of server.js uses — no behavior changes, no re-definitions.
//
// Mount point in server.js:
//   app.use('/api/sync', require('./src/routes/sync-api')(sharedCtx));

module.exports = function createSyncApiRouter(ctx) {
  const express = require('express');
  const router = express.Router();
  const { pool, requireAuth, ah } = ctx;

  // POST /api/sync/push — push offline actions queue
  router.post('/push', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { actions } = req.body;
    if (!Array.isArray(actions)) return res.status(400).json({ error: 'actions array required' });
    const results = [];
    for (const action of actions) {
      try {
        await pool.query('INSERT INTO offline_sync_queue(tenant_id,user_email,action,entity_type,entity_id,data) VALUES($1,$2,$3,$4,$5,$6)', [t, req.session.user.email, action.action, action.entity_type, action.entity_id, JSON.stringify(action.data)]);
        // Apply the action
        if (action.action === 'create' && action.entity_type === 'attendance' && action.data) {
          await pool.query('INSERT INTO attendance(tenant_id,student_id,date,status) VALUES($1,$2,$3,$4) ON CONFLICT(student_id,date) DO UPDATE SET status=$4', [t, action.data.student_id, action.data.date || new Date().toISOString().split('T')[0], action.data.status || 'present']);
        } else if (action.action === 'create' && action.entity_type === 'marks' && action.data) {
          await pool.query('INSERT INTO marks(tenant_id,student_id,subject,score,term,exam_type) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [t, action.data.student_id, action.data.subject, action.data.score, action.data.term||'Term 1', action.data.exam_type||'midterm']);
        } else if (action.action === 'create' && action.entity_type === 'fees' && action.data) {
          await pool.query('INSERT INTO fees(tenant_id,student_id,amount,payment_method,term) VALUES($1,$2,$3,$4,$5)', [t, action.data.student_id, action.data.amount, action.data.payment_method||'cash', action.data.term||'Term 1']);
        } else if (action.action === 'create' && action.entity_type === 'shop_sales' && action.data) {
          await pool.query('INSERT INTO school_shop_sales(tenant_id,item_id,quantity,total,buyer_type,buyer_name) VALUES($1,$2,$3,$4,$5,$6)', [t, action.data.item_id, action.data.quantity||1, action.data.total||0, action.data.buyer_type||'other', action.data.buyer_name||null]);
        } else if (action.action === 'create' && action.entity_type === 'donations' && action.data) {
          await pool.query('INSERT INTO campaign_donations(campaign_id,donor_name,amount,method,message) VALUES($1,$2,$3,$4,$5)', [action.data.campaign_id||null, action.data.donor_name||'Anonymous', action.data.amount||0, action.data.method||'cash', action.data.message||'']);
        } else if (action.action === 'update' && action.entity_type === 'attendance' && action.data) {
          await pool.query('UPDATE attendance SET status=$1 WHERE tenant_id=$2 AND student_id=$3 AND date=$4', [action.data.status, t, action.data.student_id, action.data.date]);
        }
        results.push({ id: action.id, status: 'synced' });
      } catch(e) {
        results.push({ id: action.id, status: 'error', error: e.message });
      }
    }
    res.json({ synced: results.filter(r => r.status === 'synced').length, errors: results.filter(r => r.status === 'error').length, results });
  }));

  // GET /api/sync/pull — pull changed records since timestamp
  router.get('/pull', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [students, fees, attendance, marks, shopSales, donations] = await Promise.all([
      pool.query('SELECT * FROM students WHERE tenant_id=$1 AND (created_at > $2 OR updated_at > $2) AND deleted_at IS NULL', [t, since]),
      pool.query('SELECT * FROM fees WHERE tenant_id=$1 AND created_at > $2', [t, since]),
      pool.query('SELECT * FROM attendance WHERE tenant_id=$1 AND date > $2', [t, since]),
      pool.query('SELECT * FROM marks WHERE tenant_id=$1 AND created_at > $2', [t, since]).catch(()=>({rows:[]})),
      pool.query('SELECT * FROM school_shop_sales WHERE tenant_id=$1 AND created_at > $2', [t, since]).catch(()=>({rows:[]})),
      pool.query('SELECT * FROM campaign_donations WHERE donated_at > $1', [since]).catch(()=>({rows:[]}))
    ]);
    res.json({ since: since.toISOString(), students: students.rows, fees: fees.rows, attendance: attendance.rows, marks: marks.rows, shop_sales: shopSales.rows, donations: donations.rows });
  }));

  return router;
};
