import { EventEmitter } from 'events';
import { dataAggregatorService, AggregatedData } from './data-aggregator-service.js';
import { onchainDataService } from './onchain-data-service.js';
import { macroEconomicDataService } from './macro-economic-data-service.js';
import { multiExchangeDataService } from './multi-exchange-data-service.js';
import { socialSentimentDataService } from './social-sentiment-data-service.js';
import { whaleMonitoringService } from './whale-monitoring-service.js';
import { optionsDataService } from './options-data-service.js';
import { defiDataService } from './defi-data-service.js';
import { enhancedOKXDataService } from './enhanced-okx-data-service.js';
import { dataQualityManager, DataSourceQuality } from '../utils/data-quality-manager.js';
import { config } from '../config.js';

/**
 * 增强的市场数据接口
 * 扩展原有的MarketData，包含所有新的数据维度
 */
export interface EnhancedMarketData {
  // 基础市场数据 (来自OKX)
  symbol: string;
  price: number;
  volume: number;
  timestamp: number;
  high24h: number;
  low24h: number;
  change24h: number;
  fundingRate?: number;
  openInterest?: number;
  
  // 链上数据
  onchain?: {
    stakingRatio?: number;
    activeAddresses?: number;
    gasPrice?: number;
    tvl?: number;
    whaleMovements?: number;
    exchangeInflow?: number;
    exchangeOutflow?: number;
    netExchangeFlow?: number;
    hodlerRatio?: number;
    transactionCount?: number;
    networkUtilization?: number;
  };
  
  // 宏观经济数据
  macro?: {
    dxy?: number;
    yield10y?: number;
    yield2y?: number;
    yieldSpread?: number;
    nasdaq?: number;
    sp500?: number;
    vix?: number;
    gold?: number;
    oil?: number;
    cpi?: number;
    unemploymentRate?: number;
    fedFundsRate?: number;
  };
  
  // 多交易所数据
  multiExchange?: {
    weightedAveragePrice?: number;
    priceSpread?: number;
    priceStdDev?: number;
    totalVolume?: number;
    volumeDistribution?: Record<string, number>;
    liquidityScore?: number;
    arbitrageOpportunities?: Array<{
      buyExchange: string;
      sellExchange: string;
      spread: number;
      spreadPercent: number;
      profitPotential: number;
    }>;
    avgBidAskSpread?: number;
    marketDepthScore?: number;
  };
  
  // 社交情绪数据
  sentiment?: {
    overallSentiment?: number;
    sentimentTrend?: 'bullish' | 'bearish' | 'neutral';
    confidenceLevel?: number;
    twitterSentiment?: number;
    redditSentiment?: number;
    newsSentiment?: number;
    googleTrends?: number;
    fgi?: number;
    socialActivity?: {
      totalMentions?: number;
      viralityScore?: number;
    };
  };
  
  // 期权数据
  options?: {
    impliedVolatility?: {
      atm: number;
      ivRank: number;
      ivPercentile: number;
    };
    putCallRatio?: {
      volume: number;
      openInterest: number;
    };
    maxPain?: {
      price: number;
      confidence: number;
    };
    gammaExposure?: {
      totalGamma: number;
      netGamma: number;
      gammaFlip: number;
    };
    sentiment?: {
      fearGreedIndex: number;
      volatilityRisk: 'low' | 'medium' | 'high' | 'extreme';
      marketOutlook: 'bullish' | 'bearish' | 'neutral';
    };
  };
  
  // DeFi数据
  defi?: {
    tvl?: {
      total: number;
      ethereum: number;
      change24h: number;
      dominance: number;
    };
    yields?: {
      lending: number;
      liquidity: number;
      staking: number;
    };
    stablecoins?: {
      totalSupply: number;
      dominanceRatio: number;
    };
    metrics?: {
      defiPulse: number;
      yieldFarming: number;
      liquidityHealth: number;
    };
  };
  
  // 大户监控数据
  whaleMonitoring?: {
    totalInflow?: number;           // 总流入 (USD)
    totalOutflow?: number;          // 总流出 (USD)
    netFlow?: number;              // 净流向 (USD)
    activeWhales?: number;         // 活跃大户数量
    largestTransaction?: number;    // 最大单笔交易
    sentiment?: 'bullish' | 'bearish' | 'neutral';
    alertCount?: number;           // 预警数量
    criticalAlerts?: number;       // 关键预警数量
    recentTransactions?: Array<{   // 最近大户交易
      amount: number;
      amountUSD: number;
      transactionType: string;
      exchangeName?: string;
      timestamp: number;
    }>;
  };
  
  // 数据质量指标
  dataQuality?: {
    completeness: number;      // 数据完整性 (0-100)
    freshness: number;         // 数据新鲜度 (0-100)
    reliability: number;       // 数据可靠性 (0-100)
    sources: string[];         // 数据源列表
    lastUpdate: number;        // 最后更新时间
  };
}

/**
 * 数据集成统计
 */
export interface DataIntegrationStats {
  totalDataSources: number;
  activeDataSources: number;
  dataCompleteness: number;
  avgResponseTime: number;
  errorRate: number;
  cacheHitRate: number;
  lastAggregation: number;
  aggregationCount: number;
}

/**
 * 增强的数据集成服务
 * 统一管理所有数据源，提供增强的市场数据
 */
export class EnhancedDataIntegrationService extends EventEmitter {
  private isInitialized: boolean = false;
  private isRunning: boolean = false;
  private aggregationStats: DataIntegrationStats;
  
  // 数据更新间隔
  private readonly UPDATE_INTERVAL = 30000; // 30秒
  private updateTimer: NodeJS.Timeout | null = null;
  
  constructor() {
    super();
    
    this.aggregationStats = {
      totalDataSources: 0,
      activeDataSources: 0,
      dataCompleteness: 0,
      avgResponseTime: 0,
      errorRate: 0,
      cacheHitRate: 0,
      lastAggregation: 0,
      aggregationCount: 0
    };
  }
  
  /**
   * 初始化数据集成服务
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('[EnhancedDataIntegrationService] Already initialized');
      return;
    }
    
    console.log('[EnhancedDataIntegrationService] Initializing enhanced data integration...');
    
    try {
      // 注册所有数据源到聚合器
      dataAggregatorService.registerDataSource(onchainDataService);
      dataAggregatorService.registerDataSource(macroEconomicDataService);
      dataAggregatorService.registerDataSource(multiExchangeDataService);
      dataAggregatorService.registerDataSource(socialSentimentDataService);
      dataAggregatorService.registerDataSource(whaleMonitoringService);
      dataAggregatorService.registerDataSource(optionsDataService);
      dataAggregatorService.registerDataSource(defiDataService);
      
      // 启动数据聚合服务
      await dataAggregatorService.start();
      
      // 设置事件监听
      this.setupEventListeners();
      
      this.isInitialized = true;
      console.log('[EnhancedDataIntegrationService] Initialized successfully');
      
    } catch (error) {
      console.error('[EnhancedDataIntegrationService] Failed to initialize:', error);
      throw error;
    }
  }
  
  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 监听数据聚合事件
    dataAggregatorService.on('dataAggregated', (data: AggregatedData) => {
      this.updateStats();
      this.emit('enhancedDataUpdated', data);
    });
    
    dataAggregatorService.on('started', () => {
      console.log('[EnhancedDataIntegrationService] Data aggregator started');
    });
    
    dataAggregatorService.on('stopped', () => {
      console.log('[EnhancedDataIntegrationService] Data aggregator stopped');
    });
  }
  
  /**
   * 启动数据集成服务
   */
  public async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    if (this.isRunning) {
      console.log('[EnhancedDataIntegrationService] Already running');
      return;
    }
    
    console.log('[EnhancedDataIntegrationService] Starting data integration service...');
    
    // 启动定期数据更新
    this.updateTimer = setInterval(() => {
      this.performDataUpdate();
    }, this.UPDATE_INTERVAL);
    
    this.isRunning = true;
    this.emit('started');
    console.log('[EnhancedDataIntegrationService] Started successfully');
  }
  
  /**
   * 停止数据集成服务
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    console.log('[EnhancedDataIntegrationService] Stopping data integration service...');
    
    // 停止定期更新
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    
    // 停止数据聚合服务
    await dataAggregatorService.stop();
    
    this.isRunning = false;
    this.emit('stopped');
    console.log('[EnhancedDataIntegrationService] Stopped');
  }
  
  /**
   * 获取增强的市场数据
   */
  public async getEnhancedMarketData(symbol: string = 'ETH-USDT-SWAP'): Promise<EnhancedMarketData> {
    if (!this.isInitialized) {
      throw new Error('Service not initialized');
    }
    
    try {
      // 获取基础市场数据
      const baseMarketData = await enhancedOKXDataService.getTicker(symbol);
      if (!baseMarketData) {
        throw new Error(`Failed to get base market data for ${symbol}`);
      }
      
      // 获取聚合数据
      const aggregatedData = await dataAggregatorService.getAggregatedData(symbol);
      
      // 构建增强的市场数据
      const enhancedData: EnhancedMarketData = {
        // 基础数据
        symbol: baseMarketData.symbol || symbol,
        price: baseMarketData.price,
        volume: baseMarketData.volume,
        timestamp: baseMarketData.timestamp,
        high24h: baseMarketData.high24h,
        low24h: baseMarketData.low24h,
        change24h: baseMarketData.change24h,
        fundingRate: baseMarketData.fundingRate,
        openInterest: baseMarketData.openInterest,
        
        // 增强数据
        onchain: aggregatedData?.onchain,
        macro: aggregatedData?.macro,
        multiExchange: aggregatedData?.multiExchange ? {
          priceSpread: aggregatedData.multiExchange.priceSpread,
          volumeDistribution: aggregatedData.multiExchange.volumeDistribution,
          liquidityScore: aggregatedData.multiExchange.liquidityScore,
          arbitrageOpportunities: aggregatedData.multiExchange.arbitrageOpportunities?.map(opp => ({
            buyExchange: opp.exchange1,
            sellExchange: opp.exchange2,
            spread: opp.spread,
            spreadPercent: (opp.spread / baseMarketData.price) * 100,
            profitPotential: opp.spread * opp.volume * 0.8
          }))
        } : undefined,
        sentiment: aggregatedData?.sentiment,
        
        // 期权数据
        options: aggregatedData?.options,
        
        // DeFi数据
        defi: aggregatedData?.defi,
        
        // 大户监控数据
        whaleMonitoring: aggregatedData?.whaleMonitoring ? {
          totalInflow: aggregatedData.whaleMonitoring.totalInflow,
          totalOutflow: aggregatedData.whaleMonitoring.totalOutflow,
          netFlow: aggregatedData.whaleMonitoring.netFlow,
          activeWhales: aggregatedData.whaleMonitoring.activeWhales,
          largestTransaction: aggregatedData.whaleMonitoring.largestTransaction,
          sentiment: aggregatedData.whaleMonitoring.sentiment,
          alertCount: aggregatedData.whaleMonitoring.alertCount,
          criticalAlerts: aggregatedData.whaleMonitoring.criticalAlerts
        } : undefined,
        
        // 数据质量指标
        dataQuality: this.calculateDataQuality(baseMarketData, aggregatedData)
      };
      
      return enhancedData;
      
    } catch (error) {
      console.error('[EnhancedDataIntegrationService] Failed to get enhanced market data:', error);
      throw error;
    }
  }
  
  /**
   * 执行数据更新
   */
  private async performDataUpdate(): Promise<void> {
    try {
      const symbols = config.trading.symbols || ['ETH-USDT-SWAP'];
      
      for (const symbol of symbols) {
        await dataAggregatorService.getAggregatedData(symbol);
      }
      
      this.aggregationStats.aggregationCount++;
      this.aggregationStats.lastAggregation = Date.now();
      
    } catch (error) {
      console.error('[EnhancedDataIntegrationService] Failed to update data:', error);
    }
  }
  
  /**
   * 计算数据质量指标 (使用增强的数据质量管理器)
   */
  private calculateDataQuality(baseData: any, aggregatedData: AggregatedData | null): {
    completeness: number;
    freshness: number;
    reliability: number;
    sources: string[];
    lastUpdate: number;
  } {
    // 使用数据质量管理器进行综合评估
    const dataSources: Array<{data: any, quality: DataSourceQuality}> = [];
    
    // 评估基础市场数据
    if (baseData) {
      const quality = dataQualityManager.assessDataQuality(baseData, 'OKX', 'exchange');
      dataSources.push({ data: baseData, quality });
    }
    
    // 评估聚合数据中的各个数据源
    if (aggregatedData?.onchain) {
      const quality = dataQualityManager.assessDataQuality(aggregatedData.onchain, 'Etherscan', 'onchain');
      dataSources.push({ data: aggregatedData.onchain, quality });
    }
    
    if (aggregatedData?.macro) {
      const quality = dataQualityManager.assessDataQuality(aggregatedData.macro, 'AlphaVantage', 'macro_economic');
      dataSources.push({ data: aggregatedData.macro, quality });
    }
    
    if (aggregatedData?.multiExchange) {
      const quality = dataQualityManager.assessDataQuality(aggregatedData.multiExchange, 'MultiExchange', 'exchange');
      dataSources.push({ data: aggregatedData.multiExchange, quality });
    }
    
    if (aggregatedData?.sentiment) {
      const quality = dataQualityManager.assessDataQuality(aggregatedData.sentiment, 'NewsAPI', 'social_sentiment');
      dataSources.push({ data: aggregatedData.sentiment, quality });
    }
    
    if (aggregatedData?.whaleMonitoring) {
      const quality = dataQualityManager.assessDataQuality(aggregatedData.whaleMonitoring, 'WhaleAlert', 'whale_monitoring');
      dataSources.push({ data: aggregatedData.whaleMonitoring, quality });
    }
    
    if (aggregatedData?.options) {
      const quality = dataQualityManager.assessDataQuality(aggregatedData.options, 'Deribit', 'options');
      dataSources.push({ data: aggregatedData.options, quality });
    }
    
    if (aggregatedData?.defi) {
      const quality = dataQualityManager.assessDataQuality(aggregatedData.defi, 'DefiLlama', 'defi');
      dataSources.push({ data: aggregatedData.defi, quality });
    }
    
    // 计算综合质量指标
    const sources = dataSources.map(ds => ds.quality.sourceName);
    const avgCompleteness = dataSources.length > 0 
      ? dataSources.reduce((sum, ds) => sum + ds.quality.metrics.completeness, 0) / dataSources.length 
      : 0;
    const avgFreshness = dataSources.length > 0 
      ? dataSources.reduce((sum, ds) => sum + ds.quality.metrics.timeliness, 0) / dataSources.length 
      : 0;
    const avgReliability = dataSources.length > 0 
      ? dataSources.reduce((sum, ds) => sum + ds.quality.metrics.reliability, 0) / dataSources.length 
      : 0;
    
    return {
      completeness: Math.min(100, avgCompleteness),
      freshness: Math.min(100, avgFreshness),
      reliability: Math.min(100, avgReliability),
      sources,
      lastUpdate: Date.now()
    };
  }
  
  /**
   * 更新统计信息
   */
  private updateStats(): void {
    const serviceStats = dataAggregatorService.getServiceStats();
    const dataSourceStats = dataAggregatorService.getDataSourcesStatus();
    
    this.aggregationStats = {
      ...this.aggregationStats,
      totalDataSources: serviceStats.totalDataSources,
      activeDataSources: serviceStats.activeDataSources,
      avgResponseTime: dataSourceStats.length > 0 
        ? dataSourceStats.reduce((sum, stat) => sum + stat.avgResponseTime, 0) / dataSourceStats.length
        : 0,
      errorRate: dataSourceStats.length > 0
        ? 1 - (dataSourceStats.reduce((sum, stat) => sum + stat.successRate, 0) / dataSourceStats.length)
        : 0,
      cacheHitRate: serviceStats.cacheStats?.hitRate || 0
    };
    
    // 计算数据完整性
    const activeSourcesRatio = this.aggregationStats.totalDataSources > 0 
      ? this.aggregationStats.activeDataSources / this.aggregationStats.totalDataSources
      : 0;
    this.aggregationStats.dataCompleteness = activeSourcesRatio * 100;
  }
  
  /**
   * 获取数据集成统计
   */
  public getIntegrationStats(): DataIntegrationStats {
    return { ...this.aggregationStats };
  }
  
  /**
   * 获取所有数据源状态
   */
  public getDataSourcesStatus(): any[] {
    return dataAggregatorService.getDataSourcesStatus();
  }
  
  /**
   * 清理所有缓存
   */
  public clearAllCaches(): void {
    dataAggregatorService.clearCache();
    onchainDataService.clearCache();
    macroEconomicDataService.clearCache();
    multiExchangeDataService.clearCache();
    socialSentimentDataService.clearCache();
    
    console.log('[EnhancedDataIntegrationService] All caches cleared');
  }
  
  /**
   * 获取服务健康状态
   */
  public getHealthStatus(): {
    isHealthy: boolean;
    issues: string[];
    uptime: number;
    lastCheck: number;
  } {
    const issues: string[] = [];
    const stats = this.getIntegrationStats();
    
    // 检查数据源健康状态
    if (stats.activeDataSources < stats.totalDataSources) {
      issues.push(`${stats.totalDataSources - stats.activeDataSources} data sources are inactive`);
    }
    
    if (stats.errorRate > 0.1) {
      issues.push(`High error rate: ${(stats.errorRate * 100).toFixed(1)}%`);
    }
    
    if (stats.dataCompleteness < 80) {
      issues.push(`Low data completeness: ${stats.dataCompleteness.toFixed(1)}%`);
    }
    
    const uptime = this.isRunning ? Date.now() - (stats.lastAggregation || Date.now()) : 0;
    
    return {
      isHealthy: issues.length === 0,
      issues,
      uptime,
      lastCheck: Date.now()
    };
  }
}

// 导出单例实例
export const enhancedDataIntegrationService = new EnhancedDataIntegrationService();