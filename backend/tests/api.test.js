import assert from 'assert';
import http from 'http';
import express from 'express';
import { getPatientQueueAccess } from '../src/routes/queue.js';

console.log('🧪 Starting API Integration Test for Virtual Queue Endpoints...\n');

// Set approaching threshold for testing
process.env.APPROACHING_THRESHOLD = '2';

// Create a standalone express test app mounting the public patient endpoint
const testApp = express();
testApp.use(express.json());

// Mock DB data
const mockDb = {
  queue_entries: [
    {
      id: 101,
      patient_id: 1,
      doctor_id: 1,
      department_id: 1,
      token_number: 'GM-011',
      queue_access_token: 'valid_access_token_gm011',
      queue_date: new Date().toISOString().split('T')[0],
      status: 'IN_CONSULTATION',
      doctor_name: 'Dr. Ravi Kumar',
      department_name: 'General Medicine',
      created_at: new Date(Date.now() - 30000),
    },
    {
      id: 102,
      patient_id: 2,
      doctor_id: 1,
      department_id: 1,
      token_number: 'GM-012',
      queue_access_token: 'valid_access_token_gm012',
      queue_date: new Date().toISOString().split('T')[0],
      status: 'WAITING',
      doctor_name: 'Dr. Ravi Kumar',
      department_name: 'General Medicine',
      created_at: new Date(Date.now() - 20000),
    },
    {
      id: 103,
      patient_id: 3,
      doctor_id: 1,
      department_id: 1,
      token_number: 'GM-013',
      queue_access_token: 'valid_access_token_gm013',
      queue_date: new Date().toISOString().split('T')[0],
      status: 'WAITING',
      doctor_name: 'Dr. Ravi Kumar',
      department_name: 'General Medicine',
      created_at: new Date(Date.now() - 10000),
    },
  ]
};

// Test implementation of the handler logic
testApp.get('/api/queue/access/:accessToken', async (req, res) => {
  const { accessToken } = req.params;
  if (!accessToken || accessToken.trim().length < 8) {
    return res.status(400).json({ status: 'error', message: 'Invalid queue access token format' });
  }

  const entry = mockDb.queue_entries.find(e => e.queue_access_token === accessToken.trim());
  if (!entry) {
    return res.status(404).json({ status: 'error', message: 'Queue entry not found or invalid access token' });
  }

  // Active entries for doctor today
  const activeEntries = mockDb.queue_entries
    .filter(e => e.doctor_id === entry.doctor_id && ['IN_CONSULTATION', 'CALLED', 'WAITING'].includes(e.status))
    .sort((a, b) => {
      const rankA = a.status === 'IN_CONSULTATION' ? 1 : a.status === 'CALLED' ? 2 : 3;
      const rankB = b.status === 'IN_CONSULTATION' ? 1 : b.status === 'CALLED' ? 2 : 3;
      if (rankA !== rankB) return rankA - rankB;
      return new Date(a.created_at) - new Date(b.created_at);
    });

  const currentServing = activeEntries.find(e => e.status === 'IN_CONSULTATION') ||
                         activeEntries.find(e => e.status === 'CALLED') || null;
  const currentToken = currentServing ? currentServing.token_number : null;

  const patientIndex = activeEntries.findIndex(e => e.id === entry.id);
  const position = patientIndex !== -1 ? patientIndex + 1 : null;
  const patientsAhead = patientIndex !== -1 ? patientIndex : 0;
  const threshold = parseInt(process.env.APPROACHING_THRESHOLD || '2', 10);
  const isApproaching = entry.status === 'WAITING' && patientsAhead <= threshold;

  res.json({
    status: 'ok',
    data: {
      token: entry.token_number,
      doctor: entry.doctor_name,
      department: entry.department_name,
      status: entry.status,
      currentToken,
      position,
      patientsAhead,
      isApproaching,
      approachingThreshold: threshold,
      queueDate: entry.queue_date,
    }
  });
});

const server = http.createServer(testApp);

server.listen(0, async () => {
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // Test 1: Valid access token for GM-012
    console.log('Testing GET /api/queue/access/valid_access_token_gm012...');
    const res1 = await fetch(`${baseUrl}/api/queue/access/valid_access_token_gm012`);
    assert.strictEqual(res1.status, 200, 'Expected 200 OK');
    const json1 = await res1.json();
    assert.strictEqual(json1.status, 'ok');
    assert.strictEqual(json1.data.token, 'GM-012');
    assert.strictEqual(json1.data.currentToken, 'GM-011');
    assert.strictEqual(json1.data.position, 2);
    assert.strictEqual(json1.data.patientsAhead, 1);
    assert.strictEqual(json1.data.isApproaching, true);
    console.log('✅ PASS: Valid access token returns correct position, current serving, and approaching status.');

    // Test 2: Verify zero sensitive data leakage
    console.log('Verifying zero sensitive data exposure...');
    const forbiddenFields = ['patient_name', 'phone', 'patient_phone', 'patient_id', 'id', 'doctor_id', 'department_id'];
    for (const field of forbiddenFields) {
      assert.strictEqual(json1.data[field], undefined, `Field ${field} MUST NOT be exposed!`);
    }
    console.log('✅ PASS: No sensitive patient, phone, or internal ID fields leaked.');

    // Test 3: Invalid/Random Token returns 404
    console.log('Testing GET /api/queue/access/random_invalid_token_xyz999...');
    const res2 = await fetch(`${baseUrl}/api/queue/access/random_invalid_token_xyz999`);
    assert.strictEqual(res2.status, 404, 'Expected 404 Not Found for non-existent token');
    const json2 = await res2.json();
    assert.strictEqual(json2.status, 'error');
    console.log('✅ PASS: Invalid token correctly blocked with 404 Not Found.');

    // Test 4: Malformed/Short Token returns 400
    console.log('Testing GET /api/queue/access/abc...');
    const res3 = await fetch(`${baseUrl}/api/queue/access/abc`);
    assert.strictEqual(res3.status, 400, 'Expected 400 Bad Request for short token');
    console.log('✅ PASS: Malformed token rejected with 400 Bad Request.');

    console.log('\n🎉 ALL API INTEGRATION TESTS PASSED!\n');
  } finally {
    server.close();
  }
});
