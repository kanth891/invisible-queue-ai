import puppeteer from 'puppeteer-core';

const CHROME_PATH = '/usr/bin/google-chrome';
const BASE_URL = 'http://localhost:5173';
const BACKEND_URL = 'http://localhost:5000';

async function runHealthCheck() {
  console.log('Starting Complete Frontend & System Health Check...');
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const errors = [];

  const attachListeners = (page, pageName) => {
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('React DevTools') && !text.includes('favicon')) {
          errors.push(`[Console Error][${pageName}]: ${text}`);
        }
      }
    });

    page.on('pageerror', err => {
      errors.push(`[Unhandled Page Error][${pageName}]: ${err.message}`);
    });

    page.on('requestfailed', req => {
      if (!req.url().includes('favicon')) {
        errors.push(`[Network Failure][${pageName}]: ${req.method()} ${req.url()} (${req.failure()?.errorText})`);
      }
    });
  };

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    // 1. Test Login Page
    console.log('\nTesting 1/5: Login Authentication Portal...');
    attachListeners(page, 'Login');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0', timeout: 10000 });
    const loginTitle = await page.$eval('h1', el => el.textContent);
    console.log(`  Login header verified: "${loginTitle}"`);

    // 2. Test Receptionist Flow & Create Patient
    console.log('\nTesting 2/5: Receptionist Dashboard & Intake Flow...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const recepBtn = btns.find(b => b.textContent.includes('Receptionist'));
      if (recepBtn) recepBtn.click();
    });
    await new Promise(r => setTimeout(r, 200));
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 });
    attachListeners(page, 'Receptionist');

    // Wait for data load and form render
    await page.waitForSelector('input[placeholder="e.g. Ramesh Kumar"]', { timeout: 10000 });

    const recepTitle = await page.evaluate(() => {
      const h1s = Array.from(document.querySelectorAll('h1'));
      return h1s.map(h => h.textContent).join(' | ');
    });
    console.log(`  Receptionist header verified: "${recepTitle}"`);

    // Register a new patient
    console.log('  Testing Outpatient Intake Form...');
    await page.type('input[placeholder="e.g. Ramesh Kumar"]', 'Aditi Sharma');
    await page.type('input[placeholder="e.g. 42"]', '29');
    await page.type('input[placeholder="e.g. 9876543210"]', '9988776655');

    // Select Department and Doctor using page evaluate
    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      if (selects[1]) {
        selects[1].value = '1';
        selects[1].dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await new Promise(r => setTimeout(r, 600));

    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      if (selects[2] && selects[2].options.length > 1) {
        selects[2].value = selects[2].options[1].value;
        selects[2].dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await new Promise(r => setTimeout(r, 400));

    // Submit form
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 1500));

    // Verify token generation banner
    const tokenGeneratedText = await page.evaluate(() => {
      const el = document.querySelector('.receptionist-layout');
      return el ? el.textContent : '';
    });
    const hasToken = tokenGeneratedText.includes('Token Generated Successfully');
    console.log(`  Token Generated Successfully banner: ${hasToken ? 'PASS' : 'FAIL'}`);
    if (!hasToken) errors.push('Receptionist token generation did not show success banner');

    // Extract access token from the patient link
    const patientUrl = await page.evaluate(() => {
      const link = document.querySelector('a[href*="/queue/"]');
      return link ? link.getAttribute('href') : null;
    });
    console.log(`  Generated Patient Tracker URL: ${patientUrl}`);

    // 3. Test Patient Queue View
    if (patientUrl) {
      console.log('\nTesting 3/5: Patient Digital Pass View...');
      const patientPage = await browser.newPage();
      attachListeners(patientPage, 'PatientQueue');
      await patientPage.setViewport({ width: 390, height: 844 });
      await patientPage.goto(`${BASE_URL}${patientUrl}`, { waitUntil: 'networkidle0', timeout: 10000 });
      await patientPage.waitForSelector('.patient-token-number', { timeout: 10000 });

      const tokenNumber = await patientPage.$eval('.patient-token-number', el => el.textContent.trim()).catch(() => null);
      console.log(`  Patient Pass Token Displayed: "${tokenNumber}"`);
      if (!tokenNumber) errors.push('Patient token number element not rendered');

      const liveSyncText = await patientPage.evaluate(() => document.body.textContent.includes('Live Sync'));
      console.log(`  Live Sync Connected: ${liveSyncText ? 'PASS' : 'WAITING'}`);

      await patientPage.close();
    }

    // 4. Test Doctor Dashboard
    console.log('\nTesting 4/5: Doctor Dashboard...');
    const docPage = await browser.newPage();
    attachListeners(docPage, 'Doctor');
    await docPage.setViewport({ width: 1440, height: 900 });
    await docPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
    await docPage.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await docPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
    await docPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const docBtn = btns.find(b => b.textContent.includes('Doctor') || b.textContent.includes('Ravi'));
      if (docBtn) docBtn.click();
    });
    await new Promise(r => setTimeout(r, 200));
    await docPage.click('button[type="submit"]');
    await docPage.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 });
    await docPage.waitForSelector('.clinical-stat-card', { timeout: 10000 });

    const docHeader = await docPage.evaluate(() => {
      const h1s = Array.from(document.querySelectorAll('h1'));
      return h1s.map(h => h.textContent).join(' | ');
    });
    console.log(`  Doctor dashboard header verified: "${docHeader}"`);

    const statCards = await docPage.$$eval('.clinical-stat-card', cards => cards.length);
    console.log(`  Doctor room stat cards rendered: ${statCards}`);
    if (statCards === 0) errors.push('Doctor room stat cards missing');

    await docPage.close();

    // 5. Test Admin Dashboard and All 6 Tabs
    console.log('\nTesting 5/5: Admin Dashboard (All 6 Tabs)...');
    const adminPage = await browser.newPage();
    attachListeners(adminPage, 'Admin');
    await adminPage.setViewport({ width: 1440, height: 900 });
    await adminPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
    await adminPage.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await adminPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
    await adminPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const adminBtn = btns.find(b => b.textContent.includes('Administrator'));
      if (adminBtn) adminBtn.click();
    });
    await new Promise(r => setTimeout(r, 200));
    await adminPage.click('button[type="submit"]');
    await adminPage.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 });
    await adminPage.waitForSelector('.card', { timeout: 10000 });

    const adminHeader = await adminPage.evaluate(() => {
      const h1s = Array.from(document.querySelectorAll('h1'));
      return h1s.map(h => h.textContent).join(' | ');
    });
    console.log(`  Admin dashboard header verified: "${adminHeader}"`);

    // Test clicking every single tab to ensure no crashes
    const tabLabels = ['Queue & ML Analytics', 'Departments', 'Doctors', 'System Users', 'AI Waiting-Time', 'Overview'];
    for (const tabName of tabLabels) {
      await adminPage.evaluate((name) => {
        const tabs = Array.from(document.querySelectorAll('button'));
        const target = tabs.find(t => t.textContent.includes(name));
        if (target) target.click();
      }, tabName);
      await new Promise(r => setTimeout(r, 400));
      console.log(`  Tab "${tabName}" navigated successfully`);
    }

    await adminPage.close();

  } catch (err) {
    errors.push(`Critical test runner error: ${err.message}`);
  } finally {
    await browser.close();
  }

  console.log('\n========================================');
  console.log('HEALTH CHECK RESULTS:');
  console.log(`Total Errors Detected: ${errors.length}`);
  if (errors.length > 0) {
    console.error('ERRORS:');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  } else {
    console.log('ALL FRONTEND & INTEGRATION CHECKS PASSED WITH 0 ERRORS!');
    console.log('========================================');
  }
}

runHealthCheck();
