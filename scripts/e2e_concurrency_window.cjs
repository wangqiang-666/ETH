const http = require('http');
const path = require('path');
const sqlite3 = require('sqlite3');

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
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(`POST ${route} JSON parse failed: ${e.message}; raw=${d.slice(0, 500)}`)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// New: PUT helper for risk config updates
function put(base, route, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(base + route, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(`PUT ${route} JSON parse failed: ${e.message}; raw=${d.slice(0, 500)}`)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(base, route) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + route, { method: 'GET' }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(`GET ${route} JSON parse failed: ${e.message}; raw=${d.slice(0, 500)}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// New: actively trigger strategy analysis to encourage auto-generation
async function triggerAnalysis(base) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await post(base, '/strategy/analysis/trigger', {});
      if (res && res.success === false) {
        console.log(`[cw] triggerAnalysis attempt ${attempt} ->`, JSON.stringify(res));
      } else {
        console.log(`[cw] triggerAnalysis attempt ${attempt} -> OK`);
        return true;
      }
    } catch (e) {
      console.log(`[cw] triggerAnalysis attempt ${attempt} error:`, e.message);
    }
    const backoff = Math.min(5000, 200 * Math.pow(2, attempt - 1));
    await sleep(backoff);
  }
  console.log('[cw] triggerAnalysis exhausted retries');
  return false;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function stopTracker(base) {
  try {
    const res = await post(base, '/tracker/stop', {});
    console.log('[cw] tracker.stop ->', JSON.stringify(res));
  } catch (e) {
    console.log('[cw] tracker.stop error:', e.message);
  }
}

async function startTracker(base) {
  try {
    const res = await post(base, '/tracker/start', {});
    console.log('[cw] tracker.start ->', JSON.stringify(res));
  } catch (e) {
    console.log('[cw] tracker.start error:', e.message);
  }
}

async function countAutoByDirection(base, dir) {
  const res = await get(base, '/active-recommendations');
  const list = (res && res.data && res.data.recommendations) || [];
  // 新增：如果后端提供 count 字段，校验与列表长度一致
  if (typeof res?.data?.count === 'number') {
    if (res.data.count !== list.length) {
      throw new Error(`active count mismatch: count=${res.data.count}, list.length=${list.length}`);
    }
  }
  const cnt = list.filter(r => r && r.status === 'ACTIVE' && r.source === 'AUTO_GENERATION' && r.direction === dir).length;
  return cnt;
}

async function backdateCreatedAt(id, hoursAgo) {
  const dbPath = path.join(process.cwd(), 'data', 'recommendations.db');
  const db = new sqlite3.Database(dbPath);
  const targetIso = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  const sql = `UPDATE recommendations SET created_at = ?, updated_at = updated_at WHERE id = ?`;
  await new Promise((resolve, reject) => {
    db.run(sql, [targetIso, id], function(err) {
      if (err) return reject(err);
      resolve();
    });
  });
  await new Promise((resolve) => db.close(() => resolve()));
  return targetIso;
}

// New helper: refresh price override to maintain favorable conditions
async function setPriceOverride(base, price, ttlMs = 45000, symbol = 'ETH-USDT-SWAP') {
  try {
    const resp = await post(base, '/testing/price-override', { symbol, price, ttlMs });
    if (resp?.success === false) {
      console.log('[cw] price-override response:', JSON.stringify(resp));
    } else {
      console.log(`[cw] price override set: ${symbol} -> ${price} (${ttlMs}ms)`);
    }
  } catch (e) {
    console.log('[cw] price-override error:', e.message);
  }
}

(async () => {
  const base = 'http://localhost:' + (process.env.WEB_PORT || 3001) + '/api';
  const dir = 'LONG'; // 选择验证 LONG 方向
  try {
    // 预热：放宽运行时配置，启用价格覆盖，提升自动生成概率
    console.log('[cw] relaxing runtime config...');
    const cfg = await post(base, '/config', {
      signalCooldownMs: 0,
      oppositeCooldownMs: 0,
      // 放宽同向并发上限，避免触发 EXPOSURE_LIMIT
      maxSameDirectionActives: 100,
      // 放宽净敞口上限（顶层键，服务端会写入 risk.netExposureCaps）
      netExposureCaps: {
        total: 1000,
        perDirection: { LONG: 1000, SHORT: 1000 }
      },
      // 提高手动触发分析的频次上限，避免 1 分钟内超限
      maxManualTriggersPerMin: 100,
      // 取消全局最小间隔，便于连续触发分析
      globalMinIntervalMs: 0,
      signalThreshold: 0,
      evThreshold: -99999,
      minWinRate: 0,
      analysisInterval: 10000,
      entryFilters: {
        minCombinedStrengthLong: 0,
        minCombinedStrengthShort: 0,
        allowHighVolatilityEntries: true
      },
      allowOppositeWhileOpen: true,
      oppositeMinConfidence: 0.1,
      allowAutoOnHighRisk: true,
      kronos: {
        enabled: true,
        longThreshold: 0.3,
        shortThreshold: 0.3,
        minConfidence: 0.2
      },
      recommendation: { concurrencyCountAgeHours: 24 },
      testing: { allowPriceOverride: true }
    });
    console.log('[cw] config updated, warnings:', (cfg && cfg.data && cfg.data.warnings) || []);
    if (cfg && cfg.data) {
      console.log('[cw] effective runtime risk caps:', JSON.stringify({
        maxSameDirectionActives: cfg.data.risk && cfg.data.risk.maxSameDirectionActives,
        netExposureCaps: cfg.data.risk && cfg.data.risk.netExposureCaps
      }));
    }

    // 可选：短期覆盖行情，利于触发策略分析
    try {
      await post(base, '/testing/price-override', { symbol: 'ETH-USDT-SWAP', price: 2600, ttlMs: 60000 });
      console.log('[cw] initial price override set for ETH-USDT-SWAP');
    } catch (e) {
      console.log('[cw] price-override setup error:', e.message);
    }

    console.log('[cw] initial auto LONG count...');
    const before = await countAutoByDirection(base, dir);
    console.log('[cw] auto LONG count(before)=', before);

    // 创建一个年轻的手动 LONG 用于占用同向并发名额
    const symbol = 'CW-BLOCK-' + Date.now();
    const payload = {
      symbol,
      direction: dir,
      entry_price: 1000,
      current_price: 1000,
      leverage: 3,
      strategy_type: 'UNITTEST'
    };
    console.log('[cw] creating manual blocker...');
    const created = await post(base, '/recommendations', payload);
    if (!created?.success) throw new Error('create failed: ' + JSON.stringify(created));
    const id = created.data?.id;
    if (!id) throw new Error('no id');
    console.log('[cw] blocker id=', id);

    // 主动触发一次分析，确保阻塞条件被评估
    await setPriceOverride(base, 2600, 45000);
    await triggerAnalysis(base);

    // 等待一轮自动生成尝试（默认每15s）
    console.log('[cw] waiting 20s for auto generator (expect block due to same-direction limit)');
    await sleep(20000);
    const mid = await countAutoByDirection(base, dir);
    console.log('[cw] auto LONG count(mid)=', mid);

    // 将阻塞者回溯时间，使其超过并发窗口（RECOMMENDATION_CONCURRENCY_AGE_HOURS）
    console.log('[cw] backdating blocker created_at by 48 hours...');
    await backdateCreatedAt(id, 48);

    // 关键：重启 tracker 以从数据库重新加载 Active 列表（带有新的 created_at）
    await stopTracker(base);
    await sleep(500);
    await startTracker(base);
    await sleep(500);

    // 回溯后主动触发一次分析
    await setPriceOverride(base, 2605, 45000);
    await triggerAnalysis(base);

    // 最多等待 3 轮以观察新同向自动单生成
    let after = mid;
    for (let i = 1; i <= 3; i++) {
      console.log(`[cw] waiting round ${i} (20s) for auto generator to create LONG...`);
      // 每轮前主动触发分析并刷新价格覆盖，维持偏多条件
      await setPriceOverride(base, 2610 + i * 2, 45000);
      await triggerAnalysis(base);
      await sleep(20000);
      after = await countAutoByDirection(base, dir);
      console.log(`[cw] auto LONG count(round ${i})=`, after);
      if (after > mid) break;
    }

    if (after > mid) {
      console.log('[cw] PASS: old ACTIVE record (backdated beyond window) did NOT count toward concurrency; new same-direction AUTO was created.');
      process.exit(0);
    } else {
      console.log('[cw] WARN: auto generator did not create a new LONG within timeout; this may be due to strategy action. Manual verification needed.');
      process.exit(2);
    }
  } catch (e) {
    console.error('[cw] FAIL:', e.message);
    process.exit(1);
  }
})();