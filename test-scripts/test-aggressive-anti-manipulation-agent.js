#!/usr/bin/env node

/**
 * 激进反操控杠杆ETH合约Agent
 * 目标：年化收益20%+，与BTC/ETH现货投资竞争
 * 
 * 激进策略：
 * 1. 提高杠杆到3-5倍
 * 2. 增加仓位到10-15%
 * 3. 更激进的止盈目标
 * 4. 复利增长策略
 * 5. 高频交易模式
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 启动激进反操控杠杆ETH合约Agent...\n');

// 激进反操控配置
const aggressiveConfig = {
  symbol: 'ETHUSDT',
  initialCapital: 100000,
  
  // 激进杠杆策略
  leverage: {
    base: 4.0,                   // 基础4倍杠杆
    max: 6.0,                    // 最大6倍杠杆
    min: 3.0,                    // 最小3倍杠杆
    confidenceMultiplier: 1.5,   // 高置信度时增加杠杆
    volatilityAdjustment: true   // 低波动率时增加杠杆
  },
  
  // 激进仓位管理
  position: {
    baseSize: 0.12,              // 12%基础仓位
    maxSize: 0.25,               // 25%最大仓位
    confidenceBoost: 2.0,        // 高置信度2倍仓位
    winStreakBoost: 1.5,         // 连胜时增加仓位
    compoundGrowth: true         // 复利增长
  },
  
  // 激进止盈策略
  takeProfit: {
    // 虚晃一枪激进止盈
    fakeMove: {
      level1: 0.025,             // 2.5%第一止盈 (50%仓位)
      level2: 0.045,             // 4.5%第二止盈 (30%仓位)
      level3: 0.080,             // 8.0%第三止盈 (20%仓位)
      moonshot: 0.150            // 15%超级止盈
    },
    
    // 插针行为激进止盈
    wickHunt: {
      level1: 0.020,             // 2.0%第一止盈
      level2: 0.040,             // 4.0%第二止盈
      level3: 0.070,             // 7.0%第三止盈
      moonshot: 0.120            // 12%超级止盈
    },
    
    // 趋势跟踪止盈
    trendFollowing: {
      enabled: true,
      trailingDistance: 0.015,   // 1.5%移动止盈
      accelerationFactor: 0.02   // 2%加速因子
    }
  },
  
  // 精准操控识别（提高频率）
  manipulation: {
    // 放宽识别条件以增加交易频率
    fakeMove: {
      minMoveSize: 0.004,        // 降低到0.4%
      maxMoveSize: 0.040,        // 提高到4.0%
      volumeSpike: 1.8,          // 降低到1.8倍
      wickRatio: 0.55,           // 降低到55%
      confidenceThreshold: 0.65  // 降低置信度门槛
    },
    
    wickHunt: {
      minWickSize: 0.008,        // 降低到0.8%
      maxWickSize: 0.050,        // 提高到5.0%
      bodyRatio: 0.35,           // 放宽到35%
      volumeConfirmation: 1.5,   // 降低到1.5倍
      confidenceThreshold: 0.60  // 降低置信度门槛
    }
  },
  
  // 高频交易设置
  trading: {
    maxDailyTrades: 15,          // 每日最多15笔
    cooldownPeriod: 0.5,         // 0.5小时冷却期
    maxHoldingTime: 12,          // 最多持仓12小时
    minHoldingTime: 0.25,        // 最少持仓15分钟
    
    // 市场时段优化
    activeHours: {
      enabled: true,
      asiaSession: true,         // 亚洲时段
      europeSession: true,       // 欧洲时段
      usSession: true            // 美国时段
    }
  },
  
  // 风险控制（相对宽松）
  risk: {
    maxDrawdown: 0.15,           // 15%最大回撤
    stopLoss: 0.012,             // 1.2%止损
    emergencyStop: 0.25,         // 25%紧急止损
    
    // 动态风险调整
    volatilityBasedRisk: true,   // 基于波动率调整风险
    trendBasedRisk: true,        // 基于趋势调整风险
    
    fees: 0.001,
    slippage: 0.0005             // 稍高的滑点预期
  },
  
  // 复利增长策略
  compounding: {
    enabled: true,
    reinvestmentRate: 0.8,       // 80%利润再投资
    capitalGrowthTarget: 1.5,    // 资金增长1.5倍后提取部分
    riskScaling: true            // 资金增长时按比例增加风险
  }
};

// 全局变量
let realHistoricalData = [];
let aggressiveResults = {
  overallPerformance: {},
  trades: [],
  capitalGrowth: [],
  riskMetrics: {}
};

// 资金管理跟踪
let capitalTracker = {
  initialCapital: aggressiveConfig.initialCapital,
  currentCapital: aggressiveConfig.initialCapital,
  peakCapital: aggressiveConfig.initialCapital,
  reinvestedProfits: 0,
  withdrawnProfits: 0
};

// 主函数
async function runAggressiveTest() {
  console.log('📊 激进反操控杠杆ETH合约Agent测试');
  console.log('='.repeat(80));
  console.log('🎯 激进目标: 年化收益20%+，与现货投资竞争');
  console.log('🔧 激进策略: 高杠杆(3-6倍)，大仓位(12-25%)，激进止盈');
  console.log('⚡ 复利策略: 80%利润再投资，资金复利增长');
  
  // 加载数据
  await loadHistoricalData();
  
  // 激进回测
  await runAggressiveBacktest();
  
  // 生成报告
  await generateAggressiveReport();
}

// 加载历史数据
async function loadHistoricalData() {
  console.log('📊 加载真实历史数据...');
  
  const dataPath = path.join(__dirname, 'real_historical_data_2022_2024.json');
  const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  realHistoricalData = rawData;
  
  console.log(`   ✅ 数据加载完成: ${realHistoricalData.length.toLocaleString()}条K线`);
}

// 激进回测
async function runAggressiveBacktest() {
  console.log('🎯 执行激进反操控回测...');
  
  let currentCapital = aggressiveConfig.initialCapital;
  let trades = [];
  let currentPosition = null;
  let dailyTrades = 0;
  let lastTradeDay = null;
  let maxDrawdown = 0;
  let winStreak = 0;
  let lossStreak = 0;
  
  // 每15分钟检查一次（高频）
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
      const closeResult = checkAggressiveClose(currentPosition, currentCandle, i);
      if (closeResult.shouldClose) {
        const trade = closeAggressivePosition(currentPosition, closeResult, currentCapital);
        trades.push(trade);
        
        // 复利增长
        if (aggressiveConfig.compounding.enabled && trade.pnl > 0) {
          const reinvestAmount = trade.pnl * aggressiveConfig.compounding.reinvestmentRate;
          currentCapital += reinvestAmount;
          capitalTracker.reinvestedProfits += reinvestAmount;
          capitalTracker.withdrawnProfits += (trade.pnl - reinvestAmount);
        } else {
          currentCapital += trade.pnl;
        }
        
        // 更新连胜连败
        if (trade.pnl > 0) {
          winStreak++;
          lossStreak = 0;
        } else {
          lossStreak++;
          winStreak = 0;
        }
        
        currentPosition = null;
        dailyTrades++;
        
        // 更新最大回撤
        if (currentCapital > capitalTracker.peakCapital) {
          capitalTracker.peakCapital = currentCapital;
        }
        const drawdown = (capitalTracker.peakCapital - currentCapital) / capitalTracker.peakCapital;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
        
        // 检查最大回撤限制
        if (drawdown > aggressiveConfig.risk.maxDrawdown) {
          console.log(`   ⚠️ 达到最大回撤限制 ${(drawdown * 100).toFixed(1)}%，停止交易`);
          break;
        }
        
        // 记录资金增长
        if (i % 1000 === 0) {
          aggressiveResults.capitalGrowth.push({
            timestamp: currentCandle.timestamp,
            capital: currentCapital,
            growth: (currentCapital - aggressiveConfig.initialCapital) / aggressiveConfig.initialCapital,
            drawdown: drawdown
          });
        }
      }
    }
    
    // 检查开仓
    if (!currentPosition && 
        dailyTrades < aggressiveConfig.trading.maxDailyTrades &&
        isActiveTrading(currentCandle.timestamp)) {
      
      // 检测虚晃一枪（放宽条件）
      const fakeMove = detectAggressiveFakeMove(realHistoricalData, i);
      if (fakeMove.detected) {
        const leverage = calculateAggressiveLeverage(fakeMove, currentCapital);
        currentPosition = openAggressivePosition(fakeMove, currentCandle, currentCapital, leverage, i, 'fakeMove', winStreak);
      }
      
      // 检测插针行为（放宽条件）
      else {
        const wickHunt = detectAggressiveWickHunt(realHistoricalData, i);
        if (wickHunt.detected) {
          const leverage = calculateAggressiveLeverage(wickHunt, currentCapital);
          currentPosition = openAggressivePosition(wickHunt, currentCandle, currentCapital, leverage, i, 'wickHunt', winStreak);
        }
      }
    }
  }
  
  // 计算最终结果
  const totalReturn = (currentCapital - aggressiveConfig.initialCapital) / aggressiveConfig.initialCapital;
  const winRate = trades.length > 0 ? trades.filter(t => t.pnl > 0).length / trades.length : 0;
  
  // 计算年化收益率
  const days = (realHistoricalData[realHistoricalData.length - 1].timestamp - realHistoricalData[0].timestamp) / (1000 * 60 * 60 * 24);
  const annualizedReturn = days > 0 ? Math.pow(1 + totalReturn, 365 / days) - 1 : 0;
  
  // 计算复合年增长率
  const cagr = Math.pow(currentCapital / aggressiveConfig.initialCapital, 365 / days) - 1;
  
  console.log(`   ✅ 激进反操控回测完成`);
  console.log(`      📊 总交易数: ${trades.length}笔`);
  console.log(`      🏆 胜率: ${(winRate * 100).toFixed(1)}%`);
  console.log(`      📈 总收益率: ${(totalReturn * 100).toFixed(2)}%`);
  console.log(`      🚀 年化收益率: ${(annualizedReturn * 100).toFixed(1)}%`);
  console.log(`      💎 复合年增长率: ${(cagr * 100).toFixed(1)}%`);
  console.log(`      🛡️ 最大回撤: ${(maxDrawdown * 100).toFixed(1)}%`);
  console.log(`      💰 最终资金: $${Math.round(currentCapital).toLocaleString()}`);
  console.log(`      🔄 再投资利润: $${Math.round(capitalTracker.reinvestedProfits).toLocaleString()}`);
  
  aggressiveResults.overallPerformance = {
    totalReturn, annualizedReturn, cagr, winRate, 
    totalTrades: trades.length, maxDrawdown, 
    finalCapital: currentCapital, trades,
    reinvestedProfits: capitalTracker.reinvestedProfits,
    withdrawnProfits: capitalTracker.withdrawnProfits
  };
}

// 检测激进虚晃一枪
function detectAggressiveFakeMove(data, index) {
  if (index < 10) return { detected: false };
  
  const current = data[index];
  const previous = data.slice(index - 8, index);
  const config = aggressiveConfig.manipulation.fakeMove;
  
  const recentHigh = Math.max(...previous.map(d => d.high));
  const recentLow = Math.min(...previous.map(d => d.low));
  const avgPrice = (recentHigh + recentLow) / 2;
  
  // 向上虚晃（放宽条件）
  const upMove = (current.high - avgPrice) / avgPrice;
  if (upMove > config.minMoveSize && upMove < config.maxMoveSize) {
    const wickRatio = (current.high - Math.max(current.open, current.close)) / (current.high - current.low);
    if (wickRatio > config.wickRatio) {
      const avgVolume = previous.reduce((sum, d) => sum + d.volume, 0) / previous.length;
      const volumeRatio = current.volume / avgVolume;
      
      if (volumeRatio > config.volumeSpike) {
        const confidence = Math.min(0.95, 0.5 + upMove * 8 + (volumeRatio - 1.5) * 0.15);
        
        if (confidence > config.confidenceThreshold) {
          return {
            detected: true,
            type: 'AGGRESSIVE_UPWARD_FAKE_MOVE',
            direction: 'SHORT',
            moveSize: upMove,
            confidence: confidence,
            volumeRatio: volumeRatio
          };
        }
      }
    }
  }
  
  // 向下虚晃（放宽条件）
  const downMove = (avgPrice - current.low) / avgPrice;
  if (downMove > config.minMoveSize && downMove < config.maxMoveSize) {
    const wickRatio = (Math.min(current.open, current.close) - current.low) / (current.high - current.low);
    if (wickRatio > config.wickRatio) {
      const avgVolume = previous.reduce((sum, d) => sum + d.volume, 0) / previous.length;
      const volumeRatio = current.volume / avgVolume;
      
      if (volumeRatio > config.volumeSpike) {
        const confidence = Math.min(0.95, 0.5 + downMove * 8 + (volumeRatio - 1.5) * 0.15);
        
        if (confidence > config.confidenceThreshold) {
          return {
            detected: true,
            type: 'AGGRESSIVE_DOWNWARD_FAKE_MOVE',
            direction: 'LONG',
            moveSize: downMove,
            confidence: confidence,
            volumeRatio: volumeRatio
          };
        }
      }
    }
  }
  
  return { detected: false };
}

// 检测激进插针行为
function detectAggressiveWickHunt(data, index) {
  if (index < 5) return { detected: false };
  
  const current = data[index];
  const config = aggressiveConfig.manipulation.wickHunt;
  
  const bodySize = Math.abs(current.close - current.open);
  const totalSize = current.high - current.low;
  const bodyRatio = bodySize / totalSize;
  
  if (bodyRatio < config.bodyRatio) {
    const previous = data.slice(index - 3, index);
    const avgVolume = previous.reduce((sum, d) => sum + d.volume, 0) / previous.length;
    const volumeRatio = current.volume / avgVolume;
    
    if (volumeRatio > config.volumeConfirmation) {
      // 上影线插针
      const upperWick = current.high - Math.max(current.open, current.close);
      const upperWickRatio = upperWick / current.close;
      
      if (upperWickRatio > config.minWickSize && upperWickRatio < config.maxWickSize) {
        const confidence = Math.min(0.95, 0.55 + upperWickRatio * 8 + (volumeRatio - 1.2) * 0.1);
        
        if (confidence > config.confidenceThreshold) {
          return {
            detected: true,
            type: 'AGGRESSIVE_UPPER_WICK_HUNT',
            direction: 'SHORT',
            wickSize: upperWickRatio,
            confidence: confidence,
            volumeRatio: volumeRatio
          };
        }
      }
      
      // 下影线插针
      const lowerWick = Math.min(current.open, current.close) - current.low;
      const lowerWickRatio = lowerWick / current.close;
      
      if (lowerWickRatio > config.minWickSize && lowerWickRatio < config.maxWickSize) {
        const confidence = Math.min(0.95, 0.55 + lowerWickRatio * 8 + (volumeRatio - 1.2) * 0.1);
        
        if (confidence > config.confidenceThreshold) {
          return {
            detected: true,
            type: 'AGGRESSIVE_LOWER_WICK_HUNT',
            direction: 'LONG',
            wickSize: lowerWickRatio,
            confidence: confidence,
            volumeRatio: volumeRatio
          };
        }
      }
    }
  }
  
  return { detected: false };
}

// 计算激进杠杆
function calculateAggressiveLeverage(signal, currentCapital) {
  const config = aggressiveConfig.leverage;
  let leverage = config.base;
  
  // 基于置信度调整
  if (signal.confidence > 0.8) {
    leverage += config.confidenceMultiplier;
  }
  
  // 基于资金增长调整
  const capitalGrowth = currentCapital / aggressiveConfig.initialCapital;
  if (capitalGrowth > 1.2) {
    leverage += 0.5; // 资金增长20%后增加杠杆
  }
  
  return Math.max(config.min, Math.min(config.max, leverage));
}

// 激进开仓
function openAggressivePosition(signal, candle, capital, leverage, index, strategy, winStreak) {
  const isLong = signal.direction === 'LONG';
  
  // 激进仓位计算
  let positionSize = aggressiveConfig.position.baseSize;
  
  // 高置信度增加仓位
  if (signal.confidence > 0.8) {
    positionSize *= aggressiveConfig.position.confidenceBoost;
  }
  
  // 连胜时增加仓位
  if (winStreak >= 3) {
    positionSize *= aggressiveConfig.position.winStreakBoost;
  }
  
  positionSize = Math.min(positionSize, aggressiveConfig.position.maxSize);
  
  const tradeAmount = capital * positionSize;
  const entryPrice = candle.close;
  
  // 激进止损止盈
  const stopLossPrice = entryPrice * (1 + (isLong ? -1 : 1) * aggressiveConfig.risk.stopLoss);
  
  // 分层激进止盈
  const takeProfitConfig = strategy === 'fakeMove' ? 
    aggressiveConfig.takeProfit.fakeMove : 
    aggressiveConfig.takeProfit.wickHunt;
  
  return {
    side: isLong ? 'LONG' : 'SHORT',
    entryPrice: entryPrice,
    entryTime: candle.timestamp,
    entryIndex: index,
    tradeAmount: tradeAmount,
    leverage: leverage,
    positionSize: positionSize,
    stopLossPrice: stopLossPrice,
    takeProfitLevels: [
      entryPrice * (1 + (isLong ? 1 : -1) * takeProfitConfig.level1),
      entryPrice * (1 + (isLong ? 1 : -1) * takeProfitConfig.level2),
      entryPrice * (1 + (isLong ? 1 : -1) * takeProfitConfig.level3),
      entryPrice * (1 + (isLong ? 1 : -1) * takeProfitConfig.moonshot)
    ],
    trailingStopPrice: stopLossPrice,
    confidence: signal.confidence,
    strategy: strategy,
    remainingSize: 1.0,
    maxHoldingTime: aggressiveConfig.trading.maxHoldingTime
  };
}

// 检查激进平仓
function checkAggressiveClose(position, currentCandle, currentIndex) {
  const isLong = position.side === 'LONG';
  const currentPrice = currentCandle.close;
  const holdingTime = (currentIndex - position.entryIndex) * 0.25;
  
  // 更新移动止盈
  if (aggressiveConfig.takeProfit.trendFollowing.enabled) {
    const profitRate = (currentPrice - position.entryPrice) / position.entryPrice * (isLong ? 1 : -1);
    
    if (profitRate > 0.02) { // 盈利2%后启动移动止盈
      const trailingDistance = aggressiveConfig.takeProfit.trendFollowing.trailingDistance;
      
      if (isLong) {
        const newTrailingStop = currentPrice * (1 - trailingDistance);
        if (newTrailingStop > position.trailingStopPrice) {
          position.trailingStopPrice = newTrailingStop;
        }
      } else {
        const newTrailingStop = currentPrice * (1 + trailingDistance);
        if (newTrailingStop < position.trailingStopPrice) {
          position.trailingStopPrice = newTrailingStop;
        }
      }
    }
  }
  
  // 检查分层止盈
  for (let i = 0; i < position.takeProfitLevels.length; i++) {
    const level = position.takeProfitLevels[i];
    if ((isLong && currentPrice >= level) || (!isLong && currentPrice <= level)) {
      const closePercentages = [0.5, 0.3, 0.15, 0.05]; // 分层平仓比例
      return {
        shouldClose: true,
        reason: `AGGRESSIVE_TAKE_PROFIT_L${i + 1}`,
        price: level,
        partialClose: i < 3,
        closePercentage: closePercentages[i]
      };
    }
  }
  
  // 检查移动止盈
  if ((isLong && currentPrice <= position.trailingStopPrice && currentPrice > position.entryPrice) ||
      (!isLong && currentPrice >= position.trailingStopPrice && currentPrice < position.entryPrice)) {
    return {
      shouldClose: true,
      reason: 'TRAILING_PROFIT',
      price: position.trailingStopPrice
    };
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

// 激进平仓
function closeAggressivePosition(position, closeResult, currentCapital) {
  const priceChange = (closeResult.price - position.entryPrice) / position.entryPrice;
  const returnRate = priceChange * (position.side === 'LONG' ? 1 : -1) * position.leverage;
  
  // 计算平仓比例
  let closePercentage = 1.0;
  if (closeResult.partialClose && closeResult.closePercentage) {
    closePercentage = closeResult.closePercentage;
    position.remainingSize -= closePercentage;
  } else {
    position.remainingSize = 0;
  }
  
  const effectiveTradeAmount = position.tradeAmount * closePercentage;
  const pnl = effectiveTradeAmount * (returnRate - aggressiveConfig.risk.fees * 2);
  
  return {
    side: position.side,
    entryPrice: position.entryPrice,
    exitPrice: closeResult.price,
    pnl: pnl,
    returnRate: returnRate,
    reason: closeResult.reason,
    strategy: position.strategy,
    confidence: position.confidence,
    leverage: position.leverage,
    positionSize: position.positionSize,
    closePercentage: closePercentage,
    holdingTime: (Date.now() - position.entryTime) / (1000 * 60 * 60)
  };
}

// 检查是否在活跃交易时段
function isActiveTrading(timestamp) {
  if (!aggressiveConfig.trading.activeHours.enabled) return true;
  
  const hour = new Date(timestamp).getUTCHours();
  
  // 亚洲时段 (00:00-08:00 UTC)
  if (aggressiveConfig.trading.activeHours.asiaSession && hour >= 0 && hour < 8) return true;
  
  // 欧洲时段 (08:00-16:00 UTC)  
  if (aggressiveConfig.trading.activeHours.europeSession && hour >= 8 && hour < 16) return true;
  
  // 美国时段 (16:00-24:00 UTC)
  if (aggressiveConfig.trading.activeHours.usSession && hour >= 16 && hour < 24) return true;
  
  return false;
}

// 生成激进报告
async function generateAggressiveReport() {
  console.log('📋 生成激进反操控报告...');
  
  const result = aggressiveResults.overallPerformance;
  
  console.log('\n📋 激进反操控杠杆ETH合约Agent报告');
  console.log('='.repeat(80));
  
  console.log('\n🎯 激进策略成果:');
  console.log(`   🏆 胜率: ${(result.winRate * 100).toFixed(1)}%`);
  console.log(`   📈 总收益率: ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`   🚀 年化收益率: ${(result.annualizedReturn * 100).toFixed(1)}%`);
  console.log(`   💎 复合年增长率: ${(result.cagr * 100).toFixed(1)}%`);
  console.log(`   📊 总交易数: ${result.totalTrades}笔`);
  console.log(`   🛡️ 最大回撤: ${(result.maxDrawdown * 100).toFixed(1)}%`);
  console.log(`   💰 最终资金: $${Math.round(result.finalCapital).toLocaleString()}`);
  console.log(`   🔄 再投资利润: $${Math.round(result.reinvestedProfits).toLocaleString()}`);
  
  console.log('\n📊 与现货投资对比:');
  console.log(`   合约年化收益: ${(result.annualizedReturn * 100).toFixed(1)}%`);
  console.log(`   BTC历史年化: ~100% (2020-2024平均)`);
  console.log(`   ETH历史年化: ~150% (2020-2024平均)`);
  
  if (result.annualizedReturn > 0.20) {
    console.log('   🎉 超越现货: 合约策略年化收益超过20%，具备竞争力！');
  } else if (result.annualizedReturn > 0.15) {
    console.log('   📈 接近现货: 合约策略表现良好，接近现货收益');
  } else {
    console.log('   📊 低于现货: 合约策略收益仍低于现货投资');
  }
  
  console.log('\n🎯 策略评估:');
  if (result.annualizedReturn > 0.25) {
    console.log('   🚀 传奇表现: 年化收益25%+，远超现货');
    console.log('   评级: SS (传奇级)');
    console.log('   评价: 强烈推荐，具备极强竞争力');
  } else if (result.annualizedReturn > 0.20) {
    console.log('   🔥 卓越表现: 年化收益20%+，与现货竞争');
    console.log('   评级: S+ (传奇级)');
    console.log('   评价: 推荐部署，具备竞争优势');
  } else if (result.annualizedReturn > 0.15) {
    console.log('   📈 优秀表现: 年化收益15%+，接近现货');
    console.log('   评级: S (卓越级)');
    console.log('   评价: 可考虑部署');
  } else {
    console.log('   📊 需要改进: 年化收益不足15%');
    console.log('   评级: A (良好级)');
    console.log('   评价: 继续优化');
  }
  
  console.log('\n💡 激进策略优势:');
  console.log('   🔥 高杠杆效应: 3-6倍杠杆放大收益');
  console.log('   💰 大仓位策略: 12-25%仓位最大化利润');
  console.log('   🎯 激进止盈: 分层止盈最高15%');
  console.log('   🔄 复利增长: 80%利润再投资');
  console.log('   ⚡ 高频交易: 每日最多15笔交易');
  
  // 保存报告
  const reportPath = path.join(__dirname, 'aggressive_anti_manipulation_agent_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(aggressiveResults, null, 2));
  console.log(`\n💾 详细报告已保存: ${reportPath}`);
}

// 运行激进测试
runAggressiveTest().catch(console.error);