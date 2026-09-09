const express = require('express');
const router = express.Router();
const db = require('../database/db');

/**
 * GET /api/resources
 * Retrieve warehouse inventory stock levels
 */
router.get('/', (req, res) => {
  try {
    const resources = db.prepare('SELECT * FROM resources ORDER BY name ASC').all();
    return res.status(200).json({ resources });
  } catch (error) {
    console.error('[Resources List Error]', error);
    return res.status(500).json({ error: 'Failed to fetch resources.' });
  }
});

/**
 * GET /api/resource-requests
 * Retrieve all team supply replenishment requests
 */
router.get('/requests', (req, res) => {
  try {
    const { status, team_id } = req.query;

    let query = `
      SELECT 
        rr.*,
        r.name AS resource_name,
        r.unit AS resource_unit,
        r.available AS resource_available,
        t.name AS team_name,
        t.department AS team_department
      FROM resource_requests rr
      JOIN resources r ON rr.resource_id = r.id
      JOIN rescue_teams t ON rr.team_id = t.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ' AND rr.status = ?';
      params.push(status.toUpperCase());
    }
    if (team_id) {
      query += ' AND rr.team_id = ?';
      params.push(team_id);
    }

    query += ' ORDER BY rr.created_at DESC';

    const requests = db.prepare(query).all(...params);
    return res.status(200).json({ resource_requests: requests });
  } catch (error) {
    console.error('[Resource Requests List Error]', error);
    return res.status(500).json({ error: 'Failed to fetch resource requests.' });
  }
});

/**
 * POST /api/resource-requests
 * Rescue team submits a supply replenishment request
 */
router.post('/requests', (req, res) => {
  try {
    const { team_id, resource_id, resource_name, quantity, description } = req.body;

    if (!team_id || (!resource_id && !resource_name) || !quantity) {
      return res.status(400).json({ error: 'team_id, resource_id/resource_name, and quantity are required.' });
    }

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive number.' });
    }

    // Verify team
    const team = db.prepare('SELECT id FROM rescue_teams WHERE id = ?').get(team_id);
    if (!team) {
      return res.status(404).json({ error: `Rescue team ${team_id} not found.` });
    }

    // Verify resource
    let resource;
    if (resource_id) {
      resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(resource_id);
    } else {
      resource = db.prepare('SELECT * FROM resources WHERE LOWER(name) = LOWER(?)').get(resource_name.trim());
    }

    if (!resource) {
      return res.status(404).json({ error: 'Requested resource item not found in warehouse inventory.' });
    }

    const requestId = `RES-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    db.prepare(`
      INSERT INTO resource_requests (id, team_id, resource_id, quantity, description, status)
      VALUES (?, ?, ?, ?, ?, 'REQUESTED')
    `).run(requestId, team_id, resource.id, qty, description || '');

    const created = db.prepare(`
      SELECT rr.*, r.name AS resource_name, r.unit AS resource_unit, t.name AS team_name
      FROM resource_requests rr
      JOIN resources r ON rr.resource_id = r.id
      JOIN rescue_teams t ON rr.team_id = t.id
      WHERE rr.id = ?
    `).get(requestId);

    const io = req.app.get('io');
    if (io) {
      io.emit('NEW_RESOURCE_REQUEST', created);
    }

    return res.status(201).json({
      message: 'Resource request created successfully.',
      resource_request: created
    });
  } catch (error) {
    console.error('[Resource Request Create Error]', error);
    return res.status(500).json({ error: 'Failed to create resource request.' });
  }
});

/**
 * PATCH /api/resource-requests/:id/allocate
 * Command Centre fulfills/allocates requested supplies to a rescue team
 * Atomically deducts inventory stock and prevents negative quantities.
 */
router.patch('/requests/:id/allocate', (req, res) => {
  try {
    const { id } = req.params;
    const { allocate_quantity } = req.body;

    const requestItem = db.prepare(`
      SELECT rr.*, r.available, r.name AS resource_name 
      FROM resource_requests rr 
      JOIN resources r ON rr.resource_id = r.id 
      WHERE rr.id = ?
    `).get(id);

    if (!requestItem) {
      return res.status(404).json({ error: `Resource request ${id} not found.` });
    }

    if (requestItem.status === 'FULFILLED') {
      return res.status(400).json({ error: 'This resource request is already fulfilled.' });
    }

    const qtyToAllocate = allocate_quantity != null ? parseInt(allocate_quantity, 10) : requestItem.quantity;

    if (isNaN(qtyToAllocate) || qtyToAllocate <= 0) {
      return res.status(400).json({ error: 'Allocated quantity must be greater than zero.' });
    }

    // Atomic transaction: verify stock, deduct inventory, update status
    const allocateTx = db.transaction(() => {
      // Re-fetch current stock inside transaction
      const stock = db.prepare('SELECT available FROM resources WHERE id = ?').get(requestItem.resource_id);

      if (stock.available < qtyToAllocate) {
        throw {
          statusCode: 409,
          message: `Insufficient stock for ${requestItem.resource_name}. Requested ${qtyToAllocate}, but only ${stock.available} available.`
        };
      }

      // Decrement warehouse stock
      db.prepare(`
        UPDATE resources 
        SET available = available - ? 
        WHERE id = ?
      `).run(qtyToAllocate, requestItem.resource_id);

      // Update request status
      db.prepare(`
        UPDATE resource_requests 
        SET status = 'FULFILLED', updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(id);
    });

    allocateTx();

    const updatedRequest = db.prepare('SELECT * FROM resource_requests WHERE id = ?').get(id);
    const updatedResource = db.prepare('SELECT * FROM resources WHERE id = ?').get(requestItem.resource_id);

    const io = req.app.get('io');
    if (io) {
      io.emit('RESOURCE_ALLOCATED', {
        request: updatedRequest,
        resource: updatedResource
      });
    }

    return res.status(200).json({
      message: `Allocated ${qtyToAllocate} units of ${requestItem.resource_name} successfully.`,
      resource_request: updatedRequest,
      resource: updatedResource
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('[Resource Allocate Error]', error);
    return res.status(500).json({ error: 'Failed to allocate resource.' });
  }
});

module.exports = router;
