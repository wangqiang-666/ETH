import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import path from 'path';

/**
 * 历史K线数据接口
 */
export interface HistoricalKlineData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol: string;
}

/**
 * OKX历史K线响应接口
 */
interface OKXHistoricalResponse {
  code: string;
  msg: string;
  data: string[][];
}

/**
 * 历史数据服务
 * 负责下载和管理历史K线数据
 */
export class HistoricalDataService {
  private apiClient: AxiosInstance;
  private dataDir: string;

  constructor() {
    this.apiClient = axios.create({
      baseURL: 'https://www.okx.com',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    this.dataDir = path.join(process.cwd(), 'data', 'historical');
    
    // 确保数据目录存在
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * 下载历史K线数据
   */
  async downloadHistoricalData(
    symbol: string = 'ETH-USDT-SWAP',
    timeframe: string = '1m',
    months: number = 6
  ): Promise<HistoricalKlineData[]> {
    console.log(`📥 开始下载 ${symbol} 近${months}个月的${timeframe}历史数据...`);
    
    const allData: HistoricalKlineData[] = [];
    const endTime = Date.now();
    const startTime = endTime - (months * 30 * 24 * 60 * 60 * 1000); // 近N个月
    
    let currentTime = startTime;
    const batchSize = 100; // 每次请求100根K线
    const batchInterval = this.getTimeframeMs(timeframe) * batchSize;
    
    let batchCount = 0;
    const totalBatches = Math.ceil((endTime - startTime) / batchInterval);
    
    while (currentTime < endTime) {
      try {
        const batchEndTime = Math.min(currentTime + batchInterval, endTime);
        
        console.log(`📊 下载批次 ${++batchCount}/${totalBatches} (${new Date(currentTime).toISOString().split('T')[0]})`);
        
        const response = await this.apiClient.get('/api/v5/market/history-candles', {
          params: {
            instId: symbol,
            bar: timeframe,
            before: batchEndTime.toString(),
            after: currentTime.toString(),
            limit: batchSize.toString()
          }
        });

        if (response.data.code === '0' && response.data.data.length > 0) {
          const batchData = response.data.data.map((item: string[]) => ({
            timestamp: parseInt(item[0]),
            open: parseFloat(item[1]),
            high: parseFloat(item[2]),
            low: parseFloat(item[3]),
            close: parseFloat(item[4]),
            volume: parseFloat(item[5]),
            symbol
          }));

          allData.push(...batchData);
          console.log(`✅ 已下载 ${batchData.length} 根K线，总计: ${allData.length}`);
        } else {
          console.warn(`⚠️ 批次 ${batchCount} 无数据或请求失败`);
        }

        currentTime = batchEndTime;
        
        // 避免请求过于频繁
        await this.sleep(200);
        
      } catch (error) {
        console.error(`❌ 下载批次 ${batchCount} 失败:`, error);
        await this.sleep(1000); // 错误时等待更长时间
      }
    }

    // 按时间排序
    allData.sort((a, b) => a.timestamp - b.timestamp);
    
    console.log(`🎉 历史数据下载完成！总计: ${allData.length} 根K线`);
    console.log(`📅 时间范围: ${new Date(allData[0]?.timestamp).toISOString()} - ${new Date(allData[allData.length - 1]?.timestamp).toISOString()}`);
    
    // 保存到文件
    await this.saveHistoricalData(symbol, timeframe, allData);
    
    return allData;
  }

  /**
   * 保存历史数据到文件
   */
  private async saveHistoricalData(
    symbol: string,
    timeframe: string,
    data: HistoricalKlineData[]
  ): Promise<void> {
    const filename = `${symbol}_${timeframe}_${data.length}bars.json`;
    const filepath = path.join(this.dataDir, filename);
    
    const saveData = {
      symbol,
      timeframe,
      dataCount: data.length,
      startTime: data[0]?.timestamp,
      endTime: data[data.length - 1]?.timestamp,
      downloadTime: Date.now(),
      data
    };

    fs.writeFileSync(filepath, JSON.stringify(saveData, null, 2));
    console.log(`💾 历史数据已保存到: ${filepath}`);
  }

  /**
   * 加载历史数据
   */
  async loadHistoricalData(
    symbol: string = 'ETH-USDT-SWAP',
    timeframe: string = '1m'
  ): Promise<HistoricalKlineData[] | null> {
    const files = fs.readdirSync(this.dataDir);
    const targetFile = files.find(file => 
      file.startsWith(`${symbol}_${timeframe}_`) && file.endsWith('.json')
    );

    if (!targetFile) {
      console.log(`📂 未找到 ${symbol} ${timeframe} 的历史数据文件`);
      return null;
    }

    const filepath = path.join(this.dataDir, targetFile);
    const fileContent = fs.readFileSync(filepath, 'utf-8');
    const savedData = JSON.parse(fileContent);

    console.log(`📖 加载历史数据: ${savedData.dataCount} 根K线`);
    console.log(`📅 时间范围: ${new Date(savedData.startTime).toISOString()} - ${new Date(savedData.endTime).toISOString()}`);

    return savedData.data;
  }

  /**
   * 获取时间框架对应的毫秒数
   */
  private getTimeframeMs(timeframe: string): number {
    const timeframeMap: { [key: string]: number } = {
      '1m': 60 * 1000,
      '3m': 3 * 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1H': 60 * 60 * 1000,
      '2H': 2 * 60 * 60 * 1000,
      '4H': 4 * 60 * 60 * 1000,
      '6H': 6 * 60 * 60 * 1000,
      '12H': 12 * 60 * 60 * 1000,
      '1D': 24 * 60 * 60 * 1000
    };

    return timeframeMap[timeframe] || 60 * 1000;
  }

  /**
   * 休眠函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取数据统计信息
   */
  getDataStats(data: HistoricalKlineData[]): {
    count: number;
    startTime: string;
    endTime: string;
    priceRange: { min: number; max: number };
    avgVolume: number;
  } {
    if (data.length === 0) {
      return {
        count: 0,
        startTime: '',
        endTime: '',
        priceRange: { min: 0, max: 0 },
        avgVolume: 0
      };
    }

    const prices = data.map(d => d.close);
    const volumes = data.map(d => d.volume);

    return {
      count: data.length,
      startTime: new Date(data[0].timestamp).toISOString(),
      endTime: new Date(data[data.length - 1].timestamp).toISOString(),
      priceRange: {
        min: Math.min(...prices),
        max: Math.max(...prices)
      },
      avgVolume: volumes.reduce((sum, v) => sum + v, 0) / volumes.length
    };
  }
}