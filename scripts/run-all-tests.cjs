#!/usr/bin/env node

/**
 * 综合测试运行器
 * 运行所有A/B测试和多策略并行执行测试
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// 配置
const TEST_SCRIPTS = [
  {
    name: 'A/B测试框架',
    script: 'test-ab-testing.cjs',
    required: true
  },
  {
    name: '多策略并行执行',
    script: 'test-multi-strategy.cjs',
    required: true
  }
];

const RESULTS_DIR = path.join(__dirname, '../test-data');
const SUMMARY_FILE = path.join(RESULTS_DIR, 'test-summary.json');

// 确保结果目录存在
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

/**
 * 运行单个测试脚本
 */
function runTestScript(scriptName, scriptPath) {
  return new Promise((resolve, reject) => {
    console.log(`\n🧪 运行 ${scriptName}...`);
    
    const startTime = Date.now();
    const child = spawn('node', [scriptPath], {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' }
    });

    child.on('close', (code) => {
      const executionTime = Date.now() - startTime;
      
      if (code === 0) {
        console.log(`✅ ${scriptName} 测试通过 (耗时: ${executionTime}ms)`);
        resolve({
          name: scriptName,
          success: true,
          executionTime: executionTime,
          exitCode: code
        });
      } else {
        console.log(`❌ ${scriptName} 测试失败 (退出码: ${code}, 耗时: ${executionTime}ms)`);
        resolve({
          name: scriptName,
          success: false,
          executionTime: executionTime,
          exitCode: code
        });
      }
    });

    child.on('error', (error) => {
      console.error(`❌ 运行 ${scriptName} 时出错:`, error.message);
      reject(error);
    });
  });
}

/**
 * 收集测试结果
 */
function collectTestResults() {
  const results = {
    timestamp: new Date().toISOString(),
    testResults: {}
  };

  // 收集A/B测试结果
  const abTestResultsPath = path.join(RESULTS_DIR, 'ab-test-results.json');
  if (fs.existsSync(abTestResultsPath)) {
    try {
      const abTestResults = JSON.parse(fs.readFileSync(abTestResultsPath, 'utf8'));
      results.testResults.abTesting = abTestResults;
    } catch (error) {
      console.warn('⚠️  无法读取A/B测试结果:', error.message);
    }
  }

  // 收集多策略测试结果
  const multiStrategyResultsPath = path.join(RESULTS_DIR, 'multi-strategy-results.json');
  if (fs.existsSync(multiStrategyResultsPath)) {
    try {
      const multiStrategyResults = JSON.parse(fs.readFileSync(multiStrategyResultsPath, 'utf8'));
      results.testResults.multiStrategy = multiStrategyResults;
    } catch (error) {
      console.warn('⚠️  无法读取多策略测试结果:', error.message);
    }
  }

  return results;
}

/**
 * 生成测试报告
 */
function generateTestReport(scriptResults, collectedResults) {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalScripts: scriptResults.length,
      passedScripts: scriptResults.filter(r => r.success).length,
      failedScripts: scriptResults.filter(r => !r.success).length,
      totalExecutionTime: scriptResults.reduce((sum, r) => sum + r.executionTime, 0)
    },
    scriptResults: scriptResults,
    detailedResults: collectedResults.testResults
  };

  // 添加A/B测试分析
  if (collectedResults.testResults.abTesting) {
    const abResults = collectedResults.testResults.abTesting;
    report.abTestingAnalysis = {
      testsPassed: abResults.summary.passedTests,
      testsFailed: abResults.summary.failedTests,
      variantDistribution: abResults.tests.variantAssignment?.assignments || {},
      performanceMetrics: {
        recommendationsCreated: abResults.tests.recommendationCreation?.recommendations?.length || 0,
        variantStatisticsAvailable: !!abResults.tests.variantStatistics?.data
      }
    };
  }

  // 添加多策略分析
  if (collectedResults.testResults.multiStrategy) {
    const msResults = collectedResults.testResults.multiStrategy;
    report.multiStrategyAnalysis = {
      testsPassed: msResults.summary.passedTests,
      testsFailed: msResults.summary.failedTests,
      performanceMetrics: msResults.performance || {},
      strategyStats: msResults.tests.strategyExecutionStatus?.tests || []
    };
  }

  return report;
}

/**
 * 显示测试结果摘要
 */
function displayResultsSummary(report) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 测试结果摘要');
  console.log('='.repeat(60));
  
  console.log(`\n🎯 总体结果:`);
  console.log(`  测试脚本: ${report.summary.passedScripts}/${report.summary.totalScripts} 通过`);
  console.log(`  总执行时间: ${report.summary.totalExecutionTime}ms`);
  
  if (report.abTestingAnalysis) {
    console.log(`\n🧪 A/B测试框架:`);
    console.log(`  测试通过: ${report.abTestingAnalysis.testsPassed}`);
    console.log(`  测试失败: ${report.abTestingAnalysis.testsFailed}`);
    console.log(`  推荐创建: ${report.abTestingAnalysis.performanceMetrics.recommendationsCreated}`);
    
    if (Object.keys(report.abTestingAnalysis.variantDistribution).length > 0) {
      console.log(`  变体分配: ${Object.keys(report.abTestingAnalysis.variantDistribution).length} 个用户`);
    }
  }
  
  if (report.multiStrategyAnalysis) {
    console.log(`\n🚀 多策略并行执行:`);
    console.log(`  测试通过: ${report.multiStrategyAnalysis.testsPassed}`);
    console.log(`  测试失败: ${report.multiStrategyAnalysis.testsFailed}`);
    
    if (report.multiStrategyAnalysis.performanceMetrics.totalRecommendationsCreated) {
      console.log(`  推荐创建: ${report.multiStrategyAnalysis.performanceMetrics.totalRecommendationsCreated}`);
      console.log(`  吞吐量: ${report.multiStrategyAnalysis.performanceMetrics.batchCreationThroughput?.toFixed(2)} 推荐/秒`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 启动综合测试运行器');
  console.log(`📁 测试结果将保存到: ${RESULTS_DIR}`);
  
  const scriptResults = [];
  let hasFailures = false;

  // 运行所有测试脚本
  for (const testScript of TEST_SCRIPTS) {
    try {
      const scriptPath = path.join(__dirname, testScript.script);
      
      if (!fs.existsSync(scriptPath)) {
        console.warn(`⚠️  测试脚本不存在: ${testScript.script}`);
        if (testScript.required) {
          hasFailures = true;
        }
        continue;
      }

      const result = await runTestScript(testScript.name, scriptPath);
      scriptResults.push(result);
      
      if (!result.success && testScript.required) {
        hasFailures = true;
      }
    } catch (error) {
      console.error(`❌ 运行测试脚本失败: ${testScript.name}`, error.message);
      hasFailures = true;
      
      scriptResults.push({
        name: testScript.name,
        success: false,
        error: error.message
      });
    }
  }

  // 收集测试结果
  console.log('\n📊 收集测试结果...');
  const collectedResults = collectTestResults();

  // 生成测试报告
  const report = generateTestReport(scriptResults, collectedResults);

  // 保存测试报告
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(report, null, 2));
  console.log(`💾 测试报告已保存到: ${SUMMARY_FILE}`);

  // 显示结果摘要
  displayResultsSummary(report);

  // 退出码
  if (hasFailures) {
    console.log('\n❌ 检测到失败的测试，请检查详细结果');
    process.exit(1);
  } else {
    console.log('\n✅ 所有测试均通过！');
    process.exit(0);
  }
}

/**
 * 显示使用说明
 */
function showUsage() {
  console.log(`
使用方法:
  node run-all-tests.cjs [选项]

选项:
  --help, -h     显示此帮助信息
  --api-url URL  设置API服务器URL (默认: http://localhost:3033/api)

环境变量:
  API_URL        API服务器URL

示例:
  node run-all-tests.cjs
  node run-all-tests.cjs --api-url http://localhost:8080/api
  API_URL=http://localhost:8080/api node run-all-tests.cjs
`);
}

// 解析命令行参数
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showUsage();
  process.exit(0);
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
  runTestScript,
  generateTestReport,
  collectTestResults
};