const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { calculateSOSPriority } = require('../utils/priority');

/**
 * Helper to generate random SOS ID
 */
function generateSOSId() {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `SOS-2026-${rand}`;
}

/**
 * POST /api/sos
 * Citizen or field operator submits an emergency SOS request
 */
router.post('/', (req, res) => {
  try {
    const emType = req.body.emergency_type || req.body.type || req.body.emergencyType;
    const locName = req.body.location_name || req.body.location_address || req.body.location || req.body.address;
    const lat = req.body.latitude != null ? req.body.latitude : req.body.lat;
    const lng = req.body.longitude != null ? req.body.longitude : (req.body.lng != null ? req.body.lng : req.body.lon);
    const people = Math.max(1, parseInt(req.body.people_count || req.body.people || req.body.peopleCount, 10) || 1);
    const medVal = req.body.medical != null ? req.body.medical : (req.body.medical_required != null ? req.body.medical_required : req.body.isMedical);
    const isMedical = medVal === true || String(medVal).toLowerCase() === 'yes' || String(medVal).toLowerCase() === 'true';
    const email = (req.body.citizen_email || req.body.email) ? String(req.body.citizen_email || req.body.email).trim() : 'anonymous@disasterguard.com';
    const name = (req.body.citizen_name || req.body.name) ? String(req.body.citizen_name || req.body.name).trim() : 'Anonymous Citizen';
    const description = req.body.description || req.body.desc || '';

    if (!emType || !locName || lat == null || lng == null) {
      return res.status(400).json({
        error: 'Emergency type, location name, latitude, and longitude are required.'
      });
    }

    // SERVER calculates authoritative priority
    const priority = calculateSOSPriority({
      emergencyType: emType,
      medical: isMedical,
      peopleCount: people
    });

    const sosId = generateSOSId();

    // Look up citizen user ID if email matches a registered user
    const user = db.prepare('SELECT id FROM users WHERE identifier = ?').get(email);
    const citizenId = user ? user.id : null;

    // Execute insertion and person record initialization atomically
    const createSOS = db.transaction(() => {
      db.prepare(`
        INSERT INTO sos_requests (
          id, citizen_id, citizen_email, citizen_name,
          emergency_type, people_count, medical, description,
          location_name, latitude, longitude, priority, status
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, 'PENDING'
        )
      `).run(
        sosId, citizenId, email, name,
        emType, people, isMedical ? 1 : 0, description || '',
        locName, parseFloat(lat), parseFloat(lng), priority
      );

      // Initialize person condition records
      const insertPerson = db.prepare(`
        INSERT INTO sos_person_records (id, sos_id, person_index, condition)
        VALUES (?, ?, ?, ?)
      `);

      for (let i = 0; i < people; i++) {
        const personId = `${sosId}-P${i + 1}`;
        const initialCondition = (i === 0 && isMedical) ? 'Needs Medical Attention' : 'Missing / Unaccounted';
        insertPerson.run(personId, sosId, i + 1, initialCondition);
      }
    });

    createSOS();

    const createdSOS = db.prepare(`
      SELECT * FROM sos_requests WHERE id = ?
    `).get(sosId);

    const persons = db.prepare(`
      SELECT person_index, condition FROM sos_person_records WHERE sos_id = ? ORDER BY person_index ASC
    `).all(sosId);

    // Socket.IO Real-time broadcast if IO is attached to req.app
    const io = req.app.get('io');
    if (io) {
      io.emit('NEW_SOS', { ...createdSOS, persons });
    }

    return res.status(201).json({
      message: 'SOS request registered successfully.',
      sos: {
        ...createdSOS,
        persons
      },
      headcount: persons
    });
  } catch (error) {
    console.error('[SOS Create Error]', error);
    return res.status(500).json({ error: 'Failed to create SOS request.' });
  }
});

/**
 * GET /api/sos
 * Retrieve list of SOS requests with optional filtering
 */
router.get('/', (req, res) => {
  try {
    const { status, priority, citizen_email, department } = req.query;

    let query = `
      SELECT 
        s.*,
        t.name AS assigned_team_name,
        t.department AS assigned_team_department,
        sh.name AS shelter_name
      FROM sos_requests s
      LEFT JOIN rescue_teams t ON s.assigned_team_id = t.id
      LEFT JOIN shelters sh ON s.shelter_id = sh.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      query += ` AND s.status = ?`;
      params.push(status.toUpperCase());
    }
    if (priority && priority !== 'all') {
      query += ` AND s.priority = ?`;
      params.push(priority.toUpperCase());
    }
    if (citizen_email) {
      query += ` AND s.citizen_email = ?`;
      params.push(citizen_email);
    }
    if (department && department !== 'All Departments') {
      query += ` AND t.department = ?`;
      params.push(department);
    }

    query += ` ORDER BY s.created_at DESC`;

    const sosList = db.prepare(query).all(...params);

    // Attach person records to each SOS
    const getPersons = db.prepare(`
      SELECT person_index, condition FROM sos_person_records WHERE sos_id = ? ORDER BY person_index ASC
    `);

    const result = sosList.map(item => ({
      ...item,
      persons: getPersons.all(item.id)
    }));

    return res.status(200).json({ sos: result });
  } catch (error) {
    console.error('[SOS List Error]', error);
    return res.status(500).json({ error: 'Failed to fetch SOS list.' });
  }
});

/**
 * GET /api/sos/:id
 * Retrieve a specific SOS request with full details
 */
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const sos = db.prepare(`
      SELECT 
        s.*,
        t.name AS assigned_team_name,
        t.department AS assigned_team_department,
        t.status AS assigned_team_status,
        sh.name AS shelter_name,
        sh.latitude AS shelter_lat,
        sh.longitude AS shelter_lng,
        m.id AS mission_id,
        m.status AS mission_status
      FROM sos_requests s
      LEFT JOIN rescue_teams t ON s.assigned_team_id = t.id
      LEFT JOIN shelters sh ON s.shelter_id = sh.id
      LEFT JOIN missions m ON s.id = m.sos_id
      WHERE s.id = ?
    `).get(id);

    if (!sos) {
      return res.status(404).json({ error: 'SOS request not found.' });
    }

    const persons = db.prepare(`
      SELECT person_index, condition, updated_at 
      FROM sos_person_records 
      WHERE sos_id = ? 
      ORDER BY person_index ASC
    `).all(id);

    return res.status(200).json({
      sos: {
        ...sos,
        persons
      }
    });
  } catch (error) {
    console.error('[SOS Detail Error]', error);
    return res.status(500).json({ error: 'Failed to fetch SOS details.' });
  }
});

module.exports = router;
