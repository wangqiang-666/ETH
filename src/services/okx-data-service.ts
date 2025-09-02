import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { MarketData } from '../ml/ml-analyzer';

// 重新导出MarketData接口
export type { MarketData };

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

export interface OKXFundingRateResponse {
  code: string;
  msg: string;
  data: Array<{
    instType: string;
    instId: string;
    fundingRate: string;
    nextFundingRate: string;
    fundingTime: string;
    nextFundingTime: string;
  }>;
}

export interface OKXOpenInterestResponse {
  code: string;
  msg: string;
  data: Array<{
    instType: string;
    instId: string;
    oi: string;
    oiCcy: string;
    ts: string;
  }>;
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

// 合约信息接口
export interface ContractInfo {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  nextFundingTime: number;
  openInterest: number;
  volume24h: number;
  turnover24h: number;
  priceChange24h: number;
  priceChangePercent24h: number;
}

// OKX数据服务类
export class OKXDataService {
  private apiClient: AxiosInstance;
  private proxyClient: AxiosInstance | null = null;
  private useProxy: boolean;
  private rateLimitDelay = 100; // 请求间隔，避免触发限流
  private lastRequestTime = 0;

  constructor() {
    // 当 forceOnly 为 true 时，始终走代理
    this.useProxy = (config.proxy.forceOnly || config.okx.useProxy);
    
    // 初始化API客户端
    this.apiClient = axios.create({
      baseURL: config.okx.baseUrl,
      timeout: config.okx.timeout,
      headers: {
        'Content-Type': 'application/json',
        'OK-ACCESS-KEY': config.okx.apiKey,
        'OK-ACCESS-SIGN': '', // 需要根据请求计算
        'OK-ACCESS-TIMESTAMP': '',
        'OK-ACCESS-PASSPHRASE': config.okx.passphrase
      }
    });

    // 如果使用代理，初始化代理客户端
    if (this.useProxy && config.proxy.enabled) {
      this.proxyClient = axios.create({
        baseURL: config.proxy.baseUrl,
        timeout: config.okx.timeout,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
  }

  // 等待请求间隔
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.rateLimitDelay) {
      await new Promise(resolve => 
        setTimeout(resolve, this.rateLimitDelay - timeSinceLastRequest)
      );
    }
    
    this.lastRequestTime = Date.now();
  }

  // 获取Ticker数据
  async getTicker(symbol: string = 'ETH-USDT-SWAP'): Promise<MarketData | null> {
    try {
      await this.waitForRateLimit();
      
      let response: OKXTickerResponse;
      
      if (this.useProxy && this.proxyClient) {
        // 使用代理服务
        const proxyResponse = await this.proxyClient.get(`/api/v5/market/ticker?instId=${symbol}`);
        response = proxyResponse.data;
      } else {
        // 直接调用OKX API
        const apiResponse = await this.apiClient.get(`/api/v5/market/ticker?instId=${symbol}`);
        response = apiResponse.data;
      }

      if (response.code !== '0' || !response.data || response.data.length === 0) {
        console.error('Invalid ticker response:', response);
        return null;
      }

      const ticker = response.data[0];
      
      const baseOpen = parseFloat(ticker.sodUtc8 || ticker.open24h);
      const open24hPrice = parseFloat(ticker.open24h);
      const sodUtc8Price = ticker.sodUtc8 ? parseFloat(ticker.sodUtc8) : undefined;
      const changeFromSodUtc8 = ((parseFloat(ticker.last) - baseOpen) / baseOpen) * 100;
      return {
        price: parseFloat(ticker.last),
        volume: parseFloat(ticker.vol24h),
        timestamp: parseInt(ticker.ts),
        high24h: parseFloat(ticker.high24h),
        low24h: parseFloat(ticker.low24h),
        change24h: ((parseFloat(ticker.last) - open24hPrice) / open24hPrice) * 100,
        changeFromSodUtc8,
        open24hPrice,
        sodUtc8Price
      };

    } catch (error) {
      console.error('Failed to fetch ticker data:', error);
      return null;
    }
  }

  // 获取K线数据
  async getKlineData(
    symbol: string = 'ETH-USDT-SWAP',
    interval: string = '1m',
    limit: number = 100
  ): Promise<KlineData[]> {
    try {
      await this.waitForRateLimit();
      
      let response: OKXKlineResponse;
      
      if (this.useProxy && this.proxyClient) {
        // 使用代理服务
        const proxyResponse = await this.proxyClient.get(
          `/api/v5/market/candles?instId=${symbol}&bar=${interval}&limit=${limit}`
        );
        response = proxyResponse.data;
      } else {
        // 直接调用OKX API
        const apiResponse = await this.apiClient.get(
          `/api/v5/market/candles?instId=${symbol}&bar=${interval}&limit=${limit}`
        );
        response = apiResponse.data;
      }

      if (response.code !== '0' || !response.data) {
        console.error('Invalid kline response:', response);
        return [];
      }

      // OKX返回的数据按时间倒序（最新在前）。当启用 closedOnly 时，过滤掉未收盘的K线（confirm==="0"）。
      const rawKlines = config.indicators.closedOnly
        ? response.data.filter(k => k[8] === '1')
        : response.data;

      return rawKlines.map(kline => ({
        timestamp: parseInt(kline[0]),
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5]),
        turnover: parseFloat(kline[6])
      })).reverse(); // OKX返回的数据是倒序的，需要反转

    } catch (error) {
      console.error('Failed to fetch kline data:', error);
      return [];
    }
  }

  // 获取资金费率
  async getFundingRate(symbol: string = 'ETH-USDT-SWAP'): Promise<number | null> {
    try {
      await this.waitForRateLimit();
      
      let response: OKXFundingRateResponse;
      
      if (this.useProxy && this.proxyClient) {
        const proxyResponse = await this.proxyClient.get(
          `/api/v5/public/funding-rate?instId=${symbol}`
        );
        response = proxyResponse.data;
      } else {
        const apiResponse = await this.apiClient.get(
          `/api/v5/public/funding-rate?instId=${symbol}`
        );
        response = apiResponse.data;
      }

      if (response.code !== '0' || !response.data || response.data.length === 0) {
        console.error('Invalid funding rate response:', response);
        return null;
      }

      return parseFloat(response.data[0].fundingRate);

    } catch (error) {
      console.error('Failed to fetch funding rate:', error);
      return null;
    }
  }

  // 获取持仓量
  async getOpenInterest(symbol: string = 'ETH-USDT-SWAP'): Promise<number | null> {
    try {
      await this.waitForRateLimit();
      
      let response: OKXOpenInterestResponse;
      
      if (this.useProxy && this.proxyClient) {
        const proxyResponse = await this.proxyClient.get(
          `/api/v5/public/open-interest?instId=${symbol}`
        );
        response = proxyResponse.data;
      } else {
        const apiResponse = await this.apiClient.get(
          `/api/v5/public/open-interest?instId=${symbol}`
        );
        response = apiResponse.data;
      }

      if (response.code !== '0' || !response.data || response.data.length === 0) {
        console.error('Invalid open interest response:', response);
        return null;
      }

      return parseFloat(response.data[0].oi);

    } catch (error) {
      console.error('Failed to fetch open interest:', error);
      return null;
    }
  }

  // 获取完整的合约信息
  async getContractInfo(symbol: string = 'ETH-USDT-SWAP'): Promise<ContractInfo | null> {
    try {
      // 并行获取各种数据
      const [ticker, fundingRate, openInterest] = await Promise.all([
        this.getTicker(symbol),
        this.getFundingRate(symbol),
        this.getOpenInterest(symbol)
      ]);

      if (!ticker) {
        console.error('Failed to get ticker data for contract info');
        return null;
      }

      return {
        symbol,
        markPrice: ticker.price,
        indexPrice: ticker.price, // 简化处理，实际应该获取指数价格
        fundingRate: fundingRate || 0,
        nextFundingTime: Date.now() + 8 * 60 * 60 * 1000, // 简化处理，8小时后
        openInterest: openInterest || 0,
        volume24h: ticker.volume,
        turnover24h: ticker.volume * ticker.price * 0.1, // 张->USDT：乘数 0.1
        priceChange24h: (ticker.change24h / 100) * ticker.price,
        priceChangePercent24h: ticker.change24h
      };

    } catch (error) {
      console.error('Failed to get contract info:', error);
      return null;
    }
  }

  // 获取多个时间周期的K线数据
  async getMultiTimeframeKlines(symbol: string = 'ETH-USDT-SWAP'): Promise<{
    [timeframe: string]: KlineData[];
  }> {
    const timeframes = ['1m', '5m', '15m', '1H', '4H', '1D'];
    const results: { [timeframe: string]: KlineData[] } = {};

    try {
      // 并行获取不同时间周期的数据
      const promises = timeframes.map(async (tf) => {
        const limit = tf.includes('m') ? 100 : tf.includes('H') ? 50 : 30;
        const data = await this.getKlineData(symbol, tf, limit);
        return { timeframe: tf, data };
      });

      const responses = await Promise.all(promises);
      
      responses.forEach(({ timeframe, data }) => {
        results[timeframe] = data;
      });

      return results;

    } catch (error) {
      console.error('Failed to get multi-timeframe klines:', error);
      return {};
    }
  }

  // 获取市场深度数据
  async getOrderBook(symbol: string = 'ETH-USDT-SWAP', depth: number = 20): Promise<{
    bids: Array<[number, number]>;
    asks: Array<[number, number]>;
    timestamp: number;
  } | null> {
    try {
      await this.waitForRateLimit();
      
      let response: any;
      
      if (this.useProxy && this.proxyClient) {
        const proxyResponse = await this.proxyClient.get(
          `/api/v5/market/books?instId=${symbol}&sz=${depth}`
        );
        response = proxyResponse.data;
      } else {
        const apiResponse = await this.apiClient.get(
          `/api/v5/market/books?instId=${symbol}&sz=${depth}`
        );
        response = apiResponse.data;
      }

      if (response.code !== '0' || !response.data || response.data.length === 0) {
        console.error('Invalid order book response:', response);
        return null;
      }

      const book = response.data[0];
      
      return {
        bids: book.bids.map((bid: string[]) => [parseFloat(bid[0]), parseFloat(bid[1])]),
        asks: book.asks.map((ask: string[]) => [parseFloat(ask[0]), parseFloat(ask[1])]),
        timestamp: parseInt(book.ts)
      };

    } catch (error) {
      console.error('Failed to fetch order book:', error);
      return null;
    }
  }

  // 批量获取多个合约的Ticker数据
  async getMultiTickers(symbols: string[]): Promise<{ [symbol: string]: MarketData }> {
    const results: { [symbol: string]: MarketData } = {};

    try {
      // 分批处理，避免请求过多
      const batchSize = 5;
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        
        const promises = batch.map(async (symbol) => {
          const ticker = await this.getTicker(symbol);
          return { symbol, ticker };
        });

        const responses = await Promise.all(promises);
        
        responses.forEach(({ symbol, ticker }) => {
          if (ticker) {
            results[symbol] = ticker;
          }
        });
      }

      return results;

    } catch (error) {
      console.error('Failed to get multi tickers:', error);
      return {};
    }
  }

  // 检查API连接状态
  async checkConnection(): Promise<boolean> {
    try {
      const ticker = await this.getTicker('ETH-USDT-SWAP');
      return ticker !== null;
    } catch (error) {
      console.error('Connection check failed:', error);
      return false;
    }
  }

  // 获取服务器时间
  async getServerTime(): Promise<number | null> {
    try {
      await this.waitForRateLimit();
      
      let response: any;
      
      if (this.useProxy && this.proxyClient) {
        const proxyResponse = await this.proxyClient.get('/api/v5/public/time');
        response = proxyResponse.data;
      } else {
        const apiResponse = await this.apiClient.get('/api/v5/public/time');
        response = apiResponse.data;
      }

      if (response.code !== '0' || !response.data || response.data.length === 0) {
        return null;
      }

      return parseInt(response.data[0].ts);

    } catch (error) {
      console.error('Failed to get server time:', error);
      return null;
    }
  }

  // 设置请求间隔
  setRateLimitDelay(delay: number): void {
    this.rateLimitDelay = Math.max(50, delay); // 最小50ms间隔
  }

  // 获取当前配置信息
  getConfig(): {
    useProxy: boolean;
    baseUrl: string;
    timeout: number;
    rateLimitDelay: number;
  } {
    return {
      useProxy: this.useProxy,
      baseUrl: this.useProxy && this.proxyClient ? config.proxy.baseUrl : config.okx.baseUrl,
      timeout: config.okx.timeout,
      rateLimitDelay: this.rateLimitDelay
    };
  }
}

// 导出单例实例
export const okxDataService = new OKXDataService();