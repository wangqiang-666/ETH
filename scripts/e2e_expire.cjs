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
  // 新增：校验后端返回的去重数量与列表长度一致
  const _list1 = Array.isArray(act.json?.data?.recommendations) ? act.json.data.recommendations : [];
  const _count1 = act.json?.data?.count;
  if (typeof _count1 === 'number') {
    assert(_count1 === _list1.length, `active count mismatch: count=${_count1}, list.length=${_list1.length}`);
  }
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

  // 4) Fetch detail and validate CLOSED + TIMEOUT
  const detail = await requestJSON('GET', base, `/api/recommendations/${id}`);
  assert(detail.status === 200 && detail.json?.success === true, 'get detail failed');
  const rec = detail.json?.data || {};
  const status = rec.status;
  const reason = rec.exit_reason;
  console.log('[DETAIL_STATUS]', status, 'reason=', reason);
  assert(status === 'CLOSED' && reason === 'TIMEOUT', `expect CLOSED/TIMEOUT but got ${status}/${reason}`);

  // 5) Ensure it is not in active list now
  const act2 = await requestJSON('GET', base, '/api/active-recommendations');
  assert(act2.status === 200 && act2.json?.success === true, 'active list (after) failed');
  // 新增：再次校验 count 与列表长度一致
  const _list2 = Array.isArray(act2.json?.data?.recommendations) ? act2.json.data.recommendations : [];
  const _count2 = act2.json?.data?.count;
  if (typeof _count2 === 'number') {
    assert(_count2 === _list2.length, `active count(after) mismatch: count=${_count2}, list.length=${_list2.length}`);
  }
  const exists = (act2.json?.data?.recommendations || []).some(r => r.id === id);
  assert(!exists, 'expired rec still in active list');
  console.log('[ACTIVE_CHECK_OK] not present');

  console.log(JSON.stringify({ ok: true, id, status }, null, 2));
})().catch(err => {
  console.error('E2E expire test failed:', err.message);
  process.exit(1);
});