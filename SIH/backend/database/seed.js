const bcrypt = require('bcryptjs');
const db = require('./db');

function seedDatabase(options = {}) {
  const reset = options.reset || process.argv.includes('--reset');

  if (reset) {
    console.log('[Seed] Resetting database tables...');
    db.exec(`
      DELETE FROM emergency_alerts;
      DELETE FROM risk_predictions;
      DELETE FROM resource_requests;
      DELETE FROM resources;
      DELETE FROM supply_requests;
      DELETE FROM incident_reports;
      DELETE FROM sos_person_records;
      DELETE FROM missions;
      DELETE FROM sos_requests;
      DELETE FROM shelters;
      DELETE FROM rescue_teams;
      DELETE FROM users;
    `);
  }

  // Check if users already exist
  const existingUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (existingUsers.count > 0 && !reset) {
    console.log('[Seed] Database already seeded. Skipping initial seeding.');
    return;
  }

  console.log('[Seed] Seeding canonical DisasterGuard accounts, shelters, and resources...');

  const insertUser = db.prepare(`
    INSERT INTO users (id, identifier, password_hash, role, name, department)
    VALUES (@id, @identifier, @password_hash, @role, @name, @department)
  `);

  const insertTeam = db.prepare(`
    INSERT INTO rescue_teams (id, user_id, name, department, status, current_lat, current_lng, members)
    VALUES (@id, @user_id, @name, @department, @status, @current_lat, @current_lng, @members)
  `);

  const insertShelter = db.prepare(`
    INSERT INTO shelters (id, name, address, latitude, longitude, total_beds, available_beds, medical_support, status)
    VALUES (@id, @name, @address, @latitude, @longitude, @total_beds, @available_beds, @medical_support, @status)
  `);

  const insertResource = db.prepare(`
    INSERT INTO resources (id, name, available, total, unit)
    VALUES (@id, @name, @available, @total, @unit)
  `);

  const runSeed = db.transaction(() => {
    // 1. CITIZENS
    const citizenUsers = [
      {
        id: 'USR-CITI-01',
        identifier: 'citizen01@disasterguard.com',
        rawPassword: 'Citi@2026One',
        role: 'citizen',
        name: 'Citizen One',
        department: null
      },
      {
        id: 'USR-CITI-02',
        identifier: 'citizen02@disasterguard.com',
        rawPassword: 'Citi@2026Two',
        role: 'citizen',
        name: 'Citizen Two',
        department: null
      }
    ];

    for (const c of citizenUsers) {
      insertUser.run({
        id: c.id,
        identifier: c.identifier,
        password_hash: bcrypt.hashSync(c.rawPassword, 10),
        role: c.role,
        name: c.name,
        department: c.department
      });
    }

    // 2. RESCUE TEAMS (Canonical RT-2026-0001 to RT-2026-0004)
    const rescueUnits = [
      {
        id: 'RT-2026-0001',
        userId: 'USR-RT-01',
        rawPassword: 'RT@2026-0001',
        name: 'Flood Response Unit 1',
        department: 'Flood Response',
        lat: 12.9760,
        lng: 80.2210,
        members: 6
      },
      {
        id: 'RT-2026-0002',
        userId: 'USR-RT-02',
        rawPassword: 'RT@2026-0002',
        name: 'Rescue Unit 2',
        department: 'Rescue Unit',
        lat: 12.9860,
        lng: 80.1960,
        members: 5
      },
      {
        id: 'RT-2026-0003',
        userId: 'USR-RT-03',
        rawPassword: 'RT@2026-0003',
        name: 'Medical Support Unit 3',
        department: 'Medical Support',
        lat: 12.9640,
        lng: 80.2350,
        members: 5
      },
      {
        id: 'RT-2026-0004',
        userId: 'USR-RT-04',
        rawPassword: 'RT@2026-0004',
        name: 'Water Rescue Unit 4',
        department: 'Water Rescue',
        lat: 12.9680,
        lng: 80.2180,
        members: 4
      }
    ];

    for (const r of rescueUnits) {
      insertUser.run({
        id: r.userId,
        identifier: r.id,
        password_hash: bcrypt.hashSync(r.rawPassword, 10),
        role: 'rescue',
        name: r.name,
        department: r.department
      });

      insertTeam.run({
        id: r.id,
        user_id: r.userId,
        name: r.name,
        department: r.department,
        status: 'AVAILABLE',
        current_lat: r.lat,
        current_lng: r.lng,
        members: r.members
      });
    }

    // 3. COMMAND CENTRE USERS (CC-2026-0001, CC-2026-0002)
    const commandUsers = [
      {
        id: 'USR-CC-01',
        identifier: 'CC-2026-0001',
        rawPassword: 'CC-2026-0001',
        role: 'command',
        name: 'Control Center 1',
        department: 'Command Staff'
      },
      {
        id: 'USR-CC-02',
        identifier: 'CC-2026-0002',
        rawPassword: 'CC-2026-0002',
        role: 'command',
        name: 'Control Center 2',
        department: 'Command Staff'
      }
    ];

    for (const cc of commandUsers) {
      insertUser.run({
        id: cc.id,
        identifier: cc.identifier,
        password_hash: bcrypt.hashSync(cc.rawPassword, 10),
        role: cc.role,
        name: cc.name,
        department: cc.department
      });
    }

    // 4. SHELTERS
    const initialShelters = [
      { id: 'SH-01', name: 'Velachery Relief Centre', address: 'Velachery, Chennai', lat: 12.9760, lng: 80.2140, total: 60, beds: 55, medical: 'Available', status: 'Available' },
      { id: 'SH-02', name: 'Pallikaranai Community Shelter', address: 'Pallikaranai, Chennai', lat: 12.9580, lng: 80.2100, total: 50, beds: 25, medical: 'Available', status: 'Available' },
      { id: 'SH-03', name: 'Perungudi Community Shelter', address: 'Perungudi, Chennai', lat: 12.9665, lng: 80.2369, total: 40, beds: 25, medical: 'Available', status: 'Available' },
      { id: 'SH-04', name: 'Sholinganallur Relief Centre', address: 'Sholinganallur, Chennai', lat: 12.9070, lng: 80.2200, total: 35, beds: 20, medical: 'Available', status: 'Limited' },
      { id: 'SH-05', name: 'Tambaram Relief Shelter', address: 'Tambaram, Chennai', lat: 12.9305, lng: 80.1110, total: 50, beds: 40, medical: 'Not Available', status: 'Available' }
    ];

    for (const s of initialShelters) {
      insertShelter.run({
        id: s.id,
        name: s.name,
        address: s.address,
        latitude: s.lat,
        longitude: s.lng,
        total_beds: s.total,
        available_beds: s.beds,
        medical_support: s.medical,
        status: s.status
      });
    }

    // 5. RESOURCES
    const initialResources = [
      { id: 'RES-01', name: 'Food Packets', available: 2400, total: 3000, unit: 'units' },
      { id: 'RES-02', name: 'Drinking Water', available: 3200, total: 4000, unit: 'L' },
      { id: 'RES-03', name: 'Blankets', available: 860, total: 1200, unit: 'units' },
      { id: 'RES-04', name: 'Medicine Kits', available: 120, total: 160, unit: 'kits' },
      { id: 'RES-05', name: 'Rescue Boats', available: 14, total: 20, unit: 'units' },
      { id: 'RES-06', name: 'Emergency Kits', available: 95, total: 120, unit: 'kits' },
      { id: 'RES-07', name: 'Oxygen Cylinders', available: 60, total: 100, unit: 'units' },
      { id: 'RES-08', name: 'Fuel', available: 1080, total: 1500, unit: 'L' },
      { id: 'RES-09', name: 'Ambulances', available: 8, total: 12, unit: 'vehicles' }
    ];

    for (const r of initialResources) {
      insertResource.run({
        id: r.id,
        name: r.name,
        available: r.available,
        total: r.total,
        unit: r.unit
      });
    }
  });

  runSeed();
  console.log('[Seed] Seeding completed successfully.');
}

if (require.main === module) {
  seedDatabase();
}

module.exports = seedDatabase;
