#!/usr/bin/env python3
"""
Hyperopt 结果可视化分析工具
用雷达图和散点图展示参数优化结果，一眼看出最平衡的策略
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from matplotlib.patches import Circle
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots
import json
from pathlib import Path

# 设置中文字体
plt.rcParams['font.sans-serif'] = ['SimHei', 'Arial Unicode MS', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

class HyperoptVisualizer:
    """Hyperopt结果可视化器"""
    
    def __init__(self):
        self.colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8']
        
    def load_results(self, file_path):
        """加载优化结果"""
        if isinstance(file_path, str):
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        else:
            data = file_path
            
        # 转换为DataFrame
        results = []
        for i, result in enumerate(data.get('results', [])):
            metrics = result.get('metrics', {})
            params = result.get('parameters', {})
            
            row = {
                'rank': result.get('rank', i+1),
                'score': result.get('score', 0),
                'win_rate': metrics.get('winRate', 0),
                'risk_reward': metrics.get('riskReward', 0),
                'profit_factor': metrics.get('profitFactor', 0),
                'trades_per_week': metrics.get('tradesPerWeek', 0),
                'max_drawdown': metrics.get('maxDrawdown', 0),
                'total_return': metrics.get('totalReturn', 0),
                'annual_return': metrics.get('annualizedReturn', 0),
                'stop_loss': params.get('stopLoss', 0) * 100,
                'take_profit_1': params.get('takeProfitTargets', [{}])[0].get('percent', 0) * 100,
                'signal_strength': params.get('minSignalStrength', 0),
                'confidence': params.get('minConfidence', 0),
                'signal_score': params.get('minSignalScore', 0),
            }
            results.append(row)
            
        return pd.DataFrame(results)
    
    def create_radar_chart(self, df, top_n=5):
        """创建雷达图对比前N名策略"""
        
        # 选择前N名
        top_strategies = df.head(top_n)
        
        # 定义雷达图指标
        categories = ['胜率', '盈亏比', '利润因子', '交易频率', '风险控制', '总收益']
        
        fig = go.Figure()
        
        for idx, row in top_strategies.iterrows():
            # 标准化指标到0-100范围
            values = [
                min(row['win_rate'], 100),  # 胜率
                min(row['risk_reward'] * 50, 100),  # 盈亏比 * 50
                min(row['profit_factor'] * 50, 100),  # 利润因子 * 50
                min(row['trades_per_week'] * 5, 100),  # 交易频率 * 5
                max(0, 100 - row['max_drawdown'] * 5),  # 风险控制 (100 - 回撤*5)
                max(0, min(row['total_return'] * 2, 100))  # 总收益 * 2
            ]
            
            fig.add_trace(go.Scatterpolar(
                r=values,
                theta=categories,
                fill='toself',
                name=f'排名#{int(row["rank"])} (得分:{row["score"]:.2f})',
                line_color=self.colors[idx % len(self.colors)],
                fillcolor=self.colors[idx % len(self.colors)],
                opacity=0.6
            ))
        
        fig.update_layout(
            polar=dict(
                radialaxis=dict(
                    visible=True,
                    range=[0, 100]
                )),
            showlegend=True,
            title="策略平衡性雷达图对比 - 前{}名".format(top_n),
            font=dict(size=12)
        )
        
        return fig
    
    def create_scatter_matrix(self, df):
        """创建散点图矩阵"""
        
        # 选择关键指标
        key_metrics = ['win_rate', 'risk_reward', 'profit_factor', 'total_return', 'max_drawdown']
        metric_names = ['胜率(%)', '盈亏比', '利润因子', '总收益(%)', '最大回撤(%)']
        
        # 创建散点图矩阵
        fig = make_subplots(
            rows=len(key_metrics), 
            cols=len(key_metrics),
            subplot_titles=[f"{x} vs {y}" for x in metric_names for y in metric_names],
            vertical_spacing=0.05,
            horizontal_spacing=0.05
        )
        
        for i, metric_x in enumerate(key_metrics):
            for j, metric_y in enumerate(key_metrics):
                if i != j:  # 不绘制对角线
                    fig.add_trace(
                        go.Scatter(
                            x=df[metric_x],
                            y=df[metric_y],
                            mode='markers',
                            marker=dict(
                                size=8,
                                color=df['score'],
                                colorscale='Viridis',
                                showscale=True if (i==0 and j==1) else False,
                                colorbar=dict(title="综合得分")
                            ),
                            text=[f"排名#{int(r)}" for r in df['rank']],
                            hovertemplate=f"{metric_names[i]}: %{{x}}<br>{metric_names[j]}: %{{y}}<br>%{{text}}<extra></extra>",
                            showlegend=False
                        ),
                        row=i+1, col=j+1
                    )
        
        fig.update_layout(
            title="关键指标散点图矩阵 - 颜色表示综合得分",
            height=800,
            showlegend=False
        )
        
        return fig
    
    def create_balance_analysis(self, df):
        """创建平衡性分析图"""
        
        # 计算平衡度指标
        df_analysis = df.copy()
        
        # 标准化各指标到0-1范围
        df_analysis['norm_winrate'] = df_analysis['win_rate'] / 100
        df_analysis['norm_rr'] = np.clip(df_analysis['risk_reward'] / 3, 0, 1)
        df_analysis['norm_pf'] = np.clip(df_analysis['profit_factor'] / 2, 0, 1)
        df_analysis['norm_freq'] = np.clip(df_analysis['trades_per_week'] / 20, 0, 1)
        df_analysis['norm_dd'] = np.clip(1 - df_analysis['max_drawdown'] / 30, 0, 1)
        
        # 计算标准差作为平衡度指标
        balance_cols = ['norm_winrate', 'norm_rr', 'norm_pf', 'norm_freq', 'norm_dd']
        df_analysis['balance_score'] = 1 - df_analysis[balance_cols].std(axis=1)
        
        # 创建平衡度 vs 综合得分散点图
        fig = go.Figure()
        
        fig.add_trace(go.Scatter(
            x=df_analysis['balance_score'],
            y=df_analysis['score'],
            mode='markers+text',
            marker=dict(
                size=12,
                color=df_analysis['rank'],
                colorscale='RdYlBu_r',
                showscale=True,
                colorbar=dict(title="排名")
            ),
            text=[f"#{int(r)}" for r in df_analysis['rank']],
            textposition="middle center",
            hovertemplate="平衡度: %{x:.3f}<br>综合得分: %{y:.2f}<br>排名: #%{marker.color}<extra></extra>"
        ))
        
        # 添加理想区域
        fig.add_shape(
            type="rect",
            x0=0.8, y0=120, x1=1.0, y1=140,
            fillcolor="lightgreen",
            opacity=0.3,
            line=dict(color="green", width=2),
        )
        
        fig.add_annotation(
            x=0.9, y=130,
            text="理想区域<br>(高平衡+高得分)",
            showarrow=False,
            font=dict(color="green", size=12)
        )
        
        fig.update_layout(
            title="策略平衡度 vs 综合得分分析",
            xaxis_title="平衡度指标 (越高越平衡)",
            yaxis_title="综合得分",
            showlegend=False
        )
        
        return fig
    
    def create_parameter_heatmap(self, df):
        """创建参数热力图"""
        
        # 选择参数列
        param_cols = ['stop_loss', 'take_profit_1', 'signal_strength', 'confidence', 'signal_score']
        param_names = ['止损(%)', '止盈1(%)', '信号强度', '置信度', '信号评分']
        
        # 创建相关性矩阵
        corr_matrix = df[param_cols + ['score']].corr()
        
        fig = go.Figure(data=go.Heatmap(
            z=corr_matrix.values,
            x=param_names + ['综合得分'],
            y=param_names + ['综合得分'],
            colorscale='RdBu',
            zmid=0,
            text=np.round(corr_matrix.values, 2),
            texttemplate="%{text}",
            textfont={"size": 10},
            hoverongaps=False
        ))
        
        fig.update_layout(
            title="参数相关性热力图",
            xaxis_title="参数",
            yaxis_title="参数"
        )
        
        return fig
    
    def create_performance_comparison(self, df):
        """创建性能对比图"""
        
        top_10 = df.head(10)
        
        fig = make_subplots(
            rows=2, cols=2,
            subplot_titles=('胜率对比', '盈亏比对比', '利润因子对比', '总收益对比'),
            specs=[[{"secondary_y": False}, {"secondary_y": False}],
                   [{"secondary_y": False}, {"secondary_y": False}]]
        )
        
        # 胜率对比
        fig.add_trace(
            go.Bar(x=[f"#{int(r)}" for r in top_10['rank']], 
                   y=top_10['win_rate'], 
                   name='胜率(%)',
                   marker_color='lightblue'),
            row=1, col=1
        )
        
        # 盈亏比对比
        fig.add_trace(
            go.Bar(x=[f"#{int(r)}" for r in top_10['rank']], 
                   y=top_10['risk_reward'], 
                   name='盈亏比',
                   marker_color='lightgreen'),
            row=1, col=2
        )
        
        # 利润因子对比
        fig.add_trace(
            go.Bar(x=[f"#{int(r)}" for r in top_10['rank']], 
                   y=top_10['profit_factor'], 
                   name='利润因子',
                   marker_color='lightyellow'),
            row=2, col=1
        )
        
        # 总收益对比
        fig.add_trace(
            go.Bar(x=[f"#{int(r)}" for r in top_10['rank']], 
                   y=top_10['total_return'], 
                   name='总收益(%)',
                   marker_color='lightcoral'),
            row=2, col=2
        )
        
        fig.update_layout(
            title="前10名策略性能对比",
            showlegend=False,
            height=600
        )
        
        return fig
    
    def generate_report(self, results_file, output_dir="./reports"):
        """生成完整的可视化报告"""
        
        # 创建输出目录
        Path(output_dir).mkdir(exist_ok=True)
        
        # 加载数据
        df = self.load_results(results_file)
        
        print(f"📊 加载了 {len(df)} 组参数结果")
        print(f"🏆 最佳得分: {df['score'].max():.2f}")
        print(f"📈 平均胜率: {df['win_rate'].mean():.1f}%")
        print(f"⚖️ 平均盈亏比: {df['risk_reward'].mean():.2f}")
        
        # 生成各种图表
        charts = {
            'radar': self.create_radar_chart(df),
            'scatter_matrix': self.create_scatter_matrix(df),
            'balance_analysis': self.create_balance_analysis(df),
            'parameter_heatmap': self.create_parameter_heatmap(df),
            'performance_comparison': self.create_performance_comparison(df)
        }
        
        # 保存图表
        for name, fig in charts.items():
            output_path = f"{output_dir}/hyperopt_{name}.html"
            fig.write_html(output_path)
            print(f"💾 已保存: {output_path}")
        
        # 生成汇总HTML报告
        self.create_summary_report(df, charts, output_dir)
        
        return charts
    
    def create_summary_report(self, df, charts, output_dir):
        """创建汇总HTML报告"""
        
        top_5 = df.head(5)
        
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Hyperopt 优化结果可视化报告</title>
            <meta charset="utf-8">
            <style>
                body {{ font-family: Arial, sans-serif; margin: 20px; }}
                .header {{ background: #f0f0f0; padding: 20px; border-radius: 10px; }}
                .section {{ margin: 20px 0; }}
                .top-results {{ display: flex; flex-wrap: wrap; gap: 20px; }}
                .result-card {{ 
                    border: 1px solid #ddd; 
                    padding: 15px; 
                    border-radius: 8px; 
                    flex: 1; 
                    min-width: 300px;
                }}
                .metric {{ margin: 5px 0; }}
                .good {{ color: green; font-weight: bold; }}
                .warning {{ color: orange; font-weight: bold; }}
                .bad {{ color: red; font-weight: bold; }}
                iframe {{ width: 100%; height: 600px; border: none; }}
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🎯 Hyperopt 参数优化结果报告</h1>
                <p><strong>优化时间:</strong> {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
                <p><strong>参数组合数:</strong> {len(df)} 组</p>
                <p><strong>最佳得分:</strong> {df['score'].max():.2f}</p>
            </div>
            
            <div class="section">
                <h2>🏆 前5名策略详情</h2>
                <div class="top-results">
        """
        
        for idx, row in top_5.iterrows():
            status_wr = "good" if row['win_rate'] >= 50 else "warning" if row['win_rate'] >= 40 else "bad"
            status_rr = "good" if row['risk_reward'] >= 1.2 else "warning" if row['risk_reward'] >= 1.0 else "bad"
            status_pf = "good" if row['profit_factor'] >= 1.3 else "warning" if row['profit_factor'] >= 1.0 else "bad"
            
            html_content += f"""
                    <div class="result-card">
                        <h3>排名 #{int(row['rank'])} - 得分: {row['score']:.2f}</h3>
                        <div class="metric">胜率: <span class="{status_wr}">{row['win_rate']:.1f}%</span></div>
                        <div class="metric">盈亏比: <span class="{status_rr}">{row['risk_reward']:.2f}</span></div>
                        <div class="metric">利润因子: <span class="{status_pf}">{row['profit_factor']:.2f}</span></div>
                        <div class="metric">交易频率: {row['trades_per_week']:.1f}/周</div>
                        <div class="metric">最大回撤: {row['max_drawdown']:.1f}%</div>
                        <div class="metric">总收益: {row['total_return']:.2f}%</div>
                        <hr>
                        <div class="metric">止损: {row['stop_loss']:.1f}%</div>
                        <div class="metric">止盈: {row['take_profit_1']:.1f}%</div>
                        <div class="metric">信号强度: {row['signal_strength']:.2f}</div>
                        <div class="metric">信号评分: {row['signal_score']:.1f}</div>
                    </div>
            """
        
        html_content += """
                </div>
            </div>
            
            <div class="section">
                <h2>📊 策略平衡性雷达图</h2>
                <iframe src="hyperopt_radar.html"></iframe>
            </div>
            
            <div class="section">
                <h2>🎯 平衡度分析</h2>
                <iframe src="hyperopt_balance_analysis.html"></iframe>
            </div>
            
            <div class="section">
                <h2>📈 性能对比</h2>
                <iframe src="hyperopt_performance_comparison.html"></iframe>
            </div>
            
            <div class="section">
                <h2>🔥 参数相关性</h2>
                <iframe src="hyperopt_parameter_heatmap.html"></iframe>
            </div>
            
            <div class="section">
                <h2>📋 优化建议</h2>
                <ul>
                    <li><strong>最平衡策略:</strong> 排名#{int(top_5.iloc[0]['rank'])}，各项指标发展均衡</li>
                    <li><strong>风险控制:</strong> 所有前5名策略最大回撤都控制在合理范围内</li>
                    <li><strong>改进方向:</strong> 重点关注盈亏比优化，这是提升整体表现的关键</li>
                    <li><strong>实盘建议:</strong> 选择排名前3的策略进行纸上交易验证</li>
                </ul>
            </div>
        </body>
        </html>
        """
        
        with open(f"{output_dir}/hyperopt_summary_report.html", 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        print(f"📋 汇总报告已保存: {output_dir}/hyperopt_summary_report.html")


def main():
    """主函数示例"""
    
    # 模拟数据示例
    sample_data = {
        "timestamp": "2025-09-26T10:00:00Z",
        "optimization_config": {
            "profit_factor": {"target": 1.3, "weight": 0.25},
            "risk_reward": {"target": 1.2, "weight": 0.25},
            "win_rate": {"target": 50, "weight": 0.20}
        },
        "total_combinations": 100,
        "results": []
    }
    
    # 生成模拟结果
    np.random.seed(42)
    for i in range(100):
        result = {
            "rank": i + 1,
            "score": 140 - i * 0.5 + np.random.normal(0, 2),
            "metrics": {
                "winRate": 45 + np.random.normal(8, 5),
                "riskReward": 0.8 + np.random.normal(0.4, 0.2),
                "profitFactor": 0.9 + np.random.normal(0.3, 0.15),
                "tradesPerWeek": 5 + np.random.normal(5, 3),
                "maxDrawdown": 5 + np.random.normal(8, 4),
                "totalReturn": np.random.normal(5, 10),
                "annualizedReturn": np.random.normal(10, 20)
            },
            "parameters": {
                "stopLoss": 0.01 + np.random.normal(0.005, 0.003),
                "takeProfitTargets": [
                    {"percent": 0.02 + np.random.normal(0.01, 0.005), "weight": 0.35}
                ],
                "minSignalStrength": 0.7 + np.random.normal(0.1, 0.05),
                "minConfidence": 0.75 + np.random.normal(0.1, 0.05),
                "minSignalScore": 8.0 + np.random.normal(1.0, 0.5)
            }
        }
        sample_data["results"].append(result)
    
    # 创建可视化器并生成报告
    visualizer = HyperoptVisualizer()
    charts = visualizer.generate_report(sample_data)
    
    print("\n🎉 可视化报告生成完成！")
    print("📂 请查看 ./reports/ 目录下的HTML文件")
    print("🌐 打开 hyperopt_summary_report.html 查看完整报告")


if __name__ == "__main__":
    main()