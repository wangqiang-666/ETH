import { EventEmitter } from 'events';
import { MarketStateAnalyzer, MarketStateResult, MarketState, TimeFrame } from '../analyzers/market-state-analyzer.js';
import { KlineData } from '../indicators/technical-indicators.js';
import { AdaptiveParameterManager, AdaptiveParameters } from '../config/adaptive-parameters.js';
import { ModelCalibrationService } from '../ml/model-calibration-service.js';
import { HotUpdateService } from '../services/hot-update-service.js';
import { AdaptiveStrategyService, StrategySignal, PerformanceMetrics } from '../services/adaptive-strategy-service.js';
import { config } from '../config.js';

/**
 * 系统集成事件
 */
export enum IntegrationEvent {
    SYSTEM_INITIALIZED = 'system_initialized',
    PERFORMANCE_EVALUATED = 'performance_evaluated',
    BENCHMARK_COMPLETED = 'benchmark_completed',
    ERROR = 'error',
    WARNING = 'warning'
}

/**
 * 性能基准测试结果
 */
export interface BenchmarkResult {
    testName: string;
    duration: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    totalTrades: number;
    avgReturn: number;
    volatility: number;
    calmarRatio: number;
    sortinoRatio: number;
    profitFactor: number;
    brierScore: number;
    calibrationError: number;
    marketStateAccuracy: number;
    parameterStability: number;
    timestamp: number;
}

/**
 * 系统健康状态
 */
export interface SystemHealth {
    overall: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    components: {
        marketStateAnalyzer: 'HEALTHY' | 'WARNING' | 'CRITICAL';
        parameterManager: 'HEALTHY' | 'WARNING' | 'CRITICAL';
        calibrationService: 'HEALTHY' | 'WARNING' | 'CRITICAL';
        hotUpdateService: 'HEALTHY' | 'WARNING' | 'CRITICAL';
        adaptiveStrategy: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    };
    metrics: {
        uptime: number;
        memoryUsage: number;
        cpuUsage: number;
        errorRate: number;
        responseTime: number;
    };
    lastCheck: number;
}

/**
 * 集成测试配置
 */
export interface IntegrationTestConfig {
    enableRealTimeTest: boolean;
    enableBacktest: boolean;
    backtestPeriod: number;        // 回测周期(天)
    benchmarkInterval: number;     // 基准测试间隔(ms)
    healthCheckInterval: number;   // 健康检查间隔(ms)
    performanceThresholds: {
        minSharpeRatio: number;
        maxDrawdown: number;
        minWinRate: number;
        maxCalibrationError: number;
    };
}

/**
 * 自适应系统集成器
 */
export class AdaptiveSystemIntegration extends EventEmitter {
    private marketStateAnalyzer!: MarketStateAnalyzer;
    private parameterManager!: AdaptiveParameterManager;
    private calibrationService!: ModelCalibrationService;
    private hotUpdateService!: HotUpdateService;
    private adaptiveStrategy!: AdaptiveStrategyService;
    
    private config: IntegrationTestConfig;
    private benchmarkHistory: BenchmarkResult[] = [];
    private systemHealth: SystemHealth;
    private isInitialized = false;
    private healthCheckTimer?: NodeJS.Timeout;
    private benchmarkTimer?: NodeJS.Timeout;
    
    private startTime = Date.now();
    private errorCount = 0;
    private totalRequests = 0;
    private totalResponseTime = 0;

    constructor(integrationConfig?: Partial<IntegrationTestConfig>) {
        super();
        
        this.config = {
            enableRealTimeTest: true,
            enableBacktest: true,
            backtestPeriod: 30, // 30天
            benchmarkInterval: 60 * 60 * 1000, // 1小时
            healthCheckInterval: 5 * 60 * 1000, // 5分钟
            performanceThresholds: {
                minSharpeRatio: 1.0,
                maxDrawdown: 0.15,
                minWinRate: 0.55,
                maxCalibrationError: 0.1
            },
            ...integrationConfig
        };
        
        this.systemHealth = this.initializeSystemHealth();
        this.initializeComponents().catch(error => {
            console.error('[Integration] 组件初始化失败:', error);
            this.emit(IntegrationEvent.ERROR, { error, context: 'constructor' });
        });
    }

    /**
     * 初始化系统健康状态
     */
    private initializeSystemHealth(): SystemHealth {
        return {
            overall: 'HEALTHY',
            components: {
                marketStateAnalyzer: 'HEALTHY',
                parameterManager: 'HEALTHY',
                calibrationService: 'HEALTHY',
                hotUpdateService: 'HEALTHY',
                adaptiveStrategy: 'HEALTHY'
            },
            metrics: {
                uptime: 0,
                memoryUsage: 0,
                cpuUsage: 0,
                errorRate: 0,
                responseTime: 0
            },
            lastCheck: Date.now()
        };
    }

    /**
     * 初始化组件
     */
    private async initializeComponents(): Promise<void> {
        try {
            console.log('[Integration] 初始化自适应系统组件...');
            
            // 1. 初始化市场状态分析器
            this.marketStateAnalyzer = new MarketStateAnalyzer();
            
            // 2. 初始化参数管理器
            this.parameterManager = new AdaptiveParameterManager();
            
            // 3. 初始化模型校准服务
            this.calibrationService = new ModelCalibrationService();
            
            // 4. 初始化热更新服务
            this.hotUpdateService = new HotUpdateService(
                this.calibrationService,
                this.parameterManager,
                this.marketStateAnalyzer
            );
            
            // 5. 初始化自适应策略服务
            this.adaptiveStrategy = new AdaptiveStrategyService(
                this.marketStateAnalyzer,
                this.parameterManager,
                this.calibrationService,
                this.hotUpdateService
            );
            
            // 6. 设置事件监听
            this.setupEventListeners();
            
            // 7. 启动定时任务
            this.startTimers();
            
            this.isInitialized = true;
            this.emit(IntegrationEvent.SYSTEM_INITIALIZED);
            
            console.log('[Integration] 自适应系统初始化完成');
            
        } catch (error) {
            console.error('[Integration] 系统初始化失败:', error);
            this.emit(IntegrationEvent.ERROR, { error, context: 'initialization' });
            throw error;
        }
    }

    /**
     * 设置事件监听
     */
    private setupEventListeners(): void {
        // 监听各组件的错误事件
        this.adaptiveStrategy.on('error', (error) => {
            this.handleComponentError('adaptiveStrategy', error);
        });
        
        this.hotUpdateService.on('error', (error) => {
            this.handleComponentError('hotUpdateService', error);
        });
        
        // 监听性能更新事件
        this.adaptiveStrategy.on('performance_updated', (metrics: PerformanceMetrics) => {
            this.handlePerformanceUpdate(metrics);
        });
        
        // 监听参数调整事件
        this.adaptiveStrategy.on('parameters_adjusted', (adjustment) => {
            console.log('[Integration] 参数已调整:', adjustment.adjustmentReason);
        });
    }

    /**
     * 处理组件错误
     */
    private handleComponentError(component: string, error: any): void {
        this.errorCount++;
        this.systemHealth.components[component as keyof typeof this.systemHealth.components] = 'CRITICAL';
        this.updateOverallHealth();
        
        console.error(`[Integration] 组件错误 ${component}:`, error);
        this.emit(IntegrationEvent.ERROR, { component, error });
    }

    /**
     * 处理性能更新
     */
    private handlePerformanceUpdate(metrics: PerformanceMetrics): void {
        this.emit(IntegrationEvent.PERFORMANCE_EVALUATED, metrics);
        
        // 检查性能阈值
        this.checkPerformanceThresholds(metrics);
    }

    /**
     * 检查性能阈值
     */
    private checkPerformanceThresholds(metrics: PerformanceMetrics): void {
        const thresholds = this.config.performanceThresholds;
        const warnings: string[] = [];
        
        if (metrics.sharpeRatio < thresholds.minSharpeRatio) {
            warnings.push(`Sharpe比率过低: ${metrics.sharpeRatio.toFixed(2)} < ${thresholds.minSharpeRatio}`);
        }
        
        if (metrics.maxDrawdown > thresholds.maxDrawdown) {
            warnings.push(`最大回撤过高: ${(metrics.maxDrawdown * 100).toFixed(1)}% > ${(thresholds.maxDrawdown * 100).toFixed(1)}%`);
        }
        
        if (metrics.winRate < thresholds.minWinRate) {
            warnings.push(`胜率过低: ${(metrics.winRate * 100).toFixed(1)}% < ${(thresholds.minWinRate * 100).toFixed(1)}%`);
        }
        
        if (warnings.length > 0) {
            this.emit(IntegrationEvent.WARNING, { 
                type: 'performance_threshold', 
                warnings,
                metrics 
            });
        }
    }

    /**
     * 启动定时器
     */
    private startTimers(): void {
        // 健康检查定时器
        this.healthCheckTimer = setInterval(() => {
            this.performHealthCheck();
        }, this.config.healthCheckInterval);
        
        // 基准测试定时器
        if (this.config.enableRealTimeTest) {
            this.benchmarkTimer = setInterval(() => {
                this.runBenchmarkTest();
            }, this.config.benchmarkInterval);
        }
    }

    /**
     * 执行健康检查
     */
    private async performHealthCheck(): Promise<void> {
        try {
            const startTime = Date.now();
            
            // 检查各组件状态
            await this.checkComponentHealth();
            
            // 更新系统指标
            this.updateSystemMetrics();
            
            // 更新整体健康状态
            this.updateOverallHealth();
            
            this.systemHealth.lastCheck = Date.now();
            
            const checkDuration = Date.now() - startTime;
            console.log(`[Integration] 健康检查完成，耗时: ${checkDuration}ms`);
            
        } catch (error) {
            console.error('[Integration] 健康检查失败:', error);
            this.systemHealth.overall = 'CRITICAL';
        }
    }

    /**
     * 检查组件健康状态
     */
    private async checkComponentHealth(): Promise<void> {
        // 检查市场状态分析器
        try {
            const testData = new Map<TimeFrame, KlineData[]>();
            testData.set(TimeFrame.H1, this.generateTestKlineData(100));
            await this.marketStateAnalyzer.analyzeMarketState(testData, 100, 1000000);
            this.systemHealth.components.marketStateAnalyzer = 'HEALTHY';
        } catch (error) {
            this.systemHealth.components.marketStateAnalyzer = 'CRITICAL';
        }
        
        // 检查参数管理器
        try {
            this.parameterManager.getCurrentParameters();
            this.systemHealth.components.parameterManager = 'HEALTHY';
        } catch (error) {
            this.systemHealth.components.parameterManager = 'CRITICAL';
        }
        
        // 检查校准服务
        try {
            this.calibrationService.getStatus();
            this.systemHealth.components.calibrationService = 'HEALTHY';
        } catch (error) {
            this.systemHealth.components.calibrationService = 'CRITICAL';
        }
        
        // 检查热更新服务
        try {
            this.hotUpdateService.getServiceStatus();
            this.systemHealth.components.hotUpdateService = 'HEALTHY';
        } catch (error) {
            this.systemHealth.components.hotUpdateService = 'CRITICAL';
        }
        
        // 检查自适应策略
        try {
            this.adaptiveStrategy.getServiceStatus();
            this.systemHealth.components.adaptiveStrategy = 'HEALTHY';
        } catch (error) {
            this.systemHealth.components.adaptiveStrategy = 'CRITICAL';
        }
    }

    /**
     * 更新系统指标
     */
    private updateSystemMetrics(): void {
        const now = Date.now();
        const uptime = now - this.startTime;
        
        // 更新运行时间
        this.systemHealth.metrics.uptime = uptime;
        
        // 更新内存使用
        const memUsage = process.memoryUsage();
        this.systemHealth.metrics.memoryUsage = memUsage.heapUsed / memUsage.heapTotal;
        
        // 更新错误率
        this.systemHealth.metrics.errorRate = this.totalRequests > 0 ? 
            this.errorCount / this.totalRequests : 0;
        
        // 更新平均响应时间
        this.systemHealth.metrics.responseTime = this.totalRequests > 0 ? 
            this.totalResponseTime / this.totalRequests : 0;
    }

    /**
     * 更新整体健康状态
     */
    private updateOverallHealth(): void {
        const components = Object.values(this.systemHealth.components);
        
        if (components.some(status => status === 'CRITICAL')) {
            this.systemHealth.overall = 'CRITICAL';
        } else if (components.some(status => status === 'WARNING')) {
            this.systemHealth.overall = 'WARNING';
        } else {
            this.systemHealth.overall = 'HEALTHY';
        }
    }

    /**
     * 运行基准测试
     */
    private async runBenchmarkTest(): Promise<BenchmarkResult> {
        const startTime = Date.now();
        
        try {
            console.log('[Integration] 开始基准测试...');
            
            // 生成测试数据
            const testData = this.generateTestData();
            
            // 运行测试
            const result = await this.executeBenchmarkTest(testData);
            
            // 记录结果
            this.benchmarkHistory.push(result);
            if (this.benchmarkHistory.length > 100) {
                this.benchmarkHistory.shift();
            }
            
            this.emit(IntegrationEvent.BENCHMARK_COMPLETED, result);
            
            console.log(`[Integration] 基准测试完成: Sharpe=${result.sharpeRatio.toFixed(2)}, 胜率=${(result.winRate * 100).toFixed(1)}%`);
            
            return result;
            
        } catch (error) {
            console.error('[Integration] 基准测试失败:', error);
            throw error;
        }
    }

    /**
     * 执行基准测试
     */
    private async executeBenchmarkTest(testData: any): Promise<BenchmarkResult> {
        const startTime = Date.now();
        
        // 模拟交易执行
        const trades: any[] = [];
        let totalReturn = 0;
        let maxDrawdown = 0;
        let currentDrawdown = 0;
        let winCount = 0;
        
        // 生成测试信号
        for (let i = 0; i < testData.length; i++) {
            const klineDataMap = new Map<TimeFrame, KlineData[]>();
            klineDataMap.set(TimeFrame.H1, testData.slice(Math.max(0, i - 100), i + 1));
            
            if (klineDataMap.get(TimeFrame.H1)!.length < 50) continue;
            
            try {
                const signal = await this.adaptiveStrategy.generateStrategySignal(
                    klineDataMap,
                    testData[i].close,
                    1000000
                );
                
                if (signal.action !== 'HOLD') {
                    // 模拟交易结果
                    const tradeReturn = this.simulateTradeReturn(signal, testData, i);
                    trades.push({ signal, return: tradeReturn, index: i });
                    
                    totalReturn += tradeReturn;
                    if (tradeReturn > 0) winCount++;
                    
                    // 计算回撤
                    if (tradeReturn < 0) {
                        currentDrawdown += Math.abs(tradeReturn);
                        maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
                    } else {
                        currentDrawdown = Math.max(0, currentDrawdown - tradeReturn);
                    }
                }
            } catch (error) {
                console.warn('[Integration] 信号生成失败:', error);
            }
        }
        
        // 计算性能指标
        const winRate = trades.length > 0 ? winCount / trades.length : 0;
        const avgReturn = trades.length > 0 ? totalReturn / trades.length : 0;
        const returns = trades.map(t => t.return);
        const volatility = this.calculateVolatility(returns);
        const sharpeRatio = volatility > 0 ? (avgReturn / volatility) : 0;
        const calmarRatio = maxDrawdown > 0 ? (totalReturn / maxDrawdown) : 0;
        
        // 计算校准性能
        const calibrationPerformance = this.calibrationService.getCalibrationPerformance();
        const avgBrierScore = Array.from(calibrationPerformance.values())
            .reduce((sum, perf) => sum + perf.brierScore, 0) / calibrationPerformance.size || 0;
        const avgCalibrationError = Array.from(calibrationPerformance.values())
            .reduce((sum, perf) => sum + perf.calibrationError, 0) / calibrationPerformance.size || 0;
        
        return {
            testName: `benchmark_${Date.now()}`,
            duration: Date.now() - startTime,
            sharpeRatio,
            maxDrawdown,
            winRate,
            totalTrades: trades.length,
            avgReturn,
            volatility,
            calmarRatio,
            sortinoRatio: this.calculateSortinoRatio(returns),
            profitFactor: this.calculateProfitFactor(returns),
            brierScore: avgBrierScore,
            calibrationError: avgCalibrationError,
            marketStateAccuracy: 0.75, // 简化计算
            parameterStability: this.calculateParameterStability(),
            timestamp: Date.now()
        };
    }

    /**
     * 模拟交易收益
     */
    private simulateTradeReturn(signal: StrategySignal, testData: any[], index: number): number {
        const entryPrice = testData[index].close;
        const holdingPeriod = Math.min(24, Math.floor(signal.holdingDuration / (60 * 60 * 1000))); // 小时
        const exitIndex = Math.min(testData.length - 1, index + holdingPeriod);
        const exitPrice = testData[exitIndex].close;
        
        const priceChange = (exitPrice - entryPrice) / entryPrice;
        const direction = signal.action === 'BUY' ? 1 : -1;
        
        // 考虑杠杆和手续费
        const leveragedReturn = priceChange * direction * signal.leverage;
        const fees = 0.001 * 2; // 双边手续费
        
        return leveragedReturn - fees;
    }

    /**
     * 计算波动率
     */
    private calculateVolatility(returns: number[]): number {
        if (returns.length < 2) return 0;
        
        const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
        
        return Math.sqrt(variance);
    }

    /**
     * 计算Sortino比率
     */
    private calculateSortinoRatio(returns: number[]): number {
        if (returns.length === 0) return 0;
        
        const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const negativeReturns = returns.filter(r => r < 0);
        
        if (negativeReturns.length === 0) return avgReturn > 0 ? 10 : 0;
        
        const downwardDeviation = Math.sqrt(
            negativeReturns.reduce((sum, r) => sum + r * r, 0) / negativeReturns.length
        );
        
        return downwardDeviation > 0 ? avgReturn / downwardDeviation : 0;
    }

    /**
     * 计算盈亏比
     */
    private calculateProfitFactor(returns: number[]): number {
        const profits = returns.filter(r => r > 0).reduce((sum, r) => sum + r, 0);
        const losses = Math.abs(returns.filter(r => r < 0).reduce((sum, r) => sum + r, 0));
        
        return losses > 0 ? profits / losses : profits > 0 ? 10 : 1;
    }

    /**
     * 计算参数稳定性
     */
    private calculateParameterStability(): number {
        const stats = this.parameterManager.getParameterStats();
        return stats.parameterStability;
    }

    /**
     * 生成测试数据
     */
    private generateTestData(): KlineData[] {
        return this.generateTestKlineData(1000);
    }

    /**
     * 生成测试K线数据
     */
    private generateTestKlineData(count: number): KlineData[] {
        const data: KlineData[] = [];
        let price = 100;
        let timestamp = Date.now() - count * 60 * 60 * 1000; // 1小时间隔
        
        for (let i = 0; i < count; i++) {
            const change = (Math.random() - 0.5) * 0.02; // ±1%随机变化
            const open = price;
            const close = price * (1 + change);
            const high = Math.max(open, close) * (1 + Math.random() * 0.005);
            const low = Math.min(open, close) * (1 - Math.random() * 0.005);
            const volume = 1000000 + Math.random() * 500000;
            
            data.push({
                timestamp,
                open,
                high,
                low,
                close,
                volume
            });
            
            price = close;
            timestamp += 60 * 60 * 1000; // 1小时
        }
        
        return data;
    }

    /**
     * 记录请求指标
     */
    recordRequest(responseTime: number, hasError: boolean = false): void {
        this.totalRequests++;
        this.totalResponseTime += responseTime;
        
        if (hasError) {
            this.errorCount++;
        }
    }

    /**
     * 获取系统健康状态
     */
    getSystemHealth(): SystemHealth {
        return { ...this.systemHealth };
    }

    /**
     * 获取基准测试历史
     */
    getBenchmarkHistory(limit: number = 20): BenchmarkResult[] {
        return this.benchmarkHistory.slice(-limit);
    }

    /**
     * 获取最新基准测试结果
     */
    getLatestBenchmark(): BenchmarkResult | null {
        return this.benchmarkHistory.length > 0 ? 
               this.benchmarkHistory[this.benchmarkHistory.length - 1] : null;
    }

    /**
     * 手动运行基准测试
     */
    async runManualBenchmark(): Promise<BenchmarkResult> {
        return await this.runBenchmarkTest();
    }

    /**
     * 获取系统统计信息
     */
    getSystemStats(): {
        uptime: number;
        totalRequests: number;
        errorRate: number;
        avgResponseTime: number;
        componentsHealth: SystemHealth['components'];
        benchmarkCount: number;
        lastBenchmarkScore: number;
    } {
        const latestBenchmark = this.getLatestBenchmark();
        
        return {
            uptime: Date.now() - this.startTime,
            totalRequests: this.totalRequests,
            errorRate: this.systemHealth.metrics.errorRate,
            avgResponseTime: this.systemHealth.metrics.responseTime,
            componentsHealth: this.systemHealth.components,
            benchmarkCount: this.benchmarkHistory.length,
            lastBenchmarkScore: latestBenchmark ? latestBenchmark.sharpeRatio : 0
        };
    }

    /**
     * 停止集成系统
     */
    stop(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        
        if (this.benchmarkTimer) {
            clearInterval(this.benchmarkTimer);
        }
        
        // 停止各组件
        this.adaptiveStrategy?.stop();
        this.hotUpdateService?.stop();
        this.calibrationService?.stop();
        
        console.log('[Integration] 自适应系统集成已停止');
    }
}

export default AdaptiveSystemIntegration;