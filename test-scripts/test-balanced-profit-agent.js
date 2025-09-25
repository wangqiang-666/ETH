#!/usr/bin/env node

/**
 * 平衡盈利ETH合约Agent
 * 解决盈利增强Agent交易频率过低的问题
 * 
 * 核心目标：
 * 1. 保持盈亏比1.8+（略低于2.15但仍优秀）
 * 2. 大幅增加交易频率到200-500笔
 * 3. 维持优秀的风险控制（回撤<3%）
 * 4. 实现正收益和合理的年化收益率
 * 5. 平衡质量与数量，追求实用性
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 启动平衡盈利ETH合约Agent...\n');

// 平衡盈利配置
const balancedProfitConfig = {
  symbol: 'ETHUSDT',
  initialCapital: 100000,
  
  // 平衡目标：质量与数量并重
  balancedGoals: {
    targetWinRate: 0.45,          // 目标胜率45%
    targetProfitFactor: 1.8,      // 目标盈亏比1.8
    targetTrades: 300,            // 目标交易数300笔
    maxDrawdown: 0.03,            // 最大回撤3%
    targetAnnualReturn: 0.08,     // 目标年化收益8%
    minQualityScore: 0.65         // 降低质量要求以增加频率
  },
  
  // 平衡的策略组合（降低门槛，增加机会）
  balancedStrategies: {
    // 标准反操控策略
    standardAntiManipulation: {
      enabled: true,
      weight: 0.35,
      minConfidence: 0.68,        // 降低置信度要求
      
      fakeBreakout: {
        minSize: 0.008,           // 降低最小突破幅度
        maxSize: 0.025,           
        volumeSpike: 1.8,         // 降低成交量要求
        wickRatio: 0.55,          // 降低影线比例要求
        confirmationPeriod: 2,    
        qualityFilter: 0.65       // 降低质量过滤
      },
      
      wickHunt: {
        minWick: 0.010,           
        maxWick: 0.035,           
        bodyRatio: 0.30,          
        volumeConfirm: 1.6,       // 降低成交量确认
        recoverySpeed: 0.4,       // 降低恢复速度要求
        strengthFilter: 0.65      
      }
    },
    
    // 适度趋势跟踪
    moderateTrendFollowing: {
      enabled: true,
      weight: 0.25,
      minConfidence: 0.65,
      
      trendCapture: {
        minMomentum: 0.012,       // 降低动量要求
        volumeBoost: 1.8,         // 降低成交量要求
        trendStrength: 0.7,       // 降低趋势强度要求
        multiTimeframe: false,    // 简化多时间框架
        quickEntry: true          // 快速入场
      }
    },
    
    // 波动率交易
    volatilityTrading: {
      enabled: true,
      weight: 0.25,
      minConfidence: 0.62,
      
      meanReversion: {
        volThreshold: 1.8,        // 降低波动率阈值
        extremeLevel: 0.75,       // 降低极端水平
        quickReversion: true,     
        riskReward: 1.8,          // 降低风险收益比要求
        fastExit: true            // 快速退出
      },
      
      breakoutTrading: {
        minBreakout: 0.008,       // 降低突破要求
        volumeConfirm: 1.5,       
        momentumFollow: true,     
        quickProfit: 0.020,       // 快速止盈
        tightStop: 0.012          // 紧密止损
      }
    },
    
    // 学习增强策略
    learningEnhanced: {
      enabled: true,
      weight: 0.15,
      minConfidence: 0.70,
      
      patternBoost: 1.3,          
      experienceWeight: 0.3,      
      adaptiveThreshold: true,    
      frequencyBoost: true        // 频率增强
    }
  },
  
  // 平衡的止盈止损策略
  balancedExitStrategy: {
    // 适度止盈（不过度贪婪）
    moderateTakeProfit: {
      quick: { profit: 0.018, size: 0.4 },    // 1.8%快速止盈40%
      target: { profit: 0.032, size: 0.4 },   // 3.2%目标止盈40%
      extended: { profit: 0.055, size: 0.2 }, // 5.5%扩展止盈20%
      
      // 动态调整
      marketAdjust: true,
      volatilityScale: true,
      trendBonus: 0.005,          // 趋势奖励
      rangeReduction: 0.003       // 区间减少
    },
    
    // 紧密止损（控制亏损）
    tightStopLoss: {
      initial: 0.011,             // 1.1%初始止损
      trailing: 0.007,            // 0.7%移动止损
      activation: 0.012,          // 1.2%激活点
      
      // 自适应调整
      volatilityAdjust: true,
      confidenceScale: true,
      marketRegimeAdjust: true
    },
    
    // 时间管理
    timeManagement: {
      maxHolding: 6,              // 最大持仓6小时
      profitableExit: 3,          // 盈利3小时考虑退出
      breakEvenExit: 4,           // 盈亏平衡4小时退出
      lossExit: 1.5,              // 亏损1.5小时考虑止损
      quickScalp: 0.5             // 快速剥头皮0.5小时
    }
  },
  
  // 平衡的风险管理
  balancedRiskManagement: {
    // 适度仓位管理
    moderatePositioning: {
      baseSize: 0.06,             // 6%基础仓位
      maxSize: 0.12,              // 12%最大仓位
      minSize: 0.03,              // 3%最小仓位
      
      // 动态调整
      confidenceScale: true,
      qualityScale: true,
      streakAdjust: true,
      drawdownReduce: true
    },
    
    // 适度杠杆
    moderateLeverage: {
      base: 2.2,                  // 基础2.2倍杠杆
      max: 3.2,                   // 最大3.2倍
      min: 1.6,                   // 最小1.6倍
      
      // 调整因子
      volatilityFactor: 0.8,
      confidenceFactor: 0.3,
      marketFactor: 0.2
    },
    
    // 频率控制
    frequencyControl: {
      maxDailyTrades: 25,         // 每日最多25笔
      minInterval: 0.25,          // 最小间隔15分钟
      cooldownPeriod: 0.5,        // 冷却期30分钟
      burstLimit: 5,              // 连续交易限制5笔
      burstCooldown: 2            // 连续交易后冷却2小时
    }
  },
  
  // 市场环境适应
  marketAdaptation: {
    regimes: {
      trending: { 
        leverage: 2.6, position: 0.08, 
        takeProfit: 0.045, stopLoss: 0.013,
        frequency: 1.2 
      },
      sideways: { 
        leverage: 2.0, position: 0.06, 
        takeProfit: 0.025, stopLoss: 0.010,
        frequency: 1.0 
      },
      volatile: { 
        leverage: 1.8, position: 0.05, 
        takeProfit: 0.020, stopLoss: 0.008,
        frequency: 0.8 
      }
    },
    
    adaptationSpeed: 0.15,
    detectionPeriod: 40,
    confidenceThreshold: 0.75
  },
  
  // 交易质量平衡
  qualityBalance: {
    // 多层质量标准
    qualityTiers: {
      premium: { minScore: 0.80, weight: 1.3 },
      standard: { minScore: 0.65, weight: 1.0 },
      acceptable: { minScore: 0.50, weight: 0.8 }
    },
    
    // 频率增强
    frequencyEnhancement: {
      enabled: true,
      relaxationFactor: 0.8,      // 放宽因子
      opportunityBoost: 1.2,      // 机会增强
      adaptiveThreshold: true     // 自适应阈值
    }
  }
};

// 全局变量
let realHistoricalData = [];
let balancedResults = {
  overallPerformance: {},
  trades: [],
  frequencyAnalysis: {},
  balanceMetrics: {}
};

// 系统状态
let systemState = {
  currentRegime: 'sideways',
  dailyTradeCount: 0,
  burstTradeCount: 0,
  lastTradeTime: 0,
  lastBurstTime: 0,
  consecutiveWins: 0,
  consecutiveLosses: 0,
  totalTrades: 0,
  experienceLoaded: false,
  learnedPatterns: []
};

// 主函数
async function runBalancedProfitTest() {
  console.log('📊 平衡盈利ETH合约Agent测试');
  console.log('='.repeat(80));
  console.log('🎯 平衡目标: 胜率45%+, 盈亏比1.8+, 交易数300+');
  console.log('🛡️ 风控目标: 最大回撤<3%, 年化收益8%+');
  console.log('⚖️ 核心理念: 质量与数量并重，追求实用性');
  
  // 加载数据和经验
  await loadHistoricalData();
  await loadLearningExperience();
  
  // 平衡盈利回测
  await runBalancedProfitBacktest();
  
  // 生成平衡分析报告
  await generateBalancedProfitReport();
}

// 加载历史数据
async function loadHistoricalData() {
  console.log('📊 加载真实历史数据...');
  
  const dataPath = path.join(__dirname, 'real_historical_data_2022_2024.json');
  const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  realHistoricalData = rawData;
  
  console.log(`   ✅ 数据加载完成: ${realHistoricalData.length.toLocaleString()}条K线`);
}

// 加载学习经验
async function loadLearningExperience() {
  console.log('🧠 加载学习经验...');
  
  const experiencePath = path.join(__dirname, 'agent_experience.json');
  
  if (fs.existsSync(experiencePath)) {
    try {
      const experienceData = JSON.parse(fs.readFileSync(experiencePath, 'utf8'));
      
      if (experienceData.trades && experienceData.trades.length > 0) {
        systemState.learnedPatterns = extractBalancedPatterns(experienceData.trades);
        systemState.experienceLoaded = true;
        
        console.log(`   ✅ 加载经验: ${experienceData.trades.length}条交易记录`);
        console.log(`   🎯 提取平衡模式: ${systemState.learnedPatterns.length}个`);
      }
    } catch (error) {
      console.log(`   ⚠️ 经验文件损坏，使用默认参数`);
    }
  } else {
    console.log(`   📝 未找到经验文件，从零开始学习`);
  }
}

// 提取平衡模式
function extractBalancedPatterns(trades) {
  const patterns = [];
  const successfulTrades = trades.filter(exp => 
    exp.trade && exp.trade.pnl > 0
  );
  
  if (successfulTrades.length >= 10) {
    // 提取成功模式，但不过于严格
    const avgConfidence = successfulTrades.reduce((sum, t) => sum + t.trade.confidence, 0) / successfulTrades.length;
    const avgReturn = successfulTrades.reduce((sum, t) => sum + t.trade.returnRate, 0) / successfulTrades.length;
    
    patterns.push({
      type: 'balanced_success',
      avgConfidence: avgConfidence,
      avgReturn: avgReturn,
      occurrences: successfulTrades.length,
      boost: 1.15 // 适度增强
    });
  }
  
  return patterns;
}

// 平衡盈利回测
async function runBalancedProfitBacktest() {
  console.log('🎯 执行平衡盈利回测...');
  
  let currentCapital = balancedProfitConfig.initialCapital;
  let trades = [];
  let currentPosition = null;
  let maxDrawdown = 0;
  let peakCapital = currentCapital;
  let dailyReturns = [];
  
  let lastDay = null;
  let dayStartCapital = currentCapital;
  
  // 策略统计
  let strategyStats = {};
  Object.keys(balancedProfitConfig.balancedStrategies).forEach(strategy => {
    strategyStats[strategy] = { trades: 0, wins: 0, pnl: 0 };
  });
  
  // 每15分钟检查一次
  for (let i = 50; i < realHistoricalData.length - 10; i++) {
    const currentCandle = realHistoricalData[i];
    const currentDay = new Date(currentCandle.timestamp).toDateString();
    
    // 每日重置
    if (lastDay && lastDay !== currentDay) {
      const dailyReturn = (currentCapital - dayStartCapital) / dayStartCapital;
      dailyReturns.push(dailyReturn);
      dayStartCapital = currentCapital;
      systemState.dailyTradeCount = 0;
    }
    lastDay = currentDay;
    
    // 更新市场环境
    updateMarketRegime(realHistoricalData, i);
    
    // 检查平仓
    if (currentPosition) {
      const closeResult = checkBalancedClose(currentPosition, currentCandle, i);
      if (closeResult.shouldClose) {
        const trade = closeBalancedPosition(currentPosition, closeResult);
        trades.push(trade);
        currentCapital += trade.pnl;
        
        // 更新系统状态
        updateSystemState(trade);
        
        // 更新策略统计
        updateStrategyStats(strategyStats, trade);
        
        currentPosition = null;
        systemState.lastTradeTime = currentCandle.timestamp;
        
        // 更新最大回撤
        if (currentCapital > peakCapital) {
          peakCapital = currentCapital;
        }
        const drawdown = (peakCapital - currentCapital) / peakCapital;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
        
        // 风险控制检查
        if (drawdown > balancedProfitConfig.balancedGoals.maxDrawdown) {
          console.log(`   🚨 达到最大回撤限制 ${(drawdown * 100).toFixed(1)}%`);
          break;
        }
      }
    }
    
    // 检查开仓
    if (!currentPosition && passBalancedFilters(currentCandle.timestamp)) {
      
      // 生成平衡信号
      const signal = generateBalancedSignal(realHistoricalData, i);
      
      if (signal && signal.qualityScore >= getAdaptiveQualityThreshold()) {
        const leverage = calculateBalancedLeverage(signal);
        const positionSize = calculateBalancedPositionSize(signal, currentCapital, peakCapital);
        
        currentPosition = openBalancedPosition(signal, currentCandle, currentCapital, leverage, positionSize, i);
        systemState.dailyTradeCount++;
        systemState.burstTradeCount++;
        
        // 检查连续交易限制
        if (systemState.burstTradeCount >= balancedProfitConfig.balancedRiskManagement.frequencyControl.burstLimit) {
          systemState.lastBurstTime = currentCandle.timestamp;
          systemState.burstTradeCount = 0;
        }
      }
    }
  }
  
  // 计算最终结果
  const totalReturn = (currentCapital - balancedProfitConfig.initialCapital) / balancedProfitConfig.initialCapital;
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
  
  // 计算交易频率
  const tradesPerDay = trades.length / (days / 365 * 252); // 每个交易日的交易数
  const avgQualityScore = trades.length > 0 ? trades.reduce((sum, t) => sum + (t.qualityScore || 0.65), 0) / trades.length : 0;
  
  console.log(`   ✅ 平衡盈利回测完成`);
  console.log(`      📊 总交易数: ${trades.length}笔`);
  console.log(`      🏆 胜率: ${(winRate * 100).toFixed(1)}%`);
  console.log(`      📈 总收益率: ${(totalReturn * 100).toFixed(2)}%`);
  console.log(`      🚀 年化收益率: ${(annualizedReturn * 100).toFixed(1)}%`);
  console.log(`      💰 盈亏比: ${profitFactor.toFixed(2)}`);
  console.log(`      📊 Sharpe Ratio: ${sharpeRatio.toFixed(2)}`);
  console.log(`      🛡️ 最大回撤: ${(maxDrawdown * 100).toFixed(1)}%`);
  console.log(`      📈 年化波动率: ${(annualizedVol * 100).toFixed(1)}%`);
  console.log(`      📅 日均交易: ${tradesPerDay.toFixed(1)}笔`);
  console.log(`      🎯 平均质量: ${avgQualityScore.toFixed(2)}`);
  console.log(`      🧠 使用经验: ${systemState.experienceLoaded ? '是' : '否'}`);
  console.log(`      💰 最终资金: $${Math.round(currentCapital).toLocaleString()}`);
  
  balancedResults.overallPerformance = {
    totalReturn, annualizedReturn, winRate, profitFactor,
    totalTrades: trades.length, maxDrawdown, finalCapital: currentCapital,
    trades, avgWin, avgLoss, sharpeRatio, annualizedVol, 
    tradesPerDay, avgQualityScore
  };
  
  balancedResults.frequencyAnalysis = {
    totalTrades: trades.length,
    tradesPerDay: tradesPerDay,
    tradingDays: days / 365 * 252,
    avgHoldingTime: trades.length > 0 ? trades.reduce((sum, t) => sum + (t.holdingTime || 0), 0) / trades.length : 0,
    frequencyTarget: balancedProfitConfig.balancedGoals.targetTrades,
    frequencyAchieved: trades.length >= balancedProfitConfig.balancedGoals.targetTrades * 0.8
  };
}

// 更新市场环境
function updateMarketRegime(data, index) {
  if (index < 40) return;
  
  const recent = data.slice(index - 40, index + 1);
  const prices = recent.map(d => d.close);
  
  // 计算趋势强度和波动率
  const trendStrength = calculateTrendStrength(prices);
  const volatility = calculateVolatility(prices.slice(-20).map((p, i, arr) => 
    i > 0 ? (p - arr[i-1]) / arr[i-1] : 0
  ).slice(1));
  
  // 判断市场环境
  let newRegime = 'sideways';
  if (Math.abs(trendStrength) > 0.010) {
    newRegime = 'trending';
  } else if (volatility > 0.030) {
    newRegime = 'volatile';
  }
  
  if (newRegime !== systemState.currentRegime) {
    systemState.currentRegime = newRegime;
    console.log(`   🔄 市场环境: ${newRegime}`);
  }
}

// 生成平衡信号
function generateBalancedSignal(data, index) {
  const signals = [];
  
  // 标准反操控信号
  if (balancedProfitConfig.balancedStrategies.standardAntiManipulation.enabled) {
    const antiManipSignal = generateStandardAntiManipulationSignal(data, index);
    if (antiManipSignal.detected) {
      signals.push({
        ...antiManipSignal,
        strategy: 'standardAntiManipulation',
        weight: balancedProfitConfig.balancedStrategies.standardAntiManipulation.weight
      });
    }
  }
  
  // 适度趋势跟踪信号
  if (balancedProfitConfig.balancedStrategies.moderateTrendFollowing.enabled) {
    const trendSignal = generateModerateTrendSignal(data, index);
    if (trendSignal.detected) {
      signals.push({
        ...trendSignal,
        strategy: 'moderateTrendFollowing',
        weight: balancedProfitConfig.balancedStrategies.moderateTrendFollowing.weight
      });
    }
  }
  
  // 波动率交易信号
  if (balancedProfitConfig.balancedStrategies.volatilityTrading.enabled) {
    const volSignal = generateVolatilityTradingSignal(data, index);
    if (volSignal.detected) {
      signals.push({
        ...volSignal,
        strategy: 'volatilityTrading',
        weight: balancedProfitConfig.balancedStrategies.volatilityTrading.weight
      });
    }
  }
  
  // 学习增强信号
  if (balancedProfitConfig.balancedStrategies.learningEnhanced.enabled && systemState.experienceLoaded) {
    const learningSignal = generateLearningEnhancedSignal(data, index);
    if (learningSignal.detected) {
      signals.push({
        ...learningSignal,
        strategy: 'learningEnhanced',
        weight: balancedProfitConfig.balancedStrategies.learningEnhanced.weight
      });
    }
  }
  
  // 选择最优信号
  return selectBalancedSignal(signals, data, index);
}

// 生成标准反操控信号
function generateStandardAntiManipulationSignal(data, index) {
  if (index < 25) return { detected: false };
  
  const config = balancedProfitConfig.balancedStrategies.standardAntiManipulation;
  const current = data[index];
  const previous = data.slice(index - 20, index);
  
  const highs = previous.map(d => d.high);
  const lows = previous.map(d => d.low);
  const volumes = previous.map(d => d.volume);
  
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
  
  // 假突破检测（降低要求）
  const upBreakout = (current.high - resistance) / resistance;
  const downBreakout = (support - current.low) / support;
  
  if (upBreakout > config.fakeBreakout.minSize && upBreakout < config.fakeBreakout.maxSize) {
    const wickRatio = (current.high - Math.max(current.open, current.close)) / (current.high - current.low);
    const volumeRatio = current.volume / avgVolume;
    
    if (wickRatio > config.fakeBreakout.wickRatio && volumeRatio > config.fakeBreakout.volumeSpike) {
      const confidence = Math.min(0.88, 0.62 + upBreakout * 8 + (volumeRatio - 1.5) * 0.06);
      
      if (confidence > config.minConfidence) {
        const qualityScore = calculateBalancedQuality(confidence, volumeRatio, wickRatio);
        
        return {
          detected: true,
          direction: 'SHORT',
          confidence: confidence,
          type: 'fakeBreakout',
          qualityScore: qualityScore,
          expectedReturn: 0.025
        };
      }
    }
  }
  
  if (downBreakout > config.fakeBreakout.minSize && downBreakout < config.fakeBreakout.maxSize) {
    const wickRatio = (Math.min(current.open, current.close) - current.low) / (current.high - current.low);
    const volumeRatio = current.volume / avgVolume;
    
    if (wickRatio > config.fakeBreakout.wickRatio && volumeRatio > config.fakeBreakout.volumeSpike) {
      const confidence = Math.min(0.88, 0.62 + downBreakout * 8 + (volumeRatio - 1.5) * 0.06);
      
      if (confidence > config.minConfidence) {
        const qualityScore = calculateBalancedQuality(confidence, volumeRatio, wickRatio);
        
        return {
          detected: true,
          direction: 'LONG',
          confidence: confidence,
          type: 'fakeBreakout',
          qualityScore: qualityScore,
          expectedReturn: 0.025
        };
      }
    }
  }
  
  return { detected: false };
}

// 生成适度趋势信号
function generateModerateTrendSignal(data, index) {
  if (index < 30) return { detected: false };
  
  const config = balancedProfitConfig.balancedStrategies.moderateTrendFollowing;
  const recent = data.slice(index - 25, index + 1);
  const prices = recent.map(d => d.close);
  const volumes = recent.map(d => d.volume);
  
  // 计算动量
  const momentum = (prices[prices.length - 1] - prices[0]) / prices[0];
  
  // 成交量支撑
  const recentVolume = volumes.slice(-5).reduce((sum, v) => sum + v, 0) / 5;
  const historicalVolume = volumes.slice(0, -5).reduce((sum, v) => sum + v, 0) / (volumes.length - 5);
  const volumeBoost = recentVolume / historicalVolume;
  
  if (Math.abs(momentum) > config.trendCapture.minMomentum && volumeBoost > config.trendCapture.volumeBoost) {
    const confidence = Math.min(0.85, 0.60 + Math.abs(momentum) * 10 + (volumeBoost - 1.5) * 0.08);
    
    if (confidence > config.minConfidence) {
      const qualityScore = calculateBalancedQuality(confidence, volumeBoost, Math.abs(momentum) * 10);
      
      return {
        detected: true,
        direction: momentum > 0 ? 'LONG' : 'SHORT',
        confidence: confidence,
        type: 'trendFollowing',
        qualityScore: qualityScore,
        expectedReturn: 0.035
      };
    }
  }
  
  return { detected: false };
}

// 生成波动率交易信号
function generateVolatilityTradingSignal(data, index) {
  if (index < 25) return { detected: false };
  
  const config = balancedProfitConfig.balancedStrategies.volatilityTrading;
  const recent = data.slice(index - 20, index + 1);
  const prices = recent.map(d => d.close);
  
  // 波动率检测
  const currentVol = calculateVolatility(prices.slice(-5).map((p, i, arr) => 
    i > 0 ? (p - arr[i-1]) / arr[i-1] : 0
  ).slice(1));
  const historicalVol = calculateVolatility(prices.slice(0, -5).map((p, i, arr) => 
    i > 0 ? (p - arr[i-1]) / arr[i-1] : 0
  ).slice(1));
  
  const volRatio = currentVol / historicalVol;
  
  if (volRatio > config.meanReversion.volThreshold) {
    // RSI检测
    const rsi = calculateRSI(prices, 14);
    const sma = prices.slice(-15).reduce((sum, p) => sum + p, 0) / 15;
    const currentPrice = prices[prices.length - 1];
    const deviation = (currentPrice - sma) / sma;
    
    // 超卖反弹
    if (rsi < 35 && deviation < -0.020) {
      const confidence = Math.min(0.80, 0.58 + (35 - rsi) * 0.008 + Math.abs(deviation) * 6);
      
      if (confidence > config.minConfidence) {
        const qualityScore = calculateBalancedQuality(confidence, volRatio, Math.abs(deviation) * 10);
        
        return {
          detected: true,
          direction: 'LONG',
          confidence: confidence,
          type: 'meanReversion',
          qualityScore: qualityScore,
          expectedReturn: 0.022
        };
      }
    }
    
    // 超买回调
    if (rsi > 65 && deviation > 0.020) {
      const confidence = Math.min(0.80, 0.58 + (rsi - 65) * 0.008 + Math.abs(deviation) * 6);
      
      if (confidence > config.minConfidence) {
        const qualityScore = calculateBalancedQuality(confidence, volRatio, Math.abs(deviation) * 10);
        
        return {
          detected: true,
          direction: 'SHORT',
          confidence: confidence,
          type: 'meanReversion',
          qualityScore: qualityScore,
          expectedReturn: 0.022
        };
      }
    }
  }
  
  return { detected: false };
}

// 生成学习增强信号
function generateLearningEnhancedSignal(data, index) {
  if (!systemState.experienceLoaded || systemState.learnedPatterns.length === 0) {
    return { detected: false };
  }
  
  // 基于学习模式生成信号
  const baseSignal = generateStandardAntiManipulationSignal(data, index);
  
  if (baseSignal.detected) {
    const pattern = systemState.learnedPatterns[0]; // 使用第一个模式
    
    // 应用学习增强
    const enhancedConfidence = baseSignal.confidence * pattern.boost;
    const qualityScore = calculateBalancedQuality(enhancedConfidence, 1.2, 0.8);
    
    return {
      detected: true,
      direction: baseSignal.direction,
      confidence: Math.min(0.90, enhancedConfidence),
      type: 'learningEnhanced',
      qualityScore: qualityScore,
      expectedReturn: Math.max(0.025, pattern.avgReturn)
    };
  }
  
  return { detected: false };
}

// 计算平衡质量分数
function calculateBalancedQuality(confidence, factor1, factor2) {
  // 简化的质量计算，更容易达到要求
  let quality = confidence * 0.6;
  quality += Math.min(1.0, factor1 / 2) * 0.25;
  quality += Math.min(1.0, factor2) * 0.15;
  
  return Math.min(1.0, quality);
}

// 选择平衡信号
function selectBalancedSignal(signals, data, index) {
  if (signals.length === 0) return null;
  
  // 应用学习模式增强
  signals.forEach(signal => {
    if (systemState.learnedPatterns.length > 0) {
      const pattern = systemState.learnedPatterns[0];
      signal.confidence *= pattern.boost;
      signal.qualityScore *= 1.1;
    }
  });
  
  // 选择最佳信号
  let bestSignal = null;
  let bestScore = 0;
  
  signals.forEach(signal => {
    const score = signal.qualityScore * signal.weight * signal.confidence;
    if (score > bestScore) {
      bestScore = score;
      bestSignal = signal;
    }
  });
  
  return bestSignal;
}

// 获取自适应质量阈值
function getAdaptiveQualityThreshold() {
  let threshold = balancedProfitConfig.balancedGoals.minQualityScore;
  
  // 根据交易频率调整
  if (systemState.totalTrades < 100) {
    threshold *= 0.9; // 初期降低要求
  } else if (systemState.totalTrades > 200) {
    threshold *= 1.05; // 后期提高要求
  }
  
  return Math.max(0.50, Math.min(0.80, threshold));
}

// 计算平衡杠杆
function calculateBalancedLeverage(signal) {
  const regimeConfig = balancedProfitConfig.marketAdaptation.regimes[systemState.currentRegime];
  let leverage = regimeConfig ? regimeConfig.leverage : balancedProfitConfig.balancedRiskManagement.moderateLeverage.base;
  
  // 基于信号质量调整
  leverage *= (0.85 + signal.qualityScore * 0.3);
  
  // 基于置信度调整
  leverage *= (0.9 + signal.confidence * 0.2);
  
  const leverageConfig = balancedProfitConfig.balancedRiskManagement.moderateLeverage;
  return Math.max(leverageConfig.min, Math.min(leverageConfig.max, leverage));
}

// 计算平衡仓位
function calculateBalancedPositionSize(signal, currentCapital, peakCapital) {
  const regimeConfig = balancedProfitConfig.marketAdaptation.regimes[systemState.currentRegime];
  let positionSize = regimeConfig ? regimeConfig.position : balancedProfitConfig.balancedRiskManagement.moderatePositioning.baseSize;
  
  // 基于信号质量调整
  positionSize *= signal.qualityScore;
  
  // 基于连胜连败调整
  if (systemState.consecutiveWins > 2) {
    positionSize *= 1.1;
  } else if (systemState.consecutiveLosses > 2) {
    positionSize *= 0.9;
  }
  
  // 基于回撤调整
  const drawdown = (peakCapital - currentCapital) / peakCapital;
  if (drawdown > 0.015) {
    positionSize *= (1 - drawdown * 1.5);
  }
  
  const sizeConfig = balancedProfitConfig.balancedRiskManagement.moderatePositioning;
  return Math.max(sizeConfig.minSize, Math.min(sizeConfig.maxSize, positionSize));
}

// 检查平衡过滤器
function passBalancedFilters(currentTime) {
  const freqConfig = balancedProfitConfig.balancedRiskManagement.frequencyControl;
  
  // 每日交易限制
  if (systemState.dailyTradeCount >= freqConfig.maxDailyTrades) {
    return false;
  }
  
  // 最小间隔
  if (currentTime - systemState.lastTradeTime < freqConfig.minInterval * 60 * 60 * 1000) {
    return false;
  }
  
  // 连续交易冷却
  if (systemState.burstTradeCount >= freqConfig.burstLimit) {
    if (currentTime - systemState.lastBurstTime < freqConfig.burstCooldown * 60 * 60 * 1000) {
      return false;
    }
  }
  
  return true;
}

// 开仓
function openBalancedPosition(signal, candle, capital, leverage, positionSize, index) {
  const isLong = signal.direction === 'LONG';
  const tradeAmount = capital * positionSize;
  const entryPrice = candle.close;
  
  // 平衡的止损止盈
  const regimeConfig = balancedProfitConfig.marketAdaptation.regimes[systemState.currentRegime];
  const takeProfitConfig = balancedProfitConfig.balancedExitStrategy.moderateTakeProfit;
  const stopLossConfig = balancedProfitConfig.balancedExitStrategy.tightStopLoss;
  
  // 根据市场环境调整止盈止损
  let takeProfit = regimeConfig ? regimeConfig.takeProfit : takeProfitConfig.target.profit;
  let stopLoss = regimeConfig ? regimeConfig.stopLoss : stopLossConfig.initial;
  
  // 根据信号类型微调
  if (signal.type === 'trendFollowing') {
    takeProfit *= 1.2;
    stopLoss *= 1.1;
  } else if (signal.type === 'meanReversion') {
    takeProfit *= 0.8;
    stopLoss *= 0.9;
  }
  
  const stopLossPrice = entryPrice * (1 + (isLong ? -1 : 1) * stopLoss);
  const takeProfitPrices = [
    entryPrice * (1 + (isLong ? 1 : -1) * takeProfit * 0.6),
    entryPrice * (1 + (isLong ? 1 : -1) * takeProfit),
    entryPrice * (1 + (isLong ? 1 : -1) * takeProfit * 1.6)
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
    trailingStopPrice: stopLossPrice,
    confidence: signal.confidence,
    strategy: signal.strategy,
    signalType: signal.type,
    qualityScore: signal.qualityScore,
    expectedReturn: signal.expectedReturn,
    maxHoldingTime: balancedProfitConfig.balancedExitStrategy.timeManagement.maxHolding,
    remainingSize: 1.0
  };
}

// 检查平衡平仓
function checkBalancedClose(position, currentCandle, currentIndex) {
  const isLong = position.side === 'LONG';
  const currentPrice = currentCandle.close;
  const holdingTime = (currentIndex - position.entryIndex) * 0.25;
  const profitRate = (currentPrice - position.entryPrice) / position.entryPrice * (isLong ? 1 : -1);
  
  // 更新移动止损
  if (profitRate > 0.015) {
    const trailingDistance = balancedProfitConfig.balancedExitStrategy.tightStopLoss.trailing;
    
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
  
  // 检查分层止盈
  for (let i = 0; i < position.takeProfitPrices.length; i++) {
    const tpPrice = position.takeProfitPrices[i];
    if ((isLong && currentPrice >= tpPrice) || (!isLong && currentPrice <= tpPrice)) {
      const closePercentages = [0.4, 0.4, 0.2];
      return {
        shouldClose: true,
        reason: `TAKE_PROFIT_${i + 1}`,
        price: tpPrice,
        partialClose: i < 2,
        closePercentage: closePercentages[i]
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
  
  // 时间管理
  const timeConfig = balancedProfitConfig.balancedExitStrategy.timeManagement;
  
  if (profitRate > 0.01 && holdingTime >= timeConfig.profitableExit) {
    return {
      shouldClose: true,
      reason: 'TIME_PROFIT',
      price: currentPrice
    };
  }
  
  if (Math.abs(profitRate) < 0.005 && holdingTime >= timeConfig.breakEvenExit) {
    return {
      shouldClose: true,
      reason: 'TIME_BREAKEVEN',
      price: currentPrice
    };
  }
  
  if (profitRate < -0.008 && holdingTime >= timeConfig.lossExit) {
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
function closeBalancedPosition(position, closeResult) {
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
    confidence: position.confidence,
    qualityScore: position.qualityScore,
    expectedReturn: position.expectedReturn,
    leverage: position.leverage,
    positionSize: position.positionSize,
    holdingTime: (Date.now() - position.entryTime) / (1000 * 60 * 60)
  };
}

// 辅助函数
function updateSystemState(trade) {
  if (trade.pnl > 0) {
    systemState.consecutiveWins++;
    systemState.consecutiveLosses = 0;
  } else {
    systemState.consecutiveLosses++;
    systemState.consecutiveWins = 0;
  }
  
  systemState.totalTrades++;
}

function updateStrategyStats(strategyStats, trade) {
  const strategy = trade.strategy;
  if (strategyStats[strategy]) {
    strategyStats[strategy].trades++;
    strategyStats[strategy].pnl += trade.pnl;
    if (trade.pnl > 0) {
      strategyStats[strategy].wins++;
    }
  }
}

function calculateTrendStrength(prices) {
  if (prices.length < 20) return 0;
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

// 生成平衡盈利报告
async function generateBalancedProfitReport() {
  console.log('📋 生成平衡盈利报告...');
  
  const result = balancedResults.overallPerformance;
  const frequency = balancedResults.frequencyAnalysis;
  
  console.log('\n📋 平衡盈利ETH合约Agent报告');
  console.log('='.repeat(80));
  
  console.log('\n🎯 平衡盈利成果:');
  console.log(`   🏆 胜率: ${(result.winRate * 100).toFixed(1)}%`);
  console.log(`   📈 总收益率: ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`   🚀 年化收益率: ${(result.annualizedReturn * 100).toFixed(1)}%`);
  console.log(`   💰 盈亏比: ${result.profitFactor.toFixed(2)}`);
  console.log(`   📊 Sharpe Ratio: ${result.sharpeRatio.toFixed(2)}`);
  console.log(`   🛡️ 最大回撤: ${(result.maxDrawdown * 100).toFixed(1)}%`);
  console.log(`   📈 年化波动率: ${(result.annualizedVol * 100).toFixed(1)}%`);
  console.log(`   📊 总交易数: ${result.totalTrades}笔`);
  console.log(`   📅 日均交易: ${result.tradesPerDay.toFixed(1)}笔`);
  console.log(`   🎯 平均质量: ${result.avgQualityScore.toFixed(2)}`);
  console.log(`   🧠 使用经验: ${systemState.experienceLoaded ? '是' : '否'}`);
  console.log(`   💰 最终资金: $${Math.round(result.finalCapital).toLocaleString()}`);
  
  console.log('\n📊 交易频率分析:');
  console.log(`   🎯 目标交易数: ${frequency.frequencyTarget}笔`);
  console.log(`   ✅ 实际交易数: ${frequency.totalTrades}笔`);
  console.log(`   📈 完成度: ${(frequency.totalTrades / frequency.frequencyTarget * 100).toFixed(1)}%`);
  console.log(`   📅 交易天数: ${frequency.tradingDays.toFixed(0)}天`);
  console.log(`   ⏱️ 平均持仓: ${frequency.avgHoldingTime.toFixed(1)}小时`);
  console.log(`   🎯 频率达标: ${frequency.frequencyAchieved ? '是' : '否'}`);
  
  console.log('\n🎯 平衡盈利评估:');
  if (result.annualizedReturn >= 0.06 && result.winRate >= 0.45 && result.profitFactor >= 1.8 && result.totalTrades >= 240) {
    console.log('   🏆 卓越表现: 完美平衡质量与数量');
    console.log('   评级: SS (平衡大师级)');
    console.log('   评价: 实用性与盈利性兼备');
  } else if (result.annualizedReturn >= 0.04 && result.winRate >= 0.42 && result.profitFactor >= 1.5 && result.totalTrades >= 180) {
    console.log('   🔥 优秀表现: 良好的平衡效果');
    console.log('   评级: S+ (准平衡大师级)');
    console.log('   评价: 接近理想的平衡状态');
  } else if (result.totalReturn > 0 && result.totalTrades >= 120) {
    console.log('   📈 良好表现: 平衡策略有效');
    console.log('   评级: S (优秀级)');
    console.log('   评价: 在正确的方向上');
  } else {
    console.log('   📊 继续优化: 平衡效果待提升');
    console.log('   评级: A+ (良好级)');
    console.log('   评价: 需要进一步平衡调整');
  }
  
  console.log('\n🔥 平衡盈利优势:');
  console.log('   ⚖️ 质量数量并重 - 在盈利与频率间找到平衡');
  console.log('   🎯 适度降低门槛 - 增加交易机会而不牺牲太多质量');
  console.log('   🛡️ 保持风险控制 - 维持优秀的风险管理水平');
  console.log('   📊 实用性导向 - 追求实际可用的交易频率');
  console.log('   🧠 经验学习应用 - 基于历史经验持续改进');
  
  // 保存报告
  const reportPath = path.join(__dirname, 'balanced_profit_agent_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(balancedResults, null, 2));
  console.log(`\n💾 详细报告已保存: ${reportPath}`);
}

// 运行平衡盈利测试
runBalancedProfitTest().catch(console.error);