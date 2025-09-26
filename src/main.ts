#!/usr/bin/env node

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import DashboardServer from './server/dashboard-server';
import { BinanceConfig } from './services/binance-api-service';

// 加载环境变量
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * V5-激进优化版实时交易系统
 * 主启动程序
 */
class TradingSystem {
  private dashboardServer: DashboardServer | null = null;

  constructor() {
    console.log('🚀 V5-激进优化版实时交易系统');
    console.log('=' .repeat(50));
  }

  /**
   * 启动系统
   */
  async start(): Promise<void> {
    try {
      console.log('📋 系统启动中...');

      // 验证环境变量
      this.validateEnvironment();

      // 创建币安配置
      const binanceConfig: BinanceConfig = {
        apiKey: process.env.BINANCE_API_KEY!,
        apiSecret: process.env.BINANCE_API_SECRET!,
        testnet: process.env.BINANCE_TESTNET === 'true',
        recvWindow: parseInt(process.env.BINANCE_RECV_WINDOW || '5000')
      };

      // 创建Dashboard服务器配置
      const dashboardConfig = {
        port: parseInt(process.env.DASHBOARD_PORT || '3001'),
        binanceConfig,
        symbol: process.env.TRADING_SYMBOL || 'ETHUSDT',
        interval: process.env.TRADING_INTERVAL || '1m'
      };

      console.log('🔧 系统配置:');
      console.log(`   交易对: ${dashboardConfig.symbol}`);
      console.log(`   时间周期: ${dashboardConfig.interval}`);
      console.log(`   Dashboard端口: ${dashboardConfig.port}`);
      console.log(`   币安环境: ${binanceConfig.testnet ? '测试网' : '主网'}`);

      // 启动Dashboard服务器
      this.dashboardServer = new DashboardServer(dashboardConfig);
      await this.dashboardServer.start();

      console.log('✅ 系统启动完成!');
      console.log('=' .repeat(50));
      console.log(`📊 访问监控面板: http://localhost:${dashboardConfig.port}`);
      console.log('🎯 V5-激进优化版策略已就绪');
      console.log('💡 在监控面板中点击"启动交易"开始实盘交易');
      console.log('=' .repeat(50));

      // 设置优雅关闭
      this.setupGracefulShutdown();

    } catch (error) {
      console.error('❌ 系统启动失败:', error);
      process.exit(1);
    }
  }

  /**
   * 验证环境变量
   */
  private validateEnvironment(): void {
    const requiredEnvVars = [
      'BINANCE_API_KEY',
      'BINANCE_API_SECRET'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
      console.error('❌ 缺少必要的环境变量:');
      missingVars.forEach(varName => {
        console.error(`   - ${varName}`);
      });
      console.error('');
      console.error('💡 请创建 .env 文件并设置以下变量:');
      console.error('   BINANCE_API_KEY=your_api_key');
      console.error('   BINANCE_API_SECRET=your_api_secret');
      console.error('   BINANCE_TESTNET=true  # 可选，默认false');
      console.error('   DASHBOARD_PORT=3001   # 可选，默认3001');
      console.error('   TRADING_SYMBOL=ETHUSDT # 可选，默认ETHUSDT');
      console.error('   TRADING_INTERVAL=1m   # 可选，默认1m');
      
      throw new Error('环境变量配置不完整');
    }

    console.log('✅ 环境变量验证通过');
  }

  /**
   * 设置优雅关闭
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      console.log(`\n🛑 接收到 ${signal} 信号，开始优雅关闭...`);
      
      try {
        if (this.dashboardServer) {
          await this.dashboardServer.stop();
        }
        
        console.log('✅ 系统已安全关闭');
        process.exit(0);
        
      } catch (error) {
        console.error('❌ 关闭过程中出现错误:', error);
        process.exit(1);
      }
    };

    // 监听关闭信号
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    // 监听未捕获的异常
    process.on('uncaughtException', (error) => {
      console.error('❌ 未捕获的异常:', error);
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ 未处理的Promise拒绝:', reason);
      console.error('Promise:', promise);
      shutdown('unhandledRejection');
    });
  }

  /**
   * 停止系统
   */
  async stop(): Promise<void> {
    console.log('🛑 停止交易系统...');
    
    if (this.dashboardServer) {
      await this.dashboardServer.stop();
    }
    
    console.log('✅ 交易系统已停止');
  }
}

// 主函数
async function main() {
  const system = new TradingSystem();
  await system.start();
}

// 如果直接运行此文件，启动系统
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ 系统启动失败:', error);
    process.exit(1);
  });
}

export { TradingSystem };
export default TradingSystem;