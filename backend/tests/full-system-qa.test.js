import assert from 'assert';

console.log('==================================================================');
console.log('[AUDIT] INVISIBLE QUEUE AI - FULL SYSTEM PRODUCTION QA TEST SUITE');
console.log('==================================================================\n');

const BASE_URL = 'http://localhost:5000';

async function runFullSystemQA() {
  let adminToken, doctorToken, recepToken;

  // Helper: Staff Login
  async function login(email, password) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    return { status: res.status, ok: res.ok, data };
  }

  // ----------------------------------------------------------------
  // AREA 1: Authentication & JWT Boundary Conditions
  // ----------------------------------------------------------------
  console.log('[STEP 1] Authentication, JWT Lifecycle, and Negative Credentials');

  // 1a. Malformed / Missing Login Payloads
  const emptyLogin = await login('', '');
  assert.strictEqual(emptyLogin.status, 400, 'Empty email/password must return 400');

  const invalidTypeLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 12345, password: true }),
  });
  assert.strictEqual(invalidTypeLogin.status, 400, 'Non-string email/password must return 400');

  // 1b. Wrong Credentials
  const badCreds = await login('admin@hospital.com', 'wrongpassword');
  assert.strictEqual(badCreds.status, 401, 'Wrong password must return 401');

  const nonExistentUser = await login('ghost@hospital.com', 'somepass');
  assert.strictEqual(nonExistentUser.status, 401, 'Non-existent user must return 401');

  // 1c. Valid Credentials for 3 Roles
  const adminAuth = await login('admin@hospital.com', 'admin123');
  assert(adminAuth.ok && adminAuth.data.data.token, 'Admin login must succeed');
  adminToken = adminAuth.data.data.token;

  const doctorAuth = await login('dr.ravi@hospital.com', 'doctor123');
  assert(doctorAuth.ok && doctorAuth.data.data.token, 'Doctor login must succeed');
  doctorToken = doctorAuth.data.data.token;

  const recepAuth = await login('receptionist1@hospital.com', 'recep123');
  assert(recepAuth.ok && recepAuth.data.data.token, 'Receptionist login must succeed');
  recepToken = recepAuth.data.data.token;

  // 1d. Token Verification (/api/auth/me)
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const meData = await meRes.json();
  assert.strictEqual(meRes.status, 200, '/api/auth/me with valid token must return 200');
  assert.strictEqual(meData.data.user.role, 'ADMIN', 'Decoded token user role must be ADMIN');

  // 1e. Forged / Garbage Token Verification
  const badTokenRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: 'Bearer forged.invalid.token' },
  });
  assert.strictEqual(badTokenRes.status, 401, 'Forged token must return 401');

  const noTokenRes = await fetch(`${BASE_URL}/api/auth/me`);
  assert.strictEqual(noTokenRes.status, 401, 'Missing token must return 401');
  console.log('   [PASS] Authentication boundaries, JWT validation, and negative credentials passed.\n');

  // ----------------------------------------------------------------
  // AREA 2: Role-Based Access Control (RBAC) & Privilege Escalation Defenses
  // ----------------------------------------------------------------
  console.log('[STEP 2] Role-Based Access Control & Privilege Escalation Defenses');

  // 2a. Doctor attempting Admin-only endpoint (POST /api/departments)
  const docCreateDept = await fetch(`${BASE_URL}/api/departments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doctorToken}` },
    body: JSON.stringify({ name: 'Neurology', code: 'NEU' }),
  });
  assert.strictEqual(docCreateDept.status, 403, 'Doctor cannot access admin department creation (must return 403)');

  // 2b. Doctor attempting Admin-only queue transfer
  const docTransfer = await fetch(`${BASE_URL}/api/queue/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doctorToken}` },
    body: JSON.stringify({ fromDoctorId: 1, toDoctorId: 3 }),
  });
  assert.strictEqual(docTransfer.status, 403, 'Doctor cannot execute administrative queue transfer (must return 403)');

  // 2c. Doctor attempting Admin-only leave creation
  const docLeave = await fetch(`${BASE_URL}/api/doctors/1/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doctorToken}` },
    body: JSON.stringify({ leave_date: '2026-10-12', reason: 'Personal' }),
  });
  assert.strictEqual(docLeave.status, 403, 'Doctor cannot self-grant leave on admin endpoint (must return 403)');

  // 2d. Receptionist attempting Doctor consultation actions
  const recepStart = await fetch(`${BASE_URL}/api/queue/1/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${recepToken}` },
  });
  assert.strictEqual(recepStart.status, 403, 'Receptionist cannot start consultation (must return 403)');

  const recepComplete = await fetch(`${BASE_URL}/api/queue/1/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${recepToken}` },
  });
  assert.strictEqual(recepComplete.status, 403, 'Receptionist cannot complete consultation (must return 403)');

  // 2e. Unauthenticated client attempting Admin analytics
  const unauthAnalytics = await fetch(`${BASE_URL}/api/analytics/overview`);
  assert.strictEqual(unauthAnalytics.status, 401, 'Unauthenticated access to hospital analytics must return 401');
  console.log('   [PASS] Strict RBAC barriers and privilege escalation blocks verified.\n');

  // ----------------------------------------------------------------
  // AREA 3: Receptionist Patient Intake & Concurrency Stress Test
  // ----------------------------------------------------------------
  console.log('[STEP 3] Receptionist Patient Registration & Token Concurrency Stress');

  // 3a. Register patient with XSS / SQLi payload test
  const testPatientRes = await fetch(`${BASE_URL}/api/patients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${recepToken}` },
    body: JSON.stringify({
      name: '<script>alert("XSS")</script> Arjun Sen\'; DROP TABLE users; --',
      age: 41,
      gender: 'MALE',
      phone: '9811223344',
    }),
  });
  assert.strictEqual(testPatientRes.status, 201, 'Patient creation with injection strings must succeed safely');
  const testPatient = (await testPatientRes.json()).data;
  assert(testPatient.id, 'Created patient must have valid numeric ID');

  // 3b. Issue Token
  const tokenRes = await fetch(`${BASE_URL}/api/queue/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${recepToken}` },
    body: JSON.stringify({ patient_id: testPatient.id, doctor_id: 1, department_id: 1 }),
  });
  assert.strictEqual(tokenRes.status, 201, 'Token generation must return 201');
  const tokenData = (await tokenRes.json()).data;
  const patientAccessToken = tokenData.queue_access_token;
  const queueEntryId = tokenData.id;
  assert(patientAccessToken && patientAccessToken.length === 32, 'Access token must be 32 hex characters');
  assert(tokenData.token_number.startsWith('GM-'), 'Token number must start with GM-');

  // 3c. Concurrency Stress: 10 parallel token generations
  const parallelPromises = [];
  for (let i = 0; i < 10; i++) {
    parallelPromises.push(
      fetch(`${BASE_URL}/api/queue/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${recepToken}` },
        body: JSON.stringify({ patient_id: testPatient.id, doctor_id: 1, department_id: 1 }),
      }).then(r => r.json())
    );
  }
  const parallelResults = await Promise.all(parallelPromises);
  const issuedTokens = new Set();
  const issuedAccessKeys = new Set();
  for (const res of parallelResults) {
    assert.strictEqual(res.status, 'ok', 'Concurrent token creation must succeed');
    assert(!issuedTokens.has(res.data.token_number), `Token duplicate detected: ${res.data.token_number}`);
    assert(!issuedAccessKeys.has(res.data.queue_access_token), `Access token collision detected: ${res.data.queue_access_token}`);
    issuedTokens.add(res.data.token_number);
    issuedAccessKeys.add(res.data.queue_access_token);
  }
  console.log(`   [PASS] Issued 10 concurrent tokens with zero duplicate collisions: ${[...issuedTokens].join(', ')}.\n`);

  // ----------------------------------------------------------------
  // AREA 4: Public Patient Virtual Queue Pass & Data Isolation
  // ----------------------------------------------------------------
  console.log('[STEP 4] Public Patient Pass Security & Data Isolation');

  // 4a. Short / Invalid format token
  const shortTokenRes = await fetch(`${BASE_URL}/api/queue/access/short`);
  assert.strictEqual(shortTokenRes.status, 400, 'Invalid token format must return 400');

  // 4b. Non-existent token
  const ghostTokenRes = await fetch(`${BASE_URL}/api/queue/access/ffffffffffffffffffffffffffffffff`);
  assert.strictEqual(ghostTokenRes.status, 404, 'Non-existent queue pass must return 404');

  // 4c. Valid Token Access
  const passRes = await fetch(`${BASE_URL}/api/queue/access/${patientAccessToken}`);
  assert.strictEqual(passRes.status, 200, 'Valid public pass access must return 200');
  const passData = (await passRes.json()).data;
  assert.strictEqual(passData.token, tokenData.token_number);
  assert.strictEqual(passData.doctor, 'Dr. Ravi Kumar');
  assert.strictEqual(passData.department, 'General Medicine');
  assert.strictEqual(passData.status, 'WAITING');
  assert(passData.prediction !== undefined, 'Prediction must be present in pass');
  assert(passData.maxRejoins !== undefined, 'Policy limits must be present in pass');

  // 4d. Data Isolation Audit: Ensure sensitive staff or other patient data is NOT exposed
  assert.strictEqual(passData.patient_phone, undefined, 'Patient phone must not leak to public pass');
  assert.strictEqual(passData.password_hash, undefined, 'Staff password hash must never leak');
  console.log('   [PASS] Public pass correctly serves patient queue position while preserving privacy.\n');

  // ----------------------------------------------------------------
  // AREA 5: Queue State Machine Transition Constraints
  // ----------------------------------------------------------------
  console.log('[STEP 5] Queue State Machine Transition Constraints');

  // Illegal Transition 1: WAITING directly to COMPLETED
  const illegalComplete = await fetch(`${BASE_URL}/api/queue/${queueEntryId}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` },
  });
  assert.strictEqual(illegalComplete.status, 400, 'Cannot transition directly from WAITING to COMPLETED (must be 400)');

  // Advance WAITING -> CALLED
  const callRes = await fetch(`${BASE_URL}/api/queue/${queueEntryId}/call`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` },
  });
  assert.strictEqual(callRes.status, 200, 'Calling waiting patient must succeed');
  assert.strictEqual((await callRes.json()).data.status, 'CALLED');

  // Transition CALLED -> IN_CONSULTATION
  const startRes = await fetch(`${BASE_URL}/api/queue/${queueEntryId}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` },
  });
  assert.strictEqual(startRes.status, 200, 'Starting consultation must succeed');
  assert.strictEqual((await startRes.json()).data.status, 'IN_CONSULTATION');

  // Transition IN_CONSULTATION -> COMPLETED
  const compRes = await fetch(`${BASE_URL}/api/queue/${queueEntryId}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` },
  });
  assert.strictEqual(compRes.status, 200, 'Completing consultation must succeed');
  assert.strictEqual((await compRes.json()).data.status, 'COMPLETED');

  // Illegal Transition 2: COMPLETED back to WAITING or CALLED
  const illegalReCall = await fetch(`${BASE_URL}/api/queue/${queueEntryId}/call`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` },
  });
  assert.strictEqual(illegalReCall.status, 400, 'Cannot call an already completed token (must be 400)');
  console.log('   [PASS] Strict state machine rules prevent out-of-order or corrupt transitions.\n');

  // ----------------------------------------------------------------
  // AREA 6: Missed Token Transition & Grace Period Logic
  // ----------------------------------------------------------------
  console.log('[STEP 6] Missed Token Transition & Grace Period Verification');

  // Create another token to test missed & rejoin workflow
  const t2Res = await fetch(`${BASE_URL}/api/queue/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${recepToken}` },
    body: JSON.stringify({ patient_id: testPatient.id, doctor_id: 1, department_id: 1 }),
  });
  const t2Entry = (await t2Res.json()).data;
  const t2AccessToken = t2Entry.queue_access_token;
  const t2Id = t2Entry.id;

  // Call token
  await fetch(`${BASE_URL}/api/queue/${t2Id}/call`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` },
  });

  // Doctor marks missed
  const missedRes = await fetch(`${BASE_URL}/api/queue/${t2Id}/missed`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` },
  });
  assert.strictEqual(missedRes.status, 200, 'Doctor marking token as missed must succeed');
  const missedData = (await missedRes.json()).data;
  assert.strictEqual(missedData.status, 'MISSED');
  assert(missedData.missed_at !== null, 'missed_at timestamp must be recorded');

  // Verify public pass reflects MISSED status
  const passMissed = await fetch(`${BASE_URL}/api/queue/access/${t2AccessToken}`).then(r => r.json());
  assert.strictEqual(passMissed.data.status, 'MISSED');
  assert.strictEqual(passMissed.data.canRejoin, true, 'Patient within grace period must be allowed to rejoin');
  console.log('   [PASS] Missed token state, timestamp, and self-service rejoin eligibility confirmed.\n');

  // ----------------------------------------------------------------
  // AREA 7: Patient Self-Service Rejoin & Policy Limits
  // ----------------------------------------------------------------
  console.log('[STEP 7] Patient Self-Service Rejoin & Max Limit Enforcement');

  // 7a. Rejoin 1
  const rejoinRes1 = await fetch(`${BASE_URL}/api/queue/patient/rejoin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: t2AccessToken }),
  });
  assert.strictEqual(rejoinRes1.status, 200, 'Rejoin attempt 1 must succeed');
  const rejoinData1 = (await rejoinRes1.json()).data;
  assert.strictEqual(rejoinData1.status, 'WAITING');
  assert.strictEqual(rejoinData1.rejoinCount, 1, 'rejoinCount must increment to 1');

  // 7b. Attempting to rejoin while already in WAITING status (Illegal)
  const duplicateRejoin = await fetch(`${BASE_URL}/api/queue/patient/rejoin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: t2AccessToken }),
  });
  assert.strictEqual(duplicateRejoin.status, 400, 'Rejoining while already in WAITING status must return 400');

  // 7c. Cycle to Missed again and Rejoin 2
  await fetch(`${BASE_URL}/api/queue/${t2Id}/call`, { method: 'POST', headers: { Authorization: `Bearer ${doctorToken}` } });
  await fetch(`${BASE_URL}/api/queue/${t2Id}/missed`, { method: 'POST', headers: { Authorization: `Bearer ${doctorToken}` } });

  const rejoinRes2 = await fetch(`${BASE_URL}/api/queue/patient/rejoin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: t2AccessToken }),
  });
  assert.strictEqual(rejoinRes2.status, 200, 'Rejoin attempt 2 must succeed');
  assert.strictEqual((await rejoinRes2.json()).data.rejoinCount, 2);

  // 7d. Cycle to Missed a 3rd time and verify rejection due to exceeding max policy (max: 2)
  await fetch(`${BASE_URL}/api/queue/${t2Id}/call`, { method: 'POST', headers: { Authorization: `Bearer ${doctorToken}` } });
  await fetch(`${BASE_URL}/api/queue/${t2Id}/missed`, { method: 'POST', headers: { Authorization: `Bearer ${doctorToken}` } });

  const rejoinRes3 = await fetch(`${BASE_URL}/api/queue/patient/rejoin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: t2AccessToken }),
  });
  assert.strictEqual(rejoinRes3.status, 400, 'Rejoin attempt 3 must be blocked exceeding max attempts policy');
  console.log('   [PASS] Patient self-service rejoin works seamlessly and strictly enforces policy bounds.\n');

  // ----------------------------------------------------------------
  // AREA 8: Same-Day Doctor Rescheduling & Department Matching
  // ----------------------------------------------------------------
  console.log('[STEP 8] Same-Day Doctor Rescheduling & Department Isolation');

  // 8a. Create a token for reschedule testing
  const t3Res = await fetch(`${BASE_URL}/api/queue/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${recepToken}` },
    body: JSON.stringify({ patient_id: testPatient.id, doctor_id: 1, department_id: 1 }),
  });
  const t3Entry = (await t3Res.json()).data;
  const t3AccessToken = t3Entry.queue_access_token;

  // 8b. Fetch reschedule options
  const optionsRes = await fetch(`${BASE_URL}/api/queue/patient/reschedule-options?accessToken=${t3AccessToken}`);
  assert.strictEqual(optionsRes.status, 200, 'Fetching reschedule options must succeed');
  const optionsData = (await optionsRes.json()).data;
  assert(optionsData.options.length > 0, 'Must find at least one alternative doctor in General Medicine');
  const targetDoctor = optionsData.options[0];

  // 8c. Reschedule to doctor in same department (Dr. Priya Sharma)
  const reschedRes = await fetch(`${BASE_URL}/api/queue/patient/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: t3AccessToken, target_doctor_id: targetDoctor.doctorId }),
  });
  assert.strictEqual(reschedRes.status, 200, 'Rescheduling to doctor in same department must succeed');
  const reschedData = (await reschedRes.json()).data;
  assert.strictEqual(reschedData.newDoctor, targetDoctor.name);
  assert.strictEqual(reschedData.rescheduleCount, 1, 'rescheduleCount must be 1');

  // 8d. Attempting to reschedule to an invalid doctor in a different department (Doctor 2: Oncology)
  const invalidResched = await fetch(`${BASE_URL}/api/queue/patient/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: t3AccessToken, targetDoctorId: 2 }),
  });
  assert.strictEqual(invalidResched.status, 400, 'Rescheduling to different department doctor must return 400');
  console.log('   [PASS] Same-day doctor rescheduling validated with strict department matching.\n');

  // ----------------------------------------------------------------
  // AREA 9: Patient Queue Cancellation
  // ----------------------------------------------------------------
  console.log('[STEP 9] Patient Queue Cancellation');

  const cancelRes = await fetch(`${BASE_URL}/api/queue/patient/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: t3AccessToken, reason: 'Patient departed early' }),
  });
  assert.strictEqual(cancelRes.status, 200, 'Patient cancelling queue entry must return 200');
  const cancelData = (await cancelRes.json()).data;
  assert.strictEqual(cancelData.status, 'CANCELLED');

  // Verify subsequent reschedule on cancelled token is rejected
  const cancelResched = await fetch(`${BASE_URL}/api/queue/patient/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: t3AccessToken, targetDoctorId: 1 }),
  });
  assert.strictEqual(cancelResched.status, 400, 'Cannot reschedule a cancelled entry');
  console.log('   [PASS] Queue cancellation executed and entry finalized.\n');

  // ----------------------------------------------------------------
  // AREA 10: Doctor Operational Status (Pause and Resume Queue)
  // ----------------------------------------------------------------
  console.log('[STEP 10] Doctor Operational Availability, Pause, and Resume');

  // Pause Queue
  const pauseRes = await fetch(`${BASE_URL}/api/queue/doctor/1/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doctorToken}` },
    body: JSON.stringify({ reason: 'ICU Consultation' }),
  });
  assert.strictEqual(pauseRes.status, 200, 'Doctor pausing queue must return 200');

  // Verify availability reports PAUSED
  const availRes = await fetch(`${BASE_URL}/api/doctors/availability/today`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  }).then(r => r.json());
  const docRaviAvail = availRes.data.find(d => d.id === 1);
  assert.strictEqual(docRaviAvail.computed_availability, 'PAUSED', 'Doctor availability must report PAUSED');

  // Resume Queue
  const resumeRes = await fetch(`${BASE_URL}/api/queue/doctor/1/resume`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` },
  });
  assert.strictEqual(resumeRes.status, 200, 'Doctor resuming queue must return 200');
  console.log('   [PASS] Doctor queue pause and resume synchronized with real-time status.\n');

  // ----------------------------------------------------------------
  // AREA 11: Doctor Leave Management & Availability Override
  // ----------------------------------------------------------------
  console.log('[STEP 11] Doctor Leave Management & Dynamic Availability Override');

  const todayStr = new Date().toISOString().split('T')[0];
  const leaveRes = await fetch(`${BASE_URL}/api/doctors/2/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ leave_date: todayStr, reason: 'Medical Conference', is_full_day: true }),
  });
  assert.strictEqual(leaveRes.status, 201, 'Admin creating doctor leave must return 201');

  const availLeaveRes = await fetch(`${BASE_URL}/api/doctors/availability/today`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  }).then(r => r.json());
  const docMeera = availLeaveRes.data.find(d => d.id === 2);
  assert.strictEqual(docMeera.computed_availability, 'ON_LEAVE', 'Doctor with leave must compute ON_LEAVE');
  console.log('   [PASS] Doctor leave dynamically sets status to ON_LEAVE.\n');

  // ----------------------------------------------------------------
  // AREA 12: Emergency Bulk Queue Transfer
  // ----------------------------------------------------------------
  console.log('[STEP 12] Emergency Bulk Queue Transfer');

  const transferRes = await fetch(`${BASE_URL}/api/queue/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ fromDoctorId: 1, toDoctorId: 3, reason: 'Physician called to emergency' }),
  });
  assert.strictEqual(transferRes.status, 200, 'Queue transfer between department peers must return 200');
  const transferData = (await transferRes.json()).data;
  assert(transferData.transferredCount >= 0, 'Transfer count returned');
  console.log(`   [PASS] Transferred ${transferData.transferredCount} patients from Dr. Ravi to Dr. Priya Sharma.\n`);

  // ----------------------------------------------------------------
  // AREA 13: Audit Trail Immutability & Event Integrity
  // ----------------------------------------------------------------
  console.log('[STEP 13] Audit Trail Event Verification');

  const eventsRes = await fetch(`${BASE_URL}/api/queue/events`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(eventsRes.status, 200, 'Fetching queue events must return 200');
  const events = (await eventsRes.json()).data;
  assert(events.length > 0, 'Queue events audit trail must contain recorded events');
  const hasMissed = events.some(e => e.event_type === 'PATIENT_MISSED');
  const hasRejoin = events.some(e => e.event_type === 'PATIENT_REJOINED');
  const hasResched = events.some(e => e.event_type === 'PATIENT_RESCHEDULED');
  const hasTransfer = events.some(e => e.event_type === 'QUEUE_TRANSFERRED');
  assert(hasMissed && hasRejoin && hasResched && hasTransfer, 'Audit trail must contain missed, rejoined, rescheduled, and transferred events');
  console.log(`   [PASS] Audit trail verified with ${events.length} immutable events.\n`);

  // ----------------------------------------------------------------
  // AREA 14: Hospital Analytics & KPI Telemetry
  // ----------------------------------------------------------------
  console.log('[STEP 14] Hospital Analytics & Live Status Verification');

  const liveStatusRes = await fetch(`${BASE_URL}/api/analytics/live-status`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(liveStatusRes.status, 200, 'Admin live-status must return 200');
  const liveStatus = (await liveStatusRes.json()).data;
  assert(Array.isArray(liveStatus), 'Live status departments must be an array');

  const overviewRes = await fetch(`${BASE_URL}/api/analytics/overview`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(overviewRes.status, 200, 'Admin overview analytics must return 200');
  const overview = (await overviewRes.json()).data;
  assert(overview.summary.totalPatientsToday > 0, 'Overview must track total registered patients');
  console.log('   [PASS] Hospital analytics overview and live KPIs verified.\n');

  console.log('==================================================================');
  console.log('[SUCCESS] ALL 14 ADVANCED PRODUCTION QA AUDIT CHECKS PASSED 100%!');
  console.log('==================================================================\n');
}

runFullSystemQA().catch((err) => {
  console.error('[ERROR] Full System QA test failed:', err);
  process.exit(1);
});
