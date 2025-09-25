# 🎯 ETH合约智能推荐系统 - Windows安装指南

## 🚀 快速开始（Windows）

### 📋 系统要求
- **操作系统**: Windows 10/11 (64位)
- **Node.js**: 18.0.0 或更高版本
- **Python**: 3.8.0 或更高版本
- **内存**: 最少4GB RAM，推荐8GB+
- **存储**: 至少2GB可用空间

### ⚡ 一键安装

1. **下载项目**
   ```bash
   git clone <repository-url>
   cd ETH
   ```

2. **运行安装脚本**
   - 右键点击 `setup-windows.bat`
   - 选择"以管理员身份运行"
   - 按照提示完成安装

3. **启动系统**
   - 双击桌面上的"ETH推荐系统"快捷方式
   - 或运行 `start-system.bat`
   - 或命令行执行 `npm start`

### 🌐 访问系统

安装完成后，在浏览器中访问：
- **主控制台**: http://localhost:3031
- **推荐条件监控**: http://localhost:3031/recommendation-conditions.html
- **API文档**: http://localhost:3031/api

## 🔧 手动安装（高级用户）

### 1. 环境准备

#### 安装Node.js
1. 访问 https://nodejs.org/
2. 下载LTS版本（推荐18.x或更高）
3. 运行安装程序，确保勾选"Add to PATH"

#### 安装Python
1. 访问 https://www.python.org/downloads/
2. 下载Python 3.8+版本
3. 安装时勾选"Add Python to PATH"

### 2. 项目配置

#### 安装依赖
```bash
# 安装Node.js依赖
npm install

# 安装Python依赖（Kronos模型服务）
cd kronos-service
pip install -r requirements.txt
cd ..
```

#### 配置环境
```bash
# 使用Windows专用配置
copy .env.windows .env

# 或使用通用配置模板
copy .env.example .env
```

#### 编译项目
```bash
# 编译TypeScript
npx tsc

# 运行测试
node tests/smoke/smoke-test.cjs
```

### 3. 启动系统

```bash
# 启动完整系统
npm start

# 或分别启动各服务
npm run dev          # 开发模式
npm run build        # 构建生产版本
```

## ⚙️ Windows特定配置

### 环境变量配置

Windows环境下的特殊配置项：

```bash
# Windows系统优化
WINDOWS_CONSOLE_ENCODING=utf8
WINDOWS_PATH_SEPARATOR=\\
WINDOWS_TEMP_DIR=%TEMP%
WINDOWS_HOME_DIR=%USERPROFILE%

# Python环境配置
PYTHON_EXECUTABLE=python
PYTHON_PATH=%USERPROFILE%\AppData\Local\Programs\Python\Python39\python.exe

# Windows服务配置
WINDOWS_SERVICE_NAME=ETHRecommendationSystem
WINDOWS_SERVICE_DISPLAY_NAME=ETH Contract Recommendation System
```

### 防火墙配置

系统使用以下端口，请确保防火墙允许：
- **3031**: Web服务器端口
- **8001**: Kronos AI模型服务端口

#### 配置Windows防火墙
1. 打开"Windows安全中心"
2. 选择"防火墙和网络保护"
3. 点击"允许应用通过防火墙"
4. 添加Node.js和Python到允许列表

### 性能优化

#### 系统优化建议
```bash
# 增加Node.js内存限制
set NODE_OPTIONS=--max-old-space-size=4096

# 优化网络连接
set UV_THREADPOOL_SIZE=16
```

#### 杀毒软件配置
- 将项目目录添加到杀毒软件白名单
- 排除 `node_modules` 和 `data` 目录的实时扫描

## 🛠️ 故障排除

### 常见问题

#### 1. Node.js相关问题

**问题**: `'node' 不是内部或外部命令`
```bash
# 解决方案
# 1. 重新安装Node.js，确保勾选"Add to PATH"
# 2. 手动添加到环境变量PATH中
# 3. 重启命令提示符
```

**问题**: `npm install` 失败
```bash
# 解决方案
# 1. 清理npm缓存
npm cache clean --force

# 2. 删除node_modules重新安装
rmdir /s node_modules
npm install

# 3. 使用淘宝镜像
npm config set registry https://registry.npmmirror.com
```

#### 2. Python相关问题

**问题**: `'python' 不是内部或外部命令`
```bash
# 解决方案
# 1. 确认Python已正确安装
# 2. 检查环境变量PATH
# 3. 尝试使用python3命令
```

**问题**: pip安装依赖失败
```bash
# 解决方案
# 1. 升级pip
python -m pip install --upgrade pip

# 2. 使用清华镜像
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple/

# 3. 安装Visual Studio Build Tools（如需编译C++扩展）
```

#### 3. 网络连接问题

**问题**: 无法访问OKX API
```bash
# 解决方案
# 1. 检查网络连接
# 2. 配置代理设置（如需要）
USE_PROXY=true
PROXY_URL=http://your-proxy:port

# 3. 检查防火墙设置
# 4. 尝试使用VPN
```

**问题**: 端口被占用
```bash
# 检查端口占用
netstat -ano | findstr :3031
netstat -ano | findstr :8001

# 终止占用进程
taskkill /PID <进程ID> /F

# 或修改配置使用其他端口
WEB_PORT=3032
KRONOS_BASE_URL=http://localhost:8002
```

#### 4. 权限问题

**问题**: 权限不足
```bash
# 解决方案
# 1. 以管理员身份运行命令提示符
# 2. 检查文件夹权限
# 3. 关闭杀毒软件实时保护（临时）
```

### 日志查看

#### 系统日志位置
- **应用日志**: `logs/app.log`
- **错误日志**: `logs/error.log`
- **Kronos日志**: `kronos-service/logs/`

#### 调试模式
```bash
# 启用详细日志
set DEBUG_NETWORK=true
set VERBOSE_LOGGING=true
set LOG_LEVEL=debug

# 重新启动系统
npm start
```

## 📊 性能监控

### 系统监控工具

#### Windows任务管理器
- 监控CPU和内存使用
- 检查网络活动
- 查看进程状态

#### 性能计数器
```bash
# 查看Node.js进程性能
wmic process where name="node.exe" get ProcessId,PageFileUsage,WorkingSetSize

# 查看Python进程性能
wmic process where name="python.exe" get ProcessId,PageFileUsage,WorkingSetSize
```

### 性能优化建议

1. **硬件配置**
   - 使用SSD存储
   - 增加内存到8GB+
   - 确保稳定的网络连接

2. **系统配置**
   - 关闭不必要的后台程序
   - 设置高性能电源计划
   - 定期清理系统垃圾

3. **应用配置**
   - 调整缓存大小
   - 优化数据库配置
   - 配置合适的并发参数

## 🔄 更新和维护

### 系统更新
```bash
# 拉取最新代码
git pull origin main

# 更新依赖
npm update
pip install -r kronos-service/requirements.txt --upgrade

# 重新编译
npx tsc

# 重启系统
npm start
```

### 数据备份
```bash
# 备份数据库
copy data\recommendations.db data\backups\

# 备份配置
copy .env .env.backup

# 备份日志
xcopy logs logs_backup\ /E /I
```

### 定期维护
- 每周清理日志文件
- 每月备份数据库
- 定期更新依赖包
- 监控系统性能

## 📞 技术支持

### 获取帮助
- 查看主README.md文档
- 检查GitHub Issues
- 联系技术支持

### 报告问题
提交问题时请包含：
- Windows版本信息
- Node.js和Python版本
- 错误日志内容
- 重现步骤

---

**🎉 祝您使用愉快！如有问题，请参考故障排除部分或联系技术支持。**