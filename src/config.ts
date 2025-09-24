import * as dotenv from 'dotenv';
import { getVPNOptimizedConfig } from './vpn-config.js';

// 加载环境变量
dotenv.config();

// 获取VPN优化配置
const vpnConfig = getVPNOptimizedConfig();

export const config = {
    // OKX API配置
    okx: {
        apiKey: process.env.OKX_API_KEY || '',
        secretKey: process.env.OKX_SECRET_KEY || '',
        passphrase: process.env.OKX_PASSPHRASE || '',
        sandbox: process.env.OKX_SANDBOX === 'true',
        baseUrl: 'https://www.okx.com',
        // 根据VPN环境调整是否使用代理
        useProxy: (process.env.FORCE_PROXY === 'true') || (process.env.USE_PROXY === 'true'),
        timeout: vpnConfig.request.timeout
    },
    
    // 代理配置 - 集成VPN优化
    proxy: {
        url: process.env.HK_PROXY_URL || process.env.PROXY_URL || '',
        baseUrl: process.env.HK_PROXY_URL || process.env.PROXY_URL || '',
        // 当 FORCE_PROXY=true 或 USE_PROXY=true 时才启用代理
        enabled: (process.env.FORCE_PROXY === 'true') || (process.env.USE_PROXY === 'true'),
        // 强制仅走代理（大陆直连不可用场景）
        forceOnly: process.env.FORCE_PROXY === 'true',
        // 显式将 FORCE_PROXY 与 USE_PROXY 都设置为 'false' 时，固定直连模式，禁止自动切换到代理
        directOnly: (process.env.FORCE_PROXY === 'false') && (process.env.USE_PROXY === 'false'),
        timeout: vpnConfig.request.timeout,
        
        // VPN优化的连接池配置
        pool: vpnConfig.pool,
        
        // VPN优化的压缩配置
        compression: vpnConfig.compression,
        
        // VPN优化的重试配置
        retry: vpnConfig.retry,
        
        // VPN优化的健康检查配置
        healthCheck: vpnConfig.healthCheck,
        
        // VPN环境标识
        vpnEnvironment: vpnConfig.isVPNEnvironment,
        macOS: vpnConfig.isMacOS
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
    
    // 实时数据配置
    realtime: {
        jitterEnabled: (process.env.RT_JITTER_ENABLED || 'false') === 'true',
        jitterMaxMs: parseInt(process.env.RT_JITTER_MAX_MS || '800'),
        dedupeEnabled: (process.env.RT_DEDUPE_ENABLED || 'false') === 'true',
        dedupeWindowMs: parseInt(process.env.RT_DEDUPE_WINDOW_MS || '2000'),
        snapshotEnabled: (process.env.RT_SNAPSHOT_ENABLED || 'false') === 'true',
        snapshotDir: process.env.RT_SNAPSHOT_DIR || ''
    },

    // 交易配置
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
        // 同方向最大活跃仓位数
        maxSameDirectionActives: parseInt(process.env.MAX_SAME_DIR_ACTIVES || '2'),
        // 净敞口限制
        netExposureCaps: {
            // 总净敞口限制（0表示不限制）
            total: parseFloat(process.env.NET_EXPOSURE_CAP_TOTAL || '0'),
            // 分方向净敞口限制
            perDirection: {
                LONG: parseFloat(process.env.NET_EXPOSURE_CAP_LONG || '0'),
                SHORT: parseFloat(process.env.NET_EXPOSURE_CAP_SHORT || '0')
            }
        },
        // 每小时订单数量限制
        hourlyOrderCaps: {
            total: parseInt(process.env.HOURLY_ORDER_CAP_TOTAL || '0'),
            perDirection: {
                LONG: parseInt(process.env.HOURLY_ORDER_CAP_LONG || '0'),
                SHORT: parseInt(process.env.HOURLY_ORDER_CAP_SHORT || '0')
            }
        }
    },
    
    // 交易成本配置
    commission: parseFloat(process.env.COMMISSION || '0.001'),   // 手续费（单边）
    slippage: parseFloat(process.env.SLIPPAGE || '0.0005'),      // 滑点（比例）
    
    // 技术指标配置
    indicators: {
        // 是否只使用已收盘的K线计算指标
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
            // 趋势判断用的长期EMA周期
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
        // 信号强度阈值
        signalThreshold: parseFloat(process.env.SIGNAL_THRESHOLD || '0.50'),
        // 期望值阈值
        evThreshold: parseFloat(process.env.EV_THRESHOLD || process.env.EXPECTED_VALUE_THRESHOLD || '0.35'),
        // 最小胜率要求
        minWinRate: parseFloat(process.env.MIN_WIN_RATE || '55'),
        // 是否启用机器学习分析
        useMLAnalysis: (process.env.USE_ML_ANALYSIS || 'true') === 'true',
        // 多因子权重配置
        multiFactorWeights: {
            technical: parseFloat(process.env.WEIGHT_TECHNICAL || '0.5'),
            ml: parseFloat(process.env.WEIGHT_ML || '0.3'),
            market: parseFloat(process.env.WEIGHT_MARKET || '0.2')
        },
        // 主要时间周期
        primaryInterval: process.env.PRIMARY_INTERVAL || '1H',
        klineLimit: parseInt(process.env.KLINE_LIMIT || '200'),
        // 入场过滤器
        entryFilters: {
            trendFilter: (process.env.TREND_FILTER || 'true') === 'true',
            minCombinedStrengthLong: parseFloat(process.env.MIN_COMBINED_LONG || '55'),
            minCombinedStrengthShort: parseFloat(process.env.MIN_COMBINED_SHORT || '55'),
            allowHighVolatilityEntries: (process.env.ALLOW_HIGH_VOL || 'false') === 'true'
        },
        // 是否允许持仓时开反向仓位
        allowOppositeWhileOpen: (process.env.ALLOW_OPPOSITE_WHILE_OPEN || 'false') === 'true',
        // 反向开仓最小置信度
        oppositeMinConfidence: parseFloat(process.env.OPPOSITE_MIN_CONFIDENCE || '0.70'),
        // 是否允许在高风险时自动交易
        allowAutoOnHighRisk: (process.env.ALLOW_AUTO_ON_HIGH_RISK || 'false') === 'true',
        // 自动推荐间隔（毫秒）
        autoRecommendationIntervalMs: parseInt(process.env.AUTO_RECO_INTERVAL_MS || '15000'),
        // 信号冷却时间（毫秒）
        signalCooldownMs: parseInt(process.env.SIGNAL_COOLDOWN_MS || '1800000'),
        // 反向信号冷却时间（毫秒）
        oppositeCooldownMs: parseInt(process.env.OPPOSITE_COOLDOWN_MS || '300000'),
        // 振荡器配置
        oscillators: {
            useKDJ: (process.env.USE_KDJ || 'false') === 'true',
            useWilliams: (process.env.USE_WILLIAMS || 'false') === 'true'
        },
        // 门控条件配置
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
        // Kelly公式配置
        kelly: {
            enabled: (process.env.KELLY_ENABLED || 'false') === 'true',
            maxFraction: parseFloat(process.env.KELLY_MAX_FRACTION || '0.2'),
            minFraction: parseFloat(process.env.KELLY_MIN_FRACTION || '0.02')
        },
        // ATR止损配置
        atrStops: {
            enabled: (process.env.ATR_STOPS_ENABLED || 'false') === 'true',
            // ATR计算源：'hl' (high-low), 'tr' (true range), 'close' (close-based)
            source: process.env.ATR_SOURCE || 'hl',
            // ATR周期
            atrPeriod: parseInt(process.env.ATR_PERIOD || process.env.KC_ATR_PERIOD || '14'),
            // 止损倍数
            slMultiplier: parseFloat(process.env.ATR_SL_MULTIPLIER || '1.5'),
            tpMultiplier: parseFloat(process.env.ATR_TP_MULTIPLIER || '2.2'),
            // ATR百分比限制
            minAtrPct: parseFloat(process.env.ATR_MIN_PCT || process.env.GATE_ATR_PCT_MIN || '0.005'),
            capAtrPct: parseFloat(process.env.ATR_CAP_PCT || '0.2')
        },
        // Kronos AI 配置
        kronos: {
            enabled: process.env.KRONOS_ENABLED === 'true',
            baseUrl: process.env.KRONOS_BASE_URL || 'http://localhost:8001',
            timeoutMs: Number(process.env.KRONOS_TIMEOUT_MS || 1200),
            interval: process.env.KRONOS_INTERVAL || '1H',
            lookback: Number(process.env.KRONOS_LOOKBACK || 480),
            longThreshold: Number(process.env.KRONOS_LONG_THRESHOLD || 0.62),
            shortThreshold: Number(process.env.KRONOS_SHORT_THRESHOLD || 0.62),
            minConfidence: Number(process.env.KRONOS_MIN_CONFIDENCE || 0.55),
            // Alpha 参数最大值
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
            minTrainingData: parseInt(process.env.ML_MIN_TRAINING || '50'), // 最少训练数据量
            features: [
                'price_change',
                'volume_change',
                'rsi',
                'macd_signal',
                'bollinger_position',
                'ema_trend',
                'adx_strength',
                'volume_profile'
            ],
            // 模型性能阈值
            minAccuracy: parseFloat(process.env.ML_MIN_ACCURACY || '0.55'),
            maxTrainingTime: parseInt(process.env.ML_MAX_TRAINING_TIME || '30000'), // 30秒
            // 预测配置
            predictionHorizon: parseInt(process.env.ML_PREDICTION_HORIZON || '5'), // 预测未来5个周期
            confidenceThreshold: parseFloat(process.env.ML_CONFIDENCE_THRESHOLD || '0.6'),
            // 集成学习配置
            ensemble: {
                enabled: (process.env.ML_ENSEMBLE_ENABLED || 'true') === 'true',
                models: [
                    { type: 'linear', weight: 0.3 },
                    { type: 'polynomial', weight: 0.25 },
                    { type: 'svm', weight: 0.25 },
                    { type: 'neural', weight: 0.2 }
                ]
            },
            // 模型参数配置
            parameters: {
                regularization: parseFloat(process.env.ML_REGULARIZATION || '0.01'),
                learningRate: parseFloat(process.env.ML_LEARNING_RATE || '0.001'),
                epochs: parseInt(process.env.ML_EPOCHS || '100')
            },
            // 训练配置
            useRealHistoricalTraining: (process.env.ML_USE_REAL_HISTORICAL_TRAINING || 'true') === 'true',
            trainingSymbol: process.env.ML_TRAINING_SYMBOL || '',
            trainingInterval: process.env.ML_TRAINING_INTERVAL || '1m',
            trainingLimit: parseInt(process.env.ML_TRAINING_LIMIT || '500')
        },
        // 特征配置
        features: {
            marketMicrostructure: (process.env.ML_FEATURES_MICROSTRUCTURE || 'true') === 'true',
            sentiment: {
                fgi: (process.env.ML_FEATURES_FGI || 'true') === 'true'
            },
            advanced: {
                waveletTransform: (process.env.ML_FEATURES_WAVELET || 'false') === 'true',
                fourierAnalysis: (process.env.ML_FEATURES_FOURIER || 'false') === 'true',
                fractalDimension: (process.env.ML_FEATURES_FRACTAL || 'false') === 'true'
            }
        },
        // 训练配置
        training: {
            windowDays: parseInt(process.env.ML_TRAINING_WINDOW_DAYS || '14'),
            labelHorizonMinutes: parseInt(process.env.ML_LABEL_HORIZON_MINUTES || '60')
        },
        // 标签配置
        labeling: {
            enabled: (process.env.ML_LABELING_ENABLED || 'true') === 'true',
            pollIntervalMs: parseInt(process.env.ML_LABELING_POLL_INTERVAL_MS || '60000'),
            horizonMinutesDefault: parseInt(process.env.ML_LABELING_HORIZON_MINUTES_DEFAULT || '60')
        }
    },
    
    // VPN环境配置
    vpn: vpnConfig,
    
    // 测试配置
    testing: {
        allowPriceOverride: (process.env.TESTING_ALLOW_PRICE_OVERRIDE || 'true') === 'true',
        allowFGIOverride: (process.env.TESTING_ALLOW_FGI_OVERRIDE || 'true') === 'true',
        allowFundingOverride: (process.env.TESTING_ALLOW_FUNDING_OVERRIDE || 'true') === 'true',
        fgiOverrideDefaultTtlMs: parseInt(process.env.TESTING_FGI_OVERRIDE_TTL_MS || '10000'),
        fundingOverrideDefaultTtlMs: parseInt(process.env.TESTING_FUNDING_OVERRIDE_TTL_MS || '10000'),
        priceOverrideDefaultTtlMs: parseInt(process.env.TESTING_PRICE_OVERRIDE_TTL_MS || '10000')
    }
};

// 获取指定交易对的配置
export function getSymbolConfig(symbol: string) {
    const baseConfig = {
        symbol,
        leverage: config.trading.defaultLeverage,
        maxLeverage: config.trading.maxLeverage,
        commission: config.commission,
        slippage: config.slippage
    };
    
    // 根据不同交易对调整配置
    switch (symbol) {
        case 'BTC-USDT-SWAP':
            return {
                ...baseConfig,
                leverage: Math.min(config.trading.defaultLeverage, 10), // BTC最大10倍
                slippage: config.slippage * 0.8 // BTC流动性好，滑点较小
            };
        case 'ETH-USDT-SWAP':
            return {
                ...baseConfig,
                leverage: Math.min(config.trading.defaultLeverage, 15), // ETH最大15倍
                slippage: config.slippage * 0.9
            };
        case 'SOL-USDT-SWAP':
        case 'DOGE-USDT-SWAP':
            return {
                ...baseConfig,
                leverage: Math.min(config.trading.defaultLeverage, 20), // 山寨币最大20倍
                slippage: config.slippage * 1.2 // 山寨币滑点较大
            };
        default:
            return baseConfig;
    }
}

export default config;