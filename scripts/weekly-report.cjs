#!/usr/bin/env node
/*
  Weekly report generator using /api/stats

  Usage examples:
    node scripts/weekly-report.cjs --window=7d --bins=5 --bin-mode=quantile --ab=A,B
    node scripts/weekly-report.cjs --start=2025-09-01 --end=2025-09-18 --bin-mode=even --strategy_type=ETH
    node scripts/weekly-report.cjs --window=30d --out=weekly-report.md
    node scripts/weekly-report.cjs --base-url=http://localhost:3001 --window=7d --bins=6

  Options:
    --base-url=<url>           Base URL of the running web server. Default resolved from WEB_PORT/config or http://localhost:3001
    --window=<Nd|Nw|Nh>        Rolling window (e.g., 7d, 4w, 24h). Use either window or start/end
    --start=<YYYY-MM-DD>       Start date (inclusive). If provided, overrides window
    --end=<YYYY-MM-DD>         End date (inclusive). If omitted with start, end=now
    --ab=<A,B,...>             AB groups filter, comma-separated
    --bins=<n>                 Number of bins for EV bucketing (2..12). Default 5
    --bin-mode=<quantile|even> Binning mode. Default quantile
    --strategy_type=<name>     Strategy type filter
    --out=<path>               Write a report file. .json writes raw payload, otherwise writes markdown/text summary
*/

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

function loadBaseUrlFromConfig() {
  const envPort = process.env.WEB_PORT && Number(process.env.WEB_PORT);
  if (Number.isFinite(envPort) && envPort > 0) return `http://localhost:${envPort}`;
  const candidates = [
    path.resolve(__dirname, '../config.current.json'),
    path.resolve(__dirname, '../config-current.json')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
        const port = (cfg && cfg.webServer && cfg.webServer.port) || (cfg?.config?.webServer?.port);
        if (Number.isFinite(port) && port > 0) return `http://localhost:${port}`;
      }
    } catch (e) {}
  }
  return 'http://localhost:3001';
}

function parseArgs() {
  const args = Object.fromEntries(process.argv.slice(2).map(s => {
    const i = s.indexOf('=');
    if (i > 0) return [s.slice(2, i), s.slice(i+1)];
    if (s.startsWith('--')) return [s.slice(2), true];
    return [s, true];
  }));
  return args;
}

function parseWindow(win) {
  if (!win) return null;
  const m = String(win).trim().match(/^(\d+)([dwh])$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  const now = new Date();
  const end = now;
  const start = new Date(now);
  if (u === 'd') start.setDate(start.getDate() - n);
  if (u === 'w') start.setDate(start.getDate() - n * 7);
  if (u === 'h') start.setHours(start.getHours() - n);
  return { start, end };
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function httpGetJSON(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Invalid JSON from ${url}: ${e.message}\nBody: ${data.slice(0,500)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function formatReport(resp, meta) {
  const { success, data } = resp || {};
  if (!success || !data) return `Request failed or empty data`;
  const lines = [];
  lines.push(`# Weekly EV vs PnL Report`);
  lines.push(`Time Range: ${meta.range}`);
  if (meta.filters.strategy_type) lines.push(`Strategy: ${meta.filters.strategy_type}`);
  if (meta.filters.ab_group) lines.push(`AB Group: ${meta.filters.ab_group}`);
  lines.push('');
  lines.push(`Summary:`);
  lines.push(`- total: ${data.total}`);
  lines.push(`- closed: ${data.closed}`);
  lines.push(`- with_ev: ${data.with_ev}`);
  lines.push(`- mean_ev: ${data.mean_ev}`);
  lines.push(`- mean_pnl_percent: ${data.mean_pnl_percent}`);
  lines.push(`- corr_pearson: ${data.corr_pearson}`);
  lines.push(`- corr_spearman: ${data.corr_spearman}`);
  lines.push(`- sign_consistency_rate: ${data.sign_consistency_rate}`);
  if (data.ev_ok) {
    lines.push(`- ev_ok.true_group: count=${data.ev_ok.true_group.count}, win_rate=${data.ev_ok.true_group.win_rate}, avg_pnl=${data.ev_ok.true_group.avg_pnl_percent}`);
    lines.push(`- ev_ok.false_group: count=${data.ev_ok.false_group.count}, win_rate=${data.ev_ok.false_group.win_rate}, avg_pnl=${data.ev_ok.false_group.avg_pnl_percent}`);
  }
  lines.push('');
  if (Array.isArray(data.bins)) {
    lines.push(`Bins (${data.bins.length}):`);
    for (const b of data.bins) {
      lines.push(`- [${b.ev_min}, ${b.ev_max}] n=${b.count}, win_rate=${b.win_rate}, avg_pnl=${b.avg_pnl_percent}`);
    }
  }
  return lines.join('\n');
}

async function run() {
  const args = parseArgs();
  const baseUrl = args['base-url'] || loadBaseUrlFromConfig();

  let start, end;
  if (args.window) {
    const we = parseWindow(args.window);
    if (!we) {
      console.error('Invalid --window, expected Nd|Nw|Nh, e.g., 7d or 4w');
      process.exit(1);
    }
    start = we.start;
    end = we.end;
  } else if (args.start || args.end) {
    start = args.start ? new Date(String(args.start)) : undefined;
    end = args.end ? new Date(String(args.end)) : new Date();
    if (start && isNaN(start.getTime())) {
      console.error('Invalid --start date');
      process.exit(1);
    }
    if (end && isNaN(end.getTime())) {
      console.error('Invalid --end date');
      process.exit(1);
    }
  } else {
    // default 7d
    const we = parseWindow('7d');
    start = we.start; end = we.end;
  }

  const bins = Math.max(2, Math.min(12, args.bins ? Number(args.bins) : 5));
  const binMode = args['bin-mode'] === 'even' ? 'even' : 'quantile';
  const ab = args.ab ? String(args.ab) : '';
  const strategy_type = args.strategy_type ? String(args.strategy_type) : '';

  const qs = new URLSearchParams();
  if (start) qs.set('start', start.toISOString());
  if (end) qs.set('end', end.toISOString());
  if (ab) qs.set('ab_group', ab);
  if (strategy_type) qs.set('strategy_type', strategy_type);
  qs.set('bins', String(bins));
  qs.set('bin_mode', binMode);

  const url = `${baseUrl}/api/stats?${qs.toString()}`;
  const meta = {
    range: `${toISODate(start)} ~ ${toISODate(end)}`,
    filters: { strategy_type, ab_group: ab }
  };

  try {
    const resp = await httpGetJSON(url);
    const md = formatReport(resp, meta);
    const out = args.out && String(args.out);
    if (out) {
      const outPath = path.resolve(process.cwd(), out);
      if (outPath.toLowerCase().endsWith('.json')) {
        fs.writeFileSync(outPath, JSON.stringify(resp, null, 2));
        console.log('[weekly-report] wrote JSON to', outPath);
      } else {
        fs.writeFileSync(outPath, md, 'utf8');
        console.log('[weekly-report] wrote report to', outPath);
      }
    } else {
      console.log(md);
    }
  } catch (e) {
    console.error('[weekly-report] Request failed:', e.message || String(e));
    console.error('Tried URL:', url);
    process.exit(1);
  }
}

run();