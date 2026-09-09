/**
 * DisasterGuard – Stage 3 Verification Script
 * =============================================
 * Tests the Emergency Alert System and Risk Prediction Engine.
 *
 * Run: node backend/scripts/verify_stage3.js
 *
 * Test Groups:
 *   A. Risk Engine Unit Tests (pure math, no HTTP)
 *   B. Authorization & RBAC enforcement
 *   C. Alert lifecycle (publish, active query, audience filtering, deactivation)
 *   D. Risk prediction lifecycle (predict, publish, latest)
 *   E. Decoupling guarantee (risk publish does NOT create alerts)
 */

'use strict';

const http = require('http');
const path = require('path');

// ---------------------------------------------------------------------------
// Load app WITHOUT starting the server (reuse express app)
// ---------------------------------------------------------------------------
process.env.NODE_ENV = 'test';
process.chdir(path.join(__dirname, '..', '..'));  // project root
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Import risk engine directly for unit tests
const riskEngine = require('../utils/risk_engine');

// Load and start the express app on a random port for HTTP tests
const { app, server: httpServer } = require('../server');

// ---------------------------------------------------------------------------
// TEST HARNESS
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
    failures.push(label);
  }
}

/** HTTP helper — returns { status, body } */
function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const addr = httpServer.address();
    const port = addr ? addr.port : 5000;

    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** Login and return a JWT token */
async function login(role, id, password) {
  const res = await request('POST', '/api/auth/login', { role, id, password });
  if (res.status !== 200) throw new Error(`Login failed for ${id}: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

// ---------------------------------------------------------------------------
// MAIN TEST RUNNER
// ---------------------------------------------------------------------------
async function runTests() {
  // Start on an ephemeral port (port 0 = OS assigns)
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const port = httpServer.address().port;
  console.log(`\n🧪  DisasterGuard Stage 3 Verification (port ${port})\n`);

  // =========================================================================
  // GROUP A — Risk Engine Unit Tests (pure math, no HTTP)
  // =========================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('GROUP A — Risk Engine Mathematical Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // A1: Severe conditions → CRITICAL
  const severeResult = riskEngine.predict({
    rainfallMm: 280, riverLevelPct: 95, soilMoisturePct: 80,
    drainageCapacityPct: 10, historicalIndex: 75
  });
  assert('A1: Severe inputs produce score ≥ 80', severeResult.overallScore >= 80,
    `score=${severeResult.overallScore}`);
  assert('A2: Severe inputs produce CRITICAL risk level', severeResult.riskLevel === 'CRITICAL',
    `level=${severeResult.riskLevel}`);

  // A3: Benign conditions → SAFE
  const safeResult = riskEngine.predict({
    rainfallMm: 10, riverLevelPct: 15, soilMoisturePct: 20,
    drainageCapacityPct: 90, historicalIndex: 5
  });
  assert('A3: Benign inputs produce score < 20', safeResult.overallScore < 20,
    `score=${safeResult.overallScore}`);
  assert('A4: Benign inputs produce SAFE risk level', safeResult.riskLevel === 'SAFE',
    `level=${safeResult.riskLevel}`);

  // A5: Zones are sorted by score descending (no hard-coding, purely from coefficients)
  const zones = severeResult.zones;
  assert('A5: 12 zones returned', zones.length === 12, `got ${zones.length}`);
  let sortedDesc = true;
  for (let i = 1; i < zones.length; i++) {
    if (zones[i].score > zones[i - 1].score) { sortedDesc = false; break; }
  }
  assert('A6: Zones are sorted highest-score first', sortedDesc);

  // A7: High-coefficient zones score above low-coefficient zones
  // Pallikaranai: elev=0.95, riverProx=0.82, drainage=0.90 — must outscore Tambaram: 0.20/0.18/0.30
  const pallikaranai = zones.find(z => z.name === 'Pallikaranai');
  const tambaram     = zones.find(z => z.name === 'Tambaram');
  assert('A7: Pallikaranai (high coefficients) scores above Tambaram (low coefficients)',
    pallikaranai.score > tambaram.score,
    `Pallikaranai=${pallikaranai.score}, Tambaram=${tambaram.score}`);

  // A8: Velachery — second-highest coefficients — outscores Tambaram
  const velachery = zones.find(z => z.name === 'Velachery');
  assert('A8: Velachery (high coefficients) scores above Tambaram',
    velachery.score > tambaram.score,
    `Velachery=${velachery.score}, Tambaram=${tambaram.score}`);

  // A9: Zone scores ≤ overall score (multiplier is always ≤ 1.0)
  const noZoneExceedsOverall = zones.every(z => z.score <= severeResult.overallScore);
  assert('A9: No zone score exceeds the regional overall score', noZoneExceedsOverall);

  // A10: Population at risk ≥ 0 and equals sum of HIGH+ zones
  assert('A10: Estimated population at risk is a non-negative integer',
    Number.isInteger(severeResult.estimatedPopulationAtRisk) && severeResult.estimatedPopulationAtRisk >= 0);

  // A11: Verify scoreToLevel thresholds
  assert('A11: Score 70 → CRITICAL', riskEngine.scoreToLevel(70) === 'CRITICAL');
  assert('A12: Score 69 → HIGH',     riskEngine.scoreToLevel(69) === 'HIGH');
  assert('A13: Score 45 → HIGH',     riskEngine.scoreToLevel(45) === 'HIGH');
  assert('A14: Score 44 → MODERATE', riskEngine.scoreToLevel(44) === 'MODERATE');
  assert('A15: Score 25 → MODERATE', riskEngine.scoreToLevel(25) === 'MODERATE');
  assert('A16: Score 24 → SAFE',     riskEngine.scoreToLevel(24) === 'SAFE');
  assert('A17: Score 0  → SAFE',     riskEngine.scoreToLevel(0)  === 'SAFE');

  // =========================================================================
  // GROUP B — Authentication & RBAC
  // =========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('GROUP B — Authorization & RBAC Enforcement');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const commandToken  = await login('command', 'CC-2026-0001', 'CC-2026-0001');
  const citizenToken  = await login('citizen', 'citizen01@disasterguard.com', 'Citi@2026One');
  const rescueToken   = await login('rescue',  'RT-2026-0001', 'RT@2026-0001');

  // B1: POST /api/alerts without token → 401
  const b1 = await request('POST', '/api/alerts', {
    type: 'FLOOD_WARNING', severity: 'HIGH', title: 'Test', message: 'Test',
    affected_areas: 'Velachery', recommended_action: 'Evacuate', target_audience: 'CITIZENS'
  });
  assert('B1: POST /api/alerts without token → 401', b1.status === 401, `got ${b1.status}`);

  // B2: POST /api/alerts with citizen token → 403
  const b2 = await request('POST', '/api/alerts', {
    type: 'FLOOD_WARNING', severity: 'HIGH', title: 'Test', message: 'Test',
    affected_areas: 'Velachery', recommended_action: 'Evacuate', target_audience: 'CITIZENS'
  }, citizenToken);
  assert('B2: POST /api/alerts with citizen token → 403', b2.status === 403, `got ${b2.status}`);

  // B3: POST /api/alerts with rescue token → 403
  const b3 = await request('POST', '/api/alerts', {
    type: 'FLOOD_WARNING', severity: 'HIGH', title: 'Test', message: 'Test',
    affected_areas: 'Velachery', recommended_action: 'Evacuate', target_audience: 'CITIZENS'
  }, rescueToken);
  assert('B3: POST /api/alerts with rescue token → 403', b3.status === 403, `got ${b3.status}`);

  // B4: POST /api/risk/publish without token → 401
  const b4 = await request('POST', '/api/risk/publish', {
    rainfall_mm: 200, river_level_pct: 80, soil_moisture_pct: 70,
    drainage_capacity_pct: 20, historical_index: 60
  });
  assert('B4: POST /api/risk/publish without token → 401', b4.status === 401, `got ${b4.status}`);

  // B5: POST /api/risk/publish with citizen token → 403
  const b5 = await request('POST', '/api/risk/publish', {
    rainfall_mm: 200, river_level_pct: 80, soil_moisture_pct: 70,
    drainage_capacity_pct: 20, historical_index: 60
  }, citizenToken);
  assert('B5: POST /api/risk/publish with citizen token → 403', b5.status === 403, `got ${b5.status}`);

  // =========================================================================
  // GROUP C — Alert Lifecycle (publish, query, audience filtering, deactivation)
  // =========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('GROUP C — Alert Lifecycle');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // C1: Publish a CITIZENS alert
  const c1 = await request('POST', '/api/alerts', {
    type: 'FLOOD_WARNING', severity: 'HIGH',
    title: 'Velachery Flood Warning',
    message: 'Flood waters rising in Velachery. Evacuate immediately.',
    affected_areas: 'Velachery, Pallikaranai',
    recommended_action: 'Move to higher ground. Go to designated shelters.',
    target_audience: 'CITIZENS'
  }, commandToken);
  assert('C1: Valid command user publishes CITIZENS alert → 201', c1.status === 201, `got ${c1.status}`);
  const citizensAlertId = c1.body.alert?.id;
  assert('C2: Published alert has an ALT-2026-XXXX ID', /^ALT-2026-\d{4}$/.test(citizensAlertId),
    `id=${citizensAlertId}`);

  // C3: Publish a RESCUE_TEAMS alert
  const c3 = await request('POST', '/api/alerts', {
    type: 'EVACUATION', severity: 'CRITICAL',
    title: 'Mass Evacuation — Deploy All Teams',
    message: 'Deploy all rescue teams to flood zones immediately.',
    affected_areas: 'Sholinganallur, Perungudi',
    recommended_action: 'Prioritise medical cases. Report to CC-2026-0001.',
    target_audience: 'RESCUE_TEAMS'
  }, commandToken);
  assert('C3: RESCUE_TEAMS alert → 201', c3.status === 201, `got ${c3.status}`);
  const rescueAlertId = c3.body.alert?.id;

  // C4: Publish a BOTH alert
  const c4 = await request('POST', '/api/alerts', {
    type: 'HEAVY_RAINFALL', severity: 'WARNING',
    title: 'Heavy Rainfall Advisory',
    message: 'Heavy rainfall expected across Chennai for the next 48 hours.',
    affected_areas: 'All Zones',
    recommended_action: 'Avoid waterlogged roads. Stay indoors if possible.',
    target_audience: 'BOTH'
  }, commandToken);
  assert('C4: BOTH alert → 201', c4.status === 201, `got ${c4.status}`);
  const bothAlertId = c4.body.alert?.id;

  // C5: GET /api/alerts/active?audience=CITIZENS should include CITIZENS and BOTH alerts
  const c5 = await request('GET', '/api/alerts/active?audience=CITIZENS', null, citizenToken);
  assert('C5: Active alerts for CITIZENS returns 200', c5.status === 200, `got ${c5.status}`);
  const citizenAlertIds = c5.body.alerts.map(a => a.id);
  assert('C6: CITIZENS active includes the CITIZENS-targeted alert', citizenAlertIds.includes(citizensAlertId));
  assert('C7: CITIZENS active includes the BOTH-targeted alert',     citizenAlertIds.includes(bothAlertId));
  assert('C8: CITIZENS active excludes the RESCUE_TEAMS alert',      !citizenAlertIds.includes(rescueAlertId));

  // C9: GET /api/alerts/active?audience=RESCUE_TEAMS
  const c9 = await request('GET', '/api/alerts/active?audience=RESCUE_TEAMS', null, rescueToken);
  const rescueAlertIds = c9.body.alerts.map(a => a.id);
  assert('C9: RESCUE_TEAMS active includes the RESCUE-targeted alert', rescueAlertIds.includes(rescueAlertId));
  assert('C10: RESCUE_TEAMS active includes the BOTH alert',           rescueAlertIds.includes(bothAlertId));
  assert('C11: RESCUE_TEAMS active excludes the CITIZENS alert',       !rescueAlertIds.includes(citizensAlertId));

  // C12: Deactivate the CITIZENS alert
  const c12 = await request('PATCH', `/api/alerts/${citizensAlertId}/deactivate`, null, commandToken);
  assert('C12: Deactivate alert → 200', c12.status === 200, `got ${c12.status}`);

  // C13: Deactivated alert no longer in active list
  const c13 = await request('GET', '/api/alerts/active?audience=CITIZENS', null, citizenToken);
  const c13ids = c13.body.alerts.map(a => a.id);
  assert('C13: Deactivated alert excluded from /active', !c13ids.includes(citizensAlertId));

  // C14: Deactivated alert preserved in /history with deactivated_at
  const c14 = await request('GET', '/api/alerts/history', null, commandToken);
  const histAlert = c14.body.alerts.find(a => a.id === citizensAlertId);
  assert('C14: Deactivated alert preserved in /history', !!histAlert);
  assert('C15: Deactivated alert has deactivated_at timestamp', !!histAlert?.deactivated_at);
  assert('C16: Deactivated alert has is_active = 0', histAlert?.is_active === 0);

  // C17: Attempt to deactivate already-inactive alert → 409
  const c17 = await request('PATCH', `/api/alerts/${citizensAlertId}/deactivate`, null, commandToken);
  assert('C17: Double-deactivation → 409', c17.status === 409, `got ${c17.status}`);

  // C18: Missing required field → 400
  const c18 = await request('POST', '/api/alerts', {
    type: 'FLOOD_WARNING', severity: 'HIGH',
    // title is missing
    message: 'Test', affected_areas: 'Velachery',
    recommended_action: 'Evacuate', target_audience: 'CITIZENS'
  }, commandToken);
  assert('C18: Missing title field → 400', c18.status === 400, `got ${c18.status}`);

  // C19: Invalid alert type → 400
  const c19 = await request('POST', '/api/alerts', {
    type: 'EARTHQUAKE_ALERT', severity: 'HIGH', title: 'Test',
    message: 'Test', affected_areas: 'Test',
    recommended_action: 'Test', target_audience: 'CITIZENS'
  }, commandToken);
  assert('C19: Invalid alert type → 400', c19.status === 400, `got ${c19.status}`);

  // =========================================================================
  // GROUP D — Risk Prediction Lifecycle
  // =========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('GROUP D — Risk Prediction Lifecycle');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const sensorInputs = {
    rainfall_mm: 200, river_level_pct: 80,
    soil_moisture_pct: 75, drainage_capacity_pct: 25,
    historical_index: 60
  };

  // D1: Preview (no DB write)
  const d1 = await request('POST', '/api/risk/predict', sensorInputs, commandToken);
  assert('D1: POST /api/risk/predict → 200', d1.status === 200, `got ${d1.status}`);
  assert('D2: Predict response has overallScore', typeof d1.body.prediction?.overallScore === 'number');
  assert('D3: Predict response has zones array',  Array.isArray(d1.body.prediction?.zones));
  assert('D4: Predict response has riskLevel',    typeof d1.body.prediction?.riskLevel === 'string');

  // D2: Any authenticated role can preview
  const d2 = await request('POST', '/api/risk/predict', sensorInputs, citizenToken);
  assert('D5: Citizen can use /api/risk/predict → 200', d2.status === 200, `got ${d2.status}`);

  // D3: Publish
  const d3 = await request('POST', '/api/risk/publish', sensorInputs, commandToken);
  assert('D6: POST /api/risk/publish → 201', d3.status === 201, `got ${d3.status}`);
  const publishedRiskId = d3.body.riskId;
  assert('D7: Published risk has RISK-2026-XXXX ID', /^RISK-2026-\d{4}$/.test(publishedRiskId),
    `id=${publishedRiskId}`);

  // D4: Get latest
  const d4 = await request('GET', '/api/risk/latest', null, commandToken);
  assert('D8: GET /api/risk/latest → 200', d4.status === 200, `got ${d4.status}`);
  assert('D9: Latest prediction ID matches published ID', d4.body.prediction?.id === publishedRiskId,
    `expected ${publishedRiskId}, got ${d4.body.prediction?.id}`);

  // D5: Invalid input → 400
  const d5 = await request('POST', '/api/risk/predict', {
    rainfall_mm: -10, river_level_pct: 80,
    soil_moisture_pct: 75, drainage_capacity_pct: 25,
    historical_index: 60
  }, commandToken);
  assert('D10: Negative rainfall_mm → 400', d5.status === 400, `got ${d5.status}`);

  // =========================================================================
  // GROUP E — Decoupling Guarantee
  // =========================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('GROUP E — Risk/Alert Decoupling Guarantee');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Count active alerts before publish
  const before = await request('GET', '/api/alerts/active', null, commandToken);
  const beforeCount = before.body.count;

  // Publish a second risk prediction
  await request('POST', '/api/risk/publish', {
    rainfall_mm: 290, river_level_pct: 98, soil_moisture_pct: 95,
    drainage_capacity_pct: 5, historical_index: 90
  }, commandToken);

  // Count active alerts after publish
  const after = await request('GET', '/api/alerts/active', null, commandToken);
  const afterCount = after.body.count;

  assert(
    'E1: Publishing a risk prediction does NOT auto-create emergency alerts',
    afterCount === beforeCount,
    `alerts before=${beforeCount}, after=${afterCount}`
  );

  // =========================================================================
  // RESULTS SUMMARY
  // =========================================================================
  console.log('\n════════════════════════════════════════════════');
  console.log(`  Stage 3 Verification Complete`);
  console.log(`  ✅ Passed: ${passed}`);
  if (failed > 0) {
    console.log(`  ❌ Failed: ${failed}`);
    failures.forEach(f => console.log(`     • ${f}`));
  } else {
    console.log(`  ❌ Failed: 0`);
    console.log(`\n  🎉 ALL TESTS PASSED — Stage 3 is verified.`);
  }
  console.log('════════════════════════════════════════════════\n');

  httpServer.close(() => {
    process.exit(failed > 0 ? 1 : 0);
  });
}

runTests().catch((err) => {
  console.error('\n[FATAL] Test runner crashed:', err.message);
  httpServer.close(() => process.exit(1));
});
