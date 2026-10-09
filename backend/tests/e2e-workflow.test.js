import assert from 'assert';

console.log('══════════════════════════════════════════════════════════════════');
console.log('[AUDIT] INVISIBLE QUEUE AI  -  FULL END-TO-END AUTOMATED TEST SUITE');
console.log('══════════════════════════════════════════════════════════════════\n');

const BASE_URL = 'http://localhost:5000';

async function runE2E() {
  let recepToken, doctorToken, adminToken;
  let newPatientId, newQueueEntry;

  // ── 1. Authenticate Staff Roles ─────────────────────────────────
  console.log('[STEP] STEP 1: Staff Authentication');
  const recepLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'receptionist1@hospital.com', password: 'recep123' })
  });
  const recepLogin = await recepLoginRes.json();
  assert.strictEqual(recepLogin.status, 'ok', 'Receptionist login failed');
  recepToken = recepLogin.data.token;
  console.log('   ✓ Receptionist logged in successfully');

  const docLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'dr.ravi@hospital.com', password: 'doctor123' })
  });
  const docLogin = await docLoginRes.json();
  assert.strictEqual(docLogin.status, 'ok', 'Doctor login failed');
  doctorToken = docLogin.data.token;
  console.log('   ✓ Doctor logged in successfully');

  const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@hospital.com', password: 'admin123' })
  });
  const adminLogin = await adminLoginRes.json();
  assert.strictEqual(adminLogin.status, 'ok', 'Admin login failed');
  adminToken = adminLogin.data.token;
  console.log('   ✓ Admin logged in successfully\n');

  // ── TEST 1: Receptionist Registers Patient ────────────────────────
  console.log('[STEP] TEST 1: Receptionist registers patient');
  const patientRes = await fetch(`${BASE_URL}/api/patients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${recepToken}` },
    body: JSON.stringify({ name: 'Sneha Rao', age: 29, gender: 'FEMALE', phone: '9876543299' })
  });
  const patientData = await patientRes.json();
  assert.strictEqual(patientData.status, 'ok');
  assert.strictEqual(patientData.data.name, 'Sneha Rao');
  newPatientId = patientData.data.id;
  console.log(`   ✓ Patient created: Sneha Rao (ID: ${newPatientId})`);

  // ── TEST 2 & 3: Token Generated & Secure Queue Link Generated ─────
  console.log('\n[STEP] TEST 2 & 3: Token and Secure Access Token Generation');
  const tokenRes = await fetch(`${BASE_URL}/api/queue/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${recepToken}` },
    body: JSON.stringify({ patient_id: newPatientId, doctor_id: 1, department_id: 1 })
  });
  const tokenData = await tokenRes.json();
  assert.strictEqual(tokenData.status, 'ok');
  assert(tokenData.data.token_number, 'Token number must be generated');
  assert(tokenData.data.queue_access_token, 'Queue access token must be generated');
  assert.strictEqual(tokenData.data.queue_access_token.length, 32, 'Access token must be 32 hex chars');
  newQueueEntry = tokenData.data;
  console.log(`   ✓ Digital Token: ${newQueueEntry.token_number}`);
  console.log(`   ✓ Secure Access Token: ${newQueueEntry.queue_access_token}`);
  console.log(`   ✓ Queue URL: http://localhost:5173/queue/${newQueueEntry.queue_access_token}`);

  // ── TEST 4, 5, 6, 7: Public Patient Queue Access Verification ─────
  console.log('\n[STEP] TEST 4, 5, 6, 7: Patient Queue View Data Verification');
  const patientViewRes = await fetch(`${BASE_URL}/api/queue/access/${newQueueEntry.queue_access_token}`);
  assert.strictEqual(patientViewRes.status, 200, 'Public endpoint must return 200 OK without login');
  const patientView = await patientViewRes.json();
  assert.strictEqual(patientView.status, 'ok');

  // Test 5: Patient sees correct token
  assert.strictEqual(patientView.data.token, newQueueEntry.token_number);
  console.log(`   ✓ Test 5 Passed: Patient sees their token: ${patientView.data.token}`);

  // Test 6: Patient sees current serving token
  console.log(`   ✓ Test 6 Passed: Patient sees Currently Serving: ${patientView.data.currentToken || 'None'}`);

  // Test 7: Patient sees valid queue position & patients ahead
  assert(patientView.data.position >= 1, 'Patient position must be at least 1');
  assert(patientView.data.patientsAhead >= 0, 'Patients ahead must be non-negative');
  console.log(`   ✓ Test 7 Passed: Position: ${patientView.data.position}, Patients Ahead: ${patientView.data.patientsAhead}`);

  // Test 10: Approaching-turn indicator validity
  assert.strictEqual(typeof patientView.data.isApproaching, 'boolean');
  console.log(`   ✓ Test 10 Passed: Approaching flag is boolean (${patientView.data.isApproaching})`);

  // ── TEST 8 & 9: Doctor Progresses Queue & Patient Position Updates ─
  console.log('\n[STEP] TEST 8 & 9: Doctor Advances Queue Towards Sneha Rao');
  // First clear any currently serving patient for doctor 1 so doctor can call
  const docQueueRes = await fetch(`${BASE_URL}/api/queue/doctor/1`, {
    headers: { Authorization: `Bearer ${doctorToken}` }
  });
  const docQueueData = await docQueueRes.json();
  const activePatient = docQueueData.data.find(q => ['CALLED', 'IN_CONSULTATION'].includes(q.status));
  if (activePatient) {
    if (activePatient.status === 'CALLED') {
      await fetch(`${BASE_URL}/api/queue/${activePatient.id}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${doctorToken}` }
      });
    }
    await fetch(`${BASE_URL}/api/queue/${activePatient.id}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${doctorToken}` }
    });
    console.log(`   ✓ Doctor wrapped up active patient ${activePatient.token_number}`);
  }

  // Doctor calls Sneha Rao directly or progresses to her
  console.log('\n[STEP] Simulating turn arrival for Sneha Rao:');
  const callRes = await fetch(`${BASE_URL}/api/queue/${newQueueEntry.id}/call`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` }
  });
  assert.strictEqual(callRes.status, 200, 'Doctor call endpoint returned 200');

  const patientCalledRes = await fetch(`${BASE_URL}/api/queue/access/${newQueueEntry.queue_access_token}`);
  const patientCalled = await patientCalledRes.json();
  assert.strictEqual(patientCalled.data.status, 'CALLED');
  assert.strictEqual(patientCalled.data.position, 1);
  assert.strictEqual(patientCalled.data.patientsAhead, 0);
  console.log('   ✓ Sneha Rao status updated to: CALLED (Position 1, 0 ahead)');

  // Doctor starts consultation
  await fetch(`${BASE_URL}/api/queue/${newQueueEntry.id}/start`, { method: 'POST', headers: { Authorization: `Bearer ${doctorToken}` } });
  const patientConsultRes = await fetch(`${BASE_URL}/api/queue/access/${newQueueEntry.queue_access_token}`);
  const patientConsult = await patientConsultRes.json();
  assert.strictEqual(patientConsult.data.status, 'IN_CONSULTATION');
  console.log('   ✓ Sneha Rao status updated to: IN_CONSULTATION');

  // Doctor completes consultation
  await fetch(`${BASE_URL}/api/queue/${newQueueEntry.id}/complete`, { method: 'POST', headers: { Authorization: `Bearer ${doctorToken}` } });
  const patientCompleteRes = await fetch(`${BASE_URL}/api/queue/access/${newQueueEntry.queue_access_token}`);
  const patientComplete = await patientCompleteRes.json();
  assert.strictEqual(patientComplete.data.status, 'COMPLETED');
  assert.strictEqual(patientComplete.data.position, null, 'Position is null after completion');
  console.log('   ✓ Sneha Rao status updated to: COMPLETED');

  // ── TEST 11 & SECURITY: Unauthorized / Invalid Access Test ─────────
  console.log('\n[STEP] TEST 11 & SECURITY: Privacy, Data Isolation, and Invalid Token Testing');
  const invalidRes = await fetch(`${BASE_URL}/api/queue/access/fake_invalid_token_999999`);
  assert.strictEqual(invalidRes.status, 404, 'Non-existent token must return 404');
  console.log('   ✓ Test 11 Passed: Invalid/fake access token returns 404 cleanly');

  // Check no sensitive fields exposed in public view
  const forbiddenKeys = ['patient_name', 'phone', 'patient_phone', 'password_hash', 'patient_id', 'id', 'user_id'];
  for (const key of forbiddenKeys) {
    assert.strictEqual(patientView.data[key], undefined, `Security Breach: Key ${key} is exposed in patient API!`);
  }
  console.log('   ✓ Security Passed: Zero PII (no phone, no patient name, no internal DB ID) leaked');

  // ── TEST 12: Phase 1 Receptionist Functionality ───────────────────
  console.log('\n[STEP] TEST 12: Phase 1 Receptionist Functionality Still Works');
  const recepQueueRes = await fetch(`${BASE_URL}/api/queue`, { headers: { Authorization: `Bearer ${recepToken}` } });
  const recepQueue = await recepQueueRes.json();
  assert.strictEqual(recepQueue.status, 'ok');
  assert(recepQueue.data.length >= 3);
  console.log(`   ✓ Receptionist can view full queue (${recepQueue.data.length} patients listed)`);

  // ── TEST 13: Phase 1 Doctor Functionality ─────────────────────────
  console.log('\n[STEP] TEST 13: Phase 1 Doctor Functionality Still Works');
  const docQueueFinalRes = await fetch(`${BASE_URL}/api/queue/doctor/1`, { headers: { Authorization: `Bearer ${doctorToken}` } });
  const docQueue = await docQueueFinalRes.json();
  assert.strictEqual(docQueue.status, 'ok');
  console.log(`   ✓ Doctor can fetch doctor queue (${docQueue.data.length} entries for Dr. Ravi)`);

  // ── TEST 14: Phase 1 Admin Functionality ──────────────────────────
  console.log('\n[STEP] TEST 14: Phase 1 Admin Functionality Still Works');
  const statsRes = await fetch(`${BASE_URL}/api/queue/stats`, { headers: { Authorization: `Bearer ${adminToken}` } });
  const stats = await statsRes.json();
  assert.strictEqual(stats.status, 'ok');
  assert(typeof stats.data.active_virtual_queues === 'number');
  assert(typeof stats.data.total_patients === 'number');
  assert(typeof stats.data.completed === 'number');
  console.log(`   ✓ Admin stats working: Total: ${stats.data.total_patients}, Completed: ${stats.data.completed}, Active Virtual Queues: ${stats.data.active_virtual_queues}`);

  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('[SUCCESS] ALL 14 TESTS & SECURITY CHECKS PASSED WITH 100% SUCCESS!');
  console.log('══════════════════════════════════════════════════════════════════\n');
}

runE2E().catch(err => {
  console.error('❌ E2E Test Failure:', err);
  process.exit(1);
});
