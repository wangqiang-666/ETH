import { TechnicalIndicatorAnalyzer, TechnicalIndicatorResult } from '../indicators/technical-indicators';
import { MLAnalyzer, MLAnalysisResult, MarketData } from '../ml/ml-analyzer';
import { config } from '../config';
import { recommendationDatabase } from '../services/recommendation-database';
import type { MLSampleRecord } from '../services/recommendation-database';
import { logger } from '../utils/logger';

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
    // 新增：布林位置与带宽，用于策略过滤与风控
    bollingerPosition?: number; // 0-1，0=靠近下轨，1=靠近上轨
    bollingerBandwidth?: number; // (上轨-下轨)/中轨
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
  // 新增：记录最近一次市场价格，用于基于“价格”的指标计算（如布林带位置等）
  private lastMarketPrice: number | null = null;

  constructor() {
    this.technicalAnalyzer = new TechnicalIndicatorAnalyzer();
    this.mlAnalyzer = new MLAnalyzer();
  }

  // 主要分析方法（单次撮合：输入最新 marketData 与 K线，输出综合信号）
  async analyzeSignal(
    marketData: MarketData,
    klineData: any[]
  ): Promise<SmartSignalResult> {
    try {
      // 1) 更新历史数据
      this.updateHistoricalData(marketData);
      this.lastMarketPrice = typeof marketData?.price === 'number' ? marketData.price : this.lastMarketPrice;
      logger.debug('AnalyzeSignal | price=%s high24h=%s low24h=%s vol=%s', String(marketData.price), String(marketData.high24h), String(marketData.low24h), String(marketData.volume));

      // 2) 补充K线
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

      // 3) 计算技术指标
      const technicalResult = this.technicalAnalyzer.calculateAllIndicators();
      if (!technicalResult) {
        logger.debug('TechnicalResult unavailable, using fallback');
        return this.getFallbackSignal(marketData);
      }
      logger.debug(
        'Indicators | rsi=%.2f macd.hist=%.4f bollPos~=%.2f bw~=%.4f ema12=%.2f emaTrend=%.2f k=%s d=%s williams=%s',
        technicalResult.rsi,
        technicalResult.macd?.histogram ?? 0,
        (() => {
          const range = technicalResult.bollinger.upper - technicalResult.bollinger.lower;
          const price = Number.isFinite(marketData.price) ? marketData.price : technicalResult.bollinger.middle;
          return range > 0 ? ((price - technicalResult.bollinger.lower) / range) : 0.5;
        })(),
        (() => {
          const mid = technicalResult.bollinger.middle;
          const range = technicalResult.bollinger.upper - technicalResult.bollinger.lower;
          const denom = Number.isFinite(mid) && mid > 0 ? mid : (Number.isFinite(marketData.price) && marketData.price > 0 ? marketData.price : NaN);
          return Number.isFinite(range) && Number.isFinite(denom) && denom > 0 ? (range / denom) : 0;
        })(),
        technicalResult.ema12 ?? 0,
        technicalResult.emaTrend ?? 0,
        String(technicalResult.kdj?.k ?? 'NA'),
        String(technicalResult.kdj?.d ?? 'NA'),
        String(technicalResult.williams ?? 'NA')
      );

      // 4) ML 分析
      let mlResult: MLAnalysisResult | null = null;
      if (config.strategy.useMLAnalysis && this.historicalData.length >= 20) {
        try {
          mlResult = await this.mlAnalyzer.analyze(
            marketData,
            technicalResult,
            this.historicalData
          );
          logger.debug('ML | prediction=%s conf=%.2f', mlResult?.prediction ?? 'NA', mlResult?.confidence ?? 0);
        } catch (error) {
          console.warn('ML analysis failed, using technical analysis only:', error);
        }
      }

      // 5) 市场状态分析
      const marketCondition = this.analyzeMarketCondition(marketData, technicalResult);
      logger.debug('Market | trend=%s strength=%.1f vol=%s phase=%s', marketCondition.trend, marketCondition.strength, marketCondition.volatility, marketCondition.phase);

      // 6) 多因子合成
      const smartSignal = this.combineSignals(
        technicalResult,
        mlResult,
        marketData,
        marketCondition
      );
      logger.debug('Combine | tech=%.1f ml=%.1f combined=%.1f signal=%s', smartSignal.strength.technical, smartSignal.strength.ml, smartSignal.strength.combined, smartSignal.signal);

      // 7) 风险管理调整
      const finalSignal = this.applyRiskManagement(smartSignal, marketData, marketCondition);
      logger.debug('Final | signal=%s conf=%.2f posSize=%.2f tf=%s meta={trend:%s(%.1f), vol=%.2f, bollPos=%.2f, bw=%.4f}',
        finalSignal.signal,
        finalSignal.strength.confidence,
        finalSignal.positionSize,
        finalSignal.timeframe,
        finalSignal.metadata.trendDirection ?? 'NA',
        finalSignal.metadata.trendStrength ?? 0,
        finalSignal.metadata.volatility ?? 0,
        finalSignal.metadata.bollingerPosition ?? 0.5,
        finalSignal.metadata.bollingerBandwidth ?? 0
      );

      // 7.1) 记录训练样本
      try {
        await this.logMLSample(marketData, technicalResult, mlResult, finalSignal);
      } catch (e) {
        console.warn('Log ML sample failed:', e);
      }

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
    
    // 仅保留最近 1000 条数据点，控制内存占用
    if (this.historicalData.length > 1000) {
      this.historicalData = this.historicalData.slice(-1000);
    }
  }

  // 分析市场状态（趋势/波动/成交量/阶段）
  private analyzeMarketCondition(
    marketData: MarketData,
    technicalResult: TechnicalIndicatorResult
  ): MarketCondition {
    // 趋势分析
    let trend: MarketCondition['trend'] = 'SIDEWAYS';
    let trendStrength = 0;

    // 基于 EMA 趋势线与价格、短期 EMA 判断趋势方向
    if (technicalResult.emaTrend && technicalResult.ema12) {
      if (marketData.price > technicalResult.emaTrend && technicalResult.ema12 > technicalResult.emaTrend) {
        trend = 'UPTREND';
        trendStrength = Math.min(((marketData.price - technicalResult.emaTrend) / technicalResult.emaTrend) * 100, 100);
      } else if (marketData.price < technicalResult.emaTrend && technicalResult.ema12 < technicalResult.emaTrend) {
        trend = 'DOWNTREND';
        trendStrength = Math.min(((technicalResult.emaTrend - marketData.price) / technicalResult.emaTrend) * 100, 100);
      }
    }

    // 波动性分析（24h 高低差占比）
    const priceRange = marketData.high24h - marketData.low24h;
    const volatilityRatio = priceRange / marketData.price;
    let volatility: MarketCondition['volatility'] = 'MEDIUM';
    
    if (volatilityRatio > 0.05) volatility = 'HIGH';
    else if (volatilityRatio < 0.02) volatility = 'LOW';

    // 成交量分析（简单阈值；实际建议与历史均值比较）
    let volume: MarketCondition['volume'] = 'MEDIUM';
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

  // 多因子合成信号
  private combineSignals(
    technicalResult: TechnicalIndicatorResult,
    mlResult: MLAnalysisResult | null,
    marketData: MarketData,
    marketCondition: MarketCondition
  ): SmartSignalResult {
    // 技术面强度
    const technicalStrength = this.calculateTechnicalStrength(technicalResult);
    
    // ML 强度（无结果则视为中性 50）
    const mlStrength = mlResult ? this.calculateMLStrength(mlResult) : 50;
    
    // 综合强度 = 技术面*权重 + ML*权重 + 市场状态*权重
    const weights = config.strategy.multiFactorWeights;
    let combinedStrength = (
      technicalStrength * weights.technical +
      mlStrength * weights.ml +
      this.getMarketConditionScore(marketCondition) * weights.market
    ) / (weights.technical + weights.ml + weights.market);

    // 如果存在离线模型：基于方向偏好微调综合强度
    const offline = MLAnalyzer.getOfflineModel?.() || null;
    if (offline && offline.thresholds) {
      const thrLong = Number(offline.thresholds.long?.threshold);
      const thrShort = Number(offline.thresholds.short?.threshold);
      if (Number.isFinite(thrLong) && Number.isFinite(thrShort)) {
        // 简化方向判定：结合 RSI 与 MACD
        const directionalBias = (() => {
          const rsi = technicalResult.rsi;
          const macdHist = technicalResult.macd.histogram;
          let bias = 0;
          if (rsi <= config.indicators.rsi.oversold && macdHist > 0) bias += 1; // 偏多
          if (rsi >= config.indicators.rsi.overbought && macdHist < 0) bias -= 1; // 偏空
          return bias; // -1, 0, 1
        })();
        if (directionalBias > 0 && combinedStrength >= thrLong) {
          // 偏多且已越过做多阈值，小幅上调综合强度以推动 BUY 侧
          combinedStrength = Math.min(100, combinedStrength + 5);
        } else if (directionalBias < 0 && combinedStrength >= thrShort) {
          // 偏空且已越过做空阈值，小幅上调综合强度以推动 SELL 侧
          combinedStrength = Math.min(100, combinedStrength + 5);
        }
      }
    }

    // 确定最终信号
    const signal = this.determineSignal(technicalResult, mlResult, combinedStrength);
    
    // 计算价格目标（目标/止损/止盈/风报比）
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
        ml: mlResult?.reasoning || 'ML analysis unavailable',
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
        // 新增：布林带位置/带宽（优先使用实时价格，带边界控制与有限值检查）
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

    // RSI 评分（使用配置阈值）
    const overbought = config.indicators.rsi.overbought;
    const oversold = config.indicators.rsi.oversold;
    const mid = (overbought + oversold) / 2;
    const neutralLow = mid - 5;
    const neutralHigh = mid + 5;

    if (indicators.rsi <= oversold) score += 20; // 超卖
    else if (indicators.rsi >= overbought) score -= 20; // 超买
    else if (indicators.rsi >= neutralLow && indicators.rsi <= neutralHigh) score += 5; // 中性区间（±5）

    // MACD 评分
    if (indicators.macd.histogram > 0) {
      score += indicators.macd.histogram > 0.001 ? 15 : 10;
    } else {
      score -= Math.abs(indicators.macd.histogram) > 0.001 ? 15 : 10;
    }

    // 布林带评分（优先使用实时价格，回退中轨以避免 NaN）
    const bollingerRange = indicators.bollinger.upper - indicators.bollinger.lower;
    if (bollingerRange > 0) {
      const currentPrice = (typeof this.lastMarketPrice === 'number') ? this.lastMarketPrice : indicators.bollinger.middle;
      const position = (currentPrice - indicators.bollinger.lower) / bollingerRange;
      if (position < 0.2) score += 15; // 靠近下轨
      else if (position > 0.8) score -= 15; // 靠近上轨
    }

    // KDJ 评分
    if (indicators.kdj.k > indicators.kdj.d && indicators.kdj.k < 80) score += 10;
    else if (indicators.kdj.k < indicators.kdj.d && indicators.kdj.k > 20) score -= 10;

    // 威廉指标评分
    if (indicators.williams < -80) score += 10; // 超卖
    else if (indicators.williams > -20) score -= 10; // 超买

    // 新增：EMA 趋势评分（短期 EMA 相对趋势 EMA）
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
    // 如有 ML 结果且置信度高，优先采用 ML 信号
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
    
    // 基于信号类型与市场条件调整系数
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

  // 计算建议仓位
  private calculatePositionSize(
    signal: SmartSignalType,
    strength: number,
    condition: MarketCondition,
    confidence: number
  ): number {
    if (signal === 'HOLD') return 0;

    let baseSize = 0.1; // 基础仓位 10%

    // 根据信号强度调整
    if (signal.includes('STRONG')) {
      baseSize = 0.2;
    }

    // 根据置信度调整
    baseSize *= confidence;

    // 根据市场条件调整
    if (condition.volatility === 'HIGH') {
      baseSize *= 0.7; // 高波动时降低仓位
    } else if (condition.volatility === 'LOW') {
      baseSize *= 1.2; // 低波动时适度增加仓位
    }

    // 根据趋势强度微调
    if (condition.strength > 70) {
      baseSize *= 1.1;
    }

    return Math.max(0.01, Math.min(0.3, baseSize)); // 限制在 1%-30% 之间
  }

  // 辅助方法
  private calculateTechnicalConfidence(indicators: TechnicalIndicatorResult): number {
    let confidence = 0.5;

    // 计算布林带位置（优先使用实时价格，回退到中轨）
    const bollingerRange = indicators.bollinger.upper - indicators.bollinger.lower;
    const currentPrice = (typeof this.lastMarketPrice === 'number') ? this.lastMarketPrice : indicators.bollinger.middle;
    const bollingerPosition = bollingerRange > 0 ? (currentPrice - indicators.bollinger.lower) / bollingerRange : 0.5;

    // 多个指标同向时提高置信度
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
    if (condition.volatility === 'HIGH') return 'Short-term (1-4h)';
    if (condition.trend !== 'SIDEWAYS' && condition.strength > 50) return 'Medium-term (1-3d)';
    return 'Intraday (15m-1h)';
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

  // 生成技术面说明
  private generateTechnicalReasoning(indicators: TechnicalIndicatorResult): string {
    const reasons: string[] = [];

    if (indicators.rsi < 30) reasons.push('RSI indicates oversold');
    else if (indicators.rsi > 70) reasons.push('RSI indicates overbought');

    if (indicators.macd.histogram > 0) reasons.push('MACD histogram positive (bullish momentum)');
    else if (indicators.macd.histogram < 0) reasons.push('MACD histogram negative (bearish momentum)');

    const bollingerRange = indicators.bollinger.upper - indicators.bollinger.lower;
    if (bollingerRange > 0) {
      const currentPrice = (typeof this.lastMarketPrice === 'number') ? this.lastMarketPrice : indicators.bollinger.middle;
      const position = (currentPrice - indicators.bollinger.lower) / bollingerRange;
      if (position < 0.2) reasons.push('Price near lower Bollinger band');
      else if (position > 0.8) reasons.push('Price near upper Bollinger band');
    }

    return reasons.length > 0 ? reasons.join('; ') : 'Technical indicators are neutral';
  }

  private generateRiskReasoning(condition: MarketCondition, mlResult: MLAnalysisResult | null): string {
    const risks: string[] = [];

    if (condition.volatility === 'HIGH') risks.push('High market volatility');
    if (condition.volume === 'LOW') risks.push('Low trading volume');
    if (mlResult && mlResult.riskScore > 7) risks.push('Model indicates elevated risk');

    return risks.length > 0 ? `Risk factors: ${risks.join('; ')}` : 'Risk level is neutral';
  }

  private generateFinalReasoning(
    signal: SmartSignalType,
    strength: number,
    condition: MarketCondition
  ): string {
    const trendDesc = {
      UPTREND: 'uptrend',
      DOWNTREND: 'downtrend',
      SIDEWAYS: 'range'
    }[condition.trend];

    return `Combined analysis suggests ${signal} (strength ${strength.toFixed(1)}). Current market is in ${trendDesc}. Consider prudent execution.`;
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

    // 低成交量时降低信号强度/置信度
    if (condition.volume === 'LOW') {
      signal.strength.combined *= 0.8;
      signal.strength.confidence *= 0.9;
    }

    // 确保风报比合理
    if (signal.riskReward < 1.5 && signal.signal !== 'HOLD') {
      signal.positionSize *= 0.5;
    }

    return signal;
  }

  // 兜底信号
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
      timeframe: 'Watch',
      reasoning: {
        technical: 'Technical analysis failed',
        ml: 'ML analysis unavailable',
        risk: 'System error encountered',
        final: 'Analysis system experienced an issue; suggest staying on the sidelines'
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

  // 新增：稳健的 ML 样本记录（异步、容错）
  private async logMLSample(
    marketData: MarketData,
    technicalResult: TechnicalIndicatorResult,
    mlResult: MLAnalysisResult | null,
    result: SmartSignalResult
  ): Promise<void> {
    try {
      await recommendationDatabase.initialize();
  
      const featuresPayload: any = {
        fgiScore: marketData.fgiScore ?? null,
        fundingRate: marketData.fundingRate ?? null,
        openInterest: marketData.openInterest ?? null,
        change24h: marketData.change24h,
        changeFromSodUtc8: marketData.changeFromSodUtc8 ?? null
      };
      if (mlResult?.features) {
        featuresPayload.ml = mlResult.features;
      }
  
      const sample: MLSampleRecord = {
        timestamp: typeof marketData.timestamp === 'number' ? marketData.timestamp : Date.now(),
        symbol: marketData.symbol || config.trading.defaultSymbol,
        interval: config.strategy.primaryInterval,
        price: marketData.price,
        features_json: (() => { try { return JSON.stringify(featuresPayload); } catch { return undefined as any; } })(),
        indicators_json: (() => { try { return JSON.stringify(technicalResult); } catch { return undefined as any; } })(),
        ml_prediction: mlResult?.prediction,
        ml_confidence: mlResult?.confidence,
        technical_strength: result?.strength?.technical ?? null,
        combined_strength: result?.strength?.combined ?? null,
        final_signal: result?.signal ?? null,
        position_size: result?.positionSize ?? null,
        target_price: result?.targetPrice ?? null,
        stop_loss: result?.stopLoss ?? null,
        take_profit: result?.takeProfit ?? null,
        risk_reward: result?.riskReward ?? null,
        reasoning_ml: mlResult?.reasoning ?? undefined,
        reasoning_final: result?.reasoning?.final ?? undefined,
        label_horizon_min: (config as any)?.ml?.training?.labelHorizonMinutes ?? 60,
        label_return: null,
        label_drawdown: null,
        label_ready: false
      };

      await recommendationDatabase.saveMLSample(sample);
    } catch (err) {
      console.warn('logMLSample failed:', err);
    }
  }

}

// 导出单例，供其他模块复用
export const smartSignalAnalyzer = new SmartSignalAnalyzer();