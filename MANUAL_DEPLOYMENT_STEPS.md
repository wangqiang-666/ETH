# 香港服务器手动部署步骤

## 🚀 快速部署指南

### 准备工作

1. **确保可以SSH连接到香港服务器**
   ```bash
   ssh user@43.132.123.32
   ```

2. **需要上传的文件**
   - `hk_server_proxy.js` (代理服务主文件)
   - `hk_server_package.json` (依赖配置)

### 第一步：上传文件到服务器

```bash
# 方法1: 使用scp上传
scp d:/Trae/Cache/ETH/hk_server_proxy.js user@43.132.123.32:/tmp/
scp d:/Trae/Cache/ETH/hk_server_package.json user@43.132.123.32:/tmp/

# 方法2: 使用WinSCP或其他FTP工具上传到 /tmp/ 目录
```

### 第二步：在服务器上执行部署

**SSH连接到服务器后，执行以下命令：**

```bash
# 1. 更新系统
sudo apt update && sudo apt upgrade -y

# 2. 安装Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. 安装PM2
sudo npm install -g pm2

# 4. 创建项目目录
sudo mkdir -p /opt/okx-proxy
sudo chown $USER:$USER /opt/okx-proxy
cd /opt/okx-proxy

# 5. 移动上传的文件
mv /tmp/hk_server_proxy.js ./
mv /tmp/hk_server_package.json ./package.json

# 6. 安装依赖
npm install

# 7. 配置防火墙
sudo ufw allow 8080/tcp

# 8. 启动服务
pm2 start hk_server_proxy.js --name "okx-proxy"

# 9. 设置开机自启
pm2 startup
pm2 save
```

### 第三步：验证部署

```bash
# 检查服务状态
pm2 status

# 测试健康检查
curl http://localhost:8080/health

# 测试时间接口
curl http://localhost:8080/time

# 测试API代理
curl "http://localhost:8080/api/v5/market/tickers?instType=SWAP&instId=BTC-USDT-SWAP"
```

### 第四步：外网访问测试

**在本地电脑上测试：**

```bash
# Windows PowerShell
Invoke-WebRequest -Uri "http://43.132.123.32:8080/health"
Invoke-WebRequest -Uri "http://43.132.123.32:8080/time"

# 或使用curl
curl http://43.132.123.32:8080/health
curl http://43.132.123.32:8080/time
```

## 🔧 服务管理命令

```bash
# 查看服务状态
pm2 status

# 查看实时日志
pm2 logs okx-proxy

# 重启服务
pm2 restart okx-proxy

# 停止服务
pm2 stop okx-proxy

# 删除服务
pm2 delete okx-proxy

# 监控面板
pm2 monit
```

## 🚨 故障排除

### 1. 服务无法启动
```bash
# 检查端口占用
sudo netstat -tlnp | grep :8080

# 查看详细错误
pm2 logs okx-proxy --err
```

### 2. 外网无法访问
```bash
# 检查防火墙状态
sudo ufw status

# 检查服务监听
sudo netstat -tlnp | grep :8080

# 检查云服务器安全组
# 确保在云服务器控制台开放8080端口
```

### 3. API请求失败
```bash
# 测试服务器网络
curl -I https://www.okx.com

# 查看详细日志
pm2 logs okx-proxy --lines 50
```

## ✅ 部署成功标志

当看到以下输出时，表示部署成功：

1. **PM2状态显示**：
   ```
   ┌─────┬──────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────────┬──────────┬──────────┬──────────┐
   │ id  │ name     │ namespace   │ version │ mode    │ pid      │ uptime │ ↺    │ status    │ cpu      │ mem      │ user     │ watching │
   ├─────┼──────────┼─────────────┼─────────┼─────────┼──────────┼────────┼──────┼───────────┼──────────┼──────────┼──────────┼──────────┤
   │ 0   │ okx-proxy│ default     │ 1.0.0   │ fork    │ 12345    │ 5s     │ 0    │ online    │ 0%       │ 25.0mb   │ user     │ disabled │
   └─────┴──────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┴──────────┴──────────┴──────────┴──────────┘
   ```

2. **健康检查返回**：
   ```json
   {"status":"ok","timestamp":"2025-01-31T07:00:00.000Z","uptime":5.123}
   ```

3. **本地客户端连接成功**：
   - 监控系统显示：`✓ 代理连接正常: http://43.132.123.32:8080`
   - 能够获取到真实的BTC/ETH数据

## 📞 技术支持

如果遇到问题，请提供：
1. PM2状态截图：`pm2 status`
2. 服务日志：`pm2 logs okx-proxy --lines 20`
3. 网络测试结果：`curl http://localhost:8080/health`
4. 系统信息：`uname -a && node --version`