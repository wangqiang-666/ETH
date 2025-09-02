import { RSI, MACD, BollingerBands, Stochastic, WilliamsR, EMA, SMA, ATR } from 'technicalindicators';
import _ from 'lodash';
import { config } from '../config';

/**
 * K线数据接口
 */
export interface KlineData {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

/**
 * 技术指标结果接口
 */
export interface TechnicalIndicatorResult {
    rsi: number;
    macd: {
        macd: number;
        signal: number;
        histogram: number;
    };
    bollinger: {
        upper: number;
        middle: number;
        lower: number;
    };
    kdj: {
        k: number;
        d: number;
        j: number;
    };
    williams: number;
    ema12: number;
    ema26: number;
    // 新增：趋势过滤用 EMA 周期
    emaTrend: number;
    sma20: number;
    atr: number;
    volume: {
        current: number;
        average: number;
        ratio: number;
    };
}

/**
 * 技术指标信号强度
 */
export interface IndicatorSignal {
    indicator: string;
    signal: 'BUY' | 'SELL' | 'HOLD';
    strength: number; // -1 到 1
    confidence: number; // 0 到 1
    reason: string;
}

/**
 * 综合技术指标分析器
 */
export class TechnicalIndicatorAnalyzer {
    private klineData: KlineData[] = [];
    
    constructor(klineData: KlineData[] = []) {
        this.klineData = klineData;
    }
    
    /**
     * 更新K线数据
     */
    updateKlineData(klineData: KlineData[]): void {
        this.klineData = klineData.sort((a, b) => a.timestamp - b.timestamp);
    }
    
    /**
     * 添加新的K线数据
     */
    addKlineData(kline: KlineData): void {
        this.klineData.push(kline);
        this.klineData.sort((a, b) => a.timestamp - b.timestamp);
        
        // 保持最近1000条数据
        if (this.klineData.length > 1000) {
            this.klineData = this.klineData.slice(-1000);
        }
    }
    
    /**
     * 计算所有技术指标
     */
    calculateAllIndicators(): TechnicalIndicatorResult | null {
        if (this.klineData.length < 50) {
            console.warn('K线数据不足，需要至少50条数据');
            return null;
        }
        
        const closes = this.klineData.map(k => k.close);
        const highs = this.klineData.map(k => k.high);
        const lows = this.klineData.map(k => k.low);
        const volumes = this.klineData.map(k => k.volume);
        
        try {
            // 从配置读取参数
            const rsiPeriod = config.indicators.rsi.period || 14;
            const macdFast = config.indicators.macd.fastPeriod || 12;
            const macdSlow = config.indicators.macd.slowPeriod || 26;
            const macdSignal = config.indicators.macd.signalPeriod || 9;
            const bbPeriod = config.indicators.bollinger.period || 20;
            const bbStd = config.indicators.bollinger.stdDev || 2;
            const kdjPeriod = config.indicators.kdj.period || 9;
            const kdjSignal = config.indicators.kdj.signalPeriod || 3;
            const williamsPeriod = config.indicators.williams.period || 14;
            const emaShort = config.indicators.ema.shortPeriod || 12;
            const emaLong = config.indicators.ema.longPeriod || 26;
            const emaTrendPeriod = config.indicators.ema.trendPeriod || 100;
            
            // RSI计算
            const rsiValues = RSI.calculate({ values: closes, period: rsiPeriod });
            const currentRSI = rsiValues[rsiValues.length - 1] || 50;
            
            // MACD计算
            const macdValues = MACD.calculate({
                values: closes,
                fastPeriod: macdFast,
                slowPeriod: macdSlow,
                signalPeriod: macdSignal,
                SimpleMAOscillator: false,
                SimpleMASignal: false
            });
            const currentMACD = macdValues[macdValues.length - 1] || { MACD: 0, signal: 0, histogram: 0 };
            
            // 布林带计算
            const bbValues = BollingerBands.calculate({
                values: closes,
                period: bbPeriod,
                stdDev: bbStd
            });
            const currentBB = bbValues[bbValues.length - 1] || { upper: 0, middle: 0, lower: 0 };
            
            // KDJ计算 (使用Stochastic)
            const stochValues = Stochastic.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: kdjPeriod,
                signalPeriod: kdjSignal
            });
            const currentStoch = stochValues[stochValues.length - 1] || { k: 50, d: 50 };
            const j = 3 * currentStoch.k - 2 * currentStoch.d;
            
            // 威廉指标计算
            const williamsValues = WilliamsR.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: williamsPeriod
            });
            const currentWilliams = williamsValues[williamsValues.length - 1] || -50;
            
            // EMA计算（短/长/趋势）
            const emaShortValues = EMA.calculate({ values: closes, period: emaShort });
            const emaLongValues = EMA.calculate({ values: closes, period: emaLong });
            const emaTrendValues = EMA.calculate({ values: closes, period: emaTrendPeriod });
            const currentEMA12 = emaShortValues[emaShortValues.length - 1] || closes[closes.length - 1];
            const currentEMA26 = emaLongValues[emaLongValues.length - 1] || closes[closes.length - 1];
            const currentEMATrend = emaTrendValues[emaTrendValues.length - 1] || closes[closes.length - 1];
            
            // SMA计算
            const sma20Values = SMA.calculate({ values: closes, period: 20 });
            const currentSMA20 = sma20Values[sma20Values.length - 1] || closes[closes.length - 1];
            
            // ATR计算
            const atrValues = ATR.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: 14
            });
            const currentATR = atrValues[atrValues.length - 1] || 0;
            
            // 成交量分析
            const recentVolumes = volumes.slice(-20);
            const avgVolume = _.mean(recentVolumes);
            const currentVolume = volumes[volumes.length - 1];
            const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
            
            return {
                rsi: currentRSI,
                macd: {
                    macd: currentMACD.MACD || 0,
                    signal: currentMACD.signal || 0,
                    histogram: currentMACD.histogram || 0
                },
                bollinger: {
                    upper: currentBB.upper,
                    middle: currentBB.middle,
                    lower: currentBB.lower
                },
                kdj: {
                    k: currentStoch.k,
                    d: currentStoch.d,
                    j: j
                },
                williams: currentWilliams,
                ema12: currentEMA12,
                ema26: currentEMA26,
                emaTrend: currentEMATrend,
                sma20: currentSMA20,
                atr: currentATR,
                volume: {
                    current: currentVolume,
                    average: avgVolume,
                    ratio: volumeRatio
                }
            };
            
        } catch (error) {
            console.error('计算技术指标时出错:', error);
            return null;
        }
    }
    
    /**
     * 分析RSI信号
     */
    analyzeRSISignal(rsi: number): IndicatorSignal {
        let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let strength = 0;
        let confidence = 0;
        let reason = '';
        
        const overbought = config.indicators.rsi.overbought || 70;
        const oversold = config.indicators.rsi.oversold || 30;
        const strongBand = 10; // 强信号带宽
        
        if (rsi <= Math.max(0, oversold - strongBand)) {
            signal = 'BUY';
            strength = Math.max(0.5, (Math.max(0, oversold - strongBand) - rsi) / Math.max(1, oversold));
            confidence = 0.8;
            reason = `RSI强势超卖(${rsi.toFixed(2)} <= ${Math.max(0, oversold - strongBand)})，强烈买入信号`;
        } else if (rsi < oversold) {
            signal = 'BUY';
            strength = (oversold - rsi) / Math.max(1, oversold - (oversold - strongBand));
            confidence = 0.6;
            reason = `RSI偏低(${rsi.toFixed(2)} < ${oversold})，买入信号`;
        } else if (rsi >= Math.min(100, overbought + strongBand)) {
            signal = 'SELL';
            strength = -Math.max(0.5, (rsi - Math.min(100, overbought + strongBand)) / Math.max(1, 100 - overbought));
            confidence = 0.8;
            reason = `RSI强势超买(${rsi.toFixed(2)} >= ${Math.min(100, overbought + strongBand)})，强烈卖出信号`;
        } else if (rsi > overbought) {
            signal = 'SELL';
            strength = -(rsi - overbought) / Math.max(1, (overbought + strongBand) - overbought);
            confidence = 0.6;
            reason = `RSI偏高(${rsi.toFixed(2)} > ${overbought})，卖出信号`;
        } else {
            reason = `RSI中性区域(${rsi.toFixed(2)})，持有`;
        }
        
        return {
            indicator: 'RSI',
            signal,
            strength,
            confidence,
            reason
        };
    }
    
    /**
     * 分析MACD信号
     */
    analyzeMACDSignal(macd: { macd: number; signal: number; histogram: number }): IndicatorSignal {
        let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let strength = 0;
        let confidence = 0;
        let reason = '';
        
        const { macd: macdLine, signal: signalLine, histogram } = macd;
        
        // 金叉死叉判断
        if (macdLine > signalLine && histogram > 0) {
            signal = 'BUY';
            strength = Math.min(1, Math.abs(histogram) / 100);
            confidence = 0.75;
            reason = `MACD金叉，柱状图为正(${histogram.toFixed(4)})，买入信号`;
        } else if (macdLine < signalLine && histogram < 0) {
            signal = 'SELL';
            strength = -Math.min(1, Math.abs(histogram) / 100);
            confidence = 0.75;
            reason = `MACD死叉，柱状图为负(${histogram.toFixed(4)})，卖出信号`;
        } else {
            reason = `MACD中性，柱状图(${histogram.toFixed(4)})，持有`;
        }
        
        return {
            indicator: 'MACD',
            signal,
            strength,
            confidence,
            reason
        };
    }
    
    /**
     * 分析布林带信号
     */
    analyzeBollingerSignal(bollinger: { upper: number; middle: number; lower: number }, currentPrice: number): IndicatorSignal {
        let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let strength = 0;
        let confidence = 0;
        let reason = '';
        
        const { upper, middle, lower } = bollinger;
        const bandWidth = upper - lower;
        const position = (currentPrice - lower) / bandWidth;
        
        if (currentPrice <= lower) {
            signal = 'BUY';
            strength = Math.min(1, (lower - currentPrice) / (bandWidth * 0.1));
            confidence = 0.7;
            reason = `价格触及布林带下轨(${lower.toFixed(2)})，超卖买入信号`;
        } else if (currentPrice >= upper) {
            signal = 'SELL';
            strength = -Math.min(1, (currentPrice - upper) / (bandWidth * 0.1));
            confidence = 0.7;
            reason = `价格触及布林带上轨(${upper.toFixed(2)})，超买卖出信号`;
        } else if (position < 0.2) {
            signal = 'BUY';
            strength = 0.3;
            confidence = 0.5;
            reason = `价格接近布林带下轨，偏买入信号`;
        } else if (position > 0.8) {
            signal = 'SELL';
            strength = -0.3;
            confidence = 0.5;
            reason = `价格接近布林带上轨，偏卖出信号`;
        } else {
            reason = `价格在布林带中轨附近(${position.toFixed(2)})，持有`;
        }
        
        return {
            indicator: 'Bollinger',
            signal,
            strength,
            confidence,
            reason
        };
    }
    
    /**
     * 分析KDJ信号
     */
    analyzeKDJSignal(kdj: { k: number; d: number; j: number }): IndicatorSignal {
        let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let strength = 0;
        let confidence = 0;
        let reason = '';
        
        const { k, d, j } = kdj;
        
        if (k < 20 && d < 20 && j < 20) {
            signal = 'BUY';
            strength = Math.max(0.5, (20 - Math.min(k, d, j)) / 20);
            confidence = 0.75;
            reason = `KDJ三线均在超卖区域(K:${k.toFixed(1)}, D:${d.toFixed(1)}, J:${j.toFixed(1)})，强烈买入信号`;
        } else if (k > 80 && d > 80 && j > 80) {
            signal = 'SELL';
            strength = -Math.max(0.5, (Math.max(k, d, j) - 80) / 20);
            confidence = 0.75;
            reason = `KDJ三线均在超买区域(K:${k.toFixed(1)}, D:${d.toFixed(1)}, J:${j.toFixed(1)})，强烈卖出信号`;
        } else if (k > d && k < 80) {
            signal = 'BUY';
            strength = 0.4;
            confidence = 0.6;
            reason = `KDJ金叉(K>D)，买入信号`;
        } else if (k < d && k > 20) {
            signal = 'SELL';
            strength = -0.4;
            confidence = 0.6;
            reason = `KDJ死叉(K<D)，卖出信号`;
        } else {
            reason = `KDJ中性区域(K:${k.toFixed(1)}, D:${d.toFixed(1)})，持有`;
        }
        
        return {
            indicator: 'KDJ',
            signal,
            strength,
            confidence,
            reason
        };
    }
    
    /**
     * 分析威廉指标信号
     */
    analyzeWilliamsSignal(williams: number): IndicatorSignal {
        let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let strength = 0;
        let confidence = 0;
        let reason = '';
        
        if (williams <= -80) {
            signal = 'BUY';
            strength = Math.max(0.5, (80 + williams) / -20);
            confidence = 0.7;
            reason = `威廉指标超卖区域(${williams.toFixed(2)})，买入信号`;
        } else if (williams >= -20) {
            signal = 'SELL';
            strength = -Math.max(0.5, (williams + 20) / 20);
            confidence = 0.7;
            reason = `威廉指标超买区域(${williams.toFixed(2)})，卖出信号`;
        } else {
            reason = `威廉指标中性区域(${williams.toFixed(2)})，持有`;
        }
        
        return {
            indicator: 'Williams',
            signal,
            strength,
            confidence,
            reason
        };
    }
    
    /**
     * 综合分析所有指标信号
     */
    analyzeAllSignals(): IndicatorSignal[] {
        const indicators = this.calculateAllIndicators();
        if (!indicators) {
            return [];
        }
        
        const currentPrice = this.klineData[this.klineData.length - 1]?.close || 0;
        
        return [
            this.analyzeRSISignal(indicators.rsi),
            this.analyzeMACDSignal(indicators.macd),
            this.analyzeBollingerSignal(indicators.bollinger, currentPrice),
            this.analyzeKDJSignal(indicators.kdj),
            this.analyzeWilliamsSignal(indicators.williams)
        ];
    }
    
    /**
     * 获取当前价格趋势
     */
    getPriceTrend(): { trend: 'UP' | 'DOWN' | 'SIDEWAYS'; strength: number; reason: string } {
        if (this.klineData.length < 20) {
            return { trend: 'SIDEWAYS', strength: 0, reason: '数据不足' };
        }
        
        const indicators = this.calculateAllIndicators();
        if (!indicators) {
            return { trend: 'SIDEWAYS', strength: 0, reason: '指标计算失败' };
        }
        
        const currentPrice = this.klineData[this.klineData.length - 1].close;
        const { ema12, ema26, sma20 } = indicators;
        
        let trendScore = 0;
        let reasons: string[] = [];
        
        // EMA趋势判断
        if (ema12 > ema26) {
            trendScore += 0.3;
            reasons.push('EMA12>EMA26(上升趋势)');
        } else {
            trendScore -= 0.3;
            reasons.push('EMA12<EMA26(下降趋势)');
        }
        
        // 价格与SMA关系
        if (currentPrice > sma20) {
            trendScore += 0.2;
            reasons.push('价格>SMA20');
        } else {
            trendScore -= 0.2;
            reasons.push('价格<SMA20');
        }
        
        // MACD趋势确认
        if (indicators.macd.histogram > 0) {
            trendScore += 0.2;
            reasons.push('MACD柱状图为正');
        } else {
            trendScore -= 0.2;
            reasons.push('MACD柱状图为负');
        }
        
        let trend: 'UP' | 'DOWN' | 'SIDEWAYS';
        if (trendScore > 0.3) {
            trend = 'UP';
        } else if (trendScore < -0.3) {
            trend = 'DOWN';
        } else {
            trend = 'SIDEWAYS';
        }
        
        return {
            trend,
            strength: Math.abs(trendScore),
            reason: reasons.join(', ')
        };
    }
}

export default TechnicalIndicatorAnalyzer;