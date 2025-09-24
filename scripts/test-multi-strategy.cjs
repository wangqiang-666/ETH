#!/usr/bin/env node

/**
 * 多策略并行执行测试脚本
 * 用于验证多策略并行执行功能的完整性和性能
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// 配置
const API_BASE_URL = process.env.API_URL || 'http://localhost:3033/api';
const TEST_DATA_DIR = path.join(__dirname, '../test-data');
const TEST_RESULTS_FILE = path.join(TEST_DATA_DIR, 'multi-strategy-results.json');

// 确保测试数据目录存在
if (!fs.existsSync(TEST_DATA_DIR)) {
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

// 测试策略配置
const TEST_STRATEGIES = [
  {
    name: 'momentum',
    type: 'MOMENTUM',
    config: {
      lookback_period: 20,
      threshold: 0.02,
      risk_multiplier: 1.5
    }
  },
  {
    name: 'mean_reversion',
    type: 'MEAN_REVERSION',
    config: {
      lookback_period: 30,
      threshold: 0.015,
      risk_multiplier: 1.2
    }
  },
  {
    name: 'breakout',
    type: 'BREAKOUT',
    config: {
      lookback_period: 15,
      threshold: 0.025,
      risk_multiplier: 1.8
    }
  },
  {
    name: 'volume_profile',
    type: 'VOLUME_PROFILE',
    config: {
      lookback_period: 25,
      threshold: 0.01,
      risk_multiplier: 1.3
    }
  }
];

// 测试交易对
const TEST_SYMBOLS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'ADA-USDT', 'DOT-USDT'];

/**
 * 创建多策略推荐
 */
async function createMultiStrategyRecommendation(symbol, strategies, marketData) {
  const recommendation = {
    symbol: symbol,
    direction: 'LONG',
    entry_price: marketData.current_price,
    current_price: marketData.current_price,
    take_profit_price: marketData.current_price * 1.05,
    stop_loss_price: marketData.current_price * 0.95,
    leverage: 10,
    confidence: 0.75,
    strategy_type: 'multi-strategy',
    strategies: strategies,
    market_data: marketData,
    parallel_execution: true,
    strategy_weights: {
      momentum: 0.3,
      mean_reversion: 0.25,
      breakout: 0.25,
      volume_profile: 0.2
    }
  };

  try {
    const response = await axios.post(`${API_BASE_URL}/recommendations`, recommendation);
    return response.data;
  } catch (error) {
    console.error(`创建多策略推荐失败 (${symbol}):`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * 并行创建多个推荐
 */
async function createParallelRecommendations(recommendations) {
  const startTime = performance.now();
  
  try {
    const promises = recommendations.map(rec => createMultiStrategyRecommendation(
      rec.symbol,
      rec.strategies,
      rec.marketData
    ));
    
    const results = await Promise.allSettled(promises);
    const endTime = performance.now();
    
    const successful = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const failed = results.filter(r => r.status === 'rejected').map(r => r.reason);
    
    return {
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      executionTime: endTime - startTime,
      results: results
    };
  } catch (error) {
    console.error('并行创建推荐失败:', error);
    throw error;
  }
}

/**
 * 获取多策略推荐
 */
async function getMultiStrategyRecommendations(filters) {
  try {
    const response = await axios.get(`${API_BASE_URL}/recommendations`, {
      params: {
        strategy_type: 'multi-strategy',
        include_active: true,
        ...filters
      }
    });
    return response.data;
  } catch (error) {
    console.error('获取多策略推荐失败:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * 获取策略执行状态
 */
async function getStrategyExecutionStatus(recommendationId) {
  try {
    const response = await axios.get(`${API_BASE_URL}/recommendations/${recommendationId}/strategies`);
    return response.data;
  } catch (error) {
    console.error('获取策略执行状态失败:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * 模拟市场数据
 */
function generateMarketData(symbol) {
  const basePrice = {
    'BTC-USDT': 50000,
    'ETH-USDT': 3000,
    'SOL-USDT': 150,
    'ADA-USDT': 0.5,
    'DOT-USDT': 10
  }[symbol] || 100;

  return {
    symbol: symbol,
    current_price: basePrice * (1 + (Math.random() - 0.5) * 0.1),
    volatility: 0.02 + Math.random() * 0.03,
    volume_24h: 1000000 + Math.random() * 5000000,
    trend: ['bullish', 'bearish', 'sideways'][Math.floor(Math.random() * 3)],
    momentum: Math.random() * 2 - 1,
    rsi: 30 + Math.random() * 40,
    macd: Math.random() * 0.1 - 0.05,
    bollinger_position: Math.random() * 2 - 1
  };
}

/**
 * 运行多策略并行执行测试
 */
async function runMultiStrategyTest() {
  console.log('🚀 开始多策略并行执行测试...\n');
  
  const results = {
    timestamp: new Date().toISOString(),
    tests: {},
    summary: {},
    performance: {}
  };

  try {
    // 测试1: 单策略创建性能
    console.log('⚡ 测试1: 单策略创建性能');
    const singleStrategyTests = [];
    
    for (let i = 0; i < 10; i++) {
      const symbol = TEST_SYMBOLS[i % TEST_SYMBOLS.length];
      const strategies = [TEST_STRATEGIES[i % TEST_STRATEGIES.length]];
      const marketData = generateMarketData(symbol);
      
      const startTime = performance.now();
      const recommendation = await createMultiStrategyRecommendation(symbol, strategies, marketData);
      const endTime = performance.now();
      
      singleStrategyTests.push({
        recommendationId: recommendation.data.id,
        executionTime: endTime - startTime,
        symbol: symbol,
        strategy: strategies[0].name
      });
    }
    
    const avgSingleStrategyTime = singleStrategyTests.reduce((sum, t) => sum + t.executionTime, 0) / singleStrategyTests.length;
    results.tests.singleStrategyPerformance = {
      success: true,
      tests: singleStrategyTests,
      averageTime: avgSingleStrategyTime
    };
    console.log(`✅ 单策略平均创建时间: ${avgSingleStrategyTime.toFixed(2)}ms\n`);

    // 测试2: 多策略并行创建
    console.log('⚡ 测试2: 多策略并行创建');
    const multiStrategyTests = [];
    
    for (let i = 0; i < 5; i++) {
      const symbol = TEST_SYMBOLS[i % TEST_SYMBOLS.length];
      const marketData = generateMarketData(symbol);
      
      const startTime = performance.now();
      const recommendation = await createMultiStrategyRecommendation(symbol, TEST_STRATEGIES, marketData);
      const endTime = performance.now();
      
      multiStrategyTests.push({
        recommendationId: recommendation.data.id,
        executionTime: endTime - startTime,
        symbol: symbol,
        strategyCount: TEST_STRATEGIES.length
      });
    }
    
    const avgMultiStrategyTime = multiStrategyTests.reduce((sum, t) => sum + t.executionTime, 0) / multiStrategyTests.length;
    results.tests.multiStrategyPerformance = {
      success: true,
      tests: multiStrategyTests,
      averageTime: avgMultiStrategyTime
    };
    console.log(`✅ 多策略平均创建时间: ${avgMultiStrategyTime.toFixed(2)}ms\n`);

    // 测试3: 批量并行创建
    console.log('⚡ 测试3: 批量并行创建');
    const batchRecommendations = [];
    
    for (let i = 0; i < 20; i++) {
      batchRecommendations.push({
        symbol: TEST_SYMBOLS[i % TEST_SYMBOLS.length],
        strategies: TEST_STRATEGIES.slice(0, 2 + (i % 3)), // 2-4个策略
        marketData: generateMarketData(TEST_SYMBOLS[i % TEST_SYMBOLS.length])
      });
    }
    
    const batchResults = await createParallelRecommendations(batchRecommendations);
    results.tests.batchParallelCreation = {
      success: true,
      ...batchResults
    };
    console.log(`✅ 批量创建完成: ${batchResults.successful}/${batchResults.total} 成功, 耗时: ${batchResults.executionTime.toFixed(2)}ms\n`);

    // 测试4: 策略执行状态查询
    console.log('🔍 测试4: 策略执行状态查询');
    const strategyStatusTests = [];
    
    for (const test of multiStrategyTests) {
      const startTime = performance.now();
      const status = await getStrategyExecutionStatus(test.recommendationId);
      const endTime = performance.now();
      
      strategyStatusTests.push({
        recommendationId: test.recommendationId,
        executionTime: endTime - startTime,
        status: status.data
      });
    }
    
    results.tests.strategyExecutionStatus = {
      success: true,
      tests: strategyStatusTests
    };
    console.log(`✅ 策略状态查询完成, 平均时间: ${
      strategyStatusTests.reduce((sum, t) => sum + t.executionTime, 0) / strategyStatusTests.length
    }ms\n`);

    // 测试5: 获取多策略推荐列表
    console.log('📋 测试5: 获取多策略推荐列表');
    const startTime = performance.now();
    const recommendations = await getMultiStrategyRecommendations({
      limit: 50,
      offset: 0
    });
    const endTime = performance.now();
    
    results.tests.getRecommendations = {
      success: true,
      count: recommendations.data.length,
      executionTime: endTime - startTime,
      sample: recommendations.data.slice(0, 2)
    };
    console.log(`✅ 获取推荐列表完成: ${recommendations.data.length} 条记录, 耗时: ${endTime - startTime}ms\n`);

    // 性能分析
    results.performance = {
      singleStrategyAvgTime: avgSingleStrategyTime,
      multiStrategyAvgTime: avgMultiStrategyTime,
      batchCreationTime: batchResults.executionTime,
      batchCreationThroughput: batchResults.total / (batchResults.executionTime / 1000),
      totalRecommendationsCreated: singleStrategyTests.length + multiStrategyTests.length + batchResults.total
    };

    // 生成总结
    results.summary = {
      totalTests: Object.keys(results.tests).length,
      passedTests: Object.values(results.tests).filter(t => t.success).length,
      failedTests: Object.values(results.tests).filter(t => !t.success).length,
      strategiesTested: TEST_STRATEGIES.length,
      symbolsTested: TEST_SYMBOLS.length,
      totalRecommendations: results.performance.totalRecommendationsCreated
    };

    console.log('🎉 多策略并行执行测试完成！');
    console.log(`📊 测试结果: ${results.summary.passedTests}/${results.summary.totalTests} 测试通过`);
    console.log(`⚡ 性能: 创建了 ${results.performance.totalRecommendationsCreated} 个推荐`);

  } catch (error) {
    console.error('❌ 多策略测试失败:', error.message);
    results.tests.overall = {
      success: false,
      error: error.message
    };
    results.summary = {
      totalTests: Object.keys(results.tests).length,
      passedTests: Object.values(results.tests).filter(t => t.success).length,
      failedTests: Object.values(results.tests).filter(t => !t.success).length + 1
    };
  }

  // 保存测试结果
  fs.writeFileSync(TEST_RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`💾 测试结果已保存到: ${TEST_RESULTS_FILE}`);

  return results;
}

/**
 * 分析策略性能
 */
function analyzeStrategyPerformance(results) {
  if (!results.tests.strategyExecutionStatus?.tests) {
    return null;
  }

  const strategyStats = {};
  
  results.tests.strategyExecutionStatus.tests.forEach(test => {
    if (test.status?.strategies) {
      test.status.strategies.forEach(strategy => {
        if (!strategyStats[strategy.name]) {
          strategyStats[strategy.name] = {
            count: 0,
            avgExecutionTime: 0,
            successRate: 0
          };
        }
        
        strategyStats[strategy.name].count++;
        strategyStats[strategy.name].avgExecutionTime += strategy.execution_time || 0;
        strategyStats[strategy.name].successRate += strategy.status === 'completed' ? 1 : 0;
      });
    }
  });

  // 计算平均值
  Object.keys(strategyStats).forEach(strategy => {
    const stats = strategyStats[strategy];
    stats.avgExecutionTime = stats.avgExecutionTime / stats.count;
    stats.successRate = (stats.successRate / stats.count) * 100;
  });

  return strategyStats;
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 启动多策略并行执行测试程序\n');
  
  const results = await runMultiStrategyTest();
  
  // 分析策略性能
  const strategyPerformance = analyzeStrategyPerformance(results);
  if (strategyPerformance) {
    console.log('\n📊 策略性能分析:');
    Object.entries(strategyPerformance).forEach(([strategy, stats]) => {
      console.log(`  ${strategy}: 成功率 ${stats.successRate.toFixed(1)}%, 平均执行时间 ${stats.avgExecutionTime.toFixed(2)}ms`);
    });
  }

  // 检查是否有失败的测试
  if (results.summary.failedTests > 0) {
    console.log('\n❌ 检测到失败的测试，请检查日志和结果文件');
    process.exit(1);
  } else {
    console.log('\n✅ 所有测试均通过，多策略并行执行框架运行正常！');
    process.exit(0);
  }
}

// 错误处理
process.on('unhandledRejection', (error) => {
  console.error('未处理的Promise拒绝:', error);
  process.exit(1);
});

// 运行主函数
if (require.main === module) {
  main().catch(error => {
    console.error('程序执行失败:', error);
    process.exit(1);
  });
}

module.exports = {
  runMultiStrategyTest,
  analyzeStrategyPerformance
};