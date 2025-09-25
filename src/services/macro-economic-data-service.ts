import axios, { AxiosInstance } from 'axios';
import { config } from '../config.js';
import { IDataSource, DataSourceType, DataSourceStatus } from './data-aggregator-service.js';
import { SmartCacheManager } from '../utils/smart-cache-manager.js';

/**
 * 宏观经济数据接口
 */
export interface MacroEconomicData {
  // 美元相关指标
  dxy?: number;                   // 美元指数
  yield10y?: number;              // 10年期美债收益率
  yield2y?: number;               // 2年期美债收益率
  yieldSpread?: number;           // 收益率曲线斜率
  
  // 股市指标
  nasdaq?: number;                // 纳斯达克指数
  sp500?: number;                 // 标普500指数
  vix?: number;                   // 恐慌指数
  
  // 商品价格
  gold?: number;                  // 黄金价格
  oil?: number;                   // 原油价格
  copper?: number;                // 铜价
  
  // 经济指标
  cpi?: number;                   // 消费者价格指数
  ppi?: number;                   // 生产者价格指数
  unemploymentRate?: number;      // 失业率
  gdpGrowth?: number;            // GDP增长率
  
  // 货币政策
  fedFundsRate?: number;         // 联邦基金利率
  m2MoneySupply?: number;        // M2货币供应量
}

/**
 * Alpha Vantage API响应接口
 */
interface AlphaVantageResponse {
  'Meta Data': any;
  'Time Series (Daily)'?: Record<string, {
    '1. open': string;
    '2. high': string;
    '3. low': string;
    '4. close': string;
    '5. volume': string;
  }>;
  'Global Quote'?: {
    '01. symbol': string;
    '02. open': string;
    '03. high': string;
    '04. low': string;
    '05. price': string;
    '06. volume': string;
    '07. latest trading day': string;
    '08. previous close': string;
    '09. change': string;
    '10. change percent': string;
  };
}

/**
 * FRED API响应接口
 */
interface FREDResponse {
  realtime_start: string;
  realtime_end: string;
  observation_start: string;
  observation_end: string;
  units: string;
  output_type: number;
  file_type: string;
  order_by: string;
  sort_order: string;
  count: number;
  offset: number;
  limit: number;
  observations: Array<{
    realtime_start: string;
    realtime_end: string;
    date: string;
    value: string;
  }>;
}

/**
 * 宏观经济数据服务
 * 集成Alpha Vantage和FRED API，提供关键宏观经济指标
 */
export class MacroEconomicDataService implements IDataSource {
  public readonly name = 'MacroEconomicDataService';
  public readonly type = DataSourceType.MACRO_ECONOMIC;
  public isEnabled: boolean = true;
  
  private alphaVantageClient: AxiosInstance;
  private fredClient: AxiosInstance;
  private cacheManager: SmartCacheManager;
  
  private status: DataSourceStatus;
  private lastUpdate: number = 0;
  private errorCount: number = 0;
  private successCount: number = 0;
  private responseTimes: number[] = [];
  
  // API配置
  private readonly ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query';
  private readonly FRED_BASE_URL = 'https://api.stlouisfed.org/fred';
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1小时缓存（宏观数据更新较慢）
  
  // API密钥
  private readonly alphaVantageApiKey = process.env.ALPHA_VANTAGE_API_KEY || '';
  private readonly fredApiKey = process.env.FRED_API_KEY || '';
  
  // 数据映射配置
  private readonly FRED_SERIES_MAP = {
    dxy: 'DTWEXBGS',           // 美元指数
    yield10y: 'GS10',          // 10年期美债收益率
    yield2y: 'GS2',            // 2年期美债收益率
    cpi: 'CPIAUCSL',           // CPI
    unemploymentRate: 'UNRATE', // 失业率
    fedFundsRate: 'FEDFUNDS',  // 联邦基金利率
    m2MoneySupply: 'M2SL'      // M2货币供应量
  };
  
  private readonly ALPHA_VANTAGE_SYMBOLS = {
    nasdaq: 'IXIC',            // 纳斯达克
    sp500: 'SPX',              // 标普500
    vix: 'VIX',                // 恐慌指数
    gold: 'GLD',               // 黄金ETF
    oil: 'USO'                 // 原油ETF
  };
  
  constructor() {
    this.cacheManager = new SmartCacheManager({
      maxSize: 5 * 1024 * 1024, // 5MB
      defaultTTL: this.CACHE_TTL,
      maxItems: 500
    });
    
    this.alphaVantageClient = axios.create({
      baseURL: this.ALPHA_VANTAGE_BASE_URL,
      timeout: 15000
    });
    
    this.fredClient = axios.create({
      baseURL: this.FRED_BASE_URL,
      timeout: 15000
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
    // Alpha Vantage拦截器
    this.alphaVantageClient.interceptors.request.use(
      (config) => {
        (config as any).metadata = { startTime: Date.now() };
        return config;
      }
    );
    
    this.alphaVantageClient.interceptors.response.use(
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
    
    // FRED拦截器
    this.fredClient.interceptors.request.use(
      (config) => {
        (config as any).metadata = { startTime: Date.now() };
        return config;
      }
    );
    
    this.fredClient.interceptors.response.use(
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
    console.log('[MacroEconomicDataService] Initializing...');
    
    // 检查API密钥
    if (!this.alphaVantageApiKey) {
      console.warn('[MacroEconomicDataService] Alpha Vantage API key not found, some features will be disabled');
    }
    
    if (!this.fredApiKey) {
      console.warn('[MacroEconomicDataService] FRED API key not found, some features will be disabled');
    }
    
    // 测试连接
    try {
      await this.testConnections();
      this.status.isActive = true;
      console.log('[MacroEconomicDataService] Initialized successfully');
    } catch (error) {
      console.error('[MacroEconomicDataService] Failed to initialize:', error);
      this.status.isActive = false;
      throw error;
    }
  }
  
  /**
   * 测试API连接
   */
  private async testConnections(): Promise<void> {
    const promises: Promise<any>[] = [];
    
    // 测试Alpha Vantage连接
    if (this.alphaVantageApiKey) {
      promises.push(
        this.alphaVantageClient.get('', {
          params: {
            function: 'GLOBAL_QUOTE',
            symbol: 'SPY', // 测试用标普500 ETF
            apikey: this.alphaVantageApiKey
          }
        })
      );
    }
    
    // 测试FRED连接
    if (this.fredApiKey) {
      promises.push(
        this.fredClient.get('/series/observations', {
          params: {
            series_id: 'GS10', // 10年期美债收益率
            api_key: this.fredApiKey,
            file_type: 'json',
            limit: 1,
            sort_order: 'desc'
          }
        })
      );
    }
    
    if (promises.length === 0) {
      throw new Error('No API keys configured');
    }
    
    await Promise.all(promises);
  }
  
  /**
   * 获取宏观经济数据
   */
  public async fetchData(symbol: string = 'USD'): Promise<MacroEconomicData> {
    const cacheKey = `macro_${symbol}`;
    
    // 尝试从缓存获取
    const cached = this.cacheManager.get(cacheKey);
    if (cached) {
      return cached as MacroEconomicData;
    }
    
    console.log(`[MacroEconomicDataService] Fetching macro economic data...`);
    
    const macroData: MacroEconomicData = {};
    
    // 并行获取各种宏观数据
    const dataPromises: Promise<void>[] = [];
    
    // 获取FRED数据
    if (this.fredApiKey) {
      for (const [key, seriesId] of Object.entries(this.FRED_SERIES_MAP)) {
        dataPromises.push(
          this.fetchFREDSeries(seriesId).then(value => {
            (macroData as any)[key] = value;
          }).catch(error => {
            console.warn(`[MacroEconomicDataService] Failed to fetch ${key}:`, error.message);
          })
        );
      }
    }
    
    // 获取Alpha Vantage数据
    if (this.alphaVantageApiKey) {
      for (const [key, symbol] of Object.entries(this.ALPHA_VANTAGE_SYMBOLS)) {
        dataPromises.push(
          this.fetchAlphaVantageQuote(symbol).then(value => {
            (macroData as any)[key] = value;
          }).catch(error => {
            console.warn(`[MacroEconomicDataService] Failed to fetch ${key}:`, error.message);
          })
        );
      }
    }
    
    // 等待所有数据获取完成
    await Promise.allSettled(dataPromises);
    
    // 计算衍生指标
    if (macroData.yield10y && macroData.yield2y) {
      macroData.yieldSpread = macroData.yield10y - macroData.yield2y;
    }
    
    // 缓存结果
    this.cacheManager.set(cacheKey, macroData, undefined, this.CACHE_TTL);
    this.lastUpdate = Date.now();
    
    console.log(`[MacroEconomicDataService] Fetched macro data:`, macroData);
    return macroData;
  }
  
  /**
   * 获取FRED数据系列
   */
  private async fetchFREDSeries(seriesId: string): Promise<number> {
    const response = await this.fredClient.get<FREDResponse>('/series/observations', {
      params: {
        series_id: seriesId,
        api_key: this.fredApiKey,
        file_type: 'json',
        limit: 1,
        sort_order: 'desc'
      }
    });
    
    if (response.data.observations && response.data.observations.length > 0) {
      const latestValue = response.data.observations[0].value;
      if (latestValue !== '.') { // FRED用'.'表示无数据
        return parseFloat(latestValue);
      }
    }
    
    throw new Error(`No data available for series: ${seriesId}`);
  }
  
  /**
   * 获取Alpha Vantage报价
   */
  private async fetchAlphaVantageQuote(symbol: string): Promise<number> {
    const response = await this.alphaVantageClient.get<AlphaVantageResponse>('', {
      params: {
        function: 'GLOBAL_QUOTE',
        symbol: symbol,
        apikey: this.alphaVantageApiKey
      }
    });
    
    if (response.data['Global Quote']) {
      const price = response.data['Global Quote']['05. price'];
      return parseFloat(price);
    }
    
    throw new Error(`No quote data available for symbol: ${symbol}`);
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
    console.log('[MacroEconomicDataService] Shutting down...');
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
    console.log('[MacroEconomicDataService] Cache cleared');
  }
}

// 导出单例实例
export const macroEconomicDataService = new MacroEconomicDataService();