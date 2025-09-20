const { spawn } = require('child_process');
const axios = require('axios');

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitForHealth(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await axios.get(url, { timeout: 2000 });
      if (resp.status === 200 && resp.data && (resp.data.success === true || resp.data.data?.status === 'healthy')) return true;
    } catch (_) {}
    await wait(500);
  }
  return false;
}

async function run() {
  const port = process.env.WEB_PORT || '3038';
  const env = { ...process.env, WEB_PORT: String(port), WEB_DISABLE_REALTIME: '1', WEB_DISABLE_RECO_INIT: '1', WEB_DISABLE_EXTERNAL_MARKET: '1' };

  console.log(`[ci] launching web-server on port ${port} ...`);
  const server = spawn('npm', ['run', 'web'], { env, cwd: process.cwd(), stdio: 'inherit', shell: true });

  let finished = false;
  const shutdown = async () => {
    if (finished) return;
    finished = true;
    console.log('[ci] shutting down web-server ...');
    try { server.kill('SIGINT'); } catch (_) {}
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const ok = await waitForHealth(`http://localhost:${port}/health`, 45000);
  if (!ok) {
    console.error('[ci] web-server health check failed');
    await shutdown();
    process.exit(1);
  }
  console.log('[ci] web-server is healthy');

  const tests = [
    { name: 'COOLDOWN_SAME_DIRECTION', file: 'scripts/e2e_same_dir_cooldown_axios.cjs' },
    { name: 'COOLDOWN_OPPOSITE', file: 'scripts/e2e_opposite_cooldown_axios.cjs' },
    { name: 'HOURLY_CAP', file: 'scripts/e2e_hourly_cap_axios.cjs' },
    { name: 'EXPOSURE_CAP', file: 'scripts/e2e_exposure_cap.cjs' },
    { name: 'EXPOSURE_LIMIT', file: 'scripts/e2e_exposure_limit.cjs' },
    { name: 'MTF_CONSISTENCY', file: 'scripts/e2e_mtf_consistency_axios.cjs' },
  ];

  for (const t of tests) {
    console.log(`[ci] running ${t.name} e2e ...`);
    const test = spawn(process.execPath, [t.file], { env, cwd: process.cwd(), stdio: 'inherit' });
    const code = await new Promise(resolve => test.on('exit', resolve));
    if (code !== 0) {
      console.error(`[ci] ${t.name} e2e FAIL (code=${code})`);
      await shutdown();
      process.exit(code || 1);
    } else {
      console.log(`[ci] ${t.name} e2e PASS`);
    }
  }

  await shutdown();
  console.log('[ci] E2E all suites PASS');
  process.exit(0);
}

run().catch(async (e) => {
  console.error('[ci] runner exception:', e && e.stack || e);
  process.exit(1);
});