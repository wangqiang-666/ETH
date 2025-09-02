import { SmartSignalAnalyzer, SmartSignalResult } from '../analyzers/smart-signal-analyzer';
import type { MarketData, KlineData } from '../services/okx-data-service';
import { EnhancedOKXDataService } from '../services/enhanced-okx-data-service';
import { MLAnalyzer } from '../ml/ml-analyzer';
import { config } from '../config';
import NodeCache from 'node-cache';
import { riskManagementService, RiskAssessment, PositionRisk, PortfolioRisk } from '../services/risk-management-service';

// 交易策略结果
export interface StrategyResult {
  signal: SmartSignalResult;
  recommendation: {
    action: 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE_POSITION' | 'HOLD' | 'REDUCE_POSITION';
    confidence: number;
    urgency: 'HIGH' | 'MEDIUM' | 'LOW';
    timeframe: string;
  };
  riskManagement: {
    maxLoss: number;
    positionSize: number;
    leverage: number;
    stopLoss: number;
    takeProfit: number;
    riskScore: number;
  };
  marketAnalysis: {
    trend: string;
    volatility: string;
    momentum: string;
    support: number;
    resistance: number;
    keyLevels: number[];
  };
  performance: {
    expectedWinRate: number;
    riskRewardRatio: number;
    expectedReturn: number;
    maxDrawdown: number;
  };
  alerts: {
    level: 'INFO' | 'WARNING' | 'CRITICAL';
    message: string;
    timestamp: number;
  }[];
}

// 持仓信息
export interface Position {
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  timestamp: number;
  strategyId: string;
}

// 交易历史记录
export interface TradeRecord {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  action: 'OPEN' | 'CLOSE';
  size: number;
  price: number;
  pnl?: number;
  pnlPercent?: number;
  timestamp: number;
  strategySignal: SmartSignalResult;
  duration?: number; // 持仓时长（毫秒）
}

// 策略性能统计
export interface StrategyPerformance {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  totalPnlPercent: number;
  averageWin: number;
  averageLoss: number;
  maxWin: number;
  maxLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  averageHoldingTime: number;
  lastUpdated: number;
}

// ETH策略引擎
export class ETHStrategyEngine {
  private signalAnalyzer: SmartSignalAnalyzer;
  // private dataService: OKXDataService; // 已禁用基础服务
  private enhancedDataService: EnhancedOKXDataService;
  private mlAnalyzer: MLAnalyzer;
  private cache: NodeCache;
  private useEnhancedDataService: boolean = true;
  
  private currentPosition: Position | null = null;
  private tradeHistory: TradeRecord[] = [];
  private performance: StrategyPerformance;
  private isRunning = false;
  private lastAnalysisTime = 0;
  private analysisInterval = 30000; // 30秒分析一次
  
  // 风险控制参数
  private dailyLossLimit: number;
  private maxPositionSize: number;
  private currentDailyLoss = 0;
  private lastResetDate = new Date().toDateString();

  constructor() {
    this.signalAnalyzer = new SmartSignalAnalyzer();
    // this.dataService = new OKXDataService(); // 基础服务实例已移除
    this.enhancedDataService = new EnhancedOKXDataService();
    this.mlAnalyzer = new MLAnalyzer();
    this.cache = new NodeCache({ stdTTL: 300 }); // 5分钟缓存
    
    // 初始化风险控制参数
    this.dailyLossLimit = config.risk.maxDailyLoss;
    this.maxPositionSize = config.risk.maxPositionSize;
    
    // 初始化性能统计
    this.performance = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      averageWin: 0,
      averageLoss: 0,
      maxWin: 0,
      maxLoss: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      averageHoldingTime: 0,
      lastUpdated: Date.now()
    };
  }

  // 启动策略引擎
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Strategy engine is already running');
      return;
    }

    console.log('Starting ETH Strategy Engine...');
    
    // 初始化增强数据服务
    if (this.useEnhancedDataService) {
      console.log('🚀 初始化增强OKX数据服务...');
      
      // 检查增强服务连接
      const enhancedConnected = await this.enhancedDataService.checkConnection();
      if (enhancedConnected) {
        console.log('✅ 增强OKX数据服务连接成功');
      } else {
        console.warn('⚠️  增强服务连接失败，将在离线/降级模式下继续（不再回退基础服务）');
        // 不再将 useEnhancedDataService 置为 false，始终坚持使用增强服务（强制代理）
      }
    }
    
    // 取消基础服务连接检查与回退逻辑
    // if (!this.useEnhancedDataService) { ... }

    this.isRunning = true;
    this.runAnalysisLoop();
    
    console.log('ETH Strategy Engine started successfully');
  }

  // 停止策略引擎
  stop(): void {
    console.log('Stopping ETH Strategy Engine...');
    this.isRunning = false;
  }

  // 主要分析循环
  private async runAnalysisLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const now = Date.now();
        
        // 检查是否需要重置每日损失
        this.checkDailyReset();
        
        // 检查分析间隔
        if (now - this.lastAnalysisTime >= this.analysisInterval) {
          await this.performAnalysis();
          this.lastAnalysisTime = now;
        }
        
        // 更新当前持仓状态
        if (this.currentPosition) {
          await this.updatePositionStatus();
        }
        
        // 等待下一次检查
        await new Promise(resolve => setTimeout(resolve, 5000));
        
      } catch (error) {
        console.error('Analysis loop error:', error);
        await new Promise(resolve => setTimeout(resolve, 10000)); // 错误时等待更长时间
      }
    }
  }

  // 执行策略分析
  private async performAnalysis(): Promise<StrategyResult> {
    try {
      console.log('Performing strategy analysis...');
      
      // 1. 获取市场数据
      const marketData = await this.getMarketData();
      if (!marketData) {
        throw new Error('Failed to get market data');
      }

      // 2. 获取K线数据
      const klineData = await this.getKlineData();
      if (klineData.length === 0) {
        throw new Error('Failed to get kline data');
      }

      // 3. 执行智能信号分析
      const signalResult = await this.signalAnalyzer.analyzeSignal(marketData, klineData);
      
      // 4. 风险评估
      const riskAssessment = riskManagementService.assessSignalRisk(signalResult, marketData, this.currentPosition ? [this.currentPosition] : []);
      console.log(`⚠️ 风险等级: ${riskAssessment.riskLevel}, 评分: ${riskAssessment.riskScore}`);
      
      // 5. 检查是否可以开新仓
      const canTrade = riskManagementService.canOpenNewPosition(signalResult, marketData, this.currentPosition ? [this.currentPosition] : []);
      if (!canTrade.allowed) {
        console.log(`🚫 无法开仓: ${canTrade.reason}`);
      }
      
      // 6. 生成策略结果
      const strategyResult = await this.generateStrategyResult(signalResult, marketData, riskAssessment);
      
      // 7. 执行交易决策
      await this.executeTradeDecision(strategyResult, riskAssessment, canTrade);
      
      // 8. 缓存结果
      this.cache.set('latest_analysis', strategyResult);
      
      console.log(`Analysis completed. Signal: ${signalResult.signal}, Confidence: ${signalResult.strength.confidence.toFixed(2)}`);
      
      return strategyResult;
      
    } catch (error) {
      console.error('Strategy analysis failed:', error);
      throw error;
    }
  }

  // 获取市场数据
  private async getMarketData(): Promise<MarketData | null> {
    const cacheKey = 'market_data';
    let marketData: MarketData | null = this.cache.get<MarketData>(cacheKey) || null;
    
    if (!marketData) {
      try {
        // 仅使用增强数据服务（强制代理）
        marketData = await this.enhancedDataService.getTicker(config.trading.defaultSymbol);
        if (marketData) {
          const [fundingRate, openInterest] = await Promise.all([
            this.enhancedDataService.getFundingRate(config.trading.defaultSymbol),
            this.enhancedDataService.getOpenInterest(config.trading.defaultSymbol)
          ]);
          marketData.fundingRate = fundingRate || 0;
          marketData.openInterest = openInterest || 0;
          this.cache.set(cacheKey, marketData, 30); // 30秒缓存
        }
      } catch (error) {
        console.error('Failed to get market data (enhanced):', error);
        return marketData; // 返回可能的缓存/部分结果或 null
      }
    }
    
    return marketData || null;
  }

  // 获取K线数据
  private async getKlineData(): Promise<KlineData[]> {
    const cacheKey = 'kline_data';
    let klineData = this.cache.get<KlineData[]>(cacheKey);
    
    if (!klineData) {
      try {
        // 仅使用增强数据服务（强制代理）
        klineData = await this.enhancedDataService.getKlineData(
          config.trading.defaultSymbol,
          '1m',
          200
        );
        if (klineData && klineData.length > 0) {
          this.cache.set(cacheKey, klineData, 60); // 1分钟缓存
        }
      } catch (error) {
        console.error('Failed to get kline data (enhanced):', error);
        klineData = [];
      }
    }
    
    return klineData || [];
  }

  // 生成策略结果
  private async generateStrategyResult(
    signalResult: SmartSignalResult,
    marketData: MarketData,
    riskAssessment: RiskAssessment
  ): Promise<StrategyResult> {
    // 计算支撑阻力位
    const keyLevels = await this.calculateKeyLevels(marketData.price);
    
    // 生成交易建议
    const recommendation = this.generateRecommendation(signalResult, marketData, riskAssessment);
    
    // 计算风险管理参数
    const riskManagement = this.calculateRiskManagement(signalResult, marketData, riskAssessment);
    
    // 预测性能指标
    const performance = this.predictPerformance(signalResult);
    
    // 生成警告信息
    const alerts = this.generateAlerts(signalResult, marketData, riskManagement);

    return {
      signal: signalResult,
      recommendation,
      riskManagement,
      marketAnalysis: {
        trend: signalResult.metadata.marketCondition,
        volatility: signalResult.metadata.volatility > 0.6 ? 'HIGH' : signalResult.metadata.volatility < 0.3 ? 'LOW' : 'MEDIUM',
        momentum: signalResult.metadata.momentum,
        support: keyLevels.support,
        resistance: keyLevels.resistance,
        keyLevels: keyLevels.levels
      },
      performance,
      alerts
    };
  }

  // 生成交易建议
  private generateRecommendation(
    signalResult: SmartSignalResult,
    marketData: MarketData,
    riskAssessment: RiskAssessment
  ): StrategyResult['recommendation'] {
    let action: StrategyResult['recommendation']['action'] = 'HOLD';
    let urgency: StrategyResult['recommendation']['urgency'] = 'LOW';
    
    // 检查是否超过每日损失限制
    if (this.currentDailyLoss >= this.dailyLossLimit) {
      return {
        action: 'HOLD',
        confidence: 0,
        urgency: 'LOW',
        timeframe: '暂停交易'
      };
    }

    // 如果有持仓，优先考虑平仓
    if (this.currentPosition) {
      const shouldClose = this.shouldClosePosition(signalResult, marketData);
      if (shouldClose.close) {
        return {
          action: 'CLOSE_POSITION',
          confidence: shouldClose.confidence,
          urgency: shouldClose.urgency,
          timeframe: signalResult.timeframe
        };
      }
      
      // 检查是否需要减仓
      if (shouldClose.reduce) {
        return {
          action: 'REDUCE_POSITION',
          confidence: shouldClose.confidence * 0.7,
          urgency: 'MEDIUM',
          timeframe: signalResult.timeframe
        };
      }
    }

    // 新开仓逻辑 - 考虑风险评估
    if (!this.currentPosition && signalResult.strength.confidence >= config.strategy.signalThreshold && riskAssessment.riskLevel !== 'EXTREME') {
      if (signalResult.signal === 'STRONG_BUY' || signalResult.signal === 'BUY') {
        action = 'OPEN_LONG';
        urgency = signalResult.signal === 'STRONG_BUY' && riskAssessment.riskLevel === 'LOW' ? 'HIGH' : 'MEDIUM';
      } else if (signalResult.signal === 'STRONG_SELL' || signalResult.signal === 'SELL') {
        action = 'OPEN_SHORT';
        urgency = signalResult.signal === 'STRONG_SELL' && riskAssessment.riskLevel === 'LOW' ? 'HIGH' : 'MEDIUM';
      }
    }

    return {
      action,
      confidence: signalResult.strength.confidence * (riskAssessment.riskLevel === 'LOW' ? 1 : riskAssessment.riskLevel === 'MEDIUM' ? 0.8 : 0.5),
      urgency,
      timeframe: signalResult.timeframe
    };
  }

  // 判断是否应该平仓
  private shouldClosePosition(
    signalResult: SmartSignalResult,
    marketData: MarketData
  ): { close: boolean; reduce: boolean; confidence: number; urgency: StrategyResult['recommendation']['urgency'] } {
    if (!this.currentPosition) {
      return { close: false, reduce: false, confidence: 0, urgency: 'LOW' };
    }

    const position = this.currentPosition;
    const currentPrice = marketData.price;
    const pnlPercent = position.unrealizedPnlPercent;

    // 止损条件
    if ((position.side === 'LONG' && currentPrice <= position.stopLoss) ||
        (position.side === 'SHORT' && currentPrice >= position.stopLoss)) {
      return { close: true, reduce: false, confidence: 0.9, urgency: 'HIGH' };
    }

    // 止盈条件
    if ((position.side === 'LONG' && currentPrice >= position.takeProfit) ||
        (position.side === 'SHORT' && currentPrice <= position.takeProfit)) {
      return { close: true, reduce: false, confidence: 0.8, urgency: 'MEDIUM' };
    }

    // 信号反转条件
    if ((position.side === 'LONG' && (signalResult.signal === 'SELL' || signalResult.signal === 'STRONG_SELL')) ||
        (position.side === 'SHORT' && (signalResult.signal === 'BUY' || signalResult.signal === 'STRONG_BUY'))) {
      const confidence = signalResult.strength.confidence;
      if (confidence >= 0.8) {
        return { close: true, reduce: false, confidence, urgency: 'HIGH' };
      } else if (confidence >= 0.6) {
        return { close: false, reduce: true, confidence, urgency: 'MEDIUM' };
      }
    }

    // 时间止损（持仓超过24小时且亏损）
    const holdingTime = Date.now() - position.timestamp;
    if (holdingTime > 24 * 60 * 60 * 1000 && pnlPercent < -2) {
      return { close: true, reduce: false, confidence: 0.6, urgency: 'MEDIUM' };
    }

    return { close: false, reduce: false, confidence: 0, urgency: 'LOW' };
  }

  // 计算风险管理参数
  private calculateRiskManagement(
    signalResult: SmartSignalResult,
    marketData: MarketData,
    riskAssessment: RiskAssessment
  ): StrategyResult['riskManagement'] {
    const basePositionSize = Math.min(riskAssessment.maxAllowedPosition, this.maxPositionSize);
    
    // 根据每日损失调整仓位
    const dailyLossRatio = this.currentDailyLoss / this.dailyLossLimit;
    const adjustedPositionSize = basePositionSize * (1 - dailyLossRatio * 0.5);
    
    // 使用风险管理服务推荐的杠杆
    const recommendedLeverage = riskAssessment.recommendedLeverage;
    
    // 计算最大损失
    const maxLoss = adjustedPositionSize * config.risk.stopLossPercent / 100;
    
    return {
      maxLoss,
      positionSize: Math.max(0.01, adjustedPositionSize),
      leverage: recommendedLeverage,
      stopLoss: riskAssessment.stopLossPrice,
      takeProfit: riskAssessment.takeProfitPrice,
      riskScore: riskAssessment.riskScore
    };
  }

  // 计算综合风险评分
  private calculateOverallRiskScore(
    signalResult: SmartSignalResult,
    marketData: MarketData
  ): number {
    let riskScore = 5; // 基础风险评分
    
    // 市场波动性风险
    if (signalResult.metadata.volatility > 0.7) riskScore += 2;
    else if (signalResult.metadata.volatility < 0.3) riskScore -= 1;
    
    // 成交量风险
    if (signalResult.metadata.volume === 'LOW') riskScore += 1;
    
    // 资金费率风险
    if (marketData.fundingRate && Math.abs(marketData.fundingRate) > 0.01) {
      riskScore += 1;
    }
    
    // 每日损失风险
    const dailyLossRatio = this.currentDailyLoss / this.dailyLossLimit;
    riskScore += dailyLossRatio * 3;
    
    // 信号置信度风险
    if (signalResult.strength.confidence < 0.6) riskScore += 2;
    
    return Math.max(1, Math.min(10, riskScore));
  }

  // 预测性能指标
  private predictPerformance(signalResult: SmartSignalResult): StrategyResult['performance'] {
    // 基于历史表现和当前信号强度预测
    const baseWinRate = this.performance.winRate || 0.6;
    const confidenceBonus = (signalResult.strength.confidence - 0.5) * 0.2;
    const expectedWinRate = Math.min(0.9, Math.max(0.3, baseWinRate + confidenceBonus));
    
    const expectedReturn = signalResult.riskReward * expectedWinRate - (1 - expectedWinRate);
    
    return {
      expectedWinRate,
      riskRewardRatio: signalResult.riskReward,
      expectedReturn,
      maxDrawdown: this.performance.maxDrawdown || 0.1
    };
  }

  // 生成警告信息
  private generateAlerts(
    signalResult: SmartSignalResult,
    marketData: MarketData,
    riskManagement: StrategyResult['riskManagement']
  ): StrategyResult['alerts'] {
    const alerts: StrategyResult['alerts'] = [];
    
    // 高风险警告
    if (riskManagement.riskScore >= 8) {
      alerts.push({
        level: 'CRITICAL',
        message: '当前市场风险极高，建议谨慎操作或暂停交易',
        timestamp: Date.now()
      });
    } else if (riskManagement.riskScore >= 6) {
      alerts.push({
        level: 'WARNING',
        message: '市场风险较高，建议减少仓位',
        timestamp: Date.now()
      });
    }
    
    // 每日损失警告
    const dailyLossRatio = this.currentDailyLoss / this.dailyLossLimit;
    if (dailyLossRatio >= 0.8) {
      alerts.push({
        level: 'CRITICAL',
        message: '接近每日损失限制，建议停止交易',
        timestamp: Date.now()
      });
    } else if (dailyLossRatio >= 0.6) {
      alerts.push({
        level: 'WARNING',
        message: '每日损失较大，建议控制风险',
        timestamp: Date.now()
      });
    }
    
    // 低置信度警告
    if (signalResult.strength.confidence < 0.5) {
      alerts.push({
        level: 'WARNING',
        message: '信号置信度较低，建议观望',
        timestamp: Date.now()
      });
    }
    
    // 市场异常警告
    if (marketData.change24h > 15 || marketData.change24h < -15) {
      alerts.push({
        level: 'WARNING',
        message: '市场波动异常，注意风险控制',
        timestamp: Date.now()
      });
    }
    
    return alerts;
  }

  // 执行交易决策
  private async executeTradeDecision(strategyResult: StrategyResult, riskAssessment: RiskAssessment, canTrade: { allowed: boolean; reason?: string }): Promise<void> {
    const { recommendation, riskManagement } = strategyResult;
    
    // 这里是模拟交易，实际应该调用交易API
    console.log(`Trade Decision: ${recommendation.action}, Confidence: ${recommendation.confidence.toFixed(2)}`);
    
    // 检查是否允许交易
    if (!canTrade.allowed && (recommendation.action === 'OPEN_LONG' || recommendation.action === 'OPEN_SHORT')) {
      console.log(`🚫 交易被风险管理限制: ${canTrade.reason}`);
      return;
    }
    
    switch (recommendation.action) {
      case 'OPEN_LONG':
        await this.openPosition('LONG', riskManagement, strategyResult, riskAssessment);
        break;
      case 'OPEN_SHORT':
        await this.openPosition('SHORT', riskManagement, strategyResult, riskAssessment);
        break;
      case 'CLOSE_POSITION':
        await this.closePosition(strategyResult);
        break;
      case 'REDUCE_POSITION':
        await this.reducePosition(0.5, strategyResult);
        break;
      default:
        // HOLD - 不执行任何操作
        break;
    }
  }

  // 开仓
  private async openPosition(
    side: 'LONG' | 'SHORT',
    riskManagement: StrategyResult['riskManagement'],
    strategyResult: StrategyResult,
    riskAssessment: RiskAssessment
  ): Promise<void> {
    if (this.currentPosition) {
      console.log('Already have position, cannot open new one');
      return;
    }

    const marketData = await this.getMarketData();
    if (!marketData) return;

    const position: Position = {
      symbol: config.trading.defaultSymbol,
      side,
      size: riskManagement.positionSize,
      entryPrice: marketData.price,
      currentPrice: marketData.price,
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0,
      leverage: riskManagement.leverage,
      stopLoss: riskManagement.stopLoss,
      takeProfit: riskManagement.takeProfit,
      timestamp: Date.now(),
      strategyId: `strategy_${Date.now()}`
    };

    this.currentPosition = position;
    
    // 记录交易
    const tradeRecord: TradeRecord = {
      id: `trade_${Date.now()}`,
      symbol: position.symbol,
      side: position.side,
      action: 'OPEN',
      size: position.size,
      price: position.entryPrice,
      timestamp: position.timestamp,
      strategySignal: strategyResult.signal
    };
    
    this.tradeHistory.push(tradeRecord);
    
    console.log(`Opened ${side} position: ${position.size} at ${position.entryPrice} (Risk Level: ${riskAssessment.riskLevel})`);
  }

  // 平仓
  private async closePosition(strategyResult: StrategyResult): Promise<void> {
    if (!this.currentPosition) {
      console.log('No position to close');
      return;
    }

    const marketData = await this.getMarketData();
    if (!marketData) return;

    const position = this.currentPosition;
    const closePrice = marketData.price;
    const pnl = this.calculatePnL(position, closePrice);
    const pnlPercent = (pnl / (position.entryPrice * position.size)) * 100;
    const duration = Date.now() - position.timestamp;

    // 记录交易
    const tradeRecord: TradeRecord = {
      id: `trade_${Date.now()}`,
      symbol: position.symbol,
      side: position.side,
      action: 'CLOSE',
      size: position.size,
      price: closePrice,
      pnl,
      pnlPercent,
      timestamp: Date.now(),
      strategySignal: strategyResult.signal,
      duration
    };
    
    this.tradeHistory.push(tradeRecord);
    
    // 更新每日损失
    if (pnl < 0) {
      this.currentDailyLoss += Math.abs(pnl);
    }
    
    // 更新性能统计
    this.updatePerformanceStats(tradeRecord);
    
    console.log(`Closed ${position.side} position: PnL = ${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
    
    this.currentPosition = null;
  }

  // 减仓
  private async reducePosition(
    reductionRatio: number,
    strategyResult: StrategyResult
  ): Promise<void> {
    if (!this.currentPosition) return;

    const marketData = await this.getMarketData();
    if (!marketData) return;

    const position = this.currentPosition;
    const reduceSize = position.size * reductionRatio;
    const closePrice = marketData.price;
    const pnl = this.calculatePnL({ ...position, size: reduceSize }, closePrice);
    
    // 更新持仓
    position.size -= reduceSize;
    
    // 记录部分平仓交易
    const tradeRecord: TradeRecord = {
      id: `trade_${Date.now()}`,
      symbol: position.symbol,
      side: position.side,
      action: 'CLOSE',
      size: reduceSize,
      price: closePrice,
      pnl,
      pnlPercent: (pnl / (position.entryPrice * reduceSize)) * 100,
      timestamp: Date.now(),
      strategySignal: strategyResult.signal
    };
    
    this.tradeHistory.push(tradeRecord);
    
    console.log(`Reduced position by ${(reductionRatio * 100).toFixed(1)}%`);
  }

  // 更新持仓状态
  private async updatePositionStatus(): Promise<void> {
    if (!this.currentPosition) return;

    const marketData = await this.getMarketData();
    if (!marketData) return;

    const position = this.currentPosition;
    position.currentPrice = marketData.price;
    position.unrealizedPnl = this.calculatePnL(position, marketData.price);
    position.unrealizedPnlPercent = (position.unrealizedPnl / (position.entryPrice * position.size)) * 100;
    
    // 分析持仓风险
    const positionRisk = riskManagementService.analyzePositionRisk(position, marketData.price);
    if (positionRisk.distanceToLiquidation < 0.1) {
      console.log(`⚠️ 警告: 距离强平价格过近 ${(positionRisk.distanceToLiquidation * 100).toFixed(2)}%`);
    }
  }

  // 计算盈亏
  private calculatePnL(position: Position, currentPrice: number): number {
    const priceChange = position.side === 'LONG' 
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;
    
    return priceChange * position.size * position.leverage;
  }

  // 计算关键价位
  private async calculateKeyLevels(currentPrice: number): Promise<{
    support: number;
    resistance: number;
    levels: number[];
  }> {
    // 简化的支撑阻力计算，实际应该基于历史价格数据
    const range = currentPrice * 0.02; // 2%范围
    
    return {
      support: currentPrice - range,
      resistance: currentPrice + range,
      levels: [
        currentPrice - range * 2,
        currentPrice - range,
        currentPrice,
        currentPrice + range,
        currentPrice + range * 2
      ]
    };
  }

  // 更新性能统计
  private updatePerformanceStats(trade: TradeRecord): void {
    if (trade.action !== 'CLOSE' || trade.pnl === undefined) return;

    this.performance.totalTrades++;
    this.performance.totalPnl += trade.pnl;
    this.performance.totalPnlPercent += trade.pnlPercent || 0;

    if (trade.pnl > 0) {
      this.performance.winningTrades++;
      this.performance.maxWin = Math.max(this.performance.maxWin, trade.pnl);
    } else {
      this.performance.losingTrades++;
      this.performance.maxLoss = Math.min(this.performance.maxLoss, trade.pnl);
    }

    this.performance.winRate = this.performance.winningTrades / this.performance.totalTrades;
    
    // 计算平均盈亏
    if (this.performance.winningTrades > 0) {
      const totalWins = this.tradeHistory
        .filter(t => t.action === 'CLOSE' && (t.pnl || 0) > 0)
        .reduce((sum, t) => sum + (t.pnl || 0), 0);
      this.performance.averageWin = totalWins / this.performance.winningTrades;
    }
    
    if (this.performance.losingTrades > 0) {
      const totalLosses = this.tradeHistory
        .filter(t => t.action === 'CLOSE' && (t.pnl || 0) < 0)
        .reduce((sum, t) => sum + (t.pnl || 0), 0);
      this.performance.averageLoss = totalLosses / this.performance.losingTrades;
    }

    // 计算盈利因子
    if (this.performance.averageLoss !== 0) {
      this.performance.profitFactor = Math.abs(this.performance.averageWin / this.performance.averageLoss);
    }

    this.performance.lastUpdated = Date.now();
  }

  // 检查每日重置
  private checkDailyReset(): void {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.currentDailyLoss = 0;
      this.lastResetDate = today;
      console.log('Daily loss counter reset');
    }
  }

  // 获取当前状态
  getCurrentStatus(): {
    isRunning: boolean;
    position: Position | null;
    performance: StrategyPerformance;
    dailyLoss: number;
    dailyLossLimit: number;
  } {
    return {
      isRunning: this.isRunning,
      position: this.currentPosition,
      performance: this.performance,
      dailyLoss: this.currentDailyLoss,
      dailyLossLimit: this.dailyLossLimit
    };
  }

  // 获取最新分析结果
  getLatestAnalysis(): StrategyResult | null {
    return this.cache.get<StrategyResult>('latest_analysis') || null;
  }

  // 获取交易历史
  getTradeHistory(limit: number = 50): TradeRecord[] {
    return this.tradeHistory.slice(-limit);
  }

  // 设置分析间隔
  setAnalysisInterval(intervalMs: number): void {
    this.analysisInterval = Math.max(10000, intervalMs); // 最小10秒
  }

  // 切换数据服务
  async switchDataService(useEnhanced: boolean): Promise<boolean> {
    if (useEnhanced && !this.useEnhancedDataService) {
      console.log('🔄 切换到增强数据服务...');
      try {
        await this.enhancedDataService.initialize();
        const connected = await this.enhancedDataService.checkConnection();
        if (connected) {
          this.useEnhancedDataService = true;
          console.log('✅ 成功切换到增强数据服务');
          return true;
        } else {
          console.warn('⚠️  增强数据服务连接失败');
          return false;
        }
      } catch (error) {
        console.error('切换到增强数据服务失败:', error);
        return false;
      }
    } else if (!useEnhanced && this.useEnhancedDataService) {
      console.log('🔄 切换到基础数据服务...');
      this.useEnhancedDataService = false;
      console.log('✅ 成功切换到基础数据服务');
      return true;
    }
    return true;
  }

  // 获取数据服务状态
  getDataServiceStatus(): {
    usingEnhanced: boolean;
    enhancedServiceHealth?: any;
    basicServiceConnected?: boolean;
  } {
    const status: any = {
      usingEnhanced: this.useEnhancedDataService
    };

    if (this.useEnhancedDataService) {
      status.enhancedServiceHealth = this.enhancedDataService.getHealthStatus();
    }

    return status;
  }
}

// 导出单例实例
export const ethStrategyEngine = new ETHStrategyEngine();