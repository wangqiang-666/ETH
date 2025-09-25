import { ethAgentDemo } from './eth-agent-demo.js';

/**
 * ETH合约Agent测试运行器
 * 演示如何使用Agent进行历史数据回测
 */
export class AgentTestRunner {
  
  /**
   * 运行基础回测演示
   */
  public static async runBasicBacktestDemo(): Promise<void> {
    console.log('🚀 开始ETH合约Agent基础回测演示\n');
    
    try {
      // 启动Agent
      await ethAgentDemo.start();
      
      // 运行3个月的历史回测
      console.log('📊 运行Q1季度回测 (2024年1-3月)...');
      const q1Result = await ethAgentDemo.runHistoricalBacktest(
        new Date('2024-01-01'),
        new Date('2024-03-31')
      );
      
      console.log('\n⏳ 等待5秒后运行下一个回测...\n');
      await this.sleep(5000);
      
      // 运行第二季度回测
      console.log('📊 运行Q2季度回测 (2024年4-6月)...');
      const q2Result = await ethAgentDemo.runHistoricalBacktest(
        new Date('2024-04-01'),
        new Date('2024-06-30')
      );
      
      // 对比分析
      this.compareBacktestResults('Q1', q1Result, 'Q2', q2Result);
      
      // 停止Agent
      ethAgentDemo.stop();
      
      console.log('✅ ETH合约Agent基础回测演示完成！');
      
    } catch (error) {
      console.error('❌ 回测演示失败:', error);
    }
  }
  
  /**
   * 运行参数优化演示
   */
  public static async runParameterOptimizationDemo(): Promise<void> {
    console.log('🔧 开始ETH合约Agent参数优化演示\n');
    
    const testConfigs = [
      { name: '保守策略', maxPositionSize: 0.1, stopLossPercent: 0.015, takeProfitPercent: 0.03 },
      { name: '平衡策略', maxPositionSize: 0.2, stopLossPercent: 0.02, takeProfitPercent: 0.04 },
      { name: '激进策略', maxPositionSize: 0.3, stopLossPercent: 0.025, takeProfitPercent: 0.05 }
    ];
    
    const results: Array<{ name: string; result: any }> = [];
    
    try {
      await ethAgentDemo.start();
      
      for (const testConfig of testConfigs) {
        console.log(`\n🧪 测试${testConfig.name}...`);
        
        // 更新配置
        ethAgentDemo.updateConfig({
          maxPositionSize: testConfig.maxPositionSize,
          stopLossPercent: testConfig.stopLossPercent,
          takeProfitPercent: testConfig.takeProfitPercent
        });
        
        // 运行回测
        const result = await ethAgentDemo.runHistoricalBacktest(
          new Date('2024-01-01'),
          new Date('2024-03-31')
        );
        
        results.push({ name: testConfig.name, result });
        
        console.log(`\n⏳ 等待3秒后测试下一个配置...\n`);
        await this.sleep(3000);
      }
      
      // 分析最佳配置
      this.analyzeBestConfiguration(results);
      
      ethAgentDemo.stop();
      
      console.log('✅ ETH合约Agent参数优化演示完成！');
      
    } catch (error) {
      console.error('❌ 参数优化演示失败:', error);
    }
  }
  
  /**
   * 运行完整Agent演示
   */
  public static async runFullAgentDemo(): Promise<void> {
    console.log('🎯 开始ETH合约Agent完整功能演示\n');
    
    try {
      // 1. 基础回测演示
      console.log('📊 第一部分：基础回测演示');
      console.log('='.repeat(50));
      await this.runBasicBacktestDemo();
      
      console.log('\n⏳ 等待10秒后开始参数优化演示...\n');
      await this.sleep(10000);
      
      // 2. 参数优化演示
      console.log('🔧 第二部分：参数优化演示');
      console.log('='.repeat(50));
      await this.runParameterOptimizationDemo();
      
      // 3. 显示Agent总体统计
      console.log('\n📈 第三部分：Agent总体统计');
      console.log('='.repeat(50));
      this.displayAgentOverallStats();
      
      console.log('\n🎉 ETH合约Agent完整功能演示完成！');
      console.log('\n💡 接下来您可以：');
      console.log('   1. 调整Agent配置参数');
      console.log('   2. 测试不同的时间段');
      console.log('   3. 集成真实的OKX API进行实盘交易');
      console.log('   4. 添加更多的技术指标和策略');
      
    } catch (error) {
      console.error('❌ 完整演示失败:', error);
    }
  }
  
  /**
   * 对比回测结果
   */
  private static compareBacktestResults(
    name1: string, result1: any,
    name2: string, result2: any
  ): void {
    console.log('\n📊 回测结果对比分析');
    console.log('='.repeat(50));
    
    console.log(`指标\t\t\t${name1}\t\t${name2}\t\t优势`);
    console.log('-'.repeat(50));
    
    const metrics = [
      { name: '总收益率', key: 'totalReturnPercent', format: (v: number) => `${(v * 100).toFixed(2)}%` },
      { name: '胜率', key: 'winRate', format: (v: number) => `${(v * 100).toFixed(2)}%` },
      { name: '夏普比率', key: 'sharpeRatio', format: (v: number) => v.toFixed(3) },
      { name: '最大回撤', key: 'maxDrawdownPercent', format: (v: number) => `${(v * 100).toFixed(2)}%`, reverse: true },
      { name: '交易次数', key: 'totalTrades', format: (v: number) => v.toString() }
    ];
    
    metrics.forEach(metric => {
      const val1 = result1.summary[metric.key];
      const val2 = result2.summary[metric.key];
      const better = metric.reverse ? (val1 < val2 ? name1 : name2) : (val1 > val2 ? name1 : name2);
      
      console.log(`${metric.name}\t\t${metric.format(val1)}\t\t${metric.format(val2)}\t\t${better}`);
    });
    
    console.log('-'.repeat(50));
    
    // 综合评分
    const score1 = this.calculateOverallScore(result1);
    const score2 = this.calculateOverallScore(result2);
    
    console.log(`综合评分\t\t${score1.toFixed(1)}\t\t${score2.toFixed(1)}\t\t${score1 > score2 ? name1 : name2}`);
    console.log(`\n🏆 ${score1 > score2 ? name1 : name2} 表现更优！`);
  }
  
  /**
   * 分析最佳配置
   */
  private static analyzeBestConfiguration(results: Array<{ name: string; result: any }>): void {
    console.log('\n🏆 配置优化分析结果');
    console.log('='.repeat(50));
    
    // 按不同指标排序
    const byReturn = [...results].sort((a, b) => b.result.summary.totalReturnPercent - a.result.summary.totalReturnPercent);
    const byWinRate = [...results].sort((a, b) => b.result.summary.winRate - a.result.summary.winRate);
    const bySharpe = [...results].sort((a, b) => b.result.summary.sharpeRatio - a.result.summary.sharpeRatio);
    const byDrawdown = [...results].sort((a, b) => a.result.summary.maxDrawdownPercent - b.result.summary.maxDrawdownPercent);
    
    console.log(`最高收益率: ${byReturn[0].name} (${(byReturn[0].result.summary.totalReturnPercent * 100).toFixed(2)}%)`);
    console.log(`最高胜率: ${byWinRate[0].name} (${(byWinRate[0].result.summary.winRate * 100).toFixed(2)}%)`);
    console.log(`最高夏普比率: ${bySharpe[0].name} (${bySharpe[0].result.summary.sharpeRatio.toFixed(3)})`);
    console.log(`最低回撤: ${byDrawdown[0].name} (${(byDrawdown[0].result.summary.maxDrawdownPercent * 100).toFixed(2)}%)`);
    
    // 综合最佳配置
    const overallScores = results.map(r => ({
      name: r.name,
      score: this.calculateOverallScore(r.result)
    })).sort((a, b) => b.score - a.score);
    
    console.log(`\n🎯 综合最佳配置: ${overallScores[0].name} (综合评分: ${overallScores[0].score.toFixed(1)})`);
    
    // 推荐建议
    console.log('\n💡 配置建议:');
    if (overallScores[0].name.includes('保守')) {
      console.log('   - 当前市场适合保守策略，建议降低仓位和风险');
    } else if (overallScores[0].name.includes('激进')) {
      console.log('   - 当前市场适合激进策略，可以适当提高仓位');
    } else {
      console.log('   - 平衡策略表现最佳，建议保持中等风险水平');
    }
  }
  
  /**
   * 计算综合评分
   */
  private static calculateOverallScore(result: any): number {
    const summary = result.summary;
    
    // 综合评分公式（可以根据需要调整权重）
    const returnScore = Math.min(summary.totalReturnPercent * 100, 50); // 收益率权重，最高50分
    const winRateScore = summary.winRate * 30; // 胜率权重，最高30分
    const sharpeScore = Math.min(summary.sharpeRatio * 10, 15); // 夏普比率权重，最高15分
    const drawdownPenalty = Math.max(0, summary.maxDrawdownPercent * 100 - 10); // 回撤惩罚，超过10%开始扣分
    
    return Math.max(0, returnScore + winRateScore + sharpeScore - drawdownPenalty);
  }
  
  /**
   * 显示Agent总体统计
   */
  private static displayAgentOverallStats(): void {
    const status = ethAgentDemo.getStatus();
    
    console.log('🤖 ETH合约Agent总体统计:');
    console.log(`   运行状态: ${status.isRunning ? '运行中' : '已停止'}`);
    console.log(`   累计回测次数: ${status.stats.totalBacktests}`);
    console.log(`   最佳收益率: ${(status.stats.bestReturn * 100).toFixed(2)}%`);
    console.log(`   最差收益率: ${(status.stats.worstReturn * 100).toFixed(2)}%`);
    console.log(`   平均胜率: ${(status.stats.avgWinRate * 100).toFixed(2)}%`);
    console.log(`   累计交易次数: ${status.stats.totalTrades}`);
    
    console.log('\n⚙️ 当前配置:');
    console.log(`   交易对: ${status.config.symbol}`);
    console.log(`   初始资金: $${status.config.initialCapital.toLocaleString()}`);
    console.log(`   最大仓位: ${(status.config.maxPositionSize * 100).toFixed(1)}%`);
    console.log(`   交易手续费: ${(status.config.tradingFee * 100).toFixed(3)}%`);
    console.log(`   滑点: ${(status.config.slippage * 100).toFixed(3)}%`);
    console.log(`   止损: ${(status.config.stopLossPercent * 100).toFixed(1)}%`);
    console.log(`   止盈: ${(status.config.takeProfitPercent * 100).toFixed(1)}%`);
  }
  
  /**
   * 睡眠函数
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 如果直接运行此文件，执行完整演示
if (process.argv[1] && process.argv[1].endsWith('agent-test-runner.ts') || process.argv[1] && process.argv[1].endsWith('agent-test-runner.js')) {
  AgentTestRunner.runFullAgentDemo().catch(console.error);
}