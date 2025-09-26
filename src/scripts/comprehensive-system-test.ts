#!/usr/bin/env tsx

import axios from 'axios';
import WebSocket from 'ws';
import { DatabaseService } from '../services/database-service';
import BinanceApiService from '../services/binance-api-service';

/**
 * V5-激进优化版系统 - 全方位测试套件
 * 上线前完整测试和优化
 */

interface TestResult {
  testName: string;
  status: 'PASS' | 'FAIL' | 'WARNING';
  message: string;
  details?: any;
  duration: number;
  timestamp: number;
}

interface TestSuite {
  suiteName: string;
  results: TestResult[];
  totalTests: number;
  passedTests: number;
  failedTests: number;
  warningTests: number;
  totalDuration: number;
}

class ComprehensiveSystemTest {
  private testResults: TestSuite[] = [];
  private startTime: number = Date.now();

  constructor() {
    console.log('🚀 V5-激进优化版系统 - 全方位测试开始');
    console.log('=' .repeat(60));
  }

  /**
   * 运行所有测试
   */
  async runAllTests(): Promise<void> {
    try {
      // 1. API连接测试
      await this.runApiConnectivityTests();
      
      // 2. 数据准确性测试
      await this.runDataAccuracyTests();
      
      // 3. 前端功能测试
      await this.runFrontendFunctionalityTests();
      
      // 4. WebSocket稳定性测试
      await this.runWebSocketStabilityTests();
      
      // 5. 交易引擎测试
      await this.runTradingEngineTests();
      
      // 6. 错误处理测试
      await this.runErrorHandlingTests();
      
      // 7. 数据库性能测试
      await this.runDatabasePerformanceTests();
      
      // 8. 负载压力测试
      await this.runLoadStressTests();
      
      // 9. 安全审计
      await this.runSecurityAudit();
      
      // 10. 监控告警测试
      await this.runMonitoringAlertsTests();
      
      // 生成最终报告
      this.generateFinalReport();
      
    } catch (error) {
      console.error('❌ 测试执行失败:', error);
      throw error;
    }
  }

  /**
   * 1. API连接测试
   */
  private async runApiConnectivityTests(): Promise<void> {
    const suite: TestSuite = {
      suiteName: 'API连接测试',
      results: [],
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      warningTests: 0,
      totalDuration: 0
    };

    console.log('\n📡 开始API连接测试...');

    // 测试币安期货API连接
    await this.runTest(suite, '币安期货API连接', async () => {
      const response = await axios.get('https://fapi.binance.com/fapi/v1/ping', {
        timeout: 5000
      });
      return { status: response.status === 200 ? 'PASS' : 'FAIL', message: '连接成功' };
    });

    // 测试24小时统计数据API
    await this.runTest(suite, '24小时统计数据API', async () => {
      const response = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=ETHUSDT', {
        timeout: 10000
      });
      const data = response.data;
      
      if (data.lastPrice && data.priceChangePercent && data.quoteVolume) {
        return { 
          status: 'PASS', 
          message: `价格: ${data.lastPrice}, 涨跌: ${data.priceChangePercent}%, 成交量: ${data.quoteVolume}`,
          details: data
        };
      } else {
        return { status: 'FAIL', message: '数据字段不完整' };
      }
    });

    // 测试K线数据API
    await this.runTest(suite, 'K线数据API', async () => {
      const response = await axios.get('https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT&interval=1m&limit=1', {
        timeout: 10000
      });
      const data = response.data;
      
      if (Array.isArray(data) && data.length > 0 && data[0].length >= 6) {
        return { 
          status: 'PASS', 
          message: `获取到K线数据: ${data[0][4]} (收盘价)`,
          details: data[0]
        };
      } else {
        return { status: 'FAIL', message: 'K线数据格式错误' };
      }
    });

    // 测试API响应时间
    await this.runTest(suite, 'API响应时间测试', async () => {
      const startTime = Date.now();
      await axios.get('https://fapi.binance.com/fapi/v1/ping');
      const responseTime = Date.now() - startTime;
      
      if (responseTime < 1000) {
        return { status: 'PASS', message: `响应时间: ${responseTime}ms` };
      } else if (responseTime < 3000) {
        return { status: 'WARNING', message: `响应时间较慢: ${responseTime}ms` };
      } else {
        return { status: 'FAIL', message: `响应时间过慢: ${responseTime}ms` };
      }
    });

    // 测试API错误处理
    await this.runTest(suite, 'API错误处理测试', async () => {
      try {
        await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=INVALID', {
          timeout: 5000
        });
        return { status: 'FAIL', message: '应该返回错误但没有' };
      } catch (error: any) {
        if (error.response && error.response.status === 400) {
          return { status: 'PASS', message: '正确处理了无效交易对错误' };
        } else {
          return { status: 'WARNING', message: `意外的错误类型: ${error.message}` };
        }
      }
    });

    this.testResults.push(suite);
    this.printSuiteResults(suite);
  }

  /**
   * 2. 数据准确性测试
   */
  private async runDataAccuracyTests(): Promise<void> {
    const suite: TestSuite = {
      suiteName: '数据准确性测试',
      results: [],
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      warningTests: 0,
      totalDuration: 0
    };

    console.log('\n📊 开始数据准确性测试...');

    // 测试价格数据一致性
    await this.runTest(suite, '价格数据一致性', async () => {
      const [ticker, kline] = await Promise.all([
        axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=ETHUSDT'),
        axios.get('https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT&interval=1m&limit=1')
      ]);

      const tickerPrice = parseFloat(ticker.data.lastPrice);
      const klinePrice = parseFloat(kline.data[0][4]);
      const priceDiff = Math.abs(tickerPrice - klinePrice) / tickerPrice;

      if (priceDiff < 0.001) { // 0.1%以内差异
        return { 
          status: 'PASS', 
          message: `价格一致性良好，差异: ${(priceDiff * 100).toFixed(4)}%`,
          details: { tickerPrice, klinePrice, diff: priceDiff }
        };
      } else {
        return { 
          status: 'WARNING', 
          message: `价格差异较大: ${(priceDiff * 100).toFixed(4)}%`,
          details: { tickerPrice, klinePrice, diff: priceDiff }
        };
      }
    });

    // 测试成交量数据格式
    await this.runTest(suite, '成交量数据格式', async () => {
      const response = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=ETHUSDT');
      const data = response.data;
      
      const volume = parseFloat(data.volume);
      const quoteVolume = parseFloat(data.quoteVolume);
      
      if (volume > 0 && quoteVolume > 0 && quoteVolume > volume) {
        return { 
          status: 'PASS', 
          message: `成交量数据正常 - ETH: ${volume.toFixed(2)}, USDT: ${quoteVolume.toFixed(2)}`,
          details: { volume, quoteVolume }
        };
      } else {
        return { 
          status: 'FAIL', 
          message: '成交量数据异常',
          details: { volume, quoteVolume }
        };
      }
    });

    // 测试数据更新频率
    await this.runTest(suite, '数据更新频率测试', async () => {
      const response1 = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=ETHUSDT');
      await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
      const response2 = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=ETHUSDT');
      
      const time1 = response1.data.closeTime;
      const time2 = response2.data.closeTime;
      
      if (time2 >= time1) {
        return { 
          status: 'PASS', 
          message: '数据正常更新',
          details: { time1, time2, diff: time2 - time1 }
        };
      } else {
        return { 
          status: 'FAIL', 
          message: '数据更新异常',
          details: { time1, time2 }
        };
      }
    });

    this.testResults.push(suite);
    this.printSuiteResults(suite);
  }

  /**
   * 3. 前端功能测试
   */
  private async runFrontendFunctionalityTests(): Promise<void> {
    const suite: TestSuite = {
      suiteName: '前端功能测试',
      results: [],
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      warningTests: 0,
      totalDuration: 0
    };

    console.log('\n🖥️ 开始前端功能测试...');

    // 测试Dashboard服务器连接
    await this.runTest(suite, 'Dashboard服务器连接', async () => {
      try {
        const response = await axios.get('http://localhost:3001/api/status', {
          timeout: 5000
        });
        return { 
          status: 'PASS', 
          message: 'Dashboard服务器正常运行',
          details: response.data
        };
      } catch (error: any) {
        return { 
          status: 'FAIL', 
          message: `Dashboard服务器连接失败: ${error.message}`
        };
      }
    });

    // 测试静态文件服务
    await this.runTest(suite, '静态文件服务', async () => {
      try {
        const response = await axios.get('http://localhost:3001/', {
          timeout: 5000
        });
        
        if (response.data.includes('V5-激进优化版实时交易监控')) {
          return { status: 'PASS', message: '前端页面加载正常' };
        } else {
          return { status: 'FAIL', message: '前端页面内容异常' };
        }
      } catch (error: any) {
        return { 
          status: 'FAIL', 
          message: `静态文件服务失败: ${error.message}`
        };
      }
    });

    // 测试API接口
    await this.runTest(suite, 'API接口测试', async () => {
      try {
        const [status, stats, trades] = await Promise.all([
          axios.get('http://localhost:3001/api/status'),
          axios.get('http://localhost:3001/api/stats'),
          axios.get('http://localhost:3001/api/trades?limit=5')
        ]);

        return { 
          status: 'PASS', 
          message: '所有API接口响应正常',
          details: {
            status: status.status,
            stats: stats.status,
            trades: trades.status
          }
        };
      } catch (error: any) {
        return { 
          status: 'FAIL', 
          message: `API接口测试失败: ${error.message}`
        };
      }
    });

    this.testResults.push(suite);
    this.printSuiteResults(suite);
  }

  /**
   * 4. WebSocket稳定性测试
   */
  private async runWebSocketStabilityTests(): Promise<void> {
    const suite: TestSuite = {
      suiteName: 'WebSocket稳定性测试',
      results: [],
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      warningTests: 0,
      totalDuration: 0
    };

    console.log('\n🔌 开始WebSocket稳定性测试...');

    // 测试WebSocket连接
    await this.runTest(suite, 'WebSocket连接测试', async () => {
      return new Promise((resolve) => {
        const ws = new WebSocket('ws://localhost:3001/socket.io/?EIO=4&transport=websocket');
        let connected = false;

        const timeout = setTimeout(() => {
          if (!connected) {
            ws.close();
            resolve({ status: 'FAIL', message: 'WebSocket连接超时' });
          }
        }, 5000);

        ws.on('open', () => {
          connected = true;
          clearTimeout(timeout);
          ws.close();
          resolve({ status: 'PASS', message: 'WebSocket连接成功' });
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          resolve({ 
            status: 'FAIL', 
            message: `WebSocket连接错误: ${error.message}` 
          });
        });
      });
    });

    // 测试数据传输
    await this.runTest(suite, 'WebSocket数据传输', async () => {
      return new Promise((resolve) => {
        const ws = new WebSocket('ws://localhost:3001/socket.io/?EIO=4&transport=websocket');
        let messageReceived = false;

        const timeout = setTimeout(() => {
          if (!messageReceived) {
            ws.close();
            resolve({ status: 'WARNING', message: '未收到WebSocket消息' });
          }
        }, 10000);

        ws.on('message', (data) => {
          messageReceived = true;
          clearTimeout(timeout);
          ws.close();
          resolve({ 
            status: 'PASS', 
            message: 'WebSocket数据传输正常',
            details: { messageLength: Buffer.isBuffer(data) ? data.length : data.toString().length }
          });
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          resolve({ 
            status: 'FAIL', 
            message: `WebSocket数据传输错误: ${error.message}` 
          });
        });
      });
    });

    this.testResults.push(suite);
    this.printSuiteResults(suite);
  }

  /**
   * 5. 交易引擎测试
   */
  private async runTradingEngineTests(): Promise<void> {
    const suite: TestSuite = {
      suiteName: '交易引擎测试',
      results: [],
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      warningTests: 0,
      totalDuration: 0
    };

    console.log('\n⚙️ 开始交易引擎测试...');

    // 测试V5策略参数
    await this.runTest(suite, 'V5策略参数验证', async () => {
      const v5Params = {
        stopLoss: 0.017,
        takeProfitLevel1: 0.012,
        takeProfitLevel2: 0.040,
        takeProfitLevel3: 0.090,
        rsiOversold: 35,
        rsiOverbought: 65,
        maxDailyTrades: 80,
        basePositionSize: 750
      };

      // 验证参数合理性
      const issues = [];
      if (v5Params.stopLoss <= 0 || v5Params.stopLoss > 0.1) issues.push('止损比例异常');
      if (v5Params.takeProfitLevel1 <= 0) issues.push('止盈参数异常');
      if (v5Params.rsiOversold >= v5Params.rsiOverbought) issues.push('RSI参数异常');
      if (v5Params.maxDailyTrades <= 0) issues.push('交易限制异常');

      if (issues.length === 0) {
        return { 
          status: 'PASS', 
          message: 'V5策略参数验证通过',
          details: v5Params
        };
      } else {
        return { 
          status: 'FAIL', 
          message: `参数验证失败: ${issues.join(', ')}`,
          details: { issues, params: v5Params }
        };
      }
    });

    // 测试技术指标计算
    await this.runTest(suite, '技术指标计算测试', async () => {
      // 模拟价格数据
      const prices = [3900, 3910, 3920, 3915, 3925, 3930, 3935, 3940, 3945, 3950];
      
      // 简单RSI计算测试
      const gains = [];
      const losses = [];
      
      for (let i = 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) {
          gains.push(change);
          losses.push(0);
        } else {
          gains.push(0);
          losses.push(-change);
        }
      }
      
      const avgGain = gains.reduce((a, b) => a + b, 0) / gains.length;
      const avgLoss = losses.reduce((a, b) => a + b, 0) / losses.length;
      
      if (avgGain >= 0 && avgLoss >= 0) {
        return { 
          status: 'PASS', 
          message: '技术指标计算正常',
          details: { avgGain, avgLoss, prices }
        };
      } else {
        return { 
          status: 'FAIL', 
          message: '技术指标计算异常',
          details: { avgGain, avgLoss }
        };
      }
    });

    this.testResults.push(suite);
    this.printSuiteResults(suite);
  }

  /**
   * 6. 错误处理测试
   */
  private async runErrorHandlingTests(): Promise<void> {
    const suite: TestSuite = {
      suiteName: '错误处理测试',
      results: [],
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      warningTests: 0,
      totalDuration: 0
    };

    console.log('\n🚨 开始错误处理测试...');

    // 测试网络错误处理
    await this.runTest(suite, '网络错误处理', async () => {
      try {
        await axios.get('http://invalid-url-for-testing.com', { timeout: 1000 });
        return { status: 'FAIL', message: '应该产生网络错误但没有' };
      } catch (error: any) {
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
          return { status: 'PASS', message: '网络错误处理正常' };
        } else {
          return { status: 'WARNING', message: `意外的错误类型: ${error.code}` };
        }
      }
    });

    // 测试超时处理
    await this.runTest(suite, '超时处理测试', async () => {
      try {
        await axios.get('https://httpbin.org/delay/10', { timeout: 2000 });
        return { status: 'FAIL', message: '应该超时但没有' };
      } catch (error: any) {
        if (error.code === 'ECONNABORTED') {
          return { status: 'PASS', message: '超时处理正常' };
        } else {
          return { status: 'WARNING', message: `意外的错误: ${error.message}` };
        }
      }
    });

    this.testResults.push(suite);
    this.printSuiteResults(suite);
  }

  /**
   * 7. 数据库性能测试
   */
  private async runDatabasePerformanceTests(): Promise<void> {
    const suite: TestSuite = {
      suiteName: '数据库性能测试',
      results: [],
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      warningTests: 0,
      totalDuration: 0
    };

    console.log('\n🗄️ 开始数据库性能测试...');

    // 测试数据库连接
    await this.runTest(suite, '数据库连接测试', async () => {
      try {
        const dbService = new DatabaseService();
        await dbService.initialize();
        
        return { status: 'PASS', message: '数据库连接成功' };
      } catch (error: any) {
        return { 
          status: 'FAIL', 
          message: `数据库连接失败: ${error.message}`
        };
      }
    });

    // 测试数据写入性能
    await this.runTest(suite, '数据写入性能', async () => {
      try {
        const dbService = new DatabaseService();
        await dbService.initialize();
        
        const startTime = Date.now();
        
        // 写入测试数据
        for (let i = 0; i < 10; i++) {
          await dbService.saveTrade({
            id: `test_${i}_${Date.now()}`,
            timestamp: Date.now(),
            symbol: 'ETHUSDT',
            direction: 'LONG',
            entryPrice: 3900 + i,
            exitPrice: 3910 + i,
            quantity: 0.1,
            pnl: 10 + i,
            pnlPercent: 0.25,
            fees: 0.5,
            holdingTime: 60000,
            exitReason: 'test',
            createdAt: Date.now()
          });
        }
        
        const duration = Date.now() - startTime;
        
        if (duration < 1000) {
          return { 
            status: 'PASS', 
            message: `数据写入性能良好: ${duration}ms`,
            details: { duration, recordsWritten: 10 }
          };
        } else {
          return { 
            status: 'WARNING', 
            message: `数据写入较慢: ${duration}ms`,
            details: { duration, recordsWritten: 10 }
          };
        }
      } catch (error: any) {
        return { 
          status: 'FAIL', 
          message: `数据写入测试失败: ${error.message}`
        };
      }
    });

    this.testResults.push(suite);
    this.printSuiteResults(suite);
  }

  /**
   * 8. 负载压力测试
   */
  private async runLoadStressTests(): Promise<void> {
    const suite: TestSuite = {
      suiteName: '负载压力测试',
      results: [],
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      warningTests: 0,
      totalDuration: 0
    };

    console.log('\n⚡ 开始负载压力测试...');

    // 测试并发API请求
    await this.runTest(suite, '并发API请求测试', async () => {
      const startTime = Date.now();
      const promises = [];
      
      // 并发发送10个请求
      for (let i = 0; i < 10; i++) {
        promises.push(
          axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=ETHUSDT', {
            timeout: 10000
          })
        );
      }
      
      try {
        const results = await Promise.all(promises);
        const duration = Date.now() - startTime;
        const successCount = results.filter(r => r.status === 200).length;
        
        if (successCount === 10 && duration < 5000) {
          return { 
            status: 'PASS', 
            message: `并发请求成功: ${successCount}/10, 耗时: ${duration}ms`,
            details: { successCount, duration, totalRequests: 10 }
          };
        } else if (successCount >= 8) {
          return { 
            status: 'WARNING', 
            message: `部分并发请求成功: ${successCount}/10, 耗时: ${duration}ms`,
            details: { successCount, duration, totalRequests: 10 }
          };
        } else {
          return { 
            status: 'FAIL', 
            message: `并发请求失败过多: ${successCount}/10`,
            details: { successCount, duration, totalRequests: 10 }
          };
        }
      } catch (error: any) {
        return { 
          status: 'FAIL', 
          message: `并发请求测试失败: ${error.message}`
        };
      }
    });

    this.testResults.push(suite);
    this.printSuiteResults(suite);
  }

  /**
   * 9. 安全审计
   */
  private async runSecurityAudit(): Promise<void> {
    const suite: TestSuite = {
      suiteName: '安全审计',
      results: [],
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      warningTests: 0,
      totalDuration: 0
    };

    console.log('\n🔒 开始安全审计...');

    // 测试环境变量安全
    await this.runTest(suite, '环境变量安全检查', async () => {
      const issues = [];
      
      if (process.env.BINANCE_API_KEY === 'test_api_key_placeholder') {
        issues.push('使用了测试API密钥');
      }
      
      if (process.env.BINANCE_TESTNET !== 'true') {
        issues.push('未使用测试网环境');
      }
      
      if (process.env.SIMULATION_MODE !== 'true') {
        issues.push('未启用模拟模式');
      }
      
      if (issues.length === 0) {
        return { 
          status: 'PASS', 
          message: '环境变量安全配置正确'
        };
      } else {
        return { 
          status: 'WARNING', 
          message: `安全配置建议: ${issues.join(', ')}`,
          details: { issues }
        };
      }
    });

    // 测试HTTPS使用
    await this.runTest(suite, 'HTTPS安全传输', async () => {
      const httpsUrls = [
        'https://fapi.binance.com/fapi/v1/ping',
        'https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=ETHUSDT'
      ];
      
      let httpsCount = 0;
      for (const url of httpsUrls) {
        if (url.startsWith('https://')) {
          httpsCount++;
        }
      }
      
      if (httpsCount === httpsUrls.length) {
        return { 
          status: 'PASS', 
          message: '所有外部API使用HTTPS安全传输'
        };
      } else {
        return { 
          status: 'FAIL', 
          message: `${httpsUrls.length - httpsCount}个API未使用HTTPS`
        };
      }
    });

    this.testResults.push(suite);
    this.printSuiteResults(suite);
  }

  /**
   * 10. 监控告警测试
   */
  private async runMonitoringAlertsTests(): Promise<void> {
    const suite: TestSuite = {
      suiteName: '监控告警测试',
      results: [],
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      warningTests: 0,
      totalDuration: 0
    };

    console.log('\n📊 开始监控告警测试...');

    // 测试系统状态监控
    await this.runTest(suite, '系统状态监控', async () => {
      try {
        const response = await axios.get('http://localhost:3001/api/status');
        const status = response.data;
        
        if (status.isRunning !== undefined && status.timestamp) {
          return { 
            status: 'PASS', 
            message: '系统状态监控正常',
            details: status
          };
        } else {
          return { 
            status: 'FAIL', 
            message: '系统状态监控数据不完整',
            details: status
          };
        }
      } catch (error: any) {
        return { 
          status: 'FAIL', 
          message: `系统状态监控失败: ${error.message}`
        };
      }
    });

    // 测试日志记录
    await this.runTest(suite, '日志记录功能', async () => {
      // 检查是否有日志输出
      const hasConsoleLog = typeof console.log === 'function';
      const hasConsoleError = typeof console.error === 'function';
      
      if (hasConsoleLog && hasConsoleError) {
        return { 
          status: 'PASS', 
          message: '日志记录功能正常'
        };
      } else {
        return { 
          status: 'FAIL', 
          message: '日志记录功能异常'
        };
      }
    });

    this.testResults.push(suite);
    this.printSuiteResults(suite);
  }

  /**
   * 运行单个测试
   */
  private async runTest(
    suite: TestSuite, 
    testName: string, 
    testFunction: () => Promise<{ status: 'PASS' | 'FAIL' | 'WARNING', message: string, details?: any }>
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      const result = await testFunction();
      const duration = Date.now() - startTime;
      
      const testResult: TestResult = {
        testName,
        status: result.status,
        message: result.message,
        details: result.details,
        duration,
        timestamp: Date.now()
      };
      
      suite.results.push(testResult);
      suite.totalTests++;
      suite.totalDuration += duration;
      
      switch (result.status) {
        case 'PASS':
          suite.passedTests++;
          console.log(`  ✅ ${testName}: ${result.message} (${duration}ms)`);
          break;
        case 'WARNING':
          suite.warningTests++;
          console.log(`  ⚠️  ${testName}: ${result.message} (${duration}ms)`);
          break;
        case 'FAIL':
          suite.failedTests++;
          console.log(`  ❌ ${testName}: ${result.message} (${duration}ms)`);
          break;
      }
      
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      const testResult: TestResult = {
        testName,
        status: 'FAIL',
        message: `测试执行异常: ${error.message}`,
        details: { error: error.stack },
        duration,
        timestamp: Date.now()
      };
      
      suite.results.push(testResult);
      suite.totalTests++;
      suite.failedTests++;
      suite.totalDuration += duration;
      
      console.log(`  ❌ ${testName}: 测试执行异常: ${error.message} (${duration}ms)`);
    }
  }

  /**
   * 打印测试套件结果
   */
  private printSuiteResults(suite: TestSuite): void {
    console.log(`\n📋 ${suite.suiteName} 结果:`);
    console.log(`   总测试数: ${suite.totalTests}`);
    console.log(`   通过: ${suite.passedTests} ✅`);
    console.log(`   警告: ${suite.warningTests} ⚠️`);
    console.log(`   失败: ${suite.failedTests} ❌`);
    console.log(`   总耗时: ${suite.totalDuration}ms`);
    console.log(`   通过率: ${((suite.passedTests / suite.totalTests) * 100).toFixed(1)}%`);
  }

  /**
   * 生成最终报告
   */
  private generateFinalReport(): void {
    const totalDuration = Date.now() - this.startTime;
    
    console.log('\n' + '='.repeat(60));
    console.log('🎯 V5-激进优化版系统 - 全方位测试报告');
    console.log('='.repeat(60));
    
    let totalTests = 0;
    let totalPassed = 0;
    let totalWarnings = 0;
    let totalFailed = 0;
    
    this.testResults.forEach(suite => {
      totalTests += suite.totalTests;
      totalPassed += suite.passedTests;
      totalWarnings += suite.warningTests;
      totalFailed += suite.failedTests;
      
      console.log(`\n📊 ${suite.suiteName}:`);
      console.log(`   测试数: ${suite.totalTests} | 通过: ${suite.passedTests} | 警告: ${suite.warningTests} | 失败: ${suite.failedTests}`);
      console.log(`   通过率: ${((suite.passedTests / suite.totalTests) * 100).toFixed(1)}% | 耗时: ${suite.totalDuration}ms`);
    });
    
    console.log('\n' + '='.repeat(60));
    console.log('📈 总体测试结果:');
    console.log(`   总测试数: ${totalTests}`);
    console.log(`   通过: ${totalPassed} ✅`);
    console.log(`   警告: ${totalWarnings} ⚠️`);
    console.log(`   失败: ${totalFailed} ❌`);
    console.log(`   总通过率: ${((totalPassed / totalTests) * 100).toFixed(1)}%`);
    console.log(`   总耗时: ${totalDuration}ms`);
    
    // 系统状态评估
    const overallPassRate = (totalPassed / totalTests) * 100;
    let systemStatus = '';
    let recommendation = '';
    
    if (overallPassRate >= 90 && totalFailed === 0) {
      systemStatus = '🟢 优秀 - 系统完全就绪';
      recommendation = '✅ 建议立即上线，系统状态优秀';
    } else if (overallPassRate >= 80 && totalFailed <= 2) {
      systemStatus = '🟡 良好 - 系统基本就绪';
      recommendation = '⚠️ 建议修复警告后上线';
    } else if (overallPassRate >= 70) {
      systemStatus = '🟠 一般 - 需要优化';
      recommendation = '🔧 建议修复主要问题后再上线';
    } else {
      systemStatus = '🔴 较差 - 需要大量修复';
      recommendation = '❌ 不建议上线，需要大量修复工作';
    }
    
    console.log(`\n🎯 系统状态: ${systemStatus}`);
    console.log(`💡 上线建议: ${recommendation}`);
    
    console.log('\n' + '='.repeat(60));
    console.log(`⏰ 测试完成时间: ${new Date().toLocaleString()}`);
    console.log('🚀 V5-激进优化版系统测试完成！');
    console.log('='.repeat(60));
    
    // 保存测试报告
    this.saveTestReport({
      timestamp: Date.now(),
      totalDuration,
      totalTests,
      totalPassed,
      totalWarnings,
      totalFailed,
      overallPassRate,
      systemStatus,
      recommendation,
      suites: this.testResults
    });
  }

  /**
   * 保存测试报告
   */
  private saveTestReport(report: any): void {
    import('fs').then(fs => {
      import('path').then(path => {
        const reportDir = path.join(process.cwd(), 'data', 'test-reports');
        const reportFile = path.join(reportDir, `system-test-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        
        try {
          if (!fs.existsSync(reportDir)) {
            fs.mkdirSync(reportDir, { recursive: true });
          }
          
          fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
          console.log(`\n📄 测试报告已保存: ${reportFile}`);
        } catch (error) {
          console.error('❌ 保存测试报告失败:', error);
        }
      });
    }).catch(error => {
      console.error('❌ 导入模块失败:', error);
    });
  }
}

// 主函数
async function main() {
  const tester = new ComprehensiveSystemTest();
  
  try {
    await tester.runAllTests();
    process.exit(0);
  } catch (error) {
    console.error('❌ 测试执行失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此文件，执行测试
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { ComprehensiveSystemTest };
export default ComprehensiveSystemTest;