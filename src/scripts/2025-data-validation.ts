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

interface V5Parameters {
  // V5-激进优化版参数 (经过验证的最佳参数)
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

interface TestResult {
  period: string;
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
    consistencyRatio: number;
  };
  trades: any[];
  equity: number[];
  monthlyReturns: number[];
  score: number;
}

class Data2025Validator {
  private data2025: KlineData[] = [];
  private testResults: TestResult[] = [];
  
  // V5-激进优化版参数 (在2022年数据上表现最佳)
  private readonly V5_PARAMETERS: V5Parameters = {
    // 基础参数 - 激进优化
    stopLoss: 0.017,               // 保持风险控制
    takeProfitLevel1: 0.012,       // 激进降低 (快速获利)
    takeProfitLevel2: 0.040,       // 中期目标
    takeProfitLevel3: 0.090,       // 长期目标
    takeProfitWeight1: 0.70,       // 激进增加 (集中获利)
    takeProfitWeight2: 0.20,       // 相应减少
    takeProfitWeight3: 0.10,       // 相应减少
    
    // 技术指标参数 - 大幅放宽
    rsiPeriod: 15,                 // RSI周期
    rsiOversold: 35,               // 激进放宽 (24->35)
    rsiOverbought: 65,             // 激进放宽 (76->65)
    emaFast: 9,                    // 快速EMA
    emaSlow: 27,                   // 慢速EMA
    trendStrengthThreshold: 0.005, // 激进降低 (0.012->0.005)
    
    // 市场条件参数 - 大幅放宽
    volumeRatioMin: 0.7,           // 激进降低 (1.1->0.7)
    volumeConfirmationPeriod: 18,  // 成交量确认周期
    volatilityMin: 0.002,          // 最小波动率
    volatilityMax: 0.075,          // 最大波动率
    atrPeriod: 16,                 // ATR周期
    
    // 时间管理参数 - 激进优化
    minHoldingTime: 8,             // 最小持仓时间(分钟)
    maxHoldingTime: 135,           // 最大持仓时间(分钟)
    profitTakingTime: 30,          // 激进缩短 (70->30)
    
    // 风险控制参数 - 激进调整
    maxDailyTrades: 80,            // 激进增加 (30->80)
    maxConsecutiveLosses: 4,       // 最大连续亏损
    cooldownPeriod: 45,            // 冷却时间(分钟)
    
    // 尾随止损参数
    trailingStopActivation: 0.010, // 尾随止损激活
    trailingStopDistance: 0.005,   // 尾随止损距离
    
    // 仓位管理参数
    basePositionSize: 750,         // 基础仓位大小
    positionSizeMultiplier: 1.3    // 仓位倍数
  };

  constructor() {
    console.log('🚀 初始化2025年数据验证器');
    console.log('💡 使用V5-激进优化版参数测试2025年真实市场表现');
    console.log('🎯 验证目标: 检验策略在2025年牛市环境下的实际效果');
    console.log('📊 测试范围: 2025年1月至9月的完整数据');
  }

  async load2025Data(): Promise<void> {
    console.log('📊 加载2025年历史数据...');
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const dataPath = path.join(__dirname, '../../data/historical/ETHUSDT_1m_20250101T000000.000Z_to_20250926T103749.164Z.json');
    
    console.log(`📁 加载文件: ${path.basename(dataPath)}`);
    
    const rawData = await fs.readFile(dataPath, 'utf-8');
    const historicalDataFile = JSON.parse(rawData);
    
    this.data2025 = historicalDataFile.data.map((item: any) => ({
      timestamp: item.timestamp,
      open: parseFloat(item.open),
      high: parseFloat(item.high),
      low: parseFloat(item.low),
      close: parseFloat(item.close),
      volume: parseFloat(item.volume)
    }));
    
    // 按时间排序确保数据连续性
    this.data2025.sort((a, b) => a.timestamp - b.timestamp);
    
    console.log(`✅ 2025年数据加载完成: ${this.data2025.length} 条K线数据`);
    console.log(`📅 时间范围: ${new Date(this.data2025[0].timestamp).toISOString()} 到 ${new Date(this.data2025[this.data2025.length - 1].timestamp).toISOString()}`);
    
    // 分析2025年市场特征
    this.analyze2025MarketConditions();
  }

  private analyze2025MarketConditions(): void {
    const startPrice = this.data2025[0].close;
    const endPrice = this.data2025[this.data2025.length - 1].close;
    const totalReturn = (endPrice - startPrice) / startPrice;
    
    const prices = this.data2025.map(d => d.close);
    const volatility = this.calculateVolatility(prices, prices.length);
    
    console.log('\n📈 2025年市场特征分析:');
    console.log(`   起始价格: $${startPrice.toFixed(2)}`);
    console.log(`   结束价格: $${endPrice.toFixed(2)}`);
    console.log(`   总涨幅: ${(totalReturn * 100).toFixed(1)}%`);
    console.log(`   市场波动率: ${(volatility * 100).toFixed(2)}%`);
    
    let marketType = '';
    if (totalReturn > 0.5) marketType = '强牛市';
    else if (totalReturn > 0.2) marketType = '牛市';
    else if (totalReturn > -0.2) marketType = '震荡市';
    else if (totalReturn > -0.5) marketType = '熊市';
    else marketType = '深熊市';
    
    console.log(`   市场类型: ${marketType}`);
  }

  /**
   * 执行2025年数据测试
   */
  async run2025Validation(): Promise<void> {
    console.log('\n🚀 开始2025年数据验证测试...');
    console.log('💡 使用在2022年熊市中验证的V5-激进优化版参数');
    
    // 定义2025年测试时期
    const testPeriods = this.define2025TestPeriods();
    
    console.log(`📊 测试时期: ${testPeriods.length}个不同的2025年阶段`);
    
    for (const period of testPeriods) {
      console.log(`\n📈 测试时期: ${period.name} (${period.description})`);
      
      const periodData = this.extractPeriodData(period.start, period.end);
      
      if (periodData.length < 1000) {
        console.log(`⚠️  数据不足，跳过此时期`);
        continue;
      }
      
      const performance = await this.run2025Backtest(this.V5_PARAMETERS, periodData);
      const score = this.calculate2025Score(performance);
      
      const result: TestResult = {
        period: period.name,
        performance,
        trades: performance.trades || [],
        equity: performance.equity || [],
        monthlyReturns: performance.monthlyReturns || [],
        score
      };
      
      this.testResults.push(result);
      
      console.log(`   📊 测试结果:`);
      console.log(`   年化收益: ${(performance.annualizedReturn * 100).toFixed(1)}% | 利润因子: ${performance.profitFactor.toFixed(2)}`);
      console.log(`   胜率: ${(performance.winRate * 100).toFixed(1)}% | 交易频次: ${performance.tradesPerWeek.toFixed(1)}/周`);
      console.log(`   最大回撤: ${(performance.maxDrawdown * 100).toFixed(1)}% | 夏普比率: ${performance.sharpeRatio.toFixed(2)}`);
      console.log(`   净利润: ${performance.netProfit.toFixed(2)} USDT | 总交易: ${performance.totalTrades}`);
      console.log(`   综合得分: ${score.toFixed(1)}/100`);
    }
    
    console.log('\n🎯 2025年数据验证完成！');
    this.generate2025Report();
  }

  private define2025TestPeriods(): any[] {
    return [
      // 月度测试 - 2025年各月份
      {
        name: '2025年1月',
        start: '2025-01-01T00:00:00.000Z',
        end: '2025-01-31T23:59:59.999Z',
        description: '2025年开局'
      },
      {
        name: '2025年2月',
        start: '2025-02-01T00:00:00.000Z',
        end: '2025-02-28T23:59:59.999Z',
        description: '春节期间'
      },
      {
        name: '2025年3月',
        start: '2025-03-01T00:00:00.000Z',
        end: '2025-03-31T23:59:59.999Z',
        description: '第一季度末'
      },
      {
        name: '2025年4月',
        start: '2025-04-01T00:00:00.000Z',
        end: '2025-04-30T23:59:59.999Z',
        description: '第二季度开始'
      },
      {
        name: '2025年5月',
        start: '2025-05-01T00:00:00.000Z',
        end: '2025-05-31T23:59:59.999Z',
        description: '春季行情'
      },
      {
        name: '2025年6月',
        start: '2025-06-01T00:00:00.000Z',
        end: '2025-06-30T23:59:59.999Z',
        description: '第二季度末'
      },
      {
        name: '2025年7月',
        start: '2025-07-01T00:00:00.000Z',
        end: '2025-07-31T23:59:59.999Z',
        description: '夏季行情'
      },
      {
        name: '2025年8月',
        start: '2025-08-01T00:00:00.000Z',
        end: '2025-08-31T23:59:59.999Z',
        description: '夏末行情'
      },
      {
        name: '2025年9月',
        start: '2025-09-01T00:00:00.000Z',
        end: '2025-09-26T23:59:59.999Z',
        description: '第三季度末'
      },
      
      // 季度测试
      {
        name: '2025年Q1',
        start: '2025-01-01T00:00:00.000Z',
        end: '2025-03-31T23:59:59.999Z',
        description: '第一季度完整'
      },
      {
        name: '2025年Q2',
        start: '2025-04-01T00:00:00.000Z',
        end: '2025-06-30T23:59:59.999Z',
        description: '第二季度完整'
      },
      {
        name: '2025年Q3',
        start: '2025-07-01T00:00:00.000Z',
        end: '2025-09-26T23:59:59.999Z',
        description: '第三季度(至9月26日)'
      },
      
      // 半年和全期测试
      {
        name: '2025年上半年',
        start: '2025-01-01T00:00:00.000Z',
        end: '2025-06-30T23:59:59.999Z',
        description: '上半年完整'
      },
      {
        name: '2025年1-9月',
        start: '2025-01-01T00:00:00.000Z',
        end: '2025-09-26T23:59:59.999Z',
        description: '全期数据'
      }
    ];
  }

  private extractPeriodData(startDate: string, endDate: string): KlineData[] {
    const startTime = new Date(startDate).getTime();
    const endTime = new Date(endDate).getTime();
    
    return this.data2025.filter(bar => 
      bar.timestamp >= startTime && bar.timestamp <= endTime
    );
  }

  /**
   * 2025年回测引擎
   */
  private async run2025Backtest(parameters: V5Parameters, data: KlineData[]): Promise<any> {
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
    
    // 2025年优化的交易成本 (更现实的设置)
    const REALISTIC_SLIPPAGE = 0.0003; // 0.03%滑点
    const REALISTIC_FEE = 0.0003; // 0.03%手续费
    
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
      
      // 检查交易条件
      if (this.shouldTrade2025(bars, parameters, consecutiveLosses, lastLossTime, currentBar.timestamp)) {
        const signal = this.generate2025TradingSignal(bars, parameters);
        
        if (signal) {
          totalTrades++;
          
          // 执行2025年交易
          const tradeResult = this.execute2025Trade(signal, currentBar, parameters, data, i, REALISTIC_SLIPPAGE, REALISTIC_FEE);
          
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
      consistencyRatio,
      equity,
      trades,
      monthlyReturns
    };
  }

  private shouldTrade2025(bars: KlineData[], params: V5Parameters, consecutiveLosses: number, lastLossTime: number, currentTime: number): boolean {
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

  private generate2025TradingSignal(bars: KlineData[], params: V5Parameters): any | null {
    const indicators = this.calculateIndicators(bars, params);
    
    let signalStrength = 0;
    let direction: 'long' | 'short' | null = null;
    let signalCount = 0;
    
    // RSI信号 - V5激进设置
    if (indicators.rsi <= params.rsiOversold) {
      signalStrength += 0.40;
      direction = 'long';
      signalCount++;
    } else if (indicators.rsi >= params.rsiOverbought) {
      signalStrength += 0.40;
      direction = 'short';
      signalCount++;
    }
    
    // 趋势信号 - V5激进设置
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
    
    // 成交量确认
    if (indicators.volumeRatio > params.volumeRatioMin * 1.2) {
      signalStrength += 0.20;
      signalCount++;
    }
    
    // 波动率确认
    if (indicators.volatility > params.volatilityMin && indicators.volatility < params.volatilityMax) {
      signalStrength += 0.10;
      signalCount++;
    }
    
    // V5激进设置：降低信号强度要求，最大化交易频次
    if (signalCount >= 1 && signalStrength >= 0.40 && direction) {
      return {
        direction,
        strength: signalStrength,
        confidence: Math.min(signalStrength * 1.3, 1.0),
        signalCount
      };
    }
    
    return null;
  }

  private execute2025Trade(signal: any, entryBar: KlineData, params: V5Parameters, data: KlineData[], startIndex: number, slippage: number, feeRate: number): any {
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
      
      // 获利了结时间检查 - V5激进设置
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
   * 计算2025年评分
   */
  private calculate2025Score(performance: any): number {
    // 2025年评分标准 (适应牛市环境)
    const targets = {
      MIN_ANNUAL_RETURN: 0.30,      // 最低30%年化收益
      TARGET_ANNUAL_RETURN: 1.00,   // 目标100%年化收益
      MIN_PROFIT_FACTOR: 1.20,      // 最低利润因子1.2
      TARGET_PROFIT_FACTOR: 2.00,   // 目标利润因子2.0
      MIN_SHARPE_RATIO: 0.50,       // 最低夏普比率0.5
      TARGET_SHARPE_RATIO: 1.50,    // 目标夏普比率1.5
      MAX_DRAWDOWN: 0.20,           // 最大回撤20%
      MIN_WIN_RATE: 0.50,           // 最低胜率50%
      MIN_TRADES_PER_WEEK: 20,      // 最少20笔/周
      TARGET_TRADES_PER_WEEK: 80,   // 目标80笔/周
    };
    
    // 年化收益评分 (40%)
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
    
    // 回撤评分 (10%)
    const drawdownScore = Math.max(0, 100 * (1 - performance.maxDrawdown / targets.MAX_DRAWDOWN));
    
    // 胜率评分 (10%)
    const winRateScore = Math.max(0, Math.min(100, (performance.winRate / targets.MIN_WIN_RATE) * 60));
    
    // 交易频次评分 (5%)
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
      returnScore * 0.40 +
      pfScore * 0.20 +
      sharpeScore * 0.15 +
      drawdownScore * 0.10 +
      winRateScore * 0.10 +
      freqScore * 0.05
    );
    
    return Math.max(0, Math.min(100, weightedScore));
  }

  /**
   * 生成2025年测试报告
   */
  private generate2025Report(): void {
    const sortedResults = this.testResults.sort((a, b) => b.score - a.score);
    
    console.log('\n' + '='.repeat(120));
    console.log('🚀 2025年数据验证报告 - V5-激进优化版在牛市环境下的表现');
    console.log('='.repeat(120));
    
    console.log(`📊 验证统计:`);
    console.log(`   策略版本: V5-激进优化版 (2022年熊市训练)`);
    console.log(`   测试数据: 2025年1月-9月真实K线数据`);
    console.log(`   总测试数: ${this.testResults.length}`);
    console.log(`   平均得分: ${(sortedResults.reduce((sum, r) => sum + r.score, 0) / this.testResults.length).toFixed(1)}/100`);
    
    // 最佳表现
    if (sortedResults.length > 0) {
      const bestResult = sortedResults[0];
      console.log('\n🏆 最佳表现:');
      console.log(`   测试时期: ${bestResult.period}`);
      console.log(`   综合得分: ${bestResult.score.toFixed(1)}/100`);
      console.log(`   年化收益: ${(bestResult.performance.annualizedReturn * 100).toFixed(1)}%`);
      console.log(`   利润因子: ${bestResult.performance.profitFactor.toFixed(2)}`);
      console.log(`   胜率: ${(bestResult.performance.winRate * 100).toFixed(1)}%`);
      console.log(`   交易频次: ${bestResult.performance.tradesPerWeek.toFixed(1)}/周`);
      console.log(`   最大回撤: ${(bestResult.performance.maxDrawdown * 100).toFixed(1)}%`);
      console.log(`   净利润: ${bestResult.performance.netProfit.toFixed(2)} USDT`);
    }
    
    // TOP 10 结果
    console.log('\n📊 TOP 10 测试结果:');
    console.log('-'.repeat(120));
    const top10 = sortedResults.slice(0, 10);
    top10.forEach((result, index) => {
      const perf = result.performance;
      console.log(`#${(index + 1).toString().padStart(2)} ${result.period.padEnd(20)} | 得分:${result.score.toFixed(1).padStart(5)} | 年化:${(perf.annualizedReturn * 100).toFixed(1).padStart(6)}% | 频次:${perf.tradesPerWeek.toFixed(1).padStart(5)}/周 | 回撤:${(perf.maxDrawdown * 100).toFixed(1).padStart(4)}% | 净利:${perf.netProfit.toFixed(0).padStart(6)}`);
    });
    
    // 月度表现分析
    const monthlyResults = sortedResults.filter(r => r.period.includes('2025年') && r.period.includes('月') && !r.period.includes('Q') && !r.period.includes('上半年') && !r.period.includes('1-9月'));
    if (monthlyResults.length > 0) {
      console.log('\n📅 月度表现分析:');
      const avgMonthlyReturn = monthlyResults.reduce((sum, r) => sum + r.performance.annualizedReturn, 0) / monthlyResults.length;
      const avgMonthlyScore = monthlyResults.reduce((sum, r) => sum + r.score, 0) / monthlyResults.length;
      const profitableMonths = monthlyResults.filter(r => r.performance.netProfit > 0).length;
      
      console.log(`   盈利月份: ${profitableMonths}/${monthlyResults.length} (${(profitableMonths/monthlyResults.length*100).toFixed(1)}%)`);
      console.log(`   平均月度年化收益: ${(avgMonthlyReturn * 100).toFixed(1)}%`);
      console.log(`   平均月度得分: ${avgMonthlyScore.toFixed(1)}/100`);
    }
    
    // 策略适应性分析
    console.log('\n🎯 策略适应性分析:');
    const totalNetProfit = sortedResults.reduce((sum, r) => sum + r.performance.netProfit, 0);
    const totalTrades = sortedResults.reduce((sum, r) => sum + r.performance.totalTrades, 0);
    const avgWinRate = sortedResults.reduce((sum, r) => sum + r.performance.winRate, 0) / sortedResults.length;
    
    console.log(`   总净利润: ${totalNetProfit.toFixed(2)} USDT`);
    console.log(`   总交易数: ${totalTrades}`);
    console.log(`   平均胜率: ${(avgWinRate * 100).toFixed(1)}%`);
    const profitableMonthsCount = monthlyResults.filter(r => r.performance.netProfit > 0).length;
    console.log(`   策略稳定性: ${profitableMonthsCount && monthlyResults.length > 0 ? (profitableMonthsCount/monthlyResults.length >= 0.7 ? '优秀' : profitableMonthsCount/monthlyResults.length >= 0.5 ? '良好' : '一般') : '待评估'}`);
    
    // 实施建议
    console.log('\n💡 2025年实施建议:');
    if (sortedResults[0] && sortedResults[0].score >= 70) {
      console.log('✅ V5-激进优化版在2025年牛市环境下表现优秀');
      console.log('🚀 建议立即进行实盘测试');
      console.log(`📊 预期年化收益: ${(sortedResults[0].performance.annualizedReturn * 100).toFixed(1)}%`);
      console.log(`🔄 预期交易频次: ${sortedResults[0].performance.tradesPerWeek.toFixed(1)}/周`);
    } else if (sortedResults[0] && sortedResults[0].score >= 50) {
      console.log('⚠️  V5-激进优化版在2025年表现一般');
      console.log('🔧 建议进一步优化参数以适应牛市环境');
      console.log('📊 可考虑小资金测试');
    } else {
      console.log('❌ V5-激进优化版在2025年表现不佳');
      console.log('💡 建议重新训练参数以适应2025年市场特征');
    }
    
    console.log('\n' + '='.repeat(120));
    console.log('🎯 2025年数据验证完成 - 策略在真实牛市环境下的表现已评估');
    console.log('='.repeat(120));
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

  private calculateIndicators(bars: KlineData[], params: V5Parameters): any {
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
    const defaultFilename = `2025-data-validation-${timestamp}.json`;
    const filepath = filename || defaultFilename;
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const fullPath = path.join(__dirname, '../../data/backtest-results', filepath);
    
    const sortedResults = this.testResults.sort((a, b) => b.score - a.score);
    
    const data = {
      timestamp: new Date().toISOString(),
      framework: "2025 Data Validation",
      strategy_version: "V5-激进优化版",
      data_period: "2025年1月-9月",
      v5_parameters: this.V5_PARAMETERS,
      total_tests: this.testResults.length,
      average_score: (sortedResults.reduce((sum, r) => sum + r.score, 0) / this.testResults.length).toFixed(2),
      best_result: sortedResults[0],
      all_results: sortedResults,
      data_summary: {
        total_bars: this.data2025.length,
        start_time: new Date(this.data2025[0].timestamp).toISOString(),
        end_time: new Date(this.data2025[this.data2025.length - 1].timestamp).toISOString()
      }
    };
    
    await fs.writeFile(fullPath, JSON.stringify(data, null, 2));
    return filepath;
  }
}

// 主函数
async function main() {
  try {
    console.log('🚀 启动2025年数据验证器');
    
    const validator = new Data2025Validator();
    
    // 加载2025年数据
    await validator.load2025Data();
    
    // 执行2025年验证
    await validator.run2025Validation();
    
    // 保存结果
    const filename = await validator.saveResults();
    console.log(`💾 2025年验证结果已保存: ${filename}`);
    
    console.log('\n🎉 2025年数据验证完成！');
    console.log('🎯 V5-激进优化版在2025年真实数据上的表现已全面评估！');
    
  } catch (error) {
    console.error('❌ 2025年数据验证失败:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { Data2025Validator };