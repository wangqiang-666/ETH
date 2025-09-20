const http = require('http');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function post(base, route, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(base + route, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch (e) { reject(new Error(`POST ${route} JSON parse failed: ${e.message}; raw=${d.slice(0, 500)}`)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const base = 'http://localhost:' + (process.env.WEB_PORT || 3001) + '/api';
  const sym = 'E2E-BYPASS-' + Date.now();
  let pass = true;

  const minimal = {
    symbol: sym,
    direction: 'LONG',
    entry_price: 1000,
    current_price: 1000,
    leverage: 2,
    strategy_type: 'UNITTEST'
  };

  try {
    console.log('[bypass] case1: without bypass, second within cooldown -> 429');
    const r1 = await post(base, '/recommendations', minimal);
    if (r1.status !== 201 || !r1.body?.success) throw new Error('first create should 201, got ' + r1.status + ' body=' + JSON.stringify(r1.body));
    const r2 = await post(base, '/recommendations', { ...minimal, entry_price: minimal.entry_price * 1.02 }); // avoid duplicate, still within cooldown
    if (r2.status !== 429 || r2.body?.error !== 'COOLDOWN_ACTIVE') {
      pass = false;
      console.error('[bypass] FAIL case1 second: expect 429 COOLDOWN_ACTIVE, got', r2.status, r2.body);
    } else {
      console.log('[bypass] OK case1 second rejected by cooldown:', r2.body?.reason || r2.body?.error);
    }
    const r3 = await post(base, '/recommendations', { ...minimal, entry_price: minimal.entry_price * 1.03, bypassCooldown: true }); // avoid duplicate, bypass cooldown
    if (r3.status !== 201 || !r3.body?.success) {
      pass = false;
      console.error('[bypass] FAIL case1 third: expect 201 with bypassCooldown=true, got', r3.status, r3.body);
    } else {
      console.log('[bypass] OK case1 third created with bypassCooldown=true:', r3.body?.data?.id);
    }

    console.log('[bypass] case2: duplicate detection not bypassed -> 409');
    const sym2 = 'E2E-DUP-' + Date.now();
    const p = { ...minimal, symbol: sym2 };
    const d1 = await post(base, '/recommendations', p);
    if (d1.status !== 201) throw new Error('dup first should 201, got ' + d1.status);
    // immediate re-post with small price diff within bps threshold
    const d2 = await post(base, '/recommendations', { ...p, entry_price: p.entry_price * 1.0005 }); // 5bps
    if (d2.status !== 409 || d2.body?.error !== 'DUPLICATE_RECOMMENDATION') {
      pass = false;
      console.error('[bypass] FAIL case2: expect 409 DUPLICATE_RECOMMENDATION, got', d2.status, d2.body);
    } else {
      console.log('[bypass] OK case2 duplicate rejected:', (d2.body?.matchedIds || []).length, 'matches');
    }
    // case3: string values should NOT bypass
    console.log('[bypass] case3: string values should NOT bypass (expect 429)');
    const s1 = await post(base, '/recommendations', { ...minimal, entry_price: minimal.entry_price * 1.04, bypassCooldown: 'false' });
    if (s1.status !== 429 || s1.body?.error !== 'COOLDOWN_ACTIVE') {
      pass = false;
      console.error('[bypass] FAIL case3 s1: expect 429 with bypassCooldown="false" (string), got', s1.status, s1.body);
    } else {
      console.log('[bypass] OK case3 s1 blocked with bypassCooldown="false" string');
    }
    const s2 = await post(base, '/recommendations', { ...minimal, entry_price: minimal.entry_price * 1.05, bypassCooldown: 'true' });
    if (s2.status !== 429 || s2.body?.error !== 'COOLDOWN_ACTIVE') {
      pass = false;
      console.error('[bypass] FAIL case3 s2: expect 429 with bypassCooldown="true" (string), got', s2.status, s2.body);
    } else {
      console.log('[bypass] OK case3 s2 blocked with bypassCooldown="true" string');
    }
  } catch (e) {
    pass = false;
    console.error('[bypass] EXCEPTION:', e.message);
  }

  if (pass) {
    console.log('[bypass] PASS: all assertions satisfied');
    process.exit(0);
  } else {
    console.log('[bypass] FAIL: some assertions failed');
    process.exit(1);
  }
}

main();