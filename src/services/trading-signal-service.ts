import { MultiFactorAnalyzer, MultiFactorAnalysisResult } from '../analyzers/multi-factor-analyzer';
import { HighWinrateAlgorithm, HighWinrateSignal } from '../algorithms/high-winrate-algorithm';
import { EnhancedOKXDataService, getEffectiveTestingFGIOverride } from './enhanced-okx-data-service';
import { MarketData } from '../ml/ml-analyzer';
import { config } from '../config';
import { riskManagementService } from './risk-management-service';
import axios from 'axios';

// 交易信号输出结果
export interface TradingSignalOutput {
  // 基础信息
  timestamp: number;
  symbol: string;
  analysisId: string;
  
  // 开单建议
  recommendation: {
    action: '做多' | '做空' | '观望';
    confidence: string;        // 置信度描述
    urgency: '低' | '中' | '高' | '立即';
    reason: string;           // 开单理由
  };
  
  // 价格信息
  pricing: {
    currentPrice: number;     // 当前价格
    entryPrice: number;       // 建议开仓价格
    stopLoss: number;         // 止损价格
    takeProfit: {
      target1: number;        // 第一止盈目标
      target2: number;        // 第二止盈目标
      target3: number;        // 第三止盈目标
    };
    riskRewardRatio: string;  // 风险收益比
  };
  
  // 倍率建议
  leverage: {
    conservative: number;     // 保守倍率
    moderate: number;         // 适中倍率
    aggressive: number;       // 激进倍率
    recommended: number;      // 推荐倍率
    maxSafe: number;         // 最大安全倍率
  };
  
  // 仓位管理
  position: {
    recommendedSize: string;  // 推荐仓位大小
    maxRisk: string;         // 最大风险
    entryStrategy: string;    // 入场策略
    exitStrategy: string;     // 出场策略
  };
  
  // 胜率分析
  winrateAnalysis: {
    estimated: string;        // 预估胜率
    historical: string;       // 历史胜率
    confidence: string;       // 胜率置信度
    factors: string[];        // 影响胜率的因素
  };
  
  // 风险评估
  riskAssessment: {
    level: string;           // 风险等级
    factors: string[];       // 风险因素
    mitigation: string[];    // 风险缓解措施
    maxDrawdown: string;     // 最大回撤
  };
  
  // 市场分析摘要
  marketAnalysis: {
    trend: string;           // 趋势分析
    momentum: string;        // 动量分析
    volatility: string;      // 波动率分析
    volume: string;          // 成交量分析
    sentiment: string;       // 市场情绪
  };
  
  // 执行指导
  executionGuide: {
    preConditions: string[];  // 执行前提条件
    entryTriggers: string[];  // 入场触发条件
    monitoringPoints: string[]; // 监控要点
    exitConditions: string[]; // 出场条件
  };
  
  // 时间管理
  timing: {
    validUntil: string;      // 信号有效期
    optimalEntry: string;    // 最佳入场时间
    expectedDuration: string; // 预期持仓时间
  };
}

// 交易信号服务
export class TradingSignalService {
  private multiFactorAnalyzer: MultiFactorAnalyzer;
  private highWinrateAlgorithm: HighWinrateAlgorithm;
  private okxDataService: EnhancedOKXDataService;
  
  constructor() {
    this.multiFactorAnalyzer = new MultiFactorAnalyzer();
    this.highWinrateAlgorithm = new HighWinrateAlgorithm();
    this.okxDataService = new EnhancedOKXDataService();
  }

  /**
   * 生成交易信号（简化版本，用于推荐系统集成）
   */
  async generateSignal(marketData: any, strategyResult: any): Promise<{
    action: 'LONG' | 'SHORT' | 'HOLD';
    confidence: number;
    leverage?: number;
    stopLoss?: number;
    takeProfit?: number;
    strength?: number;
  }> {
    try {
      // 映射工具：多种来源映射为 LONG/SHORT/HOLD
      const mapToLS = (val: any): 'LONG' | 'SHORT' | 'HOLD' => {
        if (!val) return 'HOLD';
        const s = String(val).toUpperCase();
        if (s === 'OPEN_LONG' || s === 'LONG' || s === 'BUY' || s === 'STRONG_BUY') return 'LONG';
        if (s === 'OPEN_SHORT' || s === 'SHORT' || s === 'SELL' || s === 'STRONG_SELL') return 'SHORT';
        return 'HOLD';
      };

      // 1) 优先使用新版 recommendation.action（对象结构）
      let action: 'LONG' | 'SHORT' | 'HOLD' = mapToLS(strategyResult?.recommendation?.action);

      // 2) 兼容旧版 recommendation 字符串
      if (action === 'HOLD' && typeof strategyResult?.recommendation === 'string') {
        action = mapToLS(strategyResult?.recommendation);
      }

      // 3) 若仍为 HOLD，尝试从信号强弱方向中推导（用于反向并存场景）
      if (action === 'HOLD' && strategyResult?.signal?.signal) {
        action = mapToLS(strategyResult.signal.signal);
      }

      // 置信度优先级：recommendation.confidence > signal.strength.confidence
      const confidence =
        Number(strategyResult?.recommendation?.confidence) ||
        Number(strategyResult?.signal?.strength?.confidence) ||
        0.6;

      // 风险管理参数优先从 strategyResult.riskManagement 读取
      const rm = strategyResult?.riskManagement || {};
      const leverage = Number(rm?.leverage) || Number(strategyResult?.leverage) || 2;
      const stopLoss = Number.isFinite(rm?.stopLoss) ? rm.stopLoss : strategyResult?.stopLoss;
      const takeProfit = Number.isFinite(rm?.takeProfit) ? rm.takeProfit : strategyResult?.takeProfit;

      return {
        action,
        confidence,
        leverage,
        stopLoss,
        takeProfit,
        strength: confidence
      };
    } catch (error) {
      console.error('Error generating signal:', error);
      return {
        action: 'HOLD',
        confidence: 0,
        strength: 0
      };
    }
  }

  /**
   * 生成完整的交易信号分析报告
   */
  async generateTradingSignal(
    symbol: string = 'ETH-USDT-SWAP',
    options: {
      includeML?: boolean;
      riskTolerance?: 'LOW' | 'MEDIUM' | 'HIGH';
      timeframe?: string;
    } = {}
  ): Promise<TradingSignalOutput> {
    
    try {
      console.log(`开始生成 ${symbol} 的交易信号分析...`);
      
      // 1. 获取市场数据
      const marketData = await this.fetchMarketData(symbol);
      const klineData = await this.fetchKlineData(symbol);
      
      console.log('市场数据获取完成，开始多因子分析...');
      
      // 2. 执行多因子分析
      const multiFactorResult = await this.multiFactorAnalyzer.analyzeMultiFactors(
        marketData,
        klineData,
        {
          includeML: options.includeML ?? true,
          riskTolerance: options.riskTolerance ?? 'MEDIUM'
        }
      );
      
      console.log('多因子分析完成，开始高胜率算法分析...');
      
      // 3. 生成高胜率信号
      const highWinrateSignal = await this.highWinrateAlgorithm.generateSignal(
        marketData,
        klineData,
        {
          minConfidence: 0.7,
          minWinrateEstimate: 0.65,
          minQualityScore: 65
        }
      );
      
      console.log('高胜率算法分析完成，开始生成交易信号输出...');
      
      // 4. 风险管理状态检查
      const riskStatus = riskManagementService.getRiskStatus();
      console.log(`⚠️ 风险状态: ${riskStatus.riskLevel}, 日损失: ${riskStatus.dailyLossRatio.toFixed(2)}`);
      
      // 5. 生成交易信号输出
      const tradingSignal = this.constructTradingSignalOutput(
        multiFactorResult,
        highWinrateSignal,
        marketData,
        symbol,
        riskStatus
      );
      
      console.log('交易信号生成完成！');
      
      return tradingSignal;
      
    } catch (error) {
      console.error('生成交易信号失败:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`交易信号生成失败: ${errorMessage}`);
    }
  }

  /**
   * 获取市场数据
   */
  private async fetchMarketData(symbol: string): Promise<MarketData> {
    try {
      // 获取ticker数据
      const ticker = await this.okxDataService.getTicker(symbol);
      
      if (!ticker) {
        throw new Error(`无法获取 ${symbol} 的市场数据`);
      }
      
      // 获取资金费率
      const fundingRate = await this.okxDataService.getFundingRate(symbol);

      // 可选：获取 FGI 情绪指数（0-100）
      let fgiScore: number | undefined = undefined;
      if (config.ml.features.sentiment?.fgi) {
        try {
          const score = await this.fetchFGIScore();
          if (typeof score === 'number' && !Number.isNaN(score)) {
            fgiScore = Math.max(0, Math.min(100, score));
          }
        } catch (e) {
          console.warn('获取FGI失败，忽略情绪特征:', e instanceof Error ? e.message : e);
        }
      }
      
      // 构建市场数据
      const marketData: MarketData = {
        symbol,
        price: ticker.price,
        volume: ticker.volume,
        timestamp: ticker.timestamp,
        high24h: ticker.high24h,
        low24h: ticker.low24h,
        change24h: ticker.change24h,
        fundingRate: fundingRate || undefined,
        ...(typeof fgiScore === 'number' ? { fgiScore } : {})
      };
      
      return marketData;
      
    } catch (error) {
      console.error('获取市场数据失败:', error);
      throw error;
    }
  }

  /**
   * 获取K线数据
   */
  private async fetchKlineData(symbol: string): Promise<any[]> {
    try {
      // 获取1小时K线数据，最近100根
      const klineData = await this.okxDataService.getKlineData(
        symbol,
        '1H',
        100
      );
      
      return klineData;
      
    } catch (error) {
      console.error('获取K线数据失败:', error);
      throw error;
    }
  }

  /**
   * 构建交易信号输出
   */
  private constructTradingSignalOutput(
    multiFactorResult: MultiFactorAnalysisResult,
    highWinrateSignal: HighWinrateSignal | null,
    marketData: MarketData,
    symbol: string,
    riskStatus?: any
  ): TradingSignalOutput {
    
    // 如果没有高胜率信号，使用多因子结果
    const useHighWinrate = highWinrateSignal !== null;
    let signal = highWinrateSignal || this.createFallbackSignal(multiFactorResult, marketData);
    
    // 根据风险状态调整信号
    if (riskStatus) {
      signal = this.adjustSignalForRisk(signal, riskStatus);
    }
    
    // 构建开单建议
    const recommendation = this.buildRecommendation(signal, multiFactorResult, useHighWinrate);
    
    // 构建价格信息
    const pricing = this.buildPricing(signal, marketData);
    
    // 构建倍率建议
    const leverage = this.buildLeverageRecommendation(signal, multiFactorResult);
    
    // 构建仓位管理
    const position = this.buildPositionManagement(signal, multiFactorResult);
    
    // 构建胜率分析
    const winrateAnalysis = this.buildWinrateAnalysis(signal, multiFactorResult, useHighWinrate);
    
    // 构建风险评估
    const riskAssessment = this.buildRiskAssessment(signal, multiFactorResult);
    
    // 构建市场分析摘要
    const marketAnalysis = this.buildMarketAnalysis(multiFactorResult);
    
    // 构建执行指导
    const executionGuide = this.buildExecutionGuide(signal, multiFactorResult);
    
    // 构建时间管理
    const timing = this.buildTiming(signal);
    
    return {
      timestamp: Date.now(),
      symbol,
      analysisId: `SIGNAL_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      recommendation,
      pricing,
      leverage,
      position,
      winrateAnalysis,
      riskAssessment,
      marketAnalysis,
      executionGuide,
      timing
    };
  }

  /**
   * 创建备用信号（当高胜率算法没有生成信号时）
   */
  private createFallbackSignal(
    multiFactorResult: MultiFactorAnalysisResult,
    marketData: MarketData
  ): any {
    return {
      signal: {
        type: multiFactorResult.execution.action === 'BUY' ? 'BUY' : 
              multiFactorResult.execution.action === 'SELL' ? 'SELL' : 'HOLD',
        strength: Math.max(
          multiFactorResult.compositeScore.bullish,
          multiFactorResult.compositeScore.bearish
        ),
        confidence: multiFactorResult.compositeScore.confidence,
        winrateEstimate: 0.6, // 默认胜率
        qualityScore: 60
      },
      pricing: {
        entryPrice: multiFactorResult.execution.optimalEntry,
        stopLoss: multiFactorResult.execution.stopLoss,
        takeProfits: {
          target1: multiFactorResult.execution.takeProfit[0],
          target2: multiFactorResult.execution.takeProfit[1] || multiFactorResult.execution.takeProfit[0] * 1.2,
          target3: multiFactorResult.execution.takeProfit[2] || multiFactorResult.execution.takeProfit[0] * 1.5
        },
        riskRewardRatio: Math.abs(multiFactorResult.execution.takeProfit[0] - multiFactorResult.execution.optimalEntry) / 
                        Math.abs(multiFactorResult.execution.optimalEntry - multiFactorResult.execution.stopLoss)
      },
      position: {
        recommendedSize: multiFactorResult.execution.positionSizing.moderate
      },
      timing: {
        urgency: multiFactorResult.execution.urgency,
        validUntil: Date.now() + (4 * 60 * 60 * 1000),
        expectedDuration: 4
      },
      risk: {
        level: multiFactorResult.riskAssessment.level,
        factors: multiFactorResult.riskAssessment.factors
      },
      reasoning: {
        primaryFactors: Object.entries(multiFactorResult.factors)
          .filter(([_, factor]) => factor.strength === 'STRONG')
          .map(([key, factor]) => `${key}因子: ${factor.trend}信号`)
      }
    };
  }

  /**
   * 构建开单建议
   */
  private buildRecommendation(
    signal: any,
    multiFactorResult: MultiFactorAnalysisResult,
    useHighWinrate: boolean
  ): TradingSignalOutput['recommendation'] {
    
    let action: '做多' | '做空' | '观望';
    
    if (signal.signal.type === 'BUY') {
      action = '做多';
    } else if (signal.signal.type === 'SELL') {
      action = '做空';
    } else {
      action = '观望';
    }
    
    const confidence = `${(signal.signal.confidence * 100).toFixed(1)}%`;
    
    const urgencyMap = {
      'LOW': '低',
      'MEDIUM': '中',
      'HIGH': '高',
      'IMMEDIATE': '立即'
    };
    
    const urgency = (urgencyMap[signal.timing?.urgency as keyof typeof urgencyMap] || '中') as '低' | '中' | '高' | '立即';
    
    // 生成开单理由
    let reason = '';
    if (useHighWinrate) {
      reason = `高胜率算法识别到${action}机会，质量评分${signal.signal.qualityScore.toFixed(1)}/100，`;
    } else {
      reason = `多因子分析显示${action}信号，`;
    }
    
    const strongFactors = Object.entries(multiFactorResult.factors)
      .filter(([_, factor]) => factor.strength === 'STRONG')
      .map(([key, _]) => this.translateFactorName(key));
    
    if (strongFactors.length > 0) {
      reason += `主要支撑因子：${strongFactors.join('、')}`;
    } else {
      reason += `综合评分显示${action}倾向`;
    }
    
    return {
      action,
      confidence,
      urgency,
      reason
    };
  }

  /**
   * 构建价格信息
   */
  private buildPricing(
    signal: any,
    marketData: MarketData
  ): TradingSignalOutput['pricing'] {
    
    return {
      currentPrice: marketData.price,
      entryPrice: signal.pricing.entryPrice,
      stopLoss: signal.pricing.stopLoss,
      takeProfit: {
        target1: signal.pricing.takeProfits.target1,
        target2: signal.pricing.takeProfits.target2,
        target3: signal.pricing.takeProfits.target3
      },
      riskRewardRatio: `1:${signal.pricing.riskRewardRatio.toFixed(2)}`
    };
  }

  /**
   * 构建倍率建议
   */
  private buildLeverageRecommendation(
    signal: any,
    multiFactorResult: MultiFactorAnalysisResult
  ): TradingSignalOutput['leverage'] {
    
    // 基础倍率根据风险等级确定
    const riskLevel = signal.risk?.level || multiFactorResult.riskAssessment.level;
    
    let baseLeverage: number;
    
    switch (riskLevel) {
      case 'LOW':
      case 'VERY_LOW':
        baseLeverage = 10;
        break;
      case 'MEDIUM':
        baseLeverage = 7;
        break;
      case 'HIGH':
        baseLeverage = 5;
        break;
      case 'EXTREME':
      case 'VERY_HIGH':
        baseLeverage = 3;
        break;
      default:
        baseLeverage = 7;
    }
    
    // 根据信号质量调整
    const qualityMultiplier = signal.signal.qualityScore > 80 ? 1.2 : 
                             signal.signal.qualityScore > 60 ? 1.0 : 0.8;
    
    const adjustedBase = Math.round(baseLeverage * qualityMultiplier);
    
    return {
      conservative: Math.max(2, Math.round(adjustedBase * 0.6)),
      moderate: adjustedBase,
      aggressive: Math.min(20, Math.round(adjustedBase * 1.5)),
      recommended: adjustedBase,
      maxSafe: Math.min(25, Math.round(adjustedBase * 2))
    };
  }

  /**
   * 构建仓位管理
   */
  private buildPositionManagement(
    signal: any,
    multiFactorResult: MultiFactorAnalysisResult
  ): TradingSignalOutput['position'] {
    
    const recommendedSize = `${(signal.position.recommendedSize * 100).toFixed(1)}%`;
    const maxRisk = `${(config.risk.maxRiskPerTrade * 100).toFixed(1)}%`;
    
    let entryStrategy = '';
    let exitStrategy = '';
    
    if (signal.timing?.urgency === 'IMMEDIATE' || signal.timing?.urgency === 'HIGH') {
      entryStrategy = '市价单快速入场，或设置接近市价的限价单';
    } else {
      entryStrategy = '限价单等待回调入场，设置在关键支撑/阻力位';
    }
    
    if (signal.pricing.riskRewardRatio > 3) {
      exitStrategy = '分批止盈：目标1处减仓50%，目标2处减仓30%，目标3处清仓';
    } else {
      exitStrategy = '分批止盈：目标1处减仓70%，目标2处清仓';
    }
    
    return {
      recommendedSize,
      maxRisk,
      entryStrategy,
      exitStrategy
    };
  }

  /**
   * 构建胜率分析
   */
  private buildWinrateAnalysis(
    signal: any,
    multiFactorResult: MultiFactorAnalysisResult,
    useHighWinrate: boolean
  ): TradingSignalOutput['winrateAnalysis'] {
    
    const estimated = `${(signal.signal.winrateEstimate * 100).toFixed(1)}%`;
    
    // 获取历史胜率
    const historicalStats = this.highWinrateAlgorithm.getPerformanceStats();
    const historical = `${(historicalStats.overallWinrate * 100).toFixed(1)}%`;
    
    let confidence = '';
    if (signal.signal.confidence > 0.8) {
      confidence = '高置信度';
    } else if (signal.signal.confidence > 0.6) {
      confidence = '中等置信度';
    } else {
      confidence = '低置信度';
    }
    
    // 影响胜率的因素
    const factors: string[] = [];
    
    if (useHighWinrate) {
      factors.push('高胜率算法筛选');
    }
    
    if (multiFactorResult.compositeScore.confidence > 0.75) {
      factors.push('多因子高度一致');
    }
    
    if (multiFactorResult.riskAssessment.level === 'LOW') {
      factors.push('低风险环境');
    }
    
    const strongFactors = Object.entries(multiFactorResult.factors)
      .filter(([_, factor]) => factor.strength === 'STRONG')
      .length;
    
    if (strongFactors >= 3) {
      factors.push('多个强势因子支撑');
    }
    
    if (factors.length === 0) {
      factors.push('基础技术分析支撑');
    }
    
    return {
      estimated,
      historical,
      confidence,
      factors
    };
  }

  /**
   * 构建风险评估
   */
  private buildRiskAssessment(
    signal: any,
    multiFactorResult: MultiFactorAnalysisResult
  ): TradingSignalOutput['riskAssessment'] {
    
    const levelMap = {
      'VERY_LOW': '极低风险',
      'LOW': '低风险',
      'MEDIUM': '中等风险',
      'HIGH': '高风险',
      'VERY_HIGH': '极高风险',
      'EXTREME': '极高风险'
    };
    
    const level = levelMap[signal.risk?.level as keyof typeof levelMap] || levelMap[multiFactorResult.riskAssessment.level as keyof typeof levelMap] || '中等风险';
    
    const factors = signal.risk?.factors || multiFactorResult.riskAssessment.factors || [];
    
    const mitigation = [
      '严格执行止损纪律',
      '控制仓位大小',
      '分批建仓降低风险',
      '密切监控市场变化'
    ];
    
    const maxDrawdown = `${(config.risk.maxDrawdown * 100).toFixed(1)}%`;
    
    return {
      level,
      factors,
      mitigation,
      maxDrawdown
    };
  }

  /**
   * 构建市场分析摘要
   */
  private buildMarketAnalysis(
    multiFactorResult: MultiFactorAnalysisResult
  ): TradingSignalOutput['marketAnalysis'] {
    
    const factors = multiFactorResult.factors;
    
    // 趋势分析
    const trendFactors = [factors.technical, factors.momentum];
    const avgTrendScore = trendFactors.reduce((sum, f) => sum + f.score, 0) / trendFactors.length;
    let trend = '';
    if (avgTrendScore > 20) {
      trend = '上升趋势，多头占优';
    } else if (avgTrendScore < -20) {
      trend = '下降趋势，空头占优';
    } else {
      trend = '震荡趋势，方向不明';
    }
    
    // 动量分析
    const momentumScore = factors.momentum.score;
    let momentum = '';
    if (momentumScore > 30) {
      momentum = '动量强劲，上涨加速';
    } else if (momentumScore < -30) {
      momentum = '动量疲弱，下跌加速';
    } else {
      momentum = '动量中性，缺乏方向';
    }
    
    // 波动率分析
    const volatilityScore = factors.volatility.score;
    let volatility = '';
    if (volatilityScore > 10) {
      volatility = '低波动率，趋势稳定';
    } else if (volatilityScore < -20) {
      volatility = '高波动率，风险较大';
    } else {
      volatility = '中等波动率，正常范围';
    }
    
    // 成交量分析
    const volumeScore = factors.volume.score;
    let volume = '';
    if (volumeScore > 20) {
      volume = '成交量放大，资金活跃';
    } else if (volumeScore < -15) {
      volume = '成交量萎缩，参与度低';
    } else {
      volume = '成交量正常，市场稳定';
    }
    
    // 市场情绪
    const sentimentScore = factors.sentiment.score;
    let sentiment = '';
    if (sentimentScore > 30) {
      sentiment = '市场情绪乐观，买盘积极';
    } else if (sentimentScore < -30) {
      sentiment = '市场情绪悲观，卖压较重';
    } else {
      sentiment = '市场情绪中性，观望为主';
    }
    
    return {
      trend,
      momentum,
      volatility,
      volume,
      sentiment
    };
  }

  /**
   * 构建执行指导
   */
  private buildExecutionGuide(
    signal: any,
    multiFactorResult: MultiFactorAnalysisResult
  ): TradingSignalOutput['executionGuide'] {
    
    const preConditions = [
      '确认账户资金充足',
      '检查网络连接稳定',
      '验证交易所流动性',
      '确认风险承受能力'
    ];
    
    let entryTriggers: string[] = [];
    let exitConditions: string[] = [];
    
    if (signal.signal.type === 'BUY') {
      entryTriggers = [
        '价格突破关键阻力位',
        '成交量放大确认突破',
        '技术指标发出买入信号',
        '市场情绪转为乐观'
      ];
      exitConditions = [
        '达到第一止盈目标',
        '跌破止损价位',
        '技术指标转为看跌',
        '市场出现重大利空'
      ];
    } else if (signal.signal.type === 'SELL') {
      entryTriggers = [
        '价格跌破关键支撑位',
        '成交量放大确认破位',
        '技术指标发出卖出信号',
        '市场情绪转为悲观'
      ];
      exitConditions = [
        '达到第一止盈目标',
        '突破止损价位',
        '技术指标转为看涨',
        '市场出现重大利好'
      ];
    } else {
      entryTriggers = ['等待明确的方向信号'];
      exitConditions = ['信号明确后再决定'];
    }
    
    const monitoringPoints = [
      '密切关注价格变化',
      '监控成交量异常',
      '观察技术指标变化',
      '跟踪市场消息面',
      '注意资金费率变化'
    ];
    
    return {
      preConditions,
      entryTriggers,
      monitoringPoints,
      exitConditions
    };
  }

  /**
   * 构建时间管理
   */
  private buildTiming(signal: any): TradingSignalOutput['timing'] {
    const now = new Date();
    const validUntil = new Date(signal.timing.validUntil);
    const optimalEntry = new Date(now.getTime() + (30 * 60 * 1000)); // 30分钟后
    
    return {
      validUntil: this.formatDateTime(validUntil),
      optimalEntry: this.formatDateTime(optimalEntry),
      expectedDuration: `${signal.timing.expectedDuration}小时`
    };
  }

  /**
   * 格式化日期时间
   */
  private formatDateTime(date: Date): string {
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Shanghai'
    });
  }

  /**
   * 翻译因子名称
   */
  private translateFactorName(factorKey: string): string {
    const translations: { [key: string]: string } = {
      'technical': '技术指标',
      'momentum': '动量指标',
      'volume': '成交量',
      'volatility': '波动率',
      'sentiment': '市场情绪',
      'fundamental': '基本面',
      'macro': '宏观经济'
    };
    
    return translations[factorKey] || factorKey;
  }

  /**
   * 根据风险状态调整交易信号
   */
  private adjustSignalForRisk(signal: any, riskStatus: any): any {
    const adjustedSignal = { ...signal };
    
    // 根据风险等级调整信号强度
    switch (riskStatus.riskLevel) {
      case 'EXTREME':
        // 极高风险：强制观望
        adjustedSignal.signal = {
          ...adjustedSignal.signal,
          type: 'HOLD',
          confidence: Math.min(adjustedSignal.signal.confidence * 0.1, 0.3),
          qualityScore: Math.min(adjustedSignal.signal.qualityScore * 0.1, 30)
        };
        adjustedSignal.position.recommendedSize *= 0.1;
        break;
        
      case 'HIGH':
        // 高风险：降低信号强度和仓位
        adjustedSignal.signal.confidence *= 0.5;
        adjustedSignal.signal.qualityScore *= 0.5;
        adjustedSignal.position.recommendedSize *= 0.3;
        break;
        
      case 'MEDIUM':
        // 中等风险：适度调整
        adjustedSignal.signal.confidence *= 0.8;
        adjustedSignal.signal.qualityScore *= 0.8;
        adjustedSignal.position.recommendedSize *= 0.6;
        break;
        
      case 'LOW':
        // 低风险：正常执行
        break;
    }
    
    // 调整止损以适应风险管理
    const riskMultiplier = riskStatus.riskLevel === 'HIGH' || riskStatus.riskLevel === 'EXTREME' ? 0.5 : 1.0;
    
    if (adjustedSignal.signal.type === 'BUY') {
      adjustedSignal.pricing.stopLoss = Math.max(
        adjustedSignal.pricing.stopLoss,
        adjustedSignal.pricing.entryPrice * (1 - config.risk.stopLossPercent * riskMultiplier)
      );
    } else if (adjustedSignal.signal.type === 'SELL') {
      adjustedSignal.pricing.stopLoss = Math.min(
        adjustedSignal.pricing.stopLoss,
        adjustedSignal.pricing.entryPrice * (1 + config.risk.stopLossPercent * riskMultiplier)
      );
    }
    
    return adjustedSignal;
  }

  /**
   * 格式化信号输出为可读文本
   */
  formatSignalOutput(signal: TradingSignalOutput): string {
    return `
🚀 ${signal.symbol} 交易信号分析报告
📅 生成时间: ${new Date(signal.timestamp).toLocaleString('zh-CN')}
🆔 分析ID: ${signal.analysisId}

💡 开单建议:
   操作: ${signal.recommendation.action}
   置信度: ${signal.recommendation.confidence}
   紧急度: ${signal.recommendation.urgency}
   理由: ${signal.recommendation.reason}

💰 价格信息:
   当前价格: $${signal.pricing.currentPrice}
   建议入场: $${signal.pricing.entryPrice}
   止损价位: $${signal.pricing.stopLoss}
   止盈目标1: $${signal.pricing.takeProfit.target1}
   止盈目标2: $${signal.pricing.takeProfit.target2}
   止盈目标3: $${signal.pricing.takeProfit.target3}
   风险收益比: ${signal.pricing.riskRewardRatio}

⚡ 倍率建议:
   保守倍率: ${signal.leverage.conservative}x
   适中倍率: ${signal.leverage.moderate}x
   激进倍率: ${signal.leverage.aggressive}x
   推荐倍率: ${signal.leverage.recommended}x
   最大安全: ${signal.leverage.maxSafe}x

📊 仓位管理:
   推荐仓位: ${signal.position.recommendedSize}
   最大风险: ${signal.position.maxRisk}
   入场策略: ${signal.position.entryStrategy}
   出场策略: ${signal.position.exitStrategy}

🎯 胜率分析:
   预估胜率: ${signal.winrateAnalysis.estimated}
   历史胜率: ${signal.winrateAnalysis.historical}
   置信度: ${signal.winrateAnalysis.confidence}
   支撑因子: ${signal.winrateAnalysis.factors.join('、')}

⚠️ 风险评估:
   风险等级: ${signal.riskAssessment.level}
   风险因素: ${signal.riskAssessment.factors.join('、')}
   缓解措施: ${signal.riskAssessment.mitigation.join('、')}
   最大回撤: ${signal.riskAssessment.maxDrawdown}

📊 市场分析:
   趋势: ${signal.marketAnalysis.trend}
   动量: ${signal.marketAnalysis.momentum}
   波动率: ${signal.marketAnalysis.volatility}

⏰ 时间管理:
   信号有效期: ${signal.timing.validUntil}
   最佳入场: ${signal.timing.optimalEntry}
   预期持仓: ${signal.timing.expectedDuration}
`;
  }

  // 获取恐惧与贪婪指数（FGI），返回 0-100；失败返回 null
  private async fetchFGIScore(): Promise<number | null> {
    try {
      // 覆盖优先（若启用）
      if (((config as any)?.testing?.allowFGIOverride) === true) {
        const ov = getEffectiveTestingFGIOverride();
        if (typeof ov === 'number' && Number.isFinite(ov)) {
          return Math.max(0, Math.min(100, ov));
        }
      }
      const url = process.env.FGI_API_URL || 'https://api.alternative.me/fng/?limit=1&format=json';
      const resp = await axios.get(url, { timeout: config.okx?.timeout ?? 30000 });
      const data = (resp?.data && (resp.data.data || resp.data.result || resp.data.items)) || resp?.data?.data;

      // 常见返回结构: { data: [{ value: "34", value_classification: "Fear", ... }] }
      if (Array.isArray(data) && data.length > 0) {
        const v = (data[0].value ?? data[0].score ?? data[0].index ?? data[0].fgi);
        const num = typeof v === 'string' ? parseFloat(v) : Number(v);
        return Number.isFinite(num) ? num : null;
      }

      // 其他兜底：若直接是 { value: ... }
      const v = resp?.data?.value ?? resp?.data?.score ?? resp?.data?.index;
      const num = typeof v === 'string' ? parseFloat(v) : Number(v);
      return Number.isFinite(num) ? num : null;
    } catch (error) {
      console.warn('请求FGI接口失败:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }
}

// 导出单例实例
export const tradingSignalService = new TradingSignalService();
 