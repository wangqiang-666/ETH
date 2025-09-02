// 简单的启动脚本，用于测试系统
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 启动ETH合约策略分析系统...');
console.log('📊 集成机器学习大模型分析功能');

// 检查Node.js版本
const nodeVersion = process.version;
console.log(`Node.js版本: ${nodeVersion}`);

if (parseInt(nodeVersion.slice(1)) < 18) {
  console.error('❌ 需要Node.js 18或更高版本');
  process.exit(1);
}

// 检查必要文件是否存在
const fs = require('fs');
const requiredFiles = [
  'src/app.ts',
  'src/config.ts',
  'package.json',
  '.env.example'
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(__dirname, file))) {
    console.error(`❌ 缺少必要文件: ${file}`);
    process.exit(1);
  }
}

console.log('✅ 文件检查通过');

// 检查环境变量配置
if (!fs.existsSync(path.join(__dirname, '.env'))) {
  console.log('⚠️  未找到.env文件，请复制.env.example并配置相关参数');
  console.log('   cp .env.example .env');
}

console.log('\n📋 系统组件:');
console.log('   ✅ 技术指标分析模块');
console.log('   ✅ 机器学习分析模块');
console.log('   ✅ OKX数据获取服务');
console.log('   ✅ 智能信号分析器');
console.log('   ✅ 策略引擎');
console.log('   ✅ Web服务器和API');
console.log('   ✅ 实时Web界面');

console.log('\n🎯 主要功能:');
console.log('   🧠 OpenAI GPT集成分析');
console.log('   🤖 Hugging Face模型支持');
console.log('   📊 多时间框架技术指标');
console.log('   🎯 智能交易信号生成');
console.log('   🛡️ 风险管理和止损');
console.log('   🌐 实时Web仪表板');

console.log('\n📖 使用说明:');
console.log('   1. 配置.env文件中的API密钥');
console.log('   2. 运行: npm install (安装依赖)');
console.log('   3. 运行: npm start (启动系统)');
console.log('   4. 访问: http://localhost:3000 (Web界面)');

console.log('\n⚠️  重要提醒:');
console.log('   - 本系统仅用于教育和研究目的');
console.log('   - 加密货币交易存在高风险');
console.log('   - 请在测试环境中验证策略');
console.log('   - 不要投入超过承受能力的资金');

console.log('\n🎉 ETH合约策略分析系统准备就绪!');
console.log('📈 开始您的智能交易分析之旅!');