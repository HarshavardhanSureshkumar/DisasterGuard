/**
 * DisasterGuard – Emergency Alert Routes
 * =======================================
 * Handles authoritative emergency broadcasts authored by Command Centre operators.
 *
 * AUTHORITY MODEL:
 *   - POST /api/alerts                     → Command Centre only (role: 'command')
 *   - PATCH /api/alerts/:id/deactivate     → Command Centre only
 *   - GET  /api/alerts/active              → All authenticated users (filtered by audience)
 *   - GET  /api/alerts/history             → All authenticated users
 *
 * SCHEMA NOTE:
 *   emergency_alerts columns:
 *     id, alert_type, severity, title, message, affected_areas,
 *     recommended_action, target_audience, created_by, is_active,
 *     deactivated_at, created_at
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { authenticateToken, requireRole } = require('../middleware/auth');

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

const VALID_TYPES = [
  'FLOOD_WARNING', 'FLASH_FLOOD', 'HEAVY_RAINFALL',
  'ROAD_CLOSURE',  'EVACUATION',  'SHELTER_UPDATE', 'GENERAL_EMERGENCY'
];

const VALID_SEVERITIES = ['INFO', 'WARNING', 'HIGH', 'CRITICAL'];
const VALID_AUDIENCES  = ['CITIZENS', 'RESCUE_TEAMS', 'BOTH'];

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/** Generate a sequential alert ID: ALT-2026-XXXX */
function generateAlertId() {
  const existing = db.prepare(
    "SELECT id FROM emergency_alerts ORDER BY rowid DESC LIMIT 1"
  ).get();
  if (!existing) return 'ALT-2026-0001';
  const parts = existing.id.split('-');
  const seq   = (parseInt(parts[2], 10) + 1).toString().padStart(4, '0');
  return `ALT-2026-${seq}`;
}

/**
 * Emit a Socket.IO alert event to the correct rooms.
 * room_command always receives every alert for administrative awareness.
 */
function emitToAudience(io, event, payload, targetAudience) {
  if (!io) return;
  io.to('room_command').emit(event, payload);
  if (targetAudience === 'CITIZENS'      || targetAudience === 'BOTH') io.to('room_citizen').emit(event, payload);
  if (targetAudience === 'RESCUE_TEAMS'  || targetAudience === 'BOTH') io.to('room_rescue').emit(event, payload);
}

// ---------------------------------------------------------------------------
// POST /api/alerts  — Publish a new emergency alert
// ---------------------------------------------------------------------------
router.post('/', authenticateToken, requireRole('command'), (req, res) => {
  const type = req.body.type || req.body.alert_type;
  const {
    severity,
    title,
    message,
    affected_areas,
    recommended_action,
    target_audience
  } = req.body;

  // --- Validation ---
  if (!type || !VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: 'Invalid or missing alert type.', validTypes: VALID_TYPES });
  }
  if (!severity || !VALID_SEVERITIES.includes(severity)) {
    return res.status(400).json({ error: 'Invalid or missing severity.', validSeverities: VALID_SEVERITIES });
  }
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Alert title is required.' });
  }
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Alert message is required.' });
  }
  if (!affected_areas || !affected_areas.trim()) {
    return res.status(400).json({ error: 'Affected areas are required.' });
  }
  if (!recommended_action || !recommended_action.trim()) {
    return res.status(400).json({ error: 'Recommended action is required.' });
  }
  if (!target_audience || !VALID_AUDIENCES.includes(target_audience)) {
    return res.status(400).json({ error: 'Invalid or missing target audience.', validAudiences: VALID_AUDIENCES });
  }

  const alertId = generateAlertId();

  // Schema column: alert_type, created_by
  db.prepare(`
    INSERT INTO emergency_alerts
      (id, alert_type, severity, title, message, affected_areas,
       recommended_action, target_audience, created_by, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(alertId, type, severity, title.trim(), message.trim(),
         affected_areas.trim(), recommended_action.trim(), target_audience, req.user.userId);

  const alert = db.prepare('SELECT * FROM emergency_alerts WHERE id = ?').get(alertId);

  emitToAudience(req.app.get('io'), 'NEW_EMERGENCY_ALERT', alert, target_audience);

  console.log(`[Alerts] Published ${alertId} (${type}/${severity}) → ${target_audience} by ${req.user.userId}`);
  return res.status(201).json({ success: true, message: 'Emergency alert published.', alert });
});

// ---------------------------------------------------------------------------
// GET /api/alerts/active  — Currently active alerts, optionally filtered by audience
// ---------------------------------------------------------------------------
router.get('/active', authenticateToken, (req, res) => {
  const { audience } = req.query;
  let query = 'SELECT * FROM emergency_alerts WHERE is_active = 1';
  const args = [];

  if (audience && VALID_AUDIENCES.includes(audience)) {
    query += " AND (target_audience = ? OR target_audience = 'BOTH')";
    args.push(audience);
  }
  query += ' ORDER BY created_at DESC';

  const alerts = db.prepare(query).all(...args);
  return res.status(200).json({ alerts, count: alerts.length });
});

// ---------------------------------------------------------------------------
// GET /api/alerts/history  — Full chronological history (for Command Centre audit)
// ---------------------------------------------------------------------------
router.get('/history', authenticateToken, (req, res) => {
  const alerts = db.prepare('SELECT * FROM emergency_alerts ORDER BY created_at DESC').all();
  return res.status(200).json({ alerts, count: alerts.length });
});

// ---------------------------------------------------------------------------
// PATCH /api/alerts/:id/deactivate  — Deactivate an active alert
// ---------------------------------------------------------------------------
router.patch('/:id/deactivate', authenticateToken, requireRole('command'), (req, res) => {
  const { id } = req.params;

  const alert = db.prepare('SELECT * FROM emergency_alerts WHERE id = ?').get(id);
  if (!alert) return res.status(404).json({ error: `Alert ${id} not found.` });
  if (!alert.is_active) return res.status(409).json({ error: `Alert ${id} is already inactive.` });

  db.prepare(`
    UPDATE emergency_alerts SET is_active = 0, deactivated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(id);

  const updated = db.prepare('SELECT * FROM emergency_alerts WHERE id = ?').get(id);

  const io = req.app.get('io');
  if (io) {
    const payload = { alertId: id, alert: updated };
    io.to('room_command').emit('ALERT_DEACTIVATED', payload);
    io.to('room_citizen').emit('ALERT_DEACTIVATED', payload);
    io.to('room_rescue').emit('ALERT_DEACTIVATED',  payload);
  }

  console.log(`[Alerts] Deactivated ${id} by ${req.user.userId}`);
  return res.status(200).json({ success: true, message: `Alert ${id} deactivated.`, alert: updated });
});

module.exports = router;
