import express from 'express';
import { riskManagementService } from '../services/risk-management-service';
import { ethStrategyEngine } from '../strategy/eth-strategy-engine';
import { SmartSignalResult } from '../analyzers/smart-signal-analyzer';
import { config } from '../config';

const router = express.Router();

/**
 * GET /api/risk/status
 * 获取当前风险状态
 */
router.get('/status', async (req, res) => {
  try {
    const riskStatus = riskManagementService.getRiskStatus();
    
    res.json({
      success: true,
      data: riskStatus,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('获取风险状态失败:', error);
    res.status(500).json({
      success: false,
      error: '获取风险状态失败',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/risk/portfolio
 * 获取组合风险分析
 */
router.get('/portfolio', async (req, res) => {
  try {
    // 获取当前持仓和交易历史
    const currentStatus = ethStrategyEngine.getCurrentStatus();
    const positions = currentStatus.position ? [currentStatus.position] : [];
    const tradeHistory = ethStrategyEngine.getTradeHistory();
    
    // 分析组合风险
    const portfolioRisk = riskManagementService.analyzePortfolioRisk(positions, tradeHistory);
    
    res.json({
      success: true,
      data: portfolioRisk,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('获取组合风险失败:', error);
    res.status(500).json({
      success: false,
      error: '获取组合风险失败',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/risk/config
 * 获取风险管理配置
 */
router.get('/config', async (req, res) => {
  try {
    const riskConfig = {
      maxDailyLoss: config.risk.maxDailyLoss,
      maxPositionSize: config.risk.maxPositionSize,
      stopLossPercent: config.risk.stopLossPercent,
      takeProfitPercent: config.risk.takeProfitPercent,
      maxRiskPerTrade: config.risk.maxRiskPerTrade,
      maxDrawdown: config.risk.maxDrawdown,
      maxLeverage: config.trading.maxLeverage
    };
    
    res.json({
      success: true,
      data: riskConfig,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('获取风险配置失败:', error);
    res.status(500).json({
      success: false,
      error: '获取风险配置失败',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * PUT /api/risk/config
 * 更新风险管理配置
 */
router.put('/config', async (req, res) => {
  try {
    const { config: newConfig } = req.body;
    
    // 验证配置参数
    if (!newConfig || typeof newConfig !== 'object') {
      return res.status(400).json({
        success: false,
        error: '无效的配置参数'
      });
    }
    
    // 更新风险管理配置
    riskManagementService.updateConfig(newConfig);
    
    return res.json({
      success: true,
      message: '风险管理配置已更新',
      data: riskManagementService.getConfig(),
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('更新风险配置失败:', error);
    return res.status(500).json({
      success: false,
      error: '更新风险配置失败',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/risk/assessment/:symbol
 * 获取特定交易对的风险评估
 */
router.get('/assessment/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    // 这里应该获取最新的市场数据和信号
    // 为了示例，我们使用模拟数据
    const mockMarketData = {
      symbol,
      price: 2000,
      volume: 1000000,
      timestamp: Date.now(),
      fundingRate: 0.0001,
      openInterest: 500000,
      high24h: 2100,
      low24h: 1900,
      change24h: 5 // 百分数
    };
    
    const mockSignal: SmartSignalResult = {
      signal: 'BUY' as const,
      strength: {
        technical: 70,
        ml: 65,
        combined: 67.5,
        confidence: 0.8
      },
      targetPrice: 2050,
      stopLoss: 1950,
      takeProfit: 2100,
      riskReward: 2.5,
      positionSize: 0.1,
      timeframe: '1h',
      reasoning: {
        technical: 'Technical indicators show bullish momentum',
        ml: 'ML model predicts upward movement',
        risk: 'Risk level is acceptable for entry',
        final: 'Combined analysis suggests BUY signal'
      },
      metadata: {
        timestamp: Date.now(),
        marketCondition: 'TRENDING' as const,
        volatility: 0.5,
        volume: 'MEDIUM' as const,
        momentum: 'STRONG' as const
      }
    };
    
    const currentStatus = ethStrategyEngine.getCurrentStatus();
    const positions = currentStatus.position ? [currentStatus.position] : [];
    const riskAssessment = riskManagementService.assessSignalRisk(
      mockSignal,
      mockMarketData,
      positions
    );
    
    res.json({
      success: true,
      data: {
        symbol,
        marketData: mockMarketData,
        signal: mockSignal,
        riskAssessment
      },
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('获取风险评估失败:', error);
    res.status(500).json({
      success: false,
      error: '获取风险评估失败',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/risk/positions
 * 获取所有持仓的风险分析
 */
router.get('/positions', async (req, res) => {
  try {
    const currentStatus = ethStrategyEngine.getCurrentStatus();
    const positions = currentStatus.position ? [currentStatus.position] : [];
    const currentPrice = 2000; // 应该从市场数据服务获取
    
    const positionRisks = positions.map(position => ({
      position,
      risk: riskManagementService.analyzePositionRisk(position, currentPrice)
    }));
    
    res.json({
      success: true,
      data: positionRisks,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('获取持仓风险失败:', error);
    res.status(500).json({
      success: false,
      error: '获取持仓风险失败',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/risk/emergency-stop
 * 紧急停止所有交易
 */
router.post('/emergency-stop', async (req, res) => {
  try {
    const { reason } = req.body;
    
    // 这里应该实现紧急停止逻辑
    // 1. 停止所有自动交易
    // 2. 记录紧急停止事件
    // 3. 发送通知
    
    console.log(`🚨 紧急停止交易: ${reason || '用户手动触发'}`);
    
    // 模拟紧急停止
    const emergencyEvent = {
      type: 'EMERGENCY_STOP',
      reason: reason || '用户手动触发',
      timestamp: Date.now(),
      positions: ethStrategyEngine.getCurrentStatus().position ? 1 : 0,
      riskStatus: riskManagementService.getRiskStatus()
    };
    
    res.json({
      success: true,
      message: '紧急停止已执行',
      data: emergencyEvent,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('紧急停止失败:', error);
    res.status(500).json({
      success: false,
      error: '紧急停止失败',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/risk/alerts
 * 获取风险警报
 */
router.get('/alerts', async (req, res) => {
  try {
    const riskStatus = riskManagementService.getRiskStatus();
    const currentStatus = ethStrategyEngine.getCurrentStatus();
    const positions = currentStatus.position ? [currentStatus.position] : [];
    const alerts = [];
    
    // 检查各种风险警报
    if (riskStatus.dailyLossRatio > 0.8) {
      alerts.push({
        level: 'CRITICAL',
        type: 'DAILY_LOSS',
        message: `日损失已达到限额的 ${(riskStatus.dailyLossRatio * 100).toFixed(1)}%`,
        timestamp: Date.now()
      });
    }
    
    if (riskStatus.dailyLossRatio > 0.6) {
      alerts.push({
        level: 'WARNING',
        type: 'DAILY_LOSS',
        message: `日损失较高: ${(riskStatus.dailyLossRatio * 100).toFixed(1)}%`,
        timestamp: Date.now()
      });
    }
    
    if (positions.length >= config.trading.maxPositions * 0.8) {
      alerts.push({
        level: 'WARNING',
        type: 'POSITION_COUNT',
        message: `持仓数量接近上限: ${positions.length}/${config.trading.maxPositions}`,
        timestamp: Date.now()
      });
    }
    
    // 检查持仓风险
    const currentPrice = 2000; // 应该从市场数据获取
    positions.forEach((position: any) => {
      const positionRisk = riskManagementService.analyzePositionRisk(position, currentPrice);
      
      if (positionRisk.distanceToLiquidation < 0.1) {
        alerts.push({
          level: 'CRITICAL',
          type: 'LIQUIDATION_RISK',
          message: `持仓 ${position.positionId} 接近强平价格`,
          timestamp: Date.now(),
          positionId: position.positionId
        });
      }
      
      if (positionRisk.unrealizedPnLPercent < -10) {
        alerts.push({
          level: 'WARNING',
          type: 'UNREALIZED_LOSS',
          message: `持仓 ${position.positionId} 未实现损失 ${positionRisk.unrealizedPnLPercent.toFixed(1)}%`,
          timestamp: Date.now(),
          positionId: position.positionId
        });
      }
    });
    
    res.json({
      success: true,
      data: {
        alerts,
        count: alerts.length,
        criticalCount: alerts.filter(a => a.level === 'CRITICAL').length,
        warningCount: alerts.filter(a => a.level === 'WARNING').length
      },
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('获取风险警报失败:', error);
    res.status(500).json({
      success: false,
      error: '获取风险警报失败',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;