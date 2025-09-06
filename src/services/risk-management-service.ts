import { config } from '../config';
import { MarketData } from '../ml/ml-analyzer';
import { SmartSignalResult } from '../analyzers/smart-signal-analyzer';
import { Position, TradeRecord } from '../strategy/eth-strategy-engine';

// 风险管理配置接口
export interface RiskConfig {
  maxDailyLoss: number;           // 最大日损失
  maxPositionSize: number;        // 最大仓位大小
  stopLossPercent: number;        // 止损百分比
  takeProfitPercent: number;      // 止盈百分比
  maxRiskPerTrade: number;        // 每笔交易最大风险
  maxDrawdown: number;            // 最大回撤
  maxLeverage: number;            // 最大杠杆
  riskFreeRate: number;           // 无风险利率
}

// 风险评估结果
export interface RiskAssessment {
  riskScore: number;              // 风险评分 (1-10)
  riskLevel: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | 'EXTREME';
  factors: string[];              // 风险因素
  recommendations: string[];      // 风险建议
  maxAllowedPosition: number;     // 最大允许仓位
  recommendedLeverage: number;    // 推荐杠杆
  stopLossPrice: number;          // 止损价格
  takeProfitPrice: number;        // 止盈价格
  riskRewardRatio: number;        // 风险收益比
}

// 仓位风险分析
export interface PositionRisk {
  currentRisk: number;            // 当前风险敞口
  unrealizedPnL: number;          // 未实现盈亏
  unrealizedPnLPercent: number;   // 未实现盈亏百分比
  timeAtRisk: number;             // 风险暴露时间
  marginUsed: number;             // 已用保证金
  marginAvailable: number;        // 可用保证金
  liquidationPrice: number;       // 强平价格
  distanceToLiquidation: number;  // 距离强平的距离
}

// 组合风险分析
export interface PortfolioRisk {
  totalExposure: number;          // 总敞口
  diversificationScore: number;   // 分散化评分
  correlationRisk: number;        // 相关性风险
  concentrationRisk: number;      // 集中度风险
  dailyVaR: number;              // 日风险价值
  expectedShortfall: number;      // 预期损失
  sharpeRatio: number;           // 夏普比率
  maxDrawdown: number;           // 最大回撤
  currentDrawdown: number;       // 当前回撤
}

// 风险管理服务
export class RiskManagementService {
  private riskConfig: RiskConfig;
  private dailyLoss: number = 0;
  private dailyTrades: TradeRecord[] = [];
  private lastResetDate: string;
  private performanceHistory: number[] = [];
  private maxHistoricalDrawdown: number = 0;

  constructor() {
    this.riskConfig = {
      maxDailyLoss: config.risk.maxDailyLoss,
      maxPositionSize: config.risk.maxPositionSize,
      stopLossPercent: config.risk.stopLossPercent,
      takeProfitPercent: config.risk.takeProfitPercent,
      maxRiskPerTrade: config.risk.maxRiskPerTrade,
      maxDrawdown: config.risk.maxDrawdown,
      maxLeverage: config.trading.maxLeverage,
      riskFreeRate: 0.02 // 2% 年化无风险利率
    };
    this.lastResetDate = new Date().toDateString();
  }

  /**
   * 更新风险管理配置
   */
  updateConfig(newConfig: Partial<RiskConfig>): void {
    this.riskConfig = {
      ...this.riskConfig,
      ...newConfig
    };
  }

  /**
   * 获取当前风险管理配置
   */
  getConfig(): RiskConfig {
    return { ...this.riskConfig };
  }

  /**
   * 评估风险（简化版本，用于推荐系统集成）
   */
  async assessRisk(marketData: any, signal: any): Promise<{
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    riskScore: number;
    maxPosition: number;
    recommendedLeverage: number;
  }> {
    try {
      // 基于信号置信度和市场波动率评估风险
      const confidence = signal.confidence || 0.5;
      const volatility = marketData.volatility || 0.1;
      
      // 计算风险评分 (0-1)
      const riskScore = Math.max(0, Math.min(1, (1 - confidence) + volatility));
      
      let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
      if (riskScore < 0.3) {
        riskLevel = 'LOW';
      } else if (riskScore < 0.7) {
        riskLevel = 'MEDIUM';
      } else {
        riskLevel = 'HIGH';
      }
      
      const maxL = Math.min(20, this.riskConfig.maxLeverage);
      
      return {
        riskLevel,
        riskScore,
        maxPosition: Math.max(0.1, 1 - riskScore), // 风险越高，仓位越小
        recommendedLeverage: Math.max(2, Math.min(maxL, Math.floor((1 - riskScore) * maxL))) // 风险越高，杠杆越低，最少2x
      };
    } catch (error) {
      console.error('Error assessing risk:', error);
      return {
        riskLevel: 'HIGH',
        riskScore: 1,
        maxPosition: 0.1,
        recommendedLeverage: 1
      };
    }
  }

  /**
   * 评估交易信号的风险
   */
  assessSignalRisk(
    signal: SmartSignalResult,
    marketData: MarketData,
    currentPositions: Position[] = []
  ): RiskAssessment {
    const factors: string[] = [];
    const recommendations: string[] = [];
    let riskScore = 5; // 基础风险评分

    // 1. 市场波动性风险
    if (signal.metadata.volatility > 0.7) {
      riskScore += 2;
      factors.push('市场波动性过高');
      recommendations.push('降低仓位规模');
    } else if (signal.metadata.volatility < 0.3) {
      riskScore -= 1;
      factors.push('市场波动性较低');
    }

    // 2. 成交量风险
    if (signal.metadata.volume === 'LOW') {
      riskScore += 1;
      factors.push('成交量不足');
      recommendations.push('谨慎入场，设置较小仓位');
    }

    // 3. 信号置信度风险
    if (signal.strength.confidence < 0.6) {
      riskScore += 2;
      factors.push('信号置信度较低');
      recommendations.push('等待更强信号或降低仓位');
    }

    // 4. 风险收益比风险
    if (signal.riskReward < 1.5) {
      riskScore += 1;
      factors.push('风险收益比不佳');
      recommendations.push('调整止损止盈位置');
    }

    // 5. 资金费率风险
    if (marketData.fundingRate && Math.abs(marketData.fundingRate) > 0.01) {
      riskScore += 1;
      factors.push('资金费率异常');
      recommendations.push('注意资金费率成本');
    }

    // 6. 每日损失风险
    const dailyLossRatio = this.dailyLoss / this.riskConfig.maxDailyLoss;
    if (dailyLossRatio > 0.8) {
      riskScore += 3;
      factors.push('接近每日损失限额');
      recommendations.push('暂停交易或极小仓位');
    } else if (dailyLossRatio > 0.5) {
      riskScore += 1;
      factors.push('每日损失较高');
      recommendations.push('降低仓位规模');
    }

    // 7. 持仓集中度风险
    const totalExposure = currentPositions.reduce((sum, pos) => sum + pos.size * pos.leverage, 0);
    if (totalExposure > this.riskConfig.maxPositionSize * 0.8) {
      riskScore += 2;
      factors.push('持仓集中度过高');
      recommendations.push('分散持仓或减少新仓位');
    }

    // 计算风险等级
    const riskLevel = this.calculateRiskLevel(riskScore);
    
    // 计算最大允许仓位
    const maxAllowedPosition = this.calculateMaxAllowedPosition(riskScore, signal);
    
    // 计算推荐杠杆
    const recommendedLeverage = this.calculateRecommendedLeverage(riskScore, signal);
    
    // 计算止损止盈价格
    const { stopLossPrice, takeProfitPrice } = this.calculateStopLevels(signal, marketData);

    return {
      riskScore: Math.max(1, Math.min(10, riskScore)),
      riskLevel,
      factors,
      recommendations,
      maxAllowedPosition,
      recommendedLeverage,
      stopLossPrice,
      takeProfitPrice,
      riskRewardRatio: signal.riskReward
    };
  }

  /**
   * 分析单个持仓的风险
   */
  analyzePositionRisk(position: Position, currentPrice: number): PositionRisk {
    const unrealizedPnL = this.calculateUnrealizedPnL(position, currentPrice);
    const unrealizedPnLPercent = (unrealizedPnL / (position.entryPrice * position.size)) * 100;
    const timeAtRisk = Date.now() - position.timestamp;
    const marginUsed = (position.size * position.entryPrice) / position.leverage;
    const marginAvailable = this.calculateAvailableMargin(position);
    const liquidationPrice = this.calculateLiquidationPrice(position);
    const distanceToLiquidation = Math.abs(currentPrice - liquidationPrice) / currentPrice;

    return {
      currentRisk: marginUsed,
      unrealizedPnL,
      unrealizedPnLPercent,
      timeAtRisk,
      marginUsed,
      marginAvailable,
      liquidationPrice,
      distanceToLiquidation
    };
  }

  /**
   * 分析组合整体风险
   */
  analyzePortfolioRisk(positions: Position[], tradeHistory: TradeRecord[]): PortfolioRisk {
    const totalExposure = positions.reduce((sum, pos) => sum + pos.size * pos.leverage, 0);
    const diversificationScore = this.calculateDiversificationScore(positions);
    const correlationRisk = this.calculateCorrelationRisk(positions);
    const concentrationRisk = this.calculateConcentrationRisk(positions);
    const dailyVaR = this.calculateDailyVaR(positions, tradeHistory);
    const expectedShortfall = this.calculateExpectedShortfall(tradeHistory);
    const sharpeRatio = this.calculateSharpeRatio(tradeHistory);
    const maxDrawdown = this.calculateMaxDrawdown(tradeHistory);
    const currentDrawdown = this.calculateCurrentDrawdown(tradeHistory);

    return {
      totalExposure,
      diversificationScore,
      correlationRisk,
      concentrationRisk,
      dailyVaR,
      expectedShortfall,
      sharpeRatio,
      maxDrawdown,
      currentDrawdown
    };
  }

  /**
   * 检查是否可以开新仓
   */
  canOpenNewPosition(
    signal: SmartSignalResult,
    marketData: MarketData,
    currentPositions: Position[]
  ): { allowed: boolean; reason?: string; maxSize?: number } {
    // 检查每日损失限制
    if (this.dailyLoss >= this.riskConfig.maxDailyLoss) {
      return { allowed: false, reason: '已达到每日最大损失限额' };
    }

    // 检查最大持仓数量
    if (currentPositions.length >= config.trading.maxPositions) {
      return { allowed: false, reason: '已达到最大持仓数量' };
    }

    // 检查总敞口
    const totalExposure = currentPositions.reduce((sum, pos) => sum + pos.size * pos.leverage, 0);
    if (totalExposure >= this.riskConfig.maxPositionSize) {
      return { allowed: false, reason: '总敞口已达上限' };
    }

    // 评估信号风险
    const riskAssessment = this.assessSignalRisk(signal, marketData, currentPositions);
    if (riskAssessment.riskLevel === 'EXTREME') {
      return { allowed: false, reason: '风险等级过高' };
    }

    // 计算最大允许仓位
    const maxSize = Math.min(
      riskAssessment.maxAllowedPosition,
      this.riskConfig.maxPositionSize - totalExposure
    );

    return { allowed: true, maxSize };
  }

  /**
   * 更新每日交易记录
   */
  updateDailyTrades(trade: TradeRecord): void {
    this.checkDailyReset();
    
    this.dailyTrades.push(trade);
    
    if (trade.pnl !== undefined) {
      this.dailyLoss += Math.max(0, -trade.pnl);
    }
  }

  /**
   * 获取风险管理状态
   */
  getRiskStatus(): {
    dailyLoss: number;
    dailyLossLimit: number;
    dailyLossRatio: number;
    tradesCount: number;
    riskLevel: string;
  } {
    this.checkDailyReset();
    
    // 防御：确保分母为正且有限，避免出现 Infinity/NaN 导致调用方 toFixed 抛错
    const lossLimitRaw = this.riskConfig.maxDailyLoss;
    const lossLimit = Number.isFinite(lossLimitRaw) && lossLimitRaw > 0 ? lossLimitRaw : 0;

    let dailyLossRatio = 0;
    if (lossLimit > 0) {
      dailyLossRatio = this.dailyLoss / lossLimit;
    } else {
      // 当配置为0或非法时，将比例钉在100%，并提升风险等级
      dailyLossRatio = 1; // 相当于100%
    }

    // 归一化/钳制，保证是有限值
    if (!Number.isFinite(dailyLossRatio) || isNaN(dailyLossRatio)) {
      dailyLossRatio = 1;
    }
    dailyLossRatio = Math.max(0, Math.min(dailyLossRatio, 1e6));

    let riskLevel = 'LOW';
    if (dailyLossRatio > 0.8) riskLevel = 'EXTREME';
    else if (dailyLossRatio > 0.6) riskLevel = 'HIGH';
    else if (dailyLossRatio > 0.4) riskLevel = 'MEDIUM';

    return {
      dailyLoss: this.dailyLoss,
      dailyLossLimit: lossLimit, // 返回已校验后的limit
      dailyLossRatio,
      tradesCount: this.dailyTrades.length,
      riskLevel
    };
  }

  // 私有方法
  private calculateRiskLevel(riskScore: number): RiskAssessment['riskLevel'] {
    if (riskScore <= 2) return 'VERY_LOW';
    if (riskScore <= 4) return 'LOW';
    if (riskScore <= 6) return 'MEDIUM';
    if (riskScore <= 8) return 'HIGH';
    if (riskScore <= 9) return 'VERY_HIGH';
    return 'EXTREME';
  }

  private calculateMaxAllowedPosition(riskScore: number, signal: SmartSignalResult): number {
    let baseSize = Math.min(signal.positionSize, this.riskConfig.maxPositionSize);
    
    // 根据风险评分调整仓位
    const riskMultiplier = Math.max(0.1, (10 - riskScore) / 10);
    baseSize *= riskMultiplier;
    
    // 根据每日损失调整
    const dailyLossRatio = this.dailyLoss / this.riskConfig.maxDailyLoss;
    baseSize *= (1 - dailyLossRatio * 0.5);
    
    return Math.max(0.01, baseSize);
  }

  private calculateRecommendedLeverage(riskScore: number, signal: SmartSignalResult): number {
    const maxLeverage = Math.min(20, this.riskConfig.maxLeverage);
    const confidence = Math.max(0, Math.min(1, signal.strength?.confidence ?? 0));
    const baseLeverage = Math.min(maxLeverage, Math.max(2, Math.floor(maxLeverage * confidence)));
    
    // 根据风险评分调整杠杆
    const riskMultiplier = Math.max(0.3, (10 - riskScore) / 10);
    
    return Math.max(2, Math.min(maxLeverage, Math.floor(baseLeverage * riskMultiplier)));
  }

  private calculateStopLevels(signal: SmartSignalResult, marketData: MarketData): {
    stopLossPrice: number;
    takeProfitPrice: number;
  } {
    const currentPrice = marketData.price;
    const isLong = signal.signal.includes('BUY');
    
    let stopLossPrice = signal.stopLoss;
    let takeProfitPrice = signal.takeProfit;
    
    // 确保止损止盈符合风险管理要求
    const minStopLoss = isLong 
      ? currentPrice * (1 - this.riskConfig.stopLossPercent)
      : currentPrice * (1 + this.riskConfig.stopLossPercent);
    
    const minTakeProfit = isLong
      ? currentPrice * (1 + this.riskConfig.takeProfitPercent)
      : currentPrice * (1 - this.riskConfig.takeProfitPercent);
    
    if (isLong) {
      stopLossPrice = Math.min(stopLossPrice, minStopLoss);
      takeProfitPrice = Math.max(takeProfitPrice, minTakeProfit);
    } else {
      stopLossPrice = Math.max(stopLossPrice, minStopLoss);
      takeProfitPrice = Math.min(takeProfitPrice, minTakeProfit);
    }
    
    return { stopLossPrice, takeProfitPrice };
  }

  private calculateUnrealizedPnL(position: Position, currentPrice: number): number {
    const priceDiff = position.side === 'LONG' 
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;
    
    return priceDiff * position.size * position.leverage;
  }

  private calculateAvailableMargin(position: Position): number {
    // 简化计算，实际应该从交易所获取
    return (position.size * position.entryPrice) / position.leverage * 0.5;
  }

  private calculateLiquidationPrice(position: Position): number {
    const maintenanceMarginRate = 0.005; // 0.5% 维持保证金率
    const entryPrice = position.entryPrice;
    const leverage = position.leverage;
    
    if (position.side === 'LONG') {
      return entryPrice * (1 - (1 / leverage) + maintenanceMarginRate);
    } else {
      return entryPrice * (1 + (1 / leverage) - maintenanceMarginRate);
    }
  }

  private calculateDiversificationScore(positions: Position[]): number {
    if (positions.length === 0) return 100;
    if (positions.length === 1) return 0;
    
    // 简化的分散化评分，实际应该考虑相关性
    return Math.min(100, positions.length * 20);
  }

  private calculateCorrelationRisk(positions: Position[]): number {
    // 简化计算，假设同向持仓相关性高
    const longPositions = positions.filter(p => p.side === 'LONG').length;
    const shortPositions = positions.filter(p => p.side === 'SHORT').length;
    
    const imbalance = Math.abs(longPositions - shortPositions) / positions.length;
    return imbalance * 100;
  }

  private calculateConcentrationRisk(positions: Position[]): number {
    if (positions.length === 0) return 0;
    
    const totalSize = positions.reduce((sum, pos) => sum + pos.size, 0);
    const maxPosition = Math.max(...positions.map(pos => pos.size));
    
    return (maxPosition / totalSize) * 100;
  }

  private calculateDailyVaR(positions: Position[], tradeHistory: TradeRecord[]): number {
    // 简化的VaR计算，使用历史模拟法
    const recentTrades = tradeHistory.slice(-30); // 最近30笔交易
    if (recentTrades.length === 0) return 0;
    
    const returns = recentTrades
      .filter(trade => trade.pnlPercent !== undefined)
      .map(trade => trade.pnlPercent!);
    
    if (returns.length === 0) return 0;
    
    returns.sort((a, b) => a - b);
    const varIndex = Math.floor(returns.length * 0.05); // 95% VaR
    
    return Math.abs(returns[varIndex] || 0);
  }

  private calculateExpectedShortfall(tradeHistory: TradeRecord[]): number {
    const recentTrades = tradeHistory.slice(-30);
    if (recentTrades.length === 0) return 0;
    
    const returns = recentTrades
      .filter(trade => trade.pnlPercent !== undefined)
      .map(trade => trade.pnlPercent!);
    
    if (returns.length === 0) return 0;
    
    returns.sort((a, b) => a - b);
    const varIndex = Math.floor(returns.length * 0.05);
    const tailReturns = returns.slice(0, varIndex);
    
    if (tailReturns.length === 0) return 0;
    
    const avgTailReturn = tailReturns.reduce((sum, ret) => sum + ret, 0) / tailReturns.length;
    return Math.abs(avgTailReturn);
  }

  private calculateSharpeRatio(tradeHistory: TradeRecord[]): number {
    const recentTrades = tradeHistory.slice(-50);
    if (recentTrades.length === 0) return 0;
    
    const returns = recentTrades
      .filter(trade => trade.pnlPercent !== undefined)
      .map(trade => trade.pnlPercent! / 100);
    
    if (returns.length === 0) return 0;
    
    const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    if (stdDev === 0) return 0;
    
    const excessReturn = avgReturn - (this.riskConfig.riskFreeRate / 365); // 日化无风险利率
    return excessReturn / stdDev;
  }

  private calculateMaxDrawdown(tradeHistory: TradeRecord[]): number {
    if (tradeHistory.length === 0) return 0;
    
    let peak = 0;
    let maxDrawdown = 0;
    let runningPnL = 0;
    
    for (const trade of tradeHistory) {
      if (trade.pnl !== undefined) {
        runningPnL += trade.pnl;
        
        if (runningPnL > peak) {
          peak = runningPnL;
        }
        
        const drawdown = (peak - runningPnL) / Math.max(peak, 1);
        maxDrawdown = Math.max(maxDrawdown, drawdown);
      }
    }
    
    return maxDrawdown * 100;
  }

  private calculateCurrentDrawdown(tradeHistory: TradeRecord[]): number {
    if (tradeHistory.length === 0) return 0;
    
    let peak = 0;
    let runningPnL = 0;
    
    for (const trade of tradeHistory) {
      if (trade.pnl !== undefined) {
        runningPnL += trade.pnl;
        
        if (runningPnL > peak) {
          peak = runningPnL;
        }
      }
    }
    
    if (peak === 0) return 0;
    
    return ((peak - runningPnL) / peak) * 100;
  }

  private checkDailyReset(): void {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.dailyLoss = 0;
      this.dailyTrades = [];
      this.lastResetDate = today;
    }
  }
}

// 导出单例实例
export const riskManagementService = new RiskManagementService();