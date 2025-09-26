import axios, { AxiosInstance } from 'axios';
import { OKXDataService } from './okx-data-service.js';

/**
 * OKX合约订单接口
 */
export interface ContractOrder {
  instId: string;
  tdMode: 'isolated' | 'cross';
  side: 'buy' | 'sell';
  ordType: 'market' | 'limit' | 'post_only';
  sz: string;
  px?: string;
  lever?: string;
  posSide?: 'long' | 'short' | 'net';
  tgtCcy?: 'base_ccy' | 'quote_ccy';
  clOrdId?: string;
}

/**
 * OKX合约交易服务
 * 专门用于1倍杠杆高频波段交易
 */
export class OKXContractService {
  private apiClient: AxiosInstance;
  private dataService: OKXDataService;
  private rateLimitDelay = 200;
  private lastRequestTime = 0;

  constructor(dataService: OKXDataService) {
    this.dataService = dataService;
    
    this.apiClient = axios.create({
      baseURL: 'https://www.okx.com',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * 设置杠杆倍数
   */
  async setLeverage(instId: string, lever: string, mgnMode: 'isolated' | 'cross' = 'isolated'): Promise<boolean> {
    console.log(`设置杠杆: ${instId} ${lever}x ${mgnMode}`);
    return true; // 模拟成功
  }

  /**
   * 获取账户余额
   */
  async getAccountBalance(): Promise<any> {
    return { totalEq: '10000' }; // 模拟余额
  }

  /**
   * 批量取消订单
   */
  async cancelAllOrders(instId: string): Promise<boolean> {
    console.log(`取消所有订单: ${instId}`);
    return true;
  }

  /**
   * 速率限制控制
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.rateLimitDelay) {
      const waitTime = this.rateLimitDelay - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }
}

export default OKXContractService;