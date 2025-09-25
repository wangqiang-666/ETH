/**
 * 增强风险管理服务
 * 实现动态止损止盈、分批止盈、时间止损等高级风险控制功能
 */

import { config } from '../config.js';
import { enhancedOKXDataService } from './enhanced-okx-data-service.js';
import { EventEmitter } from 'events';

export interface DynamicRiskParams {
  entryPrice: number;
  currentPrice: number;
  direction: 'LONG' | 'SHORT';
  leverage: number;
  atr?: number;
  volatility?: number;
  trendStrength?: number;
  holdingTime?: number; // 持仓时间（毫秒）
}

export interface RiskLevels {
  stopLoss: number;
  takeProfit: number;
  partialTakeProfit?: {
    tp1: { price: number; ratio: number }; // 第一次止盈：价格和减仓比例
    tp2: { price: number; ratio: number }; // 第二次止盈
    tp3: { price: number; ratio: number }; // 第三次止盈
  };
  trailingStop?: {
    enabled: boolean;
    activationPrice: number; // 激活价格
    trailPercent: number; // 跟踪百分比
  };
  timeStop?: {
    enabled: boolean;
    maxHoldingHours: number; // 最大持仓时间
    decayFactor: number; // 时间衰减因子
  };
}

export interface MarketCondition {
  volatility: number;
  trend: 'UP' | 'DOWN' | 'SIDEWAYS';
  strength: number; // 0-1
  volume: number;
  momentum: number;
}

export class EnhancedRiskManagement extends EventEmitter {
  private readonly baseStopLoss: number;
  private readonly baseTakeProfit: number;
  private readonly maxHoldingHours: number;
  private readonly atrMultiplierSL: number;
  private readonly atrMultiplierTP: number;

  constructor() {
    super();
    
    // 从配置读取基础参数
    this.baseStopLoss = config.risk.stopLossPercent;
    this.baseTakeProfit = config.risk.takeProfitPercent;
    this.maxHoldingHours = Number(process.env.MAX_HOLDING_HOURS || '24');
    this.atrMultiplierSL = Number(process.env.ATR_SL_MULTIPLIER || '1.5');
    this.atrMultiplierTP = Number(process.env.ATR_TP_MULTIPLIER || '2.2');
  }

  /**
   * 计算动态风险管理参数
   */
  async calculateDynamicRisk(params: DynamicRiskParams): Promise<RiskLevels> {
    const marketCondition = await this.analyzeMarketCondition(params);
    
    // 基础止损止盈计算
    const baseRisk = this.calculateBaseRisk(params);
    
    // ATR自适应调整
    const atrAdjusted = this.applyATRAdaptation(baseRisk, params, marketCondition);
    
    // 波动性调整
    const volatilityAdjusted = this.applyVolatilityAdjustment(atrAdjusted, params, marketCondition);
    
    // 趋势强度调整
    const trendAdjusted = this.applyTrendAdjustment(volatilityAdjusted, params, marketCondition);
    
    // 时间衰减调整
    const timeAdjusted = this.applyTimeDecay(trendAdjusted, params);
    
    // 分批止盈设置
    const withPartialTP = this.calculatePartialTakeProfit(timeAdjusted, params, marketCondition);
    
    // 追踪止损设置
    const withTrailing = this.calculateTrailingStop(withPartialTP, params, marketCondition);
    
    // 时间止损设置
    const finalRisk = this.calculateTimeStop(withTrailing, params);

    this.emit('riskCalculated', {
      params,
      marketCondition,
      riskLevels: finalRisk
    });

    return finalRisk;
  }

  /**
   * 计算基础风险参数
   */
  private calculateBaseRisk(params: DynamicRiskParams): RiskLevels {
    const { entryPrice, direction } = params;
    
    const stopLossPrice = direction === 'LONG' 
      ? entryPrice * (1 - this.baseStopLoss)
      : entryPrice * (1 + this.baseStopLoss);
      
    const takeProfitPrice = direction === 'LONG'
      ? entryPrice * (1 + this.baseTakeProfit)
      : entryPrice * (1 - this.baseTakeProfit);

    return {
      stopLoss: stopLossPrice,
      takeProfit: takeProfitPrice
    };
  }

  /**
   * 应用ATR自适应调整
   */
  private applyATRAdaptation(
    baseRisk: RiskLevels, 
    params: DynamicRiskParams, 
    marketCondition: MarketCondition
  ): RiskLevels {
    if (!params.atr || params.atr <= 0) {
      return baseRisk;
    }

    const { entryPrice, direction } = params;
    const atrPercent = params.atr / entryPrice;
    
    // ATR调整系数：高波动时放宽止损，低波动时收紧
    const atrAdjustmentSL = Math.max(0.5, Math.min(2.0, atrPercent * this.atrMultiplierSL * 100));
    const atrAdjustmentTP = Math.max(1.0, Math.min(3.0, atrPercent * this.atrMultiplierTP * 100));
    
    const adjustedSLPercent = this.baseStopLoss * atrAdjustmentSL;
    const adjustedTPPercent = this.baseTakeProfit * atrAdjustmentTP;
    
    const stopLoss = direction === 'LONG'
      ? entryPrice * (1 - adjustedSLPercent)
      : entryPrice * (1 + adjustedSLPercent);
      
    const takeProfit = direction === 'LONG'
      ? entryPrice * (1 + adjustedTPPercent)
      : entryPrice * (1 - adjustedTPPercent);

    return {
      ...baseRisk,
      stopLoss,
      takeProfit
    };
  }

  /**
   * 应用波动性调整
   */
  private applyVolatilityAdjustment(
    risk: RiskLevels,
    params: DynamicRiskParams,
    marketCondition: MarketCondition
  ): RiskLevels {
    const { entryPrice, direction } = params;
    const volatility = marketCondition.volatility;
    
    // 高波动性时放宽止损，收紧止盈
    let volAdjustmentSL = 1.0;
    let volAdjustmentTP = 1.0;
    
    if (volatility > 0.05) { // 高波动
      volAdjustmentSL = 1.3;
      volAdjustmentTP = 0.8;
    } else if (volatility > 0.03) { // 中等波动
      volAdjustmentSL = 1.1;
      volAdjustmentTP = 0.9;
    } else if (volatility < 0.01) { // 低波动
      volAdjustmentSL = 0.8;
      volAdjustmentTP = 1.2;
    }
    
    const currentSLDistance = Math.abs(risk.stopLoss - entryPrice) / entryPrice;
    const currentTPDistance = Math.abs(risk.takeProfit - entryPrice) / entryPrice;
    
    const adjustedSLDistance = currentSLDistance * volAdjustmentSL;
    const adjustedTPDistance = currentTPDistance * volAdjustmentTP;
    
    const stopLoss = direction === 'LONG'
      ? entryPrice * (1 - adjustedSLDistance)
      : entryPrice * (1 + adjustedSLDistance);
      
    const takeProfit = direction === 'LONG'
      ? entryPrice * (1 + adjustedTPDistance)
      : entryPrice * (1 - adjustedTPDistance);

    return {
      ...risk,
      stopLoss,
      takeProfit
    };
  }

  /**
   * 应用趋势强度调整
   */
  private applyTrendAdjustment(
    risk: RiskLevels,
    params: DynamicRiskParams,
    marketCondition: MarketCondition
  ): RiskLevels {
    const { entryPrice, direction } = params;
    const { trend, strength } = marketCondition;
    
    // 顺势交易时放宽止盈，逆势交易时收紧止损
    let trendAdjustmentSL = 1.0;
    let trendAdjustmentTP = 1.0;
    
    const isWithTrend = (direction === 'LONG' && trend === 'UP') || 
                       (direction === 'SHORT' && trend === 'DOWN');
    
    if (isWithTrend && strength > 0.7) { // 强势顺势
      trendAdjustmentSL = 1.2; // 放宽止损
      trendAdjustmentTP = 1.5; // 放宽止盈
    } else if (isWithTrend && strength > 0.5) { // 中等顺势
      trendAdjustmentSL = 1.1;
      trendAdjustmentTP = 1.2;
    } else if (!isWithTrend && strength > 0.5) { // 逆势交易
      trendAdjustmentSL = 0.8; // 收紧止损
      trendAdjustmentTP = 0.9; // 收紧止盈
    }
    
    const currentSLDistance = Math.abs(risk.stopLoss - entryPrice) / entryPrice;
    const currentTPDistance = Math.abs(risk.takeProfit - entryPrice) / entryPrice;
    
    const adjustedSLDistance = currentSLDistance * trendAdjustmentSL;
    const adjustedTPDistance = currentTPDistance * trendAdjustmentTP;
    
    const stopLoss = direction === 'LONG'
      ? entryPrice * (1 - adjustedSLDistance)
      : entryPrice * (1 + adjustedSLDistance);
      
    const takeProfit = direction === 'LONG'
      ? entryPrice * (1 + adjustedTPDistance)
      : entryPrice * (1 - adjustedTPDistance);

    return {
      ...risk,
      stopLoss,
      takeProfit
    };
  }

  /**
   * 应用时间衰减调整
   */
  private applyTimeDecay(risk: RiskLevels, params: DynamicRiskParams): RiskLevels {
    if (!params.holdingTime) {
      return risk;
    }

    const holdingHours = params.holdingTime / (1000 * 60 * 60);
    const maxHours = this.maxHoldingHours;
    
    if (holdingHours < maxHours * 0.5) {
      return risk; // 前半段时间不调整
    }
    
    // 后半段时间逐渐收紧止损
    const timeRatio = (holdingHours - maxHours * 0.5) / (maxHours * 0.5);
    const decayFactor = 1 - (timeRatio * 0.3); // 最多收紧30%
    
    const { entryPrice, direction } = params;
    const currentSLDistance = Math.abs(risk.stopLoss - entryPrice) / entryPrice;
    const adjustedSLDistance = currentSLDistance * decayFactor;
    
    const stopLoss = direction === 'LONG'
      ? entryPrice * (1 - adjustedSLDistance)
      : entryPrice * (1 + adjustedSLDistance);

    return {
      ...risk,
      stopLoss
    };
  }

  /**
   * 计算分批止盈
   */
  private calculatePartialTakeProfit(
    risk: RiskLevels,
    params: DynamicRiskParams,
    marketCondition: MarketCondition
  ): RiskLevels {
    const { entryPrice, direction } = params;
    const { trend, strength } = marketCondition;
    
    // 只在趋势明确时启用分批止盈
    if (trend === 'SIDEWAYS' || strength < 0.5) {
      return risk;
    }
    
    const tpDistance = Math.abs(risk.takeProfit - entryPrice) / entryPrice;
    
    // 三级止盈设置
    const tp1Distance = tpDistance * 0.4; // 40%距离
    const tp2Distance = tpDistance * 0.7; // 70%距离
    const tp3Distance = tpDistance * 1.0; // 100%距离
    
    const tp1Price = direction === 'LONG'
      ? entryPrice * (1 + tp1Distance)
      : entryPrice * (1 - tp1Distance);
      
    const tp2Price = direction === 'LONG'
      ? entryPrice * (1 + tp2Distance)
      : entryPrice * (1 - tp2Distance);
      
    const tp3Price = direction === 'LONG'
      ? entryPrice * (1 + tp3Distance)
      : entryPrice * (1 - tp3Distance);

    return {
      ...risk,
      partialTakeProfit: {
        tp1: { price: tp1Price, ratio: 0.3 }, // 减仓30%
        tp2: { price: tp2Price, ratio: 0.4 }, // 再减仓40%
        tp3: { price: tp3Price, ratio: 0.3 }  // 最后30%
      }
    };
  }

  /**
   * 计算追踪止损
   */
  private calculateTrailingStop(
    risk: RiskLevels,
    params: DynamicRiskParams,
    marketCondition: MarketCondition
  ): RiskLevels {
    const { entryPrice, direction } = params;
    const { trend, strength } = marketCondition;
    
    // 只在强趋势中启用追踪止损
    if (strength < 0.6) {
      return risk;
    }
    
    const isWithTrend = (direction === 'LONG' && trend === 'UP') || 
                       (direction === 'SHORT' && trend === 'DOWN');
    
    if (!isWithTrend) {
      return risk;
    }
    
    // 激活价格：盈利1%时开始追踪
    const activationDistance = 0.01;
    const activationPrice = direction === 'LONG'
      ? entryPrice * (1 + activationDistance)
      : entryPrice * (1 - activationDistance);
    
    // 追踪百分比：根据趋势强度调整
    const trailPercent = strength > 0.8 ? 0.008 : 0.012; // 0.8%-1.2%

    return {
      ...risk,
      trailingStop: {
        enabled: true,
        activationPrice,
        trailPercent
      }
    };
  }

  /**
   * 计算时间止损
   */
  private calculateTimeStop(risk: RiskLevels, params: DynamicRiskParams): RiskLevels {
    const maxHours = this.maxHoldingHours;
    
    // 时间衰减因子：持仓时间越长，止损越严格
    const decayFactor = 0.02; // 每小时收紧2%

    return {
      ...risk,
      timeStop: {
        enabled: true,
        maxHoldingHours: maxHours,
        decayFactor
      }
    };
  }

  /**
   * 分析市场条件
   */
  private async analyzeMarketCondition(params: DynamicRiskParams): Promise<MarketCondition> {
    try {
      // 获取市场数据
      const ticker = await enhancedOKXDataService.getTicker(config.trading.defaultSymbol);
      const klines = await enhancedOKXDataService.getKlineData(config.trading.defaultSymbol, '1H', 24);
      
      if (!ticker || !klines || klines.length < 20) {
        // 默认市场条件
        return {
          volatility: params.volatility || 0.02,
          trend: 'SIDEWAYS',
          strength: 0.5,
          volume: 1.0,
          momentum: 0.0
        };
      }
      
      // 计算波动性（24小时ATR）
      const volatility = this.calculateVolatility(klines);
      
      // 计算趋势和强度
      const trendAnalysis = this.analyzeTrend(klines);
      
      // 计算成交量
      const volumeAnalysis = this.analyzeVolume(klines);
      
      // 计算动量
      const momentum = this.calculateMomentum(klines);
      
      return {
        volatility,
        trend: trendAnalysis.direction,
        strength: trendAnalysis.strength,
        volume: volumeAnalysis,
        momentum
      };
      
    } catch (error) {
      console.warn('Failed to analyze market condition:', error);
      
      // 返回默认值
      return {
        volatility: params.volatility || 0.02,
        trend: 'SIDEWAYS',
        strength: 0.5,
        volume: 1.0,
        momentum: 0.0
      };
    }
  }

  /**
   * 计算波动性
   */
  private calculateVolatility(klines: any[]): number {
    if (klines.length < 2) return 0.02;
    
    let totalRange = 0;
    let avgPrice = 0;
    
    for (const kline of klines) {
      const high = parseFloat(kline.high);
      const low = parseFloat(kline.low);
      const close = parseFloat(kline.close);
      
      totalRange += (high - low);
      avgPrice += close;
    }
    
    avgPrice /= klines.length;
    const avgRange = totalRange / klines.length;
    
    return avgRange / avgPrice;
  }

  /**
   * 分析趋势
   */
  private analyzeTrend(klines: any[]): { direction: 'UP' | 'DOWN' | 'SIDEWAYS'; strength: number } {
    if (klines.length < 10) {
      return { direction: 'SIDEWAYS', strength: 0.5 };
    }
    
    const prices = klines.map(k => parseFloat(k.close));
    const firstHalf = prices.slice(0, Math.floor(prices.length / 2));
    const secondHalf = prices.slice(Math.floor(prices.length / 2));
    
    const firstAvg = firstHalf.reduce((a, b) => a + b) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b) / secondHalf.length;
    
    const change = (secondAvg - firstAvg) / firstAvg;
    const absChange = Math.abs(change);
    
    let direction: 'UP' | 'DOWN' | 'SIDEWAYS';
    if (absChange < 0.01) {
      direction = 'SIDEWAYS';
    } else if (change > 0) {
      direction = 'UP';
    } else {
      direction = 'DOWN';
    }
    
    const strength = Math.min(1.0, absChange * 50); // 2%变化 = 1.0强度
    
    return { direction, strength };
  }

  /**
   * 分析成交量
   */
  private analyzeVolume(klines: any[]): number {
    if (klines.length < 5) return 1.0;
    
    const volumes = klines.map(k => parseFloat(k.volume));
    const recentVolume = volumes.slice(-5).reduce((a, b) => a + b) / 5;
    const avgVolume = volumes.reduce((a, b) => a + b) / volumes.length;
    
    return recentVolume / avgVolume;
  }

  /**
   * 计算动量
   */
  private calculateMomentum(klines: any[]): number {
    if (klines.length < 5) return 0.0;
    
    const prices = klines.map(k => parseFloat(k.close));
    const current = prices[prices.length - 1];
    const previous = prices[prices.length - 5];
    
    return (current - previous) / previous;
  }

  /**
   * 更新动态止损止盈
   */
  async updateDynamicRisk(
    currentParams: DynamicRiskParams,
    originalRisk: RiskLevels
  ): Promise<RiskLevels> {
    // 重新计算风险参数
    const newRisk = await this.calculateDynamicRisk(currentParams);
    
    // 只允许止损向有利方向移动
    const { direction, entryPrice } = currentParams;
    let updatedStopLoss = originalRisk.stopLoss;
    
    if (direction === 'LONG') {
      // 多头：只允许止损上移
      if (newRisk.stopLoss > originalRisk.stopLoss) {
        updatedStopLoss = newRisk.stopLoss;
      }
    } else {
      // 空头：只允许止损下移
      if (newRisk.stopLoss < originalRisk.stopLoss) {
        updatedStopLoss = newRisk.stopLoss;
      }
    }
    
    return {
      ...newRisk,
      stopLoss: updatedStopLoss
    };
  }

  /**
   * 检查是否触发分批止盈
   */
  checkPartialTakeProfit(
    currentPrice: number,
    riskLevels: RiskLevels,
    direction: 'LONG' | 'SHORT'
  ): { triggered: boolean; level: 'tp1' | 'tp2' | 'tp3' | null; ratio: number } {
    if (!riskLevels.partialTakeProfit) {
      return { triggered: false, level: null, ratio: 0 };
    }
    
    const { tp1, tp2, tp3 } = riskLevels.partialTakeProfit;
    
    if (direction === 'LONG') {
      if (currentPrice >= tp3.price) {
        return { triggered: true, level: 'tp3', ratio: tp3.ratio };
      } else if (currentPrice >= tp2.price) {
        return { triggered: true, level: 'tp2', ratio: tp2.ratio };
      } else if (currentPrice >= tp1.price) {
        return { triggered: true, level: 'tp1', ratio: tp1.ratio };
      }
    } else {
      if (currentPrice <= tp3.price) {
        return { triggered: true, level: 'tp3', ratio: tp3.ratio };
      } else if (currentPrice <= tp2.price) {
        return { triggered: true, level: 'tp2', ratio: tp2.ratio };
      } else if (currentPrice <= tp1.price) {
        return { triggered: true, level: 'tp1', ratio: tp1.ratio };
      }
    }
    
    return { triggered: false, level: null, ratio: 0 };
  }

  /**
   * 计算追踪止损价格
   */
  calculateTrailingStopPrice(
    currentPrice: number,
    highestPrice: number,
    lowestPrice: number,
    riskLevels: RiskLevels,
    direction: 'LONG' | 'SHORT'
  ): number | null {
    if (!riskLevels.trailingStop?.enabled) {
      return null;
    }
    
    const { activationPrice, trailPercent } = riskLevels.trailingStop;
    
    if (direction === 'LONG') {
      // 多头：价格需要先达到激活价格
      if (highestPrice < activationPrice) {
        return null;
      }
      
      // 从最高价回撤指定百分比
      return highestPrice * (1 - trailPercent);
    } else {
      // 空头：价格需要先达到激活价格
      if (lowestPrice > activationPrice) {
        return null;
      }
      
      // 从最低价反弹指定百分比
      return lowestPrice * (1 + trailPercent);
    }
  }

  /**
   * 检查是否触发时间止损
   */
  checkTimeStop(holdingTime: number, riskLevels: RiskLevels): boolean {
    if (!riskLevels.timeStop?.enabled) {
      return false;
    }
    
    const maxHoldingMs = riskLevels.timeStop.maxHoldingHours * 60 * 60 * 1000;
    return holdingTime >= maxHoldingMs;
  }
}

export const enhancedRiskManagement = new EnhancedRiskManagement();