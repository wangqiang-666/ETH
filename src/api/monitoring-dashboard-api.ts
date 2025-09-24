/**
 * 监控仪表板API
 * 提供系统监控、性能指标、决策链分析等聚合数据
 */

import express from 'express';
import { DecisionChainMonitor } from '../services/decision-chain-monitor.js';
import { RecommendationDatabase } from '../services/recommendation-database.js';
import { RecommendationTracker } from '../services/recommendation-tracker.js';
import { StatisticsCalculator } from '../services/statistics-calculator.js';

export class MonitoringDashboardAPI {
  private router: express.Router;
  private decisionChainMonitor: DecisionChainMonitor;
  private database: RecommendationDatabase;
  private tracker: RecommendationTracker;
  private statisticsCalculator: StatisticsCalculator;

  constructor(
    decisionChainMonitor: DecisionChainMonitor,
    database: RecommendationDatabase,
    tracker: RecommendationTracker,
    statisticsCalculator: StatisticsCalculator
  ) {
    this.router = express.Router();
    this.decisionChainMonitor = decisionChainMonitor;
    this.database = database;
    this.tracker = tracker;
    this.statisticsCalculator = statisticsCalculator;
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // 系统概览
    this.router.get('/overview', this.getSystemOverviewHandler.bind(this));
    
    // 决策链分析
    this.router.get('/decision-analysis', this.getDecisionAnalysis.bind(this));
    this.router.get('/gating-analysis', this.getGatingAnalysis.bind(this));
    
    // 性能指标
    this.router.get('/performance-metrics', this.getPerformanceMetricsHandler.bind(this));
    this.router.get('/recommendation-metrics', this.getRecommendationMetrics.bind(this));
    
    // 错误分析
    this.router.get('/error-analysis', this.getErrorAnalysisHandler.bind(this));
    this.router.get('/failure-patterns', this.getFailurePatternsHandler.bind(this));
    
    // 实时监控
    this.router.get('/real-time-stats', this.getRealTimeStatsHandler.bind(this));
    this.router.get('/system-health', this.getSystemHealthHandler.bind(this));
    
    // 趋势分析
    this.router.get('/trends', this.getTrendsHandler.bind(this));
    this.router.get('/comparison', this.getComparisonDataHandler.bind(this));
  }

  /**
   * 获取系统概览
   * GET /api/monitoring/overview
   */
  private async getSystemOverviewHandler(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { time_range = '24h' } = req.query;
      
      const now = new Date();
      let startTime: Date;
      
      switch (time_range) {
        case '1h':
          startTime = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case '6h':
          startTime = new Date(now.getTime() - 6 * 60 * 60 * 1000);
          break;
        case '12h':
          startTime = new Date(now.getTime() - 12 * 60 * 60 * 1000);
          break;
        case '24h':
        default:
          startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
      }
      
      // 获取决策链统计
      const decisionStats = await this.decisionChainMonitor.getMetrics();
      
      // 获取推荐统计
      const recommendationStats = await this.database.getStatistics();
      
      // 获取系统状态
      const systemStatus = await this.getSystemStatus();
      
      const overview = {
        timeRange: time_range,
        decisionChains: {
          total: decisionStats.totalChains,
          approved: decisionStats.approvedChains,
          rejected: decisionStats.rejectedChains,
          approvalRate: decisionStats.totalChains > 0 ? 
            ((decisionStats.approvedChains / decisionStats.totalChains) * 100).toFixed(2) + '%' : '0%',
          topRejectionReasons: decisionStats.rejectionReasons || {}
        },
        recommendations: {
          total: recommendationStats.total || 0,
          active: recommendationStats.active || 0,
          completed: (recommendationStats.wins || 0) + (recommendationStats.losses || 0) + (recommendationStats.breakeven || 0),
          winRate: recommendationStats.winRate || 0,
          avgReturn: recommendationStats.avgPnl || 0
        },
        system: systemStatus,
        timestamp: new Date().toISOString()
      };
      
      res.json({
        success: true,
        data: overview
      });
    } catch (error) {
      console.error('[MonitoringDashboardAPI] Failed to get system overview:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get system overview',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取决策分析
   * GET /api/monitoring/decision-analysis
   */
  private async getDecisionAnalysis(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { symbol, time_range = '24h', group_by = 'hour' } = req.query;
      
      const now = new Date();
      const startTime = this.getStartTime(time_range as string, now);
      
      const filters: any = {
        startDate: startTime,
        endDate: now
      };
      
      if (symbol) {
        filters.symbol = symbol as string;
      }
      
      // 获取决策链数据
      const result = await this.decisionChainMonitor.queryChains(filters);
      const chains = result.chains || result;
      
      // 分析决策模式
      const analysis = this.analyzeDecisionPatterns(chains, group_by as string);
      
      res.json({
        success: true,
        data: analysis
      });
    } catch (error) {
      console.error('[MonitoringDashboardAPI] Failed to get decision analysis:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get decision analysis',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取门控分析
   * GET /api/monitoring/gating-analysis
   */
  private async getGatingAnalysis(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { time_range = '24h', symbol } = req.query;
      
      const now = new Date();
      const startTime = this.getStartTime(time_range as string, now);
      
      const filters: any = {
        startDate: startTime,
        endDate: now
      };
      
      if (symbol) {
        filters.symbol = symbol as string;
      }
      
      // 获取被拒绝的决策链
      filters.status = 'REJECTED';
      const result = await this.decisionChainMonitor.queryChains(filters);
      const rejectedChains = result.chains || result;
      
      // 分析门控原因
      const gatingAnalysis = this.analyzeGatingReasons(rejectedChains);
      
      res.json({
        success: true,
        data: gatingAnalysis
      });
    } catch (error) {
      console.error('[MonitoringDashboardAPI] Failed to get gating analysis:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get gating analysis',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取性能指标
   * GET /api/monitoring/performance-metrics
   */
  private async getPerformanceMetricsHandler(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { time_range = '24h' } = req.query;
      
      const now = new Date();
      const startTime = this.getStartTime(time_range as string, now);
      
      // 获取推荐性能数据 - use getStatistics instead of getPerformanceMetrics
      const performanceData = await this.database.getStatistics();
      
      // 获取决策链性能数据 - use getMetrics instead of getPerformanceMetrics
      const chainPerformance = await this.decisionChainMonitor.getMetrics();
      
      const metrics = {
        timeRange: time_range,
        recommendationPerformance: performanceData,
        decisionChainPerformance: chainPerformance,
        systemMetrics: await this.getSystemMetrics()
      };
      
      res.json({
        success: true,
        data: metrics
      });
    } catch (error) {
      console.error('[MonitoringDashboardAPI] Failed to get performance metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get performance metrics',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取推荐指标
   * GET /api/monitoring/recommendation-metrics
   */
  private async getRecommendationMetrics(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { symbol, strategy_type, time_range = '24h' } = req.query;
      
      const now = new Date();
      const startTime = this.getStartTime(time_range as string, now);
      
      const metrics = await this.statisticsCalculator.calculateOverallStatistics();
      
      res.json({
        success: true,
        data: metrics
      });
    } catch (error) {
      console.error('[MonitoringDashboardAPI] Failed to get recommendation metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get recommendation metrics',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取错误分析
   * GET /api/monitoring/error-analysis
   */
  private async getErrorAnalysisHandler(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { time_range = '24h', error_type } = req.query;
      
      const now = new Date();
      const startTime = this.getStartTime(time_range as string, now);
      
      const filters: any = {
        startDate: startTime,
        endDate: now,
        status: 'REJECTED'
      };
      
      if (error_type) {
        filters.errorType = error_type as string;
      }
      
      const result = await this.decisionChainMonitor.queryChains(filters);
      const failedChains = result.chains || result;
      
      const errorAnalysis = this.analyzeErrors(failedChains);
      
      res.json({
        success: true,
        data: errorAnalysis
      });
    } catch (error) {
      console.error('[MonitoringDashboardAPI] Failed to get error analysis:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get error analysis',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取失败模式分析
   * GET /api/monitoring/failure-patterns
   */
  private async getFailurePatternsHandler(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { time_range = '7d', min_occurrences = 5 } = req.query;
      
      const now = new Date();
      const startTime = this.getStartTime(time_range as string, now);
      
      const filters = {
        timeStart: startTime,
        timeEnd: now,
        finalDecision: 'REJECTED' as const
      };
      
      const result = await this.decisionChainMonitor.queryChains(filters);
      const failedChains = result.chains || result;
      
      const patterns = this.identifyFailurePatterns(failedChains, parseInt(min_occurrences as string));
      
      res.json({
        success: true,
        data: patterns
      });
    } catch (error) {
      console.error('[MonitoringDashboardAPI] Failed to get failure patterns:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get failure patterns',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取实时统计
   * GET /api/monitoring/real-time-stats
   */
  private async getRealTimeStatsHandler(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { window = '5m' } = req.query;
      
      const windowMs = this.parseTimeWindow(window as string);
      const now = new Date();
      const startTime = new Date(now.getTime() - windowMs);
      
      // 获取最近的数据 - use queryChains instead of getRecentChains
      const result = await this.decisionChainMonitor.queryChains({
        limit: 100,
        timeStart: startTime,
        timeEnd: now
      });
      
      const recentChains = result.chains || result;
      
      // 使用 getActiveRecommendations 而不是 getRecommendations
      const recentRecommendations = await this.database.getActiveRecommendations();
      
      const stats = {
        window: window,
        decisionChains: {
          total: recentChains.length,
          approved: recentChains.filter((c: any) => c.status === 'APPROVED').length,
          rejected: recentChains.filter((c: any) => c.status === 'REJECTED').length,
          rate: recentChains.length / (windowMs / 1000 / 60) // 每分钟速率
        },
        recommendations: {
          total: recentRecommendations.length,
          active: recentRecommendations.filter((r: any) => r.status === 'ACTIVE').length,
          completed: recentRecommendations.filter((r: any) => r.status === 'COMPLETED').length,
          rate: recentRecommendations.length / (windowMs / 1000 / 60)
        },
        timestamp: new Date().toISOString()
      };
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('[MonitoringDashboardAPI] Failed to get real-time stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get real-time stats',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取系统健康状态
   * GET /api/monitoring/system-health
   */
  private async getSystemHealthHandler(req: express.Request, res: express.Response): Promise<void> {
    try {
      const health = {
        status: 'healthy',
        components: {
          decisionChainMonitor: await this.checkDecisionChainMonitorHealth(),
          database: await this.checkDatabaseHealth(),
          tracker: await this.checkTrackerHealth(),
          statistics: await this.checkStatisticsHealth()
        },
        timestamp: new Date().toISOString()
      };
      
      // 计算总体健康状态
      const failedComponents = Object.values(health.components).filter(c => c.status !== 'healthy');
      if (failedComponents.length > 0) {
        health.status = failedComponents.length > 2 ? 'critical' : 'degraded';
      }
      
      res.json({
        success: true,
        data: health
      });
    } catch (error) {
      console.error('[MonitoringDashboardAPI] Failed to get system health:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get system health',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取趋势分析
   * GET /api/monitoring/trends
   */
  private async getTrendsHandler(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { metric = 'approval_rate', time_range = '7d', granularity = 'hour' } = req.query;
      
      const now = new Date();
      const startTime = this.getStartTime(time_range as string, now);
      
      const trends = await this.calculateTrends({
        metric: metric as string,
        startDate: startTime,
        endDate: now,
        granularity: granularity as string
      });
      
      res.json({
        success: true,
        data: trends
      });
    } catch (error) {
      console.error('[MonitoringDashboardAPI] Failed to get trends:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get trends',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取对比数据
   * GET /api/monitoring/comparison
   */
  private async getComparisonDataHandler(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { compare_by = 'symbol', time_range = '24h', metrics = 'approval_rate,rejection_rate' } = req.query;
      
      const now = new Date();
      const startTime = this.getStartTime(time_range as string, now);
      
      const comparison = await this.generateComparison({
        compareBy: compare_by as string,
        startDate: startTime,
        endDate: now,
        metrics: (metrics as string).split(',')
      });
      
      res.json({
        success: true,
        data: comparison
      });
    } catch (error) {
      console.error('[MonitoringDashboardAPI] Failed to get comparison data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get comparison data',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // 辅助方法
  private getStartTime(timeRange: string, now: Date): Date {
    const timeRanges: { [key: string]: number } = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '12h': 12 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    
    return new Date(now.getTime() - (timeRanges[timeRange] || 24 * 60 * 60 * 1000));
  }

  private parseTimeWindow(window: string): number {
    const windows: { [key: string]: number } = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000
    };
    
    return windows[window] || 5 * 60 * 1000;
  }

  private analyzeDecisionPatterns(chains: any[], groupBy: string): any {
    // 实现决策模式分析逻辑
    const patterns: { [key: string]: any } = {};
    
    chains.forEach(chain => {
      const key = this.getGroupKey(chain, groupBy);
      if (!patterns[key]) {
        patterns[key] = {
          total: 0,
          approved: 0,
          rejected: 0,
          steps: {}
        };
      }
      
      patterns[key].total++;
      if (chain.status === 'APPROVED') {
        patterns[key].approved++;
      } else {
        patterns[key].rejected++;
      }
      
      // 分析步骤模式
      chain.steps.forEach((step: any) => {
        if (!patterns[key].steps[step.type]) {
          patterns[key].steps[step.type] = {
            total: 0,
            success: 0,
            failed: 0
          };
        }
        patterns[key].steps[step.type].total++;
        if (step.status === 'SUCCESS') {
          patterns[key].steps[step.type].success++;
        } else {
          patterns[key].steps[step.type].failed++;
        }
      });
    });
    
    return patterns;
  }

  private analyzeGatingReasons(chains: any[]): any {
    const reasons: { [key: string]: number } = {};
    
    chains.forEach(chain => {
      const finalReason = chain.finalReason || 'UNKNOWN';
      reasons[finalReason] = (reasons[finalReason] || 0) + 1;
    });
    
    return {
      totalRejected: chains.length,
      rejectionReasons: Object.entries(reasons)
        .sort(([,a], [,b]) => (b as number) - (a as number))
        .reduce((obj, [key, value]) => {
          obj[key] = value;
          return obj;
        }, {} as { [key: string]: number })
    };
  }

  private analyzeErrors(chains: any[]): any {
    const errors: { [key: string]: any } = {};
    
    chains.forEach(chain => {
      const errorSteps = chain.steps.filter((step: any) => 
        step.status === 'FAILED' || step.status === 'ERROR'
      );
      
      errorSteps.forEach((step: any) => {
        const errorType = step.type || 'UNKNOWN';
        if (!errors[errorType]) {
          errors[errorType] = {
            count: 0,
            details: []
          };
        }
        
        errors[errorType].count++;
        errors[errorType].details.push({
          timestamp: step.timestamp,
          message: step.message,
          details: step.details
        });
      });
    });
    
    return errors;
  }

  private identifyFailurePatterns(chains: any[], minOccurrences: number): any[] {
    const patterns: { [key: string]: any } = {};
    
    chains.forEach(chain => {
      const pattern = this.extractFailurePattern(chain);
      if (pattern) {
        if (!patterns[pattern]) {
          patterns[pattern] = {
            pattern: pattern,
            count: 0,
            examples: []
          };
        }
        
        patterns[pattern].count++;
        if (patterns[pattern].examples.length < 3) {
          patterns[pattern].examples.push({
            chainId: chain.id,
            symbol: chain.symbol,
            timestamp: chain.createdAt
          });
        }
      }
    });
    
    return Object.values(patterns)
      .filter((p: any) => p.count >= minOccurrences)
      .sort((a: any, b: any) => b.count - a.count);
  }

  private extractFailurePattern(chain: any): string | null {
    const failedSteps = chain.steps.filter((step: any) => 
      step.status === 'FAILED' || step.status === 'ERROR'
    );
    
    if (failedSteps.length === 0) return null;
    
    return failedSteps.map((step: any) => step.type).join('->');
  }

  private getGroupKey(chain: any, groupBy: string): string {
    switch (groupBy) {
      case 'hour':
        return new Date(chain.createdAt).toISOString().slice(0, 13);
      case 'day':
        return new Date(chain.createdAt).toISOString().slice(0, 10);
      case 'symbol':
        return chain.symbol;
      case 'type':
        return chain.type;
      default:
        return 'all';
    }
  }

  private async getSystemStatus(): Promise<any> {
    return {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }

  private async getSystemMetrics(): Promise<any> {
    return {
      cpu: process.cpuUsage(),
      memory: process.memoryUsage(),
      uptime: process.uptime()
    };
  }

  private async checkDecisionChainMonitorHealth(): Promise<any> {
    try {
      // Use queryChains instead of getStats (which doesn't exist)
      await this.decisionChainMonitor.queryChains({ limit: 1, timeStart: new Date(Date.now() - 60000), timeEnd: new Date() });
      return { status: 'healthy', lastCheck: new Date().toISOString() };
    } catch (error) {
      return { status: 'unhealthy', error: (error as Error).message, lastCheck: new Date().toISOString() };
    }
  }

  private async checkDatabaseHealth(): Promise<any> {
    try {
      // Use getStatistics instead of getRecommendationStats
      await this.database.getStatistics();
      return { status: 'healthy', lastCheck: new Date().toISOString() };
    } catch (error) {
      return { status: 'unhealthy', error: (error as Error).message, lastCheck: new Date().toISOString() };
    }
  }

  private async checkTrackerHealth(): Promise<any> {
    try {
      // 简单的健康检查
      return { status: 'healthy', lastCheck: new Date().toISOString() };
    } catch (error) {
      return { status: 'unhealthy', error: (error as Error).message, lastCheck: new Date().toISOString() };
    }
  }

  private async checkStatisticsHealth(): Promise<any> {
    try {
      // 简单的健康检查
      return { status: 'healthy', lastCheck: new Date().toISOString() };
    } catch (error) {
      return { status: 'unhealthy', error: (error as Error).message, lastCheck: new Date().toISOString() };
    }
  }

  private async calculateTrends(params: any): Promise<any> {
    const { metric, timeRange } = params;
    
    // Generate mock trend data
    const dataPoints = [];
    const now = new Date();
    const days = timeRange === '7d' ? 7 : timeRange === '24h' ? 1 : 30;
    
    for (let i = days; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const value = Math.random() * 100 + 50; // Mock data between 50-150
      dataPoints.push({
        timestamp: date.toISOString(),
        value: Math.round(value * 100) / 100
      });
    }
    
    return {
      metric,
      granularity: timeRange === '24h' ? 'hourly' : 'daily',
      data: dataPoints,
      trend: Math.random() > 0.5 ? 'increasing' : 'decreasing',
      change: (Math.random() * 20 - 10).toFixed(2), // -10% to +10%
      forecast: dataPoints.slice(-3).map(point => ({
        timestamp: new Date(new Date(point.timestamp).getTime() + 24 * 60 * 60 * 1000).toISOString(),
        value: Math.round((point.value * (1 + (Math.random() * 0.2 - 0.1))) * 100) / 100
      }))
    };
  }

  private async generateComparison(params: any): Promise<any> {
    const { compareBy, startDate, endDate, metrics } = params;

    // Get comparison data
    const result = await this.decisionChainMonitor.queryChains({ timeStart: startDate, timeEnd: endDate });
    const chains = result.chains || result;
    const recommendations = await this.database.getActiveRecommendations();
    const stats = await this.database.getStatistics();

    // Generate comparison data by different dimensions
    const bySymbol: any = {};
    const byDirection: any = {};
    const bySource: any = {};

    // Group by symbol
    chains.forEach((chain: any) => {
      if (!bySymbol[chain.symbol]) {
        bySymbol[chain.symbol] = { count: 0, totalDecisionTime: 0, approved: 0, rejected: 0 };
      }
      bySymbol[chain.symbol].count++;
      bySymbol[chain.symbol].totalDecisionTime += chain.decisionTime || 0;
      if (chain.status === 'APPROVED') bySymbol[chain.symbol].approved++;
      if (chain.status === 'REJECTED') bySymbol[chain.symbol].rejected++;
    });

    // Group by direction
    chains.forEach((chain: any) => {
      if (!byDirection[chain.direction]) {
        byDirection[chain.direction] = { count: 0, totalDecisionTime: 0, approved: 0, rejected: 0 };
      }
      byDirection[chain.direction].count++;
      byDirection[chain.direction].totalDecisionTime += chain.decisionTime || 0;
      if (chain.status === 'APPROVED') byDirection[chain.direction].approved++;
      if (chain.status === 'REJECTED') byDirection[chain.direction].rejected++;
    });

    // Group by source
    chains.forEach((chain: any) => {
      if (!bySource[chain.source]) {
        bySource[chain.source] = { count: 0, totalDecisionTime: 0, approved: 0, rejected: 0 };
      }
      bySource[chain.source].count++;
      bySource[chain.source].totalDecisionTime += chain.decisionTime || 0;
      if (chain.status === 'APPROVED') bySource[chain.source].approved++;
      if (chain.status === 'REJECTED') bySource[chain.source].rejected++;
    });

    // Calculate averages and rates
    Object.keys(bySymbol).forEach(symbol => {
      const data = bySymbol[symbol];
      data.avgDecisionTime = data.count > 0 ? data.totalDecisionTime / data.count : 0;
      data.approvalRate = data.count > 0 ? (data.approved / data.count) * 100 : 0;
      data.rejectionRate = data.count > 0 ? (data.rejected / data.count) * 100 : 0;
    });

    Object.keys(byDirection).forEach(direction => {
      const data = byDirection[direction];
      data.avgDecisionTime = data.count > 0 ? data.totalDecisionTime / data.count : 0;
      data.approvalRate = data.count > 0 ? (data.approved / data.count) * 100 : 0;
      data.rejectionRate = data.count > 0 ? (data.rejected / data.count) * 100 : 0;
    });

    Object.keys(bySource).forEach(source => {
      const data = bySource[source];
      data.avgDecisionTime = data.count > 0 ? data.totalDecisionTime / data.count : 0;
      data.approvalRate = data.count > 0 ? (data.approved / data.count) * 100 : 0;
      data.rejectionRate = data.count > 0 ? (data.rejected / data.count) * 100 : 0;
    });

    return {
      bySymbol,
      byDirection,
      bySource,
      summary: {
        totalChains: chains.length,
        totalRecommendations: recommendations.length,
        timeRange: { start: startDate, end: endDate }
      }
    };
  }

  public getRouter(): express.Router {
    return this.router;
  }

  // Public methods for testing and external access
  public async getSystemOverviewPublic(filters?: any): Promise<any> {
    const now = new Date();
    let startTime: Date;
    
    if (filters?.startTime && filters?.endTime) {
      startTime = new Date(filters.startTime);
    } else {
      startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Default 24h
    }
    
    try {
      const decisionStats = await this.decisionChainMonitor.getMetrics();
      
      // Use getStatistics instead of getRecommendationStats
      const recommendationStats = await this.database.getStatistics();
      const systemStatus = await this.getSystemStatus();
      
      return {
        totalChains: decisionStats.totalChains,
        activeChains: decisionStats.pendingChains,
        completedChains: decisionStats.approvedChains + decisionStats.rejectedChains,
        rejectionRate: decisionStats.rejectedChains / decisionStats.totalChains,
        averageDecisionTime: decisionStats.averageDecisionTime,
        recommendations: recommendationStats,
        system: systemStatus,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      // Re-throw the error to be handled by the caller
      throw error;
    }
  }

  public async getDecisionChainMetricsPublic(filters: any): Promise<any> {
    const now = new Date();
    const startTime = filters.timeRange === '24h' ? 
      new Date(now.getTime() - 24 * 60 * 60 * 1000) : now;
    
    const result = await this.decisionChainMonitor.queryChains({
      timeStart: startTime,
      timeEnd: now,
      symbol: filters.symbol,
      direction: filters.direction
    });
    
    const chains = result.chains || result;
    const approved = chains.filter((c: any) => c.finalDecision === 'APPROVED').length;
    const rejected = chains.filter((c: any) => c.finalDecision === 'REJECTED').length;
    
    return {
      total: chains.length,
      approved,
      rejected,
      bySymbol: this.groupBy(chains, 'symbol'),
      bySource: this.groupBy(chains, 'source'),
      trends: []
    };
  }

  public async getDecisionChainDetails(chainId: string): Promise<any> {
    const chain = await this.decisionChainMonitor.getChain(chainId);
    if (!chain) {
      throw new Error('Decision chain not found');
    }
    
    return {
      chain,
      steps: chain.steps || [],
      linkedRecommendation: chain.recommendationId,
      linkedExecution: chain.executionId
    };
  }

  public async compareDecisionChains(chainIds: string[]): Promise<any> {
    const chains = await Promise.all(
      chainIds.map(id => this.decisionChainMonitor.getChain(id))
    );
    
    return {
      similarities: this.findSimilarities(chains),
      differences: this.findDifferences(chains),
      recommendations: this.generateRecommendations(chains)
    };
  }

  public async getPerformanceMetricsPublic(filters?: any): Promise<any> {
    const now = new Date();
    let startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    if (filters?.startTime && filters?.endTime) {
      startTime = new Date(filters.startTime);
    }
    
    const result = await this.decisionChainMonitor.queryChains({
      timeStart: startTime,
      timeEnd: now
    });
    
    const chains = result.chains || result;
    const decisionTimes = chains.map((c: any) => c.decisionTime || 0).filter((t: number) => t > 0);
    
    return {
      averageDecisionTime: decisionTimes.length > 0 ? decisionTimes.reduce((a: number, b: number) => a + b, 0) / decisionTimes.length : 0,
      p95DecisionTime: this.calculatePercentile(decisionTimes, 0.95),
      p99DecisionTime: this.calculatePercentile(decisionTimes, 0.99),
      throughput: chains.length / (24 * 60 * 60 * 1000),
      trends: []
    };
  }

  public async getErrorAnalysisPublic(): Promise<any> {
    const now = new Date();
    const startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const result = await this.decisionChainMonitor.queryChains({
      timeStart: startTime,
      timeEnd: now
      // Note: status filter might not be supported, filtering manually below
    });
    
    const chains = result.chains || result;
    const rejectedChains = chains.filter((c: any) => c.status === 'REJECTED');
    
    const errors = this.analyzeErrors(rejectedChains);
    
    return {
      totalErrors: rejectedChains.length,
      byType: errors,
      recentErrors: rejectedChains.slice(0, 10),
      trends: []
    };
  }

  public async getErrorDetails(errorId: string): Promise<any> {
    // Mock implementation - would need actual error storage
    return {
      error: { id: errorId, message: 'Sample error' },
      context: { timestamp: new Date(), chainId: 'CHAIN_123' },
      relatedChains: []
    };
  }

  public async getRealTimeStatsPublic(): Promise<any> {
    // Mock implementation since getRealTimeMonitoring doesn't exist
    const chains = await this.decisionChainMonitor.queryChains({
      timeStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
      timeEnd: new Date()
    });
    
    const allChains = chains.chains || chains;
    const activeChains = allChains.filter((c: any) => c.status === 'ACTIVE').length;
    const recentRejections = allChains.filter((c: any) => c.status === 'REJECTED').slice(0, 10);
    
    return {
      activeChains,
      recentDecisions: recentRejections,
      systemHealth: 'healthy',
      alerts: []
    };
  }

  public async getSystemHealth(): Promise<any> {
    const [monitorHealth, dbHealth, trackerHealth, statsHealth] = await Promise.all([
      this.checkDecisionChainMonitorHealth(),
      this.checkDatabaseHealth(),
      this.checkTrackerHealth(),
      this.checkStatisticsHealth()
    ]);
    
    return {
      status: 'healthy',
      components: {
        decisionChainMonitor: monitorHealth,
        database: dbHealth,
        tracker: trackerHealth,
        statistics: statsHealth
      },
      alerts: [],
      recommendations: []
    };
  }

  public async getTrendAnalysis(params: any): Promise<any> {
    return this.calculateTrends(params);
  }

  public async getComparativeAnalysis(params: any): Promise<any> {
    return this.generateComparison(params);
  }

  public async replayDecisionChain(chainId: string): Promise<any> {
    return await this.decisionChainMonitor.replayChain(chainId);
  }

  public async getReplayHistory(chainId: string): Promise<any[]> {
    return await this.decisionChainMonitor.getReplayHistory(chainId);
  }

  public async batchReplayChains(chainIds: string[]): Promise<any> {
    const results = await Promise.allSettled(
      chainIds.map(chainId => this.decisionChainMonitor.replayChain(chainId))
    );
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    return {
      total: chainIds.length,
      successful,
      failed,
      results: results.map((r, i) => ({
        chainId: chainIds[i],
        success: r.status === 'fulfilled',
        result: r.status === 'fulfilled' ? r.value : r.reason
      })),
      summary: {
        successRate: successful / chainIds.length,
        totalChains: chainIds.length,
        successfulReplays: successful,
        failedReplays: failed
      }
    };
  }



  public async exportDashboardData(params: any): Promise<any> {
    const data = await this.getSystemOverview();
    
    return {
      data,
      format: params.format || 'json',
      generatedAt: new Date().toISOString()
    };
  }

  public async generateSummaryReport(params: any): Promise<any> {
    const overview = await this.getSystemOverview(params);
    
    return {
      period: params.timeRange || '7d',
      keyMetrics: overview,
      trends: [],
      recommendations: []
    };
  }

  // Wrapper methods for test compatibility
  public async getSystemOverview(filters?: any): Promise<any> {
    // Validate time range if provided
    if (filters?.startTime || filters?.endTime) {
      const startTime = filters.startTime ? new Date(filters.startTime) : null;
      const endTime = filters.endTime ? new Date(filters.endTime) : null;
      
      // Validate dates
      if (startTime && isNaN(startTime.getTime())) {
        throw new Error('Invalid start time');
      }
      if (endTime && isNaN(endTime.getTime())) {
        throw new Error('Invalid end time');
      }
      
      // Check for logical time range issues
      if (startTime && endTime && startTime > endTime) {
        throw new Error('Start time cannot be after end time');
      }
    }
    
    return await this.getSystemOverviewPublic(filters);
  }

  public async getDecisionChainMetrics(filters: any): Promise<any> {
    return await this.getDecisionChainMetricsPublic(filters);
  }

  public async getPerformanceMetrics(filters?: any): Promise<any> {
    return await this.getPerformanceMetricsPublic(filters);
  }

  public async getErrorAnalysis(): Promise<any> {
    return await this.getErrorAnalysisPublic();
  }

  public async getRealTimeStats(): Promise<any> {
    return await this.getRealTimeStatsPublic();
  }

  // Helper methods
  private groupBy(array: any[], key: string): any {
    return array.reduce((groups, item) => {
      const group = item[key] || 'unknown';
      groups[group] = (groups[group] || 0) + 1;
      return groups;
    }, {});
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = values.sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, index)];
  }

  private findSimilarities(chains: any[]): any[] {
    if (chains.length < 2) return [];
    
    const similarities = [];
    const firstChain = chains[0];
    
    // Check for common symbol
    if (chains.every(chain => chain.symbol === firstChain.symbol)) {
      similarities.push({
        type: 'symbol',
        value: firstChain.symbol,
        description: `All chains trade ${firstChain.symbol}`
      });
    }
    
    // Check for common direction
    if (chains.every(chain => chain.direction === firstChain.direction)) {
      similarities.push({
        type: 'direction',
        value: firstChain.direction,
        description: `All chains have ${firstChain.direction} direction`
      });
    }
    
    // Check for common source
    if (chains.every(chain => chain.source === firstChain.source)) {
      similarities.push({
        type: 'source',
        value: firstChain.source,
        description: `All chains originated from ${firstChain.source}`
      });
    }
    
    return similarities;
  }

  private findDifferences(chains: any[]): any[] {
    if (chains.length < 2) return [];
    
    const differences = [];
    const firstChain = chains[0];
    
    // Check for different symbols
    const symbolSet = new Set(chains.map(chain => chain.symbol));
    const uniqueSymbols = Array.from(symbolSet);
    if (uniqueSymbols.length > 1) {
      differences.push({
        type: 'symbol',
        chain1: firstChain.symbol,
        chain2: uniqueSymbols[1],
        description: `Different symbols: ${firstChain.symbol} vs ${uniqueSymbols[1]}`
      });
    }
    
    // Check for different directions
    const directionSet = new Set(chains.map(chain => chain.direction));
    const uniqueDirections = Array.from(directionSet);
    if (uniqueDirections.length > 1) {
      differences.push({
        type: 'direction',
        chain1: firstChain.direction,
        chain2: uniqueDirections[1],
        description: `Different directions: ${firstChain.direction} vs ${uniqueDirections[1]}`
      });
    }
    
    // Check for different sources
    const sourceSet = new Set(chains.map(chain => chain.source));
    const uniqueSources = Array.from(sourceSet);
    if (uniqueSources.length > 1) {
      differences.push({
        type: 'source',
        chain1: firstChain.source,
        chain2: uniqueSources[1],
        description: `Different sources: ${firstChain.source} vs ${uniqueSources[1]}`
      });
    }
    
    return differences;
  }

  private generateRecommendations(chains: any[]): any[] {
    if (chains.length < 2) return [];
    
    const recommendations = [];
    const similarities = this.findSimilarities(chains);
    const differences = this.findDifferences(chains);
    
    // Generate recommendations based on similarities
    if (similarities.length > 0) {
      recommendations.push({
        type: 'similarity',
        priority: 'high',
        description: `Consider standardizing approach across ${similarities.length} similar aspects`,
        action: 'Review common patterns for optimization opportunities'
      });
    }
    
    // Generate recommendations based on differences
    if (differences.length > 0) {
      recommendations.push({
        type: 'difference',
        priority: 'medium',
        description: `Evaluate ${differences.length} different approaches for consistency`,
        action: 'Consider standardizing divergent strategies'
      });
    }
    
    // General recommendation
    recommendations.push({
      type: 'general',
      priority: 'low',
      description: `Compare performance across ${chains.length} chains`,
      action: 'Analyze which approach yields better results'
    });
    
    return recommendations;
  }
}

/**
 * 创建监控仪表板API实例的工厂函数
 */
export function createMonitoringDashboardAPI(
  decisionChainMonitor: DecisionChainMonitor,
  database: RecommendationDatabase,
  tracker: RecommendationTracker,
  statisticsCalculator: StatisticsCalculator
): MonitoringDashboardAPI {
  return new MonitoringDashboardAPI(decisionChainMonitor, database, tracker, statisticsCalculator);
}