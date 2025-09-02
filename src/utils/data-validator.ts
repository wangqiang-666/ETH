import { MarketData } from '../ml/ml-analyzer';
import { KlineData } from '../services/okx-data-service';

export type Severity = 'INFO' | 'WARNING' | 'ERROR';

export interface ValidationIssue {
  code: string;
  message: string;
  severity: Severity;
  details?: any;
}

export interface ValidationReport {
  valid: boolean;
  hasErrors: boolean;
  issues: ValidationIssue[];
  metrics: Record<string, number>;
  summary: string;
}

function isFiniteNumber(n: any): boolean {
  return typeof n === 'number' && Number.isFinite(n);
}

function intervalToMs(interval: string): number | null {
  const m = interval.toLowerCase();
  if (m.endsWith('m')) return parseInt(m) * 60_000;
  if (m.endsWith('h')) return parseInt(m) * 60 * 60_000;
  if (m.endsWith('d')) return parseInt(m) * 24 * 60 * 60_000;
  if (m === '1d') return 24 * 60 * 60_000;
  if (m === '1w') return 7 * 24 * 60 * 60_000;
  return null;
}

export class DataValidator {
  validateTicker(t: MarketData, symbol?: string): ValidationReport {
    const issues: ValidationIssue[] = [];

    if (!isFiniteNumber(t.price) || t.price <= 0) {
      issues.push({ code: 'PRICE_INVALID', message: 'Ticker price 非法或非正数', severity: 'ERROR', details: { price: t.price } });
    }
    if (!isFiniteNumber(t.volume) || t.volume < 0) {
      issues.push({ code: 'VOLUME_INVALID', message: 'Ticker volume 非法或为负', severity: 'ERROR', details: { volume: t.volume } });
    }
    if (!isFiniteNumber(t.high24h) || !isFiniteNumber(t.low24h) || t.high24h < t.low24h) {
      issues.push({ code: 'RANGE_INVALID', message: '24h 高低区间非法', severity: 'ERROR', details: { high24h: t.high24h, low24h: t.low24h } });
    }
    if (t.price && t.high24h && t.low24h) {
      const pad = 0.02; // 2% 容忍
      if (t.price > t.high24h * (1 + pad) || t.price < t.low24h * (1 - pad)) {
        issues.push({ code: 'PRICE_OUT_OF_24H_RANGE', message: '价格超出24h区间（含2%容忍）', severity: 'WARNING', details: { price: t.price, high24h: t.high24h, low24h: t.low24h } });
      }
    }
    if (!isFiniteNumber(t.timestamp) || t.timestamp <= 0) {
      issues.push({ code: 'TS_INVALID', message: 'Ticker 时间戳非法', severity: 'ERROR', details: { timestamp: t.timestamp } });
    } else {
      const now = Date.now();
      if (now - t.timestamp > 5 * 60_000) {
        issues.push({ code: 'TS_STALE', message: 'Ticker 时间戳过旧 (>5min)', severity: 'WARNING', details: { ageMs: now - t.timestamp } });
      }
    }

    const hasErrors = issues.some(i => i.severity === 'ERROR');
    const summary = hasErrors ? 'Ticker 校验失败' : (issues.length ? 'Ticker 校验通过（含警告）' : 'Ticker 校验通过');

    return {
      valid: !hasErrors,
      hasErrors,
      issues,
      metrics: {},
      summary
    };
  }

  validateKlines(klines: KlineData[], interval: string, symbol?: string): ValidationReport {
    const issues: ValidationIssue[] = [];

    if (!Array.isArray(klines) || klines.length === 0) {
      issues.push({ code: 'EMPTY', message: 'K线为空', severity: 'ERROR' });
      return { valid: false, hasErrors: true, issues, metrics: {}, summary: 'K线为空' };
    }

    const step = intervalToMs(interval);
    if (!step) {
      issues.push({ code: 'INTERVAL_UNKNOWN', message: `无法识别的周期: ${interval}`, severity: 'WARNING' });
    }

    // 排序与重复检查（假设已升序）
    let ascending = true;
    let duplicates = 0;
    let gaps = 0;
    let negatives = 0;
    let outliers = 0;
    let invalidOhlc = 0;

    for (let i = 0; i < klines.length; i++) {
      const k = klines[i];
      const vals = [k.open, k.high, k.low, k.close, k.volume, k.turnover];
      for (const v of vals) {
        if (!isFiniteNumber(v)) {
          issues.push({ code: 'NON_FINITE', message: `K线包含非有限数值 @index ${i}`, severity: 'ERROR' });
          negatives++;
          break;
        }
        if (v < 0 && (v !== k.low && v !== k.high)) { // 价格可为负在极少数市场，这里不允许
          negatives++;
        }
      }
      if (!(k.low <= Math.min(k.open, k.close, k.high) && k.high >= Math.max(k.open, k.close, k.low) && k.low <= k.high)) {
        invalidOhlc++;
      }
      if (i > 0) {
        if (klines[i].timestamp < klines[i-1].timestamp) ascending = false;
        if (klines[i].timestamp === klines[i-1].timestamp) duplicates++;
        if (step) {
          const dt = klines[i].timestamp - klines[i-1].timestamp;
          if (dt !== step) {
            // 允许最后一根当前未收盘的情况，但大于一步即认为有缺口
            if (dt > step) gaps++;
          }
        }
        const prevClose = klines[i-1].close;
        if (isFiniteNumber(prevClose) && prevClose > 0) {
          const change = Math.abs((k.close - prevClose) / prevClose);
          if (change > 0.15) { // 15% 认为强异常
            outliers++;
          } else if (change > 0.05) { // 5% 提示
            issues.push({ code: 'SPIKE', message: `价格在 ${interval} 周期内波动较大: ${(change*100).toFixed(2)}% @index ${i}`, severity: 'WARNING' });
          }
        }
      }
    }

    if (!ascending) {
      issues.push({ code: 'NOT_ASCENDING', message: '时间戳非升序', severity: 'ERROR' });
    }
    if (duplicates > 0) {
      issues.push({ code: 'DUPLICATE_TS', message: `存在重复时间戳: ${duplicates}`, severity: 'ERROR' });
    }
    if (gaps > 0) {
      issues.push({ code: 'GAPS', message: `存在时间缺口（>1步长）段数: ${gaps}`, severity: 'WARNING' });
    }
    if (negatives > 0) {
      issues.push({ code: 'NEGATIVE_VALUES', message: `存在负值字段计数: ${negatives}`, severity: 'ERROR' });
    }
    if (invalidOhlc > 0) {
      issues.push({ code: 'INVALID_OHLC', message: `价格区间不一致（low/high 与 open/close 冲突）计数: ${invalidOhlc}`, severity: 'ERROR' });
    }

    const prices = klines.map(k => k.close).filter(isFiniteNumber) as number[];
    const avgPrice = prices.reduce((a,b)=>a+b,0) / Math.max(1, prices.length);
    const vols = klines.map(k => k.volume).filter(isFiniteNumber) as number[];
    const avgVol = vols.reduce((a,b)=>a+b,0) / Math.max(1, vols.length);

    const hasErrors = issues.some(i => i.severity === 'ERROR') || outliers > 0;
    const summary = hasErrors ? 'K线校验失败' : (issues.length ? 'K线校验通过（含警告）' : 'K线校验通过');

    return {
      valid: !hasErrors,
      hasErrors,
      issues,
      metrics: {
        count: klines.length,
        startTs: klines[0].timestamp,
        endTs: klines[klines.length - 1].timestamp,
        gaps,
        duplicates,
        avgPrice,
        avgVol,
        outliers,
        invalidOhlc,
        negatives
      },
      summary
    };
  }
}

export const dataValidator = new DataValidator();