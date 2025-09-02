import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 缓存项接口
 */
interface CacheItem {
  data: any;
  timestamp: number;
  ttl: number;
  accessCount: number;
  lastAccessed: number;
  size: number;
  compressed?: boolean;
  priority: 'low' | 'medium' | 'high';
}

/**
 * 缓存统计信息
 */
interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  totalSize: number;
  itemCount: number;
  hitRate: number;
  avgResponseTime: number;
  memoryUsage: number;
}

/**
 * 缓存配置
 */
interface CacheConfig {
  maxSize: number; // 最大缓存大小（字节）
  maxItems: number; // 最大缓存项数
  defaultTTL: number; // 默认TTL（毫秒）
  cleanupInterval: number; // 清理间隔（毫秒）
  persistToDisk: boolean; // 是否持久化到磁盘
  diskCachePath?: string; // 磁盘缓存路径
  compressionThreshold: number; // 压缩阈值（字节）
}

/**
 * 智能缓存管理器
 */
export class SmartCacheManager {
  private cache: Map<string, CacheItem> = new Map();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    totalSize: 0,
    itemCount: 0,
    hitRate: 0,
    avgResponseTime: 0,
    memoryUsage: 0
  };
  private config: CacheConfig;
  private cleanupTimer?: NodeJS.Timeout;
  private responseTimes: number[] = [];

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxSize: 100 * 1024 * 1024, // 100MB
      maxItems: 10000,
      defaultTTL: 5 * 60 * 1000, // 5分钟
      cleanupInterval: 60 * 1000, // 1分钟
      persistToDisk: true,
      diskCachePath: path.join(process.cwd(), 'cache'),
      compressionThreshold: 1024, // 1KB
      ...config
    };

    this.startCleanupTimer();
    this.loadFromDisk();
  }

  /**
   * 生成缓存键
   */
  private generateKey(endpoint: string, params?: any): string {
    const baseKey = endpoint;
    if (params) {
      const paramString = JSON.stringify(params, Object.keys(params).sort());
      const hash = createHash('md5').update(paramString).digest('hex');
      return `${baseKey}:${hash}`;
    }
    return baseKey;
  }

  /**
   * 计算数据大小
   */
  private calculateSize(data: any): number {
    return Buffer.byteLength(JSON.stringify(data), 'utf8');
  }

  /**
   * 确定缓存优先级
   */
  private determinePriority(endpoint: string): 'low' | 'medium' | 'high' {
    // 市场数据高优先级
    if (endpoint.includes('/market/') || endpoint.includes('/ticker')) {
      return 'high';
    }
    // 公共数据中等优先级
    if (endpoint.includes('/public/')) {
      return 'medium';
    }
    // 其他数据低优先级
    return 'low';
  }

  /**
   * 获取TTL
   */
  private getTTL(endpoint: string): number {
    // 不同类型数据使用不同TTL
    if (endpoint.includes('/public/time')) {
      return 60 * 1000; // 1分钟
    }
    if (endpoint.includes('/market/ticker')) {
      return 5 * 1000; // 5秒
    }
    if (endpoint.includes('/market/books')) {
      return 2 * 1000; // 2秒
    }
    if (endpoint.includes('/market/candles')) {
      return 30 * 1000; // 30秒
    }
    return this.config.defaultTTL;
  }

  /**
   * 设置缓存
   */
  set(endpoint: string, data: any, params?: any, customTTL?: number): void {
    const key = this.generateKey(endpoint, params);
    const size = this.calculateSize(data);
    const ttl = customTTL || this.getTTL(endpoint);
    const priority = this.determinePriority(endpoint);
    const now = Date.now();

    // 检查是否需要压缩
    const compressed = size > this.config.compressionThreshold;

    const item: CacheItem = {
      data,
      timestamp: now,
      ttl,
      accessCount: 0,
      lastAccessed: now,
      size,
      compressed,
      priority
    };

    // 检查缓存容量
    this.ensureCapacity(size);

    // 更新统计
    if (this.cache.has(key)) {
      this.stats.totalSize -= this.cache.get(key)!.size;
    } else {
      this.stats.itemCount++;
    }

    this.cache.set(key, item);
    this.stats.totalSize += size;

    // 持久化到磁盘
    if (this.config.persistToDisk && priority === 'high') {
      this.saveToDisk(key, item);
    }
  }

  /**
   * 获取缓存
   */
  get(endpoint: string, params?: any): any | null {
    const startTime = Date.now();
    const key = this.generateKey(endpoint, params);
    const item = this.cache.get(key);

    if (!item) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    const now = Date.now();
    
    // 检查是否过期
    if (now - item.timestamp > item.ttl) {
      this.cache.delete(key);
      this.stats.totalSize -= item.size;
      this.stats.itemCount--;
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    // 更新访问信息
    item.accessCount++;
    item.lastAccessed = now;
    this.stats.hits++;
    
    const responseTime = Date.now() - startTime;
    this.responseTimes.push(responseTime);
    if (this.responseTimes.length > 1000) {
      this.responseTimes = this.responseTimes.slice(-1000);
    }
    
    this.updateHitRate();
    this.updateAvgResponseTime();
    
    return item.data;
  }

  /**
   * 删除缓存
   */
  delete(endpoint: string, params?: any): boolean {
    const key = this.generateKey(endpoint, params);
    const item = this.cache.get(key);
    
    if (item) {
      this.cache.delete(key);
      this.stats.totalSize -= item.size;
      this.stats.itemCount--;
      return true;
    }
    
    return false;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.stats.totalSize = 0;
    this.stats.itemCount = 0;
    this.stats.evictions = 0;
  }

  /**
   * 确保缓存容量
   */
  private ensureCapacity(newItemSize: number): void {
    // 检查大小限制
    while (this.stats.totalSize + newItemSize > this.config.maxSize || 
           this.stats.itemCount >= this.config.maxItems) {
      this.evictLeastUseful();
    }
  }

  /**
   * 驱逐最不有用的缓存项
   */
  private evictLeastUseful(): void {
    if (this.cache.size === 0) return;

    let leastUsefulKey: string | null = null;
    let leastUsefulScore = Infinity;
    const now = Date.now();

    for (const [key, item] of this.cache.entries()) {
      // 计算有用性分数（越低越不有用）
      const ageScore = (now - item.lastAccessed) / item.ttl; // 年龄分数
      const accessScore = 1 / (item.accessCount + 1); // 访问频率分数
      const priorityScore = item.priority === 'high' ? 0.1 : 
                           item.priority === 'medium' ? 0.5 : 1.0; // 优先级分数
      const sizeScore = item.size / (1024 * 1024); // 大小分数（MB）
      
      const totalScore = ageScore + accessScore + priorityScore + sizeScore * 0.1;
      
      if (totalScore < leastUsefulScore) {
        leastUsefulScore = totalScore;
        leastUsefulKey = key;
      }
    }

    if (leastUsefulKey) {
      const item = this.cache.get(leastUsefulKey)!;
      this.cache.delete(leastUsefulKey);
      this.stats.totalSize -= item.size;
      this.stats.itemCount--;
      this.stats.evictions++;
    }
  }

  /**
   * 清理过期缓存
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > item.ttl) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const item = this.cache.get(key)!;
      this.cache.delete(key);
      this.stats.totalSize -= item.size;
      this.stats.itemCount--;
    }
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
      this.updateMemoryUsage();
    }, this.config.cleanupInterval);
  }

  /**
   * 停止清理定时器
   */
  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * 更新命中率
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * 更新平均响应时间
   */
  private updateAvgResponseTime(): void {
    if (this.responseTimes.length > 0) {
      const sum = this.responseTimes.reduce((a, b) => a + b, 0);
      this.stats.avgResponseTime = sum / this.responseTimes.length;
    }
  }

  /**
   * 更新内存使用情况
   */
  private updateMemoryUsage(): void {
    const used = process.memoryUsage();
    this.stats.memoryUsage = used.heapUsed;
  }

  /**
   * 保存到磁盘
   */
  private saveToDisk(key: string, item: CacheItem): void {
    if (!this.config.diskCachePath) return;

    try {
      if (!fs.existsSync(this.config.diskCachePath)) {
        fs.mkdirSync(this.config.diskCachePath, { recursive: true });
      }

      const filename = createHash('md5').update(key).digest('hex') + '.json';
      const filepath = path.join(this.config.diskCachePath, filename);
      
      fs.writeFileSync(filepath, JSON.stringify({
        key,
        item,
        savedAt: Date.now()
      }));
    } catch (error) {
      console.warn('Failed to save cache to disk:', error);
    }
  }

  /**
   * 从磁盘加载
   */
  private loadFromDisk(): void {
    if (!this.config.persistToDisk || !this.config.diskCachePath) return;

    try {
      if (!fs.existsSync(this.config.diskCachePath)) return;

      const files = fs.readdirSync(this.config.diskCachePath);
      const now = Date.now();

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const filepath = path.join(this.config.diskCachePath, file);
          const content = fs.readFileSync(filepath, 'utf8');
          const { key, item, savedAt } = JSON.parse(content);

          // 检查是否过期
          if (now - savedAt < item.ttl) {
            this.cache.set(key, item);
            this.stats.totalSize += item.size;
            this.stats.itemCount++;
          } else {
            // 删除过期的磁盘缓存
            fs.unlinkSync(filepath);
          }
        } catch (error) {
          console.warn(`Failed to load cache file ${file}:`, error);
        }
      }
    } catch (error) {
      console.warn('Failed to load cache from disk:', error);
    }
  }

  /**
   * 获取缓存统计
   */
  getStats(): CacheStats {
    this.updateMemoryUsage();
    return { ...this.stats };
  }

  /**
   * 获取缓存详情
   */
  getCacheDetails(): any {
    const details: any = {};
    
    for (const [key, item] of this.cache.entries()) {
      details[key] = {
        size: item.size,
        accessCount: item.accessCount,
        lastAccessed: new Date(item.lastAccessed).toISOString(),
        ttl: item.ttl,
        priority: item.priority,
        compressed: item.compressed
      };
    }
    
    return details;
  }

  /**
   * 预热缓存
   */
  async warmup(endpoints: Array<{ endpoint: string; params?: any }>): Promise<void> {
    console.log(`Starting cache warmup for ${endpoints.length} endpoints...`);
    
    for (const { endpoint, params } of endpoints) {
      const key = this.generateKey(endpoint, params);
      if (!this.cache.has(key)) {
        // 这里可以添加实际的API调用来预热缓存
        console.log(`Warming up cache for: ${endpoint}`);
      }
    }
    
    console.log('Cache warmup completed.');
  }

  /**
   * 销毁缓存管理器
   */
  destroy(): void {
    this.stopCleanupTimer();
    this.clear();
  }
}

/**
 * 创建默认缓存管理器实例
 */
export const defaultCacheManager = new SmartCacheManager({
  maxSize: 200 * 1024 * 1024, // 200MB
  maxItems: 20000,
  defaultTTL: 5 * 60 * 1000, // 5分钟
  cleanupInterval: 30 * 1000, // 30秒
  persistToDisk: true,
  compressionThreshold: 2048 // 2KB
});