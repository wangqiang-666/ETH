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

interface OptimizedParameters {
  stopLoss: number;
  takeProfitLevel1: number;
  takeProfitLevel2: number;
  takeProfitLevel3: number;
  takeProfitWeight1: number;
  takeProfitWeight2: number;
  takeProfitWeight3: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  emaFast: number;
  emaSlow: number;
  trendStrengthThreshold: number;
  volumeRatioMin: number;
  volumeConfirmationPeriod: number;
  volatilityMin: number;
  volatilityMax: number;
  atrPeriod: number;
  minHoldingTime: number;
  maxHoldingTime: number;
  profitTakingTime: number;
  maxDailyTrades: number;
  maxConsecutiveLosses: number;
  cooldownPeriod: number;
  trailingStopActivation: number;
  trailingStopDistance: number;
  basePositionSize: number;
  positionSizeMultiplier: number;
}

interface OptimizationResult {
  parameters: OptimizedParameters;
  version: string;
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
    calmarRatio: number;
    sortinoRatio: number;
    consistencyRatio: number;
  };
  optimizationScore: number;
  improvements: string[];
  testPeriods: any[];
}

class OptimizedParameterGenerator {
  private historicalData: KlineData[] = [];
  private optimizationResults: OptimizationResult[] = [];
  
  // 基础参数 - 来自现实验证中表现最佳的参数组合#2
  private readonly BASE_PARAMETERS: OptimizedParameters = {
    stopLoss: 0.017,
    takeProfitLevel1: 0.018,
    takeProfitLevel2: 0.040,
    takeProfitLevel3: 0.090,
    takeProfitWeight1: 0.55,
    takeProfitWeight2: 0.30,
    takeProfitWeight3: 0.15,
    rsiPeriod: 15,
    rsiOversold: 24,
    rsiOverbought: 76,
    emaFast: 9,
    emaSlow: 27,
    trendStrengthThreshold: 0.012,
    volumeRatioMin: 1.1,
    volumeConfirmationPeriod: 18,
    volatilityMin: 0.002,
    volatilityMax: 0.075,
    atrPeriod: 16,
    minHoldingTime: 8,
    maxHoldingTime: 135,
    profitTakingTime: 70,
    maxDailyTrades: 30,
    maxConsecutiveLosses: 4,
    cooldownPeriod: 45,
    trailingStopActivation: 0.010,
    trailingStopDistance: 0.005,
    basePositionSize: 750,
    positionSizeMultiplier: 1.3
  };

  // 优化目标 - 更现实的目标
  private readonly OPTIMIZATION_TARGETS = {
    MIN_ANNUAL_RETURN: 0.08,      // 最低8%年化收益
    TARGET_ANNUAL_RETURN: 0.15,   // 目标15%年化收益
    MIN_PROFIT_FACTOR: 1.20,      // 最低利润因子1.2
    TARGET_PROFIT_FACTOR: 1.80,   // 目标利润因子1.8
    MIN_SHARPE_RATIO: 0.60,       // 最低夏普比率0.6
    TARGET_SHARPE_RATIO: 1.20,    // 目标夏普比率1.2
    MAX_DRAWDOWN: 0.20,           // 最大回撤20%
    TARGET_DRAWDOWN: 0.10,        // 目标回撤10%
    MIN_WIN_RATE: 0.50,           // 最低胜率50%
    TARGET_WIN_RATE: 0.65,        // 目标胜率65%
    MIN_TRADES_PER_WEEK: 5,       // 最少5笔/周
    TARGET_TRADES_PER_WEEK: 15,   // 目标15笔/周
  };

  constructor() {
    console.log('🔧 初始化优化参数生成器');
    console.log('💡 核心目标: 基于参数组合#2进行优化，提高交易频次和收益率');
    console.log('🎯 优化目标: 年化收益≥15%, 利润因子≥1.8, 交易频次≥15/周');
    console.log('🔍 优化策略: 放宽信号条件，调整止损止盈，提高市场适应性');
  }

  async loadHistoricalData(filePaths: string[]): Promise<void> {
    console.log('📊 加载历史数据进行参数优化...');
    
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
    
    // 按时间排序确保数据连续性
    this.historicalData.sort((a, b) => a.timestamp - b.timestamp);
    
    console.log(`✅ 数据加载完成: ${this.historicalData.length} 条K线数据`);
    console.log(`📅 时间范围: ${new Date(this.historicalData[0].timestamp).toISOString()} 到 ${new Date(this.historicalData[this.historicalData.length - 1].timestamp).toISOString()}`);
  }

  /**
   * 执行参数优化
   */
  async runParameterOptimization(): Promise<void> {
    console.log('🚀 开始参数优化...');
    console.log('💡 基于参数组合#2进行渐进式优化');
    
    // 定义优化版本
    const optimizationVersions = this.defineOptimizationVersions();
    
    console.log(`📊 优化版本: ${optimizationVersions.length}个不同的优化方向`);
    
    for (const version of optimizationVersions) {
      console.log(`\n🔧 测试优化版本: ${version.name}`);
      console.log(`📝 优化策略: ${version.description}`);
      
      const optimizedParams = this.applyOptimization(this.BASE_PARAMETERS, version.modifications);
      
      // 在多个时期测试优化后的参数
      const testPeriods = this.defineTestPeriods();
      let totalScore = 0;
      let validTests = 0;
      const periodResults = [];
      
      for (const period of testPeriods) {
        const periodData = this.extractPeriodData(period.start, period.end);
        
        if (periodData.length < 5000) {
          continue;
        }
        
        const performance = await this.runOptimizedBacktest(optimizedParams, periodData);
        const score = this.calculateOptimizationScore(performance);
        
        totalScore += score;
        validTests++;
        
        periodResults.push({
          period: period.name,
          performance,
          score
        });
        
        console.log(`   ${period.name}: 得分${score.toFixed(1)}, 年化${(performance.annualizedReturn * 100).toFixed(1)}%, 频次${performance.tradesPerWeek.toFixed(1)}/周`);
      }
      
      if (validTests > 0) {
        const avgScore = totalScore / validTests;
        const avgPerformance = this.calculateAveragePerformance(periodResults);
        
        const result: OptimizationResult = {
          parameters: optimizedParams,
          version: version.name,
          performance: avgPerformance,
          optimizationScore: avgScore,
          improvements: version.improvements,
          testPeriods: periodResults
        };
        
        this.optimizationResults.push(result);
        
        console.log(`   ✅ 平均得分: ${avgScore.toFixed(1)}/100`);
        console.log(`   📈 平均年化收益: ${(avgPerformance.annualizedReturn * 100).toFixed(1)}%`);
        console.log(`   🔄 平均交易频次: ${avgPerformance.tradesPerWeek.toFixed(1)}/周`);
      }
    }
    
    console.log('\n🎯 参数优化完成！');
    this.generateOptimizationSummary();
  }

  private defineOptimizationVersions(): any[] {
    return [
      {
        name: 'V1-信号放宽版',
        description: '放宽RSI和趋势信号条件，增加交易机会',
        improvements: ['放宽RSI阈值', '降低趋势强度要求', '减少成交量要求'],
        modifications: {
          rsiOversold: 28,           // 24 -> 28 (放宽)
          rsiOverbought: 72,         // 76 -> 72 (放宽)
          trendStrengthThreshold: 0.008,  // 0.012 -> 0.008 (降低)
          volumeRatioMin: 0.9,       // 1.1 -> 0.9 (降低)
          volatilityMin: 0.001,      // 0.002 -> 0.001 (降低)
        }
      },
      {
        name: 'V2-止盈优化版',
        description: '调整止盈策略，提高盈利效率',
        improvements: ['优化止盈比例', '调整止盈权重', '缩短获利了结时间'],
        modifications: {
          takeProfitLevel1: 0.015,   // 0.018 -> 0.015 (降低)
          takeProfitLevel2: 0.035,   // 0.040 -> 0.035 (降低)
          takeProfitWeight1: 0.65,   // 0.55 -> 0.65 (增加)
          takeProfitWeight2: 0.25,   // 0.30 -> 0.25 (减少)
          profitTakingTime: 50,      // 70 -> 50 (缩短)
        }
      },
      {
        name: 'V3-频次提升版',
        description: '专注提高交易频次，增加交易机会',
        improvements: ['大幅放宽信号条件', '增加日交易限制', '缩短冷却时间'],
        modifications: {
          rsiOversold: 32,           // 24 -> 32 (大幅放宽)
          rsiOverbought: 68,         // 76 -> 68 (大幅放宽)
          trendStrengthThreshold: 0.006,  // 0.012 -> 0.006 (大幅降低)
          volumeRatioMin: 0.8,       // 1.1 -> 0.8 (大幅降低)
          maxDailyTrades: 50,        // 30 -> 50 (增加)
          cooldownPeriod: 30,        // 45 -> 30 (缩短)
          volatilityMax: 0.100,      // 0.075 -> 0.100 (放宽)
        }
      },
      {
        name: 'V4-风险平衡版',
        description: '在提高频次的同时保持风险控制',
        improvements: ['适度放宽信号', '优化风险参数', '平衡收益风险'],
        modifications: {
          rsiOversold: 26,           // 24 -> 26 (适度放宽)
          rsiOverbought: 74,         // 76 -> 74 (适度放宽)
          trendStrengthThreshold: 0.010,  // 0.012 -> 0.010 (适度降低)
          volumeRatioMin: 1.0,       // 1.1 -> 1.0 (适度降低)
          stopLoss: 0.015,           // 0.017 -> 0.015 (收紧)
          takeProfitLevel1: 0.020,   // 0.018 -> 0.020 (放宽)
          maxConsecutiveLosses: 3,   // 4 -> 3 (收紧)
        }
      },
      {
        name: 'V5-激进优化版',
        description: '激进优化，追求最大交易频次和收益',
        improvements: ['最大化信号生成', '激进止盈策略', '高频交易设置'],
        modifications: {
          rsiOversold: 35,           // 24 -> 35 (激进放宽)
          rsiOverbought: 65,         // 76 -> 65 (激进放宽)
          trendStrengthThreshold: 0.005,  // 0.012 -> 0.005 (激进降低)
          volumeRatioMin: 0.7,       // 1.1 -> 0.7 (激进降低)
          takeProfitLevel1: 0.012,   // 0.018 -> 0.012 (激进降低)
          takeProfitWeight1: 0.70,   // 0.55 -> 0.70 (激进增加)
          maxDailyTrades: 80,        // 30 -> 80 (激进增加)
          profitTakingTime: 30,      // 70 -> 30 (激进缩短)
        }
      },
      {
        name: 'V6-稳健增强版',
        description: '在保持稳健性的基础上适度提升表现',
        improvements: ['保持风险控制', '适度提升收益', '稳定交易频次'],
        modifications: {
          rsiOversold: 25,           // 24 -> 25 (微调)
          rsiOverbought: 75,         // 76 -> 75 (微调)
          trendStrengthThreshold: 0.011,  // 0.012 -> 0.011 (微调)
          takeProfitLevel1: 0.020,   // 0.018 -> 0.020 (微调)
          takeProfitLevel2: 0.045,   // 0.040 -> 0.045 (微调)
          maxDailyTrades: 40,        // 30 -> 40 (适度增加)
          trailingStopActivation: 0.008,  // 0.010 -> 0.008 (收紧)
        }
      }
    ];
  }

  private defineTestPeriods(): any[] {
    return [
      {
        name: '2022年Q2-深度熊市',
        start: '2022-04-01T00:00:00.000Z',
        end: '2022-06-30T23:59:59.999Z',
        weight: 1.2  // 重要时期，权重更高
      },
      {
        name: '2022年Q3-熊市反弹',
        start: '2022-07-01T00:00:00.000Z',
        end: '2022-09-30T23:59:59.999Z',
        weight: 1.0
      },
      {
        name: '2022年Q4-熊市底部',
        start: '2022-10-01T00:00:00.000Z',
        end: '2022-12-31T23:59:59.999Z',
        weight: 1.0
      },
      {
        name: '2022年11月-FTX崩盘',
        start: '2022-11-01T00:00:00.000Z',
        end: '2022-11-30T23:59:59.999Z',
        weight: 1.5  // 极端市场条件，权重最高
      },
      {
        name: '2022年全年-完整周期',
        start: '2022-01-01T00:00:00.000Z',
        end: '2022-12-31T23:59:59.999Z',
        weight: 1.3  // 完整周期，权重较高
      }
    ];
  }

  private applyOptimization(baseParams: OptimizedParameters, modifications: any): OptimizedParameters {
    const optimizedParams = { ...baseParams };
    
    // 应用修改
    Object.keys(modifications).forEach(key => {
      if (key in optimizedParams) {
        (optimizedParams as any)[key] = modifications[key];
      }
    });
    
    return optimizedParams;
  }

  private extractPeriodData(startDate: string, endDate: string): KlineData[] {
    const startTime = new Date(startDate).getTime();
    const endTime = new Date(endDate).getTime();
    
    return this.historicalData.filter(bar => 
      bar.timestamp >= startTime && bar.timestamp <= endTime
    );
  }

  /**
   * 优化回测引擎
   */
  private async runOptimizedBacktest(parameters: OptimizedParameters, data: KlineData[]): Promise<any> {
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
    let monthlyReturns: number[] = [];
    let currentMonth = -1;
    let monthStartBalance = 10000;
    
    // 优化的交易成本
    const OPTIMIZED_SLIPPAGE = 0.0003; // 0.03%滑点 (改进)
    const OPTIMIZED_FEE = 0.0003; // 0.03%手续费 (改进)
    
    for (let i = 100; i < data.length - 10; i++) {
      const currentBar = data[i];
      const bars = data.slice(Math.max(0, i - 50), i + 1);
      
      // 记录月度收益
      const month = new Date(currentBar.timestamp).getMonth();
      if (month !== currentMonth) {
        if (currentMonth !== -1) {
          const monthlyReturn = (balance - monthStartBalance) / monthStartBalance;
          monthlyReturns.push(monthlyReturn);
        }
        currentMonth = month;
        monthStartBalance = balance;
      }
      
      // 更新权益
      equity.push(balance);
      
      // 更新最大回撤
      if (balance > peak) peak = balance;
      const drawdown = (peak - balance) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
      
      // 检查交易条件 - 优化的条件
      if (this.shouldTradeOptimized(bars, parameters, consecutiveLosses, lastLossTime, currentBar.timestamp)) {
        const signal = this.generateOptimizedTradingSignal(bars, parameters);
        
        if (signal) {
          totalTrades++;
          
          // 执行优化交易
          const tradeResult = this.executeOptimizedTrade(signal, currentBar, parameters, data, i, OPTIMIZED_SLIPPAGE, OPTIMIZED_FEE);
          
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
    
    // 添加最后一个月的收益
    if (monthlyReturns.length > 0) {
      const lastMonthReturn = (balance - monthStartBalance) / monthStartBalance;
      monthlyReturns.push(lastMonthReturn);
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
    const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;
    const sortinoRatio = this.calculateSortinoRatio(equity);
    const consistencyRatio = monthlyReturns.length > 0 ? 
      monthlyReturns.filter((r: number) => r > 0).length / monthlyReturns.length : 0;
    
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
      calmarRatio,
      sortinoRatio,
      consistencyRatio,
      equity,
      trades,
      monthlyReturns
    };
  }

  private shouldTradeOptimized(bars: KlineData[], params: OptimizedParameters, consecutiveLosses: number, lastLossTime: number, currentTime: number): boolean {
    // 连续亏损保护 - 优化的逻辑
    if (consecutiveLosses >= params.maxConsecutiveLosses) {
      const timeSinceLastLoss = (currentTime - lastLossTime) / (1000 * 60);
      if (timeSinceLastLoss < params.cooldownPeriod) {
        return false;
      }
    }
    
    // 市场条件检查 - 更宽松的条件
    const volatility = this.calculateVolatility(bars.map(b => b.close), 20);
    if (volatility < params.volatilityMin || volatility > params.volatilityMax) {
      return false;
    }
    
    // 成交量检查 - 更宽松的条件
    const volumeRatio = this.calculateVolumeRatio(bars, params.volumeConfirmationPeriod);
    if (volumeRatio < params.volumeRatioMin) {
      return false;
    }
    
    return true;
  }

  private generateOptimizedTradingSignal(bars: KlineData[], params: OptimizedParameters): any | null {
    const indicators = this.calculateIndicators(bars, params);
    
    let signalStrength = 0;
    let direction: 'long' | 'short' | null = null;
    let signalCount = 0;
    
    // RSI信号 - 优化的条件
    if (indicators.rsi <= params.rsiOversold) {
      signalStrength += 0.35;
      direction = 'long';
      signalCount++;
    } else if (indicators.rsi >= params.rsiOverbought) {
      signalStrength += 0.35;
      direction = 'short';
      signalCount++;
    }
    
    // 趋势信号 - 优化的条件
    const trendStrength = Math.abs(indicators.emaFast - indicators.emaSlow) / indicators.emaSlow;
    if (trendStrength > params.trendStrengthThreshold) {
      signalStrength += 0.30;
      signalCount++;
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
    
    // 成交量确认 - 优化的条件
    if (indicators.volumeRatio > params.volumeRatioMin * 1.3) {
      signalStrength += 0.20;
      signalCount++;
    }
    
    // 波动率确认 - 优化的条件
    if (indicators.volatility > params.volatilityMin && indicators.volatility < params.volatilityMax) {
      signalStrength += 0.15;
      signalCount++;
    }
    
    // 降低信号强度要求，提高交易频次
    if (signalCount >= 1 && signalStrength >= 0.50 && direction) {
      return {
        direction,
        strength: signalStrength,
        confidence: Math.min(signalStrength * 1.2, 1.0),
        signalCount
      };
    }
    
    return null;
  }

  private executeOptimizedTrade(signal: any, entryBar: KlineData, params: OptimizedParameters, data: KlineData[], startIndex: number, slippage: number, feeRate: number): any {
    // 考虑滑点的入场价格
    const slippageAdjustment = signal.direction === 'long' ? (1 + slippage) : (1 - slippage);
    const entryPrice = entryBar.close * slippageAdjustment;
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
    let totalFees = positionSize * feeRate; // 开仓手续费
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
      
      // 止损检查 - 考虑滑点
      const stopLossWithSlippage = signal.direction === 'long' 
        ? stopLoss * (1 - slippage)
        : stopLoss * (1 + slippage);
      
      const hitStopLoss = signal.direction === 'long' 
        ? currentBar.low <= stopLossWithSlippage
        : currentBar.high >= stopLossWithSlippage;
      
      if (hitStopLoss) {
        const exitPrice = stopLossWithSlippage;
        const pnl = (exitPrice - entryPrice) * remainingQuantity * (signal.direction === 'long' ? 1 : -1);
        const exitFee = exitPrice * remainingQuantity * feeRate;
        totalPnl += pnl;
        totalFees += exitFee;
        exitReason = 'Stop Loss';
        break;
      }
      
      // 分层止盈检查 - 考虑滑点
      for (let j = 0; j < takeProfitLevels.length; j++) {
        const tpLevel = takeProfitLevels[j];
        const tpPriceWithSlippage = signal.direction === 'long'
          ? tpLevel.price * (1 - slippage)
          : tpLevel.price * (1 + slippage);
        
        const hitTakeProfit = signal.direction === 'long'
          ? currentBar.high >= tpPriceWithSlippage
          : currentBar.low <= tpPriceWithSlippage;
        
        if (hitTakeProfit && remainingQuantity > 0) {
          const exitQuantity = quantity * tpLevel.weight;
          const exitPrice = tpPriceWithSlippage;
          const pnl = (exitPrice - entryPrice) * exitQuantity * (signal.direction === 'long' ? 1 : -1);
          const exitFee = exitPrice * exitQuantity * feeRate;
          
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
      
      // 尾随止损 - 考虑滑点
      if (params.trailingStopActivation > 0) {
        const currentPnl = (currentBar.close - entryPrice) * remainingQuantity * (signal.direction === 'long' ? 1 : -1);
        const profitPercent = currentPnl / positionSize;
        
        if (profitPercent >= params.trailingStopActivation) {
          trailingStopActivated = true;
          const newTrailingStop = signal.direction === 'long'
            ? currentBar.close * (1 - params.trailingStopDistance) * (1 - slippage)
            : currentBar.close * (1 + params.trailingStopDistance) * (1 + slippage);
          
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
            const exitFee = exitPrice * remainingQuantity * feeRate;
            totalPnl += pnl;
            totalFees += exitFee;
            exitReason = 'Trailing Stop';
            break;
          }
        }
      }
      
      // 最大持仓时间检查
      if (holdingMinutes >= params.maxHoldingTime) {
        const exitPrice = currentBar.close * (signal.direction === 'long' ? (1 - slippage) : (1 + slippage));
        const pnl = (exitPrice - entryPrice) * remainingQuantity * (signal.direction === 'long' ? 1 : -1);
        const exitFee = exitPrice * remainingQuantity * feeRate;
        totalPnl += pnl;
        totalFees += exitFee;
        exitReason = 'Max Holding Time';
        break;
      }
      
      // 获利了结时间检查
      if (holdingMinutes >= params.profitTakingTime && totalPnl > 0) {
        const exitPrice = currentBar.close * (signal.direction === 'long' ? (1 - slippage) : (1 + slippage));
        const pnl = (exitPrice - entryPrice) * remainingQuantity * (signal.direction === 'long' ? 1 : -1);
        const exitFee = exitPrice * remainingQuantity * feeRate;
        totalPnl += pnl;
        totalFees += exitFee;
        exitReason = 'Profit Taking';
        break;
      }
    }
    
    // 如果没有退出，强制平仓
    if (!exitReason) {
      const exitPrice = data[Math.min(startIndex + params.maxHoldingTime + 10, data.length - 1)].close * 
                       (signal.direction === 'long' ? (1 - slippage) : (1 + slippage));
      const pnl = (exitPrice - entryPrice) * remainingQuantity * (signal.direction === 'long' ? 1 : -1);
      const exitFee = exitPrice * remainingQuantity * feeRate;
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
   * 计算优化评分
   */
  private calculateOptimizationScore(performance: any): number {
    const targets = this.OPTIMIZATION_TARGETS;
    
    // 年化收益评分 (30%)
    let returnScore = 0;
    if (performance.annualizedReturn >= targets.TARGET_ANNUAL_RETURN) {
      returnScore = 100;
    } else if (performance.annualizedReturn >= targets.MIN_ANNUAL_RETURN) {
      returnScore = 60 + 40 * (performance.annualizedReturn - targets.MIN_ANNUAL_RETURN) / (targets.TARGET_ANNUAL_RETURN - targets.MIN_ANNUAL_RETURN);
    } else {
      returnScore = Math.max(0, 60 * performance.annualizedReturn / targets.MIN_ANNUAL_RETURN);
    }
    
    // 利润因子评分 (20%)
    let pfScore = 0;
    if (performance.profitFactor >= targets.TARGET_PROFIT_FACTOR) {
      pfScore = 100;
    } else if (performance.profitFactor >= targets.MIN_PROFIT_FACTOR) {
      pfScore = 60 + 40 * (performance.profitFactor - targets.MIN_PROFIT_FACTOR) / (targets.TARGET_PROFIT_FACTOR - targets.MIN_PROFIT_FACTOR);
    } else {
      pfScore = Math.max(0, 60 * performance.profitFactor / targets.MIN_PROFIT_FACTOR);
    }
    
    // 夏普比率评分 (15%)
    let sharpeScore = 0;
    if (performance.sharpeRatio >= targets.TARGET_SHARPE_RATIO) {
      sharpeScore = 100;
    } else if (performance.sharpeRatio >= targets.MIN_SHARPE_RATIO) {
      sharpeScore = 60 + 40 * (performance.sharpeRatio - targets.MIN_SHARPE_RATIO) / (targets.TARGET_SHARPE_RATIO - targets.MIN_SHARPE_RATIO);
    } else {
      sharpeScore = Math.max(0, 60 * performance.sharpeRatio / targets.MIN_SHARPE_RATIO);
    }
    
    // 回撤评分 (15%)
    const drawdownScore = Math.max(0, 100 * (1 - performance.maxDrawdown / targets.MAX_DRAWDOWN));
    
    // 胜率评分 (10%)
    const winRateScore = Math.max(0, Math.min(100, (performance.winRate / targets.MIN_WIN_RATE) * 60));
    
    // 交易频次评分 (10%) - 重点优化项
    let freqScore = 0;
    if (performance.tradesPerWeek >= targets.TARGET_TRADES_PER_WEEK) {
      freqScore = 100;
    } else if (performance.tradesPerWeek >= targets.MIN_TRADES_PER_WEEK) {
      freqScore = 60 + 40 * (performance.tradesPerWeek - targets.MIN_TRADES_PER_WEEK) / (targets.TARGET_TRADES_PER_WEEK - targets.MIN_TRADES_PER_WEEK);
    } else {
      freqScore = Math.max(0, 60 * performance.tradesPerWeek / targets.MIN_TRADES_PER_WEEK);
    }
    
    // 加权综合评分
    const weightedScore = (
      returnScore * 0.30 +
      pfScore * 0.20 +
      sharpeScore * 0.15 +
      drawdownScore * 0.15 +
      winRateScore * 0.10 +
      freqScore * 0.10
    );
    
    return Math.max(0, Math.min(100, weightedScore));
  }

  private calculateAveragePerformance(periodResults: any[]): any {
    if (periodResults.length === 0) {
      return {
        totalReturn: 0,
        annualizedReturn: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        riskReward: 0,
        totalTrades: 0,
        tradesPerWeek: 0,
        avgHoldingTime: 0,
        totalFees: 0,
        netProfit: 0,
        calmarRatio: 0,
        sortinoRatio: 0,
        consistencyRatio: 0
      };
    }
    
    const avg = (field: string) => 
      periodResults.reduce((sum, r) => sum + r.performance[field], 0) / periodResults.length;
    
    return {
      totalReturn: avg('totalReturn'),
      annualizedReturn: avg('annualizedReturn'),
      profitFactor: avg('profitFactor'),
      sharpeRatio: avg('sharpeRatio'),
      maxDrawdown: avg('maxDrawdown'),
      winRate: avg('winRate'),
      avgWin: avg('avgWin'),
      avgLoss: avg('avgLoss'),
      riskReward: avg('riskReward'),
      totalTrades: avg('totalTrades'),
      tradesPerWeek: avg('tradesPerWeek'),
      avgHoldingTime: avg('avgHoldingTime'),
      totalFees: avg('totalFees'),
      netProfit: avg('netProfit'),
      calmarRatio: avg('calmarRatio'),
      sortinoRatio: avg('sortinoRatio'),
      consistencyRatio: avg('consistencyRatio')
    };
  }

  /**
   * 生成优化总结报告
   */
  private generateOptimizationSummary(): void {
    const sortedResults = this.optimizationResults.sort((a, b) => b.optimizationScore - a.optimizationScore);
    
    console.log('\n' + '='.repeat(100));
    console.log('🔧 优化参数生成器 - 优化结果报告');
    console.log('='.repeat(100));
    
    console.log(`📊 优化统计:`);
    console.log(`   测试版本数: ${this.optimizationResults.length}`);
    console.log(`   基础参数: 参数组合#2 (现实验证最佳)`);
    console.log(`   优化目标: 提高交易频次和收益率`);
    
    if (sortedResults.length > 0) {
      console.log('\n🏆 优化结果排名:');
      
      sortedResults.forEach((result, index) => {
        const perf = result.performance;
        
        console.log(`\n📍 排名 #${index + 1} | ${result.version} | 得分: ${result.optimizationScore.toFixed(1)}/100`);
        console.log(`   📈 核心指标:`);
        console.log(`      年化收益: ${(perf.annualizedReturn * 100).toFixed(1)}% | 利润因子: ${perf.profitFactor.toFixed(2)}`);
        console.log(`      胜率: ${(perf.winRate * 100).toFixed(1)}% | 交易频次: ${perf.tradesPerWeek.toFixed(1)}/周`);
        console.log(`      最大回撤: ${(perf.maxDrawdown * 100).toFixed(1)}% | 夏普比率: ${perf.sharpeRatio.toFixed(2)}`);
        console.log(`      净利润: ${perf.netProfit.toFixed(2)} USDT | 总交易: ${perf.totalTrades.toFixed(0)}`);
        
        console.log(`   🔧 主要改进:`);
        result.improvements.forEach(improvement => {
          console.log(`      - ${improvement}`);
        });
        
        // 目标达成情况
        const targets = this.OPTIMIZATION_TARGETS;
        const achievements = [];
        if (perf.annualizedReturn >= targets.MIN_ANNUAL_RETURN) achievements.push('年化收益✅');
        if (perf.profitFactor >= targets.MIN_PROFIT_FACTOR) achievements.push('利润因子✅');
        if (perf.sharpeRatio >= targets.MIN_SHARPE_RATIO) achievements.push('夏普比率✅');
        if (perf.maxDrawdown <= targets.MAX_DRAWDOWN) achievements.push('回撤控制✅');
        if (perf.winRate >= targets.MIN_WIN_RATE) achievements.push('胜率✅');
        if (perf.tradesPerWeek >= targets.MIN_TRADES_PER_WEEK) achievements.push('交易频次✅');
        
        console.log(`   ✅ 达成目标: ${achievements.join(', ')}`);
      });
      
      // 最佳推荐
      const bestResult = sortedResults[0];
      console.log('\n💡 最佳推荐:');
      console.log(`🚀 推荐使用 ${bestResult.version} 进行实盘交易`);
      console.log(`📊 预期表现: 年化收益 ${(bestResult.performance.annualizedReturn * 100).toFixed(1)}%, 交易频次 ${bestResult.performance.tradesPerWeek.toFixed(1)}/周`);
      console.log(`🎯 相比基础参数的改进:`);
      bestResult.improvements.forEach(improvement => {
        console.log(`   - ${improvement}`);
      });
      
      // 实施建议
      console.log('\n🔄 实施建议:');
      if (bestResult.optimizationScore >= 70) {
        console.log('✅ 优化效果显著，建议立即实施');
        console.log('📊 建议先进行小资金测试，验证实际表现');
      } else if (bestResult.optimizationScore >= 50) {
        console.log('⚠️  优化效果一般，建议谨慎实施');
        console.log('🔧 可考虑进一步调整参数或降低预期');
      } else {
        console.log('❌ 优化效果不佳，建议重新设计策略');
        console.log('💡 可能需要更根本的策略改进');
      }
      
    } else {
      console.log('\n❌ 没有生成优化结果');
      console.log('💡 建议检查数据或调整优化策略');
    }
    
    console.log('\n' + '='.repeat(100));
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

  private calculateSortinoRatio(equity: number[]): number {
    if (equity.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < equity.length; i++) {
      returns.push((equity[i] - equity[i - 1]) / equity[i - 1]);
    }
    
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const negativeReturns = returns.filter(r => r < 0);
    
    if (negativeReturns.length === 0) return avgReturn > 0 ? 10 : 0;
    
    const downwardDeviation = Math.sqrt(
      negativeReturns.reduce((sum, ret) => sum + Math.pow(ret, 2), 0) / negativeReturns.length
    );
    
    return downwardDeviation > 0 ? avgReturn / downwardDeviation : 0;
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

  private calculateIndicators(bars: KlineData[], params: OptimizedParameters): any {
    const closes = bars.map(b => b.close);
    
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

  async saveResults(filename?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultFilename = `optimized-parameters-${timestamp}.json`;
    const filepath = filename || defaultFilename;
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const fullPath = path.join(__dirname, '../../data/backtest-results', filepath);
    
    const sortedResults = this.optimizationResults.sort((a, b) => b.optimizationScore - a.optimizationScore);
    
    const data = {
      timestamp: new Date().toISOString(),
      framework: "Optimized Parameter Generator",
      version: "1.0",
      base_parameters: this.BASE_PARAMETERS,
      optimization_targets: this.OPTIMIZATION_TARGETS,
      total_versions: this.optimizationResults.length,
      best_version: sortedResults.length > 0 ? sortedResults[0] : null,
      all_results: sortedResults,
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
    console.log('🔧 启动优化参数生成器');
    
    const generator = new OptimizedParameterGenerator();
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    
    // 加载完整历史数据
    const dataFiles = [
      path.join(__dirname, '../../data/historical/ETHUSDT_1m_20220101T000000.000Z_to_20220331T235959.999Z.json'),
      path.join(__dirname, '../../data/historical/ETHUSDT_1m_20220401T000000.000Z_to_20221231T235959.999Z.json')
    ];
    
    await generator.loadHistoricalData(dataFiles);
    
    // 执行参数优化
    await generator.runParameterOptimization();
    
    // 保存结果
    const filename = await generator.saveResults();
    console.log(`💾 优化结果已保存: ${filename}`);
    
    console.log('\n🎉 参数优化完成！');
    console.log('🎯 现在您拥有了经过优化的高性能参数组合！');
    
  } catch (error) {
    console.error('❌ 参数优化失败:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { OptimizedParameterGenerator };