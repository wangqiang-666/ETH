// dynamic import when needed to avoid proxy side effects
let enhancedOKXDataService: any;
async function getEnhancedService() {
  if (!enhancedOKXDataService) {
    const mod = await import('../services/enhanced-okx-data-service');
    enhancedOKXDataService = mod.enhancedOKXDataService;
  }
  return enhancedOKXDataService;
}

import { TechnicalIndicatorAnalyzer, KlineData } from '../indicators/technical-indicators';
import { config } from '../config';
import { OKXDataService } from '../services/okx-data-service';
import * as fs from 'fs';
import * as path from 'path';

interface CliOptions {
  symbol: string;
  tf: string; // timeframe
  limit: number;
  closedOnly: boolean;
  provider: 'auto' | 'base' | 'enhanced';
  jsonOut?: string;
}

function parseArgs(): CliOptions {
  const argv = process.argv.slice(2);
  const opts: CliOptions = {
    symbol: config.trading?.defaultSymbol || 'ETH-USDT-SWAP',
    tf: '1H',
    limit: 120,
    closedOnly: true,
    provider: 'auto',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--symbol' && argv[i + 1]) opts.symbol = argv[++i];
    else if ((a === '--tf' || a === '--timeframe') && argv[i + 1]) opts.tf = argv[++i];
    else if (a === '--limit' && argv[i + 1]) opts.limit = Math.max(1, parseInt(argv[++i], 10) || 120);
    else if (a === '--include-open') opts.closedOnly = false;
    else if (a === '--provider' && argv[i + 1]) {
      const p = (argv[++i] || '').toLowerCase();
      if (p === 'base' || p === 'enhanced' || p === 'auto') opts.provider = p as any;
    } else if (a === '--json-out' && argv[i + 1]) {
      opts.jsonOut = argv[++i];
    }
  }
  return opts;
}

function isFiniteNumber(v: any): v is number {
  return typeof v === 'number' && Number.isFinite(v) && !Number.isNaN(v);
}

async function fetchWithBase(symbol: string, tf: string, limit: number) {
  const svc = new OKXDataService();
  const [ticker, klines] = await Promise.all([
    svc.getTicker(symbol),
    svc.getKlineData(symbol, tf as any, limit as any),
  ]);
  return { ticker, klines };
}

async function fetchWithEnhanced(symbol: string, tf: string, limit: number) {
  const svc = await getEnhancedService();
  const [ticker, klines] = await Promise.all([
    svc.getTicker(symbol),
    svc.getKlineData(symbol, tf as any, limit as any),
  ]);
  return { ticker, klines };
}

// 动态阈值：不同时间框允许的 ticker/close 差异（百分比）
const PRICE_DIFF_THRESHOLDS: Record<string, number> = {
  '1m': 0.6,
  '5m': 0.8,
  '15m': 1.0,
  '1H': 1.5,
  '4H': 2.5,
  '1D': 3.5,
};
function getPriceDiffLimit(tf: string): number {
  return PRICE_DIFF_THRESHOLDS[tf] ?? 1.0;
}

async function main() {
  const { symbol, tf, limit, closedOnly, provider, jsonOut } = parseArgs();
  console.log(`▶️ 验证数据准确性: symbol=${symbol}, timeframe=${tf}, limit=${limit}, closedOnly=${closedOnly}, provider=${provider}`);

  try {
    if (config.indicators) {
      (config.indicators as any).closedOnly = closedOnly;
    }

    let ticker: any = null;
    let klines: KlineData[] = [];

    const tryBase = async () => {
      try {
        const r = await fetchWithBase(symbol, tf, limit);
        if (r.ticker && r.klines?.length) return r;
      } catch {}
      return { ticker: null, klines: [] as KlineData[] };
    };
    const tryEnhanced = async () => {
      try {
        const r = await fetchWithEnhanced(symbol, tf, limit);
        if (r.ticker && r.klines?.length) return r;
      } catch {}
      return { ticker: null, klines: [] as KlineData[] };
    };

    if (provider === 'base') {
      ({ ticker, klines } = await tryBase());
    } else if (provider === 'enhanced') {
      ({ ticker, klines } = await tryEnhanced());
    } else {
      ({ ticker, klines } = await tryBase());
      if (!ticker || !klines.length) {
        console.warn('⚠️ 基础服务获取失败或数据为空，尝试使用增强服务...');
        ({ ticker, klines } = await tryEnhanced());
      }
    }

    if (!ticker) {
      console.error('❌ 获取 ticker 失败');
      process.exitCode = 1;
      return;
    }
    if (!klines || klines.length === 0) {
      console.error('❌ 获取 K线失败或为空');
      process.exitCode = 1;
      return;
    }

    const sortedAscending = klines.every((k, i) => i === 0 || k.timestamp >= klines[i - 1].timestamp);
    const last = klines[klines.length - 1];
    const first = klines[0];

    if (!sortedAscending) {
      console.warn('⚠️ K线未按时间升序排列，尝试排序');
      klines.sort((a, b) => a.timestamp - b.timestamp);
    }

    const lastClose = last.close;
    const price = ticker.price;
    const priceDiffPct = Math.abs(price - lastClose) / (lastClose || 1) * 100;

    const analyzer = new TechnicalIndicatorAnalyzer([]);
    for (const k of klines as KlineData[]) {
      analyzer.addKlineData(k);
    }

    const ti = analyzer.calculateAllIndicators();

    const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
    checks.push({ name: 'K线数量>=50', ok: klines.length >= 50, detail: String(klines.length) });
    checks.push({ name: '时间升序', ok: sortedAscending });
    // 使用按时间框动态阈值
    const priceDiffLimit = getPriceDiffLimit(tf);
    checks.push({ name: `ticker/close差异<${priceDiffLimit}%`, ok: priceDiffPct < priceDiffLimit, detail: priceDiffPct.toFixed(3) + '%' });

    if (ti) {
      checks.push({ name: 'RSI为有限数且在[0,100]', ok: isFiniteNumber(ti.rsi) && ti.rsi >= 0 && ti.rsi <= 100, detail: String(ti.rsi) });
      checks.push({ name: 'MACD.histogram为有限数', ok: isFiniteNumber(ti.macd?.histogram), detail: String(ti.macd?.histogram) });
      checks.push({ name: 'ADX为有限数', ok: isFiniteNumber(ti.adx), detail: String(ti.adx) });
      checks.push({ name: '成交量比为有限数', ok: isFiniteNumber(ti.volume?.ratio), detail: String(ti.volume?.ratio) });
      if ((ti as any).vwap) checks.push({ name: 'VWAP距离为有限数', ok: isFiniteNumber((ti as any).vwap.distance), detail: String((ti as any).vwap.distance) });
    } else {
      checks.push({ name: '技术指标计算', ok: false, detail: 'calculateAllIndicators 返回 null（样本不足或异常）' });
    }

    const summary = {
      symbol,
      timeframe: tf,
      limit,
      firstBarTime: new Date(first.timestamp).toISOString(),
      lastBarTime: new Date(last.timestamp).toISOString(),
      lastClose,
      tickerPrice: price,
      priceDiffPct: Number(priceDiffPct.toFixed(4)),
      indicators: ti ? {
        rsi: Number(ti.rsi.toFixed(2)),
        macd: {
          macd: Number(ti.macd.macd.toFixed(6)),
          signal: Number(ti.macd.signal.toFixed(6)),
          histogram: Number(ti.macd.histogram.toFixed(6)),
        },
        adx: Number(ti.adx.toFixed(2)),
        volumeRatio: Number((ti.volume?.ratio ?? 0).toFixed(2)),
        obvSlope: Number((ti as any).obv?.slope ?? 0),
      } : null,
      checks: checks.map(c => ({ name: c.name, ok: c.ok, detail: c.detail })),
    };

    const allOk = checks.every(c => c.ok);

    console.log('—— 数据校验结果 ——');
    console.log(JSON.stringify(summary, null, 2));

    if (jsonOut) {
      try {
        const outDir = path.dirname(jsonOut);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 2), 'utf-8');
        console.log(`📝 已写入JSON结果: ${jsonOut}`);
      } catch (e: any) {
        console.warn('⚠️ 写入JSON失败:', e?.message || String(e));
      }
    }

    if (allOk) {
      console.log('✅ 校验通过');
      process.exitCode = 0;
    } else {
      console.warn('⚠️ 校验存在警告/失败项');
      const failed = checks.filter(c => !c.ok).map(c => `${c.name}${c.detail ? ` (${c.detail})` : ''}`);
      console.warn('失败/警告项:', failed.join(', '));
      process.exitCode = 2;
    }
  } catch (err: any) {
    console.error('❌ 运行失败:', err?.message || String(err));
    process.exitCode = 1;
  }
}

main();