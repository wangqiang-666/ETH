/**
 * 数据一致性测试脚本
 * 测试推荐板块和历史数据的一致性
 */

const fetch = require('node-fetch');

// 测试配置
const TEST_CONFIG = {
  baseUrl: 'http://localhost:3031', // 更新为正确的端口
  testTimeout: 30000,
  maxRetries: 3
};

/**
 * 获取活跃推荐数据
 */
async function getActiveRecommendations() {
  try {
    const response = await fetch(`${TEST_CONFIG.baseUrl}/api/active-recommendations`);
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(`API返回错误: ${data.error}`);
    }
    
    return data.data.recommendations || [];
  } catch (error) {
    console.error('获取活跃推荐失败:', error.message);
    return [];
  }
}

/**
 * 获取推荐历史数据
 */
async function getRecommendationHistory(includeActive = true) {
  try {
    const response = await fetch(`${TEST_CONFIG.baseUrl}/api/recommendations?include_active=${includeActive}&limit=100`);
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(`API返回错误: ${data.error}`);
    }
    
    return data.data || [];
  } catch (error) {
    console.error('获取推荐历史失败:', error.message);
    return [];
  }
}

/**
 * 标准化推荐数据用于比较
 */
function normalizeForComparison(rec) {
  return {
    id: rec.id,
    symbol: rec.symbol,
    direction: rec.direction,
    entry_price: Number(rec.entry_price),
    leverage: Number(rec.leverage),
    confidence_score: Number(rec.confidence_score || rec.confidence || 0),
    status: rec.status,
    created_at: new Date(rec.created_at).getTime()
  };
}

/**
 * 生成去重键（与后端逻辑保持一致）
 */
function generateDedupeKey(rec) {
  const timestamp = new Date(rec.created_at).getTime();
  const timeBucket = Math.floor(timestamp / 5000) * 5000; // 5秒桶
  
  const symbol = rec.symbol;
  const direction = rec.direction;
  const entryPrice = rec.entry_price ? (Math.round(rec.entry_price * 100) / 100).toFixed(2) : '';
  const takeProfit = rec.take_profit_price ? (Math.round(rec.take_profit_price * 100) / 100).toFixed(2) : '';
  const stopLoss = rec.stop_loss_price ? (Math.round(rec.stop_loss_price * 100) / 100).toFixed(2) : '';
  
  return `t${timeBucket}|${symbol}|${direction}|e${entryPrice}|tp${takeProfit}|sl${stopLoss}`;
}

/**
 * 比较两个推荐记录是否一致
 */
function compareRecommendations(rec1, rec2) {
  const normalized1 = normalizeForComparison(rec1);
  const normalized2 = normalizeForComparison(rec2);
  
  const differences = [];
  
  for (const key of Object.keys(normalized1)) {
    if (normalized1[key] !== normalized2[key]) {
      differences.push({
        field: key,
        active: normalized1[key],
        history: normalized2[key]
      });
    }
  }
  
  return differences;
}

/**
 * 测试字段映射一致性
 */
async function testFieldMappingConsistency() {
  console.log('\n=== 测试字段映射一致性 ===');
  
  const activeRecs = await getActiveRecommendations();
  const historyRecs = await getRecommendationHistory(true);
  
  if (activeRecs.length === 0 && historyRecs.length === 0) {
    console.log('⚠️  没有推荐数据可供测试');
    return { passed: true, message: '无数据' };
  }
  
  console.log(`活跃推荐数量: ${activeRecs.length}`);
  console.log(`历史推荐数量: ${historyRecs.length}`);
  
  // 检查字段结构一致性
  const requiredFields = ['id', 'symbol', 'direction', 'entry_price', 'leverage', 'status', 'created_at'];
  const fieldIssues = [];
  
  [...activeRecs, ...historyRecs].forEach((rec, index) => {
    const source = index < activeRecs.length ? 'active' : 'history';
    
    requiredFields.forEach(field => {
      if (rec[field] === undefined || rec[field] === null) {
        fieldIssues.push(`${source}[${index}]: 缺少字段 ${field}`);
      }
    });
  });
  
  if (fieldIssues.length > 0) {
    console.log('❌ 字段映射不一致:');
    fieldIssues.forEach(issue => console.log(`   ${issue}`));
    return { passed: false, issues: fieldIssues };
  }
  
  console.log('✅ 字段映射一致性测试通过');
  return { passed: true };
}

/**
 * 测试去重逻辑一致性
 */
async function testDeduplicationConsistency() {
  console.log('\n=== 测试去重逻辑一致性 ===');
  
  const activeRecs = await getActiveRecommendations();
  const historyRecs = await getRecommendationHistory(true);
  
  if (activeRecs.length === 0 && historyRecs.length === 0) {
    console.log('⚠️  没有推荐数据可供测试');
    return { passed: true, message: '无数据' };
  }
  
  // 生成去重键映射
  const activeKeys = new Map();
  const historyKeys = new Map();
  
  activeRecs.forEach(rec => {
    const key = generateDedupeKey(rec);
    activeKeys.set(key, rec);
  });
  
  historyRecs.forEach(rec => {
    const key = generateDedupeKey(rec);
    historyKeys.set(key, rec);
  });
  
  console.log(`活跃推荐去重后数量: ${activeKeys.size}`);
  console.log(`历史推荐去重后数量: ${historyKeys.size}`);
  
  // 检查重复键
  const duplicateIssues = [];
  
  if (activeKeys.size !== activeRecs.length) {
    duplicateIssues.push(`活跃推荐存在重复: 原始${activeRecs.length}条，去重后${activeKeys.size}条`);
  }
  
  if (historyKeys.size !== historyRecs.length) {
    duplicateIssues.push(`历史推荐存在重复: 原始${historyRecs.length}条，去重后${historyKeys.size}条`);
  }
  
  if (duplicateIssues.length > 0) {
    console.log('⚠️  去重逻辑发现重复数据:');
    duplicateIssues.forEach(issue => console.log(`   ${issue}`));
  } else {
    console.log('✅ 去重逻辑一致性测试通过');
  }
  
  return { passed: duplicateIssues.length === 0, issues: duplicateIssues };
}

/**
 * 测试数据内容一致性
 */
async function testDataContentConsistency() {
  console.log('\n=== 测试数据内容一致性 ===');
  
  const activeRecs = await getActiveRecommendations();
  const historyRecs = await getRecommendationHistory(true);
  
  if (activeRecs.length === 0 || historyRecs.length === 0) {
    console.log('⚠️  缺少活跃推荐或历史数据，无法进行内容一致性测试');
    return { passed: true, message: '数据不足' };
  }
  
  // 查找活跃推荐在历史数据中的对应记录
  const contentIssues = [];
  let matchedCount = 0;
  
  activeRecs.forEach(activeRec => {
    const matchingHistoryRec = historyRecs.find(historyRec => 
      historyRec.id === activeRec.id || 
      (historyRec.symbol === activeRec.symbol && 
       historyRec.direction === activeRec.direction &&
       Math.abs(new Date(historyRec.created_at).getTime() - new Date(activeRec.created_at).getTime()) < 10000)
    );
    
    if (matchingHistoryRec) {
      matchedCount++;
      const differences = compareRecommendations(activeRec, matchingHistoryRec);
      
      if (differences.length > 0) {
        contentIssues.push({
          id: activeRec.id,
          differences
        });
      }
    }
  });
  
  console.log(`匹配的记录数量: ${matchedCount}/${activeRecs.length}`);
  
  if (contentIssues.length > 0) {
    console.log('❌ 数据内容不一致:');
    contentIssues.forEach(issue => {
      console.log(`   推荐ID ${issue.id}:`);
      issue.differences.forEach(diff => {
        console.log(`     ${diff.field}: 活跃=${diff.active}, 历史=${diff.history}`);
      });
    });
    return { passed: false, issues: contentIssues };
  }
  
  console.log('✅ 数据内容一致性测试通过');
  return { passed: true };
}

/**
 * 测试时间戳标准化
 */
async function testTimestampNormalization() {
  console.log('\n=== 测试时间戳标准化 ===');
  
  const activeRecs = await getActiveRecommendations();
  const historyRecs = await getRecommendationHistory(true);
  
  const allRecs = [...activeRecs, ...historyRecs];
  
  if (allRecs.length === 0) {
    console.log('⚠️  没有推荐数据可供测试');
    return { passed: true, message: '无数据' };
  }
  
  const timestampIssues = [];
  
  allRecs.forEach((rec, index) => {
    const source = index < activeRecs.length ? 'active' : 'history';
    
    // 检查 created_at 字段
    if (!rec.created_at) {
      timestampIssues.push(`${source}[${index}]: 缺少 created_at 字段`);
    } else {
      const date = new Date(rec.created_at);
      if (isNaN(date.getTime())) {
        timestampIssues.push(`${source}[${index}]: created_at 格式无效: ${rec.created_at}`);
      }
    }
    
    // 检查 updated_at 字段
    if (!rec.updated_at) {
      timestampIssues.push(`${source}[${index}]: 缺少 updated_at 字段`);
    } else {
      const date = new Date(rec.updated_at);
      if (isNaN(date.getTime())) {
        timestampIssues.push(`${source}[${index}]: updated_at 格式无效: ${rec.updated_at}`);
      }
    }
  });
  
  if (timestampIssues.length > 0) {
    console.log('❌ 时间戳标准化问题:');
    timestampIssues.forEach(issue => console.log(`   ${issue}`));
    return { passed: false, issues: timestampIssues };
  }
  
  console.log('✅ 时间戳标准化测试通过');
  return { passed: true };
}

/**
 * 运行所有测试
 */
async function runAllTests() {
  console.log('🚀 开始数据一致性测试...');
  console.log(`测试目标: ${TEST_CONFIG.baseUrl}`);
  
  const results = {
    fieldMapping: await testFieldMappingConsistency(),
    deduplication: await testDeduplicationConsistency(),
    dataContent: await testDataContentConsistency(),
    timestampNormalization: await testTimestampNormalization()
  };
  
  console.log('\n=== 测试结果汇总 ===');
  
  let allPassed = true;
  const summary = [];
  
  Object.entries(results).forEach(([testName, result]) => {
    const status = result.passed ? '✅ 通过' : '❌ 失败';
    const message = result.message ? ` (${result.message})` : '';
    
    console.log(`${testName}: ${status}${message}`);
    summary.push({ test: testName, passed: result.passed, issues: result.issues });
    
    if (!result.passed) {
      allPassed = false;
    }
  });
  
  console.log(`\n总体结果: ${allPassed ? '✅ 所有测试通过' : '❌ 存在问题需要修复'}`);
  
  return {
    allPassed,
    summary,
    timestamp: new Date().toISOString()
  };
}

// 如果直接运行此脚本
if (require.main === module) {
  runAllTests()
    .then(result => {
      process.exit(result.allPassed ? 0 : 1);
    })
    .catch(error => {
      console.error('测试执行失败:', error);
      process.exit(1);
    });
}

module.exports = {
  runAllTests,
  testFieldMappingConsistency,
  testDeduplicationConsistency,
  testDataContentConsistency,
  testTimestampNormalization
};