import WebSocket from 'ws';
import crypto from 'crypto';
import axios from 'axios';
import { EventEmitter } from 'events';

export interface BinanceConfig {
  apiKey: string;
  apiSecret: string;
  testnet?: boolean;
  recvWindow?: number;
}

export interface KlineData {
  symbol: string;
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  trades: number;
  interval: string;
  isFinal: boolean;
}

export interface OrderData {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  timeInForce: string;
  type: string;
  side: string;
  fills: Array<{
    price: string;
    qty: string;
    commission: string;
    commissionAsset: string;
  }>;
}

export interface AccountInfo {
  makerCommission: number;
  takerCommission: number;
  buyerCommission: number;
  sellerCommission: number;
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  balances: Array<{
    asset: string;
    free: string;
    locked: string;
  }>;
}

export interface TickerData {
  symbol: string;
  price: string;
  priceChange: string;
  priceChangePercent: string;
  volume: string;
  count: number;
}

export class BinanceApiService extends EventEmitter {
  private config: BinanceConfig;
  private baseUrl: string;
  private wsBaseUrl: string;
  private dataWs: WebSocket | null = null;
  private userWs: WebSocket | null = null;
  private listenKey: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(config: BinanceConfig) {
    super();
    this.config = config;
    this.baseUrl = config.testnet 
      ? 'https://testnet.binance.vision/api'
      : 'https://api.binance.com/api';
    this.wsBaseUrl = config.testnet
      ? 'wss://testnet.binance.vision/ws'
      : 'wss://stream.binance.com:9443/ws';
    
    console.log(`🔗 币安API服务初始化 ${config.testnet ? '(测试网)' : '(主网)'}`);
  }

  /**
   * 生成签名
   */
  private generateSignature(queryString: string): string {
    return crypto
      .createHmac('sha256', this.config.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  /**
   * 创建认证请求头
   */
  private createAuthHeaders(): Record<string, string> {
    return {
      'X-MBX-APIKEY': this.config.apiKey,
      'Content-Type': 'application/json',
    };
  }

  /**
   * 发送认证请求
   */
  private async makeAuthenticatedRequest(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    params: Record<string, any> = {}
  ): Promise<any> {
    const timestamp = Date.now();
    const queryString = new URLSearchParams({
      ...params,
      timestamp: timestamp.toString(),
      recvWindow: (this.config.recvWindow || 5000).toString(),
    }).toString();

    const signature = this.generateSignature(queryString);
    const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;

    try {
      const response = await axios({
        method,
        url,
        headers: this.createAuthHeaders(),
      });
      return response.data;
    } catch (error: any) {
      console.error(`❌ 币安API请求失败: ${endpoint}`, error.response?.data || error.message);
      throw new Error(`Binance API Error: ${error.response?.data?.msg || error.message}`);
    }
  }

  /**
   * 获取账户信息
   */
  async getAccountInfo(): Promise<AccountInfo> {
    console.log('📊 获取账户信息...');
    return await this.makeAuthenticatedRequest('GET', '/v3/account');
  }

  /**
   * 获取账户余额
   */
  async getBalance(asset?: string): Promise<any> {
    const accountInfo = await this.getAccountInfo();
    if (asset) {
      const balance = accountInfo.balances.find(b => b.asset === asset);
      return balance || { asset, free: '0', locked: '0' };
    }
    return accountInfo.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
  }

  /**
   * 获取交易对信息
   */
  async getExchangeInfo(symbol?: string): Promise<any> {
    const url = `${this.baseUrl}/v3/exchangeInfo${symbol ? `?symbol=${symbol}` : ''}`;
    const response = await axios.get(url);
    return response.data;
  }

  /**
   * 获取最新价格
   */
  async getPrice(symbol: string): Promise<TickerData> {
    const url = `${this.baseUrl}/v3/ticker/24hr?symbol=${symbol}`;
    const response = await axios.get(url);
    return response.data;
  }

  /**
   * 获取历史K线数据
   */
  async getKlines(
    symbol: string,
    interval: string,
    limit: number = 500,
    startTime?: number,
    endTime?: number
  ): Promise<any[]> {
    const params: any = { symbol, interval, limit };
    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;

    const url = `${this.baseUrl}/v3/klines`;
    const response = await axios.get(url, { params });
    return response.data;
  }

  /**
   * 下单
   */
  async createOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'STOP_LOSS_LIMIT' | 'TAKE_PROFIT' | 'TAKE_PROFIT_LIMIT';
    quantity?: string;
    quoteOrderQty?: string;
    price?: string;
    stopPrice?: string;
    timeInForce?: 'GTC' | 'IOC' | 'FOK';
    newClientOrderId?: string;
  }): Promise<OrderData> {
    console.log(`📝 创建订单: ${params.side} ${params.quantity || params.quoteOrderQty} ${params.symbol}`);
    return await this.makeAuthenticatedRequest('POST', '/v3/order', params);
  }

  /**
   * 取消订单
   */
  async cancelOrder(symbol: string, orderId?: number, origClientOrderId?: string): Promise<any> {
    const params: any = { symbol };
    if (orderId) params.orderId = orderId;
    if (origClientOrderId) params.origClientOrderId = origClientOrderId;

    console.log(`❌ 取消订单: ${symbol} ${orderId || origClientOrderId}`);
    return await this.makeAuthenticatedRequest('DELETE', '/v3/order', params);
  }

  /**
   * 获取订单状态
   */
  async getOrder(symbol: string, orderId?: number, origClientOrderId?: string): Promise<any> {
    const params: any = { symbol };
    if (orderId) params.orderId = orderId;
    if (origClientOrderId) params.origClientOrderId = origClientOrderId;

    return await this.makeAuthenticatedRequest('GET', '/v3/order', params);
  }

  /**
   * 获取开放订单
   */
  async getOpenOrders(symbol?: string): Promise<any[]> {
    const params = symbol ? { symbol } : {};
    return await this.makeAuthenticatedRequest('GET', '/v3/openOrders', params);
  }

  /**
   * 获取用户数据流监听密钥
   */
  private async createListenKey(): Promise<string> {
    const response = await axios.post(
      `${this.baseUrl}/v3/userDataStream`,
      {},
      { headers: this.createAuthHeaders() }
    );
    return response.data.listenKey;
  }

  /**
   * 保持用户数据流活跃
   */
  private async keepAliveListenKey(listenKey: string): Promise<void> {
    await axios.put(
      `${this.baseUrl}/v3/userDataStream`,
      { listenKey },
      { headers: this.createAuthHeaders() }
    );
  }

  /**
   * 连接实时数据流
   */
  async connectDataStream(symbols: string[], intervals: string[] = ['1m']): Promise<void> {
    console.log(`🔌 连接实时数据流: ${symbols.join(', ')}`);
    
    const streams = symbols.flatMap(symbol =>
      intervals.map(interval => `${symbol.toLowerCase()}@kline_${interval}`)
    );
    
    const wsUrl = `${this.wsBaseUrl}/${streams.join('/')}`;
    
    this.dataWs = new WebSocket(wsUrl);
    
    this.dataWs.on('open', () => {
      console.log('✅ 数据流连接成功');
      this.reconnectAttempts = 0;
      this.emit('dataStreamConnected');
    });
    
    this.dataWs.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.stream && message.data) {
          this.handleKlineData(message.data);
        }
      } catch (error) {
        console.error('❌ 数据流消息解析失败:', error);
      }
    });
    
    this.dataWs.on('close', () => {
      console.log('⚠️ 数据流连接断开');
      this.emit('dataStreamDisconnected');
      this.reconnectDataStream(symbols, intervals);
    });
    
    this.dataWs.on('error', (error: Error) => {
      console.error('❌ 数据流连接错误:', error);
      this.emit('dataStreamError', error);
    });
  }

  /**
   * 连接用户数据流
   */
  async connectUserStream(): Promise<void> {
    console.log('🔌 连接用户数据流...');
    
    try {
      this.listenKey = await this.createListenKey();
      const wsUrl = `${this.wsBaseUrl}/${this.listenKey}`;
      
      this.userWs = new WebSocket(wsUrl);
      
      this.userWs.on('open', () => {
        console.log('✅ 用户数据流连接成功');
        this.emit('userStreamConnected');
        
        // 每30分钟保持连接活跃
        this.pingInterval = setInterval(() => {
          if (this.listenKey) {
            this.keepAliveListenKey(this.listenKey).catch(console.error);
          }
        }, 30 * 60 * 1000);
      });
      
      this.userWs.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleUserData(message);
        } catch (error) {
          console.error('❌ 用户数据流消息解析失败:', error);
        }
      });
      
      this.userWs.on('close', () => {
        console.log('⚠️ 用户数据流连接断开');
        this.emit('userStreamDisconnected');
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        this.reconnectUserStream();
      });
      
      this.userWs.on('error', (error: Error) => {
        console.error('❌ 用户数据流连接错误:', error);
        this.emit('userStreamError', error);
      });
      
    } catch (error) {
      console.error('❌ 创建用户数据流失败:', error);
      throw error;
    }
  }

  /**
   * 处理K线数据
   */
  private handleKlineData(data: any): void {
    const kline: KlineData = {
      symbol: data.s,
      openTime: data.k.t,
      closeTime: data.k.T,
      open: data.k.o,
      high: data.k.h,
      low: data.k.l,
      close: data.k.c,
      volume: data.k.v,
      trades: data.k.n,
      interval: data.k.i,
      isFinal: data.k.x,
    };
    
    this.emit('kline', kline);
  }

  /**
   * 处理用户数据
   */
  private handleUserData(data: any): void {
    switch (data.e) {
      case 'executionReport':
        this.emit('orderUpdate', {
          symbol: data.s,
          orderId: data.i,
          clientOrderId: data.c,
          side: data.S,
          type: data.o,
          status: data.X,
          executedQty: data.z,
          price: data.p,
          stopPrice: data.P,
          timeInForce: data.f,
        });
        break;
      case 'outboundAccountPosition':
        this.emit('balanceUpdate', {
          asset: data.a,
          free: data.f,
          locked: data.l,
        });
        break;
      default:
        this.emit('userData', data);
    }
  }

  /**
   * 重连数据流
   */
  private reconnectDataStream(symbols: string[], intervals: string[]): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ 数据流重连次数超限，停止重连');
      return;
    }
    
    this.reconnectAttempts++;
    console.log(`🔄 ${this.reconnectDelay / 1000}秒后重连数据流 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connectDataStream(symbols, intervals).catch(console.error);
    }, this.reconnectDelay);
  }

  /**
   * 重连用户数据流
   */
  private reconnectUserStream(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ 用户数据流重连次数超限，停止重连');
      return;
    }
    
    this.reconnectAttempts++;
    console.log(`🔄 ${this.reconnectDelay / 1000}秒后重连用户数据流 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connectUserStream().catch(console.error);
    }, this.reconnectDelay);
  }

  /**
   * 断开所有连接
   */
  disconnect(): void {
    console.log('🔌 断开所有连接...');
    
    if (this.dataWs) {
      this.dataWs.close();
      this.dataWs = null;
    }
    
    if (this.userWs) {
      this.userWs.close();
      this.userWs = null;
    }
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    this.emit('disconnected');
  }

  /**
   * 获取连接状态
   */
  getConnectionStatus(): {
    dataStream: boolean;
    userStream: boolean;
  } {
    return {
      dataStream: this.dataWs?.readyState === WebSocket.OPEN,
      userStream: this.userWs?.readyState === WebSocket.OPEN,
    };
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/v3/ping`;
      await axios.get(url);
      console.log('✅ 币安API连接测试成功');
      return true;
    } catch (error) {
      console.error('❌ 币安API连接测试失败:', error);
      return false;
    }
  }

  /**
   * 获取服务器时间
   */
  async getServerTime(): Promise<number> {
    const url = `${this.baseUrl}/v3/time`;
    const response = await axios.get(url);
    return response.data.serverTime;
  }
}

export default BinanceApiService;