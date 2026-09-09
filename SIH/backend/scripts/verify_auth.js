const http = require('http');
const { server } = require('../server');

const TEST_PORT = 5099;

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

async function runTests() {
  console.log('\n====================================================');
  console.log('🧪 DisasterGuard Stage 1: Authentication & Server Verification');
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
    // 1. Health check
    console.log('--- Test 1: Server Health Check ---');
    const health = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/health',
      method: 'GET'
    });
    assert(health.status === 200, `Health check returned status 200 (received ${health.status})`);
    assert(health.data.database === 'connected', 'Database reports connected');
    assert(health.data.seededUsers === 8, `Seeded users count equals 8 (received ${health.data.seededUsers})`);

    // 2. Canonical Accounts Tests
    console.log('\n--- Test 2: Canonical Demo Account Logins ---');

    const accounts = [
      { role: 'citizen', id: 'citizen01@disasterguard.com', pass: 'Citi@2026One', expectedUrl: 'citizen1.html' },
      { role: 'citizen', id: 'citizen02@disasterguard.com', pass: 'Citi@2026Two', expectedUrl: 'citizen2.html' },
      { role: 'rescue', id: 'RT-2026-0001', pass: 'RT@2026-0001', expectedUrl: 'rescue.html' },
      { role: 'rescue', id: 'RT-2026-0002', pass: 'RT@2026-0002', expectedUrl: 'rescue.html' },
      { role: 'rescue', id: 'RT-2026-0003', pass: 'RT@2026-0003', expectedUrl: 'rescue.html' },
      { role: 'rescue', id: 'RT-2026-0004', pass: 'RT@2026-0004', expectedUrl: 'rescue.html' },
      { role: 'command', id: 'CC-2026-0001', pass: 'CC-2026-0001', expectedUrl: 'command_centre1.html' },
      { role: 'command', id: 'CC-2026-0002', pass: 'CC-2026-0002', expectedUrl: 'command_centre2.html' }
    ];

    let lastToken = null;

    for (const acc of accounts) {
      const res = await request({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { role: acc.role, id: acc.id, password: acc.pass });

      assert(res.status === 200, `Login for [${acc.role}] ${acc.id} returned 200`);
      assert(res.data.dashboardUrl === acc.expectedUrl, `Dashboard URL for ${acc.id} is ${acc.expectedUrl}`);
      assert(typeof res.data.token === 'string' && res.data.token.length > 20, `JWT token returned for ${acc.id}`);
      assert(res.data.user.identifier === acc.id, `User identifier matches ${acc.id}`);

      lastToken = res.data.token;
    }

    // 3. JWT Verification with /api/auth/me
    console.log('\n--- Test 3: Authenticated /api/auth/me Verification ---');
    const meRes = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${lastToken}` }
    });
    assert(meRes.status === 200, 'GET /api/auth/me with valid Bearer token returns 200');
    assert(meRes.data.user && meRes.data.user.identifier === 'CC-2026-0002', 'Profile reflects CC-2026-0002 token');

    // 4. Invalid Credentials Handling
    console.log('\n--- Test 4: Negative & Validation Test Cases ---');

    // Wrong password
    const wrongPass = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { role: 'citizen', id: 'citizen01@disasterguard.com', password: 'WrongPassword123' });
    assert(wrongPass.status === 401, `Wrong password returns 401 Unauthorized (received ${wrongPass.status})`);

    // Wrong role
    const wrongRole = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { role: 'command', id: 'citizen01@disasterguard.com', password: 'Citi@2026One' });
    assert(wrongRole.status === 401, `Mismatched role returns 401 Unauthorized (received ${wrongRole.status})`);

    // Missing field
    const missingField = await request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { role: 'citizen', id: 'citizen01@disasterguard.com' });
    assert(missingField.status === 400, `Missing password returns 400 Bad Request (received ${missingField.status})`);

  } catch (err) {
    console.error('Test execution exception:', err);
    allPassed = false;
  } finally {
    server.close();
  }

  console.log('\n====================================================');
  console.log(`Summary: ${passedCount}/${totalCount} tests passed.`);
  if (allPassed) {
    console.log('🎉 ALL STAGE 1 VERIFICATION TESTS PASSED!');
  } else {
    console.log('⚠️ SOME TESTS FAILED. Please review above.');
    process.exit(1);
  }
  console.log('====================================================\n');
}

runTests();
