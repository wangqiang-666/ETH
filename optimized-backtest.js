/**
 * 优化版历史数据回测脚本
 * 基于第一次回测结果优化策略参数
 */

const fs = require('fs');
const path = require('path');

// 优化后的配置参数
const CONFIG = {
  // 交易参数
  initialBalance: 10000, // 初始资金 USDT
  leverage: 2, // 降低杠杆倍数
  feeRate: 0.0005, // 手续费率 0.05%
  
  // 优化后的策略参数
  rsiPeriod: 21, // 增加RSI周期
  rsiOverbought: 75, // 提高超买阈值
  rsiOversold: 25, // 降低超卖阈值
  maShortPeriod: 20, // 增加短期均线周期
  maLongPeriod: 50, // 增加长期均线周期
  
  // 改进的风险管理
  stopLossPercent: 0.015, // 收紧止损 1.5%
  takeProfitPercent: 0.03, // 收紧止盈 3%
  maxPositionPercent: 0.6, // 降低最大仓位 60%
  
  // 新增过滤条件
  minSignalStrength: 1.5, // 最小信号强度
  volatilityFilter: true, // 启用波动率过滤
  trendFilter: true, // 启用趋势过滤
  volumeFilter: true, // 启用成交量过滤
  
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
  consecutiveLosses: 0, // 连续亏损次数
  maxConsecutiveLosses: 0 // 最大连续亏损次数
};

// 增强的技术指标计算
class EnhancedTechnicalIndicators {
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
  
  static calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) return null;
    
    const sma = this.calculateSMA(prices, period);
    if (!sma) return null;
    
    const recentPrices = prices.slice(-period);
    const variance = recentPrices.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
    const standardDeviation = Math.sqrt(variance);
    
    return {
      upper: sma + (standardDeviation * stdDev),
      middle: sma,
      lower: sma - (standardDeviation * stdDev),
      bandwidth: (standardDeviation * stdDev * 2) / sma
    };
  }
  
  static calculateATR(candles, period = 14) {
    if (candles.length < period + 1) return null;
    
    const trueRanges = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }
    
    return this.calculateSMA(trueRanges, period);
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

// 优化的交易策略
class OptimizedTradingStrategy {
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
    const maxHistory = 200;
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
    const rsi = EnhancedTechnicalIndicators.calculateRSI(this.priceHistory, CONFIG.rsiPeriod);
    const maShort = EnhancedTechnicalIndicators.calculateEMA(this.priceHistory, CONFIG.maShortPeriod);
    const maLong = EnhancedTechnicalIndicators.calculateEMA(this.priceHistory, CONFIG.maLongPeriod);
    const bb = EnhancedTechnicalIndicators.calculateBollingerBands(this.priceHistory);
    const atr = EnhancedTechnicalIndicators.calculateATR(this.candleHistory);
    const volatility = EnhancedTechnicalIndicators.calculateVolatility(this.priceHistory);
    
    if (!rsi || !maShort || !maLong || !bb || !atr || !volatility) return null;
    
    // 过滤条件
    if (CONFIG.volatilityFilter && volatility > 1.5) return null; // 过滤高波动期
    if (CONFIG.volumeFilter && candle.volume < this.getAverageVolume() * 0.8) return null; // 过滤低成交量
    
    const signals = [];
    
    // RSI信号 (更严格的条件)
    if (rsi < CONFIG.rsiOversold && rsi > 15) { // 避免极端超卖
      signals.push({ type: 'LONG', strength: 0.8, reason: 'RSI超卖' });
    } else if (rsi > CONFIG.rsiOverbought && rsi < 85) { // 避免极端超买
      signals.push({ type: 'SHORT', strength: 0.8, reason: 'RSI超买' });
    }
    
    // 均线信号 (更严格的条件)
    const maDiff = (maShort - maLong) / maLong;
    if (maDiff > 0.005 && maShort > maLong) { // 短均线明显高于长均线
      signals.push({ type: 'LONG', strength: 0.7, reason: '均线多头' });
    } else if (maDiff < -0.005 && maShort < maLong) { // 短均线明显低于长均线
      signals.push({ type: 'SHORT', strength: 0.7, reason: '均线空头' });
    }
    
    // 布林带信号
    if (candle.close < bb.lower && rsi < 40) {
      signals.push({ type: 'LONG', strength: 0.6, reason: '布林带下轨支撑' });
    } else if (candle.close > bb.upper && rsi > 60) {
      signals.push({ type: 'SHORT', strength: 0.6, reason: '布林带上轨阻力' });
    }
    
    // 趋势过滤
    if (CONFIG.trendFilter) {
      const trendStrength = this.calculateTrendStrength();
      if (Math.abs(trendStrength) < 0.3) return null; // 过滤震荡行情
    }
    
    // 成交量确认
    const avgVolume = this.getAverageVolume();
    const volumeMultiplier = candle.volume > avgVolume * 1.5 ? 1.3 : 
                           candle.volume > avgVolume * 1.2 ? 1.1 : 1.0;
    
    // 综合信号
    const longSignals = signals.filter(s => s.type === 'LONG');
    const shortSignals = signals.filter(s => s.type === 'SHORT');
    
    if (longSignals.length >= 2) { // 需要至少2个多头信号
      const totalStrength = longSignals.reduce((sum, s) => sum + s.strength, 0) * volumeMultiplier;
      if (totalStrength >= CONFIG.minSignalStrength) {
        return {
          type: 'LONG',
          strength: Math.min(totalStrength, 3.0),
          reasons: longSignals.map(s => s.reason),
          indicators: { rsi, maShort, maLong, bb, atr, volatility, volume: candle.volume }
        };
      }
    }
    
    if (shortSignals.length >= 2) { // 需要至少2个空头信号
      const totalStrength = shortSignals.reduce((sum, s) => sum + s.strength, 0) * volumeMultiplier;
      if (totalStrength >= CONFIG.minSignalStrength) {
        return {
          type: 'SHORT',
          strength: Math.min(totalStrength, 3.0),
          reasons: shortSignals.map(s => s.reason),
          indicators: { rsi, maShort, maLong, bb, atr, volatility, volume: candle.volume }
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
  
  calculateTrendStrength() {
    if (this.priceHistory.length < 50) return 0;
    
    const recent = this.priceHistory.slice(-50);
    const firstHalf = recent.slice(0, 25);
    const secondHalf = recent.slice(25);
    
    const firstAvg = firstHalf.reduce((sum, price) => sum + price, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, price) => sum + price, 0) / secondHalf.length;
    
    return (secondAvg - firstAvg) / firstAvg;
  }
}

// 改进的交易执行器
class ImprovedTradeExecutor {
  static openPosition(signal, candle) {
    if (tradingState.position) return false; // 已有持仓
    
    // 连续亏损保护
    if (tradingState.consecutiveLosses >= 3) {
      const requiredStrength = CONFIG.minSignalStrength + (tradingState.consecutiveLosses - 2) * 0.5;
      if (signal.strength < requiredStrength) return false;
    }
    
    const availableBalance = tradingState.balance * CONFIG.maxPositionPercent;
    const positionSize = (availableBalance * CONFIG.leverage) / candle.close;
    const fee = positionSize * candle.close * CONFIG.feeRate;
    
    if (fee > tradingState.balance * 0.05) return false; // 手续费不超过5%
    
    // 动态止损止盈 (基于ATR)
    const atr = signal.indicators?.atr || candle.close * 0.02;
    const stopLossDistance = Math.max(atr * 1.5, candle.close * CONFIG.stopLossPercent);
    const takeProfitDistance = Math.max(atr * 2.5, candle.close * CONFIG.takeProfitPercent);
    
    tradingState.position = {
      side: signal.type,
      size: positionSize,
      entryPrice: candle.close,
      timestamp: candle.timestamp,
      stopLoss: signal.type === 'LONG' 
        ? candle.close - stopLossDistance
        : candle.close + stopLossDistance,
      takeProfit: signal.type === 'LONG'
        ? candle.close + takeProfitDistance
        : candle.close - takeProfitDistance,
      signal: signal,
      trailingStop: null // 追踪止损
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
  
  static updateTrailingStop(candle) {
    if (!tradingState.position) return;
    
    const position = tradingState.position;
    const currentPrice = candle.close;
    
    // 只有盈利时才启用追踪止损
    const isProfit = (position.side === 'LONG' && currentPrice > position.entryPrice) ||
                     (position.side === 'SHORT' && currentPrice < position.entryPrice);
    
    if (!isProfit) return;
    
    const atr = position.signal.indicators?.atr || currentPrice * 0.02;
    const trailingDistance = atr * 2;
    
    if (position.side === 'LONG') {
      const newTrailingStop = currentPrice - trailingDistance;
      if (!position.trailingStop || newTrailingStop > position.trailingStop) {
        position.trailingStop = newTrailingStop;
      }
    } else {
      const newTrailingStop = currentPrice + trailingDistance;
      if (!position.trailingStop || newTrailingStop < position.trailingStop) {
        position.trailingStop = newTrailingStop;
      }
    }
  }
  
  static checkStopLoss(candle) {
    if (!tradingState.position) return false;
    
    const position = tradingState.position;
    const currentPrice = candle.close;
    
    // 检查追踪止损
    if (position.trailingStop) {
      if ((position.side === 'LONG' && currentPrice <= position.trailingStop) ||
          (position.side === 'SHORT' && currentPrice >= position.trailingStop)) {
        return this.closePosition(candle, '追踪止损');
      }
    }
    
    // 检查固定止损
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
async function runOptimizedBacktest() {
  console.log('🚀 开始优化版历史数据回测...');
  console.log(`📊 数据文件: real_historical_data_2022_2024.json`);
  console.log(`💰 初始资金: ${CONFIG.initialBalance} USDT`);
  console.log(`📈 杠杆倍数: ${CONFIG.leverage}x (优化后)`);
  console.log(`🎯 最小信号强度: ${CONFIG.minSignalStrength}`);
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
  const strategy = new OptimizedTradingStrategy();
  const startTime = Date.now();
  
  // 遍历历史数据
  for (let i = 0; i < historicalData.length; i++) {
    const candle = historicalData[i];
    
    // 添加数据到策略
    strategy.addData(candle);
    
    // 更新追踪止损
    ImprovedTradeExecutor.updateTrailingStop(candle);
    
    // 检查止损止盈
    ImprovedTradeExecutor.checkStopLoss(candle);
    ImprovedTradeExecutor.checkTakeProfit(candle);
    
    // 生成交易信号
    if (!tradingState.position) {
      const signal = strategy.generateSignal(candle);
      if (signal) {
        ImprovedTradeExecutor.openPosition(signal, candle);
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
    ImprovedTradeExecutor.closePosition(historicalData[historicalData.length - 1], '回测结束');
  }
  
  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;
  
  // 生成回测报告
  generateOptimizedReport(historicalData, duration);
}

// 生成优化版回测报告
function generateOptimizedReport(data, duration) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 优化版历史数据回测报告');
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
  
  // 风险指标
  const sharpeRatio = annualizedReturn / (tradingState.maxDrawdown * 100 || 1);
  const calmarRatio = annualizedReturn / (tradingState.maxDrawdown * 100 || 1);
  
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
  console.log(`   夏普比率: ${sharpeRatio.toFixed(2)}`);
  console.log(`   卡尔玛比率: ${calmarRatio.toFixed(2)}`);
  console.log('');
  
  console.log('📊 交易统计:');
  console.log(`   总交易次数: ${tradingState.totalTrades}`);
  console.log(`   盈利交易: ${tradingState.winningTrades} (${winRate.toFixed(1)}%)`);
  console.log(`   亏损交易: ${tradingState.losingTrades} (${(100 - winRate).toFixed(1)}%)`);
  console.log(`   平均盈利: ${avgWin.toFixed(2)} USDT`);
  console.log(`   平均亏损: ${avgLoss.toFixed(2)} USDT`);
  console.log(`   盈亏比: ${(avgWin / avgLoss).toFixed(2)}`);
  console.log(`   盈利因子: ${profitFactor.toFixed(2)}`);
  console.log(`   最大连续亏损: ${tradingState.maxConsecutiveLosses} 次`);
  console.log('');
  
  // 策略评估
  console.log('🎯 策略评估:');
  if (totalReturn > 0 && winRate > 50 && profitFactor > 1.2) {
    console.log('   ✅ 优化策略表现优秀！');
  } else if (totalReturn > 0 && winRate > 40) {
    console.log('   ⚠️  优化策略表现良好，仍有改进空间');
  } else {
    console.log('   ❌ 策略仍需进一步优化');
  }
  
  console.log(`   风险调整收益: ${(annualizedReturn / (tradingState.maxDrawdown * 100 || 1)).toFixed(2)}`);
  console.log(`   交易频率: ${(tradingState.totalTrades / tradingDays * 30).toFixed(1)} 笔/月`);
  
  // 与原策略对比
  console.log('');
  console.log('📈 优化效果对比:');
  console.log('   原策略: -91.30% 收益率, 33.96% 胜率, 0.92 盈利因子');
  console.log(`   优化策略: ${totalReturn.toFixed(2)}% 收益率, ${winRate.toFixed(2)}% 胜率, ${profitFactor.toFixed(2)} 盈利因子`);
  
  const improvement = totalReturn - (-91.30);
  console.log(`   收益率改进: ${improvement >= 0 ? '+' : ''}${improvement.toFixed(2)} 百分点`);
  
  console.log('='.repeat(80));
  
  // 保存优化版报告
  saveOptimizedReport(data, duration);
}

// 保存优化版报告
function saveOptimizedReport(data, duration) {
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
    optimizedConfig: CONFIG,
    trades: tradingState.trades.slice(-100), // 保存最后100笔交易
    comparison: {
      originalStrategy: {
        totalReturn: -91.30,
        winRate: 33.96,
        profitFactor: 0.92
      },
      optimizedStrategy: {
        totalReturn: ((tradingState.balance - CONFIG.initialBalance) / CONFIG.initialBalance) * 100,
        winRate: tradingState.totalTrades > 0 ? (tradingState.winningTrades / tradingState.totalTrades) * 100 : 0,
        profitFactor: tradingState.totalLoss > 0 ? tradingState.totalProfit / tradingState.totalLoss : 0
      }
    }
  };
  
  const reportPath = path.join(__dirname, 'reports', 'optimized_backtest_report.json');
  
  // 确保reports目录存在
  const reportsDir = path.dirname(reportPath);
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 优化版详细报告已保存: ${reportPath}`);
}

// 运行优化版回测
if (require.main === module) {
  runOptimizedBacktest().catch(console.error);
}

module.exports = { runOptimizedBacktest, CONFIG, tradingState };