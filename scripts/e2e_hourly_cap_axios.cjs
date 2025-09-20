const axios = require('axios');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const base = 'http://localhost:' + (process.env.WEB_PORT || 3001) + '/api';
  const port = process.env.WEB_PORT || 3001;
  const sym = 'E2E-HOURLY-' + Date.now();
  const minimal = {
    symbol: sym,
    direction: 'LONG',
    entry_price: 1000,
    current_price: 1000,
    leverage: 2,
    strategy_type: 'UNITTEST'
  };

  // Prepare: deterministic config - disable total cap, set per-direction cap LONG=1, SHORT=0
  const cfg = {
    hourlyOrderCaps: { total: 0, perDirection: { LONG: 1, SHORT: 0 } }
  };
  try {
    const upd = await axios.post(`${base}/config`, cfg, { timeout: 5000 });
    if (upd.status !== 200 || upd.data?.success !== true) {
      console.error('[hourly] FAIL: update config failed', upd.status, upd.data);
      process.exit(1);
    }
  } catch (e) {
    console.error('[hourly] EXCEPTION updating config:', e?.response?.status, e?.response?.data || e.message);
    process.exit(1);
  }

  let pass = true;
  try {
    console.log('[hourly] case1: LONG with bypass -> 201 (seed count=1 for LONG)');
    const r1 = await axios.post(`${base}/recommendations`, { ...minimal, bypassCooldown: true }, { validateStatus: () => true, timeout: 5000, headers: { 'x-loop-guard': '1' } });
    if (r1.status !== 201) {
      pass = false;
      console.error('[hourly] FAIL case1: expect bypass 201, got', r1.status, r1.data);
    } else {
      console.log('[hourly] OK case1 bypass created');
    }

    console.log('[hourly] case2: LONG without bypass should hit per-direction cap -> 429');
    const r2 = await axios.post(`${base}/recommendations`, { ...minimal, symbol: sym + '-L2', entry_price: 1001 }, { validateStatus: () => true, timeout: 5000, headers: { 'x-loop-guard': '1' } });
    if (r2.status !== 429 || r2.data?.error !== 'COOLDOWN_ACTIVE') {
      pass = false;
      console.error('[hourly] FAIL case2: expect 429 COOLDOWN_ACTIVE, got', r2.status, r2.data);
    } else {
      console.log('[hourly] OK case2 blocked by hourly cap (per-direction)');
    }

    console.log('[hourly] case3: SHORT without cap should be allowed -> 201');
    const r3 = await axios.post(`${base}/recommendations`, { ...minimal, direction: 'SHORT', symbol: sym + '-S', entry_price: 999 }, { validateStatus: () => true, timeout: 5000, headers: { 'x-loop-guard': '1' } });
    if (r3.status !== 201) {
      pass = false;
      console.error('[hourly] FAIL case3: expect SHORT create 201, got', r3.status, r3.data);
    } else {
      console.log('[hourly] OK case3 SHORT created');
    }
  } catch (e) {
    pass = false;
    console.error('[hourly] EXCEPTION:', e?.response?.status, e?.response?.data || e.message);
  }

  if (pass) {
    console.log('[hourly] PASS: all assertions satisfied');
    process.exit(0);
  } else {
    console.log('[hourly] FAIL: some assertions failed');
    process.exit(1);
  }
}

main();