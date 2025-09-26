// 高频交易系统配置
export const config = {
  // 交易配置
  trading: {
    symbol: 'ETH-USDT-SWAP',
    leverage: 1,
    timeframe: '1m',
    // maxDailyTrades: 40, // 移除日交易限制
    maxPositionSize: 0.20
  },
  
  // 技术指标配置
  indicators: {
    rsi: {
      period: 14,
      overbought: 75,
      oversold: 25
    },
    macd: {
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9
    },
    bollinger: {
      period: 20,
      stdDev: 2
    },
    kdj: {
      period: 9,
      signalPeriod: 3
    },
    williams: {
      period: 14
    },
    ema: {
      short: 5,
      long: 10,
      shortPeriod: 12,
      longPeriod: 26,
      trendPeriod: 100
    },
    adx: {
      period: 14
    },
    obv: {
      slopeWindow: 14
    },
    mfi: {
      period: 14
    },
    keltner: {
      period: 20,
      atrPeriod: 20,
      multiplier: 2
    },
    squeeze: {
      bbBandwidth: 0.07,
      kcBandwidth: 0.05
    }
  },
  
  // 风控配置
  risk: {
    stopLoss: 0.0008,
    takeProfit: 0.0015,
    maxDrawdown: 0.02,
    minConfidence: 0.70
  },
  
  // Maker策略配置
  maker: {
    orderTimeout: 60000,
    priceOffset: 0.0001,
    maxSlippage: 0.0005
  },
  
  // 手续费配置（默认：Maker 0.02%，Taker 0.05%）
  fees: {
    maker: 0.0002,
    taker: 0.0005
  },
  
  // API配置
  api: {
    rateLimitDelay: 200,
    timeout: 10000,
    retryAttempts: 3
  }
};