const fs = require('fs');
const http = require('http');

function readJSON(path) {
  const txt = fs.readFileSync(path, 'utf8');
  return JSON.parse(txt.replace(/^\uFEFF/, ''));
}

function post(base, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(new Error('JSON parse failed: ' + e.message + '; raw=' + d.slice(0, 500)));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  try {
    let beforeOverview = null;
    try {
      const before = readJSON('backtest_smoke_result.json');
      beforeOverview = before.report?.overview || null;
    } catch (_) {}
    if (beforeOverview) {
      console.log('[before.overview]', beforeOverview);
    } else {
      console.log('[before.overview] n/a');
    }

    const base = 'http://localhost:' + (process.env.WEB_PORT || 3001);
    const payload = readJSON('last_minimal_payload.json');

    const run = await post(base, '/api/backtest/run', payload);
    const report = await post(base, '/api/backtest/performance-report', { backtestResult: run.result });

    const out = {
      marker: 'BACKTEST_SMOKE_RESULT_AFTER_PATCH',
      run: {
        trades: run.result.summary.totalTrades,
        winRatePct: +(run.result.summary.winRate * 100).toFixed(2),
        totalReturnPct: +(run.result.summary.totalReturnPercent * 100).toFixed(2),
        sharpe: +run.result.summary.sharpeRatio.toFixed(6),
        annualized: +run.result.summary.annualizedReturn.toFixed(6)
      },
      report: { overview: report.report.overview }
    };

    fs.writeFileSync('backtest_smoke_after_patch.json', JSON.stringify(out));
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('E2E patch check failed:', e.message);
    process.exit(1);
  }
})();