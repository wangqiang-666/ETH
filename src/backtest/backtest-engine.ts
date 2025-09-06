import { SmartSignalResult } from '../analyzers/smart-signal-analyzer';
import type { MarketData } from '../services/okx-data-service';
import { riskManagementService } from '../services/risk-management-service';

// 回测交易记录
export interface BacktestTrade {
  id: string;
  timestamp: number;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  entryTime: number;
  exitTime?: number;
  pnl?: number;
  pnlPercent?: number;
  fees: number;
  status: 'OPEN' | 'CLOSED' | 'STOPPED';
  stopLoss?: number;
  takeProfit?: number;
  signal: SmartSignalResult;
  exitReason?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'SIGNAL_REVERSE' | 'TIME_LIMIT' | 'MANUAL';
}

// 回测配置
export interface BacktestConfig {
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  maxPositionSize: number; // 最大仓位比例 (0-1)
  tradingFee: number; // 交易手续费比例
  slippage: number; // 滑点比例
  maxHoldingTime: number; // 最大持仓时间(小时)
  riskManagement: {
    maxDailyLoss: number; // 最大日损失比例
    maxDrawdown: number; // 最大回撤比例
    positionSizing: 'FIXED' | 'KELLY' | 'RISK_PARITY';
  };
}

// 回测结果
export interface BacktestResult {
  summary: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalReturn: number;
    totalReturnPercent: number;
    annualizedReturn: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    sharpeRatio: number;
    sortinoRatio: number;
    calmarRatio: number;
    profitFactor: number;
    avgWin: number;
    avgLoss: number;
    avgWinPercent: number;
    avgLossPercent: number;
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
    avgHoldingTime: number; // 小时
    totalFees: number;
    recoveryFactor: number;
    // 新增：样本健壮性相关字段
    observationDays: number; // 实际观测天数（未应用最小年化基准前）
    effectiveAnnualizationDays: number; // 年化换算所用天数（>=30）
    returnObservations: number; // 收益序列观测点数（equity 差分长度）
    sampleQuality: 'INSUFFICIENT' | 'LIMITED' | 'ADEQUATE';
  };
  trades: BacktestTrade[];
  equity: { timestamp: number; value: number; drawdown: number }[];
  monthlyReturns: { month: string; return: number; trades: number }[];
  riskMetrics: {
    var95: number; // 95% VaR
    cvar95: number; // 95% CVaR
    volatility: number;
    beta: number;
    alpha: number;
    informationRatio: number;
  };
}

// 回测引擎
export class BacktestEngine {
  private config: BacktestConfig;
  private trades: BacktestTrade[] = [];
  private equity: { timestamp: number; value: number; drawdown: number }[] = [];
  private currentCapital: number;
  private peakCapital: number;
  private currentDrawdown: number;
  private dailyReturns: number[] = [];
  private openPositions: Map<string, BacktestTrade> = new Map();
  private tradeIdCounter = 0;

  constructor(config: BacktestConfig) {
    this.config = config;
    this.currentCapital = config.initialCapital;
    this.peakCapital = config.initialCapital;
    this.currentDrawdown = 0;
  }

  /**
   * 运行回测
   */
  async runBacktest(
    signals: { timestamp: number; signal: SmartSignalResult; marketData: MarketData }[],
    marketDataHistory: MarketData[]
  ): Promise<BacktestResult> {
    console.log('🔄 开始回测...');
    console.log(`回测期间: ${this.config.startDate.toISOString()} - ${this.config.endDate.toISOString()}`);
    console.log(`初始资金: $${this.config.initialCapital.toLocaleString()}`);

    // 重置状态
    this.resetState();

    // 按时间排序
    const sortedSignals = signals.sort((a, b) => a.timestamp - b.timestamp);
    const sortedMarketData = marketDataHistory.sort((a, b) => a.timestamp - b.timestamp);

    // 处理每个信号
    for (const signalData of sortedSignals) {
      if (signalData.timestamp < this.config.startDate.getTime() || 
          signalData.timestamp > this.config.endDate.getTime()) {
        continue;
      }

      await this.processSignal(signalData, sortedMarketData);
      this.updateEquity(signalData.timestamp);
    }

    // 关闭所有未平仓位
    await this.closeAllPositions(this.config.endDate.getTime(), sortedMarketData);

    console.log('✅ 回测完成');
    return this.generateResult();
  }

  /**
   * 处理交易信号
   */
  private async processSignal(
    signalData: { timestamp: number; signal: SmartSignalResult; marketData: MarketData },
    marketDataHistory: MarketData[]
  ): Promise<void> {
    const { timestamp, signal, marketData } = signalData;

    // 检查风险管理限制
    if (!this.checkRiskLimits()) {
      return;
    }

    // 关闭过期持仓
    await this.closeExpiredPositions(timestamp, marketDataHistory);

    // 处理新信号
    if (signal.signal === 'BUY' || signal.signal === 'SELL') {
      await this.openPosition(signal, marketData, timestamp);
    }

    // 检查止盈止损
    await this.checkStopLevels(timestamp, marketDataHistory);
  }

  /**
   * 开仓
   */
  private async openPosition(
    signal: SmartSignalResult,
    marketData: MarketData,
    timestamp: number
  ): Promise<void> {
    const side = signal.signal === 'BUY' ? 'LONG' : 'SHORT';
    const entryPrice = this.calculateEntryPrice(marketData.price, side);
    
    // 计算仓位大小
    const positionSize = this.calculatePositionSize(signal, entryPrice);
    if (positionSize <= 0) return;

    const quantity = positionSize / entryPrice;
    const fees = positionSize * this.config.tradingFee;

    const trade: BacktestTrade = {
      id: `trade_${++this.tradeIdCounter}`,
      timestamp,
      symbol: 'ETH-USDT-SWAP',
      side,
      entryPrice,
      quantity,
      entryTime: timestamp,
      fees,
      status: 'OPEN',
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      signal
    };

    this.openPositions.set(trade.id, trade);
    this.currentCapital -= fees; // 扣除手续费

    console.log(`📈 开仓: ${side} ${quantity.toFixed(4)} ETH @ $${entryPrice.toFixed(2)}`);
  }

  /**
   * 平仓
   */
  private async closePosition(
    trade: BacktestTrade,
    exitPrice: number,
    timestamp: number,
    reason: BacktestTrade['exitReason']
  ): Promise<void> {
    const exitFees = trade.quantity * exitPrice * this.config.tradingFee;
    
    let pnl: number;
    if (trade.side === 'LONG') {
      pnl = (exitPrice - trade.entryPrice) * trade.quantity - trade.fees - exitFees;
    } else {
      pnl = (trade.entryPrice - exitPrice) * trade.quantity - trade.fees - exitFees;
    }

    const pnlPercent = pnl / (trade.entryPrice * trade.quantity);

    trade.exitPrice = exitPrice;
    trade.exitTime = timestamp;
    trade.pnl = pnl;
    trade.pnlPercent = pnlPercent;
    trade.fees += exitFees;
    trade.status = 'CLOSED';
    trade.exitReason = reason;

    this.currentCapital += pnl;
    this.trades.push(trade);
    this.openPositions.delete(trade.id);

    console.log(`📉 平仓: ${trade.side} PnL: $${pnl.toFixed(2)} (${(pnlPercent * 100).toFixed(2)}%)`);
  }

  /**
   * 检查止盈止损
   */
  private async checkStopLevels(
    timestamp: number,
    marketDataHistory: MarketData[]
  ): Promise<void> {
    const currentMarketData = this.findMarketDataByTimestamp(timestamp, marketDataHistory);
    if (!currentMarketData) return;

    for (const [tradeId, trade] of this.openPositions) {
      const currentPrice = currentMarketData.price;
      let shouldClose = false;
      let reason: BacktestTrade['exitReason'];

      if (trade.side === 'LONG') {
        if (trade.takeProfit && currentPrice >= trade.takeProfit) {
          shouldClose = true;
          reason = 'TAKE_PROFIT';
        } else if (trade.stopLoss && currentPrice <= trade.stopLoss) {
          shouldClose = true;
          reason = 'STOP_LOSS';
        }
      } else {
        if (trade.takeProfit && currentPrice <= trade.takeProfit) {
          shouldClose = true;
          reason = 'TAKE_PROFIT';
        } else if (trade.stopLoss && currentPrice >= trade.stopLoss) {
          shouldClose = true;
          reason = 'STOP_LOSS';
        }
      }

      if (shouldClose) {
        const exitPrice = this.calculateExitPrice(currentPrice, trade.side);
        await this.closePosition(trade, exitPrice, timestamp, reason!);
      }
    }
  }

  /**
   * 关闭过期持仓
   */
  private async closeExpiredPositions(
    timestamp: number,
    marketDataHistory: MarketData[]
  ): Promise<void> {
    const maxHoldingMs = this.config.maxHoldingTime * 60 * 60 * 1000;
    const currentMarketData = this.findMarketDataByTimestamp(timestamp, marketDataHistory);
    if (!currentMarketData) return;

    for (const [tradeId, trade] of this.openPositions) {
      if (timestamp - trade.entryTime >= maxHoldingMs) {
        const exitPrice = this.calculateExitPrice(currentMarketData.price, trade.side);
        await this.closePosition(trade, exitPrice, timestamp, 'TIME_LIMIT');
      }
    }
  }

  /**
   * 关闭所有持仓
   */
  private async closeAllPositions(
    timestamp: number,
    marketDataHistory: MarketData[]
  ): Promise<void> {
    const currentMarketData = this.findMarketDataByTimestamp(timestamp, marketDataHistory);
    if (!currentMarketData) return;

    for (const [tradeId, trade] of this.openPositions) {
      const exitPrice = this.calculateExitPrice(currentMarketData.price, trade.side);
      await this.closePosition(trade, exitPrice, timestamp, 'MANUAL');
    }
  }

  /**
   * 计算仓位大小
   */
  private calculatePositionSize(signal: SmartSignalResult, entryPrice: number): number {
    const maxPositionValue = this.currentCapital * this.config.maxPositionSize;
    
    switch (this.config.riskManagement.positionSizing) {
      case 'FIXED':
        return Math.min(maxPositionValue, this.currentCapital * 0.1); // 固定10%
      
      case 'KELLY':
        // Kelly公式: f = (bp - q) / b
        const winRate = 0.6; // 默认胜率
        const avgWin = signal.riskReward || 2;
        const avgLoss = 1;
        const kellyFraction = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin;
        return Math.min(maxPositionValue, this.currentCapital * Math.max(0, kellyFraction * 0.5));
      
      case 'RISK_PARITY':
        // 基于信号强度调整仓位
        const confidence = signal.strength.confidence;
        const riskAdjustedSize = maxPositionValue * confidence;
        return Math.min(maxPositionValue, riskAdjustedSize);
      
      default:
        return maxPositionValue * 0.1;
    }
  }

  /**
   * 计算入场价格（考虑滑点）
   */
  private calculateEntryPrice(marketPrice: number, side: 'LONG' | 'SHORT'): number {
    const slippage = this.config.slippage;
    return side === 'LONG' 
      ? marketPrice * (1 + slippage)
      : marketPrice * (1 - slippage);
  }

  /**
   * 计算出场价格（考虑滑点）
   */
  private calculateExitPrice(marketPrice: number, side: 'LONG' | 'SHORT'): number {
    const slippage = this.config.slippage;
    return side === 'LONG' 
      ? marketPrice * (1 - slippage)
      : marketPrice * (1 + slippage);
  }

  /**
   * 检查风险限制
   */
  private checkRiskLimits(): boolean {
    // 检查最大回撤
    if (this.currentDrawdown > this.config.riskManagement.maxDrawdown) {
      return false;
    }

    // 检查日损失限制
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTrades = this.trades.filter(t => t.exitTime && t.exitTime >= todayStart.getTime());
    const todayPnl = todayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const todayLossPercent = Math.abs(todayPnl) / this.config.initialCapital;
    
    if (todayPnl < 0 && todayLossPercent > this.config.riskManagement.maxDailyLoss) {
      return false;
    }

    return true;
  }

  /**
   * 更新权益曲线
   */
  private updateEquity(timestamp: number): void {
    // 计算当前权益
    let unrealizedPnl = 0;
    // 这里应该根据当前市价计算未实现盈亏，简化处理
    
    const currentEquity = this.currentCapital + unrealizedPnl;
    
    // 更新峰值和回撤
    if (currentEquity > this.peakCapital) {
      this.peakCapital = currentEquity;
      this.currentDrawdown = 0;
    } else {
      this.currentDrawdown = (this.peakCapital - currentEquity) / this.peakCapital;
    }

    this.equity.push({
      timestamp,
      value: currentEquity,
      drawdown: this.currentDrawdown
    });
  }

  /**
   * 根据时间戳查找市场数据
   */
  private findMarketDataByTimestamp(timestamp: number, marketDataHistory: MarketData[]): MarketData | null {
    // 找到最接近的市场数据
    let closest = marketDataHistory[0];
    let minDiff = Math.abs(timestamp - closest.timestamp);

    for (const data of marketDataHistory) {
      const diff = Math.abs(timestamp - data.timestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closest = data;
      }
    }

    return minDiff < 60000 ? closest : null; // 1分钟内的数据才有效
  }

  /**
   * 重置状态
   */
  private resetState(): void {
    this.trades = [];
    this.equity = [];
    this.currentCapital = this.config.initialCapital;
    this.peakCapital = this.config.initialCapital;
    this.currentDrawdown = 0;
    this.dailyReturns = [];
    this.openPositions.clear();
    this.tradeIdCounter = 0;
  }

  /**
   * 生成回测结果
   */
  private generateResult(): BacktestResult {
    const summary = this.calculateSummaryStats();
    const monthlyReturns = this.calculateMonthlyReturns();
    const riskMetrics = this.calculateRiskMetrics();

    return {
      summary,
      trades: [...this.trades],
      equity: [...this.equity],
      monthlyReturns,
      riskMetrics
    };
  }

  /**
   * 计算汇总统计
   */
  private calculateSummaryStats() {
    const totalTrades = this.trades.length;
    const winningTrades = this.trades.filter(t => (t.pnl || 0) > 0).length;
    const losingTrades = this.trades.filter(t => (t.pnl || 0) < 0).length;
    const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;

    const totalPnl = this.trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalReturn = totalPnl;
    const totalReturnPercent = totalReturn / this.config.initialCapital;

    // 短样本稳健处理：观测期少于30天时，按30天基准进行年化，避免极端放大
    const rawTradingDays = Math.max(0, (this.config.endDate.getTime() - this.config.startDate.getTime()) / (1000 * 60 * 60 * 24));
    const MIN_ANNUALIZATION_DAYS = 30; // 至少按30天基准年化
    const tradingDays = Math.max(rawTradingDays, MIN_ANNUALIZATION_DAYS);
    const annualizedReturn = tradingDays > 0 ? totalReturnPercent * (365 / tradingDays) : 0;

    const maxDrawdown = Math.max(...this.equity.map(e => e.drawdown));
    const maxDrawdownPercent = maxDrawdown;

    const wins = this.trades.filter(t => (t.pnl || 0) > 0).map(t => t.pnl || 0);
    const losses = this.trades.filter(t => (t.pnl || 0) < 0).map(t => Math.abs(t.pnl || 0));

    const avgWin = wins.length > 0 ? wins.reduce((sum, w) => sum + w, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((sum, l) => sum + l, 0) / losses.length : 0;
    const avgWinPercent = avgWin / this.config.initialCapital;
    const avgLossPercent = avgLoss / this.config.initialCapital;

    const profitFactor = avgLoss > 0 ? (avgWin * winningTrades) / (avgLoss * losingTrades) : 0;

    // 计算连续盈亏
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;

    for (const trade of this.trades) {
      if ((trade.pnl || 0) > 0) {
        currentWinStreak++;
        currentLossStreak = 0;
        maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWinStreak);
      } else {
        currentLossStreak++;
        currentWinStreak = 0;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);
      }
    }

    const avgHoldingTime = this.trades.length > 0 
      ? this.trades.reduce((sum, t) => sum + ((t.exitTime || t.entryTime) - t.entryTime), 0) / this.trades.length / (1000 * 60 * 60)
      : 0;

    const totalFees = this.trades.reduce((sum, t) => sum + t.fees, 0);

    // 计算风险调整指标（短样本稳健处理）
    const returns = this.equity
      .map((e, i) => (i > 0 ? (e.value - this.equity[i - 1].value) / this.equity[i - 1].value : 0))
      .slice(1);

    const DAYS_PER_YEAR = 365;
    const EPS = 1e-6; // 防止除零

    let avgReturn = 0;
    let returnStd = 0;
    if (returns.length > 0) {
      avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    }
    if (returns.length > 1) {
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1); // 样本标准差
      returnStd = Math.sqrt(variance);
    } else {
      returnStd = 0;
    }

    // 对非常短的样本(少于30个观测)进行稳健折减，降低夏普与索提诺的过度乐观/悲观
    const stabilityFactor = Math.min(1, returns.length / 30);

    // 新增：样本质量判定与最小观测阈值
    const returnObservations = returns.length;
    const MIN_OBS_FOR_RISK_METRICS = 10; // 少于该值时不计算风险调整比率
    let sampleQuality: 'INSUFFICIENT' | 'LIMITED' | 'ADEQUATE' = 'ADEQUATE';
    if (returnObservations < MIN_OBS_FOR_RISK_METRICS || rawTradingDays < 7) {
      sampleQuality = 'INSUFFICIENT';
    } else if (returnObservations < 30 || rawTradingDays < 30) {
      sampleQuality = 'LIMITED';
    }

    // 稳健夏普/索提诺
    let sharpeRatio = 0;
    if (returnStd > EPS && returnObservations >= MIN_OBS_FOR_RISK_METRICS) {
      const denom = Math.max(returnStd, EPS) * Math.sqrt(DAYS_PER_YEAR);
      sharpeRatio = ((annualizedReturn - 0.02) / denom) * stabilityFactor;
      if (sampleQuality !== 'ADEQUATE') {
        // 对于样本不足/有限，限制极端值
        sharpeRatio = Math.max(-10, Math.min(10, sharpeRatio));
      }
    }

    const downReturns = returns.filter(r => r < 0);
    let downsideStd = 0;
    if (downReturns.length > 0) {
      // 使用均方根作为下行波动率（当样本很少时也加入EPS保护）
      downsideStd = Math.sqrt(downReturns.reduce((sum, r) => sum + r * r, 0) / downReturns.length);
    }

    let sortinoRatio = 0;
    if (downsideStd > EPS && returnObservations >= MIN_OBS_FOR_RISK_METRICS) {
      const denomDown = Math.max(downsideStd, EPS) * Math.sqrt(DAYS_PER_YEAR);
      sortinoRatio = ((annualizedReturn - 0.02) / denomDown) * stabilityFactor;
      if (sampleQuality !== 'ADEQUATE') {
        sortinoRatio = Math.max(-10, Math.min(10, sortinoRatio));
      }
    }

    const calmarRatio = maxDrawdownPercent > 0 ? annualizedReturn / maxDrawdownPercent : 0;
    const recoveryFactor = maxDrawdownPercent > 0 ? totalReturnPercent / maxDrawdownPercent : 0;

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      totalReturn,
      totalReturnPercent,
      annualizedReturn,
      maxDrawdown: maxDrawdown * this.config.initialCapital,
      maxDrawdownPercent,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      profitFactor,
      avgWin,
      avgLoss,
      avgWinPercent,
      avgLossPercent,
      maxConsecutiveWins,
      maxConsecutiveLosses,
      avgHoldingTime,
      totalFees,
      recoveryFactor,
      // 新增返回字段
      observationDays: rawTradingDays,
      effectiveAnnualizationDays: tradingDays,
      returnObservations,
      sampleQuality
    };
  }

  /**
   * 计算月度收益
   */
  private calculateMonthlyReturns() {
    const monthlyData = new Map<string, { return: number; trades: number }>();

    for (const trade of this.trades) {
      if (!trade.exitTime) continue;
      
      const date = new Date(trade.exitTime);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, { return: 0, trades: 0 });
      }
      
      const monthData = monthlyData.get(monthKey)!;
      monthData.return += (trade.pnl || 0) / this.config.initialCapital;
      monthData.trades += 1;
    }

    return Array.from(monthlyData.entries()).map(([month, data]) => ({
      month,
      return: data.return,
      trades: data.trades
    }));
  }

  /**
   * 计算风险指标
   */
  private calculateRiskMetrics() {
    const returns = this.equity.map((e, i) => i > 0 ? (e.value - this.equity[i-1].value) / this.equity[i-1].value : 0).slice(1);
    
    if (returns.length === 0) {
      return {
        var95: 0,
        cvar95: 0,
        volatility: 0,
        beta: 0,
        alpha: 0,
        informationRatio: 0
      };
    }

    // 计算VaR和CVaR
    const sortedReturns = [...returns].sort((a, b) => a - b);
    const var95Index = Math.floor(sortedReturns.length * 0.05);
    const var95 = sortedReturns[var95Index] || 0;
    const cvar95 = var95Index > 0 ? sortedReturns.slice(0, var95Index).reduce((sum, r) => sum + r, 0) / var95Index : 0;

    // 计算波动率
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const volatility = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);

    // 简化的Beta和Alpha计算（相对于市场，这里假设市场收益为0）
    const beta = 1; // 简化处理
    const alpha = avgReturn - 0.02 / 365; // 相对于无风险利率的超额收益
    const informationRatio = volatility > 0 ? alpha / volatility : 0;

    return {
      var95,
      cvar95,
      volatility,
      beta,
      alpha,
      informationRatio
    };
  }
}

// 导出回测引擎实例
export const backtestEngine = new BacktestEngine({
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-12-31'),
  initialCapital: 10000,
  maxPositionSize: 0.2,
  tradingFee: 0.001,
  slippage: 0.0005,
  maxHoldingTime: 24,
  riskManagement: {
    maxDailyLoss: 0.05,
    maxDrawdown: 0.2,
    positionSizing: 'RISK_PARITY'
  }
});