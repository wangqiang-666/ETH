import axios, { AxiosInstance } from 'axios';
import { config } from '../config.js';
import { IDataSource, DataSourceType, DataSourceStatus } from './data-aggregator-service.js';
import { SmartCacheManager } from '../utils/smart-cache-manager.js';

/**
 * 交易所数据接口
 */
export interface ExchangeData {
  exchange: string;
  symbol: string;
  price: number;
  volume: number;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
}

/**
 * 多交易所聚合数据接口
 */
export interface MultiExchangeData {
  symbol: string;
  timestamp: number;
  
  // 价格聚合
  weightedAveragePrice: number;   // 成交量加权平均价格
  priceSpread: number;            // 最高价与最低价差异
  priceStdDev: number;           // 价格标准差
  
  // 流动性分析
  totalVolume: number;            // 总成交量
  volumeDistribution: Record<string, number>; // 各交易所成交量分布
  liquidityScore: number;         // 流动性评分 (0-100)
  
  // 套利机会
  arbitrageOpportunities: Array<{
    buyExchange: string;
    sellExchange: string;
    spread: number;
    spreadPercent: number;
    volume: number;
    profitPotential: number;
  }>;
  
  // 各交易所详细数据
  exchanges: ExchangeData[];
  
  // 市场深度指标
  avgBidAskSpread: number;        // 平均买卖价差
  marketDepthScore: number;       // 市场深度评分
}

/**
 * Binance API响应接口
 */
interface BinanceTickerResponse {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  prevClosePrice: string;
  lastPrice: string;
  lastQty: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

/**
 * Bybit API响应接口
 */
interface BybitTickerResponse {
  retCode: number;
  retMsg: string;
  result: {
    category: string;
    list: Array<{
      symbol: string;
      lastPrice: string;
      indexPrice: string;
      markPrice: string;
      prevPrice24h: string;
      price24hPcnt: string;
      highPrice24h: string;
      lowPrice24h: string;
      prevPrice1h: string;
      openInterest: string;
      openInterestValue: string;
      turnover24h: string;
      volume24h: string;
      fundingRate: string;
      nextFundingTime: string;
      predictedDeliveryPrice: string;
      basisRate: string;
      deliveryFeeRate: string;
      deliveryTime: string;
      ask1Size: string;
      bid1Price: string;
      ask1Price: string;
      bid1Size: string;
    }>;
  };
}

/**
 * 多交易所数据服务
 * 聚合多个交易所的数据，提供价格发现、套利机会识别等功能
 */
export class MultiExchangeDataService implements IDataSource {
  public readonly name = 'MultiExchangeDataService';
  public readonly type = DataSourceType.EXCHANGE;
  public isEnabled: boolean = true;
  
  private binanceClient: AxiosInstance;
  private bybitClient: AxiosInstance;
  private cacheManager: SmartCacheManager;
  
  private status: DataSourceStatus;
  private lastUpdate: number = 0;
  private errorCount: number = 0;
  private successCount: number = 0;
  private responseTimes: number[] = [];
  
  // API配置
  private readonly BINANCE_BASE_URL = 'https://api.binance.com';
  private readonly BYBIT_BASE_URL = 'https://api.bybit.com';
  private readonly CACHE_TTL = 10 * 1000; // 10秒缓存（交易数据需要较高实时性）
  
  // 交易所符号映射
  private readonly SYMBOL_MAPPING = {
    'ETH-USDT-SWAP': {
      binance: 'ETHUSDT',
      bybit: 'ETHUSDT',
      okx: 'ETH-USDT-SWAP'
    },
    'BTC-USDT-SWAP': {
      binance: 'BTCUSDT',
      bybit: 'BTCUSDT',
      okx: 'BTC-USDT-SWAP'
    }
  };
  
  constructor() {
    this.cacheManager = new SmartCacheManager({
      maxSize: 5 * 1024 * 1024, // 5MB
      defaultTTL: this.CACHE_TTL,
      maxItems: 1000
    });
    
    this.binanceClient = axios.create({
      baseURL: this.BINANCE_BASE_URL,
      timeout: 5000
    });
    
    this.bybitClient = axios.create({
      baseURL: this.BYBIT_BASE_URL,
      timeout: 5000
    });
    
    this.status = {
      name: this.name,
      type: this.type,
      isActive: false,
      lastUpdate: 0,
      errorCount: 0,
      successRate: 0,
      avgResponseTime: 0
    };
    
    this.setupInterceptors();
  }
  
  /**
   * 设置请求拦截器
   */
  private setupInterceptors(): void {
    // Binance拦截器
    this.binanceClient.interceptors.request.use(
      (config) => {
        (config as any).metadata = { startTime: Date.now() };
        return config;
      }
    );
    
    this.binanceClient.interceptors.response.use(
      (response) => {
        const responseTime = Date.now() - (response.config as any).metadata.startTime;
        this.recordSuccess(responseTime);
        return response;
      },
      (error) => {
        const responseTime = Date.now() - (error.config?.metadata?.startTime || 0);
        this.recordError(responseTime);
        return Promise.reject(error);
      }
    );
    
    // Bybit拦截器
    this.bybitClient.interceptors.request.use(
      (config) => {
        (config as any).metadata = { startTime: Date.now() };
        return config;
      }
    );
    
    this.bybitClient.interceptors.response.use(
      (response) => {
        const responseTime = Date.now() - (response.config as any).metadata.startTime;
        this.recordSuccess(responseTime);
        return response;
      },
      (error) => {
        const responseTime = Date.now() - (error.config?.metadata?.startTime || 0);
        this.recordError(responseTime);
        return Promise.reject(error);
      }
    );
  }
  
  /**
   * 初始化服务
   */
  public async initialize(): Promise<void> {
    console.log('[MultiExchangeDataService] Initializing...');
    
    try {
      await this.testConnections();
      this.status.isActive = true;
      console.log('[MultiExchangeDataService] Initialized successfully');
    } catch (error) {
      console.error('[MultiExchangeDataService] Failed to initialize:', error);
      this.status.isActive = false;
      throw error;
    }
  }
  
  /**
   * 测试API连接
   */
  private async testConnections(): Promise<void> {
    const promises: Promise<any>[] = [];
    
    // 测试Binance连接
    promises.push(
      this.binanceClient.get('/api/v3/ticker/24hr', {
        params: { symbol: 'ETHUSDT' }
      })
    );
    
    // 测试Bybit连接
    promises.push(
      this.bybitClient.get('/v5/market/tickers', {
        params: { 
          category: 'linear',
          symbol: 'ETHUSDT'
        }
      })
    );
    
    await Promise.all(promises);
  }
  
  /**
   * 获取多交易所数据
   */
  public async fetchData(symbol: string = 'ETH-USDT-SWAP'): Promise<MultiExchangeData> {
    const cacheKey = `multi_exchange_${symbol}`;
    
    // 尝试从缓存获取
    const cached = this.cacheManager.get(cacheKey);
    if (cached) {
      return cached as MultiExchangeData;
    }
    
    console.log(`[MultiExchangeDataService] Fetching multi-exchange data for ${symbol}...`);
    
    const exchangeDataList: ExchangeData[] = [];
    
    // 并行获取各交易所数据
    const dataPromises: Promise<void>[] = [];
    
    // 获取Binance数据
    const binanceSymbol = this.getExchangeSymbol(symbol, 'binance');
    if (binanceSymbol) {
      dataPromises.push(
        this.fetchBinanceData(binanceSymbol).then(data => {
          if (data) exchangeDataList.push(data);
        }).catch(error => {
          console.warn('[MultiExchangeDataService] Failed to fetch Binance data:', error.message);
        })
      );
    }
    
    // 获取Bybit数据
    const bybitSymbol = this.getExchangeSymbol(symbol, 'bybit');
    if (bybitSymbol) {
      dataPromises.push(
        this.fetchBybitData(bybitSymbol).then(data => {
          if (data) exchangeDataList.push(data);
        }).catch(error => {
          console.warn('[MultiExchangeDataService] Failed to fetch Bybit data:', error.message);
        })
      );
    }
    
    // 等待所有数据获取完成
    await Promise.allSettled(dataPromises);
    
    // 聚合数据
    const aggregatedData = this.aggregateExchangeData(symbol, exchangeDataList);
    
    // 缓存结果
    this.cacheManager.set(cacheKey, aggregatedData, undefined, this.CACHE_TTL);
    this.lastUpdate = Date.now();
    
    console.log(`[MultiExchangeDataService] Aggregated data from ${exchangeDataList.length} exchanges`);
    return aggregatedData;
  }
  
  /**
   * 获取交易所对应的符号
   */
  private getExchangeSymbol(symbol: string, exchange: string): string | null {
    const mapping = (this.SYMBOL_MAPPING as any)[symbol];
    return mapping ? mapping[exchange] : null;
  }
  
  /**
   * 获取Binance数据
   */
  private async fetchBinanceData(symbol: string): Promise<ExchangeData | null> {
    const response = await this.binanceClient.get<BinanceTickerResponse>('/api/v3/ticker/24hr', {
      params: { symbol }
    });
    
    const data = response.data;
    const price = parseFloat(data.lastPrice);
    const bid = parseFloat(data.bidPrice);
    const ask = parseFloat(data.askPrice);
    
    return {
      exchange: 'Binance',
      symbol,
      price,
      volume: parseFloat(data.volume),
      bid,
      ask,
      spread: ask - bid,
      timestamp: data.closeTime
    };
  }
  
  /**
   * 获取Bybit数据
   */
  private async fetchBybitData(symbol: string): Promise<ExchangeData | null> {
    const response = await this.bybitClient.get<BybitTickerResponse>('/v5/market/tickers', {
      params: { 
        category: 'linear',
        symbol
      }
    });
    
    if (response.data.retCode === 0 && response.data.result.list.length > 0) {
      const data = response.data.result.list[0];
      const price = parseFloat(data.lastPrice);
      const bid = parseFloat(data.bid1Price);
      const ask = parseFloat(data.ask1Price);
      
      return {
        exchange: 'Bybit',
        symbol,
        price,
        volume: parseFloat(data.volume24h),
        bid,
        ask,
        spread: ask - bid,
        timestamp: Date.now()
      };
    }
    
    return null;
  }
  
  /**
   * 聚合交易所数据
   */
  private aggregateExchangeData(symbol: string, exchanges: ExchangeData[]): MultiExchangeData {
    if (exchanges.length === 0) {
      throw new Error('No exchange data available');
    }
    
    // 计算加权平均价格
    const totalVolume = exchanges.reduce((sum, ex) => sum + ex.volume, 0);
    const weightedAveragePrice = exchanges.reduce((sum, ex) => {
      return sum + (ex.price * ex.volume / totalVolume);
    }, 0);
    
    // 计算价格统计
    const prices = exchanges.map(ex => ex.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceSpread = maxPrice - minPrice;
    
    // 计算价格标准差
    const avgPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const priceVariance = prices.reduce((sum, price) => sum + Math.pow(price - avgPrice, 2), 0) / prices.length;
    const priceStdDev = Math.sqrt(priceVariance);
    
    // 计算成交量分布
    const volumeDistribution: Record<string, number> = {};
    exchanges.forEach(ex => {
      volumeDistribution[ex.exchange] = ex.volume / totalVolume;
    });
    
    // 计算流动性评分 (基于成交量和价差)
    const avgSpread = exchanges.reduce((sum, ex) => sum + ex.spread, 0) / exchanges.length;
    const liquidityScore = Math.min(100, Math.max(0, 
      100 - (avgSpread / avgPrice * 10000) - (priceStdDev / avgPrice * 5000)
    ));
    
    // 识别套利机会
    const arbitrageOpportunities = this.findArbitrageOpportunities(exchanges);
    
    // 计算平均买卖价差
    const avgBidAskSpread = exchanges.reduce((sum, ex) => sum + ex.spread, 0) / exchanges.length;
    
    // 计算市场深度评分
    const marketDepthScore = Math.min(100, Math.max(0,
      100 - (avgBidAskSpread / avgPrice * 10000)
    ));
    
    return {
      symbol,
      timestamp: Date.now(),
      weightedAveragePrice,
      priceSpread,
      priceStdDev,
      totalVolume,
      volumeDistribution,
      liquidityScore,
      arbitrageOpportunities,
      exchanges,
      avgBidAskSpread,
      marketDepthScore
    };
  }
  
  /**
   * 识别套利机会
   */
  private findArbitrageOpportunities(exchanges: ExchangeData[]): Array<{
    buyExchange: string;
    sellExchange: string;
    spread: number;
    spreadPercent: number;
    volume: number;
    profitPotential: number;
  }> {
    const opportunities: Array<{
      buyExchange: string;
      sellExchange: string;
      spread: number;
      spreadPercent: number;
      volume: number;
      profitPotential: number;
    }> = [];
    
    // 比较所有交易所对
    for (let i = 0; i < exchanges.length; i++) {
      for (let j = i + 1; j < exchanges.length; j++) {
        const ex1 = exchanges[i];
        const ex2 = exchanges[j];
        
        let buyExchange, sellExchange, spread;
        
        if (ex1.price < ex2.price) {
          buyExchange = ex1.exchange;
          sellExchange = ex2.exchange;
          spread = ex2.price - ex1.price;
        } else {
          buyExchange = ex2.exchange;
          sellExchange = ex1.exchange;
          spread = ex1.price - ex2.price;
        }
        
        const spreadPercent = (spread / Math.min(ex1.price, ex2.price)) * 100;
        
        // 只考虑价差超过0.1%的机会
        if (spreadPercent > 0.1) {
          const volume = Math.min(ex1.volume, ex2.volume);
          const profitPotential = spread * volume * 0.8; // 考虑手续费等成本
          
          opportunities.push({
            buyExchange,
            sellExchange,
            spread,
            spreadPercent,
            volume,
            profitPotential
          });
        }
      }
    }
    
    // 按盈利潜力排序
    return opportunities.sort((a, b) => b.profitPotential - a.profitPotential);
  }
  
  /**
   * 记录成功请求
   */
  private recordSuccess(responseTime: number): void {
    this.successCount++;
    this.responseTimes.push(responseTime);
    
    if (this.responseTimes.length > 100) {
      this.responseTimes.shift();
    }
    
    this.updateStatus();
  }
  
  /**
   * 记录错误请求
   */
  private recordError(responseTime: number): void {
    this.errorCount++;
    this.responseTimes.push(responseTime);
    
    if (this.responseTimes.length > 100) {
      this.responseTimes.shift();
    }
    
    this.updateStatus();
  }
  
  /**
   * 更新状态
   */
  private updateStatus(): void {
    const totalRequests = this.successCount + this.errorCount;
    
    this.status = {
      ...this.status,
      lastUpdate: this.lastUpdate,
      errorCount: this.errorCount,
      successRate: totalRequests > 0 ? this.successCount / totalRequests : 0,
      avgResponseTime: this.responseTimes.length > 0 
        ? this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length 
        : 0
    };
  }
  
  /**
   * 获取服务状态
   */
  public getStatus(): DataSourceStatus {
    return { ...this.status };
  }
  
  /**
   * 关闭服务
   */
  public async shutdown(): Promise<void> {
    console.log('[MultiExchangeDataService] Shutting down...');
    this.status.isActive = false;
    this.cacheManager.clear();
  }
  
  /**
   * 获取缓存统计
   */
  public getCacheStats(): any {
    return this.cacheManager.getStats();
  }
  
  /**
   * 清理缓存
   */
  public clearCache(): void {
    this.cacheManager.clear();
    console.log('[MultiExchangeDataService] Cache cleared');
  }
}

// 导出单例实例
export const multiExchangeDataService = new MultiExchangeDataService();