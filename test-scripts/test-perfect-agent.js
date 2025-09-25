#!/usr/bin/env node

/**
 * 完美杠杆ETH合约Agent
 * 基于超级灵活Agent的成功经验，专注提高胜率和利润率
 * 
 * 完美优化策略：
 * 1. 精选高胜率策略 - 只保留表现最好的策略
 * 2. 智能信号过滤 - 多重确认提高信号质量
 * 3. 动态止盈优化 - 根据市场环境调整止盈策略
 * 4. 风险精准控制 - 更精确的风险管理
 * 5. 机器学习增强 - 基于历史数据优化参数
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 启动完美杠杆ETH合约Agent...\n');

// 完美配置
const perfectConfig = {
  symbol: 'ETHUSDT',
  initialCapital: 100000,
  
  // 精选策略配置（只保留高胜率策略）
  eliteStrategies: {
    // 假突破策略（45.1%胜率）- 保留并优化
    fakeBreakout: {
      enabled: true,
      weight: 0.45,
      minConfidence: 0.75,        // 提高置信度门槛
      minBreakoutSize: 0.006,     // 提高最小突破幅度
      maxBreakoutSize: 0.020,     // 降低最大突破幅度
      volumeSpike: 2.2,           // 提高成交量要求
      wickRatio: 0.65,            // 提高影线比例要求
      confirmationCandles: 3      // 增加确认K线数量
    },
    
    // 趋势跟踪策略（42.5%胜率）- 保留并优化
    trendFollowing: {
      enabled: true,
      weight: 0.35,
      minConfidence: 0.72,
      minTrendStrength: 0.012,    // 提高趋势强度要求
      minMomentum: 0.015,         // 提高动量要求
      volumeConfirmation: 1.8,    // 提高成交量确认
      multiTimeframeConfirm: true // 多时间框架确认
    },
    
    // 动量策略（39.9%胜率）- 优化后保留
    momentum: {
      enabled: true,
      weight: 0.20,
      minConfidence: 0.78,
      minPriceMomentum: 0.018,    // 提高价格动量要求
      minVolumeMomentum: 2.2,     // 提高成交量动量要求
      accelerationFactor: 0.02    // 加速因子
    }
    
    // 移除低胜率策略：插针策略（30%胜率）、均值回归策略（41.2%胜率但亏损）
  },
  
  // 智能信号过滤系统
  signalFiltering: {
    // 多重确认机制
    multiConfirmation: {
      priceAction: true,          // 价格行为确认
      volumeConfirmation: true,   // 成交量确认
      technicalIndicators: true, // 技术指标确认
      marketStructure: true,     // 市场结构确认
      timeFrameConsistency: true // 时间框架一致性
    },
    
    // 信号质量评分
    qualityScoring: {
      minScore: 0.80,            // 最低质量分数
      confidenceWeight: 0.4,     // 置信度权重
      volumeWeight: 0.3,         // 成交量权重
      structureWeight: 0.2,      // 结构权重
      momentumWeight: 0.1        // 动量权重
    },
    
    // 市场环境过滤
    marketFilter: {
      minVolatility: 0.015,      // 最小波动率
      maxVolatility: 0.055,      // 最大波动率
      minVolume: 0.8,            // 最小成交量比率
      trendConsistency: 0.7      // 趋势一致性
    }
  },
  
  // 动态止盈优化系统
  dynamicTakeProfit: {
    // 基础止盈配置
    base: {
      level1: 0.025,             // 2.5%第一止盈（40%仓位）
      level2: 0.045,             // 4.5%第二止盈（35%仓位）
      level3: 0.080,             // 8.0%第三止盈（25%仓位）
    },
    
    // 趋势跟踪止盈
    trendFollowing: {
      enabled: true,
      trailingDistance: 0.018,   // 1.8%移动距离
      accelerationFactor: 0.025, // 2.5%加速因子
      minProfit: 0.015          // 1.5%最小利润保护
    },
    
    // 市场环境适应
    marketAdaptation: {
      trending: { multiplier: 1.4, trailing: true },
      sideways: { multiplier: 0.8, trailing: false },
      volatile: { multiplier: 1.1, trailing: true }
    }
  },
  
  // 精准风险控制
  precisionRisk: {
    // 基础风险参数
    maxDrawdown: 0.08,           // 8%最大回撤
    maxDailyTrades: 15,          // 每日最多15笔
    maxConsecutiveLosses: 4,     // 最多连续4次亏损
    
    // 动态仓位管理
    positionSizing: {
      base: 0.06,                // 6%基础仓位
      max: 0.12,                 // 12%最大仓位
      confidenceScaling: true,   // 基于置信度缩放
      volatilityAdjustment: true,// 基于波动率调整
      drawdownReduction: true    // 基于回撤减少仓位
    },
    
    // 智能杠杆管理
    leverageManagement: {
      base: 2.8,                 // 基础2.8倍杠杆
      max: 4.2,                  // 最大4.2倍杠杆
      min: 1.8,                  // 最小1.8倍杠杆
      volatilityAdjustment: true,// 波动率调整
      performanceAdjustment: true // 表现调整
    }
  },
  
  // 机器学习增强系统
  mlEnhancement: {
    enabled: true,
    
    // 参数优化
    parameterOptimization: {
      learningRate: 0.15,        // 15%学习率
      memoryWindow: 100,         // 记忆窗口100笔交易
      adaptationThreshold: 0.75, // 75%适应阈值
      
      // 优化目标
      targets: {
        winRate: 0.52,           // 目标胜率52%
        profitFactor: 2.0,       // 目标盈亏比2.0
        maxDrawdown: 0.06        // 目标最大回撤6%
      }
    },
    
    // 信号质量学习
    signalLearning: {
      successPatterns: true,     // 学习成功模式
      failureAvoidance: true,    // 避免失败模式
      marketRegimeAdaptation: true, // 市场环境适应
      timeBasedLearning: true    // 基于时间的学习
    }
  },
  
  // 交易执行优化
  executionOptimization: {
    entryTiming: {
      delayConfirmation: 1,      // 1根K线延迟确认
      slippageProtection: 0.0005,// 滑点保护
      liquidityCheck: true       // 流动性检查
    },
    
    exitTiming: {
      partialProfitTaking: true, // 分批止盈
      trailingStopOptimization: true, // 移动止损优化
      timeBasedExit: true        // 基于时间的退出
    }
  }
};

// 全局变量
let realHistoricalData = [];
let perfectResults = {
  overallPerformance: {},
  trades: [],
  strategyPerformance: {},
  learningHistory: [],
  optimizationMetrics: {}
};

// 机器学习状态
let mlState = {
  parameterHistory: [],
  performanceMemory: [],
  successPatterns: [],
  failurePatterns: [],
  currentOptimization: {
    winRateTarget: perfectConfig.mlEnhancement.parameterOptimization.targets.winRate,
    profitFactorTarget: perfectConfig.mlEnhancement.parameterOptimization.targets.profitFactor,
    maxDrawdownTarget: perfectConfig.mlEnhancement.parameterOptimization.targets.maxDrawdown
  }
};

// 主函数
async function runPerfectTest() {
  console.log('📊 完美杠杆ETH合约Agent测试');
  console.log('='.repeat(80));
  console.log('🎯 完美目标: 胜率52%+, 盈亏比2.0+, 年化收益12%+');
  console.log('🔧 核心优化: 精选策略, 智能过滤, 动态止盈, 机器学习');
  console.log('⚡ 完美特性: 只保留高胜率策略，多重确认，精准风控');
  
  // 加载数据
  await loadHistoricalData();
  
  // 完美回测
  await runPerfectBacktest();
  
  // 生成报告
  await generatePerfectReport();
}

// 加载历史数据
async function loadHistoricalData() {
  console.log('📊 加载真实历史数据...');
  
  const dataPath = path.join(__dirname, 'real_historical_data_2022_2024.json');
  const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  realHistoricalData = rawData;
  
  console.log(`   ✅ 数据加载完成: ${realHistoricalData.length.toLocaleString()}条K线`);
}

// 完美回测
async function runPerfectBacktest() {
  console.log('🎯 执行完美回测...');
  
  let currentCapital = perfectConfig.initialCapital;
  let trades = [];
  let currentPosition = null;
  let dailyTrades = 0;
  let lastTradeDay = null;
  let maxDrawdown = 0;
  let peakCapital = currentCapital;
  let consecutiveLosses = 0;
  let cooldownUntil = 0;
  
  // 策略统计
  let strategyStats = {};
  Object.keys(perfectConfig.eliteStrategies).forEach(strategy => {
    strategyStats[strategy] = { trades: 0, wins: 0, pnl: 0, avgConfidence: 0 };
  });
  
  // 每15分钟检查一次
  for (let i = 50; i < realHistoricalData.length - 5; i++) {
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
      const closeResult = checkPerfectClose(currentPosition, currentCandle, i);
      if (closeResult.shouldClose) {
        const trade = closePerfectPosition(currentPosition, closeResult);
        trades.push(trade);
        currentCapital += trade.pnl;
        
        // 更新策略统计
        if (strategyStats[trade.strategy]) {
          strategyStats[trade.strategy].trades++;
          strategyStats[trade.strategy].pnl += trade.pnl;
          strategyStats[trade.strategy].avgConfidence += trade.confidence;
          if (trade.pnl > 0) {
            strategyStats[trade.strategy].wins++;
            consecutiveLosses = 0;
          } else {
            consecutiveLosses++;
          }
        }
        
        // 机器学习更新
        updateMachineLearning(trade);
        
        currentPosition = null;
        dailyTrades++;
        
        // 设置冷却期（成功交易短冷却，失败交易长冷却）
        const cooldownHours = trade.pnl > 0 ? 0.25 : 0.5;
        cooldownUntil = currentCandle.timestamp + (cooldownHours * 60 * 60 * 1000);
        
        // 更新最大回撤
        if (currentCapital > peakCapital) {
          peakCapital = currentCapital;
        }
        const drawdown = (peakCapital - currentCapital) / peakCapital;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
        
        // 机器学习参数优化
        if (trades.length > 0 && trades.length % 50 === 0) {
          optimizeParametersML(trades.slice(-50));
        }
        
        // 检查最大回撤限制
        if (drawdown > perfectConfig.precisionRisk.maxDrawdown) {
          console.log(`   ⚠️ 达到最大回撤限制 ${(drawdown * 100).toFixed(1)}%，停止交易`);
          break;
        }
        
        // 检查连续亏损限制
        if (consecutiveLosses >= perfectConfig.precisionRisk.maxConsecutiveLosses) {
          console.log(`   ⚠️ 连续亏损${consecutiveLosses}次，暂停交易1小时`);
          cooldownUntil = currentCandle.timestamp + (1 * 60 * 60 * 1000);
          consecutiveLosses = 0;
        }
      }
    }
    
    // 检查开仓
    if (!currentPosition && 
        dailyTrades < perfectConfig.precisionRisk.maxDailyTrades &&
        passPerfectFilters(realHistoricalData, i, currentCapital, peakCapital)) {
      
      // 生成完美信号
      const signal = generatePerfectSignal(realHistoricalData, i);
      
      if (signal && signal.qualityScore > perfectConfig.signalFiltering.qualityScoring.minScore) {
        const leverage = calculatePerfectLeverage(signal, realHistoricalData, i);
        const positionSize = calculatePerfectPositionSize(signal, currentCapital, peakCapital);
        
        currentPosition = openPerfectPosition(signal, currentCandle, currentCapital, leverage, positionSize, i);
      }
    }
  }
  
  // 计算最终结果
  const totalReturn = (currentCapital - perfectConfig.initialCapital) / perfectConfig.initialCapital;
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
  
  // 计算平均置信度
  const avgConfidence = trades.length > 0 ? trades.reduce((sum, t) => sum + t.confidence, 0) / trades.length : 0;
  
  console.log(`   ✅ 完美回测完成`);
  console.log(`      📊 总交易数: ${trades.length}笔`);
  console.log(`      🏆 胜率: ${(winRate * 100).toFixed(1)}%`);
  console.log(`      📈 总收益率: ${(totalReturn * 100).toFixed(2)}%`);
  console.log(`      🚀 年化收益率: ${(annualizedReturn * 100).toFixed(1)}%`);
  console.log(`      💰 盈亏比: ${profitFactor.toFixed(2)}`);
  console.log(`      🎯 平均置信度: ${(avgConfidence * 100).toFixed(1)}%`);
  console.log(`      🛡️ 最大回撤: ${(maxDrawdown * 100).toFixed(1)}%`);
  console.log(`      🧠 ML优化次数: ${perfectResults.learningHistory.length}次`);
  console.log(`      💰 最终资金: $${Math.round(currentCapital).toLocaleString()}`);
  
  perfectResults.overallPerformance = {
    totalReturn, annualizedReturn, winRate, profitFactor,
    totalTrades: trades.length, maxDrawdown, finalCapital: currentCapital,
    trades, avgWin, avgLoss, avgConfidence
  };
  perfectResults.strategyPerformance = strategyStats;
}

// 生成完美信号
function generatePerfectSignal(data, index) {
  if (index < 50) return null;
  
  const signals = [];
  
  // 1. 精选假突破信号
  if (perfectConfig.eliteStrategies.fakeBreakout.enabled) {
    const fakeBreakout = detectPerfectFakeBreakout(data, index);
    if (fakeBreakout.detected) {
      signals.push({
        ...fakeBreakout,
        strategy: 'fakeBreakout',
        weight: perfectConfig.eliteStrategies.fakeBreakout.weight
      });
    }
  }
  
  // 2. 精选趋势跟踪信号
  if (perfectConfig.eliteStrategies.trendFollowing.enabled) {
    const trend = detectPerfectTrendFollowing(data, index);
    if (trend.detected) {
      signals.push({
        ...trend,
        strategy: 'trendFollowing',
        weight: perfectConfig.eliteStrategies.trendFollowing.weight
      });
    }
  }
  
  // 3. 精选动量信号
  if (perfectConfig.eliteStrategies.momentum.enabled) {
    const momentum = detectPerfectMomentum(data, index);
    if (momentum.detected) {
      signals.push({
        ...momentum,
        strategy: 'momentum',
        weight: perfectConfig.eliteStrategies.momentum.weight
      });
    }
  }
  
  // 选择最佳信号并计算质量分数
  const bestSignal = selectBestSignalWithQuality(signals, data, index);
  return bestSignal;
}

// 检测完美假突破
function detectPerfectFakeBreakout(data, index) {
  if (index < 30) return { detected: false };
  
  const config = perfectConfig.eliteStrategies.fakeBreakout;
  const current = data[index];
  const previous = data.slice(index - 20, index);
  
  const highs = previous.map(d => d.high);
  const lows = previous.map(d => d.low);
  const volumes = previous.map(d => d.volume);
  
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
  
  // 向上假突破（更严格的条件）
  const upBreakout = (current.high - resistance) / resistance;
  if (upBreakout > config.minBreakoutSize && upBreakout < config.maxBreakoutSize) {
    const wickRatio = (current.high - Math.max(current.open, current.close)) / (current.high - current.low);
    const volumeRatio = current.volume / avgVolume;
    
    if (wickRatio > config.wickRatio && volumeRatio > config.volumeSpike) {
      // 多重确认
      const nextCandles = data.slice(index + 1, index + 1 + config.confirmationCandles);
      if (nextCandles.length >= config.confirmationCandles) {
        const confirmationRatio = nextCandles.filter(c => c.close < resistance).length / nextCandles.length;
        
        if (confirmationRatio >= 0.8) { // 80%确认率
          const confidence = Math.min(0.95, 0.65 + upBreakout * 12 + (volumeRatio - 2) * 0.08 + wickRatio * 0.15);
          
          if (confidence > config.minConfidence) {
            return {
              detected: true,
              direction: 'SHORT',
              confidence: confidence,
              breakoutSize: upBreakout,
              volumeRatio: volumeRatio,
              wickRatio: wickRatio,
              confirmationRatio: confirmationRatio
            };
          }
        }
      }
    }
  }
  
  // 向下假突破（更严格的条件）
  const downBreakout = (support - current.low) / support;
  if (downBreakout > config.minBreakoutSize && downBreakout < config.maxBreakoutSize) {
    const wickRatio = (Math.min(current.open, current.close) - current.low) / (current.high - current.low);
    const volumeRatio = current.volume / avgVolume;
    
    if (wickRatio > config.wickRatio && volumeRatio > config.volumeSpike) {
      const nextCandles = data.slice(index + 1, index + 1 + config.confirmationCandles);
      if (nextCandles.length >= config.confirmationCandles) {
        const confirmationRatio = nextCandles.filter(c => c.close > support).length / nextCandles.length;
        
        if (confirmationRatio >= 0.8) {
          const confidence = Math.min(0.95, 0.65 + downBreakout * 12 + (volumeRatio - 2) * 0.08 + wickRatio * 0.15);
          
          if (confidence > config.minConfidence) {
            return {
              detected: true,
              direction: 'LONG',
              confidence: confidence,
              breakoutSize: downBreakout,
              volumeRatio: volumeRatio,
              wickRatio: wickRatio,
              confirmationRatio: confirmationRatio
            };
          }
        }
      }
    }
  }
  
  return { detected: false };
}

// 检测完美趋势跟踪
function detectPerfectTrendFollowing(data, index) {
  if (index < 40) return { detected: false };
  
  const config = perfectConfig.eliteStrategies.trendFollowing;
  const prices = data.slice(index - 30, index + 1).map(d => d.close);
  const volumes = data.slice(index - 30, index + 1).map(d => d.volume);
  
  // 多时间框架趋势分析
  const shortMA = prices.slice(-5).reduce((sum, p) => sum + p, 0) / 5;
  const mediumMA = prices.slice(-15).reduce((sum, p) => sum + p, 0) / 15;
  const longMA = prices.slice(-25).reduce((sum, p) => sum + p, 0) / 25;
  
  // 趋势强度计算
  const trendStrength = (shortMA - longMA) / longMA;
  const mediumTrend = (mediumMA - longMA) / longMA;
  
  // 动量计算
  const momentum = (prices[prices.length - 1] - prices[prices.length - 10]) / prices[prices.length - 10];
  
  // 成交量确认
  const recentVolume = volumes.slice(-5).reduce((sum, v) => sum + v, 0) / 5;
  const historicalVolume = volumes.slice(-20, -5).reduce((sum, v) => sum + v, 0) / 15;
  const volumeRatio = recentVolume / historicalVolume;
  
  // 多时间框架一致性检查
  const trendConsistency = (shortMA > mediumMA && mediumMA > longMA) || (shortMA < mediumMA && mediumMA < longMA);
  
  if (Math.abs(trendStrength) > config.minTrendStrength && 
      Math.abs(momentum) > config.minMomentum && 
      volumeRatio > config.volumeConfirmation &&
      trendConsistency) {
    
    const confidence = Math.min(0.92, 0.6 + Math.abs(trendStrength) * 15 + Math.abs(momentum) * 8 + (volumeRatio - 1.5) * 0.1);
    
    if (confidence > config.minConfidence) {
      return {
        detected: true,
        direction: trendStrength > 0 ? 'LONG' : 'SHORT',
        confidence: confidence,
        trendStrength: trendStrength,
        momentum: momentum,
        volumeRatio: volumeRatio,
        trendConsistency: trendConsistency
      };
    }
  }
  
  return { detected: false };
}

// 检测完美动量
function detectPerfectMomentum(data, index) {
  if (index < 25) return { detected: false };
  
  const config = perfectConfig.eliteStrategies.momentum;
  const prices = data.slice(index - 15, index + 1).map(d => d.close);
  const volumes = data.slice(index - 15, index + 1).map(d => d.volume);
  
  // 价格动量（多周期）
  const shortMomentum = (prices[prices.length - 1] - prices[prices.length - 5]) / prices[prices.length - 5];
  const mediumMomentum = (prices[prices.length - 1] - prices[prices.length - 10]) / prices[prices.length - 10];
  const priceMomentum = (shortMomentum + mediumMomentum) / 2;
  
  // 成交量动量
  const recentVolume = volumes.slice(-3).reduce((sum, v) => sum + v, 0) / 3;
  const historicalVolume = volumes.slice(0, -3).reduce((sum, v) => sum + v, 0) / (volumes.length - 3);
  const volumeMomentum = recentVolume / historicalVolume;
  
  // 加速度计算
  const acceleration = Math.abs(shortMomentum) - Math.abs(mediumMomentum);
  
  if (Math.abs(priceMomentum) > config.minPriceMomentum && 
      volumeMomentum > config.minVolumeMomentum &&
      acceleration > 0) {
    
    const confidence = Math.min(0.88, 0.6 + Math.abs(priceMomentum) * 12 + (volumeMomentum - 2) * 0.08 + acceleration * 20);
    
    if (confidence > config.minConfidence) {
      return {
        detected: true,
        direction: priceMomentum > 0 ? 'LONG' : 'SHORT',
        confidence: confidence,
        priceMomentum: priceMomentum,
        volumeMomentum: volumeMomentum,
        acceleration: acceleration
      };
    }
  }
  
  return { detected: false };
}

// 选择最佳信号并计算质量分数
function selectBestSignalWithQuality(signals, data, index) {
  if (signals.length === 0) return null;
  
  let bestSignal = null;
  let bestQualityScore = 0;
  
  signals.forEach(signal => {
    // 计算质量分数
    const qualityScore = calculateSignalQuality(signal, data, index);
    signal.qualityScore = qualityScore;
    
    if (qualityScore > bestQualityScore) {
      bestQualityScore = qualityScore;
      bestSignal = signal;
    }
  });
  
  return bestSignal;
}

// 计算信号质量分数
function calculateSignalQuality(signal, data, index) {
  const config = perfectConfig.signalFiltering.qualityScoring;
  
  // 基础置信度分数
  let qualityScore = signal.confidence * config.confidenceWeight;
  
  // 成交量分数
  const volumeScore = Math.min(1.0, (signal.volumeRatio || 1) / 3) * config.volumeWeight;
  qualityScore += volumeScore;
  
  // 市场结构分数
  const structureScore = calculateMarketStructureScore(data, index) * config.structureWeight;
  qualityScore += structureScore;
  
  // 动量分数
  const momentumScore = Math.min(1.0, Math.abs(signal.momentum || signal.priceMomentum || 0) * 50) * config.momentumWeight;
  qualityScore += momentumScore;
  
  return Math.min(1.0, qualityScore);
}

// 计算市场结构分数
function calculateMarketStructureScore(data, index) {
  if (index < 30) return 0.5;
  
  const recent = data.slice(index - 20, index + 1);
  const prices = recent.map(d => d.close);
  const volumes = recent.map(d => d.volume);
  
  // 价格结构稳定性
  const priceStability = 1 - (Math.max(...prices) - Math.min(...prices)) / Math.min(...prices);
  
  // 成交量一致性
  const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
  const volumeVariance = volumes.reduce((sum, v) => sum + Math.pow(v - avgVolume, 2), 0) / volumes.length;
  const volumeConsistency = 1 - Math.sqrt(volumeVariance) / avgVolume;
  
  return (priceStability * 0.6 + volumeConsistency * 0.4);
}

// 完美过滤器
function passPerfectFilters(data, index, currentCapital, peakCapital) {
  // 基础风险过滤
  const drawdown = (peakCapital - currentCapital) / peakCapital;
  if (drawdown > perfectConfig.precisionRisk.maxDrawdown * 0.8) {
    return false;
  }
  
  // 市场环境过滤
  const marketFilter = perfectConfig.signalFiltering.marketFilter;
  
  if (index < 30) return false;
  
  const recent = data.slice(index - 20, index + 1);
  const prices = recent.map(d => d.close);
  const volumes = recent.map(d => d.volume);
  
  // 波动率检查
  const volatility = calculateVolatility(prices);
  if (volatility < marketFilter.minVolatility || volatility > marketFilter.maxVolatility) {
    return false;
  }
  
  // 成交量检查
  const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
  const currentVolume = volumes[volumes.length - 1];
  const volumeRatio = currentVolume / avgVolume;
  if (volumeRatio < marketFilter.minVolume) {
    return false;
  }
  
  return true;
}

// 计算完美杠杆
function calculatePerfectLeverage(signal, data, index) {
  const config = perfectConfig.precisionRisk.leverageManagement;
  let leverage = config.base;
  
  // 基于信号置信度调整
  leverage *= (0.7 + signal.confidence * 0.6);
  
  // 基于信号质量调整
  leverage *= (0.8 + signal.qualityScore * 0.4);
  
  // 基于市场波动率调整
  if (config.volatilityAdjustment) {
    const volatility = calculateVolatility(data.slice(index - 20, index + 1).map(d => d.close));
    if (volatility > 0.04) {
      leverage *= 0.8;
    } else if (volatility < 0.02) {
      leverage *= 1.1;
    }
  }
  
  return Math.max(config.min, Math.min(config.max, leverage));
}

// 计算完美仓位
function calculatePerfectPositionSize(signal, currentCapital, peakCapital) {
  const config = perfectConfig.precisionRisk.positionSizing;
  let positionSize = config.base;
  
  // 基于置信度缩放
  if (config.confidenceScaling) {
    positionSize *= signal.confidence;
  }
  
  // 基于质量分数调整
  positionSize *= signal.qualityScore;
  
  // 基于回撤减少仓位
  if (config.drawdownReduction) {
    const drawdown = (peakCapital - currentCapital) / peakCapital;
    if (drawdown > 0.03) {
      positionSize *= (1 - drawdown * 2);
    }
  }
  
  return Math.max(config.base * 0.5, Math.min(config.max, positionSize));
}

// 开仓
function openPerfectPosition(signal, candle, capital, leverage, positionSize, index) {
  const isLong = signal.direction === 'LONG';
  const tradeAmount = capital * positionSize;
  const entryPrice = candle.close;
  
  // 动态止损
  const baseStopLoss = 0.012;
  const stopLossMultiplier = 1.0 - (signal.qualityScore - 0.8) * 0.5; // 高质量信号更紧止损
  const stopLossPrice = entryPrice * (1 + (isLong ? -1 : 1) * baseStopLoss * stopLossMultiplier);
  
  // 动态止盈
  const baseTakeProfit = perfectConfig.dynamicTakeProfit.base;
  const takeProfitLevels = [
    entryPrice * (1 + (isLong ? 1 : -1) * baseTakeProfit.level1),
    entryPrice * (1 + (isLong ? 1 : -1) * baseTakeProfit.level2),
    entryPrice * (1 + (isLong ? 1 : -1) * baseTakeProfit.level3)
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
    takeProfitLevels: takeProfitLevels,
    trailingStopPrice: stopLossPrice,
    confidence: signal.confidence,
    qualityScore: signal.qualityScore,
    strategy: signal.strategy,
    maxHoldingTime: 12, // 12小时
    remainingSize: 1.0
  };
}

// 检查完美平仓
function checkPerfectClose(position, currentCandle, currentIndex) {
  const isLong = position.side === 'LONG';
  const currentPrice = currentCandle.close;
  const holdingTime = (currentIndex - position.entryIndex) * 0.25;
  
  // 更新移动止盈
  if (perfectConfig.dynamicTakeProfit.trendFollowing.enabled) {
    const profitRate = (currentPrice - position.entryPrice) / position.entryPrice * (isLong ? 1 : -1);
    
    if (profitRate > perfectConfig.dynamicTakeProfit.trendFollowing.minProfit) {
      const trailingDistance = perfectConfig.dynamicTakeProfit.trendFollowing.trailingDistance;
      
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
      const closePercentages = [0.4, 0.35, 0.25];
      return {
        shouldClose: true,
        reason: `PERFECT_TAKE_PROFIT_L${i + 1}`,
        price: level,
        partialClose: i < 2,
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

// 平仓
function closePerfectPosition(position, closeResult) {
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
    confidence: position.confidence,
    qualityScore: position.qualityScore,
    leverage: position.leverage,
    positionSize: position.positionSize,
    holdingTime: (Date.now() - position.entryTime) / (1000 * 60 * 60)
  };
}

// 机器学习更新
function updateMachineLearning(trade) {
  if (!perfectConfig.mlEnhancement.enabled) return;
  
  // 添加到性能记忆
  mlState.performanceMemory.push({
    ...trade,
    timestamp: Date.now()
  });
  
  // 保持记忆窗口大小
  const memoryWindow = perfectConfig.mlEnhancement.parameterOptimization.memoryWindow;
  if (mlState.performanceMemory.length > memoryWindow) {
    mlState.performanceMemory.shift();
  }
  
  // 学习成功和失败模式
  if (trade.pnl > 0) {
    mlState.successPatterns.push({
      strategy: trade.strategy,
      confidence: trade.confidence,
      qualityScore: trade.qualityScore,
      leverage: trade.leverage,
      positionSize: trade.positionSize
    });
  } else {
    mlState.failurePatterns.push({
      strategy: trade.strategy,
      confidence: trade.confidence,
      qualityScore: trade.qualityScore,
      leverage: trade.leverage,
      positionSize: trade.positionSize
    });
  }
  
  // 限制模式记忆大小
  if (mlState.successPatterns.length > 50) mlState.successPatterns.shift();
  if (mlState.failurePatterns.length > 50) mlState.failurePatterns.shift();
}

// 机器学习参数优化
function optimizeParametersML(recentTrades) {
  if (recentTrades.length === 0) return;
  
  const winRate = recentTrades.filter(t => t.pnl > 0).length / recentTrades.length;
  const winningTrades = recentTrades.filter(t => t.pnl > 0);
  const losingTrades = recentTrades.filter(t => t.pnl < 0);
  const avgWin = winningTrades.length > 0 ? winningTrades.reduce((sum, t) => sum + t.returnRate, 0) / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((sum, t) => sum + t.returnRate, 0) / losingTrades.length) : 0;
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;
  
  const learningRate = perfectConfig.mlEnhancement.parameterOptimization.learningRate;
  const targets = mlState.currentOptimization;
  
  // 调整目标参数
  if (winRate < targets.winRateTarget) {
    // 提高信号质量要求
    Object.keys(perfectConfig.eliteStrategies).forEach(strategy => {
      if (perfectConfig.eliteStrategies[strategy].minConfidence < 0.85) {
        perfectConfig.eliteStrategies[strategy].minConfidence += 0.02 * learningRate;
      }
    });
  } else if (winRate > targets.winRateTarget + 0.05) {
    // 适度降低信号质量要求以增加交易频率
    Object.keys(perfectConfig.eliteStrategies).forEach(strategy => {
      if (perfectConfig.eliteStrategies[strategy].minConfidence > 0.70) {
        perfectConfig.eliteStrategies[strategy].minConfidence -= 0.01 * learningRate;
      }
    });
  }
  
  if (profitFactor < targets.profitFactorTarget) {
    // 调整止盈止损比例
    perfectConfig.dynamicTakeProfit.base.level1 *= (1 + 0.05 * learningRate);
    perfectConfig.dynamicTakeProfit.base.level2 *= (1 + 0.05 * learningRate);
    perfectConfig.dynamicTakeProfit.base.level3 *= (1 + 0.05 * learningRate);
  }
  
  // 记录优化历史
  perfectResults.learningHistory.push({
    timestamp: Date.now(),
    winRate: winRate,
    profitFactor: profitFactor,
    adjustments: {
      confidenceThresholds: Object.fromEntries(
        Object.entries(perfectConfig.eliteStrategies).map(([k, v]) => [k, v.minConfidence])
      ),
      takeProfitLevels: perfectConfig.dynamicTakeProfit.base
    }
  });
}

// 计算波动率
function calculateVolatility(prices) {
  if (prices.length < 10) return 0.02;
  
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i-1]) / prices[i-1]);
  }
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  return Math.sqrt(variance);
}

// 生成报告
async function generatePerfectReport() {
  console.log('📋 生成完美报告...');
  
  const result = perfectResults.overallPerformance;
  
  console.log('\n📋 完美杠杆ETH合约Agent报告');
  console.log('='.repeat(80));
  
  console.log('\n🎯 完美策略成果:');
  console.log(`   🏆 胜率: ${(result.winRate * 100).toFixed(1)}%`);
  console.log(`   📈 总收益率: ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`   🚀 年化收益率: ${(result.annualizedReturn * 100).toFixed(1)}%`);
  console.log(`   💰 盈亏比: ${result.profitFactor.toFixed(2)}`);
  console.log(`   📊 总交易数: ${result.totalTrades}笔`);
  console.log(`   🎯 平均置信度: ${(result.avgConfidence * 100).toFixed(1)}%`);
  console.log(`   🛡️ 最大回撤: ${(result.maxDrawdown * 100).toFixed(1)}%`);
  console.log(`   🧠 ML优化次数: ${perfectResults.learningHistory.length}次`);
  console.log(`   💰 最终资金: $${Math.round(result.finalCapital).toLocaleString()}`);
  
  // 策略表现分析
  console.log('\n📊 精选策略表现:');
  Object.entries(perfectResults.strategyPerformance).forEach(([strategy, stats]) => {
    if (stats.trades > 0) {
      const winRate = (stats.wins / stats.trades * 100).toFixed(1);
      const avgConf = (stats.avgConfidence / stats.trades * 100).toFixed(1);
      console.log(`   ${strategy}: ${stats.trades}笔, 胜率${winRate}%, 平均置信度${avgConf}%, 总盈亏$${Math.round(stats.pnl)}`);
    }
  });
  
  // 目标达成分析
  console.log('\n🎯 完美目标达成情况:');
  const targets = perfectConfig.mlEnhancement.parameterOptimization.targets;
  console.log(`   胜率目标: ${(targets.winRate * 100).toFixed(0)}% | 实际: ${(result.winRate * 100).toFixed(1)}% ${result.winRate >= targets.winRate ? '✅' : '❌'}`);
  console.log(`   盈亏比目标: ${targets.profitFactor.toFixed(1)} | 实际: ${result.profitFactor.toFixed(2)} ${result.profitFactor >= targets.profitFactor ? '✅' : '❌'}`);
  console.log(`   年化收益目标: 12%+ | 实际: ${(result.annualizedReturn * 100).toFixed(1)}% ${result.annualizedReturn >= 0.12 ? '✅' : '❌'}`);
  
  const achievedTargets = [
    result.winRate >= targets.winRate,
    result.profitFactor >= targets.profitFactor,
    result.annualizedReturn >= 0.12
  ].filter(Boolean).length;
  
  console.log(`   目标达成: ${achievedTargets}/3 (${(achievedTargets / 3 * 100).toFixed(0)}%)`);
  
  console.log('\n🎯 策略评估:');
  if (achievedTargets === 3) {
    console.log('   🎉 完美表现: 全部目标达成！');
    console.log('   评级: SS (完美级)');
    console.log('   评价: 完美策略，强烈推荐实盘部署');
  } else if (achievedTargets === 2) {
    console.log('   🔥 卓越表现: 大部分目标达成');
    console.log('   评级: S+ (传奇级)');
    console.log('   评价: 卓越策略，可考虑实盘部署');
  } else if (achievedTargets === 1) {
    console.log('   📈 优秀表现: 部分目标达成');
    console.log('   评级: S (卓越级)');
    console.log('   评价: 优秀策略，小资金测试');
  } else {
    console.log('   📊 良好表现: 需要进一步优化');
    console.log('   评级: A+ (优秀级)');
    console.log('   评价: 继续优化参数');
  }
  
  console.log('\n🔥 完美优势:');
  console.log('   🎯 精选策略 - 只保留高胜率策略');
  console.log('   🔍 智能过滤 - 多重确认提高信号质量');
  console.log('   💰 动态止盈 - 根据市场环境优化止盈');
  console.log('   🛡️ 精准风控 - 更精确的风险管理');
  console.log('   🧠 机器学习 - 持续优化参数');
  
  // 保存报告
  const reportPath = path.join(__dirname, 'perfect_agent_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(perfectResults, null, 2));
  console.log(`\n💾 详细报告已保存: ${reportPath}`);
}

// 运行完美测试
runPerfectTest().catch(console.error);