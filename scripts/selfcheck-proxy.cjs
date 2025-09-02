'use strict';
const axios = require('axios');
const dotenv = require('dotenv');
const os = require('os');
const http = require('http');
const https = require('https');

dotenv.config();

const proxyUrl = process.env.HK_PROXY_URL || process.env.PROXY_URL || 'http://43.132.123.32:8080';

function padRight(s, n) { return (s + ' '.repeat(n)).slice(0, n); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function formatError(e) {
  if (!e) return 'unknown error';
  const parts = [];
  if (e.code) parts.push(`code=${e.code}`);
  if (e.message) parts.push(`msg=${e.message}`);
  if (e.name) parts.push(`name=${e.name}`);
  if (e.response && e.response.status) parts.push(`status=${e.response.status}`);
  return parts.length ? parts.join(', ') : String(e);
}

async function fetchOnce(url, timeout = 20000) {
  const start = Date.now();
  try {
    const res = await axios.get(url, {
      timeout,
      validateStatus: () => true,
      headers: { 'Connection': 'close', 'Accept': 'application/json' },
      httpAgent: new http.Agent({ keepAlive: false }),
      httpsAgent: new https.Agent({ keepAlive: false })
    });
    const ms = Date.now() - start;
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      timeMs: ms,
      headers: res.headers,
      data: res.data
    };
  } catch (e) {
    const ms = Date.now() - start;
    return { ok: false, error: formatError(e), timeMs: ms };
  }
}

function printResult(title, r) {
  console.log(`\n=== ${title} ===`);
  if (!r) return;
  if (r.ok) {
    const xcache = r.headers?.['x-proxy-cache'] || r.headers?.['x-cache'] || '';
    const policy = r.headers?.['x-proxy-policy'] || '';
    console.log(`状态: ${r.status} | 耗时: ${r.timeMs}ms | X-Proxy-Cache: ${xcache} | Policy: ${policy}`);
    if (typeof r.data === 'string') {
      console.log(padRight(r.data, 256));
    } else {
      const body = JSON.stringify(r.data);
      console.log(padRight(body, 256));
    }
  } else {
    console.log(`失败: ${r.error} | 耗时: ${r.timeMs}ms`);
  }
}

(async () => {
  console.log('🔍 代理自检 - ETH 项目');
  console.log(`机器: ${os.hostname()} | 代理: ${proxyUrl}`);

  // 1) 代理健康
  const health = await fetchOnce(`${proxyUrl}/health`, 15000);
  printResult('代理健康检查 /health', health);

  // 2) /api/v5/public/time 两次（延迟 800–1200ms，二次失败重试一次 200–800ms）
  const t1 = await fetchOnce(`${proxyUrl}/api/v5/public/time`, 20000);
  printResult('公共时间 第一次', t1);
  await sleep(rand(800, 1200));
  let t2 = await fetchOnce(`${proxyUrl}/api/v5/public/time`, 20000);
  if (!t2.ok) {
    await sleep(rand(200, 800));
    const t2r = await fetchOnce(`${proxyUrl}/api/v5/public/time`, 20000);
    if (t2r.ok) console.log('(公共时间 第二次重试成功)');
    t2 = t2r;
  }
  printResult('公共时间 第二次', t2);

  // 3) /api/v5/system/status 两次（延迟 800–1200ms，二次失败重试一次 200–800ms）
  const s1 = await fetchOnce(`${proxyUrl}/api/v5/system/status`, 20000);
  printResult('系统状态 第一次', s1);
  await sleep(rand(800, 1200));
  let s2 = await fetchOnce(`${proxyUrl}/api/v5/system/status`, 20000);
  if (!s2.ok) {
    await sleep(rand(200, 800));
    const s2r = await fetchOnce(`${proxyUrl}/api/v5/system/status`, 20000);
    if (s2r.ok) console.log('(系统状态 第二次重试成功)');
    s2 = s2r;
  }
  printResult('系统状态 第二次', s2);

  console.log('\n📊 汇总:');
  const missHit = `${t1?.headers?.['x-proxy-cache'] || ''} -> ${t2?.headers?.['x-proxy-cache'] || ''}`;
  console.log(`public/time 缓存: ${missHit}`);
  console.log(`system/status 缓存: ${(s1?.headers?.['x-proxy-cache'] || '')} -> ${(s2?.headers?.['x-proxy-cache'] || '')}`);

  const ok = (t1?.ok && t2?.ok && s1?.ok && s2?.ok);
  console.log(`\n结论: ${ok ? '✅ 代理可用' : '⚠️ 部分接口异常，请检查网络或代理服务'}`);
})();