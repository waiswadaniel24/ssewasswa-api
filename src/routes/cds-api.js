// src/routes/cds-api.js
//
// Clinical Decision Support (CDS) API (extracted from server.js as part of
// the Conservative route-extraction refactor — Track 1, Task t1).
//
// Behavior is identical to the original inline handlers in server.js.
// The module exports a factory that accepts a shared context object so the
// route handlers can close over the same `pool`, `requireAuth`, `ah`, etc.
// that the rest of server.js uses — no behavior changes, no re-definitions.
//
// Mount point in server.js:
//   app.use('/api/cds', require('./src/routes/cds-api')(sharedCtx));

module.exports = function createCdsApiRouter(ctx) {
  const express = require('express');
  const router = express.Router();
  const { pool, requireAuth, ah } = ctx;

  // API: Check drug interactions for a list of medications
  // GET /api/cds/interactions
  router.get('/interactions', requireAuth, ah(async (req, res) => {
    const { medications } = req.query;
    if (!medications) return res.json({ interactions: [] });
    const meds = Array.isArray(medications) ? medications : [medications];
    const interactions = [];

    for (let i = 0; i < meds.length; i++) {
      for (let j = i + 1; j < meds.length; j++) {
        const found = (await pool.query('SELECT * FROM drug_interactions WHERE (drug_a ILIKE $1 AND drug_b ILIKE $2) OR (drug_a ILIKE $2 AND drug_b ILIKE $1)',
          [`%${meds[i]}%`, `%${meds[j]}%`])).rows;
        interactions.push(...found.map(f => ({ drug_a: meds[i], drug_b: meds[j], ...f })));
      }
    }
    res.json({ medications: meds, interactions, count: interactions.length });
  }));

  // API: Check patient allergies before prescribing
  // GET /api/cds/allergy-check
  router.get('/allergy-check', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { patient_type, patient_id, medication } = req.query;
    if (!patient_id || !medication) return res.json({ alerts: [] });

    const allergies = (await pool.query('SELECT * FROM patient_allergies WHERE tenant_id=$1 AND patient_type=$2 AND patient_id=$3 AND is_active=true', [t, patient_type || 'student', patient_id])).rows;
    const alerts = [];

    for (const allergy of allergies) {
      const allergenLower = allergy.allergen.toLowerCase();
      const medLower = medication.toLowerCase();
      // Check if medication name contains the allergen or vice versa
      if (medLower.includes(allergenLower) || allergenLower.includes(medLower.split(' ')[0])) {
        alerts.push({
          type: 'allergy_alert',
          severity: allergy.severity,
          allergen: allergy.allergen,
          reaction: allergy.reaction,
          medication: medication,
          message: `WARNING: Patient has a ${allergy.severity} allergy to ${allergy.allergen}. ${medication} may trigger a reaction (${allergy.reaction || 'unknown reaction'}).`,
          recommendation: allergy.severity === 'severe' ? 'DO NOT prescribe this medication. Find an alternative.' : 'Use with caution. Consider alternative medication.'
        });
      }
      // Common cross-reactivity checks
      const crossReactivity = {
        'penicillin': ['amoxicillin', 'ampicillin', 'amoxil', 'augmentin', 'penicillin', 'benzylpenicillin'],
        'sulfa': ['sulfamethoxazole', 'co-trimoxazole', 'trimethoprim', 'sulfasalazine', 'septrin'],
        'aspirin': ['ibuprofen', 'diclofenac', 'naproxen', 'indomethacin', 'mefenamic'],
        'latex': ['avocado', 'banana', 'kiwi', 'chestnut']
      };
      for (const [allergenGroup, crossReactive] of Object.entries(crossReactivity)) {
        if (allergenLower.includes(allergenGroup) || allergenGroup.includes(allergenLower)) {
          if (crossReactive.some(cr => medLower.includes(cr))) {
            alerts.push({
              type: 'cross_reactivity_alert',
              severity: allergy.severity,
              allergen: allergy.allergen,
              medication: medication,
              message: `CROSS-REACTIVITY WARNING: ${medication} may cross-react with ${allergy.allergen} allergy (${allergy.reaction || 'unknown reaction'}).`,
              recommendation: 'Consider alternative medication. Monitor closely if prescribed.'
            });
          }
        }
      }
    }
    res.json({ patient_type, patient_id, medication, alerts, allergy_count: allergies.length });
  }));

  // API: Dosage check
  // GET /api/cds/dosage-check
  router.get('/dosage-check', requireAuth, ah(async (req, res) => {
    const { medication, dosage, age, weight } = req.query;
    if (!medication || !dosage) return res.json({ warnings: [] });

    const warnings = [];
    const dosageStr = dosage.toLowerCase();
    const dosageNum = parseFloat(dosageStr);
    const ageNum = parseInt(age);
    const weightNum = parseFloat(weight);

    // Common pediatric/geriatric dosage warnings
    if (ageNum && ageNum < 12) {
      warnings.push({ type: 'pediatric_dose', message: `Pediatric patient (age ${ageNum}). Verify weight-based dosing. Standard adult doses may be unsafe.`, severity: 'high' });
    }
    if (ageNum && ageNum > 65) {
      warnings.push({ type: 'geriatric_dose', message: `Elderly patient (age ${ageNum}). Consider reduced dosing due to decreased renal/hepatic clearance.`, severity: 'moderate' });
    }

    // Medication-specific dosage checks (Uganda/Africa common medications)
    const dosageChecks = [
      { med: 'paracetamol', maxDailyAdult: 4000, maxDailyPediatric: 60, unit: 'mg', weightBased: true, weightDose: 15 },
      { med: 'amoxicillin', maxDailyAdult: 3000, maxDailyPediatric: 90, unit: 'mg', weightBased: true, weightDose: 25 },
      { med: 'metformin', maxDaily: 2550, unit: 'mg', minAge: 10 },
      { med: 'artemether', maxDailyAdult: 640, unit: 'mg', weightBased: true, weightDose: 3.2 },
      { med: 'ciprofloxacin', maxDaily: 1500, unit: 'mg', minAge: 18, pedWarning: 'Avoid in children under 18 due to cartilage damage risk' },
      { med: 'doxycycline', maxDaily: 200, unit: 'mg', minAge: 8, pedWarning: 'Avoid in children under 8 - causes dental discoloration' },
      { med: 'chloroquine', maxDaily: 600, unit: 'mg base', weightBased: true, weightDose: 10 },
      { med: 'ibuprofen', maxDailyAdult: 2400, maxDailyPediatric: 40, unit: 'mg', weightBased: true, weightDose: 10 },
      { med: 'diclofenac', maxDaily: 150, unit: 'mg', minAge: 14 }
    ];

    for (const check of dosageChecks) {
      if (dosageStr.includes(check.med)) {
        if (check.minAge && ageNum && ageNum < check.minAge) {
          warnings.push({ type: 'age_restriction', message: check.pedWarning || `${check.med} is not recommended for patients under ${check.minAge} years.`, severity: 'high' });
        }
        if (check.maxDaily && dosageNum > check.maxDaily) {
          warnings.push({ type: 'overdose', message: `Dose of ${dosage} exceeds maximum daily dose of ${check.maxDaily}${check.unit} for ${check.med}.`, severity: 'high' });
        }
        if (check.weightBased && weightNum && dosageNum) {
          const expectedDose = weightNum * check.weightDose;
          if (dosageNum > expectedDose * 1.5) {
            warnings.push({ type: 'weight_dose_mismatch', message: `Dose of ${dosageNum}${check.unit} seems high for patient weight of ${weightNum}kg. Expected ~${expectedDose.toFixed(0)}${check.unit} based on ${check.weightDose}${check.unit}/kg.`, severity: 'moderate' });
          }
        }
      }
    }

    res.json({ medication, dosage, age: ageNum, weight: weightNum, warnings });
  }));

  // API: Full CDS check (combines all checks for prescribing)
  // POST /api/cds/full-check
  router.post('/full-check', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { patient_type, patient_id, medications, age, weight } = req.body;

    if (!medications || !medications.length) return res.json({ alerts: [], interactions: [], warnings: [] });

    const allAlerts = [];
    const allInteractions = [];
    const allWarnings = [];

    // Check interactions between all medications
    for (let i = 0; i < medications.length; i++) {
      for (let j = i + 1; j < medications.length; j++) {
        const found = (await pool.query('SELECT * FROM drug_interactions WHERE (drug_a ILIKE $1 AND drug_b ILIKE $2) OR (drug_a ILIKE $2 AND drug_b ILIKE $1)',
          [`%${medications[i].name}%`, `%${medications[j].name}%`])).rows;
        for (const f of found) {
          allInteractions.push({ drug_a: medications[i].name, drug_b: medications[j].name, ...f });
        }
      }
    }

    // Check allergies for each medication
    if (patient_id) {
      const allergies = (await pool.query('SELECT * FROM patient_allergies WHERE tenant_id=$1 AND patient_type=$2 AND patient_id=$3 AND is_active=true', [t, patient_type || 'student', patient_id])).rows;
      for (const med of medications) {
        for (const allergy of allergies) {
          const allergenLower = allergy.allergen.toLowerCase();
          const medLower = med.name.toLowerCase();
          if (medLower.includes(allergenLower) || allergenLower.includes(medLower.split(' ')[0])) {
            allAlerts.push({
              type: 'allergy_alert', severity: allergy.severity, allergen: allergy.allergen, medication: med.name,
              message: `ALLERGY ALERT: Patient has ${allergy.severity} allergy to ${allergy.allergen}. ${med.name} is contraindicated.`,
              recommendation: allergy.severity === 'severe' ? 'DO NOT PRESCRIBE. Find alternative.' : 'Use with extreme caution.'
            });
          }
          // Cross-reactivity
          const crossReactivity = {
            'penicillin': ['amoxicillin', 'ampicillin', 'amoxil', 'augmentin'],
            'sulfa': ['sulfamethoxazole', 'co-trimoxazole', 'trimethoprim', 'septrin'],
            'aspirin': ['ibuprofen', 'diclofenac', 'naproxen', 'mefenamic']
          };
          for (const [group, cross] of Object.entries(crossReactivity)) {
            if (allergenLower.includes(group) && cross.some(c => medLower.includes(c))) {
              allAlerts.push({ type: 'cross_reactivity', severity: 'high', allergen: allergy.allergen, medication: med.name, message: `Cross-reactivity: ${med.name} may react with ${allergy.allergen} allergy.` });
            }
          }
        }
      }

      // Check current medications for duplicate therapy
      const currentMeds = (await pool.query('SELECT * FROM patient_medications WHERE tenant_id=$1 AND patient_type=$2 AND patient_id=$3 AND is_active=true', [t, patient_type || 'student', patient_id])).rows;
      for (const med of medications) {
        const duplicate = currentMeds.find(cm => cm.medication_name.toLowerCase().includes(med.name.toLowerCase()) || med.name.toLowerCase().includes(cm.medication_name.toLowerCase()));
        if (duplicate) {
          allWarnings.push({ type: 'duplicate_therapy', medication: med.name, existing: duplicate.medication_name, message: `Patient is already on ${duplicate.medication_name} (${duplicate.dosage} ${duplicate.frequency}). Adding ${med.name} may be duplicate therapy.` });
        }
      }
    }

    // Dosage checks
    for (const med of medications) {
      if (med.dosage && age) {
        const ageNum = parseInt(age);
        if (ageNum < 12) allWarnings.push({ type: 'pediatric', medication: med.name, message: `Pediatric dosing for ${med.name} - verify weight-based dose.` });
        if (ageNum > 65) allWarnings.push({ type: 'geriatric', medication: med.name, message: `Elderly dosing for ${med.name} - consider dose reduction.` });
      }
    }

    res.json({
      patient_type, patient_id, medications: medications.map(m => m.name),
      alerts: allAlerts,
      interactions: allInteractions,
      warnings: allWarnings,
      total_issues: allAlerts.length + allInteractions.length + allWarnings.length,
      has_critical: allAlerts.some(a => a.severity === 'severe') || allInteractions.some(i => i.severity === 'high')
    });
  }));

  return router;
};
