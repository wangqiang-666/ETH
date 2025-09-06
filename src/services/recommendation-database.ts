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
      
      // 创建表结构
      await this.createTables();
      
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
        exit_reason TEXT CHECK (exit_reason IN ('TAKE_PROFIT', 'STOP_LOSS', 'TIMEOUT', 'LIQUIDATION')),
        
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
        notes TEXT
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
    
    const createIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_recommendations_status ON recommendations(status)',
      'CREATE INDEX IF NOT EXISTS idx_recommendations_strategy ON recommendations(strategy_type)',
      'CREATE INDEX IF NOT EXISTS idx_recommendations_created ON recommendations(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_recommendations_symbol ON recommendations(symbol)',
      'CREATE INDEX IF NOT EXISTS idx_statistics_strategy_date ON strategy_statistics(strategy_type, date)',
      // 新增：ml_samples 索引
      'CREATE INDEX IF NOT EXISTS idx_ml_samples_symbol_time ON ml_samples(symbol, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_ml_samples_label_ready ON ml_samples(label_ready)',
      'CREATE INDEX IF NOT EXISTS idx_ml_samples_prediction ON ml_samples(ml_prediction)'
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
        source, is_strategy_generated, strategy_confidence_level, exclude_from_ml, notes
      ) VALUES (
        ${new Array(31).fill('?').join(', ')}
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
      rec.source, rec.is_strategy_generated, rec.strategy_confidence_level, rec.exclude_from_ml, rec.notes
    ];
    
    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function(err) {
        if (err) {
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
    
    const sql = `
      SELECT * FROM recommendations 
      WHERE status = 'ACTIVE' 
      ORDER BY created_at DESC
    `;
    
    return new Promise((resolve, reject) => {
      this.db!.all(sql, [], (err, rows: any[]) => {
        if (err) {
          console.error('Error querying active recommendations:', err);
          reject(err);
        } else {
          const recommendations = rows.map(row => this.rowToRecommendation(row));
          resolve(recommendations);
        }
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
    }
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
        ml_prediction, ml_confidence, ml_scores_json,
        technical_strength, combined_strength, final_signal, position_size,
        target_price, stop_loss, take_profit, risk_reward,
        reasoning_ml, reasoning_final,
        label_horizon_min, label_return, label_drawdown, label_ready
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
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
      notes: row.notes
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
}

// ... 导出数据库单例，供全局复用
export const recommendationDatabase = new RecommendationDatabase();