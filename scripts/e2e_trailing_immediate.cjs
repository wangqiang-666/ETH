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

async function setPriceOverride(symbol, price, ttlMs = 120000) {
  const resp = await request('POST', '/api/testing/price-override', { symbol, price, ttlMs });
  console.log('price-override:', resp.statusCode, resp.body || '');
  return resp;
}

async function clearPriceOverride(symbol) {
  const resp = await request('POST', '/api/testing/price-override/clear', symbol ? { symbol } : {});
  console.log('price-override/clear:', resp.statusCode, resp.body || '');
  return resp;
}

async function main() {
  console.log('--- e2e_trailing_immediate start ---');

  // 1) 降低同向/反向冷却，避免创建被限流；启用价格覆盖与立即追踪止损
  const cfg = await request('POST', '/api/config', {
    signalCooldownMs: 1,
    oppositeCooldownMs: 1,
    testing: { allowPriceOverride: true },
    recommendation: {
      trailing: {
        enabled: true,
        activateOnBreakeven: false,
        activateProfitPct: 0,
        percent: 1,
        minStep: 0,
        flex: { enabled: false }
      }
    }
  });
  console.log('update config:', cfg.statusCode, cfg.body?.warnings || []);

  // 参数
  const symbol = 'ETH-USDT-SWAP';
  const entry = 2600 + Math.random() * 5;

  // 2) 先设置价格在入场位附近，便于后续抬高触发追踪
  await setPriceOverride(symbol, Number(entry.toFixed(2)), 180000);

  // 3) 创建推荐：禁止TP（极高价），不设置固定SL，依赖“立即追踪止损（服务需配置 activateOnBreakeven=false）”
  const createBody = {
    symbol,
    direction: 'LONG',
    entry_price: entry,
    current_price: entry,
    leverage: 3,
    strategy_type: `E2E_IMMEDIATE_${Date.now()}`,
    take_profit_price: 9999999
  };
  const t0 = Date.now();
  const create = await request('POST', '/api/recommendations', createBody);
  console.log('create:', create.statusCode, create.body);
  if (create.statusCode !== 201 || !create.body?.data?.id) {
    console.error('create failed');
    process.exit(1);
  }
  const id = create.body.data.id;

  // 4) 抬高价格超过激活阈值（默认约>=2.2%），让追踪止损产生候选位
  const pump = Number((entry * 1.04).toFixed(2)); // +4%
  await setPriceOverride(symbol, pump, 120000);

  // 等待追踪止损写入 stop_loss_price
  let stopLoss = null;
  const waitSlStart = Date.now();
  while (Date.now() - waitSlStart < 90_000) { // 最多等90秒
    const detail = await request('GET', `/api/recommendations/${id}`);
    const data = detail.body?.data || {};
    stopLoss = data.stop_loss_price ?? data.stopLossPrice ?? null;
    const status = data.status || 'unknown';
    const result = data.result || 'unknown';
    if (stopLoss != null) {
      console.log(`[${new Date().toISOString()}] stop_loss_price=${stopLoss} status=${status} result=${result}`);
      break;
    }
    await sleep(3000);
  }

  if (stopLoss == null) {
    console.error('Failed to observe trailing stop_loss_price being set');
    process.exit(1);
  }

  // 5) 将价格打到止损价之下，触发 STOP_LOSS 关闭
  const dump = Number((stopLoss * 0.99).toFixed(2));
  await setPriceOverride(symbol, dump, 120000);

  // 6) 轮询状态直到 CLOSED
  const timeoutMs = 5 * 60 * 1000; // 最长等5分钟
  let lastStatus = '';
  let closedDetail = null;
  while (Date.now() - t0 < timeoutMs) {
    const detail = await request('GET', `/api/recommendations/${id}`);
    const data = detail.body?.data || {};
    const status = data.status || 'unknown';
    const result = data.result || 'unknown';
    const exitReason = data.exit_reason || data.exitReason || 'unknown';
    if (status !== lastStatus) {
      console.log(`[${new Date().toISOString()}] status=${status} result=${result} reason=${exitReason}`);
      lastStatus = status;
    }
    if (status === 'CLOSED') {
      closedDetail = data;
      break;
    }
    await sleep(3000);
  }

  if (!closedDetail) {
    console.error('Timeout waiting for CLOSE');
    process.exit(1);
  }

  console.log('Final detail:', closedDetail);
  if ((closedDetail.exit_reason || closedDetail.exitReason) !== 'STOP_LOSS') {
    console.error(`FAILED: expected exit_reason=STOP_LOSS (trailing), got ${closedDetail.exit_reason || closedDetail.exitReason}`);
    process.exit(1);
  }

  console.log('--- e2e_trailing_immediate PASS ---');
}

main().then(() => clearPriceOverride('ETH-USDT-SWAP')).catch(async (e) => {
  console.error('E2E script error:', e);
  try { await clearPriceOverride('ETH-USDT-SWAP'); } catch {}
  process.exit(1);
});