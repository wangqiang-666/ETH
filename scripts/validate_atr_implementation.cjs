#!/usr/bin/env node

/**
 * ATR动态止损实现验证脚本
 * 检查数据库、代码和API是否正确实现了ATR功能
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkFileExists(filePath) {
  return fs.existsSync(path.join(PROJECT_ROOT, filePath));
}

function searchInFile(filePath, searchTerms) {
  try {
    const content = fs.readFileSync(path.join(PROJECT_ROOT, filePath), 'utf8');
    const results = {};
    searchTerms.forEach(term => {
      const regex = new RegExp(term, 'gi');
      const matches = content.match(regex);
      results[term] = matches ? matches.length : 0;
    });
    return results;
  } catch (error) {
    return null;
  }
}

async function validateDatabaseSchema() {
  log('\n📊 验证数据库模式', 'blue');
  log('='.repeat(50));
  
  const dbPath = path.join(PROJECT_ROOT, 'data', 'recommendations.db');
  
  if (!checkFileExists('data/recommendations.db')) {
    log('⚠️  数据库文件不存在，跳过模式验证', 'yellow');
    return false;
  }
  
  try {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(dbPath);
    
    return new Promise((resolve) => {
      db.all("PRAGMA table_info(recommendations)", (err, rows) => {
        if (err) {
          log(`❌ 数据库查询失败: ${err.message}`, 'red');
          resolve(false);
          return;
        }
        
        const columns = rows.map(row => row.name);
        const requiredColumns = [
          'atr_value', 'atr_period', 'atr_sl_multiplier', 'atr_tp_multiplier',
          'tp1_hit', 'tp2_hit', 'tp3_hit', 'reduction_count', 'reduction_ratio'
        ];
        
        log('数据库列检查:');
        let allFound = true;
        
        requiredColumns.forEach(col => {
          if (columns.includes(col)) {
            log(`   ✅ ${col}`, 'green');
          } else {
            log(`   ❌ ${col}`, 'red');
            allFound = false;
          }
        });
        
        db.close();
        resolve(allFound);
      });
    });
  } catch (error) {
    log(`⚠️  无法验证数据库模式: ${error.message}`, 'yellow');
    return false;
  }
}

function validateCodeImplementation() {
  log('\n💻 验证代码实现', 'blue');
  log('='.repeat(50));
  
  const filesToCheck = [
    {
      path: 'src/services/recommendation-database.ts',
      terms: ['atr_value', 'atr_period', 'atr_sl_multiplier', 'atr_tp_multiplier', 'rowToRecommendation'],
      description: '数据库层ATR字段处理'
    },
    {
      path: 'src/services/recommendation-tracker.ts',
      terms: ['atr_value', 'atr_period', 'atr_sl_multiplier', 'atr_tp_multiplier', 'tp1_hit', 'reduction_count'],
      description: '推荐跟踪器ATR字段处理'
    },
    {
      path: 'src/services/recommendation-integration-service.ts',
      terms: ['position-reduced', 'reduction_count', 'reduction_ratio', 'updateRecommendation'],
      description: '集成服务事件处理'
    }
  ];
  
  let allValid = true;
  
  filesToCheck.forEach(file => {
    log(`\n检查 ${file.description}:`);
    
    if (!checkFileExists(file.path)) {
      log(`   ❌ 文件不存在: ${file.path}`, 'red');
      allValid = false;
      return;
    }
    
    const results = searchInFile(file.path, file.terms);
    if (!results) {
      log(`   ❌ 无法读取文件: ${file.path}`, 'red');
      allValid = false;
      return;
    }
    
    let fileValid = true;
    file.terms.forEach(term => {
      const count = results[term];
      if (count > 0) {
        log(`   ✅ ${term}: ${count} 处`, 'green');
      } else {
        log(`   ❌ ${term}: 未找到`, 'red');
        fileValid = false;
      }
    });
    
    if (!fileValid) {
      allValid = false;
    }
  });
  
  return allValid;
}

async function validateAPIEndpoints() {
  log('\n🌐 验证API端点', 'blue');
  log('='.repeat(50));
  
  try {
    // 检查Web服务器是否运行
    const response = await fetch('http://localhost:3010/api/active-recommendations');
    
    if (response.ok) {
      const data = await response.json();
      log('✅ Web服务器运行正常', 'green');
      
      if (data.data && data.data.recommendations && data.data.recommendations.length > 0) {
        const firstRec = data.data.recommendations[0];
        const hasATRFields = 
          firstRec.atr_value !== undefined &&
          firstRec.atr_period !== undefined &&
          firstRec.atr_sl_multiplier !== undefined &&
          firstRec.atr_tp_multiplier !== undefined;
        
        if (hasATRFields) {
          log('✅ API响应包含ATR字段', 'green');
          return true;
        } else {
          log('⚠️  API响应不包含ATR字段', 'yellow');
          return false;
        }
      } else {
        log('ℹ️  没有活跃推荐可用于验证', 'blue');
        return true;
      }
    } else {
      log(`⚠️  Web服务器响应异常: ${response.status}`, 'yellow');
      return false;
    }
  } catch (error) {
    log(`⚠️  无法连接到Web服务器: ${error.message}`, 'yellow');
    log('   请确保服务器正在运行: npm run web', 'blue');
    return false;
  }
}

function validateTestScripts() {
  log('\n🧪 验证测试脚本', 'blue');
  log('='.repeat(50));
  
  const testFiles = [
    'scripts/test_atr_functionality.cjs',
    'test-atr-functionality.js'
  ];
  
  let allExist = true;
  
  testFiles.forEach(file => {
    if (checkFileExists(file)) {
      log(`✅ ${file}`, 'green');
    } else {
      log(`❌ ${file}`, 'red');
      allExist = false;
    }
  });
  
  return allExist;
}

function generateImplementationReport(dbValid, codeValid, apiValid, testValid) {
  log('\n📋 ATR动态止损实现验证报告', 'blue');
  log('='.repeat(60));
  
  const results = [
    { name: '数据库模式', valid: dbValid, critical: true },
    { name: '代码实现', valid: codeValid, critical: true },
    { name: 'API端点', valid: apiValid, critical: false },
    { name: '测试脚本', valid: testValid, critical: false }
  ];
  
  let passed = 0;
  let criticalPassed = 0;
  let criticalTotal = 0;
  
  results.forEach(result => {
    const status = result.valid ? '✅ 通过' : '❌ 失败';
    const color = result.valid ? 'green' : 'red';
    
    log(`${status} ${result.name}`, color);
    
    if (result.valid) {
      passed++;
      if (result.critical) {
        criticalPassed++;
      }
    }
    
    if (result.critical) {
      criticalTotal++;
    }
  });
  
  log(`\n总结: ${passed}/${results.length} 项通过`, 
    criticalPassed === criticalTotal ? 'green' : 'red');
  
  if (criticalPassed === criticalTotal) {
    log('\n🎉 ATR动态止损功能实现完整!', 'green');
    log('\n📖 使用说明:', 'blue');
    log('   1. 运行测试: node scripts/test_atr_functionality.cjs');
    log('   2. 查看API文档: 访问 http://localhost:3010/api/active-recommendations');
    log('   3. 创建ATR推荐: POST /api/recommendations (包含atr_*字段)');
  } else {
    log('\n⚠️  关键功能未完全实现', 'yellow');
    log('   请检查上述失败项并修复问题', 'blue');
  }
  
  return criticalPassed === criticalTotal;
}

// 主验证函数
async function main() {
  console.clear();
  log('🔍 ATR动态止损功能实现验证', 'blue');
  log('='.repeat(60));
  
  const dbValid = await validateDatabaseSchema();
  const codeValid = validateCodeImplementation();
  const apiValid = await validateAPIEndpoints();
  const testValid = validateTestScripts();
  
  const overallValid = generateImplementationReport(dbValid, codeValid, apiValid, testValid);
  
  // 保存验证报告
  const report = {
    timestamp: new Date().toISOString(),
    results: {
      database: dbValid,
      code: codeValid,
      api: apiValid,
      tests: testValid,
      overall: overallValid
    }
  };
  
  const reportPath = path.join(PROJECT_ROOT, 'atr_validation_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  log(`\n💾 验证报告已保存: ${reportPath}`, 'blue');
  
  process.exit(overallValid ? 0 : 1);
}

// 错误处理
process.on('unhandledRejection', (error) => {
  log(`\n❌ 未处理的Promise拒绝: ${error.message}`, 'red');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  log(`\n❌ 未捕获的异常: ${error.message}`, 'red');
  process.exit(1);
});

// 运行验证
if (require.main === module) {
  main().catch(error => {
    log(`\n❌ 验证运行失败: ${error.message}`, 'red');
    process.exit(1);
  });
}

module.exports = {
  validateDatabaseSchema,
  validateCodeImplementation,
  validateAPIEndpoints,
  validateTestScripts
};