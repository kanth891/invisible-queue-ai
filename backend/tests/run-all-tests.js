import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tests = [
  'phase2.test.js',
  'phase3.test.js',
  'phase4.test.js',
  'api.test.js',
  'e2e-workflow.test.js',
  'phase3-multi-queue-simulation.test.js',
  'phase3-cold-start.test.js',
  'advanced-queue.test.js',
  'full-system-qa.test.js',
];

async function isPortOpen(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(port, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(port)) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [scriptPath], {
      stdio: 'inherit',
      env: { ...process.env, PORT: '5000' }
    });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Script ${path.basename(scriptPath)} exited with code ${code}`));
    });
  });
}

async function main() {
  console.log('[START] Launching Invisible Queue AI Unified Automated Verification Suite...\n');
  let serverProcess = null;

  const alreadyRunning = await isPortOpen(5000);
  if (!alreadyRunning) {
    console.log('[Runner] Starting in-memory E2E test server on port 5000...');
    serverProcess = spawn('node', [path.join(__dirname, 'e2e-server.js')], {
      stdio: 'pipe',
      env: { ...process.env, PORT: '5000' }
    });

    const ready = await waitForServer(5000);
    if (!ready) {
      if (serverProcess) serverProcess.kill();
      console.error('[Runner] Error: Test server failed to start within timeout');
      process.exit(1);
    }
    console.log('[Runner] Test server ready.\n');
  } else {
    console.log('[Runner] Server already running on port 5000.\n');
  }

  let failed = false;
  try {
    for (const testFile of tests) {
      console.log(`\n────────────────────────────────────────────────────────────`);
      console.log(`▶ Running test suite: ${testFile}`);
      console.log(`────────────────────────────────────────────────────────────`);
      await runScript(path.join(__dirname, testFile));
    }
    console.log('\n============================================================');
    console.log('[SUCCESS] ALL TEST SUITES COMPLETED AND PASSED WITH ZERO ERRORS!');
    console.log('============================================================\n');
  } catch (err) {
    console.error('\n❌ Test execution failed:', err.message);
    failed = true;
  } finally {
    if (serverProcess) {
      console.log('[Runner] Shutting down background test server...');
      serverProcess.kill('SIGTERM');
    }
    process.exit(failed ? 1 : 0);
  }
}

main();
