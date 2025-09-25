import express from 'express';
import { enhancedDataIntegrationService, EnhancedMarketData } from '../services/enhanced-data-integration-service.js';
import { dataAggregatorService } from '../services/data-aggregator-service.js';
import { onchainDataService } from '../services/onchain-data-service.js';
import { macroEconomicDataService } from '../services/macro-economic-data-service.js';
import { multiExchangeDataService } from '../services/multi-exchange-data-service.js';
import { socialSentimentDataService } from '../services/social-sentiment-data-service.js';
import { whaleMonitoringService } from '../services/whale-monitoring-service.js';
import { optionsDataService } from '../services/options-data-service.js';
import { defiDataService } from '../services/defi-data-service.js';
import { dataQualityManager } from '../utils/data-quality-manager.js';

/**
 * API响应接口
 */
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
  metadata?: {
    sources: string[];
    completeness: number;
    freshness: number;
  };
}

/**
 * 增强数据API
 * 提供所有新增数据源的RESTful API接口
 */
export class EnhancedDataAPI {
  private router: express.Router;
  
  constructor() {
    this.router = express.Router();
    this.setupRoutes();
  }
  
  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // 获取增强市场数据
    this.router.get('/enhanced-market/:symbol?', this.getEnhancedMarketData.bind(this));
    
    // 获取链上数据
    this.router.get('/onchain/:symbol?', this.getOnchainData.bind(this));
    
    // 获取宏观经济数据
    this.router.get('/macro', this.getMacroEconomicData.bind(this));
    
    // 获取多交易所数据
    this.router.get('/multi-exchange/:symbol?', this.getMultiExchangeData.bind(this));
    
    // 获取社交情绪数据
    this.router.get('/sentiment/:symbol?', this.getSocialSentimentData.bind(this));
    
    // 获取大户监控数据
    this.router.get('/whale-monitoring/:symbol?', this.getWhaleMonitoringData.bind(this));
    
    // 获取期权数据
    this.router.get('/options/:symbol?', this.getOptionsData.bind(this));
    
    // 获取DeFi数据
    this.router.get('/defi', this.getDeFiData.bind(this));
    
    // 获取数据源状态
    this.router.get('/status', this.getDataSourcesStatus.bind(this));
    
    // 获取数据集成统计
    this.router.get('/stats', this.getIntegrationStats.bind(this));
    
    // 获取健康状态
    this.router.get('/health', this.getHealthStatus.bind(this));
    
    // 清理缓存
    this.router.post('/cache/clear', this.clearCaches.bind(this));
    
    // 获取数据质量报告
    this.router.get('/quality/:symbol?', this.getDataQualityReport.bind(this));
    
    // 获取数据质量详细报告
    this.router.get('/quality-detailed/:sourceName?', this.getDetailedQualityReport.bind(this));
    
    // 获取数据融合配置
    this.router.get('/fusion-config', this.getFusionConfig.bind(this));
    
    // 更新数据融合配置
    this.router.put('/fusion-config', this.updateFusionConfig.bind(this));
  }
  
  /**
   * 获取增强市场数据
   */
  private async getEnhancedMarketData(req: express.Request, res: express.Response): Promise<void> {
    try {
      const symbol = req.params.symbol || 'ETH-USDT-SWAP';
      
      const enhancedData = await enhancedDataIntegrationService.getEnhancedMarketData(symbol);
      
      const response: ApiResponse<EnhancedMarketData> = {
        success: true,
        data: enhancedData,
        timestamp: Date.now(),
        metadata: {
          sources: enhancedData.dataQuality?.sources || [],
          completeness: enhancedData.dataQuality?.completeness || 0,
          freshness: enhancedData.dataQuality?.freshness || 0
        }
      };
      
      res.json(response);
      
    } catch (error) {
      console.error('[EnhancedDataAPI] Failed to get enhanced market data:', error);
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }
  
  /**
   * 获取链上数据
   */
  private async getOnchainData(req: express.Request, res: express.Response): Promise<void> {
    try {
      const symbol = req.params.symbol || 'ETH';
      
      const onchainData = await onchainDataService.fetchData(symbol);
      
      const response: ApiResponse = {
        success: true,
        data: onchainData,
        timestamp: Date.now(),
        metadata: {
          sources: ['Glassnode', 'Etherscan'],
          completeness: this.calculateCompleteness(onchainData),
          freshness: 100
        }
      };
      
      res.json(response);
      
    } catch (error) {
      console.error('[EnhancedDataAPI] Failed to get onchain data:', error);
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }
  
  /**
   * 获取宏观经济数据
   */
  private async getMacroEconomicData(req: express.Request, res: express.Response): Promise<void> {
    try {
      const macroData = await macroEconomicDataService.fetchData();
      
      const response: ApiResponse = {
        success: true,
        data: macroData,
        timestamp: Date.now(),
        metadata: {
          sources: ['Alpha Vantage', 'FRED'],
          completeness: this.calculateCompleteness(macroData),
          freshness: 100
        }
      };
      
      res.json(response);
      
    } catch (error) {
      console.error('[EnhancedDataAPI] Failed to get macro economic data:', error);
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }
  
  /**
   * 获取多交易所数据
   */
  private async getMultiExchangeData(req: express.Request, res: express.Response): Promise<void> {
    try {
      const symbol = req.params.symbol || 'ETH-USDT-SWAP';
      
      const multiExchangeData = await multiExchangeDataService.fetchData(symbol);
      
      const response: ApiResponse = {
        success: true,
        data: multiExchangeData,
        timestamp: Date.now(),
        metadata: {
          sources: ['Binance', 'Bybit', 'OKX'],
          completeness: this.calculateCompleteness(multiExchangeData),
          freshness: 100
        }
      };
      
      res.json(response);
      
    } catch (error) {
      console.error('[EnhancedDataAPI] Failed to get multi-exchange data:', error);
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }
  
  /**
   * 获取社交情绪数据
   */
  private async getSocialSentimentData(req: express.Request, res: express.Response): Promise<void> {
    try {
      const symbol = req.params.symbol || 'ETH';
      
      const sentimentData = await socialSentimentDataService.fetchData(symbol);
      
      const response: ApiResponse = {
        success: true,
        data: sentimentData,
        timestamp: Date.now(),
        metadata: {
          sources: ['LunarCrush', 'NewsAPI', 'Google Trends'],
          completeness: this.calculateCompleteness(sentimentData),
          freshness: 100
        }
      };
      
      res.json(response);
      
    } catch (error) {
      console.error('[EnhancedDataAPI] Failed to get social sentiment data:', error);
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }
  
  /**
   * 获取大户监控数据
   */
  private async getWhaleMonitoringData(req: express.Request, res: express.Response): Promise<void> {
    try {
      const symbol = req.params.symbol || 'ETH';
      
      const whaleData = await whaleMonitoringService.fetchData(symbol);
      
      const response: ApiResponse = {
        success: true,
        data: whaleData,
        timestamp: Date.now(),
        metadata: {
          sources: ['Whale Alert', 'Exchange APIs'],
          completeness: this.calculateCompleteness(whaleData),
          freshness: 100
        }
      };
      
      res.json(response);
      
    } catch (error) {
      console.error('[EnhancedDataAPI] Failed to get whale monitoring data:', error);
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }
  
  /**
   * 获取期权数据
   */
  private async getOptionsData(req: express.Request, res: express.Response): Promise<void> {
    try {
      const symbol = req.params.symbol || 'ETH';
      
      const optionsData = await optionsDataService.fetchData(symbol);
      
      const response: ApiResponse = {
        success: true,
        data: optionsData,
        timestamp: Date.now(),
        metadata: {
          sources: ['Deribit'],
          completeness: this.calculateCompleteness(optionsData),
          freshness: 100
        }
      };
      
      res.json(response);
      
    } catch (error) {
      console.error('[EnhancedDataAPI] Failed to get options data:', error);
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }
  
  /**
   * 获取DeFi数据
   */
  private async getDeFiData(req: express.Request, res: express.Response): Promise<void> {
    try {
      const defiData = await defiDataService.fetchData();
      
      const response: ApiResponse = {
        success: true,
        data: defiData,
        timestamp: Date.now(),
        metadata: {
          sources: ['DefiLlama'],
          completeness: this.calculateCompleteness(defiData),
          freshness: 100
        }
      };
      
      res.json(response);
      
    } catch (error) {
      console.error('[EnhancedDataAPI] Failed to get DeFi data:', error);
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }
  
  /**
   * 获取数据源状态
   */
  private async getDataSourcesStatus(req: express.Request, res: express.Response): Promise<void> {
    try {
      const statuses = enhancedDataIntegrationService.getDataSourcesStatus();
      
      const response: ApiResponse = {
        success: true,
        data: statuses,
        timestamp: Date.now()
      };
      
      res.json(response);
      
    } catch (error) {
      console.error('[EnhancedDataAPI] Failed to get data sources status:', error);
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }
  
  /**
   * 获取数据集成统计
   */
  private async getIntegrationStats(req: express.Request, res: express.Response): Promise<void> {
    try {
      const stats = enhancedDataIntegrationService.getIntegrationStats();
      
      const response: ApiResponse = {
        success: true,
        data: stats,
        timestamp: Date.now()
      };
      
      res.json(response);
      
    } catch (error) {
      console.error('[EnhancedDataAPI] Failed to get integration stats:', error);
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }
  
  /**
   * 获取健康状态
   */
  private async getHealthStatus(req: express.Request, res: express.Response): Promise<void> {
    try {
      const health = enhancedDataIntegrationService.getHealthStatus();
      
      const response: ApiResponse = {
        success: true,
        data: health,
        timestamp: Date.now()
      };
      
      res.status(health.isHealthy ? 200 : 503).json(response);
      
    } catch (error) {
      console.error('[EnhancedDataAPI] Failed to get health status:', error);
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }
  
  /**
   * 清理缓存
   */
  private async clearCaches(req: express.Request, res: express.Response): Promise<void> {
    try {
      enhancedDataIntegrationService.clearAllCaches();
      
      const response: ApiResponse = {
        success: true,
        data: { message: 'All caches cleared successfully' },
        timestamp: Date.now()
      };
      
      res.json(response);
      
    } catch (error) {
      console.error('[EnhancedDataAPI] Failed to clear caches:', error);
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }
  
  /**
   * 获取数据质量报告
   */
  private async getDataQualityReport(req: express.Request, res: express.Response): Promise<void> {
    try {
      const symbol = req.params.symbol || 'ETH-USDT-SWAP';
      
      const enhancedData = await enhancedDataIntegrationService.getEnhancedMarketData(symbol);
      const dataQuality = enhancedData.dataQuality;
      
      // 生成详细的质量报告
      const qualityReport = {
        symbol,
        overall: {
          score: dataQuality ? (dataQuality.completeness + dataQuality.freshness + dataQuality.reliability) / 3 : 0,
          grade: this.getQualityGrade(dataQuality ? (dataQuality.completeness + dataQuality.freshness + dataQuality.reliability) / 3 : 0)
        },
        metrics: {
          completeness: {
            score: dataQuality?.completeness || 0,
            description: 'Data completeness across all sources'
          },
          freshness: {
            score: dataQuality?.freshness || 0,
            description: 'How recent the data is'
          },
          reliability: {
            score: dataQuality?.reliability || 0,
            description: 'Data source reliability and success rate'
          }
        },
        sources: dataQuality?.sources || [],
        lastUpdate: dataQuality?.lastUpdate || Date.now(),
        recommendations: this.generateQualityRecommendations(dataQuality)
      };
      
      const response: ApiResponse = {
        success: true,
        data: qualityReport,
        timestamp: Date.now()
      };
      
      res.json(response);
      
    } catch (error) {
      console.error('[EnhancedDataAPI] Failed to get data quality report:', error);
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }
  
  /**
   * 计算数据完整性
   */
  private calculateCompleteness(data: any): number {
    if (!data || typeof data !== 'object') return 0;
    
    const fields = Object.keys(data);
    const nonNullFields = fields.filter(key => data[key] !== null && data[key] !== undefined);
    
    return fields.length > 0 ? (nonNullFields.length / fields.length) * 100 : 0;
  }
  
  /**
   * 获取质量等级
   */
  private getQualityGrade(score: number): string {
    if (score >= 90) return 'A+';
    if (score >= 80) return 'A';
    if (score >= 70) return 'B';
    if (score >= 60) return 'C';
    if (score >= 50) return 'D';
    return 'F';
  }
  
  /**
   * 生成质量改进建议
   */
  private generateQualityRecommendations(dataQuality: any): string[] {
    const recommendations: string[] = [];
    
    if (!dataQuality) {
      recommendations.push('Enable data quality monitoring');
      return recommendations;
    }
    
    if (dataQuality.completeness < 80) {
      recommendations.push('Configure additional API keys to improve data completeness');
    }
    
    if (dataQuality.freshness < 80) {
      recommendations.push('Reduce cache TTL or increase update frequency');
    }
    
    if (dataQuality.reliability < 80) {
      recommendations.push('Check network connectivity and API rate limits');
    }
    
    if (dataQuality.sources.length < 3) {
      recommendations.push('Enable more data sources for better coverage');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Data quality is excellent, no improvements needed');
    }
    
    return recommendations;
  }
  
  /**
   * 获取详细数据质量报告
   */
  private async getDetailedQualityReport(req: express.Request, res: express.Response): Promise<void> {
    try {
      const sourceName = req.params.sourceName;
      
      const qualityReport = dataQualityManager.getQualityReport(sourceName);
      
      const response: ApiResponse = {
        success: true,
        data: qualityReport,
        timestamp: Date.now()
      };
      
      res.json(response);
      
    } catch (error) {
      console.error('[EnhancedDataAPI] Failed to get detailed quality report:', error);
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }
  
  /**
   * 获取数据融合配置
   */
  private async getFusionConfig(req: express.Request, res: express.Response): Promise<void> {
    try {
      const config = dataQualityManager.getFusionConfig();
      
      const response: ApiResponse = {
        success: true,
        data: config,
        timestamp: Date.now()
      };
      
      res.json(response);
      
    } catch (error) {
      console.error('[EnhancedDataAPI] Failed to get fusion config:', error);
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }
  
  /**
   * 更新数据融合配置
   */
  private async updateFusionConfig(req: express.Request, res: express.Response): Promise<void> {
    try {
      const newConfig = req.body;
      
      dataQualityManager.updateFusionConfig(newConfig);
      const updatedConfig = dataQualityManager.getFusionConfig();
      
      const response: ApiResponse = {
        success: true,
        data: updatedConfig,
        timestamp: Date.now()
      };
      
      res.json(response);
      
    } catch (error) {
      console.error('[EnhancedDataAPI] Failed to update fusion config:', error);
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }
  
  /**
   * 获取路由器
   */
  public getRouter(): express.Router {
    return this.router;
  }
}

// 导出单例实例
export const enhancedDataAPI = new EnhancedDataAPI();