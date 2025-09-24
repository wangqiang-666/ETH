import { EventEmitter } from 'events';
import { MarketStateAnalyzer, MarketStateResult, MarketState, TimeFrame } from '../analyzers/market-state-analyzer.js';
import { KlineData } from '../indicators/technical-indicators.js';
import { AdaptiveParameterManager, AdaptiveParameters } from '../config/adaptive-parameters.js';
import { ModelCalibrationService, PredictionResult, CalibrationMethod } from '../ml/model-calibration-service.js';
import { HotUpdateService, StrategyAllocation } from './hot-update-service.js';
import { config } from '../config.js';

/**
 * 自适应调整事件
 */
export enum AdaptiveEvent {
    PARAMETERS_ADJUSTED = 'parameters_adjusted',
    MARKET_STATE_CHANGED = 'market_state_changed',
    STRATEGY_REBALANCED = 'strategy_rebalanced',
    PERFORMANCE_UPDATED = 'performance_updated',
    ERROR = 'error'
}

/**
 * 策略调整记录
 */
export interface StrategyAdjustmentRecord {
    timestamp: number;
    marketState: MarketState;
    previousParameters: AdaptiveParameters;
    newParameters: AdaptiveParameters;
    adjustmentReason: string;
    confidence: number;
    expectedImprovement: number;
}

/**
 * 性能指标
 */
export interface PerformanceMetrics {
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    avgReturn: number;
    volatility: number;
    calmarRatio: number;
    sortinoRatio: number;
    totalTrades: number;
    profitFactor: number;
}

/**
 * 策略信号
 */
export interface StrategySignal {
    action: 'BUY' | 'SELL' | 'HOLD';
    strength: number;           // 信号强度 0-1
    confidence: number;         // 置信度 0-1
    leverage: number;           // 建议杠杆
    stopLoss: number;          // 止损价格
    takeProfit: number;        // 止盈价格
    holdingDuration: number;   // 建议持仓时长(ms)
    strategyId: string;        // 策略ID
    marketState: MarketState;  // 当前市场状态
    timestamp: number;
}

/**
 * 自适应策略配置
 */
export interface AdaptiveStrategyConfig {
    enableAutoAdjustment: boolean;
    adjustmentInterval: number;        // 调整间隔(ms)
    minConfidenceThreshold: number;    // 最小置信度阈值
    maxAdjustmentFrequency: number;    // 最大调整频率(次/小时)
    performanceWindowSize: number;     // 性能评估窗口大小
    enableMarketStateFilter: boolean;  // 启用市场状态过滤
    enableRiskAdjustment: boolean;     // 启用风险调整
}

/**
 * 自适应策略服务
 */
export class AdaptiveStrategyService extends EventEmitter {
    private marketStateAnalyzer: MarketStateAnalyzer;
    private parameterManager: AdaptiveParameterManager;
    private calibrationService: ModelCalibrationService;
    private hotUpdateService: HotUpdateService;
    private config: AdaptiveStrategyConfig;
    
    private currentMarketState?: MarketStateResult;
    private currentParameters: AdaptiveParameters;
    private adjustmentHistory: StrategyAdjustmentRecord[] = [];
    private performanceHistory: PerformanceMetrics[] = [];
    private lastAdjustmentTime = 0;
    private adjustmentTimer?: NodeJS.Timeout;
    private isAdjusting = false;
    
    private maxHistoryLength = 200;

    constructor(
        marketStateAnalyzer: MarketStateAnalyzer,
        parameterManager: AdaptiveParameterManager,
        calibrationService: ModelCalibrationService,
        hotUpdateService: HotUpdateService,
        adaptiveConfig?: Partial<AdaptiveStrategyConfig>
    ) {
        super();
        
        this.marketStateAnalyzer = marketStateAnalyzer;
        this.parameterManager = parameterManager;
        this.calibrationService = calibrationService;
        this.hotUpdateService = hotUpdateService;
        
        this.config = {
            enableAutoAdjustment: true,
            adjustmentInterval: 15 * 60 * 1000, // 15分钟
            minConfidenceThreshold: 0.6,
            maxAdjustmentFrequency: 4, // 每小时最多4次
            performanceWindowSize: 50,
            enableMarketStateFilter: true,
            enableRiskAdjustment: true,
            ...adaptiveConfig
        };
        
        this.currentParameters = this.parameterManager.getCurrentParameters();
        this.initializeService();
    }

    /**
     * 初始化服务
     */
    private initializeService(): void {
        // 监听热更新服务事件
        this.hotUpdateService.on('parameters_updated', (update) => {
            this.handleParameterUpdate(update);
        });
        
        this.hotUpdateService.on('strategy_updated', (update) => {
            this.handleStrategyUpdate(update);
        });
        
        // 启动自动调整定时器
        if (this.config.enableAutoAdjustment) {
            this.startAutoAdjustment();
        }
        
        console.log('[AdaptiveStrategy] 自适应策略服务已启动');
    }

    /**
     * 分析市场并生成策略信号
     */
    async generateStrategySignal(
        klineDataMap: Map<TimeFrame, KlineData[]>,
        currentPrice: number,
        volume24h: number,
        spread?: number
    ): Promise<StrategySignal> {
        try {
            // 1. 分析市场状态
            const marketState = await this.marketStateAnalyzer.analyzeMarketState(
                klineDataMap, currentPrice, volume24h, spread
            );
            
            this.currentMarketState = marketState;
            
            // 2. 检查是否需要调整参数
            if (this.shouldAdjustParameters(marketState)) {
                await this.adjustParameters(marketState);
            }
            
            // 3. 获取当前参数
            const parameters = this.parameterManager.getCurrentParameters();
            
            // 4. 生成基础信号
            const baseSignal = await this.generateBaseSignal(marketState, parameters);
            
            // 5. 应用市场状态过滤
            const filteredSignal = this.applyMarketStateFilter(baseSignal, marketState);
            
            // 6. 应用风险调整
            const adjustedSignal = this.applyRiskAdjustment(filteredSignal, marketState);
            
            // 7. 获取校准后的置信度
            const calibratedResult = await this.getCalibratedConfidence(
                adjustedSignal, marketState.primaryState
            );
            
            // 8. 构建最终信号
            const finalSignal: StrategySignal = {
                ...adjustedSignal,
                confidence: calibratedResult.calibratedProbability,
                marketState: marketState.primaryState,
                timestamp: Date.now()
            };
            
            // 9. 记录信号用于性能评估
            this.recordSignalForEvaluation(finalSignal, marketState);
            
            return finalSignal;
            
        } catch (error) {
            console.error('[AdaptiveStrategy] 生成策略信号失败:', error);
            this.emit(AdaptiveEvent.ERROR, { error, context: 'generateStrategySignal' });
            
            // 返回保守的默认信号
            return this.getDefaultSignal();
        }
    }

    /**
     * 生成基础信号
     */
    private async generateBaseSignal(
        marketState: MarketStateResult,
        parameters: AdaptiveParameters
    ): Promise<Omit<StrategySignal, 'marketState' | 'timestamp'>> {
        const { primaryState, confidence, adxValue, volatilityLevel } = marketState;
        
        // 基于市场状态确定基础行动
        let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let strength = 0.5;
        
        switch (primaryState) {
            case MarketState.TRENDING_UP:
                action = 'BUY';
                strength = Math.min(0.9, 0.6 + (adxValue - 25) / 50);
                break;
            case MarketState.TRENDING_DOWN:
                action = 'SELL';
                strength = Math.min(0.9, 0.6 + (adxValue - 25) / 50);
                break;
            case MarketState.BREAKOUT:
                action = 'BUY'; // 假设突破向上
                strength = 0.8;
                break;
            case MarketState.REVERSAL:
                // 需要更多信息确定方向，暂时保持观望
                action = 'HOLD';
                strength = 0.3;
                break;
            default:
                action = 'HOLD';
                strength = 0.4;
        }
        
        // 计算杠杆
        const baseLeverage = parameters.leverageFactors.baseLeverage;
        const volatilityAdjustment = parameters.leverageFactors.volatilityAdjustment;
        const confidenceMultiplier = parameters.leverageFactors.confidenceMultiplier;
        const marketStateMultiplier = parameters.leverageFactors.marketStateMultiplier;
        
        const leverage = Math.min(
            parameters.leverageFactors.maxLeverage,
            baseLeverage * volatilityAdjustment * confidenceMultiplier * marketStateMultiplier * confidence
        );
        
        // 计算止损止盈
        const currentPrice = 100; // 这里应该传入实际价格
        const stopLossPercent = parameters.riskParameters.stopLossPercent;
        const takeProfitPercent = parameters.riskParameters.takeProfitPercent;
        
        const stopLoss = action === 'BUY' ? 
            currentPrice * (1 - stopLossPercent) : 
            currentPrice * (1 + stopLossPercent);
            
        const takeProfit = action === 'BUY' ? 
            currentPrice * (1 + takeProfitPercent) : 
            currentPrice * (1 - takeProfitPercent);
        
        return {
            action,
            strength,
            confidence,
            leverage,
            stopLoss,
            takeProfit,
            holdingDuration: parameters.holdingDuration.targetHoldingTime,
            strategyId: this.selectBestStrategy()
        };
    }

    /**
     * 应用市场状态过滤
     */
    private applyMarketStateFilter(
        signal: Omit<StrategySignal, 'marketState' | 'timestamp'>,
        marketState: MarketStateResult
    ): Omit<StrategySignal, 'marketState' | 'timestamp'> {
        if (!this.config.enableMarketStateFilter) {
            return signal;
        }
        
        const filtered = { ...signal };
        
        // 在高波动性市场中降低信号强度
        if (marketState.volatilityLevel === 'EXTREME') {
            filtered.strength *= 0.7;
            filtered.confidence *= 0.8;
        }
        
        // 在低置信度市场状态中保守操作
        if (marketState.confidence < this.config.minConfidenceThreshold) {
            filtered.action = 'HOLD';
            filtered.strength *= 0.5;
        }
        
        // 多时间框架不一致时降低信号强度
        if (marketState.multiTimeFrameConsistency < 0.7) {
            filtered.strength *= 0.8;
            filtered.confidence *= 0.9;
        }
        
        return filtered;
    }

    /**
     * 应用风险调整
     */
    private applyRiskAdjustment(
        signal: Omit<StrategySignal, 'marketState' | 'timestamp'>,
        marketState: MarketStateResult
    ): Omit<StrategySignal, 'marketState' | 'timestamp'> {
        if (!this.config.enableRiskAdjustment) {
            return signal;
        }
        
        const adjusted = { ...signal };
        
        // 基于波动性调整杠杆
        const volatilityMultiplier = this.getVolatilityMultiplier(marketState.volatilityLevel);
        adjusted.leverage *= volatilityMultiplier;
        
        // 基于ADX调整止损止盈
        const adxAdjustment = Math.min(1.5, Math.max(0.7, marketState.adxValue / 30));
        const currentPrice = 100; // 应该传入实际价格
        
        if (signal.action === 'BUY') {
            adjusted.stopLoss = currentPrice * (1 - this.currentParameters.riskParameters.stopLossPercent * adxAdjustment);
            adjusted.takeProfit = currentPrice * (1 + this.currentParameters.riskParameters.takeProfitPercent * adxAdjustment);
        } else if (signal.action === 'SELL') {
            adjusted.stopLoss = currentPrice * (1 + this.currentParameters.riskParameters.stopLossPercent * adxAdjustment);
            adjusted.takeProfit = currentPrice * (1 - this.currentParameters.riskParameters.takeProfitPercent * adxAdjustment);
        }
        
        return adjusted;
    }

    /**
     * 获取波动性乘数
     */
    private getVolatilityMultiplier(volatilityLevel: string): number {
        switch (volatilityLevel) {
            case 'EXTREME': return 0.5;
            case 'HIGH': return 0.7;
            case 'MEDIUM': return 1.0;
            case 'LOW': return 1.3;
            default: return 1.0;
        }
    }

    /**
     * 获取校准后的置信度
     */
    private async getCalibratedConfidence(
        signal: Omit<StrategySignal, 'marketState' | 'timestamp'>,
        marketState: MarketState
    ): Promise<PredictionResult> {
        try {
            const strategyId = signal.strategyId;
            const rawConfidence = signal.confidence;
            
            return await this.calibrationService.calibratePrediction(
                strategyId,
                rawConfidence,
                CalibrationMethod.PLATT
            );
        } catch (error) {
            console.warn('[AdaptiveStrategy] 置信度校准失败:', error);
            return {
                rawScore: signal.confidence,
                calibratedProbability: signal.confidence,
                confidence: signal.confidence,
                timestamp: Date.now()
            };
        }
    }

    /**
     * 选择最佳策略
     */
    private selectBestStrategy(): string {
        const allocations = this.hotUpdateService.getStrategyAllocations();
        
        if (allocations.length === 0) {
            return 'default_strategy';
        }
        
        // 基于权重随机选择策略
        const random = Math.random();
        let cumulativeWeight = 0;
        
        for (const allocation of allocations) {
            cumulativeWeight += allocation.allocation;
            if (random <= cumulativeWeight) {
                return allocation.strategyId;
            }
        }
        
        return allocations[0].strategyId;
    }

    /**
     * 检查是否需要调整参数
     */
    private shouldAdjustParameters(marketState: MarketStateResult): boolean {
        if (!this.config.enableAutoAdjustment || this.isAdjusting) {
            return false;
        }
        
        const now = Date.now();
        const timeSinceLastAdjustment = now - this.lastAdjustmentTime;
        
        // 检查调整频率限制
        if (timeSinceLastAdjustment < this.config.adjustmentInterval) {
            return false;
        }
        
        // 检查市场状态变化
        const currentState = this.currentParameters.metadata.marketState;
        if (currentState !== marketState.primaryState) {
            return true;
        }
        
        // 检查置信度变化
        const confidenceChange = Math.abs(marketState.confidence - this.currentParameters.metadata.confidence);
        if (confidenceChange > 0.2) {
            return true;
        }
        
        // 检查性能表现
        if (this.shouldAdjustBasedOnPerformance()) {
            return true;
        }
        
        return false;
    }

    /**
     * 基于性能检查是否需要调整
     */
    private shouldAdjustBasedOnPerformance(): boolean {
        if (this.performanceHistory.length < 10) {
            return false;
        }
        
        const recentPerformance = this.performanceHistory.slice(-5);
        const avgSharpe = recentPerformance.reduce((sum, p) => sum + p.sharpeRatio, 0) / recentPerformance.length;
        const avgWinRate = recentPerformance.reduce((sum, p) => sum + p.winRate, 0) / recentPerformance.length;
        
        // 如果性能下降，考虑调整
        return avgSharpe < 1.0 || avgWinRate < 0.5;
    }

    /**
     * 调整参数
     */
    private async adjustParameters(marketState: MarketStateResult): Promise<void> {
        if (this.isAdjusting) return;
        
        this.isAdjusting = true;
        
        try {
            const previousParameters = { ...this.currentParameters };
            
            // 使用参数管理器调整参数
            const newParameters = this.parameterManager.adjustParameters(marketState);
            
            // 计算预期改进
            const expectedImprovement = this.calculateExpectedImprovement(
                previousParameters, newParameters, marketState
            );
            
            // 记录调整
            const adjustmentRecord: StrategyAdjustmentRecord = {
                timestamp: Date.now(),
                marketState: marketState.primaryState,
                previousParameters,
                newParameters,
                adjustmentReason: this.generateAdjustmentReason(marketState),
                confidence: marketState.confidence,
                expectedImprovement
            };
            
            this.recordAdjustment(adjustmentRecord);
            this.currentParameters = newParameters;
            this.lastAdjustmentTime = Date.now();
            
            // 触发事件
            this.emit(AdaptiveEvent.PARAMETERS_ADJUSTED, adjustmentRecord);
            
            console.log(`[AdaptiveStrategy] 参数已调整: ${marketState.primaryState}, 预期改进: ${expectedImprovement.toFixed(2)}%`);
            
        } catch (error) {
            console.error('[AdaptiveStrategy] 参数调整失败:', error);
            this.emit(AdaptiveEvent.ERROR, { error, context: 'adjustParameters' });
        } finally {
            this.isAdjusting = false;
        }
    }

    /**
     * 计算预期改进
     */
    private calculateExpectedImprovement(
        oldParams: AdaptiveParameters,
        newParams: AdaptiveParameters,
        marketState: MarketStateResult
    ): number {
        // 简化的改进计算
        const confidenceImprovement = marketState.confidence * 10;
        const consistencyImprovement = marketState.multiTimeFrameConsistency * 5;
        const adxImprovement = Math.min(5, marketState.adxValue / 10);
        
        return confidenceImprovement + consistencyImprovement + adxImprovement;
    }

    /**
     * 生成调整原因
     */
    private generateAdjustmentReason(marketState: MarketStateResult): string {
        const reasons: string[] = [];
        
        if (marketState.primaryState !== this.currentParameters.metadata.marketState) {
            reasons.push(`市场状态变化: ${this.currentParameters.metadata.marketState} -> ${marketState.primaryState}`);
        }
        
        if (marketState.confidence > 0.8) {
            reasons.push('高置信度市场状态');
        } else if (marketState.confidence < 0.4) {
            reasons.push('低置信度市场状态');
        }
        
        if (marketState.volatilityLevel === 'EXTREME') {
            reasons.push('极端波动性');
        }
        
        if (marketState.multiTimeFrameConsistency < 0.6) {
            reasons.push('多时间框架不一致');
        }
        
        return reasons.length > 0 ? reasons.join('; ') : '定期调整';
    }

    /**
     * 记录调整历史
     */
    private recordAdjustment(record: StrategyAdjustmentRecord): void {
        this.adjustmentHistory.push(record);
        
        if (this.adjustmentHistory.length > this.maxHistoryLength) {
            this.adjustmentHistory.shift();
        }
    }

    /**
     * 记录信号用于评估
     */
    private recordSignalForEvaluation(signal: StrategySignal, marketState: MarketStateResult): void {
        // 这里可以记录信号用于后续的性能评估
        // 实际实现中需要跟踪信号的执行结果
    }

    /**
     * 获取默认信号
     */
    private getDefaultSignal(): StrategySignal {
        return {
            action: 'HOLD',
            strength: 0.3,
            confidence: 0.5,
            leverage: 1,
            stopLoss: 0,
            takeProfit: 0,
            holdingDuration: 60 * 60 * 1000, // 1小时
            strategyId: 'default_strategy',
            marketState: MarketState.SIDEWAYS,
            timestamp: Date.now()
        };
    }

    /**
     * 启动自动调整
     */
    private startAutoAdjustment(): void {
        this.adjustmentTimer = setInterval(() => {
            if (this.currentMarketState) {
                this.adjustParameters(this.currentMarketState);
            }
        }, this.config.adjustmentInterval);
    }

    /**
     * 处理参数更新事件
     */
    private handleParameterUpdate(update: any): void {
        this.currentParameters = this.parameterManager.getCurrentParameters();
        console.log('[AdaptiveStrategy] 参数已通过热更新更新');
    }

    /**
     * 处理策略更新事件
     */
    private handleStrategyUpdate(update: any): void {
        console.log('[AdaptiveStrategy] 策略配置已更新');
    }

    /**
     * 更新性能指标
     */
    updatePerformance(metrics: PerformanceMetrics): void {
        this.performanceHistory.push(metrics);
        
        if (this.performanceHistory.length > this.config.performanceWindowSize) {
            this.performanceHistory.shift();
        }
        
        this.emit(AdaptiveEvent.PERFORMANCE_UPDATED, metrics);
    }

    /**
     * 获取调整历史
     */
    getAdjustmentHistory(limit: number = 20): StrategyAdjustmentRecord[] {
        return this.adjustmentHistory.slice(-limit);
    }

    /**
     * 获取性能历史
     */
    getPerformanceHistory(limit: number = 50): PerformanceMetrics[] {
        return this.performanceHistory.slice(-limit);
    }

    /**
     * 获取当前参数
     */
    getCurrentParameters(): AdaptiveParameters {
        return { ...this.currentParameters };
    }

    /**
     * 获取当前市场状态
     */
    getCurrentMarketState(): MarketStateResult | undefined {
        return this.currentMarketState;
    }

    /**
     * 手动触发参数调整
     */
    async forceParameterAdjustment(): Promise<void> {
        if (this.currentMarketState) {
            await this.adjustParameters(this.currentMarketState);
        }
    }

    /**
     * 更新配置
     */
    updateConfig(newConfig: Partial<AdaptiveStrategyConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        // 重启自动调整定时器
        if (this.adjustmentTimer) {
            clearInterval(this.adjustmentTimer);
        }
        
        if (this.config.enableAutoAdjustment) {
            this.startAutoAdjustment();
        }
    }

    /**
     * 获取服务状态
     */
    getServiceStatus(): {
        isActive: boolean;
        totalAdjustments: number;
        lastAdjustment: number;
        currentMarketState?: MarketState;
        avgPerformance: Partial<PerformanceMetrics>;
    } {
        const avgPerformance: Partial<PerformanceMetrics> = {};
        
        if (this.performanceHistory.length > 0) {
            const recent = this.performanceHistory.slice(-10);
            avgPerformance.sharpeRatio = recent.reduce((sum, p) => sum + p.sharpeRatio, 0) / recent.length;
            avgPerformance.winRate = recent.reduce((sum, p) => sum + p.winRate, 0) / recent.length;
            avgPerformance.maxDrawdown = Math.max(...recent.map(p => p.maxDrawdown));
        }
        
        return {
            isActive: this.config.enableAutoAdjustment,
            totalAdjustments: this.adjustmentHistory.length,
            lastAdjustment: this.lastAdjustmentTime,
            currentMarketState: this.currentMarketState?.primaryState,
            avgPerformance
        };
    }

    /**
     * 停止服务
     */
    stop(): void {
        if (this.adjustmentTimer) {
            clearInterval(this.adjustmentTimer);
        }
        
        console.log('[AdaptiveStrategy] 自适应策略服务已停止');
    }
}

export default AdaptiveStrategyService;