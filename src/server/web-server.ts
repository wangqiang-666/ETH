import express, { Request, Response } from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import cors from 'cors';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { ethStrategyEngine } from '../strategy/eth-strategy-engine';
import { StrategyResult } from '../strategy/eth-strategy-engine';
import { smartSignalAnalyzer } from '../analyzers/smart-signal-analyzer';
import { enhancedOKXDataService } from '../services/enhanced-okx-data-service';
import { config } from '../config';
import riskRoutes from '../api/risk-routes';
import backtestRoutes from '../api/backtest-routes';
import { dataValidator } from '../utils/data-validator';
import { TechnicalIndicatorAnalyzer } from '../indicators/technical-indicators';
import { RSI, MACD, BollingerBands  } from 'technicalindicators';

import fs from 'fs';
import { RecommendationIntegrationService } from '../services/recommendation-integration-service';
import { tradingSignalService } from '../services/trading-signal-service';
import { riskManagementService } from '../services/risk-management-service';
import { MLAnalyzer } from '../ml/ml-analyzer';
import NodeCache from 'node-cache';

// FGI 缓存（5分钟）
const fgiCache = new NodeCache({ stdTTL: 300, useClones: false });

// API响应接口
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

// WebSocket事件类型
interface SocketEvents {
  'strategy-update': StrategyResult;
  'market-data': any;
  'position-update': any;
  'alert': {
    level: 'INFO' | 'WARNING' | 'CRITICAL';
    message: string;
    timestamp: number;
  };
}

export class WebServer {
  private app: express.Application;
  private server: any;
  private io: Server;
  private port: number;
  private isRunning = false;
  private updateInterval: NodeJS.Timeout | null = null;
  private recommendationService: RecommendationIntegrationService;

  constructor(port: number = config.webServer.port) {
    this.port = port;
    this.app = express();
    this.server = createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // 初始化推荐系统
    this.recommendationService = new RecommendationIntegrationService(
      enhancedOKXDataService,
      ethStrategyEngine,
      tradingSignalService,
      riskManagementService
    );

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketIO();
    this.setupRecommendationEvents();
  }

  // 设置中间件
  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json({ limit: '5mb' }));
    this.app.use(express.static(path.join(__dirname, '../../public')));
    
    // 请求日志
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });
  }

  // 设置路由
  private setupRoutes(): void {
    // 健康检查
    this.app.get('/health', this.handleHealth.bind(this));
    
    // 策略相关API
    this.app.get('/api/strategy/status', this.handleStrategyStatus.bind(this));
    this.app.get('/api/strategy/analysis', this.handleLatestAnalysis.bind(this));
    this.app.get('/api/strategy/progress', this.handleAnalysisProgress.bind(this));
    this.app.post('/api/strategy/start', this.handleStartStrategy.bind(this));
    this.app.post('/api/strategy/stop', this.handleStopStrategy.bind(this));
    this.app.get('/api/strategy/performance', this.handlePerformance.bind(this));
    this.app.get('/api/strategy/trades', this.handleTradeHistory.bind(this));
    
    // 市场数据API
    this.app.get('/api/market/ticker', this.handleMarketTicker.bind(this));
    this.app.get('/api/market/kline', this.handleMarketKline.bind(this));
    this.app.get('/api/market/contract', this.handleContractInfo.bind(this));
    // 新增：FGI 情绪指数
    this.app.get('/api/sentiment/fgi', this.handleFGI.bind(this));
    // 新增：资金费率(8h)
    this.app.get('/api/market/funding-rate', async (req: Request, res: Response) => {
      try {
        const symbol = (req.query.symbol as string) || config.trading.defaultSymbol;
        const rate = await enhancedOKXDataService.getFundingRate(symbol);
        const response: ApiResponse = {
          success: true,
          data: { symbol, fundingRate: (typeof rate === 'number' ? rate : null) },
          timestamp: Date.now()
        };
        res.json(response);
      } catch (error) {
        this.handleError(res, error, 'Failed to get funding rate');
      }
    });

    // 数据真实性诊断
    this.app.get('/api/diagnostics/validate', this.handleDiagnosticsValidate.bind(this));
    
    // 技术指标API
    this.app.get('/api/indicators/latest', this.handleLatestIndicators.bind(this));
    this.app.get('/api/indicators/rsi-series', this.handleRSISeries.bind(this));
    this.app.get('/api/indicators/rsi-validate', this.handleRSIValidate.bind(this));
    // 新增：MACD 时间序列（用于核对1H策略MACD准确性）
    this.app.get('/api/indicators/macd-series', this.handleMACDSeries.bind(this));
    // 新增：MACD 自动化比对校验（单次）
    this.app.get('/api/indicators/macd-validate', this.handleMACDValidate.bind(this));
    // 新增：MACD 自动化比对校验（批量）
    this.app.get('/api/indicators/macd-validate-batch', this.handleMACDValidateBatch.bind(this));
    // 新增：MACD 离线快照校验（POST）
    this.app.post('/api/indicators/macd-validate-offline', this.handleMACDValidateOffline.bind(this));
    // 新增：MACD 离线快照批量校验（POST）
    this.app.post('/api/indicators/macd-validate-offline-batch', this.handleMACDValidateOfflineBatch.bind(this));

    // 新增：BOLL 时间序列与自动化校验
    this.app.get('/api/indicators/boll-series', this.handleBOLLSeries.bind(this));
    this.app.get('/api/indicators/boll-validate', this.handleBOLLValidate.bind(this));
    // 新增：BOLL 离线快照校验（POST）
    this.app.post('/api/indicators/boll-validate-offline', this.handleBOLLValidateOffline.bind(this));
    // 新增：BOLL 离线快照批量校验（POST）
    this.app.post('/api/indicators/boll-validate-offline-batch', this.handleBOLLValidateOfflineBatch.bind(this));

    // 配置API
    this.app.get('/api/config', this.handleGetConfig.bind(this));
    this.app.post('/api/config', this.handleUpdateConfig.bind(this));

    // ML 离线模型热更新
    this.app.post('/api/ml/reload', async (req: Request, res: Response) => {
      try {
        const customPath = typeof (req.body?.path) === 'string' && req.body.path.length > 0 ? req.body.path : undefined;
        const result = await MLAnalyzer.loadOfflineModel(customPath);
        if (result.ok) {
          res.json({
            success: true,
            message: '模型已重新加载',
            model: {
              version: result.model?.version,
              sampleCount: result.model?.sampleCount,
              thresholds: result.model?.thresholds
            }
          });
        } else {
          res.status(400).json({ success: false, error: result.error || '加载失败' });
        }
      } catch (e: any) {
        res.status(500).json({ success: false, error: e?.message || String(e) });
      }
    });
    
    // 风险管理API
    this.app.use('/api/risk', riskRoutes);
    
    // 回测API
    this.app.use('/api/backtest', backtestRoutes);
    
    // 推荐系统API
    this.app.use('/api', this.recommendationService.getAPIRouter());
    
    // 回测页面
    this.app.get('/backtest', (req, res) => {
      res.sendFile(path.join(__dirname, '../../src/web/backtest.html'));
    });
    
    // 默认路由 - 返回主页
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/index.html'));
    });
    
    // 404处理
    this.app.use((req, res) => {
      res.status(404).json({
        success: false,
        error: 'API endpoint not found',
        timestamp: Date.now()
      });
    });
    
    // 错误处理（调试增强）
    this.app.use((error: any, req: Request, res: Response, next: any) => {
      console.error('Server error:', error);
      res.status(500).json({
        success: false,
        error: error?.message || 'Internal server error',
        details: (process.env.NODE_ENV !== 'production') ? String(error?.stack || error) : undefined,
        timestamp: Date.now()
      });
    });
  }

  // 设置推荐系统事件监听
  private setupRecommendationEvents(): void {
    // 监听推荐系统事件并通过WebSocket广播
    this.recommendationService.on('recommendation_created', (data) => {
      this.io.emit('recommendation-created', data);
    });
    
    this.recommendationService.on('recommendation_result', (data) => {
      this.io.emit('recommendation-result', data);
    });
    
    this.recommendationService.on('recommendation_triggered', (data) => {
      this.io.emit('recommendation-triggered', data);
    });
    
    this.recommendationService.on('statistics_updated', (data) => {
      this.io.emit('statistics-updated', data);
    });
    
    this.recommendationService.on('auto_recommendation_created', (data) => {
      this.io.emit('auto-recommendation-created', data);
    });

    // 监听策略引擎分析进度并通过 Socket.IO 转发
    try {
      ethStrategyEngine.on('analysis-progress', (payload: any) => {
        try {
          this.io.to('strategy-updates').emit('analysis-progress', payload);
        } catch (e) {
          console.warn('broadcast analysis-progress error:', e);
        }
      });
    } catch (e) {
      console.warn('setup analysis-progress listener failed:', e);
    }
  }

  // 设置WebSocket
  private setupSocketIO(): void {
    this.io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`);
      
      // 发送当前状态
      this.sendCurrentStatus(socket);
      
      // 处理客户端事件
      socket.on('subscribe-updates', () => {
        socket.join('strategy-updates');
        console.log(`Client ${socket.id} subscribed to updates`);
        
        // 订阅后立即推送一次当前的分析进度
        try {
          const progress = ethStrategyEngine.getAnalysisProgress();
          if (progress) {
            socket.emit('analysis-progress', progress);
          }
        } catch (e) {
          console.warn('send initial analysis-progress failed:', e);
        }
      });
      
      socket.on('unsubscribe-updates', () => {
        socket.leave('strategy-updates');
        console.log(`Client ${socket.id} unsubscribed from updates`);
      });
      
      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
      });
    });
  }

  // API处理方法
  private async handleHealth(req: Request, res: Response): Promise<void> {
    const response: ApiResponse = {
      success: true,
      data: {
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: Date.now(),
        version: '1.0.0'
      },
      timestamp: Date.now()
    };
    res.json(response);
  }

  private async handleStrategyStatus(req: Request, res: Response): Promise<void> {
    try {
      const status = ethStrategyEngine.getCurrentStatus();
      const response: ApiResponse = {
        success: true,
        data: status,
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to get strategy status');
    }
  }

  private async handleLatestAnalysis(req: Request, res: Response): Promise<void> {
    try {
      const analysis = ethStrategyEngine.getLatestAnalysis();
      const response: ApiResponse = {
        success: true,
        data: analysis,
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to get latest analysis');
    }
  }

  // 新增：分析实时进度
  private async handleAnalysisProgress(req: Request, res: Response): Promise<void> {
    try {
      const progress = ethStrategyEngine.getAnalysisProgress();
      const response: ApiResponse = {
        success: true,
        data: progress,
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to get analysis progress');
    }
  }

  // 数据真实性验证与诊断
  private async handleDiagnosticsValidate(req: Request, res: Response): Promise<void> {
    try {
      const symbol = (req.query.symbol as string) || 'ETH-USDT-SWAP';
      const interval = (req.query.interval as string) || '1m';
      const limit = parseInt((req.query.limit as string) || '100', 10);

      const [ticker, klines] = await Promise.all([
        enhancedOKXDataService.getTicker(symbol),
        enhancedOKXDataService.getKlineData(symbol, interval, limit)
      ]);

      const tickerReport = ticker
        ? dataValidator.validateTicker(ticker, symbol)
        : {
            valid: false,
            hasErrors: true,
            issues: [{ code: 'TICKER_NULL', message: 'Ticker 为空', severity: 'ERROR' }],
            metrics: {},
            summary: 'Ticker 为空'
          };

      const klineReport = dataValidator.validateKlines(klines, interval, symbol);

      // 交叉校验：Ticker 与 最新K线收盘价差异
      let crossChecks: any = {};
      if (Array.isArray(klines) && klines.length > 0 && ticker?.price) {
        const lastClose = klines[klines.length - 1].close;
        const deltaPct = lastClose > 0 ? Math.abs((ticker.price - lastClose) / lastClose) * 100 : null;
        crossChecks = {
          lastClose,
          tickerPrice: ticker.price,
          tickerVsLastClosePct: deltaPct,
          within2PctTolerance: typeof deltaPct === 'number' ? deltaPct < 2 : false
        };
      }

      // 指标计算与简单校验
      const tiAnalyzer = new TechnicalIndicatorAnalyzer();
      tiAnalyzer.updateKlineData(klines.map(k => ({
        timestamp: k.timestamp,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume
      })));
      const indicators = tiAnalyzer.calculateAllIndicators();

      const indicatorIssues: Array<{ code: string; message: string; severity: 'INFO' | 'WARNING' | 'ERROR' }>= [];
      const isFiniteNum = (n: any) => typeof n === 'number' && Number.isFinite(n);

      if (!indicators) {
        indicatorIssues.push({ code: 'INDICATOR_CALC_FAILED', message: '技术指标计算失败', severity: 'ERROR' });
      } else {
        // RSI范围
        if (!isFiniteNum(indicators.rsi) || indicators.rsi < 0 || indicators.rsi > 100) {
          indicatorIssues.push({ code: 'RSI_RANGE', message: `RSI超出范围: ${indicators.rsi}`, severity: 'ERROR' });
        }
        // 布林带关系
        if (indicators.bollinger) {
          const { upper, middle, lower } = indicators.bollinger;
          if (![upper, middle, lower].every(isFiniteNum) || !(upper >= middle && middle >= lower)) {
            indicatorIssues.push({ code: 'BOLLINGER_INVALID', message: '布林带上下轨/中轨关系不成立', severity: 'ERROR' });
          }
        }
        // MACD数值
        if (indicators.macd) {
          const { macd, signal, histogram } = indicators.macd;
          if (![macd, signal, histogram].every(isFiniteNum)) {
            indicatorIssues.push({ code: 'MACD_NAN', message: 'MACD包含非数值', severity: 'ERROR' });
          }
        }
        // ATR非负
        if (!isFiniteNum(indicators.atr) || indicators.atr < 0) {
          indicatorIssues.push({ code: 'ATR_NEGATIVE', message: `ATR 非法: ${indicators.atr}`, severity: 'ERROR' });
        }
      }

      const response: ApiResponse = {
        success: true,
        data: {
          symbol,
          interval,
          limit,
          proxy: {
            forceOnly: config.proxy?.forceOnly ?? false,
            url: config.proxy?.url ?? null
          },
          health: enhancedOKXDataService.getHealthStatus(),
          compression: enhancedOKXDataService.getCompressionStats(),
          errorRecovery: enhancedOKXDataService.getErrorRecoveryStats(),
          performance: enhancedOKXDataService.getPerformanceStats(),
          cache: enhancedOKXDataService.getCacheStats(),
          tickerValidation: tickerReport,
          klineValidation: klineReport,
          crossChecks,
          indicators: {
            issues: indicatorIssues,
            current: indicators || null
          }
        },
        timestamp: Date.now()
      };

      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to validate data authenticity');
    }
  }

  private async handleStartStrategy(req: Request, res: Response): Promise<void> {
    try {
      await ethStrategyEngine.start();
      const response: ApiResponse = {
        success: true,
        data: { message: 'Strategy started successfully' },
        timestamp: Date.now()
      };
      res.json(response);
      
      // 通知所有客户端
      this.io.to('strategy-updates').emit('alert', {
        level: 'INFO',
        message: '策略引擎已启动',
        timestamp: Date.now()
      });
    } catch (error) {
      this.handleError(res, error, 'Failed to start strategy');
    }
  }

  private async handleStopStrategy(req: Request, res: Response): Promise<void> {
    try {
      ethStrategyEngine.stop();
      const response: ApiResponse = {
        success: true,
        data: { message: 'Strategy stopped successfully' },
        timestamp: Date.now()
      };
      res.json(response);
      
      // 通知所有客户端
      this.io.to('strategy-updates').emit('alert', {
        level: 'INFO',
        message: '策略引擎已停止',
        timestamp: Date.now()
      });
    } catch (error) {
      this.handleError(res, error, 'Failed to stop strategy');
    }
  }

  private async handlePerformance(req: Request, res: Response): Promise<void> {
    try {
      const status = ethStrategyEngine.getCurrentStatus();
      const response: ApiResponse = {
        success: true,
        data: status.performance,
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to get performance data');
    }
  }

  private async handleTradeHistory(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const trades = ethStrategyEngine.getTradeHistory(limit);
      const response: ApiResponse = {
        success: true,
        data: trades,
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to get trade history');
    }
  }

  private async handleMarketTicker(req: Request, res: Response): Promise<void> {
    try {
      const symbol = req.query.symbol as string || config.trading.defaultSymbol;
      const ticker = await enhancedOKXDataService.getTicker(symbol);
      const response: ApiResponse = {
        success: true,
        data: ticker,
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to get market ticker');
    }
  }

  private async handleMarketKline(req: Request, res: Response): Promise<void> {
    try {
      const symbol = req.query.symbol as string || config.trading.defaultSymbol;
      const interval = req.query.interval as string || '1m';
      const limit = parseInt(req.query.limit as string) || 100;
      
      const klines = await enhancedOKXDataService.getKlineData(symbol, interval, limit);
      const response: ApiResponse = {
        success: true,
        data: klines,
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to get kline data');
    }
  }

  private async handleContractInfo(req: Request, res: Response): Promise<void> {
    try {
      const symbol = req.query.symbol as string || config.trading.defaultSymbol;
      const contractInfo = await enhancedOKXDataService.getContractInfo(symbol);
      const response: ApiResponse = {
        success: true,
        data: contractInfo,
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to get contract info');
    }
  }

  // 新增：FGI 情绪指数（带缓存）
  private async handleFGI(req: Request, res: Response): Promise<void> {
    try {
      const cacheKey = 'fgi-latest';
      const cached = fgiCache.get(cacheKey) as any;
      if (cached) {
        const response: ApiResponse = { success: true, data: cached, timestamp: Date.now() };
        res.json(response);
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const resp = await fetch('https://api.alternative.me/fng/?limit=1&format=json&date_format=cn', { signal: controller.signal });
      clearTimeout(timeout);

      if (!resp.ok) throw new Error(`FGI request failed: ${resp.status}`);
      const json: any = await resp.json();
      const item = Array.isArray(json?.data) && json.data.length > 0 ? json.data[0] : null;
      if (!item) throw new Error('FGI data empty');

      const valueNum = Number(item.value);
      const classification = (() => {
        if (Number.isNaN(valueNum)) return '未知';
        if (valueNum <= 25) return '极度恐惧';
        if (valueNum <= 45) return '恐惧';
        if (valueNum < 55) return '中性';
        if (valueNum <= 75) return '贪婪';
        return '极度贪婪';
      })();

      const normalized = {
        value: Number.isFinite(valueNum) ? valueNum : null,
        value_classification: classification,
        timestamp: Number(item.timestamp) * 1000 || Date.now(),
        time_until_update: Number((json as any)?.metadata?.time_until_update) || null,
        source: 'alternative.me'
      };

      if (normalized.value === null) throw new Error('FGI value invalid');

      fgiCache.set(cacheKey, normalized, 300);

      const response: ApiResponse = { success: true, data: normalized, timestamp: Date.now() };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to fetch FGI');
    }
  }

  private async handleLatestIndicators(req: Request, res: Response): Promise<void> {
    try {
      const symbol = (req.query.symbol as string) || config.trading.defaultSymbol;
      const interval = (req.query.interval as string) || '1H';
      const maxLimit = 200;
      const reqLimit = parseInt((req.query.limit as string) || '120', 10);
      const limit = Math.min(Math.max(reqLimit, 50), maxLimit);

      const klines = await enhancedOKXDataService.getKlineData(symbol, interval, limit);
      if (!Array.isArray(klines) || klines.length < 50) {
        res.status(400).json({
          success: false,
          error: `K线数据不足，当前=${klines?.length ?? 0}`,
          timestamp: Date.now()
        });
        return;
      }

      const tiAnalyzer = new TechnicalIndicatorAnalyzer();
      tiAnalyzer.updateKlineData(klines.map(k => ({
        timestamp: k.timestamp,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume
      })));
      const indicators = tiAnalyzer.calculateAllIndicators();

      const response: ApiResponse = {
        success: true,
        data: indicators ? {
          symbol,
          interval,
          rsi: indicators.rsi,
          macd: indicators.macd,
          bollinger: indicators.bollinger,
          atr: indicators.atr,
          ema12: indicators.ema12,
          ema26: indicators.ema26,
          emaTrend: indicators.emaTrend,
          sma20: indicators.sma20,
          kdj: indicators.kdj,
          williams: indicators.williams,
          volume: indicators.volume,
          timestamp: klines[klines.length - 1].timestamp
        } : null,
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to get latest indicators');
    }
  }

  private async handleRSISeries(req: Request, res: Response): Promise<void> {
    try {
      const symbol = (req.query.symbol as string) || config.trading.defaultSymbol;
      const interval = (req.query.interval as string) || '1H';
      const maxLimit = 500; // 安全上限，避免过大
      const minLimit = 50;
      const reqLimit = parseInt((req.query.limit as string) || '200', 10);
      const limit = Math.min(Math.max(reqLimit, minLimit), maxLimit);

      const klines = await enhancedOKXDataService.getKlineData(symbol, interval, limit);
      if (!Array.isArray(klines) || klines.length < 20) {
        res.status(400).json({
          success: false,
          error: `K线数据不足，当前=${klines?.length ?? 0}`,
          timestamp: Date.now()
        });
        return;
      }

      const closes = klines.map(k => k.close);
      const period = config.indicators?.rsi?.period || 14;
      const rsiValues = RSI.calculate({ values: closes, period });
      // 对齐时间戳：RSI从第 period-1 根开始有值
      const offset = closes.length - rsiValues.length;
      const series = rsiValues.map((v, idx) => ({
        timestamp: klines[idx + offset].timestamp,
        close: klines[idx + offset].close,
        rsi: v
      }));

      const response: ApiResponse = {
        success: true,
        data: {
          symbol,
          interval,
          period,
          closedOnly: config.indicators?.closedOnly ?? true,
          count: series.length,
          series
        },
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to get RSI series');
    }
  }

  // 新增：RSI 自动化比对校验（library vs custom）
  private async handleRSIValidate(req: Request, res: Response): Promise<void> {
    try {
      const symbol = (req.query.symbol as string) || config.trading.defaultSymbol;
      const interval = (req.query.interval as string) || '1H';
      const maxLimit = 500; // 安全上限
      const minLimit = 50;  // 校验建议至少50根
      const reqLimit = parseInt((req.query.limit as string) || '200', 10);
      const limit = Math.min(Math.max(reqLimit, minLimit), maxLimit);
      // 阈值参数（默认放宽以容纳浮点与显示精度差异）
      const tolRmse = parseFloat((req.query.tol_rmse as string) || '0.005');
      const tolMaxAbs = parseFloat((req.query.tol_max_abs as string) || '0.01');
      const tolCross = parseFloat((req.query.tol_cross as string) || '0.99');

      const klines = await enhancedOKXDataService.getKlineData(symbol, interval, limit);
      if (!Array.isArray(klines) || klines.length < minLimit) {
        res.status(400).json({ success: false, error: `K线数据不足，当前=${klines?.length ?? 0}`, timestamp: Date.now() });
        return;
      }

      const closes = klines.map(k => k.close);
      const period = config.indicators?.rsi?.period || 14;

      // 库计算
      const lib = RSI.calculate({ values: closes, period });
      const libOffset = closes.length - lib.length;

      // 自实现计算
      const custom = this.computeRSICustom(closes, period);

      // 对齐长度（尾部对齐）
      const n = Math.min(lib.length, custom.rsi.length);
      if (n <= 0) {
        res.status(500).json({ success: false, error: '无法对齐 RSI 序列进行校验', timestamp: Date.now() });
        return;
      }
      const libStart = lib.length - n;
      const cusStart = custom.rsi.length - n;
      const timeStartIdx = Math.max(libOffset + libStart, (closes.length - custom.rsi.length) + cusStart);

      let sumErr = 0, sumErr2 = 0, maxAbs = 0;
      const sample: any[] = [];
      for (let i = 0; i < n; i++) {
        const L = lib[libStart + i];
        const C = custom.rsi[cusStart + i];
        const err = (typeof L === 'number' ? L : 0) - (typeof C === 'number' ? C : 0);
        sumErr += err;
        sumErr2 += err * err;
        maxAbs = Math.max(maxAbs, Math.abs(err));
        if (i >= n - 3) {
          const tIdx = timeStartIdx + i;
          sample.push({ timestamp: klines[tIdx]?.timestamp, close: klines[tIdx]?.close, lib: L, custom: C, diff: err });
        }
      }

      const mae = Math.abs(sumErr) / n;
      const rmse = Math.sqrt(sumErr2 / n);

      // 交叉一致性（50线）
      const crossStats = (() => {
        const sign50 = (x: number) => (x > 50 ? 1 : (x < 50 ? -1 : 0));
        let matches = 0, total = 0;
        const len = n;
        for (let i = 1; i < len; i++) {
          const lPrev = lib[libStart + i - 1];
          const lCurr = lib[libStart + i];
          const cPrev = custom.rsi[cusStart + i - 1];
          const cCurr = custom.rsi[cusStart + i];
          const lCross = sign50(lPrev) !== sign50(lCurr);
          const cCross = sign50(cPrev) !== sign50(cCurr);
          if (lCross || cCross) {
            total++;
            if (lCross === cCross && sign50(lCurr) === sign50(cCurr)) matches++;
          }
        }
        return { cross_match: matches, cross_total: total, cross_ratio: total ? matches / total : 1 };
      })();

      const pass = (rmse <= tolRmse && maxAbs <= tolMaxAbs && crossStats.cross_ratio >= tolCross);

      res.json({
        success: true,
        data: {
          symbol,
          interval,
          period,
          count: n,
          thresholds: { tol_rmse: tolRmse, tol_max_abs: tolMaxAbs, tol_cross: tolCross },
          pass,
          error: { mae, rmse, max_abs: maxAbs },
          cross: crossStats,
          sample_last_3: sample
        },
        timestamp: Date.now()
      });
    } catch (error) {
      this.handleError(res, error, 'Failed to validate RSI');
    }
  }

  // 新增：自实现 RSI（Wilder 平滑），返回与 technicalindicators 对齐的裁剪结果
  private computeRSICustom(values: number[], period: number): { rsi: number[] } {
    if (!Array.isArray(values) || values.length < period + 1 || period <= 0) return { rsi: [] };
    const gains: number[] = [];
    const losses: number[] = [];
    for (let i = 1; i < values.length; i++) {
      const diff = values[i] - values[i - 1];
      gains.push(Math.max(0, diff));
      losses.push(Math.max(0, -diff));
    }

    // 初始均值（前 period 个变化值）
    let avgGain = 0, avgLoss = 0;
    for (let i = 0; i < period; i++) { avgGain += gains[i]; avgLoss += losses[i]; }
    avgGain /= period; avgLoss /= period;

    const rsi: number[] = [];
    // 第一个 RSI 对应 values 索引 period（与 technicalindicators 对齐）
    const rs1 = avgLoss === 0 ? Infinity : (avgGain / avgLoss);
    rsi.push(avgLoss === 0 ? 100 : (100 - 100 / (1 + rs1)));

    // 之后使用 Wilder 平滑
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      const rs = avgLoss === 0 ? Infinity : (avgGain / avgLoss);
      rsi.push(avgLoss === 0 ? 100 : (100 - 100 / (1 + rs)));
    }
    return { rsi };
  }

  // 新增：MACD 时间序列（用于核对1H策略MACD准确性）
  private async handleMACDSeries(req: Request, res: Response): Promise<void> {
    try {
      const symbol = (req.query.symbol as string) || config.trading.defaultSymbol;
      const interval = (req.query.interval as string) || '1H';
      const maxLimit = 500; // 安全上限
      const minLimit = 50;
      const reqLimit = parseInt((req.query.limit as string) || '200', 10);
      const limit = Math.min(Math.max(reqLimit, minLimit), maxLimit);

      const klines = await enhancedOKXDataService.getKlineData(symbol, interval, limit);
      if (!Array.isArray(klines) || klines.length < 20) {
        res.status(400).json({
          success: false,
          error: `K线数据不足，当前=${klines?.length ?? 0}`,
          timestamp: Date.now()
        });
        return;
      }

      const closes = klines.map(k => k.close);
      const { fastPeriod, slowPeriod, signalPeriod } = config.indicators.macd || { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 };
      const macdValues = MACD.calculate({
        values: closes,
        fastPeriod: fastPeriod || 12,
        slowPeriod: slowPeriod || 26,
        signalPeriod: signalPeriod || 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
      });

      const offset = closes.length - macdValues.length;
      const series = macdValues.map((v, idx) => ({
        timestamp: klines[idx + offset].timestamp,
        close: klines[idx + offset].close,
        macd: v.MACD,
        signal: v.signal,
        histogram: v.histogram
      }));

      const response: ApiResponse = {
        success: true,
        data: {
          symbol,
          interval,
          fastPeriod: fastPeriod || 12,
          slowPeriod: slowPeriod || 26,
          signalPeriod: signalPeriod || 9,
          closedOnly: config.indicators?.closedOnly ?? true,
          count: series.length,
          series
        },
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to get MACD series');
    }
  }

  // 内部：计算 EMA（用于自实现 MACD 校验）
  private computeEMA(values: number[], period: number): number[] {
    if (period <= 0 || values.length < period) return [];
    const k = 2 / (period + 1);
    const ema: number[] = new Array(values.length);
    // 初始值：用前 period 数据的简单均值作为 seed
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    ema[period - 1] = sum / period;
    for (let i = period; i < values.length; i++) {
      ema[i] = values[i] * k + ema[i - 1] * (1 - k);
    }
    // 将前 period-1 置为 NaN 以便后续对齐裁剪
    for (let i = 0; i < period - 1; i++) ema[i] = NaN;
    return ema;
  }

  // 内部：自实现 MACD（EMA12-EMA26 与 signal9），返回与 technicalindicators 对齐的裁剪结果
  private computeMACDCustom(values: number[], fast: number, slow: number, signal: number): { macd: number[]; signal: number[]; histogram: number[]; offset: number } {
    const emaFast = this.computeEMA(values, fast);
    const emaSlow = this.computeEMA(values, slow);
    const macdRaw: number[] = values.map((_, i) => {
      const f = emaFast[i];
      const s = emaSlow[i];
      return (typeof f === 'number' && !Number.isNaN(f) && typeof s === 'number' && !Number.isNaN(s)) ? (f - s) : NaN;
    });
    // 计算 signal EMA（对 macdRaw 里的有效段）
    const macdClean = macdRaw.filter(v => typeof v === 'number' && !Number.isNaN(v));
    if (macdClean.length < signal) return { macd: [], signal: [], histogram: [], offset: 0 };

    const sigStart = macdRaw.findIndex(v => typeof v === 'number' && !Number.isNaN(v));
    const sigEmaFull = this.computeEMA(macdClean, signal);

    // 对齐为和 technicalindicators 一致的末端长度：从 signal EMA 首个有效值开始
    const firstSigIdxInClean = sigEmaFull.findIndex(v => typeof v === 'number' && !Number.isNaN(v));
    const alignedMacd = macdClean.slice(firstSigIdxInClean);
    const alignedSignal = sigEmaFull.slice(firstSigIdxInClean);

    // 还原到原始索引（时间戳对齐）：macd 有效开始于 slow-1，signal 再往后 signal-1
    const offset = sigStart + firstSigIdxInClean;
    const macdOut: number[] = [];
    const signalOut: number[] = [];
    const histOut: number[] = [];
    for (let i = 0; i < alignedMacd.length; i++) {
      const m = alignedMacd[i];
      const s = alignedSignal[i];
      macdOut.push(m);
      signalOut.push(s);
      histOut.push(m - s);
    }
    return { macd: macdOut, signal: signalOut, histogram: histOut, offset };
  }

  // 新增：MACD 自动化比对校验（library vs custom）
  private async handleMACDValidate(req: Request, res: Response): Promise<void> {
    try {
      const symbol = (req.query.symbol as string) || config.trading.defaultSymbol;
      const interval = (req.query.interval as string) || '1H';
      const maxLimit = 500;
      const minLimit = 100; // 校验建议至少100根
      const reqLimit = parseInt((req.query.limit as string) || '300', 10);
      const limit = Math.min(Math.max(reqLimit, minLimit), maxLimit);
      // 阈值参数（默认极小，主要过滤数值误差；cross 默认 0.99）
      const tolRmse = parseFloat((req.query.tol_rmse as string) || '1e-6');
      const tolMaxAbs = parseFloat((req.query.tol_max_abs as string) || '1e-6');
      const tolCross = parseFloat((req.query.tol_cross as string) || '0.99');

      const klines = await enhancedOKXDataService.getKlineData(symbol, interval, limit);
      if (!Array.isArray(klines) || klines.length < 50) {
        res.status(400).json({ success: false, error: `K线数据不足，当前=${klines?.length ?? 0}`, timestamp: Date.now() });
        return;
      }

      const closes = klines.map(k => k.close);
      const { fastPeriod, slowPeriod, signalPeriod } = config.indicators.macd || { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 };

      // 库计算
      const lib = MACD.calculate({
        values: closes,
        fastPeriod: fastPeriod || 12,
        slowPeriod: slowPeriod || 26,
        signalPeriod: signalPeriod || 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
      });
      const libOffset = closes.length - lib.length;

      // 自实现计算
      const custom = this.computeMACDCustom(closes, fastPeriod || 12, slowPeriod || 26, signalPeriod || 9);

      // 取对齐长度
      const n = Math.min(lib.length, custom.macd.length);
      if (n <= 0) {
        res.status(500).json({ success: false, error: '无法对齐 MACD 序列进行校验', timestamp: Date.now() });
        return;
      }

      // 对齐索引：尾部对齐
      const libStart = lib.length - n;
      const cusStart = custom.macd.length - n;
      const timeStartIdx = Math.max(libOffset + libStart, (custom.offset ?? 0) + cusStart);
      const series: any[] = [];

      let sumMacdErr = 0, sumSigErr = 0, sumHistErr = 0;
      let sumMacdErr2 = 0, sumSigErr2 = 0, sumHistErr2 = 0;
      let maxMacdAbs = 0, maxSigAbs = 0, maxHistAbs = 0;

      for (let i = 0; i < n; i++) {
        const L = lib[libStart + i] as any;
        const C = {
          MACD: custom.macd[cusStart + i],
          signal: custom.signal[cusStart + i],
          histogram: custom.histogram[cusStart + i]
        };
        const tIdx = timeStartIdx + i;
        const t = klines[tIdx]?.timestamp;
        const close = klines[tIdx]?.close;

        const lMACD = (L && typeof L.MACD === 'number') ? L.MACD : 0;
        const lSignal = (L && typeof L.signal === 'number') ? L.signal : 0;
        const lHist = (L && typeof L.histogram === 'number') ? L.histogram : (lMACD - lSignal);
        const cMACD = typeof C.MACD === 'number' ? C.MACD : 0;
        const cSignal = typeof C.signal === 'number' ? C.signal : 0;
        const cHist = typeof C.histogram === 'number' ? C.histogram : (cMACD - cSignal);

        const macdErr = lMACD - cMACD;
        const sigErr = lSignal - cSignal;
        const histErr = lHist - cHist;

        sumMacdErr += macdErr; sumSigErr += sigErr; sumHistErr += histErr;
        sumMacdErr2 += macdErr * macdErr; sumSigErr2 += sigErr * sigErr; sumHistErr2 += histErr * histErr;

        maxMacdAbs = Math.max(maxMacdAbs, Math.abs(macdErr));
        maxSigAbs = Math.max(maxSigAbs, Math.abs(sigErr));
        maxHistAbs = Math.max(maxHistAbs, Math.abs(histErr));

        // 仅采集最后3条样本
        if (i >= n - 3) {
          series.push({ timestamp: t, close, lib: L, custom: C, diff: { macd: macdErr, signal: sigErr, histogram: histErr } });
        }
      }

      const mae = {
        macd: Math.abs(sumMacdErr) / n,
        signal: Math.abs(sumSigErr) / n,
        histogram: Math.abs(sumHistErr) / n
      };
      const rmse = {
        macd: Math.sqrt(sumMacdErr2 / n),
        signal: Math.sqrt(sumSigErr2 / n),
        histogram: Math.sqrt(sumHistErr2 / n)
      };

      // 交叉一致性
      const sign = (x: number) => (x > 0 ? 1 : (x < 0 ? -1 : 0));
      const crossStats = (() => {
        const len = n;
        let matches = 0, total = 0;
        let libs: number[] = [], cus: number[] = [];
        for (let i = 1; i < len; i++) {
          const lPrev = (typeof lib[libStart + i - 1]?.MACD === 'number' && typeof lib[libStart + i - 1]?.signal === 'number')
                   ? ((lib[libStart + i - 1] as any).MACD - (lib[libStart + i - 1] as any).signal) : 0;
          const lCurr = (typeof lib[libStart + i]?.MACD === 'number' && typeof lib[libStart + i]?.signal === 'number')
                   ? ((lib[libStart + i] as any).MACD - (lib[libStart + i] as any).signal) : 0;
          const cPrev = (typeof custom.macd[cusStart + i - 1] === 'number' && typeof custom.signal[cusStart + i - 1] === 'number')
            ? (custom.macd[cusStart + i - 1] - custom.signal[cusStart + i - 1]) : 0;
          const cCurr = (typeof custom.macd[cusStart + i] === 'number' && typeof custom.signal[cusStart + i] === 'number')
            ? (custom.macd[cusStart + i] - custom.signal[cusStart + i]) : 0;
          const lCross = sign(lPrev) !== sign(lCurr);
          const cCross = sign(cPrev) !== sign(cCurr);
          if (lCross || cCross) {
            total++;
            if (lCross === cCross && sign(lCurr) === sign(cCurr)) matches++;
          }
          libs.push(lCurr); cus.push(cCurr);
        }
        // 相关性（皮尔逊）
        const mL = libs.reduce((a,b)=>a+b,0)/libs.length;
        const mC = cus.reduce((a,b)=>a+b,0)/cus.length;
        let cov=0, vL=0, vC=0;
        for (let i=0;i<libs.length;i++){ const dl=libs[i]-mL; const dc=cus[i]-mC; cov+=dl*dc; vL+=dl*dl; vC+=dc*dc; }
        const corr = (vL>0 && vC>0) ? (cov/Math.sqrt(vL*vC)) : 0;
        return { cross_match: matches, cross_total: total, cross_ratio: total? matches/total: 1, corr };
      })();

      const pass = (
        rmse.macd <= tolRmse && rmse.signal <= tolRmse && rmse.histogram <= tolRmse &&
        maxMacdAbs <= tolMaxAbs && maxSigAbs <= tolMaxAbs && maxHistAbs <= tolMaxAbs &&
        crossStats.cross_ratio >= tolCross
      );

      const response: ApiResponse = {
        success: true,
        data: {
          symbol,
          interval,
          fastPeriod: fastPeriod || 12,
          slowPeriod: slowPeriod || 26,
          signalPeriod: signalPeriod || 9,
          count: n,
          thresholds: { tol_rmse: tolRmse, tol_max_abs: tolMaxAbs, tol_cross: tolCross },
          pass,
          error: {
            mae, rmse,
            max_abs: { macd: maxMacdAbs, signal: maxSigAbs, histogram: maxHistAbs }
          },
          cross: crossStats,
          sample_last_5: series
        },
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to validate MACD');
    }
  }

  private async handleMACDValidateBatch(req: Request, res: Response): Promise<void> {
    try {
      const defaultSymbols = [config.trading.defaultSymbol];
      const symbolsParam = (req.query.symbols as string) || (req.query.symbol as string) || defaultSymbols.join(',');
      const symbols = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);

      const defaultIntervals = (Array.isArray(config.trading.intervals) && config.trading.intervals.length)
        ? config.trading.intervals as string[]
        : ['1H'];
      const intervalsParam = (req.query.intervals as string) || (req.query.interval as string) || defaultIntervals.join(',');
      const intervals = intervalsParam.split(',').map(i => i.trim()).filter(Boolean);

      const maxLimit = 500;
      const minLimit = 100; // 批量校验建议至少100根
      const reqLimit = parseInt((req.query.limit as string) || '300', 10);
      const limit = Math.min(Math.max(reqLimit, minLimit), maxLimit);

      // 阈值参数（默认极小，主要过滤数值误差；cross 默认 0.99）
      const tolRmse = parseFloat((req.query.tol_rmse as string) || '1e-6');
      const tolMaxAbs = parseFloat((req.query.tol_max_abs as string) || '1e-6');
      const tolCross = parseFloat((req.query.tol_cross as string) || '0.99');

      const { fastPeriod, slowPeriod, signalPeriod } = config.indicators.macd || { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 };

      const results: any[] = [];

      const sign = (x: number) => (x > 0 ? 1 : (x < 0 ? -1 : 0));

      for (const symbol of symbols) {
        for (const interval of intervals) {
          try {
            const klines = await enhancedOKXDataService.getKlineData(symbol, interval, limit);
            if (!Array.isArray(klines) || klines.length < 50) {
              results.push({ symbol, interval, success: false, error: `K线数据不足，当前=${klines?.length ?? 0}` });
              continue;
            }

            const closes = klines.map(k => k.close);

            // 库计算
            const lib = MACD.calculate({
              values: closes,
              fastPeriod: fastPeriod || 12,
              slowPeriod: slowPeriod || 26,
              signalPeriod: signalPeriod || 9,
              SimpleMAOscillator: false,
              SimpleMASignal: false
            });
            const libOffset = closes.length - lib.length;

            // 自实现计算
            const custom = this.computeMACDCustom(closes, fastPeriod || 12, slowPeriod || 26, signalPeriod || 9);

            // 取对齐长度
            const n = Math.min(lib.length, custom.macd.length);
            if (n <= 0) {
              results.push({ symbol, interval, success: false, error: '无法对齐 MACD 序列进行校验' });
              continue;
            }

            // 对齐索引：尾部对齐
            const libStart = lib.length - n;
            const cusStart = custom.macd.length - n;
            const timeStartIdx = Math.max(libOffset + libStart, (custom.offset ?? 0) + cusStart);

            let sumMacdErr = 0, sumSigErr = 0, sumHistErr = 0;
            let sumMacdErr2 = 0, sumSigErr2 = 0, sumHistErr2 = 0;
            let maxMacdAbs = 0, maxSigAbs = 0, maxHistAbs = 0;

            const sample: any[] = [];

            for (let i = 0; i < n; i++) {
              const L = lib[libStart + i] as any;
              const C = {
                MACD: custom.macd[cusStart + i],
                signal: custom.signal[cusStart + i],
                histogram: custom.histogram[cusStart + i]
              };
              const tIdx = timeStartIdx + i;
              const t = klines[tIdx]?.timestamp;
              const close = klines[tIdx]?.close;

              const macdErr = L.MACD - C.MACD;
              const sigErr = L.signal - C.signal;
              const histErr = L.histogram - C.histogram;

              sumMacdErr += macdErr; sumSigErr += sigErr; sumHistErr += histErr;
              sumMacdErr2 += macdErr * macdErr; sumSigErr2 += sigErr * sigErr; sumHistErr2 += histErr * histErr;

              maxMacdAbs = Math.max(maxMacdAbs, Math.abs(macdErr));
              maxSigAbs = Math.max(maxSigAbs, Math.abs(sigErr));
              maxHistAbs = Math.max(maxHistAbs, Math.abs(histErr));

              // 仅采集最后3条样本
              if (i >= n - 3) {
                sample.push({ timestamp: t, close, lib: L, custom: C, diff: { macd: macdErr, signal: sigErr, histogram: histErr } });
              }
            }

            const mae = {
              macd: sumMacdErr / n,
              signal: sumSigErr / n,
              histogram: sumHistErr / n
            };
            const rmse = {
              macd: Math.sqrt(sumMacdErr2 / n),
              signal: Math.sqrt(sumSigErr2 / n),
              histogram: Math.sqrt(sumHistErr2 / n)
            };

            // 交叉一致性与相关性
            const crossStats = (() => {
              const len = n;
              let matches = 0, total = 0;
              let libs: number[] = [], cus: number[] = [];
              for (let i = 1; i < len; i++) {
                const lPrev = (typeof lib[libStart + i - 1]?.MACD === 'number' && typeof lib[libStart + i - 1]?.signal === 'number')
                  ? ((lib[libStart + i - 1] as any).MACD - (lib[libStart + i - 1] as any).signal) : 0;
                const lCurr = (typeof lib[libStart + i]?.MACD === 'number' && typeof lib[libStart + i]?.signal === 'number')
                  ? ((lib[libStart + i] as any).MACD - (lib[libStart + i] as any).signal) : 0;
                const cPrev = custom.macd[cusStart + i - 1] - custom.signal[cusStart + i - 1];
                const cCurr = custom.macd[cusStart + i] - custom.signal[cusStart + i];
                const lCross = sign(lPrev) !== sign(lCurr);
                const cCross = sign(cPrev) !== sign(cCurr);
                if (lCross || cCross) {
                  total++;
                  if (lCross === cCross && sign(lCurr) === sign(cCurr)) matches++;
                }
                libs.push(lCurr); cus.push(cCurr);
              }
              const mL = libs.reduce((a,b)=>a+b,0)/libs.length;
              const mC = cus.reduce((a,b)=>a+b,0)/cus.length;
              let cov=0, vL=0, vC=0;
              for (let i=0;i<libs.length;i++){ const dl=libs[i]-mL; const dc=cus[i]-mC; cov+=dl*dc; vL+=dl*dl; vC+=dc*dc; }
              const corr = (vL>0 && vC>0) ? (cov/Math.sqrt(vL*vC)) : 0;
              return { cross_match: matches, cross_total: total, cross_ratio: total? matches/total: 1, corr };
            })();

            const pass = (
              rmse.macd <= tolRmse && rmse.signal <= tolRmse && rmse.histogram <= tolRmse &&
              maxMacdAbs <= tolMaxAbs && maxSigAbs <= tolMaxAbs && maxHistAbs <= tolMaxAbs &&
              crossStats.cross_ratio >= tolCross
            );

            results.push({
              success: true,
              symbol,
              interval,
              fastPeriod: fastPeriod || 12,
              slowPeriod: slowPeriod || 26,
              signalPeriod: signalPeriod || 9,
              count: n,
              thresholds: { tol_rmse: tolRmse, tol_max_abs: tolMaxAbs, tol_cross: tolCross },
              pass,
              error: {
                mae, rmse,
                max_abs: { macd: maxMacdAbs, signal: maxSigAbs, histogram: maxHistAbs }
              },
              cross: crossStats,
              sample_last_3: sample
            });
          } catch (innerErr: any) {
            results.push({ symbol, interval, success: false, error: innerErr?.message || String(innerErr) });
          }
        }
      }

      const passed = results.filter(r => r.success && r.pass === true).length;
      const failed = results.filter(r => !r.success || r.pass === false).length;

      // 汇总统计
      const succ = results.filter(r => r.success === true && typeof r.error?.rmse?.macd === 'number');
      const mean = (arr: number[]) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
      const percentile = (arr: number[], p: number) => {
        if (!arr.length) return 0;
        const s = [...arr].sort((a,b)=>a-b);
        const idx = Math.min(s.length - 1, Math.max(0, Math.floor((p/100)*(s.length - 1))));
        return s[idx];
      };

      const arrs = {
        rmse: {
          macd: succ.map((r:any)=>r.error.rmse.macd),
          signal: succ.map((r:any)=>r.error.rmse.signal),
          histogram: succ.map((r:any)=>r.error.rmse.histogram)
        },
        max_abs: {
          macd: succ.map((r:any)=>r.error.max_abs.macd),
          signal: succ.map((r:any)=>r.error.max_abs.signal),
          histogram: succ.map((r:any)=>r.error.max_abs.histogram)
        },
        cross_ratio: succ.map((r:any)=>r.cross?.cross_ratio ?? 0),
        corr: succ.map((r:any)=>r.cross?.corr ?? 0)
      } as const;

      const summary = {
        pass_rate: results.length ? passed / results.length : 0,
        rmse: {
          macd: { mean: mean(arrs.rmse.macd), p90: percentile(arrs.rmse.macd, 90), max: Math.max(0, ...arrs.rmse.macd) },
          signal: { mean: mean(arrs.rmse.signal), p90: percentile(arrs.rmse.signal, 90), max: Math.max(0, ...arrs.rmse.signal) },
          histogram: { mean: mean(arrs.rmse.histogram), p90: percentile(arrs.rmse.histogram, 90), max: Math.max(0, ...arrs.rmse.histogram) }
        },
        max_abs: {
          macd: { mean: mean(arrs.max_abs.macd), p90: percentile(arrs.max_abs.macd, 90), max: Math.max(0, ...arrs.max_abs.macd) },
          signal: { mean: mean(arrs.max_abs.signal), p90: percentile(arrs.max_abs.signal, 90), max: Math.max(0, ...arrs.max_abs.signal) },
          histogram: { mean: mean(arrs.max_abs.histogram), p90: percentile(arrs.max_abs.histogram, 90), max: Math.max(0, ...arrs.max_abs.histogram) }
        },
        cross: {
          overall_cross_ratio: (()=>{
            const sumMatch = succ.reduce((acc:number,r:any)=> acc + (r.cross?.cross_match ?? 0), 0);
            const sumTotal = succ.reduce((acc:number,r:any)=> acc + (r.cross?.cross_total ?? 0), 0);
            return sumTotal ? (sumMatch / sumTotal) : 1;
          })(),
          mean_cross_ratio: mean(arrs.cross_ratio),
          mean_corr: mean(arrs.corr)
        }
      };

      const data = { total: results.length, passed, failed, summary, results } as any;

      // 可选：导出报告
      const exportCfg = (req.body || {}).export;
      const exportInfo: { jsonPath?: string; csvPath?: string; error?: string } = {};
      if (exportCfg && (exportCfg.enable === true || exportCfg.enable === 'true')) {
        try {
          const outDir = (exportCfg.dir && typeof exportCfg.dir === 'string') ? exportCfg.dir : path.join(process.cwd(), 'logs', 'reports');
          if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
          const fmt = (exportCfg.format === 'csv' || exportCfg.format === 'both') ? exportCfg.format : 'json';
          const prefix = (typeof exportCfg.filename === 'string' && exportCfg.filename.trim()) ? exportCfg.filename.trim() : 'macd_offline_batch';
          const now = new Date();
          const pad = (n:number)=> String(n).padStart(2,'0');
          const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

          // JSON
          if (fmt === 'json' || fmt === 'both') {
            const jsonPath = path.join(outDir, `${prefix}_${ts}.json`);
            const responseForSave = { success: true, data, timestamp: Date.now() };
            fs.writeFileSync(jsonPath, JSON.stringify(responseForSave, null, 2));
            exportInfo.jsonPath = jsonPath;
          }

          // CSV（逐项汇总）
          if (fmt === 'csv' || fmt === 'both') {
            const csvPath = path.join(outDir, `${prefix}_${ts}.csv`);
            const header = [
              'label','pass','count',
              'rmse_macd','rmse_signal','rmse_histogram',
              'maxabs_macd','maxabs_signal','maxabs_histogram',
              'cross_ratio','corr'
            ].join(',');
            const toCsvVal = (v:any)=> (typeof v === 'number' ? v : (v===undefined||v===null?'':String(v).replace(/"/g,'""')));
            const lines = [header, ...results.map((r:any)=>{
              if (!r.success) return [r.label, false, '', '', '', '', '', '', '', '', ''].join(',');
              return [
                r.label ?? '',
                r.pass,
                r.count,
                r.error?.rmse?.macd,
                r.error?.rmse?.signal,
                r.error?.rmse?.histogram,
                r.error?.max_abs?.macd,
                r.error?.max_abs?.signal,
                r.error?.max_abs?.histogram,
                r.cross?.cross_ratio,
                r.cross?.corr
              ].map(toCsvVal).join(',');
            })];
            fs.writeFileSync(csvPath, lines.join('\n'));
            exportInfo.csvPath = csvPath;
          }
        } catch (ex: any) {
          exportInfo.error = ex?.message || String(ex);
          console.warn('Export report failed:', ex);
        }
      }

      const response: ApiResponse = {
        success: true,
        data: { ...data, export: exportInfo },
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to validate MACD batch');
    }
  }

  // 新增：MACD 离线快照校验（对历史K线快照进行校验）
  private async handleMACDValidateOffline(req: Request, res: Response): Promise<void> {
    try {
      const { candles, fastPeriod: fp, slowPeriod: sp, signalPeriod: sgp, tol_rmse, tol_max_abs, tol_cross } = req.body || {};
      if (!Array.isArray(candles) || candles.length < 50) {
        res.status(400).json({ success: false, error: 'invalid candles: require >=50 items', timestamp: Date.now() });
        return;
      }
  
      // candles 支持两种格式：
      // 1) 数字数组（close 列表） 2) 对象数组（含 close 与 timestamp）
      const closes: number[] = candles.map((c: any) => typeof c === 'number' ? c : c?.close).filter((v: any) => typeof v === 'number');
      if (closes.length < 50) {
        res.status(400).json({ success: false, error: 'invalid candles: close list too short', timestamp: Date.now() });
        return;
      }
  
      const timestamps: number[] | undefined = (typeof candles[0] === 'object') ? candles.map((c: any) => c?.timestamp).filter((t: any) => typeof t === 'number') : undefined;
  
      const fastPeriod = Number.isFinite(fp) ? Number(fp) : (config.indicators.macd?.fastPeriod ?? 12);
      const slowPeriod = Number.isFinite(sp) ? Number(sp) : (config.indicators.macd?.slowPeriod ?? 26);
      const signalPeriod = Number.isFinite(sgp) ? Number(sgp) : (config.indicators.macd?.signalPeriod ?? 9);
  
      const tolRmse = Number.isFinite(tol_rmse) ? Number(tol_rmse) : 1e-6;
      const tolMaxAbs = Number.isFinite(tol_max_abs) ? Number(tol_max_abs) : 1e-6;
      const tolCross = Number.isFinite(tol_cross) ? Number(tol_cross) : 0.99;
  
      // 库计算
      const lib = MACD.calculate({
        values: closes,
        fastPeriod,
        slowPeriod,
        signalPeriod,
        SimpleMAOscillator: false,
        SimpleMASignal: false
      });
      const libOffset = closes.length - lib.length;
  
      // 自实现
      const custom = this.computeMACDCustom(closes, fastPeriod, slowPeriod, signalPeriod);
  
      // 取对齐长度
      const n = Math.min(lib.length, custom.macd.length);
      if (n <= 0) {
        res.status(500).json({ success: false, error: '无法对齐 MACD 序列进行校验', timestamp: Date.now() });
        return;
      }
  
      const libStart = lib.length - n;
      const cusStart = custom.macd.length - n;
      const timeStartIdx = Math.max(libOffset + libStart, (custom.offset ?? 0) + cusStart);
  
      let sumMacdErr = 0, sumSigErr = 0, sumHistErr = 0;
      let sumMacdErr2 = 0, sumSigErr2 = 0, sumHistErr2 = 0;
      let maxMacdAbs = 0, maxSigAbs = 0, maxHistAbs = 0;
  
      const sample: any[] = [];
      const sign = (x: number) => (x > 0 ? 1 : (x < 0 ? -1 : 0));
  
      for (let i = 0; i < n; i++) {
        const L = lib[libStart + i] as any;
        const C = {
          MACD: custom.macd[cusStart + i],
          signal: custom.signal[cusStart + i],
          histogram: custom.histogram[cusStart + i]
        };
        const tIdx = timeStartIdx + i;
        const t = timestamps ? timestamps[tIdx] : undefined;
        const close = closes[tIdx];
  
        const macdErr = L.MACD - C.MACD;
        const sigErr = L.signal - C.signal;
        const histErr = L.histogram - C.histogram;
  
        sumMacdErr += macdErr; sumSigErr += sigErr; sumHistErr += histErr;
        sumMacdErr2 += macdErr * macdErr; sumSigErr2 += sigErr * sigErr; sumHistErr2 += histErr * histErr;
  
        maxMacdAbs = Math.max(maxMacdAbs, Math.abs(macdErr));
        maxSigAbs = Math.max(maxSigAbs, Math.abs(sigErr));
        maxHistAbs = Math.max(maxHistAbs, Math.abs(histErr));
  
        if (i >= n - 3) {
          sample.push({ timestamp: t, close, lib: L, custom: C, diff: { macd: macdErr, signal: sigErr, histogram: histErr } });
        }
      }
  
      const mae = {
        macd: Math.abs(sumMacdErr) / n,
        signal: Math.abs(sumSigErr) / n,
        histogram: Math.abs(sumHistErr) / n
      };
      const rmse = {
        macd: Math.sqrt(sumMacdErr2 / n),
        signal: Math.sqrt(sumSigErr2 / n),
        histogram: Math.sqrt(sumHistErr2 / n)
      };
  
      const crossStats = (() => {
        const len = n;
        let matches = 0, total = 0;
        let libs: number[] = [], cus: number[] = [];
        for (let i = 1; i < len; i++) {
          const lPrev = (typeof lib[libStart + i - 1]?.MACD === 'number' && typeof lib[libStart + i - 1]?.signal === 'number')
              ? ((lib[libStart + i - 1] as any).MACD - (lib[libStart + i - 1] as any).signal) : 0;
            const lCurr = (typeof lib[libStart + i]?.MACD === 'number' && typeof lib[libStart + i]?.signal === 'number')
              ? ((lib[libStart + i] as any).MACD - (lib[libStart + i] as any).signal) : 0;
          const cPrev = (typeof custom.macd[cusStart + i - 1] === 'number' && typeof custom.signal[cusStart + i - 1] === 'number')
            ? (custom.macd[cusStart + i - 1] - custom.signal[cusStart + i - 1]) : 0;
          const cCurr = (typeof custom.macd[cusStart + i] === 'number' && typeof custom.signal[cusStart + i] === 'number')
            ? (custom.macd[cusStart + i] - custom.signal[cusStart + i]) : 0;
          const lCross = sign(lPrev) !== sign(lCurr);
          const cCross = sign(cPrev) !== sign(cCurr);
          if (lCross || cCross) {
            total++;
            if (lCross === cCross && sign(lCurr) === sign(cCurr)) matches++;
          }
          libs.push(lCurr); cus.push(cCurr);
        }
        const mL = libs.reduce((a,b)=>a+b,0)/libs.length;
        const mC = cus.reduce((a,b)=>a+b,0)/cus.length;
        let cov=0, vL=0, vC=0;
        for (let i=0;i<libs.length;i++){ const dl=libs[i]-mL; const dc=cus[i]-mC; cov+=dl*dc; vL+=dl*dl; vC+=dc*dc; }
        const corr = (vL>0 && vC>0) ? (cov/Math.sqrt(vL*vC)) : 0;
        return { cross_match: matches, cross_total: total, cross_ratio: total? matches/total: 1, corr };
      })();
  
      const pass = (
        rmse.macd <= tolRmse && rmse.signal <= tolRmse && rmse.histogram <= tolRmse &&
        maxMacdAbs <= tolMaxAbs && maxSigAbs <= tolMaxAbs && maxHistAbs <= tolMaxAbs &&
        crossStats.cross_ratio >= tolCross
      );
  
      const response: ApiResponse = {
        success: true,
        data: {
          count: n,
          fastPeriod,
          slowPeriod,
          signalPeriod,
          thresholds: { tol_rmse: tolRmse, tol_max_abs: tolMaxAbs, tol_cross: tolCross },
          pass,
          error: {
            mae, rmse,
            max_abs: { macd: maxMacdAbs, signal: maxSigAbs, histogram: maxHistAbs }
          },
          cross: crossStats,
          sample_last_3: sample
        },
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error: any) {
      console.error('Offline MACD validation failed:', error);
      res.status(500).json({
        success: false,
        error: error?.message || 'Failed to validate MACD offline',
        details: (process.env.NODE_ENV !== 'production') ? String(error?.stack || error) : undefined,
        timestamp: Date.now()
      });
    }
  }

  // 新增：MACD 离线快照批量校验（对多个历史K线快照进行批量校验）
  private async handleMACDValidateOfflineBatch(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body || {};
      const items = Array.isArray(body.items) ? body.items : [];

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ success: false, error: 'invalid items: require non-empty array', timestamp: Date.now() });
        return;
      }

      // 顶层默认参数（可被每个项覆盖）
      const defaultFast = Number.isFinite(body.fastPeriod) ? Number(body.fastPeriod) : (config.indicators.macd?.fastPeriod ?? 12);
      const defaultSlow = Number.isFinite(body.slowPeriod) ? Number(body.slowPeriod) : (config.indicators.macd?.slowPeriod ?? 26);
      const defaultSig = Number.isFinite(body.signalPeriod) ? Number(body.signalPeriod) : (config.indicators.macd?.signalPeriod ?? 9);
      const defaultTolRmse = Number.isFinite(body.tol_rmse) ? Number(body.tol_rmse) : 1e-6;
      const defaultTolMaxAbs = Number.isFinite(body.tol_max_abs) ? Number(body.tol_max_abs) : 1e-6;
      const defaultTolCross = Number.isFinite(body.tol_cross) ? Number(body.tol_cross) : 0.99;

      const results: any[] = [];

      for (const it of items) {
        const label = it?.label;
        const candles = it?.candles;

        if (!Array.isArray(candles) || candles.length < 50) {
          results.push({ label, success: false, error: 'invalid candles: require >=50 items' });
          continue;
        }

        // 每项参数覆盖
        const fastPeriod = Number.isFinite(it.fastPeriod) ? Number(it.fastPeriod) : defaultFast;
        const slowPeriod = Number.isFinite(it.slowPeriod) ? Number(it.slowPeriod) : defaultSlow;
        const signalPeriod = Number.isFinite(it.signalPeriod) ? Number(it.signalPeriod) : defaultSig;
        const tolRmse = Number.isFinite(it.tol_rmse) ? Number(it.tol_rmse) : defaultTolRmse;
        const tolMaxAbs = Number.isFinite(it.tol_max_abs) ? Number(it.tol_max_abs) : defaultTolMaxAbs;
        const tolCross = Number.isFinite(it.tol_cross) ? Number(it.tol_cross) : defaultTolCross;

        try {
          const closes: number[] = candles.map((c: any) => typeof c === 'number' ? c : c?.close).filter((v: any) => typeof v === 'number');
          if (closes.length < 50) {
            results.push({ label, success: false, error: 'invalid candles: close list too short' });
            continue;
          }

          const timestamps: number[] | undefined = (typeof candles[0] === 'object') ? candles.map((c: any) => c?.timestamp).filter((t: any) => typeof t === 'number') : undefined;

          // 库计算
          const lib = MACD.calculate({
            values: closes,
            fastPeriod,
            slowPeriod,
            signalPeriod,
            SimpleMAOscillator: false,
            SimpleMASignal: false
          });
          const libOffset = closes.length - lib.length;

          // 自实现
          const custom = this.computeMACDCustom(closes, fastPeriod, slowPeriod, signalPeriod);

          // 对齐
          const n = Math.min(lib.length, custom.macd.length);
          if (n <= 0) {
            results.push({ label, success: false, error: '无法对齐 MACD 序列进行校验' });
            continue;
          }

          const libStart = lib.length - n;
          const cusStart = custom.macd.length - n;
          const timeStartIdx = Math.max(libOffset + libStart, (custom.offset ?? 0) + cusStart);

          let sumMacdErr = 0, sumSigErr = 0, sumHistErr = 0;
          let sumMacdErr2 = 0, sumSigErr2 = 0, sumHistErr2 = 0;
          let maxMacdAbs = 0, maxSigAbs = 0, maxHistAbs = 0;

          const sample: any[] = [];
          const sign = (x: number) => (x > 0 ? 1 : (x < 0 ? -1 : 0));
          const topKLocal = Number.isFinite(it.top_k) ? Math.max(0, Math.floor(it.top_k)) : (Number.isFinite(body.top_k) ? Math.max(0, Math.floor(body.top_k)) : 0);
          const tops: any[] = [];
          const considerTop = (cand: any) => {
            if (!topKLocal || topKLocal <= 0) return;
            if (tops.length < topKLocal) {
              tops.push(cand);
            } else {
              let minIdx = 0;
              for (let j = 1; j < tops.length; j++) if (tops[j].score < tops[minIdx].score) minIdx = j;
              if (cand.score > tops[minIdx].score) tops[minIdx] = cand;
            }
          };

          for (let i = 0; i < n; i++) {
            const L = lib[libStart + i] as any;
            const C = {
              MACD: custom.macd[cusStart + i],
              signal: custom.signal[cusStart + i],
              histogram: custom.histogram[cusStart + i]
            };
            const tIdx = timeStartIdx + i;
            const t = timestamps ? timestamps[tIdx] : undefined;
            const close = closes[tIdx];

            const macdErr = L.MACD - C.MACD;
            const sigErr = L.signal - C.signal;
            const histErr = L.histogram - C.histogram;

            const score = Math.sqrt(macdErr*macdErr + sigErr*sigErr + histErr*histErr);
            considerTop({ timestamp: t, close, lib: L, custom: C, diff: { macd: macdErr, signal: sigErr, histogram: histErr }, score });

            sumMacdErr += macdErr; sumSigErr += sigErr; sumHistErr += histErr;
            sumMacdErr2 += macdErr * macdErr; sumSigErr2 += sigErr * sigErr; sumHistErr2 += histErr * histErr;

            maxMacdAbs = Math.max(maxMacdAbs, Math.abs(macdErr));
            maxSigAbs = Math.max(maxSigAbs, Math.abs(sigErr));
            maxHistAbs = Math.max(maxHistAbs, Math.abs(histErr));

            if (i >= n - 3) {
              sample.push({ timestamp: t, close, lib: L, custom: C, diff: { macd: macdErr, signal: sigErr, histogram: histErr } });
            }
          }

          const mae = {
            macd: Math.abs(sumMacdErr) / n,
            signal: Math.abs(sumSigErr) / n,
            histogram: Math.abs(sumHistErr) / n
          };
          const rmse = {
            macd: Math.sqrt(sumMacdErr2 / n),
            signal: Math.sqrt(sumSigErr2 / n),
            histogram: Math.sqrt(sumHistErr2 / n)
          };

          const crossStats = (() => {
            const len = n;
            let matches = 0, total = 0;
            let libs: number[] = [], cus: number[] = [];
            for (let i = 1; i < len; i++) {
              const lPrev = (typeof lib[libStart + i - 1]?.MACD === 'number' && typeof lib[libStart + i - 1]?.signal === 'number')
                ? ((lib[libStart + i - 1] as any).MACD - (lib[libStart + i - 1] as any).signal) : 0;
              const lCurr = (typeof lib[libStart + i]?.MACD === 'number' && typeof lib[libStart + i]?.signal === 'number')
                ? ((lib[libStart + i] as any).MACD - (lib[libStart + i] as any).signal) : 0;
              const cPrev = (typeof custom.macd[cusStart + i - 1] === 'number' && typeof custom.signal[cusStart + i - 1] === 'number')
                ? (custom.macd[cusStart + i - 1] - custom.signal[cusStart + i - 1]) : 0;
              const cCurr = (typeof custom.macd[cusStart + i] === 'number' && typeof custom.signal[cusStart + i] === 'number')
                ? (custom.macd[cusStart + i] - custom.signal[cusStart + i]) : 0;
              const lCross = sign(lPrev) !== sign(lCurr);
              const cCross = sign(cPrev) !== sign(cCurr);
              if (lCross || cCross) {
                total++;
                if (lCross === cCross && sign(lCurr) === sign(cCurr)) matches++;
              }
              libs.push(lCurr); cus.push(cCurr);
            }
            const mL = libs.reduce((a,b)=>a+b,0)/libs.length;
            const mC = cus.reduce((a,b)=>a+b,0)/libs.length;
            let cov=0, vL=0, vC=0;
            for (let i=0;i<libs.length;i++){ const dl=libs[i]-mL; const dc=cus[i]-mC; cov+=dl*dc; vL+=dl*dl; vC+=dc*dc; }
            const corr = (vL>0 && vC>0) ? (cov/Math.sqrt(vL*vC)) : 0;
            return { cross_match: matches, cross_total: total, cross_ratio: total? matches/total: 1, corr };
          })();

          const pass = (
            rmse.macd <= tolRmse && rmse.signal <= tolRmse && rmse.histogram <= tolRmse &&
            maxMacdAbs <= tolMaxAbs && maxSigAbs <= tolMaxAbs && maxHistAbs <= tolMaxAbs &&
            crossStats.cross_ratio >= tolCross
          );

          results.push({
            success: true,
            label,
            fastPeriod,
            slowPeriod,
            signalPeriod,
            count: n,
            thresholds: { tol_rmse: tolRmse, tol_max_abs: tolMaxAbs, tol_cross: tolCross },
            pass,
            error: {
              mae, rmse,
              max_abs: { macd: maxMacdAbs, signal: maxSigAbs, histogram: maxHistAbs }
            },
            cross: crossStats,
            top_k: topKLocal,
            top_samples: (tops.length ? [...tops].sort((a:any,b:any)=>b.score-a.score) : undefined),
            sample_last_3: sample
          });
        } catch (innerErr: any) {
          results.push({ label, success: false, error: innerErr?.message || String(innerErr) });
        }
      }

      const passed = results.filter(r => r.success && r.pass === true).length;
      const failed = results.filter(r => !r.success || r.pass === false).length;

      const response: ApiResponse = {
        success: true,
        data: { total: results.length, passed, failed, results },
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error: any) {
      this.handleError(res, error, 'Failed to validate MACD offline batch');
    }
  }

  // 新增：BOLL 时间序列（上/中/下轨）
  private async handleBOLLSeries(req: Request, res: Response): Promise<void> {
    try {
      const symbol = (req.query.symbol as string) || config.trading.defaultSymbol;
      const interval = (req.query.interval as string) || '1H';
      const maxLimit = 500; // 安全上限
      const minLimit = 50;
      const reqLimit = parseInt((req.query.limit as string) || '200', 10);
      const limit = Math.min(Math.max(reqLimit, minLimit), maxLimit);

      const klines = await enhancedOKXDataService.getKlineData(symbol, interval, limit);
      if (!Array.isArray(klines) || klines.length < 20) {
        res.status(400).json({
          success: false,
          error: `K线数据不足，当前=${klines?.length ?? 0}`,
          timestamp: Date.now()
        });
        return;
      }

      const closes = klines.map(k => k.close);
      const period = config.indicators?.bollinger?.period || 20;
      const stdDev = config.indicators?.bollinger?.stdDev || 2;

      const bb = BollingerBands.calculate({ values: closes, period, stdDev });
      const offset = closes.length - bb.length;
      const series = bb.map((v, idx) => ({
        timestamp: klines[idx + offset].timestamp,
        close: klines[idx + offset].close,
        upper: v.upper,
        middle: v.middle,
        lower: v.lower
      }));

      const response: ApiResponse = {
        success: true,
        data: {
          symbol,
          interval,
          period,
          stdDev,
          closedOnly: config.indicators?.closedOnly ?? true,
          count: series.length,
          series
        },
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to get BOLL series');
    }
  }

  // 内部：自实现 BOLL（基于滚动均值与滚动方差）
  private computeBOLLCustom(values: number[], period: number, stdDev: number): { upper: number[]; middle: number[]; lower: number[] } {
    if (!Array.isArray(values) || values.length < period || period <= 0) {
      return { upper: [], middle: [], lower: [] };
    }
    const upper: number[] = [];
    const middle: number[] = [];
    const lower: number[] = [];

    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < period; i++) {
      const v = values[i];
      sum += v;
      sumSq += v * v;
    }
    for (let i = period - 1; i < values.length; i++) {
      if (i >= period) {
        const add = values[i];
        const rm = values[i - period];
        sum += add - rm;
        sumSq += add * add - rm * rm;
      }
      const mean = sum / period;
      const variance = Math.max(0, (sumSq / period) - mean * mean);
      const sd = Math.sqrt(variance);
      middle.push(mean);
      upper.push(mean + sd * stdDev);
      lower.push(mean - sd * stdDev);
    }
    return { upper, middle, lower };
  }

  // 新增：BOLL 自动化比对校验（library vs custom）
  private async handleBOLLValidate(req: Request, res: Response): Promise<void> {
    try {
      const symbol = (req.query.symbol as string) || config.trading.defaultSymbol;
      const interval = (req.query.interval as string) || '1H';
      const maxLimit = 500;
      const minLimit = 50; // 建议至少50根
      const reqLimit = parseInt((req.query.limit as string) || '200', 10);
      const limit = Math.min(Math.max(reqLimit, minLimit), maxLimit);
      const tolRmse = parseFloat((req.query.tol_rmse as string) || '1e-6');
      const tolMaxAbs = parseFloat((req.query.tol_max_abs as string) || '1e-6');

      const klines = await enhancedOKXDataService.getKlineData(symbol, interval, limit);
      if (!Array.isArray(klines) || klines.length < minLimit) {
        res.status(400).json({ success: false, error: `K线数据不足，当前=${klines?.length ?? 0}`, timestamp: Date.now() });
        return;
      }

      const closes = klines.map(k => k.close);
      const period = config.indicators?.bollinger?.period || 20;
      const stdDev = config.indicators?.bollinger?.stdDev || 2;

      // 库计算
      const lib = BollingerBands.calculate({ values: closes, period, stdDev });
      const libOffset = closes.length - lib.length;

      // 自实现
      const custom = this.computeBOLLCustom(closes, period, stdDev);

      // 对齐
      const n = Math.min(lib.length, custom.middle.length);
      if (n <= 0) {
        res.status(500).json({ success: false, error: '无法对齐 BOLL 序列进行校验', timestamp: Date.now() });
        return;
      }
      const libStart = lib.length - n;
      const cusStart = custom.middle.length - n;
      const timeStartIdx = Math.max(libOffset + libStart, (closes.length - custom.middle.length) + cusStart);

      let sumMidErr = 0, sumUpErr = 0, sumLowErr = 0;
      let sumMidErr2 = 0, sumUpErr2 = 0, sumLowErr2 = 0;
      let maxMidAbs = 0, maxUpAbs = 0, maxLowAbs = 0;
      const sample: any[] = [];

      for (let i = 0; i < n; i++) {
        const L = lib[libStart + i];
        const C = {
          upper: custom.upper[cusStart + i],
          middle: custom.middle[cusStart + i],
          lower: custom.lower[cusStart + i]
        };
        const midErr = L.middle - C.middle;
        const upErr = L.upper - C.upper;
        const lowErr = L.lower - C.lower;

        sumMidErr += midErr; sumUpErr += upErr; sumLowErr += lowErr;
        sumMidErr2 += midErr * midErr; sumUpErr2 += upErr * upErr; sumLowErr2 += lowErr * lowErr;

        maxMidAbs = Math.max(maxMidAbs, Math.abs(midErr));
        maxUpAbs = Math.max(maxUpAbs, Math.abs(upErr));
        maxLowAbs = Math.max(maxLowAbs, Math.abs(lowErr));

        if (i >= n - 3) {
          const tIdx = timeStartIdx + i;
          sample.push({
            timestamp: klines[tIdx]?.timestamp,
            close: klines[tIdx]?.close,
            lib: L,
            custom: C,
            diff: { middle: midErr, upper: upErr, lower: lowErr }
          });
        }
      }

      const mae = {
        middle: Math.abs(sumMidErr) / n,
        upper: Math.abs(sumUpErr) / n,
        lower: Math.abs(sumLowErr) / n
      };
      const rmse = {
        middle: Math.sqrt(sumMidErr2 / n),
        upper: Math.sqrt(sumUpErr2 / n),
        lower: Math.sqrt(sumLowErr2 / n)
      };

      const pass = (
        rmse.middle <= tolRmse && rmse.upper <= tolRmse && rmse.lower <= tolRmse &&
        maxMidAbs <= tolMaxAbs && maxUpAbs <= tolMaxAbs && maxLowAbs <= tolMaxAbs
      );

      res.json({
        success: true,
        data: {
          symbol,
          interval,
          period,
          stdDev,
          count: n,
          thresholds: { tol_rmse: tolRmse, tol_max_abs: tolMaxAbs },
          pass,
          error: { mae, rmse, max_abs: { middle: maxMidAbs, upper: maxUpAbs, lower: maxLowAbs } },
          sample_last_3: sample
        },
        timestamp: Date.now()
      });
    } catch (error) {
      this.handleError(res, error, 'Failed to validate BOLL');
    }
  }

  // 新增：BOLL 离线快照校验（对历史K线快照进行校验）
  private async handleBOLLValidateOffline(req: Request, res: Response): Promise<void> {
    try {
      const { candles, period: p, stdDev: s, tol_rmse, tol_max_abs } = req.body || {};
      if (!Array.isArray(candles) || candles.length < 50) {
        res.status(400).json({ success: false, error: 'invalid candles: require >=50 items', timestamp: Date.now() });
        return;
      }

      // candles 支持两种格式：1) 数字数组（close 列表） 2) 对象数组（含 close 与 timestamp）
      const closes: number[] = candles.map((c: any) => typeof c === 'number' ? c : c?.close).filter((v: any) => typeof v === 'number');
      if (closes.length < 50) {
        res.status(400).json({ success: false, error: 'invalid candles: close list too short', timestamp: Date.now() });
        return;
      }
      const timestamps: number[] | undefined = (typeof candles[0] === 'object') ? candles.map((c: any) => c?.timestamp).filter((t: any) => typeof t === 'number') : undefined;

      const period = Number.isFinite(p) ? Number(p) : (config.indicators?.bollinger?.period ?? 20);
      const stdDev = Number.isFinite(s) ? Number(s) : (config.indicators?.bollinger?.stdDev ?? 2);
      const tolRmse = Number.isFinite(tol_rmse) ? Number(tol_rmse) : 1e-6;
      const tolMaxAbs = Number.isFinite(tol_max_abs) ? Number(tol_max_abs) : 1e-6;

      // 库计算
      const lib = BollingerBands.calculate({ values: closes, period, stdDev });
      const libOffset = closes.length - lib.length;

      // 自实现
      const custom = this.computeBOLLCustom(closes, period, stdDev);

      // 对齐
      const n = Math.min(lib.length, custom.middle.length);
      if (n <= 0) {
        res.status(500).json({ success: false, error: '无法对齐 BOLL 序列进行校验', timestamp: Date.now() });
        return;
      }
      const libStart = lib.length - n;
      const cusStart = custom.middle.length - n;
      const timeStartIdx = Math.max(libOffset + libStart, (closes.length - custom.middle.length) + cusStart);

      let sumMidErr = 0, sumUpErr = 0, sumLowErr = 0;
      let sumMidErr2 = 0, sumUpErr2 = 0, sumLowErr2 = 0;
      let maxMidAbs = 0, maxUpAbs = 0, maxLowAbs = 0;
      const sample: any[] = [];

      for (let i = 0; i < n; i++) {
        const L = lib[libStart + i];
        const C = {
          upper: custom.upper[cusStart + i],
          middle: custom.middle[cusStart + i],
          lower: custom.lower[cusStart + i]
        };
        const midErr = L.middle - C.middle;
        const upErr = L.upper - C.upper;
        const lowErr = L.lower - C.lower;

        sumMidErr += midErr; sumUpErr += upErr; sumLowErr += lowErr;
        sumMidErr2 += midErr * midErr; sumUpErr2 += upErr * upErr; sumLowErr2 += lowErr * lowErr;

        maxMidAbs = Math.max(maxMidAbs, Math.abs(midErr));
        maxUpAbs = Math.max(maxUpAbs, Math.abs(upErr));
        maxLowAbs = Math.max(maxLowAbs, Math.abs(lowErr));

        if (i >= n - 3) {
          const tIdx = timeStartIdx + i;
          sample.push({
            timestamp: timestamps ? timestamps[tIdx] : undefined,
            close: closes[tIdx],
            lib: L,
            custom: C,
            diff: { middle: midErr, upper: upErr, lower: lowErr }
          });
        }
      }

      const mae = {
        middle: Math.abs(sumMidErr) / n,
        upper: Math.abs(sumUpErr) / n,
        lower: Math.abs(sumLowErr) / n
      };
      const rmse = {
        middle: Math.sqrt(sumMidErr2 / n),
        upper: Math.sqrt(sumUpErr2 / n),
        lower: Math.sqrt(sumLowErr2 / n)
      };

      const pass = (
        rmse.middle <= tolRmse && rmse.upper <= tolRmse && rmse.lower <= tolRmse &&
        maxMidAbs <= tolMaxAbs && maxUpAbs <= tolMaxAbs && maxLowAbs <= tolMaxAbs
      );

      const response: ApiResponse = {
        success: true,
        data: {
          count: n,
          period,
          stdDev,
          thresholds: { tol_rmse: tolRmse, tol_max_abs: tolMaxAbs },
          pass,
          error: {
            mae, rmse,
            max_abs: { middle: maxMidAbs, upper: maxUpAbs, lower: maxLowAbs }
          },
          sample_last_3: sample
        },
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error: any) {
      console.error('Offline BOLL validation failed:', error);
      res.status(500).json({
        success: false,
        error: error?.message || 'Failed to validate BOLL offline',
        details: (process.env.NODE_ENV !== 'production') ? String(error?.stack || error) : undefined,
        timestamp: Date.now()
      });
    }
  }

  // 新增：BOLL 离线快照批量校验（对多个历史K线快照进行批量校验）
  private async handleBOLLValidateOfflineBatch(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body || {};
      const items = Array.isArray(body.items) ? body.items : [];

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ success: false, error: 'invalid items: require non-empty array', timestamp: Date.now() });
        return;
      }

      // 顶层默认参数（可被每个项覆盖）
      const defaultPeriod = Number.isFinite(body.period) ? Number(body.period) : (config.indicators?.bollinger?.period ?? 20);
      const defaultStdDev = Number.isFinite(body.stdDev) ? Number(body.stdDev) : (config.indicators?.bollinger?.stdDev ?? 2);
      const defaultTolRmse = Number.isFinite(body.tol_rmse) ? Number(body.tol_rmse) : 1e-6;
      const defaultTolMaxAbs = Number.isFinite(body.tol_max_abs) ? Number(body.tol_max_abs) : 1e-6;

      const results: any[] = [];

      for (const it of items) {
        const label = it?.label;
        const candles = it?.candles;

        if (!Array.isArray(candles) || candles.length < 50) {
          results.push({ label, success: false, error: 'invalid candles: require >=50 items' });
          continue;
        }

        // 每项参数覆盖
        const period = Number.isFinite(it.period) ? Number(it.period) : defaultPeriod;
        const stdDev = Number.isFinite(it.stdDev) ? Number(it.stdDev) : defaultStdDev;
        const tolRmse = Number.isFinite(it.tol_rmse) ? Number(it.tol_rmse) : defaultTolRmse;
        const tolMaxAbs = Number.isFinite(it.tol_max_abs) ? Number(it.tol_max_abs) : defaultTolMaxAbs;

        try {
          const closes: number[] = candles.map((c: any) => typeof c === 'number' ? c : c?.close).filter((v: any) => typeof v === 'number');
          if (closes.length < 50) {
            results.push({ label, success: false, error: 'invalid candles: close list too short' });
            continue;
          }

          const timestamps: number[] | undefined = (typeof candles[0] === 'object') ? candles.map((c: any) => c?.timestamp).filter((t: any) => typeof t === 'number') : undefined;

          // 库计算
          const lib = BollingerBands.calculate({ values: closes, period, stdDev });
          const libOffset = closes.length - lib.length;

          // 自实现
          const custom = this.computeBOLLCustom(closes, period, stdDev);

          // 对齐
          const n = Math.min(lib.length, custom.middle.length);
          if (n <= 0) {
            results.push({ label, success: false, error: '无法对齐 BOLL 序列进行校验' });
            continue;
          }

          const libStart = lib.length - n;
          const cusStart = custom.middle.length - n;
          const timeStartIdx = Math.max(libOffset + libStart, (closes.length - custom.middle.length) + cusStart);

          let sumMidErr = 0, sumUpErr = 0, sumLowErr = 0;
          let sumMidErr2 = 0, sumUpErr2 = 0, sumLowErr2 = 0;
          let maxMidAbs = 0, maxUpAbs = 0, maxLowAbs = 0;

          const sample: any[] = [];
          const topKLocal = Number.isFinite(it.top_k) ? Math.max(0, Math.floor(it.top_k)) : (Number.isFinite(body.top_k) ? Math.max(0, Math.floor(body.top_k)) : 0);
          const tops: any[] = [];
          const considerTop = (cand: any) => {
            if (!topKLocal || topKLocal <= 0) return;
            if (tops.length < topKLocal) {
              tops.push(cand);
            } else {
              let minIdx = 0;
              for (let j = 1; j < tops.length; j++) if (tops[j].score < tops[minIdx].score) minIdx = j;
              if (cand.score > tops[minIdx].score) tops[minIdx] = cand;
            }
          };

          for (let i = 0; i < n; i++) {
            const L = lib[libStart + i];
            const C = {
              upper: custom.upper[cusStart + i],
              middle: custom.middle[cusStart + i],
              lower: custom.lower[cusStart + i]
            };
            const tIdx = timeStartIdx + i;
            const t = timestamps ? timestamps[tIdx] : undefined;
            const close = closes[tIdx];

            const midErr = L.middle - C.middle;
            const upErr = L.upper - C.upper;
            const lowErr = L.lower - C.lower;

            const score = Math.sqrt(midErr*midErr + upErr*upErr + lowErr*lowErr);
            considerTop({ timestamp: t, close, lib: L, custom: C, diff: { middle: midErr, upper: upErr, lower: lowErr }, score });

            sumMidErr += midErr; sumUpErr += upErr; sumLowErr += lowErr;
            sumMidErr2 += midErr * midErr; sumUpErr2 += upErr * upErr; sumLowErr2 += lowErr * lowErr;

            maxMidAbs = Math.max(maxMidAbs, Math.abs(midErr));
            maxUpAbs = Math.max(maxUpAbs, Math.abs(upErr));
            maxLowAbs = Math.max(maxLowAbs, Math.abs(lowErr));

            if (i >= n - 3) {
              sample.push({ timestamp: t, close, lib: L, custom: C, diff: { middle: midErr, upper: upErr, lower: lowErr } });
            }
          }

          const mae = {
            middle: Math.abs(sumMidErr) / n,
            upper: Math.abs(sumUpErr) / n,
            lower: Math.abs(sumLowErr) / n
          };
          const rmse = {
            middle: Math.sqrt(sumMidErr2 / n),
            upper: Math.sqrt(sumUpErr2 / n),
            lower: Math.sqrt(sumLowErr2 / n)
          };

          const pass = (
            rmse.middle <= tolRmse && rmse.upper <= tolRmse && rmse.lower <= tolRmse &&
            maxMidAbs <= tolMaxAbs && maxUpAbs <= tolMaxAbs && maxLowAbs <= tolMaxAbs
          );

          results.push({
            success: true,
            label,
            period,
            stdDev,
            count: n,
            thresholds: { tol_rmse: tolRmse, tol_max_abs: tolMaxAbs },
            pass,
            error: {
              mae, rmse,
              max_abs: { middle: maxMidAbs, upper: maxUpAbs, lower: maxLowAbs }
            },
            top_k: topKLocal,
            top_samples: (tops.length ? [...tops].sort((a:any,b:any)=>b.score-a.score) : undefined),
            sample_last_3: sample
          });
        } catch (innerErr: any) {
          results.push({ label, success: false, error: innerErr?.message || String(innerErr) });
        }
      }

      const passed = results.filter(r => r.success && r.pass === true).length;
      const failed = results.filter(r => !r.success || r.pass === false).length;

      // 报告导出（JSON/CSV）
      const exportCfg = (req.body || {}).export;
      const exportInfo: { jsonPath?: string; csvPath?: string; error?: string } = {};
      if (exportCfg && (exportCfg.enable === true || exportCfg.enable === 'true')) {
        try {
          const outDir = (exportCfg.dir && typeof exportCfg.dir === 'string') ? exportCfg.dir : path.join(process.cwd(), 'logs', 'reports');
          if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
          const fmt = (exportCfg.format === 'csv' || exportCfg.format === 'both') ? exportCfg.format : 'json';
          const prefix = (typeof exportCfg.filename === 'string' && exportCfg.filename.trim()) ? exportCfg.filename.trim() : 'boll_offline_batch';
          const data = { total: results.length, passed, failed, results };

          const now = new Date();
          const pad = (n:number)=> String(n).padStart(2,'0');
          const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

          // JSON
          if (fmt === 'json' || fmt === 'both') {
            const jsonPath = path.join(outDir, `${prefix}_${ts}.json`);
            const responseForSave = { success: true, data, timestamp: Date.now() };
            fs.writeFileSync(jsonPath, JSON.stringify(responseForSave, null, 2));
            exportInfo.jsonPath = jsonPath;
          }

          // CSV（逐项汇总）
          if (fmt === 'csv' || fmt === 'both') {
            const csvPath = path.join(outDir, `${prefix}_${ts}.csv`);
            const header = [
              'label','pass','count',
              'rmse_middle','rmse_upper','rmse_lower',
              'maxabs_middle','maxabs_upper','maxabs_lower'
            ].join(',');
            const toCsvVal = (v:any)=> (typeof v === 'number' ? v : (v===undefined||v===null?'':String(v).replace(/"/g,'""')));
            const lines = [header, ...results.map((r:any)=>{
              if (!r.success) return [r.label, false, '', '', '', '', '', '', ''].join(',');
              return [
                r.label ?? '',
                r.pass,
                r.count,
                r.error?.rmse?.middle,
                r.error?.rmse?.upper,
                r.error?.rmse?.lower,
                r.error?.max_abs?.middle,
                r.error?.max_abs?.upper,
                r.error?.max_abs?.lower
              ].map(toCsvVal).join(',');
            })];
            fs.writeFileSync(csvPath, lines.join('\n'));
            exportInfo.csvPath = csvPath;
          }
        } catch (ex: any) {
          exportInfo.error = ex?.message || String(ex);
          console.warn('Export report failed (BOLL):', ex);
        }
      }

      const response: ApiResponse = {
        success: true,
        data: { total: results.length, passed, failed, results, export: exportInfo },
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error: any) {
      this.handleError(res, error, 'Failed to validate BOLL offline batch');
    }
  }

  private async handleGetConfig(req: Request, res: Response): Promise<void> {
    try {
      // 返回安全的配置信息（不包含敏感数据）
      const safeConfig = {
        trading: {
          defaultSymbol: config.trading.defaultSymbol,
          intervals: config.trading.intervals,
          maxLeverage: config.trading.defaultLeverage
        },
        risk: {
          maxDailyLoss: config.risk.maxDailyLoss,
          maxPositionSize: config.risk.maxPositionSize,
          stopLossPercent: config.risk.stopLossPercent,
          takeProfitPercent: config.risk.takeProfitPercent
        },
        strategy: {
          signalThreshold: config.strategy.signalThreshold,
          minWinRate: config.strategy.minWinRate,
          useMLAnalysis: config.strategy.useMLAnalysis,
          analysisInterval: ethStrategyEngine.getAnalysisInterval ? ethStrategyEngine.getAnalysisInterval() : 30000,
          signalCooldownMs: (config as any)?.strategy?.signalCooldownMs
        }
      };
      
      const response: ApiResponse = {
        success: true,
        data: safeConfig,
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to get config');
    }
  }

  private async handleUpdateConfig(req: Request, res: Response): Promise<void> {
    try {
      // 为了安全，只允许更新特定的配置项
      const allowedUpdates = ['signalThreshold', 'maxPositionSize', 'stopLossPercent', 'useMLAnalysis', 'analysisInterval', 'signalCooldownMs'];
      const updates = req.body || {};
      
      // 验证更新请求
      const validUpdates = Object.keys(updates).filter(key => allowedUpdates.includes(key));
      
      if (validUpdates.length === 0) {
        res.status(400).json({
          success: false,
          error: 'No valid configuration updates provided',
          timestamp: Date.now()
        });
        return;
      }
      
      // 应用更新到运行时配置（仅非敏感项）
      for (const key of validUpdates) {
        const val = updates[key];
        switch (key) {
          case 'signalThreshold':
            if (typeof val === 'number' && val >= 0 && val <= 1) {
              config.strategy.signalThreshold = val;
            }
            break;
          case 'maxPositionSize':
            if (typeof val === 'number' && val > 0) {
              config.risk.maxPositionSize = val;
            }
            break;
          case 'stopLossPercent':
            if (typeof val === 'number' && val > 0 && val < 100) {
              config.risk.stopLossPercent = val;
            }
            break;
          case 'useMLAnalysis':
            if (typeof val === 'boolean') {
              config.strategy.useMLAnalysis = val;
            } else if (val === 'true' || val === 'false') {
              config.strategy.useMLAnalysis = (val === 'true');
            }
            break;
          case 'analysisInterval':
            if (typeof val === 'number' && Number.isFinite(val)) {
              ethStrategyEngine.setAnalysisInterval && ethStrategyEngine.setAnalysisInterval(val);
            } else if (typeof val === 'string') {
              const n = parseInt(val, 10);
              if (!Number.isNaN(n)) {
                ethStrategyEngine.setAnalysisInterval && ethStrategyEngine.setAnalysisInterval(n);
              }
            }
            break;
          case 'signalCooldownMs':
            if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
              (config as any).strategy.signalCooldownMs = val;
            } else if (typeof val === 'string') {
              const n = parseInt(val, 10);
              if (!Number.isNaN(n) && n >= 0) {
                (config as any).strategy.signalCooldownMs = n;
              }
            }
            break;
        }
      }
      
      const response: ApiResponse = {
        success: true,
        data: {
          message: 'Configuration updated successfully',
          strategy: {
            signalThreshold: config.strategy.signalThreshold,
            minWinRate: config.strategy.minWinRate,
            useMLAnalysis: config.strategy.useMLAnalysis,
            analysisInterval: ethStrategyEngine.getAnalysisInterval ? ethStrategyEngine.getAnalysisInterval() : undefined,
            signalCooldownMs: (config as any)?.strategy?.signalCooldownMs
          },
          risk: {
            maxPositionSize: config.risk.maxPositionSize,
            stopLossPercent: config.risk.stopLossPercent
          }
        },
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to update config');
    }
  }

  // 错误处理
  private handleError(res: Response, error: any, message: string): void {
    console.error(message, error);
    const response: ApiResponse = {
      success: false,
      error: message,
      timestamp: Date.now()
    };
    res.status(500).json(response);
  }

  // 发送当前状态给客户端
  private async sendCurrentStatus(socket: any): Promise<void> {
    try {
      const status = ethStrategyEngine.getCurrentStatus();
      const analysis = ethStrategyEngine.getLatestAnalysis();
      
      socket.emit('strategy-update', {
        status,
        analysis,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Failed to send current status:', error);
    }
  }

  // 启动实时更新
  private startRealTimeUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    this.updateInterval = setInterval(async () => {
      try {
        const analysis = ethStrategyEngine.getLatestAnalysis();
        const status = ethStrategyEngine.getCurrentStatus();
        
        if (analysis) {
          this.io.to('strategy-updates').emit('strategy-update', analysis);
        }
        
        // 发送市场数据更新
        const marketData = await enhancedOKXDataService.getTicker(config.trading.defaultSymbol);
        if (marketData) {
          this.io.to('strategy-updates').emit('market-data', marketData);
        }
        
        // 发送持仓更新
        if (status.position) {
          this.io.to('strategy-updates').emit('position-update', status.position);
        }
        
      } catch (error) {
        console.error('Real-time update error:', error);
      }
    }, 5000); // 每5秒更新一次
  }

  // 停止实时更新
  private stopRealTimeUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  // 启动服务器
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Web server is already running');
      return;
    }

    try {
      console.log('🚀 启动Web服务器...');

      // 在启动前检查环境变量端口覆盖
      const envPortStr = process.env.WEB_PORT;
      const envPort = envPortStr ? parseInt(envPortStr, 10) : NaN;
      if (!Number.isNaN(envPort) && envPort > 0 && envPort !== this.port) {
        console.log(`🔧 端口覆盖: ${this.port} -> ${envPort} (来自环境变量 WEB_PORT)`);
        this.port = envPort;
      }
      
      return new Promise<void>((resolve, reject) => {
        this.server.listen(this.port, () => {
          console.log(`✅ Web server started on port ${this.port}`);
          console.log(`📊 Dashboard: http://localhost:${this.port}`);
          console.log(`🔗 API: http://localhost:${this.port}/api`);
          console.log(`📈 Recommendations API: http://localhost:${this.port}/api/recommendations`);
          
          this.isRunning = true;
          this.startRealTimeUpdates();
          
          // 异步初始化推荐系统，不阻塞Web服务器启动
          this.initializeRecommendationSystemAsync();
          
          resolve();
        });
        
        this.server.on('error', (error: any) => {
          console.error(`Failed to start web server on port ${this.port}:`, error);
          reject(error);
        });
      });
    } catch (error) {
      console.error('Failed to start web server:', error);
      throw error;
    }
  }
  
  // 异步初始化推荐系统
  private async initializeRecommendationSystemAsync(): Promise<void> {
    try {
      console.log('🔄 后台初始化推荐系统...');
      await this.recommendationService.initialize();
      await this.recommendationService.start();
      console.log('✅ 推荐系统后台初始化完成');
    } catch (error) {
      console.error('❌ 推荐系统初始化失败:', error);
    }
  }

  // 停止服务器
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('Web server is not running');
      return;
    }

    try {
      // 停止推荐系统
      await this.recommendationService.stop();
      console.log('Recommendation system stopped');
    } catch (error) {
      console.error('Error stopping recommendation system:', error);
    }

    return new Promise((resolve) => {
      this.stopRealTimeUpdates();
      
      this.server.close(() => {
        console.log('Web server stopped');
        this.isRunning = false;
        resolve();
      });
    });
  }

  // 获取服务器状态
  getStatus(): {
    isRunning: boolean;
    port: number;
    connectedClients: number;
  } {
    return {
      isRunning: this.isRunning,
      port: this.port,
      connectedClients: this.io.engine.clientsCount
    };
  }

  // 广播警告消息
  broadcastAlert(level: 'INFO' | 'WARNING' | 'CRITICAL', message: string): void {
    this.io.to('strategy-updates').emit('alert', {
      level,
      message,
      timestamp: Date.now()
    });
  }

  // 广播策略更新
  broadcastStrategyUpdate(analysis: StrategyResult): void {
    this.io.to('strategy-updates').emit('strategy-update', analysis);
  }
}

// 导出单例实例
const selectedPort = (() => {
  const envPortStr = process.env.WEB_PORT;
  const envPort = envPortStr ? parseInt(envPortStr, 10) : NaN;
  if (!Number.isNaN(envPort) && envPort > 0) {
    console.log(`🌐 使用环境变量端口 WEB_PORT=${envPort}`);
    return envPort;
  }
  console.log(`🌐 使用配置端口 config.webServer.port=${config.webServer.port}`);
  return config.webServer.port;
})();
export const webServer = new WebServer(selectedPort);

// 当作为入口文件直接执行时，自动启动 Web 服务器
console.log('🔍 检查是否需要自动启动Web服务器...');
console.log('process.argv[1]:', process.argv[1]);
console.log('import.meta.url:', import.meta.url);

// 直接启动服务器，不依赖复杂的判断逻辑
console.log('🚀 开始启动Web服务器...');
webServer.start().catch((err) => {
  console.error('❌ Web服务器启动失败:', err);
  process.exit(1);
});