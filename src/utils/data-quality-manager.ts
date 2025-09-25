import { EventEmitter } from 'events';

/**
 * 数据质量指标接口
 */
export interface DataQualityMetrics {
  completeness: number;      // 完整性 (0-100)
  accuracy: number;          // 准确性 (0-100)
  consistency: number;       // 一致性 (0-100)
  timeliness: number;        // 及时性 (0-100)
  validity: number;          // 有效性 (0-100)
  reliability: number;       // 可靠性 (0-100)
  overall: number;           // 总体质量分数 (0-100)
}

/**
 * 数据源质量状态
 */
export interface DataSourceQuality {
  sourceName: string;
  sourceType: string;
  lastUpdate: number;
  metrics: DataQualityMetrics;
  anomalies: DataAnomaly[];
  confidence: number;        // 数据源置信度 (0-1)
}

/**
 * 数据异常接口
 */
export interface DataAnomaly {
  id: string;
  type: 'missing' | 'outlier' | 'inconsistent' | 'stale' | 'invalid';
  severity: 'low' | 'medium' | 'high' | 'critical';
  field: string;
  value: any;
  expectedRange?: [number, number];
  timestamp: number;
  description: string;
  resolved: boolean;
}

/**
 * 数据融合配置
 */
export interface DataFusionConfig {
  conflictResolution: 'weighted_average' | 'highest_confidence' | 'latest' | 'consensus';
  weightingStrategy: 'reliability' | 'recency' | 'accuracy' | 'custom';
  customWeights?: Record<string, number>;
  outlierThreshold: number;  // 异常值阈值 (标准差倍数)
  consensusThreshold: number; // 共识阈值 (0-1)
}

/**
 * 数据质量管理器
 * 负责数据质量评估、异常检测和多数据源融合
 */
export class DataQualityManager extends EventEmitter {
  private qualityHistory: Map<string, DataQualityMetrics[]> = new Map();
  private anomalyHistory: Map<string, DataAnomaly[]> = new Map();
  private sourceReliability: Map<string, number> = new Map();
  private fusionConfig: DataFusionConfig;
  
  // 质量阈值配置
  private readonly QUALITY_THRESHOLDS = {
    excellent: 90,
    good: 75,
    acceptable: 60,
    poor: 40,
    critical: 20
  };
  
  // 异常检测参数
  private readonly ANOMALY_PARAMS = {
    outlierThreshold: 3,        // 3倍标准差
    stalenessThreshold: 300000, // 5分钟
    missingThreshold: 0.1,      // 10%缺失率
    consistencyThreshold: 0.8   // 80%一致性
  };
  
  constructor(fusionConfig?: Partial<DataFusionConfig>) {
    super();
    
    this.fusionConfig = {
      conflictResolution: 'weighted_average',
      weightingStrategy: 'reliability',
      outlierThreshold: 3,
      consensusThreshold: 0.7,
      ...fusionConfig
    };
    
    this.initializeSourceReliability();
  }
  
  /**
   * 初始化数据源可靠性
   */
  private initializeSourceReliability(): void {
    // 基于历史表现设置初始可靠性
    this.sourceReliability.set('OKX', 0.95);
    this.sourceReliability.set('Binance', 0.92);
    this.sourceReliability.set('Bybit', 0.88);
    this.sourceReliability.set('Etherscan', 0.90);
    this.sourceReliability.set('AlphaVantage', 0.85);
    this.sourceReliability.set('FRED', 0.93);
    this.sourceReliability.set('NewsAPI', 0.75);
    this.sourceReliability.set('Deribit', 0.87);
    this.sourceReliability.set('DefiLlama', 0.82);
    this.sourceReliability.set('WhaleAlert', 0.80);
  }
  
  /**
   * 评估数据质量
   */
  public assessDataQuality(data: any, sourceName: string, sourceType: string): DataSourceQuality {
    const metrics = this.calculateQualityMetrics(data, sourceName);
    const anomalies = this.detectAnomalies(data, sourceName);
    const confidence = this.calculateConfidence(metrics, anomalies);
    
    // 更新历史记录
    this.updateQualityHistory(sourceName, metrics);
    this.updateAnomalyHistory(sourceName, anomalies);
    
    // 更新数据源可靠性
    this.updateSourceReliability(sourceName, metrics.overall);
    
    const quality: DataSourceQuality = {
      sourceName,
      sourceType,
      lastUpdate: Date.now(),
      metrics,
      anomalies,
      confidence
    };
    
    // 发出质量评估事件
    this.emit('qualityAssessed', quality);
    
    // 如果质量过低，发出警告
    if (metrics.overall < this.QUALITY_THRESHOLDS.acceptable) {
      this.emit('qualityWarning', quality);
    }
    
    return quality;
  }
  
  /**
   * 计算数据质量指标
   */
  private calculateQualityMetrics(data: any, sourceName: string): DataQualityMetrics {
    const completeness = this.calculateCompleteness(data);
    const accuracy = this.calculateAccuracy(data, sourceName);
    const consistency = this.calculateConsistency(data, sourceName);
    const timeliness = this.calculateTimeliness(data);
    const validity = this.calculateValidity(data);
    const reliability = this.sourceReliability.get(sourceName) || 0.5;
    
    // 加权计算总体质量分数
    const overall = (
      completeness * 0.2 +
      accuracy * 0.25 +
      consistency * 0.2 +
      timeliness * 0.15 +
      validity * 0.1 +
      reliability * 100 * 0.1
    );
    
    return {
      completeness,
      accuracy,
      consistency,
      timeliness,
      validity,
      reliability: reliability * 100,
      overall: Math.min(100, Math.max(0, overall))
    };
  }
  
  /**
   * 计算数据完整性
   */
  private calculateCompleteness(data: any): number {
    if (!data || typeof data !== 'object') return 0;
    
    const fields = Object.keys(data);
    if (fields.length === 0) return 0;
    
    const nonNullFields = fields.filter(field => {
      const value = data[field];
      return value !== null && value !== undefined && value !== '';
    });
    
    return (nonNullFields.length / fields.length) * 100;
  }
  
  /**
   * 计算数据准确性
   */
  private calculateAccuracy(data: any, sourceName: string): number {
    // 基于历史准确性和当前数据合理性
    let accuracy = 80; // 基础准确性
    
    // 检查数值合理性
    if (data.price && (data.price <= 0 || data.price > 1000000)) {
      accuracy -= 20;
    }
    
    if (data.volume && data.volume < 0) {
      accuracy -= 15;
    }
    
    // 基于数据源历史表现调整
    const reliability = this.sourceReliability.get(sourceName) || 0.5;
    accuracy = accuracy * (0.5 + reliability * 0.5);
    
    return Math.min(100, Math.max(0, accuracy));
  }
  
  /**
   * 计算数据一致性
   */
  private calculateConsistency(data: any, sourceName: string): number {
    // 与历史数据的一致性检查
    const history = this.qualityHistory.get(sourceName) || [];
    if (history.length === 0) return 85; // 默认一致性
    
    // 检查数据变化的合理性
    let consistency = 90;
    
    // 价格变化合理性检查
    if (data.price && data.previousPrice) {
      const changePercent = Math.abs((data.price - data.previousPrice) / data.previousPrice);
      if (changePercent > 0.1) { // 10%以上变化
        consistency -= 20;
      }
    }
    
    return Math.min(100, Math.max(0, consistency));
  }
  
  /**
   * 计算数据及时性
   */
  private calculateTimeliness(data: any): number {
    if (!data.timestamp) return 50; // 无时间戳默认50分
    
    const now = Date.now();
    const dataAge = now - data.timestamp;
    
    // 根据数据年龄计算及时性
    if (dataAge < 30000) return 100;      // 30秒内 - 优秀
    if (dataAge < 60000) return 90;       // 1分钟内 - 良好
    if (dataAge < 300000) return 75;      // 5分钟内 - 可接受
    if (dataAge < 900000) return 50;      // 15分钟内 - 一般
    return 25;                            // 超过15分钟 - 差
  }
  
  /**
   * 计算数据有效性
   */
  private calculateValidity(data: any): number {
    let validity = 100;
    
    // 检查必要字段
    if (!data.timestamp) validity -= 20;
    if (!data.symbol && !data.currency) validity -= 15;
    
    // 检查数据类型
    if (data.price && typeof data.price !== 'number') validity -= 15;
    if (data.volume && typeof data.volume !== 'number') validity -= 10;
    
    // 检查数值范围
    if (data.price && (data.price <= 0 || !isFinite(data.price))) validity -= 25;
    if (data.volume && (data.volume < 0 || !isFinite(data.volume))) validity -= 15;
    
    return Math.min(100, Math.max(0, validity));
  }
  
  /**
   * 检测数据异常
   */
  private detectAnomalies(data: any, sourceName: string): DataAnomaly[] {
    const anomalies: DataAnomaly[] = [];
    
    // 检测缺失值异常
    anomalies.push(...this.detectMissingValues(data, sourceName));
    
    // 检测异常值
    anomalies.push(...this.detectOutliers(data, sourceName));
    
    // 检测过期数据
    anomalies.push(...this.detectStaleData(data, sourceName));
    
    // 检测无效值
    anomalies.push(...this.detectInvalidValues(data, sourceName));
    
    return anomalies;
  }
  
  /**
   * 检测缺失值
   */
  private detectMissingValues(data: any, sourceName: string): DataAnomaly[] {
    const anomalies: DataAnomaly[] = [];
    const requiredFields = ['timestamp', 'symbol'];
    
    requiredFields.forEach(field => {
      if (!data[field]) {
        anomalies.push({
          id: `missing_${field}_${Date.now()}`,
          type: 'missing',
          severity: 'high',
          field,
          value: data[field],
          timestamp: Date.now(),
          description: `Required field '${field}' is missing`,
          resolved: false
        });
      }
    });
    
    return anomalies;
  }
  
  /**
   * 检测异常值
   */
  private detectOutliers(data: any, sourceName: string): DataAnomaly[] {
    const anomalies: DataAnomaly[] = [];
    
    // 价格异常检测
    if (data.price) {
      const expectedRange = this.getExpectedRange(sourceName, 'price');
      if (expectedRange && (data.price < expectedRange[0] || data.price > expectedRange[1])) {
        anomalies.push({
          id: `outlier_price_${Date.now()}`,
          type: 'outlier',
          severity: 'medium',
          field: 'price',
          value: data.price,
          expectedRange,
          timestamp: Date.now(),
          description: `Price ${data.price} is outside expected range [${expectedRange[0]}, ${expectedRange[1]}]`,
          resolved: false
        });
      }
    }
    
    return anomalies;
  }
  
  /**
   * 检测过期数据
   */
  private detectStaleData(data: any, sourceName: string): DataAnomaly[] {
    const anomalies: DataAnomaly[] = [];
    
    if (data.timestamp) {
      const age = Date.now() - data.timestamp;
      if (age > this.ANOMALY_PARAMS.stalenessThreshold) {
        anomalies.push({
          id: `stale_${Date.now()}`,
          type: 'stale',
          severity: age > 600000 ? 'high' : 'medium', // 10分钟以上为高严重性
          field: 'timestamp',
          value: data.timestamp,
          timestamp: Date.now(),
          description: `Data is ${Math.round(age / 1000)} seconds old`,
          resolved: false
        });
      }
    }
    
    return anomalies;
  }
  
  /**
   * 检测无效值
   */
  private detectInvalidValues(data: any, sourceName: string): DataAnomaly[] {
    const anomalies: DataAnomaly[] = [];
    
    // 检测无效数值
    ['price', 'volume', 'change24h'].forEach(field => {
      if (data[field] !== undefined && (!isFinite(data[field]) || isNaN(data[field]))) {
        anomalies.push({
          id: `invalid_${field}_${Date.now()}`,
          type: 'invalid',
          severity: 'high',
          field,
          value: data[field],
          timestamp: Date.now(),
          description: `Invalid numeric value for field '${field}': ${data[field]}`,
          resolved: false
        });
      }
    });
    
    return anomalies;
  }
  
  /**
   * 多数据源融合
   */
  public fuseMultipleDataSources(dataSources: Array<{data: any, quality: DataSourceQuality}>): any {
    if (dataSources.length === 0) return null;
    if (dataSources.length === 1) return dataSources[0].data;
    
    // 过滤低质量数据源
    const validSources = dataSources.filter(source => 
      source.quality.metrics.overall >= this.QUALITY_THRESHOLDS.poor
    );
    
    if (validSources.length === 0) {
      console.warn('[DataQualityManager] All data sources have poor quality');
      return dataSources[0].data; // 返回第一个数据源作为后备
    }
    
    // 根据配置选择融合策略
    switch (this.fusionConfig.conflictResolution) {
      case 'highest_confidence':
        return this.fuseByHighestConfidence(validSources);
      case 'latest':
        return this.fuseByLatest(validSources);
      case 'consensus':
        return this.fuseByConsensus(validSources);
      case 'weighted_average':
      default:
        return this.fuseByWeightedAverage(validSources);
    }
  }
  
  /**
   * 加权平均融合
   */
  private fuseByWeightedAverage(sources: Array<{data: any, quality: DataSourceQuality}>): any {
    const result: any = {};
    const weights = this.calculateWeights(sources);
    
    // 融合数值字段
    const numericFields = ['price', 'volume', 'change24h', 'high24h', 'low24h'];
    
    numericFields.forEach(field => {
      const values = sources
        .map((source, index) => ({
          value: source.data[field],
          weight: weights[index]
        }))
        .filter(item => typeof item.value === 'number' && isFinite(item.value));
      
      if (values.length > 0) {
        const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
        const weightedSum = values.reduce((sum, item) => sum + item.value * item.weight, 0);
        result[field] = weightedSum / totalWeight;
      }
    });
    
    // 使用最高质量数据源的非数值字段
    const bestSource = sources.reduce((best, current) => 
      current.quality.metrics.overall > best.quality.metrics.overall ? current : best
    );
    
    ['symbol', 'timestamp', 'fundingRate'].forEach(field => {
      if (bestSource.data[field] !== undefined) {
        result[field] = bestSource.data[field];
      }
    });
    
    return result;
  }
  
  /**
   * 最高置信度融合
   */
  private fuseByHighestConfidence(sources: Array<{data: any, quality: DataSourceQuality}>): any {
    const bestSource = sources.reduce((best, current) => 
      current.quality.confidence > best.quality.confidence ? current : best
    );
    return bestSource.data;
  }
  
  /**
   * 最新数据融合
   */
  private fuseByLatest(sources: Array<{data: any, quality: DataSourceQuality}>): any {
    const latestSource = sources.reduce((latest, current) => 
      (current.data.timestamp || 0) > (latest.data.timestamp || 0) ? current : latest
    );
    return latestSource.data;
  }
  
  /**
   * 共识融合
   */
  private fuseByConsensus(sources: Array<{data: any, quality: DataSourceQuality}>): any {
    // 简化的共识算法：选择大多数数据源一致的值
    const result: any = {};
    
    // 对于数值字段，使用中位数
    const numericFields = ['price', 'volume', 'change24h'];
    
    numericFields.forEach(field => {
      const values = sources
        .map(source => source.data[field])
        .filter(value => typeof value === 'number' && isFinite(value))
        .sort((a, b) => a - b);
      
      if (values.length > 0) {
        const mid = Math.floor(values.length / 2);
        result[field] = values.length % 2 === 0 
          ? (values[mid - 1] + values[mid]) / 2 
          : values[mid];
      }
    });
    
    // 使用最高质量数据源的其他字段
    const bestSource = sources.reduce((best, current) => 
      current.quality.metrics.overall > best.quality.metrics.overall ? current : best
    );
    
    Object.keys(bestSource.data).forEach(field => {
      if (!numericFields.includes(field)) {
        result[field] = bestSource.data[field];
      }
    });
    
    return result;
  }
  
  /**
   * 计算数据源权重
   */
  private calculateWeights(sources: Array<{data: any, quality: DataSourceQuality}>): number[] {
    switch (this.fusionConfig.weightingStrategy) {
      case 'recency':
        return this.calculateRecencyWeights(sources);
      case 'accuracy':
        return this.calculateAccuracyWeights(sources);
      case 'custom':
        return this.calculateCustomWeights(sources);
      case 'reliability':
      default:
        return this.calculateReliabilityWeights(sources);
    }
  }
  
  /**
   * 基于可靠性的权重
   */
  private calculateReliabilityWeights(sources: Array<{data: any, quality: DataSourceQuality}>): number[] {
    const reliabilities = sources.map(source => source.quality.metrics.reliability / 100);
    const totalReliability = reliabilities.reduce((sum, r) => sum + r, 0);
    
    return reliabilities.map(r => r / totalReliability);
  }
  
  /**
   * 基于时效性的权重
   */
  private calculateRecencyWeights(sources: Array<{data: any, quality: DataSourceQuality}>): number[] {
    const now = Date.now();
    const recencyScores = sources.map(source => {
      const age = now - (source.data.timestamp || 0);
      return Math.exp(-age / 300000); // 5分钟衰减
    });
    
    const totalScore = recencyScores.reduce((sum, score) => sum + score, 0);
    return recencyScores.map(score => score / totalScore);
  }
  
  /**
   * 基于准确性的权重
   */
  private calculateAccuracyWeights(sources: Array<{data: any, quality: DataSourceQuality}>): number[] {
    const accuracies = sources.map(source => source.quality.metrics.accuracy / 100);
    const totalAccuracy = accuracies.reduce((sum, a) => sum + a, 0);
    
    return accuracies.map(a => a / totalAccuracy);
  }
  
  /**
   * 自定义权重
   */
  private calculateCustomWeights(sources: Array<{data: any, quality: DataSourceQuality}>): number[] {
    const weights = sources.map(source => 
      this.fusionConfig.customWeights?.[source.quality.sourceName] || 1
    );
    
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    return weights.map(w => w / totalWeight);
  }
  
  /**
   * 获取预期范围
   */
  private getExpectedRange(sourceName: string, field: string): [number, number] | null {
    // 基于历史数据和常识设置预期范围
    if (field === 'price') {
      if (sourceName.includes('ETH')) {
        return [100, 10000]; // ETH价格范围
      }
      if (sourceName.includes('BTC')) {
        return [10000, 200000]; // BTC价格范围
      }
    }
    
    return null;
  }
  
  /**
   * 更新质量历史
   */
  private updateQualityHistory(sourceName: string, metrics: DataQualityMetrics): void {
    const history = this.qualityHistory.get(sourceName) || [];
    history.push(metrics);
    
    // 保留最近100条记录
    if (history.length > 100) {
      history.shift();
    }
    
    this.qualityHistory.set(sourceName, history);
  }
  
  /**
   * 更新异常历史
   */
  private updateAnomalyHistory(sourceName: string, anomalies: DataAnomaly[]): void {
    const history = this.anomalyHistory.get(sourceName) || [];
    history.push(...anomalies);
    
    // 保留最近500条记录
    if (history.length > 500) {
      history.splice(0, history.length - 500);
    }
    
    this.anomalyHistory.set(sourceName, history);
  }
  
  /**
   * 更新数据源可靠性
   */
  private updateSourceReliability(sourceName: string, qualityScore: number): void {
    const currentReliability = this.sourceReliability.get(sourceName) || 0.5;
    
    // 使用指数移动平均更新可靠性
    const alpha = 0.1; // 学习率
    const normalizedScore = qualityScore / 100;
    const newReliability = alpha * normalizedScore + (1 - alpha) * currentReliability;
    
    this.sourceReliability.set(sourceName, Math.min(1, Math.max(0, newReliability)));
  }
  
  /**
   * 计算置信度
   */
  private calculateConfidence(metrics: DataQualityMetrics, anomalies: DataAnomaly[]): number {
    let confidence = metrics.overall / 100;
    
    // 根据异常数量降低置信度
    const criticalAnomalies = anomalies.filter(a => a.severity === 'critical').length;
    const highAnomalies = anomalies.filter(a => a.severity === 'high').length;
    
    confidence -= criticalAnomalies * 0.3;
    confidence -= highAnomalies * 0.1;
    
    return Math.min(1, Math.max(0, confidence));
  }
  
  /**
   * 获取数据源质量报告
   */
  public getQualityReport(sourceName?: string): any {
    if (sourceName) {
      const history = this.qualityHistory.get(sourceName) || [];
      const anomalies = this.anomalyHistory.get(sourceName) || [];
      const reliability = this.sourceReliability.get(sourceName) || 0;
      
      return {
        sourceName,
        reliability,
        qualityHistory: history.slice(-10), // 最近10条记录
        recentAnomalies: anomalies.filter(a => !a.resolved).slice(-20), // 最近20个未解决异常
        averageQuality: history.length > 0 
          ? history.reduce((sum, m) => sum + m.overall, 0) / history.length 
          : 0
      };
    }
    
    // 返回所有数据源的汇总报告
    const allSources = Array.from(this.sourceReliability.keys());
    return allSources.map(source => this.getQualityReport(source));
  }
  
  /**
   * 清理历史数据
   */
  public cleanup(): void {
    // 清理过期的异常记录
    const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24小时前
    
    this.anomalyHistory.forEach((anomalies, sourceName) => {
      const filtered = anomalies.filter(a => a.timestamp > cutoffTime);
      this.anomalyHistory.set(sourceName, filtered);
    });
  }
  
  /**
   * 获取融合配置
   */
  public getFusionConfig(): DataFusionConfig {
    return { ...this.fusionConfig };
  }
  
  /**
   * 更新融合配置
   */
  public updateFusionConfig(config: Partial<DataFusionConfig>): void {
    this.fusionConfig = { ...this.fusionConfig, ...config };
    this.emit('configUpdated', this.fusionConfig);
  }
}

// 导出单例实例
export const dataQualityManager = new DataQualityManager();