import { MonitoringDashboardAPI } from '../../api/monitoring-dashboard-api.js';
import { DecisionChainMonitor } from '../decision-chain-monitor.js';
import { RecommendationDatabase } from '../recommendation-database.js';
import { EventEmitter } from 'events';

// Mock dependencies
class MockDatabase extends EventEmitter {
  async getSystemOverview() {
    return {
      totalChains: 100,
      activeChains: 5,
      completedChains: 95,
      rejectionRate: 0.25,
      averageDecisionTime: 1500
    };
  }

  async getDecisionChainMetrics(filters: any) {
    return {
      total: 100,
      approved: 75,
      rejected: 25,
      bySymbol: { 'BTCUSDT': 30, 'ETHUSDT': 25 },
      bySource: { 'SYSTEM': 60, 'MANUAL': 40 },
      trends: []
    };
  }

  async getPerformanceMetrics() {
    return {
      averageDecisionTime: 1500,
      p95DecisionTime: 2500,
      p99DecisionTime: 3500,
      throughput: 10
    };
  }

  async getErrorAnalysis() {
    return {
      totalErrors: 5,
      byType: { 'SYSTEM_ERROR': 2, 'VALIDATION_ERROR': 3 },
      recentErrors: []
    };
  }

  async getRealTimeStats() {
    return {
      activeChains: 5,
      recentDecisions: [],
      systemHealth: 'healthy'
    };
  }

  async queryDecisionChains(filters: any, offset: number, limit: number) {
    return {
      chains: [],
      total: 0
    };
  }
  
  // Add missing methods that the real RecommendationDatabase has
  async getStatistics() {
    return {
      total: 100,
      active: 5,
      completed: 95,
      winRate: 0.75,
      avgReturn: 0.05
    };
  }
  
  async getActiveRecommendations() {
    return [];
  }
  
  async getRecommendationsByExperiment(experimentId: string) {
    return [];
  }
  
  async getABTestReports() {
    return [];
  }
}

class MockDecisionChainMonitor extends EventEmitter {
  startChain(symbol: string, direction: string, source: string) {
    return `CHAIN|${symbol}|${direction}|${Date.now()}|test`;
  }

  getMetrics() {
    return Promise.resolve({
      totalChains: 100,
      approvedChains: 75,
      rejectedChains: 25,
      pendingChains: 0,
      rejectionRate: 25,
      averageDecisionTime: 1500,
      rejectionReasons: { 'GATED_BY_COOLDOWN': 10, 'GATED_BY_DUPLICATE': 15 },
      stageMetrics: {},
      sourceRejections: {},
      symbolRejections: {}
    });
  }

  getRealTimeMonitoring() {
    return {
      activeChains: 5,
      recentRejections: [],
      rejectionRate: 25,
      topRejectionReasons: []
    };
  }

  async replayChain(chainId: string) {
    return {
      original: { chainId, steps: [] },
      replay: { chainId: 'REPLAY_' + chainId, steps: [] },
      differences: [],
      analysis: { totalSteps: 0, changedSteps: 0, changeRate: 0, recommendations: [] }
    };
  }
  
  // Add missing methods
  queryChains(filters: any) {
    return [];
  }
  
  getReplayHistory(chainId: string) {
    return [];
  }
  
  getChain(chainId: string) {
    // Return null for invalid chain IDs to simulate not found
    if (chainId === 'INVALID_ID') {
      return null;
    }
    return {
      chainId,
      symbol: 'BTCUSDT',
      direction: 'LONG',
      source: 'SYSTEM',
      status: 'COMPLETED',
      steps: [],
      recommendationId: 'REC_123',
      executionId: 'EXEC_456',
      createdAt: new Date(),
      completedAt: new Date()
    };
  }
}

// Add Mock RecommendationTracker
class MockRecommendationTracker extends EventEmitter {
  async getStatistics() {
    return {
      total: 100,
      active: 5,
      completed: 95,
      winRate: 0.75
    };
  }
  
  async getActiveRecommendations() {
    return [];
  }
  
  isRunningStatus() {
    return true;
  }
}

// Add Mock StatisticsCalculator
class MockStatisticsCalculator extends EventEmitter {
  async calculateOverallStatistics() {
    return {
      totalRecommendations: 100,
      winRate: 0.75,
      avgReturn: 0.05,
      sharpeRatio: 1.2
    };
  }
  
  async calculateStrategyStatistics(strategy: string) {
    return {
      strategy,
      winRate: 0.75,
      avgReturn: 0.05
    };
  }
  
  async getAllStrategyStatistics() {
    return [];
  }
  
  async computeEVvsPnLStats() {
    return {
      correlation: 0.8,
      evBins: []
    };
  }
}

describe('MonitoringDashboardAPI', () => {
  let api: MonitoringDashboardAPI;
  let mockDb: MockDatabase;
  let mockMonitor: MockDecisionChainMonitor;
  let mockTracker: MockRecommendationTracker;
  let mockStats: MockStatisticsCalculator;

  beforeEach(() => {
    mockDb = new MockDatabase();
    mockMonitor = new MockDecisionChainMonitor();
    mockTracker = new MockRecommendationTracker();
    mockStats = new MockStatisticsCalculator();
    api = new MonitoringDashboardAPI(mockMonitor as any, mockDb as any, mockTracker as any, mockStats as any);
  });

  describe('System Overview', () => {
    test('should get system overview', async () => {
      const overview = await api.getSystemOverview();
      
      expect(overview).toHaveProperty('totalChains');
      expect(overview).toHaveProperty('activeChains');
      expect(overview).toHaveProperty('completedChains');
      expect(overview).toHaveProperty('rejectionRate');
      expect(overview).toHaveProperty('averageDecisionTime');
      expect(overview).toHaveProperty('timestamp');
    });

    test('should get system overview with time range', async () => {
      const overview = await api.getSystemOverview({
        startTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endTime: new Date()
      });
      
      expect(overview).toBeDefined();
      expect(overview.timestamp).toBeDefined();
    });
  });

  describe('Decision Chain Analysis', () => {
    test('should get decision chain metrics', async () => {
      const metrics = await api.getDecisionChainMetrics({
        symbol: 'BTCUSDT',
        timeRange: '24h'
      });
      
      expect(metrics).toHaveProperty('total');
      expect(metrics).toHaveProperty('approved');
      expect(metrics).toHaveProperty('rejected');
      expect(metrics).toHaveProperty('bySymbol');
      expect(metrics).toHaveProperty('bySource');
      expect(metrics).toHaveProperty('trends');
    });

    test('should get decision chain details', async () => {
      const details = await api.getDecisionChainDetails('CHAIN_123');
      
      expect(details).toHaveProperty('chain');
      expect(details).toHaveProperty('steps');
      expect(details).toHaveProperty('linkedRecommendation');
      expect(details).toHaveProperty('linkedExecution');
    });

    test('should get decision chain comparison', async () => {
      const comparison = await api.compareDecisionChains(['CHAIN_1', 'CHAIN_2']);
      
      expect(comparison).toHaveProperty('similarities');
      expect(comparison).toHaveProperty('differences');
      expect(comparison).toHaveProperty('recommendations');
    });
  });

  describe('Performance Metrics', () => {
    test('should get performance metrics', async () => {
      const performance = await api.getPerformanceMetrics();
      
      expect(performance).toHaveProperty('averageDecisionTime');
      expect(performance).toHaveProperty('p95DecisionTime');
      expect(performance).toHaveProperty('p99DecisionTime');
      expect(performance).toHaveProperty('throughput');
      expect(performance).toHaveProperty('trends');
    });

    test('should get performance metrics with time range', async () => {
      const performance = await api.getPerformanceMetrics({
        startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        endTime: new Date()
      });
      
      expect(performance).toBeDefined();
      expect(performance.averageDecisionTime).toBeDefined();
    });
  });

  describe('Error Analysis', () => {
    test('should get error analysis', async () => {
      const errors = await api.getErrorAnalysis();
      
      expect(errors).toHaveProperty('totalErrors');
      expect(errors).toHaveProperty('byType');
      expect(errors).toHaveProperty('recentErrors');
      expect(errors).toHaveProperty('trends');
    });

    test('should get error details', async () => {
      const errorDetails = await api.getErrorDetails('ERROR_123');
      
      expect(errorDetails).toHaveProperty('error');
      expect(errorDetails).toHaveProperty('context');
      expect(errorDetails).toHaveProperty('relatedChains');
    });
  });

  describe('Real-time Monitoring', () => {
    test('should get real-time statistics', async () => {
      const stats = await api.getRealTimeStats();
      
      expect(stats).toHaveProperty('activeChains');
      expect(stats).toHaveProperty('recentDecisions');
      expect(stats).toHaveProperty('systemHealth');
      expect(stats).toHaveProperty('alerts');
    });

    test('should get system health status', async () => {
      const health = await api.getSystemHealth();
      
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('components');
      expect(health).toHaveProperty('alerts');
      expect(health).toHaveProperty('recommendations');
    });
  });

  describe('Trend Analysis', () => {
    test('should get trend analysis', async () => {
      const trends = await api.getTrendAnalysis({
        metric: 'rejectionRate',
        timeRange: '7d'
      });
      
      expect(trends).toHaveProperty('data');
      expect(trends).toHaveProperty('trend');
      expect(trends).toHaveProperty('change');
      expect(trends).toHaveProperty('forecast');
    });

    test('should get comparative analysis', async () => {
      const comparison = await api.getComparativeAnalysis({
        symbols: ['BTCUSDT', 'ETHUSDT'],
        timeRange: '24h'
      });
      
      expect(comparison).toHaveProperty('bySymbol');
      expect(comparison).toHaveProperty('byDirection');
      expect(comparison).toHaveProperty('bySource');
    });
  });

  describe('Chain Replay Integration', () => {
    test('should replay decision chain through API', async () => {
      const replay = await api.replayDecisionChain('CHAIN_123');
      
      expect(replay).toHaveProperty('original');
      expect(replay).toHaveProperty('replay');
      expect(replay).toHaveProperty('differences');
      expect(replay).toHaveProperty('analysis');
    });

    test('should get replay history', async () => {
      const history = await api.getReplayHistory('CHAIN_123');
      
      expect(Array.isArray(history)).toBe(true);
      if (history.length > 0) {
        expect(history[0]).toHaveProperty('replayId');
        expect(history[0]).toHaveProperty('timestamp');
        expect(history[0]).toHaveProperty('result');
      }
    });

    test('should batch replay chains', async () => {
      const batchResult = await api.batchReplayChains(['CHAIN_1', 'CHAIN_2']);
      
      expect(batchResult).toHaveProperty('total');
      expect(batchResult).toHaveProperty('successful');
      expect(batchResult).toHaveProperty('failed');
      expect(batchResult).toHaveProperty('results');
      expect(batchResult).toHaveProperty('summary');
    });
  });

  describe('Export and Reporting', () => {
    test('should export dashboard data', async () => {
      const exportData = await api.exportDashboardData({
        format: 'json',
        timeRange: '24h'
      });
      
      expect(exportData).toHaveProperty('data');
      expect(exportData).toHaveProperty('format');
      expect(exportData).toHaveProperty('generatedAt');
    });

    test('should generate summary report', async () => {
      const report = await api.generateSummaryReport({
        timeRange: '7d'
      });
      
      expect(report).toHaveProperty('period');
      expect(report).toHaveProperty('keyMetrics');
      expect(report).toHaveProperty('trends');
      expect(report).toHaveProperty('recommendations');
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid chain ID', async () => {
      await expect(api.getDecisionChainDetails('INVALID_ID'))
        .rejects.toThrow();
    });

    test('should handle invalid time range', async () => {
      await expect(api.getSystemOverview({
        startTime: new Date('invalid'),
        endTime: new Date()
      })).rejects.toThrow();
    });

    test('should handle database errors gracefully', async () => {
      // Mock database error
      mockDb.getStatistics = jest.fn().mockRejectedValue(new Error('Database error'));
      
      await expect(api.getSystemOverview()).rejects.toThrow('Database error');
    });
  });

  describe('Data Validation', () => {
    test('should validate time ranges', async () => {
      const result = await api.getSystemOverview({
        startTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endTime: new Date()
      });
      
      expect(result).toBeDefined();
    });

    test('should validate symbol filters', async () => {
      const metrics = await api.getDecisionChainMetrics({
        symbol: 'BTCUSDT'
      });
      
      expect(metrics).toBeDefined();
    });

    test('should validate direction filters', async () => {
      const metrics = await api.getDecisionChainMetrics({
        direction: 'LONG'
      });
      
      expect(metrics).toBeDefined();
    });
  });
});