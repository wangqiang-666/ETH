#!/usr/bin/env node

/**
 * 市场状态识别与自适应系统测试套件运行器
 * 统一执行所有测试并生成综合报告
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 市场状态识别与自适应系统 - 完整测试套件\n');

const testSuites = [
    {
        name: '冒烟测试',
        script: 'tests/smoke/smoke-test.cjs',
        description: '基础功能和文件结构验证',
        category: 'basic',
        timeout: 30000
    },
    {
        name: '功能测试',
        script: 'tests/functional/functional-test.cjs',
        description: '核心算法逻辑和数据处理验证',
        category: 'functional',
        timeout: 60000
    },
    {
        name: '性能测试',
        script: 'tests/performance/performance-test.cjs',
        description: '系统性能和资源使用验证',
        category: 'performance',
        timeout: 120000
    },
    {
        name: '集成测试',
        script: 'tests/integration/integration-test.cjs',
        description: '模块间协作和数据流验证',
        category: 'integration',
        timeout: 90000
    },
    {
        name: '安全测试',
        script: 'tests/security/security-test.cjs',
        description: '安全性和数据保护验证',
        category: 'security',
        timeout: 60000
    }
];

const testResults = {
    startTime: Date.now(),
    endTime: null,
    totalDuration: 0,
    suites: [],
    summary: {
        total: testSuites.length,
        passed: 0,
        failed: 0,
        skipped: 0,
        successRate: 0
    },
    categories: {
        basic: { passed: 0, failed: 0, total: 0 },
        functional: { passed: 0, failed: 0, total: 0 },
        performance: { passed: 0, failed: 0, total: 0 },
        integration: { passed: 0, failed: 0, total: 0 },
        security: { passed: 0, failed: 0, total: 0 }
    }
};

function runTestSuite(suite) {
    return new Promise((resolve) => {
        console.log(`📋 执行 ${suite.name}...`);
        console.log(`   描述: ${suite.description}`);
        console.log(`   脚本: ${suite.script}`);
        
        const startTime = Date.now();
        const child = spawn('node', [suite.script], {
            cwd: __dirname,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        
        // 设置超时
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
        }, suite.timeout);
        
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        child.on('close', (code) => {
            clearTimeout(timeout);
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            const result = {
                name: suite.name,
                script: suite.script,
                description: suite.description,
                category: suite.category,
                passed: !timedOut && code === 0,
                exitCode: code,
                duration,
                timedOut,
                stdout: stdout.slice(-2000), // 保留最后2000字符
                stderr: stderr.slice(-1000), // 保留最后1000字符
                timestamp: startTime
            };
            
            // 更新统计
            testResults.suites.push(result);
            testResults.categories[suite.category].total++;
            
            if (result.passed) {
                testResults.summary.passed++;
                testResults.categories[suite.category].passed++;
                console.log(`   ✅ ${suite.name} 通过 (${duration}ms)\n`);
            } else {
                testResults.summary.failed++;
                testResults.categories[suite.category].failed++;
                const reason = timedOut ? '超时' : `退出码: ${code}`;
                console.log(`   ❌ ${suite.name} 失败 (${reason}, ${duration}ms)\n`);
                
                if (stderr) {
                    console.log(`   错误输出: ${stderr.slice(-200)}\n`);
                }
            }
            
            resolve(result);
        });
        
        child.on('error', (error) => {
            clearTimeout(timeout);
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            const result = {
                name: suite.name,
                script: suite.script,
                description: suite.description,
                category: suite.category,
                passed: false,
                exitCode: -1,
                duration,
                timedOut: false,
                stdout: '',
                stderr: error.message,
                timestamp: startTime,
                error: error.message
            };
            
            testResults.suites.push(result);
            testResults.summary.failed++;
            testResults.categories[suite.category].total++;
            testResults.categories[suite.category].failed++;
            
            console.log(`   ❌ ${suite.name} 执行失败: ${error.message}\n`);
            resolve(result);
        });
    });
}

async function runAllTests() {
    console.log(`开始执行 ${testSuites.length} 个测试套件...\n`);
    
    // 顺序执行所有测试套件
    for (const suite of testSuites) {
        await runTestSuite(suite);
    }
    
    // 计算总体结果
    testResults.endTime = Date.now();
    testResults.totalDuration = testResults.endTime - testResults.startTime;
    testResults.summary.successRate = (testResults.summary.passed / testResults.summary.total * 100).toFixed(1);
    
    // 生成测试报告
    generateTestReport();
    
    // 输出总结
    printTestSummary();
    
    return testResults.summary.failed === 0;
}

function generateTestReport() {
    // 生成详细的测试报告
    const report = {
        ...testResults,
        systemInfo: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            memory: process.memoryUsage(),
            cwd: process.cwd()
        },
        recommendations: generateRecommendations()
    };
    
    // 保存JSON报告
    const jsonReportPath = path.join(__dirname, 'tests/reports/test-suite-report.json');
    fs.writeFileSync(jsonReportPath, JSON.stringify(report, null, 2));
    
    // 生成HTML报告
    const htmlReport = generateHtmlReport(report);
    const htmlReportPath = path.join(__dirname, 'tests/reports/test-suite-report.html');
    fs.writeFileSync(htmlReportPath, htmlReport);
    
    console.log(`📄 测试报告已生成:`);
    console.log(`   JSON: ${jsonReportPath}`);
    console.log(`   HTML: ${htmlReportPath}\n`);
}

function generateRecommendations() {
    const recommendations = [];
    
    // 基于测试结果生成建议
    if (testResults.summary.failed > 0) {
        recommendations.push({
            type: 'CRITICAL',
            message: `${testResults.summary.failed} 个测试套件失败，需要立即修复`,
            action: '检查失败的测试输出，修复相关问题'
        });
    }
    
    // 性能建议
    const performanceResult = testResults.suites.find(s => s.category === 'performance');
    if (performanceResult && performanceResult.duration > 60000) {
        recommendations.push({
            type: 'WARNING',
            message: '性能测试执行时间较长',
            action: '考虑优化算法或增加硬件资源'
        });
    }
    
    // 安全建议
    const securityResult = testResults.suites.find(s => s.category === 'security');
    if (securityResult && !securityResult.passed) {
        recommendations.push({
            type: 'HIGH',
            message: '安全测试失败',
            action: '立即检查安全配置和实现'
        });
    }
    
    // 成功建议
    if (testResults.summary.failed === 0) {
        recommendations.push({
            type: 'SUCCESS',
            message: '所有测试通过，系统准备就绪',
            action: '可以考虑部署到生产环境'
        });
    }
    
    return recommendations;
}

function generateHtmlReport(report) {
    const successRate = report.summary.successRate;
    const statusColor = successRate >= 90 ? '#4CAF50' : 
                       successRate >= 70 ? '#FF9800' : '#F44336';
    
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>测试套件报告 - 市场状态识别与自适应系统</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5; 
            color: #333; 
            line-height: 1.6;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; 
            padding: 30px; 
            border-radius: 10px; 
            margin-bottom: 30px;
            text-align: center;
        }
        .header h1 { font-size: 2.5rem; margin-bottom: 10px; }
        .header p { font-size: 1.1rem; opacity: 0.9; }
        .summary { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
            gap: 20px; 
            margin-bottom: 30px; 
        }
        .summary-card { 
            background: white; 
            padding: 25px; 
            border-radius: 10px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .summary-card h3 { color: #666; margin-bottom: 10px; }
        .summary-card .value { 
            font-size: 2rem; 
            font-weight: bold; 
            color: ${statusColor}; 
        }
        .test-results { 
            background: white; 
            border-radius: 10px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
            margin-bottom: 30px;
        }
        .test-results h2 { 
            background: #f8f9fa; 
            padding: 20px; 
            border-bottom: 1px solid #dee2e6; 
        }
        .test-item { 
            padding: 20px; 
            border-bottom: 1px solid #eee; 
            display: flex; 
            justify-content: space-between; 
            align-items: center;
        }
        .test-item:last-child { border-bottom: none; }
        .test-info h4 { margin-bottom: 5px; }
        .test-info p { color: #666; font-size: 0.9rem; }
        .test-status { 
            display: flex; 
            align-items: center; 
            gap: 10px; 
        }
        .status-badge { 
            padding: 5px 15px; 
            border-radius: 20px; 
            font-size: 0.8rem; 
            font-weight: bold; 
        }
        .status-passed { background: #d4edda; color: #155724; }
        .status-failed { background: #f8d7da; color: #721c24; }
        .duration { color: #666; font-size: 0.9rem; }
        .recommendations { 
            background: white; 
            border-radius: 10px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            padding: 25px;
        }
        .recommendation { 
            padding: 15px; 
            margin-bottom: 15px; 
            border-radius: 5px; 
            border-left: 4px solid;
        }
        .rec-critical { background: #f8d7da; border-color: #dc3545; }
        .rec-warning { background: #fff3cd; border-color: #ffc107; }
        .rec-high { background: #f1c0c7; border-color: #e74c3c; }
        .rec-success { background: #d4edda; border-color: #28a745; }
        .footer { 
            text-align: center; 
            color: #666; 
            margin-top: 30px; 
            padding: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎯 测试套件报告</h1>
            <p>市场状态识别与自适应系统 - 完整测试验证</p>
            <p>生成时间: ${new Date(report.endTime).toLocaleString()}</p>
        </div>
        
        <div class="summary">
            <div class="summary-card">
                <h3>总体成功率</h3>
                <div class="value">${report.summary.successRate}%</div>
            </div>
            <div class="summary-card">
                <h3>通过测试</h3>
                <div class="value" style="color: #4CAF50;">${report.summary.passed}</div>
            </div>
            <div class="summary-card">
                <h3>失败测试</h3>
                <div class="value" style="color: #F44336;">${report.summary.failed}</div>
            </div>
            <div class="summary-card">
                <h3>总执行时间</h3>
                <div class="value" style="color: #2196F3;">${(report.totalDuration / 1000).toFixed(1)}s</div>
            </div>
        </div>
        
        <div class="test-results">
            <h2>📋 测试套件详情</h2>
            ${report.suites.map(suite => `
                <div class="test-item">
                    <div class="test-info">
                        <h4>${suite.name}</h4>
                        <p>${suite.description}</p>
                        <p><strong>类别:</strong> ${suite.category} | <strong>脚本:</strong> ${suite.script}</p>
                    </div>
                    <div class="test-status">
                        <span class="status-badge ${suite.passed ? 'status-passed' : 'status-failed'}">
                            ${suite.passed ? '✅ 通过' : '❌ 失败'}
                        </span>
                        <span class="duration">${suite.duration}ms</span>
                    </div>
                </div>
            `).join('')}
        </div>
        
        <div class="recommendations">
            <h2>💡 建议和建议</h2>
            ${report.recommendations.map(rec => `
                <div class="recommendation rec-${rec.type.toLowerCase()}">
                    <strong>${rec.message}</strong><br>
                    <em>建议操作: ${rec.action}</em>
                </div>
            `).join('')}
        </div>
        
        <div class="footer">
            <p>🚀 市场状态识别与自适应系统测试套件</p>
            <p>Node.js ${report.systemInfo.nodeVersion} | ${report.systemInfo.platform} ${report.systemInfo.arch}</p>
        </div>
    </div>
</body>
</html>`;
}

function printTestSummary() {
    console.log('=' .repeat(60));
    console.log('📊 测试套件执行总结');
    console.log('=' .repeat(60));
    
    console.log(`\n🎯 总体结果:`);
    console.log(`   测试套件总数: ${testResults.summary.total}`);
    console.log(`   通过: ${testResults.summary.passed}`);
    console.log(`   失败: ${testResults.summary.failed}`);
    console.log(`   成功率: ${testResults.summary.successRate}%`);
    console.log(`   总执行时间: ${(testResults.totalDuration / 1000).toFixed(1)}秒`);
    
    console.log(`\n📋 分类统计:`);
    Object.entries(testResults.categories).forEach(([category, stats]) => {
        if (stats.total > 0) {
            const rate = ((stats.passed / stats.total) * 100).toFixed(1);
            const status = stats.failed === 0 ? '✅' : '❌';
            console.log(`   ${status} ${category}: ${stats.passed}/${stats.total} (${rate}%)`);
        }
    });
    
    if (testResults.summary.failed > 0) {
        console.log(`\n❌ 失败的测试套件:`);
        testResults.suites
            .filter(suite => !suite.passed)
            .forEach(suite => {
                const reason = suite.timedOut ? '超时' : 
                              suite.error ? suite.error : 
                              `退出码: ${suite.exitCode}`;
                console.log(`   • ${suite.name}: ${reason}`);
            });
    }
    
    console.log(`\n💡 建议:`);
    const recommendations = generateRecommendations();
    recommendations.forEach(rec => {
        const icon = {
            'CRITICAL': '🚨',
            'HIGH': '⚠️',
            'WARNING': '⚡',
            'SUCCESS': '🎉'
        }[rec.type] || '💡';
        console.log(`   ${icon} ${rec.message}`);
    });
    
    console.log('\n' + '=' .repeat(60));
    
    if (testResults.summary.failed === 0) {
        console.log('🎉 所有测试通过！系统准备就绪，可以部署到生产环境。');
    } else {
        console.log('⚠️ 部分测试失败，请修复问题后重新运行测试。');
    }
    
    console.log('=' .repeat(60));
}

// 处理命令行参数
const args = process.argv.slice(2);
const selectedCategories = args.length > 0 ? args : ['basic', 'functional', 'performance', 'integration', 'security'];

// 过滤测试套件
const filteredTestSuites = testSuites.filter(suite => 
    selectedCategories.includes(suite.category)
);

if (filteredTestSuites.length === 0) {
    console.log('❌ 没有找到匹配的测试套件');
    console.log('可用的测试类别: basic, functional, performance, integration, security');
    process.exit(1);
}

console.log(`📋 将执行以下类别的测试: ${selectedCategories.join(', ')}`);
console.log(`📊 共 ${filteredTestSuites.length} 个测试套件\n`);

// 运行测试
runAllTests().then(success => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('测试套件执行失败:', error);
    process.exit(1);
});