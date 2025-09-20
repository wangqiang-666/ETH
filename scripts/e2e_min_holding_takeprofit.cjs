const http = require('http');

// 简易HTTP工具
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      hostname: 'localhost',
      port: Number(process.env.WEB_PORT || process.env.PORT || 3013),
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data ? data.length : 0,
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          const parsed = raw ? JSON.parse(raw) : {};
          resolve({ statusCode: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: raw });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function setPriceOverride(symbol, price, ttlMs = 120000) {
  const resp = await request('POST', '/api/testing/price-override', { symbol, price, ttlMs });
  console.log('price-override:', resp.statusCode, resp.body || '');
  return resp;
}

async function main() {
  console.log('--- e2e_min_holding_takeprofit start ---');

  // 1) 更新冷却为0，避免被限流
  const updateCfg = await request('POST', '/api/config', { signalCooldownMs: 1, oppositeCooldownMs: 1 });
  console.log('update config:', updateCfg.statusCode, updateCfg.body?.warnings || []);

  // 2) 先设置一个较低价格，确保尚未达到TP
  await setPriceOverride('ETH-USDT-SWAP', 2600, 120000);

  // 3) 创建推荐：设置一个容易达到的 TP，但初始价格未满足，待等待后再推高
  const entry = 2600;
  const body = {
    symbol: 'ETH-USDT-SWAP',
    direction: 'LONG',
    entry_price: entry,
    current_price: entry,
    leverage: 3,
    strategy_type: 'E2E_MIN_HOLD_' + Date.now(),
    take_profit_price: 2650
  };
  const t0 = Date.now();
  const createResp = await request('POST', '/api/recommendations', body);
  console.log('create:', createResp.statusCode, createResp.body);
  if (createResp.statusCode !== 201 || !createResp.body?.data?.id) {
    console.error('create failed');
    process.exit(1);
  }
  const id = createResp.body.data.id;

  // 4) 等待约65秒后将价格推高，触发TP
  await new Promise(r => setTimeout(r, 65000));
  await setPriceOverride('ETH-USDT-SWAP', 2663, 60000);

  // 5) 轮询详情直到状态从 ACTIVE 变为 CLOSED，或超时
  const start = Date.now();
  const timeoutMs = 3 * 60 * 1000; // 最长等3分钟
  let lastStatus = '';
  let closedAt = null;
  while (Date.now() - start < timeoutMs) {
    const detail = await request('GET', `/api/recommendations/${id}`);
    const data = detail.body?.data || {};
    const status = data.status || 'unknown';
    const result = data.result || 'unknown';
    if (status !== lastStatus) {
      console.log(`[${new Date().toISOString()}] status=${status} result=${result}`);
      lastStatus = status;
    }
    if (status === 'CLOSED') {
      closedAt = Date.now();
      console.log('Closed with result:', result);
      console.log('Final detail:', data);
      break;
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  if (!closedAt) {
    console.error('Timeout waiting for CLOSE');
    process.exit(1);
  }

  const elapsedSec = (closedAt - t0) / 1000;
  console.log(`Elapsed seconds until close: ${elapsedSec.toFixed(1)}s`);
  // 断言至少>=55s
  if (elapsedSec < 55) {
    console.error(`FAILED: Closed too early. Expected >= 55s due to min holding, got ${elapsedSec.toFixed(1)}s`);
    process.exit(1);
  }

  console.log('--- e2e_min_holding_takeprofit PASS ---');
}

main().catch((e) => {
  console.error('E2E script error:', e);
  process.exit(1);
});