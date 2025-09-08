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

    // --- New: extract quality metrics
    const summary = run?.result?.summary || {};
    const observationDays = Number(summary.observationDays || 0);
    const returnObservations = typeof summary.returnObservations === 'number' ? summary.returnObservations : null;
    const sampleQuality = summary.sampleQuality || '';

    // --- New: quality assertion (ADEQUATE or better, and >=30 days/observations when available)
    const qualityRank = { INSUFFICIENT: 0, LIMITED: 1, ADEQUATE: 2, GOOD: 3, EXCELLENT: 4 };
    const rank = qualityRank[sampleQuality] ?? -1;
    const hasEnoughDays = observationDays >= 30;
    const hasEnoughObs = returnObservations == null ? true : returnObservations >= 30;
    if (!(rank >= qualityRank.ADEQUATE && hasEnoughDays && hasEnoughObs)) {
      throw new Error(`Sample quality check failed: sampleQuality=${sampleQuality}, observationDays=${observationDays}, returnObservations=${returnObservations}`);
    }

    const out = {
      marker: 'BACKTEST_SMOKE_RESULT_AFTER_PATCH',
      run: {
        trades: summary.totalTrades,
        winRatePct: +((summary.winRate || 0) * 100).toFixed(2),
        totalReturnPct: +((summary.totalReturnPercent || 0) * 100).toFixed(2),
        sharpe: +Number(summary.sharpeRatio || 0).toFixed(6),
        annualized: +Number(summary.annualizedReturn || 0).toFixed(6),
        // --- New: export quality fields
        observationDays,
        returnObservations: returnObservations == null ? undefined : returnObservations,
        sampleQuality
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