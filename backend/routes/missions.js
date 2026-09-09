const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Defined state progression order
const MISSION_LIFECYCLE = ['ASSIGNED', 'DISPATCHED', 'ON_SCENE', 'RESCUED', 'COMPLETED'];

/**
 * Validates if transition from current to target is strictly legal
 */
function isValidTransition(current, target) {
  if (target === 'CANCELLED') {
    return current !== 'COMPLETED' && current !== 'CANCELLED';
  }
  const currentIndex = MISSION_LIFECYCLE.indexOf(current);
  const targetIndex = MISSION_LIFECYCLE.indexOf(target);
  return currentIndex !== -1 && targetIndex === currentIndex + 1;
}

/**
 * POST /api/missions
 * Atomically create mission and assign available rescue team to pending SOS
 */
router.post('/', (req, res) => {
  try {
    const { sos_id, team_id } = req.body;

    if (!sos_id || !team_id) {
      return res.status(400).json({ error: 'sos_id and team_id are required.' });
    }

    const missionId = `MIS-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    const assignTransaction = db.transaction(() => {
      // 1. Verify SOS exists and is pending
      const sos = db.prepare('SELECT id, status FROM sos_requests WHERE id = ?').get(sos_id);
      if (!sos) {
        throw { statusCode: 404, message: `SOS request ${sos_id} not found.` };
      }
      if (sos.status !== 'PENDING') {
        throw {
          statusCode: 409,
          message: `Cannot assign SOS ${sos_id}. Current status is '${sos.status}', expected 'PENDING'.`
        };
      }

      // 2. Verify Rescue Team exists and is available
      const team = db.prepare('SELECT id, status, name FROM rescue_teams WHERE id = ?').get(team_id);
      if (!team) {
        throw { statusCode: 404, message: `Rescue Team ${team_id} not found.` };
      }
      if (team.status !== 'AVAILABLE') {
        throw {
          statusCode: 409,
          message: `Rescue Team ${team_id} (${team.name}) is currently '${team.status}'. Only AVAILABLE teams can be assigned.`
        };
      }

      // 3. Create mission
      db.prepare(`
        INSERT INTO missions (id, sos_id, team_id, status, accepted_at)
        VALUES (?, ?, ?, 'ASSIGNED', CURRENT_TIMESTAMP)
      `).run(missionId, sos_id, team_id);

      // 4. Update SOS status & link team
      db.prepare(`
        UPDATE sos_requests 
        SET status = 'ASSIGNED', assigned_team_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(team_id, sos_id);

      // 5. Set team status to ON_MISSION
      db.prepare(`
        UPDATE rescue_teams 
        SET status = 'ON_MISSION', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(team_id);
    });

    assignTransaction();

    const createdMission = db.prepare(`
      SELECT m.*, s.location_name, s.emergency_type, s.people_count, s.priority, s.latitude, s.longitude,
             t.name AS team_name, t.department AS team_department
      FROM missions m
      JOIN sos_requests s ON m.sos_id = s.id
      JOIN rescue_teams t ON m.team_id = t.id
      WHERE m.id = ?
    `).get(missionId);

    const io = req.app.get('io');
    if (io) {
      io.emit('MISSION_ASSIGNED', createdMission);
      io.emit('SOS_UPDATED', { id: sos_id, status: 'ASSIGNED', assigned_team_id: team_id });
    }

    return res.status(201).json({
      message: 'Rescue team assigned successfully.',
      mission: createdMission
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('[Mission Assign Error]', error);
    return res.status(500).json({ error: 'Failed to create mission assignment.' });
  }
});

/**
 * GET /api/missions
 * Retrieve all missions, filterable by team_id or status
 */
router.get('/', (req, res) => {
  try {
    const { team_id, status } = req.query;

    let query = `
      SELECT 
        m.*,
        s.citizen_name, s.citizen_email, s.emergency_type, s.people_count,
        s.medical, s.description AS sos_description, s.location_name,
        s.latitude AS sos_lat, s.longitude AS sos_lng, s.priority,
        t.name AS team_name, t.department AS team_department,
        sh.name AS shelter_name, sh.latitude AS shelter_lat, sh.longitude AS shelter_lng
      FROM missions m
      JOIN sos_requests s ON m.sos_id = s.id
      JOIN rescue_teams t ON m.team_id = t.id
      LEFT JOIN shelters sh ON s.shelter_id = sh.id
      WHERE 1=1
    `;
    const params = [];

    if (team_id) {
      query += ` AND m.team_id = ?`;
      params.push(team_id);
    }
    if (status) {
      query += ` AND m.status = ?`;
      params.push(status.toUpperCase());
    }

    query += ` ORDER BY m.created_at DESC`;

    const missionsList = db.prepare(query).all(...params);

    // Attach individual person records
    const getPersons = db.prepare(`
      SELECT person_index, condition FROM sos_person_records WHERE sos_id = ? ORDER BY person_index ASC
    `);

    const result = missionsList.map(m => ({
      ...m,
      persons: getPersons.all(m.sos_id)
    }));

    return res.status(200).json({ missions: result });
  } catch (error) {
    console.error('[Missions List Error]', error);
    return res.status(500).json({ error: 'Failed to fetch missions.' });
  }
});

/**
 * PATCH /api/missions/:id/advance and PATCH /api/missions/:id/status
 * Enforce strict mission state-machine progression
 */
const handleMissionAdvance = (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Target status is required.' });
    }

    const targetStatus = status.toUpperCase();

    const mission = db.prepare(`
      SELECT m.*, s.people_count, s.assigned_team_id
      FROM missions m
      JOIN sos_requests s ON m.sos_id = s.id
      WHERE m.id = ?
    `).get(id);

    if (!mission) {
      return res.status(404).json({ error: `Mission ${id} not found.` });
    }

    // Check transition validity
    if (!isValidTransition(mission.status, targetStatus)) {
      return res.status(400).json({
        error: `Invalid status transition: Cannot advance from '${mission.status}' to '${targetStatus}'. Allowed order: ASSIGNED -> DISPATCHED -> ON_SCENE -> RESCUED -> COMPLETED (or CANCELLED).`
      });
    }

    const advanceTransaction = db.transaction(() => {
      let timestampField = '';
      if (targetStatus === 'DISPATCHED') timestampField = ', dispatched_at = CURRENT_TIMESTAMP';
      else if (targetStatus === 'ON_SCENE') timestampField = ', on_scene_at = CURRENT_TIMESTAMP';
      else if (targetStatus === 'RESCUED') timestampField = ', rescued_at = CURRENT_TIMESTAMP';
      else if (targetStatus === 'COMPLETED') {
        timestampField = ', completed_at = CURRENT_TIMESTAMP';

        // Check headcount condition: ALL persons must be accounted for (Safe, Injured, Critical, Needs Medical Attention)
        const missingCount = db.prepare(`
          SELECT COUNT(*) AS count 
          FROM sos_person_records 
          WHERE sos_id = ? AND condition = 'Missing / Unaccounted'
        `).get(mission.sos_id).count;

        if (missingCount > 0) {
          throw {
            statusCode: 400,
            message: `Cannot mark mission COMPLETED: ${missingCount} person(s) remain 'Missing / Unaccounted'. Every individual must be accounted for before completion.`
          };
        }
      }

      // 1. Update Mission
      db.prepare(`
        UPDATE missions 
        SET status = ?, updated_at = CURRENT_TIMESTAMP ${timestampField}
        WHERE id = ?
      `).run(targetStatus, id);

      // 2. Keep linked SOS status in lockstep
      let rescuedCountUpdate = '';
      if (targetStatus === 'COMPLETED' || targetStatus === 'RESCUED') {
        rescuedCountUpdate = `, rescued_count = ${mission.people_count}`;
      }

      db.prepare(`
        UPDATE sos_requests 
        SET status = ?, updated_at = CURRENT_TIMESTAMP ${rescuedCountUpdate}
        WHERE id = ?
      `).run(targetStatus, mission.sos_id);

      // 3. Free rescue team back to AVAILABLE upon completion or cancellation
      if (targetStatus === 'COMPLETED' || targetStatus === 'CANCELLED') {
        db.prepare(`
          UPDATE rescue_teams 
          SET status = 'AVAILABLE', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(mission.team_id);
      }
    });

    advanceTransaction();

    const updated = db.prepare('SELECT * FROM missions WHERE id = ?').get(id);

    const io = req.app.get('io');
    if (io) {
      io.emit('MISSION_STATUS_UPDATED', {
        missionId: id,
        sosId: mission.sos_id,
        status: targetStatus,
        teamId: mission.team_id
      });
    }

    return res.status(200).json({
      message: `Mission advanced to ${targetStatus}.`,
      mission: updated
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('[Mission Advance Error]', error);
    return res.status(500).json({ error: 'Failed to advance mission status.' });
  }
};

router.patch('/:id/advance', handleMissionAdvance);
router.patch('/:id/status', handleMissionAdvance);

/**
 * PUT /api/missions/:id/persons
 * Update condition of individual persons in the rescue mission
 */
router.put('/:id/persons', (req, res) => {
  try {
    const { id } = req.params;
    const { person_index, condition, person_statuses } = req.body;

    const mission = db.prepare('SELECT sos_id FROM missions WHERE id = ?').get(id);
    if (!mission) {
      return res.status(404).json({ error: `Mission ${id} not found.` });
    }

    const validConditions = ['Safe', 'Injured', 'Critical', 'Needs Medical Attention', 'Missing / Unaccounted'];

    const updateCondition = db.prepare(`
      UPDATE sos_person_records 
      SET condition = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE sos_id = ? AND person_index = ?
    `);

    const updateTx = db.transaction(() => {
      if (Array.isArray(person_statuses)) {
        person_statuses.forEach((cond, idx) => {
          if (validConditions.includes(cond)) {
            updateCondition.run(cond, mission.sos_id, idx + 1);
          }
        });
      } else if (person_index != null && condition) {
        if (!validConditions.includes(condition)) {
          throw { statusCode: 400, message: `Invalid condition '${condition}'. Allowed: ${validConditions.join(', ')}` };
        }
        updateCondition.run(condition, mission.sos_id, parseInt(person_index, 10));
      } else {
        throw { statusCode: 400, message: 'Must provide either person_statuses array or person_index and condition.' };
      }
    });

    updateTx();

    const persons = db.prepare(`
      SELECT person_index, condition, updated_at FROM sos_person_records WHERE sos_id = ? ORDER BY person_index ASC
    `).all(mission.sos_id);

    return res.status(200).json({
      message: 'Person conditions updated successfully.',
      persons
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('[Person Condition Error]', error);
    return res.status(500).json({ error: 'Failed to update person conditions.' });
  }
});

module.exports = router;
