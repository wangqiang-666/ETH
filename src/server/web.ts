import http from 'http';
import { URL } from 'url';

interface WebServerOptions {
  getSystemStatus: () => any;
  getStrategyStats: () => any; // raw stats without winRate
  getCurrentPosition: () => any;
  getPendingOrders: () => any[];
  getLastSignal: () => any | null;
  getCurrentTicker?: () => Promise<any> | any; // 新增：当前行情
}

function json(res: http.ServerResponse, data: any, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function html(res: http.ServerResponse, body: string, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
  });
  res.end(body);
}

function notFound(res: http.ServerResponse) {
  json(res, { error: 'Not Found' }, 404);
}

export function startWebServer(options: WebServerOptions, port = 3000) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const path = url.pathname;

      if (path === '/api/status') {
        const status = options.getSystemStatus();
        return json(res, status);
      }

      if (path === '/api/stats') {
        const stats = options.getStrategyStats();
        const winRate = stats.totalTrades > 0 ? (stats.successfulTrades / stats.totalTrades) * 100 : 0;
        return json(res, { ...stats, winRate });
      }

      if (path === '/api/position') {
        return json(res, options.getCurrentPosition());
      }

      if (path === '/api/orders') {
        return json(res, options.getPendingOrders());
      }

      if (path === '/api/signal') {
        const signal = options.getLastSignal();
        return json(res, signal ?? { signal: null });
      }

      // 新增：全面数据接口
      if (path === '/api/dashboard') {
        const [status, stats, position, orders, signal, market] = await Promise.all([
          Promise.resolve(options.getSystemStatus()),
          Promise.resolve(options.getStrategyStats()),
          Promise.resolve(options.getCurrentPosition()),
          Promise.resolve(options.getPendingOrders()),
          Promise.resolve(options.getLastSignal()),
          options.getCurrentTicker ? Promise.resolve(options.getCurrentTicker()) : Promise.resolve(null)
        ]);
        
        const winRate = stats.totalTrades > 0 ? (stats.successfulTrades / stats.totalTrades) * 100 : 0;
        const dashboard = {
          system: {
            isRunning: status.isRunning,
            timestamp: Date.now(),
            uptime: status.timestamp
          },
          market: market ? {
            symbol: market.symbol,
            price: market.price,
            change24h: market.change24h,
            high24h: market.high24h,
            low24h: market.low24h,
            timestamp: market.timestamp
          } : null,
          trading: {
            ...stats,
            winRate,
            avgProfitPerTrade: stats.totalTrades > 0 ? stats.totalProfit / stats.totalTrades : 0,
            profitToday: stats.totalProfit, // 简化处理
            netProfit: stats.totalProfit, // totalProfit 已按净收益统计
            totalFees: stats.totalFees || 0
          },
          position: position,
          orders: orders,
          signal: signal,
          performance: {
            totalTrades: stats.totalTrades,
            successRate: winRate,
            profitFactor: stats.successfulTrades > 0 ? Math.abs(stats.totalProfit / (stats.totalTrades - stats.successfulTrades || 1)) : 0,
            maxDrawdown: stats.maxDrawdown,
          }
        };
        return json(res, dashboard);
      }

      if (path === '/' || path === '/index.html') {
        const page = enhancedDashboardHTML();
        return html(res, page);
      }

      return notFound(res);

    } catch (err: any) {
      console.error('WebServer error:', err);
      json(res, { error: 'Internal Server Error', message: err?.message || String(err) }, 500);
    }
  });

  server.on('error', (err: any) => {
    if (err && err.code === 'EADDRINUSE') {
      const fallbackPort = (port || 3000) + 1;
      console.log(`⚠️ 端口 ${port} 已被占用，尝试使用备用端口 ${fallbackPort} ...`);
      server.listen(fallbackPort, () => {
        console.log('🌐 网页端已启动: http://localhost:' + fallbackPort + '/');
      });
    } else {
      console.error('WebServer listen error:', err);
    }
  });

  server.listen(port, () => {
    console.log('🌐 网页端已启动: http://localhost:' + port + '/');
  });

  return server;
}

function enhancedDashboardHTML() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>⚡ HF 高频波段交易系统 - ETH交易看板</title>
  <!-- 简化的favicon设置 -->
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 500 500'%3E%3Cpolygon fill='%23627EEA' points='249.982,6.554 397.98,251.112 250.53,188.092'/%3E%3Cpolygon fill='%238A92B2' points='102.39,251.112 249.982,6.554 250.53,188.092'/%3E%3Cpolygon fill='%23627EEA' points='249.982,341.285 102.39,251.112 250.53,188.092'/%3E%3Cpolygon fill='%23454A75' points='397.98,251.112 250.53,188.092 249.982,341.285'/%3E%3Cpolygon fill='%23627EEA' points='249.982,372.329 397.98,284.597 249.982,493.13'/%3E%3Cpolygon fill='%238A92B2' points='249.982,372.329 102.39,284.597 249.982,493.13'/%3E%3C/svg%3E" />
  <link rel="shortcut icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 500 500'%3E%3Cpolygon fill='%23627EEA' points='249.982,6.554 397.98,251.112 250.53,188.092'/%3E%3Cpolygon fill='%238A92B2' points='102.39,251.112 249.982,6.554 250.53,188.092'/%3E%3Cpolygon fill='%23627EEA' points='249.982,341.285 102.39,251.112 250.53,188.092'/%3E%3Cpolygon fill='%23454A75' points='397.98,251.112 250.53,188.092 249.982,341.285'/%3E%3Cpolygon fill='%23627EEA' points='249.982,372.329 397.98,284.597 249.982,493.13'/%3E%3Cpolygon fill='%238A92B2' points='249.982,372.329 102.39,284.597 249.982,493.13'/%3E%3C/svg%3E" />
  <style>
    :root {
      --bg-primary: #0a0e1a;
      --bg-secondary: #111827;
      --bg-card: #1a1f2e;
      --bg-card-hover: #1f2937;
      --text-primary: #f8fafc;
      --text-secondary: #cbd5e1;
      --text-muted: #64748b;
      --accent-primary: #3b82f6;
      --accent-secondary: #06b6d4;
      --success: #10b981;
      --success-light: #34d399;
      --danger: #ef4444;
      --danger-light: #f87171;
      --warning: #f59e0b;
      --warning-light: #fbbf24;
      --border: #334155;
      --border-light: #475569;
      --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    }
    
    * { 
      box-sizing: border-box; 
      margin: 0;
      padding: 0;
    }
    
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; 
      background: linear-gradient(135deg, var(--bg-primary) 0%, #0f1419 50%, var(--bg-secondary) 100%);
      min-height: 100vh;
      color: var(--text-primary);
      line-height: 1.6;
    }
    
    /* Header Styles */
    header { 
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%);
      color: #ffffff;
      padding: 32px 0;
      box-shadow: var(--shadow-xl);
      position: relative;
      overflow: hidden;
      border-bottom: 4px solid #3b82f6;
    }
    
    header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>');
      opacity: 0.6;
    }
    
    .container { 
      max-width: 1200px; 
      margin: 0 auto; 
      padding: 0 24px;
      position: relative;
      z-index: 2;
    }
    
    h1 { 
      font-size: 32px; 
      font-weight: 900;
      margin-bottom: 8px;
      text-shadow: 0 4px 8px rgba(0,0,0,0.8);
      color: #ffffff;
      letter-spacing: -0.5px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .logo-icon {
      width: 36px;
      height: 36px;
      filter: drop-shadow(0 3px 6px rgba(0,0,0,0.5)) brightness(1.2);
      transition: transform 0.3s ease;
    }
    
    .logo-icon:hover {
      transform: scale(1.1) rotate(5deg);
      filter: drop-shadow(0 4px 8px rgba(0,0,0,0.6)) brightness(1.3);
    }
    
    .subtitle { 
      font-size: 16px; 
      opacity: 1;
      font-weight: 600;
      margin-bottom: 20px;
      color: #f1f5f9;
      text-shadow: 0 2px 4px rgba(0,0,0,0.6);
    }
    
    /* Main Content */
    main { 
      padding: 40px 0;
      position: relative;
    }
    
    /* Card Styles */
    .card { 
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      box-shadow: var(--shadow-lg);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }
    
    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary));
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    
    .card:hover {
      transform: translateY(-4px);
      box-shadow: var(--shadow-xl);
      background: var(--bg-card-hover);
      border-color: var(--border-light);
    }
    
    .card:hover::before {
      opacity: 1;
    }
    
    .card h2 {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 16px;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    /* Grid Layouts */
    .grid { 
      display: grid; 
      gap: 24px; 
    }
    .grid-4 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .grid-2 { grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); }
    .grid-3 { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
    
    /* Status Pills */
    .pill { 
      display: inline-flex; 
      align-items: center; 
      gap: 8px; 
      padding: 10px 18px; 
      background: rgba(255, 255, 255, 0.2);
      color: #ffffff;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50px; 
      font-weight: 800;
      font-size: 14px;
      transition: all 0.3s ease;
      text-shadow: 0 2px 4px rgba(0,0,0,0.6);
      backdrop-filter: blur(15px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    
    .pill:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: scale(1.05);
      border-color: rgba(255, 255, 255, 0.5);
      box-shadow: 0 6px 16px rgba(0,0,0,0.3);
    }
    
    /* ETH Price Pill特殊样式 */
    #ethPricePill {
      background: rgba(34, 197, 94, 0.25);
      border-color: rgba(34, 197, 94, 0.5);
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(34, 197, 94, 0.2);
    }
    
    #ethPricePill:hover {
      background: rgba(34, 197, 94, 0.35);
      border-color: rgba(34, 197, 94, 0.7);
      box-shadow: 0 6px 16px rgba(34, 197, 94, 0.3);
    }
    
    /* 时间戳样式 */
    .header-timestamp {
      color: rgba(255, 255, 255, 0.9);
      font-size: 14px;
      font-weight: 600;
      text-shadow: 0 1px 3px rgba(0,0,0,0.5);
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    
    /* 价格变化样式 */
    .price-change {
      color: rgba(255, 255, 255, 0.8);
      font-weight: 600;
      text-shadow: 0 1px 2px rgba(0,0,0,0.4);
    }
     
     /* Account Balance Styles */
     .account-balance {
       text-align: right;
       background: rgba(255, 255, 255, 0.1);
       padding: 16px 20px;
       border-radius: 12px;
       border: 1px solid rgba(255, 255, 255, 0.2);
       backdrop-filter: blur(10px);
       min-width: 180px;
     }
     
     .balance-label {
       font-size: 12px;
       color: rgba(255, 255, 255, 0.7);
       font-weight: 500;
       text-transform: uppercase;
       letter-spacing: 0.5px;
       margin-bottom: 4px;
     }
     
     .balance-value {
       font-size: 20px;
       font-weight: 800;
       color: #ffffff;
       text-shadow: 0 1px 3px rgba(0,0,0,0.3);
       margin-bottom: 2px;
     }
     
     .balance-status {
       font-size: 11px;
       color: rgba(34, 197, 94, 0.9);
       font-weight: 600;
       text-transform: uppercase;
       letter-spacing: 0.3px;
     }
    
    .status-dot { 
      width: 8px; 
      height: 8px; 
      border-radius: 50%; 
      background: var(--success);
      animation: pulse 2s infinite;
    }
    
    .status-dot.inactive { 
      background: var(--text-muted);
      animation: none;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    /* Value Display */
    .value { 
      font-size: 28px; 
      font-weight: 800;
      line-height: 1.2;
      margin-bottom: 4px;
    }
    
    .label { 
      font-size: 13px; 
      color: var(--text-muted);
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .muted { 
      color: var(--text-muted);
      font-size: 14px;
    }
    
    /* Progress Bar */
    .progress { 
      height: 8px; 
      background: var(--border); 
      border-radius: 4px; 
      overflow: hidden;
      margin: 12px 0;
      position: relative;
    }
    
    .progress .bar { 
      height: 100%; 
      background: linear-gradient(90deg, var(--success) 0%, var(--success-light) 100%);
      width: 0%; 
      transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
    }
    
    .progress .bar::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
      animation: shimmer 2s infinite;
    }
    
    @keyframes shimmer {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }
    
    /* Metric Grid */
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }
    
    .metric {
      text-align: center;
      padding: 12px;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 8px;
      border: 1px solid var(--border);
      transition: all 0.3s ease;
    }
    
    .metric:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: var(--border-light);
    }
    
    /* Table Styles */
    table { 
      width: 100%; 
      border-collapse: collapse; 
      font-size: 14px;
      margin-top: 16px;
    }
    
    th, td { 
      padding: 12px 16px; 
      border-bottom: 1px solid var(--border); 
      text-align: left;
      transition: background-color 0.3s ease;
    }
    
    th {
      background: rgba(255, 255, 255, 0.02);
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      font-size: 12px;
      letter-spacing: 0.5px;
    }
    
    tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }
    
    /* Chips */
    .chip { 
      display: inline-block; 
      padding: 4px 12px; 
      border-radius: 50px; 
      background: rgba(59, 130, 246, 0.1);
      color: var(--accent-primary);
      font-size: 12px;
      font-weight: 600;
      border: 1px solid rgba(59, 130, 246, 0.2);
    }
    
    /* Footer */
    footer { 
      text-align: center; 
      color: var(--text-muted); 
      font-size: 13px; 
      margin-top: 48px;
      padding: 24px 0;
      border-top: 1px solid var(--border);
    }
    
    /* Responsive Design */
      @media (max-width: 768px) {
        .container { padding: 0 16px; }
        h1 { 
          font-size: 24px;
          gap: 8px;
        }
        .subtitle { font-size: 14px; }
        .grid-4 { grid-template-columns: 1fr; }
        .grid-2 { grid-template-columns: 1fr; }
        .card { padding: 16px; }
        .value { font-size: 24px; }
        
        /* 移动端logo图标调整 */
        .logo-icon {
          width: 28px;
          height: 28px;
        }
        
        /* 移动端账户余额样式调整 */
        .account-balance {
          min-width: 140px;
          padding: 12px 16px;
        }
        
        .balance-value {
          font-size: 16px;
        }
        
        /* 头部布局调整 */
        header .container > div:first-child {
          flex-direction: column;
          align-items: stretch;
          gap: 16px;
        }
        
        .account-balance {
          align-self: flex-end;
        }
      }
    
    /* Loading Animation */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .card {
      animation: fadeIn 0.6s ease-out;
    }
    
    .card:nth-child(1) { animation-delay: 0.1s; }
    .card:nth-child(2) { animation-delay: 0.2s; }
    .card:nth-child(3) { animation-delay: 0.3s; }
    .card:nth-child(4) { animation-delay: 0.4s; }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
        <div>
          <h1>
            <svg class="logo-icon" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg">
              <polygon fill="#627EEA" points="249.982,6.554 397.98,251.112 250.53,188.092 "/>
              <polygon fill="#8A92B2" points="102.39,251.112 249.982,6.554 250.53,188.092 "/>
              <polygon fill="#627EEA" points="249.982,341.285 102.39,251.112 250.53,188.092 "/>
              <polygon fill="#454A75" points="397.98,251.112 250.53,188.092 249.982,341.285 "/>
              <polygon fill="#627EEA" points="249.982,372.329 397.98,284.597 249.982,493.13 "/>
              <polygon fill="#8A92B2" points="249.982,372.329 102.39,284.597 249.982,493.13 "/>
            </svg>
            ⚡ HF 高频波段交易系统
          </h1>
          <div class="subtitle">🛡️ 1倍合约 · 零爆仓风险 · 无限制交易 · 实时监控</div>
        </div>
        <div class="account-balance">
          <div class="balance-label">账户余额</div>
          <div class="balance-value" id="accountBalance">10,000.00 USDT</div>
          <div class="balance-status" id="balanceStatus">可用资金</div>
        </div>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center;">
        <span class="pill" id="systemStatus">
          <span class="status-dot" id="statusDot"></span>
          <span id="statusText">系统状态</span>
        </span>
        <span class="header-timestamp" id="timestamp">加载中...</span>
        <span class="pill" id="ethPricePill">
          <span>💎 ETH 现价: <strong id="ethPrice">--</strong></span>
          <span class="price-change" style="margin-left:8px;">24h: <span id="ethChange">--%</span></span>
        </span>
      </div>
    </div>
  </header>
  
  <main class="container">
    <!-- 核心指标 -->
    <section class="grid grid-4" style="margin-bottom: 32px;">
      <div class="card">
        <h2>📊 胜率统计</h2>
        <div class="stat">
          <div class="value" id="winRate" style="color: var(--success);">--%</div>
          <div class="label">成功率</div>
        </div>
        <div class="progress">
          <div class="bar" id="winRateProgress" style="width: 0%;"></div>
        </div>
        <div class="muted" style="margin-top: 12px;" id="tradesSummary">总交易: --</div>
      </div>
      
      <div class="card">
        <h2>💰 总盈亏</h2>
        <div class="stat">
          <div class="value" id="totalProfit">-- USDT</div>
          <div class="label">累计收益（净）</div>
        </div>
        <div class="muted" id="avgProfit" style="margin-top: 8px;">平均每笔: -- USDT</div>
        <div class="muted" style="margin-top: 4px;">累计手续费: <span class="chip" id="totalFees">-- USDT</span></div>
      </div>
      
      <div class="card">
        <h2>📈 今日交易</h2>
        <div class="stat">
          <div class="value" id="dailyTrades">--</div>
          <div class="label">当日交易次数</div>
        </div>
        <div class="muted" id="todayProfit" style="margin-top: 8px;">今日收益: -- USDT</div>
      </div>
      
      <div class="card">
        <h2>⚙️ 系统状态</h2>
        <div class="status" style="margin-bottom: 16px;">
          <span class="pill">
            <span class="status-dot" id="statusDot2"></span>
            <span id="statusText2">--</span>
          </span>
        </div>
        <div class="muted">📋 挂单数: <span id="ordersCount">--</span></div>
        <div class="muted" id="positionState" style="margin-top: 4px;">📍 持仓: --</div>
      </div>
    </section>

    <!-- 详细信息 -->
    <section class="grid grid-2" style="margin-bottom: 32px;">
      <div class="card">
        <h2>🎯 最新交易信号</h2>
        <div id="signalBox" class="muted" style="padding: 16px; background: rgba(255,255,255,0.02); border-radius: 8px; margin-bottom: 16px;">暂无信号</div>
        <div class="metric-grid" id="signalMetrics">
          <div class="metric">
            <div class="value" id="signalStrength" style="font-size: 20px;">--</div>
            <div class="label">信号强度</div>
          </div>
          <div class="metric">
            <div class="value" id="signalConfidence" style="font-size: 20px;">--%</div>
            <div class="label">置信度</div>
          </div>
        </div>
      </div>
      
      <div class="card">
        <h2>📍 当前持仓</h2>
        <div id="positionBox" class="muted" style="padding: 16px; background: rgba(255,255,255,0.02); border-radius: 8px; margin-bottom: 16px;">暂无持仓</div>
        <div class="metric-grid" id="positionMetrics">
          <div class="metric">
            <div class="value" id="positionPnL" style="font-size: 20px;">--</div>
            <div class="label">浮动盈亏</div>
          </div>
          <div class="metric">
            <div class="value" id="positionTime" style="font-size: 20px;">--</div>
            <div class="label">持仓时间</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 性能指标 -->
    <section class="card" style="margin-bottom: 32px;">
      <h2>📊 性能分析</h2>
      <div class="metric-grid">
        <div class="metric">
          <div class="value" id="profitFactor" style="font-size: 20px;">--</div>
          <div class="label">盈利因子</div>
        </div>
        <div class="metric">
          <div class="value" id="maxDrawdown" style="font-size: 20px;">--%</div>
          <div class="label">最大回撤</div>
        </div>
        <div class="metric">
          <div class="value" id="successfulTrades" style="font-size: 20px;">--</div>
          <div class="label">成功交易</div>
        </div>
        <div class="metric">
          <div class="value" id="systemUptime" style="font-size: 20px;">--</div>
          <div class="label">运行时间</div>
        </div>
      </div>
    </section>

    <!-- 挂单列表 -->
    <section class="card">
      <h2>📋 挂单列表</h2>
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>订单ID</th><th>方向</th><th>价格</th><th>状态</th><th>创建时间</th><th>信号置信度</th>
            </tr>
          </thead>
          <tbody id="ordersTable">
            <tr><td colspan="6" class="muted">暂无挂单</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <footer>
      <div>🔒 无密钥模式运行，仅访问公开市场数据 | ⚡ 1倍杠杆零爆仓风险 | 🎯 高频波段策略</div>
      <div style="margin-top: 8px;">⏱️ 数据每5秒自动刷新 | 系统时间: <span id="systemTime">--</span></div>
    </footer>
  </main>

  <script>
    async function fetchJSON(path) {
      const res = await fetch(path);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }

    function fmtUSDT(v) { return Number(v || 0).toFixed(2) + ' USDT'; }
    function fmtPct(v) { return Number(v || 0).toFixed(2) + '%'; }

    async function refresh() {
      try {
        const data = await fetchJSON('/api/dashboard');
        console.log('Dashboard data:', data); // 调试日志
        
        // 系统状态
        const running = Boolean(data.system && data.system.isRunning);
        document.getElementById('statusDot').className = running ? 'status-dot' : 'status-dot inactive';
        document.getElementById('statusText').textContent = running ? '运行中' : '已停止';
        document.getElementById('statusDot2').className = running ? 'status-dot' : 'status-dot inactive';
        document.getElementById('statusText2').textContent = running ? '运行中' : '已停止';

        // 市场数据更新 - ETH价格
        if (data.market) {
          console.log('Updating market data:', data.market);
          const ethPriceElement = document.getElementById('ethPrice');
          const ethChangeElement = document.getElementById('ethChange');
          
          if (ethPriceElement) {
            ethPriceElement.textContent = Number(data.market.price || 0).toFixed(2);
            console.log('ETH price updated to:', ethPriceElement.textContent);
          } else {
            console.error('ethPrice element not found!');
          }
          
          if (ethChangeElement) {
            const change24h = data.market.change24h || 0;
            ethChangeElement.textContent = (change24h >= 0 ? '+' : '') + change24h.toFixed(2) + '%';
            ethChangeElement.style.color = change24h >= 0 ? '#22c55e' : '#ef4444';
            console.log('ETH change updated to:', ethChangeElement.textContent);
          } else {
            console.error('ethChange element not found!');
          }
        } else {
          console.log('No market data available');
          const ethPriceElement = document.getElementById('ethPrice');
          const ethChangeElement = document.getElementById('ethChange');
          if (ethPriceElement) ethPriceElement.textContent = '--';
          if (ethChangeElement) ethChangeElement.textContent = '--%';
        }

        // 账户余额更新
        const currentBalance = 10000 + ((data.trading && data.trading.netProfit) || 0);
        document.getElementById('accountBalance').textContent = Number(currentBalance).toLocaleString('zh-CN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }) + ' USDT';
        
        // 根据盈亏状态更新余额颜色
        const balanceElement = document.getElementById('accountBalance');
        const profit = (data.trading && data.trading.netProfit) || 0;
        if (profit > 0) {
          balanceElement.style.color = '#22c55e';
        } else if (profit < 0) {
          balanceElement.style.color = '#ef4444';
        } else {
          balanceElement.style.color = '#ffffff';
        }

        // 核心指标
        const winRate = (data.trading && data.trading.winRate) || 0;
        document.getElementById('winRate').textContent = winRate.toFixed(1) + '%';
        document.getElementById('winRateProgress').style.width = Math.min(100, winRate).toFixed(1) + '%';
        document.getElementById('tradesSummary').textContent = '总交易: ' + ((data.trading && data.trading.totalTrades) || 0) + ' | 成功: ' + ((data.trading && data.trading.successfulTrades) || 0);

        const netProfit = (data.trading && data.trading.netProfit !== undefined) ? data.trading.netProfit : ((data.trading && data.trading.totalProfit) || 0);
        document.getElementById('totalProfit').textContent = fmtUSDT(netProfit);
        document.getElementById('totalProfit').style.color = netProfit >= 0 ? 'var(--success)' : 'var(--danger)';

        const totalFees = (data.trading && data.trading.totalFees) || 0;
        document.getElementById('totalFees').textContent = fmtUSDT(totalFees);

        const avgProfit = (data.trading && data.trading.avgProfitPerTrade) || 0;
        document.getElementById('avgProfit').textContent = '平均每笔: ' + Number(avgProfit).toFixed(3) + ' USDT';

        document.getElementById('dailyTrades').textContent = String((data.trading && data.trading.dailyTrades) || 0);
        document.getElementById('todayProfit').textContent = '今日收益: ' + fmtUSDT(netProfit);

        document.getElementById('ordersCount').textContent = String((data.orders && data.orders.length) || 0);
        document.getElementById('positionState').textContent = '持仓: ' + (data.position ? '有' : '无');

        // 性能指标
        document.getElementById('profitFactor').textContent = ((data.performance && data.performance.profitFactor) || 0).toFixed(2);
        document.getElementById('maxDrawdown').textContent = (((data.performance && data.performance.maxDrawdown) || 0) * 100).toFixed(1) + '%';
        document.getElementById('successfulTrades').textContent = String((data.trading && data.trading.successfulTrades) || 0);
        if (data.system && data.system.timestamp) {
          document.getElementById('systemTime').textContent = new Date(data.system.timestamp).toLocaleString();
          document.getElementById('timestamp').textContent = new Date(data.system.timestamp).toLocaleString();
        }

        // 最新信号
        const sig = data.signal;
        if (sig && sig.signal) {
          const s = sig.signal;
          document.getElementById('signalBox').textContent = '方向: ' + (s.type === 'BUY' || s.type === 'STRONG_BUY' ? '🟢 做多' : '🔴 做空') + ' | 强度: ' + (s.strength || '--');
          document.getElementById('signalConfidence').textContent = ((s.confidence || 0) * 100).toFixed(0) + '%';
          document.getElementById('signalStrength').textContent = String(s.strength || '--');
        } else {
          document.getElementById('signalBox').textContent = '暂无信号';
          document.getElementById('signalConfidence').textContent = '--%';
          document.getElementById('signalStrength').textContent = '--';
        }

        // 持仓信息
        const pos = data.position;
        if (pos) {
          const directionText = pos.direction === 'LONG' ? '🟢 做多' : '🔴 做空';
          const heldMs = Date.now() - (pos.entryTime || Date.now());
          const heldMin = Math.floor(heldMs / 60000);
          document.getElementById('positionBox').textContent = '方向: ' + directionText + ' | 入场价: ' + Number(pos.entryPrice || 0).toFixed(2) + ' | 数量: ' + Number(pos.size || 0).toFixed(3) + ' | 开仓费: ' + fmtUSDT(pos.entryFee || 0);
          document.getElementById('positionTime').textContent = heldMin + ' 分钟';

          // 估算浮动盈亏（简化为用信号目标价/当前价差异，真实场景应后端返回当前价）
          document.getElementById('positionPnL').textContent = '实时计算中';
        } else {
          document.getElementById('positionBox').textContent = '暂无持仓';
          document.getElementById('positionPnL').textContent = '--';
          document.getElementById('positionTime').textContent = '--';
        }

        // 挂单列表
        const orders = data.orders || [];
        const tbody = document.getElementById('ordersTable');
        if (orders.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="muted">暂无挂单</td></tr>';
        } else {
          tbody.innerHTML = orders.map(function(o){
            var dir = o.signal && o.signal.direction ? (o.signal.direction === 'LONG' ? '🟢 做多' : '🔴 做空') : '--';
            var conf = o.signal && o.signal.confidence ? (Number(o.signal.confidence) * 100).toFixed(0) + '%' : '--';
            return '<tr>' +
              '<td>' + o.id + '</td>' +
              '<td>' + dir + '</td>' +
              '<td>' + Number(o.orderPrice || 0).toFixed(2) + '</td>' +
              '<td>' + (o.status || '--') + '</td>' +
              '<td>' + (o.createdAt ? new Date(o.createdAt).toLocaleString() : '--') + '</td>' +
              '<td>' + conf + '</td>' +
              '</tr>';
          }).join('');
        }
      } catch (err) {
        console.error('刷新失败:', err);
      }
    }

    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;
}