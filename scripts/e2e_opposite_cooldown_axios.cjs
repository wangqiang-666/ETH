const axios = require('axios');

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function post(client, route, body) {
  try {
    const resp = await client.post(route, body);
    return { status: resp.status, body: resp.data };
  } catch (e) {
    if (e.response) return { status: e.response.status, body: e.response.data };
    throw e;
  }
}

async function main() {
  const port = process.env.WEB_PORT || 3031;
  const client = axios.create({ baseURL: `http://127.0.0.1:${port}/api`, timeout: 10000 });
  const sym = 'E2E-OPPOSITE-' + Date.now();
  let pass = true;

  // Isolate opposite-direction cooldown by disabling other gates
  try {
    const cfg = {
      signalCooldownMs: 0,
      oppositeCooldownMs: 2000,
      globalMinIntervalMs: 0,
      maxSameDirectionActives: 999,
      hourlyOrderCaps: { total: 0, perDirection: { LONG: 0, SHORT: 0 } },
      netExposureCaps: { total: 0, perDirection: { LONG: 0, SHORT: 0 } }
    };
    const r = await client.post('/config', cfg);
    if (r.status === 200) {
      console.log('[opposite] setup OK');
    } else {
      console.warn('[opposite] setup got non-200:', r.status);
    }
  } catch (e) {
    console.warn('[opposite] setup failed, continue anyway:', e?.response?.status || e?.message);
  }

  const longBase = { symbol: sym, direction: 'LONG', entry_price: 1000, current_price: 1000, leverage: 2, strategy_type: 'UNITTEST' };
  const shortBase = { ...longBase, direction: 'SHORT' };

  try {
    console.log('[opposite] case1: create LONG should pass');
    const a1 = await post(client, '/recommendations', longBase);
    if (a1.status !== 201 || !a1.body?.success) throw new Error('first LONG should be 201');

    console.log('[opposite] case1b: SHORT within opposite cooldown should be 429');
    const a2 = await post(client, '/recommendations', { ...shortBase, entry_price: longBase.entry_price * 0.98 });
    if (a2.status !== 429 || a2.body?.error !== 'COOLDOWN_ACTIVE') {
      pass = false;
      console.error('[opposite] FAIL a2: expect 429 COOLDOWN_ACTIVE, got', a2.status, a2.body);
    } else {
      const rem = a2.body?.remainingMs;
      const nextRaw = a2.body?.nextAvailableAt;
      const lastRaw = a2.body?.lastCreatedAt;
      const nextTs = typeof nextRaw === 'number' ? nextRaw : Date.parse(nextRaw);
      const lastTs = typeof lastRaw === 'number' ? lastRaw : Date.parse(lastRaw);
      if (!(typeof rem === 'number' && rem > 0 && rem <= 2000)
        || !(Number.isFinite(nextTs) && nextTs > Date.now())
        || !(Number.isFinite(lastTs) && lastTs <= Date.now() && lastTs <= nextTs)) {
        pass = false;
        console.error('[opposite] FAIL a2 fields: remainingMs/nextAvailableAt/lastCreatedAt invalid', { rem, nextRaw, lastRaw, nextTs, lastTs });
      } else {
        console.log('[opposite] OK a2 rejected with valid cooldown fields rem=', rem, 'nextTs=', nextTs, 'lastTs=', lastTs);
      }
    }

    console.log('[opposite] case2: after waiting interval, SHORT should pass');
    await wait(2100);
    const a3 = await post(client, '/recommendations', { ...shortBase, entry_price: longBase.entry_price * 0.97 });
    if (a3.status !== 201 || !a3.body?.success) {
      pass = false;
      console.error('[opposite] FAIL a3: expect 201 after wait, got', a3.status, a3.body);
    } else {
      console.log('[opposite] OK a3 created after cooldown');
    }
  } catch (e) {
    pass = false;
    console.error('[opposite] EXCEPTION:', e.message || e);
  }

  if (pass) {
    console.log('[opposite] PASS');
    process.exit(0);
  } else {
    console.log('[opposite] FAIL');
    process.exit(1);
  }
}

main();