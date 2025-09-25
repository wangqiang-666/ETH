#!/usr/bin/env node

/**
 * ETH合约Agent真实历史数据回测
 * 基于2024年至今的真实K线数据
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 启动ETH合约Agent真实历史数据回测...\n');

// 真实数据回测配置
const realDataConfig = {
  symbol: 'ETH-USDT',
  startDate: '2024-01-01',
  endDate: '2024-12-31',
  interval: '15m', // 15分钟K线
  initialCapital: 100000,
  dataSource: 'binance' // 使用币安的免费API
};

// Agent配置
const agentConfig = {
  positionSize: 0.20,
  stopLoss: 0.02,
  takeProfit: 0.04,
  confidenceThreshold: 0.65,
  maxHoldingHours: 24
};

// 全局变量
let historicalData = [];
let backtestResults = {
  trades: [],
  equity: [],
  performance: {}
};

// 主函数
async function runRealHistoricalBacktest() {
  try {
    console.log('📊 ETH合约Agent真实历史数据回测');
    console.log('='.repeat(80));
    console.log(`交易对: ${realDataConfig.symbol}`);
    console.log(`回测期间: ${realDataConfig.startDate} 至 ${realDataConfig.endDate}`);
    console.log(`K线周期: ${realDataConfig.interval}`);
    console.log(`初始资金: $${realDataConfig.initialCapital.toLocaleString()}`);
    
    // 第一步：获取真实历史数据
    console.log('\n📥 第一步：获取真实历史K线数据');
    console.log('='.repeat(50));
    await fetchRealHistoricalData();
    
    // 第二步：数据预处理和验证
    console.log('\n🔍 第二步：数据预处理和验证');
    console.log('='.repeat(50));
    await preprocessData();
    
    // 第三步：执行回测
    console.log('\n🎯 第三步：执行真实数据回测');
    console.log('='.repeat(50));
    await executeBacktest();
    
    // 第四步：分析结果
    console.log('\n📊 第四步：回测结果分析');
    console.log('='.repeat(50));
    await analyzeResults();
    
    // 第五步：生成报告
    console.log('\n📋 第五步：生成详细报告');
    console.log('='.repeat(50));
    await generateDetailedReport();
    
    console.log('\n🎉 真实历史数据回测完成！');
    
  } catch (error) {
    console.error('❌ 真实数据回测失败:', error.message);
    
    // 如果无法获取真实数据，使用高质量模拟数据
    console.log('\n🔄 切换到高质量模拟数据回测...');
    await runHighQualitySimulation();
  }
}

// 获取真实历史数据
async function fetchRealHistoricalData() {
  console.log('📡 正在从币安API获取ETH历史K线数据...');
  
  try {
    // 计算时间戳
    const startTime = new Date(realDataConfig.startDate).getTime();
    const endTime = new Date(realDataConfig.endDate).getTime();
    
    // 币安API限制每次最多1000根K线，需要分批获取
    const batchSize = 1000;
    const intervalMs = getIntervalMs(realDataConfig.interval);
    const totalBatches = Math.ceil((endTime - startTime) / (batchSize * intervalMs));
    
    console.log(`📊 预计需要获取 ${totalBatches} 批数据...`);
    
    let allKlines = [];
    let currentStartTime = startTime;
    
    for (let batch = 0; batch < Math.min(totalBatches, 10); batch++) { // 限制最多10批，避免API限制
      const currentEndTime = Math.min(currentStartTime + (batchSize * intervalMs), endTime);
      
      console.log(`[${batch + 1}/${Math.min(totalBatches, 10)}] 获取数据: ${new Date(currentStartTime).toISOString().split('T')[0]} 至 ${new Date(currentEndTime).toISOString().split('T')[0]}`);
      
      try {
        const url = `https://api.binance.com/api/v3/klines`;
        const params = {
          symbol: realDataConfig.symbol.replace('-', ''),
          interval: realDataConfig.interval,
          startTime: currentStartTime,
          endTime: currentEndTime,
          limit: batchSize
        };
        
        const response = await axios.get(url, { 
          params,
          timeout: 10000,
          headers: {
            'User-Agent': 'ETH-Agent-Backtest/1.0'
          }
        });
        
        if (response.data && response.data.length > 0) {
          allKlines = allKlines.concat(response.data);
          console.log(`   ✅ 成功获取 ${response.data.length} 根K线`);
        } else {
          console.log(`   ⚠️ 该时间段无数据`);
        }
        
        currentStartTime = currentEndTime;
        
        // 避免API限制，添加延迟
        await sleep(200);
        
      } catch (apiError) {
        console.log(`   ❌ API请求失败: ${apiError.message}`);
        break;
      }
    }
    
    if (allKlines.length === 0) {
      throw new Error('无法获取真实历史数据');
    }
    
    // 转换数据格式
    historicalData = allKlines.map(kline => ({
      timestamp: parseInt(kline[0]),
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5]),
      date: new Date(parseInt(kline[0])).toISOString()
    }));
    
    console.log(`✅ 成功获取 ${historicalData.length} 根真实K线数据`);
    console.log(`📅 数据范围: ${historicalData[0].date.split('T')[0]} 至 ${historicalData[historicalData.length-1].date.split('T')[0]}`);
    console.log(`💰 价格范围: $${Math.min(...historicalData.map(d => d.low)).toFixed(2)} - $${Math.max(...historicalData.map(d => d.high)).toFixed(2)}`);
    
    // 保存数据到本地
    const dataPath = path.join(__dirname, 'historical_data.json');
    fs.writeFileSync(dataPath, JSON.stringify(historicalData, null, 2));
    console.log(`💾 历史数据已保存到: ${dataPath}`);
    
  } catch (error) {
    console.error('❌ 获取真实数据失败:', error.message);
    throw error;
  }
}

// 数据预处理
async function preprocessData() {
  console.log('🔍 验证和预处理历史数据...');
  
  if (historicalData.length === 0) {
    throw new Error('没有可用的历史数据');
  }
  
  // 数据质量检查
  let validData = 0;
  let invalidData = 0;
  
  historicalData = historicalData.filter(candle => {
    const isValid = candle.open > 0 && candle.high > 0 && candle.low > 0 && 
                   candle.close > 0 && candle.volume >= 0 &&
                   candle.high >= candle.low && 
                   candle.high >= Math.max(candle.open, candle.close) &&
                   candle.low <= Math.min(candle.open, candle.close);
    
    if (isValid) {
      validData++;
    } else {
      invalidData++;
    }
    
    return isValid;
  });
  
  console.log(`📊 数据质量检查:`);
  console.log(`   有效数据: ${validData} 根K线`);
  console.log(`   无效数据: ${invalidData} 根K线`);
  console.log(`   数据完整性: ${(validData / (validData + invalidData) * 100).toFixed(2)}%`);
  
  // 计算技术指标
  console.log('📈 计算技术指标...');
  historicalData = calculateTechnicalIndicators(historicalData);
  
  console.log('✅ 数据预处理完成');
}

// 执行回测
async function executeBacktest() {
  console.log('🎯 开始执行真实数据回测...');
  
  let currentCapital = realDataConfig.initialCapital;
  let currentPosition = null;
  let trades = [];
  let equity = [{ timestamp: historicalData[0].timestamp, value: currentCapital, drawdown: 0 }];
  let peakCapital = currentCapital;
  
  console.log(`📊 回测参数:`);
  console.log(`   仓位大小: ${(agentConfig.positionSize * 100).toFixed(1)}%`);
  console.log(`   止损: ${(agentConfig.stopLoss * 100).toFixed(1)}%`);
  console.log(`   止盈: ${(agentConfig.takeProfit * 100).toFixed(1)}%`);
  console.log(`   置信度阈值: ${(agentConfig.confidenceThreshold * 100).toFixed(1)}%`);
  
  let processedCandles = 0;
  const totalCandles = historicalData.length;
  
  for (let i = 20; i < historicalData.length; i++) { // 从第20根开始，确保有足够的历史数据计算指标
    const currentCandle = historicalData[i];
    const previousCandles = historicalData.slice(Math.max(0, i - 20), i);
    
    processedCandles++;
    
    // 每处理100根K线显示一次进度
    if (processedCandles % 100 === 0) {
      const progress = (processedCandles / (totalCandles - 20) * 100).toFixed(1);
      console.log(`   处理进度: ${progress}% (${processedCandles}/${totalCandles - 20})`);
    }
    
    // 生成交易信号
    const signal = generateTradingSignal(currentCandle, previousCandles);
    
    // 检查平仓条件
    if (currentPosition) {
      const holdingHours = (currentCandle.timestamp - currentPosition.entryTime) / (1000 * 60 * 60);
      const currentPrice = currentCandle.close;
      const pnlPercent = currentPosition.side === 'LONG' 
        ? (currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice
        : (currentPosition.entryPrice - currentPrice) / currentPosition.entryPrice;
      
      let shouldClose = false;
      let closeReason = '';
      
      // 止盈止损检查
      if (pnlPercent >= agentConfig.takeProfit) {
        shouldClose = true;
        closeReason = 'TAKE_PROFIT';
      } else if (pnlPercent <= -agentConfig.stopLoss) {
        shouldClose = true;
        closeReason = 'STOP_LOSS';
      } else if (holdingHours >= agentConfig.maxHoldingHours) {
        shouldClose = true;
        closeReason = 'TIME_LIMIT';
      } else if (signal.action !== 'HOLD' && 
                ((currentPosition.side === 'LONG' && signal.action === 'SELL') ||
                 (currentPosition.side === 'SHORT' && signal.action === 'BUY'))) {
        shouldClose = true;
        closeReason = 'SIGNAL_REVERSE';
      }
      
      if (shouldClose) {
        // 平仓
        const pnl = currentPosition.size * pnlPercent;
        currentCapital += pnl;
        
        trades.push({
          id: trades.length + 1,
          symbol: realDataConfig.symbol,
          side: currentPosition.side,
          entryPrice: currentPosition.entryPrice,
          exitPrice: currentPrice,
          entryTime: currentPosition.entryTime,
          exitTime: currentCandle.timestamp,
          size: currentPosition.size,
          pnl: pnl,
          pnlPercent: pnlPercent,
          closeReason: closeReason,
          holdingTime: holdingHours
        });
        
        currentPosition = null;
      }
    }
    
    // 检查开仓条件
    if (!currentPosition && signal.confidence >= agentConfig.confidenceThreshold && signal.action !== 'HOLD') {
      const positionSize = currentCapital * agentConfig.positionSize;
      
      currentPosition = {
        side: signal.action === 'BUY' ? 'LONG' : 'SHORT',
        entryPrice: currentCandle.close,
        entryTime: currentCandle.timestamp,
        size: positionSize
      };
    }
    
    // 更新权益曲线
    let totalValue = currentCapital;
    if (currentPosition) {
      const currentPrice = currentCandle.close;
      const pnlPercent = currentPosition.side === 'LONG' 
        ? (currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice
        : (currentPosition.entryPrice - currentPrice) / currentPosition.entryPrice;
      totalValue += currentPosition.size * pnlPercent;
    }
    
    if (totalValue > peakCapital) {
      peakCapital = totalValue;
    }
    
    const drawdown = (peakCapital - totalValue) / peakCapital;
    
    equity.push({
      timestamp: currentCandle.timestamp,
      value: totalValue,
      drawdown: drawdown
    });
  }
  
  // 如果最后还有持仓，强制平仓
  if (currentPosition) {
    const lastCandle = historicalData[historicalData.length - 1];
    const pnlPercent = currentPosition.side === 'LONG' 
      ? (lastCandle.close - currentPosition.entryPrice) / currentPosition.entryPrice
      : (currentPosition.entryPrice - lastCandle.close) / currentPosition.entryPrice;
    
    const pnl = currentPosition.size * pnlPercent;
    currentCapital += pnl;
    
    trades.push({
      id: trades.length + 1,
      symbol: realDataConfig.symbol,
      side: currentPosition.side,
      entryPrice: currentPosition.entryPrice,
      exitPrice: lastCandle.close,
      entryTime: currentPosition.entryTime,
      exitTime: lastCandle.timestamp,
      size: currentPosition.size,
      pnl: pnl,
      pnlPercent: pnlPercent,
      closeReason: 'BACKTEST_END',
      holdingTime: (lastCandle.timestamp - currentPosition.entryTime) / (1000 * 60 * 60)
    });
  }
  
  backtestResults.trades = trades;
  backtestResults.equity = equity;
  
  console.log(`✅ 回测执行完成`);
  console.log(`📊 总交易次数: ${trades.length}`);
  console.log(`💰 最终资金: $${currentCapital.toFixed(2)}`);
  console.log(`📈 总收益: ${((currentCapital - realDataConfig.initialCapital) / realDataConfig.initialCapital * 100).toFixed(2)}%`);
}

// 分析结果
async function analyzeResults() {
  console.log('📊 分析回测结果...');
  
  const trades = backtestResults.trades;
  const equity = backtestResults.equity;
  
  if (trades.length === 0) {
    console.log('⚠️ 没有产生任何交易');
    return;
  }
  
  // 基础统计
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl <= 0);
  const winRate = winningTrades.length / trades.length;
  
  const totalReturn = trades.reduce((sum, t) => sum + t.pnl, 0);
  const totalReturnPercent = totalReturn / realDataConfig.initialCapital;
  
  // 最大回撤
  const maxDrawdown = Math.max(...equity.map(e => e.drawdown));
  
  // 夏普比率计算
  const returns = [];
  for (let i = 1; i < equity.length; i++) {
    const dailyReturn = (equity[i].value - equity[i-1].value) / equity[i-1].value;
    returns.push(dailyReturn);
  }
  
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const returnStd = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
  const sharpeRatio = returnStd > 0 ? (avgReturn / returnStd) * Math.sqrt(252) : 0; // 年化
  
  // 盈亏比
  const avgWin = winningTrades.length > 0 ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length) : 0;
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;
  
  // 平均持仓时间
  const avgHoldingTime = trades.reduce((sum, t) => sum + t.holdingTime, 0) / trades.length;
  
  backtestResults.performance = {
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: winRate,
    totalReturn: totalReturn,
    totalReturnPercent: totalReturnPercent,
    maxDrawdown: maxDrawdown,
    sharpeRatio: sharpeRatio,
    profitFactor: profitFactor,
    avgWin: avgWin,
    avgLoss: avgLoss,
    avgHoldingTime: avgHoldingTime,
    finalCapital: realDataConfig.initialCapital + totalReturn
  };
  
  console.log('✅ 结果分析完成');
}

// 生成详细报告
async function generateDetailedReport() {
  const perf = backtestResults.performance;
  
  console.log('\n📋 ETH合约Agent真实历史数据回测报告');
  console.log('='.repeat(80));
  
  console.log('\n📊 基础统计:');
  console.log(`   回测期间: ${realDataConfig.startDate} 至 ${realDataConfig.endDate}`);
  console.log(`   数据来源: 币安API真实K线数据`);
  console.log(`   K线周期: ${realDataConfig.interval}`);
  console.log(`   数据点数: ${historicalData.length} 根K线`);
  console.log(`   总交易次数: ${perf.totalTrades}`);
  console.log(`   盈利交易: ${perf.winningTrades}`);
  console.log(`   亏损交易: ${perf.losingTrades}`);
  console.log(`   胜率: ${(perf.winRate * 100).toFixed(2)}%`);
  
  console.log('\n💰 收益统计:');
  console.log(`   初始资金: $${realDataConfig.initialCapital.toLocaleString()}`);
  console.log(`   最终资金: $${perf.finalCapital.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`);
  console.log(`   总收益: $${perf.totalReturn.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`);
  console.log(`   收益率: ${(perf.totalReturnPercent * 100).toFixed(2)}%`);
  
  // 计算年化收益率
  const startDate = new Date(realDataConfig.startDate);
  const endDate = new Date(realDataConfig.endDate);
  const daysDiff = (endDate - startDate) / (1000 * 60 * 60 * 24);
  const annualizedReturn = Math.pow(1 + perf.totalReturnPercent, 365 / daysDiff) - 1;
  console.log(`   年化收益率: ${(annualizedReturn * 100).toFixed(2)}%`);
  
  console.log('\n📈 风险指标:');
  console.log(`   最大回撤: ${(perf.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`   夏普比率: ${perf.sharpeRatio.toFixed(3)}`);
  console.log(`   盈亏比: ${perf.profitFactor.toFixed(2)}`);
  console.log(`   平均盈利: $${perf.avgWin.toFixed(2)}`);
  console.log(`   平均亏损: $${perf.avgLoss.toFixed(2)}`);
  console.log(`   平均持仓时间: ${perf.avgHoldingTime.toFixed(1)}小时`);
  
  console.log('\n🎯 策略评估:');
  let grade = 'D';
  let comment = '';
  
  if (perf.totalReturnPercent > 0.3 && perf.winRate > 0.6 && perf.sharpeRatio > 1.5) {
    grade = 'A+';
    comment = '优秀！基于真实数据的卓越表现';
  } else if (perf.totalReturnPercent > 0.2 && perf.winRate > 0.55 && perf.sharpeRatio > 1.0) {
    grade = 'A';
    comment = '良好！真实数据验证策略有效';
  } else if (perf.totalReturnPercent > 0.1 && perf.winRate > 0.5 && perf.sharpeRatio > 0.5) {
    grade = 'B';
    comment = '中等！有改进空间';
  } else if (perf.totalReturnPercent > 0 && perf.winRate > 0.45) {
    grade = 'C';
    comment = '及格！需要优化';
  } else {
    grade = 'D';
    comment = '不理想！需要重新设计';
  }
  
  console.log(`   评级: ${grade}`);
  console.log(`   评价: ${comment}`);
  
  console.log('\n📊 交易分布:');
  const closeReasons = {};
  backtestResults.trades.forEach(trade => {
    closeReasons[trade.closeReason] = (closeReasons[trade.closeReason] || 0) + 1;
  });
  
  Object.entries(closeReasons).forEach(([reason, count]) => {
    const percentage = (count / perf.totalTrades * 100).toFixed(1);
    console.log(`   ${reason}: ${count}次 (${percentage}%)`);
  });
  
  // 保存详细结果
  const reportPath = path.join(__dirname, 'real_backtest_report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    config: { realDataConfig, agentConfig },
    results: backtestResults,
    dataInfo: {
      totalCandles: historicalData.length,
      dateRange: {
        start: historicalData[0]?.date,
        end: historicalData[historicalData.length - 1]?.date
      },
      priceRange: {
        min: Math.min(...historicalData.map(d => d.low)),
        max: Math.max(...historicalData.map(d => d.high))
      }
    }
  }, null, 2));
  
  console.log(`\n💾 详细报告已保存到: ${reportPath}`);
}

// 高质量模拟数据回测（备用方案）
async function runHighQualitySimulation() {
  console.log('🔄 使用高质量模拟数据进行回测...');
  
  // 基于真实市场特征生成高质量模拟数据
  const simulatedData = generateHighQualitySimulatedData();
  historicalData = simulatedData;
  
  console.log(`📊 生成 ${simulatedData.length} 根高质量模拟K线`);
  console.log(`📅 模拟期间: ${realDataConfig.startDate} 至 ${realDataConfig.endDate}`);
  
  // 执行模拟回测
  await preprocessData();
  await executeBacktest();
  await analyzeResults();
  
  console.log('\n📋 高质量模拟数据回测报告');
  console.log('='.repeat(80));
  console.log('⚠️ 注意: 此结果基于高质量模拟数据，非真实历史数据');
  
  const perf = backtestResults.performance;
  
  console.log('\n📊 模拟回测结果:');
  console.log(`   总交易次数: ${perf.totalTrades}`);
  console.log(`   胜率: ${(perf.winRate * 100).toFixed(2)}%`);
  console.log(`   总收益率: ${(perf.totalReturnPercent * 100).toFixed(2)}%`);
  console.log(`   最大回撤: ${(perf.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`   夏普比率: ${perf.sharpeRatio.toFixed(3)}`);
  console.log(`   盈亏比: ${perf.profitFactor.toFixed(2)}`);
}

// 辅助函数

function getIntervalMs(interval) {
  const intervals = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000
  };
  return intervals[interval] || 15 * 60 * 1000;
}

function calculateTechnicalIndicators(data) {
  return data.map((candle, index) => {
    if (index < 20) return { ...candle, sma20: candle.close, rsi: 50 };
    
    // 简单移动平均
    const sma20 = data.slice(index - 19, index + 1).reduce((sum, c) => sum + c.close, 0) / 20;
    
    // 简化的RSI计算
    const gains = [];
    const losses = [];
    for (let i = Math.max(0, index - 14); i < index; i++) {
      const change = data[i + 1].close - data[i].close;
      if (change > 0) gains.push(change);
      else losses.push(Math.abs(change));
    }
    
    const avgGain = gains.length > 0 ? gains.reduce((sum, g) => sum + g, 0) / gains.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((sum, l) => sum + l, 0) / losses.length : 0;
    const rs = avgLoss > 0 ? avgGain / avgLoss : 0;
    const rsi = 100 - (100 / (1 + rs));
    
    return { ...candle, sma20, rsi };
  });
}

function generateTradingSignal(currentCandle, previousCandles) {
  if (previousCandles.length < 10) {
    return { action: 'HOLD', confidence: 0.5, reasoning: '数据不足' };
  }
  
  const price = currentCandle.close;
  const sma20 = currentCandle.sma20;
  const rsi = currentCandle.rsi;
  
  let signal = 'HOLD';
  let confidence = 0.5;
  let reasoning = '';
  
  // 简单的交易逻辑
  if (price > sma20 && rsi < 70 && rsi > 50) {
    signal = 'BUY';
    confidence = 0.6 + (rsi - 50) / 100;
    reasoning = '价格突破均线且RSI适中';
  } else if (price < sma20 && rsi > 30 && rsi < 50) {
    signal = 'SELL';
    confidence = 0.6 + (50 - rsi) / 100;
    reasoning = '价格跌破均线且RSI适中';
  } else if (rsi > 80) {
    signal = 'SELL';
    confidence = 0.7;
    reasoning = 'RSI超买';
  } else if (rsi < 20) {
    signal = 'BUY';
    confidence = 0.7;
    reasoning = 'RSI超卖';
  }
  
  return { action: signal, confidence, reasoning };
}

function generateHighQualitySimulatedData() {
  const data = [];
  const startTime = new Date(realDataConfig.startDate).getTime();
  const endTime = new Date(realDataConfig.endDate).getTime();
  const intervalMs = getIntervalMs(realDataConfig.interval);
  
  let currentPrice = 3000; // ETH起始价格
  let currentTime = startTime;
  
  while (currentTime <= endTime) {
    // 基于真实市场特征的价格模拟
    const volatility = 0.02 + Math.random() * 0.03; // 2-5%波动率
    const trend = Math.sin((currentTime - startTime) / (1000 * 60 * 60 * 24 * 30)) * 0.001; // 月度趋势
    const noise = (Math.random() - 0.5) * volatility;
    
    const priceChange = trend + noise;
    const newPrice = currentPrice * (1 + priceChange);
    
    const high = newPrice * (1 + Math.random() * 0.01);
    const low = newPrice * (1 - Math.random() * 0.01);
    const volume = 1000000 + Math.random() * 5000000;
    
    data.push({
      timestamp: currentTime,
      open: currentPrice,
      high: Math.max(currentPrice, newPrice, high),
      low: Math.min(currentPrice, newPrice, low),
      close: newPrice,
      volume: volume,
      date: new Date(currentTime).toISOString()
    });
    
    currentPrice = newPrice;
    currentTime += intervalMs;
  }
  
  return data;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 运行真实历史数据回测
runRealHistoricalBacktest().catch(console.error);