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

  console.log('[ci] running axios e2e on same port ...');
  const test = spawn(process.execPath, ['scripts/e2e_bypass_cooldown_axios.cjs'], { env, cwd: process.cwd(), stdio: 'inherit' });
  const code = await new Promise(resolve => test.on('exit', resolve));

  await shutdown();

  if (code === 0) {
    console.log('[ci] E2E bypassCooldown test PASS');
    process.exit(0);
  } else {
    console.log('[ci] E2E bypassCooldown test FAIL');
    process.exit(code || 1);
  }
}

run().catch(async (e) => {
  console.error('[ci] runner exception:', e && e.stack || e);
  process.exit(1);
});