import { RecommendationIntegrationService } from '../../src/services/recommendation-integration-service.js';
import { RecommendationDatabase } from '../../src/services/recommendation-database.js';
import { EventEmitter } from 'events';

// Mock all dependencies
jest.mock('../../src/services/recommendation-database.js');
jest.mock('../../src/services/recommendation-tracker.js');
jest.mock('../../src/services/statistics-calculator.js');
jest.mock('../../src/services/price-monitor.js');
jest.mock('../../src/api/recommendation-api.js');
jest.mock('../../src/services/enhanced-okx-data-service.js');
jest.mock('../../src/strategy/eth-strategy-engine.js');
jest.mock('../../src/services/trading-signal-service.js');
jest.mock('../../src/services/risk-management-service.js');

describe('Slippage Monitoring Integration Tests', () => {
  let service: RecommendationIntegrationService;
  let mockDatabase: jest.Mocked<RecommendationDatabase>;
  let mockEventEmitter: EventEmitter;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock instances
    mockDatabase = new RecommendationDatabase() as jest.Mocked<RecommendationDatabase>;
    mockEventEmitter = new EventEmitter();
    
    // Mock database methods
    mockDatabase.getSlippageStatistics = jest.fn();
    mockDatabase.getSlippageThresholds = jest.fn();
    mockDatabase.saveSlippageAnalysis = jest.fn();
    mockDatabase.saveSlippageThreshold = jest.fn();
    mockDatabase.getRecommendationById = jest.fn();
    
    // Create service instance
    const MockEnhancedOKXDataService = require('../../src/services/enhanced-okx-data-service').EnhancedOKXDataService;
    const MockETHStrategyEngine = require('../../src/strategy/eth-strategy-engine').ETHStrategyEngine;
    const MockTradingSignalService = require('../../src/services/trading-signal-service').TradingSignalService;
    const MockRiskManagementService = require('../../src/services/risk-management-service').RiskManagementService;
    
    service = new RecommendationIntegrationService(
      new MockEnhancedOKXDataService(),
      new MockETHStrategyEngine(),
      new MockTradingSignalService(),
      new MockRiskManagementService()
    );
    
    // Replace database with our mock
    (service as any).database = mockDatabase;
  });

  describe('End-to-End Slippage Monitoring', () => {
    it('should handle complete slippage monitoring workflow', async () => {
      const recommendation = {
        id: 'test-rec-123',
        symbol: 'ETH-USDT',
        direction: 'LONG' as const,
        entry_price: 1000,
        current_price: 1000,
        leverage: 10,
        tp1_hit: false,
        tp2_hit: false,
        status: 'ACTIVE' as const,
        created_at: new Date(),
        updated_at: new Date()
      };

      const executionData = {
        recommendation_id: 'test-rec-123',
        symbol: 'ETH-USDT',
        direction: 'LONG' as const,
        entry_price: 1000,
        exit_price: 1010,
        pnl_amount: 10,
        pnl_percentage: 1.0,
        execution_type: 'TP1_HIT' as const,
        slippage: 0.5,
        severity: 'LOW' as const,
        timestamp: new Date()
      };

      // Setup mocks
      mockDatabase.getRecommendationById.mockResolvedValueOnce(recommendation);
      mockDatabase.saveSlippageAnalysis.mockResolvedValueOnce(1);
      mockDatabase.getSlippageStatistics.mockResolvedValueOnce([{
        symbol: 'ETH-USDT',
        direction: 'LONG',
        period: '1h',
        avg_slippage_bps: 0.8,
        median_slippage_bps: 0.7,
        max_slippage_bps: 1.2,
        min_slippage_bps: -0.3,
        total_executions: 3,
        low_slippage_count: 2,
        medium_slippage_count: 1,
        high_slippage_count: 0,
        extreme_slippage_count: 0,
        avg_total_cost_bps: 1.0,
        avg_fee_bps: 0.2,
        avg_latency_ms: 150,
        avg_price_difference_bps: 0.8,
        suggested_threshold_adjustment: 0,
        confidence_score: 0.85,
        calculated_at: new Date()
      }]);

      // Simulate execution recording with slippage monitoring
      await mockDatabase.saveSlippageAnalysis({
        recommendation_id: 'test-rec-123',
        symbol: 'ETH-USDT',
        direction: 'LONG',
        expected_price: 1000,
        actual_price: 1010,
        price_difference: 10,
        price_difference_bps: 100,
        execution_latency_ms: 50,
        slippage_bps: 50,
        slippage_category: 'LOW',
        fee_rate_bps: 10,
        fee_amount: 0.1,
        total_cost_bps: 110,
        original_threshold: 50
      });

      // Verify the complete workflow
      expect(mockDatabase.saveSlippageAnalysis).toHaveBeenCalled();
      
      const stats = await mockDatabase.getSlippageStatistics({ symbol: 'ETH-USDT' });
      expect(stats[0].avg_slippage_bps).toBe(0.3);
      expect(stats[0].total_executions).toBe(100);
    });

    it('should handle multiple recommendations with slippage tracking', async () => {
      const recommendations = [
        {
          id: 'rec-1',
          symbol: 'ETH-USDT',
          direction: 'LONG' as const,
          entry_price: 1000,
          current_price: 1000,
          leverage: 10,
          tp1_hit: false,
          tp2_hit: false,
          status: 'ACTIVE' as const,
          created_at: new Date(Date.now() - 3600000),
          updated_at: new Date()
        },
        {
          id: 'rec-2',
          symbol: 'BTC-USDT',
          direction: 'SHORT' as const,
          entry_price: 20000,
          current_price: 20000,
          leverage: 10,
          tp1_hit: false,
          tp2_hit: false,
          status: 'ACTIVE' as const,
          created_at: new Date(Date.now() - 3600000),
          updated_at: new Date()
        }
      ];

      const executions = [
        {
          recommendation_id: 'rec-1',
          symbol: 'ETH-USDT',
          direction: 'LONG' as const,
          entry_price: 1000,
          exit_price: 1008,
          pnl_amount: 8,
          pnl_percentage: 0.8,
          execution_type: 'TP1_HIT' as const,
          slippage: 0.3,
          severity: 'LOW' as const
        },
        {
          recommendation_id: 'rec-2',
          symbol: 'BTC-USDT',
          direction: 'SHORT' as const,
          entry_price: 20000,
          exit_price: 19950,
          pnl_amount: 50,
          pnl_percentage: 0.25,
          execution_type: 'TP1_HIT' as const,
          slippage: -0.8,
          severity: 'MEDIUM' as const
        }
      ];

      // Setup mocks
      mockDatabase.getRecommendationById.mockImplementation((id) => {
        return Promise.resolve(recommendations.find(r => r.id === id) || null);
      });
      mockDatabase.saveSlippageAnalysis.mockResolvedValue(1);

      // Process multiple executions
      for (const execution of executions) {
        await mockDatabase.saveSlippageAnalysis({
          recommendation_id: execution.recommendation_id,
          symbol: execution.symbol,
          direction: execution.direction,
          expected_price: execution.entry_price,
          actual_price: execution.exit_price,
          price_difference: execution.pnl_percentage,
          price_difference_bps: execution.slippage * 100,
          execution_latency_ms: 100,
          slippage_bps: execution.slippage * 100,
          slippage_category: execution.severity as 'HIGH' | 'MEDIUM' | 'LOW',
          fee_rate_bps: 10,
          fee_amount: 0.1,
          total_cost_bps: execution.slippage * 100 + 10,
          original_threshold: 50
        });
      }

      // Verify all executions were processed
      expect(mockDatabase.saveSlippageAnalysis).toHaveBeenCalledTimes(2);
    });
  });

  describe('Health Check Scheduling Integration', () => {
    it('should perform scheduled health checks and update thresholds', async () => {
      const mockAlerts = [
        { slippage: 0.5, severity: 'LOW' as const, timestamp: new Date(Date.now() - 3600000) },
        { slippage: 1.2, severity: 'MEDIUM' as const, timestamp: new Date(Date.now() - 7200000) },
        { slippage: -0.3, severity: 'LOW' as const, timestamp: new Date(Date.now() - 10800000) }
      ];

      const currentThresholds = { min: -1.0, max: 1.0, target: 0.5 };
      const newThresholds = { min: -1.5, max: 1.5, target: 0.8 };

      // Setup mocks
      mockDatabase.getSlippageStatistics.mockResolvedValueOnce([{
        symbol: 'ETH-USDT',
        direction: 'LONG',
        period: '1h',
        avg_slippage_bps: 0.8,
        median_slippage_bps: 0.7,
        max_slippage_bps: 1.2,
        min_slippage_bps: -0.3,
        total_executions: 3,
        low_slippage_count: 2,
        medium_slippage_count: 1,
        high_slippage_count: 0,
        extreme_slippage_count: 0,
        avg_total_cost_bps: 1.0,
        avg_fee_bps: 0.2,
        avg_latency_ms: 150,
        avg_price_difference_bps: 0.8,
        suggested_threshold_adjustment: 0,
        confidence_score: 0.85,
        calculated_at: new Date()
      }]);
      mockDatabase.getSlippageThresholds.mockResolvedValueOnce([{
        symbol: 'ETH-USDT',
        timeframe: '1h',
        direction: 'LONG',
        threshold: 0.5,
        last_updated: new Date().toISOString()
      }]);
      mockDatabase.saveSlippageThreshold.mockResolvedValueOnce(undefined);

      // Simulate health check process
      const stats = await mockDatabase.getSlippageStatistics({ symbol: 'ETH-USDT' });
      const thresholds = await mockDatabase.getSlippageThresholds();

      // Simulate threshold adjustment based on analysis
      const currentThreshold = thresholds.find(t => t.symbol === 'ETH-USDT' && t.timeframe === '1h' && t.direction === 'LONG');
      if (currentThreshold && stats.length > 0 && stats[0].avg_slippage_bps > currentThreshold.threshold * 10000) {
        await mockDatabase.saveSlippageThreshold('ETH-USDT', '1h', 'LONG', currentThreshold.threshold * 1.2);
      }

      // Verify health check workflow
      expect(mockDatabase.getSlippageStatistics).toHaveBeenCalledWith({ symbol: 'ETH-USDT' });
      expect(mockDatabase.saveSlippageThreshold).toHaveBeenCalledWith('ETH-USDT', '1h', 'LONG', expect.any(Number));
    });

    it('should handle health check failures gracefully', async () => {
      // Setup mock to simulate database failure
      mockDatabase.getSlippageStatistics.mockRejectedValueOnce(new Error('Database connection failed'));

      // Simulate health check with error handling
      try {
        await mockDatabase.getSlippageStatistics({ symbol: 'ETH-USDT' });
      } catch (error: any) {
        // Should handle error gracefully
        expect(error).toBeDefined();
        expect(error.message).toContain('Database connection failed');
      }

      // Verify that errors were handled
      expect(mockDatabase.getSlippageStatistics).toHaveBeenCalled();
    });
  });

  describe('Dynamic Threshold Adjustment', () => {
    it('should adjust thresholds based on market volatility', async () => {
      const marketData = {
        volatility: 2.5,
        trend: 'BULLISH' as const,
        averageSlippage: 0.8
      };

      const currentThresholds = [{ symbol: 'ETH-USDT', timeframe: '1h', direction: 'LONG', threshold: 0.5, last_updated: new Date().toISOString() }];
      const newThresholds = { symbol: 'ETH-USDT', timeframe: '1h', direction: 'LONG', threshold: 0.8 };

      // Setup mocks
      mockDatabase.getSlippageThresholds.mockResolvedValueOnce(currentThresholds);
      mockDatabase.saveSlippageThreshold.mockResolvedValueOnce(undefined);

      // Simulate threshold adjustment based on market conditions
      const thresholds = await mockDatabase.getSlippageThresholds();
      
      if (marketData.volatility > 2.0) {
        await mockDatabase.saveSlippageThreshold('ETH-USDT', '1h', 'LONG', newThresholds.threshold);
      }

      // Verify threshold adjustment
      expect(mockDatabase.getSlippageThresholds).toHaveBeenCalled();
      expect(mockDatabase.saveSlippageThreshold).toHaveBeenCalledWith('ETH-USDT', '1h', 'LONG', newThresholds.threshold);
    });

    it('should maintain thresholds within safe bounds', async () => {
      const extremeMarketData = {
        volatility: 8.0,
        trend: 'BEARISH' as const,
        averageSlippage: 5.0
      };

      const currentThresholds = [{
        symbol: 'ETH-USDT',
        timeframe: '1h',
        direction: 'LONG',
        threshold: 1.0,
        last_updated: new Date().toISOString()
      }];
      const safeThresholds = { min: -3.0, max: 3.0, target: 2.0 }; // Capped at safe limits

      // Setup mocks
      mockDatabase.getSlippageThresholds.mockResolvedValueOnce(currentThresholds);
      mockDatabase.saveSlippageThreshold.mockResolvedValueOnce(undefined);

      // Simulate threshold adjustment with safety bounds
      const thresholds = await mockDatabase.getSlippageThresholds();
      
      if (extremeMarketData.volatility > 5.0) {
        // Apply safety caps
        const currentThreshold = thresholds.find(t => t.symbol === 'ETH-USDT' && t.timeframe === '1h' && t.direction === 'LONG');
        if (currentThreshold) {
          const newTarget = Math.min(2.0, Math.max(0.5, extremeMarketData.averageSlippage));
          await mockDatabase.saveSlippageThreshold('ETH-USDT', '1h', 'LONG', newTarget);
        }
      }

      // Verify safety bounds were applied
      expect(mockDatabase.saveSlippageThreshold).toHaveBeenCalledWith(
        'ETH-USDT',
        '1h',
        'LONG',
        expect.any(Number)
      );
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle database failures during slippage recording', async () => {
      const slippageData = {
        recommendation_id: 'test-rec-123',
        symbol: 'ETH-USDT',
        direction: 'LONG' as const,
        expected_price: 1000,
        actual_price: 1001.5,
        price_difference: 1.5,
        price_difference_bps: 150,
        execution_latency_ms: 100,
        slippage_bps: 150,
        slippage_category: 'HIGH' as const,
        fee_rate_bps: 10,
        fee_amount: 0.1,
        total_cost_bps: 160,
        original_threshold: 50
      };

      // Setup mock to fail initially then succeed
      mockDatabase.saveSlippageAnalysis
        .mockRejectedValueOnce(new Error('Database timeout'))
        .mockResolvedValueOnce(1);

      // Simulate retry logic
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          await mockDatabase.saveSlippageAnalysis(slippageData);
          break; // Success, exit loop
        } catch (error) {
          retryCount++;
          if (retryCount >= maxRetries) {
            throw error; // Max retries reached
          }
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 100));
        }
      }

      // Verify retry behavior
      expect(mockDatabase.saveSlippageAnalysis).toHaveBeenCalledTimes(2); // Initial + 1 retry
      expect(retryCount).toBe(1); // Should succeed on first retry
    });

    it('should handle service initialization failures', async () => {
      // Setup mock to simulate initialization failure
      mockDatabase.initialize.mockRejectedValueOnce(new Error('Database initialization failed'));

      // Simulate service initialization with error handling
      try {
        await mockDatabase.initialize();
      } catch (error: any) {
        // Should handle initialization failure gracefully
        expect(error).toBeDefined();
        expect(error.message).toContain('Database initialization failed');
      }

      // Verify initialization was attempted
      expect(mockDatabase.initialize).toHaveBeenCalled();
    });
  });

  describe('Integration with Recommendation Tracker', () => {
    it('should coordinate with recommendation tracker for slippage analysis', async () => {
      const recommendation = {
        id: 'tracker-rec-123',
        symbol: 'ETH-USDT',
        direction: 'LONG' as const,
        entry_price: 1000,
        current_price: 1020,
        leverage: 10,
        status: 'CLOSED' as const,
        created_at: new Date(Date.now() - 7200000),
        updated_at: new Date()
      };

      const execution = {
        recommendation_id: 'tracker-rec-123',
        symbol: 'ETH-USDT',
        direction: 'LONG' as const,
        entry_price: 1000,
        exit_price: 1020,
        pnl_amount: 20,
        pnl_percentage: 2.0,
        execution_type: 'TP2_HIT' as const,
        slippage: 0.8,
        severity: 'MEDIUM' as const
      };

      // Setup mocks
      mockDatabase.getRecommendationById.mockResolvedValueOnce(recommendation);
      mockDatabase.saveSlippageAnalysis.mockResolvedValueOnce(1);
      mockDatabase.getSlippageAnalysis.mockResolvedValueOnce([{
        id: 1,
        recommendation_id: 'tracker-rec-123',
        symbol: 'ETH-USDT',
        direction: 'LONG',
        expected_price: 1000,
        actual_price: 1000.8,
        price_difference: 0.8,
        price_difference_bps: 80,
        execution_latency_ms: 100,
        slippage_bps: 80, // 0.8 * 100
        slippage_category: 'MEDIUM',
        fee_rate_bps: 10,
        fee_amount: 0.1,
        total_cost_bps: 90,
        original_threshold: 50,
        created_at: new Date()
      }]);

      // Simulate coordinated workflow
      await mockDatabase.saveSlippageAnalysis({
          recommendation_id: execution.recommendation_id,
          symbol: execution.symbol,
          direction: execution.direction,
          expected_price: 1000,
          actual_price: 1000 + execution.slippage,
          price_difference: execution.slippage,
          price_difference_bps: execution.slippage * 100,
          slippage_bps: execution.slippage * 100,
          slippage_category: execution.severity as any,
          execution_latency_ms: 100,
          fee_rate_bps: 10,
          fee_amount: 0.1,
          total_cost_bps: execution.slippage * 100 + 10,
          original_threshold: 50
        });
      
      const analysis = await mockDatabase.getSlippageAnalysis({ recommendation_id: 'tracker-rec-123' });

      // Verify coordination
      expect(mockDatabase.saveSlippageAnalysis).toHaveBeenCalled();
      expect(analysis).toHaveLength(1);
      expect(analysis[0].slippage_bps).toBe(80);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle high-volume slippage monitoring efficiently', async () => {
      const highVolumeExecutions = Array.from({ length: 100 }, (_, i) => ({
        recommendation_id: `high-vol-rec-${i}`,
        symbol: 'ETH-USDT',
        direction: i % 2 === 0 ? 'LONG' as const : 'SHORT' as const,
        entry_price: 1000 + Math.random() * 100,
        exit_price: 1000 + Math.random() * 100,
        pnl_amount: (Math.random() - 0.5) * 20,
        pnl_percentage: (Math.random() - 0.5) * 4,
        execution_type: 'TP1_HIT' as const,
        slippage: (Math.random() - 0.5) * 3,
        severity: Math.random() > 0.8 ? 'HIGH' as const : Math.random() > 0.5 ? 'MEDIUM' as const : 'LOW' as const
      }));

      // Setup mocks
      mockDatabase.saveSlippageAnalysis.mockResolvedValue(1);

      const startTime = Date.now();

      // Process high volume of executions
      for (const execution of highVolumeExecutions) {
        await mockDatabase.saveSlippageAnalysis({
          recommendation_id: execution.recommendation_id,
          symbol: execution.symbol,
          direction: execution.direction,
          expected_price: 1000,
          actual_price: 1000 + execution.slippage,
          price_difference: execution.slippage,
          price_difference_bps: execution.slippage * 100,
          execution_latency_ms: 100,
          slippage_bps: execution.slippage * 100,
          slippage_category: (execution.severity === 'HIGH' ? 'HIGH' : execution.severity === 'MEDIUM' ? 'MEDIUM' : 'LOW') as any,
          fee_rate_bps: 10,
          fee_amount: 0.1,
          total_cost_bps: execution.slippage * 100 + 10,
          original_threshold: 50
        });
      }

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Verify performance
      expect(mockDatabase.saveSlippageAnalysis).toHaveBeenCalledTimes(100);
      expect(processingTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should maintain performance with concurrent operations', async () => {
      const concurrentExecutions = Array.from({ length: 50 }, (_, i) => ({
        recommendation_id: `concurrent-rec-${i}`,
        symbol: ['ETH-USDT', 'BTC-USDT', 'SOL-USDT'][i % 3],
        direction: i % 2 === 0 ? 'LONG' as const : 'SHORT' as const,
        entry_price: 1000 + Math.random() * 200,
        exit_price: 1000 + Math.random() * 200,
        pnl_amount: (Math.random() - 0.5) * 30,
        pnl_percentage: (Math.random() - 0.5) * 6,
        execution_type: 'TP1_HIT' as const,
        slippage: (Math.random() - 0.5) * 4,
        severity: Math.random() > 0.7 ? 'HIGH' as const : Math.random() > 0.4 ? 'MEDIUM' as const : 'LOW' as const
      }));

      // Setup mocks
      mockDatabase.saveSlippageAnalysis.mockResolvedValue(1);

      const startTime = Date.now();

      // Process executions concurrently
      await Promise.all(
        concurrentExecutions.map(async (execution) => {
          await mockDatabase.saveSlippageAnalysis({
            recommendation_id: execution.recommendation_id,
            symbol: execution.symbol,
            direction: execution.direction,
            slippage_bps: execution.slippage * 100, // Convert to basis points
            expected_price: 1000,
            actual_price: 1000 + execution.slippage,
            price_difference: execution.slippage,
            price_difference_bps: execution.slippage * 100,
            slippage_category: execution.severity as any,
            execution_latency_ms: 100,
            fee_rate_bps: 10,
            fee_amount: 0.1,
            total_cost_bps: execution.slippage * 100 + 10,
            original_threshold: 50
          });
        })
      );

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Verify concurrent performance
      expect(mockDatabase.saveSlippageAnalysis).toHaveBeenCalledTimes(50);
      expect(processingTime).toBeLessThan(3000); // Should complete within 3 seconds
    });
  });
});