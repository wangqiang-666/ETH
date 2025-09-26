#!/usr/bin/env node

import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

interface KlineData {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

class HistoricalDataDownloader {
  private baseUrl = 'https://api.binance.com/api/v3/klines';
  private symbol = 'ETHUSDT';
  private interval = '1m';
  private limit = 1000; // Binance API limit per request

  async downloadHistoricalData(startDate: string, endDate: string): Promise<void> {
    console.log(`🚀 开始下载 ${this.symbol} 历史数据`);
    console.log(`📅 时间范围: ${startDate} 到 ${endDate}`);
    console.log(`⏱️  时间间隔: ${this.interval}`);

    const startTime = new Date(startDate).getTime();
    const endTime = new Date(endDate).getTime();
    
    console.log(`🔢 开始时间戳: ${startTime}`);
    console.log(`🔢 结束时间戳: ${endTime}`);

    const allData: KlineData[] = [];
    let currentStartTime = startTime;
    let requestCount = 0;

    while (currentStartTime < endTime) {
      try {
        requestCount++;
        console.log(`📡 请求 #${requestCount}: ${new Date(currentStartTime).toISOString()}`);

        const url = `${this.baseUrl}?symbol=${this.symbol}&interval=${this.interval}&startTime=${currentStartTime}&limit=${this.limit}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        if (!Array.isArray(data) || data.length === 0) {
          console.log('⚠️  没有更多数据，停止下载');
          break;
        }

        // 转换数据格式
        const formattedData: KlineData[] = data.map((item: any[]) => ({
          timestamp: item[0],
          open: item[1],
          high: item[2],
          low: item[3],
          close: item[4],
          volume: item[5]
        }));

        allData.push(...formattedData);
        
        // 更新下次请求的开始时间
        const lastTimestamp = formattedData[formattedData.length - 1].timestamp;
        currentStartTime = lastTimestamp + 60000; // 下一分钟

        console.log(`✅ 获取 ${formattedData.length} 条数据，总计: ${allData.length} 条`);

        // API限制：避免请求过快
        if (requestCount % 10 === 0) {
          console.log('⏳ 等待1秒避免API限制...');
          await this.sleep(1000);
        }

        // 如果获取的数据少于limit，说明已经到了最新数据
        if (formattedData.length < this.limit) {
          console.log('✅ 已获取所有可用数据');
          break;
        }

      } catch (error) {
        console.error(`❌ 请求失败:`, error);
        console.log('⏳ 等待5秒后重试...');
        await this.sleep(5000);
        continue;
      }
    }

    console.log(`🎉 数据下载完成！总计: ${allData.length} 条K线数据`);
    
    if (allData.length > 0) {
      await this.saveData(allData, startDate, endDate);
    }
  }

  private async saveData(data: KlineData[], startDate: string, endDate: string): Promise<void> {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    
    const startDateStr = startDate.replace(/[-:]/g, '');
    const endDateStr = endDate.replace(/[-:]/g, '');
    const filename = `${this.symbol}_${this.interval}_${startDateStr}_to_${endDateStr}.json`;
    const filepath = path.join(__dirname, '../../data/historical', filename);

    const fileData = {
      symbol: this.symbol,
      interval: this.interval,
      startDate: startDate,
      endDate: endDate,
      totalBars: data.length,
      downloadTime: new Date().toISOString(),
      data: data
    };

    await fs.writeFile(filepath, JSON.stringify(fileData, null, 2));
    
    console.log(`💾 数据已保存到: ${filename}`);
    console.log(`📊 数据统计:`);
    console.log(`   - 总K线数: ${data.length}`);
    console.log(`   - 开始时间: ${new Date(data[0].timestamp).toISOString()}`);
    console.log(`   - 结束时间: ${new Date(data[data.length - 1].timestamp).toISOString()}`);
    console.log(`   - 文件大小: ${(JSON.stringify(fileData).length / 1024 / 1024).toFixed(2)} MB`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async downloadMultipleYears(): Promise<void> {
    console.log('🚀 开始下载2022年至今的完整历史数据');
    
    const years = [
      { start: '2022-01-01T00:00:00.000Z', end: '2022-12-31T23:59:59.999Z', year: '2022' },
      { start: '2023-01-01T00:00:00.000Z', end: '2023-12-31T23:59:59.999Z', year: '2023' },
      { start: '2024-01-01T00:00:00.000Z', end: '2024-12-31T23:59:59.999Z', year: '2024' },
      { start: '2025-01-01T00:00:00.000Z', end: new Date().toISOString(), year: '2025' }
    ];

    for (const yearData of years) {
      console.log(`\n📅 下载 ${yearData.year} 年数据...`);
      await this.downloadHistoricalData(yearData.start, yearData.end);
      
      // 年度之间等待更长时间
      if (yearData.year !== '2025') {
        console.log('⏳ 等待10秒后下载下一年数据...');
        await this.sleep(10000);
      }
    }

    console.log('\n🎉 所有年度数据下载完成！');
  }
}

async function main() {
  try {
    const downloader = new HistoricalDataDownloader();
    
    // 检查命令行参数
    const args = process.argv.slice(2);
    
    if (args.length >= 2) {
      // 指定时间范围下载
      const startDate = args[0];
      const endDate = args[1];
      await downloader.downloadHistoricalData(startDate, endDate);
    } else {
      // 下载完整的多年数据
      await downloader.downloadMultipleYears();
    }
    
  } catch (error) {
    console.error('❌ 数据下载失败:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { HistoricalDataDownloader };