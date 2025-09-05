import { TechnicalIndicatorAnalyzer, TechnicalIndicatorResult } from '../indicators/technical-indicators';
import { MLAnalyzer, MLAnalysisResult, MarketData } from '../ml/ml-analyzer';
import { config } from '../config';
import { recommendationDatabase } from '../services/recommendation-database';
import type { MLSampleRecord } from '../services/recommendation-database';

// 鏅鸿兘浜ゆ槗淇″彿绫诲瀷
export type SmartSignalType = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';

// 淇″彿寮哄害绛夌骇
export interface SignalStrength {
  technical: number; // 鎶€鏈寚鏍囧己搴?0-100
  ml: number; // 鏈哄櫒瀛︿範寮哄害 0-100
  combined: number; // 缁煎悎寮哄害 0-100
  confidence: number; // 缃俊搴?0-1
}

// 鏅鸿兘浜ゆ槗淇″彿缁撴灉
export interface SmartSignalResult {
  signal: SmartSignalType;
  strength: SignalStrength;
  targetPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  positionSize: number; // 寤鸿浠撲綅澶у皬 0-1
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
    // 鏂板锛氳秼鍔挎柟鍚戜笌寮哄害
    trendDirection?: 'UP' | 'DOWN' | 'SIDEWAYS';
    trendStrength?: number;
    // 鏂板锛氬竷鏋楀甫浣嶇疆涓庡甫瀹斤紝渚涚瓥鐣ュ眰杩囨护涓庨闄╂帶鍒?
    bollingerPosition?: number; // 0-1锛?闈犺繎涓嬭建锛?闈犺繎涓婅建
    bollingerBandwidth?: number; // (涓?涓?/涓?
  };
}

// 甯傚満鐘舵€佸垎鏋?
export interface MarketCondition {
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
  strength: number; // 瓒嬪娍寮哄害 0-100
  volatility: 'HIGH' | 'MEDIUM' | 'LOW';
  volume: 'HIGH' | 'MEDIUM' | 'LOW';
  phase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN';
}

// 鏅鸿兘淇″彿鍒嗘瀽鍣?
export class SmartSignalAnalyzer {
  private technicalAnalyzer: TechnicalIndicatorAnalyzer;
  private mlAnalyzer: MLAnalyzer;
  private historicalData: MarketData[] = [];
  private lastAnalysis: SmartSignalResult | null = null;
  // 鏂板锛氳褰曟渶杩戜竴娆″競鍦轰环鏍硷紝鐢ㄤ簬BOLL浣嶇疆绛夊熀浜庘€滀环鏍尖€濈殑璁＄畻
  private lastMarketPrice: number | null = null;

  constructor() {
    this.technicalAnalyzer = new TechnicalIndicatorAnalyzer();
    this.mlAnalyzer = new MLAnalyzer();
  }

  // 涓昏鍒嗘瀽鏂规硶
  async analyzeSignal(
    marketData: MarketData,
    klineData: any[]
  ): Promise<SmartSignalResult> {
    try {
      // 1. 鏇存柊鍘嗗彶鏁版嵁
      this.updateHistoricalData(marketData);
      // 1.1 璁板綍褰撳墠浠锋牸渚汢OLL浣嶇疆绛夎绠椾娇鐢?
      this.lastMarketPrice = typeof marketData?.price === 'number' ? marketData.price : this.lastMarketPrice;

      // 2. 鏇存柊K绾挎暟鎹埌鎶€鏈寚鏍囧垎鏋愬櫒
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

      // 3. 璁＄畻鎶€鏈寚鏍?
      const technicalResult = this.technicalAnalyzer.calculateAllIndicators();
      if (!technicalResult) {
        return this.getFallbackSignal(marketData);
      }

      // 4. 鏈哄櫒瀛︿範鍒嗘瀽
      let mlResult: MLAnalysisResult | null = null;
      if (config.strategy.useMLAnalysis && this.historicalData.length >= 20) {
        try {
          mlResult = await this.mlAnalyzer.analyze(
            marketData,
            technicalResult,
            this.historicalData
          );
        } catch (error) {
          console.warn('ML analysis failed, using technical analysis only:', error);
        }
      }

      // 5. 甯傚満鐘舵€佸垎鏋?
      const marketCondition = this.analyzeMarketCondition(marketData, technicalResult);

      // 6. 缁煎悎淇″彿鍒嗘瀽
      const smartSignal = this.combineSignals(
        technicalResult,
        mlResult,
        marketData,
        marketCondition
      );

      // 7. 椋庨櫓绠＄悊璋冩暣
      const finalSignal = this.applyRiskManagement(smartSignal, marketData, marketCondition);

      // 7.1 鏍锋湰钀藉簱锛堝紓姝ワ紝涓嶉樆濉炰富娴佺▼锛?
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

  // 鏇存柊鍘嗗彶鏁版嵁
  private updateHistoricalData(marketData: MarketData): void {
    this.historicalData.push(marketData);
    
    // 淇濇寔鏈€杩?000涓暟鎹偣
    if (this.historicalData.length > 1000) {
      this.historicalData = this.historicalData.slice(-1000);
    }
  }

  // 鍒嗘瀽甯傚満鐘舵€?
  private analyzeMarketCondition(
    marketData: MarketData,
    technicalResult: TechnicalIndicatorResult
  ): MarketCondition {
    // 瓒嬪娍鍒嗘瀽
    let trend: MarketCondition['trend'] = 'SIDEWAYS';
    let trendStrength = 0;

    // 鍩轰簬EMA瓒嬪娍绾夸笌浠锋牸銆佺煭鏈烢MA鍒ゆ柇瓒嬪娍
    if (technicalResult.emaTrend && technicalResult.ema12) {
      if (marketData.price > technicalResult.emaTrend && technicalResult.ema12 > technicalResult.emaTrend) {
        trend = 'UPTREND';
        trendStrength = Math.min(((marketData.price - technicalResult.emaTrend) / technicalResult.emaTrend) * 100, 100);
      } else if (marketData.price < technicalResult.emaTrend && technicalResult.ema12 < technicalResult.emaTrend) {
        trend = 'DOWNTREND';
        trendStrength = Math.min(((technicalResult.emaTrend - marketData.price) / technicalResult.emaTrend) * 100, 100);
      }
    }

    // 娉㈠姩鎬у垎鏋?
    const priceRange = marketData.high24h - marketData.low24h;
    const volatilityRatio = priceRange / marketData.price;
    let volatility: MarketCondition['volatility'] = 'MEDIUM';
    
    if (volatilityRatio > 0.05) volatility = 'HIGH';
    else if (volatilityRatio < 0.02) volatility = 'LOW';

    // 鎴愪氦閲忓垎鏋?
    let volume: MarketCondition['volume'] = 'MEDIUM';
    // 绠€鍖栫殑鎴愪氦閲忓垎鏋愶紝瀹為檯搴旇涓庡巻鍙插钩鍧囨瘮杈?
    if (marketData.volume > 1000000000) volume = 'HIGH';
    else if (marketData.volume < 100000000) volume = 'LOW';

    // 甯傚満闃舵鍒嗘瀽
    let phase: MarketCondition['phase'] = 'MARKUP';
    if (technicalResult.rsi < 30 && trend === 'DOWNTREND') {
      phase = 'ACCUMULATION';
    } else if (technicalResult.rsi > 70 && trend === 'UPTREND') {
      phase = 'DISTRIBUTION';
    } else if (trend === 'DOWNTREND' && technicalResult.rsi > 50) {
      phase = 'MARKDOWN';
    }

    return {
      trend,
      strength: trendStrength,
      volatility,
      volume,
      phase
    };
  }

  // 缁煎悎淇″彿鍒嗘瀽
  private combineSignals(
    technicalResult: TechnicalIndicatorResult,
    mlResult: MLAnalysisResult | null,
    marketData: MarketData,
    marketCondition: MarketCondition
  ): SmartSignalResult {
    // 鎶€鏈寚鏍囦俊鍙峰己搴?
    const technicalStrength = this.calculateTechnicalStrength(technicalResult);
    
    // 鏈哄櫒瀛︿範淇″彿寮哄害
    const mlStrength = mlResult ? this.calculateMLStrength(mlResult) : 50;
    
    // 缁煎悎淇″彿寮哄害璁＄畻
    const weights = config.strategy.multiFactorWeights;
    let combinedStrength = (
      technicalStrength * weights.technical +
      mlStrength * weights.ml +
      this.getMarketConditionScore(marketCondition) * weights.market
    ) / (weights.technical + weights.ml + weights.market);

    // 鏂板锛氬鏋滃瓨鍦ㄧ绾挎ā鍨嬶紝鍒欐牴鎹柟鍚戞€у井璋?combinedStrength 闃堝€?
    const offline = MLAnalyzer.getOfflineModel?.() || null;
    if (offline && offline.thresholds) {
      const thrLong = Number(offline.thresholds.long?.threshold);
      const thrShort = Number(offline.thresholds.short?.threshold);
      if (Number.isFinite(thrLong) && Number.isFinite(thrShort)) {
        // 鏍规嵁鎶€鏈潰鏂瑰悜鍊惧悜锛屽 combinedStrength 鍋氶潪绾挎€у鐩?鎶戝埗
        const directionalBias = (() => {
          // 绠€鍖栨柟鍚戝垽瀹氾細RSI涓嶮ACD
          const rsi = technicalResult.rsi;
          const macdHist = technicalResult.macd.histogram;
          let bias = 0;
          if (rsi <= config.indicators.rsi.oversold && macdHist > 0) bias += 1; // 鍋忓
          if (rsi >= config.indicators.rsi.overbought && macdHist < 0) bias -= 1; // 鍋忕┖
          return bias; // -1, 0, 1
        })();
        if (directionalBias > 0 && combinedStrength >= thrLong) {
          // 澶氬ご闃堝€煎懡涓紝鐣ュ井鎶崌寮哄害浠ラ紦鍔盉UY渚?
          combinedStrength = Math.min(100, combinedStrength + 5);
        } else if (directionalBias < 0 && combinedStrength >= thrShort) {
          // 绌哄ご闃堝€煎懡涓紝鐣ュ井鎶崌寮哄害浠ラ紦鍔盨ELL渚?
          combinedStrength = Math.min(100, combinedStrength + 5);
        }
      }
    }

    // 纭畾鏈€缁堜俊鍙?
    const signal = this.determineSignal(technicalResult, mlResult, combinedStrength);
    
    // 璁＄畻浠锋牸鐩爣
    const priceTargets = this.calculatePriceTargets(
      marketData,
      signal,
      technicalResult,
      marketCondition
    );

    // 璁＄畻寤鸿浠撲綅
    const positionSize = this.calculatePositionSize(
      signal,
      combinedStrength,
      marketCondition,
      mlResult?.confidence || 0.5
    );

    return {
      signal,
      strength: {
        technical: technicalStrength,
        ml: mlStrength,
        combined: combinedStrength,
        confidence: mlResult?.confidence || this.calculateTechnicalConfidence(technicalResult)
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
        // 鏂板锛氳秼鍔挎柟鍚戜笌寮哄害
        trendDirection: marketCondition.trend === 'UPTREND' ? 'UP' : marketCondition.trend === 'DOWNTREND' ? 'DOWN' : 'SIDEWAYS',
        trendStrength: marketCondition.strength,
        // 鏂板锛氬竷鏋楀甫浣嶇疆/甯﹀锛堜娇鐢ㄥ疄鏃朵环鏍硷紝绋冲仴閽冲埗涓庢湁闄愭€ф鏌ワ級
        bollingerPosition: (() => {
          const range = technicalResult.bollinger.upper - technicalResult.bollinger.lower;
          const price = Number.isFinite(marketData.price) ? marketData.price : technicalResult.bollinger.middle;
          if (!(Number.isFinite(range) && range > 0 && Number.isFinite(price))) return 0.5;
          const raw = (price - technicalResult.bollinger.lower) / range;
          const clamped = Math.max(0, Math.min(1, raw));
          return Number.isFinite(clamped) ? clamped : 0.5;
        })(),
        bollingerBandwidth: (() => {
          const mid = technicalResult.bollinger.middle;
          const range = technicalResult.bollinger.upper - technicalResult.bollinger.lower;
          const denom = Number.isFinite(mid) && mid > 0 ? mid : (Number.isFinite(marketData.price) && marketData.price > 0 ? marketData.price : NaN);
          if (!(Number.isFinite(range) && range >= 0 && Number.isFinite(denom) && denom > 0)) return 0;
          const bw = range / denom;
          return Number.isFinite(bw) ? bw : 0;
        })()
      }
    };
  }

  // 璁＄畻鎶€鏈寚鏍囧己搴?
  private calculateTechnicalStrength(indicators: TechnicalIndicatorResult): number {
    let score = 50; // 鍩虹鍒嗘暟

    // RSI璇勫垎锛堜娇鐢ㄩ厤缃槇鍊硷級
    const overbought = config.indicators.rsi.overbought;
    const oversold = config.indicators.rsi.oversold;
    const mid = (overbought + oversold) / 2;
    const neutralLow = mid - 5;
    const neutralHigh = mid + 5;

    if (indicators.rsi <= oversold) score += 20; // 瓒呭崠
    else if (indicators.rsi >= overbought) score -= 20; // 瓒呬拱
    else if (indicators.rsi >= neutralLow && indicators.rsi <= neutralHigh) score += 5; // 涓€у尯闂达紙卤5锛?

    // MACD璇勫垎
    if (indicators.macd.histogram > 0) {
      score += indicators.macd.histogram > 0.001 ? 15 : 10;
    } else {
      score -= Math.abs(indicators.macd.histogram) > 0.001 ? 15 : 10;
    }

    // 甯冩灄甯﹁瘎鍒嗭紙浣跨敤瀹炴椂浠锋牸浼樺厛锛屽叾娆″洖閫€鍒颁腑杞ㄤ互閬垮厤绌哄€硷級
    const bollingerRange = indicators.bollinger.upper - indicators.bollinger.lower;
    if (bollingerRange > 0) {
      const currentPrice = (typeof this.lastMarketPrice === 'number') ? this.lastMarketPrice : indicators.bollinger.middle;
      const position = (currentPrice - indicators.bollinger.lower) / bollingerRange;
      if (position < 0.2) score += 15; // 鎺ヨ繎涓嬭建
      else if (position > 0.8) score -= 15; // 鎺ヨ繎涓婅建
    }

    // KDJ璇勫垎
    if (indicators.kdj.k > indicators.kdj.d && indicators.kdj.k < 80) score += 10;
    else if (indicators.kdj.k < indicators.kdj.d && indicators.kdj.k > 20) score -= 10;

    // 濞佸粔鎸囨爣璇勫垎
    if (indicators.williams < -80) score += 10; // 瓒呭崠
    else if (indicators.williams > -20) score -= 10; // 瓒呬拱

    // 鏂板锛欵MA瓒嬪娍璇勫垎锛堢煭鏈烢MA鐩稿瓒嬪娍EMA锛?
    if (typeof indicators.ema12 === 'number' && typeof indicators.emaTrend === 'number') {
      if (indicators.ema12 > indicators.emaTrend) score += 10; // 瓒嬪娍鍚戜笂
      else if (indicators.ema12 < indicators.emaTrend) score -= 10; // 瓒嬪娍鍚戜笅
    }

    return Math.max(0, Math.min(100, score));
  }

  // 璁＄畻鏈哄櫒瀛︿範寮哄害
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

  // 鑾峰彇甯傚満鐘舵€佽瘎鍒?
  private getMarketConditionScore(condition: MarketCondition): number {
    let score = 50;

    // 瓒嬪娍璇勫垎
    if (condition.trend === 'UPTREND') score += condition.strength * 0.3;
    else if (condition.trend === 'DOWNTREND') score -= condition.strength * 0.3;

    // 闃舵璇勫垎
    switch (condition.phase) {
      case 'ACCUMULATION': score += 20; break;
      case 'MARKUP': score += 10; break;
      case 'DISTRIBUTION': score -= 20; break;
      case 'MARKDOWN': score -= 10; break;
    }

    // 娉㈠姩鎬ц皟鏁?
    if (condition.volatility === 'HIGH') score -= 10;
    else if (condition.volatility === 'LOW') score += 5;

    return Math.max(0, Math.min(100, score));
  }

  // 纭畾鏈€缁堜俊鍙?
  private determineSignal(
    technicalResult: TechnicalIndicatorResult,
    mlResult: MLAnalysisResult | null,
    combinedStrength: number
  ): SmartSignalType {
    // 濡傛灉鏈塎L缁撴灉涓旂疆淇″害楂橈紝浼樺厛鑰冭檻ML淇″彿
    if (mlResult && mlResult.confidence > 0.7) {
      return mlResult.prediction;
    }

    // 鍩轰簬缁煎悎寮哄害纭畾淇″彿
    if (combinedStrength >= 80) return 'STRONG_BUY';
    if (combinedStrength >= 65) return 'BUY';
    if (combinedStrength <= 20) return 'STRONG_SELL';
    if (combinedStrength <= 35) return 'SELL';
    return 'HOLD';
  }

  // 璁＄畻浠锋牸鐩爣
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
    
    // 鍩轰簬淇″彿绫诲瀷鍜屽競鍦烘潯浠惰皟鏁村€嶆暟
    let targetMultiplier = 1;
    let stopMultiplier = 0.5;
    
    // 鏍规嵁淇″彿寮哄害璋冩暣
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

    // 鏍规嵁瓒嬪娍寮哄害璋冩暣
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

  // 璁＄畻寤鸿浠撲綅澶у皬
  private calculatePositionSize(
    signal: SmartSignalType,
    strength: number,
    condition: MarketCondition,
    confidence: number
  ): number {
    if (signal === 'HOLD') return 0;

    let baseSize = 0.1; // 鍩虹浠撲綅10%

    // 鏍规嵁淇″彿寮哄害璋冩暣
    if (signal.includes('STRONG')) {
      baseSize = 0.2;
    }

    // 鏍规嵁缃俊搴﹁皟鏁?
    baseSize *= confidence;

    // 鏍规嵁甯傚満鏉′欢璋冩暣
    if (condition.volatility === 'HIGH') {
      baseSize *= 0.7; // 楂樻尝鍔ㄦ椂鍑忓皯浠撲綅
    } else if (condition.volatility === 'LOW') {
      baseSize *= 1.2; // 浣庢尝鍔ㄦ椂澧炲姞浠撲綅
    }

    // 鏍规嵁瓒嬪娍寮哄害璋冩暣
    if (condition.strength > 70) {
      baseSize *= 1.1;
    }

    return Math.max(0.01, Math.min(0.3, baseSize)); // 闄愬埗鍦?%-30%涔嬮棿
  }

  // 杈呭姪鏂规硶
  private calculateTechnicalConfidence(indicators: TechnicalIndicatorResult): number {
    let confidence = 0.5;

    // 璁＄畻甯冩灄甯︿綅缃紙浣跨敤瀹炴椂浠锋牸浼樺厛锛屽叾娆″洖閫€鍒颁腑杞級
    const bollingerRange = indicators.bollinger.upper - indicators.bollinger.lower;
    const currentPrice = (typeof this.lastMarketPrice === 'number') ? this.lastMarketPrice : indicators.bollinger.middle;
    const bollingerPosition = bollingerRange > 0 ? (currentPrice - indicators.bollinger.lower) / bollingerRange : 0.5;

    // 澶氫釜鎸囨爣鍚屽悜鏃跺鍔犵疆淇″害
    const bullishSignals = [
      indicators.rsi < 30,
      indicators.macd.histogram > 0,
      bollingerPosition < 0.3,
      indicators.kdj.k > indicators.kdj.d,
      indicators.williams < -80
    ].filter(Boolean).length;

    const bearishSignals = [
      indicators.rsi > 70,
      indicators.macd.histogram < 0,
      bollingerPosition > 0.7,
      indicators.kdj.k < indicators.kdj.d,
      indicators.williams > -20
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

  // 鐢熸垚鎺ㄧ悊璇存槑
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

  // 椋庨櫓绠＄悊璋冩暣
  private applyRiskManagement(
    signal: SmartSignalResult,
    marketData: MarketData,
    condition: MarketCondition
  ): SmartSignalResult {
    // 楂樻尝鍔ㄦ椂闄嶄綆浠撲綅
    if (condition.volatility === 'HIGH') {
      signal.positionSize *= 0.7;
    }

    // 浣庢垚浜ら噺鏃堕檷浣庝俊鍙峰己搴?
    if (condition.volume === 'LOW') {
      signal.strength.combined *= 0.8;
      signal.strength.confidence *= 0.9;
    }

    // 纭繚椋庨櫓鍥炴姤姣斿悎鐞?
    if (signal.riskReward < 1.5 && signal.signal !== 'HOLD') {
      signal.positionSize *= 0.5;
    }

    return signal;
  }

  // 澶囩敤淇″彿
  private getFallbackSignal(marketData: MarketData): SmartSignalResult {
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
        momentum: 'NEUTRAL'
      }
    };
  }

  // 鑾峰彇鏈€杩戠殑鍒嗘瀽缁撴灉
  getLastAnalysis(): SmartSignalResult | null {
    return this.lastAnalysis;
  }

  // 鑾峰彇鍘嗗彶鏁版嵁缁熻
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

  // 鏂板锛氳惤搴?ML 鏍锋湰锛堢Щ鍏ョ被鍐咃級
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

// 瀵煎嚭鍗曚緥锛屼緵鍏朵粬妯″潡澶嶇敤
export const smartSignalAnalyzer = new SmartSignalAnalyzer();