import { OKXDataService, KlineData, MarketData } from '../services/okx-data-service';
import { TechnicalIndicatorAnalyzer, TechnicalIndicatorResult } from '../indicators/technical-indicators';
import { SmartSignalAnalyzer } from '../analyzers/smart-signal-analyzer';
import { DatabaseService, TradeRecord, OrderRecord, SignalRecord } from '../services/database-service';
import { config } from '../config/config';

/**
 * 高频波段交易信号
 */
export interface HFSwingSignal {
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
    ema5: number;
    ema10: number;
    macd: { macd: number; signal: number; histogram: number };
    volume: number;
  };
}

/**
 * Maker订单状态
 */
export interface MakerOrder {
  id: string;
  signal: HFSwingSignal;
  orderPrice: number;
  status: 'PENDING' | 'FILLED' | 'CANCELLED' | 'TIMEOUT';
  createdAt: number;
  filledAt?: number;
}

/**
 * 高频波段策略配置
 */
export interface HFSwingConfig {
  // 基础配置
  symbol: string;
  leverage: number;
  timeframe: string;
  
  // 交易参数
  // maxDailyTrades: number; // 移除日交易限制
  maxPositionSize: number;
  minProfitTarget: number;
  
  // 风控参数
  stopLoss: number;
  takeProfit: number;
  maxDrawdown: number;
  
  // Maker策略参数
  makerOrderTimeout: number;
  priceOffset: number;
  maxSlippage: number;
  
  // 手续费参数
  makerFeeRate: number; // 例如 0.0002 (0.02%)
  takerFeeRate: number; // 例如 0.0005 (0.05%)
  
  // 信号参数
  minConfidence: number;
  rsiOverbought: number;
  rsiOversold: number;
}

/**
 * 1倍合约高频波段策略
 * 
 * 核心特点:
 * - 1倍杠杆，零爆仓风险
 * - 1分钟K线，快速捕捉趋势
 * - Maker挂单，最低手续费
 * - 高胜率，严格风控
 */
export class HighFrequencySwingStrategy {
  private dataService: OKXDataService;
  private technicalIndicators: TechnicalIndicatorAnalyzer;
  private signalAnalyzer: SmartSignalAnalyzer;
  private databaseService: DatabaseService;
  
  private config: HFSwingConfig;
  private isRunning: boolean = false;
  private currentPosition: any = null;
  private pendingOrders: Map<string, MakerOrder> = new Map();
  
  // 统计数据
  private stats = {
    totalTrades: 0,
    successfulTrades: 0,
    totalProfit: 0,
    maxDrawdown: 0,
    dailyTrades: 0,
    lastResetDate: new Date().toDateString(),
    totalFees: 0
  };

  constructor(dataService: OKXDataService) {
    this.dataService = dataService;
    this.technicalIndicators = new TechnicalIndicatorAnalyzer();
    this.signalAnalyzer = new SmartSignalAnalyzer(dataService);
    this.databaseService = new DatabaseService();
    
    // 高频策略配置
    this.config = {
      symbol: 'ETH-USDT-SWAP',
      leverage: 1,
      timeframe: '1m',
      // maxDailyTrades: 40, // 移除日交易限制
      maxPositionSize: 0.20,
      minProfitTarget: 0.001,
      stopLoss: 0.008,
      takeProfit: 0.015,
      maxDrawdown: 0.02,
      makerOrderTimeout: 60000,
      priceOffset: 0.0001,
      maxSlippage: 0.0005,
      // 新增：手续费费率
      makerFeeRate: 0.0002,
      takerFeeRate: 0.0005,
      minConfidence: 0.70,
      rsiOverbought: 75,
      rsiOversold: 25
    };
  }

  /**
   * 启动高频策略
   */
  async start(): Promise<void> {
    console.log('🚀 启动1倍合约高频波段策略...');
    
    this.isRunning = true;
    
    // 重置每日统计
    this.resetDailyStats();
    
    // 开始监控循环
    this.startMonitoringLoop();
    
    console.log('✅ 高频策略已启动');
    console.log(`📊 配置: ${this.config.symbol}, ${this.config.leverage}x杠杆, ${this.config.timeframe}周期`);
    console.log(`🎯 目标: 无限制交易, 胜率>65%`);
  }

  /**
   * 停止策略
   */
  async stop(): Promise<void> {
    console.log('⏹️ 停止高频策略...');
    this.isRunning = false;
    
    // 取消所有挂单
    await this.cancelAllPendingOrders();
    
    // 平仓所有持仓
    if (this.currentPosition) {
      await this.closePosition('STRATEGY_STOP');
    }
    
    console.log('✅ 高频策略已停止');
    this.printStats();
  }

  /**
   * 主监控循环
   */
  private async startMonitoringLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // 检查每日交易限制
        // if (this.stats.dailyTrades >= this.config.maxDailyTrades) {
        //   console.log(`⏰ 今日交易次数已达上限 (${this.config.maxDailyTrades})`);
        //   await this.sleep(60000); // 等待1分钟
        //   return;
        // }

        // 获取1分钟K线数据
        const klines = await this.dataService.getKlineData(
          this.config.symbol,
          this.config.timeframe,
          100
        );

        if (klines.length < 50) {
          console.log('⚠️ K线数据不足，等待更多数据...');
          await this.sleep(30000);
          continue;
        }

        // 更新技术指标
        this.technicalIndicators.updateKlineData(klines);
        
        // 检测交易信号
        const signal = await this.detectHFSignal(klines);
        
        if (signal && !this.currentPosition) {
          console.log(`📈 检测到${signal.direction}信号: ${signal.reason}`);
          console.log(`🎯 置信度: ${(signal.confidence * 100).toFixed(1)}%`);
          
          // 执行Maker交易
          await this.executeMakerTrade(signal);
        }

        // 管理现有持仓
        if (this.currentPosition) {
          await this.managePosition();
        }

        // 管理挂单
        await this.managePendingOrders();

        // 等待下一个周期 (1分钟)
        await this.sleep(60000);

      } catch (error) {
        console.error('❌ 监控循环错误:', error);
        await this.sleep(30000);
      }
    }
  }

  /**
   * 检测高频交易信号
   */
  private async detectHFSignal(klines: KlineData[]): Promise<HFSwingSignal | null> {
    const indicators = this.technicalIndicators.calculateAllIndicators();
    if (!indicators) return null;

    const currentPrice = klines[klines.length - 1].close;
    const currentVolume = klines[klines.length - 1].volume;
    const avgVolume = klines.slice(-20).reduce((sum, k) => sum + k.volume, 0) / 20;

    let signal: HFSwingSignal | null = null;

    // RSI反转信号
    if (indicators.rsi <= this.config.rsiOversold && this.isRSIReversal(klines)) {
      signal = {
        id: `HF_${Date.now()}`,
        timestamp: Date.now(),
        direction: 'LONG',
        confidence: this.calculateConfidence(indicators, 'LONG'),
        entryPrice: currentPrice,
        targetPrice: currentPrice * (1 + this.config.takeProfit),
        stopLoss: currentPrice * (1 - this.config.stopLoss),
        reason: `RSI超卖反弹 (${indicators.rsi.toFixed(1)})`,
        indicators: {
          rsi: indicators.rsi,
          ema5: indicators.ema12, // 使用现有的EMA12作为短期EMA
          ema10: indicators.ema26, // 使用现有的EMA26作为长期EMA
          macd: indicators.macd,
          volume: currentVolume
        }
      };
    } else if (indicators.rsi >= this.config.rsiOverbought && this.isRSIReversal(klines)) {
      signal = {
        id: `HF_${Date.now()}`,
        timestamp: Date.now(),
        direction: 'SHORT',
        confidence: this.calculateConfidence(indicators, 'SHORT'),
        entryPrice: currentPrice,
        targetPrice: currentPrice * (1 - this.config.takeProfit),
        stopLoss: currentPrice * (1 + this.config.stopLoss),
        reason: `RSI超买回落 (${indicators.rsi.toFixed(1)})`,
        indicators: {
          rsi: indicators.rsi,
          ema5: indicators.ema12,
          ema10: indicators.ema26,
          macd: indicators.macd,
          volume: currentVolume
        }
      };
    }

    // EMA穿越信号
    if (!signal && indicators.ema12 > indicators.ema26 && currentVolume > avgVolume * 1.5) {
      const prevIndicators = this.getPreviousIndicators(klines.slice(0, -1));
      if (prevIndicators && prevIndicators.ema12 <= prevIndicators.ema26) {
        signal = {
          id: `HF_${Date.now()}`,
          timestamp: Date.now(),
          direction: 'LONG',
          confidence: this.calculateConfidence(indicators, 'LONG'),
          entryPrice: currentPrice,
          targetPrice: currentPrice * (1 + this.config.takeProfit),
          stopLoss: currentPrice * (1 - this.config.stopLoss),
          reason: 'EMA金叉 + 成交量放大',
          indicators: {
            rsi: indicators.rsi,
            ema5: indicators.ema12,
            ema10: indicators.ema26,
            macd: indicators.macd,
            volume: currentVolume
          }
        };
      }
    }

    // 检查信号质量
    if (signal && signal.confidence >= this.config.minConfidence) {
      // 如果信号有效且置信度足够，保存到数据库
    if (signal && signal.confidence >= this.config.minConfidence) {
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
        console.log(`📊 信号已保存到数据库: ${signal.id}`);
      } catch (error) {
        console.error('保存信号到数据库失败:', error);
      }
    }

    return signal;
    }

    return null;
  }

  /**
   * 执行Maker交易
   */
  private async executeMakerTrade(signal: HFSwingSignal): Promise<void> {
    try {
      // 计算Maker挂单价格
      const offset = signal.direction === 'LONG' ? -this.config.priceOffset : this.config.priceOffset;
      const orderPrice = signal.entryPrice * (1 + offset);

      console.log(`📋 准备Maker挂单: ${signal.direction} @ ${orderPrice.toFixed(2)}`);

      // 创建挂单记录
      const makerOrder: MakerOrder = {
        id: signal.id,
        signal,
        orderPrice,
        status: 'PENDING',
        createdAt: Date.now()
      };

      // 这里应该调用实际的OKX API下单
      // const order = await this.placeOKXOrder(signal.direction, orderPrice, this.calculatePositionSize());
      
      // 模拟下单成功
      this.pendingOrders.set(signal.id, makerOrder);
      
      // 保存订单到数据库
      try {
        const orderRecord: OrderRecord = {
          id: signal.id,
          timestamp: Date.now(),
          symbol: this.config.symbol,
          direction: signal.direction,
          orderType: 'MAKER',
          price: orderPrice,
          quantity: this.calculatePositionSize(),
          status: 'PENDING',
          fee: 0,
          createdAt: Date.now()
        };
        
        await this.databaseService.saveOrder(orderRecord);
        console.log(`📊 订单已保存到数据库: ${signal.id}`);
      } catch (error) {
        console.error('保存订单到数据库失败:', error);
      }
      
      console.log(`✅ Maker订单已提交: ${signal.id}`);
      
      // 设置超时处理
      setTimeout(() => {
        this.handleOrderTimeout(signal.id);
      }, this.config.makerOrderTimeout);

    } catch (error) {
      console.error('❌ Maker交易执行失败:', error);
    }
  }

  /**
   * 管理挂单
   */
  private async managePendingOrders(): Promise<void> {
    for (const [orderId, order] of this.pendingOrders) {
      // 检查订单状态 (这里应该调用OKX API查询)
      // const orderStatus = await this.checkOKXOrderStatus(orderId);
      
      // 模拟订单成交 (80%概率在60秒内成交)
      const elapsed = Date.now() - order.createdAt;
      if (elapsed > 30000 && Math.random() < 0.8) {
        await this.handleOrderFilled(orderId);
      }
    }
  }

  /**
   * 处理订单成交
   */
  private async handleOrderFilled(orderId: string): Promise<void> {
    const order = this.pendingOrders.get(orderId);
    if (!order) return;

    console.log(`✅ 订单成交: ${orderId} @ ${order.orderPrice.toFixed(2)}`);

    // 更新订单状态
    order.status = 'FILLED';
    order.filledAt = Date.now();

    // 创建持仓（含开仓手续费）
    this.currentPosition = {
      id: orderId,
      signal: order.signal,
      entryPrice: order.orderPrice,
      entryTime: Date.now(),
      direction: order.signal.direction,
      size: this.calculatePositionSize(),
      entryFee: order.orderPrice * this.calculatePositionSize() * this.config.makerFeeRate
    };

    // 移除挂单
    this.pendingOrders.delete(orderId);

    // 更新统计
    this.stats.dailyTrades++;
    this.stats.totalTrades++;
    this.stats.totalFees += this.currentPosition.entryFee || 0;

    console.log(`📊 持仓创建: ${this.currentPosition.direction} ${this.currentPosition.size} ETH (开仓手续费: ${(this.currentPosition.entryFee || 0).toFixed(4)} USDT)`);
  }

  /**
   * 处理订单超时
   */
  private async handleOrderTimeout(orderId: string): Promise<void> {
    const order = this.pendingOrders.get(orderId);
    if (!order || order.status !== 'PENDING') return;

    console.log(`⏰ 订单超时: ${orderId}`);

    // 取消订单
    order.status = 'TIMEOUT';
    this.pendingOrders.delete(orderId);

    // 如果信号仍然有效，考虑市价单
    if (this.isSignalStillValid(order.signal)) {
      console.log('🔄 信号仍有效，考虑市价单执行...');
      // 这里可以实现市价单逻辑
    }
  }

  /**
   * 管理持仓
   */
  private async managePosition(): Promise<void> {
    if (!this.currentPosition) return;

    const currentPrice = await this.getCurrentPrice();
    const position = this.currentPosition;
    const pnl = this.calculatePnL(position, currentPrice);
    const pnlPercent = pnl / position.entryPrice;

    // 检查止盈
    if (
      (position.direction === 'LONG' && currentPrice >= position.signal.targetPrice) ||
      (position.direction === 'SHORT' && currentPrice <= position.signal.targetPrice)
    ) {
      await this.closePosition('TAKE_PROFIT');
      return;
    }

    // 检查止损
    if (
      (position.direction === 'LONG' && currentPrice <= position.signal.stopLoss) ||
      (position.direction === 'SHORT' && currentPrice >= position.signal.stopLoss)
    ) {
      await this.closePosition('STOP_LOSS');
      return;
    }

    // 时间止损 (持仓超过30分钟)
    const holdTime = Date.now() - position.entryTime;
    if (holdTime > 30 * 60 * 1000) {
      console.log('⏰ 持仓时间过长，执行时间止损');
      await this.closePosition('TIME_STOP');
      return;
    }

    // 打印持仓状态
    if (Date.now() % 60000 < 1000) { // 每分钟打印一次
      console.log(`📊 持仓状态: ${position.direction} PnL: ${(pnlPercent * 100).toFixed(2)}%`);
    }
  }

  /**
   * 平仓
   */
  private async closePosition(reason: string): Promise<void> {
    if (!this.currentPosition) return;

    const currentPrice = await this.getCurrentPrice();
    const position = this.currentPosition;
    const pnl = this.calculatePnL(position, currentPrice);
    const pnlPercent = pnl / position.entryPrice;

    // 计算平仓手续费（保守按Taker费率）
    const exitFee = currentPrice * position.size * this.config.takerFeeRate;
    const entryFee = position.entryFee || 0;
    const netProfit = pnl - entryFee - exitFee;

    console.log(`📤 平仓: ${reason}`);
    console.log(`💰 毛收益: ${(pnl).toFixed(2)} USDT | 毛收益率: ${(pnlPercent * 100).toFixed(2)}%`);
    console.log(`💸 手续费: 开仓 ${entryFee.toFixed(4)} + 平仓 ${exitFee.toFixed(4)} = 总计 ${(entryFee + exitFee).toFixed(4)} USDT`);
    console.log(`✅ 净收益: ${(netProfit).toFixed(2)} USDT`);

    // 这里应该调用OKX API平仓
    // await this.closeOKXPosition(position);

    // 更新统计（以净收益为准）
    if (netProfit > 0) {
      this.stats.successfulTrades++;
    }
    this.stats.totalProfit += netProfit;
    this.stats.totalFees += (entryFee + exitFee);

    // 清除持仓
    this.currentPosition = null;

    console.log(`📊 当日统计: ${this.stats.successfulTrades}/${this.stats.dailyTrades} 胜率: ${((this.stats.successfulTrades / this.stats.dailyTrades) * 100).toFixed(1)}%`);
  }

  /**
   * 辅助方法
   */
  private isRSIReversal(klines: KlineData[]): boolean {
    if (klines.length < 3) return false;
    
    const recent = klines.slice(-3);
    const indicators = recent.map(k => {
      const tempIndicators = new TechnicalIndicatorAnalyzer([k]);
      return tempIndicators.calculateAllIndicators();
    });

    // 检查RSI是否开始反转
    return indicators.every(ind => ind !== null) &&
           indicators[2]!.rsi > indicators[1]!.rsi &&
           indicators[1]!.rsi > indicators[0]!.rsi;
  }

  private calculateConfidence(indicators: any, direction: 'LONG' | 'SHORT'): number {
    let confidence = 0.5;

    // RSI确认
    if (direction === 'LONG' && indicators.rsi < 30) confidence += 0.2;
    if (direction === 'SHORT' && indicators.rsi > 70) confidence += 0.2;

    // MACD确认
    if (direction === 'LONG' && indicators.macd.histogram > 0) confidence += 0.1;
    if (direction === 'SHORT' && indicators.macd.histogram < 0) confidence += 0.1;

    // EMA确认
    if (direction === 'LONG' && indicators.ema12 > indicators.ema26) confidence += 0.1;
    if (direction === 'SHORT' && indicators.ema12 < indicators.ema26) confidence += 0.1;

    return Math.min(confidence, 0.95);
  }

  private getPreviousIndicators(klines: KlineData[]): TechnicalIndicatorResult | null {
    if (klines.length < 50) return null;
    const tempIndicators = new TechnicalIndicatorAnalyzer(klines);
    return tempIndicators.calculateAllIndicators();
  }

  private calculatePositionSize(): number {
    // 固定仓位大小 (可以根据资金管理策略调整)
    return 0.1; // 0.1 ETH
  }

  private async getCurrentPrice(): Promise<number> {
    const ticker = await this.dataService.getTicker(this.config.symbol);
    return ticker ? ticker.price : 0;
  }

  private calculatePnL(position: any, currentPrice: number): number {
    const direction = position.direction === 'LONG' ? 1 : -1;
    return (currentPrice - position.entryPrice) * direction * position.size;
  }

  private isSignalStillValid(signal: HFSwingSignal): boolean {
    const elapsed = Date.now() - signal.timestamp;
    return elapsed < 5 * 60 * 1000; // 5分钟内有效
  }

  private async cancelAllPendingOrders(): Promise<void> {
    for (const [orderId, order] of this.pendingOrders) {
      console.log(`❌ 取消挂单: ${orderId}`);
      order.status = 'CANCELLED';
    }
    this.pendingOrders.clear();
  }

  private resetDailyStats(): void {
    const today = new Date().toDateString();
    if (this.stats.lastResetDate !== today) {
      this.stats.dailyTrades = 0;
      this.stats.lastResetDate = today;
      console.log('🔄 每日统计已重置');
    }
  }

  private printStats(): void {
    const winRate = this.stats.totalTrades > 0 ? (this.stats.successfulTrades / this.stats.totalTrades) * 100 : 0;
    console.log('\n📊 策略统计:');
    console.log(`总交易次数: ${this.stats.totalTrades}`);
    console.log(`成功交易: ${this.stats.successfulTrades}`);
    console.log(`胜率: ${winRate.toFixed(1)}%`);
    console.log(`总盈亏: ${this.stats.totalProfit.toFixed(2)} USDT`);
    console.log(`今日交易: ${this.stats.dailyTrades}`);
  }

  // 新增：对外暴露统计与状态，供网页端调用
  public getStats(): {
    totalTrades: number;
    successfulTrades: number;
    totalProfit: number;
    maxDrawdown: number;
    dailyTrades: number;
    winRate: number;
    totalFees: number;
  } {
    const winRate = this.stats.totalTrades > 0 ? (this.stats.successfulTrades / this.stats.totalTrades) * 100 : 0;
    return {
      totalTrades: this.stats.totalTrades,
      successfulTrades: this.stats.successfulTrades,
      totalProfit: this.stats.totalProfit,
      maxDrawdown: this.stats.maxDrawdown,
      dailyTrades: this.stats.dailyTrades,
      winRate,
      totalFees: this.stats.totalFees,
    };
  }

  public getCurrentPosition(): any {
    return this.currentPosition;
  }

  public getPendingOrders(): MakerOrder[] {
    return Array.from(this.pendingOrders.values());
  }

  public getLastSignalResult() {
    return this.signalAnalyzer.getLastAnalysis();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取策略状态（供外部调用/网页端）
   */
  public getStatus() {
    return {
      isRunning: this.isRunning,
      currentPosition: this.currentPosition,
      pendingOrders: Array.from(this.pendingOrders.values()),
      stats: this.stats,
      config: this.config,
      lastSignal: this.signalAnalyzer.getLastAnalysis?.() ?? null,
    };
  }
}