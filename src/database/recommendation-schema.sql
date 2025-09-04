-- 推荐记录数据库表结构设计
-- 用于存储机器学习和策略分析的推荐数据

-- 主推荐记录表
CREATE TABLE recommendations (
    id VARCHAR(36) PRIMARY KEY,                    -- UUID推荐ID
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 更新时间
    
    -- 基础推荐信息
    symbol VARCHAR(20) NOT NULL,                   -- 交易对 (ETH-USDT-SWAP)
    direction VARCHAR(10) NOT NULL,                -- 方向 (LONG/SHORT)
    entry_price DECIMAL(18,8) NOT NULL,           -- 推荐入场价格
    current_price DECIMAL(18,8) NOT NULL,         -- 推荐时当前价格
    
    -- 止损止盈设置
    stop_loss_price DECIMAL(18,8),                -- 止损价格
    take_profit_price DECIMAL(18,8),              -- 止盈价格
    stop_loss_percent DECIMAL(5,4),               -- 止损百分比
    take_profit_percent DECIMAL(5,4),             -- 止盈百分比
    liquidation_price DECIMAL(18,8),              -- 爆仓价格
    margin_ratio DECIMAL(5,4),                    -- 保证金比率
    maintenance_margin DECIMAL(18,8),             -- 维持保证金
    
    -- 杠杆和仓位
    leverage INTEGER NOT NULL,                     -- 推荐杠杆倍数
    position_size DECIMAL(18,8),                  -- 推荐仓位大小
    risk_level VARCHAR(20),                       -- 风险等级
    
    -- 策略信息
    strategy_type VARCHAR(50) NOT NULL,           -- 策略类型
    algorithm_name VARCHAR(100),                  -- 算法名称
    signal_strength DECIMAL(5,4),                -- 信号强度 (0-1)
    confidence_score DECIMAL(5,4),               -- 置信度分数
    quality_score DECIMAL(5,4),                  -- 质量分数
    
    -- 推荐结果状态
    status VARCHAR(20) DEFAULT 'PENDING',         -- PENDING/ACTIVE/CLOSED/EXPIRED
    result VARCHAR(20),                           -- WIN/LOSS/BREAKEVEN
    exit_price DECIMAL(18,8),                     -- 理论出场价格
    exit_time TIMESTAMP,                          -- 出场时间
    exit_reason VARCHAR(50),                      -- 出场原因 (TAKE_PROFIT/STOP_LOSS/TIMEOUT)
    
    -- 理论收益统计 (基于推荐价格计算)
    pnl_amount DECIMAL(18,8),                     -- 理论盈亏金额
    pnl_percent DECIMAL(8,4),                     -- 理论盈亏百分比
    holding_duration INTEGER,                     -- 理论持仓时长(分钟)
    
    -- 市场环境数据
    market_volatility DECIMAL(8,4),              -- 市场波动率
    volume_24h DECIMAL(18,2),                    -- 24小时成交量
    price_change_24h DECIMAL(8,4),               -- 24小时价格变化
    
    -- 技术指标快照
    rsi_value DECIMAL(5,2),                       -- RSI值
    macd_value DECIMAL(10,6),                     -- MACD值
    boll_position DECIMAL(5,4),                   -- 布林带位置
    ma_trend VARCHAR(10),                         -- 均线趋势
    
    -- ML模型相关
    model_version VARCHAR(20),                    -- 模型版本
    feature_vector TEXT,                          -- 特征向量JSON
    prediction_probability DECIMAL(5,4),         -- 预测概率
    
    -- 元数据
    source VARCHAR(50) DEFAULT 'STRATEGY_AUTO',   -- 推荐来源 (STRATEGY_AUTO/USER_MANUAL)
    is_strategy_generated BOOLEAN DEFAULT TRUE,   -- 是否为策略自动生成
    strategy_confidence_level VARCHAR(20),        -- 策略置信等级
    exclude_from_ml BOOLEAN DEFAULT FALSE,        -- 是否排除ML训练
    notes TEXT,                                   -- 备注
    
    INDEX idx_created_at (created_at),
    INDEX idx_symbol_status (symbol, status),
    INDEX idx_strategy_result (strategy_type, result),
    INDEX idx_model_version (model_version)
);

-- 策略表现统计表
CREATE TABLE strategy_performance (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    strategy_type VARCHAR(50) NOT NULL,
    date_period DATE NOT NULL,                    -- 统计日期
    
    total_recommendations INTEGER DEFAULT 0,      -- 总推荐数
    win_count INTEGER DEFAULT 0,                  -- 胜利次数
    loss_count INTEGER DEFAULT 0,                 -- 失败次数
    breakeven_count INTEGER DEFAULT 0,            -- 平局次数
    
    win_rate DECIMAL(5,4),                       -- 胜率
    avg_pnl_percent DECIMAL(8,4),                -- 平均盈亏百分比
    max_profit DECIMAL(8,4),                     -- 最大盈利
    max_loss DECIMAL(8,4),                       -- 最大亏损
    avg_holding_duration INTEGER,                -- 平均持仓时长
    
    sharpe_ratio DECIMAL(6,4),                   -- 夏普比率
    max_drawdown DECIMAL(8,4),                   -- 最大回撤
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_strategy_date (strategy_type, date_period),
    INDEX idx_date_period (date_period)
);

-- ML模型训练记录表
CREATE TABLE ml_training_logs (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    model_version VARCHAR(20) NOT NULL,
    training_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 训练数据统计
    training_samples INTEGER,                     -- 训练样本数
    validation_samples INTEGER,                   -- 验证样本数
    feature_count INTEGER,                        -- 特征数量
    
    -- 模型性能指标
    accuracy DECIMAL(5,4),                       -- 准确率
    precision_score DECIMAL(5,4),                -- 精确率
    recall_score DECIMAL(5,4),                   -- 召回率
    f1_score DECIMAL(5,4),                       -- F1分数
    auc_score DECIMAL(5,4),                      -- AUC分数
    
    -- 训练参数
    hyperparameters TEXT,                         -- 超参数JSON
    training_duration INTEGER,                    -- 训练时长(秒)
    
    -- 部署状态
    is_deployed BOOLEAN DEFAULT FALSE,            -- 是否已部署
    deployment_date TIMESTAMP,                    -- 部署时间
    
    notes TEXT,
    
    INDEX idx_model_version (model_version),
    INDEX idx_training_date (training_date)
);

-- 特征重要性表
CREATE TABLE feature_importance (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    model_version VARCHAR(20) NOT NULL,
    feature_name VARCHAR(100) NOT NULL,
    importance_score DECIMAL(8,6),               -- 重要性分数
    rank_position INTEGER,                        -- 排名位置
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_model_feature (model_version, feature_name),
    INDEX idx_importance (importance_score DESC)
);

-- 实时监控表
CREATE TABLE recommendation_monitoring (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    recommendation_id VARCHAR(36) NOT NULL,
    check_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    current_price DECIMAL(18,8) NOT NULL,        -- 检查时价格
    unrealized_pnl DECIMAL(18,8),                -- 未实现盈亏
    unrealized_pnl_percent DECIMAL(8,4),         -- 未实现盈亏百分比
    
    is_stop_loss_triggered BOOLEAN DEFAULT FALSE, -- 是否触发止损
    is_take_profit_triggered BOOLEAN DEFAULT FALSE, -- 是否触发止盈
    
    FOREIGN KEY (recommendation_id) REFERENCES recommendations(id),
    INDEX idx_recommendation_time (recommendation_id, check_time)
);