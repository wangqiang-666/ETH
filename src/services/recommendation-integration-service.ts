import { RecommendationTracker } from './recommendation-tracker';
import { RecommendationDatabase } from './recommendation-database';
import { StatisticsCalculator } from './statistics-calculator';
import { PriceMonitor } from './price-monitor';
import { RecommendationAPI } from '../api/recommendation-api';
import { EnhancedOKXDataService } from './enhanced-okx-data-service';
import { ETHStrategyEngine } from '../strategy/eth-strategy-engine';
import { TradingSignalService } from './trading-signal-service';
import { RiskManagementService } from './risk-management-service';
import { EventEmitter } from 'events';

/**
 * 推荐系统集成服务
 * 负责整合所有推荐相关组件，提供统一的接口和生命周期管理
 */
export class RecommendationIntegrationService extends EventEmitter {
  private database: RecommendationDatabase;
  private tracker: RecommendationTracker;
  private statisticsCalculator: StatisticsCalculator;
  private priceMonitor: PriceMonitor;
  private api: RecommendationAPI;
  private dataService: EnhancedOKXDataService;
  private strategyEngine: ETHStrategyEngine;
  private signalService: TradingSignalService;
  private riskService: RiskManagementService;
  
  private isInitialized: boolean = false;
  private isRunning: boolean = false;
  private autoRecommendationEnabled: boolean = false;
  private autoRecommendationInterval: NodeJS.Timeout | null = null;
  
  constructor(
    dataService: EnhancedOKXDataService,
    strategyEngine: ETHStrategyEngine,
    signalService: TradingSignalService,
    riskService: RiskManagementService
  ) {
    super();
    
    this.dataService = dataService;
    this.strategyEngine = strategyEngine;
    this.signalService = signalService;
    this.riskService = riskService;
    
    // 初始化组件
    this.database = new RecommendationDatabase();
    this.priceMonitor = new PriceMonitor(dataService);
    this.tracker = new RecommendationTracker();
    this.statisticsCalculator = new StatisticsCalculator(this.database);
    this.api = new RecommendationAPI(dataService, this.database);
    // 注入：当通过 HTTP 创建推荐时，转发到外部数据库 API（异步，不阻塞响应）
    this.api.setOnCreateHook((id: string, data: any) => {
      return this.postRecommendationToDBAPI(id, data);
    });
    
    this.setupEventListeners();
  }
  
  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 注意：当前策略引擎和交易信号服务不支持事件监听
    // 将使用轮询方式或直接调用方式来获取推荐
    
    // 注意：推荐跟踪器和统计计算器也不支持事件监听
    // 将使用直接调用方式来处理推荐状态变化
    
    console.log('Event listeners setup completed (using polling mode)');
  }
  
  /**
   * 初始化推荐系统
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('Recommendation system already initialized');
      return;
    }
    
    try {
      console.log('Initializing recommendation system...');
      
      // 初始化数据库
      await this.database.initialize();
      console.log('Database initialized');
      
      // 统计计算器不需要初始化
    console.log('Statistics calculator ready');
      
      this.isInitialized = true;
      console.log('Recommendation system initialized successfully');
      
      this.emit('initialized');
      
    } catch (error) {
      console.error('Failed to initialize recommendation system:', error);
      throw error;
    }
  }
  
  /**
   * 启动推荐系统
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    if (this.isRunning) {
      console.log('Recommendation system already running');
      return;
    }
    
    try {
      console.log('Starting recommendation system...');
      
      // 启动推荐跟踪器
      await this.tracker.start();
      console.log('Recommendation tracker started');
      
      this.isRunning = true;
      console.log('Recommendation system started successfully');
      
      this.emit('started');
      
    } catch (error) {
      console.error('Failed to start recommendation system:', error);
      throw error;
    }
  }
  
  /**
   * 停止推荐系统
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('Recommendation system not running');
      return;
    }
    
    try {
      console.log('Stopping recommendation system...');
      
      // 停止自动推荐
      this.stopAutoRecommendation();
      
      // 停止推荐跟踪器
      await this.tracker.stop();
      console.log('Recommendation tracker stopped');
      
      this.isRunning = false;
      console.log('Recommendation system stopped successfully');
      
      this.emit('stopped');
      
    } catch (error) {
      console.error('Failed to stop recommendation system:', error);
      throw error;
    }
  }
  
  /**
   * 启动自动推荐生成
   */
  startAutoRecommendation(intervalMs: number = 60000): void {
    if (this.autoRecommendationEnabled) {
      console.log('Auto recommendation already enabled');
      return;
    }
    
    console.log(`Starting auto recommendation with ${intervalMs}ms interval`);
    
    this.autoRecommendationEnabled = true;
    this.autoRecommendationInterval = setInterval(
      this.generateAutoRecommendation.bind(this),
      intervalMs
    );
    
    this.emit('auto_recommendation_started');
  }
  
  /**
   * 停止自动推荐生成
   */
  stopAutoRecommendation(): void {
    if (!this.autoRecommendationEnabled) {
      return;
    }
    
    console.log('Stopping auto recommendation');
    
    this.autoRecommendationEnabled = false;
    if (this.autoRecommendationInterval) {
      clearInterval(this.autoRecommendationInterval);
      this.autoRecommendationInterval = null;
    }
    
    this.emit('auto_recommendation_stopped');
  }
  
  /**
   * 生成自动推荐
   */
  private async generateAutoRecommendation(): Promise<void> {
    try {
      // 获取当前市场数据
      const marketData = await this.priceMonitor.getMarketData('ETH-USDT');
      if (!marketData) {
        console.log('No market data available for auto recommendation');
        return;
      }
      
      // 运行策略分析
      const strategyResult = await this.strategyEngine.analyzeMarket();
      // 适配新版结构：recommendation 为对象，使用 action 字段
      if (!strategyResult || !strategyResult.recommendation || strategyResult.recommendation.action === 'HOLD') {
        console.log('No actionable recommendation from strategy engine');
        return;
      }

      // 仅在出现开仓机会时自动生成推荐，其它动作（如减仓/平仓）跳过
      const action = strategyResult.recommendation.action;
      if (action !== 'OPEN_LONG' && action !== 'OPEN_SHORT') {
        console.log(`Skip auto recommendation for non-open action: ${action}`);
        return;
      }
      
      // 获取交易信号
      const signal = await this.signalService.generateSignal(marketData, strategyResult);
      if (!signal || signal.confidence < 0.6) {
        console.log('Signal confidence too low for auto recommendation');
        return;
      }
      
      // 风险评估
      const riskAssessment = await this.riskService.assessRisk(marketData, signal);
      if (riskAssessment.riskLevel === 'HIGH') {
        console.log('Risk level too high for auto recommendation');
        return;
      }
      
      // 创建推荐记录
      const recommendation = {
        symbol: 'ETH-USDT',
        direction: action === 'OPEN_LONG' ? 'LONG' : 'SHORT' as 'LONG' | 'SHORT',
        entry_price: marketData.currentPrice,
        current_price: marketData.currentPrice,
        leverage: signal.leverage || 1,
        stop_loss: signal.stopLoss,
        take_profit: signal.takeProfit,
        strategy_type: 'AUTO',
        confidence: signal.confidence,
        signal_strength: signal.strength,
        risk_level: riskAssessment.riskLevel,
        source: 'AUTO_GENERATION',
        is_strategy_generated: true,
        exclude_from_ml: false,
        status: 'PENDING' as const
      };
      
      // 添加推荐到跟踪器
      const recommendationId = await this.tracker.addRecommendation(recommendation);
      
      // 将推荐同步写入本地数据库API（异步，不阻塞主流程）
      this.postRecommendationToDBAPI(recommendationId, recommendation).catch(err => {
        console.warn('Sync to DB API failed (auto generation):', err?.message || err);
      });
      
      console.log(`Auto recommendation created: ${recommendationId}`);
      this.emit('auto_recommendation_created', { id: recommendationId, recommendation });
      
    } catch (error) {
      console.error('Failed to generate auto recommendation:', error);
      this.emit('auto_recommendation_error', error);
    }
  }
  
  /**
   * 手动创建推荐
   */
  async createRecommendation(recommendationData: any): Promise<string> {
    if (!this.isRunning) {
      throw new Error('Recommendation system is not running');
    }
    
    try {
      // 添加来源标识
      const enrichedData = {
        ...recommendationData,
        source: recommendationData.source || 'MANUAL',
        is_strategy_generated: false,
        exclude_from_ml: recommendationData.exclude_from_ml || false
      };
      
      const recommendationId = await this.tracker.addRecommendation(enrichedData);
      
      // 将推荐同步写入本地数据库API（异步，不阻塞主流程）
      this.postRecommendationToDBAPI(recommendationId, enrichedData).catch(err => {
        console.warn('Sync to DB API failed (manual create):', err?.message || err);
      });
      
      this.emit('recommendation_created', { id: recommendationId, recommendation: enrichedData });
      
      return recommendationId;
      
    } catch (error) {
      console.error('Error creating recommendation:', error);
      throw error;
    }
  }
  
  /**
   * 处理策略引擎推荐
   */
  private async handleStrategyRecommendation(strategyResult: any): Promise<void> {
    try {
      if (strategyResult.recommendation === 'HOLD') {
        return;
      }
      
      // 获取当前市场数据
      const marketData = await this.priceMonitor.getMarketData('ETH-USDT');
      if (!marketData) {
        return;
      }
      
      // 创建推荐记录
      const recommendation = {
        symbol: 'ETH-USDT',
        direction: strategyResult.recommendation as 'LONG' | 'SHORT',
        entry_price: marketData.currentPrice,
        current_price: marketData.currentPrice,
        leverage: strategyResult.leverage || 1,
        stop_loss: strategyResult.stopLoss,
        take_profit: strategyResult.takeProfit,
        strategy_type: strategyResult.strategyType || 'STRATEGY_ENGINE',
        confidence: strategyResult.confidence || 0.5,
        signal_strength: strategyResult.strength || 0.5,
        source: 'STRATEGY_ENGINE',
        is_strategy_generated: true,
        exclude_from_ml: false
      };
      
      await this.createRecommendation(recommendation);
      
    } catch (error) {
      console.error('Error handling strategy recommendation:', error);
    }
  }
  
  /**
   * 处理交易信号
   */
  private async handleTradingSignal(signal: any): Promise<void> {
    try {
      if (!signal.action || signal.action === 'HOLD') {
        return;
      }
      
      // 获取当前市场数据
      const marketData = await this.priceMonitor.getMarketData('ETH-USDT');
      if (!marketData) {
        return;
      }
      
      // 创建推荐记录
      const recommendation = {
        symbol: 'ETH-USDT',
        direction: signal.action as 'LONG' | 'SHORT',
        entry_price: marketData.currentPrice,
        current_price: marketData.currentPrice,
        leverage: signal.leverage || 1,
        stop_loss: signal.stopLoss,
        take_profit: signal.takeProfit,
        strategy_type: 'TRADING_SIGNAL',
        confidence: signal.confidence || 0.5,
        signal_strength: signal.strength || 0.5,
        source: 'TRADING_SIGNAL_SERVICE',
        is_strategy_generated: true,
        exclude_from_ml: false
      };
      
      await this.createRecommendation(recommendation);
      
    } catch (error) {
      console.error('Error handling trading signal:', error);
    }
  }
  
  /**
   * 处理推荐关闭事件
   */
  private handleRecommendationClosed(data: any): void {
    console.log(`Recommendation closed: ${data.id}, Result: ${data.result}`);
    this.emit('recommendation_result', data);
  }
  
  /**
   * 处理推荐触发事件
   */
  private handleRecommendationTriggered(data: any): void {
    console.log(`Recommendation triggered: ${data.id}, Type: ${data.triggerType}`);
    this.emit('recommendation_triggered', data);
  }
  
  /**
   * 处理统计更新事件
   */
  private handleStatisticsUpdated(statistics: any): void {
    this.emit('statistics_updated', statistics);
  }
  
  /**
   * 获取系统状态
   */
  getSystemStatus(): any {
    return {
      initialized: this.isInitialized,
      running: this.isRunning,
      auto_recommendation_enabled: this.autoRecommendationEnabled,
      components: {
        database: this.database ? 'initialized' : 'not_initialized',
        tracker: this.tracker ? 'initialized' : 'not_initialized',
        statistics_calculator: this.statisticsCalculator ? 'initialized' : 'not_initialized',
        price_monitor: this.priceMonitor ? 'initialized' : 'not_initialized',
        api: this.api ? 'initialized' : 'not_initialized'
      }
    };
  }
  
  /**
   * 获取API路由器
   */
  getAPIRouter(): any {
    return this.api.getRouter();
  }
  
  /**
   * 获取推荐跟踪器
   */
  getTracker(): RecommendationTracker {
    return this.tracker;
  }
  
  /**
   * 获取统计计算器
   */
  getStatisticsCalculator(): StatisticsCalculator {
    return this.statisticsCalculator;
  }
  
  /**
   * 获取数据库实例
   */
  getDatabase(): RecommendationDatabase {
    return this.database;
  }
  
  /**
   * 获取价格监控器
   */
  getPriceMonitor(): PriceMonitor {
    return this.priceMonitor;
  }

  /**
   * 将推荐记录推送到外部数据库API服务
   * - 默认指向 http://localhost:3001，可用环境变量 DB_API_URL 覆盖
   * - 默认指向 http://localhost:3001，可用环境变量 DB_API_URL 覆盖
   * - 如需鉴权，在数据库API进程设置 API_SECRET_KEY，并在本进程设置 DB_API_KEY 一致
   */
  private async postRecommendationToDBAPI(recommendationId: string, data: any): Promise<void> {
    try {
      const fetchFn: any = (globalThis as any).fetch;
      if (!fetchFn) {
        console.warn('Global fetch not available, skip posting to DB API');
        return;
      }
      const baseUrl = process.env.DB_API_URL || 'http://localhost:3001';
      const apiKey = process.env.DB_API_KEY;
      
      // 字段映射到数据库API所需的字段
      const payload: any = {
        id: recommendationId,
        symbol: data.symbol,
        direction: data.direction,
        entry_price: data.entry_price,
        current_price: data.current_price ?? data.entry_price,
        leverage: data.leverage ?? 1,
        strategy_type: data.strategy_type ?? 'UNKNOWN',
        // 兼容不同命名
        algorithm_name: data.algorithm_name,
        signal_strength: data.signal_strength ?? data.signal_strength,
        confidence_score: data.confidence ?? data.confidence_score,
        stop_loss_price: data.stop_loss_price ?? data.stop_loss,
        take_profit_price: data.take_profit_price ?? data.take_profit,
        position_size: data.position_size,
        risk_level: data.risk_level,
        market_volatility: data.market_volatility,
        volume_24h: data.volume_24h,
        price_change_24h: data.price_change_24h,
        notes: data.notes
      };
      
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['X-API-Key'] = String(apiKey);
      
      const resp = await fetchFn(`${baseUrl}/api/recommendations`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`DB API responded ${resp.status}: ${text}`);
      }
    } catch (error: any) {
      console.warn('postRecommendationToDBAPI error:', error?.message || String(error));
    }
  }
}

/**
 * 创建推荐系统集成服务的工厂函数
 */
export function createRecommendationIntegrationService(
  dataService: EnhancedOKXDataService,
  strategyEngine: ETHStrategyEngine,
  signalService: TradingSignalService,
  riskService: RiskManagementService
): RecommendationIntegrationService {
  return new RecommendationIntegrationService(
    dataService,
    strategyEngine,
    signalService,
    riskService
  );
}