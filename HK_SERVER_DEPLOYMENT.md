# 香港服务器OKX API代理部署指南

## 概述

本指南说明如何在香港服务器上部署完整的OKX API代理服务，实现从内地客户端到香港服务器再到OKX API的完整代理链路。

## 架构图

```
内地客户端 → 香港服务器(43.132.123.32:8080) → OKX API
     ↑                    ↓                      ↓
  监控系统              代理服务                真实数据
```

## 部署步骤

### 1. 服务器环境准备

在香港服务器 `43.132.123.32` 上执行以下操作：

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装Node.js (推荐使用Node.js 18+)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node --version
npm --version

# 安装PM2进程管理器
npm install -g pm2
```

### 2. 部署代理服务

```bash
# 创建项目目录
mkdir -p /opt/okx-proxy
cd /opt/okx-proxy

# 上传文件
# 将 hk_server_proxy.js 和 hk_server_package.json 上传到服务器
# 可以使用 scp 或其他文件传输工具

# 重命名package.json
mv hk_server_package.json package.json

# 安装依赖
npm install
```

### 3. 配置防火墙

```bash
# 开放8080端口
sudo ufw allow 8080/tcp

# 如果使用iptables
sudo iptables -A INPUT -p tcp --dport 8080 -j ACCEPT
sudo iptables-save > /etc/iptables/rules.v4
```

### 4. 启动服务

```bash
# 使用PM2启动服务
pm2 start hk_server_proxy.js --name "okx-proxy"

# 设置开机自启
pm2 startup
pm2 save

# 查看服务状态
pm2 status
pm2 logs okx-proxy
```

### 5. 验证部署

```bash
# 测试健康检查接口
curl http://localhost:8080/health

# 测试OKX时间接口
curl http://localhost:8080/time

# 测试完整API代理
curl "http://localhost:8080/api/v5/market/tickers?instType=SWAP&instId=BTC-USDT-SWAP"
```

## 服务管理命令

```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs okx-proxy

# 重启服务
pm2 restart okx-proxy

# 停止服务
pm2 stop okx-proxy

# 删除服务
pm2 delete okx-proxy

# 监控服务
pm2 monit
```

## 本地客户端配置

确保本地的 `data-fetcher.ts` 文件中的配置正确：

```typescript
const PROXY_SERVER = 'http://43.132.123.32:8080';
const OKX_REST_API = PROXY_SERVER + '/api/v5';
const PROXY_HEALTH_CHECK = PROXY_SERVER + '/health';
const PROXY_TIME_CHECK = PROXY_SERVER + '/time';
```

## 可用接口

代理服务提供以下接口：

| 接口路径 | 方法 | 描述 |
|---------|------|------|
| `/health` | GET | 健康检查 |
| `/time` | GET | OKX服务器时间 |
| `/api/*` | ALL | 完整OKX API代理 |
| `/kline/BTC-USDT` | GET | BTC K线数据（兼容） |
| `/kline/ETH-USDT` | GET | ETH K线数据（兼容） |
| `/tickers` | GET | 所有交易对数据（兼容） |

## 安全特性

- ✅ CORS跨域支持
- ✅ 请求速率限制（1200请求/分钟）
- ✅ 安全头设置（Helmet）
- ✅ 请求日志记录
- ✅ 错误处理和监控

## 故障排除

### 1. 服务无法启动

```bash
# 检查端口占用
sudo netstat -tlnp | grep :8080

# 检查Node.js版本
node --version

# 检查依赖安装
npm list
```

### 2. 代理请求失败

```bash
# 检查网络连接
curl -I https://www.okx.com

# 检查DNS解析
nslookup www.okx.com

# 查看详细日志
pm2 logs okx-proxy --lines 100
```

### 3. 性能监控

```bash
# 查看系统资源
top
htop

# 查看网络连接
ss -tuln

# PM2监控
pm2 monit
```

## 维护建议

1. **定期更新**：定期更新Node.js和依赖包
2. **日志轮转**：配置日志轮转避免磁盘空间不足
3. **监控告警**：设置服务监控和告警
4. **备份配置**：定期备份配置文件
5. **性能优化**：根据实际使用情况调整速率限制

## 联系支持

如果在部署过程中遇到问题，请检查：

1. 服务器网络连接
2. 防火墙配置
3. Node.js版本兼容性
4. OKX API访问权限

---

**注意**：请确保服务器位于香港或其他可以正常访问OKX API的地区。