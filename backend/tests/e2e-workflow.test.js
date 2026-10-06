import assert from 'assert';

console.log('══════════════════════════════════════════════════════════════════');
console.log('🔬 INVISIBLE QUEUE AI — FULL END-TO-END AUTOMATED TEST SUITE');
console.log('══════════════════════════════════════════════════════════════════\n');

const BASE_URL = 'http://localhost:5000';

async function runE2E() {
  let recepToken, doctorToken, adminToken;
  let newPatientId, newQueueEntry;

  // ── 1. Authenticate Staff Roles ─────────────────────────────────
  console.log('📌 STEP 1: Staff Authentication');
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
  console.log('📌 TEST 1: Receptionist registers patient');
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
  console.log('\n📌 TEST 2 & 3: Token and Secure Access Token Generation');
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
  console.log('\n📌 TEST 4, 5, 6, 7: Patient Queue View Data Verification');
  const patientViewRes = await fetch(`${BASE_URL}/api/queue/access/${newQueueEntry.queue_access_token}`);
  assert.strictEqual(patientViewRes.status, 200, 'Public endpoint must return 200 OK without login');
  const patientView = await patientViewRes.json();
  assert.strictEqual(patientView.status, 'ok');

  // Test 5: Patient sees correct token
  assert.strictEqual(patientView.data.token, newQueueEntry.token_number);
  console.log(`   ✓ Test 5 Passed: Patient sees their token: ${patientView.data.token}`);

  // Test 6: Patient sees current serving token
  assert.strictEqual(patientView.data.currentToken, 'GM-001', 'GM-001 is currently in consultation');
  console.log(`   ✓ Test 6 Passed: Patient sees Currently Serving: ${patientView.data.currentToken}`);

  // Test 7: Patient sees correct queue position & patients ahead
  // In initial state: GM-001 (in consultation), GM-002 (waiting), Sneha Rao GM-003 (waiting)
  assert.strictEqual(patientView.data.position, 3, 'Patient position must be 3');
  assert.strictEqual(patientView.data.patientsAhead, 2, 'Patients ahead must be 2');
  console.log(`   ✓ Test 7 Passed: Position: ${patientView.data.position}, Patients Ahead: ${patientView.data.patientsAhead}`);

  // Test 10: Approaching-turn indicator appears when threshold is reached
  assert.strictEqual(patientView.data.isApproaching, true, 'isApproaching must be true when patientsAhead <= 2');
  console.log(`   ✓ Test 10 Passed: Approaching-turn alert active (ahead: 2 <= threshold: 2)`);

  // ── TEST 8 & 9: Doctor Progresses Queue & Patient Position Updates ─
  console.log('\n📌 TEST 8 & 9: Doctor Completes Current Patient & Patient Position Moves Forward');
  // Doctor completes GM-001 (entry id 1)
  const completeRes = await fetch(`${BASE_URL}/api/queue/1/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` }
  });
  assert.strictEqual(completeRes.status, 200);
  console.log('   ✓ Doctor completed consultation for GM-001');

  // Doctor calls GM-002 (entry id 2)
  const callRes = await fetch(`${BASE_URL}/api/queue/2/call`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` }
  });
  assert.strictEqual(callRes.status, 200);
  console.log('   ✓ Doctor called next patient GM-002');

  // Patient checks queue again
  const patientViewUpdatedRes = await fetch(`${BASE_URL}/api/queue/access/${newQueueEntry.queue_access_token}`);
  const patientViewUpdated = await patientViewUpdatedRes.json();
  assert.strictEqual(patientViewUpdated.data.currentToken, 'GM-002', 'Currently serving must now be GM-002');
  assert.strictEqual(patientViewUpdated.data.position, 2, 'Sneha Rao position should now be 2');
  assert.strictEqual(patientViewUpdated.data.patientsAhead, 1, 'Sneha Rao patients ahead should now be 1');
  assert.strictEqual(patientViewUpdated.data.isApproaching, true);
  console.log(`   ✓ Test 9 Passed: Position moved from 3 -> ${patientViewUpdated.data.position}`);
  console.log(`   ✓ Patients Ahead decreased from 2 -> ${patientViewUpdated.data.patientsAhead}`);
  console.log(`   ✓ Currently Serving updated to: ${patientViewUpdated.data.currentToken}`);

  // Doctor completes GM-002 and calls Sneha Rao (entry id 3)
  console.log('\n📌 Simulating turn arrival for Sneha Rao:');
  await fetch(`${BASE_URL}/api/queue/2/complete`, { method: 'POST', headers: { Authorization: `Bearer ${doctorToken}` } });
  await fetch(`${BASE_URL}/api/queue/${newQueueEntry.id}/call`, { method: 'POST', headers: { Authorization: `Bearer ${doctorToken}` } });

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
  console.log('\n📌 TEST 11 & SECURITY: Privacy, Data Isolation, and Invalid Token Testing');
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
  console.log('\n📌 TEST 12: Phase 1 Receptionist Functionality Still Works');
  const recepQueueRes = await fetch(`${BASE_URL}/api/queue`, { headers: { Authorization: `Bearer ${recepToken}` } });
  const recepQueue = await recepQueueRes.json();
  assert.strictEqual(recepQueue.status, 'ok');
  assert(recepQueue.data.length >= 3);
  console.log(`   ✓ Receptionist can view full queue (${recepQueue.data.length} patients listed)`);

  // ── TEST 13: Phase 1 Doctor Functionality ─────────────────────────
  console.log('\n📌 TEST 13: Phase 1 Doctor Functionality Still Works');
  const docQueueRes = await fetch(`${BASE_URL}/api/queue/doctor/1`, { headers: { Authorization: `Bearer ${doctorToken}` } });
  const docQueue = await docQueueRes.json();
  assert.strictEqual(docQueue.status, 'ok');
  console.log(`   ✓ Doctor can fetch doctor queue (${docQueue.data.length} entries for Dr. Ravi)`);

  // ── TEST 14: Phase 1 Admin Functionality ──────────────────────────
  console.log('\n📌 TEST 14: Phase 1 Admin Functionality Still Works');
  const statsRes = await fetch(`${BASE_URL}/api/queue/stats`, { headers: { Authorization: `Bearer ${adminToken}` } });
  const stats = await statsRes.json();
  assert.strictEqual(stats.status, 'ok');
  assert(typeof stats.data.active_virtual_queues === 'number');
  assert(typeof stats.data.total_patients === 'number');
  assert(typeof stats.data.completed === 'number');
  console.log(`   ✓ Admin stats working: Total: ${stats.data.total_patients}, Completed: ${stats.data.completed}, Active Virtual Queues: ${stats.data.active_virtual_queues}`);

  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL 14 TESTS & SECURITY CHECKS PASSED WITH 100% SUCCESS!');
  console.log('══════════════════════════════════════════════════════════════════\n');
}

runE2E().catch(err => {
  console.error('❌ E2E Test Failure:', err);
  process.exit(1);
});
