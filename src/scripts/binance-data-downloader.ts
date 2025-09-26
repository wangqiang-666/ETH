#!/usr/bin/env node
/**
 * 币安历史K线数据下载器
 * 下载ETHUSDT一年15分钟K线数据用于回测验证
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

interface KlineData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol: string;
}

interface BinanceKlineResponse {
  [key: string]: any;
}

class BinanceDataDownloader {
  private baseUrl = 'https://api.binance.com';
  private symbol = 'ETHUSDT';
  private interval = '15m';
  private limit = 1000; // 每次请求最大1000条

  /**
   * 下载指定时间范围的K线数据
   */
  async downloadKlineData(startTime: number, endTime: number): Promise<KlineData[]> {
    const allData: KlineData[] = [];
    let currentStartTime = startTime;
    
    console.log(`🚀 开始下载 ${this.symbol} ${this.interval} K线数据`);
    console.log(`📅 时间范围: ${new Date(startTime).toISOString()} - ${new Date(endTime).toISOString()}`);
    
    while (currentStartTime < endTime) {
      try {
        const url = `${this.baseUrl}/api/v3/klines?symbol=${this.symbol}&interval=${this.interval}&startTime=${currentStartTime}&endTime=${endTime}&limit=${this.limit}`;
        
        console.log(`📥 下载数据: ${new Date(currentStartTime).toISOString()}`);
        
        const data = await this.makeRequest(url);
        
        if (!data || data.length === 0) {
          console.log('📭 没有更多数据');
          break;
        }
        
        // 转换数据格式
        const klineData = data.map((item: any[]) => ({
          timestamp: parseInt(item[0]),
          open: parseFloat(item[1]),
          high: parseFloat(item[2]),
          low: parseFloat(item[3]),
          close: parseFloat(item[4]),
          volume: parseFloat(item[5]),
          symbol: this.symbol
        }));
        
        allData.push(...klineData);
        
        // 更新下次请求的开始时间
        const lastTimestamp = klineData[klineData.length - 1].timestamp;
        currentStartTime = lastTimestamp + (15 * 60 * 1000); // 15分钟后
        
        console.log(`✅ 已下载 ${allData.length} 条数据`);
        
        // 避免请求过于频繁
        await this.sleep(100);
        
      } catch (error) {
        console.error('❌ 下载失败:', error);
        await this.sleep(1000); // 错误时等待更长时间
      }
    }
    
    console.log(`🎉 下载完成! 总共 ${allData.length} 条K线数据`);
    return allData;
  }

  /**
   * 发起HTTP请求
   */
  private makeRequest(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            resolve(jsonData);
          } catch (error) {
            reject(error);
          }
        });
        
      }).on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 保存数据到文件
   */
  async saveToFile(data: KlineData[], filename: string): Promise<void> {
    const outputDir = '/Users/mac/Temp/Trae/HF-Trading/data/historical';
    
    // 确保目录存在
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const filePath = path.join(outputDir, filename);
    
    const fileData = {
      source: 'Binance API',
      symbol: this.symbol,
      timeframe: this.interval,
      dataCount: data.length,
      startTime: data[0]?.timestamp || 0,
      endTime: data[data.length - 1]?.timestamp || 0,
      downloadTime: Date.now(),
      data: data
    };
    
    fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2));
    console.log(`💾 数据已保存到: ${filePath}`);
    
    // 输出数据统计
    console.log('\n📊 数据统计:');
    console.log(`   交易对: ${this.symbol}`);
    console.log(`   时间框架: ${this.interval}`);
    console.log(`   数据条数: ${data.length}`);
    console.log(`   开始时间: ${new Date(data[0]?.timestamp || 0).toISOString()}`);
    console.log(`   结束时间: ${new Date(data[data.length - 1]?.timestamp || 0).toISOString()}`);
    console.log(`   时间跨度: ${Math.round((data[data.length - 1]?.timestamp - data[0]?.timestamp) / (1000 * 60 * 60 * 24))} 天`);
    
    // 计算价格统计
    const prices = data.map(d => d.close);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    
    console.log(`   价格范围: ${minPrice.toFixed(2)} - ${maxPrice.toFixed(2)} USDT`);
    console.log(`   平均价格: ${avgPrice.toFixed(2)} USDT`);
    console.log(`   价格波动: ${((maxPrice - minPrice) / minPrice * 100).toFixed(2)}%`);
  }

  /**
   * 下载2022年至今的历史数据（牛熊市全周期）
   */
  async downloadFullHistoryData(): Promise<void> {
    try {
      console.log('📅 下载2022年至今的历史数据（牛熊市全周期）...');
      
      const startDate = new Date('2022-01-01T00:00:00Z');
      const endDate = new Date(); // 当前时间
      
      const data = await this.downloadKlineData(startDate.getTime(), endDate.getTime());
      
      if (data.length === 0) {
        console.error('❌ 没有下载到数据');
        return;
      }
      
      const filename = `binance_${this.symbol}_${this.interval}_fullhistory_${new Date().toISOString().split('T')[0]}.json`;
      await this.saveToFile(data, filename);
      
      console.log(`🎉 下载完成! 总共 ${data.length} 条K线数据`);
      console.log(`💾 数据已保存到: ${path.join(process.cwd(), 'data', 'historical', filename)}`);
      
    } catch (error) {
      console.error('❌ 下载失败:', error);
      throw error;
    }
  }

  /**
   * 获取指定日期范围的数据
   */
  async downloadDateRangeData(startDate: string, endDate: string): Promise<void> {
    const startTime = new Date(startDate).getTime();
    const endTime = new Date(endDate).getTime();
    
    if (isNaN(startTime) || isNaN(endTime)) {
      throw new Error('日期格式错误，请使用 YYYY-MM-DD 格式');
    }
    
    if (startTime >= endTime) {
      throw new Error('开始日期必须早于结束日期');
    }
    
    console.log(`📅 下载指定日期范围的数据: ${startDate} 到 ${endDate}`);
    
    const data = await this.downloadKlineData(startTime, endTime);
    
    if (data.length > 0) {
      const filename = `binance_${this.symbol}_${this.interval}_${startDate}_to_${endDate}.json`;
      await this.saveToFile(data, filename);
    } else {
      console.log('❌ 没有下载到数据');
    }
  }

  /**
   * 验证数据完整性
   */
  validateData(data: KlineData[]): boolean {
    if (data.length === 0) {
      console.log('❌ 数据为空');
      return false;
    }
    
    console.log('\n🔍 验证数据完整性...');
    
    let issues = 0;
    
    // 检查时间序列
    for (let i = 1; i < data.length; i++) {
      const timeDiff = data[i].timestamp - data[i-1].timestamp;
      const expectedDiff = 15 * 60 * 1000; // 15分钟
      
      if (timeDiff !== expectedDiff) {
        if (issues < 5) { // 只显示前5个问题
          console.log(`⚠️ 时间间隔异常: 索引 ${i}, 间隔 ${timeDiff/1000/60} 分钟`);
        }
        issues++;
      }
    }
    
    // 检查价格数据
    let priceIssues = 0;
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      if (item.high < item.low || item.high < item.open || item.high < item.close || 
          item.low > item.open || item.low > item.close) {
        if (priceIssues < 5) {
          console.log(`⚠️ 价格数据异常: 索引 ${i}, OHLC: ${item.open}/${item.high}/${item.low}/${item.close}`);
        }
        priceIssues++;
      }
    }
    
    console.log(`📊 验证结果:`);
    console.log(`   时间序列问题: ${issues} 个`);
    console.log(`   价格数据问题: ${priceIssues} 个`);
    console.log(`   数据完整性: ${issues === 0 && priceIssues === 0 ? '✅ 良好' : '⚠️ 有问题'}`);
    
    return issues === 0 && priceIssues === 0;
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🎯 币安历史K线数据下载器');
  console.log('📊 交易对: ETHUSDT, 时间框架: 15分钟');
  console.log('='.repeat(50));
  
  try {
    const downloader = new BinanceDataDownloader();
    
    // 检查命令行参数
    const args = process.argv.slice(2);
    
    if (args.includes('--full-history')) {
      // 下载2022年至今的完整历史数据
      await downloader.downloadFullHistoryData();
    } else if (args.includes('--date-range')) {
      // 下载指定日期范围的数据
      const startIndex = args.indexOf('--start-date');
      const endIndex = args.indexOf('--end-date');
      
      if (startIndex !== -1 && endIndex !== -1) {
        const startDate = args[startIndex + 1];
        const endDate = args[endIndex + 1];
        await downloader.downloadDateRangeData(startDate, endDate);
      } else {
        console.error('❌ 请提供 --start-date 和 --end-date 参数');
        process.exit(1);
      }
    } else if (args.length === 2) {
      // 下载指定日期范围数据
      const [startDate, endDate] = args;
      await downloader.downloadDateRangeData(startDate, endDate);
    } else {
      // 默认下载2022年至今的完整历史数据
      await downloader.downloadFullHistoryData();
    }
    
    console.log('\n🎉 数据下载完成！');
    console.log('💡 提示: 现在可以使用下载的真实历史数据进行回测验证');
    
  } catch (error) {
    console.error('❌ 下载失败:', error);
    process.exit(1);
  }
}

// 运行主函数
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { BinanceDataDownloader };