import axios, { AxiosInstance } from 'axios';
import { config } from '../config.js';
import { IDataSource, DataSourceType, DataSourceStatus } from './data-aggregator-service.js';
import { SmartCacheManager } from '../utils/smart-cache-manager.js';

/**
 * 大户交易数据接口
 */
export interface WhaleTransaction {
  id: string;
  timestamp: number;
  blockchain: string;
  symbol: string;
  amount: number;
  amountUSD: number;
  from: string;
  to: string;
  transactionType: 'transfer' | 'exchange_deposit' | 'exchange_withdrawal' | 'unknown';
  exchangeName?: string;
  hash: string;
}

/**
 * 大户监控数据接口
 */
export interface WhaleMonitoringData {
  symbol: string;
  timestamp: number;
  
  // 实时大户活动
  recentTransactions: WhaleTransaction[];
  
  // 交易所资金流向
  exchangeFlows: {
    totalInflow: number;        // 总流入 (USD)
    totalOutflow: number;       // 总流出 (USD)
    netFlow: number;           // 净流向 (USD)
    inflowCount: number;       // 流入笔数
    outflowCount: number;      // 流出笔数
    
    // 按交易所分类
    byExchange: Record<string, {
      inflow: number;
      outflow: number;
      netFlow: number;
      transactionCount: number;
    }>;
  };
  
  // 大户行为分析
  whaleActivity: {
    activeWhales: number;           // 活跃大户数量
    averageTransactionSize: number; // 平均交易规模
    largestTransaction: number;     // 最大单笔交易
    totalVolume24h: number;        // 24小时总交易量
    
    // 情绪指标
    sentiment: 'bullish' | 'bearish' | 'neutral';
    confidenceLevel: number;       // 置信度 0-1
    
    // 行为模式
    patterns: {
      accumulation: boolean;      // 是否在积累
      distribution: boolean;      // 是否在分发
      hodling: boolean;          // 是否在持有
    };
  };
  
  // 预警信号
  alerts: Array<{
    type: 'large_deposit' | 'large_withdrawal' | 'unusual_activity' | 'exchange_concentration';
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    amount?: number;
    exchange?: string;
    timestamp: number;
  }>;
}

/**
 * Whale Alert API响应接口
 */
interface WhaleAlertResponse {
  result: 'success' | 'error';
  cursor?: {
    more: boolean;
    next?: string;
  };
  count: number;
  transactions: Array<{
    blockchain: string;
    symbol: string;
    id: string;
    transaction_type: string;
    hash: string;
    from: {
      address: string;
      owner?: string;
      owner_type?: string;
    };
    to: {
      address: string;
      owner?: string;
      owner_type?: string;
    };
    timestamp: number;
    amount: number;
    amount_usd: number;
    transaction_count?: number;
  }>;
}

/**
 * 大户资金监控服务
 * 监控大额资金进出交易所，提供市场情绪预警
 */
export class WhaleMonitoringService implements IDataSource {
  public readonly name = 'WhaleMonitoringService';
  public readonly type = DataSourceType.WHALE_MONITORING;
  public isEnabled: boolean = true;
  
  private whaleAlertClient: AxiosInstance;
  private cacheManager: SmartCacheManager;
  
  private status: DataSourceStatus = {
    name: 'WhaleMonitoringService',
    type: DataSourceType.WHALE_MONITORING,
    isActive: false,
    lastUpdate: 0,
    errorCount: 0,
    successRate: 0,
    avgResponseTime: 0
  };
  private lastUpdate: number = 0;
  private errorCount: number = 0;
  private successCount: number = 0;
  private responseTimes: number[] = [];
  
  // API配置
  private readonly WHALE_ALERT_BASE_URL = 'https://api.whale-alert.io';
  private readonly CACHE_TTL = 2 * 60 * 1000; // 2分钟缓存（大户数据需要较高实时性）
  
  // 监控阈值
  private readonly MIN_TRANSACTION_USD = 100000; // 最小监控金额 $100k
  private readonly LARGE_TRANSACTION_USD = 1000000; // 大额交易阈值 $1M
  private readonly CRITICAL_TRANSACTION_USD = 10000000; // 关键交易阈值 $10M
  
  // API密钥
  private readonly whaleAlertApiKey = process.env.WHALE_ALERT_API_KEY || '';
  
  constructor() {
    this.cacheManager = new SmartCacheManager({
      maxItems: 1000,
      defaultTTL: this.CACHE_TTL
    });
    
    this.whaleAlertClient = axios.create({
      baseURL: this.WHALE_ALERT_BASE_URL,
      timeout: 15000,
      headers: {
        'User-Agent': 'ETH-Quant-System/1.0'
      }
    });
    
    this.setupInterceptors();
    this.initializeStatus();
  }
  
  /**
   * 设置请求拦截器
   */
  private setupInterceptors(): void {
    // 请求拦截器
    this.whaleAlertClient.interceptors.request.use(
      (config) => {
        (config as any).metadata = { startTime: Date.now() };
        return config;
      }
    );
    
    // 响应拦截器
    this.whaleAlertClient.interceptors.response.use(
      (response) => {
        const responseTime = Date.now() - (response.config as any).metadata.startTime;
        this.recordSuccess(responseTime);
        return response;
      },
      (error) => {
        const responseTime = Date.now() - (error.config as any)?.metadata?.startTime || 0;
        this.recordError(responseTime);
        return Promise.reject(error);
      }
    );
  }
  
  /**
   * 初始化状态
   */
  private initializeStatus(): void {
    this.status = {
      name: this.name,
      type: this.type,
      isActive: false,
      lastUpdate: 0,
      errorCount: 0,
      successRate: 0,
      avgResponseTime: 0
    };
  }
  
  /**
   * 初始化服务
   */
  public async initialize(): Promise<void> {
    console.log('[WhaleMonitoringService] Initializing whale monitoring service...');
    
    try {
      await this.testConnection();
      this.status.isActive = true;
      console.log('[WhaleMonitoringService] Initialized successfully');
    } catch (error) {
      console.error('[WhaleMonitoringService] Failed to initialize:', error);
      this.status.isActive = false;
      throw error;
    }
  }
  
  /**
   * 测试连接
   */
  private async testConnection(): Promise<void> {
    if (!this.whaleAlertApiKey) {
      console.warn('[WhaleMonitoringService] No API key provided, using demo mode');
      return;
    }
    
    try {
      const response = await this.whaleAlertClient.get('/v1/status', {
        params: {
          api_key: this.whaleAlertApiKey
        }
      });
      
      if (response.data.result !== 'success') {
        throw new Error('API connection test failed');
      }
    } catch (error) {
      console.error('[WhaleMonitoringService] Connection test failed:', error);
      throw error;
    }
  }
  
  /**
   * 获取大户监控数据
   */
  public async fetchData(symbol: string = 'ETH'): Promise<WhaleMonitoringData> {
    const cacheKey = `whale_monitoring_${symbol}`;
    
    // 尝试从缓存获取
    const cached = this.cacheManager.get(cacheKey);
    if (cached) {
      return cached as WhaleMonitoringData;
    }
    
    console.log(`[WhaleMonitoringService] Fetching whale monitoring data for ${symbol}...`);
    
    try {
      // 获取最近的大户交易
      const recentTransactions = await this.fetchRecentTransactions(symbol);
      
      // 分析交易所资金流向
      const exchangeFlows = this.analyzeExchangeFlows(recentTransactions);
      
      // 分析大户行为
      const whaleActivity = this.analyzeWhaleActivity(recentTransactions);
      
      // 生成预警信号
      const alerts = this.generateAlerts(recentTransactions, exchangeFlows, whaleActivity);
      
      const monitoringData: WhaleMonitoringData = {
        symbol,
        timestamp: Date.now(),
        recentTransactions,
        exchangeFlows,
        whaleActivity,
        alerts
      };
      
      // 缓存结果
      this.cacheManager.set(cacheKey, monitoringData, undefined, this.CACHE_TTL);
      this.lastUpdate = Date.now();
      
      console.log(`[WhaleMonitoringService] Processed ${recentTransactions.length} whale transactions`);
      return monitoringData;
      
    } catch (error) {
      console.error('[WhaleMonitoringService] Failed to fetch whale monitoring data:', error);
      throw error;
    }
  }
  
  /**
   * 获取最近的大户交易
   */
  private async fetchRecentTransactions(symbol: string): Promise<WhaleTransaction[]> {
    if (!this.whaleAlertApiKey) {
      // 演示模式：返回模拟数据
      return this.generateDemoTransactions(symbol);
    }
    
    try {
      const response = await this.whaleAlertClient.get<WhaleAlertResponse>('/v1/transactions', {
        params: {
          api_key: this.whaleAlertApiKey,
          blockchain: 'ethereum',
          symbol: symbol.toLowerCase(),
          min_value: this.MIN_TRANSACTION_USD,
          limit: 100,
          start: Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000) // 24小时前
        }
      });
      
      if (response.data.result !== 'success') {
        throw new Error('Failed to fetch whale transactions');
      }
      
      return response.data.transactions.map(tx => ({
        id: tx.id,
        timestamp: tx.timestamp * 1000,
        blockchain: tx.blockchain,
        symbol: tx.symbol.toUpperCase(),
        amount: tx.amount,
        amountUSD: tx.amount_usd,
        from: tx.from.address,
        to: tx.to.address,
        transactionType: this.classifyTransactionType(tx),
        exchangeName: tx.to.owner || tx.from.owner,
        hash: tx.hash
      }));
      
    } catch (error) {
      console.error('[WhaleMonitoringService] Failed to fetch transactions:', error);
      return [];
    }
  }
  
  /**
   * 分类交易类型
   */
  private classifyTransactionType(tx: any): WhaleTransaction['transactionType'] {
    const fromType = tx.from.owner_type;
    const toType = tx.to.owner_type;
    
    if (toType === 'exchange') {
      return 'exchange_deposit';
    } else if (fromType === 'exchange') {
      return 'exchange_withdrawal';
    } else if (fromType && toType) {
      return 'transfer';
    }
    
    return 'unknown';
  }
  
  /**
   * 分析交易所资金流向
   */
  private analyzeExchangeFlows(transactions: WhaleTransaction[]): WhaleMonitoringData['exchangeFlows'] {
    const flows = {
      totalInflow: 0,
      totalOutflow: 0,
      netFlow: 0,
      inflowCount: 0,
      outflowCount: 0,
      byExchange: {} as Record<string, any>
    };
    
    transactions.forEach(tx => {
      if (tx.transactionType === 'exchange_deposit') {
        flows.totalInflow += tx.amountUSD;
        flows.inflowCount++;
        
        if (tx.exchangeName) {
          if (!flows.byExchange[tx.exchangeName]) {
            flows.byExchange[tx.exchangeName] = {
              inflow: 0,
              outflow: 0,
              netFlow: 0,
              transactionCount: 0
            };
          }
          flows.byExchange[tx.exchangeName].inflow += tx.amountUSD;
          flows.byExchange[tx.exchangeName].transactionCount++;
        }
      } else if (tx.transactionType === 'exchange_withdrawal') {
        flows.totalOutflow += tx.amountUSD;
        flows.outflowCount++;
        
        if (tx.exchangeName) {
          if (!flows.byExchange[tx.exchangeName]) {
            flows.byExchange[tx.exchangeName] = {
              inflow: 0,
              outflow: 0,
              netFlow: 0,
              transactionCount: 0
            };
          }
          flows.byExchange[tx.exchangeName].outflow += tx.amountUSD;
          flows.byExchange[tx.exchangeName].transactionCount++;
        }
      }
    });
    
    flows.netFlow = flows.totalInflow - flows.totalOutflow;
    
    // 计算各交易所净流向
    Object.keys(flows.byExchange).forEach(exchange => {
      const ex = flows.byExchange[exchange];
      ex.netFlow = ex.inflow - ex.outflow;
    });
    
    return flows;
  }
  
  /**
   * 分析大户行为
   */
  private analyzeWhaleActivity(transactions: WhaleTransaction[]): WhaleMonitoringData['whaleActivity'] {
    const uniqueAddresses = new Set();
    let totalVolume = 0;
    let largestTransaction = 0;
    
    transactions.forEach(tx => {
      uniqueAddresses.add(tx.from);
      uniqueAddresses.add(tx.to);
      totalVolume += tx.amountUSD;
      largestTransaction = Math.max(largestTransaction, tx.amountUSD);
    });
    
    const averageTransactionSize = transactions.length > 0 ? totalVolume / transactions.length : 0;
    
    // 分析情绪和模式
    const depositCount = transactions.filter(tx => tx.transactionType === 'exchange_deposit').length;
    const withdrawalCount = transactions.filter(tx => tx.transactionType === 'exchange_withdrawal').length;
    
    let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidenceLevel = 0.5;
    
    if (withdrawalCount > depositCount * 1.5) {
      sentiment = 'bullish';
      confidenceLevel = Math.min(0.9, 0.5 + (withdrawalCount - depositCount) / transactions.length);
    } else if (depositCount > withdrawalCount * 1.5) {
      sentiment = 'bearish';
      confidenceLevel = Math.min(0.9, 0.5 + (depositCount - withdrawalCount) / transactions.length);
    }
    
    return {
      activeWhales: uniqueAddresses.size,
      averageTransactionSize,
      largestTransaction,
      totalVolume24h: totalVolume,
      sentiment,
      confidenceLevel,
      patterns: {
        accumulation: withdrawalCount > depositCount,
        distribution: depositCount > withdrawalCount,
        hodling: Math.abs(depositCount - withdrawalCount) < 3
      }
    };
  }
  
  /**
   * 生成预警信号
   */
  private generateAlerts(
    transactions: WhaleTransaction[],
    flows: WhaleMonitoringData['exchangeFlows'],
    activity: WhaleMonitoringData['whaleActivity']
  ): WhaleMonitoringData['alerts'] {
    const alerts: WhaleMonitoringData['alerts'] = [];
    
    // 大额交易预警
    transactions.forEach(tx => {
      if (tx.amountUSD >= this.CRITICAL_TRANSACTION_USD) {
        alerts.push({
          type: tx.transactionType === 'exchange_deposit' ? 'large_deposit' : 'large_withdrawal',
          severity: 'critical',
          message: `检测到超大额${tx.transactionType === 'exchange_deposit' ? '流入' : '流出'}: $${(tx.amountUSD / 1000000).toFixed(1)}M`,
          amount: tx.amountUSD,
          exchange: tx.exchangeName,
          timestamp: tx.timestamp
        });
      } else if (tx.amountUSD >= this.LARGE_TRANSACTION_USD) {
        alerts.push({
          type: tx.transactionType === 'exchange_deposit' ? 'large_deposit' : 'large_withdrawal',
          severity: 'high',
          message: `检测到大额${tx.transactionType === 'exchange_deposit' ? '流入' : '流出'}: $${(tx.amountUSD / 1000000).toFixed(1)}M`,
          amount: tx.amountUSD,
          exchange: tx.exchangeName,
          timestamp: tx.timestamp
        });
      }
    });
    
    // 异常活动预警
    if (activity.totalVolume24h > 100000000) { // $100M
      alerts.push({
        type: 'unusual_activity',
        severity: 'high',
        message: `24小时大户交易量异常: $${(activity.totalVolume24h / 1000000).toFixed(0)}M`,
        timestamp: Date.now()
      });
    }
    
    // 交易所集中度预警
    Object.entries(flows.byExchange).forEach(([exchange, data]) => {
      if (Math.abs(data.netFlow) > 50000000) { // $50M
        alerts.push({
          type: 'exchange_concentration',
          severity: data.netFlow > 0 ? 'medium' : 'high',
          message: `${exchange}出现大额${data.netFlow > 0 ? '流入' : '流出'}: $${(Math.abs(data.netFlow) / 1000000).toFixed(1)}M`,
          exchange,
          timestamp: Date.now()
        });
      }
    });
    
    return alerts.sort((a, b) => b.timestamp - a.timestamp);
  }
  
  /**
   * 生成演示数据
   */
  private generateDemoTransactions(symbol: string): WhaleTransaction[] {
    const transactions: WhaleTransaction[] = [];
    const now = Date.now();
    
    // 生成一些模拟的大户交易
    for (let i = 0; i < 10; i++) {
      const isDeposit = Math.random() > 0.6; // 40%概率是存入
      const amount = 100 + Math.random() * 1000; // 100-1100 ETH
      const usdAmount = amount * 4000; // 假设ETH价格$4000
      
      transactions.push({
        id: `demo_${i}`,
        timestamp: now - Math.random() * 24 * 60 * 60 * 1000,
        blockchain: 'ethereum',
        symbol: symbol.toUpperCase(),
        amount,
        amountUSD: usdAmount,
        from: `0x${Math.random().toString(16).substr(2, 40)}`,
        to: `0x${Math.random().toString(16).substr(2, 40)}`,
        transactionType: isDeposit ? 'exchange_deposit' : 'exchange_withdrawal',
        exchangeName: ['Binance', 'Coinbase', 'Kraken', 'Bitfinex'][Math.floor(Math.random() * 4)],
        hash: `0x${Math.random().toString(16).substr(2, 64)}`
      });
    }
    
    return transactions.sort((a, b) => b.timestamp - a.timestamp);
  }
  
  /**
   * 记录成功请求
   */
  private recordSuccess(responseTime: number): void {
    this.successCount++;
    this.responseTimes.push(responseTime);
    if (this.responseTimes.length > 100) {
      this.responseTimes = this.responseTimes.slice(-50);
    }
    this.updateStatus();
  }
  
  /**
   * 记录失败请求
   */
  private recordError(responseTime: number): void {
    this.errorCount++;
    this.responseTimes.push(responseTime);
    if (this.responseTimes.length > 100) {
      this.responseTimes = this.responseTimes.slice(-50);
    }
    this.updateStatus();
  }
  
  /**
   * 更新状态
   */
  private updateStatus(): void {
    const totalRequests = this.successCount + this.errorCount;
    this.status.successRate = totalRequests > 0 ? this.successCount / totalRequests : 0;
    this.status.errorCount = this.errorCount;
    this.status.lastUpdate = this.lastUpdate;
    this.status.avgResponseTime = this.responseTimes.length > 0 
      ? this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length 
      : 0;
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
    console.log('[WhaleMonitoringService] Shutting down...');
    this.status.isActive = false;
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
    console.log('[WhaleMonitoringService] Cache cleared');
  }
}

// 导出单例实例
export const whaleMonitoringService = new WhaleMonitoringService();