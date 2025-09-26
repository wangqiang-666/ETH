import { OKXDataService, KlineData, MarketData } from '../services/okx-data-service';
import { TechnicalIndicatorAnalyzer, TechnicalIndicatorResult } from '../indicators/technical-indicators';
import { SmartSignalAnalyzer } from '../analyzers/smart-signal-analyzer';
import { DatabaseService, TradeRecord, OrderRecord, SignalRecord } from '../services/database-service';
import { config } from '../config/config';

// 导出接口以解决类型问题
export interface FreqtradeStats {
  totalTrades: number;
  successfulTrades: number;
  totalProfit: number;
  maxDrawdown: number;
  dailyTrades: number;
  lastResetDate: string;
  totalFees: number;
  roiExits: number;
  stopLossExits: number;
  signalExits: number;
  winRate: number;
}

/**
 * Freqtrade启发的15分钟交易策略
 * 基于Freqtrade Strategy005和我们的15分钟优化分析
 */
export interface FreqtradeInspiredSignal {
  id: string;
  timestamp: number;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  reason: string;
  indicators: {
    rsi: number;
    ema12: number;
    ema26: number;
    macd: { macd: number; signal: number; histogram: number };
    volume: number;
    volumeRatio: number;
    atr: number;
    stochRsi: number;
    adx: number;
  };
}

/**
 * Freqtrade启发的策略配置
 */
export interface FreqtradeInspiredConfig {
  symbol: string;
  leverage: number;
  timeframe: string;
  
  // 仓位管理
  maxPositionSize: number;
  
  // 风险控制 - 基于Freqtrade最佳实践
  stopLoss: number;
  takeProfit: number;
  maxDrawdown: number;
  
  // 订单管理
  makerOrderTimeout: number;
  priceOffset: number;
  
  // 手续费
  makerFeeRate: number;
  takerFeeRate: number;
  
  // Freqtrade启发的信号参数
  rsi_buy: number;
  rsi_sell: number;
  volume_factor: number;
  stoch_rsi_buy: number;
  adx_min: number;
  
  // ROI设置 - 模仿Freqtrade的分层ROI
  roi_levels: Array<{
    time_minutes: number;
    profit_percent: number;
  }>;
}

/**
 * Freqtrade启发的15分钟交易策略
 * 
 * 特点:
 * - 基于Freqtrade Strategy005的多指标组合
 * - 15分钟时间框架优化
 * - 分层ROI管理
 * - 动态止损
 * - 成交量确认
 */
export class FreqtradeInspiredStrategy {
  private dataService: OKXDataService;
  private technicalIndicators: TechnicalIndicatorAnalyzer;
  private signalAnalyzer: SmartSignalAnalyzer;
  private databaseService: DatabaseService;
  
  private config: FreqtradeInspiredConfig;
  private isRunning: boolean = false;
  private currentPosition: any = null;
  private pendingOrders: Map<string, any> = new Map();
  
  // 统计数据
  private stats = {
    totalTrades: 0,
    successfulTrades: 0,
    totalProfit: 0,
    maxDrawdown: 0,
    dailyTrades: 0,
    lastResetDate: new Date().toDateString(),
    totalFees: 0,
    roiExits: 0,
    stopLossExits: 0,
    signalExits: 0
  };

  constructor(dataService: OKXDataService) {
    this.dataService = dataService;
    this.technicalIndicators = new TechnicalIndicatorAnalyzer();
    this.signalAnalyzer = new SmartSignalAnalyzer(dataService);
    this.databaseService = new DatabaseService();
    
    // Freqtrade启发的配置
    this.config = {
      symbol: 'ETH-USDT-SWAP',
      leverage: 1,
      timeframe: '15m',
      maxPositionSize: 0.20,
      
      // 基于Freqtrade Strategy005的风险参数
      stopLoss: 0.010,  // 1.0% 止损
      takeProfit: 0.025, // 2.5% 主要止盈
      maxDrawdown: 0.02,
      
      makerOrderTimeout: 60000, // 1分钟
      priceOffset: 0.0001,
      
      makerFeeRate: 0.0002,
      takerFeeRate: 0.0005,
      
      // Freqtrade Strategy005启发的参数
      rsi_buy: 26,        // RSI买入阈值
      rsi_sell: 74,       // RSI卖出阈值
      volume_factor: 1.5, // 成交量倍数
      stoch_rsi_buy: 30,  // 随机RSI买入
      adx_min: 25,        // 最小ADX趋势强度
      
      // 分层ROI - 模仿Freqtrade的ROI管理
      roi_levels: [
        { time_minutes: 0, profit_percent: 5.0 },    // 立即5%
        { time_minutes: 20, profit_percent: 4.0 },   // 20分钟后4%
        { time_minutes: 40, profit_percent: 3.0 },   // 40分钟后3%
        { time_minutes: 80, profit_percent: 2.0 },   // 80分钟后2%
        { time_minutes: 1440, profit_percent: 1.0 }  // 24小时后1%
      ]
    };

    console.log('🎯 Freqtrade启发策略已初始化');
    console.log(`📊 参数: RSI(${this.config.rsi_buy}/${this.config.rsi_sell}), 成交量倍数${this.config.volume_factor}x`);
  }

  /**
   * 启动策略
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Freqtrade启发策略已在运行中');
      return;
    }

    this.isRunning = true;
    console.log('🚀 启动Freqtrade启发的15分钟交易策略...');
    console.log(`📊 配置: ${this.config.symbol}, ${this.config.leverage}x杠杆, ${this.config.timeframe}周期`);
    console.log(`🎯 目标: 基于Freqtrade最佳实践的稳定盈利`);

    this.resetDailyStats();
    this.startMonitoringLoop();
  }

  /**
   * 停止策略
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;
    console.log('🛑 停止Freqtrade启发策略...');

    await this.cancelAllPendingOrders();
    if (this.currentPosition) {
      await this.closePosition('策略停止');
    }

    console.log('✅ Freqtrade启发策略已停止');
  }

  /**
   * 启动监控循环
   */
  private async startMonitoringLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const klines = await this.dataService.getKlineData(this.config.symbol, this.config.timeframe, 100);
        
        if (klines && klines.length >= 50) {
          this.technicalIndicators.updateKlineData(klines);
          
          await this.managePendingOrders();
          
          if (this.currentPosition) {
            await this.managePosition();
          }
          
          if (!this.currentPosition && this.pendingOrders.size === 0) {
            const signal = await this.detectFreqtradeSignal(klines);
            if (signal) {
              await this.executeMakerTrade(signal);
            }
          }
        }

        if (Date.now() % (60 * 60 * 1000) < 60000) {
          this.printFreqtradeStats();
        }

        await this.sleep(15000); // 15秒检查一次，适合15分钟策略
        
      } catch (error) {
        console.error('❌ Freqtrade策略监控循环错误:', error);
        await this.sleep(30000);
      }
    }
  }

  /**
   * 检测Freqtrade启发的交易信号
   */
  private async detectFreqtradeSignal(klines: KlineData[]): Promise<FreqtradeInspiredSignal | null> {
    const indicators = this.technicalIndicators.calculateAllIndicators();
    if (!indicators) return null;

    const currentPrice = klines[klines.length - 1].close;
    const currentVolume = klines[klines.length - 1].volume;
    
    // 计算额外指标
    const volumeRatio = this.calculateVolumeRatio(klines);
    const atr = this.calculateATR(klines);
    const stochRsi = this.calculateStochRSI(klines);
    const adx = this.calculateADX(klines);

    let signal: FreqtradeInspiredSignal | null = null;

    // Freqtrade Strategy005启发的买入条件
    const buyConditions = [
      indicators.rsi <= this.config.rsi_buy,           // RSI超卖
      volumeRatio >= this.config.volume_factor,        // 成交量放大
      stochRsi <= this.config.stoch_rsi_buy,          // 随机RSI超卖
      adx >= this.config.adx_min,                     // 趋势强度足够
      this.checkFisherRSI(klines) < 0.5,              // Fisher RSI确认
      indicators.ema12 > indicators.ema26             // EMA趋势向上
    ];

    if (buyConditions.every(condition => condition)) {
      signal = {
        id: `FT_${Date.now()}`,
        timestamp: Date.now(),
        direction: 'LONG',
        confidence: this.calculateFreqtradeConfidence(indicators, 'LONG', volumeRatio, adx),
        entryPrice: currentPrice,
        targetPrice: currentPrice * (1 + this.config.takeProfit),
        stopLoss: currentPrice * (1 - this.config.stopLoss),
        reason: `Freqtrade多指标买入信号 (RSI:${indicators.rsi.toFixed(1)}, Vol:${volumeRatio.toFixed(1)}x)`,
        indicators: {
          rsi: indicators.rsi,
          ema12: indicators.ema12,
          ema26: indicators.ema26,
          macd: indicators.macd,
          volume: currentVolume,
          volumeRatio: volumeRatio,
          atr: atr,
          stochRsi: stochRsi,
          adx: adx
        }
      };
    }

    // Freqtrade启发的卖出条件
    const sellConditions = [
      indicators.rsi >= this.config.rsi_sell,          // RSI超买
      this.checkMinusDI(klines) >= 50,                 // -DI确认
      this.checkFisherRSI(klines) >= 0.5,              // Fisher RSI确认
      indicators.ema12 < indicators.ema26              // EMA趋势向下
    ];

    if (sellConditions.every(condition => condition)) {
      signal = {
        id: `FT_${Date.now()}`,
        timestamp: Date.now(),
        direction: 'SHORT',
        confidence: this.calculateFreqtradeConfidence(indicators, 'SHORT', volumeRatio, adx),
        entryPrice: currentPrice,
        targetPrice: currentPrice * (1 - this.config.takeProfit),
        stopLoss: currentPrice * (1 + this.config.stopLoss),
        reason: `Freqtrade多指标卖出信号 (RSI:${indicators.rsi.toFixed(1)}, Vol:${volumeRatio.toFixed(1)}x)`,
        indicators: {
          rsi: indicators.rsi,
          ema12: indicators.ema12,
          ema26: indicators.ema26,
          macd: indicators.macd,
          volume: currentVolume,
          volumeRatio: volumeRatio,
          atr: atr,
          stochRsi: stochRsi,
          adx: adx
        }
      };
    }

    if (signal && signal.confidence >= 0.70) {
      // 保存信号到数据库
      try {
        const signalRecord: SignalRecord = {
          id: signal.id,
          timestamp: signal.timestamp,
          symbol: this.config.symbol,
          direction: signal.direction,
          confidence: signal.confidence,
          entryPrice: signal.entryPrice,
          targetPrice: signal.targetPrice,
          stopLoss: signal.stopLoss,
          reason: signal.reason,
          indicators: JSON.stringify(signal.indicators),
          executed: false,
          createdAt: Date.now()
        };
        
        await this.databaseService.saveSignal(signalRecord);
        console.log(`📊 Freqtrade信号已保存: ${signal.id} (置信度: ${(signal.confidence*100).toFixed(1)}%)`);
      } catch (error) {
        console.error('保存Freqtrade信号失败:', error);
      }
    }

    return signal;
  }

  /**
   * 计算Freqtrade启发的置信度
   */
  private calculateFreqtradeConfidence(
    indicators: any, 
    direction: 'LONG' | 'SHORT', 
    volumeRatio: number,
    adx: number
  ): number {
    let confidence = 0.70; // 基础置信度

    // RSI强度加分
    if (direction === 'LONG' && indicators.rsi <= 20) confidence += 0.15;
    else if (direction === 'LONG' && indicators.rsi <= 26) confidence += 0.10;
    
    if (direction === 'SHORT' && indicators.rsi >= 80) confidence += 0.15;
    else if (direction === 'SHORT' && indicators.rsi >= 74) confidence += 0.10;

    // 成交量确认加分
    if (volumeRatio >= 2.0) confidence += 0.10;
    else if (volumeRatio >= 1.5) confidence += 0.05;

    // ADX趋势强度加分
    if (adx >= 40) confidence += 0.10;
    else if (adx >= 25) confidence += 0.05;

    // MACD确认加分
    if (direction === 'LONG' && indicators.macd.histogram > 0) confidence += 0.05;
    if (direction === 'SHORT' && indicators.macd.histogram < 0) confidence += 0.05;

    return Math.min(confidence, 0.95);
  }

  /**
   * 管理持仓 - Freqtrade启发的ROI管理
   */
  private async managePosition(): Promise<void> {
    if (!this.currentPosition) return;

    const currentPrice = await this.getCurrentPrice();
    if (!currentPrice) return;

    const signal = this.currentPosition.signal;
    const holdingTimeMinutes = (Date.now() - this.currentPosition.entryTime) / (60 * 1000);
    const currentProfit = this.calculateCurrentProfit(currentPrice);

    // Freqtrade启发的分层ROI检查
    for (const roi of this.config.roi_levels) {
      if (holdingTimeMinutes >= roi.time_minutes) {
        const roiTarget = roi.profit_percent / 100;
        if (currentProfit >= roiTarget) {
          await this.closePosition(`ROI退出 (${roi.profit_percent}% @ ${holdingTimeMinutes.toFixed(0)}分钟)`);
          this.stats.roiExits++;
          return;
        }
      }
    }

    // 传统止盈止损检查
    if (signal.direction === 'LONG' && currentPrice >= signal.targetPrice) {
      await this.closePosition('止盈');
      return;
    }
    if (signal.direction === 'SHORT' && currentPrice <= signal.targetPrice) {
      await this.closePosition('止盈');
      return;
    }

    if (signal.direction === 'LONG' && currentPrice <= signal.stopLoss) {
      await this.closePosition('止损');
      this.stats.stopLossExits++;
      return;
    }
    if (signal.direction === 'SHORT' && currentPrice >= signal.stopLoss) {
      await this.closePosition('止损');
      this.stats.stopLossExits++;
      return;
    }

    // 最大持仓时间检查 (24小时)
    if (holdingTimeMinutes > 1440) {
      await this.closePosition('超时平仓');
      return;
    }
  }

  /**
   * 计算当前利润百分比
   */
  private calculateCurrentProfit(currentPrice: number): number {
    if (!this.currentPosition) return 0;
    
    const entryPrice = this.currentPosition.entryPrice;
    if (this.currentPosition.signal.direction === 'LONG') {
      return (currentPrice - entryPrice) / entryPrice;
    } else {
      return (entryPrice - currentPrice) / entryPrice;
    }
  }

  // 辅助计算方法
  private calculateVolumeRatio(klines: KlineData[]): number {
    if (klines.length < 20) return 1.0;
    
    const volumes = klines.slice(-20).map(k => k.volume);
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    const currentVolume = klines[klines.length - 1].volume;
    
    return avgVolume > 0 ? currentVolume / avgVolume : 1.0;
  }

  private calculateATR(klines: KlineData[], period: number = 14): number {
    if (klines.length < period + 1) return 0;
    
    const trueRanges: number[] = [];
    for (let i = 1; i < klines.length; i++) {
      const high = klines[i].high;
      const low = klines[i].low;
      const prevClose = klines[i-1].close;
      
      const tr1 = high - low;
      const tr2 = Math.abs(high - prevClose);
      const tr3 = Math.abs(low - prevClose);
      
      trueRanges.push(Math.max(tr1, tr2, tr3));
    }
    
    const recentTR = trueRanges.slice(-period);
    return recentTR.reduce((sum, tr) => sum + tr, 0) / recentTR.length;
  }

  private calculateStochRSI(klines: KlineData[]): number {
    // 简化的随机RSI计算
    if (klines.length < 14) return 50;
    
    const closes = klines.slice(-14).map(k => k.close);
    const rsi = this.calculateSimpleRSI(closes);
    
    // 简化处理，实际应该计算RSI的随机指标
    return rsi;
  }

  private calculateADX(klines: KlineData[]): number {
    // 简化的ADX计算
    if (klines.length < 14) return 25;
    
    // 实际应该计算真正的ADX，这里简化处理
    const atr = this.calculateATR(klines);
    const priceRange = klines[klines.length - 1].high - klines[klines.length - 1].low;
    
    return Math.min(Math.max((atr / priceRange) * 100, 0), 100);
  }

  private calculateSimpleRSI(prices: number[]): number {
    if (prices.length < 14) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i-1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    
    const avgGain = gains / (prices.length - 1);
    const avgLoss = losses / (prices.length - 1);
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private checkFisherRSI(klines: KlineData[]): number {
    // 简化的Fisher RSI，实际应该使用更复杂的计算
    const rsi = this.calculateSimpleRSI(klines.slice(-14).map(k => k.close));
    return rsi / 100;
  }

  private checkMinusDI(klines: KlineData[]): number {
    // 简化的-DI计算
    if (klines.length < 14) return 25;
    
    const recent = klines.slice(-14);
    let minusDM = 0;
    
    for (let i = 1; i < recent.length; i++) {
      const lowMove = recent[i-1].low - recent[i].low;
      const highMove = recent[i].high - recent[i-1].high;
      
      if (lowMove > highMove && lowMove > 0) {
        minusDM += lowMove;
      }
    }
    
    const atr = this.calculateATR(klines);
    return atr > 0 ? (minusDM / atr) * 100 : 25;
  }

  // 其他必要方法的简化实现...
  private async executeMakerTrade(signal: FreqtradeInspiredSignal): Promise<void> {
    // 实现Maker交易逻辑
    console.log(`📋 Freqtrade Maker挂单: ${signal.direction} @ ${signal.entryPrice.toFixed(2)}`);
    // 具体实现...
  }

  private async managePendingOrders(): Promise<void> {
    // 管理挂单逻辑
  }

  private async closePosition(reason: string): Promise<void> {
    // 平仓逻辑
    console.log(`🔄 Freqtrade平仓: ${reason}`);
    this.currentPosition = null;
  }

  private async getCurrentPrice(): Promise<number> {
    const ticker = await this.dataService.getTicker(this.config.symbol);
    return ticker ? ticker.price : 0;
  }

  private async cancelAllPendingOrders(): Promise<void> {
    this.pendingOrders.clear();
  }

  private resetDailyStats(): void {
    const today = new Date().toDateString();
    if (this.stats.lastResetDate !== today) {
      this.stats.dailyTrades = 0;
      this.stats.lastResetDate = today;
    }
  }

  private printFreqtradeStats(): void {
    const winRate = this.stats.totalTrades > 0 ? (this.stats.successfulTrades / this.stats.totalTrades) * 100 : 0;
    
    console.log('\n📊 Freqtrade启发策略统计:');
    console.log(`   总交易: ${this.stats.totalTrades}, 成功: ${this.stats.successfulTrades} (${winRate.toFixed(1)}%)`);
    console.log(`   总盈亏: ${this.stats.totalProfit.toFixed(2)} USDT`);
    console.log(`   ROI退出: ${this.stats.roiExits}, 止损退出: ${this.stats.stopLossExits}`);
    console.log(`   今日交易: ${this.stats.dailyTrades}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 公共接口方法
  public getFreqtradeStats(): FreqtradeStats {
    const winRate = this.stats.totalTrades > 0 ? (this.stats.successfulTrades / this.stats.totalTrades) * 100 : 0;
    return { ...this.stats, winRate };
  }

  public getCurrentPosition() {
    return this.currentPosition;
  }

  public getPendingOrders() {
    return Array.from(this.pendingOrders.values());
  }

  public getStatus() {
    return {
      isRunning: this.isRunning,
      timestamp: new Date().toISOString(),
      config: this.config,
      stats: this.getFreqtradeStats()
    };
  }

  public getLastSignalResult() {
    // 返回最后一个信号结果，如果没有则返回null
    return null;
  }
}