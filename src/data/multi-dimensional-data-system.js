/**
 * 9维数据系统集成模块
 * 整合链上、情绪、宏观等多维度数据源
 * 为学习型Agent提供更丰富的数据支持
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';

export class MultiDimensionalDataSystem {
  constructor() {
    this.dataSources = {
      // 1. 价格数据 (已有)
      priceData: {
        enabled: true,
        weight: 0.25,
        source: 'binance',
        updateInterval: 15 * 60 * 1000 // 15分钟
      },
      
      // 2. 链上数据
      onChainData: {
        enabled: true,
        weight: 0.15,
        sources: {
          etherscan: 'https://api.etherscan.io/api',
          glassnode: 'https://api.glassnode.com/v1/metrics',
          dune: 'https://api.dune.com/api/v1'
        },
        metrics: [
          'active_addresses',
          'transaction_count',
          'gas_usage',
          'whale_movements',
          'exchange_flows',
          'staking_ratio'
        ]
      },
      
      // 3. 情绪数据
      sentimentData: {
        enabled: true,
        weight: 0.12,
        sources: {
          fearGreed: 'https://api.alternative.me/fng/',
          socialSentiment: 'https://api.lunarcrush.com/v2',
          newsAnalysis: 'https://newsapi.org/v2/everything'
        },
        metrics: [
          'fear_greed_index',
          'social_volume',
          'social_sentiment',
          'news_sentiment',
          'reddit_mentions',
          'twitter_sentiment'
        ]
      },
      
      // 4. 宏观经济数据
      macroData: {
        enabled: true,
        weight: 0.10,
        sources: {
          fred: 'https://api.stlouisfed.org/fred/series',
          tradingeconomics: 'https://api.tradingeconomics.com',
          yahoo: 'https://query1.finance.yahoo.com/v8/finance/chart'
        },
        metrics: [
          'dxy_index',
          'gold_price',
          'sp500_index',
          'vix_volatility',
          'us_10y_yield',
          'inflation_rate'
        ]
      },
      
      // 5. 技术指标数据
      technicalData: {
        enabled: true,
        weight: 0.15,
        metrics: [
          'rsi_divergence',
          'macd_signals',
          'bollinger_bands',
          'volume_profile',
          'support_resistance',
          'fibonacci_levels'
        ]
      },
      
      // 6. 市场微观结构
      microstructureData: {
        enabled: true,
        weight: 0.08,
        sources: {
          orderbook: 'binance_websocket',
          trades: 'binance_trades_stream'
        },
        metrics: [
          'bid_ask_spread',
          'order_book_imbalance',
          'large_order_flow',
          'market_impact',
          'liquidity_depth',
          'trade_size_distribution'
        ]
      },
      
      // 7. 跨市场数据
      crossMarketData: {
        enabled: true,
        weight: 0.07,
        sources: {
          futures: 'binance_futures',
          options: 'deribit',
          perpetual: 'bybit'
        },
        metrics: [
          'futures_basis',
          'funding_rates',
          'options_flow',
          'put_call_ratio',
          'open_interest',
          'cross_exchange_arbitrage'
        ]
      },
      
      // 8. 网络活动数据
      networkData: {
        enabled: true,
        weight: 0.05,
        sources: {
          github: 'https://api.github.com',
          defi: 'https://api.defipulse.com',
          nft: 'https://api.opensea.io'
        },
        metrics: [
          'developer_activity',
          'defi_tvl',
          'nft_volume',
          'protocol_usage',
          'network_growth',
          'ecosystem_health'
        ]
      },
      
      // 9. 机构数据
      institutionalData: {
        enabled: true,
        weight: 0.03,
        sources: {
          grayscale: 'public_filings',
          microstrategy: 'earnings_reports',
          etf_flows: 'sec_filings'
        },
        metrics: [
          'institutional_flows',
          'etf_holdings',
          'corporate_adoption',
          'regulatory_sentiment',
          'institutional_sentiment',
          'custody_growth'
        ]
      }
    };
    
    this.cache = new Map();
    this.lastUpdate = new Map();
    this.dataHistory = new Map();
  }

  /**
   * 初始化数据系统
   */
  async initialize() {
    console.log('🚀 初始化9维数据系统...');
    
    // 创建数据存储目录
    const dataDir = path.join(process.cwd(), 'data', 'multi-dimensional');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // 初始化各数据源
    for (const [sourceName, config] of Object.entries(this.dataSources)) {
      if (config.enabled) {
        try {
          await this.initializeDataSource(sourceName, config);
          console.log(`   ✅ ${sourceName} 数据源初始化成功`);
        } catch (error) {
          console.log(`   ⚠️ ${sourceName} 数据源初始化失败: ${error.message}`);
        }
      }
    }
    
    console.log('✅ 9维数据系统初始化完成');
  }

  /**
   * 初始化单个数据源
   */
  async initializeDataSource(sourceName, config) {
    switch (sourceName) {
      case 'onChainData':
        await this.initializeOnChainData(config);
        break;
      case 'sentimentData':
        await this.initializeSentimentData(config);
        break;
      case 'macroData':
        await this.initializeMacroData(config);
        break;
      case 'technicalData':
        await this.initializeTechnicalData(config);
        break;
      case 'microstructureData':
        await this.initializeMicrostructureData(config);
        break;
      case 'crossMarketData':
        await this.initializeCrossMarketData(config);
        break;
      case 'networkData':
        await this.initializeNetworkData(config);
        break;
      case 'institutionalData':
        await this.initializeInstitutionalData(config);
        break;
    }
  }

  /**
   * 获取综合数据快照
   */
  async getDataSnapshot() {
    const snapshot = {
      timestamp: Date.now(),
      dimensions: {}
    };
    
    for (const [sourceName, config] of Object.entries(this.dataSources)) {
      if (config.enabled) {
        try {
          const data = await this.getDataFromSource(sourceName);
          snapshot.dimensions[sourceName] = {
            data: data,
            weight: config.weight,
            quality: this.assessDataQuality(data),
            lastUpdate: this.lastUpdate.get(sourceName)
          };
        } catch (error) {
          console.warn(`获取${sourceName}数据失败:`, error.message);
          snapshot.dimensions[sourceName] = {
            data: null,
            weight: config.weight,
            quality: 0,
            error: error.message
          };
        }
      }
    }
    
    // 计算综合信号
    snapshot.compositeSignal = this.calculateCompositeSignal(snapshot.dimensions);
    
    return snapshot;
  }

  /**
   * 链上数据获取
   */
  async initializeOnChainData(config) {
    // 模拟链上数据初始化
    this.cache.set('onChainData', {
      activeAddresses: 650000,
      transactionCount: 1200000,
      gasUsage: 85,
      whaleMovements: 0.15,
      exchangeFlows: -0.08,
      stakingRatio: 0.22
    });
  }

  async getOnChainData() {
    // 实际实现中会调用真实API
    const mockData = {
      activeAddresses: 650000 + Math.random() * 50000,
      transactionCount: 1200000 + Math.random() * 200000,
      gasUsage: 85 + Math.random() * 30,
      whaleMovements: (Math.random() - 0.5) * 0.5,
      exchangeFlows: (Math.random() - 0.5) * 0.3,
      stakingRatio: 0.22 + Math.random() * 0.05,
      timestamp: Date.now()
    };
    
    this.cache.set('onChainData', mockData);
    this.lastUpdate.set('onChainData', Date.now());
    
    return mockData;
  }

  /**
   * 情绪数据获取
   */
  async initializeSentimentData(config) {
    this.cache.set('sentimentData', {
      fearGreedIndex: 45,
      socialVolume: 0.75,
      socialSentiment: 0.6,
      newsSentiment: 0.55,
      redditMentions: 850,
      twitterSentiment: 0.62
    });
  }

  async getSentimentData() {
    const mockData = {
      fearGreedIndex: 45 + Math.random() * 50,
      socialVolume: 0.5 + Math.random() * 0.5,
      socialSentiment: 0.3 + Math.random() * 0.7,
      newsSentiment: 0.3 + Math.random() * 0.7,
      redditMentions: 500 + Math.random() * 1000,
      twitterSentiment: 0.3 + Math.random() * 0.7,
      timestamp: Date.now()
    };
    
    this.cache.set('sentimentData', mockData);
    this.lastUpdate.set('sentimentData', Date.now());
    
    return mockData;
  }

  /**
   * 宏观经济数据获取
   */
  async initializeMacroData(config) {
    this.cache.set('macroData', {
      dxyIndex: 103.5,
      goldPrice: 1950,
      sp500Index: 4200,
      vixVolatility: 18.5,
      us10yYield: 4.2,
      inflationRate: 3.1
    });
  }

  async getMacroData() {
    const mockData = {
      dxyIndex: 103.5 + (Math.random() - 0.5) * 5,
      goldPrice: 1950 + (Math.random() - 0.5) * 100,
      sp500Index: 4200 + (Math.random() - 0.5) * 200,
      vixVolatility: 18.5 + (Math.random() - 0.5) * 10,
      us10yYield: 4.2 + (Math.random() - 0.5) * 1,
      inflationRate: 3.1 + (Math.random() - 0.5) * 0.5,
      timestamp: Date.now()
    };
    
    this.cache.set('macroData', mockData);
    this.lastUpdate.set('macroData', Date.now());
    
    return mockData;
  }

  /**
   * 技术指标数据
   */
  async initializeTechnicalData(config) {
    this.cache.set('technicalData', {
      rsiDivergence: 0,
      macdSignals: 0.1,
      bollingerBands: 0.3,
      volumeProfile: 0.6,
      supportResistance: 0.8,
      fibonacciLevels: 0.4
    });
  }

  async getTechnicalData() {
    const mockData = {
      rsiDivergence: (Math.random() - 0.5) * 2,
      macdSignals: (Math.random() - 0.5) * 2,
      bollingerBands: Math.random(),
      volumeProfile: Math.random(),
      supportResistance: Math.random(),
      fibonacciLevels: Math.random(),
      timestamp: Date.now()
    };
    
    this.cache.set('technicalData', mockData);
    this.lastUpdate.set('technicalData', Date.now());
    
    return mockData;
  }

  /**
   * 市场微观结构数据
   */
  async initializeMicrostructureData(config) {
    this.cache.set('microstructureData', {
      bidAskSpread: 0.02,
      orderBookImbalance: 0.15,
      largeOrderFlow: 0.3,
      marketImpact: 0.05,
      liquidityDepth: 0.8,
      tradeSizeDistribution: 0.6
    });
  }

  async getMicrostructureData() {
    const mockData = {
      bidAskSpread: 0.01 + Math.random() * 0.05,
      orderBookImbalance: (Math.random() - 0.5) * 0.8,
      largeOrderFlow: Math.random(),
      marketImpact: Math.random() * 0.1,
      liquidityDepth: 0.5 + Math.random() * 0.5,
      tradeSizeDistribution: Math.random(),
      timestamp: Date.now()
    };
    
    this.cache.set('microstructureData', mockData);
    this.lastUpdate.set('microstructureData', Date.now());
    
    return mockData;
  }

  /**
   * 跨市场数据
   */
  async initializeCrossMarketData(config) {
    this.cache.set('crossMarketData', {
      futuresBasis: 0.05,
      fundingRates: 0.01,
      optionsFlow: 0.3,
      putCallRatio: 0.8,
      openInterest: 0.6,
      crossExchangeArbitrage: 0.02
    });
  }

  async getCrossMarketData() {
    const mockData = {
      futuresBasis: (Math.random() - 0.5) * 0.2,
      fundingRates: (Math.random() - 0.5) * 0.05,
      optionsFlow: Math.random(),
      putCallRatio: 0.5 + Math.random() * 1,
      openInterest: Math.random(),
      crossExchangeArbitrage: (Math.random() - 0.5) * 0.1,
      timestamp: Date.now()
    };
    
    this.cache.set('crossMarketData', mockData);
    this.lastUpdate.set('crossMarketData', Date.now());
    
    return mockData;
  }

  /**
   * 网络活动数据
   */
  async initializeNetworkData(config) {
    this.cache.set('networkData', {
      developerActivity: 0.7,
      defiTvl: 45000000000,
      nftVolume: 150000000,
      protocolUsage: 0.8,
      networkGrowth: 0.15,
      ecosystemHealth: 0.75
    });
  }

  async getNetworkData() {
    const mockData = {
      developerActivity: 0.5 + Math.random() * 0.5,
      defiTvl: 45000000000 + (Math.random() - 0.5) * 10000000000,
      nftVolume: 150000000 + (Math.random() - 0.5) * 50000000,
      protocolUsage: 0.5 + Math.random() * 0.5,
      networkGrowth: (Math.random() - 0.3) * 0.5,
      ecosystemHealth: 0.5 + Math.random() * 0.5,
      timestamp: Date.now()
    };
    
    this.cache.set('networkData', mockData);
    this.lastUpdate.set('networkData', Date.now());
    
    return mockData;
  }

  /**
   * 机构数据
   */
  async initializeInstitutionalData(config) {
    this.cache.set('institutionalData', {
      institutionalFlows: 0.1,
      etfHoldings: 850000,
      corporateAdoption: 0.3,
      regulatorySentiment: 0.6,
      institutionalSentiment: 0.65,
      custodyGrowth: 0.2
    });
  }

  async getInstitutionalData() {
    const mockData = {
      institutionalFlows: (Math.random() - 0.5) * 0.5,
      etfHoldings: 850000 + (Math.random() - 0.5) * 100000,
      corporateAdoption: 0.2 + Math.random() * 0.6,
      regulatorySentiment: 0.3 + Math.random() * 0.7,
      institutionalSentiment: 0.3 + Math.random() * 0.7,
      custodyGrowth: Math.random() * 0.5,
      timestamp: Date.now()
    };
    
    this.cache.set('institutionalData', mockData);
    this.lastUpdate.set('institutionalData', Date.now());
    
    return mockData;
  }

  /**
   * 从指定数据源获取数据
   */
  async getDataFromSource(sourceName) {
    switch (sourceName) {
      case 'onChainData':
        return await this.getOnChainData();
      case 'sentimentData':
        return await this.getSentimentData();
      case 'macroData':
        return await this.getMacroData();
      case 'technicalData':
        return await this.getTechnicalData();
      case 'microstructureData':
        return await this.getMicrostructureData();
      case 'crossMarketData':
        return await this.getCrossMarketData();
      case 'networkData':
        return await this.getNetworkData();
      case 'institutionalData':
        return await this.getInstitutionalData();
      default:
        throw new Error(`未知数据源: ${sourceName}`);
    }
  }

  /**
   * 评估数据质量
   */
  assessDataQuality(data) {
    if (!data || typeof data !== 'object') return 0;
    
    let quality = 1.0;
    const now = Date.now();
    
    // 检查数据新鲜度
    if (data.timestamp) {
      const age = now - data.timestamp;
      if (age > 60 * 60 * 1000) { // 1小时
        quality *= 0.8;
      } else if (age > 30 * 60 * 1000) { // 30分钟
        quality *= 0.9;
      }
    }
    
    // 检查数据完整性
    const dataKeys = Object.keys(data).filter(key => key !== 'timestamp');
    const nullValues = dataKeys.filter(key => data[key] == null).length;
    quality *= (1 - nullValues / dataKeys.length);
    
    return Math.max(0, Math.min(1, quality));
  }

  /**
   * 计算综合信号
   */
  calculateCompositeSignal(dimensions) {
    let weightedSum = 0;
    let totalWeight = 0;
    let signalStrength = 0;
    
    for (const [sourceName, dimension] of Object.entries(dimensions)) {
      if (dimension.data && dimension.quality > 0.5) {
        const sourceConfig = this.dataSources[sourceName];
        const adjustedWeight = sourceConfig.weight * dimension.quality;
        
        // 计算该维度的信号强度
        const dimensionSignal = this.calculateDimensionSignal(sourceName, dimension.data);
        
        weightedSum += dimensionSignal * adjustedWeight;
        totalWeight += adjustedWeight;
        signalStrength += Math.abs(dimensionSignal) * adjustedWeight;
      }
    }
    
    const compositeSignal = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const normalizedStrength = totalWeight > 0 ? signalStrength / totalWeight : 0;
    
    return {
      signal: compositeSignal,
      strength: normalizedStrength,
      confidence: Math.min(totalWeight / 0.8, 1), // 假设80%权重为满信心
      dimensions: Object.keys(dimensions).length,
      qualityScore: this.calculateOverallQuality(dimensions)
    };
  }

  /**
   * 计算单个维度信号
   */
  calculateDimensionSignal(sourceName, data) {
    switch (sourceName) {
      case 'onChainData':
        return this.calculateOnChainSignal(data);
      case 'sentimentData':
        return this.calculateSentimentSignal(data);
      case 'macroData':
        return this.calculateMacroSignal(data);
      case 'technicalData':
        return this.calculateTechnicalSignal(data);
      case 'microstructureData':
        return this.calculateMicrostructureSignal(data);
      case 'crossMarketData':
        return this.calculateCrossMarketSignal(data);
      case 'networkData':
        return this.calculateNetworkSignal(data);
      case 'institutionalData':
        return this.calculateInstitutionalSignal(data);
      default:
        return 0;
    }
  }

  calculateOnChainSignal(data) {
    // 链上数据信号计算
    let signal = 0;
    signal += (data.whaleMovements || 0) * 0.3;
    signal += (data.exchangeFlows || 0) * 0.3;
    signal += ((data.stakingRatio || 0.2) - 0.2) * 2 * 0.2;
    signal += ((data.activeAddresses || 650000) - 650000) / 650000 * 0.2;
    return Math.max(-1, Math.min(1, signal));
  }

  calculateSentimentSignal(data) {
    // 情绪数据信号计算
    let signal = 0;
    signal += ((data.fearGreedIndex || 50) - 50) / 50 * 0.4;
    signal += ((data.socialSentiment || 0.5) - 0.5) * 2 * 0.3;
    signal += ((data.newsSentiment || 0.5) - 0.5) * 2 * 0.3;
    return Math.max(-1, Math.min(1, signal));
  }

  calculateMacroSignal(data) {
    // 宏观经济信号计算
    let signal = 0;
    signal += ((data.dxyIndex || 103.5) - 103.5) / 103.5 * -0.3; // DXY上涨对ETH负面
    signal += ((data.goldPrice || 1950) - 1950) / 1950 * 0.2; // 黄金上涨对ETH正面
    signal += ((data.vixVolatility || 18.5) - 18.5) / 18.5 * -0.3; // VIX上涨对ETH负面
    signal += ((data.sp500Index || 4200) - 4200) / 4200 * 0.2; // 股市上涨对ETH正面
    return Math.max(-1, Math.min(1, signal));
  }

  calculateTechnicalSignal(data) {
    // 技术指标信号计算
    let signal = 0;
    signal += (data.rsiDivergence || 0) * 0.2;
    signal += (data.macdSignals || 0) * 0.3;
    signal += ((data.supportResistance || 0.5) - 0.5) * 2 * 0.3;
    signal += ((data.volumeProfile || 0.5) - 0.5) * 2 * 0.2;
    return Math.max(-1, Math.min(1, signal));
  }

  calculateMicrostructureSignal(data) {
    // 微观结构信号计算
    let signal = 0;
    signal += (data.orderBookImbalance || 0) * 0.4;
    signal += ((data.liquidityDepth || 0.8) - 0.8) / 0.2 * 0.3;
    signal += (data.largeOrderFlow || 0) * 0.3;
    return Math.max(-1, Math.min(1, signal));
  }

  calculateCrossMarketSignal(data) {
    // 跨市场信号计算
    let signal = 0;
    signal += (data.futuresBasis || 0) * 2 * 0.3; // 基差
    signal += (data.fundingRates || 0) * 10 * 0.4; // 资金费率
    signal += ((data.putCallRatio || 0.8) - 0.8) / 0.8 * -0.3; // 看跌看涨比
    return Math.max(-1, Math.min(1, signal));
  }

  calculateNetworkSignal(data) {
    // 网络活动信号计算
    let signal = 0;
    signal += ((data.developerActivity || 0.7) - 0.7) / 0.3 * 0.3;
    signal += (data.networkGrowth || 0) * 2 * 0.4;
    signal += ((data.ecosystemHealth || 0.75) - 0.75) / 0.25 * 0.3;
    return Math.max(-1, Math.min(1, signal));
  }

  calculateInstitutionalSignal(data) {
    // 机构数据信号计算
    let signal = 0;
    signal += (data.institutionalFlows || 0) * 2 * 0.4;
    signal += ((data.institutionalSentiment || 0.65) - 0.65) / 0.35 * 0.3;
    signal += (data.custodyGrowth || 0) * 2 * 0.3;
    return Math.max(-1, Math.min(1, signal));
  }

  /**
   * 计算整体数据质量
   */
  calculateOverallQuality(dimensions) {
    const qualities = Object.values(dimensions)
      .filter(d => d.quality !== undefined)
      .map(d => d.quality);
    
    if (qualities.length === 0) return 0;
    
    return qualities.reduce((sum, q) => sum + q, 0) / qualities.length;
  }

  /**
   * 保存数据快照
   */
  async saveDataSnapshot(snapshot) {
    const filename = `data_snapshot_${Date.now()}.json`;
    const filepath = path.join(process.cwd(), 'data', 'multi-dimensional', filename);
    
    try {
      fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));
      
      // 保留最近100个快照
      this.cleanupOldSnapshots();
      
      return filepath;
    } catch (error) {
      console.error('保存数据快照失败:', error);
      throw error;
    }
  }

  /**
   * 清理旧快照
   */
  cleanupOldSnapshots() {
    const dataDir = path.join(process.cwd(), 'data', 'multi-dimensional');
    if (!fs.existsSync(dataDir)) return;
    
    const files = fs.readdirSync(dataDir)
      .filter(file => file.startsWith('data_snapshot_'))
      .map(file => ({
        name: file,
        path: path.join(dataDir, file),
        time: fs.statSync(path.join(dataDir, file)).mtime
      }))
      .sort((a, b) => b.time - a.time);
    
    // 保留最新的100个文件
    if (files.length > 100) {
      files.slice(100).forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (error) {
          console.warn('删除旧快照失败:', error.message);
        }
      });
    }
  }

  /**
   * 获取数据源状态
   */
  getDataSourceStatus() {
    const status = {};
    
    for (const [sourceName, config] of Object.entries(this.dataSources)) {
      status[sourceName] = {
        enabled: config.enabled,
        weight: config.weight,
        lastUpdate: this.lastUpdate.get(sourceName),
        hasData: this.cache.has(sourceName),
        dataQuality: this.cache.has(sourceName) ? 
          this.assessDataQuality(this.cache.get(sourceName)) : 0
      };
    }
    
    return status;
  }
}

// 导出单例实例
export const multiDimensionalDataSystem = new MultiDimensionalDataSystem();