const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');

/**
 * Determine portal dashboard URL based on role and identifier
 */
function getDashboardUrl(role, identifier) {
  if (role === 'citizen') {
    return identifier === 'citizen02@disasterguard.com' ? 'citizen2.html' : 'citizen1.html';
  } else if (role === 'rescue') {
    return 'rescue.html';
  } else if (role === 'command') {
    return identifier === 'CC-2026-0002' ? 'command_centre2.html' : 'command_centre1.html';
  }
  return 'main-1.html';
}

/**
 * POST /api/auth/login
 * Body: { role: 'citizen'|'rescue'|'command', id: '...', password: '...' }
 */
router.post('/login', (req, res) => {
  try {
    const role = req.body.role;
    const id = req.body.id || req.body.identifier || req.body.email;
    const password = req.body.password;

    if (!role || !id || !password) {
      return res.status(400).json({ error: 'Role, identifier, and password are required.' });
    }

    const normalizedRole = String(role).trim().toLowerCase();
    const normalizedId = String(id).trim();

    // Query user
    const user = db.prepare(`
      SELECT id, identifier, password_hash, role, name, department 
      FROM users 
      WHERE identifier = ? AND role = ?
    `).get(normalizedId, normalizedRole);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials. Please check your username/ID and role.' });
    }

    // Verify password
    const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials. Please check your password.' });
    }

    const dashboardUrl = getDashboardUrl(user.role, user.identifier);

    // Payload for JWT token
    const tokenPayload = {
      userId: user.id,
      identifier: user.identifier,
      role: user.role,
      name: user.name,
      department: user.department
    };

    // Sign JWT (expires in 7 days)
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

    return res.status(200).json({
      message: 'Login successful',
      token,
      dashboardUrl,
      user: {
        id: user.id,
        identifier: user.identifier,
        role: user.role,
        name: user.name,
        department: user.department
      }
    });
  } catch (error) {
    console.error('[Auth Error]', error);
    return res.status(500).json({ error: 'An unexpected server error occurred during login.' });
  }
});

/**
 * POST /api/auth/register
 * Body: { role: 'citizen'|'rescue'|'command', identifier, password, name, department }
 */
router.post('/register', (req, res) => {
  try {
    const role = req.body.role;
    let identifier = req.body.identifier || req.body.id || req.body.email;
    const password = req.body.password;
    const name = req.body.name;
    const department = req.body.department;
    const members = Number(req.body.members) || 4;

    const normalizedRole = String(role || '').trim().toLowerCase();

    if (normalizedRole === 'rescue' && (!identifier || identifier.includes('@'))) {
      const count = db.prepare('SELECT COUNT(*) as count FROM rescue_teams').get().count + 1;
      identifier = `RT-2026-${String(count).padStart(4, '0')}`;
    }

    if (!role || !identifier || !password || !name) {
      return res.status(400).json({ error: 'Role, identifier, password, and name are required.' });
    }

    const normalizedId = String(identifier).trim();
    const cleanName = String(name).trim();

    if (!['citizen', 'rescue', 'command'].includes(normalizedRole)) {
      return res.status(400).json({ error: 'Invalid role. Must be citizen, rescue, or command.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    // Check existing
    const existing = db.prepare('SELECT id FROM users WHERE identifier = ?').get(normalizedId);
    if (existing) {
      return res.status(409).json({ error: 'An account with this identifier already exists.' });
    }

    const userId = `USR-${normalizedRole.toUpperCase().slice(0, 4)}-${Math.floor(1000 + Math.random() * 9000)}`;
    const passwordHash = bcrypt.hashSync(password, 10);

    let createdTeam = null;

    const registerTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO users (id, identifier, password_hash, role, name, department)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, normalizedId, passwordHash, normalizedRole, cleanName, department || null);

      if (normalizedRole === 'rescue') {
        const teamCheck = db.prepare('SELECT id FROM rescue_teams WHERE id = ?').get(normalizedId);
        if (!teamCheck) {
          db.prepare(`
            INSERT INTO rescue_teams (id, user_id, name, department, status, current_lat, current_lng, members)
            VALUES (?, ?, ?, ?, 'AVAILABLE', 12.9750, 80.2100, ?)
          `).run(normalizedId, userId, cleanName, department || 'Rescue Unit', members);
          createdTeam = { id: normalizedId, name: cleanName, department: department || 'Rescue Unit', members, status: 'AVAILABLE' };
        }
      }
    });

    registerTx();

    const dashboardUrl = getDashboardUrl(normalizedRole, normalizedId);
    const tokenPayload = {
      userId,
      identifier: normalizedId,
      role: normalizedRole,
      name: cleanName,
      department: department || null
    };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

    return res.status(201).json({
      message: 'Account registered successfully',
      token,
      dashboardUrl,
      user: tokenPayload,
      team: createdTeam || (normalizedRole === 'rescue' ? { id: normalizedId, name: cleanName, department: department || 'Rescue Unit', members, status: 'AVAILABLE' } : undefined)
    });
  } catch (error) {
    console.error('[Auth Register Error]', error);
    return res.status(500).json({ error: 'Failed to register account.' });
  }
});

/**
 * GET /api/auth/me
 * Returns current authenticated user info
 */
router.get('/me', authenticateToken, (req, res) => {
  return res.status(200).json({
    user: req.user
  });
});

module.exports = router;
