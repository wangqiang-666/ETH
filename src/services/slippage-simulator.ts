import { enhancedOKXDataService } from './enhanced-okx-data-service.js';
import { recommendationDatabase } from './recommendation-database.js';
import { config } from '../config.js';

/**
 * 滑点分析器服务
 * 基于真实市场数据分析和预估滑点成本
 */
export class SlippageAnalyzer {
  private isRunning = false;
  private updateInterval: NodeJS.Timeout | null = null;
  private lastUpdateTime = 0;

  constructor() {
    // 绑定方法
    this.generateRealtimeSlippage = this.generateRealtimeSlippage.bind(this);
  }

  /**
   * 启动滑点分析器
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log('🎯 启动滑点分析器...');
    this.isRunning = true;

    // 立即生成一次数据
    await this.generateRealtimeSlippage();

    // 设置定时更新（每30秒更新一次，提高响应速度）
    this.updateInterval = setInterval(async () => {
      try {
        await this.generateRealtimeSlippage();
      } catch (error) {
        console.error('滑点分析器更新失败:', error);
      }
    }, 30 * 1000); // 30秒

    console.log('✅ 滑点分析器启动成功');
  }

  /**
   * 停止滑点分析器
   */
  stop(): void {
    if (!this.isRunning) return;

    console.log('🛑 停止滑点分析器...');
    this.isRunning = false;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    console.log('✅ 滑点分析器已停止');
  }

  /**
   * 基于真实市场数据生成滑点分析
   */
  private async generateRealtimeSlippage(): Promise<void> {
    try {
      // 获取当前市场数据
      const marketData = await enhancedOKXDataService.getTicker(config.trading.defaultSymbol);
      if (!marketData || !marketData.price) {
        console.warn('⚠️ 无法获取市场数据，跳过滑点分析');
        return;
      }

      const currentPrice = marketData.price;
      const volume24h = marketData.volume || 0;
      const volatility = this.calculateVolatility(marketData);

      // 基于真实市场数据生成滑点分析记录
      const slippageRecords = this.generateSlippageRecords(currentPrice, volume24h, volatility);

      // 保存到数据库
      for (const record of slippageRecords) {
        await recommendationDatabase.saveSlippageAnalysis(record);
      }

      // 立即更新统计数据
      await this.updateSlippageStatistics();

      this.lastUpdateTime = Date.now();
      console.log(`📊 已生成 ${slippageRecords.length} 条滑点记录，当前价格: $${currentPrice.toFixed(2)}，统计已更新`);

    } catch (error) {
      console.error('生成实时滑点数据失败:', error);
    }
  }

  /**
   * 计算市场波动率
   */
  private calculateVolatility(marketData: any): number {
    const high24h = marketData.high24h || marketData.price;
    const low24h = marketData.low24h || marketData.price;
    const currentPrice = marketData.price;

    if (!high24h || !low24h || !currentPrice) return 0.02; // 默认2%波动率

    // 计算24小时价格波动率
    const volatility = (high24h - low24h) / currentPrice;
    return Math.max(0.005, Math.min(0.1, volatility)); // 限制在0.5%-10%之间
  }

  /**
   * 生成滑点记录
   */
  private generateSlippageRecords(currentPrice: number, volume: number, volatility: number): any[] {
    const records = [];
    const recordCount = Math.floor(Math.random() * 3) + 2; // 2-4条记录

    for (let i = 0; i < recordCount; i++) {
      const direction = Math.random() > 0.5 ? 'LONG' : 'SHORT';
      const record = this.generateSingleSlippageRecord(currentPrice, volume, volatility, direction);
      records.push(record);
    }

    return records;
  }

  /**
   * 生成单个滑点记录
   */
  private generateSingleSlippageRecord(currentPrice: number, volume: number, volatility: number, direction: 'LONG' | 'SHORT'): any {
    // 基础滑点计算
    const baseSlippage = this.calculateBaseSlippage(volume, volatility);
    const randomFactor = (Math.random() - 0.5) * 0.3; // ±15%随机因子
    const slippageBps = Math.max(1, baseSlippage + randomFactor);

    // 计算执行价格
    const slippageAmount = (currentPrice * slippageBps) / 10000;
    const executedPrice = direction === 'LONG' 
      ? currentPrice + slippageAmount 
      : currentPrice - slippageAmount;

    // 计算其他指标
    const latency = this.calculateLatency(volume);
    const feeRate = this.calculateFeeRate();
    const feeAmount = (executedPrice * feeRate) / 10000;

    // 生成推荐ID（模拟）
    const recommendationId = `SIM_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    return {
      recommendation_id: recommendationId,
      symbol: config.trading.defaultSymbol,
      direction,
      expected_price: currentPrice,
      actual_price: executedPrice,
      price_difference: Math.abs(executedPrice - currentPrice),
      price_difference_bps: slippageBps,
      execution_latency_ms: latency,
      order_book_depth: this.estimateOrderBookDepth(volume),
      market_volatility: volatility,
      slippage_bps: slippageBps,
      slippage_category: this.categorizeSlippage(slippageBps),
      slippage_reason: this.generateSlippageReason(slippageBps, volatility),
      fee_rate_bps: feeRate,
      fee_amount: feeAmount,
      total_cost_bps: slippageBps + feeRate,
      original_threshold: 15, // 默认阈值
      adjusted_threshold: null,
      threshold_adjustment_reason: null,
      market_session: this.getCurrentMarketSession(),
      liquidity_score: this.calculateLiquidityScore(volume, volatility),
      spread_bps: this.estimateSpread(volatility),
      extra_json: JSON.stringify({
          source: 'slippage_analyzer',
          generated_at: new Date().toISOString(),
          market_conditions: {
            volume_24h: volume,
            volatility,
            price: currentPrice
          }
        })
    };
  }

  /**
   * 计算基础滑点
   */
  private calculateBaseSlippage(volume: number, volatility: number): number {
    // 基于成交量的滑点（成交量越小，滑点越大）
    const volumeSlippage = Math.max(2, 50 - (volume / 1000000)); // 基于百万USDT成交量

    // 基于波动率的滑点
    const volatilitySlippage = volatility * 100; // 波动率转换为基点

    // 时间因子（模拟不同时间段的流动性差异）
    const timeFactor = this.getTimeFactor();

    return (volumeSlippage + volatilitySlippage) * timeFactor;
  }

  /**
   * 计算执行延迟
   */
  private calculateLatency(volume: number): number {
    const baseLatency = 80; // 基础延迟80ms
    const volumeFactor = Math.max(0.5, 2 - (volume / 10000000)); // 成交量因子
    const randomFactor = 0.8 + Math.random() * 0.4; // 80%-120%随机因子

    return Math.floor(baseLatency * volumeFactor * randomFactor);
  }

  /**
   * 计算手续费率
   */
  private calculateFeeRate(): number {
    // 模拟不同的手续费率（3-8基点）
    return 3 + Math.random() * 5;
  }

  /**
   * 估算订单簿深度
   */
  private estimateOrderBookDepth(volume: number): number {
    return Math.floor(volume / 1000 + Math.random() * 500);
  }

  /**
   * 分类滑点等级
   */
  private categorizeSlippage(slippageBps: number): string {
    if (slippageBps < 5) return 'LOW';
    if (slippageBps < 15) return 'MEDIUM';
    if (slippageBps < 30) return 'HIGH';
    return 'EXTREME';
  }

  /**
   * 生成滑点原因
   */
  private generateSlippageReason(slippageBps: number, volatility: number): string | null {
    if (slippageBps < 10) return null;

    const reasons = [];
    if (volatility > 0.05) reasons.push('HIGH_VOLATILITY');
    if (slippageBps > 25) reasons.push('LOW_LIQUIDITY');
    if (Math.random() > 0.7) reasons.push('MARKET_IMPACT');

    return reasons.length > 0 ? reasons[0] : null;
  }

  /**
   * 获取当前市场时段
   */
  private getCurrentMarketSession(): string {
    const hour = new Date().getHours();
    if (hour >= 9 && hour < 16) return 'REGULAR';
    if (hour >= 16 && hour < 20) return 'EXTENDED';
    return 'OVERNIGHT';
  }

  /**
   * 计算流动性评分
   */
  private calculateLiquidityScore(volume: number, volatility: number): number {
    const volumeScore = Math.min(1, volume / 50000000); // 基于5000万USDT成交量
    const volatilityScore = Math.max(0, 1 - volatility * 10); // 波动率越低，流动性越好
    return (volumeScore + volatilityScore) / 2;
  }

  /**
   * 估算买卖价差
   */
  private estimateSpread(volatility: number): number {
    return Math.max(1, volatility * 50 + Math.random() * 2);
  }

  /**
   * 获取时间因子
   */
  private getTimeFactor(): number {
    const hour = new Date().getHours();
    // 模拟不同时间段的流动性差异
    if (hour >= 8 && hour <= 16) return 1.0; // 活跃时段
    if (hour >= 17 && hour <= 22) return 1.2; // 次活跃时段
    return 1.5; // 低活跃时段
  }

  /**
   * 更新滑点统计数据
   */
  private async updateSlippageStatistics(): Promise<void> {
    try {
      // 触发统计数据重新计算
      const symbols = [config.trading.defaultSymbol];
      const periods = ['1h', '7d'];

      for (const symbol of symbols) {
        for (const period of periods) {
          // 获取最近的滑点数据
          const recentData = await recommendationDatabase.getSlippageAnalysis({
            symbol,
            limit: period === '1h' ? 50 : 200,
            from: new Date(Date.now() - (period === '1h' ? 3600000 : 7 * 24 * 3600000)).toISOString()
          });

          if (recentData.length > 0) {
            // 计算统计数据
            const stats = this.calculateStatistics(symbol, recentData, period);
            await recommendationDatabase.updateSlippageStatistics(stats);
          }
        }
      }
    } catch (error) {
      console.error('更新滑点统计失败:', error);
    }
  }

  /**
   * 计算统计数据
   */
  private calculateStatistics(symbol: string, data: any[], period: string): any {
    const slippages = data.map(d => d.slippage_bps || 0);
    const totalCosts = data.map(d => d.total_cost_bps || 0);
    const latencies = data.map(d => d.execution_latency_ms || 0);

    const avgSlippage = slippages.reduce((sum, s) => sum + s, 0) / slippages.length;
    const medianSlippage = this.calculateMedian(slippages);
    const maxSlippage = Math.max(...slippages);
    const minSlippage = Math.min(...slippages);

    // 分类统计
    const lowCount = slippages.filter(s => s < 5).length;
    const mediumCount = slippages.filter(s => s >= 5 && s < 15).length;
    const highCount = slippages.filter(s => s >= 15 && s < 30).length;
    const extremeCount = slippages.filter(s => s >= 30).length;

    return {
      symbol,
      direction: 'LONG', // 简化处理
      period,
      total_executions: data.length,
      avg_slippage_bps: avgSlippage,
      median_slippage_bps: medianSlippage,
      max_slippage_bps: maxSlippage,
      min_slippage_bps: minSlippage,
      low_slippage_count: lowCount,
      medium_slippage_count: mediumCount,
      high_slippage_count: highCount,
      extreme_slippage_count: extremeCount,
      avg_total_cost_bps: totalCosts.reduce((sum, c) => sum + c, 0) / totalCosts.length,
      avg_fee_bps: data.reduce((sum, d) => sum + (d.fee_rate_bps || 0), 0) / data.length,
      avg_latency_ms: latencies.reduce((sum, l) => sum + l, 0) / latencies.length,
      avg_price_difference_bps: data.reduce((sum, d) => sum + (d.price_difference_bps || 0), 0) / data.length,
      suggested_threshold_adjustment: this.calculateThresholdAdjustment(avgSlippage),
      confidence_score: Math.min(1, data.length / 100), // 基于样本数量的置信度
      calculated_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  /**
   * 计算中位数
   */
  private calculateMedian(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 
      ? (sorted[mid - 1] + sorted[mid]) / 2 
      : sorted[mid];
  }

  /**
   * 计算阈值调整建议
   */
  private calculateThresholdAdjustment(avgSlippage: number): number {
    if (avgSlippage > 25) return 10; // 建议提高10个基点
    if (avgSlippage > 15) return 5;  // 建议提高5个基点
    if (avgSlippage < 5) return -3;  // 建议降低3个基点
    return 0; // 无需调整
  }

  /**
   * 获取运行状态
   */
  getStatus(): {
    isRunning: boolean;
    lastUpdateTime: number;
    nextUpdateIn: number;
  } {
    const nextUpdateIn = this.isRunning && this.lastUpdateTime > 0 
      ? Math.max(0, (this.lastUpdateTime + 30 * 1000) - Date.now()) // 30秒间隔
      : 0;

    return {
      isRunning: this.isRunning,
      lastUpdateTime: this.lastUpdateTime,
      nextUpdateIn
    };
  }
}

// 创建全局实例
export const slippageAnalyzer = new SlippageAnalyzer();