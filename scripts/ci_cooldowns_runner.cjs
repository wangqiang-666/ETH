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
  const port = process.env.WEB_PORT || '3033';
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

  console.log('[ci] running same-direction cooldown e2e ...');
  const t1 = spawn(process.execPath, ['scripts/e2e_same_dir_cooldown_axios.cjs'], { env, cwd: process.cwd(), stdio: 'inherit' });
  const c1 = await new Promise(resolve => t1.on('exit', resolve));
  if (c1 !== 0) {
    await shutdown();
    console.log('[ci] E2E same-direction cooldown FAIL');
    process.exit(c1 || 1);
  }

  console.log('[ci] running opposite cooldown e2e ...');
  const t2 = spawn(process.execPath, ['scripts/e2e_opposite_cooldown_axios.cjs'], { env, cwd: process.cwd(), stdio: 'inherit' });
  const c2 = await new Promise(resolve => t2.on('exit', resolve));
  await shutdown();

  if (c2 === 0) {
    console.log('[ci] E2E cooldowns test PASS');
    process.exit(0);
  } else {
    console.log('[ci] E2E cooldowns test FAIL');
    process.exit(c2 || 1);
  }
}

run().catch(async (e) => {
  console.error('[ci] runner exception:', e && e.stack || e);
  process.exit(1);
});