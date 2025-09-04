import express from 'express';
import { RecommendationTracker, RecommendationRecord } from '../services/recommendation-tracker';
import { RecommendationDatabase } from '../services/recommendation-database';
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
  
  constructor(
    dataService: EnhancedOKXDataService,
    database: RecommendationDatabase
  ) {
    this.router = express.Router();
    this.database = database;
    this.tracker = new RecommendationTracker();
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
    
    // 活跃推荐路由
    this.router.get('/active-recommendations', this.getActiveRecommendations.bind(this));
    
    // 统计信息路由
    this.router.get('/statistics/overall', this.getOverallStatistics.bind(this));
    this.router.get('/statistics/strategy/:type', this.getStrategyStatistics.bind(this));
    this.router.get('/statistics/strategies', this.getAllStrategyStatistics.bind(this));
    
    // 系统状态路由
    this.router.get('/status', this.getSystemStatus.bind(this));
    this.router.post('/tracker/start', this.startTracker.bind(this));
    this.router.post('/tracker/stop', this.stopTracker.bind(this));
    this.router.post('/cache/clear', this.clearCache.bind(this));
  }
  
  /**
   * 创建新推荐
   * POST /api/recommendations
   */
  private async createRecommendation(req: express.Request, res: express.Response): Promise<void> {
    try {
      const recommendationData = req.body;
      
      // 验证必需字段
      const requiredFields = ['symbol', 'direction', 'entry_price', 'current_price', 'leverage', 'strategy_type'];
      const missingFields = requiredFields.filter(field => !recommendationData[field]);
      
      if (missingFields.length > 0) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields',
          missing_fields: missingFields
        });
        return;
      }
      
      // 验证数据类型
      if (typeof recommendationData.entry_price !== 'number' || 
          typeof recommendationData.current_price !== 'number' ||
          typeof recommendationData.leverage !== 'number') {
        res.status(400).json({
          success: false,
          error: 'Invalid data types for price or leverage fields'
        });
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
      const recommendationId = await this.tracker.addRecommendation(recommendationData);
      
      // 新增：在创建成功后调用外部钩子（异步，不阻塞响应）
      if (this.onCreateHook) {
        Promise.resolve(this.onCreateHook(recommendationId, recommendationData)).catch(err => {
          console.warn('onCreateHook error:', err?.message || String(err));
        });
      }
      
      res.status(201).json({
        success: true,
        data: {
          id: recommendationId,
          message: 'Recommendation created successfully'
        }
      });
      
    } catch (error) {
      console.error('Error creating recommendation:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create recommendation',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 获取推荐列表
   * GET /api/recommendations?limit=100&offset=0&strategy_type=xxx&status=xxx&result=xxx
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
        end_date
      } = req.query;
      
      const filters: any = {};
      if (strategy_type) filters.strategy_type = strategy_type as string;
      if (status) filters.status = status as string;
      if (result) filters.result = result as string;
      if (start_date) filters.start_date = new Date(start_date as string);
      if (end_date) filters.end_date = new Date(end_date as string);
      
      const { recommendations, total } = await this.tracker.getRecommendationHistory(
        parseInt(limit as string),
        parseInt(offset as string),
        filters
      );
      
      res.json({
        success: true,
        data: {
          recommendations,
          total,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string)
        }
      });
      
    } catch (error) {
      console.error('Error getting recommendations:', error);
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
          data: activeRec
        });
        return;
      }
      
      // 从数据库查找
      const { recommendations } = await this.database.getRecommendationHistory(1, 0, {});
      const recommendation = recommendations.find(r => r.id === id);
      
      if (!recommendation) {
        res.status(404).json({
          success: false,
          error: 'Recommendation not found'
        });
        return;
      }
      
      res.json({
        success: true,
        data: recommendation
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
      const activeRecommendations = Array.from(this.tracker.getActiveRecommendations().values());
      
      res.json({
        success: true,
        data: {
          recommendations: activeRecommendations,
          count: activeRecommendations.length
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
            is_running: true, // TODO: 从tracker获取实际状态
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
      this.statisticsCalculator.clearAllCache();
      this.tracker.clearPrices();
      
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
}

/**
 * 创建推荐API实例的工厂函数
 */
export function createRecommendationAPI(
  dataService: EnhancedOKXDataService,
  database: RecommendationDatabase
): RecommendationAPI {
  return new RecommendationAPI(dataService, database);
}