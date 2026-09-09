const express = require('express');
const router = express.Router();
const db = require('../database/db');

/**
 * POST /api/incidents
 * Submit a disaster incident report (road blockages, downed trees, infrastructure collapse)
 */
router.post('/', (req, res) => {
  try {
    const type = req.body.type || req.body.incident_type || req.body.incidentType;
    const location_name = req.body.location_name || req.body.location || req.body.location_address || req.body.address;
    const latitude = req.body.latitude != null ? req.body.latitude : req.body.lat;
    const longitude = req.body.longitude != null ? req.body.longitude : (req.body.lng != null ? req.body.lng : req.body.lon);
    const citizen_email = req.body.citizen_email || req.body.email;
    const citizen_name = req.body.citizen_name || req.body.name || req.body.reporter_name;
    const rawSeverity = req.body.severity;
    const description = req.body.description || req.body.desc || '';

    if (!type || !location_name || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'Incident type, location name, latitude, and longitude are required.' });
    }

    const incidentId = `INC-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const email = citizen_email ? String(citizen_email).trim() : null;
    const name = citizen_name ? String(citizen_name).trim() : 'Citizen Reporter';

    let citizenId = null;
    if (email) {
      const user = db.prepare('SELECT id FROM users WHERE identifier = ?').get(email);
      if (user) citizenId = user.id;
    }

    const normalizedSev = rawSeverity ? String(rawSeverity).trim().toLowerCase() : 'moderate';
    const severityMap = { critical: 'Critical', high: 'High', moderate: 'Moderate', low: 'Low' };
    const chosenSeverity = severityMap[normalizedSev] || 'Moderate';

    db.prepare(`
      INSERT INTO incident_reports (
        id, citizen_id, citizen_email, citizen_name,
        type, severity, status, description, location_name,
        latitude, longitude
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, 'REPORTED', ?, ?,
        ?, ?
      )
    `).run(
      incidentId, citizenId, email, name,
      type, chosenSeverity, description || '', location_name,
      parseFloat(latitude), parseFloat(longitude)
    );

    const created = db.prepare('SELECT * FROM incident_reports WHERE id = ?').get(incidentId);

    const io = req.app.get('io');
    if (io) {
      io.emit('NEW_INCIDENT', created);
    }

    return res.status(201).json({
      message: 'Incident reported successfully.',
      incident: created
    });
  } catch (error) {
    console.error('[Incident Create Error]', error);
    return res.status(500).json({ error: 'Failed to report incident.' });
  }
});

/**
 * GET /api/incidents
 * Retrieve all incident reports
 */
router.get('/', (req, res) => {
  try {
    const { status, severity, citizen_email } = req.query;

    let query = 'SELECT * FROM incident_reports WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status.toUpperCase());
    }
    if (severity) {
      query += ' AND severity = ?';
      params.push(severity);
    }
    if (citizen_email) {
      query += ' AND citizen_email = ?';
      params.push(citizen_email);
    }

    query += ' ORDER BY created_at DESC';

    const incidents = db.prepare(query).all(...params);
    return res.status(200).json({ incidents });
  } catch (error) {
    console.error('[Incident List Error]', error);
    return res.status(500).json({ error: 'Failed to fetch incidents.' });
  }
});

/**
 * PATCH /api/incidents/:id
 * Command Centre updates incident status or severity
 */
router.patch('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { status, severity } = req.body;

    const existing = db.prepare('SELECT * FROM incident_reports WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: `Incident ${id} not found.` });
    }

    const validStatuses = ['REPORTED', 'OPEN', 'WORKING', 'RESOLVED'];
    const validSeverities = ['Critical', 'High', 'Moderate', 'Low'];

    const targetStatus = status ? status.toUpperCase() : existing.status;
    const targetSeverity = severity || existing.severity;

    if (status && !validStatuses.includes(targetStatus)) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${validStatuses.join(', ')}` });
    }
    if (severity && !validSeverities.includes(targetSeverity)) {
      return res.status(400).json({ error: `Invalid severity. Allowed: ${validSeverities.join(', ')}` });
    }

    db.prepare(`
      UPDATE incident_reports 
      SET status = ?, severity = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(targetStatus, targetSeverity, id);

    const updated = db.prepare('SELECT * FROM incident_reports WHERE id = ?').get(id);

    const io = req.app.get('io');
    if (io) {
      io.emit('INCIDENT_UPDATED', updated);
    }

    return res.status(200).json({
      message: 'Incident updated successfully.',
      incident: updated
    });
  } catch (error) {
    console.error('[Incident Update Error]', error);
    return res.status(500).json({ error: 'Failed to update incident.' });
  }
});

module.exports = router;
