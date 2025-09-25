/**
 * 历史数据全量回测脚本
 * 使用2022-2024年的真实K线数据进行完整回测
 */

const fs = require('fs');
const path = require('path');

// 配置参数
const CONFIG = {
  // 交易参数
  initialBalance: 10000, // 初始资金 USDT
  leverage: 3, // 杠杆倍数
  feeRate: 0.0005, // 手续费率 0.05%
  
  // 策略参数
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  maShortPeriod: 10,
  maLongPeriod: 30,
  
  // 风险管理
  stopLossPercent: 0.02, // 止损 2%
  takeProfitPercent: 0.04, // 止盈 4%
  maxPositionPercent: 0.8, // 最大仓位 80%
  
  // 输出配置
  logInterval: 10000, // 每10000条数据输出一次进度
  detailedLog: false // 是否输出详细交易日志
};

// 交易状态
let tradingState = {
  balance: CONFIG.initialBalance,
  position: null, // { side: 'LONG'|'SHORT', size, entryPrice, timestamp }
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  totalProfit: 0,
  totalLoss: 0,
  maxDrawdown: 0,
  peakBalance: CONFIG.initialBalance,
  trades: []
};

// 技术指标计算
class TechnicalIndicators {
  static calculateSMA(data, period) {
    if (data.length < period) return null;
    const sum = data.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
  }
  
  static calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses -= change;
      }
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
  
  static calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (prices.length < slowPeriod) return null;
    
    const emaFast = this.calculateEMA(prices, fastPeriod);
    const emaSlow = this.calculateEMA(prices, slowPeriod);
    
    if (!emaFast || !emaSlow) return null;
    
    const macdLine = emaFast - emaSlow;
    return { macd: macdLine, signal: 0, histogram: 0 }; // 简化版本
  }
  
  static calculateEMA(prices, period) {
    if (prices.length < period) return null;
    
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
    }
    
    return ema;
  }
}

// 交易策略
class TradingStrategy {
  constructor() {
    this.priceHistory = [];
    this.volumeHistory = [];
  }
  
  addData(candle) {
    this.priceHistory.push(candle.close);
    this.volumeHistory.push(candle.volume);
    
    // 保持历史数据在合理范围内
    if (this.priceHistory.length > 200) {
      this.priceHistory.shift();
      this.volumeHistory.shift();
    }
  }
  
  generateSignal(candle) {
    if (this.priceHistory.length < CONFIG.maLongPeriod) {
      return null;
    }
    
    // 计算技术指标
    const rsi = TechnicalIndicators.calculateRSI(this.priceHistory, CONFIG.rsiPeriod);
    const maShort = TechnicalIndicators.calculateSMA(this.priceHistory, CONFIG.maShortPeriod);
    const maLong = TechnicalIndicators.calculateSMA(this.priceHistory, CONFIG.maLongPeriod);
    
    if (!rsi || !maShort || !maLong) return null;
    
    // 多重条件策略
    const signals = [];
    
    // RSI信号
    if (rsi < CONFIG.rsiOversold) {
      signals.push({ type: 'LONG', strength: 0.7, reason: 'RSI超卖' });
    } else if (rsi > CONFIG.rsiOverbought) {
      signals.push({ type: 'SHORT', strength: 0.7, reason: 'RSI超买' });
    }
    
    // 均线信号
    if (maShort > maLong * 1.002) { // 短均线明显高于长均线
      signals.push({ type: 'LONG', strength: 0.6, reason: '均线多头' });
    } else if (maShort < maLong * 0.998) { // 短均线明显低于长均线
      signals.push({ type: 'SHORT', strength: 0.6, reason: '均线空头' });
    }
    
    // 成交量确认
    const avgVolume = this.volumeHistory.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const volumeMultiplier = candle.volume > avgVolume * 1.2 ? 1.2 : 1.0;
    
    // 综合信号
    const longSignals = signals.filter(s => s.type === 'LONG');
    const shortSignals = signals.filter(s => s.type === 'SHORT');
    
    if (longSignals.length > 0) {
      const totalStrength = longSignals.reduce((sum, s) => sum + s.strength, 0) * volumeMultiplier;
      if (totalStrength > 1.0) {
        return {
          type: 'LONG',
          strength: Math.min(totalStrength, 2.0),
          reasons: longSignals.map(s => s.reason),
          indicators: { rsi, maShort, maLong, volume: candle.volume }
        };
      }
    }
    
    if (shortSignals.length > 0) {
      const totalStrength = shortSignals.reduce((sum, s) => sum + s.strength, 0) * volumeMultiplier;
      if (totalStrength > 1.0) {
        return {
          type: 'SHORT',
          strength: Math.min(totalStrength, 2.0),
          reasons: shortSignals.map(s => s.reason),
          indicators: { rsi, maShort, maLong, volume: candle.volume }
        };
      }
    }
    
    return null;
  }
}

// 交易执行器
class TradeExecutor {
  static openPosition(signal, candle) {
    if (tradingState.position) return false; // 已有持仓
    
    const availableBalance = tradingState.balance * CONFIG.maxPositionPercent;
    const positionSize = (availableBalance * CONFIG.leverage) / candle.close;
    const fee = positionSize * candle.close * CONFIG.feeRate;
    
    if (fee > tradingState.balance * 0.1) return false; // 手续费过高
    
    tradingState.position = {
      side: signal.type,
      size: positionSize,
      entryPrice: candle.close,
      timestamp: candle.timestamp,
      stopLoss: signal.type === 'LONG' 
        ? candle.close * (1 - CONFIG.stopLossPercent)
        : candle.close * (1 + CONFIG.stopLossPercent),
      takeProfit: signal.type === 'LONG'
        ? candle.close * (1 + CONFIG.takeProfitPercent)
        : candle.close * (1 - CONFIG.takeProfitPercent),
      signal: signal
    };
    
    tradingState.balance -= fee;
    
    if (CONFIG.detailedLog) {
      console.log(`开仓 ${signal.type} @ ${candle.close} | 数量: ${positionSize.toFixed(4)} | 手续费: ${fee.toFixed(2)}`);
    }
    
    return true;
  }
  
  static closePosition(candle, reason = '手动平仓') {
    if (!tradingState.position) return false;
    
    const position = tradingState.position;
    const currentPrice = candle.close;
    
    // 计算盈亏
    let pnl;
    if (position.side === 'LONG') {
      pnl = (currentPrice - position.entryPrice) * position.size;
    } else {
      pnl = (position.entryPrice - currentPrice) * position.size;
    }
    
    // 扣除手续费
    const fee = position.size * currentPrice * CONFIG.feeRate;
    pnl -= fee;
    
    // 更新余额
    tradingState.balance += pnl;
    
    // 更新统计
    tradingState.totalTrades++;
    if (pnl > 0) {
      tradingState.winningTrades++;
      tradingState.totalProfit += pnl;
    } else {
      tradingState.losingTrades++;
      tradingState.totalLoss += Math.abs(pnl);
    }
    
    // 更新最大回撤
    if (tradingState.balance > tradingState.peakBalance) {
      tradingState.peakBalance = tradingState.balance;
    } else {
      const drawdown = (tradingState.peakBalance - tradingState.balance) / tradingState.peakBalance;
      if (drawdown > tradingState.maxDrawdown) {
        tradingState.maxDrawdown = drawdown;
      }
    }
    
    // 记录交易
    const trade = {
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice: currentPrice,
      size: position.size,
      pnl: pnl,
      pnlPercent: (pnl / (position.entryPrice * position.size)) * 100,
      duration: candle.timestamp - position.timestamp,
      reason: reason,
      entryTime: new Date(position.timestamp).toISOString(),
      exitTime: new Date(candle.timestamp).toISOString()
    };
    
    tradingState.trades.push(trade);
    
    if (CONFIG.detailedLog) {
      console.log(`平仓 ${position.side} @ ${currentPrice} | 盈亏: ${pnl.toFixed(2)} USDT (${trade.pnlPercent.toFixed(2)}%) | 原因: ${reason}`);
    }
    
    tradingState.position = null;
    return true;
  }
  
  static checkStopLoss(candle) {
    if (!tradingState.position) return false;
    
    const position = tradingState.position;
    const currentPrice = candle.close;
    
    if (position.side === 'LONG' && currentPrice <= position.stopLoss) {
      return this.closePosition(candle, '止损');
    } else if (position.side === 'SHORT' && currentPrice >= position.stopLoss) {
      return this.closePosition(candle, '止损');
    }
    
    return false;
  }
  
  static checkTakeProfit(candle) {
    if (!tradingState.position) return false;
    
    const position = tradingState.position;
    const currentPrice = candle.close;
    
    if (position.side === 'LONG' && currentPrice >= position.takeProfit) {
      return this.closePosition(candle, '止盈');
    } else if (position.side === 'SHORT' && currentPrice <= position.takeProfit) {
      return this.closePosition(candle, '止盈');
    }
    
    return false;
  }
}

// 主回测函数
async function runHistoricalBacktest() {
  console.log('🚀 开始历史数据全量回测...');
  console.log(`📊 数据文件: real_historical_data_2022_2024.json`);
  console.log(`💰 初始资金: ${CONFIG.initialBalance} USDT`);
  console.log(`📈 杠杆倍数: ${CONFIG.leverage}x`);
  console.log('');
  
  // 读取历史数据
  const dataPath = path.join(__dirname, 'data', 'real_historical_data_2022_2024.json');
  
  if (!fs.existsSync(dataPath)) {
    console.error('❌ 历史数据文件不存在:', dataPath);
    return;
  }
  
  console.log('📖 读取历史数据...');
  const rawData = fs.readFileSync(dataPath, 'utf8');
  const historicalData = JSON.parse(rawData);
  
  console.log(`✅ 数据加载完成: ${historicalData.length.toLocaleString()} 条K线数据`);
  console.log(`📅 时间范围: ${historicalData[0].date} ~ ${historicalData[historicalData.length - 1].date}`);
  console.log('');
  
  // 初始化策略
  const strategy = new TradingStrategy();
  const startTime = Date.now();
  
  // 遍历历史数据
  for (let i = 0; i < historicalData.length; i++) {
    const candle = historicalData[i];
    
    // 添加数据到策略
    strategy.addData(candle);
    
    // 检查止损止盈
    TradeExecutor.checkStopLoss(candle);
    TradeExecutor.checkTakeProfit(candle);
    
    // 生成交易信号
    if (!tradingState.position) {
      const signal = strategy.generateSignal(candle);
      if (signal) {
        TradeExecutor.openPosition(signal, candle);
      }
    }
    
    // 进度输出
    if (i % CONFIG.logInterval === 0 && i > 0) {
      const progress = ((i / historicalData.length) * 100).toFixed(1);
      const currentDate = new Date(candle.timestamp).toISOString().split('T')[0];
      console.log(`📊 进度: ${progress}% | 日期: ${currentDate} | 价格: $${candle.close} | 余额: ${tradingState.balance.toFixed(2)} USDT | 交易次数: ${tradingState.totalTrades}`);
    }
  }
  
  // 如果最后还有持仓，平仓
  if (tradingState.position) {
    TradeExecutor.closePosition(historicalData[historicalData.length - 1], '回测结束');
  }
  
  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;
  
  // 生成回测报告
  generateBacktestReport(historicalData, duration);
}

// 生成回测报告
function generateBacktestReport(data, duration) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 历史数据全量回测报告');
  console.log('='.repeat(80));
  
  // 基础统计
  const finalBalance = tradingState.balance;
  const totalReturn = ((finalBalance - CONFIG.initialBalance) / CONFIG.initialBalance) * 100;
  const winRate = tradingState.totalTrades > 0 ? (tradingState.winningTrades / tradingState.totalTrades) * 100 : 0;
  const avgWin = tradingState.winningTrades > 0 ? tradingState.totalProfit / tradingState.winningTrades : 0;
  const avgLoss = tradingState.losingTrades > 0 ? tradingState.totalLoss / tradingState.losingTrades : 0;
  const profitFactor = tradingState.totalLoss > 0 ? tradingState.totalProfit / tradingState.totalLoss : 0;
  
  // 时间统计
  const startDate = new Date(data[0].timestamp);
  const endDate = new Date(data[data.length - 1].timestamp);
  const tradingDays = (endDate - startDate) / (1000 * 60 * 60 * 24);
  const annualizedReturn = (Math.pow(finalBalance / CONFIG.initialBalance, 365 / tradingDays) - 1) * 100;
  
  console.log(`📅 回测期间: ${startDate.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]} (${Math.round(tradingDays)} 天)`);
  console.log(`⏱️  处理时间: ${duration.toFixed(2)} 秒`);
  console.log(`📈 数据点数: ${data.length.toLocaleString()} 条K线`);
  console.log('');
  
  console.log('💰 资金表现:');
  console.log(`   初始资金: ${CONFIG.initialBalance.toLocaleString()} USDT`);
  console.log(`   最终资金: ${finalBalance.toFixed(2)} USDT`);
  console.log(`   总收益率: ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`);
  console.log(`   年化收益率: ${annualizedReturn >= 0 ? '+' : ''}${annualizedReturn.toFixed(2)}%`);
  console.log(`   最大回撤: ${(tradingState.maxDrawdown * 100).toFixed(2)}%`);
  console.log('');
  
  console.log('📊 交易统计:');
  console.log(`   总交易次数: ${tradingState.totalTrades}`);
  console.log(`   盈利交易: ${tradingState.winningTrades} (${winRate.toFixed(1)}%)`);
  console.log(`   亏损交易: ${tradingState.losingTrades} (${(100 - winRate).toFixed(1)}%)`);
  console.log(`   平均盈利: ${avgWin.toFixed(2)} USDT`);
  console.log(`   平均亏损: ${avgLoss.toFixed(2)} USDT`);
  console.log(`   盈亏比: ${(avgWin / avgLoss).toFixed(2)}`);
  console.log(`   盈利因子: ${profitFactor.toFixed(2)}`);
  console.log('');
  
  // 月度表现
  console.log('📅 月度表现分析:');
  const monthlyStats = analyzeMonthlyPerformance();
  monthlyStats.forEach(month => {
    const sign = month.return >= 0 ? '+' : '';
    console.log(`   ${month.month}: ${sign}${month.return.toFixed(2)}% (${month.trades} 笔交易)`);
  });
  console.log('');
  
  // 最佳和最差交易
  if (tradingState.trades.length > 0) {
    const sortedTrades = [...tradingState.trades].sort((a, b) => b.pnl - a.pnl);
    const bestTrade = sortedTrades[0];
    const worstTrade = sortedTrades[sortedTrades.length - 1];
    
    console.log('🏆 交易记录:');
    console.log(`   最佳交易: ${bestTrade.side} ${bestTrade.pnl >= 0 ? '+' : ''}${bestTrade.pnl.toFixed(2)} USDT (${bestTrade.pnlPercent.toFixed(2)}%)`);
    console.log(`   最差交易: ${worstTrade.side} ${worstTrade.pnl >= 0 ? '+' : ''}${worstTrade.pnl.toFixed(2)} USDT (${worstTrade.pnlPercent.toFixed(2)}%)`);
    console.log('');
  }
  
  // 策略评估
  console.log('🎯 策略评估:');
  if (totalReturn > 0 && winRate > 50 && profitFactor > 1.2) {
    console.log('   ✅ 策略表现优秀！');
  } else if (totalReturn > 0 && winRate > 40) {
    console.log('   ⚠️  策略表现一般，有改进空间');
  } else {
    console.log('   ❌ 策略需要优化');
  }
  
  console.log(`   风险调整收益: ${(annualizedReturn / (tradingState.maxDrawdown * 100 || 1)).toFixed(2)}`);
  console.log(`   交易频率: ${(tradingState.totalTrades / tradingDays * 30).toFixed(1)} 笔/月`);
  
  console.log('='.repeat(80));
  
  // 保存详细报告
  saveDetailedReport(data, duration);
}

// 月度表现分析
function analyzeMonthlyPerformance() {
  const monthlyData = {};
  let lastBalance = CONFIG.initialBalance;
  
  tradingState.trades.forEach(trade => {
    const date = new Date(trade.exitTime);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = {
        month: monthKey,
        trades: 0,
        pnl: 0,
        startBalance: lastBalance
      };
    }
    
    monthlyData[monthKey].trades++;
    monthlyData[monthKey].pnl += trade.pnl;
  });
  
  return Object.values(monthlyData).map(month => ({
    month: month.month,
    trades: month.trades,
    return: (month.pnl / month.startBalance) * 100
  })).sort((a, b) => a.month.localeCompare(b.month));
}

// 保存详细报告
function saveDetailedReport(data, duration) {
  const report = {
    summary: {
      startDate: new Date(data[0].timestamp).toISOString(),
      endDate: new Date(data[data.length - 1].timestamp).toISOString(),
      initialBalance: CONFIG.initialBalance,
      finalBalance: tradingState.balance,
      totalReturn: ((tradingState.balance - CONFIG.initialBalance) / CONFIG.initialBalance) * 100,
      totalTrades: tradingState.totalTrades,
      winningTrades: tradingState.winningTrades,
      losingTrades: tradingState.losingTrades,
      winRate: tradingState.totalTrades > 0 ? (tradingState.winningTrades / tradingState.totalTrades) * 100 : 0,
      maxDrawdown: tradingState.maxDrawdown * 100,
      processingTime: duration
    },
    config: CONFIG,
    trades: tradingState.trades.slice(-100), // 保存最后100笔交易
    monthlyPerformance: analyzeMonthlyPerformance()
  };
  
  const reportPath = path.join(__dirname, 'reports', 'historical_backtest_report.json');
  
  // 确保reports目录存在
  const reportsDir = path.dirname(reportPath);
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 详细报告已保存: ${reportPath}`);
}

// 运行回测
if (require.main === module) {
  runHistoricalBacktest().catch(console.error);
}

module.exports = { runHistoricalBacktest, CONFIG, tradingState };