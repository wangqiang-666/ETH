import { Router, Request, Response } from 'express';
import { BacktestEngine, BacktestConfig } from '../backtest/backtest-engine';
import { PerformanceAnalyzer } from '../backtest/performance-analyzer';
import { SmartSignalResult } from '../analyzers/smart-signal-analyzer';
import type { MarketData } from '../services/okx-data-service';

const router = Router();
const performanceAnalyzer = new PerformanceAnalyzer();

// 运行回测
router.post('/run', async (req: Request, res: Response) => {
  try {
    const { config, signals, marketData } = req.body;
    
    if (!config || !signals || !marketData) {
      return res.status(400).json({
        error: '缺少必要参数: config, signals, marketData'
      });
    }

    // 验证配置
    const backtestConfig: BacktestConfig = {
      initialCapital: config.initialCapital || 10000,
      maxPositionSize: config.maxPositionSize || 0.1,
      slippage: config.slippage || 0.001,
      tradingFee: config.commission || 0.001,
      startDate: new Date(config.startDate),
      endDate: new Date(config.endDate),
      maxHoldingTime: 24,
      riskManagement: {
        maxDailyLoss: 0.05,
        maxDrawdown: 0.2,
        positionSizing: 'RISK_PARITY'
      }
    };

    // 创建回测引擎实例
    const backtestEngine = new BacktestEngine(backtestConfig);
    
    // 转换数据格式
    const signalData = (signals as SmartSignalResult[]).map(signal => ({
      timestamp: signal.metadata.timestamp,
      signal: signal,
      marketData: marketData.find((md: any) => 
        Math.abs(new Date(md.timestamp).getTime() - signal.metadata.timestamp) < 60000
      ) || marketData[0]
    }));
    
    // 运行回测
    const result = await backtestEngine.runBacktest(
      signalData,
      marketData as MarketData[]
    );

    return res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error('回测运行错误:', error);
    return res.status(500).json({
      error: '回测运行失败',
      details: error instanceof Error ? error.message : '未知错误'
    });
  }
});

// 生成性能报告
router.post('/performance-report', async (req: Request, res: Response) => {
  try {
    const { backtestResult } = req.body;
    
    if (!backtestResult) {
      return res.status(400).json({
        error: '缺少回测结果数据'
      });
    }

    const report = performanceAnalyzer.generateReport(backtestResult);

    // 短样本稳健展示兜底（双保险）：若样本过短，则强制将年化与夏普置为 N/A（仅影响展示层，不改动底层统计）
    try {
      const summary: any = backtestResult?.summary || {};
      const obsDays: number = summary.observationDays ?? 0;
      const returnObs: number = summary.returnObservations ?? 0;
      const sampleQuality: 'INSUFFICIENT' | 'LIMITED' | 'ADEQUATE' | undefined = summary.sampleQuality;
      const isShortTrades = (summary.totalTrades ?? 0) < 10;
      const isShortDays = obsDays > 0 && obsDays < 30;
      const isLowReturnObs = returnObs > 0 && returnObs < 10;
      const shortSample = isShortTrades || isShortDays || isLowReturnObs || sampleQuality === 'INSUFFICIENT';
      if (shortSample && report?.overview) {
        report.overview.annualizedReturn = 'N/A';
        report.overview.sharpeRatio = 'N/A';
      }
    } catch {}
    
    return res.json({
      success: true,
      report
    });
  } catch (error) {
    console.error('性能报告生成错误:', error);
    return res.status(500).json({
      error: '性能报告生成失败',
      details: error instanceof Error ? error.message : '未知错误'
    });
  }
});

// 比较多个策略
router.post('/compare-strategies', async (req: Request, res: Response) => {
  try {
    const { strategies } = req.body;
    
    if (!strategies || !Array.isArray(strategies) || strategies.length < 2) {
      return res.status(400).json({
        error: '需要至少两个策略进行比较'
      });
    }

    const comparison = performanceAnalyzer.compareStrategies(strategies);
    
    return res.json({
      success: true,
      comparison
    });
  } catch (error) {
    console.error('策略比较错误:', error);
    return res.status(500).json({
      error: '策略比较失败',
      details: error instanceof Error ? error.message : '未知错误'
    });
  }
});

// 生成HTML报告
router.post('/html-report', async (req: Request, res: Response) => {
  try {
    const { backtestResult } = req.body;
    
    if (!backtestResult) {
      return res.status(400).json({
        error: '缺少回测结果数据'
      });
    }

    const htmlReport = performanceAnalyzer.generateHTMLReport(backtestResult);
    
    res.setHeader('Content-Type', 'text/html');
    return res.send(htmlReport);
  } catch (error) {
    console.error('HTML报告生成错误:', error);
    return res.status(500).json({
      error: 'HTML报告生成失败',
      details: error instanceof Error ? error.message : '未知错误'
    });
  }
});

// 获取回测配置模板
router.get('/config-template', (req: Request, res: Response) => {
  const template: BacktestConfig = {
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31'),
    initialCapital: 10000,
    maxPositionSize: 0.1,
    tradingFee: 0.001,
    slippage: 0.001,
    maxHoldingTime: 24,
    riskManagement: {
      maxDailyLoss: 0.05,
      maxDrawdown: 0.2,
      positionSizing: 'RISK_PARITY'
    }
  };

  return res.json({
    success: true,
    template
  });
});

// 获取回测引擎状态
router.get('/status', (req: Request, res: Response) => {
  return res.json({
    success: true,
    status: {
      engineReady: true,
      lastBacktestTime: null,
      supportedAssets: ['ETH', 'BTC'],
      maxHistoryDays: 365
    }
  });
});

export default router;