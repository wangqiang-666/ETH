import path from 'path';
import fs from 'fs';

/**
 * 交易记录接口
 */
export interface TradeRecord {
  id: string;
  timestamp: number;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  fees: number;
  holdingTime: number;
  exitReason: string;
  createdAt: number;
}

/**
 * 订单记录接口
 */
export interface OrderRecord {
  id: string;
  timestamp: number;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  orderType: 'MAKER' | 'TAKER';
  price: number;
  quantity: number;
  status: 'PENDING' | 'FILLED' | 'CANCELLED' | 'TIMEOUT';
  fee: number;
  createdAt: number;
  filledAt?: number;
}

/**
 * 信号记录接口
 */
export interface SignalRecord {
  id: string;
  timestamp: number;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  reason: string;
  indicators: string; // JSON字符串
  executed: boolean;
  createdAt: number;
}

/**
 * 数据库服务
 * 负责存储交易数据、订单记录和信号记录
 * 使用JSON文件存储，简化部署
 */
export class DatabaseService {
  private dataDir: string;
  private tradesFile: string;
  private ordersFile: string;
  private signalsFile: string;

  constructor() {
    // 确保数据目录存在
    this.dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    
    this.tradesFile = path.join(this.dataDir, 'trades.json');
    this.ordersFile = path.join(this.dataDir, 'orders.json');
    this.signalsFile = path.join(this.dataDir, 'signals.json');
  }

  /**
   * 初始化数据库连接
   */
  async initialize(): Promise<void> {
    try {
      // 创建初始文件
      this.ensureFileExists(this.tradesFile, []);
      this.ensureFileExists(this.ordersFile, []);
      this.ensureFileExists(this.signalsFile, []);
      
      console.log('✅ 数据库初始化完成');
    } catch (error) {
      console.error('❌ 数据库初始化失败:', error);
      throw error;
    }
  }

  /**
   * 确保文件存在
   */
  private ensureFileExists(filePath: string, defaultData: any): void {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
    }
  }

  /**
   * 读取JSON文件
   */
  private readJsonFile(filePath: string): any[] {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`读取文件失败: ${filePath}`, error);
      return [];
    }
  }

  /**
   * 写入JSON文件
   */
  private writeJsonFile(filePath: string, data: any[]): void {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`写入文件失败: ${filePath}`, error);
      throw error;
    }
  }

  /**
   * 保存交易记录
   */
  async saveTrade(trade: TradeRecord): Promise<void> {
    try {
      const trades = this.readJsonFile(this.tradesFile);
      
      // 查找是否已存在，如果存在则更新，否则添加
      const existingIndex = trades.findIndex((t: TradeRecord) => t.id === trade.id);
      if (existingIndex >= 0) {
        trades[existingIndex] = trade;
      } else {
        trades.push(trade);
      }
      
      this.writeJsonFile(this.tradesFile, trades);
    } catch (error) {
      console.error('保存交易记录失败:', error);
      throw error;
    }
  }

  /**
   * 保存订单记录
   */
  async saveOrder(order: OrderRecord): Promise<void> {
    try {
      const orders = this.readJsonFile(this.ordersFile);
      
      // 查找是否已存在，如果存在则更新，否则添加
      const existingIndex = orders.findIndex((o: OrderRecord) => o.id === order.id);
      if (existingIndex >= 0) {
        orders[existingIndex] = order;
      } else {
        orders.push(order);
      }
      
      this.writeJsonFile(this.ordersFile, orders);
    } catch (error) {
      console.error('保存订单记录失败:', error);
      throw error;
    }
  }

  /**
   * 保存信号记录
   */
  async saveSignal(signal: SignalRecord): Promise<void> {
    try {
      const signals = this.readJsonFile(this.signalsFile);
      
      // 查找是否已存在，如果存在则更新，否则添加
      const existingIndex = signals.findIndex((s: SignalRecord) => s.id === signal.id);
      if (existingIndex >= 0) {
        signals[existingIndex] = signal;
      } else {
        signals.push(signal);
      }
      
      this.writeJsonFile(this.signalsFile, signals);
    } catch (error) {
      console.error('保存信号记录失败:', error);
      throw error;
    }
  }

  /**
   * 获取交易统计
   */
  async getTradeStats(): Promise<any> {
    try {
      const trades = this.readJsonFile(this.tradesFile) as TradeRecord[];
      
      if (trades.length === 0) {
        return {
          totalTrades: 0,
          successfulTrades: 0,
          totalPnl: 0,
          totalFees: 0,
          avgPnl: 0,
          maxProfit: 0,
          maxLoss: 0,
          avgHoldingTime: 0
        };
      }

      const totalTrades = trades.length;
      const successfulTrades = trades.filter(t => t.pnl > 0).length;
      const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
      const totalFees = trades.reduce((sum, t) => sum + t.fees, 0);
      const avgPnl = totalPnl / totalTrades;
      const maxProfit = Math.max(...trades.map(t => t.pnl));
      const maxLoss = Math.min(...trades.map(t => t.pnl));
      const avgHoldingTime = trades.reduce((sum, t) => sum + t.holdingTime, 0) / totalTrades;

      return {
        totalTrades,
        successfulTrades,
        totalPnl,
        totalFees,
        avgPnl,
        maxProfit,
        maxLoss,
        avgHoldingTime
      };
    } catch (error) {
      console.error('获取交易统计失败:', error);
      return {
        totalTrades: 0,
        successfulTrades: 0,
        totalPnl: 0,
        totalFees: 0,
        avgPnl: 0,
        maxProfit: 0,
        maxLoss: 0,
        avgHoldingTime: 0
      };
    }
  }

  /**
   * 获取最近的交易记录
   */
  async getRecentTrades(limit: number = 10): Promise<TradeRecord[]> {
    try {
      const trades = this.readJsonFile(this.tradesFile) as TradeRecord[];
      return trades
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
    } catch (error) {
      console.error('获取最近交易记录失败:', error);
      return [];
    }
  }

  /**
   * 获取活跃订单
   */
  async getActiveOrders(): Promise<OrderRecord[]> {
    try {
      const orders = this.readJsonFile(this.ordersFile) as OrderRecord[];
      return orders
        .filter(o => o.status === 'PENDING')
        .sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('获取活跃订单失败:', error);
      return [];
    }
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    // JSON文件存储不需要关闭连接
    console.log('✅ 数据库服务已关闭');
  }
}