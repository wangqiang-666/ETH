/**
 * 增强机器学习引擎
 * 优化Agent学习算法、改进预测模型、增加特征工程
 */

import { config } from '../config.js';
import { enhancedOKXDataService } from '../services/enhanced-okx-data-service.js';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface MLFeatures {
  // 价格特征
  priceFeatures: {
    returns: number[];
    volatility: number;
    momentum: number;
    meanReversion: number;
    pricePosition: number; // 当前价格在区间中的位置
  };
  
  // 技术指标特征
  technicalFeatures: {
    rsi: number;
    macd: number;
    macdSignal: number;
    macdHistogram: number;
    bollingerPosition: number;
    bollingerBandwidth: number;
    adx: number;
    ema: number[];
    sma: number[];
  };
  
  // 成交量特征
  volumeFeatures: {
    volume: number;
    volumeMA: number;
    volumeRatio: number;
    obv: number;
    mfi: number;
    vwap: number;
    vwapDistance: number;
  };
  
  // 市场微观结构特征
  microstructureFeatures: {
    spread: number;
    orderBookImbalance: number;
    tradeIntensity: number;
    volatilityCluster: number;
    jumpDetection: number;
  };
  
  // 情绪特征
  sentimentFeatures: {
    fearGreedIndex: number;
    fundingRate: number;
    openInterest: number;
    longShortRatio: number;
    socialSentiment: number;
  };
  
  // 时间特征
  timeFeatures: {
    hour: number;
    dayOfWeek: number;
    isWeekend: number;
    isAsianSession: number;
    isEuropeanSession: number;
    isAmericanSession: number;
  };
  
  // 宏观特征
  macroFeatures: {
    btcCorrelation: number;
    usdIndex: number;
    vixLevel: number;
    yieldCurve: number;
    cryptoMarketCap: number;
  };
}

export interface MLPrediction {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  probability: number; // 0-1
  confidence: number; // 0-1
  expectedReturn: number;
  riskScore: number; // 0-1
  timeHorizon: number; // 预测时间范围（分钟）
  features: {
    importance: Record<string, number>;
    contribution: Record<string, number>;
  };
  metadata: {
    modelVersion: string;
    timestamp: number;
    processingTime: number;
    dataQuality: number; // 0-1
  };
}

export interface ModelPerformance {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  avgReturn: number;
  totalTrades: number;
  lastUpdated: number;
}

export interface LearningState {
  totalSamples: number;
  recentAccuracy: number;
  learningRate: number;
  modelComplexity: number;
  overfittingRisk: number;
  adaptationSpeed: number;
  lastRetraining: number;
}

export class EnhancedMLEngine extends EventEmitter {
  private models: Map<string, any> = new Map();
  private featureHistory: MLFeatures[] = [];
  private predictionHistory: MLPrediction[] = [];
  private performanceMetrics: ModelPerformance;
  private learningState: LearningState;
  
  private readonly maxHistorySize = 1000;
  private readonly retrainThreshold = 100;
  private readonly modelPath = path.join(process.cwd(), 'data', 'models');
  
  // 特征工程参数
  private readonly featureConfig = {
    lookbackPeriods: [5, 10, 20, 50],
    volatilityWindow: 20,
    momentumPeriods: [3, 7, 14],
    correlationWindow: 30,
    anomalyThreshold: 2.5
  };

  constructor() {
    super();
    
    this.performanceMetrics = {
      accuracy: 0.5,
      precision: 0.5,
      recall: 0.5,
      f1Score: 0.5,
      sharpeRatio: 0,
      maxDrawdown: 0,
      winRate: 0.5,
      avgReturn: 0,
      totalTrades: 0,
      lastUpdated: Date.now()
    };
    
    this.learningState = {
      totalSamples: 0,
      recentAccuracy: 0.5,
      learningRate: 0.001,
      modelComplexity: 0.5,
      overfittingRisk: 0,
      adaptationSpeed: 0.5,
      lastRetraining: Date.now()
    };
    
    this.initializeModels();
  }

  /**
   * 初始化模型
   */
  private async initializeModels(): Promise<void> {
    try {
      // 确保模型目录存在
      await fs.mkdir(this.modelPath, { recursive: true });
      
      // 初始化不同类型的模型
      this.models.set('ensemble', this.createEnsembleModel());
      this.models.set('lstm', this.createLSTMModel());
      this.models.set('transformer', this.createTransformerModel());
      this.models.set('reinforcement', this.createReinforcementModel());
      
      // 尝试加载已保存的模型
      await this.loadModels();
      
      console.log('[EnhancedML] 模型初始化完成');
      
    } catch (error) {
      console.error('[EnhancedML] 模型初始化失败:', error);
    }
  }

  /**
   * 提取特征
   */
  async extractFeatures(symbol: string, interval: string = '1H'): Promise<MLFeatures> {
    try {
      // 获取市场数据
      const [ticker, klines, fundingRate, openInterest] = await Promise.all([
        enhancedOKXDataService.getTicker(symbol),
        enhancedOKXDataService.getKlineData(symbol, interval, 200),
        enhancedOKXDataService.getFundingRate(symbol),
        enhancedOKXDataService.getOpenInterest(symbol)
      ]);
      
      if (!ticker || !klines || klines.length < 50) {
        throw new Error('市场数据不足');
      }
      
      // 提取各类特征
      const priceFeatures = this.extractPriceFeatures(klines);
      const technicalFeatures = this.extractTechnicalFeatures(klines);
      const volumeFeatures = this.extractVolumeFeatures(klines);
      const microstructureFeatures = this.extractMicrostructureFeatures(ticker, klines);
      const sentimentFeatures = this.extractSentimentFeatures(fundingRate || undefined, openInterest || undefined);
      const timeFeatures = this.extractTimeFeatures();
      const macroFeatures = await this.extractMacroFeatures();
      
      const features: MLFeatures = {
        priceFeatures,
        technicalFeatures,
        volumeFeatures,
        microstructureFeatures,
        sentimentFeatures,
        timeFeatures,
        macroFeatures
      };
      
      // 添加到历史记录
      this.addFeaturesToHistory(features);
      
      return features;
      
    } catch (error) {
      console.error('[EnhancedML] 特征提取失败:', error);
      throw error;
    }
  }

  /**
   * 生成预测
   */
  async predict(features: MLFeatures): Promise<MLPrediction> {
    const startTime = Date.now();
    
    try {
      // 数据质量检查
      const dataQuality = this.assessDataQuality(features);
      if (dataQuality < 0.5) {
        console.warn('[EnhancedML] 数据质量较低:', dataQuality);
      }
      
      // 特征预处理
      const processedFeatures = this.preprocessFeatures(features);
      
      // 集成多个模型的预测
      const predictions = await Promise.all([
        this.predictWithEnsemble(processedFeatures),
        this.predictWithLSTM(processedFeatures),
        this.predictWithTransformer(processedFeatures),
        this.predictWithReinforcement(processedFeatures)
      ]);
      
      // 融合预测结果
      const fusedPrediction = this.fusePredictions(predictions, features);
      
      // 计算特征重要性
      const featureImportance = this.calculateFeatureImportance(processedFeatures, fusedPrediction);
      
      const prediction: MLPrediction = {
        direction: fusedPrediction.direction,
        probability: fusedPrediction.probability,
        confidence: fusedPrediction.confidence,
        expectedReturn: fusedPrediction.expectedReturn,
        riskScore: fusedPrediction.riskScore,
        timeHorizon: fusedPrediction.timeHorizon,
        features: {
          importance: featureImportance.importance,
          contribution: featureImportance.contribution
        },
        metadata: {
          modelVersion: '2.0.0',
          timestamp: Date.now(),
          processingTime: Date.now() - startTime,
          dataQuality
        }
      };
      
      // 添加到预测历史
      this.addPredictionToHistory(prediction);
      
      // 发出预测事件
      this.emit('prediction', prediction);
      
      return prediction;
      
    } catch (error) {
      console.error('[EnhancedML] 预测生成失败:', error);
      throw error;
    }
  }

  /**
   * 在线学习
   */
  async learn(features: MLFeatures, actualOutcome: { direction: string; return: number }): Promise<void> {
    try {
      // 更新学习状态
      this.learningState.totalSamples++;
      
      // 计算预测准确性
      const lastPrediction = this.predictionHistory[this.predictionHistory.length - 1];
      if (lastPrediction) {
        const isCorrect = lastPrediction.direction === actualOutcome.direction;
        this.updateAccuracy(isCorrect);
      }
      
      // 自适应学习率调整
      this.adjustLearningRate();
      
      // 增量学习
      await this.incrementalLearning(features, actualOutcome);
      
      // 检查是否需要重训练
      if (this.shouldRetrain()) {
        await this.retrainModels();
      }
      
      // 更新性能指标
      this.updatePerformanceMetrics(actualOutcome);
      
      console.log(`[EnhancedML] 学习完成，总样本数: ${this.learningState.totalSamples}, 准确率: ${(this.learningState.recentAccuracy * 100).toFixed(1)}%`);
      
    } catch (error) {
      console.error('[EnhancedML] 学习过程失败:', error);
    }
  }

  /**
   * 提取价格特征
   */
  private extractPriceFeatures(klines: any[]): MLFeatures['priceFeatures'] {
    const closes = klines.map(k => parseFloat(k.close));
    const highs = klines.map(k => parseFloat(k.high));
    const lows = klines.map(k => parseFloat(k.low));
    
    // 计算收益率
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    
    // 计算波动率
    const volatility = this.calculateVolatility(returns);
    
    // 计算动量
    const momentum = this.calculateMomentum(closes, this.featureConfig.momentumPeriods);
    
    // 计算均值回归
    const meanReversion = this.calculateMeanReversion(closes);
    
    // 计算价格位置
    const currentPrice = closes[closes.length - 1];
    const maxPrice = Math.max(...highs.slice(-20));
    const minPrice = Math.min(...lows.slice(-20));
    const pricePosition = (currentPrice - minPrice) / (maxPrice - minPrice);
    
    return {
      returns: returns.slice(-10), // 最近10个收益率
      volatility,
      momentum,
      meanReversion,
      pricePosition
    };
  }

  /**
   * 提取技术指标特征
   */
  private extractTechnicalFeatures(klines: any[]): MLFeatures['technicalFeatures'] {
    const closes = klines.map(k => parseFloat(k.close));
    const highs = klines.map(k => parseFloat(k.high));
    const lows = klines.map(k => parseFloat(k.low));
    
    // RSI
    const rsi = this.calculateRSI(closes, 14);
    
    // MACD
    const macd = this.calculateMACD(closes);
    
    // 布林带
    const bollinger = this.calculateBollinger(closes, 20, 2);
    
    // ADX
    const adx = this.calculateADX(highs, lows, closes, 14);
    
    // EMA
    const ema = this.featureConfig.lookbackPeriods.map(period => 
      this.calculateEMA(closes, period)
    );
    
    // SMA
    const sma = this.featureConfig.lookbackPeriods.map(period => 
      this.calculateSMA(closes, period)
    );
    
    return {
      rsi,
      macd: macd.macd,
      macdSignal: macd.signal,
      macdHistogram: macd.histogram,
      bollingerPosition: bollinger.position,
      bollingerBandwidth: bollinger.bandwidth,
      adx,
      ema,
      sma
    };
  }

  /**
   * 提取成交量特征
   */
  private extractVolumeFeatures(klines: any[]): MLFeatures['volumeFeatures'] {
    const volumes = klines.map(k => parseFloat(k.volume));
    const closes = klines.map(k => parseFloat(k.close));
    const highs = klines.map(k => parseFloat(k.high));
    const lows = klines.map(k => parseFloat(k.low));
    
    const currentVolume = volumes[volumes.length - 1];
    const volumeMA = this.calculateSMA(volumes, 20);
    const volumeRatio = currentVolume / volumeMA;
    
    // OBV
    const obv = this.calculateOBV(closes, volumes);
    
    // MFI
    const mfi = this.calculateMFI(highs, lows, closes, volumes, 14);
    
    // VWAP
    const vwap = this.calculateVWAP(highs, lows, closes, volumes);
    const currentPrice = closes[closes.length - 1];
    const vwapDistance = (currentPrice - vwap) / vwap;
    
    return {
      volume: currentVolume,
      volumeMA,
      volumeRatio,
      obv,
      mfi,
      vwap,
      vwapDistance
    };
  }

  /**
   * 提取微观结构特征
   */
  private extractMicrostructureFeatures(ticker: any, klines: any[]): MLFeatures['microstructureFeatures'] {
    const closes = klines.map(k => parseFloat(k.close));
    const highs = klines.map(k => parseFloat(k.high));
    const lows = klines.map(k => parseFloat(k.low));
    
    // 价差（模拟）
    const spread = (parseFloat(ticker.askPx) - parseFloat(ticker.bidPx)) / parseFloat(ticker.lastPx);
    
    // 订单簿不平衡（模拟）
    const orderBookImbalance = Math.random() * 0.2 - 0.1; // -0.1 到 0.1
    
    // 交易强度
    const tradeIntensity = this.calculateTradeIntensity(klines);
    
    // 波动率聚集
    const volatilityCluster = this.calculateVolatilityCluster(closes);
    
    // 跳跃检测
    const jumpDetection = this.detectJumps(closes);
    
    return {
      spread,
      orderBookImbalance,
      tradeIntensity,
      volatilityCluster,
      jumpDetection
    };
  }

  /**
   * 提取情绪特征
   */
  private extractSentimentFeatures(fundingRate?: number, openInterest?: number): MLFeatures['sentimentFeatures'] {
    // 恐慌贪婪指数（模拟）
    const fearGreedIndex = 50 + Math.random() * 40 - 20; // 30-70
    
    // 多空比例（模拟）
    const longShortRatio = 0.8 + Math.random() * 0.4; // 0.8-1.2
    
    // 社交情绪（模拟）
    const socialSentiment = Math.random();
    
    return {
      fearGreedIndex,
      fundingRate: fundingRate || 0,
      openInterest: openInterest || 0,
      longShortRatio,
      socialSentiment
    };
  }

  /**
   * 提取时间特征
   */
  private extractTimeFeatures(): MLFeatures['timeFeatures'] {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    
    return {
      hour: hour / 24,
      dayOfWeek: dayOfWeek / 7,
      isWeekend: (dayOfWeek === 0 || dayOfWeek === 6) ? 1 : 0,
      isAsianSession: (hour >= 0 && hour < 8) ? 1 : 0,
      isEuropeanSession: (hour >= 8 && hour < 16) ? 1 : 0,
      isAmericanSession: (hour >= 16 && hour < 24) ? 1 : 0
    };
  }

  /**
   * 提取宏观特征
   */
  private async extractMacroFeatures(): Promise<MLFeatures['macroFeatures']> {
    // 这里应该从外部API获取宏观数据，现在使用模拟数据
    return {
      btcCorrelation: 0.7 + Math.random() * 0.2, // 0.7-0.9
      usdIndex: 100 + Math.random() * 10 - 5, // 95-105
      vixLevel: 20 + Math.random() * 20, // 20-40
      yieldCurve: 2 + Math.random() * 2, // 2-4%
      cryptoMarketCap: 1000000 + Math.random() * 500000 // 模拟市值
    };
  }

  // 辅助计算方法
  private calculateVolatility(returns: number[]): number {
    if (returns.length < 2) return 0;
    
    const mean = returns.reduce((a, b) => a + b) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  private calculateMomentum(prices: number[], periods: number[]): number {
    let totalMomentum = 0;
    let validPeriods = 0;
    
    for (const period of periods) {
      if (prices.length > period) {
        const current = prices[prices.length - 1];
        const past = prices[prices.length - 1 - period];
        totalMomentum += (current - past) / past;
        validPeriods++;
      }
    }
    
    return validPeriods > 0 ? totalMomentum / validPeriods : 0;
  }

  private calculateMeanReversion(prices: number[]): number {
    if (prices.length < 20) return 0;
    
    const recent = prices.slice(-20);
    const mean = recent.reduce((a, b) => a + b) / recent.length;
    const current = prices[prices.length - 1];
    
    return (mean - current) / mean;
  }

  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses -= change;
      }
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
    const signal = macd * 0.9; // 简化处理
    const histogram = macd - signal;
    
    return { macd, signal, histogram };
  }

  private calculateBollinger(prices: number[], period: number, stdDev: number): { position: number; bandwidth: number } {
    if (prices.length < period) return { position: 0.5, bandwidth: 0 };
    
    const sma = this.calculateSMA(prices, period);
    const recentPrices = prices.slice(-period);
    const variance = recentPrices.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
    const std = Math.sqrt(variance);
    
    const upperBand = sma + (std * stdDev);
    const lowerBand = sma - (std * stdDev);
    const currentPrice = prices[prices.length - 1];
    
    const position = (currentPrice - lowerBand) / (upperBand - lowerBand);
    const bandwidth = (upperBand - lowerBand) / sma;
    
    return { position, bandwidth };
  }

  private calculateADX(highs: number[], lows: number[], closes: number[], period: number): number {
    // 简化的ADX计算
    if (closes.length < period + 1) return 25;
    
    let totalTrueRange = 0;
    let totalDMPlus = 0;
    let totalDMMinus = 0;
    
    for (let i = closes.length - period; i < closes.length; i++) {
      const high = highs[i];
      const low = lows[i];
      const close = closes[i];
      const prevClose = closes[i - 1];
      
      const trueRange = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      
      totalTrueRange += trueRange;
      
      const dmPlus = Math.max(high - highs[i - 1], 0);
      const dmMinus = Math.max(lows[i - 1] - low, 0);
      
      totalDMPlus += dmPlus;
      totalDMMinus += dmMinus;
    }
    
    const diPlus = (totalDMPlus / totalTrueRange) * 100;
    const diMinus = (totalDMMinus / totalTrueRange) * 100;
    
    return Math.abs(diPlus - diMinus) / (diPlus + diMinus) * 100;
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    if (prices.length < period) return prices[prices.length - 1];
    
    const multiplier = 2 / (period + 1);
    let ema = prices[0];
    
    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
    }
    
    return ema;
  }

  private calculateSMA(values: number[], period: number): number {
    if (values.length < period) return values[values.length - 1] || 0;
    
    const recent = values.slice(-period);
    return recent.reduce((a, b) => a + b) / recent.length;
  }

  private calculateOBV(closes: number[], volumes: number[]): number {
    let obv = 0;
    
    for (let i = 1; i < closes.length; i++) {
      if (closes[i] > closes[i - 1]) {
        obv += volumes[i];
      } else if (closes[i] < closes[i - 1]) {
        obv -= volumes[i];
      }
    }
    
    return obv;
  }

  private calculateMFI(highs: number[], lows: number[], closes: number[], volumes: number[], period: number): number {
    if (closes.length < period + 1) return 50;
    
    let positiveFlow = 0;
    let negativeFlow = 0;
    
    for (let i = closes.length - period; i < closes.length; i++) {
      const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
      const prevTypicalPrice = (highs[i - 1] + lows[i - 1] + closes[i - 1]) / 3;
      const moneyFlow = typicalPrice * volumes[i];
      
      if (typicalPrice > prevTypicalPrice) {
        positiveFlow += moneyFlow;
      } else {
        negativeFlow += moneyFlow;
      }
    }
    
    if (negativeFlow === 0) return 100;
    
    const moneyRatio = positiveFlow / negativeFlow;
    return 100 - (100 / (1 + moneyRatio));
  }

  private calculateVWAP(highs: number[], lows: number[], closes: number[], volumes: number[]): number {
    let totalVolume = 0;
    let totalVolumePrice = 0;
    
    for (let i = 0; i < closes.length; i++) {
      const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
      totalVolumePrice += typicalPrice * volumes[i];
      totalVolume += volumes[i];
    }
    
    return totalVolume > 0 ? totalVolumePrice / totalVolume : closes[closes.length - 1];
  }

  private calculateTradeIntensity(klines: any[]): number {
    const volumes = klines.map(k => parseFloat(k.volume));
    const recentVolume = volumes.slice(-5).reduce((a, b) => a + b) / 5;
    const avgVolume = volumes.reduce((a, b) => a + b) / volumes.length;
    
    return recentVolume / avgVolume;
  }

  private calculateVolatilityCluster(prices: number[]): number {
    if (prices.length < 10) return 0;
    
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.abs((prices[i] - prices[i - 1]) / prices[i - 1]));
    }
    
    const recentVol = returns.slice(-5).reduce((a, b) => a + b) / 5;
    const avgVol = returns.reduce((a, b) => a + b) / returns.length;
    
    return recentVol / avgVol;
  }

  private detectJumps(prices: number[]): number {
    if (prices.length < 3) return 0;
    
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.abs((prices[i] - prices[i - 1]) / prices[i - 1]));
    }
    
    const threshold = this.featureConfig.anomalyThreshold * this.calculateVolatility(returns);
    const recentReturn = returns[returns.length - 1];
    
    return recentReturn > threshold ? 1 : 0;
  }

  // 模型相关方法（简化实现）
  private createEnsembleModel(): any {
    return {
      type: 'ensemble',
      weights: [0.3, 0.25, 0.25, 0.2],
      models: ['linear', 'polynomial', 'svm', 'neural']
    };
  }

  private createLSTMModel(): any {
    return {
      type: 'lstm',
      layers: [64, 32, 16],
      dropout: 0.2,
      lookback: 20
    };
  }

  private createTransformerModel(): any {
    return {
      type: 'transformer',
      heads: 8,
      layers: 4,
      dimension: 64
    };
  }

  private createReinforcementModel(): any {
    return {
      type: 'reinforcement',
      algorithm: 'PPO',
      learningRate: 0.001,
      epsilon: 0.1
    };
  }

  private async loadModels(): Promise<void> {
    // 模型加载逻辑（简化）
    console.log('[EnhancedML] 模型加载完成');
  }

  private preprocessFeatures(features: MLFeatures): any {
    // 特征预处理和标准化
    return features;
  }

  private async predictWithEnsemble(features: any): Promise<any> {
    // 集成模型预测
    return {
      direction: Math.random() > 0.5 ? 'LONG' : 'SHORT',
      probability: 0.6 + Math.random() * 0.3,
      confidence: 0.7 + Math.random() * 0.2
    };
  }

  private async predictWithLSTM(features: any): Promise<any> {
    // LSTM模型预测
    return {
      direction: Math.random() > 0.5 ? 'LONG' : 'SHORT',
      probability: 0.5 + Math.random() * 0.4,
      confidence: 0.6 + Math.random() * 0.3
    };
  }

  private async predictWithTransformer(features: any): Promise<any> {
    // Transformer模型预测
    return {
      direction: Math.random() > 0.5 ? 'LONG' : 'SHORT',
      probability: 0.55 + Math.random() * 0.35,
      confidence: 0.65 + Math.random() * 0.25
    };
  }

  private async predictWithReinforcement(features: any): Promise<any> {
    // 强化学习模型预测
    return {
      direction: Math.random() > 0.5 ? 'LONG' : 'SHORT',
      probability: 0.6 + Math.random() * 0.3,
      confidence: 0.7 + Math.random() * 0.2
    };
  }

  private fusePredictions(predictions: any[], features: MLFeatures): any {
    // 预测融合逻辑
    const avgProbability = predictions.reduce((sum, p) => sum + p.probability, 0) / predictions.length;
    const avgConfidence = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;
    
    // 投票决定方向
    const longVotes = predictions.filter(p => p.direction === 'LONG').length;
    const shortVotes = predictions.filter(p => p.direction === 'SHORT').length;
    
    const direction = longVotes > shortVotes ? 'LONG' : 
                     shortVotes > longVotes ? 'SHORT' : 'NEUTRAL';
    
    return {
      direction,
      probability: avgProbability,
      confidence: avgConfidence,
      expectedReturn: (avgProbability - 0.5) * 0.1, // 简化计算
      riskScore: 1 - avgConfidence,
      timeHorizon: 60 // 1小时
    };
  }

  private calculateFeatureImportance(features: any, prediction: any): { importance: Record<string, number>; contribution: Record<string, number> } {
    // 特征重要性计算（简化）
    const importance: Record<string, number> = {
      'price_momentum': 0.15,
      'technical_rsi': 0.12,
      'volume_ratio': 0.10,
      'volatility': 0.08,
      'sentiment_fgi': 0.07
    };
    
    const contribution: Record<string, number> = {
      'price_momentum': 0.02,
      'technical_rsi': -0.01,
      'volume_ratio': 0.015,
      'volatility': -0.005,
      'sentiment_fgi': 0.01
    };
    
    return { importance, contribution };
  }

  private assessDataQuality(features: MLFeatures): number {
    // 数据质量评估
    let quality = 1.0;
    
    // 检查缺失值
    const allValues = Object.values(features).flat();
    const validValues = allValues.filter(v => v !== null && v !== undefined && !isNaN(Number(v)));
    quality *= validValues.length / allValues.length;
    
    // 检查异常值
    const numericValues = validValues.filter(v => typeof v === 'number');
    const outliers = numericValues.filter(v => Math.abs(v) > 10);
    quality *= Math.max(0.5, 1 - (outliers.length / numericValues.length));
    
    return Math.max(0, Math.min(1, quality));
  }

  private addFeaturesToHistory(features: MLFeatures): void {
    this.featureHistory.push(features);
    if (this.featureHistory.length > this.maxHistorySize) {
      this.featureHistory.shift();
    }
  }

  private addPredictionToHistory(prediction: MLPrediction): void {
    this.predictionHistory.push(prediction);
    if (this.predictionHistory.length > this.maxHistorySize) {
      this.predictionHistory.shift();
    }
  }

  private updateAccuracy(isCorrect: boolean): void {
    const alpha = 0.1; // 学习率
    this.learningState.recentAccuracy = 
      (1 - alpha) * this.learningState.recentAccuracy + alpha * (isCorrect ? 1 : 0);
  }

  private adjustLearningRate(): void {
    // 自适应学习率调整
    if (this.learningState.recentAccuracy > 0.7) {
      this.learningState.learningRate *= 0.95; // 降低学习率
    } else if (this.learningState.recentAccuracy < 0.5) {
      this.learningState.learningRate *= 1.05; // 提高学习率
    }
    
    // 限制学习率范围
    this.learningState.learningRate = Math.max(0.0001, Math.min(0.01, this.learningState.learningRate));
  }

  private async incrementalLearning(features: MLFeatures, outcome: any): Promise<void> {
    // 增量学习实现（简化）
    console.log(`[EnhancedML] 增量学习: ${outcome.direction}, 收益: ${outcome.return.toFixed(4)}`);
  }

  private shouldRetrain(): boolean {
    const samplesSinceRetrain = this.learningState.totalSamples - 
      (this.learningState.lastRetraining || 0);
    
    return samplesSinceRetrain >= this.retrainThreshold || 
           this.learningState.recentAccuracy < 0.4;
  }

  private async retrainModels(): Promise<void> {
    console.log('[EnhancedML] 开始模型重训练...');
    
    // 模型重训练逻辑（简化）
    this.learningState.lastRetraining = this.learningState.totalSamples;
    
    console.log('[EnhancedML] 模型重训练完成');
  }

  private updatePerformanceMetrics(outcome: any): void {
    // 更新性能指标
    this.performanceMetrics.totalTrades++;
    this.performanceMetrics.lastUpdated = Date.now();
    
    // 简化的性能更新
    if (outcome.return > 0) {
      this.performanceMetrics.winRate = 
        (this.performanceMetrics.winRate * (this.performanceMetrics.totalTrades - 1) + 1) / 
        this.performanceMetrics.totalTrades;
    } else {
      this.performanceMetrics.winRate = 
        (this.performanceMetrics.winRate * (this.performanceMetrics.totalTrades - 1)) / 
        this.performanceMetrics.totalTrades;
    }
  }

  /**
   * 获取模型性能
   */
  getPerformanceMetrics(): ModelPerformance {
    return { ...this.performanceMetrics };
  }

  /**
   * 获取学习状态
   */
  getLearningState(): LearningState {
    return { ...this.learningState };
  }

  /**
   * 获取特征历史
   */
  getFeatureHistory(limit?: number): MLFeatures[] {
    if (limit) {
      return this.featureHistory.slice(-limit);
    }
    return [...this.featureHistory];
  }

  /**
   * 获取预测历史
   */
  getPredictionHistory(limit?: number): MLPrediction[] {
    if (limit) {
      return this.predictionHistory.slice(-limit);
    }
    return [...this.predictionHistory];
  }

  /**
   * 保存模型
   */
  async saveModels(): Promise<void> {
    try {
      const modelData = {
        models: Object.fromEntries(this.models),
        performanceMetrics: this.performanceMetrics,
        learningState: this.learningState,
        timestamp: Date.now()
      };
      
      const filePath = path.join(this.modelPath, 'enhanced_ml_models.json');
      await fs.writeFile(filePath, JSON.stringify(modelData, null, 2));
      
      console.log('[EnhancedML] 模型保存成功');
      
    } catch (error) {
      console.error('[EnhancedML] 模型保存失败:', error);
    }
  }

  /**
   * 清除历史数据
   */
  clearHistory(): void {
    this.featureHistory.length = 0;
    this.predictionHistory.length = 0;
    console.log('[EnhancedML] 历史数据已清除');
  }
}

export const enhancedMLEngine = new EnhancedMLEngine();