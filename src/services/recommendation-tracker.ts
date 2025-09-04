import { v4 as uuidv4 } from 'uuid';
import { enhancedOKXDataService } from './enhanced-okx-data-service';
import { config } from '../config';
import { recommendationDatabase } from './recommendation-database';

// 新增：通过环境变量控制是否在创建推荐时拉取外部行情（默认关闭以避免超时）
const DISABLE_EXTERNAL_MARKET_ON_CREATE = (process.env.DISABLE_EXTERNAL_MARKET_ON_CREATE || 'true') === 'true';

// 推荐记录接口
export interface RecommendationRecord {
  id: string;
  created_at: Date;
  updated_at: Date;
  
  // 基础推荐信息
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  current_price: number;
  
  // 止损止盈设置
  stop_loss_price?: number;
  take_profit_price?: number;
  stop_loss_percent?: number;
  take_profit_percent?: number;
  liquidation_price?: number;
  margin_ratio?: number;
  maintenance_margin?: number;
  
  // 杠杆和仓位
  leverage: number;
  position_size?: number;
  risk_level?: string;
  
  // 策略信息
  strategy_type: string;
  algorithm_name?: string;
  signal_strength?: number;
  confidence_score?: number;
  quality_score?: number;
  
  // 推荐结果状态
  status: 'PENDING' | 'ACTIVE' | 'CLOSED' | 'EXPIRED';
  result?: 'WIN' | 'LOSS' | 'BREAKEVEN';
  exit_price?: number;
  exit_time?: Date;
  exit_reason?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TIMEOUT' | 'LIQUIDATION';
  
  // 理论收益统计
  pnl_amount?: number;
  pnl_percent?: number;
  holding_duration?: number; // 分钟
  
  // 市场环境数据
  market_volatility?: number;
  volume_24h?: number;
  price_change_24h?: number;
  
  // 元数据
  source?: string;
  is_strategy_generated?: boolean;
  strategy_confidence_level?: string;
  exclude_from_ml?: boolean;
  notes?: string;
}

// 价格监控结果
interface PriceCheckResult {
  currentPrice: number;
  triggered: boolean;
  triggerType?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION';
  pnlAmount: number;
  pnlPercent: number;
}

/**
 * 推荐结果跟踪服务
 * 负责监控推荐的执行结果，定时检查价格变化并更新数据库
 */
export class RecommendationTracker {
  private trackingInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL = 60 * 1000; // 1分钟检查一次
  private readonly MAX_HOLDING_HOURS = 24; // 最大持仓24小时
  private isRunning = false;
  
  // 内存中的活跃推荐缓存
  private activeRecommendations: Map<string, RecommendationRecord> = new Map();
  
  constructor() {
    console.log('RecommendationTracker initialized');
  }
  
  /**
   * 启动推荐跟踪服务
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('RecommendationTracker already running');
      return;
    }
    
    this.isRunning = true;
    console.log('Starting RecommendationTracker...');
    
    // 从数据库加载活跃推荐
    await this.loadActiveRecommendations();
    
    // 立即执行一次检查
    this.checkRecommendations();
    
    // 设置定时检查
    this.trackingInterval = setInterval(() => {
      this.checkRecommendations();
    }, this.CHECK_INTERVAL);
    
    console.log(`RecommendationTracker started, checking every ${this.CHECK_INTERVAL / 1000}s`);
    console.log(`Loaded ${this.activeRecommendations.size} active recommendations`);
  }
  
  /**
   * 停止推荐跟踪服务
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
    
    console.log('RecommendationTracker stopped');
  }
  
  /**
   * 添加新的推荐记录进行跟踪
   */
  async addRecommendation(recommendation: Omit<RecommendationRecord, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    const id = uuidv4();
    const now = new Date();
    
    // 获取市场数据（可通过环境变量在创建阶段禁用外部请求，避免超时）
    let marketData;
    if (DISABLE_EXTERNAL_MARKET_ON_CREATE) {
      console.log('[RecommendationTracker] Skip external market fetch on create (DISABLE_EXTERNAL_MARKET_ON_CREATE=true)');
      marketData = {
        currentPrice: recommendation.current_price,
        volume24h: 0,
        priceChange24h: 0
      };
    } else {
      try {
        const ticker = await enhancedOKXDataService.getTicker(recommendation.symbol);
        marketData = {
          currentPrice: ticker?.price ? parseFloat(ticker.price.toString()) : recommendation.current_price,
          volume24h: ticker?.volume ? parseFloat(ticker.volume.toString()) : 0,
          priceChange24h: ticker?.change24h ? parseFloat(ticker.change24h.toString()) : 0
        };
      } catch (error) {
        console.warn(`Failed to get market data for ${recommendation.symbol}:`, error);
        marketData = {
          currentPrice: recommendation.current_price,
          volume24h: 0,
          priceChange24h: 0
        };
      }
    }
    
    const record: RecommendationRecord = {
      ...recommendation,
      id,
      created_at: now,
      updated_at: now,
      status: 'ACTIVE',
      current_price: marketData.currentPrice,
      volume_24h: marketData.volume24h,
      price_change_24h: marketData.priceChange24h,
      source: recommendation.source || 'STRATEGY_AUTO',
      is_strategy_generated: recommendation.is_strategy_generated !== false
    };
    
    // 添加到内存缓存
    this.activeRecommendations.set(id, record);
    
    // 保存到数据库
    await this.saveToDatabase(record);
    
    console.log(`Added recommendation ${id} for tracking: ${record.symbol} ${record.direction} @ ${record.entry_price}`);
    return id;
  }
  
  /**
   * 获取活跃推荐列表
   */
  getActiveRecommendations(): RecommendationRecord[] {
    return Array.from(this.activeRecommendations.values());
  }
  
  /**
   * 获取推荐统计信息
   */
  async getStatistics(strategyType?: string): Promise<{
    total: number;
    active: number;
    wins: number;
    losses: number;
    breakeven: number;
    winRate: number;
    avgPnl: number;
    totalPnl: number;
    avgHoldingDuration: number;
  }> {
    try {
      // TODO: 从数据库获取完整统计
      const all = Array.from(this.activeRecommendations.values());
      const closed = all.filter(r => r.status === 'CLOSED');
      
      const wins = closed.filter(r => r.result === 'WIN').length;
      const losses = closed.filter(r => r.result === 'LOSS').length;
      const breakeven = closed.filter(r => r.result === 'BREAKEVEN').length;
      
      const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
      const avgPnl = closed.length > 0 
        ? closed.reduce((sum, r) => sum + (r.pnl_percent || 0), 0) / closed.length 
        : 0;
      const totalPnl = closed.reduce((sum, r) => sum + (r.pnl_percent || 0), 0);
      const avgHoldingDuration = closed.length > 0
        ? closed.reduce((sum, r) => sum + (r.holding_duration || 0), 0) / closed.length
        : 0;
      
      return {
        total: all.length,
        active: all.filter(r => r.status === 'ACTIVE').length,
        wins,
        losses,
        breakeven,
        winRate,
        avgPnl,
        totalPnl,
        avgHoldingDuration
      };
    } catch (error) {
      console.error('Failed to get statistics:', error);
      return {
        total: this.activeRecommendations.size,
        active: this.activeRecommendations.size,
        wins: 0,
        losses: 0,
        breakeven: 0,
        winRate: 0,
        avgPnl: 0,
        totalPnl: 0,
        avgHoldingDuration: 0
      };
    }
  }
  
  /**
   * 定时检查所有活跃推荐
   */
  private async checkRecommendations(): Promise<void> {
    try {
      const activeRecs = Array.from(this.activeRecommendations.values())
        .filter(r => r.status === 'ACTIVE');
      
      if (activeRecs.length === 0) {
        return;
      }
      
      console.log(`Checking ${activeRecs.length} active recommendations...`);
      
      const now = new Date();
      const toClose: string[] = [];
      
      for (const rec of activeRecs) {
        try {
          // 检查超时
          const holdingHours = (now.getTime() - rec.created_at.getTime()) / (1000 * 60 * 60);
          if (holdingHours >= this.MAX_HOLDING_HOURS) {
            console.log(`Recommendation ${rec.id} expired after ${holdingHours.toFixed(1)} hours`);
            await this.closeRecommendation(rec, 'TIMEOUT', rec.current_price);
            toClose.push(rec.id);
            continue;
          }
          
          await this.checkSingleRecommendation(rec);
          
          // 检查是否需要关闭
          if (rec.status === 'CLOSED') {
            toClose.push(rec.id);
          }
        } catch (error) {
          console.error(`Error checking recommendation ${rec.id}:`, error);
        }
      }
      
      // 从活跃列表中移除已关闭的推荐
      toClose.forEach(id => this.activeRecommendations.delete(id));
      
      if (toClose.length > 0) {
        console.log(`Closed ${toClose.length} recommendations`);
      }
      
    } catch (error) {
      console.error('Error checking recommendations:', error);
    }
  }
  
  /**
   * 检查单个推荐的状态
   */
  private async checkSingleRecommendation(rec: RecommendationRecord): Promise<void> {
    try {
      // 检查是否超时
      const holdingMinutes = (Date.now() - rec.created_at.getTime()) / (1000 * 60);
      if (holdingMinutes > this.MAX_HOLDING_HOURS * 60) {
        await this.closeRecommendation(rec, 'TIMEOUT', rec.current_price);
        return;
      }
      
      // 获取当前价格
      const priceResult = await this.getCurrentPrice(rec.symbol);
      if (!priceResult) {
        console.warn(`Failed to get current price for ${rec.symbol}`);
        return;
      }
      
      // 检查触发条件
      const checkResult = this.checkTriggerConditions(rec, priceResult.currentPrice);
      
      if (checkResult.triggered) {
        await this.closeRecommendation(
          rec, 
          checkResult.triggerType!, 
          checkResult.currentPrice,
          checkResult.pnlAmount,
          checkResult.pnlPercent
        );
      } else {
        // 更新当前价格
        rec.current_price = checkResult.currentPrice;
        rec.updated_at = new Date();
      }
      
    } catch (error) {
      console.error(`Error checking recommendation ${rec.id}:`, error);
    }
  }
  
  /**
   * 获取当前市场价格
   */
  private async getCurrentPrice(symbol: string): Promise<{ currentPrice: number } | null> {
    try {
      const ticker = await enhancedOKXDataService.getTicker(symbol);
      if (ticker && ticker.price) {
        return { currentPrice: parseFloat(ticker.price.toString()) };
      }
      return null;
    } catch (error) {
      console.error(`Failed to get current price for ${symbol}:`, error);
      return null;
    }
  }
  
  /**
   * 检查是否触发止盈止损条件
   */
  private checkTriggerConditions(rec: RecommendationRecord, currentPrice: number): PriceCheckResult {
    const { direction, entry_price, take_profit_price, stop_loss_price, liquidation_price } = rec;
    
    let triggered = false;
    let triggerType: 'TAKE_PROFIT' | 'STOP_LOSS' | 'LIQUIDATION' | undefined;
    
    if (direction === 'LONG') {
      // 多头仓位
      if (take_profit_price && currentPrice >= take_profit_price) {
        triggered = true;
        triggerType = 'TAKE_PROFIT';
      } else if (stop_loss_price && currentPrice <= stop_loss_price) {
        triggered = true;
        triggerType = 'STOP_LOSS';
      } else if (liquidation_price && currentPrice <= liquidation_price) {
        triggered = true;
        triggerType = 'LIQUIDATION';
      }
    } else {
      // 空头仓位
      if (take_profit_price && currentPrice <= take_profit_price) {
        triggered = true;
        triggerType = 'TAKE_PROFIT';
      } else if (stop_loss_price && currentPrice >= stop_loss_price) {
        triggered = true;
        triggerType = 'STOP_LOSS';
      } else if (liquidation_price && currentPrice >= liquidation_price) {
        triggered = true;
        triggerType = 'LIQUIDATION';
      }
    }
    
    // 计算收益
    const pnlPercent = direction === 'LONG' 
      ? ((currentPrice - entry_price) / entry_price) * 100
      : ((entry_price - currentPrice) / entry_price) * 100;
    
    const pnlAmount = (pnlPercent / 100) * (rec.position_size || 0) * rec.leverage;
    
    return {
      currentPrice,
      triggered,
      triggerType,
      pnlAmount,
      pnlPercent
    };
  }
  
  /**
   * 关闭推荐记录
   */
  private async closeRecommendation(
    rec: RecommendationRecord,
    reason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TIMEOUT' | 'LIQUIDATION',
    exitPrice: number,
    pnlAmount?: number,
    pnlPercent?: number
  ): Promise<void> {
    const now = new Date();
    const holdingDuration = Math.round((now.getTime() - rec.created_at.getTime()) / (1000 * 60));
    
    // 计算收益
    const checkResult = this.checkTriggerConditions(rec, exitPrice);
    const finalPnlPercent = pnlPercent !== undefined ? pnlPercent : checkResult.pnlPercent;
    const finalPnlAmount = pnlAmount !== undefined ? pnlAmount : checkResult.pnlAmount;
    
    // 确定结果类型
    let result: 'WIN' | 'LOSS' | 'BREAKEVEN';
    if (reason === 'TAKE_PROFIT') {
      result = 'WIN';
    } else if (reason === 'STOP_LOSS' || reason === 'LIQUIDATION') {
      result = 'LOSS';
    } else {
      // TIMEOUT - 根据PnL判断
      if (Math.abs(finalPnlPercent) < 0.1) {
        result = 'BREAKEVEN';
      } else {
        result = finalPnlPercent > 0 ? 'WIN' : 'LOSS';
      }
    }
    
    // 更新记录
    rec.status = 'CLOSED';
    rec.result = result;
    rec.exit_price = exitPrice;
    rec.exit_time = now;
    rec.exit_reason = reason;
    rec.pnl_amount = finalPnlAmount;
    rec.pnl_percent = finalPnlPercent;
    rec.holding_duration = holdingDuration;
    rec.updated_at = now;
    
    // 更新数据库
    await this.updateDatabase(rec);
    
    console.log(`Closed recommendation ${rec.id}: ${result} (${reason}) PnL: ${rec.pnl_percent?.toFixed(2)}% after ${holdingDuration}min`);
  }
  
  /**
   * 从数据库加载活跃推荐
   */
  private async loadActiveRecommendations(): Promise<void> {
    try {
      await recommendationDatabase.initialize();
      const actives = await recommendationDatabase.getActiveRecommendations();
      actives.forEach(rec => this.activeRecommendations.set(rec.id, rec));
      console.log(`Loaded ${actives.length} active recommendations from DB`);
    } catch (error) {
      console.error('Failed to load active recommendations from database:', error);
    }
  }
  
  /**
   * 获取推荐历史
   */
  async getRecommendationHistory(
    limit: number = 100,
    offset: number = 0,
    filters?: {
      strategy_type?: string;
      status?: string;
      result?: string;
      start_date?: Date;
      end_date?: Date;
    }
  ): Promise<{ recommendations: RecommendationRecord[]; total: number }> {
    try {
      await recommendationDatabase.initialize();
      return await recommendationDatabase.getRecommendationHistory(limit, offset, filters);
    } catch (error) {
      console.error('Failed to get recommendation history:', error);
      return { recommendations: [], total: 0 };
    }
  }
  
  /**
   * 手动关闭推荐
   */
  async manualCloseRecommendation(id: string, reason?: string): Promise<boolean> {
    const rec = this.activeRecommendations.get(id);
    if (!rec) {
      return false;
    }
    
    try {
      // 获取当前价格
      const priceResult = await this.getCurrentPrice(rec.symbol);
      const currentPrice = priceResult?.currentPrice || rec.current_price;
      
      // 计算盈亏
      const checkResult = this.checkTriggerConditions(rec, currentPrice);
      
      await this.closeRecommendation(rec, (reason as any) || 'TIMEOUT', currentPrice, checkResult.pnlAmount, checkResult.pnlPercent);
      this.activeRecommendations.delete(id);
      
      return true;
    } catch (error) {
      console.error(`Failed to manually close recommendation ${id}:`, error);
      return false;
    }
  }
  
  /**
   * 保存推荐到数据库
   */
  private async saveToDatabase(rec: RecommendationRecord): Promise<void> {
    try {
      await recommendationDatabase.initialize();
      await recommendationDatabase.saveRecommendation(rec);
    } catch (error) {
      console.error(`Failed to save recommendation ${rec.id} to database:`, error);
    }
  }
  
  /**
   * 更新数据库中的推荐记录
   */
  private async updateDatabase(rec: RecommendationRecord): Promise<void> {
    try {
      await recommendationDatabase.initialize();
      await recommendationDatabase.updateRecommendation(rec);
    } catch (error) {
      console.error(`Failed to update recommendation ${rec.id} in database:`, error);
    }
  }

  /**
   * 获取指定推荐的当前价格
   */
  async getPrice(recommendationId: string): Promise<number | null> {
    const rec = this.activeRecommendations.get(recommendationId);
    if (!rec) {
      return null;
    }
    
    try {
      const priceData = await this.getCurrentPrice(rec.symbol);
      return priceData?.currentPrice || null;
    } catch (error) {
      console.error(`Failed to get price for recommendation ${recommendationId}:`, error);
      return null;
    }
  }

  /**
   * 清除价格缓存
   */
  clearPrices(): void {
    // 这里可以清除价格相关的缓存
    console.log('Price cache cleared');
  }

  /**
   * 获取价格监控统计信息
   */
  getPriceMonitorStats(): { symbols: number; size: number } {
    const uniqueSymbols = new Set(Array.from(this.activeRecommendations.values()).map(r => r.symbol));
    return {
      symbols: uniqueSymbols.size,
      size: this.activeRecommendations.size
    };
  }
}

// 导出单例实例
export const recommendationTracker = new RecommendationTracker();