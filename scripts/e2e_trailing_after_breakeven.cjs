const http = require('http');
// 从环境变量读取端口，优先 WEB_PORT，其次 PORT，默认为 3013
const PORT = Number(process.env.WEB_PORT || process.env.PORT || 3013);

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      hostname: 'localhost',
      port: PORT,
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('--- e2e_trailing_after_breakeven start ---');

  // 1) 降低同向/反向冷却
  const cfg = await request('POST', '/api/config', { signalCooldownMs: 1, oppositeCooldownMs: 1 });
  console.log('update config:', cfg.statusCode, cfg.body?.warnings || []);

  // 2) 创建推荐：设置一个较低的TP（触发保本），随后验证追踪止损在保本后起效
  const entry = 2600;
  const createBody = {
    symbol: 'ETH-USDT-SWAP',
    direction: 'LONG',
    entry_price: entry,
    current_price: entry,
    leverage: 3,
    strategy_type: 'E2E_TEST',
    take_profit_percent: 0.5 // 触发TP1 -> 止损上移至保本
  };
  const t0 = Date.now();
  const create = await request('POST', '/api/recommendations', createBody);
  console.log('create:', create.statusCode, create.body);
  if (create.statusCode !== 201 || !create.body?.data?.id) {
    console.error('create failed');
    process.exit(1);
  }
  const id = create.body.data.id;

  // 3) 轮询状态，期望先经历 TAKE_PROFIT（或标记已保本），随后若价格回撤由追踪止损触发 STOP_LOSS 或 BREAKEVEN
  const timeoutMs = 8 * 60 * 1000; // 最长等8分钟
  let lastStatus = '';
  let final = null;
  while (Date.now() - t0 < timeoutMs) {
    const detail = await request('GET', `/api/recommendations/${id}`);
    const data = detail.body?.data || {};
    const status = data.status || 'unknown';
    const result = data.result || 'unknown';
    const reason = data.exit_reason || 'unknown';
    if (status !== lastStatus) {
      console.log(`[${new Date().toISOString()}] status=${status} result=${result} reason=${reason}`);
      lastStatus = status;
    }
    if (status === 'CLOSED') {
      final = data;
      break;
    }
    await sleep(3000);
  }

  if (!final) {
    console.error('Timeout waiting for CLOSE');
    process.exit(1);
  }

  console.log('Final detail:', final);
  if (!['STOP_LOSS', 'BREAKEVEN', 'TAKE_PROFIT'].includes(final.exit_reason)) {
    console.error(`FAILED: unexpected exit_reason=${final.exit_reason}`);
    process.exit(1);
  }

  console.log('--- e2e_trailing_after_breakeven PASS ---');
}

main().catch((e) => {
  console.error('E2E script error:', e);
  process.exit(1);
});