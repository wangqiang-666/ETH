import axios, { AxiosInstance } from 'axios';
import { config } from '../config.js';
import { IDataSource, DataSourceType, DataSourceStatus } from './data-aggregator-service.js';
import { SmartCacheManager } from '../utils/smart-cache-manager.js';

/**
 * 社交情绪数据接口
 */
export interface SocialSentimentData {
  // 综合情绪指标
  overallSentiment: number;       // 综合情绪评分 (-100 到 100)
  sentimentTrend: 'bullish' | 'bearish' | 'neutral';
  confidenceLevel: number;        // 置信度 (0-100)
  
  // 各平台情绪
  twitter?: {
    sentiment: number;            // Twitter情绪 (-100 到 100)
    volume: number;              // 提及数量
    engagement: number;          // 互动数量
    influencerSentiment: number; // 影响者情绪
  };
  
  reddit?: {
    sentiment: number;           // Reddit情绪
    posts: number;              // 帖子数量
    comments: number;           // 评论数量
    upvoteRatio: number;        // 点赞比例
  };
  
  news?: {
    sentiment: number;          // 新闻情绪
    articles: number;           // 文章数量
    positiveCount: number;      // 正面新闻数量
    negativeCount: number;      // 负面新闻数量
  };
  
  // Google搜索趋势
  googleTrends?: {
    searchVolume: number;       // 搜索量指数
    trend: 'rising' | 'falling' | 'stable';
    relatedQueries: string[];   // 相关搜索
  };
  
  // 恐慌贪婪指数 (已有，但可以作为验证)
  fgi?: number;
  
  // 社交媒体活跃度
  socialActivity?: {
    totalMentions: number;      // 总提及数
    uniqueUsers: number;        // 独特用户数
    viralityScore: number;      // 病毒传播评分
    hashtagTrending: string[];  // 热门标签
  };
}

/**
 * LunarCrush API响应接口
 */
interface LunarCrushResponse {
  config: any;
  data: Array<{
    id: number;
    symbol: string;
    name: string;
    price: number;
    price_btc: number;
    volume_24h: number;
    galaxy_score: number;
    alt_rank: number;
    market_cap: number;
    percent_change_24h: number;
    social_score: number;
    social_volume: number;
    social_dominance: number;
    market_dominance: number;
    sentiment: number;
    tweets: number;
    tweet_spam: number;
    news: number;
    reddit_posts: number;
    reddit_posts_score: number;
    reddit_comments: number;
    reddit_comments_score: number;
  }>;
}

/**
 * NewsAPI响应接口
 */
interface NewsAPIResponse {
  status: string;
  totalResults: number;
  articles: Array<{
    source: { id: string; name: string };
    author: string;
    title: string;
    description: string;
    url: string;
    urlToImage: string;
    publishedAt: string;
    content: string;
  }>;
}

/**
 * Google Trends API响应接口 (简化)
 */
interface GoogleTrendsData {
  keyword: string;
  interest: number;
  trend: 'rising' | 'falling' | 'stable';
  relatedQueries: string[];
}

/**
 * 社交情绪数据服务
 * 集成多个社交媒体和新闻源，提供市场情绪分析
 */
export class SocialSentimentDataService implements IDataSource {
  public readonly name = 'SocialSentimentDataService';
  public readonly type = DataSourceType.SOCIAL_SENTIMENT;
  public isEnabled: boolean = true;
  
  private lunarCrushClient: AxiosInstance;
  private newsApiClient: AxiosInstance;
  private cacheManager: SmartCacheManager;
  
  private status: DataSourceStatus;
  private lastUpdate: number = 0;
  private errorCount: number = 0;
  private successCount: number = 0;
  private responseTimes: number[] = [];
  
  // API配置
  private readonly LUNARCRUSH_BASE_URL = 'https://api.lunarcrush.com/v2';
  private readonly NEWSAPI_BASE_URL = 'https://newsapi.org/v2';
  private readonly CACHE_TTL = 15 * 60 * 1000; // 15分钟缓存
  
  // API密钥
  private readonly lunarCrushApiKey = process.env.LUNARCRUSH_API_KEY || '';
  private readonly newsApiKey = process.env.NEWS_API_KEY || '';
  
  // 情绪分析关键词
  private readonly CRYPTO_KEYWORDS = [
    'ethereum', 'ETH', 'crypto', 'cryptocurrency', 'blockchain',
    'defi', 'smart contracts', 'web3', 'NFT', 'dapp'
  ];
  
  private readonly SENTIMENT_KEYWORDS = {
    positive: ['bullish', 'moon', 'pump', 'buy', 'hodl', 'diamond hands', 'to the moon'],
    negative: ['bearish', 'dump', 'crash', 'sell', 'panic', 'bear market', 'rekt']
  };
  
  constructor() {
    this.cacheManager = new SmartCacheManager({
      maxSize: 10 * 1024 * 1024, // 10MB
      defaultTTL: this.CACHE_TTL,
      maxItems: 500
    });
    
    this.lunarCrushClient = axios.create({
      baseURL: this.LUNARCRUSH_BASE_URL,
      timeout: 10000
    });
    
    this.newsApiClient = axios.create({
      baseURL: this.NEWSAPI_BASE_URL,
      timeout: 10000
    });
    
    this.status = {
      name: this.name,
      type: this.type,
      isActive: false,
      lastUpdate: 0,
      errorCount: 0,
      successRate: 0,
      avgResponseTime: 0
    };
    
    this.setupInterceptors();
  }
  
  /**
   * 设置请求拦截器
   */
  private setupInterceptors(): void {
    // LunarCrush拦截器
    this.lunarCrushClient.interceptors.request.use(
      (config) => {
        (config as any).metadata = { startTime: Date.now() };
        return config;
      }
    );
    
    this.lunarCrushClient.interceptors.response.use(
      (response) => {
        const responseTime = Date.now() - (response.config as any).metadata.startTime;
        this.recordSuccess(responseTime);
        return response;
      },
      (error) => {
        const responseTime = Date.now() - (error.config?.metadata?.startTime || 0);
        this.recordError(responseTime);
        return Promise.reject(error);
      }
    );
    
    // NewsAPI拦截器
    this.newsApiClient.interceptors.request.use(
      (config) => {
        (config as any).metadata = { startTime: Date.now() };
        return config;
      }
    );
    
    this.newsApiClient.interceptors.response.use(
      (response) => {
        const responseTime = Date.now() - (response.config as any).metadata.startTime;
        this.recordSuccess(responseTime);
        return response;
      },
      (error) => {
        const responseTime = Date.now() - (error.config?.metadata?.startTime || 0);
        this.recordError(responseTime);
        return Promise.reject(error);
      }
    );
  }
  
  /**
   * 初始化服务
   */
  public async initialize(): Promise<void> {
    console.log('[SocialSentimentDataService] Initializing...');
    
    // 检查API密钥
    if (!this.lunarCrushApiKey) {
      console.warn('[SocialSentimentDataService] LunarCrush API key not found, some features will be disabled');
    }
    
    if (!this.newsApiKey) {
      console.warn('[SocialSentimentDataService] NewsAPI key not found, some features will be disabled');
    }
    
    try {
      await this.testConnections();
      this.status.isActive = true;
      console.log('[SocialSentimentDataService] Initialized successfully');
    } catch (error) {
      console.error('[SocialSentimentDataService] Failed to initialize:', error);
      this.status.isActive = false;
      // 不抛出错误，允许服务在没有API密钥的情况下运行
    }
  }
  
  /**
   * 测试API连接
   */
  private async testConnections(): Promise<void> {
    const promises: Promise<any>[] = [];
    
    // 测试LunarCrush连接
    if (this.lunarCrushApiKey) {
      promises.push(
        this.lunarCrushClient.get('/assets', {
          params: {
            key: this.lunarCrushApiKey,
            symbol: 'ETH',
            data_points: 1
          }
        })
      );
    }
    
    // 测试NewsAPI连接
    if (this.newsApiKey) {
      promises.push(
        this.newsApiClient.get('/everything', {
          params: {
            q: 'ethereum',
            apiKey: this.newsApiKey,
            pageSize: 1,
            sortBy: 'publishedAt'
          }
        })
      );
    }
    
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }
  
  /**
   * 获取社交情绪数据
   */
  public async fetchData(symbol: string = 'ETH'): Promise<SocialSentimentData> {
    const cacheKey = `social_sentiment_${symbol}`;
    
    // 尝试从缓存获取
    const cached = this.cacheManager.get(cacheKey);
    if (cached) {
      return cached as SocialSentimentData;
    }
    
    console.log(`[SocialSentimentDataService] Fetching social sentiment data for ${symbol}...`);
    
    const sentimentData: SocialSentimentData = {
      overallSentiment: 0,
      sentimentTrend: 'neutral',
      confidenceLevel: 0
    };
    
    // 并行获取各种情绪数据
    const dataPromises: Promise<void>[] = [];
    
    // 获取LunarCrush数据
    if (this.lunarCrushApiKey) {
      dataPromises.push(
        this.fetchLunarCrushData(symbol).then(data => {
          if (data) {
            sentimentData.twitter = {
              sentiment: data.sentiment || 0,
              volume: data.tweets || 0,
              engagement: data.social_volume || 0,
              influencerSentiment: data.social_score || 0
            };
            
            sentimentData.reddit = {
              sentiment: data.reddit_posts_score || 0,
              posts: data.reddit_posts || 0,
              comments: data.reddit_comments || 0,
              upvoteRatio: data.reddit_comments_score || 0
            };
          }
        }).catch(error => {
          console.warn('[SocialSentimentDataService] Failed to fetch LunarCrush data:', error.message);
        })
      );
    }
    
    // 获取新闻情绪数据
    if (this.newsApiKey) {
      dataPromises.push(
        this.fetchNewsData(symbol).then(data => {
          sentimentData.news = data;
        }).catch(error => {
          console.warn('[SocialSentimentDataService] Failed to fetch news data:', error.message);
        })
      );
    }
    
    // 模拟Google Trends数据（实际实现需要使用Google Trends API或第三方服务）
    dataPromises.push(
      this.simulateGoogleTrendsData(symbol).then(data => {
        sentimentData.googleTrends = data;
      }).catch(error => {
        console.warn('[SocialSentimentDataService] Failed to fetch Google Trends data:', error.message);
      })
    );
    
    // 等待所有数据获取完成
    await Promise.allSettled(dataPromises);
    
    // 计算综合情绪指标
    this.calculateOverallSentiment(sentimentData);
    
    // 缓存结果
    this.cacheManager.set(cacheKey, sentimentData, undefined, this.CACHE_TTL);
    this.lastUpdate = Date.now();
    
    console.log(`[SocialSentimentDataService] Fetched sentiment data:`, sentimentData);
    return sentimentData;
  }
  
  /**
   * 获取LunarCrush数据
   */
  private async fetchLunarCrushData(symbol: string): Promise<any> {
    const response = await this.lunarCrushClient.get<LunarCrushResponse>('/assets', {
      params: {
        key: this.lunarCrushApiKey,
        symbol: symbol,
        data_points: 1
      }
    });
    
    if (response.data.data && response.data.data.length > 0) {
      return response.data.data[0];
    }
    
    throw new Error(`No LunarCrush data available for symbol: ${symbol}`);
  }
  
  /**
   * 获取新闻数据并分析情绪
   */
  private async fetchNewsData(symbol: string): Promise<{
    sentiment: number;
    articles: number;
    positiveCount: number;
    negativeCount: number;
  }> {
    const keywords = symbol === 'ETH' ? 'ethereum' : symbol.toLowerCase();
    
    const response = await this.newsApiClient.get<NewsAPIResponse>('/everything', {
      params: {
        q: keywords,
        apiKey: this.newsApiKey,
        pageSize: 50,
        sortBy: 'publishedAt',
        from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // 过去24小时
      }
    });
    
    if (response.data.status === 'ok' && response.data.articles) {
      const articles = response.data.articles;
      let positiveCount = 0;
      let negativeCount = 0;
      
      // 简单的情绪分析
      articles.forEach(article => {
        const text = (article.title + ' ' + article.description).toLowerCase();
        
        const positiveWords = this.SENTIMENT_KEYWORDS.positive.filter(word => 
          text.includes(word)
        ).length;
        
        const negativeWords = this.SENTIMENT_KEYWORDS.negative.filter(word => 
          text.includes(word)
        ).length;
        
        if (positiveWords > negativeWords) {
          positiveCount++;
        } else if (negativeWords > positiveWords) {
          negativeCount++;
        }
      });
      
      const totalSentimentArticles = positiveCount + negativeCount;
      const sentiment = totalSentimentArticles > 0 
        ? ((positiveCount - negativeCount) / totalSentimentArticles) * 100
        : 0;
      
      return {
        sentiment,
        articles: articles.length,
        positiveCount,
        negativeCount
      };
    }
    
    throw new Error('No news data available');
  }
  
  /**
   * 模拟Google Trends数据
   * 实际实现应该使用Google Trends API或第三方服务
   */
  private async simulateGoogleTrendsData(symbol: string): Promise<{
    searchVolume: number;
    trend: 'rising' | 'falling' | 'stable';
    relatedQueries: string[];
  }> {
    // 这里是模拟数据，实际应该调用Google Trends API
    const baseVolume = 50 + Math.random() * 50;
    const trend = Math.random() > 0.6 ? 'rising' : Math.random() > 0.3 ? 'stable' : 'falling';
    
    return {
      searchVolume: baseVolume,
      trend,
      relatedQueries: [
        `${symbol} price`,
        `${symbol} prediction`,
        `buy ${symbol}`,
        `${symbol} news`
      ]
    };
  }
  
  /**
   * 计算综合情绪指标
   */
  private calculateOverallSentiment(data: SocialSentimentData): void {
    const sentiments: number[] = [];
    const weights: number[] = [];
    
    // Twitter情绪 (权重: 30%)
    if (data.twitter?.sentiment !== undefined) {
      sentiments.push(data.twitter.sentiment);
      weights.push(0.3);
    }
    
    // Reddit情绪 (权重: 25%)
    if (data.reddit?.sentiment !== undefined) {
      sentiments.push(data.reddit.sentiment);
      weights.push(0.25);
    }
    
    // 新闻情绪 (权重: 35%)
    if (data.news?.sentiment !== undefined) {
      sentiments.push(data.news.sentiment);
      weights.push(0.35);
    }
    
    // Google Trends (权重: 10%)
    if (data.googleTrends?.trend) {
      const trendSentiment = data.googleTrends.trend === 'rising' ? 20 : 
                            data.googleTrends.trend === 'falling' ? -20 : 0;
      sentiments.push(trendSentiment);
      weights.push(0.1);
    }
    
    // 计算加权平均
    if (sentiments.length > 0) {
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      const weightedSum = sentiments.reduce((sum, sentiment, i) => 
        sum + sentiment * weights[i], 0
      );
      
      data.overallSentiment = weightedSum / totalWeight;
      data.confidenceLevel = Math.min(100, sentiments.length * 25); // 基于数据源数量
      
      // 确定趋势
      if (data.overallSentiment > 10) {
        data.sentimentTrend = 'bullish';
      } else if (data.overallSentiment < -10) {
        data.sentimentTrend = 'bearish';
      } else {
        data.sentimentTrend = 'neutral';
      }
    }
  }
  
  /**
   * 记录成功请求
   */
  private recordSuccess(responseTime: number): void {
    this.successCount++;
    this.responseTimes.push(responseTime);
    
    if (this.responseTimes.length > 100) {
      this.responseTimes.shift();
    }
    
    this.updateStatus();
  }
  
  /**
   * 记录错误请求
   */
  private recordError(responseTime: number): void {
    this.errorCount++;
    this.responseTimes.push(responseTime);
    
    if (this.responseTimes.length > 100) {
      this.responseTimes.shift();
    }
    
    this.updateStatus();
  }
  
  /**
   * 更新状态
   */
  private updateStatus(): void {
    const totalRequests = this.successCount + this.errorCount;
    
    this.status = {
      ...this.status,
      lastUpdate: this.lastUpdate,
      errorCount: this.errorCount,
      successRate: totalRequests > 0 ? this.successCount / totalRequests : 0,
      avgResponseTime: this.responseTimes.length > 0 
        ? this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length 
        : 0
    };
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
    console.log('[SocialSentimentDataService] Shutting down...');
    this.status.isActive = false;
    this.cacheManager.clear();
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
    console.log('[SocialSentimentDataService] Cache cleared');
  }
}

// 导出单例实例
export const socialSentimentDataService = new SocialSentimentDataService();