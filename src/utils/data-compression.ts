// 数据压缩和传输优化工具
// 实现智能数据压缩、缓存和传输优化

import * as zlib from 'zlib';
import { promisify } from 'util';
import * as crypto from 'crypto';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const deflate = promisify(zlib.deflate);
const inflate = promisify(zlib.inflate);

export interface CompressionOptions {
  algorithm: 'gzip' | 'deflate' | 'brotli' | 'none';
  level: number; // 1-9, 1=fastest, 9=best compression
  threshold: number; // 最小压缩阈值（字节）
  enableCaching: boolean;
  cacheMaxSize: number;
  cacheTTL: number; // 缓存生存时间（毫秒）
}

export interface CompressionResult {
  compressed: Buffer;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  algorithm: string;
  checksum: string;
}

export interface CacheEntry {
  data: Buffer;
  timestamp: number;
  hits: number;
  size: number;
  checksum: string;
}

export class DataCompressionService {
  private cache: Map<string, CacheEntry> = new Map();
  private cacheSize = 0;
  private readonly options: CompressionOptions;
  private stats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalBytesOriginal: 0,
    totalBytesCompressed: 0,
    totalCompressionTime: 0
  };

  constructor(options: Partial<CompressionOptions> = {}) {
    this.options = {
      algorithm: 'gzip',
      level: 6, // 平衡压缩率和速度
      threshold: 1024, // 1KB以上才压缩
      enableCaching: true,
      cacheMaxSize: 50 * 1024 * 1024, // 50MB缓存
      cacheTTL: 300000, // 5分钟
      ...options
    };

    // 定期清理过期缓存
    if (this.options.enableCaching) {
      // 在测试环境中不启动定时器
      if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
        setInterval(() => this.cleanupCache(), 60000); // 每分钟清理一次
      }
    }
  }

  /**
   * 压缩数据
   */
  async compressData(data: string | Buffer, customOptions?: Partial<CompressionOptions>): Promise<CompressionResult> {
    const startTime = Date.now();
    const options = { ...this.options, ...customOptions };
    
    this.stats.totalRequests++;
    
    const inputBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const originalSize = inputBuffer.length;
    
    this.stats.totalBytesOriginal += originalSize;
    
    // 如果数据太小，不进行压缩
    if (originalSize < options.threshold) {
      const result: CompressionResult = {
        compressed: inputBuffer,
        originalSize,
        compressedSize: originalSize,
        compressionRatio: 1,
        algorithm: 'none',
        checksum: this.calculateChecksum(inputBuffer)
      };
      return result;
    }

    // 生成缓存键
    const cacheKey = this.generateCacheKey(inputBuffer, options);
    
    // 检查缓存
    if (options.enableCaching) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        return {
          compressed: cached.data,
          originalSize,
          compressedSize: cached.size,
          compressionRatio: originalSize / cached.size,
          algorithm: options.algorithm,
          checksum: cached.checksum
        };
      }
      this.stats.cacheMisses++;
    }

    // 执行压缩
    let compressed: Buffer;
    try {
      switch (options.algorithm) {
        case 'gzip':
          compressed = await gzip(inputBuffer, { level: options.level });
          break;
        case 'deflate':
          compressed = await deflate(inputBuffer, { level: options.level });
          break;
        case 'brotli':
          compressed = await this.brotliCompress(inputBuffer, options.level);
          break;
        default:
          compressed = inputBuffer;
      }
    } catch (error) {
      console.warn(`压缩失败，使用原始数据: ${error}`);
      compressed = inputBuffer;
    }

    const compressedSize = compressed.length;
    this.stats.totalBytesCompressed += compressedSize;
    this.stats.totalCompressionTime += Date.now() - startTime;

    const result: CompressionResult = {
      compressed,
      originalSize,
      compressedSize,
      compressionRatio: originalSize / compressedSize,
      algorithm: options.algorithm,
      checksum: this.calculateChecksum(compressed)
    };

    // 缓存结果
    if (options.enableCaching && compressedSize < originalSize) {
      this.addToCache(cacheKey, {
        data: compressed,
        timestamp: Date.now(),
        hits: 0,
        size: compressedSize,
        checksum: result.checksum
      });
    }

    return result;
  }

  /**
   * 解压数据
   */
  async decompressData(compressedData: Buffer, algorithm: string): Promise<Buffer> {
    if (algorithm === 'none') {
      return compressedData;
    }

    try {
      switch (algorithm) {
        case 'gzip':
          return await gunzip(compressedData);
        case 'deflate':
          return await inflate(compressedData);
        case 'brotli':
          return await this.brotliDecompress(compressedData);
        default:
          return compressedData;
      }
    } catch (error) {
      console.error(`解压失败: ${error}`);
      return compressedData;
    }
  }

  /**
   * Brotli压缩（如果可用）
   */
  private async brotliCompress(data: Buffer, level: number): Promise<Buffer> {
    try {
      const brotli = (zlib as any).brotliCompress;
      if (typeof brotli === 'function') {
        return promisify(brotli)(data, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: level
          }
        });
      }
    } catch (error) {
      console.warn('Brotli压缩不可用，回退到gzip');
    }
    return gzip(data, { level });
  }

  /**
   * Brotli解压（如果可用）
   */
  private async brotliDecompress(data: Buffer): Promise<Buffer> {
    try {
      const brotli = (zlib as any).brotliDecompress;
      if (typeof brotli === 'function') {
        return promisify(brotli)(data);
      }
    } catch (error) {
      console.warn('Brotli解压不可用，回退到gzip');
    }
    return gunzip(data);
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(data: Buffer, options: CompressionOptions): string {
    const hash = crypto.createHash('md5');
    hash.update(data);
    hash.update(JSON.stringify({
      algorithm: options.algorithm,
      level: options.level
    }));
    return hash.digest('hex');
  }

  /**
   * 计算校验和
   */
  private calculateChecksum(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  /**
   * 从缓存获取数据
   */
  private getFromCache(key: string): CacheEntry | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.options.cacheTTL) {
      this.cache.delete(key);
      this.cacheSize -= entry.size;
      return null;
    }

    entry.hits++;
    return entry;
  }

  /**
   * 添加到缓存
   */
  private addToCache(key: string, entry: CacheEntry): void {
    // 检查缓存大小限制
    while (this.cacheSize + entry.size > this.options.cacheMaxSize && this.cache.size > 0) {
      this.evictLeastUsed();
    }

    this.cache.set(key, entry);
    this.cacheSize += entry.size;
  }

  /**
   * 驱逐最少使用的缓存项
   */
  private evictLeastUsed(): void {
    let leastUsedKey = '';
    let leastHits = Infinity;
    let oldestTime = Infinity;

    for (const entry of Array.from(this.cache.entries())) {
      const [key, cacheEntry] = entry;
      if (cacheEntry.hits < leastHits || (cacheEntry.hits === leastHits && cacheEntry.timestamp < oldestTime)) {
        leastUsedKey = key;
        leastHits = cacheEntry.hits;
        oldestTime = cacheEntry.timestamp;
      }
    }

    if (leastUsedKey) {
      const entry = this.cache.get(leastUsedKey)!;
      this.cache.delete(leastUsedKey);
      this.cacheSize -= entry.size;
    }
  }

  /**
   * 清理过期缓存
   */
  private cleanupCache(): void {
    const now = Date.now();
    let cleanedCount = 0;
    let cleanedSize = 0;

    for (const entry of Array.from(this.cache.entries())) {
      const [key, cacheEntry] = entry;
      if (now - cacheEntry.timestamp > this.options.cacheTTL) {
        this.cache.delete(key);
        this.cacheSize -= cacheEntry.size;
        cleanedCount++;
        cleanedSize += cacheEntry.size;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 清理了 ${cleanedCount} 个过期缓存项，释放 ${(cleanedSize / 1024).toFixed(1)}KB 内存`);
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const cacheHitRate = this.stats.totalRequests > 0 
      ? (this.stats.cacheHits / this.stats.totalRequests * 100).toFixed(2)
      : '0.00';
    
    const avgCompressionRatio = this.stats.totalBytesOriginal > 0
      ? (this.stats.totalBytesCompressed / this.stats.totalBytesOriginal).toFixed(3)
      : '1.000';
    
    const avgCompressionTime = this.stats.totalRequests > 0
      ? (this.stats.totalCompressionTime / this.stats.totalRequests).toFixed(2)
      : '0.00';

    return {
      ...this.stats,
      cacheHitRate: cacheHitRate + '%',
      avgCompressionRatio: parseFloat(avgCompressionRatio),
      avgCompressionTime: parseFloat(avgCompressionTime) + 'ms',
      cacheSize: this.cacheSize,
      cacheEntries: this.cache.size,
      savedBytes: this.stats.totalBytesOriginal - this.stats.totalBytesCompressed
    };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalBytesOriginal: 0,
      totalBytesCompressed: 0,
      totalCompressionTime: 0
    };
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheSize = 0;
    console.log('🗑️ 压缩缓存已清空');
  }

  /**
   * 获取最佳压缩算法
   */
  static getBestCompressionAlgorithm(dataSize: number, cpuIntensive: boolean = false): 'gzip' | 'deflate' | 'brotli' {
    if (dataSize < 1024) return 'deflate'; // 小数据用deflate
    if (cpuIntensive) return 'brotli'; // CPU密集型用brotli
    return 'gzip'; // 默认用gzip
  }

  /**
   * 智能压缩选项
   */
  static getSmartCompressionOptions(dataSize: number, networkSpeed: 'slow' | 'medium' | 'fast' = 'medium'): CompressionOptions {
    const baseOptions: CompressionOptions = {
      algorithm: 'gzip',
      level: 6,
      threshold: 1024,
      enableCaching: true,
      cacheMaxSize: 50 * 1024 * 1024,
      cacheTTL: 300000
    };

    // 根据数据大小调整
    if (dataSize > 100 * 1024) { // 大于100KB
      baseOptions.level = 9; // 最高压缩率
      baseOptions.algorithm = 'brotli';
    } else if (dataSize < 5 * 1024) { // 小于5KB
      baseOptions.level = 1; // 最快速度
      baseOptions.algorithm = 'deflate';
    }

    // 根据网络速度调整
    switch (networkSpeed) {
      case 'slow':
        baseOptions.level = 9; // 慢网络优先压缩率
        baseOptions.algorithm = 'brotli';
        break;
      case 'fast':
        baseOptions.level = 1; // 快网络优先速度
        baseOptions.algorithm = 'deflate';
        break;
      default:
        // medium保持默认设置
        break;
    }

    return baseOptions;
  }

  /**
   * 估算压缩比率（不实际压缩）
   */
  estimateCompressionRatio(data: any): number {
    const jsonString = JSON.stringify(data);
    const size = Buffer.byteLength(jsonString, 'utf8');
    
    // 基于数据特征估算压缩比率
    let estimatedRatio = 0.7; // 默认30%压缩率
    
    // JSON数据通常有较好的压缩率
    if (jsonString.includes('"') && jsonString.includes('{')) {
      estimatedRatio = 0.6; // 40%压缩率
    }
    
    // 重复数据更容易压缩
    const uniqueChars = new Set(jsonString).size;
    const compressionPotential = 1 - (uniqueChars / jsonString.length);
    estimatedRatio -= compressionPotential * 0.3;
    
    return Math.max(0.3, Math.min(0.9, estimatedRatio));
  }

  /**
   * 压缩市场数据（专用优化）
   */
  compressMarketData(data: any): any {
    // 对于市场数据，我们可以进行数值精度优化
    const compressed = { ...data };
    
    // 价格数据保留6位小数
    if (typeof compressed.price === 'number') {
      compressed.price = Math.round(compressed.price * 1000000) / 1000000;
    }
    
    // 成交量保留2位小数
    if (typeof compressed.volume === 'number') {
      compressed.volume = Math.round(compressed.volume * 100) / 100;
    }
    
    // 百分比保留4位小数
    if (typeof compressed.change24h === 'number') {
      compressed.change24h = Math.round(compressed.change24h * 10000) / 10000;
    }
    
    return compressed;
  }

  /**
   * 压缩K线数据数组（专用优化）
   */
  compressKlineArray(data: any[]): any[] {
    return data.map(item => {
      const compressed = { ...item };
      
      // OHLC价格保留6位小数
      ['open', 'high', 'low', 'close'].forEach(field => {
        if (typeof compressed[field] === 'number') {
          compressed[field] = Math.round(compressed[field] * 1000000) / 1000000;
        }
      });
      
      // 成交量保留2位小数
      if (typeof compressed.volume === 'number') {
        compressed.volume = Math.round(compressed.volume * 100) / 100;
      }
      
      return compressed;
    });
  }
}

// 全局实例
export const dataCompressionService = new DataCompressionService({
  algorithm: 'gzip',
  level: 6,
  threshold: 1024,
  enableCaching: true,
  cacheMaxSize: 100 * 1024 * 1024, // 100MB
  cacheTTL: 600000 // 10分钟
});