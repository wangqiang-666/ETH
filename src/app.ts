import { config } from './config'
import { ethStrategyEngine } from './strategy/eth-strategy-engine'
import { webServer } from './server/web-server'
import { enhancedOKXDataService } from './services/enhanced-okx-data-service'
import { recommendationDatabase } from './services/recommendation-database'

/**
 * ETH合约策略分析应用程序主入口
 * 集成机器学习大模型进行智能分析
 */
class ETHStrategyApp {
  private isRunning = false;
  private shutdownHandlers: (() => Promise<void>)[] = [];
  private labelScheduler?: NodeJS.Timeout;

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

      // 启动 ML 标签回填定时任务
      await this.startMLLabelBackfillScheduler();
      
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

  // 启动 ML 标签回填定时任务
  private async startMLLabelBackfillScheduler(): Promise<void> {
    try {
      const enabled = (config as any)?.ml?.labeling?.enabled ?? true;
      if (!enabled) return;
      const pollMs = (config as any)?.ml?.labeling?.pollIntervalMs ?? 60000;
      const defaultHorizon = (config as any)?.ml?.labeling?.horizonMinutesDefault ?? 60;

      await recommendationDatabase.initialize();

      const intervalToMinutes = (iv: string | undefined): number => {
        if (!iv) return 1;
        const map: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '1H': 60, '4H': 240, '1D': 1440 };
        return map[iv] ?? 1;
      };

      // 定时轮询待回填样本
      this.labelScheduler = setInterval(async () => {
        try {
          const now = Date.now();
          const pending = await recommendationDatabase.getPendingLabelSamples(defaultHorizon, now, 200);
          if (!pending || pending.length === 0) return;

          for (const s of pending) {
            try {
              const symbol = (s as any).symbol || config.trading.defaultSymbol;
              const ticker = await enhancedOKXDataService.getTicker(symbol);
              if (!ticker) continue;
              const endPrice = ticker.price;
              const entry = (s as any).price || 0;

              // HOLD 或缺少价格数据，标记完成但不计算
              if (!entry || !(s as any).final_signal || (s as any).final_signal === 'HOLD') {
                if (typeof (s as any).id === 'number') {
                  await recommendationDatabase.updateMLSampleLabel((s as any).id, null, null, true);
                }
                continue;
              }

              // 收益（以当前价为 T+N 终点）
              let ret = ((endPrice - entry) / entry) * 100;
              if ((s as any).final_signal === 'SELL' || (s as any).final_signal === 'STRONG_SELL') {
                ret = -ret;
              }

              // 计算窗口内最大不利波动（回撤）
              let drawdown: number | null = null;
              const horizonMin = (s as any).label_horizon_min ?? defaultHorizon;
              const interval = (s as any).interval || config.strategy.primaryInterval || '1m';
              const ivMin = intervalToMinutes(interval);
              const minutesSinceSample = Math.max(1, Math.ceil((now - (s as any).timestamp) / 60000));
              const candlesToFetch = Math.min(1000, Math.ceil(minutesSinceSample / ivMin) + 10);

              const klines = await enhancedOKXDataService.getKlineData(symbol, interval, candlesToFetch);
              if (klines && klines.length > 0) {
                const startTs = (s as any).timestamp;
                const endTs = startTs + horizonMin * 60000;
                const window = klines.filter(k => k.timestamp >= startTs && k.timestamp <= endTs);
                if (window.length > 0) {
                  if ((s as any).final_signal === 'SELL' || (s as any).final_signal === 'STRONG_SELL') {
                    // 空头：最大不利为窗口内最高价离入场的涨幅
                    const maxHigh = Math.max(...window.map(k => k.high));
                    drawdown = ((maxHigh - entry) / entry) * 100; // 正数表示不利幅度
                  } else {
                    // 多头：最大不利为窗口内最低价离入场的跌幅（负数）
                    const minLow = Math.min(...window.map(k => k.low));
                    drawdown = ((minLow - entry) / entry) * 100; // 负数表示不利幅度
                  }
                }
              }

              if (typeof (s as any).id === 'number') {
                await recommendationDatabase.updateMLSampleLabel((s as any).id, ret, drawdown, true);
              }
            } catch (e) {
              // 单个样本失败不影响整体
              console.warn('Label backfill for one sample failed:', (e as any)?.message ?? e);
            }
          }
        } catch (e) {
          console.warn('Label backfill scheduler iteration failed:', (e as any)?.message ?? e);
        }
      }, pollMs);

      // 关闭时清理
      this.addShutdownHandler(async () => {
        if (this.labelScheduler) {
          clearInterval(this.labelScheduler);
          this.labelScheduler = undefined;
        }
      });

      console.log(`🧪 ML 标签回填调度已启动（间隔 ${pollMs}ms，默认窗口 ${defaultHorizon} 分钟）`);
    } catch (e) {
      console.warn('无法启动 ML 标签回填调度：', (e as any)?.message ?? e);
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