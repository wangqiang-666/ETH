import { v4 as uuidv4 } from 'uuid';
import { enhancedOKXDataService } from './enhanced-okx-data-service';
import { config } from '../config';
import { recommendationDatabase } from './recommendation-database';

// 新增：通过环境变量控制是否在创建推荐时拉取外部行情（默认关闭以避免超时）
const DISABLE_EXTERNAL_MARKET_ON_CREATE = (process.env.DISABLE_EXTERNAL_MARKET_ON_CREATE || 'true') === 'true';

// 新增：冷却期错误类型，便于 API 精确映射 429
export class CooldownError extends Error {
  code: 'COOLDOWN_ACTIVE' = 'COOLDOWN_ACTIVE';
  symbol: string;
  remainingMs: number;
  nextAvailableAt: string;
  lastRecommendationId?: string;
  lastCreatedAt?: string;
  constructor(symbol: string, remainingMs: number, last?: RecommendationRecord) {
    super(`Cooldown active for ${symbol}: ${remainingMs}ms remaining`);
    this.symbol = symbol;
    this.remainingMs = remainingMs;
    this.nextAvailableAt = new Date(Date.now() + remainingMs).toISOString();
    if (last) {
      this.lastRecommendationId = last.id;
      this.lastCreatedAt = last.created_at?.toISOString();
    }
    Object.setPrototypeOf(this, CooldownError.prototype);
  }
}

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
  exit_reason?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TIMEOUT' | 'LIQUIDATION' | 'MANUAL' | 'BREAKEVEN' | 'MANUAL';
  
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
  
  // 新增：对外暴露运行状态（供API /status查询）
  isRunningStatus(): boolean {
    return this.isRunning;
  }
  
  /**
   * 添加新的推荐记录进行跟踪
   */
  async addRecommendation(recommendation: Omit<RecommendationRecord, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
      // 新增：按 symbol 冷却期校验（默认30分钟，可通过 config.strategy.signalCooldownMs 配置）
      const cooldownMs = Number((config as any)?.strategy?.signalCooldownMs) || 30 * 60 * 1000;
      try {
        await recommendationDatabase.initialize();
        const last = await recommendationDatabase.getLastRecommendationBySymbol(recommendation.symbol);
        if (last?.created_at) {
          const elapsed = Date.now() - last.created_at.getTime();
          const remaining = cooldownMs - elapsed;
          if (remaining > 0) {
            throw new CooldownError(recommendation.symbol, remaining, last);
          }
        }
      } catch (err) {
        if (err instanceof CooldownError) {
          // 直接向上抛出，供 API 或调用方处理
          throw err;
        }
        // 其它错误仅记录，不阻塞创建（例如首次运行或查询失败）
        if (err) {
          console.warn('[RecommendationTracker] Cooldown check failed, proceeding without block:', (err as any)?.message || String(err));
        }
      }
  
      const id = (recommendation as any)?.id ?? uuidv4();
      const now = new Date();
    
      // 统一字段命名（兼容 stop_loss/take_profit/confidence -> *_price/confidence_score）
      const anyRec: any = recommendation as any;
      const normalized = {
        stop_loss_price: anyRec.stop_loss_price ?? (typeof anyRec.stop_loss === 'number' ? anyRec.stop_loss : undefined),
        take_profit_price: anyRec.take_profit_price ?? (typeof anyRec.take_profit === 'number' ? anyRec.take_profit : undefined),
        confidence_score: anyRec.confidence_score ?? (typeof anyRec.confidence === 'number' ? anyRec.confidence : undefined)
      } as Partial<RecommendationRecord>;
  
      // 获取市场数据（可通过环境变量在创建阶段禁用外部行情，避免超时）
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
        ...normalized,
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
      // 仅返回状态为 ACTIVE 的推荐，避免短暂处于 EXPIRED/CLOSED 但尚未从缓存移除的记录被暴露
      return Array.from(this.activeRecommendations.values()).filter(r => r.status === 'ACTIVE');
    }
    
    /**
     * 从活跃缓存中移除指定推荐
     */
    removeFromActiveCache(id: string): boolean {
      return this.activeRecommendations.delete(id);
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
        
        // 第一阶段：优先处理超时单，不依赖任何外部价格请求，避免被网络阻塞
        const remaining: RecommendationRecord[] = [];
        for (const rec of activeRecs) {
          const holdingHours = (now.getTime() - rec.created_at.getTime()) / (1000 * 60 * 60);
          if (holdingHours >= this.MAX_HOLDING_HOURS) {
            console.log(`Recommendation ${rec.id} expired after ${holdingHours.toFixed(1)} hours`);
            await this.expireRecommendation(rec, 'TIMEOUT');
            toClose.push(rec.id);
            // 立刻从活跃缓存移除，避免在同一次轮询中仍被返回到API
            this.activeRecommendations.delete(rec.id);
          } else {
            remaining.push(rec);
          }
        }
        
        // 第二阶段：仅对未超时的推荐进行价格检查与触发判断
        for (const rec of remaining) {
          try {
            await this.checkSingleRecommendation(rec);
            
            // 检查是否需要从活跃列表移除（已关闭或已过期）
            if (rec.status === 'CLOSED' || rec.status === 'EXPIRED') {
              toClose.push(rec.id);
            }
          } catch (error) {
            console.error(`Error checking recommendation ${rec.id}:`, error);
          }
        }
        
        // 从活跃列表中移除已关闭/过期的推荐
        toClose.forEach(id => this.activeRecommendations.delete(id));
        
        if (toClose.length > 0) {
          console.log(`Closed/Expired ${toClose.length} recommendations`);
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
          await this.expireRecommendation(rec, 'TIMEOUT');
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
      
      // 计算收益（收益率需要包含杠杆）
      const lev = Math.max(1, Number(rec.leverage) || 1);
      const baseMovePercent = direction === 'LONG' 
        ? ((currentPrice - entry_price) / entry_price) * 100
        : ((entry_price - currentPrice) / entry_price) * 100;
      const pnlPercent = baseMovePercent * lev;
      
      // 金额按名义仓位计算（此时 pnlPercent 已包含杠杆，不再重复乘以杠杆）
      const pnlAmount = (pnlPercent / 100) * (rec.position_size || 0);
      
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
      reason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TIMEOUT' | 'LIQUIDATION' | 'MANUAL' | 'BREAKEVEN',
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
      } else if (reason === 'BREAKEVEN') {
        result = 'BREAKEVEN';
      } else {
        // TIMEOUT or MANUAL - 根据PnL判断
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
    
    // 新增：标记推荐为过期（不计算收益，不设置退出价格，只用于从活跃列表隐藏和统计）
    private async expireRecommendation(
      rec: RecommendationRecord,
      reason: 'TIMEOUT' = 'TIMEOUT'
    ): Promise<void> {
      const now = new Date();
      const holdingDuration = Math.round((now.getTime() - rec.created_at.getTime()) / (1000 * 60));
      
      rec.status = 'EXPIRED';
      rec.exit_time = now;
      rec.exit_reason = reason;
      // 不设置 exit_price / pnl / result
      rec.holding_duration = holdingDuration;
      rec.updated_at = now;
      
      await this.updateDatabase(rec);
      console.log(`Expired recommendation ${rec.id} (${reason}) after ${holdingDuration}min`);
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
    
    async manualCloseRecommendation(id: string, reason?: string): Promise<boolean> {
      try {
        const rec = this.activeRecommendations.get(id);
        if (!rec) {
          console.warn(`Recommendation ${id} not found in active cache`);
          return false;
        }
        const finalReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TIMEOUT' | 'LIQUIDATION' | 'MANUAL' | 'BREAKEVEN' =
          reason === 'LIQUIDATION' ? 'LIQUIDATION' :
          reason === 'TAKE_PROFIT' ? 'TAKE_PROFIT' :
          reason === 'STOP_LOSS' ? 'STOP_LOSS' :
          reason === 'BREAKEVEN' ? 'BREAKEVEN' :
          'MANUAL';
        await this.closeRecommendation(rec, finalReason, rec.current_price);
        this.activeRecommendations.delete(id);
        return true;
      } catch (error) {
        console.error('Failed to manually close recommendation:', error);
        return false;
      }
    }
    
    // 新增：保本出场（供策略引擎 TP1 后上移止损触发时调用）
    async breakevenCloseRecommendation(id: string, exitPrice: number): Promise<boolean> {
      try {
        const rec = this.activeRecommendations.get(id);
        if (!rec) return false;
        await this.closeRecommendation(rec, 'BREAKEVEN', exitPrice);
        this.activeRecommendations.delete(id);
        return true;
      } catch (e) {
        console.error('Failed to breakeven close recommendation:', e);
        return false;
      }
    }
    
    // 新增：手动标记过期（仅用于测试/维护用途，标记为 EXPIRED 并从活跃列表移除）
    async manualExpireRecommendation(id: string, _reason?: string): Promise<boolean> {
      try {
        const rec = this.activeRecommendations.get(id);
        if (!rec) return false;
        // 仅支持 TIMEOUT 语义，保持与 expireRecommendation 的类型一致
        await this.expireRecommendation(rec, 'TIMEOUT');
        this.activeRecommendations.delete(id);
        return true;
      } catch (e) {
        console.error('Failed to manually expire recommendation:', e);
        return false;
      }
    }

    // 新增：代理数据库保存（创建时）
    private async saveToDatabase(rec: RecommendationRecord): Promise<void> {
      try {
        await recommendationDatabase.initialize();
        await recommendationDatabase.saveRecommendation(rec);
      } catch (e) {
        console.error('Failed to save recommendation to database:', e);
        throw e;
      }
    }

    // 新增：代理数据库更新（关闭/过期/价格更新时）
    private async updateDatabase(rec: RecommendationRecord): Promise<void> {
      try {
        await recommendationDatabase.initialize();
        await recommendationDatabase.updateRecommendation(rec);
      } catch (e) {
        console.error('Failed to update recommendation in database:', e);
        throw e;
      }
    }

    // 新增：清理价格相关缓存（供API维护端点调用）
    clearPrices(): void {
      try {
        if (typeof (enhancedOKXDataService as any).clearCache === 'function') {
          (enhancedOKXDataService as any).clearCache();
        }
      } catch (e) {
        console.warn('clearPrices warning:', (e as any)?.message || String(e));
      }
    }

    // 新增：获取价格监控缓存统计（供系统状态端点使用）
    getPriceMonitorStats(): { size: number; symbols: string[] } {
      try {
        const stats = (enhancedOKXDataService as any).getCacheStats?.();
        const itemCount = Number((stats && (stats.itemCount ?? stats.cacheEntries)) || 0);
        return { size: itemCount, symbols: [] };
      } catch {
        return { size: 0, symbols: [] };
      }
    }
}

export const recommendationTracker = new RecommendationTracker();