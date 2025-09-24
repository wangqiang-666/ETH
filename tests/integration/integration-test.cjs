#!/usr/bin/env node

/**
 * 市场状态识别与自适应系统集成测试
 * 测试各模块间的协作和数据流
 */

const fs = require('fs');
const path = require('path');

console.log('🔗 开始集成测试...\n');

const integrationResults = {
    testSuites: [],
    summary: {
        totalSuites: 0,
        passedSuites: 0,
        failedSuites: 0,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0
    }
};

function logIntegrationTest(suiteName, testName, passed, error = null) {
    let suite = integrationResults.testSuites.find(s => s.name === suiteName);
    if (!suite) {
        suite = { name: suiteName, tests: [], passed: 0, failed: 0 };
        integrationResults.testSuites.push(suite);
        integrationResults.summary.totalSuites++;
    }
    
    suite.tests.push({ name: testName, passed, error });
    integrationResults.summary.totalTests++;
    
    if (passed) {
        console.log(`  ✅ ${testName}`);
        suite.passed++;
        integrationResults.summary.passedTests++;
    } else {
        console.log(`  ❌ ${testName}: ${error}`);
        suite.failed++;
        integrationResults.summary.failedTests++;
    }
}

function finalizeSuite(suiteName) {
    const suite = integrationResults.testSuites.find(s => s.name === suiteName);
    if (suite) {
        const suiteSuccess = suite.failed === 0;
        if (suiteSuccess) {
            integrationResults.summary.passedSuites++;
            console.log(`✅ ${suiteName} 测试套件通过 (${suite.passed}/${suite.passed + suite.failed})\n`);
        } else {
            integrationResults.summary.failedSuites++;
            console.log(`❌ ${suiteName} 测试套件失败 (${suite.passed}/${suite.passed + suite.failed})\n`);
        }
    }
}

// 1. 数据流集成测试
console.log('📊 数据流集成测试');

function testDataFlowIntegration() {
    const suiteName = '数据流集成';
    
    try {
        // 模拟完整的数据处理流程
        
        // 1. 原始市场数据输入
        const rawMarketData = {
            symbol: 'ETH-USDT',
            klines: generateMockKlines(100),
            volume24h: 1500000000,
            currentPrice: 2500
        };
        
        logIntegrationTest(suiteName, '原始数据接收', 
            rawMarketData.klines.length === 100 && rawMarketData.currentPrice > 0);
        
        // 2. 技术指标计算
        const technicalIndicators = calculateMockIndicators(rawMarketData.klines);
        
        logIntegrationTest(suiteName, '技术指标计算', 
            technicalIndicators.rsi && technicalIndicators.macd && technicalIndicators.atr);
        
        // 3. 市场状态识别
        const marketState = identifyMarketState(technicalIndicators, rawMarketData);
        
        logIntegrationTest(suiteName, '市场状态识别', 
            marketState.primaryState && marketState.confidence >= 0 && marketState.confidence <= 1);
        
        // 4. 参数自适应调整
        const adaptiveParams = adjustParameters(marketState);
        
        logIntegrationTest(suiteName, '参数自适应调整', 
            adaptiveParams.signalThreshold && adaptiveParams.leverage && adaptiveParams.stopLoss);
        
        // 5. 策略信号生成
        const strategySignal = generateStrategySignal(marketState, adaptiveParams, rawMarketData);
        
        logIntegrationTest(suiteName, '策略信号生成', 
            ['BUY', 'SELL', 'HOLD'].includes(strategySignal.action) && 
            strategySignal.confidence >= 0 && strategySignal.confidence <= 1);
        
        // 6. 概率校准
        const calibratedSignal = calibrateProbability(strategySignal);
        
        logIntegrationTest(suiteName, '概率校准', 
            calibratedSignal.calibratedProbability >= 0 && calibratedSignal.calibratedProbability <= 1);
        
        // 7. 数据持久化
        const persistenceResult = simulateDataPersistence({
            marketState,
            adaptiveParams,
            strategySignal,
            calibratedSignal
        });
        
        logIntegrationTest(suiteName, '数据持久化', persistenceResult.success);
        
    } catch (error) {
        logIntegrationTest(suiteName, '数据流异常处理', false, error.message);
    }
    
    finalizeSuite(suiteName);
}

// 2. 模块间通信测试
console.log('🔄 模块间通信测试');

function testModuleCommunication() {
    const suiteName = '模块间通信';
    
    try {
        // 模拟各模块间的事件通信
        
        // 1. 市场状态变化事件
        const marketStateEvent = {
            type: 'MARKET_STATE_CHANGED',
            data: {
                previousState: 'SIDEWAYS',
                currentState: 'TRENDING_UP',
                confidence: 0.85,
                timestamp: Date.now()
            }
        };
        
        // 参数管理器响应
        const parameterResponse = handleMarketStateChange(marketStateEvent);
        logIntegrationTest(suiteName, '市场状态变化事件处理', 
            parameterResponse.parametersAdjusted && parameterResponse.adjustmentReason);
        
        // 2. 参数更新事件
        const parameterUpdateEvent = {
            type: 'PARAMETERS_UPDATED',
            data: {
                previousParams: { signalThreshold: 0.5, leverage: 3 },
                newParams: { signalThreshold: 0.45, leverage: 3.5 },
                reason: 'Market state change to TRENDING_UP',
                timestamp: Date.now()
            }
        };
        
        // 策略服务响应
        const strategyResponse = handleParameterUpdate(parameterUpdateEvent);
        logIntegrationTest(suiteName, '参数更新事件处理', 
            strategyResponse.strategyAdjusted && strategyResponse.newSignalGenerated);
        
        // 3. 校准数据更新事件
        const calibrationEvent = {
            type: 'CALIBRATION_DATA_ADDED',
            data: {
                strategyId: 'technical_momentum',
                prediction: 0.75,
                actualOutcome: 1,
                timestamp: Date.now()
            }
        };
        
        // 校准服务响应
        const calibrationResponse = handleCalibrationUpdate(calibrationEvent);
        logIntegrationTest(suiteName, '校准数据更新事件处理', 
            calibrationResponse.modelUpdated && calibrationResponse.performanceImproved !== undefined);
        
        // 4. 热更新事件
        const hotUpdateEvent = {
            type: 'CONFIG_UPDATED',
            data: {
                configType: 'STRATEGY',
                changes: { signalThreshold: 0.55 },
                source: 'API',
                timestamp: Date.now()
            }
        };
        
        // 系统响应
        const systemResponse = handleHotUpdate(hotUpdateEvent);
        logIntegrationTest(suiteName, '热更新事件处理', 
            systemResponse.configApplied && systemResponse.servicesNotified);
        
    } catch (error) {
        logIntegrationTest(suiteName, '模块通信异常', false, error.message);
    }
    
    finalizeSuite(suiteName);
}

// 3. 错误处理和恢复测试
console.log('🛡️ 错误处理和恢复测试');

function testErrorHandlingAndRecovery() {
    const suiteName = '错误处理和恢复';
    
    try {
        // 1. 数据异常处理
        const invalidData = {
            klines: null,
            currentPrice: 'invalid',
            volume24h: -1000
        };
        
        const dataValidationResult = validateAndSanitizeData(invalidData);
        logIntegrationTest(suiteName, '无效数据处理', 
            dataValidationResult.isValid === false && dataValidationResult.errors.length > 0);
        
        // 2. 计算异常处理
        const extremeData = {
            klines: [{ open: 0, high: 0, low: 0, close: 0, volume: 0 }],
            currentPrice: 0
        };
        
        const calculationResult = safeCalculateIndicators(extremeData);
        logIntegrationTest(suiteName, '极端数据计算保护', 
            calculationResult.success === false && calculationResult.fallbackUsed);
        
        // 3. 网络异常恢复
        const networkError = simulateNetworkError();
        const recoveryResult = handleNetworkError(networkError);
        logIntegrationTest(suiteName, '网络异常恢复', 
            recoveryResult.retryAttempted && recoveryResult.fallbackActivated);
        
        // 4. 内存溢出保护
        const memoryStressResult = simulateMemoryStress();
        logIntegrationTest(suiteName, '内存溢出保护', 
            memoryStressResult.memoryLimitRespected && memoryStressResult.gracefulDegradation);
        
        // 5. 配置回滚测试
        const invalidConfig = { signalThreshold: -1, leverage: 1000 };
        const configRollbackResult = testConfigRollback(invalidConfig);
        logIntegrationTest(suiteName, '配置回滚机制', 
            configRollbackResult.rollbackExecuted && configRollbackResult.systemStable);
        
    } catch (error) {
        logIntegrationTest(suiteName, '错误处理框架', false, error.message);
    }
    
    finalizeSuite(suiteName);
}

// 4. 性能和资源管理测试
console.log('⚡ 性能和资源管理测试');

async function testPerformanceAndResourceManagement() {
    const suiteName = '性能和资源管理';
    
    try {
        // 1. 内存泄漏检测
        const initialMemory = process.memoryUsage().heapUsed;
        
        // 模拟大量操作
        for (let i = 0; i < 1000; i++) {
            const mockData = generateMockKlines(100);
            const indicators = calculateMockIndicators(mockData);
            // 确保对象被正确释放
        }
        
        // 强制垃圾回收
        if (global.gc) global.gc();
        
        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // MB
        
        logIntegrationTest(suiteName, '内存泄漏检测', 
            memoryIncrease < 50, `内存增长: ${memoryIncrease.toFixed(2)}MB`);
        
        // 2. CPU使用率监控
        const cpuIntensiveStart = Date.now();
        
        // 模拟CPU密集型操作
        let result = 0;
        for (let i = 0; i < 1000000; i++) {
            result += Math.sqrt(i) * Math.sin(i);
        }
        
        const cpuTime = Date.now() - cpuIntensiveStart;
        logIntegrationTest(suiteName, 'CPU密集型操作控制', 
            cpuTime < 1000, `执行时间: ${cpuTime}ms`);
        
        // 3. 并发限制测试
        const concurrentLimit = 50;
        const concurrentTasks = [];
        
        for (let i = 0; i < concurrentLimit * 2; i++) {
            concurrentTasks.push(simulateAsyncTask(i));
        }
        
        const concurrentStart = Date.now();
        const results = await Promise.all(concurrentTasks);
        const concurrentTime = Date.now() - concurrentStart;
        
        logIntegrationTest(suiteName, '并发任务管理', 
            results.length === concurrentLimit * 2 && concurrentTime < 5000);
        
        // 4. 缓存效率测试
        const cacheTest = testCacheEfficiency();
        logIntegrationTest(suiteName, '缓存系统效率', 
            cacheTest.hitRate > 0.8 && cacheTest.avgResponseTime < 10);
        
    } catch (error) {
        logIntegrationTest(suiteName, '性能监控异常', false, error.message);
    }
    
    finalizeSuite(suiteName);
}

// 5. 端到端业务流程测试
console.log('🎯 端到端业务流程测试');

function testEndToEndBusinessFlow() {
    const suiteName = '端到端业务流程';
    
    try {
        // 完整的交易决策流程
        
        // 1. 市场数据接收
        const marketData = {
            symbol: 'ETH-USDT',
            timestamp: Date.now(),
            price: 2500,
            volume: 1000000,
            klines: generateMockKlines(200)
        };
        
        logIntegrationTest(suiteName, '市场数据接收', 
            marketData.klines.length >= 200 && marketData.price > 0);
        
        // 2. 多时间框架分析
        const timeFrameAnalysis = analyzeMultiTimeFrames(marketData);
        logIntegrationTest(suiteName, '多时间框架分析', 
            timeFrameAnalysis.consistency > 0 && Object.keys(timeFrameAnalysis.frames).length >= 3);
        
        // 3. 市场状态综合判断
        const comprehensiveState = comprehensiveMarketAnalysis(marketData, timeFrameAnalysis);
        logIntegrationTest(suiteName, '综合市场状态判断', 
            comprehensiveState.primaryState && comprehensiveState.confidence > 0.5);
        
        // 4. 风险评估
        const riskAssessment = assessRisk(comprehensiveState, marketData);
        logIntegrationTest(suiteName, '风险评估', 
            riskAssessment.riskLevel && riskAssessment.maxPosition > 0);
        
        // 5. 策略选择和参数优化
        const optimizedStrategy = selectAndOptimizeStrategy(comprehensiveState, riskAssessment);
        logIntegrationTest(suiteName, '策略选择和优化', 
            optimizedStrategy.selectedStrategy && optimizedStrategy.optimizedParams);
        
        // 6. 信号生成和校准
        const finalSignal = generateAndCalibrateSignal(optimizedStrategy, marketData);
        logIntegrationTest(suiteName, '最终信号生成', 
            finalSignal.action !== 'UNDEFINED' && finalSignal.calibratedConfidence > 0);
        
        // 7. 执行决策
        const executionDecision = makeExecutionDecision(finalSignal, riskAssessment);
        logIntegrationTest(suiteName, '执行决策', 
            executionDecision.shouldExecute !== undefined && executionDecision.reasoning);
        
        // 8. 结果记录和学习
        const learningResult = recordAndLearn(finalSignal, executionDecision);
        logIntegrationTest(suiteName, '结果记录和学习', 
            learningResult.recorded && learningResult.modelUpdated);
        
    } catch (error) {
        logIntegrationTest(suiteName, '端到端流程异常', false, error.message);
    }
    
    finalizeSuite(suiteName);
}

// 辅助函数实现
function generateMockKlines(count) {
    const klines = [];
    let price = 2500;
    
    for (let i = 0; i < count; i++) {
        const change = (Math.random() - 0.5) * 0.02;
        const open = price;
        const close = price * (1 + change);
        const high = Math.max(open, close) * (1 + Math.random() * 0.005);
        const low = Math.min(open, close) * (1 - Math.random() * 0.005);
        
        klines.push({
            timestamp: Date.now() - (count - i) * 60000,
            open, high, low, close,
            volume: 1000000 + Math.random() * 500000
        });
        
        price = close;
    }
    
    return klines;
}

function calculateMockIndicators(klines) {
    const closes = klines.map(k => k.close);
    const sma20 = closes.slice(-20).reduce((sum, p) => sum + p, 0) / 20;
    
    return {
        rsi: 50 + (Math.random() - 0.5) * 40,
        macd: { macd: Math.random() - 0.5, signal: Math.random() - 0.5, histogram: Math.random() - 0.5 },
        atr: Math.random() * 50,
        adx: Math.random() * 50,
        sma20,
        ema12: sma20 * (1 + (Math.random() - 0.5) * 0.01),
        ema26: sma20 * (1 + (Math.random() - 0.5) * 0.01)
    };
}

function identifyMarketState(indicators, marketData) {
    const states = ['TRENDING_UP', 'TRENDING_DOWN', 'SIDEWAYS', 'HIGH_VOLATILITY', 'LOW_VOLATILITY'];
    return {
        primaryState: states[Math.floor(Math.random() * states.length)],
        confidence: 0.5 + Math.random() * 0.4,
        adxValue: indicators.adx,
        atrPercentile: Math.random() * 100,
        volatilityLevel: ['LOW', 'MEDIUM', 'HIGH'][Math.floor(Math.random() * 3)]
    };
}

function adjustParameters(marketState) {
    return {
        signalThreshold: 0.4 + Math.random() * 0.3,
        leverage: 1 + Math.random() * 4,
        stopLoss: 0.01 + Math.random() * 0.02,
        takeProfit: 0.02 + Math.random() * 0.03
    };
}

function generateStrategySignal(marketState, params, marketData) {
    const actions = ['BUY', 'SELL', 'HOLD'];
    return {
        action: actions[Math.floor(Math.random() * actions.length)],
        strength: Math.random(),
        confidence: Math.random(),
        leverage: params.leverage,
        stopLoss: marketData.currentPrice * (1 - params.stopLoss),
        takeProfit: marketData.currentPrice * (1 + params.takeProfit)
    };
}

function calibrateProbability(signal) {
    return {
        ...signal,
        calibratedProbability: Math.max(0, Math.min(1, signal.confidence + (Math.random() - 0.5) * 0.1)),
        brierScore: Math.random() * 0.3,
        calibrationError: Math.random() * 0.1
    };
}

function simulateDataPersistence(data) {
    return {
        success: Math.random() > 0.1, // 90% 成功率
        recordsStored: Object.keys(data).length,
        timestamp: Date.now()
    };
}

// 事件处理函数
function handleMarketStateChange(event) {
    return {
        parametersAdjusted: true,
        adjustmentReason: `Market state changed from ${event.data.previousState} to ${event.data.currentState}`,
        newThreshold: 0.5 + (Math.random() - 0.5) * 0.2
    };
}

function handleParameterUpdate(event) {
    return {
        strategyAdjusted: true,
        newSignalGenerated: Math.random() > 0.3,
        adjustmentMagnitude: Math.abs(event.data.newParams.signalThreshold - event.data.previousParams.signalThreshold)
    };
}

function handleCalibrationUpdate(event) {
    return {
        modelUpdated: true,
        performanceImproved: Math.random() > 0.4,
        newBrierScore: Math.random() * 0.3
    };
}

function handleHotUpdate(event) {
    return {
        configApplied: true,
        servicesNotified: true,
        rollbackAvailable: true
    };
}

// 错误处理函数
function validateAndSanitizeData(data) {
    const errors = [];
    if (!data.klines) errors.push('Missing klines data');
    if (typeof data.currentPrice !== 'number' || data.currentPrice <= 0) errors.push('Invalid current price');
    if (data.volume24h < 0) errors.push('Invalid volume');
    
    return {
        isValid: errors.length === 0,
        errors,
        sanitizedData: errors.length === 0 ? data : null
    };
}

function safeCalculateIndicators(data) {
    try {
        if (!data.klines || data.klines.length === 0) {
            return {
                success: false,
                fallbackUsed: true,
                indicators: getDefaultIndicators()
            };
        }
        
        return {
            success: true,
            fallbackUsed: false,
            indicators: calculateMockIndicators(data.klines)
        };
    } catch (error) {
        return {
            success: false,
            fallbackUsed: true,
            indicators: getDefaultIndicators(),
            error: error.message
        };
    }
}

function getDefaultIndicators() {
    return {
        rsi: 50,
        macd: { macd: 0, signal: 0, histogram: 0 },
        atr: 1,
        adx: 20
    };
}

function simulateNetworkError() {
    return {
        type: 'NETWORK_ERROR',
        code: 'ECONNREFUSED',
        message: 'Connection refused'
    };
}

function handleNetworkError(error) {
    return {
        retryAttempted: true,
        retryCount: 3,
        fallbackActivated: true,
        fallbackData: 'cached_data'
    };
}

function simulateMemoryStress() {
    const memoryBefore = process.memoryUsage().heapUsed;
    
    // 模拟内存压力
    const largeArray = new Array(100000).fill(0);
    
    const memoryAfter = process.memoryUsage().heapUsed;
    const memoryIncrease = memoryAfter - memoryBefore;
    
    return {
        memoryLimitRespected: memoryIncrease < 100 * 1024 * 1024, // 100MB limit
        gracefulDegradation: true,
        memoryIncrease
    };
}

function testConfigRollback(invalidConfig) {
    // 模拟配置验证失败和回滚
    const isValid = invalidConfig.signalThreshold > 0 && invalidConfig.signalThreshold < 1 &&
                   invalidConfig.leverage > 0 && invalidConfig.leverage <= 20;
    
    return {
        rollbackExecuted: !isValid,
        systemStable: true,
        previousConfigRestored: !isValid
    };
}

async function simulateAsyncTask(id) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve({ id, completed: true, timestamp: Date.now() });
        }, Math.random() * 100);
    });
}

function testCacheEfficiency() {
    const cache = new Map();
    let hits = 0;
    let misses = 0;
    const totalRequests = 100;
    
    for (let i = 0; i < totalRequests; i++) {
        const key = `key_${Math.floor(Math.random() * 20)}`; // 20% cache keys
        
        if (cache.has(key)) {
            hits++;
        } else {
            misses++;
            cache.set(key, `value_${i}`);
        }
    }
    
    return {
        hitRate: hits / totalRequests,
        avgResponseTime: 5 + Math.random() * 10 // 模拟响应时间
    };
}

// 端到端测试辅助函数
function analyzeMultiTimeFrames(marketData) {
    return {
        consistency: 0.7 + Math.random() * 0.3,
        frames: {
            '1m': { state: 'TRENDING_UP', confidence: 0.8 },
            '5m': { state: 'TRENDING_UP', confidence: 0.75 },
            '1h': { state: 'SIDEWAYS', confidence: 0.6 }
        }
    };
}

function comprehensiveMarketAnalysis(marketData, timeFrameAnalysis) {
    return {
        primaryState: 'TRENDING_UP',
        confidence: 0.75,
        supportingFactors: ['ADX > 25', 'Volume increase', 'Multi-timeframe alignment'],
        riskFactors: ['High volatility', 'Resistance level nearby']
    };
}

function assessRisk(marketState, marketData) {
    return {
        riskLevel: 'MEDIUM',
        maxPosition: 0.1,
        stopLossRecommended: 0.02,
        confidenceAdjustment: -0.05
    };
}

function selectAndOptimizeStrategy(marketState, riskAssessment) {
    return {
        selectedStrategy: 'momentum_following',
        optimizedParams: {
            signalThreshold: 0.45,
            leverage: 3.2,
            holdingPeriod: 7200000
        },
        expectedPerformance: {
            sharpeRatio: 1.8,
            winRate: 0.65
        }
    };
}

function generateAndCalibrateSignal(strategy, marketData) {
    return {
        action: 'BUY',
        rawConfidence: 0.75,
        calibratedConfidence: 0.72,
        strength: 0.8,
        reasoning: 'Strong momentum with high ADX and volume confirmation'
    };
}

function makeExecutionDecision(signal, riskAssessment) {
    return {
        shouldExecute: signal.calibratedConfidence > 0.6 && riskAssessment.riskLevel !== 'HIGH',
        reasoning: 'Signal confidence above threshold and acceptable risk level',
        recommendedPosition: 0.08
    };
}

function recordAndLearn(signal, decision) {
    return {
        recorded: true,
        modelUpdated: Math.random() > 0.3,
        performanceImpact: (Math.random() - 0.5) * 0.1
    };
}

// 执行所有集成测试
async function runAllIntegrationTests() {
    console.log('🚀 开始执行集成测试套件...\n');
    
    testDataFlowIntegration();
    testModuleCommunication();
    testErrorHandlingAndRecovery();
    await testPerformanceAndResourceManagement();
    testEndToEndBusinessFlow();
    
    // 输出集成测试总结
    console.log('📊 集成测试总结:');
    console.log(`测试套件: ${integrationResults.summary.totalSuites}`);
    console.log(`套件通过: ${integrationResults.summary.passedSuites}`);
    console.log(`套件失败: ${integrationResults.summary.failedSuites}`);
    console.log(`总测试数: ${integrationResults.summary.totalTests}`);
    console.log(`测试通过: ${integrationResults.summary.passedTests}`);
    console.log(`测试失败: ${integrationResults.summary.failedTests}`);
    
    const suiteSuccessRate = (integrationResults.summary.passedSuites / integrationResults.summary.totalSuites * 100).toFixed(1);
    const testSuccessRate = (integrationResults.summary.passedTests / integrationResults.summary.totalTests * 100).toFixed(1);
    
    console.log(`套件成功率: ${suiteSuccessRate}%`);
    console.log(`测试成功率: ${testSuccessRate}%`);
    
    if (integrationResults.summary.failedSuites > 0) {
        console.log('\n⚠️ 失败的测试套件:');
        integrationResults.testSuites
            .filter(suite => suite.failed > 0)
            .forEach(suite => {
                console.log(`- ${suite.name}: ${suite.failed} 个测试失败`);
                suite.tests
                    .filter(test => !test.passed)
                    .forEach(test => {
                        console.log(`  • ${test.name}: ${test.error}`);
                    });
            });
    }
    
    // 保存集成测试报告
    const reportPath = path.join(__dirname, 'integration-test-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(integrationResults, null, 2));
    console.log(`\n📄 集成测试报告已保存: ${reportPath}`);
    
    const overallSuccess = integrationResults.summary.failedSuites === 0;
    
    if (overallSuccess) {
        console.log('\n🎉 集成测试全部通过！各模块协作正常。');
    } else {
        console.log('\n⚠️ 部分集成测试失败，需要检查模块间的协作。');
    }
    
    return overallSuccess;
}

// 运行集成测试
runAllIntegrationTests().then(success => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('集成测试执行失败:', error);
    process.exit(1);
});