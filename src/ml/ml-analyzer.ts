import { Matrix } from 'ml-matrix';
import * as ss from 'simple-statistics';
import { TechnicalIndicatorResult, TechnicalIndicatorAnalyzer } from '../indicators/technical-indicators';
import { config } from '../config';
import { EnhancedMLAnalyzer } from './enhanced-ml-analyzer';
import { enhancedOKXDataService } from '../services/enhanced-okx-data-service';

// 简单的线性回归模型
class SimpleLinearRegression {
  private weights: number[] = [];
  private bias: number = 0;
  private isTrained: boolean = false;

  train(features: number[][], targets: number[]): void {
    if (features.length === 0 || targets.length === 0) return;
    
    try {
      // 使用简单统计方法进行线性回归
      if (features[0].length === 1) {
        // 单变量线性回归
        const xValues = features.map(f => f[0]);
        const regression = ss.linearRegression(xValues.map((x, i) => [x, targets[i]]));
        this.weights = [regression.m];
        this.bias = regression.b;
      } else {
        // 多变量回归 - 使用简化方法
        this.bias = ss.mean(targets);
        this.weights = new Array(features[0].length).fill(0);
        
        // 为每个特征计算简单的相关性权重
        for (let j = 0; j < features[0].length; j++) {
          const featureValues = features.map(f => f[j]);
          const correlation = ss.sampleCorrelation(featureValues, targets);
          this.weights[j] = isNaN(correlation) ? 0 : correlation * 0.1;
        }
      }
      this.isTrained = true;
    } catch (error) {
      // 如果计算失败，使用简单的平均值作为预测
      this.bias = ss.mean(targets);
      this.weights = new Array(features[0].length).fill(0);
      this.isTrained = true;
    }
  }

  predict(features: number[]): number {
    if (!this.isTrained) return 0;
    
    let prediction = this.bias;
    for (let i = 0; i < Math.min(features.length, this.weights.length); i++) {
      prediction += features[i] * this.weights[i];
    }
    return prediction;
  }

  getConfidence(features: number[]): number {
    // 基于特征值的置信度计算
    const prediction = this.predict(features);
    const featureVariance = ss.variance(features);
    return Math.max(0.1, Math.min(0.9, 1 / (1 + featureVariance)));
  }
}

// 机器学习分析结果接口
export interface MLAnalysisResult {
  prediction: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  confidence: number; // 0-1之间的置信度
  targetPrice: number;
  stopLoss: number;
  riskScore: number; // 0-10风险评分
  reasoning: string; // AI分析推理过程
  features: {
    technicalScore: number;
    sentimentScore: number;
    volumeScore: number;
    momentumScore: number;
  };
}

// 市场数据接口
export interface MarketData {
  symbol?: string;
  price: number;
  volume: number;
  timestamp: number;
  high24h: number;
  low24h: number;
  change24h: number; // 24h rolling change based on open24h
  // 以下为可选诊断字段
  changeFromSodUtc8?: number; // day-based change from UTC+8 session open
  open24hPrice?: number; // raw base used for rolling
  sodUtc8Price?: number; // raw base used for day-based
  fundingRate?: number;
  openInterest?: number;
  // 新增：恐惧与贪婪指数（0-100），用于情绪特征
  fgiScore?: number;
}

// 机器学习分析器类
export class MLAnalyzer {
  private priceModel: SimpleLinearRegression = new SimpleLinearRegression();
  private volatilityModel: SimpleLinearRegression = new SimpleLinearRegression();
  private trendModel: SimpleLinearRegression = new SimpleLinearRegression();
  private enhancedAnalyzer: EnhancedMLAnalyzer | null = null;
  private isInitialized = false;
  private historicalFeatures: number[][] = [];
  private historicalTargets: number[] = [];
  private useEnhancedAnalyzer: boolean = false;

  constructor() {
    this.initialize();
  }

  // 初始化本地ML模型
  private async initialize(): Promise<void> {
    try {
      console.log('🤖 初始化机器学习分析系统...');
      
      // 检查是否使用增强分析器
      const modelType = config.ml?.local?.modelType || 'linear';
      this.useEnhancedAnalyzer = modelType === 'ensemble' || modelType === 'enhanced';
      
      if (this.useEnhancedAnalyzer) {
        console.log('🚀 启用增强机器学习分析器...');
        this.enhancedAnalyzer = new EnhancedMLAnalyzer();
      } else {
        console.log('📊 使用基础机器学习模型...');
        // 优先使用真实历史数据进行初始化训练
        if (config.ml?.local?.useRealHistoricalTraining) {
          await this.generateTrainingDataFromReal();
        } else {
          this.generateTrainingData();
        }
        
        // 训练模型
        this.trainModels();
      }
      
      this.isInitialized = true;
      console.log('✅ 机器学习分析系统初始化完成');
    } catch (error) {
      console.error('❌ ML分析器初始化失败:', error);
      this.isInitialized = true; // 即使失败也标记为已初始化，使用备用方法
    }
  }

  // 生成训练数据

  // 在线学习 - 使用新数据更新模型
  // 辅助方法
  private async generateTrainingDataFromReal(): Promise<void> {
    try {
      const symbol = config.ml?.local?.trainingSymbol || config.trading?.defaultSymbol;
      const interval = (config.ml?.local?.trainingInterval || '1m') as string;
      const limit = Math.max(
        Math.min(config.ml?.local?.trainingLimit || 500, config.ml?.local?.trainingDataSize || 2000),
        120
      );
      if (!symbol) {
        console.warn('未配置 trainingSymbol 或 defaultSymbol，回退到模拟训练数据');
        this.generateTrainingData();
        return;
      }
      const klines = await enhancedOKXDataService.getKlineData(symbol as any, interval as any, limit as any);
      if (!klines || klines.length < 60) {
        console.warn('历史K线不足，回退到模拟训练数据');
        this.generateTrainingData();
        return;
      }

      const indicatorAnalyzer = new TechnicalIndicatorAnalyzer();
      const winCount = this.get24hWindowCount(interval);

      this.historicalFeatures = [];
      this.historicalTargets = [];

      for (let i = Math.max(60, winCount + 1); i < klines.length - 1; i++) {
        const slice = klines.slice(0, i + 1);
        indicatorAnalyzer.updateKlineData(slice.map(k => ({
          timestamp: k.timestamp,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume
        })) as any);
        const indicators = indicatorAnalyzer.calculateAllIndicators();
        if (!indicators) continue;

        const mdNow = this.buildMarketDataForIndex(klines, i, winCount);
        const historicalMarketData = this.buildHistoricalMarketData(klines, Math.max(0, i - 50), i);
        const features = this.extractFeatures(mdNow, indicators as TechnicalIndicatorResult, historicalMarketData);

        const nextClose = klines[i + 1].close;
        const target = (nextClose - klines[i].close) / klines[i].close;

        this.historicalFeatures.push(features);
        this.historicalTargets.push(target);
      }
      console.log(`✅ 已生成真实训练样本: ${this.historicalFeatures.length}`);
    } catch (err) {
      console.warn('加载真实训练数据失败，回退到模拟数据:', err);
      this.historicalFeatures = [];
      this.historicalTargets = [];
      this.generateTrainingData();
    }
  }

  // 计算24小时窗口内包含的K线数量
  private get24hWindowCount(interval: string): number {
    const preset: Record<string, number> = {
      '1m': 1440,
      '3m': 480,
      '5m': 288,
      '15m': 96,
      '30m': 48,
      '1h': 24,
      '2h': 12,
      '4h': 6,
      '6h': 4,
      '12h': 2,
      '1d': 1
    };
    if (preset[interval]) return preset[interval];
    const m = interval.match(/^(\d+)([mhd])$/i);
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      if (unit === 'm' && n > 0) return Math.max(Math.floor(1440 / n), 1);
      if (unit === 'h' && n > 0) return Math.max(Math.floor(24 / n), 1);
      if (unit === 'd' && n > 0) return 1;
    }
    return 24; // 默认按1小时计算
  }

  // 基于K线构造指定索引的 MarketData
  private buildMarketDataForIndex(
    klines: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>,
    i: number,
    winCount: number
  ): MarketData {
    const start = Math.max(0, i - winCount + 1);
    const window = klines.slice(start, i + 1);
    const high24h = Math.max(...window.map(k => k.high));
    const low24h = Math.min(...window.map(k => k.low));
    const open24hPrice = window[0]?.open ?? klines[start].open;
    const price = klines[i].close;
    const change24h = open24hPrice ? ((price - open24hPrice) / open24hPrice) * 100 : 0;

    return {
      price,
      volume: klines[i].volume,
      timestamp: klines[i].timestamp,
      high24h,
      low24h,
      change24h,
      open24hPrice
    } as MarketData;
  }

  // 构造历史 MarketData 序列（用于提取动量等特征）
  private buildHistoricalMarketData(
    klines: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>,
    startIdx: number,
    endIdx: number
  ): MarketData[] {
    const from = Math.max(0, startIdx);
    const to = Math.min(endIdx, klines.length - 1);
    const out: MarketData[] = [];
    for (let j = from; j <= to; j++) {
      out.push({
        price: klines[j].close,
        volume: klines[j].volume,
        timestamp: klines[j].timestamp,
        high24h: klines[j].high, // 作为占位值，不影响当前特征提取逻辑
        low24h: klines[j].low,   // 作为占位值，不影响当前特征提取逻辑
        change24h: 0
      } as MarketData);
    }
    return out;
  }

  private generateTrainingData(): void {
    // 生成模拟的历史特征和目标数据
    for (let i = 0; i < 100; i++) {
      const features = [
        Math.random() * 100, // RSI
        (Math.random() - 0.5) * 2, // MACD
        Math.random(), // 布林带位置
        (Math.random() - 0.5) * 0.1, // 价格变化
        Math.random() * 1000000, // 成交量
        Math.random() * 0.02, // 波动率
        Math.random() * 100, // 动量
        Math.random() * 50 // 趋势强度
      ];
      
      // 基于特征生成目标值（价格变化）
      const target = this.generateTargetFromFeatures(features);
      
      this.historicalFeatures.push(features);
      this.historicalTargets.push(target);
    }
  }

  // 根据特征生成目标值
  private generateTargetFromFeatures(features: number[]): number {
    const [rsi, macd, bbPos, priceChange, volume, volatility, momentum, trend] = features;
    
    // 简单的规则：RSI > 70 看跌，RSI < 30 看涨，MACD正值看涨等
    let target = 0;
    
    if (rsi > 70) target -= 0.02; // 超买
    if (rsi < 30) target += 0.02; // 超卖
    if (macd > 0) target += 0.01; // MACD金叉
    if (bbPos > 0.8) target -= 0.01; // 接近上轨
    if (bbPos < 0.2) target += 0.01; // 接近下轨
    
    target += priceChange * 0.5; // 价格动量
    target += (momentum - 50) * 0.0002; // 动量影响
    
    return target;
  }

  // 训练所有模型
  private trainModels(): void {
    if (this.historicalFeatures.length === 0) return;
    
    // 训练价格预测模型
    this.priceModel.train(this.historicalFeatures, this.historicalTargets);
    
    // 训练波动率模型（使用绝对值作为目标）
    const volatilityTargets = this.historicalTargets.map(t => Math.abs(t));
    this.volatilityModel.train(this.historicalFeatures, volatilityTargets);
    
    // 训练趋势模型（使用符号作为目标）
    const trendTargets = this.historicalTargets.map(t => t > 0 ? 1 : -1);
    this.trendModel.train(this.historicalFeatures, trendTargets);
    
    console.log('✅ 机器学习模型训练完成');
  }

  // 在线学习 - 使用新数据更新模型
  updateModels(marketData: MarketData, indicators: TechnicalIndicatorResult, actualReturn: number): void {
    try {
      const features = this.extractFeatures(marketData, indicators, [marketData]);
      
      // 添加新的训练样本
      this.historicalFeatures.push(features);
      this.historicalTargets.push(actualReturn);
      
      // 保持训练数据在合理范围内（最多1000个样本）
      if (this.historicalFeatures.length > 1000) {
        this.historicalFeatures.shift();
        this.historicalTargets.shift();
      }
      
      // 每10个新样本重新训练一次模型
      if (this.historicalFeatures.length % 10 === 0) {
        this.trainModels();
        console.log('📈 模型已使用新数据重新训练');
      }
    } catch (error) {
      console.error('更新模型失败:', error);
    }
  }

  // 获取模型性能统计
  getModelStats(): {
    trainingDataSize: number;
    lastTrainingTime: Date;
    modelAccuracy: number;
  } {
    // 计算简单的准确率（预测方向正确的比例）
    let correctPredictions = 0;
    const recentData = this.historicalFeatures.slice(-50); // 最近50个样本
    const recentTargets = this.historicalTargets.slice(-50);
    
    for (let i = 0; i < recentData.length; i++) {
      const prediction = this.priceModel.predict(recentData[i]);
      const actual = recentTargets[i];
      
      // 检查方向是否正确
      if ((prediction > 0 && actual > 0) || (prediction < 0 && actual < 0)) {
        correctPredictions++;
      }
    }
    
    const accuracy = recentData.length > 0 ? correctPredictions / recentData.length : 0;
    
    return {
      trainingDataSize: this.historicalFeatures.length,
      lastTrainingTime: new Date(),
      modelAccuracy: accuracy
    };
  }

  // 主要分析方法
  async analyze(
    marketData: MarketData,
    technicalIndicators: TechnicalIndicatorResult,
    historicalData: MarketData[]
  ): Promise<MLAnalysisResult> {
    if (!this.isInitialized) {
      throw new Error('ML Analyzer not initialized');
    }

    try {
      // 如果启用了增强分析器，优先使用
      if (this.useEnhancedAnalyzer && this.enhancedAnalyzer) {
        console.log('🔬 使用增强机器学习分析...');
        return await this.enhancedAnalyzer.analyze(marketData, technicalIndicators, historicalData);
      }
      
      // 否则使用基础分析器
      console.log('📊 使用基础机器学习分析...');
      
      // 1. 特征工程
      const features = this.extractFeatures(marketData, technicalIndicators, historicalData);
      
      // 2. 使用本地机器学习模型进行预测
      const mlPrediction = this.predictWithLocalModels(features);
      
      // 3. 基于规则的市场分析
      const ruleAnalysis = this.getRuleBasedAnalysis(marketData, technicalIndicators);
      
      // 4. 基于预测结果生成交易信号
      return this.generateTradingSignal(mlPrediction, marketData, technicalIndicators, features, ruleAnalysis);
    } catch (error) {
      console.error('ML Analysis failed:', error);
      return this.getFallbackAnalysis(marketData, technicalIndicators);
    }
  }

  // 使用本地模型进行预测
  private predictWithLocalModels(features: number[]): {
    priceChange: number;
    volatility: number;
    trend: number;
    confidence: number;
  } {
    const priceChange = this.priceModel.predict(features);
    const volatility = this.volatilityModel.predict(features);
    const trend = this.trendModel.predict(features);
    
    // 计算综合置信度
    const priceConfidence = this.priceModel.getConfidence(features);
    const volatilityConfidence = this.volatilityModel.getConfidence(features);
    const trendConfidence = this.trendModel.getConfidence(features);
    const confidence = (priceConfidence + volatilityConfidence + trendConfidence) / 3;
    
    return {
      priceChange,
      volatility,
      trend,
      confidence
    };
  }

  // 基于规则的市场分析（替代AI分析）
  private getRuleBasedAnalysis(
    marketData: MarketData,
    indicators: TechnicalIndicatorResult
  ): {
    sentiment: string;
    reasoning: string;
    riskAssessment: string;
  } {
    let sentiment = 'NEUTRAL';
    let reasoning = '基于技术指标的规则分析：\n';
    let riskLevel = 'MEDIUM';
    
    // RSI分析
    if (indicators.rsi > 70) {
      sentiment = 'BEARISH';
      reasoning += `• RSI超买 (${indicators.rsi.toFixed(1)})，市场可能回调\n`;
      riskLevel = 'HIGH';
    } else if (indicators.rsi < 30) {
      sentiment = 'BULLISH';
      reasoning += `• RSI超卖 (${indicators.rsi.toFixed(1)})，市场可能反弹\n`;
    } else {
      reasoning += `• RSI处于正常区间 (${indicators.rsi.toFixed(1)})\n`;
    }
    
    // MACD分析
    if (indicators.macd.histogram > 0) {
      if (sentiment === 'NEUTRAL') sentiment = 'BULLISH';
      reasoning += `• MACD金叉，看涨信号\n`;
    } else if (indicators.macd.histogram < 0) {
      if (sentiment === 'NEUTRAL') sentiment = 'BEARISH';
      reasoning += `• MACD死叉，看跌信号\n`;
    }
    
    // 布林带分析
    const bollingerRange = indicators.bollinger.upper - indicators.bollinger.lower;
    const bollingerPosition = bollingerRange > 0 ? (marketData.price - indicators.bollinger.middle) / bollingerRange + 0.5 : 0.5;
    if (bollingerPosition > 0.8) {
      reasoning += `• 价格接近布林带上轨，可能遇到阻力\n`;
      riskLevel = 'HIGH';
    } else if (bollingerPosition < 0.2) {
      reasoning += `• 价格接近布林带下轨，可能获得支撑\n`;
    }
    
    // 成交量分析
    const volumeRatio = marketData.volume / (marketData.volume * 0.8); // 简化的成交量比较
    if (volumeRatio > 1.5) {
      reasoning += `• 成交量放大，趋势可能延续\n`;
    } else if (volumeRatio < 0.5) {
      reasoning += `• 成交量萎缩，趋势可能转变\n`;
      riskLevel = 'LOW';
    }
    
    // 价格变化分析
    if (Math.abs(marketData.change24h) > 5) {
      reasoning += `• 24小时价格变化较大 (${marketData.change24h.toFixed(2)}%)，市场波动性高\n`;
      riskLevel = 'HIGH';
    }
    
    return {
      sentiment,
      reasoning,
      riskAssessment: riskLevel
    };
  }

  // 生成交易信号
  private generateTradingSignal(
    prediction: { priceChange: number; volatility: number; trend: number; confidence: number },
    marketData: MarketData,
    indicators: TechnicalIndicatorResult,
    features: number[],
    ruleAnalysis: { sentiment: string; reasoning: string; riskAssessment: string }
  ): MLAnalysisResult {
    const { priceChange, volatility, trend, confidence } = prediction;
    
    // 确定交易信号
    let signal: MLAnalysisResult['prediction'];
    if (priceChange > 0.02 && trend > 0.5) {
      signal = 'STRONG_BUY';
    } else if (priceChange > 0.01 && trend > 0) {
      signal = 'BUY';
    } else if (priceChange < -0.02 && trend < -0.5) {
      signal = 'STRONG_SELL';
    } else if (priceChange < -0.01 && trend < 0) {
      signal = 'SELL';
    } else {
      signal = 'HOLD';
    }
    
    // 计算目标价格和止损
    const targetPrice = marketData.price * (1 + priceChange);
    const stopLoss = marketData.price * (1 - Math.abs(priceChange) * 0.5);
    
    // 计算风险评分
    const riskScore = Math.min(10, Math.max(1, volatility * 100 + (1 - confidence) * 5));
    
    return {
      prediction: signal,
      confidence,
      targetPrice,
      stopLoss,
      riskScore: this.calculateRiskScore(ruleAnalysis.riskAssessment, indicators, marketData),
      reasoning: this.generateReasoning(prediction, indicators, features, ruleAnalysis),
      features: {
        technicalScore: this.calculateTechnicalScore(indicators, marketData),
        sentimentScore: this.getSentimentScore(ruleAnalysis.sentiment),
        volumeScore: this.calculateVolumeScore(marketData),
        momentumScore: this.calculateMomentumScore(indicators)
      }
    };
  }

  // 生成推理说明
  private generateReasoning(
    prediction: { priceChange: number; volatility: number; trend: number; confidence: number },
    indicators: TechnicalIndicatorResult,
    features: number[],
    ruleAnalysis: { sentiment: string; reasoning: string; riskAssessment: string }
  ): string {
    const { priceChange, volatility, trend, confidence } = prediction;
    const [rsi, macd, bbPos] = features;
    
    let reasoning = `基于机器学习模型分析：\n`;
    reasoning += `• 预期价格变化: ${(priceChange * 100).toFixed(2)}%\n`;
    reasoning += `• 市场趋势: ${trend > 0 ? '上涨' : '下跌'} (强度: ${Math.abs(trend).toFixed(2)})\n`;
    reasoning += `• 波动率预测: ${(volatility * 100).toFixed(2)}%\n`;
    reasoning += `• 模型置信度: ${(confidence * 100).toFixed(1)}%\n\n`;
    
    reasoning += ruleAnalysis.reasoning;
    
    return reasoning;
  }

  // 特征提取
  private extractFeatures(
    marketData: MarketData,
    indicators: TechnicalIndicatorResult,
    historicalData: MarketData[]
  ): number[] {
    const features: number[] = [];

    // 价格特征
    features.push(
      marketData.change24h / 100, // 24小时涨跌幅
      (marketData.price - marketData.low24h) / (marketData.high24h - marketData.low24h), // 价格位置
      Math.log(marketData.volume / 1000000) // 成交量对数
    );

    // 技术指标特征
    features.push(
      indicators.rsi / 100,
      indicators.macd.histogram,
      // 计算布林带位置
      (() => {
        const bollingerRange = indicators.bollinger.upper - indicators.bollinger.lower;
        return bollingerRange > 0 ? (marketData.price - indicators.bollinger.middle) / bollingerRange + 0.5 : 0.5;
      })(),
      indicators.kdj.k / 100,
      indicators.kdj.d / 100,
      indicators.williams / 100
    );

    // 趋势特征
    if (historicalData.length >= 20) {
      const prices = historicalData.slice(-20).map(d => d.price);
      const returns = this.calculateReturns(prices);
      
      features.push(
        ss.mean(returns),
        ss.standardDeviation(returns),
        // 简化的偏度计算
        returns.length > 2 ? this.calculateSkewness(returns) : 0,
        this.calculateTrendStrength(prices),
        this.calculateVolatility(returns)
      );
    } else {
      features.push(0, 0, 0, 0, 0);
    }

    // 市场微观结构特征
    features.push(
      marketData.fundingRate || 0,
      Math.log((marketData.openInterest || 1) / 1000000),
      this.calculateMomentum(historicalData)
    );

    // 新增：情绪特征（FGI），按 0-1 归一化（受配置开关控制）
    if (config.ml.features.sentiment?.fgi) {
      const fgiNormalized = (marketData.fgiScore ?? 50) / 100;
      features.push(fgiNormalized);
    }

    // 填充到固定长度
    while (features.length < 20) {
      features.push(0);
    }

    return features.slice(0, 20);
  }

  // 训练模型（支持实时数据更新）
  async trainModel(trainingData: {
    features: number[][];
    targets: number[];
  }): Promise<void> {
    try {
      if (trainingData.features.length === 0) {
        console.warn('训练数据为空');
        return;
      }
      
      console.log('🔄 开始训练机器学习模型...');
      
      // 更新历史数据
      this.historicalFeatures = trainingData.features;
      this.historicalTargets = trainingData.targets;
      
      // 重新训练所有模型
      this.trainModels();
      
      console.log(`✅ 模型训练完成，使用 ${trainingData.features.length} 个样本`);
    } catch (error) {
      console.error('❌ 模型训练失败:', error);
      throw error;
    }
  }

  // 基于规则的备用预测方法
  private fallbackPredict(features: number[]): {
    prediction: number[];
    confidence: number;
  } {
    // 基于特征的简单规则预测
    const [priceChange, pricePosition, volumeLog, rsi, macd, bbPosition] = features;
    
    let score = 0;
    let confidence = 0.6;
    
    // RSI分析
    if (rsi < 0.3) score += 2; // 超卖
    else if (rsi > 0.7) score -= 2; // 超买
    
    // MACD分析
    if (macd > 0) score += 1;
    else score -= 1;
    
    // 布林带位置分析
    if (bbPosition < 0.2) score += 1; // 接近下轨
    else if (bbPosition > 0.8) score -= 1; // 接近上轨
    
    // 价格变化分析
    if (priceChange > 0.05) score += 1;
    else if (priceChange < -0.05) score -= 1;
    
    // 成交量分析
    if (volumeLog > 2) confidence += 0.1; // 高成交量增加置信度
    
    // 转换为5分类概率分布
    const prediction = [0, 0, 0, 0, 0];
    if (score >= 3) {
      prediction[4] = 0.8; // STRONG_BUY
      prediction[3] = 0.2;
    } else if (score >= 1) {
      prediction[3] = 0.7; // BUY
      prediction[2] = 0.3;
    } else if (score <= -3) {
      prediction[0] = 0.8; // STRONG_SELL
      prediction[1] = 0.2;
    } else if (score <= -1) {
      prediction[1] = 0.7; // SELL
      prediction[2] = 0.3;
    } else {
      prediction[2] = 0.8; // HOLD
      prediction[1] = 0.1;
      prediction[3] = 0.1;
    }
    
    return { 
      prediction, 
      confidence: Math.min(confidence, 0.8) 
    };
  }

  // 使用本地机器学习模型进行交易信号分析
  private analyzeTradingSignals(features: number[]): {
    prediction: number[];
    confidence: number;
  } {
    try {
      // 使用本地训练的模型进行预测
      const mlPrediction = this.predictWithLocalModels(features);
      
      // 将预测结果转换为概率分布
      const prediction = this.convertToSignalProbabilities(mlPrediction);
      
      return {
        prediction,
        confidence: mlPrediction.confidence
      };
    } catch (error) {
      console.warn('本地ML预测失败，使用备用方法:', error);
      return this.fallbackPredict(features);
    }
  }

  // 将ML预测结果转换为信号概率分布
  private convertToSignalProbabilities(mlPrediction: {
    priceChange: number;
    volatility: number;
    trend: number;
    confidence: number;
  }): number[] {
    const { priceChange, trend } = mlPrediction;
    const prediction = [0, 0, 0, 0, 0]; // [STRONG_SELL, SELL, HOLD, BUY, STRONG_BUY]
    
    // 基于价格变化和趋势强度分配概率
    if (priceChange > 0.02 && trend > 0.5) {
      prediction[4] = 0.8; // STRONG_BUY
      prediction[3] = 0.2;
    } else if (priceChange > 0.01 && trend > 0) {
      prediction[3] = 0.7; // BUY
      prediction[2] = 0.3;
    } else if (priceChange < -0.02 && trend < -0.5) {
      prediction[0] = 0.8; // STRONG_SELL
      prediction[1] = 0.2;
    } else if (priceChange < -0.01 && trend < 0) {
      prediction[1] = 0.7; // SELL
      prediction[2] = 0.3;
    } else {
      prediction[2] = 0.8; // HOLD
      prediction[1] = 0.1;
      prediction[3] = 0.1;
    }
    
    return prediction;
  }



  // 辅助方法
  private calculateReturns(prices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    return returns;
  }

  private calculateTrendStrength(prices: number[]): number {
    if (prices.length < 2) return 0;
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    return (lastPrice - firstPrice) / firstPrice;
  }

  private calculateVolatility(returns: number[]): number {
    return returns.length > 1 ? ss.standardDeviation(returns) : 0;
  }

  private calculateSkewness(returns: number[]): number {
    if (returns.length < 3) return 0;
    
    const mean = ss.mean(returns);
    const std = ss.standardDeviation(returns);
    
    if (std === 0) return 0;
    
    const n = returns.length;
    const skewness = returns.reduce((sum, value) => {
      return sum + Math.pow((value - mean) / std, 3);
    }, 0) / n;
    
    return skewness;
  }

  private calculateMomentum(historicalData: MarketData[]): number {
    if (historicalData.length < 10) return 0;
    const recent = historicalData.slice(-5);
    const older = historicalData.slice(-10, -5);
    const recentAvg = ss.mean(recent.map(d => d.price));
    const olderAvg = ss.mean(older.map(d => d.price));
    return (recentAvg - olderAvg) / olderAvg;
  }

  private getSentimentConfidence(sentiment: string): number {
    const confidenceMap: { [key: string]: number } = {
      'BULLISH': 0.8,
      'BEARISH': 0.8,
      'NEUTRAL': 0.5
    };
    return confidenceMap[sentiment] || 0.5;
  }

  private calculatePriceTargets(
    marketData: MarketData,
    signal: MLAnalysisResult['prediction'],
    indicators: TechnicalIndicatorResult
  ): { targetPrice: number; stopLoss: number } {
    const currentPrice = marketData.price;
    const atr = indicators.atr || (marketData.high24h - marketData.low24h);

    let targetMultiplier = 1;
    let stopMultiplier = 0.5;

    switch (signal) {
      case 'STRONG_BUY':
        targetMultiplier = 2;
        stopMultiplier = 1;
        break;
      case 'BUY':
        targetMultiplier = 1.5;
        stopMultiplier = 0.75;
        break;
      case 'STRONG_SELL':
        targetMultiplier = -2;
        stopMultiplier = 1;
        break;
      case 'SELL':
        targetMultiplier = -1.5;
        stopMultiplier = 0.75;
        break;
      default:
        targetMultiplier = 0;
        stopMultiplier = 0.5;
    }

    const targetPrice = currentPrice + (atr * targetMultiplier);
    const stopLoss = signal.includes('BUY') 
      ? currentPrice - (atr * stopMultiplier)
      : currentPrice + (atr * stopMultiplier);

    return { targetPrice, stopLoss };
  }

  private calculateRiskScore(
    riskAssessment: string,
    indicators: TechnicalIndicatorResult,
    marketData: MarketData
  ): number {
    let baseRisk = 5;

    switch (riskAssessment) {
      case 'LOW': baseRisk = 3; break;
      case 'HIGH': baseRisk = 8; break;
      default: baseRisk = 5;
    }

    // 基于技术指标调整风险
    if (indicators.rsi > 80 || indicators.rsi < 20) baseRisk += 1;
    if (Math.abs(indicators.williams) > 80) baseRisk += 1;
    if (marketData.change24h > 10 || marketData.change24h < -10) baseRisk += 2;

    return Math.min(Math.max(baseRisk, 1), 10);
  }

  private calculateTechnicalScore(indicators: TechnicalIndicatorResult, marketData?: MarketData): number {
    let score = 50;

    // RSI评分
    if (indicators.rsi > 70) score -= 20;
    else if (indicators.rsi < 30) score += 20;

    // MACD评分
    if (indicators.macd.histogram > 0) score += 10;
    else score -= 10;

    // 布林带评分（如果有市场数据）
    if (marketData) {
      const bollingerRange = indicators.bollinger.upper - indicators.bollinger.lower;
      const bollingerPosition = bollingerRange > 0 ? (marketData.price - indicators.bollinger.middle) / bollingerRange + 0.5 : 0.5;
      if (bollingerPosition > 0.8) score -= 15;
      else if (bollingerPosition < 0.2) score += 15;
    }

    return Math.min(Math.max(score, 0), 100);
  }

  private getSentimentScore(sentiment: string): number {
    const scoreMap: { [key: string]: number } = {
      'BULLISH': 80,
      'BEARISH': 20,
      'NEUTRAL': 50
    };
    return scoreMap[sentiment] || 50;
  }

  private calculateVolumeScore(marketData: MarketData): number {
    // 简化的成交量评分，实际应该与历史平均比较
    const volumeLog = Math.log(marketData.volume / 1000000);
    return Math.min(Math.max(volumeLog * 10, 0), 100);
  }

  private calculateMomentumScore(indicators: TechnicalIndicatorResult): number {
    let score = 50;

    if (indicators.kdj.k > indicators.kdj.d) score += 20;
    else score -= 20;

    if (indicators.macd.macd > indicators.macd.signal) score += 15;
    else score -= 15;

    return Math.min(Math.max(score, 0), 100);
  }

  // 备用分析方法
  private getFallbackAnalysis(
    marketData: MarketData,
    indicators: TechnicalIndicatorResult
  ): MLAnalysisResult {
    let signal: MLAnalysisResult['prediction'] = 'HOLD';
    
    // 简单的技术指标组合判断
    const bullishSignals = [
      indicators.rsi < 30,
      indicators.macd.histogram > 0,
      (() => {
        const bollingerRange = indicators.bollinger.upper - indicators.bollinger.lower;
        const bollingerPosition = bollingerRange > 0 ? (marketData.price - indicators.bollinger.middle) / bollingerRange + 0.5 : 0.5;
        return bollingerPosition < 0.2;
      })(),
      indicators.kdj.k > indicators.kdj.d
    ].filter(Boolean).length;

    const bearishSignals = [
      indicators.rsi > 70,
      indicators.macd.histogram < 0,
      (() => {
        const bollingerRange = indicators.bollinger.upper - indicators.bollinger.lower;
        const bollingerPosition = bollingerRange > 0 ? (marketData.price - indicators.bollinger.middle) / bollingerRange + 0.5 : 0.5;
        return bollingerPosition > 0.8;
      })(),
      indicators.kdj.k < indicators.kdj.d
    ].filter(Boolean).length;

    if (bullishSignals >= 3) signal = 'BUY';
    else if (bearishSignals >= 3) signal = 'SELL';

    return {
      prediction: signal,
      confidence: 0.6,
      targetPrice: marketData.price * (signal === 'BUY' ? 1.02 : signal === 'SELL' ? 0.98 : 1),
      stopLoss: marketData.price * (signal === 'BUY' ? 0.99 : signal === 'SELL' ? 1.01 : 1),
      riskScore: 5,
      reasoning: '基于技术指标的基础分析',
      features: {
        technicalScore: this.calculateTechnicalScore(indicators, marketData),
        sentimentScore: 50,
        volumeScore: this.calculateVolumeScore(marketData),
        momentumScore: this.calculateMomentumScore(indicators)
      }
    };
  }

  // 动态切换分析器类型
  async switchAnalyzer(useEnhanced: boolean): Promise<void> {
    if (useEnhanced && !this.enhancedAnalyzer) {
      console.log('🚀 切换到增强机器学习分析器...');
      this.enhancedAnalyzer = new EnhancedMLAnalyzer();
      this.useEnhancedAnalyzer = true;
    } else if (!useEnhanced) {
      console.log('📊 切换到基础机器学习分析器...');
      this.useEnhancedAnalyzer = false;
    }
  }

  // 获取当前分析器状态
  getAnalyzerStatus(): { type: string; isInitialized: boolean; hasEnhanced: boolean } {
    return {
      type: this.useEnhancedAnalyzer ? 'enhanced' : 'basic',
      isInitialized: this.isInitialized,
      hasEnhanced: this.enhancedAnalyzer !== null
    };
  }

  // 保存模型（保存训练数据和模型状态）
  async saveModel(path: string): Promise<void> {
    try {
      const modelData = {
        historicalFeatures: this.historicalFeatures,
        historicalTargets: this.historicalTargets,
        modelStats: this.getModelStats(),
        isInitialized: this.isInitialized,
        timestamp: new Date().toISOString()
      };
      
      // 在实际应用中，这里应该保存到文件系统
      console.log(`模型数据已准备保存到: ${path}`);
      console.log('模型统计:', modelData.modelStats);
    } catch (error) {
      console.error('保存模型失败:', error);
      throw error;
    }
  }
}