/**
 * DisasterGuard – Risk Prediction Routes
 * ========================================
 * Provides environmental sensor-based flood risk prediction.
 *
 * SCHEMA NOTE:
 *   risk_predictions columns:
 *     id, disaster_type, rainfall, river, soil, drainage, history,
 *     score, level, affected_estimate, areas_json,
 *     published_by, is_active, created_at
 *
 * ENDPOINTS:
 *   POST /api/risk/predict   — Preview a risk calculation (no DB write)
 *   POST /api/risk/publish   — Save to DB + broadcast (command role only)
 *   GET  /api/risk/latest    — Retrieve the latest published prediction
 *
 * DECOUPLING GUARANTEE:
 *   Publishing a risk prediction NEVER auto-creates an emergency alert.
 *   The operator must review and separately POST /api/alerts.
 */

'use strict';

const express    = require('express');
const router     = express.Router();
const db         = require('../database/db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const riskEngine = require('../utils/risk_engine');

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/** Generate a sequential prediction ID: RISK-2026-XXXX */
function generateRiskId() {
  const existing = db.prepare(
    "SELECT id FROM risk_predictions ORDER BY rowid DESC LIMIT 1"
  ).get();
  if (!existing) return 'RISK-2026-0001';
  const parts = existing.id.split('-');
  const seq   = (parseInt(parts[2], 10) + 1).toString().padStart(4, '0');
  return `RISK-2026-${seq}`;
}

/**
 * Validate and parse sensor inputs from request body.
 * Returns { inputs } on success or { errors: [...] } on failure.
 */
function parseSensorInputs(body) {
  const errors = [];
  const rainfallMm          = parseFloat(body.rainfall_mm);
  const riverLevelPct       = parseFloat(body.river_level_pct);
  const soilMoisturePct     = parseFloat(body.soil_moisture_pct);
  const drainageCapacityPct = parseFloat(body.drainage_capacity_pct);
  const historicalIndex     = parseFloat(body.historical_index);

  if (isNaN(rainfallMm)          || rainfallMm < 0)                              errors.push('rainfall_mm must be a non-negative number.');
  if (isNaN(riverLevelPct)       || riverLevelPct < 0)                           errors.push('river_level_pct must be a non-negative number (0–100+).');
  if (isNaN(soilMoisturePct)     || soilMoisturePct < 0     || soilMoisturePct > 100)     errors.push('soil_moisture_pct must be 0–100.');
  if (isNaN(drainageCapacityPct) || drainageCapacityPct < 0 || drainageCapacityPct > 100) errors.push('drainage_capacity_pct must be 0–100.');
  if (isNaN(historicalIndex)     || historicalIndex < 0     || historicalIndex > 100)     errors.push('historical_index must be 0–100.');

  if (errors.length > 0) return { errors };
  return { inputs: { rainfallMm, riverLevelPct, soilMoisturePct, drainageCapacityPct, historicalIndex } };
}

// ---------------------------------------------------------------------------
// POST /api/risk/predict  — Preview only (no DB write, no broadcast)
// ---------------------------------------------------------------------------
router.post('/predict', authenticateToken, (req, res) => {
  const parsed = parseSensorInputs(req.body);
  if (parsed.errors) {
    return res.status(400).json({ error: 'Invalid sensor inputs.', details: parsed.errors });
  }
  const result = riskEngine.predict(parsed.inputs);
  return res.status(200).json({ success: true, prediction: result });
});

// ---------------------------------------------------------------------------
// POST /api/risk/publish  — Persist + broadcast (Command Centre only)
// ---------------------------------------------------------------------------
router.post('/publish', authenticateToken, requireRole('command'), (req, res) => {
  const parsed = parseSensorInputs(req.body);
  if (parsed.errors) {
    return res.status(400).json({ error: 'Invalid sensor inputs.', details: parsed.errors });
  }

  const { inputs } = parsed;
  const result  = riskEngine.predict(inputs);
  const riskId  = generateRiskId();

  // Map engine output → schema columns
  // Schema: rainfall, river, soil, drainage, history = the raw sensor values
  // areas_json stores the computed zone breakdown
  const publishTx = db.transaction(() => {
    db.prepare("UPDATE risk_predictions SET is_active = 0 WHERE is_active = 1").run();

    db.prepare(`
      INSERT INTO risk_predictions
        (id, disaster_type, rainfall, river, soil, drainage, history,
         score, level, affected_estimate, areas_json, published_by, is_active)
      VALUES (?, 'FLOOD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      riskId,
      inputs.rainfallMm,
      inputs.riverLevelPct,
      inputs.soilMoisturePct,
      inputs.drainageCapacityPct,
      inputs.historicalIndex,
      result.overallScore,
      result.riskLevel,
      result.estimatedPopulationAtRisk,
      JSON.stringify(result.zones),
      req.user.userId
    );
  });

  publishTx();

  // Broadcast to Command Centre and Citizen portals
  const io = req.app.get('io');
  if (io) {
    io.emit('RISK_PUBLISHED', {
      id: riskId,
      overallScore: result.overallScore,
      riskLevel: result.riskLevel,
      estimatedPopulationAtRisk: result.estimatedPopulationAtRisk,
      topZones: result.zones.slice(0, 3),
      calculatedAt: result.calculatedAt,
      prediction: result
    });
  }

  console.log(`[Risk] Published ${riskId} — Score: ${result.overallScore} (${result.riskLevel}) by ${req.user.userId}`);

  return res.status(201).json({
    success: true,
    message: 'Risk prediction published. Review before issuing any emergency alert.',
    riskId,
    prediction: result
  });
});

// ---------------------------------------------------------------------------
// GET /api/risk/latest  — Retrieve the latest active prediction
// ---------------------------------------------------------------------------
router.get('/latest', authenticateToken, (req, res) => {
  const row = db.prepare(
    'SELECT * FROM risk_predictions WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1'
  ).get();

  if (!row) {
    return res.status(404).json({ error: 'No active risk prediction found. Publish one first.' });
  }

  const prediction = {
    ...row,
    zones: JSON.parse(row.areas_json || '[]')
  };

  return res.status(200).json({ success: true, prediction });
});

module.exports = router;
