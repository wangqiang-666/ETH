import { EnhancedOKXDataService } from './enhanced-okx-data-service.js';
import { RecommendationRecord } from './recommendation-tracker.js';

/**
 * 价格监控服务
 * 负责获取实时价格数据并检查止盈止损触发条件
 */
export class PriceMonitor {
  private dataService: EnhancedOKXDataService;
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly CACHE_DURATION = 5000; // 5秒缓存
  
  constructor(dataService: EnhancedOKXDataService) {
    this.dataService = dataService;
  }
  
  /**
   * 获取当前价格（带缓存）
   */
  async getCurrentPrice(symbol: string): Promise<number> {
    const now = Date.now();
    const cached = this.priceCache.get(symbol);
    
    // 如果缓存有效，直接返回
    if (cached && (now - cached.timestamp) < this.CACHE_DURATION) {
      return cached.price;
    }
    
    try {
      // 获取最新价格
      const ticker = await this.dataService.getTicker(symbol);
      if (!ticker) {
        throw new Error(`Failed to get ticker data for ${symbol}`);
      }
      const price = ticker.price;
      
      // 更新缓存
      this.priceCache.set(symbol, { price, timestamp: now });
      
      return price;
    } catch (error) {
      console.error(`Failed to get current price for ${symbol}:`, error);
      
      // 如果获取失败但有缓存，返回缓存价格
      if (cached) {
        console.warn(`Using cached price for ${symbol} (${Math.round((now - cached.timestamp) / 1000)}s old)`);
        return cached.price;
      }
      
      throw error;
    }
  }
  
  /**
   * 检查推荐是否触发止盈止损
   */
  async checkTriggerConditions(rec: RecommendationRecord): Promise<{
    triggered: boolean;
    triggerType?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION';
    currentPrice: number;
    pnlPercent: number;
    pnlAmount?: number;
  }> {
    try {
      const currentPrice = await this.getCurrentPrice(rec.symbol);
      
      // 计算盈亏百分比
      const pnlPercent = this.calculatePnlPercent(rec, currentPrice);
      
      // 计算盈亏金额（如果有仓位大小）
      let pnlAmount: number | undefined;
      if (rec.position_size) {
        pnlAmount = this.calculatePnlAmount(rec, currentPrice);
      }
      
      // 检查爆仓价格
      if (rec.liquidation_price && this.isLiquidationTriggered(rec, currentPrice)) {
        return {
          triggered: true,
          triggerType: 'LIQUIDATION',
          currentPrice,
          pnlPercent,
          pnlAmount
        };
      }
      
      // 检查止盈
      if (this.isTakeProfitTriggered(rec, currentPrice)) {
        return {
          triggered: true,
          triggerType: 'TAKE_PROFIT',
          currentPrice,
          pnlPercent,
          pnlAmount
        };
      }
      
      // 检查止损
      if (this.isStopLossTriggered(rec, currentPrice)) {
        return {
          triggered: true,
          triggerType: 'STOP_LOSS',
          currentPrice,
          pnlPercent,
          pnlAmount
        };
      }
      
      // 未触发
      return {
        triggered: false,
        currentPrice,
        pnlPercent,
        pnlAmount
      };
      
    } catch (error) {
      console.error(`Error checking trigger conditions for ${rec.id}:`, error);
      throw error;
    }
  }
  
  /**
   * 检查是否触发止盈
   */
  private isTakeProfitTriggered(rec: RecommendationRecord, currentPrice: number): boolean {
    // 优先使用价格止盈
    if (rec.take_profit_price) {
      if (rec.direction === 'LONG') {
        return currentPrice >= rec.take_profit_price;
      } else {
        return currentPrice <= rec.take_profit_price;
      }
    }
    
    // 使用百分比止盈
    if (rec.take_profit_percent) {
      const pnlPercent = this.calculatePnlPercent(rec, currentPrice);
      return pnlPercent >= rec.take_profit_percent;
    }
    
    return false;
  }
  
  /**
   * 检查是否触发止损
   */
  private isStopLossTriggered(rec: RecommendationRecord, currentPrice: number): boolean {
    // 优先使用价格止损
    if (rec.stop_loss_price) {
      if (rec.direction === 'LONG') {
        return currentPrice <= rec.stop_loss_price;
      } else {
        return currentPrice >= rec.stop_loss_price;
      }
    }
    
    // 使用百分比止损
    if (rec.stop_loss_percent) {
      const pnlPercent = this.calculatePnlPercent(rec, currentPrice);
      return pnlPercent <= -Math.abs(rec.stop_loss_percent);
    }
    
    return false;
  }
  
  /**
   * 检查是否触发爆仓
   */
  private isLiquidationTriggered(rec: RecommendationRecord, currentPrice: number): boolean {
    if (!rec.liquidation_price) {
      return false;
    }
    
    if (rec.direction === 'LONG') {
      return currentPrice <= rec.liquidation_price;
    } else {
      return currentPrice >= rec.liquidation_price;
    }
  }
  
  /**
   * 计算盈亏百分比
   */
  private calculatePnlPercent(rec: RecommendationRecord, currentPrice: number): number {
    const priceChange = currentPrice - rec.entry_price;
    const priceChangePercent = (priceChange / rec.entry_price) * 100;
    
    // 考虑方向和杠杆
    let pnlPercent = priceChangePercent * (rec.leverage ?? 1);
    
    if (rec.direction === 'SHORT') {
      pnlPercent = -pnlPercent;
    }
    
    return pnlPercent;
  }
  
  /**
   * 计算盈亏金额
   */
  private calculatePnlAmount(rec: RecommendationRecord, currentPrice: number): number {
    if (!rec.position_size) {
      return 0;
    }
    
    const priceChange = currentPrice - rec.entry_price;
    let pnlAmount = priceChange * (rec.position_size || 0);
    
    if (rec.direction === 'SHORT') {
      pnlAmount = -pnlAmount;
    }
    
    return pnlAmount;
  }
  
  /**
   * 批量检查多个推荐的触发条件
   */
  async batchCheckTriggers(recommendations: RecommendationRecord[]): Promise<Map<string, {
    triggered: boolean;
    triggerType?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION';
    currentPrice: number;
    pnlPercent: number;
    pnlAmount?: number;
  }>> {
    const results = new Map<string, {
      triggered: boolean;
      triggerType?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION';
      currentPrice: number;
      pnlPercent: number;
      pnlAmount?: number;
    }>();
    
    // 按交易对分组，减少API调用
    const symbolGroups = new Map<string, RecommendationRecord[]>();
    for (const rec of recommendations) {
      if (!symbolGroups.has(rec.symbol)) {
        symbolGroups.set(rec.symbol, []);
      }
      symbolGroups.get(rec.symbol)!.push(rec);
    }
    
    // 并发处理每个交易对
    const promises = Array.from(symbolGroups.entries()).map(async ([symbol, recs]) => {
      try {
        const currentPrice = await this.getCurrentPrice(symbol);
        
        for (const rec of recs) {
          const pnlPercent = this.calculatePnlPercent(rec, currentPrice);
          let pnlAmount: number | undefined;
          if (rec.position_size) {
            pnlAmount = this.calculatePnlAmount(rec, currentPrice);
          }
          
          // 检查各种触发条件
          let triggered = false;
          let triggerType: 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION' | undefined;
          
          if (rec.liquidation_price && this.isLiquidationTriggered(rec, currentPrice)) {
            triggered = true;
            triggerType = 'LIQUIDATION';
          } else if (this.isTakeProfitTriggered(rec, currentPrice)) {
            triggered = true;
            triggerType = 'TAKE_PROFIT';
          } else if (this.isStopLossTriggered(rec, currentPrice)) {
            triggered = true;
            triggerType = 'STOP_LOSS';
          }
          
          results.set(rec.id, {
            triggered,
            triggerType,
            currentPrice,
            pnlPercent,
            pnlAmount
          });
        }
      } catch (error) {
        console.error(`Error checking triggers for symbol ${symbol}:`, error);
        
        // 为该交易对的所有推荐设置错误状态
        for (const rec of recs) {
          results.set(rec.id, {
            triggered: false,
            currentPrice: rec.current_price ?? rec.entry_price ?? 0, // 使用上次价格，若无则回退到入场价/0，保证为 number
            pnlPercent: 0
          });
        }
      }
    });
    
    await Promise.all(promises);
    return results;
  }
  
  /**
   * 获取市场数据（用于推荐创建时的环境数据）
   */
  async getMarketData(symbol: string): Promise<{
    currentPrice: number;
    volume24h: number;
    priceChange24h: number;
    volatility?: number;
  }> {
    try {
      const [ticker, klineData] = await Promise.all([
        this.dataService.getTicker(symbol),
        this.dataService.getKlineData(symbol, '1D', 2) // 获取2天数据计算波动率
      ]);
      
      const currentPrice = ticker ? ticker.price : 0;
      const volume24h = ticker ? ticker.volume : 0;
      const priceChange24h = ticker ? ticker.change24h : 0;
      
      // 计算波动率（如果有足够的K线数据）
      let volatility: number | undefined;
      if (klineData && klineData.length >= 2) {
        const closePrices = klineData.map(k => k.close); // 收盘价
         volatility = this.calculateVolatility(closePrices);
      }
      
      return {
        currentPrice,
        volume24h,
        priceChange24h,
        volatility
      };
    } catch (error) {
      console.error(`Failed to get market data for ${symbol}:`, error);
      throw error;
    }
  }
  
  /**
   * 计算价格波动率
   */
  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) {
      return 0;
    }
    
    // 计算价格变化率
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      const returnRate = (prices[i] - prices[i - 1]) / prices[i - 1];
      returns.push(returnRate);
    }
    
    // 计算标准差
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance) * 100; // 转换为百分比
    
    return volatility;
  }
  
  /**
   * 清理价格缓存
   */
  clearCache(): void {
    this.priceCache.clear();
  }
  
  /**
   * 获取缓存统计信息
   */
  getCacheStats(): { size: number; symbols: string[] } {
    return {
      size: this.priceCache.size,
      symbols: Array.from(this.priceCache.keys())
    };
  }
}