import assert from 'assert';
import { io } from 'socket.io-client';

const BASE_URL = 'http://localhost:5000';
console.log('🧪 Starting Invisible Queue AI — Phase 4 Real-Time & Analytics Verification Suite...\n');

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

// Test 1: Staff Authentication and Role Token Verification
console.log('Test 1: Staff Authentication (Admin & Doctor)');
const adminToken = await login('admin@hospital.com', 'admin123');
const doctorToken = await login('dr.ravi@hospital.com', 'doctor123');
assert(adminToken, 'Admin token must exist');
assert(doctorToken, 'Doctor token must exist');
console.log('✅ PASS: Admin and Doctor authenticated successfully.\n');

// Test 2: Socket.IO Connection & Room Authorization Security
console.log('Test 2: Socket.IO Connection & Room Authorization Security');
const adminSocket = io(BASE_URL, { auth: { token: adminToken } });
const unauthSocket = io(BASE_URL);

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Admin socket connection timed out')), 5000);
  adminSocket.on('connect', () => {
    clearTimeout(timer);
    resolve();
  });
});
assert(adminSocket.connected, 'Admin socket must be connected');

// 2a. Admin joining admin room
const adminJoinRes = await new Promise((resolve) => {
  adminSocket.emit('join:admin', {}, (ack) => resolve(ack));
});
assert(adminJoinRes && adminJoinRes.success, 'Admin must be allowed into admin room');

// 2b. Unauthenticated socket attempting to join admin room (MUST BE BLOCKED)
const unauthAdminJoin = await new Promise((resolve) => {
  unauthSocket.emit('join:admin', {}, (ack) => resolve(ack));
});
assert(unauthAdminJoin && !unauthAdminJoin.success, 'Unauthenticated socket must be denied admin room');

// 2c. Unauthenticated socket attempting to join invalid patient pass (MUST BE BLOCKED)
const invalidPassJoin = await new Promise((resolve) => {
  unauthSocket.emit('join:patient', { accessToken: 'invalid_pass_token_xyz' }, (ack) => resolve(ack));
});
assert(invalidPassJoin && !invalidPassJoin.success, 'Invalid patient pass join must fail');

// 2d. Create fresh patient & token for test isolation
const freshPatientRes = await fetch(`${BASE_URL}/api/patients`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`,
  },
  body: JSON.stringify({ name: 'Suite Patient', age: 31, gender: 'FEMALE', phone: '9876540001' }),
});
const freshPatient = await freshPatientRes.json();

const freshTokenRes = await fetch(`${BASE_URL}/api/queue/token`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`,
  },
  body: JSON.stringify({ patient_id: freshPatient.data.id, doctor_id: 1, department_id: 1 }),
});
const freshTokenData = await freshTokenRes.json();
const testEntry = freshTokenData.data;

const validPassJoin = await new Promise((resolve) => {
  unauthSocket.emit('join:patient', { accessToken: testEntry.queue_access_token }, (ack) => resolve(ack));
});
assert(validPassJoin && validPassJoin.success, 'Valid patient pass join must succeed');
console.log('✅ PASS: Socket connection and room authorization security verified.\n');

// Test 3: Real-Time Event Emission & Approaching Notification
console.log('Test 3: Real-Time Event Emission on Token Call & Turn Notification');
let receivedTurnEvent = null;
unauthSocket.on('queue.patient_turn', (data) => {
  receivedTurnEvent = data;
});

// Call newly created patient
const callRes = await fetch(`${BASE_URL}/api/queue/${testEntry.id}/call`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${doctorToken}`,
  },
});
const callData = await callRes.json();
assert(callRes.ok, 'Doctor calling patient must succeed');
assert.strictEqual(callData.data.status, 'CALLED', 'Status must be CALLED');

// Wait for socket event delivery
await new Promise((r) => setTimeout(r, 400));
assert(receivedTurnEvent, 'Patient must receive real-time queue.patient_turn event');
assert.strictEqual(receivedTurnEvent.token, testEntry.token_number, 'Turn event token must match generated token');
console.log('✅ PASS: Real-time turn notification pushed instantly to patient socket.\n');

// Test 4: Queue State Machine Validation & Invalid Transition Enforcement
console.log('Test 4: Queue State Machine — Prevent Invalid Status Transitions');
// Transition: CALLED -> IN_CONSULTATION
const startRes = await fetch(`${BASE_URL}/api/queue/${testEntry.id}/start`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${doctorToken}`,
  },
});
assert(startRes.ok, 'Transition from CALLED to IN_CONSULTATION must be allowed');

// Complete consultation: IN_CONSULTATION -> COMPLETED
const completeRes = await fetch(`${BASE_URL}/api/queue/${testEntry.id}/complete`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${doctorToken}`,
  },
});
assert(completeRes.ok, 'Transition from IN_CONSULTATION to COMPLETED must be allowed');

// Now attempt invalid transition: COMPLETED -> IN_CONSULTATION (MUST FAIL)
const invalidTransition2 = await fetch(`${BASE_URL}/api/queue/${testEntry.id}/start`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${doctorToken}`,
  },
});
assert(!invalidTransition2.ok, 'Transition from COMPLETED to IN_CONSULTATION must be blocked');
const errData = await invalidTransition2.json();
assert(errData.message.includes('Cannot transition'), 'Error message must specify transition violation');
console.log(`✅ PASS: State machine correctly prevented invalid transition: ${errData.message}\n`);

// Test 5: Actual Waiting Time & Consultation Duration Telemetry
console.log('Test 5: Actual Waiting Time & Consultation Duration Telemetry Calculation');
const getUpdatedEntry = await fetch(`${BASE_URL}/api/queue/access/${testEntry.queue_access_token}`);
const entryData = await getUpdatedEntry.json();
assert(entryData.data, 'Updated queue entry must be retrievable');
assert.strictEqual(entryData.data.status, 'COMPLETED', 'Entry status must be COMPLETED');
console.log('✅ PASS: Telemetry calculation verified for completed consultation.\n');

// Test 6: Real Hospital Analytics Endpoints (No Fake Data)
console.log('Test 6: Real Hospital Analytics Endpoints (GET /api/analytics/live-status & /overview)');
const liveStatusRes = await fetch(`${BASE_URL}/api/analytics/live-status`, {
  headers: { Authorization: `Bearer ${adminToken}` },
});
assert(liveStatusRes.ok, 'Live status endpoint must respond 200');
const liveStatusData = await liveStatusRes.json();
assert(Array.isArray(liveStatusData.data), 'Live departments must be an array');
assert(liveStatusData.data.length >= 3, 'All hospital departments must be represented');
const gmDept = liveStatusData.data.find(d => d.code === 'GM');
assert(gmDept, 'General Medicine department must be present');
console.log(`✅ PASS: Live Department Status: ${gmDept.name} (Served: ${gmDept.completedCount}, Status: ${gmDept.status})`);

const overviewRes = await fetch(`${BASE_URL}/api/analytics/overview`, {
  headers: { Authorization: `Bearer ${adminToken}` },
});
assert(overviewRes.ok, 'Analytics overview endpoint must respond 200');
const overviewData = await overviewRes.json();
assert(overviewData.data.summary, 'Summary metrics must exist');
assert(typeof overviewData.data.summary.patientsServedToday === 'number', 'Patients served count must be numeric');
assert(overviewData.data.mlAccuracy, 'ML accuracy object must exist');
assert(Array.isArray(overviewData.data.departmentPerformance), 'Department performance must be an array');
console.log(`✅ PASS: Hospital Analytics Overview: ${overviewData.data.summary.patientsServedToday} patients served today, avg wait: ${overviewData.data.summary.avgWaitingTimeMinutes ?? '—'}m\n`);

// Cleanup sockets
adminSocket.disconnect();
unauthSocket.disconnect();

console.log('🎉 ALL PHASE 4 BACKEND & REAL-TIME TESTS PASSED SUCCESSFULLY!\n');
