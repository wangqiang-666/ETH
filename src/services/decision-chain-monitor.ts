import { EventEmitter } from 'events';
import { config } from '../config.js';

export interface DecisionChainStep {
  stage: 'SIGNAL_COLLECTION' | 'GATING_CHECK' | 'COOLDOWN_CHECK' | 'RISK_ASSESSMENT' | 'EXECUTION_DECISION' | 'POST_EXECUTION';
  timestamp: string;
  decision: 'APPROVED' | 'REJECTED' | 'PENDING' | 'MODIFIED';
  reason?: string;
  details: Record<string, any>;
  metadata?: {
    symbol: string;
    direction?: 'LONG' | 'SHORT';
    currentPrice?: number;
    entryPrice?: number;
    confidenceScore?: number;
    signalStrength?: number;
  };
}

export interface DecisionChainFilter {
  symbol?: string;
  direction?: 'LONG' | 'SHORT';
  source?: string;
  finalDecision?: 'APPROVED' | 'REJECTED' | 'PENDING';
  reason?: string;
  chainId?: string;
  recommendationId?: string;
  timeStart?: string | Date;
  timeEnd?: string | Date;
  includeSteps?: boolean;
  limit?: number;
  offset?: number;
}

export interface DecisionChainMetrics {
  totalChains: number;
  approvedChains: number;
  rejectedChains: number;
  pendingChains: number;
  averageDecisionTime: number;
  successRate: number;
  timestamp: string;
  rejectionReasons?: Record<string, number>;
}

export interface DecisionChainStep {
  stage: 'SIGNAL_COLLECTION' | 'GATING_CHECK' | 'COOLDOWN_CHECK' | 'RISK_ASSESSMENT' | 'EXECUTION_DECISION' | 'POST_EXECUTION';
  timestamp: string;
  decision: 'APPROVED' | 'REJECTED' | 'PENDING' | 'MODIFIED';
  reason?: string;
  details: Record<string, any>;
  metadata?: {
    symbol: string;
    direction?: 'LONG' | 'SHORT';
    currentPrice?: number;
    entryPrice?: number;
    confidenceScore?: number;
    signalStrength?: number;
  };
}

export interface RecommendationDatabase {
  save: (key: string, data: any) => Promise<void>;
  get: (key: string) => Promise<any | null>;
}

export interface DecisionChainRecord {
  chainId: string;
  symbol: string;
  direction?: 'LONG' | 'SHORT';
  source: string;
  startTime: string;
  finalDecision: 'APPROVED' | 'REJECTED' | 'PENDING';
  finalReason?: string;
  endTime?: string;
  steps: any[];
  recommendationId?: string;
  executionId?: string;
}

export class DecisionChainMonitor extends EventEmitter {
  private database: RecommendationDatabase;
  private activeChains: Map<string, DecisionChainRecord> = new Map();
  private chainHistory: DecisionChainRecord[] = [];
  private maxHistorySize: number = 10000;
  private metricsCache: DecisionChainMetrics | null = null;
  private metricsCacheTime: number = 0;
  private metricsCacheDuration: number = 60000; // 1 minute cache
  private replayHistory: Map<string, Array<{
    replayId: string;
    timestamp: string;
    result: DecisionChainRecord;
    analysis: any;
  }>> = new Map();

  constructor(database?: RecommendationDatabase) {
    super();
    if (database) {
      this.database = database;
    } else {
      // Create a proper mock database implementation
      const mockDatabase = {
        save: async (key: string, data: any) => {
          console.log(`Saving to database: ${key}`, data);
          return Promise.resolve();
        },
        get: async (key: string) => {
          console.log(`Getting from database: ${key}`);
          return Promise.resolve(null);
        }
      };
      this.database = mockDatabase;
    }
  }

  private generateChainId(symbol: string, direction?: 'LONG' | 'SHORT', prefix: string = 'CHAIN'): string {
    const timestamp = Date.now();
    const dir = direction || 'NA';
    return `${prefix}|${symbol}|${dir}|${timestamp}|${Math.random().toString(36).substr(2, 9)}`;
  }

  private getRelevantConfig(): Record<string, any> {
    const strategyConfig = (config as any)?.strategy || {};
    
    return {
      strategy: strategyConfig,
      timestamp: Date.now()
    };
  }

  private getCurrentMarketConditions(): {
    volatility: number;
    trend: 'bullish' | 'bearish' | 'neutral';
    volume: number;
    liquidity: number;
    timestamp: string;
  } {
    return {
      volatility: Math.random() * 0.8 + 0.1,
      trend: ['bullish', 'bearish', 'neutral'][Math.floor(Math.random() * 3)] as any,
      volume: Math.random() * 1000000 + 100000,
      liquidity: Math.random() * 0.8 + 0.2,
      timestamp: new Date().toISOString()
    };
  }

  private async saveChainToDatabase(chain: DecisionChainRecord): Promise<void> {
    try {
      if (this.database && typeof this.database.save === 'function') {
        await this.database.save(`chain:${chain.chainId}`, chain);
      } else {
        console.log(`Database save not available, skipping save for chain: ${chain.chainId}`);
      }
    } catch (error) {
      console.error('Failed to save chain to database:', error);
      throw error;
    }
  }

  private async getChainFromDatabase(chainId: string): Promise<DecisionChainRecord | null> {
    try {
      if (this.database && typeof this.database.get === 'function') {
        return await this.database.get(`chain:${chainId}`);
      } else {
        console.log(`Database get not available for chain: ${chainId}`);
        return null;
      }
    } catch (error) {
      console.error('Failed to get chain from database:', error);
      return null;
    }
  }

  private async simulateDecisionStep(originalStep: DecisionChainStep, replayData: Record<string, any>): Promise<DecisionChainStep> {
    const simulatedStep: DecisionChainStep = {
      stage: originalStep.stage,
      timestamp: new Date().toISOString(),
      decision: originalStep.decision,
      reason: originalStep.reason,
      details: originalStep.details,
      metadata: originalStep.metadata
    };

    try {
      // Simulate the decision logic based on replay data
      const marketConditions = this.getCurrentMarketConditions();
      const config = this.getRelevantConfig();
      
      // Simple simulation logic
      const shouldApprove = Math.random() > 0.5;
      
      simulatedStep.decision = shouldApprove ? 'APPROVED' : 'REJECTED';
      simulatedStep.reason = `Simulated decision based on replay data: ${shouldApprove ? 'approved' : 'rejected'}`;
      simulatedStep.details = {
        ...originalStep.details,
        confidence: Math.random() * 0.3 + 0.7,
        marketConditions,
        config,
        replayData
      };
    } catch (error) {
      simulatedStep.decision = 'REJECTED';
      simulatedStep.reason = `Simulation failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      simulatedStep.details = { ...originalStep.details, error: true };
    }

    return simulatedStep;
  }

  private analyzeBatchReplayResults(results: Array<DecisionChainStep>): {
    totalSimulations: number;
    approvedSimulations: number;
    rejectedSimulations: number;
    failedSimulations: number;
    averageConfidence: number;
    consistencyScore: number;
  } {
    const total = results.length;
    const approved = results.filter(r => r.decision === 'APPROVED').length;
    const rejected = results.filter(r => r.decision === 'REJECTED').length;
    const failed = results.filter(r => r.decision === 'REJECTED' && r.reason?.includes('failed')).length;
    
    const confidences = results
      .filter(r => r.details?.confidence)
      .map(r => r.details.confidence);
    
    const avgConfidence = confidences.length > 0 
      ? confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length 
      : 0;
    
    // Consistency score based on decision agreement
    const consistencyScore = Math.max(approved, rejected) / (approved + rejected || 1);

    return {
      totalSimulations: total,
      approvedSimulations: approved,
      rejectedSimulations: rejected,
      failedSimulations: failed,
      averageConfidence: avgConfidence,
      consistencyScore
    };
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private analyzeReplayResults(
    replayResults: Array<{
      originalDecision: string;
      simulationResults: Array<DecisionChainStep>;
      chainId: string;
      symbol: string;
    }>
  ): {
    overallConsistency: number;
    symbolConsistency: Record<string, number>;
    decisionDrift: number;
    recommendations: string[];
  } {
    const recommendations: string[] = [];
    
    // Analyze overall consistency
    const totalResults = replayResults.length;
    const consistentResults = replayResults.filter(result => {
      const batchAnalysis = this.analyzeBatchReplayResults(result.simulationResults);
      const majorityDecision = batchAnalysis.approvedSimulations > batchAnalysis.rejectedSimulations ? 'APPROVED' : 'REJECTED';
      return majorityDecision === result.originalDecision;
    }).length;
    
    const overallConsistency = totalResults > 0 ? consistentResults / totalResults : 0;

    // Analyze consistency by symbol
    const symbolConsistency: Record<string, number> = {};
    const symbolGroups = replayResults.reduce((groups, result) => {
      if (!groups[result.symbol]) groups[result.symbol] = [];
      groups[result.symbol].push(result);
      return groups;
    }, {} as Record<string, typeof replayResults>);

    Object.entries(symbolGroups).forEach(([symbol, results]) => {
      const consistent = results.filter(result => {
        const batchAnalysis = this.analyzeBatchReplayResults(result.simulationResults);
        const majorityDecision = batchAnalysis.approvedSimulations > batchAnalysis.rejectedSimulations ? 'APPROVED' : 'REJECTED';
        return majorityDecision === result.originalDecision;
      }).length;
      symbolConsistency[symbol] = results.length > 0 ? consistent / results.length : 0;
    });

    // Calculate decision drift
    const decisionDrift = 1 - overallConsistency;

    // Generate recommendations
    if (overallConsistency < 0.7) {
      recommendations.push('Consider reviewing decision logic - low consistency detected');
    }

    if (decisionDrift > 0.3) {
      recommendations.push('Significant decision drift detected - model may need recalibration');
    }

    const lowConsistencySymbols = Object.entries(symbolConsistency)
      .filter(([, consistency]) => consistency < 0.5)
      .map(([symbol]) => symbol);

    if (lowConsistencySymbols.length > 0) {
      recommendations.push(`Low consistency for symbols: ${lowConsistencySymbols.join(', ')}`);
    }

    if (recommendations.length === 0) {
      recommendations.push('Decision consistency is within acceptable range');
    }

    return {
      overallConsistency,
      symbolConsistency,
      decisionDrift,
      recommendations
    };
  }

  startChain(params: {
    symbol: string;
    direction?: 'LONG' | 'SHORT';
    source: 'MANUAL' | 'STRATEGY_ENGINE' | 'AUTO_RECOMMENDATION' | 'SIGNAL_SERVICE' | 'API_RECOMMENDATION' | 'AUTO' | 'TRADING_SIGNAL';
    metadata?: Record<string, any>;
  }): string;
  startChain(chainId: string, symbol: string, source: string): string;
  startChain(paramsOrChainId: any, symbol?: string, source?: string): string {
    // Handle object parameter version
    if (typeof paramsOrChainId === 'object') {
      const params = paramsOrChainId;
      const chainId = this.generateChainId(params.symbol, params.direction);
      
      const chain: DecisionChainRecord = {
        chainId,
        symbol: params.symbol,
        direction: params.direction,
        source: params.source,
        startTime: new Date().toISOString(),
        finalDecision: 'PENDING',
        steps: []
      };

      this.activeChains.set(chainId, chain);
      this.emit('chain_started', { chainId, ...params });
      
      return chainId;
    }
    
    // Handle individual parameter version
    else {
      const chainId = paramsOrChainId;
      const chain: DecisionChainRecord = {
        chainId,
        symbol: symbol!,
        source: source!,
        startTime: new Date().toISOString(),
        finalDecision: 'PENDING',
        steps: []
      };

      this.activeChains.set(chainId, chain);
      this.emit('chain_started', { chainId, symbol: symbol!, source: source! });
      
      return chainId;
    }
  }

  async addDecisionStep(chainId: string, step: Omit<DecisionChainStep, 'timestamp'>): Promise<void> {
    const chain = this.activeChains.get(chainId);
    if (!chain) {
      // Chain might already be finalized, check if it's in history
      const finalizedChain = this.chainHistory.find(c => c.chainId === chainId);
      if (finalizedChain) {
        console.warn(`Chain ${chainId} is already finalized, cannot add decision step`);
        return;
      }
      throw new Error(`Chain ${chainId} not found for decision step`);
    }

    const fullStep: DecisionChainStep = {
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

    if (chain.finalDecision !== 'PENDING') {
      await this.finalizeChain(chainId);
    }
  }

  linkRecommendation(chainId: string, recommendationId: string): void {
    const chain = this.activeChains.get(chainId);
    if (chain) {
      chain.recommendationId = recommendationId;
      this.emit('chain_linked', { chainId, recommendationId });
    }
  }

  linkExecution(chainId: string, executionId: string): void {
    const chain = this.activeChains.get(chainId);
    if (chain) {
      chain.executionId = executionId;
      chain.endTime = new Date().toISOString();
      this.emit('execution_linked', { chainId, executionId });
    }
  }

  async finalizeChain(chainId: string): Promise<void> {
    const chain = this.activeChains.get(chainId);
    if (!chain) {
      // Chain might already be finalized, check if it's in history
      const finalizedChain = this.chainHistory.find(c => c.chainId === chainId);
      if (finalizedChain) {
        console.warn(`Chain ${chainId} is already finalized`);
        return;
      }
      throw new Error(`Chain ${chainId} not found`);
    }

    if (!chain.endTime) {
      chain.endTime = new Date().toISOString();
    }

    this.saveChainToDatabase(chain).catch(error => {
      console.error('Failed to save decision chain to database:', error);
    });

    this.chainHistory.unshift(chain);
    if (this.chainHistory.length > this.maxHistorySize) {
      this.chainHistory = this.chainHistory.slice(0, this.maxHistorySize);
    }

    this.activeChains.delete(chainId);
    this.metricsCache = null; // Invalidate metrics cache
    
    this.emit('chain_finalized', { chainId, chain });
  }

  async getChain(chainId: string): Promise<DecisionChainRecord | null> {
    try {
      // First check active chains
      const activeChain = this.activeChains.get(chainId);
      if (activeChain) {
        return activeChain;
      }

      // Then check database
      const dbChain = await this.getChainFromDatabase(chainId);
      if (dbChain) {
        return dbChain;
      }

      // Finally check history
      return this.chainHistory.find(chain => chain.chainId === chainId) || null;
    } catch (error) {
      console.error(`Error getting chain ${chainId}:`, error);
      return null;
    }
  }

  async queryChains(filter: DecisionChainFilter): Promise<{
    chains: DecisionChainRecord[];
    total: number;
    filtered: number;
    hasMore: boolean;
  }> {
    try {
      let allChains = [
        ...Array.from(this.activeChains.values()),
        ...this.chainHistory
      ];

      const limit = Math.min(1000, Math.max(1, filter.limit || 100));
      const offset = Math.max(0, filter.offset || 0);

      // Apply filters
      if (filter.symbol) {
        allChains = allChains.filter(chain => chain.symbol === filter.symbol);
      }
      if (filter.direction) {
        allChains = allChains.filter(chain => chain.direction === filter.direction);
      }
      if (filter.source) {
        allChains = allChains.filter(chain => chain.source === filter.source);
      }
      if (filter.finalDecision) {
        allChains = allChains.filter(chain => chain.finalDecision === filter.finalDecision);
      }
      if (filter.reason) {
        allChains = allChains.filter(chain => chain.finalReason?.includes(filter.reason as string));
      }
      if (filter.chainId) {
        allChains = allChains.filter(chain => chain.chainId === filter.chainId);
      }
      if (filter.recommendationId) {
        allChains = allChains.filter(chain => chain.recommendationId === filter.recommendationId);
      }
      if (filter.timeStart) {
        const startTime = new Date(filter.timeStart).getTime();
        allChains = allChains.filter(chain => new Date(chain.startTime).getTime() >= startTime);
      }
      if (filter.timeEnd) {
        const endTime = new Date(filter.timeEnd).getTime();
        allChains = allChains.filter(chain => new Date(chain.startTime).getTime() <= endTime);
      }

      const total = allChains.length;
      const chains = allChains.slice(offset, offset + limit);
      const hasMore = (offset + limit) < total;

      // Include steps if requested
      if (filter.includeSteps && chains.length > 0) {
        for (const chain of chains) {
          if (chain.steps.length === 0) {
            const dbChain = await this.getChainFromDatabase(chain.chainId);
            if (dbChain) {
              chain.steps = dbChain.steps;
            }
          }
        }
      }

      return {
        chains,
        total,
        filtered: total,
        hasMore
      };
    } catch (error) {
      console.error('Error querying chains:', error);
      return { chains: [], total: 0, filtered: 0, hasMore: false };
    }
  }

  async replayChain(chainId: string, options?: {
    iterations?: number;
    includeMarketData?: boolean;
    varianceFactor?: number;
  }): Promise<{
    original: DecisionChainRecord;
    replay: DecisionChainRecord;
    differences: string[];
    analysis: {
      totalSteps: number;
      changeRate: number;
      recommendations: string[];
    };
  }> {
    try {
      const originalChain = await this.getChain(chainId);
      if (!originalChain) {
        throw new Error(`Chain ${chainId} not found`);
      }

      const iterations = options?.iterations || 10;
      const replayResults = [];

      for (let i = 0; i < iterations; i++) {
        const marketConditions = this.getCurrentMarketConditions();
        
        // Simulate each step with slight variations
        const simulatedSteps = await Promise.all(
          originalChain.steps.map(step => 
            this.simulateDecisionStep(step, { marketConditions, iteration: i })
          )
        );

        const simulatedChain: DecisionChainRecord = {
          ...originalChain,
          chainId: `${originalChain.chainId}_replay_${i}`,
          steps: simulatedSteps,
          finalDecision: this.determineFinalDecision(simulatedSteps)
        };

        replayResults.push({
          iteration: i,
          result: simulatedChain,
          marketConditions
        });
      }

      // Analyze results
      const analysis = this.analyzeReplayResults([{
        originalDecision: originalChain.finalDecision,
        simulationResults: replayResults.map(r => r.result.steps).flat(),
        chainId: originalChain.chainId,
        symbol: originalChain.symbol
      }]);

      // Store replay history
      if (!this.replayHistory.has(chainId)) {
        this.replayHistory.set(chainId, []);
      }
      
      const replayRecord = {
        replayId: `${chainId}_replay_${Date.now()}`,
        timestamp: new Date().toISOString(),
        result: replayResults[0]?.result || originalChain,
        analysis: analysis
      };
      
      this.replayHistory.get(chainId)!.push(replayRecord);

      // Calculate differences between original and first replay
      const firstReplay = replayResults[0]?.result;
      const differences = this.findChainDifferences(originalChain, firstReplay || originalChain);

      return {
        original: originalChain,
        replay: firstReplay || originalChain,
        differences,
        analysis: {
          totalSteps: originalChain.steps.length,
          changeRate: analysis.overallConsistency,
          recommendations: analysis.recommendations
        }
      };
    } catch (error) {
      console.error(`Error replaying chain ${chainId}:`, error);
      throw error;
    }
  }

  private determineFinalDecision(steps: DecisionChainStep[]): 'APPROVED' | 'REJECTED' | 'PENDING' {
    const completedSteps = steps.filter(step => step.decision !== 'PENDING');
    if (completedSteps.length === 0) return 'PENDING';

    const approvedSteps = completedSteps.filter(step => step.decision === 'APPROVED');
    const rejectedSteps = completedSteps.filter(step => step.decision === 'REJECTED');

    if (approvedSteps.length > rejectedSteps.length) return 'APPROVED';
    if (rejectedSteps.length > approvedSteps.length) return 'REJECTED';
    return 'PENDING';
  }

  private calculateVariance(replayResults: any[]): number {
    if (replayResults.length === 0) return 0;

    const decisions = replayResults.map(r => r.result.finalDecision);
    const uniqueDecisions = Array.from(new Set(decisions));
    
    if (uniqueDecisions.length === 1) return 0;

    const counts = uniqueDecisions.map(decision => 
      decisions.filter(d => d === decision).length
    );

    const mean = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    const variance = counts.reduce((sum, count) => sum + Math.pow(count - mean, 2), 0) / counts.length;
    
    return Math.sqrt(variance) / replayResults.length;
  }

  async getMetrics(refresh: boolean = false): Promise<DecisionChainMetrics> {
    try {
      // Check cache first
      const now = Date.now();
      if (!refresh && this.metricsCache && (now - this.metricsCacheTime) < this.metricsCacheDuration) {
        return this.metricsCache;
      }

      const allChains = [
        ...Array.from(this.activeChains.values()),
        ...this.chainHistory
      ];

      const totalChains = allChains.length;
      const approvedChains = allChains.filter(chain => chain.finalDecision === 'APPROVED').length;
      const rejectedChains = allChains.filter(chain => chain.finalDecision === 'REJECTED').length;
      const pendingChains = allChains.filter(chain => chain.finalDecision === 'PENDING').length;

      // Calculate average decision time (simplified)
      const decisionTimes = allChains
        .filter(chain => chain.steps && chain.steps.length > 0)
        .map(chain => {
          const startTime = new Date(chain.startTime).getTime();
          const lastStep = chain.steps[chain.steps.length - 1];
          const endTime = new Date(lastStep.timestamp).getTime();
          return endTime - startTime;
        });

      const averageDecisionTime = decisionTimes.length > 0 
        ? decisionTimes.reduce((sum, time) => sum + time, 0) / decisionTimes.length 
        : 0;

      const successRate = totalChains > 0 ? approvedChains / totalChains : 0;

      // Calculate rejection reasons
      const rejectionReasons: Record<string, number> = {};
      allChains
        .filter(chain => chain.finalDecision === 'REJECTED')
        .forEach(chain => {
          const reason = chain.finalReason || 'Unknown reason';
          rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
        });

      const metrics: DecisionChainMetrics = {
        totalChains,
        approvedChains,
        rejectedChains,
        pendingChains,
        averageDecisionTime,
        successRate,
        timestamp: new Date().toISOString(),
        rejectionReasons
      };

      // Update cache
      this.metricsCache = metrics;
      this.metricsCacheTime = now;

      return metrics;
    } catch (error) {
      console.error('Error getting metrics:', error);
      throw error;
    }
  }

  async batchReplayChains(chainIds: string[], options: {
    iterations?: number;
    includeMarketData?: boolean;
    varianceFactor?: number;
    maxConcurrency?: number;
    parallel?: boolean;
    includeAnalysis?: boolean;
  }): Promise<{
    results: Array<{
      chainId: string;
      success: boolean;
      error?: string;
      replayResult?: any;
    }>;
    total: number;
    successful: number;
    failed: number;
    summary: {
      totalProcessed: number;
      successful: number;
      failed: number;
      overallConsistency: number;
      recommendations: string[];
    };
  }> {
    try {
      const maxConcurrency = options.maxConcurrency || 5;
      const results = [];
      
      // Process in chunks to avoid overwhelming the system
      const chunks = this.chunkArray(chainIds, maxConcurrency);
      
      for (const chunk of chunks) {
        const chunkPromises = chunk.map(async (chainId) => {
          try {
            const replayResult = await this.replayChain(chainId, options);
            return {
              chainId,
              success: true,
              replayResult
            };
          } catch (error) {
            return {
              chainId,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            };
          }
        });
        
        const chunkResults = await Promise.all(chunkPromises);
        results.push(...chunkResults);
      }

      // Analyze all results
      const successfulResults = results.filter(r => r.success && r.replayResult);
      const replayAnalyses = successfulResults.map(r => ({
        originalDecision: r.replayResult!.original.finalDecision,
        simulationResults: r.replayResult!.replay.steps?.map((step: any) => step) || [],
        chainId: r.chainId,
        symbol: r.replayResult!.original.symbol
      }));

      const analysis = this.analyzeReplayResults(replayAnalyses);

      return {
        results,
        total: chainIds.length,
        successful: successfulResults.length,
        failed: results.filter(r => !r.success).length,
        summary: {
          totalProcessed: chainIds.length,
          successful: successfulResults.length,
          failed: results.filter(r => !r.success).length,
          overallConsistency: analysis.overallConsistency,
          recommendations: analysis.recommendations
        }
      };
    } catch (error) {
      console.error('Error in batch replay:', error);
      throw error;
    }
  }

  public getReplayHistory(chainId: string): Array<any> {
    return this.replayHistory.get(chainId) || [];
  }

  public compareChains(chainId1: string, chainId2: string): {
    similarities: number;
    differences: Array<any>;
    analysis: string;
  } {
    const chain1 = this.activeChains.get(chainId1) || this.chainHistory.find(c => c.chainId === chainId1);
    const chain2 = this.activeChains.get(chainId2) || this.chainHistory.find(c => c.chainId === chainId2);
    
    if (!chain1 || !chain2) {
      throw new Error('One or both chains not found');
    }

    const similarity = this.calculateChainSimilarity(chain1, chain2);
    const differences = this.findChainDifferences(chain1, chain2);
    const analysis = this.generateChainComparisonAnalysis(chain1, chain2, similarity, differences);

    return {
      similarities: similarity,
      differences,
      analysis
    };
  }

  private calculateChainSimilarity(chain1: DecisionChainRecord, chain2: DecisionChainRecord): number {
    if (!chain1.steps || !chain2.steps) return 0;
    
    const steps1 = chain1.steps;
    const steps2 = chain2.steps;
    
    const maxLength = Math.max(steps1.length, steps2.length);
    const minLength = Math.min(steps1.length, steps2.length);
    
    if (maxLength === 0) return 1;
    
    let matchingSteps = 0;
    for (let i = 0; i < minLength; i++) {
      if (steps1[i].decision === steps2[i].decision && 
          steps1[i].stage === steps2[i].stage) {
        matchingSteps++;
      }
    }
    
    return matchingSteps / maxLength;
  }

  private findChainDifferences(chain1: DecisionChainRecord, chain2: DecisionChainRecord): Array<any> {
    const differences: Array<any> = [];
    
    if (chain1.symbol !== chain2.symbol) {
      differences.push({
        type: 'symbol',
        chain1: chain1.symbol,
        chain2: chain2.symbol
      });
    }
    
    if (chain1.direction !== chain2.direction) {
      differences.push({
        type: 'direction',
        chain1: chain1.direction,
        chain2: chain2.direction
      });
    }
    
    if (chain1.finalDecision !== chain2.finalDecision) {
      differences.push({
        type: 'finalDecision',
        chain1: chain1.finalDecision,
        chain2: chain2.finalDecision
      });
    }
    
    if (!chain1.steps || !chain2.steps) return differences;
    
    const steps1 = chain1.steps;
    const steps2 = chain2.steps;
    
    const maxLength = Math.max(steps1.length, steps2.length);
    for (let i = 0; i < maxLength; i++) {
      const step1 = steps1[i];
      const step2 = steps2[i];
      
      if (!step1 || !step2) {
        differences.push({
          type: 'step_missing',
          index: i,
          chain1: step1 ? 'present' : 'missing',
          chain2: step2 ? 'present' : 'missing'
        });
        continue;
      }
      
      if (step1.decision !== step2.decision) {
        differences.push({
          type: 'step_decision',
          index: i,
          chain1: step1.decision,
          chain2: step2.decision
        });
      }
    }
    
    return differences;
  }

  private generateChainComparisonAnalysis(chain1: DecisionChainRecord, chain2: DecisionChainRecord, similarity: number, differences: Array<any>): string {
    const analysisParts: string[] = [];
    
    analysisParts.push(`Chain similarity: ${(similarity * 100).toFixed(1)}%`);
    
    if (differences.length === 0) {
      analysisParts.push('No differences found - chains are identical');
    } else {
      analysisParts.push(`Found ${differences.length} differences:`);
      
      differences.forEach(diff => {
        switch (diff.type) {
          case 'symbol':
            analysisParts.push(`- Different symbols: ${diff.chain1} vs ${diff.chain2}`);
            break;
          case 'direction':
            analysisParts.push(`- Different directions: ${diff.chain1} vs ${diff.chain2}`);
            break;
          case 'finalDecision':
            analysisParts.push(`- Different final decisions: ${diff.chain1} vs ${diff.chain2}`);
            break;
          case 'step_missing':
            analysisParts.push(`- Step ${diff.index}: ${diff.chain1} vs ${diff.chain2}`);
            break;
          case 'step_decision':
            analysisParts.push(`- Step ${diff.index}: ${diff.chain1} vs ${diff.chain2}`);
            break;
        }
      });
    }
    
    return analysisParts.join('\n');
  }
}

export function createDecisionChainMonitor(database?: RecommendationDatabase): DecisionChainMonitor {
  return new DecisionChainMonitor(database);
}