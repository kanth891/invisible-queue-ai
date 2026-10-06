import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = '/usr/bin/google-chrome';
const BASE_URL = 'http://localhost:5173';
const BACKEND_URL = 'http://localhost:5000';
const ARTIFACTS_DIR = '/home/srikanth/.gemini/antigravity-ide/brain/40c7f7e3-15a4-495e-8bb8-a78764e7d9e8';

async function capture() {
  console.log('Capturing Luxury Obsidian MedTech screenshots...');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    // 1. Capture Login Portal Desktop & Mobile
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0', timeout: 15000 });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'luxury_login_desktop.png'), fullPage: false });
    console.log('Captured luxury_login_desktop.png');

    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'luxury_login_mobile.png'), fullPage: false });
    console.log('Captured luxury_login_mobile.png');

    // 2. Register a Patient to get an active token
    let accessToken = 'test-token';
    try {
      const recepLogin = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'receptionist1@hospital.com', password: 'recep123' })
      });
      const recepData = await recepLogin.json();
      const recepToken = recepData.data?.token;

      if (recepToken) {
        const patRes = await fetch(`${BACKEND_URL}/api/patients`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${recepToken}` },
          body: JSON.stringify({ name: 'Vikram Seth', age: 34, gender: 'MALE', phone: '9880011223' })
        });
        const patData = await patRes.json();
        const tokRes = await fetch(`${BACKEND_URL}/api/queue/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${recepToken}` },
          body: JSON.stringify({ patient_id: patData.data.id, doctor_id: 1, department_id: 1 })
        });
        const tokData = await tokRes.json();
        if (tokData.data?.queue_access_token) {
          accessToken = tokData.data.queue_access_token;
        }
      }
    } catch (e) {
      console.warn('Patient token fetch error:', e.message);
    }

    // 3. Patient Queue Pass Mobile & Desktop
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/queue/${accessToken}`, { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise(r => setTimeout(r, 800));
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'luxury_patient_mobile.png'), fullPage: false });
    console.log('Captured luxury_patient_mobile.png');

    await page.setViewport({ width: 1440, height: 900 });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'luxury_patient_desktop.png'), fullPage: false });
    console.log('Captured luxury_patient_desktop.png');

    // 4. Receptionist Dashboard
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      // Auto-fill receptionist button
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.includes('Receptionist'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 200));
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'luxury_receptionist_desktop.png'), fullPage: false });
    console.log('Captured luxury_receptionist_desktop.png');

    // 5. Doctor Dashboard
    const docPage = await browser.newPage();
    await docPage.setViewport({ width: 1440, height: 900 });
    await docPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
    await docPage.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await docPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
    await docPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.includes('Doctor') || b.textContent.includes('Ravi'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 400));
    await docPage.click('button[type="submit"]');
    await docPage.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));
    await docPage.screenshot({ path: path.join(ARTIFACTS_DIR, 'luxury_doctor_desktop.png'), fullPage: false });
    console.log('Captured luxury_doctor_desktop.png');

    // 6. Admin Dashboard
    const adminPage = await browser.newPage();
    await adminPage.setViewport({ width: 1440, height: 900 });
    await adminPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
    await adminPage.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await adminPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
    await adminPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.includes('Admin'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 400));
    await adminPage.click('button[type="submit"]');
    await adminPage.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));
    await adminPage.screenshot({ path: path.join(ARTIFACTS_DIR, 'luxury_admin_desktop.png'), fullPage: false });
    console.log('Captured luxury_admin_desktop.png');

    console.log('All luxury screenshots successfully captured.');
  } finally {
    await browser.close();
  }
}

capture().catch(err => {
  console.error('Capture failed:', err);
  process.exit(1);
});
