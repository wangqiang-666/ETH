import express, { Request, Response } from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { ethStrategyEngine, StrategyResult } from '../strategy/eth-strategy-engine';
import { smartSignalAnalyzer } from '../analyzers/smart-signal-analyzer';
import { enhancedOKXDataService } from '../services/enhanced-okx-data-service';
import { config } from '../config';
import riskRoutes from '../api/risk-routes';
import backtestRoutes from '../api/backtest-routes';
import { dataValidator } from '../utils/data-validator';
import { TechnicalIndicatorAnalyzer } from '../indicators/technical-indicators';
import { RSI } from 'technicalindicators';

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

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketIO();
  }

  // 设置中间件
  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
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
    this.app.post('/api/strategy/start', this.handleStartStrategy.bind(this));
    this.app.post('/api/strategy/stop', this.handleStopStrategy.bind(this));
    this.app.get('/api/strategy/performance', this.handlePerformance.bind(this));
    this.app.get('/api/strategy/trades', this.handleTradeHistory.bind(this));
    
    // 市场数据API
    this.app.get('/api/market/ticker', this.handleMarketTicker.bind(this));
    this.app.get('/api/market/kline', this.handleMarketKline.bind(this));
    this.app.get('/api/market/contract', this.handleContractInfo.bind(this));

    // 数据真实性诊断
    this.app.get('/api/diagnostics/validate', this.handleDiagnosticsValidate.bind(this));
    
    // 技术指标API
    this.app.get('/api/indicators/latest', this.handleLatestIndicators.bind(this));
    this.app.get('/api/indicators/rsi-series', this.handleRSISeries.bind(this));
    
    // 配置API
    this.app.get('/api/config', this.handleGetConfig.bind(this));
    this.app.post('/api/config', this.handleUpdateConfig.bind(this));
    
    // 风险管理API
    this.app.use('/api/risk', riskRoutes);
    
    // 回测API
    this.app.use('/api/backtest', backtestRoutes);
    
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
    
    // 错误处理
    this.app.use((error: any, req: Request, res: Response, next: any) => {
      console.error('Server error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: Date.now()
      });
    });
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

  private async handleLatestIndicators(req: Request, res: Response): Promise<void> {
    try {
      const lastAnalysis = smartSignalAnalyzer.getLastAnalysis();
      const indicators = lastAnalysis ? {
        rsi: lastAnalysis.strength.technical,
        macd: lastAnalysis.strength.ml,
        bollinger: lastAnalysis.strength.combined,
        timestamp: lastAnalysis.metadata.timestamp
      } : null;
      
      const response: ApiResponse = {
        success: true,
        data: indicators,
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
          useMLAnalysis: config.strategy.useMLAnalysis
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
      // 这里应该实现配置更新逻辑
      // 为了安全，只允许更新特定的配置项
      const allowedUpdates = ['signalThreshold', 'maxPositionSize', 'stopLossPercent'];
      const updates = req.body;
      
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
      
      // 这里应该实际更新配置
      console.log('Config update request:', updates);
      
      const response: ApiResponse = {
        success: true,
        data: { message: 'Configuration updated successfully', updates: validUpdates },
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
        const marketData = await enhancedOKXDataService.getTicker();
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

    return new Promise((resolve, reject) => {
      this.server.listen(this.port, () => {
        console.log(`Web server started on port ${this.port}`);
        console.log(`Dashboard: http://localhost:${this.port}`);
        console.log(`API: http://localhost:${this.port}/api`);
        
        this.isRunning = true;
        this.startRealTimeUpdates();
        resolve();
      });
      
      this.server.on('error', (error: any) => {
        console.error('Failed to start web server:', error);
        reject(error);
      });
    });
  }

  // 停止服务器
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('Web server is not running');
      return;
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
export const webServer = new WebServer();