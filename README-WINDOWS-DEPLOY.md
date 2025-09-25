# ETH智能交易系统 - Windows部署指南

## 🚀 快速开始

### 系统要求
- Windows 10/11 (64位)
- Node.js 18+ (推荐 LTS 版本)
- 至少 4GB RAM
- 至少 2GB 可用磁盘空间

### 一键启动
1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd ETH
   ```

2. **运行启动脚本**
   ```bash
   # 双击运行或在命令行执行
   start-windows.bat
   ```

3. **访问系统**
   - 🌐 Web界面: http://localhost:3031
   - 📊 API接口: http://localhost:3031/api

## 📋 详细部署步骤

### 1. 环境准备

#### 安装 Node.js
1. 访问 https://nodejs.org
2. 下载并安装 LTS 版本
3. 验证安装：
   ```cmd
   node --version
   npm --version
   ```

#### 系统优化 (可选)
```cmd
# 设置DNS (管理员权限)
netsh interface ip set dns "以太网" static 8.8.8.8
netsh interface ip add dns "以太网" 1.1.1.1 index=2
```

### 2. 项目配置

#### 自动配置 (推荐)
启动脚本会自动：
- ✅ 检查Node.js环境
- ✅ 安装项目依赖
- ✅ 应用Windows优化配置
- ✅ 启动系统服务

#### 手动配置 (高级用户)
```cmd
# 进入项目目录
cd ETH\data

# 安装依赖
npm install

# 复制Windows配置
copy ..\configs\.env.windows .env

# 启动系统
npm start
```

### 3. 配置说明

#### Windows优化配置 (.env.windows)
```env
# 网络优化
USE_PROXY=false                    # 默认不使用代理
REQUEST_TIMEOUT=15000              # 请求超时15秒
NODE_OPTIONS=--dns-result-order=ipv4first  # IPv4优先

# 性能优化
UV_THREADPOOL_SIZE=16              # 线程池大小
MAX_SOCKETS=16                     # 最大连接数
KEEP_ALIVE=true                    # 保持连接

# 杠杆配置
DEFAULT_LEVERAGE=2                 # 默认2倍杠杆
MAX_LEVERAGE=10                    # 最大10倍杠杆
```

## 🔧 系统功能

### 核心特性
- 📊 **实时交易分析** - ETH合约智能推荐
- 🤖 **机器学习** - AI驱动的交易信号
- 🛡️ **风险管理** - 智能杠杆控制 (2-10倍)
- 📈 **性能监控** - 实时系统状态监控
- 🌐 **Web界面** - 专业交易仪表板

### API接口
- `/api/recommendations` - 获取交易推荐
- `/api/status` - 系统状态
- `/api/statistics` - 交易统计
- `/api/monitoring/metrics` - 性能指标
- `/api/risk/status` - 风险状态

## 🛠️ 故障排除

### 常见问题

#### 1. 端口占用
```cmd
# 检查端口占用
netstat -ano | findstr :3031

# 结束占用进程
taskkill /PID <进程ID> /F
```

#### 2. 依赖安装失败
```cmd
# 清理npm缓存
npm cache clean --force

# 重新安装
npm install
```

#### 3. 网络连接问题
```cmd
# 检查网络连接
ping 8.8.8.8

# 刷新DNS
ipconfig /flushdns
```

#### 4. 权限问题
- 以管理员身份运行命令提示符
- 确保防火墙允许Node.js访问网络

### 性能优化

#### Windows系统优化
```cmd
# 禁用Windows Defender实时保护 (可选)
# 添加项目目录到排除列表

# 设置高性能电源计划
powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c
```

#### Node.js优化
```cmd
# 增加内存限制
set NODE_OPTIONS=--max-old-space-size=4096

# 优化垃圾回收
set NODE_OPTIONS=--gc-interval=100
```

## 📊 监控和日志

### 系统监控
- 📈 **性能指标**: CPU、内存、网络使用率
- 🔍 **错误监控**: 自动错误检测和恢复
- 📊 **交易统计**: 实时盈亏和胜率统计

### 日志文件
```
data/logs/
├── system.log          # 系统日志
├── trading.log         # 交易日志
├── error.log           # 错误日志
└── performance.log     # 性能日志
```

## 🔒 安全建议

### 网络安全
- 🔥 启用Windows防火墙
- 🛡️ 定期更新系统补丁
- 🔐 使用强密码保护系统

### 交易安全
- 💰 设置合理的风险限制
- 📊 定期检查交易统计
- 🚨 启用异常交易警报

## 📞 技术支持

### 获取帮助
- 📖 查看系统日志文件
- 🌐 访问Web界面状态页面
- 📊 检查API响应状态

### 系统信息
```cmd
# 查看系统信息
systeminfo | findstr /C:"OS Name" /C:"Total Physical Memory"

# 查看Node.js版本
node --version

# 查看系统状态
curl http://localhost:3031/api/status
```

---

## 🎯 快速检查清单

启动前确认：
- ✅ Node.js 已安装 (18+)
- ✅ 网络连接正常
- ✅ 端口3031未被占用
- ✅ 有足够的磁盘空间 (2GB+)
- ✅ 系统内存充足 (4GB+)

启动后验证：
- ✅ Web界面可访问 (http://localhost:3031)
- ✅ API响应正常 (/api/status)
- ✅ 系统日志无错误
- ✅ 性能监控正常

**🎉 恭喜！您的ETH智能交易系统已在Windows上成功部署！**