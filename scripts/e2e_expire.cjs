const http = require('http');

function requestJSON(method, base, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d || '{}');
          resolve({ status: res.statusCode, json });
        } catch (e) {
          reject(new Error(`JSON parse failed: ${e.message}; raw=${d.slice(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const port = process.env.WEB_PORT || 3001;
  const base = process.env.API_BASE || `http://localhost:${port}`;
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  console.log('[BASE]', base);

  // 1) Try to get active recommendations
  const act = await requestJSON('GET', base, '/api/active-recommendations');
  assert(act.status === 200 && act.json && act.json.success === true, 'active list failed');
  let id = act.json?.data?.recommendations?.[0]?.id || null;

  // 2) Create one if none available
  if (!id) {
    const payload = {
      symbol: 'ETH-USDT-SWAP',
      direction: 'LONG',
      entry_price: 2500,
      current_price: 2500,
      leverage: 3,
      strategy_type: 'TEST'
    };
    const created = await requestJSON('POST', base, '/api/recommendations', payload);
    assert(created.status === 201 && created.json?.success === true, 'create failed');
    id = created.json.data.id;
    console.log('[CREATED]', id);
  } else {
    console.log('[PICKED_ACTIVE]', id);
  }

  // 3) Expire it
  const exp = await requestJSON('POST', base, `/api/recommendations/${id}/expire`, { reason: 'TIMEOUT' });
  assert(exp.status === 200 && exp.json?.success === true, 'expire failed');
  console.log('[EXPIRED_OK]', id);

  // 4) Fetch detail and validate status EXPIRED
  const detail = await requestJSON('GET', base, `/api/recommendations/${id}`);
  assert(detail.status === 200 && detail.json?.success === true, 'get detail failed');
  const status = detail.json?.data?.status;
  console.log('[DETAIL_STATUS]', status);
  assert(status === 'EXPIRED', `status should be EXPIRED but got ${status}`);

  // 5) Ensure it is not in active list now
  const act2 = await requestJSON('GET', base, '/api/active-recommendations');
  assert(act2.status === 200 && act2.json?.success === true, 'active list (after) failed');
  const exists = (act2.json?.data?.recommendations || []).some(r => r.id === id);
  assert(!exists, 'expired rec still in active list');
  console.log('[ACTIVE_CHECK_OK] not present');

  console.log(JSON.stringify({ ok: true, id, status }, null, 2));
})().catch(err => {
  console.error('E2E expire test failed:', err.message);
  process.exit(1);
});