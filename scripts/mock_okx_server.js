// 模拟OKX API数据服务器
// 提供模拟的实时代币数据用于演示

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 8080;

// 启用CORS
app.use(cors());
app.use(express.json());

// 模拟数据生成函数
function generateMockPrice(basePrice, volatility = 0.02) {
    const change = (Math.random() - 0.5) * 2 * volatility;
    return basePrice * (1 + change);
}

function generateMockData() {
    const btcPrice = generateMockPrice(43250, 0.01);
    const ethPrice = generateMockPrice(2580, 0.015);
    
    return {
        code: "0",
        msg: "",
        data: [
            {
                instType: "SWAP",
                instId: "BTC-USDT-SWAP",
                last: btcPrice.toFixed(2),
                lastSz: "0.01",
                askPx: (btcPrice + 0.5).toFixed(2),
                askSz: "1.205",
                bidPx: (btcPrice - 0.5).toFixed(2),
                bidSz: "1.206",
                open24h: (btcPrice * 0.995).toFixed(2),
                high24h: (btcPrice * 1.008).toFixed(2),
                low24h: (btcPrice * 0.992).toFixed(2),
                volCcy24h: "2847536.5821",
                vol24h: "65.8",
                sodUtc0: (btcPrice * 0.998).toFixed(2),
                sodUtc8: (btcPrice * 0.997).toFixed(2),
                ts: Date.now().toString()
            },
            {
                instType: "SWAP",
                instId: "ETH-USDT-SWAP",
                last: ethPrice.toFixed(2),
                lastSz: "0.1",
                askPx: (ethPrice + 0.2).toFixed(2),
                askSz: "12.05",
                bidPx: (ethPrice - 0.2).toFixed(2),
                bidSz: "12.06",
                open24h: (ethPrice * 0.993).toFixed(2),
                high24h: (ethPrice * 1.012).toFixed(2),
                low24h: (ethPrice * 0.988).toFixed(2),
                volCcy24h: "1234567.8901",
                vol24h: "478.2",
                sodUtc0: (ethPrice * 0.996).toFixed(2),
                sodUtc8: (ethPrice * 0.995).toFixed(2),
                ts: Date.now().toString()
            }
        ]
    };
}

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 服务器时间
app.get('/api/v5/public/time', (req, res) => {
    res.json({
        code: "0",
        msg: "",
        data: [{
            ts: Date.now().toString()
        }]
    });
});

// 获取ticker数据
app.get('/api/v5/market/tickers', (req, res) => {
    const mockData = generateMockData();
    console.log(`[${new Date().toISOString()}] 生成模拟数据:`, mockData.data.map(d => `${d.instId}: ${d.last}`));
    res.json(mockData);
});

// 获取单个ticker
app.get('/api/v5/market/ticker', (req, res) => {
    const instId = req.query.instId;
    const mockData = generateMockData();
    const ticker = mockData.data.find(d => d.instId === instId);
    
    if (ticker) {
        res.json({
            code: "0",
            msg: "",
            data: [ticker]
        });
    } else {
        res.json({
            code: "51001",
            msg: "Instrument ID does not exist",
            data: []
        });
    }
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`🚀 模拟OKX API服务器启动成功!`);
    console.log(`📡 服务地址: http://localhost:${PORT}`);
    console.log(`🔗 健康检查: http://localhost:${PORT}/health`);
    console.log(`📊 Ticker数据: http://localhost:${PORT}/api/v5/market/tickers`);
    console.log(`⏰ 开始生成模拟实时数据...`);
});

// 错误处理
process.on('uncaughtException', (err) => {
    console.error('未捕获的异常:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise拒绝:', reason);
});