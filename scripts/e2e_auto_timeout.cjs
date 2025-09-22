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
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(new Error(`POST ${route} JSON parse failed: ${e.message}; raw=${d.slice(0, 500)}`));
        }
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
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(new Error(`GET ${route} JSON parse failed: ${e.message}; raw=${d.slice(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 新增：在开始前等待 API 可达，避免 ECONNRESET
async function waitForAPI(base, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const st = await get(base, '/status');
      if (st && (st.success === true || st.data)) return true;
    } catch (_) {}
    await sleep(300);
  }
  throw new Error('web-server not reachable within ' + timeoutMs + 'ms');
}

async function waitForTracker(base, expectRunning, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const st = await get(base, '/status');
      const running = !!st?.data?.tracker?.is_running;
      if (running === expectRunning) return true;
    } catch (_) {}
    await sleep(300);
  }
  throw new Error(`tracker ${expectRunning ? 'start' : 'stop'} timeout`);
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

(async () => {
  const base = 'http://localhost:' + (process.env.WEB_PORT || 3001) + '/api';
  try {
    console.log('[auto-timeout] waiting for API to be reachable ...');
    await waitForAPI(base, 20000);
    console.log('[auto-timeout] API is reachable');

    console.log('[auto-timeout] stopping tracker...');
    try { await post(base, '/tracker/stop', {}); } catch (e) { console.warn('stop tracker warn:', e.message); }
    await waitForTracker(base, false, 12000);

    // 更新运行时配置：确保超时阈值为 24 小时、最小持仓为 0 分钟，同时放宽并发/曝光限制，避免测试被风控拦截
    console.log('[auto-timeout] updating config: recommendation.maxHoldingHours=24, minHoldingMinutes=0, risk.maxSameDirectionActives=99 ...');
    try {
      const cfgResp = await post(base, '/config', {
        recommendation: { maxHoldingHours: 24, minHoldingMinutes: 0, concurrencyCountAgeHours: 0 },
        // 注意：服务端 /api/config 期望 maxSameDirectionActives 为顶层字段，而不是 risk 下
        maxSameDirectionActives: 99,
        // 如果服务端支持净敞口/小时限单，可一起放宽；服务端会忽略未知字段
        netExposureCaps: { total: 0, perDirection: { LONG: 0, SHORT: 0 } },
        hourlyOrderCaps: { total: 0, perDirection: { LONG: 0, SHORT: 0 } }
      });
      if (!cfgResp?.success) {
        console.warn('[auto-timeout] /config response not success:', cfgResp);
      }
    } catch (e) {
      console.warn('[auto-timeout] failed to update config (will proceed):', e.message);
    }

    const symbol = 'TEST-SYMBOL-' + Date.now();
    const createPayload = {
      symbol,
      direction: 'LONG',
      entry_price: 1000,
      current_price: 1000,
      leverage: 5,
      strategy_type: 'UNITTEST'
    };

    console.log('[auto-timeout] creating recommendation...');
    const created = await post(base, '/recommendations', createPayload);
    if (!created?.success) throw new Error('create failed: ' + JSON.stringify(created));
    const id = created.data?.id;
    if (!id) throw new Error('no id returned from create');
    console.log('[auto-timeout] created id:', id);

    console.log('[auto-timeout] backdating created_at by 25 hours...');
    const iso = await backdateCreatedAt(id, 25);
    console.log('[auto-timeout] created_at set to:', iso);

    console.log('[auto-timeout] starting tracker...');
    await post(base, '/tracker/start', {});
    await waitForTracker(base, true, 12000);

    // give the tracker a moment to run its immediate check()
    await sleep(3000);

    console.log('[auto-timeout] fetching detail to verify CLOSED+TIMEOUT...');
    const detail = await get(base, `/recommendations/${id}`);
    if (!detail?.success) throw new Error('get detail failed: ' + JSON.stringify(detail));
    const rec = detail.data;
    console.log('[auto-timeout] detail.status:', rec.status, 'exit_reason:', rec.exit_reason, 'exit_time:', rec.exit_time);

    if (!(rec.status === 'CLOSED' && rec.exit_reason === 'TIMEOUT' && rec.exit_time)) {
      throw new Error(`assert failed: expected CLOSED/TIMEOUT; got status=${rec.status}, reason=${rec.exit_reason}, exit_time=${rec.exit_time}`);
    }

    console.log('[auto-timeout] verifying it is no longer in active list...');
    const actives = await get(base, '/active-recommendations');
    if (!actives?.success) throw new Error('get active failed: ' + JSON.stringify(actives));
    const list = Array.isArray(actives.data?.recommendations) ? actives.data.recommendations : [];
    // 新增：如果后端提供 count 字段，校验与列表长度一致
    if (typeof actives?.data?.count === 'number') {
      if (actives.data.count !== list.length) {
        throw new Error(`active count mismatch: count=${actives.data.count}, list.length=${list.length}`);
      }
    }
    const found = list.find(x => x.id === id);
    if (found) throw new Error('record still in active list');

    console.log('[auto-timeout] PASS: record was auto-expired and removed from active list');
    process.exit(0);
  } catch (e) {
    console.error('[auto-timeout] FAIL:', e.message);
    process.exit(1);
  }
})();