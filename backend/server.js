const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const db = require('./database/db');
const seedDatabase = require('./database/seed');

const authRoutes = require('./routes/auth');
const sosRoutes = require('./routes/sos');
const missionsRoutes = require('./routes/missions');
const sheltersRoutes = require('./routes/shelters');
const incidentsRoutes = require('./routes/incidents');
const suppliesRoutes = require('./routes/supplies');
const teamsRoutes = require('./routes/teams');
const resourcesRoutes = require('./routes/resources');
const citizenRoutes = require('./routes/citizen');
const alertsRoutes = require('./routes/alerts');
const riskRoutes = require('./routes/risk');


// Ensure database has initial seed data
seedDatabase();

const app = express();
const server = http.createServer(app);

// Socket.IO configuration
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']
  }
});

// Provide io instance to request handlers
app.set('io', io);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files from the project root
app.use(express.static(path.join(__dirname, '..')));

// Socket.IO Connection Handler
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);

  // Allow clients to join role-specific rooms
  socket.on('join_role', (role) => {
    if (['citizen', 'rescue', 'command'].includes(role)) {
      socket.join(`room_${role}`);
      console.log(`[Socket.IO] Client ${socket.id} joined room_${role}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/sos', sosRoutes);
app.use('/api/missions', missionsRoutes);
app.use('/api/shelters', sheltersRoutes);
app.use('/api/incidents', incidentsRoutes);
app.use('/api/supply-requests', suppliesRoutes);
app.use('/api/rescue-teams', teamsRoutes);
app.use('/api/resources', resourcesRoutes);
app.use('/api/resource-requests', resourcesRoutes);
app.use('/api/citizen', citizenRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/risk', riskRoutes);


// Health Check Endpoint
app.get('/api/health', (req, res) => {
  try {
    const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    const seededUserCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE identifier IN ('citizen01@disasterguard.com', 'citizen02@disasterguard.com', 'RT-2026-0001', 'RT-2026-0002', 'RT-2026-0003', 'RT-2026-0004', 'CC-2026-0001', 'CC-2026-0002')").get().count;
    const sosCount = db.prepare('SELECT COUNT(*) AS count FROM sos_requests').get().count;
    const missionCount = db.prepare('SELECT COUNT(*) AS count FROM missions').get().count;
    const shelterCount = db.prepare('SELECT COUNT(*) AS count FROM shelters').get().count;

    res.status(200).json({
      status: 'healthy',
      system: 'DisasterGuard SIH 2026 Backend',
      timestamp: new Date().toISOString(),
      database: 'connected',
      seededUsers: seededUserCount,
      metrics: {
        users: userCount,
        seededUsers: seededUserCount,
        sos_requests: sosCount,
        missions: missionCount,
        shelters: shelterCount
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

// Default 404 handler for unknown API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🛡️  DisasterGuard Backend Server is Running!`);
    console.log(`📍 Port: http://localhost:${PORT}`);
    console.log(`📁 Database: SQLite at ${process.env.DB_PATH || './data/disasterguard.db'}`);
    console.log(`⚡ Real-Time: Socket.IO initialized`);
    console.log(`====================================================`);
  });
}

module.exports = { app, server, io };
