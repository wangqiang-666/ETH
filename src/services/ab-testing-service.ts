import { RecommendationRecord } from './recommendation-tracker.js';
import { ExecutionRecord } from './recommendation-database.js';

export interface ABTestConfig {
  enabled: boolean;
  experimentId: string;
  variants: ABTestVariant[];
  allocation: { [variantId: string]: number }; // 分配比例，总和应为1
  minSampleSize: number;
  confidenceLevel: number; // 置信水平，如0.95
}

export interface ABTestVariant {
  id: string;
  name: string;
  description: string;
  config: any; // 变体特定配置
}

export interface ABTestResult {
  variant: string;
  sampleSize: number;
  winRate: number;
  avgReturn: number;
  avgPnL: number;
  sharpeRatio: number;
  maxDrawdown: number;
  statisticalSignificance: boolean;
  pValue: number;
  confidenceInterval: [number, number];
}

export interface ABTestAnalysis {
  experimentId: string;
  startDate: Date;
  endDate: Date;
  totalSamples: number;
  results: { [variantId: string]: ABTestResult };
  winner: string | null;
  recommendation: string;
  statisticalSummary: {
    testType: string;
    significanceLevel: number;
    degreesOfFreedom: number;
    criticalValue: number;
  };
}

/**
 * A/B测试服务
 * 提供实验分配、数据收集和统计分析功能
 */
export class ABTestingService {
  private experiments: Map<string, ABTestConfig> = new Map();
  private userAssignments: Map<string, string> = new Map(); // userId -> variantId
  
  constructor() {
    this.initializeDefaultExperiments();
  }
  
  private initializeDefaultExperiments(): void {
    // 默认A/B测试配置
    const defaultExperiment: ABTestConfig = {
      enabled: true,
      experimentId: 'recommendation-strategy-v1',
      variants: [
        {
          id: 'control',
          name: 'Control Group',
          description: '现有策略配置',
          config: {
            stopLossMultiplier: 2.0,
            takeProfitMultiplier: 3.0,
            confidenceThreshold: 0.7
          }
        },
        {
          id: 'variant-a',
          name: 'Variant A - Aggressive',
          description: '更激进的止损止盈设置',
          config: {
            stopLossMultiplier: 1.5,
            takeProfitMultiplier: 4.0,
            confidenceThreshold: 0.6
          }
        },
        {
          id: 'variant-b',
          name: 'Variant B - Conservative',
          description: '更保守的止损止盈设置',
          config: {
            stopLossMultiplier: 2.5,
            takeProfitMultiplier: 2.5,
            confidenceThreshold: 0.8
          }
        }
      ],
      allocation: {
        'control': 0.4,
        'variant-a': 0.3,
        'variant-b': 0.3
      },
      minSampleSize: 100,
      confidenceLevel: 0.95
    };
    
    this.experiments.set(defaultExperiment.experimentId, defaultExperiment);
  }
  
  /**
   * 为用户分配实验变体
   */
  assignVariant(userId: string, experimentId: string): string {
    const experiment = this.experiments.get(experimentId);
    if (!experiment || !experiment.enabled) {
      return 'control';
    }
    
    // 检查是否已有分配
    const assignmentKey = `${userId}:${experimentId}`;
    if (this.userAssignments.has(assignmentKey)) {
      return this.userAssignments.get(assignmentKey)!;
    }
    
    // 根据分配比例随机选择变体
    const random = Math.random();
    let cumulative = 0;
    
    for (const [variantId, probability] of Object.entries(experiment.allocation)) {
      cumulative += probability;
      if (random <= cumulative) {
        this.userAssignments.set(assignmentKey, variantId);
        return variantId;
      }
    }
    
    // 默认返回control
    this.userAssignments.set(assignmentKey, 'control');
    return 'control';
  }
  
  /**
   * 获取实验配置
   */
  getExperimentConfig(experimentId: string): ABTestConfig | undefined {
    return this.experiments.get(experimentId);
  }
  
  /**
   * 获取变体配置
   */
  getVariantConfig(experimentId: string, variantId: string): any | undefined {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) return undefined;
    
    const variant = experiment.variants.find(v => v.id === variantId);
    return variant?.config;
  }

  /**
   * 获取所有实验配置
   */
  getAllExperiments(): ABTestConfig[] {
    return Array.from(this.experiments.values());
  }
  
  /**
   * 添加新实验
   */
  addExperiment(config: ABTestConfig): void {
    // 验证分配比例总和为1
    const totalAllocation = Object.values(config.allocation).reduce((sum, prob) => sum + prob, 0);
    if (Math.abs(totalAllocation - 1.0) > 0.001) {
      throw new Error(`Allocation probabilities must sum to 1.0, got ${totalAllocation}`);
    }
    
    this.experiments.set(config.experimentId, config);
  }
  
  /**
   * 分析实验结果
   */
  async analyzeExperiment(
    experimentId: string, 
    recommendations: RecommendationRecord[],
    executions: ExecutionRecord[]
  ): Promise<ABTestAnalysis> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }
    
    // 按变体分组数据
    const variantData = this.groupDataByVariant(recommendations, executions);
    
    // 计算各变体统计指标
    const results: { [variantId: string]: ABTestResult } = {};
    
    for (const [variantId, data] of Object.entries(variantData)) {
      results[variantId] = this.calculateVariantStatistics(
        variantId, 
        data.recommendations, 
        data.executions,
        experiment.confidenceLevel
      );
    }
    
    // 确定获胜者（计算与control对比的显著性与p值）
    const winner = this.determineWinner(results, experiment.confidenceLevel, variantData);
    
    // 生成推荐建议
    const recommendation = this.generateRecommendation(results, winner, experiment.confidenceLevel);
    
    return {
      experimentId,
      startDate: new Date(Math.min(...recommendations.map(r => r.created_at.getTime()))),
      endDate: new Date(Math.max(...recommendations.map(r => r.created_at.getTime()))),
      totalSamples: recommendations.length,
      results,
      winner,
      recommendation,
      statisticalSummary: {
        testType: 'Welch t-test (normal approximation)',
        significanceLevel: 1 - experiment.confidenceLevel,
        degreesOfFreedom: recommendations.length - 1,
        criticalValue: this.getCriticalValue(experiment.confidenceLevel)
      }
    };
  }
  
  private groupDataByVariant(
    recommendations: RecommendationRecord[], 
    executions: ExecutionRecord[]
  ): { [variantId: string]: { recommendations: RecommendationRecord[]; executions: ExecutionRecord[] } } {
    const variantData: { [variantId: string]: { recommendations: RecommendationRecord[]; executions: ExecutionRecord[] } } = {};
    
    // 初始化变体分组
    ['control', 'variant-a', 'variant-b'].forEach(variant => {
      variantData[variant] = { recommendations: [], executions: [] };
    });
    
    // 分组推荐记录
    recommendations.forEach(rec => {
      const variant = rec.variant || 'control';
      if (!variantData[variant]) {
        variantData[variant] = { recommendations: [], executions: [] };
      }
      variantData[variant].recommendations.push(rec);
    });
    
    // 分组执行记录
    executions.forEach(exec => {
      const variant = exec.variant || 'control';
      if (!variantData[variant]) {
        variantData[variant] = { recommendations: [], executions: [] };
      }
      variantData[variant].executions.push(exec);
    });
    
    return variantData;
  }
  
  private calculateVariantStatistics(
    variantId: string,
    recommendations: RecommendationRecord[],
    executions: ExecutionRecord[],
    confidenceLevel: number
  ): ABTestResult {
    const completedRecommendations = recommendations.filter(r => r.status === 'CLOSED');
    
    if (completedRecommendations.length === 0) {
      return {
        variant: variantId,
        sampleSize: 0,
        winRate: 0,
        avgReturn: 0,
        avgPnL: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        statisticalSignificance: false,
        pValue: 1,
        confidenceInterval: [0, 0]
      };
    }
    
    // 计算胜率
    const winCount = completedRecommendations.filter(r => r.result === 'WIN').length;
    const winRate = winCount / completedRecommendations.length;
    
    // 计算平均收益
    const returns = completedRecommendations.map(r => r.pnl_percent || 0);
    const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    
    // 计算平均PnL
    const pnlAmounts = completedRecommendations.map(r => r.pnl_amount || 0);
    const avgPnL = pnlAmounts.reduce((sum, pnl) => sum + pnl, 0) / pnlAmounts.length;
    
    // 计算夏普比率（简化版）
    const stdDev = this.calculateStandardDeviation(returns);
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
    
    // 计算最大回撤
    const maxDrawdown = this.calculateMaxDrawdown(returns);
    
    // 计算置信区间
    const confidenceInterval = this.calculateConfidenceInterval(returns, confidenceLevel);
    
    return {
      variant: variantId,
      sampleSize: completedRecommendations.length,
      winRate,
      avgReturn,
      avgPnL,
      sharpeRatio,
      maxDrawdown,
      statisticalSignificance: false, // 将在与control比较时计算
      pValue: 1, // 将在与control比较时计算
      confidenceInterval
    };
  }
  
  private calculateStandardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
    
    return Math.sqrt(avgSquaredDiff);
  }
  
  private calculateMaxDrawdown(returns: number[]): number {
    if (returns.length === 0) return 0;
    
    let maxDrawdown = 0;
    let peak = returns[0];
    
    for (let i = 1; i < returns.length; i++) {
      if (returns[i] > peak) {
        peak = returns[i];
      }
      
      const drawdown = (peak - returns[i]) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    return maxDrawdown;
  }
  
  private calculateConfidenceInterval(values: number[], confidenceLevel: number): [number, number] {
    if (values.length === 0) return [0, 0];
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const stdDev = this.calculateStandardDeviation(values);
    const standardError = stdDev / Math.sqrt(values.length);
    
    // 简化的Z值，实际应该根据t分布计算
    const zScore = confidenceLevel === 0.95 ? 1.96 : 1.645;
    const margin = zScore * standardError;
    
    return [mean - margin, mean + margin];
  }
  
  private getCriticalValue(confidenceLevel: number): number {
    return confidenceLevel === 0.95 ? 1.96 : 1.645;
  }
  
  private determineWinner(
    results: { [variantId: string]: ABTestResult }, 
    confidenceLevel: number,
    variantData: { [variantId: string]: { recommendations: RecommendationRecord[]; executions: ExecutionRecord[] } }
  ): string | null {
    const alpha = 1 - confidenceLevel;

    // 找到对照组（control），若不存在则选择样本量最大的作为基线
    const variants = Object.keys(results);
    if (variants.length === 0) return null;

    const getReturns = (vid: string): number[] => {
      const recs = (variantData[vid]?.recommendations || []).filter(r => r.status === 'CLOSED');
      return recs.map(r => r.pnl_percent || 0);
    };

    const controlId = variants.includes('control') ? 'control' : variants.reduce((acc, vid) => {
      return results[vid].sampleSize > (results[acc]?.sampleSize || 0) ? vid : acc;
    }, variants[0]);

    const controlReturns = getReturns(controlId);
    const n0 = controlReturns.length;
    const mean0 = controlReturns.reduce((s, v) => s + v, 0) / (n0 || 1);
    const std0 = this.calculateStandardDeviation(controlReturns);

    // 初始化control的显著性/ p值
    if (results[controlId]) {
      results[controlId].pValue = 1;
      results[controlId].statisticalSignificance = false;
    }

    let bestVariant: string | null = null;
    let bestAvgReturn = -Infinity;

    for (const vid of variants) {
      if (vid === controlId) continue;

      const ret = getReturns(vid);
      const n1 = ret.length;
      if (n0 < 2 || n1 < 2) {
        // 样本不足，无法进行统计检验
        results[vid].pValue = 1;
        results[vid].statisticalSignificance = false;
        continue;
      }

      const mean1 = ret.reduce((s, v) => s + v, 0) / n1;
      const std1 = this.calculateStandardDeviation(ret);
      const se = Math.sqrt((std1 * std1) / n1 + (std0 * std0) / n0);
      const z = se > 0 ? (mean1 - mean0) / se : 0;
      // 双侧检验p值（正态近似）
      const pValue = 2 * (1 - this.normalCdf(Math.abs(z)));

      results[vid].pValue = pValue;
      results[vid].statisticalSignificance = pValue < alpha;

      if (results[vid].statisticalSignificance && results[vid].avgReturn > mean0 && results[vid].avgReturn > bestAvgReturn) {
        bestAvgReturn = results[vid].avgReturn;
        bestVariant = vid;
      }
    }

    return bestVariant;
  }
  
  private normalCdf(x: number): number {
    // 标准正态分布累计分布函数，使用误差函数近似
    return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
  }

  private erf(x: number): number {
    // 数值近似 Abramowitz and Stegun formula 7.1.26
    const sign = x >= 0 ? 1 : -1;
    const ax = Math.abs(x);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const t = 1 / (1 + p * ax);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
    return sign * y;
  }
  
  private generateRecommendation(results: { [variantId: string]: ABTestResult }, winner: string | null, confidenceLevel: number): string {
    if (!winner) {
      return '继续收集数据，当前尚无与对照组相比具有统计显著性的优胜变体';
    }
    
    const winnerResult = results[winner];
    if (!winnerResult.statisticalSignificance) {
      return `变体 ${winner} 表现较好，但统计显著性不足（p=${winnerResult.pValue.toFixed(3)}），建议继续收集数据`;
    }
    
    const confPct = (confidenceLevel * 100).toFixed(0);
    return `建议采用变体 ${winner}，胜率 ${(winnerResult.winRate * 100).toFixed(1)}%，平均收益 ${winnerResult.avgReturn.toFixed(2)}%，与对照组相比具有统计显著性（p=${winnerResult.pValue.toFixed(3)}，置信度${confPct}%）`;
  }
}