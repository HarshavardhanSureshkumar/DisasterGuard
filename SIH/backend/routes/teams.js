const express = require('express');
const router = express.Router();
const db = require('../database/db');

/**
 * GET /api/rescue-teams
 * Retrieve all registered rescue teams with status and current mission
 */
router.get('/', (req, res) => {
  try {
    const teams = db.prepare(`
      SELECT 
        t.id, t.name, t.department, t.status, t.current_lat, t.current_lng, t.members,
        m.id AS current_mission_id,
        m.sos_id AS current_sos_id,
        s.location_name AS mission_location,
        s.priority AS mission_priority
      FROM rescue_teams t
      LEFT JOIN missions m ON t.id = m.team_id AND m.status NOT IN ('COMPLETED', 'CANCELLED')
      LEFT JOIN sos_requests s ON m.sos_id = s.id
      ORDER BY t.id ASC
    `).all();

    return res.status(200).json({ rescue_teams: teams });
  } catch (error) {
    console.error('[Teams List Error]', error);
    return res.status(500).json({ error: 'Failed to fetch rescue teams.' });
  }
});

/**
 * PATCH /api/rescue-teams/:id/location
 * Field rescue team reports live GPS telemetry
 */
const handleLocationUpdate = (req, res) => {
  try {
    const { id } = req.params;
    const { latitude, longitude } = req.body;

    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: 'Latitude and longitude are required.' });
    }

    const team = db.prepare('SELECT * FROM rescue_teams WHERE id = ?').get(id);
    if (!team) {
      return res.status(404).json({ error: `Rescue team ${id} not found.` });
    }

    db.prepare(`
      UPDATE rescue_teams 
      SET current_lat = ?, current_lng = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(parseFloat(latitude), parseFloat(longitude), id);

    const updated = db.prepare('SELECT * FROM rescue_teams WHERE id = ?').get(id);

    const io = req.app.get('io');
    if (io) {
      io.emit('TEAM_LOCATION_UPDATED', {
        team_id: id,
        latitude: updated.current_lat,
        longitude: updated.current_lng
      });
    }

    return res.status(200).json({
      message: 'Team location updated successfully.',
      team: updated
    });
  } catch (error) {
    console.error('[Team Location Update Error]', error);
    return res.status(500).json({ error: 'Failed to update team location.' });
  }
};

router.patch('/:id/location', handleLocationUpdate);
router.post('/:id/location', handleLocationUpdate);

/**
 * POST /api/rescue-teams
 * Register a new rescue team
 */
router.post('/', (req, res) => {
  try {
    const { id, name, department, members, status, current_lat, current_lng } = req.body;

    if (!id || !name || !department) {
      return res.status(400).json({ error: 'Team ID, name, and department are required.' });
    }

    const existing = db.prepare('SELECT id FROM rescue_teams WHERE id = ?').get(id.trim());
    if (existing) {
      return res.status(409).json({ error: `Rescue team with ID ${id} already exists.` });
    }

    db.prepare(`
      INSERT INTO rescue_teams (id, name, department, members, status, current_lat, current_lng)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id.trim(),
      name.trim(),
      department.trim(),
      parseInt(members, 10) || 4,
      status ? status.toUpperCase() : 'AVAILABLE',
      current_lat != null ? parseFloat(current_lat) : 12.975,
      current_lng != null ? parseFloat(current_lng) : 80.21
    );

    const created = db.prepare('SELECT * FROM rescue_teams WHERE id = ?').get(id.trim());

    const io = req.app.get('io');
    if (io) {
      io.emit('TEAM_UPDATED', created);
    }

    return res.status(201).json({ message: 'Rescue team registered successfully.', team: created });
  } catch (error) {
    console.error('[Team Create Error]', error);
    return res.status(500).json({ error: 'Failed to create rescue team.' });
  }
});

/**
 * PUT /api/rescue-teams/:id
 * Update rescue team details
 */
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, department, members, status } = req.body;

    const existing = db.prepare('SELECT * FROM rescue_teams WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: `Rescue team ${id} not found.` });
    }

    db.prepare(`
      UPDATE rescue_teams
      SET name = ?, department = ?, members = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name ? name.trim() : existing.name,
      department ? department.trim() : existing.department,
      members != null ? parseInt(members, 10) : existing.members,
      status ? status.toUpperCase() : existing.status,
      id
    );

    const updated = db.prepare('SELECT * FROM rescue_teams WHERE id = ?').get(id);

    const io = req.app.get('io');
    if (io) {
      io.emit('TEAM_UPDATED', updated);
    }

    return res.status(200).json({ message: 'Rescue team updated successfully.', team: updated });
  } catch (error) {
    console.error('[Team Update Error]', error);
    return res.status(500).json({ error: 'Failed to update rescue team.' });
  }
});

/**
 * DELETE /api/rescue-teams/:id
 * Remove a rescue team
 */
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM rescue_teams WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: `Rescue team ${id} not found.` });
    }

    db.prepare('DELETE FROM rescue_teams WHERE id = ?').run(id);

    const io = req.app.get('io');
    if (io) {
      io.emit('TEAM_DELETED', { id });
    }

    return res.status(200).json({ message: `Rescue team ${id} deleted successfully.` });
  } catch (error) {
    console.error('[Team Delete Error]', error);
    return res.status(500).json({ error: 'Failed to delete rescue team.' });
  }
});

module.exports = router;
