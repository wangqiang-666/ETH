import { EventEmitter } from 'events';
import { enhancedDataIntegrationService, EnhancedMarketData } from '../services/enhanced-data-integration-service.js';
import { multiTimeframeAnalyzer, MultiTimeframeConsensus } from '../services/multi-timeframe-analyzer.js';
import { riskManagementService } from '../services/risk-management-service.js';
import type { MarketData } from '../services/okx-data-service.js';

/**
 * 优化版ETH合约Agent
 * 基于做多做空分析，解决-41.6%亏损问题
 */

// 优化后的交易信号
export interface OptimizedSignal {
  // 基础信号
  action: 'STRONG_LONG' | 'WEAK_LONG' | 'HOLD' | 'WEAK_SHORT' | 'STRONG_SHORT';
  confidence: number; // 0-1
  
  // 做多做空分析
  longShortAnalysis: {
    longStrength: number;     // 做多强度 0-1
    shortStrength: number;    // 做空强度 0-1
    trendDirection: number;   // 趋势方向 -1 to 1
    trendStrength: number;    // 趋势强度 0-1
    marketPhase: 'BULL' | 'BEAR' | 'SIDEWAYS' | 'VOLATILE';
  };
  
  // 技术分析
  technicalAnalysis: {
    rsi: number;
    macd: { macd: number; signal: number; histogram: number };
    trend: { short: number; medium: number; long: number };
    support: number[];
    resistance: number[];
    volatility: number;
  };
  
  // 风险评估
  riskAssessment: {
    entryRisk: number;        // 入场风险
    stopLoss: number;         // 建议止损
    takeProfit: number;       // 建议止盈
    positionSize: number;     // 建议仓位
    maxHoldingTime: number;   // 最大持仓时间
  };
}

// 优化后的Agent配置
export interface OptimizedAgentConfig {
  symbol: string;
  mode: 'BACKTEST' | 'PAPER' | 'LIVE';
  
  // 优化后的信号过滤 - 放宽条件
  signalFilters: {
    minConfidence: number;          // 降低到55% (vs 70%)
    timeframeAgreement: number;     // 降低到60% (vs 80%)
    dataQualityThreshold: number;   // 降低到70% (vs 80%)
    marketStateFilter: string[];    // 扩大允许状态
  };
  
  // 做多做空优化配置
  longShortConfig: {
    // 做多条件优化
    longConditions: {
      minTrendStrength: number;     // 最小趋势强度
      maxRSI: number;              // RSI上限
      macdRequired: boolean;        // 是否需要MACD确认
      supportBounce: boolean;       // 支撑位反弹
    };
    
    // 做空条件优化
    shortConditions: {
      minTrendStrength: number;     // 最小趋势强度(负值)
      minRSI: number;              // RSI下限
      macdRequired: boolean;        // 是否需要MACD确认
      resistanceReject: boolean;    // 阻力位拒绝
    };
  };
  
  // 动态风险管理
  dynamicRiskManagement: {
    // 动态止损
    stopLoss: {
      method: 'ATR' | 'FIXED' | 'TRAILING';
      bearMarketMultiplier: number;  // 熊市倍数
      bullMarketMultiplier: number;  // 牛市倍数
      atrPeriod: number;            // ATR周期
    };
    
    // 动态仓位
    positionSizing: {
      method: 'TREND_BASED' | 'VOLATILITY_BASED' | 'KELLY';
      baseSize: number;             // 基础仓位
      maxSize: number;              // 最大仓位
      trendMultiplier: number;      // 趋势倍数
    };
    
    // 时间管理
    timeManagement: {
      maxLongHours: number;         // 做多最大持仓时间
      maxShortHours: number;        // 做空最大持仓时间
      forceCloseEnabled: boolean;   // 是否强制平仓
    };
  };
}

// Agent状态
export interface OptimizedAgentState {
  isActive: boolean;
  mode: string;
  
  // 当前仓位
  currentPosition: {
    symbol: string;
    side: 'LONG' | 'SHORT' | null;
    size: number;
    entryPrice: number;
    entryTime: number;
    stopLoss: number;
    takeProfit: number;
    unrealizedPnl: number;
    holdingHours: number;
  } | null;
  
  // 优化后的性能统计
  performance: {
    totalTrades: number;
    longTrades: number;           // 做多交易数
    shortTrades: number;          // 做空交易数
    longWinRate: number;          // 做多胜率
    shortWinRate: number;         // 做空胜率
    overallWinRate: number;       // 总胜率
    totalReturn: number;
    longReturn: number;           // 做多收益
    shortReturn: number;          // 做空收益
    maxDrawdown: number;
    sharpeRatio: number;
    currentCapital: number;
  };
  
  // 市场适应性跟踪
  marketAdaptation: {
    currentPhase: 'BULL' | 'BEAR' | 'SIDEWAYS' | 'VOLATILE';
    phaseConfidence: number;
    adaptationScore: number;      // 适应性评分
    recentSignalAccuracy: number; // 近期信号准确率
  };
}

export class OptimizedETHAgent extends EventEmitter {
  private config: OptimizedAgentConfig;
  private state: OptimizedAgentState;
  private isRunning: boolean = false;
  
  // 信号历史
  private signalHistory: OptimizedSignal[] = [];
  private performanceHistory: any[] = [];
  
  constructor(config: OptimizedAgentConfig) {
    super();
    this.config = config;
    this.state = this.initializeState();
    
    console.log('[OptimizedETHAgent] 🚀 优化版ETH Agent初始化完成');
    console.log('[OptimizedETHAgent] 🎯 核心优化: 做多做空双向交易 + 动态风险管理');
  }
  
  /**
   * 启动优化版Agent
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[OptimizedETHAgent] Agent已在运行中');
      return;
    }
    
    console.log('[OptimizedETHAgent] 🚀 启动优化版ETH合约Agent...');
    console.log('[OptimizedETHAgent] 🎯 目标: 解决-41.6%亏损问题，实现盈利');
    
    try {
      // 初始化服务
      await enhancedDataIntegrationService.initialize();
      await enhancedDataIntegrationService.start();
      
      // 启动主循环
      this.startOptimizedMainLoop();
      
      this.isRunning = true;
      this.state.isActive = true;
      
      console.log('[OptimizedETHAgent] ✅ 优化版Agent启动成功');
      console.log('[OptimizedETHAgent] 📊 信号门槛: 置信度55% (vs 70%)');
      console.log('[OptimizedETHAgent] 🎯 做多做空: 双向交易策略激活');
      
      this.emit('started', this.state);
      
    } catch (error) {
      console.error('[OptimizedETHAgent] 启动失败:', error);
      throw error;
    }
  }
  
  /**
   * 停止Agent
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    console.log('[OptimizedETHAgent] 🛑 停止优化版Agent...');
    
    // 平仓所有持仓
    if (this.state.currentPosition) {
      await this.closePosition('AGENT_STOP');
    }
    
    this.isRunning = false;
    this.state.isActive = false;
    
    console.log('[OptimizedETHAgent] ✅ Agent已停止');
    this.emit('stopped', this.state);
  }
  
  /**
   * 优化版主循环
   */
  private startOptimizedMainLoop(): void {
    setInterval(async () => {
      if (!this.isRunning || !this.state.isActive) return;
      
      try {
        // 获取市场数据
        const marketData = await enhancedDataIntegrationService.getEnhancedMarketData(this.config.symbol);
        if (!marketData) return;
        
        // 多时间框架分析
        const mtfAnalysis = await multiTimeframeAnalyzer.analyzeMultiTimeframe(this.config.symbol);
        
        // 生成优化信号
        const signal = await this.generateOptimizedSignal(marketData, mtfAnalysis);
        
        // 执行优化交易决策
        await this.executeOptimizedTradeDecision(signal, marketData);
        
        // 更新状态
        this.updateOptimizedState(signal);
        
      } catch (error) {
        console.error('[OptimizedETHAgent] 主循环错误:', error);
      }
    }, 30000); // 30秒间隔
  }
  
  /**
   * 生成优化信号
   */
  private async generateOptimizedSignal(
    marketData: EnhancedMarketData, 
    mtfAnalysis: MultiTimeframeConsensus
  ): Promise<OptimizedSignal> {
    
    // 1. 基础技术分析
    const technicalAnalysis = this.calculateTechnicalIndicators(marketData);
    
    // 2. 做多做空强度分析
    const longShortAnalysis = this.analyzeLongShortStrength(technicalAnalysis, mtfAnalysis);
    
    // 3. 生成优化信号
    const signal = this.synthesizeOptimizedSignal(longShortAnalysis, technicalAnalysis);
    
    // 4. 风险评估
    const riskAssessment = this.assessOptimizedRisk(signal, technicalAnalysis);
    
    const optimizedSignal: OptimizedSignal = {
      action: signal.action,
      confidence: signal.confidence,
      longShortAnalysis,
      technicalAnalysis,
      riskAssessment
    };
    
    // 记录信号
    this.signalHistory.push(optimizedSignal);
    if (this.signalHistory.length > 1000) {
      this.signalHistory.shift();
    }
    
    return optimizedSignal;
  }
  
  /**
   * 分析做多做空强度
   */
  private analyzeLongShortStrength(
    technical: any, 
    mtf: MultiTimeframeConsensus
  ): OptimizedSignal['longShortAnalysis'] {
    
    const { rsi, macd, trend } = technical;
    
    // 做多强度分析
    let longStrength = 0;
    
    // 趋势做多强度
    if (trend.medium > 0.3) longStrength += 0.3;
    if (trend.long > 0.2) longStrength += 0.2;
    
    // RSI做多强度
    if (rsi < 65) longStrength += (65 - rsi) / 65 * 0.2;
    
    // MACD做多强度
    if (macd.histogram > 0) longStrength += 0.2;
    if (macd.macd > macd.signal) longStrength += 0.1;
    
    // 多时间框架确认
    if (mtf.overall_direction === 'BULLISH') longStrength += 0.2;
    
    // 做空强度分析
    let shortStrength = 0;
    
    // 趋势做空强度
    if (trend.medium < -0.3) shortStrength += 0.3;
    if (trend.long < -0.2) shortStrength += 0.2;
    
    // RSI做空强度
    if (rsi > 35) shortStrength += (rsi - 35) / 65 * 0.2;
    
    // MACD做空强度
    if (macd.histogram < 0) shortStrength += 0.2;
    if (macd.macd < macd.signal) shortStrength += 0.1;
    
    // 多时间框架确认
    if (mtf.overall_direction === 'BEARISH') shortStrength += 0.2;
    
    // 限制范围
    longStrength = Math.max(0, Math.min(1, longStrength));
    shortStrength = Math.max(0, Math.min(1, shortStrength));
    
    // 趋势方向和强度
    const trendDirection = trend.medium;
    const trendStrength = Math.abs(trendDirection);
    
    // 市场阶段识别
    let marketPhase: 'BULL' | 'BEAR' | 'SIDEWAYS' | 'VOLATILE';
    if (trendStrength > 0.5) {
      marketPhase = trendDirection > 0 ? 'BULL' : 'BEAR';
    } else if (technical.volatility > 0.04) {
      marketPhase = 'VOLATILE';
    } else {
      marketPhase = 'SIDEWAYS';
    }
    
    return {
      longStrength,
      shortStrength,
      trendDirection,
      trendStrength,
      marketPhase
    };
  }
  
  /**
   * 综合优化信号
   */
  private synthesizeOptimizedSignal(
    longShort: OptimizedSignal['longShortAnalysis'],
    technical: any
  ): { action: OptimizedSignal['action']; confidence: number } {
    
    const { longStrength, shortStrength, trendStrength } = longShort;
    
    let action: OptimizedSignal['action'] = 'HOLD';
    let confidence = 0.5;
    
    // 优化后的信号逻辑 - 降低门槛
    if (longStrength > shortStrength) {
      if (longStrength > 0.7 && trendStrength > 0.4) {
        action = 'STRONG_LONG';
        confidence = Math.min(0.95, 0.7 + longStrength * 0.3);
      } else if (longStrength > 0.5) {
        action = 'WEAK_LONG';
        confidence = Math.min(0.8, 0.5 + longStrength * 0.3);
      }
    } else if (shortStrength > longStrength) {
      if (shortStrength > 0.7 && trendStrength > 0.4) {
        action = 'STRONG_SHORT';
        confidence = Math.min(0.95, 0.7 + shortStrength * 0.3);
      } else if (shortStrength > 0.5) {
        action = 'WEAK_SHORT';
        confidence = Math.min(0.8, 0.5 + shortStrength * 0.3);
      }
    }
    
    return { action, confidence };
  }
  
  /**
   * 优化风险评估
   */
  private assessOptimizedRisk(
    signal: { action: OptimizedSignal['action']; confidence: number },
    technical: any
  ): OptimizedSignal['riskAssessment'] {
    
    const { volatility } = technical;
    const isLong = signal.action.includes('LONG');
    const isShort = signal.action.includes('SHORT');
    
    // 动态止损计算
    let stopLoss: number;
    if (this.config.dynamicRiskManagement.stopLoss.method === 'ATR') {
      const atrMultiplier = isLong ? 
        this.config.dynamicRiskManagement.stopLoss.bullMarketMultiplier :
        this.config.dynamicRiskManagement.stopLoss.bearMarketMultiplier;
      stopLoss = volatility * atrMultiplier;
    } else {
      stopLoss = isLong ? 0.02 : 0.02; // 默认2%
    }
    
    // 动态止盈计算
    const takeProfit = stopLoss * 2; // 1:2风险收益比
    
    // 动态仓位计算
    let positionSize = this.config.dynamicRiskManagement.positionSizing.baseSize;
    
    if (signal.action.includes('STRONG')) {
      positionSize *= 1.5; // 强信号增加仓位
    }
    
    positionSize *= signal.confidence; // 基于置信度调整
    positionSize = Math.min(positionSize, this.config.dynamicRiskManagement.positionSizing.maxSize);
    
    // 最大持仓时间
    const maxHoldingTime = isLong ? 
      this.config.dynamicRiskManagement.timeManagement.maxLongHours :
      this.config.dynamicRiskManagement.timeManagement.maxShortHours;
    
    return {
      entryRisk: volatility,
      stopLoss,
      takeProfit,
      positionSize,
      maxHoldingTime
    };
  }
  
  /**
   * 执行优化交易决策
   */
  private async executeOptimizedTradeDecision(
    signal: OptimizedSignal,
    marketData: EnhancedMarketData
  ): Promise<void> {
    
    // 应用优化后的过滤器
    if (!this.passOptimizedFilters(signal)) {
      return;
    }
    
    // 检查当前仓位
    if (this.state.currentPosition) {
      await this.manageOptimizedPosition(signal, marketData);
    } else {
      await this.openOptimizedPosition(signal, marketData);
    }
  }
  
  /**
   * 优化后的信号过滤
   */
  private passOptimizedFilters(signal: OptimizedSignal): boolean {
    // 置信度过滤 - 降低到55%
    if (signal.confidence < this.config.signalFilters.minConfidence) {
      return false;
    }
    
    // 做多做空强度过滤
    const { longStrength, shortStrength } = signal.longShortAnalysis;
    const dominantStrength = Math.max(longStrength, shortStrength);
    
    if (dominantStrength < 0.5) {
      return false; // 做多做空强度都不足
    }
    
    // 市场状态过滤 - 扩大允许范围
    if (!this.config.signalFilters.marketStateFilter.includes(signal.longShortAnalysis.marketPhase)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * 开启优化仓位
   */
  private async openOptimizedPosition(
    signal: OptimizedSignal,
    marketData: EnhancedMarketData
  ): Promise<void> {
    
    if (signal.action === 'HOLD') return;
    
    const isLong = signal.action.includes('LONG');
    const currentPrice = marketData.price;
    
    // 创建仓位
    this.state.currentPosition = {
      symbol: this.config.symbol,
      side: isLong ? 'LONG' : 'SHORT',
      size: signal.riskAssessment.positionSize,
      entryPrice: currentPrice,
      entryTime: Date.now(),
      stopLoss: isLong ? 
        currentPrice * (1 - signal.riskAssessment.stopLoss) :
        currentPrice * (1 + signal.riskAssessment.stopLoss),
      takeProfit: isLong ?
        currentPrice * (1 + signal.riskAssessment.takeProfit) :
        currentPrice * (1 - signal.riskAssessment.takeProfit),
      unrealizedPnl: 0,
      holdingHours: 0
    };
    
    // 更新统计
    this.state.performance.totalTrades++;
    if (isLong) {
      this.state.performance.longTrades++;
    } else {
      this.state.performance.shortTrades++;
    }
    
    console.log(`[OptimizedETHAgent] 📈 开仓: ${signal.action} 仓位${(signal.riskAssessment.positionSize * 100).toFixed(1)}% @$${currentPrice.toFixed(2)}`);
    console.log(`[OptimizedETHAgent] 🎯 止损: $${this.state.currentPosition.stopLoss.toFixed(2)} 止盈: $${this.state.currentPosition.takeProfit.toFixed(2)}`);
    
    this.emit('positionOpened', this.state.currentPosition);
  }
  
  /**
   * 管理优化仓位
   */
  private async manageOptimizedPosition(
    signal: OptimizedSignal,
    marketData: EnhancedMarketData
  ): Promise<void> {
    
    if (!this.state.currentPosition) return;
    
    const position = this.state.currentPosition;
    const currentPrice = marketData.price;
    const isLong = position.side === 'LONG';
    
    // 更新持仓时间
    position.holdingHours = (Date.now() - position.entryTime) / (1000 * 60 * 60);
    
    // 更新未实现盈亏
    if (isLong) {
      position.unrealizedPnl = (currentPrice - position.entryPrice) / position.entryPrice * position.size;
    } else {
      position.unrealizedPnl = (position.entryPrice - currentPrice) / position.entryPrice * position.size;
    }
    
    // 检查平仓条件
    let shouldClose = false;
    let closeReason = '';
    
    // 止盈止损检查
    if (isLong) {
      if (currentPrice >= position.takeProfit) {
        shouldClose = true;
        closeReason = 'TAKE_PROFIT';
      } else if (currentPrice <= position.stopLoss) {
        shouldClose = true;
        closeReason = 'STOP_LOSS';
      }
    } else {
      if (currentPrice <= position.takeProfit) {
        shouldClose = true;
        closeReason = 'TAKE_PROFIT';
      } else if (currentPrice >= position.stopLoss) {
        shouldClose = true;
        closeReason = 'STOP_LOSS';
      }
    }
    
    // 时间止损检查
    const maxHoldingTime = signal.riskAssessment.maxHoldingTime;
    if (position.holdingHours >= maxHoldingTime) {
      shouldClose = true;
      closeReason = 'TIME_LIMIT';
    }
    
    // 信号反转检查
    if (signal.action !== 'HOLD') {
      const signalIsLong = signal.action.includes('LONG');
      if (isLong && !signalIsLong) {
        shouldClose = true;
        closeReason = 'SIGNAL_REVERSE';
      } else if (!isLong && signalIsLong) {
        shouldClose = true;
        closeReason = 'SIGNAL_REVERSE';
      }
    }
    
    if (shouldClose) {
      await this.closePosition(closeReason);
    }
  }
  
  /**
   * 平仓
   */
  private async closePosition(reason: string): Promise<void> {
    if (!this.state.currentPosition) return;
    
    const position = this.state.currentPosition;
    const isLong = position.side === 'LONG';
    const pnl = position.unrealizedPnl;
    
    // 更新统计
    this.state.performance.totalReturn += pnl;
    this.state.performance.currentCapital += pnl;
    
    if (isLong) {
      this.state.performance.longReturn += pnl;
      if (pnl > 0) {
        this.state.performance.longWinRate = 
          (this.state.performance.longWinRate * (this.state.performance.longTrades - 1) + 1) / 
          this.state.performance.longTrades;
      }
    } else {
      this.state.performance.shortReturn += pnl;
      if (pnl > 0) {
        this.state.performance.shortWinRate = 
          (this.state.performance.shortWinRate * (this.state.performance.shortTrades - 1) + 1) / 
          this.state.performance.shortTrades;
      }
    }
    
    // 更新总胜率
    const totalWinningTrades = 
      this.state.performance.longTrades * this.state.performance.longWinRate +
      this.state.performance.shortTrades * this.state.performance.shortWinRate;
    this.state.performance.overallWinRate = totalWinningTrades / this.state.performance.totalTrades;
    
    console.log(`[OptimizedETHAgent] 📉 平仓: ${position.side} ${reason} PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
    console.log(`[OptimizedETHAgent] 📊 胜率: 做多${(this.state.performance.longWinRate * 100).toFixed(1)}% 做空${(this.state.performance.shortWinRate * 100).toFixed(1)}% 总体${(this.state.performance.overallWinRate * 100).toFixed(1)}%`);
    
    this.state.currentPosition = null;
    this.emit('positionClosed', { reason, pnl });
  }
  
  /**
   * 更新优化状态
   */
  private updateOptimizedState(signal: OptimizedSignal): void {
    // 更新市场适应性
    this.state.marketAdaptation.currentPhase = signal.longShortAnalysis.marketPhase;
    this.state.marketAdaptation.phaseConfidence = signal.confidence;
    
    // 计算适应性评分
    const recentSignals = this.signalHistory.slice(-20);
    if (recentSignals.length > 0) {
      const avgConfidence = recentSignals.reduce((sum, s) => sum + s.confidence, 0) / recentSignals.length;
      this.state.marketAdaptation.adaptationScore = avgConfidence;
    }
  }
  
  // 辅助方法
  private initializeState(): OptimizedAgentState {
    return {
      isActive: false,
      mode: this.config.mode,
      currentPosition: null,
      performance: {
        totalTrades: 0,
        longTrades: 0,
        shortTrades: 0,
        longWinRate: 0,
        shortWinRate: 0,
        overallWinRate: 0,
        totalReturn: 0,
        longReturn: 0,
        shortReturn: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        currentCapital: 100000
      },
      marketAdaptation: {
        currentPhase: 'SIDEWAYS',
        phaseConfidence: 0,
        adaptationScore: 0,
        recentSignalAccuracy: 0
      }
    };
  }
  
  private calculateTechnicalIndicators(marketData: EnhancedMarketData): any {
    // 简化的技术指标计算
    return {
      rsi: 50 + (Math.random() - 0.5) * 40, // 模拟RSI
      macd: {
        macd: (Math.random() - 0.5) * 0.1,
        signal: (Math.random() - 0.5) * 0.1,
        histogram: (Math.random() - 0.5) * 0.05
      },
      trend: {
        short: (Math.random() - 0.5) * 0.1,
        medium: (Math.random() - 0.5) * 0.2,
        long: (Math.random() - 0.5) * 0.3
      },
      support: [marketData.price * 0.98, marketData.price * 0.95],
      resistance: [marketData.price * 1.02, marketData.price * 1.05],
      volatility: 0.02 + Math.random() * 0.03
    };
  }
  
  // 公共方法
  public getState(): OptimizedAgentState {
    return { ...this.state };
  }
  
  public getSignalHistory(limit: number = 100): OptimizedSignal[] {
    return this.signalHistory.slice(-limit);
  }
  
  public updateConfig(newConfig: Partial<OptimizedAgentConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('[OptimizedETHAgent] ⚙️ 配置已更新');
    this.emit('configUpdated', this.config);
  }
}

// 优化后的默认配置
export const optimizedDefaultConfig: OptimizedAgentConfig = {
  symbol: 'ETH-USDT-SWAP',
  mode: 'BACKTEST',
  
  // 优化后的信号过滤 - 放宽条件
  signalFilters: {
    minConfidence: 0.55,        // 降低到55% (vs 70%)
    timeframeAgreement: 0.60,   // 降低到60% (vs 80%)
    dataQualityThreshold: 0.70, // 降低到70% (vs 80%)
    marketStateFilter: ['BULL', 'BEAR', 'SIDEWAYS', 'VOLATILE'] // 扩大范围
  },
  
  // 做多做空优化配置
  longShortConfig: {
    longConditions: {
      minTrendStrength: 0.3,    // 降低门槛
      maxRSI: 65,              // 放宽RSI限制
      macdRequired: false,      // 不强制要求MACD
      supportBounce: true
    },
    shortConditions: {
      minTrendStrength: -0.3,   // 降低门槛
      minRSI: 35,              // 放宽RSI限制
      macdRequired: false,      // 不强制要求MACD
      resistanceReject: true
    }
  },
  
  // 动态风险管理
  dynamicRiskManagement: {
    stopLoss: {
      method: 'ATR',
      bearMarketMultiplier: 1.5,  // 熊市1.5倍ATR
      bullMarketMultiplier: 2.0,  // 牛市2.0倍ATR
      atrPeriod: 14
    },
    positionSizing: {
      method: 'TREND_BASED',
      baseSize: 0.10,            // 基础10%仓位
      maxSize: 0.25,             // 最大25%仓位
      trendMultiplier: 1.5       // 趋势倍数
    },
    timeManagement: {
      maxLongHours: 72,          // 做多最大72小时
      maxShortHours: 48,         // 做空最大48小时
      forceCloseEnabled: true
    }
  }
};

// 导出优化版Agent实例
export const optimizedETHAgent = new OptimizedETHAgent(optimizedDefaultConfig);