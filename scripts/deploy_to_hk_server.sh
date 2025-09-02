#!/bin/bash

# 香港服务器OKX API代理服务自动部署脚本
# 使用方法: bash deploy_to_hk_server.sh

set -e

echo "🚀 开始部署OKX API代理服务到香港服务器..."

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否为root用户
if [ "$EUID" -eq 0 ]; then
    echo -e "${YELLOW}警告: 建议不要使用root用户运行此脚本${NC}"
fi

# 1. 更新系统
echo -e "${GREEN}步骤 1: 更新系统...${NC}"
sudo apt update && sudo apt upgrade -y

# 2. 安装Node.js
echo -e "${GREEN}步骤 2: 安装Node.js 18...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "Node.js 已安装，版本: $(node --version)"
fi

# 3. 安装PM2
echo -e "${GREEN}步骤 3: 安装PM2进程管理器...${NC}"
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
else
    echo "PM2 已安装，版本: $(pm2 --version)"
fi

# 4. 创建项目目录
echo -e "${GREEN}步骤 4: 创建项目目录...${NC}"
sudo mkdir -p /opt/okx-proxy
sudo chown $USER:$USER /opt/okx-proxy
cd /opt/okx-proxy

# 5. 创建代理服务文件
echo -e "${GREEN}步骤 5: 创建代理服务文件...${NC}"

# 创建package.json
cat > package.json << 'EOF'
{
  "name": "okx-api-proxy",
  "version": "1.0.0",
  "description": "OKX API代理服务 - 香港服务器端",
  "main": "hk_server_proxy.js",
  "scripts": {
    "start": "node hk_server_proxy.js",
    "dev": "nodemon hk_server_proxy.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "dependencies": {
    "express": "^4.18.2",
    "axios": "^1.6.0",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "express-rate-limit": "^7.1.5",
    "morgan": "^1.10.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "keywords": ["okx", "api", "proxy", "trading", "cryptocurrency"],
  "author": "OKX Proxy Team",
  "license": "MIT"
}
EOF

echo "✅ package.json 创建完成"

# 6. 安装依赖
echo -e "${GREEN}步骤 6: 安装依赖包...${NC}"
npm install

# 7. 配置防火墙
echo -e "${GREEN}步骤 7: 配置防火墙...${NC}"
if command -v ufw &> /dev/null; then
    sudo ufw allow 8080/tcp
    echo "✅ UFW防火墙规则已添加"
elif command -v iptables &> /dev/null; then
    sudo iptables -A INPUT -p tcp --dport 8080 -j ACCEPT
    # 保存iptables规则
    if [ -d "/etc/iptables" ]; then
        sudo iptables-save | sudo tee /etc/iptables/rules.v4 > /dev/null
    fi
    echo "✅ iptables防火墙规则已添加"
else
    echo -e "${YELLOW}警告: 未检测到防火墙，请手动开放8080端口${NC}"
fi

# 8. 提示用户上传代理服务文件
echo -e "${YELLOW}步骤 8: 请将 hk_server_proxy.js 文件上传到当前目录${NC}"
echo "当前目录: $(pwd)"
echo "您可以使用以下命令上传文件:"
echo "scp /path/to/hk_server_proxy.js user@43.132.123.32:/opt/okx-proxy/"
echo ""
echo "按任意键继续..."
read -n 1 -s

# 9. 检查文件是否存在
if [ ! -f "hk_server_proxy.js" ]; then
    echo -e "${RED}错误: hk_server_proxy.js 文件不存在${NC}"
    echo "请先上传 hk_server_proxy.js 文件到 /opt/okx-proxy/ 目录"
    exit 1
fi

# 10. 启动服务
echo -e "${GREEN}步骤 9: 启动代理服务...${NC}"
pm2 start hk_server_proxy.js --name "okx-proxy"

# 11. 设置开机自启
echo -e "${GREEN}步骤 10: 设置开机自启...${NC}"
pm2 startup
pm2 save

# 12. 验证部署
echo -e "${GREEN}步骤 11: 验证部署...${NC}"
sleep 3

# 测试健康检查
echo "测试健康检查接口..."
if curl -s http://localhost:8080/health > /dev/null; then
    echo -e "${GREEN}✅ 健康检查接口正常${NC}"
else
    echo -e "${RED}❌ 健康检查接口失败${NC}"
fi

# 测试时间接口
echo "测试时间接口..."
if curl -s http://localhost:8080/time > /dev/null; then
    echo -e "${GREEN}✅ 时间接口正常${NC}"
else
    echo -e "${RED}❌ 时间接口失败${NC}"
fi

# 显示服务状态
echo -e "${GREEN}\n🎉 部署完成！${NC}"
echo "服务状态:"
pm2 status

echo -e "\n${GREEN}可用接口:${NC}"
echo "健康检查: http://43.132.123.32:8080/health"
echo "时间接口: http://43.132.123.32:8080/time"
echo "API代理: http://43.132.123.32:8080/api/v5/*"

echo -e "\n${GREEN}管理命令:${NC}"
echo "查看状态: pm2 status"
echo "查看日志: pm2 logs okx-proxy"
echo "重启服务: pm2 restart okx-proxy"
echo "停止服务: pm2 stop okx-proxy"

echo -e "\n${YELLOW}注意: 请确保本地客户端配置指向 http://43.132.123.32:8080${NC}"