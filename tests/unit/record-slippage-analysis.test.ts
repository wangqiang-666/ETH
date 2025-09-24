/**
 * 单元测试：recordSlippageAnalysis 方法
 * 隔离测试滑点分析记录功能，避免依赖注入问题
 */

import { RecommendationIntegrationService } from '../../src/services/recommendation-integration-service.js';
import { RecommendationDatabase } from '../../src/services/recommendation-database.js';

// Mock 依赖
jest.mock('../../src/services/recommendation-database.js');

// 禁用定时器相关的控制台日志
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;

beforeAll(() => {
  console.warn = jest.fn();
  console.log = jest.fn();
});

afterAll(() => {
  console.warn = originalConsoleWarn;
  console.log = originalConsoleLog;
});

describe('recordSlippageAnalysis 方法单元测试', () => {
  let integrationService: RecommendationIntegrationService;
  let mockDatabase: jest.Mocked<RecommendationDatabase>;

  beforeEach(() => {
    // 创建mock实例
    mockDatabase = new RecommendationDatabase() as jest.Mocked<RecommendationDatabase>;
    
    // 创建精简的服务实例，避免复杂的依赖注入
    integrationService = new RecommendationIntegrationService(
      {} as any, // mock dataService
      {} as any, // mock strategyEngine  
      {} as any, // mock signalService
      {} as any  // mock riskService
    );

    // 替换数据库实例为mock
    (integrationService as any).database = mockDatabase;
    
    // 设置默认mock返回值
    mockDatabase.saveSlippageAnalysis.mockResolvedValue(1);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('方法签名兼容性', () => {
    test('应该支持直接传入分析数据对象', async () => {
      const analysisData = {
        recommendation_id: 'test-rec-1',
        symbol: 'BTC-USDT',
        direction: 'LONG' as const,
        expected_price: 50000,
        actual_price: 50100,
        price_difference: 100,
        price_difference_bps: 20,
        execution_latency_ms: 120,
        slippage_bps: 20,
        slippage_category: 'HIGH' as const,
        original_threshold: 15,
        market_session: 'OPEN',
        created_at: new Date()
      };

      await integrationService.recordSlippageAnalysis(analysisData);

      expect(mockDatabase.saveSlippageAnalysis).toHaveBeenCalledWith(analysisData);
      expect(mockDatabase.saveSlippageAnalysis).toHaveBeenCalledTimes(1);
    });

    test('应该支持推荐信息+执行数据的调用方式', async () => {
      const recommendation = {
        id: 'test-rec-2',
        symbol: 'BTC-USDT',
        direction: 'LONG',
        entry_price: 50000
      };

      const executionData = {
        executed_price: 50125,
        executed_time: Date.now(),
        latency_ms: 150,
        fee_rate_bps: 5,
        fee_amount: 25
      };

      await integrationService.recordSlippageAnalysis(recommendation, executionData);

      expect(mockDatabase.saveSlippageAnalysis).toHaveBeenCalled();
      const callArg = mockDatabase.saveSlippageAnalysis.mock.calls[0][0];
      
      // 验证转换后的数据结构
      expect(callArg.recommendation_id).toBe('test-rec-2');
      expect(callArg.symbol).toBe('BTC-USDT');
      expect(callArg.direction).toBe('LONG');
      expect(callArg.expected_price).toBe(50000);
      expect(callArg.actual_price).toBe(50125);
      expect(callArg.price_difference).toBe(125);
      expect(callArg.price_difference_bps).toBeCloseTo(25, 2); // 125/50000*10000
      expect(callArg.execution_latency_ms).toBe(150);
      expect(callArg.fee_rate_bps).toBe(5);
      expect(callArg.fee_amount).toBe(25);
      expect(callArg.slippage_bps).toBeCloseTo(25, 2);
      expect(callArg.slippage_category).toBe('HIGH');
    });
  });

  describe('错误处理', () => {
    test('应该处理数据库保存失败的情况', async () => {
      mockDatabase.saveSlippageAnalysis.mockRejectedValue(new Error('Database connection failed'));

      const analysisData = {
        recommendation_id: 'test-rec-error',
        symbol: 'BTC-USDT',
        direction: 'LONG' as const,
        expected_price: 50000,
        actual_price: 50100,
        price_difference: 100,
        price_difference_bps: 20,
        execution_latency_ms: 120,
        slippage_bps: 20,
        slippage_category: 'HIGH' as const,
        original_threshold: 15,
        market_session: 'OPEN',
        created_at: new Date()
      };

      await expect(integrationService.recordSlippageAnalysis(analysisData)).rejects.toThrow('Database connection failed');
    });

    test('应该处理缺少关键数据的情况', async () => {
      const recommendation = {
        id: 'test-rec-missing',
        symbol: 'BTC-USDT',
        direction: 'LONG',
        entry_price: null // 缺少价格数据
      };

      const executionData = {
        executed_price: null,
        executed_time: Date.now(),
        latency_ms: 150,
        fee_rate_bps: 5,
        fee_amount: 20
      };

      // 这种情况应该抛出错误，因为无法进行计算
      await expect(integrationService.recordSlippageAnalysis(recommendation, executionData)).rejects.toThrow();
    });
  });

  describe('滑点分类逻辑', () => {
    test('应该正确分类不同滑点级别', async () => {
      const testCases = [
        { slippage: 2, expected: 'LOW' },
        { slippage: 8, expected: 'MEDIUM' },
        { slippage: 20, expected: 'HIGH' },
        { slippage: 35, expected: 'EXTREME' }
      ];

      for (const testCase of testCases) {
        const recommendation = {
          id: `test-rec-${testCase.slippage}`,
          symbol: 'BTC-USDT',
          direction: 'LONG',
          entry_price: 50000
        };

        const executionData = {
          executed_price: 50000 + (testCase.slippage * 5), // 模拟价格差异
          executed_time: Date.now(),
          latency_ms: 120,
          fee_rate_bps: 5,
          fee_amount: testCase.slippage + 5
        };

        await integrationService.recordSlippageAnalysis(recommendation, executionData);

        const callArg = mockDatabase.saveSlippageAnalysis.mock.calls[mockDatabase.saveSlippageAnalysis.mock.calls.length - 1][0];
        expect(callArg.slippage_category).toBe(testCase.expected);
      }
    });
  });

  describe('性能测试', () => {
    test('应该快速处理大量滑点数据', async () => {
      const startTime = Date.now();

      // 模拟处理100条滑点记录
      const promises = Array.from({ length: 100 }, (_, i) => {
        const analysisData = {
          recommendation_id: `test-rec-${i}`,
          symbol: 'BTC-USDT',
          direction: 'LONG' as const,
          expected_price: 50000,
          actual_price: 50000 + Math.random() * 200,
          price_difference: Math.random() * 200,
          price_difference_bps: Math.random() * 40,
          execution_latency_ms: Math.random() * 500,
          slippage_bps: Math.random() * 40,
          slippage_category: 'MEDIUM' as const,
          original_threshold: 15,
          market_session: 'OPEN',
          created_at: new Date()
        };

        return integrationService.recordSlippageAnalysis(analysisData);
      });

      await Promise.all(promises);

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // 验证执行时间在合理范围内（小于2秒）
      expect(executionTime).toBeLessThan(2000);
      expect(mockDatabase.saveSlippageAnalysis).toHaveBeenCalledTimes(100);
    });
  });
});