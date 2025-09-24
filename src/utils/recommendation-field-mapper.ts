import { extractTimestamp, normalizeObjectTimestamps, generateTimeBucket } from './timestamp-normalizer.js';

/**
 * 推荐字段映射工具
 * 统一处理推荐数据的字段映射和标准化
 */

export interface NormalizedRecommendation {
  id: string;
  created_at: Date;
  updated_at: Date;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  current_price: number;
  leverage: number;
  take_profit_price?: number | null;
  stop_loss_price?: number | null;
  take_profit_percent?: number | null;
  stop_loss_percent?: number | null;
  confidence_score?: number | null;
  position_size?: number | null;
  status: 'PENDING' | 'ACTIVE' | 'CLOSED' | 'EXPIRED';
  result?: 'WIN' | 'LOSS' | 'BREAKEVEN' | null;
  exit_price?: number | null;
  exit_time?: Date | null;
  exit_reason?: string | null;
  pnl_amount?: number | null;
  pnl_percent?: number | null;
  strategy_type?: string | null;
  source?: string | null;
  // 其他字段...
  [key: string]: any;
}

/**
 * 标准化推荐记录的字段映射
 */
export function normalizeRecommendationFields(rec: any): NormalizedRecommendation {
  if (!rec) {
    throw new Error('Recommendation record is null or undefined');
  }

  // 首先标准化时间戳字段
  const timestampNormalized = normalizeObjectTimestamps(rec);

  return {
    // 基础字段
    id: rec.id || rec.recommendation_id || '',
    created_at: timestampNormalized.created_at,
    updated_at: timestampNormalized.updated_at,
    
    // 交易信息
    symbol: String(rec.symbol || '').toUpperCase(),
    direction: normalizeDirection(rec.direction || rec.action),
    entry_price: normalizeNumber(rec.entry_price || rec.entryPrice),
    current_price: normalizeNumber(rec.current_price || rec.currentPrice || rec.entry_price || rec.entryPrice),
    leverage: normalizeNumber(rec.leverage) || 1,
    
    // 止盈止损
    take_profit_price: normalizeNumber(rec.take_profit_price || rec.takeProfitPrice || rec.take_profit),
    stop_loss_price: normalizeNumber(rec.stop_loss_price || rec.stopLossPrice || rec.stop_loss),
    take_profit_percent: normalizeNumber(rec.take_profit_percent || rec.takeProfitPercent),
    stop_loss_percent: normalizeNumber(rec.stop_loss_percent || rec.stopLossPercent),
    
    // 置信度和仓位
    confidence_score: normalizeNumber(rec.confidence_score || rec.confidenceScore || rec.confidence || rec.conf),
    position_size: normalizeNumber(rec.position_size || rec.positionSize),
    
    // 状态信息
    status: normalizeStatus(rec.status),
    result: normalizeResult(rec.result),
    exit_price: normalizeNumber(rec.exit_price || rec.exitPrice),
    exit_time: timestampNormalized.exit_time || null,
    exit_reason: rec.exit_reason || rec.exitReason || null,
    
    // 盈亏信息
    pnl_amount: normalizeNumber(rec.pnl_amount || rec.pnlAmount),
    pnl_percent: normalizeNumber(rec.pnl_percent || rec.pnlPercent),
    
    // 策略信息
    strategy_type: rec.strategy_type || rec.strategyType || null,
    source: rec.source || null,
    
    // 保留原始数据的其他字段
    ...rec
  };
}

/**
 * 标准化日期字段
 */
function normalizeDate(dateValue: any): Date {
  if (!dateValue) {
    return new Date();
  }
  
  if (dateValue instanceof Date) {
    return dateValue;
  }
  
  if (typeof dateValue === 'string' || typeof dateValue === 'number') {
    const date = new Date(dateValue);
    return isNaN(date.getTime()) ? new Date() : date;
  }
  
  return new Date();
}

/**
 * 标准化数字字段
 */
function normalizeNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  
  const num = Number(value);
  return isFinite(num) ? num : null;
}

/**
 * 标准化方向字段
 */
function normalizeDirection(direction: any): 'LONG' | 'SHORT' {
  const dir = String(direction || '').toUpperCase();
  
  if (dir === 'BUY' || dir === 'LONG') {
    return 'LONG';
  }
  
  if (dir === 'SELL' || dir === 'SHORT') {
    return 'SHORT';
  }
  
  // 默认返回 LONG，但在实际使用中应该抛出错误
  return 'LONG';
}

/**
 * 标准化状态字段
 */
function normalizeStatus(status: any): 'PENDING' | 'ACTIVE' | 'CLOSED' | 'EXPIRED' {
  const stat = String(status || '').toUpperCase();
  
  if (['PENDING', 'ACTIVE', 'CLOSED', 'EXPIRED'].includes(stat)) {
    return stat as 'PENDING' | 'ACTIVE' | 'CLOSED' | 'EXPIRED';
  }
  
  return 'PENDING';
}

/**
 * 标准化结果字段
 */
function normalizeResult(result: any): 'WIN' | 'LOSS' | 'BREAKEVEN' | null {
  if (!result) {
    return null;
  }
  
  const res = String(result).toUpperCase();
  
  if (['WIN', 'LOSS', 'BREAKEVEN'].includes(res)) {
    return res as 'WIN' | 'LOSS' | 'BREAKEVEN';
  }
  
  return null;
}

/**
 * 生成去重键
 * 基于时间桶、标的、方向和关键价格生成唯一标识
 */
export function generateDedupeKey(rec: NormalizedRecommendation, timeBucketMs: number = 5000): string {
  const timeBucket = generateTimeBucket(rec.created_at, timeBucketMs);
  
  const symbol = rec.symbol;
  const direction = rec.direction;
  const entryPrice = rec.entry_price ? (Math.round(rec.entry_price * 100) / 100).toFixed(2) : '';
  const takeProfit = rec.take_profit_price ? (Math.round(rec.take_profit_price * 100) / 100).toFixed(2) : '';
  const stopLoss = rec.stop_loss_price ? (Math.round(rec.stop_loss_price * 100) / 100).toFixed(2) : '';
  
  return `t${timeBucket}|${symbol}|${direction}|e${entryPrice}|tp${takeProfit}|sl${stopLoss}`;
}

/**
 * 去重推荐列表
 * 使用统一的去重逻辑
 */
export function deduplicateRecommendations(recommendations: any[]): NormalizedRecommendation[] {
  const dedupeMap = new Map<string, NormalizedRecommendation>();
  
  for (const rec of recommendations) {
    try {
      const normalized = normalizeRecommendationFields(rec);
      const dedupeKey = generateDedupeKey(normalized);
      
      const existing = dedupeMap.get(dedupeKey);
      if (!existing) {
        dedupeMap.set(dedupeKey, normalized);
      } else {
        // 保留更新的记录或置信度更高的记录
        const isNewer = normalized.created_at.getTime() > existing.created_at.getTime();
        const hasBetterConfidence = (normalized.confidence_score || 0) > (existing.confidence_score || 0);
        
        if (isNewer || (!isNewer && hasBetterConfidence)) {
          dedupeMap.set(dedupeKey, normalized);
        }
      }
    } catch (error) {
      console.warn('Failed to normalize recommendation:', error, rec);
    }
  }
  
  return Array.from(dedupeMap.values());
}

/**
 * 格式化推荐数据用于前端显示
 */
export function formatRecommendationForDisplay(rec: NormalizedRecommendation): {
  action: string;
  entry: string;
  leverage: string;
  confidence: string;
  takeProfit: string;
  stopLoss: string;
} {
  const action = rec.direction;
  const entry = rec.entry_price ? `$${rec.entry_price.toFixed(2)}` : '--';
  const leverage = rec.leverage ? `${rec.leverage}x` : '--';
  
  let confidence = '--';
  if (rec.confidence_score !== null && rec.confidence_score !== undefined) {
    const conf = rec.confidence_score <= 1 ? rec.confidence_score * 100 : rec.confidence_score;
    confidence = `${conf.toFixed(1)}%`;
  }
  
  const takeProfit = rec.take_profit_price ? `$${rec.take_profit_price.toFixed(2)}` : '--';
  const stopLoss = rec.stop_loss_price ? `$${rec.stop_loss_price.toFixed(2)}` : '--';
  
  return {
    action,
    entry,
    leverage,
    confidence,
    takeProfit,
    stopLoss
  };
}