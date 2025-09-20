import express from 'express';
import { RecommendationTracker, RecommendationRecord, CooldownError, DuplicateError, OppositeConstraintError, ExposureLimitError, MTFConsistencyError } from '../services/recommendation-tracker';
import { RecommendationDatabase, ExecutionRecord } from '../services/recommendation-database';
import { StatisticsCalculator, StrategyStatistics, OverallStatistics } from '../services/statistics-calculator';
import { EnhancedOKXDataService } from '../services/enhanced-okx-data-service';

/**
 * 推荐API路由器
 * 提供推荐记录的CRUD操作和统计查询接口
 */
export class RecommendationAPI {
  private router: express.Router;
  private tracker: RecommendationTracker;
  private database: RecommendationDatabase;
  private statisticsCalculator: StatisticsCalculator;
  // 新增：在创建成功后触发的钩子（由集成服务注入）
  private onCreateHook?: (id: string, data: any) => void | Promise<void>;

  // 新增：门控拒绝统计（内存级）
  private gatingStats = {
    byReason: {} as Record<string, number>,
    byDirection: { LONG: {} as Record<string, number>, SHORT: {} as Record<string, number> },
    hourlyCap: { total: 0, perDirection: { LONG: 0, SHORT: 0 } },
    // 新增：MTF 一致性细分统计
    mtf: {
      byAgreementBucket: {} as Record<string, number>,
      byDominantDirection: { LONG: 0, SHORT: 0, NA: 0 } as Record<'LONG' | 'SHORT' | 'NA', number>
    },
    recent: [] as Array<{ ts: number; symbol: string; direction?: 'LONG' | 'SHORT'; reason: string }>
  };

  constructor(
    dataService: EnhancedOKXDataService,
    database: RecommendationDatabase,
    tracker?: RecommendationTracker
  ) {
    this.router = express.Router();
    this.database = database;
    // 使用外部注入的 tracker，否则回退到内部创建
    this.tracker = tracker ?? new RecommendationTracker();
    this.statisticsCalculator = new StatisticsCalculator(database);
    
    this.setupRoutes();
  }
  
  // 新增：允许外部（集成服务）设置创建钩子
  setOnCreateHook(hook: (id: string, data: any) => void | Promise<void>): void {
    this.onCreateHook = hook;
  }
  
  /**
   * 设置API路由
   */
  private setupRoutes(): void {
    // 推荐管理路由
    this.router.post('/recommendations', this.createRecommendation.bind(this));
    this.router.get('/recommendations', this.getRecommendations.bind(this));
    this.router.get('/recommendations/:id', this.getRecommendation.bind(this));
    this.router.put('/recommendations/:id/close', this.closeRecommendation.bind(this));
    this.router.delete('/recommendations/:id', this.deleteRecommendation.bind(this));
    // 新增：手动触发强制平仓（兼容 /expire 路由名，仅测试/维护用途）
    this.router.post('/recommendations/:id/expire', this.expireRecommendationById.bind(this));

    // 活跃推荐路由
    this.router.get('/active-recommendations', this.getActiveRecommendations.bind(this));

    // 统计信息路由
    this.router.get('/statistics/overall', this.getOverallStatistics.bind(this));
    this.router.get('/statistics/strategy/:type', this.getStrategyStatistics.bind(this));
    this.router.get('/statistics/strategies', this.getAllStrategyStatistics.bind(this));
    
    // 新增：EV 对齐统计与监控
    this.router.get('/stats', this.getEVvsPnLStats.bind(this));
    this.router.get('/monitoring/ev-metrics', this.getEVMonitoring.bind(this));

    // 维护路由：修剪历史，仅保留最近 N 条
    this.router.post('/maintenance/trim', this.trimRecommendations.bind(this));

    // 系统状态路由
    this.router.get('/status', this.getSystemStatus.bind(this));
    this.router.post('/tracker/start', this.startTracker.bind(this));
    this.router.post('/tracker/stop', this.stopTracker.bind(this));
    this.router.post('/cache/clear', this.clearCache.bind(this));

    // 新增：执行记录管理路由
    this.router.get('/executions', this.listExecutions.bind(this));
    this.router.post('/executions', this.createExecution.bind(this));

    // 新增：门控监控查询路由（仅返回类型为 GATED 的监控快照）
    this.router.get('/monitoring/gated', this.listGatedMonitoring.bind(this));
  }
  
  /**
   * 创建新推荐
   * POST /api/recommendations
   */
  private async createRecommendation(req: express.Request, res: express.Response): Promise<void> {
    try {
      const loopGuard = String(req.headers['x-loop-guard'] || '').toLowerCase() === '1';
      const recommendationData = req.body;
      
      // 验证必需字段
      if (!recommendationData || typeof recommendationData !== 'object') {
        res.status(400).json({ success: false, error: 'Invalid request body' });
        return;
      }
      
      // 验证价格和杠杆
      const priceFields = ['entry_price', 'current_price'];
      for (const field of priceFields) {
        const v = Number(recommendationData[field]);
        if (!Number.isFinite(v) || v <= 0) {
          res.status(400).json({ success: false, error: `Invalid ${field}` });
          return;
        }
      }
      const lev = Number(recommendationData.leverage);
      if (!Number.isFinite(lev) || lev <= 0) {
        res.status(400).json({ success: false, error: 'Invalid leverage' });
        return;
      }
      
      // 验证方向
      if (!['LONG', 'SHORT'].includes(recommendationData.direction)) {
        res.status(400).json({
          success: false,
          error: 'Direction must be LONG or SHORT'
        });
        return;
      }
      
      // 创建推荐
      const recommendationId = await this.tracker.addRecommendation(recommendationData, { bypassCooldown: recommendationData?.bypassCooldown === true });
      
      // 在创建成功后调用外部钩子（异步，不阻塞响应）
      if (!loopGuard && this.onCreateHook) {
        Promise.resolve(this.onCreateHook(recommendationId, recommendationData)).catch(err => {
          console.warn('onCreateHook error:', err?.message || String(err));
        });
      }
      
      // 创建后使统计缓存失效，保证前端统计实时
      try { (this.statisticsCalculator as any)?.clearAllCache?.(); } catch {}
      
      res.status(201).json({
        success: true,
        data: {
          id: recommendationId,
          message: 'Recommendation created successfully'
        }
      });
      
    } catch (error) {
      console.error('Error creating recommendation:', error);
      // 新增：对冷却期错误映射为 429，并记录统一拒绝原因快照
      if (error instanceof CooldownError) {
        try { await this.logGatingDecision('API', req.body, error); } catch {}
        res.status(429).json({
          success: false,
          error: (error as any).code,
          symbol: (error as any).symbol,
          remainingMs: (error as any).remainingMs,
          nextAvailableAt: (error as any).nextAvailableAt,
          lastRecommendationId: (error as any).lastRecommendationId,
          lastCreatedAt: (error as any).lastCreatedAt
        });
        return;
      }
      // 新增：对相似/重复推荐映射为 409（计入门控拒绝打点）
      if (error instanceof DuplicateError) {
        try { await this.logGatingDecision('API', req.body, error); } catch {}
        res.status(409).json({
          success: false,
          error: (error as any).code,
          symbol: (error as any).symbol,
          direction: (error as any).direction,
          strategy_type: (error as any).strategy_type,
          windowMinutes: (error as any).windowMinutes,
          bpsThreshold: (error as any).bpsThreshold,
          matchedIds: (error as any).matchedIds
        });
        return;
      }
      // 新增：多TF一致性失败 -> 409
      if (error instanceof MTFConsistencyError || (error as any)?.code === 'MTF_CONSISTENCY') {
        try { await this.logGatingDecision('API', req.body, error); } catch {}
        res.status(409).json({
          success: false,
          error: (error as any).code,
          symbol: (error as any).symbol,
          direction: (error as any).direction,
          requireMTFAgreement: (error as any).requireMTFAgreement,
          minMTFAgreement: (error as any).minMTFAgreement,
          agreement: (error as any).agreement,
          dominantDirection: (error as any).dominantDirection
        });
        return;
      }
      // 新增：对反向并存与净敞口限制映射为 409，并记录统一拒绝原因快照
      if (error instanceof OppositeConstraintError) {
        try { await this.logGatingDecision('API', req.body, error); } catch {}
        res.status(409).json({
          success: false,
          error: (error as any).code,
          symbol: (error as any).symbol,
          direction: (error as any).direction,
          reason: (error as any).reason,
          confidence: (error as any).confidence,
          threshold: (error as any).threshold,
          oppositeActiveCount: (error as any).oppositeActiveCount
        });
        return;
      }
      if (error instanceof ExposureLimitError) {
        try { await this.logGatingDecision('API', req.body, error); } catch {}
        res.status(409).json({
          success: false,
          error: (error as any).code,
          symbol: (error as any).symbol,
          direction: (error as any).direction,
          maxSameDirection: (error as any).maxSameDirection,
          currentCount: (error as any).currentCount,
          windowHours: (error as any).windowHours
        });
        return;
      }
      if ((error as any)?.code === 'EXPOSURE_CAP') {
        try { await this.logGatingDecision('API', req.body, error); } catch {}
        const e: any = error;
        const scope = e.scope;
        const totalCap = e.totalCap ?? (scope === 'TOTAL' ? e.cap : undefined);
        const dirCap = e.dirCap ?? (scope && scope !== 'TOTAL' ? e.cap : undefined);
        const currentTotal = e.currentTotal ?? (scope === 'TOTAL' ? e.current : undefined);
        const currentDirection = e.currentDirection ?? (scope && scope !== 'TOTAL' ? e.current : undefined);
        const adding = e.adding ?? e.candidate;
        res.status(409).json({
          success: false,
          error: e.code,
          symbol: e.symbol,
          direction: e.direction,
          totalCap,
          dirCap,
          currentTotal,
          currentDirection,
          adding
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: 'Failed to create recommendation',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 获取推荐列表
   * GET /api/recommendations?limit=100&offset=0&strategy_type=xxx&status=xxx&result=xxx&include_active=true
   */
  private async getRecommendations(req: express.Request, res: express.Response): Promise<void> {
    try {
      const {
        limit = '100',
        offset = '0',
        strategy_type,
        status,
        result,
        start_date,
        end_date,
        include_active
      } = req.query;
      
      const filters: any = {};
      if (strategy_type) filters.strategy_type = strategy_type as string;
      if (status) filters.status = status as string;
      if (result) filters.result = result as string;
      if (start_date) filters.start_date = new Date(start_date as string);
      if (end_date) filters.end_date = new Date(end_date as string);

      // 解析 include_active，默认与现有行为保持一致：不包含进行中（false）
      const includeActiveFlag: boolean = (() => {
        if (typeof include_active === 'undefined') return false;
        const v = String(include_active).toLowerCase();
        return v === '1' || v === 'true' || v === 'yes' || v === 'on';
      })();
      
      const { recommendations, total } = await this.tracker.getRecommendationHistory(
        parseInt(limit as string),
        parseInt(offset as string),
        filters,
        includeActiveFlag
      );
      
      // 更新：优先使用 DB 的 exit_label（英文枚举），否则派生（已简化为四类）
      const enriched = (recommendations || []).map((r: any) => {
        const label = r.exit_label ? r.exit_label : undefined;
        return {
          ...r,
          exit_label: label ? mapExitLabelEnumToCN(label) : deriveExitLabel(r)
        };
      });
      
      res.json({
        success: true,
        data: enriched,
        total
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get recommendations',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 获取单个推荐详情
   * GET /api/recommendations/:id
   */
  private async getRecommendation(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { id } = req.params;
      
      // 先从活跃推荐中查找
      const activeRecs = this.tracker.getActiveRecommendations();
      const activeRec = activeRecs.find(r => r.id === id);
      if (activeRec) {
        res.json({
          success: true,
          data: { ...activeRec, exit_label: activeRec.exit_label ? mapExitLabelEnumToCN(activeRec.exit_label) : deriveExitLabel(activeRec) }
        });
        return;
      }
      
      // 从数据库按ID精确查找（修复：不再仅查询最新一条后筛选）
      const recommendation = await this.database.getRecommendationById(id);
      
      if (!recommendation) {
        res.status(404).json({
          success: false,
          error: 'Recommendation not found'
        });
        return;
      }
      
      res.json({
        success: true,
        data: { ...(recommendation as any), exit_label: (recommendation as any)?.exit_label ? mapExitLabelEnumToCN((recommendation as any).exit_label) : deriveExitLabel(recommendation) }
      });
      
    } catch (error) {
      console.error('Error getting recommendation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get recommendation',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 手动关闭推荐
   * PUT /api/recommendations/:id/close
   */
  private async closeRecommendation(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      
      const success = await this.tracker.manualCloseRecommendation(id, reason);
      
      if (!success) {
        res.status(404).json({
          success: false,
          error: 'Recommendation not found or already closed'
        });
        return;
      }
      
      // 新增：关闭后使统计缓存失效，保证前端统计实时
      try { (this.statisticsCalculator as any)?.clearAllCache?.(); } catch {}
      
      res.json({
        success: true,
        data: {
          message: 'Recommendation closed successfully'
        }
      });
      
    } catch (error) {
      console.error('Error closing recommendation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to close recommendation',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  // 新增：手动触发强制平仓（超时语义，历史归档；对外仍保留 /expire 路由名以兼容）
  private async expireRecommendationById(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { id } = req.params;
      const { reason = 'TIMEOUT' } = (req.body || {}) as { reason?: string };

      if (!id) {
        res.status(400).json({ success: false, error: 'Missing recommendation id' });
        return;
      }

      const ok = await (this.tracker as any).manualExpireRecommendation?.(id, reason);
      if (!ok) {
        res.status(404).json({ success: false, error: 'Recommendation not found or not active' });
        return;
      }

      // 过期后清理统计缓存
      try { (this.statisticsCalculator as any)?.clearAllCache?.(); } catch {}

      res.json({ success: true, data: { id, message: 'Recommendation expired successfully' } });
    } catch (error) {
      console.error('Error expiring recommendation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to expire recommendation',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 删除推荐（仅用于测试，生产环境应谨慎使用）
   * DELETE /api/recommendations/:id
   */
  private async deleteRecommendation(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ success: false, error: 'Missing recommendation id' });
        return;
      }

      // 先从内存活跃列表移除（如果存在）
      if (typeof (this.tracker as any).removeFromActiveCache === 'function') {
        try { (this.tracker as any).removeFromActiveCache(id); } catch {}
      }

      // 删除数据库记录
      const deleted = await this.database.deleteRecommendation(id);
      if (!deleted) {
        res.status(404).json({ success: false, error: 'Recommendation not found' });
        return;
      }

      // 新增：删除后使统计缓存失效，保证前端统计实时
      try { (this.statisticsCalculator as any)?.clearAllCache?.(); } catch {}

      res.json({ success: true, data: { id, message: 'Recommendation deleted successfully' } });
    } catch (error) {
      console.error('Error deleting recommendation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete recommendation',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 获取活跃推荐
   * GET /api/active-recommendations
   */
  private async getActiveRecommendations(req: express.Request, res: express.Response): Promise<void> {
    try {
      let activeRecommendations = Array.from(this.tracker.getActiveRecommendations());

      // 接口层回退：若内存尚未加载或为空，则回退到数据库查询
      if (!activeRecommendations || activeRecommendations.length === 0) {
        try {
          activeRecommendations = await this.database.getActiveRecommendations();
        } catch (fallbackErr) {
          console.warn('Fallback to DB for active recommendations failed:', fallbackErr);
        }
      }

      // 填充 exit_label 为中文（若无则根据状态/原因派生）
      const recommendationsWithLabel = (activeRecommendations || []).map((rec: any) => {
        const label = rec?.exit_label ? mapExitLabelEnumToCN(rec.exit_label) : deriveExitLabel(rec);
        return { ...rec, exit_label: label };
      });

      // 新增：按照“历史列表”一致的规则去重（时间桶+标的+方向+关键价位），以确保前后端口径一致
      const deduped = dedupRecommendationsByHistoryRule(recommendationsWithLabel);

      res.json({
        success: true,
        data: {
          recommendations: deduped,
          count: deduped?.length ?? 0
        }
      });
      
    } catch (error) {
      console.error('Error getting active recommendations:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get active recommendations',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 获取综合统计信息
   * GET /api/statistics/overall
   */
  private async getOverallStatistics(req: express.Request, res: express.Response): Promise<void> {
    try {
      const statistics = await this.statisticsCalculator.calculateOverallStatistics();
      
      res.json({
        success: true,
        data: statistics
      });
      
    } catch (error) {
      console.error('Error getting overall statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get overall statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 获取指定策略统计信息
   * GET /api/statistics/strategy/:type?period=all_time
   */
  private async getStrategyStatistics(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { type } = req.params;
      const { period = 'all_time' } = req.query;
      
      if (!['daily', 'weekly', 'monthly', 'all_time'].includes(period as string)) {
        res.status(400).json({
          success: false,
          error: 'Invalid period. Must be one of: daily, weekly, monthly, all_time'
        });
        return;
      }
      
      const statistics = await this.statisticsCalculator.calculateStrategyStatistics(
        type,
        period as 'daily' | 'weekly' | 'monthly' | 'all_time'
      );
      
      res.json({
        success: true,
        data: statistics
      });
      
    } catch (error) {
      console.error('Error getting strategy statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get strategy statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 获取所有策略统计信息
   * GET /api/statistics/strategies
   */
  private async getAllStrategyStatistics(req: express.Request, res: express.Response): Promise<void> {
    try {
      const statistics = await this.statisticsCalculator.getAllStrategyStatistics();
      
      res.json({
        success: true,
        data: {
          strategies: statistics,
          count: statistics.length
        }
      });
      
    } catch (error) {
      console.error('Error getting all strategy statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get all strategy statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 获取系统状态
   * GET /api/status
   */
  private async getSystemStatus(req: express.Request, res: express.Response): Promise<void> {
    try {
      const trackerStats = await this.tracker.getStatistics();
      const priceMonitorStats = this.tracker.getPriceMonitorStats();
      const cacheStatus = this.statisticsCalculator.getCacheStatus();
      
      res.json({
        success: true,
        data: {
          tracker: {
            is_running: this.tracker.isRunningStatus(),
            active_recommendations: trackerStats.active,
            total_recommendations: trackerStats.total,
            win_rate: trackerStats.winRate
          },
          price_monitor: {
            cached_symbols: priceMonitorStats.symbols,
            cache_size: priceMonitorStats.size
          },
          statistics_cache: cacheStatus,
          database: {
            connected: true // TODO: 从database获取实际连接状态
          },
          // 新增：门控拒绝统计（内存级）
          gating_stats: {
            by_reason: this.gatingStats.byReason,
            by_direction: this.gatingStats.byDirection,
            hourly_cap: this.gatingStats.hourlyCap,
            // 新增：输出 MTF 细分
            mtf: this.gatingStats.mtf,
            recent: this.gatingStats.recent
          },
          uptime: process.uptime(),
          memory_usage: process.memoryUsage()
        }
      });
      
    } catch (error) {
      console.error('Error getting system status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get system status',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 启动跟踪器
   * POST /api/tracker/start
   */
  private async startTracker(req: express.Request, res: express.Response): Promise<void> {
    try {
      await this.tracker.start();
      
      res.json({
        success: true,
        data: {
          message: 'Recommendation tracker started successfully'
        }
      });
      
    } catch (error) {
      console.error('Error starting tracker:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to start tracker',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 停止跟踪器
   * POST /api/tracker/stop
   */
  private async stopTracker(req: express.Request, res: express.Response): Promise<void> {
    try {
      await this.tracker.stop();
      
      res.json({
        success: true,
        data: {
          message: 'Recommendation tracker stopped successfully'
        }
      });
      
    } catch (error) {
      console.error('Error stopping tracker:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to stop tracker',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 清除缓存
   * POST /api/cache/clear
   */
  private async clearCache(req: express.Request, res: express.Response): Promise<void> {
    try {
      try { (this.statisticsCalculator as any)?.clearAllCache?.(); } catch {}
      try { (this.tracker as any)?.clearPrices?.(); } catch {}
      
      res.json({
        success: true,
        data: {
          message: 'All caches cleared successfully'
        }
      });
      
    } catch (error) {
      console.error('Error clearing cache:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear cache',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  // 新增：修剪历史，仅保留最近 N 条
  private async trimRecommendations(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { keep } = req.body || {};
      const keepNum = Number.isFinite(Number(keep)) ? Math.max(0, Math.floor(Number(keep))) : 100;
      const result = await this.database.trimRecommendations(keepNum);
  
      // 清理统计缓存
      this.statisticsCalculator.clearAllCache();
  
      res.json({ success: true, data: { keep: keepNum, ...result } });
    } catch (error) {
      console.error('Error trimming recommendations:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to trim recommendations',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 获取路由器实例
   */
  getRouter(): express.Router {
    return this.router;
  }
  
  /**
   * 获取跟踪器实例
   */
  getTracker(): RecommendationTracker {
    return this.tracker;
  }
  
  /**
   * 获取统计计算器实例
   */
  getStatisticsCalculator(): StatisticsCalculator {
    return this.statisticsCalculator;
  }

  // 新增：GET /api/executions
  private async listExecutions(req: express.Request, res: express.Response): Promise<void> {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
      const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0;
      const filters: any = {
        symbol: req.query.symbol ? String(req.query.symbol) : undefined,
        event_type: req.query.event_type ? String(req.query.event_type) : undefined,
        direction: req.query.direction ? String(req.query.direction) : undefined,
        recommendation_id: req.query.recommendation_id ? String(req.query.recommendation_id) : undefined,
        position_id: req.query.position_id ? String(req.query.position_id) : undefined,
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        min_size: req.query.min_size ? Number(req.query.min_size) : undefined,
        max_size: req.query.max_size ? Number(req.query.max_size) : undefined,
      };
      const { items, count } = await this.database.listExecutions(filters, limit, offset);
      res.status(200).json({ items, count });
    } catch (e) {
      console.error('listExecutions error:', e);
      res.status(500).json({ error: 'failed_to_list_executions' });
    }
  }

  // 新增：POST /api/executions（手动/维护用途）
  private async createExecution(req: express.Request, res: express.Response): Promise<void> {
    try {
      const body = req.body || {};
      // 基本校验
      const required = ['event_type', 'symbol', 'direction', 'size', 'fill_price', 'fill_timestamp'];
      for (const k of required) {
        if (!(k in body)) {
          res.status(400).json({ error: 'missing_field', field: k });
          return;
        }
      }
      const event_type = String(body.event_type).toUpperCase();
      if (!['OPEN','CLOSE','REDUCE'].includes(event_type)) {
        res.status(400).json({ error: 'invalid_event_type' });
        return;
      }
      const direction = String(body.direction).toUpperCase();
      if (!['LONG','SHORT'].includes(direction)) {
        res.status(400).json({ error: 'invalid_direction' });
        return;
      }
      const size = Number(body.size);
      const fill_price = Number(body.fill_price);
      const fill_timestamp = Number(body.fill_timestamp);
      if (!isFinite(size) || size <= 0) {
        res.status(400).json({ error: 'invalid_size' });
        return;
      }
      if (!isFinite(fill_price) || fill_price <= 0) {
        res.status(400).json({ error: 'invalid_fill_price' });
        return;
      }
      if (!isFinite(fill_timestamp) || fill_timestamp <= 0) {
        res.status(400).json({ error: 'invalid_fill_timestamp' });
        return;
      }

      const exe: ExecutionRecord = {
        created_at: new Date(),
        updated_at: new Date(),
        recommendation_id: body.recommendation_id ?? null,
        position_id: body.position_id ?? null,
        event_type,
        symbol: String(body.symbol),
        direction: direction as any,
        size,
        intended_price: body.intended_price !== undefined ? Number(body.intended_price) : null,
        intended_timestamp: body.intended_timestamp !== undefined ? Number(body.intended_timestamp) : null,
        fill_price,
        fill_timestamp,
        latency_ms: body.latency_ms !== undefined ? Number(body.latency_ms) : null,
        slippage_bps: body.slippage_bps !== undefined ? Number(body.slippage_bps) : null,
        slippage_amount: body.slippage_amount !== undefined ? Number(body.slippage_amount) : null,
        fee_bps: body.fee_bps !== undefined ? Number(body.fee_bps) : null,
        fee_amount: body.fee_amount !== undefined ? Number(body.fee_amount) : null,
        pnl_amount: body.pnl_amount !== undefined ? Number(body.pnl_amount) : null,
        pnl_percent: body.pnl_percent !== undefined ? Number(body.pnl_percent) : null,
        extra_json: body.extra_json ? (typeof body.extra_json === 'string' ? body.extra_json : JSON.stringify(body.extra_json)) : null,
      };

      const id = await this.database.saveExecution(exe);
      res.status(201).json({ id, ...exe });
    } catch (e) {
      console.error('createExecution error:', e);
      res.status(500).json({ error: 'failed_to_create_execution' });
    }
  }

  // 新增：查询最近的门控（GATED）监控快照
  private async listGatedMonitoring(req: express.Request, res: express.Response): Promise<void> {
    try {
      const limit = Math.min(2000, Math.max(0, Number(req.query.limit ?? 500)));
      const offset = Math.max(0, Number(req.query.offset ?? 0));

      const filters = {
        recommendation_id: typeof req.query.recommendation_id === 'string' ? req.query.recommendation_id : undefined,
        gid: typeof req.query.gid === 'string' ? req.query.gid : undefined,
        symbol: typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined,
        direction: typeof req.query.direction === 'string' && ['LONG','SHORT'].includes((req.query.direction as string).toUpperCase())
          ? (req.query.direction as string).toUpperCase() as 'LONG' | 'SHORT'
          : undefined,
        reason: typeof req.query.reason === 'string' ? req.query.reason : undefined,
        stage: typeof req.query.stage === 'string' ? req.query.stage : undefined,
        source: typeof req.query.source === 'string' ? req.query.source : undefined,
        timeStart: typeof req.query.timeStart === 'string' ? req.query.timeStart : undefined,
        timeEnd: typeof req.query.timeEnd === 'string' ? req.query.timeEnd : undefined,
      } as const;

      const items = await this.database.listGatedMonitoring(limit, offset, filters);
      res.json({ success: true, data: { items, limit, offset } });
    } catch (error) {
      console.error('Error listing gated monitoring:', error);
      res.status(500).json({ success: false, error: 'Failed to list gated monitoring' });
    }
  }

  // 新增：统一门控拒绝原因打点（API 层）
  private async logGatingDecision(source: string, payload: any, error: any): Promise<void> {
    try {
      const upper = (v: any) => (typeof v === 'string' ? v.toUpperCase() : '');
      const action = upper(payload?.recommendation?.action || payload?.action);
      let dir: 'LONG' | 'SHORT' | null = (payload?.direction === 'LONG' || payload?.direction === 'SHORT') ? payload.direction : null;
      if (!dir) {
        if (action === 'OPEN_LONG' || action === 'BUY' || action === 'STRONG_BUY') dir = 'LONG';
        else if (action === 'OPEN_SHORT' || action === 'SELL' || action === 'STRONG_SELL') dir = 'SHORT';
      }
      const direction = dir;
      const symbol = String(payload?.symbol || payload?.recommendation?.symbol || 'UNKNOWN');

      const candidates = [
        payload?.current_price,
        payload?.entry_price,
        payload?.price,
        payload?.marketData?.price,
        payload?.recommendation?.current_price,
        payload?.recommendation?.entry_price
      ];
      let currentPrice = 0;
      for (const c of candidates) {
        const v = Number(c);
        if (Number.isFinite(v) && v > 0) { currentPrice = v; break; }
      }

      const gid = `GATED|${symbol}|${direction || 'NA'}|${Date.now()}`;
      const detail: any = {
        type: 'GATED',
        stage: 'API',
        source,
        symbol,
        direction: direction || undefined
      };

      if (error instanceof DuplicateError || (error as any)?.code === 'DUPLICATE_RECOMMENDATION') {
        detail.reason = 'DUPLICATE_RECOMMENDATION';
        if ((error as any)?.windowMinutes !== undefined) detail.windowMinutes = (error as any).windowMinutes;
        if ((error as any)?.bpsThreshold !== undefined) detail.bpsThreshold = (error as any).bpsThreshold;
        if ((error as any)?.matchedIds) detail.matchedIds = (error as any).matchedIds;
      } else if (error instanceof CooldownError) {
        const kind = (error as any)?.kind as ('SAME_DIRECTION' | 'OPPOSITE' | 'GLOBAL' | 'HOURLY' | undefined);
        if (kind === 'HOURLY') {
          detail.reason = 'HOURLY_CAP';
          detail.scope = (error as any)?.scope; // 'TOTAL' | 'PER_DIRECTION'
          detail.cap = (error as any)?.cap;
          detail.currentCount = (error as any)?.currentCount;
        } else {
          detail.reason = kind === 'SAME_DIRECTION' ? 'COOLDOWN_SAME_DIRECTION'
            : kind === 'OPPOSITE' ? 'COOLDOWN_OPPOSITE'
            : kind === 'GLOBAL' ? 'COOLDOWN_GLOBAL'
            : 'COOLDOWN';
        }
        detail.remainingMs = (error as any)?.remainingMs;
        detail.nextAvailableAt = (error as any)?.nextAvailableAt;
        detail.cooldownKind = kind;
        detail.cooldownDirection = (error as any)?.direction;
        detail.usedCooldownMs = (error as any)?.usedCooldownMs;
        detail.lastRecommendationId = (error as any)?.lastRecommendationId;
        detail.lastCreatedAt = (error as any)?.lastCreatedAt;
      } else if (error instanceof OppositeConstraintError) {
        detail.reason = 'OPPOSITE_CONSTRAINT';
        detail.subReason = (error as any)?.reason;
        if ((error as any)?.confidence !== undefined) detail.confidence = (error as any).confidence;
        if ((error as any)?.threshold !== undefined) detail.threshold = (error as any).threshold;
        if ((error as any)?.oppositeActiveCount !== undefined) detail.oppositeActiveCount = (error as any).oppositeActiveCount;
      } else if (error instanceof ExposureLimitError) {
        detail.reason = 'EXPOSURE_LIMIT';
      } else if ((error as any)?.code === 'EXPOSURE_CAP') {
        const e: any = error;
        const scope = e.scope;
        detail.reason = 'EXPOSURE_CAP';
        detail.totalCap = e.totalCap ?? (scope === 'TOTAL' ? e.cap : undefined);
        detail.dirCap = e.dirCap ?? (scope && scope !== 'TOTAL' ? e.cap : undefined);
        detail.currentTotal = e.currentTotal ?? (scope === 'TOTAL' ? e.current : undefined);
        detail.currentDirection = e.currentDirection ?? (scope && scope !== 'TOTAL' ? e.current : undefined);
        detail.adding = e.adding ?? e.candidate;
      } else {
        detail.reason = 'UNKNOWN';
        detail.message = (error as any)?.message || String(error);
        detail.name = (error as any)?.name;
      }

      // 新增：内存级拒绝统计累加
      const reason = String(detail.reason || 'UNKNOWN');
      this.gatingStats.byReason[reason] = (this.gatingStats.byReason[reason] || 0) + 1;
      if (direction === 'LONG' || direction === 'SHORT') {
        const bucket = this.gatingStats.byDirection[direction];
        bucket[reason] = (bucket[reason] || 0) + 1;
      }
      // HOURLY_CAP 细分统计：total 与 perDirection
      if (reason === 'HOURLY_CAP') {
        const scope = (detail as any)?.scope;
        if (scope === 'TOTAL') {
          this.gatingStats.hourlyCap.total = (this.gatingStats.hourlyCap.total || 0) + 1;
        } else if (direction === 'LONG' || direction === 'SHORT') {
          const pd = this.gatingStats.hourlyCap.perDirection;
          pd[direction] = (pd[direction] || 0) + 1;
        } else {
          this.gatingStats.hourlyCap.total = (this.gatingStats.hourlyCap.total || 0) + 1;
        }
      }
      // 新增：MTF 一致性细分统计
      if (reason === 'MTF_CONSISTENCY') {
        const agreement = Number((detail as any)?.agreement);
        const dom = (detail as any)?.dominantDirection as ('LONG' | 'SHORT' | undefined);
        let bucket = 'NaN';
        if (Number.isFinite(agreement)) {
          if (agreement < 0.4) bucket = '<0.4';
          else if (agreement < 0.6) bucket = '0.4-0.6';
          else if (agreement < 0.8) bucket = '0.6-0.8';
          else bucket = '>=0.8';
        }
        this.gatingStats.mtf.byAgreementBucket[bucket] = (this.gatingStats.mtf.byAgreementBucket[bucket] || 0) + 1;
        const dkey: 'LONG' | 'SHORT' | 'NA' = dom === 'LONG' || dom === 'SHORT' ? dom : 'NA';
        this.gatingStats.mtf.byDominantDirection[dkey] = (this.gatingStats.mtf.byDominantDirection[dkey] || 0) + 1;
      }

      this.gatingStats.recent.push({ ts: Date.now(), symbol, direction: direction || undefined, reason });
      if (this.gatingStats.recent.length > 50) this.gatingStats.recent.shift();

      await this.database.saveMonitoringSnapshot({
        recommendation_id: gid,
        check_time: new Date().toISOString(),
        current_price: currentPrice,
        unrealized_pnl: null,
        unrealized_pnl_percent: null,
        is_stop_loss_triggered: false,
        is_take_profit_triggered: false,
        extra_json: JSON.stringify(detail)
      });
    } catch (e) {
      console.warn('[API] logGatingDecision failed:', (e as any)?.message || String(e));
    }
  }

  /**
   * EV vs 实现 PnL 统计
   * GET /api/stats?start=iso&end=iso&strategy_type=...&ab_group=A,B&bins=5&bin_mode=quantile
   */
  private async getEVvsPnLStats(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { start, end, strategy_type, ab_group, bins, bin_mode, breakdown_by_ab } = req.query as any;
      let start_date: Date | undefined;
      let end_date: Date | undefined;
      if (start) {
        const d = new Date(String(start));
        if (!isNaN(d.getTime())) start_date = d;
      }
      if (end) {
        const d = new Date(String(end));
        if (!isNaN(d.getTime())) end_date = d;
      }
      const ab = ab_group ? String(ab_group).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined;
      const binsNum = bins ? Number(bins) : undefined;
      const mode = bin_mode === 'even' ? 'even' : 'quantile';
      const breakdown = breakdown_by_ab === '1' || breakdown_by_ab === 'true' || breakdown_by_ab === true;

      const data = await this.statisticsCalculator.computeEVvsPnLStats({
        start_date,
        end_date,
        strategy_type: strategy_type ? String(strategy_type) : undefined,
        ab_group: ab,
        bins: binsNum,
        bin_mode: mode,
        breakdown_by_ab: breakdown
      });

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error computing EV vs PnL stats:', error);
      res.status(500).json({ success: false, error: 'Failed to compute stats', details: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  /**
   * EV 监控指标
   * GET /api/monitoring/ev-metrics?window=7d&strategy_type=...&group_by=ev&bins=5
   */
  private async getEVMonitoring(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { window, start, end, strategy_type, group_by, bins } = req.query as any;
      let start_date: Date | undefined;
      let end_date: Date | undefined;
      if (start) {
        const d = new Date(String(start));
        if (!isNaN(d.getTime())) start_date = d;
      }
      if (end) {
        const d = new Date(String(end));
        if (!isNaN(d.getTime())) end_date = d;
      }
      const win = ['1d', '7d', '30d'].includes(String(window)) ? (window as '1d'|'7d'|'30d') : undefined;
      const groupBy = String(group_by) === 'ev_threshold' ? 'ev_threshold' : 'ev';
      const binsNum = bins ? Number(bins) : undefined;

      const data = await this.statisticsCalculator.computeEVMonitoring({
        window: win,
        start_date,
        end_date,
        strategy_type: strategy_type ? String(strategy_type) : undefined,
        group_by: groupBy as any,
        bins: binsNum
      });

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error computing EV monitoring metrics:', error);
      res.status(500).json({ success: false, error: 'Failed to compute monitoring metrics', details: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
}

/**
 * 创建推荐API实例的工厂函数
 */
export function createRecommendationAPI(
  dataService: EnhancedOKXDataService,
  database: RecommendationDatabase,
  tracker?: RecommendationTracker
): RecommendationAPI {
  return new RecommendationAPI(dataService, database, tracker);
}

// 将DB枚举映射为中文展示
function mapExitLabelEnumToCN(label: string): string {
  switch (label) {
    case 'DYNAMIC_TAKE_PROFIT':
      return '动态止盈';
    case 'DYNAMIC_STOP_LOSS':
      return '动态止损';
    case 'TIMEOUT':
      return '超时';
    case 'BREAKEVEN':
      return '保本';
    default:
      return '保本';
  }
}

// 简化后的派生规则：仅四类（加上ACTIVE的“持仓中”）
function deriveExitLabel(rec: any): string {
  try {
    const status = rec?.status;
    if (status === 'ACTIVE') return '持仓中';
    const reason = rec?.exit_reason as string | undefined;
    const result = rec?.result as string | undefined;
    const pnl = typeof rec?.pnl_percent === 'number' ? rec.pnl_percent as number : undefined;

    // TIMEOUT 优先
    if (reason === 'TIMEOUT') return '超时';
    // 先识别保本
    if (reason === 'BREAKEVEN' || result === 'BREAKEVEN' || (typeof pnl === 'number' && Math.abs(pnl) < 0.1)) {
      return '保本';
    }
    // WIN/LOSS 判断（以 result 为主、pnl 为辅）
    const win = result === 'WIN' || (result == null && typeof pnl === 'number' && pnl > 0.1);
    const loss = result === 'LOSS' || (result == null && typeof pnl === 'number' && pnl < -0.1);
    if (win) return '动态止盈';
    if (loss) return '动态止损';
    return '保本';
  } catch {
    return '保本';
  }
}

// 统一去重函数：按历史列表规则去重（时间桶+标的+方向+关键价位），以确保前后端口径一致
function dedupRecommendationsByHistoryRule(list: any[]): any[] {
  const bySig = new Map<string, any>();

  const normDir = (d: any) => {
    const x = String(d || '').toUpperCase();
    if (x === 'BUY') return 'LONG';
    if (x === 'SELL') return 'SHORT';
    return x;
  };

  const normNum = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    // 价格容差：保留两位小数做分组，避免微小浮点差异造成重复
    return (Math.round(n * 100) / 100).toFixed(2);
  };

  for (const r of Array.isArray(list) ? list : []) {
    const tRaw = (r?.created_at ?? r?.createdAt ?? r?.create_time ?? r?.timestamp ?? 0);
    const tVal = new Date(tRaw).getTime();
    const tBucket = Number.isFinite(tVal) ? Math.floor(tVal / 5000) * 5000 : 0; // 5秒桶
    const sym = String(r?.symbol || '').toUpperCase();
    const dir = normDir(r?.direction ?? r?.action);
    const entry = normNum(r?.entry_price);
    const tp = normNum(r?.take_profit_price ?? r?.take_profit);
    const sl = normNum(r?.stop_loss_price ?? r?.stop_loss);
    const sig = `t${tBucket}|${sym}|${dir}|e${entry}|tp${tp}|sl${sl}`;

    const prev = bySig.get(sig);
    if (!prev) {
      bySig.set(sig, r);
    } else {
      const tPrevRaw = (prev?.created_at ?? prev?.createdAt ?? prev?.create_time ?? prev?.timestamp ?? 0);
      const tPrev = new Date(tPrevRaw).getTime();
      const newer = tVal > tPrev;
      const conf = Number(r?.confidence ?? r?.conf ?? r?.confidence_score);
      const pconf = Number(prev?.confidence ?? prev?.conf ?? prev?.confidence_score);
      const betterConf = Number.isFinite(conf) && (!Number.isFinite(pconf) || conf > pconf);
      if (newer || (!newer && betterConf)) bySig.set(sig, r);
    }
  }

  return Array.from(bySig.values());
}