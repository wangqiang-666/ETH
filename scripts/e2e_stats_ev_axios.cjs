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

function payload({ symbol, ab = 'A', ev, evTh = undefined, dir = 'LONG', entry = 1000, current = 1000, lev = 2, size = 5, dedupe = undefined }) {
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
    ab_group: ab,
  };
  if (typeof evTh === 'number') p.ev_threshold = evTh;
  if (dedupe) p.dedupe_key = dedupe;
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

async function getStats(client, params) {
  try {
    const resp = await client.get('/stats', { params, validateStatus: () => true });
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

  // isolate env: disable unrelated gates
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
    if (!r.ok || r.status !== 200) console.warn('[stats] setup cfg got', r.status, r.body);
  } catch (e) {
    console.warn('[stats] setup cfg failed:', e?.response?.status || e?.message);
  }

  try {
    // Seed A/B groups with different ev values
    const now = Date.now();

    const seeds = [
      payload({ symbol: `E2E-STAT-A-${now}-1`, ab: 'A', ev: -0.05, evTh: 0.02, dedupe: `D-${now}-A-1` }),
      payload({ symbol: `E2E-STAT-A-${now}-2`, ab: 'A', ev: 0.02, evTh: 0.03, dedupe: `D-${now}-A-2` }),
      payload({ symbol: `E2E-STAT-A-${now}-3`, ab: 'A', ev: 0.10, evTh: 0.05, dedupe: `D-${now}-A-3` }),
      payload({ symbol: `E2E-STAT-B-${now}-1`, ab: 'B', ev: -0.01, evTh: 0.01, dedupe: `D-${now}-B-1` }),
      payload({ symbol: `E2E-STAT-B-${now}-2`, ab: 'B', ev: 0.06, evTh: 0.02, dedupe: `D-${now}-B-2` }),
    ];

    for (const p of seeds) {
      const r = await createAndClose(base, p);
      if (!r.ok) {
        pass = false;
        console.error('[stats] FAIL: createAndClose', r.step, r.resp);
      }
      // tiny delay to avoid same-ms races
      await sleep(20);
    }

    // Allow async cache clear to settle
    await sleep(300);

    const timeStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const timeEnd = new Date(Date.now() + 60 * 1000).toISOString();

    // Case 1: ab_group single (A), bin_mode=even, bins=3 (by_ab_group should be undefined)
    {
      const r = await getStats(base, { start: timeStart, end: timeEnd, bin_mode: 'even', bins: 3, ab_group: 'A' });
      if (r.status !== 200 || r.body?.success !== true) {
        pass = false;
        console.error('[stats] FAIL case1: status', r.status, r.body);
      } else {
        const d = r.body?.data || {};
        if (!Array.isArray(d.bins) || d.bins.length !== 3) {
          pass = false;
          console.error('[stats] FAIL case1: bins length mismatch', d.bins);
        }
        if (d.by_ab_group !== undefined) {
          pass = false;
          console.error('[stats] FAIL case1: by_ab_group should be undefined for single group', d.by_ab_group);
        }
        console.log('[stats] OK case1 single A with even bins=3');
      }
    }

    // Case 2: ab_group multiple (A,B), expect by_ab_group populated with A and B each has bins length 3
    {
      const r = await getStats(base, { start: timeStart, end: timeEnd, bin_mode: 'even', bins: 3, ab_group: 'A,B' });
      if (r.status !== 200 || r.body?.success !== true) {
        pass = false;
        console.error('[stats] FAIL case2: status', r.status, r.body);
      } else {
        const d = r.body?.data || {};
        if (!d.by_ab_group || typeof d.by_ab_group !== 'object') {
          pass = false;
          console.error('[stats] FAIL case2: by_ab_group missing', d);
        } else {
          const ag = d.by_ab_group['A'];
          const bg = d.by_ab_group['B'];
          if (!ag || !bg) {
            pass = false;
            console.error('[stats] FAIL case2: missing A/B groups', Object.keys(d.by_ab_group || {}));
          } else {
            if (!Array.isArray(ag.bins) || ag.bins.length !== 3) {
              pass = false;
              console.error('[stats] FAIL case2: A.bins length !== 3', ag.bins);
            }
            if (!Array.isArray(bg.bins) || bg.bins.length !== 3) {
              pass = false;
              console.error('[stats] FAIL case2: B.bins length !== 3', bg.bins);
            }
          }
        }
        console.log('[stats] OK case2 multi A,B with by_ab_group bins=3');
      }
    }

  } catch (e) {
    pass = false;
    console.error('[stats] EXCEPTION:', e && e.stack || e);
  }

  if (pass) {
    console.log('[stats] PASS');
    process.exit(0);
  } else {
    console.log('[stats] FAIL');
    process.exit(1);
  }
}

main();