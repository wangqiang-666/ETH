#!/usr/bin/env node
/*
 E2E smoke test using real endpoints:
 - Fetch /api/market/kline and /api/market/ticker
 - Try /api/strategy/analysis; if null, optionally start strategy then fallback to synthesized signals
 - Build minimal payload for /api/backtest/run
 - Generate performance report via /api/backtest/performance-report
 - Save outputs to files
*/

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const WEB_PORT = process.env.WEB_PORT || '3010';
const BASE = process.env.BASE_URL || `http://localhost:${WEB_PORT}`;
const SYMBOL = process.env.SYMBOL || 'ETH-USDT-SWAP';
const INTERVAL = process.env.INTERVAL || '1m';
const LIMIT = parseInt(process.env.LIMIT || '1440', 10);

const OUT_DIR = process.cwd();
const LAST_PAYLOAD = path.join(OUT_DIR, 'last_minimal_payload.json');
const RESULT_FILE = path.join(OUT_DIR, 'backtest_smoke_real.json');

const http = axios.create({ baseURL: BASE, timeout: 8000 });

async function saveJSON(file, data) {
  await fs.promises.writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
}

async function getJSON(url, params = {}) {
  const { data } = await http.get(url, { params });
  if (data && data.success === false && data.error) {
    throw new Error(`GET ${url} failed: ${data.error}`);
  }
  return data?.data ?? data;
}

async function postJSON(url, body) {
  const { data } = await http.post(url, body);
  if (data && data.success === false && data.error) {
    throw new Error(`POST ${url} failed: ${data.error}`);
  }
  return data;
}

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

function parseIntervalMs(s) {
  if (!s || typeof s !== 'string') return 60_000;
  const m = s.match(/^(\d+)\s*([mMhH])$/);
  if (!m) return 60_000;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  return unit === 'h' ? n * 60 * 60_000 : n * 60_000;
}

function generateSyntheticKlines(limit = 240, interval = '1m', seedPrice = 2000) {
  const out = [];
  const stepMs = parseIntervalMs(interval);
  const startTs = Date.now() - stepMs * limit;
  let price = seedPrice;
  for (let i = 0; i < limit; i++) {
    const ts = startTs + i * stepMs;
    const drift = 0.00005; // small drift
    const vol = 0.003; // per-bar volatility
    const change = (Math.random() - 0.5) * vol + (Math.random() > 0.5 ? drift : -drift);
    const open = price;
    const close = Math.max(1, open * (1 + change));
    const high = Math.max(open, close) * (Math.random() * 0.0015 + 1);
    const low = Math.min(open, close) * (1 - Math.random() * 0.0015);
    const volume = 100 + Math.random() * 900;
    out.push({ timestamp: ts, open, high, low, close, volume });
    price = close;
  }
  return out;
}

function synthesizeSignalFromTicker(ticker, direction = 'BUY') {
  const price = ticker?.price ?? 0;
  const buy = direction === 'BUY';
  const rr = 2.0;
  const sl = buy ? price * 0.99 : price * 1.01;
  const tp = buy ? price * 1.01 : price * 0.99;
  return {
    signal: buy ? 'BUY' : 'SELL',
    strength: { technical: 50, ml: 50, combined: 60, confidence: 0.7 },
    targetPrice: tp,
    stopLoss: sl,
    takeProfit: tp,
    riskReward: rr,
    positionSize: 0.05,
    timeframe: '1m',
    reasoning: { technical: 'synthetic', ml: 'synthetic', risk: 'synthetic', final: 'synthetic for smoke test' },
    metadata: {
      timestamp: ticker?.timestamp || Date.now(),
      marketCondition: 'RANGING',
      volatility: 0.5,
      volume: 'MEDIUM',
      momentum: 'NEUTRAL'
    }
  };
}

function buildSignalsFromAnalysis(analysis, klines) {
  // analysis may be null; when present it should include { signal: SmartSignalResult }
  const desired = Math.min(64, Math.max(12, Math.floor((klines?.length || 0) / 1000))); // ~1 signal per ~1000 bars
  const slots = desired; // increase spaced signals to improve sample size on long windows
  const idx = (i) => Math.max(0, Math.min(klines.length - 1, Math.floor((i / (slots + 1)) * klines.length)));
  const timestamps = Array.from({ length: slots }, (_, i) => klines[idx(i + 1)]?.timestamp || Date.now());

  const base = analysis?.signal; // SmartSignalResult or undefined
  let seed;
  if (base && typeof base === 'object') {
    seed = clone(base);
    // ensure required fields exist with sensible defaults
    seed.strength = seed.strength || { technical: 50, ml: 50, combined: 60, confidence: 0.7 };
    if (typeof seed.strength.confidence !== 'number') seed.strength.confidence = 0.7;
    if (typeof seed.riskReward !== 'number') seed.riskReward = 2.0;
    if (typeof seed.stopLoss !== 'number' || typeof seed.takeProfit !== 'number') {
      const p = klines[Math.floor(klines.length * 0.8)]?.close || klines[0]?.close || 0;
      const buy = normalizeToEngineSignal(seed.signal) === 'BUY';
      seed.stopLoss = buy ? p * 0.99 : p * 1.01;
      seed.takeProfit = buy ? p * 1.01 : p * 0.99;
    }
    if (!seed.timeframe) seed.timeframe = '1m';
    if (!seed.reasoning || typeof seed.reasoning !== 'object') {
      seed.reasoning = { technical: 'from analysis', ml: 'from analysis', risk: 'from analysis', final: 'seeded' };
    }
  }

  // Build array with spaced timestamps and normalize signal to BUY/SELL for BacktestEngine
  const signals = timestamps.map((ts, i) => {
    const alt = i % 2 === 0 ? 'BUY' : 'SELL';
    const s = seed ? clone(seed) : synthesizeSignalFromTicker(null, alt);
    s.signal = normalizeToEngineSignal(s.signal, alt);
    // ensure strength/confidence exist
    if (!s.strength) s.strength = { technical: 50, ml: 50, combined: 60, confidence: 0.7 };
    if (typeof s.strength.confidence !== 'number') s.strength.confidence = 0.7;
    // ensure stop/take present
    if (typeof s.stopLoss !== 'number' || typeof s.takeProfit !== 'number') {
      const p = klines[Math.max(0, Math.min(klines.length - 1, Math.floor(klines.length * (0.05 + 0.9 * (i + 1) / (slots + 1)))))]?.close || klines[0]?.close || 0;
      const buy = s.signal === 'BUY';
      s.stopLoss = buy ? p * 0.99 : p * 1.01;
      s.takeProfit = buy ? p * 1.01 : p * 0.99;
    }
    s.metadata = Object.assign({}, s.metadata || {}, { timestamp: ts });
    return s;
  });

  try { console.log('[SMOKE] Signals:', signals.map(x => x.signal).join(',')); } catch {}
  return signals;
}

async function main() {
  console.log(`[SMOKE] Base: ${BASE}`);
  // Step 1: Pull market data
  let klines;
  try {
    klines = await getJSON('/api/market/kline', { symbol: SYMBOL, interval: INTERVAL, limit: LIMIT });
  } catch (e) {
    console.warn(`[SMOKE] /api/market/kline failed: ${e?.message || e}`);
    klines = null;
  }
  if (!Array.isArray(klines) || klines.length < 10) {
    const risk = await getJSON(`/api/risk/assessment/${SYMBOL}`).catch(() => null);
    const seedPrice = risk?.marketData?.price ?? 2000;
    klines = generateSyntheticKlines(LIMIT, INTERVAL, seedPrice);
    console.log(`[SMOKE] Using synthetic klines: ${klines.length}`);
  } else {
    console.log(`[SMOKE] Klines fetched: ${klines.length}`);
  }

  let ticker;
  try {
    ticker = await getJSON('/api/market/ticker', { symbol: SYMBOL });
  } catch (e) {
    console.warn(`[SMOKE] /api/market/ticker failed: ${e?.message || e}`);
  }
  if (!ticker || typeof ticker.price !== 'number') {
    const risk = await getJSON(`/api/risk/assessment/${SYMBOL}`).catch(() => null);
    ticker = risk?.marketData ?? { price: klines[klines.length - 1]?.close, timestamp: klines[klines.length - 1]?.timestamp };
  }
  console.log(`[SMOKE] Ticker price: ${ticker?.price}`);

  // Step 2: Try to get latest analysis
  let analysis = await getJSON('/api/strategy/analysis').catch(() => null);
  if (!analysis) {
    // attempt to start strategy (best-effort)
    try {
      await postJSON('/api/strategy/start', {});
      await new Promise(r => setTimeout(r, 1500));
      analysis = await getJSON('/api/strategy/analysis').catch(() => null);
    } catch (e) {
      console.warn('[SMOKE] Strategy start not available, continuing with synthetic signals');
    }
  }
  console.log(`[SMOKE] Analysis available: ${!!analysis}`);

  // Step 3: Build signals
  const signals = buildSignalsFromAnalysis(analysis, klines);
  // Step 4: Build marketData (minimal fields required by engine: timestamp, price)
  const marketData = klines.map(k => ({ timestamp: k.timestamp, price: k.close }));

  const startDate = new Date(klines[0].timestamp).toISOString();
  const endDate = new Date(klines[klines.length - 1].timestamp).toISOString();

  const config = {
    startDate,
    endDate,
    initialCapital: 10000,
    maxPositionSize: 0.1,
    tradingFee: 0.001,
    slippage: 0.001,
    maxHoldingTime: 6,
    riskManagement: {
      maxDailyLoss: 0.05,
      maxDrawdown: 0.2,
      positionSizing: 'RISK_PARITY'
    }
  };

  const payload = { config, signals, marketData };
  await saveJSON(LAST_PAYLOAD, payload);
  console.log(`[SMOKE] Payload saved: ${path.basename(LAST_PAYLOAD)} [signals=${signals.length}, md=${marketData.length}]`);
  // 复制到 public 目录，供前端页面 /last_minimal_payload.json 读取
  try {
    const publicPayload = path.resolve(__dirname, '..', 'public', 'last_minimal_payload.json');
    await saveJSON(publicPayload, payload);
    console.log(`[SMOKE] Payload copied to public: ${publicPayload}`);
  } catch (e) {
    console.warn('[SMOKE] Failed to copy payload to public:', e?.message || e);
  }

  // Step 5: Run backtest
  const runResp = await postJSON('/api/backtest/run', payload);
  const backtestResult = runResp?.result || runResp?.data?.result || runResp;
  if (!backtestResult) throw new Error('No backtest result received');
  console.log('[SMOKE] Backtest completed.');

  // Step 6: Generate performance report
  const reportResp = await postJSON('/api/backtest/performance-report', { backtestResult });
  const report = reportResp?.report || reportResp?.data?.report || reportResp;

  const summary = report?.summary || backtestResult?.summary || {};
  const output = {
    timestamp: Date.now(),
    baseUrl: BASE,
    symbol: SYMBOL,
    interval: INTERVAL,
    stats: {
      totalTrades: summary.totalTrades,
      winRate: summary.winRate,
      totalReturn: summary.totalReturn,
      totalReturnPercent: summary.totalReturnPercent,
      sharpeRatio: summary.sharpeRatio,
      annualizedReturn: summary.annualizedReturn,
      observationDays: summary.observationDays,
      sampleQuality: summary.sampleQuality
    },
    summary,
    notes: analysis ? 'Used live analysis with spaced timestamps.' : 'Analysis unavailable; used synthesized signals.'
  };

  await saveJSON(RESULT_FILE, output);
  console.log(`[SMOKE] Result saved: ${path.basename(RESULT_FILE)}`);
  console.log('[SMOKE] Key stats:', output.stats);
}

main().catch(async (err) => {
  console.error('[SMOKE] Failed:', err?.message || err);
  try {
    // save error file for inspection
    await saveJSON(RESULT_FILE, { error: err?.message || String(err), ts: Date.now() });
  } catch {}
  process.exit(1);
});


function normalizeToEngineSignal(sig, fallback = 'BUY') {
  switch (sig) {
    case 'BUY':
    case 'SELL':
      return sig;
    case 'STRONG_BUY':
      return 'BUY';
    case 'STRONG_SELL':
      return 'SELL';
    case 'HOLD':
    default:
      return fallback === 'SELL' ? 'SELL' : 'BUY';
  }
}