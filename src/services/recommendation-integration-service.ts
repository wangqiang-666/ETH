import { RecommendationTracker, CooldownError, OppositeConstraintError, ExposureLimitError, ExposureCapError, MTFConsistencyError } from './recommendation-tracker';
import { RecommendationDatabase, ExecutionRecord } from './recommendation-database';
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
  // 新增：维护策略持仓与推荐记录的映射
  private positionToRecommendation: Map<string, string> = new Map();
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
            signal_strength: payload?.strategyResult?.signal?.strength?.value,
            source: 'STRATEGY_ENGINE',
            is_strategy_generated: true,
            exclude_from_ml: false
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

      // TP1 命中 -> 止损上移至保本
      this.strategyEngine.on('position-tp1', async (payload: any) => {
        try {
          const position = payload?.position;
          const posId = position?.positionId;
          if (!posId) return;
          const recId = this.positionToRecommendation.get(posId);
          if (!recId) return;
          // 将止损上移至入场价（保本）
          await this.database.updateTargetPrices(recId, {
            stop_loss_price: position.entryPrice ?? undefined
          });
          // 同步更新内存中的跟踪对象，便于追踪止损立即生效
          try {
            const list = this.tracker.getActiveRecommendations();
            const rec = list.find(r => r.id === recId);
            if (rec && typeof position.entryPrice === 'number') {
              rec.stop_loss_price = position.entryPrice;
              rec.updated_at = new Date();
            }
          } catch {}
        } catch (e) {
          console.warn('[Integration] updateTargetPrices on TP1 failed:', (e as any)?.message || String(e));
        }
      });

      // TP2 命中 -> 止损抬到 TP1，止盈切到 TP3
      this.strategyEngine.on('position-tp2', async (payload: any) => {
        try {
          const position = payload?.position;
          const posId = position?.positionId;
          if (!posId) return;
          const recId = this.positionToRecommendation.get(posId);
          if (!recId) return;
          await this.database.updateTargetPrices(recId, {
            stop_loss_price: position.tp1 ?? position.stopLoss ?? undefined,
            take_profit_price: position.tp3 ?? position.takeProfit ?? undefined
          });
          // 同步更新内存中的跟踪对象
          try {
            const list = this.tracker.getActiveRecommendations();
            const rec = list.find(r => r.id === recId);
            if (rec) {
              if (typeof position.tp1 === 'number') rec.stop_loss_price = position.tp1;
              else if (typeof position.stopLoss === 'number') rec.stop_loss_price = position.stopLoss;
              if (typeof position.tp3 === 'number') rec.take_profit_price = position.tp3;
              else if (typeof position.takeProfit === 'number') rec.take_profit_price = position.takeProfit;
              rec.updated_at = new Date();
            }
          } catch {}
        } catch (e) {
          console.warn('[Integration] updateTargetPrices on TP2 failed:', (e as any)?.message || String(e));
        }
      });

      // 减仓事件（可选：记录日志或后续扩展）
      this.strategyEngine.on('position-reduced', async (payload: any) => {
        const position = payload?.position;
        if (!position?.positionId) return;
        const recId = this.positionToRecommendation.get(position.positionId);
        if (!recId) return;
        // 新增：保存减仓执行记录
        try {
          await this.recordExecution('REDUCE', payload, { recId });
        } catch (e) {
          console.warn('[Integration] failed to save reduce execution:', (e as any)?.message || String(e));
        }
        // 暂不需要数据库变更，仅打点
        this.emit('recommendation_partial_close', { recommendationId: recId, reductionRatio: payload?.reductionRatio });
      });

      // 平仓 -> 关闭推荐（按 MANUAL 或传入原因）
      this.strategyEngine.on('position-closed', async (payload: any) => {
        try {
          const position = payload?.position;
          const posId = position?.positionId;
          if (!posId) return;
          const recId = this.positionToRecommendation.get(posId);
          if (!recId) return;
          // 新增：保存平仓执行记录（优先记录，再关闭推荐）
          try {
            await this.recordExecution('CLOSE', payload, { recId });
          } catch (e) {
            console.warn('[Integration] failed to save close execution:', (e as any)?.message || String(e));
          }
          const reason: string = payload?.reason || 'MANUAL';
          await this.tracker.manualCloseRecommendation(recId, reason);
          this.positionToRecommendation.delete(posId);
        } catch (e) {
          console.error('[Integration] failed to close recommendation from position-closed:', e);
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
      // 获取当前市场数据（使用默认交易对）
      const marketData = await this.priceMonitor.getMarketData(config.trading.defaultSymbol);
      if (!marketData) {
        console.log('No market data available for auto recommendation');
        return;
      }
      
      // 运行策略分析
      const strategyResult = await this.strategyEngine.analyzeMarket();

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
        // 净敞口限流：限制同向活跃数上限
        if ((action === 'OPEN_LONG' && longCount >= maxSameDir) || (action === 'OPEN_SHORT' && shortCount >= maxSameDir)) {
          console.log(`Same-direction active recommendations reached limit (${maxSameDir}), skip auto open`);
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
          symbol: config.trading.defaultSymbol,
          direction: (action === 'OPEN_LONG' ? 'LONG' : 'SHORT') as 'LONG' | 'SHORT',
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
        // 净敞口限流（方向来自推导）
        if ((direction === 'LONG' && longCount >= maxSameDir) || (direction === 'SHORT' && shortCount >= maxSameDir)) {
          console.log(`Same-direction active recommendations reached limit (${maxSameDir}), skip opposite co-existence open`);
          return;
        }
        if (isOppositeToActive && (signal.confidence ?? confidence) >= oppositeMinConf) {
          const recommendation = {
            symbol: config.trading.defaultSymbol,
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
        is_strategy_generated: (recommendationData as any)?.is_strategy_generated ?? false,
        exclude_from_ml: recommendationData.exclude_from_ml || false
      };
      
      const recommendationId = await this.tracker.addRecommendation(enrichedData, { bypassCooldown: (recommendationData as any)?.bypassCooldown === true });
      this.postRecommendationToDBAPI(recommendationId, enrichedData).catch(err => {
        console.warn('Sync to DB API failed (manual create):', err?.message || err);
      });
      this.emit('recommendation_created', { id: recommendationId, recommendation: enrichedData });
      return recommendationId;
      
    } catch (error) {
      if (
        error instanceof CooldownError ||
        error instanceof OppositeConstraintError ||
        error instanceof ExposureLimitError
      ) {
        try {
          await this.logGatingDecision('MANUAL', recommendationData, error);
        } catch {}
        // 交由上层(API)统一映射状态码
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
      
      // 获取当前市场数据（使用默认交易对）
      const marketData = await this.priceMonitor.getMarketData(config.trading.defaultSymbol);
      if (!marketData) {
        return;
      }
      
      // 创建推荐记录
      const recommendation = {
        symbol: config.trading.defaultSymbol,
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
        exclude_from_ml: false,
        // 透传 EV 相关字段（兼容不同命名）
        expected_return: strategyResult?.performance?.expectedReturn ?? strategyResult?.gating?.ev,
        ev: strategyResult?.gating?.ev ?? strategyResult?.performance?.expectedReturn,
        ev_threshold: strategyResult?.gating?.evThreshold,
        ev_ok: strategyResult?.gating?.evOk,
        ab_group: strategyResult?.recommendation?.ab_group ?? strategyResult?.ab_group
      };
      
      await this.createRecommendation(recommendation);
      
    } catch (error) {
      if (
        error instanceof CooldownError ||
        error instanceof OppositeConstraintError ||
        error instanceof ExposureLimitError
      ) {
        try {
          await this.logGatingDecision('STRATEGY_ENGINE', strategyResult, error);
        } catch {}
        console.warn('[Integration] Strategy recommendation gated:', (error as any)?.message || String(error));
        return;
      }
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
      
      // 获取当前市场数据（使用默认交易对）
      const marketData = await this.priceMonitor.getMarketData(config.trading.defaultSymbol);
      if (!marketData) {
        return;
      }
      
      // 创建推荐记录
      const recommendation = {
        symbol: config.trading.defaultSymbol,
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
      if (
        error instanceof CooldownError ||
        error instanceof OppositeConstraintError ||
        error instanceof ExposureLimitError
      ) {
        try {
          await this.logGatingDecision('TRADING_SIGNAL_SERVICE', signal, error);
        } catch {}
        console.warn('[Integration] Trading signal gated:', (error as any)?.message || String(error));
        return;
      }
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
      const symbol = String(payload?.symbol || payload?.recommendation?.symbol || config.trading.defaultSymbol || 'UNKNOWN');

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
        stage: 'INTEGRATION',
        source,
        symbol,
        direction: direction || undefined
      };

      if (error instanceof CooldownError) {
        // 兼容老字段并记录增强的细化信息
        const kind = (error as any)?.kind as ('SAME_DIRECTION' | 'OPPOSITE' | 'GLOBAL' | undefined);
        detail.reason = kind === 'SAME_DIRECTION' ? 'COOLDOWN_SAME_DIRECTION'
          : kind === 'OPPOSITE' ? 'COOLDOWN_OPPOSITE'
          : kind === 'GLOBAL' ? 'COOLDOWN_GLOBAL'
          : 'COOLDOWN';
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
      } else if (error instanceof ExposureCapError) {
        detail.reason = 'EXPOSURE_CAP';
        detail.totalCap = (error as any)?.totalCap;
        detail.dirCap = (error as any)?.dirCap;
        detail.currentTotal = (error as any)?.currentTotal;
        detail.currentDirection = (error as any)?.currentDirection;
        detail.adding = (error as any)?.adding;
        detail.maxSameDirection = (error as any)?.maxSameDirection;
        detail.currentCount = (error as any)?.currentCount;
        detail.windowHours = (error as any)?.windowHours;
      } else if (error instanceof MTFConsistencyError || (error as any)?.code === 'MTF_CONSISTENCY') {
        detail.reason = 'MTF_CONSISTENCY';
        detail.requireMTFAgreement = (error as any)?.requireMTFAgreement;
        detail.minMTFAgreement = (error as any)?.minMTFAgreement;
        detail.agreement = (error as any)?.agreement;
        detail.dominantDirection = (error as any)?.dominantDirection;
        detail.mtfOk = (error as any)?.mtfOk;
      } else {
        detail.reason = 'UNKNOWN';
        detail.message = (error as any)?.message || String(error);
        detail.name = (error as any)?.name;
      }

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
      console.warn('[Integration] logGatingDecision failed:', (e as any)?.message || String(e));
    }
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
        notes: data.notes,
        // EV/AB 相关字段（与数据库字段一致）
        expected_return: data.expected_return ?? data.ev,
        ev: data.ev ?? data.expected_return,
        ev_threshold: data.ev_threshold ?? (data as any).evThreshold,
        ev_ok: ((): boolean | undefined => {
          const v: any = (data as any).ev_ok;
          if (typeof v === 'boolean') return v;
          if (typeof v === 'number') return !!v;
          return undefined;
        })(),
        ab_group: data.ab_group ?? (data as any).abGroup
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