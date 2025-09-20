const axios = require('axios');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function post(client, route, body, headers) {
  try {
    const resp = await client.post(route, body, headers ? { headers } : undefined);
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

function payload({ symbol, direction = 'LONG', entry, current, lev = 2, size = 10, strategy = 'UNITTEST', extra = {} }) {
  return {
    symbol,
    direction,
    entry_price: entry,
    current_price: current,
    leverage: lev,
    position_size: size,
    strategy_type: strategy,
    ...extra,
  };
}

async function main() {
  const port = process.env.WEB_PORT || 3001;
  const base = axios.create({ baseURL: `http://localhost:${port}/api`, timeout: 15000 });
  const client = base; // for router under /api

  let pass = true;

  try {
    // Case 1: cooldown mapping 429 and bypass works
    {
      const sym = 'E2E-COOLDOWN-' + Date.now();
      const p1 = payload({ symbol: sym, direction: 'LONG', entry: 1000, current: 1000, lev: 2, size: 10 });
      const r1 = await post(client, '/recommendations', p1);
      if (r1.status !== 201 || !r1.body?.success) throw new Error('case1 first create should 201');

      const r2 = await post(client, '/recommendations', payload({ symbol: sym, direction: 'LONG', entry: 1010, current: 1010, lev: 2, size: 10 }));
      if (r2.status !== 429 || r2.body?.error !== 'COOLDOWN_ACTIVE') {
        pass = false;
        console.error('[axios] FAIL case1 second: expect 429 COOLDOWN_ACTIVE, got', r2.status, r2.body);
      } else {
        console.log('[axios] OK case1 second rejected by cooldown');
      }

      const r3 = await post(client, '/recommendations', payload({ symbol: sym, direction: 'LONG', entry: 1020, current: 1020, lev: 2, size: 10, extra: { bypassCooldown: true } }));
      if (r3.status !== 201 || !r3.body?.success) {
        pass = false;
        console.error('[axios] FAIL case1 third: expect 201 with bypassCooldown=true, got', r3.status, r3.body);
      } else {
        console.log('[axios] OK case1 third created with bypassCooldown=true');
      }
    }

    // Case 2: duplicate detection 409
    {
      const sym = 'E2E-DUP-' + Date.now();
      const p = payload({ symbol: sym, direction: 'LONG', entry: 2000, current: 2000, lev: 2, size: 10 });
      const d1 = await post(client, '/recommendations', p);
      if (d1.status !== 201) throw new Error('case2 first should 201');
      // Within bps threshold (<=0.2%), use 0.05%
      const d2 = await post(client, '/recommendations', { ...p, entry_price: p.entry_price * 1.0005, current_price: p.current_price * 1.0005 });
      if (d2.status !== 409 || d2.body?.error !== 'DUPLICATE_RECOMMENDATION') {
        pass = false;
        console.error('[axios] FAIL case2: expect 409 DUPLICATE_RECOMMENDATION, got', d2.status, d2.body);
      } else {
        console.log('[axios] OK case2 duplicate rejected');
      }
    }

    // Case 3: exposure count limit (EXPOSURE_LIMIT) 409
    {
      const cfg = {
        maxSameDirectionActives: 1,
        netExposureCaps: { total: 0, perDirection: { LONG: 0, SHORT: 0 } },
      };
      const uc = await updateConfig(base, cfg);
      if (!uc.ok && uc.status !== 200) {
        pass = false;
        console.error('[axios] FAIL case3: update config failed', uc.status, uc.body);
      } else {
        console.log('[axios] OK case3 config updated (exposure count test)');
      }
      const sym = 'E2E-EXPLIM-' + Date.now();
      const p1 = payload({ symbol: sym, direction: 'LONG', entry: 3000, current: 3000, lev: 2, size: 5, extra: { bypassCooldown: true } });
      const c1 = await post(client, '/recommendations', p1);
      if (c1.status !== 201) throw new Error('case3 first should 201');
      await sleep(50);
      const p2 = payload({ symbol: sym, direction: 'LONG', entry: 3035, current: 3035, lev: 2, size: 5, extra: { bypassCooldown: true } }); // price +1.17% to avoid duplicate
      const c2 = await post(client, '/recommendations', p2);
      if (c2.status !== 409 || c2.body?.error !== 'EXPOSURE_LIMIT') {
        pass = false;
        console.error('[axios] FAIL case3: expect 409 EXPOSURE_LIMIT, got', c2.status, c2.body);
      } else {
        const b = c2.body || {};
        if (typeof b.maxSameDirection !== 'number' || typeof b.currentCount !== 'number') {
          pass = false;
          console.error('[axios] FAIL case3: response missing fields', b);
        } else {
          console.log('[axios] OK case3 exposure limit rejected', { maxSameDirection: b.maxSameDirection, currentCount: b.currentCount });
        }
      }
    }

    // Case 4: net exposure cap (EXPOSURE_CAP) 409
    {
      const cfg = {
        maxSameDirectionActives: 10,
        netExposureCaps: { total: 100, perDirection: { LONG: 50, SHORT: 0 } },
      };
      const uc = await updateConfig(base, cfg);
      if (!uc.ok && uc.status !== 200) {
        pass = false;
        console.error('[axios] FAIL case4: update config failed', uc.status, uc.body);
      } else {
        console.log('[axios] OK case4 config updated (exposure cap test)');
      }
      const sym = 'E2E-EXPCAP-' + Date.now();
      const r1 = await post(client, '/recommendations', payload({ symbol: sym, direction: 'LONG', entry: 4000, current: 4000, lev: 2, size: 20, extra: { bypassCooldown: true } })); // adding=40
      if (r1.status !== 201) throw new Error('case4 first should 201');
      await sleep(50);
      const r2 = await post(client, '/recommendations', payload({ symbol: sym, direction: 'LONG', entry: 4045, current: 4045, lev: 1, size: 15, extra: { bypassCooldown: true } })); // adding=15, total dir=55>50
      if (r2.status !== 409 || r2.body?.error !== 'EXPOSURE_CAP') {
        pass = false;
        console.error('[axios] FAIL case4: expect 409 EXPOSURE_CAP, got', r2.status, r2.body);
      } else {
        const b = r2.body || {};
        if (typeof b.dirCap !== 'number' || typeof b.totalCap !== 'number') {
          pass = false;
          console.error('[axios] FAIL case4: response missing cap fields', b);
        } else {
          console.log('[axios] OK case4 exposure cap rejected', { dirCap: b.dirCap, totalCap: b.totalCap, adding: b.adding, currentDirection: b.currentDirection });
        }
      }
    }

    // Case 5: opposite constraint (OPPOSITE_CONSTRAINT) 409 when not allowed
    {
      const cfg = {
        allowOppositeWhileOpen: false,
        maxSameDirectionActives: 10,
        netExposureCaps: { total: 0, perDirection: { LONG: 0, SHORT: 0 } },
      };
      const uc = await updateConfig(base, cfg);
      if (!uc.ok && uc.status !== 200) {
        pass = false;
        console.error('[axios] FAIL case5: update config failed', uc.status, uc.body);
      } else {
        console.log('[axios] OK case5 config updated (opposite constraint test)');
      }
      const sym = 'E2E-OPP-' + Date.now();
      const a = await post(client, '/recommendations', payload({ symbol: sym, direction: 'LONG', entry: 5000, current: 5000, lev: 2, size: 10, extra: { bypassCooldown: true } }));
      if (a.status !== 201) throw new Error('case5 first should 201');
      await sleep(50);
      const b = await post(client, '/recommendations', payload({ symbol: sym, direction: 'SHORT', entry: 5050, current: 5050, lev: 2, size: 10, extra: { bypassCooldown: true } }));
      if (b.status !== 409 || b.body?.error !== 'OPPOSITE_CONSTRAINT') {
        pass = false;
        console.error('[axios] FAIL case5: expect 409 OPPOSITE_CONSTRAINT, got', b.status, b.body);
      } else {
        console.log('[axios] OK case5 opposite constrained');
      }
    }

  } catch (e) {
    pass = false;
    console.error('[axios] EXCEPTION:', e.message || e);
  }

  if (pass) {
    console.log('[axios] PASS');
    process.exit(0);
  } else {
    console.log('[axios] FAIL');
    process.exit(1);
  }
}

main();