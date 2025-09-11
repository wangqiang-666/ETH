import axios, { AxiosInstance } from 'axios';
import NodeCache from 'node-cache';
import { config } from '../config';

export interface KronosForecastInput {
  symbol: string;
  interval: string; // e.g. '1H'
  // OHLCV rows: [timestamp(ms), open, high, low, close, volume]
  ohlcv: Array<[number, number, number, number, number, number]>;
}

export interface KronosForecast {
  score_long: number; // 0-1
  score_short: number; // 0-1
  confidence: number; // 0-1
  meta?: Record<string, any>;
}

export class KronosClient {
  private http: AxiosInstance;
  private cache: NodeCache;
  private enabled: boolean;
  private timeoutMs: number;
  private baseUrl: string;
  private localMode: boolean;

  constructor() {
    const k = (config as any)?.strategy?.kronos || {};
    this.enabled = !!k.enabled;
    this.timeoutMs = Number(k.timeoutMs ?? 1000);
    this.baseUrl = String(k.baseUrl ?? 'http://localhost:8001');
    this.localMode = /^local|^mock|^none/i.test(this.baseUrl);
    this.http = axios.create({ baseURL: this.baseUrl, timeout: this.timeoutMs });
    this.cache = new NodeCache({ stdTTL: 30, useClones: false });
  }

  isEnabled(): boolean { return this.enabled; }

  // Forecast with simple caching and graceful fallback
  async forecast(input: KronosForecastInput): Promise<KronosForecast | null> {
    if (!this.enabled) return null;

    // Protect input length (max 512)
    const lookback = Math.min(
      Number((config as any)?.strategy?.kronos?.lookback ?? 480),
      512
    );
    const series = input.ohlcv.slice(-lookback);

    const key = this.cacheKey(input.symbol, input.interval, series);
    const cached = this.cache.get<KronosForecast>(key);
    if (cached) return cached;

    // Local-mode: compute immediately without HTTP
    if (this.localMode) {
      const local = computeLocalForecast(series, input.symbol, input.interval, 'local');
      this.cache.set(key, local);
      return local;
    }

    try {
      const res = await this.http.post('/forecast', {
        symbol: input.symbol,
        interval: input.interval,
        ohlcv: series
      });
      const data = res?.data as KronosForecast;
      if (!data || !isFinite(data.score_long) || !isFinite(data.score_short)) {
        // fall back locally if response malformed
        const local = computeLocalForecast(series, input.symbol, input.interval, 'local-fallback');
        this.cache.set(key, local);
        return local;
      }
      const sanitized: KronosForecast = {
        score_long: clamp01(data.score_long),
        score_short: clamp01(data.score_short),
        confidence: clamp01(data.confidence ?? 0.5),
        meta: { ...(data.meta || {}), impl: (data as any)?.meta?.impl || 'http' }
      };
      this.cache.set(key, sanitized);
      return sanitized;
    } catch (_err) {
      // Graceful local fallback on error/timeout
      const local = computeLocalForecast(series, input.symbol, input.interval, 'local-fallback');
      this.cache.set(key, local);
      return local;
    }
  }

  private cacheKey(symbol: string, interval: string, series: KronosForecastInput['ohlcv']): string {
    const lastTs = series.length ? series[series.length - 1][0] : 0;
    const len = series.length;
    return `kronos:${symbol}:${interval}:${len}:${lastTs}`;
  }
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function computeLocalForecast(
  series: KronosForecastInput['ohlcv'],
  symbol: string,
  interval: string,
  impl: 'local' | 'local-fallback'
): KronosForecast {
  const closes = series.map(r => r[4]).slice(-200);
  if (closes.length < 10) {
    return {
      score_long: 0.5,
      score_short: 0.5,
      confidence: 0.4,
      meta: { version: '0.1.0', interval, symbol, n: series.length, impl }
    };
  }
  const n2 = closes.length;
  const last = closes[n2 - 1];
  const w = Math.min(20, n2);
  const avg20 = closes.slice(n2 - w).reduce((a, b) => a + b, 0) / w;
  const diffs: number[] = [];
  for (let i = 1; i < n2; i++) diffs.push(Math.abs(closes[i] - closes[i - 1]));
  const vol = (diffs.reduce((a, b) => a + b, 0) / Math.max(1, diffs.length)) || 1;
  const slope = (last - avg20) / vol;
  const longScore = 1 / (1 + Math.exp(-slope));
  const shortScore = 1 - longScore;
  const conf = Math.min(0.9, 0.4 + 0.5 * clamp01(Math.abs(slope) / 3) + 0.1 * clamp01(series.length / 480));
  return {
    score_long: clamp01(longScore),
    score_short: clamp01(shortScore),
    confidence: clamp01(conf),
    meta: { version: '0.1.0', interval, symbol, n: series.length, impl }
  };
}