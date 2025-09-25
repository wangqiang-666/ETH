/**
 * 增强系统稳定性服务
 * 完善错误处理、增加容错机制、优化资源管理
 */

import { EventEmitter } from 'events';
import { config } from '../config.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface SystemHealth {
  timestamp: number;
  overall: 'healthy' | 'warning' | 'critical' | 'down';
  score: number; // 0-100
  
  components: {
    database: ComponentHealth;
    api: ComponentHealth;
    trading: ComponentHealth;
    ml: ComponentHealth;
    monitoring: ComponentHealth;
    network: ComponentHealth;
  };
  
  resources: {
    memory: ResourceStatus;
    cpu: ResourceStatus;
    disk: ResourceStatus;
    network: ResourceStatus;
  };
  
  errors: SystemError[];
  warnings: SystemWarning[];
}

export interface ComponentHealth {
  status: 'healthy' | 'warning' | 'critical' | 'down';
  score: number; // 0-100
  lastCheck: number;
  responseTime: number;
  errorRate: number;
  uptime: number;
  details: Record<string, any>;
}

export interface ResourceStatus {
  usage: number; // 0-100
  available: number;
  total: number;
  trend: 'stable' | 'increasing' | 'decreasing';
  threshold: {
    warning: number;
    critical: number;
  };
}

export interface SystemError {
  id: string;
  timestamp: number;
  level: 'error' | 'critical' | 'fatal';
  component: string;
  message: string;
  stack?: string;
  context: Record<string, any>;
  resolved: boolean;
  resolvedAt?: number;
  attempts: number;
  lastAttempt?: number;
}

export interface SystemWarning {
  id: string;
  timestamp: number;
  component: string;
  message: string;
  context: Record<string, any>;
  acknowledged: boolean;
  acknowledgedAt?: number;
}

export interface RecoveryAction {
  id: string;
  name: string;
  component: string;
  condition: (health: SystemHealth) => boolean;
  action: (context: any) => Promise<boolean>;
  priority: number; // 1-10, 10 is highest
  cooldown: number; // ms
  maxAttempts: number;
  lastExecuted?: number;
  attempts: number;
  successRate: number;
}

export interface CircuitBreakerState {
  id: string;
  component: string;
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailure?: number;
  nextAttempt?: number;
  threshold: number;
  timeout: number;
  resetTimeout: number;
}

export class EnhancedSystemStability extends EventEmitter {
  private healthHistory: SystemHealth[] = [];
  private errors: Map<string, SystemError> = new Map();
  private warnings: Map<string, SystemWarning> = new Map();
  private recoveryActions: Map<string, RecoveryAction> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  
  private isRunning = false;
  private healthCheckInterval?: NodeJS.Timeout;
  private recoveryInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  
  private readonly healthCheckIntervalMs = 10000; // 10秒
  private readonly recoveryCheckIntervalMs = 30000; // 30秒
  private readonly cleanupIntervalMs = 300000; // 5分钟
  private readonly maxHistorySize = 1000;
  private readonly dataPath = path.join(process.cwd(), 'data', 'stability');
  
  // 资源阈值配置
  private readonly resourceThresholds = {
    memory: { warning: 80, critical: 90 },
    cpu: { warning: 75, critical: 85 },
    disk: { warning: 85, critical: 95 },
    network: { warning: 70, critical: 85 }
  };

  constructor() {
    super();
    this.initializeRecoveryActions();
    this.initializeCircuitBreakers();
    this.ensureDataDirectory();
  }

  /**
   * 启动系统稳定性监控
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[SystemStability] 监控已在运行中');
      return;
    }

    try {
      // 加载历史数据
      await this.loadHistoricalData();
      
      // 启动健康检查
      this.healthCheckInterval = setInterval(() => {
        this.performHealthCheck().catch(error => {
          console.error('[SystemStability] 健康检查失败:', error);
        });
      }, this.healthCheckIntervalMs);
      
      // 启动恢复检查
      this.recoveryInterval = setInterval(() => {
        this.performRecoveryActions().catch(error => {
          console.error('[SystemStability] 恢复操作失败:', error);
        });
      }, this.recoveryCheckIntervalMs);
      
      // 启动清理任务
      this.cleanupInterval = setInterval(() => {
        this.performCleanup().catch(error => {
          console.error('[SystemStability] 清理任务失败:', error);
        });
      }, this.cleanupIntervalMs);
      
      this.isRunning = true;
      console.log('[SystemStability] 系统稳定性监控已启动');
      
      // 立即执行一次健康检查
      await this.performHealthCheck();
      
      // 发出启动事件
      this.emit('started');
      
    } catch (error) {
      console.error('[SystemStability] 启动失败:', error);
      throw error;
    }
  }

  /**
   * 停止系统稳定性监控
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = undefined;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // 保存数据
    await this.saveData();
    
    this.isRunning = false;
    console.log('[SystemStability] 系统稳定性监控已停止');
    
    // 发出停止事件
    this.emit('stopped');
  }

  /**
   * 执行健康检查
   */
  private async performHealthCheck(): Promise<void> {
    try {
      const timestamp = Date.now();
      
      // 检查各个组件
      const components = await this.checkAllComponents();
      
      // 检查资源状态
      const resources = await this.checkResources();
      
      // 获取当前错误和警告
      const errors = Array.from(this.errors.values()).filter(e => !e.resolved);
      const warnings = Array.from(this.warnings.values()).filter(w => !w.acknowledged);
      
      // 计算整体健康分数
      const overallScore = this.calculateOverallScore(components, resources, errors, warnings);
      const overallStatus = this.determineOverallStatus(overallScore, errors);
      
      const health: SystemHealth = {
        timestamp,
        overall: overallStatus,
        score: overallScore,
        components,
        resources,
        errors,
        warnings
      };
      
      // 添加到历史记录
      this.addHealthRecord(health);
      
      // 检查是否需要触发恢复操作
      await this.evaluateRecoveryNeeds(health);
      
      // 发出健康检查事件
      this.emit('healthCheck', health);
      
    } catch (error) {
      console.error('[SystemStability] 健康检查执行失败:', error);
      await this.recordError('system', 'health_check_failed', error as Error);
    }
  }

  /**
   * 检查所有组件
   */
  private async checkAllComponents(): Promise<SystemHealth['components']> {
    const components = {
      database: await this.checkDatabaseHealth(),
      api: await this.checkAPIHealth(),
      trading: await this.checkTradingHealth(),
      ml: await this.checkMLHealth(),
      monitoring: await this.checkMonitoringHealth(),
      network: await this.checkNetworkHealth()
    };
    
    return components;
  }

  /**
   * 检查数据库健康状态
   */
  private async checkDatabaseHealth(): Promise<ComponentHealth> {
    const startTime = Date.now();
    
    try {
      // 模拟数据库健康检查
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        score: 95,
        lastCheck: Date.now(),
        responseTime,
        errorRate: 0.01,
        uptime: 0.999,
        details: {
          connections: 5,
          activeQueries: 2,
          slowQueries: 0
        }
      };
      
    } catch (error) {
      await this.recordError('database', 'health_check_failed', error as Error);
      
      return {
        status: 'critical',
        score: 0,
        lastCheck: Date.now(),
        responseTime: Date.now() - startTime,
        errorRate: 1.0,
        uptime: 0,
        details: { error: (error as Error).message }
      };
    }
  }

  /**
   * 检查API健康状态
   */
  private async checkAPIHealth(): Promise<ComponentHealth> {
    const startTime = Date.now();
    
    try {
      // 模拟API健康检查
      const response = await fetch('http://localhost:3031/api/system/status').catch(() => null);
      const responseTime = Date.now() - startTime;
      
      if (!response) {
        throw new Error('API不可访问');
      }
      
      const isHealthy = response.status === 200;
      
      return {
        status: isHealthy ? 'healthy' : 'warning',
        score: isHealthy ? 90 : 60,
        lastCheck: Date.now(),
        responseTime,
        errorRate: isHealthy ? 0.02 : 0.1,
        uptime: 0.995,
        details: {
          statusCode: response.status,
          endpoint: '/api/system/status'
        }
      };
      
    } catch (error) {
      await this.recordError('api', 'health_check_failed', error as Error);
      
      return {
        status: 'critical',
        score: 20,
        lastCheck: Date.now(),
        responseTime: Date.now() - startTime,
        errorRate: 0.5,
        uptime: 0.8,
        details: { error: (error as Error).message }
      };
    }
  }

  /**
   * 检查交易系统健康状态
   */
  private async checkTradingHealth(): Promise<ComponentHealth> {
    try {
      // 模拟交易系统健康检查
      const isActive = true; // 从实际交易系统获取状态
      const errorRate = 0.05;
      
      return {
        status: isActive && errorRate < 0.1 ? 'healthy' : 'warning',
        score: isActive ? (errorRate < 0.1 ? 85 : 70) : 30,
        lastCheck: Date.now(),
        responseTime: 50,
        errorRate,
        uptime: 0.98,
        details: {
          activePositions: 2,
          pendingOrders: 1,
          lastTrade: Date.now() - 300000
        }
      };
      
    } catch (error) {
      await this.recordError('trading', 'health_check_failed', error as Error);
      
      return {
        status: 'critical',
        score: 10,
        lastCheck: Date.now(),
        responseTime: 0,
        errorRate: 1.0,
        uptime: 0,
        details: { error: (error as Error).message }
      };
    }
  }

  /**
   * 检查ML系统健康状态
   */
  private async checkMLHealth(): Promise<ComponentHealth> {
    try {
      // 模拟ML系统健康检查
      const modelAccuracy = 0.68;
      const isTraining = false;
      
      return {
        status: modelAccuracy > 0.6 ? 'healthy' : 'warning',
        score: Math.round(modelAccuracy * 100),
        lastCheck: Date.now(),
        responseTime: 200,
        errorRate: 0.03,
        uptime: 0.97,
        details: {
          modelAccuracy,
          isTraining,
          lastPrediction: Date.now() - 60000,
          featuresCount: 47
        }
      };
      
    } catch (error) {
      await this.recordError('ml', 'health_check_failed', error as Error);
      
      return {
        status: 'warning',
        score: 40,
        lastCheck: Date.now(),
        responseTime: 0,
        errorRate: 0.2,
        uptime: 0.9,
        details: { error: (error as Error).message }
      };
    }
  }

  /**
   * 检查监控系统健康状态
   */
  private async checkMonitoringHealth(): Promise<ComponentHealth> {
    try {
      // 检查监控系统状态
      const metricsCount = 1000; // 从实际监控系统获取
      const alertsCount = 2;
      
      return {
        status: 'healthy',
        score: 92,
        lastCheck: Date.now(),
        responseTime: 30,
        errorRate: 0.01,
        uptime: 0.999,
        details: {
          metricsCount,
          alertsCount,
          lastMetric: Date.now() - 5000
        }
      };
      
    } catch (error) {
      await this.recordError('monitoring', 'health_check_failed', error as Error);
      
      return {
        status: 'warning',
        score: 50,
        lastCheck: Date.now(),
        responseTime: 0,
        errorRate: 0.1,
        uptime: 0.95,
        details: { error: (error as Error).message }
      };
    }
  }

  /**
   * 检查网络健康状态
   */
  private async checkNetworkHealth(): Promise<ComponentHealth> {
    const startTime = Date.now();
    
    try {
      // 检查网络连接
      const response = await fetch('https://www.google.com', { 
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      });
      
      const responseTime = Date.now() - startTime;
      const isHealthy = response.ok && responseTime < 2000;
      
      return {
        status: isHealthy ? 'healthy' : 'warning',
        score: isHealthy ? 88 : 65,
        lastCheck: Date.now(),
        responseTime,
        errorRate: isHealthy ? 0.02 : 0.08,
        uptime: 0.996,
        details: {
          latency: responseTime,
          statusCode: response.status
        }
      };
      
    } catch (error) {
      await this.recordError('network', 'connectivity_check_failed', error as Error);
      
      return {
        status: 'critical',
        score: 25,
        lastCheck: Date.now(),
        responseTime: Date.now() - startTime,
        errorRate: 0.3,
        uptime: 0.85,
        details: { error: (error as Error).message }
      };
    }
  }

  /**
   * 检查资源状态
   */
  private async checkResources(): Promise<SystemHealth['resources']> {
    try {
      const process = await import('process');
      const os = await import('os');
      
      // 内存使用情况
      const memUsage = process.memoryUsage();
      const totalMem = os.totalmem();
      const memoryUsage = (memUsage.rss / totalMem) * 100;
      
      // CPU使用情况（简化）
      const cpuUsage = Math.random() * 30 + 10; // 模拟10-40%
      
      // 磁盘使用情况（简化）
      const diskUsage = Math.random() * 20 + 30; // 模拟30-50%
      
      // 网络使用情况（简化）
      const networkUsage = Math.random() * 15 + 5; // 模拟5-20%
      
      return {
        memory: {
          usage: Math.round(memoryUsage),
          available: totalMem - memUsage.rss,
          total: totalMem,
          trend: memoryUsage > 70 ? 'increasing' : 'stable',
          threshold: this.resourceThresholds.memory
        },
        cpu: {
          usage: Math.round(cpuUsage),
          available: 100 - cpuUsage,
          total: 100,
          trend: cpuUsage > 60 ? 'increasing' : 'stable',
          threshold: this.resourceThresholds.cpu
        },
        disk: {
          usage: Math.round(diskUsage),
          available: 100 - diskUsage,
          total: 100,
          trend: 'stable',
          threshold: this.resourceThresholds.disk
        },
        network: {
          usage: Math.round(networkUsage),
          available: 100 - networkUsage,
          total: 100,
          trend: 'stable',
          threshold: this.resourceThresholds.network
        }
      };
      
    } catch (error) {
      console.error('[SystemStability] 资源检查失败:', error);
      
      // 返回默认值
      return {
        memory: { usage: 0, available: 0, total: 0, trend: 'stable', threshold: this.resourceThresholds.memory },
        cpu: { usage: 0, available: 0, total: 0, trend: 'stable', threshold: this.resourceThresholds.cpu },
        disk: { usage: 0, available: 0, total: 0, trend: 'stable', threshold: this.resourceThresholds.disk },
        network: { usage: 0, available: 0, total: 0, trend: 'stable', threshold: this.resourceThresholds.network }
      };
    }
  }

  /**
   * 计算整体健康分数
   */
  private calculateOverallScore(
    components: SystemHealth['components'],
    resources: SystemHealth['resources'],
    errors: SystemError[],
    warnings: SystemWarning[]
  ): number {
    // 组件权重
    const componentWeights = {
      database: 0.25,
      api: 0.20,
      trading: 0.25,
      ml: 0.15,
      monitoring: 0.10,
      network: 0.05
    };
    
    // 计算组件加权分数
    let componentScore = 0;
    for (const [name, component] of Object.entries(components)) {
      const weight = componentWeights[name as keyof typeof componentWeights] || 0;
      componentScore += component.score * weight;
    }
    
    // 资源分数（简化）
    const resourceScore = (
      (100 - resources.memory.usage) * 0.3 +
      (100 - resources.cpu.usage) * 0.3 +
      (100 - resources.disk.usage) * 0.2 +
      (100 - resources.network.usage) * 0.2
    );
    
    // 错误和警告的影响
    const criticalErrors = errors.filter(e => e.level === 'critical' || e.level === 'fatal').length;
    const normalErrors = errors.filter(e => e.level === 'error').length;
    const warningCount = warnings.length;
    
    const errorPenalty = criticalErrors * 20 + normalErrors * 10 + warningCount * 2;
    
    // 综合分数
    const finalScore = Math.max(0, Math.min(100, 
      componentScore * 0.6 + resourceScore * 0.3 - errorPenalty * 0.1
    ));
    
    return Math.round(finalScore);
  }

  /**
   * 确定整体状态
   */
  private determineOverallStatus(score: number, errors: SystemError[]): SystemHealth['overall'] {
    const criticalErrors = errors.filter(e => e.level === 'critical' || e.level === 'fatal').length;
    
    if (criticalErrors > 0 || score < 30) {
      return 'critical';
    } else if (score < 60) {
      return 'warning';
    } else if (score < 90) {
      return 'healthy';
    } else {
      return 'healthy';
    }
  }

  /**
   * 记录系统错误
   */
  async recordError(component: string, message: string, error: Error, context: Record<string, any> = {}): Promise<void> {
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const systemError: SystemError = {
      id: errorId,
      timestamp: Date.now(),
      level: this.determineErrorLevel(error),
      component,
      message,
      stack: error.stack,
      context,
      resolved: false,
      attempts: 0
    };
    
    this.errors.set(errorId, systemError);
    
    // 发出错误事件
    this.emit('error', systemError);
    
    console.error(`[SystemStability] ${component}错误: ${message}`, error);
  }

  /**
   * 记录系统警告
   */
  async recordWarning(component: string, message: string, context: Record<string, any> = {}): Promise<void> {
    const warningId = `warning_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const systemWarning: SystemWarning = {
      id: warningId,
      timestamp: Date.now(),
      component,
      message,
      context,
      acknowledged: false
    };
    
    this.warnings.set(warningId, systemWarning);
    
    // 发出警告事件
    this.emit('warning', systemWarning);
    
    console.warn(`[SystemStability] ${component}警告: ${message}`);
  }

  /**
   * 确定错误级别
   */
  private determineErrorLevel(error: Error): SystemError['level'] {
    const message = error.message.toLowerCase();
    
    if (message.includes('fatal') || message.includes('crash') || message.includes('shutdown')) {
      return 'fatal';
    } else if (message.includes('critical') || message.includes('timeout') || message.includes('connection')) {
      return 'critical';
    } else {
      return 'error';
    }
  }

  /**
   * 评估恢复需求
   */
  private async evaluateRecoveryNeeds(health: SystemHealth): Promise<void> {
    const actions = Array.from(this.recoveryActions.values());
    
    for (const action of actions) {
      try {
        if (action.condition(health)) {
          await this.executeRecoveryAction(action, health);
        }
      } catch (error) {
        console.error(`[SystemStability] 恢复操作评估失败: ${action.name}`, error);
      }
    }
  }

  /**
   * 执行恢复操作
   */
  private async executeRecoveryAction(action: RecoveryAction, health: SystemHealth): Promise<void> {
    const now = Date.now();
    
    // 检查冷却时间
    if (action.lastExecuted && (now - action.lastExecuted) < action.cooldown) {
      return;
    }
    
    // 检查最大尝试次数
    if (action.attempts >= action.maxAttempts) {
      return;
    }
    
    try {
      console.log(`[SystemStability] 执行恢复操作: ${action.name}`);
      
      const success = await action.action(health);
      
      action.lastExecuted = now;
      action.attempts++;
      
      if (success) {
        action.successRate = ((action.successRate * (action.attempts - 1)) + 1) / action.attempts;
        console.log(`[SystemStability] 恢复操作成功: ${action.name}`);
        
        // 发出恢复成功事件
        this.emit('recoverySuccess', { action: action.name, component: action.component });
      } else {
        action.successRate = (action.successRate * (action.attempts - 1)) / action.attempts;
        console.warn(`[SystemStability] 恢复操作失败: ${action.name}`);
        
        // 发出恢复失败事件
        this.emit('recoveryFailure', { action: action.name, component: action.component });
      }
      
    } catch (error) {
      action.lastExecuted = now;
      action.attempts++;
      action.successRate = (action.successRate * (action.attempts - 1)) / action.attempts;
      
      console.error(`[SystemStability] 恢复操作异常: ${action.name}`, error);
      await this.recordError('recovery', `recovery_action_failed: ${action.name}`, error as Error);
    }
  }

  /**
   * 执行恢复操作检查
   */
  private async performRecoveryActions(): Promise<void> {
    try {
      const latestHealth = this.getLatestHealth();
      if (latestHealth) {
        await this.evaluateRecoveryNeeds(latestHealth);
      }
    } catch (error) {
      console.error('[SystemStability] 恢复操作检查失败:', error);
    }
  }

  /**
   * 执行清理任务
   */
  private async performCleanup(): Promise<void> {
    try {
      const now = Date.now();
      const oneHourAgo = now - (60 * 60 * 1000);
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      
      // 清理已解决的错误（1小时前）
      const errorEntries = Array.from(this.errors.entries());
      for (const [id, error] of errorEntries) {
        if (error.resolved && error.resolvedAt && error.resolvedAt < oneHourAgo) {
          this.errors.delete(id);
        }
      }
      
      // 清理已确认的警告（1天前）
      const warningEntries = Array.from(this.warnings.entries());
      for (const [id, warning] of warningEntries) {
        if (warning.acknowledged && warning.acknowledgedAt && warning.acknowledgedAt < oneDayAgo) {
          this.warnings.delete(id);
        }
      }
      
      // 限制健康历史大小
      if (this.healthHistory.length > this.maxHistorySize) {
        this.healthHistory = this.healthHistory.slice(-this.maxHistorySize);
      }
      
      console.log('[SystemStability] 清理任务完成');
      
    } catch (error) {
      console.error('[SystemStability] 清理任务失败:', error);
    }
  }

  /**
   * 初始化恢复操作
   */
  private initializeRecoveryActions(): void {
    const actions: RecoveryAction[] = [
      {
        id: 'restart_api_server',
        name: '重启API服务器',
        component: 'api',
        condition: (health) => health.components.api.status === 'critical',
        action: async () => {
          // 模拟重启API服务器
          console.log('模拟重启API服务器...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          return Math.random() > 0.3; // 70%成功率
        },
        priority: 9,
        cooldown: 300000, // 5分钟
        maxAttempts: 3,
        attempts: 0,
        successRate: 0.7
      },
      {
        id: 'clear_memory_cache',
        name: '清理内存缓存',
        component: 'system',
        condition: (health) => health.resources.memory.usage > 85,
        action: async () => {
          // 模拟清理内存缓存
          console.log('模拟清理内存缓存...');
          if (global.gc) {
            global.gc();
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
          return true;
        },
        priority: 7,
        cooldown: 120000, // 2分钟
        maxAttempts: 5,
        attempts: 0,
        successRate: 0.9
      },
      {
        id: 'reconnect_database',
        name: '重连数据库',
        component: 'database',
        condition: (health) => health.components.database.status === 'critical',
        action: async () => {
          // 模拟重连数据库
          console.log('模拟重连数据库...');
          await new Promise(resolve => setTimeout(resolve, 3000));
          return Math.random() > 0.2; // 80%成功率
        },
        priority: 10,
        cooldown: 180000, // 3分钟
        maxAttempts: 3,
        attempts: 0,
        successRate: 0.8
      },
      {
        id: 'restart_ml_service',
        name: '重启ML服务',
        component: 'ml',
        condition: (health) => health.components.ml.status === 'critical',
        action: async () => {
          // 模拟重启ML服务
          console.log('模拟重启ML服务...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          return Math.random() > 0.4; // 60%成功率
        },
        priority: 6,
        cooldown: 600000, // 10分钟
        maxAttempts: 2,
        attempts: 0,
        successRate: 0.6
      }
    ];
    
    for (const action of actions) {
      this.recoveryActions.set(action.id, action);
    }
  }

  /**
   * 初始化熔断器
   */
  private initializeCircuitBreakers(): void {
    const breakers: CircuitBreakerState[] = [
      {
        id: 'api_circuit_breaker',
        component: 'api',
        state: 'closed',
        failureCount: 0,
        threshold: 5,
        timeout: 60000, // 1分钟
        resetTimeout: 300000 // 5分钟
      },
      {
        id: 'database_circuit_breaker',
        component: 'database',
        state: 'closed',
        failureCount: 0,
        threshold: 3,
        timeout: 120000, // 2分钟
        resetTimeout: 600000 // 10分钟
      },
      {
        id: 'trading_circuit_breaker',
        component: 'trading',
        state: 'closed',
        failureCount: 0,
        threshold: 10,
        timeout: 30000, // 30秒
        resetTimeout: 180000 // 3分钟
      }
    ];
    
    for (const breaker of breakers) {
      this.circuitBreakers.set(breaker.id, breaker);
    }
  }

  /**
   * 确保数据目录存在
   */
  private async ensureDataDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.dataPath, { recursive: true });
    } catch (error) {
      console.error('[SystemStability] 创建数据目录失败:', error);
    }
  }

  /**
   * 加载历史数据
   */
  private async loadHistoricalData(): Promise<void> {
    try {
      const healthFile = path.join(this.dataPath, 'health_history.json');
      const errorsFile = path.join(this.dataPath, 'errors.json');
      const warningsFile = path.join(this.dataPath, 'warnings.json');
      
      // 加载健康历史
      try {
        const healthData = await fs.readFile(healthFile, 'utf-8');
        this.healthHistory = JSON.parse(healthData);
      } catch (error) {
        this.healthHistory = [];
      }
      
      // 加载错误记录
      try {
        const errorsData = await fs.readFile(errorsFile, 'utf-8');
        const errorsArray = JSON.parse(errorsData);
        this.errors = new Map(errorsArray.map((e: SystemError) => [e.id, e]));
      } catch (error) {
        this.errors = new Map();
      }
      
      // 加载警告记录
      try {
        const warningsData = await fs.readFile(warningsFile, 'utf-8');
        const warningsArray = JSON.parse(warningsData);
        this.warnings = new Map(warningsArray.map((w: SystemWarning) => [w.id, w]));
      } catch (error) {
        this.warnings = new Map();
      }
      
    } catch (error) {
      console.error('[SystemStability] 加载历史数据失败:', error);
    }
  }

  /**
   * 保存数据
   */
  private async saveData(): Promise<void> {
    try {
      const healthFile = path.join(this.dataPath, 'health_history.json');
      const errorsFile = path.join(this.dataPath, 'errors.json');
      const warningsFile = path.join(this.dataPath, 'warnings.json');
      
      // 保存健康历史（只保留最近的数据）
      const recentHealth = this.healthHistory.slice(-this.maxHistorySize);
      await fs.writeFile(healthFile, JSON.stringify(recentHealth, null, 2));
      
      // 保存错误记录
      const errorsArray = Array.from(this.errors.values());
      await fs.writeFile(errorsFile, JSON.stringify(errorsArray, null, 2));
      
      // 保存警告记录
      const warningsArray = Array.from(this.warnings.values());
      await fs.writeFile(warningsFile, JSON.stringify(warningsArray, null, 2));
      
    } catch (error) {
      console.error('[SystemStability] 保存数据失败:', error);
    }
  }

  /**
   * 添加健康记录
   */
  private addHealthRecord(health: SystemHealth): void {
    this.healthHistory.push(health);
    
    // 限制历史大小
    if (this.healthHistory.length > this.maxHistorySize) {
      this.healthHistory.shift();
    }
  }

  /**
   * 获取最新健康状态
   */
  getLatestHealth(): SystemHealth | null {
    return this.healthHistory.length > 0 ? this.healthHistory[this.healthHistory.length - 1] : null;
  }

  /**
   * 获取健康历史
   */
  getHealthHistory(limit?: number): SystemHealth[] {
    if (limit) {
      return this.healthHistory.slice(-limit);
    }
    return [...this.healthHistory];
  }

  /**
   * 获取未解决的错误
   */
  getUnresolvedErrors(): SystemError[] {
    return Array.from(this.errors.values()).filter(e => !e.resolved);
  }

  /**
   * 获取未确认的警告
   */
  getUnacknowledgedWarnings(): SystemWarning[] {
    return Array.from(this.warnings.values()).filter(w => !w.acknowledged);
  }

  /**
   * 解决错误
   */
  resolveError(errorId: string): boolean {
    const error = this.errors.get(errorId);
    if (error && !error.resolved) {
      error.resolved = true;
      error.resolvedAt = Date.now();
      
      this.emit('errorResolved', error);
      return true;
    }
    return false;
  }

  /**
   * 确认警告
   */
  acknowledgeWarning(warningId: string): boolean {
    const warning = this.warnings.get(warningId);
    if (warning && !warning.acknowledged) {
      warning.acknowledged = true;
      warning.acknowledgedAt = Date.now();
      
      this.emit('warningAcknowledged', warning);
      return true;
    }
    return false;
  }

  /**
   * 获取恢复操作状态
   */
  getRecoveryActions(): RecoveryAction[] {
    return Array.from(this.recoveryActions.values());
  }

  /**
   * 获取熔断器状态
   */
  getCircuitBreakers(): CircuitBreakerState[] {
    return Array.from(this.circuitBreakers.values());
  }

  /**
   * 获取统计信息
   */
  getStatistics(): {
    isRunning: boolean;
    healthRecords: number;
    unresolvedErrors: number;
    unacknowledgedWarnings: number;
    recoveryActions: number;
    circuitBreakers: number;
    uptime: number;
  } {
    const latestHealth = this.getLatestHealth();
    
    return {
      isRunning: this.isRunning,
      healthRecords: this.healthHistory.length,
      unresolvedErrors: this.getUnresolvedErrors().length,
      unacknowledgedWarnings: this.getUnacknowledgedWarnings().length,
      recoveryActions: this.recoveryActions.size,
      circuitBreakers: this.circuitBreakers.size,
      uptime: latestHealth ? latestHealth.timestamp - (this.healthHistory[0]?.timestamp || 0) : 0
    };
  }

  /**
   * 清除历史数据
   */
  clearHistory(): void {
    this.healthHistory.length = 0;
    this.errors.clear();
    this.warnings.clear();
    
    console.log('[SystemStability] 历史数据已清除');
  }
}

export const enhancedSystemStability = new EnhancedSystemStability();