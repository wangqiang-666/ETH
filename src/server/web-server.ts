import express, { Request, Response } from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import cors from 'cors';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { ethStrategyEngine } from '../strategy/eth-strategy-engine.js';
import { StrategyResult } from '../strategy/eth-strategy-engine.js';
import { smartSignalAnalyzer } from '../analyzers/smart-signal-analyzer.js';
import { enhancedOKXDataService, setTestingFGIOverride, clearTestingFGIOverride, setTestingFundingOverride, clearTestingFundingOverride, getEffectiveTestingFGIOverride } from '../services/enhanced-okx-data-service.js';
import { config } from '../config.js';
import riskRoutes from '../api/risk-routes.js';
import backtestRoutes from '../api/backtest-routes.js';
import { dataValidator } from '../utils/data-validator.js';
import { TechnicalIndicatorAnalyzer } from '../indicators/technical-indicators.js';
import { RSI, MACD, BollingerBands  } from 'technicalindicators';

import fs from 'fs';
import { RecommendationIntegrationService } from '../services/recommendation-integration-service.js';
import { tradingSignalService } from '../services/trading-signal-service.js';
import { riskManagementService } from '../services/risk-management-service.js';
import { MLAnalyzer } from '../ml/ml-analyzer.js';
import NodeCache from 'node-cache';
import { spawn } from 'child_process';

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
  // 并发与速率保护状态
  private manualTriggerInProgress: boolean = false;
  private lastManualTriggerAt: number = 0;
  private manualTriggerTimestamps: number[] = [];
  private retrainInProgress: boolean = false;
  // 推荐广播控制：去重窗口与快照
  private recoDedupeMap: Map<string, number> = new Map();
  private snapshotDirEnsured: boolean = false;

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

  // 计算推荐事件的去重Key（symbol+direction）
  private computeRecoKey(data: any): string {
    const s = (data && (data.symbol || (data as any).pair || (data as any).symbol_name)) || 'UNKNOWN';
    const d = (data && (data.direction || (data as any).side || (data as any).action || (data as any).type)) || 'NA';
    return `${s}|${d}`;
  }

  // 尝试写入快照（占位：仅文件，不入库）
  private async maybeWriteSnapshot(eventName: string, data: any): Promise<void> {
    const rt: any = (config as any)?.realtime;
    if (!rt?.snapshotEnabled || !rt?.snapshotDir) return;
    try {
      if (!this.snapshotDirEnsured) {
        await fs.promises.mkdir(rt.snapshotDir, { recursive: true });
        this.snapshotDirEnsured = true;
      }
      const now = new Date();
      const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
      const fname = `reco_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.ndjson`;
      const fpath = path.join(rt.snapshotDir, fname);
      const record = {
        ts: Date.now(),
        event: eventName,
        key: this.computeRecoKey(data),
        data
      };
      await fs.promises.appendFile(fpath, JSON.stringify(record) + "\n", 'utf8');
    } catch (e) {
      // 仅记录，不影响主流程
      console.warn('snapshot write failed:', e);
    }
  }

  // 统一的推荐事件广播（支持微抖动与短窗去重）
  private broadcastRecommendation(eventName: string, data: any): void {
    const rt: any = (config as any)?.realtime || {};
    const key = this.computeRecoKey(data);
    const now = Date.now();

    // 去重：同symbol+direction在窗口内仅广播一次
    if (rt.dedupeEnabled) {
      const win = Math.max(0, Number(rt.dedupeWindowMs || 0));
      const last = this.recoDedupeMap.get(key) || 0;
      if (now - last < win) {
        return; // 丢弃重复事件
      }
      this.recoDedupeMap.set(key, now);
    }

    const doEmit = () => {
      try {
        this.io.emit(eventName, data);
      } catch (e) {
        console.warn(`emit ${eventName} error:`, e);
      }
      // 快照写入异步进行
      this.maybeWriteSnapshot(eventName, data).catch(() => {});
    };

    if (rt.jitterEnabled) {
      const max = Math.max(0, Number(rt.jitterMaxMs || 0));
      const delay = max > 0 ? Math.floor(Math.random() * (max + 1)) : 0;
      setTimeout(doEmit, delay);
    } else {
      doEmit();
    }
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
    this.app.post('/api/strategy/analysis/trigger', this.handleTriggerAnalysis.bind(this));
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

    // 测试：价格覆盖端点（始终注册，按需授权）
    this.app.post('/api/testing/price-override', (req: Request, res: Response) => {
      try {
        if (!((config as any)?.testing?.allowPriceOverride)) {
          return res.status(403).json({ success: false, error: 'price override not allowed by config.testing.allowPriceOverride' });
        }
        const { symbol = config.trading.defaultSymbol, price, ttlMs } = req.body || {};
        const p = Number(price);
        if (!Number.isFinite(p) || p <= 0) {
          return res.status(400).json({ success: false, error: 'invalid price' });
        }
        enhancedOKXDataService.setPriceOverride(symbol, p, ttlMs);
        res.json({ success: true, symbol, price: p, ttlMs: ttlMs ?? (config as any)?.testing?.priceOverrideDefaultTtlMs });
      } catch (e) {
        res.status(500).json({ success: false, error: String((e as any)?.message || e) });
      }
    });

    this.app.post('/api/testing/price-override/clear', (req: Request, res: Response) => {
      try {
        if (!((config as any)?.testing?.allowPriceOverride)) {
          return res.status(403).json({ success: false, error: 'price override not allowed by config.testing.allowPriceOverride' });
        }
        const { symbol } = req.body || {};
        enhancedOKXDataService.clearPriceOverride(symbol);
        res.json({ success: true, symbol: symbol || '*', cleared: true });
      } catch (e) {
        res.status(500).json({ success: false, error: String((e as any)?.message || e) });
      }
    });

    // 测试：FGI 覆盖端点
    this.app.post('/api/testing/fgi-override', (req: Request, res: Response) => {
      try {
        if (!((config as any)?.testing?.allowFGIOverride)) {
          return res.status(403).json({ success: false, error: 'fgi override not allowed by config.testing.allowFGIOverride' });
        }
        const { value, ttlMs } = req.body || {};
        const v = Number(value);
        if (!Number.isFinite(v) || v < 0 || v > 100) {
          return res.status(400).json({ success: false, error: 'invalid fgi value (0-100)' });
        }
        setTestingFGIOverride(v, ttlMs);
        res.json({ success: true, value: Math.max(0, Math.min(100, v)), ttlMs: ttlMs ?? (config as any)?.testing?.fgiOverrideDefaultTtlMs });
      } catch (e) {
        res.status(500).json({ success: false, error: String((e as any)?.message || e) });
      }
    });

    this.app.post('/api/testing/fgi-override/clear', (req: Request, res: Response) => {
      try {
        if (!((config as any)?.testing?.allowFGIOverride)) {
          return res.status(403).json({ success: false, error: 'fgi override not allowed by config.testing.allowFGIOverride' });
        }
        clearTestingFGIOverride();
        res.json({ success: true, cleared: true });
      } catch (e) {
        res.status(500).json({ success: false, error: String((e as any)?.message || e) });
      }
    });

    // 测试：资金费率覆盖端点
    this.app.post('/api/testing/funding-override', (req: Request, res: Response) => {
      try {
        if (!((config as any)?.testing?.allowFundingOverride)) {
          return res.status(403).json({ success: false, error: 'funding override not allowed by config.testing.allowFundingOverride' });
        }
        const { symbol = config.trading.defaultSymbol, value, ttlMs } = req.body || {};
        const v = Number(value);
        if (!Number.isFinite(v)) {
          return res.status(400).json({ success: false, error: 'invalid funding value' });
        }
        setTestingFundingOverride(symbol, v, ttlMs);
        res.json({ success: true, symbol, value: v, ttlMs: ttlMs ?? (config as any)?.testing?.fundingOverrideDefaultTtlMs });
      } catch (e) {
        res.status(500).json({ success: false, error: String((e as any)?.message || e) });
      }
    });

    this.app.post('/api/testing/funding-override/clear', (req: Request, res: Response) => {
      try {
        if (!((config as any)?.testing?.allowFundingOverride)) {
          return res.status(403).json({ success: false, error: 'funding override not allowed by config.testing.allowFundingOverride' });
        }
        const { symbol } = req.body || {};
        clearTestingFundingOverride(symbol);
        res.json({ success: true, symbol: symbol || '*', cleared: true });
      } catch (e) {
        res.status(500).json({ success: false, error: String((e as any)?.message || e) });
      }
    });

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

    // ML 触发离线再训练并热更新
    this.app.post('/api/ml/retrain', async (req: Request, res: Response) => {
      try {
        if (this.retrainInProgress) {
          return res.status(429).json({ success: false, error: '再训练任务进行中，请稍后重试' });
        }
        this.retrainInProgress = true;

        const args: string[] = ['src/ml/train.ts'];
        if (req.body && typeof req.body === 'object') {
          const { windowDays, labelWindow, minSamples, calibrate } = req.body as any;
          if (Number.isFinite(windowDays)) args.push('--windowDays', String(windowDays));
          if (Number.isFinite(labelWindow)) args.push('--labelWindow', String(labelWindow));
          if (Number.isFinite(minSamples)) args.push('--minSamples', String(minSamples));
          if (typeof calibrate === 'boolean') args.push('--calibrate', String(calibrate));
        }

        console.log('[ML] Retrain request received, args:', args);

        // 使用 Node + tsx CLI 路径，避免在 Windows 上直接执行 .cmd 造成 spawn EINVAL
        let tsxCliPath: string;
        try {
          const { createRequire } = await import('module');
          const req = createRequire(import.meta.url);
          tsxCliPath = req.resolve('tsx/cli');
        } catch (e) {
          // 回退到本地 node_modules 约定路径
          tsxCliPath = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
        }
        console.log('[ML] Using tsx CLI:', tsxCliPath);
        const child = spawn(process.execPath, [tsxCliPath, ...args], {
          stdio: 'pipe',
          env: { ...process.env },
          shell: false,
          windowsHide: true,
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('error', (err) => {
          this.retrainInProgress = false;
          return res.status(500).json({ success: false, error: `训练进程启动失败: ${err?.message || String(err)}` });
        });

        child.on('close', async (code) => {
          try {
            if (code !== 0) {
              this.retrainInProgress = false;
              const msg = `训练脚本退出码 ${code}. ${stderr || ''}`.trim();
              return res.status(500).json({ success: false, error: msg });
            }

            const reload = await MLAnalyzer.loadOfflineModel();
            this.retrainInProgress = false;
            if (!reload.ok) {
              return res.status(500).json({ success: false, error: reload.error || '模型热更新失败' });
            }

            return res.json({
              success: true,
              message: '再训练完成并已热更新模型',
              logs: stdout.slice(-4000),
              model: {
                version: reload.model?.version,
                sampleCount: reload.model?.sampleCount,
                thresholds: reload.model?.thresholds
              }
            });
          } catch (err: any) {
            this.retrainInProgress = false;
            return res.status(500).json({ success: false, error: err?.message || String(err) });
          }
        });
      } catch (error: any) {
        this.retrainInProgress = false;
        const detail = error?.message || String(error);
        this.handleError(res, error, `Failed to trigger ML retrain: ${detail}`);
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
      this.broadcastRecommendation('recommendation-created', data);
    });
    
    this.recommendationService.on('recommendation_result', (data) => {
      this.broadcastRecommendation('recommendation-result', data);
    });
    
    this.recommendationService.on('recommendation_triggered', (data) => {
      this.broadcastRecommendation('recommendation-triggered', data);
    });
    
    this.recommendationService.on('statistics_updated', (data) => {
      this.io.emit('statistics-updated', data);
    });
    
    this.recommendationService.on('auto_recommendation_created', (data) => {
      this.broadcastRecommendation('auto-recommendation-created', data);
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
      const kronosEnabled = !!((config as any)?.strategy?.kronos?.enabled);
      let sanitized = analysis;
      if (!kronosEnabled && analysis) {
        try {
          const cloned = JSON.parse(JSON.stringify(analysis));
          if (cloned?.signal?.metadata?.kronos !== undefined) {
            delete cloned.signal.metadata.kronos;
          }
          sanitized = cloned;
        } catch (e) {
          // noop: 克隆失败则直接返回原数据，前端应有空值保护
        }
      }
      const response: ApiResponse = {
        success: true,
        data: sanitized,
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to get latest analysis');
    }
  }

  private async handleTriggerAnalysis(req: Request, res: Response): Promise<void> {
    // 并发与限流 + 冷却保护
    const now = Date.now();
    const cooldownMs = Number(((config as any)?.strategy?.signalCooldownMs ?? 30 * 60 * 1000));
    const maxPerMin = Number(((config as any)?.strategy?.maxManualTriggersPerMin ?? 6));

    try {
      // 1) 并发锁（立即占锁以避免竞态）
      if (this.manualTriggerInProgress) {
        const retrySec = 1;
        res.setHeader('Retry-After', String(retrySec));
        res.status(429).json({ success: false, error: 'Manual trigger already in progress', timestamp: Date.now() });
        return;
      }
      this.manualTriggerInProgress = true;

      // 2) 滑动窗口：每分钟触发上限
      const windowStart = now - 60_000;
      this.manualTriggerTimestamps = (this.manualTriggerTimestamps || []).filter(ts => ts >= windowStart);
      if (Number.isFinite(maxPerMin) && maxPerMin > 0 && this.manualTriggerTimestamps.length >= maxPerMin) {
        const oldest = this.manualTriggerTimestamps[0];
        const secsLeft = Math.max(1, Math.ceil((60_000 - (now - oldest)) / 1000));
        res.setHeader('Retry-After', String(secsLeft));
        res.status(429).json({ success: false, error: 'Too many trigger requests in 1 minute', timestamp: Date.now() });
        return;
      }

      // 3) 冷却时间校验
      if (Number.isFinite(cooldownMs) && cooldownMs > 0 && this.lastManualTriggerAt > 0) {
        const elapsed = now - this.lastManualTriggerAt;
        if (elapsed < cooldownMs) {
          const secsLeft = Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000));
          res.setHeader('Retry-After', String(secsLeft));
          res.status(429).json({ success: false, error: 'Manual trigger is in cooldown', timestamp: Date.now() });
          return;
        }
      }

      // 记录本次触发
      this.manualTriggerTimestamps.push(now);
      this.lastManualTriggerAt = now;

      // 调用核心分析
      const result = await ethStrategyEngine.analyzeMarket();
      const kronosEnabled = !!((config as any)?.strategy?.kronos?.enabled);
      let sanitized = result;
      if (!kronosEnabled && result) {
        try {
          const cloned = JSON.parse(JSON.stringify(result));
          if (cloned?.signal?.metadata?.kronos !== undefined) {
            delete cloned.signal.metadata.kronos;
          }
          sanitized = cloned;
        } catch (e) {
          // noop
        }
      }
      const response: ApiResponse = {
        success: true,
        data: sanitized,
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to trigger analysis');
    } finally {
      this.manualTriggerInProgress = false;
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

      const disableExternalRaw = (process.env.WEB_DISABLE_EXTERNAL_MARKET || '').toLowerCase();
      const disableExternal = disableExternalRaw === '1' || disableExternalRaw === 'true';
      if (disableExternal) {
        const response: ApiResponse = {
          success: true,
          data: {
            symbol,
            interval,
            limit,
            externalMarketDisabled: true
          },
          timestamp: Date.now()
        };
        res.json(response);
        return;
      }

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
      const disableExternalRaw = (process.env.WEB_DISABLE_EXTERNAL_MARKET || '').toLowerCase();
      const disableExternal = disableExternalRaw === '1' || disableExternalRaw === 'true';
      if (disableExternal) {
        // 外部市场禁用时，也尝试通过增强数据服务返回覆盖价（若未设置覆盖则可能为 null）
        let ticker = await enhancedOKXDataService.getTicker(symbol);
        // 回退：若 ticker 仍为 null，尝试用最近K线的 close 合成
        if (!ticker) {
          try {
            const klines = await enhancedOKXDataService.getKlineData(symbol, '1m', 1);
            if (Array.isArray(klines) && klines.length > 0) {
              const last = klines[klines.length - 1];
              const price = (last as any)?.close ?? 0;
              if (Number.isFinite(price) && price > 0) {
                ticker = {
                  price,
                  volume: 0,
                  timestamp: Date.now(),
                  high24h: price,
                  low24h: price,
                  change24h: 0,
                  changeFromSodUtc8: 0,
                  open24hPrice: price,
                  sodUtc8Price: price
                } as any;
              }
            }
          } catch (e) {
            // 忽略回退构造中的异常，继续返回 null
          }
        }
        const response: ApiResponse = {
          success: true,
          data: ticker,
          timestamp: Date.now()
        };
        res.json(response);
        return;
      }
      let ticker = await enhancedOKXDataService.getTicker(symbol);
      // 回退：若外部未禁用但 ticker 获取失败，也尝试用最近K线 close 合成
      if (!ticker) {
        try {
          const klines = await enhancedOKXDataService.getKlineData(symbol, '1m', 1);
          if (Array.isArray(klines) && klines.length > 0) {
            const last = klines[klines.length - 1];
            const price = (last as any)?.close ?? 0;
            if (Number.isFinite(price) && price > 0) {
              ticker = {
                price,
                volume: 0,
                timestamp: Date.now(),
                high24h: price,
                low24h: price,
                change24h: 0,
                changeFromSodUtc8: 0,
                open24hPrice: price,
                sodUtc8Price: price
              } as any;
            }
          }
        } catch (e) {
          // 忽略回退构造中的异常，继续返回 null
        }
      }
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
      // 覆盖优先：若允许且有效，则直接返回覆盖值（不走缓存，确保TTL实时生效）
      if (((config as any)?.testing?.allowFGIOverride) === true) {
        const ov = getEffectiveTestingFGIOverride();
        if (typeof ov === 'number' && Number.isFinite(ov)) {
          const valueNum = ov;
          const classification = (() => {
            if (Number.isNaN(valueNum)) return '未知';
            if (valueNum <= 25) return '极度恐惧';
            if (valueNum <= 45) return '恐惧';
            if (valueNum < 55) return '中性';
            if (valueNum <= 75) return '贪婪';
            return '极度贪婪';
          })();
          const normalized = {
            value: valueNum,
            value_classification: classification,
            timestamp: Date.now(),
            time_until_update: null,
            source: 'override'
          } as any;
          const response: ApiResponse = { success: true, data: normalized, timestamp: Date.now() };
          res.json(response);
          return;
        }
      }

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
          takeProfitPercent: config.risk.takeProfitPercent,
          maxSameDirectionActives: Number((config as any)?.risk?.maxSameDirectionActives),
          netExposureCaps: {
            total: Number((config as any)?.risk?.netExposureCaps?.total ?? 0),
            perDirection: {
              LONG: Number((config as any)?.risk?.netExposureCaps?.perDirection?.LONG ?? 0),
              SHORT: Number((config as any)?.risk?.netExposureCaps?.perDirection?.SHORT ?? 0)
            }
          },
          hourlyOrderCaps: {
            total: Number((config as any)?.risk?.hourlyOrderCaps?.total ?? 0),
            perDirection: {
              LONG: Number((config as any)?.risk?.hourlyOrderCaps?.perDirection?.LONG ?? 0),
              SHORT: Number((config as any)?.risk?.hourlyOrderCaps?.perDirection?.SHORT ?? 0)
            }
          }
        },
        strategy: {
          signalThreshold: config.strategy.signalThreshold,
          minWinRate: config.strategy.minWinRate,
          useMLAnalysis: config.strategy.useMLAnalysis,
          analysisInterval: ethStrategyEngine.getAnalysisInterval ? ethStrategyEngine.getAnalysisInterval() : 30000,
          signalCooldownMs: (config as any)?.strategy?.signalCooldownMs,
          oppositeCooldownMs: Number((config as any)?.strategy?.oppositeCooldownMs),
          globalMinIntervalMs: Number(((config as any)?.strategy?.cooldown?.globalMinIntervalMs ?? (config as any)?.strategy?.globalMinIntervalMs ?? 0)),
          cooldown: {
            globalMinIntervalMs: Number(((config as any)?.strategy?.cooldown?.globalMinIntervalMs ?? (config as any)?.strategy?.globalMinIntervalMs ?? 0)),
            sameDir: {
              LONG: Number(((config as any)?.strategy?.cooldown?.sameDir?.LONG ?? NaN)),
              SHORT: Number(((config as any)?.strategy?.cooldown?.sameDir?.SHORT ?? NaN))
            },
            opposite: {
              LONG: Number(((config as any)?.strategy?.cooldown?.opposite?.LONG ?? NaN)),
              SHORT: Number(((config as any)?.strategy?.cooldown?.opposite?.SHORT ?? NaN))
            }
          },
          maxManualTriggersPerMin: Number((config as any)?.strategy?.maxManualTriggersPerMin),
          evThreshold: ((config as any)?.strategy?.evThreshold ?? (config as any)?.strategy?.expectedValueThreshold ?? 0),
          marketRegime: {
            avoidExtremeSentiment: !!((config as any)?.strategy?.marketRegime?.avoidExtremeSentiment),
            extremeSentimentLow: Number((config as any)?.strategy?.marketRegime?.extremeSentimentLow ?? 10),
            extremeSentimentHigh: Number((config as any)?.strategy?.marketRegime?.extremeSentimentHigh ?? 90),
            avoidHighFunding: !!((config as any)?.strategy?.marketRegime?.avoidHighFunding),
            highFundingAbs: Number((config as any)?.strategy?.marketRegime?.highFundingAbs ?? 0.03)
          },
          entryFilters: {
            minCombinedStrengthLong: Number((config as any)?.strategy?.entryFilters?.minCombinedStrengthLong ?? 55),
            minCombinedStrengthShort: Number((config as any)?.strategy?.entryFilters?.minCombinedStrengthShort ?? 55),
            allowHighVolatilityEntries: !!((config as any)?.strategy?.entryFilters?.allowHighVolatilityEntries),
            requireMTFAgreement: !!((config as any)?.strategy?.entryFilters?.requireMTFAgreement),
            minMTFAgreement: Number((config as any)?.strategy?.entryFilters?.minMTFAgreement ?? 0.6),
            require5m15mAlignment: !!((config as any)?.strategy?.entryFilters?.require5m15mAlignment),
            require1hWith5mTrend: !!((config as any)?.strategy?.entryFilters?.require1hWith5mTrend)
          },
          kronos: {
            enabled: !!((config as any)?.strategy?.kronos?.enabled),
            baseUrl: (config as any)?.strategy?.kronos?.baseUrl,
            timeoutMs: Number((config as any)?.strategy?.kronos?.timeoutMs),
            interval: (config as any)?.strategy?.kronos?.interval,
            lookback: Number((config as any)?.strategy?.kronos?.lookback),
            longThreshold: Number((config as any)?.strategy?.kronos?.longThreshold),
            shortThreshold: Number((config as any)?.strategy?.kronos?.shortThreshold),
            minConfidence: Number((config as any)?.strategy?.kronos?.minConfidence)
          },
          allowOppositeWhileOpen: !!((config as any)?.strategy?.allowOppositeWhileOpen),
          oppositeMinConfidence: Number((config as any)?.strategy?.oppositeMinConfidence ?? 0.7),
          oppositeMinConfidenceByDirection: {
            LONG: Number(((config as any)?.strategy?.oppositeMinConfidenceByDirection?.LONG ?? NaN)),
            SHORT: Number(((config as any)?.strategy?.oppositeMinConfidenceByDirection?.SHORT ?? NaN))
          },
          allowAutoOnHighRisk: !!((config as any)?.strategy?.allowAutoOnHighRisk),
          duplicateWindowMinutes: Number(((config as any)?.strategy?.duplicateWindowMinutes ?? 10)),
          duplicatePriceBps: Number(((config as any)?.strategy?.duplicatePriceBps ?? 20))
        },
        // 新增：补充非敏感的 webServer 与 proxy 字段，供前端展示
        webServer: {
          port: (config as any)?.webServer?.port,
          host: (config as any)?.webServer?.host
        },
        proxy: {
          url: (config as any)?.proxy?.url,
          enabled: !!((config as any)?.proxy?.enabled)
        },
        recommendation: {
          maxHoldingHours: Number(((config as any)?.recommendation?.maxHoldingHours ?? (process.env.RECOMMENDATION_MAX_HOLDING_HOURS ?? 168))),
          concurrencyCountAgeHours: Number(((config as any)?.recommendation?.concurrencyCountAgeHours ?? (process.env.RECOMMENDATION_CONCURRENCY_AGE_HOURS ?? 24)))
        },
        commission: Number((config as any)?.commission),
        slippage: Number((config as any)?.slippage)
      };
      
      const response: ApiResponse = {
        success: true,
        data: safeConfig,
        timestamp: Date.now()
      };
      try { console.log('Debug /api/config strategy:', JSON.stringify((response as any)?.data?.strategy)); } catch {}
      res.json(response);
    } catch (error) {
      this.handleError(res, error, 'Failed to get config');
    }
  }

  private async handleUpdateConfig(req: Request, res: Response): Promise<void> {
    try {
      // 为了安全，只允许更新特定的配置项
      const allowedUpdates = ['signalThreshold', 'minWinRate', 'maxPositionSize', 'stopLossPercent', 'useMLAnalysis', 'analysisInterval', 'signalCooldownMs', 'oppositeCooldownMs', 'globalMinIntervalMs', 'duplicateWindowMinutes', 'duplicatePriceBps', 'cooldown', 'oppositeMinConfidenceByDirection', 'maxManualTriggersPerMin', 'maxSameDirectionActives', 'evThreshold', 'marketRegime', 'entryFilters', 'kronos', 'allowOppositeWhileOpen', 'oppositeMinConfidence', 'allowAutoOnHighRisk', 'recommendation', 'testing', 'commission', 'slippage', 'netExposureCaps', 'hourlyOrderCaps'];
      const updates = req.body || {};
      
      // 新增：收集校验告警
      const warnings: string[] = [];
      
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
            } else if (typeof val === 'string') {
              const n = Number(val);
              if (Number.isFinite(n) && n >= 0 && n <= 1) {
                config.strategy.signalThreshold = n;
              } else {
                warnings.push(`signalThreshold must be a number in [0,1], got: ${val}`);
              }
            } else {
              warnings.push('signalThreshold must be a number in [0,1]');
            }
            break;
          case 'minWinRate':
            if (typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 100) {
              (config as any).strategy.minWinRate = val;
            } else if (typeof val === 'string') {
              const n = Number(val);
              if (Number.isFinite(n) && n >= 0 && n <= 100) {
                (config as any).strategy.minWinRate = n;
              } else {
                warnings.push(`minWinRate must be a number in [0,100], got: ${val}`);
              }
            } else {
              warnings.push('minWinRate must be a number in [0,100]');
            }
            break;
          case 'maxPositionSize':
            if (typeof val === 'number' && val > 0) {
              config.risk.maxPositionSize = val;
            } else if (typeof val === 'string') {
              const n = Number(val);
              if (Number.isFinite(n) && n > 0) {
                config.risk.maxPositionSize = n;
              } else {
                warnings.push(`maxPositionSize must be a positive number, got: ${val}`);
              }
            } else {
              warnings.push('maxPositionSize must be a positive number');
            }
            break;
          case 'stopLossPercent':
            if (typeof val === 'number' || typeof val === 'string') {
              const n = Number(val);
              if (Number.isFinite(n) && n > 0) {
                let normalized = n;
                if (normalized >= 1) {
                  normalized = normalized / 100; // 百分比输入自动转换为小数
                  warnings.push(`stopLossPercent interpreted as percent ${n} and normalized to fraction ${normalized}`);
                }
                if (normalized > 0 && normalized < 1) {
                  (config as any).risk.stopLossPercent = normalized;
                } else {
                  warnings.push(`stopLossPercent must be in (0,1), got: ${val}`);
                }
              } else {
                warnings.push('stopLossPercent must be a positive number');
              }
            } else {
              warnings.push('stopLossPercent must be a positive number');
            }
            break;
          case 'useMLAnalysis':
            if (typeof val === 'boolean') {
              config.strategy.useMLAnalysis = val;
            } else if (val === 'true' || val === 'false') {
              config.strategy.useMLAnalysis = (val === 'true');
            } else {
              warnings.push(`useMLAnalysis must be boolean, got: ${val}`);
            }
            break;
          case 'analysisInterval':
            if (typeof val === 'number' && Number.isFinite(val)) {
              ethStrategyEngine.setAnalysisInterval && ethStrategyEngine.setAnalysisInterval(val);
            } else if (typeof val === 'string') {
              const n = parseInt(val, 10);
              if (!Number.isNaN(n)) {
                ethStrategyEngine.setAnalysisInterval && ethStrategyEngine.setAnalysisInterval(n);
              } else {
                warnings.push(`analysisInterval must be a valid number, got: ${val}`);
              }
            } else {
              warnings.push('analysisInterval must be a number');
            }
            break;
          case 'signalCooldownMs':
            if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
              (config as any).strategy.signalCooldownMs = val;
            } else if (typeof val === 'string') {
              const n = parseInt(val, 10);
              if (!Number.isNaN(n) && n >= 0) {
                (config as any).strategy.signalCooldownMs = n;
              } else {
                warnings.push(`signalCooldownMs must be a non-negative integer, got: ${val}`);
              }
            } else {
              warnings.push('signalCooldownMs must be a non-negative integer');
            }
            break;
          case 'oppositeCooldownMs':
            if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
              (config as any).strategy.oppositeCooldownMs = val;
            } else if (typeof val === 'string') {
              const n = parseInt(val, 10);
              if (!Number.isNaN(n) && n >= 0) {
                (config as any).strategy.oppositeCooldownMs = n;
              } else {
                warnings.push(`oppositeCooldownMs must be a non-negative integer, got: ${val}`);
              }
            } else {
              warnings.push('oppositeCooldownMs must be a non-negative integer');
            }
            break;
          case 'globalMinIntervalMs':
            if (typeof val === 'number' || typeof val === 'string') {
              const n = Number(val);
              if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) {
                (config as any).strategy.globalMinIntervalMs = n;
                const cd = ((config as any).strategy.cooldown) || (((config as any).strategy.cooldown) = {});
                (cd as any).globalMinIntervalMs = n;
              } else {
                warnings.push(`globalMinIntervalMs must be a non-negative integer, got: ${val}`);
              }
            } else {
              warnings.push('globalMinIntervalMs must be a non-negative integer');
            }
            break;
          case 'duplicateWindowMinutes':
            if (typeof val === 'number' || typeof val === 'string') {
              const n = Number(val);
              if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) {
                (config as any).strategy.duplicateWindowMinutes = n;
              } else {
                warnings.push(`duplicateWindowMinutes must be a non-negative integer (minutes), got: ${val}`);
              }
            } else {
              warnings.push('duplicateWindowMinutes must be a non-negative integer (minutes)');
            }
            break;
          case 'duplicatePriceBps':
            if (typeof val === 'number' || typeof val === 'string') {
              const n = Number(val);
              if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) {
                (config as any).strategy.duplicatePriceBps = n;
              } else {
                warnings.push(`duplicatePriceBps must be a non-negative integer (bps), got: ${val}`);
              }
            } else {
              warnings.push('duplicatePriceBps must be a non-negative integer (bps)');
            }
            break;
          case 'cooldown':
            if (val && typeof val === 'object') {
              const c = ((config as any).strategy.cooldown) || (((config as any).strategy.cooldown) = {});
              if ('globalMinIntervalMs' in val) {
                const n = Number((val as any).globalMinIntervalMs);
                if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) {
                  (c as any).globalMinIntervalMs = n;
                  (config as any).strategy.globalMinIntervalMs = n;
                } else {
                  warnings.push(`cooldown.globalMinIntervalMs must be a non-negative integer, got: ${(val as any).globalMinIntervalMs}`);
                }
              }
              if ('sameDir' in val) {
                const sd = (val as any).sameDir;
                if (sd && typeof sd === 'object') {
                  const tgt = (c as any).sameDir || (((c as any).sameDir) = {});
                  if ('LONG' in sd) {
                    const n = Number(sd.LONG);
                    if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) { (tgt as any).LONG = n; } else { warnings.push(`cooldown.sameDir.LONG must be a non-negative integer, got: ${sd.LONG}`); }
                  }
                  if ('SHORT' in sd) {
                    const n = Number(sd.SHORT);
                    if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) { (tgt as any).SHORT = n; } else { warnings.push(`cooldown.sameDir.SHORT must be a non-negative integer, got: ${sd.SHORT}`); }
                  }
                } else {
                  warnings.push('cooldown.sameDir must be an object with LONG/SHORT');
                }
              }
              if ('opposite' in val) {
                const op = (val as any).opposite;
                if (op && typeof op === 'object') {
                  const tgt = (c as any).opposite || (((c as any).opposite) = {});
                  if ('LONG' in op) {
                    const n = Number(op.LONG);
                    if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) { (tgt as any).LONG = n; } else { warnings.push(`cooldown.opposite.LONG must be a non-negative integer, got: ${op.LONG}`); }
                  }
                  if ('SHORT' in op) {
                    const n = Number(op.SHORT);
                    if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) { (tgt as any).SHORT = n; } else { warnings.push(`cooldown.opposite.SHORT must be a non-negative integer, got: ${op.SHORT}`); }
                  }
                } else {
                  warnings.push('cooldown.opposite must be an object with LONG/SHORT');
                }
              }
            } else {
              warnings.push('cooldown must be an object');
            }
            break;
          case 'oppositeMinConfidenceByDirection':
            if (val && typeof val === 'object') {
              const m = ((config as any).strategy.oppositeMinConfidenceByDirection) || (((config as any).strategy.oppositeMinConfidenceByDirection) = {});
              if ('LONG' in val) {
                const n = Number((val as any).LONG);
                if (Number.isFinite(n) && n >= 0 && n <= 1) { (m as any).LONG = n; } else { warnings.push(`oppositeMinConfidenceByDirection.LONG must be in [0,1], got: ${(val as any).LONG}`); }
              }
              if ('SHORT' in val) {
                const n = Number((val as any).SHORT);
                if (Number.isFinite(n) && n >= 0 && n <= 1) { (m as any).SHORT = n; } else { warnings.push(`oppositeMinConfidenceByDirection.SHORT must be in [0,1], got: ${(val as any).SHORT}`); }
              }
            } else {
              warnings.push('oppositeMinConfidenceByDirection must be an object with LONG/SHORT in [0,1]');
            }
            break;
          case 'maxManualTriggersPerMin':
            if (typeof val === 'number' && Number.isFinite(val) && val >= 1 && Number.isInteger(val)) {
              (config as any).strategy.maxManualTriggersPerMin = val;
            } else if (typeof val === 'string') {
              const n = Number(val);
              if (Number.isFinite(n) && n >= 1 && Number.isInteger(n)) {
                (config as any).strategy.maxManualTriggersPerMin = n;
              } else {
                warnings.push(`maxManualTriggersPerMin must be an integer >= 1, got: ${val}`);
              }
            } else {
              warnings.push('maxManualTriggersPerMin must be an integer >= 1');
            }
            break;
          case 'maxSameDirectionActives':
            if (typeof val === 'number' && Number.isFinite(val) && val >= 1 && Number.isInteger(val)) {
              (config as any).risk.maxSameDirectionActives = val;
            } else if (typeof val === 'string') {
              const n = Number(val);
              if (Number.isFinite(n) && n >= 1 && Number.isInteger(n)) {
                (config as any).risk.maxSameDirectionActives = n;
              } else {
                warnings.push(`maxSameDirectionActives must be an integer >= 1, got: ${val}`);
              }
            } else {
              warnings.push('maxSameDirectionActives must be an integer >= 1');
            }
            break;
          case 'netExposureCaps':
            if (val && typeof val === 'object') {
              const tgt = ((config as any).risk.netExposureCaps) || (((config as any).risk.netExposureCaps) = { total: 0, perDirection: { LONG: 0, SHORT: 0 } });
              if ('total' in val) {
                const n = Number((val as any).total);
                if (Number.isFinite(n) && n >= 0) { (tgt as any).total = n; } else { warnings.push(`netExposureCaps.total must be a non-negative number, got: ${(val as any).total}`); }
              }
              if ('perDirection' in val) {
                const pd = (val as any).perDirection;
                if (pd && typeof pd === 'object') {
                  const dir = (tgt as any).perDirection || (((tgt as any).perDirection) = {});
                  if ('LONG' in pd) {
                    const n = Number(pd.LONG);
                    if (Number.isFinite(n) && n >= 0) { (dir as any).LONG = n; } else { warnings.push(`netExposureCaps.perDirection.LONG must be a non-negative number, got: ${pd.LONG}`); }
                  }
                  if ('SHORT' in pd) {
                    const n = Number(pd.SHORT);
                    if (Number.isFinite(n) && n >= 0) { (dir as any).SHORT = n; } else { warnings.push(`netExposureCaps.perDirection.SHORT must be a non-negative number, got: ${pd.SHORT}`); }
                  }
                } else {
                  warnings.push('netExposureCaps.perDirection must be an object with LONG/SHORT');
                }
              }
            } else {
              warnings.push('netExposureCaps must be an object with total and optional perDirection');
            }
            break;
          case 'hourlyOrderCaps':
            if (val && typeof val === 'object') {
              const tgt = ((config as any).risk.hourlyOrderCaps) || (((config as any).risk.hourlyOrderCaps) = { total: 0, perDirection: { LONG: 0, SHORT: 0 } });
              if ('total' in val) {
                const n = Number((val as any).total);
                if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) { (tgt as any).total = n; } else { warnings.push(`hourlyOrderCaps.total must be a non-negative integer, got: ${(val as any).total}`); }
              }
              if ('perDirection' in val) {
                const pd = (val as any).perDirection;
                if (pd && typeof pd === 'object') {
                  const dir = (tgt as any).perDirection || (((tgt as any).perDirection) = {});
                  if ('LONG' in pd) {
                    const n = Number(pd.LONG);
                    if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) { (dir as any).LONG = n; } else { warnings.push(`hourlyOrderCaps.perDirection.LONG must be a non-negative integer, got: ${pd.LONG}`); }
                  }
                  if ('SHORT' in pd) {
                    const n = Number(pd.SHORT);
                    if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) { (dir as any).SHORT = n; } else { warnings.push(`hourlyOrderCaps.perDirection.SHORT must be a non-negative integer, got: ${pd.SHORT}`); }
                  }
                } else {
                  warnings.push('hourlyOrderCaps.perDirection must be an object with LONG/SHORT');
                }
              }
            } else {
              warnings.push('hourlyOrderCaps must be an object with total and optional perDirection');
            }
            break;
          case 'entryFilters':
            if (val && typeof val === 'object') {
              const ef = ((config as any).strategy.entryFilters) || (((config as any).strategy.entryFilters) = {});
              if ('minCombinedStrengthLong' in val) {
                const n = Number(val.minCombinedStrengthLong);
                if (Number.isFinite(n) && n >= 0 && n <= 100) ef.minCombinedStrengthLong = n; else warnings.push(`entryFilters.minCombinedStrengthLong must be in [0,100], got: ${val.minCombinedStrengthLong}`);
              }
              if ('minCombinedStrengthShort' in val) {
                const n = Number(val.minCombinedStrengthShort);
                if (Number.isFinite(n) && n >= 0 && n <= 100) ef.minCombinedStrengthShort = n; else warnings.push(`entryFilters.minCombinedStrengthShort must be in [0,100], got: ${val.minCombinedStrengthShort}`);
              }
              if ('allowHighVolatilityEntries' in val) {
                if (typeof val.allowHighVolatilityEntries === 'boolean') ef.allowHighVolatilityEntries = val.allowHighVolatilityEntries; else warnings.push(`entryFilters.allowHighVolatilityEntries must be boolean, got: ${val.allowHighVolatilityEntries}`);
              }
              if ('requireMTFAgreement' in val) {
                if (typeof val.requireMTFAgreement === 'boolean') ef.requireMTFAgreement = val.requireMTFAgreement; else warnings.push(`entryFilters.requireMTFAgreement must be boolean, got: ${val.requireMTFAgreement}`);
              }
              if ('minMTFAgreement' in val) {
                const n = Number(val.minMTFAgreement);
                if (Number.isFinite(n) && n >= 0 && n <= 1) ef.minMTFAgreement = n; else warnings.push(`entryFilters.minMTFAgreement must be in [0,1], got: ${val.minMTFAgreement}`);
              }
              if ('require5m15mAlignment' in val) {
                if (typeof val.require5m15mAlignment === 'boolean') ef.require5m15mAlignment = val.require5m15mAlignment; else warnings.push(`entryFilters.require5m15mAlignment must be boolean, got: ${val.require5m15mAlignment}`);
              }
              if ('require1hWith5mTrend' in val) {
                if (typeof val.require1hWith5mTrend === 'boolean') ef.require1hWith5mTrend = val.require1hWith5mTrend; else warnings.push(`entryFilters.require1hWith5mTrend must be boolean, got: ${val.require1hWith5mTrend}`);
              }
            } else {
              warnings.push('entryFilters must be an object');
            }
            break;
          case 'kronos':
            if (val && typeof val === 'object') {
              const k = (config as any).strategy.kronos || ((config as any).strategy.kronos = {});
              if ('enabled' in val) {
                if (typeof val.enabled === 'boolean') k.enabled = val.enabled; else warnings.push(`kronos.enabled must be boolean, got: ${val.enabled}`);
              }
              if ('baseUrl' in val) {
                if (typeof val.baseUrl === 'string' && /^https?:\/\//.test(val.baseUrl)) k.baseUrl = val.baseUrl; else warnings.push(`kronos.baseUrl must be http(s) URL, got: ${val.baseUrl}`);
              }
              if ('timeoutMs' in val) {
                const n = Number(val.timeoutMs);
                if (Number.isFinite(n) && n > 0) k.timeoutMs = n; else warnings.push(`kronos.timeoutMs must be a positive number, got: ${val.timeoutMs}`);
              }
              if ('interval' in val) {
                if (typeof val.interval === 'string') k.interval = val.interval; else warnings.push(`kronos.interval must be string, got: ${val.interval}`);
              }
              if ('lookback' in val) {
                const n = Number(val.lookback);
                if (Number.isFinite(n) && n > 0) k.lookback = n; else warnings.push(`kronos.lookback must be a positive number, got: ${val.lookback}`);
              }
              if ('longThreshold' in val) {
                const n = Number(val.longThreshold);
                if (Number.isFinite(n) && n >= 0 && n <= 1) k.longThreshold = n; else warnings.push(`kronos.longThreshold must be in [0,1], got: ${val.longThreshold}`);
              }
              if ('shortThreshold' in val) {
                const n = Number(val.shortThreshold);
                if (Number.isFinite(n) && n >= 0 && n <= 1) k.shortThreshold = n; else warnings.push(`kronos.shortThreshold must be in [0,1], got: ${val.shortThreshold}`);
              }
              if ('minConfidence' in val) {
                const n = Number(val.minConfidence);
                if (Number.isFinite(n) && n >= 0 && n <= 1) k.minConfidence = n; else warnings.push(`kronos.minConfidence must be in [0,1], got: ${val.minConfidence}`);
              }
            } else {
              warnings.push('kronos must be an object');
            }
            break;
          case 'allowOppositeWhileOpen':
            if (typeof val === 'boolean') {
              (config as any).strategy.allowOppositeWhileOpen = val;
            } else if (val === 'true' || val === 'false') {
              (config as any).strategy.allowOppositeWhileOpen = (val === 'true');
            } else {
              warnings.push(`allowOppositeWhileOpen must be boolean, got: ${val}`);
            }
            break;
          case 'oppositeMinConfidence':
            if (typeof val === 'number' || typeof val === 'string') {
              const n = Number(val);
              if (Number.isFinite(n) && n >= 0 && n <= 1) {
                (config as any).strategy.oppositeMinConfidence = n;
              } else {
                warnings.push(`oppositeMinConfidence must be in [0,1], got: ${val}`);
              }
            } else {
              warnings.push('oppositeMinConfidence must be a number in [0,1]');
            }
            break;
          case 'allowAutoOnHighRisk':
            if (typeof val === 'boolean') {
              (config as any).strategy.allowAutoOnHighRisk = val;
            } else if (val === 'true' || val === 'false') {
              (config as any).strategy.allowAutoOnHighRisk = (val === 'true');
            } else {
              warnings.push(`allowAutoOnHighRisk must be boolean, got: ${val}`);
            }
            break;
          case 'evThreshold':
            if (val && typeof val === 'object') {
              const obj: any = {};
              if ('default' in val) {
                const n = Number(val.default);
                if (Number.isFinite(n)) obj.default = n; else warnings.push(`evThreshold.default must be a finite number, got: ${val.default}`);
              }
              if ('byVolatility' in val && val.byVolatility && typeof val.byVolatility === 'object') {
                const bv: any = {};
                const keys = ['HIGH','MEDIUM','LOW'] as const;
                for (const k of keys) {
                  if (k in val.byVolatility) {
                    const n = Number(val.byVolatility[k]);
                    if (Number.isFinite(n)) bv[k] = n; else warnings.push(`evThreshold.byVolatility.${k} must be a finite number, got: ${val.byVolatility[k]}`);
                  }
                }
                if (Object.keys(bv).length > 0) obj.byVolatility = bv;
              }
              if ('byRegime' in val && val.byRegime && typeof val.byRegime === 'object') {
                const br: any = {};
                const keys = ['TREND','RANGE'] as const;
                for (const k of keys) {
                  if (k in val.byRegime) {
                    const n = Number(val.byRegime[k]);
                    if (Number.isFinite(n)) br[k] = n; else warnings.push(`evThreshold.byRegime.${k} must be a finite number, got: ${val.byRegime[k]}`);
                  }
                }
                if (Object.keys(br).length > 0) obj.byRegime = br;
              }
              if (Object.keys(obj).length === 0) {
                warnings.push('evThreshold object is empty or invalid; no changes applied');
              } else {
                (config as any).strategy.evThreshold = obj;
                delete (config as any).strategy.expectedValueThreshold;
              }
            } else if (typeof val === 'number' || typeof val === 'string') {
              const n = Number(val);
              if (Number.isFinite(n)) {
                ((config as any).strategy.expectedValueThreshold) = n;
                delete (config as any).strategy.evThreshold;
              } else {
                warnings.push(`evThreshold must be a finite number, got: ${val}`);
              }
            } else {
              warnings.push('evThreshold must be a number or an object');
            }
            break;
          case 'commission':
            if (typeof val === 'number' || typeof val === 'string') {
              const n = Number(val);
              if (Number.isFinite(n) && n >= 0) {
                let normalized = n;
                if (normalized >= 1) {
                  normalized = normalized / 100; // 百分比输入自动转换为小数
                  warnings.push(`commission interpreted as percent ${n} and normalized to fraction ${normalized}`);
                }
                if (normalized >= 0 && normalized < 1) {
                  (config as any).commission = normalized;
                } else {
                  warnings.push(`commission must be in [0,1), got: ${val}`);
                }
              } else {
                warnings.push('commission must be a non-negative number');
              }
            } else {
              warnings.push('commission must be a non-negative number');
            }
            break;
          case 'slippage':
            if (typeof val === 'number' || typeof val === 'string') {
              const n = Number(val);
              if (Number.isFinite(n) && n >= 0) {
                let normalized = n;
                if (normalized >= 1) {
                  normalized = normalized / 100; // 百分比输入自动转换为小数
                  warnings.push(`slippage interpreted as percent ${n} and normalized to fraction ${normalized}`);
                }
                if (normalized >= 0 && normalized < 1) {
                  (config as any).slippage = normalized;
                } else {
                  warnings.push(`slippage must be in [0,1), got: ${val}`);
                }
              } else {
                warnings.push('slippage must be a non-negative number');
              }
            } else {
              warnings.push('slippage must be a non-negative number');
            }
            break;
          case 'marketRegime':
            if (val && typeof val === 'object') {
              const mr = ((config as any).strategy.marketRegime) || (((config as any).strategy.marketRegime) = {});
              if ('avoidExtremeSentiment' in val) {
                if (typeof val.avoidExtremeSentiment === 'boolean') mr.avoidExtremeSentiment = val.avoidExtremeSentiment; else warnings.push(`marketRegime.avoidExtremeSentiment must be boolean, got: ${val.avoidExtremeSentiment}`);
              }
              if ('extremeSentimentLow' in val) {
                const n = Number(val.extremeSentimentLow);
                if (Number.isFinite(n)) mr.extremeSentimentLow = n; else warnings.push(`marketRegime.extremeSentimentLow must be number, got: ${val.extremeSentimentLow}`);
              }
              if ('extremeSentimentHigh' in val) {
                const n = Number(val.extremeSentimentHigh);
                if (Number.isFinite(n)) mr.extremeSentimentHigh = n; else warnings.push(`marketRegime.extremeSentimentHigh must be number, got: ${val.extremeSentimentHigh}`);
              }
              if ('avoidHighFunding' in val) {
                if (typeof val.avoidHighFunding === 'boolean') mr.avoidHighFunding = val.avoidHighFunding; else warnings.push(`marketRegime.avoidHighFunding must be boolean, got: ${val.avoidHighFunding}`);
              }
              if ('highFundingAbs' in val) {
                const n = Number(val.highFundingAbs);
                if (Number.isFinite(n)) mr.highFundingAbs = n; else warnings.push(`marketRegime.highFundingAbs must be number, got: ${val.highFundingAbs}`);
              }
            } else {
              warnings.push('marketRegime must be an object');
            }
            break;
          case 'recommendation':
            if (val && typeof val === 'object') {
              const r = (config as any).recommendation || ((config as any).recommendation = {});
              if ('maxHoldingHours' in val) {
                const n = Number(val.maxHoldingHours);
                if (Number.isFinite(n) && n >= 0) {
                  r.maxHoldingHours = n;
                } else {
                  warnings.push(`recommendation.maxHoldingHours must be a non-negative number (hours), got: ${val.maxHoldingHours}`);
                }
              }
              if ('concurrencyCountAgeHours' in val) {
                const n = Number((val as any).concurrencyCountAgeHours);
                if (Number.isFinite(n) && n >= 0) {
                  (r as any).concurrencyCountAgeHours = n;
                } else {
                  warnings.push(`recommendation.concurrencyCountAgeHours must be a non-negative number (hours), got: ${(val as any).concurrencyCountAgeHours}`);
                }
              }
              if ('trailing' in val) {
                const tv = (val as any).trailing;
                if (tv && typeof tv === 'object') {
                  const t = (r as any).trailing || (((r as any).trailing) = {});
                  if ('enabled' in tv) {
                    if (typeof tv.enabled === 'boolean') t.enabled = tv.enabled; else warnings.push(`recommendation.trailing.enabled must be boolean, got: ${tv.enabled}`);
                  }
                  if ('percent' in tv) {
                    const n = Number(tv.percent);
                    if (Number.isFinite(n) && n >= 0) t.percent = n; else warnings.push(`recommendation.trailing.percent must be a non-negative number, got: ${tv.percent}`);
                  }
                  if ('activateProfitPct' in tv) {
                    const n = Number(tv.activateProfitPct);
                    if (Number.isFinite(n) && n >= 0) t.activateProfitPct = n; else warnings.push(`recommendation.trailing.activateProfitPct must be a non-negative number, got: ${tv.activateProfitPct}`);
                  }
                  if ('activateOnBreakeven' in tv) {
                    if (typeof tv.activateOnBreakeven === 'boolean') t.activateOnBreakeven = tv.activateOnBreakeven; else warnings.push(`recommendation.trailing.activateOnBreakeven must be boolean, got: ${tv.activateOnBreakeven}`);
                  }
                  if ('minStep' in tv) {
                    const n = Number(tv.minStep);
                    if (Number.isFinite(n) && n >= 0) t.minStep = n; else warnings.push(`recommendation.trailing.minStep must be a non-negative number, got: ${tv.minStep}`);
                  }
                  if ('flex' in tv) {
                    const fv = (tv as any).flex;
                    if (fv && typeof fv === 'object') {
                      const f = (t as any).flex || (((t as any).flex) = {});
                      if ('enabled' in fv) {
                        if (typeof fv.enabled === 'boolean') f.enabled = fv.enabled; else warnings.push(`recommendation.trailing.flex.enabled must be boolean, got: ${fv.enabled}`);
                      }
                      if ('lowProfitThreshold' in fv) {
                        const n = Number(fv.lowProfitThreshold);
                        if (Number.isFinite(n) && n >= 0) f.lowProfitThreshold = n; else warnings.push(`recommendation.trailing.flex.lowProfitThreshold must be a non-negative number, got: ${fv.lowProfitThreshold}`);
                      }
                      if ('highProfitThreshold' in fv) {
                        const n = Number(fv.highProfitThreshold);
                        if (Number.isFinite(n) && n >= 0) f.highProfitThreshold = n; else warnings.push(`recommendation.trailing.flex.highProfitThreshold must be a non-negative number, got: ${fv.highProfitThreshold}`);
                      }
                      if ('lowMultiplier' in fv) {
                        const n = Number(fv.lowMultiplier);
                        if (Number.isFinite(n) && n > 0) f.lowMultiplier = n; else warnings.push(`recommendation.trailing.flex.lowMultiplier must be a positive number, got: ${fv.lowMultiplier}`);
                      }
                      if ('highTightenMultiplier' in fv) {
                        const n = Number(fv.highTightenMultiplier);
                        if (Number.isFinite(n) && n > 0) f.highTightenMultiplier = n; else warnings.push(`recommendation.trailing.flex.highTightenMultiplier must be a positive number, got: ${fv.highTightenMultiplier}`);
                      }
                    } else {
                      warnings.push('recommendation.trailing.flex must be an object');
                    }
                  }
                } else {
                  warnings.push('recommendation.trailing must be an object');
                }
              }
            } else {
              warnings.push('recommendation must be an object');
            }
            break;
          case 'testing':
            if (val && typeof val === 'object') {
              const t = (config as any).testing || (((config as any).testing) = {});
              if ('allowPriceOverride' in val) {
                if (typeof (val as any).allowPriceOverride === 'boolean') t.allowPriceOverride = (val as any).allowPriceOverride; else warnings.push(`testing.allowPriceOverride must be boolean, got: ${(val as any).allowPriceOverride}`);
              }
              if ('priceOverrideDefaultTtlMs' in val) {
                const n = Number((val as any).priceOverrideDefaultTtlMs);
                if (Number.isFinite(n) && n >= 0) t.priceOverrideDefaultTtlMs = n; else warnings.push(`testing.priceOverrideDefaultTtlMs must be a non-negative number, got: ${(val as any).priceOverrideDefaultTtlMs}`);
              }
              if ('allowFGIOverride' in val) {
                if (typeof (val as any).allowFGIOverride === 'boolean') t.allowFGIOverride = (val as any).allowFGIOverride; else warnings.push(`testing.allowFGIOverride must be boolean, got: ${(val as any).allowFGIOverride}`);
              }
              if ('fgiOverrideDefaultTtlMs' in val) {
                const n = Number((val as any).fgiOverrideDefaultTtlMs);
                if (Number.isFinite(n) && n >= 0) t.fgiOverrideDefaultTtlMs = n; else warnings.push(`testing.fgiOverrideDefaultTtlMs must be a non-negative number, got: ${(val as any).fgiOverrideDefaultTtlMs}`);
              }
              if ('allowFundingOverride' in val) {
                if (typeof (val as any).allowFundingOverride === 'boolean') t.allowFundingOverride = (val as any).allowFundingOverride; else warnings.push(`testing.allowFundingOverride must be boolean, got: ${(val as any).allowFundingOverride}`);
              }
              if ('fundingOverrideDefaultTtlMs' in val) {
                const n = Number((val as any).fundingOverrideDefaultTtlMs);
                if (Number.isFinite(n) && n >= 0) t.fundingOverrideDefaultTtlMs = n; else warnings.push(`testing.fundingOverrideDefaultTtlMs must be a non-negative number, got: ${(val as any).fundingOverrideDefaultTtlMs}`);
              }
            } else {
              warnings.push('testing must be an object');
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
            // 兼容旧字段
            signalCooldownMs: Number((config as any)?.strategy?.signalCooldownMs),
            oppositeCooldownMs: Number((config as any)?.strategy?.oppositeCooldownMs),
            // 新增：全局与方向级冷却配置
            globalMinIntervalMs: Number(((config as any)?.strategy?.cooldown?.globalMinIntervalMs ?? (config as any)?.strategy?.globalMinIntervalMs ?? 0)),
            cooldown: {
              globalMinIntervalMs: Number(((config as any)?.strategy?.cooldown?.globalMinIntervalMs ?? (config as any)?.strategy?.globalMinIntervalMs ?? 0)),
              sameDir: {
                LONG: Number(((config as any)?.strategy?.cooldown?.sameDir?.LONG ?? NaN)),
                SHORT: Number(((config as any)?.strategy?.cooldown?.sameDir?.SHORT ?? NaN))
              },
              opposite: {
                LONG: Number(((config as any)?.strategy?.cooldown?.opposite?.LONG ?? NaN)),
                SHORT: Number(((config as any)?.strategy?.cooldown?.opposite?.SHORT ?? NaN))
              }
            },
            maxManualTriggersPerMin: Number((config as any)?.strategy?.maxManualTriggersPerMin),
            evThreshold: ((config as any)?.strategy?.evThreshold ?? (config as any)?.strategy?.expectedValueThreshold ?? 0),
            marketRegime: {
              avoidExtremeSentiment: !!((config as any)?.strategy?.marketRegime?.avoidExtremeSentiment),
              extremeSentimentLow: Number((config as any)?.strategy?.marketRegime?.extremeSentimentLow ?? 10),
              extremeSentimentHigh: Number((config as any)?.strategy?.marketRegime?.extremeSentimentHigh ?? 90),
              avoidHighFunding: !!((config as any)?.strategy?.marketRegime?.avoidHighFunding),
              highFundingAbs: Number((config as any)?.strategy?.marketRegime?.highFundingAbs ?? 0.03)
            },
            entryFilters: {
              minCombinedStrengthLong: Number((config as any)?.strategy?.entryFilters?.minCombinedStrengthLong ?? 55),
              minCombinedStrengthShort: Number((config as any)?.strategy?.entryFilters?.minCombinedStrengthShort ?? 55),
              allowHighVolatilityEntries: !!((config as any)?.strategy?.entryFilters?.allowHighVolatilityEntries),
              requireMTFAgreement: !!((config as any)?.strategy?.entryFilters?.requireMTFAgreement),
              minMTFAgreement: Number((config as any)?.strategy?.entryFilters?.minMTFAgreement ?? 0.6),
              require5m15mAlignment: !!((config as any)?.strategy?.entryFilters?.require5m15mAlignment),
              require1hWith5mTrend: !!((config as any)?.strategy?.entryFilters?.require1hWith5mTrend)
            },
            kronos: {
              enabled: !!((config as any)?.strategy?.kronos?.enabled),
              baseUrl: (config as any)?.strategy?.kronos?.baseUrl,
              timeoutMs: Number((config as any)?.strategy?.kronos?.timeoutMs),
              interval: (config as any)?.strategy?.kronos?.interval,
              lookback: Number((config as any)?.strategy?.kronos?.lookback),
              longThreshold: Number((config as any)?.strategy?.kronos?.longThreshold),
              shortThreshold: Number((config as any)?.strategy?.kronos?.shortThreshold),
              minConfidence: Number((config as any)?.strategy?.kronos?.minConfidence)
            },
            allowOppositeWhileOpen: !!((config as any)?.strategy?.allowOppositeWhileOpen),
            oppositeMinConfidence: Number((config as any)?.strategy?.oppositeMinConfidence ?? 0.7),
            oppositeMinConfidenceByDirection: {
              LONG: Number(((config as any)?.strategy?.oppositeMinConfidenceByDirection?.LONG ?? NaN)),
              SHORT: Number(((config as any)?.strategy?.oppositeMinConfidenceByDirection?.SHORT ?? NaN))
            },
            allowAutoOnHighRisk: !!((config as any)?.strategy?.allowAutoOnHighRisk)
          },
          risk: {
          maxPositionSize: config.risk.maxPositionSize,
          stopLossPercent: config.risk.stopLossPercent,
          maxSameDirectionActives: Number((config as any)?.risk?.maxSameDirectionActives),
          netExposureCaps: {
            total: Number((config as any)?.risk?.netExposureCaps?.total ?? 0),
            perDirection: {
              LONG: Number((config as any)?.risk?.netExposureCaps?.perDirection?.LONG ?? 0),
              SHORT: Number((config as any)?.risk?.netExposureCaps?.perDirection?.SHORT ?? 0)
            }
          }
        },
          recommendation: {
            maxHoldingHours: Number(((config as any)?.recommendation?.maxHoldingHours ?? (process.env.RECOMMENDATION_MAX_HOLDING_HOURS ?? 168))),
            concurrencyCountAgeHours: Number(((config as any)?.recommendation?.concurrencyCountAgeHours ?? (process.env.RECOMMENDATION_CONCURRENCY_AGE_HOURS ?? 24)))
          },
          commission: Number((config as any)?.commission),
          slippage: Number((config as any)?.slippage),
          warnings
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
        
        // 发送市场数据更新（CI可禁用）
        const disableExternalRaw = (process.env.WEB_DISABLE_EXTERNAL_MARKET || '').toLowerCase();
        const disableExternal = disableExternalRaw === '1' || disableExternalRaw === 'true';
        if (!disableExternal) {
          const marketData = await enhancedOKXDataService.getTicker(config.trading.defaultSymbol);
          if (marketData) {
            this.io.to('strategy-updates').emit('market-data', marketData);
          }
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
          
          // 允许通过环境变量禁用实时更新（CI/测试环境）
          const disableRealtimeRaw = process.env.WEB_DISABLE_REALTIME || '';
          const disableRealtime = disableRealtimeRaw.toLowerCase() === '1' || disableRealtimeRaw.toLowerCase() === 'true';
          if (disableRealtime) {
            console.log('⏸️ 实时更新已禁用 (WEB_DISABLE_REALTIME)');
          } else {
            this.startRealTimeUpdates();
          }
          
          // 允许通过环境变量禁用推荐系统初始化（CI/测试环境）
          const disableRecoInitRaw = process.env.WEB_DISABLE_RECO_INIT || '';
          const disableRecoInit = disableRecoInitRaw.toLowerCase() === '1' || disableRecoInitRaw.toLowerCase() === 'true';
          if (disableRecoInit) {
            console.log('⏸️ 推荐系统初始化已禁用 (WEB_DISABLE_RECO_INIT)');
          } else {
            // 异步初始化推荐系统，不阻塞Web服务器启动
            this.initializeRecommendationSystemAsync();
          }
          
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

      // 启动回放：在服务器就绪后尝试从文件回放并应用最佳配置（可通过 CONFIG_PLAYBACK_PATH 指定路径，默认 ./config-best.json）
      try {
        const pathMod: any = await import('path');
        const fsMod: any = await import('fs');
        const fs = (fsMod as any).promises;
        const envPath = process.env.CONFIG_PLAYBACK_PATH || './config-best.json';
        const playbackPath = pathMod.resolve(process.cwd(), envPath);
        const stat = await fs.stat(playbackPath).catch(() => null);
        if (!stat || !stat.isFile()) {
          console.log(`ℹ️ 启动回放：未发现配置快照 ${playbackPath}，跳过`);
        } else {
          console.log(`🔁 启动回放：加载 ${playbackPath}`);
          const raw = await fs.readFile(playbackPath, 'utf8');
          let json: any = null;
          try { json = JSON.parse(raw); } catch (e: any) {
            console.warn('启动回放：JSON 解析失败，跳过', e?.message ?? e);
          }
          if (json) {
            const updates: any = {};
            const src: any = json?.data ? json.data : json;
            const pick = (obj: any, path: string[]) => path.reduce((a: any, k: string) => (a && typeof a === 'object') ? a[k] : undefined, obj);
            const setIf = (key: string, val: any, pred: (v: any) => boolean = (v) => v !== undefined && v !== null) => { if (pred(val)) updates[key] = val; };

            // strategy
            setIf('signalThreshold', pick(src, ['strategy','signalThreshold']));
            setIf('minWinRate', pick(src, ['strategy','minWinRate']));
            setIf('useMLAnalysis', pick(src, ['strategy','useMLAnalysis']));
            setIf('analysisInterval', pick(src, ['strategy','analysisInterval']));
            setIf('signalCooldownMs', pick(src, ['strategy','signalCooldownMs']));
            setIf('oppositeCooldownMs', pick(src, ['strategy','oppositeCooldownMs']));
            setIf('globalMinIntervalMs', pick(src, ['strategy','globalMinIntervalMs']));
            setIf('duplicateWindowMinutes', pick(src, ['strategy','duplicateWindowMinutes']));
            setIf('duplicatePriceBps', pick(src, ['strategy','duplicatePriceBps']));
            setIf('cooldown', pick(src, ['strategy','cooldown']));
            setIf('oppositeMinConfidenceByDirection', pick(src, ['strategy','oppositeMinConfidenceByDirection']));
            setIf('maxManualTriggersPerMin', pick(src, ['strategy','maxManualTriggersPerMin']));
            setIf('evThreshold', pick(src, ['strategy','evThreshold']));
            setIf('marketRegime', pick(src, ['strategy','marketRegime']));
            setIf('entryFilters', pick(src, ['strategy','entryFilters']));
            setIf('kronos', pick(src, ['strategy','kronos']));
            setIf('allowOppositeWhileOpen', pick(src, ['strategy','allowOppositeWhileOpen']));
            setIf('oppositeMinConfidence', pick(src, ['strategy','oppositeMinConfidence']));
            setIf('allowAutoOnHighRisk', pick(src, ['strategy','allowAutoOnHighRisk']));

            // risk
            setIf('maxPositionSize', pick(src, ['risk','maxPositionSize']));
            setIf('stopLossPercent', pick(src, ['risk','stopLossPercent']));
            setIf('maxSameDirectionActives', pick(src, ['risk','maxSameDirectionActives']));
            setIf('netExposureCaps', pick(src, ['risk','netExposureCaps']));
            setIf('hourlyOrderCaps', pick(src, ['risk','hourlyOrderCaps']));

            // recommendation & costs
            setIf('recommendation', pick(src, ['recommendation']));
            setIf('commission', src?.commission);
            setIf('slippage', src?.slippage);

            // 如果快照中没有任何可更新项，回退到内置最佳基线
            if (Object.keys(updates).length === 0) {
              updates.signalThreshold = 0.5;
              updates.minWinRate = 55;
              updates.allowOppositeWhileOpen = false;
              updates.oppositeMinConfidence = 0.7;
              updates.maxPositionSize = 0.2;
              updates.stopLossPercent = 0.02;
              updates.netExposureCaps = { total: 0, perDirection: { LONG: 0, SHORT: 0 } };
              updates.hourlyOrderCaps = { total: 0, perDirection: { LONG: 0, SHORT: 0 } };
              updates.recommendation = { maxHoldingHours: 168, concurrencyCountAgeHours: 24 };
              updates.commission = 0.001;
              updates.slippage = 0.0005;
            }

            const url = `http://localhost:${this.port}/api/config`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            try {
              const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
                signal: controller.signal
              });
              clearTimeout(timer);
              if (!resp.ok) {
                console.warn(`启动回放：更新失败 HTTP ${resp.status}`);
              } else {
                let ret: any = null;
                try { ret = await resp.json(); } catch {}
                const warn = ret?.data?.warnings;
                if (Array.isArray(warn) && warn.length > 0) {
                  console.log('启动回放：已应用，包含警告：', warn);
                } else {
                  console.log('启动回放：最佳配置已应用');
                }
              }
            } catch (e: any) {
              console.warn('启动回放：请求失败，跳过', e?.message ?? e);
            }
          }
        }
      } catch (e: any) {
        console.warn('启动回放：发生异常，已跳过', e?.message ?? e);
      }
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

// 仅当作为入口文件直接执行时才自动启动 Web 服务器，避免被 app.ts 导入时重复监听导致 ERR_SERVER_ALREADY_LISTEN
try {
  const isDirectRun = (() => {
    const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const modulePath = fileURLToPath(import.meta.url);
    return argvPath && argvPath === modulePath;
  })();

  if (isDirectRun) {
    console.log('🟢 直接执行 web-server.ts，自动启动 Web 服务器');
    console.log('🚀 开始启动Web服务器...');
    webServer.start().catch((err) => {
      console.error('❌ Web服务器启动失败:', err);
      process.exit(1);
    });
  } else {
    console.log('ℹ️ web-server 作为模块被导入（例如由 app.ts），不自动启动');
  }
} catch (e) {
  console.warn('⚠️ 自动启动判定失败，作为模块使用，跳过自启：', (e as any)?.message ?? e);
}