import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

/**
 * ETH合约策略分析系统配置
 */
export const config = {
    // OKX API配置
    okx: {
        apiKey: process.env.OKX_API_KEY || '',
        secretKey: process.env.OKX_SECRET_KEY || '',
        passphrase: process.env.OKX_PASSPHRASE || '',
        sandbox: process.env.OKX_SANDBOX === 'true',
        baseUrl: 'https://www.okx.com',
        // 当 FORCE_PROXY=true 时，强制使用代理
        useProxy: (process.env.FORCE_PROXY === 'true') || (process.env.USE_PROXY === 'true'),
        timeout: 30000  // 增加到30秒
    },
    
    // 代理服务器配置
    proxy: {
        url: process.env.HK_PROXY_URL || 'http://43.132.123.32:8080',
        baseUrl: process.env.HK_PROXY_URL || 'http://43.132.123.32:8080',
        // 当 FORCE_PROXY=true 时，强制启用代理
        enabled: (process.env.FORCE_PROXY === 'true') || (process.env.USE_PROXY === 'true'),
        // 强制仅走代理（大陆直连不可用场景）
        forceOnly: process.env.FORCE_PROXY === 'true',
        timeout: 30000,  // 增加到30秒
        
        // 连接池配置
        pool: {
            maxSockets: 20,           // 每个主机的最大连接数
            maxFreeSockets: 10,       // 每个主机的最大空闲连接数
            keepAlive: true,          // 启用 Keep-Alive
            keepAliveMsecs: 5000,     // Keep-Alive 间隔
            maxTotalSockets: 100      // 总的最大连接数
        },
        
        // 压缩配置
        compression: {
            enabled: true,
            level: 6,                 // gzip 压缩级别 (1-9)
            threshold: 1024           // 压缩阈值，超过1KB才压缩
        },
        
        // 重试配置
        retry: {
            retries: 3,               // 最大重试次数
            retryDelay: 1000,         // 重试延迟（毫秒）
            retryCondition: 'network_error' // 重试条件
        },
        
        // 健康检查配置
        healthCheck: {
            enabled: true,
            interval: 30000,          // 30秒检查一次
            timeout: 5000,            // 健康检查超时
            endpoint: '/health'       // 健康检查端点
        }
    },
    
    // Web服务器配置
    webServer: {
        port: parseInt(process.env.WEB_PORT || '3001'),
        host: process.env.WEB_HOST || 'localhost',
        cors: {
            origin: process.env.CORS_ORIGIN || '*',
            credentials: true
        }
    },
    
    trading: {
        defaultSymbol: process.env.DEFAULT_SYMBOL || 'ETH-USDT-SWAP',
        symbols: [
            'ETH-USDT-SWAP',
            'BTC-USDT-SWAP',
            'SOL-USDT-SWAP',
            'DOGE-USDT-SWAP'
        ],
        intervals: ['1m', '5m', '15m', '1H', '4H', '1D'],
        defaultLeverage: parseInt(process.env.DEFAULT_LEVERAGE || '3'),
        maxLeverage: parseInt(process.env.MAX_LEVERAGE || '20'),
        maxPositions: parseInt(process.env.MAX_POSITIONS || '5')
    },
    
    // 风险管理配置
    risk: {
        maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || '0.05'),        // 5%
        maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || '0.2'),   // 20%
        stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT || '0.02'),  // 2%
        takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT || '0.04'), // 4%
        maxRiskPerTrade: parseFloat(process.env.MAX_RISK_PER_TRADE || '0.02'),  // 2%
        maxDrawdown: parseFloat(process.env.MAX_DRAWDOWN || '0.10')             // 10%
    },
    
    // 技术指标参数
    indicators: {
        // 全局指标选项
        closedOnly: (process.env.INDICATORS_CLOSED_ONLY || 'true') === 'true',
        rsi: {
            period: parseInt(process.env.RSI_PERIOD || '12'),
            overbought: parseInt(process.env.RSI_OVERBOUGHT || '60'),
            oversold: parseInt(process.env.RSI_OVERSOLD || '40')
        },
        macd: {
            fastPeriod: parseInt(process.env.MACD_FAST || '12'),
            slowPeriod: parseInt(process.env.MACD_SLOW || '26'),
            signalPeriod: parseInt(process.env.MACD_SIGNAL || '9')
        },
        bollinger: {
            period: parseInt(process.env.BOLLINGER_PERIOD || '20'),
            stdDev: parseFloat(process.env.BOLLINGER_STD_DEV || '2')
        },
        kdj: {
            period: parseInt(process.env.KDJ_PERIOD || '9'),
            signalPeriod: 3
        },
        williams: {
            period: parseInt(process.env.WILLIAMS_PERIOD || '14')
        },
        ema: {
            shortPeriod: 12,
            longPeriod: 26,
            // 趋势过滤EMA周期
            trendPeriod: parseInt(process.env.EMA_TREND_PERIOD || '100')
        },
        sma: {
            periods: [5, 10, 20, 50, 200]
        },
        adx: {
            period: parseInt(process.env.ADX_PERIOD || '14'),
            weak: parseFloat(process.env.ADX_WEAK || '20'),
            strong: parseFloat(process.env.ADX_STRONG || '25')
        },
        obv: {
            slopeWindow: parseInt(process.env.OBV_SLOPE_WINDOW || '14')
        },
        mfi: {
            period: parseInt(process.env.MFI_PERIOD || '14'),
            hot: parseFloat(process.env.MFI_HOT || '80'),
            cold: parseFloat(process.env.MFI_COLD || '20')
        },
        vwap: {
            enabled: (process.env.VWAP_ENABLED || 'true') === 'true',
            distanceTrend: parseFloat(process.env.VWAP_DISTANCE_TREND || '0.015'),
            distanceMeanRevert: parseFloat(process.env.VWAP_DISTANCE_MEAN_REVERT || '0.008')
        },
        keltner: {
            period: parseInt(process.env.KC_PERIOD || '20'),
            atrPeriod: parseInt(process.env.KC_ATR_PERIOD || '20'),
            multiplier: parseFloat(process.env.KC_MULTIPLIER || '2'),
            squeezeBandwidth: parseFloat(process.env.KC_SQUEEZE_BW || '0.05')
        },
        squeeze: {
            bbBandwidth: parseFloat(process.env.SQUEEZE_BB_BW || '0.07'),
            kcBandwidth: parseFloat(process.env.SQUEEZE_KC_BW || '0.05')
        }
    },
    
    // 策略配置
    strategy: {
        // 信号强度阈值（0-1），用于交易决策过滤
        signalThreshold: parseFloat(process.env.SIGNAL_THRESHOLD || '0.50'),
        // 最小历史胜率（百分比数值，如 55 表示 55%）
        minWinRate: parseFloat(process.env.MIN_WIN_RATE || '55'),
        // 是否启用机器学习辅助分析
        useMLAnalysis: (process.env.USE_ML_ANALYSIS || 'true') === 'true',
        // 多因子加权配置：技术面、机器学习、市场结构
        multiFactorWeights: {
            technical: parseFloat(process.env.WEIGHT_TECHNICAL || '0.5'),
            ml: parseFloat(process.env.WEIGHT_ML || '0.3'),
            market: parseFloat(process.env.WEIGHT_MARKET || '0.2')
        },
        // 主分析周期与K线数量（用于提升1H短期胜率）
        primaryInterval: process.env.PRIMARY_INTERVAL || '1H',
        klineLimit: parseInt(process.env.KLINE_LIMIT || '200'),
        // 入场过滤规则（更严格以提高胜率）
        entryFilters: {
            trendFilter: (process.env.TREND_FILTER || 'true') === 'true',
            minCombinedStrengthLong: parseFloat(process.env.MIN_COMBINED_LONG || '55'),
            minCombinedStrengthShort: parseFloat(process.env.MIN_COMBINED_SHORT || '55'),
            allowHighVolatilityEntries: (process.env.ALLOW_HIGH_VOL || 'false') === 'true'
        },
        // 新增：允许在已有持仓/推荐时生成反向推荐
        allowOppositeWhileOpen: (process.env.ALLOW_OPPOSITE_WHILE_OPEN || 'true') === 'true',
        // 新增：生成反向推荐的最低置信度阈值（默认0.70）
        oppositeMinConfidence: parseFloat(process.env.OPPOSITE_MIN_CONFIDENCE || '0.70'),
        // 新增：允许在风险评估为 HIGH 时仍自动出单（仅用于观测/调试）
        allowAutoOnHighRisk: (process.env.ALLOW_AUTO_ON_HIGH_RISK || 'false') === 'true',
        // 新增：自动推荐轮询间隔（毫秒），降低可更快出单
        autoRecommendationIntervalMs: parseInt(process.env.AUTO_RECO_INTERVAL_MS || '15000'),
        // 新增：策略信号冷却时间（毫秒），默认15分钟
        signalCooldownMs: parseInt(process.env.SIGNAL_COOLDOWN_MS || '900000')
    },
    
    // 机器学习配置（仅本地模型）
    ml: {
        // 本地模型配置
        local: {
            enabled: true,
            modelType: process.env.LOCAL_ML_MODEL || 'ensemble', // 'linear', 'ensemble', 'lstm', 'svm'
            trainingDataSize: parseInt(process.env.ML_TRAINING_SIZE || '500'), // 减少训练数据量
            retrainInterval: parseInt(process.env.ML_RETRAIN_INTERVAL || '50'), // 每50个新样本重训练
            minTrainingData: parseInt(process.env.ML_MIN_TRAINING || '50'), // 减少最小训练数据
            
            // 新增：是否使用真实历史数据进行初始化训练（含真实MACD）
            useRealHistoricalTraining: (process.env.ML_USE_REAL_TRAINING || 'true') === 'true',
            // 新增：训练数据来源参数
            trainingSymbol: process.env.ML_TRAINING_SYMBOL || undefined,
            trainingInterval: process.env.ML_TRAINING_INTERVAL || '5m', // 使用5分钟K线减少数据量
            trainingLimit: parseInt(process.env.ML_TRAINING_LIMIT || '200'), // 减少历史数据获取量
            
            // 模型参数
            parameters: {
                learningRate: parseFloat(process.env.ML_LEARNING_RATE || '0.01'),
                epochs: parseInt(process.env.ML_EPOCHS || '50'), // 减少训练轮数
                batchSize: parseInt(process.env.ML_BATCH_SIZE || '32'), // 减少批次大小
                validationSplit: parseFloat(process.env.ML_VALIDATION_SPLIT || '0.2'), // 减少验证集比例
                regularization: parseFloat(process.env.ML_REGULARIZATION || '0.001')
            },
            
            // 集成学习配置
            ensemble: {
                enabled: true,
                models: [
                    { type: 'linear', weight: 0.3 },
                    { type: 'svm', weight: 0.3 },
                    { type: 'lstm', weight: 0.4 }
                ]
            }
        },
        
        // 训练配置（离线/本地训练参数）
        training: {
            windowDays: parseInt(process.env.ML_TRAINING_WINDOW_DAYS || '14'),
            labelHorizonMinutes: parseInt(process.env.ML_TRAINING_LABEL_HORIZON || '60')
        },
        
        // 标签回填配置
        labeling: {
            enabled: (process.env.ML_LABELING_ENABLED || 'true') === 'true',
            pollIntervalMs: parseInt(process.env.ML_LABELING_POLL_MS || '60000'),
            horizonMinutesDefault: parseInt(process.env.ML_LABEL_HORIZON_DEFAULT || '60')
        },
        
        // 新增：特征开关配置，供高级特征提取使用
        features: {
            advanced: {
                waveletTransform: (process.env.ML_FEATURE_WAVELET || 'true') === 'true',
                fourierAnalysis: (process.env.ML_FEATURE_FOURIER || 'true') === 'true',
                fractalDimension: (process.env.ML_FEATURE_FRACTAL || 'true') === 'true'
            },
            // 市场微观结构特征开关
            marketMicrostructure: (process.env.ML_FEATURE_MARKET_MICRO || 'true') === 'true',
            // 情绪特征开关
            sentiment: {
                fgi: (process.env.ML_FEATURE_FGI || 'true') === 'true'
            }
        }
    },
    
    web: {
        port: parseInt(process.env.WEB_PORT || '3000'),
        host: process.env.WEB_HOST || '0.0.0.0',
        cors: {
            origin: process.env.CORS_ORIGIN || '*',
            credentials: true
        }
    }
};

/**
 * 验证配置
 */
export function validateConfig(): boolean {
    const required = [
        'okx.apiKey',
        'okx.secretKey', 
        'okx.passphrase'
    ];
    
    for (const key of required) {
        const value = key.split('.').reduce((obj, k) => obj?.[k], config as any);
        if (!value) {
            console.error(`❌ 缺少必需的配置项: ${key}`);
            return false;
        }
    }
    
    return true;
}

/**
 * 获取交易对配置
 */
export function getSymbolConfig(symbol: string = config.trading.defaultSymbol) {
    return {
        symbol,
        leverage: config.trading.defaultLeverage,
        stopLoss: config.risk.stopLossPercent,
        takeProfit: config.risk.takeProfitPercent,
        maxPosition: config.risk.maxPositionSize
    };
}

export default config;