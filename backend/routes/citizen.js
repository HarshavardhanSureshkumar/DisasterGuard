const express = require('express');
const router = express.Router();
const db = require('../database/db');

/**
 * GET /api/citizen/history
 * Unified historical record combining SOS, Incidents, and Supplies for a citizen
 * Query param: email
 */
router.get('/history', (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Citizen email is required.' });
    }

    const normalizedEmail = String(email).trim();

    // 1. Fetch SOS requests
    const sosList = db.prepare(`
      SELECT 
        id, 'SOS' AS entry_type, emergency_type AS detail_type,
        location_name, priority, status, created_at, description
      FROM sos_requests
      WHERE citizen_email = ?
    `).all(normalizedEmail);

    // 2. Fetch Incident reports
    const incidentList = db.prepare(`
      SELECT 
        id, 'Incident' AS entry_type, type AS detail_type,
        location_name, severity AS priority, status, created_at, description
      FROM incident_reports
      WHERE citizen_email = ?
    `).all(normalizedEmail);

    // 3. Fetch Supply requests
    const supplyList = db.prepare(`
      SELECT 
        id, 'Supply' AS entry_type, type AS detail_type,
        location_name, urgency AS priority, status, created_at, details AS description
      FROM supply_requests
      WHERE citizen_email = ?
    `).all(normalizedEmail);

    // Combine and sort chronologically descending
    const combined = [...sosList, ...incidentList, ...supplyList];
    combined.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return res.status(200).json({
      citizen_email: normalizedEmail,
      total_entries: combined.length,
      history: combined
    });
  } catch (error) {
    console.error('[Citizen History Error]', error);
    return res.status(500).json({ error: 'Failed to retrieve citizen history.' });
  }
});

/**
 * PATCH /api/citizen/safety
 * Citizen marks themselves SAFE or UNSAFE
 */
router.patch('/safety', (req, res) => {
  try {
    const { email, status } = req.body;

    if (!email || !status) {
      return res.status(400).json({ error: 'Email and status (SAFE/UNSAFE) are required.' });
    }

    const normalizedStatus = String(status).toUpperCase();
    if (!['SAFE', 'UNSAFE'].includes(normalizedStatus)) {
      return res.status(400).json({ error: 'Status must be SAFE or UNSAFE.' });
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('CITIZEN_SAFETY_UPDATED', {
        citizen_email: email,
        status: normalizedStatus,
        timestamp: new Date().toISOString()
      });
    }

    return res.status(200).json({
      message: `Safety status updated to ${normalizedStatus}.`,
      citizen_email: email,
      status: normalizedStatus,
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Citizen Safety Error]', error);
    return res.status(500).json({ error: 'Failed to update safety status.' });
  }
});

module.exports = router;
