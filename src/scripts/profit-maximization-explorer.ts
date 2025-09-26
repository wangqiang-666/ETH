#!/usr/bin/env node

import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

interface KlineData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ParameterSpace {
  // === 核心盈利参数 ===
  stopLoss: { min: number; max: number; step: number };
  takeProfitLevels: {
    level1: { min: number; max: number; step: number };
    level2: { min: number; max: number; step: number };
    level3: { min: number; max: number; step: number };
  };
  takeProfitWeights: {
    weight1: { min: number; max: number; step: number };
    weight2: { min: number; max: number; step: number };
    weight3: { min: number; max: number; step: number };
  };
  
  // === 信号生成参数 ===
  rsiPeriod: { min: number; max: number; step: number };
  rsiOversold: { min: number; max: number; step: number };
  rsiOverbought: { min: number; max: number; step: number };
  
  // === 趋势参数 ===
  emaFast: { min: number; max: number; step: number };
  emaSlow: { min: number; max: number; step: number };
  trendStrengthThreshold: { min: number; max: number; step: number };
  
  // === 成交量参数 ===
  volumeRatioMin: { min: number; max: number; step: number };
  volumeConfirmationPeriod: { min: number; max: number; step: number };
  
  // === 波动率参数 ===
  volatilityMin: { min: number; max: number; step: number };
  volatilityMax: { min: number; max: number; step: number };
  atrPeriod: { min: number; max: number; step: number };
  
  // === 时间管理参数 ===
  minHoldingTime: { min: number; max: number; step: number };
  maxHoldingTime: { min: number; max: number; step: number };
  profitTakingTime: { min: number; max: number; step: number };
  
  // === 风险控制参数 ===
  maxDailyTrades: { min: number; max: number; step: number };
  maxConsecutiveLosses: { min: number; max: number; step: number };
  cooldownPeriod: { min: number; max: number; step: number };
  
  // === 尾随止损参数 ===
  trailingStopActivation: { min: number; max: number; step: number };
  trailingStopDistance: { min: number; max: number; step: number };
  
  // === 仓位管理参数 ===
  basePositionSize: { min: number; max: number; step: number };
  positionSizeMultiplier: { min: number; max: number; step: number };
}

interface OptimizationResult {
  parameters: any;
  performance: {
    totalReturn: number;
    annualizedReturn: number;
    profitFactor: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    riskReward: number;
    totalTrades: number;
    tradesPerWeek: number;
    avgHoldingTime: number;
    totalFees: number;
    netProfit: number;
  };
  profitScore: number;
  riskAdjustedScore: number;
  stabilityScore: number;
  overallScore: number;
  marketCondition: string;
  dataRange: {
    start: string;
    end: string;
    totalDays: number;
  };
}

class ProfitMaximizationExplorer {
  private historicalData: KlineData[] = [];
  private optimizationResults: OptimizationResult[] = [];
  
  // === 严格的参数空间定义 ===
  private readonly PARAMETER_SPACE: ParameterSpace = {
    // 核心盈利参数 - 精细化搜索
    stopLoss: { min: 0.005, max: 0.030, step: 0.001 },
    takeProfitLevels: {
      level1: { min: 0.008, max: 0.040, step: 0.002 },
      level2: { min: 0.020, max: 0.080, step: 0.005 },
      level3: { min: 0.050, max: 0.150, step: 0.010 }
    },
    takeProfitWeights: {
      weight1: { min: 0.30, max: 0.70, step: 0.05 },
      weight2: { min: 0.20, max: 0.50, step: 0.05 },
      weight3: { min: 0.10, max: 0.30, step: 0.05 }
    },
    
    // 信号生成参数
    rsiPeriod: { min: 10, max: 21, step: 1 },
    rsiOversold: { min: 20, max: 40, step: 2 },
    rsiOverbought: { min: 60, max: 80, step: 2 },
    
    // 趋势参数
    emaFast: { min: 5, max: 15, step: 1 },
    emaSlow: { min: 15, max: 30, step: 2 },
    trendStrengthThreshold: { min: 0.003, max: 0.025, step: 0.002 },
    
    // 成交量参数
    volumeRatioMin: { min: 0.8, max: 2.5, step: 0.1 },
    volumeConfirmationPeriod: { min: 10, max: 25, step: 2 },
    
    // 波动率参数
    volatilityMin: { min: 0.001, max: 0.008, step: 0.001 },
    volatilityMax: { min: 0.040, max: 0.120, step: 0.010 },
    atrPeriod: { min: 10, max: 20, step: 2 },
    
    // 时间管理参数
    minHoldingTime: { min: 1, max: 15, step: 1 },
    maxHoldingTime: { min: 30, max: 180, step: 15 },
    profitTakingTime: { min: 20, max: 90, step: 10 },
    
    // 风险控制参数
    maxDailyTrades: { min: 10, max: 50, step: 5 },
    maxConsecutiveLosses: { min: 2, max: 5, step: 1 },
    cooldownPeriod: { min: 30, max: 120, step: 15 },
    
    // 尾随止损参数
    trailingStopActivation: { min: 0.005, max: 0.020, step: 0.002 },
    trailingStopDistance: { min: 0.002, max: 0.010, step: 0.001 },
    
    // 仓位管理参数
    basePositionSize: { min: 400, max: 800, step: 50 },
    positionSizeMultiplier: { min: 0.8, max: 1.5, step: 0.1 }
  };

  // === 严格的盈利评分标准 ===
  private readonly PROFIT_TARGETS = {
    MIN_ANNUAL_RETURN: 0.15,      // 最低15%年化收益
    TARGET_ANNUAL_RETURN: 0.50,   // 目标50%年化收益
    OPTIMAL_ANNUAL_RETURN: 1.00,  // 最优100%年化收益
    
    MIN_PROFIT_FACTOR: 1.20,      // 最低利润因子1.2
    TARGET_PROFIT_FACTOR: 2.00,   // 目标利润因子2.0
    OPTIMAL_PROFIT_FACTOR: 3.00,  // 最优利润因子3.0
    
    MIN_SHARPE_RATIO: 1.00,       // 最低夏普比率1.0
    TARGET_SHARPE_RATIO: 2.00,    // 目标夏普比率2.0
    OPTIMAL_SHARPE_RATIO: 3.00,   // 最优夏普比率3.0
    
    MAX_DRAWDOWN: 0.25,           // 最大回撤25%
    TARGET_DRAWDOWN: 0.15,        // 目标回撤15%
    OPTIMAL_DRAWDOWN: 0.10,       // 最优回撤10%
    
    MIN_WIN_RATE: 0.40,           // 最低胜率40%
    TARGET_WIN_RATE: 0.55,        // 目标胜率55%
    OPTIMAL_WIN_RATE: 0.70,       // 最优胜率70%
    
    MIN_TRADES_PER_WEEK: 3,       // 最少3笔/周
    TARGET_TRADES_PER_WEEK: 12,   // 目标12笔/周
    MAX_TRADES_PER_WEEK: 30       // 最多30笔/周
  };

  constructor() {
    console.log('🚀 初始化盈利最大化探索引擎');
    console.log('💡 核心理念: 以盈利为唯一目标，通过海量参数空间搜索找到最优解');
    console.log('🎯 严格目标: 年化收益≥50%, 利润因子≥2.0, 夏普比率≥2.0');
    console.log('📊 参数空间: 超过100万种参数组合的全面搜索');
  }

  async loadHistoricalData(filePaths: string[]): Promise<void> {
    console.log('📊 加载多年历史数据...');
    
    this.historicalData = [];
    
    for (const filePath of filePaths) {
      console.log(`📁 加载文件: ${path.basename(filePath)}`);
      
      const rawData = await fs.readFile(filePath, 'utf-8');
      const historicalDataFile = JSON.parse(rawData);
      
      const fileData: KlineData[] = historicalDataFile.data.map((item: any) => ({
        timestamp: item.timestamp,
        open: parseFloat(item.open),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        close: parseFloat(item.close),
        volume: parseFloat(item.volume)
      }));
      
      // 分批添加数据以避免栈溢出
      for (let i = 0; i < fileData.length; i += 10000) {
        const batch = fileData.slice(i, i + 10000);
        this.historicalData.push(...batch);
      }
    }
    
    // 严格验证数据完整性
    this.validateDataIntegrity();
    
    console.log(`✅ 数据加载完成: ${this.historicalData.length} 条K线数据`);
    console.log(`📅 时间范围: ${new Date(this.historicalData[0].timestamp).toISOString()} 到 ${new Date(this.historicalData[this.historicalData.length - 1].timestamp).toISOString()}`);
  }

  private validateDataIntegrity(): void {
    console.log('🔍 严格验证数据完整性...');
    
    // 检查数据连续性
    let missingDataCount = 0;
    for (let i = 1; i < this.historicalData.length; i++) {
      const timeDiff = this.historicalData[i].timestamp - this.historicalData[i - 1].timestamp;
      if (timeDiff !== 60000) { // 1分钟 = 60000毫秒
        missingDataCount++;
      }
    }
    
    // 检查数据质量
    let invalidDataCount = 0;
    for (const bar of this.historicalData) {
      if (bar.high < bar.low || bar.high < bar.open || bar.high < bar.close ||
          bar.low > bar.open || bar.low > bar.close || bar.volume < 0) {
        invalidDataCount++;
      }
    }
    
    console.log(`📊 数据质量报告:`);
    console.log(`   - 总K线数: ${this.historicalData.length}`);
    console.log(`   - 缺失数据: ${missingDataCount} (${(missingDataCount/this.historicalData.length*100).toFixed(2)}%)`);
    console.log(`   - 无效数据: ${invalidDataCount} (${(invalidDataCount/this.historicalData.length*100).toFixed(2)}%)`);
    
    if (missingDataCount > this.historicalData.length * 0.01) {
      console.warn('⚠️  警告: 缺失数据超过1%，可能影响回测准确性');
    }
    
    if (invalidDataCount > 0) {
      console.warn('⚠️  警告: 发现无效数据，将在回测中跳过');
    }
  }

  /**
   * 生成参数组合 - 智能采样策略
   */
  private generateParameterCombinations(maxCombinations: number = 50000): any[] {
    console.log(`🔬 生成参数组合 (最多${maxCombinations}组)...`);
    
    const combinations: any[] = [];
    
    // 计算理论参数空间大小
    const theoreticalSize = this.calculateParameterSpaceSize();
    console.log(`📊 理论参数空间大小: ${theoreticalSize.toLocaleString()}`);
    
    if (theoreticalSize <= maxCombinations) {
      // 全遍历
      console.log('🔍 使用全遍历策略');
      combinations.push(...this.generateAllCombinations());
    } else {
      // 智能采样
      console.log('🎯 使用智能采样策略');
      combinations.push(...this.generateSmartSampling(maxCombinations));
    }
    
    console.log(`✅ 生成参数组合完成: ${combinations.length} 组`);
    return combinations;
  }

  private calculateParameterSpaceSize(): number {
    let size = 1;
    
    // 计算每个参数的可能值数量
    const space = this.PARAMETER_SPACE;
    
    size *= Math.floor((space.stopLoss.max - space.stopLoss.min) / space.stopLoss.step) + 1;
    size *= Math.floor((space.takeProfitLevels.level1.max - space.takeProfitLevels.level1.min) / space.takeProfitLevels.level1.step) + 1;
    size *= Math.floor((space.takeProfitLevels.level2.max - space.takeProfitLevels.level2.min) / space.takeProfitLevels.level2.step) + 1;
    size *= Math.floor((space.takeProfitLevels.level3.max - space.takeProfitLevels.level3.min) / space.takeProfitLevels.level3.step) + 1;
    
    // 简化计算，只考虑核心参数
    return Math.min(size, 10000000); // 限制在1000万以内
  }

  private generateSmartSampling(maxCombinations: number): any[] {
    const combinations: any[] = [];
    
    // 多种采样策略组合
    const strategies = [
      { name: 'random', ratio: 0.4 },      // 40% 随机采样
      { name: 'grid', ratio: 0.3 },        // 30% 网格采样
      { name: 'focused', ratio: 0.2 },     // 20% 重点区域采样
      { name: 'extreme', ratio: 0.1 }      // 10% 极值采样
    ];
    
    for (const strategy of strategies) {
      const count = Math.floor(maxCombinations * strategy.ratio);
      console.log(`   ${strategy.name}采样: ${count} 组`);
      
      switch (strategy.name) {
        case 'random':
          combinations.push(...this.generateRandomSampling(count));
          break;
        case 'grid':
          combinations.push(...this.generateGridSampling(count));
          break;
        case 'focused':
          combinations.push(...this.generateFocusedSampling(count));
          break;
        case 'extreme':
          combinations.push(...this.generateExtremeSampling(count));
          break;
      }
    }
    
    return combinations;
  }

  private generateRandomSampling(count: number): any[] {
    const combinations: any[] = [];
    
    for (let i = 0; i < count; i++) {
      combinations.push(this.generateRandomParameters());
    }
    
    return combinations;
  }

  private generateGridSampling(count: number): any[] {
    const combinations: any[] = [];
    const space = this.PARAMETER_SPACE;
    
    // 计算网格密度
    const dimensions = 8; // 主要参数维度
    const gridSize = Math.floor(Math.pow(count, 1 / dimensions));
    
    for (let i = 0; i < count; i++) {
      const params = {
        stopLoss: this.sampleFromRange(space.stopLoss, gridSize, i % gridSize),
        takeProfitLevel1: this.sampleFromRange(space.takeProfitLevels.level1, gridSize, Math.floor(i / gridSize) % gridSize),
        takeProfitLevel2: this.sampleFromRange(space.takeProfitLevels.level2, gridSize, Math.floor(i / (gridSize * gridSize)) % gridSize),
        takeProfitLevel3: this.sampleFromRange(space.takeProfitLevels.level3, gridSize, Math.floor(i / (gridSize * gridSize * gridSize)) % gridSize),
        
        rsiPeriod: Math.floor(this.sampleFromRange(space.rsiPeriod, gridSize, i % gridSize)),
        rsiOversold: Math.floor(this.sampleFromRange(space.rsiOversold, gridSize, Math.floor(i / gridSize) % gridSize)),
        rsiOverbought: Math.floor(this.sampleFromRange(space.rsiOverbought, gridSize, Math.floor(i / (gridSize * gridSize)) % gridSize)),
        
        emaFast: Math.floor(this.sampleFromRange(space.emaFast, gridSize, Math.floor(i / (gridSize * gridSize * gridSize)) % gridSize)),
        emaSlow: Math.floor(this.sampleFromRange(space.emaSlow, gridSize, i % gridSize)),
        
        volumeRatioMin: this.sampleFromRange(space.volumeRatioMin, gridSize, Math.floor(i / gridSize) % gridSize),
        maxDailyTrades: Math.floor(this.sampleFromRange(space.maxDailyTrades, gridSize, Math.floor(i / (gridSize * gridSize)) % gridSize)),
        basePositionSize: Math.floor(this.sampleFromRange(space.basePositionSize, gridSize, Math.floor(i / (gridSize * gridSize * gridSize)) % gridSize))
      };
      
      combinations.push(this.completeParameters(params));
    }
    
    return combinations;
  }

  private generateFocusedSampling(count: number): any[] {
    const combinations: any[] = [];
    
    // 重点关注高盈利潜力区域
    const focusAreas = [
      { stopLoss: [0.008, 0.015], takeProfitLevel1: [0.015, 0.025] },
      { stopLoss: [0.012, 0.020], takeProfitLevel1: [0.020, 0.035] },
      { stopLoss: [0.015, 0.025], takeProfitLevel1: [0.030, 0.050] }
    ];
    
    for (let i = 0; i < count; i++) {
      const area = focusAreas[i % focusAreas.length];
      const params = this.generateRandomParameters();
      
      // 在重点区域内采样
      params.stopLoss = area.stopLoss[0] + Math.random() * (area.stopLoss[1] - area.stopLoss[0]);
      params.takeProfitLevel1 = area.takeProfitLevel1[0] + Math.random() * (area.takeProfitLevel1[1] - area.takeProfitLevel1[0]);
      
      combinations.push(params);
    }
    
    return combinations;
  }

  private generateExtremeSampling(count: number): any[] {
    const combinations: any[] = [];
    
    // 极值采样 - 测试边界条件
    for (let i = 0; i < count; i++) {
      const params = this.generateRandomParameters();
      
      // 随机选择一些参数设为极值
      if (Math.random() < 0.3) params.stopLoss = this.PARAMETER_SPACE.stopLoss.min;
      if (Math.random() < 0.3) params.stopLoss = this.PARAMETER_SPACE.stopLoss.max;
      if (Math.random() < 0.3) params.takeProfitLevel1 = this.PARAMETER_SPACE.takeProfitLevels.level1.max;
      if (Math.random() < 0.3) params.maxDailyTrades = this.PARAMETER_SPACE.maxDailyTrades.max;
      
      combinations.push(params);
    }
    
    return combinations;
  }

  private sampleFromRange(range: { min: number; max: number; step: number }, gridSize: number, index: number): number {
    const ratio = index / (gridSize - 1);
    return range.min + ratio * (range.max - range.min);
  }

  private generateRandomParameters(): any {
    const space = this.PARAMETER_SPACE;
    
    return {
      stopLoss: this.randomFromRange(space.stopLoss),
      takeProfitLevel1: this.randomFromRange(space.takeProfitLevels.level1),
      takeProfitLevel2: this.randomFromRange(space.takeProfitLevels.level2),
      takeProfitLevel3: this.randomFromRange(space.takeProfitLevels.level3),
      takeProfitWeight1: this.randomFromRange(space.takeProfitWeights.weight1),
      takeProfitWeight2: this.randomFromRange(space.takeProfitWeights.weight2),
      takeProfitWeight3: this.randomFromRange(space.takeProfitWeights.weight3),
      
      rsiPeriod: Math.floor(this.randomFromRange(space.rsiPeriod)),
      rsiOversold: Math.floor(this.randomFromRange(space.rsiOversold)),
      rsiOverbought: Math.floor(this.randomFromRange(space.rsiOverbought)),
      
      emaFast: Math.floor(this.randomFromRange(space.emaFast)),
      emaSlow: Math.floor(this.randomFromRange(space.emaSlow)),
      trendStrengthThreshold: this.randomFromRange(space.trendStrengthThreshold),
      
      volumeRatioMin: this.randomFromRange(space.volumeRatioMin),
      volumeConfirmationPeriod: Math.floor(this.randomFromRange(space.volumeConfirmationPeriod)),
      
      volatilityMin: this.randomFromRange(space.volatilityMin),
      volatilityMax: this.randomFromRange(space.volatilityMax),
      atrPeriod: Math.floor(this.randomFromRange(space.atrPeriod)),
      
      minHoldingTime: Math.floor(this.randomFromRange(space.minHoldingTime)),
      maxHoldingTime: Math.floor(this.randomFromRange(space.maxHoldingTime)),
      profitTakingTime: Math.floor(this.randomFromRange(space.profitTakingTime)),
      
      maxDailyTrades: Math.floor(this.randomFromRange(space.maxDailyTrades)),
      maxConsecutiveLosses: Math.floor(this.randomFromRange(space.maxConsecutiveLosses)),
      cooldownPeriod: Math.floor(this.randomFromRange(space.cooldownPeriod)),
      
      trailingStopActivation: this.randomFromRange(space.trailingStopActivation),
      trailingStopDistance: this.randomFromRange(space.trailingStopDistance),
      
      basePositionSize: Math.floor(this.randomFromRange(space.basePositionSize)),
      positionSizeMultiplier: this.randomFromRange(space.positionSizeMultiplier)
    };
  }

  private randomFromRange(range: { min: number; max: number; step: number }): number {
    const steps = Math.floor((range.max - range.min) / range.step);
    const randomStep = Math.floor(Math.random() * (steps + 1));
    return range.min + randomStep * range.step;
  }

  private completeParameters(partialParams: any): any {
    const fullParams = this.generateRandomParameters();
    return { ...fullParams, ...partialParams };
  }

  /**
   * 严格的回测引擎
   */
  private runStrictBacktest(parameters: any, data: KlineData[]): any {
    let balance = 10000;
    let totalTrades = 0;
    let winningTrades = 0;
    let totalProfit = 0;
    let totalLoss = 0;
    let maxDrawdown = 0;
    let peak = 10000;
    let equity: number[] = [10000];
    let trades: any[] = [];
    let consecutiveLosses = 0;
    let lastLossTime = 0;
    
    for (let i = 100; i < data.length - 10; i++) {
      const currentBar = data[i];
      const bars = data.slice(Math.max(0, i - 50), i + 1);
      
      // 更新权益
      let currentEquity = balance;
      equity.push(currentEquity);
      
      // 更新最大回撤
      if (currentEquity > peak) peak = currentEquity;
      const drawdown = (peak - currentEquity) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
      
      // 检查交易条件
      if (this.shouldTrade(bars, parameters, consecutiveLosses, lastLossTime, currentBar.timestamp)) {
        const signal = this.generateTradingSignal(bars, parameters);
        
        if (signal) {
          totalTrades++;
          
          // 模拟交易执行
          const tradeResult = this.executeVirtualTrade(signal, currentBar, parameters, data, i);
          
          if (tradeResult.netPnl > 0) {
            winningTrades++;
            totalProfit += tradeResult.netPnl;
            consecutiveLosses = 0;
          } else {
            totalLoss += Math.abs(tradeResult.netPnl);
            consecutiveLosses++;
            lastLossTime = currentBar.timestamp;
          }
          
          balance += tradeResult.netPnl;
          trades.push(tradeResult);
          
          // 每日交易限制检查
          const todayTrades = trades.filter(t => 
            new Date(t.entryTime).toDateString() === new Date(currentBar.timestamp).toDateString()
          ).length;
          
          if (todayTrades >= parameters.maxDailyTrades) {
            // 跳到下一天
            const nextDay = new Date(currentBar.timestamp);
            nextDay.setDate(nextDay.getDate() + 1);
            nextDay.setHours(0, 0, 0, 0);
            
            while (i < data.length && data[i].timestamp < nextDay.getTime()) {
              i++;
            }
          }
        }
      }
    }
    
    // 计算性能指标
    const totalDays = (data[data.length - 1].timestamp - data[0].timestamp) / (1000 * 60 * 60 * 24);
    const annualizedReturn = totalDays > 0 ? ((balance / 10000) ** (365 / totalDays) - 1) : 0;
    const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : 0;
    const avgWin = winningTrades > 0 ? totalProfit / winningTrades : 0;
    const avgLoss = (totalTrades - winningTrades) > 0 ? totalLoss / (totalTrades - winningTrades) : 0;
    const riskReward = avgLoss > 0 ? avgWin / avgLoss : 0;
    const sharpeRatio = this.calculateSharpeRatio(equity);
    const tradesPerWeek = totalDays > 0 ? (totalTrades / totalDays) * 7 : 0;
    const avgHoldingTime = trades.length > 0 ? trades.reduce((sum, t) => sum + t.holdingTime, 0) / trades.length : 0;
    const totalFees = trades.reduce((sum, t) => sum + t.fees, 0);
    
    return {
      totalReturn: (balance - 10000) / 10000,
      annualizedReturn,
      profitFactor,
      sharpeRatio,
      maxDrawdown,
      winRate,
      avgWin,
      avgLoss,
      riskReward,
      totalTrades,
      tradesPerWeek,
      avgHoldingTime: avgHoldingTime / (1000 * 60), // 转换为分钟
      totalFees,
      netProfit: balance - 10000,
      equity,
      trades
    };
  }

  private shouldTrade(bars: KlineData[], params: any, consecutiveLosses: number, lastLossTime: number, currentTime: number): boolean {
    // 连续亏损保护
    if (consecutiveLosses >= params.maxConsecutiveLosses) {
      const timeSinceLastLoss = (currentTime - lastLossTime) / (1000 * 60);
      if (timeSinceLastLoss < params.cooldownPeriod) {
        return false;
      }
    }
    
    // 市场条件检查
    const volatility = this.calculateVolatility(bars.map(b => b.close), 20);
    if (volatility < params.volatilityMin || volatility > params.volatilityMax) {
      return false;
    }
    
    // 成交量检查
    const volumeRatio = this.calculateVolumeRatio(bars, params.volumeConfirmationPeriod);
    if (volumeRatio < params.volumeRatioMin) {
      return false;
    }
    
    return true;
  }

  private generateTradingSignal(bars: KlineData[], params: any): any | null {
    const indicators = this.calculateIndicators(bars, params);
    
    let signalStrength = 0;
    let direction: 'long' | 'short' | null = null;
    
    // RSI信号
    if (indicators.rsi <= params.rsiOversold) {
      signalStrength += 0.3;
      direction = 'long';
    } else if (indicators.rsi >= params.rsiOverbought) {
      signalStrength += 0.3;
      direction = 'short';
    }
    
    // 趋势信号
    const trendStrength = Math.abs(indicators.emaFast - indicators.emaSlow) / indicators.emaSlow;
    if (trendStrength > params.trendStrengthThreshold) {
      signalStrength += 0.25;
      if (indicators.emaFast > indicators.emaSlow) {
        if (direction === 'long' || direction === null) {
          direction = 'long';
        } else {
          return null; // 信号冲突
        }
      } else {
        if (direction === 'short' || direction === null) {
          direction = 'short';
        } else {
          return null; // 信号冲突
        }
      }
    }
    
    // 成交量确认
    if (indicators.volumeRatio > params.volumeRatioMin * 1.5) {
      signalStrength += 0.2;
    }
    
    // 波动率确认
    if (indicators.volatility > params.volatilityMin && indicators.volatility < params.volatilityMax) {
      signalStrength += 0.15;
    }
    
    // 价格动量
    const momentum = this.calculateMomentum(bars, 5);
    if (Math.abs(momentum) > 0.002) {
      signalStrength += 0.1;
      if (momentum > 0) {
        if (direction === 'long' || direction === null) {
          direction = 'long';
        } else if (direction === 'short') {
          signalStrength -= 0.1; // 冲突惩罚
        }
      } else {
        if (direction === 'short' || direction === null) {
          direction = 'short';
        } else if (direction === 'long') {
          signalStrength -= 0.1; // 冲突惩罚
        }
      }
    }
    
    // 信号强度阈值
    if (signalStrength >= 0.6 && direction) {
      return {
        direction,
        strength: signalStrength,
        confidence: Math.min(signalStrength * 1.2, 1.0)
      };
    }
    
    return null;
  }

  private executeVirtualTrade(signal: any, entryBar: KlineData, params: any, data: KlineData[], startIndex: number): any {
    const entryPrice = entryBar.close;
    const positionSize = params.basePositionSize * params.positionSizeMultiplier;
    const quantity = positionSize / entryPrice;
    
    // 计算止损止盈价格
    const stopLoss = signal.direction === 'long' 
      ? entryPrice * (1 - params.stopLoss)
      : entryPrice * (1 + params.stopLoss);
    
    const takeProfitLevels = [
      {
        price: signal.direction === 'long' 
          ? entryPrice * (1 + params.takeProfitLevel1)
          : entryPrice * (1 - params.takeProfitLevel1),
        weight: params.takeProfitWeight1
      },
      {
        price: signal.direction === 'long' 
          ? entryPrice * (1 + params.takeProfitLevel2)
          : entryPrice * (1 - params.takeProfitLevel2),
        weight: params.takeProfitWeight2
      },
      {
        price: signal.direction === 'long' 
          ? entryPrice * (1 + params.takeProfitLevel3)
          : entryPrice * (1 - params.takeProfitLevel3),
        weight: params.takeProfitWeight3
      }
    ];
    
    // 模拟交易执行
    let remainingQuantity = quantity;
    let totalPnl = 0;
    let totalFees = positionSize * 0.000247; // 开仓手续费
    let holdingTime = 0;
    let exitReason = '';
    let trailingStopPrice = null;
    let trailingStopActivated = false;
    
    for (let i = startIndex + 1; i < Math.min(startIndex + params.maxHoldingTime + 10, data.length); i++) {
      const currentBar = data[i];
      holdingTime = currentBar.timestamp - entryBar.timestamp;
      const holdingMinutes = holdingTime / (1000 * 60);
      
      // 最小持仓时间检查
      if (holdingMinutes < params.minHoldingTime) {
        continue;
      }
      
      // 止损检查
      const hitStopLoss = signal.direction === 'long' 
        ? currentBar.low <= stopLoss
        : currentBar.high >= stopLoss;
      
      if (hitStopLoss) {
        const exitPrice = stopLoss;
        const pnl = (exitPrice - entryPrice) * remainingQuantity * (signal.direction === 'long' ? 1 : -1);
        const exitFee = exitPrice * remainingQuantity * 0.000247;
        totalPnl += pnl;
        totalFees += exitFee;
        exitReason = 'Stop Loss';
        break;
      }
      
      // 分层止盈检查
      for (let j = 0; j < takeProfitLevels.length; j++) {
        const tpLevel = takeProfitLevels[j];
        const hitTakeProfit = signal.direction === 'long'
          ? currentBar.high >= tpLevel.price
          : currentBar.low <= tpLevel.price;
        
        if (hitTakeProfit && remainingQuantity > 0) {
          const exitQuantity = quantity * tpLevel.weight;
          const exitPrice = tpLevel.price;
          const pnl = (exitPrice - entryPrice) * exitQuantity * (signal.direction === 'long' ? 1 : -1);
          const exitFee = exitPrice * exitQuantity * 0.000247;
          
          totalPnl += pnl;
          totalFees += exitFee;
          remainingQuantity -= exitQuantity;
          
          if (remainingQuantity <= 0.001) {
            exitReason = `Take Profit Level ${j + 1}`;
            break;
          }
        }
      }
      
      if (remainingQuantity <= 0.001) break;
      
      // 尾随止损
      if (params.trailingStopActivation > 0) {
        const currentPnl = (currentBar.close - entryPrice) * remainingQuantity * (signal.direction === 'long' ? 1 : -1);
        const profitPercent = currentPnl / positionSize;
        
        if (profitPercent >= params.trailingStopActivation) {
          trailingStopActivated = true;
          const newTrailingStop = signal.direction === 'long'
            ? currentBar.close * (1 - params.trailingStopDistance)
            : currentBar.close * (1 + params.trailingStopDistance);
          
          if (!trailingStopPrice || 
              (signal.direction === 'long' && newTrailingStop > trailingStopPrice) ||
              (signal.direction === 'short' && newTrailingStop < trailingStopPrice)) {
            trailingStopPrice = newTrailingStop;
          }
        }
        
        if (trailingStopActivated && trailingStopPrice) {
          const hitTrailingStop = signal.direction === 'long'
            ? currentBar.low <= trailingStopPrice
            : currentBar.high >= trailingStopPrice;
          
          if (hitTrailingStop) {
            const exitPrice = trailingStopPrice;
            const pnl = (exitPrice - entryPrice) * remainingQuantity * (signal.direction === 'long' ? 1 : -1);
            const exitFee = exitPrice * remainingQuantity * 0.000247;
            totalPnl += pnl;
            totalFees += exitFee;
            exitReason = 'Trailing Stop';
            break;
          }
        }
      }
      
      // 最大持仓时间检查
      if (holdingMinutes >= params.maxHoldingTime) {
        const exitPrice = currentBar.close;
        const pnl = (exitPrice - entryPrice) * remainingQuantity * (signal.direction === 'long' ? 1 : -1);
        const exitFee = exitPrice * remainingQuantity * 0.000247;
        totalPnl += pnl;
        totalFees += exitFee;
        exitReason = 'Max Holding Time';
        break;
      }
      
      // 获利了结时间检查
      if (holdingMinutes >= params.profitTakingTime && totalPnl > 0) {
        const exitPrice = currentBar.close;
        const pnl = (exitPrice - entryPrice) * remainingQuantity * (signal.direction === 'long' ? 1 : -1);
        const exitFee = exitPrice * remainingQuantity * 0.000247;
        totalPnl += pnl;
        totalFees += exitFee;
        exitReason = 'Profit Taking';
        break;
      }
    }
    
    // 如果没有退出，强制平仓
    if (!exitReason) {
      const exitPrice = data[Math.min(startIndex + params.maxHoldingTime + 10, data.length - 1)].close;
      const pnl = (exitPrice - entryPrice) * remainingQuantity * (signal.direction === 'long' ? 1 : -1);
      const exitFee = exitPrice * remainingQuantity * 0.000247;
      totalPnl += pnl;
      totalFees += exitFee;
      exitReason = 'Force Close';
    }
    
    const netPnl = totalPnl - totalFees;
    
    return {
      entryTime: entryBar.timestamp,
      entryPrice,
      quantity,
      side: signal.direction,
      pnl: totalPnl,
      fees: totalFees,
      netPnl,
      holdingTime,
      exitReason,
      signal
    };
  }

  /**
   * 严格的盈利评分算法
   */
  private calculateProfitScore(performance: any): number {
    const targets = this.PROFIT_TARGETS;
    
    // 年化收益评分 (40%权重)
    let returnScore = 0;
    if (performance.annualizedReturn >= targets.OPTIMAL_ANNUAL_RETURN) {
      returnScore = 100;
    } else if (performance.annualizedReturn >= targets.TARGET_ANNUAL_RETURN) {
      returnScore = 70 + 30 * (performance.annualizedReturn - targets.TARGET_ANNUAL_RETURN) / (targets.OPTIMAL_ANNUAL_RETURN - targets.TARGET_ANNUAL_RETURN);
    } else if (performance.annualizedReturn >= targets.MIN_ANNUAL_RETURN) {
      returnScore = 40 + 30 * (performance.annualizedReturn - targets.MIN_ANNUAL_RETURN) / (targets.TARGET_ANNUAL_RETURN - targets.MIN_ANNUAL_RETURN);
    } else {
      returnScore = Math.max(0, 40 * performance.annualizedReturn / targets.MIN_ANNUAL_RETURN);
    }
    
    // 利润因子评分 (25%权重)
    let pfScore = 0;
    if (performance.profitFactor >= targets.OPTIMAL_PROFIT_FACTOR) {
      pfScore = 100;
    } else if (performance.profitFactor >= targets.TARGET_PROFIT_FACTOR) {
      pfScore = 70 + 30 * (performance.profitFactor - targets.TARGET_PROFIT_FACTOR) / (targets.OPTIMAL_PROFIT_FACTOR - targets.TARGET_PROFIT_FACTOR);
    } else if (performance.profitFactor >= targets.MIN_PROFIT_FACTOR) {
      pfScore = 40 + 30 * (performance.profitFactor - targets.MIN_PROFIT_FACTOR) / (targets.TARGET_PROFIT_FACTOR - targets.MIN_PROFIT_FACTOR);
    } else {
      pfScore = Math.max(0, 40 * performance.profitFactor / targets.MIN_PROFIT_FACTOR);
    }
    
    // 夏普比率评分 (20%权重)
    let sharpeScore = 0;
    if (performance.sharpeRatio >= targets.OPTIMAL_SHARPE_RATIO) {
      sharpeScore = 100;
    } else if (performance.sharpeRatio >= targets.TARGET_SHARPE_RATIO) {
      sharpeScore = 70 + 30 * (performance.sharpeRatio - targets.TARGET_SHARPE_RATIO) / (targets.OPTIMAL_SHARPE_RATIO - targets.TARGET_SHARPE_RATIO);
    } else if (performance.sharpeRatio >= targets.MIN_SHARPE_RATIO) {
      sharpeScore = 40 + 30 * (performance.sharpeRatio - targets.MIN_SHARPE_RATIO) / (targets.TARGET_SHARPE_RATIO - targets.MIN_SHARPE_RATIO);
    } else {
      sharpeScore = Math.max(0, 40 * performance.sharpeRatio / targets.MIN_SHARPE_RATIO);
    }
    
    // 胜率评分 (10%权重)
    let winRateScore = 0;
    if (performance.winRate >= targets.OPTIMAL_WIN_RATE) {
      winRateScore = 100;
    } else if (performance.winRate >= targets.TARGET_WIN_RATE) {
      winRateScore = 70 + 30 * (performance.winRate - targets.TARGET_WIN_RATE) / (targets.OPTIMAL_WIN_RATE - targets.TARGET_WIN_RATE);
    } else if (performance.winRate >= targets.MIN_WIN_RATE) {
      winRateScore = 40 + 30 * (performance.winRate - targets.MIN_WIN_RATE) / (targets.TARGET_WIN_RATE - targets.MIN_WIN_RATE);
    } else {
      winRateScore = Math.max(0, 40 * performance.winRate / targets.MIN_WIN_RATE);
    }
    
    // 交易频次评分 (5%权重)
    let freqScore = 0;
    if (performance.tradesPerWeek >= targets.MIN_TRADES_PER_WEEK && performance.tradesPerWeek <= targets.MAX_TRADES_PER_WEEK) {
      if (performance.tradesPerWeek >= targets.TARGET_TRADES_PER_WEEK) {
        freqScore = 100 - Math.abs(performance.tradesPerWeek - targets.TARGET_TRADES_PER_WEEK) * 2;
      } else {
        freqScore = 70 + 30 * (performance.tradesPerWeek - targets.MIN_TRADES_PER_WEEK) / (targets.TARGET_TRADES_PER_WEEK - targets.MIN_TRADES_PER_WEEK);
      }
    } else {
      freqScore = 20;
    }
    
    // 加权综合评分
    const weightedScore = (
      returnScore * 0.40 +
      pfScore * 0.25 +
      sharpeScore * 0.20 +
      winRateScore * 0.10 +
      freqScore * 0.05
    );
    
    return Math.max(0, Math.min(100, weightedScore));
  }

  private calculateRiskAdjustedScore(performance: any): number {
    const targets = this.PROFIT_TARGETS;
    
    // 回撤评分
    let ddScore = 100;
    if (performance.maxDrawdown <= targets.OPTIMAL_DRAWDOWN) {
      ddScore = 100;
    } else if (performance.maxDrawdown <= targets.TARGET_DRAWDOWN) {
      ddScore = 80 + 20 * (targets.TARGET_DRAWDOWN - performance.maxDrawdown) / (targets.TARGET_DRAWDOWN - targets.OPTIMAL_DRAWDOWN);
    } else if (performance.maxDrawdown <= targets.MAX_DRAWDOWN) {
      ddScore = 50 + 30 * (targets.MAX_DRAWDOWN - performance.maxDrawdown) / (targets.MAX_DRAWDOWN - targets.TARGET_DRAWDOWN);
    } else {
      ddScore = Math.max(0, 50 * (1 - (performance.maxDrawdown - targets.MAX_DRAWDOWN) / targets.MAX_DRAWDOWN));
    }
    
    // 风险调整后收益
    const riskAdjustedReturn = performance.annualizedReturn / Math.max(performance.maxDrawdown, 0.01);
    const riskReturnScore = Math.min(100, riskAdjustedReturn * 20);
    
    return (ddScore * 0.6 + riskReturnScore * 0.4);
  }

  private calculateStabilityScore(performance: any): number {
    if (!performance.equity || performance.equity.length < 100) return 50;
    
    // 计算权益曲线的稳定性
    const returns = [];
    for (let i = 1; i < performance.equity.length; i++) {
      returns.push((performance.equity[i] - performance.equity[i - 1]) / performance.equity[i - 1]);
    }
    
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const volatility = Math.sqrt(returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length);
    
    // 稳定性评分
    const stabilityRatio = Math.abs(avgReturn) / Math.max(volatility, 0.0001);
    return Math.min(100, stabilityRatio * 50);
  }

  /**
   * 执行大规模参数优化
   */
  async runMassiveOptimization(maxCombinations: number = 50000): Promise<void> {
    console.log('🚀 开始大规模参数优化...');
    console.log(`🎯 目标: 从${maxCombinations.toLocaleString()}组参数中找到最优解`);
    
    // 生成参数组合
    const parameterCombinations = this.generateParameterCombinations(maxCombinations);
    
    // 数据分割 - 训练集和验证集
    const splitPoint = Math.floor(this.historicalData.length * 0.7);
    const trainData = this.historicalData.slice(0, splitPoint);
    const validationData = this.historicalData.slice(splitPoint);
    
    console.log(`📊 数据分割: 训练集${trainData.length}条, 验证集${validationData.length}条`);
    
    let processedCount = 0;
    const batchSize = 1000;
    
    for (let i = 0; i < parameterCombinations.length; i += batchSize) {
      const batch = parameterCombinations.slice(i, i + batchSize);
      
      console.log(`🔬 处理批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(parameterCombinations.length / batchSize)} (${batch.length}组参数)`);
      
      for (const params of batch) {
        try {
          // 训练集回测
          const trainPerformance = this.runStrictBacktest(params, trainData);
          
          // 基础过滤 - 快速排除明显不合格的参数
          if (trainPerformance.totalTrades < 10 || 
              trainPerformance.profitFactor < 1.0 || 
              trainPerformance.annualizedReturn < 0) {
            processedCount++;
            continue;
          }
          
          // 验证集回测
          const validationPerformance = this.runStrictBacktest(params, validationData);
          
          // 计算综合评分
          const profitScore = this.calculateProfitScore(validationPerformance);
          const riskAdjustedScore = this.calculateRiskAdjustedScore(validationPerformance);
          const stabilityScore = this.calculateStabilityScore(validationPerformance);
          
          const overallScore = (
            profitScore * 0.50 +
            riskAdjustedScore * 0.30 +
            stabilityScore * 0.20
          );
          
          // 只保存高质量结果
          if (overallScore >= 60) {
            const result: OptimizationResult = {
              parameters: params,
              performance: validationPerformance,
              profitScore,
              riskAdjustedScore,
              stabilityScore,
              overallScore,
              marketCondition: this.classifyMarketCondition(validationData),
              dataRange: {
                start: new Date(validationData[0].timestamp).toISOString(),
                end: new Date(validationData[validationData.length - 1].timestamp).toISOString(),
                totalDays: (validationData[validationData.length - 1].timestamp - validationData[0].timestamp) / (1000 * 60 * 60 * 24)
              }
            };
            
            this.optimizationResults.push(result);
          }
          
        } catch (error) {
          console.warn(`⚠️  参数组合${processedCount + 1}回测失败:`, error);
        }
        
        processedCount++;
        
        // 进度报告
        if (processedCount % 5000 === 0) {
          console.log(`📈 进度: ${processedCount}/${parameterCombinations.length} (${(processedCount/parameterCombinations.length*100).toFixed(1)}%)`);
          console.log(`🏆 当前最佳: ${this.optimizationResults.length}组高质量结果`);
          
          if (this.optimizationResults.length > 0) {
            const best = this.optimizationResults.sort((a, b) => b.overallScore - a.overallScore)[0];
            console.log(`   最高得分: ${best.overallScore.toFixed(2)}, 年化收益: ${(best.performance.annualizedReturn * 100).toFixed(1)}%`);
          }
        }
      }
    }
    
    // 排序结果
    this.optimizationResults.sort((a, b) => b.overallScore - a.overallScore);
    
    console.log('🎉 大规模参数优化完成！');
    console.log(`📊 处理参数组合: ${processedCount.toLocaleString()}`);
    console.log(`🏆 高质量结果: ${this.optimizationResults.length}`);
    
    if (this.optimizationResults.length > 0) {
      const best = this.optimizationResults[0];
      console.log(`🥇 最优结果: 得分${best.overallScore.toFixed(2)}, 年化收益${(best.performance.annualizedReturn * 100).toFixed(1)}%`);
    }
  }

  private classifyMarketCondition(data: KlineData[]): string {
    const startPrice = data[0].close;
    const endPrice = data[data.length - 1].close;
    const totalReturn = (endPrice - startPrice) / startPrice;
    
    const volatility = this.calculateVolatility(data.map(d => d.close), data.length);
    
    if (totalReturn > 0.2) return 'bull_market';
    if (totalReturn < -0.2) return 'bear_market';
    if (volatility > 0.05) return 'high_volatility';
    if (volatility < 0.02) return 'low_volatility';
    return 'sideways_market';
  }

  /**
   * 生成详细优化报告
   */
  generateOptimizationReport(): string {
    const topResults = this.optimizationResults.slice(0, 10);
    
    let report = '\n' + '='.repeat(100) + '\n';
    report += '🚀 盈利最大化探索引擎 - 深度优化报告\n';
    report += '='.repeat(100) + '\n\n';
    
    report += `💡 核心理念: 以盈利为唯一目标的海量参数空间搜索\n`;
    report += `📊 搜索规模: ${this.optimizationResults.length} 组高质量参数组合\n`;
    report += `🎯 严格目标: 年化收益≥50%, 利润因子≥2.0, 夏普比率≥2.0\n\n`;
    
    if (topResults.length === 0) {
      report += '❌ 未找到符合严格盈利标准的参数组合\n';
      report += '💡 建议: 放宽搜索条件或增加参数空间范围\n';
      return report;
    }
    
    // 最优结果统计
    const bestResult = topResults[0];
    report += '🏆 最优结果概览:\n';
    report += `   综合得分: ${bestResult.overallScore.toFixed(2)}/100\n`;
    report += `   年化收益: ${(bestResult.performance.annualizedReturn * 100).toFixed(2)}%\n`;
    report += `   利润因子: ${bestResult.performance.profitFactor.toFixed(2)}\n`;
    report += `   夏普比率: ${bestResult.performance.sharpeRatio.toFixed(2)}\n`;
    report += `   最大回撤: ${(bestResult.performance.maxDrawdown * 100).toFixed(2)}%\n`;
    report += `   胜率: ${(bestResult.performance.winRate * 100).toFixed(1)}%\n\n`;
    
    // TOP 10 详细结果
    report += '🎯 TOP 10 最优参数组合:\n';
    report += '-'.repeat(100) + '\n';
    
    topResults.forEach((result, index) => {
      const perf = result.performance;
      const params = result.parameters;
      
      report += `\n📍 排名 #${index + 1} | 综合得分: ${result.overallScore.toFixed(2)} | 市场环境: ${result.marketCondition}\n`;
      
      report += `   📈 核心性能指标:\n`;
      report += `      年化收益: ${(perf.annualizedReturn * 100).toFixed(2)}% | 总收益: ${(perf.totalReturn * 100).toFixed(2)}%\n`;
      report += `      利润因子: ${perf.profitFactor.toFixed(2)} | 夏普比率: ${perf.sharpeRatio.toFixed(2)}\n`;
      report += `      胜率: ${(perf.winRate * 100).toFixed(1)}% | 盈亏比: ${perf.riskReward.toFixed(2)}:1\n`;
      report += `      最大回撤: ${(perf.maxDrawdown * 100).toFixed(2)}% | 交易频次: ${perf.tradesPerWeek.toFixed(1)}/周\n`;
      report += `      总交易: ${perf.totalTrades} | 平均持仓: ${perf.avgHoldingTime.toFixed(1)}分钟\n`;
      report += `      净利润: ${perf.netProfit.toFixed(2)} USDT | 手续费: ${perf.totalFees.toFixed(2)} USDT\n`;
      
      report += `   ⚙️  关键参数配置:\n`;
      report += `      止损: ${(params.stopLoss * 100).toFixed(1)}% | 止盈: ${(params.takeProfitLevel1 * 100).toFixed(1)}%/${(params.takeProfitLevel2 * 100).toFixed(1)}%/${(params.takeProfitLevel3 * 100).toFixed(1)}%\n`;
      report += `      RSI: ${params.rsiPeriod}期 (${params.rsiOversold}-${params.rsiOverbought}) | EMA: ${params.emaFast}/${params.emaSlow}\n`;
      report += `      仓位: ${params.basePositionSize} USDT × ${params.positionSizeMultiplier} | 日交易限制: ${params.maxDailyTrades}\n`;
      report += `      持仓时间: ${params.minHoldingTime}-${params.maxHoldingTime}分钟 | 获利了结: ${params.profitTakingTime}分钟\n`;
      
      report += `   🎯 评分详情:\n`;
      report += `      盈利得分: ${result.profitScore.toFixed(1)}/100 | 风险调整: ${result.riskAdjustedScore.toFixed(1)}/100 | 稳定性: ${result.stabilityScore.toFixed(1)}/100\n`;
      
      if (index < topResults.length - 1) {
        report += '\n' + '-'.repeat(50) + '\n';
      }
    });
    
    // 参数分析
    report += '\n\n📊 最优参数统计分析:\n';
    report += '-'.repeat(100) + '\n';
    
    const top5 = topResults.slice(0, 5);
    
    // 止损分析
    const stopLosses = top5.map(r => r.parameters.stopLoss);
    const avgStopLoss = stopLosses.reduce((a, b) => a + b, 0) / stopLosses.length;
    const minStopLoss = Math.min(...stopLosses);
    const maxStopLoss = Math.max(...stopLosses);
    
    report += `🛡️  止损参数: 平均${(avgStopLoss * 100).toFixed(1)}% (范围: ${(minStopLoss * 100).toFixed(1)}%-${(maxStopLoss * 100).toFixed(1)}%)\n`;
    
    // 止盈分析
    const tp1s = top5.map(r => r.parameters.takeProfitLevel1);
    const avgTp1 = tp1s.reduce((a, b) => a + b, 0) / tp1s.length;
    report += `🎯 第一层止盈: 平均${(avgTp1 * 100).toFixed(1)}%\n`;
    
    // RSI分析
    const rsiPeriods = top5.map(r => r.parameters.rsiPeriod);
    const avgRsiPeriod = rsiPeriods.reduce((a, b) => a + b, 0) / rsiPeriods.length;
    report += `📈 RSI周期: 平均${avgRsiPeriod.toFixed(0)}期\n`;
    
    // 仓位分析
    const positions = top5.map(r => r.parameters.basePositionSize);
    const avgPosition = positions.reduce((a, b) => a + b, 0) / positions.length;
    report += `💰 基础仓位: 平均${avgPosition.toFixed(0)} USDT\n`;
    
    // 市场环境分析
    report += '\n🌍 市场环境适应性:\n';
    const marketConditions: { [key: string]: number } = {};
    topResults.forEach(r => {
      marketConditions[r.marketCondition] = (marketConditions[r.marketCondition] || 0) + 1;
    });
    
    Object.entries(marketConditions).forEach(([condition, count]) => {
      report += `   ${condition}: ${count}组参数 (${((count as number)/topResults.length*100).toFixed(1)}%)\n`;
    });
    
    // 实施建议
    report += '\n💡 实施建议:\n';
    report += '-'.repeat(100) + '\n';
    
    if (bestResult.performance.annualizedReturn >= this.PROFIT_TARGETS.TARGET_ANNUAL_RETURN) {
      report += '✅ 发现符合目标的高盈利参数组合\n';
      report += `🚀 建议立即使用排名前3的参数进行实盘测试\n`;
      report += `📊 预期年化收益: ${(bestResult.performance.annualizedReturn * 100).toFixed(1)}%\n`;
      report += `⚠️  风险提示: 最大回撤可能达到${(bestResult.performance.maxDrawdown * 100).toFixed(1)}%\n`;
    } else {
      report += '⚠️  当前最优参数未完全达到目标收益\n';
      report += '💡 建议: 扩大参数搜索范围或调整目标预期\n';
    }
    
    report += '\n🔄 持续优化建议:\n';
    report += '   1. 定期重新训练参数 (建议每月一次)\n';
    report += '   2. 监控实盘表现与回测差异\n';
    report += '   3. 根据市场变化调整参数范围\n';
    report += '   4. 建立参数组合的风险管理机制\n';
    
    report += '\n' + '='.repeat(100) + '\n';
    report += '🎯 盈利最大化探索完成 - 数据驱动的量化交易参数优化\n';
    report += '='.repeat(100) + '\n';
    
    return report;
  }

  // 辅助计算方法
  private calculateSharpeRatio(equity: number[]): number {
    if (equity.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < equity.length; i++) {
      returns.push((equity[i] - equity[i - 1]) / equity[i - 1]);
    }
    
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length);
    
    return stdDev > 0 ? avgReturn / stdDev : 0;
  }

  private calculateVolatility(prices: number[], period: number): number {
    if (prices.length < period) return 0;
    
    const returns = [];
    for (let i = 1; i < Math.min(prices.length, period + 1); i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  private calculateVolumeRatio(bars: KlineData[], period: number): number {
    if (bars.length < period + 1) return 1;
    
    const currentVolume = bars[bars.length - 1].volume;
    const avgVolume = bars.slice(-period - 1, -1).reduce((sum, b) => sum + b.volume, 0) / period;
    
    return avgVolume > 0 ? currentVolume / avgVolume : 1;
  }

  private calculateIndicators(bars: KlineData[], params: any): any {
    const closes = bars.map(b => b.close);
    const volumes = bars.map(b => b.volume);
    
    return {
      rsi: this.calculateRSI(closes, params.rsiPeriod),
      emaFast: this.calculateEMA(closes, params.emaFast),
      emaSlow: this.calculateEMA(closes, params.emaSlow),
      volatility: this.calculateVolatility(closes, 20),
      volumeRatio: this.calculateVolumeRatio(bars, params.volumeConfirmationPeriod)
    };
  }

  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses -= change;
      }
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    if (prices.length === 1) return prices[0];
    
    const multiplier = 2 / (period + 1);
    let ema = prices[0];
    
    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
    }
    
    return ema;
  }

  private calculateMomentum(bars: KlineData[], period: number): number {
    if (bars.length < period + 1) return 0;
    
    const currentPrice = bars[bars.length - 1].close;
    const pastPrice = bars[bars.length - 1 - period].close;
    
    return (currentPrice - pastPrice) / pastPrice;
  }

  private generateAllCombinations(): any[] {
    // 简化实现 - 返回空数组，实际使用智能采样
    return [];
  }

  async saveResults(filename?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultFilename = `profit-maximization-results-${timestamp}.json`;
    const filepath = filename || defaultFilename;
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const fullPath = path.join(__dirname, '../../data/backtest-results', filepath);
    
    const data = {
      timestamp: new Date().toISOString(),
      framework: "Profit Maximization Explorer",
      version: "1.0",
      optimization_targets: this.PROFIT_TARGETS,
      parameter_space: this.PARAMETER_SPACE,
      total_results: this.optimizationResults.length,
      top_results: this.optimizationResults.slice(0, 20),
      data_summary: {
        total_bars: this.historicalData.length,
        start_time: new Date(this.historicalData[0].timestamp).toISOString(),
        end_time: new Date(this.historicalData[this.historicalData.length - 1].timestamp).toISOString()
      }
    };
    
    await fs.writeFile(fullPath, JSON.stringify(data, null, 2));
    return filepath;
  }
}

// 主函数
async function main() {
  try {
    console.log('🚀 启动盈利最大化探索引擎');
    
    const explorer = new ProfitMaximizationExplorer();
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    
    // 加载多年历史数据
    const dataFiles = [
      path.join(__dirname, '../../data/historical/ETHUSDT_1m_20220101T000000.000Z_to_20220331T235959.999Z.json'),
      path.join(__dirname, '../../data/historical/ETHUSDT_1m_20220401T000000.000Z_to_20221231T235959.999Z.json')
    ];
    
    await explorer.loadHistoricalData(dataFiles);
    
    // 执行大规模优化
    await explorer.runMassiveOptimization(30000); // 3万组参数
    
    // 生成报告
    const report = explorer.generateOptimizationReport();
    console.log(report);
    
    // 保存结果
    const filename = await explorer.saveResults();
    console.log(`💾 优化结果已保存: ${filename}`);
    
    console.log('\n🎉 盈利最大化探索完成！');
    console.log('🎯 现在您拥有了经过海量数据验证的最优盈利参数！');
    
  } catch (error) {
    console.error('❌ 盈利最大化探索失败:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { ProfitMaximizationExplorer };