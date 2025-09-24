import { RecommendationIntegrationService } from '../../src/services/recommendation-integration-service.js';
import { RecommendationDatabase } from '../../src/services/recommendation-database.js';
import { KronosClient } from '../../src/ml/kronos-client.js';
import { WebServer } from '../../src/server/web-server.js';
import { RiskManagementService } from '../../src/services/risk-management-service.js';
import { enhancedOKXDataService } from '../../src/services/enhanced-okx-data-service.js';
import { ethStrategyEngine } from '../../src/strategy/eth-strategy-engine.js';
import { tradingSignalService } from '../../src/services/trading-signal-service.js';
import { riskManagementService } from '../../src/services/risk-management-service.js';

// Mock 依赖
jest.mock('../../src/services/recommendation-database.js');
jest.mock('../../src/ml/kronos-client.js');
jest.mock('../../src/server/web-server.js');

describe('阈值自适应调整算法测试', () => {
  let integrationService: RecommendationIntegrationService;
  let mockDatabase: jest.Mocked<RecommendationDatabase>;
  let mockKronosClient: jest.Mocked<KronosClient>;
  let mockWebServer: jest.Mocked<WebServer>;

  beforeEach(() => {
    // 创建mock实例
    mockDatabase = new RecommendationDatabase() as jest.Mocked<RecommendationDatabase>;
    mockKronosClient = new KronosClient() as jest.Mocked<KronosClient>;
    mockWebServer = new WebServer() as jest.Mocked<WebServer>;

    // 初始化服务
    integrationService = new RecommendationIntegrationService(
      enhancedOKXDataService,
      ethStrategyEngine,
      tradingSignalService,
      riskManagementService
    );

    // 设置默认mock返回值
    mockDatabase.getSlippageAnalysis.mockResolvedValue([]);
    mockDatabase.getSlippageStatistics.mockResolvedValue([]);
    mockDatabase.getSlippageThresholds.mockResolvedValue([]);
    mockDatabase.saveSlippageThreshold.mockImplementation(() => Promise.resolve());
    mockDatabase.saveSlippageAnalysis.mockResolvedValue(1);
    mockDatabase.updateSlippageStatistics.mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('基础阈值提升逻辑', () => {
    test('应该在高滑点时提升阈值', async () => {
      // 模拟高滑点数据
      const highSlippageData = [
        {
          recommendation_id: 'test-rec-high',
          symbol: 'BTC-USDT',
          direction: 'LONG' as const,
          slippage_bps: 35,
          slippage_category: 'EXTREME' as const,
          expected_price: 50000,
          actual_price: 50175,
          price_difference: 175,
          price_difference_bps: 35,
          total_cost_bps: 40,
          execution_latency_ms: 200,
          fee_rate_bps: 5,
          fee_amount: 25,
          original_threshold: 15,
          market_session: 'OPEN',
          created_at: new Date()
        }
      ];

      mockDatabase.getSlippageAnalysis.mockResolvedValue(highSlippageData);

      // 执行阈值提升逻辑（通过记录滑点分析触发）
      await integrationService.recordSlippageAnalysis(
        {
          id: 'test-rec-1',
          symbol: 'BTC-USDT',
          direction: 'LONG',
          entry_price: 50000
        },
        {
          executed_price: 50175,
          executed_time: Date.now(),
          latency_ms: 200,
          fee_rate_bps: 5,
          fee_amount: 25
        }
      );

      // 验证阈值被保存（提升）
      expect(mockDatabase.saveSlippageThreshold).toHaveBeenCalled();
      
      // 验证警报被发送
      expect(mockWebServer.broadcastAlert).toHaveBeenCalledWith(
        'CRITICAL',
        expect.stringContaining('CRITICAL')
      );
    });

    test('应该在正常滑点时保持阈值', async () => {
      // 模拟正常滑点数据
      const normalSlippageData = [
        {
          recommendation_id: 'test-rec-normal',
          symbol: 'BTC-USDT',
          direction: 'LONG' as const,
          slippage_bps: 3,
          slippage_category: 'LOW' as const,
          expected_price: 50000,
          actual_price: 50015,
          price_difference: 15,
          price_difference_bps: 3,
          total_cost_bps: 8,
          execution_latency_ms: 100,
          fee_rate_bps: 5,
          fee_amount: 15,
          original_threshold: 15,
          market_session: 'OPEN',
          created_at: new Date()
        }
      ];

      mockDatabase.getSlippageAnalysis.mockResolvedValue(normalSlippageData);

      // 执行阈值保持逻辑
      await integrationService.recordSlippageAnalysis(
        {
          id: 'test-rec-2',
          symbol: 'BTC-USDT',
          direction: 'LONG',
          entry_price: 50000
        },
        {
          executed_price: 50015,
          executed_time: Date.now(),
          latency_ms: 100,
          fee_rate_bps: 5,
          fee_amount: 15
        }
      );

      // 验证没有阈值调整
      expect(mockDatabase.saveSlippageThreshold).not.toHaveBeenCalled();
      
      // 验证没有警报发送（只有INFO级别）
      expect(mockWebServer.broadcastAlert).not.toHaveBeenCalledWith(
        'WARNING',
        expect.any(String)
      );
    });
  });

  describe('阈值恢复机制', () => {
    test('应该在指定时间后恢复阈值', async () => {
      jest.useFakeTimers();
      
      // 模拟高滑点触发阈值提升
      const highSlippageData = [
        {
          recommendation_id: 'test-rec-recovery',
          symbol: 'BTC-USDT',
          direction: 'LONG' as const,
          slippage_bps: 25,
          slippage_category: 'HIGH' as const,
          expected_price: 50000,
          actual_price: 50125,
          price_difference: 125,
          price_difference_bps: 25,
          total_cost_bps: 30,
          execution_latency_ms: 150,
          fee_rate_bps: 5,
          fee_amount: 20,
          original_threshold: 15,
          market_session: 'OPEN',
          created_at: new Date()
        }
      ];

      mockDatabase.getSlippageAnalysis.mockResolvedValue(highSlippageData);

      // 触发阈值提升
      await integrationService.recordSlippageAnalysis(
        {
          id: 'test-rec-3',
          symbol: 'BTC-USDT',
          direction: 'LONG',
          entry_price: 50000
        },
        {
          executed_price: 50125,
          executed_time: Date.now(),
          latency_ms: 150,
          fee_rate_bps: 5,
          fee_amount: 20
        }
      );

      // 验证初始阈值提升
      expect(mockDatabase.saveSlippageThreshold).toHaveBeenCalledTimes(1);

      // 模拟时间流逝（31分钟后）
      jest.advanceTimersByTime(31 * 60 * 1000);

      // 等待异步恢复操作
      await new Promise(resolve => setTimeout(resolve, 100));

      // 验证阈值恢复
      expect(mockDatabase.saveSlippageThreshold).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });

  describe('多层级阈值管理', () => {
    test('应该根据滑点等级调整不同层级的阈值', async () => {
      const testCases = [
        { slippage: 3, category: 'LOW', shouldAdjust: false },
        { slippage: 8, category: 'MEDIUM', shouldAdjust: false },
        { slippage: 18, category: 'HIGH', shouldAdjust: true },
        { slippage: 35, category: 'EXTREME', shouldAdjust: true }
      ];

      for (const testCase of testCases) {
        jest.clearAllMocks();
        
        const slippageData = [
           {
             recommendation_id: `test-rec-${testCase.category}`,
             symbol: 'BTC-USDT',
             direction: 'LONG' as const,
             slippage_bps: testCase.slippage,
             slippage_category: testCase.category as any,
             expected_price: 50000,
             actual_price: 50000 + (testCase.slippage * 5), // 模拟价格差异
             price_difference: testCase.slippage * 5,
             price_difference_bps: testCase.slippage,
             total_cost_bps: testCase.slippage + 5,
             execution_latency_ms: 120,
             fee_rate_bps: 5,
             fee_amount: testCase.slippage + 5,
             original_threshold: 15,
             market_session: 'OPEN',
             created_at: new Date()
           }
         ];

        mockDatabase.getSlippageAnalysis.mockResolvedValue(slippageData);

        await integrationService.recordSlippageAnalysis(
          {
            id: `test-rec-${testCase.category}`,
            symbol: 'BTC-USDT',
            direction: 'LONG',
            entry_price: 50000
          },
          {
            executed_price: 50000 + (testCase.slippage * 5),
            executed_time: Date.now(),
            latency_ms: 120,
            fee_rate_bps: 5,
            fee_amount: testCase.slippage + 5
          }
        );

        if (testCase.shouldAdjust) {
          expect(mockDatabase.saveSlippageThreshold).toHaveBeenCalled();
        } else {
          expect(mockDatabase.saveSlippageThreshold).not.toHaveBeenCalled();
        }
      }
    });
  });

  describe('异常情况处理', () => {
    test('应该处理数据库错误', async () => {
      // 模拟数据库错误
      mockDatabase.saveSlippageAnalysis.mockRejectedValue(new Error('Database connection failed'));

      // 执行应该不抛出错误
      await expect(
        integrationService.recordSlippageAnalysis(
          {
            id: 'test-rec-error',
            symbol: 'BTC-USDT',
            direction: 'LONG',
            entry_price: 50000
          },
          {
            executed_price: 50100,
            executed_time: Date.now(),
            latency_ms: 150,
            fee_rate_bps: 5,
            fee_amount: 20
          }
        )
      ).resolves.not.toThrow();
    });

    test('应该处理缺失数据的情况', async () => {
      // 执行缺少关键数据的分析
      await integrationService.recordSlippageAnalysis(
        {
          id: 'test-rec-missing',
          symbol: 'BTC-USDT',
          direction: 'LONG',
          entry_price: null // 缺少价格数据
        },
        {
          executed_price: null,
          executed_time: Date.now(),
          latency_ms: 150,
          fee_rate_bps: 5,
          fee_amount: 20
        }
      );

      // 验证没有错误抛出，但也没有进一步处理
      expect(mockDatabase.saveSlippageAnalysis).not.toHaveBeenCalled();
    });
  });

  describe('算法性能验证', () => {
    test('应该快速处理大量滑点数据', async () => {
      // 生成大量测试数据
      const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
        recommendation_id: `test-rec-${i}`,
        symbol: 'BTC-USDT',
        direction: 'LONG' as const,
        slippage_bps: Math.random() * 50,
        slippage_category: (['LOW', 'MEDIUM', 'HIGH', 'EXTREME'] as const)[Math.floor(Math.random() * 4)],
        expected_price: 50000,
        actual_price: 50000 + Math.random() * 250,
        price_difference: Math.random() * 250,
        price_difference_bps: Math.random() * 50,
        total_cost_bps: Math.random() * 55,
        execution_latency_ms: Math.random() * 500,
        fee_rate_bps: 5,
        fee_amount: Math.random() * 25,
        original_threshold: 15,
        market_session: 'OPEN',
        created_at: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000)
      }));

      mockDatabase.getSlippageAnalysis.mockResolvedValue(largeDataset);

      const startTime = Date.now();

      // 通过记录滑点分析触发统计更新
      await integrationService.recordSlippageAnalysis(
        {
          id: 'test-rec-stats',
          symbol: 'BTC-USDT',
          direction: 'LONG',
          entry_price: 50000
        },
        {
          executed_price: 50150,
          executed_time: Date.now(),
          latency_ms: 150,
          fee_rate_bps: 5,
          fee_amount: 25
        }
      );
      
      // 验证统计结果被更新
      expect(mockDatabase.saveSlippageAnalysis).toHaveBeenCalled();

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // 验证执行时间在合理范围内（小于5秒）
      expect(executionTime).toBeLessThan(5000);

      // 验证统计结果被更新
       expect(mockDatabase.saveSlippageAnalysis).toHaveBeenCalled();
    });
  });

  describe('阈值自适应逻辑验证', () => {
    test('应该基于历史数据自适应调整阈值', async () => {
      // 模拟历史滑点数据，显示滑点上升趋势
      const historicalData = [];
      for (let i = 0; i < 30; i++) {
        historicalData.push({
          recommendation_id: `test-rec-${i}`,
          symbol: 'BTC-USDT',
          direction: 'LONG' as const,
          slippage_bps: 5 + (i * 0.8) + Math.random() * 3, // 逐渐上升的滑点
          slippage_category: i > 20 ? 'HIGH' as const : 'MEDIUM' as const,
          expected_price: 50000,
          actual_price: 50000 + (5 + i * 0.8) * 5,
          price_difference: (5 + i * 0.8) * 5,
          price_difference_bps: 5 + i * 0.8,
          total_cost_bps: 10 + i * 0.8,
          execution_latency_ms: 100 + i * 2,
          fee_rate_bps: 5,
          fee_amount: 25,
          original_threshold: 15,
          market_session: 'OPEN',
          created_at: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000)
        });
      }

      mockDatabase.getSlippageAnalysis.mockResolvedValue(historicalData);

      // 执行统计分析（通过记录滑点分析触发统计更新）
      await integrationService.recordSlippageAnalysis({
        id: 'test-analysis-stats',
        symbol: 'BTC-USDT',
        direction: 'LONG',
        entry_price: 50000
      },{
        executed_price: 50075,
        executed_time: Date.now(),
        latency_ms: 120,
        fee_rate_bps: 5,
        fee_amount: 18
      });

      // 验证统计结果被正确计算
      expect(mockDatabase.saveSlippageAnalysis).toHaveBeenCalled();

      // 验证趋势分析被正确执行
       const callArg = mockDatabase.saveSlippageAnalysis.mock.calls[0][0];
       expect(callArg.slippage_bps).toBeGreaterThan(15); // 应该检测到较高的平均滑点
    });
  });
});