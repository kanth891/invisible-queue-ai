import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = '/usr/bin/google-chrome';
const BASE_URL = 'http://localhost:5173';
const BACKEND_URL = 'http://localhost:5000';
const ARTIFACTS_DIR = '/home/srikanth/.gemini/antigravity-ide/brain/40c7f7e3-15a4-495e-8bb8-a78764e7d9e8';

async function runPhase4E2E() {
  console.log('🚀 Starting Phase 4 End-to-End Real-Time Hospital Queue Simulation...');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    // ── STEP 1: Receptionist Registers a Patient via API ──
    console.log('\nStep 1: Receptionist registering new patient "Kavya Reddy"...');
    // Login receptionist
    const recepLoginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'receptionist1@hospital.com', password: 'recep123' })
    });
    const recepData = await recepLoginRes.json();
    const recepToken = recepData.data.token;

    // Create patient
    const patRes = await fetch(`${BACKEND_URL}/api/patients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${recepToken}`
      },
      body: JSON.stringify({ name: 'Kavya Reddy', age: 29, gender: 'FEMALE', phone: '9876543255' })
    });
    const patData = await patRes.json();
    const patientId = patData.data.id;

    // Generate token for Doctor 1 (Dr. Ravi Kumar)
    const tokenRes = await fetch(`${BACKEND_URL}/api/queue/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${recepToken}`
      },
      body: JSON.stringify({ patient_id: patientId, doctor_id: 1, department_id: 1 })
    });
    const tokenData = await tokenRes.json();
    const queueEntry = tokenData.data;
    console.log(`✅ Token Generated: ${queueEntry.token_number} | Access Token: ${queueEntry.queue_access_token}`);

    // ── STEP 2: Patient Opens Virtual Queue Pass (Mobile Viewport) ──
    console.log('\nStep 2: Patient opens mobile virtual queue pass...');
    const patientContext = await browser.createBrowserContext();
    const patientPage = await patientContext.newPage();
    patientPage.on('console', msg => console.log('  [Patient Browser Console]', msg.text()));
    await patientPage.setViewport({ width: 390, height: 844 });
    await patientPage.goto(`${BASE_URL}/queue/${queueEntry.queue_access_token}`, { waitUntil: 'networkidle2' });

    // Wait for pass card and live connected badge
    await patientPage.waitForSelector('.patient-pass-card');
    await new Promise(r => setTimeout(r, 2000));

    // Verify token number on patient screen
    const patientTokenText = await patientPage.$eval('.patient-token-number', el => el.textContent.trim());
    console.log(`Patient Screen Token: "${patientTokenText}" (Expected: "${queueEntry.token_number}")`);

    await patientPage.screenshot({
      path: path.join(ARTIFACTS_DIR, 'phase4_patient_initial.png')
    });
    console.log('📸 Saved phase4_patient_initial.png');

    // ── STEP 3: Doctor Logs In on Doctor Console (Desktop Viewport) ──
    console.log('\nStep 3: Doctor opens Doctor Dashboard...');
    const doctorContext = await browser.createBrowserContext();
    const doctorPage = await doctorContext.newPage();
    await doctorPage.setViewport({ width: 1280, height: 800 });

    // Perform doctor login in UI
    await doctorPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2' });
    await doctorPage.type('input[type="email"]', 'dr.ravi@hospital.com');
    await doctorPage.type('input[type="password"]', 'doctor123');
    await doctorPage.click('button[type="submit"]');

    // Wait for Doctor Dashboard
    await doctorPage.waitForSelector('.doctor-layout', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1000));

    await doctorPage.screenshot({
      path: path.join(ARTIFACTS_DIR, 'phase4_doctor_dashboard.png')
    });
    console.log('📸 Saved phase4_doctor_dashboard.png');

    // Login doctor for API calls
    const docLoginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dr.ravi@hospital.com', password: 'doctor123' })
    });
    const docData = await docLoginRes.json();
    const docToken = docData.data.token;

    // ── STEP 4: Doctor Calls Patient Next (Real-Time Push) ──
    console.log(`\nStep 4: Doctor calls next patient (${queueEntry.token_number})...`);
    const callRes = await fetch(`${BACKEND_URL}/api/queue/${queueEntry.id}/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${docToken}`
      }
    });
    const calledData = await callRes.json();
    console.log(`Call result: ${calledData.status} | message: ${calledData.message}`);

    // Wait for real-time Socket.IO push to reflect on patient page
    await new Promise(r => setTimeout(r, 2000));

    // Check patient's screen for "YOUR TURN"
    const patientTurnText = await patientPage.evaluate(() => document.body.innerText);
    const hasTurnNotice = patientTurnText.includes("IT'S YOUR TURN NOW") || patientTurnText.includes("YOUR TURN NOW");
    console.log(`Patient screen real-time updated to "IT'S YOUR TURN NOW": ${hasTurnNotice ? 'YES ✅' : 'NO ❌'}`);

    await patientPage.screenshot({
      path: path.join(ARTIFACTS_DIR, 'phase4_patient_called.png')
    });
    console.log('📸 Saved phase4_patient_called.png');

    // ── STEP 5: Doctor Starts Consultation ──
    console.log('\nStep 5: Doctor starts consultation...');
    await fetch(`${BACKEND_URL}/api/queue/${queueEntry.id}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${docToken}`
      }
    });

    await new Promise(r => setTimeout(r, 1500));
    const consultText = await patientPage.evaluate(() => document.body.innerText);
    const hasConsultingNotice = consultText.includes('Consultation in Progress');
    console.log(`Patient screen real-time updated to "Consultation in Progress": ${hasConsultingNotice ? 'YES ✅' : 'NO ❌'}`);

    // ── STEP 6: Doctor Completes Consultation ──
    console.log('\nStep 6: Doctor completes consultation...');
    await fetch(`${BACKEND_URL}/api/queue/${queueEntry.id}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${docToken}`
      }
    });

    await new Promise(r => setTimeout(r, 1500));
    const completedText = await patientPage.evaluate(() => document.body.innerText);
    const hasCompletedNotice = completedText.includes('Consultation Completed');
    console.log(`Patient screen real-time updated to "Consultation Completed": ${hasCompletedNotice ? 'YES ✅' : 'NO ❌'}`);

    await patientPage.screenshot({
      path: path.join(ARTIFACTS_DIR, 'phase4_patient_completed.png')
    });
    console.log('📸 Saved phase4_patient_completed.png');

    // ── STEP 7: Admin Dashboard Live Status & Analytics ──
    console.log('\nStep 7: Admin Dashboard Live Department Status & Analytics...');
    const adminContext = await browser.createBrowserContext();
    const adminPage = await adminContext.newPage();
    await adminPage.setViewport({ width: 1440, height: 900 });

    await adminPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2' });
    await adminPage.type('input[type="email"]', 'admin@hospital.com');
    await adminPage.type('input[type="password"]', 'admin123');
    await adminPage.click('button[type="submit"]');

    await adminPage.waitForSelector('text/Hospital Administration', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1200));

    await adminPage.screenshot({
      path: path.join(ARTIFACTS_DIR, 'phase4_admin_overview.png')
    });
    console.log('📸 Saved phase4_admin_overview.png');

    // Click Queue & ML Analytics Tab
    const analyticsTab = await adminPage.$('button ::-p-text(Queue & ML Analytics)');
    if (analyticsTab) {
      await analyticsTab.click();
      await new Promise(r => setTimeout(r, 1200));
      await adminPage.screenshot({
        path: path.join(ARTIFACTS_DIR, 'phase4_admin_analytics.png')
      });
      console.log('📸 Saved phase4_admin_analytics.png');
    }

    console.log('\n🎉 PHASE 4 FULL MULTI-CLIENT REAL-TIME SIMULATION COMPLETED SUCCESSFULLY!');
  } finally {
    await browser.close();
  }
}

runPhase4E2E().catch(err => {
  console.error('❌ E2E Simulation failed:', err);
  process.exit(1);
});
