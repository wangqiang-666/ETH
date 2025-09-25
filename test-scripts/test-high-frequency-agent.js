#!/usr/bin/env node

/**
 * 高频交易ETH合约Agent
 * 目标：每天多次交易 + 高盈亏比
 * 
 * 核心策略：
 * 1. 高频率：每天5-15笔交易
 * 2. 高盈亏比：目标2.0+
 * 3. 快进快出：持仓时间1-4小时
 * 4. 多策略并行：捕捉更多机会
 * 5. 智能风控：严格控制单笔风险
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 启动高频交易ETH合约Agent...\n');

// 高频交易配置
const highFrequencyConfig = {
  symbol: 'ETHUSDT',
  initialCapital: 100000,
  
  // 高频目标
  highFrequencyGoals: {
    dailyTrades: 8,               // 每日目标8笔交易
    targetProfitFactor: 2.0,      // 目标盈亏比2.0
    targetWinRate: 0.42,          // 目标胜率42%
    maxDrawdown: 0.04,            // 最大回撤4%
    targetAnnualReturn: 0.15,     // 目标年化收益15%
    avgHoldingTime: 2.5           // 平均持仓2.5小时
  },
  
  // 高频策略组合
  highFrequencyStrategies: {
    // 快速反操控（高频版）
    rapidAntiManipulation: {
      enabled: true,
      weight: 0.3,
      minConfidence: 0.65,
      
      quickFakeBreakout: {
        minSize: 0.006,           // 降低最小突破要求
        maxSize: 0.020,           
        volumeSpike: 1.6,         // 降低成交量要求
        wickRatio: 0.50,          
        quickConfirm: 1,          // 快速确认
        rapidEntry: true          // 快速入场
      },
      
      fastWickHunt: {
        minWick: 0.008,           
        maxWick: 0.025,           
        bodyRatio: 0.35,          
        volumeConfirm: 1.4,       
        instantReaction: true,    // 即时反应
        speedBonus: 0.1           // 速度奖励
      }
    },
    
    // 动量捕捉（高频版）
    momentumCapture: {
      enabled: true,
      weight: 0.25,
      minConfidence: 0.62,
      
      quickMomentum: {
        minMomentum: 0.008,       // 降低动量要求
        timeWindow: 5,            // 5分钟时间窗口
        volumeBoost: 1.4,         
        rapidFollow: true,        // 快速跟随
        momentumDecay: 0.9        // 动量衰减
      },
      
      breakoutMomentum: {
        minBreakout: 0.005,       
        confirmPeriod: 2,         // 2分钟确认
        volumeThreshold: 1.3,     
        quickProfit: 0.015,       // 快速止盈1.5%
        fastStop: 0.008           // 快速止损0.8%
      }
    },
    
    // 波动率剥头皮
    volatilityScalping: {
      enabled: true,
      weight: 0.25,
      minConfidence: 0.60,
      
      quickScalp: {
        volThreshold: 1.5,        // 降低波动率阈值
        priceRange: 0.004,        // 0.4%价格区间
        quickEntry: 0.002,        // 0.2%快速入场
        rapidExit: 0.008,         // 0.8%快速退出
        scalpTime: 0.5            // 30分钟剥头皮
      },
      
      rangeScalping: {
        rangeSize: 0.008,         
        bounceStrength: 0.6,      
        quickTurn: true,          // 快速转向
        multiEntry: true,         // 多次入场
        scalpProfit: 0.006        // 0.6%剥头皮利润
      }
    },
    
    // 新闻/事件驱动（高频版）
    eventDriven: {
      enabled: true,
      weight: 0.2,
      minConfidence: 0.68,
      
      priceShock: {
        minShock: 0.008,          // 0.8%价格冲击
        volumeExplosion: 2.0,     
        reactionTime: 1,          // 1分钟反应时间
        followThrough: true,      // 跟进
        shockFade: 0.85           // 冲击衰减
      },
      
      liquidationCascade: {
        cascadeDetection: true,   
        liquidationVolume: 1.8,   
        cascadeFollow: true,      // 跟随瀑布
        quickReverse: true,       // 快速反转
        cascadeProfit: 0.012      // 瀑布利润
      }
    }
  },
  
  // 高频止盈止损策略
  highFrequencyExit: {
    // 快速止盈系统
    rapidTakeProfit: {
      // 分层快速止盈
      quickLayers: {
        layer1: { profit: 0.012, size: 0.4, time: 0.5 },  // 1.2%止盈40%仓位，30分钟内
        layer2: { profit: 0.025, size: 0.4, time: 1.5 },  // 2.5%止盈40%仓位，1.5小时内
        layer3: { profit: 0.045, size: 0.2, time: 3.0 },  // 4.5%止盈20%仓位，3小时内
      },
      
      // 动态快速止盈
      dynamicQuickExit: {
        momentumFade: 0.8,        // 动量衰减退出
        volumeDrop: 0.6,          // 成交量下降退出
        timeDecay: true,          // 时间衰减
        profitLock: 0.008         // 0.8%利润锁定
      }
    },
    
    // 紧密止损系统
    tightStopLoss: {
      // 快速止损
      rapidStopLoss: {
        initial: 0.008,           // 0.8%初始止损
        trailing: 0.005,          // 0.5%移动止损
        activation: 0.008,        // 0.8%激活点
        tightening: 0.002         // 0.2%收紧
      },
      
      // 时间止损
      timeBasedStop: {
        maxTime: 4,               // 最大4小时
        profitTime: 2,            // 盈利2小时
        lossTime: 1,              // 亏损1小时
        breakEvenTime: 3          // 盈亏平衡3小时
      }
    }
  },
  
  // 高频风险管理
  highFrequencyRisk: {
    // 快速仓位管理
    rapidPositioning: {
      baseSize: 0.04,             // 4%基础仓位
      maxSize: 0.08,              // 8%最大仓位
      minSize: 0.02,              // 2%最小仓位
      
      // 高频调整
      frequencyAdjust: true,
      confidenceScale: 0.5,       // 置信度缩放
      momentumBoost: 0.3,         // 动量增强
      volatilityReduce: 0.2       // 波动率减少
    },
    
    // 高频杠杆
    highFrequencyLeverage: {
      base: 2.5,                  // 基础2.5倍杠杆
      max: 4.0,                   // 最大4倍
      min: 1.8,                   // 最小1.8倍
      
      // 快速调整
      rapidAdjust: true,
      volatilityScale: 0.6,
      momentumScale: 0.4,
      timeScale: 0.3              // 时间缩放
    },
    
    // 高频限制
    frequencyLimits: {
      maxDailyTrades: 20,         // 每日最多20笔
      maxHourlyTrades: 3,         // 每小时最多3笔
      minInterval: 10,            // 最小间隔10分钟
      burstLimit: 3,              // 连续交易限制3笔
      burstCooldown: 1,           // 连续交易冷却1小时
      dailyLossLimit: 0.03        // 每日亏损限制3%
    }
  },
  
  // 高频市场环境
  highFrequencyMarket: {
    // 快速环境识别
    rapidRegimeDetection: {
      detectionPeriod: 20,        // 20分钟检测周期
      volatilityWindow: 15,       // 15分钟波动率窗口
      trendWindow: 30,            // 30分钟趋势窗口
      volumeWindow: 10            // 10分钟成交量窗口
    },
    
    // 环境适应
    regimeAdaptation: {
      highVol: { 
        leverage: 2.0, position: 0.03, 
        takeProfit: 0.015, stopLoss: 0.006,
        frequency: 1.5, holding: 1.5 
      },
      trending: { 
        leverage: 3.0, position: 0.06, 
        takeProfit: 0.030, stopLoss: 0.010,
        frequency: 1.0, holding: 2.5 
      },
      sideways: { 
        leverage: 2.5, position: 0.04, 
        takeProfit: 0.020, stopLoss: 0.008,
        frequency: 1.2, holding: 2.0 
      },
      lowVol: { 
        leverage: 2.8, position: 0.05, 
        takeProfit: 0.025, stopLoss: 0.009,
        frequency: 0.8, holding: 3.0 
      }
    }
  }
};

// 全局变量
let realHistoricalData = [];
let highFrequencyResults = {
  overallPerformance: {},
  trades: [],
  frequencyMetrics: {},
  highFrequencyAnalysis: {}
};

// 高频系统状态
let hfSystemState = {
  currentRegime: 'sideways',
  dailyTradeCount: 0,
  hourlyTradeCount: 0,
  burstTradeCount: 0,
  lastTradeTime: 0,
  lastHourStart: 0,
  lastBurstTime: 0,
  dailyPnL: 0,
  dailyStartCapital: 0,
  consecutiveWins: 0,
  consecutiveLosses: 0,
  totalTrades: 0,
  avgHoldingTime: 0,
  experienceLoaded: false
};

// 主函数
async function runHighFrequencyTest() {
  console.log('📊 高频交易ETH合约Agent测试');
  console.log('='.repeat(80));
  console.log('🎯 高频目标: 每日8笔+, 盈亏比2.0+, 快进快出');
  console.log('⚡ 交易特点: 1-4小时持仓, 多策略并行');
  console.log('🛡️ 风控重点: 严控单笔风险, 快速止损止盈');
  
  // 加载数据
  await loadHistoricalData();
  
  // 高频交易回测
  await runHighFrequencyBacktest();
  
  // 生成高频分析报告
  await generateHighFrequencyReport();
}

// 加载历史数据
async function loadHistoricalData() {
  console.log('📊 加载真实历史数据...');
  
  const dataPath = path.join(__dirname, 'real_historical_data_2022_2024.json');
  const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  realHistoricalData = rawData;
  
  console.log(`   ✅ 数据加载完成: ${realHistoricalData.length.toLocaleString()}条K线`);
}

// 高频交易回测
async function runHighFrequencyBacktest() {
  console.log('🎯 执行高频交易回测...');
  
  let currentCapital = highFrequencyConfig.initialCapital;
  let trades = [];
  let currentPosition = null;
  let maxDrawdown = 0;
  let peakCapital = currentCapital;
  let dailyReturns = [];
  
  let lastDay = null;
  let lastHour = null;
  let holdingTimes = [];
  
  // 策略统计
  let strategyStats = {};
  Object.keys(highFrequencyConfig.highFrequencyStrategies).forEach(strategy => {
    strategyStats[strategy] = { trades: 0, wins: 0, pnl: 0, avgHolding: 0 };
  });
  
  // 每15分钟检查一次（高频检查）
  for (let i = 30; i < realHistoricalData.length - 5; i++) {
    const currentCandle = realHistoricalData[i];
    const currentDay = new Date(currentCandle.timestamp).toDateString();
    const currentHour = new Date(currentCandle.timestamp).getHours();
    
    // 每日重置
    if (lastDay && lastDay !== currentDay) {
      const dailyReturn = (currentCapital - hfSystemState.dailyStartCapital) / hfSystemState.dailyStartCapital;
      dailyReturns.push(dailyReturn);
      
      hfSystemState.dailyPnL = currentCapital - hfSystemState.dailyStartCapital;
      hfSystemState.dailyStartCapital = currentCapital;
      hfSystemState.dailyTradeCount = 0;
      
      console.log(`   📅 日交易: ${hfSystemState.dailyTradeCount}笔, 日收益: ${(hfSystemState.dailyPnL / hfSystemState.dailyStartCapital * 100).toFixed(2)}%`);
    }
    lastDay = currentDay;
    
    // 每小时重置
    if (lastHour !== currentHour) {
      hfSystemState.hourlyTradeCount = 0;
      hfSystemState.lastHourStart = currentCandle.timestamp;
    }
    lastHour = currentHour;
    
    // 更新市场环境（高频）
    updateHighFrequencyMarketRegime(realHistoricalData, i);
    
    // 检查平仓
    if (currentPosition) {
      const closeResult = checkHighFrequencyClose(currentPosition, currentCandle, i);
      if (closeResult.shouldClose) {
        const trade = closeHighFrequencyPosition(currentPosition, closeResult);
        trades.push(trade);
        currentCapital += trade.pnl;
        
        // 记录持仓时间
        holdingTimes.push(trade.holdingTime);
        
        // 更新系统状态
        updateHighFrequencySystemState(trade);
        
        // 更新策略统计
        updateStrategyStats(strategyStats, trade);
        
        currentPosition = null;
        hfSystemState.lastTradeTime = currentCandle.timestamp;
        
        // 更新最大回撤
        if (currentCapital > peakCapital) {
          peakCapital = currentCapital;
        }
        const drawdown = (peakCapital - currentCapital) / peakCapital;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
        
        // 每日亏损限制
        const dailyLoss = (hfSystemState.dailyStartCapital - currentCapital) / hfSystemState.dailyStartCapital;
        if (dailyLoss > highFrequencyConfig.highFrequencyRisk.frequencyLimits.dailyLossLimit) {
          console.log(`   🚨 达到每日亏损限制 ${(dailyLoss * 100).toFixed(1)}%，暂停当日交易`);
          // 跳到下一天
          while (i < realHistoricalData.length - 1 && 
                 new Date(realHistoricalData[i].timestamp).toDateString() === currentDay) {
            i++;
          }
          continue;
        }
        
        // 风险控制检查
        if (drawdown > highFrequencyConfig.highFrequencyGoals.maxDrawdown) {
          console.log(`   🚨 达到最大回撤限制 ${(drawdown * 100).toFixed(1)}%`);
          break;
        }
      }
    }
    
    // 检查开仓
    if (!currentPosition && passHighFrequencyFilters(currentCandle.timestamp)) {
      
      // 生成高频信号
      const signal = generateHighFrequencySignal(realHistoricalData, i);
      
      if (signal && signal.confidence >= getHighFrequencyMinConfidence()) {
        const leverage = calculateHighFrequencyLeverage(signal);
        const positionSize = calculateHighFrequencyPositionSize(signal, currentCapital, peakCapital);
        
        currentPosition = openHighFrequencyPosition(signal, currentCandle, currentCapital, leverage, positionSize, i);
        
        hfSystemState.dailyTradeCount++;
        hfSystemState.hourlyTradeCount++;
        hfSystemState.burstTradeCount++;
        
        // 检查连续交易限制
        if (hfSystemState.burstTradeCount >= highFrequencyConfig.highFrequencyRisk.frequencyLimits.burstLimit) {
          hfSystemState.lastBurstTime = currentCandle.timestamp;
          hfSystemState.burstTradeCount = 0;
        }
      }
    }
  }
  
  // 计算最终结果
  const totalReturn = (currentCapital - highFrequencyConfig.initialCapital) / highFrequencyConfig.initialCapital;
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
  const sharpeRatio = annualizedVol > 0 ? (annualizedReturn - 0.05) / annualizedVol : 0;
  
  // 计算高频指标
  const tradingDays = days / 365 * 252;
  const tradesPerDay = trades.length / tradingDays;
  const avgHoldingTime = holdingTimes.length > 0 ? holdingTimes.reduce((sum, t) => sum + t, 0) / holdingTimes.length : 0;
  
  console.log(`   ✅ 高频交易回测完成`);
  console.log(`      📊 总交易数: ${trades.length}笔`);
  console.log(`      🏆 胜率: ${(winRate * 100).toFixed(1)}%`);
  console.log(`      📈 总收益率: ${(totalReturn * 100).toFixed(2)}%`);
  console.log(`      🚀 年化收益率: ${(annualizedReturn * 100).toFixed(1)}%`);
  console.log(`      💰 盈亏比: ${profitFactor.toFixed(2)}`);
  console.log(`      📊 Sharpe Ratio: ${sharpeRatio.toFixed(2)}`);
  console.log(`      🛡️ 最大回撤: ${(maxDrawdown * 100).toFixed(1)}%`);
  console.log(`      📈 年化波动率: ${(annualizedVol * 100).toFixed(1)}%`);
  console.log(`      ⚡ 日均交易: ${tradesPerDay.toFixed(1)}笔`);
  console.log(`      ⏱️ 平均持仓: ${avgHoldingTime.toFixed(1)}小时`);
  console.log(`      💰 最终资金: $${Math.round(currentCapital).toLocaleString()}`);
  
  highFrequencyResults.overallPerformance = {
    totalReturn, annualizedReturn, winRate, profitFactor,
    totalTrades: trades.length, maxDrawdown, finalCapital: currentCapital,
    trades, avgWin, avgLoss, sharpeRatio, annualizedVol, 
    tradesPerDay, avgHoldingTime
  };
  
  highFrequencyResults.frequencyMetrics = {
    totalTrades: trades.length,
    tradesPerDay: tradesPerDay,
    avgHoldingTime: avgHoldingTime,
    tradingDays: tradingDays,
    dailyTarget: highFrequencyConfig.highFrequencyGoals.dailyTrades,
    frequencyAchieved: tradesPerDay >= highFrequencyConfig.highFrequencyGoals.dailyTrades * 0.8
  };
}

// 更新高频市场环境
function updateHighFrequencyMarketRegime(data, index) {
  if (index < 20) return;
  
  const recent = data.slice(index - 20, index + 1);
  const prices = recent.map(d => d.close);
  const volumes = recent.map(d => d.volume);
  
  // 快速计算波动率和趋势
  const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
  const volatility = calculateVolatility(returns);
  const trendStrength = calculateTrendStrength(prices);
  
  // 快速环境判断
  let newRegime = 'sideways';
  if (volatility > 0.025) {
    newRegime = 'highVol';
  } else if (Math.abs(trendStrength) > 0.008) {
    newRegime = 'trending';
  } else if (volatility < 0.010) {
    newRegime = 'lowVol';
  }
  
  if (newRegime !== hfSystemState.currentRegime) {
    hfSystemState.currentRegime = newRegime;
    console.log(`   ⚡ 快速环境切换: ${newRegime}`);
  }
}

// 生成高频信号
function generateHighFrequencySignal(data, index) {
  const signals = [];
  
  // 快速反操控信号
  if (highFrequencyConfig.highFrequencyStrategies.rapidAntiManipulation.enabled) {
    const rapidSignal = generateRapidAntiManipulationSignal(data, index);
    if (rapidSignal.detected) {
      signals.push({
        ...rapidSignal,
        strategy: 'rapidAntiManipulation',
        weight: highFrequencyConfig.highFrequencyStrategies.rapidAntiManipulation.weight
      });
    }
  }
  
  // 动量捕捉信号
  if (highFrequencyConfig.highFrequencyStrategies.momentumCapture.enabled) {
    const momentumSignal = generateMomentumCaptureSignal(data, index);
    if (momentumSignal.detected) {
      signals.push({
        ...momentumSignal,
        strategy: 'momentumCapture',
        weight: highFrequencyConfig.highFrequencyStrategies.momentumCapture.weight
      });
    }
  }
  
  // 波动率剥头皮信号
  if (highFrequencyConfig.highFrequencyStrategies.volatilityScalping.enabled) {
    const scalpSignal = generateVolatilityScalpingSignal(data, index);
    if (scalpSignal.detected) {
      signals.push({
        ...scalpSignal,
        strategy: 'volatilityScalping',
        weight: highFrequencyConfig.highFrequencyStrategies.volatilityScalping.weight
      });
    }
  }
  
  // 事件驱动信号
  if (highFrequencyConfig.highFrequencyStrategies.eventDriven.enabled) {
    const eventSignal = generateEventDrivenSignal(data, index);
    if (eventSignal.detected) {
      signals.push({
        ...eventSignal,
        strategy: 'eventDriven',
        weight: highFrequencyConfig.highFrequencyStrategies.eventDriven.weight
      });
    }
  }
  
  // 选择最优高频信号
  return selectHighFrequencySignal(signals);
}

// 生成快速反操控信号
function generateRapidAntiManipulationSignal(data, index) {
  if (index < 15) return { detected: false };
  
  const config = highFrequencyConfig.highFrequencyStrategies.rapidAntiManipulation;
  const current = data[index];
  const previous = data.slice(index - 10, index);
  
  const highs = previous.map(d => d.high);
  const lows = previous.map(d => d.low);
  const volumes = previous.map(d => d.volume);
  
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
  
  // 快速假突破检测
  const upBreakout = (current.high - resistance) / resistance;
  const downBreakout = (support - current.low) / support;
  
  if (upBreakout > config.quickFakeBreakout.minSize && upBreakout < config.quickFakeBreakout.maxSize) {
    const wickRatio = (current.high - Math.max(current.open, current.close)) / (current.high - current.low);
    const volumeRatio = current.volume / avgVolume;
    
    if (wickRatio > config.quickFakeBreakout.wickRatio && volumeRatio > config.quickFakeBreakout.volumeSpike) {
      const confidence = Math.min(0.85, 0.60 + upBreakout * 12 + (volumeRatio - 1.3) * 0.08);
      
      if (confidence > config.minConfidence) {
        return {
          detected: true,
          direction: 'SHORT',
          confidence: confidence,
          type: 'rapidFakeBreakout',
          urgency: 'high',
          expectedReturn: 0.018,
          expectedTime: 1.5
        };
      }
    }
  }
  
  if (downBreakout > config.quickFakeBreakout.minSize && downBreakout < config.quickFakeBreakout.maxSize) {
    const wickRatio = (Math.min(current.open, current.close) - current.low) / (current.high - current.low);
    const volumeRatio = current.volume / avgVolume;
    
    if (wickRatio > config.quickFakeBreakout.wickRatio && volumeRatio > config.quickFakeBreakout.volumeSpike) {
      const confidence = Math.min(0.85, 0.60 + downBreakout * 12 + (volumeRatio - 1.3) * 0.08);
      
      if (confidence > config.minConfidence) {
        return {
          detected: true,
          direction: 'LONG',
          confidence: confidence,
          type: 'rapidFakeBreakout',
          urgency: 'high',
          expectedReturn: 0.018,
          expectedTime: 1.5
        };
      }
    }
  }
  
  return { detected: false };
}

// 生成动量捕捉信号
function generateMomentumCaptureSignal(data, index) {
  if (index < 10) return { detected: false };
  
  const config = highFrequencyConfig.highFrequencyStrategies.momentumCapture;
  const recent = data.slice(index - 5, index + 1);
  const prices = recent.map(d => d.close);
  const volumes = recent.map(d => d.volume);
  
  // 快速动量计算
  const momentum = (prices[prices.length - 1] - prices[0]) / prices[0];
  const recentVolume = volumes.slice(-2).reduce((sum, v) => sum + v, 0) / 2;
  const historicalVolume = volumes.slice(0, -2).reduce((sum, v) => sum + v, 0) / (volumes.length - 2);
  const volumeBoost = recentVolume / historicalVolume;
  
  if (Math.abs(momentum) > config.quickMomentum.minMomentum && volumeBoost > config.quickMomentum.volumeBoost) {
    const confidence = Math.min(0.82, 0.58 + Math.abs(momentum) * 15 + (volumeBoost - 1.2) * 0.1);
    
    if (confidence > config.minConfidence) {
      return {
        detected: true,
        direction: momentum > 0 ? 'LONG' : 'SHORT',
        confidence: confidence,
        type: 'quickMomentum',
        urgency: 'medium',
        expectedReturn: 0.022,
        expectedTime: 2.0
      };
    }
  }
  
  return { detected: false };
}

// 生成波动率剥头皮信号
function generateVolatilityScalpingSignal(data, index) {
  if (index < 8) return { detected: false };
  
  const config = highFrequencyConfig.highFrequencyStrategies.volatilityScalping;
  const recent = data.slice(index - 5, index + 1);
  const prices = recent.map(d => d.close);
  
  // 快速波动率检测
  const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
  const volatility = calculateVolatility(returns);
  
  if (volatility > 0.015) { // 1.5%波动率
    const currentPrice = prices[prices.length - 1];
    const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const deviation = (currentPrice - avgPrice) / avgPrice;
    
    if (Math.abs(deviation) > 0.003) { // 0.3%偏离
      const confidence = Math.min(0.78, 0.55 + volatility * 8 + Math.abs(deviation) * 15);
      
      if (confidence > config.minConfidence) {
        return {
          detected: true,
          direction: deviation > 0 ? 'SHORT' : 'LONG', // 均值回归
          confidence: confidence,
          type: 'quickScalp',
          urgency: 'high',
          expectedReturn: 0.012,
          expectedTime: 0.8
        };
      }
    }
  }
  
  return { detected: false };
}

// 生成事件驱动信号
function generateEventDrivenSignal(data, index) {
  if (index < 5) return { detected: false };
  
  const config = highFrequencyConfig.highFrequencyStrategies.eventDriven;
  const current = data[index];
  const previous = data.slice(index - 3, index);
  
  const avgPrice = previous.reduce((sum, d) => sum + d.close, 0) / previous.length;
  const avgVolume = previous.reduce((sum, d) => sum + d.volume, 0) / previous.length;
  
  // 价格冲击检测
  const priceShock = Math.abs(current.close - avgPrice) / avgPrice;
  const volumeExplosion = current.volume / avgVolume;
  
  if (priceShock > config.priceShock.minShock && volumeExplosion > config.priceShock.volumeExplosion) {
    const confidence = Math.min(0.88, 0.62 + priceShock * 8 + (volumeExplosion - 1.8) * 0.06);
    
    if (confidence > config.minConfidence) {
      return {
        detected: true,
        direction: current.close > avgPrice ? 'LONG' : 'SHORT',
        confidence: confidence,
        type: 'priceShock',
        urgency: 'very_high',
        expectedReturn: 0.015,
        expectedTime: 1.0
      };
    }
  }
  
  return { detected: false };
}

// 选择高频信号
function selectHighFrequencySignal(signals) {
  if (signals.length === 0) return null;
  
  // 按紧急程度和置信度排序
  const urgencyWeight = { very_high: 1.3, high: 1.1, medium: 1.0, low: 0.8 };
  
  let bestSignal = null;
  let bestScore = 0;
  
  signals.forEach(signal => {
    const urgencyBonus = urgencyWeight[signal.urgency] || 1.0;
    const score = signal.confidence * signal.weight * urgencyBonus;
    
    if (score > bestScore) {
      bestScore = score;
      bestSignal = signal;
    }
  });
  
  return bestSignal;
}

// 获取高频最小置信度
function getHighFrequencyMinConfidence() {
  // 根据交易频率动态调整
  let minConfidence = 0.60;
  
  if (hfSystemState.dailyTradeCount >= 15) {
    minConfidence = 0.70; // 交易过多时提高要求
  } else if (hfSystemState.dailyTradeCount < 3) {
    minConfidence = 0.55; // 交易过少时降低要求
  }
  
  return minConfidence;
}

// 计算高频杠杆
function calculateHighFrequencyLeverage(signal) {
  const regimeConfig = highFrequencyConfig.highFrequencyMarket.regimeAdaptation[hfSystemState.currentRegime];
  let leverage = regimeConfig ? regimeConfig.leverage : highFrequencyConfig.highFrequencyRisk.highFrequencyLeverage.base;
  
  // 基于紧急程度调整
  const urgencyMultiplier = { very_high: 1.2, high: 1.1, medium: 1.0, low: 0.9 };
  leverage *= (urgencyMultiplier[signal.urgency] || 1.0);
  
  // 基于置信度调整
  leverage *= (0.8 + signal.confidence * 0.4);
  
  const leverageConfig = highFrequencyConfig.highFrequencyRisk.highFrequencyLeverage;
  return Math.max(leverageConfig.min, Math.min(leverageConfig.max, leverage));
}

// 计算高频仓位
function calculateHighFrequencyPositionSize(signal, currentCapital, peakCapital) {
  const regimeConfig = highFrequencyConfig.highFrequencyMarket.regimeAdaptation[hfSystemState.currentRegime];
  let positionSize = regimeConfig ? regimeConfig.position : highFrequencyConfig.highFrequencyRisk.rapidPositioning.baseSize;
  
  // 基于信号质量调整
  positionSize *= signal.confidence;
  
  // 基于预期收益调整
  positionSize *= (0.8 + signal.expectedReturn * 5);
  
  // 基于连胜连败调整
  if (hfSystemState.consecutiveWins > 3) {
    positionSize *= 1.1;
  } else if (hfSystemState.consecutiveLosses > 2) {
    positionSize *= 0.8;
  }
  
  const sizeConfig = highFrequencyConfig.highFrequencyRisk.rapidPositioning;
  return Math.max(sizeConfig.minSize, Math.min(sizeConfig.maxSize, positionSize));
}

// 检查高频过滤器
function passHighFrequencyFilters(currentTime) {
  const limits = highFrequencyConfig.highFrequencyRisk.frequencyLimits;
  
  // 每日交易限制
  if (hfSystemState.dailyTradeCount >= limits.maxDailyTrades) {
    return false;
  }
  
  // 每小时交易限制
  if (hfSystemState.hourlyTradeCount >= limits.maxHourlyTrades) {
    return false;
  }
  
  // 最小间隔
  if (currentTime - hfSystemState.lastTradeTime < limits.minInterval * 60 * 1000) {
    return false;
  }
  
  // 连续交易冷却
  if (hfSystemState.burstTradeCount >= limits.burstLimit) {
    if (currentTime - hfSystemState.lastBurstTime < limits.burstCooldown * 60 * 60 * 1000) {
      return false;
    }
  }
  
  return true;
}

// 开仓
function openHighFrequencyPosition(signal, candle, capital, leverage, positionSize, index) {
  const isLong = signal.direction === 'LONG';
  const tradeAmount = capital * positionSize;
  const entryPrice = candle.close;
  
  // 高频止损止盈
  const regimeConfig = highFrequencyConfig.highFrequencyMarket.regimeAdaptation[hfSystemState.currentRegime];
  const takeProfitConfig = highFrequencyConfig.highFrequencyExit.rapidTakeProfit.quickLayers;
  const stopLossConfig = highFrequencyConfig.highFrequencyExit.tightStopLoss.rapidStopLoss;
  
  // 根据信号类型调整
  let takeProfitMultiplier = 1.0;
  let stopLossMultiplier = 1.0;
  
  if (signal.type === 'quickScalp') {
    takeProfitMultiplier = 0.6;
    stopLossMultiplier = 0.7;
  } else if (signal.type === 'priceShock') {
    takeProfitMultiplier = 0.8;
    stopLossMultiplier = 0.8;
  }
  
  const stopLossPrice = entryPrice * (1 + (isLong ? -1 : 1) * stopLossConfig.initial * stopLossMultiplier);
  const takeProfitPrices = [
    entryPrice * (1 + (isLong ? 1 : -1) * takeProfitConfig.layer1.profit * takeProfitMultiplier),
    entryPrice * (1 + (isLong ? 1 : -1) * takeProfitConfig.layer2.profit * takeProfitMultiplier),
    entryPrice * (1 + (isLong ? 1 : -1) * takeProfitConfig.layer3.profit * takeProfitMultiplier)
  ];
  
  const takeProfitSizes = [
    takeProfitConfig.layer1.size,
    takeProfitConfig.layer2.size,
    takeProfitConfig.layer3.size
  ];
  
  const takeProfitTimes = [
    takeProfitConfig.layer1.time,
    takeProfitConfig.layer2.time,
    takeProfitConfig.layer3.time
  ];
  
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
    takeProfitSizes: takeProfitSizes,
    takeProfitTimes: takeProfitTimes,
    trailingStopPrice: stopLossPrice,
    confidence: signal.confidence,
    strategy: signal.strategy,
    signalType: signal.type,
    urgency: signal.urgency,
    expectedReturn: signal.expectedReturn,
    expectedTime: signal.expectedTime,
    maxHoldingTime: regimeConfig ? regimeConfig.holding : 4,
    remainingSize: 1.0
  };
}

// 检查高频平仓
function checkHighFrequencyClose(position, currentCandle, currentIndex) {
  const isLong = position.side === 'LONG';
  const currentPrice = currentCandle.close;
  const holdingTime = (currentIndex - position.entryIndex) * 0.25;
  const profitRate = (currentPrice - position.entryPrice) / position.entryPrice * (isLong ? 1 : -1);
  
  // 更新移动止损
  if (profitRate > 0.01) {
    const trailingDistance = highFrequencyConfig.highFrequencyExit.tightStopLoss.rapidStopLoss.trailing;
    
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
  
  // 检查分层止盈（带时间限制）
  for (let i = 0; i < position.takeProfitPrices.length; i++) {
    const tpPrice = position.takeProfitPrices[i];
    const tpTime = position.takeProfitTimes[i];
    
    if (((isLong && currentPrice >= tpPrice) || (!isLong && currentPrice <= tpPrice)) &&
        holdingTime <= tpTime) {
      return {
        shouldClose: true,
        reason: `QUICK_PROFIT_${i + 1}`,
        price: tpPrice,
        partialClose: i < 2,
        closePercentage: position.takeProfitSizes[i]
      };
    }
  }
  
  // 检查移动止损
  if ((isLong && currentPrice <= position.trailingStopPrice) ||
      (!isLong && currentPrice >= position.trailingStopPrice)) {
    return {
      shouldClose: true,
      reason: 'TRAILING_STOP',
      price: position.trailingStopPrice
    };
  }
  
  // 检查固定止损
  if ((isLong && currentPrice <= position.stopLossPrice) ||
      (!isLong && currentPrice >= position.stopLossPrice)) {
    return {
      shouldClose: true,
      reason: 'STOP_LOSS',
      price: position.stopLossPrice
    };
  }
  
  // 时间止损（高频特有）
  const timeConfig = highFrequencyConfig.highFrequencyExit.tightStopLoss.timeBasedStop;
  
  if (profitRate > 0.005 && holdingTime >= timeConfig.profitTime) {
    return {
      shouldClose: true,
      reason: 'TIME_PROFIT',
      price: currentPrice
    };
  }
  
  if (profitRate < -0.005 && holdingTime >= timeConfig.lossTime) {
    return {
      shouldClose: true,
      reason: 'TIME_LOSS',
      price: currentPrice
    };
  }
  
  // 最大持仓时间
  if (holdingTime >= position.maxHoldingTime) {
    return {
      shouldClose: true,
      reason: 'MAX_TIME',
      price: currentPrice
    };
  }
  
  return { shouldClose: false };
}

// 平仓
function closeHighFrequencyPosition(position, closeResult) {
  const priceChange = (closeResult.price - position.entryPrice) / position.entryPrice;
  const returnRate = priceChange * (position.side === 'LONG' ? 1 : -1) * position.leverage;
  
  let closePercentage = 1.0;
  if (closeResult.partialClose && closeResult.closePercentage) {
    closePercentage = closeResult.closePercentage;
    position.remainingSize -= closePercentage;
  } else {
    position.remainingSize = 0;
  }
  
  const effectiveTradeAmount = position.tradeAmount * closePercentage;
  const pnl = effectiveTradeAmount * (returnRate - 0.002);
  
  return {
    side: position.side,
    entryPrice: position.entryPrice,
    exitPrice: closeResult.price,
    pnl: pnl,
    returnRate: returnRate,
    reason: closeResult.reason,
    strategy: position.strategy,
    signalType: position.signalType,
    urgency: position.urgency,
    confidence: position.confidence,
    expectedReturn: position.expectedReturn,
    actualReturn: returnRate,
    leverage: position.leverage,
    positionSize: position.positionSize,
    holdingTime: (Date.now() - position.entryTime) / (1000 * 60 * 60)
  };
}

// 辅助函数
function updateHighFrequencySystemState(trade) {
  if (trade.pnl > 0) {
    hfSystemState.consecutiveWins++;
    hfSystemState.consecutiveLosses = 0;
  } else {
    hfSystemState.consecutiveLosses++;
    hfSystemState.consecutiveWins = 0;
  }
  
  hfSystemState.totalTrades++;
  hfSystemState.avgHoldingTime = (hfSystemState.avgHoldingTime * (hfSystemState.totalTrades - 1) + trade.holdingTime) / hfSystemState.totalTrades;
}

function updateStrategyStats(strategyStats, trade) {
  const strategy = trade.strategy;
  if (strategyStats[strategy]) {
    strategyStats[strategy].trades++;
    strategyStats[strategy].pnl += trade.pnl;
    strategyStats[strategy].avgHolding = (strategyStats[strategy].avgHolding * (strategyStats[strategy].trades - 1) + trade.holdingTime) / strategyStats[strategy].trades;
    
    if (trade.pnl > 0) {
      strategyStats[strategy].wins++;
    }
  }
}

function calculateTrendStrength(prices) {
  if (prices.length < 5) return 0;
  const linearRegression = calculateLinearRegression(prices);
  return linearRegression.slope / (prices[prices.length - 1] / prices.length);
}

function calculateLinearRegression(prices) {
  const n = prices.length;
  const x = Array.from({length: n}, (_, i) => i);
  const y = prices;
  
  const sumX = x.reduce((sum, val) => sum + val, 0);
  const sumY = y.reduce((sum, val) => sum + val, 0);
  const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
  const sumXX = x.reduce((sum, val) => sum + val * val, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  return { slope, intercept };
}

function calculateVolatility(returns) {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  return Math.sqrt(variance);
}

// 生成高频交易报告
async function generateHighFrequencyReport() {
  console.log('📋 生成高频交易报告...');
  
  const result = highFrequencyResults.overallPerformance;
  const frequency = highFrequencyResults.frequencyMetrics;
  
  console.log('\n📋 高频交易ETH合约Agent报告');
  console.log('='.repeat(80));
  
  console.log('\n🎯 高频交易成果:');
  console.log(`   🏆 胜率: ${(result.winRate * 100).toFixed(1)}%`);
  console.log(`   📈 总收益率: ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`   🚀 年化收益率: ${(result.annualizedReturn * 100).toFixed(1)}%`);
  console.log(`   💰 盈亏比: ${result.profitFactor.toFixed(2)}`);
  console.log(`   📊 Sharpe Ratio: ${result.sharpeRatio.toFixed(2)}`);
  console.log(`   🛡️ 最大回撤: ${(result.maxDrawdown * 100).toFixed(1)}%`);
  console.log(`   📈 年化波动率: ${(result.annualizedVol * 100).toFixed(1)}%`);
  console.log(`   📊 总交易数: ${result.totalTrades}笔`);
  console.log(`   ⚡ 日均交易: ${result.tradesPerDay.toFixed(1)}笔`);
  console.log(`   ⏱️ 平均持仓: ${result.avgHoldingTime.toFixed(1)}小时`);
  console.log(`   💰 最终资金: $${Math.round(result.finalCapital).toLocaleString()}`);
  
  console.log('\n⚡ 高频特性分析:');
  console.log(`   🎯 目标日交易: ${frequency.dailyTarget}笔`);
  console.log(`   ✅ 实际日交易: ${frequency.tradesPerDay.toFixed(1)}笔`);
  console.log(`   📈 频率达成: ${frequency.frequencyAchieved ? '是' : '否'}`);
  console.log(`   ⏱️ 持仓时间: ${frequency.avgHoldingTime.toFixed(1)}小时`);
  console.log(`   📅 交易天数: ${frequency.tradingDays.toFixed(0)}天`);
  console.log(`   🚀 交易效率: ${(frequency.totalTrades / frequency.tradingDays).toFixed(2)}笔/天`);
  
  console.log('\n🎯 高频交易评估:');
  if (result.annualizedReturn >= 0.12 && result.profitFactor >= 2.0 && frequency.tradesPerDay >= 6) {
    console.log('   🏆 卓越表现: 完美的高频交易系统');
    console.log('   评级: SS (高频大师级)');
    console.log('   评价: 高频率 + 高盈亏比的理想组合');
  } else if (result.annualizedReturn >= 0.08 && result.profitFactor >= 1.8 && frequency.tradesPerDay >= 4) {
    console.log('   🔥 优秀表现: 优秀的高频交易效果');
    console.log('   评级: S+ (准高频大师级)');
    console.log('   评价: 接近理想的高频交易状态');
  } else if (result.totalReturn > 0 && frequency.tradesPerDay >= 2) {
    console.log('   📈 良好表现: 高频策略有效');
    console.log('   评级: S (优秀级)');
    console.log('   评价: 高频交易方向正确');
  } else {
    console.log('   📊 继续优化: 高频效果待提升');
    console.log('   评级: A+ (良好级)');
    console.log('   评价: 需要进一步高频优化');
  }
  
  console.log('\n🔥 高频交易优势:');
  console.log('   ⚡ 高频率交易 - 每天多次交易机会');
  console.log('   💰 高盈亏比策略 - 追求2.0+盈亏比');
  console.log('   🚀 快进快出 - 1-4小时持仓时间');
  console.log('   🎯 多策略并行 - 捕捉更多市场机会');
  console.log('   🛡️ 严格风控 - 快速止损止盈机制');
  
  // 保存报告
  const reportPath = path.join(__dirname, 'high_frequency_agent_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(highFrequencyResults, null, 2));
  console.log(`\n💾 详细报告已保存: ${reportPath}`);
}

// 运行高频交易测试
runHighFrequencyTest().catch(console.error);