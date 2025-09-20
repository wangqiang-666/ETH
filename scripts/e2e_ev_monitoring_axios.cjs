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

async function put(client, route, body) {
  try {
    const resp = await client.put(route, body, { validateStatus: () => true });
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

function payload({ symbol, ab = 'A', ev, evTh = undefined, dir = 'LONG', entry = 1000, current = 1000, lev = 2, size = 5 }) {
  const p = {
    symbol,
    direction: dir,
    entry_price: entry,
    current_price: current,
    leverage: lev,
    position_size: size,
    strategy_type: 'UNITTEST',
    expected_return: ev,
    ev: ev,
    ev_threshold: evTh,
    ab_group: ab,
  };
  p.bypassCooldown = true;
  return p;
}

async function createAndClose(client, rec) {
  const r = await post(client, '/recommendations', rec);
  if (r.status !== 201 || !r.body?.success) return { ok: false, step: 'create', resp: r };
  const id = r.body?.data?.id;
  if (!id) return { ok: false, step: 'create.id', resp: r };
  const c = await put(client, `/recommendations/${id}/close`, { reason: 'MANUAL_TEST' });
  if (c.status !== 200 || !c.body?.success) return { ok: false, step: 'close', resp: c };
  return { ok: true, id };
}

async function getMetrics(client, params) {
  try {
    const resp = await client.get('/monitoring/ev-metrics', { params, validateStatus: () => true });
    return { status: resp.status, body: resp.data };
  } catch (e) {
    if (e.response) return { status: e.response.status, body: e.response.data };
    throw e;
  }
}

async function main() {
  const port = process.env.WEB_PORT || 3001;
  const base = axios.create({ baseURL: `http://127.0.0.1:${port}/api`, timeout: 20000 });
  let pass = true;

  // isolate env
  try {
    const cfg = {
      signalCooldownMs: 0,
      oppositeCooldownMs: 0,
      globalMinIntervalMs: 0,
      maxSameDirectionActives: 999,
      allowOppositeWhileOpen: true,
      hourlyOrderCaps: { total: 0, perDirection: { LONG: 0, SHORT: 0 } },
      netExposureCaps: { total: 0, perDirection: { LONG: 0, SHORT: 0 } },
      entryFilters: { requireMTFAgreement: false },
    };
    const r = await updateConfig(base, cfg);
    if (!r.ok || r.status !== 200) console.warn('[evmon] setup cfg got', r.status, r.body);
  } catch (e) {
    console.warn('[evmon] setup cfg failed:', e?.response?.status || e?.message);
  }

  try {
    const now = Date.now();
    const sym = (i) => `E2E-EVMON-${now}-${i}`;

    const seeds = [
      payload({ symbol: sym(1), ab: 'A', ev: -0.03, evTh: 0.01 }),
      payload({ symbol: sym(2), ab: 'A', ev: 0.01, evTh: 0.02 }),
      payload({ symbol: sym(3), ab: 'B', ev: 0.07, evTh: 0.03 }),
      payload({ symbol: sym(4), ab: 'B', ev: -0.02, evTh: 0.01 }),
    ];

    for (const p of seeds) {
      const r = await createAndClose(base, p);
      if (!r.ok) {
        pass = false;
        console.error('[evmon] FAIL: createAndClose', r.step, r.resp);
      }
    }

    await sleep(300);

    const timeStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const timeEnd = new Date(Date.now() + 60 * 1000).toISOString();

    // Case 1: group_by=ev_threshold, default bins (5) should be enforced to range 2..12; we explicitly set 4
    {
      const r = await getMetrics(base, { start: timeStart, end: timeEnd, group_by: 'ev_threshold', bins: 4 });
      if (r.status !== 200 || r.body?.success !== true) {
        pass = false;
        console.error('[evmon] FAIL case1: status', r.status, r.body);
      } else {
        const d = r.body?.data || {};
        if (!Array.isArray(d.by_bins) || d.by_bins.length !== 4) {
          pass = false;
          console.error('[evmon] FAIL case1: by_bins length mismatch', d.by_bins);
        }
        if (!d.ev_ok || typeof d.ev_ok !== 'object') {
          pass = false;
          console.error('[evmon] FAIL case1: ev_ok missing', d);
        }
        console.log('[evmon] OK case1 group_by=ev_threshold bins=4');
      }
    }

    // Case 2: window=1d and window=30d both should return structure, not validating values
    {
      const r1 = await getMetrics(base, { window: '1d', bins: 3 });
      const r2 = await getMetrics(base, { window: '30d', bins: 3 });
      for (const [i, r] of [[1, r1], [2, r2]]) {
        if (r.status !== 200 || r.body?.success !== true) {
          pass = false;
          console.error(`[evmon] FAIL case2.${i}:`, r.status, r.body);
        } else {
          const d = r.body?.data || {};
          if (!d.overall || !Array.isArray(d.by_bins)) {
            pass = false;
            console.error(`[evmon] FAIL case2.${i}: structure invalid`, d);
          }
        }
      }
      if (pass) console.log('[evmon] OK case2 window 1d and 30d structure');
    }

  } catch (e) {
    pass = false;
    console.error('[evmon] EXCEPTION:', e && e.stack || e);
  }

  if (pass) {
    console.log('[evmon] PASS');
    process.exit(0);
  } else {
    console.log('[evmon] FAIL');
    process.exit(1);
  }
}

main();