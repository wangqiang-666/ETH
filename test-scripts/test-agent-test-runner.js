#!/usr/bin/env node

/**
 * Agent测试运行器 - JavaScript版本
 * 用于测试和演示各种ETH合约Agent功能
 */

// 由于eth-agent-demo是TypeScript文件，我们直接使用test-agent-demo.js的功能
console.log('🎯 ETH合约Agent测试运行器');
console.log('=====================================\n');

console.log('🚀 启动Agent测试演示...\n');

// 运行基础的Agent演示
const { spawn } = require('child_process');

function runAgentDemo() {
  return new Promise((resolve, reject) => {
    const demo = spawn('node', ['test-scripts/test-agent-demo.js'], {
      cwd: process.cwd(),
      stdio: 'inherit'
    });
    
    demo.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Agent演示退出，代码: ${code}`));
      }
    });
    
    demo.on('error', (error) => {
      reject(error);
    });
  });
}

async function runFullAgentDemo() {
  try {
    console.log('📊 运行ETH合约Agent演示...');
    await runAgentDemo();
    
    console.log('\n🎉 Agent测试运行器演示完成！');
    console.log('\n💡 接下来您可以：');
    console.log('   1. 调整Agent配置参数');
    console.log('   2. 测试不同的时间段');
    console.log('   3. 集成真实的OKX API');
    console.log('   4. 添加更多的策略和指标');
    console.log('\n🔧 可用的测试脚本：');
    console.log('   • node test-scripts/test-agent-demo.js - 基础Agent演示');
    console.log('   • node test-scripts/test-learning-agent.js - 学习型Agent');
    console.log('   • node test-scripts/test-balanced-profit-agent.js - 平衡盈利Agent');
    console.log('   • node test-scripts/test-perfect-agent.js - 完美Agent');
    
  } catch (error) {
    console.error('❌ Agent测试运行器失败:', error.message);
    process.exit(1);
  }
}

// 如果直接运行此文件，执行完整演示
if (require.main === module) {
  runFullAgentDemo().catch(console.error);
}

module.exports = { runFullAgentDemo };