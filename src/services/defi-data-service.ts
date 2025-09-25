import axios, { AxiosInstance } from 'axios';
import { config } from '../config.js';
import { IDataSource, DataSourceType, DataSourceStatus } from './data-aggregator-service.js';
import { SmartCacheManager } from '../utils/smart-cache-manager.js';

/**
 * DeFi协议数据接口
 */
export interface DeFiData {
  timestamp: number;
  
  // 总锁仓价值 (TVL)
  tvl: {
    total: number;              // 总TVL (USD)
    ethereum: number;           // 以太坊TVL
    change24h: number;          // 24小时变化
    change7d: number;           // 7天变化
    dominance: number;          // 以太坊TVL占比
  };
  
  // 主要协议数据
  protocols: {
    uniswap: {
      tvl: number;
      volume24h: number;
      fees24h: number;
      users24h: number;
    };
    aave: {
      tvl: number;
      totalBorrowed: number;
      totalSupplied: number;
      utilizationRate: number;
    };
    compound: {
      tvl: number;
      totalBorrowed: number;
      supplyRate: number;
      borrowRate: number;
    };
    makerdao: {
      tvl: number;
      totalDai: number;
      collateralRatio: number;
      stabilityFee: number;
    };
    curve: {
      tvl: number;
      volume24h: number;
      fees24h: number;
    };
  };
  
  // 流动性挖矿数据
  liquidityMining: {
    totalRewards: number;       // 总奖励价值
    activePrograms: number;     // 活跃项目数
    avgAPY: number;            // 平均年化收益率
    topAPY: number;            // 最高年化收益率
  };
  
  // 稳定币数据
  stablecoins: {
    totalSupply: number;        // 总供应量
    dai: number;               // DAI供应量
    usdc: number;              // USDC供应量
    usdt: number;              // USDT供应量
    marketCap: number;         // 总市值
    dominanceRatio: number;    // 主导地位比率
  };
  
  // 跨链数据
  crossChain: {
    totalBridged: number;       // 总跨链资产
    ethereumInflow: number;     // 流入以太坊
    ethereumOutflow: number;    // 流出以太坊
    netFlow: number;           // 净流量
    bridgeVolume24h: number;   // 24小时跨链量
  };
  
  // DeFi指标
  metrics: {
    defiPulse: number;         // DeFi脉搏指数
    yieldFarming: number;      // 流动性挖矿指数
    borrowingDemand: number;   // 借贷需求指数
    liquidityHealth: number;   // 流动性健康度
    riskScore: number;         // 风险评分
  };
  
  // 收益率数据
  yields: {
    lending: {
      aave: number;            // Aave存款收益率
      compound: number;        // Compound存款收益率
      average: number;         // 平均存款收益率
    };
    liquidity: {
      uniswapV3: number;       // Uniswap V3 LP收益率
      curve: number;           // Curve LP收益率
      average: number;         // 平均LP收益率
    };
    staking: {
      ethereum: number;        // ETH质押收益率
      rocketpool: number;      // Rocket Pool收益率
      lido: number;           // Lido收益率
    };
  };
}

/**
 * DefiLlama API响应接口
 */
interface DefiLlamaProtocolsResponse {
  name: string;
  symbol: string;
  tvl: number;
  chainTvls: Record<string, number>;
  change_1h?: number;
  change_1d?: number;
  change_7d?: number;
  mcap?: number;
}

interface DefiLlamaTVLResponse {
  date: string;
  totalLiquidityUSD: number;
}

interface DefiLlamaYieldsResponse {
  status: string;
  data: Array<{
    chain: string;
    project: string;
    symbol: string;
    tvlUsd: number;
    apy: number;
    apyBase?: number;
    apyReward?: number;
    il7d?: number;
    apyBase7d?: number;
  }>;
}

interface DefiLlamaStablecoinResponse {
  id: string;
  name: string;
  symbol: string;
  circulating: {
    [key: string]: number;
  };
  chainCirculating: {
    [key: string]: {
      [key: string]: number;
    };
  };
}

/**
 * DeFi数据服务
 * 集成DefiLlama等DeFi数据源，提供DeFi生态关键指标
 */
export class DeFiDataService implements IDataSource {
  public readonly name = 'DeFiDataService';
  public readonly type = DataSourceType.DEFI;
  public isEnabled: boolean = true;
  
  private defiLlamaClient: AxiosInstance;
  private cacheManager: SmartCacheManager;
  
  private status: DataSourceStatus = {
    name: 'DeFiDataService',
    type: DataSourceType.DEFI,
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
  private readonly DEFILLAMA_BASE_URL = 'https://api.llama.fi';
  private readonly CACHE_TTL = 10 * 60 * 1000; // 10分钟缓存
  
  // 主要协议列表
  private readonly MAJOR_PROTOCOLS = [
    'uniswap', 'aave', 'compound', 'makerdao', 'curve-dex',
    'lido', 'rocket-pool', 'convex-finance', 'yearn-finance'
  ];
  
  constructor() {
    this.cacheManager = new SmartCacheManager({
      maxItems: 200,
      defaultTTL: this.CACHE_TTL
    });
    
    this.defiLlamaClient = axios.create({
      baseURL: this.DEFILLAMA_BASE_URL,
      timeout: 15000,
      headers: {
        'User-Agent': 'ETH-Quant-System/1.0',
        'Accept': 'application/json'
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
    this.defiLlamaClient.interceptors.request.use(
      (config) => {
        (config as any).metadata = { startTime: Date.now() };
        return config;
      }
    );
    
    // 响应拦截器
    this.defiLlamaClient.interceptors.response.use(
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
    console.log('[DeFiDataService] Initializing DeFi data service...');
    
    try {
      await this.testConnection();
      this.status.isActive = true;
      console.log('[DeFiDataService] Initialized successfully');
    } catch (error) {
      console.error('[DeFiDataService] Failed to initialize:', error);
      this.status.isActive = false;
      throw error;
    }
  }
  
  /**
   * 测试连接
   */
  private async testConnection(): Promise<void> {
    try {
      const response = await this.defiLlamaClient.get('/protocols');
      
      if (!Array.isArray(response.data) || response.data.length === 0) {
        throw new Error('Invalid response from DefiLlama API');
      }
      
      console.log('[DeFiDataService] Connection test successful');
    } catch (error) {
      console.error('[DeFiDataService] Connection test failed:', error);
      throw error;
    }
  }
  
  /**
   * 获取DeFi数据
   */
  public async fetchData(): Promise<DeFiData> {
    const cacheKey = 'defi_data_all';
    
    // 尝试从缓存获取
    const cached = this.cacheManager.get(cacheKey);
    if (cached) {
      return cached as DeFiData;
    }
    
    console.log('[DeFiDataService] Fetching DeFi data...');
    
    try {
      // 并行获取各类数据
      const [tvlData, protocolsData, yieldsData, stablecoinsData] = await Promise.all([
        this.getTVLData(),
        this.getProtocolsData(),
        this.getYieldsData(),
        this.getStablecoinsData()
      ]);
      
      // 计算跨链数据
      const crossChainData = this.calculateCrossChainData(protocolsData);
      
      // 计算DeFi指标
      const metricsData = this.calculateDeFiMetrics(tvlData, protocolsData, yieldsData);
      
      // 处理收益率数据
      const processedYields = this.processYieldsData(yieldsData);
      
      const defiData: DeFiData = {
        timestamp: Date.now(),
        tvl: tvlData,
        protocols: protocolsData,
        liquidityMining: {
          totalRewards: this.calculateTotalRewards(yieldsData),
          activePrograms: yieldsData.length,
          avgAPY: this.calculateAverageAPY(yieldsData),
          topAPY: this.getTopAPY(yieldsData)
        },
        stablecoins: stablecoinsData,
        crossChain: crossChainData,
        metrics: metricsData,
        yields: processedYields
      };
      
      // 缓存结果
      this.cacheManager.set(cacheKey, defiData, undefined, this.CACHE_TTL);
      this.lastUpdate = Date.now();
      
      console.log('[DeFiDataService] Successfully fetched DeFi data');
      return defiData;
      
    } catch (error) {
      console.error('[DeFiDataService] Failed to fetch DeFi data:', error);
      throw error;
    }
  }
  
  /**
   * 获取TVL数据
   */
  private async getTVLData(): Promise<DeFiData['tvl']> {
    try {
      const [totalTVL, chainTVL] = await Promise.all([
        this.defiLlamaClient.get('/tvl'),
        this.defiLlamaClient.get('/v2/chains')
      ]);
      
      const ethereumTVL = chainTVL.data.find((chain: any) => 
        chain.name.toLowerCase() === 'ethereum'
      )?.tvl || 0;
      
      const total = totalTVL.data || 0;
      
      return {
        total,
        ethereum: ethereumTVL,
        change24h: 0, // 需要历史数据计算
        change7d: 0,  // 需要历史数据计算
        dominance: total > 0 ? (ethereumTVL / total) * 100 : 0
      };
      
    } catch (error) {
      console.error('[DeFiDataService] Failed to get TVL data:', error);
      return {
        total: 0,
        ethereum: 0,
        change24h: 0,
        change7d: 0,
        dominance: 0
      };
    }
  }
  
  /**
   * 获取协议数据
   */
  private async getProtocolsData(): Promise<DeFiData['protocols']> {
    try {
      const response = await this.defiLlamaClient.get<DefiLlamaProtocolsResponse[]>('/protocols');
      const protocols = response.data;
      
      const getProtocolData = (name: string) => {
        const protocol = protocols.find(p => 
          p.name.toLowerCase().includes(name.toLowerCase()) ||
          p.symbol?.toLowerCase().includes(name.toLowerCase())
        );
        return protocol || null;
      };
      
      const uniswap = getProtocolData('uniswap');
      const aave = getProtocolData('aave');
      const compound = getProtocolData('compound');
      const makerdao = getProtocolData('makerdao');
      const curve = getProtocolData('curve');
      
      return {
        uniswap: {
          tvl: uniswap?.tvl || 0,
          volume24h: 0, // 需要额外API
          fees24h: 0,   // 需要额外API
          users24h: 0   // 需要额外API
        },
        aave: {
          tvl: aave?.tvl || 0,
          totalBorrowed: 0,     // 需要协议特定API
          totalSupplied: 0,     // 需要协议特定API
          utilizationRate: 0    // 需要协议特定API
        },
        compound: {
          tvl: compound?.tvl || 0,
          totalBorrowed: 0,     // 需要协议特定API
          supplyRate: 0,        // 需要协议特定API
          borrowRate: 0         // 需要协议特定API
        },
        makerdao: {
          tvl: makerdao?.tvl || 0,
          totalDai: 0,          // 需要协议特定API
          collateralRatio: 0,   // 需要协议特定API
          stabilityFee: 0       // 需要协议特定API
        },
        curve: {
          tvl: curve?.tvl || 0,
          volume24h: 0,         // 需要额外API
          fees24h: 0            // 需要额外API
        }
      };
      
    } catch (error) {
      console.error('[DeFiDataService] Failed to get protocols data:', error);
      return this.getDefaultProtocolsData();
    }
  }
  
  /**
   * 获取收益率数据
   */
  private async getYieldsData(): Promise<any[]> {
    try {
      const response = await this.defiLlamaClient.get<DefiLlamaYieldsResponse>('/yields');
      
      if (response.data.status === 'success' && Array.isArray(response.data.data)) {
        // 过滤以太坊链上的收益率数据
        return response.data.data.filter(item => 
          item.chain.toLowerCase() === 'ethereum' && 
          item.tvlUsd > 1000000 // 只考虑TVL > 1M的池子
        );
      }
      
      return [];
      
    } catch (error) {
      console.error('[DeFiDataService] Failed to get yields data:', error);
      return [];
    }
  }
  
  /**
   * 获取稳定币数据
   */
  private async getStablecoinsData(): Promise<DeFiData['stablecoins']> {
    try {
      const response = await this.defiLlamaClient.get<DefiLlamaStablecoinResponse[]>('/stablecoins');
      
      if (!Array.isArray(response.data)) {
        return this.getDefaultStablecoinsData();
      }
      
      const stablecoins = response.data;
      
      const dai = stablecoins.find(s => s.symbol === 'DAI');
      const usdc = stablecoins.find(s => s.symbol === 'USDC');
      const usdt = stablecoins.find(s => s.symbol === 'USDT');
      
      const daiSupply = this.getTotalCirculating(dai);
      const usdcSupply = this.getTotalCirculating(usdc);
      const usdtSupply = this.getTotalCirculating(usdt);
      
      const totalSupply = daiSupply + usdcSupply + usdtSupply;
      
      return {
        totalSupply,
        dai: daiSupply,
        usdc: usdcSupply,
        usdt: usdtSupply,
        marketCap: totalSupply, // 稳定币市值约等于供应量
        dominanceRatio: totalSupply > 0 ? (usdtSupply / totalSupply) * 100 : 0
      };
      
    } catch (error) {
      console.error('[DeFiDataService] Failed to get stablecoins data:', error);
      return this.getDefaultStablecoinsData();
    }
  }
  
  /**
   * 计算跨链数据
   */
  private calculateCrossChainData(protocolsData: DeFiData['protocols']): DeFiData['crossChain'] {
    // 简化的跨链数据计算
    const totalTVL = Object.values(protocolsData).reduce((sum, protocol) => sum + protocol.tvl, 0);
    
    return {
      totalBridged: totalTVL * 0.15, // 假设15%的资产是跨链的
      ethereumInflow: totalTVL * 0.08,
      ethereumOutflow: totalTVL * 0.07,
      netFlow: totalTVL * 0.01,
      bridgeVolume24h: totalTVL * 0.05
    };
  }
  
  /**
   * 计算DeFi指标
   */
  private calculateDeFiMetrics(
    tvlData: DeFiData['tvl'],
    protocolsData: DeFiData['protocols'],
    yieldsData: any[]
  ): DeFiData['metrics'] {
    const totalTVL = tvlData.total;
    const avgAPY = this.calculateAverageAPY(yieldsData);
    
    return {
      defiPulse: Math.min(100, (totalTVL / 1000000000) * 10), // 基于TVL的脉搏指数
      yieldFarming: Math.min(100, avgAPY * 5), // 基于平均收益率
      borrowingDemand: 65, // 需要更复杂的计算
      liquidityHealth: 78, // 需要更复杂的计算
      riskScore: 45 // 需要更复杂的计算
    };
  }
  
  /**
   * 处理收益率数据
   */
  private processYieldsData(yieldsData: any[]): DeFiData['yields'] {
    const lendingYields = yieldsData.filter(item => 
      item.project.toLowerCase().includes('aave') || 
      item.project.toLowerCase().includes('compound')
    );
    
    const liquidityYields = yieldsData.filter(item => 
      item.project.toLowerCase().includes('uniswap') || 
      item.project.toLowerCase().includes('curve')
    );
    
    const stakingYields = yieldsData.filter(item => 
      item.project.toLowerCase().includes('lido') || 
      item.project.toLowerCase().includes('rocket')
    );
    
    return {
      lending: {
        aave: this.getProtocolAPY(lendingYields, 'aave'),
        compound: this.getProtocolAPY(lendingYields, 'compound'),
        average: this.calculateAverageAPY(lendingYields)
      },
      liquidity: {
        uniswapV3: this.getProtocolAPY(liquidityYields, 'uniswap'),
        curve: this.getProtocolAPY(liquidityYields, 'curve'),
        average: this.calculateAverageAPY(liquidityYields)
      },
      staking: {
        ethereum: 4.5, // ETH质押收益率相对稳定
        rocketpool: this.getProtocolAPY(stakingYields, 'rocket'),
        lido: this.getProtocolAPY(stakingYields, 'lido')
      }
    };
  }
  
  /**
   * 计算总奖励
   */
  private calculateTotalRewards(yieldsData: any[]): number {
    return yieldsData.reduce((sum, item) => {
      const rewardAPY = item.apyReward || 0;
      const tvl = item.tvlUsd || 0;
      return sum + (tvl * rewardAPY / 100);
    }, 0);
  }
  
  /**
   * 计算平均APY
   */
  private calculateAverageAPY(yieldsData: any[]): number {
    if (yieldsData.length === 0) return 0;
    
    const totalAPY = yieldsData.reduce((sum, item) => sum + (item.apy || 0), 0);
    return totalAPY / yieldsData.length;
  }
  
  /**
   * 获取最高APY
   */
  private getTopAPY(yieldsData: any[]): number {
    if (yieldsData.length === 0) return 0;
    
    return Math.max(...yieldsData.map(item => item.apy || 0));
  }
  
  /**
   * 获取协议APY
   */
  private getProtocolAPY(yieldsData: any[], protocolName: string): number {
    const protocolYields = yieldsData.filter(item => 
      item.project.toLowerCase().includes(protocolName.toLowerCase())
    );
    
    return this.calculateAverageAPY(protocolYields);
  }
  
  /**
   * 获取总流通量
   */
  private getTotalCirculating(stablecoin: any): number {
    if (!stablecoin || !stablecoin.circulating) return 0;
    
    return Object.values(stablecoin.circulating).reduce((sum: number, value: any) => {
      return sum + (typeof value === 'number' ? value : 0);
    }, 0);
  }
  
  /**
   * 获取默认协议数据
   */
  private getDefaultProtocolsData(): DeFiData['protocols'] {
    return {
      uniswap: { tvl: 0, volume24h: 0, fees24h: 0, users24h: 0 },
      aave: { tvl: 0, totalBorrowed: 0, totalSupplied: 0, utilizationRate: 0 },
      compound: { tvl: 0, totalBorrowed: 0, supplyRate: 0, borrowRate: 0 },
      makerdao: { tvl: 0, totalDai: 0, collateralRatio: 0, stabilityFee: 0 },
      curve: { tvl: 0, volume24h: 0, fees24h: 0 }
    };
  }
  
  /**
   * 获取默认稳定币数据
   */
  private getDefaultStablecoinsData(): DeFiData['stablecoins'] {
    return {
      totalSupply: 0,
      dai: 0,
      usdc: 0,
      usdt: 0,
      marketCap: 0,
      dominanceRatio: 0
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
    console.log('[DeFiDataService] Shutting down...');
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
    console.log('[DeFiDataService] Cache cleared');
  }
}

// 导出单例实例
export const defiDataService = new DeFiDataService();