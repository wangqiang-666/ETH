import { EventEmitter } from 'events';
import { enhancedDataIntegrationService, EnhancedMarketData } from '../services/enhanced-data-integration-service.js';
import { dataQualityManager } from '../utils/data-quality-manager.js';
import { riskManagementService } from '../services/risk-management-service.js';
import type { MarketData } from '../services/okx-data-service.js';

/**
 * 增强版ETH合约Agent
 * 基于真实数据回测结果重构，解决37.66%胜率问题
 */

// 多时间框架数据结构
export interface MultiTimeframeData {
  '5m': MarketData[];
  '15m': MarketData[];
  '1h': MarketData[];
  '4h': MarketData[];
}

// 增强信号结构
export interface EnhancedSignal {
  // 基础信号
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number; // 0-1
  
  // 多时间框架确认
  timeframeConsensus: {
    '1h': { trend: 'UP' | 'DOWN' | 'SIDEWAYS'; strength: number };
    '15m': { momentum: 'STRONG' | 'WEAK' | 'NEUTRAL'; direction: 'UP' | 'DOWN' };
    '5m': { entry: 'OPTIMAL' | 'GOOD' | 'POOR'; timing: number };
  };
  
  // 技术指标组合
  technicalIndicators: {
    trend: { ema: number; macd: number; adx: number };
    momentum: { rsi: number; stoch: number; williams: number };
    volatility: { atr: number; bbands: number };
    volume: { obv: number; vwap: number };
  };
  
  // 9维数据融合
  dataFusion: {
    onchain: { whaleActivity: number; networkHealth: number };
    sentiment: { fearGreed: number; socialMedia: number };
    macro: { dxy: number; rates: number };
    quality: { completeness: number; reliability: number };
  };
  
  // 市场状态识别
  marketState: {
    regime: 'TRENDING' | 'RANGING' | 'VOLATILE' | 'BREAKOUT';
    phase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN';
    volatility: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  };
  
  // 风险评估
  riskAssessment: {
    entryRisk: number; // 0-1
    positionRisk: number; // 0-1
    marketRisk: number; // 0-1
    systemicRisk: number; // 0-1
  };
}

// Agent配置
export interface EnhancedAgentConfig {
  // 基础配置
  symbol: string;
  mode: 'BACKTEST' | 'PAPER' | 'LIVE';
  
  // 信号过滤配置
  signalFilters: {
    minConfidence: number; // 最小置信度
    timeframeAgreement: number; // 时间框架一致性要求
    dataQualityThreshold: number; // 数据质量阈值
    marketStateFilter: string[]; // 允许的市场状态
  };
  
  // 动态仓位管理
  positionManagement: {
    baseSize: number; // 基础仓位
    maxSize: number; // 最大仓位
    confidenceScaling: boolean; // 基于置信度调整
    volatilityAdjustment: boolean; // 基于波动率调整
    trendStrengthBonus: boolean; // 趋势强度加成
  };
  
  // 智能止损止盈
  stopLossConfig: {
    method: 'FIXED' | 'ATR' | 'SUPPORT_RESISTANCE' | 'DYNAMIC';
    basePercent: number; // 基础止损百分比
    atrMultiplier: number; // ATR倍数
    trailingEnabled: boolean; // 是否启用追踪止损
  };
  
  takeProfitConfig: {
    method: 'FIXED' | 'ATR' | 'FIBONACCI' | 'DYNAMIC';
    basePercent: number; // 基础止盈百分比
    partialTakeProfit: boolean; // 分批止盈
    riskRewardRatio: number; // 风险收益比
  };
  
  // 时间管理
  timeManagement: {
    maxHoldingTime: number; // 最大持仓时间(小时)
    timeBasedExit: boolean; // 基于时间的出场
    sessionFilters: string[]; // 交易时段过滤
  };
}

// Agent状态
export interface EnhancedAgentState {
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
    trailingStop?: number;
  } | null;
  
  // 性能统计
  performance: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalReturn: number;
    maxDrawdown: number;
    sharpeRatio: number;
    currentCapital: number;
    
    // 新增：详细统计
    avgWinPercent: number;
    avgLossPercent: number;
    profitFactor: number;
    avgHoldingTime: number;
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
  };
  
  // 信号质量监控
  signalQuality: {
    recentSignals: number;
    accurateSignals: number;
    currentAccuracy: number;
    confidenceCalibration: number;
    falsePositiveRate: number;
    falseNegativeRate: number;
  };
  
  // 市场状态跟踪
  marketTracking: {
    currentRegime: string;
    regimeConfidence: number;
    volatilityLevel: string;
    trendStrength: number;
    lastRegimeChange: number;
  };
}

export class EnhancedETHAgent extends EventEmitter {
  private config: EnhancedAgentConfig;
  private state: EnhancedAgentState;
  private isRunning: boolean = false;
  
  // 数据缓存
  private multiTimeframeData: MultiTimeframeData = {
    '5m': [],
    '15m': [],
    '1h': [],
    '4h': []
  };
  
  // 信号历史
  private signalHistory: EnhancedSignal[] = [];
  private performanceHistory: any[] = [];
  
  constructor(config: EnhancedAgentConfig) {
    super();
    this.config = config;
    this.state = this.initializeState();
    
    console.log('[EnhancedETHAgent] 🚀 增强版ETH Agent初始化完成');
    console.log('[EnhancedETHAgent] 📊 配置: 多时间框架分析 + 9维数据融合');
  }
  
  /**
   * 启动增强版Agent
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[EnhancedETHAgent] Agent已在运行中');
      return;
    }
    
    console.log('[EnhancedETHAgent] 🚀 启动增强版ETH合约Agent...');
    
    try {
      // 初始化数据服务
      await enhancedDataIntegrationService.initialize();
      await enhancedDataIntegrationService.start();
      
      // 预热多时间框架数据
      await this.warmupMultiTimeframeData();
      
      // 启动主循环
      this.startMainLoop();
      
      this.isRunning = true;
      this.state.isActive = true;
      
      console.log('[EnhancedETHAgent] ✅ 增强版Agent启动成功');
      console.log('[EnhancedETHAgent] 🎯 目标: 将胜率从37.66%提升到55%+');
      
      this.emit('started', this.state);
      
    } catch (error) {
      console.error('[EnhancedETHAgent] 启动失败:', error);
      throw error;
    }
  }
  
  /**
   * 停止Agent
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    console.log('[EnhancedETHAgent] 🛑 停止增强版Agent...');
    
    // 平仓所有持仓
    if (this.state.currentPosition) {
      await this.closePosition('AGENT_STOP');
    }
    
    this.isRunning = false;
    this.state.isActive = false;
    
    console.log('[EnhancedETHAgent] ✅ Agent已停止');
    this.emit('stopped', this.state);
  }
  
  /**
   * 预热多时间框架数据
   */
  private async warmupMultiTimeframeData(): Promise<void> {
    console.log('[EnhancedETHAgent] 📊 预热多时间框架数据...');
    
    // 这里应该从您的数据服务获取历史数据
    // 暂时使用模拟数据
    const timeframes = ['5m', '15m', '1h', '4h'];
    
    for (const tf of timeframes) {
      // 获取最近100根K线数据
      const data = await this.fetchHistoricalData(this.config.symbol, tf, 100);
      this.multiTimeframeData[tf as keyof MultiTimeframeData] = data;
      
      console.log(`[EnhancedETHAgent] ✅ ${tf} 数据预热完成: ${data.length} 根K线`);
    }
  }
  
  /**
   * 主循环
   */
  private startMainLoop(): void {
    setInterval(async () => {
      if (!this.isRunning || !this.state.isActive) return;
      
      try {
        // 更新多时间框架数据
        await this.updateMultiTimeframeData();
        
        // 生成增强信号
        const signal = await this.generateEnhancedSignal();
        
        // 执行交易决策
        await this.executeTradeDecision(signal);
        
        // 更新状态
        this.updateAgentState();
        
      } catch (error) {
        console.error('[EnhancedETHAgent] 主循环错误:', error);
      }
    }, 30000); // 30秒间隔
  }
  
  /**
   * 生成增强信号
   */
  private async generateEnhancedSignal(): Promise<EnhancedSignal> {
    // 获取增强市场数据
    const enhancedData = await enhancedDataIntegrationService.getEnhancedMarketData(this.config.symbol);
    if (!enhancedData) {
      throw new Error('无法获取增强市场数据');
    }
    
    // 1. 多时间框架分析
    const timeframeConsensus = this.analyzeMultiTimeframe();
    
    // 2. 技术指标计算
    const technicalIndicators = this.calculateTechnicalIndicators();
    
    // 3. 9维数据融合
    const dataFusion = this.fuseMultiDimensionalData(enhancedData);
    
    // 4. 市场状态识别
    const marketState = this.identifyMarketState();
    
    // 5. 风险评估
    const riskAssessment = this.assessRisk();
    
    // 6. 综合信号生成
    const signal = this.synthesizeSignal(
      timeframeConsensus,
      technicalIndicators,
      dataFusion,
      marketState,
      riskAssessment
    );
    
    // 记录信号
    this.signalHistory.push(signal);
    if (this.signalHistory.length > 1000) {
      this.signalHistory.shift();
    }
    
    return signal;
  }
  
  /**
   * 多时间框架分析
   */
  private analyzeMultiTimeframe(): EnhancedSignal['timeframeConsensus'] {
    const h1Data = this.multiTimeframeData['1h'];
    const m15Data = this.multiTimeframeData['15m'];
    const m5Data = this.multiTimeframeData['5m'];
    
    // 1小时趋势分析
    const h1Trend = this.analyzeTrend(h1Data);
    
    // 15分钟动量分析
    const m15Momentum = this.analyzeMomentum(m15Data);
    
    // 5分钟入场时机分析
    const m5Entry = this.analyzeEntryTiming(m5Data);
    
    return {
      '1h': h1Trend,
      '15m': m15Momentum,
      '5m': m5Entry
    };
  }
  
  /**
   * 趋势分析
   */
  private analyzeTrend(data: MarketData[]): { trend: 'UP' | 'DOWN' | 'SIDEWAYS'; strength: number } {
    if (data.length < 20) {
      return { trend: 'SIDEWAYS', strength: 0 };
    }
    
    const recent = data.slice(-20);
    const ema20 = this.calculateEMA(recent.map(d => d.price), 20);
    const ema50 = this.calculateEMA(data.slice(-50).map(d => d.price), 50);
    
    const currentPrice = recent[recent.length - 1].price;
    const priceVsEma20 = (currentPrice - ema20) / ema20;
    const emaSlope = (ema20 - ema50) / ema50;
    
    let trend: 'UP' | 'DOWN' | 'SIDEWAYS';
    let strength: number;
    
    if (priceVsEma20 > 0.02 && emaSlope > 0.01) {
      trend = 'UP';
      strength = Math.min(1, Math.abs(emaSlope) * 50);
    } else if (priceVsEma20 < -0.02 && emaSlope < -0.01) {
      trend = 'DOWN';
      strength = Math.min(1, Math.abs(emaSlope) * 50);
    } else {
      trend = 'SIDEWAYS';
      strength = 0.3;
    }
    
    return { trend, strength };
  }
  
  /**
   * 动量分析
   */
  private analyzeMomentum(data: MarketData[]): { momentum: 'STRONG' | 'WEAK' | 'NEUTRAL'; direction: 'UP' | 'DOWN' } {
    if (data.length < 14) {
      return { momentum: 'NEUTRAL', direction: 'UP' };
    }
    
    const rsi = this.calculateRSI(data.map(d => d.price), 14);
    const macd = this.calculateMACD(data.map(d => d.price));
    
    let momentum: 'STRONG' | 'WEAK' | 'NEUTRAL';
    let direction: 'UP' | 'DOWN';
    
    if (rsi > 60 && macd.histogram > 0) {
      momentum = 'STRONG';
      direction = 'UP';
    } else if (rsi < 40 && macd.histogram < 0) {
      momentum = 'STRONG';
      direction = 'DOWN';
    } else if (rsi > 50 && macd.macd > macd.signal) {
      momentum = 'WEAK';
      direction = 'UP';
    } else if (rsi < 50 && macd.macd < macd.signal) {
      momentum = 'WEAK';
      direction = 'DOWN';
    } else {
      momentum = 'NEUTRAL';
      direction = rsi > 50 ? 'UP' : 'DOWN';
    }
    
    return { momentum, direction };
  }
  
  /**
   * 入场时机分析
   */
  private analyzeEntryTiming(data: MarketData[]): { entry: 'OPTIMAL' | 'GOOD' | 'POOR'; timing: number } {
    if (data.length < 10) {
      return { entry: 'POOR', timing: 0 };
    }
    
    const recent = data.slice(-10);
    const volatility = this.calculateVolatility(recent.map(d => d.price));
    const volume = recent[recent.length - 1].volume;
    const avgVolume = recent.reduce((sum, d) => sum + d.volume, 0) / recent.length;
    
    const volumeRatio = volume / avgVolume;
    const priceAction = this.analyzePriceAction(recent);
    
    let entry: 'OPTIMAL' | 'GOOD' | 'POOR';
    let timing: number;
    
    if (volatility < 0.02 && volumeRatio > 1.5 && priceAction.strength > 0.7) {
      entry = 'OPTIMAL';
      timing = 0.9;
    } else if (volatility < 0.03 && volumeRatio > 1.2 && priceAction.strength > 0.5) {
      entry = 'GOOD';
      timing = 0.7;
    } else {
      entry = 'POOR';
      timing = 0.3;
    }
    
    return { entry, timing };
  }
  
  /**
   * 综合信号生成
   */
  private synthesizeSignal(
    timeframeConsensus: EnhancedSignal['timeframeConsensus'],
    technicalIndicators: EnhancedSignal['technicalIndicators'],
    dataFusion: EnhancedSignal['dataFusion'],
    marketState: EnhancedSignal['marketState'],
    riskAssessment: EnhancedSignal['riskAssessment']
  ): EnhancedSignal {
    
    // 计算综合置信度
    let confidence = 0;
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    
    // 时间框架权重
    const timeframeScore = this.calculateTimeframeScore(timeframeConsensus);
    confidence += timeframeScore * 0.4; // 40%权重
    
    // 技术指标权重
    const technicalScore = this.calculateTechnicalScore(technicalIndicators);
    confidence += technicalScore * 0.3; // 30%权重
    
    // 数据融合权重
    const dataScore = this.calculateDataScore(dataFusion);
    confidence += dataScore * 0.2; // 20%权重
    
    // 市场状态权重
    const marketScore = this.calculateMarketScore(marketState);
    confidence += marketScore * 0.1; // 10%权重
    
    // 风险调整
    confidence *= (1 - riskAssessment.systemicRisk * 0.5);
    
    // 确定行动
    if (confidence > this.config.signalFilters.minConfidence) {
      if (timeframeConsensus['1h'].trend === 'UP' && 
          timeframeConsensus['15m'].direction === 'UP' &&
          timeframeConsensus['5m'].entry !== 'POOR') {
        action = 'BUY';
      } else if (timeframeConsensus['1h'].trend === 'DOWN' && 
                 timeframeConsensus['15m'].direction === 'DOWN' &&
                 timeframeConsensus['5m'].entry !== 'POOR') {
        action = 'SELL';
      }
    }
    
    return {
      action,
      confidence: Math.min(1, Math.max(0, confidence)),
      timeframeConsensus,
      technicalIndicators,
      dataFusion,
      marketState,
      riskAssessment
    };
  }
  
  /**
   * 执行交易决策
   */
  private async executeTradeDecision(signal: EnhancedSignal): Promise<void> {
    // 检查信号过滤条件
    if (!this.passSignalFilters(signal)) {
      return;
    }
    
    // 检查当前仓位
    if (this.state.currentPosition) {
      await this.manageExistingPosition(signal);
    } else {
      await this.openNewPosition(signal);
    }
  }
  
  /**
   * 信号过滤
   */
  private passSignalFilters(signal: EnhancedSignal): boolean {
    // 置信度过滤
    if (signal.confidence < this.config.signalFilters.minConfidence) {
      return false;
    }
    
    // 数据质量过滤
    if (signal.dataFusion.quality.reliability < this.config.signalFilters.dataQualityThreshold) {
      return false;
    }
    
    // 市场状态过滤
    if (!this.config.signalFilters.marketStateFilter.includes(signal.marketState.regime)) {
      return false;
    }
    
    // 时间框架一致性过滤
    const timeframeAgreement = this.calculateTimeframeAgreement(signal.timeframeConsensus);
    if (timeframeAgreement < this.config.signalFilters.timeframeAgreement) {
      return false;
    }
    
    return true;
  }
  
  /**
   * 开新仓位
   */
  private async openNewPosition(signal: EnhancedSignal): Promise<void> {
    if (signal.action === 'HOLD') return;
    
    // 计算动态仓位大小
    const positionSize = this.calculateDynamicPositionSize(signal);
    
    // 计算止损止盈
    const { stopLoss, takeProfit } = this.calculateStopLevels(signal);
    
    // 创建仓位
    this.state.currentPosition = {
      symbol: this.config.symbol,
      side: signal.action === 'BUY' ? 'LONG' : 'SHORT',
      size: positionSize,
      entryPrice: 0, // 应该从市场数据获取
      entryTime: Date.now(),
      stopLoss,
      takeProfit,
      unrealizedPnl: 0
    };
    
    console.log(`[EnhancedETHAgent] 📈 开仓: ${signal.action} 仓位${(positionSize * 100).toFixed(1)}% 置信度${(signal.confidence * 100).toFixed(1)}%`);
    
    this.emit('positionOpened', this.state.currentPosition);
  }
  
  /**
   * 管理现有仓位
   */
  private async manageExistingPosition(signal: EnhancedSignal): Promise<void> {
    if (!this.state.currentPosition) return;
    
    const position = this.state.currentPosition;
    
    // 检查止损止盈
    // 检查信号反转
    // 检查时间限制
    // 更新追踪止损
    
    // 这里应该实现具体的仓位管理逻辑
  }
  
  /**
   * 平仓
   */
  private async closePosition(reason: string): Promise<void> {
    if (!this.state.currentPosition) return;
    
    console.log(`[EnhancedETHAgent] 📉 平仓: ${reason}`);
    
    // 更新统计
    this.updateTradeStatistics();
    
    this.state.currentPosition = null;
    this.emit('positionClosed', { reason });
  }
  
  // 辅助方法
  private initializeState(): EnhancedAgentState {
    return {
      isActive: false,
      mode: this.config.mode,
      currentPosition: null,
      performance: {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalReturn: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        currentCapital: 100000,
        avgWinPercent: 0,
        avgLossPercent: 0,
        profitFactor: 0,
        avgHoldingTime: 0,
        maxConsecutiveWins: 0,
        maxConsecutiveLosses: 0
      },
      signalQuality: {
        recentSignals: 0,
        accurateSignals: 0,
        currentAccuracy: 0,
        confidenceCalibration: 0,
        falsePositiveRate: 0,
        falseNegativeRate: 0
      },
      marketTracking: {
        currentRegime: 'UNKNOWN',
        regimeConfidence: 0,
        volatilityLevel: 'MEDIUM',
        trendStrength: 0,
        lastRegimeChange: 0
      }
    };
  }
  
  // 技术指标计算方法
  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1];
    
    const multiplier = 2 / (period + 1);
    let ema = prices[0];
    
    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
    }
    
    return ema;
  }
  
  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
  
  private calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macd = ema12 - ema26;
    
    // 简化的信号线计算
    const signal = macd * 0.9; // 应该是MACD的EMA
    const histogram = macd - signal;
    
    return { macd, signal, histogram };
  }
  
  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }
  
  // 占位符方法 - 需要实现
  private async fetchHistoricalData(symbol: string, timeframe: string, count: number): Promise<MarketData[]> {
    // 应该从您的数据服务获取真实历史数据
    return [];
  }
  
  private async updateMultiTimeframeData(): Promise<void> {
    // 更新多时间框架数据
  }
  
  private calculateTechnicalIndicators(): EnhancedSignal['technicalIndicators'] {
    return {
      trend: { ema: 0, macd: 0, adx: 0 },
      momentum: { rsi: 50, stoch: 50, williams: 50 },
      volatility: { atr: 0, bbands: 0 },
      volume: { obv: 0, vwap: 0 }
    };
  }
  
  private fuseMultiDimensionalData(enhancedData: EnhancedMarketData): EnhancedSignal['dataFusion'] {
    return {
      onchain: { whaleActivity: 0.5, networkHealth: 0.8 },
      sentiment: { fearGreed: 0.6, socialMedia: 0.5 },
      macro: { dxy: 0.5, rates: 0.5 },
      quality: { 
        completeness: enhancedData.dataQuality?.completeness || 80,
        reliability: enhancedData.dataQuality?.reliability || 80
      }
    };
  }
  
  private identifyMarketState(): EnhancedSignal['marketState'] {
    return {
      regime: 'TRENDING',
      phase: 'MARKUP',
      volatility: 'MEDIUM'
    };
  }
  
  private assessRisk(): EnhancedSignal['riskAssessment'] {
    return {
      entryRisk: 0.3,
      positionRisk: 0.2,
      marketRisk: 0.4,
      systemicRisk: 0.1
    };
  }
  
  private calculateTimeframeScore(consensus: EnhancedSignal['timeframeConsensus']): number {
    return 0.5; // 占位符
  }
  
  private calculateTechnicalScore(indicators: EnhancedSignal['technicalIndicators']): number {
    return 0.5; // 占位符
  }
  
  private calculateDataScore(fusion: EnhancedSignal['dataFusion']): number {
    return 0.5; // 占位符
  }
  
  private calculateMarketScore(state: EnhancedSignal['marketState']): number {
    return 0.5; // 占位符
  }
  
  private calculateTimeframeAgreement(consensus: EnhancedSignal['timeframeConsensus']): number {
    return 0.8; // 占位符
  }
  
  private calculateDynamicPositionSize(signal: EnhancedSignal): number {
    return 0.1; // 占位符
  }
  
  private calculateStopLevels(signal: EnhancedSignal): { stopLoss: number; takeProfit: number } {
    return { stopLoss: 0, takeProfit: 0 }; // 占位符
  }
  
  private analyzePriceAction(data: MarketData[]): { strength: number } {
    return { strength: 0.5 }; // 占位符
  }
  
  private updateAgentState(): void {
    // 更新Agent状态
  }
  
  private updateTradeStatistics(): void {
    // 更新交易统计
  }
  
  // 公共方法
  public getState(): EnhancedAgentState {
    return { ...this.state };
  }
  
  public getSignalHistory(limit: number = 100): EnhancedSignal[] {
    return this.signalHistory.slice(-limit);
  }
  
  public updateConfig(newConfig: Partial<EnhancedAgentConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('[EnhancedETHAgent] ⚙️ 配置已更新');
    this.emit('configUpdated', this.config);
  }
}

// 默认配置
export const defaultEnhancedConfig: EnhancedAgentConfig = {
  symbol: 'ETH-USDT-SWAP',
  mode: 'BACKTEST',
  
  signalFilters: {
    minConfidence: 0.7, // 提高到70%
    timeframeAgreement: 0.8, // 80%时间框架一致性
    dataQualityThreshold: 0.8, // 80%数据质量
    marketStateFilter: ['TRENDING', 'BREAKOUT'] // 只在趋势和突破时交易
  },
  
  positionManagement: {
    baseSize: 0.1, // 降低基础仓位到10%
    maxSize: 0.25, // 最大25%
    confidenceScaling: true,
    volatilityAdjustment: true,
    trendStrengthBonus: true
  },
  
  stopLossConfig: {
    method: 'ATR',
    basePercent: 0.015, // 1.5%基础止损
    atrMultiplier: 2.0,
    trailingEnabled: true
  },
  
  takeProfitConfig: {
    method: 'DYNAMIC',
    basePercent: 0.03, // 3%基础止盈
    partialTakeProfit: true,
    riskRewardRatio: 2.0 // 1:2风险收益比
  },
  
  timeManagement: {
    maxHoldingTime: 48, // 48小时最大持仓
    timeBasedExit: true,
    sessionFilters: ['ACTIVE'] // 只在活跃时段交易
  }
};

// 导出增强版Agent实例
export const enhancedETHAgent = new EnhancedETHAgent(defaultEnhancedConfig);