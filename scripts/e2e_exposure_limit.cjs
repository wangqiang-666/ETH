const http = require('http');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function req(method, base, route, body) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : '';
    const opts = new URL(base + route);
    const reqOpts = {
      method,
      hostname: opts.hostname,
      port: opts.port,
      path: opts.pathname + (opts.search || ''),
      headers: {
        'Content-Type': 'application/json',
      }
    };
    if (data) reqOpts.headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request(reqOpts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let parsed;
        try { parsed = d ? JSON.parse(d) : undefined; } catch (e) { return reject(new Error(`${method} ${route} JSON parse failed: ${e.message}; raw=${d.slice(0, 500)}`)); }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const get = (base, route) => req('GET', base, route);
const post = (base, route, body) => req('POST', base, route, body);

async function main() {
  const port = process.env.WEB_PORT || 3001;
  const base = 'http://localhost:' + port + '/api';
  let pass = true;

  try {
    // 1) 放宽限制，确保首单一定能过；取消冷却与净敞口约束
    const widen = await post(base, '/config', { signalCooldownMs: 0, maxSameDirectionActives: 999, netExposureCaps: { total: 0, perDirection: { LONG: 0, SHORT: 0 } } });
    if (widen.status !== 200 || !widen.body?.success) throw new Error('POST /config widen failed: ' + widen.status);

    // 2) 选择活跃较少的方向
    const act0 = await get(base, '/active-recommendations');
    if (act0.status !== 200) throw new Error('GET /active-recommendations failed: ' + act0.status);
    const list0Raw = act0.body?.data?.recommendations;
    const list0 = Array.isArray(list0Raw) ? list0Raw : [];
    const cnt0 = { LONG: 0, SHORT: 0 };
    for (const it of list0) { if (it?.direction === 'LONG') cnt0.LONG++; else if (it?.direction === 'SHORT') cnt0.SHORT++; }
    const pick = cnt0.LONG <= cnt0.SHORT ? 'LONG' : 'SHORT';

    // 3) 创建首单（应 201）
    const sym = 'E2E-EXPLIM-' + Date.now();
    const minimal = { symbol: sym, direction: pick, entry_price: 1000, current_price: 1000, leverage: 2, strategy_type: 'UNITTEST' };
    const r1 = await post(base, '/recommendations', minimal);
    if (r1.status !== 201 || !r1.body?.success) throw new Error('first create should 201, got ' + r1.status + ' body=' + JSON.stringify(r1.body));

    // 等待短暂时间，让 tracker 注册到活跃集合
    await sleep(150);

    // 4) 以当前同向活跃数作为上限，确保下一单触发 EXPOSURE_LIMIT
    const act1 = await get(base, '/active-recommendations');
    if (act1.status !== 200) throw new Error('GET /active-recommendations(1) failed: ' + act1.status);
    const list1Raw = act1.body?.data?.recommendations;
    const list1 = Array.isArray(list1Raw) ? list1Raw : [];
    let same = 0; for (const it of list1) { if (it?.direction === pick) same++; }
    const tighten = await post(base, '/config', { maxSameDirectionActives: same });
    if (tighten.status !== 200 || !tighten.body?.success) throw new Error('POST /config tighten failed: ' + tighten.status);

    console.log('[explim] case: same-direction limit -> second should be 409 EXPOSURE_LIMIT');
    const r2 = await post(base, '/recommendations', { ...minimal, entry_price: minimal.entry_price * 1.02 }); // 避免重复检测
    if (r2.status !== 409 || r2.body?.error !== 'EXPOSURE_LIMIT') {
      pass = false;
      console.error('[explim] FAIL: expect 409 EXPOSURE_LIMIT, got', r2.status, r2.body);
    } else {
      const msd = r2.body?.maxSameDirection;
      const cc = r2.body?.currentCount;
      const wh = r2.body?.windowHours;
      if (!(typeof msd === 'number' && msd >= 0) || !(typeof cc === 'number' && cc >= 0) || !(typeof wh === 'number')) {
        pass = false;
        console.error('[explim] FAIL fields: maxSameDirection/currentCount/windowHours invalid', { msd, cc, wh });
      } else {
        // 加严断言：数值关系与上下文一致性
        if (!(cc >= msd)) {
          pass = false;
          console.error('[explim] FAIL relation: currentCount should be >= maxSameDirection', { cc, msd });
        }
        // 由于我们把同向上限设置为 `same`，返回的 maxSameDirection 应与 `same` 一致
        if (msd !== same) {
          pass = false;
          console.error('[explim] FAIL relation: maxSameDirection should equal measured `same`', { msd, same });
        }
        // 如果返回了方向/符号，校验其合理性
        if (typeof r2.body.direction === 'string' && r2.body.direction !== pick) {
          pass = false;
          console.error('[explim] FAIL field: direction mismatch', { got: r2.body.direction, expect: pick });
        }
        if (typeof r2.body.symbol === 'string' && r2.body.symbol !== sym) {
          pass = false;
          console.error('[explim] FAIL field: symbol mismatch', { got: r2.body.symbol, expect: sym });
        }
        if (pass) {
          console.log('[explim] OK: EXPOSURE_LIMIT response fields valid', { msd, cc, wh });
        }
      }
      console.log('[explim] OK: second rejected by EXPOSURE_LIMIT');
    }
  } catch (e) {
    pass = false;
    console.error('[explim] EXCEPTION:', e.message);
  }

  if (pass) {
    console.log('[explim] PASS: all assertions satisfied');
    process.exit(0);
  } else {
    console.log('[explim] FAIL: some assertions failed');
    process.exit(1);
  }
}

main();