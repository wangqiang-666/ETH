// 香港服务器端OKX API完整代理服务 - 优化版本
// 部署在香港服务器上，转发所有OKX API请求
// 增强功能：连接池、数据压缩、智能缓存、性能监控

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const redis = require('redis');
const NodeCache = require('node-cache');
const cluster = require('cluster');
const os = require('os');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 8080;
const WORKERS = process.env.WORKERS || os.cpus().length;

// OKX API配置
const OKX_REST_API = 'https://www.okx.com';
const OKX_BACKUP_API = 'https://okx.com';
const OKX_WS_API = 'wss://ws.okx.com:8443/ws/v5/public';

// 缓存配置
const cache = new NodeCache({ 
  stdTTL: 1, // 默认1秒缓存
  checkperiod: 2, // 每2秒检查过期
  useClones: false // 提高性能
});

// Redis缓存（如果可用）
let redisClient = null;
try {
  redisClient = redis.createClient({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    retry_strategy: (options) => {
      if (options.error && options.error.code === 'ECONNREFUSED') {
        return new Error('Redis服务器拒绝连接');
      }
      if (options.total_retry_time > 1000 * 60 * 60) {
        return new Error('重试时间已用尽');
      }
      if (options.attempt > 10) {
        return undefined;
      }
      return Math.min(options.attempt * 100, 3000);
    }
  });
  console.log('✅ Redis缓存已启用');
} catch (error) {
  console.log('⚠️  Redis不可用，使用内存缓存');
}

// 性能监控
const performanceMetrics = {
  requests: 0,
  errors: 0,
  totalResponseTime: 0,
  avgResponseTime: 0,
  cacheHits: 0,
  cacheMisses: 0,
  startTime: Date.now()
};

// 集群模式
if (cluster.isMaster && process.env.NODE_ENV === 'production') {
  console.log(`🚀 启动 ${WORKERS} 个工作进程`);
  
  for (let i = 0; i < WORKERS; i++) {
    cluster.fork();
  }
  
  cluster.on('exit', (worker, code, signal) => {
    console.log(`工作进程 ${worker.process.pid} 已退出`);
    cluster.fork();
  });
} else {
  // 工作进程代码
  startServer();
}

function startServer() {
  // 安全中间件
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  }));

  // 启用gzip压缩
  app.use(compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
    level: 6, // 压缩级别
    threshold: 1024 // 只压缩大于1KB的响应
  }));

  // CORS配置 - 优化版
  app.use(cors({
    origin: function(origin, callback) {
      // 允许的域名列表
      const allowedOrigins = [
        'http://localhost:3001',
        'http://localhost:3000',
        'https://your-domain.com'
      ];
      
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // 临时允许所有域名
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 'Authorization', 'X-Requested-With',
      'OK-ACCESS-KEY', 'OK-ACCESS-SIGN', 'OK-ACCESS-TIMESTAMP', 'OK-ACCESS-PASSPHRASE'
    ],
    credentials: true,
    maxAge: 86400 // 24小时预检缓存
  }));

  // 请求体解析
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // 智能速率限制
  const createRateLimiter = (windowMs, max, message) => {
    return rateLimit({
      windowMs,
      max,
      message: { error: 'Rate limit exceeded', message },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => {
        // 跳过健康检查和静态资源
        return req.path === '/health' || req.path.startsWith('/static');
      }
    });
  };

  // 不同端点使用不同的限制策略
  app.use('/api/v5/market', createRateLimiter(1000, 20, '市场数据请求过于频繁'));
  app.use('/api/v5/public', createRateLimiter(1000, 30, '公共API请求过于频繁'));
  app.use('/api', createRateLimiter(60 * 1000, 600, '总体请求过于频繁'));

  // 性能监控中间件
  app.use((req, res, next) => {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    
    performanceMetrics.requests++;
    
    res.on('finish', () => {
      const responseTime = Date.now() - startTime;
      performanceMetrics.totalResponseTime += responseTime;
      performanceMetrics.avgResponseTime = performanceMetrics.totalResponseTime / performanceMetrics.requests;
      
      if (res.statusCode >= 400) {
        performanceMetrics.errors++;
      }
      
      // 记录慢请求
      if (responseTime > 1000) {
        console.warn(`🐌 慢请求: ${req.method} ${req.url} - ${responseTime}ms`);
      }
    });
    
    console.log(`[${timestamp}] ${req.method} ${req.url} - ${req.ip}`);
    next();
  });

  // 智能缓存中间件
  const cacheMiddleware = (ttl = 1) => {
    return async (req, res, next) => {
      // 只缓存GET请求
      if (req.method !== 'GET') {
        return next();
      }
      
      const cacheKey = `okx:${req.url}:${JSON.stringify(req.query)}`;
      
      try {
        // 尝试从缓存获取
        let cachedData = null;
        
        if (redisClient) {
          cachedData = await redisClient.get(cacheKey);
        } else {
          cachedData = cache.get(cacheKey);
        }
        
        if (cachedData) {
          performanceMetrics.cacheHits++;
          res.set('X-Cache', 'HIT');
          res.set('X-Cache-TTL', ttl.toString());
          return res.json(typeof cachedData === 'string' ? JSON.parse(cachedData) : cachedData);
        }
        
        performanceMetrics.cacheMisses++;
        
        // 拦截响应以缓存数据
        const originalSend = res.json;
        res.json = function(data) {
          // 只缓存成功响应
          if (res.statusCode === 200 && data) {
            try {
              if (redisClient) {
                redisClient.setex(cacheKey, ttl, JSON.stringify(data));
              } else {
                cache.set(cacheKey, data, ttl);
              }
            } catch (error) {
              console.warn('缓存设置失败:', error.message);
            }
          }
          
          res.set('X-Cache', 'MISS');
          return originalSend.call(this, data);
        };
        
        next();
      } catch (error) {
        console.warn('缓存中间件错误:', error.message);
        next();
      }
    };
  };

  // 健康检查接口 - 增强版
  app.get('/health', (req, res) => {
    const uptime = Date.now() - performanceMetrics.startTime;
    const memUsage = process.memoryUsage();
    
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      server: 'HK-OKX-Proxy-Enhanced',
      version: '2.0.0',
      uptime: uptime,
      performance: {
        requests: performanceMetrics.requests,
        errors: performanceMetrics.errors,
        errorRate: (performanceMetrics.errors / performanceMetrics.requests * 100).toFixed(2) + '%',
        avgResponseTime: performanceMetrics.avgResponseTime.toFixed(2) + 'ms',
        cacheHitRate: (performanceMetrics.cacheHits / (performanceMetrics.cacheHits + performanceMetrics.cacheMisses) * 100).toFixed(2) + '%'
      },
      memory: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
        total: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
        external: Math.round(memUsage.external / 1024 / 1024) + 'MB'
      },
      cache: {
        type: redisClient ? 'Redis' : 'Memory',
        keys: redisClient ? 'N/A' : cache.keys().length
      }
    });
  });

  // 性能统计接口
  app.get('/stats', (req, res) => {
    res.json({
      performance: performanceMetrics,
      cache: {
        hits: performanceMetrics.cacheHits,
        misses: performanceMetrics.cacheMisses,
        hitRate: (performanceMetrics.cacheHits / (performanceMetrics.cacheHits + performanceMetrics.cacheMisses) * 100).toFixed(2) + '%'
      },
      memory: process.memoryUsage(),
      uptime: Date.now() - performanceMetrics.startTime
    });
  });

  // 缓存清理接口
  app.post('/cache/clear', (req, res) => {
    try {
      if (redisClient) {
        redisClient.flushall();
      } else {
        cache.flushAll();
      }
      res.json({ message: '缓存已清理', timestamp: Date.now() });
    } catch (error) {
      res.status(500).json({ error: '缓存清理失败', message: error.message });
    }
  });

  // OKX时间接口（兼容旧版本）- 添加缓存
  app.get('/time', cacheMiddleware(1), async (req, res) => {
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(`${OKX_REST_API}/api/v5/public/time`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; OKX-Proxy/2.0)'
        }
      });
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('获取OKX时间失败:', error.message);
      res.status(500).json({
        error: 'Failed to fetch OKX time',
        message: error.message
      });
    }
  });

  // 创建优化的代理中间件配置
  const proxyOptions = {
    target: OKX_REST_API,
    changeOrigin: true,
    secure: true,
    followRedirects: true,
    timeout: 15000, // 减少超时时间
    proxyTimeout: 15000,
    
    // 连接池配置
    agent: new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: 15000
    }),
    
    pathRewrite: {
      '^/api': '/api' // 保持路径不变
    },
    
    // 请求头处理 - 优化版
    onProxyReq: (proxyReq, req, res) => {
      // 设置优化的请求头
      proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      proxyReq.setHeader('Accept', 'application/json, text/plain, */*');
      proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7');
      proxyReq.setHeader('Accept-Encoding', 'gzip, deflate, br');
      proxyReq.setHeader('Cache-Control', 'no-cache');
      proxyReq.setHeader('Connection', 'keep-alive');
      proxyReq.setHeader('Pragma', 'no-cache');
      
      // 保留原始的OKX API认证头
      const okxHeaders = ['OK-ACCESS-KEY', 'OK-ACCESS-SIGN', 'OK-ACCESS-TIMESTAMP', 'OK-ACCESS-PASSPHRASE'];
      okxHeaders.forEach(header => {
        if (req.headers[header.toLowerCase()]) {
          proxyReq.setHeader(header, req.headers[header.toLowerCase()]);
        }
      });
      
      // 添加请求开始时间
      req.proxyStartTime = Date.now();
    },
    
    // 响应处理 - 优化版
    onProxyRes: (proxyRes, req, res) => {
      // 记录响应时间
      if (req.proxyStartTime) {
        const responseTime = Date.now() - req.proxyStartTime;
        res.setHeader('X-Response-Time', responseTime + 'ms');
      }
      
      // 设置缓存头
      if (req.method === 'GET' && proxyRes.statusCode === 200) {
        res.setHeader('Cache-Control', 'public, max-age=1');
      }
      
      // 添加代理标识
      res.setHeader('X-Proxy-Server', 'HK-OKX-Enhanced');
      res.setHeader('X-Proxy-Version', '2.0.0');
    },
    
    // 错误处理 - 增强版
    onError: (err, req, res) => {
      console.error(`代理错误 [${req.method} ${req.url}]:`, err.message);
      performanceMetrics.errors++;
      
      // 尝试备用服务器
      if (!req.retryAttempted) {
        req.retryAttempted = true;
        console.log('尝试备用服务器...');
        
        const backupProxy = createProxyMiddleware({
          ...proxyOptions,
          target: OKX_BACKUP_API
        });
        
        return backupProxy(req, res);
      }
      
      res.status(502).json({
        error: 'Proxy Error',
        message: '代理服务器连接失败',
        timestamp: Date.now()
      });
    }
  };

  // 创建代理中间件
  const apiProxy = createProxyMiddleware(proxyOptions);

  // 应用代理中间件到API路由
  app.use('/api', cacheMiddleware(1), apiProxy);

  // 特定端点的缓存策略
  app.use('/api/v5/public/time', cacheMiddleware(1)); // 1秒缓存
  app.use('/api/v5/market/ticker', cacheMiddleware(2)); // 2秒缓存
  app.use('/api/v5/market/books', cacheMiddleware(1)); // 1秒缓存
  app.use('/api/v5/public/funding-rate', cacheMiddleware(5)); // 5秒缓存

  // 快速访问接口（高度缓存）
  app.get('/quick/ticker/:symbol', cacheMiddleware(2), async (req, res) => {
    try {
      const symbol = req.params.symbol || 'ETH-USDT-SWAP';
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(`${OKX_REST_API}/api/v5/market/ticker?instId=${symbol}`);
      const data = await response.json();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // OPTIONS预检请求处理
  app.options('*', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, OK-ACCESS-KEY, OK-ACCESS-SIGN, OK-ACCESS-TIMESTAMP, OK-ACCESS-PASSPHRASE');
    res.sendStatus(200);
  });

  // 404处理
  app.use('*', (req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `路径 ${req.originalUrl} 不存在`,
      availableEndpoints: [
        '/health - 健康检查',
        '/stats - 性能统计',
        '/api/* - OKX API代理',
        '/quick/ticker/:symbol - 快速行情'
      ]
    });
  });

  // 启动服务器
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 香港OKX代理服务器已启动`);
    console.log(`📡 监听端口: ${PORT}`);
    console.log(`🔧 工作进程: ${process.pid}`);
    console.log(`💾 缓存类型: ${redisClient ? 'Redis' : 'Memory'}`);
    console.log(`⚡ 压缩已启用`);
    console.log(`🛡️  安全防护已启用`);
  });

  // 优雅关闭
  process.on('SIGTERM', () => {
    console.log('收到SIGTERM信号，正在优雅关闭...');
    server.close(() => {
      console.log('服务器已关闭');
      if (redisClient) {
        redisClient.quit();
      }
      process.exit(0);
    });
  });

  // 定期清理缓存
  setInterval(() => {
    if (!redisClient) {
      const stats = cache.getStats();
      if (stats.keys > 1000) {
        cache.flushAll();
        console.log('🧹 内存缓存已清理');
      }
    }
  }, 300000); // 每5分钟检查一次

  // 性能监控报告
  setInterval(() => {
    const uptime = Date.now() - performanceMetrics.startTime;
    const memUsage = process.memoryUsage();
    
    console.log(`📊 性能报告 [${new Date().toISOString()}]`);
    console.log(`   请求总数: ${performanceMetrics.requests}`);
    console.log(`   错误率: ${(performanceMetrics.errors / performanceMetrics.requests * 100).toFixed(2)}%`);
    console.log(`   平均响应时间: ${performanceMetrics.avgResponseTime.toFixed(2)}ms`);
    console.log(`   缓存命中率: ${(performanceMetrics.cacheHits / (performanceMetrics.cacheHits + performanceMetrics.cacheMisses) * 100).toFixed(2)}%`);
    console.log(`   内存使用: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
    console.log(`   运行时间: ${Math.round(uptime / 1000 / 60)}分钟`);
  }, 600000); // 每10分钟报告一次
}