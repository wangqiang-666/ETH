import axios, { AxiosInstance } from 'axios';
import { config } from '../config.js';
import { IDataSource, DataSourceType, DataSourceStatus } from './data-aggregator-service.js';
import { SmartCacheManager } from '../utils/smart-cache-manager.js';

/**
 * 链上数据接口
 */
export interface OnchainData {
  // 以太坊网络指标
  stakingRatio?: number;           // 质押比例
  activeAddresses?: number;        // 活跃地址数
  gasPrice?: number;              // Gas价格 (Gwei)
  networkHashrate?: number;       // 网络算力
  blockTime?: number;             // 出块时间
  
  // DeFi指标
  tvl?: number;                   // 总锁仓价值
  defiDominance?: number;         // DeFi市值占比
  
  // 大户行为
  whaleMovements?: number;        // 大户转账数量
  exchangeInflow?: number;        // 交易所流入
  exchangeOutflow?: number;       // 交易所流出
  netExchangeFlow?: number;       // 净流入/流出
  
  // 持仓分布
  hodlerRatio?: number;           // 长期持有者比例
  shortTermHolders?: number;      // 短期持有者比例
  
  // 网络使用情况
  transactionCount?: number;      // 交易数量
  averageFee?: number;           // 平均手续费
  networkUtilization?: number;   // 网络利用率
}

/**
 * Glassnode API响应接口
 */
interface GlassnodeResponse {
  t: number;  // timestamp
  v: number;  // value
}

/**
 * Etherscan API响应接口
 */
interface EtherscanGasResponse {
  status: string;
  message: string;
  result: {
    SafeGasPrice: string;
    ProposeGasPrice: string;
    FastGasPrice: string;
  };
}

/**
 * 链上数据服务
 * 集成多个链上数据源，提供以太坊网络的关键指标
 */
export class OnchainDataService implements IDataSource {
  public readonly name = 'OnchainDataService';
  public readonly type = DataSourceType.ONCHAIN;
  public isEnabled: boolean = true;
  
  private glassnodeClient: AxiosInstance;
  private etherscanClient: AxiosInstance;
  private cacheManager: SmartCacheManager;
  
  private status: DataSourceStatus;
  private lastUpdate: number = 0;
  private errorCount: number = 0;
  private successCount: number = 0;
  private responseTimes: number[] = [];
  
  // API配置
  private readonly GLASSNODE_BASE_URL = 'https://api.glassnode.com';
  private readonly ETHERSCAN_BASE_URL = 'https://api.etherscan.io/api';
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存
  
  // API密钥（从环境变量获取）
  private readonly glassnodeApiKey = process.env.GLASSNODE_API_KEY || '';
  private readonly etherscanApiKey = process.env.ETHERSCAN_API_KEY || '';
  
  constructor() {
    this.cacheManager = new SmartCacheManager({
      maxSize: 10 * 1024 * 1024, // 10MB
      defaultTTL: this.CACHE_TTL,
      maxItems: 1000
    });
    
    this.glassnodeClient = axios.create({
      baseURL: this.GLASSNODE_BASE_URL,
      timeout: 10000,
      headers: {
        'X-API-KEY': this.glassnodeApiKey
      }
    });
    
    this.etherscanClient = axios.create({
      baseURL: this.ETHERSCAN_BASE_URL,
      timeout: 10000
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
    // Glassnode拦截器
    this.glassnodeClient.interceptors.request.use(
      (config) => {
        (config as any).metadata = { startTime: Date.now() };
        return config;
      }
    );
    
    this.glassnodeClient.interceptors.response.use(
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
    
    // Etherscan拦截器
    this.etherscanClient.interceptors.request.use(
      (config) => {
        (config as any).metadata = { startTime: Date.now() };
        return config;
      }
    );
    
    this.etherscanClient.interceptors.response.use(
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
    console.log('[OnchainDataService] Initializing...');
    
    // 检查API密钥
    if (!this.glassnodeApiKey) {
      console.warn('[OnchainDataService] Glassnode API key not found, some features will be disabled');
    }
    
    if (!this.etherscanApiKey) {
      console.warn('[OnchainDataService] Etherscan API key not found, some features will be disabled');
    }
    
    // 测试连接
    try {
      await this.testConnections();
      this.status.isActive = true;
      console.log('[OnchainDataService] Initialized successfully');
    } catch (error) {
      console.error('[OnchainDataService] Failed to initialize:', error);
      this.status.isActive = false;
      throw error;
    }
  }
  
  /**
   * 测试API连接
   */
  private async testConnections(): Promise<void> {
    const promises: Promise<any>[] = [];
    
    // 测试Etherscan连接（获取Gas价格）
    if (this.etherscanApiKey) {
      promises.push(
        this.etherscanClient.get('', {
          params: {
            module: 'gastracker',
            action: 'gasoracle',
            apikey: this.etherscanApiKey
          }
        })
      );
    }
    
    // 测试Glassnode连接（获取活跃地址）
    if (this.glassnodeApiKey) {
      promises.push(
        this.glassnodeClient.get('/v1/metrics/addresses/active_count', {
          params: {
            a: 'ETH',
            s: Math.floor(Date.now() / 1000) - 86400, // 1天前
            u: Math.floor(Date.now() / 1000)
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
   * 获取链上数据
   */
  public async fetchData(symbol: string = 'ETH'): Promise<OnchainData> {
    const cacheKey = `onchain_${symbol}`;
    
    // 尝试从缓存获取
    const cached = this.cacheManager.get(cacheKey);
    if (cached) {
      return cached as OnchainData;
    }
    
    console.log(`[OnchainDataService] Fetching onchain data for ${symbol}...`);
    
    const onchainData: OnchainData = {};
    
    // 并行获取各种链上数据
    const dataPromises: Promise<void>[] = [];
    
    // 获取Gas价格
    if (this.etherscanApiKey) {
      dataPromises.push(this.fetchGasPrice().then(gasPrice => {
        onchainData.gasPrice = gasPrice;
      }).catch(error => {
        console.warn('[OnchainDataService] Failed to fetch gas price:', error.message);
      }));
    }
    
    // 获取Glassnode数据
    if (this.glassnodeApiKey) {
      // 活跃地址
      dataPromises.push(this.fetchGlassnodeMetric('addresses/active_count').then(value => {
        onchainData.activeAddresses = value;
      }).catch(error => {
        console.warn('[OnchainDataService] Failed to fetch active addresses:', error.message);
      }));
      
      // 质押比例
      dataPromises.push(this.fetchGlassnodeMetric('eth2/staking_ratio').then(value => {
        onchainData.stakingRatio = value;
      }).catch(error => {
        console.warn('[OnchainDataService] Failed to fetch staking ratio:', error.message);
      }));
      
      // 交易所流入流出
      dataPromises.push(this.fetchGlassnodeMetric('transactions/transfers_volume_exchanges_net').then(value => {
        onchainData.netExchangeFlow = value;
      }).catch(error => {
        console.warn('[OnchainDataService] Failed to fetch exchange flow:', error.message);
      }));
      
      // 长期持有者比例
      dataPromises.push(this.fetchGlassnodeMetric('supply/lth_supply').then(value => {
        onchainData.hodlerRatio = value;
      }).catch(error => {
        console.warn('[OnchainDataService] Failed to fetch hodler ratio:', error.message);
      }));
    }
    
    // 等待所有数据获取完成
    await Promise.allSettled(dataPromises);
    
    // 缓存结果
    this.cacheManager.set(cacheKey, onchainData, undefined, this.CACHE_TTL);
    this.lastUpdate = Date.now();
    
    console.log(`[OnchainDataService] Fetched onchain data:`, onchainData);
    return onchainData;
  }
  
  /**
   * 获取Gas价格
   */
  private async fetchGasPrice(): Promise<number> {
    const response = await this.etherscanClient.get<EtherscanGasResponse>('', {
      params: {
        module: 'gastracker',
        action: 'gasoracle',
        apikey: this.etherscanApiKey
      }
    });
    
    if (response.data.status === '1') {
      return parseFloat(response.data.result.ProposeGasPrice);
    }
    
    throw new Error(`Etherscan API error: ${response.data.message}`);
  }
  
  /**
   * 获取Glassnode指标
   */
  private async fetchGlassnodeMetric(metric: string): Promise<number> {
    const response = await this.glassnodeClient.get<GlassnodeResponse[]>(`/v1/metrics/${metric}`, {
      params: {
        a: 'ETH',
        s: Math.floor(Date.now() / 1000) - 86400, // 1天前
        u: Math.floor(Date.now() / 1000)
      }
    });
    
    if (response.data && response.data.length > 0) {
      return response.data[response.data.length - 1].v; // 返回最新值
    }
    
    throw new Error(`No data returned for metric: ${metric}`);
  }
  
  /**
   * 记录成功请求
   */
  private recordSuccess(responseTime: number): void {
    this.successCount++;
    this.responseTimes.push(responseTime);
    
    // 保持最近100次请求的响应时间
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
    console.log('[OnchainDataService] Shutting down...');
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
    console.log('[OnchainDataService] Cache cleared');
  }
}

// 导出单例实例
export const onchainDataService = new OnchainDataService();