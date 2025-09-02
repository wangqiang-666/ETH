import { EventEmitter } from 'events';

// 性能指标接口
export interface PerformanceMetrics {
  timestamp: number;
  responseTime: number;
  throughput: number; // 请求/秒
  errorRate: number; // 错误率 %
  memoryUsage: number; // MB
  cpuUsage: number; // %
  networkLatency: number; // ms
  cacheHitRate: number; // %
  activeConnections: number;
  queueLength: number;
}

// 报警级别
export enum AlertLevel {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

// 报警规则接口
export interface AlertRule {
  id: string;
  name: string;
  metric: keyof PerformanceMetrics;
  threshold: number;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  level: AlertLevel;
  enabled: boolean;
  cooldown: number; // 冷却时间(ms)
  lastTriggered?: number;
}

// 性能监控配置
export interface PerformanceMonitorConfig {
  metricsInterval: number; // 指标收集间隔(ms)
  historySize: number; // 历史数据保留数量
  alertRules: AlertRule[];
  enableRealTimeAlerts: boolean;
  enablePerformanceLogging: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

// 性能统计
export interface PerformanceStats {
  current: PerformanceMetrics;
  average: Partial<PerformanceMetrics>;
  peak: Partial<PerformanceMetrics>;
  trend: 'improving' | 'stable' | 'degrading';
  uptime: number;
  totalRequests: number;
  totalErrors: number;
}

/**
 * 性能监控管理器
 * 实时监控系统性能指标并触发报警
 */
export class PerformanceMonitor extends EventEmitter {
  private config: PerformanceMonitorConfig;
  private metricsHistory: PerformanceMetrics[] = [];
  private alertRules: Map<string, AlertRule> = new Map();
  private metricsInterval?: NodeJS.Timeout;
  private startTime: number;
  private requestCount = 0;
  private errorCount = 0;
  private lastMetrics?: PerformanceMetrics;

  constructor(config: Partial<PerformanceMonitorConfig> = {}) {
    super();
    this.startTime = Date.now();
    
    this.config = {
      metricsInterval: 5000, // 5秒
      historySize: 1000,
      alertRules: [],
      enableRealTimeAlerts: true,
      enablePerformanceLogging: true,
      logLevel: 'info',
      ...config
    };

    this.initializeDefaultAlertRules();
    this.startMonitoring();
  }

  // 初始化默认报警规则
  private initializeDefaultAlertRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high-response-time',
        name: '响应时间过高',
        metric: 'responseTime',
        threshold: 5000, // 5秒
        operator: 'gt',
        level: AlertLevel.WARNING,
        enabled: true,
        cooldown: 60000 // 1分钟
      },
      {
        id: 'high-error-rate',
        name: '错误率过高',
        metric: 'errorRate',
        threshold: 10, // 10%
        operator: 'gt',
        level: AlertLevel.ERROR,
        enabled: true,
        cooldown: 30000 // 30秒
      },
      {
        id: 'low-cache-hit-rate',
        name: '缓存命中率过低',
        metric: 'cacheHitRate',
        threshold: 50, // 50%
        operator: 'lt',
        level: AlertLevel.WARNING,
        enabled: true,
        cooldown: 120000 // 2分钟
      },
      {
        id: 'high-memory-usage',
        name: '内存使用率过高',
        metric: 'memoryUsage',
        threshold: 500, // 500MB
        operator: 'gt',
        level: AlertLevel.WARNING,
        enabled: true,
        cooldown: 60000 // 1分钟
      },
      {
        id: 'high-network-latency',
        name: '网络延迟过高',
        metric: 'networkLatency',
        threshold: 2000, // 2秒
        operator: 'gt',
        level: AlertLevel.WARNING,
        enabled: true,
        cooldown: 30000 // 30秒
      }
    ];

    defaultRules.forEach(rule => {
      this.alertRules.set(rule.id, rule);
    });

    this.config.alertRules = defaultRules;
  }

  // 开始监控
  private startMonitoring(): void {
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.metricsInterval);

    console.log(`📊 性能监控已启动 (间隔: ${this.config.metricsInterval}ms)`);
  }

  // 收集性能指标
  private async collectMetrics(): Promise<void> {
    try {
      const metrics: PerformanceMetrics = {
        timestamp: Date.now(),
        responseTime: this.calculateAverageResponseTime(),
        throughput: this.calculateThroughput(),
        errorRate: this.calculateErrorRate(),
        memoryUsage: this.getMemoryUsage(),
        cpuUsage: await this.getCpuUsage(),
        networkLatency: await this.measureNetworkLatency(),
        cacheHitRate: this.getCacheHitRate(),
        activeConnections: this.getActiveConnections(),
        queueLength: this.getQueueLength()
      };

      this.addMetrics(metrics);
      this.checkAlertRules(metrics);
      
      if (this.config.enablePerformanceLogging) {
        this.logMetrics(metrics);
      }

      this.emit('metrics', metrics);
    } catch (error) {
      console.error('收集性能指标时出错:', error);
    }
  }

  // 添加指标到历史记录
  private addMetrics(metrics: PerformanceMetrics): void {
    this.metricsHistory.push(metrics);
    
    // 保持历史记录大小
    if (this.metricsHistory.length > this.config.historySize) {
      this.metricsHistory.shift();
    }

    this.lastMetrics = metrics;
  }

  // 检查报警规则
  private checkAlertRules(metrics: PerformanceMetrics): void {
    if (!this.config.enableRealTimeAlerts) return;

    this.alertRules.forEach(rule => {
      if (!rule.enabled) return;

      // 检查冷却时间
      if (rule.lastTriggered && 
          Date.now() - rule.lastTriggered < rule.cooldown) {
        return;
      }

      const value = metrics[rule.metric] as number;
      let triggered = false;

      switch (rule.operator) {
        case 'gt':
          triggered = value > rule.threshold;
          break;
        case 'lt':
          triggered = value < rule.threshold;
          break;
        case 'gte':
          triggered = value >= rule.threshold;
          break;
        case 'lte':
          triggered = value <= rule.threshold;
          break;
        case 'eq':
          triggered = value === rule.threshold;
          break;
      }

      if (triggered) {
        this.triggerAlert(rule, value, metrics);
      }
    });
  }

  // 新增：公开方法 - 添加/移除报警规则
  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
  }

  removeAlertRule(ruleId: string): boolean {
    return this.alertRules.delete(ruleId);
  }

  // 触发报警
  private triggerAlert(rule: AlertRule, value: number, metrics: PerformanceMetrics): void {
    rule.lastTriggered = Date.now();
    
    const alert = {
      id: rule.id,
      name: rule.name,
      level: rule.level,
      value,
      threshold: rule.threshold,
      metric: rule.metric,
      timestamp: Date.now(),
      metrics
    };

    this.emit('alert', alert);
    
    if (this.config.enablePerformanceLogging) {
      console.warn(`⚠️ 性能报警(${rule.level}): ${rule.name} - ${rule.metric}=${value} 阈值=${rule.threshold}`);
    }
  }

  // 新增：记录指标日志
  private logMetrics(metrics: PerformanceMetrics): void {
    const logLine = `性能指标 | 响应: ${metrics.responseTime}ms | 吞吐: ${metrics.throughput}/s | 错误率: ${metrics.errorRate}% | 内存: ${metrics.memoryUsage}MB | CPU: ${metrics.cpuUsage}% | 网络延迟: ${metrics.networkLatency}ms | 缓存命中: ${metrics.cacheHitRate}% | 连接: ${metrics.activeConnections} | 队列: ${metrics.queueLength}`;
    switch (this.config.logLevel) {
      case 'debug':
        console.debug(logLine);
        break;
      case 'info':
        console.log(logLine);
        break;
      case 'warn':
        console.warn(logLine);
        break;
      case 'error':
        console.error(logLine);
        break;
    }
  }

  // 计算平均响应时间 (ms)
  private calculateAverageResponseTime(): number {
    if (!this.lastMetrics) return 0;
    return this.lastMetrics.responseTime;
  }

  // 计算吞吐量 (请求/秒)
  private calculateThroughput(): number {
    const elapsed = (Date.now() - this.startTime) / 1000; // 秒
    return Number((this.requestCount / Math.max(1, elapsed)).toFixed(2));
  }

  // 计算错误率 (%)
  private calculateErrorRate(): number {
    const total = Math.max(1, this.requestCount);
    return Number(((this.errorCount / total) * 100).toFixed(2));
  }

  // 获取内存使用情况 (MB)
  private getMemoryUsage(): number {
    const memoryUsage = process.memoryUsage();
    return Number((memoryUsage.heapUsed / 1024 / 1024).toFixed(2));
  }

  // 模拟CPU使用率 (实际项目可接入系统API)
  private async getCpuUsage(): Promise<number> {
    // 简化实现：随机波动
    return Number((20 + Math.random() * 30).toFixed(2));
  }

  // 测量网络延迟 (ms)
  private async measureNetworkLatency(): Promise<number> {
    // 简化实现：使用最近一次请求的响应时间
    if (!this.lastMetrics) return 0;
    return this.lastMetrics.responseTime;
  }

  // 获取缓存命中率 (%)
  private getCacheHitRate(): number {
    // 需要从SmartCacheManager获取统计数据 (此处使用占位逻辑)
    return Number((70 + Math.random() * 20).toFixed(2));
  }

  // 获取活动连接数
  private getActiveConnections(): number {
    // 从连接池或HTTP Agent获取 (此处使用占位逻辑)
    return Math.floor(Math.random() * 100);
  }

  // 获取请求队列长度
  private getQueueLength(): number {
    // 从请求队列获取 (此处使用占位逻辑)
    return Math.floor(Math.random() * 50);
  }

  // 记录一次请求
  recordRequest(responseTime: number, isError: boolean = false): void {
    this.requestCount++;
    if (isError) this.errorCount++;

    this.lastMetrics = {
      timestamp: Date.now(),
      responseTime,
      throughput: this.calculateThroughput(),
      errorRate: this.calculateErrorRate(),
      memoryUsage: this.getMemoryUsage(),
      cpuUsage: 0,
      networkLatency: responseTime,
      cacheHitRate: this.getCacheHitRate(),
      activeConnections: this.getActiveConnections(),
      queueLength: this.getQueueLength()
    };
  }

  // 获取统计信息
  getStats(): PerformanceStats {
    const uptime = Date.now() - this.startTime;
    const average = this.calculateAverages();
    const peak = this.calculatePeaks();

    return {
      current: this.lastMetrics || this.createEmptyMetrics(),
      average,
      peak,
      trend: this.calculateTrend(),
      uptime,
      totalRequests: this.requestCount,
      totalErrors: this.errorCount
    };
  }

  // 获取历史指标
  getHistoryMetrics(limit: number = 100): PerformanceMetrics[] {
    return this.metricsHistory.slice(-limit);
  }

  // 重置统计
  resetStats(): void {
    this.metricsHistory = [];
    this.requestCount = 0;
    this.errorCount = 0;
    this.startTime = Date.now();
    this.lastMetrics = undefined;
  }

  // 销毁监控器
  destroy(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = undefined;
    }
    this.removeAllListeners();
  }

  // 创建空指标对象
  private createEmptyMetrics(): PerformanceMetrics {
    return {
      timestamp: Date.now(),
      responseTime: 0,
      throughput: 0,
      errorRate: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      networkLatency: 0,
      cacheHitRate: 0,
      activeConnections: 0,
      queueLength: 0
    };
  }

  // 计算平均值
  private calculateAverages(): Partial<PerformanceMetrics> {
    if (this.metricsHistory.length === 0) {
      return {};
    }

    const sum = this.metricsHistory.reduce((acc, m) => ({
      timestamp: acc.timestamp + m.timestamp,
      responseTime: acc.responseTime + m.responseTime,
      throughput: acc.throughput + m.throughput,
      errorRate: acc.errorRate + m.errorRate,
      memoryUsage: acc.memoryUsage + m.memoryUsage,
      cpuUsage: acc.cpuUsage + m.cpuUsage,
      networkLatency: acc.networkLatency + m.networkLatency,
      cacheHitRate: acc.cacheHitRate + m.cacheHitRate,
      activeConnections: acc.activeConnections + m.activeConnections,
      queueLength: acc.queueLength + m.queueLength
    }), this.createEmptyMetrics());

    const count = this.metricsHistory.length;

    return {
      timestamp: sum.timestamp / count,
      responseTime: Number((sum.responseTime / count).toFixed(2)),
      throughput: Number((sum.throughput / count).toFixed(2)),
      errorRate: Number((sum.errorRate / count).toFixed(2)),
      memoryUsage: Number((sum.memoryUsage / count).toFixed(2)),
      cpuUsage: Number((sum.cpuUsage / count).toFixed(2)),
      networkLatency: Number((sum.networkLatency / count).toFixed(2)),
      cacheHitRate: Number((sum.cacheHitRate / count).toFixed(2)),
      activeConnections: Math.round(sum.activeConnections / count),
      queueLength: Math.round(sum.queueLength / count)
    };
  }

  // 计算峰值
  private calculatePeaks(): Partial<PerformanceMetrics> {
    if (this.metricsHistory.length === 0) {
      return {};
    }

    return {
      responseTime: Math.max(...this.metricsHistory.map(m => m.responseTime)),
      throughput: Math.max(...this.metricsHistory.map(m => m.throughput)),
      errorRate: Math.max(...this.metricsHistory.map(m => m.errorRate)),
      memoryUsage: Math.max(...this.metricsHistory.map(m => m.memoryUsage)),
      cpuUsage: Math.max(...this.metricsHistory.map(m => m.cpuUsage)),
      networkLatency: Math.max(...this.metricsHistory.map(m => m.networkLatency)),
      cacheHitRate: Math.max(...this.metricsHistory.map(m => m.cacheHitRate)),
      activeConnections: Math.max(...this.metricsHistory.map(m => m.activeConnections)),
      queueLength: Math.max(...this.metricsHistory.map(m => m.queueLength))
    };
  }

  // 计算趋势
  private calculateTrend(): 'improving' | 'stable' | 'degrading' {
    if (this.metricsHistory.length < 2) return 'stable';

    const recent = this.metricsHistory.slice(-10);
    const avgResponseTime = recent.reduce((sum, m) => sum + m.responseTime, 0) / recent.length;
    const lastAverage = this.metricsHistory
      .slice(-20, -10)
      .reduce((sum, m) => sum + m.responseTime, 0) / Math.max(1, this.metricsHistory.length - 10);

    if (avgResponseTime < lastAverage * 0.95) return 'improving';
    if (avgResponseTime > lastAverage * 1.05) return 'degrading';
    return 'stable';
  }
}