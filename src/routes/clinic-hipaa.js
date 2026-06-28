// src/routes/clinic-hipaa.js
//
// HIPAA-compliant wrapper around clinic/EMR endpoints.
//
// Mount point in server.js:
//   app.use('/api/clinic', require('./src/routes/clinic-hipaa')(_routeSharedCtx));
//
// What this router does:
//   - For every read of a patient / consultation / prescription row, the
//     PHI fields are decrypted on the fly with `hipaa-encryption.js#decryptPHI`
//     using { tenant_id, patient_id, field_name } as AAD.
//   - For every write, the PHI fields are encrypted before INSERT/UPDATE.
//   - Every encrypt/decrypt operation is recorded in
//     `phi_encryption_audit_log` (HIPAA §164.312(b)).
//   - The `phi_encrypted` boolean column on each table is set true after
//     encryption, so a future backfill can distinguish ciphertext rows
//     from legacy plaintext rows.
//
// Scope:
//   This router exposes /api/clinic/patients/*, /api/clinic/consultations/*,
//   and /api/clinic/prescriptions/*. The existing inline /clinic/* UI routes
//   in server.js are NOT touched (Conservative refactor — see worklog).
//   Frontends that want HIPAA-encrypted PHI must use these /api/clinic/*
//   endpoints; the old /clinic/* UI routes continue to read plaintext until
//   a follow-up task migrates them.
//
// PHI fields per table:
//   patient_portal_users: full_name, date_of_birth, phone, address, email,
//                          emergency_contact_name, emergency_contact_phone
//   consultations:        chief_complaint, history, examination, diagnosis,
//                          treatment_plan, notes
//   prescriptions:        patient_name, diagnosis, notes
//
// AAD context:
//   { tenant_id, patient_id, field_name }
//   - For patient_portal_users, patient_id = the row's `id`.
//   - For consultations/prescriptions, patient_id = the row's `patient_id`
//     if set, otherwise the row's own `id` (still gives a per-record binding).
//
// Why per-field AAD matters:
//   If an attacker with DB write access copies an encrypted `phone` value
//   from patient A's row into patient B's row, decryptPHI on B's row will
//   throw (auth tag mismatch — the AAD includes patient_id). This means
//   ciphertexts can't be "moved" between records undetected, which is the
//   whole point of AES-GCM AAD.

'use strict';

module.exports = function createClinicHipaaRouter(ctx) {
  const express = require('express');
  const router = express.Router();
  const { pool, requireAuth, requireNotBanned, ah, esc } = ctx;

  const { encryptPHI, decryptPHI, isEncrypted } = require('../lib/hipaa-encryption');

  // -----------------------------------------------------------------------
  // Per-table PHI field configuration
  // -----------------------------------------------------------------------
  // The PK column is used to populate the `patient_id` part of the AAD
  // context (it's the row's unique identifier within the table).
  const TABLES = {
    patient_portal_users: {
      pk: 'id',
      phiFields: [
        'full_name', 'date_of_birth', 'phone', 'address', 'email',
        'emergency_contact_name', 'emergency_contact_phone',
      ],
      // Fields NOT in phiFields (used for INSERT): tenant_id, gender,
      // blood_type, otp_code, otp_expires, is_verified, etc.
      nonPhiFields: ['gender', 'blood_type', 'is_verified'],
    },
    consultations: {
      pk: 'id',
      phiFields: ['chief_complaint', 'history', 'examination', 'diagnosis', 'treatment_plan', 'notes'],
      nonPhiFields: ['patient_type', 'patient_id', 'doctor_id', 'queue_id', 'follow_up_date', 'status'],
    },
    prescriptions: {
      pk: 'id',
      phiFields: ['patient_name', 'diagnosis', 'notes'],
      nonPhiFields: ['consultation_id', 'patient_type', 'patient_id', 'doctor_id', 'doctor_name', 'status'],
    },
  };

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Build the AAD context for a single field on a single row.
   * @param {number} tenantId
   * @param {number} patientId  row PK (or patient_id for consultations/prescriptions)
   * @param {string} fieldName
   */
  function ctxFor(tenantId, patientId, fieldName) {
    return { tenant_id: tenantId, patient_id: patientId, field_name: fieldName };
  }

  /**
   * Decrypt every PHI field on a fetched row in place. Skips fields that
   * are null, empty, or not prefixed with "v1:" (legacy plaintext).
   * @param {object} row        mutable row from pg
   * @param {string} tableName  key in TABLES
   * @param {number} tenantId
   * @param {number} patientId  value to use in the AAD (usually row.id or row.patient_id)
   * @param {object} [actor]    { id } for the audit log
   */
  async function decryptRow(row, tableName, tenantId, patientId, actor) {
    const cfg = TABLES[tableName];
    if (!row || !cfg) return row;
    const decryptedFields = [];
    for (const field of cfg.phiFields) {
      if (row[field] == null || !isEncrypted(row[field])) continue;
      row[field] = decryptPHI(row[field], ctxFor(tenantId, patientId, field));
      decryptedFields.push(field);
    }
    if (decryptedFields.length > 0) {
      await logPhiAudit(tenantId, tableName, row[cfg.pk], decryptedFields.join(','), 'decrypt', actor);
    }
    return row;
  }

  /**
   * Encrypt every PHI field on a row-to-write. Returns a new object
   * containing { field: ciphertext } for every PHI field that was non-null
   * in `values`. Used to build the encrypted INSERT/UPDATE payload.
   * @param {object} values     plaintext field values from the request body
   * @param {string} tableName  key in TABLES
   * @param {number} tenantId
   * @param {number} patientId  row PK for the AAD (row.id for INSERT-after-RETURNING;
   *                             existing row.id for UPDATE)
   * @param {object} [actor]    { id } for the audit log
   * @returns {object} { field: ciphertext }
   */
  async function encryptFields(values, tableName, tenantId, patientId, actor) {
    const cfg = TABLES[tableName];
    const out = {};
    const encryptedFields = [];
    for (const field of cfg.phiFields) {
      if (values[field] == null || values[field] === '') {
        out[field] = values[field]; // pass null/empty through unchanged
        continue;
      }
      out[field] = encryptPHI(values[field], ctxFor(tenantId, patientId, field));
      encryptedFields.push(field);
    }
    if (encryptedFields.length > 0) {
      await logPhiAudit(tenantId, tableName, patientId, encryptedFields.join(','), 'encrypt', actor);
    }
    return out;
  }

  /**
   * Append a row to phi_encryption_audit_log. Failures here are logged but
   * do NOT break the request — an audit-log outage must not prevent a
   * legitimate clinician from reading PHI (the access still happened; the
   * audit gap is a separate incident to investigate).
   */
  async function logPhiAudit(tenantId, tableName, recordId, fieldName, action, actor) {
    try {
      await pool.query(
        `INSERT INTO phi_encryption_audit_log
           (tenant_id, table_name, record_id, field_name, action, actor_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, tableName, recordId, fieldName, action, actor ? actor.id : null]
      );
    } catch (e) {
      // Critical to log — a silent audit-log failure is itself a HIPAA event.
      console.error(`[HIPAA] audit log write failed: tenant=${tenantId} ` +
        `table=${tableName} record=${recordId} action=${action} err=${e.message}`);
    }
  }

  /**
   * Resolve the patient_id to use in the AAD for a consultations/prescriptions
   * row. The schema allows patient_id to be NULL (e.g. walk-in patient) so
   * we fall back to the row's own PK — still gives a unique per-record
   * binding, which is the security property we need.
   */
  function aadPatientId(row, tableName) {
    if (tableName === 'patient_portal_users') return row.id;
    return row.patient_id != null ? row.patient_id : row.id;
  }

  // =====================================================================
  // /api/clinic/patients  (mapped to patient_portal_users table)
  // =====================================================================

  // GET /api/clinic/patients/:id — fetch one patient, decrypt PHI
  router.get('/patients/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const pid = parseInt(req.params.id, 10);
    if (!Number.isInteger(pid)) return res.status(400).json({ error: 'Invalid patient id' });

    const result = await pool.query(
      'SELECT * FROM patient_portal_users WHERE id = $1 AND tenant_id = $2',
      [pid, tid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Patient not found' });

    const patient = result.rows[0];
    await decryptRow(patient, 'patient_portal_users', tid, patient.id, req.session.user);
    res.json(patient);
  }));

  // GET /api/clinic/patients — list patients (paginated), decrypt PHI on each
  router.get('/patients', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const result = await pool.query(
      'SELECT * FROM patient_portal_users WHERE tenant_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3',
      [tid, limit, offset]
    );
    for (const row of result.rows) {
      await decryptRow(row, 'patient_portal_users', tid, row.id, req.session.user);
    }
    res.json({ patients: result.rows, limit, offset });
  }));

  // POST /api/clinic/patients — create a new patient, encrypt PHI on write
  // Two-step: INSERT non-PHI fields with RETURNING id, then UPDATE the PHI
  // fields with ciphertext. This is needed because the AAD context for
  // encryptPHI requires the row's `id`, which we only know after INSERT.
  router.post('/patients', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const body = req.body || {};
    const { gender, blood_type } = body;

    // Step 1: insert with non-PHI fields only, get the new row id
    const ins = await pool.query(
      `INSERT INTO patient_portal_users (tenant_id, gender, blood_type, is_verified)
       VALUES ($1, $2, $3, false)
       RETURNING id`,
      [tid, gender || null, blood_type || null]
    );
    const pid = ins.rows[0].id;

    // Step 2: encrypt PHI fields and UPDATE the row
    const enc = await encryptFields(body, 'patient_portal_users', tid, pid, req.session.user);
    await pool.query(
      `UPDATE patient_portal_users
          SET full_name = $1, date_of_birth = $2, phone = $3, address = $4,
              email = $5, emergency_contact_name = $6, emergency_contact_phone = $7,
              phi_encrypted = true, updated_at = NOW()
        WHERE id = $8 AND tenant_id = $9`,
      [
        enc.full_name || null, enc.date_of_birth || null, enc.phone || null,
        enc.address || null, enc.email || null, enc.emergency_contact_name || null,
        enc.emergency_contact_phone || null, pid, tid,
      ]
    );

    res.status(201).json({ id: pid, message: 'Patient created (PHI encrypted at rest)' });
  }));

  // PUT /api/clinic/patients/:id — update an existing patient, re-encrypt PHI
  router.put('/patients/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const pid = parseInt(req.params.id, 10);
    if (!Number.isInteger(pid)) return res.status(400).json({ error: 'Invalid patient id' });

    // Confirm the row exists + belongs to this tenant
    const existing = await pool.query(
      'SELECT id FROM patient_portal_users WHERE id = $1 AND tenant_id = $2',
      [pid, tid]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Patient not found' });

    const body = req.body || {};
    const enc = await encryptFields(body, 'patient_portal_users', tid, pid, req.session.user);

    // Build a dynamic UPDATE that only touches fields the client supplied.
    // (encryptFields passes through nulls/empties as null, so we still
    // want to allow nulling a field by explicitly sending null.)
    const sets = [];
    const vals = [];
    let n = 0;
    for (const field of TABLES.patient_portal_users.phiFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        n++;
        sets.push(`${field} = $${n}`);
        vals.push(enc[field] == null ? null : enc[field]);
      }
    }
    if (sets.length === 0) {
      return res.status(400).json({ error: 'No PHI fields supplied to update' });
    }
    sets.push(`phi_encrypted = true`);
    sets.push(`updated_at = NOW()`);
    n++;
    vals.push(pid);
    n++;
    vals.push(tid);
    await pool.query(
      `UPDATE patient_portal_users SET ${sets.join(', ')} WHERE id = $${n - 1} AND tenant_id = $${n}`,
      vals
    );
    res.json({ id: pid, message: 'Patient updated (PHI re-encrypted)' });
  }));

  // =====================================================================
  // /api/clinic/consultations
  // =====================================================================

  router.get('/consultations/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const cid = parseInt(req.params.id, 10);
    if (!Number.isInteger(cid)) return res.status(400).json({ error: 'Invalid consultation id' });

    const result = await pool.query(
      'SELECT * FROM consultations WHERE id = $1 AND tenant_id = $2',
      [cid, tid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Consultation not found' });

    const row = result.rows[0];
    await decryptRow(row, 'consultations', tid, aadPatientId(row, 'consultations'), req.session.user);
    res.json(row);
  }));

  router.post('/consultations', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const body = req.body || {};
    const { patient_type, patient_id, doctor_id, queue_id, follow_up_date, status } = body;

    // Step 1: insert non-PHI fields, RETURNING id
    const ins = await pool.query(
      `INSERT INTO consultations
         (tenant_id, patient_type, patient_id, doctor_id, queue_id, follow_up_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [tid, patient_type || 'student', patient_id || null, doctor_id || null,
       queue_id || null, follow_up_date || null, status || 'in_progress']
    );
    const cid = ins.rows[0].id;

    // Step 2: encrypt PHI fields with AAD context bound to this row
    const aadPid = patient_id != null ? patient_id : cid;
    const enc = await encryptFields(body, 'consultations', tid, aadPid, req.session.user);
    await pool.query(
      `UPDATE consultations
          SET chief_complaint = $1, history = $2, examination = $3,
              diagnosis = $4, treatment_plan = $5, notes = $6,
              phi_encrypted = true
        WHERE id = $7 AND tenant_id = $8`,
      [
        enc.chief_complaint || null, enc.history || null, enc.examination || null,
        enc.diagnosis || null, enc.treatment_plan || null, enc.notes || null,
        cid, tid,
      ]
    );
    res.status(201).json({ id: cid, message: 'Consultation created (PHI encrypted at rest)' });
  }));

  // =====================================================================
  // /api/clinic/prescriptions
  // =====================================================================

  router.get('/prescriptions/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const pid = parseInt(req.params.id, 10);
    if (!Number.isInteger(pid)) return res.status(400).json({ error: 'Invalid prescription id' });

    const result = await pool.query(
      'SELECT * FROM prescriptions WHERE id = $1 AND tenant_id = $2',
      [pid, tid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Prescription not found' });

    const row = result.rows[0];
    await decryptRow(row, 'prescriptions', tid, aadPatientId(row, 'prescriptions'), req.session.user);
    res.json(row);
  }));

  router.post('/prescriptions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const body = req.body || {};
    const { consultation_id, patient_type, patient_id, doctor_id, doctor_name, status } = body;

    // Step 1: insert non-PHI fields, RETURNING id
    const ins = await pool.query(
      `INSERT INTO prescriptions
         (tenant_id, consultation_id, patient_type, patient_id, doctor_id, doctor_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [tid, consultation_id || null, patient_type || 'student', patient_id || null,
       doctor_id || null, doctor_name || null, status || 'pending']
    );
    const prescId = ins.rows[0].id;

    // Step 2: encrypt PHI fields
    const aadPid = patient_id != null ? patient_id : prescId;
    const enc = await encryptFields(body, 'prescriptions', tid, aadPid, req.session.user);
    await pool.query(
      `UPDATE prescriptions
          SET patient_name = $1, diagnosis = $2, notes = $3,
              phi_encrypted = true
        WHERE id = $4 AND tenant_id = $5`,
      [
        enc.patient_name || null, enc.diagnosis || null, enc.notes || null,
        prescId, tid,
      ]
    );
    res.status(201).json({ id: prescId, message: 'Prescription created (PHI encrypted at rest)' });
  }));

  // =====================================================================
  // /api/clinic/hipaa/status — operational status for the HIPAA dashboard
  // =====================================================================
  // Returns counts of encrypted vs. plaintext rows per table, so the
  // operator can see at a glance how far the backfill has progressed.
  router.get('/hipaa/status', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const out = { tenant_id: tid, tables: {} };
    for (const [name, _cfg] of Object.entries(TABLES)) {
      const stats = await pool.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE phi_encrypted = true)::int AS encrypted,
           COUNT(*) FILTER (WHERE phi_encrypted = false OR phi_encrypted IS NULL)::int AS plaintext
         FROM ${name} WHERE tenant_id = $1`,
        [tid]
      );
      out.tables[name] = stats.rows[0] || { total: 0, encrypted: 0, plaintext: 0 };
    }
    // Latest 10 audit-log entries for this tenant (sanity check for HIPAA officers)
    const audit = await pool.query(
      `SELECT id, table_name, record_id, field_name, action, actor_user_id, created_at
         FROM phi_encryption_audit_log
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 10`,
      [tid]
    );
    out.recent_audit = audit.rows;
    res.json(out);
  }));

  return router;
};
