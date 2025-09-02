import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import * as dns from 'dns';
import { promisify } from 'util';

// 网络性能指标接口
interface NetworkMetrics {
  latency: number;          // 延迟 (ms)
  jitter: number;           // 抖动 (ms)
  packetLoss: number;       // 丢包率 (%)
  bandwidth: number;        // 带宽 (Mbps)
  dnsResolutionTime: number; // DNS解析时间 (ms)
  connectionTime: number;    // 连接建立时间 (ms)
  downloadSpeed: number;     // 下载速度 (KB/s)
  uploadSpeed: number;       // 上传速度 (KB/s)
}

// 路由跟踪结果
interface RouteHop {
  hop: number;
  ip: string;
  hostname?: string;
  latency: number[];
  avgLatency: number;
}

// 网络质量评估
interface NetworkQuality {
  overall: 'excellent' | 'good' | 'fair' | 'poor';
  score: number; // 0-100
  issues: string[];
  recommendations: string[];
}

// 代理性能对比
interface ProxyComparison {
  direct: NetworkMetrics;
  proxy: NetworkMetrics;
  improvement: number; // 性能提升百分比
  recommendation: 'use_proxy' | 'use_direct' | 'optimize_proxy';
}

export class NetworkPerformanceAnalyzer {
  private dnsLookup = promisify(dns.lookup);
  private testEndpoints = [
    'https://www.okx.com/api/v5/public/time',
    'https://api.okx.com/api/v5/public/time',
    config.proxy.url + '/api/v5/public/time'
  ];

  /**
   * 执行完整的网络性能分析
   */
  async analyzeNetworkPerformance(): Promise<{
    metrics: NetworkMetrics;
    quality: NetworkQuality;
    proxyComparison: ProxyComparison;
    routeAnalysis: RouteHop[];
  }> {
    console.log('🔍 开始网络性能分析...');
    
    const [metrics, proxyComparison, routeAnalysis] = await Promise.all([
      this.measureNetworkMetrics(),
      this.compareProxyPerformance(),
      this.analyzeNetworkRoute()
    ]);

    const quality = this.assessNetworkQuality(metrics);

    return {
      metrics,
      quality,
      proxyComparison,
      routeAnalysis
    };
  }

  /**
   * 测量网络基础指标
   */
  private async measureNetworkMetrics(): Promise<NetworkMetrics> {
    const latencies: number[] = [];
    const dnsResolutionTimes: number[] = [];
    const connectionTimes: number[] = [];
    const downloadSpeeds: number[] = [];

    // 执行多次测试以获得准确的平均值
    for (let i = 0; i < 10; i++) {
      try {
        // DNS解析时间测试
        const dnsStart = Date.now();
        await this.dnsLookup('www.okx.com');
        dnsResolutionTimes.push(Date.now() - dnsStart);

        // 连接和延迟测试
        const { latency, connectionTime, downloadSpeed } = await this.testEndpointPerformance('https://www.okx.com/api/v5/public/time');
        latencies.push(latency);
        connectionTimes.push(connectionTime);
        downloadSpeeds.push(downloadSpeed);

        // 间隔100ms避免过于频繁的请求
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        console.warn(`网络测试第${i + 1}次失败:`, error?.message ?? error);
      }
    }

    // 计算统计指标
    const avgLatency = this.calculateAverage(latencies);
    const jitter = this.calculateJitter(latencies);
    const packetLoss = this.calculatePacketLoss(latencies.length, 10);

    return {
      latency: avgLatency,
      jitter,
      packetLoss,
      bandwidth: await this.estimateBandwidth(),
      dnsResolutionTime: this.calculateAverage(dnsResolutionTimes),
      connectionTime: this.calculateAverage(connectionTimes),
      downloadSpeed: this.calculateAverage(downloadSpeeds),
      uploadSpeed: await this.testUploadSpeed()
    };
  }

  /**
   * 测试单个端点的性能
   */
  private async testEndpointPerformance(url: string): Promise<{
    latency: number;
    connectionTime: number;
    downloadSpeed: number;
  }> {
    const startTime = Date.now();
    let connectionTime = 0;
    let downloadSpeed = 0;

    try {
      const client = axios.create({
        timeout: 10000,
        validateStatus: () => true
      });

      // 添加请求拦截器记录连接时间
      client.interceptors.request.use(config => {
        (config as any).startTime = Date.now();
        return config;
      });

      client.interceptors.response.use(response => {
        const endTime = Date.now();
        const startTime = (response.config as any).startTime;
        connectionTime = endTime - startTime;
        
        // 计算下载速度 (假设响应大小)
        const responseSize = JSON.stringify(response.data).length;
        downloadSpeed = responseSize / (connectionTime / 1000); // bytes/second
        
        return response;
      });

      await client.get(url);
      const latency = Date.now() - startTime;

      return { latency, connectionTime, downloadSpeed };
    } catch (error) {
      return { latency: 9999, connectionTime: 9999, downloadSpeed: 0 };
    }
  }

  /**
   * 对比代理和直连性能
   */
  private async compareProxyPerformance(): Promise<ProxyComparison> {
    console.log('📊 对比代理和直连性能...');
    
    const [directMetrics, proxyMetrics] = await Promise.all([
      this.testDirectConnection(),
      this.testProxyConnection()
    ]);

    const improvement = this.calculateImprovement(directMetrics, proxyMetrics);
    const recommendation = this.getProxyRecommendation(improvement, directMetrics, proxyMetrics);

    return {
      direct: directMetrics,
      proxy: proxyMetrics,
      improvement,
      recommendation
    };
  }

  /**
   * 测试直连性能
   */
  private async testDirectConnection(): Promise<NetworkMetrics> {
    const client = axios.create({
      baseURL: 'https://www.okx.com',
      timeout: 10000
    });

    return await this.measureClientPerformance(client, '直连');
  }

  /**
   * 测试代理连接性能
   */
  private async testProxyConnection(): Promise<NetworkMetrics> {
    const client = axios.create({
      baseURL: config.proxy.url,
      timeout: 10000
    });

    return await this.measureClientPerformance(client, '代理');
  }

  /**
   * 测量客户端性能
   */
  private async measureClientPerformance(client: AxiosInstance, type: string): Promise<NetworkMetrics> {
    const latencies: number[] = [];
    const downloadSpeeds: number[] = [];
    let successCount = 0;
    const totalTests = 5;

    for (let i = 0; i < totalTests; i++) {
      try {
        const startTime = Date.now();
        const response = await client.get('/api/v5/public/time');
        const latency = Date.now() - startTime;
        
        if (response.status === 200) {
          latencies.push(latency);
          downloadSpeeds.push(JSON.stringify(response.data).length / (latency / 1000));
          successCount++;
        }
      } catch (error: any) {
        console.warn(`${type}连接测试失败:`, error?.message ?? error);
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    const packetLoss = ((totalTests - successCount) / totalTests) * 100;

    return {
      latency: this.calculateAverage(latencies),
      jitter: this.calculateJitter(latencies),
      packetLoss,
      bandwidth: 0, // 简化实现
      dnsResolutionTime: 0,
      connectionTime: this.calculateAverage(latencies),
      downloadSpeed: this.calculateAverage(downloadSpeeds),
      uploadSpeed: 0
    };
  }

  /**
   * 分析网络路由
   */
  private async analyzeNetworkRoute(): Promise<RouteHop[]> {
    // 简化的路由分析实现
    // 在实际环境中，可以使用traceroute工具
    return [
      { hop: 1, ip: '192.168.1.1', hostname: 'gateway', latency: [1, 2, 1], avgLatency: 1.3 },
      { hop: 2, ip: '10.0.0.1', hostname: 'isp-router', latency: [15, 18, 16], avgLatency: 16.3 },
      { hop: 3, ip: '43.132.123.32', hostname: 'hk-proxy', latency: [45, 48, 46], avgLatency: 46.3 }
    ];
  }

  /**
   * 评估网络质量
   */
  private assessNetworkQuality(metrics: NetworkMetrics): NetworkQuality {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    // 延迟评估
    if (metrics.latency > 200) {
      issues.push('网络延迟过高');
      recommendations.push('考虑使用更近的代理服务器');
      score -= 20;
    } else if (metrics.latency > 100) {
      issues.push('网络延迟较高');
      score -= 10;
    }

    // 抖动评估
    if (metrics.jitter > 50) {
      issues.push('网络抖动严重');
      recommendations.push('检查网络连接稳定性');
      score -= 15;
    }

    // 丢包率评估
    if (metrics.packetLoss > 5) {
      issues.push('丢包率过高');
      recommendations.push('检查网络设备和线路');
      score -= 25;
    } else if (metrics.packetLoss > 1) {
      issues.push('存在丢包现象');
      score -= 10;
    }

    // DNS解析时间评估
    if (metrics.dnsResolutionTime > 100) {
      issues.push('DNS解析缓慢');
      recommendations.push('使用更快的DNS服务器');
      score -= 10;
    }

    let overall: NetworkQuality['overall'];
    if (score >= 90) overall = 'excellent';
    else if (score >= 75) overall = 'good';
    else if (score >= 60) overall = 'fair';
    else overall = 'poor';

    return { overall, score, issues, recommendations };
  }

  /**
   * 计算性能改进百分比
   */
  private calculateImprovement(direct: NetworkMetrics, proxy: NetworkMetrics): number {
    const directScore = this.calculatePerformanceScore(direct);
    const proxyScore = this.calculatePerformanceScore(proxy);
    return ((proxyScore - directScore) / directScore) * 100;
  }

  /**
   * 计算性能分数
   */
  private calculatePerformanceScore(metrics: NetworkMetrics): number {
    // 综合评分算法
    const latencyScore = Math.max(0, 100 - metrics.latency / 2);
    const packetLossScore = Math.max(0, 100 - metrics.packetLoss * 10);
    const jitterScore = Math.max(0, 100 - metrics.jitter);
    
    return (latencyScore * 0.4 + packetLossScore * 0.4 + jitterScore * 0.2);
  }

  /**
   * 获取代理使用建议
   */
  private getProxyRecommendation(
    improvement: number,
    direct: NetworkMetrics,
    proxy: NetworkMetrics
  ): ProxyComparison['recommendation'] {
    if (improvement > 10) return 'use_proxy';
    if (improvement < -10) return 'use_direct';
    return 'optimize_proxy';
  }

  // 辅助方法
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private calculateJitter(latencies: number[]): number {
    if (latencies.length < 2) return 0;
    const avg = this.calculateAverage(latencies);
    const variance = latencies.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / latencies.length;
    return Math.sqrt(variance);
  }

  private calculatePacketLoss(successCount: number, totalCount: number): number {
    return ((totalCount - successCount) / totalCount) * 100;
  }

  private async estimateBandwidth(): Promise<number> {
    // 简化的带宽估算
    return 100; // Mbps
  }

  private async testUploadSpeed(): Promise<number> {
    // 简化的上传速度测试
    return 50; // KB/s
  }

  /**
   * 生成性能报告
   */
  generatePerformanceReport(analysis: {
    metrics: NetworkMetrics;
    quality: NetworkQuality;
    proxyComparison: ProxyComparison;
    routeAnalysis: RouteHop[];
  }): string {
    const { metrics, quality, proxyComparison } = analysis;
    
    return `
📊 网络性能分析报告
==================

🔍 基础指标:
- 平均延迟: ${metrics.latency.toFixed(2)}ms
- 网络抖动: ${metrics.jitter.toFixed(2)}ms
- 丢包率: ${metrics.packetLoss.toFixed(2)}%
- DNS解析: ${metrics.dnsResolutionTime.toFixed(2)}ms
- 下载速度: ${(metrics.downloadSpeed / 1024).toFixed(2)}KB/s

🎯 网络质量: ${quality.overall.toUpperCase()} (${quality.score}/100)

⚠️  发现的问题:
${quality.issues.map(issue => `- ${issue}`).join('\n')}

💡 优化建议:
${quality.recommendations.map(rec => `- ${rec}`).join('\n')}

🔄 代理性能对比:
- 直连延迟: ${proxyComparison.direct.latency.toFixed(2)}ms
- 代理延迟: ${proxyComparison.proxy.latency.toFixed(2)}ms
- 性能改进: ${proxyComparison.improvement.toFixed(2)}%
- 建议: ${proxyComparison.recommendation}

==================
`;
  }
}

export const networkPerformanceAnalyzer = new NetworkPerformanceAnalyzer();