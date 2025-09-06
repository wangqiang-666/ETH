# ETH合约策略分析系统

🚀 专注 ETH 合约做多/做空的短期（1H）高胜率策略平台，集成机器学习大模型的智能分析

系统主要提供：围绕 ETH 合约在 1 小时周期（1H）上的高胜率策略与交易信号输出，支持双向（做多/做空）操作。

## 功能特性

### 🧠 机器学习分析
- **OpenAI GPT集成**: 利用大语言模型进行市场情绪和新闻分析
- **Hugging Face模型**: 集成专业的金融分析模型
- **TensorFlow.js**: 本地机器学习模型训练和预测
- **多因子分析**: 结合技术指标和ML分析的智能信号生成

### 📊 技术指标分析
- **RSI**: 相对强弱指数分析
- **MACD**: 移动平均收敛发散指标
- **布林带**: 价格波动区间分析
- **KDJ**: 随机指标分析
- **Williams %R**: 威廉指标
- **EMA/SMA**: 指数/简单移动平均线

### 🎯 智能交易信号
- **多时间框架分析**: 以 1H 为核心的 15m/1H/4H/1D 多周期综合确认
- **信号强度评估**: 基于置信度的信号分级
- **风险评估**: 实时风险评分和预警
- **目标价格预测**: AI驱动的价格目标计算

### 🛡️ 风险管理
- **动态止损**: 基于波动率的智能止损
- **仓位管理**: 自动仓位大小计算
- **最大回撤控制**: 实时监控和保护
- **日损失限制**: 防止过度亏损

### 🌐 Web界面
- **实时仪表板**: 美观的实时数据展示
- **WebSocket推送**: 实时策略更新
- **交互式图表**: 价格走势和指标可视化
- **移动端适配**: 响应式设计支持移动设备

## 系统核心逻辑（从信号到闭环）

```mermaid
flowchart TD
    A[策略/分析层\n(多因子+ML)] --> B[集成服务\nrecommendation-integration-service]
    B --> C[(SQLite: data/recommendations.db)]
    B --> D[跟踪器\nrecommendation-tracker]
    D --> E[ACTIVE\n进行中]
    E -->|成交/止盈/止损| F[CLOSED\n已平仓]
    F --> G[统计/报表\n胜率/平均收益/年化/Sharpe]
    F --> H[样本回灌\n标签回填]
    H --> I[模型训练/评估]
    I --> A
    P[PENDING\n瞬时态] -.合并到-> E
    X[EXPIRED\n仅徽标] -.不参与过滤/统计.-> G
    D --> J[API/前端\n筛选: 全部/进行中/已平仓]
    J -.进行中=ACTIVE+PENDING.-> K[用户视图]
```


- 核心目标与口径：系统全自动闭环，无需人工确认；对外仅两种状态——进行中（ACTIVE）与已平仓（CLOSED）。历史兼容状态（如 PENDING/EXPIRED）已并入上述口径，不对外暴露或筛选，前端“进行中”已覆盖任何瞬时待确认态。

- 数据流与职责分工：
  1) 策略/分析层生成推荐（结合多因子与ML）；
  2) 集成服务写入推荐记录并触发跟踪；
  3) 跟踪器接管生命周期，负责状态流转、持久化与对前端推送。
  相关代码：<mcfile name="recommendation-integration-service.ts" path="src/services/recommendation-integration-service.ts"></mcfile>、<mcfile name="recommendation-tracker.ts" path="src/services/recommendation-tracker.ts"></mcfile>

- 状态模型与转换：
  • 进行中（ACTIVE）：新推荐直接进入主路径进行跟踪与风控；
  • 已平仓（CLOSED）：由成交/止盈/止损等闭环事件触发，写入盈亏并计入统计；
  • 历史兼容态（PENDING/EXPIRED）：仅内部与历史数据兼容用，PENDING 视为进行中口径，EXPIRED 仅作为质量标识，不提供独立过滤；
  • 前端筛选口径：下拉框仅保留“全部状态 / 进行中 / 已平仓”，其中“进行中”合并任何瞬时待确认。

- 持久化与一致性：
  • 数据库存储于 data/recommendations.db（SQLite）；
  • 统一通过跟踪器写入/更新，确保状态一致性（避免旁路写入造成分叉）；
  • 历史默认值若为 PENDING，将在跟踪接管后落入 ACTIVE 主路径；平仓时落 CLOSED 并记录收益。

- 统计与口径：
  • 胜率、平均收益等仅按“已平仓（CLOSED）”样本计算；进行中不计入；
  • 短样本保护：当样本窗口<30天或已平仓交易<10笔时，年化收益与 Sharpe 比率显示为 N/A，避免误导；
  • 指标计算不受“PENDING/EXPIRED”影响（因已并口径化）。

- API 与前端：
  • 列表过滤项仅“全部 / 进行中 / 已平仓”；
  • 若启用“已过期”徽标，仅作为历史质量标记，不影响过滤与统计；
  • 进行中包含任何瞬时待确认态，保障“无人工确认”的产品心智。

- 机器学习样本闭环：
  • 已平仓样本回填标签进入样本库供训练与评估；
  • pending label samples 指“待回填标签的训练样本”，与订单状态无关。

## 快速开始

### 环境要求
- Node.js >= 18.0.0
- npm >= 8.0.0
- 稳定的网络连接（访问OKX API）

### 安装步骤

1. **克隆项目**
```bash
git clone <repository-url>
cd ETH
```

2. **安装依赖**
```bash
npm install
```

3. **配置环境变量**
```bash
cp .env.example .env
```

编辑 `.env` 文件，配置以下必要参数：

```env
# OKX API配置
OKX_API_KEY=your_okx_api_key
OKX_SECRET_KEY=your_okx_secret_key
OKX_PASSPHRASE=your_okx_passphrase

# 机器学习API配置
OPENAI_API_KEY=your_openai_api_key
HUGGINGFACE_API_KEY=your_huggingface_api_key

# 策略配置
USE_ML_ANALYSIS=true
ML_CONFIDENCE_THRESHOLD=0.7

# 风险管理
MAX_DAILY_LOSS=5.0
STOP_LOSS_PERCENT=2.0
TAKE_PROFIT_PERCENT=4.0
```

4. **启动应用**
```bash
npm start
```

5. **访问Web界面**
打开浏览器访问: http://localhost:3000

## 使用指南

### 启动策略
1. 确保配置正确
2. 在Web界面点击"启动策略"按钮
3. 系统将开始实时分析市场数据
4. 根据分析结果生成交易信号

### 监控系统
- **系统状态**: 查看策略引擎和连接状态
- **市场数据**: 实时ETH价格和市场指标
- **交易信号**: 当前信号类型、强度和置信度
- **持仓信息**: 当前持仓状态和盈亏
- **性能统计**: 历史交易表现和风险指标

### API接口

系统提供完整的REST API接口：

```bash
# 获取策略状态
GET /api/strategy/status

# 启动/停止策略
POST /api/strategy/start
POST /api/strategy/stop

# 获取市场数据
GET /api/market/ticker
GET /api/market/kline?interval=1m&limit=100

# 获取分析结果
GET /api/strategy/analysis
GET /api/indicators/latest

# 获取交易历史
GET /api/strategy/trades?limit=50
```

## 配置说明

### 交易配置
- `DEFAULT_SYMBOL`: 默认交易标的 (ETH-USDT-SWAP)
- `MAX_LEVERAGE`: 最大杠杆倍数
- `MAX_POSITIONS`: 最大同时持仓数量

### 技术指标参数
- `RSI_PERIOD`: RSI计算周期 (默认14)
- `MACD_FAST/SLOW/SIGNAL`: MACD参数 (12,26,9)
- `BOLLINGER_PERIOD/STD`: 布林带参数 (20,2)

### 机器学习配置
- `USE_ML_ANALYSIS`: 是否启用ML分析
- `ML_CONFIDENCE_THRESHOLD`: ML分析置信度阈值
- `ML_MODEL_PATH`: 本地模型文件路径

### 风险管理
- `MAX_DAILY_LOSS`: 最大日亏损百分比
- `MAX_POSITION_SIZE`: 最大单笔仓位大小
- `STOP_LOSS_PERCENT`: 止损百分比
- `TAKE_PROFIT_PERCENT`: 止盈百分比

## 开发指南

### 项目结构
```
src/
├── analyzers/          # 信号分析器
│   └── smart-signal-analyzer.ts
├── config.ts           # 配置管理
├── indicators/         # 技术指标
│   └── technical-indicators.ts
├── ml/                 # 机器学习模块
│   └── ml-analyzer.ts
├── server/             # Web服务器
│   └── web-server.ts
├── services/           # 数据服务
│   └── okx-data-service.ts
├── strategy/           # 策略引擎
│   └── eth-strategy-engine.ts
└── app.ts              # 应用入口
```

### 添加新的技术指标
1. 在 `src/indicators/technical-indicators.ts` 中添加计算方法
2. 在 `SmartSignalAnalyzer` 中集成新指标
3. 更新配置文件添加相关参数

### 集成新的ML模型
1. 在 `src/ml/ml-analyzer.ts` 中添加模型接口
2. 实现模型的训练和预测方法
3. 在策略引擎中调用新模型

### 自定义交易策略
1. 继承或修改 `ETHStrategyEngine` 类
2. 实现自定义的信号生成逻辑
3. 添加相应的风险管理规则

## 注意事项

### 安全提醒
- 🔐 妥善保管API密钥，不要提交到版本控制
- 💰 建议先在测试环境验证策略效果
- 📊 定期监控系统运行状态和资金安全
- ⚠️ 机器学习分析仅供参考，不构成投资建议

### 性能优化
- 🚀 使用代理服务器提高API访问速度
- 💾 合理设置缓存时间减少API调用
- 🔄 定期清理历史数据避免内存泄漏

### 故障排除

**常见问题：**

1. **API连接失败**
   - 检查网络连接和代理设置
   - 验证OKX API密钥配置
   - 确认API权限设置正确

2. **ML分析不工作**
   - 检查OpenAI/HuggingFace API密钥
   - 确认网络可以访问相关服务
   - 查看日志中的错误信息

3. **策略不生成信号**
   - 检查技术指标计算是否正常
   - 验证信号阈值设置
   - 确认历史数据获取正常

## 免责声明

本系统仅用于学习和研究目的。加密货币交易存在高风险，可能导致资金损失。使用本系统进行实际交易前，请：

- 充分了解相关风险
- 在测试环境中验证策略
- 根据自身风险承受能力调整参数
- 不要投入超过承受能力的资金

开发者不对使用本系统造成的任何损失承担责任。

## 许可证

MIT License - 详见 LICENSE 文件

## 贡献

欢迎提交Issue和Pull Request来改进项目！

---

**Happy Trading! 🚀📈**