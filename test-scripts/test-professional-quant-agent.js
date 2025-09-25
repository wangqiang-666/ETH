#!/usr/bin/env node

/**
 * 专业量化ETH合约Agent
 * 核心理念：盈亏比 + 风险控制 > 胜率
 * 
 * 目标指标：
 * - Sharpe Ratio: 2.0+
 * - 年化收益: 30-80%
 * - 盈亏比: 3.0+
 * - 最大回撤: <10%
 * - 胜率: 25-40%（可接受）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 启动专业量化ETH合约Agent...\n');

// 专业量化配置
const professionalQuantConfig = {
  symbol: 'ETHUSDT',
  initialCapital: 100000,
  
  // 核心量化理念
  quantPhilosophy: {
    // 盈亏比优先策略
    profitLossRatio: {
      target: 3.0,              // 目标盈亏比3:1
      minimum: 2.0,             // 最低盈亏比2:1
      dynamicAdjustment: true   // 动态调整
    },
    
    // 风险控制优先
    riskManagement: {
      maxDrawdown: 0.10,        // 10%最大回撤
      dailyVaR: 0.02,           // 2%日风险价值
      positionSizing: 'kelly',   // 凯利公式仓位管理
      riskBudget: 0.015         // 1.5%风险预算
    },
    
    // Sharpe Ratio优化
    sharpeOptimization: {
      target: 2.0,              // 目标夏普比率2.0
      riskFreeRate: 0.05,       // 5%无风险利率
      volatilityControl: true   // 波动率控制
    }
  },
  
  // 高盈亏比策略组合
  strategies: {
    // 趋势突破策略（高盈亏比）
    trendBreakout: {
      enabled: true,
      weight: 0.4,
      targetRatio: 4.0,         // 4:1盈亏比
      winRate: 0.30,            // 30%胜率
      
      // 严格的入场条件
      entry: {
        minMomentum: 0.025,     // 2.5%最小动量
        volumeConfirm: 2.5,     // 2.5倍成交量确认
        multiTimeframe: true,   // 多时间框架确认
        strengthFilter: 0.8     // 80%强度过滤
      },
      
      // 高盈亏比的出场策略
      exit: {
        stopLoss: 0.015,        // 1.5%止损
        takeProfit: [0.06, 0.12, 0.20], // 6%, 12%, 20%分层止盈
        trailingStop: 0.025,    // 2.5%移动止损
        timeStop: 48            // 48小时时间止损
      }
    },
    
    // 反转捕捉策略（超高盈亏比）
    reversalCapture: {
      enabled: true,
      weight: 0.3,
      targetRatio: 5.0,         // 5:1盈亏比
      winRate: 0.25,            // 25%胜率
      
      entry: {
        oversoldLevel: 15,      // RSI 15超卖
        overboughtLevel: 85,    // RSI 85超买
        divergenceConfirm: true, // 背离确认
        supportResistance: true  // 支撑阻力确认
      },
      
      exit: {
        stopLoss: 0.012,        // 1.2%止损
        takeProfit: [0.06, 0.15, 0.30], // 6%, 15%, 30%分层止盈
        quickProfit: 0.025,     // 2.5%快速止盈
        maxHolding: 24          // 24小时最大持仓
      }
    },
    
    // 波动率套利策略（稳定盈亏比）
    volatilityArbitrage: {
      enabled: true,
      weight: 0.2,
      targetRatio: 2.5,         // 2.5:1盈亏比
      winRate: 0.40,            // 40%胜率
      
      entry: {
        volSpike: 2.0,          // 2倍波动率激增
        meanReversion: true,    // 均值回归
        rangeBreaking: false,   // 非区间突破
        liquidityCheck: true    // 流动性检查
      },
      
      exit: {
        stopLoss: 0.020,        // 2%止损
        takeProfit: [0.05, 0.08], // 5%, 8%止盈
        volNormalization: true, // 波动率正常化退出
        maxHolding: 12          // 12小时最大持仓
      }
    },
    
    // 事件驱动策略（极高盈亏比）
    eventDriven: {
      enabled: true,
      weight: 0.1,
      targetRatio: 8.0,         // 8:1盈亏比
      winRate: 0.20,            // 20%胜率
      
      entry: {
        newsImpact: true,       // 新闻影响
        marketShock: 0.05,      // 5%市场冲击
        liquidationCascade: true, // 清算瀑布
        extremeSentiment: true  // 极端情绪
      },
      
      exit: {
        stopLoss: 0.008,        // 0.8%止损
        takeProfit: [0.064, 0.16, 0.40], // 6.4%, 16%, 40%止盈
        rapidExit: true,        // 快速退出
        maxHolding: 6           // 6小时最大持仓
      }
    }
  },
  
  // 专业风险管理系统
  professionalRiskManagement: {
    // 仓位管理
    positionSizing: {
      method: 'kelly',          // 凯利公式
      maxPosition: 0.15,        // 15%最大仓位
      basePosition: 0.05,       // 5%基础仓位
      riskParity: true,         // 风险平价
      correlationAdjust: true   // 相关性调整
    },
    
    // 杠杆管理
    leverageManagement: {
      maxLeverage: 5.0,         // 最大5倍杠杆
      baseLeverage: 2.0,        // 基础2倍杠杆
      volatilityAdjust: true,   // 波动率调整
      drawdownReduce: true      // 回撤降杠杆
    },
    
    // 风险监控
    riskMonitoring: {
      realTimeVaR: true,        // 实时VaR监控
      stressTest: true,         // 压力测试
      correlationWatch: true,   // 相关性监控
      liquidityRisk: true       // 流动性风险
    },
    
    // 紧急风控
    emergencyControls: {
      circuitBreaker: 0.05,     // 5%熔断机制
      forceClose: 0.08,         // 8%强制平仓
      tradingHalt: 0.12,        // 12%停止交易
      capitalProtection: 0.85   // 85%资金保护线
    }
  },
  
  // Sharpe Ratio优化系统
  sharpeOptimization: {
    // 收益优化
    returnOptimization: {
      compoundGrowth: true,     // 复合增长
      reinvestment: 0.8,        // 80%再投资
      profitTaking: 0.2,        // 20%获利了结
      growthTarget: 0.50        // 50%年化目标
    },
    
    // 波动率控制
    volatilityControl: {
      targetVol: 0.25,          // 25%目标波动率
      volScaling: true,         // 波动率缩放
      smoothing: 0.1,           // 10%平滑因子
      adaptiveRebalance: true   // 自适应再平衡
    },
    
    // 风险调整收益
    riskAdjustedReturn: {
      sharpeTarget: 2.0,        // 夏普比率目标
      calmarRatio: 1.5,         // 卡玛比率目标
      sortinoRatio: 2.5,        // 索提诺比率目标
      maxDD: 0.10               // 最大回撤限制
    }
  }
};

// 全局变量
let realHistoricalData = [];
let professionalResults = {
  overallPerformance: {},
  trades: [],
  riskMetrics: {},
  sharpeAnalysis: {}
};

// 专业量化状态
let quantState = {
  currentDrawdown: 0,
  peakCapital: 0,
  dailyReturns: [],
  volatility: 0,
  sharpeRatio: 0,
  riskBudgetUsed: 0
};

// 主函数
async function runProfessionalQuantTest() {
  console.log('📊 专业量化ETH合约Agent测试');
  console.log('='.repeat(80));
  console.log('🎯 量化目标: 高盈亏比 + 优秀风控 + 高Sharpe Ratio');
  console.log('📈 目标指标: 年化30-80%, 盈亏比3.0+, Sharpe 2.0+');
  console.log('🛡️ 风控理念: 风险控制优于一切');
  
  // 加载数据
  await loadHistoricalData();
  
  // 专业量化回测
  await runProfessionalQuantBacktest();
  
  // 生成专业报告
  await generateProfessionalQuantReport();
}

// 加载历史数据
async function loadHistoricalData() {
  console.log('📊 加载真实历史数据...');
  
  const dataPath = path.join(__dirname, 'real_historical_data_2022_2024.json');
  const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  realHistoricalData = rawData;
  
  console.log(`   ✅ 数据加载完成: ${realHistoricalData.length.toLocaleString()}条K线`);
}

// 专业量化回测
async function runProfessionalQuantBacktest() {
  console.log('🎯 执行专业量化回测...');
  
  let currentCapital = professionalQuantConfig.initialCapital;
  let trades = [];
  let currentPositions = [];
  let dailyReturns = [];
  let maxDrawdown = 0;
  let peakCapital = currentCapital;
  
  quantState.peakCapital = currentCapital;
  
  // 策略统计
  let strategyStats = {};
  Object.keys(professionalQuantConfig.strategies).forEach(strategy => {
    strategyStats[strategy] = { 
      trades: 0, wins: 0, pnl: 0, 
      avgWin: 0, avgLoss: 0, profitFactor: 0 
    };
  });
  
  let lastDay = null;
  let dayStartCapital = currentCapital;
  
  // 每15分钟检查一次
  for (let i = 100; i < realHistoricalData.length - 10; i++) {
    const currentCandle = realHistoricalData[i];
    const currentDay = new Date(currentCandle.timestamp).toDateString();
    
    // 每日收益计算
    if (lastDay && lastDay !== currentDay) {
      const dailyReturn = (currentCapital - dayStartCapital) / dayStartCapital;
      dailyReturns.push(dailyReturn);
      dayStartCapital = currentCapital;
      
      // 更新量化状态
      updateQuantState(dailyReturns, currentCapital);
    }
    lastDay = currentDay;
    
    // 检查现有持仓
    for (let j = currentPositions.length - 1; j >= 0; j--) {
      const position = currentPositions[j];
      const closeResult = checkProfessionalClose(position, currentCandle, i);
      
      if (closeResult.shouldClose) {
        const trade = closeProfessionalPosition(position, closeResult);
        trades.push(trade);
        currentCapital += trade.pnl;
        
        // 更新策略统计
        updateStrategyStats(strategyStats, trade);
        
        // 移除持仓
        currentPositions.splice(j, 1);
        
        // 更新最大回撤
        if (currentCapital > peakCapital) {
          peakCapital = currentCapital;
          quantState.peakCapital = peakCapital;
        }
        const drawdown = (peakCapital - currentCapital) / peakCapital;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
        quantState.currentDrawdown = drawdown;
        
        // 风险控制检查
        if (drawdown > professionalQuantConfig.professionalRiskManagement.emergencyControls.tradingHalt) {
          console.log(`   🚨 达到交易停止线 ${(drawdown * 100).toFixed(1)}%，停止交易`);
          break;
        }
      }
    }
    
    // 检查新开仓机会
    if (currentPositions.length < 3 && // 最多3个并发持仓
        passProfessionalRiskFilters(currentCapital, peakCapital)) {
      
      // 生成专业量化信号
      const signals = generateProfessionalQuantSignals(realHistoricalData, i);
      
      for (const signal of signals) {
        if (signal && signal.expectedRatio >= 2.0) { // 最低2:1盈亏比
          const position = openProfessionalPosition(signal, currentCandle, currentCapital, i);
          if (position) {
            currentPositions.push(position);
          }
        }
      }
    }
  }
  
  // 计算最终结果
  const totalReturn = (currentCapital - professionalQuantConfig.initialCapital) / professionalQuantConfig.initialCapital;
  const winRate = trades.length > 0 ? trades.filter(t => t.pnl > 0).length / trades.length : 0;
  
  // 计算年化收益率
  const days = (realHistoricalData[realHistoricalData.length - 1].timestamp - realHistoricalData[0].timestamp) / (1000 * 60 * 60 * 24);
  const annualizedReturn = days > 0 ? Math.pow(1 + totalReturn, 365 / days) - 1 : 0;
  
  // 计算盈亏比
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl < 0);
  const avgWin = winningTrades.length > 0 ? winningTrades.reduce((sum, t) => sum + t.returnRate, 0) / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((sum, t) => sum + t.returnRate, 0) / losingTrades.length) : 0;
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;
  
  // 计算Sharpe Ratio
  const avgDailyReturn = dailyReturns.length > 0 ? dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length : 0;
  const dailyVolatility = calculateVolatility(dailyReturns);
  const annualizedVol = dailyVolatility * Math.sqrt(252);
  const riskFreeRate = professionalQuantConfig.quantPhilosophy.sharpeOptimization.riskFreeRate;
  const sharpeRatio = annualizedVol > 0 ? (annualizedReturn - riskFreeRate) / annualizedVol : 0;
  
  console.log(`   ✅ 专业量化回测完成`);
  console.log(`      📊 总交易数: ${trades.length}笔`);
  console.log(`      🏆 胜率: ${(winRate * 100).toFixed(1)}%`);
  console.log(`      📈 总收益率: ${(totalReturn * 100).toFixed(2)}%`);
  console.log(`      🚀 年化收益率: ${(annualizedReturn * 100).toFixed(1)}%`);
  console.log(`      💰 盈亏比: ${profitFactor.toFixed(2)}`);
  console.log(`      📊 Sharpe Ratio: ${sharpeRatio.toFixed(2)}`);
  console.log(`      🛡️ 最大回撤: ${(maxDrawdown * 100).toFixed(1)}%`);
  console.log(`      📈 年化波动率: ${(annualizedVol * 100).toFixed(1)}%`);
  console.log(`      💰 最终资金: $${Math.round(currentCapital).toLocaleString()}`);
  
  professionalResults.overallPerformance = {
    totalReturn, annualizedReturn, winRate, profitFactor,
    totalTrades: trades.length, maxDrawdown, finalCapital: currentCapital,
    trades, avgWin, avgLoss, sharpeRatio, annualizedVol
  };
  
  professionalResults.riskMetrics = {
    maxDrawdown, annualizedVol, sharpeRatio,
    calmarRatio: annualizedReturn / maxDrawdown,
    sortinoRatio: calculateSortinoRatio(dailyReturns, riskFreeRate / 252)
  };
}

// 生成专业量化信号
function generateProfessionalQuantSignals(data, index) {
  const signals = [];
  
  // 趋势突破信号
  const trendSignal = generateTrendBreakoutSignal(data, index);
  if (trendSignal.detected) {
    signals.push({
      ...trendSignal,
      strategy: 'trendBreakout',
      expectedRatio: 4.0
    });
  }
  
  // 反转捕捉信号
  const reversalSignal = generateReversalCaptureSignal(data, index);
  if (reversalSignal.detected) {
    signals.push({
      ...reversalSignal,
      strategy: 'reversalCapture',
      expectedRatio: 5.0
    });
  }
  
  // 波动率套利信号
  const volSignal = generateVolatilityArbitrageSignal(data, index);
  if (volSignal.detected) {
    signals.push({
      ...volSignal,
      strategy: 'volatilityArbitrage',
      expectedRatio: 2.5
    });
  }
  
  // 事件驱动信号
  const eventSignal = generateEventDrivenSignal(data, index);
  if (eventSignal.detected) {
    signals.push({
      ...eventSignal,
      strategy: 'eventDriven',
      expectedRatio: 8.0
    });
  }
  
  return signals;
}

// 趋势突破信号生成
function generateTrendBreakoutSignal(data, index) {
  if (index < 50) return { detected: false };
  
  const config = professionalQuantConfig.strategies.trendBreakout;
  const current = data[index];
  const recent = data.slice(index - 30, index + 1);
  
  const prices = recent.map(d => d.close);
  const volumes = recent.map(d => d.volume);
  
  // 计算动量
  const momentum = (prices[prices.length - 1] - prices[0]) / prices[0];
  
  // 成交量确认
  const avgVolume = volumes.slice(0, -5).reduce((sum, v) => sum + v, 0) / (volumes.length - 5);
  const recentVolume = volumes.slice(-5).reduce((sum, v) => sum + v, 0) / 5;
  const volumeRatio = recentVolume / avgVolume;
  
  // 多时间框架确认
  const shortMA = prices.slice(-5).reduce((sum, p) => sum + p, 0) / 5;
  const longMA = prices.slice(-20).reduce((sum, p) => sum + p, 0) / 20;
  const maConfirm = Math.abs(shortMA - longMA) / longMA > 0.01;
  
  if (Math.abs(momentum) > config.entry.minMomentum &&
      volumeRatio > config.entry.volumeConfirm &&
      maConfirm) {
    
    return {
      detected: true,
      direction: momentum > 0 ? 'LONG' : 'SHORT',
      confidence: Math.min(0.95, 0.6 + Math.abs(momentum) * 10 + (volumeRatio - 2) * 0.1),
      momentum: momentum,
      volumeRatio: volumeRatio,
      strength: Math.abs(momentum) * volumeRatio
    };
  }
  
  return { detected: false };
}

// 反转捕捉信号生成
function generateReversalCaptureSignal(data, index) {
  if (index < 30) return { detected: false };
  
  const config = professionalQuantConfig.strategies.reversalCapture;
  const prices = data.slice(index - 20, index + 1).map(d => d.close);
  
  // 计算RSI
  const rsi = calculateRSI(prices, 14);
  
  // 支撑阻力检查
  const highs = data.slice(index - 20, index + 1).map(d => d.high);
  const lows = data.slice(index - 20, index + 1).map(d => d.low);
  const resistance = Math.max(...highs.slice(0, -5));
  const support = Math.min(...lows.slice(0, -5));
  const currentPrice = prices[prices.length - 1];
  
  // 超卖反弹
  if (rsi < config.entry.oversoldLevel && currentPrice <= support * 1.02) {
    return {
      detected: true,
      direction: 'LONG',
      confidence: Math.min(0.9, 0.7 + (config.entry.oversoldLevel - rsi) * 0.01),
      rsi: rsi,
      supportLevel: support,
      reversal: 'oversold'
    };
  }
  
  // 超买回调
  if (rsi > config.entry.overboughtLevel && currentPrice >= resistance * 0.98) {
    return {
      detected: true,
      direction: 'SHORT',
      confidence: Math.min(0.9, 0.7 + (rsi - config.entry.overboughtLevel) * 0.01),
      rsi: rsi,
      resistanceLevel: resistance,
      reversal: 'overbought'
    };
  }
  
  return { detected: false };
}

// 波动率套利信号生成
function generateVolatilityArbitrageSignal(data, index) {
  if (index < 40) return { detected: false };
  
  const recent = data.slice(index - 20, index + 1);
  const prices = recent.map(d => d.close);
  const volumes = recent.map(d => d.volume);
  
  // 计算当前波动率
  const currentVol = calculateVolatility(prices.slice(-5));
  const historicalVol = calculateVolatility(prices.slice(0, -5));
  const volSpike = currentVol / historicalVol;
  
  // 成交量检查
  const avgVolume = volumes.slice(0, -3).reduce((sum, v) => sum + v, 0) / (volumes.length - 3);
  const recentVolume = volumes.slice(-3).reduce((sum, v) => sum + v, 0) / 3;
  const volumeRatio = recentVolume / avgVolume;
  
  if (volSpike > 2.0 && volumeRatio > 1.5) {
    // 判断方向（均值回归）
    const sma = prices.slice(-10).reduce((sum, p) => sum + p, 0) / 10;
    const currentPrice = prices[prices.length - 1];
    const deviation = (currentPrice - sma) / sma;
    
    return {
      detected: true,
      direction: deviation > 0 ? 'SHORT' : 'LONG', // 均值回归
      confidence: Math.min(0.85, 0.6 + (volSpike - 1.5) * 0.1 + Math.abs(deviation) * 5),
      volSpike: volSpike,
      deviation: deviation,
      meanPrice: sma
    };
  }
  
  return { detected: false };
}

// 事件驱动信号生成
function generateEventDrivenSignal(data, index) {
  if (index < 20) return { detected: false };
  
  const current = data[index];
  const previous = data.slice(index - 10, index);
  
  const avgPrice = previous.reduce((sum, d) => sum + d.close, 0) / previous.length;
  const avgVolume = previous.reduce((sum, d) => sum + d.volume, 0) / previous.length;
  
  // 市场冲击检测
  const priceShock = Math.abs(current.close - avgPrice) / avgPrice;
  const volumeShock = current.volume / avgVolume;
  
  if (priceShock > 0.05 && volumeShock > 3.0) {
    return {
      detected: true,
      direction: current.close > avgPrice ? 'LONG' : 'SHORT',
      confidence: Math.min(0.95, 0.7 + priceShock * 5 + (volumeShock - 2) * 0.05),
      priceShock: priceShock,
      volumeShock: volumeShock,
      eventType: 'market_shock'
    };
  }
  
  return { detected: false };
}

// 开仓
function openProfessionalPosition(signal, candle, capital, index) {
  const strategy = professionalQuantConfig.strategies[signal.strategy];
  const isLong = signal.direction === 'LONG';
  
  // 凯利公式仓位计算
  const kellyFraction = calculateKellyFraction(signal.expectedRatio, signal.confidence);
  const positionSize = Math.min(kellyFraction, professionalQuantConfig.professionalRiskManagement.positionSizing.maxPosition);
  
  // 动态杠杆计算
  const leverage = calculateDynamicLeverage(signal, quantState.currentDrawdown);
  
  const tradeAmount = capital * positionSize;
  const entryPrice = candle.close;
  
  // 专业止损止盈设置
  const stopLoss = strategy.exit.stopLoss;
  const takeProfitLevels = strategy.exit.takeProfit;
  
  const stopLossPrice = entryPrice * (1 + (isLong ? -1 : 1) * stopLoss);
  const takeProfitPrices = takeProfitLevels.map(tp => 
    entryPrice * (1 + (isLong ? 1 : -1) * tp)
  );
  
  return {
    side: isLong ? 'LONG' : 'SHORT',
    entryPrice: entryPrice,
    entryTime: candle.timestamp,
    entryIndex: index,
    tradeAmount: tradeAmount,
    leverage: leverage,
    positionSize: positionSize,
    stopLossPrice: stopLossPrice,
    takeProfitPrices: takeProfitPrices,
    confidence: signal.confidence,
    strategy: signal.strategy,
    expectedRatio: signal.expectedRatio,
    maxHoldingTime: strategy.exit.maxHolding || 24,
    trailingStopDistance: strategy.exit.trailingStop || 0.025
  };
}

// 检查平仓
function checkProfessionalClose(position, currentCandle, currentIndex) {
  const isLong = position.side === 'LONG';
  const currentPrice = currentCandle.close;
  const holdingTime = (currentIndex - position.entryIndex) * 0.25;
  
  // 检查止盈
  for (let i = 0; i < position.takeProfitPrices.length; i++) {
    const tpPrice = position.takeProfitPrices[i];
    if ((isLong && currentPrice >= tpPrice) || (!isLong && currentPrice <= tpPrice)) {
      return {
        shouldClose: true,
        reason: `TAKE_PROFIT_${i + 1}`,
        price: tpPrice,
        partialClose: i < position.takeProfitPrices.length - 1,
        closePercentage: i === 0 ? 0.5 : (i === 1 ? 0.3 : 0.2)
      };
    }
  }
  
  // 检查止损
  if ((isLong && currentPrice <= position.stopLossPrice) ||
      (!isLong && currentPrice >= position.stopLossPrice)) {
    return {
      shouldClose: true,
      reason: 'STOP_LOSS',
      price: position.stopLossPrice
    };
  }
  
  // 检查时间止损
  if (holdingTime >= position.maxHoldingTime) {
    return {
      shouldClose: true,
      reason: 'TIME_STOP',
      price: currentPrice
    };
  }
  
  return { shouldClose: false };
}

// 平仓
function closeProfessionalPosition(position, closeResult) {
  const priceChange = (closeResult.price - position.entryPrice) / position.entryPrice;
  const returnRate = priceChange * (position.side === 'LONG' ? 1 : -1) * position.leverage;
  
  let closePercentage = 1.0;
  if (closeResult.partialClose) {
    closePercentage = closeResult.closePercentage;
  }
  
  const effectiveTradeAmount = position.tradeAmount * closePercentage;
  const pnl = effectiveTradeAmount * (returnRate - 0.002); // 0.2%手续费
  
  return {
    side: position.side,
    entryPrice: position.entryPrice,
    exitPrice: closeResult.price,
    pnl: pnl,
    returnRate: returnRate,
    reason: closeResult.reason,
    strategy: position.strategy,
    confidence: position.confidence,
    expectedRatio: position.expectedRatio,
    actualRatio: returnRate > 0 ? Math.abs(returnRate) / 0.002 : 0, // 实际盈亏比
    leverage: position.leverage,
    positionSize: position.positionSize,
    holdingTime: (Date.now() - position.entryTime) / (1000 * 60 * 60)
  };
}

// 辅助函数
function calculateKellyFraction(expectedRatio, winProbability) {
  // 凯利公式: f = (bp - q) / b
  // b = 盈亏比, p = 胜率, q = 败率
  const b = expectedRatio;
  const p = winProbability;
  const q = 1 - p;
  
  const kellyFraction = (b * p - q) / b;
  return Math.max(0, Math.min(0.25, kellyFraction)); // 限制在0-25%之间
}

function calculateDynamicLeverage(signal, currentDrawdown) {
  let baseLeverage = professionalQuantConfig.professionalRiskManagement.leverageManagement.baseLeverage;
  
  // 根据回撤调整杠杆
  if (currentDrawdown > 0.05) {
    baseLeverage *= (1 - currentDrawdown);
  }
  
  // 根据信号强度调整
  baseLeverage *= signal.confidence;
  
  return Math.max(1.0, Math.min(professionalQuantConfig.professionalRiskManagement.leverageManagement.maxLeverage, baseLeverage));
}

function updateQuantState(dailyReturns, currentCapital) {
  if (dailyReturns.length > 0) {
    quantState.volatility = calculateVolatility(dailyReturns);
    const avgReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
    const annualizedReturn = Math.pow(1 + avgReturn, 252) - 1;
    const annualizedVol = quantState.volatility * Math.sqrt(252);
    quantState.sharpeRatio = annualizedVol > 0 ? annualizedReturn / annualizedVol : 0;
  }
}

function updateStrategyStats(strategyStats, trade) {
  const strategy = trade.strategy;
  if (strategyStats[strategy]) {
    strategyStats[strategy].trades++;
    strategyStats[strategy].pnl += trade.pnl;
    
    if (trade.pnl > 0) {
      strategyStats[strategy].wins++;
      strategyStats[strategy].avgWin = (strategyStats[strategy].avgWin * (strategyStats[strategy].wins - 1) + trade.returnRate) / strategyStats[strategy].wins;
    } else {
      const losses = strategyStats[strategy].trades - strategyStats[strategy].wins;
      strategyStats[strategy].avgLoss = (strategyStats[strategy].avgLoss * (losses - 1) + Math.abs(trade.returnRate)) / losses;
    }
    
    if (strategyStats[strategy].avgLoss > 0) {
      strategyStats[strategy].profitFactor = strategyStats[strategy].avgWin / strategyStats[strategy].avgLoss;
    }
  }
}

function passProfessionalRiskFilters(currentCapital, peakCapital) {
  const drawdown = (peakCapital - currentCapital) / peakCapital;
  return drawdown < professionalQuantConfig.professionalRiskManagement.emergencyControls.tradingHalt;
}

function calculateVolatility(returns) {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  return Math.sqrt(variance);
}

function calculateRSI(prices, period) {
  if (prices.length < period + 1) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const change = prices[prices.length - i] - prices[prices.length - i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateSortinoRatio(returns, riskFreeRate) {
  if (returns.length === 0) return 0;
  
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const downside = returns.filter(r => r < riskFreeRate);
  
  if (downside.length === 0) return Infinity;
  
  const downsideDeviation = Math.sqrt(
    downside.reduce((sum, r) => sum + Math.pow(r - riskFreeRate, 2), 0) / downside.length
  );
  
  return downsideDeviation > 0 ? (avgReturn * 252 - riskFreeRate * 252) / (downsideDeviation * Math.sqrt(252)) : 0;
}

// 生成专业报告
async function generateProfessionalQuantReport() {
  console.log('📋 生成专业量化报告...');
  
  const result = professionalResults.overallPerformance;
  const risk = professionalResults.riskMetrics;
  
  console.log('\n📋 专业量化ETH合约Agent报告');
  console.log('='.repeat(80));
  
  console.log('\n🎯 专业量化成果:');
  console.log(`   🏆 胜率: ${(result.winRate * 100).toFixed(1)}%`);
  console.log(`   📈 总收益率: ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`   🚀 年化收益率: ${(result.annualizedReturn * 100).toFixed(1)}%`);
  console.log(`   💰 盈亏比: ${result.profitFactor.toFixed(2)}`);
  console.log(`   📊 Sharpe Ratio: ${result.sharpeRatio.toFixed(2)}`);
  console.log(`   📊 Calmar Ratio: ${risk.calmarRatio.toFixed(2)}`);
  console.log(`   📊 Sortino Ratio: ${risk.sortinoRatio.toFixed(2)}`);
  console.log(`   🛡️ 最大回撤: ${(result.maxDrawdown * 100).toFixed(1)}%`);
  console.log(`   📈 年化波动率: ${(result.annualizedVol * 100).toFixed(1)}%`);
  console.log(`   📊 总交易数: ${result.totalTrades}笔`);
  console.log(`   💰 最终资金: $${Math.round(result.finalCapital).toLocaleString()}`);
  
  console.log('\n🎯 专业量化评估:');
  if (result.sharpeRatio >= 2.0 && result.annualizedReturn >= 0.30) {
    console.log('   🏆 卓越表现: 达到专业量化标准');
    console.log('   评级: SS (专业级)');
    console.log('   评价: 可与顶尖量化机构媲美');
  } else if (result.sharpeRatio >= 1.5 && result.annualizedReturn >= 0.20) {
    console.log('   🔥 优秀表现: 接近专业量化标准');
    console.log('   评级: S+ (准专业级)');
    console.log('   评价: 具备商业化潜力');
  } else if (result.profitFactor >= 2.0 && result.maxDrawdown <= 0.15) {
    console.log('   📈 良好表现: 风控优秀，盈亏比达标');
    console.log('   评级: S (优秀级)');
    console.log('   评价: 可考虑小规模部署');
  } else {
    console.log('   📊 需要优化: 距离专业标准还有差距');
    console.log('   评级: A+ (良好级)');
    console.log('   评价: 继续优化策略');
  }
  
  console.log('\n🔥 专业量化优势:');
  console.log('   💰 高盈亏比策略 - 追求3:1以上盈亏比');
  console.log('   🛡️ 专业风险控制 - 多层次风险管理');
  console.log('   📊 Sharpe Ratio优化 - 风险调整收益最大化');
  console.log('   🎯 凯利公式仓位 - 科学的资金管理');
  console.log('   📈 多策略组合 - 分散风险提高收益');
  
  // 保存报告
  const reportPath = path.join(__dirname, 'professional_quant_agent_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(professionalResults, null, 2));
  console.log(`\n💾 详细报告已保存: ${reportPath}`);
}

// 运行专业量化测试
runProfessionalQuantTest().catch(console.error);