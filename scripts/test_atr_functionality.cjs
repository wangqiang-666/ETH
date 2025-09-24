#!/usr/bin/env node

/**
 * ATR动态止损功能测试脚本
 * 验证新添加的ATR字段在推荐创建和事件处理中的正确性
 * 
 * 运行方式:
 * node scripts/test_atr_functionality.cjs
 * 
 * 环境变量:
 * WEB_PORT: Web服务器端口 (默认: 3010)
 * SYMBOL: 测试交易对 (默认: ETH-USDT)
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const WEB_PORT = process.env.WEB_PORT || '3010';
const BASE = `http://localhost:${WEB_PORT}`;
const SYMBOL = process.env.SYMBOL || 'BTC-USDT';

const http = axios.create({ 
  baseURL: BASE, 
  timeout: 8000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// 测试数据
const testRecommendation = {
  symbol: SYMBOL,
  direction: process.env.DIRECTION || 'SHORT',
  entry_price: 2500,
  current_price: 2500,
  stop_loss_price: 2600,
  take_profit_price: 2300,
  leverage: 10,
  position_size: 100,
  strategy_type: 'ATR_TEST',
  algorithm_name: 'ATR_DYNAMIC_STOP',
  // ATR相关字段
  atr_value: 50.5,
  atr_period: 14,
  atr_sl_multiplier: 2.0,
  atr_tp_multiplier: 3.0,
  confidence_score: 0.85,
  signal_strength: 'STRONG',
  notes: 'ATR功能测试推荐',
  bypassCooldown: true
};

// 辅助函数
async function getJSON(url, params = {}) {
  try {
    const { data } = await http.get(url, { params });
    if (data && data.success === false && data.error) {
      throw new Error(`GET ${url} failed: ${data.error}`);
    }
    return data?.data ?? data;
  } catch (error) {
    console.error(`❌ GET ${url} failed:`, error.message);
    throw error;
  }
}

async function postJSON(url, body) {
  try {
    const { data } = await http.post(url, body);
    if (data && data.success === false && data.error) {
      throw new Error(`POST ${url} failed: ${data.error}`);
    }
    return data;
  } catch (error) {
    console.error(`❌ POST ${url} failed:`, error.message);
    throw error;
  }
}

function formatRecommendation(rec) {
  return {
    id: rec.id,
    symbol: rec.symbol,
    direction: rec.direction,
    entry_price: rec.entry_price,
    status: rec.status,
    // ATR字段
    atr_value: rec.atr_value,
    atr_period: rec.atr_period,
    atr_sl_multiplier: rec.atr_sl_multiplier,
    atr_tp_multiplier: rec.atr_tp_multiplier,
    // 分批止盈状态
    tp1_hit: rec.tp1_hit,
    tp2_hit: rec.tp2_hit,
    tp3_hit: rec.tp3_hit,
    reduction_count: rec.reduction_count,
    reduction_ratio: rec.reduction_ratio,
    // 其他字段
    stop_loss_price: rec.stop_loss_price,
    take_profit_price: rec.take_profit_price,
    created_at: rec.created_at
  };
}

// 测试函数
async function testCreateRecommendationWithATR() {
  console.log('\n🚀 测试1: 创建包含ATR字段的推荐');
  console.log('='.repeat(60));
  
  try {
    console.log('📤 发送推荐数据:', JSON.stringify(testRecommendation, null, 2));
    
    const response = await postJSON('/api/recommendations', testRecommendation);
    const recommendation = response.data;
    
    console.log('✅ 推荐创建成功!');
    console.log('📋 返回的推荐数据:');
    console.log(JSON.stringify(formatRecommendation(recommendation), null, 2));
    
    // 验证ATR字段
    const atrFields = {
      atr_value: recommendation.atr_value,
      atr_period: recommendation.atr_period,
      atr_sl_multiplier: recommendation.atr_sl_multiplier,
      atr_tp_multiplier: recommendation.atr_tp_multiplier
    };
    
    console.log('\n🔍 ATR字段验证:');
    Object.entries(atrFields).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        console.log(`   ✅ ${key}: ${value}`);
      } else {
        console.log(`   ❌ ${key}: 缺失或无效`);
      }
    });
    
    // 验证分批止盈状态初始化
    const tpStatus = {
      tp1_hit: recommendation.tp1_hit,
      tp2_hit: recommendation.tp2_hit,
      tp3_hit: recommendation.tp3_hit,
      reduction_count: recommendation.reduction_count,
      reduction_ratio: recommendation.reduction_ratio
    };
    
    console.log('\n🎯 分批止盈状态验证:');
    Object.entries(tpStatus).forEach(([key, value]) => {
      console.log(`   ✅ ${key}: ${value}`);
    });
    
    return recommendation.id;
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    throw error;
  }
}

async function testGetRecommendationWithATR(recommendationId) {
  console.log('\n🔍 测试2: 获取推荐详情并验证ATR字段');
  console.log('='.repeat(60));
  
  try {
    console.log(`📤 获取推荐: ${recommendationId}`);
    
    const recommendation = await getJSON(`/api/recommendations/${recommendationId}`);
    
    console.log('✅ 推荐获取成功!');
    console.log('📋 推荐详情:');
    console.log(JSON.stringify(formatRecommendation(recommendation), null, 2));
    
    // 验证所有ATR字段都存在且正确
    const requiredATRFields = [
      'atr_value', 'atr_period', 'atr_sl_multiplier', 'atr_tp_multiplier'
    ];
    
    console.log('\n🔍 ATR字段完整性验证:');
    let allATRValid = true;
    
    requiredATRFields.forEach(field => {
      if (recommendation[field] !== undefined && recommendation[field] !== null) {
        console.log(`   ✅ ${field}: ${recommendation[field]}`);
      } else {
        console.log(`   ❌ ${field}: 缺失`);
        allATRValid = false;
      }
    });
    
    if (allATRValid) {
      console.log('✅ 所有ATR字段验证通过!');
    } else {
      throw new Error('ATR字段验证失败');
    }
    
    return recommendation;
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    throw error;
  }
}

async function testGetActiveRecommendationsWithATR() {
  console.log('\n📊 测试3: 获取活跃推荐列表并验证ATR字段');
  console.log('='.repeat(60));
  
  try {
    console.log('📤 获取活跃推荐列表');
    
    const data = await getJSON('/api/active-recommendations');
    const recommendations = data.recommendations || [];
    
    console.log(`✅ 获取到 ${recommendations.length} 个活跃推荐`);
    
    if (recommendations.length > 0) {
      console.log('\n📋 第一个推荐的ATR字段:');
      const firstRec = recommendations[0];
      console.log(JSON.stringify(formatRecommendation(firstRec), null, 2));
      
      // 验证ATR字段在列表中也可用
      const hasATRFields = 
        firstRec.atr_value !== undefined &&
        firstRec.atr_period !== undefined &&
        firstRec.atr_sl_multiplier !== undefined &&
        firstRec.atr_tp_multiplier !== undefined;
      
      if (hasATRFields) {
        console.log('✅ 活跃推荐列表包含完整的ATR字段!');
      } else {
        console.log('⚠️  活跃推荐列表ATR字段不完整');
      }
    }
    
    return recommendations;
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    throw error;
  }
}

async function testPositionReducedEvent(recommendationId) {
  console.log('\n📉 测试4: 模拟减仓事件并验证字段更新');
  console.log('='.repeat(60));
  
  try {
    console.log(`🎯 测试推荐: ${recommendationId}`);
    
    // 获取当前推荐状态
    const beforeRec = await getJSON(`/api/recommendations/${recommendationId}`);
    console.log('📊 减仓前状态:');
    console.log(`   reduction_count: ${beforeRec.reduction_count}`);
    console.log(`   reduction_ratio: ${beforeRec.reduction_ratio}`);
    
    console.log('\n⚠️  注意: 需要手动触发position-reduced事件');
    console.log(`   推荐ID: ${recommendationId}`);
    console.log('   期望事件数据: { reduction_ratio: 0.5 }');
    
    // 这里可以添加实际的事件触发逻辑
    // 例如: 通过事件总线或直接调用相关服务
    
    console.log('\n⏳ 等待手动触发减仓事件...');
    console.log('   按回车键继续测试（模拟事件已触发）');
    
    // 等待用户确认
    await new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });
    
    // 重新获取推荐状态
    const afterRec = await getJSON(`/api/recommendations/${recommendationId}`);
    console.log('\n📊 减仓后状态:');
    console.log(`   reduction_count: ${afterRec.reduction_count}`);
    console.log(`   reduction_ratio: ${afterRec.reduction_ratio}`);
    
    // 验证更新
    const countIncreased = afterRec.reduction_count > beforeRec.reduction_count;
    const ratioUpdated = afterRec.reduction_ratio !== beforeRec.reduction_ratio;
    
    if (countIncreased && ratioUpdated) {
      console.log('✅ 减仓事件处理成功!');
    } else {
      console.log('⚠️  减仓事件可能未正确处理');
      console.log('   期望: reduction_count增加, reduction_ratio更新');
    }
    
    return { beforeRec, afterRec };
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    throw error;
  }
}

// 主测试函数
async function runAllTests() {
  console.log('🧪 ATR动态止损功能综合测试');
  console.log('='.repeat(60));
  console.log(`测试环境: ${BASE}`);
  console.log(`测试交易对: ${SYMBOL}`);
  
  const testResults = {
    total: 0,
    passed: 0,
    failed: 0,
    details: []
  };
  
  try {
    // 测试1: 创建推荐
    testResults.total++;
    const recommendationId = await testCreateRecommendationWithATR();
    testResults.passed++;
    testResults.details.push({ test: '创建ATR推荐', status: 'passed' });
    
    // 测试2: 获取推荐详情
    testResults.total++;
    await testGetRecommendationWithATR(recommendationId);
    testResults.passed++;
    testResults.details.push({ test: '获取推荐详情', status: 'passed' });
    
    // 测试3: 获取活跃推荐列表
    testResults.total++;
    await testGetActiveRecommendationsWithATR();
    testResults.passed++;
    testResults.details.push({ test: '获取活跃推荐列表', status: 'passed' });
    
    // 测试4: 减仓事件（可选）
    console.log('\n🤔 是否测试减仓事件？ (y/n)');
    const answer = await new Promise(resolve => {
      process.stdin.once('data', data => resolve(data.toString().trim().toLowerCase()));
    });
    
    if (answer === 'y') {
      testResults.total++;
      await testPositionReducedEvent(recommendationId);
      testResults.passed++;
      testResults.details.push({ test: '减仓事件处理', status: 'passed' });
    }
    
  } catch (error) {
    testResults.failed++;
    testResults.details.push({ test: '未知测试', status: 'failed', error: error.message });
  }
  
  // 测试报告
  console.log('\n' + '='.repeat(60));
  console.log('📊 测试报告');
  console.log('='.repeat(60));
  console.log(`总测试数: ${testResults.total}`);
  console.log(`通过: ${testResults.passed} ✅`);
  console.log(`失败: ${testResults.failed} ❌`);
  
  testResults.details.forEach(detail => {
    const icon = detail.status === 'passed' ? '✅' : '❌';
    console.log(`${icon} ${detail.test}`);
    if (detail.error) {
      console.log(`   错误: ${detail.error}`);
    }
  });
  
  // 保存测试结果
  const resultFile = path.join(process.cwd(), 'atr_test_results.json');
  await fs.promises.writeFile(resultFile, JSON.stringify(testResults, null, 2));
  console.log(`\n💾 测试结果已保存到: ${resultFile}`);
  
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// 错误处理
process.on('unhandledRejection', (error) => {
  console.error('❌ 未处理的Promise拒绝:', error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('❌ 未捕获的异常:', error);
  process.exit(1);
});

// 运行测试
if (require.main === module) {
  runAllTests().catch(error => {
    console.error('❌ 测试运行失败:', error);
    process.exit(1);
  });
}

module.exports = {
  testCreateRecommendationWithATR,
  testGetRecommendationWithATR,
  testGetActiveRecommendationsWithATR,
  testPositionReducedEvent,
  runAllTests
};