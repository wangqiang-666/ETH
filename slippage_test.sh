#!/bin/bash

# 滑点分析联调测试脚本（修正版）
# 包含：获取活跃推荐ID、注入高滑点样本、重算统计、异常检测和查询预警

echo "===== 滑点分析联调测试开始 ====="
BASE_URL="http://localhost:3031"
API_BASE="${BASE_URL}/api"

# 步骤1：健康检查（注意：/health 不在 /api 前缀下）
echo -e "\n1. 健康检查..."
HEALTH_CHECK=$(curl -s "${BASE_URL}/health" || echo "Failed")
if [[ "$HEALTH_CHECK" == *"healthy"* ]]; then
  echo "✅ 服务健康状态正常"
else
  echo "❌ 服务健康检查失败，请确保服务已启动"
  exit 1
fi

# 步骤2：获取活跃推荐ID（正确路由：/api/active-recommendations）
echo -e "\n2. 获取活跃推荐ID..."
ACTIVE_RECS=$(curl -s "${API_BASE}/active-recommendations")
echo "$ACTIVE_RECS" | grep -o '"id":"[^"]*"' | head -1

# 提取第一个推荐ID
REC_ID=$(echo "$ACTIVE_RECS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$REC_ID" ]; then
  echo "❌ 未找到活跃推荐ID"
  exit 1
fi
echo "✅ 获取到推荐ID: $REC_ID"

# 步骤3：批量注入高滑点样本（补齐必填字段）
echo -e "\n3. 批量注入高滑点样本..."
EXPECTED_PRICE=1500
ACTUAL_PRICE=1507.5
PRICE_DIFF=$(python3 - <<PY
exp=$EXPECTED_PRICE
act=$ACTUAL_PRICE
print(act-exp)
PY
)
PRICE_DIFF_BPS=$(python3 - <<PY
exp=$EXPECTED_PRICE
act=$ACTUAL_PRICE
print(round((act-exp)/exp*10000))
PY
)
EXEC_LATENCY_MS=320
SLIPPAGE_BPS=50
FEE_RATE_BPS=3
FEE_AMOUNT=0
TOTAL_COST_BPS=$((SLIPPAGE_BPS + FEE_RATE_BPS))
ORIG_THRESHOLD=15

for i in {1..12}; do
  echo "注入样本 $i/12..."
  INJECT_RESULT=$(curl -s -X POST "${API_BASE}/slippage/analysis" \
    -H "Content-Type: application/json" \
    -d '{
      "recommendation_id": "'$REC_ID'",
      "symbol": "ETH-USDT-SWAP",
      "direction": "LONG",
      "expected_price": '$EXPECTED_PRICE',
      "actual_price": '$ACTUAL_PRICE',
      "price_difference": '$PRICE_DIFF',
      "price_difference_bps": '$PRICE_DIFF_BPS',
      "execution_latency_ms": '$EXEC_LATENCY_MS',
      "slippage_bps": '$SLIPPAGE_BPS',
      "slippage_category": "EXTREME",
      "fee_rate_bps": '$FEE_RATE_BPS',
      "fee_amount": '$FEE_AMOUNT',
      "total_cost_bps": '$TOTAL_COST_BPS',
      "original_threshold": '$ORIG_THRESHOLD'
    }')
  echo "$INJECT_RESULT" | grep -o '"success":[^,}]*'
done
echo "✅ 已注入12条高滑点样本"

# 步骤4：强制重算统计数据（使用 ISO 时间窗口）
echo -e "\n4. 强制重算统计数据..."
START_DATE=$(date -u -v-1H +"%Y-%m-%dT%H:%M:%SZ")
END_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
CALC_RESULT=$(curl -s -X POST "${API_BASE}/slippage/statistics/calculate" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "ETH-USDT-SWAP",
    "start_date": "'$START_DATE'",
    "end_date": "'$END_DATE'",
    "force_recalculate": true
  }')
echo "$CALC_RESULT"
echo "✅ 统计数据重算完成"

# 步骤5：触发异常检测并持久化（字段对齐 API）
echo -e "\n5. 触发异常检测并持久化..."
DETECT_RESULT=$(curl -s -X POST "${API_BASE}/slippage/anomalies/detect" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "ETH-USDT-SWAP",
    "period": "1h",
    "threshold_bps": 20,
    "min_samples": 10,
    "persist": true,
    "auto_adjust": false
  }')
echo "$DETECT_RESULT"
echo "✅ 异常检测完成"

# 步骤6：查询持久化的预警记录（按符号过滤）
echo -e "\n6. 查询持久化的预警记录..."
ALERTS_RESULT=$(curl -s "${API_BASE}/slippage/alerts?symbol=ETH-USDT-SWAP")
echo "$ALERTS_RESULT"

# 检查是否有预警记录
if [[ "$ALERTS_RESULT" == *"id"* ]]; then
  echo "✅ 成功查询到预警记录"
else
  echo "❌ 未查询到预警记录，请检查异常检测步骤"
fi

echo -e "\n===== 滑点分析联调测试完成 ====="