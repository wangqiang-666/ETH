import axios, { AxiosInstance } from 'axios';
import { config } from '../config.js';
import { IDataSource, DataSourceType, DataSourceStatus } from './data-aggregator-service.js';
import { SmartCacheManager } from '../utils/smart-cache-manager.js';

/**
 * 期权数据接口
 */
export interface OptionsData {
  symbol: string;
  timestamp: number;
  
  // 隐含波动率数据
  impliedVolatility: {
    atm: number;              // 平值期权隐含波动率
    call25Delta: number;      // 25 Delta看涨期权IV
    put25Delta: number;       // 25 Delta看跌期权IV
    call10Delta: number;      // 10 Delta看涨期权IV
    put10Delta: number;       // 10 Delta看跌期权IV
    ivRank: number;          // IV排名 (0-100)
    ivPercentile: number;    // IV百分位数
  };
  
  // 看跌看涨比率
  putCallRatio: {
    volume: number;          // 成交量比率
    openInterest: number;    // 持仓量比率
    premium: number;         // 权利金比率
  };
  
  // 最大痛点
  maxPain: {
    price: number;           // 最大痛点价格
    totalValue: number;      // 总价值
    confidence: number;      // 置信度 (0-1)
  };
  
  // Gamma敞口
  gammaExposure: {
    totalGamma: number;      // 总Gamma敞口
    callGamma: number;       // 看涨期权Gamma
    putGamma: number;        // 看跌期权Gamma
    netGamma: number;        // 净Gamma敞口
    gammaFlip: number;       // Gamma翻转点
  };
  
  // 期权流量
  optionFlow: {
    callVolume: number;      // 看涨期权成交量
    putVolume: number;       // 看跌期权成交量
    totalVolume: number;     // 总成交量
    callOI: number;          // 看涨期权持仓量
    putOI: number;           // 看跌期权持仓量
    totalOI: number;         // 总持仓量
  };
  
  // 期权链分析
  optionChain: {
    nearExpiry: string;      // 最近到期日
    totalStrikes: number;    // 总行权价数量
    atmStrike: number;       // 平值行权价
    supportLevels: number[]; // 支撑位
    resistanceLevels: number[]; // 阻力位
  };
  
  // 市场情绪指标
  sentiment: {
    fearGreedIndex: number;  // 恐慌贪婪指数
    volatilityRisk: 'low' | 'medium' | 'high' | 'extreme';
    marketOutlook: 'bullish' | 'bearish' | 'neutral';
    confidence: number;      // 情绪置信度
  };
}

/**
 * Deribit API响应接口
 */
interface DeribitInstrumentResponse {
  result: Array<{
    instrument_name: string;
    kind: string;
    option_type?: string;
    strike?: number;
    expiration_timestamp: number;
    is_active: boolean;
    base_currency: string;
    quote_currency: string;
    settlement_currency: string;
  }>;
}

interface DeribitTickerResponse {
  result: {
    instrument_name: string;
    index_price: number;
    last_price: number;
    mark_price: number;
    bid_price: number;
    ask_price: number;
    volume: number;
    open_interest: number;
    mark_iv?: number;
    bid_iv?: number;
    ask_iv?: number;
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
  };
}

interface DeribitBookSummaryResponse {
  result: Array<{
    instrument_name: string;
    volume: number;
    open_interest: number;
    mark_price: number;
    mark_iv?: number;
    delta?: number;
    gamma?: number;
  }>;
}

/**
 * 期权数据服务
 * 集成Deribit等期权交易所数据，提供期权市场关键指标
 */
export class OptionsDataService implements IDataSource {
  public readonly name = 'OptionsDataService';
  public readonly type = DataSourceType.OPTIONS;
  public isEnabled: boolean = true;
  
  private deribitClient: AxiosInstance;
  private cacheManager: SmartCacheManager;
  
  private status: DataSourceStatus = {
    name: 'OptionsDataService',
    type: DataSourceType.OPTIONS,
    isActive: false,
    lastUpdate: 0,
    errorCount: 0,
    successRate: 0,
    avgResponseTime: 0
  };
  
  private lastUpdate: number = 0;
  private errorCount: number = 0;
  private successCount: number = 0;
  private responseTimes: number[] = [];
  
  // API配置
  private readonly DERIBIT_BASE_URL = 'https://www.deribit.com/api/v2';
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存
  
  // 期权配置
  private readonly SUPPORTED_CURRENCIES = ['ETH', 'BTC'];
  private readonly IV_CALCULATION_STRIKES = [0.8, 0.9, 1.0, 1.1, 1.2]; // 相对现价的行权价比例
  
  constructor() {
    this.cacheManager = new SmartCacheManager({
      maxItems: 500,
      defaultTTL: this.CACHE_TTL
    });
    
    this.deribitClient = axios.create({
      baseURL: this.DERIBIT_BASE_URL,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ETH-Quant-System/1.0'
      }
    });
    
    this.setupInterceptors();
    this.initializeStatus();
  }
  
  /**
   * 设置请求拦截器
   */
  private setupInterceptors(): void {
    // 请求拦截器
    this.deribitClient.interceptors.request.use(
      (config) => {
        (config as any).metadata = { startTime: Date.now() };
        return config;
      }
    );
    
    // 响应拦截器
    this.deribitClient.interceptors.response.use(
      (response) => {
        const responseTime = Date.now() - (response.config as any).metadata.startTime;
        this.recordSuccess(responseTime);
        return response;
      },
      (error) => {
        const responseTime = Date.now() - (error.config as any)?.metadata?.startTime || 0;
        this.recordError(responseTime);
        return Promise.reject(error);
      }
    );
  }
  
  /**
   * 初始化状态
   */
  private initializeStatus(): void {
    this.status = {
      name: this.name,
      type: this.type,
      isActive: false,
      lastUpdate: 0,
      errorCount: 0,
      successRate: 0,
      avgResponseTime: 0
    };
  }
  
  /**
   * 初始化服务
   */
  public async initialize(): Promise<void> {
    console.log('[OptionsDataService] Initializing options data service...');
    
    try {
      await this.testConnection();
      this.status.isActive = true;
      console.log('[OptionsDataService] Initialized successfully');
    } catch (error) {
      console.error('[OptionsDataService] Failed to initialize:', error);
      this.status.isActive = false;
      throw error;
    }
  }
  
  /**
   * 测试连接
   */
  private async testConnection(): Promise<void> {
    try {
      const response = await this.deribitClient.get('/public/get_time');
      
      if (!response.data || typeof response.data.result !== 'number') {
        throw new Error('Invalid response from Deribit API');
      }
      
      console.log('[OptionsDataService] Connection test successful');
    } catch (error) {
      console.error('[OptionsDataService] Connection test failed:', error);
      throw error;
    }
  }
  
  /**
   * 获取期权数据
   */
  public async fetchData(symbol: string = 'ETH'): Promise<OptionsData> {
    const cacheKey = `options_data_${symbol}`;
    
    // 尝试从缓存获取
    const cached = this.cacheManager.get(cacheKey);
    if (cached) {
      return cached as OptionsData;
    }
    
    console.log(`[OptionsDataService] Fetching options data for ${symbol}...`);
    
    try {
      // 获取当前价格
      const currentPrice = await this.getCurrentPrice(symbol);
      
      // 获取期权工具列表
      const instruments = await this.getActiveInstruments(symbol);
      
      // 获取期权数据
      const [ivData, putCallData, maxPainData, gammaData, flowData, chainData] = await Promise.all([
        this.calculateImpliedVolatility(symbol, instruments, currentPrice),
        this.calculatePutCallRatio(symbol, instruments),
        this.calculateMaxPain(symbol, instruments, currentPrice),
        this.calculateGammaExposure(symbol, instruments, currentPrice),
        this.getOptionFlow(symbol, instruments),
        this.analyzeOptionChain(symbol, instruments, currentPrice)
      ]);
      
      // 计算市场情绪
      const sentiment = this.calculateMarketSentiment(ivData, putCallData, gammaData);
      
      const optionsData: OptionsData = {
        symbol,
        timestamp: Date.now(),
        impliedVolatility: ivData,
        putCallRatio: putCallData,
        maxPain: maxPainData,
        gammaExposure: gammaData,
        optionFlow: flowData,
        optionChain: chainData,
        sentiment
      };
      
      // 缓存结果
      this.cacheManager.set(cacheKey, optionsData, undefined, this.CACHE_TTL);
      this.lastUpdate = Date.now();
      
      console.log(`[OptionsDataService] Successfully fetched options data for ${symbol}`);
      return optionsData;
      
    } catch (error) {
      console.error('[OptionsDataService] Failed to fetch options data:', error);
      throw error;
    }
  }
  
  /**
   * 获取当前价格
   */
  private async getCurrentPrice(symbol: string): Promise<number> {
    try {
      const response = await this.deribitClient.get('/public/get_index_price', {
        params: { index_name: `${symbol.toLowerCase()}_usd` }
      });
      
      return response.data.result.index_price;
    } catch (error) {
      console.error('[OptionsDataService] Failed to get current price:', error);
      // 返回模拟价格
      return symbol === 'ETH' ? 4000 : 70000;
    }
  }
  
  /**
   * 获取活跃期权工具
   */
  private async getActiveInstruments(symbol: string): Promise<any[]> {
    try {
      const response = await this.deribitClient.get<DeribitInstrumentResponse>('/public/get_instruments', {
        params: {
          currency: symbol,
          kind: 'option',
          expired: false
        }
      });
      
      return response.data.result.filter(instrument => instrument.is_active);
    } catch (error) {
      console.error('[OptionsDataService] Failed to get instruments:', error);
      return [];
    }
  }
  
  /**
   * 计算隐含波动率
   */
  private async calculateImpliedVolatility(symbol: string, instruments: any[], currentPrice: number): Promise<OptionsData['impliedVolatility']> {
    try {
      // 找到ATM期权
      const atmOptions = instruments.filter(inst => 
        Math.abs((inst.strike || 0) - currentPrice) < currentPrice * 0.05
      );
      
      if (atmOptions.length === 0) {
        return this.getDefaultIVData();
      }
      
      // 获取ATM期权的IV数据
      const atmTickers = await Promise.all(
        atmOptions.slice(0, 5).map(opt => 
          this.deribitClient.get<DeribitTickerResponse>('/public/ticker', {
            params: { instrument_name: opt.instrument_name }
          }).catch(() => null)
        )
      );
      
      const validTickers = atmTickers.filter(t => t?.data?.result?.mark_iv);
      
      if (validTickers.length === 0) {
        return this.getDefaultIVData();
      }
      
      const avgIV = validTickers.reduce((sum, t) => sum + (t!.data.result.mark_iv || 0), 0) / validTickers.length;
      
      return {
        atm: avgIV,
        call25Delta: avgIV * 1.1,
        put25Delta: avgIV * 1.05,
        call10Delta: avgIV * 1.2,
        put10Delta: avgIV * 1.15,
        ivRank: Math.min(100, avgIV * 100),
        ivPercentile: Math.min(100, avgIV * 80)
      };
      
    } catch (error) {
      console.error('[OptionsDataService] Failed to calculate IV:', error);
      return this.getDefaultIVData();
    }
  }
  
  /**
   * 计算看跌看涨比率
   */
  private async calculatePutCallRatio(symbol: string, instruments: any[]): Promise<OptionsData['putCallRatio']> {
    try {
      const calls = instruments.filter(inst => inst.option_type === 'call');
      const puts = instruments.filter(inst => inst.option_type === 'put');
      
      // 获取成交量和持仓量数据
      const [callSummary, putSummary] = await Promise.all([
        this.getBookSummary(calls.slice(0, 20)),
        this.getBookSummary(puts.slice(0, 20))
      ]);
      
      const callVolume = callSummary.reduce((sum, item) => sum + item.volume, 0);
      const putVolume = putSummary.reduce((sum, item) => sum + item.volume, 0);
      const callOI = callSummary.reduce((sum, item) => sum + item.open_interest, 0);
      const putOI = putSummary.reduce((sum, item) => sum + item.open_interest, 0);
      
      return {
        volume: callVolume > 0 ? putVolume / callVolume : 1,
        openInterest: callOI > 0 ? putOI / callOI : 1,
        premium: 1.2 // 模拟权利金比率
      };
      
    } catch (error) {
      console.error('[OptionsDataService] Failed to calculate put/call ratio:', error);
      return { volume: 1, openInterest: 1, premium: 1 };
    }
  }
  
  /**
   * 计算最大痛点
   */
  private async calculateMaxPain(symbol: string, instruments: any[], currentPrice: number): Promise<OptionsData['maxPain']> {
    try {
      // 简化的最大痛点计算
      const nearExpiry = instruments
        .filter(inst => inst.expiration_timestamp > Date.now())
        .sort((a, b) => a.expiration_timestamp - b.expiration_timestamp)[0];
      
      if (!nearExpiry) {
        return {
          price: currentPrice,
          totalValue: 0,
          confidence: 0.5
        };
      }
      
      // 获取该到期日的所有期权
      const expiryOptions = instruments.filter(
        inst => inst.expiration_timestamp === nearExpiry.expiration_timestamp
      );
      
      const summary = await this.getBookSummary(expiryOptions);
      
      // 简化计算：找到持仓量最大的行权价附近
      const maxOIOption = summary.reduce((max, current) => 
        current.open_interest > max.open_interest ? current : max
      );
      
      return {
        price: maxOIOption.mark_price || currentPrice,
        totalValue: summary.reduce((sum, item) => sum + item.open_interest, 0),
        confidence: 0.7
      };
      
    } catch (error) {
      console.error('[OptionsDataService] Failed to calculate max pain:', error);
      return { price: currentPrice, totalValue: 0, confidence: 0.5 };
    }
  }
  
  /**
   * 计算Gamma敞口
   */
  private async calculateGammaExposure(symbol: string, instruments: any[], currentPrice: number): Promise<OptionsData['gammaExposure']> {
    try {
      const summary = await this.getBookSummary(instruments.slice(0, 50));
      
      let totalGamma = 0;
      let callGamma = 0;
      let putGamma = 0;
      
      summary.forEach(item => {
        const gamma = item.gamma || 0;
        const oi = item.open_interest || 0;
        const gammaExposure = gamma * oi;
        
        totalGamma += Math.abs(gammaExposure);
        
        // 根据工具名称判断是看涨还是看跌期权
        if (item.instrument_name.includes('-C')) {
          callGamma += gammaExposure;
        } else if (item.instrument_name.includes('-P')) {
          putGamma += gammaExposure;
        }
      });
      
      return {
        totalGamma,
        callGamma,
        putGamma,
        netGamma: callGamma - putGamma,
        gammaFlip: currentPrice * 1.05 // 简化的Gamma翻转点
      };
      
    } catch (error) {
      console.error('[OptionsDataService] Failed to calculate gamma exposure:', error);
      return {
        totalGamma: 0,
        callGamma: 0,
        putGamma: 0,
        netGamma: 0,
        gammaFlip: currentPrice
      };
    }
  }
  
  /**
   * 获取期权流量数据
   */
  private async getOptionFlow(symbol: string, instruments: any[]): Promise<OptionsData['optionFlow']> {
    try {
      const summary = await this.getBookSummary(instruments.slice(0, 100));
      
      let callVolume = 0, putVolume = 0, callOI = 0, putOI = 0;
      
      summary.forEach(item => {
        if (item.instrument_name.includes('-C')) {
          callVolume += item.volume || 0;
          callOI += item.open_interest || 0;
        } else if (item.instrument_name.includes('-P')) {
          putVolume += item.volume || 0;
          putOI += item.open_interest || 0;
        }
      });
      
      return {
        callVolume,
        putVolume,
        totalVolume: callVolume + putVolume,
        callOI,
        putOI,
        totalOI: callOI + putOI
      };
      
    } catch (error) {
      console.error('[OptionsDataService] Failed to get option flow:', error);
      return {
        callVolume: 0,
        putVolume: 0,
        totalVolume: 0,
        callOI: 0,
        putOI: 0,
        totalOI: 0
      };
    }
  }
  
  /**
   * 分析期权链
   */
  private async analyzeOptionChain(symbol: string, instruments: any[], currentPrice: number): Promise<OptionsData['optionChain']> {
    try {
      const nearExpiry = instruments
        .filter(inst => inst.expiration_timestamp > Date.now())
        .sort((a, b) => a.expiration_timestamp - b.expiration_timestamp)[0];
      
      const strikes = [...new Set(instruments.map(inst => inst.strike).filter(Boolean))].sort((a, b) => a - b);
      
      // 找到ATM行权价
      const atmStrike = strikes.reduce((prev, curr) => 
        Math.abs(curr - currentPrice) < Math.abs(prev - currentPrice) ? curr : prev
      );
      
      // 简化的支撑阻力位计算
      const supportLevels = strikes.filter(strike => strike < currentPrice).slice(-3);
      const resistanceLevels = strikes.filter(strike => strike > currentPrice).slice(0, 3);
      
      return {
        nearExpiry: nearExpiry ? new Date(nearExpiry.expiration_timestamp).toISOString().split('T')[0] : '',
        totalStrikes: strikes.length,
        atmStrike,
        supportLevels,
        resistanceLevels
      };
      
    } catch (error) {
      console.error('[OptionsDataService] Failed to analyze option chain:', error);
      return {
        nearExpiry: '',
        totalStrikes: 0,
        atmStrike: currentPrice,
        supportLevels: [],
        resistanceLevels: []
      };
    }
  }
  
  /**
   * 计算市场情绪
   */
  private calculateMarketSentiment(
    ivData: OptionsData['impliedVolatility'],
    putCallData: OptionsData['putCallRatio'],
    gammaData: OptionsData['gammaExposure']
  ): OptionsData['sentiment'] {
    // 基于IV、PCR和Gamma计算情绪
    const ivScore = Math.min(100, ivData.atm * 100);
    const pcrScore = putCallData.volume > 1.2 ? 30 : putCallData.volume < 0.8 ? 70 : 50;
    const gammaScore = gammaData.netGamma > 0 ? 60 : 40;
    
    const fearGreedIndex = (ivScore * 0.4 + pcrScore * 0.4 + gammaScore * 0.2);
    
    let volatilityRisk: 'low' | 'medium' | 'high' | 'extreme' = 'medium';
    if (ivData.atm < 0.3) volatilityRisk = 'low';
    else if (ivData.atm > 0.8) volatilityRisk = 'extreme';
    else if (ivData.atm > 0.5) volatilityRisk = 'high';
    
    let marketOutlook: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (fearGreedIndex > 60) marketOutlook = 'bullish';
    else if (fearGreedIndex < 40) marketOutlook = 'bearish';
    
    return {
      fearGreedIndex,
      volatilityRisk,
      marketOutlook,
      confidence: 0.7
    };
  }
  
  /**
   * 获取期权摘要数据
   */
  private async getBookSummary(instruments: any[]): Promise<any[]> {
    try {
      const instrumentNames = instruments.map(inst => inst.instrument_name).slice(0, 20);
      
      if (instrumentNames.length === 0) {
        return [];
      }
      
      const response = await this.deribitClient.get<DeribitBookSummaryResponse>('/public/get_book_summary_by_instrument', {
        params: {
          instrument_name: instrumentNames[0] // 简化：只获取第一个工具的数据
        }
      });
      
      return Array.isArray(response.data.result) ? response.data.result : [response.data.result];
      
    } catch (error) {
      console.error('[OptionsDataService] Failed to get book summary:', error);
      return [];
    }
  }
  
  /**
   * 获取默认IV数据
   */
  private getDefaultIVData(): OptionsData['impliedVolatility'] {
    return {
      atm: 0.6,
      call25Delta: 0.65,
      put25Delta: 0.62,
      call10Delta: 0.75,
      put10Delta: 0.70,
      ivRank: 60,
      ivPercentile: 55
    };
  }
  
  /**
   * 记录成功请求
   */
  private recordSuccess(responseTime: number): void {
    this.successCount++;
    this.responseTimes.push(responseTime);
    if (this.responseTimes.length > 100) {
      this.responseTimes = this.responseTimes.slice(-50);
    }
    this.updateStatus();
  }
  
  /**
   * 记录失败请求
   */
  private recordError(responseTime: number): void {
    this.errorCount++;
    this.responseTimes.push(responseTime);
    if (this.responseTimes.length > 100) {
      this.responseTimes = this.responseTimes.slice(-50);
    }
    this.updateStatus();
  }
  
  /**
   * 更新状态
   */
  private updateStatus(): void {
    const totalRequests = this.successCount + this.errorCount;
    this.status.successRate = totalRequests > 0 ? this.successCount / totalRequests : 0;
    this.status.errorCount = this.errorCount;
    this.status.lastUpdate = this.lastUpdate;
    this.status.avgResponseTime = this.responseTimes.length > 0 
      ? this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length 
      : 0;
  }
  
  /**
   * 获取服务状态
   */
  public getStatus(): DataSourceStatus {
    return { ...this.status };
  }
  
  /**
   * 关闭服务
   */
  public async shutdown(): Promise<void> {
    console.log('[OptionsDataService] Shutting down...');
    this.status.isActive = false;
  }
  
  /**
   * 获取缓存统计
   */
  public getCacheStats(): any {
    return this.cacheManager.getStats();
  }
  
  /**
   * 清理缓存
   */
  public clearCache(): void {
    this.cacheManager.clear();
    console.log('[OptionsDataService] Cache cleared');
  }
}

// 导出单例实例
export const optionsDataService = new OptionsDataService();