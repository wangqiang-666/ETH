#!/usr/bin/env node

import { ethStrategyApp } from './app.js';
import { logger } from './utils/logger.js';
import { config } from './config.js';

async function main() {
  try {
    logger.info('🚀 启动ETH合约策略分析系统...');
    
    const app = ethStrategyApp;
    
    // 启动应用
    await app.start();
    
    logger.info('✅ ETH合约策略分析系统启动成功!');
    logger.info(`📊 Web界面: http://localhost:${config.webServer.port}`);
    logger.info(`🔧 API 根路径: http://localhost:${config.webServer.port}/api`);
    
  } catch (error) {
    logger.error('❌ 启动失败:', error);
    process.exit(1);
  }
}

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  logger.error('未捕获的异常:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('未处理的Promise拒绝:', reason);
  process.exit(1);
});

// 启动应用
main().catch((error) => {
  logger.error('主函数执行失败:', error);
  process.exit(1);
});