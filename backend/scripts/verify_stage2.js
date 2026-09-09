const http = require('http');
const { server } = require('../server');
const db = require('../database/db');
const { calculateHaversineDistance } = require('../utils/geo');
const { calculateSOSPriority } = require('../utils/priority');

const TEST_PORT = 5098;

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch(e) {
          resolve({ status: res.statusCode, data: body });
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

async function runStage2Tests() {
  console.log('\n====================================================');
  console.log('🧪 DisasterGuard Stage 2: Core Domain APIs & Operational Verification');
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

  try {
    // ----------------------------------------------------
    // 1. UNIT TEST: Priority Calculation
    // ----------------------------------------------------
    console.log('--- Test 1: Deterministic Server Priority Calculation ---');
    const prioCritical = calculateSOSPriority({ emergencyType: 'Medical Emergency', medical: true, peopleCount: 5 });
    assert(prioCritical === 'CRITICAL', `High-urgency Medical + 5 people returns CRITICAL (got ${prioCritical})`);

    const prioModerate = calculateSOSPriority({ emergencyType: 'Flood', medical: false, peopleCount: 2 });
    assert(prioModerate === 'MODERATE', `Flood with 2 people and no medical returns MODERATE (got ${prioModerate})`);

    const prioLow = calculateSOSPriority({ emergencyType: 'Other', medical: false, peopleCount: 1 });
    assert(prioLow === 'LOW', `Minor emergency with 1 person returns LOW (got ${prioLow})`);

    // ----------------------------------------------------
    // 2. UNIT TEST: Haversine Distance Calculation
    // ----------------------------------------------------
    console.log('\n--- Test 2: Haversine Distance Formula ---');
    // Velachery (12.9760, 80.2140) to Pallikaranai (12.9580, 80.2100) is approx ~2.05 km
    const dist = calculateHaversineDistance(12.9760, 80.2140, 12.9580, 80.2100);
    assert(dist > 1.8 && dist < 2.3, `Haversine distance between Velachery & Pallikaranai is ~2.0 km (calculated ${dist} km)`);

    // ----------------------------------------------------
    // 3. API TEST: Citizen SOS Creation
    // ----------------------------------------------------
    console.log('\n--- Test 3: Citizen SOS Creation with Automatic Headcount Records ---');
    const sosRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/sos',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      citizen_email: 'citizen01@disasterguard.com',
      citizen_name: 'Citizen One',
      emergency_type: 'Flood',
      people_count: 4,
      medical: true,
      description: 'Water entering ground floor; 1 injured.',
      location_name: 'Velachery Bypass Road',
      latitude: 12.9762,
      longitude: 80.2215
    });

    assert(sosRes.status === 201, `POST /api/sos returned 201 Created (received ${sosRes.status})`);
    assert(sosRes.data.sos && sosRes.data.sos.priority === 'CRITICAL', `Server calculated priority is CRITICAL (Flood 30 + Medical 35 + 4 people 15 = 80 pts)`);
    assert(Array.isArray(sosRes.data.sos.persons) && sosRes.data.sos.persons.length === 4, `Headcount initialized exactly 4 person records`);
    assert(sosRes.data.sos.persons[0].condition === 'Needs Medical Attention', `Person 1 marked 'Needs Medical Attention' based on medical=true`);
    assert(sosRes.data.sos.persons[1].condition === 'Missing / Unaccounted', `Person 2 initially marked 'Missing / Unaccounted'`);

    const createdSOSId = sosRes.data.sos.id;

    // ----------------------------------------------------
    // 4. API TEST: Haversine Nearest Shelter Query
    // ----------------------------------------------------
    console.log('\n--- Test 4: Nearest Shelters with Haversine Distance & Capacity Sorting ---');
    const sheltersRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/shelters/nearest?lat=12.9762&lng=80.2215',
      method: 'GET'
    });

    assert(sheltersRes.status === 200, `GET /api/shelters/nearest returned 200 OK`);
    assert(Array.isArray(sheltersRes.data.shelters) && sheltersRes.data.shelters.length > 0, `Returned active shelters list`);
    assert(sheltersRes.data.shelters[0].distance_km <= sheltersRes.data.shelters[1].distance_km, `Shelters are sorted strictly by distance ascending`);
    assert(sheltersRes.data.shelters[0].available_beds > 0, `Shelter has verified available beds`);

    // ----------------------------------------------------
    // 5. API TEST: Atomic Mission Assignment
    // ----------------------------------------------------
    console.log('\n--- Test 5: Atomic Mission Assignment & Double-Assignment Prevention ---');
    // Assign RT-2026-0001 (Available) to createdSOSId
    const assignRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/missions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      sos_id: createdSOSId,
      team_id: 'RT-2026-0001'
    });

    assert(assignRes.status === 201, `Mission assigned successfully (201 Created)`);
    assert(assignRes.data.mission.status === 'ASSIGNED', `Mission status is 'ASSIGNED'`);

    const missionId = assignRes.data.mission.id;

    // Verify database state: SOS status must be ASSIGNED, team status must be ON_MISSION
    const sosDb = db.prepare('SELECT status, assigned_team_id FROM sos_requests WHERE id = ?').get(createdSOSId);
    assert(sosDb.status === 'ASSIGNED' && sosDb.assigned_team_id === 'RT-2026-0001', `Linked SOS status is now 'ASSIGNED' with team RT-2026-0001`);

    const teamDb = db.prepare('SELECT status FROM rescue_teams WHERE id = ?').get('RT-2026-0001');
    assert(teamDb.status === 'ON_MISSION', `Rescue team status updated to 'ON_MISSION'`);

    // REJECT DOUBLE ASSIGNMENT: Try assigning another team to the already assigned SOS
    const doubleSosRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/missions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      sos_id: createdSOSId,
      team_id: 'RT-2026-0002'
    });
    assert(doubleSosRes.status === 409, `Double-assigning already assigned SOS rejected with 409 Conflict (received ${doubleSosRes.status})`);

    // REJECT BUSY TEAM: Try assigning the occupied team RT-2026-0001 to a new SOS
    const newSos = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/sos',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      citizen_email: 'citizen02@disasterguard.com',
      citizen_name: 'Citizen Two',
      emergency_type: 'Flood',
      location_name: 'Perungudi',
      latitude: 12.9660,
      longitude: 80.2450
    });
    const busyTeamRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/missions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      sos_id: newSos.data.sos.id,
      team_id: 'RT-2026-0001'
    });
    assert(busyTeamRes.status === 409, `Assigning ON_MISSION team rejected with 409 Conflict (received ${busyTeamRes.status})`);

    // ----------------------------------------------------
    // 6. API TEST: Mission Progression State Machine
    // ----------------------------------------------------
    console.log('\n--- Test 6: Strict Mission Progression State Machine ---');

    // Attempt illegal jump from ASSIGNED directly to COMPLETED -> expect 400
    const illegalJump = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/missions/${missionId}/advance`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    }, { status: 'COMPLETED' });
    assert(illegalJump.status === 400, `Illegal jump from ASSIGNED -> COMPLETED rejected with 400 Bad Request`);

    // Advance ASSIGNED -> DISPATCHED
    const advDispatched = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/missions/${missionId}/advance`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    }, { status: 'DISPATCHED' });
    assert(advDispatched.status === 200 && advDispatched.data.mission.status === 'DISPATCHED', `Advanced to DISPATCHED`);

    // Advance DISPATCHED -> ON_SCENE
    const advOnScene = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/missions/${missionId}/advance`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    }, { status: 'ON_SCENE' });
    assert(advOnScene.status === 200 && advOnScene.data.mission.status === 'ON_SCENE', `Advanced to ON_SCENE`);

    // Advance ON_SCENE -> RESCUED
    const advRescued = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/missions/${missionId}/advance`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    }, { status: 'RESCUED' });
    assert(advRescued.status === 200 && advRescued.data.mission.status === 'RESCUED', `Advanced to RESCUED`);

    // Attempt to COMPLETE while persons are still 'Missing / Unaccounted' -> expect 400
    const blockComplete = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/missions/${missionId}/advance`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    }, { status: 'COMPLETED' });
    assert(blockComplete.status === 400, `Completion blocked because persons remain 'Missing / Unaccounted'`);

    // Update person conditions so all 4 are accounted for
    const updatePersons = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/missions/${missionId}/persons`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, {
      person_statuses: ['Safe', 'Safe', 'Injured', 'Safe']
    });
    assert(updatePersons.status === 200, `Updated condition of all 4 persons to accounted statuses`);

    // Now re-attempt COMPLETE -> expect 200 OK
    const completeOk = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/missions/${missionId}/advance`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    }, { status: 'COMPLETED' });
    assert(completeOk.status === 200 && completeOk.data.mission.status === 'COMPLETED', `Mission successfully completed after all persons accounted for`);

    // Verify team is now automatically freed back to AVAILABLE
    const teamFreed = db.prepare('SELECT status FROM rescue_teams WHERE id = ?').get('RT-2026-0001');
    assert(teamFreed.status === 'AVAILABLE', `Rescue team automatically returned to 'AVAILABLE' status upon mission completion`);

    // ----------------------------------------------------
    // 7. API TEST: Incidents Lifecycle
    // ----------------------------------------------------
    console.log('\n--- Test 7: Incident Management Lifecycle ---');
    const incRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/incidents',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      citizen_email: 'citizen01@disasterguard.com',
      citizen_name: 'Citizen One',
      type: 'Road Blockage',
      description: 'Fallen tree blocking ambulance route on 100ft road.',
      location_name: 'Velachery 100ft Road',
      latitude: 12.9780,
      longitude: 80.2190,
      severity: 'High'
    });

    assert(incRes.status === 201, `Incident report created (201 Created)`);
    const incId = incRes.data.incident.id;

    // Command centre updates status to WORKING
    const incUpdate = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/incidents/${incId}`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    }, { status: 'WORKING' });
    assert(incUpdate.status === 200 && incUpdate.data.incident.status === 'WORKING', `Incident updated to 'WORKING'`);

    // ----------------------------------------------------
    // 8. API TEST: Citizen Supply Requests
    // ----------------------------------------------------
    console.log('\n--- Test 8: Citizen Supply Requests Lifecycle ---');
    const supRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/supply-requests',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      citizen_email: 'citizen01@disasterguard.com',
      citizen_name: 'Citizen One',
      type: 'Food & Water',
      details: 'Baby food and drinking water for 3 adults',
      people_count: 4,
      urgency: 'High',
      location_name: 'Velachery West'
    });
    assert(supRes.status === 201, `Supply request submitted (201 Created)`);
    const supId = supRes.data.supply_request.id;

    const supUpdate = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/supply-requests/${supId}`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    }, { status: 'APPROVED' });
    assert(supUpdate.status === 200 && supUpdate.data.supply_request.status === 'APPROVED', `Supply request advanced to 'APPROVED'`);

    // ----------------------------------------------------
    // 9. API TEST: Atomic Resource Allocation & Negative Stock Prevention
    // ----------------------------------------------------
    console.log('\n--- Test 9: Atomic Resource Allocation & Stock Protection ---');
    // Team requests 4 Rescue Boats
    const reqResource = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/resources/requests',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      team_id: 'RT-2026-0002',
      resource_name: 'Rescue Boats',
      quantity: 4,
      description: 'Flooding in Perungudi sector'
    });
    assert(reqResource.status === 201, `Team resource request created for 4 Rescue Boats`);
    const reqResId = reqResource.data.resource_request.id;

    // Check available boats before
    const boatsBefore = db.prepare("SELECT available FROM resources WHERE name = 'Rescue Boats'").get().available;

    // Command Centre allocates stock
    const allocRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/resources/requests/${reqResId}/allocate`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    }, { allocate_quantity: 4 });
    assert(allocRes.status === 200, `Stock allocated successfully`);

    // Verify available boats decreased by exactly 4
    const boatsAfter = db.prepare("SELECT available FROM resources WHERE name = 'Rescue Boats'").get().available;
    assert(boatsAfter === boatsBefore - 4, `Warehouse stock decreased from ${boatsBefore} to ${boatsAfter}`);

    // Test Negative Stock Prevention: request 9999 boats and try to allocate
    const greedyReq = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/resources/requests',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      team_id: 'RT-2026-0002',
      resource_name: 'Rescue Boats',
      quantity: 9999,
      description: 'Excessive request'
    });
    const greedyAlloc = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/resources/requests/${greedyReq.data.resource_request.id}/allocate`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    }, { allocate_quantity: 9999 });
    assert(greedyAlloc.status === 409, `Over-allocation rejected with 409 Conflict to prevent negative warehouse stock`);

    // ----------------------------------------------------
    // 10. API TEST: Unified Citizen History Aggregation
    // ----------------------------------------------------
    console.log('\n--- Test 10: Unified Citizen History Aggregation ---');
    const histRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/citizen/history?email=citizen01@disasterguard.com',
      method: 'GET'
    });

    assert(histRes.status === 200, `GET /api/citizen/history returned 200 OK`);
    assert(histRes.data.total_entries >= 3, `History contains aggregated records (SOS, Incident, and Supply)`);
    const types = histRes.data.history.map(h => h.entry_type);
    assert(types.includes('SOS') && types.includes('Incident') && types.includes('Supply'), `History contains all three entry types: SOS, Incident, and Supply`);

  } catch (err) {
    console.error('Stage 2 Test exception:', err);
    allPassed = false;
  } finally {
    server.close();
  }

  console.log('\n====================================================');
  console.log(`Summary: ${passedCount}/${totalCount} tests passed.`);
  if (allPassed) {
    console.log('🎉 ALL STAGE 2 DOMAIN & OPERATIONAL TESTS PASSED!');
  } else {
    console.log('⚠️ SOME TESTS FAILED. Please review above.');
    process.exit(1);
  }
  console.log('====================================================\n');
}

runStage2Tests();
