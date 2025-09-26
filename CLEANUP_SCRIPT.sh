#!/bin/bash

# V5-激进优化版策略 - 清理脚本
# 删除过时的回测结果文件，只保留核心结果

echo "🧹 开始清理过时的回测结果文件..."

# 进入回测结果目录
cd "$(dirname "$0")/data/backtest-results" || exit 1

# 保留的核心文件列表 (最新的重要结果)
KEEP_FILES=(
    "2025-data-validation-2025-09-26T15-04-40-625Z.json"
    "final-strategy-validation-2025-09-26T14-59-14-360Z.json"
    "logic-verification-2025-09-26T15-08-07-358Z.json"
    "optimized-parameters-2025-09-26T14-54-51-106Z.json"
    "profit-maximization-results-2025-09-26T14-39-28-821Z.json"
    "realistic-validation-results-2025-09-26T14-50-21-188Z.json"
    "ultimate-validation-results-2025-09-26T14-45-07-038Z.json"
    "enhanced-realistic-optimizer-v4-2025-09-26T10-52-59-197Z.json"
)

# 创建临时目录保存核心文件
mkdir -p ../temp_keep

# 复制核心文件到临时目录
echo "📋 保存核心结果文件..."
for file in "${KEEP_FILES[@]}"; do
    if [ -f "$file" ]; then
        cp "$file" ../temp_keep/
        echo "  ✅ 保存: $file"
    else
        echo "  ⚠️  未找到: $file"
    fi
done

# 删除所有文件
echo "🗑️  删除所有旧文件..."
rm -f *.json

# 恢复核心文件
echo "📂 恢复核心文件..."
mv ../temp_keep/* ./

# 删除临时目录
rmdir ../temp_keep

echo "✅ 清理完成！"
echo ""
echo "📊 保留的核心文件:"
ls -la *.json | while read -r line; do
    echo "  $line"
done

echo ""
echo "🎯 清理总结:"
echo "  - 删除了所有过时的回测结果文件"
echo "  - 保留了 ${#KEEP_FILES[@]} 个核心结果文件"
echo "  - 节省了大量存储空间"
echo ""
echo "📁 保留的文件说明:"
echo "  - 2025-data-validation-*.json: 2025年真实数据验证结果"
echo "  - final-strategy-validation-*.json: 最终策略验证结果"
echo "  - logic-verification-*.json: 逻辑验证结果"
echo "  - optimized-parameters-*.json: 优化参数结果"
echo "  - profit-maximization-results-*.json: 盈利最大化探索结果"
echo "  - realistic-validation-results-*.json: 现实验证结果"
echo "  - ultimate-validation-results-*.json: 终极验证结果"
echo "  - enhanced-realistic-optimizer-v4-*.json: V4优化器结果"
echo ""
echo "🚀 V5-激进优化版策略文件清理完成！"