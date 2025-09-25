/**
 * 增强仪表板 - 用户体验优化
 * 提供专业级的可视化界面和交互体验
 */

export interface DashboardConfig {
  theme: 'light' | 'dark' | 'auto';
  layout: 'grid' | 'flex' | 'masonry';
  refreshInterval: number;
  autoRefresh: boolean;
  notifications: boolean;
  soundAlerts: boolean;
  compactMode: boolean;
}

export interface ChartConfig {
  type: 'line' | 'candlestick' | 'area' | 'bar' | 'heatmap';
  timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  indicators: string[];
  overlays: string[];
  colors: {
    primary: string;
    secondary: string;
    success: string;
    warning: string;
    danger: string;
  };
}

export interface WidgetConfig {
  id: string;
  type: 'chart' | 'metrics' | 'positions' | 'orders' | 'alerts' | 'performance' | 'ml' | 'risk';
  title: string;
  size: 'small' | 'medium' | 'large' | 'xlarge';
  position: { x: number; y: number; w: number; h: number };
  visible: boolean;
  config: Record<string, any>;
}

export class EnhancedDashboard {
  private config: DashboardConfig;
  private widgets: Map<string, WidgetConfig> = new Map();
  private charts: Map<string, ChartConfig> = new Map();
  private container: HTMLElement | null = null;
  private refreshTimer?: NodeJS.Timeout;
  private websocket?: WebSocket;
  private notifications: Notification[] = [];

  constructor(containerId: string, config?: Partial<DashboardConfig>) {
    this.config = {
      theme: 'dark',
      layout: 'grid',
      refreshInterval: 5000,
      autoRefresh: true,
      notifications: true,
      soundAlerts: false,
      compactMode: false,
      ...config
    };

    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container element with id '${containerId}' not found`);
    }

    this.initializeDashboard();
    this.setupEventListeners();
    this.loadUserPreferences();
  }

  /**
   * 初始化仪表板
   */
  private initializeDashboard(): void {
    if (!this.container) return;

    // 设置主题
    this.applyTheme();

    // 创建仪表板结构
    this.container.innerHTML = `
      <div class="dashboard-header">
        <div class="dashboard-title">
          <h1>🚀 ETH智能交易系统</h1>
          <div class="system-status">
            <span class="status-indicator" id="systemStatus">●</span>
            <span class="status-text" id="systemStatusText">系统运行中</span>
          </div>
        </div>
        <div class="dashboard-controls">
          <button class="btn btn-icon" id="refreshBtn" title="刷新数据">
            <span class="icon">🔄</span>
          </button>
          <button class="btn btn-icon" id="settingsBtn" title="设置">
            <span class="icon">⚙️</span>
          </button>
          <button class="btn btn-icon" id="fullscreenBtn" title="全屏">
            <span class="icon">⛶</span>
          </button>
          <button class="btn btn-icon" id="themeBtn" title="切换主题">
            <span class="icon">🌓</span>
          </button>
        </div>
      </div>
      
      <div class="dashboard-content" id="dashboardContent">
        <div class="dashboard-grid" id="dashboardGrid">
          <!-- 动态生成的小部件 -->
        </div>
      </div>
      
      <div class="dashboard-footer">
        <div class="footer-stats">
          <span id="lastUpdate">最后更新: --</span>
          <span id="connectionStatus">连接状态: 已连接</span>
        </div>
        <div class="footer-actions">
          <button class="btn btn-sm" id="addWidgetBtn">+ 添加小部件</button>
          <button class="btn btn-sm" id="exportBtn">📊 导出数据</button>
        </div>
      </div>
      
      <!-- 通知容器 -->
      <div class="notifications-container" id="notificationsContainer"></div>
      
      <!-- 设置面板 -->
      <div class="settings-panel" id="settingsPanel" style="display: none;">
        <div class="settings-content">
          <h3>仪表板设置</h3>
          <div class="settings-section">
            <label>主题</label>
            <select id="themeSelect">
              <option value="light">浅色</option>
              <option value="dark">深色</option>
              <option value="auto">自动</option>
            </select>
          </div>
          <div class="settings-section">
            <label>布局</label>
            <select id="layoutSelect">
              <option value="grid">网格</option>
              <option value="flex">弹性</option>
              <option value="masonry">瀑布流</option>
            </select>
          </div>
          <div class="settings-section">
            <label>刷新间隔 (秒)</label>
            <input type="number" id="refreshInterval" min="1" max="60" value="5">
          </div>
          <div class="settings-section">
            <label>
              <input type="checkbox" id="autoRefresh" checked>
              自动刷新
            </label>
          </div>
          <div class="settings-section">
            <label>
              <input type="checkbox" id="notifications" checked>
              启用通知
            </label>
          </div>
          <div class="settings-section">
            <label>
              <input type="checkbox" id="soundAlerts">
              声音提醒
            </label>
          </div>
          <div class="settings-actions">
            <button class="btn btn-primary" id="saveSettings">保存设置</button>
            <button class="btn btn-secondary" id="cancelSettings">取消</button>
          </div>
        </div>
      </div>
    `;

    // 初始化默认小部件
    this.initializeDefaultWidgets();

    // 应用CSS样式
    this.applyStyles();
  }

  /**
   * 初始化默认小部件
   */
  private initializeDefaultWidgets(): void {
    const defaultWidgets: WidgetConfig[] = [
      {
        id: 'system-overview',
        type: 'metrics',
        title: '系统概览',
        size: 'large',
        position: { x: 0, y: 0, w: 6, h: 4 },
        visible: true,
        config: {
          metrics: ['uptime', 'cpu', 'memory', 'activePositions', 'totalPnL']
        }
      },
      {
        id: 'price-chart',
        type: 'chart',
        title: 'ETH-USDT 价格走势',
        size: 'xlarge',
        position: { x: 6, y: 0, w: 12, h: 8 },
        visible: true,
        config: {
          symbol: 'ETH-USDT-SWAP',
          timeframe: '15m',
          indicators: ['MA', 'RSI', 'MACD'],
          type: 'candlestick'
        }
      },
      {
        id: 'active-positions',
        type: 'positions',
        title: '活跃持仓',
        size: 'medium',
        position: { x: 0, y: 4, w: 6, h: 4 },
        visible: true,
        config: {
          showPnL: true,
          showRisk: true
        }
      },
      {
        id: 'ml-predictions',
        type: 'ml',
        title: 'AI预测分析',
        size: 'medium',
        position: { x: 18, y: 0, w: 6, h: 4 },
        visible: true,
        config: {
          showConfidence: true,
          showFeatures: true
        }
      },
      {
        id: 'risk-monitor',
        type: 'risk',
        title: '风险监控',
        size: 'medium',
        position: { x: 18, y: 4, w: 6, h: 4 },
        visible: true,
        config: {
          showDrawdown: true,
          showExposure: true,
          showVaR: true
        }
      },
      {
        id: 'performance-stats',
        type: 'performance',
        title: '性能统计',
        size: 'large',
        position: { x: 6, y: 8, w: 12, h: 4 },
        visible: true,
        config: {
          period: '24h',
          showWinRate: true,
          showSharpe: true,
          showMaxDD: true
        }
      },
      {
        id: 'system-alerts',
        type: 'alerts',
        title: '系统预警',
        size: 'medium',
        position: { x: 0, y: 8, w: 6, h: 4 },
        visible: true,
        config: {
          maxAlerts: 10,
          autoAcknowledge: false
        }
      },
      {
        id: 'recent-orders',
        type: 'orders',
        title: '最近订单',
        size: 'medium',
        position: { x: 18, y: 8, w: 6, h: 4 },
        visible: true,
        config: {
          maxOrders: 20,
          showStatus: true
        }
      }
    ];

    for (const widget of defaultWidgets) {
      this.widgets.set(widget.id, widget);
    }

    this.renderWidgets();
  }

  /**
   * 渲染小部件
   */
  private renderWidgets(): void {
    const grid = document.getElementById('dashboardGrid');
    if (!grid) return;

    grid.innerHTML = '';

    for (const widget of this.widgets.values()) {
      if (!widget.visible) continue;

      const widgetElement = this.createWidgetElement(widget);
      grid.appendChild(widgetElement);
    }
  }

  /**
   * 创建小部件元素
   */
  private createWidgetElement(widget: WidgetConfig): HTMLElement {
    const element = document.createElement('div');
    element.className = `widget widget-${widget.type} widget-${widget.size}`;
    element.id = `widget-${widget.id}`;
    element.style.gridColumn = `span ${widget.position.w}`;
    element.style.gridRow = `span ${widget.position.h}`;

    element.innerHTML = `
      <div class="widget-header">
        <h3 class="widget-title">${widget.title}</h3>
        <div class="widget-controls">
          <button class="widget-btn" onclick="dashboard.refreshWidget('${widget.id}')" title="刷新">
            <span class="icon">🔄</span>
          </button>
          <button class="widget-btn" onclick="dashboard.configureWidget('${widget.id}')" title="配置">
            <span class="icon">⚙️</span>
          </button>
          <button class="widget-btn" onclick="dashboard.toggleWidget('${widget.id}')" title="最小化">
            <span class="icon">−</span>
          </button>
        </div>
      </div>
      <div class="widget-content" id="widget-content-${widget.id}">
        <div class="loading">加载中...</div>
      </div>
    `;

    // 加载小部件内容
    this.loadWidgetContent(widget.id);

    return element;
  }

  /**
   * 加载小部件内容
   */
  private async loadWidgetContent(widgetId: string): Promise<void> {
    const widget = this.widgets.get(widgetId);
    if (!widget) return;

    const contentElement = document.getElementById(`widget-content-${widgetId}`);
    if (!contentElement) return;

    try {
      let content = '';

      switch (widget.type) {
        case 'metrics':
          content = await this.renderMetricsWidget(widget);
          break;
        case 'chart':
          content = await this.renderChartWidget(widget);
          break;
        case 'positions':
          content = await this.renderPositionsWidget(widget);
          break;
        case 'orders':
          content = await this.renderOrdersWidget(widget);
          break;
        case 'alerts':
          content = await this.renderAlertsWidget(widget);
          break;
        case 'performance':
          content = await this.renderPerformanceWidget(widget);
          break;
        case 'ml':
          content = await this.renderMLWidget(widget);
          break;
        case 'risk':
          content = await this.renderRiskWidget(widget);
          break;
        default:
          content = '<div class="error">未知的小部件类型</div>';
      }

      contentElement.innerHTML = content;

    } catch (error) {
      console.error(`加载小部件内容失败: ${widgetId}`, error);
      contentElement.innerHTML = '<div class="error">加载失败</div>';
    }
  }

  /**
   * 渲染指标小部件
   */
  private async renderMetricsWidget(widget: WidgetConfig): Promise<string> {
    try {
      // 获取系统状态数据
      const response = await fetch('/api/system/status');
      const data = await response.json();

      const metrics = widget.config.metrics || [];
      let html = '<div class="metrics-grid">';

      for (const metric of metrics) {
        let value = '--';
        let label = metric;
        let unit = '';
        let status = 'normal';

        switch (metric) {
          case 'uptime':
            value = this.formatUptime(data.uptime || 0);
            label = '运行时间';
            break;
          case 'cpu':
            value = '45';
            label = 'CPU使用率';
            unit = '%';
            status = parseInt(value) > 80 ? 'warning' : 'normal';
            break;
          case 'memory':
            value = '62';
            label = '内存使用率';
            unit = '%';
            status = parseInt(value) > 85 ? 'warning' : 'normal';
            break;
          case 'activePositions':
            value = '3';
            label = '活跃持仓';
            break;
          case 'totalPnL':
            value = '+1,250.75';
            label = '总盈亏';
            unit = ' USDT';
            status = value.startsWith('+') ? 'success' : 'danger';
            break;
        }

        html += `
          <div class="metric-item ${status}">
            <div class="metric-value">${value}${unit}</div>
            <div class="metric-label">${label}</div>
          </div>
        `;
      }

      html += '</div>';
      return html;

    } catch (error) {
      return '<div class="error">获取指标数据失败</div>';
    }
  }

  /**
   * 渲染图表小部件
   */
  private async renderChartWidget(widget: WidgetConfig): Promise<string> {
    const chartId = `chart-${widget.id}`;
    
    // 返回图表容器，实际图表将通过JavaScript库渲染
    return `
      <div class="chart-container">
        <div class="chart-controls">
          <select class="chart-timeframe">
            <option value="1m">1分钟</option>
            <option value="5m">5分钟</option>
            <option value="15m" selected>15分钟</option>
            <option value="1h">1小时</option>
            <option value="4h">4小时</option>
            <option value="1d">1天</option>
          </select>
          <div class="chart-indicators">
            <label><input type="checkbox" checked> MA</label>
            <label><input type="checkbox" checked> RSI</label>
            <label><input type="checkbox"> MACD</label>
          </div>
        </div>
        <div id="${chartId}" class="chart-canvas" style="height: 300px;">
          <div class="chart-placeholder">
            📈 图表加载中...
            <br>
            <small>ETH-USDT 15分钟 K线图</small>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 渲染持仓小部件
   */
  private async renderPositionsWidget(widget: WidgetConfig): Promise<string> {
    try {
      // 模拟持仓数据
      const positions = [
        {
          symbol: 'ETH-USDT-SWAP',
          side: 'LONG',
          size: 2.5,
          entryPrice: 2450.50,
          currentPrice: 2485.20,
          pnl: 86.75,
          pnlPercent: 1.42,
          margin: 245.05
        },
        {
          symbol: 'ETH-USDT-SWAP',
          side: 'SHORT',
          size: 1.0,
          entryPrice: 2520.00,
          currentPrice: 2485.20,
          pnl: 34.80,
          pnlPercent: 1.38,
          margin: 252.00
        }
      ];

      let html = '<div class="positions-list">';

      if (positions.length === 0) {
        html += '<div class="empty-state">暂无活跃持仓</div>';
      } else {
        for (const position of positions) {
          const pnlClass = position.pnl >= 0 ? 'profit' : 'loss';
          const sideClass = position.side.toLowerCase();

          html += `
            <div class="position-item">
              <div class="position-header">
                <span class="position-symbol">${position.symbol}</span>
                <span class="position-side ${sideClass}">${position.side}</span>
              </div>
              <div class="position-details">
                <div class="position-size">数量: ${position.size}</div>
                <div class="position-price">
                  入场: $${position.entryPrice.toFixed(2)}
                  <br>
                  当前: $${position.currentPrice.toFixed(2)}
                </div>
                <div class="position-pnl ${pnlClass}">
                  ${position.pnl >= 0 ? '+' : ''}${position.pnl.toFixed(2)} USDT
                  <br>
                  (${position.pnlPercent >= 0 ? '+' : ''}${position.pnlPercent.toFixed(2)}%)
                </div>
              </div>
            </div>
          `;
        }
      }

      html += '</div>';
      return html;

    } catch (error) {
      return '<div class="error">获取持仓数据失败</div>';
    }
  }

  /**
   * 渲染订单小部件
   */
  private async renderOrdersWidget(widget: WidgetConfig): Promise<string> {
    // 模拟订单数据
    const orders = [
      {
        id: 'ORD001',
        symbol: 'ETH-USDT-SWAP',
        side: 'BUY',
        type: 'LIMIT',
        amount: 1.5,
        price: 2440.00,
        status: 'FILLED',
        time: Date.now() - 300000
      },
      {
        id: 'ORD002',
        symbol: 'ETH-USDT-SWAP',
        side: 'SELL',
        type: 'MARKET',
        amount: 0.8,
        price: 2485.20,
        status: 'PENDING',
        time: Date.now() - 120000
      }
    ];

    let html = '<div class="orders-list">';

    if (orders.length === 0) {
      html += '<div class="empty-state">暂无订单</div>';
    } else {
      for (const order of orders) {
        const statusClass = order.status.toLowerCase();
        const sideClass = order.side.toLowerCase();

        html += `
          <div class="order-item">
            <div class="order-header">
              <span class="order-id">#${order.id}</span>
              <span class="order-status ${statusClass}">${order.status}</span>
            </div>
            <div class="order-details">
              <div class="order-symbol">${order.symbol}</div>
              <div class="order-side ${sideClass}">${order.side} ${order.amount}</div>
              <div class="order-price">$${order.price.toFixed(2)}</div>
              <div class="order-time">${this.formatTime(order.time)}</div>
            </div>
          </div>
        `;
      }
    }

    html += '</div>';
    return html;
  }

  /**
   * 渲染预警小部件
   */
  private async renderAlertsWidget(widget: WidgetConfig): Promise<string> {
    // 模拟预警数据
    const alerts = [
      {
        id: 'ALT001',
        type: 'warning',
        message: 'CPU使用率过高 (85%)',
        time: Date.now() - 180000,
        acknowledged: false
      },
      {
        id: 'ALT002',
        type: 'info',
        message: '新的交易信号: ETH-USDT LONG',
        time: Date.now() - 300000,
        acknowledged: true
      }
    ];

    let html = '<div class="alerts-list">';

    if (alerts.length === 0) {
      html += '<div class="empty-state">暂无预警</div>';
    } else {
      for (const alert of alerts) {
        const typeClass = alert.type;
        const ackClass = alert.acknowledged ? 'acknowledged' : '';

        html += `
          <div class="alert-item ${typeClass} ${ackClass}">
            <div class="alert-icon">
              ${alert.type === 'warning' ? '⚠️' : alert.type === 'error' ? '❌' : 'ℹ️'}
            </div>
            <div class="alert-content">
              <div class="alert-message">${alert.message}</div>
              <div class="alert-time">${this.formatTime(alert.time)}</div>
            </div>
            ${!alert.acknowledged ? `
              <button class="alert-ack" onclick="dashboard.acknowledgeAlert('${alert.id}')">
                确认
              </button>
            ` : ''}
          </div>
        `;
      }
    }

    html += '</div>';
    return html;
  }

  /**
   * 渲染性能小部件
   */
  private async renderPerformanceWidget(widget: WidgetConfig): Promise<string> {
    // 模拟性能数据
    const performance = {
      totalTrades: 156,
      winningTrades: 102,
      losingTrades: 54,
      winRate: 65.38,
      totalPnL: 1250.75,
      avgWin: 45.20,
      avgLoss: -28.50,
      maxWin: 185.60,
      maxLoss: -95.30,
      sharpeRatio: 1.85,
      maxDrawdown: 8.2,
      profitFactor: 1.58
    };

    return `
      <div class="performance-grid">
        <div class="perf-item">
          <div class="perf-value">${performance.totalTrades}</div>
          <div class="perf-label">总交易数</div>
        </div>
        <div class="perf-item success">
          <div class="perf-value">${performance.winRate.toFixed(1)}%</div>
          <div class="perf-label">胜率</div>
        </div>
        <div class="perf-item ${performance.totalPnL >= 0 ? 'success' : 'danger'}">
          <div class="perf-value">${performance.totalPnL >= 0 ? '+' : ''}${performance.totalPnL.toFixed(2)}</div>
          <div class="perf-label">总盈亏 (USDT)</div>
        </div>
        <div class="perf-item">
          <div class="perf-value">${performance.sharpeRatio.toFixed(2)}</div>
          <div class="perf-label">夏普比率</div>
        </div>
        <div class="perf-item ${performance.maxDrawdown < 10 ? 'success' : 'warning'}">
          <div class="perf-value">${performance.maxDrawdown.toFixed(1)}%</div>
          <div class="perf-label">最大回撤</div>
        </div>
        <div class="perf-item">
          <div class="perf-value">${performance.profitFactor.toFixed(2)}</div>
          <div class="perf-label">盈利因子</div>
        </div>
      </div>
    `;
  }

  /**
   * 渲染ML小部件
   */
  private async renderMLWidget(widget: WidgetConfig): Promise<string> {
    // 模拟ML数据
    const mlData = {
      prediction: 'LONG',
      confidence: 0.78,
      expectedReturn: 0.025,
      riskScore: 4.2,
      features: {
        technical: 0.65,
        sentiment: 0.72,
        volume: 0.58,
        momentum: 0.81
      },
      modelAccuracy: 0.68,
      lastUpdate: Date.now() - 60000
    };

    const predictionClass = mlData.prediction.toLowerCase();
    const confidenceClass = mlData.confidence > 0.7 ? 'high' : mlData.confidence > 0.5 ? 'medium' : 'low';

    return `
      <div class="ml-content">
        <div class="ml-prediction">
          <div class="prediction-main">
            <span class="prediction-direction ${predictionClass}">${mlData.prediction}</span>
            <span class="prediction-confidence ${confidenceClass}">${(mlData.confidence * 100).toFixed(1)}%</span>
          </div>
          <div class="prediction-details">
            <div class="detail-item">
              <span class="label">期望收益:</span>
              <span class="value">${(mlData.expectedReturn * 100).toFixed(2)}%</span>
            </div>
            <div class="detail-item">
              <span class="label">风险评分:</span>
              <span class="value">${mlData.riskScore.toFixed(1)}/10</span>
            </div>
          </div>
        </div>
        
        <div class="ml-features">
          <h4>特征分析</h4>
          <div class="features-grid">
            <div class="feature-item">
              <span class="feature-label">技术指标</span>
              <div class="feature-bar">
                <div class="feature-fill" style="width: ${mlData.features.technical * 100}%"></div>
              </div>
              <span class="feature-value">${(mlData.features.technical * 100).toFixed(0)}%</span>
            </div>
            <div class="feature-item">
              <span class="feature-label">市场情绪</span>
              <div class="feature-bar">
                <div class="feature-fill" style="width: ${mlData.features.sentiment * 100}%"></div>
              </div>
              <span class="feature-value">${(mlData.features.sentiment * 100).toFixed(0)}%</span>
            </div>
            <div class="feature-item">
              <span class="feature-label">成交量</span>
              <div class="feature-bar">
                <div class="feature-fill" style="width: ${mlData.features.volume * 100}%"></div>
              </div>
              <span class="feature-value">${(mlData.features.volume * 100).toFixed(0)}%</span>
            </div>
            <div class="feature-item">
              <span class="feature-label">动量</span>
              <div class="feature-bar">
                <div class="feature-fill" style="width: ${mlData.features.momentum * 100}%"></div>
              </div>
              <span class="feature-value">${(mlData.features.momentum * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
        
        <div class="ml-status">
          <div class="status-item">
            <span class="label">模型准确率:</span>
            <span class="value">${(mlData.modelAccuracy * 100).toFixed(1)}%</span>
          </div>
          <div class="status-item">
            <span class="label">最后更新:</span>
            <span class="value">${this.formatTime(mlData.lastUpdate)}</span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 渲染风险小部件
   */
  private async renderRiskWidget(widget: WidgetConfig): Promise<string> {
    // 模拟风险数据
    const riskData = {
      totalExposure: 15000,
      maxExposure: 25000,
      currentDrawdown: 3.2,
      maxDrawdown: 8.5,
      riskScore: 4.2,
      var95: 450.30,
      portfolioValue: 25000,
      leverage: 2.5,
      marginRatio: 0.15
    };

    const exposurePercent = (riskData.totalExposure / riskData.maxExposure) * 100;
    const drawdownPercent = (riskData.currentDrawdown / riskData.maxDrawdown) * 100;

    return `
      <div class="risk-content">
        <div class="risk-overview">
          <div class="risk-score ${riskData.riskScore < 5 ? 'low' : riskData.riskScore < 7 ? 'medium' : 'high'}">
            <div class="score-value">${riskData.riskScore.toFixed(1)}</div>
            <div class="score-label">风险评分</div>
          </div>
        </div>
        
        <div class="risk-metrics">
          <div class="risk-item">
            <div class="risk-header">
              <span class="label">总敞口</span>
              <span class="value">${riskData.totalExposure.toLocaleString()} USDT</span>
            </div>
            <div class="risk-bar">
              <div class="risk-fill ${exposurePercent > 80 ? 'danger' : exposurePercent > 60 ? 'warning' : 'normal'}" 
                   style="width: ${exposurePercent}%"></div>
            </div>
            <div class="risk-info">${exposurePercent.toFixed(1)}% / 最大 ${riskData.maxExposure.toLocaleString()}</div>
          </div>
          
          <div class="risk-item">
            <div class="risk-header">
              <span class="label">当前回撤</span>
              <span class="value">${riskData.currentDrawdown.toFixed(2)}%</span>
            </div>
            <div class="risk-bar">
              <div class="risk-fill ${drawdownPercent > 80 ? 'danger' : drawdownPercent > 60 ? 'warning' : 'normal'}" 
                   style="width: ${drawdownPercent}%"></div>
            </div>
            <div class="risk-info">${drawdownPercent.toFixed(1)}% / 最大 ${riskData.maxDrawdown}%</div>
          </div>
          
          <div class="risk-stats">
            <div class="stat-item">
              <span class="label">VaR (95%):</span>
              <span class="value">${riskData.var95.toFixed(2)} USDT</span>
            </div>
            <div class="stat-item">
              <span class="label">杠杆倍数:</span>
              <span class="value">${riskData.leverage.toFixed(1)}x</span>
            </div>
            <div class="stat-item">
              <span class="label">保证金率:</span>
              <span class="value">${(riskData.marginRatio * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 刷新按钮
    document.getElementById('refreshBtn')?.addEventListener('click', () => {
      this.refreshAllWidgets();
    });

    // 设置按钮
    document.getElementById('settingsBtn')?.addEventListener('click', () => {
      this.showSettings();
    });

    // 全屏按钮
    document.getElementById('fullscreenBtn')?.addEventListener('click', () => {
      this.toggleFullscreen();
    });

    // 主题切换按钮
    document.getElementById('themeBtn')?.addEventListener('click', () => {
      this.toggleTheme();
    });

    // 添加小部件按钮
    document.getElementById('addWidgetBtn')?.addEventListener('click', () => {
      this.showAddWidgetDialog();
    });

    // 导出按钮
    document.getElementById('exportBtn')?.addEventListener('click', () => {
      this.exportData();
    });

    // 设置面板事件
    this.setupSettingsEvents();

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'r':
            e.preventDefault();
            this.refreshAllWidgets();
            break;
          case ',':
            e.preventDefault();
            this.showSettings();
            break;
        }
      }
    });
  }

  /**
   * 设置设置面板事件
   */
  private setupSettingsEvents(): void {
    // 保存设置
    document.getElementById('saveSettings')?.addEventListener('click', () => {
      this.saveSettings();
    });

    // 取消设置
    document.getElementById('cancelSettings')?.addEventListener('click', () => {
      this.hideSettings();
    });

    // 点击外部关闭设置面板
    document.getElementById('settingsPanel')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        this.hideSettings();
      }
    });
  }

  /**
   * 应用主题
   */
  private applyTheme(): void {
    if (!this.container) return;

    this.container.className = `dashboard-container theme-${this.config.theme}`;
    
    // 如果是自动主题，根据系统设置
    if (this.config.theme === 'auto') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.container.classList.add(isDark ? 'theme-dark' : 'theme-light');
    }
  }

  /**
   * 应用样式
   */
  private applyStyles(): void {
    const styleId = 'dashboard-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .dashboard-container {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        height: 100vh;
        display: flex;
        flex-direction: column;
        background: var(--bg-primary);
        color: var(--text-primary);
        overflow: hidden;
      }

      .theme-dark {
        --bg-primary: #1a1a1a;
        --bg-secondary: #2d2d2d;
        --bg-tertiary: #3d3d3d;
        --text-primary: #ffffff;
        --text-secondary: #cccccc;
        --text-muted: #999999;
        --border-color: #404040;
        --accent-color: #007acc;
        --success-color: #28a745;
        --warning-color: #ffc107;
        --danger-color: #dc3545;
      }

      .theme-light {
        --bg-primary: #ffffff;
        --bg-secondary: #f8f9fa;
        --bg-tertiary: #e9ecef;
        --text-primary: #212529;
        --text-secondary: #495057;
        --text-muted: #6c757d;
        --border-color: #dee2e6;
        --accent-color: #007bff;
        --success-color: #28a745;
        --warning-color: #ffc107;
        --danger-color: #dc3545;
      }

      .dashboard-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 2rem;
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
      }

      .dashboard-title h1 {
        margin: 0;
        font-size: 1.5rem;
        font-weight: 600;
      }

      .system-status {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: 0.25rem;
        font-size: 0.875rem;
        color: var(--text-secondary);
      }

      .status-indicator {
        color: var(--success-color);
        font-size: 0.75rem;
      }

      .dashboard-controls {
        display: flex;
        gap: 0.5rem;
      }

      .btn {
        padding: 0.5rem 1rem;
        border: 1px solid var(--border-color);
        background: var(--bg-tertiary);
        color: var(--text-primary);
        border-radius: 0.375rem;
        cursor: pointer;
        font-size: 0.875rem;
        transition: all 0.2s;
      }

      .btn:hover {
        background: var(--accent-color);
        color: white;
      }

      .btn-icon {
        padding: 0.5rem;
        min-width: 2.5rem;
      }

      .dashboard-content {
        flex: 1;
        overflow: auto;
        padding: 1rem;
      }

      .dashboard-grid {
        display: grid;
        grid-template-columns: repeat(24, 1fr);
        gap: 1rem;
        min-height: 100%;
      }

      .widget {
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 0.5rem;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: all 0.2s;
      }

      .widget:hover {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }

      .widget-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem;
        background: var(--bg-tertiary);
        border-bottom: 1px solid var(--border-color);
      }

      .widget-title {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
      }

      .widget-controls {
        display: flex;
        gap: 0.25rem;
      }

      .widget-btn {
        padding: 0.25rem;
        border: none;
        background: transparent;
        color: var(--text-secondary);
        cursor: pointer;
        border-radius: 0.25rem;
        font-size: 0.75rem;
      }

      .widget-btn:hover {
        background: var(--bg-primary);
        color: var(--text-primary);
      }

      .widget-content {
        flex: 1;
        padding: 1rem;
        overflow: auto;
      }

      .loading, .error, .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-muted);
        font-style: italic;
      }

      .error {
        color: var(--danger-color);
      }

      /* 指标网格 */
      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 1rem;
        height: 100%;
      }

      .metric-item {
        text-align: center;
        padding: 1rem;
        background: var(--bg-primary);
        border-radius: 0.375rem;
        border: 1px solid var(--border-color);
      }

      .metric-value {
        font-size: 1.5rem;
        font-weight: 700;
        margin-bottom: 0.25rem;
      }

      .metric-label {
        font-size: 0.75rem;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .metric-item.success .metric-value { color: var(--success-color); }
      .metric-item.warning .metric-value { color: var(--warning-color); }
      .metric-item.danger .metric-value { color: var(--danger-color); }

      /* 图表样式 */
      .chart-container {
        height: 100%;
        display: flex;
        flex-direction: column;
      }

      .chart-controls {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--border-color);
      }

      .chart-timeframe {
        padding: 0.25rem 0.5rem;
        border: 1px solid var(--border-color);
        background: var(--bg-primary);
        color: var(--text-primary);
        border-radius: 0.25rem;
      }

      .chart-indicators {
        display: flex;
        gap: 1rem;
        font-size: 0.875rem;
      }

      .chart-indicators label {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        cursor: pointer;
      }

      .chart-canvas {
        flex: 1;
        background: var(--bg-primary);
        border-radius: 0.375rem;
        border: 1px solid var(--border-color);
      }

      .chart-placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-muted);
        font-size: 1.125rem;
      }

      /* 列表样式 */
      .positions-list, .orders-list, .alerts-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        height: 100%;
        overflow-y: auto;
      }

      .position-item, .order-item, .alert-item {
        padding: 0.75rem;
        background: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 0.375rem;
      }

      .position-header, .order-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
      }

      .position-side.long, .order-side.buy {
        color: var(--success-color);
        font-weight: 600;
      }

      .position-side.short, .order-side.sell {
        color: var(--danger-color);
        font-weight: 600;
      }

      .position-details, .order-details {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
        gap: 0.5rem;
        font-size: 0.875rem;
      }

      .position-pnl.profit {
        color: var(--success-color);
        font-weight: 600;
      }

      .position-pnl.loss {
        color: var(--danger-color);
        font-weight: 600;
      }

      /* 预警样式 */
      .alert-item {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
      }

      .alert-item.acknowledged {
        opacity: 0.6;
      }

      .alert-icon {
        font-size: 1.25rem;
        flex-shrink: 0;
      }

      .alert-content {
        flex: 1;
      }

      .alert-message {
        font-weight: 500;
        margin-bottom: 0.25rem;
      }

      .alert-time {
        font-size: 0.75rem;
        color: var(--text-muted);
      }

      .alert-ack {
        padding: 0.25rem 0.5rem;
        border: 1px solid var(--accent-color);
        background: transparent;
        color: var(--accent-color);
        border-radius: 0.25rem;
        cursor: pointer;
        font-size: 0.75rem;
      }

      .alert-ack:hover {
        background: var(--accent-color);
        color: white;
      }

      /* 性能网格 */
      .performance-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 1rem;
        height: 100%;
      }

      .perf-item {
        text-align: center;
        padding: 1rem;
        background: var(--bg-primary);
        border-radius: 0.375rem;
        border: 1px solid var(--border-color);
      }

      .perf-value {
        font-size: 1.25rem;
        font-weight: 700;
        margin-bottom: 0.25rem;
      }

      .perf-label {
        font-size: 0.75rem;
        color: var(--text-secondary);
      }

      .perf-item.success .perf-value { color: var(--success-color); }
      .perf-item.warning .perf-value { color: var(--warning-color); }
      .perf-item.danger .perf-value { color: var(--danger-color); }

      /* ML样式 */
      .ml-content {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        height: 100%;
      }

      .ml-prediction {
        background: var(--bg-primary);
        padding: 1rem;
        border-radius: 0.375rem;
        border: 1px solid var(--border-color);
      }

      .prediction-main {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.75rem;
      }

      .prediction-direction {
        font-size: 1.25rem;
        font-weight: 700;
        text-transform: uppercase;
      }

      .prediction-direction.long { color: var(--success-color); }
      .prediction-direction.short { color: var(--danger-color); }

      .prediction-confidence {
        font-size: 1rem;
        font-weight: 600;
      }

      .prediction-confidence.high { color: var(--success-color); }
      .prediction-confidence.medium { color: var(--warning-color); }
      .prediction-confidence.low { color: var(--danger-color); }

      .prediction-details {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
        font-size: 0.875rem;
      }

      .detail-item {
        display: flex;
        justify-content: space-between;
      }

      .ml-features h4 {
        margin: 0 0 0.75rem 0;
        font-size: 0.875rem;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .features-grid {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .feature-item {
        display: grid;
        grid-template-columns: 80px 1fr 40px;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.75rem;
      }

      .feature-bar {
        height: 0.5rem;
        background: var(--bg-tertiary);
        border-radius: 0.25rem;
        overflow: hidden;
      }

      .feature-fill {
        height: 100%;
        background: var(--accent-color);
        transition: width 0.3s ease;
      }

      .ml-status {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
        font-size: 0.75rem;
        color: var(--text-secondary);
      }

      /* 风险样式 */
      .risk-content {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        height: 100%;
      }

      .risk-overview {
        text-align: center;
      }

      .risk-score {
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        padding: 1rem;
        background: var(--bg-primary);
        border-radius: 50%;
        width: 80px;
        height: 80px;
        justify-content: center;
        border: 3px solid;
      }

      .risk-score.low { border-color: var(--success-color); }
      .risk-score.medium { border-color: var(--warning-color); }
      .risk-score.high { border-color: var(--danger-color); }

      .score-value {
        font-size: 1.5rem;
        font-weight: 700;
      }

      .score-label {
        font-size: 0.625rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-secondary);
      }

      .risk-metrics {
        flex: 1;
      }

      .risk-item {
        margin-bottom: 1rem;
      }

      .risk-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 0.25rem;
        font-size: 0.875rem;
      }

      .risk-bar {
        height: 0.5rem;
        background: var(--bg-tertiary);
        border-radius: 0.25rem;
        overflow: hidden;
        margin-bottom: 0.25rem;
      }

      .risk-fill {
        height: 100%;
        transition: width 0.3s ease;
      }

      .risk-fill.normal { background: var(--success-color); }
      .risk-fill.warning { background: var(--warning-color); }
      .risk-fill.danger { background: var(--danger-color); }

      .risk-info {
        font-size: 0.75rem;
        color: var(--text-muted);
      }

      .risk-stats {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.75rem;
      }

      .stat-item {
        display: flex;
        justify-content: space-between;
      }

      /* 底部栏 */
      .dashboard-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem 2rem;
        background: var(--bg-secondary);
        border-top: 1px solid var(--border-color);
        font-size: 0.875rem;
        flex-shrink: 0;
      }

      .footer-stats {
        display: flex;
        gap: 2rem;
        color: var(--text-secondary);
      }

      .footer-actions {
        display: flex;
        gap: 0.5rem;
      }

      .btn-sm {
        padding: 0.375rem 0.75rem;
        font-size: 0.75rem;
      }

      /* 通知 */
      .notifications-container {
        position: fixed;
        top: 1rem;
        right: 1rem;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-width: 300px;
      }

      /* 设置面板 */
      .settings-panel {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .settings-content {
        background: var(--bg-secondary);
        padding: 2rem;
        border-radius: 0.5rem;
        border: 1px solid var(--border-color);
        min-width: 400px;
        max-width: 500px;
      }

      .settings-content h3 {
        margin: 0 0 1.5rem 0;
      }

      .settings-section {
        margin-bottom: 1rem;
      }

      .settings-section label {
        display: block;
        margin-bottom: 0.25rem;
        font-weight: 500;
      }

      .settings-section select,
      .settings-section input[type="number"] {
        width: 100%;
        padding: 0.5rem;
        border: 1px solid var(--border-color);
        background: var(--bg-primary);
        color: var(--text-primary);
        border-radius: 0.25rem;
      }

      .settings-section input[type="checkbox"] {
        margin-right: 0.5rem;
      }

      .settings-actions {
        display: flex;
        gap: 0.5rem;
        justify-content: flex-end;
        margin-top: 1.5rem;
      }

      .btn-primary {
        background: var(--accent-color);
        color: white;
        border-color: var(--accent-color);
      }

      .btn-secondary {
        background: var(--bg-tertiary);
        color: var(--text-primary);
      }

      /* 响应式设计 */
      @media (max-width: 1200px) {
        .dashboard-grid {
          grid-template-columns: repeat(12, 1fr);
        }
      }

      @media (max-width: 768px) {
        .dashboard-header {
          padding: 1rem;
        }
        
        .dashboard-content {
          padding: 0.5rem;
        }
        
        .dashboard-grid {
          grid-template-columns: 1fr;
          gap: 0.5rem;
        }
        
        .widget {
          grid-column: 1 !important;
          grid-row: auto !important;
        }
        
        .dashboard-footer {
          padding: 0.5rem 1rem;
          flex-direction: column;
          gap: 0.5rem;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * 工具方法
   */
  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}天 ${hours % 24}小时`;
    if (hours > 0) return `${hours}小时 ${minutes % 60}分钟`;
    if (minutes > 0) return `${minutes}分钟`;
    return `${seconds}秒`;
  }

  private formatTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    
    return new Date(timestamp).toLocaleString('zh-CN');
  }

  /**
   * 公共方法
   */
  public refreshAllWidgets(): void {
    for (const widgetId of this.widgets.keys()) {
      this.loadWidgetContent(widgetId);
    }
    
    document.getElementById('lastUpdate')!.textContent = 
      `最后更新: ${new Date().toLocaleTimeString('zh-CN')}`;
  }

  public refreshWidget(widgetId: string): void {
    this.loadWidgetContent(widgetId);
  }

  public toggleWidget(widgetId: string): void {
    const widget = this.widgets.get(widgetId);
    if (widget) {
      widget.visible = !widget.visible;
      this.renderWidgets();
    }
  }

  public configureWidget(widgetId: string): void {
    // 显示小部件配置对话框
    console.log(`配置小部件: ${widgetId}`);
  }

  public acknowledgeAlert(alertId: string): void {
    // 确认预警
    console.log(`确认预警: ${alertId}`);
    this.refreshWidget('system-alerts');
  }

  private showSettings(): void {
    const panel = document.getElementById('settingsPanel');
    if (panel) {
      panel.style.display = 'flex';
      
      // 加载当前设置
      (document.getElementById('themeSelect') as HTMLSelectElement).value = this.config.theme;
      (document.getElementById('layoutSelect') as HTMLSelectElement).value = this.config.layout;
      (document.getElementById('refreshInterval') as HTMLInputElement).value = (this.config.refreshInterval / 1000).toString();
      (document.getElementById('autoRefresh') as HTMLInputElement).checked = this.config.autoRefresh;
      (document.getElementById('notifications') as HTMLInputElement).checked = this.config.notifications;
      (document.getElementById('soundAlerts') as HTMLInputElement).checked = this.config.soundAlerts;
    }
  }

  private hideSettings(): void {
    const panel = document.getElementById('settingsPanel');
    if (panel) {
      panel.style.display = 'none';
    }
  }

  private saveSettings(): void {
    // 获取设置值
    this.config.theme = (document.getElementById('themeSelect') as HTMLSelectElement).value as any;
    this.config.layout = (document.getElementById('layoutSelect') as HTMLSelectElement).value as any;
    this.config.refreshInterval = parseInt((document.getElementById('refreshInterval') as HTMLInputElement).value) * 1000;
    this.config.autoRefresh = (document.getElementById('autoRefresh') as HTMLInputElement).checked;
    this.config.notifications = (document.getElementById('notifications') as HTMLInputElement).checked;
    this.config.soundAlerts = (document.getElementById('soundAlerts') as HTMLInputElement).checked;

    // 应用设置
    this.applyTheme();
    this.saveUserPreferences();
    
    // 重启自动刷新
    if (this.config.autoRefresh) {
      this.startAutoRefresh();
    } else {
      this.stopAutoRefresh();
    }

    this.hideSettings();
    this.showNotification('设置已保存', 'success');
  }

  private toggleTheme(): void {
    const themes = ['light', 'dark', 'auto'];
    const currentIndex = themes.indexOf(this.config.theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    this.config.theme = themes[nextIndex] as any;
    this.applyTheme();
    this.saveUserPreferences();
  }

  private toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  private showAddWidgetDialog(): void {
    // 显示添加小部件对话框
    this.showNotification('添加小部件功能开发中...', 'info');
  }

  private exportData(): void {
    // 导出数据功能
    this.showNotification('数据导出功能开发中...', 'info');
  }

  private loadUserPreferences(): void {
    try {
      const saved = localStorage.getItem('dashboard-config');
      if (saved) {
        const config = JSON.parse(saved);
        this.config = { ...this.config, ...config };
      }
    } catch (error) {
      console.warn('加载用户偏好失败:', error);
    }
  }

  private saveUserPreferences(): void {
    try {
      localStorage.setItem('dashboard-config', JSON.stringify(this.config));
    } catch (error) {
      console.warn('保存用户偏好失败:', error);
    }
  }

  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    if (this.config.autoRefresh) {
      this.refreshTimer = setInterval(() => {
        this.refreshAllWidgets();
      }, this.config.refreshInterval);
    }
  }

  private stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private showNotification(message: string, type: 'success' | 'warning' | 'error' | 'info' = 'info'): void {
    if (!this.config.notifications) return;

    const container = document.getElementById('notificationsContainer');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-icon">
          ${type === 'success' ? '✅' : type === 'warning' ? '⚠️' : type === 'error' ? '❌' : 'ℹ️'}
        </span>
        <span class="notification-message">${message}</span>
        <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
    `;

    container.appendChild(notification);

    // 自动移除通知
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 5000);
  }

  /**
   * 启动仪表板
   */
  public start(): void {
    this.refreshAllWidgets();
    this.startAutoRefresh();
    
    // 更新系统状态
    this.updateSystemStatus();
    setInterval(() => {
      this.updateSystemStatus();
    }, 10000);
  }

  /**
   * 停止仪表板
   */
  public stop(): void {
    this.stopAutoRefresh();
    if (this.websocket) {
      this.websocket.close();
    }
  }

  private async updateSystemStatus(): Promise<void> {
    try {
      const response = await fetch('/api/system/status');
      const data = await response.json();
      
      const indicator = document.getElementById('systemStatus');
      const text = document.getElementById('systemStatusText');
      const connection = document.getElementById('connectionStatus');
      
      if (indicator && text) {
        if (data.isRunning) {
          indicator.style.color = 'var(--success-color)';
          text.textContent = '系统运行中';
        } else {
          indicator.style.color = 'var(--danger-color)';
          text.textContent = '系统离线';
        }
      }
      
      if (connection) {
        connection.textContent = '连接状态: 已连接';
      }
      
    } catch (error) {
      const indicator = document.getElementById('systemStatus');
      const text = document.getElementById('systemStatusText');
      const connection = document.getElementById('connectionStatus');
      
      if (indicator && text) {
        indicator.style.color = 'var(--warning-color)';
        text.textContent = '连接异常';
      }
      
      if (connection) {
        connection.textContent = '连接状态: 断开';
      }
    }
  }
}

// 全局仪表板实例
declare global {
  interface Window {
    dashboard: EnhancedDashboard;
  }
}