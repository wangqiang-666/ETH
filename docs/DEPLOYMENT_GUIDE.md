# 🚀 学习型ETH杠杆合约Agent部署指南

## 📋 部署前准备清单

### 🔧 技术要求
- [ ] Node.js 16+ 已安装
- [ ] 稳定的网络连接
- [ ] 足够的存储空间（至少1GB）
- [ ] 24小时运行的服务器或VPS

### 💰 资金要求
- [ ] 最少资金：10,000 USDT
- [ ] 推荐资金：50,000 USDT以上
- [ ] 风险承受能力：能承受10%以内的回撤

### 📊 交易所准备
- [ ] 支持ETH永续合约的交易所账户
- [ ] API密钥已创建并配置
- [ ] 账户已完成KYC认证
- [ ] 足够的交易权限

## 🎯 快速部署步骤

### 第一步：环境检查
```bash
# 检查Node.js版本
node --version  # 应该 >= 16.0.0

# 检查npm版本
npm --version

# 进入项目目录
cd /Users/mac/Temp/Trae/ETH
```

### 第二步：依赖安装
```bash
# 安装项目依赖
npm install

# 验证安装
npm list
```

### 第三步：配置检查
```bash
# 检查配置文件
ls -la *.env*

# 检查历史数据
ls -la real_historical_data_2022_2024.json

# 检查学习型Agent
ls -la test-learning-agent.js
```

### 第四步：首次运行测试
```bash
# 运行学习型Agent（回测模式）
node test-learning-agent.js
```

**预期输出：**
```
🚀 启动学习型杠杆ETH合约Agent...
📊 加载真实历史数据...
   ✅ 数据加载完成: 130,844条K线
🧠 加载已有学习经验...
   📝 首次运行，开始积累经验
🎯 执行学习型回测...
   💾 经验已保存: XXXX条交易, X个模式
```

### 第五步：验证学习能力
```bash
# 再次运行，验证经验加载
node test-learning-agent.js
```

**预期输出：**
```
🧠 加载已有学习经验...
   ✅ 加载已有经验: XXXX条交易记录
   🧠 学习到的模式: X个
   ⚙️ 参数优化记录: XX次
```

## 📊 监控和管理

### 🔍 关键文件监控

#### 1. 经验数据库文件
```bash
# 检查经验文件
ls -la agent_experience.json

# 查看文件大小（应该持续增长）
du -h agent_experience.json
```

#### 2. 学习报告文件
```bash
# 检查最新报告
ls -la learning_agent_report.json

# 查看报告内容
cat learning_agent_report.json | jq '.overallPerformance'
```

#### 3. 日志文件监控
```bash
# 实时监控运行日志
tail -f nohup.out

# 搜索关键信息
grep "学习到新模式" nohup.out
grep "参数优化" nohup.out
```

### 📈 性能指标监控

#### 核心指标
- **胜率**：目标 >45%
- **年化收益**：目标 >2%
- **最大回撤**：警戒 >8%
- **交易频率**：正常 1500-2500笔/年

#### 学习指标
- **经验积累**：每次运行应增加
- **模式学习**：应识别出成功模式
- **参数优化**：应持续自动调整

### ⚠️ 异常情况处理

#### 1. 连续亏损过多
```bash
# 检查连续亏损情况
grep "连续亏损" nohup.out | tail -10

# 如果连续亏损超过10次，考虑暂停
```

#### 2. 经验文件损坏
```bash
# 备份经验文件
cp agent_experience.json agent_experience_backup.json

# 验证JSON格式
cat agent_experience.json | jq . > /dev/null
```

#### 3. 内存或存储不足
```bash
# 检查磁盘空间
df -h

# 检查内存使用
free -h

# 清理旧日志
find . -name "*.log" -mtime +7 -delete
```

## 🛡️ 风险管理配置

### 资金管理设置

#### 1. 基础风险参数
```javascript
// 在 test-learning-agent.js 中调整
const riskConfig = {
  maxDrawdown: 0.08,        // 8%最大回撤
  maxDailyTrades: 20,       // 每日最多20笔
  maxConsecutiveLosses: 5,  // 最多连续5次亏损
  positionSize: 0.04,       // 4%基础仓位
  leverage: 1.8             // 1.8倍杠杆
};
```

#### 2. 紧急停止条件
```javascript
// 紧急停止触发条件
const emergencyStop = {
  maxDrawdown: 0.12,        // 12%回撤紧急停止
  dailyLossLimit: 0.05,     // 单日亏损5%停止
  consecutiveLosses: 10     // 连续10次亏损停止
};
```

### 监控脚本设置

#### 1. 创建监控脚本
```bash
# 创建监控脚本
cat > monitor.sh << 'EOF'
#!/bin/bash

# 检查Agent是否运行
if ! pgrep -f "test-learning-agent.js" > /dev/null; then
    echo "$(date): Agent not running, restarting..."
    nohup node test-learning-agent.js > agent.log 2>&1 &
fi

# 检查资金安全
CURRENT_CAPITAL=$(cat learning_agent_report.json | jq '.overallPerformance.finalCapital')
INITIAL_CAPITAL=100000
LOSS_RATIO=$(echo "scale=4; ($INITIAL_CAPITAL - $CURRENT_CAPITAL) / $INITIAL_CAPITAL" | bc)

if (( $(echo "$LOSS_RATIO > 0.12" | bc -l) )); then
    echo "$(date): Emergency stop triggered, loss ratio: $LOSS_RATIO"
    pkill -f "test-learning-agent.js"
    # 发送警报邮件或短信
fi
EOF

chmod +x monitor.sh
```

#### 2. 设置定时监控
```bash
# 添加到crontab，每5分钟检查一次
crontab -e

# 添加以下行
*/5 * * * * /path/to/monitor.sh >> /path/to/monitor.log 2>&1
```

## 📱 实时通知设置

### 邮件通知
```javascript
// 在Agent中添加邮件通知功能
const nodemailer = require('nodemailer');

const sendAlert = async (subject, message) => {
  const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: 'your-email@gmail.com',
      pass: 'your-app-password'
    }
  });

  await transporter.sendMail({
    from: 'your-email@gmail.com',
    to: 'your-email@gmail.com',
    subject: `ETH Agent Alert: ${subject}`,
    text: message
  });
};
```

### 微信/Telegram通知
```javascript
// Telegram Bot通知
const sendTelegramAlert = async (message) => {
  const botToken = 'YOUR_BOT_TOKEN';
  const chatId = 'YOUR_CHAT_ID';
  
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: `🤖 ETH Agent: ${message}`
    })
  });
};
```

## 🔄 定期维护任务

### 每日任务
- [ ] 检查Agent运行状态
- [ ] 查看当日交易记录
- [ ] 监控资金安全
- [ ] 备份经验文件

### 每周任务
- [ ] 分析周度表现
- [ ] 检查学习进度
- [ ] 更新监控脚本
- [ ] 清理日志文件

### 每月任务
- [ ] 全面性能评估
- [ ] 参数优化分析
- [ ] 策略效果回顾
- [ ] 风险管理调整

## 🚨 故障排除指南

### 常见问题及解决方案

#### 1. Agent无法启动
```bash
# 检查Node.js进程
ps aux | grep node

# 检查端口占用
netstat -tulpn | grep :3000

# 重启Agent
pkill -f "test-learning-agent.js"
nohup node test-learning-agent.js > agent.log 2>&1 &
```

#### 2. 经验文件损坏
```bash
# 恢复备份
cp agent_experience_backup.json agent_experience.json

# 重新开始学习
rm agent_experience.json
node test-learning-agent.js
```

#### 3. 内存泄漏
```bash
# 监控内存使用
top -p $(pgrep -f "test-learning-agent.js")

# 定期重启Agent
0 0 * * * pkill -f "test-learning-agent.js" && sleep 10 && nohup node test-learning-agent.js > agent.log 2>&1 &
```

#### 4. 网络连接问题
```bash
# 检查网络连接
ping 8.8.8.8

# 检查API连接
curl -I https://api.binance.com/api/v3/ping

# 重启网络服务
sudo systemctl restart networking
```

## 📞 技术支持

### 联系方式
- **技术文档**：查看项目README.md
- **问题反馈**：创建GitHub Issue
- **紧急支持**：联系开发团队

### 自助诊断
1. 查看日志文件：`tail -f agent.log`
2. 检查配置文件：确保所有配置正确
3. 验证数据文件：确保历史数据完整
4. 测试网络连接：确保API可访问

## ✅ 部署完成检查清单

### 基础功能
- [ ] Agent能正常启动
- [ ] 历史数据加载成功
- [ ] 经验文件正常创建
- [ ] 学习功能正常工作

### 监控系统
- [ ] 监控脚本正常运行
- [ ] 通知系统配置完成
- [ ] 日志记录正常
- [ ] 备份机制建立

### 风险控制
- [ ] 风险参数设置合理
- [ ] 紧急停止机制有效
- [ ] 资金安全监控到位
- [ ] 定期维护计划制定

### 性能验证
- [ ] 回测结果符合预期
- [ ] 学习能力正常工作
- [ ] 参数优化功能有效
- [ ] 整体表现稳定

**🎉 恭喜！您的学习型ETH杠杆合约Agent已成功部署！**

现在它将开始为您积累经验、学习市场模式，并持续优化交易策略。记住，这是一个长期的投资工具，请耐心等待它的成长和进化！