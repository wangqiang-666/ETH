import { SmartSignalAnalyzer, SmartSignalResult } from '../analyzers/smart-signal-analyzer.js';
import type { MarketData, KlineData } from '../services/okx-data-service.js';
import { EnhancedOKXDataService, enhancedOKXDataService, getEffectiveTestingFGIOverride } from '../services/enhanced-okx-data-service.js';
import { MLAnalyzer } from '../ml/ml-analyzer.js';
import { config } from '../config.js';
import axios from 'axios';
import NodeCache from 'node-cache';
import { riskManagementService, RiskAssessment, PositionRisk, PortfolioRisk } from '../services/risk-management-service.js';
import { logger } from '../utils/logger.js';
import { EventEmitter } from 'events';

// 计算基础EV阈值：支持 evThreshold 对象形式（default/byVolatility/byRegime）与兼容旧的 expectedValueThreshold
function computeEvBaseThreshold(metaVol?: number, marketCondition?: string): number {
  const s: any = (config as any)?.strategy || {};
  const e: any = s.evThreshold;
  const legacy = s.expectedValueThreshold;
  // 对象形式
  if (e && typeof e === 'object') {
    let base = Number(e.default) || 0;
    // byVolatility
    if (typeof metaVol === 'number' && e.byVolatility && typeof e.byVolatility === 'object') {
      const cat: 'HIGH' | 'MEDIUM' | 'LOW' = metaVol > 0.6 ? 'HIGH' : metaVol < 0.3 ? 'LOW' : 'MEDIUM';
      const add = Number(e.byVolatility[cat]);
      if (Number.isFinite(add)) base += add;
    }
    // byRegime（内部市场状态为 TRENDING/RANGING，配置键为 TREND/RANGE）
    if (marketCondition && e.byRegime && typeof e.byRegime === 'object') {
      const rc = (marketCondition === 'TRENDING' || marketCondition === 'TREND') ? 'TREND'
              : (marketCondition === 'RANGING' || marketCondition === 'RANGE') ? 'RANGE'
              : undefined;
      if (rc) {
        const add = Number(e.byRegime[rc]);
        if (Number.isFinite(add)) base += add;
      }
    }
    return base;
  }
  // 兼容数值/旧字段
  const n = Number(legacy ?? e ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// 交易策略结果
export interface StrategyResult {
  signal: SmartSignalResult;
  recommendation: {
    action: 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE_POSITION' | 'HOLD' | 'REDUCE_POSITION';
    confidence: number;
    urgency: 'HIGH' | 'MEDIUM' | 'LOW';
    timeframe: string;
  };
  riskManagement: {
    maxLoss: number;
    positionSize: number;
    leverage: number;
    stopLoss: number;
    takeProfit: number;
    riskScore: number;
  };
  marketAnalysis: {
    trend: string;
    volatility: string;
    momentum: string;
    support: number;
    resistance: number;
    keyLevels: number[];
  };
  performance: {
    expectedWinRate: number;
    riskRewardRatio: number;
    expectedReturn: number;
    maxDrawdown: number;
  };
  alerts: {
    level: 'INFO' | 'WARNING' | 'CRITICAL';
    message: string;
    timestamp: number;
  }[];
  // 新增：动态EV门控计算结果，便于前端/调用方直接读取
  gating?: {
    ev: number;                // 预测期望收益（与 performance.expectedReturn 一致）
    evThreshold: number;       // 动态EV阈值（基础+波动），expectedReturn 已含交易成本
    evOk: boolean;             // 是否通过EV门槛
    regimeOk: boolean;         // 是否通过市场状态门控
    fgi?: number;              // 当次分析使用的情绪分值（如有）
    funding?: number;          // 当次资金费率（如有）
    components: {              // 阈值组成明细
      baseEv: number;
      volAdjust: number;
      cost: number;
      volPct: number;
    };
  };
}

// 持仓信息
export interface Position {
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  // 新增：分批止盈目标与命中标记
  tp1?: number;
  tp2?: number;
  tp3?: number;
  tp1Hit?: boolean;
  tp2Hit?: boolean;
  timestamp: number;
  strategyId: string;
  // 新增：用于与推荐记录建立关联的内部持仓ID
  positionId: string;
}

// 交易历史记录
export interface TradeRecord {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  action: 'OPEN' | 'CLOSE';
  size: number;
  price: number;
  pnl?: number;
  pnlPercent?: number;
  timestamp: number;
  // 允许可选，便于内部部分减仓时复用
  strategySignal?: SmartSignalResult;
  duration?: number; // 持仓时长（毫秒）
}

// 策略性能统计
export interface StrategyPerformance {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  totalPnlPercent: number;
  averageWin: number;
  averageLoss: number;
  maxWin: number;
  maxLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  averageHoldingTime: number;
  lastUpdated: number;
}

// ETH策略引擎
export class ETHStrategyEngine extends EventEmitter {
  private signalAnalyzer: SmartSignalAnalyzer;
  // private dataService: OKXDataService; // 已禁用基础服务
  private enhancedDataService: EnhancedOKXDataService;
  private mlAnalyzer: MLAnalyzer;
  private cache: NodeCache;
  private useEnhancedDataService: boolean = true;
  
  private currentPosition: Position | null = null;
  private tradeHistory: TradeRecord[] = [];
  private performance: StrategyPerformance;
  private isRunning = false;
  private lastAnalysisTime = 0;
  private analysisInterval = 30000; // 30秒分析一次
  
  // 风险控制参数
  private dailyLossLimit: number;
  private maxPositionSize: number;
  private currentDailyLoss = 0;
  private lastResetDate = new Date().toDateString();

  constructor() {
    super();
    this.signalAnalyzer = new SmartSignalAnalyzer();
    // this.dataService = new OKXDataService(); // 基础服务实例已移除
    this.enhancedDataService = enhancedOKXDataService;
    this.mlAnalyzer = new MLAnalyzer();
    this.cache = new NodeCache({ stdTTL: 300 }); // 5分钟缓存
    
    // 初始化风险控制参数
    this.dailyLossLimit = config.risk.maxDailyLoss;
    this.maxPositionSize = config.risk.maxPositionSize;
    
    // 初始化性能统计
    this.performance = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      averageWin: 0,
      averageLoss: 0,
      maxWin: 0,
      maxLoss: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      averageHoldingTime: 0,
      lastUpdated: Date.now()
    };
  }

  // 启动策略引擎
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Strategy engine is already running');
      return;
    }

    console.log('Starting ETH Strategy Engine...');
    
    // 初始化增强数据服务
    if (this.useEnhancedDataService) {
      console.log('🚀 初始化增强OKX数据服务...');
      
      // 检查增强服务连接
      const enhancedConnected = await this.enhancedDataService.checkConnection();
      if (enhancedConnected) {
        console.log('✅ 增强OKX数据服务连接成功');
      } else {
        console.warn('⚠️  增强服务连接失败，将在离线/降级模式下继续（不再回退基础服务）');
        // 不再将 useEnhancedDataService 置为 false，始终坚持使用增强服务（强制代理）
      }
    }
    
    // 取消基础服务连接检查与回退逻辑
    // if (!this.useEnhancedDataService) { ... }

    this.isRunning = true;
    this.runAnalysisLoop();
    
    console.log('ETH Strategy Engine started successfully');
  }

  // 停止策略引擎
  stop(): void {
    console.log('Stopping ETH Strategy Engine...');
    this.isRunning = false;
  }

  // 新增：对外单次分析接口（兼容调用方 API）
  // 允许传入可选的 marketData（当前实现内部自行获取数据）
  async analyzeMarket(_marketData?: MarketData): Promise<StrategyResult> {
    return await this.performAnalysis();
  }

  // 主要分析循环
  private async runAnalysisLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const now = Date.now();
        
        // 检查是否需要重置每日损失
        this.checkDailyReset();
        
        // 检查分析间隔
        if (now - this.lastAnalysisTime >= this.analysisInterval) {
          await this.performAnalysis();
          this.lastAnalysisTime = now;
        }
        
        // 更新当前持仓状态
        if (this.currentPosition) {
          await this.updatePositionStatus();
        }
        
        // 等待下一次检查
        await new Promise(resolve => setTimeout(resolve, 5000));
        
      } catch (error) {
        console.error('Analysis loop error:', error);
        await new Promise(resolve => setTimeout(resolve, 10000)); // 错误时等待更长时间
      }
    }
  }

  // 执行策略分析
  private async performAnalysis(): Promise<StrategyResult> {
    try {
      console.log('Performing strategy analysis...');
      // 新增：开始阶段进度
      try { (this as any).updateAnalysisProgress?.(0, 0, 8, '开始分析'); } catch {}
      
      // 1. 获取市场数据
      const marketData = await this.getMarketData();
      if (!marketData) {
        try { (this as any).updateAnalysisProgress?.(0.05, 1, 8, '获取市场数据失败'); } catch {}
        throw new Error('Failed to get market data');
      }
      try { (this as any).updateAnalysisProgress?.(0.125, 1, 8, '已获取市场数据'); } catch {}

      // 2. 获取K线数据
      const klineData = await this.getKlineData();
      if (klineData.length === 0) {
        try { (this as any).updateAnalysisProgress?.(0.15, 2, 8, '获取K线失败'); } catch {}
        throw new Error('Failed to get kline data');
      }
      try { (this as any).updateAnalysisProgress?.(0.25, 2, 8, '已获取K线数据'); } catch {}

      // 3. 执行智能信号分析
      const signalResult = await this.signalAnalyzer.analyzeSignal(marketData, klineData);
      try { (this as any).updateAnalysisProgress?.(0.375, 3, 8, '完成信号分析'); } catch {}
      
      // 4. 风险评估
      const riskAssessment = riskManagementService.assessSignalRisk(signalResult, marketData, this.currentPosition ? [this.currentPosition] : []);
      try { (this as any).updateAnalysisProgress?.(0.5, 4, 8, '完成风险评估'); } catch {}
      console.log(`⚠️ 风险等级: ${riskAssessment.riskLevel}, 评分: ${riskAssessment.riskScore}`);
      
      // 5. 检查是否可以开新仓
      const canTrade = riskManagementService.canOpenNewPosition(signalResult, marketData, this.currentPosition ? [this.currentPosition] : []);
      if (!canTrade.allowed) {
        console.log(`🚫 无法开仓: ${canTrade.reason}`);
      }
      try { (this as any).updateAnalysisProgress?.(0.625, 5, 8, '检查开仓条件'); } catch {}
      
      // 6. 生成策略结果
      const strategyResult = await this.generateStrategyResult(signalResult, marketData, riskAssessment);
      try { (this as any).updateAnalysisProgress?.(0.75, 6, 8, '生成策略结果'); } catch {}
      
      // 7. 执行交易决策
      await this.executeTradeDecision(strategyResult, riskAssessment, canTrade);
      try { (this as any).updateAnalysisProgress?.(0.875, 7, 8, '执行交易决策'); } catch {}
      
      // 8. 缓存结果
      this.cache.set('latest_analysis', strategyResult);
      try { (this as any).updateAnalysisProgress?.(1, 8, 8, '分析完成'); } catch {}
      
      console.log(`Analysis completed. Signal: ${signalResult.signal}, Confidence: ${signalResult.strength.confidence.toFixed(2)}`);
      
      return strategyResult;
      
    } catch (error) {
      console.error('Strategy analysis failed:', error);
      try { (this as any).updateAnalysisProgress?.(0, 0, 8, '分析失败'); } catch {}
      throw error;
    }
  }

  // 获取市场数据
  private async getMarketData(): Promise<MarketData | null> {
    const cacheKey = 'market_data';
    let marketData: MarketData | null = this.cache.get<MarketData>(cacheKey) || null;
    
    if (!marketData) {
      try {
        // 仅使用增强数据服务（强制代理）
        marketData = await this.enhancedDataService.getTicker(config.trading.defaultSymbol);
        if (marketData) {
          const [fundingRate, openInterest] = await Promise.all([
            this.enhancedDataService.getFundingRate(config.trading.defaultSymbol),
            this.enhancedDataService.getOpenInterest(config.trading.defaultSymbol)
          ]);
          marketData.fundingRate = fundingRate || 0;
          marketData.openInterest = openInterest || 0;
          // 可选：可选获取 FGI 情绪指数
          if (config.ml?.features?.sentiment?.fgi) {
            try {
              const score = await fetchFGIScore();
              if (typeof score === 'number' && Number.isFinite(score)) {
                marketData.fgiScore = Math.max(0, Math.min(100, score));
              }
            } catch (e) {
              console.warn('FGI fetch failed in strategy engine:', e instanceof Error ? e.message : e);
            }
          }
          this.cache.set(cacheKey, marketData, 30); // 30秒缓存
        }
      } catch (error) {
        console.error('Failed to get market data (enhanced):', error);
        return marketData; // 返回可能的缓存/部分结果或 null
      }
    }
    
    return marketData || null;
  }

  // 获取K线数据
  private async getKlineData(): Promise<KlineData[]> {
    const interval = (config.strategy as any)?.primaryInterval || '1m';
    const limit = (config.strategy as any)?.klineLimit || 200;
    const cacheKey = `kline_data_${interval}_${limit}`;
    let klineData = this.cache.get<KlineData[]>(cacheKey);
    
    if (!klineData) {
      try {
        // 仅使用增强数据服务（强制代理）
        klineData = await this.enhancedDataService.getKlineData(
          config.trading.defaultSymbol,
          interval,
          limit
        );
        if (klineData && klineData.length > 0) {
          this.cache.set(cacheKey, klineData, 60); // 1分钟缓存
        }
      } catch (error) {
        console.error('Failed to get kline data (enhanced):', error);
        klineData = [];
      }
    }
    
    return klineData || [];
  }

  // 生成策略结果
  private async generateStrategyResult(
    signalResult: SmartSignalResult,
    marketData: MarketData,
    riskAssessment: RiskAssessment
  ): Promise<StrategyResult> {
    // 计算支撑阻力位
    const keyLevels = await this.calculateKeyLevels(marketData.price);
    
    // 生成交易建议
    const recommendation = this.generateRecommendation(signalResult, marketData, riskAssessment);
    
    // 计算风险管理参数
    const riskManagement = this.calculateRiskManagement(signalResult, marketData, riskAssessment);
    
    // 预测性能指标
    const performance = this.predictPerformance(signalResult);

    // 新增：计算动态EV门槛（与推荐逻辑中的门控保持一致），用于对外返回
    try {
      const perfForGate = this.predictPerformance(signalResult);
      const baseEv = computeEvBaseThreshold(signalResult?.metadata?.volatility, signalResult?.metadata?.marketCondition);
      const hi = Number((marketData as any)?.high24h);
      const lo = Number((marketData as any)?.low24h);
      const atr = (Number.isFinite(hi) && Number.isFinite(lo)) ? Math.max(0, hi - lo) : 0;
      const price = Number(marketData?.price ?? 0);
      const volPct = price > 0 && atr > 0 ? Math.min(0.2, Math.max(0, atr / price)) : 0; // 上限20%
      const volAdjust = volPct * 0.5; // 波动越大，门槛抬升
      const evThreshold = baseEv + volAdjust; // expectedReturn 已扣除交易成本，阈值不再叠加成本
      const evOk = (perfForGate.expectedReturn ?? 0) >= evThreshold;

      const mr = ((config as any).strategy?.marketRegime) || {};
      const fgi = marketData.fgiScore;
      const funding = marketData.fundingRate;
      let regimeOk = true;
      if (mr.avoidExtremeSentiment === true && typeof fgi === 'number') {
        const low = mr.extremeSentimentLow ?? 10;
        const high = mr.extremeSentimentHigh ?? 90;
        if (fgi <= low || fgi >= high) regimeOk = false;
      }
      if (mr.avoidHighFunding === true && typeof funding === 'number') {
        const highFundingAbs = mr.highFundingAbs ?? 0.03;
        if (Math.abs(funding) > highFundingAbs) regimeOk = false;
      }

      logger.debug(
        'Gates | EV=%.4f thr=%.4f evOk=%s | regimeOk=%s (fgi=%s funding=%s)',
        perfForGate.expectedReturn ?? 0,
        evThreshold,
        String(evOk),
        String(regimeOk),
        typeof fgi === 'number' ? fgi.toFixed(1) : 'NA',
        typeof funding === 'number' ? funding.toFixed(4) : 'NA'
      );

      // 新增：多时间框一致性门控（可配置）。默认不开启。
      const mtf = signalResult?.metadata?.multiTFConsistency;
      const mtfAgreement = Number(mtf?.agreement ?? 0.5);
      const byTF = (mtf && typeof mtf.byTimeframe === 'object') ? mtf.byTimeframe as Record<string, { direction: 'UP'|'DOWN'|'SIDEWAYS'; strength: number; confidence: number; }> : {};
      const efMtf = (config as any)?.strategy?.entryFilters || {};
      const requireMtf = efMtf.requireMTFAgreement === true;
      const minMtfAgree = Number(efMtf.minMTFAgreement ?? 0.6);
      const need5m15m = efMtf.require5m15mAlignment === true;
      const need1hWith5m = efMtf.require1hWith5mTrend === true;
      const has5m = !!byTF['5m'];
      const has15m = !!byTF['15m'];
      const has1h = !!byTF['1H'];
      const align5m15m = has5m && has15m && byTF['5m'].direction !== 'SIDEWAYS' && byTF['5m'].direction === byTF['15m'].direction;
      const align1hWith5m = has1h && has5m && byTF['1H'].direction !== 'SIDEWAYS' && byTF['1H'].direction === byTF['5m'].direction;
      let mtfOk = true;
      if (requireMtf) {
        mtfOk = (mtfAgreement >= minMtfAgree);
        if (mtfOk && (need5m15m || need1hWith5m)) {
          if (need5m15m && !align5m15m) mtfOk = false;
          if (need1hWith5m && !align1hWith5m) mtfOk = false;
        }
      }

      logger.debug(
        'MTF | agree=%.2f thr=%.2f need(5m/15m)=%s ok=%s | need(1H&5m)=%s ok=%s',
        mtfAgreement,
        minMtfAgree,
        String(need5m15m),
        String(align5m15m),
        String(need1hWith5m),
        String(align1hWith5m)
      );

      // 计算成本用于组件展示（不参与阈值计算，因为 expectedReturn 已扣除）
      const commission = Number(((config as any).commission) ?? 0.001);
      const slippage = Number(((config as any).slippage) ?? 0.0005);
      const cost = 2 * (commission + slippage); // 开平各一次

      // 生成警告信息
      const alerts = this.generateAlerts(signalResult, marketData, riskManagement);
  
      return {
        signal: signalResult,
        recommendation,
        riskManagement,
        marketAnalysis: {
          trend: signalResult.metadata.marketCondition,
          volatility: signalResult.metadata.volatility > 0.6 ? 'HIGH' : signalResult.metadata.volatility < 0.3 ? 'LOW' : 'MEDIUM',
          momentum: signalResult.metadata.momentum,
          support: keyLevels.support,
          resistance: keyLevels.resistance,
          keyLevels: keyLevels.levels
        },
        performance,
        alerts,
        gating: {
          ev: perfForGate.expectedReturn ?? 0,
          evThreshold,
          evOk,
          regimeOk,
          fgi: typeof fgi === 'number' ? fgi : undefined,
          funding: typeof funding === 'number' ? funding : undefined,
          components: {
            baseEv: Number(baseEv) || 0,
            volAdjust,
            cost,
            volPct
          }
        }
      };
    } catch {
      // 兜底：若计算失败，仍返回无 gating 字段的结果
      const alerts = this.generateAlerts(signalResult, marketData, riskManagement);
      return {
        signal: signalResult,
        recommendation,
        riskManagement,
        marketAnalysis: {
          trend: signalResult.metadata.marketCondition,
          volatility: signalResult.metadata.volatility > 0.6 ? 'HIGH' : signalResult.metadata.volatility < 0.3 ? 'LOW' : 'MEDIUM',
          momentum: signalResult.metadata.momentum,
          support: keyLevels.support,
          resistance: keyLevels.resistance,
          keyLevels: keyLevels.levels
        },
        performance,
        alerts
      };
    }
  }

  // 生成交易建议
  private generateRecommendation(
    signalResult: SmartSignalResult,
    marketData: MarketData,
    riskAssessment: RiskAssessment
  ): StrategyResult['recommendation'] {
    let action: StrategyResult['recommendation']['action'] = 'HOLD';
    let urgency: StrategyResult['recommendation']['urgency'] = 'LOW';
    
    // 检查是否超过每日损失限制
    if (this.currentDailyLoss >= this.dailyLossLimit) {
      return {
        action: 'HOLD',
        confidence: 0,
        urgency: 'LOW',
        timeframe: '暂停交易'
      };
    }

    // 如果有持仓，优先考虑平仓
    if (this.currentPosition) {
      const shouldClose = this.shouldClosePosition(signalResult, marketData);
      if (shouldClose.close) {
        return {
          action: 'CLOSE_POSITION',
          confidence: shouldClose.confidence,
          urgency: shouldClose.urgency,
          timeframe: signalResult.timeframe
        };
      }
      
      // 检查是否需要减仓
      if (shouldClose.reduce) {
        return {
          action: 'REDUCE_POSITION',
          confidence: shouldClose.confidence * 0.7,
          urgency: 'MEDIUM',
          timeframe: signalResult.timeframe
        };
      }
    }

    // 1H入场过滤规则：趋势方向/强度、综合强度阈值、高波动过滤
    const ef = (config.strategy as any)?.entryFilters || {};
    const combined = signalResult.strength.combined || 0;
    const trendDir = signalResult.metadata.trendDirection;
    const trendStrength = signalResult.metadata.trendStrength || 0;
    const highVol = (signalResult.metadata.volatility || 0) >= 0.7;

    const trendOkLong = !ef.trendFilter || (trendDir === 'UP' && trendStrength >= 5);
    const trendOkShort = !ef.trendFilter || (trendDir === 'DOWN' && trendStrength >= 5);

    const strengthOkLong = combined >= (ef.minCombinedStrengthLong ?? 65);
    const strengthOkShort = combined >= (ef.minCombinedStrengthShort ?? 65);

    const volOk = !highVol || (ef.allowHighVolatilityEntries === true) || combined >= ((ef.minCombinedStrengthLong ?? 65) + 10);

    // 新增：BOLL过滤（基于分析器元数据），避免追涨杀跌与窄带震荡
    const bollPos = signalResult.metadata?.bollingerPosition;
    const bandwidth = signalResult.metadata?.bollingerBandwidth;
    const bollOkLong = (typeof bollPos !== 'number') ? true : (bollPos <= 0.35);
    const bollOkShort = (typeof bollPos !== 'number') ? true : (bollPos >= 0.65);
    const squeeze = (typeof bandwidth === 'number') ? (bandwidth < 0.02) : false;
    const squeezeOk = !squeeze || combined >= ((ef.minCombinedStrengthLong ?? 65) + 10);

    // 调试日志：输出入场过滤每一项判断与关键阈值
    logger.debug(
      'EntryFilters | tf=%s signal=%s combined=%.2f conf=%.2f thr(signal)=%.2f risk=%s | trend=%s(%.1f) okL=%s okS=%s | highVol=%s volOk=%s allowHighVol=%s | bollPos=%s bw=%.4f squeeze=%s squeezeOk=%s | minStrength L=%s S=%s',
      signalResult.timeframe,
      signalResult.signal,
      combined,
      signalResult.strength?.confidence ?? 0,
      config.strategy.signalThreshold,
      riskAssessment.riskLevel,
      trendDir ?? 'NA',
      trendStrength,
      String(trendOkLong),
      String(trendOkShort),
      String(highVol),
      String(volOk),
      String(ef.allowHighVolatilityEntries === true),
      (typeof bollPos === 'number' ? bollPos.toFixed(3) : 'NA'),
      Number.isFinite(bandwidth as number) ? (bandwidth as number).toFixed(4) : 0,
      String(squeeze),
      String(squeezeOk),
      String(ef.minCombinedStrengthLong ?? 65),
      String(ef.minCombinedStrengthShort ?? 65)
    );

    // 新增：EV 门槛与市场状态门控（默认不生效，配置后启用）
    const perfForGate = this.predictPerformance(signalResult);
    // 动态EV阈值：基础门槛 + 波动/成本自适应
    const baseEv = computeEvBaseThreshold(signalResult?.metadata?.volatility, signalResult?.metadata?.marketCondition);
    const hi = Number((marketData as any)?.high24h);
    const lo = Number((marketData as any)?.low24h);
    const atr = (Number.isFinite(hi) && Number.isFinite(lo)) ? Math.max(0, hi - lo) : 0;
    const price = Number(marketData?.price ?? 0);
    const volPct = price > 0 && atr > 0 ? Math.min(0.2, Math.max(0, atr / price)) : 0; // 上限20%
    const volAdjust = volPct * 0.5; // 波动越大，门槛抬升
    const evThreshold = baseEv + volAdjust; // expectedReturn 已扣除交易成本，阈值不再叠加成本
    const evOk = (perfForGate.expectedReturn ?? 0) >= evThreshold;

    const mr = ((config as any).strategy?.marketRegime) || {};
    const fgi = marketData.fgiScore;
    const funding = marketData.fundingRate;
    let regimeOk = true;
    if (mr.avoidExtremeSentiment === true && typeof fgi === 'number') {
      const low = mr.extremeSentimentLow ?? 10;
      const high = mr.extremeSentimentHigh ?? 90;
      if (fgi <= low || fgi >= high) regimeOk = false;
    }
    if (mr.avoidHighFunding === true && typeof funding === 'number') {
      const highFundingAbs = mr.highFundingAbs ?? 0.03;
      if (Math.abs(funding) > highFundingAbs) regimeOk = false;
    }

    logger.debug(
      'Gates | EV=%.4f thr=%.4f evOk=%s | regimeOk=%s (fgi=%s funding=%s)',
      perfForGate.expectedReturn ?? 0,
      evThreshold,
      String(evOk),
      String(regimeOk),
      typeof fgi === 'number' ? fgi.toFixed(1) : 'NA',
      typeof funding === 'number' ? funding.toFixed(4) : 'NA'
    );

    // 新增：多时间框一致性门控（可配置）。默认不开启。
    const mtf = signalResult?.metadata?.multiTFConsistency;
    const mtfAgreement = Number(mtf?.agreement ?? 0.5);
    const byTF = (mtf && typeof mtf.byTimeframe === 'object') ? mtf.byTimeframe as Record<string, { direction: 'UP'|'DOWN'|'SIDEWAYS'; strength: number; confidence: number; }> : {};
    const efMtf = (config as any)?.strategy?.entryFilters || {};
    const requireMtf = efMtf.requireMTFAgreement === true;
    const minMtfAgree = Number(efMtf.minMTFAgreement ?? 0.6);
    const need5m15m = efMtf.require5m15mAlignment === true;
    const need1hWith5m = efMtf.require1hWith5mTrend === true;
    const has5m = !!byTF['5m'];
    const has15m = !!byTF['15m'];
    const has1h = !!byTF['1H'];
    const align5m15m = has5m && has15m && byTF['5m'].direction !== 'SIDEWAYS' && byTF['5m'].direction === byTF['15m'].direction;
    const align1hWith5m = has1h && has5m && byTF['1H'].direction !== 'SIDEWAYS' && byTF['1H'].direction === byTF['5m'].direction;
    let mtfOk = true;
    if (requireMtf) {
      mtfOk = (mtfAgreement >= minMtfAgree);
      if (mtfOk && (need5m15m || need1hWith5m)) {
        if (need5m15m && !align5m15m) mtfOk = false;
        if (need1hWith5m && !align1hWith5m) mtfOk = false;
      }
    }

    logger.debug(
      'MTF | agree=%.2f thr=%.2f need(5m/15m)=%s ok=%s | need(1H&5m)=%s ok=%s',
      mtfAgreement,
      minMtfAgree,
      String(need5m15m),
      String(align5m15m),
      String(need1hWith5m),
      String(align1hWith5m)
    );

    // 新开仓逻辑 - 考虑风险评估与过滤器
    if (!this.currentPosition && signalResult.strength.confidence >= config.strategy.signalThreshold && riskAssessment.riskLevel !== 'EXTREME') {
      if ((signalResult.signal === 'STRONG_BUY' || signalResult.signal === 'BUY') && trendOkLong && strengthOkLong && volOk && bollOkLong && squeezeOk && mtfOk && evOk && regimeOk) {
        logger.debug('Decision: OPEN_LONG | price=%s', String(marketData.price));
        action = 'OPEN_LONG';
        urgency = (signalResult.signal === 'STRONG_BUY' && riskAssessment.riskLevel === 'LOW' && combined >= 75) ? 'HIGH' : 'MEDIUM';
      } else if ((signalResult.signal === 'STRONG_SELL' || signalResult.signal === 'SELL') && trendOkShort && strengthOkShort && volOk && bollOkShort && squeezeOk && mtfOk && evOk && regimeOk) {
        logger.debug('Decision: OPEN_SHORT | price=%s', String(marketData.price));
        action = 'OPEN_SHORT';
        urgency = (signalResult.signal === 'STRONG_SELL' && riskAssessment.riskLevel === 'LOW' && combined >= 75) ? 'HIGH' : 'MEDIUM';
      } else {
        logger.debug('Decision: HOLD (filters/gates not satisfied)');
      }
    } else {
      logger.debug(
        'Skip Open: pos=%s conf=%.2f<thr? %s risk=%s',
        String(!!this.currentPosition),
        signalResult.strength?.confidence ?? 0,
        String((signalResult.strength?.confidence ?? 0) < config.strategy.signalThreshold),
        riskAssessment.riskLevel
      );
    }

    return {
      action,
      confidence: signalResult.strength.confidence * (riskAssessment.riskLevel === 'LOW' ? 1 : riskAssessment.riskLevel === 'MEDIUM' ? 0.8 : 0.5),
      urgency,
      timeframe: signalResult.timeframe
    };
  }

  // 判断是否应该平仓
  private shouldClosePosition(
    signalResult: SmartSignalResult,
    marketData: MarketData
  ): { close: boolean; reduce: boolean; confidence: number; urgency: StrategyResult['recommendation']['urgency'] } {
    if (!this.currentPosition) {
      return { close: false, reduce: false, confidence: 0, urgency: 'LOW' };
    }

    const position = this.currentPosition;
    const currentPrice = marketData.price;
    const pnlPercent = position.unrealizedPnlPercent;

    // 止损条件
    if ((position.side === 'LONG' && currentPrice <= position.stopLoss) ||
        (position.side === 'SHORT' && currentPrice >= position.stopLoss)) {
      return { close: true, reduce: false, confidence: 0.9, urgency: 'HIGH' };
    }

    // 止盈条件
    if ((position.side === 'LONG' && currentPrice >= position.takeProfit) ||
        (position.side === 'SHORT' && currentPrice <= position.takeProfit)) {
      return { close: true, reduce: false, confidence: 0.8, urgency: 'MEDIUM' };
    }

    // 信号反转条件
    if ((position.side === 'LONG' && (signalResult.signal === 'SELL' || signalResult.signal === 'STRONG_SELL')) ||
        (position.side === 'SHORT' && (signalResult.signal === 'BUY' || signalResult.signal === 'STRONG_BUY'))) {
      const confidence = signalResult.strength.confidence;
      if (confidence >= 0.8) {
        return { close: true, reduce: false, confidence, urgency: 'HIGH' };
      } else if (confidence >= 0.6) {
        return { close: false, reduce: true, confidence, urgency: 'MEDIUM' };
      }
    }

    // 基于配置的时间止损策略
    const holdingTime = Date.now() - position.timestamp;
    const recCfg = (config as any)?.recommendation || {};
    const maxHoldingMs = (Number(recCfg.maxHoldingHours || 0) > 0) ? Number(recCfg.maxHoldingHours) * 3600 * 1000 : 0;
    const minHoldingMs = (Number(recCfg.minHoldingMinutes || 0) > 0) ? Number(recCfg.minHoldingMinutes) * 60 * 1000 : 0;

    // 达到最大持仓时长：直接平仓
    if (maxHoldingMs > 0 && holdingTime > maxHoldingMs) {
      return { close: true, reduce: false, confidence: 0.65, urgency: 'MEDIUM' };
    }
    // 超过最小持仓时间后，若亏损较多先减仓，避免更大回撤
    if (minHoldingMs > 0 && holdingTime > minHoldingMs && pnlPercent < -0.5) {
      return { close: false, reduce: true, confidence: 0.7, urgency: 'MEDIUM' };
    }
    // 长时间仍显著亏损：直接平仓（取更保守阈值）
    if (minHoldingMs > 0 && holdingTime > Math.max(minHoldingMs * 3, 12 * 60 * 60 * 1000) && pnlPercent < -1) {
      return { close: true, reduce: false, confidence: 0.6, urgency: 'MEDIUM' };
    }

    return { close: false, reduce: false, confidence: 0, urgency: 'LOW' };
  }

  // 计算风险管理参数
  private calculateRiskManagement(
    signalResult: SmartSignalResult,
    marketData: MarketData,
    riskAssessment: RiskAssessment
  ): StrategyResult['riskManagement'] {
    // 使用新的自适应仓位与杠杆计算
    const adaptiveSizing = riskManagementService.computeAdaptiveSizing(
      {
        confidence: signalResult.strength.confidence,
        riskReward: signalResult.riskReward || riskAssessment.riskRewardRatio,
        positionSize: signalResult.positionSize,
        signal: signalResult.signal,
        metadata: signalResult.metadata
      },
      marketData,
      this.currentPosition ? [this.currentPosition] : []
    );

    // 应用情绪与布林带极端位置的额外调整
    const fgi = marketData.fgiScore;
    const bollPosAdj = signalResult.metadata?.bollingerPosition;
    const bollBandwidth = signalResult.metadata?.bollingerBandwidth;

    let sentimentAdj = 1.0;
    if (typeof fgi === 'number') {
      if (fgi <= 20 || fgi >= 80) sentimentAdj *= 0.8;       // 极端情绪，降权20%
      else if (fgi <= 40 || fgi >= 60) sentimentAdj *= 0.9;   // 较极端，降权10%
    }
    if (typeof bollPosAdj === 'number') {
      if ((signalResult.signal === 'BUY' || signalResult.signal === 'STRONG_BUY') && bollPosAdj > 0.8) sentimentAdj *= 0.85; // 上轨附近不追多
      if ((signalResult.signal === 'SELL' || signalResult.signal === 'STRONG_SELL') && bollPosAdj < 0.2) sentimentAdj *= 0.85; // 下轨附近不追空
    }

    // 最终仓位大小（应用情绪调整）
    const finalPositionSize = Math.max(0.01, adaptiveSizing.positionSize * sentimentAdj);

    // 杠杆调整（应用市场条件调整）
     let leverage = adaptiveSizing.leverage;
     if (typeof fgi === 'number' && (fgi <= 20 || fgi >= 80)) {
       leverage = Math.max(3, Math.floor(leverage * 0.8)); // 极端情绪下调杠杆，最低3倍
     }
     if (typeof bollBandwidth === 'number' && bollBandwidth < 0.02) {
       leverage = Math.max(3, Math.floor(leverage * 0.9)); // 窄带震荡降低杠杆，最低3倍
     }

     // 确保杠杆在3-20倍范围内
     leverage = Math.max(3, Math.min(20, leverage));

    const maxLoss = finalPositionSize * config.risk.stopLossPercent;
    
    return {
      maxLoss,
      positionSize: finalPositionSize,
      leverage,
      stopLoss: riskAssessment.stopLossPrice,
      takeProfit: riskAssessment.takeProfitPrice,
      riskScore: riskAssessment.riskScore
    };
  }

  // 计算综合风险评分
  private calculateOverallRiskScore(
    signalResult: SmartSignalResult,
    marketData: MarketData
  ): number {
    let riskScore = 5; // 基础风险评分
    
    // 市场波动性风险
    if (signalResult.metadata.volatility > 0.7) riskScore += 2;
    else if (signalResult.metadata.volatility < 0.3) riskScore -= 1;
    
    // 成交量风险
    if (signalResult.metadata.volume === 'LOW') riskScore += 1;
    
    // 资金费率风险
    if (marketData.fundingRate && Math.abs(marketData.fundingRate) > 0.01) {
      riskScore += 1;
    }
    
    // 每日损失风险
    const dailyLossRatio = this.currentDailyLoss / this.dailyLossLimit;
    riskScore += dailyLossRatio * 3;
    
    // 信号置信度风险
    if (signalResult.strength.confidence < 0.6) riskScore += 2;
    
    return Math.max(1, Math.min(10, riskScore));
  }

  // 预测性能指标
  private predictPerformance(signalResult: SmartSignalResult): StrategyResult['performance'] {
    // 基于历史表现和当前信号强度预测
    const baseWinRate = this.performance.winRate || 0.6;
    const confidenceBonus = (signalResult.strength.confidence - 0.5) * 0.2;
    const expectedWinRate = Math.min(0.9, Math.max(0.3, baseWinRate + confidenceBonus));
    
    // 新增：将手续费与滑点成本计入期望收益
    const commission = Number(((config as any).commission) ?? 0.001);
    const slippage = Number(((config as any).slippage) ?? 0.0005);
    const tradingCost = 2 * (commission + slippage); // 开仓+平仓
    const expectedReturnGross = signalResult.riskReward * expectedWinRate - (1 - expectedWinRate);
    const expectedReturn = expectedReturnGross - tradingCost;
    
    return {
      expectedWinRate,
      riskRewardRatio: signalResult.riskReward,
      expectedReturn,
      maxDrawdown: this.performance.maxDrawdown || 0.1
    };
  }

  // 生成警告信息
  private generateAlerts(
    signalResult: SmartSignalResult,
    marketData: MarketData,
    riskManagement: StrategyResult['riskManagement']
  ): StrategyResult['alerts'] {
    const alerts: StrategyResult['alerts'] = [];
    
    // 高风险警告
    if (riskManagement.riskScore >= 8) {
      alerts.push({
        level: 'CRITICAL',
        message: '当前市场风险极高，建议谨慎操作或暂停交易',
        timestamp: Date.now()
      });
    } else if (riskManagement.riskScore >= 6) {
      alerts.push({
        level: 'WARNING',
        message: '市场风险较高，建议减少仓位',
        timestamp: Date.now()
      });
    }
    
    // 每日损失警告
    const dailyLossRatio = this.currentDailyLoss / this.dailyLossLimit;
    if (dailyLossRatio >= 0.8) {
      alerts.push({
        level: 'CRITICAL',
        message: '接近每日损失限制，建议停止交易',
        timestamp: Date.now()
      });
    } else if (dailyLossRatio >= 0.6) {
      alerts.push({
        level: 'WARNING',
        message: '每日损失较大，建议控制风险',
        timestamp: Date.now()
      });
    }

    // 新增：情绪（FGI）极端警告
    const fgi = typeof (marketData as any).fgiScore === 'number' ? (marketData as any).fgiScore as number : undefined;
    if (typeof fgi === 'number' && Number.isFinite(fgi)) {
      if (fgi <= 10) {
        alerts.push({ level: 'CRITICAL', message: `极度恐惧(FGI=${fgi.toFixed(0)})：谨慎抄底，控制杠杆/仓位`, timestamp: Date.now() });
      } else if (fgi <= 20) {
        alerts.push({ level: 'WARNING', message: `恐惧(FGI=${fgi.toFixed(0)})：避免追空，优先等待确认`, timestamp: Date.now() });
      }
      if (fgi >= 90) {
        alerts.push({ level: 'CRITICAL', message: `极度贪婪(FGI=${fgi.toFixed(0)})：防止顶部追多，收紧风控`, timestamp: Date.now() });
      } else if (fgi >= 80) {
        alerts.push({ level: 'WARNING', message: `贪婪(FGI=${fgi.toFixed(0)})：提高止盈纪律，谨防回撤`, timestamp: Date.now() });
      }
    }

    // 新增：布林带位置/带宽预警
    const meta = signalResult.metadata || {} as any;
    const bp = typeof meta.bollingerPosition === 'number' ? meta.bollingerPosition as number : undefined; // 0~1
    const bw = typeof meta.bollingerBandwidth === 'number' ? meta.bollingerBandwidth as number : undefined; // 相对宽度

    if (typeof bp === 'number' && Number.isFinite(bp)) {
      if (bp <= 0.05) {
        alerts.push({ level: 'CRITICAL', message: '价格贴近布林下轨，存在加速下破或技术性反弹的双向风险', timestamp: Date.now() });
      } else if (bp <= 0.2) {
        alerts.push({ level: 'WARNING', message: '价格靠近布林下轨，做空需防反弹，做多需等待确认', timestamp: Date.now() });
      }
      if (bp >= 0.95) {
        alerts.push({ level: 'CRITICAL', message: '价格贴近布林上轨，存在冲顶回落或趋势加速的双向风险', timestamp: Date.now() });
      } else if (bp >= 0.8) {
        alerts.push({ level: 'WARNING', message: '价格靠近布林上轨，追多需谨慎，关注背离/放量', timestamp: Date.now() });
      }
    }

    if (typeof bw === 'number' && Number.isFinite(bw)) {
      // Squeeze 收缩与扩张阈值可根据经验/品种调整
      if (bw <= 0.02) {
        alerts.push({ level: 'WARNING', message: '布林带极度收窄（Squeeze），或将迎来方向性突破，注意仓位控制', timestamp: Date.now() });
      } else if (bw >= 0.08) {
        alerts.push({ level: 'WARNING', message: '布林带显著扩张，当前波动率较高，止损需更紧或仓位更小', timestamp: Date.now() });
      }
    }
    
    // 低置信度警告
    if (signalResult.strength.confidence < 0.5) {
      alerts.push({
        level: 'WARNING',
        message: '信号置信度较低，建议观望',
        timestamp: Date.now()
      });
    }
    
    // 市场异常警告
    if (marketData.change24h > 15 || marketData.change24h < -15) {
      alerts.push({
        level: 'WARNING',
        message: '市场波动异常，注意风险控制',
        timestamp: Date.now()
      });
    }
    
    return alerts;
  }

  // 执行交易决策
  private async executeTradeDecision(strategyResult: StrategyResult, riskAssessment: RiskAssessment, canTrade: { allowed: boolean; reason?: string }): Promise<void> {
    const { recommendation, riskManagement } = strategyResult;
    
    // 这里是模拟交易，实际应该调用交易API
    console.log(`Trade Decision: ${recommendation.action}, Confidence: ${recommendation.confidence.toFixed(2)}`);
    
    // 检查是否允许交易
    if (!canTrade.allowed && (recommendation.action === 'OPEN_LONG' || recommendation.action === 'OPEN_SHORT')) {
      console.log(`🚫 交易被风险管理限制: ${canTrade.reason}`);
      return;
    }
    
    switch (recommendation.action) {
      case 'OPEN_LONG':
        await this.openPosition('LONG', riskManagement, strategyResult, riskAssessment);
        break;
      case 'OPEN_SHORT':
        await this.openPosition('SHORT', riskManagement, strategyResult, riskAssessment);
        break;
      case 'CLOSE_POSITION':
        await this.closePosition(strategyResult);
        break;
      case 'REDUCE_POSITION':
        await this.reducePosition(0.5, strategyResult);
        break;
      default:
        // HOLD - 不执行任何操作
        break;
    }
  }

  // 开仓
  private async openPosition(
    side: 'LONG' | 'SHORT',
    riskManagement: StrategyResult['riskManagement'],
    strategyResult: StrategyResult,
    riskAssessment: RiskAssessment
  ): Promise<void> {
    if (this.currentPosition) {
      console.log('Already have position, cannot open new one');
      return;
    }

    const marketData = await this.getMarketData();
    if (!marketData) return;

    // 计算分批止盈目标（基于初始TP距离）
    const sign = side === 'LONG' ? 1 : -1;
    const baseDistance = Math.abs(riskManagement.takeProfit - marketData.price);
    const tp1 = marketData.price + sign * baseDistance * 0.6; // 先行落袋为安，提高胜率
    const tp2 = riskManagement.takeProfit;                     // 原始目标
    const tp3 = marketData.price + sign * baseDistance * 1.2;  // 拉伸目标

    const positionId = `pos_${Date.now()}`;

    const position: Position = {
      symbol: config.trading.defaultSymbol,
      side,
      size: riskManagement.positionSize,
      entryPrice: marketData.price,
      currentPrice: marketData.price,
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0,
      leverage: riskManagement.leverage,
      stopLoss: riskManagement.stopLoss,
      takeProfit: tp2,
      tp1,
      tp2,
      tp3,
      tp1Hit: false,
      tp2Hit: false,
      timestamp: Date.now(),
      strategyId: `strategy_${Date.now()}`,
      positionId
    };

    this.currentPosition = position;
    
    // 记录交易
    const tradeRecord: TradeRecord = {
      id: `trade_${Date.now()}`,
      symbol: position.symbol,
      side: position.side,
      action: 'OPEN',
      size: position.size,
      price: position.entryPrice,
      timestamp: position.timestamp,
      strategySignal: strategyResult.signal
    };
    
    this.tradeHistory.push(tradeRecord);
    
    console.log(`Opened ${side} position: ${position.size} at ${position.entryPrice} (TP1=${tp1.toFixed(2)}, TP2=${tp2.toFixed(2)}, TP3=${tp3.toFixed(2)}) (Risk Level: ${riskAssessment.riskLevel})`);

    // 新增：发出开仓事件，供推荐系统建立映射与保存推荐
    try {
      this.emit('position-opened', {
        position: { ...position },
        riskAssessment,
        strategyResult
      });
    } catch {}
  }

  // 平仓
  private async closePosition(strategyResult: StrategyResult): Promise<void> {
    if (!this.currentPosition) {
      console.log('No position to close');
      return;
    }

    const marketData = await this.getMarketData();
    if (!marketData) return;

    const position = this.currentPosition;
    const closePrice = marketData.price;
    const pnl = this.calculatePnL(position, closePrice);
    const pnlPercent = (pnl / (position.entryPrice * position.size)) * 100;
    const duration = Date.now() - position.timestamp;

    // 记录交易
    const tradeRecord: TradeRecord = {
      id: `trade_${Date.now()}`,
      symbol: position.symbol,
      side: position.side,
      action: 'CLOSE',
      size: position.size,
      price: closePrice,
      pnl,
      pnlPercent,
      timestamp: Date.now(),
      strategySignal: strategyResult.signal,
      duration
    };
    
    this.tradeHistory.push(tradeRecord);
    
    // 更新每日损失
    if (pnl < 0) {
      this.currentDailyLoss += Math.abs(pnl);
    }
    
    // 更新性能统计
    this.updatePerformanceStats(tradeRecord);
    
    console.log(`Closed ${position.side} position: PnL = ${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);

    // 新增：发出平仓事件，默认作为手动/策略指令平仓
    try {
      this.emit('position-closed', {
        position: { ...position },
        trade: { ...tradeRecord },
        reason: 'MANUAL' as const
      });
    } catch {}
    
    this.currentPosition = null;
  }

  // 减仓
  private async reducePosition(
    reductionRatio: number,
    strategyResult?: StrategyResult
  ): Promise<void> {
    if (!this.currentPosition) return;

    const marketData = await this.getMarketData();
    if (!marketData) return;

    const position = this.currentPosition;
    const reduceSize = position.size * reductionRatio;
    const closePrice = marketData.price;
    const pnl = this.calculatePnL({ ...position, size: reduceSize }, closePrice);
    
    // 更新持仓
    position.size -= reduceSize;
    
    // 记录部分平仓交易
    const tradeRecord: TradeRecord = {
      id: `trade_${Date.now()}`,
      symbol: position.symbol,
      side: position.side,
      action: 'CLOSE',
      size: reduceSize,
      price: closePrice,
      pnl,
      pnlPercent: (pnl / (position.entryPrice * reduceSize)) * 100,
      timestamp: Date.now(),
      strategySignal: strategyResult?.signal
    };
    
    this.tradeHistory.push(tradeRecord);
    
    console.log(`Reduced position by ${(reductionRatio * 100).toFixed(1)}%`);

    // 新增：发出减仓事件
    try {
      this.emit('position-reduced', {
        position: { ...position },
        trade: { ...tradeRecord },
        reductionRatio
      });
    } catch {}
  }

  // 更新持仓状态
  private async updatePositionStatus(): Promise<void> {
    if (!this.currentPosition) return;

    const marketData = await this.getMarketData();
    if (!marketData) return;

    const position = this.currentPosition;
    position.currentPrice = marketData.price;
    position.unrealizedPnl = this.calculatePnL(position, marketData.price);
    position.unrealizedPnlPercent = (position.unrealizedPnl / (position.entryPrice * position.size)) * 100;
    
    // 命中TP1：减仓50%并将止损上移至保本
    if (!position.tp1Hit && position.tp1 !== undefined) {
      const hitTp1 = (position.side === 'LONG' && marketData.price >= position.tp1) ||
                     (position.side === 'SHORT' && marketData.price <= position.tp1);
      if (hitTp1) {
        const latest = this.getLatestAnalysis();
        if (latest) {
          await this.reducePosition(0.5, latest);
        } else {
          await this.reducePosition(0.5);
        }
        // 上移止损到保本
        const prevSL = position.stopLoss;
        if (position.side === 'LONG') {
          position.stopLoss = Math.max(position.stopLoss, position.entryPrice);
        } else {
          position.stopLoss = Math.min(position.stopLoss, position.entryPrice);
        }
        position.tp1Hit = true;
        console.log('TP1 reached: moved stop to breakeven');
        // 新增：发出 TP1 事件
        try {
          this.emit('position-tp1', {
            position: { ...position },
            previousStopLoss: prevSL
          });
        } catch {}
      }
    }

    // 命中TP2：对剩余仓位再减仓50%，并将止损抬到TP1锁定利润
    if (position.tp1Hit && !position.tp2Hit && position.tp2 !== undefined) {
      const hitTp2 = (position.side === 'LONG' && marketData.price >= position.tp2) ||
                     (position.side === 'SHORT' && marketData.price <= position.tp2);
      if (hitTp2) {
        const latest = this.getLatestAnalysis();
        if (latest) {
          await this.reducePosition(0.5, latest);
        } else {
          await this.reducePosition(0.5);
        }
        // 将止损抬到TP1位置
        const prevSL2 = position.stopLoss;
        if (position.tp1 !== undefined) {
          if (position.side === 'LONG') {
            position.stopLoss = Math.max(position.stopLoss, position.tp1);
          } else {
            position.stopLoss = Math.min(position.stopLoss, position.tp1);
          }
        }
        // 更新剩余仓位的止盈到 TP3，让利润奔跑
        const prevTP = position.takeProfit;
        if (position.tp3 !== undefined) {
          position.takeProfit = position.tp3;
        }
        position.tp2Hit = true;
        console.log('TP2 reached: tightened stop to TP1 and set TP to TP3');
        // 新增：发出 TP2 事件
        try {
          this.emit('position-tp2', {
            position: { ...position },
            previousStopLoss: prevSL2,
            previousTakeProfit: prevTP
          });
        } catch {}
      }
    }
    
    // 分析持仓风险
    const positionRisk = riskManagementService.analyzePositionRisk(position, marketData.price);
    if (positionRisk.distanceToLiquidation < 0.1) {
      console.log(`⚠️ 警告: 距离强平价格过近 ${(positionRisk.distanceToLiquidation * 100).toFixed(2)}%`);
    }
  }

  // 计算盈亏
  private calculatePnL(position: Position, currentPrice: number): number {
    const priceChange = position.side === 'LONG' 
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;
    
    return priceChange * position.size * position.leverage;
  }

  // 计算关键价位
  private async calculateKeyLevels(currentPrice: number): Promise<{
    support: number;
    resistance: number;
    levels: number[];
  }> {
    // 简化的支撑阻力计算，实际应该基于历史价格数据
    const range = currentPrice * 0.02; // 2%范围
    
    return {
      support: currentPrice - range,
      resistance: currentPrice + range,
      levels: [
        currentPrice - range * 2,
        currentPrice - range,
        currentPrice,
        currentPrice + range,
        currentPrice + range * 2
      ]
    };
  }

  // 更新性能统计
  private updatePerformanceStats(trade: TradeRecord): void {
    if (trade.action !== 'CLOSE' || trade.pnl === undefined) return;

    this.performance.totalTrades++;
    this.performance.totalPnl += trade.pnl;
    this.performance.totalPnlPercent += trade.pnlPercent || 0;

    if (trade.pnl > 0) {
      this.performance.winningTrades++;
      this.performance.maxWin = Math.max(this.performance.maxWin, trade.pnl);
    } else {
      this.performance.losingTrades++;
      this.performance.maxLoss = Math.min(this.performance.maxLoss, trade.pnl);
    }

    this.performance.winRate = this.performance.winningTrades / this.performance.totalTrades;
    
    // 计算平均盈亏
    if (this.performance.winningTrades > 0) {
      const totalWins = this.tradeHistory
        .filter(t => t.action === 'CLOSE' && (t.pnl || 0) > 0)
        .reduce((sum, t) => sum + (t.pnl || 0), 0);
      this.performance.averageWin = totalWins / this.performance.winningTrades;
    }
    
    if (this.performance.losingTrades > 0) {
      const totalLosses = this.tradeHistory
        .filter(t => t.action === 'CLOSE' && (t.pnl || 0) < 0)
        .reduce((sum, t) => sum + (t.pnl || 0), 0);
      this.performance.averageLoss = totalLosses / this.performance.losingTrades;
    }

    // 计算盈利因子
    if (this.performance.averageLoss !== 0) {
      this.performance.profitFactor = Math.abs(this.performance.averageWin / this.performance.averageLoss);
    }

    // 新增：计算夏普比率与最大回撤
    try {
      const portfolio = riskManagementService.analyzePortfolioRisk(
        this.currentPosition ? [this.currentPosition] : [],
        this.tradeHistory
      );
      // 夏普比率直接使用
      this.performance.sharpeRatio = Number.isFinite(portfolio.sharpeRatio) ? portfolio.sharpeRatio : 0;
      // 风险服务返回的最大回撤是百分比数值（例如 12.34），转换为小数（0.1234）供前端乘以100显示
      const mddPercent = Number.isFinite(portfolio.maxDrawdown) ? portfolio.maxDrawdown : 0;
      this.performance.maxDrawdown = (Number(mddPercent) || 0) / 100;
    } catch (_) {
      // 避免计算异常影响主流程
    }

    this.performance.lastUpdated = Date.now();
  }

  // 检查每日重置
  private checkDailyReset(): void {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.currentDailyLoss = 0;
      this.lastResetDate = today;
      console.log('Daily loss counter reset');
    }
  }

  // 获取当前状态
  getCurrentStatus(): {
    isRunning: boolean;
    position: Position | null;
    performance: StrategyPerformance;
    dailyLoss: number;
    dailyLossLimit: number;
  } {
    return {
      isRunning: this.isRunning,
      position: this.currentPosition,
      performance: this.performance,
      dailyLoss: this.currentDailyLoss,
      dailyLossLimit: this.dailyLossLimit
    };
  }

  // 获取最新分析结果
  getLatestAnalysis(): StrategyResult | null {
    return this.cache.get<StrategyResult>('latest_analysis') || null;
  }

  // 获取交易历史
  getTradeHistory(limit: number = 50): TradeRecord[] {
    return this.tradeHistory.slice(-limit);
  }

  // 设置分析间隔
  setAnalysisInterval(intervalMs: number): void {
    this.analysisInterval = Math.max(10000, intervalMs); // 最小10秒
  }

  // 新增：获取当前分析间隔（毫秒）
  getAnalysisInterval(): number {
    return this.analysisInterval;
  }

  // 新增：获取分析实时进度
  getAnalysisProgress(): { percent: number; step: number; total: number; label: string; startedAt: number; updatedAt: number } | null {
    try {
      return this.cache.get('analysis_progress') || null;
    } catch {
      return null;
    }
  }

  // 新增：更新分析实时进度
  private updateAnalysisProgress(percent: number, step: number, total: number, label: string): void {
    try {
      const prev: any = this.cache.get('analysis_progress');
      const startedAt = prev?.startedAt || Date.now();
      const payload = {
        percent: Math.max(0, Math.min(1, Number(percent) || 0)),
        step: Number(step) || 0,
        total: Number(total) || 0,
        label: String(label || ''),
        startedAt,
        updatedAt: Date.now()
      };
      // 15秒TTL，防止过期太慢
      try { (this.cache as any).set('analysis_progress', payload, 15); }
      catch { this.cache.set('analysis_progress', payload); }
      
      // 新增：通过事件推送实时进度
      try { this.emit('analysis-progress', payload); } catch {}
    } catch {}
  }

  // 切换数据服务
  async switchDataService(useEnhanced: boolean): Promise<boolean> {
    if (useEnhanced && !this.useEnhancedDataService) {
      console.log('🔄 切换到增强数据服务...');
      try {
        await this.enhancedDataService.initialize();
        const connected = await this.enhancedDataService.checkConnection();
        if (connected) {
          this.useEnhancedDataService = true;
          console.log('✅ 成功切换到增强数据服务');
          return true;
        } else {
          console.warn('⚠️  增强数据服务连接失败');
          return false;
        }
      } catch (error) {
        console.error('切换到增强数据服务失败:', error);
        return false;
      }
    } else if (!useEnhanced && this.useEnhancedDataService) {
      console.log('🔄 切换到基础数据服务...');
      this.useEnhancedDataService = false;
      console.log('✅ 成功切换到基础数据服务');
      return true;
    }
    return true;
  }

  // 获取数据服务状态
  getDataServiceStatus(): {
    usingEnhanced: boolean;
    enhancedServiceHealth?: any;
    basicServiceConnected?: boolean;
  } {
    const status: any = {
      usingEnhanced: this.useEnhancedDataService
    };

    if (this.useEnhancedDataService) {
      status.enhancedServiceHealth = this.enhancedDataService.getHealthStatus();
    }

    return status;
  }
}

// 导出单例实例
export const ethStrategyEngine = new ETHStrategyEngine();

// 新增：获取恐惧与贪婪指数（FGI），返回 0-100；失败返回 null
async function fetchFGIScore(): Promise<number | null> {
  try {
    // 覆盖优先（若启用）
    if (((config as any)?.testing?.allowFGIOverride) === true) {
      const ov = getEffectiveTestingFGIOverride();
      if (typeof ov === 'number' && Number.isFinite(ov)) {
        return Math.max(0, Math.min(100, ov));
      }
    }
    const url = process.env.FGI_API_URL || 'https://api.alternative.me/fng/?limit=1&format=json';
    const resp = await axios.get(url, { timeout: config.okx.timeout || 30000 });
    const data = (resp?.data && (resp.data.data || resp.data.result || resp.data.items)) || resp?.data?.data;

    if (Array.isArray(data) && data.length > 0) {
      const v = (data[0].value ?? data[0].score ?? data[0].index ?? data[0].fgi);
      const num = typeof v === 'string' ? parseFloat(v) : Number(v);
      return Number.isFinite(num) ? num : null;
    }

    const v = resp?.data?.value ?? resp?.data?.score ?? resp?.data?.index;
    const num = typeof v === 'string' ? parseFloat(v) : Number(v);
    return Number.isFinite(num) ? num : null;
  } catch (error) {
    console.warn('请求FGI接口失败:', error instanceof Error ? error.message : String(error));
    return null;
  }
}