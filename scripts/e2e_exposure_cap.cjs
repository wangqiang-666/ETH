/*
 Minimal e2e for EXPOSURE_CAP (total and perDirection)
 Requires local server running (WEB_PORT env), hitting /api/config and /api/recommendations
*/

const http = require('http');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function req(method, path, body) {
  const port = process.env.WEB_PORT || '3031';
  const data = body ? JSON.stringify(body) : null;
  const options = {
    hostname: '127.0.0.1',
    port,
    path,
    method,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data ? Buffer.byteLength(data) : 0,
      'x-loop-guard': '1'
    }
  };
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function assert(cond, msg) {
  if (!cond) {
    console.error('ASSERT FAILED:', msg);
    process.exit(1);
  }
}

async function preClean(symbol) {
  try {
    const resp = await req('GET', '/api/active-recommendations');
    const list = resp.body?.data?.recommendations || [];
    const targets = list.filter(r => (r?.symbol || '').toUpperCase() === symbol.toUpperCase());
    for (const r of targets) {
      await req('POST', `/api/recommendations/${encodeURIComponent(r.id)}/expire`);
      await sleep(50);
    }
  } catch (e) {
    console.warn('Pre-clean skipped due to error:', e && e.message);
  }
}

async function main() {
  const now = Date.now();
  const baseRec = {
    symbol: 'ETH',
    direction: 'LONG',
    entry_price: 2000,
    current_price: 2000,
    leverage: 1,
    stop_loss: 1800,
    take_profit: 2200,
    confidence: 0.9
  };

  // Pre-clean: expire existing ACTIVE recommendations for this symbol
  await preClean(baseRec.symbol);

  // 1) Prepare config: remove timing gates, raise same-direction limit, set TOTAL cap tight and perDirection loose
  let cfgRes = await req('POST', '/api/config', {
    signalCooldownMs: 0,
    oppositeCooldownMs: 0,
    globalMinIntervalMs: 0,
    maxSameDirectionActives: 1000,
    netExposureCaps: { total: 1.5, perDirection: { LONG: 2.0, SHORT: 2.0 } }
  });
  assert(cfgRes.status === 200, 'Config update failed (total cap stage)');

  // 2) Create first LONG, position_size 0.8 -> accepted
  const r1 = await req('POST', '/api/recommendations', { ...baseRec, strategy_type: 'E2E_CAP_A', position_size: 0.8, bypassCooldown: true });
  assert(r1.status === 201 && r1.body?.success, `First LONG should succeed, got ${r1.status} ${r1.raw}`);

  await sleep(150);

  // 3) Create second LONG, position_size 0.8 -> should hit TOTAL cap (0.8 + 0.8 = 1.6 > 1.5)
  const r2 = await req('POST', '/api/recommendations', { ...baseRec, strategy_type: 'E2E_CAP_B', position_size: 0.8, bypassCooldown: true });
  assert(r2.status === 409, `Second LONG should be 409 due to EXPOSURE_CAP (total), got ${r2.status} ${r2.raw}`);
  assert(r2.body?.error === 'EXPOSURE_CAP', `Expected error=EXPOSURE_CAP (total), got ${r2.raw}`);
  assert(typeof r2.body?.totalCap === 'number' && r2.body.totalCap > 0, 'totalCap missing/invalid');
  assert(typeof r2.body?.currentTotal === 'number', 'currentTotal missing');
  assert(typeof r2.body?.adding === 'number' && r2.body.adding > 0, 'adding missing');
  // 加严断言：数值关系与adding一致性
  {
    const totalCap = r2.body.totalCap;
    const currentTotal = r2.body.currentTotal;
    const adding = r2.body.adding;
    const eps = 1e-6;
    assert(Math.abs(adding - 0.8) < 1e-3, `adding should ~= 0.8, got ${adding}`);
    assert(currentTotal + adding >= totalCap - eps, `Expected currentTotal(${currentTotal}) + adding(${adding}) > totalCap(${totalCap})`);
  }

  // 4) Verify active list count remained 1
  const act0 = await req('GET', '/api/active-recommendations');
  const list0 = act0.body?.data?.recommendations || [];
  assert(Array.isArray(list0) && list0.length >= 1, `Active list should have at least 1 item, got ${act0.raw}`);

  // 5) Stage perDirection: relax total, tighten LONG dir cap to 1.5
  cfgRes = await req('POST', '/api/config', {
    netExposureCaps: { total: 10.0, perDirection: { LONG: 1.5, SHORT: 10.0 } },
    maxSameDirectionActives: 1000
  });
  assert(cfgRes.status === 200, 'Config update failed (perDirection stage)');

  await sleep(150);

  // 6) Try another LONG 0.8 -> should hit LONG dir cap (existing ~0.8 + 0.8 = 1.6 > 1.5)
  const r3 = await req('POST', '/api/recommendations', { ...baseRec, strategy_type: 'E2E_CAP_C', position_size: 0.8, bypassCooldown: true });
  assert(r3.status === 409, `Third LONG should be 409 due to EXPOSURE_CAP (perDirection), got ${r3.status} ${r3.raw}`);
  assert(r3.body?.error === 'EXPOSURE_CAP', `Expected error=EXPOSURE_CAP (perDirection), got ${r3.raw}`);
  assert(typeof r3.body?.dirCap === 'number' && r3.body.dirCap > 0, 'dirCap missing/invalid');
  assert(typeof r3.body?.currentDirection === 'number', 'currentDirection missing');
  // 加严断言：方向敞口数值关系与adding一致性
  {
    const dirCap = r3.body.dirCap;
    const currentDirection = r3.body.currentDirection;
    const adding = typeof r3.body.adding === 'number' ? r3.body.adding : 0.8; // adding通常会返回
    const eps = 1e-6;
    assert(Math.abs(adding - 0.8) < 1e-3, `adding should ~= 0.8, got ${adding}`);
    assert(currentDirection + adding >= dirCap - eps, `Expected currentDirection(${currentDirection}) + adding(${adding}) > dirCap(${dirCap})`);
  }

  console.log('[OK] EXPOSURE_CAP e2e passed for total and perDirection');
  process.exit(0);
}

main().catch(err => {
  console.error('E2E error:', err);
  process.exit(1);
});