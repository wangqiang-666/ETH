import { execSync } from 'child_process';
import * as os from 'os';

/**
 * VPN环境检测和配置优化模块
 * 专门针对通过VPN连接OKX API的网络环境进行优化
 */

// VPN环境检测函数
export function detectVPNEnvironment(): boolean {
    try {
        // 检查网络接口是否包含VPN相关接口
        const networkInterfaces = os.networkInterfaces();
        const vpnInterfaces = ['utun', 'tun', 'tap', 'ppp'];
        
        for (const [name, interfaces] of Object.entries(networkInterfaces)) {
            if (vpnInterfaces.some(vpn => name.toLowerCase().includes(vpn))) {
                return true;
            }
        }
        
        // 检查环境变量
        if (process.env.VPN_ACTIVE === 'true' || 
            process.env.TUNNEL_ACTIVE === 'true' ||
            process.env.PROXY_ACTIVE === 'true') {
            return true;
        }
        
        // 检查路由表（macOS）
        if (process.platform === 'darwin') {
            try {
                const routes = execSync('netstat -rn | grep -E "utun|tun|tap"', { encoding: 'utf8' });
                if (routes.trim().length > 0) {
                    return true;
                }
            } catch (error) {
                // 忽略命令执行错误
            }
        }
        
        return false;
    } catch (error) {
        console.warn('VPN检测失败，默认为非VPN环境:', error);
        return false;
    }
}

// 获取VPN优化配置
export function getVPNOptimizedConfig() {
    const isVPN = detectVPNEnvironment();
    const isMacOS = process.platform === 'darwin';
    
    return {
        // VPN环境标识
        isVPNEnvironment: isVPN,
        isMacOS,
        
        // 连接池配置 - VPN环境需要更保守的设置
        pool: {
            maxSockets: isVPN ? 5 : (isMacOS ? 10 : 20),
            maxFreeSockets: isVPN ? 2 : (isMacOS ? 5 : 10),
            keepAlive: isVPN ? false : (isMacOS ? false : true),
            keepAliveMsecs: isVPN ? 2000 : (isMacOS ? 3000 : 5000),
            maxTotalSockets: isVPN ? 15 : (isMacOS ? 50 : 100),
            timeout: isVPN ? 45000 : (isMacOS ? 35000 : 30000)
        },
        
        // 重试配置 - VPN环境需要更多重试
        retry: {
            retries: isVPN ? 5 : (isMacOS ? 3 : 3),
            retryDelay: isVPN ? 3000 : (isMacOS ? 2000 : 1000),
            retryCondition: 'network_error',
            exponentialBackoff: isVPN ? true : false,
            maxRetryDelay: isVPN ? 10000 : 5000
        },
        
        // 健康检查配置 - VPN环境需要更频繁的检查
        healthCheck: {
            enabled: true,
            interval: isVPN ? 20000 : (isMacOS ? 30000 : 45000),
            timeout: isVPN ? 15000 : (isMacOS ? 10000 : 8000),
            retries: isVPN ? 3 : (isMacOS ? 2 : 2),
            endpoint: '/health',
            endpoints: [
                '/api/v5/public/time',
                '/api/v5/market/ticker?instId=BTC-USDT-SWAP'
            ]
        },
        
        // DNS配置 - VPN环境可能需要特殊DNS设置
        dns: {
            lookup: isVPN ? 'ipv4first' : 'verbatim',
            family: isVPN ? 4 : 0, // 强制IPv4
            hints: isVPN ? 0 : undefined
        },
        
        // 请求配置
        request: {
            timeout: isVPN ? 45000 : (isMacOS ? 35000 : 30000),
            connectTimeout: isVPN ? 15000 : (isMacOS ? 10000 : 8000),
            socketTimeout: isVPN ? 30000 : (isMacOS ? 25000 : 20000),
            maxRedirects: isVPN ? 3 : 5,
            maxContentLength: isVPN ? 50 * 1024 * 1024 : 100 * 1024 * 1024 // 50MB vs 100MB
        },
        
        // 压缩配置
        compression: {
            enabled: true,
            level: isVPN ? 4 : 6, // VPN环境降低压缩级别以减少CPU负载
            threshold: isVPN ? 2048 : 1024 // VPN环境提高压缩阈值
        },
        
        // 缓存配置 - VPN环境更积极的缓存
        cache: {
            enabled: isVPN ? true : false,
            ttl: isVPN ? 30000 : 10000, // VPN环境缓存30秒
            maxSize: isVPN ? 1000 : 500
        },
        
        // 错误处理配置
        errorHandling: {
            retryOnTimeout: true,
            retryOnConnectionError: true,
            retryOnDNSError: isVPN ? true : false,
            logErrors: isVPN ? true : false
        }
    };
}

// 获取VPN环境的Axios配置
export function getVPNAxiosConfig() {
    const config = getVPNOptimizedConfig();
    
    return {
        timeout: config.request.timeout,
        maxRedirects: config.request.maxRedirects,
        maxContentLength: config.request.maxContentLength,
        
        // HTTP Agent配置
        httpAgent: {
            keepAlive: config.pool.keepAlive,
            keepAliveMsecs: config.pool.keepAliveMsecs,
            maxSockets: config.pool.maxSockets,
            maxFreeSockets: config.pool.maxFreeSockets,
            timeout: config.pool.timeout,
            freeSocketTimeout: config.isVPNEnvironment ? 15000 : 30000
        },
        
        // HTTPS Agent配置
        httpsAgent: {
            keepAlive: config.pool.keepAlive,
            keepAliveMsecs: config.pool.keepAliveMsecs,
            maxSockets: config.pool.maxSockets,
            maxFreeSockets: config.pool.maxFreeSockets,
            timeout: config.pool.timeout,
            freeSocketTimeout: config.isVPNEnvironment ? 15000 : 30000,
            rejectUnauthorized: true
        },
        
        // 请求拦截器配置
        interceptors: {
            request: {
                timeout: config.request.connectTimeout,
                retries: config.retry.retries,
                retryDelay: config.retry.retryDelay
            },
            response: {
                validateStatus: (status: number) => status >= 200 && status < 300,
                timeout: config.request.socketTimeout
            }
        }
    };
}

// 导出配置常量
export const VPN_CONFIG = {
    // VPN检测相关
    VPN_INTERFACES: ['utun', 'tun', 'tap', 'ppp'],
    VPN_ENV_VARS: ['VPN_ACTIVE', 'TUNNEL_ACTIVE', 'PROXY_ACTIVE'],
    
    // 超时配置
    TIMEOUTS: {
        VPN: {
            connect: 15000,
            socket: 30000,
            request: 45000
        },
        NORMAL: {
            connect: 8000,
            socket: 20000,
            request: 30000
        }
    },
    
    // 重试配置
    RETRY: {
        VPN: {
            count: 5,
            delay: 3000,
            maxDelay: 10000
        },
        NORMAL: {
            count: 3,
            delay: 1000,
            maxDelay: 5000
        }
    }
};

export default {
    detectVPNEnvironment,
    getVPNOptimizedConfig,
    getVPNAxiosConfig,
    VPN_CONFIG
};