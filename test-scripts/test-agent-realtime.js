#!/usr/bin/env node

/**
 * ETH合约Agent实时测试
 * 模拟实时决策和监控功能
 */

console.log('🚀 启动ETH合约Agent实时测试...\n');

// Agent状态
let agentState = {
  isRunning: false,
  currentPosition: null,
  totalTrades: 0,
  winningTrades: 0,
  totalReturn: 0,
  currentCapital: 10000,
  maxDrawdown: 0,
  peakCapital: 10000,
  decisions: [],
  lastDecisionTime: 0
};

// 实时市场数据模拟
let currentMarketData = {
  price: 3000,
  volume: 1500000,
  trend: 'SIDEWAYS',
  volatility: 0.02,
  timestamp: Date.now()
};

// 主测试函数
async function runRealtimeAgentTest() {
  try {
    console.log('🤖 ETH合约Agent实时测试');
    console.log('='.repeat(60));
    
    // 启动Agent
    await startAgent();
    
    // 运行实时监控
    await runRealtimeMonitoring();
    
  } catch (error) {
    console.error('❌ 实时测试失败:', error);
  }
}

// 启动Agent
async function startAgent() {
  console.log('[Agent] 🚀 启动ETH合约Agent...');
  console.log('[Agent] ⚙️ 初始化配置:');
  console.log('   - 初始资金: $10,000');
  console.log('   - 最大仓位: 20%');
  console.log('   - 止损: 2%');
  console.log('   - 止盈: 4%');
  console.log('   - 决策间隔: 30秒');
  
  agentState.isRunning = true;
  
  await sleep(1000);
  console.log('[Agent] ✅ Agent启动成功，开始实时监控...\n');
}

// 实时监控
async function runRealtimeMonitoring() {
  console.log('📊 开始实时监控和决策 (运行60秒)...\n');
  
  const startTime = Date.now();
  const duration = 60000; // 60秒
  let cycleCount = 0;
  
  while (Date.now() - startTime < duration) {
    cycleCount++;
    
    // 更新市场数据
    updateMarketData();
    
    // Agent决策
    await makeAgentDecision(cycleCount);
    
    // 显示状态
    displayAgentStatus(cycleCount);
    
    // 等待下一个周期
    await sleep(5000); // 5秒一个周期
  }
  
  // 停止Agent
  await stopAgent();
  
  // 显示最终结果
  displayFinalResults();
}

// 更新市场数据
function updateMarketData() {
  // 模拟价格波动
  const priceChange = (Math.random() - 0.5) * 0.02; // ±1%
  currentMarketData.price = currentMarketData.price * (1 + priceChange);
  
  // 模拟成交量变化
  currentMarketData.volume = 1000000 + Math.random() * 2000000;
  
  // 模拟趋势变化
  const trends = ['UPTREND', 'DOWNTREND', 'SIDEWAYS'];
  if (Math.random() < 0.1) { // 10%概率改变趋势
    currentMarketData.trend = trends[Math.floor(Math.random() * trends.length)];
  }
  
  // 模拟波动率变化
  currentMarketData.volatility = 0.01 + Math.random() * 0.03;
  
  currentMarketData.timestamp = Date.now();
}

// Agent决策
async function makeAgentDecision(cycle) {
  const now = Date.now();
  
  // 每30秒做一次决策
  if (now - agentState.lastDecisionTime < 30000 && cycle > 1) {
    return;
  }
  
  console.log(`[Cycle ${cycle}] 🧠 Agent正在分析市场数据...`);
  
  // 模拟决策过程
  await sleep(1000);
  
  // 生成交易信号
  const signal = generateTradingSignal();
  
  // 执行决策
  const decision = await executeDecision(signal, cycle);
  
  // 记录决策
  agentState.decisions.push(decision);
  agentState.lastDecisionTime = now;
  
  console.log(`[Cycle ${cycle}] 📋 决策: ${decision.action} (置信度: ${(decision.confidence * 100).toFixed(1)}%)`);
  
  if (decision.action !== 'HOLD') {
    console.log(`[Cycle ${cycle}] 💡 决策依据: ${decision.reasoning}`);
  }
}

// 生成交易信号
function generateTradingSignal() {
  const price = currentMarketData.price;
  const trend = currentMarketData.trend;
  const volatility = currentMarketData.volatility;
  
  let signal = 'HOLD';
  let confidence = 0.5;
  let reasoning = '';
  
  // 基于趋势的信号
  if (trend === 'UPTREND' && volatility < 0.025) {
    signal = 'BUY';
    confidence = 0.7 + Math.random() * 0.2;
    reasoning = '上升趋势 + 低波动率';
  } else if (trend === 'DOWNTREND' && volatility < 0.025) {
    signal = 'SELL';
    confidence = 0.7 + Math.random() * 0.2;
    reasoning = '下降趋势 + 低波动率';
  } else if (volatility > 0.03) {
    // 高波动率时保持观望
    signal = 'HOLD';
    confidence = 0.8;
    reasoning = '高波动率，等待稳定';
  } else {
    // 震荡市场
    const random = Math.random();
    if (random > 0.7) {
      signal = 'BUY';
      confidence = 0.6;
      reasoning = '震荡市场低位买入';
    } else if (random < 0.3) {
      signal = 'SELL';
      confidence = 0.6;
      reasoning = '震荡市场高位卖出';
    } else {
      signal = 'HOLD';
      confidence = 0.5;
      reasoning = '震荡市场观望';
    }
  }
  
  return { signal, confidence, reasoning, price };
}

// 执行决策
async function executeDecision(signal, cycle) {
  const decision = {
    cycle,
    timestamp: Date.now(),
    action: 'HOLD',
    confidence: signal.confidence,
    reasoning: signal.reasoning,
    price: signal.price,
    pnl: 0
  };
  
  // 如果有持仓，检查是否需要平仓
  if (agentState.currentPosition) {
    const position = agentState.currentPosition;
    const currentPrice = signal.price;
    const pnlPercent = position.side === 'LONG' 
      ? (currentPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - currentPrice) / position.entryPrice;
    
    // 止盈止损检查
    if (pnlPercent >= 0.04) { // 4%止盈
      decision.action = 'CLOSE';
      decision.reasoning = '达到止盈目标 (+4%)';
      await closePosition(decision, pnlPercent);
    } else if (pnlPercent <= -0.02) { // 2%止损
      decision.action = 'CLOSE';
      decision.reasoning = '触发止损 (-2%)';
      await closePosition(decision, pnlPercent);
    } else if (signal.signal !== 'HOLD' && 
               ((position.side === 'LONG' && signal.signal === 'SELL') ||
                (position.side === 'SHORT' && signal.signal === 'BUY'))) {
      // 信号反转
      decision.action = 'CLOSE';
      decision.reasoning = '信号反转，平仓';
      await closePosition(decision, pnlPercent);
    }
  }
  
  // 如果没有持仓且信号强度足够，开仓
  if (!agentState.currentPosition && signal.confidence >= 0.65 && signal.signal !== 'HOLD') {
    decision.action = signal.signal === 'BUY' ? 'OPEN_LONG' : 'OPEN_SHORT';
    await openPosition(decision);
  }
  
  return decision;
}

// 开仓
async function openPosition(decision) {
  const positionSize = agentState.currentCapital * 0.2; // 20%仓位
  
  agentState.currentPosition = {
    side: decision.action === 'OPEN_LONG' ? 'LONG' : 'SHORT',
    entryPrice: decision.price,
    size: positionSize,
    entryTime: decision.timestamp
  };
  
  console.log(`[Cycle ${decision.cycle}] 📈 开仓: ${agentState.currentPosition.side} $${positionSize.toFixed(0)} @ $${decision.price.toFixed(2)}`);
}

// 平仓
async function closePosition(decision, pnlPercent) {
  const position = agentState.currentPosition;
  const pnl = position.size * pnlPercent;
  
  agentState.currentCapital += pnl;
  agentState.totalReturn += pnl;
  agentState.totalTrades++;
  
  if (pnl > 0) {
    agentState.winningTrades++;
  }
  
  // 更新最大回撤
  if (agentState.currentCapital > agentState.peakCapital) {
    agentState.peakCapital = agentState.currentCapital;
  }
  const drawdown = (agentState.peakCapital - agentState.currentCapital) / agentState.peakCapital;
  if (drawdown > agentState.maxDrawdown) {
    agentState.maxDrawdown = drawdown;
  }
  
  decision.pnl = pnl;
  
  console.log(`[Cycle ${decision.cycle}] 📉 平仓: ${position.side} PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${(pnlPercent * 100).toFixed(2)}%)`);
  
  agentState.currentPosition = null;
}

// 显示Agent状态
function displayAgentStatus(cycle) {
  const winRate = agentState.totalTrades > 0 ? (agentState.winningTrades / agentState.totalTrades * 100) : 0;
  const totalReturnPercent = (agentState.totalReturn / 10000) * 100;
  
  console.log(`[Cycle ${cycle}] 📊 状态: 资金 $${agentState.currentCapital.toFixed(0)} | 收益 ${totalReturnPercent >= 0 ? '+' : ''}${totalReturnPercent.toFixed(2)}% | 胜率 ${winRate.toFixed(1)}% | 交易 ${agentState.totalTrades}`);
  
  if (agentState.currentPosition) {
    const position = agentState.currentPosition;
    const currentPnl = position.side === 'LONG' 
      ? (currentMarketData.price - position.entryPrice) / position.entryPrice
      : (position.entryPrice - currentMarketData.price) / position.entryPrice;
    
    console.log(`[Cycle ${cycle}] 💼 持仓: ${position.side} @ $${position.entryPrice.toFixed(2)} | 浮盈 ${currentPnl >= 0 ? '+' : ''}${(currentPnl * 100).toFixed(2)}%`);
  }
  
  console.log(`[Cycle ${cycle}] 📈 市场: $${currentMarketData.price.toFixed(2)} | ${currentMarketData.trend} | 波动率 ${(currentMarketData.volatility * 100).toFixed(2)}%\n`);
}

// 停止Agent
async function stopAgent() {
  console.log('[Agent] 🛑 停止Agent...');
  
  // 如果有持仓，强制平仓
  if (agentState.currentPosition) {
    const position = agentState.currentPosition;
    const pnlPercent = position.side === 'LONG' 
      ? (currentMarketData.price - position.entryPrice) / position.entryPrice
      : (position.entryPrice - currentMarketData.price) / position.entryPrice;
    
    const pnl = position.size * pnlPercent;
    agentState.currentCapital += pnl;
    agentState.totalReturn += pnl;
    agentState.totalTrades++;
    
    if (pnl > 0) {
      agentState.winningTrades++;
    }
    
    console.log(`[Agent] 📉 强制平仓: ${position.side} PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
    agentState.currentPosition = null;
  }
  
  agentState.isRunning = false;
  console.log('[Agent] ✅ Agent已停止\n');
}

// 显示最终结果
function displayFinalResults() {
  console.log('🎯 ETH合约Agent实时测试结果');
  console.log('='.repeat(60));
  
  const winRate = agentState.totalTrades > 0 ? (agentState.winningTrades / agentState.totalTrades) : 0;
  const totalReturnPercent = (agentState.totalReturn / 10000);
  const finalCapital = agentState.currentCapital;
  
  console.log(`📊 交易统计:`);
  console.log(`   总交易次数: ${agentState.totalTrades}`);
  console.log(`   盈利交易: ${agentState.winningTrades}`);
  console.log(`   亏损交易: ${agentState.totalTrades - agentState.winningTrades}`);
  console.log(`   胜率: ${(winRate * 100).toFixed(2)}%`);
  
  console.log(`\n💰 收益统计:`);
  console.log(`   初始资金: $10,000`);
  console.log(`   最终资金: $${finalCapital.toFixed(2)}`);
  console.log(`   总收益: ${totalReturnPercent >= 0 ? '+' : ''}$${agentState.totalReturn.toFixed(2)}`);
  console.log(`   收益率: ${totalReturnPercent >= 0 ? '+' : ''}${(totalReturnPercent * 100).toFixed(2)}%`);
  console.log(`   最大回撤: ${(agentState.maxDrawdown * 100).toFixed(2)}%`);
  
  console.log(`\n🤖 Agent表现:`);
  console.log(`   决策次数: ${agentState.decisions.length}`);
  console.log(`   平均决策间隔: ${agentState.decisions.length > 1 ? Math.round((agentState.decisions[agentState.decisions.length-1].timestamp - agentState.decisions[0].timestamp) / (agentState.decisions.length-1) / 1000) : 0}秒`);
  
  // 评估表现
  let grade = 'D';
  let comment = '';
  
  if (totalReturnPercent > 0.02 && winRate > 0.6) {
    grade = 'A';
    comment = '优秀！短期表现出色';
  } else if (totalReturnPercent > 0.01 && winRate > 0.5) {
    grade = 'B';
    comment = '良好！表现稳定';
  } else if (totalReturnPercent > 0 && winRate > 0.4) {
    grade = 'C';
    comment = '及格！有改进空间';
  } else {
    grade = 'D';
    comment = '需要优化策略';
  }
  
  console.log(`\n🏆 实时表现评级: ${grade}`);
  console.log(`💬 评价: ${comment}`);
  
  console.log(`\n📈 决策分析:`);
  const actions = agentState.decisions.reduce((acc, d) => {
    acc[d.action] = (acc[d.action] || 0) + 1;
    return acc;
  }, {});
  
  Object.entries(actions).forEach(([action, count]) => {
    console.log(`   ${action}: ${count}次`);
  });
  
  console.log('\n💡 实时交易建议:');
  if (winRate > 0.6) {
    console.log('   ✅ 策略表现良好，可以考虑增加仓位');
  } else if (winRate < 0.4) {
    console.log('   ⚠️ 胜率偏低，建议优化入场条件');
  }
  
  if (agentState.maxDrawdown > 0.05) {
    console.log('   ⚠️ 回撤较大，建议加强风险控制');
  }
  
  if (agentState.totalTrades < 3) {
    console.log('   📊 交易次数较少，建议延长测试时间');
  }
  
  console.log('\n🎉 实时测试完成！');
}

// 睡眠函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 运行实时测试
runRealtimeAgentTest().catch(console.error);