const http = require('http');
const io = require('socket.io-client');
const { server } = require('../server');
const db = require('../database/db');

const TEST_PORT = 5099;
const SERVER_URL = `http://localhost:${TEST_PORT}`;

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data: body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runStage4Tests() {
  console.log('\n====================================================');
  console.log('🧪 DisasterGuard Stage 4: Full End-to-End Integration & Real-Time Verification');
  console.log('====================================================\n');

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));

  let allPassed = true;
  let passedCount = 0;
  let totalCount = 0;

  function assert(condition, message) {
    totalCount++;
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passedCount++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      allPassed = false;
    }
  }

  let citizenSocket, rescueSocket, commandSocket;

  try {
    // ============================================================
    // 4A: AUTHENTICATION & ROLE-BASED ACCESS CONTROL
    // ============================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SECTION 4A: Authentication & RBAC Verification');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 1. Citizen Login
    const citLogin = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { role: 'citizen', id: 'citizen01@disasterguard.com', password: 'Citi@2026One' });

    assert(citLogin.status === 200, 'Citizen login successful (200 OK)');
    assert(citLogin.data.token && citLogin.data.user.role === 'citizen', 'Citizen token and role verified');
    const citizenToken = citLogin.data.token;

    // 2. Rescue Login
    const resLogin = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { role: 'rescue', id: 'RT-2026-0001', password: 'RT@2026-0001' });

    assert(resLogin.status === 200, 'Rescue team login successful (200 OK)');
    assert(resLogin.data.token && resLogin.data.user.role === 'rescue', 'Rescue token and role verified');
    const rescueToken = resLogin.data.token;

    // 3. Command Login
    const cmdLogin = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { role: 'command', id: 'CC-2026-0001', password: 'CC-2026-0001' });

    assert(cmdLogin.status === 200, 'Command Centre login successful (200 OK)');
    assert(cmdLogin.data.token && cmdLogin.data.user.role === 'command', 'Command token and role verified');
    const commandToken = cmdLogin.data.token;

    // 4. Registration API: Register new citizen
    const newCitEmail = `citizen_test_${Date.now()}@disasterguard.com`;
    const citRegister = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      name: 'Test Citizen User',
      email: newCitEmail,
      phone: '9876543210',
      password: 'Password@2026',
      role: 'citizen'
    });

    assert(citRegister.status === 201, 'New citizen registered successfully (201 Created)');
    assert(citRegister.data.token && citRegister.data.user.identifier === newCitEmail, 'New citizen returned JWT and profile');

    // 5. Registration API: Register new rescue team
    const newTeamEmail = `rescueteam_${Date.now()}@disasterguard.com`;
    const resRegister = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      name: 'North Flood Squad',
      email: newTeamEmail,
      phone: '9876543211',
      password: 'Password@2026',
      role: 'rescue',
      department: 'Flood Response',
      members: 6
    });

    assert(resRegister.status === 201, 'New rescue team registered successfully (201 Created)');
    assert(resRegister.data.token && resRegister.data.team && resRegister.data.team.id.startsWith('RT-'), 'Rescue team provisioned in database with canonical ID');

    // ============================================================
    // 4E: SOCKET.IO CLIENT CONNECTIONS & ROOM JOINING
    // ============================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SECTION 4E: Socket.IO Real-Time Client Connections');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    citizenSocket = io(SERVER_URL);
    rescueSocket = io(SERVER_URL);
    commandSocket = io(SERVER_URL);

    await Promise.all([
      new Promise(res => citizenSocket.on('connect', res)),
      new Promise(res => rescueSocket.on('connect', res)),
      new Promise(res => commandSocket.on('connect', res))
    ]);

    citizenSocket.emit('join_role', 'citizen');
    rescueSocket.emit('join_role', 'rescue');
    commandSocket.emit('join_role', 'command');

    await wait(200);
    assert(citizenSocket.connected && rescueSocket.connected && commandSocket.connected, 'Citizen, Rescue, and Command sockets connected and joined rooms');

    // Setup event collectors
    const commandReceivedEvents = [];
    const rescueReceivedEvents = [];
    const citizenReceivedEvents = [];

    commandSocket.on('NEW_SOS', data => commandReceivedEvents.push({ event: 'NEW_SOS', data }));
    commandSocket.on('MISSION_STATUS_UPDATED', data => commandReceivedEvents.push({ event: 'MISSION_STATUS_UPDATED', data }));
    commandSocket.on('TEAM_LOCATION_UPDATED', data => commandReceivedEvents.push({ event: 'TEAM_LOCATION_UPDATED', data }));
    commandSocket.on('NEW_INCIDENT', data => commandReceivedEvents.push({ event: 'NEW_INCIDENT', data }));
    commandSocket.on('NEW_RESOURCE_REQUEST', data => commandReceivedEvents.push({ event: 'NEW_RESOURCE_REQUEST', data }));
    commandSocket.on('RISK_PUBLISHED', data => commandReceivedEvents.push({ event: 'RISK_PUBLISHED', data }));

    rescueSocket.on('MISSION_ASSIGNED', data => rescueReceivedEvents.push({ event: 'MISSION_ASSIGNED', data }));
    rescueSocket.on('NEW_EMERGENCY_ALERT', data => rescueReceivedEvents.push({ event: 'NEW_EMERGENCY_ALERT', data }));

    citizenSocket.on('NEW_EMERGENCY_ALERT', data => citizenReceivedEvents.push({ event: 'NEW_EMERGENCY_ALERT', data }));
    citizenSocket.on('RISK_PUBLISHED', data => citizenReceivedEvents.push({ event: 'RISK_PUBLISHED', data }));

    // ============================================================
    // 4B: CITIZEN PORTAL INTEGRATION
    // ============================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SECTION 4B: Citizen Portal Domain Integration');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 1. Citizen Creates SOS
    const sosPayload = {
      citizen_name: 'Anand Kumar',
      citizen_email: 'citizen01@disasterguard.com',
      emergency_type: 'Flood',
      medical: true,
      people_count: 4,
      latitude: 12.9780,
      longitude: 80.2180,
      location_name: '14, 5th Cross Street, Velachery, Chennai'
    };

    const sosRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/sos',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${citizenToken}` }
    }, sosPayload);

    assert(sosRes.status === 201, 'Citizen submitted SOS (201 Created)');
    assert(sosRes.data.sos && sosRes.data.sos.id.startsWith('SOS-'), 'SOS created with canonical SOS ID');
    assert(sosRes.data.sos.priority === 'CRITICAL', 'Deterministic priority correctly calculated as CRITICAL');
    assert(sosRes.data.headcount && sosRes.data.headcount.length === 4, '4 individual headcount records auto-created');
    const createdSOSId = sosRes.data.sos.id;

    // Verify Realtime event NEW_SOS reached Command Centre
    await wait(300);
    const hasNewSosEvent = commandReceivedEvents.some(e => e.event === 'NEW_SOS' && e.data.id === createdSOSId);
    assert(hasNewSosEvent, 'Command Centre received real-time NEW_SOS Socket.IO event');

    // 2. Citizen Reports Incident
    const incPayload = {
      type: 'Flooded Road & Grid Failure',
      severity: 'HIGH',
      location: 'Velachery Main Road, Chennai',
      description: 'Water level reached 3 feet, transformers sparked, road completely blocked',
      latitude: 12.9790,
      longitude: 80.2200,
      name: 'Anand Kumar',
      phone: '9840123456',
      email: 'citizen01@disasterguard.com'
    };

    const incRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/incidents',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${citizenToken}` }
    }, incPayload);

    assert(incRes.status === 201, 'Citizen submitted Incident report (201 Created)');
    assert(incRes.data.incident && incRes.data.incident.id.startsWith('INC-'), 'Incident created with canonical INC ID');
    const createdIncId = incRes.data.incident.id;

    // Verify Realtime event NEW_INCIDENT reached Command Centre
    await wait(300);
    const hasNewIncEvent = commandReceivedEvents.some(e => e.event === 'NEW_INCIDENT' && e.data.id === createdIncId);
    assert(hasNewIncEvent, 'Command Centre received real-time NEW_INCIDENT Socket.IO event');

    // 3. Citizen Requests Supplies
    const supPayload = {
      name: 'Anand Kumar',
      phone: '9840123456',
      email: 'citizen01@disasterguard.com',
      itemType: 'Water & Food Packets',
      quantity: 5,
      deliveryAddress: '14, 5th Cross Street, Velachery, Chennai',
      latitude: 12.9780,
      longitude: 80.2180,
      notes: 'Family stranded on first floor'
    };

    const supRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/supply-requests',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${citizenToken}` }
    }, supPayload);

    assert(supRes.status === 201, 'Citizen submitted Supply request (201 Created)');
    assert(supRes.data.supply_request && (supRes.data.supply_request.id.startsWith('SR-') || supRes.data.supply_request.id.startsWith('SUP-')), 'Supply request created with canonical SR/SUP ID');

    // 4. Citizen Unified History Aggregation
    const citHist = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/citizen/history?email=citizen01@disasterguard.com',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${citizenToken}` }
    });

    assert(citHist.status === 200, 'Citizen fetched aggregated history (200 OK)');
    assert(citHist.data.history.some(h => h.id === createdSOSId), 'History includes the created SOS request');
    assert(citHist.data.history.some(h => h.id === createdIncId), 'History includes the created Incident report');

    // 5. Nearest Shelters API with Distance Calculation
    const sheltersRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/shelters/nearest?lat=12.9780&lng=80.2180',
      method: 'GET'
    });

    assert(sheltersRes.status === 200, 'Fetched nearest shelters (200 OK)');
    assert(sheltersRes.data.shelters && sheltersRes.data.shelters.length > 0, 'Returned shelter list');
    assert(sheltersRes.data.shelters[0].distance_km !== undefined, 'Calculated and included distance_km');

    // ============================================================
    // 4D & 4C: COMMAND MISSION ASSIGNMENT & RESCUE LIFECYCLE
    // ============================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SECTION 4C & 4D: Command Assignment & Rescue Mission Lifecycle');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Reset team RT-2026-0001 to AVAILABLE if currently on a mission from previous tests
    db.prepare("UPDATE rescue_teams SET status = 'AVAILABLE' WHERE id = 'RT-2026-0001'").run();

    // 1. Command assigns rescue team to SOS
    const assignRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/missions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${commandToken}` }
    }, { sos_id: createdSOSId, team_id: 'RT-2026-0001' });

    assert(assignRes.status === 201, 'Command assigned rescue team RT-2026-0001 (201 Created)');
    assert(assignRes.data.mission.status === 'ASSIGNED', 'Mission status is ASSIGNED');
    const createdMissionId = assignRes.data.mission.id;

    // Verify Realtime event MISSION_ASSIGNED reached Rescue Team
    await wait(300);
    const hasMissionAssignedEvent = rescueReceivedEvents.some(e => e.event === 'MISSION_ASSIGNED' && (e.data.id === createdMissionId || e.data.mission?.id === createdMissionId));
    assert(hasMissionAssignedEvent, 'Rescue Team received real-time MISSION_ASSIGNED Socket.IO event');

    // 2. Double assignment prevention
    const doubleAssign = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/missions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${commandToken}` }
    }, { sos_id: createdSOSId, team_id: 'RT-2026-0002' });

    assert(doubleAssign.status === 409, 'Double mission assignment rejected with 409 Conflict');

    // 3. Rescue advances mission: ASSIGNED -> DISPATCHED
    const stepDispatched = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/missions/${createdMissionId}/status`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rescueToken}` }
    }, { status: 'DISPATCHED' });

    assert(stepDispatched.status === 200 && stepDispatched.data.mission.status === 'DISPATCHED', 'Mission advanced to DISPATCHED');

    // 4. Rescue advances mission: DISPATCHED -> ON_SCENE
    const stepOnScene = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/missions/${createdMissionId}/status`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rescueToken}` }
    }, { status: 'ON_SCENE' });

    assert(stepOnScene.status === 200 && stepOnScene.data.mission.status === 'ON_SCENE', 'Mission advanced to ON_SCENE');

    // 5. Rescue advances mission: ON_SCENE -> RESCUED
    const stepRescued = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/missions/${createdMissionId}/status`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rescueToken}` }
    }, { status: 'RESCUED' });

    assert(stepRescued.status === 200 && stepRescued.data.mission.status === 'RESCUED', 'Mission advanced to RESCUED');

    // 6. Complete mission attempt before accounting for all persons -> Should FAIL (400)
    const prematureComplete = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/missions/${createdMissionId}/status`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rescueToken}` }
    }, { status: 'COMPLETED' });

    assert(prematureComplete.status === 400, 'Mission completion blocked when persons remain unaccounted (400 Bad Request)');

    // 7. Update all 4 headcount records to accounted statuses via PUT /api/missions/:id/persons
    const personUpdate = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/missions/${createdMissionId}/persons`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rescueToken}` }
    }, { person_statuses: ['Safe', 'Safe', 'Safe', 'Safe'] });

    assert(personUpdate.status === 200, 'Updated conditions for all persons to Safe (200 OK)');

    // 8. Complete mission after 100% headcount accounting
    const validComplete = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/missions/${createdMissionId}/status`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rescueToken}` }
    }, { status: 'COMPLETED' });

    assert(validComplete.status === 200 && validComplete.data.mission.status === 'COMPLETED', 'Mission successfully COMPLETED after 100% headcount accounting');

    // Verify team automatically returned to AVAILABLE
    const teamRecord = db.prepare('SELECT status FROM rescue_teams WHERE id = ?').get('RT-2026-0001');
    assert(teamRecord.status === 'AVAILABLE', 'Rescue team automatically reset to AVAILABLE status upon mission completion');

    // 9. Rescue team updates real-time GPS location
    const locUpdate = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/rescue-teams/RT-2026-0001/location',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rescueToken}` }
    }, { latitude: 12.9805, longitude: 80.2195 });

    assert(locUpdate.status === 200, 'Rescue team updated GPS coordinates (200 OK)');
    await wait(300);
    const hasLocationEvent = commandReceivedEvents.some(e => e.event === 'TEAM_LOCATION_UPDATED' && e.data.team_id === 'RT-2026-0001');
    assert(hasLocationEvent, 'Command Centre received real-time TEAM_LOCATION_UPDATED Socket.IO event');

    // ============================================================
    // 4D: RESOURCE ALLOCATION & WAREHOUSE STOCK
    // ============================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SECTION 4D: Resource Requests & Warehouse Allocation');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 1. Team creates resource request
    const resReq = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/resources/requests',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rescueToken}` }
    }, {
      team_id: 'RT-2026-0001',
      resource_name: 'Rescue Boats',
      quantity: 2,
      description: 'Required for low-lying zone extraction'
    });

    assert(resReq.status === 201, 'Rescue team created resource request (201 Created)');
    const reqId = resReq.data.resource_request.id;

    // 2. Command allocates warehouse stock
    const beforeStock = db.prepare("SELECT available FROM resources WHERE name = 'Rescue Boats'").get();
    const allocRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/resources/requests/${reqId}/allocate`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${commandToken}` }
    }, { allocate_quantity: 2 });

    const afterStock = db.prepare("SELECT available FROM resources WHERE name = 'Rescue Boats'").get();
    assert(allocRes.status === 200, 'Command allocated 2 Rescue Boats to request (200 OK)');
    assert(beforeStock.available - afterStock.available === 2, 'Warehouse stock atomic decrement verified');

    // ============================================================
    // 4D: DETERMINISTIC RISK ENGINE & DECOUPLING GUARANTEE
    // ============================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SECTION 4D: AI Risk Prediction & Decoupling from Emergency Broadcasts');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 1. Run deterministic risk prediction
    const riskPredict = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/risk/predict',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${commandToken}` }
    }, {
      rainfall_mm: 260,
      river_level_pct: 85,
      soil_moisture_pct: 90,
      drainage_capacity_pct: 30,
      historical_index: 80
    });

    const pred = riskPredict.data.prediction || riskPredict.data;
    assert(pred.overallScore >= 70 && pred.riskLevel === 'CRITICAL', 'Severe flood parameters calculated as CRITICAL');

    // 2. Count emergency alerts before publishing risk
    const alertsBefore = db.prepare('SELECT COUNT(*) as count FROM emergency_alerts').get().count;

    // 3. Publish risk assessment
    const riskPublish = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/risk/publish',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${commandToken}` }
    }, {
      rainfall_mm: 260,
      river_level_pct: 85,
      soil_moisture_pct: 90,
      drainage_capacity_pct: 30,
      historical_index: 80
    });

    assert(riskPublish.status === 201, 'Risk assessment published to database (201 Created)');

    // 4. Decoupling Check: Ensure NO emergency alert was created
    const alertsAfter = db.prepare('SELECT COUNT(*) as count FROM emergency_alerts').get().count;
    assert(alertsBefore === alertsAfter, 'STRICT DECOUPLING: Publishing risk did NOT automatically create any emergency broadcast alert');

    // 5. Verify Real-time RISK_PUBLISHED event received by citizen and command
    await wait(300);
    const citRiskEvent = citizenReceivedEvents.some(e => e.event === 'RISK_PUBLISHED');
    const cmdRiskEvent = commandReceivedEvents.some(e => e.event === 'RISK_PUBLISHED');
    assert(citRiskEvent && cmdRiskEvent, 'Citizen and Command portals received real-time RISK_PUBLISHED Socket.IO event');

    // ============================================================
    // 4D: EMERGENCY BROADCAST ALERTS
    // ============================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SECTION 4D: Manual Emergency Alert Broadcast Lifecycle');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 1. Command publishes CITIZENS alert
    const alertPub = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/alerts',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${commandToken}` }
    }, {
      title: 'EVACUATION NOTICE: Velachery Sector 4',
      message: 'Water level rising rapidly. Move to nearest designated shelter immediately.',
      severity: 'CRITICAL',
      alert_type: 'EVACUATION',
      target_audience: 'CITIZENS',
      affected_areas: 'Velachery, Pallikaranai',
      recommended_action: 'Proceed on foot or emergency transport to Velachery Higher Secondary School Shelter.'
    });

    assert(alertPub.status === 201, 'Command published emergency alert (201 Created)');
    const createdAlertId = alertPub.data.alert.id;

    // Verify Realtime event NEW_EMERGENCY_ALERT received by Citizen
    await wait(300);
    const citAlertEvent = citizenReceivedEvents.some(e => e.event === 'NEW_EMERGENCY_ALERT' && e.data.id === createdAlertId);
    assert(citAlertEvent, 'Citizen portal received real-time NEW_EMERGENCY_ALERT Socket.IO event');

    // 2. Fetch Active Alerts for Citizens
    const activeCitAlerts = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/alerts/active?audience=CITIZENS',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${citizenToken}` }
    });

    assert(activeCitAlerts.status === 200, 'Fetched active alerts for Citizens (200 OK)');
    assert(activeCitAlerts.data.alerts.some(a => a.id === createdAlertId), 'Active alerts include the published emergency notice');

    // 3. Deactivate Alert
    const deactRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/alerts/${createdAlertId}/deactivate`,
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${commandToken}` }
    });

    assert(deactRes.status === 200, 'Command deactivated emergency alert (200 OK)');

    // Verify deactivated alert is no longer in active alerts
    const activeAfter = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/alerts/active?audience=CITIZENS',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${citizenToken}` }
    });
    assert(!activeAfter.data.alerts.some(a => a.id === createdAlertId), 'Deactivated alert is excluded from active alerts list');

  } catch (err) {
    console.error('Stage 4 Test exception:', err);
    allPassed = false;
  } finally {
    if (citizenSocket) citizenSocket.disconnect();
    if (rescueSocket) rescueSocket.disconnect();
    if (commandSocket) commandSocket.disconnect();
    server.close();
  }

  console.log('\n====================================================');
  console.log(`Summary: ${passedCount}/${totalCount} Stage 4 tests passed.`);
  if (allPassed) {
    console.log('🎉 ALL STAGE 4 END-TO-END INTEGRATION TESTS PASSED!');
  } else {
    console.log('⚠️ SOME STAGE 4 TESTS FAILED. Please review above.');
    process.exit(1);
  }
  console.log('====================================================\n');
}

runStage4Tests();
