import { TechnicalIndicatorAnalyzer, TechnicalIndicatorResult } from '../indicators/technical-indicators.js';
import { config } from '../config/config.js';
import { OKXDataService, MarketData } from '../services/okx-data-service.js';

// 智能交易信号类型
export type SmartSignalType = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';

// 信号强度等级
export interface SignalStrength {
  technical: number; // 技术指标强度 0-100
  ml: number; // 机器学习强度 0-100
  combined: number; // 综合强度 0-100
  confidence: number; // 置信度 0-1
}

// 智能交易信号结果
export interface SmartSignalResult {
  signal: SmartSignalType;
  strength: SignalStrength;
  targetPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  positionSize: number; // 建议仓位大小 0-1
  timeframe: string;
  reasoning: {
    technical: string;
    ml: string;
    risk: string;
    final: string;
  };
  metadata: {
    timestamp: number;
    marketCondition: 'TRENDING' | 'RANGING' | 'VOLATILE';
    volatility: number;
    volume: 'HIGH' | 'MEDIUM' | 'LOW';
    momentum: 'STRONG' | 'WEAK' | 'NEUTRAL';
    trendDirection?: 'UP' | 'DOWN' | 'SIDEWAYS';
    trendStrength?: number;
    bollingerPosition?: number;
    bollingerBandwidth?: number;
  };
}

// 市场状态接口
export interface MarketCondition {
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
  strength: number; // 趋势强度 0-100
  volatility: 'HIGH' | 'MEDIUM' | 'LOW';
  volume: 'HIGH' | 'MEDIUM' | 'LOW';
  phase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN';
}

/**
 * 智能信号分析器 - 简化版本用于高频交易
 */
export class SmartSignalAnalyzer {
  private technicalAnalyzer: TechnicalIndicatorAnalyzer;
  private dataService: OKXDataService;
  private historicalData: MarketData[] = [];
  private lastAnalysis: SmartSignalResult | null = null;
  private lastMarketPrice: number | null = null;

  constructor(dataService: OKXDataService) {
    this.dataService = dataService;
    this.technicalAnalyzer = new TechnicalIndicatorAnalyzer();
  }

  /**
   * 分析交易信号
   */
  async analyzeSignal(
    marketData: MarketData,
    klineData: any[]
  ): Promise<SmartSignalResult> {
    try {
      // 更新历史数据
      this.updateHistoricalData(marketData);
      this.lastMarketPrice = marketData.price;

      // 更新技术指标数据
      this.technicalAnalyzer.updateKlineData(klineData);
      
      // 计算技术指标
      const technicalResult = this.technicalAnalyzer.calculateAllIndicators();
      if (!technicalResult) {
        return this.getFallbackSignal(marketData);
      }

      // 分析市场状态
      const marketCondition = this.analyzeMarketCondition(marketData, technicalResult);

      // 组合信号
      const result = this.combineSignals(
        technicalResult,
        null, // 简化版本不使用ML
        marketData,
        marketCondition
      );

      this.lastAnalysis = result;
      return result;

    } catch (error) {
      console.error('信号分析失败:', error);
      return this.getFallbackSignal(marketData);
    }
  }

  /**
   * 更新历史数据
   */
  private updateHistoricalData(marketData: MarketData): void {
    this.historicalData.push(marketData);
    if (this.historicalData.length > 200) {
      this.historicalData = this.historicalData.slice(-200);
    }
  }

  /**
   * 组合信号分析
   */
  private combineSignals(
    technicalResult: TechnicalIndicatorResult,
    mlResult: any | null,
    marketData: MarketData,
    marketCondition: MarketCondition
  ): SmartSignalResult {
    // 计算技术指标强度
    const technicalStrength = this.calculateTechnicalStrength(technicalResult);
    
    // 简化版本：只使用技术指标
    const combinedStrength = technicalStrength;
    const confidence = this.calculateTechnicalConfidence(technicalResult);

    // 确定信号类型
    const signal = this.determineSignal(technicalResult, null, combinedStrength);

    // 计算价格目标
    const priceTargets = this.calculatePriceTargets(
      marketData,
      signal,
      technicalResult,
      marketCondition
    );

    // 计算仓位大小
    const positionSize = this.calculatePositionSize(
      signal,
      combinedStrength,
      marketCondition,
      confidence
    );

    return {
      signal,
      strength: {
        technical: technicalStrength,
        ml: 50, // 默认值
        combined: combinedStrength,
        confidence
      },
      targetPrice: priceTargets.target,
      stopLoss: priceTargets.stopLoss,
      takeProfit: priceTargets.takeProfit,
      riskReward: priceTargets.riskReward,
      positionSize,
      timeframe: this.determineTimeframe(marketCondition),
      reasoning: {
        technical: this.generateTechnicalReasoning(technicalResult),
        ml: '简化版本未使用ML分析',
        risk: this.generateRiskReasoning(marketCondition, null),
        final: this.generateFinalReasoning(signal, combinedStrength, marketCondition)
      },
      metadata: {
        timestamp: Date.now(),
        marketCondition: this.getMarketConditionType(marketCondition),
        volatility: marketCondition.volatility === 'HIGH' ? 0.8 : marketCondition.volatility === 'MEDIUM' ? 0.5 : 0.2,
        volume: marketCondition.volume,
        momentum: this.getMomentumType(technicalResult),
        trendDirection: marketCondition.trend === 'UPTREND' ? 'UP' : marketCondition.trend === 'DOWNTREND' ? 'DOWN' : 'SIDEWAYS',
        trendStrength: marketCondition.strength,
        bollingerPosition: this.calculateBollingerPosition(marketData.price, technicalResult),
        bollingerBandwidth: this.calculateBollingerBandwidth(technicalResult)
      }
    };
  }

  /**
   * 计算技术指标强度
   */
  private calculateTechnicalStrength(indicators: TechnicalIndicatorResult): number {
    let score = 50; // 基础分数

    // RSI 评分
    if (indicators.rsi <= 30) score += 20; // 超卖
    else if (indicators.rsi >= 70) score -= 20; // 超买
    else if (indicators.rsi >= 45 && indicators.rsi <= 55) score += 5; // 中性区间

    // MACD 评分
    if (indicators.macd.histogram > 0) score += 15;
    else score -= 15;

    // EMA 趋势评分
    if (indicators.ema12 > indicators.ema26) score += 10;
    else score -= 10;

    return Math.min(Math.max(score, 0), 100);
  }

  /**
   * 分析市场状态
   */
  private analyzeMarketCondition(
    marketData: MarketData,
    technicalResult: TechnicalIndicatorResult
  ): MarketCondition {
    // 简化的市场状态分析
    let trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' = 'SIDEWAYS';
    let strength = 50;

    // 基于EMA判断趋势
    if (technicalResult.ema12 > technicalResult.ema26) {
      trend = 'UPTREND';
      strength = 60 + Math.min(((technicalResult.ema12 - technicalResult.ema26) / technicalResult.ema26) * 1000, 30);
    } else if (technicalResult.ema12 < technicalResult.ema26) {
      trend = 'DOWNTREND';
      strength = 60 + Math.min(((technicalResult.ema26 - technicalResult.ema12) / technicalResult.ema12) * 1000, 30);
    }

    // 简化的波动性和成交量分析
    const volatility: 'HIGH' | 'MEDIUM' | 'LOW' = 
      Math.abs(marketData.change24h) > 5 ? 'HIGH' : 
      Math.abs(marketData.change24h) > 2 ? 'MEDIUM' : 'LOW';

    const volume: 'HIGH' | 'MEDIUM' | 'LOW' = 
      marketData.volume24h > 1000000 ? 'HIGH' : 
      marketData.volume24h > 500000 ? 'MEDIUM' : 'LOW';

    return {
      trend,
      strength,
      volatility,
      volume,
      phase: 'MARKUP' // 简化处理
    };
  }

  /**
   * 确定信号类型
   */
  private determineSignal(
    technicalResult: TechnicalIndicatorResult,
    mlResult: any | null,
    combinedStrength: number
  ): SmartSignalType {
    if (combinedStrength >= 75) return 'STRONG_BUY';
    if (combinedStrength >= 60) return 'BUY';
    if (combinedStrength <= 25) return 'STRONG_SELL';
    if (combinedStrength <= 40) return 'SELL';
    return 'HOLD';
  }

  /**
   * 计算价格目标
   */
  private calculatePriceTargets(
    marketData: MarketData,
    signal: SmartSignalType,
    indicators: TechnicalIndicatorResult,
    condition: MarketCondition
  ): {
    target: number;
    stopLoss: number;
    takeProfit: number;
    riskReward: number;
  } {
    const currentPrice = marketData.price;
    let target = currentPrice;
    let stopLoss = currentPrice;
    let takeProfit = currentPrice;

    if (signal === 'BUY' || signal === 'STRONG_BUY') {
      target = currentPrice * 1.015; // 1.5% 目标
      stopLoss = currentPrice * 0.992; // 0.8% 止损
      takeProfit = currentPrice * 1.015;
    } else if (signal === 'SELL' || signal === 'STRONG_SELL') {
      target = currentPrice * 0.985; // -1.5% 目标
      stopLoss = currentPrice * 1.008; // 0.8% 止损
      takeProfit = currentPrice * 0.985;
    }

    const riskReward = Math.abs(takeProfit - currentPrice) / Math.abs(stopLoss - currentPrice);

    return { target, stopLoss, takeProfit, riskReward };
  }

  /**
   * 计算仓位大小
   */
  private calculatePositionSize(
    signal: SmartSignalType,
    strength: number,
    condition: MarketCondition,
    confidence: number
  ): number {
    let baseSize = 0.1; // 基础10%仓位

    // 根据信号强度调整
    if (signal === 'STRONG_BUY' || signal === 'STRONG_SELL') {
      baseSize = 0.15;
    } else if (signal === 'BUY' || signal === 'SELL') {
      baseSize = 0.12;
    }

    // 根据置信度调整
    baseSize *= confidence;

    return Math.min(Math.max(baseSize, 0.05), 0.20); // 限制在5%-20%之间
  }

  /**
   * 计算技术指标置信度
   */
  private calculateTechnicalConfidence(indicators: TechnicalIndicatorResult): number {
    let confidence = 0.5;

    // 多个指标同向时提高置信度
    const bullishSignals = [
      indicators.rsi < 30,
      indicators.macd.histogram > 0,
      indicators.ema12 > indicators.ema26
    ].filter(Boolean).length;

    const bearishSignals = [
      indicators.rsi > 70,
      indicators.macd.histogram < 0,
      indicators.ema12 < indicators.ema26
    ].filter(Boolean).length;

    if (bullishSignals >= 2) confidence += 0.2;
    if (bearishSignals >= 2) confidence += 0.2;

    return Math.min(confidence, 0.95);
  }

  /**
   * 确定时间框架
   */
  private determineTimeframe(condition: MarketCondition): string {
    return '1m'; // 高频交易固定使用1分钟
  }

  /**
   * 获取备用信号
   */
  private getFallbackSignal(marketData: MarketData): SmartSignalResult {
    return {
      signal: 'HOLD',
      strength: {
        technical: 50,
        ml: 50,
        combined: 50,
        confidence: 0.3
      },
      targetPrice: marketData.price,
      stopLoss: marketData.price * 0.995,
      takeProfit: marketData.price * 1.005,
      riskReward: 1.0,
      positionSize: 0.05,
      timeframe: '1m',
      reasoning: {
        technical: '数据不足，使用保守策略',
        ml: '未启用',
        risk: '低风险保守策略',
        final: '数据不足时的安全策略'
      },
      metadata: {
        timestamp: Date.now(),
        marketCondition: 'RANGING',
        volatility: 0.3,
        volume: 'MEDIUM',
        momentum: 'NEUTRAL'
      }
    };
  }

  // 辅助方法
  private getMarketConditionType(condition: MarketCondition): 'TRENDING' | 'RANGING' | 'VOLATILE' {
    if (condition.volatility === 'HIGH') return 'VOLATILE';
    if (condition.trend !== 'SIDEWAYS') return 'TRENDING';
    return 'RANGING';
  }

  private getMomentumType(indicators: TechnicalIndicatorResult): 'STRONG' | 'WEAK' | 'NEUTRAL' {
    if (Math.abs(indicators.macd.histogram) > 0.1) return 'STRONG';
    if (Math.abs(indicators.macd.histogram) < 0.02) return 'WEAK';
    return 'NEUTRAL';
  }

  private generateTechnicalReasoning(indicators: TechnicalIndicatorResult): string {
    const reasons = [];
    
    if (indicators.rsi < 30) reasons.push('RSI超卖');
    else if (indicators.rsi > 70) reasons.push('RSI超买');
    
    if (indicators.macd.histogram > 0) reasons.push('MACD看涨');
    else if (indicators.macd.histogram < 0) reasons.push('MACD看跌');
    
    if (indicators.ema12 > indicators.ema26) reasons.push('EMA金叉');
    else if (indicators.ema12 < indicators.ema26) reasons.push('EMA死叉');
    
    return reasons.join(', ') || '技术指标中性';
  }

  private generateRiskReasoning(condition: MarketCondition, mlResult: any): string {
    return `市场${condition.trend}, 波动性${condition.volatility}, 成交量${condition.volume}`;
  }

  private generateFinalReasoning(
    signal: SmartSignalType,
    strength: number,
    condition: MarketCondition
  ): string {
    return `基于技术分析的${signal}信号，强度${strength.toFixed(0)}，适合${condition.trend}市场`;
  }

  private calculateBollingerPosition(price: number, indicators: TechnicalIndicatorResult): number {
    const range = indicators.bollinger.upper - indicators.bollinger.lower;
    if (range === 0) return 0.5;
    return (price - indicators.bollinger.lower) / range;
  }

  private calculateBollingerBandwidth(indicators: TechnicalIndicatorResult): number {
    if (indicators.bollinger.middle === 0) return 0;
    return (indicators.bollinger.upper - indicators.bollinger.lower) / indicators.bollinger.middle;
  }

  /**
   * 获取最后分析结果
   */
  getLastAnalysis(): SmartSignalResult | null {
    return this.lastAnalysis;
  }

  /**
   * 获取历史统计
   */
  getHistoricalStats(): {
    dataPoints: number;
    avgPrice: number;
    volatility: number;
    trend: string;
  } {
    if (this.historicalData.length === 0) {
      return {
        dataPoints: 0,
        avgPrice: 0,
        volatility: 0,
        trend: 'UNKNOWN'
      };
    }

    const prices = this.historicalData.map(d => d.price);
    const avgPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - avgPrice, 2), 0) / prices.length;
    const volatility = Math.sqrt(variance) / avgPrice;

    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const trend = lastPrice > firstPrice ? 'UP' : lastPrice < firstPrice ? 'DOWN' : 'SIDEWAYS';

    return {
      dataPoints: this.historicalData.length,
      avgPrice,
      volatility,
      trend
    };
  }
}