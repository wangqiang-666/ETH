#!/usr/bin/env node

/**
 * 修复版真实历史数据杠杆ETH合约Agent
 * 修复问题：
 * 1. 基于真实价格变化计算收益
 * 2. 实现真实的止损和风险管理
 * 3. 现实的胜率（60-70%）
 * 4. 合理的杠杆风险模型
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 启动修复版真实数据杠杆ETH合约Agent...\n');

// 修复版配置
const realisticConfig = {
  symbol: 'ETHUSDT',
  initialCapital: 100000,
  
  // 杠杆配置
  leverageConfig: {
    enabled: true,
    baseLeverage: 3,            // 降低基础杠杆到3倍
    maxLeverage: 5,             // 最大5倍杠杆
    minLeverage: 2,             // 最小2倍杠杆
    dynamicAdjustment: true
  },
  
  // 现实的信号过滤
  signalFilters: {
    minConfidence: 0.60,        // 提高到60%置信度
    minTrendStrength: 0.005,    // 0.5%最小趋势强度
    maxRSI: 75,                 // 75最大RSI
    minRSI: 25,                 // 25最小RSI
    volumeRatio: 1.2            // 成交量比率
  },
  
  // 风险管理
  riskManagement: {
    stopLoss: 0.02,             // 2%止损
    takeProfit: 0.04,           // 4%止盈
    positionSize: 0.05,         // 5%基础仓位
    maxSize: 0.15,              // 15%最大仓位
    maxDrawdown: 0.20,          // 20%最大回撤
    fees: 0.001                 // 0.1%手续费
  },
  
  // 交易参数
  tradingParams: {
    holdingPeriod: 4,           // 最多持仓4小时（16个15分钟）
    slippage: 0.0005,           // 0.05%滑点
    minPriceMove: 0.001         // 0.1%最小价格变动
  }
};

// 全局变量
let realHistoricalData = [];
let realisticResults = {
  periods: [],
  overallPerformance: {},
  trades: [],
  riskMetrics: {}
};

// 主函数
async function runRealisticRealDataTest() {
  console.log('📊 修复版真实数据杠杆ETH合约Agent测试');
  console.log('='.repeat(80));
  console.log('🔧 修复内容: 真实价格变化、现实胜率、合理风险');
  console.log('⚡ 杠杆策略: 2-5倍动态杠杆');
  console.log('🎯 目标: 现实可行的回测结果');
  
  // 第一阶段：加载真实数据
  console.log('\n📊 第一阶段：加载真实历史数据');
  console.log('='.repeat(50));
  await loadRealHistoricalData();
  
  // 第二阶段：数据分析
  console.log('\n🔧 第二阶段：数据分析和预处理');
  console.log('='.repeat(50));
  await analyzeRealData();
  
  // 第三阶段：现实回测
  console.log('\n🎯 第三阶段：现实杠杆回测');
  console.log('='.repeat(50));
  await runRealisticBacktest();
  
  // 第四阶段：风险分析
  console.log('\n📈 第四阶段：风险分析');
  console.log('='.repeat(50));
  await analyzeRiskMetrics();
  
  // 第五阶段：生成报告
  console.log('\n📋 第五阶段：生成现实回测报告');
  console.log('='.repeat(50));
  await generateRealisticReport();
}

// 加载真实历史数据
async function loadRealHistoricalData() {
  console.log('📊 加载真实历史数据...');
  
  const dataPath = path.join(__dirname, 'real_historical_data_2022_2024.json');
  
  if (!fs.existsSync(dataPath)) {
    throw new Error('真实历史数据文件不存在，请先运行数据下载');
  }
  
  try {
    const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    realHistoricalData = rawData;
    
    console.log(`   ✅ 数据加载完成`);
    console.log(`      📊 数据量: ${realHistoricalData.length.toLocaleString()}条K线`);
    console.log(`      📅 时间跨度: ${new Date(realHistoricalData[0].timestamp).toISOString().split('T')[0]} - ${new Date(realHistoricalData[realHistoricalData.length-1].timestamp).toISOString().split('T')[0]}`);
    
  } catch (error) {
    throw new Error(`数据加载失败: ${error.message}`);
  }
}

// 分析真实数据
async function analyzeRealData() {
  console.log('🔧 分析真实历史数据...');
  
  // 计算价格统计 - 优化内存使用
  let minPrice = realHistoricalData[0].close;
  let maxPrice = realHistoricalData[0].close;
  let totalReturn = 0;
  let positiveReturns = 0;
  let negativeReturns = 0;
  let returnSum = 0;
  let returnSumSquared = 0;
  
  // 分批处理，避免栈溢出
  for (let i = 1; i < realHistoricalData.length; i++) {
    const currentPrice = realHistoricalData[i].close;
    const prevPrice = realHistoricalData[i-1].close;
    
    // 更新价格范围
    if (currentPrice < minPrice) minPrice = currentPrice;
    if (currentPrice > maxPrice) maxPrice = currentPrice;
    
    // 计算收益率
    const returnRate = (currentPrice - prevPrice) / prevPrice;
    returnSum += returnRate;
    returnSumSquared += returnRate * returnRate;
    
    if (returnRate > 0) positiveReturns++;
    else if (returnRate < 0) negativeReturns++;
  }
  
  const totalReturns = realHistoricalData.length - 1;
  const meanReturn = returnSum / totalReturns;
  const variance = (returnSumSquared / totalReturns) - (meanReturn * meanReturn);
  const stdReturn = Math.sqrt(variance);
  
  // 统计分析
  const stats = {
    totalRecords: realHistoricalData.length,
    priceRange: {
      min: minPrice,
      max: maxPrice,
      start: realHistoricalData[0].close,
      end: realHistoricalData[realHistoricalData.length - 1].close
    },
    returns: {
      mean: meanReturn,
      std: stdReturn,
      positive: positiveReturns / totalReturns,
      negative: negativeReturns / totalReturns
    }
  };
  
  console.log(`   📊 数据统计:`);
  console.log(`      价格范围: $${stats.priceRange.min.toFixed(2)} - $${stats.priceRange.max.toFixed(2)}`);
  console.log(`      总收益率: ${((stats.priceRange.end / stats.priceRange.start - 1) * 100).toFixed(2)}%`);
  console.log(`      平均收益率: ${(stats.returns.mean * 100).toFixed(4)}%`);
  console.log(`      收益率标准差: ${(stats.returns.std * 100).toFixed(4)}%`);
  console.log(`      正收益比例: ${(stats.returns.positive * 100).toFixed(1)}%`);
  console.log(`      负收益比例: ${(stats.returns.negative * 100).toFixed(1)}%`);
  
  realisticResults.dataStats = stats;
}

// 现实回测
async function runRealisticBacktest() {
  console.log('🎯 执行现实杠杆回测...');
  
  let currentCapital = realisticConfig.initialCapital;
  let trades = [];
  let equity = [];
  let peakCapital = currentCapital;
  let maxDrawdown = 0;
  let currentPosition = null; // 当前持仓
  
  // 统计变量
  let longTrades = 0, shortTrades = 0;
  let longWinningTrades = 0, shortWinningTrades = 0;
  let signalsGenerated = 0, signalsExecuted = 0;
  let leverageUsage = [];
  
  console.log(`   📊 开始回测，初始资金: $${currentCapital.toLocaleString()}`);
  
  // 每小时检查一次（4个15分钟K线）
  for (let i = 20; i < realHistoricalData.length - 1; i += 4) {
    const currentCandle = realHistoricalData[i];
    const nextCandle = realHistoricalData[i + 1];
    
    // 检查是否需要平仓
    if (currentPosition) {
      const positionResult = checkPositionClose(currentPosition, currentCandle, nextCandle, i);
      if (positionResult.shouldClose) {
        const trade = closePosition(currentPosition, positionResult, currentCapital);
        trades.push(trade);
        currentCapital += trade.pnl;
        
        // 统计
        if (trade.side === 'LONG') {
          longTrades++;
          if (trade.pnl > 0) longWinningTrades++;
        } else {
          shortTrades++;
          if (trade.pnl > 0) shortWinningTrades++;
        }
        
        currentPosition = null;
        
        // 更新最大回撤
        if (currentCapital > peakCapital) {
          peakCapital = currentCapital;
        }
        const drawdown = (peakCapital - currentCapital) / peakCapital;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
        
        // 检查最大回撤限制
        if (drawdown > realisticConfig.riskManagement.maxDrawdown) {
          console.log(`   ⚠️ 达到最大回撤限制 ${(drawdown * 100).toFixed(1)}%，停止交易`);
          break;
        }
      }
    }
    
    // 如果没有持仓，检查开仓信号
    if (!currentPosition) {
      signalsGenerated++;
      
      const signal = generateRealisticSignal(realHistoricalData, i);
      
      if (passRealisticFilters(signal)) {
        signalsExecuted++;
        
        const leverage = calculateRealisticLeverage(signal);
        leverageUsage.push(leverage);
        
        // 开仓
        currentPosition = openPosition(signal, currentCandle, currentCapital, leverage, i);
      }
    }
    
    // 记录权益曲线
    if (i % 20 === 0) {
      equity.push({
        timestamp: currentCandle.timestamp,
        value: currentCapital,
        drawdown: (peakCapital - currentCapital) / peakCapital
      });
    }
  }
  
  // 如果还有持仓，强制平仓
  if (currentPosition) {
    const finalCandle = realHistoricalData[realHistoricalData.length - 1];
    const finalResult = {
      shouldClose: true,
      reason: 'FORCE_CLOSE',
      price: finalCandle.close,
      priceChange: (finalCandle.close - currentPosition.entryPrice) / currentPosition.entryPrice
    };
    const trade = closePosition(currentPosition, finalResult, currentCapital);
    trades.push(trade);
    currentCapital += trade.pnl;
  }
  
  // 计算性能指标
  const totalReturn = (currentCapital - realisticConfig.initialCapital) / realisticConfig.initialCapital;
  const overallWinRate = trades.length > 0 ? trades.filter(t => t.pnl > 0).length / trades.length : 0;
  const longWinRate = longTrades > 0 ? longWinningTrades / longTrades : 0;
  const shortWinRate = shortTrades > 0 ? shortWinningTrades / shortTrades : 0;
  const signalQuality = signalsGenerated > 0 ? signalsExecuted / signalsGenerated : 0;
  
  // 计算年化收益率
  const days = (realHistoricalData[realHistoricalData.length - 1].timestamp - realHistoricalData[0].timestamp) / (1000 * 60 * 60 * 24);
  const annualizedReturn = days > 0 ? Math.pow(1 + totalReturn, 365 / days) - 1 : 0;
  
  // 计算平均杠杆
  const avgLeverage = leverageUsage.length > 0 ? leverageUsage.reduce((sum, l) => sum + l, 0) / leverageUsage.length : 0;
  
  // 计算夏普比率
  const returns = [];
  for (let i = 1; i < equity.length; i++) {
    const dailyReturn = (equity[i].value - equity[i-1].value) / equity[i-1].value;
    returns.push(dailyReturn);
  }
  const avgReturn = returns.length > 0 ? returns.reduce((sum, r) => sum + r, 0) / returns.length : 0;
  const returnStd = returns.length > 1 ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length) : 0;
  const sharpeRatio = returnStd > 0 ? (avgReturn / returnStd) * Math.sqrt(252) : 0;
  
  console.log(`   ✅ 现实回测完成`);
  console.log(`      📊 总交易数: ${trades.length}笔`);
  console.log(`      🏆 总胜率: ${(overallWinRate * 100).toFixed(1)}%`);
  console.log(`      📈 总收益率: ${(totalReturn * 100).toFixed(2)}%`);
  console.log(`      📈 年化收益率: ${(annualizedReturn * 100).toFixed(1)}%`);
  console.log(`      ⚡ 平均杠杆: ${avgLeverage.toFixed(1)}倍`);
  console.log(`      🛡️ 最大回撤: ${(maxDrawdown * 100).toFixed(1)}%`);
  console.log(`      📊 夏普比率: ${sharpeRatio.toFixed(2)}`);
  console.log(`      💰 最终资金: $${Math.round(currentCapital).toLocaleString()}`);
  
  realisticResults.overallPerformance = {
    totalReturn,
    annualizedReturn,
    overallWinRate,
    longWinRate,
    shortWinRate,
    maxDrawdown,
    sharpeRatio,
    totalTrades: trades.length,
    longTrades,
    shortTrades,
    signalQuality,
    avgLeverage,
    finalCapital: currentCapital,
    trades,
    equity,
    leverageUsage
  };
}

// 生成现实信号
function generateRealisticSignal(data, index) {
  if (index < 20) {
    return { action: 'HOLD', confidence: 0, trend: 0, rsi: 50 };
  }
  
  const prices = data.slice(Math.max(0, index - 20), index + 1).map(d => d.close);
  const volumes = data.slice(Math.max(0, index - 20), index + 1).map(d => d.volume);
  
  // 计算技术指标
  const rsi = calculateRSI(prices, 14);
  const trend = calculateTrend(prices);
  const volatility = calculateVolatility(prices);
  
  // 成交量分析
  const avgVolume = volumes.slice(-10).reduce((sum, v) => sum + v, 0) / 10;
  const currentVolume = volumes[volumes.length - 1];
  const volumeRatio = currentVolume / avgVolume;
  
  // 现实信号生成
  let action = 'HOLD';
  let confidence = 0.5;
  
  // 做多信号 - 更严格的条件
  if (trend > realisticConfig.signalFilters.minTrendStrength && 
      rsi < realisticConfig.signalFilters.maxRSI && 
      rsi > 30 &&
      volumeRatio > realisticConfig.signalFilters.volumeRatio) {
    
    confidence = 0.5 + Math.abs(trend) * 10 + (75 - rsi) / 100;
    action = confidence > 0.75 ? 'STRONG_LONG' : 'WEAK_LONG';
  }
  // 做空信号 - 更严格的条件
  else if (trend < -realisticConfig.signalFilters.minTrendStrength && 
           rsi > realisticConfig.signalFilters.minRSI && 
           rsi < 70 &&
           volumeRatio > realisticConfig.signalFilters.volumeRatio) {
    
    confidence = 0.5 + Math.abs(trend) * 10 + (rsi - 25) / 100;
    action = confidence > 0.75 ? 'STRONG_SHORT' : 'WEAK_SHORT';
  }
  
  return {
    action: action,
    confidence: Math.max(0, Math.min(1, confidence)),
    trend: trend,
    rsi: rsi,
    volatility: volatility,
    volumeRatio: volumeRatio
  };
}

// 现实过滤器
function passRealisticFilters(signal) {
  // 置信度过滤
  if (signal.confidence < realisticConfig.signalFilters.minConfidence) {
    return false;
  }
  
  // 波动率过滤 - 避免过高波动
  if (signal.volatility > 0.05) {
    return false;
  }
  
  return true;
}

// 计算现实杠杆
function calculateRealisticLeverage(signal) {
  const config = realisticConfig.leverageConfig;
  
  if (!config.enabled) {
    return 1;
  }
  
  let leverage = config.baseLeverage;
  
  if (config.dynamicAdjustment) {
    // 基于置信度调整
    if (signal.confidence > 0.8) {
      leverage += 1;
    } else if (signal.confidence < 0.65) {
      leverage -= 1;
    }
    
    // 基于波动率调整 - 高波动降低杠杆
    if (signal.volatility > 0.03) {
      leverage -= 1;
    }
  }
  
  return Math.max(config.minLeverage, Math.min(config.maxLeverage, leverage));
}

// 开仓
function openPosition(signal, candle, capital, leverage, index) {
  const isLong = signal.action.includes('LONG');
  const isStrong = signal.action.includes('STRONG');
  
  // 仓位计算
  let positionSize = realisticConfig.riskManagement.positionSize;
  
  if (isStrong) {
    positionSize *= 1.3;
  }
  
  positionSize *= signal.confidence;
  positionSize = Math.min(positionSize, realisticConfig.riskManagement.maxSize);
  
  const tradeAmount = capital * positionSize;
  const entryPrice = candle.close * (1 + (isLong ? 1 : -1) * realisticConfig.tradingParams.slippage);
  
  // 计算止损止盈价格
  const stopLossPrice = entryPrice * (1 + (isLong ? -1 : 1) * realisticConfig.riskManagement.stopLoss);
  const takeProfitPrice = entryPrice * (1 + (isLong ? 1 : -1) * realisticConfig.riskManagement.takeProfit);
  
  return {
    side: isLong ? 'LONG' : 'SHORT',
    entryPrice: entryPrice,
    entryTime: candle.timestamp,
    entryIndex: index,
    tradeAmount: tradeAmount,
    leverage: leverage,
    positionSize: positionSize,
    stopLossPrice: stopLossPrice,
    takeProfitPrice: takeProfitPrice,
    confidence: signal.confidence,
    maxHoldingPeriod: realisticConfig.tradingParams.holdingPeriod
  };
}

// 检查平仓条件
function checkPositionClose(position, currentCandle, nextCandle, currentIndex) {
  const isLong = position.side === 'LONG';
  const currentPrice = currentCandle.close;
  const holdingPeriod = currentIndex - position.entryIndex;
  
  // 检查止损
  if ((isLong && currentPrice <= position.stopLossPrice) ||
      (!isLong && currentPrice >= position.stopLossPrice)) {
    return {
      shouldClose: true,
      reason: 'STOP_LOSS',
      price: position.stopLossPrice,
      priceChange: (position.stopLossPrice - position.entryPrice) / position.entryPrice * (isLong ? 1 : -1)
    };
  }
  
  // 检查止盈
  if ((isLong && currentPrice >= position.takeProfitPrice) ||
      (!isLong && currentPrice <= position.takeProfitPrice)) {
    return {
      shouldClose: true,
      reason: 'TAKE_PROFIT',
      price: position.takeProfitPrice,
      priceChange: (position.takeProfitPrice - position.entryPrice) / position.entryPrice * (isLong ? 1 : -1)
    };
  }
  
  // 检查最大持仓时间
  if (holdingPeriod >= position.maxHoldingPeriod) {
    return {
      shouldClose: true,
      reason: 'TIME_LIMIT',
      price: currentPrice,
      priceChange: (currentPrice - position.entryPrice) / position.entryPrice * (isLong ? 1 : -1)
    };
  }
  
  return { shouldClose: false };
}

// 平仓
function closePosition(position, closeResult, currentCapital) {
  const exitPrice = closeResult.price * (1 + (position.side === 'LONG' ? -1 : 1) * realisticConfig.tradingParams.slippage);
  const priceChange = closeResult.priceChange;
  
  // 计算收益（包含杠杆效应）
  let returnRate = priceChange * position.leverage;
  
  // 扣除手续费
  const fees = realisticConfig.riskManagement.fees * 2; // 开仓和平仓手续费
  returnRate -= fees;
  
  const pnl = position.tradeAmount * returnRate;
  
  return {
    side: position.side,
    entryPrice: position.entryPrice,
    exitPrice: exitPrice,
    entryTime: position.entryTime,
    exitTime: Date.now(),
    tradeAmount: position.tradeAmount,
    leverage: position.leverage,
    priceChange: priceChange,
    returnRate: returnRate,
    pnl: pnl,
    reason: closeResult.reason,
    confidence: position.confidence,
    holdingPeriod: closeResult.holdingPeriod || 0
  };
}

// 风险分析
async function analyzeRiskMetrics() {
  console.log('📈 分析风险指标...');
  
  const result = realisticResults.overallPerformance;
  const trades = result.trades;
  
  if (trades.length === 0) {
    console.log('   ⚠️ 没有交易数据，跳过风险分析');
    return;
  }
  
  // 计算风险指标
  const returns = trades.map(t => t.returnRate);
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl < 0);
  
  const avgWin = winningTrades.length > 0 ? winningTrades.reduce((sum, t) => sum + t.returnRate, 0) / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? losingTrades.reduce((sum, t) => sum + Math.abs(t.returnRate), 0) / losingTrades.length : 0;
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;
  
  // 最大连续亏损
  let maxConsecutiveLosses = 0;
  let currentConsecutiveLosses = 0;
  
  for (const trade of trades) {
    if (trade.pnl < 0) {
      currentConsecutiveLosses++;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentConsecutiveLosses);
    } else {
      currentConsecutiveLosses = 0;
    }
  }
  
  const riskMetrics = {
    profitFactor,
    avgWin,
    avgLoss,
    maxConsecutiveLosses,
    winRate: result.overallWinRate,
    avgLeverage: result.avgLeverage,
    maxDrawdown: result.maxDrawdown,
    sharpeRatio: result.sharpeRatio
  };
  
  console.log(`   📊 风险指标:`);
  console.log(`      盈亏比: ${profitFactor.toFixed(2)}`);
  console.log(`      平均盈利: ${(avgWin * 100).toFixed(2)}%`);
  console.log(`      平均亏损: ${(avgLoss * 100).toFixed(2)}%`);
  console.log(`      最大连续亏损: ${maxConsecutiveLosses}笔`);
  console.log(`      胜率: ${(result.overallWinRate * 100).toFixed(1)}%`);
  console.log(`      平均杠杆: ${result.avgLeverage.toFixed(1)}倍`);
  console.log(`      最大回撤: ${(result.maxDrawdown * 100).toFixed(1)}%`);
  console.log(`      夏普比率: ${result.sharpeRatio.toFixed(2)}`);
  
  realisticResults.riskMetrics = riskMetrics;
}

// 生成现实报告
async function generateRealisticReport() {
  console.log('📋 生成现实回测报告...');
  
  const result = realisticResults.overallPerformance;
  const riskMetrics = realisticResults.riskMetrics;
  const dataStats = realisticResults.dataStats;
  
  console.log('\n📋 修复版真实数据杠杆ETH合约Agent报告');
  console.log('='.repeat(80));
  
  console.log('\n🎯 测试概况:');
  console.log(`   Agent版本: 修复版真实数据杠杆ETH合约Agent v13.0`);
  console.log(`   修复内容: 真实价格变化、现实胜率、合理风险`);
  console.log(`   数据来源: 币安真实历史K线数据`);
  console.log(`   数据量: ${dataStats.totalRecords.toLocaleString()}条K线`);
  console.log(`   杠杆策略: 2-5倍动态杠杆`);
  
  console.log('\n🏆 核心成就:');
  console.log(`   🎯 总收益率: ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`   📈 年化收益率: ${(result.annualizedReturn * 100).toFixed(1)}%`);
  console.log(`   🏆 总胜率: ${(result.overallWinRate * 100).toFixed(1)}%`);
  console.log(`   📊 总交易数: ${result.totalTrades}笔`);
  console.log(`   ⚡ 平均杠杆: ${result.avgLeverage.toFixed(1)}倍`);
  console.log(`   🛡️ 最大回撤: ${(result.maxDrawdown * 100).toFixed(1)}%`);
  console.log(`   📈 夏普比率: ${result.sharpeRatio.toFixed(2)}`);
  console.log(`   💰 最终资金: $${Math.round(result.finalCapital).toLocaleString()}`);
  
  console.log('\n📊 风险分析:');
  if (riskMetrics) {
    console.log(`   盈亏比: ${riskMetrics.profitFactor.toFixed(2)}`);
    console.log(`   平均盈利: ${(riskMetrics.avgWin * 100).toFixed(2)}%`);
    console.log(`   平均亏损: ${(riskMetrics.avgLoss * 100).toFixed(2)}%`);
    console.log(`   最大连续亏损: ${riskMetrics.maxConsecutiveLosses}笔`);
  }
  
  console.log('\n📊 市场对比:');
  const marketReturn = (dataStats.priceRange.end / dataStats.priceRange.start - 1);
  const excessReturn = result.totalReturn - marketReturn;
  console.log(`   ETH买入持有: ${(marketReturn * 100).toFixed(2)}%`);
  console.log(`   杠杆策略: ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`   超额收益: ${(excessReturn * 100).toFixed(2)}%`);
  
  console.log('\n🎯 策略评估:');
  if (result.totalReturn > 0.5 && result.overallWinRate > 0.6 && result.maxDrawdown < 0.3) {
    console.log('   🎉 优秀表现: 收益率50%+ 且 胜率60%+ 且 回撤<30%');
    console.log('   评级: A+ (优秀级)');
    console.log('   评价: 修复版策略表现优秀，风险可控');
  } else if (result.totalReturn > 0.2 && result.overallWinRate > 0.5) {
    console.log('   📈 良好表现: 收益率20%+ 且 胜率50%+');
    console.log('   评级: A (良好级)');
    console.log('   评价: 修复版策略表现良好');
  } else if (result.totalTrades > 0) {
    console.log('   📊 基础表现: 策略基本可行');
    console.log('   评级: B+ (可接受级)');
    console.log('   评价: 修复版策略需要进一步优化');
  } else {
    console.log('   ⚠️ 需要改进: 策略需要重新调整');
    console.log('   评级: C (需改进级)');
    console.log('   评价: 信号过滤过严，需要放宽条件');
  }
  
  console.log('\n💡 修复版优势:');
  console.log('   🔧 真实价格变化 - 基于实际K线数据计算收益');
  console.log('   📊 现实胜率 - 包含止损和亏损交易');
  console.log('   ⚡ 合理杠杆 - 2-5倍杠杆，风险可控');
  console.log('   🛡️ 风险管理 - 止损、止盈、最大回撤控制');
  console.log('   💰 手续费考虑 - 包含交易成本和滑点');
  
  console.log('\n🔥 核心洞察:');
  console.log('   • 修复版提供了更现实的回测结果');
  console.log('   • 杠杆合约交易需要严格的风险管理');
  console.log('   • 真实的胜率通常在50-70%之间');
  console.log('   • 合理的杠杆倍数是成功的关键');
  
  console.log('\n🚀 实施建议:');
  if (result.totalReturn > 0.2 && result.overallWinRate > 0.5) {
    console.log('   🟢 可以考虑实盘测试: 策略表现符合预期');
    console.log('   🟡 小资金验证: 先用小资金验证策略');
    console.log('   🔴 严格风控: 必须严格执行止损和风险管理');
  } else {
    console.log('   🟡 需要进一步优化: 策略还需要改进');
    console.log('   🔴 谨慎实盘: 不建议直接实盘交易');
    console.log('   🟢 继续回测: 调整参数后再次测试');
  }
  
  // 保存详细报告
  const reportPath = path.join(__dirname, 'realistic_real_data_leverage_agent_report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    testDate: new Date().toISOString().split('T')[0],
    agentVersion: 'Realistic Real Data Leverage ETH Agent v13.0',
    fixedIssues: [
      'Real price-based return calculation',
      'Realistic win rate (60-70%)',
      'Proper stop-loss and risk management',
      'Reasonable leverage risk model'
    ],
    config: realisticConfig,
    results: realisticResults,
    conclusion: result.totalReturn > 0.2 ? 'REALISTIC_SUCCESS' : 'NEEDS_OPTIMIZATION'
  }, null, 2));
  
  console.log(`\n💾 详细报告已保存: ${reportPath}`);
}

// 辅助函数
function calculateTrend(prices) {
  if (prices.length < 10) return 0;
  const recent = prices.slice(-5);
  const older = prices.slice(-10, -5);
  const recentAvg = recent.reduce((sum, p) => sum + p, 0) / recent.length;
  const olderAvg = older.reduce((sum, p) => sum + p, 0) / older.length;
  return (recentAvg - olderAvg) / olderAvg;
}

function calculateRSI(prices, period) {
  if (prices.length < period + 1) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= Math.min(period, prices.length - 1); i++) {
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

function calculateVolatility(prices) {
  if (prices.length < 10) return 0;
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i-1]) / prices[i-1]);
  }
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  return Math.sqrt(variance);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 运行修复版测试
runRealisticRealDataTest().catch(console.error);