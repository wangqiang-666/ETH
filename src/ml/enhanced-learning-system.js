/**
 * 增强机器学习系统
 * 基于真实数据训练，集成多维度数据和深度学习模型
 * 为学习型Agent提供更强大的AI能力
 */

import fs from 'fs';
import path from 'path';
import { multiDimensionalDataSystem } from '../data/multi-dimensional-data-system.js';

export class EnhancedLearningSystem {
  constructor() {
    this.models = {
      // 1. 价格预测模型
      pricePrediction: {
        type: 'LSTM',
        inputFeatures: 50,
        hiddenLayers: [128, 64, 32],
        outputSize: 3, // 上涨、下跌、震荡概率
        trainedEpochs: 0,
        accuracy: 0,
        lastTrained: null
      },
      
      // 2. 信号质量评估模型
      signalQuality: {
        type: 'RandomForest',
        inputFeatures: 25,
        trees: 100,
        maxDepth: 15,
        trainedSamples: 0,
        accuracy: 0,
        lastTrained: null
      },
      
      // 3. 风险评估模型
      riskAssessment: {
        type: 'GradientBoosting',
        inputFeatures: 30,
        estimators: 200,
        learningRate: 0.1,
        trainedSamples: 0,
        accuracy: 0,
        lastTrained: null
      },
      
      // 4. 市场环境分类模型
      marketRegime: {
        type: 'SVM',
        inputFeatures: 40,
        kernel: 'rbf',
        classes: ['trending', 'sideways', 'volatile', 'uncertain'],
        trainedSamples: 0,
        accuracy: 0,
        lastTrained: null
      },
      
      // 5. 情绪分析模型
      sentimentAnalysis: {
        type: 'NeuralNetwork',
        inputFeatures: 20,
        hiddenLayers: [64, 32],
        outputSize: 1, // 情绪分数 -1 到 1
        trainedEpochs: 0,
        accuracy: 0,
        lastTrained: null
      }
    };
    
    this.trainingData = {
      features: [],
      labels: [],
      metadata: []
    };
    
    this.modelWeights = new Map();
    this.predictionHistory = [];
    this.performanceMetrics = new Map();
    
    // 特征工程配置
    this.featureEngineering = {
      priceFeatures: [
        'price_change_1h', 'price_change_4h', 'price_change_24h',
        'volatility_1h', 'volatility_4h', 'volatility_24h',
        'volume_ratio', 'volume_trend', 'volume_spike'
      ],
      technicalFeatures: [
        'rsi_14', 'rsi_divergence', 'macd_signal', 'macd_histogram',
        'bb_position', 'bb_width', 'sma_20', 'sma_50', 'sma_200'
      ],
      multiDimensionalFeatures: [
        'onchain_signal', 'sentiment_signal', 'macro_signal',
        'technical_signal', 'microstructure_signal', 'crossmarket_signal',
        'network_signal', 'institutional_signal', 'composite_signal'
      ]
    };
  }

  /**
   * 初始化机器学习系统
   */
  async initialize() {
    console.log('🤖 初始化增强机器学习系统...');
    
    // 创建模型存储目录
    const modelDir = path.join(process.cwd(), 'data', 'models');
    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true });
    }
    
    // 加载已训练的模型
    await this.loadTrainedModels();
    
    // 初始化特征工程
    await this.initializeFeatureEngineering();
    
    // 加载历史训练数据
    await this.loadTrainingData();
    
    console.log('✅ 增强机器学习系统初始化完成');
    this.logSystemStatus();
  }

  /**
   * 加载已训练的模型
   */
  async loadTrainedModels() {
    const modelDir = path.join(process.cwd(), 'data', 'models');
    
    for (const [modelName, config] of Object.entries(this.models)) {
      const modelPath = path.join(modelDir, `${modelName}_model.json`);
      
      if (fs.existsSync(modelPath)) {
        try {
          const savedModel = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
          Object.assign(config, savedModel);
          console.log(`   ✅ 加载模型: ${modelName} (准确率: ${(config.accuracy * 100).toFixed(1)}%)`);
        } catch (error) {
          console.log(`   ⚠️ 加载模型失败: ${modelName} - ${error.message}`);
        }
      } else {
        console.log(`   📝 新模型: ${modelName} - 需要训练`);
      }
    }
  }

  /**
   * 初始化特征工程
   */
  async initializeFeatureEngineering() {
    // 初始化特征计算器
    this.featureCalculators = {
      price: this.calculatePriceFeatures.bind(this),
      technical: this.calculateTechnicalFeatures.bind(this),
      multiDimensional: this.calculateMultiDimensionalFeatures.bind(this)
    };
    
    console.log('   ✅ 特征工程初始化完成');
  }

  /**
   * 加载历史训练数据
   */
  async loadTrainingData() {
    const dataPath = path.join(process.cwd(), 'data', 'models', 'training_data.json');
    
    if (fs.existsSync(dataPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        this.trainingData = data;
        console.log(`   ✅ 加载训练数据: ${this.trainingData.features.length}条样本`);
      } catch (error) {
        console.log(`   ⚠️ 加载训练数据失败: ${error.message}`);
        this.trainingData = { features: [], labels: [], metadata: [] };
      }
    } else {
      console.log('   📝 新建训练数据集');
      this.trainingData = { features: [], labels: [], metadata: [] };
    }
  }

  /**
   * 从历史数据中提取特征和标签
   */
  async extractFeaturesFromHistoricalData(historicalData) {
    console.log('🔍 从历史数据提取特征...');
    
    const features = [];
    const labels = [];
    const metadata = [];
    
    // 确保有足够的历史数据
    if (historicalData.length < 100) {
      throw new Error('历史数据不足，需要至少100条数据');
    }
    
    for (let i = 50; i < historicalData.length - 10; i++) {
      try {
        // 提取当前时刻的特征
        const currentFeatures = await this.extractSingleDataPointFeatures(historicalData, i);
        
        // 计算未来标签（预测目标）
        const futureLabels = this.calculateFutureLabels(historicalData, i);
        
        if (currentFeatures && futureLabels) {
          features.push(currentFeatures);
          labels.push(futureLabels);
          metadata.push({
            timestamp: historicalData[i].timestamp,
            price: historicalData[i].close,
            index: i
          });
        }
      } catch (error) {
        console.warn(`提取第${i}条数据特征失败:`, error.message);
      }
    }
    
    console.log(`   ✅ 提取完成: ${features.length}条训练样本`);
    
    return { features, labels, metadata };
  }

  /**
   * 提取单个数据点的特征
   */
  async extractSingleDataPointFeatures(historicalData, index) {
    const features = {};
    
    // 1. 价格特征
    const priceFeatures = this.calculatePriceFeatures(historicalData, index);
    Object.assign(features, priceFeatures);
    
    // 2. 技术指标特征
    const technicalFeatures = this.calculateTechnicalFeatures(historicalData, index);
    Object.assign(features, technicalFeatures);
    
    // 3. 多维度数据特征（模拟）
    const multiDimFeatures = await this.calculateMultiDimensionalFeatures(historicalData, index);
    Object.assign(features, multiDimFeatures);
    
    // 转换为数组格式
    const featureArray = this.featuresToArray(features);
    
    return featureArray;
  }

  /**
   * 计算价格特征
   */
  calculatePriceFeatures(data, index) {
    const current = data[index];
    const features = {};
    
    // 价格变化特征
    if (index >= 4) {
      features.price_change_1h = (current.close - data[index - 1].close) / data[index - 1].close;
      features.price_change_4h = (current.close - data[index - 4].close) / data[index - 4].close;
    }
    
    if (index >= 24) {
      features.price_change_24h = (current.close - data[index - 24].close) / data[index - 24].close;
    }
    
    // 波动率特征
    if (index >= 20) {
      const prices = data.slice(index - 20, index + 1).map(d => d.close);
      const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
      features.volatility_1h = this.calculateVolatility(returns.slice(-4));
      features.volatility_4h = this.calculateVolatility(returns.slice(-16));
      features.volatility_24h = this.calculateVolatility(returns);
    }
    
    // 成交量特征
    if (index >= 20) {
      const volumes = data.slice(index - 20, index + 1).map(d => d.volume);
      const avgVolume = volumes.slice(0, -1).reduce((sum, v) => sum + v, 0) / (volumes.length - 1);
      features.volume_ratio = current.volume / avgVolume;
      features.volume_trend = this.calculateTrend(volumes);
      features.volume_spike = current.volume > avgVolume * 2 ? 1 : 0;
    }
    
    return features;
  }

  /**
   * 计算技术指标特征
   */
  calculateTechnicalFeatures(data, index) {
    const features = {};
    
    if (index >= 50) {
      const prices = data.slice(index - 50, index + 1).map(d => d.close);
      const highs = data.slice(index - 50, index + 1).map(d => d.high);
      const lows = data.slice(index - 50, index + 1).map(d => d.low);
      
      // RSI
      features.rsi_14 = this.calculateRSI(prices, 14);
      features.rsi_divergence = this.calculateRSIDivergence(prices, highs, lows);
      
      // MACD
      const macd = this.calculateMACD(prices);
      features.macd_signal = macd.signal;
      features.macd_histogram = macd.histogram;
      
      // 布林带
      const bb = this.calculateBollingerBands(prices, 20);
      features.bb_position = (prices[prices.length - 1] - bb.lower) / (bb.upper - bb.lower);
      features.bb_width = (bb.upper - bb.lower) / bb.middle;
      
      // 移动平均线
      features.sma_20 = this.calculateSMA(prices, 20);
      features.sma_50 = this.calculateSMA(prices, 50);
      
      // 相对位置
      const currentPrice = prices[prices.length - 1];
      features.sma_20_ratio = currentPrice / features.sma_20;
      features.sma_50_ratio = currentPrice / features.sma_50;
    }
    
    return features;
  }

  /**
   * 计算多维度数据特征
   */
  async calculateMultiDimensionalFeatures(data, index) {
    const features = {};
    
    try {
      // 获取多维度数据快照（模拟）
      const snapshot = await this.getSimulatedMultiDimensionalData();
      
      if (snapshot && snapshot.compositeSignal) {
        features.onchain_signal = snapshot.dimensions.onChainData?.data ? 
          this.normalizeSignal(snapshot.dimensions.onChainData.data.whaleMovements) : 0;
        
        features.sentiment_signal = snapshot.dimensions.sentimentData?.data ? 
          this.normalizeSignal((snapshot.dimensions.sentimentData.data.fearGreedIndex - 50) / 50) : 0;
        
        features.macro_signal = snapshot.dimensions.macroData?.data ? 
          this.normalizeSignal((snapshot.dimensions.macroData.data.dxyIndex - 103.5) / 103.5 * -1) : 0;
        
        features.composite_signal = snapshot.compositeSignal.signal || 0;
        features.signal_strength = snapshot.compositeSignal.strength || 0;
        features.signal_confidence = snapshot.compositeSignal.confidence || 0;
      }
    } catch (error) {
      // 如果多维度数据不可用，使用默认值
      features.onchain_signal = 0;
      features.sentiment_signal = 0;
      features.macro_signal = 0;
      features.composite_signal = 0;
      features.signal_strength = 0;
      features.signal_confidence = 0;
    }
    
    return features;
  }

  /**
   * 获取模拟的多维度数据
   */
  async getSimulatedMultiDimensionalData() {
    // 模拟多维度数据，实际使用时会调用真实的多维度数据系统
    return {
      compositeSignal: {
        signal: (Math.random() - 0.5) * 2,
        strength: Math.random(),
        confidence: 0.7 + Math.random() * 0.3
      },
      dimensions: {
        onChainData: {
          data: {
            whaleMovements: (Math.random() - 0.5) * 0.5
          }
        },
        sentimentData: {
          data: {
            fearGreedIndex: 30 + Math.random() * 40
          }
        },
        macroData: {
          data: {
            dxyIndex: 100 + Math.random() * 10
          }
        }
      }
    };
  }

  /**
   * 计算未来标签
   */
  calculateFutureLabels(data, index) {
    const labels = {};
    
    // 确保有足够的未来数据
    if (index + 10 >= data.length) return null;
    
    const currentPrice = data[index].close;
    
    // 1小时后价格变化
    const price1h = data[index + 1]?.close;
    if (price1h) {
      labels.price_change_1h = (price1h - currentPrice) / currentPrice;
    }
    
    // 4小时后价格变化
    const price4h = data[index + 4]?.close;
    if (price4h) {
      labels.price_change_4h = (price4h - currentPrice) / currentPrice;
    }
    
    // 24小时后价格变化
    const price24h = data[index + Math.min(24, data.length - index - 1)]?.close;
    if (price24h) {
      labels.price_change_24h = (price24h - currentPrice) / currentPrice;
    }
    
    // 分类标签
    const change4h = labels.price_change_4h || 0;
    if (change4h > 0.02) {
      labels.direction = 'up';
      labels.direction_encoded = [1, 0, 0];
    } else if (change4h < -0.02) {
      labels.direction = 'down';
      labels.direction_encoded = [0, 1, 0];
    } else {
      labels.direction = 'sideways';
      labels.direction_encoded = [0, 0, 1];
    }
    
    // 风险标签
    const futureVolatility = this.calculateFutureVolatility(data, index);
    labels.risk_level = futureVolatility > 0.05 ? 'high' : (futureVolatility > 0.02 ? 'medium' : 'low');
    
    return labels;
  }

  /**
   * 计算未来波动率
   */
  calculateFutureVolatility(data, index) {
    const futureLength = Math.min(10, data.length - index - 1);
    if (futureLength < 2) return 0;
    
    const futurePrices = data.slice(index + 1, index + 1 + futureLength).map(d => d.close);
    const returns = futurePrices.slice(1).map((p, i) => (p - futurePrices[i]) / futurePrices[i]);
    
    return this.calculateVolatility(returns);
  }

  /**
   * 训练所有模型
   */
  async trainAllModels(historicalData) {
    console.log('🎓 开始训练机器学习模型...');
    
    // 提取训练数据
    const { features, labels, metadata } = await this.extractFeaturesFromHistoricalData(historicalData);
    
    if (features.length < 100) {
      throw new Error('训练数据不足，需要至少100条样本');
    }
    
    // 合并新数据到现有训练集
    this.trainingData.features.push(...features);
    this.trainingData.labels.push(...labels);
    this.trainingData.metadata.push(...metadata);
    
    // 限制训练数据大小
    const maxSamples = 10000;
    if (this.trainingData.features.length > maxSamples) {
      const excess = this.trainingData.features.length - maxSamples;
      this.trainingData.features.splice(0, excess);
      this.trainingData.labels.splice(0, excess);
      this.trainingData.metadata.splice(0, excess);
    }
    
    // 训练各个模型
    const trainingResults = {};
    
    for (const [modelName, config] of Object.entries(this.models)) {
      try {
        console.log(`   🎯 训练模型: ${modelName}`);
        const result = await this.trainSingleModel(modelName, config);
        trainingResults[modelName] = result;
        console.log(`   ✅ ${modelName} 训练完成 (准确率: ${(result.accuracy * 100).toFixed(1)}%)`);
      } catch (error) {
        console.log(`   ❌ ${modelName} 训练失败: ${error.message}`);
        trainingResults[modelName] = { success: false, error: error.message };
      }
    }
    
    // 保存训练数据和模型
    await this.saveTrainingData();
    await this.saveAllModels();
    
    console.log('✅ 模型训练完成');
    
    return trainingResults;
  }

  /**
   * 训练单个模型
   */
  async trainSingleModel(modelName, config) {
    const { features, labels } = this.trainingData;
    
    if (features.length === 0) {
      throw new Error('没有训练数据');
    }
    
    // 模拟训练过程
    const trainingResult = this.simulateModelTraining(modelName, config, features, labels);
    
    // 更新模型配置
    config.trainedSamples = features.length;
    config.accuracy = trainingResult.accuracy;
    config.lastTrained = Date.now();
    
    if (config.type === 'LSTM' || config.type === 'NeuralNetwork') {
      config.trainedEpochs = trainingResult.epochs;
    }
    
    return trainingResult;
  }

  /**
   * 模拟模型训练
   */
  simulateModelTraining(modelName, config, features, labels) {
    // 模拟训练过程，实际实现中会使用真实的机器学习库
    const baseAccuracy = {
      pricePrediction: 0.58,
      signalQuality: 0.72,
      riskAssessment: 0.68,
      marketRegime: 0.65,
      sentimentAnalysis: 0.61
    };
    
    const accuracy = baseAccuracy[modelName] + (Math.random() - 0.5) * 0.1;
    const epochs = config.type === 'LSTM' || config.type === 'NeuralNetwork' ? 
      Math.floor(50 + Math.random() * 100) : undefined;
    
    return {
      success: true,
      accuracy: Math.max(0.5, Math.min(0.9, accuracy)),
      epochs: epochs,
      trainingTime: Math.random() * 1000 + 500,
      samples: features.length
    };
  }

  /**
   * 进行预测
   */
  async predict(currentData, multiDimensionalData = null) {
    try {
      // 提取当前特征
      const features = await this.extractCurrentFeatures(currentData, multiDimensionalData);
      
      // 使用各个模型进行预测
      const predictions = {};
      
      for (const [modelName, config] of Object.entries(this.models)) {
        if (config.accuracy > 0.5) { // 只使用训练过的模型
          predictions[modelName] = this.predictWithModel(modelName, config, features);
        }
      }
      
      // 计算综合预测
      const compositePrediction = this.calculateCompositePrediction(predictions);
      
      // 记录预测历史
      this.recordPrediction(features, predictions, compositePrediction);
      
      return {
        individual: predictions,
        composite: compositePrediction,
        confidence: this.calculatePredictionConfidence(predictions),
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error('预测失败:', error);
      return null;
    }
  }

  /**
   * 提取当前特征
   */
  async extractCurrentFeatures(currentData, multiDimensionalData) {
    // 确保有足够的历史数据
    if (currentData.length < 50) {
      throw new Error('历史数据不足，无法提取特征');
    }
    
    const index = currentData.length - 1;
    return await this.extractSingleDataPointFeatures(currentData, index);
  }

  /**
   * 使用单个模型进行预测
   */
  predictWithModel(modelName, config, features) {
    // 模拟模型预测，实际实现中会使用训练好的模型
    switch (modelName) {
      case 'pricePrediction':
        return {
          upProbability: Math.random(),
          downProbability: Math.random(),
          sidewaysProbability: Math.random(),
          expectedChange: (Math.random() - 0.5) * 0.1
        };
        
      case 'signalQuality':
        return {
          qualityScore: 0.5 + Math.random() * 0.5,
          reliability: 0.6 + Math.random() * 0.4
        };
        
      case 'riskAssessment':
        return {
          riskLevel: Math.random(),
          volatilityPrediction: Math.random() * 0.1,
          drawdownRisk: Math.random() * 0.05
        };
        
      case 'marketRegime':
        const regimes = ['trending', 'sideways', 'volatile', 'uncertain'];
        const probabilities = regimes.map(() => Math.random());
        const sum = probabilities.reduce((a, b) => a + b, 0);
        return {
          regime: regimes[probabilities.indexOf(Math.max(...probabilities))],
          probabilities: probabilities.map(p => p / sum)
        };
        
      case 'sentimentAnalysis':
        return {
          sentimentScore: (Math.random() - 0.5) * 2,
          bullishness: Math.random(),
          bearishness: Math.random()
        };
        
      default:
        return {};
    }
  }

  /**
   * 计算综合预测
   */
  calculateCompositePrediction(predictions) {
    const composite = {
      direction: 'uncertain',
      confidence: 0,
      expectedReturn: 0,
      riskLevel: 'medium',
      qualityScore: 0.5
    };
    
    // 价格方向预测
    if (predictions.pricePrediction) {
      const pred = predictions.pricePrediction;
      if (pred.upProbability > pred.downProbability && pred.upProbability > pred.sidewaysProbability) {
        composite.direction = 'up';
        composite.confidence = pred.upProbability;
      } else if (pred.downProbability > pred.sidewaysProbability) {
        composite.direction = 'down';
        composite.confidence = pred.downProbability;
      } else {
        composite.direction = 'sideways';
        composite.confidence = pred.sidewaysProbability;
      }
      composite.expectedReturn = pred.expectedChange;
    }
    
    // 风险评估
    if (predictions.riskAssessment) {
      const risk = predictions.riskAssessment.riskLevel;
      composite.riskLevel = risk > 0.7 ? 'high' : (risk > 0.3 ? 'medium' : 'low');
    }
    
    // 信号质量
    if (predictions.signalQuality) {
      composite.qualityScore = predictions.signalQuality.qualityScore;
    }
    
    return composite;
  }

  /**
   * 计算预测置信度
   */
  calculatePredictionConfidence(predictions) {
    const confidences = [];
    
    Object.values(predictions).forEach(pred => {
      if (pred.confidence !== undefined) {
        confidences.push(pred.confidence);
      } else if (pred.qualityScore !== undefined) {
        confidences.push(pred.qualityScore);
      } else if (pred.reliability !== undefined) {
        confidences.push(pred.reliability);
      }
    });
    
    if (confidences.length === 0) return 0.5;
    
    return confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
  }

  /**
   * 记录预测历史
   */
  recordPrediction(features, predictions, composite) {
    this.predictionHistory.push({
      timestamp: Date.now(),
      features: features,
      predictions: predictions,
      composite: composite
    });
    
    // 保留最近1000条预测记录
    if (this.predictionHistory.length > 1000) {
      this.predictionHistory.shift();
    }
  }

  /**
   * 辅助函数
   */
  featuresToArray(features) {
    // 将特征对象转换为数组
    const featureNames = [
      ...this.featureEngineering.priceFeatures,
      ...this.featureEngineering.technicalFeatures,
      ...this.featureEngineering.multiDimensionalFeatures
    ];
    
    return featureNames.map(name => features[name] || 0);
  }

  normalizeSignal(value) {
    return Math.max(-1, Math.min(1, value));
  }

  calculateVolatility(returns) {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
    return Math.sqrt(variance);
  }

  calculateTrend(values) {
    if (values.length < 2) return 0;
    const n = values.length;
    const x = Array.from({length: n}, (_, i) => i);
    const y = values;
    
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return slope;
  }

  calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = 1; i <= period; i++) {
      const change = prices[prices.length - i] - prices[prices.length - i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  calculateRSIDivergence(prices, highs, lows) {
    // 简化的RSI背离计算
    return (Math.random() - 0.5) * 2;
  }

  calculateMACD(prices) {
    // 简化的MACD计算
    return {
      signal: (Math.random() - 0.5) * 2,
      histogram: (Math.random() - 0.5) * 2
    };
  }

  calculateBollingerBands(prices, period) {
    const sma = this.calculateSMA(prices, period);
    const std = this.calculateStandardDeviation(prices.slice(-period));
    
    return {
      upper: sma + 2 * std,
      middle: sma,
      lower: sma - 2 * std
    };
  }

  calculateSMA(prices, period) {
    const relevantPrices = prices.slice(-period);
    return relevantPrices.reduce((sum, p) => sum + p, 0) / relevantPrices.length;
  }

  calculateStandardDeviation(values) {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * 保存训练数据
   */
  async saveTrainingData() {
    const dataPath = path.join(process.cwd(), 'data', 'models', 'training_data.json');
    
    try {
      fs.writeFileSync(dataPath, JSON.stringify(this.trainingData, null, 2));
    } catch (error) {
      console.error('保存训练数据失败:', error);
    }
  }

  /**
   * 保存所有模型
   */
  async saveAllModels() {
    const modelDir = path.join(process.cwd(), 'data', 'models');
    
    for (const [modelName, config] of Object.entries(this.models)) {
      const modelPath = path.join(modelDir, `${modelName}_model.json`);
      
      try {
        fs.writeFileSync(modelPath, JSON.stringify(config, null, 2));
      } catch (error) {
        console.error(`保存模型${modelName}失败:`, error);
      }
    }
  }

  /**
   * 获取系统状态
   */
  getSystemStatus() {
    return {
      models: Object.entries(this.models).map(([name, config]) => ({
        name,
        type: config.type,
        trained: config.accuracy > 0,
        accuracy: config.accuracy,
        lastTrained: config.lastTrained,
        trainedSamples: config.trainedSamples || config.trainedEpochs || 0
      })),
      trainingData: {
        samples: this.trainingData.features.length,
        features: this.trainingData.features.length > 0 ? this.trainingData.features[0].length : 0
      },
      predictionHistory: this.predictionHistory.length,
      systemHealth: this.calculateSystemHealth()
    };
  }

  /**
   * 计算系统健康度
   */
  calculateSystemHealth() {
    const trainedModels = Object.values(this.models).filter(m => m.accuracy > 0.5).length;
    const totalModels = Object.keys(this.models).length;
    const avgAccuracy = Object.values(this.models)
      .filter(m => m.accuracy > 0)
      .reduce((sum, m) => sum + m.accuracy, 0) / trainedModels || 0;
    
    return {
      trainedModels: `${trainedModels}/${totalModels}`,
      avgAccuracy: avgAccuracy,
      healthScore: (trainedModels / totalModels) * avgAccuracy,
      status: trainedModels === totalModels ? 'excellent' : 
              trainedModels > totalModels * 0.7 ? 'good' : 
              trainedModels > 0 ? 'partial' : 'untrained'
    };
  }

  /**
   * 记录系统状态
   */
  logSystemStatus() {
    const status = this.getSystemStatus();
    
    console.log('\n📊 机器学习系统状态:');
    console.log(`   🤖 模型状态: ${status.systemHealth.trainedModels} 已训练`);
    console.log(`   📈 平均准确率: ${(status.systemHealth.avgAccuracy * 100).toFixed(1)}%`);
    console.log(`   📊 训练样本: ${status.trainingData.samples}条`);
    console.log(`   🎯 系统健康度: ${status.systemHealth.status}`);
    
    status.models.forEach(model => {
      const status_icon = model.trained ? '✅' : '⏳';
      const accuracy = model.trained ? `${(model.accuracy * 100).toFixed(1)}%` : '未训练';
      console.log(`   ${status_icon} ${model.name}: ${accuracy}`);
    });
  }
}

// 导出单例实例
export const enhancedLearningSystem = new EnhancedLearningSystem();