#!/usr/bin/env node
// Simple injector to insert OPEN/CLOSE executions into SQLite DB for testing
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--rec' || a === '--recommendation') opts.recommendation_id = args[++i];
    else if (a === '--pos' || a === '--position') opts.position_id = args[++i];
    else if (a === '--dir' || a === '--direction') opts.direction = args[++i];
    else if (a === '--symbol') opts.symbol = args[++i];
    else if (a === '--size') opts.size = parseFloat(args[++i]);
    else if (a === '--open') opts.open = parseFloat(args[++i]);
    else if (a === '--close') opts.close = parseFloat(args[++i]);
    else if (a === '--slipbps') opts.slippage_bps = parseFloat(args[++i]);
    else if (a === '--feebps') opts.fee_bps = parseFloat(args[++i]);
    else if (a === '--pnl') opts.pnl_amount = parseFloat(args[++i]);
    else if (a === '--pnlpct') opts.pnl_percent = parseFloat(args[++i]);
    else if (a === '--now') opts.now = parseInt(args[++i], 10);
    else if (a === '--variant') opts.variant = args[++i];
    else if (a === '--ab-group') opts.ab_group = args[++i];
    else if (a === '--experiment-id') opts.experiment_id = args[++i];
  }
  return opts;
}

function nowIso(ms) { return new Date(ms ?? Date.now()).toISOString(); }

function insertExecution(db, exe) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO executions (
        created_at, updated_at, recommendation_id, position_id, event_type, symbol, direction, size,
        intended_price, intended_timestamp, fill_price, fill_timestamp, latency_ms,
        slippage_bps, slippage_amount, fee_bps, fee_amount, pnl_amount, pnl_percent, extra_json,
        variant, ab_group, experiment_id
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?
      )`;
    const params = [
      exe.created_at, exe.updated_at, exe.recommendation_id || null, exe.position_id || null, exe.event_type,
      exe.symbol || null, exe.direction || null, exe.size || null,
      exe.intended_price || null, exe.intended_timestamp || null, exe.fill_price || null, exe.fill_timestamp || null, exe.latency_ms || null,
      exe.slippage_bps || null, exe.slippage_amount || null, exe.fee_bps || null, exe.fee_amount || null, exe.pnl_amount || null, exe.pnl_percent || null,
      exe.extra_json ? JSON.stringify(exe.extra_json) : null,
      exe.variant || null, exe.ab_group || null, exe.experiment_id || null
    ];
    db.run(sql, params, function(err) {
      if (err) return reject(err);
      resolve(this && typeof this.lastID === 'number' ? this.lastID : 0);
    });
  });
}

async function main() {
  const opts = parseArgs();
  if (!opts.recommendation_id) {
    console.error('Usage: node scripts/inject-execution.cjs --rec <id> [--open <price>] [--close <price>] [--size <num>] [--dir LONG|SHORT] [--symbol <sym>]');
    process.exit(2);
  }
  const dbPath = path.join(__dirname, '..', 'data', 'recommendations.db');
  const db = new sqlite3.Database(dbPath);

  const base = {
    recommendation_id: opts.recommendation_id,
    position_id: opts.position_id || null,
    symbol: opts.symbol || 'ETH-USDT-SWAP',
    direction: opts.direction || 'LONG',
    size: isFinite(opts.size) ? opts.size : 0.01,
    slippage_bps: isFinite(opts.slippage_bps) ? opts.slippage_bps : 0,
    fee_bps: isFinite(opts.fee_bps) ? opts.fee_bps : 5,
    variant: opts.variant || null,
    ab_group: opts.ab_group || null,
    experiment_id: opts.experiment_id || null,
  };

  const t0 = isFinite(opts.now) ? opts.now : Date.now();
  const openTs = t0 - 60_000; // 1 min ago
  const closeTs = t0;

  try {
    if (isFinite(opts.open)) {
      const exeOpen = {
        ...base,
        event_type: 'OPEN',
        intended_price: opts.open,
        intended_timestamp: openTs,
        fill_price: opts.open,
        fill_timestamp: openTs,
        created_at: nowIso(openTs),
        updated_at: nowIso(openTs),
        latency_ms: 20,
        slippage_amount: 0,
        fee_amount: (base.size * opts.open) * (base.fee_bps / 10000),
        pnl_amount: null,
        pnl_percent: null,
        extra_json: { injected: true }
      };
      const id1 = await insertExecution(db, exeOpen);
      console.log('Inserted OPEN execution id:', id1);
    }

    if (isFinite(opts.close)) {
      // If pnl not provided, approximate based on open and close
      let pnlAmount = isFinite(opts.pnl_amount) ? opts.pnl_amount : null;
      let pnlPercent = isFinite(opts.pnl_percent) ? opts.pnl_percent : null;
      if (pnlAmount === null && isFinite(opts.open) && isFinite(opts.close)) {
        const diff = (opts.close - opts.open) * (base.direction === 'LONG' ? 1 : -1);
        pnlAmount = diff * base.size; // simple approximation
        pnlPercent = (diff / opts.open) * 100;
      }
      const exeClose = {
        ...base,
        event_type: 'CLOSE',
        intended_price: opts.close,
        intended_timestamp: closeTs,
        fill_price: opts.close,
        fill_timestamp: closeTs,
        created_at: nowIso(closeTs),
        updated_at: nowIso(closeTs),
        latency_ms: 25,
        slippage_amount: 0,
        fee_amount: (base.size * opts.close) * (base.fee_bps / 10000),
        pnl_amount: pnlAmount,
        pnl_percent: pnlPercent,
        extra_json: { injected: true }
      };
      const id2 = await insertExecution(db, exeClose);
      console.log('Inserted CLOSE execution id:', id2);
    }
  } catch (e) {
    console.error('Inject error:', e.message || String(e));
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();