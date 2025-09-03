import { TechnicalIndicatorAnalyzer, TechnicalIndicatorResult } from '../indicators/technical-indicators';
import { MLAnalyzer, MLAnalysisResult, MarketData } from '../ml/ml-analyzer';
import { config } from '../config';

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
    // 新增：趋势方向与强度
    trendDirection?: 'UP' | 'DOWN' | 'SIDEWAYS';
    trendStrength?: number;
    // 新增：布林带位置与带宽，供策略层过滤与风险控制
    bollingerPosition?: number; // 0-1，0靠近下轨，1靠近上轨
    bollingerBandwidth?: number; // (上-下)/中
  };
}

// 市场状态分析
export interface MarketCondition {
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
  strength: number; // 趋势强度 0-100
  volatility: 'HIGH' | 'MEDIUM' | 'LOW';
  volume: 'HIGH' | 'MEDIUM' | 'LOW';
  phase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN';
}

// 智能信号分析器
export class SmartSignalAnalyzer {
  private technicalAnalyzer: TechnicalIndicatorAnalyzer;
  private mlAnalyzer: MLAnalyzer;
  private historicalData: MarketData[] = [];
  private lastAnalysis: SmartSignalResult | null = null;
  // 新增：记录最近一次市场价格，用于BOLL位置等基于“价格”的计算
  private lastMarketPrice: number | null = null;

  constructor() {
    this.technicalAnalyzer = new TechnicalIndicatorAnalyzer();
    this.mlAnalyzer = new MLAnalyzer();
  }

  // 主要分析方法
  async analyzeSignal(
    marketData: MarketData,
    klineData: any[]
  ): Promise<SmartSignalResult> {
    try {
      // 1. 更新历史数据
      this.updateHistoricalData(marketData);
      // 1.1 记录当前价格供BOLL位置等计算使用
      this.lastMarketPrice = typeof marketData?.price === 'number' ? marketData.price : this.lastMarketPrice;

      // 2. 更新K线数据到技术指标分析器
      klineData.forEach(kline => {
        this.technicalAnalyzer.addKlineData({
          timestamp: kline.timestamp,
          open: parseFloat(kline.open),
          high: parseFloat(kline.high),
          low: parseFloat(kline.low),
          close: parseFloat(kline.close),
          volume: parseFloat(kline.volume)
        });
      });

      // 3. 计算技术指标
      const technicalResult = this.technicalAnalyzer.calculateAllIndicators();
      if (!technicalResult) {
        return this.getFallbackSignal(marketData);
      }

      // 4. 机器学习分析
      let mlResult: MLAnalysisResult | null = null;
      if (config.strategy.useMLAnalysis && this.historicalData.length >= 20) {
        try {
          mlResult = await this.mlAnalyzer.analyze(
            marketData,
            technicalResult,
            this.historicalData
          );
        } catch (error) {
          console.warn('ML analysis failed, using technical analysis only:', error);
        }
      }

      // 5. 市场状态分析
      const marketCondition = this.analyzeMarketCondition(marketData, technicalResult);

      // 6. 综合信号分析
      const smartSignal = this.combineSignals(
        technicalResult,
        mlResult,
        marketData,
        marketCondition
      );

      // 7. 风险管理调整
      const finalSignal = this.applyRiskManagement(smartSignal, marketData, marketCondition);

      this.lastAnalysis = finalSignal;
      return finalSignal;

    } catch (error) {
      console.error('Smart signal analysis failed:', error);
      return this.getFallbackSignal(marketData);
    }
  }

  // 更新历史数据
  private updateHistoricalData(marketData: MarketData): void {
    this.historicalData.push(marketData);
    
    // 保持最近1000个数据点
    if (this.historicalData.length > 1000) {
      this.historicalData = this.historicalData.slice(-1000);
    }
  }

  // 分析市场状态
  private analyzeMarketCondition(
    marketData: MarketData,
    technicalResult: TechnicalIndicatorResult
  ): MarketCondition {
    // 趋势分析
    let trend: MarketCondition['trend'] = 'SIDEWAYS';
    let trendStrength = 0;

    // 基于EMA趋势线与价格、短期EMA判断趋势
    if (technicalResult.emaTrend && technicalResult.ema12) {
      if (marketData.price > technicalResult.emaTrend && technicalResult.ema12 > technicalResult.emaTrend) {
        trend = 'UPTREND';
        trendStrength = Math.min(((marketData.price - technicalResult.emaTrend) / technicalResult.emaTrend) * 100, 100);
      } else if (marketData.price < technicalResult.emaTrend && technicalResult.ema12 < technicalResult.emaTrend) {
        trend = 'DOWNTREND';
        trendStrength = Math.min(((technicalResult.emaTrend - marketData.price) / technicalResult.emaTrend) * 100, 100);
      }
    }

    // 波动性分析
    const priceRange = marketData.high24h - marketData.low24h;
    const volatilityRatio = priceRange / marketData.price;
    let volatility: MarketCondition['volatility'] = 'MEDIUM';
    
    if (volatilityRatio > 0.05) volatility = 'HIGH';
    else if (volatilityRatio < 0.02) volatility = 'LOW';

    // 成交量分析
    let volume: MarketCondition['volume'] = 'MEDIUM';
    // 简化的成交量分析，实际应该与历史平均比较
    if (marketData.volume > 1000000000) volume = 'HIGH';
    else if (marketData.volume < 100000000) volume = 'LOW';

    // 市场阶段分析
    let phase: MarketCondition['phase'] = 'MARKUP';
    if (technicalResult.rsi < 30 && trend === 'DOWNTREND') {
      phase = 'ACCUMULATION';
    } else if (technicalResult.rsi > 70 && trend === 'UPTREND') {
      phase = 'DISTRIBUTION';
    } else if (trend === 'DOWNTREND' && technicalResult.rsi > 50) {
      phase = 'MARKDOWN';
    }

    return {
      trend,
      strength: trendStrength,
      volatility,
      volume,
      phase
    };
  }

  // 综合信号分析
  private combineSignals(
    technicalResult: TechnicalIndicatorResult,
    mlResult: MLAnalysisResult | null,
    marketData: MarketData,
    marketCondition: MarketCondition
  ): SmartSignalResult {
    // 技术指标信号强度
    const technicalStrength = this.calculateTechnicalStrength(technicalResult);
    
    // 机器学习信号强度
    const mlStrength = mlResult ? this.calculateMLStrength(mlResult) : 50;
    
    // 综合信号强度计算
    const weights = config.strategy.multiFactorWeights;
    const combinedStrength = (
      technicalStrength * weights.technical +
      mlStrength * weights.ml +
      this.getMarketConditionScore(marketCondition) * weights.market
    ) / (weights.technical + weights.ml + weights.market);

    // 确定最终信号
    const signal = this.determineSignal(technicalResult, mlResult, combinedStrength);
    
    // 计算价格目标
    const priceTargets = this.calculatePriceTargets(
      marketData,
      signal,
      technicalResult,
      marketCondition
    );

    // 计算建议仓位
    const positionSize = this.calculatePositionSize(
      signal,
      combinedStrength,
      marketCondition,
      mlResult?.confidence || 0.5
    );

    return {
      signal,
      strength: {
        technical: technicalStrength,
        ml: mlStrength,
        combined: combinedStrength,
        confidence: mlResult?.confidence || this.calculateTechnicalConfidence(technicalResult)
      },
      targetPrice: priceTargets.target,
      stopLoss: priceTargets.stopLoss,
      takeProfit: priceTargets.takeProfit,
      riskReward: priceTargets.riskReward,
      positionSize,
      timeframe: this.determineTimeframe(marketCondition),
      reasoning: {
        technical: this.generateTechnicalReasoning(technicalResult),
        ml: mlResult?.reasoning || '未使用机器学习分析',
        risk: this.generateRiskReasoning(marketCondition, mlResult),
        final: this.generateFinalReasoning(signal, combinedStrength, marketCondition)
      },
      metadata: {
        timestamp: Date.now(),
        marketCondition: this.getMarketConditionType(marketCondition),
        volatility: marketCondition.volatility === 'HIGH' ? 0.8 : marketCondition.volatility === 'LOW' ? 0.2 : 0.5,
        volume: marketCondition.volume,
        momentum: this.getMomentumType(technicalResult),
        // 新增：趋势方向与强度
        trendDirection: marketCondition.trend === 'UPTREND' ? 'UP' : marketCondition.trend === 'DOWNTREND' ? 'DOWN' : 'SIDEWAYS',
        trendStrength: marketCondition.strength,
        // 新增：布林带位置/带宽（使用实时价格，稳健钳制与有限性检查）
        bollingerPosition: (() => {
          const range = technicalResult.bollinger.upper - technicalResult.bollinger.lower;
          const price = Number.isFinite(marketData.price) ? marketData.price : technicalResult.bollinger.middle;
          if (!(Number.isFinite(range) && range > 0 && Number.isFinite(price))) return 0.5;
          const raw = (price - technicalResult.bollinger.lower) / range;
          const clamped = Math.max(0, Math.min(1, raw));
          return Number.isFinite(clamped) ? clamped : 0.5;
        })(),
        bollingerBandwidth: (() => {
          const mid = technicalResult.bollinger.middle;
          const range = technicalResult.bollinger.upper - technicalResult.bollinger.lower;
          const denom = Number.isFinite(mid) && mid > 0 ? mid : (Number.isFinite(marketData.price) && marketData.price > 0 ? marketData.price : NaN);
          if (!(Number.isFinite(range) && range >= 0 && Number.isFinite(denom) && denom > 0)) return 0;
          const bw = range / denom;
          return Number.isFinite(bw) ? bw : 0;
        })()
      }
    };
  }

  // 计算技术指标强度
  private calculateTechnicalStrength(indicators: TechnicalIndicatorResult): number {
    let score = 50; // 基础分数

    // RSI评分（使用配置阈值）
    const overbought = config.indicators.rsi.overbought;
    const oversold = config.indicators.rsi.oversold;
    const mid = (overbought + oversold) / 2;
    const neutralLow = mid - 5;
    const neutralHigh = mid + 5;

    if (indicators.rsi <= oversold) score += 20; // 超卖
    else if (indicators.rsi >= overbought) score -= 20; // 超买
    else if (indicators.rsi >= neutralLow && indicators.rsi <= neutralHigh) score += 5; // 中性区间（±5）

    // MACD评分
    if (indicators.macd.histogram > 0) {
      score += indicators.macd.histogram > 0.001 ? 15 : 10;
    } else {
      score -= Math.abs(indicators.macd.histogram) > 0.001 ? 15 : 10;
    }

    // 布林带评分（使用实时价格优先，其次回退到中轨以避免空值）
    const bollingerRange = indicators.bollinger.upper - indicators.bollinger.lower;
    if (bollingerRange > 0) {
      const currentPrice = (typeof this.lastMarketPrice === 'number') ? this.lastMarketPrice : indicators.bollinger.middle;
      const position = (currentPrice - indicators.bollinger.lower) / bollingerRange;
      if (position < 0.2) score += 15; // 接近下轨
      else if (position > 0.8) score -= 15; // 接近上轨
    }

    // KDJ评分
    if (indicators.kdj.k > indicators.kdj.d && indicators.kdj.k < 80) score += 10;
    else if (indicators.kdj.k < indicators.kdj.d && indicators.kdj.k > 20) score -= 10;

    // 威廉指标评分
    if (indicators.williams < -80) score += 10; // 超卖
    else if (indicators.williams > -20) score -= 10; // 超买

    // 新增：EMA趋势评分（短期EMA相对趋势EMA）
    if (typeof indicators.ema12 === 'number' && typeof indicators.emaTrend === 'number') {
      if (indicators.ema12 > indicators.emaTrend) score += 10; // 趋势向上
      else if (indicators.ema12 < indicators.emaTrend) score -= 10; // 趋势向下
    }

    return Math.max(0, Math.min(100, score));
  }

  // 计算机器学习强度
  private calculateMLStrength(mlResult: MLAnalysisResult): number {
    const signalMap: { [key in MLAnalysisResult['prediction']]: number } = {
      'STRONG_BUY': 90,
      'BUY': 70,
      'HOLD': 50,
      'SELL': 30,
      'STRONG_SELL': 10
    };

    const baseScore = signalMap[mlResult.prediction];
    const confidenceAdjustment = (mlResult.confidence - 0.5) * 20;
    
    return Math.max(0, Math.min(100, baseScore + confidenceAdjustment));
  }

  // 获取市场状态评分
  private getMarketConditionScore(condition: MarketCondition): number {
    let score = 50;

    // 趋势评分
    if (condition.trend === 'UPTREND') score += condition.strength * 0.3;
    else if (condition.trend === 'DOWNTREND') score -= condition.strength * 0.3;

    // 阶段评分
    switch (condition.phase) {
      case 'ACCUMULATION': score += 20; break;
      case 'MARKUP': score += 10; break;
      case 'DISTRIBUTION': score -= 20; break;
      case 'MARKDOWN': score -= 10; break;
    }

    // 波动性调整
    if (condition.volatility === 'HIGH') score -= 10;
    else if (condition.volatility === 'LOW') score += 5;

    return Math.max(0, Math.min(100, score));
  }

  // 确定最终信号
  private determineSignal(
    technicalResult: TechnicalIndicatorResult,
    mlResult: MLAnalysisResult | null,
    combinedStrength: number
  ): SmartSignalType {
    // 如果有ML结果且置信度高，优先考虑ML信号
    if (mlResult && mlResult.confidence > 0.7) {
      return mlResult.prediction;
    }

    // 基于综合强度确定信号
    if (combinedStrength >= 80) return 'STRONG_BUY';
    if (combinedStrength >= 65) return 'BUY';
    if (combinedStrength <= 20) return 'STRONG_SELL';
    if (combinedStrength <= 35) return 'SELL';
    return 'HOLD';
  }

  // 计算价格目标
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
    const atr = indicators.atr || (marketData.high24h - marketData.low24h);
    
    // 基于信号类型和市场条件调整倍数
    let targetMultiplier = 1;
    let stopMultiplier = 0.5;
    
    // 根据信号强度调整
    switch (signal) {
      case 'STRONG_BUY':
        targetMultiplier = condition.volatility === 'HIGH' ? 3 : 2;
        stopMultiplier = 1;
        break;
      case 'BUY':
        targetMultiplier = condition.volatility === 'HIGH' ? 2 : 1.5;
        stopMultiplier = 0.75;
        break;
      case 'STRONG_SELL':
        targetMultiplier = condition.volatility === 'HIGH' ? -3 : -2;
        stopMultiplier = 1;
        break;
      case 'SELL':
        targetMultiplier = condition.volatility === 'HIGH' ? -2 : -1.5;
        stopMultiplier = 0.75;
        break;
      default:
        targetMultiplier = 0;
        stopMultiplier = 0.5;
    }

    // 根据趋势强度调整
    if (condition.strength > 50) {
      targetMultiplier *= 1.2;
    }

    const target = currentPrice + (atr * targetMultiplier);
    const stopLoss = signal.includes('BUY')
      ? currentPrice - (atr * stopMultiplier)
      : currentPrice + (atr * stopMultiplier);
    
    const takeProfit = signal.includes('BUY')
      ? currentPrice + (atr * targetMultiplier * 0.7)
      : currentPrice - (atr * Math.abs(targetMultiplier) * 0.7);

    const riskReward = Math.abs(target - currentPrice) / Math.abs(stopLoss - currentPrice);

    return {
      target,
      stopLoss,
      takeProfit,
      riskReward
    };
  }

  // 计算建议仓位大小
  private calculatePositionSize(
    signal: SmartSignalType,
    strength: number,
    condition: MarketCondition,
    confidence: number
  ): number {
    if (signal === 'HOLD') return 0;

    let baseSize = 0.1; // 基础仓位10%

    // 根据信号强度调整
    if (signal.includes('STRONG')) {
      baseSize = 0.2;
    }

    // 根据置信度调整
    baseSize *= confidence;

    // 根据市场条件调整
    if (condition.volatility === 'HIGH') {
      baseSize *= 0.7; // 高波动时减少仓位
    } else if (condition.volatility === 'LOW') {
      baseSize *= 1.2; // 低波动时增加仓位
    }

    // 根据趋势强度调整
    if (condition.strength > 70) {
      baseSize *= 1.1;
    }

    return Math.max(0.01, Math.min(0.3, baseSize)); // 限制在1%-30%之间
  }

  // 辅助方法
  private calculateTechnicalConfidence(indicators: TechnicalIndicatorResult): number {
    let confidence = 0.5;

    // 计算布林带位置（使用实时价格优先，其次回退到中轨）
    const bollingerRange = indicators.bollinger.upper - indicators.bollinger.lower;
    const currentPrice = (typeof this.lastMarketPrice === 'number') ? this.lastMarketPrice : indicators.bollinger.middle;
    const bollingerPosition = bollingerRange > 0 ? (currentPrice - indicators.bollinger.lower) / bollingerRange : 0.5;

    // 多个指标同向时增加置信度
    const bullishSignals = [
      indicators.rsi < 30,
      indicators.macd.histogram > 0,
      bollingerPosition < 0.3,
      indicators.kdj.k > indicators.kdj.d,
      indicators.williams < -80
    ].filter(Boolean).length;

    const bearishSignals = [
      indicators.rsi > 70,
      indicators.macd.histogram < 0,
      bollingerPosition > 0.7,
      indicators.kdj.k < indicators.kdj.d,
      indicators.williams > -20
    ].filter(Boolean).length;

    const maxSignals = Math.max(bullishSignals, bearishSignals);
    confidence += maxSignals * 0.1;

    return Math.min(0.9, confidence);
  }

  private determineTimeframe(condition: MarketCondition): string {
    if (condition.volatility === 'HIGH') return '短线 (1-4小时)';
    if (condition.trend !== 'SIDEWAYS' && condition.strength > 50) return '中线 (1-3天)';
    return '日内 (15分钟-1小时)';
  }

  private getMarketConditionType(condition: MarketCondition): 'TRENDING' | 'RANGING' | 'VOLATILE' {
    if (condition.volatility === 'HIGH') return 'VOLATILE';
    if (condition.trend === 'SIDEWAYS') return 'RANGING';
    return 'TRENDING';
  }

  private getMomentumType(indicators: TechnicalIndicatorResult): 'STRONG' | 'WEAK' | 'NEUTRAL' {
    const momentum = Math.abs(indicators.macd.histogram);
    if (momentum > 0.002) return 'STRONG';
    if (momentum < 0.0005) return 'WEAK';
    return 'NEUTRAL';
  }

  // 生成推理说明
  private generateTechnicalReasoning(indicators: TechnicalIndicatorResult): string {
    const reasons: string[] = [];

    if (indicators.rsi < 30) reasons.push('RSI显示超卖状态');
    else if (indicators.rsi > 70) reasons.push('RSI显示超买状态');

    if (indicators.macd.histogram > 0) reasons.push('MACD柱状图转正，动能增强');
    else if (indicators.macd.histogram < 0) reasons.push('MACD柱状图为负，动能减弱');

    // 计算布林带位置（使用实时价格优先，其次回退到中轨）
    const bollingerRange = indicators.bollinger.upper - indicators.bollinger.lower;
    if (bollingerRange > 0) {
      const currentPrice = (typeof this.lastMarketPrice === 'number') ? this.lastMarketPrice : indicators.bollinger.middle;
      const position = (currentPrice - indicators.bollinger.lower) / bollingerRange;
      if (position < 0.2) reasons.push('价格接近布林带下轨');
      else if (position > 0.8) reasons.push('价格接近布林带上轨');
    }

    return reasons.length > 0 ? reasons.join('；') : '技术指标处于中性状态';
  }

  private generateRiskReasoning(condition: MarketCondition, mlResult: MLAnalysisResult | null): string {
    const risks: string[] = [];

    if (condition.volatility === 'HIGH') risks.push('市场波动性较高');
    if (condition.volume === 'LOW') risks.push('成交量偏低');
    if (mlResult && mlResult.riskScore > 7) risks.push('AI模型显示高风险');

    return risks.length > 0 ? `风险因素：${risks.join('，')}` : '风险水平适中';
  }

  private generateFinalReasoning(
    signal: SmartSignalType,
    strength: number,
    condition: MarketCondition
  ): string {
    const trendDesc = {
      'UPTREND': '上升趋势',
      'DOWNTREND': '下降趋势',
      'SIDEWAYS': '横盘整理'
    }[condition.trend];

    return `综合分析显示${signal}信号，强度${strength.toFixed(1)}，当前市场处于${trendDesc}状态，建议谨慎操作。`;
  }

  // 风险管理调整
  private applyRiskManagement(
    signal: SmartSignalResult,
    marketData: MarketData,
    condition: MarketCondition
  ): SmartSignalResult {
    // 高波动时降低仓位
    if (condition.volatility === 'HIGH') {
      signal.positionSize *= 0.7;
    }

    // 低成交量时降低信号强度
    if (condition.volume === 'LOW') {
      signal.strength.combined *= 0.8;
      signal.strength.confidence *= 0.9;
    }

    // 确保风险回报比合理
    if (signal.riskReward < 1.5 && signal.signal !== 'HOLD') {
      signal.positionSize *= 0.5;
    }

    return signal;
  }

  // 备用信号
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
      stopLoss: marketData.price * 0.98,
      takeProfit: marketData.price * 1.02,
      riskReward: 1,
      positionSize: 0,
      timeframe: '观望',
      reasoning: {
        technical: '技术分析失败',
        ml: '机器学习分析不可用',
        risk: '系统错误，建议观望',
        final: '分析系统出现问题，建议暂时观望'
      },
      metadata: {
        timestamp: Date.now(),
        marketCondition: 'RANGING',
        volatility: 0.5,
        volume: 'MEDIUM',
        momentum: 'NEUTRAL'
      }
    };
  }

  // 获取最近的分析结果
  getLastAnalysis(): SmartSignalResult | null {
    return this.lastAnalysis;
  }

  // 获取历史数据统计
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
    
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    
    const volatility = returns.length > 0 
      ? Math.sqrt(returns.reduce((sum, ret) => sum + ret * ret, 0) / returns.length)
      : 0;

    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const trend = lastPrice > firstPrice * 1.02 ? 'UPTREND' 
      : lastPrice < firstPrice * 0.98 ? 'DOWNTREND' 
      : 'SIDEWAYS';

    return {
      dataPoints: this.historicalData.length,
      avgPrice,
      volatility,
      trend
    };
  }
}

// 导出单例实例
export const smartSignalAnalyzer = new SmartSignalAnalyzer();