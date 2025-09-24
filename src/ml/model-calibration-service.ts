import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config.js';

/**
 * 校准方法枚举
 */
export enum CalibrationMethod {
    PLATT = 'platt',
    ISOTONIC = 'isotonic'
}

/**
 * 预测结果接口
 */
export interface PredictionResult {
    rawScore: number;           // 原始模型输出
    calibratedProbability: number; // 校准后概率
    confidence: number;         // 置信度
    timestamp: number;          // 预测时间戳
    features?: any;             // 输入特征
}

/**
 * 校准数据点
 */
export interface CalibrationDataPoint {
    prediction: number;         // 模型预测值
    actualOutcome: number;      // 实际结果 (0 或 1)
    timestamp: number;          // 时间戳
    weight?: number;            // 权重
}

/**
 * 校准模型接口
 */
export interface CalibrationModel {
    method: CalibrationMethod;
    parameters: any;
    trainedAt: number;
    dataPoints: number;
    performance: {
        brierScore: number;     // Brier分数
        logLoss: number;        // 对数损失
        calibrationError: number; // 校准误差
        reliability: number;    // 可靠性
    };
}

/**
 * 滚动窗口配置
 */
export interface RollingWindowConfig {
    windowSize: number;         // 窗口大小
    updateFrequency: number;    // 更新频率(毫秒)
    minDataPoints: number;      // 最小数据点数
    maxAge: number;             // 最大数据年龄(毫秒)
}

/**
 * Bandit算法配置
 */
export interface BanditConfig {
    epsilon: number;            // 探索率
    decayRate: number;          // 衰减率
    minExploration: number;     // 最小探索率
    updateInterval: number;     // 更新间隔
}

/**
 * 子策略定义
 */
export interface SubStrategy {
    id: string;
    name: string;
    description: string;
    weight: number;             // 当前权重
    performance: {
        totalPredictions: number;
        correctPredictions: number;
        accuracy: number;
        sharpeRatio: number;
        avgReturn: number;
        maxDrawdown: number;
    };
    calibrationModel?: CalibrationModel;
    isActive: boolean;
}

/**
 * 模型校准服务
 */
export class ModelCalibrationService {
    private calibrationData: Map<string, CalibrationDataPoint[]> = new Map();
    private calibrationModels: Map<string, CalibrationModel> = new Map();
    private subStrategies: Map<string, SubStrategy> = new Map();
    private rollingWindowConfig: RollingWindowConfig;
    private banditConfig: BanditConfig;
    private dataPath: string;
    private updateTimer?: NodeJS.Timeout;

    constructor(
        rollingWindowConfig?: Partial<RollingWindowConfig>,
        banditConfig?: Partial<BanditConfig>
    ) {
        this.rollingWindowConfig = {
            windowSize: 1000,
            updateFrequency: 24 * 60 * 60 * 1000, // 24小时
            minDataPoints: 50,
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30天
            ...rollingWindowConfig
        };

        this.banditConfig = {
            epsilon: 0.1,
            decayRate: 0.995,
            minExploration: 0.05,
            updateInterval: 60 * 60 * 1000, // 1小时
            ...banditConfig
        };

        this.dataPath = path.join(process.cwd(), 'data', 'calibration');
        this.ensureDataDirectory();
        this.initializeSubStrategies();
        this.loadPersistedData();
        this.startUpdateTimer();
    }

    /**
     * 初始化子策略
     */
    private initializeSubStrategies(): void {
        const strategies: SubStrategy[] = [
            {
                id: 'technical_momentum',
                name: '技术动量策略',
                description: '基于技术指标的动量策略',
                weight: 0.25,
                performance: {
                    totalPredictions: 0,
                    correctPredictions: 0,
                    accuracy: 0.5,
                    sharpeRatio: 0,
                    avgReturn: 0,
                    maxDrawdown: 0
                },
                isActive: true
            },
            {
                id: 'mean_reversion',
                name: '均值回归策略',
                description: '基于均值回归的策略',
                weight: 0.25,
                performance: {
                    totalPredictions: 0,
                    correctPredictions: 0,
                    accuracy: 0.5,
                    sharpeRatio: 0,
                    avgReturn: 0,
                    maxDrawdown: 0
                },
                isActive: true
            },
            {
                id: 'breakout_strategy',
                name: '突破策略',
                description: '基于价格突破的策略',
                weight: 0.25,
                performance: {
                    totalPredictions: 0,
                    correctPredictions: 0,
                    accuracy: 0.5,
                    sharpeRatio: 0,
                    avgReturn: 0,
                    maxDrawdown: 0
                },
                isActive: true
            },
            {
                id: 'ml_ensemble',
                name: 'ML集成策略',
                description: '机器学习集成策略',
                weight: 0.25,
                performance: {
                    totalPredictions: 0,
                    correctPredictions: 0,
                    accuracy: 0.5,
                    sharpeRatio: 0,
                    avgReturn: 0,
                    maxDrawdown: 0
                },
                isActive: true
            }
        ];

        strategies.forEach(strategy => {
            this.subStrategies.set(strategy.id, strategy);
        });
    }

    /**
     * 校准预测概率
     */
    async calibratePrediction(
        strategyId: string,
        rawPrediction: number,
        method: CalibrationMethod = CalibrationMethod.PLATT
    ): Promise<PredictionResult> {
        const calibrationModel = this.calibrationModels.get(strategyId);
        
        if (!calibrationModel || calibrationModel.dataPoints < this.rollingWindowConfig.minDataPoints) {
            // 如果没有足够的校准数据，返回原始预测
            return {
                rawScore: rawPrediction,
                calibratedProbability: rawPrediction,
                confidence: 0.5,
                timestamp: Date.now()
            };
        }

        let calibratedProbability: number;
        let confidence: number;

        switch (method) {
            case CalibrationMethod.PLATT:
                calibratedProbability = this.plattScaling(rawPrediction, calibrationModel);
                break;
            case CalibrationMethod.ISOTONIC:
                calibratedProbability = this.isotonicRegression(rawPrediction, calibrationModel);
                break;
            default:
                calibratedProbability = rawPrediction;
        }

        // 计算置信度基于校准模型的性能
        confidence = this.calculateConfidence(calibrationModel, rawPrediction);

        return {
            rawScore: rawPrediction,
            calibratedProbability: Math.max(0, Math.min(1, calibratedProbability)),
            confidence: Math.max(0, Math.min(1, confidence)),
            timestamp: Date.now()
        };
    }

    /**
     * Platt缩放校准
     */
    private plattScaling(rawPrediction: number, model: CalibrationModel): number {
        const { A, B } = model.parameters;
        const fVal = Math.log(rawPrediction / (1 - rawPrediction + 1e-15));
        return 1 / (1 + Math.exp(A * fVal + B));
    }

    /**
     * 等渗回归校准
     */
    private isotonicRegression(rawPrediction: number, model: CalibrationModel): number {
        const { bins, values } = model.parameters;
        
        // 找到对应的bin
        let binIndex = 0;
        for (let i = 0; i < bins.length - 1; i++) {
            if (rawPrediction >= bins[i] && rawPrediction < bins[i + 1]) {
                binIndex = i;
                break;
            }
        }
        
        if (binIndex >= values.length) {
            binIndex = values.length - 1;
        }
        
        return values[binIndex] || rawPrediction;
    }

    /**
     * 计算置信度
     */
    private calculateConfidence(model: CalibrationModel, rawPrediction: number): number {
        const baseConfidence = 1 - model.performance.calibrationError;
        const reliabilityBonus = model.performance.reliability * 0.2;
        const dataQualityBonus = Math.min(0.1, model.dataPoints / 1000);
        
        // 基于预测值的极端程度调整置信度
        const extremeness = Math.abs(rawPrediction - 0.5) * 2;
        const extremenessBonus = extremeness * 0.1;
        
        return Math.max(0.3, Math.min(0.95, 
            baseConfidence + reliabilityBonus + dataQualityBonus + extremenessBonus
        ));
    }

    /**
     * 添加校准数据点
     */
    addCalibrationData(
        strategyId: string,
        prediction: number,
        actualOutcome: number,
        timestamp: number = Date.now(),
        weight: number = 1.0
    ): void {
        if (!this.calibrationData.has(strategyId)) {
            this.calibrationData.set(strategyId, []);
        }

        const dataPoints = this.calibrationData.get(strategyId)!;
        dataPoints.push({
            prediction,
            actualOutcome,
            timestamp,
            weight
        });

        // 维护滚动窗口
        this.maintainRollingWindow(strategyId);
        
        // 更新子策略性能
        this.updateSubStrategyPerformance(strategyId, actualOutcome === 1);
    }

    /**
     * 维护滚动窗口
     */
    private maintainRollingWindow(strategyId: string): void {
        const dataPoints = this.calibrationData.get(strategyId);
        if (!dataPoints) return;

        const now = Date.now();
        const maxAge = this.rollingWindowConfig.maxAge;
        const windowSize = this.rollingWindowConfig.windowSize;

        // 移除过期数据
        const validData = dataPoints.filter(point => 
            now - point.timestamp <= maxAge
        );

        // 保持窗口大小
        if (validData.length > windowSize) {
            validData.splice(0, validData.length - windowSize);
        }

        this.calibrationData.set(strategyId, validData);
    }

    /**
     * 训练校准模型
     */
    async trainCalibrationModel(
        strategyId: string,
        method: CalibrationMethod = CalibrationMethod.PLATT
    ): Promise<CalibrationModel | null> {
        const dataPoints = this.calibrationData.get(strategyId);
        
        if (!dataPoints || dataPoints.length < this.rollingWindowConfig.minDataPoints) {
            console.warn(`[ModelCalibration] 数据不足，无法训练校准模型: ${strategyId}`);
            return null;
        }

        let parameters: any;
        
        switch (method) {
            case CalibrationMethod.PLATT:
                parameters = this.trainPlattScaling(dataPoints);
                break;
            case CalibrationMethod.ISOTONIC:
                parameters = this.trainIsotonicRegression(dataPoints);
                break;
            default:
                throw new Error(`不支持的校准方法: ${method}`);
        }

        const performance = this.evaluateCalibration(dataPoints, method, parameters);
        
        const model: CalibrationModel = {
            method,
            parameters,
            trainedAt: Date.now(),
            dataPoints: dataPoints.length,
            performance
        };

        this.calibrationModels.set(strategyId, model);
        
        // 更新子策略的校准模型
        const strategy = this.subStrategies.get(strategyId);
        if (strategy) {
            strategy.calibrationModel = model;
        }

        console.log(`[ModelCalibration] 训练完成: ${strategyId}, 方法: ${method}, 数据点: ${dataPoints.length}`);
        
        return model;
    }

    /**
     * 训练Platt缩放
     */
    private trainPlattScaling(dataPoints: CalibrationDataPoint[]): { A: number; B: number } {
        // 简化的Platt缩放实现
        // 在实际应用中，应该使用更复杂的优化算法
        
        const predictions = dataPoints.map(p => p.prediction);
        const outcomes = dataPoints.map(p => p.actualOutcome);
        
        // 使用最大似然估计
        let A = 0;
        let B = 0;
        
        // 简单的梯度下降
        const learningRate = 0.01;
        const iterations = 1000;
        
        for (let iter = 0; iter < iterations; iter++) {
            let gradA = 0;
            let gradB = 0;
            
            for (let i = 0; i < predictions.length; i++) {
                const fVal = Math.log(predictions[i] / (1 - predictions[i] + 1e-15));
                const prob = 1 / (1 + Math.exp(A * fVal + B));
                const error = prob - outcomes[i];
                
                gradA += error * fVal;
                gradB += error;
            }
            
            A -= learningRate * gradA / predictions.length;
            B -= learningRate * gradB / predictions.length;
        }
        
        return { A, B };
    }

    /**
     * 训练等渗回归
     */
    private trainIsotonicRegression(dataPoints: CalibrationDataPoint[]): { bins: number[]; values: number[] } {
        // 按预测值排序
        const sortedData = [...dataPoints].sort((a, b) => a.prediction - b.prediction);
        
        // 创建bins
        const numBins = Math.min(20, Math.floor(dataPoints.length / 5));
        const bins: number[] = [];
        const values: number[] = [];
        
        for (let i = 0; i <= numBins; i++) {
            bins.push(i / numBins);
        }
        
        // 计算每个bin的平均实际结果
        for (let i = 0; i < numBins; i++) {
            const binStart = bins[i];
            const binEnd = bins[i + 1];
            
            const binData = sortedData.filter(point => 
                point.prediction >= binStart && point.prediction < binEnd
            );
            
            if (binData.length > 0) {
                const avgOutcome = binData.reduce((sum, point) => 
                    sum + point.actualOutcome * (point.weight || 1), 0
                ) / binData.reduce((sum, point) => sum + (point.weight || 1), 0);
                
                values.push(avgOutcome);
            } else {
                values.push(binStart + (binEnd - binStart) / 2);
            }
        }
        
        // 确保单调性
        for (let i = 1; i < values.length; i++) {
            if (values[i] < values[i - 1]) {
                values[i] = values[i - 1];
            }
        }
        
        return { bins, values };
    }

    /**
     * 评估校准性能
     */
    private evaluateCalibration(
        dataPoints: CalibrationDataPoint[],
        method: CalibrationMethod,
        parameters: any
    ): CalibrationModel['performance'] {
        let brierScore = 0;
        let logLoss = 0;
        let calibrationError = 0;
        
        const numBins = 10;
        const binCounts = new Array(numBins).fill(0);
        const binCorrect = new Array(numBins).fill(0);
        const binPredictions = new Array(numBins).fill(0);
        
        for (const point of dataPoints) {
            let calibratedProb: number;
            
            if (method === CalibrationMethod.PLATT) {
                const { A, B } = parameters;
                const fVal = Math.log(point.prediction / (1 - point.prediction + 1e-15));
                calibratedProb = 1 / (1 + Math.exp(A * fVal + B));
            } else {
                const { bins, values } = parameters;
                let binIndex = 0;
                for (let i = 0; i < bins.length - 1; i++) {
                    if (point.prediction >= bins[i] && point.prediction < bins[i + 1]) {
                        binIndex = i;
                        break;
                    }
                }
                calibratedProb = values[binIndex] || point.prediction;
            }
            
            // Brier分数
            brierScore += Math.pow(calibratedProb - point.actualOutcome, 2);
            
            // 对数损失
            const clampedProb = Math.max(1e-15, Math.min(1 - 1e-15, calibratedProb));
            logLoss += point.actualOutcome * Math.log(clampedProb) + 
                      (1 - point.actualOutcome) * Math.log(1 - clampedProb);
            
            // 校准误差统计
            const binIndex = Math.min(numBins - 1, Math.floor(calibratedProb * numBins));
            binCounts[binIndex]++;
            binCorrect[binIndex] += point.actualOutcome;
            binPredictions[binIndex] += calibratedProb;
        }
        
        brierScore /= dataPoints.length;
        logLoss = -logLoss / dataPoints.length;
        
        // 计算校准误差 (ECE - Expected Calibration Error)
        let ece = 0;
        for (let i = 0; i < numBins; i++) {
            if (binCounts[i] > 0) {
                const avgPrediction = binPredictions[i] / binCounts[i];
                const avgOutcome = binCorrect[i] / binCounts[i];
                ece += (binCounts[i] / dataPoints.length) * Math.abs(avgPrediction - avgOutcome);
            }
        }
        
        // 计算可靠性
        const reliability = Math.max(0, 1 - ece);
        
        return {
            brierScore,
            logLoss,
            calibrationError: ece,
            reliability
        };
    }

    /**
     * Bandit算法更新子策略权重
     */
    updateSubStrategyWeights(): void {
        const strategies = Array.from(this.subStrategies.values()).filter(s => s.isActive);
        
        if (strategies.length === 0) return;
        
        // 计算每个策略的奖励（基于准确率和夏普比率）
        const rewards = strategies.map(strategy => {
            const accuracyReward = strategy.performance.accuracy - 0.5; // 超过随机的部分
            const sharpeReward = Math.max(0, strategy.performance.sharpeRatio) * 0.1;
            return accuracyReward + sharpeReward;
        });
        
        // 找到最佳策略
        const bestReward = Math.max(...rewards);
        const bestIndex = rewards.indexOf(bestReward);
        
        // 更新权重（epsilon-greedy）
        const epsilon = Math.max(this.banditConfig.minExploration, 
                                this.banditConfig.epsilon * Math.pow(this.banditConfig.decayRate, 
                                Date.now() / this.banditConfig.updateInterval));
        
        const totalWeight = 1.0;
        const explorationWeight = epsilon / strategies.length;
        const exploitationWeight = (1 - epsilon);
        
        strategies.forEach((strategy, index) => {
            if (index === bestIndex) {
                strategy.weight = exploitationWeight + explorationWeight;
            } else {
                strategy.weight = explorationWeight;
            }
        });
        
        // 归一化权重
        const sumWeights = strategies.reduce((sum, s) => sum + s.weight, 0);
        strategies.forEach(strategy => {
            strategy.weight /= sumWeights;
        });
        
        console.log(`[ModelCalibration] 更新子策略权重, epsilon: ${epsilon.toFixed(3)}`);
    }

    /**
     * 更新子策略性能
     */
    private updateSubStrategyPerformance(strategyId: string, isCorrect: boolean): void {
        const strategy = this.subStrategies.get(strategyId);
        if (!strategy) return;
        
        strategy.performance.totalPredictions++;
        if (isCorrect) {
            strategy.performance.correctPredictions++;
        }
        
        strategy.performance.accuracy = strategy.performance.correctPredictions / 
                                       strategy.performance.totalPredictions;
    }

    /**
     * 获取子策略权重
     */
    getSubStrategyWeights(): Map<string, number> {
        const weights = new Map<string, number>();
        this.subStrategies.forEach((strategy, id) => {
            weights.set(id, strategy.weight);
        });
        return weights;
    }

    /**
     * 获取校准模型性能
     */
    getCalibrationPerformance(): Map<string, CalibrationModel['performance']> {
        const performance = new Map<string, CalibrationModel['performance']>();
        this.calibrationModels.forEach((model, strategyId) => {
            performance.set(strategyId, model.performance);
        });
        return performance;
    }

    /**
     * 启动定时更新
     */
    private startUpdateTimer(): void {
        this.updateTimer = setInterval(() => {
            this.performDailyUpdate();
        }, this.rollingWindowConfig.updateFrequency);
    }

    /**
     * 执行每日更新
     */
    private async performDailyUpdate(): Promise<void> {
        console.log('[ModelCalibration] 开始每日更新...');
        
        // 为每个策略重新训练校准模型
        for (const strategyId of this.subStrategies.keys()) {
            await this.trainCalibrationModel(strategyId, CalibrationMethod.PLATT);
            await this.trainCalibrationModel(strategyId, CalibrationMethod.ISOTONIC);
        }
        
        // 更新子策略权重
        this.updateSubStrategyWeights();
        
        // 持久化数据
        this.persistData();
        
        console.log('[ModelCalibration] 每日更新完成');
    }

    /**
     * 确保数据目录存在
     */
    private ensureDataDirectory(): void {
        if (!fs.existsSync(this.dataPath)) {
            fs.mkdirSync(this.dataPath, { recursive: true });
        }
    }

    /**
     * 持久化数据
     */
    private persistData(): void {
        try {
            // 保存校准数据
            const calibrationDataPath = path.join(this.dataPath, 'calibration_data.json');
            const calibrationDataObj = Object.fromEntries(this.calibrationData);
            fs.writeFileSync(calibrationDataPath, JSON.stringify(calibrationDataObj, null, 2));
            
            // 保存校准模型
            const modelsPath = path.join(this.dataPath, 'calibration_models.json');
            const modelsObj = Object.fromEntries(this.calibrationModels);
            fs.writeFileSync(modelsPath, JSON.stringify(modelsObj, null, 2));
            
            // 保存子策略
            const strategiesPath = path.join(this.dataPath, 'sub_strategies.json');
            const strategiesObj = Object.fromEntries(this.subStrategies);
            fs.writeFileSync(strategiesPath, JSON.stringify(strategiesObj, null, 2));
            
        } catch (error) {
            console.error('[ModelCalibration] 数据持久化失败:', error);
        }
    }

    /**
     * 加载持久化数据
     */
    private loadPersistedData(): void {
        try {
            // 加载校准数据
            const calibrationDataPath = path.join(this.dataPath, 'calibration_data.json');
            if (fs.existsSync(calibrationDataPath)) {
                const data = JSON.parse(fs.readFileSync(calibrationDataPath, 'utf8'));
                this.calibrationData = new Map(Object.entries(data));
            }
            
            // 加载校准模型
            const modelsPath = path.join(this.dataPath, 'calibration_models.json');
            if (fs.existsSync(modelsPath)) {
                const models = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
                this.calibrationModels = new Map(Object.entries(models));
            }
            
            // 加载子策略
            const strategiesPath = path.join(this.dataPath, 'sub_strategies.json');
            if (fs.existsSync(strategiesPath)) {
                const strategies = JSON.parse(fs.readFileSync(strategiesPath, 'utf8'));
                this.subStrategies = new Map(Object.entries(strategies));
            }
            
        } catch (error) {
            console.warn('[ModelCalibration] 加载持久化数据失败:', error);
        }
    }

    /**
     * 停止服务
     */
    stop(): void {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
        this.persistData();
    }

    /**
     * 获取服务状态
     */
    getStatus(): {
        totalStrategies: number;
        activeStrategies: number;
        totalCalibrationData: number;
        trainedModels: number;
        lastUpdate: number;
    } {
        const totalCalibrationData = Array.from(this.calibrationData.values())
            .reduce((sum, data) => sum + data.length, 0);
        
        return {
            totalStrategies: this.subStrategies.size,
            activeStrategies: Array.from(this.subStrategies.values()).filter(s => s.isActive).length,
            totalCalibrationData,
            trainedModels: this.calibrationModels.size,
            lastUpdate: Math.max(...Array.from(this.calibrationModels.values()).map(m => m.trainedAt), 0)
        };
    }
}

export default ModelCalibrationService;