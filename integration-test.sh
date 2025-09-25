#!/bin/bash

echo "🧪 ETH智能交易系统 - 集成测试"
echo "测试时间: $(date)"
echo ""

# 测试基础API
echo "1️⃣ 测试基础API..."
curl -s http://localhost:3031/api/recommendations > /dev/null && echo "✅ 推荐API" || echo "❌ 推荐API"
curl -s http://localhost:3031/api/statistics/overall > /dev/null && echo "✅ 统计API" || echo "❌ 统计API"
curl -s http://localhost:3031/api/active-recommendations > /dev/null && echo "✅ 活跃推荐API" || echo "❌ 活跃推荐API"

# 测试增强功能API
echo ""
echo "2️⃣ 测试增强功能API..."
curl -s http://localhost:3031/api/monitoring/metrics > /dev/null && echo "✅ 监控指标API" || echo "❌ 监控指标API"
curl -s http://localhost:3031/api/ml/prediction > /dev/null && echo "✅ ML预测API" || echo "❌ ML预测API"
curl -s http://localhost:3031/api/signal/quality > /dev/null && echo "✅ 信号质量API" || echo "❌ 信号质量API"
curl -s http://localhost:3031/api/stability/health > /dev/null && echo "✅ 系统稳定性API" || echo "❌ 系统稳定性API"

# 测试Web界面
echo ""
echo "3️⃣ 测试Web界面..."
curl -s -I http://localhost:3031/ | grep -q "200 OK" && echo "✅ 主页面" || echo "❌ 主页面"
curl -s -I http://localhost:3031/backtest | grep -q "200 OK" && echo "✅ 回测页面" || echo "❌ 回测页面"

# 测试系统状态
echo ""
echo "4️⃣ 测试系统状态..."
RESPONSE=$(curl -s http://localhost:3031/api/status 2>/dev/null)
if echo "$RESPONSE" | grep -q "isRunning"; then
    echo "✅ 系统状态API"
else
    echo "❌ 系统状态API"
fi

echo ""
echo "🎯 集成测试完成！"
