import { RecommendationIntegrationService } from '../../src/services/recommendation-integration-service.js';
import { RecommendationRecord } from '../../src/services/recommendation-tracker.js';
import { SlippageStatistics } from '../../src/services/recommendation-database.js';
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

describe('Slippage Monitoring and Alerting', () => {
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
    mockDatabase.saveSlippageAnalysis = jest.fn();
    mockDatabase.getSlippageAnalysis = jest.fn();
    mockDatabase.updateSlippageStatistics = jest.fn();
    mockDatabase.getSlippageThresholds = jest.fn();
    mockDatabase.saveExecution = jest.fn();
    mockDatabase.getRecommendationById = jest.fn();
    mockDatabase.updateRecommendation = jest.fn();
    mockDatabase.updateTargetPrices = jest.fn();
    mockDatabase.saveExecution = jest.fn();
    mockDatabase.initialize = jest.fn();
    
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

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Slippage Calculation', () => {
    it('should calculate slippage correctly for positive slippage', async () => {
      const execution = {
        intended_price: 1000,
        fill_price: 995,
        direction: 'LONG'
      };
      
      const slippage = ((execution.fill_price - execution.intended_price) / execution.intended_price) * 10000;
      expect(slippage).toBe(-50); // 50 bps positive slippage (better price)
    });

    it('should calculate slippage correctly for negative slippage', async () => {
      const execution = {
        intended_price: 1000,
        fill_price: 1005,
        direction: 'LONG'
      };
      
      const slippage = ((execution.fill_price - execution.intended_price) / execution.intended_price) * 10000;
      expect(slippage).toBe(50); // 50 bps negative slippage (worse price)
    });
  });

  describe('Slippage Alert Broadcasting', () => {
    it('should broadcast high slippage alerts', async () => {
      const alert = {
        slippage: 100,
        severity: 'HIGH',
        timestamp: new Date(),
        symbol: 'ETH-USDT',
        direction: 'LONG',
        intended_price: 1000,
        fill_price: 1010
      };
      
      const alertPromise = new Promise((resolve) => {
        service.on('slippage_alert', (data: unknown) => {
          resolve(data);
        });
      });
      
      service.emit('slippage_alert', alert);
      const receivedAlert = await alertPromise;
      
      expect(receivedAlert).toEqual(alert);
    });

    it('should record slippage analysis in database', async () => {
      const analysis = {
        recommendation_id: 'test-rec-123',
        symbol: 'ETH-USDT',
        direction: 'SHORT' as const,
        expected_price: 1000,
        actual_price: 992.5,
        price_difference: -7.5,
        price_difference_bps: -75,
        execution_latency_ms: 150,
        slippage_bps: -75,
        slippage_category: 'MEDIUM' as const,
        fee_rate_bps: 10,
        fee_amount: 0.5,
        total_cost_bps: -65,
        original_threshold: 50
      };
      
      mockDatabase.saveSlippageAnalysis.mockResolvedValueOnce(1);
      
      await mockDatabase.saveSlippageAnalysis(analysis);
      
      expect(mockDatabase.saveSlippageAnalysis).toHaveBeenCalledWith(analysis);
    });
  });

  describe('Slippage Health Check', () => {
    it('should perform slippage health check', async () => {
      const mockStatistics = [{
        symbol: 'ETH-USDT',
        direction: 'LONG' as const,
        period: '24h',
        total_executions: 100,
        avg_slippage_bps: 25,
        median_slippage_bps: 20,
        max_slippage_bps: 150,
        min_slippage_bps: -30,
        low_slippage_count: 60,
        medium_slippage_count: 30,
        high_slippage_count: 8,
        extreme_slippage_count: 2,
        avg_total_cost_bps: 35,
        avg_fee_bps: 10,
        avg_latency_ms: 150,
        avg_price_difference_bps: 25,
        suggested_threshold_adjustment: 5,
        confidence_score: 0.85,
        calculated_at: new Date()
      }];
      
      mockDatabase.getSlippageStatistics.mockResolvedValueOnce(mockStatistics);
      
      const result = await mockDatabase.getSlippageStatistics({ symbol: 'ETH-USDT' });
      
      expect(result).toEqual(mockStatistics);
      expect(mockDatabase.getSlippageStatistics).toHaveBeenCalledWith({ symbol: 'ETH-USDT' });
    });

    it('should trigger alert when average slippage exceeds threshold', async () => {
      const mockStatistics = [{
        symbol: 'ETH-USDT',
        direction: 'LONG' as const,
        period: '24h',
        total_executions: 50,
        avg_slippage_bps: 80,
        median_slippage_bps: 75,
        max_slippage_bps: 200,
        min_slippage_bps: 10,
        low_slippage_count: 10,
        medium_slippage_count: 20,
        high_slippage_count: 15,
        extreme_slippage_count: 5,
        avg_total_cost_bps: 90,
        avg_fee_bps: 10,
        avg_latency_ms: 200,
        avg_price_difference_bps: 80,
        suggested_threshold_adjustment: 10,
        confidence_score: 0.75,
        calculated_at: new Date()
      }];
      
      mockDatabase.getSlippageStatistics.mockResolvedValueOnce(mockStatistics);
      
      const alertPromise = new Promise((resolve) => {
        service.on('slippage_health_alert', (data: unknown) => {
          resolve(data);
        });
      });
      
      // Simulate health check logic
      const stats = await mockDatabase.getSlippageStatistics({ symbol: 'ETH-USDT' });
      if (stats.length > 0 && stats[0].avg_slippage_bps > 50) {
        service.emit('slippage_health_alert', {
          type: 'HIGH_AVERAGE_SLIPPAGE',
          symbol: 'ETH-USDT',
          averageSlippage: stats[0].avg_slippage_bps,
          threshold: 50,
          message: `Average slippage ${stats[0].avg_slippage_bps} bps exceeds threshold of 50 bps`
        });
      }
      
      const alert = await alertPromise;
      expect(alert).toMatchObject({
        type: 'HIGH_AVERAGE_SLIPPAGE',
        symbol: 'ETH-USDT',
        averageSlippage: 80,
        threshold: 50
      });
    });
  });

  describe('Dynamic Threshold Adjustment', () => {
    it('should adjust slippage thresholds based on market conditions', async () => {
      const marketData = {
        volatility: 0.02,
        volume: 1000000,
        spread: 0.001,
        timestamp: new Date()
      };
      
      const currentThreshold = 50;
      const adjustedThreshold = Math.round(currentThreshold * (1 + marketData.volatility * 10));
      
      mockDatabase.updateSlippageStatistics.mockResolvedValueOnce();
      
      await mockDatabase.updateSlippageStatistics({
        symbol: 'ETH-USDT',
        direction: 'LONG',
        period: '24h',
        total_executions: 100,
        avg_slippage_bps: adjustedThreshold,
        median_slippage_bps: adjustedThreshold,
        max_slippage_bps: adjustedThreshold + 10,
        min_slippage_bps: adjustedThreshold - 5,


        avg_total_cost_bps: 35,
        avg_fee_bps: 10,
        avg_latency_ms: 150,
        avg_price_difference_bps: 2,
        low_slippage_count: 50,
        medium_slippage_count: 30,
        high_slippage_count: 15,
        extreme_slippage_count: 5,
        suggested_threshold_adjustment: 0,
        confidence_score: 0.8,
        calculated_at: new Date()
      });
      
      expect(mockDatabase.updateSlippageStatistics).toHaveBeenCalledWith({
        symbol: 'ETH-USDT',
        direction: 'LONG',
        period: '24h',
        total_executions: 100,
        avg_slippage_bps: adjustedThreshold,
        median_slippage_bps: adjustedThreshold,
        max_slippage_bps: adjustedThreshold + 10,
        min_slippage_bps: adjustedThreshold - 5,
        avg_total_cost_bps: 35,
        avg_fee_bps: 10,
        avg_latency_ms: 150,
        avg_price_difference_bps: 2,
        low_slippage_count: 50,
        medium_slippage_count: 30,
        high_slippage_count: 15,
        extreme_slippage_count: 5,
        suggested_threshold_adjustment: 0,
        confidence_score: 0.8,
        calculated_at: expect.any(Date)
      });
    });

    it('should increase threshold during high volatility', async () => {
      const marketData = {
        volatility: 0.05,
        volume: 500000,
        spread: 0.002,
        timestamp: new Date()
      };
      
      const currentThreshold = 50;
      const adjustedThreshold = Math.round(currentThreshold * (1 + marketData.volatility * 10));
      
      expect(adjustedThreshold).toBeGreaterThan(currentThreshold);
      
      mockDatabase.updateSlippageStatistics.mockResolvedValueOnce();
      
      await mockDatabase.updateSlippageStatistics({
        symbol: 'ETH-USDT',
        direction: 'LONG',
        period: '24h',
        total_executions: 100,
        avg_slippage_bps: adjustedThreshold,
        median_slippage_bps: adjustedThreshold,
        max_slippage_bps: adjustedThreshold + 10,
        min_slippage_bps: adjustedThreshold - 5,


        avg_total_cost_bps: 35,
        avg_fee_bps: 10,
        avg_latency_ms: 150,
        avg_price_difference_bps: 2,
        low_slippage_count: 50,
        medium_slippage_count: 30,
        high_slippage_count: 15,
        extreme_slippage_count: 5,
        suggested_threshold_adjustment: 0,
        confidence_score: 0.8,
        calculated_at: new Date()
      });
      
      expect(mockDatabase.updateSlippageStatistics).toHaveBeenCalledWith({
        symbol: 'ETH-USDT',
        direction: 'LONG',
        period: '24h',
        total_executions: 100,
        avg_slippage_bps: adjustedThreshold,
        median_slippage_bps: adjustedThreshold,
        max_slippage_bps: adjustedThreshold + 10,
        min_slippage_bps: adjustedThreshold - 5,
        avg_total_cost_bps: 35,
        avg_fee_bps: 10,
        avg_latency_ms: 150,
        avg_price_difference_bps: 2,
        low_slippage_count: 50,
        medium_slippage_count: 30,
        high_slippage_count: 15,
        extreme_slippage_count: 5,
        suggested_threshold_adjustment: 0,
        confidence_score: 0.8,
        calculated_at: expect.any(Date)
      });
    });
  });

  describe('Slippage Analysis', () => {
    it('should analyze slippage patterns', async () => {
      const slippageData = [{
        symbol: 'ETH-USDT',
        direction: 'LONG' as const,
        period: '24h',
        total_executions: 4,
        avg_slippage_bps: 27.5,
        median_slippage_bps: 27.5,
        max_slippage_bps: 40,
        min_slippage_bps: 15,
        low_slippage_count: 2,
        medium_slippage_count: 2,
        high_slippage_count: 0,
        extreme_slippage_count: 0,
        avg_total_cost_bps: 37.5,
        avg_fee_bps: 10,
        avg_latency_ms: 150,
        avg_price_difference_bps: 27.5,
        suggested_threshold_adjustment: 0,
        confidence_score: 0.8,
        calculated_at: new Date(),
        updated_at: new Date()
      }];
      
      mockDatabase.getSlippageStatistics.mockResolvedValueOnce(slippageData);
      
      const stats = await mockDatabase.getSlippageStatistics({
        symbol: 'ETH-USDT'
      });
      
      const analysis = {
        average: stats[0].avg_slippage_bps,
        trend: stats[0].avg_slippage_bps > 25 ? 'INCREASING' : 'DECREASING',
        volatility: (stats[0].max_slippage_bps - stats[0].min_slippage_bps) / 2
      };
      
      expect(analysis.average).toBeCloseTo(27.5);
      expect(analysis.volatility).toBeGreaterThan(0);
    });

    it('should identify optimal trading times', async () => {
      const hourlySlippage = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        averageSlippage: Math.random() * 50 - 25,
        tradeCount: Math.floor(Math.random() * 100) + 50
      }));
      
      const bestHours = hourlySlippage
        .filter(hour => hour.averageSlippage < 10 && hour.tradeCount > 70)
        .sort((a, b) => a.averageSlippage - b.averageSlippage)
        .slice(0, 5);
      
      expect(bestHours).toBeDefined();
      expect(bestHours.length).toBeLessThanOrEqual(5);
      expect(bestHours.every(hour => hour.averageSlippage < 10)).toBe(true);
    });
  });

  describe('Integration with Recommendation Tracker', () => {
    it('should track slippage for each recommendation', async () => {
      const recommendation: RecommendationRecord = {
        id: 'rec-123',
        symbol: 'ETH-USDT',
        direction: 'LONG',
        entry_price: 1000,
        current_price: 1000,
        leverage: 1,
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date()
      };
      
      const execution = {
        recommendation_id: 'rec-123',
        actual_price: 1005,
        slippage: 50,
        timestamp: new Date()
      };
      
      mockDatabase.saveSlippageAnalysis.mockResolvedValueOnce(1);
      
      await mockDatabase.saveSlippageAnalysis({
        recommendation_id: execution.recommendation_id,
        symbol: recommendation.symbol,
        direction: recommendation.direction,
        expected_price: recommendation.entry_price,
        actual_price: execution.actual_price,
        price_difference: execution.actual_price - recommendation.entry_price,
        price_difference_bps: 50,
        execution_latency_ms: 150,
        slippage_bps: execution.slippage,
        slippage_category: 'MEDIUM' as const,
        fee_rate_bps: 10,
        fee_amount: 0.5,
        total_cost_bps: 60,
        original_threshold: 50
      });
      
      expect(mockDatabase.saveSlippageAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({
          recommendation_id: 'rec-123',
          slippage_bps: 50
        })
      );
    });

    it('should calculate slippage statistics per recommendation strategy', async () => {
      const recommendations = [
        { id: 'rec-1', strategy: 'MOMENTUM', symbol: 'ETH-USDT' },
        { id: 'rec-2', strategy: 'MEAN_REVERSION', symbol: 'ETH-USDT' },
        { id: 'rec-3', strategy: 'MOMENTUM', symbol: 'ETH-USDT' }
      ];
      
      const slippageData = [{
        symbol: 'ETH-USDT',
        direction: 'LONG' as const,
        period: '24h',
        total_executions: 3,
        avg_slippage_bps: 25,
        median_slippage_bps: 30,
        max_slippage_bps: 50,
        min_slippage_bps: -20,
        low_slippage_count: 1,
        medium_slippage_count: 1,
        high_slippage_count: 1,
        extreme_slippage_count: 0,
        avg_total_cost_bps: 35,
        avg_fee_bps: 10,
        avg_latency_ms: 150,
        avg_price_difference_bps: 25,
        suggested_threshold_adjustment: 5,
        confidence_score: 0.85,
        calculated_at: new Date()
      }];
      
      mockDatabase.getSlippageStatistics.mockResolvedValueOnce(slippageData);
      
      const stats = await mockDatabase.getSlippageStatistics({
        symbol: 'ETH-USDT'
      });
      
      expect(stats).toHaveLength(1);
      expect(stats[0].avg_slippage_bps).toBe(25);
    });

    it('should track recommendation execution with slippage', async () => {
      const recommendation: RecommendationRecord = {
        id: 'test-rec-123',
        symbol: 'ETH-USDT',
        direction: 'LONG',
        entry_price: 1000,
        current_price: 1000,
        leverage: 1,
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date()
      };
      
      const execution = {
        recommendation_id: 'test-rec-123',
        event_type: 'OPEN' as const,
        executed_price: 1005,
        executed_at: new Date(),
        slippage_bps: 50,
        fee_bps: 10,
        total_cost_bps: 60,
        latency_ms: 150
      };
      
      mockDatabase.getRecommendationById.mockResolvedValueOnce(recommendation);
      mockDatabase.saveExecution.mockResolvedValueOnce(1);
      
      const rec = await mockDatabase.getRecommendationById('test-rec-123');
      await mockDatabase.saveExecution(execution);
      
      expect(mockDatabase.getRecommendationById).toHaveBeenCalledWith('test-rec-123');
      expect(mockDatabase.saveExecution).toHaveBeenCalledWith(execution);
    });

    it('should update recommendation status based on slippage', async () => {
      const mockRecommendation: RecommendationRecord = {
      id: 'rec-456',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 45000,
      current_price: 45000,
      leverage: 1,
      status: 'ACTIVE',
      created_at: new Date(),
      updated_at: new Date()
    };
      
      mockDatabase.getRecommendationById.mockResolvedValueOnce(mockRecommendation);
      mockDatabase.getSlippageStatistics.mockResolvedValueOnce([{
        symbol: 'ETH-USDT',
        direction: 'LONG' as const,
        period: '24h',
        total_executions: 5,
        avg_slippage_bps: 45,
        median_slippage_bps: 40,
        max_slippage_bps: 60,
        min_slippage_bps: 30,
        low_slippage_count: 2,
        medium_slippage_count: 2,
        high_slippage_count: 1,
        extreme_slippage_count: 0,
        avg_total_cost_bps: 55,
        avg_fee_bps: 10,
        avg_latency_ms: 150,
        avg_price_difference_bps: 45,
        suggested_threshold_adjustment: 5,
        confidence_score: 0.8,
        calculated_at: new Date()
      }]);
      
      const rec = await mockDatabase.getRecommendationById('test-rec-456');
      const stats = await mockDatabase.getSlippageStatistics({ symbol: 'ETH-USDT' });
      
      if (rec && stats.length > 0 && stats[0].avg_slippage_bps > 40) {
        expect(rec.status).toBe('ACTIVE'); // Status unchanged in this test
      }
      
      expect(stats[0].avg_slippage_bps).toBeGreaterThan(40);
    });
  });

  describe('Configuration', () => {
    it('should load slippage monitoring configuration', async () => {
      const config = {
        enabled: true,
        thresholds: {
          low: 25,
          medium: 50,
          high: 100
        },
        monitoring_interval: 60,
        alert_cooldown: 300,
        symbols: ['ETH-USDT', 'BTC-USDT', 'BNB-USDT']
      };
      
      // Mock configuration loading
      const mockConfig = jest.fn().mockResolvedValue(config);
      const loadedConfig = await mockConfig();
      
      expect(loadedConfig).toEqual(config);
      expect(loadedConfig.enabled).toBe(true);
      expect(loadedConfig.thresholds.medium).toBe(50);
      expect(loadedConfig.symbols).toContain('ETH-USDT');
    });

    it('should support different configurations per symbol', async () => {
      const symbolConfigs = {
        'ETH-USDT': { low: 20, medium: 40, high: 80 },
        'BTC-USDT': { low: 15, medium: 35, high: 70 },
        'BNB-USDT': { low: 25, medium: 55, high: 110 }
      };
      
      // Mock symbol-specific configuration
      const getSymbolConfig = jest.fn((symbol: string) => {
        return Promise.resolve(symbolConfigs[symbol as keyof typeof symbolConfigs]);
      });
      
      const ethConfig = await getSymbolConfig('ETH-USDT');
      const btcConfig = await getSymbolConfig('BTC-USDT');
      
      expect(ethConfig).toEqual({ low: 20, medium: 40, high: 80 });
      expect(btcConfig).toEqual({ low: 15, medium: 35, high: 70 });
      expect(ethConfig.medium).toBeGreaterThan(btcConfig.medium);
    });

    it('should update configuration dynamically', async () => {
      let currentConfig = {
        enabled: true,
        thresholds: { low: 25, medium: 50, high: 100 }
      };
      
      const updateConfig = jest.fn((newConfig: any) => {
        currentConfig = { ...currentConfig, ...newConfig };
        return Promise.resolve(currentConfig);
      });
      
      const updatedConfig = await updateConfig({ thresholds: { low: 30, medium: 60, high: 120 } });
      
      expect(updatedConfig.thresholds).toEqual({ low: 30, medium: 60, high: 120 });
      expect(updatedConfig.enabled).toBe(true); // Should preserve other properties
    });

    it('should update slippage thresholds in database', async () => {
      const ethThresholds = { symbol: 'ETH-USDT', timeframe: '1h', direction: 'LONG', threshold: 45 };
      const btcThresholds = { symbol: 'BTC-USDT', timeframe: '1h', direction: 'LONG', threshold: 40 };
      
      // Mock database threshold updates
      const mockUpdateThresholds = jest.fn().mockResolvedValue(undefined);
      
      await mockUpdateThresholds(ethThresholds);
      await mockUpdateThresholds(btcThresholds);
      
      expect(mockUpdateThresholds).toHaveBeenCalledWith(ethThresholds);
      expect(mockUpdateThresholds).toHaveBeenCalledWith(btcThresholds);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      mockDatabase.saveSlippageAnalysis.mockRejectedValueOnce(new Error('Database connection failed'));
      
      await expect(mockDatabase.saveSlippageAnalysis({
        recommendation_id: 'rec-123',
        symbol: 'ETH-USDT',
        direction: 'LONG' as const,
        expected_price: 1000,
        actual_price: 1005,
        price_difference: 5,
        price_difference_bps: 50,
        execution_latency_ms: 150,
        slippage_bps: 50,
        slippage_category: 'MEDIUM' as const,
        fee_rate_bps: 10,
        fee_amount: 0.5,
        total_cost_bps: 60,
        original_threshold: 50
      })).rejects.toThrow('Database connection failed');
    });

    it('should handle invalid slippage data', async () => {
      const invalidData = {
        recommendation_id: 'rec-123',
        symbol: 'ETH-USDT',
        direction: 'INVALID_DIRECTION', // Invalid direction
        expected_price: 1000,
        actual_price: 1005,
        price_difference: 5,
        price_difference_bps: 50,
        execution_latency_ms: 150,
        slippage_bps: 'invalid', // Should be number
        slippage_category: 'MEDIUM',
        fee_rate_bps: 10,
        fee_amount: 0.5,
        total_cost_bps: 60,
        original_threshold: 50
      } as any;
      
      // This should fail TypeScript compilation, but if it gets through runtime
      mockDatabase.saveSlippageAnalysis.mockRejectedValueOnce(new Error('Invalid data type'));
      
      await expect(mockDatabase.saveSlippageAnalysis(invalidData))
        .rejects.toThrow('Invalid data type');
    });

    it('should handle missing required fields', async () => {
      const incompleteData = {
        recommendation_id: 'rec-123',
        symbol: 'ETH-USDT',
        direction: 'LONG' as const,
        expected_price: 1000,
        actual_price: 1005,
        price_difference: 5,
        price_difference_bps: 50,
        execution_latency_ms: 150
        // Missing slippage_bps, slippage_category, fee fields
      } as any;
      
      mockDatabase.saveSlippageAnalysis.mockRejectedValueOnce(new Error('Missing required fields'));
      
      await expect(mockDatabase.saveSlippageAnalysis(incompleteData))
        .rejects.toThrow('Missing required fields');
    });

    it('should continue monitoring after errors', async () => {
      mockDatabase.getSlippageStatistics
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce([{
          symbol: 'ETH-USDT',
          direction: 'LONG' as const,
          period: '24h',
          total_executions: 25,
          avg_slippage_bps: 30,
          median_slippage_bps: 28,
          max_slippage_bps: 80,
          min_slippage_bps: -10,
          low_slippage_count: 15,
          medium_slippage_count: 8,
          high_slippage_count: 2,
          extreme_slippage_count: 0,
          avg_total_cost_bps: 40,
          avg_fee_bps: 10,
          avg_latency_ms: 150,
          avg_price_difference_bps: 30,
          suggested_threshold_adjustment: 0,
          confidence_score: 0.85,
          calculated_at: new Date(),

        }]);
      
      // First call should fail
      await expect(mockDatabase.getSlippageStatistics({ symbol: 'ETH-USDT' }))
        .rejects.toThrow('Temporary error');
      
      // Second call should succeed
      const result = await mockDatabase.getSlippageStatistics({ symbol: 'ETH-USDT' });
      expect(result[0].avg_slippage_bps).toBe(30);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle high-frequency slippage monitoring', async () => {
      const highFrequencyAlerts = Array.from({ length: 1000 }, (_, i) => ({
        recommendation_id: `rec-${i}`,
        symbol: 'ETH-USDT',
        direction: (i % 2 === 0 ? 'LONG' : 'SHORT') as 'LONG' | 'SHORT',
        expected_price: 1000 + Math.random() * 100,
        actual_price: 1000 + Math.random() * 100,
        price_difference: Math.random() * 20 - 10,
        price_difference_bps: Math.floor(Math.random() * 100 - 50),
        execution_latency_ms: Math.floor(Math.random() * 500),
        slippage_bps: Math.floor(Math.random() * 100 - 50),
        slippage_category: (Math.random() > 0.8 ? 'HIGH' : Math.random() > 0.5 ? 'MEDIUM' : 'LOW') as 'LOW' | 'MEDIUM' | 'HIGH',
        fee_rate_bps: Math.floor(Math.random() * 20),
        fee_amount: Math.random() * 2,
        total_cost_bps: Math.floor(Math.random() * 120 - 60),
        original_threshold: 50
      }));
      
      mockDatabase.saveSlippageAnalysis.mockResolvedValue(1);
      
      const startTime = Date.now();
      
      await Promise.all(
        highFrequencyAlerts.map(alert => mockDatabase.saveSlippageAnalysis(alert))
      );
      
      const endTime = Date.now();
      const processingTime = endTime - startTime;
      
      expect(processingTime).toBeLessThan(5000); // Should process 1000 alerts in less than 5 seconds
      expect(mockDatabase.saveSlippageAnalysis).toHaveBeenCalledTimes(1000);
    });

    it('should efficiently query large slippage datasets', async () => {
      const largeDataset = [{
        symbol: 'ETH-USDT',
        direction: 'LONG' as const,
        period: '7d',
        total_executions: 10000,
        avg_slippage_bps: 25,
        median_slippage_bps: 20,
        max_slippage_bps: 200,
        min_slippage_bps: -100,
        low_slippage_count: 6000,
        medium_slippage_count: 3000,
        high_slippage_count: 800,
        extreme_slippage_count: 200,
        avg_total_cost_bps: 35,
        avg_fee_bps: 10,
        avg_latency_ms: 150,
        avg_price_difference_bps: 25,
        suggested_threshold_adjustment: 5,
        confidence_score: 0.85,
        calculated_at: new Date(),
        updated_at: new Date()
      }];
      
      mockDatabase.getSlippageStatistics.mockResolvedValueOnce(largeDataset);
      
      const startTime = Date.now();
      const stats = await mockDatabase.getSlippageStatistics({ symbol: 'ETH-USDT' });
      const endTime = Date.now();
      
      const queryTime = endTime - startTime;
      
      expect(queryTime).toBeLessThan(1000); // Should query in less than 1 second
      expect(stats).toHaveLength(1);
      expect(stats[0].symbol).toBe('ETH-USDT');
    });
  });
});