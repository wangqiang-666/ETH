import type { MarketData } from './okx-data-service.js';

/**
 * 多时间框架分析服务
 * 解决37.66%胜率问题的核心组件
 */

export interface TimeframeAnalysis {
  timeframe: string;
  trend: {
    direction: 'UP' | 'DOWN' | 'SIDEWAYS';
    strength: number; // 0-1
    confidence: number; // 0-1
    duration: number; // 趋势持续时间(小时)
  };
  momentum: {
    value: number; // -1 to 1
    acceleration: number; // 动量加速度
    divergence: boolean; // 是否存在背离
  };
  support_resistance: {
    support: number[];
    resistance: number[];
    current_level: 'SUPPORT' | 'RESISTANCE' | 'NEUTRAL';
  };
  volatility: {
    current: number;
    percentile: number; // 当前波动率在历史中的百分位
    regime: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  };
}

export interface MultiTimeframeConsensus {
  overall_direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number; // 0-1
  agreement_score: number; // 时间框架一致性评分
  
  timeframes: {
    '5m': TimeframeAnalysis;
    '15m': TimeframeAnalysis;
    '1h': TimeframeAnalysis;
    '4h': TimeframeAnalysis;
    '1d': TimeframeAnalysis;
  };
  
  entry_quality: {
    timing_score: number; // 入场时机评分
    risk_reward: number; // 风险收益比
    probability: number; // 成功概率估计
  };
  
  filters: {
    trend_alignment: boolean; // 趋势对齐
    momentum_confirmation: boolean; // 动量确认
    volume_confirmation: boolean; // 成交量确认
    volatility_acceptable: boolean; // 波动率可接受
  };
}

export class MultiTimeframeAnalyzer {
  private dataCache: Map<string, MarketData[]> = new Map();
  private analysisCache: Map<string, TimeframeAnalysis> = new Map();
  private lastUpdate: number = 0;
  
  constructor() {
    console.log('[MultiTimeframeAnalyzer] 🔍 多时间框架分析器初始化');
  }
  
  /**
   * 分析多时间框架并生成共识
   */
  public async analyzeMultiTimeframe(symbol: string): Promise<MultiTimeframeConsensus> {
    console.log(`[MultiTimeframeAnalyzer] 📊 开始多时间框架分析: ${symbol}`);
    
    // 获取各时间框架数据
    const timeframes = ['5m', '15m', '1h', '4h', '1d'];
    const analyses: { [key: string]: TimeframeAnalysis } = {};
    
    for (const tf of timeframes) {
      try {
        const data = await this.getTimeframeData(symbol, tf);
        analyses[tf] = await this.analyzeTimeframe(data, tf);
        
        console.log(`[MultiTimeframeAnalyzer] ✅ ${tf} 分析完成: ${analyses[tf].trend.direction} 趋势`);
      } catch (error) {
        console.warn(`[MultiTimeframeAnalyzer] ⚠️ ${tf} 分析失败:`, error);
        // 使用默认分析
        analyses[tf] = this.getDefaultAnalysis(tf);
      }
    }
    
    // 生成共识
    const consensus = this.generateConsensus(analyses);
    
    console.log(`[MultiTimeframeAnalyzer] 🎯 共识生成: ${consensus.overall_direction} (置信度: ${(consensus.confidence * 100).toFixed(1)}%)`);
    
    return consensus;
  }
  
  /**
   * 分析单个时间框架
   */
  private async analyzeTimeframe(data: MarketData[], timeframe: string): Promise<TimeframeAnalysis> {
    if (data.length < 50) {
      throw new Error(`${timeframe} 数据不足，需要至少50根K线`);
    }
    
    // 1. 趋势分析
    const trend = this.analyzeTrend(data, timeframe);
    
    // 2. 动量分析
    const momentum = this.analyzeMomentum(data);
    
    // 3. 支撑阻力分析
    const support_resistance = this.analyzeSupportResistance(data);
    
    // 4. 波动率分析
    const volatility = this.analyzeVolatility(data);
    
    return {
      timeframe,
      trend,
      momentum,
      support_resistance,
      volatility
    };
  }
  
  /**
   * 趋势分析 - 核心改进点
   */
  private analyzeTrend(data: MarketData[], timeframe: string): TimeframeAnalysis['trend'] {
    const prices = data.map(d => d.price);
    const volumes = data.map(d => d.volume);
    
    // 多重EMA分析
    const ema8 = this.calculateEMA(prices, 8);
    const ema21 = this.calculateEMA(prices, 21);
    const ema55 = this.calculateEMA(prices, 55);
    
    // ADX趋势强度
    const adx = this.calculateADX(data);
    
    // 价格相对于EMA的位置
    const currentPrice = prices[prices.length - 1];
    const emaAlignment = this.checkEMAAlignment(ema8, ema21, ema55);
    
    // 趋势方向判断
    let direction: 'UP' | 'DOWN' | 'SIDEWAYS';
    let strength: number;
    let confidence: number;
    
    if (currentPrice > ema8 && ema8 > ema21 && ema21 > ema55 && emaAlignment.bullish) {
      direction = 'UP';
      strength = Math.min(1, adx / 25); // ADX > 25 表示强趋势
      confidence = this.calculateTrendConfidence(data, 'UP');
    } else if (currentPrice < ema8 && ema8 < ema21 && ema21 < ema55 && emaAlignment.bearish) {
      direction = 'DOWN';
      strength = Math.min(1, adx / 25);
      confidence = this.calculateTrendConfidence(data, 'DOWN');
    } else {
      direction = 'SIDEWAYS';
      strength = 0.3;
      confidence = 0.5;
    }
    
    // 趋势持续时间
    const duration = this.calculateTrendDuration(data);
    
    return { direction, strength, confidence, duration };
  }
  
  /**
   * 动量分析 - 关键改进
   */
  private analyzeMomentum(data: MarketData[]): TimeframeAnalysis['momentum'] {
    const prices = data.map(d => d.price);
    
    // RSI
    const rsi = this.calculateRSI(prices, 14);
    
    // MACD
    const macd = this.calculateMACD(prices);
    
    // 随机指标
    const stoch = this.calculateStochastic(data, 14);
    
    // 威廉指标
    const williams = this.calculateWilliamsR(data, 14);
    
    // 综合动量值
    const momentum_indicators = [
      (rsi - 50) / 50, // 标准化RSI
      macd.histogram / Math.abs(macd.macd), // 标准化MACD
      (stoch.k - 50) / 50, // 标准化随机指标
      (williams + 50) / 50 // 标准化威廉指标
    ];
    
    const value = momentum_indicators.reduce((sum, val) => sum + val, 0) / momentum_indicators.length;
    
    // 动量加速度
    const acceleration = this.calculateMomentumAcceleration(data);
    
    // 背离检测
    const divergence = this.detectDivergence(data);
    
    return { value, acceleration, divergence };
  }
  
  /**
   * 支撑阻力分析
   */
  private analyzeSupportResistance(data: MarketData[]): TimeframeAnalysis['support_resistance'] {
    const prices = data.map(d => d.price);
    const currentPrice = data[data.length - 1].price;
    
    // 使用价格数据来模拟高低点
    const highs = prices.map(p => p * 1.01); // 模拟高点
    const lows = prices.map(p => p * 0.99);  // 模拟低点
    
    // 识别关键支撑阻力位
    const support = this.findSupportLevels(lows, currentPrice);
    const resistance = this.findResistanceLevels(highs, currentPrice);
    
    // 判断当前价格位置
    let current_level: 'SUPPORT' | 'RESISTANCE' | 'NEUTRAL';
    
    const nearestSupport = support.find(s => Math.abs(s - currentPrice) / currentPrice < 0.01);
    const nearestResistance = resistance.find(r => Math.abs(r - currentPrice) / currentPrice < 0.01);
    
    if (nearestSupport) {
      current_level = 'SUPPORT';
    } else if (nearestResistance) {
      current_level = 'RESISTANCE';
    } else {
      current_level = 'NEUTRAL';
    }
    
    return { support, resistance, current_level };
  }
  
  /**
   * 波动率分析
   */
  private analyzeVolatility(data: MarketData[]): TimeframeAnalysis['volatility'] {
    const prices = data.map(d => d.price);
    
    // ATR波动率
    const atr = this.calculateATR(data, 14);
    const currentPrice = prices[prices.length - 1];
    const current = atr / currentPrice; // 标准化波动率
    
    // 历史波动率百分位
    const historicalVolatility = this.calculateHistoricalVolatility(data, 100);
    const percentile = this.calculatePercentile(current, historicalVolatility);
    
    // 波动率制度
    let regime: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
    if (percentile < 0.2) regime = 'LOW';
    else if (percentile < 0.8) regime = 'NORMAL';
    else if (percentile < 0.95) regime = 'HIGH';
    else regime = 'EXTREME';
    
    return { current, percentile, regime };
  }
  
  /**
   * 生成多时间框架共识
   */
  private generateConsensus(analyses: { [key: string]: TimeframeAnalysis }): MultiTimeframeConsensus {
    const timeframes = Object.keys(analyses);
    
    // 计算整体方向
    let bullishScore = 0;
    let bearishScore = 0;
    let totalWeight = 0;
    
    // 时间框架权重
    const weights = {
      '5m': 0.1,
      '15m': 0.2,
      '1h': 0.3,
      '4h': 0.25,
      '1d': 0.15
    };
    
    timeframes.forEach(tf => {
      const analysis = analyses[tf];
      const weight = weights[tf as keyof typeof weights] || 0.1;
      
      if (analysis.trend.direction === 'UP') {
        bullishScore += weight * analysis.trend.strength * analysis.trend.confidence;
      } else if (analysis.trend.direction === 'DOWN') {
        bearishScore += weight * analysis.trend.strength * analysis.trend.confidence;
      }
      
      totalWeight += weight;
    });
    
    // 标准化评分
    bullishScore /= totalWeight;
    bearishScore /= totalWeight;
    
    // 确定整体方向
    let overall_direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    let confidence: number;
    
    if (bullishScore > bearishScore && bullishScore > 0.6) {
      overall_direction = 'BULLISH';
      confidence = bullishScore;
    } else if (bearishScore > bullishScore && bearishScore > 0.6) {
      overall_direction = 'BEARISH';
      confidence = bearishScore;
    } else {
      overall_direction = 'NEUTRAL';
      confidence = 0.5;
    }
    
    // 计算一致性评分
    const agreement_score = this.calculateAgreementScore(analyses);
    
    // 入场质量评估
    const entry_quality = this.assessEntryQuality(analyses);
    
    // 过滤器检查
    const filters = this.checkFilters(analyses);
    
    return {
      overall_direction,
      confidence,
      agreement_score,
      timeframes: analyses as any,
      entry_quality,
      filters
    };
  }
  
  /**
   * 计算一致性评分
   */
  private calculateAgreementScore(analyses: { [key: string]: TimeframeAnalysis }): number {
    const directions = Object.values(analyses).map(a => a.trend.direction);
    const upCount = directions.filter(d => d === 'UP').length;
    const downCount = directions.filter(d => d === 'DOWN').length;
    const sidewaysCount = directions.filter(d => d === 'SIDEWAYS').length;
    
    const total = directions.length;
    const maxCount = Math.max(upCount, downCount, sidewaysCount);
    
    return maxCount / total;
  }
  
  /**
   * 评估入场质量
   */
  private assessEntryQuality(analyses: { [key: string]: TimeframeAnalysis }): MultiTimeframeConsensus['entry_quality'] {
    // 基于5分钟和15分钟时间框架评估入场时机
    const m5 = analyses['5m'];
    const m15 = analyses['15m'];
    const h1 = analyses['1h'];
    
    // 时机评分
    let timing_score = 0.5;
    
    if (m5 && m15) {
      // 短期动量一致性
      if (Math.sign(m5.momentum.value) === Math.sign(m15.momentum.value)) {
        timing_score += 0.2;
      }
      
      // 波动率适中
      if (m5.volatility.regime === 'NORMAL' || m5.volatility.regime === 'LOW') {
        timing_score += 0.2;
      }
      
      // 支撑阻力位置
      if (m15.support_resistance.current_level === 'SUPPORT' && m15.trend.direction === 'UP') {
        timing_score += 0.1;
      } else if (m15.support_resistance.current_level === 'RESISTANCE' && m15.trend.direction === 'DOWN') {
        timing_score += 0.1;
      }
    }
    
    timing_score = Math.min(1, timing_score);
    
    // 风险收益比
    const risk_reward = this.calculateRiskReward(analyses);
    
    // 成功概率估计
    const probability = this.estimateSuccessProbability(analyses);
    
    return { timing_score, risk_reward, probability };
  }
  
  /**
   * 检查过滤器
   */
  private checkFilters(analyses: { [key: string]: TimeframeAnalysis }): MultiTimeframeConsensus['filters'] {
    const h1 = analyses['1h'];
    const m15 = analyses['15m'];
    const m5 = analyses['5m'];
    
    // 趋势对齐 - 1小时和15分钟趋势一致
    const trend_alignment = h1 && m15 && 
      (h1.trend.direction === m15.trend.direction || 
       (h1.trend.direction !== 'SIDEWAYS' && m15.trend.direction !== 'SIDEWAYS'));
    
    // 动量确认 - 15分钟和5分钟动量方向一致
    const momentum_confirmation = m15 && m5 &&
      Math.sign(m15.momentum.value) === Math.sign(m5.momentum.value) &&
      Math.abs(m15.momentum.value) > 0.3;
    
    // 成交量确认 - 这里需要实际的成交量数据
    const volume_confirmation = true; // 占位符
    
    // 波动率可接受 - 不在极端波动状态
    const volatility_acceptable = m15 && 
      m15.volatility.regime !== 'EXTREME';
    
    return {
      trend_alignment: trend_alignment || false,
      momentum_confirmation: momentum_confirmation || false,
      volume_confirmation,
      volatility_acceptable: volatility_acceptable || false
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
    const signal = this.calculateEMA([macd], 9);
    const histogram = macd - signal;
    
    return { macd, signal, histogram };
  }
  
  private calculateADX(data: MarketData[]): number {
    // 简化的ADX计算，基于价格波动
    if (data.length < 14) return 0;
    
    let totalMovement = 0;
    let positiveMovement = 0;
    let negativeMovement = 0;
    
    for (let i = 1; i < Math.min(data.length, 15); i++) {
      const currentPrice = data[i].price;
      const prevPrice = data[i - 1].price;
      
      const priceChange = currentPrice - prevPrice;
      const absChange = Math.abs(priceChange);
      
      totalMovement += absChange;
      
      if (priceChange > 0) {
        positiveMovement += priceChange;
      } else {
        negativeMovement += Math.abs(priceChange);
      }
    }
    
    if (totalMovement === 0) return 0;
    
    const diPlus = (positiveMovement / totalMovement) * 100;
    const diMinus = (negativeMovement / totalMovement) * 100;
    
    if (diPlus + diMinus === 0) return 0;
    
    return Math.abs(diPlus - diMinus) / (diPlus + diMinus) * 100;
  }
  
  private calculateATR(data: MarketData[], period: number): number {
    if (data.length < period + 1) return 0;
    
    let atr = 0;
    
    for (let i = 1; i <= period; i++) {
      const currentPrice = data[i].price;
      const prevPrice = data[i - 1].price;
      
      // 使用价格变化来模拟真实范围
      const priceRange = Math.abs(currentPrice - prevPrice);
      const high = Math.max(currentPrice, prevPrice) * 1.005; // 模拟高点
      const low = Math.min(currentPrice, prevPrice) * 0.995;  // 模拟低点
      
      const trueRange = Math.max(
        high - low,
        Math.abs(high - prevPrice),
        Math.abs(low - prevPrice)
      );
      
      atr += trueRange;
    }
    
    return atr / period;
  }
  
  // 占位符方法 - 需要完整实现
  private async getTimeframeData(symbol: string, timeframe: string): Promise<MarketData[]> {
    // 应该从您的数据服务获取对应时间框架的数据
    // 这里返回模拟数据
    const mockData: MarketData[] = [];
    const basePrice = 3000;
    const now = Date.now();
    
    for (let i = 0; i < 100; i++) {
      const price = basePrice + (Math.random() - 0.5) * 200;
      mockData.push({
        symbol,
        price,
        volume: 1000000 + Math.random() * 500000,
        timestamp: now - i * 15 * 60 * 1000,
        high24h: price * 1.02,
        low24h: price * 0.98,
        change24h: (Math.random() - 0.5) * 10,
        fundingRate: 0.0001,
        openInterest: 50000000
      });
    }
    
    return mockData.reverse();
  }
  
  private getDefaultAnalysis(timeframe: string): TimeframeAnalysis {
    return {
      timeframe,
      trend: {
        direction: 'SIDEWAYS',
        strength: 0.3,
        confidence: 0.5,
        duration: 0
      },
      momentum: {
        value: 0,
        acceleration: 0,
        divergence: false
      },
      support_resistance: {
        support: [],
        resistance: [],
        current_level: 'NEUTRAL'
      },
      volatility: {
        current: 0.02,
        percentile: 0.5,
        regime: 'NORMAL'
      }
    };
  }
  
  // 其他辅助方法的占位符
  private checkEMAAlignment(ema8: number, ema21: number, ema55: number): { bullish: boolean; bearish: boolean } {
    return {
      bullish: ema8 > ema21 && ema21 > ema55,
      bearish: ema8 < ema21 && ema21 < ema55
    };
  }
  
  private calculateTrendConfidence(data: MarketData[], direction: 'UP' | 'DOWN'): number {
    return 0.7; // 占位符
  }
  
  private calculateTrendDuration(data: MarketData[]): number {
    return 12; // 占位符，返回小时数
  }
  
  private calculateStochastic(data: MarketData[], period: number): { k: number; d: number } {
    return { k: 50, d: 50 }; // 占位符
  }
  
  private calculateWilliamsR(data: MarketData[], period: number): number {
    return -50; // 占位符
  }
  
  private calculateMomentumAcceleration(data: MarketData[]): number {
    return 0; // 占位符
  }
  
  private detectDivergence(data: MarketData[]): boolean {
    return false; // 占位符
  }
  
  private findSupportLevels(lows: number[], currentPrice: number): number[] {
    return []; // 占位符
  }
  
  private findResistanceLevels(highs: number[], currentPrice: number): number[] {
    return []; // 占位符
  }
  
  private calculateHistoricalVolatility(data: MarketData[], period: number): number[] {
    return []; // 占位符
  }
  
  private calculatePercentile(value: number, array: number[]): number {
    return 0.5; // 占位符
  }
  
  private calculateRiskReward(analyses: { [key: string]: TimeframeAnalysis }): number {
    return 2.0; // 占位符
  }
  
  private estimateSuccessProbability(analyses: { [key: string]: TimeframeAnalysis }): number {
    return 0.65; // 占位符，目标是提升到65%+
  }
}

// 导出单例
export const multiTimeframeAnalyzer = new MultiTimeframeAnalyzer();