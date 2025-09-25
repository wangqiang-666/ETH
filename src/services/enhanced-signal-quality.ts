/**
 * 增强信号质量服务
 * 优化多因子权重、增强市场环境适应性、完善EV计算
 */

import { config } from '../config.js';
import { enhancedOKXDataService } from './enhanced-okx-data-service.js';
import { EventEmitter } from 'events';

export interface MarketRegime {
  type: 'BULL' | 'BEAR' | 'SIDEWAYS' | 'VOLATILE';
  strength: number; // 0-1
  volatility: number;
  trend: 'UP' | 'DOWN' | 'NEUTRAL';
  momentum: number;
  volume: number;
  fearGreed: number;
  fundingRate: number;
}

export interface SignalComponents {
  technical: {
    score: number;
    confidence: number;
    components: {
      trend: number;
      momentum: number;
      oscillators: number;
      volume: number;
      volatility: number;
    };
  };
  ml: {
    score: number;
    confidence: number;
    prediction: number;
    accuracy: number;
  };
  market: {
    score: number;
    confidence: number;
    sentiment: number;
    microstructure: number;
    regime: MarketRegime;
  };
}

export interface AdaptiveWeights {
  technical: number;
  ml: number;
  market: number;
  confidence: number;
  reasoning: string[];
}

export interface EnhancedSignal {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  strength: number; // 0-100
  confidence: number; // 0-1
  expectedValue: number;
  riskReward: number;
  components: SignalComponents;
  weights: AdaptiveWeights;
  marketRegime: MarketRegime;
  qualityScore: number; // 0-100
  metadata: {
    timestamp: number;
    symbol: string;
    interval: string;
    processingTime: number;
  };
}

export class EnhancedSignalQuality extends EventEmitter {
  private readonly baseWeights: { technical: number; ml: number; market: number };
  private marketRegimeCache: Map<string, { regime: MarketRegime; timestamp: number }> = new Map();
  private signalHistory: EnhancedSignal[] = [];
  private readonly maxHistorySize = 100;

  constructor() {
    super();
    
    // 从配置读取基础权重
    this.baseWeights = {
      technical: config.strategy.multiFactorWeights.technical,
      ml: config.strategy.multiFactorWeights.ml,
      market: config.strategy.multiFactorWeights.market
    };
  }

  /**
   * 生成增强信号
   */
  async generateEnhancedSignal(
    symbol: string,
    interval: string = '1H',
    technicalSignal?: any,
    mlSignal?: any,
    marketData?: any
  ): Promise<EnhancedSignal> {
    const startTime = Date.now();
    
    try {
      // 分析市场状态
      const marketRegime = await this.analyzeMarketRegime(symbol, interval);
      
      // 计算信号组件
      const components = await this.calculateSignalComponents(
        symbol, interval, technicalSignal, mlSignal, marketData, marketRegime
      );
      
      // 计算自适应权重
      const adaptiveWeights = this.calculateAdaptiveWeights(components, marketRegime);
      
      // 计算综合信号
      const combinedSignal = this.combineSignals(components, adaptiveWeights);
      
      // 计算增强EV
      const enhancedEV = await this.calculateEnhancedEV(
        combinedSignal, components, marketRegime, symbol
      );
      
      // 计算质量评分
      const qualityScore = this.calculateQualityScore(components, adaptiveWeights, marketRegime);
      
      const enhancedSignal: EnhancedSignal = {
        direction: combinedSignal.direction,
        strength: combinedSignal.strength,
        confidence: combinedSignal.confidence,
        expectedValue: enhancedEV.ev,
        riskReward: enhancedEV.riskReward,
        components,
        weights: adaptiveWeights,
        marketRegime,
        qualityScore,
        metadata: {
          timestamp: Date.now(),
          symbol,
          interval,
          processingTime: Date.now() - startTime
        }
      };
      
      // 记录信号历史
      this.addToHistory(enhancedSignal);
      
      // 发出信号事件
      this.emit('signalGenerated', enhancedSignal);
      
      return enhancedSignal;
      
    } catch (error) {
      console.error('[EnhancedSignalQuality] 信号生成失败:', error);
      throw error;
    }
  }

  /**
   * 分析市场状态
   */
  private async analyzeMarketRegime(symbol: string, interval: string): Promise<MarketRegime> {
    const cacheKey = `${symbol}_${interval}`;
    const cached = this.marketRegimeCache.get(cacheKey);
    
    // 缓存5分钟
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached.regime;
    }
    
    try {
      // 获取市场数据
      const [ticker, klines, fundingRate] = await Promise.all([
        enhancedOKXDataService.getTicker(symbol),
        enhancedOKXDataService.getKlineData(symbol, interval, 100),
        enhancedOKXDataService.getFundingRate(symbol)
      ]);
      
      if (!ticker || !klines || klines.length < 50) {
        throw new Error('市场数据不足');
      }
      
      // 计算趋势
      const trendAnalysis = this.analyzeTrend(klines);
      
      // 计算波动性
      const volatility = this.calculateVolatility(klines);
      
      // 计算动量
      const momentum = this.calculateMomentum(klines);
      
      // 计算成交量
      const volumeAnalysis = this.analyzeVolume(klines);
      
      // 获取恐慌贪婪指数（模拟）
      const fearGreed = await this.getFearGreedIndex();
      
      // 确定市场类型
      const marketType = this.determineMarketType(
        trendAnalysis, volatility, momentum, volumeAnalysis
      );
      
      const regime: MarketRegime = {
        type: marketType.type,
        strength: marketType.strength,
        volatility,
        trend: trendAnalysis.direction,
        momentum,
        volume: volumeAnalysis,
        fearGreed,
        fundingRate: fundingRate || 0
      };
      
      // 更新缓存
      this.marketRegimeCache.set(cacheKey, {
        regime,
        timestamp: Date.now()
      });
      
      return regime;
      
    } catch (error) {
      console.warn('[EnhancedSignalQuality] 市场状态分析失败:', error);
      
      // 返回默认状态
      return {
        type: 'SIDEWAYS',
        strength: 0.5,
        volatility: 0.02,
        trend: 'NEUTRAL',
        momentum: 0,
        volume: 1.0,
        fearGreed: 50,
        fundingRate: 0
      };
    }
  }

  /**
   * 计算信号组件
   */
  private async calculateSignalComponents(
    symbol: string,
    interval: string,
    technicalSignal?: any,
    mlSignal?: any,
    marketData?: any,
    marketRegime?: MarketRegime
  ): Promise<SignalComponents> {
    
    // 技术分析组件
    const technical = this.calculateTechnicalComponent(technicalSignal, marketRegime);
    
    // 机器学习组件
    const ml = this.calculateMLComponent(mlSignal, marketRegime);
    
    // 市场组件
    const market = this.calculateMarketComponent(marketData, marketRegime);
    
    return { technical, ml, market };
  }

  /**
   * 计算技术分析组件
   */
  private calculateTechnicalComponent(technicalSignal?: any, marketRegime?: MarketRegime): SignalComponents['technical'] {
    if (!technicalSignal) {
      return {
        score: 50,
        confidence: 0.5,
        components: {
          trend: 50,
          momentum: 50,
          oscillators: 50,
          volume: 50,
          volatility: 50
        }
      };
    }
    
    // 提取技术指标组件
    const trend = this.normalizeTechnicalScore(technicalSignal.trend || 0);
    const momentum = this.normalizeTechnicalScore(technicalSignal.momentum || 0);
    const oscillators = this.normalizeTechnicalScore(technicalSignal.oscillators || 0);
    const volume = this.normalizeTechnicalScore(technicalSignal.volume || 0);
    const volatility = this.normalizeTechnicalScore(technicalSignal.volatility || 0);
    
    // 根据市场状态调整权重
    let trendWeight = 0.3;
    let momentumWeight = 0.25;
    let oscillatorWeight = 0.2;
    let volumeWeight = 0.15;
    let volatilityWeight = 0.1;
    
    if (marketRegime) {
      switch (marketRegime.type) {
        case 'BULL':
        case 'BEAR':
          // 趋势市场：增加趋势和动量权重
          trendWeight = 0.4;
          momentumWeight = 0.3;
          oscillatorWeight = 0.15;
          break;
        case 'SIDEWAYS':
          // 震荡市场：增加震荡指标权重
          oscillatorWeight = 0.35;
          trendWeight = 0.2;
          momentumWeight = 0.2;
          break;
        case 'VOLATILE':
          // 高波动市场：增加波动性权重
          volatilityWeight = 0.2;
          trendWeight = 0.25;
          momentumWeight = 0.25;
          break;
      }
    }
    
    // 计算加权得分
    const score = 
      trend * trendWeight +
      momentum * momentumWeight +
      oscillators * oscillatorWeight +
      volume * volumeWeight +
      volatility * volatilityWeight;
    
    // 计算置信度
    const confidence = this.calculateTechnicalConfidence(
      { trend, momentum, oscillators, volume, volatility },
      marketRegime
    );
    
    return {
      score,
      confidence,
      components: { trend, momentum, oscillators, volume, volatility }
    };
  }

  /**
   * 计算机器学习组件
   */
  private calculateMLComponent(mlSignal?: any, marketRegime?: MarketRegime): SignalComponents['ml'] {
    if (!mlSignal) {
      return {
        score: 50,
        confidence: 0.5,
        prediction: 0,
        accuracy: 0.5
      };
    }
    
    const prediction = mlSignal.prediction || 0;
    const accuracy = mlSignal.accuracy || 0.5;
    const confidence = mlSignal.confidence || 0.5;
    
    // 根据市场状态调整ML信号
    let adjustedPrediction = prediction;
    let adjustedConfidence = confidence;
    
    if (marketRegime) {
      // 在高波动市场中降低ML信号的置信度
      if (marketRegime.type === 'VOLATILE') {
        adjustedConfidence *= 0.8;
      }
      
      // 在趋势市场中增强ML信号
      if ((marketRegime.type === 'BULL' || marketRegime.type === 'BEAR') && marketRegime.strength > 0.7) {
        adjustedConfidence *= 1.1;
      }
    }
    
    const score = 50 + adjustedPrediction * 50; // 转换为0-100分
    
    return {
      score: Math.max(0, Math.min(100, score)),
      confidence: Math.max(0, Math.min(1, adjustedConfidence)),
      prediction: adjustedPrediction,
      accuracy
    };
  }

  /**
   * 计算市场组件
   */
  private calculateMarketComponent(marketData?: any, marketRegime?: MarketRegime): SignalComponents['market'] {
    if (!marketRegime) {
      return {
        score: 50,
        confidence: 0.5,
        sentiment: 50,
        microstructure: 50,
        regime: {
          type: 'SIDEWAYS',
          strength: 0.5,
          volatility: 0.02,
          trend: 'NEUTRAL',
          momentum: 0,
          volume: 1.0,
          fearGreed: 50,
          fundingRate: 0
        }
      };
    }
    
    // 情绪分析
    const sentiment = this.calculateSentimentScore(marketRegime);
    
    // 微观结构分析
    const microstructure = this.calculateMicrostructureScore(marketData, marketRegime);
    
    // 综合市场得分
    const score = (sentiment + microstructure) / 2;
    
    // 市场置信度
    const confidence = this.calculateMarketConfidence(marketRegime);
    
    return {
      score,
      confidence,
      sentiment,
      microstructure,
      regime: marketRegime
    };
  }

  /**
   * 计算自适应权重
   */
  private calculateAdaptiveWeights(
    components: SignalComponents,
    marketRegime: MarketRegime
  ): AdaptiveWeights {
    let technicalWeight = this.baseWeights.technical;
    let mlWeight = this.baseWeights.ml;
    let marketWeight = this.baseWeights.market;
    
    const reasoning: string[] = [];
    
    // 根据市场状态调整权重
    switch (marketRegime.type) {
      case 'BULL':
      case 'BEAR':
        // 趋势市场：增加技术分析权重
        technicalWeight *= 1.2;
        mlWeight *= 0.9;
        reasoning.push(`趋势市场(${marketRegime.type}): 增加技术分析权重`);
        break;
        
      case 'SIDEWAYS':
        // 震荡市场：增加ML权重
        mlWeight *= 1.3;
        technicalWeight *= 0.8;
        reasoning.push('震荡市场: 增加机器学习权重');
        break;
        
      case 'VOLATILE':
        // 高波动市场：增加市场权重
        marketWeight *= 1.4;
        technicalWeight *= 0.9;
        mlWeight *= 0.8;
        reasoning.push('高波动市场: 增加市场分析权重');
        break;
    }
    
    // 根据组件置信度调整权重
    if (components.technical.confidence > 0.8) {
      technicalWeight *= 1.1;
      reasoning.push('技术分析高置信度: 增加权重');
    } else if (components.technical.confidence < 0.5) {
      technicalWeight *= 0.8;
      reasoning.push('技术分析低置信度: 降低权重');
    }
    
    if (components.ml.confidence > 0.8) {
      mlWeight *= 1.1;
      reasoning.push('机器学习高置信度: 增加权重');
    } else if (components.ml.confidence < 0.5) {
      mlWeight *= 0.8;
      reasoning.push('机器学习低置信度: 降低权重');
    }
    
    if (components.market.confidence > 0.8) {
      marketWeight *= 1.1;
      reasoning.push('市场分析高置信度: 增加权重');
    } else if (components.market.confidence < 0.5) {
      marketWeight *= 0.8;
      reasoning.push('市场分析低置信度: 降低权重');
    }
    
    // 归一化权重
    const totalWeight = technicalWeight + mlWeight + marketWeight;
    technicalWeight /= totalWeight;
    mlWeight /= totalWeight;
    marketWeight /= totalWeight;
    
    // 计算综合置信度
    const confidence = 
      components.technical.confidence * technicalWeight +
      components.ml.confidence * mlWeight +
      components.market.confidence * marketWeight;
    
    return {
      technical: technicalWeight,
      ml: mlWeight,
      market: marketWeight,
      confidence,
      reasoning
    };
  }

  /**
   * 组合信号
   */
  private combineSignals(
    components: SignalComponents,
    weights: AdaptiveWeights
  ): { direction: 'LONG' | 'SHORT' | 'NEUTRAL'; strength: number; confidence: number } {
    
    // 计算加权得分
    const weightedScore = 
      components.technical.score * weights.technical +
      components.ml.score * weights.ml +
      components.market.score * weights.market;
    
    // 确定方向
    let direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    if (weightedScore > 55) {
      direction = 'LONG';
    } else if (weightedScore < 45) {
      direction = 'SHORT';
    } else {
      direction = 'NEUTRAL';
    }
    
    // 计算强度
    const strength = Math.abs(weightedScore - 50) * 2; // 转换为0-100
    
    return {
      direction,
      strength: Math.min(100, strength),
      confidence: weights.confidence
    };
  }

  /**
   * 计算增强EV
   */
  private async calculateEnhancedEV(
    signal: { direction: string; strength: number; confidence: number },
    components: SignalComponents,
    marketRegime: MarketRegime,
    symbol: string
  ): Promise<{ ev: number; riskReward: number }> {
    
    // 基础胜率估算
    let baseWinRate = 0.5;
    
    // 根据信号强度调整胜率
    if (signal.strength > 70) {
      baseWinRate = 0.65;
    } else if (signal.strength > 50) {
      baseWinRate = 0.58;
    } else if (signal.strength < 30) {
      baseWinRate = 0.42;
    }
    
    // 根据置信度调整胜率
    baseWinRate *= (0.8 + signal.confidence * 0.4);
    
    // 根据市场状态调整胜率
    switch (marketRegime.type) {
      case 'BULL':
        if (signal.direction === 'LONG') baseWinRate *= 1.1;
        break;
      case 'BEAR':
        if (signal.direction === 'SHORT') baseWinRate *= 1.1;
        break;
      case 'VOLATILE':
        baseWinRate *= 0.9; // 高波动降低胜率
        break;
    }
    
    // 基础风险回报比
    let baseRR = 1.4; // 默认1:1.4
    
    // 根据市场波动性调整风险回报比
    if (marketRegime.volatility > 0.03) {
      baseRR *= 1.2; // 高波动增加回报
    } else if (marketRegime.volatility < 0.01) {
      baseRR *= 0.9; // 低波动降低回报
    }
    
    // 根据趋势强度调整风险回报比
    if (marketRegime.strength > 0.7) {
      baseRR *= 1.1; // 强趋势增加回报
    }
    
    // 计算EV
    const winRate = Math.max(0.3, Math.min(0.8, baseWinRate));
    const lossRate = 1 - winRate;
    const avgWin = baseRR;
    const avgLoss = 1;
    
    const ev = (winRate * avgWin) - (lossRate * avgLoss);
    
    return {
      ev: Math.round(ev * 1000) / 1000, // 保留3位小数
      riskReward: Math.round(baseRR * 100) / 100 // 保留2位小数
    };
  }

  /**
   * 计算质量评分
   */
  private calculateQualityScore(
    components: SignalComponents,
    weights: AdaptiveWeights,
    marketRegime: MarketRegime
  ): number {
    // 组件质量得分
    const technicalQuality = components.technical.confidence * 100;
    const mlQuality = components.ml.confidence * 100;
    const marketQuality = components.market.confidence * 100;
    
    // 加权质量得分
    const weightedQuality = 
      technicalQuality * weights.technical +
      mlQuality * weights.ml +
      marketQuality * weights.market;
    
    // 市场状态加分
    let marketBonus = 0;
    if (marketRegime.strength > 0.7) {
      marketBonus = 10; // 强市场状态加分
    } else if (marketRegime.strength < 0.3) {
      marketBonus = -10; // 弱市场状态减分
    }
    
    // 权重平衡加分
    const weightBalance = 1 - Math.abs(weights.technical - 0.33) - Math.abs(weights.ml - 0.33) - Math.abs(weights.market - 0.33);
    const balanceBonus = weightBalance * 10;
    
    const finalScore = weightedQuality + marketBonus + balanceBonus;
    
    return Math.max(0, Math.min(100, finalScore));
  }

  // 辅助方法
  private normalizeTechnicalScore(score: number): number {
    return Math.max(0, Math.min(100, score));
  }

  private calculateTechnicalConfidence(components: any, marketRegime?: MarketRegime): number {
    const scores = Object.values(components) as number[];
    const variance = this.calculateVariance(scores);
    const baseConfidence = 1 - (variance / 2500); // 方差越小置信度越高
    
    // 根据市场状态调整
    if (marketRegime?.type === 'VOLATILE') {
      return Math.max(0.3, baseConfidence * 0.8);
    }
    
    return Math.max(0.3, Math.min(1, baseConfidence));
  }

  private calculateSentimentScore(marketRegime: MarketRegime): number {
    // 基于恐慌贪婪指数的情绪得分
    const fgiScore = marketRegime.fearGreed;
    
    // 基于资金费率的情绪得分
    const fundingScore = 50 - (marketRegime.fundingRate * 10000); // 转换为得分
    
    return (fgiScore + fundingScore) / 2;
  }

  private calculateMicrostructureScore(marketData?: any, marketRegime?: MarketRegime): number {
    if (!marketRegime) return 50;
    
    // 基于成交量的微观结构得分
    const volumeScore = Math.min(100, marketRegime.volume * 50);
    
    // 基于波动性的微观结构得分
    const volatilityScore = 50 + (marketRegime.volatility - 0.02) * 1000;
    
    return Math.max(0, Math.min(100, (volumeScore + volatilityScore) / 2));
  }

  private calculateMarketConfidence(marketRegime: MarketRegime): number {
    // 基于市场状态强度的置信度
    let confidence = marketRegime.strength;
    
    // 根据市场类型调整
    switch (marketRegime.type) {
      case 'BULL':
      case 'BEAR':
        confidence *= 1.1; // 趋势市场置信度更高
        break;
      case 'VOLATILE':
        confidence *= 0.8; // 高波动市场置信度降低
        break;
    }
    
    return Math.max(0.3, Math.min(1, confidence));
  }

  private analyzeTrend(klines: any[]): { direction: 'UP' | 'DOWN' | 'NEUTRAL'; strength: number } {
    if (klines.length < 20) {
      return { direction: 'NEUTRAL', strength: 0.5 };
    }
    
    const prices = klines.map(k => parseFloat(k.close));
    const firstHalf = prices.slice(0, Math.floor(prices.length / 2));
    const secondHalf = prices.slice(Math.floor(prices.length / 2));
    
    const firstAvg = firstHalf.reduce((a, b) => a + b) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b) / secondHalf.length;
    
    const change = (secondAvg - firstAvg) / firstAvg;
    const absChange = Math.abs(change);
    
    let direction: 'UP' | 'DOWN' | 'NEUTRAL';
    if (absChange < 0.01) {
      direction = 'NEUTRAL';
    } else if (change > 0) {
      direction = 'UP';
    } else {
      direction = 'DOWN';
    }
    
    const strength = Math.min(1.0, absChange * 50);
    
    return { direction, strength };
  }

  private calculateVolatility(klines: any[]): number {
    if (klines.length < 2) return 0.02;
    
    const returns = [];
    for (let i = 1; i < klines.length; i++) {
      const prevClose = parseFloat(klines[i - 1].close);
      const currentClose = parseFloat(klines[i].close);
      returns.push((currentClose - prevClose) / prevClose);
    }
    
    const mean = returns.reduce((a, b) => a + b) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  private calculateMomentum(klines: any[]): number {
    if (klines.length < 10) return 0;
    
    const prices = klines.map(k => parseFloat(k.close));
    const current = prices[prices.length - 1];
    const previous = prices[prices.length - 10];
    
    return (current - previous) / previous;
  }

  private analyzeVolume(klines: any[]): number {
    if (klines.length < 10) return 1.0;
    
    const volumes = klines.map(k => parseFloat(k.volume));
    const recentVolume = volumes.slice(-5).reduce((a, b) => a + b) / 5;
    const avgVolume = volumes.reduce((a, b) => a + b) / volumes.length;
    
    return recentVolume / avgVolume;
  }

  private determineMarketType(
    trend: any,
    volatility: number,
    momentum: number,
    volume: number
  ): { type: MarketRegime['type']; strength: number } {
    
    if (volatility > 0.04) {
      return { type: 'VOLATILE', strength: Math.min(1, volatility * 25) };
    }
    
    if (trend.strength > 0.6) {
      if (trend.direction === 'UP') {
        return { type: 'BULL', strength: trend.strength };
      } else if (trend.direction === 'DOWN') {
        return { type: 'BEAR', strength: trend.strength };
      }
    }
    
    return { type: 'SIDEWAYS', strength: 1 - trend.strength };
  }

  private async getFearGreedIndex(): Promise<number> {
    // 模拟恐慌贪婪指数，实际应该从API获取
    return 50 + Math.random() * 40 - 20; // 30-70之间的随机值
  }

  private calculateVariance(numbers: number[]): number {
    const mean = numbers.reduce((a, b) => a + b) / numbers.length;
    return numbers.reduce((sum, num) => sum + Math.pow(num - mean, 2), 0) / numbers.length;
  }

  private addToHistory(signal: EnhancedSignal): void {
    this.signalHistory.push(signal);
    if (this.signalHistory.length > this.maxHistorySize) {
      this.signalHistory.shift();
    }
  }

  /**
   * 获取信号历史
   */
  getSignalHistory(limit?: number): EnhancedSignal[] {
    if (limit) {
      return this.signalHistory.slice(-limit);
    }
    return [...this.signalHistory];
  }

  /**
   * 获取信号统计
   */
  getSignalStatistics(): {
    totalSignals: number;
    averageQuality: number;
    averageConfidence: number;
    directionDistribution: { LONG: number; SHORT: number; NEUTRAL: number };
    averageProcessingTime: number;
  } {
    if (this.signalHistory.length === 0) {
      return {
        totalSignals: 0,
        averageQuality: 0,
        averageConfidence: 0,
        directionDistribution: { LONG: 0, SHORT: 0, NEUTRAL: 0 },
        averageProcessingTime: 0
      };
    }
    
    const totalSignals = this.signalHistory.length;
    const averageQuality = this.signalHistory.reduce((sum, s) => sum + s.qualityScore, 0) / totalSignals;
    const averageConfidence = this.signalHistory.reduce((sum, s) => sum + s.confidence, 0) / totalSignals;
    const averageProcessingTime = this.signalHistory.reduce((sum, s) => sum + s.metadata.processingTime, 0) / totalSignals;
    
    const directionDistribution = this.signalHistory.reduce((dist, s) => {
      dist[s.direction]++;
      return dist;
    }, { LONG: 0, SHORT: 0, NEUTRAL: 0 });
    
    return {
      totalSignals,
      averageQuality: Math.round(averageQuality * 100) / 100,
      averageConfidence: Math.round(averageConfidence * 1000) / 1000,
      directionDistribution,
      averageProcessingTime: Math.round(averageProcessingTime * 100) / 100
    };
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.marketRegimeCache.clear();
    this.signalHistory.length = 0;
  }
}

export const enhancedSignalQuality = new EnhancedSignalQuality();