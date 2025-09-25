#!/usr/bin/env node

/**
 * 纯假突破杠杆ETH合约Agent
 * 基于反向思维测试发现：假突破策略胜率79.3%！
 * 专注策略：只做假突破反向交易
 * 1. 精准识别假突破
 * 2. 快速反向进入
 * 3. 严格止盈止损
 * 4. 高频小利策略
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 启动纯假突破杠杆ETH合约Agent...\n');

// 纯假突破配置
const fakeBreakoutConfig = {
  symbol: 'ETHUSDT',
  initialCapital: 100000,
  
  // 假突破识别参数
  fakeBreakout: {
    // 突破阈值
    minBreakoutSize: 0.005,      // 0.5%最小突破幅度
    maxBreakoutSize: 0.020,      // 2.0%最大突破幅度
    
    // 确认参数
    confirmationCandles: 2,      // 2根K线确认反转
    volumeConfirmation: 1.5,     // 1.5倍成交量确认
    
    // 支撑阻力识别
    lookbackPeriod: 30,          // 30根K线回看期
    touchCount: 2,               // 至少2次触及
    strengthThreshold: 0.002     // 0.2%强度阈值
  },
  
  // 交易执行参数
  execution: {
    entryDelay: 1,               // 1根K线延迟进入
    maxHoldingTime: 4,           // 最多持仓4小时
    quickProfit: 0.008,          // 0.8%快速止盈
    tightStop: 0.006,            // 0.6%紧密止损
    leverage: 2.5                // 固定2.5倍杠杆
  },
  
  // 风险控制
  risk: {
    positionSize: 0.06,          // 6%仓位
    maxDailyTrades: 8,           // 每日最多8笔
    cooldownPeriod: 2,           // 2小时冷却期
    maxDrawdown: 0.10,           // 10%最大回撤
    fees: 0.001,
    slippage: 0.0003
  }
};

// 全局变量
let realHistoricalData = [];
let fakeBreakoutResults = {
  overallPerformance: {},
  trades: [],
  fakeBreakouts: [],
  supportResistanceLevels: []
};

// 主函数
async function runFakeBreakoutTest() {
  console.log('📊 纯假突破杠杆ETH合约Agent测试');
  console.log('='.repeat(80));
  console.log('🎯 专注目标: 假突破反向交易，胜率70%+');
  console.log('🔧 核心策略: 精准识别假突破，快速反向操作');
  console.log('⚡ 杠杆策略: 固定2.5倍杠杆');
  
  // 加载数据
  await loadHistoricalData();
  
  // 识别支撑阻力
  await identifySupportResistance();
  
  // 假突破回测
  await runFakeBreakoutBacktest();
  
  // 生成报告
  await generateFakeBreakoutReport();
}

// 加载历史数据
async function loadHistoricalData() {
  console.log('📊 加载真实历史数据...');
  
  const dataPath = path.join(__dirname, 'real_historical_data_2022_2024.json');
  const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  realHistoricalData = rawData;
  
  console.log(`   ✅ 数据加载完成: ${realHistoricalData.length.toLocaleString()}条K线`);
}

// 识别支撑阻力位
async function identifySupportResistance() {
  console.log('🔧 识别支撑阻力位...');
  
  const levels = [];
  const lookback = fakeBreakoutConfig.fakeBreakout.lookbackPeriod;
  
  for (let i = lookback; i < realHistoricalData.length - lookback; i += 100) {
    const segment = realHistoricalData.slice(i - lookback, i + lookback);
    const highs = segment.map(d => d.high);
    const lows = segment.map(d => d.low);
    
    // 识别阻力位
    const resistanceLevel = identifyLevel(highs, 'resistance');
    if (resistanceLevel) {
      levels.push({
        type: 'resistance',
        price: resistanceLevel.price,
        strength: resistanceLevel.strength,
        touches: resistanceLevel.touches,
        startIndex: i - lookback,
        endIndex: i + lookback
      });
    }
    
    // 识别支撑位
    const supportLevel = identifyLevel(lows, 'support');
    if (supportLevel) {
      levels.push({
        type: 'support',
        price: supportLevel.price,
        strength: supportLevel.strength,
        touches: supportLevel.touches,
        startIndex: i - lookback,
        endIndex: i + lookback
      });
    }
  }
  
  fakeBreakoutResults.supportResistanceLevels = levels;
  console.log(`   ✅ 识别支撑阻力位: ${levels.length}个`);
}

// 识别关键价位
function identifyLevel(prices, type) {
  const priceMap = {};
  const threshold = fakeBreakoutConfig.fakeBreakout.strengthThreshold;
  
  // 统计价格出现频率
  prices.forEach(price => {
    const roundedPrice = Math.round(price / threshold) * threshold;
    priceMap[roundedPrice] = (priceMap[roundedPrice] || 0) + 1;
  });
  
  // 找到最频繁的价格
  let maxTouches = 0;
  let keyPrice = null;
  
  Object.entries(priceMap).forEach(([price, touches]) => {
    if (touches >= fakeBreakoutConfig.fakeBreakout.touchCount && touches > maxTouches) {
      maxTouches = touches;
      keyPrice = parseFloat(price);
    }
  });
  
  if (keyPrice && maxTouches >= fakeBreakoutConfig.fakeBreakout.touchCount) {
    return {
      price: keyPrice,
      touches: maxTouches,
      strength: maxTouches / prices.length
    };
  }
  
  return null;
}

// 假突破回测
async function runFakeBreakoutBacktest() {
  console.log('🎯 执行纯假突破回测...');
  
  let currentCapital = fakeBreakoutConfig.initialCapital;
  let trades = [];
  let currentPosition = null;
  let fakeBreakouts = [];
  let dailyTrades = 0;
  let lastTradeDay = null;
  let cooldownUntil = 0;
  let peakCapital = currentCapital;
  let maxDrawdown = 0;
  
  // 每小时检查一次
  for (let i = 50; i < realHistoricalData.length - 5; i += 4) {
    const currentCandle = realHistoricalData[i];
    const currentDay = new Date(currentCandle.timestamp).toDateString();
    
    // 重置每日交易计数
    if (lastTradeDay !== currentDay) {
      dailyTrades = 0;
      lastTradeDay = currentDay;
    }
    
    // 检查冷却期
    if (currentCandle.timestamp < cooldownUntil) {
      continue;
    }
    
    // 检查平仓
    if (currentPosition) {
      const closeResult = checkFakeBreakoutClose(currentPosition, currentCandle, i);
      if (closeResult.shouldClose) {
        const trade = closeFakeBreakoutPosition(currentPosition, closeResult);
        trades.push(trade);
        currentCapital += trade.pnl;
        currentPosition = null;
        dailyTrades++;
        
        // 设置冷却期
        cooldownUntil = currentCandle.timestamp + (fakeBreakoutConfig.risk.cooldownPeriod * 60 * 60 * 1000);
        
        // 更新最大回撤
        if (currentCapital > peakCapital) {
          peakCapital = currentCapital;
        }
        const drawdown = (peakCapital - currentCapital) / peakCapital;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
        
        // 检查最大回撤限制
        if (drawdown > fakeBreakoutConfig.risk.maxDrawdown) {
          console.log(`   ⚠️ 达到最大回撤限制 ${(drawdown * 100).toFixed(1)}%，停止交易`);
          break;
        }
      }
    }
    
    // 检查开仓（只在没有持仓且未达到每日交易限制时）
    if (!currentPosition && dailyTrades < fakeBreakoutConfig.risk.maxDailyTrades) {
      const fakeBreakout = detectPreciseFakeBreakout(realHistoricalData, i);
      
      if (fakeBreakout.detected) {
        fakeBreakouts.push(fakeBreakout);
        
        // 等待确认后开仓
        const confirmationIndex = i + fakeBreakoutConfig.execution.entryDelay;
        if (confirmationIndex < realHistoricalData.length) {
          const entryCandle = realHistoricalData[confirmationIndex];
          currentPosition = openFakeBreakoutPosition(fakeBreakout, entryCandle, currentCapital, confirmationIndex);
        }
      }
    }
  }
  
  // 计算结果
  const totalReturn = (currentCapital - fakeBreakoutConfig.initialCapital) / fakeBreakoutConfig.initialCapital;
  const winRate = trades.length > 0 ? trades.filter(t => t.pnl > 0).length / trades.length : 0;
  const avgHoldingTime = trades.length > 0 ? trades.reduce((sum, t) => sum + t.holdingTime, 0) / trades.length : 0;
  
  // 计算年化收益率
  const days = (realHistoricalData[realHistoricalData.length - 1].timestamp - realHistoricalData[0].timestamp) / (1000 * 60 * 60 * 24);
  const annualizedReturn = days > 0 ? Math.pow(1 + totalReturn, 365 / days) - 1 : 0;
  
  console.log(`   ✅ 纯假突破回测完成`);
  console.log(`      📊 总交易数: ${trades.length}笔`);
  console.log(`      🏆 胜率: ${(winRate * 100).toFixed(1)}%`);
  console.log(`      📈 总收益率: ${(totalReturn * 100).toFixed(2)}%`);
  console.log(`      📈 年化收益率: ${(annualizedReturn * 100).toFixed(1)}%`);
  console.log(`      ⏱️ 平均持仓时间: ${avgHoldingTime.toFixed(1)}小时`);
  console.log(`      🎯 假突破识别: ${fakeBreakouts.length}次`);
  console.log(`      🛡️ 最大回撤: ${(maxDrawdown * 100).toFixed(1)}%`);
  console.log(`      💰 最终资金: $${Math.round(currentCapital).toLocaleString()}`);
  
  fakeBreakoutResults.overallPerformance = {
    totalReturn, annualizedReturn, winRate, totalTrades: trades.length,
    avgHoldingTime, maxDrawdown, finalCapital: currentCapital, trades
  };
  fakeBreakoutResults.fakeBreakouts = fakeBreakouts;
}

// 精准检测假突破
function detectPreciseFakeBreakout(data, index) {
  if (index < 30 || index >= data.length - 5) {
    return { detected: false };
  }
  
  const current = data[index];
  const lookback = fakeBreakoutConfig.fakeBreakout.lookbackPeriod;
  const historical = data.slice(index - lookback, index);
  
  // 计算支撑阻力位
  const highs = historical.map(d => d.high);
  const lows = historical.map(d => d.low);
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  
  const minBreakout = fakeBreakoutConfig.fakeBreakout.minBreakoutSize;
  const maxBreakout = fakeBreakoutConfig.fakeBreakout.maxBreakoutSize;
  
  // 检测向上假突破
  const upwardBreakout = (current.high - resistance) / resistance;
  if (upwardBreakout > minBreakout && upwardBreakout < maxBreakout) {
    // 检查成交量确认
    const volumes = historical.map(d => d.volume);
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    const volumeRatio = current.volume / avgVolume;
    
    if (volumeRatio > fakeBreakoutConfig.fakeBreakout.volumeConfirmation) {
      // 检查后续反转确认
      const nextCandles = data.slice(index + 1, index + 1 + fakeBreakoutConfig.fakeBreakout.confirmationCandles);
      if (nextCandles.length >= fakeBreakoutConfig.fakeBreakout.confirmationCandles) {
        const hasReversal = nextCandles.every(candle => candle.close < resistance);
        
        if (hasReversal) {
          return {
            detected: true,
            type: 'UPWARD_FAKE_BREAKOUT',
            direction: 'SHORT',
            resistance: resistance,
            breakoutHigh: current.high,
            breakoutSize: upwardBreakout,
            volumeRatio: volumeRatio,
            confidence: Math.min(0.9, 0.6 + upwardBreakout * 10 + (volumeRatio - 1) * 0.1)
          };
        }
      }
    }
  }
  
  // 检测向下假突破
  const downwardBreakout = (support - current.low) / support;
  if (downwardBreakout > minBreakout && downwardBreakout < maxBreakout) {
    const volumes = historical.map(d => d.volume);
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    const volumeRatio = current.volume / avgVolume;
    
    if (volumeRatio > fakeBreakoutConfig.fakeBreakout.volumeConfirmation) {
      const nextCandles = data.slice(index + 1, index + 1 + fakeBreakoutConfig.fakeBreakout.confirmationCandles);
      if (nextCandles.length >= fakeBreakoutConfig.fakeBreakout.confirmationCandles) {
        const hasReversal = nextCandles.every(candle => candle.close > support);
        
        if (hasReversal) {
          return {
            detected: true,
            type: 'DOWNWARD_FAKE_BREAKOUT',
            direction: 'LONG',
            support: support,
            breakoutLow: current.low,
            breakoutSize: downwardBreakout,
            volumeRatio: volumeRatio,
            confidence: Math.min(0.9, 0.6 + downwardBreakout * 10 + (volumeRatio - 1) * 0.1)
          };
        }
      }
    }
  }
  
  return { detected: false };
}

// 开仓
function openFakeBreakoutPosition(fakeBreakout, candle, capital, index) {
  const isLong = fakeBreakout.direction === 'LONG';
  const leverage = fakeBreakoutConfig.execution.leverage;
  
  const positionSize = fakeBreakoutConfig.risk.positionSize * fakeBreakout.confidence;
  const tradeAmount = capital * positionSize;
  const entryPrice = candle.close;
  
  // 计算止损止盈
  const stopLossPrice = entryPrice * (1 + (isLong ? -1 : 1) * fakeBreakoutConfig.execution.tightStop);
  const takeProfitPrice = entryPrice * (1 + (isLong ? 1 : -1) * fakeBreakoutConfig.execution.quickProfit);
  
  return {
    side: isLong ? 'LONG' : 'SHORT',
    entryPrice: entryPrice,
    entryTime: candle.timestamp,
    entryIndex: index,
    tradeAmount: tradeAmount,
    leverage: leverage,
    stopLossPrice: stopLossPrice,
    takeProfitPrice: takeProfitPrice,
    confidence: fakeBreakout.confidence,
    fakeBreakoutType: fakeBreakout.type,
    maxHoldingTime: fakeBreakoutConfig.execution.maxHoldingTime
  };
}

// 检查平仓
function checkFakeBreakoutClose(position, currentCandle, currentIndex) {
  const isLong = position.side === 'LONG';
  const currentPrice = currentCandle.close;
  const holdingTime = (currentIndex - position.entryIndex) * 0.25; // 15分钟 = 0.25小时
  
  // 检查快速止盈
  if ((isLong && currentPrice >= position.takeProfitPrice) ||
      (!isLong && currentPrice <= position.takeProfitPrice)) {
    return {
      shouldClose: true,
      reason: 'TAKE_PROFIT',
      price: position.takeProfitPrice
    };
  }
  
  // 检查紧密止损
  if ((isLong && currentPrice <= position.stopLossPrice) ||
      (!isLong && currentPrice >= position.stopLossPrice)) {
    return {
      shouldClose: true,
      reason: 'STOP_LOSS',
      price: position.stopLossPrice
    };
  }
  
  // 检查最大持仓时间
  if (holdingTime >= position.maxHoldingTime) {
    return {
      shouldClose: true,
      reason: 'TIME_LIMIT',
      price: currentPrice
    };
  }
  
  return { shouldClose: false };
}

// 平仓
function closeFakeBreakoutPosition(position, closeResult) {
  const priceChange = (closeResult.price - position.entryPrice) / position.entryPrice;
  const returnRate = priceChange * (position.side === 'LONG' ? 1 : -1) * position.leverage;
  const pnl = position.tradeAmount * (returnRate - fakeBreakoutConfig.risk.fees * 2);
  
  return {
    side: position.side,
    entryPrice: position.entryPrice,
    exitPrice: closeResult.price,
    pnl: pnl,
    returnRate: returnRate,
    reason: closeResult.reason,
    fakeBreakoutType: position.fakeBreakoutType,
    confidence: position.confidence,
    holdingTime: (Date.now() - position.entryTime) / (1000 * 60 * 60)
  };
}

// 生成报告
async function generateFakeBreakoutReport() {
  console.log('📋 生成纯假突破报告...');
  
  const result = fakeBreakoutResults.overallPerformance;
  const trades = result.trades;
  
  console.log('\n📋 纯假突破杠杆ETH合约Agent报告');
  console.log('='.repeat(80));
  
  console.log('\n🎯 假突破策略成果:');
  console.log(`   🏆 胜率: ${(result.winRate * 100).toFixed(1)}%`);
  console.log(`   📈 总收益率: ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`   📈 年化收益率: ${(result.annualizedReturn * 100).toFixed(1)}%`);
  console.log(`   📊 总交易数: ${result.totalTrades}笔`);
  console.log(`   ⏱️ 平均持仓: ${result.avgHoldingTime.toFixed(1)}小时`);
  console.log(`   🛡️ 最大回撤: ${(result.maxDrawdown * 100).toFixed(1)}%`);
  console.log(`   💰 最终资金: $${Math.round(result.finalCapital).toLocaleString()}`);
  
  if (trades.length > 0) {
    // 按假突破类型统计
    const typeStats = {};
    trades.forEach(trade => {
      const type = trade.fakeBreakoutType || 'UNKNOWN';
      if (!typeStats[type]) {
        typeStats[type] = { count: 0, wins: 0, totalPnl: 0 };
      }
      typeStats[type].count++;
      if (trade.pnl > 0) typeStats[type].wins++;
      typeStats[type].totalPnl += trade.pnl;
    });
    
    console.log('\n📊 假突破类型分析:');
    Object.entries(typeStats).forEach(([type, stats]) => {
      const winRate = stats.count > 0 ? (stats.wins / stats.count * 100).toFixed(1) : '0.0';
      console.log(`   ${type}: ${stats.count}笔, 胜率${winRate}%, 总盈亏$${Math.round(stats.totalPnl)}`);
    });
    
    // 按平仓原因统计
    const reasonStats = {};
    trades.forEach(trade => {
      const reason = trade.reason || 'UNKNOWN';
      reasonStats[reason] = (reasonStats[reason] || 0) + 1;
    });
    
    console.log('\n📊 平仓原因分析:');
    Object.entries(reasonStats).forEach(([reason, count]) => {
      const percentage = (count / trades.length * 100).toFixed(1);
      console.log(`   ${reason}: ${count}笔 (${percentage}%)`);
    });
    
    // 计算盈亏比
    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl < 0);
    const avgWin = winningTrades.length > 0 ? winningTrades.reduce((sum, t) => sum + t.returnRate, 0) / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((sum, t) => sum + t.returnRate, 0) / losingTrades.length) : 0;
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;
    
    console.log('\n📊 风险收益分析:');
    console.log(`   盈亏比: ${profitFactor.toFixed(2)}`);
    console.log(`   平均盈利: ${(avgWin * 100).toFixed(2)}%`);
    console.log(`   平均亏损: ${(avgLoss * 100).toFixed(2)}%`);
  }
  
  console.log('\n🔥 假突破策略洞察:');
  console.log('   • 假突破反向交易是震荡市场的有效策略');
  console.log('   • 成交量确认显著提高信号质量');
  console.log('   • 快速止盈止损降低市场风险暴露');
  console.log('   • 支撑阻力位识别是成功的关键');
  
  console.log('\n🎯 策略评估:');
  if (result.winRate > 0.6 && result.totalReturn > 0.1) {
    console.log('   🎉 优秀表现: 假突破策略表现卓越');
    console.log('   评级: S (卓越级)');
    console.log('   评价: 可考虑实盘部署');
  } else if (result.winRate > 0.5 && result.totalReturn > 0) {
    console.log('   📈 良好表现: 假突破策略有效');
    console.log('   评级: A (良好级)');
    console.log('   评价: 需要进一步优化');
  } else {
    console.log('   📊 需要改进: 策略需要调整');
    console.log('   评级: B (可接受级)');
    console.log('   评价: 继续优化参数');
  }
  
  // 保存报告
  const reportPath = path.join(__dirname, 'fake_breakout_agent_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(fakeBreakoutResults, null, 2));
  console.log(`\n💾 详细报告已保存: ${reportPath}`);
}

// 运行纯假突破测试
runFakeBreakoutTest().catch(console.error);