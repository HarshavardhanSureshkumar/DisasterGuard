const express = require('express');
const router = express.Router();
const db = require('../database/db');

const ALLOWED_SUPPLY_TYPES = ['Food', 'Water', 'Medicine', 'Blankets', 'Food & Water', 'Water & Food Packets', 'First Aid', 'Emergency Shelter Kit', 'Other'];
const SUPPLY_LIFECYCLE = ['PENDING', 'APPROVED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

/**
 * POST /api/supply-requests
 * Citizen requests essential supplies
 */
router.post('/', (req, res) => {
  try {
    const rawType = req.body.type || req.body.item_type || req.body.itemType || 'Food & Water';
    const location_name = req.body.location_name || req.body.delivery_address || req.body.deliveryAddress || req.body.address || req.body.location || 'Chennai';
    const latitude = req.body.latitude != null ? req.body.latitude : req.body.lat;
    const longitude = req.body.longitude != null ? req.body.longitude : (req.body.lng != null ? req.body.lng : req.body.lon);
    const citizen_email = req.body.citizen_email || req.body.email;
    const citizen_name = req.body.citizen_name || req.body.name;
    const details = req.body.details || req.body.notes || req.body.description || '';
    const people_count = req.body.people_count || req.body.quantity || req.body.people || 1;
    const urgency = req.body.urgency || 'Normal';

    const VALID_DB_TYPES = ['Food', 'Water', 'Medicine', 'Blankets', 'Food & Water'];
    const typeLower = String(rawType).toLowerCase();
    let type = 'Food & Water';
    if (typeLower.includes('med') || typeLower.includes('first aid')) type = 'Medicine';
    else if (typeLower.includes('blanket') || typeLower.includes('shelter')) type = 'Blankets';
    else if (typeLower.includes('water') && !typeLower.includes('food')) type = 'Water';
    else if (typeLower.includes('food') && !typeLower.includes('water')) type = 'Food';
    else if (typeLower.includes('food') && typeLower.includes('water')) type = 'Food & Water';
    else if (VALID_DB_TYPES.includes(rawType)) type = rawType;

    if (!location_name) {
      return res.status(400).json({ error: 'Location / delivery address is required.' });
    }

    const email = citizen_email ? String(citizen_email).trim() : 'anonymous@disasterguard.com';
    const name = citizen_name ? String(citizen_name).trim() : 'Citizen Requester';
    const people = Math.max(1, parseInt(people_count, 10) || 1);

    let citizenId = null;
    const user = db.prepare('SELECT id FROM users WHERE identifier = ?').get(email);
    if (user) citizenId = user.id;

    const requestId = `SR-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    db.prepare(`
      INSERT INTO supply_requests (
        id, citizen_id, citizen_email, citizen_name,
        type, details, people_count, urgency, location_name,
        latitude, longitude, status
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, 'PENDING'
      )
    `).run(
      requestId, citizenId, email, name,
      type, details || '', people, urgency || 'Normal', location_name,
      latitude != null ? parseFloat(latitude) : null,
      longitude != null ? parseFloat(longitude) : null
    );

    const created = db.prepare('SELECT * FROM supply_requests WHERE id = ?').get(requestId);

    const io = req.app.get('io');
    if (io) {
      io.emit('NEW_SUPPLY_REQUEST', created);
    }

    return res.status(201).json({
      message: 'Supply request submitted successfully.',
      supply_request: created
    });
  } catch (error) {
    console.error('[Supply Request Create Error]', error);
    return res.status(500).json({ error: 'Failed to submit supply request.' });
  }
});

/**
 * GET /api/supply-requests
 * Retrieve all supply requests
 */
router.get('/', (req, res) => {
  try {
    const { status, citizen_email } = req.query;

    let query = 'SELECT * FROM supply_requests WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status.toUpperCase());
    }
    if (citizen_email) {
      query += ' AND citizen_email = ?';
      params.push(citizen_email);
    }

    query += ' ORDER BY created_at DESC';

    const requests = db.prepare(query).all(...params);
    return res.status(200).json({ supply_requests: requests });
  } catch (error) {
    console.error('[Supply Request List Error]', error);
    return res.status(500).json({ error: 'Failed to fetch supply requests.' });
  }
});

/**
 * PATCH /api/supply-requests/:id
 * Command Centre updates supply request lifecycle
 */
router.patch('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Target status is required.' });
    }

    const targetStatus = status.toUpperCase();
    if (!SUPPLY_LIFECYCLE.includes(targetStatus)) {
      return res.status(400).json({
        error: `Invalid status. Allowed: ${SUPPLY_LIFECYCLE.join(', ')}`
      });
    }

    const existing = db.prepare('SELECT * FROM supply_requests WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: `Supply request ${id} not found.` });
    }

    db.prepare(`
      UPDATE supply_requests 
      SET status = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(targetStatus, id);

    const updated = db.prepare('SELECT * FROM supply_requests WHERE id = ?').get(id);

    const io = req.app.get('io');
    if (io) {
      io.emit('SUPPLY_REQUEST_UPDATED', updated);
    }

    return res.status(200).json({
      message: `Supply request updated to ${targetStatus}.`,
      supply_request: updated
    });
  } catch (error) {
    console.error('[Supply Request Update Error]', error);
    return res.status(500).json({ error: 'Failed to update supply request.' });
  }
});

module.exports = router;
