import { EventEmitter } from 'events';
import { BacktestEngine, BacktestConfig, BacktestResult } from '../backtest/backtest-engine.js';
import { enhancedOKXDataService } from '../services/enhanced-okx-data-service.js';
import type { MarketData } from '../services/okx-data-service.js';
import { SmartSignalAnalyzer } from '../analyzers/smart-signal-analyzer.js';

/**
 * 简化的ETH合约Agent演示
 * 专注于历史数据回测和基础决策功能
 */
export class ETHAgentDemo extends EventEmitter {
  private backtestEngine: BacktestEngine;
  private signalAnalyzer: SmartSignalAnalyzer;
  private isRunning: boolean = false;
  
  // Agent配置
  private config = {
    symbol: 'ETH-USDT-SWAP',
    initialCapital: 10000,
    maxPositionSize: 0.2,
    tradingFee: 0.001,
    slippage: 0.0005,
    maxHoldingTime: 24, // 小时
    stopLossPercent: 0.02,
    takeProfitPercent: 0.04
  };
  
  // 性能统计
  private stats = {
    totalBacktests: 0,
    bestReturn: 0,
    worstReturn: 0,
    avgWinRate: 0,
    totalTrades: 0
  };
  
  constructor() {
    super();
    
    // 初始化回测引擎
    this.backtestEngine = new BacktestEngine({
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
      initialCapital: this.config.initialCapital,
      maxPositionSize: this.config.maxPositionSize,
      tradingFee: this.config.tradingFee,
      slippage: this.config.slippage,
      maxHoldingTime: this.config.maxHoldingTime,
      riskManagement: {
        maxDailyLoss: 0.05,
        maxDrawdown: 0.2,
        positionSizing: 'RISK_PARITY'
      }
    });
    
    // 初始化信号分析器
    this.signalAnalyzer = new SmartSignalAnalyzer();
    
    console.log('[ETHAgentDemo] 🤖 ETH合约Agent演示版初始化完成');
  }
  
  /**
   * 启动Agent演示
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[ETHAgentDemo] Agent已在运行中');
      return;
    }
    
    console.log('[ETHAgentDemo] 🚀 启动ETH合约Agent演示...');
    
    this.isRunning = true;
    this.emit('started');
    
    console.log('[ETHAgentDemo] ✅ Agent演示启动成功');
    console.log('[ETHAgentDemo] 💡 使用 runHistoricalBacktest() 开始历史数据回测');
  }
  
  /**
   * 停止Agent
   */
  public stop(): void {
    if (!this.isRunning) return;
    
    console.log('[ETHAgentDemo] 🛑 停止ETH合约Agent演示');
    this.isRunning = false;
    this.emit('stopped');
  }
  
  /**
   * 运行历史数据回测
   */
  public async runHistoricalBacktest(
    startDate: Date = new Date('2024-01-01'),
    endDate: Date = new Date('2024-03-31')
  ): Promise<BacktestResult> {
    
    console.log('[ETHAgentDemo] 📊 开始历史数据回测...');
    console.log(`[ETHAgentDemo] 回测期间: ${startDate.toISOString().split('T')[0]} 至 ${endDate.toISOString().split('T')[0]}`);
    
    try {
      // 获取历史市场数据
      const marketDataHistory = await this.getHistoricalMarketData(startDate, endDate);
      
      if (marketDataHistory.length === 0) {
        throw new Error('无法获取历史市场数据');
      }
      
      console.log(`[ETHAgentDemo] 📈 获取到 ${marketDataHistory.length} 个数据点`);
      
      // 生成交易信号
      const signals = await this.generateTradingSignals(marketDataHistory);
      
      console.log(`[ETHAgentDemo] 🎯 生成 ${signals.length} 个交易信号`);
      
      // 运行回测
      const backtestResult = await this.backtestEngine.runBacktest(signals, marketDataHistory);
      
      // 更新统计
      this.updateStats(backtestResult);
      
      // 输出结果
      this.displayBacktestResults(backtestResult);
      
      this.emit('backtestCompleted', backtestResult);
      
      return backtestResult;
      
    } catch (error) {
      console.error('[ETHAgentDemo] ❌ 回测失败:', error);
      throw error;
    }
  }
  
  /**
   * 获取历史市场数据
   */
  private async getHistoricalMarketData(startDate: Date, endDate: Date): Promise<MarketData[]> {
    console.log('[ETHAgentDemo] 📥 获取历史市场数据...');
    
    // 模拟历史数据生成（实际应用中应该从数据库或API获取）
    const marketData: MarketData[] = [];
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    const interval = 15 * 60 * 1000; // 15分钟间隔
    
    let currentTime = startTime;
    let currentPrice = 3000; // ETH起始价格
    
    while (currentTime <= endTime) {
      // 模拟价格波动
      const change = (Math.random() - 0.5) * 0.02; // ±1%随机波动
      currentPrice = currentPrice * (1 + change);
      
      const high24h = currentPrice * (1 + Math.random() * 0.05);
      const low24h = currentPrice * (1 - Math.random() * 0.05);
      const volume = 1000000 + Math.random() * 5000000;
      const change24h = (Math.random() - 0.5) * 10; // ±5%
      
      marketData.push({
        symbol: this.config.symbol,
        price: currentPrice,
        volume,
        timestamp: currentTime,
        high24h,
        low24h,
        change24h,
        fundingRate: (Math.random() - 0.5) * 0.001,
        openInterest: 50000000 + Math.random() * 20000000
      });
      
      currentTime += interval;
    }
    
    console.log(`[ETHAgentDemo] ✅ 生成 ${marketData.length} 个历史数据点`);
    return marketData;
  }
  
  /**
   * 生成交易信号
   */
  private async generateTradingSignals(marketDataHistory: MarketData[]): Promise<Array<{
    timestamp: number;
    signal: any;
    marketData: MarketData;
  }>> {
    console.log('[ETHAgentDemo] 🎯 生成交易信号...');
    
    const signals = [];
    
    // 每隔一定间隔生成信号（模拟Agent决策）
    for (let i = 0; i < marketDataHistory.length; i += 4) { // 每小时一个信号
      const marketData = marketDataHistory[i];
      
      try {
        // 使用信号分析器生成信号
        const signalResult = await this.signalAnalyzer.analyzeSignal(marketData, []);
        
        // 简化信号格式以适配回测引擎
        const signal = {
          signal: this.convertSignalType(signalResult.signal),
          confidence: signalResult.strength.confidence,
          targetPrice: signalResult.targetPrice,
          stopLoss: signalResult.stopLoss,
          takeProfit: signalResult.takeProfit,
          positionSize: signalResult.positionSize
        };
        
        signals.push({
          timestamp: marketData.timestamp,
          signal,
          marketData
        });
        
      } catch (error) {
        // 如果信号生成失败，使用简单的技术指标信号
        const simpleSignal = this.generateSimpleSignal(marketData, i, marketDataHistory);
        
        signals.push({
          timestamp: marketData.timestamp,
          signal: simpleSignal,
          marketData
        });
      }
    }
    
    return signals;
  }
  
  /**
   * 转换信号类型
   */
  private convertSignalType(signalType: string): 'BUY' | 'SELL' | 'HOLD' {
    switch (signalType) {
      case 'STRONG_BUY':
      case 'BUY':
        return 'BUY';
      case 'STRONG_SELL':
      case 'SELL':
        return 'SELL';
      default:
        return 'HOLD';
    }
  }
  
  /**
   * 生成简单信号（备用方案）
   */
  private generateSimpleSignal(marketData: MarketData, index: number, history: MarketData[]): any {
    // 简单的移动平均策略
    const lookback = 20;
    if (index < lookback) {
      return {
        signal: 'HOLD',
        confidence: 0.5,
        targetPrice: marketData.price,
        stopLoss: marketData.price * 0.98,
        takeProfit: marketData.price * 1.02,
        positionSize: 0.1
      };
    }
    
    // 计算移动平均
    const recentPrices = history.slice(Math.max(0, index - lookback), index)
      .map(d => d.price);
    const ma = recentPrices.reduce((sum, price) => sum + price, 0) / recentPrices.length;
    
    // 生成信号
    const signal = marketData.price > ma * 1.01 ? 'BUY' : 
                   marketData.price < ma * 0.99 ? 'SELL' : 'HOLD';
    
    return {
      signal,
      confidence: 0.6,
      targetPrice: signal === 'BUY' ? marketData.price * 1.02 : marketData.price * 0.98,
      stopLoss: signal === 'BUY' ? marketData.price * 0.98 : marketData.price * 1.02,
      takeProfit: signal === 'BUY' ? marketData.price * 1.04 : marketData.price * 0.96,
      positionSize: 0.15
    };
  }
  
  /**
   * 更新统计信息
   */
  private updateStats(result: BacktestResult): void {
    this.stats.totalBacktests++;
    this.stats.bestReturn = Math.max(this.stats.bestReturn, result.summary.totalReturnPercent);
    this.stats.worstReturn = Math.min(this.stats.worstReturn, result.summary.totalReturnPercent);
    this.stats.avgWinRate = (this.stats.avgWinRate * (this.stats.totalBacktests - 1) + result.summary.winRate) / this.stats.totalBacktests;
    this.stats.totalTrades += result.summary.totalTrades;
  }
  
  /**
   * 显示回测结果
   */
  private displayBacktestResults(result: BacktestResult): void {
    console.log('\n' + '='.repeat(60));
    console.log('🎯 ETH合约Agent回测结果');
    console.log('='.repeat(60));
    
    console.log(`📊 基础统计:`);
    console.log(`   总交易次数: ${result.summary.totalTrades}`);
    console.log(`   胜率: ${(result.summary.winRate * 100).toFixed(2)}%`);
    console.log(`   盈利交易: ${result.summary.winningTrades}`);
    console.log(`   亏损交易: ${result.summary.losingTrades}`);
    
    console.log(`\n💰 收益统计:`);
    console.log(`   总收益率: ${(result.summary.totalReturnPercent * 100).toFixed(2)}%`);
    console.log(`   年化收益率: ${(result.summary.annualizedReturn * 100).toFixed(2)}%`);
    console.log(`   最大回撤: ${(result.summary.maxDrawdownPercent * 100).toFixed(2)}%`);
    console.log(`   夏普比率: ${result.summary.sharpeRatio.toFixed(3)}`);
    
    console.log(`\n📈 风险指标:`);
    console.log(`   盈亏比: ${result.summary.profitFactor.toFixed(2)}`);
    console.log(`   平均盈利: ${result.summary.avgWinPercent.toFixed(2)}%`);
    console.log(`   平均亏损: ${result.summary.avgLossPercent.toFixed(2)}%`);
    console.log(`   平均持仓时间: ${result.summary.avgHoldingTime.toFixed(1)}小时`);
    
    console.log(`\n🎲 Agent统计:`);
    console.log(`   累计回测次数: ${this.stats.totalBacktests}`);
    console.log(`   最佳收益率: ${(this.stats.bestReturn * 100).toFixed(2)}%`);
    console.log(`   最差收益率: ${(this.stats.worstReturn * 100).toFixed(2)}%`);
    console.log(`   平均胜率: ${(this.stats.avgWinRate * 100).toFixed(2)}%`);
    console.log(`   累计交易次数: ${this.stats.totalTrades}`);
    
    console.log('='.repeat(60));
    
    // 评估Agent表现
    this.evaluateAgentPerformance(result);
  }
  
  /**
   * 评估Agent表现
   */
  private evaluateAgentPerformance(result: BacktestResult): void {
    console.log('\n🤖 Agent表现评估:');
    
    let grade = 'F';
    let comment = '';
    
    if (result.summary.totalReturnPercent > 0.2 && result.summary.winRate > 0.6 && result.summary.sharpeRatio > 1.5) {
      grade = 'A+';
      comment = '优秀！Agent表现卓越，具备实盘交易潜力';
    } else if (result.summary.totalReturnPercent > 0.1 && result.summary.winRate > 0.55 && result.summary.sharpeRatio > 1.0) {
      grade = 'A';
      comment = '良好！Agent表现稳定，策略有效';
    } else if (result.summary.totalReturnPercent > 0.05 && result.summary.winRate > 0.5 && result.summary.sharpeRatio > 0.5) {
      grade = 'B';
      comment = '中等！Agent有盈利能力，需要优化';
    } else if (result.summary.totalReturnPercent > 0 && result.summary.winRate > 0.45) {
      grade = 'C';
      comment = '及格！Agent基本可用，需要大幅改进';
    } else {
      grade = 'D';
      comment = '不及格！Agent需要重新设计策略';
    }
    
    console.log(`   评级: ${grade}`);
    console.log(`   评价: ${comment}`);
    
    // 改进建议
    console.log('\n💡 改进建议:');
    if (result.summary.winRate < 0.5) {
      console.log('   - 胜率偏低，考虑优化入场条件');
    }
    if (result.summary.maxDrawdownPercent > 0.15) {
      console.log('   - 最大回撤过大，需要加强风险控制');
    }
    if (result.summary.sharpeRatio < 1.0) {
      console.log('   - 夏普比率偏低，需要提高风险调整后收益');
    }
    if (result.summary.avgHoldingTime > 48) {
      console.log('   - 持仓时间过长，考虑优化出场策略');
    }
    
    console.log('\n');
  }
  
  /**
   * 获取Agent状态
   */
  public getStatus(): {
    isRunning: boolean;
    config: {
      symbol: string;
      initialCapital: number;
      maxPositionSize: number;
      tradingFee: number;
      slippage: number;
      maxHoldingTime: number;
      stopLossPercent: number;
      takeProfitPercent: number;
    };
    stats: {
      totalBacktests: number;
      bestReturn: number;
      worstReturn: number;
      avgWinRate: number;
      totalTrades: number;
    };
  } {
    return {
      isRunning: this.isRunning,
      config: { ...this.config },
      stats: { ...this.stats }
    };
  }
  
  /**
   * 更新配置
   */
  public updateConfig(newConfig: Partial<typeof this.config>): void {
    this.config = { ...this.config, ...newConfig };
    
    // 重新初始化回测引擎以应用新配置
    this.backtestEngine = new BacktestEngine({
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
      initialCapital: this.config.initialCapital,
      maxPositionSize: this.config.maxPositionSize,
      tradingFee: this.config.tradingFee,
      slippage: this.config.slippage,
      maxHoldingTime: this.config.maxHoldingTime,
      riskManagement: {
        maxDailyLoss: 0.05,
        maxDrawdown: 0.2,
        positionSizing: 'RISK_PARITY'
      }
    });
    
    console.log('[ETHAgentDemo] ⚙️ 配置已更新，回测引擎已重新初始化');
    this.emit('configUpdated', this.config);
  }
}

// 导出Agent实例
export const ethAgentDemo = new ETHAgentDemo();