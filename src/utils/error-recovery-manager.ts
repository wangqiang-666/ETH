/**
 * 高级错误恢复和重连管理器
 */

export enum ErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  API_ERROR = 'API_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export enum RecoveryStrategy {
  IMMEDIATE_RETRY = 'IMMEDIATE_RETRY',
  EXPONENTIAL_BACKOFF = 'EXPONENTIAL_BACKOFF',
  LINEAR_BACKOFF = 'LINEAR_BACKOFF',
  CIRCUIT_BREAKER = 'CIRCUIT_BREAKER',
  FALLBACK_ENDPOINT = 'FALLBACK_ENDPOINT',
  NO_RETRY = 'NO_RETRY'
}

interface ErrorPattern {
  type: ErrorType;
  pattern: RegExp | string;
  strategy: RecoveryStrategy;
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  priority: number;
}

interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitterEnabled: boolean;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
}

export interface ErrorStats {
  totalErrors: number;
  errorsByType: Map<ErrorType, number>;
  recoveryAttempts: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  circuitBreakerTrips: number;
  avgRecoveryTime: number;
  lastErrorTime: number;
}

interface CircuitBreakerState {
  isOpen: boolean;
  failureCount: number;
  lastFailureTime: number;
  nextAttemptTime: number;
  successCount: number;
}

/**
 * 错误恢复管理器
 */
export class ErrorRecoveryManager {
  private errorPatterns: ErrorPattern[] = [];
  private retryConfig: RetryConfig;
  private errorStats: ErrorStats;
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private fallbackEndpoints: Map<string, string[]> = new Map();
  private recoveryTimes: number[] = [];

  constructor(config: Partial<RetryConfig> = {}) {
    this.retryConfig = {
      maxRetries: 5,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      jitterEnabled: true,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 60000,
      ...config
    };

    this.errorStats = {
      totalErrors: 0,
      errorsByType: new Map(),
      recoveryAttempts: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      circuitBreakerTrips: 0,
      avgRecoveryTime: 0,
      lastErrorTime: 0
    };

    this.initializeErrorPatterns();
  }

  /**
   * 初始化错误模式
   */
  private initializeErrorPatterns(): void {
    this.errorPatterns = [
      {
        type: ErrorType.NETWORK_ERROR,
        pattern: /ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT/i,
        strategy: RecoveryStrategy.EXPONENTIAL_BACKOFF,
        maxRetries: 5,
        baseDelay: 2000,
        maxDelay: 30000,
        priority: 1
      },
      {
        type: ErrorType.TIMEOUT_ERROR,
        pattern: /timeout|ETIMEDOUT/i,
        strategy: RecoveryStrategy.LINEAR_BACKOFF,
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        priority: 2
      },
      {
        type: ErrorType.RATE_LIMIT_ERROR,
        pattern: /rate limit|429|too many requests/i,
        strategy: RecoveryStrategy.EXPONENTIAL_BACKOFF,
        maxRetries: 15,
        baseDelay: 10000,
        maxDelay: 300000,
        priority: 3
      },
      {
        type: ErrorType.SERVER_ERROR,
        pattern: /5\d{2}|internal server error|bad gateway|service unavailable/i,
        strategy: RecoveryStrategy.CIRCUIT_BREAKER,
        maxRetries: 3,
        baseDelay: 3000,
        maxDelay: 15000,
        priority: 4
      },
      {
        type: ErrorType.AUTH_ERROR,
        pattern: /401|unauthorized|invalid signature|invalid api key/i,
        strategy: RecoveryStrategy.NO_RETRY,
        maxRetries: 0,
        baseDelay: 0,
        maxDelay: 0,
        priority: 5
      },
      {
        type: ErrorType.API_ERROR,
        pattern: /4\d{2}|bad request|invalid parameter/i,
        strategy: RecoveryStrategy.IMMEDIATE_RETRY,
        maxRetries: 2,
        baseDelay: 500,
        maxDelay: 2000,
        priority: 6
      }
    ];
  }

  /**
   * 分析错误类型
   */
  private analyzeError(error: Error): ErrorPattern {
    const errorMessage = error.message.toLowerCase();
    const errorStack = error.stack?.toLowerCase() || '';
    const fullErrorText = `${errorMessage} ${errorStack}`;

    // 按优先级排序查找匹配的错误模式
    const sortedPatterns = this.errorPatterns.sort((a, b) => a.priority - b.priority);
    
    for (const pattern of sortedPatterns) {
      if (pattern.pattern instanceof RegExp) {
        if (pattern.pattern.test(fullErrorText)) {
          return pattern;
        }
      } else {
        if (fullErrorText.includes(pattern.pattern.toLowerCase())) {
          return pattern;
        }
      }
    }

    // 默认错误模式
    return {
      type: ErrorType.UNKNOWN_ERROR,
      pattern: /.*/,
      strategy: RecoveryStrategy.EXPONENTIAL_BACKOFF,
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      priority: 999
    };
  }

  /**
   * 计算重试延迟
   */
  private calculateDelay(attempt: number, strategy: RecoveryStrategy, baseDelay: number, maxDelay: number): number {
    let delay = baseDelay;

    switch (strategy) {
      case RecoveryStrategy.EXPONENTIAL_BACKOFF:
        delay = Math.min(baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt), maxDelay);
        break;
      case RecoveryStrategy.LINEAR_BACKOFF:
        delay = Math.min(baseDelay * (attempt + 1), maxDelay);
        break;
      case RecoveryStrategy.IMMEDIATE_RETRY:
        delay = baseDelay;
        break;
      default:
        delay = baseDelay;
    }

    // 添加抖动以避免雷群效应
    if (this.retryConfig.jitterEnabled) {
      const jitter = Math.random() * 0.3 * delay; // 30%的抖动
      delay += jitter;
    }

    return Math.floor(delay);
  }

  /**
   * 检查熔断器状态
   */
  private checkCircuitBreaker(endpoint: string): boolean {
    const state = this.circuitBreakers.get(endpoint);
    if (!state) {
      this.circuitBreakers.set(endpoint, {
        isOpen: false,
        failureCount: 0,
        lastFailureTime: 0,
        nextAttemptTime: 0,
        successCount: 0
      });
      return false;
    }

    const now = Date.now();
    
    // 如果熔断器开启且还在冷却期
    if (state.isOpen && now < state.nextAttemptTime) {
      return true;
    }

    // 如果熔断器开启但冷却期已过，尝试半开状态
    if (state.isOpen && now >= state.nextAttemptTime) {
      state.isOpen = false;
      console.log(`🔄 熔断器半开状态: ${endpoint}`);
    }

    return false;
  }

  /**
   * 更新熔断器状态
   */
  private updateCircuitBreaker(endpoint: string, success: boolean): void {
    let state = this.circuitBreakers.get(endpoint);
    if (!state) {
      state = {
        isOpen: false,
        failureCount: 0,
        lastFailureTime: 0,
        nextAttemptTime: 0,
        successCount: 0
      };
      this.circuitBreakers.set(endpoint, state);
    }

    const now = Date.now();

    if (success) {
      state.successCount++;
      state.failureCount = 0;
      
      // 如果在半开状态下成功，关闭熔断器
      if (state.isOpen) {
        state.isOpen = false;
        console.log(`✅ 熔断器关闭: ${endpoint}`);
      }
    } else {
      state.failureCount++;
      state.lastFailureTime = now;
      state.successCount = 0;

      // 如果失败次数超过阈值，开启熔断器
      if (state.failureCount >= this.retryConfig.circuitBreakerThreshold) {
        state.isOpen = true;
        state.nextAttemptTime = now + this.retryConfig.circuitBreakerTimeout;
        this.errorStats.circuitBreakerTrips++;
        console.log(`🚨 熔断器开启: ${endpoint}, 冷却时间: ${this.retryConfig.circuitBreakerTimeout}ms`);
      }
    }
  }

  /**
   * 获取备用端点
   */
  private getFallbackEndpoint(originalEndpoint: string): string | null {
    const fallbacks = this.fallbackEndpoints.get(originalEndpoint);
    if (fallbacks && fallbacks.length > 0) {
      // 简单轮询选择备用端点
      const index = Math.floor(Math.random() * fallbacks.length);
      return fallbacks[index];
    }
    return null;
  }

  /**
   * 设置备用端点
   */
  setFallbackEndpoints(endpoint: string, fallbacks: string[]): void {
    this.fallbackEndpoints.set(endpoint, fallbacks);
  }

  /**
   * 执行带错误恢复的操作
   */
  async executeWithRecovery<T>(
    operation: () => Promise<T>,
    endpoint: string,
    context?: any
  ): Promise<T> {
    const startTime = Date.now();
    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt <= this.retryConfig.maxRetries) {
      try {
        // 检查熔断器
        if (this.checkCircuitBreaker(endpoint)) {
          throw new Error(`Circuit breaker is open for endpoint: ${endpoint}`);
        }

        const result = await operation();
        
        // 成功时更新统计和熔断器
        if (attempt > 0) {
          this.errorStats.successfulRecoveries++;
          const recoveryTime = Date.now() - startTime;
          this.recoveryTimes.push(recoveryTime);
          if (this.recoveryTimes.length > 100) {
            this.recoveryTimes = this.recoveryTimes.slice(-100);
          }
          this.updateAvgRecoveryTime();
          console.log(`✅ 错误恢复成功: ${endpoint}, 尝试次数: ${attempt + 1}, 耗时: ${recoveryTime}ms`);
        }
        
        this.updateCircuitBreaker(endpoint, true);
        return result;
        
      } catch (error) {
        lastError = error as Error;
        this.errorStats.totalErrors++;
        this.errorStats.lastErrorTime = Date.now();
        
        // 分析错误类型
        const errorPattern = this.analyzeError(lastError);
        this.updateErrorStats(errorPattern.type);
        
        console.warn(`⚠️ 错误发生: ${endpoint}, 类型: ${errorPattern.type}, 尝试: ${attempt + 1}/${this.retryConfig.maxRetries + 1}`);
        console.warn(`错误详情: ${lastError.message}`);
        
        // 更新熔断器状态
        this.updateCircuitBreaker(endpoint, false);
        
        // 检查是否应该重试
        if (attempt >= errorPattern.maxRetries || errorPattern.strategy === RecoveryStrategy.NO_RETRY) {
          this.errorStats.failedRecoveries++;
          break;
        }
        
        attempt++;
        this.errorStats.recoveryAttempts++;
        
        // 尝试备用端点
        if (errorPattern.strategy === RecoveryStrategy.FALLBACK_ENDPOINT) {
          const fallbackEndpoint = this.getFallbackEndpoint(endpoint);
          if (fallbackEndpoint) {
            console.log(`🔄 尝试备用端点: ${fallbackEndpoint}`);
            // 这里可以修改operation来使用备用端点
          }
        }
        
        // 计算延迟时间
        const delay = this.calculateDelay(
          attempt - 1,
          errorPattern.strategy,
          errorPattern.baseDelay,
          errorPattern.maxDelay
        );
        
        console.log(`⏳ 等待 ${delay}ms 后重试...`);
        await this.sleep(delay);
      }
    }

    // 所有重试都失败了
    this.errorStats.failedRecoveries++;
    throw new Error(`All retry attempts failed for ${endpoint}. Last error: ${lastError?.message}`);
  }

  /**
   * 更新错误统计
   */
  private updateErrorStats(errorType: ErrorType): void {
    const current = this.errorStats.errorsByType.get(errorType) || 0;
    this.errorStats.errorsByType.set(errorType, current + 1);
  }

  /**
   * 更新平均恢复时间
   */
  private updateAvgRecoveryTime(): void {
    if (this.recoveryTimes.length > 0) {
      const sum = this.recoveryTimes.reduce((a, b) => a + b, 0);
      this.errorStats.avgRecoveryTime = sum / this.recoveryTimes.length;
    }
  }

  /**
   * 睡眠函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取错误统计
   */
  getErrorStats(): ErrorStats {
    return {
      ...this.errorStats,
      errorsByType: new Map(this.errorStats.errorsByType)
    };
  }

  /**
   * 获取熔断器状态
   */
  getCircuitBreakerStates(): Map<string, CircuitBreakerState> {
    return new Map(this.circuitBreakers);
  }

  /**
   * 重置错误统计
   */
  resetStats(): void {
    this.errorStats = {
      totalErrors: 0,
      errorsByType: new Map(),
      recoveryAttempts: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      circuitBreakerTrips: 0,
      avgRecoveryTime: 0,
      lastErrorTime: 0
    };
    this.recoveryTimes = [];
  }

  /**
   * 重置熔断器
   */
  resetCircuitBreakers(): void {
    this.circuitBreakers.clear();
    console.log('🔄 所有熔断器已重置');
  }

  /**
   * 手动开启熔断器
   */
  openCircuitBreaker(endpoint: string, timeout?: number): void {
    const state = this.circuitBreakers.get(endpoint) || {
      isOpen: false,
      failureCount: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
      successCount: 0
    };
    
    state.isOpen = true;
    state.nextAttemptTime = Date.now() + (timeout || this.retryConfig.circuitBreakerTimeout);
    this.circuitBreakers.set(endpoint, state);
    
    console.log(`🚨 手动开启熔断器: ${endpoint}`);
  }

  /**
   * 手动关闭熔断器
   */
  closeCircuitBreaker(endpoint: string): void {
    const state = this.circuitBreakers.get(endpoint);
    if (state) {
      state.isOpen = false;
      state.failureCount = 0;
      state.nextAttemptTime = 0;
      console.log(`✅ 手动关闭熔断器: ${endpoint}`);
    }
  }

  /**
   * 获取健康报告
   */
  getHealthReport(): any {
    const stats = this.getErrorStats();
    const circuitBreakers = this.getCircuitBreakerStates();
    
    const totalRequests = stats.successfulRecoveries + stats.failedRecoveries + stats.totalErrors;
    const successRate = totalRequests > 0 ? (stats.successfulRecoveries / totalRequests) * 100 : 100;
    const errorRate = totalRequests > 0 ? (stats.totalErrors / totalRequests) * 100 : 0;
    
    const openCircuitBreakers = Array.from(circuitBreakers.entries())
      .filter(([_, state]) => state.isOpen)
      .map(([endpoint, _]) => endpoint);
    
    return {
      summary: {
        totalRequests,
        successRate: Math.round(successRate * 100) / 100,
        errorRate: Math.round(errorRate * 100) / 100,
        avgRecoveryTime: Math.round(stats.avgRecoveryTime),
        openCircuitBreakers: openCircuitBreakers.length
      },
      errorStats: {
        totalErrors: stats.totalErrors,
        recoveryAttempts: stats.recoveryAttempts,
        successfulRecoveries: stats.successfulRecoveries,
        failedRecoveries: stats.failedRecoveries,
        circuitBreakerTrips: stats.circuitBreakerTrips,
        lastErrorTime: stats.lastErrorTime ? new Date(stats.lastErrorTime).toISOString() : null,
        errorsByType: Object.fromEntries(stats.errorsByType)
      },
      circuitBreakers: {
        total: circuitBreakers.size,
        open: openCircuitBreakers,
        states: Object.fromEntries(
          Array.from(circuitBreakers.entries()).map(([endpoint, state]) => [
            endpoint,
            {
              isOpen: state.isOpen,
              failureCount: state.failureCount,
              successCount: state.successCount,
              nextAttemptTime: state.nextAttemptTime ? new Date(state.nextAttemptTime).toISOString() : null
            }
          ])
        )
      }
    };
  }
}

/**
 * 默认错误恢复管理器实例
 */
export const defaultErrorRecoveryManager = new ErrorRecoveryManager({
  maxRetries: 5,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitterEnabled: true,
  circuitBreakerThreshold: 5,
  circuitBreakerTimeout: 60000
});