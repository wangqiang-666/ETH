import * as express from 'express';
import { RecommendationTracker, RecommendationRecord, CooldownError, DuplicateError, OppositeConstraintError, ExposureLimitError, MTFConsistencyError } from '../services/recommendation-tracker.js';
import { RecommendationDatabase, ExecutionRecord } from '../services/recommendation-database.js';
import { StatisticsCalculator, StrategyStatistics, OverallStatistics } from '../services/statistics-calculator.js';
import { EnhancedOKXDataService } from '../services/enhanced-okx-data-service.js';
import { ABTestingService, ABTestConfig, ABTestAnalysis } from '../services/ab-testing-service.js';
import { DecisionChainMonitor } from '../services/decision-chain-monitor.js';

/**
 * 推荐API路由器
 * 提供推荐记录的CRUD操作和统计查询接口
 */
export class RecommendationAPI {
  private router: express.Router;
  private tracker: RecommendationTracker;
  private database: RecommendationDatabase;
  private statisticsCalculator: StatisticsCalculator;
  private abTestingService: ABTestingService;
  private decisionChainMonitor: DecisionChainMonitor;
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

  // 新增：API层决策统计
  private apiDecisionMetrics = {
    totalRequests: 0,
    successfulCreations: 0,
    rejectedCreations: 0,
    validationErrors: 0,
    gatingErrors: 0,
    systemErrors: 0,
    rejectionReasons: {} as Record<string, number>,
    responseTimeStats: {
      total: 0,
      count: 0,
      min: Infinity,
      max: 0,
      avg: 0
    }
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
    this.abTestingService = new ABTestingService();
    this.decisionChainMonitor = new DecisionChainMonitor();
    
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
    this.router.post('/recommendations', this.handleCreateRecommendation.bind(this));
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
    this.router.get('/recommendations/statistics', this.getRecommendationStatistics.bind(this));
    
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

    // 新增：滑点分析路由
    this.router.get('/slippage/analysis', this.getSlippageAnalysis.bind(this));
    this.router.post('/slippage/analysis', this.createSlippageAnalysis.bind(this));
    this.router.get('/slippage/statistics', this.getSlippageStatistics.bind(this));
    this.router.post('/slippage/statistics/calculate', this.calculateSlippageStatistics.bind(this));
    this.router.get('/slippage/thresholds', this.getSlippageThresholds.bind(this));
    this.router.post('/slippage/thresholds/adjust', this.adjustSlippageThresholds.bind(this));
    this.router.get('/slippage/alerts', this.getSlippageAlerts.bind(this));
    this.router.post('/slippage/anomalies/detect', this.detectHighSlippageAnomalies.bind(this));
    this.router.post('/slippage/backfill', this.backfillSlippageStatistics.bind(this));
    this.router.get('/slippage/backfill/history', this.getSlippageBackfillHistory.bind(this));

    // A/B测试路由
    this.router.get('/ab-testing/experiments', this.getExperiments.bind(this));
    this.router.post('/ab-testing/experiments', this.createExperiment.bind(this));
    this.router.get('/ab-testing/experiments/:experimentId', this.getExperiment.bind(this));
    this.router.post('/ab-testing/experiments/:experimentId/assign-variant', this.assignVariant.bind(this));
    this.router.get('/ab-testing/experiments/:experimentId/analysis', this.getExperimentAnalysis.bind(this));
    this.router.get('/ab-testing/variant-stats', this.getVariantStatistics.bind(this));
    this.router.get('/ab-testing/reports', this.getABTestReports.bind(this));

    // 决策链监控路由
    this.router.get('/decision-chains', this.getDecisionChainsRoute.bind(this));
    this.router.get('/decision-chains/:chainId', this.getDecisionChainRoute.bind(this));
    this.router.get('/decision-chains/:chainId/replay', this.replayDecisionChainRoute.bind(this));
    this.router.get('/decision-chains/symbol/:symbol', this.getDecisionChainsBySymbolRoute.bind(this));
    this.router.get('/decision-chains/recent', this.getRecentDecisionChainsRoute.bind(this));
    this.router.get('/decision-chains/stats', this.getDecisionChainStatsRoute.bind(this));
    this.router.get('/decision-chains/failures', this.getFailedDecisionChainsRoute.bind(this));
  }
  
  /**
   * 创建新推荐（公开方法，供测试使用）
   */
  public async createRecommendation(request: any): Promise<any> {
    try {
      // 验证必需字段
      if (!request || typeof request !== 'object') {
        return { success: false, error: 'Invalid request body' };
      }
      
      // 验证价格和杠杆
      const priceFields = ['entryPrice', 'current_price'];
      for (const field of priceFields) {
        const v = Number(request[field]);
        if (Number.isFinite(v) && v > 0) {
          request.entry_price = v;
          break;
        }
      }
      
      const lev = Number(request.leverage);
      if (!Number.isFinite(lev) || lev <= 0) {
        return { success: false, error: 'Invalid leverage' };
      }
      
      // 验证方向
      if (!['LONG', 'SHORT'].includes(request.direction)) {
        return { success: false, error: 'Direction must be LONG or SHORT' };
      }
      
      // 添加决策链监控
      const chainId = await this.decisionChainMonitor.startChain({
        symbol: request.symbol,
        direction: request.direction,
        source: 'API_RECOMMENDATION'
      });
      
      await this.decisionChainMonitor.addDecisionStep(chainId, {
        stage: 'SIGNAL_COLLECTION',
        decision: 'PENDING',
        reason: 'Creating recommendation via API',
        details: {
          userId: request.user_id || 'default-user',
          experimentId: request.experiment_id || 'recommendation-strategy-v1'
        }
      });
      
      // 创建推荐
      const recommendationId = await this.tracker.addRecommendation(request, { bypassCooldown: request?.bypassCooldown === true });
      
      await this.decisionChainMonitor.addDecisionStep(chainId, {
        stage: 'EXECUTION_DECISION',
        decision: 'APPROVED',
        reason: 'Recommendation created successfully',
        details: { recommendationId }
      });
      
      // Link recommendation to decision chain
      this.decisionChainMonitor.linkRecommendation(chainId, recommendationId);
      
      await this.decisionChainMonitor.finalizeChain(chainId);
      
      // 在创建成功后调用外部钩子（异步，不阻塞响应）
      if (this.onCreateHook) {
        Promise.resolve(this.onCreateHook(recommendationId, request)).catch(err => {
          console.warn('onCreateHook error:', err?.message || String(err));
        });
      }
      
      // 创建后使统计缓存失效，保证前端统计实时
      try { (this.statisticsCalculator as any)?.clearAllCache?.(); } catch {}
      
      return {
        success: true,
        data: {
          id: recommendationId,
          recommendationId,
          decisionChainId: chainId,
          message: 'Recommendation created successfully'
        }
      };
      
    } catch (error) {
      console.error('Error creating recommendation:', error);
      
      // 添加决策链监控
      const chainId = `API_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.decisionChainMonitor.startChain(chainId, request.symbol, 'API_RECOMMENDATION');
      
      // 新增：对冷却期错误映射为 429，并记录统一拒绝原因快照
      if (error instanceof CooldownError) {
        try { 
          await this.logGatingDecision('API', request, error);
          await this.decisionChainMonitor.addDecisionStep(chainId, {
            stage: 'GATING_CHECK',
            decision: 'REJECTED',
            reason: 'Recommendation gated by cooldown',
            details: {
              errorType: (error as Error).constructor.name,
              errorMessage: (error as any)?.message
            }
          });
          await this.decisionChainMonitor.finalizeChain(chainId);
        } catch {}
        return {
          success: false,
          error: 'cooldown',
          data: { decisionChainId: chainId }
        };
      }
      // 新增：对相似/重复推荐映射为 409（计入门控拒绝打点）
      if (error instanceof DuplicateError) {
        try { 
          await this.logGatingDecision('API', request, error);
          await this.decisionChainMonitor.addDecisionStep(chainId, {
            stage: 'GATING_CHECK',
            decision: 'REJECTED',
            reason: 'Recommendation gated by duplicate detection',
            details: {
              errorType: (error as Error).constructor.name,
              errorMessage: (error as any)?.message
            }
          });
          await this.decisionChainMonitor.finalizeChain(chainId);
        } catch {}
        return {
          success: false,
          error: 'duplicate',
          data: { decisionChainId: chainId }
        };
      }
      // 新增：多TF一致性失败 -> 409
      if (error instanceof MTFConsistencyError || (error as any)?.code === 'MTF_CONSISTENCY') {
        try { 
          await this.logGatingDecision('API', request, error);
          await this.decisionChainMonitor.addDecisionStep(chainId, {
            stage: 'GATING_CHECK',
            decision: 'REJECTED',
            reason: 'Recommendation gated by MTF consistency check',
            details: {
              errorType: (error as Error).constructor.name,
              errorMessage: (error as any)?.message
            }
          });
          await this.decisionChainMonitor.finalizeChain(chainId);
        } catch {}
        return {
          success: false,
          error: 'MTF consistency',
          data: { decisionChainId: chainId }
        };
      }
      // 新增：对反向并存与净敞口限制映射为 409，并记录统一拒绝原因快照
      if (error instanceof OppositeConstraintError) {
        try { 
          await this.logGatingDecision('API', request, error);
          await this.decisionChainMonitor.addDecisionStep(chainId, {
            stage: 'GATING_CHECK',
            decision: 'REJECTED',
            reason: 'Recommendation gated by opposite constraint',
            details: {
              errorType: (error as Error).constructor.name,
              errorMessage: (error as any)?.message
            }
          });
          await this.decisionChainMonitor.finalizeChain(chainId);
        } catch {}
        return {
          success: false,
          error: 'opposite constraint',
          data: { decisionChainId: chainId }
        };
      }
      if (error instanceof ExposureLimitError) {
        try { 
          await this.logGatingDecision('API', request, error);
          await this.decisionChainMonitor.addDecisionStep(chainId, {
            stage: 'GATING_CHECK',
            decision: 'REJECTED',
            reason: 'Recommendation gated by exposure limit',
            details: {
              errorType: (error as Error).constructor.name,
              errorMessage: (error as any)?.message
            }
          });
          await this.decisionChainMonitor.finalizeChain(chainId);
        } catch {}
        return {
          success: false,
          error: 'exposure limit',
          data: { decisionChainId: chainId }
        };
      }
      if ((error as any)?.code === 'EXPOSURE_CAP') {
        try { 
          await this.logGatingDecision('API', request, error);
          await this.decisionChainMonitor.addDecisionStep(chainId, {
            stage: 'GATING_CHECK',
            decision: 'REJECTED',
            reason: 'Recommendation gated by exposure cap',
            details: {
              errorType: 'EXPOSURE_CAP',
              errorMessage: (error as any)?.message
            }
          });
          await this.decisionChainMonitor.finalizeChain(chainId);
        } catch {}
        return {
          success: false,
          error: 'exposure cap',
          data: { decisionChainId: chainId }
        };
      }
      // 处理其他系统错误
      try {
        await this.decisionChainMonitor.addDecisionStep(chainId, {
          stage: 'GATING_CHECK',
          decision: 'REJECTED',
          reason: 'System error during recommendation creation',
          details: {
            errorType: (error as Error).constructor.name,
            errorMessage: (error as any)?.message
          }
        });
        await this.decisionChainMonitor.finalizeChain(chainId);
      } catch {}
      
      return {
        success: false,
        error: 'Failed to create recommendation',
        data: { decisionChainId: chainId }
      };
    }
  }

  /**
   * 创建新推荐（Express路由处理器）
   * POST /api/recommendations
   */
  private async handleCreateRecommendation(req: express.Request, res: express.Response): Promise<void> {
    const startTime = Date.now();
    let chainId: string | null = null;
    
    try {
      this.apiDecisionMetrics.totalRequests++;
      
      const loopGuard = String(req.headers['x-loop-guard'] || '').toLowerCase() === '1';
      const recommendationData = req.body;
      
      // 验证必需字段
      if (!recommendationData || typeof recommendationData !== 'object') {
        this.apiDecisionMetrics.validationErrors++;
        this.recordRejectionReason('INVALID_REQUEST_BODY');
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
      
      // A/B测试：为用户分配实验变体
      const userId = recommendationData.user_id || 'default-user';
      const experimentId = recommendationData.experiment_id || 'recommendation-strategy-v1';
      const assignedVariant = this.abTestingService.assignVariant(userId, experimentId);
      
      // 获取变体配置并应用到推荐数据
      const variantConfig = this.abTestingService.getVariantConfig(experimentId, assignedVariant);
      
      // 创建新的推荐数据对象，避免修改常量
      const finalRecommendationData = {
        ...recommendationData,
        variant: assignedVariant,
        experiment_id: experimentId
      };
      
      if (variantConfig) {
        // 应用变体特定的策略配置
        finalRecommendationData.stop_loss_multiplier = variantConfig.stopLossMultiplier || recommendationData.stop_loss_multiplier;
        finalRecommendationData.take_profit_multiplier = variantConfig.takeProfitMultiplier || recommendationData.take_profit_multiplier;
        finalRecommendationData.confidence_threshold = variantConfig.confidenceThreshold || recommendationData.confidence_threshold;
      }
      
      // 添加决策链监控
      const chainId = `API_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await this.decisionChainMonitor.startChain(chainId, finalRecommendationData.symbol, 'API_RECOMMENDATION');
      
      await this.decisionChainMonitor.addDecisionStep(chainId, {
        stage: 'SIGNAL_COLLECTION',
        decision: 'PENDING',
        reason: 'Creating recommendation via API',
        details: {
          userId: userId,
          experimentId: experimentId,
          variant: assignedVariant
        }
      });
      
      // 创建推荐
      const recommendationId = await this.tracker.addRecommendation(finalRecommendationData, { bypassCooldown: finalRecommendationData?.bypassCooldown === true });
      
      await this.decisionChainMonitor.addDecisionStep(chainId, {
        stage: 'EXECUTION_DECISION',
        decision: 'APPROVED',
        reason: 'Recommendation created successfully',
        details: { recommendationId }
      });
      await this.decisionChainMonitor.finalizeChain(chainId);
      
      // 在创建成功后调用外部钩子（异步，不阻塞响应）
      if (!loopGuard && this.onCreateHook) {
        Promise.resolve(this.onCreateHook(recommendationId, finalRecommendationData)).catch(err => {
          console.warn('onCreateHook error:', err?.message || String(err));
        });
      }
      
      // 创建后使统计缓存失效，保证前端统计实时
      try { (this.statisticsCalculator as any)?.clearAllCache?.(); } catch {}
      
      res.status(201).json({
        success: true,
        data: {
          id: recommendationId,
          variant: assignedVariant,
          experiment_id: experimentId,
          variant_config: variantConfig,
          message: 'Recommendation created successfully'
        }
      });
      
    } catch (error) {
      console.error('Error creating recommendation:', error);
      // 新增：对冷却期错误映射为 429，并记录统一拒绝原因快照
      if (error instanceof CooldownError) {
        try { 
          const chainId = `API_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          this.decisionChainMonitor.startChain(chainId, req.body.symbol, 'API_RECOMMENDATION');
          await this.logGatingDecision('API', req.body, error);
          await this.decisionChainMonitor.addDecisionStep(chainId, {
            stage: 'GATING_CHECK',
            decision: 'REJECTED',
            reason: 'Recommendation gated by cooldown',
            details: {
              errorType: (error as Error).constructor.name,
              errorMessage: (error as any)?.message
            }
          });
          await this.decisionChainMonitor.finalizeChain(chainId);
        } catch {}
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
        try { 
          const chainId = `API_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          this.decisionChainMonitor.startChain(chainId, req.body.symbol, 'API_RECOMMENDATION');
          await this.logGatingDecision('API', req.body, error);
          await this.decisionChainMonitor.addDecisionStep(chainId, {
            stage: 'GATING_CHECK',
            decision: 'REJECTED',
            reason: 'Recommendation gated by duplicate detection',
            details: {
              errorType: (error as Error).constructor.name,
              errorMessage: (error as any)?.message
            }
          });
          await this.decisionChainMonitor.finalizeChain(chainId);
        } catch {}
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
        try { 
          const chainId = `API_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          this.decisionChainMonitor.startChain(chainId, req.body.symbol, 'API_RECOMMENDATION');
          await this.logGatingDecision('API', req.body, error);
          await this.decisionChainMonitor.addDecisionStep(chainId, {
            stage: 'GATING_CHECK',
            decision: 'REJECTED',
            reason: 'Recommendation gated by MTF consistency check',
            details: {
              errorType: (error as Error).constructor.name,
              errorMessage: (error as any)?.message
            }
          });
          await this.decisionChainMonitor.finalizeChain(chainId);
        } catch {}
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
        try { 
          const chainId = `API_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          this.decisionChainMonitor.startChain(chainId, req.body.symbol, 'API_RECOMMENDATION');
          await this.logGatingDecision('API', req.body, error);
          await this.decisionChainMonitor.addDecisionStep(chainId, {
            stage: 'GATING_CHECK',
            decision: 'REJECTED',
            reason: 'Recommendation gated by opposite constraint',
            details: {
              errorType: (error as Error).constructor.name,
              errorMessage: (error as any)?.message
            }
          });
          await this.decisionChainMonitor.finalizeChain(chainId);
        } catch {}
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
        try { 
          const chainId = `API_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          this.decisionChainMonitor.startChain(chainId, req.body.symbol, 'API_RECOMMENDATION');
          await this.logGatingDecision('API', req.body, error);
          await this.decisionChainMonitor.addDecisionStep(chainId, {
            stage: 'GATING_CHECK',
            decision: 'REJECTED',
            reason: 'Recommendation gated by exposure limit',
            details: {
              errorType: (error as Error).constructor.name,
              errorMessage: (error as any)?.message
            }
          });
          await this.decisionChainMonitor.finalizeChain(chainId);
        } catch {}
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
        try { 
          const chainId = `API_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          this.decisionChainMonitor.startChain(chainId, req.body.symbol, 'API_RECOMMENDATION');
          await this.logGatingDecision('API', req.body, error);
          await this.decisionChainMonitor.addDecisionStep(chainId, {
            stage: 'GATING_CHECK',
            decision: 'REJECTED',
            reason: 'Recommendation gated by exposure cap',
            details: {
              errorType: 'EXPOSURE_CAP',
              errorMessage: (error as any)?.message
            }
          });
          await this.decisionChainMonitor.finalizeChain(chainId);
        } catch {}
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
      // 处理其他系统错误
      try {
        const chainId = `API_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.decisionChainMonitor.startChain(chainId, req.body.symbol, 'API_RECOMMENDATION');
        await this.decisionChainMonitor.addDecisionStep(chainId, {
          stage: 'GATING_CHECK',
          decision: 'REJECTED',
          reason: 'System error during recommendation creation',
          details: {
              errorType: (error as Error).constructor.name,
              errorMessage: (error as any)?.message
            }
        });
        await this.decisionChainMonitor.finalizeChain(chainId);
      } catch {}
      
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
      
      // 使用统一的字段映射和去重逻辑
      const { deduplicateRecommendations } = await import('../utils/recommendation-field-mapper.js');
      const normalizedRecommendations = deduplicateRecommendations(recommendations || []);
      
      // 更新：优先使用 DB 的 exit_label（英文枚举），否则派生（已简化为四类）
      const enriched = normalizedRecommendations.map((r: any) => {
        const label = r.exit_label ? r.exit_label : undefined;
        return {
          ...r,
          exit_label: label ? mapExitLabelEnumToCN(label) : deriveExitLabel(r)
        };
      });
      
      res.json({
        success: true,
        data: enriched,
        total: enriched.length // 使用去重后的数量
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

      // 使用统一的字段映射和去重逻辑
      const { deduplicateRecommendations } = await import('../utils/recommendation-field-mapper.js');
      const normalizedRecommendations = deduplicateRecommendations(activeRecommendations);

      // 填充 exit_label 为中文（若无则根据状态/原因派生）
      const recommendationsWithLabel = normalizedRecommendations.map((rec: any) => {
        const label = rec?.exit_label ? mapExitLabelEnumToCN(rec.exit_label) : deriveExitLabel(rec);
        return { ...rec, exit_label: label };
      });

      res.json({
        success: true,
        data: {
          recommendations: recommendationsWithLabel,
          count: recommendationsWithLabel?.length ?? 0
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
   * 获取推荐统计信息
   * GET /api/recommendations/statistics
   */
  private async getRecommendationStatistics(req: express.Request, res: express.Response): Promise<void> {
    try {
      const statistics = await this.statisticsCalculator.calculateOverallStatistics();
      
      // 获取活跃推荐数量
      const activeRecommendations = this.tracker.getActiveRecommendations();
      const activeCount = activeRecommendations ? activeRecommendations.length : 0;
      
      res.json({
          success: true,
          data: {
            total: statistics.total_recommendations || 0,
            active: activeCount,
            completed: (statistics.total_recommendations || 0) - activeCount,
            winRate: statistics.overall_win_rate || 0,
            totalPnL: statistics.overall_total_pnl || 0,
            avgReturn: statistics.overall_avg_pnl || 0
          }
        });
    } catch (error) {
      console.error('[RecommendationAPI] Failed to get recommendation statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get recommendation statistics'
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

  /**
   * 记录拒绝原因统计
   */
  private recordRejectionReason(reason: string): void {
    if (!this.apiDecisionMetrics.rejectionReasons[reason]) {
      this.apiDecisionMetrics.rejectionReasons[reason] = 0;
    }
    this.apiDecisionMetrics.rejectionReasons[reason]++;
    this.apiDecisionMetrics.rejectedCreations++;
  }

  /**
   * 更新响应时间统计
   */
  private updateResponseTimeStats(responseTime: number): void {
    const stats = this.apiDecisionMetrics.responseTimeStats;
    stats.total += responseTime;
    stats.count++;
    stats.min = Math.min(stats.min, responseTime);
    stats.max = Math.max(stats.max, responseTime);
    stats.avg = stats.total / stats.count;
  }

  /**
   * 获取API决策统计信息
   */
  public getAPIDecisionMetrics(): any {
    return {
      ...this.apiDecisionMetrics,
      successRate: this.apiDecisionMetrics.totalRequests > 0 
        ? (this.apiDecisionMetrics.successfulCreations / this.apiDecisionMetrics.totalRequests * 100).toFixed(2) + '%'
        : '0%',
      gatingRate: this.apiDecisionMetrics.totalRequests > 0
        ? (this.apiDecisionMetrics.gatingErrors / this.apiDecisionMetrics.totalRequests * 100).toFixed(2) + '%'
        : '0%',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 重置API决策统计
   */
  public resetAPIDecisionMetrics(): void {
    this.apiDecisionMetrics = {
      totalRequests: 0,
      successfulCreations: 0,
      rejectedCreations: 0,
      validationErrors: 0,
      gatingErrors: 0,
      systemErrors: 0,
      rejectionReasons: {},
      responseTimeStats: {
        total: 0,
        count: 0,
        min: Infinity,
        max: 0,
        avg: 0
      }
    };
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
        ab_group: req.query.ab_group ? String(req.query.ab_group) : undefined,
        variant: req.query.variant ? String(req.query.variant) : undefined,
        experiment_id: req.query.experiment_id ? String(req.query.experiment_id) : undefined,
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
        ab_group: body.ab_group !== undefined ? String(body.ab_group) : null,
        variant: body.variant !== undefined ? String(body.variant) : null,
        experiment_id: body.experiment_id !== undefined ? String(body.experiment_id) : null,
        extra_json: body.extra_json ? (typeof body.extra_json === 'string' ? body.extra_json : JSON.stringify(body.extra_json)) : null,
      };

      const id = await this.database.saveExecution(exe);
      // 保存后按ID查询以返回包含与推荐记录 COALESCE 后的完整字段
      const full = await this.database.getExecutionById(id);
      res.status(201).json(full ?? { id, ...exe });
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

  /**
   * 获取滑点分析记录
   * GET /api/slippage/analysis?symbol=BTC-USDT&direction=LONG&limit=50&offset=0
   */
  public async getSlippageAnalysis(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { symbol, start_date, end_date, limit, offset, execution_id } = req.query as any;
      
      const filters: any = {};
      if (symbol) filters.symbol = String(symbol).toUpperCase();
      if (execution_id) filters.execution_id = String(execution_id);
      if (start_date) {
        const d = new Date(String(start_date));
        if (!isNaN(d.getTime())) filters.start_date = d;
      }
      if (end_date) {
        const d = new Date(String(end_date));
        if (!isNaN(d.getTime())) filters.end_date = d;
      }

      const limitNum = limit ? Math.min(Number(limit), 1000) : 100;
      const offsetNum = offset ? Number(offset) : 0;

      const analysis = await this.database.getSlippageAnalysis({
        ...filters,
        limit: limitNum,
        offset: offsetNum
      });
      
      res.json({ 
        success: true, 
        data: analysis,
        pagination: {
          limit: limitNum,
          offset: offsetNum,
          total: analysis.length
        }
      });
    } catch (error) {
      console.error('Error getting slippage analysis:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get slippage analysis', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * 创建滑点分析记录
   * POST /api/slippage/analysis
   */
  public async createSlippageAnalysis(req: express.Request, res: express.Response): Promise<void> {
    try {
      const analysisData = req.body;
      
      // 验证必要字段
      if (!analysisData.recommendation_id || !analysisData.symbol || !analysisData.direction) {
        res.status(400).json({ 
          success: false, 
          error: 'Missing required fields: recommendation_id, symbol, direction' 
        });
        return;
      }

      const result = await this.database.saveSlippageAnalysis(analysisData);
      
      res.json({ success: true, data: result });
      return;
    } catch (error) {
      console.error('Error creating slippage analysis:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to create slippage analysis', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * 获取滑点统计信息
   * GET /api/slippage/statistics?symbol=BTC-USDT&period=7d&strategy_type=...&group_by=symbol
   */
  public async getSlippageStatistics(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { symbol, period, strategy_type, group_by, start_date, end_date } = req.query as any;
      
      const filters: any = {};
      if (symbol) filters.symbol = String(symbol).toUpperCase();
      if (strategy_type) filters.strategy_type = String(strategy_type);
      if (start_date) {
        const d = new Date(String(start_date));
        if (!isNaN(d.getTime())) filters.start_date = d;
      }
      if (end_date) {
        const d = new Date(String(end_date));
        if (!isNaN(d.getTime())) filters.end_date = d;
      }

      // 获取滑点统计
      let statistics = await this.database.getSlippageStatistics(filters);
      
      // 按时间段筛选（如果指定了period）
      if (period && ['1d', '7d', '30d', '90d'].includes(String(period))) {
        const days = String(period) === '1d' ? 1 : String(period) === '7d' ? 7 : String(period) === '30d' ? 30 : 90;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        
        statistics = statistics.filter(stat => 
          new Date(stat.calculated_at) >= cutoffDate
        );
      }

      // 按指定字段分组
      if (group_by) {
        const grouped = this.groupSlippageStatistics(statistics, group_by);
        res.json({ success: true, data: grouped });
      } else {
        res.json({ success: true, data: statistics });
      }
    } catch (error) {
      console.error('Error getting slippage statistics:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get slippage statistics', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * 计算滑点统计
   * POST /api/slippage/statistics/calculate
   */
  public async calculateSlippageStatistics(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { symbol, strategy_type, start_date, end_date, force_recalculate } = req.body;
      
      const filters: any = {};
      if (symbol) filters.symbol = String(symbol).toUpperCase();
      if (strategy_type) filters.strategy_type = String(strategy_type);
      if (start_date) {
        const d = new Date(String(start_date));
        if (!isNaN(d.getTime())) filters.start_date = d;
      }
      if (end_date) {
        const d = new Date(String(end_date));
        if (!isNaN(d.getTime())) filters.end_date = d;
      }

      // 强制重新计算或定期更新
      const shouldRecalculate = force_recalculate === true || 
        Math.random() < 0.1; // 10%概率重新计算

      if (shouldRecalculate) {
        // 获取滑点分析数据
        const analysis = await this.database.getSlippageAnalysis(filters);
        
        // 按符号分组计算统计
        const symbolGroups = this.groupBySymbol(analysis);
        
        for (const [symbol, data] of Object.entries(symbolGroups)) {
          if (data.length > 0) {
            // 转换数据为 SlippageStatistics 格式
            const statsData = this.convertToSlippageStatistics(symbol, data);
            await this.database.updateSlippageStatistics(statsData);
          }
        }
      }

      // 返回最新的统计数据
      const statistics = await this.database.getSlippageStatistics(filters);
      
      res.json({ 
        success: true, 
        data: statistics,
        recalculated: shouldRecalculate
      });
    } catch (error) {
      console.error('Error calculating slippage statistics:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to calculate slippage statistics', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * 获取当前滑点阈值设置
   * GET /api/slippage/thresholds
   */
  public async getSlippageThresholds(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { symbol, strategy_type } = req.query as any;
      
      // 获取滑点统计信息
      const filters: any = {};
      if (symbol) filters.symbol = String(symbol).toUpperCase();
      if (strategy_type) filters.strategy_type = String(strategy_type);
      
      const statistics = await this.database.getSlippageStatistics(filters);
      
      // 计算建议的阈值调整
      const thresholds = this.calculateDynamicThresholds(statistics);
      
      res.json({ 
        success: true, 
        data: {
          current_thresholds: thresholds,
          statistics: statistics,
          last_updated: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Error getting slippage thresholds:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get slippage thresholds', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * 调整滑点阈值
   * POST /api/slippage/thresholds/adjust
   */
  public async adjustSlippageThresholds(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { symbol, strategy_type, adjustment_type, adjustment_factor, manual_threshold } = req.body;
      
      // 获取当前统计信息
      const filters: any = {};
      if (symbol) filters.symbol = String(symbol).toUpperCase();
      if (strategy_type) filters.strategy_type = String(strategy_type);
      
      const statistics = await this.database.getSlippageStatistics(filters);
      
      let newThresholds: any;
      let currentThresholds: any;
      
      if (manual_threshold !== undefined) {
        // 手动设置阈值
        currentThresholds = this.calculateDynamicThresholds(statistics);
        newThresholds = {
          symbol: symbol || 'ALL',
          strategy_type: strategy_type || 'ALL',
          ev_threshold: Number(manual_threshold),
          adjusted_at: new Date().toISOString(),
          adjustment_reason: 'MANUAL'
        };
      } else {
        // 自动计算阈值调整
        currentThresholds = this.calculateDynamicThresholds(statistics);
        const adjustment = adjustment_factor || this.calculateAdjustmentFactor(statistics, adjustment_type);
        
        newThresholds = {
          ...currentThresholds,
          ev_threshold: currentThresholds.ev_threshold * adjustment,
          adjusted_at: new Date().toISOString(),
          adjustment_reason: adjustment_type || 'AUTO'
        };
      }
      
      // 应用阈值限制（防止过度调整）
      const minThreshold = 0.001; // 最小0.1%
      const maxThreshold = 0.1;   // 最大10%
      newThresholds.ev_threshold = Math.max(minThreshold, Math.min(maxThreshold, newThresholds.ev_threshold));
      
      // 记录阈值调整
      await this.database.saveSlippageAnalysis({
        recommendation_id: `THRESHOLD_ADJUST_${Date.now()}`,
        symbol: newThresholds.symbol,
        direction: 'LONG', // 使用有效的方向值
        expected_price: 0,
        actual_price: 0,
        price_difference: 0,
        price_difference_bps: 0,
        execution_latency_ms: 0,
        slippage_bps: Math.round(newThresholds.ev_threshold * 10000), // 转换为基点
        slippage_category: 'MEDIUM', // 使用有效的滑点类别
        fee_rate_bps: 0,
        fee_amount: 0,
        total_cost_bps: Math.round(newThresholds.ev_threshold * 10000),
        original_threshold: Math.round(currentThresholds.ev_threshold * 10000),
        adjusted_threshold: Math.round(newThresholds.ev_threshold * 10000),
        threshold_adjustment_reason: newThresholds.adjustment_reason
      });
      
      res.json({ 
        success: true, 
        data: newThresholds,
        message: `Threshold adjusted to ${(newThresholds.ev_threshold * 100).toFixed(2)}%`
      });
    } catch (error) {
      console.error('Error adjusting slippage thresholds:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to adjust slippage thresholds', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * 获取滑点预警列表
   * GET /api/slippage/alerts
   */
  public async getSlippageAlerts(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { symbol, severity, start_date, end_date, limit, offset } = req.query as any;

      const options: any = {};
      if (symbol) options.symbol = String(symbol).toUpperCase();
      if (severity) options.severity = String(severity).toUpperCase();
      if (start_date) {
        const d = new Date(String(start_date));
        if (!isNaN(d.getTime())) options.start_date = d;
      }
      if (end_date) {
        const d = new Date(String(end_date));
        if (!isNaN(d.getTime())) options.end_date = d;
      }
      if (limit !== undefined) options.limit = Math.max(1, Math.min(500, parseInt(String(limit), 10) || 100));
      if (offset !== undefined) options.offset = Math.max(0, parseInt(String(offset), 10) || 0);

      const alerts = await this.database.getSlippageAlerts(options);
      res.json({ success: true, data: alerts });
    } catch (error) {
      console.error('Error getting slippage alerts:', error);
      res.status(500).json({ success: false, error: 'Failed to get slippage alerts', details: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  /**
   * 检测高滑点异常并（可选）持久化与自动阈值上调
   * POST /api/slippage/anomalies/detect
   */
  public async detectHighSlippageAnomalies(req: express.Request, res: express.Response): Promise<void> {
    try {
      const {
        symbol,
        period,
        threshold_bps,
        threshold,
        min_samples,
        persist = true,
        auto_adjust = true,
        adjustment_type
      } = req.body || {};

      const detectOptions: any = {};
      if (symbol) detectOptions.symbol = String(symbol).toUpperCase();
      if (period) detectOptions.period = String(period);
      const thr = threshold_bps !== undefined ? Number(threshold_bps) : (threshold !== undefined ? Number(threshold) : undefined);
      if (Number.isFinite(thr as number)) detectOptions.threshold = Number(thr);
      if (min_samples !== undefined) detectOptions.minSamples = Math.max(1, parseInt(String(min_samples), 10) || 10);

      const detection = await this.database.detectHighSlippageAnomalies(detectOptions);

      let persisted = 0;
      if (persist === true && detection.anomalies.length > 0) {
        for (const a of detection.anomalies) {
          try {
            await this.database.saveSlippageAlert({
              symbol: a.symbol,
              direction: a.direction,
              severity: a.severity,
              avg_slippage_bps: a.avg_slippage_bps,
              median_slippage_bps: a.median_slippage_bps,
              sample_count: a.sample_count,
              suggested_action: a.suggested_action,
              triggered_by: 'API_DETECT'
            });
            persisted++;
          } catch (e) {
            console.warn('Failed to persist slippage alert:', e instanceof Error ? e.message : e);
          }
        }
      }

      let thresholdsAdjusted: any = null;
      if (auto_adjust === true && detection.anomalies.length > 0) {
        try {
          const hasSevere = detection.anomalies.some(a => a.severity === 'HIGH' || a.severity === 'CRITICAL');
          const factor = this.calculateAdjustmentFactor(detection.anomalies as any[], hasSevere ? (adjustment_type || 'AGGRESSIVE') : adjustment_type);

          const current = await this.getSlippageThresholdsInternal();
          const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

          const newThresholds = {
            low_threshold: clamp((current?.low?.target ?? 0.001) * factor, 0.0001, 0.02),
            medium_threshold: clamp((current?.medium?.target ?? 0.005) * factor, 0.0005, 0.05),
            high_threshold: clamp((current?.high?.target ?? 0.01) * factor, 0.001, 0.1),
            adjustment_reason: 'AUTO_ANOMALY_DETECTED'
          } as any;

          thresholdsAdjusted = await this.adjustSlippageThresholdsInternal(newThresholds);
        } catch (e) {
          console.warn('Auto adjust thresholds failed:', e instanceof Error ? e.message : e);
        }
      }

      res.json({
        success: true,
        data: {
          anomalies: detection.anomalies,
          total_checked: detection.total_checked,
          persisted,
          thresholds_adjusted: thresholdsAdjusted
        }
      });
    } catch (error) {
      console.error('Error detecting slippage anomalies:', error);
      res.status(500).json({ success: false, error: 'Failed to detect slippage anomalies', details: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  /**
   * 按符号分组滑点统计
   */
  private groupBySymbol(analysis: any[]): { [key: string]: any[] } {
    return analysis.reduce((groups, item) => {
      const symbol = item.symbol || 'UNKNOWN';
      if (!groups[symbol]) groups[symbol] = [];
      groups[symbol].push(item);
      return groups;
    }, {} as { [key: string]: any[] });
  }

  /**
   * 分组滑点统计
   */
  private groupSlippageStatistics(statistics: any[], groupBy: string): any {
    if (groupBy === 'symbol') {
      return statistics.reduce((groups, stat) => {
        const key = stat.symbol || 'UNKNOWN';
        if (!groups[key]) groups[key] = [];
        groups[key].push(stat);
        return groups;
      }, {} as { [key: string]: any[] });
    } else if (groupBy === 'strategy_type') {
      return statistics.reduce((groups, stat) => {
        const key = stat.strategy_type || 'UNKNOWN';
        if (!groups[key]) groups[key] = [];
        groups[key].push(stat);
        return groups;
      }, {} as { [key: string]: any[] });
    }
    return statistics;
  }

  /**
   * 计算动态阈值
   */
  private calculateDynamicThresholds(statistics: any[]): any {
    if (statistics.length === 0) {
      return {
        symbol: 'ALL',
        strategy_type: 'ALL',
        ev_threshold: 0.005, // 默认0.5%
        adjusted_at: new Date().toISOString(),
        adjustment_reason: 'DEFAULT'
      };
    }

    // 计算平均滑点和标准差
    const allSlippages = statistics.flatMap(stat => {
      const slippages = [];
      if (stat.avg_slippage_bps) slippages.push(stat.avg_slippage_bps);
      if (stat.median_slippage_bps) slippages.push(stat.median_slippage_bps);
      if (stat.p95_slippage_bps) slippages.push(stat.p95_slippage_bps * 0.5); // 95分位数的50%权重
      return slippages;
    });

    if (allSlippages.length === 0) {
      return {
        symbol: statistics[0].symbol || 'ALL',
        strategy_type: statistics[0].strategy_type || 'ALL',
        ev_threshold: 0.005,
        adjusted_at: new Date().toISOString(),
        adjustment_reason: 'NO_DATA'
      };
    }

    const avgSlippage = allSlippages.reduce((sum, val) => sum + val, 0) / allSlippages.length;
    
    // 基于历史数据计算建议阈值（平均滑点 + 2倍标准差）
    const variance = allSlippages.reduce((sum, val) => sum + Math.pow(val - avgSlippage, 2), 0) / allSlippages.length;
    const stdDev = Math.sqrt(variance);
    const suggestedThreshold = (avgSlippage + 2 * stdDev) / 10000; // 转换为百分比

    return {
      symbol: statistics[0].symbol || 'ALL',
      strategy_type: statistics[0].strategy_type || 'ALL',
      ev_threshold: Math.max(0.001, Math.min(0.02, suggestedThreshold)), // 限制在0.1%-2%之间
      adjusted_at: new Date().toISOString(),
      adjustment_reason: 'DYNAMIC_CALCULATION'
    };
  }

  /**
   * 将分析数据转换为滑点统计格式
   */
  private convertToSlippageStatistics(symbol: string, analysis: any[]): any {
    if (analysis.length === 0) {
      return {
      symbol,
      direction: 'LONG',
      period: '1h',
      avg_slippage_bps: 0,
      median_slippage_bps: 0,
      p95_slippage_bps: 0,
      max_slippage_bps: 0,
      min_slippage_bps: 0,
      total_executions: 0,
      high_slippage_count: 0,
      slippage_distribution: JSON.stringify({}),
      cost_analysis: JSON.stringify({}),
      execution_quality: JSON.stringify({}),
      threshold_suggestions: JSON.stringify({}),
      calculated_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    }

    // 计算统计指标
    const slippages = analysis.map(item => item.slippage_bps || 0).sort((a, b) => a - b);
    const avgSlippage = slippages.reduce((sum, s) => sum + s, 0) / slippages.length;
    const medianSlippage = slippages[Math.floor(slippages.length / 2)];
    const p95Slippage = slippages[Math.floor(slippages.length * 0.95)];
    const maxSlippage = Math.max(...slippages);
    const minSlippage = Math.min(...slippages);
    const highSlippageCount = slippages.filter(s => s > 50).length; // 超过50基点的滑点

    // 构建分布数据
    const distribution = {
      '0-10': slippages.filter(s => s >= 0 && s <= 10).length,
      '10-25': slippages.filter(s => s > 10 && s <= 25).length,
      '25-50': slippages.filter(s => s > 25 && s <= 50).length,
      '50-100': slippages.filter(s => s > 50 && s <= 100).length,
      '100+': slippages.filter(s => s > 100).length
    };

    return {
      symbol,
      direction: analysis[0].direction || 'LONG',
      period: '1h', // 默认1小时周期
      avg_slippage_bps: Math.round(avgSlippage),
      median_slippage_bps: Math.round(medianSlippage),
      p95_slippage_bps: Math.round(p95Slippage),
      max_slippage_bps: Math.round(maxSlippage),
      min_slippage_bps: Math.round(minSlippage),
      total_executions: analysis.length,
      high_slippage_count: highSlippageCount,
      slippage_distribution: JSON.stringify(distribution),
      cost_analysis: JSON.stringify({
        total_cost: analysis.reduce((sum, item) => sum + (item.cost_impact || 0), 0),
        avg_cost_per_trade: analysis.reduce((sum, item) => sum + (item.cost_impact || 0), 0) / analysis.length
      }),
      execution_quality: JSON.stringify({
       success_rate: analysis.filter(item => item.slippage_bps < 50).length / analysis.length,
       avg_latency_ms: analysis.reduce((sum, item) => sum + (item.execution_latency_ms || 0), 0) / analysis.length
     }),
      threshold_suggestions: JSON.stringify({
        recommended_threshold: Math.round(p95Slippage * 1.2), // 建议阈值为95分位的120%
        risk_level: highSlippageCount > analysis.length * 0.1 ? 'HIGH' : 'LOW'
      }),
      calculated_at: new Date()
    };
  }

  /**
   * 计算调整因子
   */
  private calculateAdjustmentFactor(statistics: any[], adjustmentType?: string): number {
    if (statistics.length === 0) return 1.0;

    const avgSlippage = statistics.reduce((sum, stat) => {
      return sum + (stat.avg_slippage_bps || 0);
    }, 0) / statistics.length;

    // 基于平均滑点计算调整因子
    if (avgSlippage > 50) { // 滑点超过50基点
      return adjustmentType === 'AGGRESSIVE' ? 2.0 : 1.5;
    } else if (avgSlippage > 30) { // 滑点超过30基点
      return adjustmentType === 'AGGRESSIVE' ? 1.5 : 1.2;
    } else if (avgSlippage < 10) { // 滑点低于10基点
      return adjustmentType === 'CONSERVATIVE' ? 0.8 : 0.9;
    }

    return 1.0; // 默认不调整
  }

  /**
   * 获取当前滑点阈值（内部使用）
   */
  public async getSlippageThresholdsInternal(): Promise<any> {
    try {
      // 从数据库获取最新的阈值设置
      const thresholds = await this.database.getSlippageThresholds();
      
      if (!thresholds || thresholds.length === 0) {
        // 返回默认阈值
        return {
          low: { min: 0.001, max: 0.005, target: 0.003 },
          medium: { min: 0.005, max: 0.01, target: 0.007 },
          high: { min: 0.01, max: 0.02, target: 0.015 },
          last_updated: new Date().toISOString(),
          source: 'default'
        };
      }
      
      const latest = thresholds[0];
      // 数据库中的阈值是单个值，我们需要将其转换为三个级别
      const baseThreshold = latest.threshold || 0.01;
      
      return {
        low: { min: baseThreshold * 0.1, max: baseThreshold * 0.5, target: baseThreshold * 0.3 },
        medium: { min: baseThreshold * 0.5, max: baseThreshold * 1.0, target: baseThreshold * 0.7 },
        high: { min: baseThreshold * 1.0, max: baseThreshold * 2.0, target: baseThreshold * 1.5 },
        last_updated: latest.last_updated || new Date().toISOString(),
        source: 'database'
      };
    } catch (error) {
      console.error('[RecommendationAPI] Failed to get slippage thresholds:', error);
      throw error;
    }
  }

  /**
   * 调整滑点阈值（内部使用）
   */
  public async adjustSlippageThresholdsInternal(thresholdData: any): Promise<any> {
    try {
      // 验证输入数据
      const requiredFields = ['low_threshold', 'medium_threshold', 'high_threshold'];
      for (const field of requiredFields) {
        if (typeof thresholdData[field] !== 'number' || thresholdData[field] <= 0) {
          throw new Error(`Invalid ${field}: must be a positive number`);
        }
      }
      
      // 安全限制检查
      if (thresholdData.low_threshold > 0.02 || thresholdData.medium_threshold > 0.05 || thresholdData.high_threshold > 0.1) {
        throw new Error('Threshold values exceed safety limits');
      }
      
      // 保存到数据库 - 使用默认的symbol, timeframe, direction
      // 注意：saveSlippageThreshold方法需要symbol, timeframe, direction, threshold参数
      // 这里我们使用默认值，实际应用中可能需要根据具体需求调整
      const defaultSymbol = 'DEFAULT';
      const defaultTimeframe = '1h';
      const defaultDirection = 'LONG';
      
      // 保存中等阈值作为基础阈值
      await this.database.saveSlippageThreshold(
        defaultSymbol,
        defaultTimeframe,
        defaultDirection,
        thresholdData.medium_threshold
      );
      
      console.log(`[RecommendationAPI] Slippage thresholds adjusted: low=${thresholdData.low_threshold}, medium=${thresholdData.medium_threshold}, high=${thresholdData.high_threshold}`);
      
      return {
        success: true,
        thresholds: {
          low: thresholdData.low_threshold,
          medium: thresholdData.medium_threshold,
          high: thresholdData.high_threshold
        },
        adjusted_at: new Date().toISOString(),
        adjustment_reason: thresholdData.adjustment_reason
      };
    } catch (error) {
      console.error('[RecommendationAPI] Failed to adjust slippage thresholds:', error);
      throw error;
    }
  }

  /**
   * 获取滑点统计数据（内部使用）
   */
  public async getSlippageStatisticsInternal(params: any): Promise<any[]> {
    try {
      const { start_date, end_date, window = '7d', symbol, strategy_type } = params;
      
      // 构建查询条件
      const conditions: string[] = [];
      const values: any[] = [];
      
      if (start_date) {
        conditions.push('calculated_at >= ?');
        values.push(start_date);
      }
      
      if (end_date) {
        conditions.push('calculated_at <= ?');
        values.push(end_date);
      }
      
      if (symbol) {
        conditions.push('symbol = ?');
        values.push(symbol);
      }
      
      if (strategy_type) {
        conditions.push('period = ?');
        values.push(strategy_type);
      }
      
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      
      // 查询滑点统计数据 - SQLite兼容版本
      const query = `
        SELECT 
          DATE(created_at) as date,
          symbol,
          period as strategy_type,
          AVG(avg_slippage_bps) as avg_slippage_bps,
          COUNT(*) as sample_count
        FROM slippage_statistics
        ${whereClause}
        GROUP BY DATE(created_at), symbol, period
        ORDER BY date DESC
        LIMIT 100
      `;
      
      const stats = await new Promise<any[]>((resolve, reject) => {
        this.database['db']!.all(query, values, (err: any, rows: any[]) => {
          if (err) return reject(err);
          resolve(rows || []);
        });
      });
      
      // 如果没有找到数据，返回空数组
      if (!stats || stats.length === 0) {
        return [];
      }
      
      return stats.map(stat => ({
        date: stat.date,
        symbol: stat.symbol,
        strategy_type: stat.strategy_type,
        avg_slippage_bps: Number(stat.avg_slippage_bps) || 0,
        sample_count: Number(stat.sample_count) || 0
      }));
    } catch (error) {
      console.error('[RecommendationAPI] Failed to get slippage statistics:', error);
      throw error;
    }
  }

  /**
   * 执行滑点统计自动回灌
   * POST /api/slippage/backfill
   */
  public async backfillSlippageStatistics(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { 
        symbol, 
        period = '7d', 
        force = false, 
        batch_size = 1000,
        dry_run = false
      } = req.body;

      console.log(`[RecommendationAPI] Starting slippage statistics backfill: symbol=${symbol}, period=${period}, force=${force}, batch_size=${batch_size}`);

      // 执行回灌操作
      const result = await this.database.backfillSlippageStatistics({
        symbol,
        period,
        force: Boolean(force),
        batchSize: Number(batch_size)
      });

      console.log(`[RecommendationAPI] Slippage backfill completed: processed=${result.processed}, updated=${result.updated}, symbols=${result.symbols.join(',')}`);

      res.json({
        success: true,
        data: {
          processed: result.processed,
          updated: result.updated,
          symbols: result.symbols,
          dry_run: Boolean(dry_run),
          timestamp: new Date().toISOString()
        },
        message: `Successfully backfilled ${result.processed} records, updated ${result.updated} statistics`
      });
    } catch (error) {
      console.error('[RecommendationAPI] Failed to backfill slippage statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to backfill slippage statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取滑点回灌状态和历史记录
   * GET /api/slippage/backfill/history
   */
  public async getSlippageBackfillHistory(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { limit = 50, offset = 0 } = req.query as any;

      // 查询最近的滑点统计更新记录
      const query = `
        SELECT 
          symbol, 
          period, 
          COUNT(*) as record_count,
          MAX(calculated_at) as last_updated,
          AVG(avg_slippage_bps) as avg_slippage,
          AVG(confidence_score) as avg_confidence
        FROM slippage_statistics
        GROUP BY symbol, period
        ORDER BY last_updated DESC
        LIMIT ? OFFSET ?
      `;

      const history = await new Promise<any[]>((resolve, reject) => {
        this.database['db']!.all(query, [Number(limit), Number(offset)], (err: any, rows: any[]) => {
          if (err) return reject(err);
          resolve(rows || []);
        });
      });

      res.json({
        success: true,
        data: {
          history: history.map(item => ({
            symbol: item.symbol,
            period: item.period,
            record_count: Number(item.record_count),
            last_updated: item.last_updated,
            avg_slippage_bps: Number(item.avg_slippage),
            avg_confidence: Number(item.avg_confidence)
          })),
          total: history.length,
          limit: Number(limit),
          offset: Number(offset)
        }
      });
    } catch (error) {
      console.error('[RecommendationAPI] Failed to get slippage backfill history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get slippage backfill history',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * A/B测试相关方法
   */

  /**
   * 获取所有实验配置
   * GET /api/ab-testing/experiments
   */
  private async getExperiments(req: express.Request, res: express.Response): Promise<void> {
    try {
      // 获取所有实验配置
      const experiments = this.abTestingService.getAllExperiments();
      
      res.json({
        success: true,
        data: experiments
      });
    } catch (error) {
      console.error('[RecommendationAPI] Failed to get experiments:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get experiments',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 创建新实验
   * POST /api/ab-testing/experiments
   */
  private async createExperiment(req: express.Request, res: express.Response): Promise<void> {
    try {
      const experimentConfig: ABTestConfig = req.body;
      
      if (!experimentConfig || !experimentConfig.experimentId) {
        res.status(400).json({
          success: false,
          error: 'Invalid experiment configuration'
        });
        return;
      }
      
      this.abTestingService.addExperiment(experimentConfig);
      
      res.status(201).json({
        success: true,
        data: {
          experimentId: experimentConfig.experimentId,
          message: 'Experiment created successfully'
        }
      });
    } catch (error) {
      console.error('[RecommendationAPI] Failed to create experiment:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create experiment',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取特定实验配置
   * GET /api/ab-testing/experiments/:experimentId
   */
  private async getExperiment(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { experimentId } = req.params;
      
      const experiment = this.abTestingService.getExperimentConfig(experimentId);
      if (!experiment) {
        res.status(404).json({
          success: false,
          error: 'Experiment not found'
        });
        return;
      }
      
      res.json({
        success: true,
        data: experiment
      });
    } catch (error) {
      console.error('[RecommendationAPI] Failed to get experiment:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get experiment',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 为用户分配实验变体
   * POST /api/ab-testing/experiments/:experimentId/assign-variant
   */
  private async assignVariant(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { experimentId } = req.params;
      const { userId } = req.body;
      
      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'userId is required'
        });
        return;
      }
      
      const assignedVariant = this.abTestingService.assignVariant(userId, experimentId);
      const variantConfig = this.abTestingService.getVariantConfig(experimentId, assignedVariant);
      
      res.json({
        success: true,
        data: {
          userId,
          experimentId,
          variant: assignedVariant,
          variantConfig
        }
      });
    } catch (error) {
      console.error('[RecommendationAPI] Failed to assign variant:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to assign variant',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取实验分析结果
   * GET /api/ab-testing/experiments/:experimentId/analysis
   */
  private async getExperimentAnalysis(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { experimentId } = req.params;
      const { start_date, end_date } = req.query;
      
      // 获取实验相关的推荐和执行记录
      const startDate = start_date ? new Date(start_date as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 默认30天
      const endDate = end_date ? new Date(end_date as string) : new Date();
      
      // 从数据库获取推荐和执行记录
      const recommendations = await this.database.getRecommendationsByExperiment(experimentId, startDate, endDate);
      const executions = await this.database.getExecutionsByExperiment(experimentId, startDate, endDate);
      
      // 分析实验结果
      const analysis = await this.abTestingService.analyzeExperiment(experimentId, recommendations, executions);
      
      res.json({
        success: true,
        data: analysis
      });
    } catch (error) {
      console.error('[RecommendationAPI] Failed to get experiment analysis:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get experiment analysis',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取变体统计信息
   * GET /api/ab-testing/variant-stats
   */
  private async getVariantStatistics(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { experiment_id, start_date, end_date } = req.query;
      
      if (!experiment_id) {
        res.status(400).json({
          success: false,
          error: 'experiment_id is required'
        });
        return;
      }
      
      const startDate = start_date ? new Date(start_date as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = end_date ? new Date(end_date as string) : new Date();
      
      // 获取变体统计
      const stats = await this.database.getVariantStatistics(experiment_id as string, startDate, endDate);
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('[RecommendationAPI] Failed to get variant statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get variant statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取A/B测试报告
   * GET /api/ab-testing/reports
   */
  private async getABTestReports(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { experiment_id, start_date, end_date, format = 'json' } = req.query;
      
      const startDate = start_date ? new Date(start_date as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = end_date ? new Date(end_date as string) : new Date();
      
      // 获取所有实验的报告
      const reports = await this.database.getABTestReports({
        experimentId: experiment_id as string,
        startDate,
        endDate
      });
      
      if (format === 'csv') {
        // 生成CSV格式的报告
        const csv = this.generateCSVReport(reports);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="ab-test-report.csv"');
        res.send(csv);
      } else {
        res.json({
          success: true,
          data: reports
        });
      }
    } catch (error) {
      console.error('[RecommendationAPI] Failed to get A/B test reports:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get A/B test reports',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 生成CSV格式的A/B测试报告
   */
  private generateCSVReport(reports: any[]): string {
    if (reports.length === 0) {
      return 'Experiment ID,Variant,Sample Size,Win Rate,Avg Return,Avg PnL,Sharpe Ratio,Max Drawdown,Statistical Significance,P-Value\n';
    }
    
    const headers = ['Experiment ID', 'Variant', 'Sample Size', 'Win Rate', 'Avg Return', 'Avg PnL', 'Sharpe Ratio', 'Max Drawdown', 'Statistical Significance', 'P-Value'];
    const rows = reports.map(report => [
      report.experimentId,
      report.variant,
      report.sampleSize,
      report.winRate,
      report.avgReturn,
      report.avgPnL,
      report.sharpeRatio,
      report.maxDrawdown,
      report.statisticalSignificance,
      report.pValue
    ]);
    
    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  /**
   * 获取决策链列表
   * GET /api/decision-chains
   */
  private async getDecisionChainsRoute(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { limit = 50, offset = 0, symbol, status, type, start_date, end_date } = req.query;
      
      const filters: any = {};
      if (symbol) filters.symbol = symbol as string;
      if (status) filters.status = status as string;
      if (type) filters.type = type as string;
      if (start_date) filters.startDate = new Date(start_date as string);
      if (end_date) filters.endDate = new Date(end_date as string);
      
      const chains = await this.decisionChainMonitor.queryChains({
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        ...filters
      });
      
      res.json({
        success: true,
        data: chains
      });
    } catch (error) {
      console.error('[RecommendationAPI] Failed to get decision chains:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get decision chains',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取单个决策链详情
   * GET /api/decision-chains/:chainId
   */
  private async getDecisionChainRoute(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { chainId } = req.params;
      
      const chain = await this.decisionChainMonitor.getChain(chainId);
      if (!chain) {
        res.status(404).json({
          success: false,
          error: 'Decision chain not found'
        });
        return;
      }
      
      res.json({
        success: true,
        data: chain
      });
    } catch (error) {
      console.error('[RecommendationAPI] Failed to get decision chain:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get decision chain',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 重放决策链
   * GET /api/decision-chains/:chainId/replay
   */
  private async replayDecisionChainRoute(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { chainId } = req.params;
      const { include_context = true } = req.query;
      
      const replay = await this.decisionChainMonitor.replayChain(chainId, {
        includeMarketData: include_context === 'true'
      });
      
      if (!replay) {
        res.status(404).json({
          success: false,
          error: 'Decision chain not found'
        });
        return;
      }
      
      res.json({
        success: true,
        data: replay
      });
    } catch (error) {
      console.error('[RecommendationAPI] Failed to replay decision chain:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to replay decision chain',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取特定标的的决策链
   * GET /api/decision-chains/symbol/:symbol
   */
  private async getDecisionChainsBySymbolRoute(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { symbol } = req.params;
      const { limit = 20, status } = req.query;
      
      const filters: any = { symbol: symbol.toUpperCase() };
      if (status) filters.status = status as string;
      
      const chains = await this.decisionChainMonitor.queryChains({
        limit: parseInt(limit as string),
        ...filters
      });
      
      res.json({
        success: true,
        data: chains
      });
    } catch (error) {
      console.error('[RecommendationAPI] Failed to get decision chains by symbol:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get decision chains by symbol',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取最近的决策链
   * GET /api/decision-chains/recent
   */
  private async getRecentDecisionChainsRoute(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { limit = 10, type } = req.query;
      
      const filters: any = {};
      if (type) filters.type = type as string;
      
      const chains = await this.decisionChainMonitor.queryChains({
        limit: parseInt(limit as string),
        ...filters
      });
      
      res.json({
        success: true,
        data: chains
      });
    } catch (error) {
      console.error('[RecommendationAPI] Failed to get recent decision chains:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get recent decision chains',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取决策链统计信息
   * GET /api/decision-chains/stats
   */
  private async getDecisionChainStatsRoute(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { start_date, end_date, symbol, type } = req.query;
      
      const filters: any = {};
      if (start_date) filters.startDate = new Date(start_date as string);
      if (end_date) filters.endDate = new Date(end_date as string);
      if (symbol) filters.symbol = symbol as string;
      if (type) filters.type = type as string;
      
      const stats = await this.decisionChainMonitor.getMetrics();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('[RecommendationAPI] Failed to get decision chain stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get decision chain stats',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取失败的决策链
   * GET /api/decision-chains/failures
   */
  private async getFailedDecisionChainsRoute(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { limit = 20, error_type, symbol } = req.query;
      
      const filters: any = { status: 'REJECTED' };
      if (error_type) filters.errorType = error_type as string;
      if (symbol) filters.symbol = symbol as string;
      
      const chains = await this.decisionChainMonitor.queryChains({
        limit: parseInt(limit as string),
        ...filters
      });
      
      res.json({
        success: true,
        data: chains
      });
    } catch (error) {
      console.error('[RecommendationAPI] Failed to get failed decision chains:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get failed decision chains',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Public methods for testing
  public async getDecisionChains(filters?: any): Promise<any> {
    const result = await this.decisionChainMonitor.queryChains(filters || {});
    return {
      success: true,
      data: {
        chains: result.chains,
        total: result.total,
        filtered: result.filtered,
        hasMore: result.hasMore
      }
    };
  }

  public async getDecisionChain(chainId: string): Promise<any> {
    const chain = await this.decisionChainMonitor.getChain(chainId);
    return {
      success: true,
      data: chain
    };
  }

  public async replayDecisionChain(chainId: string): Promise<any> {
    const replayResult = await this.decisionChainMonitor.replayChain(chainId);
    return {
      success: true,
      data: replayResult
    };
  }

  public async getDecisionChainsBySymbol(symbol: string, filters?: any): Promise<any> {
    const queryFilters = { symbol, ...(filters || {}) };
    const result = await this.decisionChainMonitor.queryChains(queryFilters);
    return {
      success: true,
      data: {
        chains: result.chains,
        total: result.total,
        filtered: result.filtered,
        hasMore: result.hasMore
      }
    };
  }

  public async getRecentDecisionChains(filters?: any): Promise<any> {
    const queryFilters = { ...(filters || {}), limit: filters?.limit || 10 };
    const result = await this.decisionChainMonitor.queryChains(queryFilters);
    return {
      success: true,
      data: {
        chains: result.chains,
        total: result.total,
        filtered: result.filtered,
        hasMore: result.hasMore
      }
    };
  }

  public async getDecisionChainStats(filters?: any): Promise<any> {
    const metrics = await this.decisionChainMonitor.getMetrics();
    return {
      success: true,
      data: metrics
    };
  }

  public async getFailedDecisionChains(filters?: any): Promise<any> {
    const queryFilters = { finalDecision: 'REJECTED', ...(filters || {}) };
    const result = await this.decisionChainMonitor.queryChains(queryFilters);
    return {
      success: true,
      data: {
        chains: result.chains,
        total: result.total,
        filtered: result.filtered,
        hasMore: result.hasMore
      }
    };
  }

  /**
   * 获取系统决策指标
   */
  private async getSystemDecisionMetrics(req: express.Request, res: express.Response): Promise<void> {
    try {
      // 这里需要从集成服务获取指标，暂时返回模拟数据
      const metrics = {
        totalDecisions: 0,
        approvedDecisions: 0,
        rejectedDecisions: 0,
        successRate: '0%',
        timestamp: new Date().toISOString()
      };
      
      res.json(metrics);
    } catch (error) {
      console.error('Error getting system decision metrics:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  /**
   * 获取API决策指标
   */
  private async getSystemAPIDecisionMetrics(req: express.Request, res: express.Response): Promise<void> {
    try {
      const metrics = this.getAPIDecisionMetrics();
      res.json(metrics);
    } catch (error) {
      console.error('Error getting API decision metrics:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
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