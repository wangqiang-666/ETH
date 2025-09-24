import { RecommendationAPI } from '../../api/recommendation-api.js';
import { DecisionChainMonitor } from '../decision-chain-monitor.js';
import { RecommendationDatabase } from '../recommendation-database.js';
import { EnhancedOKXDataService } from '../enhanced-okx-data-service.js';
import { EventEmitter } from 'events';

// Mock EnhancedOKXDataService
class MockEnhancedOKXDataService extends EventEmitter {
  startHealthCheck: jest.Mock;
  stopHealthCheck: jest.Mock;

  constructor() {
    super();
    // Prevent background processes from running
    this.startHealthCheck = jest.fn();
    this.stopHealthCheck = jest.fn();
  }

  async getTickerData(symbol: string) {
    return {
      symbol,
      last: 50000,
      bid: 49999,
      ask: 50001,
      timestamp: Date.now()
    };
  }

  async getHistoricalData(symbol: string, timeframe: string, limit: number) {
    return [];
  }
}

// Mock Database
class MockDatabase extends EventEmitter {
  async getRecommendationsBySymbol(symbol: string, limit: number) {
    return [];
  }

  async addRecommendation(recommendation: any) {
    return { recommendationId: 'REC_123', ...recommendation };
  }

  async getActiveRecommendations(filters: any) {
    return [];
  }

  async getDecisionChain(chainId: string) {
    return null;
  }

  async queryDecisionChains(filters: any, offset: number, limit: number) {
    return { chains: [], total: 0 };
  }

  async saveDecisionChain(chain: any) {
    return chain;
  }
}

class MockDecisionChainMonitor extends EventEmitter {
  private chains: Map<string, any> = new Map();

  startChain(paramsOrChainId: any, symbol?: string, source?: string) {
    let chainId: string;
    let chainSymbol: string;
    let chainSource: string;
    let chainDirection: string | undefined;
    
    if (typeof paramsOrChainId === 'object') {
      const params = paramsOrChainId;
      chainId = `CHAIN|${params.symbol}|${params.direction || 'NA'}|${Date.now()}|test`;
      chainSymbol = params.symbol;
      chainSource = params.source;
      chainDirection = params.direction;
    } else {
      // For individual parameters: chainId, symbol, source
      chainId = paramsOrChainId;
      chainSymbol = symbol || 'UNKNOWN';
      chainSource = source || 'TEST';
      chainDirection = undefined; // direction not provided in individual parameter version
    }
    
    this.chains.set(chainId, {
      chainId,
      symbol: chainSymbol,
      direction: chainDirection,
      source: chainSource,
      steps: [],
      startTime: new Date().toISOString(),
      finalDecision: 'PENDING'
    });
    return chainId;
  }

  async addDecisionStep(chainId: string, step: any) {
    const chain = this.chains.get(chainId);
    if (chain) {
      const fullStep = {
        ...step,
        timestamp: new Date().toISOString()
      };
      chain.steps.push(fullStep);
      
      if (step.decision === 'REJECTED') {
        chain.finalDecision = 'REJECTED';
        chain.finalReason = step.reason;
        chain.endTime = new Date().toISOString();
      } else if (step.decision === 'APPROVED' && chain.finalDecision === 'PENDING') {
        chain.finalDecision = 'APPROVED';
      }
      
      this.emit('decision_step_added', { chainId, step: fullStep });
    }
  }

  linkRecommendation(chainId: string, recommendationId: string) {
    const chain = this.chains.get(chainId);
    if (chain) {
      chain.recommendationId = recommendationId;
      this.emit('chain_linked', { chainId, recommendationId });
    }
  }

  async finalizeChain(chainId: string) {
    const chain = this.chains.get(chainId);
    if (chain) {
      if (!chain.endTime) {
        chain.endTime = new Date().toISOString();
      }
      // Set final decision based on steps
      if (chain.steps.some((step: any) => step.decision === 'REJECTED')) {
        chain.finalDecision = 'REJECTED';
      } else if (chain.steps.some((step: any) => step.decision === 'APPROVED')) {
        chain.finalDecision = 'APPROVED';
      } else {
        chain.finalDecision = 'PENDING';
      }
      this.emit('chain_finalized', { chainId, chain });
    }
  }

  getActiveChain(chainId: string) {
    return this.chains.get(chainId);
  }

  async getChain(chainId: string) {
    return this.chains.get(chainId);
  }

  async queryChains(filters: any, offset: number = 0, limit: number = 50) {
    let chains = Array.from(this.chains.values());
    
    // Extract pagination parameters from filters if present
    if (filters) {
      if (filters.limit !== undefined) {
        limit = filters.limit;
      }
      if (filters.offset !== undefined) {
        offset = filters.offset;
      }
    }
    
    // Apply filters
    if (filters) {
      if (filters.symbol) {
        chains = chains.filter(chain => chain.symbol === filters.symbol);
      }
      if (filters.finalDecision) {
        chains = chains.filter(chain => chain.finalDecision === filters.finalDecision);
      }
      if (filters.status) {
        chains = chains.filter(chain => chain.finalDecision === filters.status);
      }
      if (filters.errorType) {
        // This would require errorType to be stored in the chain, but for now we'll skip this filter
      }
    }
    
    const total = chains.length;
    const paginatedChains = chains.slice(offset, offset + limit);
    
    return {
      chains: paginatedChains,
      total: total,
      filtered: paginatedChains.length,
      hasMore: offset + limit < total
    };
  }

  async getMetrics() {
    return {
      totalChains: this.chains.size,
      approvedChains: 0,
      rejectedChains: 0,
      pendingChains: 0,
      rejectionRate: 0,
      averageDecisionTime: 0,
      rejectionReasons: {},
      stageMetrics: {},
      sourceRejections: {},
      symbolRejections: {}
    };
  }

  getRealTimeMonitoring() {
    return {
      activeChains: this.chains.size,
      recentRejections: [],
      rejectionRate: 0,
      topRejectionReasons: []
    };
  }

  async replayChain(chainId: string) {
    return {
      original: this.chains.get(chainId),
      replay: this.chains.get(chainId),
      differences: [],
      analysis: { totalSteps: 0, changedSteps: 0, changeRate: 0, recommendations: [] }
    };
  }
}

describe('RecommendationAPI with Decision Chain Monitoring', () => {
  let api: RecommendationAPI;
  let mockDataService: MockEnhancedOKXDataService;
  let mockDb: MockDatabase;
  let mockMonitor: MockDecisionChainMonitor;

  beforeEach(() => {
    // Mock console methods to prevent log pollution during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    mockDataService = new MockEnhancedOKXDataService();
    mockDb = new MockDatabase();
    mockMonitor = new MockDecisionChainMonitor();
    api = new RecommendationAPI(mockDataService as any, mockDb as any);
    
    // Override the decisionChainMonitor with our mock
    (api as any).decisionChainMonitor = mockMonitor;
    
    // Mock the RecommendationTracker methods
    const mockTracker = {
      addRecommendation: jest.fn().mockResolvedValue('REC_123'),
      getRecommendation: jest.fn(),
      updateRecommendation: jest.fn(),
      deleteRecommendation: jest.fn()
    };
    (api as any).tracker = mockTracker;
  });

  afterEach(() => {
    // Restore console methods
    jest.restoreAllMocks();
  });

  describe('Decision Chain Integration in createRecommendation', () => {
    test('should create recommendation with successful decision chain', async () => {
      const request = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        leverage: 10,
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 51000,
        source: 'TEST'
      };

      const result = await api.createRecommendation(request);
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('recommendationId');
      expect(result.data).toHaveProperty('decisionChainId');
      
      // Verify decision chain was created
      const chainId = result.data.decisionChainId;
      const chain = mockMonitor.getActiveChain(chainId);
      expect(chain).toBeDefined();
      expect(chain.symbol).toBe('BTCUSDT');
      expect(chain.direction).toBe('LONG');
      
      // Verify chain was finalized with APPROVED status
      expect(chain.finalDecision).toBe('APPROVED');
    });

    test('should handle cooldown error with decision chain', async () => {
      // Mock cooldown error - should be CooldownError
      // Import the actual CooldownError from recommendation-tracker
      const { CooldownError } = require('../recommendation-tracker');
      
      // Mock the tracker's addRecommendation method instead of database
      const mockTracker = (api as any).tracker;
      mockTracker.addRecommendation = jest.fn().mockRejectedValue(new CooldownError('Cooldown period active'));
      
      const request = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        leverage: 10,
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 51000,
        source: 'TEST'
      };

      const result = await api.createRecommendation(request);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('cooldown');
      expect(result.data).toHaveProperty('decisionChainId');
      
      // Verify decision chain was created and finalized with REJECTED status
      const chainId = result.data.decisionChainId;
      const chain = await mockMonitor.getChain(chainId);
      expect(chain).toBeDefined();
      expect(chain.finalDecision).toBe('REJECTED');
      
      // Verify gating check step was added
      const gatingStep = chain.steps.find((step: any) => step.stage === 'GATING_CHECK');
      expect(gatingStep).toBeDefined();
      expect(gatingStep.decision).toBe('REJECTED');
    });

    test('should handle duplicate error with decision chain', async () => {
      // Mock duplicate error - should be DuplicateError
      // Import the actual DuplicateError from recommendation-tracker
      const { DuplicateError } = require('../recommendation-tracker');
      
      // Mock the tracker's addRecommendation method instead of database
      const mockTracker = (api as any).tracker;
      mockTracker.addRecommendation = jest.fn().mockRejectedValue(new DuplicateError('Duplicate recommendation detected'));
      
      const request = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        leverage: 10,
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 51000,
        source: 'TEST'
      };

      const result = await api.createRecommendation(request);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('duplicate');
      expect(result.data).toHaveProperty('decisionChainId');
      
      // Verify decision chain was created and finalized with REJECTED status
      const chainId = result.data.decisionChainId;
      const chain = await mockMonitor.getChain(chainId);
      expect(chain).toBeDefined();
      expect(chain.finalDecision).toBe('REJECTED');
    });

    test('should handle MTF consistency error with decision chain', async () => {
      // Mock MTF consistency error - should be MTFConsistencyError
      // Import the actual MTFConsistencyError from recommendation-tracker
      const { MTFConsistencyError } = require('../recommendation-tracker');
      
      // Mock the tracker's addRecommendation method instead of database
      const mockTracker = (api as any).tracker;
      mockTracker.addRecommendation = jest.fn().mockRejectedValue(new MTFConsistencyError('MTF consistency violation'));
      
      const request = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        leverage: 10,
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 51000,
        source: 'TEST'
      };

      const result = await api.createRecommendation(request);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('MTF consistency');
      expect(result.data).toHaveProperty('decisionChainId');
      
      // Verify decision chain was created and finalized with REJECTED status
      const chainId = result.data.decisionChainId;
      const chain = await mockMonitor.getChain(chainId);
      expect(chain).toBeDefined();
      expect(chain.finalDecision).toBe('REJECTED');
    });

    test('should handle opposite constraint error with decision chain', async () => {
      // Mock opposite constraint error - should be OppositeConstraintError
      // Import the actual OppositeConstraintError from recommendation-tracker
      const { OppositeConstraintError } = require('../recommendation-tracker');
      
      // Mock the tracker's addRecommendation method instead of database
      const mockTracker = (api as any).tracker;
      mockTracker.addRecommendation = jest.fn().mockRejectedValue(new OppositeConstraintError('Opposite constraint violation'));
      
      const request = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        leverage: 10,
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 51000,
        source: 'TEST'
      };

      const result = await api.createRecommendation(request);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('opposite constraint');
      expect(result.data).toHaveProperty('decisionChainId');
      
      // Verify decision chain was created and finalized with REJECTED status
      const chainId = result.data.decisionChainId;
      const chain = await mockMonitor.getChain(chainId);
      expect(chain).toBeDefined();
      expect(chain.finalDecision).toBe('REJECTED');
    });

    test('should handle exposure limit error with decision chain', async () => {
      // Mock exposure limit error - should be ExposureLimitError
      // Import the actual ExposureLimitError from recommendation-tracker
      const { ExposureLimitError } = require('../recommendation-tracker');
      
      // Mock the tracker's addRecommendation method instead of database
      const mockTracker = (api as any).tracker;
      mockTracker.addRecommendation = jest.fn().mockRejectedValue(new ExposureLimitError('Exposure limit exceeded'));
      
      const request = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        leverage: 10,
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 51000,
        source: 'TEST'
      };

      const result = await api.createRecommendation(request);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('exposure limit');
      expect(result.data).toHaveProperty('decisionChainId');
      
      // Verify decision chain was created and finalized with REJECTED status
      const chainId = result.data.decisionChainId;
      const chain = await mockMonitor.getChain(chainId);
      expect(chain).toBeDefined();
      expect(chain.finalDecision).toBe('REJECTED');
    });

    test('should handle exposure cap error with decision chain', async () => {
      // Mock exposure cap error - should be ExposureCapError
      // Import the actual ExposureCapError from recommendation-tracker
      const { ExposureCapError } = require('../recommendation-tracker');
      
      // Mock the tracker's addRecommendation method instead of database
      const mockTracker = (api as any).tracker;
      mockTracker.addRecommendation = jest.fn().mockRejectedValue(new ExposureCapError('Net exposure cap exceeded'));
      
      const request = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        leverage: 10,
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 51000,
        source: 'TEST'
      };

      const result = await api.createRecommendation(request);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('exposure cap');
      expect(result.data).toHaveProperty('decisionChainId');
      
      // Verify decision chain was created and finalized with REJECTED status
      const chainId = result.data.decisionChainId;
      const chain = await mockMonitor.getChain(chainId);
      expect(chain).toBeDefined();
      expect(chain.finalDecision).toBe('REJECTED');
    });

    test('should handle generic system error with decision chain', async () => {
      // Mock tracker to throw generic error (not database)
      const mockTracker = (api as any).tracker;
      mockTracker.addRecommendation = jest.fn().mockRejectedValueOnce(new Error('Database connection failed'));
      
      const request = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        leverage: 10,
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 51000,
        source: 'TEST'
      };

      const result = await api.createRecommendation(request);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to create recommendation');
      expect(result.data).toHaveProperty('decisionChainId');
      
      // Verify decision chain was created and finalized with REJECTED status
      const chainId = result.data.decisionChainId;
      const chain = await mockMonitor.getChain(chainId);
      expect(chain).toBeDefined();
      expect(chain.finalDecision).toBe('REJECTED');
    });
  });

  describe('Decision Chain Monitoring Routes', () => {
    test('should get decision chains', async () => {
      const result = await api.getDecisionChains({
        symbol: 'BTCUSDT',
        limit: 10,
        offset: 0
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('chains');
      expect(result.data).toHaveProperty('total');
      expect(Array.isArray(result.data.chains)).toBe(true);
    });

    test('should get specific decision chain', async () => {
      // First create a chain
      const chainId = 'test-chain-id';
      mockMonitor.startChain(chainId, 'BTCUSDT', 'TEST');
      await mockMonitor.addDecisionStep(chainId, {
        stage: 'GATING_CHECK',
        decision: 'APPROVED',
        reason: 'Check passed'
      });
      
      const result = await api.getDecisionChain(chainId);
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('chainId', chainId);
      expect(result.data).toHaveProperty('symbol', 'BTCUSDT');
      expect(result.data).toHaveProperty('steps');
    });

    test('should replay decision chain', async () => {
      // First create a chain
      const chainId = 'test-replay-chain-id';
      mockMonitor.startChain(chainId, 'BTCUSDT', 'TEST');
      await mockMonitor.addDecisionStep(chainId, {
        stage: 'GATING_CHECK',
        decision: 'APPROVED',
        reason: 'Check passed'
      });
      
      const result = await api.replayDecisionChain(chainId);
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('original');
      expect(result.data).toHaveProperty('replay');
      expect(result.data).toHaveProperty('differences');
      expect(result.data).toHaveProperty('analysis');
    });

    test('should get decision chains by symbol', async () => {
      // Create test chains
      const chain1 = 'btc-chain-1';
      const chain2 = 'btc-chain-2';
      const chain3 = 'eth-chain-1';
      
      mockMonitor.startChain(chain1, 'BTCUSDT', 'TEST');
      mockMonitor.startChain(chain2, 'BTCUSDT', 'TEST');
      mockMonitor.startChain(chain3, 'ETHUSDT', 'TEST');
      
      await mockMonitor.finalizeChain(chain1);
      await mockMonitor.finalizeChain(chain2);
      await mockMonitor.finalizeChain(chain3);
      
      const result = await api.getDecisionChainsBySymbol('BTCUSDT');
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('chains');
      expect(result.data.chains.length).toBe(2); // Two BTCUSDT chains
      expect(result.data.chains.every((chain: any) => chain.symbol === 'BTCUSDT')).toBe(true);
    });

    test('should get recent decision chains', async () => {
      // Create test chains
      for (let i = 0; i < 5; i++) {
        const chainId = `recent-chain-${i}`;
        mockMonitor.startChain(chainId, 'BTCUSDT', 'TEST');
        await mockMonitor.finalizeChain(chainId);
      }
      
      const result = await api.getRecentDecisionChains({ limit: 3 });
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('chains');
      expect(result.data.chains.length).toBeLessThanOrEqual(3);
    });

    test('should get decision chain statistics', async () => {
      const result = await api.getDecisionChainStats();
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('totalChains');
      expect(result.data).toHaveProperty('approvedChains');
      expect(result.data).toHaveProperty('rejectedChains');
      expect(result.data).toHaveProperty('rejectionRate');
      expect(result.data).toHaveProperty('averageDecisionTime');
      expect(result.data).toHaveProperty('rejectionReasons');
    });

    test('should get failed decision chains', async () => {
      // Create failed chains
      const chain1 = 'btc-failed-chain';
      const chain2 = 'eth-failed-chain';
      
      mockMonitor.startChain(chain1, 'BTCUSDT', 'TEST');
      mockMonitor.startChain(chain2, 'ETHUSDT', 'TEST');
      
      // Add rejected steps to make chains fail
      await mockMonitor.addDecisionStep(chain1, {
        stage: 'GATING_CHECK',
        decision: 'REJECTED',
        reason: 'Test rejection'
      });
      await mockMonitor.addDecisionStep(chain2, {
        stage: 'GATING_CHECK',
        decision: 'REJECTED',
        reason: 'Test rejection'
      });
      
      await mockMonitor.finalizeChain(chain1);
      await mockMonitor.finalizeChain(chain2);
      
      const result = await api.getFailedDecisionChains({ limit: 10 });
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('chains');
      expect(result.data.chains.length).toBe(2);
      expect(result.data.chains.every((chain: any) => chain.finalDecision === 'REJECTED')).toBe(true);
    });
  });

  describe('Decision Chain Events', () => {
    test('should emit chain_finalized event', async () => {
      const chainFinalizedSpy = jest.fn();
      mockMonitor.on('chain_finalized', chainFinalizedSpy);
      
      const request = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        leverage: 10,
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 51000,
        source: 'TEST'
      };

      await api.createRecommendation(request);
      
      expect(chainFinalizedSpy).toHaveBeenCalled();
      const eventData = chainFinalizedSpy.mock.calls[0][0];
      expect(eventData).toHaveProperty('chainId');
      expect(eventData).toHaveProperty('chain');
      expect(eventData.chain).toHaveProperty('finalDecision', 'APPROVED');
    });
  });

  describe('Decision Chain Linking', () => {
    test('should link recommendation to decision chain', async () => {
      const request = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        leverage: 10,
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 51000,
        source: 'TEST'
      };

      const result = await api.createRecommendation(request);
      
      expect(result.success).toBe(true);
      const chainId = result.data.decisionChainId;
      const recommendationId = result.data.recommendationId;
      
      // Verify linking
      const chain = mockMonitor.getActiveChain(chainId);
      expect(chain.recommendationId).toBe(recommendationId);
    });
  });
});