import { RecommendationTracker, CooldownError, OppositeConstraintError, ExposureLimitError, ExposureCapError, MTFConsistencyError } from './recommendation-tracker.js';
import { RecommendationDatabase, ExecutionRecord } from './recommendation-database.js';
import { StatisticsCalculator } from './statistics-calculator.js';
import { PriceMonitor } from './price-monitor.js';
import { RecommendationAPI } from '../api/recommendation-api.js';
import { EnhancedOKXDataService } from './enhanced-okx-data-service.js';
import { ETHStrategyEngine } from '../strategy/eth-strategy-engine.js';
import { TradingSignalService } from './trading-signal-service.js';
import { RiskManagementService } from './risk-management-service.js';
import { DecisionChainMonitor } from './decision-chain-monitor.js';
import { Mutex } from '../utils/mutex.js';
import { EventEmitter } from 'events';
import { config } from '../config.js';

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
  private decisionChainMonitor: DecisionChainMonitor;
  
  // 并发控制
  private readonly recommendationMutex = new Mutex();
  private readonly autoRecommendationMutex = new Mutex();
  
  // 新增：维护策略持仓与推荐记录的映射
  private positionToRecommendation: Map<string, string> = new Map();
  private isInitialized: boolean = false;
  private isRunning: boolean = false;
  private autoRecommendationEnabled: boolean = false;
  private autoRecommendationInterval: NodeJS.Timeout | null = null;
  
  // 新增：决策链路透明化相关属性
  private decisionMetrics = {
    totalDecisions: 0,
    approvedDecisions: 0,
    rejectedDecisions: 0,
    rejectionReasons: {} as Record<string, number>,
    gatingStages: {
      signalCollection: { approved: 0, rejected: 0 },
      gatingCheck: { approved: 0, rejected: 0 },
      cooldownCheck: { approved: 0, rejected: 0 },
      riskAssessment: { approved: 0, rejected: 0 },
      executionDecision: { approved: 0, rejected: 0 }
    }
  };

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
    this.decisionChainMonitor = new DecisionChainMonitor(this.database);
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
    // 订阅策略引擎事件，桥接到推荐系统
    try {
      // 开仓 -> 创建推荐记录并建立映射
      this.strategyEngine.on('position-opened', async (payload: any) => {
        try {
          const position = payload?.position;
          if (!position?.positionId) return;
          const recInput = {
            symbol: position.symbol || config.trading.defaultSymbol,
            direction: position.side,
            entry_price: position.entryPrice,
            current_price: position.currentPrice || position.entryPrice,
            leverage: position.leverage || 1,
            stop_loss_price: position.stopLoss,
            take_profit_price: position.takeProfit,
            position_size: position.size,
            risk_level: payload?.riskAssessment?.riskLevel,
            strategy_type: 'ETH_STRATEGY_ENGINE',
            algorithm_name: payload?.strategyResult?.signal?.algorithm || payload?.strategyResult?.strategyName,
            confidence_score: payload?.strategyResult?.recommendation?.confidence || payload?.strategyResult?.signal?.strength?.confidence,
            signal_strength: payload?.strategyResult?.signal?.strength,
            source: 'STRATEGY_ENGINE',
            is_strategy_generated: true,
            exclude_from_ml: false,
            // 确保从策略结果中获取止盈止损价格
            stop_loss: payload?.strategyResult?.riskManagement?.stopLoss || position.stopLoss,
            take_profit: payload?.strategyResult?.riskManagement?.takeProfit || position.takeProfit,
            confidence: payload?.strategyResult?.recommendation?.confidence || payload?.strategyResult?.signal?.strength?.confidence
          } as any;
          const recommendationId = await this.tracker.addRecommendation(recInput);
          this.positionToRecommendation.set(position.positionId, recommendationId);
          this.emit('recommendation_created_from_position', { positionId: position.positionId, recommendationId });
          // 新增：保存开仓执行记录
          await this.recordExecution('OPEN', payload, { recId: recommendationId });
        } catch (e) {
          console.error('[Integration] failed to create recommendation from position-opened:', e);
        }
      });

      console.log('Event listeners setup completed (strategy engine events subscribed)');
    } catch (e) {
      console.warn('Failed to attach strategy engine listeners, fallback to polling mode:', e);
      console.log('Event listeners setup completed (using polling mode)');
    }
   }
  
  // 新增：统一记录执行的方法
  private async recordExecution(
    eventType: 'OPEN' | 'CLOSE' | 'REDUCE',
    payload: any,
    opts?: { recId?: string }
  ): Promise<void> {
    try {
      const position = payload?.position;
      if (!position?.positionId) return;
      const trade = payload?.trade;
      const recommendationId = opts?.recId || this.positionToRecommendation.get(position.positionId) || null;

      const commission = Number(((config as any)?.commission) ?? 0.001);
      const feeBps = Math.round(commission * 10000);

      // 公共字段
      const symbol: string = position.symbol || (config as any)?.trading?.defaultSymbol || 'ETH-USDT-SWAP';
      const direction: 'LONG' | 'SHORT' = position.side;

      let fill_price: number | null = null;
      let fill_timestamp: number | null = null;
      let size: number | null = null;
      let intended_timestamp: number | null = null;
      let intended_price: number | null = null;
      let pnl_amount: number | null = null;
      let pnl_percent: number | null = null;

      if (eventType === 'OPEN') {
        fill_price = Number(position.entryPrice);
        fill_timestamp = Number(position.timestamp);
        size = Number(position.size);
        intended_timestamp = Number(payload?.strategyResult?.signal?.metadata?.timestamp) || null;
        // 暂无独立意向价来源，默认以入场价作为意向价（滑点=0），后续可接入下单前报价
        intended_price = fill_price;
      } else if (eventType === 'CLOSE' || eventType === 'REDUCE') {
        if (!trade) return;
        fill_price = Number(trade.price);
        fill_timestamp = Number(trade.timestamp);
        size = Number(trade.size);
        intended_timestamp = Number(trade?.strategySignal?.metadata?.timestamp) || null;
        // 暂无独立意向价来源，默认以成交价作为意向价（滑点=0）
        intended_price = fill_price;
        pnl_amount = typeof trade.pnl === 'number' ? Number(trade.pnl) : null;
        pnl_percent = typeof trade.pnlPercent === 'number' ? Number(trade.pnlPercent) : null;
      }

      const latency_ms = intended_timestamp && fill_timestamp ? Math.max(0, fill_timestamp - intended_timestamp) : null;

      let slippage_amount: number | null = null;
      let slippage_bps: number | null = null;
      if (typeof fill_price === 'number' && typeof intended_price === 'number' && isFinite(fill_price) && isFinite(intended_price) && intended_price > 0) {
        slippage_amount = fill_price - intended_price;
        slippage_bps = (slippage_amount / intended_price) * 10000;
      }

      const fee_amount = (typeof size === 'number' && typeof fill_price === 'number') ? Math.abs(size) * fill_price * commission : null;

      const extra = {
        source: 'STRATEGY_ENGINE',
        reason: payload?.reason,
        positionId: position.positionId
      } as any;

      const exe: ExecutionRecord = {
        created_at: new Date(),
        updated_at: new Date(),
        recommendation_id: recommendationId,
        position_id: position.positionId,
        event_type: eventType,
        symbol,
        direction,
        size,
        intended_price,
        intended_timestamp,
        fill_price,
        fill_timestamp,
        latency_ms,
        slippage_bps,
        slippage_amount,
        fee_bps: feeBps,
        fee_amount,
        pnl_amount,
        pnl_percent,
        extra_json: JSON.stringify(extra)
      };

      try {
        await this.database.saveExecution(exe);
      } catch (err: any) {
        if (err && /Database not initialized/i.test(String(err.message || err))) {
          try {
            await this.database.initialize();
            await this.database.saveExecution(exe);
          } catch (e2) {
            console.error('[Integration] saveExecution retry failed:', e2);
          }
        } else {
          console.error('[Integration] saveExecution failed:', err);
        }
      }
    } catch (e) {
      console.warn('[Integration] recordExecution error:', (e as any)?.message || String(e));
    }
  }
  
  /**
   * 增强的决策链路跟踪方法
   */
  private async trackDecisionChain(
    source: string,
    symbol: string,
    direction: 'LONG' | 'SHORT' | undefined,
    payload: any
  ): Promise<string> {
    const chainId = `${source}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 启动决策链并记录初始状态
    this.decisionChainMonitor.startChain({
      symbol,
      direction,
      source: source as any,
      metadata: {
        timestamp: new Date().toISOString(),
        currentPrice: payload?.currentPrice || payload?.entry_price,
        confidence: payload?.confidence,
        signalStrength: payload?.signal_strength,
        riskLevel: payload?.risk_level,
        leverage: payload?.leverage
      }
    });

    // 记录信号采集阶段
    await this.decisionChainMonitor.addDecisionStep(chainId, {
      stage: 'SIGNAL_COLLECTION',
      decision: 'APPROVED',
      reason: 'Signal data collected successfully',
      details: {
        source,
        symbol,
        direction,
        marketData: {
          currentPrice: payload?.currentPrice || payload?.entry_price,
          volume: payload?.volume,
          volatility: payload?.volatility
        },
        signalData: {
          confidence: payload?.confidence,
          strength: payload?.signal_strength,
          algorithm: payload?.algorithm_name,
          strategyType: payload?.strategy_type
        },
        timestamp: new Date().toISOString()
      },
      metadata: {
        symbol,
        direction,
        currentPrice: payload?.currentPrice || payload?.entry_price,
        confidenceScore: payload?.confidence,
        signalStrength: payload?.signal_strength
      }
    });

    this.decisionMetrics.totalDecisions++;
    this.decisionMetrics.gatingStages.signalCollection.approved++;

    return chainId;
  }

  /**
   * 记录门控检查决策
   */
  private async recordGatingDecision(
    chainId: string,
    stage: 'GATING_CHECK' | 'COOLDOWN_CHECK' | 'RISK_ASSESSMENT',
    decision: 'APPROVED' | 'REJECTED',
    reason: string,
    details: Record<string, any>,
    error?: any
  ): Promise<void> {
    await this.decisionChainMonitor.addDecisionStep(chainId, {
      stage,
      decision,
      reason,
      details: {
        ...details,
        timestamp: new Date().toISOString(),
        errorType: error?.constructor?.name,
        errorMessage: error?.message,
        // 记录关键决策变量
        decisionVariables: {
          activeRecommendations: this.tracker.getActiveRecommendations()?.length || 0,
          cooldownStatus: details.cooldownStatus,
          riskLevel: details.riskLevel,
          exposureLimit: details.exposureLimit,
          netExposure: details.netExposure,
          hourlyOrderCount: details.hourlyOrderCount,
          mtfConsistency: details.mtfConsistency
        }
      }
    });

    // 更新统计指标
    if (decision === 'APPROVED') {
      this.decisionMetrics.approvedDecisions++;
      this.decisionMetrics.gatingStages[stage === 'GATING_CHECK' ? 'gatingCheck' : 
                                       stage === 'COOLDOWN_CHECK' ? 'cooldownCheck' : 'riskAssessment'].approved++;
    } else {
      this.decisionMetrics.rejectedDecisions++;
      this.decisionMetrics.gatingStages[stage === 'GATING_CHECK' ? 'gatingCheck' : 
                                       stage === 'COOLDOWN_CHECK' ? 'cooldownCheck' : 'riskAssessment'].rejected++;
      
      // 记录拒绝原因统计
      if (!this.decisionMetrics.rejectionReasons[reason]) {
        this.decisionMetrics.rejectionReasons[reason] = 0;
      }
      this.decisionMetrics.rejectionReasons[reason]++;
    }

    // 发出决策事件，供监控面板使用
    this.emit('decision_recorded', {
      chainId,
      stage,
      decision,
      reason,
      details,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 记录执行决策
   */
  private async recordExecutionDecision(
    chainId: string,
    decision: 'APPROVED' | 'REJECTED',
    reason: string,
    details: Record<string, any>
  ): Promise<void> {
    await this.decisionChainMonitor.addDecisionStep(chainId, {
      stage: 'EXECUTION_DECISION',
      decision,
      reason,
      details: {
        ...details,
        timestamp: new Date().toISOString(),
        executionContext: {
          systemLoad: process.memoryUsage(),
          activeConnections: details.activeConnections,
          marketConditions: details.marketConditions
        }
      }
    });

    if (decision === 'APPROVED') {
      this.decisionMetrics.gatingStages.executionDecision.approved++;
    } else {
      this.decisionMetrics.gatingStages.executionDecision.rejected++;
      if (!this.decisionMetrics.rejectionReasons[reason]) {
        this.decisionMetrics.rejectionReasons[reason] = 0;
      }
      this.decisionMetrics.rejectionReasons[reason]++;
    }
  }

  /**
   * 获取决策链路统计信息
   */
  public getDecisionMetrics(): any {
    return {
      ...this.decisionMetrics,
      successRate: this.decisionMetrics.totalDecisions > 0 
        ? (this.decisionMetrics.approvedDecisions / this.decisionMetrics.totalDecisions * 100).toFixed(2) + '%'
        : '0%',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 重置决策统计
   */
  public resetDecisionMetrics(): void {
    this.decisionMetrics = {
      totalDecisions: 0,
      approvedDecisions: 0,
      rejectedDecisions: 0,
      rejectionReasons: {},
      gatingStages: {
        signalCollection: { approved: 0, rejected: 0 },
        gatingCheck: { approved: 0, rejected: 0 },
        cooldownCheck: { approved: 0, rejected: 0 },
        riskAssessment: { approved: 0, rejected: 0 },
        executionDecision: { approved: 0, rejected: 0 }
      }
    };
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
        const { config } = await import('../config.js');
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
   * 生成自动推荐（使用互斥锁保护）
   */
  private async generateAutoRecommendation(): Promise<void> {
    // 使用互斥锁确保自动推荐生成的原子性
    return await this.autoRecommendationMutex.runExclusive(async () => {
      return await this.generateAutoRecommendationInternal();
    });
  }

  /**
   * 自动推荐生成的内部实现
   */
  private async generateAutoRecommendationInternal(): Promise<void> {
    const chainId = `AUTO_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // 启动决策链
      this.decisionChainMonitor.startChain(chainId, config.trading.defaultSymbol, 'AUTO');
      
      // 获取当前市场数据（使用默认交易对）
      const marketData = await this.priceMonitor.getMarketData(config.trading.defaultSymbol);
      if (!marketData) {
        this.decisionChainMonitor.addDecisionStep(chainId, {
          stage: 'SIGNAL_COLLECTION',
          decision: 'REJECTED',
          reason: 'No market data available',
          details: {}
        });
        this.decisionChainMonitor.finalizeChain(chainId);
        console.log('No market data available for auto recommendation');
        return;
      }
      
      this.decisionChainMonitor.addDecisionStep(chainId, {
        stage: 'SIGNAL_COLLECTION',
        decision: 'APPROVED',
        reason: 'Market data collected',
        details: {
          currentPrice: marketData.currentPrice,
          volume24h: marketData.volume24h,
          priceChange24h: marketData.priceChange24h
        }
      });
      
      // 运行策略分析
      const strategyResult = await this.strategyEngine.analyzeMarket();
      
      if (!strategyResult) {
        this.decisionChainMonitor.addDecisionStep(chainId, {
          stage: 'SIGNAL_COLLECTION',
          decision: 'REJECTED',
          reason: 'Strategy analysis returned no result',
          details: {}
        });
        this.decisionChainMonitor.finalizeChain(chainId);
        console.log('Strategy analysis returned no result');
        return;
      }
      
      this.decisionChainMonitor.addDecisionStep(chainId, {
        stage: 'SIGNAL_COLLECTION',
        decision: 'APPROVED',
        reason: 'Strategy analysis completed',
        details: {
          action: strategyResult.recommendation?.action,
          confidence: strategyResult.recommendation?.confidence,
          signal: strategyResult.signal?.signal
        }
      });

      // 读取配置：是否允许反向并存与最低置信度
      const allowOpposite = config.strategy?.allowOppositeWhileOpen === true;
      const oppositeMinConf = Number(config.strategy?.oppositeMinConfidence ?? 0.7);
      const allowAutoOnHighRisk = config.strategy?.allowAutoOnHighRisk === true;

      // 获取当前活跃推荐
      const active = this.tracker.getActiveRecommendations();
      const hasActive = active && active.length > 0;
      const nowTs = Date.now();
      const concurrencyAgeHours = Number((config as any)?.recommendation?.concurrencyCountAgeHours ?? 24);
      const countCandidates = Array.isArray(active)
        ? active.filter(r => r.status === 'ACTIVE' && (
            // 若配置<=0，则不过滤，全部计入；否则仅统计未超过窗口的推荐
            concurrencyAgeHours <= 0 || ((nowTs - r.created_at.getTime()) / (1000 * 60 * 60) < concurrencyAgeHours)
          ))
        : [];
      const hasLong = countCandidates.some(r => r.direction === 'LONG');
      const hasShort = countCandidates.some(r => r.direction === 'SHORT');
      const maxSameDir = Number((config as any)?.risk?.maxSameDirectionActives ?? 2);
      const longCount = countCandidates.filter(r => r.direction === 'LONG').length;
      const shortCount = countCandidates.filter(r => r.direction === 'SHORT').length;

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
      if (!direction) return;
      
      // 创建推荐记录
      const recommendation = {
        symbol: config.trading.defaultSymbol,
        direction,
        entry_price: marketData.currentPrice,
        current_price: marketData.currentPrice,
        leverage: strategyResult.riskManagement?.leverage || 1,
        stop_loss_price: strategyResult.riskManagement?.stopLoss, // 修复：使用正确的字段名
        take_profit_price: strategyResult.riskManagement?.takeProfit, // 修复：使用正确的字段名
        strategy_type: 'STRATEGY_ENGINE',
        confidence_score: strategyResult.recommendation?.confidence || 0.5, // 修复：使用正确的字段名
        signal_strength: strategyResult.signal?.strength || 0.5,
        source: 'STRATEGY_ENGINE',
        is_strategy_generated: true,
        exclude_from_ml: false,
        // 透传 EV 相关字段（兼容不同命名）
        expected_return: strategyResult?.performance?.expectedReturn ?? strategyResult?.gating?.ev,
        ev: strategyResult?.gating?.ev ?? strategyResult?.performance?.expectedReturn,
        ev_threshold: strategyResult?.gating?.evThreshold,
        ev_ok: strategyResult?.gating?.evOk
      };
      
      // 添加决策链监控
      const strategyChainId = `STRATEGY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.decisionChainMonitor.startChain(strategyChainId, config.trading.defaultSymbol, 'STRATEGY_ENGINE');
      
      await this.decisionChainMonitor.addDecisionStep(strategyChainId, {
        stage: 'EXECUTION_DECISION',
        decision: 'PENDING',
        reason: 'Creating recommendation record',
        details: { status: 'IN_PROGRESS' }
      });
      
      try {
        const recommendationId = await this.tracker.addRecommendation(recommendation);
        await this.decisionChainMonitor.addDecisionStep(strategyChainId, {
          stage: 'EXECUTION_DECISION',
          decision: 'APPROVED',
          reason: 'Recommendation created successfully',
          details: { recommendationId }
        });
        await this.decisionChainMonitor.finalizeChain(strategyChainId);
      } catch (error) {
        await this.decisionChainMonitor.addDecisionStep(strategyChainId, {
          stage: 'EXECUTION_DECISION',
          decision: 'REJECTED',
          reason: 'Failed to create recommendation',
          details: { error: (error as any)?.message }
        });
        await this.decisionChainMonitor.finalizeChain(strategyChainId);
        throw error;
      }
      
    } catch (error) {
      if (
        error instanceof CooldownError ||
        error instanceof OppositeConstraintError ||
        error instanceof ExposureLimitError
      ) {
        try {
          const chainId = `STRATEGY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          this.decisionChainMonitor.startChain(chainId, config.trading.defaultSymbol, 'STRATEGY_ENGINE');
          await this.logGatingDecision('STRATEGY_ENGINE', null, error, chainId);
          // 记录决策链中的门控决策
          await this.decisionChainMonitor.addDecisionStep(chainId, {
            stage: 'GATING_CHECK',
            decision: 'REJECTED',
            reason: 'Recommendation gated by system',
            details: {
              errorType: error.constructor.name,
              errorMessage: (error as any)?.message
            }
          });
          await this.decisionChainMonitor.finalizeChain(chainId);
        } catch {}
        console.warn('[Integration] Strategy recommendation gated:', (error as any)?.message || String(error));
        return;
      }
      console.error('Error handling strategy recommendation:', error);
      // 记录系统错误到决策链
      const chainId = `STRATEGY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.decisionChainMonitor.startChain(chainId, config.trading.defaultSymbol, 'STRATEGY_ENGINE');
      await this.decisionChainMonitor.addDecisionStep(chainId, {
        stage: 'GATING_CHECK',
        decision: 'REJECTED',
        reason: 'System error during recommendation processing',
        details: {
          error: (error as any)?.message
        }
      });
      await this.decisionChainMonitor.finalizeChain(chainId);
    }
  }

  getSystemStatus(): any {
    return {
      initialized: this.isInitialized,
      running: this.isRunning,
      autoRecommendationEnabled: this.autoRecommendationEnabled,
      components: {
        database: this.database ? 'initialized' : 'not initialized',
        tracker: this.tracker ? 'initialized' : 'not initialized',
        statisticsCalculator: this.statisticsCalculator ? 'initialized' : 'not initialized',
        priceMonitor: this.priceMonitor ? 'initialized' : 'not initialized',
        api: this.api ? 'initialized' : 'not initialized'
      },
      decisionMetrics: this.getDecisionMetrics()
    };
  }
  
  getAPIRouter(): any {
    return this.api.getRouter();
  }
  
  getTracker(): RecommendationTracker {
    return this.tracker;
  }
  
  getStatisticsCalculator(): StatisticsCalculator {
    return this.statisticsCalculator;
  }
  
  getDatabase(): RecommendationDatabase {
    return this.database;
  }
  
  getPriceMonitor(): PriceMonitor {
    return this.priceMonitor;
  }
  
  private async logGatingDecision(source: string, payload: any, error: any, chainId?: string): Promise<void> {
    // 实现门控决策日志记录
    console.log(`[Gating Decision] Source: ${source}, Error: ${error?.message}`);
  }

  private async postRecommendationToDBAPI(recommendationId: string, data: any): Promise<void> {
    // 实现推荐数据发送到外部API
    console.log(`[DB API] Posting recommendation ${recommendationId}`);
  }

  /**
   * 记录滑点分析结果
   * 支持两种调用方式：
   * 1. 直接传入分析数据对象
   * 2. 传入推荐信息和执行数据两个参数（兼容测试用例）
   */
  public async recordSlippageAnalysis(analysisOrRecommendation: any, executionData?: any): Promise<void> {
    try {
      let analysisData: any;
      
      if (executionData) {
        // 兼容旧调用方式：recommendation + executionData
        const recommendation = analysisOrRecommendation;
        
        // 验证必要数据完整性
        if (!recommendation?.id || !recommendation?.symbol || 
            recommendation.entry_price == null || executionData.executed_price == null) {
          throw new Error('Missing required data for slippage analysis');
        }
        
        analysisData = {
          recommendation_id: recommendation.id,
          symbol: recommendation.symbol,
          direction: recommendation.direction,
          expected_price: recommendation.entry_price,
          actual_price: executionData.executed_price,
          price_difference: executionData.executed_price - recommendation.entry_price,
          price_difference_bps: ((executionData.executed_price - recommendation.entry_price) / recommendation.entry_price) * 10000,
          execution_latency_ms: executionData.latency_ms,
          fee_rate_bps: executionData.fee_rate_bps,
          fee_amount: executionData.fee_amount,
          slippage_bps: ((executionData.executed_price - recommendation.entry_price) / recommendation.entry_price) * 10000,
          slippage_category: this.categorizeSlippage(((executionData.executed_price - recommendation.entry_price) / recommendation.entry_price) * 10000),
          original_threshold: 15, // 默认值
          market_session: 'OPEN',
          created_at: new Date()
        };
      } else {
        // 新调用方式：直接传入分析数据
        analysisData = analysisOrRecommendation;
      }
      
      await this.database.saveSlippageAnalysis(analysisData);
    } catch (error) {
      console.error('Error recording slippage analysis:', error);
      throw error;
    }
  }

  /**
   * 根据滑点值分类
   */
  private categorizeSlippage(slippageBps: number): string {
    if (slippageBps < 5) return 'LOW';
    if (slippageBps < 15) return 'MEDIUM';
    if (slippageBps < 30) return 'HIGH';
    return 'EXTREME';
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