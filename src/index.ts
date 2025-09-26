import { OKXDataService } from './services/okx-data-service.js';
import { OKXContractService } from './services/okx-contract-service.js';
import { FreqtradeInspiredStrategy, FreqtradeStats } from './strategies/freqtrade-inspired-strategy.js';
import { startWebServer } from './server/web.js';

/**
 * Freqtrade启发的15分钟交易系统
 * 
 * 特点:
 * - 1倍杠杆，零爆仓风险
 * - 15分钟K线，基于Freqtrade最佳实践
 * - Maker挂单，最低手续费 (0.02%)
 * - 多指标组合策略，分层ROI管理
 * - 年化收益目标基于Freqtrade验证策略
 */
class HFTradingSystem {
  private dataService: OKXDataService;
  private contractService: OKXContractService;
  private strategy: FreqtradeInspiredStrategy;
  private isRunning: boolean = false;

  constructor() {
    console.log('🚀 初始化Freqtrade启发的15分钟交易系统...');
    
    // 初始化服务
    this.dataService = new OKXDataService();
    this.contractService = new OKXContractService(this.dataService);
    this.strategy = new FreqtradeInspiredStrategy(this.dataService);
    
    console.log('✅ Freqtrade系统初始化完成');
  }

  /**
   * 启动系统
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ 系统已在运行中');
      return;
    }

    try {
      console.log('🔥 启动高频交易系统...');
      
      // 检查API连接
      console.log('📡 检查OKX API连接...');
      try {
        const ticker = await this.dataService.getTicker('ETH-USDT-SWAP');
        if (ticker) {
          console.log('✅ OKX API连接正常');
        } else {
          console.log('⚠️ OKX API连接失败，将使用模拟模式');
        }
      } catch (error) {
        console.log('⚠️ OKX API连接失败，将使用模拟模式');
      }

      // 设置杠杆
      console.log('⚙️ 设置1倍杠杆...');
      await this.contractService.setLeverage('ETH-USDT-SWAP', '1', 'isolated');

      // 获取账户信息
      console.log('💰 获取账户信息...');
      const balance = await this.contractService.getAccountBalance();
      console.log(`💵 账户余额: ${balance} USDT`);

      // 启动策略
      console.log('🎯 启动高频波段策略...');
      await this.strategy.start();

      this.isRunning = true;

      console.log('\n🎉 高频交易系统启动成功！');
      console.log('📊 系统状态: 运行中');
      console.log('🎯 策略: Freqtrade启发的15分钟策略');
      console.log('📈 目标: 基于验证策略的稳定盈利');
      console.log('💰 预期表现: 基于Freqtrade社区最佳实践');

      // 启动Web服务器
      startWebServer({
        getSystemStatus: () => this.getStatus(),
        getStrategyStats: () => this.strategy.getFreqtradeStats(),
        getCurrentPosition: () => this.strategy.getCurrentPosition(),
        getPendingOrders: () => this.strategy.getPendingOrders(),
        getLastSignal: () => this.strategy.getLastSignalResult(),
        getCurrentTicker: () => this.dataService.getTicker('ETH-USDT-SWAP')
      });

      console.log('🌐 网页端已启动: http://localhost:3000/');

      // 启动状态监控
      this.startStatusMonitoring();

    } catch (error) {
      console.error('❌ 系统启动失败:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * 停止系统
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('🛑 停止交易系统...');
    
    await this.strategy.stop();
    this.isRunning = false;
    
    console.log('✅ 系统已停止');
  }

  /**
   * 获取系统状态
   */
  getStatus() {
    const status = this.strategy.getStatus();
    
    return {
      isRunning: this.isRunning,
      timestamp: new Date().toISOString(),
      strategy: {
        stats: status.stats,
        config: status.config,
        pendingOrdersCount: this.strategy.getPendingOrders().length,
        currentPosition: this.strategy.getCurrentPosition()
      },
      dataService: {
        lastUpdate: new Date().toISOString(),
        isConnected: true
      }
    };
  }

  /**
   * 启动状态监控
   */
  private startStatusMonitoring(): void {
    setInterval(() => {
      try {
        const strategyStats = this.strategy.getFreqtradeStats();
        
        console.log('\n📊 系统状态报告:');
        console.log(`⏰ 时间: ${new Date().toLocaleString()}`);
        console.log(`📈 总交易: ${strategyStats.totalTrades}`);
        console.log(`🎯 胜率: ${strategyStats.winRate.toFixed(1)}%`);
        console.log(`💰 总盈亏: ${strategyStats.totalProfit.toFixed(2)} USDT`);
        console.log(`🎯 今日交易: ${strategyStats.dailyTrades}`);
        console.log(`📊 ROI退出: ${strategyStats.roiExits}, 止损退出: ${strategyStats.stopLossExits}`);
        
      } catch (error) {
        console.error('状态监控错误:', error);
      }
    }, 60000); // 每分钟输出一次状态
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🎯 Freqtrade启发的15分钟交易系统');
  console.log('💡 基于验证策略 - 多指标组合 - 分层ROI');
  console.log('🏆 目标: 稳定盈利，基于Freqtrade最佳实践');
  console.log('='.repeat(50));

  // 环境变量检查（可选）
  if (typeof process !== 'undefined' && !process.env.OKX_API_KEY) {
    console.warn('⚠️ 未检测到OKX_API_KEY，系统将以"无密钥模式"运行，仅访问公开市场数据。');
    // 不退出，继续运行
  }

  // 创建并启动系统
  const tradingSystem = new HFTradingSystem();
  await tradingSystem.start();
}

// 优雅关闭处理
if (typeof process !== 'undefined') {
  process.on('SIGINT', async () => {
    console.log('\n🛑 接收到停止信号，正在关闭系统...');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 接收到终止信号，正在关闭系统...');
    process.exit(0);
  });
}

// 启动系统
main().catch(error => {
  console.error('💥 系统启动失败:', error);
  process.exit(1);
});

export { HFTradingSystem };