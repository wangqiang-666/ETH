import { TechnicalIndicatorAnalyzer, TechnicalIndicatorResult } from '../indicators/technical-indicators';
import { MLAnalyzer, MLAnalysisResult, MarketData } from '../ml/ml-analyzer';
import { config } from '../config';
import { recommendationDatabase } from '../services/recommendation-database';
import type { MLSampleRecord } from '../services/recommendation-database';
import { logger } from '../utils/logger';
import { KronosClient, KronosForecast } from '../ml/kronos-client';

// 智能交易信号类型
export type SmartSignalType = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';

// 信号强度等级
export interface SignalStrength {
  technical: number; // 技术指标强度 0-100
  ml: number; // 机器学习强度 0-100
  combined: number; // 综合强度 0-100
  confidence: number; // 置信度 0-1
}

// 智能交易信号结果
export interface SmartSignalResult {
  signal: SmartSignalType;
  strength: SignalStrength;
  targetPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  positionSize: number; // 建议仓位大小 0-1
  timeframe: string;
  reasoning: {
    technical: string;
    ml: string;
    risk: string;
    final: string;
  };
  metadata: {
    timestamp: number;
    marketCondition: 'TRENDING' | 'RANGING' | 'VOLATILE';
    volatility: number;
    volume: 'HIGH' | 'MEDIUM' | 'LOW';
    momentum: 'STRONG' | 'WEAK' | 'NEUTRAL';
    // 新增：趋势方向与强度
    trendDirection?: 'UP' | 'DOWN' | 'SIDEWAYS';
    trendStrength?: number;
    // 新增：布林位置与带宽，用于策略过滤与风控
    bollingerPosition?: number; // 0-1，0=靠近下轨，1=靠近上轨
    bollingerBandwidth?: number; // (上轨-下轨)/中轨
    // 新增：Kronos 最近一次原始输出（诊断用途）
    kronos?: KronosForecast;
  };
}

// 市场状态分析
export interface MarketCondition {
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
  strength: number; // 趋势强度 0-100
  volatility: 'HIGH' | 'MEDIUM' | 'LOW';
  volume: 'HIGH' | 'MEDIUM' | 'LOW';
  phase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN';
}

// 智能信号分析器
export class SmartSignalAnalyzer {
  private technicalAnalyzer: TechnicalIndicatorAnalyzer;
  private mlAnalyzer: MLAnalyzer;
  private historicalData: MarketData[] = [];
  private lastAnalysis: SmartSignalResult | null = null;
  // 新增：记录最近一次市场价格，用于基于“价格”的指标计算（如布林带位置等）
  private lastMarketPrice: number | null = null;
  // 新增：Kronos 客户端
  private kronos: KronosClient | null = null;
  private lastKronos: KronosForecast | null = null;

  constructor() {
    this.technicalAnalyzer = new TechnicalIndicatorAnalyzer();
    this.mlAnalyzer = new MLAnalyzer();
    
    // Kronos 客户端：惰性实例化，仅当配置开启时实例化
    const kronosEnabled = !!((config as any)?.strategy?.kronos?.enabled);
    if (kronosEnabled) {
      try {
        this.kronos = new KronosClient();
      } catch (e) {
        console.warn('Kronos client initialization failed:', e);
        this.kronos = null;
      }
    }
  }

  // 新增：维护历史市场数据，用于ML分析与统计特征
  private updateHistoricalData(marketData: MarketData): void {
    try {
      if (!marketData || typeof marketData.timestamp !== 'number') {
        return;
      }
      const maxLen: number = ((config as any)?.strategy?.historyWindow as number) || 600;
      const n = this.historicalData.length;
      if (n > 0 && this.historicalData[n - 1].timestamp === marketData.timestamp) {
        // 同一时间戳的数据进行合并更新，避免重复
        this.historicalData[n - 1] = { ...this.historicalData[n - 1], ...marketData };
      } else {
        this.historicalData.push({
          symbol: marketData.symbol,
          price: Number(marketData.price),
          volume: Number(marketData.volume),
          timestamp: marketData.timestamp,
          high24h: Number(marketData.high24h),
          low24h: Number(marketData.low24h),
          change24h: Number(marketData.change24h),
          changeFromSodUtc8: marketData.changeFromSodUtc8 != null ? Number(marketData.changeFromSodUtc8) : undefined,
          open24hPrice: marketData.open24hPrice != null ? Number(marketData.open24hPrice) : undefined,
          sodUtc8Price: marketData.sodUtc8Price != null ? Number(marketData.sodUtc8Price) : undefined,
          fundingRate: marketData.fundingRate != null ? Number(marketData.fundingRate) : undefined,
          openInterest: marketData.openInterest != null ? Number(marketData.openInterest) : undefined,
          fgiScore: marketData.fgiScore != null ? Number(marketData.fgiScore) : undefined
        });
        // 确保按时间升序，便于窗口截断
        this.historicalData.sort((a, b) => a.timestamp - b.timestamp);
        // 控制内存占用与训练窗口长度
        if (this.historicalData.length > maxLen) {
          this.historicalData.splice(0, this.historicalData.length - maxLen);
        }
      }
    } catch (e) {
      console.warn('updateHistoricalData failed:', e);
    }
  }

  // 主要分析方法（单次撮合：输入最新 marketData 与 K线，输出综合信号）
  async analyzeSignal(
    marketData: MarketData,
    klineData: any[]
  ): Promise<SmartSignalResult> {
    try {
      // 1) 更新历史数据
      this.updateHistoricalData(marketData);
      this.lastMarketPrice = typeof marketData?.price === 'number' ? marketData.price : this.lastMarketPrice;
      logger.debug('AnalyzeSignal | price=%s high24h=%s low24h=%s vol=%s', String(marketData.price), String(marketData.high24h), String(marketData.low24h), String(marketData.volume));

      // 2) 补充K线
      klineData.forEach(kline => {
        this.technicalAnalyzer.addKlineData({
          timestamp: kline.timestamp,
          open: parseFloat(kline.open),
          high: parseFloat(kline.high),
          low: parseFloat(kline.low),
          close: parseFloat(kline.close),
          volume: parseFloat(kline.volume)
        });
      });

      // 2.5) Kronos 在线评分（安全超时与降级）
      const useKronos = !!((config as any)?.strategy?.kronos?.enabled);
      let kronosScore: KronosForecast | null = null;
      // 当禁用 Kronos 时，清空历史缓存，避免前端看到陈旧的 kronos 元数据
      if (!useKronos) {
        this.lastKronos = null;
      }
      // 惰性初始化 Kronos 客户端：允许运行时启用
      if (useKronos && !this.kronos) {
        try {
          this.kronos = new KronosClient();
        } catch (e) {
          console.warn('Kronos client lazy initialization failed:', e);
          this.kronos = null;
        }
      }
      if (useKronos && this.kronos) {
        try {
          const interval = String((config as any)?.strategy?.kronos?.interval || (config as any)?.strategy?.primaryInterval || '1H');
          // 将本地K线转换为OHLCV数组，确保已收盘顺序且裁剪长度
          const ohlcv = (this.technicalAnalyzer as any)?.klineData
            ? (this.technicalAnalyzer as any).klineData.map((k: any) => [k.timestamp, k.open, k.high, k.low, k.close, k.volume])
            : klineData.map((k: any) => [k.timestamp, Number(k.open), Number(k.high), Number(k.low), Number(k.close), Number(k.volume)]);
          kronosScore = await this.kronos.forecast({
            symbol: marketData.symbol || 'ETH-USDT-SWAP',
            interval,
            ohlcv
          });
          this.lastKronos = kronosScore;
        } catch (e) {
          console.warn('Kronos forecast failed:', e);
          kronosScore = null;
        }
      }

       // 3) 计算技术指标
       const technicalResult = this.technicalAnalyzer.calculateAllIndicators();
       if (!technicalResult) {
         logger.debug('TechnicalResult unavailable, using fallback');
         return this.getFallbackSignal(marketData);
       }
       logger.debug(
         'Indicators | rsi=%.2f macd.hist=%.4f bollPos~=%.2f bw~=%.4f ema12=%.2f emaTrend=%.2f k=%s d=%s williams=%s',
         technicalResult.rsi,
         technicalResult.macd?.histogram ?? 0,
         (() => {
           const range = technicalResult.bollinger.upper - technicalResult.bollinger.lower;
           const price = Number.isFinite(marketData.price) ? marketData.price : technicalResult.bollinger.middle;
           return range > 0 ? ((price - technicalResult.bollinger.lower) / range) : 0.5;
         })(),
         (() => {
           const mid = technicalResult.bollinger.middle;
           const range = technicalResult.bollinger.upper - technicalResult.bollinger.lower;
           const denom = Number.isFinite(mid) && mid > 0 ? mid : (Number.isFinite(marketData.price) && marketData.price > 0 ? marketData.price : NaN);
           return Number.isFinite(range) && Number.isFinite(denom) && denom > 0 ? (range / denom) : 0;
         })(),
         technicalResult.ema12 ?? 0,
         technicalResult.emaTrend ?? 0,
         String(technicalResult.kdj?.k ?? 'NA'),
         String(technicalResult.kdj?.d ?? 'NA'),
         String(technicalResult.williams ?? 'NA')
       );

       // 4) ML 分析
       let mlResult: MLAnalysisResult | null = null;
       if (config.strategy.useMLAnalysis && this.historicalData.length >= 20) {
         try {
           mlResult = await this.mlAnalyzer.analyze(
             marketData,
             technicalResult,
             this.historicalData
           );
           logger.debug('ML | prediction=%s conf=%.2f', mlResult?.prediction ?? 'NA', mlResult?.confidence ?? 0);
         } catch (error) {
           console.warn('ML analysis failed, using technical analysis only:', error);
         }
       }

       // 5) 市场状态分析
       const marketCondition = this.analyzeMarketCondition(marketData, technicalResult);
       logger.debug('Market | trend=%s strength=%.1f vol=%s phase=%s', marketCondition.trend, marketCondition.strength, marketCondition.volatility, marketCondition.phase);

       // 6) 多因子合成
       const smartSignal = this.combineSignals(
         technicalResult,
         mlResult,
         marketData,
         marketCondition,
         kronosScore // 将Kronos结果作为参数传递
       );
       logger.debug('Combine | tech=%.1f ml=%.1f combined=%.1f signal=%s', smartSignal.strength.technical, smartSignal.strength.ml, smartSignal.strength.combined, smartSignal.signal);

       // 7) 风险管理调整
       const finalSignal = this.applyRiskManagement(smartSignal, marketData, marketCondition);
       logger.debug('Final | signal=%s conf=%.2f posSize=%.2f tf=%s meta={trend:%s(%.1f), vol=%.2f, bollPos=%.2f, bw=%.4f}',
         finalSignal.signal,
         finalSignal.strength.confidence,
         finalSignal.positionSize,
         finalSignal.timeframe,
         finalSignal.metadata.trendDirection ?? 'NA',
         finalSignal.metadata.trendStrength ?? 0,
         finalSignal.metadata.volatility ?? 0,
         finalSignal.metadata.bollingerPosition ?? 0.5,
         finalSignal.metadata.bollingerBandwidth ?? 0
       );

       // 7.1) 记录训练样本
       try {
         await this.logMLSample(marketData, technicalResult, mlResult, finalSignal);
       } catch (e) {
         console.warn('Log ML sample failed:', e);
       }

       this.lastAnalysis = finalSignal;
       return finalSignal;

     } catch (error) {
       console.error('Smart signal analysis failed:', error);
       return this.getFallbackSignal(marketData);
     }
   }

   // 多因子合成信号
  private combineSignals(
    technicalResult: TechnicalIndicatorResult,
    mlResult: MLAnalysisResult | null,
    marketData: MarketData,
    marketCondition: MarketCondition,
    kronos?: KronosForecast | null
  ): SmartSignalResult {
     // 技术面强度
     const technicalStrength = this.calculateTechnicalStrength(technicalResult);
     
     // ML 强度（无结果则视为中性 50）
     const mlStrength = mlResult ? this.calculateMLStrength(mlResult) : 50;
     
     // Kronos 因子：将做多/做空分数映射为 [-100, 100] 的方向分值，并折算为 [0,100] 强度贡献
     let kronosStrength = 50; // 中性
     let kronosConfidence = 0.5;
     if (kronos) {
       const kcfg = (config as any)?.strategy?.kronos || {};
       const longThr = Number(kcfg.longThreshold ?? 0.62);
       const shortThr = Number(kcfg.shortThreshold ?? 0.62);
       const minConf = Number(kcfg.minConfidence ?? 0.55);
       const longS = Math.max(0, Math.min(1, Number(kronos.score_long)));
       const shortS = Math.max(0, Math.min(1, Number(kronos.score_short)));
       kronosConfidence = Math.max(0, Math.min(1, Number(kronos.confidence ?? 0.5)));
       const directional = (longS - shortS); // [-1,1]
       const strongDirectional = (longS >= longThr && directional > 0) || (shortS >= shortThr && directional < 0);
       // 仅当方向显著且置信度不低于阈值时才赋予方向性强度，否则视为中性
       kronosStrength = (strongDirectional && kronosConfidence >= minConf) ? (50 + directional * 50) : 50; // [0,100]
     }
     
     // 综合强度 = 技术面*权重 + ML*权重 + 市场状态*权重
     const weights = config.strategy.multiFactorWeights;
     // 扩展：将 Kronos 作为 ML 权重的一部分进行融合（不改变外层权重结构），按阈值与置信度门控
     const mlWithKronos = (() => {
       const kcfg = (config as any)?.strategy?.kronos || {};
       const alphaCap = Number.isFinite(kcfg.alphaMax) ? Math.max(0, Math.min(1, Number(kcfg.alphaMax))) : 0.6;
       const kronosEnabled = !!kcfg.enabled;
       if (!kronosEnabled || !kronos) return mlStrength;
       const minConf = Number(kcfg.minConfidence ?? 0.55);
       const longThr = Number(kcfg.longThreshold ?? 0.62);
       const shortThr = Number(kcfg.shortThreshold ?? 0.62);
       const l = Math.max(0, Math.min(1, Number(kronos.score_long)));
       const s = Math.max(0, Math.min(1, Number(kronos.score_short)));
       const dir = l - s; // [-1,1]
       const strongDirectional = (l >= longThr && dir > 0) || (s >= shortThr && dir < 0);
       const pass = (kronosConfidence >= minConf) && strongDirectional;
       const alphaRaw = pass ? Math.max(0.2, Math.min(0.8, kronosConfidence)) : 0; // 置信度驱动的融合占比
       const alpha = Math.min(alphaCap, alphaRaw); // 受 alphaMax 限制
       const kStrength = pass ? (50 + dir * 50) : 50;
       return mlStrength * (1 - alpha) + kStrength * alpha;
     })();
     
     let combinedStrength = (
       technicalStrength * weights.technical +
       mlWithKronos * weights.ml +
       this.getMarketConditionScore(marketCondition) * weights.market
     ) / (weights.technical + weights.ml + weights.market);

     // Kronos 一致性过滤：当与技术面强方向背离、且置信度较高时，适度降权（动态幅度）
     if (kronos) {
       try {
         const techDir = technicalStrength >= 55 ? 1 : technicalStrength <= 45 ? -1 : 0;
         const kcfg = (config as any)?.strategy?.kronos || {};
         const minConf = Number(kcfg.minConfidence ?? 0.55);
         const longThr = Number(kcfg.longThreshold ?? 0.62);
         const shortThr = Number(kcfg.shortThreshold ?? 0.62);
         const l = Math.max(0, Math.min(1, Number(kronos.score_long)));
         const s = Math.max(0, Math.min(1, Number(kronos.score_short)));
         const dir = l - s; // [-1,1]
         const kronosDir = dir >= 0 ? 1 : -1 as 1 | -1;
         const strongDir = (l >= longThr && dir > 0) || (s >= shortThr && dir < 0);
         const disagree = techDir !== 0 && strongDir && techDir !== kronosDir && (kronos.confidence ?? 0.5) >= minConf;
         if (disagree) {
           const conf = Math.max(0, Math.min(1, Number(kronos.confidence ?? 0.5)));
           const mag = Math.abs(dir); // 0-1
           const confNorm = minConf < 1 ? Math.max(0, (conf - minConf) / (1 - minConf)) : 0;
           const penalty = Math.min(12, 6 + 8 * confNorm * mag);
           combinedStrength = Math.max(0, combinedStrength - penalty);
         }
       } catch {}
     }

     // 确定最终信号
    const signal = this.determineSignal(technicalResult, mlResult, combinedStrength);
     
     // 计算价格目标（目标/止损/止盈/风报比）
     const priceTargets = this.calculatePriceTargets(
       marketData,
       signal,
       technicalResult,
       marketCondition
     );

     // 计算建议仓位
     const positionSize = this.calculatePositionSize(
       signal,
      combinedStrength,
       marketCondition,
      Math.max(mlResult?.confidence || 0.5, kronosConfidence || 0.5)
     );

     return {
       signal,
       strength: {
         technical: technicalStrength,
        ml: mlWithKronos,
         combined: combinedStrength,
        confidence: Math.max(
          mlResult?.confidence || 0,
          kronosConfidence || 0,
          this.calculateTechnicalConfidence(technicalResult)
        )
       },
       targetPrice: priceTargets.target,
       stopLoss: priceTargets.stopLoss,
       takeProfit: priceTargets.takeProfit,
       riskReward: priceTargets.riskReward,
       positionSize,
       timeframe: this.determineTimeframe(marketCondition),
       reasoning: {
         technical: this.generateTechnicalReasoning(technicalResult),
        ml: mlResult?.reasoning || 'ML analysis unavailable',
         risk: this.generateRiskReasoning(marketCondition, mlResult),
        final: this.generateFinalReasoning(signal, combinedStrength, marketCondition)
       },
       metadata: {
         timestamp: Date.now(),
         marketCondition: this.getMarketConditionType(marketCondition),
         volatility: marketCondition.volatility === 'HIGH' ? 0.8 : marketCondition.volatility === 'LOW' ? 0.2 : 0.5,
         volume: marketCondition.volume,
         momentum: this.getMomentumType(technicalResult),
         // 新增：趋势方向与强度
         trendDirection: marketCondition.trend === 'UPTREND' ? 'UP' : marketCondition.trend === 'DOWNTREND' ? 'DOWN' : 'SIDEWAYS',
         trendStrength: marketCondition.strength,
         // 新增：布林带位置/带宽（优先使用实时价格，带边界控制与有限值检查）
         bollingerPosition: (() => {
           const range = technicalResult.bollinger.upper - technicalResult.bollinger.lower;
           const price = Number.isFinite(marketData.price) ? marketData.price : technicalResult.bollinger.middle;
           return range > 0 ? ((price - technicalResult.bollinger.lower) / range) : 0.5;
         })(),
         bollingerBandwidth: (() => {
           const mid = technicalResult.bollinger.middle;
           const range = technicalResult.bollinger.upper - technicalResult.bollinger.lower;
           const denom = Number.isFinite(mid) && mid > 0 ? mid : (Number.isFinite(marketData.price) && marketData.price > 0 ? marketData.price : NaN);
           return Number.isFinite(range) && Number.isFinite(denom) && denom > 0 ? (range / denom) : 0;
         })(),
        // 在兜底结果中也附带最近一次 Kronos 诊断输出（如有）
        kronos: ((config as any)?.strategy?.kronos?.enabled) ? (this.lastKronos || undefined) : undefined
       }
     };
   }

  // 计算技术指标强度（带门控与开关）
  private calculateTechnicalStrength(indicators: TechnicalIndicatorResult): number {
    let score = 50; // 基础分数

    // 振荡器开关
    const osc = (config as any)?.strategy?.oscillators || {};

    // RSI 评分（使用配置阈值）
    const overbought = config.indicators.rsi.overbought;
    const oversold = config.indicators.rsi.oversold;
    const mid = (overbought + oversold) / 2;
    const neutralLow = mid - 5;
    const neutralHigh = mid + 5;

    if (indicators.rsi <= oversold) score += 20; // 超卖
    else if (indicators.rsi >= overbought) score -= 20; // 超买
    else if (indicators.rsi >= neutralLow && indicators.rsi <= neutralHigh) score += 5; // 中性区间（±5）

    // MACD 评分
    if (indicators.macd.histogram > 0) {
      score += indicators.macd.histogram > 0.001 ? 15 : 10;
    } else {
      score -= Math.abs(indicators.macd.histogram) > 0.001 ? 15 : 10;
    }

    // 布林带评分（优先使用实时价格，回退中轨以避免 NaN）
    const bollingerRange = indicators.bollinger.upper - indicators.bollinger.lower;
    if (bollingerRange > 0) {
      const currentPrice = (typeof this.lastMarketPrice === 'number') ? this.lastMarketPrice : indicators.bollinger.middle;
      const position = (currentPrice - indicators.bollinger.lower) / bollingerRange;
      if (position < 0.2) score += 15; // 靠近下轨
      else if (position > 0.8) score -= 15; // 靠近上轨
    }

    // KDJ 评分（受开关控制，默认不加分）
    if (osc.useKDJ) {
      if (indicators.kdj.k > indicators.kdj.d && indicators.kdj.k < 80) score += 8;
      else if (indicators.kdj.k < indicators.kdj.d && indicators.kdj.k > 20) score -= 8;
    }

    // 威廉指标评分（受开关控制，默认不加分）
    if (osc.useWilliams) {
      if (indicators.williams < -80) score += 6; // 超卖
      else if (indicators.williams > -20) score -= 6; // 超买
    }

    // 新增：EMA 趋势评分（短期 EMA 相对趋势 EMA）
    if (typeof indicators.ema12 === 'number' && typeof indicators.emaTrend === 'number') {
      if (indicators.ema12 > indicators.emaTrend) score += 10; // 趋势向上
      else if (indicators.ema12 < indicators.emaTrend) score -= 10; // 趋势向下
    }

    // 门控：ADX/量能/波动
    try {
      const gate = (config as any)?.strategy?.gating || {};
      // ADX 门控：趋势类加分仅在 ADX 达标时生效；否则降低趋势加分的权重
      if (gate.adx?.enabled) {
        const adx = Number(indicators.adx ?? 0);
        const adxMin = Number(gate.adx.min ?? (config as any)?.indicators?.adx?.strong ?? 25);
        if (!Number.isFinite(adx) || adx < adxMin) {
          // 撤销部分趋势类加分（EMA、布林位置）
          score = 50 + (score - 50) * 0.6; // 降低偏移幅度
        }
      }
      // 量能确认：OBV 斜率和量比不足，整体降权
      if (gate.volume?.enabled) {
        const obvSlope = Number(indicators.obv?.slope ?? 0);
        const vr = Number(indicators.volume?.ratio ?? 1);
        const slopeMin = Number(gate.volume.obvSlopeMin ?? 0);
        const vrMin = Number(gate.volume.volumeRatioMin ?? 0.7);
        if (obvSlope < slopeMin || vr < vrMin) {
          score = 50 + (score - 50) * 0.7;
        }
      }
      // 波动门控：ATR%过低或挤压时抑制入场倾向
      if (gate.volatility?.enabled) {
        const price = (typeof this.lastMarketPrice === 'number') ? this.lastMarketPrice : Number(indicators.bollinger?.middle ?? 0);
        const atr = Number(indicators.atr ?? 0);
        const atrPct = (Number.isFinite(price) && price > 0) ? (atr / price) : 0;
        const atrMin = Number(gate.volatility.atrPctMin ?? 0.005);
        const squeezeBlock = !!gate.volatility.squeezeBlock;
        const inSqueeze = !!indicators.squeeze;
        if ((atrPct > 0 && atrPct < atrMin) || (squeezeBlock && inSqueeze)) {
          score = 50 + (score - 50) * 0.6;
        }
      }
    } catch {}

    return Math.max(0, Math.min(100, score));
  }

  // 计算机器学习强度
  private calculateMLStrength(mlResult: MLAnalysisResult): number {
    const signalMap: { [key in MLAnalysisResult['prediction']]: number } = {
      'STRONG_BUY': 90,
      'BUY': 70,
      'HOLD': 50,
      'SELL': 30,
      'STRONG_SELL': 10
    };

    const baseScore = signalMap[mlResult.prediction];
    const confidenceAdjustment = (mlResult.confidence - 0.5) * 20;
    
    return Math.max(0, Math.min(100, baseScore + confidenceAdjustment));
  }

  // 新增：市场状态分析（趋势/强度/波动/成交量/阶段）
  private analyzeMarketCondition(
    marketData: MarketData,
    technicalResult: TechnicalIndicatorResult
  ): MarketCondition {
    // 波动性：优先使用布林带带宽 (upper-lower)/middle，回退用 24h 高低波幅
    const mid = Number(technicalResult.bollinger?.middle);
    const upper = Number(technicalResult.bollinger?.upper);
    const lower = Number(technicalResult.bollinger?.lower);
    const bbRange = (Number.isFinite(upper) && Number.isFinite(lower)) ? (upper - lower) : 0;
    let bandwidth = (Number.isFinite(bbRange) && bbRange > 0 && Number.isFinite(mid) && mid > 0)
      ? (bbRange / mid)
      : 0;

    if (!Number.isFinite(bandwidth) || bandwidth <= 0) {
      const price = Number(marketData.price);
      const hi = Number(marketData.high24h);
      const lo = Number(marketData.low24h);
      const denom = Number.isFinite(price) && price > 0 ? price : (Number.isFinite(mid) && mid > 0 ? mid : 1);
      if (Number.isFinite(hi) && Number.isFinite(lo) && denom > 0) {
        bandwidth = (hi - lo) / denom;
      } else {
        bandwidth = 0;
      }
    }

    let volatility: 'HIGH' | 'MEDIUM' | 'LOW';
    if (bandwidth >= 0.08) volatility = 'HIGH';
    else if (bandwidth >= 0.03) volatility = 'MEDIUM';
    else volatility = 'LOW';

    // 趋势方向：结合 EMA 与 MACD 直方图
    const ema12 = Number(technicalResult.ema12);
    const emaTrend = Number(technicalResult.emaTrend);
    const macdHist = Number(technicalResult.macd?.histogram);

    let trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' = 'SIDEWAYS';
    if (Number.isFinite(ema12) && Number.isFinite(emaTrend) && Number.isFinite(macdHist)) {
      if (ema12 > emaTrend && macdHist > 0) trend = 'UPTREND';
      else if (ema12 < emaTrend && macdHist < 0) trend = 'DOWNTREND';
      else trend = 'SIDEWAYS';
    }

    // 趋势强度：EMA 偏离 + MACD 动量综合（0-100）
    let strength = 50;
    let emaStrength = 0;
    if (Number.isFinite(ema12) && Number.isFinite(emaTrend) && Math.abs(emaTrend) > 1e-8) {
      const ratio = Math.min(0.1, Math.abs((ema12 - emaTrend) / emaTrend)); // 截断 10%
      emaStrength = (ratio / 0.1) * 60; // 占比 60 分
    }
    const macdAbs = Number.isFinite(macdHist) ? Math.min(Math.abs(macdHist), 0.005) : 0; // 截断
    const macdStrength = (macdAbs / 0.005) * 40; // 占比 40 分
    strength = Math.max(0, Math.min(100, emaStrength + macdStrength));

    // 成交量强弱：与近期均量对比
    let volume: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
    const recent = this.historicalData.slice(-60);
    const vols = recent.map(d => Number(d.volume)).filter(v => Number.isFinite(v) && v > 0);
    const curVol = Number(marketData.volume);
    if (vols.length >= 10 && Number.isFinite(curVol)) {
      const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
      if (avg > 0) {
        if (curVol >= avg * 1.5) volume = 'HIGH';
        else if (curVol <= avg * 0.6) volume = 'LOW';
        else volume = 'MEDIUM';
      }
    }

    // 市场阶段：结合趋势与波动性
    let phase: MarketCondition['phase'] = 'ACCUMULATION';
    if (trend === 'UPTREND') phase = 'MARKUP';
    else if (trend === 'DOWNTREND') phase = 'MARKDOWN';
    else phase = (volatility === 'HIGH') ? 'DISTRIBUTION' : 'ACCUMULATION';

    return { trend, strength, volatility, volume, phase };
  }

  // 获取市场状态评分
  private getMarketConditionScore(condition: MarketCondition): number {
    let score = 50;

    // 趋势评分
    if (condition.trend === 'UPTREND') score += condition.strength * 0.3;
    else if (condition.trend === 'DOWNTREND') score -= condition.strength * 0.3;

    // 阶段评分
    switch (condition.phase) {
      case 'ACCUMULATION': score += 20; break;
      case 'MARKUP': score += 10; break;
      case 'DISTRIBUTION': score -= 20; break;
      case 'MARKDOWN': score -= 10; break;
    }

    // 波动性调整
    if (condition.volatility === 'HIGH') score -= 10;
    else if (condition.volatility === 'LOW') score += 5;

    return Math.max(0, Math.min(100, score));
  }

  // 确定最终信号
  private determineSignal(
    technicalResult: TechnicalIndicatorResult,
    mlResult: MLAnalysisResult | null,
    combinedStrength: number
  ): SmartSignalType {
    // 如有 ML 结果且置信度高，优先采用 ML 信号
    if (mlResult && mlResult.confidence > 0.7) {
      return mlResult.prediction;
    }

    // 基于综合强度确定信号
    if (combinedStrength >= 80) return 'STRONG_BUY';
    if (combinedStrength >= 65) return 'BUY';
    if (combinedStrength <= 20) return 'STRONG_SELL';
    if (combinedStrength <= 35) return 'SELL';
    return 'HOLD';
  }

  // 计算价格目标
  private calculatePriceTargets(
    marketData: MarketData,
    signal: SmartSignalType,
    indicators: TechnicalIndicatorResult,
    condition: MarketCondition
  ): {
    target: number;
    stopLoss: number;
    takeProfit: number;
    riskReward: number;
  } {
    const currentPrice = marketData.price;
    const atr = indicators.atr || (marketData.high24h - marketData.low24h);
    
    // 基于信号类型与市场条件调整系数
    let targetMultiplier = 1;
    let stopMultiplier = 0.5;
    
    // 根据信号强度调整
    switch (signal) {
      case 'STRONG_BUY':
        targetMultiplier = condition.volatility === 'HIGH' ? 3 : 2;
        stopMultiplier = 1;
        break;
      case 'BUY':
        targetMultiplier = condition.volatility === 'HIGH' ? 2 : 1.5;
        stopMultiplier = 0.75;
        break;
      case 'STRONG_SELL':
        targetMultiplier = condition.volatility === 'HIGH' ? -3 : -2;
        stopMultiplier = 1;
        break;
      case 'SELL':
        targetMultiplier = condition.volatility === 'HIGH' ? -2 : -1.5;
        stopMultiplier = 0.75;
        break;
      default:
        targetMultiplier = 0;
        stopMultiplier = 0.5;
    }

    // 根据趋势强度调整
    if (condition.strength > 50) {
      targetMultiplier *= 1.2;
    }

    const target = currentPrice + (atr * targetMultiplier);
    const stopLoss = signal.includes('BUY')
      ? currentPrice - (atr * stopMultiplier)
      : currentPrice + (atr * stopMultiplier);
    
    const takeProfit = signal.includes('BUY')
      ? currentPrice + (atr * targetMultiplier * 0.7)
      : currentPrice - (atr * Math.abs(targetMultiplier) * 0.7);

    const riskReward = Math.abs(target - currentPrice) / Math.abs(stopLoss - currentPrice);

    return {
      target,
      stopLoss,
      takeProfit,
      riskReward
    };
  }

  // 计算建议仓位
  private calculatePositionSize(
    signal: SmartSignalType,
    strength: number,
    condition: MarketCondition,
    confidence: number
  ): number {
    if (signal === 'HOLD') return 0;

    let baseSize = 0.1; // 基础仓位 10%

    // 根据信号强度调整
    if (signal.includes('STRONG')) {
      baseSize = 0.2;
    }

    // 根据置信度调整
    baseSize *= confidence;

    // 根据市场条件调整
    if (condition.volatility === 'HIGH') {
      baseSize *= 0.7; // 高波动时降低仓位
    } else if (condition.volatility === 'LOW') {
      baseSize *= 1.2; // 低波动时适度增加仓位
    }

    // 根据趋势强度微调
    if (condition.strength > 70) {
      baseSize *= 1.1;
    }

    return Math.max(0.01, Math.min(0.3, baseSize)); // 限制在 1%-30% 之间
  }

  // 辅助方法
  private calculateTechnicalConfidence(indicators: TechnicalIndicatorResult): number {
    let confidence = 0.5;

    // 计算布林带位置（优先使用实时价格，回退到中轨）
    const bollingerRange = indicators.bollinger.upper - indicators.bollinger.lower;
    const currentPrice = (typeof this.lastMarketPrice === 'number') ? this.lastMarketPrice : indicators.bollinger.middle;
    const bollingerPosition = bollingerRange > 0 ? (currentPrice - indicators.bollinger.lower) / bollingerRange : 0.5;

    // 多个指标同向时提高置信度
    const osc = (config as any)?.strategy?.oscillators || {};
    const bullishSignals = [
      indicators.rsi < 30,
      indicators.macd.histogram > 0,
      bollingerPosition < 0.3,
      osc.useKDJ ? (indicators.kdj.k > indicators.kdj.d) : false,
      osc.useWilliams ? (indicators.williams < -80) : false
    ].filter(Boolean).length;

    const bearishSignals = [
      indicators.rsi > 70,
      indicators.macd.histogram < 0,
      bollingerPosition > 0.7,
      osc.useKDJ ? (indicators.kdj.k < indicators.kdj.d) : false,
      osc.useWilliams ? (indicators.williams > -20) : false
    ].filter(Boolean).length;

    const maxSignals = Math.max(bullishSignals, bearishSignals);
    confidence += maxSignals * 0.1;

    return Math.min(0.9, confidence);
  }

  private determineTimeframe(condition: MarketCondition): string {
    if (condition.volatility === 'HIGH') return 'Short-term (1-4h)';
    if (condition.trend !== 'SIDEWAYS' && condition.strength > 50) return 'Medium-term (1-3d)';
    return 'Intraday (15m-1h)';
  }

  private getMarketConditionType(condition: MarketCondition): 'TRENDING' | 'RANGING' | 'VOLATILE' {
    if (condition.volatility === 'HIGH') return 'VOLATILE';
    if (condition.trend === 'SIDEWAYS') return 'RANGING';
    return 'TRENDING';
  }

  private getMomentumType(indicators: TechnicalIndicatorResult): 'STRONG' | 'WEAK' | 'NEUTRAL' {
    const momentum = Math.abs(indicators.macd.histogram);
    if (momentum > 0.002) return 'STRONG';
    if (momentum < 0.0005) return 'WEAK';
    return 'NEUTRAL';
  }

  // 生成技术面说明
  private generateTechnicalReasoning(indicators: TechnicalIndicatorResult): string {
    const reasons: string[] = [];

    if (indicators.rsi < 30) reasons.push('RSI indicates oversold');
    else if (indicators.rsi > 70) reasons.push('RSI indicates overbought');

    if (indicators.macd.histogram > 0) reasons.push('MACD histogram positive (bullish momentum)');
    else if (indicators.macd.histogram < 0) reasons.push('MACD histogram negative (bearish momentum)');

    const bollingerRange = indicators.bollinger.upper - indicators.bollinger.lower;
    if (bollingerRange > 0) {
      const currentPrice = (typeof this.lastMarketPrice === 'number') ? this.lastMarketPrice : indicators.bollinger.middle;
      const position = (currentPrice - indicators.bollinger.lower) / bollingerRange;
      if (position < 0.2) reasons.push('Price near lower Bollinger band');
      else if (position > 0.8) reasons.push('Price near upper Bollinger band');
    }

    return reasons.length > 0 ? reasons.join('; ') : 'Technical indicators are neutral';
  }

  private generateRiskReasoning(condition: MarketCondition, mlResult: MLAnalysisResult | null): string {
    const risks: string[] = [];

    if (condition.volatility === 'HIGH') risks.push('High market volatility');
    if (condition.volume === 'LOW') risks.push('Low trading volume');
    if (mlResult && mlResult.riskScore > 7) risks.push('Model indicates elevated risk');

    return risks.length > 0 ? `Risk factors: ${risks.join('; ')}` : 'Risk level is neutral';
  }

  private generateFinalReasoning(
    signal: SmartSignalType,
    strength: number,
    condition: MarketCondition
  ): string {
    const trendDesc = {
      UPTREND: 'uptrend',
      DOWNTREND: 'downtrend',
      SIDEWAYS: 'range'
    }[condition.trend];

    return `Combined analysis suggests ${signal} (strength ${strength.toFixed(1)}). Current market is in ${trendDesc}. Consider prudent execution.`;
  }

  // 风险管理调整
  private applyRiskManagement(
    signal: SmartSignalResult,
    marketData: MarketData,
    condition: MarketCondition
  ): SmartSignalResult {
    // 高波动时降低仓位
    if (condition.volatility === 'HIGH') {
      signal.positionSize *= 0.7;
    }

    // 低成交量时降低信号强度/置信度
    if (condition.volume === 'LOW') {
      signal.strength.combined *= 0.8;
      signal.strength.confidence *= 0.9;
    }

    // 确保风报比合理
    if (signal.riskReward < 1.5 && signal.signal !== 'HOLD') {
      signal.positionSize *= 0.5;
    }

    return signal;
  }

  // 兜底信号
  private getFallbackSignal(marketData: MarketData): SmartSignalResult {
    const useKronos = !!((config as any)?.strategy?.kronos?.enabled);
    return {
      signal: 'HOLD',
      strength: {
        technical: 50,
        ml: 50,
        combined: 50,
        confidence: 0.3
      },
      targetPrice: marketData.price,
      stopLoss: marketData.price * 0.98,
      takeProfit: marketData.price * 1.02,
      riskReward: 1,
      positionSize: 0,
      timeframe: 'Watch',
      reasoning: {
        technical: 'Technical analysis failed',
        ml: 'ML analysis unavailable',
        risk: 'System error encountered',
        final: 'Analysis system experienced an issue; suggest staying on the sidelines'
      },
      metadata: {
        timestamp: Date.now(),
        marketCondition: 'RANGING',
        volatility: 0.5,
        volume: 'MEDIUM',
        momentum: 'NEUTRAL',
        // 在兜底结果中也附带最近一次 Kronos 诊断输出（如有）
        kronos: ((config as any)?.strategy?.kronos?.enabled) ? (this.lastKronos || undefined) : undefined
       }
     };
   }

  // 获取最近的分析结果
  getLastAnalysis(): SmartSignalResult | null {
    return this.lastAnalysis;
  }

  // 获取历史数据统计
  getHistoricalStats(): {
    dataPoints: number;
    avgPrice: number;
    volatility: number;
    trend: string;
  } {
    if (this.historicalData.length === 0) {
      return {
        dataPoints: 0,
        avgPrice: 0,
        volatility: 0,
        trend: 'UNKNOWN'
      };
    }

    const prices = this.historicalData.map(d => d.price);
    const avgPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    
    const volatility = returns.length > 0 
      ? Math.sqrt(returns.reduce((sum, ret) => sum + ret * ret, 0) / returns.length)
      : 0;

    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const trend = lastPrice > firstPrice * 1.02 ? 'UPTREND' 
      : lastPrice < firstPrice * 0.98 ? 'DOWNTREND' 
      : 'SIDEWAYS';

    return {
      dataPoints: this.historicalData.length,
      avgPrice,
      volatility,
      trend
    };
  }

  // 新增：稳健的 ML 样本记录（异步、容错）
  private async logMLSample(
    marketData: MarketData,
    technicalResult: TechnicalIndicatorResult,
    mlResult: MLAnalysisResult | null,
    result: SmartSignalResult
  ): Promise<void> {
    try {
      await recommendationDatabase.initialize();
  
      const featuresPayload: any = {
        fgiScore: marketData.fgiScore ?? null,
        fundingRate: marketData.fundingRate ?? null,
        openInterest: marketData.openInterest ?? null,
        change24h: marketData.change24h,
        changeFromSodUtc8: marketData.changeFromSodUtc8 ?? null
      };
      if (mlResult?.features) {
        featuresPayload.ml = mlResult.features;
      }
  
      const sample: MLSampleRecord = {
        timestamp: typeof marketData.timestamp === 'number' ? marketData.timestamp : Date.now(),
        symbol: marketData.symbol || config.trading.defaultSymbol,
        interval: config.strategy.primaryInterval,
        price: marketData.price,
        features_json: (() => { try { return JSON.stringify(featuresPayload); } catch { return undefined as any; } })(),
        indicators_json: (() => { try { return JSON.stringify(technicalResult); } catch { return undefined as any; } })(),
        ml_prediction: mlResult?.prediction,
        ml_confidence: mlResult?.confidence,
        technical_strength: result?.strength?.technical ?? null,
        combined_strength: result?.strength?.combined ?? null,
        final_signal: result?.signal ?? null,
        position_size: result?.positionSize ?? null,
        target_price: result?.targetPrice ?? null,
        stop_loss: result?.stopLoss ?? null,
        take_profit: result?.takeProfit ?? null,
        risk_reward: result?.riskReward ?? null,
        reasoning_ml: mlResult?.reasoning ?? undefined,
        reasoning_final: result?.reasoning?.final ?? undefined,
        label_horizon_min: (config as any)?.ml?.training?.labelHorizonMinutes ?? 60,
        label_return: null,
        label_drawdown: null,
        label_ready: false
      };

      await recommendationDatabase.saveMLSample(sample);
    } catch (err) {
      console.warn('logMLSample failed:', err);
    }
  }

}

// 导出单例，供其他模块复用
export const smartSignalAnalyzer = new SmartSignalAnalyzer();