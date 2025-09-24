import { enhancedOKXDataService } from '../services/enhanced-okx-data-service.js';
import { defaultCacheManager } from '../utils/smart-cache-manager.js';
import { recommendationTracker } from '../services/recommendation-tracker.js';

/**
 * 测试清理工具
 * 用于在测试结束后清理服务资源，防止"Cannot log after tests are done"错误
 */
export async function cleanupServices(): Promise<void> {
  console.log('🧹 开始清理测试服务...');
  
  try {
    // 关闭增强OKX数据服务
    if (enhancedOKXDataService && typeof enhancedOKXDataService.shutdown === 'function') {
      await enhancedOKXDataService.shutdown();
      console.log('✅ 增强OKX数据服务已关闭');
    }
    
    // 关闭默认缓存管理器
    if (defaultCacheManager && typeof defaultCacheManager.stopCleanupTimer === 'function') {
      await defaultCacheManager.stopCleanupTimer();
      console.log('✅ 默认缓存管理器已关闭');
    }
    
    // 关闭推荐跟踪器
    if (recommendationTracker && typeof recommendationTracker.stop === 'function') {
      await recommendationTracker.stop();
      console.log('✅ 推荐跟踪器已关闭');
    }
    
    console.log('🧹 测试服务清理完成');
  } catch (error) {
    console.error('❌ 清理服务时出错:', error);
  }
}

/**
 * Jest global setup function
 * This runs before all tests start
 */
export async function setup(): Promise<void> {
  console.log('🚀 开始测试全局设置...');
  // Add any setup needed before tests run
}

/**
 * Jest global teardown function
 * This runs after all tests complete
 */
export async function teardown(): Promise<void> {
  console.log('🏁 开始测试全局清理...');
  await cleanupServices();
}

// Default export for Jest compatibility
export default async function(): Promise<void> {
  await teardown();
}