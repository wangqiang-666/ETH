#!/usr/bin/env node
const axios = require('axios');

(async () => {
  try {
    const port = process.env.PORT || process.argv[2] || '3035';
    const base = axios.create({ baseURL: `http://127.0.0.1:${port}/api`, timeout: 15000 });
    const p = {
      symbol: 'DBG-' + Date.now(),
      direction: 'LONG',
      entry_price: 1000,
      current_price: 1000,
      leverage: 2,
      position_size: 1,
      strategy_type: 'UNITTEST',
      ev: 0.05,
      ab_group: 'A',
      bypassCooldown: true
    };

    console.log('POST /recommendations');
    const cr = await base.post('/recommendations', p, { headers: { 'X-Loop-Guard': '1' } }).catch(e => e.response || { status: -1, data: e.message });
    console.log('CREATE', cr.status, JSON.stringify(cr.data, null, 2));
    const id = cr?.data?.data?.id;
    if (!id) {
      console.error('No id returned, abort');
      process.exit(2);
    }

    console.log(`GET /recommendations/${id}`);
    const gr = await base.get(`/recommendations/${id}`).catch(e => e.response || { status: -1, data: e.message });
    console.log('GET', gr.status, JSON.stringify(gr.data, null, 2));

    console.log(`PUT /recommendations/${id}/close`);
    const cl = await base.put(`/recommendations/${id}/close`, { reason: 'MANUAL_TEST' }).catch(e => e.response || { status: -1, data: e.message });
    console.log('CLOSE', cl.status, JSON.stringify(cl.data, null, 2));

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();