# 文件路径: user_data/hyperopts/balanced_hyperopt_loss.py

from freqtrade.optimize.hyperopt import IHyperOptLoss
import numpy as np

class BalancedHyperOptLoss(IHyperOptLoss):
    """
    自定义平衡型优化损失函数
    目标：找到胜率、盈亏比、利润因子、频率的平衡解
    核心理念：不追求单一指标极端化，而是寻找多目标平衡
    """

    @staticmethod
    def hyperopt_loss_function(results: dict, trade_count: int, *args, **kwargs) -> float:
        """
        平衡型损失函数
        
        Args:
            results: 回测结果字典
            trade_count: 交易次数
            
        Returns:
            float: 损失值（越低越好）
        """
        
        # 防止除零错误
        if trade_count == 0:
            return 100.0
            
        # 提取关键指标
        winrate = results.get("winrate", 0) * 100  # 胜率 %
        
        # 计算盈亏比（安全处理）
        avg_profit = results.get("avg_profit_ratio", 0)
        avg_loss = results.get("avg_loss_ratio", 0)
        if avg_loss != 0:
            rr = abs(avg_profit / avg_loss)
        else:
            rr = 0 if avg_profit <= 0 else 10  # 如果没有亏损交易，给一个合理的盈亏比
            
        # 利润因子
        pf = results.get("profit_factor", 0)
        if pf is None or np.isnan(pf):
            pf = 0
            
        # 交易频率（每周）
        total_days = results.get("backtest_days", 1)
        trades_per_week = (trade_count / max(total_days, 1)) * 7
        
        # 最大回撤
        maxdd = abs(results.get("max_drawdown", 0)) * 100  # 转换为百分比
        
        # 总收益率
        total_return = results.get("profit_total_pct", 0)
        
        # === 平衡型评分系统 ===
        
        # 1. 基础指标评分 (0-1.5，允许超额完成)
        winrate_score = min(winrate / 55, 1.5)      # 目标胜率55%，上限1.5
        rr_score = min(rr / 1.2, 2.0)              # 目标盈亏比1.2，上限2.0
        pf_score = min(pf / 1.3, 2.0)              # 目标利润因子1.3，上限2.0
        return_score = max(0, min(total_return / 10, 1.5))  # 目标收益10%，上限1.5
        
        # 2. 回撤控制评分
        drawdown_score = max(0, 1 - maxdd / 20)    # 目标回撤≤20%
        
        # 3. 交易频率评分 - 钟形曲线设计
        if trades_per_week < 1:
            freq_score = trades_per_week  # 频率过低线性扣分
        elif trades_per_week > 20:
            freq_score = max(0.3, 1 - (trades_per_week - 20) / 30)  # 频率过高扣分
        else:
            # 1-20范围内，5-15为最佳区间
            if 5 <= trades_per_week <= 15:
                freq_score = 1.0
            elif trades_per_week < 5:
                freq_score = 0.8 + (trades_per_week - 1) * 0.05  # 0.8-1.0
            else:  # 15-20
                freq_score = 1.0 - (trades_per_week - 15) * 0.04  # 1.0-0.8
        
        # 4. 稳定性奖励 - 各指标均衡发展
        scores = [winrate_score, rr_score, pf_score, drawdown_score, freq_score]
        mean_score = np.mean(scores)
        std_score = np.std(scores)
        stability_bonus = max(0, 1 - std_score) * 0.1  # 最多10%奖励
        
        # 5. 交易样本充足性检查
        if trade_count < 10:
            sample_penalty = 0.5  # 样本不足严重扣分
        elif trade_count < 30:
            sample_penalty = 0.7 + (trade_count - 10) * 0.015  # 0.7-1.0
        else:
            sample_penalty = 1.0
        
        # 6. 加权综合评分
        weighted_score = (
            winrate_score * 0.20 +      # 胜率权重20%
            rr_score * 0.25 +           # 盈亏比权重25%
            pf_score * 0.25 +           # 利润因子权重25%
            return_score * 0.15 +       # 收益率权重15%
            drawdown_score * 0.15       # 回撤控制权重15%
        )
        
        # 7. 最终得分计算
        final_score = (weighted_score + stability_bonus) * freq_score * sample_penalty
        
        # 8. 特殊情况处理
        if pf <= 0 or total_return <= -10:  # 严重亏损直接淘汰
            final_score = 0.1
        elif winrate < 20:  # 胜率过低淘汰
            final_score = 0.2
        elif maxdd > 50:  # 回撤过大淘汰
            final_score = 0.2
            
        # Freqtrade需要"越低越好"的损失值，所以返回负分数
        loss = -final_score
        
        # 调试信息（可选）
        if hasattr(BalancedHyperOptLoss, '_debug') and BalancedHyperOptLoss._debug:
            print(f"Debug: WR={winrate:.1f}% RR={rr:.2f} PF={pf:.2f} "
                  f"Freq={trades_per_week:.1f}/w DD={maxdd:.1f}% "
                  f"Score={final_score:.3f} Loss={loss:.3f}")
        
        return loss


class BalancedHyperOptLossV2(IHyperOptLoss):
    """
    平衡型损失函数 V2 - 更严格的平衡要求
    适用于追求更高稳定性的场景
    """
    
    @staticmethod
    def hyperopt_loss_function(results: dict, trade_count: int, *args, **kwargs) -> float:
        if trade_count == 0:
            return 100.0
            
        # 提取指标
        winrate = results.get("winrate", 0) * 100
        avg_profit = results.get("avg_profit_ratio", 0)
        avg_loss = results.get("avg_loss_ratio", 0)
        rr = abs(avg_profit / avg_loss) if avg_loss != 0 else 0
        pf = results.get("profit_factor", 0) or 0
        total_days = results.get("backtest_days", 1)
        trades_per_week = (trade_count / max(total_days, 1)) * 7
        maxdd = abs(results.get("max_drawdown", 0)) * 100
        total_return = results.get("profit_total_pct", 0)
        
        # 更严格的目标设定
        target_winrate = 50      # 目标胜率50%
        target_rr = 1.5          # 目标盈亏比1.5
        target_pf = 1.3          # 目标利润因子1.3
        target_return = 15       # 目标年化收益15%
        target_dd = 15           # 目标最大回撤15%
        
        # 严格平衡评分 - 任何指标过度偏离都会被重罚
        winrate_dev = abs(winrate - target_winrate) / target_winrate
        rr_dev = abs(rr - target_rr) / target_rr if target_rr > 0 else 1
        pf_dev = abs(pf - target_pf) / target_pf if target_pf > 0 else 1
        dd_penalty = max(0, (maxdd - target_dd) / target_dd)
        
        # 平衡度评分 - 偏离度越小越好
        balance_score = 1 / (1 + winrate_dev + rr_dev + pf_dev + dd_penalty)
        
        # 基础性能评分
        performance_score = min(1, max(0, total_return / target_return))
        
        # 频率评分（更严格）
        if 3 <= trades_per_week <= 12:
            freq_score = 1.0
        else:
            freq_score = max(0.3, 1 - abs(trades_per_week - 7.5) / 15)
        
        # 综合评分
        final_score = balance_score * 0.6 + performance_score * 0.3 + freq_score * 0.1
        
        # 样本充足性
        if trade_count < 20:
            final_score *= 0.5
        
        return -final_score


class ConservativeHyperOptLoss(IHyperOptLoss):
    """
    保守型损失函数 - 优先考虑风险控制
    适用于追求稳定收益的场景
    """
    
    @staticmethod
    def hyperopt_loss_function(results: dict, trade_count: int, *args, **kwargs) -> float:
        if trade_count == 0:
            return 100.0
            
        # 提取指标
        winrate = results.get("winrate", 0) * 100
        avg_profit = results.get("avg_profit_ratio", 0)
        avg_loss = results.get("avg_loss_ratio", 0)
        rr = abs(avg_profit / avg_loss) if avg_loss != 0 else 0
        pf = results.get("profit_factor", 0) or 0
        maxdd = abs(results.get("max_drawdown", 0)) * 100
        total_return = results.get("profit_total_pct", 0)
        
        # 保守型评分 - 重点关注风险控制
        risk_score = max(0, 1 - maxdd / 10)  # 目标回撤≤10%
        stability_score = min(winrate / 60, 1)  # 目标胜率60%
        profit_score = min(pf / 1.2, 1.5)  # 目标利润因子1.2
        return_score = max(0, min(total_return / 8, 1))  # 目标收益8%
        
        # 保守型权重分配
        final_score = (
            risk_score * 0.40 +      # 风险控制40%
            stability_score * 0.30 + # 胜率稳定30%
            profit_score * 0.20 +    # 盈利能力20%
            return_score * 0.10      # 收益率10%
        )
        
        # 严格的风险控制
        if maxdd > 20 or winrate < 40 or pf < 1.0:
            final_score *= 0.3
            
        return -final_score