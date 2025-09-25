import { EventEmitter } from 'events';
import { config } from '../config.js';
import { SmartCacheManager } from '../utils/smart-cache-manager.js';
import { ErrorRecoveryManager } from '../utils/error-recovery-manager.js';
import { PerformanceMonitor } from '../utils/performance-monitor.js';

/**
 * 数据源类型枚举
 */
export enum DataSourceType {
  EXCHANGE = 'exchange',
  ONCHAIN = 'onchain',
  MACRO_ECONOMIC = 'macro_economic',
  SOCIAL_SENTIMENT = 'social_sentiment',
  WHALE_MONITORING = 'whale_monitoring',
  OPTIONS = 'options',
  DEFI = 'defi'
}

/**
 * 数据源状态
 */
export interface DataSourceStatus {
  name: string;
  type: DataSourceType;
  isActive: boolean;
  lastUpdate: number;
  errorCount: number;
  successRate: number;
  avgResponseTime: number;
}

/**
 * 聚合数据接口
 */
export interface AggregatedData {
  timestamp: number;
  symbol: string;
  
  // 基础市场数据
  market: {
    price: number;
    volume: number;
    change24h: number;
    high24h: number;
    low24h: number;
    fundingRate?: number;
    openInterest?: number;
  };
  
  // 链上数据
  onchain?: {
    stakingRatio?: number;
    activeAddresses?: number;
    gasPrice?: number;
    tvl?: number;
    whaleMovements?: number;
    exchangeInflow?: number;
    exchangeOutflow?: number;
  };
  
  // 宏观经济数据
  macro?: {
    dxy?: number;          // 美元指数
    yield10y?: number;     // 10年期美债收益率
    nasdaq?: number;       // 纳斯达克指数
    gold?: number;         // 黄金价格
    vix?: number;          // 恐慌指数
  };
  
  // 社交情绪数据
  sentiment?: {
    fgi?: number;          // 恐慌贪婪指数
    twitterSentiment?: number;
    redditSentiment?: number;
    googleTrends?: number;
    newsSentiment?: number;
  };
  
  // 多交易所数据
  multiExchange?: {
    priceSpread?: number;
    volumeDistribution?: Record<string, number>;
    liquidityScore?: number;
    arbitrageOpportunities?: Array<{
      exchange1: string;
      exchange2: string;
      spread: number;
      volume: number;
    }>;
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
  };
}

/**
 * 数据源接口
 */
export interface IDataSource {
  name: string;
  type: DataSourceType;
  isEnabled: boolean;
  
  initialize(): Promise<void>;
  fetchData(symbol: string): Promise<any>;
  getStatus(): DataSourceStatus;
  shutdown(): Promise<void>;
}

/**
 * 数据聚合服务
 * 统一管理所有外部数据源，提供数据聚合、缓存、故障恢复等功能
 */
export class DataAggregatorService extends EventEmitter {
  private dataSources: Map<string, IDataSource> = new Map();
  private cacheManager: SmartCacheManager;
  private errorRecoveryManager: ErrorRecoveryManager;
  private performanceMonitor: PerformanceMonitor;
  
  private aggregationInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  
  // 数据聚合配置
  private readonly AGGREGATION_INTERVAL = 30000; // 30秒聚合一次
  private readonly CACHE_TTL = 60000; // 缓存1分钟
  private readonly MAX_RETRY_ATTEMPTS = 3;
  
  constructor() {
    super();
    
    this.cacheManager = new SmartCacheManager({
      maxSize: 1000 * 1024, // 1MB
      defaultTTL: this.CACHE_TTL,
      maxItems: 1000
    });
    
    this.errorRecoveryManager = new ErrorRecoveryManager({
      maxRetries: this.MAX_RETRY_ATTEMPTS,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2
    });
    
    this.performanceMonitor = new PerformanceMonitor({
      metricsInterval: 30000,
      historySize: 100,
      enableRealTimeAlerts: true,
      alertRules: []
    });
  }
  
  /**
   * 注册数据源
   */
  public registerDataSource(dataSource: IDataSource): void {
    this.dataSources.set(dataSource.name, dataSource);
    console.log(`[DataAggregator] Registered data source: ${dataSource.name} (${dataSource.type})`);
  }
  
  /**
   * 移除数据源
   */
  public unregisterDataSource(name: string): void {
    const dataSource = this.dataSources.get(name);
    if (dataSource) {
      dataSource.shutdown();
      this.dataSources.delete(name);
      console.log(`[DataAggregator] Unregistered data source: ${name}`);
    }
  }
  
  /**
   * 启动数据聚合服务
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[DataAggregator] Service is already running');
      return;
    }
    
    console.log('[DataAggregator] Starting data aggregation service...');
    
    // 初始化所有数据源
    for (const [name, dataSource] of this.dataSources) {
      try {
        if (dataSource.isEnabled) {
          await dataSource.initialize();
          console.log(`[DataAggregator] Initialized data source: ${name}`);
        }
      } catch (error) {
        console.error(`[DataAggregator] Failed to initialize data source ${name}:`, error);
      }
    }
    
    // 启动定期聚合
    this.aggregationInterval = setInterval(() => {
      this.performAggregation();
    }, this.AGGREGATION_INTERVAL);
    
    this.isRunning = true;
    this.emit('started');
    console.log('[DataAggregator] Service started successfully');
  }
  
  /**
   * 停止数据聚合服务
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    console.log('[DataAggregator] Stopping data aggregation service...');
    
    // 停止定期聚合
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
      this.aggregationInterval = null;
    }
    
    // 关闭所有数据源
    for (const [name, dataSource] of this.dataSources) {
      try {
        await dataSource.shutdown();
        console.log(`[DataAggregator] Shutdown data source: ${name}`);
      } catch (error) {
        console.error(`[DataAggregator] Failed to shutdown data source ${name}:`, error);
      }
    }
    
    this.isRunning = false;
    this.emit('stopped');
    console.log('[DataAggregator] Service stopped');
  }
  
  /**
   * 获取聚合数据
   */
  public async getAggregatedData(symbol: string = 'ETH-USDT-SWAP'): Promise<AggregatedData | null> {
    const cacheKey = `aggregated_${symbol}`;
    
    // 尝试从缓存获取
    const cached = this.cacheManager.get(cacheKey);
    if (cached) {
      return cached as AggregatedData;
    }
    
    // 执行数据聚合
    const aggregatedData = await this.performAggregation(symbol);
    
    // 缓存结果
    if (aggregatedData) {
      this.cacheManager.set(cacheKey, aggregatedData, this.CACHE_TTL);
    }
    
    return aggregatedData;
  }
  
  /**
   * 执行数据聚合
   */
  private async performAggregation(symbol: string = 'ETH-USDT-SWAP'): Promise<AggregatedData | null> {
    const startTime = Date.now();
    
    try {
      const aggregatedData: AggregatedData = {
        timestamp: Date.now(),
        symbol,
        market: {
          price: 0,
          volume: 0,
          change24h: 0,
          high24h: 0,
          low24h: 0
        }
      };
      
      // 并行获取各数据源数据
      const dataPromises: Promise<any>[] = [];
      const sourceNames: string[] = [];
      
      for (const [name, dataSource] of this.dataSources) {
        if (dataSource.isEnabled) {
          dataPromises.push(
            this.errorRecoveryManager.executeWithRecovery(
              () => dataSource.fetchData(symbol),
              `${name}_fetch`
            )
          );
          sourceNames.push(name);
        }
      }
      
      // 等待所有数据源返回结果
      const results = await Promise.allSettled(dataPromises);
      
      // 处理各数据源结果
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const sourceName = sourceNames[i];
        const dataSource = this.dataSources.get(sourceName);
        
        if (result.status === 'fulfilled' && dataSource) {
          this.mergeDataByType(aggregatedData, result.value, dataSource.type);
        } else if (result.status === 'rejected') {
          console.error(`[DataAggregator] Failed to fetch data from ${sourceName}:`, result.reason);
        }
      }
      
      // 记录性能指标
      const responseTime = Date.now() - startTime;
      this.performanceMonitor.recordRequest(responseTime, false);
      
      this.emit('dataAggregated', aggregatedData);
      return aggregatedData;
      
    } catch (error) {
      console.error('[DataAggregator] Failed to perform data aggregation:', error);
      this.performanceMonitor.recordRequest(Date.now() - startTime, true);
      return null;
    }
  }
  
  /**
   * 根据数据源类型合并数据
   */
  private mergeDataByType(aggregatedData: AggregatedData, sourceData: any, sourceType: DataSourceType): void {
    switch (sourceType) {
      case DataSourceType.EXCHANGE:
        if (sourceData.market) {
          Object.assign(aggregatedData.market, sourceData.market);
        }
        break;
        
      case DataSourceType.ONCHAIN:
        aggregatedData.onchain = { ...aggregatedData.onchain, ...sourceData };
        break;
        
      case DataSourceType.MACRO_ECONOMIC:
        aggregatedData.macro = { ...aggregatedData.macro, ...sourceData };
        break;
        
      case DataSourceType.SOCIAL_SENTIMENT:
        aggregatedData.sentiment = { ...aggregatedData.sentiment, ...sourceData };
        break;
        
      case DataSourceType.WHALE_MONITORING:
        // 处理大户监控数据
        if (sourceData.exchangeFlows && sourceData.whaleActivity && sourceData.alerts) {
          aggregatedData.whaleMonitoring = {
            totalInflow: sourceData.exchangeFlows.totalInflow,
            totalOutflow: sourceData.exchangeFlows.totalOutflow,
            netFlow: sourceData.exchangeFlows.netFlow,
            activeWhales: sourceData.whaleActivity.activeWhales,
            largestTransaction: sourceData.whaleActivity.largestTransaction,
            sentiment: sourceData.whaleActivity.sentiment,
            alertCount: sourceData.alerts.length,
            criticalAlerts: sourceData.alerts.filter((alert: any) => alert.severity === 'critical').length
          };
        }
        break;
        
      case DataSourceType.OPTIONS:
        // 处理期权数据
        if (sourceData.impliedVolatility || sourceData.putCallRatio || sourceData.maxPain || sourceData.gammaExposure || sourceData.sentiment) {
          aggregatedData.options = {
            impliedVolatility: sourceData.impliedVolatility ? {
              atm: sourceData.impliedVolatility.atm,
              ivRank: sourceData.impliedVolatility.ivRank,
              ivPercentile: sourceData.impliedVolatility.ivPercentile
            } : undefined,
            putCallRatio: sourceData.putCallRatio ? {
              volume: sourceData.putCallRatio.volume,
              openInterest: sourceData.putCallRatio.openInterest
            } : undefined,
            maxPain: sourceData.maxPain ? {
              price: sourceData.maxPain.price,
              confidence: sourceData.maxPain.confidence
            } : undefined,
            gammaExposure: sourceData.gammaExposure ? {
              totalGamma: sourceData.gammaExposure.totalGamma,
              netGamma: sourceData.gammaExposure.netGamma,
              gammaFlip: sourceData.gammaExposure.gammaFlip
            } : undefined,
            sentiment: sourceData.sentiment ? {
              fearGreedIndex: sourceData.sentiment.fearGreedIndex,
              volatilityRisk: sourceData.sentiment.volatilityRisk,
              marketOutlook: sourceData.sentiment.marketOutlook
            } : undefined
          };
        }
        break;
        
      case DataSourceType.DEFI:
        // 处理DeFi数据
        if (sourceData.tvl || sourceData.yields || sourceData.stablecoins || sourceData.metrics) {
          aggregatedData.defi = {
            tvl: sourceData.tvl ? {
              total: sourceData.tvl.total,
              ethereum: sourceData.tvl.ethereum,
              change24h: sourceData.tvl.change24h,
              dominance: sourceData.tvl.dominance
            } : undefined,
            yields: sourceData.yields ? {
              lending: sourceData.yields.lending?.average || 0,
              liquidity: sourceData.yields.liquidity?.average || 0,
              staking: sourceData.yields.staking?.ethereum || 0
            } : undefined,
            stablecoins: sourceData.stablecoins ? {
              totalSupply: sourceData.stablecoins.totalSupply,
              dominanceRatio: sourceData.stablecoins.dominanceRatio
            } : undefined,
            metrics: sourceData.metrics ? {
              defiPulse: sourceData.metrics.defiPulse,
              yieldFarming: sourceData.metrics.yieldFarming,
              liquidityHealth: sourceData.metrics.liquidityHealth
            } : undefined
          };
        }
        break;
        
      default:
        console.warn(`[DataAggregator] Unknown data source type: ${sourceType}`);
    }
  }
  
  /**
   * 获取所有数据源状态
   */
  public getDataSourcesStatus(): DataSourceStatus[] {
    const statuses: DataSourceStatus[] = [];
    
    for (const [name, dataSource] of this.dataSources) {
      statuses.push(dataSource.getStatus());
    }
    
    return statuses;
  }
  
  /**
   * 获取服务统计信息
   */
  public getServiceStats(): {
    isRunning: boolean;
    totalDataSources: number;
    activeDataSources: number;
    cacheStats: any;
    performanceStats: any;
    errorStats: any;
  } {
    const activeCount = Array.from(this.dataSources.values())
      .filter(ds => ds.isEnabled).length;
    
    return {
      isRunning: this.isRunning,
      totalDataSources: this.dataSources.size,
      activeDataSources: activeCount,
      cacheStats: this.cacheManager.getStats(),
      performanceStats: this.performanceMonitor.getStats(),
      errorStats: this.errorRecoveryManager.getErrorStats()
    };
  }
  
  /**
   * 清理缓存
   */
  public clearCache(): void {
    this.cacheManager.clear();
    console.log('[DataAggregator] Cache cleared');
  }
}

// 导出单例实例
export const dataAggregatorService = new DataAggregatorService();