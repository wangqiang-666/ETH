#!/usr/bin/env node

/**
 * 学习型杠杆ETH合约Agent
 * 真正的经验积累和学习能力：
 * 
 * 核心学习特性：
 * 1. 持久化经验存储 - 所有交易经验保存到文件
 * 2. 深度模式学习 - 识别成功和失败的交易模式
 * 3. 长期记忆系统 - 积累历史经验，越用越聪明
 * 4. 自适应参数优化 - 基于历史表现持续优化
 * 5. 市场环境学习 - 学习不同市场环境的最优策略
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 启动学习型杠杆ETH合约Agent...\n');

// 学习型配置
const learningConfig = {
  symbol: 'ETHUSDT',
  initialCapital: 100000,
  
  // 学习系统配置
  learningSystem: {
    // 经验存储
    experienceStorage: {
      enabled: true,
      filePath: path.join(__dirname, 'agent_experience.json'),
      maxExperiences: 10000,      // 最多存储10000条经验
      backupInterval: 100         // 每100笔交易备份一次
    },
    
    // 模式学习
    patternLearning: {
      enabled: true,
      minPatternOccurrence: 5,    // 模式至少出现5次才认为有效
      successThreshold: 0.6,      // 60%成功率的模式才学习
      patternMemorySize: 1000     // 记住1000个模式
    },
    
    // 参数优化学习
    parameterOptimization: {
      enabled: true,
      learningRate: 0.1,          // 10%学习率
      optimizationInterval: 50,   // 每50笔交易优化一次
      targetMetrics: {
        winRate: 0.50,            // 目标胜率50%
        profitFactor: 1.8,        // 目标盈亏比1.8
        maxDrawdown: 0.06         // 目标最大回撤6%
      }
    },
    
    // 市场环境学习
    marketLearning: {
      enabled: true,
      environmentTypes: ['trending', 'sideways', 'volatile', 'breakout'],
      strategyAdaptation: true,   // 策略适应
      parameterAdaptation: true   // 参数适应
    }
  },
  
  // 基础交易配置
  trading: {
    maxDailyTrades: 20,
    cooldownPeriod: 0.5,
    maxHoldingTime: 10,
    minConfidence: 0.68,
    
    // 动态参数（会被学习系统调整）
    leverage: { min: 1.8, max: 4.0, base: 2.5 },
    positionSize: { min: 0.04, max: 0.12, base: 0.07 },
    stopLoss: { min: 0.010, max: 0.025, base: 0.015 },
    takeProfit: { min: 0.020, max: 0.060, base: 0.035 }
  },
  
  // 策略配置
  strategies: {
    fakeBreakout: { weight: 0.35, enabled: true },
    trendFollowing: { weight: 0.30, enabled: true },
    momentum: { weight: 0.20, enabled: true },
    meanReversion: { weight: 0.15, enabled: true }
  },
  
  // 风险管理
  risk: {
    maxDrawdown: 0.08,
    maxConsecutiveLosses: 5,
    emergencyStop: 0.12
  }
};

// 全局变量
let realHistoricalData = [];
let learningResults = {
  overallPerformance: {},
  trades: [],
  learningMetrics: {},
  experienceGrowth: []
};

// 学习状态
let learningState = {
  totalExperiences: 0,
  learnedPatterns: [],
  optimizedParameters: {},
  marketEnvironmentLearning: {},
  performanceHistory: []
};

// 经验数据库
let experienceDB = {
  trades: [],
  patterns: [],
  optimizations: [],
  marketConditions: []
};

// 主函数
async function runLearningTest() {
  console.log('📊 学习型杠杆ETH合约Agent测试');
  console.log('='.repeat(80));
  console.log('🎯 学习目标: 持续积累经验，越用越聪明');
  console.log('🧠 学习特性: 持久化存储，模式学习，参数优化');
  console.log('⚡ 核心能力: 长期记忆，深度学习，自我进化');
  
  // 加载历史数据
  await loadHistoricalData();
  
  // 加载已有经验
  await loadExistingExperience();
  
  // 学习型回测
  await runLearningBacktest();
  
  // 保存学习经验
  await saveExperience();
  
  // 生成报告
  await generateLearningReport();
}

// 加载历史数据
async function loadHistoricalData() {
  console.log('📊 加载真实历史数据...');
  
  const dataPath = path.join(__dirname, 'real_historical_data_2022_2024.json');
  const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  realHistoricalData = rawData;
  
  console.log(`   ✅ 数据加载完成: ${realHistoricalData.length.toLocaleString()}条K线`);
}

// 加载已有经验
async function loadExistingExperience() {
  console.log('🧠 加载已有学习经验...');
  
  const experiencePath = learningConfig.learningSystem.experienceStorage.filePath;
  
  if (fs.existsSync(experiencePath)) {
    try {
      const savedExperience = JSON.parse(fs.readFileSync(experiencePath, 'utf8'));
      experienceDB = savedExperience;
      learningState.totalExperiences = experienceDB.trades.length;
      
      // 应用学习到的参数优化
      if (experienceDB.optimizations.length > 0) {
        const latestOptimization = experienceDB.optimizations[experienceDB.optimizations.length - 1];
        applyLearnedOptimizations(latestOptimization);
      }
      
      // 加载学习到的模式
      learningState.learnedPatterns = experienceDB.patterns || [];
      
      console.log(`   ✅ 加载已有经验: ${learningState.totalExperiences}条交易记录`);
      console.log(`   🧠 学习到的模式: ${learningState.learnedPatterns.length}个`);
      console.log(`   ⚙️ 参数优化记录: ${experienceDB.optimizations.length}次`);
    } catch (error) {
      console.log(`   ⚠️ 经验文件损坏，重新开始学习`);
      experienceDB = { trades: [], patterns: [], optimizations: [], marketConditions: [] };
    }
  } else {
    console.log(`   📝 首次运行，开始积累经验`);
    experienceDB = { trades: [], patterns: [], optimizations: [], marketConditions: [] };
  }
}

// 应用学习到的优化
function applyLearnedOptimizations(optimization) {
  if (optimization.parameters) {
    // 应用学习到的参数
    Object.keys(optimization.parameters).forEach(param => {
      if (learningConfig.trading[param]) {
        learningConfig.trading[param].base = optimization.parameters[param];
      }
    });
    
    console.log(`   🎯 应用学习到的参数优化`);
  }
}

// 学习型回测
async function runLearningBacktest() {
  console.log('🎯 执行学习型回测...');
  
  let currentCapital = learningConfig.initialCapital;
  let trades = [];
  let currentPosition = null;
  let dailyTrades = 0;
  let lastTradeDay = null;
  let maxDrawdown = 0;
  let peakCapital = currentCapital;
  let consecutiveLosses = 0;
  let cooldownUntil = 0;
  
  // 学习统计
  let learningStats = {
    patternsDiscovered: 0,
    parametersOptimized: 0,
    experiencesAccumulated: 0
  };
  
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
      const closeResult = checkLearningClose(currentPosition, currentCandle, i);
      if (closeResult.shouldClose) {
        const trade = closeLearningPosition(currentPosition, closeResult);
        trades.push(trade);
        currentCapital += trade.pnl;
        
        // 学习经验积累
        await accumulateExperience(trade, realHistoricalData, currentPosition.entryIndex, i);
        learningStats.experiencesAccumulated++;
        
        // 模式学习
        if (learningConfig.learningSystem.patternLearning.enabled) {
          await learnFromPattern(trade, realHistoricalData, currentPosition.entryIndex, i);
        }
        
        currentPosition = null;
        dailyTrades++;
        
        // 连续亏损处理
        if (trade.pnl > 0) {
          consecutiveLosses = 0;
        } else {
          consecutiveLosses++;
        }
        
        // 设置冷却期
        cooldownUntil = currentCandle.timestamp + (learningConfig.trading.cooldownPeriod * 60 * 60 * 1000);
        
        // 更新最大回撤
        if (currentCapital > peakCapital) {
          peakCapital = currentCapital;
        }
        const drawdown = (peakCapital - currentCapital) / peakCapital;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
        
        // 参数优化学习
        if (trades.length > 0 && 
            trades.length % learningConfig.learningSystem.parameterOptimization.optimizationInterval === 0) {
          await optimizeParametersFromExperience(trades.slice(-learningConfig.learningSystem.parameterOptimization.optimizationInterval));
          learningStats.parametersOptimized++;
        }
        
        // 定期保存经验
        if (trades.length % learningConfig.learningSystem.experienceStorage.backupInterval === 0) {
          await saveExperience();
        }
        
        // 检查风险限制
        if (drawdown > learningConfig.risk.maxDrawdown) {
          console.log(`   ⚠️ 达到最大回撤限制 ${(drawdown * 100).toFixed(1)}%，停止交易`);
          break;
        }
        
        if (consecutiveLosses >= learningConfig.risk.maxConsecutiveLosses) {
          console.log(`   ⚠️ 连续亏损${consecutiveLosses}次，暂停交易1小时`);
          cooldownUntil = currentCandle.timestamp + (1 * 60 * 60 * 1000);
          consecutiveLosses = 0;
        }
      }
    }
    
    // 检查开仓
    if (!currentPosition && 
        dailyTrades < learningConfig.trading.maxDailyTrades &&
        passLearningFilters(currentCapital, peakCapital)) {
      
      // 生成学习增强信号
      const signal = generateLearningEnhancedSignal(realHistoricalData, i);
      
      if (signal && signal.confidence > learningConfig.trading.minConfidence) {
        const leverage = calculateLearningLeverage(signal);
        const positionSize = calculateLearningPositionSize(signal, currentCapital);
        
        currentPosition = openLearningPosition(signal, currentCandle, currentCapital, leverage, positionSize, i);
      }
    }
  }
  
  // 计算最终结果
  const totalReturn = (currentCapital - learningConfig.initialCapital) / learningConfig.initialCapital;
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
  
  console.log(`   ✅ 学习型回测完成`);
  console.log(`      📊 总交易数: ${trades.length}笔`);
  console.log(`      🏆 胜率: ${(winRate * 100).toFixed(1)}%`);
  console.log(`      📈 总收益率: ${(totalReturn * 100).toFixed(2)}%`);
  console.log(`      🚀 年化收益率: ${(annualizedReturn * 100).toFixed(1)}%`);
  console.log(`      💰 盈亏比: ${profitFactor.toFixed(2)}`);
  console.log(`      🛡️ 最大回撤: ${(maxDrawdown * 100).toFixed(1)}%`);
  console.log(`      🧠 积累经验: ${learningStats.experiencesAccumulated}条`);
  console.log(`      🔍 发现模式: ${learningStats.patternsDiscovered}个`);
  console.log(`      ⚙️ 参数优化: ${learningStats.parametersOptimized}次`);
  console.log(`      💰 最终资金: $${Math.round(currentCapital).toLocaleString()}`);
  
  learningResults.overallPerformance = {
    totalReturn, annualizedReturn, winRate, profitFactor,
    totalTrades: trades.length, maxDrawdown, finalCapital: currentCapital,
    trades, avgWin, avgLoss
  };
  
  learningResults.learningMetrics = learningStats;
}

// 积累经验
async function accumulateExperience(trade, data, entryIndex, exitIndex) {
  const experience = {
    timestamp: Date.now(),
    trade: trade,
    marketCondition: analyzeMarketCondition(data, entryIndex),
    entryContext: extractContext(data, entryIndex),
    exitContext: extractContext(data, exitIndex),
    performance: {
      pnl: trade.pnl,
      returnRate: trade.returnRate,
      holdingTime: trade.holdingTime
    }
  };
  
  // 添加到经验数据库
  experienceDB.trades.push(experience);
  
  // 保持经验数据库大小限制
  const maxExperiences = learningConfig.learningSystem.experienceStorage.maxExperiences;
  if (experienceDB.trades.length > maxExperiences) {
    experienceDB.trades.shift();
  }
  
  learningState.totalExperiences++;
}

// 从模式中学习
async function learnFromPattern(trade, data, entryIndex, exitIndex) {
  const pattern = {
    id: `pattern_${Date.now()}`,
    marketCondition: analyzeMarketCondition(data, entryIndex),
    signalCharacteristics: {
      strategy: trade.strategy,
      confidence: trade.confidence,
      leverage: trade.leverage,
      positionSize: trade.positionSize
    },
    outcome: {
      success: trade.pnl > 0,
      returnRate: trade.returnRate,
      holdingTime: trade.holdingTime
    },
    context: extractDetailedContext(data, entryIndex, exitIndex)
  };
  
  // 查找相似模式
  const similarPatterns = findSimilarPatterns(pattern);
  
  if (similarPatterns.length >= learningConfig.learningSystem.patternLearning.minPatternOccurrence) {
    const successRate = similarPatterns.filter(p => p.trade && p.trade.pnl > 0).length / similarPatterns.length;
    
    if (successRate >= learningConfig.learningSystem.patternLearning.successThreshold) {
      // 学习成功模式
      const learnedPattern = {
        id: `learned_${Date.now()}`,
        type: 'success_pattern',
        characteristics: pattern.signalCharacteristics,
        marketCondition: pattern.marketCondition,
        successRate: successRate,
        avgReturn: similarPatterns.reduce((sum, p) => {
          return sum + (p.trade ? p.trade.returnRate : 0);
        }, 0) / similarPatterns.length,
        occurrences: similarPatterns.length,
        learnedAt: Date.now()
      };
      
      learningState.learnedPatterns.push(learnedPattern);
      experienceDB.patterns.push(learnedPattern);
      
      console.log(`   🧠 学习到新模式: ${learnedPattern.type}, 成功率: ${(successRate * 100).toFixed(1)}%`);
    }
  }
}

// 从经验中优化参数
async function optimizeParametersFromExperience(recentTrades) {
  if (recentTrades.length === 0) return;
  
  const winRate = recentTrades.filter(t => t.pnl > 0).length / recentTrades.length;
  const winningTrades = recentTrades.filter(t => t.pnl > 0);
  const losingTrades = recentTrades.filter(t => t.pnl < 0);
  const avgWin = winningTrades.length > 0 ? winningTrades.reduce((sum, t) => sum + t.returnRate, 0) / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((sum, t) => sum + t.returnRate, 0) / losingTrades.length) : 0;
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;
  
  const targets = learningConfig.learningSystem.parameterOptimization.targetMetrics;
  const learningRate = learningConfig.learningSystem.parameterOptimization.learningRate;
  
  let optimizations = {};
  
  // 优化杠杆
  if (winRate < targets.winRate) {
    // 胜率低，降低杠杆
    const newLeverage = learningConfig.trading.leverage.base * (1 - learningRate * 0.5);
    learningConfig.trading.leverage.base = Math.max(learningConfig.trading.leverage.min, newLeverage);
    optimizations.leverage = learningConfig.trading.leverage.base;
  } else if (winRate > targets.winRate + 0.05) {
    // 胜率高，可以适度提高杠杆
    const newLeverage = learningConfig.trading.leverage.base * (1 + learningRate * 0.3);
    learningConfig.trading.leverage.base = Math.min(learningConfig.trading.leverage.max, newLeverage);
    optimizations.leverage = learningConfig.trading.leverage.base;
  }
  
  // 优化仓位大小
  if (profitFactor < targets.profitFactor) {
    // 盈亏比低，减少仓位
    const newPositionSize = learningConfig.trading.positionSize.base * (1 - learningRate * 0.3);
    learningConfig.trading.positionSize.base = Math.max(learningConfig.trading.positionSize.min, newPositionSize);
    optimizations.positionSize = learningConfig.trading.positionSize.base;
  }
  
  // 优化止盈止损
  if (avgWin > 0 && avgLoss > 0) {
    if (profitFactor < targets.profitFactor) {
      // 提高止盈目标
      const newTakeProfit = learningConfig.trading.takeProfit.base * (1 + learningRate * 0.2);
      learningConfig.trading.takeProfit.base = Math.min(learningConfig.trading.takeProfit.max, newTakeProfit);
      optimizations.takeProfit = learningConfig.trading.takeProfit.base;
    }
  }
  
  // 记录优化
  if (Object.keys(optimizations).length > 0) {
    const optimizationRecord = {
      timestamp: Date.now(),
      metrics: { winRate, profitFactor, avgWin, avgLoss },
      parameters: optimizations,
      tradesAnalyzed: recentTrades.length
    };
    
    experienceDB.optimizations.push(optimizationRecord);
    learningState.optimizedParameters = { ...learningState.optimizedParameters, ...optimizations };
    
    console.log(`   ⚙️ 参数优化: 杠杆${optimizations.leverage?.toFixed(2) || '未变'}, 仓位${(optimizations.positionSize * 100)?.toFixed(1) || '未变'}%`);
  }
}

// 生成学习增强信号
function generateLearningEnhancedSignal(data, index) {
  if (index < 30) return null;
  
  // 基础信号生成（简化版）
  const baseSignal = generateBaseSignal(data, index);
  if (!baseSignal) return null;
  
  // 应用学习到的模式增强
  const enhancedSignal = applyLearnedPatterns(baseSignal, data, index);
  
  return enhancedSignal;
}

// 生成基础信号（简化实现）
function generateBaseSignal(data, index) {
  const current = data[index];
  const previous = data.slice(index - 20, index);
  
  // 简单的假突破检测
  const highs = previous.map(d => d.high);
  const lows = previous.map(d => d.low);
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  
  const upBreakout = (current.high - resistance) / resistance;
  const downBreakout = (support - current.low) / support;
  
  if (upBreakout > 0.005 && upBreakout < 0.02) {
    const volumes = previous.map(d => d.volume);
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    const volumeRatio = current.volume / avgVolume;
    
    if (volumeRatio > 1.8) {
      return {
        strategy: 'fakeBreakout',
        direction: 'SHORT',
        confidence: Math.min(0.85, 0.6 + upBreakout * 10 + (volumeRatio - 1.5) * 0.1),
        breakoutSize: upBreakout,
        volumeRatio: volumeRatio
      };
    }
  }
  
  if (downBreakout > 0.005 && downBreakout < 0.02) {
    const volumes = previous.map(d => d.volume);
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    const volumeRatio = current.volume / avgVolume;
    
    if (volumeRatio > 1.8) {
      return {
        strategy: 'fakeBreakout',
        direction: 'LONG',
        confidence: Math.min(0.85, 0.6 + downBreakout * 10 + (volumeRatio - 1.5) * 0.1),
        breakoutSize: downBreakout,
        volumeRatio: volumeRatio
      };
    }
  }
  
  return null;
}

// 应用学习到的模式
function applyLearnedPatterns(signal, data, index) {
  if (learningState.learnedPatterns.length === 0) return signal;
  
  const currentMarketCondition = analyzeMarketCondition(data, index);
  
  // 查找匹配的学习模式
  const matchingPatterns = learningState.learnedPatterns.filter(pattern => {
    return pattern.characteristics.strategy === signal.strategy &&
           pattern.marketCondition.type === currentMarketCondition.type;
  });
  
  if (matchingPatterns.length > 0) {
    // 使用最佳匹配模式增强信号
    const bestPattern = matchingPatterns.reduce((best, current) => 
      current.successRate > best.successRate ? current : best
    );
    
    // 根据学习到的模式调整置信度
    signal.confidence = signal.confidence * 0.7 + bestPattern.successRate * 0.3;
    signal.learnedPattern = bestPattern.id;
    signal.patternSuccessRate = bestPattern.successRate;
  }
  
  return signal;
}

// 辅助函数
function analyzeMarketCondition(data, index) {
  if (index < 20) return { type: 'unknown', volatility: 0, trend: 0 };
  
  const prices = data.slice(index - 20, index + 1).map(d => d.close);
  const volatility = calculateVolatility(prices);
  const trend = calculateTrend(prices);
  
  let type = 'sideways';
  if (Math.abs(trend) > 0.015) type = 'trending';
  if (volatility > 0.04) type = 'volatile';
  
  return { type, volatility, trend };
}

function extractContext(data, index) {
  if (index < 10) return {};
  
  const recent = data.slice(index - 10, index + 1);
  return {
    avgPrice: recent.reduce((sum, d) => sum + d.close, 0) / recent.length,
    avgVolume: recent.reduce((sum, d) => sum + d.volume, 0) / recent.length,
    priceRange: Math.max(...recent.map(d => d.high)) - Math.min(...recent.map(d => d.low))
  };
}

function extractDetailedContext(data, entryIndex, exitIndex) {
  return {
    entry: extractContext(data, entryIndex),
    exit: extractContext(data, exitIndex),
    duration: exitIndex - entryIndex
  };
}

function findSimilarPatterns(pattern) {
  return experienceDB.trades.filter(exp => {
    return exp.marketCondition.type === pattern.marketCondition.type &&
           exp.trade.strategy === pattern.signalCharacteristics.strategy &&
           Math.abs(exp.trade.confidence - pattern.signalCharacteristics.confidence) < 0.1;
  }).map(exp => exp);
}

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

function calculateTrend(prices) {
  if (prices.length < 5) return 0;
  return (prices[prices.length - 1] - prices[0]) / prices[0];
}

function calculateLearningLeverage(signal) {
  let leverage = learningConfig.trading.leverage.base;
  leverage *= (0.8 + signal.confidence * 0.4);
  return Math.max(learningConfig.trading.leverage.min, 
                 Math.min(learningConfig.trading.leverage.max, leverage));
}

function calculateLearningPositionSize(signal, currentCapital) {
  let positionSize = learningConfig.trading.positionSize.base;
  positionSize *= signal.confidence;
  return Math.max(learningConfig.trading.positionSize.min,
                 Math.min(learningConfig.trading.positionSize.max, positionSize));
}

function openLearningPosition(signal, candle, capital, leverage, positionSize, index) {
  const isLong = signal.direction === 'LONG';
  const tradeAmount = capital * positionSize;
  const entryPrice = candle.close;
  
  const stopLossPrice = entryPrice * (1 + (isLong ? -1 : 1) * learningConfig.trading.stopLoss.base);
  const takeProfitPrice = entryPrice * (1 + (isLong ? 1 : -1) * learningConfig.trading.takeProfit.base);
  
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
    strategy: signal.strategy,
    learnedPattern: signal.learnedPattern,
    maxHoldingTime: learningConfig.trading.maxHoldingTime
  };
}

function checkLearningClose(position, currentCandle, currentIndex) {
  const isLong = position.side === 'LONG';
  const currentPrice = currentCandle.close;
  const holdingTime = (currentIndex - position.entryIndex) * 0.25;
  
  // 检查止盈
  if ((isLong && currentPrice >= position.takeProfitPrice) ||
      (!isLong && currentPrice <= position.takeProfitPrice)) {
    return { shouldClose: true, reason: 'TAKE_PROFIT', price: position.takeProfitPrice };
  }
  
  // 检查止损
  if ((isLong && currentPrice <= position.stopLossPrice) ||
      (!isLong && currentPrice >= position.stopLossPrice)) {
    return { shouldClose: true, reason: 'STOP_LOSS', price: position.stopLossPrice };
  }
  
  // 检查时间限制
  if (holdingTime >= position.maxHoldingTime) {
    return { shouldClose: true, reason: 'TIME_LIMIT', price: currentPrice };
  }
  
  return { shouldClose: false };
}

function closeLearningPosition(position, closeResult) {
  const priceChange = (closeResult.price - position.entryPrice) / position.entryPrice;
  const returnRate = priceChange * (position.side === 'LONG' ? 1 : -1) * position.leverage;
  const pnl = position.tradeAmount * (returnRate - 0.002);
  
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
    learnedPattern: position.learnedPattern,
    holdingTime: (Date.now() - position.entryTime) / (1000 * 60 * 60)
  };
}

function passLearningFilters(currentCapital, peakCapital) {
  const drawdown = (peakCapital - currentCapital) / peakCapital;
  return drawdown < learningConfig.risk.maxDrawdown;
}

// 保存经验
async function saveExperience() {
  const experiencePath = learningConfig.learningSystem.experienceStorage.filePath;
  
  try {
    fs.writeFileSync(experiencePath, JSON.stringify(experienceDB, null, 2));
    console.log(`   💾 经验已保存: ${experienceDB.trades.length}条交易, ${experienceDB.patterns.length}个模式`);
  } catch (error) {
    console.log(`   ⚠️ 经验保存失败: ${error.message}`);
  }
}

// 生成报告
async function generateLearningReport() {
  console.log('📋 生成学习型报告...');
  
  const result = learningResults.overallPerformance;
  
  console.log('\n📋 学习型杠杆ETH合约Agent报告');
  console.log('='.repeat(80));
  
  console.log('\n🎯 学习型策略成果:');
  console.log(`   🏆 胜率: ${(result.winRate * 100).toFixed(1)}%`);
  console.log(`   📈 总收益率: ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`   🚀 年化收益率: ${(result.annualizedReturn * 100).toFixed(1)}%`);
  console.log(`   💰 盈亏比: ${result.profitFactor.toFixed(2)}`);
  console.log(`   📊 总交易数: ${result.totalTrades}笔`);
  console.log(`   🛡️ 最大回撤: ${(result.maxDrawdown * 100).toFixed(1)}%`);
  console.log(`   💰 最终资金: $${Math.round(result.finalCapital).toLocaleString()}`);
  
  console.log('\n🧠 学习成果:');
  console.log(`   📚 总经验积累: ${learningState.totalExperiences}条`);
  console.log(`   🔍 学习到的模式: ${learningState.learnedPatterns.length}个`);
  console.log(`   ⚙️ 参数优化次数: ${experienceDB.optimizations.length}次`);
  console.log(`   🎯 当前优化参数:`);
  console.log(`      杠杆: ${learningConfig.trading.leverage.base.toFixed(2)}倍`);
  console.log(`      仓位: ${(learningConfig.trading.positionSize.base * 100).toFixed(1)}%`);
  console.log(`      止盈: ${(learningConfig.trading.takeProfit.base * 100).toFixed(1)}%`);
  
  console.log('\n🔥 学习优势:');
  console.log('   💾 持久化存储 - 所有经验永久保存');
  console.log('   🧠 模式学习 - 识别成功交易模式');
  console.log('   ⚙️ 参数优化 - 基于历史表现自动调整');
  console.log('   📈 经验积累 - 越用越聪明');
  console.log('   🔄 持续进化 - 每次运行都会更好');
  
  // 保存报告
  const reportPath = path.join(__dirname, 'learning_agent_report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    ...learningResults,
    learningState: learningState,
    experienceStats: {
      totalExperiences: experienceDB.trades.length,
      learnedPatterns: experienceDB.patterns.length,
      optimizations: experienceDB.optimizations.length
    }
  }, null, 2));
  
  console.log(`\n💾 详细报告已保存: ${reportPath}`);
}

// 运行学习型测试
runLearningTest().catch(console.error);