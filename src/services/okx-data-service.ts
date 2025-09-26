import axios, { AxiosInstance } from 'axios';

// MarketData接口定义
export interface MarketData {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

// OKX API响应接口
export interface OKXTickerResponse {
  code: string;
  msg: string;
  data: Array<{
    instType: string;
    instId: string;
    last: string;
    lastSz: string;
    askPx: string;
    askSz: string;
    bidPx: string;
    bidSz: string;
    open24h: string;
    high24h: string;
    low24h: string;
    volCcy24h: string;
    vol24h: string;
    sodUtc0: string;
    sodUtc8: string;
    ts: string;
  }>;
}

export interface OKXKlineResponse {
  code: string;
  msg: string;
  data: Array<[
    string, // timestamp
    string, // open
    string, // high
    string, // low
    string, // close
    string, // volume
    string, // volCcy
    string, // volCcyQuote
    string  // confirm
  ]>;
}

// K线数据接口
export interface KlineData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

/**
 * OKX数据服务
 */
export class OKXDataService {
  private apiClient: AxiosInstance;
  private proxyClient: AxiosInstance | null = null;
  private useProxy: boolean;
  private rateLimitDelay = 500;
  private lastRequestTime = 0;

  private isExternalDisabled(): boolean {
    return false; // 简化实现
  }

  constructor() {
    this.useProxy = false; // 简化配置
    
    // 初始化API客户端
    this.apiClient = axios.create({
      baseURL: 'https://www.okx.com',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.rateLimitDelay) {
      const waitTime = this.rateLimitDelay - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  async getTicker(symbol: string = 'ETH-USDT-SWAP'): Promise<MarketData | null> {
    try {
      await this.waitForRateLimit();
      
      if (this.isExternalDisabled()) {
        return null;
      }

      const response = await this.apiClient.get('/api/v5/market/ticker', {
        params: { instId: symbol }
      });

      if (response.data.code === '0' && response.data.data.length > 0) {
        const data = response.data.data[0];
        return {
          symbol,
          price: parseFloat(data.last),
          change24h: parseFloat(data.open24h) > 0 ? 
            ((parseFloat(data.last) - parseFloat(data.open24h)) / parseFloat(data.open24h)) * 100 : 0,
          volume24h: parseFloat(data.vol24h),
          high24h: parseFloat(data.high24h),
          low24h: parseFloat(data.low24h),
          timestamp: parseInt(data.ts)
        };
      }

      return null;
    } catch (error) {
      console.error('获取ticker数据失败:', error);
      return null;
    }
  }

  async getKlineData(
    symbol: string = 'ETH-USDT-SWAP',
    interval: string = '1m',
    limit: number = 100
  ): Promise<KlineData[]> {
    try {
      await this.waitForRateLimit();
      
      if (this.isExternalDisabled()) {
        return [];
      }

      const response = await this.apiClient.get('/api/v5/market/candles', {
        params: {
          instId: symbol,
          bar: interval,
          limit: limit.toString()
        }
      });

      if (response.data.code === '0') {
        return response.data.data.map((item: string[]) => ({
          timestamp: parseInt(item[0]),
          open: parseFloat(item[1]),
          high: parseFloat(item[2]),
          low: parseFloat(item[3]),
          close: parseFloat(item[4]),
          volume: parseFloat(item[5]),
          turnover: parseFloat(item[6])
        })).reverse(); // OKX返回的数据是倒序的
      }

      return [];
    } catch (error) {
      console.error('获取K线数据失败:', error);
      return [];
    }
  }

  async getOrderBook(symbol: string = 'ETH-USDT-SWAP', depth: number = 20): Promise<{
    bids: Array<[number, number]>;
    asks: Array<[number, number]>;
    timestamp: number;
  } | null> {
    try {
      await this.waitForRateLimit();

      const response = await this.apiClient.get('/api/v5/market/books', {
        params: {
          instId: symbol,
          sz: depth.toString()
        }
      });

      if (response.data.code === '0' && response.data.data.length > 0) {
        const data = response.data.data[0];
        return {
          bids: data.bids.map((bid: string[]) => [parseFloat(bid[0]), parseFloat(bid[1])]),
          asks: data.asks.map((ask: string[]) => [parseFloat(ask[0]), parseFloat(ask[1])]),
          timestamp: parseInt(data.ts)
        };
      }

      return null;
    } catch (error) {
      console.error('获取订单簿失败:', error);
      return null;
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await this.apiClient.get('/api/v5/public/time');
      return response.data.code === '0';
    } catch (error) {
      console.error('连接检查失败:', error);
      return false;
    }
  }

  setRateLimitDelay(delay: number): void {
    this.rateLimitDelay = delay;
  }

  getConfig() {
    return {
      useProxy: this.useProxy,
      baseUrl: this.apiClient.defaults.baseURL,
      timeout: this.apiClient.defaults.timeout,
      rateLimitDelay: this.rateLimitDelay
    };
  }
}

export const okxDataService = new OKXDataService();