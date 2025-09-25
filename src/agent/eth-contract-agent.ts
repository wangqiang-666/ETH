import { EventEmitter } from 'events';
import { SmartSignalAnalyzer, SmartSignalResult } from '../analyzers/smart-signal-analyzer.js';
import { BacktestEngine, BacktestConfig, BacktestResult, BacktestTrade } from '../backtest/backtest-engine.js';
import { enhancedDataIntegrationService, EnhancedMarketData } from '../services/enhanced-data-integration-service.js';
import { dataQualityManager, DataSourceQuality } from '../utils/data-quality-manager.js';
import { riskManagementService, RiskAssessment } from '../services/risk-management-service.js';
import type { MarketData } from '../services/okx-data-service.js';
import { config } from '../config.js';

/**
 * Agent决策结果
 */
export interface AgentDecision {
  // 决策ID
  decisionId: string;
  timestamp: number;
  
  // 主决策
  primaryAction: 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE_LONG' | 'CLOSE_SHORT' | 'HOLD' | 'ADJUST_POSITION';
  
  // 决策置信度 (0-1)
  confidence: number;
  
  // 执行参数
  execution: {
    symbol: string;
    size: number;           // 仓位大小 (0-1)
    leverage: number;       // 杠杆倍数
    stopLoss: number;       // 止损价格
    takeProfit: number;     // 止盈价格
    urgency: 'IMMEDIATE' | 'HIGH' | 'MEDIUM' | 'LOW';
    maxSlippage: number;    // 最大滑点
  };
  
  // 决策依据
  reasoning: {
    primaryFactors: string[];     // 主要决策因素
    riskFactors: string[];        // 风险因素
    marketCondition: string;      // 市场状况
    dataQuality: number;          // 数据质量分数
    signalStrength: number;       // 信号强度
    riskScore: number;            // 风险评分
  };
  
  // 预期结果
  expectations: {
    expectedReturn: number;       // 预期收益率
    expectedRisk: number;         // 预期风险
    holdingTime: number;          // 预期持仓时间(ms)
    winProbability: number;       // 胜率预期
  };
}

/**
 * Agent状态
 */
export interface AgentState {
  // 基本状态
  isActive: boolean;
  mode: 'BACKTEST' | 'PAPER_TRADING' | 'LIVE_TRADING';
  
  // 当前仓位
  currentPosition: {
    symbol: string;
    side: 'LONG' | 'SHORT' | null;
    size: number;
    entryPrice: number;
    currentPrice: number;
    unrealizedPnl: number;
    leverage: number;
  } | null;
  
  // 性能指标
  performance: {
    totalTrades: number;
    winRate: number;
    totalReturn: number;
    maxDrawdown: number;
    sharpeRatio: number;
    currentCapital: number;
  };
  
  // 风险状态
  riskStatus: {
    currentRisk: number;
    dailyLoss: number;
    maxDailyLoss: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  };
  
  // 学习状态
  learningStatus: {
    totalDecisions: number;
    correctDecisions: number;
    accuracy: number;
    lastLearningUpdate: number;
  };
}

/**
 * Agent配置
 */
export interface AgentConfig {
  // 基本配置
  symbol: string;
  mode: 'BACKTEST' | 'PAPER_TRADING' | 'LIVE_TRADING';
  
  // 决策配置
  decisionInterval: number;     // 决策间隔(ms)
  minConfidence: number;        // 最小置信度阈值
  maxPositionSize: number;      // 最大仓位比例
  
  // 风险配置
  maxDailyLoss: number;         // 最大日损失
  maxDrawdown: number;          // 最大回撤
  stopLossPercent: number;      // 止损百分比
  takeProfitPercent: number;    // 止盈百分比
  
  // 学习配置
  learningEnabled: boolean;     // 是否启用学习
  learningRate: number;         // 学习率
  adaptationPeriod: number;     // 适应周期(ms)
  
  // 回测配置
  backtestConfig?: BacktestConfig;
}

/**
 * ETH合约智能Agent
 */
export class ETHContractAgent extends EventEmitter {
  private config: AgentConfig;
  private state: AgentState;
  private signalAnalyzer: SmartSignalAnalyzer;
  private backtestEngine: BacktestEngine;
  
  // 历史记录
  private decisionHistory: AgentDecision[] = [];
  private performanceHistory: { timestamp: number; performance: AgentState['performance'] }[] = [];
  
  // 学习数据
  private learningData: {
    decisions: AgentDecision[];
    outcomes: { decisionId: string; actualReturn: number; success: boolean }[];
    patterns: Map<string, { success: number; total: number; avgReturn: number }>;
  };
  
  // 运行状态
  private isRunning: boolean = false;
  private decisionTimer: NodeJS.Timeout | null = null;
  private lastDecisionTime: number = 0;

  constructor(config: AgentConfig) {
    super();
    
    this.config = config;
    this.state = this.initializeState();
    this.signalAnalyzer = new SmartSignalAnalyzer();
    this.backtestEngine = new BacktestEngine(
      config.backtestConfig || this.getDefaultBacktestConfig()
    );
    
    this.learningData = {
      decisions: [],
      outcomes: [],
      patterns: new Map()
    };
    
    // 绑定事件监听器
    this.setupEventListeners();
  }

  /**
   * 启动Agent
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Agent is already running');
    }

    try {
      // 初始化数据服务
      if (!enhancedDataIntegrationService.getHealthStatus().isHealthy) {
        await enhancedDataIntegrationService.initialize();
      }

      this.isRunning = true;
      this.state.isActive = true;
      
      // 启动决策循环
      this.startDecisionLoop();
      
      this.emit('started', { timestamp: Date.now() });
      
    } catch (error) {
      this.isRunning = false;
      this.state.isActive = false;
      throw error;
    }
  }

  /**
   * 停止Agent
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      this.isRunning = false;
      this.state.isActive = false;
      
      // 停止决策循环
      if (this.decisionTimer) {
        clearInterval(this.decisionTimer);
        this.decisionTimer = null;
      }
      
      // 平仓所有持仓
      if (this.state.currentPosition) {
        await this.closeAllPositions('Agent停止');
      }
      
      this.emit('stopped', { timestamp: Date.now() });
      
    } catch (error) {
      console.error('Error stopping agent:', error);
      throw error;
    }
  }

  /**
   * 运行历史回测
   */
  public async runHistoricalBacktest(
    startDate: Date,
    endDate: Date,
    marketDataHistory: MarketData[]
  ): Promise<BacktestResult> {
    try {
      // 配置回测引擎
      const backtestConfig: BacktestConfig = {
        startDate,
        endDate,
        initialCapital: 100000,
        maxPositionSize: this.config.maxPositionSize,
        tradingFee: 0.001,
        slippage: 0.0005,
        maxHoldingTime: 24,
        riskManagement: {
          maxDailyLoss: this.config.maxDailyLoss,
          maxDrawdown: this.config.maxDrawdown,
          positionSizing: 'RISK_PARITY'
        }
      };

      // 运行回测 - 需要转换数据格式
      const signalData = marketDataHistory.map(data => ({
        timestamp: data.timestamp,
        signal: { signal: 'HOLD' } as SmartSignalResult, // 简化的信号
        marketData: data
      }));

      const backtestResult = await this.backtestEngine.runBacktest(
        signalData,
        marketDataHistory
      );

      // 从回测结果中学习
      if (this.config.learningEnabled) {
        await this.updateLearningFromBacktest(backtestResult);
      }

      return backtestResult;
      
    } catch (error) {
      console.error('Backtest failed:', error);
      throw error;
    }
  }

  /**
   * 做出交易决策
   */
  public async makeDecision(): Promise<AgentDecision | null> {
    try {
      // 检查是否可以做决策
      const now = Date.now();
      if (now - this.lastDecisionTime < this.config.decisionInterval) {
        return null;
      }

      // 获取市场数据
      const marketData = await enhancedDataIntegrationService.getEnhancedMarketData(this.config.symbol);
      if (!marketData) {
        return null;
      }

      // 评估数据质量
      const dataQuality = this.evaluateDataQuality(marketData);
      if (dataQuality < 0.5) {
        return null; // 数据质量太低，跳过决策
      }

      // 生成交易信号
      const signal = await this.signalAnalyzer.analyzeSignal(marketData, []);
      
      // 使用风险管理服务进行完整评估
      const riskAssessment = riskManagementService.assessSignalRisk(signal, marketData);

      const decision = await this.generateDecision(signal, marketData, riskAssessment, dataQuality);
      
      // 记录决策
      this.decisionHistory.push(decision);
      this.lastDecisionTime = now;
      
      // 更新学习数据
      if (this.config.learningEnabled) {
        this.learningData.decisions.push(decision);
      }
      
      this.emit('decision', decision);
      
      return decision;
      
    } catch (error) {
      console.error('Decision making failed:', error);
      return null;
    }
  }

  /**
   * 获取当前状态
   */
  public getState(): AgentState {
    return { ...this.state };
  }

  /**
   * 获取决策历史
   */
  public getDecisionHistory(limit: number = 100): AgentDecision[] {
    return this.decisionHistory.slice(-limit);
  }

  /**
   * 获取性能历史
   */
  public getPerformanceHistory(): { timestamp: number; performance: AgentState['performance'] }[] {
    return [...this.performanceHistory];
  }

  /**
   * 更新配置
   */
  public updateConfig(newConfig: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit('configUpdated', this.config);
  }

  /**
   * 获取学习统计
   */
  public getLearningStats(): {
    totalDecisions: number;
    totalOutcomes: number;
    accuracy: number;
    topPatterns: Array<{ pattern: string; success: number; total: number; successRate: number; avgReturn: number }>;
  } {
    const topPatterns = Array.from(this.learningData.patterns.entries())
      .map(([pattern, data]) => ({
        pattern,
        success: data.success,
        total: data.total,
        successRate: data.success / data.total,
        avgReturn: data.avgReturn
      }))
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, 10);

    return {
      totalDecisions: this.learningData.decisions.length,
      totalOutcomes: this.learningData.outcomes.length,
      accuracy: this.state.learningStatus.accuracy,
      topPatterns
    };
  }

  // 私有方法

  private startDecisionLoop(): void {
    this.decisionTimer = setInterval(async () => {
      try {
        await this.makeDecision();
      } catch (error) {
        console.error('Decision loop error:', error);
      }
    }, this.config.decisionInterval);
  }

  private async generateDecision(
    signal: SmartSignalResult,
    enhancedData: EnhancedMarketData,
    riskAssessment: RiskAssessment,
    dataQuality: number
  ): Promise<AgentDecision> {
    
    // 确定主要行动
    let primaryAction: AgentDecision['primaryAction'] = 'HOLD';
    
    if (signal.signal === 'STRONG_BUY' || signal.signal === 'BUY') {
      primaryAction = this.state.currentPosition?.side === 'SHORT' ? 'CLOSE_SHORT' : 'OPEN_LONG';
    } else if (signal.signal === 'STRONG_SELL' || signal.signal === 'SELL') {
      primaryAction = this.state.currentPosition?.side === 'LONG' ? 'CLOSE_LONG' : 'OPEN_SHORT';
    }

    // 检查是否应该平仓
    if (this.state.currentPosition && this.shouldClosePosition(signal, riskAssessment)) {
      primaryAction = this.state.currentPosition.side === 'LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT';
    }

    const confidence = signal.strength.confidence;
    
    // 检查最小置信度
    if (confidence < this.config.minConfidence && primaryAction !== 'HOLD') {
      primaryAction = 'HOLD';
    }

    const decision: AgentDecision = {
      decisionId: `decision_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      primaryAction,
      confidence,
      execution: this.calculateExecutionParameters(primaryAction, signal, enhancedData, riskAssessment),
      reasoning: this.generateReasoning(signal, enhancedData, riskAssessment, dataQuality),
      expectations: this.calculateExpectations(signal, primaryAction, confidence)
    };

    return decision;
  }

  private calculateExecutionParameters(
    action: AgentDecision['primaryAction'],
    signal: SmartSignalResult,
    enhancedData: EnhancedMarketData,
    riskAssessment: RiskAssessment
  ): AgentDecision['execution'] {
    const baseSize = Math.min(this.config.maxPositionSize, signal.strength.confidence * 0.5);
    
    return {
      symbol: this.config.symbol,
      size: Math.max(0.01, baseSize * riskAssessment.maxAllowedPosition),
      leverage: Math.min(10, Math.max(1, Math.floor(signal.strength.confidence * 15))),
      stopLoss: riskAssessment.stopLossPrice,
      takeProfit: riskAssessment.takeProfitPrice,
      urgency: signal.strength.confidence > 0.8 ? 'HIGH' : signal.strength.confidence > 0.6 ? 'MEDIUM' : 'LOW',
      maxSlippage: 0.001
    };
  }

  private generateReasoning(
    signal: SmartSignalResult,
    enhancedData: EnhancedMarketData,
    riskAssessment: RiskAssessment,
    dataQuality: number
  ): AgentDecision['reasoning'] {
    const primaryFactors: string[] = [];
    const riskFactors: string[] = [];
    
    // 基于信号强度分析主要因素
    if (signal.strength.technical > 70) primaryFactors.push('强技术信号');
    if (signal.strength.ml > 70) primaryFactors.push('高ML置信度');
    if (signal.strength.combined > 80) primaryFactors.push('综合信号强烈');
    
    // 基于风险评估分析风险因素
    if (riskAssessment.riskLevel === 'HIGH' || riskAssessment.riskLevel === 'VERY_HIGH') {
      riskFactors.push('高风险环境');
    }
    if (dataQuality < 0.7) riskFactors.push('数据质量较低');
    
    // 市场状况分析 - 使用可用的属性
    let marketCondition = '正常市场';
    if (enhancedData.change24h && Math.abs(enhancedData.change24h) > 0.05) {
      marketCondition = '高波动市场';
    } else if (enhancedData.change24h && Math.abs(enhancedData.change24h) < 0.01) {
      marketCondition = '低波动市场';
    }
    
    return {
      primaryFactors,
      riskFactors,
      marketCondition,
      dataQuality,
      signalStrength: signal.strength.combined,
      riskScore: riskAssessment.riskScore
    };
  }

  private calculateExpectations(
    signal: SmartSignalResult,
    action: AgentDecision['primaryAction'],
    confidence: number
  ): AgentDecision['expectations'] {
    // 使用信号的目标价格计算预期收益
    const baseReturn = signal.targetPrice ? Math.abs(signal.targetPrice - signal.targetPrice) / signal.targetPrice : 0.02;
    
    return {
      expectedReturn: baseReturn * confidence,
      expectedRisk: (1 - confidence) * 0.05,
      holdingTime: 4 * 60 * 60 * 1000, // 4小时
      winProbability: confidence
    };
  }

  private evaluateDataQuality(enhancedData: EnhancedMarketData): number {
    // 简化的数据质量评估
    let quality = 1.0;
    
    if (!enhancedData.price || enhancedData.price <= 0) quality *= 0.5;
    if (!enhancedData.volume || enhancedData.volume <= 0) quality *= 0.8;
    // 使用change24h来评估波动性
    if (enhancedData.change24h && (Math.abs(enhancedData.change24h) < 0 || Math.abs(enhancedData.change24h) > 1)) quality *= 0.7;
    
    return Math.max(0, Math.min(1, quality));
  }

  private assessMarketCondition(enhancedData: EnhancedMarketData): string {
    // 使用change24h来评估市场状况
    if (enhancedData.change24h && Math.abs(enhancedData.change24h) > 0.05) {
      return '高波动市场';
    } else if (enhancedData.change24h && Math.abs(enhancedData.change24h) < 0.01) {
      return '低波动市场';
    } else if (enhancedData.volume > 1000000) {
      return '高成交量市场';
    } else {
      return '正常市场';
    }
  }

  private shouldClosePosition(signal: SmartSignalResult, riskAssessment: RiskAssessment): boolean {
    if (!this.state.currentPosition) return false;
    
    const currentSide = this.state.currentPosition.side;
    
    // 信号反转
    if (currentSide === 'LONG' && signal.signal === 'SELL' && signal.strength.confidence > 0.7) return true;
    if (currentSide === 'SHORT' && signal.signal === 'BUY' && signal.strength.confidence > 0.7) return true;
    
    // 风险过高
    if (riskAssessment.riskLevel === 'VERY_HIGH' || riskAssessment.riskLevel === 'EXTREME') return true;
    
    // 达到止损或止盈
    const currentPrice = this.state.currentPosition.currentPrice;
    const entryPrice = this.state.currentPosition.entryPrice;
    const pnlPercent = currentSide === 'LONG' 
      ? (currentPrice - entryPrice) / entryPrice
      : (entryPrice - currentPrice) / entryPrice;
    
    if (pnlPercent <= -this.config.stopLossPercent) return true;
    if (pnlPercent >= this.config.takeProfitPercent) return true;
    
    return false;
  }

  private async closeAllPositions(reason: string): Promise<void> {
    if (this.state.currentPosition) {
      // 这里应该调用实际的交易接口
      console.log(`Closing position: ${reason}`);
      this.state.currentPosition = null;
    }
  }

  private async updateLearningFromBacktest(backtestResult: BacktestResult): Promise<void> {
    // 从回测结果中提取学习数据
    for (const trade of backtestResult.trades) {
      const pattern = this.extractTradePattern(trade);
      const success = (trade.pnl || 0) > 0;
      
      if (!this.learningData.patterns.has(pattern)) {
        this.learningData.patterns.set(pattern, { success: 0, total: 0, avgReturn: 0 });
      }
      
      const patternData = this.learningData.patterns.get(pattern)!;
      patternData.total++;
      if (success) patternData.success++;
      // 使用pnlPercent而不是returnPercent
      patternData.avgReturn = (patternData.avgReturn * (patternData.total - 1) + (trade.pnlPercent || 0)) / patternData.total;
    }
    
    // 更新学习状态
    this.state.learningStatus.totalDecisions += backtestResult.trades.length;
    this.state.learningStatus.correctDecisions += backtestResult.trades.filter(t => (t.pnl || 0) > 0).length;
    this.state.learningStatus.accuracy = this.state.learningStatus.correctDecisions / this.state.learningStatus.totalDecisions;
    this.state.learningStatus.lastLearningUpdate = Date.now();
  }

  private extractTradePattern(trade: BacktestTrade): string {
    // 简化的模式提取
    const patterns: string[] = [];
    
    patterns.push(`action_${trade.side}`);
    patterns.push(`confidence_${Math.floor(0.7 * 10) / 10}`); // 使用默认置信度
    patterns.push(`strength_${Math.floor(0.6 * 10) / 10}`); // 使用默认强度
    
    return patterns.join('_');
  }

  private initializeState(): AgentState {
    return {
      isActive: false,
      mode: this.config.mode,
      currentPosition: null,
      performance: {
        totalTrades: 0,
        winRate: 0,
        totalReturn: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        currentCapital: 100000
      },
      riskStatus: {
        currentRisk: 0,
        dailyLoss: 0,
        maxDailyLoss: this.config.maxDailyLoss,
        riskLevel: 'LOW'
      },
      learningStatus: {
        totalDecisions: 0,
        correctDecisions: 0,
        accuracy: 0,
        lastLearningUpdate: 0
      }
    };
  }

  private setupEventListeners(): void {
    // 设置事件监听器
    this.on('decision', (decision: AgentDecision) => {
      console.log(`Agent decision: ${decision.primaryAction} with confidence ${decision.confidence}`);
    });
  }

  private getDefaultBacktestConfig(): BacktestConfig {
    return {
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30天前
      endDate: new Date(),
      initialCapital: 100000,
      maxPositionSize: this.config.maxPositionSize,
      tradingFee: 0.001,
      slippage: 0.0005,
      maxHoldingTime: 24,
      riskManagement: {
        maxDailyLoss: this.config.maxDailyLoss,
        maxDrawdown: this.config.maxDrawdown,
        positionSizing: 'RISK_PARITY'
      }
    };
  }
}

// 默认配置
export const defaultAgentConfig: AgentConfig = {
  symbol: 'ETH-USDT-SWAP',
  mode: 'BACKTEST',
  decisionInterval: 30000, // 30秒
  minConfidence: 0.6,
  maxPositionSize: 0.2,
  maxDailyLoss: 0.05,
  maxDrawdown: 0.2,
  stopLossPercent: 0.02,
  takeProfitPercent: 0.04,
  learningEnabled: true,
  learningRate: 0.01,
  adaptationPeriod: 24 * 60 * 60 * 1000 // 24小时
};

// 导出实例
export const ethContractAgent = new ETHContractAgent(defaultAgentConfig);