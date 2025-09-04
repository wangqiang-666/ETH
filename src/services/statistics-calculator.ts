import { RecommendationDatabase } from './recommendation-database';
import { RecommendationRecord } from './recommendation-tracker';

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
      for (const [strategyType, recs] of strategyGroups) {
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
      this.clearCacheForStrategy(recommendation.strategy_type);
      this.overallStatsCache = null;
      
      // 可选：立即重新计算该策略的统计
      await this.calculateStrategyStatistics(recommendation.strategy_type);
      
    } catch (error) {
      console.error('Failed to update statistics on recommendation change:', error);
    }
  }
  
  /**
   * 获取所有策略的统计信息
   */
  async getAllStrategyStatistics(): Promise<StrategyStatistics[]> {
    try {
      // 获取所有不同的策略类型
      const { recommendations } = await this.database.getRecommendationHistory(10000, 0);
      const strategyTypes = [...new Set(recommendations.map(r => r.strategy_type))];
      
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
  
  /**
   * 按策略分组推荐
   */
  private groupByStrategy(recommendations: RecommendationRecord[]): Map<string, RecommendationRecord[]> {
    const groups = new Map<string, RecommendationRecord[]>();
    
    for (const rec of recommendations) {
      if (!groups.has(rec.strategy_type)) {
        groups.set(rec.strategy_type, []);
      }
      groups.get(rec.strategy_type)!.push(rec);
    }
    
    return groups;
  }
  
  /**
   * 获取日期过滤器
   */
  private getDateFilter(period: string): { start_date?: Date; end_date?: Date } {
    const now = new Date();
    
    switch (period) {
      case 'daily':
        return {
          start_date: new Date(now.getFullYear(), now.getMonth(), now.getDate())
        };
      case 'weekly':
        return {
          start_date: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        };
      case 'monthly':
        return {
          start_date: new Date(now.getFullYear(), now.getMonth(), 1)
        };
      default:
        return {};
    }
  }
  
  /**
   * 清除指定策略的缓存
   */
  private clearCacheForStrategy(strategyType: string): void {
    const keysToDelete = Array.from(this.statisticsCache.keys())
      .filter(key => key.startsWith(strategyType));
    
    keysToDelete.forEach(key => this.statisticsCache.delete(key));
  }
  
  /**
   * 获取默认策略统计
   */
  private getDefaultStrategyStatistics(strategyType: string, period: string): StrategyStatistics {
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
      avg_holding_duration: 0,
      min_holding_duration: 0,
      max_holding_duration: 0,
      last_updated: new Date(),
      calculation_period: period
    };
  }
  
  /**
   * 获取默认综合统计
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
   * 清除所有缓存
   */
  clearAllCache(): void {
    this.statisticsCache.clear();
    this.overallStatsCache = null;
    this.lastCacheUpdate = 0;
  }
  
  /**
   * 获取缓存状态
   */
  getCacheStatus(): {
    cached_strategies: number;
    cache_age_minutes: number;
    has_overall_cache: boolean;
  } {
    const cacheAgeMinutes = (Date.now() - this.lastCacheUpdate) / (1000 * 60);
    
    return {
      cached_strategies: this.statisticsCache.size,
      cache_age_minutes: Math.round(cacheAgeMinutes),
      has_overall_cache: this.overallStatsCache !== null
    };
  }
}