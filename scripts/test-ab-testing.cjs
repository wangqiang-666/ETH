#!/usr/bin/env node

/**
 * A/B测试框架测试脚本
 * 用于验证A/B测试功能的完整性和正确性
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 配置
const API_BASE_URL = process.env.API_URL || 'http://localhost:3033/api';
const TEST_DATA_DIR = path.join(__dirname, '../test-data');
const TEST_RESULTS_FILE = path.join(TEST_DATA_DIR, 'ab-test-results.json');

// 确保测试数据目录存在
if (!fs.existsSync(TEST_DATA_DIR)) {
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

// 测试用户ID列表
const TEST_USERS = [
  'user-001', 'user-002', 'user-003', 'user-004', 'user-005',
  'user-006', 'user-007', 'user-008', 'user-009', 'user-010'
];

// 测试交易对
const TEST_SYMBOLS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'];

// 实验配置
const EXPERIMENT_ID = 'recommendation-strategy-v1';

/**
 * 创建测试推荐
 */
async function createTestRecommendation(userId, symbol, direction) {
  const recommendation = {
    symbol: symbol,
    direction: direction,
    entry_price: direction === 'LONG' ? 50000 : 51000,
    current_price: direction === 'LONG' ? 50000 : 51000,
    take_profit_price: direction === 'LONG' ? 52000 : 49000,
    stop_loss_price: direction === 'LONG' ? 48000 : 53000,
    leverage: 10,
    confidence: 0.75,
    strategy_type: 'ab-test-strategy',
    user_id: userId,
    experiment_id: EXPERIMENT_ID,
    market_data: {
      volatility: 0.02,
      volume_24h: 1000000,
      trend: 'bullish'
    }
  };

  try {
    const response = await axios.post(`${API_BASE_URL}/recommendations`, recommendation);
    return response.data;
  } catch (error) {
    console.error(`创建推荐失败 (${userId}, ${symbol}, ${direction}):`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * 获取实验配置
 */
async function getExperimentConfig(experimentId) {
  try {
    const response = await axios.get(`${API_BASE_URL}/ab-testing/experiments/${experimentId}`);
    return response.data;
  } catch (error) {
    console.error('获取实验配置失败:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * 获取变体统计信息
 */
async function getVariantStatistics(experimentId, startDate, endDate) {
  try {
    const response = await axios.get(`${API_BASE_URL}/ab-testing/variant-stats`, {
      params: {
        experiment_id: experimentId,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString()
      }
    });
    return response.data;
  } catch (error) {
    console.error('获取变体统计失败:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * 获取A/B测试报告
 */
async function getABTestReports(options) {
  try {
    const response = await axios.get(`${API_BASE_URL}/ab-testing/reports`, {
      params: options
    });
    return response.data;
  } catch (error) {
    console.error('获取A/B测试报告失败:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * 分配变体
 */
async function assignVariant(userId, experimentId) {
  try {
    const response = await axios.post(`${API_BASE_URL}/ab-testing/experiments/${experimentId}/assign-variant`, {
      user_id: userId
    });
    return response.data;
  } catch (error) {
    console.error('分配变体失败:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * 获取实验分析
 */
async function getExperimentAnalysis(experimentId) {
  try {
    const response = await axios.get(`${API_BASE_URL}/ab-testing/experiments/${experimentId}/analysis`);
    return response.data;
  } catch (error) {
    console.error('获取实验分析失败:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * 运行A/B测试验证
 */
async function runABTestingValidation() {
  console.log('🧪 开始A/B测试框架验证...\n');
  
  const results = {
    timestamp: new Date().toISOString(),
    tests: {},
    summary: {}
  };

  try {
    // 测试1: 实验配置获取
    console.log('📋 测试1: 获取实验配置');
    const experimentConfig = await getExperimentConfig(EXPERIMENT_ID);
    results.tests.experimentConfig = {
      success: true,
      data: experimentConfig
    };
    console.log('✅ 实验配置获取成功\n');

    // 测试2: 变体分配
    console.log('🎲 测试2: 变体分配一致性测试');
    const variantAssignments = {};
    for (const userId of TEST_USERS) {
      const assignment = await assignVariant(userId, EXPERIMENT_ID);
      variantAssignments[userId] = assignment.data;
      
      // 验证一致性 - 同一用户应该始终分配到相同变体
      const secondAssignment = await assignVariant(userId, EXPERIMENT_ID);
      if (assignment.data.variant !== secondAssignment.data.variant) {
        throw new Error(`变体分配不一致: ${userId} 第一次 ${assignment.data.variant}, 第二次 ${secondAssignment.data.variant}`);
      }
    }
    results.tests.variantAssignment = {
      success: true,
      assignments: variantAssignments
    };
    console.log('✅ 变体分配一致性测试通过\n');

    // 测试3: 创建带A/B测试的推荐
    console.log('📈 测试3: 创建带A/B测试的推荐');
    const createdRecommendations = [];
    
    for (let i = 0; i < 5; i++) {
      const userId = TEST_USERS[i];
      const symbol = TEST_SYMBOLS[i % TEST_SYMBOLS.length];
      const direction = i % 2 === 0 ? 'LONG' : 'SHORT';
      
      const recommendation = await createTestRecommendation(userId, symbol, direction);
      createdRecommendations.push(recommendation.data);
      
      // 验证变体信息
      if (!recommendation.data.variant) {
        throw new Error('推荐创建未包含变体信息');
      }
      if (!recommendation.data.experiment_id) {
        throw new Error('推荐创建未包含实验ID');
      }
    }
    
    results.tests.recommendationCreation = {
      success: true,
      recommendations: createdRecommendations
    };
    console.log('✅ 推荐创建测试通过\n');

    // 等待数据写入
    console.log('⏳ 等待数据写入数据库...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 测试4: 变体统计
    console.log('📊 测试4: 获取变体统计信息');
    const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24小时前
    const endDate = new Date();
    
    const variantStats = await getVariantStatistics(EXPERIMENT_ID, startDate, endDate);
    results.tests.variantStatistics = {
      success: true,
      data: variantStats
    };
    console.log('✅ 变体统计获取成功\n');

    // 测试5: A/B测试报告
    console.log('📄 测试5: 获取A/B测试报告');
    const abTestReports = await getABTestReports({
      experiment_id: EXPERIMENT_ID,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      format: 'json'
    });
    results.tests.abTestReports = {
      success: true,
      data: abTestReports
    };
    console.log('✅ A/B测试报告获取成功\n');

    // 测试6: CSV报告格式
    console.log('📊 测试6: CSV报告格式');
    const csvReport = await getABTestReports({
      experiment_id: EXPERIMENT_ID,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      format: 'csv'
    });
    results.tests.csvReport = {
      success: true,
      csvLength: csvReport.data.length,
      sample: csvReport.data.substring(0, 200)
    };
    console.log('✅ CSV报告格式测试通过\n');

    // 生成总结
    results.summary = {
      totalTests: Object.keys(results.tests).length,
      passedTests: Object.values(results.tests).filter(t => t.success).length,
      failedTests: Object.values(results.tests).filter(t => !t.success).length,
      experimentId: EXPERIMENT_ID,
      testUsers: TEST_USERS.length,
      testSymbols: TEST_SYMBOLS.length
    };

    console.log('🎉 A/B测试框架验证完成！');
    console.log(`📊 测试结果: ${results.summary.passedTests}/${results.summary.totalTests} 测试通过`);

  } catch (error) {
    console.error('❌ A/B测试验证失败:', error.message);
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
 * 变体分配分布分析
 */
function analyzeVariantDistribution(assignments) {
  const distribution = {};
  
  Object.values(assignments).forEach(assignment => {
    const variant = assignment.variant;
    distribution[variant] = (distribution[variant] || 0) + 1;
  });

  const total = Object.values(distribution).reduce((sum, count) => sum + count, 0);
  const percentages = {};
  
  Object.entries(distribution).forEach(([variant, count]) => {
    percentages[variant] = ((count / total) * 100).toFixed(2) + '%';
  });

  return {
    distribution,
    percentages,
    total
  };
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 启动A/B测试框架验证程序\n');
  
  const results = await runABTestingValidation();
  
  // 分析变体分配分布
  if (results.tests.variantAssignment?.assignments) {
    console.log('\n📊 变体分配分布分析:');
    const distribution = analyzeVariantDistribution(results.tests.variantAssignment.assignments);
    console.log('变体分布:', distribution.distribution);
    console.log('分配比例:', distribution.percentages);
  }

  // 检查是否有失败的测试
  if (results.summary.failedTests > 0) {
    console.log('\n❌ 检测到失败的测试，请检查日志和结果文件');
    process.exit(1);
  } else {
    console.log('\n✅ 所有测试均通过，A/B测试框架运行正常！');
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
  runABTestingValidation,
  analyzeVariantDistribution
};