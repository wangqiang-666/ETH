import { TechnicalIndicatorAnalyzer, TechnicalIndicatorResult } from '../indicators/technical-indicators';
import { MLAnalyzer, MLAnalysisResult, MarketData } from '../ml/ml-analyzer';
import { SmartSignalAnalyzer, SmartSignalResult, SmartSignalType } from './smart-signal-analyzer';
import { config } from '../config';

// 多因子分析结果
export interface MultiFactorAnalysisResult {
  // 基础信号
  primarySignal: SmartSignalResult;
  
  // 因子分析
  factors: {
    technical: FactorAnalysis;
    fundamental: FactorAnalysis;
    sentiment: FactorAnalysis;
    momentum: FactorAnalysis;
    volatility: FactorAnalysis;
    volume: FactorAnalysis;
  };
  
  // 综合评分
  compositeScore: {
    bullish: number;    // 看涨评分 0-100
    bearish: number;    // 看跌评分 0-100
    neutral: number;    // 中性评分 0-100
    confidence: number; // 置信度 0-1
  };
  
  // 风险评估
  riskAssessment: {
    level: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    factors: string[];
    score: number; // 0-100
    recommendation: string;
  };
  
  // 时间框架分析
  timeframeAnalysis: {
    shortTerm: SignalStrengthByTimeframe;  // 1-5分钟
    mediumTerm: SignalStrengthByTimeframe; // 15分钟-1小时
    longTerm: SignalStrengthByTimeframe;   // 4小时-1天
  };
  
  // 执行建议
  execution: {
    action: 'BUY' | 'SELL' | 'HOLD' | 'WAIT';
    urgency: 'LOW' | 'MEDIUM' | 'HIGH';
    optimalEntry: number;
    stopLoss: number;
    takeProfit: number[];
    positionSizing: {
      conservative: number;
      moderate: number;
      aggressive: number;
    };
  };
  
  metadata: {
    timestamp: number;
    analysisVersion: string;
    processingTime: number;
    dataQuality: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  };
}

// 单因子分析结果
export interface FactorAnalysis {
  score: number;        // 因子评分 -100 到 100
  weight: number;       // 因子权重 0-1
  confidence: number;   // 置信度 0-1
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: 'WEAK' | 'MODERATE' | 'STRONG';
  signals: string[];    // 具体信号描述
  rawData: any;        // 原始数据
}

// 时间框架信号强度
export interface SignalStrengthByTimeframe {
  signal: SmartSignalType;
  strength: number;
  confidence: number;
  keyLevels: {
    support: number[];
    resistance: number[];
  };
}

// 多因子交易信号分析引擎
export class MultiFactorAnalyzer {
  private smartSignalAnalyzer: SmartSignalAnalyzer;
  private technicalAnalyzer: TechnicalIndicatorAnalyzer;
  private mlAnalyzer: MLAnalyzer;
  private historicalAnalyses: MultiFactorAnalysisResult[] = [];
  private lastAnalysisTime: number = 0;
  
  constructor() {
    this.smartSignalAnalyzer = new SmartSignalAnalyzer();
    this.technicalAnalyzer = new TechnicalIndicatorAnalyzer();
    this.mlAnalyzer = new MLAnalyzer();
  }

  /**
   * 执行多因子分析
   */
  async analyzeMultiFactors(
    marketData: MarketData,
    klineData: any[],
    options: {
      includeML?: boolean;
      timeframes?: string[];
      riskTolerance?: 'LOW' | 'MEDIUM' | 'HIGH';
    } = {}
  ): Promise<MultiFactorAnalysisResult> {
    const startTime = Date.now();
    
    try {
      // 1. 获取基础智能信号
      const primarySignal = await this.smartSignalAnalyzer.analyzeSignal(marketData, klineData);
      
      // 2. 执行各因子分析
      const factors = await this.analyzeAllFactors(marketData, klineData, primarySignal);
      
      // 3. 计算综合评分
      const compositeScore = this.calculateCompositeScore(factors, primarySignal);
      
      // 4. 风险评估
      const riskAssessment = this.assessRisk(factors, marketData, options.riskTolerance || 'MEDIUM');
      
      // 5. 时间框架分析
      const timeframeAnalysis = await this.analyzeTimeframes(marketData, klineData);
      
      // 6. 生成执行建议
      const execution = this.generateExecutionPlan(compositeScore, riskAssessment, primarySignal);
      
      const result: MultiFactorAnalysisResult = {
        primarySignal,
        factors,
        compositeScore,
        riskAssessment,
        timeframeAnalysis,
        execution,
        metadata: {
          timestamp: Date.now(),
          analysisVersion: '1.0.0',
          processingTime: Date.now() - startTime,
          dataQuality: this.assessDataQuality(marketData, klineData)
        }
      };
      
      // 保存历史分析
      this.saveAnalysis(result);
      
      return result;
      
    } catch (error) {
      console.error('Multi-factor analysis failed:', error);
      throw new Error(`多因子分析失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 分析所有因子
   */
  private async analyzeAllFactors(
    marketData: MarketData,
    klineData: any[],
    primarySignal: SmartSignalResult
  ): Promise<MultiFactorAnalysisResult['factors']> {
    
    return {
      technical: await this.analyzeTechnicalFactor(primarySignal.strength, klineData),
      fundamental: await this.analyzeFundamentalFactor(marketData),
      sentiment: await this.analyzeSentimentFactor(marketData, klineData),
      momentum: await this.analyzeMomentumFactor(klineData),
      volatility: await this.analyzeVolatilityFactor(klineData),
      volume: await this.analyzeVolumeFactor(klineData)
    };
  }

  /**
   * 技术因子分析
   */
  private async analyzeTechnicalFactor(
    signalStrength: any,
    klineData: any[]
  ): Promise<FactorAnalysis> {
    const signals: string[] = [];
    let score = 0;
    
    // 基于技术指标强度计算评分
    const technicalScore = signalStrength.technical;
    score = (technicalScore - 50) * 2; // 转换为-100到100的范围
    
    // 生成信号描述
    if (technicalScore > 70) {
      signals.push('技术指标显示强烈看涨信号');
      signals.push('多个指标确认上涨趋势');
    } else if (technicalScore < 30) {
      signals.push('技术指标显示强烈看跌信号');
      signals.push('多个指标确认下跌趋势');
    } else {
      signals.push('技术指标显示中性信号');
    }
    
    return {
      score,
      weight: 0.4, // 技术指标权重
      confidence: signalStrength.confidence,
      trend: score > 20 ? 'BULLISH' : score < -20 ? 'BEARISH' : 'NEUTRAL',
      strength: Math.abs(score) > 60 ? 'STRONG' : Math.abs(score) > 30 ? 'MODERATE' : 'WEAK',
      signals,
      rawData: { technicalScore, signalStrength }
    };
  }

  /**
   * 基本面因子分析
   */
  private async analyzeFundamentalFactor(marketData: MarketData): Promise<FactorAnalysis> {
    const signals: string[] = [];
    let score = 0;
    
    // 基于价格变化分析基本面
    const priceChange24h = marketData.change24h || 0;
    const volume24h = marketData.volume || 0;
    
    // 价格变化评分
    score += priceChange24h * 10; // 1%变化 = 10分
    
    // 成交量评分
    if (volume24h > 1000000) {
      score += 20;
      signals.push('高成交量支持价格走势');
    } else if (volume24h < 100000) {
      score -= 10;
      signals.push('低成交量，缺乏市场参与度');
    }
    
    // 资金费率影响
    if (marketData.fundingRate) {
      const fundingRate = marketData.fundingRate;
      if (fundingRate > 0.01) {
        score -= 15;
        signals.push('高资金费率，做多成本较高');
      } else if (fundingRate < -0.01) {
        score += 15;
        signals.push('负资金费率，做多有资金收益');
      }
    }
    
    return {
      score: Math.max(-100, Math.min(100, score)),
      weight: 0.2,
      confidence: 0.7,
      trend: score > 10 ? 'BULLISH' : score < -10 ? 'BEARISH' : 'NEUTRAL',
      strength: Math.abs(score) > 50 ? 'STRONG' : Math.abs(score) > 25 ? 'MODERATE' : 'WEAK',
      signals,
      rawData: { priceChange24h, volume24h, fundingRate: marketData.fundingRate }
    };
  }

  /**
   * 市场情绪因子分析
   */
  private async analyzeSentimentFactor(
    marketData: MarketData,
    klineData: any[]
  ): Promise<FactorAnalysis> {
    const signals: string[] = [];
    let score = 0;
    
    // 基于最近价格行为分析情绪
    if (klineData.length >= 10) {
      const recentCandles = klineData.slice(-10);
      let bullishCandles = 0;
      let bearishCandles = 0;
      
      recentCandles.forEach(candle => {
        const open = parseFloat(candle.open || candle[1]);
        const close = parseFloat(candle.close || candle[4]);
        if (close > open) bullishCandles++;
        else bearishCandles++;
      });
      
      const bullishRatio = bullishCandles / recentCandles.length;
      score = (bullishRatio - 0.5) * 200; // 转换为-100到100
      
      if (bullishRatio > 0.7) {
        signals.push('市场情绪偏向乐观');
        signals.push('连续阳线显示买盘积极');
      } else if (bullishRatio < 0.3) {
        signals.push('市场情绪偏向悲观');
        signals.push('连续阴线显示卖压较重');
      } else {
        signals.push('市场情绪相对中性');
      }
    }
    
    return {
      score: Math.max(-100, Math.min(100, score)),
      weight: 0.15,
      confidence: 0.6,
      trend: score > 20 ? 'BULLISH' : score < -20 ? 'BEARISH' : 'NEUTRAL',
      strength: Math.abs(score) > 60 ? 'STRONG' : Math.abs(score) > 30 ? 'MODERATE' : 'WEAK',
      signals,
      rawData: { klineData: klineData.slice(-10) }
    };
  }

  /**
   * 动量因子分析
   */
  private async analyzeMomentumFactor(klineData: any[]): Promise<FactorAnalysis> {
    const signals: string[] = [];
    let score = 0;
    
    if (klineData.length >= 20) {
      const prices = klineData.slice(-20).map(k => parseFloat(k.close || k[4]));
      
      // 计算动量指标
      const momentum10 = (prices[prices.length - 1] - prices[prices.length - 11]) / prices[prices.length - 11];
      const momentum5 = (prices[prices.length - 1] - prices[prices.length - 6]) / prices[prices.length - 6];
      
      // 动量评分
      score = (momentum10 * 500 + momentum5 * 300) / 2;
      
      if (momentum10 > 0.02 && momentum5 > 0.01) {
        signals.push('短期和中期动量均为正');
        signals.push('价格上涨动能强劲');
      } else if (momentum10 < -0.02 && momentum5 < -0.01) {
        signals.push('短期和中期动量均为负');
        signals.push('价格下跌动能强劲');
      } else {
        signals.push('动量信号混合，趋势不明确');
      }
    }
    
    return {
      score: Math.max(-100, Math.min(100, score)),
      weight: 0.25,
      confidence: 0.8,
      trend: score > 15 ? 'BULLISH' : score < -15 ? 'BEARISH' : 'NEUTRAL',
      strength: Math.abs(score) > 50 ? 'STRONG' : Math.abs(score) > 25 ? 'MODERATE' : 'WEAK',
      signals,
      rawData: { momentum10: score > 0 ? score / 500 : score / 500, momentum5: score > 0 ? score / 300 : score / 300 }
    };
  }

  /**
   * 波动率因子分析
   */
  private async analyzeVolatilityFactor(klineData: any[]): Promise<FactorAnalysis> {
    const signals: string[] = [];
    let score = 0;
    
    if (klineData.length >= 20) {
      const prices = klineData.slice(-20).map(k => parseFloat(k.close || k[4]));
      
      // 计算波动率
      const returns = [];
      for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i-1]) / prices[i-1]);
      }
      
      const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
      const volatility = Math.sqrt(variance);
      
      // 波动率评分 (低波动率通常更有利于趋势延续)
      if (volatility < 0.02) {
        score = 20;
        signals.push('低波动率环境，有利于趋势延续');
      } else if (volatility > 0.05) {
        score = -30;
        signals.push('高波动率环境，市场不确定性较大');
      } else {
        score = 0;
        signals.push('中等波动率，市场相对稳定');
      }
    }
    
    return {
      score,
      weight: 0.15,
      confidence: 0.7,
      trend: score > 10 ? 'BULLISH' : score < -10 ? 'BEARISH' : 'NEUTRAL',
      strength: Math.abs(score) > 20 ? 'STRONG' : Math.abs(score) > 10 ? 'MODERATE' : 'WEAK',
      signals,
      rawData: { volatility: score !== 0 ? (score > 0 ? 0.02 : 0.05) : 0.035 }
    };
  }

  /**
   * 成交量因子分析
   */
  private async analyzeVolumeFactor(klineData: any[]): Promise<FactorAnalysis> {
    const signals: string[] = [];
    let score = 0;
    
    if (klineData.length >= 10) {
      const volumes = klineData.slice(-10).map(k => parseFloat(k.volume || k[5]));
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      const currentVolume = volumes[volumes.length - 1];
      
      // 成交量评分
      const volumeRatio = currentVolume / avgVolume;
      
      if (volumeRatio > 1.5) {
        score = 30;
        signals.push('成交量显著放大，市场参与度高');
      } else if (volumeRatio < 0.7) {
        score = -20;
        signals.push('成交量萎缩，市场参与度低');
      } else {
        score = 0;
        signals.push('成交量正常，市场参与度适中');
      }
    }
    
    return {
      score,
      weight: 0.2,
      confidence: 0.6,
      trend: score > 15 ? 'BULLISH' : score < -15 ? 'BEARISH' : 'NEUTRAL',
      strength: Math.abs(score) > 25 ? 'STRONG' : Math.abs(score) > 15 ? 'MODERATE' : 'WEAK',
      signals,
      rawData: { volumeRatio: score !== 0 ? (score > 0 ? 1.5 : 0.7) : 1.0 }
    };
  }

  /**
   * 计算综合评分
   */
  private calculateCompositeScore(
    factors: MultiFactorAnalysisResult['factors'],
    primarySignal: SmartSignalResult
  ): MultiFactorAnalysisResult['compositeScore'] {
    
    let weightedScore = 0;
    let totalWeight = 0;
    let totalConfidence = 0;
    let factorCount = 0;
    
    // 计算加权评分
    Object.values(factors).forEach(factor => {
      weightedScore += factor.score * factor.weight;
      totalWeight += factor.weight;
      totalConfidence += factor.confidence;
      factorCount++;
    });
    
    const normalizedScore = weightedScore / totalWeight;
    const avgConfidence = totalConfidence / factorCount;
    
    // 转换为看涨/看跌/中性评分
    const bullish = Math.max(0, normalizedScore);
    const bearish = Math.max(0, -normalizedScore);
    const neutral = 100 - Math.abs(normalizedScore);
    
    return {
      bullish: Math.min(100, bullish),
      bearish: Math.min(100, bearish),
      neutral: Math.max(0, neutral),
      confidence: (avgConfidence + primarySignal.strength.confidence) / 2
    };
  }

  /**
   * 风险评估
   */
  private assessRisk(
    factors: MultiFactorAnalysisResult['factors'],
    marketData: MarketData,
    riskTolerance: 'LOW' | 'MEDIUM' | 'HIGH'
  ): MultiFactorAnalysisResult['riskAssessment'] {
    
    const riskFactors: string[] = [];
    let riskScore = 0;
    
    // 波动率风险
    if (factors.volatility.score < -20) {
      riskScore += 30;
      riskFactors.push('高波动率增加交易风险');
    }
    
    // 成交量风险
    if (factors.volume.score < -15) {
      riskScore += 20;
      riskFactors.push('低成交量可能导致滑点增加');
    }
    
    // 技术指标分歧风险
    if (Math.abs(factors.technical.score) < 20) {
      riskScore += 15;
      riskFactors.push('技术指标信号不明确');
    }
    
    // 市场情绪风险
    if (factors.sentiment.strength === 'WEAK') {
      riskScore += 10;
      riskFactors.push('市场情绪不稳定');
    }
    
    // 根据风险容忍度调整
    const toleranceMultiplier = {
      'LOW': 1.5,
      'MEDIUM': 1.0,
      'HIGH': 0.7
    }[riskTolerance];
    
    riskScore *= toleranceMultiplier;
    
    let level: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    let recommendation: string;
    
    if (riskScore < 20) {
      level = 'LOW';
      recommendation = '风险较低，可以考虑正常仓位交易';
    } else if (riskScore < 40) {
      level = 'MEDIUM';
      recommendation = '风险中等，建议适度降低仓位';
    } else if (riskScore < 70) {
      level = 'HIGH';
      recommendation = '风险较高，建议小仓位或观望';
    } else {
      level = 'EXTREME';
      recommendation = '风险极高，建议暂停交易';
    }
    
    return {
      level,
      factors: riskFactors,
      score: Math.min(100, riskScore),
      recommendation
    };
  }

  /**
   * 时间框架分析
   */
  private async analyzeTimeframes(
    marketData: MarketData,
    klineData: any[]
  ): Promise<MultiFactorAnalysisResult['timeframeAnalysis']> {
    
    // 简化的时间框架分析
    const baseSignal = marketData.change24h > 0 ? 'BUY' : 'SELL';
    const baseStrength = Math.min(100, Math.abs(marketData.change24h));
    
    return {
      shortTerm: {
        signal: baseSignal as SmartSignalType,
        strength: baseStrength * 0.8,
        confidence: 0.6,
        keyLevels: {
          support: [marketData.price * 0.98, marketData.price * 0.95],
          resistance: [marketData.price * 1.02, marketData.price * 1.05]
        }
      },
      mediumTerm: {
        signal: baseSignal as SmartSignalType,
        strength: baseStrength,
        confidence: 0.7,
        keyLevels: {
          support: [marketData.price * 0.95, marketData.price * 0.90],
          resistance: [marketData.price * 1.05, marketData.price * 1.10]
        }
      },
      longTerm: {
        signal: baseSignal as SmartSignalType,
        strength: baseStrength * 1.2,
        confidence: 0.8,
        keyLevels: {
          support: [marketData.price * 0.90, marketData.price * 0.85],
          resistance: [marketData.price * 1.10, marketData.price * 1.15]
        }
      }
    };
  }

  /**
   * 生成执行计划
   */
  private generateExecutionPlan(
    compositeScore: MultiFactorAnalysisResult['compositeScore'],
    riskAssessment: MultiFactorAnalysisResult['riskAssessment'],
    primarySignal: SmartSignalResult
  ): MultiFactorAnalysisResult['execution'] {
    
    let action: 'BUY' | 'SELL' | 'HOLD' | 'WAIT';
    let urgency: 'LOW' | 'MEDIUM' | 'HIGH';
    
    // 根据综合评分和风险评估确定行动
    if (riskAssessment.level === 'EXTREME') {
      action = 'WAIT';
      urgency = 'LOW';
    } else if (compositeScore.bullish > 70 && compositeScore.confidence > 0.7) {
      action = 'BUY';
      urgency = riskAssessment.level === 'LOW' ? 'HIGH' : 'MEDIUM';
    } else if (compositeScore.bearish > 70 && compositeScore.confidence > 0.7) {
      action = 'SELL';
      urgency = riskAssessment.level === 'LOW' ? 'HIGH' : 'MEDIUM';
    } else {
      action = 'HOLD';
      urgency = 'LOW';
    }
    
    // 仓位建议
    const basePosition = primarySignal.positionSize;
    const riskMultiplier = {
      'LOW': 1.0,
      'MEDIUM': 0.7,
      'HIGH': 0.4,
      'EXTREME': 0.1
    }[riskAssessment.level];
    
    return {
      action,
      urgency,
      optimalEntry: primarySignal.targetPrice,
      stopLoss: primarySignal.stopLoss,
      takeProfit: [
        primarySignal.takeProfit,
        primarySignal.takeProfit * 1.2,
        primarySignal.takeProfit * 1.5
      ],
      positionSizing: {
        conservative: basePosition * riskMultiplier * 0.5,
        moderate: basePosition * riskMultiplier,
        aggressive: basePosition * riskMultiplier * 1.5
      }
    };
  }

  /**
   * 评估数据质量
   */
  private assessDataQuality(
    marketData: MarketData,
    klineData: any[]
  ): 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' {
    
    let qualityScore = 0;
    
    // K线数据完整性
    if (klineData.length >= 100) qualityScore += 25;
    else if (klineData.length >= 50) qualityScore += 15;
    else if (klineData.length >= 20) qualityScore += 10;
    
    // 市场数据完整性
    if (marketData.price && marketData.volume) qualityScore += 25;
    if (marketData.change24h !== undefined) qualityScore += 15;
    if (marketData.fundingRate !== undefined) qualityScore += 10;
    
    // 数据新鲜度
    const dataAge = Date.now() - (marketData.timestamp || 0);
    if (dataAge < 60000) qualityScore += 25; // 1分钟内
    else if (dataAge < 300000) qualityScore += 15; // 5分钟内
    else if (dataAge < 900000) qualityScore += 5; // 15分钟内
    
    if (qualityScore >= 80) return 'EXCELLENT';
    if (qualityScore >= 60) return 'GOOD';
    if (qualityScore >= 40) return 'FAIR';
    return 'POOR';
  }

  /**
   * 保存分析结果
   */
  private saveAnalysis(result: MultiFactorAnalysisResult): void {
    this.historicalAnalyses.push(result);
    
    // 保持最近100个分析结果
    if (this.historicalAnalyses.length > 100) {
      this.historicalAnalyses = this.historicalAnalyses.slice(-100);
    }
    
    this.lastAnalysisTime = result.metadata.timestamp;
  }

  /**
   * 获取历史分析统计
   */
  getAnalysisStats(): {
    totalAnalyses: number;
    avgProcessingTime: number;
    avgConfidence: number;
    signalDistribution: { [key: string]: number };
  } {
    if (this.historicalAnalyses.length === 0) {
      return {
        totalAnalyses: 0,
        avgProcessingTime: 0,
        avgConfidence: 0,
        signalDistribution: {}
      };
    }
    
    const totalProcessingTime = this.historicalAnalyses.reduce(
      (sum, analysis) => sum + analysis.metadata.processingTime, 0
    );
    
    const totalConfidence = this.historicalAnalyses.reduce(
      (sum, analysis) => sum + analysis.compositeScore.confidence, 0
    );
    
    const signalDistribution: { [key: string]: number } = {};
    this.historicalAnalyses.forEach(analysis => {
      const action = analysis.execution.action;
      signalDistribution[action] = (signalDistribution[action] || 0) + 1;
    });
    
    return {
      totalAnalyses: this.historicalAnalyses.length,
      avgProcessingTime: totalProcessingTime / this.historicalAnalyses.length,
      avgConfidence: totalConfidence / this.historicalAnalyses.length,
      signalDistribution
    };
  }

  /**
   * 获取最新分析结果
   */
  getLatestAnalysis(): MultiFactorAnalysisResult | null {
    return this.historicalAnalyses.length > 0 
      ? this.historicalAnalyses[this.historicalAnalyses.length - 1] 
      : null;
  }
}

// 导出单例实例
export const multiFactorAnalyzer = new MultiFactorAnalyzer();