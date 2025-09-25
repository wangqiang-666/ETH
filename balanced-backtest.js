/**
 * 平衡版历史数据回测脚本
 * 在保守和激进策略之间找到平衡点
 */

const fs = require('fs');
const path = require('path');

// 平衡配置参数
const CONFIG = {
  // 交易参数
  initialBalance: 10000, // 初始资金 USDT
  leverage: 2.5, // 适中杠杆倍数
  feeRate: 0.0005, // 手续费率 0.05%
  
  // 平衡的策略参数
  rsiPeriod: 14, // 标准RSI周期
  rsiOverbought: 70, // 标准超买阈值
  rsiOversold: 30, // 标准超卖阈值
  maShortPeriod: 12, // 适中短期均线周期
  maLongPeriod: 26, // 适中长期均线周期
  
  // 平衡的风险管理
  stopLossPercent: 0.025, // 止损 2.5%
  takeProfitPercent: 0.05, // 止盈 5%
  maxPositionPercent: 0.7, // 最大仓位 70%
  
  // 适中的过滤条件
  minSignalStrength: 1.2, // 降低最小信号强度
  volatilityFilter: true, // 启用波动率过滤
  volatilityThreshold: 1.2, // 降低波动率阈值
  trendFilter: false, // 关闭严格趋势过滤
  volumeFilter: true, // 启用成交量过滤
  volumeThreshold: 0.7, // 降低成交量阈值
  
  // 输出配置
  logInterval: 10000,
  detailedLog: false
};

// 交易状态
let tradingState = {
  balance: CONFIG.initialBalance,
  position: null,
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  totalProfit: 0,
  totalLoss: 0,
  maxDrawdown: 0,
  peakBalance: CONFIG.initialBalance,
  trades: [],
  consecutiveLosses: 0,
  maxConsecutiveLosses: 0
};

// 技术指标计算 (复用之前的类)
class TechnicalIndicators {
  static calculateSMA(data, period) {
    if (data.length < period) return null;
    const sum = data.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
  }
  
  static calculateEMA(data, period) {
    if (data.length < period) return null;
    
    const multiplier = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < data.length; i++) {
      ema = (data[i] * multiplier) + (ema * (1 - multiplier));
    }
    
    return ema;
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
  
  static calculateMACD(prices, fastPeriod = 12, slowPeriod = 26) {
    if (prices.length < slowPeriod) return null;
    
    const emaFast = this.calculateEMA(prices, fastPeriod);
    const emaSlow = this.calculateEMA(prices, slowPeriod);
    
    if (!emaFast || !emaSlow) return null;
    
    return emaFast - emaSlow;
  }
  
  static calculateVolatility(prices, period = 20) {
    if (prices.length < period) return null;
    
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
    
    const recentReturns = returns.slice(-period);
    const mean = recentReturns.reduce((sum, ret) => sum + ret, 0) / period;
    const variance = recentReturns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / period;
    
    return Math.sqrt(variance * 252); // 年化波动率
  }
}

// 平衡交易策略
class BalancedTradingStrategy {
  constructor() {
    this.priceHistory = [];
    this.volumeHistory = [];
    this.candleHistory = [];
  }
  
  addData(candle) {
    this.priceHistory.push(candle.close);
    this.volumeHistory.push(candle.volume);
    this.candleHistory.push(candle);
    
    // 保持历史数据在合理范围内
    const maxHistory = 100;
    if (this.priceHistory.length > maxHistory) {
      this.priceHistory.shift();
      this.volumeHistory.shift();
      this.candleHistory.shift();
    }
  }
  
  generateSignal(candle) {
    if (this.priceHistory.length < CONFIG.maLongPeriod) {
      return null;
    }
    
    // 计算技术指标
    const rsi = TechnicalIndicators.calculateRSI(this.priceHistory, CONFIG.rsiPeriod);
    const maShort = TechnicalIndicators.calculateEMA(this.priceHistory, CONFIG.maShortPeriod);
    const maLong = TechnicalIndicators.calculateEMA(this.priceHistory, CONFIG.maLongPeriod);
    const macd = TechnicalIndicators.calculateMACD(this.priceHistory);
    const volatility = TechnicalIndicators.calculateVolatility(this.priceHistory);
    
    if (!rsi || !maShort || !maLong || !macd || !volatility) return null;
    
    // 过滤条件 (更宽松)
    if (CONFIG.volatilityFilter && volatility > CONFIG.volatilityThreshold) return null;
    if (CONFIG.volumeFilter && candle.volume < this.getAverageVolume() * CONFIG.volumeThreshold) return null;
    
    const signals = [];
    
    // RSI信号
    if (rsi < CONFIG.rsiOversold) {
      signals.push({ type: 'LONG', strength: 0.8, reason: 'RSI超卖' });
    } else if (rsi > CONFIG.rsiOverbought) {
      signals.push({ type: 'SHORT', strength: 0.8, reason: 'RSI超买' });
    }
    
    // 均线信号
    if (maShort > maLong * 1.001) { // 更宽松的条件
      signals.push({ type: 'LONG', strength: 0.6, reason: '均线多头' });
    } else if (maShort < maLong * 0.999) {
      signals.push({ type: 'SHORT', strength: 0.6, reason: '均线空头' });
    }
    
    // MACD信号
    if (macd > 0) {
      signals.push({ type: 'LONG', strength: 0.5, reason: 'MACD多头' });
    } else if (macd < 0) {
      signals.push({ type: 'SHORT', strength: 0.5, reason: 'MACD空头' });
    }
    
    // 成交量确认
    const avgVolume = this.getAverageVolume();
    const volumeMultiplier = candle.volume > avgVolume * 1.2 ? 1.2 : 1.0;
    
    // 综合信号 (降低要求)
    const longSignals = signals.filter(s => s.type === 'LONG');
    const shortSignals = signals.filter(s => s.type === 'SHORT');
    
    if (longSignals.length >= 1) { // 只需要1个信号
      const totalStrength = longSignals.reduce((sum, s) => sum + s.strength, 0) * volumeMultiplier;
      if (totalStrength >= CONFIG.minSignalStrength) {
        return {
          type: 'LONG',
          strength: Math.min(totalStrength, 2.5),
          reasons: longSignals.map(s => s.reason),
          indicators: { rsi, maShort, maLong, macd, volatility, volume: candle.volume }
        };
      }
    }
    
    if (shortSignals.length >= 1) { // 只需要1个信号
      const totalStrength = shortSignals.reduce((sum, s) => sum + s.strength, 0) * volumeMultiplier;
      if (totalStrength >= CONFIG.minSignalStrength) {
        return {
          type: 'SHORT',
          strength: Math.min(totalStrength, 2.5),
          reasons: shortSignals.map(s => s.reason),
          indicators: { rsi, maShort, maLong, macd, volatility, volume: candle.volume }
        };
      }
    }
    
    return null;
  }
  
  getAverageVolume(period = 20) {
    if (this.volumeHistory.length < period) return 0;
    const recentVolumes = this.volumeHistory.slice(-period);
    return recentVolumes.reduce((sum, vol) => sum + vol, 0) / period;
  }
}

// 平衡交易执行器
class BalancedTradeExecutor {
  static openPosition(signal, candle) {
    if (tradingState.position) return false; // 已有持仓
    
    // 适度的连续亏损保护
    if (tradingState.consecutiveLosses >= 5) {
      const requiredStrength = CONFIG.minSignalStrength + (tradingState.consecutiveLosses - 4) * 0.3;
      if (signal.strength < requiredStrength) return false;
    }
    
    const availableBalance = tradingState.balance * CONFIG.maxPositionPercent;
    const positionSize = (availableBalance * CONFIG.leverage) / candle.close;
    const fee = positionSize * candle.close * CONFIG.feeRate;
    
    if (fee > tradingState.balance * 0.1) return false; // 手续费不超过10%
    
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
      console.log(`开仓 ${signal.type} @ ${candle.close} | 数量: ${positionSize.toFixed(4)} | 信号强度: ${signal.strength.toFixed(2)}`);
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
    
    // 更新连续亏损统计
    if (pnl > 0) {
      tradingState.consecutiveLosses = 0;
      tradingState.winningTrades++;
      tradingState.totalProfit += pnl;
    } else {
      tradingState.consecutiveLosses++;
      if (tradingState.consecutiveLosses > tradingState.maxConsecutiveLosses) {
        tradingState.maxConsecutiveLosses = tradingState.consecutiveLosses;
      }
      tradingState.losingTrades++;
      tradingState.totalLoss += Math.abs(pnl);
    }
    
    tradingState.totalTrades++;
    
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
      signalStrength: position.signal.strength,
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
    
    if ((position.side === 'LONG' && currentPrice <= position.stopLoss) ||
        (position.side === 'SHORT' && currentPrice >= position.stopLoss)) {
      return this.closePosition(candle, '止损');
    }
    
    return false;
  }
  
  static checkTakeProfit(candle) {
    if (!tradingState.position) return false;
    
    const position = tradingState.position;
    const currentPrice = candle.close;
    
    if ((position.side === 'LONG' && currentPrice >= position.takeProfit) ||
        (position.side === 'SHORT' && currentPrice <= position.takeProfit)) {
      return this.closePosition(candle, '止盈');
    }
    
    return false;
  }
}

// 主回测函数
async function runBalancedBacktest() {
  console.log('🚀 开始平衡版历史数据回测...');
  console.log(`📊 数据文件: real_historical_data_2022_2024.json`);
  console.log(`💰 初始资金: ${CONFIG.initialBalance} USDT`);
  console.log(`📈 杠杆倍数: ${CONFIG.leverage}x (平衡版)`);
  console.log(`🎯 最小信号强度: ${CONFIG.minSignalStrength}`);
  console.log(`📊 波动率阈值: ${CONFIG.volatilityThreshold}`);
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
  const strategy = new BalancedTradingStrategy();
  const startTime = Date.now();
  
  // 遍历历史数据
  for (let i = 0; i < historicalData.length; i++) {
    const candle = historicalData[i];
    
    // 添加数据到策略
    strategy.addData(candle);
    
    // 检查止损止盈
    BalancedTradeExecutor.checkStopLoss(candle);
    BalancedTradeExecutor.checkTakeProfit(candle);
    
    // 生成交易信号
    if (!tradingState.position) {
      const signal = strategy.generateSignal(candle);
      if (signal) {
        BalancedTradeExecutor.openPosition(signal, candle);
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
    BalancedTradeExecutor.closePosition(historicalData[historicalData.length - 1], '回测结束');
  }
  
  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;
  
  // 生成回测报告
  generateBalancedReport(historicalData, duration);
}

// 生成平衡版回测报告
function generateBalancedReport(data, duration) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 平衡版历史数据回测报告');
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
  const annualizedReturn = tradingState.totalTrades > 0 ? (Math.pow(finalBalance / CONFIG.initialBalance, 365 / tradingDays) - 1) * 100 : 0;
  
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
  console.log(`   盈亏比: ${avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : 'N/A'}`);
  console.log(`   盈利因子: ${profitFactor.toFixed(2)}`);
  console.log(`   最大连续亏损: ${tradingState.maxConsecutiveLosses} 次`);
  console.log('');
  
  // 策略评估
  console.log('🎯 策略评估:');
  if (totalReturn > 10 && winRate > 45 && profitFactor > 1.1) {
    console.log('   ✅ 平衡策略表现良好！');
  } else if (totalReturn > 0 && winRate > 35) {
    console.log('   ⚠️  平衡策略表现一般，可以接受');
  } else {
    console.log('   ❌ 策略仍需调整');
  }
  
  console.log(`   风险调整收益: ${(annualizedReturn / (tradingState.maxDrawdown * 100 || 1)).toFixed(2)}`);
  console.log(`   交易频率: ${(tradingState.totalTrades / tradingDays * 30).toFixed(1)} 笔/月`);
  
  // 与其他策略对比
  console.log('');
  console.log('📈 策略对比:');
  console.log('   原策略: -91.30% 收益率, 33.96% 胜率, 0.92 盈利因子');
  console.log('   优化策略: 0.00% 收益率, 0.00% 胜率, 0.00 盈利因子 (过于保守)');
  console.log(`   平衡策略: ${totalReturn.toFixed(2)}% 收益率, ${winRate.toFixed(2)}% 胜率, ${profitFactor.toFixed(2)} 盈利因子`);
  
  console.log('='.repeat(80));
  
  // 保存平衡版报告
  saveBalancedReport(data, duration);
}

// 保存平衡版报告
function saveBalancedReport(data, duration) {
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
      maxConsecutiveLosses: tradingState.maxConsecutiveLosses,
      processingTime: duration
    },
    balancedConfig: CONFIG,
    trades: tradingState.trades.slice(-50), // 保存最后50笔交易
    strategyComparison: {
      original: { totalReturn: -91.30, winRate: 33.96, profitFactor: 0.92 },
      optimized: { totalReturn: 0.00, winRate: 0.00, profitFactor: 0.00 },
      balanced: {
        totalReturn: ((tradingState.balance - CONFIG.initialBalance) / CONFIG.initialBalance) * 100,
        winRate: tradingState.totalTrades > 0 ? (tradingState.winningTrades / tradingState.totalTrades) * 100 : 0,
        profitFactor: tradingState.totalLoss > 0 ? tradingState.totalProfit / tradingState.totalLoss : 0
      }
    }
  };
  
  const reportPath = path.join(__dirname, 'reports', 'balanced_backtest_report.json');
  
  // 确保reports目录存在
  const reportsDir = path.dirname(reportPath);
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 平衡版详细报告已保存: ${reportPath}`);
}

// 运行平衡版回测
if (require.main === module) {
  runBalancedBacktest().catch(console.error);
}

module.exports = { runBalancedBacktest, CONFIG, tradingState };