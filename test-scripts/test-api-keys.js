#!/usr/bin/env node

/**
 * API密钥测试脚本
 * 测试所有配置的API密钥是否能正常获取数据
 */

import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenv.config({ path: join(__dirname, '.env.macos') });

console.log('🔑 API密钥测试开始...\n');

/**
 * 测试Etherscan API
 */
async function testEtherscanAPI() {
  console.log('📊 测试 Etherscan API...');
  
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    console.log('❌ Etherscan API密钥未配置');
    return false;
  }
  
  try {
    const response = await axios.get('https://api.etherscan.io/api', {
      params: {
        module: 'gastracker',
        action: 'gasoracle',
        apikey: apiKey
      },
      timeout: 10000
    });
    
    if (response.data.status === '1') {
      console.log('✅ Etherscan API - 连接成功');
      console.log(`   Gas价格: ${response.data.result.SafeGasPrice} Gwei`);
      return true;
    } else {
      console.log('❌ Etherscan API - 响应错误:', response.data.message);
      return false;
    }
  } catch (error) {
    console.log('❌ Etherscan API - 请求失败:', error.message);
    return false;
  }
}

/**
 * 测试Alpha Vantage API
 */
async function testAlphaVantageAPI() {
  console.log('\n📈 测试 Alpha Vantage API...');
  
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    console.log('❌ Alpha Vantage API密钥未配置');
    return false;
  }
  
  try {
    const response = await axios.get('https://www.alphavantage.co/query', {
      params: {
        function: 'GLOBAL_QUOTE',
        symbol: 'SPY',
        apikey: apiKey
      },
      timeout: 15000
    });
    
    if (response.data['Global Quote']) {
      const quote = response.data['Global Quote'];
      console.log('✅ Alpha Vantage API - 连接成功');
      console.log(`   SPY价格: $${quote['05. price']}`);
      return true;
    } else if (response.data['Error Message']) {
      console.log('❌ Alpha Vantage API - 错误:', response.data['Error Message']);
      return false;
    } else if (response.data['Note']) {
      console.log('⚠️  Alpha Vantage API - 请求限制:', response.data['Note']);
      return false;
    } else {
      console.log('❌ Alpha Vantage API - 未知响应格式');
      return false;
    }
  } catch (error) {
    console.log('❌ Alpha Vantage API - 请求失败:', error.message);
    return false;
  }
}

/**
 * 测试FRED API
 */
async function testFREDAPI() {
  console.log('\n🏛️  测试 FRED API...');
  
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.log('❌ FRED API密钥未配置');
    return false;
  }
  
  try {
    const response = await axios.get('https://api.stlouisfed.org/fred/series/observations', {
      params: {
        series_id: 'DGS10',
        api_key: apiKey,
        file_type: 'json',
        limit: 1,
        sort_order: 'desc'
      },
      timeout: 10000
    });
    
    if (response.data.observations && response.data.observations.length > 0) {
      const observation = response.data.observations[0];
      console.log('✅ FRED API - 连接成功');
      console.log(`   10年期美债收益率: ${observation.value}%`);
      return true;
    } else {
      console.log('❌ FRED API - 无数据返回');
      return false;
    }
  } catch (error) {
    console.log('❌ FRED API - 请求失败:', error.message);
    return false;
  }
}

/**
 * 测试NewsAPI
 */
async function testNewsAPI() {
  console.log('\n📰 测试 NewsAPI...');
  
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    console.log('❌ NewsAPI密钥未配置');
    return false;
  }
  
  try {
    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: 'ethereum',
        sortBy: 'publishedAt',
        pageSize: 5,
        apiKey: apiKey
      },
      timeout: 10000
    });
    
    if (response.data.status === 'ok' && response.data.articles) {
      console.log('✅ NewsAPI - 连接成功');
      console.log(`   获取到 ${response.data.articles.length} 条以太坊新闻`);
      if (response.data.articles.length > 0) {
        console.log(`   最新标题: ${response.data.articles[0].title.substring(0, 50)}...`);
      }
      return true;
    } else {
      console.log('❌ NewsAPI - 响应错误:', response.data.message || '未知错误');
      return false;
    }
  } catch (error) {
    console.log('❌ NewsAPI - 请求失败:', error.message);
    return false;
  }
}

/**
 * 测试Binance API (无需密钥)
 */
async function testBinanceAPI() {
  console.log('\n🟡 测试 Binance API...');
  
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
      params: {
        symbol: 'ETHUSDT'
      },
      timeout: 10000
    });
    
    if (response.data.symbol) {
      console.log('✅ Binance API - 连接成功');
      console.log(`   ETH价格: $${parseFloat(response.data.lastPrice).toFixed(2)}`);
      console.log(`   24h成交量: ${parseFloat(response.data.volume).toFixed(0)} ETH`);
      return true;
    } else {
      console.log('❌ Binance API - 响应格式错误');
      return false;
    }
  } catch (error) {
    console.log('❌ Binance API - 请求失败:', error.message);
    return false;
  }
}

/**
 * 测试Bybit API (无需密钥)
 */
async function testBybitAPI() {
  console.log('\n🟠 测试 Bybit API...');
  
  try {
    const response = await axios.get('https://api.bybit.com/v5/market/tickers', {
      params: {
        category: 'linear',
        symbol: 'ETHUSDT'
      },
      timeout: 10000
    });
    
    if (response.data.retCode === 0 && response.data.result.list.length > 0) {
      const data = response.data.result.list[0];
      console.log('✅ Bybit API - 连接成功');
      console.log(`   ETH价格: $${parseFloat(data.lastPrice).toFixed(2)}`);
      console.log(`   24h成交量: ${parseFloat(data.volume24h).toFixed(0)} ETH`);
      return true;
    } else {
      console.log('❌ Bybit API - 响应错误:', response.data.retMsg);
      return false;
    }
  } catch (error) {
    console.log('❌ Bybit API - 请求失败:', error.message);
    return false;
  }
}

/**
 * 主测试函数
 */
async function runTests() {
  const results = [];
  
  // 测试所有API
  results.push(await testEtherscanAPI());
  results.push(await testAlphaVantageAPI());
  results.push(await testFREDAPI());
  results.push(await testNewsAPI());
  results.push(await testBinanceAPI());
  results.push(await testBybitAPI());
  
  // 统计结果
  const successCount = results.filter(r => r).length;
  const totalCount = results.length;
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 测试结果汇总:');
  console.log(`✅ 成功: ${successCount}/${totalCount} 个API`);
  console.log(`❌ 失败: ${totalCount - successCount}/${totalCount} 个API`);
  
  if (successCount === totalCount) {
    console.log('\n🎉 所有API测试通过！系统可以正常获取数据。');
  } else if (successCount > 0) {
    console.log('\n⚠️  部分API测试失败，系统可以运行但功能受限。');
  } else {
    console.log('\n❌ 所有API测试失败，请检查网络连接和API密钥配置。');
  }
  
  console.log('\n💡 提示:');
  console.log('- Alpha Vantage有每日请求限制，可能需要等待');
  console.log('- 网络问题可能导致偶发性失败');
  console.log('- 系统会自动处理API失败情况');
  
  return successCount === totalCount;
}

// 运行测试
runTests().catch(error => {
  console.error('测试脚本执行失败:', error);
  process.exit(1);
});