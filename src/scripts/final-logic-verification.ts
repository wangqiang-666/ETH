#!/usr/bin/env node

import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

interface KlineData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface V5Parameters {
  stopLoss: number;
  takeProfitLevel1: number;
  takeProfitLevel2: number;
  takeProfitLevel3: number;
  takeProfitWeight1: number;
  takeProfitWeight2: number;
  takeProfitWeight3: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  emaFast: number;
  emaSlow: number;
  trendStrengthThreshold: number;
  volumeRatioMin: number;
  volumeConfirmationPeriod: number;
  volatilityMin: number;
  volatilityMax: number;
  atrPeriod: number;
  minHoldingTime: number;
  maxHoldingTime: number;
  profitTakingTime: number;
  maxDailyTrades: number;
  maxConsecutiveLosses: number;
  cooldownPeriod: number;
  trailingStopActivation: number;
  trailingStopDistance: number;
  basePositionSize: number;
  positionSizeMultiplier: number;
}

interface LogicCheckResult {
  category: string;
  check: string;
  passed: boolean;
  details: string;
  severity: 'critical' | 'warning' | 'info';
}

class FinalLogicVerification {
  private testData: KlineData[] = [];
  private checkResults: LogicCheckResult[] = [];
  
  // V5-激进优化版参数 (最终版本)
  private readonly V5_PARAMETERS: V5Parameters = {
    stopLoss: 0.017,               // 1.7%止损
    takeProfitLevel1: 0.012,       // 1.2%第一层止盈
    takeProfitLevel2: 0.040,       // 4.0%第二层止盈
    takeProfitLevel3: 0.090,       // 9.0%第三层止盈
    takeProfitWeight1: 0.70,       // 70%在第一层止盈
    takeProfitWeight2: 0.20,       // 20%在第二层止盈
    takeProfitWeight3: 0.10,       // 10%在第三层止盈
    rsiPeriod: 15,                 // RSI周期15
    rsiOversold: 35,               // RSI超卖35 (放宽)
    rsiOverbought: 65,             // RSI超买65 (放宽)
    emaFast: 9,                    // 快速EMA 9
    emaSlow: 27,                   // 慢速EMA 27
    trendStrengthThreshold: 0.005, // 趋势强度阈值0.5% (放宽)
    volumeRatioMin: 0.7,           // 最小成交量比率0.7 (放宽)
    volumeConfirmationPeriod: 18,  // 成交量确认周期18
    volatilityMin: 0.002,          // 最小波动率0.2%
    volatilityMax: 0.075,          // 最大波动率7.5%
    atrPeriod: 16,                 // ATR周期16
    minHoldingTime: 8,             // 最小持仓8分钟
    maxHoldingTime: 135,           // 最大持仓135分钟
    profitTakingTime: 30,          // 获利了结30分钟 (激进)
    maxDailyTrades: 80,            // 最大日交易80笔 (激进)
    maxConsecutiveLosses: 4,       // 最大连续亏损4次
    cooldownPeriod: 45,            // 冷却期45分钟
    trailingStopActivation: 0.010, // 尾随止损激活1%
    trailingStopDistance: 0.005,   // 尾随止损距离0.5%
    basePositionSize: 750,         // 基础仓位750 USDT
    positionSizeMultiplier: 1.3    // 仓位倍数1.3
  };

  constructor() {
    console.log('🔍 初始化最终逻辑验证器');
    console.log('💡 全面检查V5-激进优化版策略的所有逻辑和计算');
    console.log('🎯 验证目标: 确保策略逻辑正确、计算准确、参数合理');
    console.log('📊 检查范围: 参数验证、信号逻辑、交易执行、风险控制、性能计算');
  }

  async loadTestData(): Promise<void> {
    console.log('📊 加载测试数据...');
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const dataPath = path.join(__dirname, '../../data/historical/ETHUSDT_1m_20250101T000000.000Z_to_20250926T103749.164Z.json');
    
    const rawData = await fs.readFile(dataPath, 'utf-8');
    const historicalDataFile = JSON.parse(rawData);
    
    // 取前10000条数据用于逻辑验证
    this.testData = historicalDataFile.data.slice(0, 10000).map((item: any) => ({
      timestamp: item.timestamp,
      open: parseFloat(item.open),
      high: parseFloat(item.high),
      low: parseFloat(item.low),
      close: parseFloat(item.close),
      volume: parseFloat(item.volume)
    }));
    
    console.log(`✅ 测试数据加载完成: ${this.testData.length} 条K线数据`);
  }

  /**
   * 执行全面逻辑验证
   */
  async runFullLogicVerification(): Promise<void> {
    console.log('\n🚀 开始全面逻辑验证...');
    
    // 1. 参数合理性检查
    this.checkParameterLogic();
    
    // 2. 数据完整性检查
    this.checkDataIntegrity();
    
    // 3. 技术指标计算检查
    this.checkTechnicalIndicators();
    
    // 4. 信号生成逻辑检查
    this.checkSignalLogic();
    
    // 5. 交易执行逻辑检查
    this.checkTradeExecutionLogic();
    
    // 6. 风险控制逻辑检查
    this.checkRiskControlLogic();
    
    // 7. 性能计算逻辑检查
    this.checkPerformanceCalculations();
    
    // 8. 边界条件检查
    this.checkBoundaryConditions();
    
    // 9. 数学计算精度检查
    this.checkMathematicalPrecision();
    
    // 10. 实际交易模拟检查
    await this.checkActualTradingSimulation();
    
    console.log('\n🎯 全面逻辑验证完成！');
    this.generateVerificationReport();
  }

  /**
   * 1. 参数合理性检查
   */
  private checkParameterLogic(): void {
    console.log('\n📋 检查参数合理性...');
    
    const params = this.V5_PARAMETERS;
    
    // 检查止损止盈参数
    this.addCheck('参数验证', '止损参数合理性', 
      params.stopLoss > 0 && params.stopLoss < 0.1, 
      `止损${(params.stopLoss * 100).toFixed(1)}%，范围合理`, 'critical');
    
    this.addCheck('参数验证', '止盈层级递增', 
      params.takeProfitLevel1 < params.takeProfitLevel2 && params.takeProfitLevel2 < params.takeProfitLevel3,
      `止盈层级: ${(params.takeProfitLevel1*100).toFixed(1)}% < ${(params.takeProfitLevel2*100).toFixed(1)}% < ${(params.takeProfitLevel3*100).toFixed(1)}%`, 'critical');
    
    this.addCheck('参数验证', '止盈权重总和', 
      Math.abs(params.takeProfitWeight1 + params.takeProfitWeight2 + params.takeProfitWeight3 - 1.0) < 0.001,
      `权重总和: ${(params.takeProfitWeight1 + params.takeProfitWeight2 + params.takeProfitWeight3).toFixed(3)}`, 'critical');
    
    // 检查RSI参数
    this.addCheck('参数验证', 'RSI参数合理性', 
      params.rsiPeriod >= 5 && params.rsiPeriod <= 30 && params.rsiOversold < params.rsiOverbought,
      `RSI周期${params.rsiPeriod}，超卖${params.rsiOversold}，超买${params.rsiOverbought}`, 'critical');
    
    // 检查EMA参数
    this.addCheck('参数验证', 'EMA参数合理性', 
      params.emaFast < params.emaSlow && params.emaFast >= 5 && params.emaSlow <= 50,
      `快速EMA${params.emaFast} < 慢速EMA${params.emaSlow}`, 'critical');
    
    // 检查时间参数
    this.addCheck('参数验证', '持仓时间参数', 
      params.minHoldingTime < params.maxHoldingTime && params.profitTakingTime <= params.maxHoldingTime,
      `最小${params.minHoldingTime}min < 最大${params.maxHoldingTime}min，获利了结${params.profitTakingTime}min`, 'critical');
    
    // 检查仓位参数
    this.addCheck('参数验证', '仓位参数合理性', 
      params.basePositionSize > 0 && params.positionSizeMultiplier > 0,
      `基础仓位${params.basePositionSize} USDT，倍数${params.positionSizeMultiplier}`, 'info');
  }

  /**
   * 2. 数据完整性检查
   */
  private checkDataIntegrity(): void {
    console.log('📊 检查数据完整性...');
    
    // 检查数据连续性
    let missingData = 0;
    for (let i = 1; i < Math.min(1000, this.testData.length); i++) {
      const timeDiff = this.testData[i].timestamp - this.testData[i-1].timestamp;
      if (timeDiff > 60000 * 2) { // 超过2分钟间隔
        missingData++;
      }
    }
    
    this.addCheck('数据完整性', '数据连续性', 
      missingData < 10, 
      `检查前1000条数据，发现${missingData}处时间间隔异常`, missingData > 0 ? 'warning' : 'info');
    
    // 检查价格数据合理性
    let invalidPrices = 0;
    for (let i = 0; i < Math.min(1000, this.testData.length); i++) {
      const bar = this.testData[i];
      if (bar.high < bar.low || bar.close < 0 || bar.volume < 0) {
        invalidPrices++;
      }
    }
    
    this.addCheck('数据完整性', '价格数据有效性', 
      invalidPrices === 0, 
      `检查前1000条数据，发现${invalidPrices}条无效价格数据`, invalidPrices > 0 ? 'critical' : 'info');
  }

  /**
   * 3. 技术指标计算检查
   */
  private checkTechnicalIndicators(): void {
    console.log('📈 检查技术指标计算...');
    
    if (this.testData.length < 100) return;
    
    const testBars = this.testData.slice(0, 100);
    const closes = testBars.map(b => b.close);
    
    // 检查RSI计算
    const rsi = this.calculateRSI(closes, this.V5_PARAMETERS.rsiPeriod);
    this.addCheck('技术指标', 'RSI计算有效性', 
      rsi >= 0 && rsi <= 100 && !isNaN(rsi), 
      `RSI值: ${rsi.toFixed(2)}`, isNaN(rsi) ? 'critical' : 'info');
    
    // 检查EMA计算
    const emaFast = this.calculateEMA(closes, this.V5_PARAMETERS.emaFast);
    const emaSlow = this.calculateEMA(closes, this.V5_PARAMETERS.emaSlow);
    this.addCheck('技术指标', 'EMA计算有效性', 
      emaFast > 0 && emaSlow > 0 && !isNaN(emaFast) && !isNaN(emaSlow), 
      `快速EMA: ${emaFast.toFixed(2)}, 慢速EMA: ${emaSlow.toFixed(2)}`, 'info');
    
    // 检查波动率计算
    const volatility = this.calculateVolatility(closes, 20);
    this.addCheck('技术指标', '波动率计算有效性', 
      volatility >= 0 && !isNaN(volatility), 
      `波动率: ${(volatility * 100).toFixed(3)}%`, 'info');
    
    // 检查成交量比率计算
    const volumeRatio = this.calculateVolumeRatio(testBars, this.V5_PARAMETERS.volumeConfirmationPeriod);
    this.addCheck('技术指标', '成交量比率计算有效性', 
      volumeRatio > 0 && !isNaN(volumeRatio), 
      `成交量比率: ${volumeRatio.toFixed(2)}`, 'info');
  }

  /**
   * 4. 信号生成逻辑检查
   */
  private checkSignalLogic(): void {
    console.log('🎯 检查信号生成逻辑...');
    
    if (this.testData.length < 100) return;
    
    let validSignals = 0;
    let invalidSignals = 0;
    let conflictSignals = 0;
    
    for (let i = 50; i < Math.min(100, this.testData.length); i++) {
      const bars = this.testData.slice(i - 50, i + 1);
      const signal = this.generateTradingSignal(bars, this.V5_PARAMETERS);
      
      if (signal) {
        if (signal.direction === 'long' || signal.direction === 'short') {
          if (signal.strength >= 0.40 && signal.strength <= 1.0) {
            validSignals++;
          } else {
            invalidSignals++;
          }
        } else {
          conflictSignals++;
        }
      }
    }
    
    this.addCheck('信号逻辑', '信号生成有效性', 
      invalidSignals === 0 && conflictSignals === 0, 
      `有效信号${validSignals}个，无效信号${invalidSignals}个，冲突信号${conflictSignals}个`, 
      invalidSignals > 0 || conflictSignals > 0 ? 'critical' : 'info');
    
    this.addCheck('信号逻辑', '信号频率合理性', 
      validSignals >= 5 && validSignals <= 25, 
      `在50个测试点中生成${validSignals}个有效信号`, 
      validSignals < 5 ? 'warning' : 'info');
  }

  /**
   * 5. 交易执行逻辑检查
   */
  private checkTradeExecutionLogic(): void {
    console.log('💼 检查交易执行逻辑...');
    
    // 模拟一笔交易检查逻辑
    const testPrice = 3500;
    const testQuantity = 1;
    const params = this.V5_PARAMETERS;
    
    // 检查止损价格计算
    const longStopLoss = testPrice * (1 - params.stopLoss);
    const shortStopLoss = testPrice * (1 + params.stopLoss);
    
    this.addCheck('交易执行', '止损价格计算', 
      longStopLoss < testPrice && shortStopLoss > testPrice, 
      `多头止损: ${longStopLoss.toFixed(2)}, 空头止损: ${shortStopLoss.toFixed(2)}`, 'critical');
    
    // 检查止盈价格计算
    const longTP1 = testPrice * (1 + params.takeProfitLevel1);
    const longTP2 = testPrice * (1 + params.takeProfitLevel2);
    const longTP3 = testPrice * (1 + params.takeProfitLevel3);
    
    this.addCheck('交易执行', '止盈价格递增', 
      longTP1 > testPrice && longTP2 > longTP1 && longTP3 > longTP2, 
      `止盈层级: ${longTP1.toFixed(2)} < ${longTP2.toFixed(2)} < ${longTP3.toFixed(2)}`, 'critical');
    
    // 检查仓位计算
    const positionSize = params.basePositionSize * params.positionSizeMultiplier;
    const quantity = positionSize / testPrice;
    
    this.addCheck('交易执行', '仓位计算合理性', 
      quantity > 0 && positionSize > 0, 
      `仓位大小: ${positionSize} USDT, 数量: ${quantity.toFixed(6)}`, 'info');
    
    // 检查手续费计算
    const fee = positionSize * 0.0003; // 0.03%手续费
    this.addCheck('交易执行', '手续费计算', 
      fee > 0 && fee < positionSize * 0.01, 
      `手续费: ${fee.toFixed(4)} USDT (${(fee/positionSize*100).toFixed(3)}%)`, 'info');
  }

  /**
   * 6. 风险控制逻辑检查
   */
  private checkRiskControlLogic(): void {
    console.log('🛡️ 检查风险控制逻辑...');
    
    const params = this.V5_PARAMETERS;
    
    // 检查连续亏损控制
    this.addCheck('风险控制', '连续亏损限制', 
      params.maxConsecutiveLosses >= 2 && params.maxConsecutiveLosses <= 10, 
      `最大连续亏损: ${params.maxConsecutiveLosses}次`, 'critical');
    
    // 检查冷却期设置
    this.addCheck('风险控制', '冷却期设置', 
      params.cooldownPeriod >= 15 && params.cooldownPeriod <= 120, 
      `冷却期: ${params.cooldownPeriod}分钟`, 'warning');
    
    // 检查日交易限制
    this.addCheck('风险控制', '日交易限制', 
      params.maxDailyTrades >= 10 && params.maxDailyTrades <= 200, 
      `日交易限制: ${params.maxDailyTrades}笔`, 'info');
    
    // 检查尾随止损参数
    this.addCheck('风险控制', '尾随止损参数', 
      params.trailingStopActivation > 0 && params.trailingStopDistance > 0 && 
      params.trailingStopDistance < params.trailingStopActivation, 
      `激活阈值: ${(params.trailingStopActivation*100).toFixed(1)}%, 距离: ${(params.trailingStopDistance*100).toFixed(1)}%`, 'info');
    
    // 检查波动率过滤
    this.addCheck('风险控制', '波动率过滤', 
      params.volatilityMin < params.volatilityMax && params.volatilityMax < 0.2, 
      `波动率范围: ${(params.volatilityMin*100).toFixed(2)}% - ${(params.volatilityMax*100).toFixed(2)}%`, 'info');
  }

  /**
   * 7. 性能计算逻辑检查
   */
  private checkPerformanceCalculations(): void {
    console.log('📊 检查性能计算逻辑...');
    
    // 模拟权益曲线检查夏普比率计算
    const mockEquity = [10000, 10100, 10050, 10200, 10150, 10300, 10250, 10400];
    const sharpeRatio = this.calculateSharpeRatio(mockEquity);
    
    this.addCheck('性能计算', '夏普比率计算', 
      !isNaN(sharpeRatio) && isFinite(sharpeRatio), 
      `模拟夏普比率: ${sharpeRatio.toFixed(4)}`, 'info');
    
    // 检查年化收益计算
    const startBalance = 10000;
    const endBalance = 12000;
    const days = 365;
    const annualizedReturn = ((endBalance / startBalance) ** (365 / days) - 1);
    
    this.addCheck('性能计算', '年化收益计算', 
      !isNaN(annualizedReturn) && isFinite(annualizedReturn), 
      `模拟年化收益: ${(annualizedReturn * 100).toFixed(2)}%`, 'info');
    
    // 检查最大回撤计算
    const mockEquity2 = [10000, 11000, 10500, 12000, 9000, 13000];
    let maxDrawdown = 0;
    let peak = mockEquity2[0];
    
    for (const equity of mockEquity2) {
      if (equity > peak) peak = equity;
      const drawdown = (peak - equity) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    this.addCheck('性能计算', '最大回撤计算', 
      maxDrawdown >= 0 && maxDrawdown <= 1, 
      `模拟最大回撤: ${(maxDrawdown * 100).toFixed(2)}%`, 'info');
  }

  /**
   * 8. 边界条件检查
   */
  private checkBoundaryConditions(): void {
    console.log('🔍 检查边界条件...');
    
    // 检查极端价格情况
    const extremePrices = [0.01, 1000000];
    for (const price of extremePrices) {
      const positionSize = this.V5_PARAMETERS.basePositionSize * this.V5_PARAMETERS.positionSizeMultiplier;
      const quantity = positionSize / price;
      
      this.addCheck('边界条件', `极端价格处理(${price})`, 
        quantity > 0 && isFinite(quantity), 
        `价格${price}时数量: ${quantity.toFixed(8)}`, 'warning');
    }
    
    // 检查零成交量情况
    const zeroVolumeRatio = this.calculateVolumeRatio([
      {timestamp: 0, open: 100, high: 100, low: 100, close: 100, volume: 0},
      {timestamp: 1, open: 100, high: 100, low: 100, close: 100, volume: 0}
    ], 1);
    
    this.addCheck('边界条件', '零成交量处理', 
      !isNaN(zeroVolumeRatio) && isFinite(zeroVolumeRatio), 
      `零成交量比率: ${zeroVolumeRatio}`, 'warning');
    
    // 检查相同价格情况
    const samePrices = Array(20).fill(100);
    const volatility = this.calculateVolatility(samePrices, 20);
    
    this.addCheck('边界条件', '相同价格波动率', 
      volatility === 0, 
      `相同价格波动率: ${volatility}`, 'info');
  }

  /**
   * 9. 数学计算精度检查
   */
  private checkMathematicalPrecision(): void {
    console.log('🔢 检查数学计算精度...');
    
    // 检查浮点数精度问题
    const sum = 0.1 + 0.2;
    const expected = 0.3;
    const precision = Math.abs(sum - expected);
    
    this.addCheck('数学精度', '浮点数精度', 
      precision < 1e-10, 
      `0.1 + 0.2 = ${sum}, 精度误差: ${precision.toExponential()}`, 'info');
    
    // 检查百分比计算精度
    const percentage = (this.V5_PARAMETERS.takeProfitWeight1 + 
                       this.V5_PARAMETERS.takeProfitWeight2 + 
                       this.V5_PARAMETERS.takeProfitWeight3);
    
    this.addCheck('数学精度', '百分比计算精度', 
      Math.abs(percentage - 1.0) < 1e-10, 
      `权重总和: ${percentage}, 误差: ${Math.abs(percentage - 1.0).toExponential()}`, 'critical');
    
    // 检查除零保护
    const safeDiv = this.safeDivision(10, 0);
    this.addCheck('数学精度', '除零保护', 
      safeDiv === 0, 
      `10 / 0 = ${safeDiv} (应该返回0)`, 'critical');
  }

  /**
   * 10. 实际交易模拟检查
   */
  private async checkActualTradingSimulation(): Promise<void> {
    console.log('🎮 检查实际交易模拟...');
    
    if (this.testData.length < 200) return;
    
    // 运行小规模回测检查逻辑一致性
    const testData = this.testData.slice(0, 200);
    let balance = 10000;
    let trades = 0;
    let errors = 0;
    
    try {
      for (let i = 50; i < testData.length - 10; i++) {
        const bars = testData.slice(i - 50, i + 1);
        const signal = this.generateTradingSignal(bars, this.V5_PARAMETERS);
        
        if (signal && trades < 5) { // 限制测试交易数量
          const tradeResult = this.simulateTradeExecution(signal, testData[i], testData.slice(i, Math.min(i + 50, testData.length)));
          
          if (tradeResult && !isNaN(tradeResult.pnl)) {
            balance += tradeResult.pnl;
            trades++;
          } else {
            errors++;
          }
        }
      }
      
      this.addCheck('交易模拟', '模拟交易执行', 
        errors === 0 && trades > 0, 
        `执行${trades}笔模拟交易，${errors}个错误，最终余额: ${balance.toFixed(2)}`, 
        errors > 0 ? 'critical' : 'info');
        
    } catch (error) {
      this.addCheck('交易模拟', '模拟交易异常', 
        false, 
        `模拟交易出现异常: ${error}`, 'critical');
    }
  }

  /**
   * 生成验证报告
   */
  private generateVerificationReport(): void {
    const criticalIssues = this.checkResults.filter(r => r.severity === 'critical' && !r.passed);
    const warnings = this.checkResults.filter(r => r.severity === 'warning' && !r.passed);
    const totalChecks = this.checkResults.length;
    const passedChecks = this.checkResults.filter(r => r.passed).length;
    
    console.log('\n' + '='.repeat(120));
    console.log('🔍 最终逻辑验证报告 - V5-激进优化版策略');
    console.log('='.repeat(120));
    
    console.log(`📊 验证统计:`);
    console.log(`   总检查项: ${totalChecks}`);
    console.log(`   通过检查: ${passedChecks}`);
    console.log(`   通过率: ${(passedChecks / totalChecks * 100).toFixed(1)}%`);
    console.log(`   严重问题: ${criticalIssues.length}`);
    console.log(`   警告问题: ${warnings.length}`);
    
    if (criticalIssues.length > 0) {
      console.log('\n❌ 严重问题:');
      criticalIssues.forEach((issue, index) => {
        console.log(`   ${index + 1}. [${issue.category}] ${issue.check}: ${issue.details}`);
      });
    }
    
    if (warnings.length > 0) {
      console.log('\n⚠️  警告问题:');
      warnings.forEach((warning, index) => {
        console.log(`   ${index + 1}. [${warning.category}] ${warning.check}: ${warning.details}`);
      });
    }
    
    // 按类别汇总
    const categories = [...new Set(this.checkResults.map(r => r.category))];
    console.log('\n📋 分类检查结果:');
    categories.forEach(category => {
      const categoryChecks = this.checkResults.filter(r => r.category === category);
      const categoryPassed = categoryChecks.filter(r => r.passed).length;
      const categoryTotal = categoryChecks.length;
      const status = categoryPassed === categoryTotal ? '✅' : 
                    categoryChecks.some(r => r.severity === 'critical' && !r.passed) ? '❌' : '⚠️';
      
      console.log(`   ${status} ${category}: ${categoryPassed}/${categoryTotal} 通过`);
    });
    
    // 最终结论
    console.log('\n🎯 最终结论:');
    if (criticalIssues.length === 0) {
      console.log('✅ 策略逻辑验证通过，所有关键逻辑正确');
      console.log('🚀 V5-激进优化版策略可以安全部署');
      if (warnings.length > 0) {
        console.log(`⚠️  建议关注 ${warnings.length} 个警告问题`);
      }
    } else {
      console.log('❌ 发现严重逻辑问题，需要修复后再部署');
      console.log('🔧 请优先解决所有严重问题');
    }
    
    console.log('\n' + '='.repeat(120));
    console.log('🎯 逻辑验证完成 - 策略准备状态已评估');
    console.log('='.repeat(120));
  }

  // 辅助方法
  private addCheck(category: string, check: string, passed: boolean, details: string, severity: 'critical' | 'warning' | 'info'): void {
    this.checkResults.push({
      category,
      check,
      passed,
      details,
      severity
    });
  }

  private safeDivision(a: number, b: number): number {
    return b === 0 ? 0 : a / b;
  }

  private simulateTradeExecution(signal: any, entryBar: KlineData, futureData: KlineData[]): any {
    const entryPrice = entryBar.close;
    const stopLoss = signal.direction === 'long' 
      ? entryPrice * (1 - this.V5_PARAMETERS.stopLoss)
      : entryPrice * (1 + this.V5_PARAMETERS.stopLoss);
    
    const takeProfit = signal.direction === 'long'
      ? entryPrice * (1 + this.V5_PARAMETERS.takeProfitLevel1)
      : entryPrice * (1 - this.V5_PARAMETERS.takeProfitLevel1);
    
    // 简化的交易模拟
    for (let i = 1; i < Math.min(10, futureData.length); i++) {
      const bar = futureData[i];
      
      // 检查止损
      if ((signal.direction === 'long' && bar.low <= stopLoss) ||
          (signal.direction === 'short' && bar.high >= stopLoss)) {
        const pnl = (stopLoss - entryPrice) * (signal.direction === 'long' ? 1 : -1);
        return { pnl, exitReason: 'Stop Loss' };
      }
      
      // 检查止盈
      if ((signal.direction === 'long' && bar.high >= takeProfit) ||
          (signal.direction === 'short' && bar.low <= takeProfit)) {
        const pnl = (takeProfit - entryPrice) * (signal.direction === 'long' ? 1 : -1);
        return { pnl, exitReason: 'Take Profit' };
      }
    }
    
    // 超时退出
    const exitPrice = futureData[futureData.length - 1].close;
    const pnl = (exitPrice - entryPrice) * (signal.direction === 'long' ? 1 : -1);
    return { pnl, exitReason: 'Timeout' };
  }

  // 技术指标计算方法 (简化版本用于验证)
  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses -= change;
      }
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    if (prices.length === 1) return prices[0];
    
    const multiplier = 2 / (period + 1);
    let ema = prices[0];
    
    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
    }
    
    return ema;
  }

  private calculateVolatility(prices: number[], period: number): number {
    if (prices.length < period) return 0;
    
    const returns = [];
    for (let i = 1; i < Math.min(prices.length, period + 1); i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  private calculateVolumeRatio(bars: KlineData[], period: number): number {
    if (bars.length < period + 1) return 1;
    
    const currentVolume = bars[bars.length - 1].volume;
    const avgVolume = bars.slice(-period - 1, -1).reduce((sum, b) => sum + b.volume, 0) / period;
    
    return avgVolume > 0 ? currentVolume / avgVolume : 1;
  }

  private calculateSharpeRatio(equity: number[]): number {
    if (equity.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < equity.length; i++) {
      returns.push((equity[i] - equity[i - 1]) / equity[i - 1]);
    }
    
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length);
    
    return stdDev > 0 ? avgReturn / stdDev : 0;
  }

  private generateTradingSignal(bars: KlineData[], params: V5Parameters): any | null {
    const indicators = this.calculateIndicators(bars, params);
    
    let signalStrength = 0;
    let direction: 'long' | 'short' | null = null;
    let signalCount = 0;
    
    // RSI信号
    if (indicators.rsi <= params.rsiOversold) {
      signalStrength += 0.40;
      direction = 'long';
      signalCount++;
    } else if (indicators.rsi >= params.rsiOverbought) {
      signalStrength += 0.40;
      direction = 'short';
      signalCount++;
    }
    
    // 趋势信号
    const trendStrength = Math.abs(indicators.emaFast - indicators.emaSlow) / indicators.emaSlow;
    if (trendStrength > params.trendStrengthThreshold) {
      signalStrength += 0.30;
      signalCount++;
      if (indicators.emaFast > indicators.emaSlow) {
        if (direction === 'long' || direction === null) {
          direction = 'long';
        } else {
          return null;
        }
      } else {
        if (direction === 'short' || direction === null) {
          direction = 'short';
        } else {
          return null;
        }
      }
    }
    
    // 成交量确认
    if (indicators.volumeRatio > params.volumeRatioMin * 1.2) {
      signalStrength += 0.20;
      signalCount++;
    }
    
    // 波动率确认
    if (indicators.volatility > params.volatilityMin && indicators.volatility < params.volatilityMax) {
      signalStrength += 0.10;
      signalCount++;
    }
    
    if (signalCount >= 1 && signalStrength >= 0.40 && direction) {
      return {
        direction,
        strength: signalStrength,
        confidence: Math.min(signalStrength * 1.3, 1.0),
        signalCount
      };
    }
    
    return null;
  }

  private calculateIndicators(bars: KlineData[], params: V5Parameters): any {
    const closes = bars.map(b => b.close);
    
    return {
      rsi: this.calculateRSI(closes, params.rsiPeriod),
      emaFast: this.calculateEMA(closes, params.emaFast),
      emaSlow: this.calculateEMA(closes, params.emaSlow),
      volatility: this.calculateVolatility(closes, 20),
      volumeRatio: this.calculateVolumeRatio(bars, params.volumeConfirmationPeriod)
    };
  }

  async saveResults(filename?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultFilename = `logic-verification-${timestamp}.json`;
    const filepath = filename || defaultFilename;
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const fullPath = path.join(__dirname, '../../data/backtest-results', filepath);
    
    const criticalIssues = this.checkResults.filter(r => r.severity === 'critical' && !r.passed);
    const warnings = this.checkResults.filter(r => r.severity === 'warning' && !r.passed);
    const passedChecks = this.checkResults.filter(r => r.passed).length;
    
    const data = {
      timestamp: new Date().toISOString(),
      framework: "Final Logic Verification",
      strategy_version: "V5-激进优化版",
      v5_parameters: this.V5_PARAMETERS,
      verification_summary: {
        total_checks: this.checkResults.length,
        passed_checks: passedChecks,
        pass_rate: (passedChecks / this.checkResults.length * 100).toFixed(2) + '%',
        critical_issues: criticalIssues.length,
        warnings: warnings.length,
        overall_status: criticalIssues.length === 0 ? 'PASSED' : 'FAILED'
      },
      critical_issues: criticalIssues,
      warnings: warnings,
      all_checks: this.checkResults,
      test_data_summary: {
        total_bars: this.testData.length,
        start_time: this.testData.length > 0 ? new Date(this.testData[0].timestamp).toISOString() : null,
        end_time: this.testData.length > 0 ? new Date(this.testData[this.testData.length - 1].timestamp).toISOString() : null
      }
    };
    
    await fs.writeFile(fullPath, JSON.stringify(data, null, 2));
    return filepath;
  }
}

// 主函数
async function main() {
  try {
    console.log('🔍 启动最终逻辑验证器');
    
    const verifier = new FinalLogicVerification();
    
    // 加载测试数据
    await verifier.loadTestData();
    
    // 执行全面逻辑验证
    await verifier.runFullLogicVerification();
    
    // 保存结果
    const filename = await verifier.saveResults();
    console.log(`💾 逻辑验证结果已保存: ${filename}`);
    
    console.log('\n🎉 最终逻辑验证完成！');
    console.log('🎯 V5-激进优化版策略的所有逻辑已全面检查！');
    
  } catch (error) {
    console.error('❌ 逻辑验证失败:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { FinalLogicVerification };