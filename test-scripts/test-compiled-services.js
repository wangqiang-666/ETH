#!/usr/bin/env node

/**
 * 编译后服务测试脚本
 * 测试编译后的JavaScript模块
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenv.config({ path: join(__dirname, '.env.macos') });

console.log('🔧 编译后服务测试开始...\n');

/**
 * 测试链上数据服务
 */
async function testOnchainDataService() {
  console.log('⛓️  测试链上数据服务...');
  
  try {
    const { onchainDataService } = await import('./dist/services/onchain-data-service.js');
    
    await onchainDataService.initialize();
    const data = await onchainDataService.fetchData('ETH');
    
    console.log('✅ 链上数据服务 - 测试成功');
    console.log(`   数据字段数: ${Object.keys(data).length}`);
    console.log(`   Gas价格: ${data.gasPrice || 'N/A'}`);
    console.log(`   活跃地址: ${data.activeAddresses || 'N/A'}`);
    
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
    const { macroEconomicDataService } = await import('./dist/services/macro-economic-data-service.js');
    
    await macroEconomicDataService.initialize();
    const data = await macroEconomicDataService.fetchData();
    
    console.log('✅ 宏观经济数据服务 - 测试成功');
    console.log(`   数据字段数: ${Object.keys(data).length}`);
    console.log(`   美元指数: ${data.dxy || 'N/A'}`);
    console.log(`   10年期美债: ${data.yield10y || 'N/A'}%`);
    
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
    const { multiExchangeDataService } = await import('./dist/services/multi-exchange-data-service.js');
    
    await multiExchangeDataService.initialize();
    const data = await multiExchangeDataService.fetchData('ETH-USDT-SWAP');
    
    console.log('✅ 多交易所数据服务 - 测试成功');
    console.log(`   交易所数量: ${data.exchanges?.length || 0} 个`);
    console.log(`   套利机会: ${data.arbitrageOpportunities?.length || 0} 个`);
    
    if (data.exchanges && data.exchanges.length > 0) {
      console.log('   交易所价格:');
      data.exchanges.forEach(ex => {
        console.log(`     ${ex.exchange}: $${ex.price.toFixed(2)}`);
      });
    }
    
    if (data.arbitrageOpportunities && data.arbitrageOpportunities.length > 0) {
      console.log('   最佳套利机会:');
      const best = data.arbitrageOpportunities[0];
      console.log(`     ${best.buyExchange} → ${best.sellExchange}: $${best.spread.toFixed(2)} (${best.spreadPercent.toFixed(3)}%)`);
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
    const { socialSentimentDataService } = await import('./dist/services/social-sentiment-data-service.js');
    
    await socialSentimentDataService.initialize();
    const data = await socialSentimentDataService.fetchData('ETH');
    
    console.log('✅ 社交情绪数据服务 - 测试成功');
    console.log(`   整体情绪: ${data.overallSentiment || 'N/A'}`);
    console.log(`   情绪趋势: ${data.sentimentTrend || 'N/A'}`);
    console.log(`   新闻情绪: ${data.newsSentiment || 'N/A'}`);
    
    return true;
  } catch (error) {
    console.log('❌ 社交情绪数据服务 - 测试失败:', error.message);
    return false;
  }
}

/**
 * 主测试函数
 */
async function runCompiledTests() {
  const results = [];
  
  console.log('正在测试编译后的服务模块...\n');
  
  // 测试各个服务
  results.push(await testOnchainDataService());
  results.push(await testMacroEconomicDataService());
  results.push(await testMultiExchangeDataService());
  results.push(await testSocialSentimentDataService());
  
  // 统计结果
  const successCount = results.filter(r => r).length;
  const totalCount = results.length;
  
  console.log('\n' + '='.repeat(60));
  console.log('🔧 编译后服务测试结果汇总:');
  console.log(`✅ 成功: ${successCount}/${totalCount} 个服务`);
  console.log(`❌ 失败: ${totalCount - successCount}/${totalCount} 个服务`);
  
  if (successCount === totalCount) {
    console.log('\n🎉 所有编译后服务测试通过！数据聚合功能正常。');
  } else if (successCount > 0) {
    console.log('\n⚠️  部分编译后服务测试失败，系统可以运行但功能受限。');
  } else {
    console.log('\n❌ 所有编译后服务测试失败，请检查编译和配置。');
  }
  
  return successCount === totalCount;
}

// 运行测试
runCompiledTests().catch(error => {
  console.error('编译后服务测试执行失败:', error);
  process.exit(1);
});