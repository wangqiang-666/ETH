const axios = require('axios');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function post(client, route, body) {
  try {
    const resp = await client.post(route, body, { headers: { 'X-Loop-Guard': '1' }, validateStatus: () => true });
    return { status: resp.status, body: resp.data };
  } catch (e) {
    if (e.response) return { status: e.response.status, body: e.response.data };
    throw e;
  }
}

async function updateConfig(baseClient, updates) {
  try {
    const resp = await baseClient.post('/config', updates);
    return { ok: true, status: resp.status, body: resp.data };
  } catch (e) {
    if (e.response) return { ok: false, status: e.response.status, body: e.response.data };
    throw e;
  }
}

function payload({ symbol, direction = 'LONG', entry, current, lev = 2, size = 10, strategy = 'UNITTEST', mtf = null, extra = {} }) {
  const base = {
    symbol,
    direction,
    entry_price: entry,
    current_price: current,
    leverage: lev,
    position_size: size,
    strategy_type: strategy,
    ...extra,
  };
  if (mtf) {
    base.metadata = { multiTFConsistency: mtf };
  }
  return base;
}

async function main() {
  const port = process.env.WEB_PORT || 3033;
  const base = axios.create({ baseURL: `http://127.0.0.1:${port}/api`, timeout: 15000 });
  const client = base; // router mounted under /api

  let pass = true;

  // isolate: disable unrelated gates
  try {
    const cfg = {
      signalCooldownMs: 0,
      oppositeCooldownMs: 0,
      globalMinIntervalMs: 0,
      maxSameDirectionActives: 999,
      allowOppositeWhileOpen: true,
      hourlyOrderCaps: { total: 0, perDirection: { LONG: 0, SHORT: 0 } },
      netExposureCaps: { total: 0, perDirection: { LONG: 0, SHORT: 0 } },
    };
    const r = await updateConfig(base, cfg);
    if (!r.ok || r.status !== 200) console.warn('[mtf] setup base cfg got', r.status, r.body);
    else console.log('[mtf] setup base cfg OK');
  } catch (e) {
    console.warn('[mtf] setup base cfg failed, continue:', e?.response?.status || e?.message);
  }

  try {
    // Case 1: requireMTFAgreement ON -> reject when agreement below threshold or direction mismatch
    {
      const uc = await updateConfig(base, { entryFilters: { requireMTFAgreement: true, minMTFAgreement: 0.7, require5m15mAlignment: false, require1hWith5mTrend: false } });
      if (!uc.ok || uc.status !== 200) {
        pass = false;
        console.error('[mtf] FAIL: config requireMTFAgreement ON update failed', uc.status, uc.body);
      } else {
        console.log('[mtf] case1 config ON OK');
      }
      const sym = 'E2E-MTF-ON-' + Date.now();
      const mtfBad = { agreement: 0.5, dominantDirection: 'SHORT' };
      const p1 = payload({ symbol: sym, direction: 'LONG', entry: 2000, current: 2000, lev: 2, size: 5, mtf: mtfBad, extra: { bypassCooldown: true } });
      const r1 = await post(client, '/recommendations', p1);
      if (r1.status !== 409 || r1.body?.error !== 'MTF_CONSISTENCY') {
        pass = false;
        console.error('[mtf] FAIL case1: expect 409 MTF_CONSISTENCY, got', r1.status, r1.body);
      } else {
        const b = r1.body || {};
        if (b.requireMTFAgreement !== true || typeof b.minMTFAgreement !== 'number') {
          pass = false;
          console.error('[mtf] FAIL case1: missing require/min fields', b);
        } else if (!(typeof b.agreement === 'number' && b.agreement === 0.5) || b.dominantDirection !== 'SHORT') {
          pass = false;
          console.error('[mtf] FAIL case1: returned mtf fields mismatch', b);
        } else {
          console.log('[mtf] OK case1 rejected with proper fields');
        }
      }
    }

    // Case 2: requireMTFAgreement OFF -> should pass
    {
      const uc = await updateConfig(base, { entryFilters: { requireMTFAgreement: false } });
      if (!uc.ok || uc.status !== 200) {
        pass = false;
        console.error('[mtf] FAIL: config requireMTFAgreement OFF update failed', uc.status, uc.body);
      } else {
        console.log('[mtf] case2 config OFF OK');
      }
      const sym = 'E2E-MTF-OFF-' + Date.now();
      const mtfBad = { agreement: 0.3, dominantDirection: 'SHORT' };
      const p2 = payload({ symbol: sym, direction: 'LONG', entry: 3000, current: 3000, lev: 2, size: 5, mtf: mtfBad });
      const r2 = await post(client, '/recommendations', p2);
      if (r2.status !== 201 || !r2.body?.success) {
        pass = false;
        console.error('[mtf] FAIL case2: expect 201 when require off, got', r2.status, r2.body);
      } else {
        console.log('[mtf] OK case2 created when require off');
      }
    }

    // Case 3: requireMTFAgreement ON and agreement OK + direction matches -> pass, and no other gates interfere
    {
      const uc = await updateConfig(base, { entryFilters: { requireMTFAgreement: true, minMTFAgreement: 0.6 } });
      if (!uc.ok || uc.status !== 200) {
        pass = false;
        console.error('[mtf] FAIL: config ON (ok agreement) update failed', uc.status, uc.body);
      } else {
        console.log('[mtf] case3 config ON OK');
      }
      const sym = 'E2E-MTF-OK-' + Date.now();
      const mtfGood = { agreement: 0.85, dominantDirection: 'LONG' };
      const p3 = payload({ symbol: sym, direction: 'LONG', entry: 4000, current: 4000, lev: 3, size: 7, mtf: mtfGood, extra: { bypassCooldown: true } });
      const r3 = await post(client, '/recommendations', p3);
      if (r3.status !== 201 || !r3.body?.success) {
        pass = false;
        console.error('[mtf] FAIL case3: expect 201 when agreement OK, got', r3.status, r3.body);
      } else {
        console.log('[mtf] OK case3 created with agreement OK');
      }
    }

  } catch (e) {
    pass = false;
    console.error('[mtf] EXCEPTION:', e.message || e);
  }

  if (pass) {
    console.log('[mtf] PASS');
    process.exit(0);
  } else {
    console.log('[mtf] FAIL');
    process.exit(1);
  }
}

main();