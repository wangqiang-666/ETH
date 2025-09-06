import { BacktestResult, BacktestTrade } from './backtest-engine';

// 性能分析报告
export interface PerformanceReport {
  overview: {
    totalReturn: string;
    annualizedReturn: string;
    winRate: string;
    sharpeRatio: string;
    maxDrawdown: string;
    profitFactor: string;
    calmarRatio: string;
  };
  tradingStats: {
    totalTrades: number;
    avgTradesPerMonth: number;
    avgHoldingTime: string;
    bestTrade: string;
    worstTrade: string;
    avgWin: string;
    avgLoss: string;
    winLossRatio: string;
  };
  riskAnalysis: {
    volatility: string;
    var95: string;
    cvar95: string;
    maxConsecutiveLosses: number;
    recoveryFactor: string;
    downsideDeviation: string;
  };
  monthlyAnalysis: {
    bestMonth: { month: string; return: string };
    worstMonth: { month: string; return: string };
    positiveMonths: number;
    totalMonths: number;
    avgMonthlyReturn: string;
    monthlyWinRate: string;
  };
  recommendations: string[];
  warnings: string[];
}

// 比较分析结果
export interface ComparisonResult {
  strategies: string[];
  metrics: {
    name: string;
    values: number[];
    winner: number; // 最佳策略的索引
    description: string;
  }[];
  summary: {
    overallWinner: string;
    strengths: Record<string, string[]>;
    weaknesses: Record<string, string[]>;
  };
}

// 性能分析器
export class PerformanceAnalyzer {
  /**
   * 生成性能报告
   */
  generateReport(result: BacktestResult): PerformanceReport {
    const { summary, trades, monthlyReturns } = result;

    // 短样本稳健展示控制（仅影响展示，不改变底层统计值）
    const obsDays: number = (summary as any).observationDays ?? 0;
    const returnObs: number = (summary as any).returnObservations ?? 0;
    const sampleQuality: 'INSUFFICIENT' | 'LIMITED' | 'ADEQUATE' | undefined = (summary as any).sampleQuality;
    const isShortTrades = summary.totalTrades < 10;
    const isShortDays = obsDays > 0 && obsDays < 30;
    const isLowReturnObs = returnObs > 0 && returnObs < 10;
    const shortSample = isShortTrades || isShortDays || isLowReturnObs || sampleQuality === 'INSUFFICIENT';

    const annualizedStr = shortSample ? 'N/A' : `${(summary.annualizedReturn * 100).toFixed(2)}%`;
    const sharpeStr = shortSample ? 'N/A' : summary.sharpeRatio.toFixed(3);
    const calmarStr = shortSample ? 'N/A' : summary.calmarRatio.toFixed(3);

    // 概览
    const overview = {
      totalReturn: `${(summary.totalReturnPercent * 100).toFixed(2)}%`,
      annualizedReturn: annualizedStr,
      winRate: `${(summary.winRate * 100).toFixed(2)}%`,
      sharpeRatio: sharpeStr,
      maxDrawdown: `${(summary.maxDrawdownPercent * 100).toFixed(2)}%`,
      profitFactor: summary.profitFactor.toFixed(2),
      calmarRatio: calmarStr
    };

    // 交易统计
    const bestTrade = Math.max(...trades.map(t => t.pnlPercent || 0));
    const worstTrade = Math.min(...trades.map(t => t.pnlPercent || 0));
    const avgTradesPerMonth = monthlyReturns.length > 0 
      ? summary.totalTrades / monthlyReturns.length 
      : 0;
    const winLossRatio = summary.avgLoss > 0 ? summary.avgWin / summary.avgLoss : 0;

    const tradingStats = {
      totalTrades: summary.totalTrades,
      avgTradesPerMonth: Math.round(avgTradesPerMonth * 10) / 10,
      avgHoldingTime: `${summary.avgHoldingTime.toFixed(1)}小时`,
      bestTrade: `${(bestTrade * 100).toFixed(2)}%`,
      worstTrade: `${(worstTrade * 100).toFixed(2)}%`,
      avgWin: `${(summary.avgWinPercent * 100).toFixed(2)}%`,
      avgLoss: `${(summary.avgLossPercent * 100).toFixed(2)}%`,
      winLossRatio: winLossRatio.toFixed(2)
    };

    // 风险分析
    const downsideReturns = trades
      .filter(t => (t.pnlPercent || 0) < 0)
      .map(t => t.pnlPercent || 0);
    const downsideDeviation = downsideReturns.length > 0 
      ? Math.sqrt(downsideReturns.reduce((sum, r) => sum + r * r, 0) / downsideReturns.length)
      : 0;

    const riskAnalysis = {
      volatility: `${(result.riskMetrics.volatility * 100).toFixed(2)}%`,
      var95: `${(result.riskMetrics.var95 * 100).toFixed(2)}%`,
      cvar95: `${(result.riskMetrics.cvar95 * 100).toFixed(2)}%`,
      maxConsecutiveLosses: summary.maxConsecutiveLosses,
      recoveryFactor: summary.recoveryFactor.toFixed(2),
      downsideDeviation: `${(downsideDeviation * 100).toFixed(2)}%`
    };

    // 月度分析
    const positiveMonths = monthlyReturns.filter(m => m.return > 0).length;
    const bestMonth = monthlyReturns.reduce((best, current) => 
      current.return > best.return ? current : best, monthlyReturns[0] || { month: 'N/A', return: 0 });
    const worstMonth = monthlyReturns.reduce((worst, current) => 
      current.return < worst.return ? current : worst, monthlyReturns[0] || { month: 'N/A', return: 0 });
    const avgMonthlyReturn = monthlyReturns.length > 0 
      ? monthlyReturns.reduce((sum, m) => sum + m.return, 0) / monthlyReturns.length 
      : 0;

    const monthlyAnalysis = {
      bestMonth: {
        month: bestMonth.month,
        return: `${(bestMonth.return * 100).toFixed(2)}%`
      },
      worstMonth: {
        month: worstMonth.month,
        return: `${(worstMonth.return * 100).toFixed(2)}%`
      },
      positiveMonths,
      totalMonths: monthlyReturns.length,
      avgMonthlyReturn: `${(avgMonthlyReturn * 100).toFixed(2)}%`,
      monthlyWinRate: monthlyReturns.length > 0 
        ? `${((positiveMonths / monthlyReturns.length) * 100).toFixed(2)}%`
        : '0%'
    };

    // 生成建议和警告
    const recommendations = this.generateRecommendations(result);
    const warnings = this.generateWarnings(result);

    // 如果样本较短，追加一条展示层面的提示
    if (shortSample) {
      warnings.push('ℹ️ 样本不足（交易<10、观测<30天或收益观测<10），已将年化收益率、夏普比率与 Calmar 比率显示为 N/A');
    }

    return {
      overview,
      tradingStats,
      riskAnalysis,
      monthlyAnalysis,
      recommendations,
      warnings
    };
  }

  /**
   * 比较多个策略
   */
  compareStrategies(results: { name: string; result: BacktestResult }[]): ComparisonResult {
    const strategies = results.map(r => r.name);
    
    const metrics = [
      {
        name: '总收益率',
        values: results.map(r => r.result.summary.totalReturnPercent),
        winner: 0,
        description: '策略的总收益率，越高越好'
      },
      {
        name: '年化收益率',
        values: results.map(r => r.result.summary.annualizedReturn),
        winner: 0,
        description: '年化收益率，考虑了时间因素'
      },
      {
        name: '胜率',
        values: results.map(r => r.result.summary.winRate),
        winner: 0,
        description: '盈利交易占总交易的比例'
      },
      {
        name: '夏普比率',
        values: results.map(r => r.result.summary.sharpeRatio),
        winner: 0,
        description: '风险调整后的收益，越高越好'
      },
      {
        name: '最大回撤',
        values: results.map(r => r.result.summary.maxDrawdownPercent),
        winner: 0,
        description: '最大回撤幅度，越小越好'
      },
      {
        name: '盈亏比',
        values: results.map(r => r.result.summary.profitFactor),
        winner: 0,
        description: '总盈利与总亏损的比值'
      },
      {
        name: 'Calmar比率',
        values: results.map(r => r.result.summary.calmarRatio),
        winner: 0,
        description: '年化收益率与最大回撤的比值'
      },
      {
        name: '交易次数',
        values: results.map(r => r.result.summary.totalTrades),
        winner: 0,
        description: '总交易次数，适中为好'
      }
    ];

    // 确定每个指标的最佳策略
    metrics.forEach(metric => {
      if (metric.name === '最大回撤') {
        // 回撤越小越好
        metric.winner = metric.values.indexOf(Math.min(...metric.values));
      } else {
        // 其他指标越大越好
        metric.winner = metric.values.indexOf(Math.max(...metric.values));
      }
    });

    // 计算综合得分
    const scores = strategies.map((_, index) => {
      let score = 0;
      metrics.forEach(metric => {
        if (metric.winner === index) score += 1;
      });
      return score;
    });

    const overallWinnerIndex = scores.indexOf(Math.max(...scores));
    const overallWinner = strategies[overallWinnerIndex];

    // 分析各策略的优缺点
    const strengths: Record<string, string[]> = {};
    const weaknesses: Record<string, string[]> = {};

    strategies.forEach((strategy, index) => {
      strengths[strategy] = [];
      weaknesses[strategy] = [];

      metrics.forEach(metric => {
        if (metric.winner === index) {
          strengths[strategy].push(metric.name);
        } else {
          const rank = metric.values
            .map((value, i) => ({ value, index: i }))
            .sort((a, b) => metric.name === '最大回撤' ? a.value - b.value : b.value - a.value)
            .findIndex(item => item.index === index);
          
          if (rank >= metric.values.length - 1) {
            weaknesses[strategy].push(metric.name);
          }
        }
      });
    });

    return {
      strategies,
      metrics,
      summary: {
        overallWinner,
        strengths,
        weaknesses
      }
    };
  }

  /**
   * 生成优化建议
   */
  generateRecommendations(result: BacktestResult): string[] {
    const recommendations: string[] = [];
    const { summary } = result;

    // 基于胜率的建议
    if (summary.winRate < 0.5) {
      recommendations.push('胜率偏低，建议优化入场条件或信号筛选标准');
    } else if (summary.winRate > 0.8) {
      recommendations.push('胜率很高，可以考虑适当放宽入场条件以增加交易频率');
    }

    // 基于盈亏比的建议
    if (summary.profitFactor < 1.5) {
      recommendations.push('盈亏比偏低，建议优化止盈止损策略');
    }

    // 基于夏普比率的建议
    if (summary.sharpeRatio < 1.0) {
      recommendations.push('夏普比率偏低，需要在收益和风险之间找到更好的平衡');
    } else if (summary.sharpeRatio > 2.0) {
      recommendations.push('夏普比率很好，策略风险调整后收益表现优秀');
    }

    // 基于最大回撤的建议
    if (summary.maxDrawdownPercent > 0.2) {
      recommendations.push('最大回撤过大，建议加强风险管理措施');
    }

    // 基于交易频率的建议
    if (summary.totalTrades < 50) {
      recommendations.push('交易次数较少，可能需要更多数据来验证策略有效性');
    } else if (summary.totalTrades > 500) {
      recommendations.push('交易频率很高，注意控制交易成本的影响');
    }

    // 基于连续亏损的建议
    if (summary.maxConsecutiveLosses > 10) {
      recommendations.push('最大连续亏损次数较多，建议增加止损机制或暂停交易规则');
    }

    // 基于持仓时间的建议
    if (summary.avgHoldingTime < 1) {
      recommendations.push('平均持仓时间很短，可能受到市场噪音影响较大');
    } else if (summary.avgHoldingTime > 72) {
      recommendations.push('平均持仓时间较长，注意市场环境变化的影响');
    }

    if (recommendations.length === 0) {
      recommendations.push('策略表现良好，建议继续监控并适时调整参数');
    }

    return recommendations;
  }

  /**
   * 生成风险警告
   */
  generateWarnings(result: BacktestResult): string[] {
    const warnings: string[] = [];
    const { summary, riskMetrics } = result;

    // 高风险警告
    if (summary.maxDrawdownPercent > 0.3) {
      warnings.push('⚠️ 最大回撤超过30%，存在高风险');
    }

    if (summary.sharpeRatio < 0) {
      warnings.push('⚠️ 夏普比率为负，策略收益不如无风险资产');
    }

    if (summary.winRate < 0.3) {
      warnings.push('⚠️ 胜率过低，策略可能存在系统性问题');
    }

    if (summary.profitFactor < 1.0) {
      warnings.push('⚠️ 盈亏比小于1，总体亏损');
    }

    if (summary.maxConsecutiveLosses > 15) {
      warnings.push('⚠️ 最大连续亏损次数过多，心理压力较大');
    }

    if (Math.abs(riskMetrics.var95) > 0.05) {
      warnings.push('⚠️ 95% VaR超过5%，单日损失风险较高');
    }

    if (riskMetrics.volatility > 0.3) {
      warnings.push('⚠️ 收益波动率过高，策略不够稳定');
    }

    // 数据质量与样本稳健性警告
    const obsDays: number = (summary as any).observationDays ?? 0;
    const returnObs: number = (summary as any).returnObservations ?? 0;
    const sampleQuality: 'INSUFFICIENT' | 'LIMITED' | 'ADEQUATE' | undefined = (summary as any).sampleQuality;

    if (summary.totalTrades < 30) {
      warnings.push('⚠️ 交易样本数量不足，统计结果可能不够可靠');
    }
    if (summary.totalTrades < 10) {
      warnings.push('⚠️ 交易样本少于10笔，已对部分风险指标采取稳健处理');
    }
    if (obsDays > 0 && obsDays < 30) {
      warnings.push('⚠️ 观测期少于30天，年化与风险指标参考意义有限');
    }
    if (returnObs > 0 && returnObs < 10) {
      warnings.push('⚠️ 收益观测数量少于10，夏普/索提诺等风险指标不稳定');
    }
    if (sampleQuality === 'INSUFFICIENT') {
      warnings.push('⚠️ 样本严重不足（观测<7天或收益观测<10），已将年化收益率与夏普等指标标记为 N/A');
    } else if (sampleQuality === 'LIMITED') {
      warnings.push('ℹ️ 样本有限（观测<30天或收益观测<30），已对风险指标做稳健折减与限幅');
    }

    return warnings;
  }

  /**
   * 计算策略稳定性指标
   */
  calculateStabilityMetrics(result: BacktestResult): {
    consistencyScore: number; // 一致性得分 (0-100)
    stabilityRating: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
    factors: {
      monthlyConsistency: number;
      drawdownRecovery: number;
      winRateStability: number;
      returnDistribution: number;
    };
  } {
    const { monthlyReturns, summary } = result;

    // 月度一致性
    const positiveMonths = monthlyReturns.filter(m => m.return > 0).length;
    const monthlyConsistency = monthlyReturns.length > 0 ? (positiveMonths / monthlyReturns.length) * 100 : 0;

    // 回撤恢复能力
    const drawdownRecovery = summary.recoveryFactor > 0 ? Math.min(100, summary.recoveryFactor * 20) : 0;

    // 胜率稳定性（基于连续亏损）
    const winRateStability = Math.max(0, 100 - summary.maxConsecutiveLosses * 5);

    // 收益分布（基于夏普比率）
    const returnDistribution = Math.min(100, Math.max(0, summary.sharpeRatio * 30));

    // 综合一致性得分
    const consistencyScore = (
      monthlyConsistency * 0.3 +
      drawdownRecovery * 0.3 +
      winRateStability * 0.2 +
      returnDistribution * 0.2
    );

    let stabilityRating: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
    if (consistencyScore >= 80) stabilityRating = 'EXCELLENT';
    else if (consistencyScore >= 65) stabilityRating = 'GOOD';
    else if (consistencyScore >= 50) stabilityRating = 'FAIR';
    else stabilityRating = 'POOR';

    return {
      consistencyScore: Math.round(consistencyScore),
      stabilityRating,
      factors: {
        monthlyConsistency: Math.round(monthlyConsistency),
        drawdownRecovery: Math.round(drawdownRecovery),
        winRateStability: Math.round(winRateStability),
        returnDistribution: Math.round(returnDistribution)
      }
    };
  }

  /**
   * 生成HTML报告
   */
  generateHTMLReport(result: BacktestResult): string {
    const report = this.generateReport(result);
    const stability = this.calculateStabilityMetrics(result);

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>回测性能报告</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }
        .section { padding: 20px; border-bottom: 1px solid #eee; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
        .metric-card { background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center; }
        .metric-value { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .metric-label { font-size: 12px; color: #7f8c8d; margin-top: 5px; }
        .positive { color: #27ae60; }
        .negative { color: #e74c3c; }
        .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; border-radius: 5px; margin: 5px 0; }
        .recommendation { background: #d1ecf1; border: 1px solid #bee5eb; padding: 10px; border-radius: 5px; margin: 5px 0; }
        .stability-badge { display: inline-block; padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold; }
        .excellent { background: #d4edda; color: #155724; }
        .good { background: #cce5ff; color: #004085; }
        .fair { background: #fff3cd; color: #856404; }
        .poor { background: #f8d7da; color: #721c24; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 回测性能报告</h1>
            <p>生成时间: ${new Date().toLocaleString('zh-CN')}</p>
            <div class="stability-badge ${stability.stabilityRating.toLowerCase()}">
                策略稳定性: ${stability.stabilityRating} (${stability.consistencyScore}分)
            </div>
        </div>

        <div class="section">
            <h2>📈 核心指标</h2>
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-value ${parseFloat(report.overview.totalReturn) >= 0 ? 'positive' : 'negative'}">
                        ${report.overview.totalReturn}
                    </div>
                    <div class="metric-label">总收益率</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value ${parseFloat(report.overview.annualizedReturn) >= 0 ? 'positive' : 'negative'}">
                        ${report.overview.annualizedReturn}
                    </div>
                    <div class="metric-label">年化收益率</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${report.overview.winRate}</div>
                    <div class="metric-label">胜率</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${report.overview.sharpeRatio}</div>
                    <div class="metric-label">夏普比率</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value negative">${report.overview.maxDrawdown}</div>
                    <div class="metric-label">最大回撤</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${report.overview.profitFactor}</div>
                    <div class="metric-label">盈亏比</div>
                </div>
            </div>
        </div>

        <div class="section">
            <h2>📊 交易统计</h2>
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-value">${report.tradingStats.totalTrades}</div>
                    <div class="metric-label">总交易次数</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${report.tradingStats.avgHoldingTime}</div>
                    <div class="metric-label">平均持仓时间</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value positive">${report.tradingStats.bestTrade}</div>
                    <div class="metric-label">最佳交易</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value negative">${report.tradingStats.worstTrade}</div>
                    <div class="metric-label">最差交易</div>
                </div>
            </div>
        </div>

        <div class="section">
            <h2>⚠️ 风险分析</h2>
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-value">${report.riskAnalysis.volatility}</div>
                    <div class="metric-label">收益波动率</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${report.riskAnalysis.var95}</div>
                    <div class="metric-label">95% VaR</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${report.riskAnalysis.maxConsecutiveLosses}</div>
                    <div class="metric-label">最大连续亏损</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${report.riskAnalysis.recoveryFactor}</div>
                    <div class="metric-label">恢复因子</div>
                </div>
            </div>
        </div>

        <div class="section">
            <h2>📅 月度表现</h2>
            <p><strong>最佳月份:</strong> ${report.monthlyAnalysis.bestMonth.month} (${report.monthlyAnalysis.bestMonth.return})</p>
            <p><strong>最差月份:</strong> ${report.monthlyAnalysis.worstMonth.month} (${report.monthlyAnalysis.worstMonth.return})</p>
            <p><strong>盈利月份:</strong> ${report.monthlyAnalysis.positiveMonths}/${report.monthlyAnalysis.totalMonths} (${report.monthlyAnalysis.monthlyWinRate})</p>
            <p><strong>平均月收益:</strong> ${report.monthlyAnalysis.avgMonthlyReturn}</p>
        </div>

        ${report.warnings.length > 0 ? `
        <div class="section">
            <h2>⚠️ 风险警告</h2>
            ${report.warnings.map(warning => `<div class="warning">${warning}</div>`).join('')}
        </div>
        ` : ''}

        <div class="section">
            <h2>💡 优化建议</h2>
            ${report.recommendations.map(rec => `<div class="recommendation">${rec}</div>`).join('')}
        </div>

        <div class="section">
            <h2>🎯 稳定性分析</h2>
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-value">${stability.factors.monthlyConsistency}%</div>
                    <div class="metric-label">月度一致性</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${stability.factors.drawdownRecovery}%</div>
                    <div class="metric-label">回撤恢复</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${stability.factors.winRateStability}%</div>
                    <div class="metric-label">胜率稳定性</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${stability.factors.returnDistribution}%</div>
                    <div class="metric-label">收益分布</div>
                </div>
            </div>
        </div>
    </div>
</body>
</html>
    `;
  }
}

// 导出性能分析器实例
export const performanceAnalyzer = new PerformanceAnalyzer();