import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { RecommendationRecord } from './recommendation-tracker';

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
  // 来自 recommendations 的 AB 分组（查询结果派生字段）
  ab_group?: string | undefined;
  extra_json?: string | null; // 额外上下文（如 reason/reductionRatio 等）
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
  private db: sqlite3.Database | null = null;
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
      
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('Error opening database:', err);
          throw err;
        }
      });
      
      // 增加 busyTimeout 与 WAL，以提升并发读能力，避免读训练时被写阻塞
      try {
        // 某些类型定义无该方法，使用 any 断言
        (this.db as any)?.configure?.('busyTimeout', 10000);
      } catch (e) {
        console.warn('Warn: set busyTimeout failed (ignored):', e);
      }
      await new Promise<void>((resolve, reject) => {
        this.db!.run('PRAGMA journal_mode=WAL;', [], (err) => err ? reject(err) : resolve());
      });
      await new Promise<void>((resolve, reject) => {
        this.db!.run('PRAGMA synchronous=NORMAL;', [], (err) => err ? reject(err) : resolve());
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
      'CREATE INDEX IF NOT EXISTS idx_monitoring_rec_time ON recommendation_monitoring(recommendation_id, check_time)'
    ];
    
    return new Promise((resolve, reject) => {
      this.db!.serialize(() => {
        // 创建主表
        this.db!.run(createRecommendationsTable, (err) => {
          if (err) {
            console.error('Error creating recommendations table:', err);
            reject(err);
            return;
          }
        });
        
        // 创建统计表
        this.db!.run(createStatisticsTable, (err) => {
          if (err) {
            console.error('Error creating statistics table:', err);
            reject(err);
            return;
          }
        });

        // 创建 ML 样本表
        this.db!.run(createMLSamplesTable, (err) => {
          if (err) {
            console.error('Error creating ml_samples table:', err);
            reject(err);
            return;
          }
        });

        // 创建 executions 表
        this.db!.run(createExecutionsTable, (err) => {
          if (err) {
            console.error('Error creating executions table:', err);
            reject(err);
            return;
          }
        });

        // 创建 monitoring 表
        this.db!.run(createMonitoringTable, (err) => {
          if (err) {
            console.error('Error creating recommendation_monitoring table:', err);
            reject(err);
            return;
          }
        });
        
        // 创建索引
        let indexCount = 0;
        createIndexes.forEach(indexSql => {
          this.db!.run(indexSql, (err) => {
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
        expected_return, ev, ev_threshold, ev_ok, ab_group,
        exit_label, dedupe_key, extra_json
      ) VALUES (
        ${new Array(39).fill('?').join(', ')}
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
      rec.exit_label || null,
      rec.dedupe_key || null,
      (rec as any).extra_json ?? null
    ];
    
    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function(err) {
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
        holding_duration = ?
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
      rec.id
    ];
    
    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function(err) {
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
      this.db!.get(sql, [id], (err, row: any) => {
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
      this.db!.all(sql, [], (err, rows: any[]) => {
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
      this.db!.get(sql, symList, (err, row: any) => {
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
      this.db!.get(sql, params, (err, row: any) => {
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
      this.db!.get(sql, params, (err, row: any) => {
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
      this.db!.run(sql, [id], function (this: any, err: any) {
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
      this.db!.get('SELECT COUNT(*) as total FROM recommendations', [], (err, row: any) => {
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
        this.db!.run(deleteSql, [safeKeep], function (this: any, err: any) {
          if (err) return reject(err);
          resolve(this?.changes ?? 0);
        });
      });

      // 回收空间
      await new Promise<void>((resolve, reject) => {
        this.db!.exec('VACUUM', (err) => (err ? reject(err) : resolve()));
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
      this.db!.get(countSql, params, (err, row: any) => {
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
      this.db!.all(dataSql, [...params, limit, offset], (err, rows: any[]) => {
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
      this.db!.get(sql, params, (err: any, row: any) => {
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
      this.db!.get(sql, params, (err, row: any) => {
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
      this.db!.all(sql, [horizonMinutes, nowMs, limit], (err, rows: any[]) => {
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
      this.db!.get(countSql, params, (err, row: any) => {
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
      this.db!.all(dataSql, [...params, limit, offset], (err, rows: any[]) => {
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
      // 新增：dedupe_key 回传
      dedupe_key: row.dedupe_key || undefined,
      // 新增：extra_json 回传
      extra_json: row.extra_json || undefined
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
        slippage_bps, slippage_amount, fee_bps, fee_amount, pnl_amount, pnl_percent, extra_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?
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
      ab_group: row.ab_group || undefined,
      extra_json: row.extra_json ?? null
    };
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
      this.db!.all(sql, [], (err, rows: any[]) => {
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
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.db) {
      return new Promise((resolve, reject) => {
        this.db!.close((err) => {
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
    } = {},
    limit: number = 50,
    offset: number = 0
  ): Promise<{ items: ExecutionRecord[]; count: number }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const whereAliased: string[] = [];
    const wherePlain: string[] = [];
    const args: any[] = [];

    if (filters.symbol) {
      whereAliased.push('e.symbol = ?');
      wherePlain.push('symbol = ?');
      args.push(filters.symbol);
    }
    if (filters.event_type) {
      whereAliased.push('e.event_type = ?');
      wherePlain.push('event_type = ?');
      args.push(filters.event_type);
    }
    if (filters.direction) {
      whereAliased.push('e.direction = ?');
      wherePlain.push('direction = ?');
      args.push(filters.direction);
    }
    if (filters.recommendation_id) {
      whereAliased.push('e.recommendation_id = ?');
      wherePlain.push('recommendation_id = ?');
      args.push(filters.recommendation_id);
    }
    if (filters.position_id) {
      whereAliased.push('e.position_id = ?');
      wherePlain.push('position_id = ?');
      args.push(filters.position_id);
    }
    if (filters.from) {
      whereAliased.push('e.created_at >= ?');
      wherePlain.push('created_at >= ?');
      args.push(filters.from);
    }
    if (filters.to) {
      whereAliased.push('e.created_at <= ?');
      wherePlain.push('created_at <= ?');
      args.push(filters.to);
    }
    if (typeof filters.min_size === 'number') {
      whereAliased.push('e.size >= ?');
      wherePlain.push('size >= ?');
      args.push(filters.min_size);
    }
    if (typeof filters.max_size === 'number') {
      whereAliased.push('e.size <= ?');
      wherePlain.push('size <= ?');
      args.push(filters.max_size);
    }
    if (filters.ab_group) {
      whereAliased.push('r.ab_group = ?');
      // plain 模式下无 ab_group 列，保持不加条件
      args.push(filters.ab_group);
    }

    const whereSqlAliased = whereAliased.length ? `WHERE ${whereAliased.join(' AND ')}` : '';
    const whereSqlPlain = wherePlain.length ? `WHERE ${wherePlain.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) as cnt FROM executions e LEFT JOIN recommendations r ON r.id = e.recommendation_id ${whereSqlAliased || whereSqlPlain}`;
    const listSql = `SELECT e.*, r.ab_group AS ab_group FROM executions e LEFT JOIN recommendations r ON r.id = e.recommendation_id ${whereSqlAliased} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`;

    const count = await new Promise<number>((resolve, reject) => {
      this.db!.get(countSql, args, (err, row: any) => {
        if (err) return reject(err);
        resolve(Number(row?.cnt ?? 0));
      });
    });

    const items = await new Promise<ExecutionRecord[]>((resolve, reject) => {
      this.db!.all(listSql, [...args, limit, offset], (err, rows: any[]) => {
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
      this.db!.run(sql, params, function(this: any, err: any) {
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
      this.db!.all(sql, [...args, cap, off], (err, rows: any[]) => {
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

  private async migrateSchema(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    await new Promise<void>((resolve, reject) => {
      this.db!.all("PRAGMA table_info(ml_samples)", [], (err, rows: any[]) => {
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
        this.db!.all("PRAGMA table_info(recommendations)", [], (err2, recRows: any[]) => {
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
              this.db!.all("PRAGMA table_info(recommendation_monitoring)", [], (mErr, mRows: any[]) => {
                if (mErr) {
                  console.warn('Failed to inspect recommendation_monitoring schema (non-fatal):', mErr);
                  return resolve();
                }
                const hasExtra = Array.isArray(mRows) && mRows.some((r: any) => r.name === 'extra_json');
                const afterMonitoring = () => {
                  this.db!.all("PRAGMA table_info(recommendations)", [], (err3, recRows2: any[]) => {
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
                    const alters: string[] = [];
                    if (!hasExpected) alters.push("ALTER TABLE recommendations ADD COLUMN expected_return REAL");
                    if (!hasEv) alters.push("ALTER TABLE recommendations ADD COLUMN ev REAL");
                    if (!hasEvTh) alters.push("ALTER TABLE recommendations ADD COLUMN ev_threshold REAL");
                    if (!hasEvOk) alters.push("ALTER TABLE recommendations ADD COLUMN ev_ok INTEGER");
                    if (!hasAB) alters.push("ALTER TABLE recommendations ADD COLUMN ab_group TEXT");
                    if (!hasExtraJson) alters.push("ALTER TABLE recommendations ADD COLUMN extra_json TEXT");
                    if (alters.length === 0) return resolve();
                    const runNext = (i: number) => {
                      if (i >= alters.length) return resolve();
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
}

// ... 导出数据库单例，供全局复用
export const recommendationDatabase = new RecommendationDatabase();
