import sqlite3 from 'sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { RecommendationRecord } from './recommendation-tracker.js';

// 新增：ML 样本记录类型
export interface MLSampleRecord {
  id?: number;
  created_at?: Date;
  updated_at?: Date;
  timestamp: number; // 原始样本时间（ms）
  symbol: string;
  interval?: string;
  price?: number;
  features_json?: string; // 原始/派生特征（可包含原始向量或特征摘要）
  indicators_json?: string; // 技术指标快照
  ml_prediction?: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  ml_confidence?: number;
  ml_calibrated_confidence?: number;
  ml_scores_json?: string; // 各子分数（technical/sentiment/volume/momentum）
  technical_strength?: number;
  combined_strength?: number;
  final_signal?: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  position_size?: number;
  target_price?: number;
  stop_loss?: number;
  take_profit?: number;
  risk_reward?: number;
  reasoning_ml?: string;
  reasoning_final?: string;
  label_horizon_min?: number; // 期望回填标签的时间窗口（分钟）
  label_return?: number | null; // T+Horizon 的收益（%）
  label_drawdown?: number | null; // T+Horizon 的最大回撤（%）
  label_ready?: boolean; // 标签是否已回填
}

// 新增：执行记录类型（开仓/平仓/减仓的实际成交明细）
export interface ExecutionRecord {
  id?: number;
  created_at?: Date;
  updated_at?: Date;
  recommendation_id?: string | null;
  position_id?: string | null;
  event_type: 'OPEN' | 'CLOSE' | 'REDUCE' | string;
  symbol?: string | null;
  direction?: 'LONG' | 'SHORT' | null;
  size?: number | null;
  intended_price?: number | null;
  intended_timestamp?: number | null; // ms
  fill_price?: number | null;
  fill_timestamp?: number | null; // ms
  latency_ms?: number | null;
  slippage_bps?: number | null; // 1bp = 0.01%
  slippage_amount?: number | null; // fill - intended（正：买入吃亏，负：卖出吃亏）
  fee_bps?: number | null;
  fee_amount?: number | null; // 名义价值 * 手续费率（单边）
  pnl_amount?: number | null; // 平仓/减仓时才有
  pnl_percent?: number | null; // 平仓/减仓时才有
  // 来自 recommendations 的 AB 分组（查询结果派生字段)
  ab_group?: string | null;
  
  // 新增：A/B测试变体标识
  variant?: string | null;
  // 新增：实验ID（来源 recommendations.experiment_id）
  experiment_id?: string | null;
  
  extra_json?: string | null; // 额外上下文（如 reason/reductionRatio 等）
}

// 新增：滑点分析记录类型
export interface SlippageAnalysisRecord {
  id?: number;
  created_at?: Date;
  updated_at?: Date;
  recommendation_id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  
  // 价格差异追踪
  expected_price: number; // 预计成交价
  actual_price: number; // 实际成交价
  price_difference: number; // 实际 - 预计
  price_difference_bps: number; // 价格差异（基点）
  
  // 交易执行指标
  execution_latency_ms: number; // 执行延迟（毫秒）
  order_book_depth?: number; // 订单簿深度
  market_volatility?: number; // 市场波动率
  
  // 滑点详细分析
  slippage_bps: number; // 滑点（基点）
  slippage_category: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'; // 滑点等级
  slippage_reason?: string; // 滑点原因分析
  
  // 交易费用
  fee_rate_bps: number; // 费率（基点）
  fee_amount: number; // 费用金额
  total_cost_bps: number; // 总成本（基点，含滑点+费用）
  
  // 阈值调整相关
  original_threshold: number; // 原始阈值
  adjusted_threshold?: number; // 调整后阈值
  threshold_adjustment_reason?: string; // 阈值调整原因
  
  // 市场环境
  market_session?: string; // 交易时段
  liquidity_score?: number; // 流动性评分
  spread_bps?: number; // 买卖价差
  
  // 额外信息
  extra_json?: string | null;
}

// 新增：滑点统计聚合类型
export interface SlippageStatistics {
  symbol: string;
  direction?: 'LONG' | 'SHORT';
  period: string; // '1h', '4h', '1d', '7d', '30d'
  
  // 基础统计
  total_executions: number;
  avg_slippage_bps: number;
  median_slippage_bps: number;
  max_slippage_bps: number;
  min_slippage_bps: number;
  
  // 滑点分布
  low_slippage_count: number; // < 5bps
  medium_slippage_count: number; // 5-15bps
  high_slippage_count: number; // 15-30bps
  extreme_slippage_count: number; // > 30bps
  
  // 成本分析
  avg_total_cost_bps: number; // 总成本（滑点+费用）
  avg_fee_bps: number;
  
  // 执行质量
  avg_latency_ms: number;
  avg_price_difference_bps: number;
  
  // 阈值建议
  suggested_threshold_adjustment: number; // 建议阈值调整（基点）
  confidence_score: number; // 置信度（0-1）
  
  // 统计时间
  calculated_at: Date;
}

// 新增：监控快照记录类型
export interface MonitoringSnapshot {
  id?: number;
  created_at?: Date;
  recommendation_id: string;
  check_time?: string | Date;
  current_price: number;
  unrealized_pnl?: number | null;
  unrealized_pnl_percent?: number | null;
  is_stop_loss_triggered?: boolean;
  is_take_profit_triggered?: boolean;
  extra_json?: string | null;
}

/**
 * 推荐数据库服务
 * 负责推荐记录的持久化存储和查询
 */
export class RecommendationDatabase {
  private db: any | null = null;
  private dbPath: string;
  private isInitialized = false;
  
  constructor(dbPath?: string) {
    // 默认数据库路径
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'recommendations.db');
    
    // 确保数据目录存在
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }
  
  /**
   * 初始化数据库连接和表结构
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    
    try {
      console.log(`Initializing recommendation database: ${this.dbPath}`);
      
      await new Promise<void>((resolve, reject) => {
        this.db = new (sqlite3.verbose() as any).Database(this.dbPath, (err: Error | null) => {
          if (err) {
            console.error('Error opening database:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
      
      // 增加 busyTimeout 与 WAL，以提升并发读能力，避免读训练时被写阻塞
      try {
        // 某些类型定义无该方法，使用 any 断言
        (this.db as any)?.configure?.('busyTimeout', 10000);
      } catch (e) {
        console.warn('Warn: set busyTimeout failed (ignored):', e);
      }
      await new Promise<void>((resolve, reject) => {
        this.db!.run('PRAGMA journal_mode=WAL;', [], (err: Error | null) => err ? reject(err) : resolve());
      });
      await new Promise<void>((resolve, reject) => {
        this.db!.run('PRAGMA synchronous=NORMAL;', [], (err: Error | null) => err ? reject(err) : resolve());
      });
      
      // 创建表结构
      await this.createTables();
      // 迁移：确保新增列存在
      await this.migrateSchema();
      
      this.isInitialized = true;
      console.log('Recommendation database initialized successfully');
      
    } catch (error) {
      console.error('Failed to initialize recommendation database:', error);
      throw error;
    }
  }
  
  /**
   * 创建数据库表结构
   */
  private async createTables(): Promise<void> {
    const createRecommendationsTable = `
      CREATE TABLE IF NOT EXISTS recommendations (
        id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        -- 基础推荐信息
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
        entry_price REAL NOT NULL,
        current_price REAL NOT NULL,
        
        -- 止损止盈设置
        stop_loss_price REAL,
        take_profit_price REAL,
        stop_loss_percent REAL,
        take_profit_percent REAL,
        liquidation_price REAL,
        margin_ratio REAL,
        maintenance_margin REAL,
        
        -- ATR动态止损相关
        atr_value REAL,
        atr_period INTEGER,
        atr_sl_multiplier REAL,
        atr_tp_multiplier REAL,
        
        -- 分批止盈状态
        tp1_hit INTEGER DEFAULT 0,
        tp2_hit INTEGER DEFAULT 0,
        tp3_hit INTEGER DEFAULT 0,
        reduction_count INTEGER DEFAULT 0,
        reduction_ratio REAL,
        
        -- 杠杆和仓位
        leverage INTEGER NOT NULL,
        position_size REAL,
        risk_level TEXT,
        
        -- 策略信息
        strategy_type TEXT NOT NULL,
        algorithm_name TEXT,
        signal_strength REAL,
        confidence_score REAL,
        quality_score REAL,
        
        -- 推荐结果状态
        status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'CLOSED', 'EXPIRED')),
        result TEXT CHECK (result IN ('WIN', 'LOSS', 'BREAKEVEN')),
        exit_price REAL,
        exit_time DATETIME,
        exit_reason TEXT CHECK (exit_reason IN ('TAKE_PROFIT', 'STOP_LOSS', 'TIMEOUT', 'LIQUIDATION', 'MANUAL', 'BREAKEVEN')),
        -- 新增：标准化出场标签（英文枚举）
        exit_label TEXT CHECK (exit_label IN ('DYNAMIC_TAKE_PROFIT','DYNAMIC_STOP_LOSS','TIMEOUT','BREAKEVEN')),
        
        -- 理论收益统计
        pnl_amount REAL,
        pnl_percent REAL,
        holding_duration INTEGER,
        
        -- 市场环境数据
        market_volatility REAL,
        volume_24h REAL,
        price_change_24h REAL,
        
        -- 元数据
        source TEXT DEFAULT 'STRATEGY_AUTO',
        is_strategy_generated BOOLEAN DEFAULT TRUE,
        strategy_confidence_level TEXT,
        exclude_from_ml BOOLEAN DEFAULT FALSE,
        notes TEXT,

        -- 额外上下文（JSON 字符串）
        extra_json TEXT,

        -- EV相关字段
        expected_return REAL,
        ev REAL,
        ev_threshold REAL,
        ev_ok INTEGER,
        ab_group TEXT,

        -- 新增：A/B测试变体标识
        variant TEXT DEFAULT 'control',

        -- 新增：实验ID
        experiment_id TEXT,

        -- 新增：并发幂等去重键（唯一索引）
        dedupe_key TEXT
      )
    `;
    
    const createStatisticsTable = `
      CREATE TABLE IF NOT EXISTS strategy_statistics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_type TEXT NOT NULL,
        date DATE DEFAULT CURRENT_DATE,
        
        -- 基础统计
        total_recommendations INTEGER DEFAULT 0,
        win_count INTEGER DEFAULT 0,
        loss_count INTEGER DEFAULT 0,
        breakeven_count INTEGER DEFAULT 0,
        
        -- 收益统计
        total_pnl_amount REAL DEFAULT 0,
        avg_pnl_percent REAL DEFAULT 0,
        max_win_percent REAL DEFAULT 0,
        max_loss_percent REAL DEFAULT 0,
        
        -- 时间统计
        avg_holding_duration INTEGER DEFAULT 0,
        
        -- 计算字段
        win_rate REAL GENERATED ALWAYS AS (
          CASE WHEN total_recommendations > 0 
               THEN CAST(win_count AS REAL) / total_recommendations * 100 
               ELSE 0 END
        ) STORED,
        
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        UNIQUE(strategy_type, date)
      )
    `;

    // 新增：ML 样本表
    const createMLSamplesTable = `
      CREATE TABLE IF NOT EXISTS ml_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        -- 样本基本信息
        timestamp INTEGER NOT NULL, -- 原始样本时间（ms）
        symbol TEXT NOT NULL,
        interval TEXT,
        price REAL,
        
        -- 特征与指标快照
        features_json TEXT,
        indicators_json TEXT,
        
        -- 模型输出与综合信号
        ml_prediction TEXT CHECK (ml_prediction IN ('STRONG_BUY','BUY','HOLD','SELL','STRONG_SELL')),
        ml_confidence REAL,
        ml_calibrated_confidence REAL,
        ml_scores_json TEXT,
        technical_strength REAL,
        combined_strength REAL,
        final_signal TEXT CHECK (final_signal IN ('STRONG_BUY','BUY','HOLD','SELL','STRONG_SELL')),
        position_size REAL,
        target_price REAL,
        stop_loss REAL,
        take_profit REAL,
        risk_reward REAL,
        reasoning_ml TEXT,
        reasoning_final TEXT,
        
        -- 标签（T+Horizon）
        label_horizon_min INTEGER,
        label_return REAL,
        label_drawdown REAL,
        label_ready BOOLEAN DEFAULT FALSE
      )
    `;

    // 新增：executions 表（记录实际执行/成交）
    const createExecutionsTable = `
      CREATE TABLE IF NOT EXISTS executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        recommendation_id TEXT,
        position_id TEXT,
        event_type TEXT NOT NULL CHECK (event_type IN ('OPEN','CLOSE','REDUCE')),
        symbol TEXT,
        direction TEXT CHECK (direction IN ('LONG','SHORT')),
        size REAL,
        
        intended_price REAL,
        intended_timestamp INTEGER,
        fill_price REAL,
        fill_timestamp INTEGER,
        latency_ms INTEGER,
        
        slippage_bps REAL,
        slippage_amount REAL,
        fee_bps REAL,
        fee_amount REAL,
        
        pnl_amount REAL,
        pnl_percent REAL,
        
        -- 新增：A/B测试变体标识
        variant TEXT DEFAULT 'control',

        -- 实验分组信息
        ab_group TEXT,

        -- 实验ID
        experiment_id TEXT,
        
        extra_json TEXT
      )
    `;

    // 新增：recommendation_monitoring 表（实时监控快照）
    const createMonitoringTable = `
      CREATE TABLE IF NOT EXISTS recommendation_monitoring (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        recommendation_id TEXT NOT NULL,
        check_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        current_price REAL NOT NULL,
        unrealized_pnl REAL,
        unrealized_pnl_percent REAL,
        is_stop_loss_triggered INTEGER DEFAULT 0,
        is_take_profit_triggered INTEGER DEFAULT 0,
        extra_json TEXT
      )
    `;

    // 新增：滑点分析表（记录详细滑点分析数据）
    const createSlippageAnalysisTable = `
      CREATE TABLE IF NOT EXISTS slippage_analysis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        recommendation_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('LONG','SHORT')),
        
        -- 价格差异追踪
        expected_price REAL NOT NULL,
        actual_price REAL NOT NULL,
        price_difference REAL NOT NULL,
        price_difference_bps REAL NOT NULL,
        
        -- 交易执行指标
        execution_latency_ms INTEGER NOT NULL,
        order_book_depth REAL,
        market_volatility REAL,
        
        -- 滑点详细分析
        slippage_bps REAL NOT NULL,
        slippage_category TEXT NOT NULL CHECK (slippage_category IN ('LOW','MEDIUM','HIGH','EXTREME')),
        slippage_reason TEXT,
        
        -- 交易费用
        fee_rate_bps REAL NOT NULL,
        fee_amount REAL NOT NULL,
        total_cost_bps REAL NOT NULL,
        
        -- 阈值调整相关
        original_threshold REAL NOT NULL,
        adjusted_threshold REAL,
        threshold_adjustment_reason TEXT,
        
        -- 市场环境
        market_session TEXT,
        liquidity_score REAL,
        spread_bps REAL,
        
        -- 额外信息
        extra_json TEXT,
        
        -- 索引优化
        FOREIGN KEY (recommendation_id) REFERENCES recommendations(id)
      )
    `;

    // 新增：滑点统计聚合表（按时间段和交易对聚合）
    const createSlippageStatisticsTable = `
      CREATE TABLE IF NOT EXISTS slippage_statistics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        symbol TEXT NOT NULL,
        direction TEXT CHECK (direction IN ('LONG','SHORT')),
        period TEXT NOT NULL, -- '1h', '4h', '1d', '7d', '30d'
        
        -- 基础统计
        total_executions INTEGER NOT NULL DEFAULT 0,
        avg_slippage_bps REAL NOT NULL DEFAULT 0,
        median_slippage_bps REAL NOT NULL DEFAULT 0,
        max_slippage_bps REAL NOT NULL DEFAULT 0,
        min_slippage_bps REAL NOT NULL DEFAULT 0,
        
        -- 滑点分布
        low_slippage_count INTEGER NOT NULL DEFAULT 0, -- < 5bps
        medium_slippage_count INTEGER NOT NULL DEFAULT 0, -- 5-15bps
        high_slippage_count INTEGER NOT NULL DEFAULT 0, -- 15-30bps
        extreme_slippage_count INTEGER NOT NULL DEFAULT 0, -- > 30bps
        
        -- 成本分析
        avg_total_cost_bps REAL NOT NULL DEFAULT 0,
        avg_fee_bps REAL NOT NULL DEFAULT 0,
        
        -- 执行质量
        avg_latency_ms REAL NOT NULL DEFAULT 0,
        avg_price_difference_bps REAL NOT NULL DEFAULT 0,
        
        -- 阈值建议
        suggested_threshold_adjustment REAL NOT NULL DEFAULT 0,
        confidence_score REAL NOT NULL DEFAULT 0,
        
        -- 统计时间
        calculated_at DATETIME NOT NULL,
        
        -- 唯一约束
        UNIQUE(symbol, direction, period)
      )
    `;

    // 新增：滑点阈值管理表
    const createSlippageThresholdsTable = `
      CREATE TABLE IF NOT EXISTS slippage_thresholds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('LONG','SHORT')),
        threshold REAL NOT NULL DEFAULT 0.01, -- 阈值百分比 (如 0.01 = 1%)
        last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        
        -- 唯一约束
        UNIQUE(symbol, timeframe, direction)
      )
    `;

    // 新增：高滑点预警表（记录异常检测结果）
    const createSlippageAlertsTable = `
      CREATE TABLE IF NOT EXISTS slippage_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('LONG','SHORT')),
        severity TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
        avg_slippage_bps REAL NOT NULL,
        median_slippage_bps REAL NOT NULL,
        sample_count INTEGER NOT NULL,
        suggested_action TEXT,
        triggered_by TEXT
      )
    `;
    
    
    const createIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_recommendations_status ON recommendations(status)',
      'CREATE INDEX IF NOT EXISTS idx_recommendations_strategy ON recommendations(strategy_type)',
      'CREATE INDEX IF NOT EXISTS idx_recommendations_created ON recommendations(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_recommendations_symbol ON recommendations(symbol)',
      'CREATE INDEX IF NOT EXISTS idx_recommendations_sds_created ON recommendations(symbol, direction, strategy_type, created_at)',
      // 移除：dedupe_key 唯一索引（在 migrateSchema 中幂等创建，避免旧库无该列时报错）
      'CREATE INDEX IF NOT EXISTS idx_statistics_strategy_date ON strategy_statistics(strategy_type, date)',
      // 新增：ml_samples 索引
      'CREATE INDEX IF NOT EXISTS idx_ml_samples_symbol_time ON ml_samples(symbol, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_ml_samples_label_ready ON ml_samples(label_ready)',
      'CREATE INDEX IF NOT EXISTS idx_ml_samples_prediction ON ml_samples(ml_prediction)',
      // 新增：executions 索引
      'CREATE INDEX IF NOT EXISTS idx_executions_created ON executions(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_executions_recid ON executions(recommendation_id)',
      'CREATE INDEX IF NOT EXISTS idx_executions_posid ON executions(position_id)',
      'CREATE INDEX IF NOT EXISTS idx_executions_event_time ON executions(event_type, fill_timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_executions_symbol_time ON executions(symbol, fill_timestamp)',
      // 新增：monitoring 索引
      'CREATE INDEX IF NOT EXISTS idx_monitoring_rec_time ON recommendation_monitoring(recommendation_id, check_time)',
      // 新增：滑点分析表索引
      'CREATE INDEX IF NOT EXISTS idx_slippage_analysis_rec ON slippage_analysis(recommendation_id)',
      'CREATE INDEX IF NOT EXISTS idx_slippage_analysis_symbol_time ON slippage_analysis(symbol, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_slippage_analysis_category ON slippage_analysis(slippage_category)',
      'CREATE INDEX IF NOT EXISTS idx_slippage_analysis_slippage ON slippage_analysis(slippage_bps)',
      // 新增：滑点统计表索引
      'CREATE INDEX IF NOT EXISTS idx_slippage_stats_symbol_period ON slippage_statistics(symbol, period)',
      'CREATE INDEX IF NOT EXISTS idx_slippage_stats_updated ON slippage_statistics(updated_at)',
      // 新增：滑点阈值表索引
      'CREATE INDEX IF NOT EXISTS idx_slippage_thresholds_symbol ON slippage_thresholds(symbol)',
      'CREATE INDEX IF NOT EXISTS idx_slippage_thresholds_timeframe ON slippage_thresholds(timeframe)',
      'CREATE INDEX IF NOT EXISTS idx_slippage_thresholds_updated ON slippage_thresholds(last_updated)',
      // 新增：滑点预警表索引
      'CREATE INDEX IF NOT EXISTS idx_slippage_alerts_symbol_time ON slippage_alerts(symbol, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_slippage_alerts_severity ON slippage_alerts(severity)',
      'CREATE INDEX IF NOT EXISTS idx_slippage_alerts_triggered_by ON slippage_alerts(triggered_by)',
      // 新增：决策链表索引
      'CREATE INDEX IF NOT EXISTS idx_decision_chains_symbol ON decision_chains(symbol)',
      'CREATE INDEX IF NOT EXISTS idx_decision_chains_status ON decision_chains(status)',
      'CREATE INDEX IF NOT EXISTS idx_decision_chains_time ON decision_chains(start_time)',
      'CREATE INDEX IF NOT EXISTS idx_decision_chains_rejection ON decision_chains(rejection_stage, rejection_reason)'
    ];
    
    return new Promise((resolve, reject) => {
      this.db!.serialize(() => {
        // 创建主表
        this.db!.run(createRecommendationsTable, (err: Error | null) => {
          if (err) {
            console.error('Error creating recommendations table:', err);
            reject(err);
            return;
          }
        });
        
        // 创建统计表
        this.db!.run(createStatisticsTable, (err: Error | null) => {
          if (err) {
            console.error('Error creating statistics table:', err);
            reject(err);
            return;
          }
        });

        // 创建 ML 样本表
        this.db!.run(createMLSamplesTable, (err: Error | null) => {
          if (err) {
            console.error('Error creating ml_samples table:', err);
            reject(err);
            return;
          }
        });

        // 创建 executions 表
        this.db!.run(createExecutionsTable, (err: Error | null) => {
          if (err) {
            console.error('Error creating executions table:', err);
            reject(err);
            return;
          }
        });

        // 创建 monitoring 表
        this.db!.run(createMonitoringTable, (err: Error | null) => {
          if (err) {
            console.error('Error creating recommendation_monitoring table:', err);
            reject(err);
            return;
          }
        });

        // 创建滑点分析表
        this.db!.run(createSlippageAnalysisTable, (err: Error | null) => {
          if (err) {
            console.error('Error creating slippage_analysis table:', err);
            reject(err);
            return;
          }
        });

        // 创建滑点统计聚合表
        this.db!.run(createSlippageStatisticsTable, (err: Error | null) => {
          if (err) {
            console.error('Error creating slippage_statistics table:', err);
            reject(err);
            return;
          }
        });

        // 创建滑点阈值管理表
        this.db!.run(createSlippageThresholdsTable, (err: Error | null) => {
          if (err) {
            console.error('Error creating slippage_thresholds table:', err);
            reject(err);
            return;
          }
        });

        // 创建滑点预警表
        this.db!.run(createSlippageAlertsTable, (err: Error | null) => {
          if (err) {
            console.error('Error creating slippage_alerts table:', err);
            reject(err);
            return;
          }
        });

        // 创建决策链表
        this.db!.run(`
          CREATE TABLE IF NOT EXISTS decision_chains (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chain_id TEXT UNIQUE NOT NULL,
            symbol TEXT NOT NULL,
            direction TEXT NOT NULL,
            status TEXT NOT NULL,
            start_time INTEGER NOT NULL,
            end_time INTEGER,
            final_decision TEXT,
            rejection_reason TEXT,
            rejection_stage TEXT,
            steps_json TEXT NOT NULL,
            metrics_json TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
          )
        `, (err: Error | null) => {
          if (err) {
            console.error('Error creating decision_chains table:', err);
            reject(err);
            return;
          }
        });
        
        // 创建索引
        let indexCount = 0;
        createIndexes.forEach(indexSql => {
          this.db!.run(indexSql, (err: Error | null) => {
            if (err) {
              console.error('Error creating index:', err);
              reject(err);
              return;
            }
            indexCount++;
            if (indexCount === createIndexes.length) {
              resolve();
            }
          });
        });
      });
    });
  }
  
  /**
   * 保存推荐记录
   */
  async saveRecommendation(rec: RecommendationRecord): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    const sql = `
      INSERT INTO recommendations (
        id, created_at, updated_at, symbol, direction, entry_price, current_price,
        stop_loss_price, take_profit_price, stop_loss_percent, take_profit_percent,
        liquidation_price, margin_ratio, maintenance_margin, leverage, position_size,
        risk_level, strategy_type, algorithm_name, signal_strength, confidence_score,
        quality_score, status, market_volatility, volume_24h, price_change_24h,
        source, is_strategy_generated, strategy_confidence_level, exclude_from_ml, notes,
        expected_return, ev, ev_threshold, ev_ok, ab_group, variant, experiment_id,
        exit_label, dedupe_key, extra_json,
        atr_value, atr_period, atr_sl_multiplier, atr_tp_multiplier,
        tp1_hit, tp2_hit, tp3_hit, reduction_count, reduction_ratio
      ) VALUES (
        ${new Array(50).fill('?').join(', ')}
      )
    `;
    
    const params = [
      rec.id, rec.created_at.toISOString(), rec.updated_at.toISOString(),
      rec.symbol, rec.direction, rec.entry_price, rec.current_price,
      rec.stop_loss_price, rec.take_profit_price, rec.stop_loss_percent, rec.take_profit_percent,
      rec.liquidation_price, rec.margin_ratio, rec.maintenance_margin,
      rec.leverage, rec.position_size, rec.risk_level,
      rec.strategy_type, rec.algorithm_name, rec.signal_strength, rec.confidence_score,
      rec.quality_score, rec.status, rec.market_volatility, rec.volume_24h, rec.price_change_24h,
      rec.source, rec.is_strategy_generated, rec.strategy_confidence_level, rec.exclude_from_ml, rec.notes,
      (rec as any).expected_return ?? (rec as any).ev ?? null,
      (rec as any).ev ?? (rec as any).expected_return ?? null,
      (rec as any).ev_threshold ?? null,
      typeof (rec as any).ev_ok === 'boolean' ? ((rec as any).ev_ok ? 1 : 0) : (typeof (rec as any).ev_ok === 'number' ? ((rec as any).ev_ok ? 1 : 0) : null),
      (rec as any).ab_group ?? null,
      (rec as any).variant ?? 'control',
      (rec as any).experiment_id ?? null,
      rec.exit_label || null,
      rec.dedupe_key || null,
      (rec as any).extra_json ?? null,
      rec.atr_value ?? null,
      rec.atr_period ?? null,
      rec.atr_sl_multiplier ?? null,
      rec.atr_tp_multiplier ?? null,
      rec.tp1_hit ? 1 : 0,
      rec.tp2_hit ? 1 : 0,
      rec.tp3_hit ? 1 : 0,
      rec.reduction_count ?? 0,
      rec.reduction_ratio ?? null
    ];
    
    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function(err: Error | null) {
        if (err) {
          // 统一将唯一约束映射成可识别的错误码
          if (/UNIQUE constraint failed: recommendations\.dedupe_key/i.test(err.message || '')) {
            (err as any).code = 'DUPLICATE_DEDUPE_KEY';
          }
          console.error('Error saving recommendation:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
  
  /**
   * 更新推荐记录
   */
  async updateRecommendation(rec: RecommendationRecord): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    const sql = `
      UPDATE recommendations SET
        updated_at = ?,
        current_price = ?,
        status = ?,
        result = ?,
        exit_price = ?,
        exit_time = ?,
        exit_reason = ?,
        exit_label = ?,
        pnl_amount = ?,
        pnl_percent = ?,
        holding_duration = ?,
        extra_json = COALESCE(?, extra_json),
        atr_value = COALESCE(?, atr_value),
        atr_period = COALESCE(?, atr_period),
        atr_sl_multiplier = COALESCE(?, atr_sl_multiplier),
        atr_tp_multiplier = COALESCE(?, atr_tp_multiplier),
        tp1_hit = COALESCE(?, tp1_hit),
        tp2_hit = COALESCE(?, tp2_hit),
        tp3_hit = COALESCE(?, tp3_hit),
        reduction_count = COALESCE(?, reduction_count),
        reduction_ratio = COALESCE(?, reduction_ratio),
        variant = COALESCE(?, variant),
        experiment_id = COALESCE(?, experiment_id)
      WHERE id = ?
    `;
    
    const params = [
      rec.updated_at.toISOString(),
      rec.current_price,
      rec.status,
      rec.result,
      rec.exit_price,
      rec.exit_time?.toISOString(),
      rec.exit_reason,
      rec.exit_label || null,
      rec.pnl_amount,
      rec.pnl_percent,
      rec.holding_duration,
      (rec as any).extra_json ?? null,
      rec.atr_value ?? null,
      rec.atr_period ?? null,
      rec.atr_sl_multiplier ?? null,
      rec.atr_tp_multiplier ?? null,
      rec.tp1_hit ? 1 : 0,
      rec.tp2_hit ? 1 : 0,
      rec.tp3_hit ? 1 : 0,
      rec.reduction_count ?? null,
      rec.reduction_ratio ?? null,
      (rec as any).variant ?? null,
      (rec as any).experiment_id ?? null,
      rec.id
    ];
    
    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function(err: Error | null) {
        if (err) {
          console.error('Error updating recommendation:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
  
  /**
   * 按ID获取单条推荐
   */
  async getRecommendationById(id: string): Promise<RecommendationRecord | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const sql = `SELECT * FROM recommendations WHERE id = ? LIMIT 1`;
    return new Promise((resolve, reject) => {
      this.db!.get(sql, [id], (err: Error | null, row: any) => {
        if (err) {
          console.error('Error querying recommendation by id:', err);
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          resolve(this.rowToRecommendation(row));
        }
      });
    });
  }
  
  /**
   * 查询活跃推荐
   */
  async getActiveRecommendations(): Promise<RecommendationRecord[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const sql = `SELECT * FROM recommendations WHERE status = 'ACTIVE' ORDER BY created_at DESC`;
    return new Promise((resolve, reject) => {
      this.db!.all(sql, [], (err: Error | null, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const recs = rows.map(row => this.rowToRecommendation(row));
          resolve(recs);
        }
      });
    });
  }
  
  // 新增：按 symbol 获取最新一条推荐，用于冷却期校验
  async getLastRecommendationBySymbol(symbol: string): Promise<RecommendationRecord | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    // 兼容别名：在迁移期将 ETH-USDT 与 ETH-USDT-SWAP 视为同一组
    const aliases = (s: string): string[] => {
      const up = String(s || '').toUpperCase().trim();
      if (up === 'ETH-USDT') return ['ETH-USDT', 'ETH-USDT-SWAP'];
      if (up === 'ETH-USDT-SWAP') return ['ETH-USDT', 'ETH-USDT-SWAP'];
      return [s];
    };
    const symList = aliases(symbol);
    const placeholders = symList.map(() => '?').join(',');
    const sql = `SELECT * FROM recommendations WHERE symbol IN (${placeholders}) ORDER BY datetime(created_at) DESC LIMIT 1`;
    return new Promise<RecommendationRecord | null>((resolve, reject) => {
      this.db!.get(sql, symList, (err: Error | null, row: any) => {
        if (err) return reject(err);
        resolve(row ? this.rowToRecommendation(row) : null);
      });
    });
  }

  // 新增：按 symbol+direction 获取最新一条推荐（用于方向级冷却与反向节流）
  async getLastRecommendationBySymbolAndDirection(symbol: string, direction: 'LONG' | 'SHORT'): Promise<RecommendationRecord | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const aliases = (s: string): string[] => {
      const up = String(s || '').toUpperCase().trim();
      if (up === 'ETH-USDT') return ['ETH-USDT', 'ETH-USDT-SWAP'];
      if (up === 'ETH-USDT-SWAP') return ['ETH-USDT', 'ETH-USDT-SWAP'];
      return [s];
    };
    const symList = aliases(symbol);
    const placeholders = symList.map(() => '?').join(',');
    const sql = `SELECT * FROM recommendations WHERE symbol IN (${placeholders}) AND direction = ? ORDER BY datetime(created_at) DESC LIMIT 1`;
    const params = [...symList, direction];
    return new Promise<RecommendationRecord | null>((resolve, reject) => {
      this.db!.get(sql, params, (err: Error | null, row: any) => {
        if (err) return reject(err);
        resolve(row ? this.rowToRecommendation(row) : null);
      });
    });
  }

  // 新增：按 symbol+direction 获取最新一条“ACTIVE”推荐（仅限状态为 ACTIVE）
  async getLastActiveRecommendationBySymbolAndDirection(symbol: string, direction: 'LONG' | 'SHORT'): Promise<RecommendationRecord | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const aliases = (s: string): string[] => {
      const up = String(s || '').toUpperCase().trim();
      if (up === 'ETH-USDT') return ['ETH-USDT', 'ETH-USDT-SWAP'];
      if (up === 'ETH-USDT-SWAP') return ['ETH-USDT', 'ETH-USDT-SWAP'];
      return [s];
    };
    const symList = aliases(symbol);
    const placeholders = symList.map(() => '?').join(',');
    const sql = `SELECT * FROM recommendations WHERE symbol IN (${placeholders}) AND direction = ? AND status = 'ACTIVE' ORDER BY datetime(created_at) DESC LIMIT 1`;
    const params = [...symList, direction];
    return new Promise<RecommendationRecord | null>((resolve, reject) => {
      this.db!.get(sql, params, (err: Error | null, row: any) => {
        if (err) return reject(err);
        resolve(row ? this.rowToRecommendation(row) : null);
      });
    });
  }

  /**
   * 删除推荐记录（按ID）
   */
  async deleteRecommendation(id: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const sql = `DELETE FROM recommendations WHERE id = ?`;
      this.db!.run(sql, [id], function (this: any, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  // 新增：修剪历史记录，仅保留按创建时间倒序的最近 keep 条，并执行 VACUUM 回收空间
  async trimRecommendations(keep: number): Promise<{ deleted: number; kept: number; total: number }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const safeKeep = Math.max(0, Math.floor(keep));

    // 统计总数
    const total = await new Promise<number>((resolve, reject) => {
      this.db!.get('SELECT COUNT(*) as total FROM recommendations', [], (err: Error | null, row: any) => {
        if (err) return reject(err);
        resolve(row?.total ?? 0);
      });
    });

    let deleted = 0;
    if (total > safeKeep) {
      // 删除不在最新 safeKeep 条中的记录（按 created_at DESC）
      const deleteSql = `
        DELETE FROM recommendations
        WHERE id NOT IN (
          SELECT id FROM recommendations
          ORDER BY created_at DESC
          LIMIT ?
        )`;
      deleted = await new Promise<number>((resolve, reject) => {
        this.db!.run(deleteSql, [safeKeep], function (this: any, err: Error | null) {
          if (err) return reject(err);
          resolve(this?.changes ?? 0);
        });
      });

      // 回收空间
      await new Promise<void>((resolve, reject) => {
      this.db!.exec('VACUUM', (err: Error | null) => (err ? reject(err) : resolve()));
    });
    }

    return { deleted, kept: Math.min(safeKeep, total), total };
  }
  
  /**
   * 查询推荐历史
   */
  async getRecommendationHistory(
    limit: number = 100,
    offset: number = 0,
    filters?: {
      strategy_type?: string;
      status?: string;
      result?: string;
      start_date?: Date;
      end_date?: Date;
    },
    include_active: boolean = true
  ): Promise<{ recommendations: RecommendationRecord[]; total: number }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    
    if (filters) {
      if (filters.strategy_type) {
        whereClause += ' AND strategy_type = ?';
        params.push(filters.strategy_type);
      }
      if (filters.status) {
        whereClause += ' AND status = ?';
        params.push(filters.status);
      }
      if (filters.result) {
        whereClause += ' AND result = ?';
        params.push(filters.result);
      }
      if (filters.start_date) {
        whereClause += ' AND created_at >= ?';
        params.push(filters.start_date.toISOString());
      }
      if (filters.end_date) {
        whereClause += ' AND created_at <= ?';
        params.push(filters.end_date.toISOString());
      }
    }

    // 默认从“历史”列表排除进行中的记录，除非显式要求包含或已指定 status 过滤
    if (include_active === false && !(filters && filters.status)) {
      whereClause += " AND status <> 'ACTIVE'";
    }
    
    // 查询总数
    const countSql = `SELECT COUNT(*) as total FROM recommendations ${whereClause}`;
    const total = await new Promise<number>((resolve, reject) => {
      this.db!.get(countSql, params, (err: Error | null, row: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.total);
        }
      });
    });
    
    // 查询数据
    const dataSql = `
      SELECT * FROM recommendations 
      ${whereClause} 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `;
    
    const recommendations = await new Promise<RecommendationRecord[]>((resolve, reject) => {
      this.db!.all(dataSql, [...params, limit, offset], (err: Error | null, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const recs = rows.map(row => this.rowToRecommendation(row));
          resolve(recs);
        }
      });
    });
    
    return { recommendations, total };
  }
  
  // 新增：统计时间窗口内的下单数量（可按方向过滤），并返回窗口内最早一单时间
  async countRecommendationsWithin(
    startDate: Date,
    filters?: { direction?: 'LONG' | 'SHORT' }
  ): Promise<{ count: number; oldestCreatedAt?: Date | null }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const params: any[] = [startDate.toISOString()];
    let where = 'WHERE created_at >= ?';
    if (filters?.direction) {
      where += ' AND direction = ?';
      params.push(filters.direction);
    }
    const sql = `SELECT COUNT(*) as total, MIN(datetime(created_at)) as oldest FROM recommendations ${where}`;
    return new Promise((resolve, reject) => {
      this.db!.get(sql, params, (err: Error | null, row: any) => {
        if (err) return reject(err);
        const cnt = Number(row?.total ?? 0);
        const oldest = row?.oldest ? new Date(row.oldest) : null;
        resolve({ count: cnt, oldestCreatedAt: oldest });
      });
    });
  }
  
  /**
   * 获取统计信息
   */
  async getStatistics(strategyType?: string): Promise<{
    total: number;
    active: number;
    wins: number;
    losses: number;
    breakeven: number;
    winRate: number;
    avgPnl: number;
    totalPnl: number;
    avgHoldingDuration: number;
  }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    let whereClause = '';
    const params: any[] = [];
    
    if (strategyType) {
      whereClause = 'WHERE strategy_type = ?';
      params.push(strategyType);
    }
    
    const sql = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result = 'LOSS' THEN 1 ELSE 0 END) as losses,
        SUM(CASE WHEN result = 'BREAKEVEN' THEN 1 ELSE 0 END) as breakeven,
        AVG(CASE WHEN pnl_percent IS NOT NULL THEN pnl_percent ELSE 0 END) as avgPnl,
        SUM(CASE WHEN pnl_amount IS NOT NULL THEN pnl_amount ELSE 0 END) as totalPnl,
        AVG(CASE WHEN holding_duration IS NOT NULL THEN holding_duration ELSE 0 END) as avgHoldingDuration
      FROM recommendations ${whereClause}
    `;
    
    return new Promise((resolve, reject) => {
      this.db!.get(sql, params, (err: Error | null, row: any) => {
        if (err) {
          reject(err);
        } else {
          const closedCount = (row.wins || 0) + (row.losses || 0) + (row.breakeven || 0);
          const winRate = closedCount > 0 ? ((row.wins || 0) / closedCount) * 100 : 0;
          
          resolve({
            total: row.total || 0,
            active: row.active || 0,
            wins: row.wins || 0,
            losses: row.losses || 0,
            breakeven: row.breakeven || 0,
            winRate,
            avgPnl: row.avgPnl || 0,
            totalPnl: row.totalPnl || 0,
            avgHoldingDuration: row.avgHoldingDuration || 0
          });
        }
      });
    });
  }
  
  /**
   * 新增：保存 ML 样本
   */
  async saveMLSample(sample: MLSampleRecord): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const sql = `
      INSERT INTO ml_samples (
        created_at, updated_at, timestamp, symbol, interval, price,
        features_json, indicators_json,
        ml_prediction, ml_confidence, ml_calibrated_confidence, ml_scores_json,
        technical_strength, combined_strength, final_signal, position_size,
        target_price, stop_loss, take_profit, risk_reward,
        reasoning_ml, reasoning_final,
        label_horizon_min, label_return, label_drawdown, label_ready
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?
      )
    `;

    const nowIso = new Date().toISOString();
    const params = [
      sample.created_at ? sample.created_at.toISOString() : nowIso,
      sample.updated_at ? sample.updated_at.toISOString() : nowIso,
      sample.timestamp,
      sample.symbol,
      sample.interval ?? null,
      sample.price ?? null,
      sample.features_json ?? null,
      sample.indicators_json ?? null,
      sample.ml_prediction ?? null,
      sample.ml_confidence ?? null,
      sample.ml_calibrated_confidence ?? null,
      sample.ml_scores_json ?? null,
      sample.technical_strength ?? null,
      sample.combined_strength ?? null,
      sample.final_signal ?? null,
      sample.position_size ?? null,
      sample.target_price ?? null,
      sample.stop_loss ?? null,
      sample.take_profit ?? null,
      sample.risk_reward ?? null,
      sample.reasoning_ml ?? null,
      sample.reasoning_final ?? null,
      sample.label_horizon_min ?? null,
      sample.label_return ?? null,
      sample.label_drawdown ?? null,
      sample.label_ready ?? 0
    ];

    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function (this: any, err: Error | null) {
        if (err) {
          console.error('Error saving ML sample:', err);
          reject(err);
        } else {
          const insertedId = this && typeof this.lastID === 'number' ? this.lastID : 0;
          resolve(insertedId);
        }
      });
    });
  }

  /**
   * 新增：更新 ML 样本标签
   */
  async updateMLSampleLabel(id: number, labelReturn: number | null, labelDrawdown: number | null, labelReady: boolean = true): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const sql = `
      UPDATE ml_samples SET
        updated_at = ?,
        label_return = ?,
        label_drawdown = ?,
        label_ready = ?
      WHERE id = ?
    `;

    const params = [
      new Date().toISOString(),
      labelReturn,
      labelDrawdown,
      labelReady ? 1 : 0,
      id
    ];

    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function (err: Error | null) {
        if (err) {
          console.error('Error updating ML sample label:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 新增：获取到期但尚未回填标签的样本
   * 规则：timestamp + 60000 * COALESCE(label_horizon_min, ?) <= now
   */
  async getPendingLabelSamples(horizonMinutes: number, nowMs: number = Date.now(), limit: number = 500): Promise<MLSampleRecord[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const sql = `
      SELECT * FROM ml_samples
      WHERE label_ready = 0
        AND (timestamp + 60000 * COALESCE(label_horizon_min, ?)) <= ?
      ORDER BY timestamp ASC
      LIMIT ?
    `;

    return new Promise((resolve, reject) => {
      this.db!.all(sql, [horizonMinutes, nowMs, limit], (err: Error | null, rows: any[]) => {
        if (err) {
          console.error('Error querying pending label samples:', err);
          reject(err);
        } else {
          const out = rows.map(r => this.rowToMLSample(r));
          resolve(out);
        }
      });
    });
  }

  /**
   * 新增：查询样本（分页/过滤）
   */
  async getMLSamples(limit: number = 100, offset: number = 0, filters?: { symbol?: string; prediction?: MLSampleRecord['ml_prediction']; startTs?: number; endTs?: number; }): Promise<{ samples: MLSampleRecord[]; total: number; }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (filters?.symbol) { where += ' AND symbol = ?'; params.push(filters.symbol); }
    if (filters?.prediction) { where += ' AND ml_prediction = ?'; params.push(filters.prediction); }
    if (typeof filters?.startTs === 'number') { where += ' AND timestamp >= ?'; params.push(filters.startTs); }
    if (typeof filters?.endTs === 'number') { where += ' AND timestamp <= ?'; params.push(filters.endTs); }

    const countSql = `SELECT COUNT(*) as total FROM ml_samples ${where}`;
    const total = await new Promise<number>((resolve, reject) => {
      this.db!.get(countSql, params, (err: Error | null, row: any) => {
        if (err) reject(err); else resolve(row?.total ?? 0);
      });
    });

    const dataSql = `
      SELECT * FROM ml_samples
      ${where}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `;

    const samples = await new Promise<MLSampleRecord[]>((resolve, reject) => {
      this.db!.all(dataSql, [...params, limit, offset], (err: Error | null, rows: any[]) => {
        if (err) reject(err); else resolve(rows.map(r => this.rowToMLSample(r)));
      });
    });

    return { samples, total };
  }
  
  /**
   * 将数据库行转换为推荐记录对象
   */
  private rowToRecommendation(row: any): RecommendationRecord {
    return {
      id: row.id,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      symbol: row.symbol,
      direction: row.direction,
      entry_price: row.entry_price,
      current_price: row.current_price,
      stop_loss_price: row.stop_loss_price,
      take_profit_price: row.take_profit_price,
      stop_loss_percent: row.stop_loss_percent,
      take_profit_percent: row.take_profit_percent,
      liquidation_price: row.liquidation_price,
      margin_ratio: row.margin_ratio,
      maintenance_margin: row.maintenance_margin,
      leverage: row.leverage,
      position_size: row.position_size,
      risk_level: row.risk_level,
      strategy_type: row.strategy_type,
      algorithm_name: row.algorithm_name,
      signal_strength: row.signal_strength,
      confidence_score: row.confidence_score,
      quality_score: row.quality_score,
      status: row.status,
      result: row.result,
      exit_price: row.exit_price,
      exit_time: row.exit_time ? new Date(row.exit_time) : undefined,
      exit_reason: row.exit_reason,
      // 新增：映射 exit_label
      exit_label: row.exit_label || undefined,
      pnl_amount: row.pnl_amount,
      pnl_percent: row.pnl_percent,
      holding_duration: row.holding_duration,
      market_volatility: row.market_volatility,
      volume_24h: row.volume_24h,
      price_change_24h: row.price_change_24h,
      source: row.source,
      is_strategy_generated: Boolean(row.is_strategy_generated),
      strategy_confidence_level: row.strategy_confidence_level,
      exclude_from_ml: Boolean(row.exclude_from_ml),
      notes: row.notes,
      // 新增：EV 相关字段
      expected_return: typeof row.expected_return === 'number' ? row.expected_return : undefined,
      ev: typeof row.ev === 'number' ? row.ev : undefined,
      ev_threshold: typeof row.ev_threshold === 'number' ? row.ev_threshold : undefined,
      ev_ok: ((): boolean | undefined => {
        if (typeof row.ev_ok === 'number') return row.ev_ok === 1;
        if (typeof row.ev_ok === 'boolean') return row.ev_ok;
        return undefined;
      })(),
      ab_group: row.ab_group || undefined,
      // 新增：实验ID与变体
      experiment_id: row.experiment_id || undefined,
      variant: row.variant || undefined,
      // 新增：dedupe_key 回传
      dedupe_key: row.dedupe_key || undefined,
      // 新增：extra_json 回传
      extra_json: row.extra_json || undefined,
      // ATR动态止损相关字段
      atr_value: typeof row.atr_value === 'number' ? row.atr_value : undefined,
      atr_period: typeof row.atr_period === 'number' ? row.atr_period : undefined,
      atr_sl_multiplier: typeof row.atr_sl_multiplier === 'number' ? row.atr_sl_multiplier : undefined,
      atr_tp_multiplier: typeof row.atr_tp_multiplier === 'number' ? row.atr_tp_multiplier : undefined,
      // 分批止盈状态字段
      tp1_hit: Boolean(row.tp1_hit),
      tp2_hit: Boolean(row.tp2_hit),
      tp3_hit: Boolean(row.tp3_hit),
      reduction_count: typeof row.reduction_count === 'number' ? row.reduction_count : 0,
      reduction_ratio: typeof row.reduction_ratio === 'number' ? row.reduction_ratio : undefined
    };
  }

  // 新增：行到 ML 样本转换
  private rowToMLSample(row: any): MLSampleRecord {
    return {
      id: row.id,
      created_at: row.created_at ? new Date(row.created_at) : undefined,
      updated_at: row.updated_at ? new Date(row.updated_at) : undefined,
      timestamp: row.timestamp,
      symbol: row.symbol,
      interval: row.interval ?? undefined,
      price: row.price ?? undefined,
      features_json: row.features_json ?? undefined,
      indicators_json: row.indicators_json ?? undefined,
      ml_prediction: row.ml_prediction ?? undefined,
      ml_confidence: row.ml_confidence ?? undefined,
      ml_calibrated_confidence: row.ml_calibrated_confidence ?? undefined,
      ml_scores_json: row.ml_scores_json ?? undefined,
      technical_strength: row.technical_strength ?? undefined,
      combined_strength: row.combined_strength ?? undefined,
      final_signal: row.final_signal ?? undefined,
      position_size: row.position_size ?? undefined,
      target_price: row.target_price ?? undefined,
      stop_loss: row.stop_loss ?? undefined,
      take_profit: row.take_profit ?? undefined,
      risk_reward: row.risk_reward ?? undefined,
      reasoning_ml: row.reasoning_ml ?? undefined,
      reasoning_final: row.reasoning_final ?? undefined,
      label_horizon_min: row.label_horizon_min ?? undefined,
      label_return: typeof row.label_return === 'number' ? row.label_return : null,
      label_drawdown: typeof row.label_drawdown === 'number' ? row.label_drawdown : null,
      label_ready: Boolean(row.label_ready)
    };
  }

  // 新增：保存执行记录
  async saveExecution(exe: ExecutionRecord): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const sql = `
      INSERT INTO executions (
        created_at, updated_at, recommendation_id, position_id, event_type, symbol, direction, size,
        intended_price, intended_timestamp, fill_price, fill_timestamp, latency_ms,
        slippage_bps, slippage_amount, fee_bps, fee_amount, pnl_amount, pnl_percent, variant, ab_group, experiment_id, extra_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `;

    const nowIso = new Date().toISOString();
    const params = [
      exe.created_at ? exe.created_at.toISOString() : nowIso,
      exe.updated_at ? exe.updated_at.toISOString() : nowIso,
      exe.recommendation_id ?? null,
      exe.position_id ?? null,
      exe.event_type,
      exe.symbol ?? null,
      exe.direction ?? null,
      exe.size ?? null,
      exe.intended_price ?? null,
      exe.intended_timestamp ?? null,
      exe.fill_price ?? null,
      exe.fill_timestamp ?? null,
      exe.latency_ms ?? null,
      exe.slippage_bps ?? null,
      exe.slippage_amount ?? null,
      exe.fee_bps ?? null,
      exe.fee_amount ?? null,
      exe.pnl_amount ?? null,
      exe.pnl_percent ?? null,
      exe.variant ?? 'control',
      exe.ab_group ?? null,
      exe.experiment_id ?? null,
      exe.extra_json ?? null
    ];

    return new Promise<number>((resolve, reject) => {
      this.db!.run(sql, params, function (this: any, err: Error | null) {
        if (err) {
          console.error('Error saving execution:', err);
          reject(err);
        } else {
          const insertedId = this && typeof this.lastID === 'number' ? this.lastID : 0;
          resolve(insertedId);
        }
      });
    });
  }

  /**
   * 保存滑点分析记录
   */
  async saveSlippageAnalysis(analysis: SlippageAnalysisRecord): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const sql = `
      INSERT INTO slippage_analysis (
        created_at, updated_at, recommendation_id, symbol, direction,
        expected_price, actual_price, price_difference, price_difference_bps,
        execution_latency_ms, order_book_depth, market_volatility,
        slippage_bps, slippage_category, slippage_reason,
        fee_rate_bps, fee_amount, total_cost_bps,
        original_threshold, adjusted_threshold, threshold_adjustment_reason,
        market_session, liquidity_score, spread_bps, extra_json
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?
      )
    `;

    const nowIso = new Date().toISOString();
    const params = [
      analysis.created_at ? analysis.created_at.toISOString() : nowIso,
      analysis.updated_at ? analysis.updated_at.toISOString() : nowIso,
      analysis.recommendation_id,
      analysis.symbol,
      analysis.direction,
      analysis.expected_price,
      analysis.actual_price,
      analysis.price_difference,
      analysis.price_difference_bps,
      analysis.execution_latency_ms,
      analysis.order_book_depth ?? null,
      analysis.market_volatility ?? null,
      analysis.slippage_bps,
      analysis.slippage_category,
      analysis.slippage_reason ?? null,
      analysis.fee_rate_bps,
      analysis.fee_amount,
      analysis.total_cost_bps,
      analysis.original_threshold,
      analysis.adjusted_threshold ?? null,
      analysis.threshold_adjustment_reason ?? null,
      analysis.market_session ?? null,
      analysis.liquidity_score ?? null,
      analysis.spread_bps ?? null,
      analysis.extra_json ?? null
    ];

    return new Promise<number>((resolve, reject) => {
      this.db!.run(sql, params, function (this: any, err: Error | null) {
        if (err) {
          console.error('Error saving slippage analysis:', err);
          reject(err);
        } else {
          const insertedId = this && typeof this.lastID === 'number' ? this.lastID : 0;
          resolve(insertedId);
        }
      });
    });
  }

  /**
   * 更新滑点统计聚合数据
   */
  async updateSlippageStatistics(stats: SlippageStatistics): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const sql = `
      INSERT OR REPLACE INTO slippage_statistics (
        symbol, direction, period,
        total_executions, avg_slippage_bps, median_slippage_bps, max_slippage_bps, min_slippage_bps,
        low_slippage_count, medium_slippage_count, high_slippage_count, extreme_slippage_count,
        avg_total_cost_bps, avg_fee_bps, avg_latency_ms, avg_price_difference_bps,
        suggested_threshold_adjustment, confidence_score, calculated_at, updated_at
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `;

    const nowIso = new Date().toISOString();
    const params = [
      stats.symbol,
      stats.direction ?? null,
      stats.period,
      stats.total_executions,
      stats.avg_slippage_bps,
      stats.median_slippage_bps,
      stats.max_slippage_bps,
      stats.min_slippage_bps,
      stats.low_slippage_count,
      stats.medium_slippage_count,
      stats.high_slippage_count,
      stats.extreme_slippage_count,
      stats.avg_total_cost_bps,
      stats.avg_fee_bps,
      stats.avg_latency_ms,
      stats.avg_price_difference_bps,
      stats.suggested_threshold_adjustment,
      stats.confidence_score,
      stats.calculated_at.toISOString(),
      nowIso
    ];

    return new Promise<void>((resolve, reject) => {
      console.log(`[DEBUG] Updating slippage statistics with params:`, params);
      this.db!.run(sql, params, function (this: any, err: Error | null) {
        if (err) {
          console.error('Error updating slippage statistics:', err);
          reject(err);
        } else {
          console.log(`[DEBUG] Successfully updated slippage statistics, changes: ${this.changes}`);
          resolve();
        }
      });
    });
  }

  /**
   * 获取滑点分析记录
   */
  async getSlippageAnalysis(filters: {
    recommendation_id?: string;
    symbol?: string;
    direction?: 'LONG' | 'SHORT';
    slippage_category?: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<SlippageAnalysisRecord[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    let sql = `
      SELECT id, created_at, updated_at, recommendation_id, symbol, direction,
             expected_price, actual_price, price_difference, price_difference_bps,
             execution_latency_ms, order_book_depth, market_volatility,
             slippage_bps, slippage_category, slippage_reason,
             fee_rate_bps, fee_amount, total_cost_bps,
             original_threshold, adjusted_threshold, threshold_adjustment_reason,
             market_session, liquidity_score, spread_bps, extra_json
      FROM slippage_analysis
      WHERE 1=1
    `;
    
    const params: any[] = [];

    if (filters.recommendation_id) {
      sql += ' AND recommendation_id = ?';
      params.push(filters.recommendation_id);
    }
    if (filters.symbol) {
      sql += ' AND symbol = ?';
      params.push(filters.symbol);
    }
    if (filters.direction) {
      sql += ' AND direction = ?';
      params.push(filters.direction);
    }
    if (filters.slippage_category) {
      sql += ' AND slippage_category = ?';
      params.push(filters.slippage_category);
    }
    if (filters.from) {
      sql += ' AND created_at >= ?';
      params.push(filters.from);
    }
    if (filters.to) {
      sql += ' AND created_at <= ?';
      params.push(filters.to);
    }

    sql += ' ORDER BY created_at DESC';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }
    if (filters.offset) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }

    return new Promise<SlippageAnalysisRecord[]>((resolve, reject) => {
      this.db!.all(sql, params, (err: Error | null, rows: any[]) => {
        if (err) {
          console.error('Error querying slippage analysis:', err);
          reject(err);
        } else {
          resolve(rows.map(row => ({
            id: row.id,
            created_at: row.created_at ? new Date(row.created_at) : undefined,
            updated_at: row.updated_at ? new Date(row.updated_at) : undefined,
            recommendation_id: row.recommendation_id,
            symbol: row.symbol,
            direction: row.direction,
            expected_price: row.expected_price,
            actual_price: row.actual_price,
            price_difference: row.price_difference,
            price_difference_bps: row.price_difference_bps,
            execution_latency_ms: row.execution_latency_ms,
            order_book_depth: row.order_book_depth,
            market_volatility: row.market_volatility,
            slippage_bps: row.slippage_bps,
            slippage_category: row.slippage_category,
            slippage_reason: row.slippage_reason,
            fee_rate_bps: row.fee_rate_bps,
            fee_amount: row.fee_amount,
            total_cost_bps: row.total_cost_bps,
            original_threshold: row.original_threshold,
            adjusted_threshold: row.adjusted_threshold,
            threshold_adjustment_reason: row.threshold_adjustment_reason,
            market_session: row.market_session,
            liquidity_score: row.liquidity_score,
            spread_bps: row.spread_bps,
            extra_json: row.extra_json
          })));
        }
      });
    });
  }

  /**
   * 获取滑点统计聚合数据
   */
  async getSlippageStatistics(filters: {
    symbol?: string;
    direction?: 'LONG' | 'SHORT';
    period?: string;
  } = {}): Promise<SlippageStatistics[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    let sql = `
      SELECT symbol, direction, period,
             total_executions, avg_slippage_bps, median_slippage_bps, max_slippage_bps, min_slippage_bps,
             low_slippage_count, medium_slippage_count, high_slippage_count, extreme_slippage_count,
             avg_total_cost_bps, avg_fee_bps, avg_latency_ms, avg_price_difference_bps,
             suggested_threshold_adjustment, confidence_score, calculated_at, updated_at
      FROM slippage_statistics
      WHERE 1=1
    `;
    
    const params: any[] = [];

    if (filters.symbol) {
      sql += ' AND symbol = ?';
      params.push(filters.symbol);
    }
    if (filters.direction) {
      sql += ' AND direction = ?';
      params.push(filters.direction);
    }
    if (filters.period) {
      sql += ' AND period = ?';
      params.push(filters.period);
    }

    sql += ' ORDER BY updated_at DESC';

    return new Promise<SlippageStatistics[]>((resolve, reject) => {
      this.db!.all(sql, params, (err: Error | null, rows: any[]) => {
        if (err) {
          console.error('Error querying slippage statistics:', err);
          reject(err);
        } else {
          resolve(rows.map(row => ({
            symbol: row.symbol,
            direction: row.direction,
            period: row.period,
            total_executions: row.total_executions,
            avg_slippage_bps: row.avg_slippage_bps,
            median_slippage_bps: row.median_slippage_bps,
            max_slippage_bps: row.max_slippage_bps,
            min_slippage_bps: row.min_slippage_bps,
            low_slippage_count: row.low_slippage_count,
            medium_slippage_count: row.medium_slippage_count,
            high_slippage_count: row.high_slippage_count,
            extreme_slippage_count: row.extreme_slippage_count,
            avg_total_cost_bps: row.avg_total_cost_bps,
            avg_fee_bps: row.avg_fee_bps,
            avg_latency_ms: row.avg_latency_ms,
            avg_price_difference_bps: row.avg_price_difference_bps,
            suggested_threshold_adjustment: row.suggested_threshold_adjustment,
            confidence_score: row.confidence_score,
            calculated_at: new Date(row.calculated_at),
            updated_at: new Date(row.updated_at)
          })));
        }
      });
    });
  }

  // 新增：行到执行记录转换（预留）
  private rowToExecution(row: any): ExecutionRecord {
    return {
      id: row.id,
      created_at: row.created_at ? new Date(row.created_at) : undefined,
      updated_at: row.updated_at ? new Date(row.updated_at) : undefined,
      recommendation_id: row.recommendation_id ?? null,
      position_id: row.position_id ?? null,
      event_type: row.event_type,
      symbol: row.symbol ?? null,
      direction: row.direction ?? null,
      size: row.size ?? null,
      intended_price: row.intended_price ?? null,
      intended_timestamp: row.intended_timestamp ?? null,
      fill_price: row.fill_price ?? null,
      fill_timestamp: row.fill_timestamp ?? null,
      latency_ms: row.latency_ms ?? null,
      slippage_bps: row.slippage_bps ?? null,
      slippage_amount: row.slippage_amount ?? null,
      fee_bps: row.fee_bps ?? null,
      fee_amount: row.fee_amount ?? null,
      pnl_amount: row.pnl_amount ?? null,
      pnl_percent: row.pnl_percent ?? null,
      ab_group: row.ab_group ?? null,
      variant: row.variant ?? null,
      experiment_id: row.experiment_id ?? null,
      extra_json: row.extra_json ?? null
    };
  }

  // 新增：按ID获取单条执行记录（包含与推荐的 COALESCE 字段）
  async getExecutionById(id: number): Promise<ExecutionRecord | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const sql = `SELECT e.*, COALESCE(e.ab_group, r.ab_group) AS ab_group, COALESCE(e.variant, r.variant) AS variant, COALESCE(e.experiment_id, r.experiment_id) AS experiment_id FROM executions e LEFT JOIN recommendations r ON r.id = e.recommendation_id WHERE e.id = ? LIMIT 1`;
    return new Promise<ExecutionRecord | null>((resolve, reject) => {
      this.db!.get(sql, [id], (err: Error | null, row: any) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        resolve(this.rowToExecution(row));
      });
    });
  }
  
  /**
   * 查找需要回填止盈止损目标价的记录
   */
  async findRecommendationsForTargetBackfill(): Promise<Array<{
    id: string;
    entry_price: number;
    direction: 'LONG' | 'SHORT';
    leverage: number;
    take_profit_percent: number | null;
    stop_loss_percent: number | null;
    take_profit_price: number | null;
    stop_loss_price: number | null;
  }>> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const sql = `
      SELECT id, entry_price, direction, leverage,
             take_profit_percent, stop_loss_percent,
             take_profit_price, stop_loss_price
      FROM recommendations
      WHERE (take_profit_price IS NULL AND take_profit_percent IS NOT NULL)
         OR (stop_loss_price IS NULL AND stop_loss_percent IS NOT NULL)
    `;

    return new Promise((resolve, reject) => {
      this.db!.all(sql, [], (err: Error | null, rows: any[]) => {
        if (err) {
          console.error('Error querying recommendations for backfill:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * 部分更新推荐记录的止盈/止损目标价
   */
  async updateTargetPrices(id: string, fields: { take_profit_price?: number | null; stop_loss_price?: number | null }): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const sets: string[] = ['updated_at = ?'];
    const params: any[] = [new Date().toISOString()];

    if (fields.take_profit_price !== undefined) {
      sets.push('take_profit_price = ?');
      params.push(fields.take_profit_price);
    }
    if (fields.stop_loss_price !== undefined) {
      sets.push('stop_loss_price = ?');
      params.push(fields.stop_loss_price);
    }

    // 如果没有需要更新的字段，直接返回
    if (sets.length === 1) {
      return;
    }

    const sql = `UPDATE recommendations SET ${sets.join(', ')} WHERE id = ?`;
    params.push(id);

    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function (err: Error | null) {
        if (err) {
          console.error('Error updating target prices:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 滑点统计自动回灌机制
   * 定期重新计算滑点统计数据，确保EV计算模型使用最新数据
   */
  async backfillSlippageStatistics(options: {
    symbol?: string;
    period?: string;
    force?: boolean;
    batchSize?: number;
  } = {}): Promise<{
    processed: number;
    updated: number;
    symbols: string[];
  }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const {
      symbol,
      period = '7d',
      force = false,
      batchSize = 1000
    } = options;

    // 获取需要回灌的滑点分析数据
    const analysisFilters: any = {};
    if (symbol) analysisFilters.symbol = symbol;
    
    // 如果是强制回灌，获取所有数据；否则只获取最近period的数据
    if (!force) {
      const cutoffDate = new Date();
      
      // 根据不同周期设置正确的时间范围
      switch (period) {
        case '1h':
          cutoffDate.setHours(cutoffDate.getHours() - 1);
          break;
        case '4h':
          cutoffDate.setHours(cutoffDate.getHours() - 4);
          break;
        case '1d':
          cutoffDate.setDate(cutoffDate.getDate() - 1);
          break;
        case '7d':
          cutoffDate.setDate(cutoffDate.getDate() - 7);
          break;
        case '30d':
          cutoffDate.setDate(cutoffDate.getDate() - 30);
          break;
        default:
          // 默认使用 1 天
          cutoffDate.setDate(cutoffDate.getDate() - 1);
          break;
      }
      
      analysisFilters.from = cutoffDate.toISOString();
    }

    analysisFilters.limit = batchSize;

    const analysisData = await this.getSlippageAnalysis(analysisFilters);
    
    if (analysisData.length === 0) {
      return { processed: 0, updated: 0, symbols: [] };
    }

    // 按symbol和direction分组数据
    const groupedData: { [key: string]: SlippageAnalysisRecord[] } = {};
    analysisData.forEach(record => {
      const key = `${record.symbol}_${record.direction}`;
      if (!groupedData[key]) {
        groupedData[key] = [];
      }
      groupedData[key].push(record);
    });

    let updatedCount = 0;
    const processedSymbols: string[] = [];

    // 为每个分组计算统计并更新
    for (const [key, records] of Object.entries(groupedData)) {
      const [symbol, direction] = key.split('_');
      
      // 计算统计指标
      const slippages = records.map(r => r.slippage_bps).filter(Boolean) as number[];
      const totalCosts = records.map(r => r.total_cost_bps).filter(Boolean) as number[];
      const latencies = records.map(r => r.execution_latency_ms).filter(Boolean) as number[];
      
      if (slippages.length === 0) continue;

      // 计算基础统计
      const avgSlippage = slippages.reduce((sum, s) => sum + s, 0) / slippages.length;
      const sortedSlippages = [...slippages].sort((a, b) => a - b);
      const medianSlippage = sortedSlippages[Math.floor(sortedSlippages.length / 2)];
      const maxSlippage = Math.max(...slippages);
      const minSlippage = Math.min(...slippages);

      // 计算滑点分布
      const lowCount = slippages.filter(s => s < 5).length;
      const mediumCount = slippages.filter(s => s >= 5 && s < 15).length;
      const highCount = slippages.filter(s => s >= 15 && s < 30).length;
      const extremeCount = slippages.filter(s => s >= 30).length;

      // 计算成本统计
      const avgTotalCost = totalCosts.length > 0 ? totalCosts.reduce((sum, c) => sum + c, 0) / totalCosts.length : 0;
      const avgFee = records.reduce((sum, r) => sum + (r.fee_rate_bps || 0), 0) / records.length;
      const avgLatency = latencies.length > 0 ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length : 0;
      const avgPriceDiff = records.reduce((sum, r) => sum + (r.price_difference_bps || 0), 0) / records.length;

      // 构建统计记录
      const statsRecord: SlippageStatistics = {
        symbol,
        direction: direction as 'LONG' | 'SHORT',
        period,
        total_executions: records.length,
        avg_slippage_bps: avgSlippage,
        median_slippage_bps: medianSlippage,
        max_slippage_bps: maxSlippage,
        min_slippage_bps: minSlippage,
        low_slippage_count: lowCount,
        medium_slippage_count: mediumCount,
        high_slippage_count: highCount,
        extreme_slippage_count: extremeCount,
        avg_total_cost_bps: avgTotalCost,
        avg_fee_bps: avgFee,
        avg_latency_ms: avgLatency,
        avg_price_difference_bps: avgPriceDiff,
        suggested_threshold_adjustment: this.calculateThresholdAdjustment(avgSlippage, medianSlippage),
        confidence_score: this.calculateConfidenceScore(records.length, avgSlippage),
        calculated_at: new Date()
      };

      // 添加调试日志
      console.log(`[DEBUG] Slippage statistics for ${symbol}-${direction}:`, {
        records_length: records.length,
        total_executions: statsRecord.total_executions,
        avg_slippage_bps: statsRecord.avg_slippage_bps,
        median_slippage_bps: statsRecord.median_slippage_bps
      });

      // 更新统计
      await this.updateSlippageStatistics(statsRecord);
      updatedCount++;
      
      if (!processedSymbols.includes(symbol)) {
        processedSymbols.push(symbol);
      }
    }

    return {
      processed: analysisData.length,
      updated: updatedCount,
      symbols: processedSymbols
    };
  }

  /**
   * 计算阈值调整建议
   */
  private calculateThresholdAdjustment(avgSlippage: number, medianSlippage: number): number {
    // 基于平均滑点和中位数滑点计算调整因子
    const baseAdjustment = (avgSlippage + medianSlippage) / 2;
    
    // 滑点越高，建议提高阈值（正值表示提高阈值）
    if (baseAdjustment > 20) {
      return 5; // 提高5bps
    } else if (baseAdjustment > 10) {
      return 2; // 提高2bps
    } else if (baseAdjustment < 5) {
      return -2; // 降低2bps
    }
    
    return 0; // 无需调整
  }

  /**
   * 计算置信度分数
   */
  private calculateConfidenceScore(sampleSize: number, avgSlippage: number): number {
    // 基于样本数量和滑点稳定性计算置信度
    let score = Math.min(1, sampleSize / 50); // 样本越多，置信度越高
    
    // 滑点越稳定（标准差小），置信度越高
    // 这里简化处理，实际应该计算标准差
    if (avgSlippage < 10) {
      score *= 0.9; // 低滑点相对稳定
    } else if (avgSlippage > 25) {
      score *= 0.7; // 高滑点波动较大
    }
    
    return Math.max(0.1, Math.min(1, score));
  }

  /**
   * 检测高滑点异常并生成预警
   */
  async detectHighSlippageAnomalies(options: {
    symbol?: string;
    period?: string;
    threshold?: number;
    minSamples?: number;
  } = {}): Promise<{
    anomalies: Array<{
      symbol: string;
      direction: 'LONG' | 'SHORT';
      avg_slippage_bps: number;
      median_slippage_bps: number;
      sample_count: number;
      severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      suggested_action: string;
      detected_at: Date;
    }>;
    total_checked: number;
  }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const {
      symbol,
      period = '7d',
      threshold = 15, // 默认15bps为高滑点阈值
      minSamples = 10
    } = options;

    // 获取滑点统计数据
    const statsFilters: any = {};
    if (symbol) statsFilters.symbol = symbol;
    
    const statistics = await this.getSlippageStatistics(statsFilters);
    
    if (statistics.length === 0) {
      return { anomalies: [], total_checked: 0 };
    }

    const anomalies: any[] = [];
    let totalChecked = 0;

    // 检查每个统计记录
    for (const stat of statistics) {
      totalChecked++;
      
      // 跳过样本数量不足的记录
      if (stat.total_executions < minSamples) {
        continue;
      }

      // 检查是否超过高滑点阈值
      if (stat.avg_slippage_bps > threshold || stat.median_slippage_bps > threshold) {
        const severity = this.determineAnomalySeverity(
          stat.avg_slippage_bps,
          stat.median_slippage_bps,
          stat.total_executions
        );

        anomalies.push({
          symbol: stat.symbol,
          direction: stat.direction,
          avg_slippage_bps: stat.avg_slippage_bps,
          median_slippage_bps: stat.median_slippage_bps,
          sample_count: stat.total_executions,
          severity,
          suggested_action: this.generateSuggestion(severity, stat.avg_slippage_bps),
          detected_at: new Date()
        });
      }
    }

    return { anomalies, total_checked: totalChecked };
  }

  /**
   * 确定异常严重级别
   */
  private determineAnomalySeverity(
    avgSlippage: number,
    medianSlippage: number,
    sampleCount: number
  ): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const baseSeverity = (avgSlippage + medianSlippage) / 2;
    
    if (baseSeverity > 40) {
      return 'CRITICAL';
    } else if (baseSeverity > 25) {
      return 'HIGH';
    } else if (baseSeverity > 15) {
      return 'MEDIUM';
    } else {
      return 'LOW';
    }
  }

  /**
   * 生成预警建议
   */
  private generateSuggestion(severity: string, avgSlippage: number): string {
    const baseAdjustment = Math.ceil(avgSlippage / 5);
    
    switch (severity) {
      case 'CRITICAL':
        return `立即暂停交易，提高阈值${baseAdjustment * 2}bps，检查流动性问题`;
      case 'HIGH':
        return `提高阈值${baseAdjustment}bps，减少交易频率，监控市场深度`;
      case 'MEDIUM':
        return `提高阈值${Math.max(2, baseAdjustment)}bps，优化下单策略`;
      case 'LOW':
        return `轻微调整阈值${Math.max(1, baseAdjustment)}bps，继续观察`;
      default:
        return '监控滑点情况，必要时调整阈值';
    }
  }

  /**
   * 保存高滑点预警记录
   */
  async saveSlippageAlert(alert: {
    symbol: string;
    direction: 'LONG' | 'SHORT';
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    avg_slippage_bps: number;
    median_slippage_bps: number;
    sample_count: number;
    suggested_action: string;
    triggered_by: string;
  }): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const query = `
      INSERT INTO slippage_alerts (
        symbol, direction, severity, avg_slippage_bps, median_slippage_bps,
        sample_count, suggested_action, triggered_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const now = new Date().toISOString();
    const values = [
      alert.symbol,
      alert.direction,
      alert.severity,
      alert.avg_slippage_bps,
      alert.median_slippage_bps,
      alert.sample_count,
      alert.suggested_action,
      alert.triggered_by,
      now,
      now
    ];

    return new Promise((resolve, reject) => {
        this.db!.run(query, values, function(err: Error | null) {
          if (err) {
            console.error('Error saving slippage alert:', err);
            reject(err);
          } else {
            console.log(`Slippage alert saved for ${alert.symbol} (${alert.direction}): ${alert.severity}`);
            resolve();
          }
        });
      });
  }

  /**
   * 获取高滑点预警历史
   */
  async getSlippageAlerts(options: {
    symbol?: string;
    severity?: string;
    limit?: number;
    offset?: number;
    start_date?: Date;
    end_date?: Date;
  } = {}): Promise<any[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const {
      symbol,
      severity,
      limit = 100,
      offset = 0,
      start_date,
      end_date
    } = options;

    let conditions: string[] = [];
    let values: any[] = [];

    if (symbol) {
      conditions.push('symbol = ?');
      values.push(symbol);
    }

    if (severity) {
      conditions.push('severity = ?');
      values.push(severity);
    }

    if (start_date) {
      conditions.push('created_at >= ?');
      values.push(start_date.toISOString());
    }

    if (end_date) {
      conditions.push('created_at <= ?');
      values.push(end_date.toISOString());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT * FROM slippage_alerts
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    values.push(limit, offset);

    return new Promise((resolve, reject) => {
      this.db!.all(query, values, (err: Error | null, rows: any[]) => {
        if (err) {
          console.error('Error getting slippage alerts:', err);
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.db) {
      return new Promise((resolve, reject) => {
        this.db!.close((err: Error | null) => {
          if (err) {
            console.error('Error closing database:', err);
            reject(err);
          } else {
            console.log('Recommendation database closed');
            this.db = null;
            this.isInitialized = false;
            resolve();
          }
        });
      });
    }
  }

  // 新增：分页与过滤查询执行记录
  async listExecutions(
    filters: {
      symbol?: string;
      event_type?: 'OPEN' | 'CLOSE' | 'REDUCE' | string;
      direction?: 'LONG' | 'SHORT' | string;
      recommendation_id?: string;
      position_id?: string;
      from?: string; // ISO 日期字符串，按 created_at 过滤起始
      to?: string;   // ISO 日期字符串，按 created_at 过滤结束
      min_size?: number;
      max_size?: number;
      ab_group?: string;
      variant?: string;
      experiment_id?: string;
    } = {},
    limit: number = 50,
    offset: number = 0
  ): Promise<{ items: ExecutionRecord[]; count: number }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const whereAliased: string[] = [];
    const args: any[] = [];

    if (filters.symbol) {
      whereAliased.push('e.symbol = ?');
      args.push(filters.symbol);
    }
    if (filters.event_type) {
      whereAliased.push('e.event_type = ?');
      args.push(filters.event_type);
    }
    if (filters.direction) {
      whereAliased.push('e.direction = ?');
      args.push(filters.direction);
    }
    if (filters.recommendation_id) {
      whereAliased.push('e.recommendation_id = ?');
      args.push(filters.recommendation_id);
    }
    if (filters.position_id) {
      whereAliased.push('e.position_id = ?');
      args.push(filters.position_id);
    }
    if (filters.from) {
      whereAliased.push('e.created_at >= ?');
      args.push(filters.from);
    }
    if (filters.to) {
      whereAliased.push('e.created_at <= ?');
      args.push(filters.to);
    }
    if (typeof filters.min_size === 'number') {
      whereAliased.push('e.size >= ?');
      args.push(filters.min_size);
    }
    if (typeof filters.max_size === 'number') {
      whereAliased.push('e.size <= ?');
      args.push(filters.max_size);
    }
    if (filters.ab_group) {
      // 在执行与推荐上都支持过滤
      whereAliased.push('COALESCE(e.ab_group, r.ab_group) = ?');
      args.push(filters.ab_group);
    }
    if (filters.variant) {
      whereAliased.push('COALESCE(e.variant, r.variant) = ?');
      args.push(filters.variant);
    }
    if (filters.experiment_id) {
      whereAliased.push('COALESCE(e.experiment_id, r.experiment_id) = ?');
      args.push(filters.experiment_id);
    }

    const whereSqlAliased = whereAliased.length ? `WHERE ${whereAliased.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) as cnt FROM executions e LEFT JOIN recommendations r ON r.id = e.recommendation_id ${whereSqlAliased}`;
    const listSql = `SELECT e.*, COALESCE(e.ab_group, r.ab_group) AS ab_group, COALESCE(e.variant, r.variant) AS variant, COALESCE(e.experiment_id, r.experiment_id) AS experiment_id FROM executions e LEFT JOIN recommendations r ON r.id = e.recommendation_id ${whereSqlAliased} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`;

    const count = await new Promise<number>((resolve, reject) => {
      this.db!.get(countSql, args, (err: Error | null, row: any) => {
        if (err) return reject(err);
        resolve(Number(row?.cnt ?? 0));
      });
    });

    const items = await new Promise<ExecutionRecord[]>((resolve, reject) => {
      this.db!.all(listSql, [...args, limit, offset], (err: Error | null, rows: any[]) => {
        if (err) return reject(err);
        const mapped = Array.isArray(rows) ? rows.map((r) => this.rowToExecution(r)) : [];
        resolve(mapped);
      });
    });

    return { items, count };
  }

  // 轻量级迁移：确保新增列存在
  // 新增：保存监控快照
  async saveMonitoringSnapshot(s: MonitoringSnapshot): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const sql = `
      INSERT INTO recommendation_monitoring (
        recommendation_id, check_time, current_price,
        unrealized_pnl, unrealized_pnl_percent,
        is_stop_loss_triggered, is_take_profit_triggered,
        extra_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const checkTime = (s.check_time instanceof Date)
      ? s.check_time.toISOString()
      : (s.check_time || new Date().toISOString());
    const params = [
      s.recommendation_id,
      checkTime,
      s.current_price,
      s.unrealized_pnl ?? null,
      s.unrealized_pnl_percent ?? null,
      (s.is_stop_loss_triggered ? 1 : 0),
      (s.is_take_profit_triggered ? 1 : 0),
      s.extra_json ?? null
    ];
    return new Promise<number>((resolve, reject) => {
      this.db!.run(sql, params, function (this: any, err: Error | null) {
        if (err) {
          console.error('Error saving monitoring snapshot:', err);
          reject(err);
        } else {
          resolve(this?.lastID ?? 0);
        }
      });
    });
  }

  // 新增：查询最近的门控（GATED）监控快照，按 id 倒序
  async listGatedMonitoring(
    limit: number = 500,
    offset: number = 0,
    filters?: {
      recommendation_id?: string;
      gid?: string; // alias of recommendation_id
      symbol?: string;
      direction?: 'LONG' | 'SHORT';
      reason?: string;
      stage?: string;
      source?: string;
      timeStart?: string | number | Date; // inclusive
      timeEnd?: string | number | Date;   // inclusive
    }
  ): Promise<Array<{
    id: number;
    recommendation_id: string;
    check_time: string;
    current_price: number;
    gid?: string | null;
    symbol?: string | null;
    direction?: 'LONG' | 'SHORT' | null;
    reason?: string | null;
    stage?: string | null;
    source?: string | null;
  }>> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const cap = Math.max(0, Math.min(Number(limit) || 0, 2000));
    const off = Math.max(0, Number(offset) || 0);

    const where: string[] = [];
    const args: any[] = [];

    // 仅选择 GATED 记录（利用 recommendation_id 前缀 GATED|symbol|dir|ts）
    where.push("recommendation_id LIKE 'GATED|%'");

    const toIso = (v: any): string | undefined => {
      if (v == null) return undefined;
      if (v instanceof Date) return v.toISOString();
      const n = Number(v);
      if (Number.isFinite(n)) return new Date(n).toISOString();
      const d = new Date(String(v));
      if (!isNaN(d.getTime())) return d.toISOString();
      return undefined;
    };

    // 时间范围
    const fromIso = toIso(filters?.timeStart);
    const toIsoStr = toIso(filters?.timeEnd);
    if (fromIso) { where.push('check_time >= ?'); args.push(fromIso); }
    if (toIsoStr) { where.push('check_time <= ?'); args.push(toIsoStr); }

    // 精确或前缀匹配 recommendation_id
    const recId = filters?.recommendation_id || filters?.gid;
    if (recId) {
      where.push('recommendation_id = ?');
      args.push(String(recId));
    } else {
      const sym = filters?.symbol ? String(filters.symbol).toUpperCase() : undefined;
      const dir = filters?.direction && (filters.direction === 'LONG' || filters.direction === 'SHORT') ? filters.direction : undefined;
      if (sym && dir) {
        where.push('recommendation_id LIKE ?');
        args.push(`GATED|${sym}|${dir}|%`);
      } else if (sym) {
        where.push('recommendation_id LIKE ?');
        args.push(`GATED|${sym}|%`);
      } else if (dir) {
        where.push('recommendation_id LIKE ?');
        args.push(`GATED|%|${dir}|%`);
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `SELECT id, recommendation_id, check_time, current_price, extra_json FROM recommendation_monitoring ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`;

    return new Promise((resolve, reject) => {
      this.db!.all(sql, [...args, cap, off], (err: Error | null, rows: any[]) => {
        if (err) return reject(err);
        const items: any[] = [];
        for (const r of rows || []) {
          let ej: any = null;
          try { ej = JSON.parse(r.extra_json || 'null'); } catch { ej = null; }
          const type = ej?.type || ej?.event?.type;
          if (type === 'GATED') {
            const reason = ej?.reason || ej?.event?.reason || null;
            const stage = ej?.stage || ej?.event?.stage || null;
            const source = ej?.source || ej?.event?.source || null;
            const symbol = ej?.symbol || ej?.event?.symbol || null;
            const direction = ej?.direction || ej?.event?.direction || null;
            const gid = ej?.gid || ej?.event?.gid || String(r.recommendation_id || '');

            // JS 层补充过滤（字段在 JSON 中）
            if (filters?.reason && String(filters.reason) !== String(reason)) continue;
            if (filters?.stage && String(filters.stage) !== String(stage)) continue;
            if (filters?.source && String(filters.source) !== String(source)) continue;
            if (filters?.symbol && String(filters.symbol).toUpperCase() !== String(symbol || '').toUpperCase()) continue;
            if (filters?.direction && (direction !== 'LONG' && direction !== 'SHORT' || filters.direction !== direction)) continue;

            items.push({
              id: Number(r.id),
              recommendation_id: String(r.recommendation_id),
              check_time: String(r.check_time),
              current_price: Number(r.current_price),
              gid, symbol, direction, reason, stage, source
            });
          }
        }
        resolve(items);
      });
    });
  }

  async getSlippageThresholds(): Promise<{ symbol: string; timeframe: string; direction: string; threshold: number; last_updated: string; }[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT symbol, timeframe, direction, threshold, last_updated 
        FROM slippage_thresholds 
        ORDER BY symbol, timeframe, direction
      `;
      this.db!.all(sql, (err: Error | null, rows: any[]) => {
        if (err) return reject(err);
        resolve(rows.map(row => ({
          symbol: String(row.symbol),
          timeframe: String(row.timeframe),
          direction: String(row.direction),
          threshold: Number(row.threshold),
          last_updated: String(row.last_updated)
        })));
      });
    });
  }

  async saveSlippageThreshold(symbol: string, timeframe: string, direction: string, threshold: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO slippage_thresholds (symbol, timeframe, direction, threshold, last_updated)
        VALUES (?, ?, ?, ?, datetime('now'))
      `;
      this.db!.run(sql, [symbol, timeframe, direction, threshold], (err: Error | null) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async getSlippageStatisticsLegacy(symbol?: string, timeframe?: string, direction?: string): Promise<SlippageStatistics[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    return new Promise((resolve, reject) => {
      let sql = `
        SELECT symbol, period as timeframe, direction, 
               datetime(created_at) as period_start, datetime(created_at) as period_end,
               avg_slippage_bps as avg_slippage, max_slippage_bps as max_slippage, 
               min_slippage_bps as min_slippage, 0 as std_slippage, 
               total_executions as sample_count, created_at
        FROM slippage_statistics 
        WHERE 1=1
      `;
      const params: any[] = [];
      
      if (symbol) {
        sql += ' AND symbol = ?';
        params.push(symbol);
      }
      if (timeframe) {
        sql += ' AND period = ?';
        params.push(timeframe);
      }
      if (direction) {
        sql += ' AND direction = ?';
        params.push(direction);
      }
      
      sql += ' ORDER BY symbol, period, direction, created_at DESC';
      
      this.db!.all(sql, params, (err: Error | null, rows: any[]) => {
        if (err) return reject(err);
        resolve(rows.map(row => ({
          symbol: String(row.symbol),
          direction: String(row.direction) as 'LONG' | 'SHORT',
          period: String(row.timeframe), // Map timeframe to period
          total_executions: Number(row.sample_count),
          avg_slippage_bps: Number(row.avg_slippage),
          median_slippage_bps: Number(row.avg_slippage), // Approximate with avg
          max_slippage_bps: Number(row.max_slippage),
          min_slippage_bps: Number(row.min_slippage),
          low_slippage_count: 0, // Default values
          medium_slippage_count: 0,
          high_slippage_count: 0,
          extreme_slippage_count: 0,
          avg_total_cost_bps: Number(row.avg_slippage), // Approximate
          avg_fee_bps: 0, // Default
          avg_latency_ms: 0, // Default
          avg_price_difference_bps: Number(row.avg_slippage), // Approximate
          suggested_threshold_adjustment: 0, // Default
          confidence_score: 1.0, // Default
          calculated_at: new Date(row.created_at),
          updated_at: new Date(row.created_at)
        })));
      });
    });
  }

  /**
   * 获取变体统计信息
   */
  async getVariantStatistics(experimentId: string, startDate: Date, endDate: Date): Promise<any[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise<any[]>((resolve, reject) => {
      const sql = `
        SELECT 
          variant,
          COUNT(*) as sample_size,
          SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END) as win_count,
          AVG(pnl_percent) as avg_return,
          AVG(pnl_amount) as avg_pnl,
          AVG(CASE WHEN result = 'WIN' THEN 1.0 ELSE 0.0 END) as win_rate,
          MIN(pnl_percent) as min_return,
          MAX(pnl_percent) as max_return,
          COUNT(CASE WHEN status = 'CLOSED' THEN 1 END) as completed_count
        FROM recommendations 
        WHERE experiment_id = ? 
          AND created_at >= ? 
          AND created_at <= ?
          AND variant IS NOT NULL
        GROUP BY variant
        ORDER BY variant
      `;

      this.db!.all(sql, [experimentId, startDate.toISOString(), endDate.toISOString()], (err: Error | null, rows: any[]) => {
        if (err) {
          reject(err);
          return;
        }

        const results = rows.map(row => ({
          experimentId,
          variant: row.variant,
          sampleSize: Number(row.sample_size),
          winRate: Number(row.win_rate),
          avgReturn: Number(row.avg_return) || 0,
          avgPnL: Number(row.avg_pnl) || 0,
          minReturn: Number(row.min_return) || 0,
          maxReturn: Number(row.max_return) || 0,
          completedCount: Number(row.completed_count),
          statisticalSignificance: Number(row.sample_size) >= 30,
          pValue: 0.05 // Simplified - should be calculated properly
        }));

        resolve(results);
      });
    });
  }

  /**
   * 获取A/B测试报告
   */
  async getABTestReports(options: {
    experimentId?: string;
    startDate: Date;
    endDate: Date;
  }): Promise<any[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const { experimentId, startDate, endDate } = options;
    
    return new Promise<any[]>((resolve, reject) => {
      let sql = `
        SELECT 
          r.experiment_id,
          r.variant,
          r.id as recommendation_id,
          r.symbol,
          r.direction,
          r.status,
          r.result,
          r.pnl_percent,
          r.pnl_amount,
          r.created_at,
          r.closed_at,
          COUNT(e.id) as execution_count,
          AVG(e.slippage_bps) as avg_slippage
        FROM recommendations r
        LEFT JOIN executions e ON r.id = e.recommendation_id
        WHERE r.created_at >= ? 
          AND r.created_at <= ?
          AND r.variant IS NOT NULL
      `;

      const params = [startDate.toISOString(), endDate.toISOString()];

      if (experimentId) {
        sql += ' AND r.experiment_id = ?';
        params.push(experimentId);
      }

      sql += `
        GROUP BY r.id, r.experiment_id, r.variant, r.symbol, r.direction, r.status, r.result, r.pnl_percent, r.pnl_amount, r.created_at, r.closed_at
        ORDER BY r.created_at DESC
      `;

      this.db!.all(sql, params, (err: Error | null, rows: any[]) => {
        if (err) {
          reject(err);
          return;
        }

        // Group by experiment and variant for summary statistics
        const grouped = new Map<string, any[]>();
        
        rows.forEach((row: any) => {
          const key = `${row.experiment_id}:${row.variant}`;
          if (!grouped.has(key)) {
            grouped.set(key, []);
          }
          grouped.get(key)!.push(row);
        });

        const reports = Array.from(grouped.entries()).map(([key, records]) => {
          const [experimentId, variant] = key.split(':');
          const completedRecords = records.filter(r => r.status === 'CLOSED');
          
          const winCount = completedRecords.filter(r => r.result === 'WIN').length;
          const totalPnL = completedRecords.reduce((sum, r) => sum + (r.pnl_amount || 0), 0);
          const totalReturn = completedRecords.reduce((sum, r) => sum + (r.pnl_percent || 0), 0);
          
          const returns = completedRecords.map(r => r.pnl_percent || 0);
          const avgReturn = returns.length > 0 ? totalReturn / returns.length : 0;
          const sharpeRatio = this.calculateSharpeRatio(returns);
          const maxDrawdown = this.calculateMaxDrawdown(returns);

          return {
            experimentId,
            variant,
            sampleSize: records.length,
            completedCount: completedRecords.length,
            winRate: completedRecords.length > 0 ? winCount / completedRecords.length : 0,
            avgReturn,
            avgPnL: completedRecords.length > 0 ? totalPnL / completedRecords.length : 0,
            sharpeRatio,
            maxDrawdown,
            avgSlippage: records.reduce((sum, r) => sum + (r.avg_slippage || 0), 0) / records.length,
            executionCount: records.reduce((sum, r) => sum + (r.execution_count || 0), 0),
            statisticalSignificance: records.length >= 30,
            pValue: 0.05,
            records: records.map(r => ({
              recommendationId: r.recommendation_id,
              symbol: r.symbol,
              direction: r.direction,
              status: r.status,
              result: r.result,
              pnlPercent: r.pnl_percent,
              pnlAmount: r.pnl_amount,
              createdAt: r.created_at,
              closedAt: r.closed_at,
              executionCount: r.execution_count,
              avgSlippage: r.avg_slippage
            }))
          };
        });

        resolve(reports);
      });
    });
  }

  /**
   * 计算夏普比率
   */
  private calculateSharpeRatio(returns: number[]): number {
    if (returns.length === 0) return 0;
    
    const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    return stdDev > 0 ? avgReturn / stdDev : 0;
  }

  /**
   * 计算最大回撤
   */
  private calculateMaxDrawdown(returns: number[]): number {
    if (returns.length === 0) return 0;
    
    let maxDrawdown = 0;
    let peak = returns[0];
    
    for (let i = 1; i < returns.length; i++) {
      if (returns[i] > peak) {
        peak = returns[i];
      }
      
      const drawdown = (peak - returns[i]) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    return maxDrawdown;
  }

  /**
   * 根据实验ID获取推荐记录
   */
  async getRecommendationsByExperiment(experimentId: string, startDate: Date, endDate: Date): Promise<RecommendationRecord[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise<RecommendationRecord[]>((resolve, reject) => {
      const sql = `
        SELECT * FROM recommendations 
        WHERE experiment_id = ? 
          AND created_at >= ? 
          AND created_at <= ?
          AND variant IS NOT NULL
        ORDER BY created_at DESC
      `;

      this.db!.all(sql, [experimentId, startDate.toISOString(), endDate.toISOString()], (err: Error | null, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const recs = rows.map(row => this.rowToRecommendation(row));
          resolve(recs);
        }
      });
    });
  }

  /**
   * 根据实验ID获取执行记录
   */
  async getExecutionsByExperiment(experimentId: string, startDate: Date, endDate: Date): Promise<ExecutionRecord[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise<ExecutionRecord[]>((resolve, reject) => {
      const sql = `
        SELECT e.* FROM executions e
        INNER JOIN recommendations r ON e.recommendation_id = r.id
        WHERE r.experiment_id = ? 
          AND e.created_at >= ? 
          AND e.created_at <= ?
          AND r.variant IS NOT NULL
        ORDER BY e.created_at DESC
      `;

      this.db!.all(sql, [experimentId, startDate.toISOString(), endDate.toISOString()], (err: Error | null, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const executions = rows.map(row => this.rowToExecution(row));
          resolve(executions);
        }
      });
    });
  }

  private async migrateSchema(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    await new Promise<void>((resolve, reject) => {
      this.db!.all("PRAGMA table_info(ml_samples)", [], (err: Error | null, rows: any[]) => {
        if (err) {
          return reject(err);
        }
        const hasCalibrated = Array.isArray(rows) && rows.some((r: any) => r.name === 'ml_calibrated_confidence');
        if (!hasCalibrated) {
          this.db!.run("ALTER TABLE ml_samples ADD COLUMN ml_calibrated_confidence REAL", (alterErr: Error | null) => {
            if (alterErr) {
              console.error('Error migrating ml_samples schema:', alterErr);
              return reject(alterErr);
            }
          });
        }
        // 新增：为 recommendations 增加 exit_label 列，并进行一次性回填（幂等）
        this.db!.all("PRAGMA table_info(recommendations)", [], (err2: Error | null,  recRows: any[]) => {
          if (err2) {
            return reject(err2);
          }
          const hasExitLabel = Array.isArray(recRows) && recRows.some((r: any) => r.name === 'exit_label');
          const hasDedupeKey = Array.isArray(recRows) && recRows.some((r: any) => r.name === 'dedupe_key');
          const doBackfill = () => {
            const backfillSql = `
              UPDATE recommendations
              SET exit_label = CASE
                WHEN exit_reason = 'TIMEOUT' THEN 'TIMEOUT'
                WHEN exit_reason = 'BREAKEVEN' OR result = 'BREAKEVEN' THEN 'BREAKEVEN'
                WHEN result = 'WIN' THEN 'DYNAMIC_TAKE_PROFIT'
                WHEN result = 'LOSS' THEN 'DYNAMIC_STOP_LOSS'
                WHEN pnl_percent IS NOT NULL AND pnl_percent > 0.1 THEN 'DYNAMIC_TAKE_PROFIT'
                WHEN pnl_percent IS NOT NULL AND pnl_percent < -0.1 THEN 'DYNAMIC_STOP_LOSS'
                ELSE 'BREAKEVEN'
              END
              WHERE exit_label IS NULL AND (status = 'CLOSED' OR status = 'EXPIRED' OR result IS NOT NULL OR exit_reason IS NOT NULL)
            `;
            this.db!.run(backfillSql, (bfErr: Error | null) => {
              if (bfErr) {
                console.error('Error backfilling exit_label:', bfErr);
                // 回填失败不应阻断初始化，打印警告后继续
              }
              // Ensure recommendation_monitoring has extra_json column (idempotent)
              this.db!.all("PRAGMA table_info(recommendation_monitoring)", [], (mErr: Error | null, mRows: any[]) => {
                if (mErr) {
                  console.warn('Failed to inspect recommendation_monitoring schema (non-fatal):', mErr);
                  return resolve();
                }
                const hasExtra = Array.isArray(mRows) && mRows.some((r: any) => r.name === 'extra_json');
                const afterMonitoring = () => {
                  this.db!.all("PRAGMA table_info(recommendations)", [], (err3: Error | null,  recRows2: any[]) => {
                    if (err3) {
                      console.warn('Failed to inspect recommendations schema for EV columns (non-fatal):', err3);
                      return resolve();
                    }
                    const hasExpected = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'expected_return');
                    const hasEv = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'ev');
                    const hasEvTh = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'ev_threshold');
                    const hasEvOk = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'ev_ok');
                    const hasAB = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'ab_group');
                    const hasExtraJson = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'extra_json');
                    
                    // ATR动态止损相关字段
                    const hasAtrValue = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'atr_value');
                    const hasAtrPeriod = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'atr_period');
                    const hasAtrSlMultiplier = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'atr_sl_multiplier');
                    const hasAtrTpMultiplier = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'atr_tp_multiplier');
                    
                    // 分批止盈状态字段
                    const hasTp1Hit = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'tp1_hit');
                    const hasTp2Hit = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'tp2_hit');
                    const hasTp3Hit = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'tp3_hit');
                    const hasReductionCount = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'reduction_count');
                    const hasReductionRatio = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'reduction_ratio');
                    
                    // 实验相关字段
                    const hasExperimentId = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'experiment_id');
                    const hasVariant = Array.isArray(recRows2) && recRows2.some((r: any) => r.name === 'variant');
                    
                    // 在执行 recommendations 迁移完成后，继续执行 executions 的列迁移
                    const migrateExecutionsThenResolve = () => {
                      this.db!.all("PRAGMA table_info(executions)", [], (eErr: Error | null, eRows: any[]) => {
                        if (eErr) {
                          console.warn('Failed to inspect executions schema (non-fatal):', eErr);
                          return resolve();
                        }
                        const hasExeVariant = Array.isArray(eRows) && eRows.some((r: any) => r.name === 'variant');
                        const hasExeAbGroup = Array.isArray(eRows) && eRows.some((r: any) => r.name === 'ab_group');
                        const hasExeExperimentId = Array.isArray(eRows) && eRows.some((r: any) => r.name === 'experiment_id');
                        const exeAlters: string[] = [];
                        if (!hasExeVariant) exeAlters.push("ALTER TABLE executions ADD COLUMN variant TEXT");
                        if (!hasExeAbGroup) exeAlters.push("ALTER TABLE executions ADD COLUMN ab_group TEXT");
                        if (!hasExeExperimentId) exeAlters.push("ALTER TABLE executions ADD COLUMN experiment_id TEXT");
                        if (exeAlters.length === 0) return resolve();
                        const runExe = (i: number) => {
                          if (i >= exeAlters.length) return resolve();
                          this.db!.run(exeAlters[i], (eaErr: Error | null) => {
                            if (eaErr) {
                              console.warn('Executions schema migrate step failed (非致命):', exeAlters[i], eaErr);
                            }
                            runExe(i + 1);
                          });
                        };
                        runExe(0);
                      });
                    };

                    const alters: string[] = [];
                    if (!hasExpected) alters.push("ALTER TABLE recommendations ADD COLUMN expected_return REAL");
                    if (!hasEv) alters.push("ALTER TABLE recommendations ADD COLUMN ev REAL");
                    if (!hasEvTh) alters.push("ALTER TABLE recommendations ADD COLUMN ev_threshold REAL");
                    if (!hasEvOk) alters.push("ALTER TABLE recommendations ADD COLUMN ev_ok INTEGER");
                    if (!hasAB) alters.push("ALTER TABLE recommendations ADD COLUMN ab_group TEXT");
                    if (!hasExtraJson) alters.push("ALTER TABLE recommendations ADD COLUMN extra_json TEXT");
                    
                    // ATR动态止损相关字段
                    if (!hasAtrValue) alters.push("ALTER TABLE recommendations ADD COLUMN atr_value REAL");
                    if (!hasAtrPeriod) alters.push("ALTER TABLE recommendations ADD COLUMN atr_period INTEGER");
                    if (!hasAtrSlMultiplier) alters.push("ALTER TABLE recommendations ADD COLUMN atr_sl_multiplier REAL");
                    if (!hasAtrTpMultiplier) alters.push("ALTER TABLE recommendations ADD COLUMN atr_tp_multiplier REAL");
                    
                    // 分批止盈状态字段
                    if (!hasTp1Hit) alters.push("ALTER TABLE recommendations ADD COLUMN tp1_hit INTEGER DEFAULT 0");
                    if (!hasTp2Hit) alters.push("ALTER TABLE recommendations ADD COLUMN tp2_hit INTEGER DEFAULT 0");
                    if (!hasTp3Hit) alters.push("ALTER TABLE recommendations ADD COLUMN tp3_hit INTEGER DEFAULT 0");
                    if (!hasReductionCount) alters.push("ALTER TABLE recommendations ADD COLUMN reduction_count INTEGER DEFAULT 0");
                    if (!hasReductionRatio) alters.push("ALTER TABLE recommendations ADD COLUMN reduction_ratio REAL");
                    
                    // 实验相关字段
                    if (!hasExperimentId) alters.push("ALTER TABLE recommendations ADD COLUMN experiment_id TEXT");
                    if (!hasVariant) alters.push("ALTER TABLE recommendations ADD COLUMN variant TEXT");
                    if (alters.length === 0) return migrateExecutionsThenResolve();
                    const runNext = (i: number) => {
                      if (i >= alters.length) return migrateExecutionsThenResolve();
                      this.db!.run(alters[i], (aErr: Error | null) => {
                        if (aErr) {
                          console.warn('EV schema migrate step failed (non-fatal):', alters[i], aErr);
                        }
                        runNext(i + 1);
                      });
                    };
                    runNext(0);
                  });
                };
                if (!hasExtra) {
                  this.db!.run("ALTER TABLE recommendation_monitoring ADD COLUMN extra_json TEXT", (alterErr: Error | null) => {
                    if (alterErr) {
                      console.warn('Error migrating recommendation_monitoring schema (add extra_json):', alterErr);
                    }
                    afterMonitoring();
                  });
                } else {
                  afterMonitoring();
                }
              });
            });
          };

          const ensureUniqueIndex = () => {
            // 幂等创建唯一索引
            this.db!.run("CREATE UNIQUE INDEX IF NOT EXISTS ux_recommendations_dedupe_key ON recommendations(dedupe_key)", (idxErr: Error | null) => {
              if (idxErr) {
                console.warn('Create unique index for dedupe_key failed (non-fatal):', idxErr);
              }
              // 继续执行 backfill 流程
              if (hasExitLabel) return doBackfill();
              this.db!.run("ALTER TABLE recommendations ADD COLUMN exit_label TEXT", (alterErr2: Error | null) => {
                if (alterErr2) {
                  console.error('Error migrating recommendations schema (add exit_label):', alterErr2);
                  return reject(alterErr2);
                }
                doBackfill();
              });
            });
          };

          if (!hasDedupeKey) {
            this.db!.run("ALTER TABLE recommendations ADD COLUMN dedupe_key TEXT", (alterErr3: Error | null) => {
              if (alterErr3) {
                console.error('Error migrating recommendations schema (add dedupe_key):', alterErr3);                // 不中断，可能已经存在或 SQLite 版本不支持部分场景
              }
              ensureUniqueIndex();
            });
          } else {
            ensureUniqueIndex();
          }
        });
      });
    });
  }

  // Decision Chain Database Methods
  async createDecisionChainTable(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    return new Promise<void>((resolve, reject) => {
      this.db!.run(`
        CREATE TABLE IF NOT EXISTS decision_chains (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chain_id TEXT UNIQUE NOT NULL,
          symbol TEXT NOT NULL,
          direction TEXT NOT NULL,
          status TEXT NOT NULL,
          start_time INTEGER NOT NULL,
          end_time INTEGER,
          final_decision TEXT,
          rejection_reason TEXT,
          rejection_stage TEXT,
          steps_json TEXT NOT NULL,
          metrics_json TEXT,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `, (err: Error | null) => {
        if (err) {
          console.error('Error creating decision_chains table:', err);
          reject(err);
        } else {
          // Create indexes for efficient querying
          this.db!.run('CREATE INDEX IF NOT EXISTS idx_decision_chains_symbol ON decision_chains(symbol)', () => {});
          this.db!.run('CREATE INDEX IF NOT EXISTS idx_decision_chains_status ON decision_chains(status)', () => {});
          this.db!.run('CREATE INDEX IF NOT EXISTS idx_decision_chains_time ON decision_chains(start_time)', () => {});
          this.db!.run('CREATE INDEX IF NOT EXISTS idx_decision_chains_rejection ON decision_chains(rejection_stage, rejection_reason)', () => {});
          resolve();
        }
      });
    });
  }

  async saveDecisionChain(chain: any): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise<void>((resolve, reject) => {
      const stmt = this.db!.prepare(`
        INSERT OR REPLACE INTO decision_chains 
        (chain_id, symbol, direction, status, start_time, end_time, final_decision, 
         rejection_reason, rejection_stage, steps_json, metrics_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run([
        chain.chainId,
        chain.symbol,
        chain.direction,
        chain.status,
        chain.startTime,
        chain.endTime || null,
        chain.finalDecision || null,
        chain.rejectionReason || null,
        chain.rejectionStage || null,
        JSON.stringify(chain.steps),
        chain.metrics ? JSON.stringify(chain.metrics) : null
      ], (err: Error | null) => {
        stmt.finalize();
        if (err) {
          console.error('Error saving decision chain:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async getDecisionChain(chainId: string): Promise<any> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise<any>((resolve, reject) => {
      this.db!.get(
        'SELECT * FROM decision_chains WHERE chain_id = ?',
        [chainId],
        (err: Error | null, row: any) => {
          if (err) {
            console.error('Error getting decision chain:', err);
            reject(err);
          } else if (row) {
            resolve({
              ...row,
              steps: JSON.parse(row.steps_json),
              metrics: row.metrics_json ? JSON.parse(row.metrics_json) : null
            });
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  async queryDecisionChains(filters: any): Promise<any[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise<any[]>((resolve, reject) => {
      let sql = 'SELECT * FROM decision_chains WHERE 1=1';
      const params: any[] = [];

      if (filters.symbol) {
        sql += ' AND symbol = ?';
        params.push(filters.symbol);
      }
      if (filters.direction) {
        sql += ' AND direction = ?';
        params.push(filters.direction);
      }
      if (filters.status) {
        sql += ' AND status = ?';
        params.push(filters.status);
      }
      if (filters.rejectionStage) {
        sql += ' AND rejection_stage = ?';
        params.push(filters.rejectionStage);
      }
      if (filters.rejectionReason) {
        sql += ' AND rejection_reason = ?';
        params.push(filters.rejectionReason);
      }
      if (filters.startTimeFrom) {
        sql += ' AND start_time >= ?';
        params.push(filters.startTimeFrom);
      }
      if (filters.startTimeTo) {
        sql += ' AND start_time <= ?';
        params.push(filters.startTimeTo);
      }

      sql += ' ORDER BY start_time DESC';
      if (filters.limit) {
        sql += ' LIMIT ?';
        params.push(filters.limit);
      }

      this.db!.all(sql, params, (err: Error | null, rows: any[]) => {
        if (err) {
          console.error('Error querying decision chains:', err);
          reject(err);
        } else {
          resolve(rows.map(row => ({
            ...row,
            steps: JSON.parse(row.steps_json),
            metrics: row.metrics_json ? JSON.parse(row.metrics_json) : null
          })));
        }
      });
    });
  }

  async getDecisionChainMetrics(filters: any): Promise<any> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise<any>((resolve, reject) => {
      let sql = `
        SELECT 
          COUNT(*) as total_count,
          COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as approved_count,
          COUNT(CASE WHEN status = 'REJECTED' THEN 1 END) as rejected_count,
          COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending_count,
          rejection_stage,
          rejection_reason,
          COUNT(*) as stage_count
        FROM decision_chains
        WHERE 1=1
      `;
      const params: any[] = [];

      if (filters.symbol) {
        sql += ' AND symbol = ?';
        params.push(filters.symbol);
      }
      if (filters.direction) {
        sql += ' AND direction = ?';
        params.push(filters.direction);
      }
      if (filters.startTimeFrom) {
        sql += ' AND start_time >= ?';
        params.push(filters.startTimeFrom);
      }
      if (filters.startTimeTo) {
        sql += ' AND start_time <= ?';
        params.push(filters.startTimeTo);
      }

      sql += ' GROUP BY rejection_stage, rejection_reason ORDER BY stage_count DESC';

      this.db!.all(sql, params, (err: Error | null, rows: any[]) => {
        if (err) {
          console.error('Error getting decision chain metrics:', err);
          reject(err);
        } else {
          const summary = {
            total: 0,
            approved: 0,
            rejected: 0,
            pending: 0,
            rejectionBreakdown: [] as any[]
          };

          rows.forEach((row: any) => {
            summary.total += row.total_count;
            summary.approved += row.approved_count;
            summary.rejected += row.rejected_count;
            summary.pending += row.pending_count;
            
            if (row.rejection_stage) {
              summary.rejectionBreakdown.push({
                stage: row.rejection_stage,
                reason: row.rejection_reason,
                count: row.stage_count
              });
            }
          });

          resolve(summary);
        }
      });
    });
  }

  /**
   * 兼容 DecisionChainMonitor 接口的 save 方法
   * 将数据保存为决策链格式
   */
  async save(key: string, data: any): Promise<void> {
    if (key.startsWith('chain:')) {
      // 如果是决策链数据，使用 saveDecisionChain 方法
      const chainId = key.replace('chain:', '');
      return this.saveDecisionChain({
        ...data,
        chainId: data.chainId || chainId
      });
    } else {
      // 其他数据暂时不支持，抛出错误
      throw new Error(`Unsupported key format for save: ${key}`);
    }
  }

  /**
   * 兼容 DecisionChainMonitor 接口的 get 方法
   * 获取决策链数据
   */
  async get(key: string): Promise<any | null> {
    if (key.startsWith('chain:')) {
      // 如果是决策链数据，使用 getDecisionChain 方法
      const chainId = key.replace('chain:', '');
      return this.getDecisionChain(chainId);
    } else {
      // 其他数据暂时不支持，返回 null
      return null;
    }
  }
}

// ... 导出数据库单例，供全局复用
export const recommendationDatabase = new RecommendationDatabase();
