#!/usr/bin/env node

/**
 * 反操控杠杆ETH合约Agent
 * 核心理念：识别并利用庄家/交易所的操控行为
 * 
 * 操控手法识别：
 * 1. 虚晓一枪 - 假突破诱多诱空
 * 2. 杀多杀空 - 快速拉升后砸盘或快速下跌后拉升
 * 3. 洗盘操作 - 震荡洗出散户筹码
 * 4. 插针行为 - 瞬间极端价格收割止损
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 启动反操控杠杆ETH合约Agent...\n');

// 反操控配置
const antiManipulationConfig = {
  symbol: 'ETHUSDT',
  initialCapital: 100000,
  
  // 操控行为识别参数
  manipulation: {
    // 虚晃一枪识别
    fakeMove: {
      minMoveSize: 0.008,          // 0.8%最小移动幅度
      maxMoveSize: 0.025,          // 2.5%最大移动幅度
      reversalTime: 3,             // 3根K线内反转
      volumeSpike: 2.0,            // 2倍成交量激增
      wickRatio: 0.6               // 影线占比60%+
    },
    
    // 杀多杀空识别
    liquidationHunt: {
      rapidMove: 0.015,            // 1.5%快速移动
      timeWindow: 2,               // 2根K线时间窗口
      volumeExplosion: 3.0,        // 3倍成交量爆发
      immediateReversal: true      // 立即反转确认
    },
    
    // 洗盘识别
    washTrading: {
      rangeSize: 0.02,             // 2%震荡区间
      timeInRange: 10,             // 至少10根K线
      volumePattern: 'declining',   // 成交量递减模式
      breakoutFakeout: 0.005       // 0.5%假突破
    },
    
    // 插针识别
    wickHunt: {
      wickSize: 0.012,             // 1.2%影线长度
      bodyRatio: 0.3,              // 实体占比<30%
      recoverySpeed: 1,            // 1根K线快速恢复
      liquidityGrab: true          // 流动性抓取确认
    }
  },
  
  // 反操控交易策略
  strategy: {
    // 反向跟随
    contrarian: {
      enabled: true,
      confidence: 0.8,             // 80%置信度
      quickEntry: true,            // 快速入场
      tightStop: 0.005,            // 0.5%紧密止损
      quickProfit: 0.012           // 1.2%快速止盈
    },
    
    // 操控后反弹
    rebound: {
      enabled: true,
      waitPeriod: 2,               // 等待2根K线
      entryZone: 0.008,            // 0.8%入场区间
      targetProfit: 0.018          // 1.8%目标利润
    }
  },
  
  // 风险管理
  risk: {
    leverage: 2.0,                 // 固定2倍杠杆（降低风险）
    positionSize: 0.05,            // 5%基础仓位
    maxSize: 0.10,                 // 10%最大仓位
    maxDailyTrades: 6,             // 每日最多6笔
    maxDrawdown: 0.08,             // 8%最大回撤
    fees: 0.001,
    slippage: 0.0003
  }
};

// 全局变量
let realHistoricalData = [];
let antiManipulationResults = {
  overallPerformance: {},
  trades: [],
  manipulationEvents: [],
  strategyBreakdown: {}
};

// 主函数
async function runAntiManipulationTest() {
  console.log('📊 反操控杠杆ETH合约Agent测试');
  console.log('='.repeat(80));
  console.log('🎯 反操控目标: 识别庄家操控，反向获利');
  console.log('🔧 核心策略: 虚晃识别、杀多空识别、洗盘识别、插针识别');
  console.log('⚡ 杠杆策略: 固定2倍杠杆，快进快出');
  
  // 加载数据
  await loadHistoricalData();
  
  // 反操控回测
  await runAntiManipulationBacktest();
  
  // 生成报告
  await generateAntiManipulationReport();
}

// 加载历史数据
async function loadHistoricalData() {
  console.log('📊 加载真实历史数据...');
  
  const dataPath = path.join(__dirname, 'real_historical_data_2022_2024.json');
  const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  realHistoricalData = rawData;
  
  console.log(`   ✅ 数据加载完成: ${realHistoricalData.length.toLocaleString()}条K线`);
}

// 反操控回测
async function runAntiManipulationBacktest() {
  console.log('🎯 执行反操控回测...');
  
  let currentCapital = antiManipulationConfig.initialCapital;
  let trades = [];
  let currentPosition = null;
  let manipulationEvents = [];
  let dailyTrades = 0;
  let lastTradeDay = null;
  let peakCapital = currentCapital;
  let maxDrawdown = 0;
  
  // 策略统计
  let strategyStats = {
    fakeMove: { count: 0, wins: 0, pnl: 0 },
    liquidationHunt: { count: 0, wins: 0, pnl: 0 },
    washTrading: { count: 0, wins: 0, pnl: 0 },
    wickHunt: { count: 0, wins: 0, pnl: 0 }
  };
  
  // 每15分钟检查一次
  for (let i = 20; i < realHistoricalData.length - 5; i++) {
    const currentCandle = realHistoricalData[i];
    const currentDay = new Date(currentCandle.timestamp).toDateString();
    
    // 重置每日交易计数
    if (lastTradeDay !== currentDay) {
      dailyTrades = 0;
      lastTradeDay = currentDay;
    }
    
    // 检查平仓
    if (currentPosition) {
      const closeResult = checkAntiManipulationClose(currentPosition, currentCandle, i);
      if (closeResult.shouldClose) {
        const trade = closeAntiManipulationPosition(currentPosition, closeResult);
        trades.push(trade);
        currentCapital += trade.pnl;
        
        // 更新策略统计
        const strategy = trade.strategy;
        if (strategyStats[strategy]) {
          strategyStats[strategy].count++;
          strategyStats[strategy].pnl += trade.pnl;
          if (trade.pnl > 0) strategyStats[strategy].wins++;
        }
        
        currentPosition = null;
        dailyTrades++;
        
        // 更新最大回撤
        if (currentCapital > peakCapital) {
          peakCapital = currentCapital;
        }
        const drawdown = (peakCapital - currentCapital) / peakCapital;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
        
        // 检查最大回撤限制
        if (drawdown > antiManipulationConfig.risk.maxDrawdown) {
          console.log(`   ⚠️ 达到最大回撤限制 ${(drawdown * 100).toFixed(1)}%，停止交易`);
          break;
        }
      }
    }
    
    // 检查开仓（只在没有持仓且未达到每日交易限制时）
    if (!currentPosition && dailyTrades < antiManipulationConfig.risk.maxDailyTrades) {
      
      // 1. 检测虚晃一枪
      const fakeMove = detectFakeMove(realHistoricalData, i);
      if (fakeMove.detected) {
        manipulationEvents.push({ ...fakeMove, index: i, timestamp: currentCandle.timestamp });
        currentPosition = openAntiManipulationPosition(fakeMove, currentCandle, currentCapital, i, 'fakeMove');
      }
      
      // 2. 检测杀多杀空
      else {
        const liquidationHunt = detectLiquidationHunt(realHistoricalData, i);
        if (liquidationHunt.detected) {
          manipulationEvents.push({ ...liquidationHunt, index: i, timestamp: currentCandle.timestamp });
          currentPosition = openAntiManipulationPosition(liquidationHunt, currentCandle, currentCapital, i, 'liquidationHunt');
        }
      }
      
      // 3. 检测洗盘操作
      if (!currentPosition) {
        const washTrading = detectWashTrading(realHistoricalData, i);
        if (washTrading.detected) {
          manipulationEvents.push({ ...washTrading, index: i, timestamp: currentCandle.timestamp });
          currentPosition = openAntiManipulationPosition(washTrading, currentCandle, currentCapital, i, 'washTrading');
        }
      }
      
      // 4. 检测插针行为
      if (!currentPosition) {
        const wickHunt = detectWickHunt(realHistoricalData, i);
        if (wickHunt.detected) {
          manipulationEvents.push({ ...wickHunt, index: i, timestamp: currentCandle.timestamp });
          currentPosition = openAntiManipulationPosition(wickHunt, currentCandle, currentCapital, i, 'wickHunt');
        }
      }
    }
  }
  
  // 计算结果
  const totalReturn = (currentCapital - antiManipulationConfig.initialCapital) / antiManipulationConfig.initialCapital;
  const winRate = trades.length > 0 ? trades.filter(t => t.pnl > 0).length / trades.length : 0;
  const avgHoldingTime = trades.length > 0 ? trades.reduce((sum, t) => sum + (t.holdingTime || 0), 0) / trades.length : 0;
  
  // 计算年化收益率
  const days = (realHistoricalData[realHistoricalData.length - 1].timestamp - realHistoricalData[0].timestamp) / (1000 * 60 * 60 * 24);
  const annualizedReturn = days > 0 ? Math.pow(1 + totalReturn, 365 / days) - 1 : 0;
  
  console.log(`   ✅ 反操控回测完成`);
  console.log(`      📊 总交易数: ${trades.length}笔`);
  console.log(`      🏆 胜率: ${(winRate * 100).toFixed(1)}%`);
  console.log(`      📈 总收益率: ${(totalReturn * 100).toFixed(2)}%`);
  console.log(`      📈 年化收益率: ${(annualizedReturn * 100).toFixed(1)}%`);
  console.log(`      ⏱️ 平均持仓时间: ${avgHoldingTime.toFixed(1)}小时`);
  console.log(`      🎯 操控事件识别: ${manipulationEvents.length}次`);
  console.log(`      🛡️ 最大回撤: ${(maxDrawdown * 100).toFixed(1)}%`);
  console.log(`      💰 最终资金: $${Math.round(currentCapital).toLocaleString()}`);
  
  antiManipulationResults.overallPerformance = {
    totalReturn, annualizedReturn, winRate, totalTrades: trades.length,
    avgHoldingTime, maxDrawdown, finalCapital: currentCapital, trades
  };
  antiManipulationResults.manipulationEvents = manipulationEvents;
  antiManipulationResults.strategyBreakdown = strategyStats;
}

// 检测虚晃一枪
function detectFakeMove(data, index) {
  if (index < 10) return { detected: false };
  
  const current = data[index];
  const previous = data.slice(index - 5, index);
  const config = antiManipulationConfig.manipulation.fakeMove;
  
  // 计算移动幅度
  const recentHigh = Math.max(...previous.map(d => d.high));
  const recentLow = Math.min(...previous.map(d => d.low));
  const avgPrice = (recentHigh + recentLow) / 2;
  
  // 检测向上虚晃
  const upMove = (current.high - avgPrice) / avgPrice;
  if (upMove > config.minMoveSize && upMove < config.maxMoveSize) {
    // 检查影线比例
    const wickRatio = (current.high - Math.max(current.open, current.close)) / (current.high - current.low);
    if (wickRatio > config.wickRatio) {
      // 检查成交量
      const avgVolume = previous.reduce((sum, d) => sum + d.volume, 0) / previous.length;
      const volumeRatio = current.volume / avgVolume;
      
      if (volumeRatio > config.volumeSpike) {
        // 检查后续反转
        const nextCandles = data.slice(index + 1, index + 1 + config.reversalTime);
        if (nextCandles.length >= config.reversalTime) {
          const hasReversal = nextCandles.every(candle => candle.close < current.high * 0.995);
          if (hasReversal) {
            return {
              detected: true,
              type: 'UPWARD_FAKE_MOVE',
              direction: 'SHORT',
              moveSize: upMove,
              wickRatio: wickRatio,
              volumeRatio: volumeRatio,
              confidence: 0.8
            };
          }
        }
      }
    }
  }
  
  // 检测向下虚晃
  const downMove = (avgPrice - current.low) / avgPrice;
  if (downMove > config.minMoveSize && downMove < config.maxMoveSize) {
    const wickRatio = (Math.min(current.open, current.close) - current.low) / (current.high - current.low);
    if (wickRatio > config.wickRatio) {
      const avgVolume = previous.reduce((sum, d) => sum + d.volume, 0) / previous.length;
      const volumeRatio = current.volume / avgVolume;
      
      if (volumeRatio > config.volumeSpike) {
        const nextCandles = data.slice(index + 1, index + 1 + config.reversalTime);
        if (nextCandles.length >= config.reversalTime) {
          const hasReversal = nextCandles.every(candle => candle.close > current.low * 1.005);
          if (hasReversal) {
            return {
              detected: true,
              type: 'DOWNWARD_FAKE_MOVE',
              direction: 'LONG',
              moveSize: downMove,
              wickRatio: wickRatio,
              volumeRatio: volumeRatio,
              confidence: 0.8
            };
          }
        }
      }
    }
  }
  
  return { detected: false };
}

// 检测杀多杀空
function detectLiquidationHunt(data, index) {
  if (index < 5) return { detected: false };
  
  const current = data[index];
  const previous = data[index - 1];
  const config = antiManipulationConfig.manipulation.liquidationHunt;
  
  // 检测快速拉升后砸盘（杀多）
  const rapidUp = (current.high - previous.close) / previous.close;
  if (rapidUp > config.rapidMove) {
    const rapidDown = (current.high - current.close) / current.high;
    if (rapidDown > config.rapidMove * 0.8) {
      // 检查成交量爆发
      const prevVolumes = data.slice(index - 3, index).map(d => d.volume);
      const avgVolume = prevVolumes.reduce((sum, v) => sum + v, 0) / prevVolumes.length;
      const volumeRatio = current.volume / avgVolume;
      
      if (volumeRatio > config.volumeExplosion) {
        return {
          detected: true,
          type: 'KILL_LONG_LIQUIDATION',
          direction: 'SHORT',
          rapidMove: rapidUp,
          reversal: rapidDown,
          volumeRatio: volumeRatio,
          confidence: 0.85
        };
      }
    }
  }
  
  // 检测快速砸盘后拉升（杀空）
  const rapidDown = (previous.close - current.low) / previous.close;
  if (rapidDown > config.rapidMove) {
    const rapidUp = (current.close - current.low) / current.low;
    if (rapidUp > config.rapidMove * 0.8) {
      const prevVolumes = data.slice(index - 3, index).map(d => d.volume);
      const avgVolume = prevVolumes.reduce((sum, v) => sum + v, 0) / prevVolumes.length;
      const volumeRatio = current.volume / avgVolume;
      
      if (volumeRatio > config.volumeExplosion) {
        return {
          detected: true,
          type: 'KILL_SHORT_LIQUIDATION',
          direction: 'LONG',
          rapidMove: rapidDown,
          reversal: rapidUp,
          volumeRatio: volumeRatio,
          confidence: 0.85
        };
      }
    }
  }
  
  return { detected: false };
}

// 检测洗盘操作
function detectWashTrading(data, index) {
  if (index < 15) return { detected: false };
  
  const recent = data.slice(index - 10, index + 1);
  const config = antiManipulationConfig.manipulation.washTrading;
  
  const highs = recent.map(d => d.high);
  const lows = recent.map(d => d.low);
  const volumes = recent.map(d => d.volume);
  
  const rangeHigh = Math.max(...highs);
  const rangeLow = Math.min(...lows);
  const rangeSize = (rangeHigh - rangeLow) / rangeLow;
  
  // 检查是否在震荡区间内
  if (rangeSize < config.rangeSize) {
    // 检查成交量递减模式
    const earlyVolume = volumes.slice(0, 5).reduce((sum, v) => sum + v, 0) / 5;
    const lateVolume = volumes.slice(-5).reduce((sum, v) => sum + v, 0) / 5;
    const volumeDecline = (earlyVolume - lateVolume) / earlyVolume;
    
    if (volumeDecline > 0.2) { // 成交量下降20%+
      // 检查假突破
      const current = data[index];
      const fakeBreakout = Math.max(
        (current.high - rangeHigh) / rangeHigh,
        (rangeLow - current.low) / rangeLow
      );
      
      if (fakeBreakout > config.breakoutFakeout) {
        return {
          detected: true,
          type: 'WASH_TRADING',
          direction: current.high > rangeHigh ? 'SHORT' : 'LONG',
          rangeSize: rangeSize,
          volumeDecline: volumeDecline,
          fakeBreakout: fakeBreakout,
          confidence: 0.7
        };
      }
    }
  }
  
  return { detected: false };
}

// 检测插针行为
function detectWickHunt(data, index) {
  if (index < 3) return { detected: false };
  
  const current = data[index];
  const config = antiManipulationConfig.manipulation.wickHunt;
  
  const bodySize = Math.abs(current.close - current.open);
  const totalSize = current.high - current.low;
  const bodyRatio = bodySize / totalSize;
  
  // 检查实体占比
  if (bodyRatio < config.bodyRatio) {
    // 检查上影线插针
    const upperWick = current.high - Math.max(current.open, current.close);
    const upperWickRatio = upperWick / current.close;
    
    if (upperWickRatio > config.wickSize) {
      // 检查快速恢复
      const nextCandle = data[index + 1];
      if (nextCandle && nextCandle.close < current.high * 0.99) {
        return {
          detected: true,
          type: 'UPPER_WICK_HUNT',
          direction: 'SHORT',
          wickSize: upperWickRatio,
          bodyRatio: bodyRatio,
          confidence: 0.75
        };
      }
    }
    
    // 检查下影线插针
    const lowerWick = Math.min(current.open, current.close) - current.low;
    const lowerWickRatio = lowerWick / current.close;
    
    if (lowerWickRatio > config.wickSize) {
      const nextCandle = data[index + 1];
      if (nextCandle && nextCandle.close > current.low * 1.01) {
        return {
          detected: true,
          type: 'LOWER_WICK_HUNT',
          direction: 'LONG',
          wickSize: lowerWickRatio,
          bodyRatio: bodyRatio,
          confidence: 0.75
        };
      }
    }
  }
  
  return { detected: false };
}

// 开仓
function openAntiManipulationPosition(manipulation, candle, capital, index, strategy) {
  const isLong = manipulation.direction === 'LONG';
  const leverage = antiManipulationConfig.risk.leverage;
  
  const positionSize = antiManipulationConfig.risk.positionSize * manipulation.confidence;
  const tradeAmount = capital * positionSize;
  const entryPrice = candle.close;
  
  // 根据策略设置止损止盈
  const strategyConfig = antiManipulationConfig.strategy.contrarian;
  const stopLossPrice = entryPrice * (1 + (isLong ? -1 : 1) * strategyConfig.tightStop);
  const takeProfitPrice = entryPrice * (1 + (isLong ? 1 : -1) * strategyConfig.quickProfit);
  
  return {
    side: isLong ? 'LONG' : 'SHORT',
    entryPrice: entryPrice,
    entryTime: candle.timestamp,
    entryIndex: index,
    tradeAmount: tradeAmount,
    leverage: leverage,
    stopLossPrice: stopLossPrice,
    takeProfitPrice: takeProfitPrice,
    confidence: manipulation.confidence,
    strategy: strategy,
    manipulationType: manipulation.type,
    maxHoldingTime: 6 // 最多持仓6小时
  };
}

// 检查平仓
function checkAntiManipulationClose(position, currentCandle, currentIndex) {
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
function closeAntiManipulationPosition(position, closeResult) {
  const priceChange = (closeResult.price - position.entryPrice) / position.entryPrice;
  const returnRate = priceChange * (position.side === 'LONG' ? 1 : -1) * position.leverage;
  const pnl = position.tradeAmount * (returnRate - antiManipulationConfig.risk.fees * 2);
  
  return {
    side: position.side,
    entryPrice: position.entryPrice,
    exitPrice: closeResult.price,
    pnl: pnl,
    returnRate: returnRate,
    reason: closeResult.reason,
    strategy: position.strategy,
    manipulationType: position.manipulationType,
    confidence: position.confidence,
    holdingTime: (Date.now() - position.entryTime) / (1000 * 60 * 60)
  };
}

// 生成报告
async function generateAntiManipulationReport() {
  console.log('📋 生成反操控报告...');
  
  const result = antiManipulationResults.overallPerformance;
  const trades = result.trades;
  const strategyStats = antiManipulationResults.strategyBreakdown;
  
  console.log('\n📋 反操控杠杆ETH合约Agent报告');
  console.log('='.repeat(80));
  
  console.log('\n🎯 反操控策略成果:');
  console.log(`   🏆 胜率: ${(result.winRate * 100).toFixed(1)}%`);
  console.log(`   📈 总收益率: ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`   📈 年化收益率: ${(result.annualizedReturn * 100).toFixed(1)}%`);
  console.log(`   📊 总交易数: ${result.totalTrades}笔`);
  console.log(`   ⏱️ 平均持仓: ${result.avgHoldingTime.toFixed(1)}小时`);
  console.log(`   🛡️ 最大回撤: ${(result.maxDrawdown * 100).toFixed(1)}%`);
  console.log(`   💰 最终资金: $${Math.round(result.finalCapital).toLocaleString()}`);
  
  console.log('\n📊 操控策略分析:');
  Object.entries(strategyStats).forEach(([strategy, stats]) => {
    if (stats.count > 0) {
      const winRate = (stats.wins / stats.count * 100).toFixed(1);
      console.log(`   ${strategy}: ${stats.count}笔, 胜率${winRate}%, 总盈亏$${Math.round(stats.pnl)}`);
    }
  });
  
  if (trades.length > 0) {
    // 按操控类型统计
    const typeStats = {};
    trades.forEach(trade => {
      const type = trade.manipulationType || 'UNKNOWN';
      if (!typeStats[type]) {
        typeStats[type] = { count: 0, wins: 0, totalPnl: 0 };
      }
      typeStats[type].count++;
      if (trade.pnl > 0) typeStats[type].wins++;
      typeStats[type].totalPnl += trade.pnl;
    });
    
    console.log('\n📊 操控类型分析:');
    Object.entries(typeStats).forEach(([type, stats]) => {
      const winRate = stats.count > 0 ? (stats.wins / stats.count * 100).toFixed(1) : '0.0';
      console.log(`   ${type}: ${stats.count}笔, 胜率${winRate}%, 总盈亏$${Math.round(stats.totalPnl)}`);
    });
  }
  
  console.log('\n🔥 反操控洞察:');
  console.log('   • 庄家虚晃一枪是最常见的操控手法');
  console.log('   • 杀多杀空通常发生在关键价位附近');
  console.log('   • 洗盘操作多出现在趋势转换前');
  console.log('   • 插针行为专门收割散户止损单');
  console.log('   • 识别操控行为可以显著提高胜率');
  
  console.log('\n🎯 策略评估:');
  if (result.winRate > 0.6 && result.totalReturn > 0.15) {
    console.log('   🎉 卓越表现: 反操控策略非常有效');
    console.log('   评级: S+ (传奇级)');
    console.log('   评价: 强烈推荐实盘部署');
  } else if (result.winRate > 0.5 && result.totalReturn > 0.05) {
    console.log('   📈 良好表现: 反操控策略有效');
    console.log('   评级: A+ (优秀级)');
    console.log('   评价: 可考虑小资金测试');
  } else {
    console.log('   📊 需要改进: 策略需要进一步优化');
    console.log('   评级: B+ (良好级)');
    console.log('   评价: 继续完善识别算法');
  }
  
  console.log('\n💡 实战建议:');
  console.log('   🔍 重点关注: 关键支撑阻力位附近的异常行为');
  console.log('   ⚡ 快速反应: 识别到操控行为后立即反向操作');
  console.log('   🛡️ 严格止损: 操控行为可能持续，必须严格止损');
  console.log('   💰 快速止盈: 反操控利润窗口通常很短，要快速获利了结');
  
  // 保存报告
  const reportPath = path.join(__dirname, 'anti_manipulation_agent_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(antiManipulationResults, null, 2));
  console.log(`\n💾 详细报告已保存: ${reportPath}`);
}

// 运行反操控测试
runAntiManipulationTest().catch(console.error);