# 测试框架文档

## 概述

这个测试框架包含三个主要的测试脚本，用于验证A/B测试框架和多策略并行执行功能的完整性和性能。

## 测试脚本

### 1. A/B测试框架测试 (`test-ab-testing.cjs`)

验证A/B测试框架的所有核心功能：

- **实验配置获取**: 验证实验配置的读取和解析
- **变体分配一致性**: 确保同一用户始终分配到相同的变体
- **推荐创建**: 验证带A/B测试的推荐创建过程
- **变体统计**: 测试变体统计信息的获取和计算
- **A/B测试报告**: 验证报告生成和数据导出功能
- **CSV报告格式**: 测试CSV格式的报告导出

#### 运行方式
```bash
node test-ab-testing.cjs
```

#### 环境变量
- `API_URL`: API服务器URL (默认: `http://localhost:3033/api`)

### 2. 多策略并行执行测试 (`test-multi-strategy.cjs`)

测试多策略并行执行的性能和功能：

- **单策略创建性能**: 测试单个策略的创建时间
- **多策略并行创建**: 验证多个策略的并行执行
- **批量并行创建**: 测试批量推荐的并行创建性能
- **策略执行状态**: 验证策略执行状态的查询功能
- **推荐列表获取**: 测试多策略推荐的查询功能

#### 运行方式
```bash
node test-multi-strategy.cjs
```

#### 环境变量
- `API_URL`: API服务器URL (默认: `http://localhost:3033/api`)

### 3. 综合测试运行器 (`run-all-tests.cjs`)

自动运行所有测试并生成综合报告：

- **自动执行**: 依次运行所有测试脚本
- **结果收集**: 自动收集和整理测试结果
- **报告生成**: 生成详细的测试报告
- **性能分析**: 提供性能指标和分析

#### 运行方式
```bash
node run-all-tests.cjs
```

#### 命令行选项
- `--help, -h`: 显示帮助信息
- `--api-url URL`: 设置API服务器URL

#### 环境变量
- `API_URL`: API服务器URL (默认: `http://localhost:3033/api`)

## 测试结果

所有测试结果都会保存在 `test-data/` 目录中：

- `ab-test-results.json`: A/B测试框架测试结果
- `multi-strategy-results.json`: 多策略并行执行测试结果
- `test-summary.json`: 综合测试报告

## 测试数据

测试使用以下数据：

### A/B测试
- **实验ID**: `recommendation-strategy-v1`
- **测试用户**: 10个测试用户 (user-001 到 user-010)
- **交易对**: BTC-USDT, ETH-USDT, SOL-USDT

### 多策略测试
- **策略类型**: MOMENTUM, MEAN_REVERSION, BREAKOUT, VOLUME_PROFILE
- **交易对**: BTC-USDT, ETH-USDT, SOL-USDT, ADA-USDT, DOT-USDT
- **策略数量**: 2-4个策略并行执行

## 性能指标

测试框架会收集以下性能指标：

- **创建时间**: 推荐创建的平均耗时
- **吞吐量**: 每秒创建的推荐数量
- **成功率**: 各种操作的成功率
- **变体分配**: A/B测试的变体分配分布
- **策略执行**: 各策略的执行时间和成功率

## 错误处理

测试框架包含完整的错误处理：

- **网络错误**: 处理API连接失败
- **数据验证**: 验证返回数据的完整性
- **超时处理**: 处理长时间运行的测试
- **异常捕获**: 捕获和记录所有异常

## 使用示例

### 基本使用
```bash
# 运行所有测试
node run-all-tests.cjs

# 运行单个测试
node test-ab-testing.cjs
node test-multi-strategy.cjs
```

### 指定API服务器
```bash
# 使用命令行参数
node run-all-tests.cjs --api-url http://localhost:8080/api

# 使用环境变量
API_URL=http://localhost:8080/api node run-all-tests.cjs
```

### 查看帮助
```bash
node run-all-tests.cjs --help
```

## 故障排除

### 常见问题

1. **API连接失败**
   - 确保API服务器正在运行
   - 检查API_URL设置是否正确
   - 验证网络连接

2. **测试超时**
   - 增加等待时间
   - 检查数据库性能
   - 查看API服务器日志

3. **数据验证失败**
   - 检查数据库schema
   - 验证API响应格式
   - 查看测试数据完整性

### 调试模式
可以通过设置环境变量启用详细日志：
```bash
DEBUG=true node run-all-tests.cjs
```

## 扩展测试

要添加新的测试：

1. 创建新的测试脚本文件
2. 遵循现有的错误处理和结果格式
3. 更新 `run-all-tests.cjs` 中的 `TEST_SCRIPTS` 数组
4. 添加相应的测试结果收集逻辑

## 注意事项

- 测试会创建真实的数据，建议在测试环境中运行
- 测试可能需要较长时间，请耐心等待
- 确保有足够的系统资源（内存、CPU）
- 测试完成后清理测试数据（可选）