import { config } from './config';
import { ethStrategyEngine } from './strategy/eth-strategy-engine';
import { webServer } from './server/web-server';
import { enhancedOKXDataService } from './services/enhanced-okx-data-service';

/**
 * ETH合约策略分析应用程序主入口
 * 集成机器学习大模型进行智能分析
 */
class ETHStrategyApp {
  private isRunning = false;
  private shutdownHandlers: (() => Promise<void>)[] = [];

  constructor() {
    this.setupGracefulShutdown();
  }

  /**
   * 启动应用程序
   */
  async start(): Promise<void> {
    try {
      console.log('🚀 启动ETH合约策略分析系统...');
      console.log('📊 集成机器学习大模型分析功能');
      
      // 验证配置
      this.validateConfig();
      
      // 测试OKX API连接
      console.log('🔗 测试OKX API连接...');
      const isConnected = await enhancedOKXDataService.checkConnection();
      if (!isConnected) {
        console.warn('⚠️  无法连接到OKX API，将在离线模式下运行');
      } else {
        console.log('✅ OKX API连接成功');
      }
      
      // 启动Web服务器
      console.log('🌐 启动Web服务器...');
      await webServer.start();
      console.log('✅ Web服务器启动成功');
      
      // 启动策略引擎
      console.log('🤖 启动策略引擎...');
      await ethStrategyEngine.start();
      console.log('✅ 策略引擎启动成功');
      
      this.isRunning = true;
      
      console.log('\n🎉 ETH合约策略分析系统启动完成!');
      console.log('📈 系统正在运行，开始分析市场数据...');
      console.log(`🌐 Web界面: http://localhost:${config.webServer.port}`);
      console.log(`📊 API 根路径: http://localhost:${config.webServer.port}/api`);
      
      if (config.strategy.useMLAnalysis) {
        console.log('🧠 机器学习分析已启用');
      } else {
        console.log('⚠️  机器学习分析未启用，仅使用技术指标分析');
      }
      
      // 显示当前配置
      this.displayCurrentConfig();
      
    } catch (error) {
      console.error('❌ 启动失败:', error);
      await this.stop();
      process.exit(1);
    }
  }

  /**
   * 停止应用程序
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('\n🛑 正在停止ETH合约策略分析系统...');
    
    try {
      // 执行所有关闭处理程序
      for (const handler of this.shutdownHandlers) {
        await handler();
      }
      
      // 停止策略引擎
      console.log('🤖 停止策略引擎...');
      ethStrategyEngine.stop();
      
      // 停止Web服务器
      console.log('🌐 停止Web服务器...');
      await webServer.stop();
      
      this.isRunning = false;
      console.log('✅ 系统已安全停止');
      
    } catch (error) {
      console.error('❌ 停止过程中发生错误:', error);
    }
  }

  /**
   * 验证配置
   */
  private validateConfig(): void {
    console.log('🔍 验证配置...');
    
    // 验证必需的配置项
    const requiredConfigs = [
      { key: 'trading.defaultSymbol', value: config.trading.defaultSymbol },
      { key: 'webServer.port', value: config.webServer.port },
      { key: 'risk.maxDailyLoss', value: config.risk.maxDailyLoss }
    ];
    
    for (const { key, value } of requiredConfigs) {
      if (value === undefined || value === null) {
        throw new Error(`缺少必需的配置项: ${key}`);
      }
    }
    
    // 验证机器学习配置
    if (config.strategy.useMLAnalysis) {
      if (!process.env.OPENAI_API_KEY && !process.env.HUGGINGFACE_API_KEY) {
        console.warn('⚠️  未配置机器学习API密钥，将禁用ML分析功能');
        // 这里可以动态调整配置
      }
    }
    
    console.log('✅ 配置验证通过');
  }

  /**
   * 显示当前配置
   */
  private displayCurrentConfig(): void {
    console.log('\n📋 当前配置:');
    console.log(`   交易标的: ${config.trading.defaultSymbol}`);
    console.log(`   最大杠杆: ${config.trading.maxLeverage}x`);
    console.log(`   最大日亏损: ${config.risk.maxDailyLoss}%`);
    console.log(`   止损比例: ${config.risk.stopLossPercent}%`);
    console.log(`   止盈比例: ${config.risk.takeProfitPercent}%`);
    console.log(`   信号阈值: ${config.strategy.signalThreshold}`);
    console.log(`   最小胜率: ${config.strategy.minWinRate}%`);
    console.log(`   ML分析: ${config.strategy.useMLAnalysis ? '启用' : '禁用'}`);
    console.log(`   Web端口: ${config.webServer.port}`);
  }

  /**
   * 设置优雅关闭
   */
  private setupGracefulShutdown(): void {
    const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    
    signals.forEach(signal => {
      process.on(signal, async () => {
        console.log(`\n收到 ${signal} 信号，开始优雅关闭...`);
        await this.stop();
        process.exit(0);
      });
    });
    
    // 处理未捕获的异常
    process.on('uncaughtException', async (error) => {
      console.error('❌ 未捕获的异常:', error);
      await this.stop();
      process.exit(1);
    });
    
    process.on('unhandledRejection', async (reason, promise) => {
      console.error('❌ 未处理的Promise拒绝:', reason);
      await this.stop();
      process.exit(1);
    });
  }

  /**
   * 添加关闭处理程序
   */
  addShutdownHandler(handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler);
  }

  /**
   * 获取应用状态
   */
  getStatus(): {
    isRunning: boolean;
    uptime: number;
    strategyStatus: any;
    webServerStatus: any;
  } {
    return {
      isRunning: this.isRunning,
      uptime: process.uptime(),
      strategyStatus: this.isRunning ? ethStrategyEngine.getCurrentStatus() : null,
      webServerStatus: webServer.getStatus()
    };
  }

  /**
   * 重启策略引擎
   */
  async restartStrategy(): Promise<void> {
    console.log('🔄 重启策略引擎...');
    
    try {
      ethStrategyEngine.stop();
      await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
      await ethStrategyEngine.start();
      
      console.log('✅ 策略引擎重启成功');
      
      // 通知Web客户端
      webServer.broadcastAlert('INFO', '策略引擎已重启');
      
    } catch (error) {
      console.error('❌ 策略引擎重启失败:', error);
      webServer.broadcastAlert('CRITICAL', '策略引擎重启失败');
      throw error;
    }
  }

  /**
   * 获取系统健康状态
   */
  async getHealthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, boolean>;
    timestamp: number;
  }> {
    const checks = {
      app: this.isRunning,
      webServer: webServer.getStatus().isRunning,
      strategy: ethStrategyEngine.getCurrentStatus().isRunning,
      okxApi: await enhancedOKXDataService.checkConnection()
    };
    
    const healthyCount = Object.values(checks).filter(Boolean).length;
    const totalChecks = Object.keys(checks).length;
    
    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (healthyCount === totalChecks) {
      status = 'healthy';
    } else if (healthyCount >= totalChecks / 2) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }
    
    return {
      status,
      checks,
      timestamp: Date.now()
    };
  }
}

// 创建应用实例
const app = new ETHStrategyApp();

// 应用实例已在index.ts中启动

export { app as ethStrategyApp };
export default app;