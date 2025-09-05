import { config } from '../config';
import { recommendationDatabase, type MLSampleRecord } from '../services/recommendation-database';
import fs from 'fs/promises';
import path from 'path';

// 简单的离线训练脚本：
// - 从 SQLite 中读取已回填标签的样本（label_ready=1 且 label_return 不为空）
// - 限定时间窗：config.ml.training.windowDays
// - 计算基础统计与阈值（基于 combined_strength 的简单阈值搜索）
// - 输出到 data/models/model.json

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

function pickThreshold(samples: MLSampleRecord[], side: 'long' | 'short') {
  // 仅使用对应方向的样本
  const dirSet = side === 'long' ? new Set(['BUY', 'STRONG_BUY']) : new Set(['SELL', 'STRONG_SELL']);
  const sideSamples = samples.filter(s => dirSet.has((s.final_signal as any) || ''));
  if (sideSamples.length === 0) return { threshold: 60, winRate: 0, meanReturn: 0, count: 0 };

  let best = { threshold: 60, winRate: 0, meanReturn: 0, count: 0, score: -Infinity };
  for (let thr = 40; thr <= 90; thr += 1) {
    const subset = sideSamples.filter(s => typeof s.combined_strength === 'number' && (s.combined_strength as number) >= thr);
    if (subset.length < 30) continue; // 至少30个样本以避免过拟合
    const returns = subset.map(s => (s.label_return as number));
    const wins = returns.filter(r => r > 0).length;
    const winRate = wins / subset.length;
    const meanReturn = returns.reduce((a, b) => a + b, 0) / subset.length;
    const score = winRate * meanReturn; // 简单目标：胜率与均值的乘积
    if (score > best.score) {
      best = { threshold: thr, winRate, meanReturn, count: subset.length, score };
    }
  }
  return { threshold: best.threshold, winRate: best.winRate, meanReturn: best.meanReturn, count: best.count };
}

async function main() {
  const windowDays = (config as any)?.ml?.training?.windowDays ?? 14;
  const labelHorizonMinutes = (config as any)?.ml?.training?.labelHorizonMinutes ?? 60;
  const endTs = Date.now();
  const startTs = endTs - windowDays * 24 * 60 * 60 * 1000;

  console.log(`🧪 开始离线训练：窗口 ${windowDays} 天，标签窗口 ${labelHorizonMinutes} 分钟`);

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

  const thrLong = pickThreshold(labeled, 'long');
  const thrShort = pickThreshold(labeled, 'short');

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
    }
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