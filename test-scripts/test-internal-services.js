#!/usr/bin/env node

/**
 * 内部数据服务测试脚本
 * 直接测试各个数据服务的功能
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenv.config({ path: join(__dirname, '.env.macos') });

console.log('🔧 内部数据服务测试开始...\n');

/**
 * 测试链上数据服务
 */
async function testOnchainDataService() {
  console.log('⛓️  测试链上数据服务...');
  
  try {
    // 动态导入ES模块
    const { onchainDataService } = await import('./src/services/onchain-data-service.js');
    
    await onchainDataService.initialize();
    const data = await onchainDataService.fetchData('ETH');
    
    console.log('✅ 链上数据服务 - 测试成功');
    console.log(`   Gas价格: ${data.gasPrice || 'N/A'} Gwei`);
    console.log(`   活跃地址: ${data.activeAddresses || 'N/A'}`);
    console.log(`   质押比例: ${data.stakingRatio || 'N/A'}%`);
    
    return true;
  } catch (error) {
    console.log('❌ 链上数据服务 - 测试失败:', error.message);
    return false;
  }
}

/**
 * 测试宏观经济数据服务
 */
async function testMacroEconomicDataService() {
  console.log('\n📊 测试宏观经济数据服务...');
  
  try {
    const { macroEconomicDataService } = await import('./src/services/macro-economic-data-service.js');
    
    await macroEconomicDataService.initialize();
    const data = await macroEconomicDataService.fetchData();
    
    console.log('✅ 宏观经济数据服务 - 测试成功');
    console.log(`   美元指数: ${data.dxy || 'N/A'}`);
    console.log(`   10年期美债: ${data.yield10y || 'N/A'}%`);
    console.log(`   纳斯达克: ${data.nasdaq || 'N/A'}`);
    
    return true;
  } catch (error) {
    console.log('❌ 宏观经济数据服务 - 测试失败:', error.message);
    return false;
  }
}

/**
 * 测试多交易所数据服务
 */
async function testMultiExchangeDataService() {
  console.log('\n🏢 测试多交易所数据服务...');
  
  try {
    const { multiExchangeDataService } = await import('./src/services/multi-exchange-data-service.js');
    
    await multiExchangeDataService.initialize();
    const data = await multiExchangeDataService.fetchData('ETH-USDT-SWAP');
    
    console.log('✅ 多交易所数据服务 - 测试成功');
    console.log(`   聚合价格: $${data.weightedAveragePrice || 'N/A'}`);
    console.log(`   价格差异: $${data.priceSpread || 'N/A'}`);
    console.log(`   流动性评分: ${data.liquidityScore || 'N/A'}`);
    console.log(`   套利机会: ${data.arbitrageOpportunities?.length || 0} 个`);
    console.log(`   交易所数量: ${data.exchanges?.length || 0} 个`);
    
    if (data.exchanges && data.exchanges.length > 0) {
      console.log('   交易所价格:');
      data.exchanges.forEach(ex => {
        console.log(`     ${ex.exchange}: $${ex.price.toFixed(2)}`);
      });
    }
    
    return true;
  } catch (error) {
    console.log('❌ 多交易所数据服务 - 测试失败:', error.message);
    return false;
  }
}

/**
 * 测试社交情绪数据服务
 */
async function testSocialSentimentDataService() {
  console.log('\n💬 测试社交情绪数据服务...');
  
  try {
    const { socialSentimentDataService } = await import('./src/services/social-sentiment-data-service.js');
    
    await socialSentimentDataService.initialize();
    const data = await socialSentimentDataService.fetchData('ETH');
    
    console.log('✅ 社交情绪数据服务 - 测试成功');
    console.log(`   整体情绪: ${data.overallSentiment || 'N/A'}`);
    console.log(`   情绪趋势: ${data.sentimentTrend || 'N/A'}`);
    console.log(`   新闻情绪: ${data.newsSentiment || 'N/A'}`);
    console.log(`   社交活跃度: ${data.socialActivity?.totalMentions || 'N/A'}`);
    
    return true;
  } catch (error) {
    console.log('❌ 社交情绪数据服务 - 测试失败:', error.message);
    return false;
  }
}

/**
 * 测试数据聚合服务
 */
async function testDataAggregatorService() {
  console.log('\n🔄 测试数据聚合服务...');
  
  try {
    const { dataAggregatorService } = await import('./src/services/data-aggregator-service.js');
    
    // 获取服务状态
    const stats = dataAggregatorService.getServiceStats();
    const sources = dataAggregatorService.getDataSourcesStatus();
    
    console.log('✅ 数据聚合服务 - 状态检查成功');
    console.log(`   运行状态: ${stats.isRunning ? '运行中' : '已停止'}`);
    console.log(`   数据源总数: ${stats.totalDataSources}`);
    console.log(`   活跃数据源: ${stats.activeDataSources}`);
    
    if (sources.length > 0) {
      console.log('   数据源状态:');
      sources.forEach(source => {
        const status = source.isActive ? '✅' : '❌';
        console.log(`     ${status} ${source.name} - 成功率: ${(source.successRate * 100).toFixed(1)}%`);
      });
    }
    
    return true;
  } catch (error) {
    console.log('❌ 数据聚合服务 - 测试失败:', error.message);
    return false;
  }
}

/**
 * 主测试函数
 */
async function runInternalTests() {
  const results = [];
  
  console.log('正在加载内部服务模块...\n');
  
  // 测试各个服务
  results.push(await testOnchainDataService());
  results.push(await testMacroEconomicDataService());
  results.push(await testMultiExchangeDataService());
  results.push(await testSocialSentimentDataService());
  results.push(await testDataAggregatorService());
  
  // 统计结果
  const successCount = results.filter(r => r).length;
  const totalCount = results.length;
  
  console.log('\n' + '='.repeat(60));
  console.log('🔧 内部服务测试结果汇总:');
  console.log(`✅ 成功: ${successCount}/${totalCount} 个服务`);
  console.log(`❌ 失败: ${totalCount - successCount}/${totalCount} 个服务`);
  
  if (successCount === totalCount) {
    console.log('\n🎉 所有内部服务测试通过！数据聚合功能正常。');
  } else if (successCount > 0) {
    console.log('\n⚠️  部分内部服务测试失败，系统可以运行但功能受限。');
  } else {
    console.log('\n❌ 所有内部服务测试失败，请检查服务配置。');
  }
  
  console.log('\n💡 说明:');
  console.log('- 内部服务测试直接调用服务模块');
  console.log('- 这些服务为量化系统提供增强数据');
  console.log('- 服务失败不影响基础交易功能');
  
  return successCount === totalCount;
}

// 运行测试
runInternalTests().catch(error => {
  console.error('内部服务测试执行失败:', error);
  process.exit(1);
});