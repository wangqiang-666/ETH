#!/usr/bin/env node

/**
 * 信号调试分析脚本
 * 目标：找出为什么所有策略都无交易的根本原因
 * 方法：逐步调试信号生成和过滤逻辑，添加详细日志
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔍 启动信号调试分析...\n');

// 调试配置 - 极度放宽的条件
const debugConfig = {
  symbol: 'ETH-USDT-SWAP',
  initialCapital: 100000,
  
  // 极度放宽的信号过滤
  signalFilters: {
    minConfidence: 0.1,         // 极低置信度 10%
    timeframeAgreement: 0.1,    // 极低一致性 10%
    dataQualityThreshold: 0.1,  // 极低质量 10%
    marketStateFilter: ['BULL', 'BEAR', 'SIDEWAYS', 'VOLATILE', 'ANY'] // 任何状态
  },
  
  // 极度放宽的做多做空条件
  longShortConfig: {
    longConditions: {
      minTrendStrength: 0.001,  // 极低趋势强度 0.1%
      maxRSI: 95,              // 极高RSI上限
      macdRequired: false,      // 不要求MACD
      supportBounce: false      // 不要求支撑反弹
    },
    shortConditions: {
      minTrendStrength: -0.001, // 极低趋势强度 -0.1%
      minRSI: 5,               // 极低RSI下限
      macdRequired: false,      // 不要求MACD
      resistanceReject: false   // 不要求阻力拒绝
    }
  },
  
  // 调试开关
  debug: {
    enabled: true,
    logSignals: true,
    logFilters: true,
    logTrades: true,
    maxLogs: 50,              // 最多显示50条日志
    sampleInterval: 100       // 每100个数据点采样一次
  }
};

// 调试统计
let debugStats = {
  totalDataPoints: 0,
  signalsGenerated: 0,
  signalsFiltered: 0,
  signalsExecuted: 0,
  longSignals: 0,
  shortSignals: 0,
  holdSignals: 0,
  filterReasons: {},
  signalDetails: []
};

// 主函数
async function runSignalDebugAnalysis() {
  console.log('🔍 信号调试分析');
  console.log('='.repeat(80));
  console.log('🎯 目标: 找出为什么所有策略都无交易的根本原因');
  console.log('🔧 方法: 逐步调试信号生成和过滤逻辑');
  
  // 第一阶段：生成测试数据
  console.log('\n📊 第一阶段：生成测试数据');
  console.log('='.repeat(50));
  const testData = generateDebugTestData();
  
  // 第二阶段：信号生成调试
  console.log('\n🎯 第二阶段：信号生成调试');
  console.log('='.repeat(50));
  await debugSignalGeneration(testData);
  
  // 第三阶段：过滤逻辑调试
  console.log('\n🔍 第三阶段：过滤逻辑调试');
  console.log('='.repeat(50));
  await debugFilterLogic(testData);
  
  // 第四阶段：生成调试报告
  console.log('\n📋 第四阶段：生成调试报告');
  console.log('='.repeat(50));
  await generateDebugReport();
}

// 生成调试测试数据
function generateDebugTestData() {
  console.log('📊 生成调试测试数据...');
  
  const dataPoints = 1000; // 1000个数据点用于调试
  const data = [];
  let currentPrice = 2000; // 起始价格$2000
  
  console.log(`   📈 生成${dataPoints}个数据点...`);
  
  for (let i = 0; i < dataPoints; i++) {
    // 生成多样化的价格变化
    let priceChange;
    
    if (i < 200) {
      // 前200个点：下跌趋势（测试做空信号）
      priceChange = -0.005 + Math.random() * 0.003; // -0.5% to -0.2%
    } else if (i < 400) {
      // 200-400：震荡（测试震荡信号）
      priceChange = (Math.random() - 0.5) * 0.004; // -0.2% to +0.2%
    } else if (i < 600) {
      // 400-600：上涨趋势（测试做多信号）
      priceChange = 0.002 + Math.random() * 0.003; // +0.2% to +0.5%
    } else if (i < 800) {
      // 600-800：高波动（测试高波动信号）
      priceChange = (Math.random() - 0.5) * 0.02; // -1% to +1%
    } else {
      // 800-1000：低波动（测试低波动信号）
      priceChange = (Math.random() - 0.5) * 0.001; // -0.05% to +0.05%
    }
    
    currentPrice = currentPrice * (1 + priceChange);
    
    // 生成成交量
    const baseVolume = 500000;
    const volume = baseVolume * (0.8 + Math.random() * 0.4);
    
    data.push({
      timestamp: Date.now() + i * 15 * 60 * 1000,
      open: i === 0 ? currentPrice : data[i-1].close,
      high: currentPrice * (1 + Math.random() * 0.002),
      low: currentPrice * (1 - Math.random() * 0.002),
      close: currentPrice,
      volume: volume,
      symbol: 'ETH-USDT',
      index: i
    });
  }
  
  debugStats.totalDataPoints = dataPoints;
  
  console.log(`   ✅ 测试数据生成完成: ${dataPoints}个数据点`);
  console.log(`   📈 价格范围: $${data[0].close.toFixed(2)} - $${data[dataPoints-1].close.toFixed(2)}`);
  console.log(`   📊 价格变化: ${((data[dataPoints-1].close / data[0].close - 1) * 100).toFixed(2)}%`);
  
  return data;
}

// 调试信号生成
async function debugSignalGeneration(data) {
  console.log('🎯 调试信号生成逻辑...');
  
  let logCount = 0;
  const maxLogs = debugConfig.debug.maxLogs;
  const sampleInterval = debugConfig.debug.sampleInterval;
  
  console.log(`   🔍 采样间隔: 每${sampleInterval}个数据点`);
  console.log(`   📝 最多显示: ${maxLogs}条日志\n`);
  
  for (let i = 50; i < data.length; i += sampleInterval) {
    debugStats.signalsGenerated++;
    
    // 生成信号
    const signal = generateDebugSignal(data, i);
    
    // 记录信号统计
    if (signal.action === 'HOLD') {
      debugStats.holdSignals++;
    } else if (signal.action.includes('LONG')) {
      debugStats.longSignals++;
    } else if (signal.action.includes('SHORT')) {
      debugStats.shortSignals++;
    }
    
    // 记录详细信息
    debugStats.signalDetails.push({
      index: i,
      price: data[i].close,
      signal: signal,
      timestamp: data[i].timestamp
    });
    
    // 显示调试日志
    if (logCount < maxLogs && (signal.action !== 'HOLD' || logCount < 10)) {
      console.log(`   📊 [${i}] 价格: $${data[i].close.toFixed(2)} | 信号: ${signal.action} | 置信度: ${(signal.confidence * 100).toFixed(1)}%`);
      
      if (signal.action !== 'HOLD') {
        console.log(`        📈 趋势: ${(signal.trend * 100).toFixed(2)}% | RSI: ${signal.rsi.toFixed(1)} | MACD: ${signal.macd.histogram.toFixed(4)}`);
        console.log(`        📊 成交量比: ${signal.volumeRatio.toFixed(2)} | 支撑: ${signal.nearSupport} | 阻力: ${signal.nearResistance}`);
      }
      
      logCount++;
    }
    
    await sleep(10); // 避免输出过快
  }
  
  console.log(`\n   📊 信号生成统计:`);
  console.log(`      总信号数: ${debugStats.signalsGenerated}`);
  console.log(`      HOLD信号: ${debugStats.holdSignals} (${(debugStats.holdSignals/debugStats.signalsGenerated*100).toFixed(1)}%)`);
  console.log(`      LONG信号: ${debugStats.longSignals} (${(debugStats.longSignals/debugStats.signalsGenerated*100).toFixed(1)}%)`);
  console.log(`      SHORT信号: ${debugStats.shortSignals} (${(debugStats.shortSignals/debugStats.signalsGenerated*100).toFixed(1)}%)`);
}

// 生成调试信号
function generateDebugSignal(data, index) {
  if (index < 20) {
    return { action: 'HOLD', confidence: 0, trend: 0, rsi: 50, macd: {histogram: 0}, volumeRatio: 1, nearSupport: false, nearResistance: false };
  }
  
  const prices = data.slice(Math.max(0, index - 20), index + 1).map(d => d.close);
  const volumes = data.slice(Math.max(0, index - 20), index + 1).map(d => d.volume);
  const currentPrice = prices[prices.length - 1];
  
  // 计算技术指标
  const rsi = calculateRSI(prices, 14);
  const macd = calculateMACD(prices);
  const trend = calculateTrend(prices);
  const volatility = calculateVolatility(prices);
  
  // 成交量分析
  const avgVolume = volumes.slice(-10).reduce((sum, v) => sum + v, 0) / 10;
  const currentVolume = volumes[volumes.length - 1];
  const volumeRatio = currentVolume / avgVolume;
  
  // 支撑阻力分析
  const nearSupport = isNearSupport(prices, currentPrice);
  const nearResistance = isNearResistance(prices, currentPrice);
  
  // 信号生成逻辑 - 使用极度放宽的条件
  let action = 'HOLD';
  let confidence = 0.5;
  
  const longConditions = debugConfig.longShortConfig.longConditions;
  const shortConditions = debugConfig.longShortConfig.shortConditions;
  
  // 做多信号 - 极度放宽的条件
  if (trend > longConditions.minTrendStrength && rsi < longConditions.maxRSI) {
    confidence = 0.5 + Math.abs(trend) * 10;
    action = confidence > 0.7 ? 'STRONG_LONG' : 'WEAK_LONG';
  }
  // 做空信号 - 极度放宽的条件
  else if (trend < shortConditions.minTrendStrength && rsi > shortConditions.minRSI) {
    confidence = 0.5 + Math.abs(trend) * 10;
    action = confidence > 0.7 ? 'STRONG_SHORT' : 'WEAK_SHORT';
  }
  
  return {
    action: action,
    confidence: Math.max(0, Math.min(1, confidence)),
    trend: trend,
    rsi: rsi,
    macd: macd,
    volatility: volatility,
    volumeRatio: volumeRatio,
    nearSupport: nearSupport,
    nearResistance: nearResistance
  };
}

// 调试过滤逻辑
async function debugFilterLogic(data) {
  console.log('🔍 调试过滤逻辑...');
  
  let logCount = 0;
  const maxLogs = debugConfig.debug.maxLogs;
  const sampleInterval = debugConfig.debug.sampleInterval;
  
  console.log(`   🔍 测试极度放宽的过滤条件...\n`);
  
  for (let i = 50; i < data.length; i += sampleInterval) {
    const signal = generateDebugSignal(data, i);
    
    if (signal.action !== 'HOLD') {
      const filterResult = debugPassFilters(signal);
      
      if (filterResult.passed) {
        debugStats.signalsExecuted++;
        
        if (logCount < maxLogs) {
          console.log(`   ✅ [${i}] 信号通过: ${signal.action} | 置信度: ${(signal.confidence * 100).toFixed(1)}%`);
          logCount++;
        }
      } else {
        debugStats.signalsFiltered++;
        
        if (logCount < maxLogs) {
          console.log(`   ❌ [${i}] 信号被过滤: ${signal.action} | 原因: ${filterResult.reason}`);
          
          // 记录过滤原因统计
          if (!debugStats.filterReasons[filterResult.reason]) {
            debugStats.filterReasons[filterResult.reason] = 0;
          }
          debugStats.filterReasons[filterResult.reason]++;
          
          logCount++;
        }
      }
    }
    
    await sleep(5);
  }
  
  console.log(`\n   📊 过滤逻辑统计:`);
  console.log(`      信号通过: ${debugStats.signalsExecuted}`);
  console.log(`      信号被过滤: ${debugStats.signalsFiltered}`);
  console.log(`      通过率: ${debugStats.signalsExecuted > 0 ? (debugStats.signalsExecuted/(debugStats.signalsExecuted + debugStats.signalsFiltered)*100).toFixed(1) : 0}%`);
  
  if (Object.keys(debugStats.filterReasons).length > 0) {
    console.log(`\n   📋 过滤原因统计:`);
    Object.entries(debugStats.filterReasons).forEach(([reason, count]) => {
      console.log(`      ${reason}: ${count}次`);
    });
  }
}

// 调试过滤器
function debugPassFilters(signal) {
  const filters = debugConfig.signalFilters;
  
  // 置信度过滤
  if (signal.confidence < filters.minConfidence) {
    return { passed: false, reason: `置信度过低 (${(signal.confidence * 100).toFixed(1)}% < ${(filters.minConfidence * 100).toFixed(1)}%)` };
  }
  
  // 数据质量过滤
  if (signal.volatility > 0.1) { // 极度放宽的波动率限制
    return { passed: false, reason: `波动率过高 (${(signal.volatility * 100).toFixed(2)}% > 10%)` };
  }
  
  // 成交量确认 - 极度放宽
  if (signal.volumeRatio < 0.5) {
    return { passed: false, reason: `成交量过低 (${signal.volumeRatio.toFixed(2)} < 0.5)` };
  }
  
  return { passed: true, reason: '通过所有过滤条件' };
}

// 生成调试报告
async function generateDebugReport() {
  console.log('📋 生成调试报告...');
  
  console.log('\n📋 信号调试分析报告');
  console.log('='.repeat(80));
  
  console.log('\n🎯 调试概况:');
  console.log(`   测试数据点: ${debugStats.totalDataPoints}`);
  console.log(`   信号生成数: ${debugStats.signalsGenerated}`);
  console.log(`   信号通过数: ${debugStats.signalsExecuted}`);
  console.log(`   信号被过滤: ${debugStats.signalsFiltered}`);
  console.log(`   总体通过率: ${debugStats.signalsExecuted > 0 ? (debugStats.signalsExecuted/(debugStats.signalsExecuted + debugStats.signalsFiltered)*100).toFixed(1) : 0}%`);
  
  console.log('\n📊 信号类型分布:');
  console.log(`   HOLD信号: ${debugStats.holdSignals} (${(debugStats.holdSignals/debugStats.signalsGenerated*100).toFixed(1)}%)`);
  console.log(`   LONG信号: ${debugStats.longSignals} (${(debugStats.longSignals/debugStats.signalsGenerated*100).toFixed(1)}%)`);
  console.log(`   SHORT信号: ${debugStats.shortSignals} (${(debugStats.shortSignals/debugStats.signalsGenerated*100).toFixed(1)}%)`);
  
  console.log('\n🔍 问题诊断:');
  
  if (debugStats.longSignals === 0 && debugStats.shortSignals === 0) {
    console.log('   🚨 严重问题: 没有生成任何LONG或SHORT信号');
    console.log('   📋 可能原因:');
    console.log('      1. 信号生成逻辑存在错误');
    console.log('      2. 技术指标计算有问题');
    console.log('      3. 信号条件设置过于严格');
    console.log('   🔧 建议解决方案:');
    console.log('      1. 检查趋势计算逻辑');
    console.log('      2. 验证RSI计算是否正确');
    console.log('      3. 进一步放宽信号生成条件');
  } else if (debugStats.signalsExecuted === 0) {
    console.log('   ⚠️ 过滤问题: 生成了信号但都被过滤掉');
    console.log('   📋 过滤原因分析:');
    Object.entries(debugStats.filterReasons).forEach(([reason, count]) => {
      console.log(`      ${reason}: ${count}次 (${(count/debugStats.signalsFiltered*100).toFixed(1)}%)`);
    });
    console.log('   🔧 建议解决方案:');
    console.log('      1. 进一步放宽过滤条件');
    console.log('      2. 检查过滤逻辑是否合理');
    console.log('      3. 调整技术指标阈值');
  } else {
    console.log('   ✅ 基本正常: 能够生成和通过信号');
    console.log(`   📊 通过率: ${(debugStats.signalsExecuted/(debugStats.signalsExecuted + debugStats.signalsFiltered)*100).toFixed(1)}%`);
    console.log('   🔧 优化建议:');
    console.log('      1. 可以适当提高信号质量要求');
    console.log('      2. 优化信号生成逻辑');
    console.log('      3. 调整过滤条件平衡');
  }
  
  console.log('\n💡 核心洞察:');
  if (debugStats.signalsExecuted > 0) {
    console.log('   • 信号生成和过滤逻辑基本正常');
    console.log('   • 问题可能在于原始策略的过滤条件过于严格');
    console.log('   • 建议在原始策略中适度放宽过滤条件');
  } else {
    console.log('   • 存在根本性的信号生成或过滤问题');
    console.log('   • 需要重新检查技术指标计算逻辑');
    console.log('   • 建议从最基础的信号条件开始调试');
  }
  
  console.log('\n🚀 下一步建议:');
  if (debugStats.signalsExecuted > 0) {
    console.log('   1. 在原始策略中应用调试得出的参数');
    console.log('   2. 逐步收紧过滤条件以提高信号质量');
    console.log('   3. 测试杠杆效果');
  } else {
    console.log('   1. 进一步简化信号生成条件');
    console.log('   2. 检查技术指标计算函数');
    console.log('   3. 使用更基础的信号逻辑');
  }
  
  // 保存详细调试报告
  const reportPath = path.join(__dirname, 'signal_debug_analysis_report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    testDate: new Date().toISOString().split('T')[0],
    debugConfig: debugConfig,
    debugStats: debugStats,
    conclusion: debugStats.signalsExecuted > 0 ? 'FILTER_TOO_STRICT' : 'SIGNAL_GENERATION_ISSUE'
  }, null, 2));
  
  console.log(`\n💾 详细调试报告已保存: ${reportPath}`);
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

function calculateMACD(prices) {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  const signal = macd * 0.9;
  const histogram = macd - signal;
  
  return { macd, signal, histogram };
}

function calculateEMA(prices, period) {
  if (prices.length < period) return prices[prices.length - 1];
  
  const multiplier = 2 / (period + 1);
  let ema = prices[0];
  
  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
  }
  
  return ema;
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

function isNearSupport(prices, currentPrice) {
  const lows = [];
  for (let i = 2; i < prices.length - 2; i++) {
    if (prices[i] < prices[i-1] && prices[i] < prices[i-2] && 
        prices[i] < prices[i+1] && prices[i] < prices[i+2]) {
      lows.push(prices[i]);
    }
  }
  const nearestSupport = lows.length > 0 ? Math.max(...lows.filter(l => l < currentPrice)) : currentPrice * 0.95;
  return Math.abs(currentPrice - nearestSupport) / currentPrice < 0.05; // 放宽到5%
}

function isNearResistance(prices, currentPrice) {
  const highs = [];
  for (let i = 2; i < prices.length - 2; i++) {
    if (prices[i] > prices[i-1] && prices[i] > prices[i-2] && 
        prices[i] > prices[i+1] && prices[i] > prices[i+2]) {
      highs.push(prices[i]);
    }
  }
  const nearestResistance = highs.length > 0 ? Math.min(...highs.filter(h => h > currentPrice)) : currentPrice * 1.05;
  return Math.abs(nearestResistance - currentPrice) / currentPrice < 0.05; // 放宽到5%
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 运行信号调试分析
runSignalDebugAnalysis().catch(console.error);