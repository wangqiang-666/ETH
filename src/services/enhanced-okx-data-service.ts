import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../config';
import type { MarketData, KlineData, ContractInfo } from './okx-data-service';
import { EventEmitter } from 'events';
import * as dns from 'dns';
import { promisify } from 'util';
import * as http from 'http';
import * as https from 'https';
import { dataCompressionService, DataCompressionService } from '../utils/data-compression';
import { SmartCacheManager } from '../utils/smart-cache-manager';
import { ErrorRecoveryManager } from '../utils/error-recovery-manager';
import { PerformanceMonitor } from '../utils/performance-monitor';
// 新增：引入网络性能分析器
import { networkPerformanceAnalyzer } from '../utils/network-performance-analyzer';

// 连接状态枚举
enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
  RECONNECTING = 'reconnecting'
}

// 重试配置接口
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
  jitter: boolean;
}

// 连接健康状态接口
interface ConnectionHealth {
  status: ConnectionStatus;
  lastSuccessTime: number;
  lastErrorTime: number;
  consecutiveErrors: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  uptime: number;
}

// 请求统计接口
interface RequestStats {
  endpoint: string;
  count: number;
  successCount: number;
  errorCount: number;
  totalResponseTime: number;
  averageResponseTime: number;
  lastRequestTime: number;
}

// 错误分析接口
interface ErrorAnalysis {
  isRetryable: boolean;
  isProxyError: boolean;
  errorType: 'network' | 'timeout' | 'server' | 'client' | 'ratelimit' | 'dns' | 'proxy';
  severity: 'low' | 'medium' | 'high';
  suggestedDelay: number;
}

/**
 * 增强的OKX数据服务
 * 提供更好的错误处理、重试机制、连接池管理和故障恢复功能
 */
export class EnhancedOKXDataService extends EventEmitter {
  private apiClient!: AxiosInstance;
  private proxyClient: AxiosInstance | null = null;
  private backupClient: AxiosInstance | null = null;
  private useProxy: boolean = true;
  private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private connectionHealth!: ConnectionHealth;
  private requestStats: Map<string, RequestStats> = new Map();
  private rateLimitDelay = 100;
  private lastRequestTime = 0;
  private circuitBreakerOpen = false;
  private circuitBreakerOpenTime = 0;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1分钟
  private readonly MAX_CONSECUTIVE_ERRORS = 10;
  
  // DNS解析相关
  private dnsLookup = promisify(dns.lookup);
  private customDnsServers = ['1.1.1.1', '8.8.8.8', '208.67.222.222']; // Cloudflare, Google, OpenDNS
  private hostsOverride: Map<string, string> = new Map();
  
  // 重试配置
  private retryConfig: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffFactor: 2,
    jitter: true
  };

  // 连接池配置 - 优化版
  private readonly CONNECTION_POOL_SIZE = 10; // 增加连接池大小
  private connectionPool: AxiosInstance[] = [];
  private currentConnectionIndex = 0;
  private connectionPoolStats: Map<number, { requests: number; errors: number; lastUsed: number }> = new Map();
  private readonly CONNECTION_IDLE_TIMEOUT = 30000; // 30秒空闲超时
  
  // 数据压缩相关
  private compressionService: DataCompressionService;
  private enableCompression = true;
  private compressionStats = {
    totalRequests: 0,
    compressedRequests: 0,
    totalBytesSaved: 0,
    avgCompressionRatio: 0
  };
  private cacheManager: SmartCacheManager;
  private errorRecoveryManager: ErrorRecoveryManager;
  private performanceMonitor: PerformanceMonitor;
  // 新增：网络性能分析集成字段
  private analyzerEnabled: boolean = true;
  private analyzerTimer?: NodeJS.Timeout;
  private healthTimer?: NodeJS.Timeout;
  private lastAnalyzerRecommendation: 'use_proxy' | 'use_direct' | 'optimize_proxy' | null = null;

  constructor() {
    super();
    this.compressionService = dataCompressionService;
    this.cacheManager = new SmartCacheManager({
      maxSize: 150 * 1024 * 1024, // 150MB
      maxItems: 15000,
      defaultTTL: 3 * 60 * 1000, // 3分钟
      cleanupInterval: 45 * 1000, // 45秒
      persistToDisk: true,
      compressionThreshold: 1024 // 1KB
    });
    this.errorRecoveryManager = new ErrorRecoveryManager({
      maxRetries: 5,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      jitterEnabled: true,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 60000
    });
    this.performanceMonitor = new PerformanceMonitor({
      metricsInterval: 10000, // 10秒
      historySize: 500,
      enableRealTimeAlerts: true,
      enablePerformanceLogging: false, // 避免日志过多
      logLevel: 'info'
    });
    // 按配置决定是否使用代理：当 FORCE_PROXY=true 或 USE_PROXY=true 时启用代理
    this.useProxy = !!(config.proxy.forceOnly || config.okx.useProxy);
    // 强制仅走代理模式提示
    if (config.proxy.forceOnly) {
      console.log('🔒 已启用强制代理模式：所有OKX请求将仅通过香港代理转发，直连已禁用');
    }
    // 新增：在强制代理模式下禁用网络性能分析，避免任何直连探测
    this.analyzerEnabled = !config.proxy.forceOnly;
    this.initializeConnectionHealth();
    this.initializeClients();
    this.startHealthMonitoring();
    
    // 初始化hosts覆盖，解决DNS问题
    this.hostsOverride.set('www.okx.com', '104.18.43.174');
    this.hostsOverride.set('okx.com', '172.64.144.82');
    this.hostsOverride.set('aws.okx.com', '104.18.43.174');
    
    console.log(`🗜️ 数据压缩: ${this.enableCompression ? '已启用' : '已禁用'}`);
    console.log(`💾 智能缓存: 已启用 (最大大小: 150MB, 最大项目: 15000)`);
     console.log(`🛡️ 错误恢复: 已启用 (最大重试: 5次, 熔断器阈值: 5次)`);
     console.log(`📊 性能监控: 已启用 (监控间隔: 10秒, 历史记录: 500条)`);
     
     // 设置备用端点
     this.setupFallbackEndpoints();
     
     // 设置性能监控事件监听
     this.setupPerformanceMonitoring();

     // 新增：启动网络性能分析监控
     this.startNetworkAnalysisMonitoring();
  }

  // 初始化连接健康状态
  private initializeConnectionHealth(): void {
    this.connectionHealth = {
      status: ConnectionStatus.DISCONNECTED,
      lastSuccessTime: 0,
      lastErrorTime: 0,
      consecutiveErrors: 0,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      uptime: Date.now()
    };
  }

  // 初始化客户端
  private initializeClients(): void {
    // 使用香港代理服务器作为主客户端
    if (this.useProxy) {
      console.log('🌐 使用香港代理服务器:', config.proxy.url);
      this.apiClient = this.createAxiosClient(config.proxy.url, {
        'OK-ACCESS-KEY': config.okx.apiKey,
        'OK-ACCESS-SIGN': '',
        'OK-ACCESS-TIMESTAMP': '',
        'OK-ACCESS-PASSPHRASE': config.okx.passphrase
      });
      this.proxyClient = this.apiClient; // 代理客户端就是主客户端
    } else {
      // 备用：直接连接OKX API
      this.apiClient = this.createAxiosClient(config.okx.baseUrl, {
        'OK-ACCESS-KEY': config.okx.apiKey,
        'OK-ACCESS-SIGN': '',
        'OK-ACCESS-TIMESTAMP': '',
        'OK-ACCESS-PASSPHRASE': config.okx.passphrase
      });
    }

    // 备用客户端（使用不同的域名）；强制代理模式下也指向代理
    this.backupClient = this.createAxiosClient(config.proxy.forceOnly ? config.proxy.url : 'https://okx.com', {
      'OK-ACCESS-KEY': config.okx.apiKey,
      'OK-ACCESS-SIGN': '',
      'OK-ACCESS-TIMESTAMP': '',
      'OK-ACCESS-PASSPHRASE': config.okx.passphrase
    });
  }

  // 新增：统一创建 Axios 客户端
  private createAxiosClient(baseURL: string, extraHeaders: Record<string, string> = {}): AxiosInstance {
    const isHttps = baseURL.startsWith('https');
    const pool = config.proxy.pool || { maxSockets: 20, maxFreeSockets: 10, keepAlive: true, keepAliveMsecs: 5000 } as any;

    // 在强制代理模式下禁用 keep-alive，避免部分代理对持久连接不稳定导致的 ECONNRESET
    const keepAliveEnabled = config.proxy.forceOnly ? false : !!pool.keepAlive;

    const httpAgent = new http.Agent({
      keepAlive: keepAliveEnabled,
      keepAliveMsecs: pool.keepAliveMsecs ?? 5000,
      maxSockets: pool.maxTotalSockets ?? pool.maxSockets ?? 20,
      maxFreeSockets: pool.maxFreeSockets ?? pool.maxFreeSockets ?? 10
    } as any);

    const httpsAgent = new https.Agent({
      keepAlive: keepAliveEnabled,
      keepAliveMsecs: pool.keepAliveMsecs ?? 5000,
      maxSockets: pool.maxTotalSockets ?? pool.maxSockets ?? 20,
      maxFreeSockets: pool.maxFreeSockets ?? pool.maxFreeSockets ?? 10
    } as any);

    const timeout = (this.useProxy ? config.proxy.timeout : config.okx.timeout) || 30000;

    const instance = axios.create({
      baseURL,
      timeout,
      httpAgent: isHttps ? undefined : httpAgent,
      httpsAgent: isHttps ? httpsAgent : undefined,
      headers: {
        'Content-Type': 'application/json',
        // 在代理-only 模式下显式关闭连接复用，兼容部分代理
        'Connection': keepAliveEnabled ? 'keep-alive' : 'close',
        'Proxy-Connection': keepAliveEnabled ? 'keep-alive' : 'close',
        ...extraHeaders
      }
    });

    // 请求拦截：可在此处注入签名/时间戳（如需要）
    instance.interceptors.request.use((req) => {
      // 这里保留占位逻辑，实际签名根据需要实现
      return req;
    });

    // 响应拦截：基础错误统计
    instance.interceptors.response.use(
      (res) => res,
      (error: AxiosError) => {
        // 简单上报到连接健康状态
        this.connectionHealth.failedRequests++;
        this.connectionHealth.lastErrorTime = Date.now();
        this.connectionHealth.consecutiveErrors++;
        return Promise.reject(error);
      }
    );

    return instance;
  }

  // 新增：获取下一个连接（懒初始化连接池）
  private getNextConnection(): AxiosInstance {
    // 若连接池未初始化，则根据当前模式批量创建
    if (this.connectionPool.length === 0) {
      const targetBase = (this.useProxy || config.proxy.forceOnly) ? config.proxy.url : config.okx.baseUrl;
      this.connectionPool = Array.from({ length: this.CONNECTION_POOL_SIZE }).map(() =>
        this.createAxiosClient(targetBase, {
          'OK-ACCESS-KEY': config.okx.apiKey,
          'OK-ACCESS-SIGN': '',
          'OK-ACCESS-TIMESTAMP': '',
          'OK-ACCESS-PASSPHRASE': config.okx.passphrase
        })
      );
      this.connectionPoolStats.clear();
      this.connectionPool.forEach((_, idx) => {
        this.connectionPoolStats.set(idx, { requests: 0, errors: 0, lastUsed: Date.now() });
      });
    }

    if (this.currentConnectionIndex >= this.connectionPool.length) {
      this.currentConnectionIndex = 0;
    }

    const index = this.currentConnectionIndex++;
    const client = this.connectionPool[index];
    const stats = this.connectionPoolStats.get(index);
    if (stats) stats.lastUsed = Date.now();
    return client;
  }

  // 选择最佳客户端（增强版）
  private selectBestClient(): AxiosInstance {
    // 强制仅走代理模式
    if (config.proxy.forceOnly && this.proxyClient) {
      return this.proxyClient;
    }
    // 优先依据网络分析器的实时建议
    if (this.analyzerEnabled && this.lastAnalyzerRecommendation) {
      if (this.lastAnalyzerRecommendation === 'use_proxy' && this.proxyClient) {
        return this.proxyClient;
      }
      if (this.lastAnalyzerRecommendation === 'use_direct') {
        // 直连优先：若主直连连续失败，仍可转向备用直连
        if (this.backupClient && this.connectionHealth.consecutiveErrors > 3) {
          console.log('🔄 切换到备用客户端');
          return this.backupClient;
        }
        return this.getNextConnection();
      }
    }

    // 保留原有逻辑作为回退
    if (this.useProxy && this.proxyClient) {
      return this.proxyClient;
    }
    
    if (this.backupClient && this.connectionHealth.consecutiveErrors > 3) {
      console.log('🔄 切换到备用客户端');
      return this.backupClient;
    }
    
    return this.getNextConnection();
  }

  // 智能故障转移
  private async performFailover(): Promise<void> {
    console.log('🔄 执行故障转移...');
    
    // 强制代理模式下，不切换到直连
    if (config.proxy.forceOnly) {
      console.log('🔒 强制代理模式生效，保持代理连接并重新初始化客户端');
      this.useProxy = true;
      // 重新初始化客户端
      this.initializeClients();
      // 重置连接健康状态
      this.connectionHealth.consecutiveErrors = 0;
      this.connectionStatus = ConnectionStatus.RECONNECTING;
      // 发出故障转移事件
      this.emit('failover', { useProxy: this.useProxy });
      return;
    }
    
    // 1. 尝试切换代理模式
    if (this.useProxy) {
      console.log('📡 切换到直连模式');
      this.useProxy = false;
    } else {
      console.log('🌐 切换到代理模式');
      this.useProxy = true;
    }
    
    // 2. 重新初始化客户端
    this.initializeClients();
    
    // 3. 重置连接健康状态
    this.connectionHealth.consecutiveErrors = 0;
    this.connectionStatus = ConnectionStatus.RECONNECTING;
    
    // 4. 发出故障转移事件
    this.emit('failover', { useProxy: this.useProxy });
  }

  // 网络性能分析监控（片段）
  private startNetworkAnalysisMonitoring(): void {
    if (!this.analyzerEnabled) return;
    const intervalMs = 120000; // 120秒
    const runAnalysis = async () => {
      try {
        const analysis = await networkPerformanceAnalyzer.analyzeNetworkPerformance();
        // 根据区域策略，若强制代理，则忽略直连建议
        const recommendation = config.proxy.forceOnly ? 'use_proxy' : analysis.proxyComparison.recommendation; // 'use_proxy' | 'use_direct' | 'optimize_proxy'
        this.lastAnalyzerRecommendation = recommendation;
        this.emit('network-analysis', analysis);

        // 阈值：仅当代理与直连性能差异显著时才切换，避免频繁抖动
        const improvement = analysis.proxyComparison.improvement; // 相对直连的提升百分比
        const significant = Math.abs(improvement) >= 10; // 10% 作为显著阈值

        if (significant) {
          if (recommendation === 'use_proxy' && !this.useProxy) {
            console.log(`🧭 网络分析建议切换到代理模式 (提升: ${improvement.toFixed(2)}%)`);
            this.useProxy = true;
            this.initializeClients();
            this.connectionHealth.consecutiveErrors = 0;
            this.emit('failover', { useProxy: this.useProxy });
          } else if (recommendation === 'use_direct' && this.useProxy) {
            console.log(`🧭 网络分析建议切换到直连模式 (代理较差: ${improvement.toFixed(2)}%)`);
            this.useProxy = false;
            this.initializeClients();
            this.connectionHealth.consecutiveErrors = 0;
            this.emit('failover', { useProxy: this.useProxy });
          } else if (recommendation === 'optimize_proxy') {
            console.log('🧭 网络分析建议优化代理配置，暂不切换连接模式');
          }
        } else {
          console.log('🧭 网络分析结果差异不显著，保持当前连接模式');
        }
      } catch (error: any) {
        console.warn('网络性能分析失败:', error?.message ?? error);
      }
    };

    // 立即执行一次，避免冷启动等待
    void runAnalysis();

    // 定时执行
    this.analyzerTimer = setInterval(runAnalysis, intervalMs);
  
    console.log(`🌐 网络性能分析定时任务已启动 (间隔: ${intervalMs / 1000}秒)`);
  }


  // 清理空闲连接
  private cleanupIdleConnections(): void {
    const now = Date.now();
    let cleanedCount = 0;
    
    this.connectionPoolStats.forEach((stats, index) => {
      if (now - stats.lastUsed > this.CONNECTION_IDLE_TIMEOUT) {
        // 重置空闲连接的统计
        stats.requests = 0;
        stats.errors = 0;
        cleanedCount++;
      }
    });
    
    if (cleanedCount > 0) {
      console.log(`🧹 清理了 ${cleanedCount} 个空闲连接`);
    }
  }

  // 重新平衡连接池
  private rebalanceConnectionPool(): void {
    // 找出错误率最高的连接并重新创建
    let worstConnectionIndex = -1;
    let worstErrorRate = 0;
    
    this.connectionPoolStats.forEach((stats, index) => {
      if (stats.requests > 10) { // 只考虑有足够请求数的连接
        const errorRate = stats.errors / stats.requests;
        if (errorRate > worstErrorRate && errorRate > 0.5) { // 错误率超过50%
          worstErrorRate = errorRate;
          worstConnectionIndex = index;
        }
      }
    });
    
    if (worstConnectionIndex >= 0) {
      console.log(`🔄 重新创建错误率过高的连接 #${worstConnectionIndex} (错误率: ${(worstErrorRate * 100).toFixed(1)}%)`);
      
      // 重新创建连接
      const newClient = this.createAxiosClient(config.proxy.url, {
        'OK-ACCESS-KEY': config.okx.apiKey,
        'OK-ACCESS-SIGN': '',
        'OK-ACCESS-TIMESTAMP': '',
        'OK-ACCESS-PASSPHRASE': config.okx.passphrase
      });
      
      this.connectionPool[worstConnectionIndex] = newClient;
      this.connectionPoolStats.set(worstConnectionIndex, {
        requests: 0,
        errors: 0,
        lastUsed: Date.now()
      });
    }
  }

  // 处理响应压缩
  private handleResponseCompression(response: any): void {
    if (response.data && typeof response.data === 'object') {
      const originalSize = JSON.stringify(response.data).length;
      this.compressionStats.totalRequests++;
      
      // 检查是否值得压缩
      if (originalSize > 1024) { // 大于1KB才压缩
        this.compressionStats.compressedRequests++;
        const compressionRatio = this.compressionService.estimateCompressionRatio(response.data);
        const bytesSaved = originalSize * (1 - compressionRatio);
        this.compressionStats.totalBytesSaved += bytesSaved;
        this.compressionStats.avgCompressionRatio = 
          (this.compressionStats.avgCompressionRatio * (this.compressionStats.compressedRequests - 1) + compressionRatio) / 
          this.compressionStats.compressedRequests;
      }
    }
  }
  
  // 压缩市场数据
  private compressMarketData(data: MarketData): MarketData {
    return this.compressionService.compressMarketData(data);
  }
  
  // 压缩K线数据
  private compressKlineData(data: KlineData[]): KlineData[] {
    return this.compressionService.compressKlineArray(data);
  }
  
  // 获取压缩统计
  getCompressionStats(): {
    totalRequests: number;
    compressedRequests: number;
    totalBytesSaved: number;
    avgCompressionRatio: number;
    compressionRate: number;
  } {
    return {
      ...this.compressionStats,
      compressionRate: this.compressionStats.totalRequests > 0 ? 
        (this.compressionStats.compressedRequests / this.compressionStats.totalRequests) * 100 : 0
    };
  }
  
  // 设置压缩开关
  setCompressionEnabled(enabled: boolean): void {
    this.enableCompression = enabled;
    console.log(`🗜️ 数据压缩已${enabled ? '启用' : '禁用'}`);
  }
  
  // 根据时间间隔获取缓存TTL
  private getCacheTTLForInterval(interval: string): number {
    const intervalMap: { [key: string]: number } = {
      '1m': 30 * 1000,      // 30秒
      '3m': 60 * 1000,      // 1分钟
      '5m': 2 * 60 * 1000,  // 2分钟
      '15m': 5 * 60 * 1000, // 5分钟
      '30m': 10 * 60 * 1000, // 10分钟
      '1H': 15 * 60 * 1000,  // 15分钟
      '2H': 30 * 60 * 1000,  // 30分钟
      '4H': 60 * 60 * 1000,  // 1小时
      '6H': 2 * 60 * 60 * 1000, // 2小时
      '12H': 4 * 60 * 60 * 1000, // 4小时
      '1D': 8 * 60 * 60 * 1000,  // 8小时
      '1W': 24 * 60 * 60 * 1000, // 24小时
      '1M': 7 * 24 * 60 * 60 * 1000 // 7天
    };
    
    return intervalMap[interval] || 3 * 60 * 1000; // 默认3分钟
  }
  
  // 获取缓存统计
  getCacheStats(): any {
    return this.cacheManager.getStats();
  }
  
  // 清理缓存
   clearCache(): void {
     this.cacheManager.clear();
     console.log('🗑️ 缓存已清理');
   }

  // 获取错误恢复统计信息
  getErrorRecoveryStats(): import('../utils/error-recovery-manager').ErrorStats {
    return this.errorRecoveryManager.getErrorStats();
  }
 
  // 重置错误恢复状态
  resetErrorRecovery() {
    this.errorRecoveryManager.resetStats();
  }

  // 获取性能监控统计
  getPerformanceStats(): import('../utils/performance-monitor').PerformanceStats {
    return this.performanceMonitor.getStats();
  }

  // 获取性能监控历史数据
  getPerformanceHistory(limit?: number): import('../utils/performance-monitor').PerformanceMetrics[] {
    return this.performanceMonitor.getHistoryMetrics(limit);
  }

  // 重置性能监控
  resetPerformanceStats(): void {
    this.performanceMonitor.resetStats();
  }

  // 添加性能报警规则
  addPerformanceAlertRule(rule: import('../utils/performance-monitor').AlertRule): void {
    this.performanceMonitor.addAlertRule(rule);
  }

  // 移除性能报警规则
  removePerformanceAlertRule(ruleId: string): void {
    this.performanceMonitor.removeAlertRule(ruleId);
  }

  // 设置备用端点（用于网络不佳时的回退策略）
  private setupFallbackEndpoints(): void {
    try {
      // 这里可以根据需要扩展备用端点或域名解析策略
      // 目前我们仅确保 backupClient 存在并记录日志
      if (!this.backupClient) {
        this.backupClient = this.createAxiosClient(config.proxy.forceOnly ? config.proxy.url : 'https://okx.com', {
          'OK-ACCESS-KEY': config.okx.apiKey,
          'OK-ACCESS-SIGN': '',
          'OK-ACCESS-TIMESTAMP': '',
          'OK-ACCESS-PASSPHRASE': config.okx.passphrase
        });
      }
      console.log('🧯 已设置备用端点与连接回退策略');
    } catch (e) {
      console.warn('设置备用端点时出现问题:', (e as any)?.message ?? e);
    }
  }

  // 绑定性能监控事件与规则
  private setupPerformanceMonitoring(): void {
    try {
      // 监听性能报警事件
      this.performanceMonitor.on('alert', (alert: any) => {
        console.warn(`⚠️ 性能报警[${alert.level}] ${alert.name}: ${alert.metric}=${alert.value} 阈值=${alert.threshold}`);
        // 当出现高等级报警时，尝试触发一次故障转移以自愈
        if (alert.level === 'high') {
          this.performFailover().catch(() => {});
        }
      });

      // 可以根据需要添加一些自定义报警规则（示例，避免重复添加可在外部控制）
      // 示例规则：平均响应时间过高
      this.performanceMonitor.addAlertRule({
        id: 'high_response_time',
        name: '平均响应时间过高',
        metric: 'responseTime',
        threshold: 2500, // ms
        operator: '>',
        level: 'medium',
        enabled: true,
        cooldown: 60000
      } as any);

      console.log('📈 性能监控事件与规则已设置');
    } catch (e) {
      console.warn('设置性能监控时出现问题:', (e as any)?.message ?? e);
    }
  }

  // 健康监控
  private startHealthMonitoring(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
    }
    const intervalMs = Math.max(15000, (config.proxy.healthCheck?.interval ?? 30000));
    this.healthTimer = setInterval(async () => {
      try {
        // 基础健康统计更新
        const now = Date.now();
        // 当长时间无成功请求且有错误时，提升权重触发故障转移
        const longNoSuccess = (now - (this.connectionHealth.lastSuccessTime || 0)) > 2 * intervalMs;
        if (this.connectionHealth.consecutiveErrors > this.MAX_CONSECUTIVE_ERRORS || longNoSuccess) {
          console.warn('⚠️ 健康检查触发故障转移条件，正在执行故障转移');
          this.performFailover().catch(() => {});
        }

        // 维护连接池
        this.cleanupIdleConnections();
        this.rebalanceConnectionPool();

        // 更新性能监控指标（以当前平均响应时间做一次记录）
        const health = this.getConnectionHealth();
        this.performanceMonitor.recordRequest(health.averageResponseTime || 0, false);
      } catch (e) {
        // 监控不应抛出
      }
    }, intervalMs);
    console.log(`❤️ 健康监控已启动 (间隔: ${intervalMs / 1000}秒)`);
  }

  // 获取连接健康状态
  private getConnectionHealth(): ConnectionHealth {
    // 动态更新 uptime 为运行时长
    const base = { ...this.connectionHealth };
    base.uptime = Date.now() - base.uptime;
    return base;
  }
 
   // 请求速率限制
   private async waitForRateLimit(): Promise<void> {
     const now = Date.now();
     const elapsed = now - this.lastRequestTime;
     if (elapsed < this.rateLimitDelay) {
       await new Promise((resolve) => setTimeout(resolve, this.rateLimitDelay - elapsed));
     }
     this.lastRequestTime = Date.now();
   }
  
  // 获取Ticker数据（增强版）
  async getTicker(symbol: string = 'ETH-USDT-SWAP'): Promise<MarketData | null> {
    const start = Date.now();
    this.connectionHealth.totalRequests++;
    try {
      await this.waitForRateLimit();
      const client = this.selectBestClient();
      const resp = await client.get(`/api/v5/market/ticker?instId=${symbol}`);
      const data = resp.data as any;
      if (data.code !== '0' || !data.data || data.data.length === 0) {
        console.error('Invalid ticker response:', data);
        this.connectionHealth.failedRequests++;
        this.connectionHealth.lastErrorTime = Date.now();
        this.connectionHealth.consecutiveErrors++;
        return null;
      }
      const t = data.data[0];
      const baseOpen = parseFloat(t.sodUtc8 || t.open24h);
      const open24hPrice = parseFloat(t.open24h);
      const sodUtc8Price = t.sodUtc8 ? parseFloat(t.sodUtc8) : undefined;
      const changeFromSodUtc8 = ((parseFloat(t.last) - baseOpen) / baseOpen) * 100;
      const result: MarketData = {
        price: parseFloat(t.last),
        volume: parseFloat(t.vol24h),
        timestamp: parseInt(t.ts),
        high24h: parseFloat(t.high24h),
        low24h: parseFloat(t.low24h),
        change24h: ((parseFloat(t.last) - open24hPrice) / open24hPrice) * 100,
        changeFromSodUtc8,
        open24hPrice,
        sodUtc8Price
      };
      this.connectionHealth.successfulRequests++;
      this.connectionHealth.lastSuccessTime = Date.now();
      this.connectionHealth.consecutiveErrors = 0;
      // 可选：压缩统计
      this.handleResponseCompression({ data });
      return this.enableCompression ? this.compressMarketData(result) : result;
    } catch (err) {
      console.error('Failed to fetch ticker data (enhanced):', err);
      this.connectionHealth.failedRequests++;
      this.connectionHealth.lastErrorTime = Date.now();
      this.connectionHealth.consecutiveErrors++;
      return null;
    } finally {
      const rt = Date.now() - start;
      // 简单移动平均
      this.connectionHealth.averageResponseTime =
        this.connectionHealth.averageResponseTime === 0
          ? rt
          : (this.connectionHealth.averageResponseTime * 0.9 + rt * 0.1);
    }
  }
  
  // 获取K线数据（增强版）
  async getKlineData(
    symbol: string = 'ETH-USDT-SWAP',
    interval: string = '1m',
    limit: number = 100
  ): Promise<KlineData[]> {
    const start = Date.now();
    this.connectionHealth.totalRequests++;
    const endpoint = `/api/v5/market/candles?instId=${symbol}&bar=${interval}&limit=${limit}`;
    try {
      await this.waitForRateLimit();

      // 使用错误恢复管理器统一重试与熔断
      const klines = await this.errorRecoveryManager.executeWithRecovery<KlineData[]>(async () => {
        const client = this.selectBestClient();
        // 针对K线请求适当延长超时（代理模式更宽松）
        const baseTimeout = client.defaults.timeout || 30000;
        const overrideTimeout = this.useProxy ? Math.max(baseTimeout, 45000) : Math.max(baseTimeout, 40000);
        const resp = await client.get(endpoint, { timeout: overrideTimeout });
        const data = resp.data as any;
        if (data.code !== '0' || !data.data || !Array.isArray(data.data)) {
          throw new Error(`Invalid kline response: code=${data?.code ?? 'N/A'}`);
        }
        // OKX 返回的 K线为倒序(最新在前)，第9个字段 confirm 指示是否收盘：1=已收盘，0=未收盘
        let rows: any[] = data.data as any[];
        if (config.indicators?.closedOnly && rows.length > 0) {
          const c = rows[0][8];
          const confirmed = c === 1 || c === '1' || c === true || c === 'true';
          if (!confirmed) {
            rows = rows.slice(1); // 丢弃最新未收盘K线
          }
        }
        const parsed: KlineData[] = rows.map((k) => ({
          timestamp: parseInt(k[0]),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          turnover: parseFloat(k[6])
        })).reverse();
        // 记录压缩统计
        this.handleResponseCompression({ data });
        return this.enableCompression ? this.compressKlineData(parsed) : parsed;
      }, endpoint);

      // 成功统计
      this.connectionHealth.successfulRequests++;
      this.connectionHealth.lastSuccessTime = Date.now();
      this.connectionHealth.consecutiveErrors = 0;
      return klines;
    } catch (err) {
      console.error('Failed to fetch kline data (enhanced):', err);
      this.connectionHealth.failedRequests++;
      this.connectionHealth.lastErrorTime = Date.now();
      this.connectionHealth.consecutiveErrors++;
      return [];
    } finally {
      const rt = Date.now() - start;
      this.connectionHealth.averageResponseTime =
        this.connectionHealth.averageResponseTime === 0
          ? rt
          : (this.connectionHealth.averageResponseTime * 0.9 + rt * 0.1);
    }
  }
  
  // 获取资金费率（增强版）
  async getFundingRate(symbol: string = 'ETH-USDT-SWAP'): Promise<number | null> {
    const start = Date.now();
    this.connectionHealth.totalRequests++;
    try {
      await this.waitForRateLimit();
      const client = this.selectBestClient();
      const resp = await client.get(`/api/v5/public/funding-rate?instId=${symbol}`);
      const data = resp.data as any;
      if (data.code !== '0' || !data.data || data.data.length === 0) {
        console.error('Invalid funding rate response:', data);
        this.connectionHealth.failedRequests++;
        this.connectionHealth.lastErrorTime = Date.now();
        this.connectionHealth.consecutiveErrors++;
        return null;
      }
      const rate = parseFloat(data.data[0].fundingRate);
      this.connectionHealth.successfulRequests++;
      this.connectionHealth.lastSuccessTime = Date.now();
      this.connectionHealth.consecutiveErrors = 0;
      this.handleResponseCompression({ data });
      return rate;
    } catch (err) {
      console.error('Failed to fetch funding rate (enhanced):', err);
      this.connectionHealth.failedRequests++;
      this.connectionHealth.lastErrorTime = Date.now();
      this.connectionHealth.consecutiveErrors++;
      return null;
    } finally {
      const rt = Date.now() - start;
      this.connectionHealth.averageResponseTime =
        this.connectionHealth.averageResponseTime === 0
          ? rt
          : (this.connectionHealth.averageResponseTime * 0.9 + rt * 0.1);
    }
  }
  
  // 获取持仓量（增强版）
  async getOpenInterest(symbol: string = 'ETH-USDT-SWAP'): Promise<number | null> {
    const start = Date.now();
    this.connectionHealth.totalRequests++;
    try {
      await this.waitForRateLimit();
      const client = this.selectBestClient();
      const resp = await client.get(`/api/v5/public/open-interest?instId=${symbol}`);
      const data = resp.data as any;
      if (data.code !== '0' || !data.data || data.data.length === 0) {
        console.error('Invalid open interest response:', data);
        this.connectionHealth.failedRequests++;
        this.connectionHealth.lastErrorTime = Date.now();
        this.connectionHealth.consecutiveErrors++;
        return null;
      }
      const oi = parseFloat(data.data[0].oi);
      this.connectionHealth.successfulRequests++;
      this.connectionHealth.lastSuccessTime = Date.now();
      this.connectionHealth.consecutiveErrors = 0;
      this.handleResponseCompression({ data });
      return oi;
    } catch (err) {
      console.error('Failed to fetch open interest (enhanced):', err);
      this.connectionHealth.failedRequests++;
      this.connectionHealth.lastErrorTime = Date.now();
      this.connectionHealth.consecutiveErrors++;
      return null;
    } finally {
      const rt = Date.now() - start;
      this.connectionHealth.averageResponseTime =
        this.connectionHealth.averageResponseTime === 0
          ? rt
          : (this.connectionHealth.averageResponseTime * 0.9 + rt * 0.1);
    }
  }
  
  // 检查API连接状态（增强版）
  async checkConnection(): Promise<boolean> {
    try {
      const ticker = await this.getTicker('ETH-USDT-SWAP');
      return ticker !== null;
    } catch (error) {
      console.error('Connection check failed (enhanced):', error);
      return false;
    }
  }
  
  // 获取完整的合约信息（增强版）
  async getContractInfo(symbol: string = 'ETH-USDT-SWAP'): Promise<ContractInfo | null> {
    try {
      const [ticker, fundingRate, openInterest] = await Promise.all([
        this.getTicker(symbol),
        this.getFundingRate(symbol),
        this.getOpenInterest(symbol)
      ]);

      if (!ticker) {
        console.error('Failed to get ticker data for contract info (enhanced)');
        return null;
      }

      return {
        symbol,
        markPrice: ticker.price,
        indexPrice: ticker.price,
        fundingRate: fundingRate || 0,
        nextFundingTime: Date.now() + 8 * 60 * 60 * 1000,
        openInterest: openInterest || 0,
        volume24h: ticker.volume,
        turnover24h: ticker.volume * ticker.price * 0.1, // 张->USDT：乘数 0.1
        priceChange24h: (ticker.change24h / 100) * ticker.price,
        priceChangePercent24h: ticker.change24h
      };
    } catch (error) {
      console.error('Failed to get contract info (enhanced):', error);
      return null;
    }
  }
  
  // 预热缓存
  async warmupCache(symbols: string[] = ['ETH-USDT-SWAP', 'BTC-USDT-SWAP']): Promise<void> {
    console.log('🔥 开始预热缓存...');
    
    const warmupPromises = symbols.map(async (symbol) => {
      try {
        await Promise.all([
          this.getTicker(symbol),
          this.getKlineData(symbol, '1m', 100),
          this.getFundingRate(symbol),
          this.getOpenInterest(symbol)
        ]);
        console.log(`✅ ${symbol} 缓存预热完成`);
      } catch (error) {
        console.warn(`⚠️ ${symbol} 缓存预热失败:`, (error as Error).message);
      }
    });
    
    await Promise.allSettled(warmupPromises);
    console.log('🔥 缓存预热完成');
  }
  // 优雅关闭
  // 初始化服务
  async initialize(): Promise<void> {
    console.log('🚀 初始化增强OKX数据服务...');
    this.initializeConnectionHealth();
    this.initializeClients();
    this.startHealthMonitoring();
    
    // 预热缓存
    await this.warmupCache();
    
    console.log('✅ 增强OKX数据服务初始化完成');
  }

  // 获取健康状态
  getHealthStatus(): ConnectionHealth {
    return this.getConnectionHealth();
  }

  async shutdown(): Promise<void> {
    console.log('🔄 关闭增强OKX数据服务...');
    this.connectionStatus = ConnectionStatus.DISCONNECTED;
    
    // 关闭缓存管理器
     this.cacheManager.destroy();
    
    // 关闭错误恢复管理器
     this.errorRecoveryManager.resetStats();
     this.errorRecoveryManager.resetCircuitBreakers();
     
     // 关闭性能监控器
     this.performanceMonitor.destroy();
     
     this.removeAllListeners();
     console.log('✅ 增强OKX数据服务已关闭');
  }


}

export const enhancedOKXDataService = new EnhancedOKXDataService();
