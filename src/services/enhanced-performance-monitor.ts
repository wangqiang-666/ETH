/**
 * 增强性能监控服务
 * 完善实时监控、增加预警机制、优化统计分析
 */

import { EventEmitter } from 'events';
import { config } from '../config.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface SystemMetrics {
  timestamp: number;
  
  // 系统性能指标
  system: {
    cpuUsage: number; // CPU使用率 0-100
    memoryUsage: number; // 内存使用率 0-100
    diskUsage: number; // 磁盘使用率 0-100
    networkLatency: number; // 网络延迟 ms
    uptime: number; // 运行时间 ms
  };
  
  // 交易性能指标
  trading: {
    totalTrades: number;
    successfulTrades: number;
    failedTrades: number;
    winRate: number; // 胜率 0-1
    totalPnL: number;
    avgTradeTime: number; // 平均交易时间 ms
    maxDrawdown: number; // 最大回撤
    sharpeRatio: number;
  };
  
  // API性能指标
  api: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    avgResponseTime: number; // 平均响应时间 ms
    maxResponseTime: number; // 最大响应时间 ms
    errorRate: number; // 错误率 0-1
    rateLimit: {
      current: number;
      limit: number;
      resetTime: number;
    };
  };
  
  // 数据库性能指标
  database: {
    connectionCount: number;
    activeQueries: number;
    avgQueryTime: number; // 平均查询时间 ms
    slowQueries: number; // 慢查询数量
    cacheHitRate: number; // 缓存命中率 0-1
    storageSize: number; // 存储大小 bytes
  };
  
  // 机器学习性能指标
  ml: {
    predictionCount: number;
    avgPredictionTime: number; // 平均预测时间 ms
    modelAccuracy: number; // 模型准确率 0-1
    featureExtractionTime: number; // 特征提取时间 ms
    trainingStatus: 'idle' | 'training' | 'updating';
    lastTrainingTime: number;
  };
  
  // 风险管理指标
  risk: {
    activePositions: number;
    totalExposure: number;
    riskScore: number; // 风险评分 0-10
    stopLossTriggered: number;
    takeProfitTriggered: number;
    maxLeverage: number;
    portfolioValue: number;
  };
}

export interface AlertRule {
  id: string;
  name: string;
  category: 'system' | 'trading' | 'api' | 'database' | 'ml' | 'risk';
  metric: string; // 监控的指标路径，如 'system.cpuUsage'
  condition: 'gt' | 'lt' | 'eq' | 'gte' | 'lte'; // 条件
  threshold: number; // 阈值
  duration: number; // 持续时间 ms
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  actions: AlertAction[];
  lastTriggered?: number;
  triggerCount: number;
}

export interface AlertAction {
  type: 'log' | 'email' | 'webhook' | 'sms' | 'slack';
  config: Record<string, any>;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  category: string;
  metric: string;
  currentValue: number;
  threshold: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: number;
  resolved: boolean;
  resolvedAt?: number;
  duration?: number;
}

export interface PerformanceReport {
  period: {
    start: number;
    end: number;
    duration: number;
  };
  summary: {
    avgSystemLoad: number;
    totalTrades: number;
    winRate: number;
    totalPnL: number;
    maxDrawdown: number;
    sharpeRatio: number;
    apiUptime: number;
    avgResponseTime: number;
    errorCount: number;
    alertCount: number;
  };
  trends: {
    metric: string;
    trend: 'up' | 'down' | 'stable';
    change: number; // 变化百分比
    significance: 'low' | 'medium' | 'high';
  }[];
  recommendations: string[];
}

export class EnhancedPerformanceMonitor extends EventEmitter {
  private metrics: SystemMetrics[] = [];
  private alerts: Alert[] = [];
  private alertRules: Map<string, AlertRule> = new Map();
  private isRunning = false;
  private monitorInterval?: NodeJS.Timeout;
  private readonly maxMetricsHistory = 1000;
  private readonly monitorIntervalMs = 5000; // 5秒监控间隔
  private readonly dataPath = path.join(process.cwd(), 'data', 'monitoring');
  
  // 性能基线
  private baselines: Partial<SystemMetrics> = {};
  
  // 统计缓存
  private statsCache: Map<string, { value: any; timestamp: number }> = new Map();
  private readonly statsCacheTTL = 30000; // 30秒缓存

  constructor() {
    super();
    this.initializeDefaultAlertRules();
    this.ensureDataDirectory();
  }

  /**
   * 启动性能监控
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[PerformanceMonitor] 监控已在运行中');
      return;
    }

    try {
      // 加载历史数据
      await this.loadHistoricalData();
      
      // 启动监控循环
      this.monitorInterval = setInterval(() => {
        this.collectMetrics().catch(error => {
          console.error('[PerformanceMonitor] 指标收集失败:', error);
        });
      }, this.monitorIntervalMs);
      
      this.isRunning = true;
      console.log('[PerformanceMonitor] 性能监控已启动');
      
      // 发出启动事件
      this.emit('started');
      
    } catch (error) {
      console.error('[PerformanceMonitor] 启动失败:', error);
      throw error;
    }
  }

  /**
   * 停止性能监控
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }

    // 保存数据
    await this.saveData();
    
    this.isRunning = false;
    console.log('[PerformanceMonitor] 性能监控已停止');
    
    // 发出停止事件
    this.emit('stopped');
  }

  /**
   * 收集系统指标
   */
  private async collectMetrics(): Promise<void> {
    try {
      const timestamp = Date.now();
      
      // 收集各类指标
      const systemMetrics = await this.collectSystemMetrics();
      const tradingMetrics = await this.collectTradingMetrics();
      const apiMetrics = await this.collectAPIMetrics();
      const databaseMetrics = await this.collectDatabaseMetrics();
      const mlMetrics = await this.collectMLMetrics();
      const riskMetrics = await this.collectRiskMetrics();
      
      const metrics: SystemMetrics = {
        timestamp,
        system: systemMetrics,
        trading: tradingMetrics,
        api: apiMetrics,
        database: databaseMetrics,
        ml: mlMetrics,
        risk: riskMetrics
      };
      
      // 添加到历史记录
      this.addMetrics(metrics);
      
      // 检查预警规则
      await this.checkAlertRules(metrics);
      
      // 发出指标事件
      this.emit('metrics', metrics);
      
    } catch (error) {
      console.error('[PerformanceMonitor] 指标收集失败:', error);
    }
  }

  /**
   * 收集系统性能指标
   */
  private async collectSystemMetrics(): Promise<SystemMetrics['system']> {
    try {
      // 获取系统信息
      const process = await import('process');
      const os = await import('os');
      
      // CPU使用率（简化计算）
      const cpuUsage = process.cpuUsage();
      const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // 转换为秒
      
      // 内存使用率
      const memUsage = process.memoryUsage();
      const totalMem = os.totalmem();
      const memoryUsage = (memUsage.rss / totalMem) * 100;
      
      // 运行时间
      const uptime = process.uptime() * 1000;
      
      // 网络延迟（模拟）
      const networkLatency = await this.measureNetworkLatency();
      
      return {
        cpuUsage: Math.min(100, cpuPercent),
        memoryUsage: Math.min(100, memoryUsage),
        diskUsage: 0, // 简化处理
        networkLatency,
        uptime
      };
      
    } catch (error) {
      console.error('[PerformanceMonitor] 系统指标收集失败:', error);
      return {
        cpuUsage: 0,
        memoryUsage: 0,
        diskUsage: 0,
        networkLatency: 0,
        uptime: 0
      };
    }
  }

  /**
   * 收集交易性能指标
   */
  private async collectTradingMetrics(): Promise<SystemMetrics['trading']> {
    try {
      // 这里应该从交易系统获取实际数据
      // 现在使用模拟数据
      return {
        totalTrades: 150,
        successfulTrades: 98,
        failedTrades: 52,
        winRate: 0.653,
        totalPnL: 1250.75,
        avgTradeTime: 45000,
        maxDrawdown: 0.08,
        sharpeRatio: 1.85
      };
      
    } catch (error) {
      console.error('[PerformanceMonitor] 交易指标收集失败:', error);
      return {
        totalTrades: 0,
        successfulTrades: 0,
        failedTrades: 0,
        winRate: 0,
        totalPnL: 0,
        avgTradeTime: 0,
        maxDrawdown: 0,
        sharpeRatio: 0
      };
    }
  }

  /**
   * 收集API性能指标
   */
  private async collectAPIMetrics(): Promise<SystemMetrics['api']> {
    try {
      // 这里应该从API监控系统获取实际数据
      return {
        totalRequests: 2450,
        successfulRequests: 2398,
        failedRequests: 52,
        avgResponseTime: 125,
        maxResponseTime: 850,
        errorRate: 0.021,
        rateLimit: {
          current: 180,
          limit: 200,
          resetTime: Date.now() + 60000
        }
      };
      
    } catch (error) {
      console.error('[PerformanceMonitor] API指标收集失败:', error);
      return {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        avgResponseTime: 0,
        maxResponseTime: 0,
        errorRate: 0,
        rateLimit: {
          current: 0,
          limit: 0,
          resetTime: 0
        }
      };
    }
  }

  /**
   * 收集数据库性能指标
   */
  private async collectDatabaseMetrics(): Promise<SystemMetrics['database']> {
    try {
      // 这里应该从数据库监控获取实际数据
      return {
        connectionCount: 5,
        activeQueries: 2,
        avgQueryTime: 15,
        slowQueries: 1,
        cacheHitRate: 0.92,
        storageSize: 1024 * 1024 * 50 // 50MB
      };
      
    } catch (error) {
      console.error('[PerformanceMonitor] 数据库指标收集失败:', error);
      return {
        connectionCount: 0,
        activeQueries: 0,
        avgQueryTime: 0,
        slowQueries: 0,
        cacheHitRate: 0,
        storageSize: 0
      };
    }
  }

  /**
   * 收集机器学习性能指标
   */
  private async collectMLMetrics(): Promise<SystemMetrics['ml']> {
    try {
      // 这里应该从ML引擎获取实际数据
      return {
        predictionCount: 45,
        avgPredictionTime: 250,
        modelAccuracy: 0.68,
        featureExtractionTime: 180,
        trainingStatus: 'idle',
        lastTrainingTime: Date.now() - 3600000 // 1小时前
      };
      
    } catch (error) {
      console.error('[PerformanceMonitor] ML指标收集失败:', error);
      return {
        predictionCount: 0,
        avgPredictionTime: 0,
        modelAccuracy: 0,
        featureExtractionTime: 0,
        trainingStatus: 'idle',
        lastTrainingTime: 0
      };
    }
  }

  /**
   * 收集风险管理指标
   */
  private async collectRiskMetrics(): Promise<SystemMetrics['risk']> {
    try {
      // 这里应该从风险管理系统获取实际数据
      return {
        activePositions: 3,
        totalExposure: 15000,
        riskScore: 4.2,
        stopLossTriggered: 8,
        takeProfitTriggered: 12,
        maxLeverage: 15,
        portfolioValue: 25000
      };
      
    } catch (error) {
      console.error('[PerformanceMonitor] 风险指标收集失败:', error);
      return {
        activePositions: 0,
        totalExposure: 0,
        riskScore: 0,
        stopLossTriggered: 0,
        takeProfitTriggered: 0,
        maxLeverage: 0,
        portfolioValue: 0
      };
    }
  }

  /**
   * 测量网络延迟
   */
  private async measureNetworkLatency(): Promise<number> {
    try {
      const start = Date.now();
      
      // 简单的网络延迟测试
      await new Promise(resolve => setTimeout(resolve, 10));
      
      return Date.now() - start;
      
    } catch (error) {
      return 0;
    }
  }

  /**
   * 添加指标到历史记录
   */
  private addMetrics(metrics: SystemMetrics): void {
    this.metrics.push(metrics);
    
    // 限制历史记录大小
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics.shift();
    }
  }

  /**
   * 检查预警规则
   */
  private async checkAlertRules(metrics: SystemMetrics): Promise<void> {
    const rules = Array.from(this.alertRules.values());
    for (const rule of rules) {
      if (!rule.enabled) continue;
      
      try {
        const currentValue = this.getMetricValue(metrics, rule.metric);
        if (currentValue === undefined) continue;
        
        const isTriggered = this.evaluateCondition(currentValue, rule.condition, rule.threshold);
        
        if (isTriggered) {
          await this.handleAlertTrigger(rule, currentValue, metrics.timestamp);
        }
        
      } catch (error) {
        console.error(`[PerformanceMonitor] 预警规则检查失败: ${rule.name}`, error);
      }
    }
  }

  /**
   * 获取指标值
   */
  private getMetricValue(metrics: SystemMetrics, metricPath: string): number | undefined {
    const parts = metricPath.split('.');
    let value: any = metrics;
    
    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }
    
    return typeof value === 'number' ? value : undefined;
  }

  /**
   * 评估条件
   */
  private evaluateCondition(value: number, condition: string, threshold: number): boolean {
    switch (condition) {
      case 'gt': return value > threshold;
      case 'gte': return value >= threshold;
      case 'lt': return value < threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      default: return false;
    }
  }

  /**
   * 处理预警触发
   */
  private async handleAlertTrigger(rule: AlertRule, currentValue: number, timestamp: number): Promise<void> {
    // 检查是否在冷却期内
    if (rule.lastTriggered && (timestamp - rule.lastTriggered) < rule.duration) {
      return;
    }
    
    // 创建预警
    const alert: Alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      category: rule.category,
      metric: rule.metric,
      currentValue,
      threshold: rule.threshold,
      severity: rule.severity,
      message: this.generateAlertMessage(rule, currentValue),
      timestamp,
      resolved: false
    };
    
    // 添加到预警列表
    this.alerts.push(alert);
    
    // 更新规则状态
    rule.lastTriggered = timestamp;
    rule.triggerCount++;
    
    // 执行预警动作
    await this.executeAlertActions(rule, alert);
    
    // 发出预警事件
    this.emit('alert', alert);
    
    console.warn(`[PerformanceMonitor] 预警触发: ${alert.message}`);
  }

  /**
   * 生成预警消息
   */
  private generateAlertMessage(rule: AlertRule, currentValue: number): string {
    return `${rule.name}: ${rule.metric} 当前值 ${currentValue.toFixed(2)} ${rule.condition} ${rule.threshold}`;
  }

  /**
   * 执行预警动作
   */
  private async executeAlertActions(rule: AlertRule, alert: Alert): Promise<void> {
    for (const action of rule.actions) {
      try {
        switch (action.type) {
          case 'log':
            console.log(`[Alert] ${alert.message}`);
            break;
          case 'webhook':
            await this.sendWebhook(action.config, alert);
            break;
          // 其他动作类型的实现
        }
      } catch (error) {
        console.error(`[PerformanceMonitor] 预警动作执行失败: ${action.type}`, error);
      }
    }
  }

  /**
   * 发送Webhook
   */
  private async sendWebhook(config: any, alert: Alert): Promise<void> {
    // Webhook发送实现
    console.log(`[Webhook] 发送预警: ${alert.message}`);
  }

  /**
   * 初始化默认预警规则
   */
  private initializeDefaultAlertRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high_cpu_usage',
        name: 'CPU使用率过高',
        category: 'system',
        metric: 'system.cpuUsage',
        condition: 'gt',
        threshold: 80,
        duration: 60000, // 1分钟
        severity: 'high',
        enabled: true,
        actions: [{ type: 'log', config: {} }],
        triggerCount: 0
      },
      {
        id: 'high_memory_usage',
        name: '内存使用率过高',
        category: 'system',
        metric: 'system.memoryUsage',
        condition: 'gt',
        threshold: 85,
        duration: 60000,
        severity: 'high',
        enabled: true,
        actions: [{ type: 'log', config: {} }],
        triggerCount: 0
      },
      {
        id: 'low_win_rate',
        name: '胜率过低',
        category: 'trading',
        metric: 'trading.winRate',
        condition: 'lt',
        threshold: 0.5,
        duration: 300000, // 5分钟
        severity: 'medium',
        enabled: true,
        actions: [{ type: 'log', config: {} }],
        triggerCount: 0
      },
      {
        id: 'high_drawdown',
        name: '回撤过大',
        category: 'trading',
        metric: 'trading.maxDrawdown',
        condition: 'gt',
        threshold: 0.1, // 10%
        duration: 60000,
        severity: 'critical',
        enabled: true,
        actions: [{ type: 'log', config: {} }],
        triggerCount: 0
      },
      {
        id: 'high_api_error_rate',
        name: 'API错误率过高',
        category: 'api',
        metric: 'api.errorRate',
        condition: 'gt',
        threshold: 0.05, // 5%
        duration: 120000, // 2分钟
        severity: 'high',
        enabled: true,
        actions: [{ type: 'log', config: {} }],
        triggerCount: 0
      },
      {
        id: 'slow_api_response',
        name: 'API响应时间过慢',
        category: 'api',
        metric: 'api.avgResponseTime',
        condition: 'gt',
        threshold: 1000, // 1秒
        duration: 180000, // 3分钟
        severity: 'medium',
        enabled: true,
        actions: [{ type: 'log', config: {} }],
        triggerCount: 0
      },
      {
        id: 'low_ml_accuracy',
        name: 'ML模型准确率过低',
        category: 'ml',
        metric: 'ml.modelAccuracy',
        condition: 'lt',
        threshold: 0.55,
        duration: 600000, // 10分钟
        severity: 'medium',
        enabled: true,
        actions: [{ type: 'log', config: {} }],
        triggerCount: 0
      },
      {
        id: 'high_risk_score',
        name: '风险评分过高',
        category: 'risk',
        metric: 'risk.riskScore',
        condition: 'gt',
        threshold: 8,
        duration: 60000,
        severity: 'critical',
        enabled: true,
        actions: [{ type: 'log', config: {} }],
        triggerCount: 0
      }
    ];
    
    for (const rule of defaultRules) {
      this.alertRules.set(rule.id, rule);
    }
  }

  /**
   * 确保数据目录存在
   */
  private async ensureDataDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.dataPath, { recursive: true });
    } catch (error) {
      console.error('[PerformanceMonitor] 创建数据目录失败:', error);
    }
  }

  /**
   * 加载历史数据
   */
  private async loadHistoricalData(): Promise<void> {
    try {
      const metricsFile = path.join(this.dataPath, 'metrics.json');
      const alertsFile = path.join(this.dataPath, 'alerts.json');
      
      // 加载指标历史
      try {
        const metricsData = await fs.readFile(metricsFile, 'utf-8');
        this.metrics = JSON.parse(metricsData);
      } catch (error) {
        // 文件不存在或格式错误，使用空数组
        this.metrics = [];
      }
      
      // 加载预警历史
      try {
        const alertsData = await fs.readFile(alertsFile, 'utf-8');
        this.alerts = JSON.parse(alertsData);
      } catch (error) {
        // 文件不存在或格式错误，使用空数组
        this.alerts = [];
      }
      
    } catch (error) {
      console.error('[PerformanceMonitor] 加载历史数据失败:', error);
    }
  }

  /**
   * 保存数据
   */
  private async saveData(): Promise<void> {
    try {
      const metricsFile = path.join(this.dataPath, 'metrics.json');
      const alertsFile = path.join(this.dataPath, 'alerts.json');
      
      // 保存指标历史（只保留最近的数据）
      const recentMetrics = this.metrics.slice(-this.maxMetricsHistory);
      await fs.writeFile(metricsFile, JSON.stringify(recentMetrics, null, 2));
      
      // 保存预警历史（只保留最近30天的）
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const recentAlerts = this.alerts.filter(alert => alert.timestamp > thirtyDaysAgo);
      await fs.writeFile(alertsFile, JSON.stringify(recentAlerts, null, 2));
      
    } catch (error) {
      console.error('[PerformanceMonitor] 保存数据失败:', error);
    }
  }

  /**
   * 获取实时指标
   */
  getCurrentMetrics(): SystemMetrics | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
  }

  /**
   * 获取指标历史
   */
  getMetricsHistory(limit?: number): SystemMetrics[] {
    if (limit) {
      return this.metrics.slice(-limit);
    }
    return [...this.metrics];
  }

  /**
   * 获取活跃预警
   */
  getActiveAlerts(): Alert[] {
    return this.alerts.filter(alert => !alert.resolved);
  }

  /**
   * 获取预警历史
   */
  getAlertsHistory(limit?: number): Alert[] {
    if (limit) {
      return this.alerts.slice(-limit);
    }
    return [...this.alerts];
  }

  /**
   * 解决预警
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = Date.now();
      alert.duration = alert.resolvedAt - alert.timestamp;
      
      this.emit('alertResolved', alert);
      return true;
    }
    return false;
  }

  /**
   * 添加预警规则
   */
  addAlertRule(rule: Omit<AlertRule, 'id' | 'triggerCount'>): string {
    const id = `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullRule: AlertRule = {
      ...rule,
      id,
      triggerCount: 0
    };
    
    this.alertRules.set(id, fullRule);
    this.emit('ruleAdded', fullRule);
    
    return id;
  }

  /**
   * 更新预警规则
   */
  updateAlertRule(id: string, updates: Partial<AlertRule>): boolean {
    const rule = this.alertRules.get(id);
    if (rule) {
      Object.assign(rule, updates);
      this.emit('ruleUpdated', rule);
      return true;
    }
    return false;
  }

  /**
   * 删除预警规则
   */
  removeAlertRule(id: string): boolean {
    const rule = this.alertRules.get(id);
    if (rule) {
      this.alertRules.delete(id);
      this.emit('ruleRemoved', rule);
      return true;
    }
    return false;
  }

  /**
   * 获取所有预警规则
   */
  getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  /**
   * 生成性能报告
   */
  generatePerformanceReport(startTime: number, endTime: number): PerformanceReport {
    const periodMetrics = this.metrics.filter(m => 
      m.timestamp >= startTime && m.timestamp <= endTime
    );
    
    if (periodMetrics.length === 0) {
      throw new Error('指定时间段内没有数据');
    }
    
    // 计算汇总统计
    const summary = this.calculateSummaryStats(periodMetrics);
    
    // 分析趋势
    const trends = this.analyzeTrends(periodMetrics);
    
    // 生成建议
    const recommendations = this.generateRecommendations(summary, trends);
    
    return {
      period: {
        start: startTime,
        end: endTime,
        duration: endTime - startTime
      },
      summary,
      trends,
      recommendations
    };
  }

  /**
   * 计算汇总统计
   */
  private calculateSummaryStats(metrics: SystemMetrics[]): PerformanceReport['summary'] {
    const latest = metrics[metrics.length - 1];
    const periodAlerts = this.alerts.filter(a => 
      a.timestamp >= metrics[0].timestamp && a.timestamp <= latest.timestamp
    );
    
    // 计算平均值
    const avgSystemLoad = metrics.reduce((sum, m) => sum + m.system.cpuUsage, 0) / metrics.length;
    const avgResponseTime = metrics.reduce((sum, m) => sum + m.api.avgResponseTime, 0) / metrics.length;
    
    // 计算API正常运行时间
    const totalRequests = latest.api.totalRequests;
    const successfulRequests = latest.api.successfulRequests;
    const apiUptime = totalRequests > 0 ? (successfulRequests / totalRequests) : 1;
    
    return {
      avgSystemLoad,
      totalTrades: latest.trading.totalTrades,
      winRate: latest.trading.winRate,
      totalPnL: latest.trading.totalPnL,
      maxDrawdown: latest.trading.maxDrawdown,
      sharpeRatio: latest.trading.sharpeRatio,
      apiUptime,
      avgResponseTime,
      errorCount: latest.api.failedRequests,
      alertCount: periodAlerts.length
    };
  }

  /**
   * 分析趋势
   */
  private analyzeTrends(metrics: SystemMetrics[]): PerformanceReport['trends'] {
    if (metrics.length < 2) {
      return [];
    }
    
    const first = metrics[0];
    const last = metrics[metrics.length - 1];
    
    const trends: PerformanceReport['trends'] = [];
    
    // 分析各项指标的趋势
    const trendMetrics = [
      { key: 'system.cpuUsage', name: 'CPU使用率' },
      { key: 'system.memoryUsage', name: '内存使用率' },
      { key: 'trading.winRate', name: '胜率' },
      { key: 'trading.totalPnL', name: '总盈亏' },
      { key: 'api.avgResponseTime', name: 'API响应时间' },
      { key: 'api.errorRate', name: 'API错误率' },
      { key: 'ml.modelAccuracy', name: 'ML准确率' },
      { key: 'risk.riskScore', name: '风险评分' }
    ];
    
    for (const metric of trendMetrics) {
      const firstValue = this.getMetricValue(first, metric.key);
      const lastValue = this.getMetricValue(last, metric.key);
      
      if (firstValue !== undefined && lastValue !== undefined && firstValue !== 0) {
        const change = ((lastValue - firstValue) / firstValue) * 100;
        const absChange = Math.abs(change);
        
        let trend: 'up' | 'down' | 'stable';
        if (absChange < 5) {
          trend = 'stable';
        } else if (change > 0) {
          trend = 'up';
        } else {
          trend = 'down';
        }
        
        let significance: 'low' | 'medium' | 'high';
        if (absChange < 10) {
          significance = 'low';
        } else if (absChange < 25) {
          significance = 'medium';
        } else {
          significance = 'high';
        }
        
        trends.push({
          metric: metric.name,
          trend,
          change,
          significance
        });
      }
    }
    
    return trends;
  }

  /**
   * 生成建议
   */
  private generateRecommendations(
    summary: PerformanceReport['summary'], 
    trends: PerformanceReport['trends']
  ): string[] {
    const recommendations: string[] = [];
    
    // 基于汇总数据的建议
    if (summary.avgSystemLoad > 80) {
      recommendations.push('系统负载过高，建议优化性能或增加资源');
    }
    
    if (summary.winRate < 0.6) {
      recommendations.push('胜率偏低，建议检查交易策略和信号质量');
    }
    
    if (summary.maxDrawdown > 0.1) {
      recommendations.push('最大回撤过大，建议加强风险管理');
    }
    
    if (summary.avgResponseTime > 500) {
      recommendations.push('API响应时间过长，建议优化网络或服务器性能');
    }
    
    if (summary.apiUptime < 0.99) {
      recommendations.push('API可用性不足，建议检查网络连接和服务稳定性');
    }
    
    // 基于趋势的建议
    for (const trend of trends) {
      if (trend.significance === 'high') {
        if (trend.metric === 'CPU使用率' && trend.trend === 'up') {
          recommendations.push('CPU使用率持续上升，需要关注系统性能');
        }
        
        if (trend.metric === '胜率' && trend.trend === 'down') {
          recommendations.push('胜率呈下降趋势，建议重新评估交易策略');
        }
        
        if (trend.metric === 'API错误率' && trend.trend === 'up') {
          recommendations.push('API错误率上升，建议检查网络和服务状态');
        }
        
        if (trend.metric === '风险评分' && trend.trend === 'up') {
          recommendations.push('风险评分上升，建议降低仓位或调整策略');
        }
      }
    }
    
    // 如果没有特别的建议，给出通用建议
    if (recommendations.length === 0) {
      recommendations.push('系统运行正常，建议继续监控关键指标');
    }
    
    return recommendations;
  }

  /**
   * 获取统计信息
   */
  getStatistics(): {
    isRunning: boolean;
    metricsCount: number;
    alertsCount: number;
    activeAlertsCount: number;
    rulesCount: number;
    uptime: number;
  } {
    const currentMetrics = this.getCurrentMetrics();
    
    return {
      isRunning: this.isRunning,
      metricsCount: this.metrics.length,
      alertsCount: this.alerts.length,
      activeAlertsCount: this.getActiveAlerts().length,
      rulesCount: this.alertRules.size,
      uptime: currentMetrics ? currentMetrics.system.uptime : 0
    };
  }

  /**
   * 清除历史数据
   */
  clearHistory(): void {
    this.metrics.length = 0;
    this.alerts.length = 0;
    this.statsCache.clear();
    
    console.log('[PerformanceMonitor] 历史数据已清除');
  }
}

export const enhancedPerformanceMonitor = new EnhancedPerformanceMonitor();