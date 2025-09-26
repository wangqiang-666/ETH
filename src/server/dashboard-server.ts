import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import RealTimeTradingEngine from '../services/real-time-trading-engine';
import { BinanceConfig } from '../services/binance-api-service';
import { DatabaseService } from '../services/database-service';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DashboardConfig {
  port: number;
  binanceConfig: BinanceConfig;
  symbol?: string;
  interval?: string;
}

export class DashboardServer {
  private app: express.Application;
  private server: any;
  private io: SocketIOServer;
  private tradingEngine: RealTimeTradingEngine | null = null;
  private dbService: DatabaseService;
  private config: DashboardConfig;
  private isRunning = false;

  constructor(config: DashboardConfig) {
    this.config = config;
    this.app = express();
    this.server = createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    this.dbService = new DatabaseService();
    
    this.setupExpress();
    this.setupSocketIO();
    
    console.log('🌐 Dashboard服务器初始化完成');
  }

  /**
   * 设置Express服务器
   */
  private setupExpress(): void {
    // 静态文件服务
    this.app.use(express.static(path.join(__dirname)));
    // 添加picture文件夹的静态文件服务 - 使用绝对路径
    const projectRoot = path.resolve(__dirname, '../..');
    this.app.use('/picture', express.static(path.join(projectRoot, 'picture')));
    this.app.use(express.json());

    // 主页路由
    this.app.get('/', (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'trading-dashboard.html'));
    });

    // API路由
    this.app.get('/api/status', (req: Request, res: Response) => {
      res.json({
        isRunning: this.isRunning,
        tradingActive: this.tradingEngine?.getState().isActive || false,
        connectionStatus: this.tradingEngine ? 'connected' : 'disconnected',
        timestamp: Date.now()
      });
    });

    this.app.get('/api/stats', async (req: Request, res: Response) => {
      try {
        const stats = await this.dbService.getTradeStats();
        res.json(stats);
      } catch (error) {
        res.status(500).json({ error: 'Failed to get stats' });
      }
    });

    this.app.get('/api/trades', async (req: Request, res: Response) => {
      try {
        const limit = parseInt(req.query.limit as string) || 10;
        const trades = await this.dbService.getRecentTrades(limit);
        res.json(trades);
      } catch (error) {
        res.status(500).json({ error: 'Failed to get trades' });
      }
    });

    this.app.post('/api/config', (req: Request, res: Response) => {
      try {
        if (this.tradingEngine) {
          // 更新交易引擎配置
          // 这里需要实现配置更新逻辑
          res.json({ success: true, message: 'Configuration updated' });
        } else {
          res.status(400).json({ error: 'Trading engine not initialized' });
        }
      } catch (error) {
        res.status(500).json({ error: 'Failed to update config' });
      }
    });

    console.log('✅ Express服务器配置完成');
  }

  /**
   * 设置Socket.IO
   */
  private setupSocketIO(): void {
    this.io.on('connection', (socket: Socket) => {
      console.log(`🔌 客户端连接: ${socket.id}`);

      // 发送初始状态
      this.sendInitialState(socket);

      // 启动交易
      socket.on('startTrading', async (apiConfig: any) => {
        try {
          await this.startTrading(apiConfig);
          socket.emit('tradingStarted');
          this.io.emit('systemMessage', { 
            type: 'success', 
            message: '交易引擎启动成功' 
          });
        } catch (error: any) {
          socket.emit('error', { message: error.message });
          this.io.emit('systemMessage', { 
            type: 'error', 
            message: `启动失败: ${error.message}` 
          });
          console.error('❌ 启动交易失败:', error);
        }
      });

      // 停止交易
      socket.on('stopTrading', async () => {
        try {
          await this.stopTrading();
          socket.emit('tradingStopped');
          this.io.emit('systemMessage', { 
            type: 'warning', 
            message: '交易引擎已停止' 
          });
        } catch (error: any) {
          socket.emit('error', { message: error.message });
          console.error('❌ 停止交易失败:', error);
        }
      });

      // 更新配置
      socket.on('updateConfig', (newConfig: any) => {
        try {
          this.updateTradingConfig(newConfig);
          socket.emit('configUpdated');
          this.io.emit('systemMessage', { 
            type: 'info', 
            message: '配置已更新' 
          });
        } catch (error: any) {
          socket.emit('error', { message: error.message });
        }
      });

      // 导出数据
      socket.on('exportData', async () => {
        try {
          const data = await this.exportTradingData();
          socket.emit('dataExported', data);
        } catch (error: any) {
          socket.emit('error', { message: error.message });
        }
      });

      // 获取历史数据
      socket.on('getHistory', async (params: any) => {
        try {
          const history = await this.getHistoryData(params);
          socket.emit('historyData', history);
        } catch (error: any) {
          socket.emit('error', { message: error.message });
        }
      });

      // 测试API连接
      socket.on('testApiConnection', async (apiConfig: any) => {
        try {
          await this.testApiConnection(apiConfig, socket);
        } catch (error: any) {
          socket.emit('error', { message: error.message });
          this.io.emit('systemMessage', { 
            type: 'error', 
            message: `API测试失败: ${error.message}` 
          });
        }
      });

      // 客户端断开连接
      socket.on('disconnect', () => {
        console.log(`🔌 客户端断开: ${socket.id}`);
      });
    });

    console.log('✅ Socket.IO配置完成');
  }

  /**
   * 发送初始状态
   */
  private sendInitialState(socket: Socket): void {
    const state = {
      isRunning: this.isRunning,
      tradingActive: this.tradingEngine?.getState().isActive || false,
      balance: this.tradingEngine?.getState().balance || 0,
      totalPnl: this.tradingEngine?.getState().totalPnl || 0,
      totalTrades: (this.tradingEngine?.getState().winningTrades || 0) + (this.tradingEngine?.getState().losingTrades || 0),
      winningTrades: this.tradingEngine?.getState().winningTrades || 0,
      dailyTrades: this.tradingEngine?.getState().dailyTrades || 0,
      consecutiveLosses: this.tradingEngine?.getState().consecutiveLosses || 0,
      maxDrawdown: this.tradingEngine?.getState().maxDrawdown || 0,
      positions: Array.from(this.tradingEngine?.getState().positions.values() || []),
      timestamp: Date.now()
    };

    socket.emit('initialState', state);
  }

  /**
   * 启动交易引擎
   */
  private async startTrading(apiConfig?: any): Promise<void> {
    if (this.tradingEngine && this.isRunning) {
      throw new Error('交易引擎已在运行');
    }

    console.log('🚀 启动交易引擎...');

    // 使用前端传入的API配置或默认配置
    let binanceConfig = this.config.binanceConfig;
    let customParameters = {};
    
    if (apiConfig && apiConfig.apiKey && apiConfig.apiSecret) {
      console.log(`🔑 使用前端配置的API密钥 (${apiConfig.testnet ? '测试网' : '正式网'})`);
      binanceConfig = {
        apiKey: apiConfig.apiKey,
        apiSecret: apiConfig.apiSecret,
        testnet: apiConfig.testnet || false,
        recvWindow: this.config.binanceConfig.recvWindow || 5000
      };
      
      // 如果前端传入了单笔交易金额，使用它覆盖默认值
      if (apiConfig.positionSize && apiConfig.positionSize > 0) {
        customParameters = { basePositionSize: apiConfig.positionSize };
        console.log(`💰 使用自定义单笔交易金额: ${apiConfig.positionSize} USDT`);
      }
    }

    // 创建交易引擎
    this.tradingEngine = new RealTimeTradingEngine(
      binanceConfig,
      this.config.symbol || 'ETHUSDT',
      this.config.interval || '1m',
      customParameters
    );

    // 设置事件监听器
    this.setupTradingEngineEvents();

    // 启动交易引擎
    await this.tradingEngine.start();
    this.isRunning = true;

    console.log('✅ 交易引擎启动成功');
  }

  /**
   * 停止交易引擎
   */
  private async stopTrading(): Promise<void> {
    if (!this.tradingEngine || !this.isRunning) {
      throw new Error('交易引擎未运行');
    }

    console.log('🛑 停止交易引擎...');

    await this.tradingEngine.stop();
    this.isRunning = false;

    console.log('✅ 交易引擎已停止');
  }

  /**
   * 设置交易引擎事件监听器
   */
  private setupTradingEngineEvents(): void {
    if (!this.tradingEngine) return;

    // K线数据更新
    this.tradingEngine.on('kline', (kline) => {
      this.io.emit('kline', kline);
    });

    // 持仓更新
    this.tradingEngine.on('positionOpened', (position) => {
      this.io.emit('positionUpdate', {
        type: 'opened',
        position
      });
      this.broadcastTradingState();
    });

    this.tradingEngine.on('positionClosed', (data) => {
      this.io.emit('positionUpdate', {
        type: 'closed',
        position: data.position,
        reason: data.reason,
        closePrice: data.closePrice
      });
      
      this.io.emit('tradeCompleted', {
        id: data.position.id,
        symbol: data.position.symbol,
        side: data.position.side,
        entryPrice: data.position.entryPrice,
        exitPrice: data.closePrice,
        quantity: data.position.quantity,
        pnl: data.position.pnl,
        fees: data.position.fees,
        timestamp: Date.now(),
        reason: data.reason
      });
      
      this.broadcastTradingState();
    });

    // 余额更新
    this.tradingEngine.on('balanceUpdate', (balance) => {
      this.io.emit('balanceUpdate', balance);
      this.broadcastTradingState();
    });

    // 订单更新
    this.tradingEngine.on('orderUpdate', (order) => {
      this.io.emit('orderUpdate', order);
    });

    // 错误处理
    this.tradingEngine.on('error', (error) => {
      console.error('❌ 交易引擎错误:', error);
      this.io.emit('error', { message: error.message });
    });

    // 引擎状态变化
    this.tradingEngine.on('started', () => {
      this.io.emit('engineStatus', { status: 'started' });
      this.broadcastTradingState();
    });

    this.tradingEngine.on('stopped', () => {
      this.io.emit('engineStatus', { status: 'stopped' });
      this.broadcastTradingState();
    });

    this.tradingEngine.on('paused', () => {
      this.io.emit('engineStatus', { status: 'paused' });
    });

    this.tradingEngine.on('resumed', () => {
      this.io.emit('engineStatus', { status: 'resumed' });
    });

    console.log('✅ 交易引擎事件监听器设置完成');
  }

  /**
   * 广播交易状态
   */
  private broadcastTradingState(): void {
    if (!this.tradingEngine) return;

    const state = this.tradingEngine.getState();
    const performanceStats = this.tradingEngine.getPerformanceStats();

    const tradingState = {
      ...state,
      ...performanceStats,
      positions: Array.from(state.positions.values()),
      timestamp: Date.now()
    };

    this.io.emit('tradingState', tradingState);
  }

  /**
   * 更新交易配置
   */
  private updateTradingConfig(newConfig: any): void {
    // 这里需要实现配置更新逻辑
    // 由于交易引擎已经初始化，可能需要重启或动态更新
    console.log('📝 更新交易配置:', newConfig);
    
    // 暂时只记录配置更新，实际实现需要更复杂的逻辑
    if (this.tradingEngine) {
      // 可以通过事件或方法更新配置
      console.log('⚠️ 配置更新需要重启交易引擎才能生效');
    }
  }

  /**
   * 导出交易数据
   */
  private async exportTradingData(): Promise<any> {
    try {
      const trades = await this.dbService.getRecentTrades(1000);
      const stats = await this.dbService.getTradeStats();
      
      const exportData = {
        timestamp: new Date().toISOString(),
        stats,
        trades,
        currentState: this.tradingEngine?.getState() || null,
        performanceStats: this.tradingEngine?.getPerformanceStats() || null
      };

      console.log('📊 数据导出完成');
      return exportData;
      
    } catch (error) {
      console.error('❌ 数据导出失败:', error);
      throw error;
    }
  }

  /**
   * 获取历史数据
   */
  private async getHistoryData(params: any): Promise<any> {
    try {
      const { type, limit = 100, startTime, endTime } = params;
      
      switch (type) {
        case 'trades':
          return await this.dbService.getRecentTrades(limit);
        case 'stats':
          return await this.dbService.getTradeStats();
        default:
          throw new Error(`Unknown history type: ${type}`);
      }
    } catch (error) {
      console.error('❌ 获取历史数据失败:', error);
      throw error;
    }
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    try {
      // 初始化数据库
      await this.dbService.initialize();
      
      // 启动HTTP服务器
      this.server.listen(this.config.port, () => {
        console.log(`🌐 Dashboard服务器启动成功`);
        console.log(`📊 访问地址: http://localhost:${this.config.port}`);
        console.log(`🔌 WebSocket端口: ${this.config.port}`);
      });

      // 定期广播状态更新
      setInterval(() => {
        if (this.tradingEngine && this.isRunning) {
          this.broadcastTradingState();
        }
      }, 5000); // 每5秒更新一次

      console.log('✅ Dashboard服务器完全启动');
      
    } catch (error) {
      console.error('❌ Dashboard服务器启动失败:', error);
      throw error;
    }
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    console.log('🛑 停止Dashboard服务器...');
    
    try {
      // 停止交易引擎
      if (this.tradingEngine && this.isRunning) {
        await this.stopTrading();
      }

      // 关闭Socket.IO
      this.io.close();

      // 关闭HTTP服务器
      this.server.close();

      // 关闭数据库连接
      await this.dbService.close();

      console.log('✅ Dashboard服务器已停止');
      
    } catch (error) {
      console.error('❌ 停止Dashboard服务器失败:', error);
      throw error;
    }
  }

  /**
   * 测试API连接
   */
  private async testApiConnection(apiConfig: any, socket: Socket): Promise<void> {
    console.log(`🔍 测试API连接 (${apiConfig.testnet ? '测试网' : '正式网'})`);
    
    try {
      // 动态导入BinanceApiService
      const { BinanceApiService } = await import('../services/binance-api-service');
      
      // 创建临时的API服务实例
      const tempApiService = new BinanceApiService({
        apiKey: apiConfig.apiKey,
        apiSecret: apiConfig.apiSecret,
        testnet: apiConfig.testnet || false,
        recvWindow: 5000
      });

      // 测试连接
      const accountInfo = await tempApiService.getAccountInfo();
      
      // 测试成功
      socket.emit('systemMessage', { 
        type: 'success', 
        message: `✅ API连接测试成功！账户可交易: ${accountInfo.canTrade ? '是' : '否'}` 
      });
      
      console.log(`✅ API连接测试成功 - 账户可交易: ${accountInfo.canTrade}`);
      
    } catch (error: any) {
      // 测试失败
      const errorMessage = error.message.includes('API-key format invalid') 
        ? 'API密钥格式无效，请检查密钥是否正确'
        : error.message.includes('Invalid API-key')
        ? 'API密钥无效，请检查密钥权限设置'
        : error.message.includes('Signature for this request is not valid')
        ? 'API密钥签名无效，请检查密钥密码是否正确'
        : `连接失败: ${error.message}`;
        
      socket.emit('systemMessage', { 
        type: 'error', 
        message: errorMessage 
      });
      
      console.error(`❌ API连接测试失败:`, error.message);
      // 不要抛出错误，让前端正常处理
    }
  }

  /**
   * 获取服务器状态
   */
  getStatus(): any {
    return {
      isRunning: this.isRunning,
      tradingActive: this.tradingEngine?.getState().isActive || false,
      port: this.config.port,
      connectedClients: this.io.engine.clientsCount,
      uptime: process.uptime(),
      timestamp: Date.now()
    };
  }
}

export default DashboardServer;