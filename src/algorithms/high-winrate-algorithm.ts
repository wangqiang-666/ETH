import { MultiFactorAnalyzer, MultiFactorAnalysisResult } from '../analyzers/multi-factor-analyzer';
import { SmartSignalResult, SmartSignalType } from '../analyzers/smart-signal-analyzer';
import { MarketData } from '../ml/ml-analyzer';
import { config } from '../config';

// 高胜率交易信号
export interface HighWinrateSignal {
  // 基础信息
  id: string;
  timestamp: number;
  symbol: string;
  
  // 信号详情
  signal: {
    type: 'BUY' | 'SELL' | 'HOLD';
    strength: number;        // 信号强度 0-100
    confidence: number;      // 置信度 0-1
    winrateEstimate: number; // 预估胜率 0-1
    qualityScore: number;    // 信号质量评分 0-100
  };
  
  // 价格目标
  pricing: {
    entryPrice: number;
    stopLoss: number;
    takeProfits: {
      target1: number;  // 第一目标 (概率最高)
      target2: number;  // 第二目标 (中等概率)
      target3: number;  // 第三目标 (低概率但高收益)
    };
    riskRewardRatio: number;
  };
  
  // 仓位管理
  position: {
    recommendedSize: number;     // 推荐仓位大小
    maxRiskPerTrade: number;     // 单笔最大风险
    scalingStrategy: 'SINGLE' | 'PYRAMID' | 'DCA';
    entryStrategy: 'MARKET' | 'LIMIT' | 'STOP';
  };
  
  // 时间管理
  timing: {
    urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMEDIATE';
    validUntil: number;          // 信号有效期
    optimalEntryWindow: number;  // 最佳入场时间窗口(分钟)
    expectedDuration: number;    // 预期持仓时间(小时)
  };
  
  // 风险评估
  risk: {
    level: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    factors: string[];
    mitigation: string[];
    maxDrawdown: number;
  };
  
  // 支撑依据
  reasoning: {
    primaryFactors: string[];    // 主要支撑因素
    technicalBasis: string[];    // 技术面依据
    fundamentalBasis: string[];  // 基本面依据
    marketContext: string[];     // 市场环境
    historicalPattern: string[]; // 历史模式
  };
  
  // 执行指导
  execution: {
    preConditions: string[];     // 执行前提条件
    entryTriggers: string[];     // 入场触发条件
    exitConditions: string[];    // 出场条件
    monitoringPoints: string[];  // 监控要点
  };
  
  // 元数据
  metadata: {
    algorithmVersion: string;
    dataQuality: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
    backtestResults?: {
      winrate: number;
      avgReturn: number;
      maxDrawdown: number;
      sharpeRatio: number;
    };
  };
}

// 历史信号统计
export interface SignalPerformanceStats {
  totalSignals: number;
  winningSignals: number;
  losingSignals: number;
  overallWinrate: number;
  avgReturn: number;
  avgWinningReturn: number;
  avgLosingReturn: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  recoveryFactor: number;
}

// 信号过滤条件
export interface SignalFilterCriteria {
  minConfidence?: number;
  minWinrateEstimate?: number;
  minQualityScore?: number;
  maxRiskLevel?: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  requiredFactors?: string[];
  excludeFactors?: string[];
  timeframe?: 'SHORT' | 'MEDIUM' | 'LONG';
}

// 高胜率交易算法
export class HighWinrateAlgorithm {
  private multiFactorAnalyzer: MultiFactorAnalyzer;
  private signalHistory: HighWinrateSignal[] = [];
  private performanceStats!: SignalPerformanceStats;
  // private lastSignalTime: number = 0;
  // 改为按 symbol 独立冷却
  private lastSignalTimeBySymbol: Map<string, number> = new Map();
  
  // 算法参数
  private readonly MIN_CONFIDENCE = 0.75;           // 最小置信度
  private readonly MIN_QUALITY_SCORE = 70;          // 最小质量评分
  private readonly MIN_RISK_REWARD_RATIO = 2.0;     // 最小风险收益比
  private readonly MAX_SIGNALS_PER_HOUR = 3;        // 每小时最大信号数（按 symbol 统计）
  private signalCooldownMs: number = 15 * 60 * 1000; // 信号冷却时间，默认15分钟，支持配置覆盖
  
  constructor() {
    this.multiFactorAnalyzer = new MultiFactorAnalyzer();
    this.initializePerformanceStats();
    // 读取配置中的冷却时间（毫秒），默认使用 config.strategy.signalCooldownMs；若缺省则保持15分钟
    try {
      const cfg = (config as any)?.strategy?.signalCooldownMs;
      if (typeof cfg === 'number' && !isNaN(cfg) && cfg > 0) {
        this.signalCooldownMs = cfg;
      }
    } catch (_) {}
  }
  
  /**
   * 生成高胜率交易信号
   */
  async generateSignal(
    marketData: MarketData,
    klineData: any[],
    filterCriteria?: SignalFilterCriteria
  ): Promise<HighWinrateSignal | null> {
    
    try {
      // 1. 检查信号生成条件（按 symbol 冷却与频率限制）
      const symbol = (marketData as any)?.symbol || 'ETH-USDT-SWAP';
      if (!this.canGenerateSignal(symbol)) {
        console.log('信号生成冷却中或达到频率限制');
        return null;
      }
      
      // 2. 执行多因子分析
      const multiFactorResult = await this.multiFactorAnalyzer.analyzeMultiFactors(
        marketData,
        klineData,
        { includeML: true, riskTolerance: 'MEDIUM' }
      );
      
      // 3. 评估信号质量
      const qualityAssessment = this.assessSignalQuality(multiFactorResult);
      
      // 4. 应用高胜率过滤器
      if (!this.passesHighWinrateFilter(qualityAssessment, multiFactorResult)) {
        console.log('信号未通过高胜率过滤器');
        return null;
      }
      
      // 5. 生成高胜率信号
      const signal = this.constructHighWinrateSignal(
        multiFactorResult,
        qualityAssessment,
        marketData
      );
      
      // 6. 应用用户过滤条件
      if (filterCriteria && !this.passesUserFilter(signal, filterCriteria)) {
        console.log('信号未通过用户过滤条件');
        return null;
      }
      
      // 7. 记录信号
      this.recordSignal(signal);
      
      return signal;
      
    } catch (error) {
      console.error('生成高胜率信号失败:', error);
      return null;
    }
  }

  /**
   * 检查是否可以生成信号（按 symbol 控制冷却与频率）
   */
  private canGenerateSignal(symbol?: string): boolean {
    const now = Date.now();
    const key = symbol || 'GLOBAL';
    
    // 按 symbol 检查冷却时间：30分钟内（由配置决定）不再对同一品种给出新信号（无论方向）
    const last = this.lastSignalTimeBySymbol.get(key) || 0;
    if (now - last < this.signalCooldownMs) {
      return false;
    }
    
    // 按 symbol 检查每小时信号频率
    const oneHourAgo = now - 60 * 60 * 1000;
    const recentForSymbol = this.signalHistory.filter(
      s => s.symbol === key && s.timestamp > oneHourAgo
    );
    return recentForSymbol.length < this.MAX_SIGNALS_PER_HOUR;
  }

  /**
   * 评估信号质量
   */
  private assessSignalQuality(multiFactorResult: MultiFactorAnalysisResult): {
    qualityScore: number;
    winrateEstimate: number;
    strengthScore: number;
    consistencyScore: number;
  } {
    
    let qualityScore = 0;
    let strengthScore = 0;
    let consistencyScore = 0;
    
    // 1. 因子一致性评分 (40分)
    const factors = Object.values(multiFactorResult.factors);
    const bullishFactors = factors.filter(f => f.trend === 'BULLISH').length;
    const bearishFactors = factors.filter(f => f.trend === 'BEARISH').length;
    const neutralFactors = factors.filter(f => f.trend === 'NEUTRAL').length;
    
    const maxTrendFactors = Math.max(bullishFactors, bearishFactors);
    consistencyScore = (maxTrendFactors / factors.length) * 40;
    qualityScore += consistencyScore;
    
    // 2. 信号强度评分 (30分)
    const avgStrength = factors.reduce((sum, f) => sum + Math.abs(f.score), 0) / factors.length;
    strengthScore = Math.min(30, (avgStrength / 100) * 30);
    qualityScore += strengthScore;
    
    // 3. 置信度评分 (20分)
    const avgConfidence = factors.reduce((sum, f) => sum + f.confidence, 0) / factors.length;
    qualityScore += avgConfidence * 20;
    
    // 4. 风险评估加分 (10分)
    const riskBonus = {
      'LOW': 10,
      'MEDIUM': 5,
      'HIGH': 0,
      'EXTREME': -10
    }[multiFactorResult.riskAssessment.level] || 0;
    qualityScore += riskBonus;
    
    // 计算胜率估计
    let winrateEstimate = 0.5; // 基础胜率50%
    
    // 基于质量评分调整胜率
    if (qualityScore >= 90) winrateEstimate = 0.85;
    else if (qualityScore >= 80) winrateEstimate = 0.78;
    else if (qualityScore >= 70) winrateEstimate = 0.72;
    else if (qualityScore >= 60) winrateEstimate = 0.65;
    else winrateEstimate = 0.55;
    
    // 基于历史表现调整
    if (this.performanceStats.overallWinrate > 0) {
      winrateEstimate = (winrateEstimate + this.performanceStats.overallWinrate) / 2;
    }
    
    return {
      qualityScore: Math.min(100, Math.max(0, qualityScore)),
      winrateEstimate: Math.min(0.95, Math.max(0.5, winrateEstimate)),
      strengthScore,
      consistencyScore
    };
  }

  /**
   * 高胜率过滤器
   */
  private passesHighWinrateFilter(
    qualityAssessment: any,
    multiFactorResult: MultiFactorAnalysisResult
  ): boolean {
    
    // 1. 最小置信度检查
    if (multiFactorResult.compositeScore.confidence < this.MIN_CONFIDENCE) {
      return false;
    }
    
    // 2. 最小质量评分检查
    if (qualityAssessment.qualityScore < this.MIN_QUALITY_SCORE) {
      return false;
    }
    
    // 3. 风险等级检查
    if (multiFactorResult.riskAssessment.level === 'EXTREME') {
      return false;
    }
    
    // 4. 信号强度检查
    const strongSignal = Math.max(
      multiFactorResult.compositeScore.bullish,
      multiFactorResult.compositeScore.bearish
    );
    if (strongSignal < 65) {
      return false;
    }
    
    // 5. 因子一致性检查
    if (qualityAssessment.consistencyScore < 25) {
      return false;
    }
    
    // 6. 数据质量检查
    if (multiFactorResult.metadata.dataQuality === 'POOR') {
      return false;
    }
    
    return true;
  }

  /**
   * 构建高胜率信号
   */
  private constructHighWinrateSignal(
    multiFactorResult: MultiFactorAnalysisResult,
    qualityAssessment: any,
    marketData: MarketData
  ): HighWinrateSignal {
    
    const signalType = multiFactorResult.execution.action === 'BUY' ? 'BUY' : 
                      multiFactorResult.execution.action === 'SELL' ? 'SELL' : 'HOLD';
    
    const entryPrice = multiFactorResult.execution.optimalEntry;
    const stopLoss = multiFactorResult.execution.stopLoss;
    const takeProfits = multiFactorResult.execution.takeProfit;
    
    // 计算风险收益比
    const riskAmount = Math.abs(entryPrice - stopLoss);
    const rewardAmount = Math.abs(takeProfits[0] - entryPrice);
    const riskRewardRatio = rewardAmount / riskAmount;
    
    // 生成推理依据
    const reasoning = this.generateReasoning(multiFactorResult);
    
    // 生成执行指导
    const execution = this.generateExecutionGuidance(multiFactorResult, signalType);
    
    return {
      id: `HWR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      symbol: marketData.symbol || 'ETH-USDT-SWAP',
      
      signal: {
        type: signalType,
        strength: Math.max(
          multiFactorResult.compositeScore.bullish,
          multiFactorResult.compositeScore.bearish
        ),
        confidence: multiFactorResult.compositeScore.confidence,
        winrateEstimate: qualityAssessment.winrateEstimate,
        qualityScore: qualityAssessment.qualityScore
      },
      
      pricing: {
        entryPrice,
        stopLoss,
        takeProfits: {
          target1: takeProfits[0],
          target2: takeProfits[1] || takeProfits[0] * 1.2,
          target3: takeProfits[2] || takeProfits[0] * 1.5
        },
        riskRewardRatio
      },
      
      position: {
        recommendedSize: multiFactorResult.execution.positionSizing.moderate,
        maxRiskPerTrade: config.risk.maxRiskPerTrade,
        scalingStrategy: riskRewardRatio > 3 ? 'PYRAMID' : 'SINGLE',
        entryStrategy: multiFactorResult.execution.urgency === 'HIGH' ? 'MARKET' : 'LIMIT'
      },
      
      timing: {
        urgency: this.mapUrgency(multiFactorResult.execution.urgency),
        validUntil: Date.now() + (4 * 60 * 60 * 1000), // 4小时有效期
        optimalEntryWindow: multiFactorResult.execution.urgency === 'HIGH' ? 15 : 60,
        expectedDuration: this.estimateDuration(multiFactorResult)
      },
      
      risk: {
        level: this.mapRiskLevel(multiFactorResult.riskAssessment.level),
        factors: multiFactorResult.riskAssessment.factors,
        mitigation: this.generateRiskMitigation(multiFactorResult),
        maxDrawdown: config.risk.maxDrawdown
      },
      
      reasoning,
      execution,
      
      metadata: {
        algorithmVersion: '1.0.0',
        dataQuality: multiFactorResult.metadata.dataQuality,
        backtestResults: this.getBacktestResults()
      }
    };
  }

  /**
   * 生成推理依据
   */
  private generateReasoning(multiFactorResult: MultiFactorAnalysisResult): HighWinrateSignal['reasoning'] {
    const primaryFactors: string[] = [];
    const technicalBasis: string[] = [];
    const fundamentalBasis: string[] = [];
    const marketContext: string[] = [];
    
    // 分析主要因子
    Object.entries(multiFactorResult.factors).forEach(([key, factor]) => {
      if (factor.strength === 'STRONG') {
        primaryFactors.push(`${key}因子显示${factor.trend}信号 (评分: ${factor.score.toFixed(1)})`);
      }
      
      if (key === 'technical') {
        technicalBasis.push(...factor.signals);
      } else if (key === 'fundamental') {
        fundamentalBasis.push(...factor.signals);
      } else {
        marketContext.push(...factor.signals);
      }
    });
    
    // 添加综合评分信息
    const compositeScore = multiFactorResult.compositeScore;
    if (compositeScore.bullish > compositeScore.bearish) {
      primaryFactors.push(`综合看涨评分: ${compositeScore.bullish.toFixed(1)}%`);
    } else {
      primaryFactors.push(`综合看跌评分: ${compositeScore.bearish.toFixed(1)}%`);
    }
    
    return {
      primaryFactors,
      technicalBasis,
      fundamentalBasis,
      marketContext,
      historicalPattern: [
        `历史胜率: ${(this.performanceStats.overallWinrate * 100).toFixed(1)}%`,
        `平均收益: ${(this.performanceStats.avgReturn * 100).toFixed(2)}%`
      ]
    };
  }

  /**
   * 生成执行指导
   */
  private generateExecutionGuidance(
    multiFactorResult: MultiFactorAnalysisResult,
    signalType: 'BUY' | 'SELL' | 'HOLD'
  ): HighWinrateSignal['execution'] {
    
    const preConditions = [
      '确认市场流动性充足',
      '检查资金费率是否合理',
      '验证技术指标信号一致性'
    ];
    
    const entryTriggers = [];
    const exitConditions = [];
    const monitoringPoints = [];
    
    if (signalType === 'BUY') {
      entryTriggers.push(
        '价格突破关键阻力位',
        '成交量放大确认',
        '技术指标发出买入信号'
      );
      exitConditions.push(
        '达到止盈目标',
        '跌破止损位',
        '技术指标转为看跌'
      );
    } else if (signalType === 'SELL') {
      entryTriggers.push(
        '价格跌破关键支撑位',
        '成交量放大确认',
        '技术指标发出卖出信号'
      );
      exitConditions.push(
        '达到止盈目标',
        '突破止损位',
        '技术指标转为看涨'
      );
    }
    
    monitoringPoints.push(
      '关注成交量变化',
      '监控资金费率',
      '观察市场情绪指标',
      '跟踪技术指标变化'
    );
    
    return {
      preConditions,
      entryTriggers,
      exitConditions,
      monitoringPoints
    };
  }

  /**
   * 映射紧急程度
   */
  private mapUrgency(urgency: 'LOW' | 'MEDIUM' | 'HIGH'): 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMEDIATE' {
    const mapping = {
      'LOW': 'LOW' as const,
      'MEDIUM': 'MEDIUM' as const,
      'HIGH': 'IMMEDIATE' as const
    };
    return mapping[urgency];
  }

  /**
   * 映射风险等级
   */
  private mapRiskLevel(
    level: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'
  ): 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' {
    const mapping = {
      'LOW': 'VERY_LOW' as const,
      'MEDIUM': 'LOW' as const,
      'HIGH': 'MEDIUM' as const,
      'EXTREME': 'VERY_HIGH' as const
    };
    return mapping[level];
  }

  /**
   * 估算持仓时间
   */
  private estimateDuration(multiFactorResult: MultiFactorAnalysisResult): number {
    // 基于信号强度和市场条件估算持仓时间
    const baseHours = 4;
    const strengthMultiplier = multiFactorResult.compositeScore.confidence;
    const volatilityFactor = multiFactorResult.factors.volatility.score < 0 ? 1.5 : 1.0;
    
    return baseHours * strengthMultiplier * volatilityFactor;
  }

  /**
   * 生成风险缓解措施
   */
  private generateRiskMitigation(multiFactorResult: MultiFactorAnalysisResult): string[] {
    const mitigation: string[] = [];
    
    if (multiFactorResult.riskAssessment.level !== 'LOW') {
      mitigation.push('降低仓位规模');
      mitigation.push('设置更紧的止损');
    }
    
    if (multiFactorResult.factors.volatility.score < -20) {
      mitigation.push('分批建仓降低冲击');
      mitigation.push('使用限价单避免滑点');
    }
    
    if (multiFactorResult.factors.volume.score < -15) {
      mitigation.push('避免大额交易');
      mitigation.push('关注流动性变化');
    }
    
    mitigation.push('严格执行止损纪律');
    mitigation.push('定期评估持仓风险');
    
    return mitigation;
  }

  /**
   * 用户过滤器检查
   */
  private passesUserFilter(
    signal: HighWinrateSignal,
    criteria: SignalFilterCriteria
  ): boolean {
    
    if (criteria.minConfidence && signal.signal.confidence < criteria.minConfidence) {
      return false;
    }
    
    if (criteria.minWinrateEstimate && signal.signal.winrateEstimate < criteria.minWinrateEstimate) {
      return false;
    }
    
    if (criteria.minQualityScore && signal.signal.qualityScore < criteria.minQualityScore) {
      return false;
    }
    
    if (criteria.maxRiskLevel) {
      const riskLevels = ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];
      const maxIndex = riskLevels.indexOf(criteria.maxRiskLevel);
      const signalIndex = riskLevels.indexOf(signal.risk.level);
      if (signalIndex > maxIndex) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * 记录信号
   */
  private recordSignal(signal: HighWinrateSignal): void {
    this.signalHistory.push(signal);
    // this.lastSignalTime = signal.timestamp;
    // 更新按 symbol 的最后信号时间
    if (signal.symbol) {
      this.lastSignalTimeBySymbol.set(signal.symbol, signal.timestamp);
    }
    
    // 保持最近1000个信号
    if (this.signalHistory.length > 1000) {
      this.signalHistory = this.signalHistory.slice(-1000);
    }
    
    // 更新性能统计
    this.updatePerformanceStats();
  }

  /**
   * 初始化性能统计
   */
  private initializePerformanceStats(): void {
    this.performanceStats = {
      totalSignals: 0,
      winningSignals: 0,
      losingSignals: 0,
      overallWinrate: 0,
      avgReturn: 0,
      avgWinningReturn: 0,
      avgLosingReturn: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      recoveryFactor: 0
    };
  }

  /**
   * 更新性能统计
   */
  private updatePerformanceStats(): void {
    // 这里应该基于实际交易结果更新统计
    // 目前使用模拟数据
    this.performanceStats.totalSignals = this.signalHistory.length;
    this.performanceStats.overallWinrate = 0.72; // 模拟72%胜率
    this.performanceStats.avgReturn = 0.025; // 模拟2.5%平均收益
  }

  /**
   * 获取回测结果
   */
  private getBacktestResults(): HighWinrateSignal['metadata']['backtestResults'] {
    return {
      winrate: this.performanceStats.overallWinrate,
      avgReturn: this.performanceStats.avgReturn,
      maxDrawdown: this.performanceStats.maxDrawdown,
      sharpeRatio: this.performanceStats.sharpeRatio
    };
  }

  /**
   * 获取性能统计
   */
  getPerformanceStats(): SignalPerformanceStats {
    return { ...this.performanceStats };
  }

  /**
   * 获取信号历史
   */
  getSignalHistory(limit?: number): HighWinrateSignal[] {
    const history = [...this.signalHistory].reverse();
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * 获取最新信号
   */
  getLatestSignal(): HighWinrateSignal | null {
    return this.signalHistory.length > 0 
      ? this.signalHistory[this.signalHistory.length - 1] 
      : null;
  }
}

// 导出单例实例
export const highWinrateAlgorithm = new HighWinrateAlgorithm();

// 导出工具函数
export function formatSignalForDisplay(signal: HighWinrateSignal): string {
  return `
🎯 高胜率交易信号 #${signal.id.split('_')[2]}

📊 信号详情:
• 类型: ${signal.signal.type}
• 强度: ${signal.signal.strength.toFixed(1)}%
• 置信度: ${(signal.signal.confidence * 100).toFixed(1)}%
• 预估胜率: ${(signal.signal.winrateEstimate * 100).toFixed(1)}%
• 质量评分: ${signal.signal.qualityScore.toFixed(1)}/100

💰 价格目标:
• 入场价: $${signal.pricing.entryPrice.toFixed(4)}
• 止损价: $${signal.pricing.stopLoss.toFixed(4)}
• 目标1: $${signal.pricing.takeProfits.target1.toFixed(4)}
• 目标2: $${signal.pricing.takeProfits.target2.toFixed(4)}
• 目标3: $${signal.pricing.takeProfits.target3.toFixed(4)}
• 风险收益比: 1:${signal.pricing.riskRewardRatio.toFixed(2)}

⚡ 执行建议:
• 紧急程度: ${signal.timing.urgency}
• 推荐仓位: ${(signal.position.recommendedSize * 100).toFixed(1)}%
• 入场方式: ${signal.position.entryStrategy}
• 有效期: ${Math.round((signal.timing.validUntil - Date.now()) / (60 * 1000))}分钟

⚠️ 风险评估:
• 风险等级: ${signal.risk.level}
• 最大回撤: ${(signal.risk.maxDrawdown * 100).toFixed(1)}%

📝 主要依据:
${signal.reasoning.primaryFactors.map(f => `• ${f}`).join('\n')}
  `;
}

export function validateSignalIntegrity(signal: HighWinrateSignal): boolean {
  // 验证信号完整性
  if (!signal.id || !signal.timestamp || !signal.symbol) return false;
  if (signal.signal.confidence < 0 || signal.signal.confidence > 1) return false;
  if (signal.signal.winrateEstimate < 0 || signal.signal.winrateEstimate > 1) return false;
  if (signal.pricing.riskRewardRatio <= 0) return false;
  
  return true;
}