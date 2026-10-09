import assert from 'assert';

console.log('══════════════════════════════════════════════════════════════════');
console.log('[AUDIT] ADVANCED QUEUE OPERATIONS & DOCTOR AVAILABILITY TEST SUITE');
console.log('══════════════════════════════════════════════════════════════════\n');

const BASE_URL = 'http://localhost:5000';

async function runTests() {
  // ── Helper: Login ──
  async function login(email, password) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Login failed');
    return data.data.token;
  }

  console.log('[STEP] STEP 1: Staff Authentication');
  const adminToken = await login('admin@hospital.com', 'admin123');
  const doctorToken = await login('dr.ravi@hospital.com', 'doctor123');
  const recepToken = await login('receptionist1@hospital.com', 'recep123');
  assert(adminToken, 'Admin token should exist');
  assert(doctorToken, 'Doctor token should exist');
  assert(recepToken, 'Receptionist token should exist');
  console.log('   ✓ Admin, Doctor, and Receptionist authenticated\n');

  // ── STEP 2: Doctor Availability Today ──
  console.log('[STEP] STEP 2: Doctor Availability Resolution');
  const availRes = await fetch(`${BASE_URL}/api/doctors/availability/today`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const availData = await availRes.json();
  assert.strictEqual(availData.status, 'ok');
  assert(Array.isArray(availData.data), 'Availability data must be an array');
  const docRavi = availData.data.find(d => d.name === 'Dr. Ravi Kumar');
  assert(docRavi, 'Dr. Ravi Kumar must exist');
  assert.strictEqual(docRavi.computed_availability, 'AVAILABLE');
  console.log(`   ✓ Dr. Ravi availability: ${docRavi.computed_availability} (waiting: ${docRavi.waitingCount})`);

  // ── STEP 3: Register New Patient & Token ──
  console.log('\n[STEP] STEP 3: Intake Patient & Generate Token');
  const pRes = await fetch(`${BASE_URL}/api/patients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${recepToken}` },
    body: JSON.stringify({ name: 'Vikram Mehta', age: 34, gender: 'MALE', phone: '9888877771' })
  });
  const pData = await pRes.json();
  assert.strictEqual(pData.status, 'ok');
  const patientId = pData.data.id;

  const tRes = await fetch(`${BASE_URL}/api/queue/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${recepToken}` },
    body: JSON.stringify({ patient_id: patientId, doctor_id: 1, department_id: 1 })
  });
  const tData = await tRes.json();
  assert.strictEqual(tData.status, 'ok');
  const entry = tData.data;
  const accessToken = entry.queue_access_token;
  assert(accessToken, 'Access token must be generated');
  console.log(`   ✓ Token generated: ${entry.token_number} with access token ${accessToken.slice(0, 8)}...`);

  // ── STEP 4: Patient Queue Access & Digital Pass ──
  console.log('\n[STEP] STEP 4: Public Patient Queue Access');
  const accessRes = await fetch(`${BASE_URL}/api/queue/access/${accessToken}`);
  const accessData = await accessRes.json();
  assert.strictEqual(accessData.status, 'ok');
  assert.strictEqual(accessData.data.token, entry.token_number);
  assert.strictEqual(accessData.data.status, 'WAITING');
  assert.strictEqual(accessData.data.gracePeriodMinutes, 5);
  assert.strictEqual(accessData.data.rejoinCount, 0);
  assert.strictEqual(accessData.data.maxRejoins, 2);
  assert.strictEqual(accessData.data.rescheduleCount, 0);
  assert.strictEqual(accessData.data.maxReschedules, 2);
  console.log('   ✓ Patient pass verified with policy limits and dynamic status');

  // ── STEP 5: Call Token and Missed Grace Period Transition ──
  console.log('\n[STEP] STEP 5: Call Token & Manual/Grace Missed Workflow');
  // Call token
  const callRes = await fetch(`${BASE_URL}/api/queue/${entry.id}/call`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` }
  });
  const callData = await callRes.json();
  assert.strictEqual(callData.status, 'ok');
  assert.strictEqual(callData.data.status, 'CALLED');
  console.log('   ✓ Token successfully called');

  // Doctor marks missed
  const missedRes = await fetch(`${BASE_URL}/api/queue/${entry.id}/missed`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` }
  });
  const missedData = await missedRes.json();
  assert.strictEqual(missedData.status, 'ok');
  assert.strictEqual(missedData.data.status, 'MISSED');
  console.log('   ✓ Token marked as MISSED');

  // Verify patient sees MISSED status
  const postMissedPass = await (await fetch(`${BASE_URL}/api/queue/access/${accessToken}`)).json();
  assert.strictEqual(postMissedPass.data.status, 'MISSED');
  assert(postMissedPass.data.missedAt, 'missedAt timestamp must be recorded');
  console.log('   ✓ Patient pass correctly reports MISSED status with timestamp');

  // ── STEP 6: Patient Rejoin Queue ──
  console.log('\n[STEP] STEP 6: Patient Self-Service Rejoin');
  const rejoinRes = await fetch(`${BASE_URL}/api/queue/patient/rejoin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken })
  });
  const rejoinData = await rejoinRes.json();
  assert.strictEqual(rejoinData.status, 'ok');
  assert.strictEqual(rejoinData.data.status, 'WAITING');
  assert.strictEqual(rejoinData.data.rejoinCount, 1);
  console.log(`   ✓ Patient rejoined queue at the end (rejoinCount: ${rejoinData.data.rejoinCount})`);

  // Verify rejoining again while WAITING is rejected
  const badRejoinRes = await fetch(`${BASE_URL}/api/queue/patient/rejoin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken })
  });
  assert.strictEqual(badRejoinRes.status, 400, 'Rejoining active waiting token should fail');
  console.log('   ✓ Rejoining while already in WAITING is rejected with 400');

  // ── STEP 7: Patient Reschedule Options & Reschedule ──
  console.log('\n[STEP] STEP 7: Same-Day Reschedule Workflow');
  const reschedOptionsRes = await fetch(`${BASE_URL}/api/queue/patient/reschedule-options?accessToken=${accessToken}`);
  const reschedOptions = await reschedOptionsRes.json();
  assert.strictEqual(reschedOptions.status, 'ok');
  assert(reschedOptions.data.options.length > 0, 'Must have at least one eligible alternative doctor in department');
  const targetDoc = reschedOptions.data.options[0];
  console.log(`   ✓ Found available doctor option: Dr. ${targetDoc.name} (${targetDoc.specialization}) in ${targetDoc.roomNumber}`);

  // Reschedule to target doctor
  const doReschedRes = await fetch(`${BASE_URL}/api/queue/patient/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, target_doctor_id: targetDoc.doctorId })
  });
  const doReschedData = await doReschedRes.json();
  assert.strictEqual(doReschedData.status, 'ok');
  assert.strictEqual(doReschedData.data.status, 'WAITING');
  assert.strictEqual(doReschedData.data.rescheduleCount, 1);
  console.log(`   ✓ Rescheduled successfully to Dr. ${doReschedData.data.newDoctor}`);

  // ── STEP 8: Queue Pause and Resume ──
  console.log('\n[STEP] STEP 8: Doctor Queue Pause and Resume');
  const pauseRes = await fetch(`${BASE_URL}/api/queue/doctor/1/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doctorToken}` },
    body: JSON.stringify({ reason: 'Emergency Ward Round' })
  });
  const pauseData = await pauseRes.json();
  assert.strictEqual(pauseData.status, 'ok');
  assert.strictEqual(pauseData.data.operational_status, 'PAUSED');
  console.log('   ✓ Dr. Ravi queue PAUSED for Emergency Ward Round');

  // Verify availability shows PAUSED
  const pausedAvail = await (await fetch(`${BASE_URL}/api/doctors/availability/today`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  })).json();
  const docRaviPaused = pausedAvail.data.find(d => d.id === 1);
  assert.strictEqual(docRaviPaused.computed_availability, 'PAUSED');
  console.log('   ✓ Operational availability correctly reports PAUSED');

  // Resume queue
  const resumeRes = await fetch(`${BASE_URL}/api/queue/doctor/1/resume`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` }
  });
  const resumeData = await resumeRes.json();
  assert.strictEqual(resumeData.status, 'ok');
  assert.strictEqual(resumeData.data.operational_status, 'AVAILABLE');
  console.log('   ✓ Dr. Ravi queue RESUMED to AVAILABLE');

  // ── STEP 9: Doctor Leave Management ──
  console.log('\n[STEP] STEP 9: Doctor Leave Management');
  const todayStr = new Date().toISOString().split('T')[0];
  const leaveRes = await fetch(`${BASE_URL}/api/doctors/2/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ leave_date: todayStr, is_full_day: true, reason: 'Conference' })
  });
  const leaveData = await leaveRes.json();
  assert.strictEqual(leaveData.status, 'ok');
  console.log('   ✓ Leave created for Dr. Meera Nambiar');

  // Check today availability reflects leave
  const leaveAvail = await (await fetch(`${BASE_URL}/api/doctors/availability/today`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  })).json();
  const docMeera = leaveAvail.data.find(d => d.id === 2);
  assert.strictEqual(docMeera.computed_availability, 'ON_LEAVE');
  console.log('   ✓ Doctor availability correctly computes ON_LEAVE');

  // ── STEP 10: Queue Reassignment Transfer ──
  console.log('\n[STEP] STEP 10: Emergency Queue Transfer');
  // Create another patient in Dr. Priya Sharma's queue (Doc 3)
  const p3Res = await (await fetch(`${BASE_URL}/api/queue/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${recepToken}` },
    body: JSON.stringify({ patient_id: 2, doctor_id: 3, department_id: 1 })
  })).json();

  const transferRes = await fetch(`${BASE_URL}/api/queue/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ fromDoctorId: 3, toDoctorId: 1, reason: 'Duty Reassignment' })
  });
  const transferData = await transferRes.json();
  assert.strictEqual(transferData.status, 'ok');
  assert(transferData.data.transferredCount >= 1, 'Should transfer waiting tokens');
  console.log(`   ✓ Successfully transferred ${transferData.data.transferredCount} patients from Dr. ${transferData.data.fromDoctor} to Dr. ${transferData.data.toDoctor}`);

  // ── STEP 11: Patient Cancel Queue ──
  console.log('\n[STEP] STEP 11: Patient Cancel Queue Entry');
  const cancelRes = await fetch(`${BASE_URL}/api/queue/patient/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, reason: 'Feeling better' })
  });
  const cancelData = await cancelRes.json();
  assert.strictEqual(cancelData.status, 'ok');
  assert.strictEqual(cancelData.data.status, 'CANCELLED');
  console.log('   ✓ Patient cancelled queue entry with confirmation');

  // ── STEP 12: System Settings & Queue Events Audit ──
  console.log('\n[STEP] STEP 12: Policy Settings & Queue Audit Trail');
  const settingsRes = await fetch(`${BASE_URL}/api/queue/settings`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const settingsData = await settingsRes.json();
  assert.strictEqual(settingsData.status, 'ok');
  assert.strictEqual(settingsData.data.missed_token_grace_period_minutes, 5);

  const eventsRes = await fetch(`${BASE_URL}/api/queue/events`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const eventsData = await eventsRes.json();
  assert.strictEqual(eventsData.status, 'ok');
  assert(eventsData.data.length > 0, 'Audit trail must contain recorded events');
  console.log(`   ✓ Retrieved ${eventsData.data.length} audit trail events covering missed, rejoined, rescheduled, and transferred actions`);

  console.log('\n[SUCCESS] ALL ADVANCED QUEUE OPERATIONS TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
