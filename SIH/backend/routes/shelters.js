const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { calculateHaversineDistance } = require('../utils/geo');

/**
 * Calculates shelter state based on available vs total beds
 */
function calculateShelterStatus(availableBeds, totalBeds) {
  const available = Math.max(0, parseInt(availableBeds, 10) || 0);
  const total = Math.max(0, parseInt(totalBeds, 10) || 0);

  if (total === 0) return 'Closed';
  if (available === 0) return 'Full';
  const occupancyRate = (total - available) / total;
  return occupancyRate >= 0.75 ? 'Limited' : 'Available';
}

/**
 * GET /api/shelters/nearest
 * Computes Haversine distance to available shelters and sorts by proximity
 * Query params: lat, lng
 */
router.get('/nearest', (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (lat == null || lng == null) {
      return res.status(400).json({ error: 'Latitude and longitude query parameters are required.' });
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    if (isNaN(userLat) || isNaN(userLng)) {
      return res.status(400).json({ error: 'Invalid coordinates provided.' });
    }

    // Retrieve shelters that are NOT closed and have available beds > 0
    const shelters = db.prepare(`
      SELECT * FROM shelters 
      WHERE available_beds > 0 AND status != 'Closed'
    `).all();

    const withDistances = shelters.map(s => {
      const distance = calculateHaversineDistance(userLat, userLng, s.latitude, s.longitude);
      const occupancy = s.total_beds - s.available_beds;
      const occupancyPercent = s.total_beds > 0 ? Math.round((occupancy / s.total_beds) * 100) : 100;

      return {
        id: s.id,
        name: s.name,
        address: s.address,
        latitude: s.latitude,
        longitude: s.longitude,
        capacity: s.total_beds,
        available_beds: s.available_beds,
        occupancy,
        occupancy_percent: occupancyPercent,
        medical_support: s.medical_support,
        status: s.status,
        distance_km: distance
      };
    });

    // Sort by distance ascending
    withDistances.sort((a, b) => a.distance_km - b.distance_km);

    return res.status(200).json({
      query: { lat: userLat, lng: userLng },
      count: withDistances.length,
      shelters: withDistances
    });
  } catch (error) {
    console.error('[Shelters Nearest Error]', error);
    return res.status(500).json({ error: 'Failed to calculate nearest shelters.' });
  }
});

/**
 * GET /api/shelters
 * List all shelters with bed metrics
 */
router.get('/', (req, res) => {
  try {
    const shelters = db.prepare('SELECT * FROM shelters ORDER BY name ASC').all();
    const result = shelters.map(s => {
      const occupancy = s.total_beds - s.available_beds;
      const occupancyPercent = s.total_beds > 0 ? Math.round((occupancy / s.total_beds) * 100) : 0;
      return {
        ...s,
        occupancy,
        occupancy_percent: occupancyPercent
      };
    });

    return res.status(200).json({ shelters: result });
  } catch (error) {
    console.error('[Shelters List Error]', error);
    return res.status(500).json({ error: 'Failed to fetch shelters.' });
  }
});

/**
 * POST /api/shelters
 * Command Centre registers a new shelter
 */
router.post('/', (req, res) => {
  try {
    const { name, address, latitude, longitude, total_beds, available_beds, medical_support } = req.body;

    if (!name || latitude == null || longitude == null || total_beds == null) {
      return res.status(400).json({ error: 'Name, latitude, longitude, and total_beds are required.' });
    }

    const total = parseInt(total_beds, 10);
    const available = available_beds != null ? Math.min(total, parseInt(available_beds, 10)) : total;
    const status = calculateShelterStatus(available, total);
    const id = `SH-${Math.floor(1000 + Math.random() * 9000)}`;

    db.prepare(`
      INSERT INTO shelters (id, name, address, latitude, longitude, total_beds, available_beds, medical_support, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, name, address || '', parseFloat(latitude), parseFloat(longitude),
      total, available, medical_support || 'Available', status
    );

    const created = db.prepare('SELECT * FROM shelters WHERE id = ?').get(id);
    return res.status(201).json({ message: 'Shelter created successfully.', shelter: created });
  } catch (error) {
    console.error('[Shelter Create Error]', error);
    return res.status(500).json({ error: 'Failed to create shelter.' });
  }
});

/**
 * PUT /api/shelters/:id
 * Command Centre updates bed numbers or details
 */
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, latitude, longitude, total_beds, available_beds, medical_support } = req.body;

    const existing = db.prepare('SELECT * FROM shelters WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: `Shelter ${id} not found.` });
    }

    const total = total_beds != null ? parseInt(total_beds, 10) : existing.total_beds;
    const available = available_beds != null ? parseInt(available_beds, 10) : existing.available_beds;

    if (available > total) {
      return res.status(400).json({ error: 'Available beds cannot exceed total beds.' });
    }

    const status = calculateShelterStatus(available, total);

    db.prepare(`
      UPDATE shelters 
      SET name = ?, address = ?, latitude = ?, longitude = ?,
          total_beds = ?, available_beds = ?, medical_support = ?, status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name || existing.name,
      address != null ? address : existing.address,
      latitude != null ? parseFloat(latitude) : existing.latitude,
      longitude != null ? parseFloat(longitude) : existing.longitude,
      total, available,
      medical_support || existing.medical_support,
      status, id
    );

    const updated = db.prepare('SELECT * FROM shelters WHERE id = ?').get(id);
    return res.status(200).json({ message: 'Shelter updated successfully.', shelter: updated });
  } catch (error) {
    console.error('[Shelter Update Error]', error);
    return res.status(500).json({ error: 'Failed to update shelter.' });
  }
});

/**
 * DELETE /api/shelters/:id
 * Remove a shelter from the network
 */
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM shelters WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: `Shelter ${id} not found.` });
    }

    db.prepare('DELETE FROM shelters WHERE id = ?').run(id);
    return res.status(200).json({ message: `Shelter ${id} deleted successfully.` });
  } catch (error) {
    console.error('[Shelter Delete Error]', error);
    return res.status(500).json({ error: 'Failed to delete shelter.' });
  }
});

module.exports = router;
