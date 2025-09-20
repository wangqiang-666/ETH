const axios = require('axios');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
  const port = process.env.WEB_PORT || 3001;
  const client = axios.create({ baseURL: `http://localhost:${port}/api`, timeout: 10000 });
  const sym = 'E2E-BYPASS-AXIOS-' + Date.now();
  let pass = true;

  // ensure exposure limit won't interfere this test
  try {
    await client.post('/config', { maxSameDirectionActives: 99 });
    console.log('[axios] setup: maxSameDirectionActives=99');
  } catch (e) {
    console.warn('[axios] setup: config update failed, continue anyway', e?.response?.status || e?.message);
  }

  const minimal = {
    symbol: sym,
    direction: 'LONG',
    entry_price: 1000,
    current_price: 1000,
    leverage: 2,
    strategy_type: 'UNITTEST'
  };

  try {
    console.log('[axios] case1: without bypass, then with bypass');
    const r1 = await post(client, '/recommendations', minimal);
    if (r1.status !== 201 || !r1.body?.success) throw new Error('first create should 201');

    const r2 = await post(client, '/recommendations', { ...minimal, entry_price: minimal.entry_price * 1.02 });
    if (r2.status !== 429 || r2.body?.error !== 'COOLDOWN_ACTIVE') {
      pass = false;
      console.error('[axios] FAIL case1 second: expect 429 COOLDOWN_ACTIVE, got', r2.status, r2.body);
    } else {
      console.log('[axios] OK case1 second rejected by cooldown');
    }

    const r3 = await post(client, '/recommendations', { ...minimal, entry_price: minimal.entry_price * 1.03, bypassCooldown: true });
    if (r3.status !== 201 || !r3.body?.success) {
      pass = false;
      console.error('[axios] FAIL case1 third: expect 201 with bypassCooldown=true, got', r3.status, r3.body);
    } else {
      console.log('[axios] OK case1 third created with bypassCooldown=true');
    }

    // new: string values should NOT bypass
    console.log('[axios] case1b: string values should NOT bypass');
    const s1 = await post(client, '/recommendations', { ...minimal, entry_price: minimal.entry_price * 1.04, bypassCooldown: 'false' });
    if (s1.status !== 429 || s1.body?.error !== 'COOLDOWN_ACTIVE') {
      pass = false;
      console.error('[axios] FAIL case1b s1: expect 429 with bypassCooldown="false" (string), got', s1.status, s1.body);
    } else {
      console.log('[axios] OK case1b s1 blocked with bypassCooldown="false" string');
    }
    const s2 = await post(client, '/recommendations', { ...minimal, entry_price: minimal.entry_price * 1.05, bypassCooldown: 'true' });
    if (s2.status !== 429 || s2.body?.error !== 'COOLDOWN_ACTIVE') {
      pass = false;
      console.error('[axios] FAIL case1b s2: expect 429 with bypassCooldown="true" (string), got', s2.status, s2.body);
    } else {
      console.log('[axios] OK case1b s2 blocked with bypassCooldown="true" string');
    }

    console.log('[axios] case2: duplicate detection unaffected by bypass');
    const sym2 = 'E2E-DUP-AXIOS-' + Date.now();
    const p = { ...minimal, symbol: sym2 };
    const d1 = await post(client, '/recommendations', p);
    if (d1.status !== 201) throw new Error('dup first should 201');
    const d2 = await post(client, '/recommendations', { ...p, entry_price: p.entry_price * 1.0005 }); // 5bps
    if (d2.status !== 409 || d2.body?.error !== 'DUPLICATE_RECOMMENDATION') {
      pass = false;
      console.error('[axios] FAIL case2: expect 409 DUPLICATE_RECOMMENDATION, got', d2.status, d2.body);
    } else {
      console.log('[axios] OK case2 duplicate rejected');
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