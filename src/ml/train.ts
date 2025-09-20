import { config } from '../config';
import { recommendationDatabase, type MLSampleRecord } from '../services/recommendation-database';
import fs from 'fs/promises';
import path from 'path';

// 简单的离线训练脚本：
// - 从 SQLite 中读取已回填标签的样本（label_ready=1 且 label_return 不为空）
// - 限定时间窗：config.ml.training.windowDays
// - 计算基础统计与阈值（基于 combined_strength 的简单阈值搜索）
// - 输出到 data/models/model.json

// 解析 CLI 参数（可选覆盖）
function parseCliArgs(argv: string[]) {
  const out: { windowDays?: number; labelWindow?: number; minSamples?: number; calibrate?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--windowDays' && v !== undefined) { out.windowDays = Number(v); i++; }
    else if (k === '--labelWindow' && v !== undefined) { out.labelWindow = Number(v); i++; }
    else if (k === '--minSamples' && v !== undefined) { out.minSamples = Number(v); i++; }
    else if (k === '--calibrate' && v !== undefined) { out.calibrate = (String(v).toLowerCase() === 'true'); i++; }
  }
  return out;
}

async function ensureDir(p: string) {
  try {
    await fs.mkdir(p, { recursive: true });
  } catch {}
}

function toUnixMs(d: Date | number): number {
  return typeof d === 'number' ? d : d.getTime();
}

function basicStats(values: number[]) {
  if (values.length === 0) return { count: 0, mean: 0, median: 0, std: 0, min: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (values.length || 1);
  const std = Math.sqrt(variance);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return { count: values.length, mean, median, std, min, max };
}

function pickThreshold(samples: MLSampleRecord[], side: 'long' | 'short', minSamples: number) {
  // 仅使用对应方向的样本
  const dirSet = side === 'long' ? new Set(['BUY', 'STRONG_BUY']) : new Set(['SELL', 'STRONG_SELL']);
  const sideSamples = samples.filter(s => dirSet.has((s.final_signal as any) || ''));
  if (sideSamples.length === 0) return { threshold: 60, winRate: 0, meanReturn: 0, count: 0 };

  let best = { threshold: 60, winRate: 0, meanReturn: 0, count: 0, score: -Infinity };
  for (let thr = 40; thr <= 90; thr += 1) {
    const subset = sideSamples.filter(s => typeof s.combined_strength === 'number' && (s.combined_strength as number) >= thr);
    if (subset.length < minSamples) continue; // 至少minSamples个样本以避免过拟合
    const returns = subset.map(s => (s.label_return as number));
    const wins = returns.filter(r => r > 0).length;
    const winRate = wins / subset.length;
    const meanReturn = returns.reduce((a, b) => a + b, 0) / subset.length;
    const score = winRate * meanReturn; // 简单目标：胜率与均值的乘积
    if (score > best.score) {
      best = { threshold: thr, winRate, meanReturn, count: subset.length, score } as any;
    }
  }
  return { threshold: best.threshold, winRate: best.winRate, meanReturn: best.meanReturn, count: best.count };
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const windowDays = Number.isFinite(cli.windowDays) ? (cli.windowDays as number) : ((config as any)?.ml?.training?.windowDays ?? 14);
  const labelHorizonMinutes = Number.isFinite(cli.labelWindow) ? (cli.labelWindow as number) : ((config as any)?.ml?.training?.labelHorizonMinutes ?? 60);
  const minSamples = Number.isFinite(cli.minSamples) ? Math.max(1, cli.minSamples as number) : 30;
  const doCalibrate = typeof cli.calibrate === 'boolean' ? (cli.calibrate as boolean) : true;

  const endTs = Date.now();
  const startTs = endTs - windowDays * 24 * 60 * 60 * 1000;

  console.log(`🧪 开始离线训练：窗口 ${windowDays} 天，标签窗口 ${labelHorizonMinutes} 分钟，最小样本 ${minSamples}，校准 ${doCalibrate ? '启用' : '禁用'}`);

  await recommendationDatabase.initialize();

  // 分页读取样本
  const pageSize = 1000;
  let offset = 0;
  const all: MLSampleRecord[] = [];

  while (true) {
    const { samples } = await recommendationDatabase.getMLSamples(pageSize, offset, { startTs, endTs });
    if (!samples || samples.length === 0) break;
    all.push(...samples);
    if (samples.length < pageSize) break;
    offset += pageSize;
  }

  const labeled = all.filter(s => s.label_ready === true && typeof s.label_return === 'number');
  if (labeled.length === 0) {
    console.warn('⚠️  训练窗口内没有可用的已标注样本');
  }

  const returns = labeled.map(s => s.label_return as number);
  const drawdowns = labeled.map(s => (typeof s.label_drawdown === 'number' ? (s.label_drawdown as number) : 0));

  const retStats = basicStats(returns);
  const ddStats = basicStats(drawdowns);
  const wins = returns.filter(r => r > 0).length;
  const winRate = labeled.length > 0 ? wins / labeled.length : 0;

  const thrLong = pickThreshold(labeled, 'long', minSamples);
  const thrShort = pickThreshold(labeled, 'short', minSamples);

  // === 基于分箱的概率校准（ml_confidence → 实际胜率） ===
  function clamp01(x: number) { return Math.max(0.0001, Math.min(0.9999, x)); }
  type Pair = { p: number; y: number };
  type Calib = { bins: Array<{ x: number; y: number; count: number }>; count: number; minBinSize: number } | null;
  const toPairs = (arr: MLSampleRecord[]): Pair[] => arr
    .filter(s => typeof s.ml_confidence === 'number' && Number.isFinite(s.ml_confidence as number) && typeof s.label_return === 'number')
    .map(s => ({ p: clamp01(s.ml_confidence as number), y: (s.label_return as number) > 0 ? 1 : 0 }));
  const sideOf = (sig: MLSampleRecord['final_signal']): 'long' | 'short' | null => (sig === 'BUY' || sig === 'STRONG_BUY') ? 'long' : ((sig === 'SELL' || sig === 'STRONG_SELL') ? 'short' : null);
  function buildBins(pairs: Pair[], numBins=10, minBinSize=minSamples): Calib {
    const arr = pairs.slice().sort((a,b)=>a.p-b.p);
    if (arr.length < minBinSize * 3) return null;
    const N = arr.length; const ideal = Math.floor(N/numBins); const binSize = Math.max(minBinSize, ideal);
    const bins: Array<{ x:number; y:number; count:number }> = [];
    for (let i=0;i<N;i+=binSize) {
      const slice = arr.slice(i, Math.min(N, i+binSize));
      if (slice.length < minBinSize) break;
      const meanP = slice.reduce((a,b)=>a+b.p,0)/slice.length;
      const win = slice.reduce((a,b)=>a+(b.y>0?1:0),0);
      const winRate = win / slice.length;
      bins.push({ x: meanP, y: clamp01(winRate), count: slice.length });
    }
    return bins.length >= 3 ? { bins, count: N, minBinSize: Math.max(minBinSize, Math.floor(N/numBins)) } : null;
  }
  const labeledWithConf = labeled.filter(s => typeof s.ml_confidence === 'number');
  const pairsAll = toPairs(labeledWithConf);
  const pairsLong = toPairs(labeledWithConf.filter(s => sideOf(s.final_signal) === 'long'));
  const pairsShort = toPairs(labeledWithConf.filter(s => sideOf(s.final_signal) === 'short'));
  const calibGlobal = doCalibrate ? buildBins(pairsAll, 10, minSamples) : null;
  const calibLong = doCalibrate ? buildBins(pairsLong, 8, minSamples) : null;
  const calibShort = doCalibrate ? buildBins(pairsShort, 8, minSamples) : null;
  const calibrations: any = {};
  if (doCalibrate && calibGlobal) calibrations.global = calibGlobal;
  if (doCalibrate && calibLong) calibrations.long = calibLong;
  if (doCalibrate && calibShort) calibrations.short = calibShort;

  const model = {
    version: 1,
    trainedAt: new Date().toISOString(),
    windowDays,
    labelHorizonMinutes,
    sampleCount: labeled.length,
    winCount: wins,
    winRate,
    returnStats: retStats,
    drawdownStats: ddStats,
    thresholds: {
      long: thrLong,
      short: thrShort
    },
    calibrations
  };

  const outDir = path.resolve(process.cwd(), 'data', 'models');
  await ensureDir(outDir);
  const outPath = path.join(outDir, 'model.json');
  await fs.writeFile(outPath, JSON.stringify(model, null, 2), 'utf-8');

  console.log('✅ 训练完成，模型已保存：', outPath);
  console.log('📊 模型摘要：', JSON.stringify(model, null, 2));

  // 退出进程
  process.exit(0);
}

main().catch(err => {
  console.error('❌ 训练失败：', err);
  process.exit(1);
});