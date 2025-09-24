import { RecommendationDatabase } from './recommendation-database.js';
import { RecommendationRecord } from './recommendation-tracker.js';

/**
 * 策略统计信息接口
 */
export interface StrategyStatistics {
  strategy_type: string;
  total_recommendations: number;
  active_recommendations: number;
  closed_recommendations: number;
  
  // 结果统计
  win_count: number;
  loss_count: number;
  breakeven_count: number;
  
  // 胜率指标
  win_rate: number; // 胜率百分比
  loss_rate: number; // 败率百分比
  breakeven_rate: number; // 平局率百分比
  
  // 收益指标
  total_pnl_amount: number;
  total_pnl_percent: number;
  avg_pnl_percent: number;
  max_win_percent: number;
  max_loss_percent: number;
  
  // 风险指标
  sharpe_ratio?: number;
  max_drawdown?: number;
  volatility?: number;
  
  // 时间指标
  avg_holding_duration: number; // 平均持仓时长（分钟）
  min_holding_duration: number;
  max_holding_duration: number;
  
  // 更新时间
  last_updated: Date;
  calculation_period: string; // 'daily', 'weekly', 'monthly', 'all_time'
}

// 新增：EV 统计返回类型
export interface EVBinMetric {
  bin_label: string;
  count: number;
  win_rate: number; // 百分比
  avg_pnl_percent: number; // 百分比
  mean_ev: number | null;
}

export interface EVvsPnLStatsResult {
  total: number;
  closed: number;
  with_ev: number;
  mean_ev: number | null;
  mean_pnl_percent: number | null;
  corr_pearson: number | null;
  corr_spearman: number | null;
  sign_consistency_rate: number; // ev 与 pnl_percent 同号比例
  ev_ok: {
    true_group: { count: number; win_rate: number; avg_pnl_percent: number };
    false_group: { count: number; win_rate: number; avg_pnl_percent: number };
  };
  bins: EVBinMetric[];
  by_ab_group?: Record<string, Omit<EVvsPnLStatsResult, 'by_ab_group'>>;
}

/**
 * 综合统计信息接口
 */
export interface OverallStatistics {
  total_strategies: number;
  total_recommendations: number;
  active_recommendations: number;
  
  // 全局胜率
  overall_win_rate: number;
  overall_avg_pnl: number;
  overall_total_pnl: number;
  
  // 最佳/最差策略
  best_strategy: {
    name: string;
    win_rate: number;
    avg_pnl: number;
  };
  worst_strategy: {
    name: string;
    win_rate: number;
    avg_pnl: number;
  };
  
  // 时间范围统计
  daily_stats: {
    recommendations_today: number;
    pnl_today: number;
    win_rate_today: number;
  };
  
  weekly_stats: {
    recommendations_this_week: number;
    pnl_this_week: number;
    win_rate_this_week: number;
  };
  
  monthly_stats: {
    recommendations_this_month: number;
    pnl_this_month: number;
    win_rate_this_month: number;
  };
}

/**
 * 胜率统计计算器
 * 负责计算和维护各种策略的统计指标
 */
export class StatisticsCalculator {
  private database: RecommendationDatabase;
  private statisticsCache: Map<string, StrategyStatistics> = new Map();
  private overallStatsCache: OverallStatistics | null = null;
  private cacheExpiry: number = 5 * 60 * 1000; // 5分钟缓存
  private lastCacheUpdate: number = 0;
  
  constructor(database: RecommendationDatabase) {
    this.database = database;
  }
  
  /**
   * 计算指定策略的统计信息
   */
  async calculateStrategyStatistics(
    strategyType: string,
    period: 'daily' | 'weekly' | 'monthly' | 'all_time' = 'all_time'
  ): Promise<StrategyStatistics> {
    const cacheKey = `${strategyType}_${period}`;
    const cached = this.statisticsCache.get(cacheKey);
    
    // 检查缓存是否有效
    if (cached && (Date.now() - this.lastCacheUpdate) < this.cacheExpiry) {
      return cached;
    }
    
    try {
      // 获取时间范围过滤器
      const dateFilter = this.getDateFilter(period);
      
      // 查询推荐历史
      const { recommendations } = await this.database.getRecommendationHistory(
        10000, // 获取大量数据进行统计
        0,
        {
          strategy_type: strategyType,
          ...dateFilter
        }
      );
      
      // 计算统计信息
      const stats = this.computeStrategyStatistics(strategyType, recommendations, period);
      
      // 更新缓存
      this.statisticsCache.set(cacheKey, stats);
      this.lastCacheUpdate = Date.now();
      
      return stats;
      
    } catch (error) {
      console.error(`Failed to calculate statistics for strategy ${strategyType}:`, error);
      
      // 返回默认统计
      return this.getDefaultStrategyStatistics(strategyType, period);
    }
  }
  
  /**
   * 计算综合统计信息
   */
  async calculateOverallStatistics(): Promise<OverallStatistics> {
    // 检查缓存
    if (this.overallStatsCache && (Date.now() - this.lastCacheUpdate) < this.cacheExpiry) {
      return this.overallStatsCache;
    }
    
    try {
      // 获取所有推荐数据
      const { recommendations } = await this.database.getRecommendationHistory(10000, 0);
      
      // 按策略分组
      const strategyGroups = this.groupByStrategy(recommendations);
      
      // 计算各策略统计
      const strategyStats: StrategyStatistics[] = [];
      for (const entry of Array.from(strategyGroups.entries())) {
        const [strategyType, recs] = entry;
        const stats = this.computeStrategyStatistics(strategyType, recs, 'all_time');
        strategyStats.push(stats);
      }
      
      // 计算综合统计
      const overallStats = this.computeOverallStatistics(recommendations, strategyStats);
      
      // 更新缓存
      this.overallStatsCache = overallStats;
      this.lastCacheUpdate = Date.now();
      
      return overallStats;
      
    } catch (error) {
      console.error('Failed to calculate overall statistics:', error);
      return this.getDefaultOverallStatistics();
    }
  }
  
  /**
   * 实时更新统计信息（当推荐状态改变时调用）
   */
  async updateStatisticsOnRecommendationChange(recommendation: RecommendationRecord): Promise<void> {
    try {
      // 清除相关缓存
      this.clearCacheForStrategy(recommendation.strategy_type ?? 'UNKNOWN');
      this.overallStatsCache = null;
      
      // 可选：立即重新计算该策略的统计
      await this.calculateStrategyStatistics(recommendation.strategy_type ?? 'UNKNOWN');
      
    } catch (error) {
      console.error('Failed to update statistics on recommendation change:', error);
    }
  }
  
  /**
   * 根据统计周期生成时间过滤条件
   */
  private getDateFilter(period: 'daily' | 'weekly' | 'monthly' | 'all_time'):
    { start_date?: Date; end_date?: Date } {
    if (period === 'all_time') return {};
    const now = new Date();
    let start: Date;
    if (period === 'daily') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'weekly') {
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else {
      // monthly
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    return { start_date: start, end_date: now };
  }

  /**
   * 获取所有策略的统计信息
   */
  async getAllStrategyStatistics(): Promise<StrategyStatistics[]> {
    try {
      // 获取所有不同的策略类型
      const { recommendations } = await this.database.getRecommendationHistory(10000, 0);
      const strategyTypes = Array.from(new Set(recommendations.map(r => r.strategy_type ?? 'UNKNOWN')));
      
      // 并发计算各策略统计
      const statsPromises = strategyTypes.map(type => 
        this.calculateStrategyStatistics(type)
      );
      
      const allStats = await Promise.all(statsPromises);
      return allStats;
      
    } catch (error) {
      console.error('Failed to get all strategy statistics:', error);
      return [];
    }
  }
  
  /**
   * 计算策略统计信息的核心逻辑
   */
  private computeStrategyStatistics(
    strategyType: string,
    recommendations: RecommendationRecord[],
    period: string
  ): StrategyStatistics {
    const total = recommendations.length;
    const active = recommendations.filter(r => r.status === 'ACTIVE').length;
    const closed = recommendations.filter(r => r.status === 'CLOSED');
    
    // 结果统计
    const wins = closed.filter(r => r.result === 'WIN');
    const losses = closed.filter(r => r.result === 'LOSS');
    const breakevens = closed.filter(r => r.result === 'BREAKEVEN');
    
    const winCount = wins.length;
    const lossCount = losses.length;
    const breakevenCount = breakevens.length;
    const closedCount = closed.length;
    
    // 胜率计算
    const winRate = closedCount > 0 ? (winCount / closedCount) * 100 : 0;
    const lossRate = closedCount > 0 ? (lossCount / closedCount) * 100 : 0;
    const breakevenRate = closedCount > 0 ? (breakevenCount / closedCount) * 100 : 0;
    
    // 收益统计
    const pnlValues = closed.map(r => r.pnl_percent || 0);
    const totalPnlPercent = pnlValues.reduce((sum, pnl) => sum + pnl, 0);
    const avgPnlPercent = pnlValues.length > 0 ? totalPnlPercent / pnlValues.length : 0;
    const maxWinPercent = wins.length > 0 ? Math.max(...wins.map(r => r.pnl_percent || 0)) : 0;
    const maxLossPercent = losses.length > 0 ? Math.min(...losses.map(r => r.pnl_percent || 0)) : 0;
    
    const totalPnlAmount = closed.reduce((sum, r) => sum + (r.pnl_amount || 0), 0);
    
    // 时间统计
    const durations = closed.map(r => r.holding_duration || 0).filter(d => d > 0);
    const avgHoldingDuration = durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0;
    const minHoldingDuration = durations.length > 0 ? Math.min(...durations) : 0;
    const maxHoldingDuration = durations.length > 0 ? Math.max(...durations) : 0;
    
    // 风险指标计算
    const sharpeRatio = this.calculateSharpeRatio(pnlValues);
    const maxDrawdown = this.calculateMaxDrawdown(pnlValues);
    const volatility = this.calculateVolatility(pnlValues);
    
    return {
      strategy_type: strategyType,
      total_recommendations: total,
      active_recommendations: active,
      closed_recommendations: closedCount,
      
      win_count: winCount,
      loss_count: lossCount,
      breakeven_count: breakevenCount,
      
      win_rate: winRate,
      loss_rate: lossRate,
      breakeven_rate: breakevenRate,
      
      total_pnl_amount: totalPnlAmount,
      total_pnl_percent: totalPnlPercent,
      avg_pnl_percent: avgPnlPercent,
      max_win_percent: maxWinPercent,
      max_loss_percent: maxLossPercent,
      
      sharpe_ratio: sharpeRatio,
      max_drawdown: maxDrawdown,
      volatility: volatility,
      
      avg_holding_duration: avgHoldingDuration,
      min_holding_duration: minHoldingDuration,
      max_holding_duration: maxHoldingDuration,
      
      last_updated: new Date(),
      calculation_period: period
    };
  }
  
  /**
   * 按策略类型分组
   */
  private groupByStrategy(recommendations: RecommendationRecord[]): Map<string, RecommendationRecord[]> {
    const map = new Map<string, RecommendationRecord[]>();
    for (const r of recommendations) {
      const key = r.strategy_type ?? 'UNKNOWN';
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return map;
  }

  /**
   * 返回默认的策略统计（当计算失败时使用）
   */
  private getDefaultStrategyStatistics(strategyType: string, period: 'daily' | 'weekly' | 'monthly' | 'all_time'): StrategyStatistics {
    return {
      strategy_type: strategyType,
      total_recommendations: 0,
      active_recommendations: 0,
      closed_recommendations: 0,
      win_count: 0,
      loss_count: 0,
      breakeven_count: 0,
      win_rate: 0,
      loss_rate: 0,
      breakeven_rate: 0,
      total_pnl_amount: 0,
      total_pnl_percent: 0,
      avg_pnl_percent: 0,
      max_win_percent: 0,
      max_loss_percent: 0,
      sharpe_ratio: 0,
      max_drawdown: 0,
      volatility: 0,
      avg_holding_duration: 0,
      min_holding_duration: 0,
      max_holding_duration: 0,
      last_updated: new Date(),
      calculation_period: period
    };
  }

  /**
   * 返回默认的综合统计（当计算失败时使用）
   */
  private getDefaultOverallStatistics(): OverallStatistics {
    return {
      total_strategies: 0,
      total_recommendations: 0,
      active_recommendations: 0,
      overall_win_rate: 0,
      overall_avg_pnl: 0,
      overall_total_pnl: 0,
      best_strategy: { name: 'N/A', win_rate: 0, avg_pnl: 0 },
      worst_strategy: { name: 'N/A', win_rate: 0, avg_pnl: 0 },
      daily_stats: { recommendations_today: 0, pnl_today: 0, win_rate_today: 0 },
      weekly_stats: { recommendations_this_week: 0, pnl_this_week: 0, win_rate_this_week: 0 },
      monthly_stats: { recommendations_this_month: 0, pnl_this_month: 0, win_rate_this_month: 0 }
    };
  }

  /**
   * 计算综合统计信息
   */
  private computeOverallStatistics(
    allRecommendations: RecommendationRecord[],
    strategyStats: StrategyStatistics[]
  ): OverallStatistics {
    const totalStrategies = strategyStats.length;
    const totalRecommendations = allRecommendations.length;
    const activeRecommendations = allRecommendations.filter(r => r.status === 'ACTIVE').length;
    
    const closed = allRecommendations.filter(r => r.status === 'CLOSED');
    const wins = closed.filter(r => r.result === 'WIN').length;
    const overallWinRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
    
    const totalPnl = closed.reduce((sum, r) => sum + (r.pnl_percent || 0), 0);
    const avgPnl = closed.length > 0 ? totalPnl / closed.length : 0;
    
    // 找出最佳和最差策略
    const sortedByWinRate = [...strategyStats].sort((a, b) => b.win_rate - a.win_rate);
    const bestStrategy = sortedByWinRate[0] || { strategy_type: 'N/A', win_rate: 0, avg_pnl_percent: 0 };
    const worstStrategy = sortedByWinRate[sortedByWinRate.length - 1] || { strategy_type: 'N/A', win_rate: 0, avg_pnl_percent: 0 };
    
    // 时间范围统计
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const todayRecs = allRecommendations.filter(r => r.created_at >= today);
    const weekRecs = allRecommendations.filter(r => r.created_at >= thisWeek);
    const monthRecs = allRecommendations.filter(r => r.created_at >= thisMonth);
    
    const dailyStats = this.calculatePeriodStats(todayRecs);
    const weeklyStats = {
      recommendations_this_week: weekRecs.length,
      pnl_this_week: this.calculatePeriodStats(weekRecs).pnl_today,
      win_rate_this_week: this.calculatePeriodStats(weekRecs).win_rate_today
    };
    const monthlyStats = {
      recommendations_this_month: monthRecs.length,
      pnl_this_month: this.calculatePeriodStats(monthRecs).pnl_today,
      win_rate_this_month: this.calculatePeriodStats(monthRecs).win_rate_today
    };
    
    return {
      total_strategies: totalStrategies,
      total_recommendations: totalRecommendations,
      active_recommendations: activeRecommendations,
      
      overall_win_rate: overallWinRate,
      overall_avg_pnl: avgPnl,
      overall_total_pnl: totalPnl,
      
      best_strategy: {
        name: bestStrategy.strategy_type,
        win_rate: bestStrategy.win_rate,
        avg_pnl: bestStrategy.avg_pnl_percent
      },
      worst_strategy: {
        name: worstStrategy.strategy_type,
        win_rate: worstStrategy.win_rate,
        avg_pnl: worstStrategy.avg_pnl_percent
      },
      
      daily_stats: dailyStats,
      weekly_stats: weeklyStats,
      monthly_stats: monthlyStats
    };
  }
  
  /**
   * 计算指定时间段的统计
   */
  private calculatePeriodStats(recommendations: RecommendationRecord[]): {
    recommendations_today: number;
    pnl_today: number;
    win_rate_today: number;
  } {
    const total = recommendations.length;
    const closed = recommendations.filter(r => r.status === 'CLOSED');
    const wins = closed.filter(r => r.result === 'WIN').length;
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
    const totalPnl = closed.reduce((sum, r) => sum + (r.pnl_percent || 0), 0);
    
    return {
      recommendations_today: total,
      pnl_today: totalPnl,
      win_rate_today: winRate
    };
  }
  
  /**
   * 计算夏普比率
   */
  private calculateSharpeRatio(pnlValues: number[]): number {
    if (pnlValues.length < 2) return 0;
    
    const mean = pnlValues.reduce((sum, val) => sum + val, 0) / pnlValues.length;
    const variance = pnlValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / pnlValues.length;
    const stdDev = Math.sqrt(variance);
    
    return stdDev > 0 ? mean / stdDev : 0;
  }
  
  /**
   * 计算最大回撤
   */
  private calculateMaxDrawdown(pnlValues: number[]): number {
    if (pnlValues.length === 0) return 0;
    
    let maxDrawdown = 0;
    let peak = 0;
    let cumulativePnl = 0;
    
    for (const pnl of pnlValues) {
      cumulativePnl += pnl;
      peak = Math.max(peak, cumulativePnl);
      const drawdown = peak - cumulativePnl;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    return maxDrawdown;
  }
  
  /**
   * 计算波动率
   */
  private calculateVolatility(pnlValues: number[]): number {
    if (pnlValues.length < 2) return 0;
    
    const mean = pnlValues.reduce((sum, val) => sum + val, 0) / pnlValues.length;
    const variance = pnlValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / pnlValues.length;
    
    return Math.sqrt(variance);
  }
  
  // 新增：计算 EV vs 实现 PnL 统计
  async computeEVvsPnLStats(options?: {
    start_date?: Date;
    end_date?: Date;
    strategy_type?: string;
    ab_group?: string | string[];
    bins?: number;
    bin_mode?: 'quantile' | 'even';
    // 新增：是否强制按 AB 细分（即使只有一个分组也返回 by_ab_group）
    breakdown_by_ab?: boolean;
  }): Promise<EVvsPnLStatsResult> {
    // 确保数据库已初始化（在禁用全局初始化时依然可用）
    try { await (this.database as any).initialize?.(); } catch {}
    const bins = Math.max(2, Math.min(12, Number(options?.bins ?? 5)));
    const binMode = (options?.bin_mode ?? 'quantile') as 'quantile' | 'even';

    const filters: any = {};
    if (options?.strategy_type) filters.strategy_type = options.strategy_type;
    if (options?.start_date) filters.start_date = options.start_date;
    if (options?.end_date) filters.end_date = options.end_date;

    const { recommendations } = await this.database.getRecommendationHistory(100000, 0, filters, false);

    // 仅 closed 且有 pnl_percent 的记录（稍后应用 AB 过滤）
    const closedAll = recommendations.filter(r => r.status === 'CLOSED' && typeof r.pnl_percent === 'number');

    // 处理 AB 过滤集合
    let abItemsFromOption: string[] | undefined;
    if (Array.isArray(options?.ab_group)) {
      abItemsFromOption = options?.ab_group.map(s => String(s).trim()).filter(Boolean);
    } else if (typeof options?.ab_group === 'string') {
      abItemsFromOption = String(options?.ab_group).split(',').map(s => s.trim()).filter(Boolean);
    }
    const abSet = abItemsFromOption ? new Set(abItemsFromOption) : undefined;

    // 应用 AB 过滤（若有）
    const closedFiltered = abSet ? closedAll.filter(r => r.ab_group && abSet!.has(String(r.ab_group))) : closedAll;

    // 透传 ev/expected_return + 保留 AB 过滤
    let recs = closedFiltered.map(r => ({ ...r, ev: (typeof r.ev === 'number' ? r.ev : (r as any).expected_return) }))
      .filter(r => typeof (r as any).ev === 'number');

    // 计算总量统计：总推荐数/已关闭/含EV（均在所有其他过滤条件之后再计算 AB 过滤）
    const totalAfterFilters = abSet ? recommendations.filter(r => r.ab_group && abSet!.has(String(r.ab_group))).length : recommendations.length;
    const closedCount = closedFiltered.length;
    const withEvCount = recs.length;

    if (recs.length === 0) {
      return {
        total: totalAfterFilters,
        closed: closedCount,
        with_ev: withEvCount,
        mean_ev: null,
        mean_pnl_percent: null,
        corr_pearson: null,
        corr_spearman: null,
        sign_consistency_rate: 0,
        ev_ok: { true_group: { count: 0, win_rate: 0, avg_pnl_percent: 0 }, false_group: { count: 0, win_rate: 0, avg_pnl_percent: 0 } },
        bins: [],
      };
    }

    const evVals = recs.map(r => (r as any).ev as number);
    const pnlVals = recs.map(r => r.pnl_percent as number);

    const mean_ev = evVals.reduce((a, b) => a + b, 0) / evVals.length;
    const mean_pnl_percent = pnlVals.reduce((a, b) => a + b, 0) / pnlVals.length;

    const corr_pearson = this.pearson(evVals, pnlVals);
    const corr_spearman = this.spearman(evVals, pnlVals);

    const sign_consistency_rate = recs.length > 0
      ? recs.reduce((acc, r) => acc + ((Number((r as any).ev) === 0 || Number(r.pnl_percent) === 0) ? 0 : (Math.sign(Number((r as any).ev)) === Math.sign(Number(r.pnl_percent)) ? 1 : 0)), 0) / recs.length * 100
      : 0;

    // ev_ok 分组
    const trueGroup = recs.filter(r => (r as any).ev_ok === true);
    const falseGroup = recs.filter(r => (r as any).ev_ok === false);
    const ev_ok = {
      true_group: this.basicGroupMetrics(trueGroup),
      false_group: this.basicGroupMetrics(falseGroup)
    };

    // 分箱
    const thresholds = this.computeBins(evVals, bins, binMode);
    const binMetrics: EVBinMetric[] = thresholds.map((thr, idx) => {
      const [low, high] = thr;
      const inBin = recs.filter(r => {
        const v = Number((r as any).ev);
        const geLow = idx === 0 ? v >= low : v > low;
        const leHigh = idx === thresholds.length - 1 ? v <= high : v <= high;
        return geLow && leHigh;
      });
      const met = this.basicGroupMetrics(inBin);
      return {
        bin_label: `[${low.toFixed(4)}, ${high.toFixed(4)}]`,
        count: inBin.length,
        win_rate: met.win_rate,
        avg_pnl_percent: met.avg_pnl_percent,
        mean_ev: inBin.length ? (inBin.reduce((s, r) => s + Number((r as any).ev), 0) / inBin.length) : null
      };
    });

    // AB 分组细化
    let by_ab_group: EVvsPnLStatsResult['by_ab_group'] | undefined = undefined;
    // 确定需要细分的 AB 列表
    let abItems: string[] | undefined = abItemsFromOption;
    if (!abItems && options?.breakdown_by_ab) {
      abItems = Array.from(new Set(recommendations.map(r => String((r as any).ab_group)).filter(Boolean)));
    }
    const shouldBreakdown = !!abItems && (options?.breakdown_by_ab || (abItems.length > 1));
    if (shouldBreakdown && abItems && abItems.length > 0) {
      by_ab_group = {};
      for (const gRaw of abItems) {
        const g = String(gRaw).trim();
        if (!g) continue;
        const subAllTotal = recommendations.filter(r => String((r as any).ab_group) === g).length;
        const subAllClosed = recommendations.filter(r => r.status === 'CLOSED' && String((r as any).ab_group) === g).length;
        const sub = recs.filter(r => String((r as any).ab_group) === g);
        const subEv = sub.map(r => (r as any).ev as number);
        const subPnl = sub.map(r => r.pnl_percent as number);
        const subBins = this.computeBins(subEv, bins, binMode);
        const subBinMetrics: EVBinMetric[] = subBins.map((thr, idx) => {
          const [low, high] = thr;
          const inBin = sub.filter(r => {
            const v = Number((r as any).ev);
            const geLow = idx === 0 ? v >= low : v > low;
            const leHigh = idx === subBins.length - 1 ? v <= high : v <= high;
            return geLow && leHigh;
          });
          const met = this.basicGroupMetrics(inBin);
          return {
            bin_label: `[${low.toFixed(4)}, ${high.toFixed(4)}]`,
            count: inBin.length,
            win_rate: met.win_rate,
            avg_pnl_percent: met.avg_pnl_percent,
            mean_ev: inBin.length ? (inBin.reduce((s, r) => s + Number((r as any).ev), 0) / inBin.length) : null
          };
        });
        (by_ab_group as any)[g] = {
          total: subAllTotal,
          closed: subAllClosed,
          with_ev: sub.length,
          mean_ev: subEv.length ? (subEv.reduce((a, b) => a + b, 0) / subEv.length) : null,
          mean_pnl_percent: subPnl.length ? (subPnl.reduce((a, b) => a + b, 0) / subPnl.length) : null,
          corr_pearson: this.pearson(subEv, subPnl),
          corr_spearman: this.spearman(subEv, subPnl),
          sign_consistency_rate: sub.length ? (sub.reduce((acc, r) => acc + ((Number((r as any).ev) === 0 || Number(r.pnl_percent) === 0) ? 0 : (Math.sign(Number((r as any).ev)) === Math.sign(Number(r.pnl_percent)) ? 1 : 0)), 0) / sub.length * 100) : 0,
          ev_ok: {
            true_group: this.basicGroupMetrics(sub.filter(r => (r as any).ev_ok === true)),
            false_group: this.basicGroupMetrics(sub.filter(r => (r as any).ev_ok === false))
          },
          bins: subBinMetrics
        } as EVvsPnLStatsResult;
      }
    }

    return {
      total: totalAfterFilters,
      closed: closedCount,
      with_ev: withEvCount,
      mean_ev,
      mean_pnl_percent,
      corr_pearson,
      corr_spearman,
      sign_consistency_rate,
      ev_ok,
      bins: binMetrics,
      by_ab_group
    };
  }

  // 新增：EV 监控曲线统计（按时间窗 / 阈值分组）
  async computeEVMonitoring(options?: {
    window?: '1d' | '7d' | '30d';
    start_date?: Date;
    end_date?: Date;
    strategy_type?: string;
    group_by?: 'ev' | 'ev_threshold';
    bins?: number;
  }): Promise<{
    overall: { count: number; win_rate: number; avg_pnl_percent: number };
    ev_ok: { true_group: { count: number; win_rate: number; avg_pnl_percent: number }; false_group: { count: number; win_rate: number; avg_pnl_percent: number } };
    by_bins: EVBinMetric[];
  }> {
    // 确保数据库已初始化
    try { await (this.database as any).initialize?.(); } catch {}
    const groupBy = (options?.group_by ?? 'ev') as 'ev' | 'ev_threshold';
    const bins = Math.max(2, Math.min(12, Number(options?.bins ?? 5)));

    let start: Date | undefined = options?.start_date;
    let end: Date | undefined = options?.end_date;
    if (!start && !end && options?.window) {
      const now = new Date();
      end = now;
      const days = options.window === '1d' ? 1 : options.window === '30d' ? 30 : 7;
      start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    }

    const filters: any = {};
    if (options?.strategy_type) filters.strategy_type = options.strategy_type;
    if (start) filters.start_date = start;
    if (end) filters.end_date = end;

    const { recommendations } = await this.database.getRecommendationHistory(100000, 0, filters, false);
    const closed = recommendations.filter(r => r.status === 'CLOSED' && typeof r.pnl_percent === 'number');
    const withEv = closed.map(r => ({ ...r, ev: (typeof r.ev === 'number' ? r.ev : (r as any).expected_return) }));

    const overall = this.basicGroupMetrics(withEv);

    const evOk = {
      true_group: this.basicGroupMetrics(withEv.filter(r => (r as any).ev_ok === true)),
      false_group: this.basicGroupMetrics(withEv.filter(r => (r as any).ev_ok === false))
    };

    // 分箱
    const values = withEv.map(r => Number((r as any)[groupBy] ?? (groupBy === 'ev' ? (r as any).ev : (r as any).ev_threshold))).filter(v => Number.isFinite(v));
    const thresholds = this.computeBins(values, bins, 'quantile');
    const by_bins: EVBinMetric[] = thresholds.map((thr, idx) => {
      const [low, high] = thr;
      const inBin = withEv.filter(r => {
        const v = Number((r as any)[groupBy] ?? (groupBy === 'ev' ? (r as any).ev : (r as any).ev_threshold));
        const geLow = idx === 0 ? v >= low : v > low;
        const leHigh = idx === thresholds.length - 1 ? v <= high : v <= high;
        return Number.isFinite(v) && geLow && leHigh;
      });
      const met = this.basicGroupMetrics(inBin);
      return {
        bin_label: `${groupBy}:[${low.toFixed(4)}, ${high.toFixed(4)}]`,
        count: inBin.length,
        win_rate: met.win_rate,
        avg_pnl_percent: met.avg_pnl_percent,
        mean_ev: inBin.length ? (inBin.reduce((s, r) => s + Number((r as any).ev), 0) / inBin.length) : null
      };
    });

    return { overall, ev_ok: evOk, by_bins };
  }

  // 清理所有统计缓存（供外部API在变更后调用）
  public clearAllCache(): void {
    try {
      this.statisticsCache.clear();
    } catch {}
    this.overallStatsCache = null;
    this.lastCacheUpdate = 0;
  }

  // 按策略类型清理对应缓存项
  public clearCacheForStrategy(strategyType: string): void {
    const prefix = `${strategyType}_`;
    for (const key of Array.from(this.statisticsCache.keys())) {
      if (key.startsWith(prefix)) {
        this.statisticsCache.delete(key);
      }
    }
    // 让整体缓存失效时间回退，避免读取到旧值
    this.lastCacheUpdate = 0;
  }

  // 基础分组指标（胜率与均值），以百分比返回
  private basicGroupMetrics(recs: RecommendationRecord[]): { count: number; win_rate: number; avg_pnl_percent: number } {
    const count = recs.length;
    if (!count) return { count: 0, win_rate: 0, avg_pnl_percent: 0 };
    const closed = recs;
    const wins = closed.filter(r => r.result === 'WIN').length;
    const win_rate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
    const avg_pnl_percent = closed.length > 0 ? (closed.reduce((s, r) => s + (r.pnl_percent || 0), 0) / closed.length) : 0;
    return { count, win_rate, avg_pnl_percent };
  }

  // 计算分箱阈值
  private computeBins(values: number[], bins: number, mode: 'quantile' | 'even'): Array<[number, number]> {
    const arr = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
    if (arr.length === 0) return [];
    if (mode === 'even') {
      const min = arr[0];
      const max = arr[arr.length - 1];
      const step = (max - min) / bins;
      const out: Array<[number, number]> = [];
      for (let i = 0; i < bins; i++) {
        const low = min + i * step;
        const high = i === bins - 1 ? max : min + (i + 1) * step;
        out.push([low, high]);
      }
      return out;
    }
    // quantile
    const out: Array<[number, number]> = [];
    for (let i = 0; i < bins; i++) {
      const qLow = i / bins;
      const qHigh = (i + 1) / bins;
      const low = this.quantile(arr, qLow);
      const high = this.quantile(arr, qHigh);
      out.push([low, high]);
    }
    // 去除重复区间（当分布平坦时）
    const dedup: Array<[number, number]> = [];
    for (const [l, h] of out) {
      if (!dedup.length || dedup[dedup.length - 1][1] < h || dedup[dedup.length - 1][0] < l) {
        dedup.push([l, h]);
      }
    }
    return dedup.length ? dedup : out;
  }

  private quantile(sorted: number[], q: number): number {
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
      return sorted[base];
    }
  }

  private pearson(x: number[], y: number[]): number | null {
    const n = Math.min(x.length, y.length);
    if (n < 2) return null;
    const xs = x.slice(0, n);
    const ys = y.slice(0, n);
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - meanX;
      const dy = ys[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    const den = Math.sqrt(denX) * Math.sqrt(denY);
    if (den === 0) return 0;
    return num / den;
  }

  private spearman(x: number[], y: number[]): number | null {
    const n = Math.min(x.length, y.length);
    if (n < 2) return null;
    const rank = (arr: number[]): number[] => {
      const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
      const ranks = new Array(arr.length);
      let r = 1;
      for (let k = 0; k < sorted.length; ) {
        let j = k;
        while (j < sorted.length && sorted[j].v === sorted[k].v) j++;
        const avgRank = (r + (r + (j - k - 1))) / 2; // 处理并列，取平均名次
        for (let m = k; m < j; m++) ranks[sorted[m].i] = avgRank;
        r += j - k;
        k = j;
      }
      return ranks;
    };
    const rx = rank(x);
    const ry = rank(y);
    return this.pearson(rx, ry);
  }

  // 新增：缓存状态
  public getCacheStatus(): { entries: number; overallCached: boolean; lastUpdate: number; expiryMs: number } {
    return {
      entries: this.statisticsCache.size,
      overallCached: this.overallStatsCache != null,
      lastUpdate: this.lastCacheUpdate,
      expiryMs: this.cacheExpiry
    };
  }
}