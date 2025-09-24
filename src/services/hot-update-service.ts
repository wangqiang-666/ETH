import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { ModelCalibrationService, SubStrategy } from '../ml/model-calibration-service.js';
import { AdaptiveParameterManager, AdaptiveParameters } from '../config/adaptive-parameters.js';
import { MarketStateAnalyzer, MarketStateResult } from '../analyzers/market-state-analyzer.js';
import { config } from '../config.js';

/**
 * 热更新事件类型
 */
export enum HotUpdateEvent {
    CONFIG_UPDATED = 'config_updated',
    MODEL_UPDATED = 'model_updated',
    STRATEGY_UPDATED = 'strategy_updated',
    PARAMETERS_UPDATED = 'parameters_updated',
    ERROR = 'error'
}

/**
 * 配置更新类型
 */
export interface ConfigUpdate {
    type: 'STRATEGY' | 'RISK' | 'INDICATORS' | 'TRADING' | 'ADAPTIVE_PARAMS';
    path: string;
    value: any;
    timestamp: number;
    source: 'API' | 'FILE' | 'SCHEDULER' | 'AUTO';
    version?: string;
}

/**
 * 模型更新信息
 */
export interface ModelUpdate {
    modelId: string;
    modelType: 'CALIBRATION' | 'PREDICTION' | 'ENSEMBLE';
    updateType: 'RETRAIN' | 'PARAMETER_ADJUST' | 'WEIGHT_UPDATE';
    performance?: any;
    timestamp: number;
}

/**
 * 策略流量分配
 */
export interface StrategyAllocation {
    strategyId: string;
    allocation: number;        // 分配比例 0-1
    confidence: number;        // 置信度
    performance: {
        recentAccuracy: number;
        sharpeRatio: number;
        maxDrawdown: number;
        totalTrades: number;
    };
    lastUpdate: number;
}

/**
 * 热更新配置
 */
export interface HotUpdateConfig {
    enableFileWatcher: boolean;
    watchPaths: string[];
    updateInterval: number;
    maxRetries: number;
    rollbackOnError: boolean;
    validationEnabled: boolean;
}

/**
 * Node端热更新服务
 */
export class HotUpdateService extends EventEmitter {
    private modelCalibrationService: ModelCalibrationService;
    private adaptiveParameterManager: AdaptiveParameterManager;
    private marketStateAnalyzer: MarketStateAnalyzer;
    private config: HotUpdateConfig;
    private configHistory: ConfigUpdate[] = [];
    private strategyAllocations: Map<string, StrategyAllocation> = new Map();
    private fileWatchers: Map<string, fs.FSWatcher> = new Map();
    private updateTimer?: NodeJS.Timeout;
    private isUpdating = false;
    private maxHistoryLength = 100;

    constructor(
        modelCalibrationService: ModelCalibrationService,
        adaptiveParameterManager: AdaptiveParameterManager,
        marketStateAnalyzer: MarketStateAnalyzer,
        hotUpdateConfig?: Partial<HotUpdateConfig>
    ) {
        super();
        
        this.modelCalibrationService = modelCalibrationService;
        this.adaptiveParameterManager = adaptiveParameterManager;
        this.marketStateAnalyzer = marketStateAnalyzer;
        
        this.config = {
            enableFileWatcher: true,
            watchPaths: [
                path.join(process.cwd(), 'src/config'),
                path.join(process.cwd(), 'configs'),
                path.join(process.cwd(), '.env')
            ],
            updateInterval: 5 * 60 * 1000, // 5分钟
            maxRetries: 3,
            rollbackOnError: true,
            validationEnabled: true,
            ...hotUpdateConfig
        };

        this.initializeService();
    }

    /**
     * 初始化服务
     */
    private initializeService(): void {
        this.initializeStrategyAllocations();
        this.setupFileWatchers();
        this.startUpdateTimer();
        
        console.log('[HotUpdate] 热更新服务已启动');
    }

    /**
     * 初始化策略分配
     */
    private initializeStrategyAllocations(): void {
        const weights = this.modelCalibrationService.getSubStrategyWeights();
        
        weights.forEach((weight, strategyId) => {
            this.strategyAllocations.set(strategyId, {
                strategyId,
                allocation: weight,
                confidence: 0.5,
                performance: {
                    recentAccuracy: 0.5,
                    sharpeRatio: 0,
                    maxDrawdown: 0,
                    totalTrades: 0
                },
                lastUpdate: Date.now()
            });
        });
    }

    /**
     * 设置文件监听器
     */
    private setupFileWatchers(): void {
        if (!this.config.enableFileWatcher) return;

        this.config.watchPaths.forEach(watchPath => {
            if (fs.existsSync(watchPath)) {
                const watcher = fs.watch(watchPath, { recursive: true }, (eventType, filename) => {
                    if (filename && (filename.endsWith('.json') || filename.endsWith('.ts') || filename.endsWith('.env'))) {
                        this.handleFileChange(path.join(watchPath, filename), eventType);
                    }
                });
                
                this.fileWatchers.set(watchPath, watcher);
                console.log(`[HotUpdate] 监听文件变化: ${watchPath}`);
            }
        });
    }

    /**
     * 处理文件变化
     */
    private async handleFileChange(filePath: string, eventType: string): Promise<void> {
        if (this.isUpdating) return;

        try {
            console.log(`[HotUpdate] 检测到文件变化: ${filePath} (${eventType})`);
            
            if (filePath.includes('config') && filePath.endsWith('.json')) {
                await this.handleConfigFileChange(filePath);
            } else if (filePath.endsWith('.env')) {
                await this.handleEnvFileChange(filePath);
            }
        } catch (error) {
            console.error('[HotUpdate] 处理文件变化失败:', error);
            this.emit(HotUpdateEvent.ERROR, { error, filePath, eventType });
        }
    }

    /**
     * 处理配置文件变化
     */
    private async handleConfigFileChange(filePath: string): Promise<void> {
        try {
            const configData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const configUpdate: ConfigUpdate = {
                type: this.determineConfigType(filePath),
                path: filePath,
                value: configData,
                timestamp: Date.now(),
                source: 'FILE'
            };

            await this.applyConfigUpdate(configUpdate);
        } catch (error) {
            console.error(`[HotUpdate] 配置文件解析失败: ${filePath}`, error);
        }
    }

    /**
     * 处理环境变量文件变化
     */
    private async handleEnvFileChange(filePath: string): Promise<void> {
        try {
            // 重新加载环境变量
            require('dotenv').config({ path: filePath, override: true });
            
            const configUpdate: ConfigUpdate = {
                type: 'TRADING',
                path: filePath,
                value: process.env,
                timestamp: Date.now(),
                source: 'FILE'
            };

            await this.applyConfigUpdate(configUpdate);
        } catch (error) {
            console.error(`[HotUpdate] 环境变量文件处理失败: ${filePath}`, error);
        }
    }

    /**
     * 确定配置类型
     */
    private determineConfigType(filePath: string): ConfigUpdate['type'] {
        const filename = path.basename(filePath).toLowerCase();
        
        if (filename.includes('strategy')) return 'STRATEGY';
        if (filename.includes('risk')) return 'RISK';
        if (filename.includes('indicator')) return 'INDICATORS';
        if (filename.includes('adaptive') || filename.includes('parameter')) return 'ADAPTIVE_PARAMS';
        
        return 'TRADING';
    }

    /**
     * 应用配置更新
     */
    async applyConfigUpdate(configUpdate: ConfigUpdate): Promise<void> {
        if (this.isUpdating) {
            console.warn('[HotUpdate] 更新正在进行中，跳过此次更新');
            return;
        }

        this.isUpdating = true;
        
        try {
            // 验证配置
            if (this.config.validationEnabled && !this.validateConfigUpdate(configUpdate)) {
                throw new Error('配置验证失败');
            }

            // 备份当前配置
            const backup = this.createConfigBackup();

            try {
                // 应用更新
                await this.performConfigUpdate(configUpdate);
                
                // 记录更新历史
                this.recordConfigUpdate(configUpdate);
                
                // 触发相关服务更新
                await this.triggerServiceUpdates(configUpdate);
                
                this.emit(HotUpdateEvent.CONFIG_UPDATED, configUpdate);
                console.log(`[HotUpdate] 配置更新成功: ${configUpdate.type}`);
                
            } catch (error) {
                // 回滚配置
                if (this.config.rollbackOnError) {
                    await this.rollbackConfig(backup);
                    console.log('[HotUpdate] 配置已回滚');
                }
                throw error;
            }
            
        } catch (error) {
            console.error('[HotUpdate] 配置更新失败:', error);
            this.emit(HotUpdateEvent.ERROR, { error, configUpdate });
        } finally {
            this.isUpdating = false;
        }
    }

    /**
     * 验证配置更新
     */
    private validateConfigUpdate(configUpdate: ConfigUpdate): boolean {
        try {
            switch (configUpdate.type) {
                case 'STRATEGY':
                    return this.validateStrategyConfig(configUpdate.value);
                case 'RISK':
                    return this.validateRiskConfig(configUpdate.value);
                case 'INDICATORS':
                    return this.validateIndicatorConfig(configUpdate.value);
                case 'ADAPTIVE_PARAMS':
                    return this.validateAdaptiveParamsConfig(configUpdate.value);
                default:
                    return true;
            }
        } catch (error) {
            console.error('[HotUpdate] 配置验证异常:', error);
            return false;
        }
    }

    /**
     * 验证策略配置
     */
    private validateStrategyConfig(config: any): boolean {
        const requiredFields = ['signalThreshold', 'evThreshold'];
        return requiredFields.every(field => 
            config.hasOwnProperty(field) && typeof config[field] === 'number'
        );
    }

    /**
     * 验证风险配置
     */
    private validateRiskConfig(config: any): boolean {
        const requiredFields = ['maxDailyLoss', 'stopLossPercent', 'takeProfitPercent'];
        return requiredFields.every(field => 
            config.hasOwnProperty(field) && 
            typeof config[field] === 'number' && 
            config[field] > 0 && 
            config[field] < 1
        );
    }

    /**
     * 验证指标配置
     */
    private validateIndicatorConfig(config: any): boolean {
        return config.hasOwnProperty('rsi') && 
               config.rsi.hasOwnProperty('period') && 
               typeof config.rsi.period === 'number';
    }

    /**
     * 验证自适应参数配置
     */
    private validateAdaptiveParamsConfig(config: any): boolean {
        return config.hasOwnProperty('drivingThresholds') || 
               config.hasOwnProperty('leverageFactors') ||
               config.hasOwnProperty('cooldownPeriods');
    }

    /**
     * 执行配置更新
     */
    private async performConfigUpdate(configUpdate: ConfigUpdate): Promise<void> {
        switch (configUpdate.type) {
            case 'ADAPTIVE_PARAMS':
                this.adaptiveParameterManager.setParameters(configUpdate.value);
                break;
            case 'STRATEGY':
                // 更新策略配置
                Object.assign((config as any).strategy, configUpdate.value);
                break;
            case 'RISK':
                // 更新风险配置
                Object.assign((config as any).risk, configUpdate.value);
                break;
            case 'INDICATORS':
                // 更新指标配置
                Object.assign((config as any).indicators, configUpdate.value);
                break;
            case 'TRADING':
                // 更新交易配置
                Object.assign((config as any).trading, configUpdate.value);
                break;
        }
    }

    /**
     * 触发服务更新
     */
    private async triggerServiceUpdates(configUpdate: ConfigUpdate): Promise<void> {
        switch (configUpdate.type) {
            case 'ADAPTIVE_PARAMS':
                // 触发参数管理器更新
                this.emit(HotUpdateEvent.PARAMETERS_UPDATED, configUpdate);
                break;
            case 'STRATEGY':
                // 触发策略更新
                await this.updateStrategyAllocations();
                this.emit(HotUpdateEvent.STRATEGY_UPDATED, configUpdate);
                break;
        }
    }

    /**
     * 更新策略分配
     */
    async updateStrategyAllocations(): Promise<void> {
        try {
            // 获取最新的策略权重
            const weights = this.modelCalibrationService.getSubStrategyWeights();
            const performance = this.modelCalibrationService.getCalibrationPerformance();
            
            weights.forEach((weight, strategyId) => {
                const currentAllocation = this.strategyAllocations.get(strategyId);
                const strategyPerformance = performance.get(strategyId);
                
                const updatedAllocation: StrategyAllocation = {
                    strategyId,
                    allocation: weight,
                    confidence: strategyPerformance ? (1 - strategyPerformance.calibrationError) : 0.5,
                    performance: {
                        recentAccuracy: currentAllocation?.performance.recentAccuracy || 0.5,
                        sharpeRatio: currentAllocation?.performance.sharpeRatio || 0,
                        maxDrawdown: currentAllocation?.performance.maxDrawdown || 0,
                        totalTrades: currentAllocation?.performance.totalTrades || 0
                    },
                    lastUpdate: Date.now()
                };
                
                this.strategyAllocations.set(strategyId, updatedAllocation);
            });
            
            console.log('[HotUpdate] 策略分配已更新');
            
        } catch (error) {
            console.error('[HotUpdate] 策略分配更新失败:', error);
        }
    }

    /**
     * 创建配置备份
     */
    private createConfigBackup(): any {
        return {
            strategy: { ...config.strategy },
            risk: { ...config.risk },
            indicators: { ...config.indicators },
            trading: { ...config.trading },
            adaptiveParams: this.adaptiveParameterManager.getCurrentParameters(),
            timestamp: Date.now()
        };
    }

    /**
     * 回滚配置
     */
    private async rollbackConfig(backup: any): Promise<void> {
        try {
            Object.assign((config as any).strategy, backup.strategy);
            Object.assign((config as any).risk, backup.risk);
            Object.assign((config as any).indicators, backup.indicators);
            Object.assign((config as any).trading, backup.trading);
            
            this.adaptiveParameterManager.setParameters(backup.adaptiveParams);
            
            console.log('[HotUpdate] 配置回滚完成');
        } catch (error) {
            console.error('[HotUpdate] 配置回滚失败:', error);
        }
    }

    /**
     * 记录配置更新
     */
    private recordConfigUpdate(configUpdate: ConfigUpdate): void {
        this.configHistory.push(configUpdate);
        
        if (this.configHistory.length > this.maxHistoryLength) {
            this.configHistory.shift();
        }
    }

    /**
     * 启动定时更新
     */
    private startUpdateTimer(): void {
        this.updateTimer = setInterval(() => {
            this.performScheduledUpdates();
        }, this.config.updateInterval);
    }

    /**
     * 执行定时更新
     */
    private async performScheduledUpdates(): Promise<void> {
        try {
            // 更新策略分配
            await this.updateStrategyAllocations();
            
            // 触发模型校准服务更新权重
            this.modelCalibrationService.updateSubStrategyWeights();
            
            console.log('[HotUpdate] 定时更新完成');
            
        } catch (error) {
            console.error('[HotUpdate] 定时更新失败:', error);
        }
    }

    /**
     * API接口：手动更新配置
     */
    async updateConfig(
        type: ConfigUpdate['type'],
        updates: any,
        source: ConfigUpdate['source'] = 'API'
    ): Promise<void> {
        const configUpdate: ConfigUpdate = {
            type,
            path: 'api',
            value: updates,
            timestamp: Date.now(),
            source
        };

        await this.applyConfigUpdate(configUpdate);
    }

    /**
     * API接口：获取策略分配
     */
    getStrategyAllocations(): StrategyAllocation[] {
        return Array.from(this.strategyAllocations.values());
    }

    /**
     * API接口：获取配置历史
     */
    getConfigHistory(limit: number = 20): ConfigUpdate[] {
        return this.configHistory.slice(-limit);
    }

    /**
     * API接口：获取服务状态
     */
    getServiceStatus(): {
        isUpdating: boolean;
        totalUpdates: number;
        lastUpdate: number;
        activeWatchers: number;
        strategyCount: number;
    } {
        return {
            isUpdating: this.isUpdating,
            totalUpdates: this.configHistory.length,
            lastUpdate: this.configHistory.length > 0 ? 
                       this.configHistory[this.configHistory.length - 1].timestamp : 0,
            activeWatchers: this.fileWatchers.size,
            strategyCount: this.strategyAllocations.size
        };
    }

    /**
     * API接口：强制重新分配策略
     */
    async forceReallocation(): Promise<void> {
        console.log('[HotUpdate] 强制重新分配策略...');
        await this.updateStrategyAllocations();
        this.modelCalibrationService.updateSubStrategyWeights();
    }

    /**
     * API接口：设置策略权重
     */
    setStrategyWeight(strategyId: string, weight: number): void {
        const allocation = this.strategyAllocations.get(strategyId);
        if (allocation) {
            allocation.allocation = Math.max(0, Math.min(1, weight));
            allocation.lastUpdate = Date.now();
            
            // 归一化所有权重
            this.normalizeStrategyWeights();
        }
    }

    /**
     * 归一化策略权重
     */
    private normalizeStrategyWeights(): void {
        const totalWeight = Array.from(this.strategyAllocations.values())
            .reduce((sum, allocation) => sum + allocation.allocation, 0);
        
        if (totalWeight > 0) {
            this.strategyAllocations.forEach(allocation => {
                allocation.allocation /= totalWeight;
            });
        }
    }

    /**
     * 停止服务
     */
    stop(): void {
        // 停止文件监听器
        this.fileWatchers.forEach(watcher => watcher.close());
        this.fileWatchers.clear();
        
        // 停止定时器
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
        
        console.log('[HotUpdate] 热更新服务已停止');
    }
}

export default HotUpdateService;