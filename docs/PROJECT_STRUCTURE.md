# 📁 ETH智能交易系统 - 项目结构

## 🎯 整理后的目录结构

```
ETH/
├── 📁 src/                    # 源代码目录
│   ├── agent/                 # Agent核心代码
│   ├── services/              # 服务层
│   ├── ml/                    # 机器学习模块
│   ├── api/                   # API接口
│   └── web/                   # Web界面
├── 📁 docs/                   # 📚 文档目录
│   ├── README.md              # 项目说明
│   ├── API_SETUP_GUIDE.md     # API配置指南
│   ├── DEPLOYMENT_GUIDE.md    # 部署指南
│   ├── FINAL_RECOMMENDATION.md # 最终建议
│   └── *.md                   # 其他文档
├── 📁 reports/                # 📊 报告目录
│   ├── learning_agent_report.json      # 学习型Agent报告
│   ├── balanced_profit_agent_report.json # 平衡盈利Agent报告
│   ├── profit_enhanced_agent_report.json # 盈利增强Agent报告
│   └── *_report.json          # 其他Agent报告
├── 📁 test-scripts/           # 🧪 测试脚本目录
│   ├── test-learning-agent.js # 学习型Agent测试
│   ├── test-balanced-profit-agent.js # 平衡盈利Agent测试
│   ├── run-decision-chain-tests.sh # 决策链测试
│   └── test-*.js              # 其他测试脚本
├── 📁 configs/                # ⚙️ 配置目录
│   ├── .env.macos             # macOS环境配置
│   ├── .env.windows           # Windows环境配置
│   ├── config.current.json    # 当前配置
│   └── config-*.json          # 其他配置文件
├── 📁 data/                   # 💾 数据目录
│   ├── models/                # ML模型
│   ├── agent_experience.json  # Agent经验数据
│   ├── historical_data.json   # 历史数据
│   └── *.json                 # 其他数据文件
├── 📁 scripts/                # 🔧 脚本目录
│   ├── setup-windows.bat      # Windows安装脚本
│   ├── e2e_*.cjs              # 端到端测试
│   └── *.cjs                  # 其他脚本
├── 📁 tests/                  # 🧪 单元测试目录
│   ├── functional/            # 功能测试
│   ├── integration/           # 集成测试
│   ├── performance/           # 性能测试
│   └── unit/                  # 单元测试
├── 📁 cache/                  # 🗄️ 缓存目录
├── 📁 meta/                   # 📋 元数据目录
├── 📁 payloads/               # 📦 负载数据目录
├── 📁 kronos-service/         # 🤖 Kronos ML服务
├── 📄 package.json            # 项目依赖
├── 📄 tsconfig.json           # TypeScript配置
├── 📄 jest.config.js          # Jest测试配置
├── 📄 start.js                # 启动脚本
└── 📄 .gitignore              # Git忽略文件
```

## 🎯 目录说明

### 📚 核心目录

#### `src/` - 源代码
- **agent/**: ETH智能交易Agent核心代码
- **services/**: 数据服务、风险管理、交易服务等
- **ml/**: 机器学习分析器和模型
- **api/**: REST API接口
- **web/**: Web监控界面

#### `docs/` - 文档
- 所有项目文档和说明文件
- 包括API指南、部署指南、使用说明等

#### `reports/` - 报告
- 各种Agent的回测报告
- 性能分析报告
- 学习进度报告

#### `test-scripts/` - 测试脚本
- Agent测试脚本
- 性能测试脚本
- 集成测试脚本

### ⚙️ 配置目录

#### `configs/` - 配置文件
- 环境配置文件 (.env.*)
- 系统配置文件 (config.*.json)
- 策略参数配置

#### `data/` - 数据文件
- ML模型数据
- 历史交易数据
- Agent学习经验数据

### 🔧 工具目录

#### `scripts/` - 工具脚本
- 安装和部署脚本
- 数据处理脚本
- 系统维护脚本

#### `tests/` - 测试套件
- 单元测试
- 集成测试
- 性能测试
- 功能测试

## 🚀 快速启动

### 1. 启动系统
```bash
npm start
```

### 2. 运行学习型Agent
```bash
node test-scripts/test-learning-agent.js
```

### 3. 查看Web界面
```
http://localhost:3031
```

## 📊 重要文件

### 🏆 推荐使用
- **学习型Agent**: `test-scripts/test-learning-agent.js`
- **系统监控**: `http://localhost:3031`
- **配置文件**: `configs/config.current.json`

### 📋 报告查看
- **学习型Agent报告**: `reports/learning_agent_report.json`
- **性能对比**: `reports/`目录下的各种报告

### 📚 文档参考
- **项目说明**: `docs/README.md`
- **部署指南**: `docs/DEPLOYMENT_GUIDE.md`
- **最终建议**: `docs/FINAL_RECOMMENDATION.md`

## 🎉 整理效果

### ✅ 整理前问题
- 根目录文件杂乱无章
- 文档、报告、测试文件混在一起
- 难以快速找到需要的文件

### 🎯 整理后优势
- **清晰的目录结构** - 按功能分类组织
- **易于维护** - 相关文件集中管理
- **快速定位** - 知道去哪里找什么文件
- **专业规范** - 符合软件工程最佳实践

**现在您的ETH智能交易系统目录结构清晰、专业、易于维护！** 🎉