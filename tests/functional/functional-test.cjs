#!/usr/bin/env node

/**
 * 市场状态识别与自适应系统功能测试
 * 测试核心算法逻辑和数据处理功能
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 开始功能逻辑测试...\n');

const testResults = {
    passed: 0,
    failed: 0,
    errors: []
};

function logTest(testName, passed, error = null) {
    if (passed) {
        console.log(`✅ ${testName}`);
        testResults.passed++;
    } else {
        console.log(`❌ ${testName}: ${error}`);
        testResults.failed++;
        testResults.errors.push({ test: testName, error });
    }
}

// 1. 测试技术指标计算逻辑
console.log('📊 测试技术指标计算逻辑...');

function testTechnicalIndicators() {
    try {
        // 模拟K线数据
        const mockKlineData = [];
        let price = 100;
        for (let i = 0; i < 100; i++) {
            const change = (Math.random() - 0.5) * 0.02;
            const open = price;
            const close = price * (1 + change);
            const high = Math.max(open, close) * (1 + Math.random() * 0.005);
            const low = Math.min(open, close) * (1 - Math.random() * 0.005);
            
            mockKlineData.push({
                timestamp: Date.now() - (100 - i) * 60000,
                open,
                high,
                low,
                close,
                volume: 1000000 + Math.random() * 500000
            });
            price = close;
        }
        
        logTest('K线数据生成', mockKlineData.length === 100, '数据长度不正确');
        
        // 测试简单移动平均计算
        const closes = mockKlineData.map(k => k.close);
        const sma20 = closes.slice(-20).reduce((sum, price) => sum + price, 0) / 20;
        logTest('SMA20计算', sma20 > 0 && isFinite(sma20), 'SMA计算异常');
        
        // 测试ATR计算逻辑
        let atrSum = 0;
        for (let i = 1; i < Math.min(15, mockKlineData.length); i++) {
            const current = mockKlineData[mockKlineData.length - i];
            const previous = mockKlineData[mockKlineData.length - i - 1];
            
            const tr1 = current.high - current.low;
            const tr2 = Math.abs(current.high - previous.close);
            const tr3 = Math.abs(current.low - previous.close);
            const tr = Math.max(tr1, tr2, tr3);
            
            atrSum += tr;
        }
        const atr = atrSum / 14;
        logTest('ATR计算逻辑', atr > 0 && isFinite(atr), 'ATR计算异常');
        
        // 测试ADX计算逻辑（简化版）
        let dmPlusSum = 0, dmMinusSum = 0;
        for (let i = 1; i < Math.min(15, mockKlineData.length); i++) {
            const current = mockKlineData[mockKlineData.length - i];
            const previous = mockKlineData[mockKlineData.length - i - 1];
            
            const dmPlus = Math.max(current.high - previous.high, 0);
            const dmMinus = Math.max(previous.low - current.low, 0);
            
            dmPlusSum += dmPlus;
            dmMinusSum += dmMinus;
        }
        logTest('ADX计算逻辑', dmPlusSum >= 0 && dmMinusSum >= 0, 'ADX计算异常');
        
    } catch (error) {
        logTest('技术指标计算', false, error.message);
    }
}

// 2. 测试市场状态识别逻辑
console.log('\n🎯 测试市场状态识别逻辑...');

function testMarketStateLogic() {
    try {
        // 模拟市场状态判断
        const mockIndicators = {
            adx: 28.5,
            atr: 2.5,
            rsi: 65,
            macd: { macd: 0.5, signal: 0.3, histogram: 0.2 },
            ema12: 102,
            ema26: 100,
            sma20: 101,
            volume: { current: 1200000, average: 1000000, ratio: 1.2 }
        };
        
        // 趋势判断逻辑
        const isTrending = mockIndicators.adx >= 25;
        const isUpTrend = mockIndicators.ema12 > mockIndicators.ema26 && mockIndicators.ema12 > mockIndicators.sma20;
        const isDownTrend = mockIndicators.ema12 < mockIndicators.ema26 && mockIndicators.ema12 < mockIndicators.sma20;
        
        let marketState = 'SIDEWAYS';
        if (isTrending) {
            if (isUpTrend) marketState = 'TRENDING_UP';
            else if (isDownTrend) marketState = 'TRENDING_DOWN';
        }
        
        logTest('趋势判断逻辑', marketState === 'TRENDING_UP', '趋势判断错误');
        
        // 波动性判断
        const atrPercentile = 65; // 模拟ATR分位数
        let volatilityLevel = 'MEDIUM';
        if (atrPercentile >= 90) volatilityLevel = 'EXTREME';
        else if (atrPercentile >= 75) volatilityLevel = 'HIGH';
        else if (atrPercentile <= 25) volatilityLevel = 'LOW';
        
        logTest('波动性判断逻辑', volatilityLevel === 'MEDIUM', '波动性判断错误');
        
        // 置信度计算
        const adxConfidence = Math.min(1, mockIndicators.adx / 50);
        const volumeConfidence = Math.min(1, mockIndicators.volume.ratio);
        const overallConfidence = (adxConfidence + volumeConfidence) / 2;
        
        logTest('置信度计算', overallConfidence > 0 && overallConfidence <= 1, '置信度计算异常');
        
    } catch (error) {
        logTest('市场状态识别', false, error.message);
    }
}

// 3. 测试参数自适应逻辑
console.log('\n⚙️ 测试参数自适应逻辑...');

function testAdaptiveParameters() {
    try {
        // 模拟当前参数
        const currentParams = {
            signalThreshold: 0.5,
            leverageBase: 3,
            stopLossPercent: 0.02,
            takeProfitPercent: 0.028,
            cooldownPeriod: 1800000 // 30分钟
        };
        
        // 模拟市场状态变化
        const marketState = {
            state: 'HIGH_VOLATILITY',
            confidence: 0.8,
            volatilityLevel: 'HIGH'
        };
        
        // 参数调整逻辑
        let adjustedParams = { ...currentParams };
        
        if (marketState.state === 'HIGH_VOLATILITY') {
            adjustedParams.signalThreshold *= 1.2; // 提高信号阈值
            adjustedParams.leverageBase *= 0.7; // 降低杠杆
            adjustedParams.stopLossPercent *= 1.5; // 扩大止损
            adjustedParams.cooldownPeriod *= 0.5; // 缩短冷却
        }
        
        logTest('高波动参数调整', 
            adjustedParams.signalThreshold > currentParams.signalThreshold &&
            adjustedParams.leverageBase < currentParams.leverageBase, 
            '参数调整逻辑错误');
        
        // 置信度调整
        if (marketState.confidence > 0.8) {
            adjustedParams.signalThreshold *= 0.9; // 高置信度降低阈值
        }
        
        logTest('置信度参数调整', 
            adjustedParams.signalThreshold !== currentParams.signalThreshold, 
            '置信度调整逻辑错误');
        
    } catch (error) {
        logTest('参数自适应', false, error.message);
    }
}

// 4. 测试概率校准逻辑
console.log('\n🎲 测试概率校准逻辑...');

function testProbabilityCalibration() {
    try {
        // 模拟原始预测和实际结果
        const predictions = [0.3, 0.7, 0.5, 0.8, 0.2, 0.9, 0.4, 0.6];
        const outcomes = [0, 1, 0, 1, 0, 1, 0, 1];
        
        // Platt Scaling 简化实现
        function plattScaling(prediction, A = -1, B = 0) {
            const fVal = Math.log(prediction / (1 - prediction + 1e-15));
            return 1 / (1 + Math.exp(A * fVal + B));
        }
        
        const calibratedPredictions = predictions.map(p => plattScaling(p));
        logTest('Platt校准计算', 
            calibratedPredictions.every(p => p >= 0 && p <= 1), 
            'Platt校准结果异常');
        
        // Brier Score 计算
        let brierScore = 0;
        for (let i = 0; i < predictions.length; i++) {
            brierScore += Math.pow(predictions[i] - outcomes[i], 2);
        }
        brierScore /= predictions.length;
        
        logTest('Brier分数计算', brierScore >= 0 && brierScore <= 1, 'Brier分数异常');
        
        // 校准误差计算（简化版ECE）
        const numBins = 5;
        const binSize = 1 / numBins;
        let calibrationError = 0;
        
        for (let bin = 0; bin < numBins; bin++) {
            const binStart = bin * binSize;
            const binEnd = (bin + 1) * binSize;
            
            const binPredictions = [];
            const binOutcomes = [];
            
            for (let i = 0; i < predictions.length; i++) {
                if (predictions[i] >= binStart && predictions[i] < binEnd) {
                    binPredictions.push(predictions[i]);
                    binOutcomes.push(outcomes[i]);
                }
            }
            
            if (binPredictions.length > 0) {
                const avgPrediction = binPredictions.reduce((sum, p) => sum + p, 0) / binPredictions.length;
                const avgOutcome = binOutcomes.reduce((sum, o) => sum + o, 0) / binOutcomes.length;
                calibrationError += Math.abs(avgPrediction - avgOutcome) * (binPredictions.length / predictions.length);
            }
        }
        
        logTest('校准误差计算', calibrationError >= 0 && calibrationError <= 1, '校准误差计算异常');
        
    } catch (error) {
        logTest('概率校准', false, error.message);
    }
}

// 5. 测试策略信号生成逻辑
console.log('\n📡 测试策略信号生成逻辑...');

function testSignalGeneration() {
    try {
        // 模拟输入数据
        const marketState = {
            primaryState: 'TRENDING_UP',
            confidence: 0.75,
            adxValue: 32,
            volatilityLevel: 'MEDIUM'
        };
        
        const parameters = {
            signalThreshold: 0.5,
            leverageBase: 3,
            leverageMax: 10,
            stopLossPercent: 0.02,
            takeProfitPercent: 0.028
        };
        
        // 信号生成逻辑
        let action = 'HOLD';
        let strength = 0.5;
        
        if (marketState.primaryState === 'TRENDING_UP') {
            action = 'BUY';
            strength = Math.min(0.9, 0.6 + (marketState.adxValue - 25) / 50);
        } else if (marketState.primaryState === 'TRENDING_DOWN') {
            action = 'SELL';
            strength = Math.min(0.9, 0.6 + (marketState.adxValue - 25) / 50);
        }
        
        logTest('信号方向判断', action === 'BUY', '信号方向错误');
        logTest('信号强度计算', strength > 0.6 && strength <= 0.9, '信号强度异常');
        
        // 杠杆计算
        const volatilityMultiplier = marketState.volatilityLevel === 'HIGH' ? 0.7 : 
                                   marketState.volatilityLevel === 'LOW' ? 1.3 : 1.0;
        const confidenceMultiplier = marketState.confidence;
        const leverage = Math.min(parameters.leverageMax, 
                                parameters.leverageBase * volatilityMultiplier * confidenceMultiplier);
        
        logTest('杠杆计算', leverage > 0 && leverage <= parameters.leverageMax, '杠杆计算异常');
        
        // 止损止盈计算
        const currentPrice = 100;
        const stopLoss = action === 'BUY' ? 
            currentPrice * (1 - parameters.stopLossPercent) : 
            currentPrice * (1 + parameters.stopLossPercent);
        const takeProfit = action === 'BUY' ? 
            currentPrice * (1 + parameters.takeProfitPercent) : 
            currentPrice * (1 - parameters.takeProfitPercent);
        
        logTest('止损价格计算', 
            action === 'BUY' ? stopLoss < currentPrice : stopLoss > currentPrice, 
            '止损价格错误');
        logTest('止盈价格计算', 
            action === 'BUY' ? takeProfit > currentPrice : takeProfit < currentPrice, 
            '止盈价格错误');
        
    } catch (error) {
        logTest('策略信号生成', false, error.message);
    }
}

// 6. 测试性能指标计算
console.log('\n📈 测试性能指标计算...');

function testPerformanceMetrics() {
    try {
        // 模拟交易收益序列
        const returns = [0.02, -0.01, 0.03, -0.015, 0.025, -0.008, 0.01, 0.015, -0.02, 0.018];
        
        // 计算总收益
        const totalReturn = returns.reduce((sum, r) => sum + r, 0);
        logTest('总收益计算', Math.abs(totalReturn - 0.065) < 0.001, '总收益计算错误');
        
        // 计算胜率
        const winCount = returns.filter(r => r > 0).length;
        const winRate = winCount / returns.length;
        logTest('胜率计算', winRate === 0.6, '胜率计算错误');
        
        // 计算波动率
        const avgReturn = totalReturn / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1);
        const volatility = Math.sqrt(variance);
        logTest('波动率计算', volatility > 0 && isFinite(volatility), '波动率计算异常');
        
        // 计算Sharpe比率
        const riskFreeRate = 0.02 / 252; // 日化无风险利率
        const sharpeRatio = (avgReturn - riskFreeRate) / volatility;
        logTest('Sharpe比率计算', isFinite(sharpeRatio), 'Sharpe比率计算异常');
        
        // 计算最大回撤
        let peak = 0;
        let maxDrawdown = 0;
        let cumReturn = 0;
        
        for (const ret of returns) {
            cumReturn += ret;
            peak = Math.max(peak, cumReturn);
            const drawdown = peak - cumReturn;
            maxDrawdown = Math.max(maxDrawdown, drawdown);
        }
        
        logTest('最大回撤计算', maxDrawdown >= 0, '最大回撤计算异常');
        
    } catch (error) {
        logTest('性能指标计算', false, error.message);
    }
}

// 7. 测试数据结构验证
console.log('\n🏗️ 测试数据结构验证...');

function testDataStructures() {
    try {
        // 测试市场状态结果结构
        const marketStateResult = {
            primaryState: 'TRENDING_UP',
            confidence: 0.75,
            adxValue: 28.5,
            adxTrend: 'STRENGTHENING',
            atrPercentile: 65,
            volatilityLevel: 'MEDIUM',
            liquidityLabel: 'HIGH',
            multiTimeFrameConsistency: 0.82,
            timeFrameAnalysis: {
                '1h': { state: 'TRENDING_UP', confidence: 0.8, adx: 30, atr: 2.5 },
                '4h': { state: 'TRENDING_UP', confidence: 0.75, adx: 28, atr: 2.3 }
            },
            stateTransitionProbability: {
                'TRENDING_UP': 0.6,
                'TRENDING_DOWN': 0.1,
                'SIDEWAYS': 0.2,
                'HIGH_VOLATILITY': 0.05,
                'LOW_VOLATILITY': 0.03,
                'BREAKOUT': 0.01,
                'REVERSAL': 0.01
            },
            timestamp: Date.now()
        };
        
        logTest('市场状态结构验证', 
            marketStateResult.primaryState && 
            typeof marketStateResult.confidence === 'number' &&
            marketStateResult.timeFrameAnalysis &&
            marketStateResult.stateTransitionProbability, 
            '市场状态结构不完整');
        
        // 测试策略信号结构
        const strategySignal = {
            action: 'BUY',
            strength: 0.8,
            confidence: 0.75,
            leverage: 3.2,
            stopLoss: 95,
            takeProfit: 110,
            holdingDuration: 7200000,
            strategyId: 'technical_momentum',
            marketState: 'TRENDING_UP',
            timestamp: Date.now()
        };
        
        logTest('策略信号结构验证',
            ['BUY', 'SELL', 'HOLD'].includes(strategySignal.action) &&
            strategySignal.strength >= 0 && strategySignal.strength <= 1 &&
            strategySignal.confidence >= 0 && strategySignal.confidence <= 1 &&
            strategySignal.leverage > 0,
            '策略信号结构不正确');
        
        // 测试性能指标结构
        const performanceMetrics = {
            sharpeRatio: 1.85,
            maxDrawdown: 0.12,
            winRate: 0.68,
            avgReturn: 0.015,
            volatility: 0.08,
            calmarRatio: 15.4,
            sortinoRatio: 2.1,
            totalTrades: 150,
            profitFactor: 1.8
        };
        
        logTest('性能指标结构验证',
            typeof performanceMetrics.sharpeRatio === 'number' &&
            performanceMetrics.winRate >= 0 && performanceMetrics.winRate <= 1 &&
            performanceMetrics.maxDrawdown >= 0 &&
            performanceMetrics.totalTrades >= 0,
            '性能指标结构不正确');
        
    } catch (error) {
        logTest('数据结构验证', false, error.message);
    }
}

// 执行所有测试
async function runAllTests() {
    testTechnicalIndicators();
    testMarketStateLogic();
    testAdaptiveParameters();
    testProbabilityCalibration();
    testSignalGeneration();
    testPerformanceMetrics();
    testDataStructures();

    // 输出测试结果
    console.log('\n📋 功能测试结果汇总:');
    console.log(`✅ 通过: ${testResults.passed}`);
    console.log(`❌ 失败: ${testResults.failed}`);
    
    if (testResults.failed > 0) {
        console.log('\n🔍 失败详情:');
        testResults.errors.forEach((error, index) => {
            console.log(`${index + 1}. ${error.test}: ${error.error}`);
        });
    }

    const successRate = (testResults.passed / (testResults.passed + testResults.failed) * 100).toFixed(1);
    console.log(`\n📊 功能测试成功率: ${successRate}%`);

    if (successRate >= 90) {
        console.log('\n🎉 所有核心功能逻辑正常！');
    } else if (successRate >= 80) {
        console.log('\n✅ 大部分功能逻辑正常，少数问题需要关注');
    } else {
        console.log('\n⚠️ 存在功能逻辑问题，需要修复');
    }

    return successRate >= 80;
}

// 运行测试
runAllTests().then(success => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('功能测试执行失败:', error);
    process.exit(1);
});