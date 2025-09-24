import { MarketState, MarketStateResult } from '../analyzers/market-state-analyzer.js';
import { config } from '../config.js';

/**
 * 自适应参数类型
 */
export interface AdaptiveParameters {
    // 驱动阈值参数
    drivingThresholds: {
        signalThreshold: number;        // 信号阈值
        evThreshold: number;            // 期望值阈值
        confidenceThreshold: number;    // 置信度阈值
        adxMinThreshold: number;        // ADX最小阈值
        volumeRatioMin: number;         // 成交量比率最小值
    };
    
    // 杠杆系数参数
    leverageFactors: {
        baseLeverage: number;           // 基础杠杆
        maxLeverage: number;            // 最大杠杆
        volatilityAdjustment: number;   // 波动性调整系数
        confidenceMultiplier: number;   // 置信度乘数
        marketStateMultiplier: number;  // 市场状态乘数
    };
    
    // 冷却周期参数
    cooldownPeriods: {
        signalCooldown: number;         // 信号冷却时间(ms)
        oppositeCooldown: number;       // 反向冷却时间(ms)
        sameDirCooldown: number;        // 同向冷却时间(ms)
        volatilityCooldown: number;     // 波动性冷却时间(ms)
    };
    
    // 持仓时长参数
    holdingDuration: {
        minHoldingTime: number;         // 最小持仓时间(ms)
        maxHoldingTime: number;         // 最大持仓时间(ms)
        targetHoldingTime: number;      // 目标持仓时间(ms)
        autoTimeoutEnabled: boolean;    // 自动超时启用
        timeoutMultiplier: number;      // 超时乘数
    };
    
    // 风险管理参数
    riskParameters: {
        stopLossPercent: number;        // 止损百分比
        takeProfitPercent: number;      // 止盈百分比
        maxRiskPerTrade: number;        // 每笔交易最大风险
        positionSizing: number;         // 仓位大小
        maxDrawdown: number;            // 最大回撤
    };
    
    // 元数据
    metadata: {
        marketState: MarketState;       // 当前市场状态
        confidence: number;             // 参数置信度
        lastUpdated: number;            // 最后更新时间
        version: string;                // 参数版本
        source: 'MANUAL' | 'AUTO' | 'ML'; // 参数来源
    };
}

/**
 * 市场状态参数映射
 */
export interface MarketStateParameterMap {
    [MarketState.TRENDING_UP]: DeepPartial<AdaptiveParameters>;
    [MarketState.TRENDING_DOWN]: DeepPartial<AdaptiveParameters>;
    [MarketState.SIDEWAYS]: DeepPartial<AdaptiveParameters>;
    [MarketState.HIGH_VOLATILITY]: DeepPartial<AdaptiveParameters>;
    [MarketState.LOW_VOLATILITY]: DeepPartial<AdaptiveParameters>;
    [MarketState.BREAKOUT]: DeepPartial<AdaptiveParameters>;
    [MarketState.REVERSAL]: DeepPartial<AdaptiveParameters>;
}

/**
 * 深度可选类型
 */
type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * 参数调整规则
 */
export interface ParameterAdjustmentRule {
    condition: (marketState: MarketStateResult, currentParams: AdaptiveParameters) => boolean;
    adjustment: (currentParams: AdaptiveParameters) => DeepPartial<AdaptiveParameters>;
    priority: number;
    description: string;
}

/**
 * 自适应参数管理器
 */
export class AdaptiveParameterManager {
    private currentParameters: AdaptiveParameters;
    private parameterHistory: Array<{ timestamp: number; parameters: AdaptiveParameters }> = [];
    private adjustmentRules: ParameterAdjustmentRule[] = [];
    private marketStateParameterMap: MarketStateParameterMap;
    private maxHistoryLength = 100;

    constructor() {
        this.currentParameters = this.getDefaultParameters();
        this.marketStateParameterMap = this.initializeMarketStateParameterMap();
        this.initializeAdjustmentRules();
    }

    /**
     * 获取默认参数
     */
    private getDefaultParameters(): AdaptiveParameters {
        return {
            drivingThresholds: {
                signalThreshold: config.strategy.signalThreshold,
                evThreshold: config.strategy.evThreshold,
                confidenceThreshold: config.ml.local.confidenceThreshold,
                adxMinThreshold: config.strategy.gating.adx.min,
                volumeRatioMin: config.strategy.gating.volume.volumeRatioMin
            },
            leverageFactors: {
                baseLeverage: config.trading.defaultLeverage,
                maxLeverage: config.trading.maxLeverage,
                volatilityAdjustment: 1.0,
                confidenceMultiplier: 1.0,
                marketStateMultiplier: 1.0
            },
            cooldownPeriods: {
                signalCooldown: config.strategy.signalCooldownMs,
                oppositeCooldown: config.strategy.oppositeCooldownMs,
                sameDirCooldown: config.strategy.signalCooldownMs * 0.5,
                volatilityCooldown: config.strategy.signalCooldownMs * 0.3
            },
            holdingDuration: {
                minHoldingTime: 5 * 60 * 1000,      // 5分钟
                maxHoldingTime: 24 * 60 * 60 * 1000, // 24小时
                targetHoldingTime: 2 * 60 * 60 * 1000, // 2小时
                autoTimeoutEnabled: true,
                timeoutMultiplier: 1.5
            },
            riskParameters: {
                stopLossPercent: config.risk.stopLossPercent,
                takeProfitPercent: config.risk.takeProfitPercent,
                maxRiskPerTrade: config.risk.maxRiskPerTrade,
                positionSizing: 0.1, // 10%
                maxDrawdown: config.risk.maxDrawdown
            },
            metadata: {
                marketState: MarketState.SIDEWAYS,
                confidence: 0.5,
                lastUpdated: Date.now(),
                version: '1.0.0',
                source: 'MANUAL'
            }
        };
    }

    /**
     * 初始化市场状态参数映射
     */
    private initializeMarketStateParameterMap(): MarketStateParameterMap {
        return {
            [MarketState.TRENDING_UP]: {
                drivingThresholds: {
                    signalThreshold: 0.45,
                    evThreshold: 0.3,
                    confidenceThreshold: 0.55
                },
                leverageFactors: {
                    volatilityAdjustment: 1.2,
                    marketStateMultiplier: 1.3
                },
                cooldownPeriods: {
                    signalCooldown: config.strategy.signalCooldownMs * 0.8,
                    oppositeCooldown: config.strategy.oppositeCooldownMs * 1.5
                },
                holdingDuration: {
                    targetHoldingTime: 3 * 60 * 60 * 1000, // 3小时
                    timeoutMultiplier: 2.0
                },
                riskParameters: {
                    stopLossPercent: config.risk.stopLossPercent * 0.8,
                    takeProfitPercent: config.risk.takeProfitPercent * 1.2
                }
            },
            [MarketState.TRENDING_DOWN]: {
                drivingThresholds: {
                    signalThreshold: 0.45,
                    evThreshold: 0.3,
                    confidenceThreshold: 0.55
                },
                leverageFactors: {
                    volatilityAdjustment: 1.2,
                    marketStateMultiplier: 1.3
                },
                cooldownPeriods: {
                    signalCooldown: config.strategy.signalCooldownMs * 0.8,
                    oppositeCooldown: config.strategy.oppositeCooldownMs * 1.5
                },
                holdingDuration: {
                    targetHoldingTime: 2.5 * 60 * 60 * 1000, // 2.5小时
                    timeoutMultiplier: 1.8
                },
                riskParameters: {
                    stopLossPercent: config.risk.stopLossPercent * 0.9,
                    takeProfitPercent: config.risk.takeProfitPercent * 1.1
                }
            },
            [MarketState.SIDEWAYS]: {
                drivingThresholds: {
                    signalThreshold: 0.55,
                    evThreshold: 0.4,
                    confidenceThreshold: 0.65
                },
                leverageFactors: {
                    volatilityAdjustment: 0.8,
                    marketStateMultiplier: 0.9
                },
                cooldownPeriods: {
                    signalCooldown: config.strategy.signalCooldownMs * 1.2,
                    oppositeCooldown: config.strategy.oppositeCooldownMs * 0.8
                },
                holdingDuration: {
                    targetHoldingTime: 1 * 60 * 60 * 1000, // 1小时
                    timeoutMultiplier: 1.2
                },
                riskParameters: {
                    stopLossPercent: config.risk.stopLossPercent * 1.1,
                    takeProfitPercent: config.risk.takeProfitPercent * 0.9
                }
            },
            [MarketState.HIGH_VOLATILITY]: {
                drivingThresholds: {
                    signalThreshold: 0.6,
                    evThreshold: 0.45,
                    confidenceThreshold: 0.7
                },
                leverageFactors: {
                    volatilityAdjustment: 0.6,
                    marketStateMultiplier: 0.7
                },
                cooldownPeriods: {
                    signalCooldown: config.strategy.signalCooldownMs * 0.5,
                    volatilityCooldown: config.strategy.signalCooldownMs * 0.2
                },
                holdingDuration: {
                    targetHoldingTime: 30 * 60 * 1000, // 30分钟
                    timeoutMultiplier: 1.0
                },
                riskParameters: {
                    stopLossPercent: config.risk.stopLossPercent * 1.5,
                    takeProfitPercent: config.risk.takeProfitPercent * 1.3,
                    positionSizing: 0.05 // 5%
                }
            },
            [MarketState.LOW_VOLATILITY]: {
                drivingThresholds: {
                    signalThreshold: 0.4,
                    evThreshold: 0.25,
                    confidenceThreshold: 0.5
                },
                leverageFactors: {
                    volatilityAdjustment: 1.4,
                    marketStateMultiplier: 1.1
                },
                cooldownPeriods: {
                    signalCooldown: config.strategy.signalCooldownMs * 1.5,
                    volatilityCooldown: config.strategy.signalCooldownMs * 2.0
                },
                holdingDuration: {
                    targetHoldingTime: 4 * 60 * 60 * 1000, // 4小时
                    timeoutMultiplier: 2.5
                },
                riskParameters: {
                    stopLossPercent: config.risk.stopLossPercent * 0.7,
                    takeProfitPercent: config.risk.takeProfitPercent * 0.8,
                    positionSizing: 0.15 // 15%
                }
            },
            [MarketState.BREAKOUT]: {
                drivingThresholds: {
                    signalThreshold: 0.35,
                    evThreshold: 0.2,
                    confidenceThreshold: 0.45
                },
                leverageFactors: {
                    volatilityAdjustment: 1.5,
                    marketStateMultiplier: 1.6
                },
                cooldownPeriods: {
                    signalCooldown: config.strategy.signalCooldownMs * 0.3,
                    oppositeCooldown: config.strategy.oppositeCooldownMs * 2.0
                },
                holdingDuration: {
                    targetHoldingTime: 45 * 60 * 1000, // 45分钟
                    timeoutMultiplier: 1.5
                },
                riskParameters: {
                    stopLossPercent: config.risk.stopLossPercent * 1.2,
                    takeProfitPercent: config.risk.takeProfitPercent * 1.8,
                    positionSizing: 0.12 // 12%
                }
            },
            [MarketState.REVERSAL]: {
                drivingThresholds: {
                    signalThreshold: 0.65,
                    evThreshold: 0.5,
                    confidenceThreshold: 0.75
                },
                leverageFactors: {
                    volatilityAdjustment: 0.9,
                    marketStateMultiplier: 1.1
                },
                cooldownPeriods: {
                    signalCooldown: config.strategy.signalCooldownMs * 0.7,
                    oppositeCooldown: config.strategy.oppositeCooldownMs * 0.5
                },
                holdingDuration: {
                    targetHoldingTime: 90 * 60 * 1000, // 1.5小时
                    timeoutMultiplier: 1.3
                },
                riskParameters: {
                    stopLossPercent: config.risk.stopLossPercent * 1.3,
                    takeProfitPercent: config.risk.takeProfitPercent * 1.1,
                    positionSizing: 0.08 // 8%
                }
            }
        };
    }

    /**
     * 初始化调整规则
     */
    private initializeAdjustmentRules(): void {
        this.adjustmentRules = [
            // 高置信度规则
            {
                condition: (marketState, currentParams) => marketState.confidence > 0.8,
                adjustment: (currentParams) => ({
                    leverageFactors: {
                        ...currentParams.leverageFactors,
                        confidenceMultiplier: 1.2
                    },
                    drivingThresholds: {
                        ...currentParams.drivingThresholds,
                        signalThreshold: currentParams.drivingThresholds.signalThreshold * 0.9
                    }
                }),
                priority: 1,
                description: '高置信度增强'
            },
            
            // 低置信度规则
            {
                condition: (marketState, currentParams) => marketState.confidence < 0.4,
                adjustment: (currentParams) => ({
                    leverageFactors: {
                        ...currentParams.leverageFactors,
                        confidenceMultiplier: 0.7
                    },
                    drivingThresholds: {
                        ...currentParams.drivingThresholds,
                        signalThreshold: currentParams.drivingThresholds.signalThreshold * 1.2
                    }
                }),
                priority: 1,
                description: '低置信度保守'
            },
            
            // 多时间框架一致性规则
            {
                condition: (marketState, currentParams) => marketState.multiTimeFrameConsistency > 0.8,
                adjustment: (currentParams) => ({
                    cooldownPeriods: {
                        ...currentParams.cooldownPeriods,
                        signalCooldown: currentParams.cooldownPeriods.signalCooldown * 0.8
                    },
                    leverageFactors: {
                        ...currentParams.leverageFactors,
                        marketStateMultiplier: 1.15
                    }
                }),
                priority: 2,
                description: '多时间框架一致性增强'
            },
            
            // 极端波动性规则
            {
                condition: (marketState, currentParams) => marketState.volatilityLevel === 'EXTREME',
                adjustment: (currentParams) => ({
                    riskParameters: {
                        ...currentParams.riskParameters,
                        stopLossPercent: currentParams.riskParameters.stopLossPercent * 2.0,
                        positionSizing: currentParams.riskParameters.positionSizing * 0.5
                    },
                    leverageFactors: {
                        ...currentParams.leverageFactors,
                        volatilityAdjustment: 0.4
                    }
                }),
                priority: 3,
                description: '极端波动性风险控制'
            },
            
            // ADX强趋势规则
            {
                condition: (marketState, currentParams) => marketState.adxValue > 40,
                adjustment: (currentParams) => ({
                    drivingThresholds: {
                        ...currentParams.drivingThresholds,
                        signalThreshold: currentParams.drivingThresholds.signalThreshold * 0.85
                    },
                    holdingDuration: {
                        ...currentParams.holdingDuration,
                        targetHoldingTime: currentParams.holdingDuration.targetHoldingTime * 1.5
                    }
                }),
                priority: 2,
                description: 'ADX强趋势优化'
            }
        ];
    }

    /**
     * 根据市场状态调整参数
     */
    adjustParameters(marketState: MarketStateResult): AdaptiveParameters {
        // 1. 基于市场状态的基础调整
        const baseAdjustment = this.marketStateParameterMap[marketState.primaryState];
        let adjustedParams = this.mergeParameters(this.currentParameters, baseAdjustment);
        
        // 2. 应用调整规则
        const applicableRules = this.adjustmentRules
            .filter(rule => rule.condition(marketState, adjustedParams))
            .sort((a, b) => b.priority - a.priority);
        
        for (const rule of applicableRules) {
            const ruleAdjustment = rule.adjustment(adjustedParams);
            adjustedParams = this.mergeParameters(adjustedParams, ruleAdjustment);
        }
        
        // 3. 更新元数据
        adjustedParams.metadata = {
            ...adjustedParams.metadata,
            marketState: marketState.primaryState,
            confidence: marketState.confidence,
            lastUpdated: Date.now(),
            source: 'AUTO'
        };
        
        // 4. 验证参数合理性
        adjustedParams = this.validateParameters(adjustedParams);
        
        // 5. 更新当前参数和历史
        this.updateParameters(adjustedParams);
        
        return adjustedParams;
    }

    /**
     * 合并参数
     */
    private mergeParameters(
        base: AdaptiveParameters, 
        adjustment: DeepPartial<AdaptiveParameters>
    ): AdaptiveParameters {
        const merged = { ...base };
        
        Object.keys(adjustment).forEach(key => {
            const adjustmentValue = adjustment[key as keyof AdaptiveParameters];
            if (adjustmentValue && typeof adjustmentValue === 'object') {
                merged[key as keyof AdaptiveParameters] = {
                    ...merged[key as keyof AdaptiveParameters],
                    ...adjustmentValue
                } as any;
            } else if (adjustmentValue !== undefined) {
                (merged as any)[key] = adjustmentValue;
            }
        });
        
        return merged;
    }

    /**
     * 验证参数合理性
     */
    private validateParameters(params: AdaptiveParameters): AdaptiveParameters {
        const validated = { ...params };
        
        // 验证杠杆系数
        validated.leverageFactors.baseLeverage = Math.max(1, Math.min(
            validated.leverageFactors.maxLeverage,
            validated.leverageFactors.baseLeverage
        ));
        
        // 验证阈值范围
        validated.drivingThresholds.signalThreshold = Math.max(0.1, Math.min(0.9, 
            validated.drivingThresholds.signalThreshold));
        validated.drivingThresholds.evThreshold = Math.max(0.05, Math.min(0.8, 
            validated.drivingThresholds.evThreshold));
        validated.drivingThresholds.confidenceThreshold = Math.max(0.3, Math.min(0.95, 
            validated.drivingThresholds.confidenceThreshold));
        
        // 验证冷却时间
        validated.cooldownPeriods.signalCooldown = Math.max(30000, Math.min(3600000, 
            validated.cooldownPeriods.signalCooldown));
        validated.cooldownPeriods.oppositeCooldown = Math.max(10000, Math.min(1800000, 
            validated.cooldownPeriods.oppositeCooldown));
        
        // 验证持仓时长
        validated.holdingDuration.minHoldingTime = Math.max(60000, 
            validated.holdingDuration.minHoldingTime);
        validated.holdingDuration.maxHoldingTime = Math.min(86400000, 
            validated.holdingDuration.maxHoldingTime);
        validated.holdingDuration.targetHoldingTime = Math.max(
            validated.holdingDuration.minHoldingTime,
            Math.min(validated.holdingDuration.maxHoldingTime, 
                validated.holdingDuration.targetHoldingTime)
        );
        
        // 验证风险参数
        validated.riskParameters.stopLossPercent = Math.max(0.005, Math.min(0.1, 
            validated.riskParameters.stopLossPercent));
        validated.riskParameters.takeProfitPercent = Math.max(0.01, Math.min(0.2, 
            validated.riskParameters.takeProfitPercent));
        validated.riskParameters.positionSizing = Math.max(0.01, Math.min(0.3, 
            validated.riskParameters.positionSizing));
        
        return validated;
    }

    /**
     * 更新参数
     */
    private updateParameters(newParameters: AdaptiveParameters): void {
        // 保存历史
        this.parameterHistory.push({
            timestamp: Date.now(),
            parameters: { ...this.currentParameters }
        });
        
        // 限制历史长度
        if (this.parameterHistory.length > this.maxHistoryLength) {
            this.parameterHistory.shift();
        }
        
        // 更新当前参数
        this.currentParameters = newParameters;
    }

    /**
     * 获取当前参数
     */
    getCurrentParameters(): AdaptiveParameters {
        return { ...this.currentParameters };
    }

    /**
     * 获取参数历史
     */
    getParameterHistory(limit: number = 20): Array<{ timestamp: number; parameters: AdaptiveParameters }> {
        return this.parameterHistory.slice(-limit);
    }

    /**
     * 手动设置参数
     */
    setParameters(parameters: DeepPartial<AdaptiveParameters>): void {
        const newParameters = this.mergeParameters(this.currentParameters, parameters);
        newParameters.metadata.source = 'MANUAL';
        newParameters.metadata.lastUpdated = Date.now();
        
        this.updateParameters(this.validateParameters(newParameters));
    }

    /**
     * 重置为默认参数
     */
    resetToDefaults(): void {
        this.currentParameters = this.getDefaultParameters();
    }

    /**
     * 获取参数变化统计
     */
    getParameterStats(): {
        totalAdjustments: number;
        avgConfidence: number;
        mostFrequentMarketState: MarketState;
        parameterStability: number;
    } {
        if (this.parameterHistory.length === 0) {
            return {
                totalAdjustments: 0,
                avgConfidence: 0.5,
                mostFrequentMarketState: MarketState.SIDEWAYS,
                parameterStability: 1.0
            };
        }
        
        const totalAdjustments = this.parameterHistory.length;
        const avgConfidence = this.parameterHistory.reduce((sum, entry) => 
            sum + entry.parameters.metadata.confidence, 0) / totalAdjustments;
        
        // 统计最频繁的市场状态
        const stateCount = new Map<MarketState, number>();
        this.parameterHistory.forEach(entry => {
            const state = entry.parameters.metadata.marketState;
            stateCount.set(state, (stateCount.get(state) || 0) + 1);
        });
        
        const mostFrequentMarketState = Array.from(stateCount.entries())
            .sort((a, b) => b[1] - a[1])[0]?.[0] || MarketState.SIDEWAYS;
        
        // 计算参数稳定性（基于信号阈值的变化）
        const thresholdChanges = this.parameterHistory.slice(1).map((entry, index) => {
            const prev = this.parameterHistory[index].parameters.drivingThresholds.signalThreshold;
            const curr = entry.parameters.drivingThresholds.signalThreshold;
            return Math.abs(curr - prev) / prev;
        });
        
        const parameterStability = thresholdChanges.length > 0 
            ? 1 - (thresholdChanges.reduce((sum, change) => sum + change, 0) / thresholdChanges.length)
            : 1.0;
        
        return {
            totalAdjustments,
            avgConfidence,
            mostFrequentMarketState,
            parameterStability: Math.max(0, Math.min(1, parameterStability))
        };
    }
}

export default AdaptiveParameterManager;