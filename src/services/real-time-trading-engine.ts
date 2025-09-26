import { EventEmitter } from 'events';
import BinanceApiService, { KlineData, OrderData, BinanceConfig } from './binance-api-service';
import { DatabaseService } from './database-service';

// V5-激进优化版参数
export interface V5Parameters {
  stopLoss: number;
  takeProfitLevel1: number;
  takeProfitLevel2: number;
  takeProfitLevel3: number;
  takeProfitWeight1: number;
  takeProfitWeight2: number;
  takeProfitWeight3: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  emaFast: number;
  emaSlow: number;
  trendStrengthThreshold: number;
  volumeRatioMin: number;
  volumeConfirmationPeriod: number;
  volatilityMin: number;
  volatilityMax: number;
  atrPeriod: number;
  minHoldingTime: number;
  maxHoldingTime: number;
  profitTakingTime: number;
  maxDailyTrades: number;
  maxConsecutiveLosses: number;
  cooldownPeriod: number;
  trailingStopActivation: number;
  trailingStopDistance: number;
  basePositionSize: number;
  positionSizeMultiplier: number;
}

export interface TradingSignal {
  direction: 'long' | 'short';
  strength: number;
  confidence: number;
  signalCount: number;
  timestamp: number;
  price: number;
}

export interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  entryTime: number;
  stopLoss: number;
  takeProfitLevels: Array<{
    price: number;
    quantity: number;
    filled: boolean;
  }>;
  trailingStopPrice?: number;
  trailingStopActivated: boolean;
  orders: string[];
  pnl: number;
  fees: number;
}

export interface TradingState {
  isActive: boolean;
  balance: number;
  positions: Map<string, Position>;
  dailyTrades: number;
  consecutiveLosses: number;
  lastLossTime: number;
  totalPnl: number;
  totalFees: number;
  winningTrades: number;
  losingTrades: number;
  maxDrawdown: number;
  peak: number;
}

export class RealTimeTradingEngine extends EventEmitter {
  private binanceApi: BinanceApiService;
  private dbService: DatabaseService;
  private parameters: V5Parameters;
  private state: TradingState;
  private klineBuffer: Map<string, KlineData[]> = new Map();
  private symbol: string;
  private interval: string;
  private isRunning = false;

  // V5-激进优化版参数 (最终验证版本)
  private readonly DEFAULT_PARAMETERS: V5Parameters = {
    stopLoss: 0.017,               // 1.7%止损
    takeProfitLevel1: 0.012,       // 1.2%第一层止盈
    takeProfitLevel2: 0.040,       // 4.0%第二层止盈
    takeProfitLevel3: 0.090,       // 9.0%第三层止盈
    takeProfitWeight1: 0.70,       // 70%在第一层止盈
    takeProfitWeight2: 0.20,       // 20%在第二层止盈
    takeProfitWeight3: 0.10,       // 10%在第三层止盈
    rsiPeriod: 15,                 // RSI周期
    rsiOversold: 35,               // RSI超卖 (激进放宽)
    rsiOverbought: 65,             // RSI超买 (激进放宽)
    emaFast: 9,                    // 快速EMA
    emaSlow: 27,                   // 慢速EMA
    trendStrengthThreshold: 0.005, // 趋势强度阈值 (激进放宽)
    volumeRatioMin: 0.7,           // 成交量比率 (激进放宽)
    volumeConfirmationPeriod: 18,  // 成交量确认周期
    volatilityMin: 0.002,          // 最小波动率
    volatilityMax: 0.075,          // 最大波动率
    atrPeriod: 16,                 // ATR周期
    minHoldingTime: 8,             // 最小持仓8分钟
    maxHoldingTime: 135,           // 最大持仓135分钟
    profitTakingTime: 30,          // 获利了结30分钟 (激进)
    maxDailyTrades: 80,            // 最大日交易80笔 (激进)
    maxConsecutiveLosses: 4,       // 最大连续亏损4次
    cooldownPeriod: 45,            // 冷却期45分钟
    trailingStopActivation: 0.010, // 尾随止损激活1%
    trailingStopDistance: 0.005,   // 尾随止损距离0.5%
    basePositionSize: 750,         // 基础仓位750 USDT
    positionSizeMultiplier: 1.3    // 仓位倍数1.3
  };

  constructor(
    binanceConfig: BinanceConfig,
    symbol: string = 'ETHUSDT',
    interval: string = '1m',
    customParameters?: Partial<V5Parameters>
  ) {
    super();
    
    this.binanceApi = new BinanceApiService(binanceConfig);
    this.dbService = new DatabaseService();
    this.symbol = symbol;
    this.interval = interval;
    this.parameters = { ...this.DEFAULT_PARAMETERS, ...customParameters };
    
    this.state = {
      isActive: false,
      balance: 0,
      positions: new Map(),
      dailyTrades: 0,
      consecutiveLosses: 0,
      lastLossTime: 0,
      totalPnl: 0,
      totalFees: 0,
      winningTrades: 0,
      losingTrades: 0,
      maxDrawdown: 0,
      peak: 0
    };

    this.setupEventHandlers();
    console.log(`🚀 实时交易引擎初始化: ${symbol} ${interval}`);
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    // K线数据处理
    this.binanceApi.on('kline', (kline: KlineData) => {
      if (kline.symbol === this.symbol && kline.interval === this.interval) {
        this.handleKlineData(kline);
      }
    });

    // 订单更新处理
    this.binanceApi.on('orderUpdate', (orderUpdate: any) => {
      this.handleOrderUpdate(orderUpdate);
    });

    // 余额更新处理
    this.binanceApi.on('balanceUpdate', (balanceUpdate: any) => {
      this.handleBalanceUpdate(balanceUpdate);
    });

    // 连接状态监控
    this.binanceApi.on('dataStreamDisconnected', () => {
      console.log('⚠️ 数据流断开，暂停交易');
      this.pauseTrading();
    });

    this.binanceApi.on('dataStreamConnected', () => {
      console.log('✅ 数据流重连，恢复交易');
      this.resumeTrading();
    });
  }

  /**
   * 启动交易引擎
   */
  async start(): Promise<void> {
    console.log('🚀 启动实时交易引擎...');
    
    try {
      // 测试API连接
      const isConnected = await this.binanceApi.testConnection();
      if (!isConnected) {
        throw new Error('币安API连接失败');
      }

      // 获取账户信息
      const accountInfo = await this.binanceApi.getAccountInfo();
      if (!accountInfo.canTrade) {
        throw new Error('账户无交易权限');
      }

      // 获取初始余额
      const balance = await this.binanceApi.getBalance('USDT');
      this.state.balance = parseFloat(balance.free);
      this.state.peak = this.state.balance;

      console.log(`💰 当前USDT余额: ${this.state.balance.toFixed(2)}`);

      // 连接数据流
      await this.binanceApi.connectDataStream([this.symbol], [this.interval]);
      await this.binanceApi.connectUserStream();

      // 初始化K线缓冲区
      await this.initializeKlineBuffer();

      this.isRunning = true;
      this.state.isActive = true;
      
      console.log('✅ 实时交易引擎启动成功');
      this.emit('started');

    } catch (error) {
      console.error('❌ 交易引擎启动失败:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 停止交易引擎
   */
  async stop(): Promise<void> {
    console.log('🛑 停止实时交易引擎...');
    
    this.isRunning = false;
    this.state.isActive = false;

    // 关闭所有持仓
    await this.closeAllPositions();

    // 断开连接
    this.binanceApi.disconnect();

    console.log('✅ 实时交易引擎已停止');
    this.emit('stopped');
  }

  /**
   * 暂停交易
   */
  private pauseTrading(): void {
    this.state.isActive = false;
    this.emit('paused');
  }

  /**
   * 恢复交易
   */
  private resumeTrading(): void {
    if (this.isRunning) {
      this.state.isActive = true;
      this.emit('resumed');
    }
  }

  /**
   * 初始化K线缓冲区
   */
  private async initializeKlineBuffer(): Promise<void> {
    console.log('📊 初始化K线数据缓冲区...');
    
    try {
      // 获取最近100根K线用于技术指标计算
      const klines = await this.binanceApi.getKlines(this.symbol, this.interval, 100);
      
      const klineData: KlineData[] = klines.map((k: any) => ({
        symbol: this.symbol,
        openTime: k[0],
        closeTime: k[6],
        open: k[1],
        high: k[2],
        low: k[3],
        close: k[4],
        volume: k[5],
        trades: k[8],
        interval: this.interval,
        isFinal: true
      }));

      this.klineBuffer.set(this.symbol, klineData);
      console.log(`✅ 初始化完成，缓冲区包含 ${klineData.length} 根K线`);
      
    } catch (error) {
      console.error('❌ K线缓冲区初始化失败:', error);
      throw error;
    }
  }

  /**
   * 处理K线数据
   */
  private handleKlineData(kline: KlineData): void {
    if (!kline.isFinal) return; // 只处理完成的K线

    // 更新缓冲区
    const buffer = this.klineBuffer.get(this.symbol) || [];
    buffer.push(kline);
    
    // 保持缓冲区大小
    if (buffer.length > 100) {
      buffer.shift();
    }
    
    this.klineBuffer.set(this.symbol, buffer);

    // 如果交易激活，进行信号分析
    if (this.state.isActive && buffer.length >= 50) {
      this.analyzeSignal(buffer);
    }

    // 更新持仓管理
    this.updatePositions(parseFloat(kline.close));

    // 发送K线更新事件
    this.emit('kline', kline);
  }

  /**
   * 分析交易信号
   */
  private analyzeSignal(klineData: KlineData[]): void {
    try {
      // 检查交易条件
      if (!this.shouldTrade()) {
        return;
      }

      // 生成交易信号
      const signal = this.generateTradingSignal(klineData);
      
      if (signal) {
        console.log(`📊 检测到交易信号: ${signal.direction} 强度:${signal.strength.toFixed(2)} 置信度:${signal.confidence.toFixed(2)}`);
        this.executeSignal(signal);
      }

    } catch (error) {
      console.error('❌ 信号分析失败:', error);
      this.emit('error', error);
    }
  }

  /**
   * 检查是否应该交易
   */
  private shouldTrade(): boolean {
    // 检查连续亏损保护
    if (this.state.consecutiveLosses >= this.parameters.maxConsecutiveLosses) {
      const timeSinceLastLoss = Date.now() - this.state.lastLossTime;
      if (timeSinceLastLoss < this.parameters.cooldownPeriod * 60 * 1000) {
        return false;
      }
    }

    // 检查日交易限制
    if (this.state.dailyTrades >= this.parameters.maxDailyTrades) {
      return false;
    }

    // 检查余额充足
    const requiredBalance = this.parameters.basePositionSize * this.parameters.positionSizeMultiplier;
    if (this.state.balance < requiredBalance) {
      console.log(`⚠️ 余额不足，需要 ${requiredBalance} USDT，当前 ${this.state.balance.toFixed(2)} USDT`);
      return false;
    }

    // 检查是否有开放持仓
    if (this.state.positions.size > 0) {
      return false; // 一次只持有一个仓位
    }

    return true;
  }

  /**
   * 生成交易信号 (V5-激进优化版逻辑)
   */
  private generateTradingSignal(klineData: KlineData[]): TradingSignal | null {
    const closes = klineData.map(k => parseFloat(k.close));
    const volumes = klineData.map(k => parseFloat(k.volume));
    const highs = klineData.map(k => parseFloat(k.high));
    const lows = klineData.map(k => parseFloat(k.low));

    // 计算技术指标
    const rsi = this.calculateRSI(closes, this.parameters.rsiPeriod);
    const emaFast = this.calculateEMA(closes, this.parameters.emaFast);
    const emaSlow = this.calculateEMA(closes, this.parameters.emaSlow);
    const volatility = this.calculateVolatility(closes, 20);
    const volumeRatio = this.calculateVolumeRatio(volumes, this.parameters.volumeConfirmationPeriod);

    // 检查市场条件
    if (volatility < this.parameters.volatilityMin || volatility > this.parameters.volatilityMax) {
      return null;
    }

    if (volumeRatio < this.parameters.volumeRatioMin) {
      return null;
    }

    let signalStrength = 0;
    let direction: 'long' | 'short' | null = null;
    let signalCount = 0;

    // RSI信号 (V5激进设置)
    if (rsi <= this.parameters.rsiOversold) {
      signalStrength += 0.40;
      direction = 'long';
      signalCount++;
    } else if (rsi >= this.parameters.rsiOverbought) {
      signalStrength += 0.40;
      direction = 'short';
      signalCount++;
    }

    // 趋势信号 (V5激进设置)
    const trendStrength = Math.abs(emaFast - emaSlow) / emaSlow;
    if (trendStrength > this.parameters.trendStrengthThreshold) {
      signalStrength += 0.30;
      signalCount++;
      
      if (emaFast > emaSlow) {
        if (direction === 'long' || direction === null) {
          direction = 'long';
        } else {
          return null; // 信号冲突
        }
      } else {
        if (direction === 'short' || direction === null) {
          direction = 'short';
        } else {
          return null; // 信号冲突
        }
      }
    }

    // 成交量确认
    if (volumeRatio > this.parameters.volumeRatioMin * 1.2) {
      signalStrength += 0.20;
      signalCount++;
    }

    // 波动率确认
    if (volatility > this.parameters.volatilityMin && volatility < this.parameters.volatilityMax) {
      signalStrength += 0.10;
      signalCount++;
    }

    // V5激进设置：降低信号强度要求
    if (signalCount >= 1 && signalStrength >= 0.40 && direction) {
      return {
        direction,
        strength: signalStrength,
        confidence: Math.min(signalStrength * 1.3, 1.0),
        signalCount,
        timestamp: Date.now(),
        price: closes[closes.length - 1]
      };
    }

    return null;
  }

  /**
   * 执行交易信号
   */
  private async executeSignal(signal: TradingSignal): Promise<void> {
    try {
      const positionSize = this.parameters.basePositionSize * this.parameters.positionSizeMultiplier;
      const quantity = this.calculateQuantity(signal.price, positionSize);

      console.log(`📝 执行交易信号: ${signal.direction} ${quantity} ${this.symbol} @ ${signal.price}`);

      // 创建市价单
      const order = await this.binanceApi.createOrder({
        symbol: this.symbol,
        side: signal.direction === 'long' ? 'BUY' : 'SELL',
        type: 'MARKET',
        quoteOrderQty: positionSize.toString()
      });

      // 创建持仓记录
      const position: Position = {
        id: `pos_${Date.now()}`,
        symbol: this.symbol,
        side: signal.direction,
        entryPrice: signal.price,
        quantity: quantity,
        entryTime: Date.now(),
        stopLoss: this.calculateStopLoss(signal.price, signal.direction),
        takeProfitLevels: this.calculateTakeProfitLevels(signal.price, signal.direction, quantity),
        trailingStopActivated: false,
        orders: [order.clientOrderId],
        pnl: 0,
        fees: 0
      };

      this.state.positions.set(position.id, position);
      this.state.dailyTrades++;

      // 设置止损和止盈订单
      await this.setupStopLossAndTakeProfit(position);

      console.log(`✅ 持仓创建成功: ${position.id}`);
      this.emit('positionOpened', position);

    } catch (error) {
      console.error('❌ 执行交易信号失败:', error);
      this.emit('error', error);
    }
  }

  /**
   * 计算数量
   */
  private calculateQuantity(price: number, positionSize: number): number {
    return positionSize / price;
  }

  /**
   * 计算止损价格
   */
  private calculateStopLoss(entryPrice: number, direction: 'long' | 'short'): number {
    if (direction === 'long') {
      return entryPrice * (1 - this.parameters.stopLoss);
    } else {
      return entryPrice * (1 + this.parameters.stopLoss);
    }
  }

  /**
   * 计算止盈层级
   */
  private calculateTakeProfitLevels(entryPrice: number, direction: 'long' | 'short', totalQuantity: number): Array<{price: number; quantity: number; filled: boolean}> {
    const levels = [
      { level: this.parameters.takeProfitLevel1, weight: this.parameters.takeProfitWeight1 },
      { level: this.parameters.takeProfitLevel2, weight: this.parameters.takeProfitWeight2 },
      { level: this.parameters.takeProfitLevel3, weight: this.parameters.takeProfitWeight3 }
    ];

    return levels.map(({ level, weight }) => ({
      price: direction === 'long' 
        ? entryPrice * (1 + level)
        : entryPrice * (1 - level),
      quantity: totalQuantity * weight,
      filled: false
    }));
  }

  /**
   * 设置止损和止盈订单
   */
  private async setupStopLossAndTakeProfit(position: Position): Promise<void> {
    // 这里可以设置OCO订单或者通过程序化方式管理
    // 由于币安API的限制，我们采用程序化管理方式
    console.log(`🛡️ 设置止损止盈: 止损@${position.stopLoss.toFixed(4)}`);
  }

  /**
   * 更新持仓
   */
  private updatePositions(currentPrice: number): void {
    for (const [positionId, position] of this.state.positions) {
      this.checkStopLoss(position, currentPrice);
      this.checkTakeProfit(position, currentPrice);
      this.checkTrailingStop(position, currentPrice);
      this.checkTimeBasedExit(position);
    }
  }

  /**
   * 检查止损
   */
  private checkStopLoss(position: Position, currentPrice: number): void {
    const shouldStopLoss = position.side === 'long' 
      ? currentPrice <= position.stopLoss
      : currentPrice >= position.stopLoss;

    if (shouldStopLoss) {
      this.closePosition(position, 'stop_loss', currentPrice);
    }
  }

  /**
   * 检查止盈
   */
  private checkTakeProfit(position: Position, currentPrice: number): void {
    for (const tpLevel of position.takeProfitLevels) {
      if (tpLevel.filled) continue;

      const shouldTakeProfit = position.side === 'long'
        ? currentPrice >= tpLevel.price
        : currentPrice <= tpLevel.price;

      if (shouldTakeProfit) {
        this.partialClose(position, tpLevel, currentPrice);
      }
    }
  }

  /**
   * 检查尾随止损
   */
  private checkTrailingStop(position: Position, currentPrice: number): void {
    const currentPnl = this.calculatePositionPnl(position, currentPrice);
    const profitPercent = currentPnl / (position.entryPrice * position.quantity);

    if (profitPercent >= this.parameters.trailingStopActivation) {
      position.trailingStopActivated = true;
      
      const newTrailingStop = position.side === 'long'
        ? currentPrice * (1 - this.parameters.trailingStopDistance)
        : currentPrice * (1 + this.parameters.trailingStopDistance);

      if (!position.trailingStopPrice || 
          (position.side === 'long' && newTrailingStop > position.trailingStopPrice) ||
          (position.side === 'short' && newTrailingStop < position.trailingStopPrice)) {
        position.trailingStopPrice = newTrailingStop;
      }
    }

    if (position.trailingStopActivated && position.trailingStopPrice) {
      const shouldTrailingStop = position.side === 'long'
        ? currentPrice <= position.trailingStopPrice
        : currentPrice >= position.trailingStopPrice;

      if (shouldTrailingStop) {
        this.closePosition(position, 'trailing_stop', currentPrice);
      }
    }
  }

  /**
   * 检查时间基础退出
   */
  private checkTimeBasedExit(position: Position): void {
    const holdingTime = Date.now() - position.entryTime;
    const holdingMinutes = holdingTime / (1000 * 60);

    // 最大持仓时间
    if (holdingMinutes >= this.parameters.maxHoldingTime) {
      this.closePosition(position, 'max_time');
    }

    // 获利了结时间
    if (holdingMinutes >= this.parameters.profitTakingTime && position.pnl > 0) {
      this.closePosition(position, 'profit_taking');
    }
  }

  /**
   * 计算持仓盈亏
   */
  private calculatePositionPnl(position: Position, currentPrice: number): number {
    const priceDiff = position.side === 'long' 
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;
    
    return priceDiff * position.quantity;
  }

  /**
   * 部分平仓
   */
  private async partialClose(position: Position, tpLevel: any, currentPrice: number): Promise<void> {
    try {
      console.log(`📈 部分止盈: ${position.id} @ ${currentPrice}`);
      
      // 这里应该执行实际的部分平仓订单
      // 为简化，我们标记为已填充
      tpLevel.filled = true;
      
      const pnl = this.calculatePositionPnl(position, currentPrice);
      position.pnl += pnl * tpLevel.quantity / position.quantity;
      
      this.emit('partialClose', { position, tpLevel, currentPrice });
      
    } catch (error) {
      console.error('❌ 部分平仓失败:', error);
    }
  }

  /**
   * 关闭持仓
   */
  private async closePosition(position: Position, reason: string, currentPrice?: number): Promise<void> {
    try {
      const closePrice = currentPrice || position.entryPrice;
      console.log(`🔚 关闭持仓: ${position.id} 原因:${reason} @ ${closePrice}`);

      // 执行平仓订单
      await this.binanceApi.createOrder({
        symbol: this.symbol,
        side: position.side === 'long' ? 'SELL' : 'BUY',
        type: 'MARKET',
        quantity: position.quantity.toString()
      });

      // 计算最终盈亏
      const finalPnl = this.calculatePositionPnl(position, closePrice);
      position.pnl = finalPnl;

      // 更新统计
      this.updateTradingStats(position);

      // 移除持仓
      this.state.positions.delete(position.id);

      console.log(`✅ 持仓关闭: PnL ${finalPnl.toFixed(2)} USDT`);
      this.emit('positionClosed', { position, reason, closePrice });

    } catch (error) {
      console.error('❌ 关闭持仓失败:', error);
      this.emit('error', error);
    }
  }

  /**
   * 更新交易统计
   */
  private updateTradingStats(position: Position): void {
    this.state.totalPnl += position.pnl;
    this.state.totalFees += position.fees;
    this.state.balance += position.pnl - position.fees;

    if (position.pnl > 0) {
      this.state.winningTrades++;
      this.state.consecutiveLosses = 0;
    } else {
      this.state.losingTrades++;
      this.state.consecutiveLosses++;
      this.state.lastLossTime = Date.now();
    }

    // 更新最大回撤
    if (this.state.balance > this.state.peak) {
      this.state.peak = this.state.balance;
    }
    
    const drawdown = (this.state.peak - this.state.balance) / this.state.peak;
    this.state.maxDrawdown = Math.max(this.state.maxDrawdown, drawdown);

    // 保存交易记录到数据库
    this.dbService.saveTrade({
      id: position.id,
      timestamp: position.entryTime,
      symbol: position.symbol,
      direction: position.side.toUpperCase() as 'LONG' | 'SHORT',
      entryPrice: position.entryPrice,
      exitPrice: position.entryPrice + (position.pnl / position.quantity),
      quantity: position.quantity,
      pnl: position.pnl,
      pnlPercent: (position.pnl / (position.entryPrice * position.quantity)) * 100,
      fees: position.fees,
      holdingTime: Date.now() - position.entryTime,
      exitReason: 'closed',
      createdAt: Date.now()
    }).catch(console.error);
  }

  /**
   * 关闭所有持仓
   */
  private async closeAllPositions(): Promise<void> {
    console.log('🔚 关闭所有持仓...');
    
    const positions = Array.from(this.state.positions.values());
    for (const position of positions) {
      await this.closePosition(position, 'system_shutdown');
    }
  }

  /**
   * 处理订单更新
   */
  private handleOrderUpdate(orderUpdate: any): void {
    console.log('📋 订单更新:', orderUpdate);
    this.emit('orderUpdate', orderUpdate);
  }

  /**
   * 处理余额更新
   */
  private handleBalanceUpdate(balanceUpdate: any): void {
    if (balanceUpdate.asset === 'USDT') {
      this.state.balance = parseFloat(balanceUpdate.free);
      this.emit('balanceUpdate', balanceUpdate);
    }
  }

  /**
   * 获取交易状态
   */
  getState(): TradingState {
    return { ...this.state };
  }

  /**
   * 获取性能统计
   */
  getPerformanceStats(): any {
    const totalTrades = this.state.winningTrades + this.state.losingTrades;
    const winRate = totalTrades > 0 ? this.state.winningTrades / totalTrades : 0;
    const profitFactor = this.state.losingTrades > 0 ? 
      (this.state.totalPnl + Math.abs(this.state.totalPnl)) / Math.abs(this.state.totalPnl) : 0;

    return {
      totalTrades,
      winningTrades: this.state.winningTrades,
      losingTrades: this.state.losingTrades,
      winRate,
      totalPnl: this.state.totalPnl,
      totalFees: this.state.totalFees,
      netPnl: this.state.totalPnl - this.state.totalFees,
      maxDrawdown: this.state.maxDrawdown,
      profitFactor,
      currentBalance: this.state.balance,
      dailyTrades: this.state.dailyTrades,
      consecutiveLosses: this.state.consecutiveLosses,
      activePositions: this.state.positions.size
    };
  }

  // 技术指标计算方法
  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;
    
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

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    if (prices.length === 1) return prices[0];
    
    const multiplier = 2 / (period + 1);
    let ema = prices[0];
    
    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
    }
    
    return ema;
  }

  private calculateVolatility(prices: number[], period: number): number {
    if (prices.length < period) return 0;
    
    const returns = [];
    for (let i = 1; i < Math.min(prices.length, period + 1); i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  private calculateVolumeRatio(volumes: number[], period: number): number {
    if (volumes.length < period + 1) return 1;
    
    const currentVolume = volumes[volumes.length - 1];
    const avgVolume = volumes.slice(-period - 1, -1).reduce((sum, v) => sum + v, 0) / period;
    
    return avgVolume > 0 ? currentVolume / avgVolume : 1;
  }
}

export default RealTimeTradingEngine;