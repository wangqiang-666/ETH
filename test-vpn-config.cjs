const { config } = require('./dist/config.js');

console.log('=== VPN配置测试 ===');
console.log('VPN环境检测:', config.vpn?.isVPNEnvironment);
console.log('macOS环境:', config.vpn?.isMacOS);
console.log('代理配置:');
console.log('  - 启用状态:', config.proxy?.enabled);
console.log('  - 代理URL:', config.proxy?.url);
console.log('  - VPN环境标识:', config.proxy?.vpnEnvironment);
console.log('  - 连接池配置:', config.proxy?.pool);
console.log('  - 重试配置:', config.proxy?.retry);
console.log('  - 健康检查:', config.proxy?.healthCheck);
console.log('OKX配置:');
console.log('  - 使用代理:', config.okx?.useProxy);
console.log('  - 超时时间:', config.okx?.timeout);
console.log('=== 测试完成 ===');