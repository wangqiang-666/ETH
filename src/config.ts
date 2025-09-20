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
        url: process.env.HK_PROXY_URL || process.env.PROXY_URL || '',
        baseUrl: process.env.HK_PROXY_URL || process.env.PROXY_URL || '',
        // 当 FORCE_PROXY=true 或 USE_PROXY=true 时才启用代理
        enabled: (process.env.FORCE_PROXY === 'true') || (process.env.USE_PROXY === 'true'),
        // 强制仅走代理（大陆直连不可用场景）
        forceOnly: process.env.FORCE_PROXY === 'true',
        // 显式将 FORCE_PROXY 与 USE_PROXY 都设置为 'false' 时，固定直连模式，禁止自动切换到代理
        directOnly: (process.env.FORCE_PROXY === 'false') && (process.env.USE_PROXY === 'false'),
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
    
    // 实时广播控制
    realtime: {
        jitterEnabled: (process.env.RT_JITTER_ENABLED || 'false') === 'true',
        jitterMaxMs: parseInt(process.env.RT_JITTER_MAX_MS || '800'),
        dedupeEnabled: (process.env.RT_DEDUPE_ENABLED || 'false') === 'true',
        dedupeWindowMs: parseInt(process.env.RT_DEDUPE_WINDOW_MS || '2000'),
        snapshotEnabled: (process.env.RT_SNAPSHOT_ENABLED || 'false') === 'true',
        snapshotDir: process.env.RT_SNAPSHOT_DIR || ''
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
        takeProfitPercent: parseFloat(
          process.env.TAKE_PROFIT_PERCENT || String(parseFloat(process.env.STOP_LOSS_PERCENT || '0.02') * 1.4)
        ), // 默认=止损的1.4倍（止损默认0.02 -> 0.028）
        maxRiskPerTrade: parseFloat(process.env.MAX_RISK_PER_TRADE || '0.02'),  // 2%
        maxDrawdown: parseFloat(process.env.MAX_DRAWDOWN || '0.10'),            // 10%
        // 新增：同向活跃推荐的上限，默认2
        maxSameDirectionActives: parseInt(process.env.MAX_SAME_DIR_ACTIVES || '2'),
        // 新增：净杠杆敞口上限（单位为账户名义比例）。<=0 表示不限制
        netExposureCaps: {
            // 总净名义敞口上限（所有方向合计 size*leverage 的和，与 maxPositionSize 同量纲）
            total: parseFloat(process.env.NET_EXPOSURE_CAP_TOTAL || '0'),
            // 分方向上限（可选），未设置或<=0 表示不限制
            perDirection: {
                LONG: parseFloat(process.env.NET_EXPOSURE_CAP_LONG || '0'),
                SHORT: parseFloat(process.env.NET_EXPOSURE_CAP_SHORT || '0')
            }
        },
        // 新增：每小时下单次数上限（0 表示不限制）
        hourlyOrderCaps: {
            total: parseInt(process.env.HOURLY_ORDER_CAP_TOTAL || '0'),
            perDirection: {
                LONG: parseInt(process.env.HOURLY_ORDER_CAP_LONG || '0'),
                SHORT: parseInt(process.env.HOURLY_ORDER_CAP_SHORT || '0')
            }
        }
    },
    
    // 交易成本配置（用于动态EV阈值与回测一致）
    commission: parseFloat(process.env.COMMISSION || '0.001'),   // 手续费（单边）
    slippage: parseFloat(process.env.SLIPPAGE || '0.0005'),      // 滑点（比例）
    
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
        // 新增：EV 门槛（支持 EV_THRESHOLD/EXPECTED_VALUE_THRESHOLD 环境变量），默认 0.35
        evThreshold: parseFloat(process.env.EV_THRESHOLD || process.env.EXPECTED_VALUE_THRESHOLD || '0.35'),
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
        allowOppositeWhileOpen: (process.env.ALLOW_OPPOSITE_WHILE_OPEN || 'false') === 'true',
        // 新增：生成反向推荐的最低置信度阈值（默认0.70）
        oppositeMinConfidence: parseFloat(process.env.OPPOSITE_MIN_CONFIDENCE || '0.70'),
        // 新增：允许在风险评估为 HIGH 时仍自动出单（仅用于观测/调试）
        allowAutoOnHighRisk: (process.env.ALLOW_AUTO_ON_HIGH_RISK || 'false') === 'true',
        // 新增：自动推荐轮询间隔（毫秒），降低可更快出单
        autoRecommendationIntervalMs: parseInt(process.env.AUTO_RECO_INTERVAL_MS || '15000'),
        // 新增：策略信号冷却时间（毫秒），默认30分钟
        signalCooldownMs: parseInt(process.env.SIGNAL_COOLDOWN_MS || '1800000'),
        // 新增：反向信号的最小间隔（毫秒），默认5分钟
        oppositeCooldownMs: parseInt(process.env.OPPOSITE_COOLDOWN_MS || '300000'),
        // 新增：振荡器开关（默认停用KDJ与Williams）
        oscillators: {
            useKDJ: (process.env.USE_KDJ || 'false') === 'true',
            useWilliams: (process.env.USE_WILLIAMS || 'false') === 'true'
        },
        // 新增：门控参数（ADX/量能/波动）
        gating: {
            adx: {
                enabled: (process.env.GATE_ADX_ENABLED || 'false') === 'true',
                min: parseFloat(process.env.GATE_ADX_MIN || process.env.ADX_STRONG || '25')
            },
            volume: {
                enabled: (process.env.GATE_VOLUME_ENABLED || 'false') === 'true',
                obvSlopeMin: parseFloat(process.env.GATE_OBV_SLOPE_MIN || '0'),
                volumeRatioMin: parseFloat(process.env.GATE_VOLUME_RATIO_MIN || '0.7')
            },
            volatility: {
                enabled: (process.env.GATE_VOLATILITY_ENABLED || 'false') === 'true',
                atrPctMin: parseFloat(process.env.GATE_ATR_PCT_MIN || '0.005'),
                squeezeBlock: (process.env.GATE_SQUEEZE_BLOCK || 'true') === 'true'
            }
        },
        // 新增：Kelly 缩放（可选，默认关闭）
        kelly: {
            enabled: (process.env.KELLY_ENABLED || 'false') === 'true',
            maxFraction: parseFloat(process.env.KELLY_MAX_FRACTION || '0.2'),
            minFraction: parseFloat(process.env.KELLY_MIN_FRACTION || '0.02')
        },
        // 新增：ATR 驱动的止损/止盈（可选，默认关闭）
        atrStops: {
            enabled: (process.env.ATR_STOPS_ENABLED || 'false') === 'true',
            // ATR 来源：'hl' 使用高低价近似，'indicators' 使用指标管道，默认 hl
            source: process.env.ATR_SOURCE || 'hl',
            // ATR 参数（若指标不可用则仅作记录）
            atrPeriod: parseInt(process.env.ATR_PERIOD || process.env.KC_ATR_PERIOD || '14'),
            // 距离倍数
            slMultiplier: parseFloat(process.env.ATR_SL_MULTIPLIER || '1.5'),
            tpMultiplier: parseFloat(process.env.ATR_TP_MULTIPLIER || '2.2'),
            // 最小/上限 ATR 百分比（用于 hl 近似防抖）
            minAtrPct: parseFloat(process.env.ATR_MIN_PCT || process.env.GATE_ATR_PCT_MIN || '0.005'),
            capAtrPct: parseFloat(process.env.ATR_CAP_PCT || '0.2')
        },
        // 新增：Kronos 模型集成配置
        kronos: {
            enabled: process.env.KRONOS_ENABLED === 'true',
            baseUrl: process.env.KRONOS_BASE_URL || 'http://localhost:8001',
            timeoutMs: Number(process.env.KRONOS_TIMEOUT_MS || 1200),
            interval: process.env.KRONOS_INTERVAL || '1H',
            lookback: Number(process.env.KRONOS_LOOKBACK || 480),
            longThreshold: Number(process.env.KRONOS_LONG_THRESHOLD || 0.62),
            shortThreshold: Number(process.env.KRONOS_SHORT_THRESHOLD || 0.62),
            minConfidence: Number(process.env.KRONOS_MIN_CONFIDENCE || 0.55),
            // 新增：融合占比上限（0-1），限制 Kronos 对ML通道的最大影响力
            alphaMax: Number(process.env.KRONOS_ALPHA_MAX || 0.6)
        }
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
    },

    // 测试与调试配置
    testing: {
        // 是否允许通过测试接口覆盖行情价格（仅用于本地/E2E 调试，不可在生产启用）
        allowPriceOverride: (process.env.TEST_ALLOW_PRICE_OVERRIDE || 'false') === 'true',
        // 覆盖价格默认有效期（毫秒）
        priceOverrideDefaultTtlMs: parseInt(process.env.TEST_PRICE_OVERRIDE_TTL_MS || '15000'),
        // 是否允许覆盖情绪指数（FGI）
        allowFGIOverride: (process.env.TEST_ALLOW_FGI_OVERRIDE || 'false') === 'true',
        // FGI 覆盖默认有效期（毫秒）
        fgiOverrideDefaultTtlMs: parseInt(process.env.TEST_FGI_OVERRIDE_TTL_MS || '15000'),
        // 是否允许覆盖资金费率
        allowFundingOverride: (process.env.TEST_ALLOW_FUNDING_OVERRIDE || 'false') === 'true',
        // 资金费率覆盖默认有效期（毫秒）
        fundingOverrideDefaultTtlMs: parseInt(process.env.TEST_FUNDING_OVERRIDE_TTL_MS || '15000')
    },

    // 新增：推荐跟踪与并发统计配置
    recommendation: {
        // 最大持仓时长（小时）。<=0 则表示不自动过期
        maxHoldingHours: parseInt(process.env.RECOMMENDATION_MAX_HOLDING_HOURS || '168'),
        // 最小持仓时间（分钟）。仅限制“止盈”触发；<=0 表示不限制
        minHoldingMinutes: parseInt(process.env.RECOMMENDATION_MIN_HOLDING_MINUTES || '0'),
        // 并发计数的时间窗口（小时）。仅统计持仓时长小于该值的 ACTIVE 推荐
        concurrencyCountAgeHours: parseInt(process.env.RECOMMENDATION_CONCURRENCY_AGE_HOURS || '24'),
        // 新增：追踪止损配置
        trailing: {
            // 是否启用追踪止损
            enabled: (process.env.RECOMMENDATION_TRAIL_ENABLED || 'false') === 'true',
            // 追踪距离（百分比，基于标的价格变动，不包含杠杆），例如 0.8 表示 0.8%
            percent: parseFloat(process.env.RECOMMENDATION_TRAIL_PERCENT || '0'),
            // 新增：只有当基础涨跌幅达到该阈值（%）后才开始移动追踪止盈/止损，避免过早被扫出
            activateProfitPct: parseFloat(process.env.RECOMMENDATION_TRAIL_ACTIVATE_PROFIT_PCT || '2.2'),
            // 是否在“止损已抬到保本（TP1 命中）”后才开始追踪
            activateOnBreakeven: (process.env.RECOMMENDATION_TRAIL_ON_BREAKEVEN || 'true') === 'true',
            // 最小更新步长（价格，避免频繁抖动更新）。<=0 则不限制
            minStep: parseFloat(process.env.RECOMMENDATION_TRAIL_MIN_STEP || '0'),
            // 自适应：在低利润阶段放宽、在高利润阶段收紧
            flex: {
                enabled: (process.env.RECOMMENDATION_TRAIL_FLEX_ENABLED || 'true') === 'true',
                // 低利润区阈值（基于标的百分比，不含杠杆），例如 3.5 表示 3.5%
                lowProfitThreshold: parseFloat(process.env.RECOMMENDATION_TRAIL_FLEX_LOW_THRESHOLD || '3.5'),
                // 高利润区阈值（更晚才收紧）
                highProfitThreshold: parseFloat(process.env.RECOMMENDATION_TRAIL_FLEX_HIGH_THRESHOLD || '7'),
                // 低利润区放宽倍数（>1 表示轨距更宽）
                lowMultiplier: parseFloat(process.env.RECOMMENDATION_TRAIL_FLEX_LOW_MULTIPLIER || '2.8'),
                // 高利润区收紧倍数（<1 表示轨距更窄）
                highTightenMultiplier: parseFloat(process.env.RECOMMENDATION_TRAIL_FLEX_HIGH_TIGHTEN || '0.6')
            }
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