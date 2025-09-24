import { TechnicalIndicatorAnalyzer, KlineData, TechnicalIndicatorResult } from '../indicators/technical-indicators.js';
import { config } from '../config.js';
import * as _ from 'lodash';

/**
 * 市场状态枚举
 */
export enum MarketState {
    TRENDING_UP = 'TRENDING_UP',           // 上升趋势
    TRENDING_DOWN = 'TRENDING_DOWN',       // 下降趋势
    SIDEWAYS = 'SIDEWAYS',                 // 横盘整理
    HIGH_VOLATILITY = 'HIGH_VOLATILITY',   // 高波动
    LOW_VOLATILITY = 'LOW_VOLATILITY',     // 低波动
    BREAKOUT = 'BREAKOUT',                 // 突破
    REVERSAL = 'REVERSAL'                  // 反转
}

/**
 * 流动性标签
 */
export enum LiquidityLabel {
    HIGH = 'HIGH',           // 高流动性
    MEDIUM = 'MEDIUM',       // 中等流动性
    LOW = 'LOW',             // 低流动性
    ILLIQUID = 'ILLIQUID'    // 流动性不足
}

/**
 * 时间框架
 */
export enum TimeFrame {
    M1 = '1m',
    M5 = '5m',
    M15 = '15m',
    M30 = '30m',
    H1 = '1h',
    H4 = '4h',
    D1 = '1d'
}

/**
 * 市场状态分析结果
 */
export interface MarketStateResult {
    primaryState: MarketState;
    confidence: number;
    adxValue: number;
    adxTrend: 'STRENGTHENING' | 'WEAKENING' | 'STABLE';
    atrPercentile: number;
    volatilityLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    liquidityLabel: LiquidityLabel;
    multiTimeFrameConsistency: number; // 0-1, 多时间框架一致性
    timeFrameAnalysis: {
        [key in TimeFrame]?: {
            state: MarketState;
            confidence: number;
            adx: number;
            atr: number;
        }
    };
    stateTransitionProbability: {
        [key in MarketState]: number;
    };
    timestamp: number;
}

/**
 * ATR分位数配置
 */
interface ATRPercentileConfig {
    lookbackPeriod: number;    // 回看周期
    percentiles: number[];     // 分位数阈值 [25, 50, 75, 90]
}

/**
 * 市场状态识别器配置
 */
interface MarketStateConfig {
    adx: {
        trendThreshold: number;      // ADX趋势阈值
        strongTrendThreshold: number; // 强趋势阈值
        period: number;              // ADX计算周期
    };
    atr: {
        period: number;              // ATR计算周期
        percentileConfig: ATRPercentileConfig;
    };
    liquidity: {
        volumeThresholds: {
            high: number;            // 高流动性阈值
            medium: number;          // 中等流动性阈值
            low: number;             // 低流动性阈值
        };
        spreadThresholds: {
            tight: number;           // 紧密价差阈值
            normal: number;          // 正常价差阈值
            wide: number;            // 宽价差阈值
        };
    };
    multiTimeFrame: {
        timeFrames: TimeFrame[];     // 分析的时间框架
        consistencyThreshold: number; // 一致性阈值
    };
}

/**
 * 市场状态识别分析器
 */
export class MarketStateAnalyzer {
    private config: MarketStateConfig;
    private atrHistory: Map<TimeFrame, number[]> = new Map();
    private stateHistory: MarketStateResult[] = [];
    private maxHistoryLength = 1000;

    constructor(customConfig?: Partial<MarketStateConfig>) {
        this.config = {
            adx: {
                trendThreshold: 25,
                strongTrendThreshold: 40,
                period: 14,
                ...customConfig?.adx
            },
            atr: {
                period: 14,
                percentileConfig: {
                    lookbackPeriod: 100,
                    percentiles: [25, 50, 75, 90]
                },
                ...customConfig?.atr
            },
            liquidity: {
                volumeThresholds: {
                    high: 2.0,    // 2倍平均成交量
                    medium: 1.0,  // 平均成交量
                    low: 0.5      // 0.5倍平均成交量
                },
                spreadThresholds: {
                    tight: 0.001,   // 0.1%
                    normal: 0.005,  // 0.5%
                    wide: 0.01      // 1%
                },
                ...customConfig?.liquidity
            },
            multiTimeFrame: {
                timeFrames: [TimeFrame.M5, TimeFrame.M15, TimeFrame.H1, TimeFrame.H4],
                consistencyThreshold: 0.7,
                ...customConfig?.multiTimeFrame
            }
        };

        // 初始化ATR历史记录
        this.config.multiTimeFrame.timeFrames.forEach(tf => {
            this.atrHistory.set(tf, []);
        });
    }

    /**
     * 分析市场状态
     */
    async analyzeMarketState(
        klineDataMap: Map<TimeFrame, KlineData[]>,
        currentPrice: number,
        volume24h: number,
        spread?: number
    ): Promise<MarketStateResult> {
        const timestamp = Date.now();
        
        // 1. 多时间框架技术指标分析
        const timeFrameAnalysis = await this.analyzeMultiTimeFrame(klineDataMap);
        
        // 2. 计算主要时间框架的指标（默认使用H1）
        const primaryTimeFrame = TimeFrame.H1;
        const primaryKlineData = klineDataMap.get(primaryTimeFrame) || [];
        
        if (primaryKlineData.length < 50) {
            throw new Error('数据不足，无法进行市场状态分析');
        }

        const analyzer = new TechnicalIndicatorAnalyzer(primaryKlineData);
        const indicators = analyzer.calculateAllIndicators();
        
        if (!indicators) {
            throw new Error('技术指标计算失败');
        }

        // 3. ADX分析
        const adxAnalysis = this.analyzeADX(indicators.adx, timeFrameAnalysis);
        
        // 4. ATR分位数分析
        const atrPercentile = this.calculateATRPercentile(indicators.atr, primaryTimeFrame);
        const volatilityLevel = this.determineVolatilityLevel(atrPercentile);
        
        // 5. 流动性分析
        const liquidityLabel = this.analyzeLiquidity(volume24h, spread, indicators.volume);
        
        // 6. 多时间框架一致性
        const multiTimeFrameConsistency = this.calculateConsistency(timeFrameAnalysis);
        
        // 7. 确定主要市场状态
        const primaryState = this.determinePrimaryState(
            adxAnalysis,
            volatilityLevel,
            indicators,
            timeFrameAnalysis
        );
        
        // 8. 计算状态转换概率
        const stateTransitionProbability = this.calculateStateTransitionProbability(
            primaryState,
            adxAnalysis,
            volatilityLevel,
            multiTimeFrameConsistency
        );

        const result: MarketStateResult = {
            primaryState,
            confidence: this.calculateConfidence(adxAnalysis, multiTimeFrameConsistency, volatilityLevel),
            adxValue: indicators.adx,
            adxTrend: adxAnalysis.trend,
            atrPercentile,
            volatilityLevel,
            liquidityLabel,
            multiTimeFrameConsistency,
            timeFrameAnalysis,
            stateTransitionProbability,
            timestamp
        };

        // 更新历史记录
        this.updateHistory(result);
        
        return result;
    }

    /**
     * 多时间框架分析
     */
    private async analyzeMultiTimeFrame(
        klineDataMap: Map<TimeFrame, KlineData[]>
    ): Promise<MarketStateResult['timeFrameAnalysis']> {
        const analysis: MarketStateResult['timeFrameAnalysis'] = {};

        for (const timeFrame of this.config.multiTimeFrame.timeFrames) {
            const klineData = klineDataMap.get(timeFrame);
            if (!klineData || klineData.length < 30) continue;

            const analyzer = new TechnicalIndicatorAnalyzer(klineData);
            const indicators = analyzer.calculateAllIndicators();
            
            if (!indicators) continue;

            const adxAnalysis = this.analyzeADX(indicators.adx, {});
            const state = this.determineStateFromIndicators(indicators, adxAnalysis);
            
            analysis[timeFrame] = {
                state,
                confidence: this.calculateSingleTimeFrameConfidence(indicators, adxAnalysis),
                adx: indicators.adx,
                atr: indicators.atr
            };

            // 更新ATR历史
            this.updateATRHistory(timeFrame, indicators.atr);
        }

        return analysis;
    }

    /**
     * ADX分析
     */
    private analyzeADX(
        adxValue: number,
        timeFrameAnalysis: MarketStateResult['timeFrameAnalysis']
    ): {
        value: number;
        trend: 'STRENGTHENING' | 'WEAKENING' | 'STABLE';
        isTrending: boolean;
        isStrongTrend: boolean;
    } {
        const isTrending = adxValue >= this.config.adx.trendThreshold;
        const isStrongTrend = adxValue >= this.config.adx.strongTrendThreshold;
        
        // 计算ADX趋势（基于历史数据）
        let trend: 'STRENGTHENING' | 'WEAKENING' | 'STABLE' = 'STABLE';
        
        if (this.stateHistory.length >= 3) {
            const recentADX = this.stateHistory.slice(-3).map(s => s.adxValue);
            const adxSlope = (recentADX[2] - recentADX[0]) / 2;
            
            if (adxSlope > 2) {
                trend = 'STRENGTHENING';
            } else if (adxSlope < -2) {
                trend = 'WEAKENING';
            }
        }

        return {
            value: adxValue,
            trend,
            isTrending,
            isStrongTrend
        };
    }

    /**
     * 计算ATR分位数
     */
    private calculateATRPercentile(atrValue: number, timeFrame: TimeFrame): number {
        const atrHistory = this.atrHistory.get(timeFrame) || [];
        
        if (atrHistory.length < 20) {
            return 50; // 默认中位数
        }

        const sortedATR = [...atrHistory].sort((a, b) => a - b);
        const position = sortedATR.findIndex(val => val >= atrValue);
        
        if (position === -1) {
            return 100; // 超过所有历史值
        }
        
        return (position / sortedATR.length) * 100;
    }

    /**
     * 确定波动性水平
     */
    private determineVolatilityLevel(atrPercentile: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' {
        if (atrPercentile >= 90) return 'EXTREME';
        if (atrPercentile >= 75) return 'HIGH';
        if (atrPercentile >= 25) return 'MEDIUM';
        return 'LOW';
    }

    /**
     * 流动性分析
     */
    private analyzeLiquidity(
        volume24h: number,
        spread: number = 0,
        volumeInfo: { current: number; average: number; ratio: number }
    ): LiquidityLabel {
        const volumeRatio = volumeInfo.ratio;
        
        // 基于成交量比率的流动性评估
        let liquidityScore = 0;
        
        if (volumeRatio >= this.config.liquidity.volumeThresholds.high) {
            liquidityScore += 3;
        } else if (volumeRatio >= this.config.liquidity.volumeThresholds.medium) {
            liquidityScore += 2;
        } else if (volumeRatio >= this.config.liquidity.volumeThresholds.low) {
            liquidityScore += 1;
        }
        
        // 基于价差的流动性评估
        if (spread > 0) {
            if (spread <= this.config.liquidity.spreadThresholds.tight) {
                liquidityScore += 2;
            } else if (spread <= this.config.liquidity.spreadThresholds.normal) {
                liquidityScore += 1;
            } else if (spread > this.config.liquidity.spreadThresholds.wide) {
                liquidityScore -= 1;
            }
        }
        
        // 转换为流动性标签
        if (liquidityScore >= 4) return LiquidityLabel.HIGH;
        if (liquidityScore >= 2) return LiquidityLabel.MEDIUM;
        if (liquidityScore >= 1) return LiquidityLabel.LOW;
        return LiquidityLabel.ILLIQUID;
    }

    /**
     * 计算多时间框架一致性
     */
    private calculateConsistency(
        timeFrameAnalysis: MarketStateResult['timeFrameAnalysis']
    ): number {
        const states = Object.values(timeFrameAnalysis).map(tf => tf.state);
        
        if (states.length === 0) return 0;
        
        // 计算状态一致性
        const stateCount = new Map<MarketState, number>();
        states.forEach(state => {
            stateCount.set(state, (stateCount.get(state) || 0) + 1);
        });
        
        const maxCount = Math.max(...stateCount.values());
        return maxCount / states.length;
    }

    /**
     * 确定主要市场状态
     */
    private determinePrimaryState(
        adxAnalysis: any,
        volatilityLevel: string,
        indicators: TechnicalIndicatorResult,
        timeFrameAnalysis: MarketStateResult['timeFrameAnalysis']
    ): MarketState {
        // 基于ADX和价格趋势确定状态
        const priceTrend = this.analyzePriceTrend(indicators);
        
        if (adxAnalysis.isStrongTrend) {
            if (priceTrend === 'UP') return MarketState.TRENDING_UP;
            if (priceTrend === 'DOWN') return MarketState.TRENDING_DOWN;
        }
        
        if (volatilityLevel === 'EXTREME' || volatilityLevel === 'HIGH') {
            // 检查是否为突破
            if (this.detectBreakout(indicators)) {
                return MarketState.BREAKOUT;
            }
            return MarketState.HIGH_VOLATILITY;
        }
        
        if (volatilityLevel === 'LOW') {
            return MarketState.LOW_VOLATILITY;
        }
        
        // 检查反转信号
        if (this.detectReversal(indicators, timeFrameAnalysis)) {
            return MarketState.REVERSAL;
        }
        
        return MarketState.SIDEWAYS;
    }

    /**
     * 分析价格趋势
     */
    private analyzePriceTrend(indicators: TechnicalIndicatorResult): 'UP' | 'DOWN' | 'SIDEWAYS' {
        const { ema12, ema26, sma20 } = indicators;
        
        if (ema12 > ema26 && ema12 > sma20) return 'UP';
        if (ema12 < ema26 && ema12 < sma20) return 'DOWN';
        return 'SIDEWAYS';
    }

    /**
     * 检测突破
     */
    private detectBreakout(indicators: TechnicalIndicatorResult): boolean {
        const { bollinger, keltner, squeeze } = indicators;
        
        // 挤压后的突破
        if (squeeze) return true;
        
        // 布林带突破
        const currentPrice = indicators.bollinger.middle; // 使用中轨作为当前价格参考
        const bbBreakout = currentPrice > bollinger.upper || currentPrice < bollinger.lower;
        
        // Keltner通道突破
        const kcBreakout = currentPrice > keltner.upper || currentPrice < keltner.lower;
        
        return bbBreakout || kcBreakout;
    }

    /**
     * 检测反转
     */
    private detectReversal(
        indicators: TechnicalIndicatorResult,
        timeFrameAnalysis: MarketStateResult['timeFrameAnalysis']
    ): boolean {
        // RSI背离
        const rsiDivergence = indicators.rsi > 70 || indicators.rsi < 30;
        
        // MACD背离
        const macdDivergence = Math.abs(indicators.macd.histogram) > Math.abs(indicators.macd.macd) * 0.5;
        
        // 多时间框架分歧
        const states = Object.values(timeFrameAnalysis).map(tf => tf.state);
        const hasConflict = states.some(state => 
            state === MarketState.TRENDING_UP || state === MarketState.TRENDING_DOWN
        ) && states.some(state => 
            state === MarketState.SIDEWAYS || state === MarketState.REVERSAL
        );
        
        return rsiDivergence && (macdDivergence || hasConflict);
    }

    /**
     * 计算状态转换概率
     */
    private calculateStateTransitionProbability(
        currentState: MarketState,
        adxAnalysis: any,
        volatilityLevel: string,
        consistency: number
    ): { [key in MarketState]: number } {
        const probabilities: { [key in MarketState]: number } = {
            [MarketState.TRENDING_UP]: 0,
            [MarketState.TRENDING_DOWN]: 0,
            [MarketState.SIDEWAYS]: 0,
            [MarketState.HIGH_VOLATILITY]: 0,
            [MarketState.LOW_VOLATILITY]: 0,
            [MarketState.BREAKOUT]: 0,
            [MarketState.REVERSAL]: 0
        };

        // 基于当前状态和指标计算转换概率
        const baseProb = 1 / Object.keys(MarketState).length;
        
        Object.keys(probabilities).forEach(state => {
            probabilities[state as MarketState] = baseProb;
        });

        // 调整概率基于ADX和一致性
        if (adxAnalysis.trend === 'STRENGTHENING') {
            probabilities[MarketState.TRENDING_UP] *= 1.5;
            probabilities[MarketState.TRENDING_DOWN] *= 1.5;
        }
        
        if (consistency > 0.8) {
            probabilities[currentState] *= 2;
        }

        // 归一化概率
        const total = Object.values(probabilities).reduce((sum, prob) => sum + prob, 0);
        Object.keys(probabilities).forEach(state => {
            probabilities[state as MarketState] /= total;
        });

        return probabilities;
    }

    /**
     * 计算置信度
     */
    private calculateConfidence(
        adxAnalysis: any,
        consistency: number,
        volatilityLevel: string
    ): number {
        let confidence = 0.5; // 基础置信度
        
        // ADX贡献
        if (adxAnalysis.isStrongTrend) {
            confidence += 0.3;
        } else if (adxAnalysis.isTrending) {
            confidence += 0.15;
        }
        
        // 一致性贡献
        confidence += consistency * 0.3;
        
        // 波动性贡献
        if (volatilityLevel === 'EXTREME') {
            confidence += 0.1;
        } else if (volatilityLevel === 'LOW') {
            confidence -= 0.1;
        }
        
        return Math.max(0, Math.min(1, confidence));
    }

    /**
     * 辅助方法
     */
    private determineStateFromIndicators(indicators: TechnicalIndicatorResult, adxAnalysis: any): MarketState {
        const priceTrend = this.analyzePriceTrend(indicators);
        
        if (adxAnalysis.isTrending) {
            if (priceTrend === 'UP') return MarketState.TRENDING_UP;
            if (priceTrend === 'DOWN') return MarketState.TRENDING_DOWN;
        }
        
        return MarketState.SIDEWAYS;
    }

    private calculateSingleTimeFrameConfidence(indicators: TechnicalIndicatorResult, adxAnalysis: any): number {
        return adxAnalysis.isTrending ? 0.8 : 0.5;
    }

    private updateATRHistory(timeFrame: TimeFrame, atrValue: number): void {
        const history = this.atrHistory.get(timeFrame) || [];
        history.push(atrValue);
        
        // 保持历史长度
        if (history.length > this.config.atr.percentileConfig.lookbackPeriod) {
            history.shift();
        }
        
        this.atrHistory.set(timeFrame, history);
    }

    private updateHistory(result: MarketStateResult): void {
        this.stateHistory.push(result);
        
        if (this.stateHistory.length > this.maxHistoryLength) {
            this.stateHistory.shift();
        }
    }

    /**
     * 获取历史状态
     */
    getStateHistory(limit: number = 50): MarketStateResult[] {
        return this.stateHistory.slice(-limit);
    }

    /**
     * 获取当前配置
     */
    getConfig(): MarketStateConfig {
        return { ...this.config };
    }

    /**
     * 更新配置
     */
    updateConfig(newConfig: Partial<MarketStateConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }
}

export default MarketStateAnalyzer;