import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = '/usr/bin/google-chrome';
const BASE_URL = 'http://localhost:5173';
const ARTIFACTS_DIR = '/home/srikanth/.gemini/antigravity-ide/brain/40c7f7e3-15a4-495e-8bb8-a78764e7d9e8';

const VIEWPORTS = [
  // Mobile Portrait
  { name: 'Mobile 320x568 (iPhone SE 1st)', width: 320, height: 568 },
  { name: 'Mobile 360x800 (Android Common)', width: 360, height: 800 },
  { name: 'Mobile 375x667 (iPhone SE/8)', width: 375, height: 667 },
  { name: 'Mobile 390x844 (iPhone 12/13/14)', width: 390, height: 844 },
  { name: 'Mobile 393x873 (Pixel 7)', width: 393, height: 873 },
  { name: 'Mobile 412x915 (Galaxy S20/Pixel)', width: 412, height: 915 },
  { name: 'Mobile 430x932 (iPhone 14/15 Pro Max)', width: 430, height: 932 },

  // Landscape Mobile
  { name: 'Landscape 667x375 (iPhone Landscape)', width: 667, height: 375 },
  { name: 'Landscape 844x390 (iPhone 12 Landscape)', width: 844, height: 390 },
  { name: 'Landscape 915x412 (Android Landscape)', width: 915, height: 412 },

  // Tablet
  { name: 'Tablet 768x1024 (iPad Portrait)', width: 768, height: 1024 },
  { name: 'Tablet 820x1180 (iPad Air)', width: 820, height: 1180 },
  { name: 'Tablet 1024x768 (iPad Landscape)', width: 1024, height: 768 },

  // Laptop
  { name: 'Laptop 1280x720 (HD Laptop)', width: 1280, height: 720 },
  { name: 'Laptop 1366x768 (Standard Laptop)', width: 1366, height: 768 },
  { name: 'Laptop 1440x900 (MacBook Pro 15)', width: 1440, height: 900 },

  // Desktop
  { name: 'Desktop 1600x900', width: 1600, height: 900 },
  { name: 'Desktop 1920x1080 (FHD Desktop)', width: 1920, height: 1080 }
];

async function runAudit() {
  console.log('🚀 Starting Comprehensive Responsive UI/UX Viewport Audit...');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080']
  });

  const page = await browser.newPage();
  const results = [];
  let totalFailures = 0;

  // Helper to test a page at all viewports
  async function auditUrl(url, pageTitle, screenshotKey = null) {
    console.log(`\n📋 Auditing: ${pageTitle} (${url})`);
    for (const vp of VIEWPORTS) {
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
      // Allow React state & polling to settle
      await new Promise(r => setTimeout(r, 600));

      // Measure document dimensions vs viewport
      const dimensions = await page.evaluate(() => {
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
          bodyScrollWidth: document.body.scrollWidth
        };
      });

      const hasHorizontalScroll = dimensions.scrollWidth > dimensions.innerWidth;
      const status = hasHorizontalScroll ? '❌ OVERFLOW' : '✅ PASS';
      if (hasHorizontalScroll) totalFailures++;

      results.push({
        page: pageTitle,
        viewport: vp.name,
        width: vp.width,
        scrollWidth: dimensions.scrollWidth,
        status,
        diff: dimensions.scrollWidth - dimensions.innerWidth
      });

      console.log(`  [${status}] ${vp.name.padEnd(35)}: innerWidth=${dimensions.innerWidth}px, scrollWidth=${dimensions.scrollWidth}px (diff: ${dimensions.scrollWidth - dimensions.innerWidth}px)`);

      // Save screenshot for key viewports
      if (screenshotKey && (vp.width === 320 || vp.width === 390 || vp.width === 768 || vp.width === 1440 || vp.name.includes('Landscape 667'))) {
        const cleanName = `${screenshotKey}_${vp.width}x${vp.height}.png`;
        const screenshotPath = path.join(ARTIFACTS_DIR, cleanName);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`    📸 Saved screenshot: ${cleanName}`);
      }
    }
  }

  // 1. Audit Patient Queue Page (HIGHEST PRIORITY)
  await auditUrl(`${BASE_URL}/queue/demo_access_token_gm002`, 'Patient Queue Digital Pass', 'patient_queue');

  // 2. Audit Login Page
  await auditUrl(`${BASE_URL}/login`, 'Login Authentication Portal', 'login_portal');

  // 3. Log In as Receptionist and Audit Receptionist Dashboard
  console.log('\n🔑 Authenticating as Receptionist...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
  // Click demo button for Receptionist
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const recepBtn = btns.find(b => b.textContent.includes('Receptionist'));
    if (recepBtn) recepBtn.click();
  });
  await new Promise(r => setTimeout(r, 200));
  // Submit login
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 8000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 600));

  await auditUrl(`${BASE_URL}/receptionist`, 'Receptionist Dashboard', 'receptionist_dash');

  // Test Mobile Navigation Drawer toggle on Receptionist Dashboard
  await page.setViewport({ width: 375, height: 667 });
  await page.goto(`${BASE_URL}/receptionist`, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  const hamburgerBtn = await page.$('.header__hamburger-btn');
  if (hamburgerBtn) {
    console.log('  📱 Testing Mobile Navigation Drawer on Receptionist Dashboard...');
    await hamburgerBtn.click();
    await new Promise(r => setTimeout(r, 300));
    const drawerVisible = await page.evaluate(() => !!document.querySelector('.mobile-drawer'));
    console.log(`  Drawer opened: ${drawerVisible ? '✅ YES' : '❌ NO'}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'mobile_drawer_open_375x667.png') });
    console.log('    📸 Saved screenshot: mobile_drawer_open_375x667.png');

    // Close drawer
    const closeBtn = await page.$('.mobile-drawer__close');
    if (closeBtn) await closeBtn.click();
    await new Promise(r => setTimeout(r, 200));
  }

  // 4. Log In as Doctor and Audit Doctor Dashboard
  console.log('\n🔑 Authenticating as Doctor...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const docBtn = btns.find(b => b.textContent.includes('Doctor'));
    if (docBtn) docBtn.click();
  });
  await new Promise(r => setTimeout(r, 200));
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 8000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 600));

  await auditUrl(`${BASE_URL}/doctor`, 'Doctor Dashboard', 'doctor_dash');

  // 5. Log In as Admin and Audit Admin Dashboard
  console.log('\n🔑 Authenticating as Admin...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const adminBtn = btns.find(b => b.textContent.includes('Administrator'));
    if (adminBtn) adminBtn.click();
  });
  await new Promise(r => setTimeout(r, 200));
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 8000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 600));

  await auditUrl(`${BASE_URL}/admin`, 'Admin Dashboard', 'admin_dash');

  await browser.close();

  console.log('\n========================================');
  console.log(`AUDIT COMPLETE. Total viewports tested: ${results.length}`);
  console.log(`Total Horizontal Scroll Failures: ${totalFailures}`);
  console.log('========================================\n');

  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, 'audit_results.json'),
    JSON.stringify({ totalFailures, totalTested: results.length, results }, null, 2)
  );

  return totalFailures;
}

runAudit()
  .then(failures => {
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(err => {
    console.error('Audit failed with error:', err);
    process.exit(1);
  });
