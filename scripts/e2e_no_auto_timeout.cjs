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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
    console.log('[no-auto-timeout] stopping tracker...');
    try { await post(base, '/tracker/stop', {}); } catch (e) { console.warn('stop tracker warn:', e.message); }
    await waitForTracker(base, false, 8000);

    const symbol = 'NO-TIMEOUT-' + Date.now();
    const createPayload = {
      symbol,
      direction: 'LONG',
      entry_price: 1000,
      current_price: 1000,
      leverage: 5,
      strategy_type: 'UNITTEST'
    };

    console.log('[no-auto-timeout] creating recommendation...');
    const created = await post(base, '/recommendations', createPayload);
    if (!created?.success) throw new Error('create failed: ' + JSON.stringify(created));
    const id = created.data?.id;
    if (!id) throw new Error('no id returned from create');
    console.log('[no-auto-timeout] created id:', id);

    console.log('[no-auto-timeout] backdating created_at by 25 hours...');
    const iso = await backdateCreatedAt(id, 25);
    console.log('[no-auto-timeout] created_at set to:', iso);

    console.log('[no-auto-timeout] starting tracker...');
    await post(base, '/tracker/start', {});
    await waitForTracker(base, true, 8000);

    // give the tracker a moment to run its immediate check()
    await sleep(3000);

    console.log('[no-auto-timeout] fetching detail to verify remains ACTIVE...');
    const detail = await get(base, `/recommendations/${id}`);
    if (!detail?.success) throw new Error('get detail failed: ' + JSON.stringify(detail));
    const rec = detail.data;
    console.log('[no-auto-timeout] detail.status:', rec.status, 'exit_reason:', rec.exit_reason, 'exit_time:', rec.exit_time);

    if (rec.status !== 'ACTIVE') {
      throw new Error(`assert failed: expected ACTIVE (no auto-timeout); got status=${rec.status}, reason=${rec.exit_reason}`);
    }

    console.log('[no-auto-timeout] PASS: record remained ACTIVE when MAX_HOLDING_HOURS<=0');
    process.exit(0);
  } catch (e) {
    console.error('[no-auto-timeout] FAIL:', e.message);
    process.exit(1);
  }
})();