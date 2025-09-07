import { RecommendationTracker, CooldownError } from './recommendation-tracker';
import { RecommendationDatabase } from './recommendation-database';
import { StatisticsCalculator } from './statistics-calculator';
import { PriceMonitor } from './price-monitor';
import { RecommendationAPI } from '../api/recommendation-api';
import { EnhancedOKXDataService } from './enhanced-okx-data-service';
import { ETHStrategyEngine } from '../strategy/eth-strategy-engine';
import { TradingSignalService } from './trading-signal-service';
import { RiskManagementService } from './risk-management-service';
import { EventEmitter } from 'events';
import { config } from '../config';

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
    this.api = new RecommendationAPI(dataService, this.database, this.tracker);
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
      
      // 自动启动自动推荐，读取配置的轮询间隔（默认15秒，失败则回退60秒）
      try {
        const { config } = await import('../config');
        const intervalMs = Number((config as any)?.strategy?.autoRecommendationIntervalMs ?? 15000);
        this.startAutoRecommendation(intervalMs);
        console.log(`Auto recommendation started with ${intervalMs}ms interval`);
      } catch (e) {
        console.warn('Failed to start auto recommendation with config, fallback to default 60000ms');
        this.startAutoRecommendation(60000);
      }

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

      // 读取配置：是否允许反向并存与最低置信度
      const { config } = await import('../config');
      const allowOpposite = (config as any)?.strategy?.allowOppositeWhileOpen === true;
      const oppositeMinConf = Number((config as any)?.strategy?.oppositeMinConfidence ?? 0.7);
      const allowAutoOnHighRisk = (config as any)?.strategy?.allowAutoOnHighRisk === true;

      // 获取当前活跃推荐
      const active = this.tracker.getActiveRecommendations();
      const hasActive = active && active.length > 0;
      const hasLong = active.some(r => r.direction === 'LONG' && r.status === 'ACTIVE');
      const hasShort = active.some(r => r.direction === 'SHORT' && r.status === 'ACTIVE');

      // 适配新版结构：recommendation 为对象，使用 action 字段
      const action = strategyResult?.recommendation?.action as string | undefined;

      // 辅助：从 strategyResult 派生方向与置信度
      const deriveDirection = (): 'LONG' | 'SHORT' | null => {
      const a = String(action || '').toUpperCase();
      if (a === 'OPEN_LONG') return 'LONG';
      if (a === 'OPEN_SHORT') return 'SHORT';
      // fallback 从信号推导
      const sig = String(strategyResult?.signal?.signal || '').toUpperCase();
      if (sig === 'STRONG_BUY' || sig === 'BUY') return 'LONG';
      if (sig === 'STRONG_SELL' || sig === 'SELL') return 'SHORT';
      return null;
      };
      const direction = deriveDirection();
      const confidence = Number(
        strategyResult?.recommendation?.confidence ||
        strategyResult?.signal?.strength?.confidence ||
        0
      );

      // 获取交易信号（使用增强后的 TradingSignalService）
      const signal = await this.signalService.generateSignal(marketData, strategyResult);

      // 风险评估
      const riskAssessment = await this.riskService.assessRisk(marketData, signal);

      // 情况A：策略明确给出开仓动作
      if (action === 'OPEN_LONG' || action === 'OPEN_SHORT') {
        if (riskAssessment.riskLevel === 'HIGH' && !allowAutoOnHighRisk) {
          console.log('Risk level too high for auto recommendation');
          return;
        }
        // 若已有同向活跃单，仍允许并存；若已有反向活跃单，尊重开关与最低置信度
        if ((hasActive && ((action === 'OPEN_LONG' && hasShort) || (action === 'OPEN_SHORT' && hasLong)))) {
          if (!allowOpposite || confidence < oppositeMinConf) {
            console.log('Opposite co-existence disabled or confidence below threshold, skip');
            return;
          }
        }
        // 构造并创建推荐
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
        const recommendationId = await this.tracker.addRecommendation(recommendation);
        this.postRecommendationToDBAPI(recommendationId, recommendation).catch(err => {
          console.warn('Sync to DB API failed (auto generation):', err?.message || err);
        });
        console.log(`Auto recommendation created: ${recommendationId}`);
        this.emit('auto_recommendation_created', { id: recommendationId, recommendation });
        return;
      }

      // 情况B：无开仓动作（如 CLOSE/REDUCE/HOLD），考虑“反向并存”触发
      if (allowOpposite && hasActive && direction && (riskAssessment.riskLevel !== 'HIGH' || allowAutoOnHighRisk)) {
        // 仅在存在反向持仓/推荐时触发
        const isOppositeToActive = (direction === 'LONG' && hasShort) || (direction === 'SHORT' && hasLong);
        if (isOppositeToActive && (signal.confidence ?? confidence) >= oppositeMinConf) {
          const recommendation = {
            symbol: 'ETH-USDT',
            direction,
            entry_price: marketData.currentPrice,
            current_price: marketData.currentPrice,
            leverage: signal.leverage || 1,
            stop_loss: signal.stopLoss,
            take_profit: signal.takeProfit,
            strategy_type: 'AUTO_OPPOSITE',
            confidence: signal.confidence ?? confidence,
            signal_strength: signal.strength ?? confidence,
            risk_level: riskAssessment.riskLevel,
            source: 'AUTO_GENERATION',
            is_strategy_generated: true,
            exclude_from_ml: false,
            status: 'PENDING' as const
          };
          const recommendationId = await this.tracker.addRecommendation(recommendation);
          this.postRecommendationToDBAPI(recommendationId, recommendation).catch(err => {
            console.warn('Sync to DB API failed (auto generation opposite):', err?.message || err);
          });
          console.log(`Auto opposite recommendation created: ${recommendationId}`);
          this.emit('auto_recommendation_created', { id: recommendationId, recommendation });
          return;
        }
      }

      console.log('No actionable recommendation from strategy engine');
      
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
      this.postRecommendationToDBAPI(recommendationId, enrichedData).catch(err => {
        console.warn('Sync to DB API failed (manual create):', err?.message || err);
      });
      this.emit('recommendation_created', { id: recommendationId, recommendation: enrichedData });
      return recommendationId;
      
    } catch (error) {
      if (error instanceof CooldownError) {
        // 交由上层(API)统一映射为 429
        throw error;
      }
      console.error('Failed to create recommendation manually:', error);
      throw error;
    }
  }
  
  /**
   * 处理策略引擎推荐
   */
  private async handleStrategyRecommendation(strategyResult: any): Promise<void> {
    try {
      // 适配新版结构：recommendation 为对象，使用 action 字段
      const action = strategyResult?.recommendation?.action as string | undefined;
      const deriveDirection = (): 'LONG' | 'SHORT' | null => {
      const a = String(action || '').toUpperCase();
      if (a === 'OPEN_LONG') return 'LONG';
      if (a === 'OPEN_SHORT') return 'SHORT';
      const sig = String(strategyResult?.signal?.signal || '').toUpperCase();
      if (sig === 'STRONG_BUY' || sig === 'BUY') return 'LONG';
      if (sig === 'STRONG_SELL' || sig === 'SELL') return 'SHORT';
      return null;
      };
      const direction = deriveDirection();
      if (!direction) return;
       
       // 获取当前市场数据
       const marketData = await this.priceMonitor.getMarketData('ETH-USDT');
       if (!marketData) {
         return;
       }
       
       // 创建推荐记录
       const recommendation = {
         symbol: 'ETH-USDT',
         direction,
         entry_price: marketData.currentPrice,
         current_price: marketData.currentPrice,
         leverage: strategyResult.leverage || 1,
         stop_loss: strategyResult.stopLoss,
         take_profit: strategyResult.takeProfit,
         strategy_type: strategyResult.strategyType || 'STRATEGY_ENGINE',
         confidence: (strategyResult?.recommendation?.confidence ?? strategyResult?.signal?.strength?.confidence ?? 0.5) as number,
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

      // 自调用环路防护：当 DB_API_URL 指向本进程所提供的 /api 时，直接跳过，避免重复插入
      try {
        const u = new URL(baseUrl);
        const webPort = parseInt(
          process.env.WEB_PORT || String((config as any)?.webServer?.port || (config as any)?.web?.port || 3001),
          10
        );
        const webHost = (process.env.WEB_HOST || (config as any)?.webServer?.host || 'localhost') as string;
        const urlPort = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80);
        const isLocalHost = ['localhost', '127.0.0.1', '0.0.0.0', webHost].includes(u.hostname);
        const samePort = urlPort === webPort;
        if (isLocalHost && samePort) {
          console.log(
            `[RecommendationIntegration] Skip posting to DB API because baseUrl=${baseUrl} points to this process (${webHost}:${webPort}).`
          );
          return;
        }
      } catch {
        // 解析失败不影响后续发送
      }
      
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
      
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Loop-Guard': '1' };
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