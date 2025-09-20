import { config } from '../config';
import { enhancedOKXDataService } from './enhanced-okx-data-service';
import { recommendationDatabase } from './recommendation-database';

// 推荐记录类型（供数据库与各服务共享）
export interface RecommendationRecord {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  strategy_type?: string;
  entry_price: number;
  leverage?: number;
  position_size?: number;
  created_at: Date;
  updated_at: Date;
  status: 'PENDING' | 'ACTIVE' | 'CLOSED' | 'EXPIRED';
  current_price?: number;
  volume_24h?: number;
  price_change_24h?: number;
  dedupe_key?: string;
  exit_price?: number;
  exit_time?: Date;
  exit_reason?: string;
  exit_label?: 'TIMEOUT' | 'BREAKEVEN' | 'DYNAMIC_TAKE_PROFIT' | 'DYNAMIC_STOP_LOSS' | string;
  pnl_amount?: number;
  pnl_percent?: number;
  // 以下为其他模块使用到的可选字段，确保类型完整
  result?: 'WIN' | 'LOSS' | 'BREAKEVEN';
  take_profit_price?: number;
  stop_loss_price?: number;
  take_profit_percent?: number;
  stop_loss_percent?: number;
  trailing_stop_enabled?: boolean;
  trailing_stop_distance?: number;
  lock_in_no_loss?: boolean;
  liquidation_price?: number;
  holding_duration?: number;
  expected_return?: number;
  ev?: number;
  ev_threshold?: number;
  ev_ok?: boolean;
  ab_group?: string;
  margin_ratio?: number;
  maintenance_margin?: number;
  risk_level?: string;
  algorithm_name?: string;
  signal_strength?: number;
  confidence_score?: number;
  quality_score?: number;
  market_volatility?: number;
  source?: string;
  is_strategy_generated?: boolean;
  strategy_confidence_level?: string;
  exclude_from_ml?: boolean;
  notes?: string;
}

// 新增：价格检查结果类型
interface PriceCheckResult {
  currentPrice: number;
  triggered: boolean;
  triggerType?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION';
  pnlAmount: number;
  pnlPercent: number;
}

export class RecommendationTracker {
  private activeRecommendations: Map<string, RecommendationRecord> = new Map();
  // 新增：追踪止损状态缓存
  private trailingStates = new Map<string, { high?: number; low?: number; lastStop?: number; activated?: boolean }>();
  // 新增：全局最小间隔冷却追踪（进程内）
  private lastCreateMs: number = 0;

  // 新增：可配置参数（从 config.strategy 读取）
  private MIN_HOLDING_MINUTES: number;
  private MAX_HOLDING_HOURS: number;
  private TRAIL_ENABLED: boolean;
  private TRAIL_PERCENT: number;
  private TRAIL_MIN_STEP: number;
  private TRAIL_ON_BREAKEVEN: boolean;
  private TRAIL_ACTIVATE_PROFIT_PCT: number;
  private FLEX?: {
    enabled?: boolean;
    lowProfitThreshold?: number;
    highProfitThreshold?: number;
    lowMultiplier?: number;
    highTightenMultiplier?: number;
  };

  constructor() {
    const strat: any = (config as any)?.strategy || {};
    const gating: any = strat.gating || {};
    const trailing: any = strat.trailing || {};
    const flex: any = strat.trailingFlex || {};

    this.MIN_HOLDING_MINUTES = Number(gating.minHoldingMinutes ?? 0);
    this.MAX_HOLDING_HOURS = Number(gating.maxHoldingHours ?? 0);

    this.TRAIL_ENABLED = Boolean(trailing.enabled ?? false);
    this.TRAIL_PERCENT = Number(trailing.percent ?? 2);
    this.TRAIL_MIN_STEP = Number(trailing.minStep ?? 0.5);
    this.TRAIL_ON_BREAKEVEN = Boolean(trailing.onBreakeven ?? true);
    this.TRAIL_ACTIVATE_PROFIT_PCT = Number(trailing.activateProfitPct ?? 2);

    this.FLEX = {
      enabled: Boolean(flex.enabled ?? false),
      lowProfitThreshold: Number(flex.lowProfitThreshold ?? 2),
      highProfitThreshold: Number(flex.highProfitThreshold ?? 4),
      lowMultiplier: Number(flex.lowMultiplier ?? 1.8),
      highTightenMultiplier: Number(flex.highTightenMultiplier ?? 0.7)
    };
  }

  private normalizeSymbol(symbol: string): string {
    if (!symbol) return symbol as any;
    const s = String(symbol).toUpperCase();
    // 简易标准化：兼容 ETHUSDT -> ETH-USDT-SWAP
    if (!s.includes('-')) {
      return s === 'ETHUSDT' ? 'ETH-USDT-SWAP' : s;
    }
    return s;
  }

  // 新增/修复：补全 addRecommendation 方法头与初始化逻辑
  async addRecommendation(recommendation: any, options?: { bypassCooldown?: boolean }): Promise<string> {
    const DISABLE_EXTERNAL_MARKET_ON_CREATE = (process.env.WEB_DISABLE_EXTERNAL_MARKET === '1') || (process.env.DISABLE_EXTERNAL_MARKET_ON_CREATE === '1');

    const id: string = recommendation?.id || `REC_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const symbol = this.normalizeSymbol(recommendation?.symbol || (config as any)?.trading?.defaultSymbol || 'ETH-USDT-SWAP');
    const now = new Date();
    const dedupeKeyBase = `${symbol}|${String(recommendation?.direction || 'UNKNOWN')}|${String(recommendation?.strategy_type || 'UNKNOWN')}`;
    // 为避免同毫秒内多次提交导致的唯一约束冲突，附加唯一 id 作为后缀，确保插入层面不触发 DB 级 DUPLICATE
    const dedupeKey = `${dedupeKeyBase}|${now.getTime()}|${id}`; // 显式重复检测在后续逻辑中处理

    const record: RecommendationRecord = {
      ...(recommendation || {}),
      symbol, // 使用标准化后的 symbol
      id,
      created_at: now,
      updated_at: now,
      status: 'ACTIVE',
      current_price: recommendation?.current_price,
      volume_24h: 0,
      price_change_24h: 0,
      // 新增：写入去重键
      dedupe_key: dedupeKey,
    } as RecommendationRecord;

    // 获取市场数据（可通过环境变量在创建阶段禁用外部行情，避免超时）
    let marketData: any;
    if (DISABLE_EXTERNAL_MARKET_ON_CREATE) {
      console.log('[RecommendationTracker] Skip external market fetch on create (DISABLE_EXTERNAL_MARKET_ON_CREATE=true)');
      marketData = {
        currentPrice: recommendation?.current_price,
        volume24h: 0,
        priceChange24h: 0
      };
    } else {
      try {
        const ticker = await enhancedOKXDataService.getTicker(symbol);
        marketData = {
          currentPrice: ticker?.price ? parseFloat(ticker.price.toString()) : recommendation?.current_price,
          volume24h: ticker?.volume ? parseFloat(ticker.volume.toString()) : 0,
          priceChange24h: ticker?.change24h ? parseFloat(ticker.change24h.toString()) : 0
        };
      } catch (error) {
        console.warn(`Failed to get market data for ${symbol}:`, error);
        marketData = {
          currentPrice: recommendation?.current_price,
          volume24h: 0,
          priceChange24h: 0
        };
      }
    }

    // 用行情覆盖价格信息
    (record as any).current_price = marketData.currentPrice;
    (record as any).volume_24h = marketData.volume24h;
    (record as any).price_change_24h = marketData.priceChange24h;

    // 新增：创建时按百分比回填止盈/止损目标价（与 backfill 脚本一致）
    try {
      const entry = Number(record.entry_price);
      const lev = Math.max(1, Number(record.leverage || 1));
      const dir: 'LONG' | 'SHORT' = record.direction === 'SHORT' ? 'SHORT' : 'LONG';
      const tpPctRaw: any = (record as any).take_profit_percent;
      const slPctRaw: any = (record as any).stop_loss_percent;
      const tpPct: number | null = typeof tpPctRaw === 'number' ? tpPctRaw : (tpPctRaw != null ? Number(tpPctRaw) : null);
      const slPct: number | null = typeof slPctRaw === 'number' ? slPctRaw : (slPctRaw != null ? Number(slPctRaw) : null);

      const computeTargetPrice = (entryPrice: number, leverage: number, percent: number, direction: 'LONG' | 'SHORT', type: 'tp' | 'sl'): number | null => {
        if (!entryPrice || !leverage || !percent || leverage <= 0 || percent <= 0) return null;
        const rawPct = percent / leverage / 100; // 将“杠杆后的百分比”还原为标的价格变动比例
        if (type === 'tp') {
          return direction === 'LONG' ? Number((entryPrice * (1 + rawPct)).toFixed(2)) : Number((entryPrice * (1 - rawPct)).toFixed(2));
        } else {
          return direction === 'LONG' ? Number((entryPrice * (1 - rawPct)).toFixed(2)) : Number((entryPrice * (1 + rawPct)).toFixed(2));
        }
      };

      if ((record as any).take_profit_price == null && tpPct != null && tpPct > 0) {
        const tp = computeTargetPrice(entry, lev, tpPct, dir, 'tp');
        if (tp != null) (record as any).take_profit_price = tp;
      }
      if ((record as any).stop_loss_price == null && slPct != null && slPct > 0) {
        const sl = computeTargetPrice(entry, lev, slPct, dir, 'sl');
        if (sl != null) (record as any).stop_loss_price = sl;
      }
    } catch (e) {
      console.warn('[RecommendationTracker] backfill target prices on create failed:', (e as any)?.message || e);
    }

    // 新增：多TF一致性门控（最终拒绝路径）。当 requireMTFAgreement=true 且 agreement < minMTFAgreement 或方向不一致时，拒绝。
    try {
      const ef: any = ((config as any)?.strategy?.entryFilters) || {};
      const requireMtf: boolean = ef.requireMTFAgreement === true;
      const minMtfAgree: number = Number(ef.minMTFAgreement ?? 0.6);
      if (requireMtf) {
        const mtf = (recommendation?.metadata?.multiTFConsistency) || (recommendation?.multiTFConsistency) || {};
        const agreementRaw: any = mtf?.agreement;
        const dominantDirRaw: any = mtf?.dominantDirection;
        const agreement: number = Number(agreementRaw);
        const dominantDirection: 'LONG' | 'SHORT' | undefined = dominantDirRaw === 'LONG' || dominantDirRaw === 'SHORT' ? dominantDirRaw : undefined;
        const agreementOk = Number.isFinite(agreement) && agreement >= minMtfAgree;
        const directionOk = dominantDirection ? (dominantDirection === record.direction) : true;
        const mtfOk = agreementOk && directionOk;
        if (!mtfOk) {
          const err: any = new MTFConsistencyError('Multi-timeframe consistency check failed');
          err.code = 'MTF_CONSISTENCY';
          err.symbol = symbol;
          err.direction = record.direction;
          err.requireMTFAgreement = true;
          err.minMTFAgreement = minMtfAgree;
          err.agreement = Number.isFinite(agreement) ? agreement : null;
          err.dominantDirection = dominantDirection;
          err.mtfOk = false;
          throw err;
        }
      }
    } catch (e) {
      // 统一抛出，由上层 API/集成服务映射为 409 并打点
      throw e;
    }

    // 风控：净名义敞口上限与同方向数量上限校验（仅当提供了 position_size 时启用名义敞口校验）
    try {
      const riskCfg = (config as any)?.risk || {};
      // 1) 同方向活跃数量上限（使用 ExposureLimitError）
      const maxSame: number = Number(riskCfg.maxSameDirectionActives ?? 0);
      if (Number.isFinite(maxSame) && maxSame > 0) {
        const actives = this.getActiveRecommendations ? this.getActiveRecommendations() : Array.from(this.activeRecommendations.values());
        const sameCount = actives.filter(r => r.status === 'ACTIVE' && r.direction === record.direction).length;
        if (sameCount >= maxSame) {
          const err = new ExposureLimitError(`Too many active ${record.direction} recommendations: ${sameCount} >= ${maxSame}`) as any;
          err.direction = record.direction;
          err.limit = maxSame;
          // 新增：为 API/E2E 提供更丰富上下文字段
          err.maxSameDirection = maxSame;
          err.currentCount = sameCount;
          err.windowHours = 1;
          throw err;
        }
      }

      // 2) 净名义敞口上限（使用 ExposureCapError）
      const caps = riskCfg.netExposureCaps || {};
      const totalCap: number = Number(caps.total ?? 0);
      const perDir = (caps.perDirection || {}) as any;
      const dirCap: number = Number(perDir?.[record.direction] ?? 0);

      const size = Number((record as any).position_size ?? 0);
      const lev2 = Math.max(1, Number(record.leverage || 1));
      const candidateExposure = (Number.isFinite(size) && size > 0 ? size : 0) * lev2;

      if (candidateExposure > 0 && ( (Number.isFinite(totalCap) && totalCap > 0) || (Number.isFinite(dirCap) && dirCap > 0) )) {
        const actives = this.getActiveRecommendations ? this.getActiveRecommendations() : Array.from(this.activeRecommendations.values());
        const mySymbol = symbol; // 按相同symbol统计净敞口
        const sumExposure = (filterDir?: 'LONG' | 'SHORT') => actives.reduce((sum, r) => {
          if (r.status !== 'ACTIVE') return sum;
          if (this.normalizeSymbol(r.symbol) !== mySymbol) return sum;
          const s = Number((r as any).position_size ?? 0);
          const l = Math.max(1, Number((r as any).leverage || 1));
          const n = (Number.isFinite(s) && s > 0) ? (s * l) : 0;
          return sum + (filterDir ? (r.direction === filterDir ? n : 0) : n);
        }, 0);
        
        const totalNow = sumExposure();
        const dirNow = sumExposure(record.direction);

        if (Number.isFinite(totalCap) && totalCap > 0 && totalNow + candidateExposure > totalCap + 1e-8) {
          const err = new ExposureCapError(`Net exposure total cap exceeded: ${(totalNow + candidateExposure).toFixed(4)} > ${Number(totalCap).toFixed(4)}`) as any;
          err.code = 'EXPOSURE_CAP';
          err.scope = 'TOTAL';
          err.current = totalNow;
          err.candidate = candidateExposure;
          err.cap = totalCap;
          throw err;
        }

        if (Number.isFinite(dirCap) && dirCap > 0 && dirNow + candidateExposure > dirCap + 1e-8) {
          const err = new ExposureCapError(`Net exposure ${record.direction} cap exceeded: ${(dirNow + candidateExposure).toFixed(4)} > ${Number(dirCap).toFixed(4)}`) as any;
          err.code = 'EXPOSURE_CAP';
          err.scope = record.direction;
          err.direction = record.direction;
          err.current = dirNow;
          err.candidate = candidateExposure;
          err.cap = dirCap;
          throw err;
        }
      }
    } catch (e) {
      // 将门控错误继续抛出，外层 API/集成服务会捕获并映射为 4xx
      throw e;
    }

    // 新增：显式重复检测（时间窗口 + 价格bps 阈值），优先于冷却检查执行
    try {
      const strat: any = (config as any)?.strategy || {};
      const windowMinutes: number = Math.max(0, Number(strat.duplicateWindowMinutes ?? 10));
      const bpsThreshold: number = Math.max(0, Number(strat.duplicatePriceBps ?? 20));
      if (windowMinutes > 0 && bpsThreshold > 0) {
        try { await recommendationDatabase.initialize(); } catch {}
        // 仅与最近一条 ACTIVE 状态的同向单比较，避免过期/已关闭记录导致误判
        const lastSame = await recommendationDatabase.getLastActiveRecommendationBySymbolAndDirection(symbol, record.direction);
        if (lastSame && (lastSame as any).created_at) {
          const lastTs = new Date((lastSame as any).created_at as any).getTime();
          const withinWindow = (Date.now() - lastTs) <= windowMinutes * 60_000;
          if (withinWindow) {
            const lastPrice = Number((lastSame as any).entry_price);
            const newPrice = Number(record.entry_price);
            if (Number.isFinite(lastPrice) && Number.isFinite(newPrice) && lastPrice > 0) {
              const bps = Math.abs(newPrice - lastPrice) / lastPrice * 10000;
              if (bps <= bpsThreshold + 1e-9) {
                const err: any = new DuplicateError({
                  symbol,
                  direction: record.direction,
                  strategy_type: record.strategy_type,
                  windowMinutes,
                  bpsThreshold,
                  matchedIds: [(lastSame as any).id]
                });
                err.code = 'DUPLICATE_RECOMMENDATION';
                err.symbol = symbol;
                err.direction = record.direction;
                err.strategy_type = record.strategy_type;
                err.windowMinutes = windowMinutes;
                err.bpsThreshold = bpsThreshold;
                err.matchedIds = [(lastSame as any).id];
                throw err;
              }
            }
          }
        }
      }
    } catch (e) {
      // 将重复错误抛给上层，由 API 统一映射为 409
      throw e;
    }

    // 新增：冷却检查（按配置），支持 bypassCooldown 绕过
    try {
      const strat: any = (config as any)?.strategy || {};
      const cd: any = (strat.cooldown || {}) as any;
      const sameDirMs: number = Math.max(0, Number(strat.signalCooldownMs ?? cd.signalCooldownMs ?? 0));
      const oppMs: number = Math.max(0, Number(strat.oppositeCooldownMs ?? cd.oppositeCooldownMs ?? 0));
      const globalMs: number = Math.max(0, Number(cd.globalMinIntervalMs ?? strat.globalMinIntervalMs ?? 0));

      const bypass: boolean = options?.bypassCooldown === true;
      if (!bypass) {
        // 新增：每小时下单上限（全局/方向级）——作为防洪闸，按 429 映射
        const hourly = (config as any)?.risk?.hourlyOrderCaps || {};
        const hourMs = 60 * 60 * 1000;
        const windowStart = new Date(Date.now() - hourMs);
        try { await recommendationDatabase.initialize(); } catch {}
        // 全局上限
        const totalCap = Number(hourly.total);
        if (Number.isFinite(totalCap) && totalCap > 0) {
          const { count, oldestCreatedAt } = await recommendationDatabase.countRecommendationsWithin(windowStart);
          if (count >= totalCap) {
            const baseTs = oldestCreatedAt ? oldestCreatedAt.getTime() : Date.now();
            const remaining = Math.max(0, (baseTs + hourMs) - Date.now());
            const err: any = new CooldownError('Hourly order cap reached (total)');
            err.code = 'COOLDOWN_ACTIVE';
            err.kind = 'HOURLY';
            err.scope = 'TOTAL';
            err.symbol = symbol;
            err.direction = record.direction;
            err.windowHours = 1;
            err.cap = totalCap;
            err.currentCount = count;
            err.usedCooldownMs = remaining; // 提示剩余等待
            err.remainingMs = remaining;
            err.nextAvailableAt = new Date(Date.now() + remaining).toISOString();
            throw err;
          }
        }
        // 方向级上限
        const perDir = hourly.perDirection || {};
        const dirCap = Number(perDir[record.direction as 'LONG'|'SHORT']);
        if (Number.isFinite(dirCap) && dirCap > 0) {
          const { count, oldestCreatedAt } = await recommendationDatabase.countRecommendationsWithin(windowStart, { direction: record.direction as any });
          if (count >= dirCap) {
            const baseTs = oldestCreatedAt ? oldestCreatedAt.getTime() : Date.now();
            const remaining = Math.max(0, (baseTs + hourMs) - Date.now());
            const err: any = new CooldownError('Hourly order cap reached (per-direction)');
            err.code = 'COOLDOWN_ACTIVE';
            err.kind = 'HOURLY';
            err.scope = 'PER_DIRECTION';
            err.symbol = symbol;
            err.direction = record.direction;
            err.windowHours = 1;
            err.cap = dirCap;
            err.currentCount = count;
            err.usedCooldownMs = remaining;
            err.remainingMs = remaining;
            err.nextAvailableAt = new Date(Date.now() + remaining).toISOString();
            throw err;
          }
        }

        // 反向（opposite）冷却：同一 symbol 反向最小间隔
        if (oppMs > 0) {
          const oppositeDir = record.direction === 'LONG' ? 'SHORT' : 'LONG';
          try { await recommendationDatabase.initialize(); } catch {}
          const lastOpp = await recommendationDatabase.getLastRecommendationBySymbolAndDirection(symbol, oppositeDir as any);
          if (lastOpp && (lastOpp as any).created_at) {
            const lastTs = new Date((lastOpp as any).created_at as any).getTime();
            const diff = Date.now() - lastTs;
            if (diff < oppMs) {
              const err: any = new CooldownError(`Opposite-direction cooldown active for ${symbol} ${record.direction}`);
              err.code = 'COOLDOWN_ACTIVE';
              err.kind = 'OPPOSITE';
              err.symbol = symbol;
              err.direction = record.direction;
              err.usedCooldownMs = oppMs;
              err.remainingMs = Math.max(0, oppMs - diff);
              err.nextAvailableAt = new Date(lastTs + oppMs).toISOString();
              err.lastRecommendationId = (lastOpp as any).id;
              err.lastCreatedAt = new Date(lastTs).toISOString();
              throw err;
            }
          }
        }

        // 方向级（同向）冷却：同一 symbol + direction 最小间隔
        if (sameDirMs > 0) {
          try { await recommendationDatabase.initialize(); } catch {}
          const lastSame = await recommendationDatabase.getLastRecommendationBySymbolAndDirection(symbol, record.direction);
          if (lastSame && (lastSame as any).created_at) {
            const lastTs = new Date((lastSame as any).created_at as any).getTime();
            const diff = Date.now() - lastTs;
            if (diff < sameDirMs) {
              const err: any = new CooldownError(`Same-direction cooldown active for ${symbol} ${record.direction}`);
              err.code = 'COOLDOWN_ACTIVE';
              err.kind = 'SAME_DIRECTION';
              err.symbol = symbol;
              err.direction = record.direction;
              err.usedCooldownMs = sameDirMs;
              err.remainingMs = Math.max(0, sameDirMs - diff);
              err.nextAvailableAt = new Date(lastTs + sameDirMs).toISOString();
              err.lastRecommendationId = (lastSame as any).id;
              err.lastCreatedAt = new Date(lastTs).toISOString();
              throw err;
            }
          }
        }
        // 全局最小间隔（任意两单之间）
        if (globalMs > 0 && this.lastCreateMs > 0) {
          const diff = Date.now() - this.lastCreateMs;
          if (diff < globalMs) {
            const err: any = new CooldownError('Global cooldown active');
            err.code = 'COOLDOWN_ACTIVE';
            err.kind = 'GLOBAL';
            err.symbol = symbol;
            err.usedCooldownMs = globalMs;
            err.remainingMs = Math.max(0, globalMs - diff);
            err.nextAvailableAt = new Date(this.lastCreateMs + globalMs).toISOString();
            throw err;
          }
        }
      }
    } catch (e) {
      // 将冷却错误抛给上层，由 API 统一映射为 429
      throw e;
    }

    // 添加到内存缓存
    this.activeRecommendations.set(id, record);

    // 保存到数据库
    await this.saveToDatabase(record);

    // 更新全局最小间隔计时
    this.lastCreateMs = Date.now();

    console.log(`Added recommendation ${id} for tracking: ${record.symbol} ${record.direction} @ ${record.entry_price}`);
    return id;
  }

  /**
   * 获取活跃推荐列表
   */
  getActiveRecommendations(): RecommendationRecord[] {
  // 仅返回状态为 ACTIVE 的推荐，避免短暂处于 EXPIRED/CLOSED 但尚未从缓存移除的记录被暴露
  return Array.from(this.activeRecommendations.values()).filter(r => r.status === 'ACTIVE');
  }

  /**
   * 从活跃缓存中移除指定推荐
   */
  removeFromActiveCache(id: string): boolean {
  return this.activeRecommendations.delete(id);
  }

  /**
   * 获取推荐统计信息
   */
  async getStatistics(strategyType?: string): Promise<{
  total: number;
  active: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
  avgHoldingDuration: number;
  }> {
  try {
  // TODO: 从数据库获取完整统计
  const all = Array.from(this.activeRecommendations.values());
  const closed = all.filter(r => r.status === 'CLOSED');

  const wins = closed.filter(r => r.result === 'WIN').length;
  const losses = closed.filter(r => r.result === 'LOSS').length;
  const breakeven = closed.filter(r => r.result === 'BREAKEVEN').length;

  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
  const avgPnl = closed.length > 0 
    ? closed.reduce((sum, r) => sum + (r.pnl_percent || 0), 0) / closed.length 
    : 0;
  const totalPnl = closed.reduce((sum, r) => sum + (r.pnl_percent || 0), 0);
  const avgHoldingDuration = closed.length > 0
    ? closed.reduce((sum, r) => sum + (r.holding_duration || 0), 0) / closed.length
    : 0;

  return {
  total: all.length,
  active: all.filter(r => r.status === 'ACTIVE').length,
  wins,
  losses,
  breakeven,
  winRate,
  avgPnl,
  totalPnl,
  avgHoldingDuration
  };
  } catch (error) {
  console.error('Failed to get statistics:', error);
  return {
  total: this.activeRecommendations.size,
  active: this.activeRecommendations.size,
  wins: 0,
  losses: 0,
  breakeven: 0,
  winRate: 0,
  avgPnl: 0,
  totalPnl: 0,
  avgHoldingDuration: 0
  };
  }
  }

  /**
   * 定时检查所有活跃推荐
   */
  private async checkRecommendations(): Promise<void> {
  try {
  const activeRecs = Array.from(this.activeRecommendations.values())
    .filter(r => r.status === 'ACTIVE');

  if (activeRecs.length === 0) {
  return;
  }

console.log(`Checking ${activeRecs.length} active recommendations...`);

const now = new Date();
const toClose: string[] = [];

// 第一阶段：优先处理超时单，不依赖任何外部价格请求，避免被网络阻塞
const remaining: RecommendationRecord[] = [];
for (const rec of activeRecs) {
const holdingHours = (now.getTime() - rec.created_at.getTime()) / (1000 * 60 * 60);
// 支持关闭自动过期：当 maxHoldingHours <= 0 时，不进行过期判断
if (this.MAX_HOLDING_HOURS > 0 && holdingHours >= this.MAX_HOLDING_HOURS) {
const exitPrice = rec.current_price ?? rec.entry_price;
await this.closeRecommendation(rec, 'TIMEOUT', exitPrice);
toClose.push(rec.id);
// 立刻从活跃缓存移除，避免在同一次轮询中仍被返回到API
this.activeRecommendations.delete(rec.id);
} else {
remaining.push(rec);
}
}

// 第二阶段：仅对未超时的推荐进行价格检查与触发判断
for (const rec of remaining) {
try {
await this.checkSingleRecommendation(rec);

// 检查是否需要从活跃列表移除（已关闭，含历史记录）
if (rec.status === 'CLOSED' || rec.status === 'EXPIRED') {
toClose.push(rec.id);
}
} catch (error) {
console.error(`Error checking recommendation ${rec.id}:`, error);
}
}

// 从活跃列表中移除已关闭/过期的推荐
toClose.forEach(id => this.activeRecommendations.delete(id));

if (toClose.length > 0) {
console.log(`Closed/Expired ${toClose.length} recommendations`);
}

} catch (error) {
console.error('Error checking recommendations:', error);
}
}

/**
 * 检查单个推荐的状态
 */
private async checkSingleRecommendation(rec: RecommendationRecord): Promise<void> {
try {
// 检查是否超时
const holdingMinutes = (Date.now() - rec.created_at.getTime()) / (1000 * 60);
if (this.MAX_HOLDING_HOURS > 0 && holdingMinutes > this.MAX_HOLDING_HOURS * 60) {
const exitPrice = rec.current_price ?? rec.entry_price;
await this.closeRecommendation(rec, 'TIMEOUT', exitPrice);
return;
}

// 获取当前价格
const priceResult = await this.getCurrentPrice(rec.symbol);
if (!priceResult) {
console.warn(`Failed to get current price for ${rec.symbol}`);
return;
}

// 新增：尝试按配置更新追踪止损（先于触发判断）
await this.maybeUpdateTrailing(rec, priceResult.currentPrice);

// 检查触发条件
const checkResult = this.checkTriggerConditions(rec, priceResult.currentPrice);

// 新增：写入监控快照
try {
    const actives = this.getActiveRecommendations ? this.getActiveRecommendations() : [];
    const exposure = {
      total: actives.length,
      long: actives.filter(r => r.direction === 'LONG').length,
      short: actives.filter(r => r.direction === 'SHORT').length
    };
    const tstate = this.trailingStates.get(rec.id) || {};
    const strat = (config as any)?.strategy || {};
    const risk = (config as any)?.risk || {};
    const extraPayload = {
      gating: {
        minHoldingMinutes: this.MIN_HOLDING_MINUTES,
        maxHoldingHours: this.MAX_HOLDING_HOURS,
        risk: {
          maxSameDirectionActives: risk.maxSameDirectionActives
        }
      },
      cooldown: {
        signalCooldownMs: strat.signalCooldownMs,
        oppositeCooldownMs: strat.oppositeCooldownMs,
        allowOppositeWhileOpen: strat.allowOppositeWhileOpen,
        oppositeMinConfidence: strat.oppositeMinConfidence
      },
      trailing: {
        enabled: this.TRAIL_ENABLED,
        percent: this.TRAIL_PERCENT,
        minStep: this.TRAIL_MIN_STEP,
        onBreakeven: this.TRAIL_ON_BREAKEVEN,
        activateProfitPct: this.TRAIL_ACTIVATE_PROFIT_PCT,
        flex: this.FLEX,
        state: tstate
      },
      exposure,
      triggerCheck: {
        currentPrice: checkResult.currentPrice,
        triggered: checkResult.triggered,
        triggerType: checkResult.triggerType,
        pnlAmount: checkResult.pnlAmount,
        pnlPercent: checkResult.pnlPercent,
        stop_loss_price: rec.stop_loss_price,
        take_profit_price: rec.take_profit_price
      }
    };
  
  await recommendationDatabase.saveMonitoringSnapshot({
    recommendation_id: rec.id,
    check_time: new Date().toISOString(),
    current_price: checkResult.currentPrice,
    unrealized_pnl: checkResult.pnlAmount,
    unrealized_pnl_percent: checkResult.pnlPercent,
    is_stop_loss_triggered: checkResult.triggered && checkResult.triggerType === 'STOP_LOSS',
    is_take_profit_triggered: checkResult.triggered && checkResult.triggerType === 'TAKE_PROFIT',
    extra_json: JSON.stringify(extraPayload)
  });
} catch (e) {
  console.warn('saveMonitoringSnapshot failed:', e);
}

// 新增：最小持仓时间限制，仅拦截“止盈”触发（SL/LIQ 不受限；手动/超时也不受限）
if (checkResult.triggered && checkResult.triggerType === 'TAKE_PROFIT') {
  const heldMinutes = Math.floor((Date.now() - rec.created_at.getTime()) / (60 * 1000));
  if (this.MIN_HOLDING_MINUTES > 0 && heldMinutes < this.MIN_HOLDING_MINUTES) {
    // 仅更新当前价格与时间，不触发平仓
    rec.current_price = checkResult.currentPrice;
    rec.updated_at = new Date();
    return;
  }
}

if (checkResult.triggered) {
  await this.closeRecommendation(
    rec, 
    checkResult.triggerType!, 
    checkResult.currentPrice,
    checkResult.pnlAmount,
    checkResult.pnlPercent
  );
} else {
  // 更新当前价格
  rec.current_price = checkResult.currentPrice;
  rec.updated_at = new Date();
}

} catch (error) {
console.error(`Error checking recommendation ${rec.id}:`, error);
}
}

/**
 * 获取当前市场价格
 */
private async getCurrentPrice(symbol: string): Promise<{ currentPrice: number } | null> {
try {
const ticker = await enhancedOKXDataService.getTicker(this.normalizeSymbol(symbol));
if (ticker && ticker.price) {
return { currentPrice: parseFloat(ticker.price.toString()) };
}
return null;
} catch (error) {
console.error(`Failed to get current price for ${symbol}:`, error);
return null;
}
}

/**
 * 检查是否触发止盈止损条件
 */
private checkTriggerConditions(rec: RecommendationRecord, currentPrice: number): PriceCheckResult {
const { direction, entry_price, take_profit_price, stop_loss_price, liquidation_price } = rec;

let triggered = false;
let triggerType: 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION' | undefined;

if (direction === 'LONG') {
// 多头仓位
if (take_profit_price && currentPrice >= take_profit_price) {
triggered = true;
triggerType = 'TAKE_PROFIT';
} else if (stop_loss_price && currentPrice <= stop_loss_price) {
triggered = true;
triggerType = 'STOP_LOSS';
} else if (liquidation_price && currentPrice <= liquidation_price) {
triggered = true;
triggerType = 'LIQUIDATION';
}
} else {
// 空头仓位
if (take_profit_price && currentPrice <= take_profit_price) {
triggered = true;
triggerType = 'TAKE_PROFIT';
} else if (stop_loss_price && currentPrice >= stop_loss_price) {
triggered = true;
triggerType = 'STOP_LOSS';
} else if (liquidation_price && currentPrice >= liquidation_price) {
triggered = true;
triggerType = 'LIQUIDATION';
}
}

// 计算收益（收益率需要包含杠杆）
const lev = Math.max(1, Number(rec.leverage) || 1);
const baseMovePercent = direction === 'LONG' 
  ? ((currentPrice - entry_price) / entry_price) * 100
  : ((entry_price - currentPrice) / entry_price) * 100;
const pnlPercent = baseMovePercent * lev;

// 金额按名义仓位计算（此时 pnlPercent 已包含杠杆，不再重复乘以杠杆）
const pnlAmount = (pnlPercent / 100) * (rec.position_size || 0);

return {
currentPrice,
triggered,
triggerType,
pnlAmount,
pnlPercent
};
}

/**
 * 关闭推荐记录
 */
private async maybeUpdateTrailing(rec: RecommendationRecord, currentPrice: number): Promise<void> {
try {
if (!this.TRAIL_ENABLED) return;
const pct = this.TRAIL_PERCENT;
if (!isFinite(pct) || pct <= 0) return;

const state = this.trailingStates.get(rec.id) || ({} as { high?: number; low?: number; lastStop?: number; activated?: boolean });

// 更新极值
if (rec.direction === 'LONG') {
state.high = state.high == null ? currentPrice : Math.max(state.high, currentPrice);
} else {
state.low = state.low == null ? currentPrice : Math.min(state.low, currentPrice);
}

// 激活判断：是否需要先到保本
if (!state.activated) {
if (!this.TRAIL_ON_BREAKEVEN) {
state.activated = true;
} else {
const sl = rec.stop_loss_price;
if (rec.direction === 'LONG') {
state.activated = typeof sl === 'number' && sl >= rec.entry_price;
} else {
state.activated = typeof sl === 'number' && sl <= rec.entry_price;
}
}
}

if (!state.activated) {
this.trailingStates.set(rec.id, state);
return;
}

// 新增：只有当基础涨跌幅达到设定阈值后才开始移动追踪止盈/止损，避免在+1%左右就被扫出
const baseMovePercentForActivation = rec.direction === 'LONG'
  ? ((state.high ?? currentPrice) - rec.entry_price) / rec.entry_price * 100
  : (rec.entry_price - (state.low ?? currentPrice)) / rec.entry_price * 100;
if (!isFinite(baseMovePercentForActivation) || baseMovePercentForActivation < this.TRAIL_ACTIVATE_PROFIT_PCT) {
this.trailingStates.set(rec.id, state);
return;
}

// 计算自适应轨距
let candidate: number | null = null;
let effPct = pct;
if (this.FLEX?.enabled) {
const baseMovePercent = rec.direction === 'LONG'
  ? ((state.high ?? currentPrice) - rec.entry_price) / rec.entry_price * 100
  : (rec.entry_price - (state.low ?? currentPrice)) / rec.entry_price * 100;
if (isFinite(baseMovePercent)) {
if (baseMovePercent < (this.FLEX.lowProfitThreshold ?? 2)) {
effPct = pct * (this.FLEX.lowMultiplier ?? 1.8); // 低利润阶段放宽
} else if (baseMovePercent > (this.FLEX.highProfitThreshold ?? 4)) {
effPct = pct * (this.FLEX.highTightenMultiplier ?? 0.7); // 高利润阶段收紧
}
}
}

if (rec.direction === 'LONG' && state.high != null) {
candidate = state.high * (1 - effPct / 100);
if (this.TRAIL_ON_BREAKEVEN) candidate = Math.max(candidate, rec.entry_price);
}
if (rec.direction === 'SHORT' && state.low != null) {
candidate = state.low * (1 + effPct / 100);
if (this.TRAIL_ON_BREAKEVEN) candidate = Math.min(candidate, rec.entry_price);
}
if (candidate == null || !isFinite(candidate)) {
this.trailingStates.set(rec.id, state);
return;
}

candidate = Number(candidate.toFixed(2));

// 自适应最小步长：低利润阶段增大步长，减少过早被“扫掉”
const minStep = this.TRAIL_MIN_STEP;
let effMinStep = minStep;
if (this.FLEX?.enabled) {
const highOrLow = rec.direction === 'LONG' ? (state.high ?? currentPrice) : (state.low ?? currentPrice);
const baseMovePercent = rec.direction === 'LONG'
  ? (highOrLow - rec.entry_price) / rec.entry_price * 100
  : (rec.entry_price - highOrLow) / rec.entry_price * 100;
if (isFinite(baseMovePercent) && baseMovePercent < (this.FLEX.lowProfitThreshold ?? 2)) {
effMinStep = Math.max(minStep, 2 * minStep);
}
}

const last = state.lastStop ?? rec.stop_loss_price;
if (typeof last === 'number' && effMinStep > 0 && Math.abs(candidate - last) < effMinStep) {
this.trailingStates.set(rec.id, state);
return;
}

// 不倒退止损价
if (rec.direction === 'LONG') {
const cur = typeof rec.stop_loss_price === 'number' ? rec.stop_loss_price : -Infinity;
if (candidate <= cur) {
this.trailingStates.set(rec.id, state);
return;
}
} else {
const cur = typeof rec.stop_loss_price === 'number' ? rec.stop_loss_price : Infinity;
if (candidate >= cur) {
this.trailingStates.set(rec.id, state);
return;
}
}

// 持久化更新
try {
await recommendationDatabase.initialize();
await recommendationDatabase.updateTargetPrices(rec.id, { stop_loss_price: candidate });
rec.stop_loss_price = candidate;
rec.updated_at = new Date();
state.lastStop = candidate;
this.trailingStates.set(rec.id, state);
} catch (e) {
console.warn('[RecommendationTracker] Failed to persist trailing stop update:', (e as any)?.message || String(e));
}
} catch (e) {
console.warn('[RecommendationTracker] maybeUpdateTrailing error:', (e as any)?.message || String(e));
}
}

        /**
         * 统一平仓方法：根据退出原因与价格计算结果、更新数据库与内存状态
         */
        private async closeRecommendation(
          rec: RecommendationRecord,
          reason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TIMEOUT' | 'LIQUIDATION' | 'MANUAL' | 'BREAKEVEN',
          exitPrice: number,
          pnlAmount?: number | null,
          pnlPercent?: number | null
        ): Promise<void> {
          try {
            // 价格兜底
            const safeExit = (typeof exitPrice === 'number' && isFinite(exitPrice)) ? exitPrice : rec.entry_price;
        
            // 计算收益（若未提供）
            let pp = typeof pnlPercent === 'number' && isFinite(pnlPercent) ? pnlPercent : null;
            let pa = typeof pnlAmount === 'number' && isFinite(pnlAmount as number) ? (pnlAmount as number) : null;
            if (pp == null) {
              const lev = Math.max(1, Number(rec.leverage) || 1);
              const baseMovePercent = rec.direction === 'LONG'
                ? ((safeExit - rec.entry_price) / rec.entry_price) * 100
                : ((rec.entry_price - safeExit) / rec.entry_price) * 100;
              pp = baseMovePercent * lev;
            }
            if (pa == null) {
              pa = (pp / 100) * (rec.position_size || 0);
            }
        
            // 结果类型
            let result: 'WIN' | 'LOSS' | 'BREAKEVEN';
            if (reason === 'BREAKEVEN' || Math.abs(pp) < 0.05) {
              result = 'BREAKEVEN';
            } else if (pp > 0) {
              result = 'WIN';
            } else {
              result = 'LOSS';
            }
        
            // 出场标签
            let exitLabel: RecommendationRecord['exit_label'];
            if (reason === 'TIMEOUT') {
              exitLabel = 'TIMEOUT';
            } else if (reason === 'BREAKEVEN' || result === 'BREAKEVEN') {
              exitLabel = 'BREAKEVEN';
            } else if (pp > 0.1) {
              exitLabel = 'DYNAMIC_TAKE_PROFIT';
            } else if (pp < -0.1) {
              exitLabel = 'DYNAMIC_STOP_LOSS';
            } else {
              exitLabel = undefined;
            }
        
            // 更新记录
            const now = new Date();
            rec.status = 'CLOSED';
            rec.result = result;
            rec.exit_price = Number(safeExit.toFixed(2));
            rec.exit_time = now;
            rec.exit_reason = reason;
            rec.exit_label = exitLabel;
            rec.current_price = rec.exit_price;
            rec.pnl_amount = Number(pa.toFixed(2));
            rec.pnl_percent = Number(pp.toFixed(2));
            rec.holding_duration = Math.floor((now.getTime() - rec.created_at.getTime()) / (60 * 1000));
            rec.updated_at = now;
        
            // 持久化
            await recommendationDatabase.initialize();
            try {
              await recommendationDatabase.updateRecommendation(rec);
            } catch (e) {
              const msg = (e as any)?.message || '';
              let retried = false;
              if (/CHECK constraint failed: exit_reason/i.test(msg)) {
                // 兼容旧库：exit_reason 不包含 BREAKEVEN/MANUAL 等时，置空以通过 CHECK（SQLite 对 NULL 放行）
                rec.exit_reason = undefined as any;
                retried = true;
              }
              if (/CHECK constraint failed: exit_label/i.test(msg)) {
                // 兼容旧库：exit_label 不包含 BREAKEVEN 等时，置空
                rec.exit_label = undefined;
                retried = true;
              }
              if (retried) {
                try {
                  await recommendationDatabase.updateRecommendation(rec);
                } catch (e2) {
                  console.error('[RecommendationTracker] Fallback update failed:', (e2 as any)?.message || String(e2));
                  throw e2;
                }
              } else {
                throw e;
              }
            }
        
            // 从活跃缓存移除
            this.activeRecommendations.delete(rec.id);
          } catch (e) {
            console.error('[RecommendationTracker] closeRecommendation failed:', (e as any)?.message || String(e));
            throw e;
          }
        }

            // 新增：强制平仓（超时历史归档）。保持接口名兼容，但使用 closeRecommendation 统一记账与统计。
            private async expireRecommendation(
              rec: RecommendationRecord,
              reason: 'TIMEOUT' = 'TIMEOUT'
            ): Promise<void> {
              // 统一改为“强制平仓”：使用当前价（或入场价兜底）计算盈亏并纳入统计
              let exitPrice = rec.current_price;
              if (exitPrice === undefined || exitPrice === null) {
                const priceResult = await this.getCurrentPrice(rec.symbol);
                exitPrice = priceResult?.currentPrice ?? rec.entry_price;
              }
              await this.closeRecommendation(rec, reason, exitPrice);
            }
            
            /**
             * 从数据库加载活跃推荐
             */
            private async loadActiveRecommendations(): Promise<void> {
              try {
                await recommendationDatabase.initialize();
                const actives = await recommendationDatabase.getActiveRecommendations();
                for (const rec of actives) {
                  const normalized = this.normalizeSymbol(rec.symbol);
                  if (normalized !== rec.symbol) {
                    rec.symbol = normalized;
                    try { await this.updateDatabase(rec); } catch (e) { /* best-effort */ }
                  }
                  this.activeRecommendations.set(rec.id, rec);
                }
                console.log(`Loaded ${actives.length} active recommendations from DB`);
              } catch (error) {
                console.error('Failed to load active recommendations from database:', error);
              }
            }
            
            /**
             * 获取推荐历史
             */
            async getRecommendationHistory(
              limit: number = 100,
              offset: number = 0,
              filters?: {
                strategy_type?: string;
                status?: string;
                result?: string;
                start_date?: Date;
                end_date?: Date;
              },
              include_active: boolean = false
            ): Promise<{ recommendations: RecommendationRecord[]; total: number }> {
              try {
                await recommendationDatabase.initialize();
                return await recommendationDatabase.getRecommendationHistory(limit, offset, filters, include_active);
              } catch (error) {
                console.error('Failed to get recommendation history:', error);
                return { recommendations: [], total: 0 };
              }
            }
            
            async manualCloseRecommendation(id: string, reason?: string): Promise<boolean> {
              try {
                const key = String(id).trim();
                let rec = this.activeRecommendations.get(key);
                if (rec) {
                  console.log(`[manualClose] hit active cache: id=${key}`);
                }

                if (!rec) {
                  // 尝试刷新内存活跃缓存
                  try {
                    console.log(`[manualClose] miss cache, reloading active recommendations from DB... id=${key}`);
                    await this.loadActiveRecommendations();
                  } catch (e) {
                    console.warn(`[manualClose] loadActiveRecommendations error for id=${key}:`, (e as any)?.message || String(e));
                  }
                  rec = this.activeRecommendations.get(key);
                  if (rec) {
                    console.log(`[manualClose] found in active cache after reload: id=${key}`);
                  }
                }

                if (!rec) {
                  // 退回到数据库查找（若为 PENDING/ACTIVE 也允许手动关闭）
                  try {
                    console.log(`[manualClose] not in cache, initializing DB for direct lookup: id=${key}`);
                    await recommendationDatabase.initialize();
                  } catch (e) {
                    console.warn(`[manualClose] recommendationDatabase.initialize() failed for id=${key}:`, (e as any)?.message || String(e));
                  }
                  try {
                    const dbRec = await recommendationDatabase.getRecommendationById(key);
                    if (!dbRec) {
                      console.warn(`[manualClose] DB lookup returned null for id=${key}`);
                    }
                    // 允许对 PENDING/ACTIVE 直接手动关闭；已 CLOSED/EXPIRED 则按未找到处理（由上层返回404）
                    if (dbRec && (dbRec.status === 'PENDING' || dbRec.status === 'ACTIVE')) {
                      rec = dbRec as any;
                      console.log(`[manualClose] found in DB by id: id=${key}, status=${dbRec.status}`);
                    }
                  } catch (e) {
                    console.warn(`[manualClose] direct DB lookup failed for id=${key}:`, (e as any)?.message || String(e));
                  }
                }

                if (!rec) {
                  console.warn(`Recommendation ${key} not found in active cache or database ACTIVE set`);
                  return false;
                }

                const finalReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TIMEOUT' | 'LIQUIDATION' | 'MANUAL' | 'BREAKEVEN' =
                  reason === 'LIQUIDATION' ? 'LIQUIDATION' :
                  reason === 'TAKE_PROFIT' ? 'TAKE_PROFIT' :
                  reason === 'STOP_LOSS' ? 'STOP_LOSS' :
                  reason === 'BREAKEVEN' ? 'BREAKEVEN' :
                  // 兼容旧库：部分环境 exit_reason CHECK 约束不包含 MANUAL，默认回退为 BREAKEVEN 以保证可关闭
                  // 如需保留 MANUAL 语义，请执行数据库迁移或重建表以放宽 CHECK 约束
                  (console.warn(`[manualClose] unknown or legacy reason='${reason}', fallback to BREAKEVEN to satisfy DB constraint`), 'BREAKEVEN');

                // 确保有可用的出场价：优先使用当前价，其次拉取行情，最后回退到入场价
                let exitPrice = rec.current_price as any;
                if (typeof exitPrice !== 'number' || !Number.isFinite(exitPrice)) {
                  try {
                    const p = await this.getCurrentPrice(rec.symbol);
                    if (p && typeof p.currentPrice === 'number' && Number.isFinite(p.currentPrice)) {
                      exitPrice = p.currentPrice;
                    } else {
                      exitPrice = rec.entry_price as any;
                    }
                  } catch {
                    exitPrice = rec.entry_price as any;
                  }
                }

                console.log(`[manualClose] closing id=${key} with reason=${finalReason}, exitPrice=${exitPrice}`);
                await this.closeRecommendation(rec as any, finalReason, exitPrice as number);
                this.activeRecommendations.delete(key);
                return true;
              } catch (error) {
                console.error('Failed to manually close recommendation:', error);
                return false;
              }
            }
                
                // 新增：保本出场（供策略引擎 TP1 后上移止损触发时调用）
                async breakevenCloseRecommendation(id: string, exitPrice: number): Promise<boolean> {
                  try {
                    const rec = this.activeRecommendations.get(id);
                    if (!rec) return false;
                    await this.closeRecommendation(rec, 'BREAKEVEN', exitPrice);
                    this.activeRecommendations.delete(id);
                    return true;
                  } catch (e) {
                    console.error('Failed to breakeven close recommendation:', e);
                    return false;
                  }
                }
                
                // 新增：手动标记过期（仅用于测试/维护用途，标记为 EXPIRED 并从活跃列表移除）
                async manualExpireRecommendation(id: string, _reason?: string): Promise<boolean> {
                  try {
                    const rec = this.activeRecommendations.get(id);
                    if (!rec) return false;
                    // 仅支持 TIMEOUT 语义，保持与 expireRecommendation 的类型一致
                    await this.expireRecommendation(rec, 'TIMEOUT');
                    this.activeRecommendations.delete(id);
                    return true;
                  } catch (e) {
                    console.error('Failed to manually expire recommendation:', e);
                    return false;
                  }
                }

                // 新增：代理数据库保存（创建时）
                private async saveToDatabase(rec: RecommendationRecord): Promise<void> {
                  try {
                    await recommendationDatabase.initialize();
                    await recommendationDatabase.saveRecommendation(rec);
                  } catch (e) {
                    const msg = (e as any)?.message || '';
                    const code = (e as any)?.code;
                    if (code === 'DUPLICATE_DEDUPE_KEY' || /UNIQUE constraint failed: recommendations\.dedupe_key/i.test(msg)) {
                      const windowMinutes = Number((config as any)?.strategy?.duplicateWindowMinutes ?? 10);
                      const bpsThreshold = Number((config as any)?.strategy?.duplicatePriceBps ?? 20);
                      // 将底层唯一约束错误映射为业务级 DuplicateError，API 将转 409
                      const dupErr: any = new DuplicateError({
                        symbol: rec.symbol,
                        direction: rec.direction,
                        strategy_type: rec.strategy_type,
                        windowMinutes,
                        bpsThreshold,
                        matchedIds: []
                      });
                      // 统一使用与显式重复检测一致的错误码，便于前端与脚本断言
                      dupErr.code = 'DUPLICATE_RECOMMENDATION';
                      dupErr.symbol = rec.symbol;
                      dupErr.direction = rec.direction;
                      dupErr.strategy_type = rec.strategy_type;
                      dupErr.windowMinutes = windowMinutes;
                      dupErr.bpsThreshold = bpsThreshold;
                      dupErr.matchedIds = [];
                      throw dupErr;
                    }
                    console.error('Failed to save recommendation to database:', e);
                    throw e;
                  }
                }

                // 新增：代理数据库更新（关闭/过期/价格更新时）
                private async updateDatabase(rec: RecommendationRecord): Promise<void> {
                  try {
                    await recommendationDatabase.initialize();
                    await recommendationDatabase.updateRecommendation(rec);
                  } catch (e) {
                    console.error('Failed to update recommendation in database:', e);
                    throw e;
                  }
                }

                // 新增：清理价格相关缓存（供API维护端点调用）
                clearPrices(): void {
                  try {
                    if (typeof (enhancedOKXDataService as any).clearCache === 'function') {
                      (enhancedOKXDataService as any).clearCache();
                    }
                  } catch (e) {
                    console.warn('clearPrices warning:', (e as any)?.message || String(e));
                  }
                }

                // 新增：获取价格监控缓存统计（供系统状态端点使用）
                getPriceMonitorStats(): { size: number; symbols: string[] } {
                  try {
                    const stats = (enhancedOKXDataService as any).getCacheStats?.();
                    const itemCount = Number((stats && (stats.itemCount ?? stats.cacheEntries)) || 0);
                    return { size: itemCount, symbols: [] };
                  } catch {
                    return { size: 0, symbols: [] };
                  }
                }

                // 启动跟踪器：加载活跃推荐并根据配置开始定时检查
                async start(): Promise<void> {
                  try {
                    if ((this as any)._checkTimer) {
                      return; // 已启动
                    }
                    // 先从数据库加载活跃推荐
                    try { await this.loadActiveRecommendations(); } catch {}

                    // 读取轮询间隔：优先使用 strategy.analysisInterval，其次使用 strategy.globalMinIntervalMs，最后默认 15000ms
                    const strat: any = (config as any)?.strategy || {};
                    const intervalMs: number = Math.max(5000, Number(strat.analysisInterval ?? strat.globalMinIntervalMs ?? 15000));

                    // 立即执行一次，随后按间隔执行
                    const tick = async () => {
                      try { await this.checkRecommendations(); } catch (err) { console.error('[RecommendationTracker] periodic check failed:', (err as any)?.message || String(err)); }
                    };
                    await tick();
                    (this as any)._checkTimer = setInterval(tick, intervalMs);
                  } catch (err) {
                    console.error('[RecommendationTracker] start() error:', (err as any)?.message || String(err));
                    throw err;
                  }
                }

                // 停止跟踪器：清理定时器
                async stop(): Promise<void> {
                  try {
                    if ((this as any)._checkTimer) {
                      clearInterval((this as any)._checkTimer);
                      (this as any)._checkTimer = null;
                    }
                  } catch (err) {
                    console.error('[RecommendationTracker] stop() error:', (err as any)?.message || String(err));
                    throw err;
                  }
                }

                // 查询运行状态（供 API 系统状态端点使用）
                public isRunningStatus(): boolean {
                  return !!(this as any)._checkTimer;
                }
}

// 业务错误类型导出（供 API / 集成服务捕获并映射为业务状态码）
export class CooldownError extends Error {
  code = 'COOLDOWN';
  constructor(message: string) { super(message); this.name = 'CooldownError'; }
}
export class OppositeConstraintError extends Error {
  code = 'OPPOSITE_CONSTRAINT';
  constructor(message: string) { super(message); this.name = 'OppositeConstraintError'; }
}
export class ExposureLimitError extends Error {
  code = 'EXPOSURE_LIMIT';
  direction?: 'LONG' | 'SHORT';
  limit?: number;
  constructor(message: string) { super(message); this.name = 'ExposureLimitError'; }
}
export class ExposureCapError extends Error {
  code = 'EXPOSURE_CAP';
  scope?: 'TOTAL' | 'LONG' | 'SHORT';
  direction?: 'LONG' | 'SHORT';
  current?: number; // 当前已用敞口
  candidate?: number; // 候选新增敞口
  cap?: number; // 上限
  constructor(message: string) { super(message); this.name = 'ExposureCapError'; }
}
export class DuplicateError extends Error {
  code = 'DUPLICATE';
  payload?: any;
  constructor(payload?: any) { super('Duplicate recommendation'); this.name = 'DuplicateError'; this.payload = payload; }
}
// 新增：多TF一致性错误（门控拒绝）
export class MTFConsistencyError extends Error {
  code = 'MTF_CONSISTENCY';
  constructor(message: string) { super(message); this.name = 'MTFConsistencyError'; }
}

export const recommendationTracker = new RecommendationTracker();