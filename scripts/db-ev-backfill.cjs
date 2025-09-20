#!/usr/bin/env node
/*
  Backfill EV fields in recommendations.db
  - expected_return <- ev if missing
  - ev <- expected_return if missing
  - ev_threshold <- config.strategy.evThreshold (default or legacy expectedValueThreshold) if missing
  - ev_ok <- ev >= ev_threshold when both present and ev_ok is null

  Usage: node scripts/db-ev-backfill.cjs [--apply]
  By default runs in dry-run mode (no DB writes). Pass --apply to perform updates.
*/

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

function loadConfigThreshold() {
  const candidates = [
    path.resolve(__dirname, '../config.current.json'),
    path.resolve(__dirname, '../config-current.json')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const cfg = JSON.parse(raw);
        const strat = (cfg && (cfg.strategy || (cfg.config && cfg.config.strategy))) || {};
        const evT = strat.evThreshold;
        const legacy = strat.expectedValueThreshold;
        if (typeof evT === 'number' && Number.isFinite(evT)) return evT;
        if (evT && typeof evT === 'object') {
          if (Number.isFinite(evT.default)) return Number(evT.default);
        }
        if (Number.isFinite(legacy)) return Number(legacy);
      }
    } catch (e) {
      console.warn('[backfill] Failed to parse config at', p, e.message || String(e));
    }
  }
  console.warn('[backfill] No evThreshold found in config.current.json; ev_threshold will NOT be backfilled.');
  return undefined;
}

async function run() {
  const APPLY = process.argv.includes('--apply');
  const FILL_EV_ZERO = process.argv.includes('--fill-ev-zero');
  const dbPath = path.resolve(__dirname, '../data/recommendations.db');
  if (!fs.existsSync(dbPath)) {
    console.error('[backfill] DB not found at', dbPath);
    process.exit(1);
  }
  const cliThresholdArg = process.argv.find(a => a.startsWith('--ev-threshold='));
  let threshold = loadConfigThreshold();
  if (!Number.isFinite(threshold) && cliThresholdArg) {
    const v = Number(cliThresholdArg.split('=')[1]);
    if (Number.isFinite(v)) {
      threshold = v;
      console.log('[backfill] Using CLI ev-threshold =', threshold);
    } else {
      console.warn('[backfill] Invalid --ev-threshold value, ignored:', cliThresholdArg);
    }
  }

  const db = new sqlite3.Database(dbPath);
  const all = (sql, params=[]) => new Promise((res, rej) => db.all(sql, params, (e, rows) => e ? rej(e) : res(rows)));
  const get = (sql, params=[]) => new Promise((res, rej) => db.get(sql, params, (e, row) => e ? rej(e) : res(row)));
  const runSql = (sql, params=[]) => new Promise((res, rej) => db.run(sql, params, function(err){ if (err) rej(err); else res({ changes: this.changes||0 }); }));

  try {
    const before = await get(`SELECT 
      SUM(CASE WHEN expected_return IS NULL THEN 1 ELSE 0 END) AS missing_expected,
      SUM(CASE WHEN ev IS NULL THEN 1 ELSE 0 END) AS missing_ev,
      SUM(CASE WHEN ev_threshold IS NULL THEN 1 ELSE 0 END) AS missing_ev_threshold,
      SUM(CASE WHEN ev_ok IS NULL THEN 1 ELSE 0 END) AS missing_ev_ok,
      COUNT(*) AS total
      FROM recommendations`);

    console.log('[backfill] Before:', before);

    if (!APPLY) {
      console.log('[backfill] Dry-run. Pass --apply to perform updates.');
      return; // Let finally close the DB once
    }

    await runSql('BEGIN');

    // 1) expected_return <- ev
    const r1 = await runSql(
      'UPDATE recommendations SET expected_return = ev WHERE expected_return IS NULL AND ev IS NOT NULL'
    );
    console.log('[backfill] expected_return <- ev, rows:', r1.changes);

    // 2) ev <- expected_return
    const r2 = await runSql(
      'UPDATE recommendations SET ev = expected_return WHERE ev IS NULL AND expected_return IS NOT NULL'
    );
    console.log('[backfill] ev <- expected_return, rows:', r2.changes);

    // 2.5) Optional: fill both ev and expected_return to 0 if both missing
    let r25 = { changes: 0 };
    if (FILL_EV_ZERO) {
      r25 = await runSql(
        'UPDATE recommendations SET ev = 0, expected_return = 0 WHERE ev IS NULL AND expected_return IS NULL'
      );
      console.log('[backfill] ev/expected_return <- 0 (flag --fill-ev-zero), rows:', r25.changes);
    }

    // 3) ev_threshold <- config default
    let r3 = { changes: 0 };
    if (Number.isFinite(threshold)) {
      r3 = await runSql(
        'UPDATE recommendations SET ev_threshold = ? WHERE ev_threshold IS NULL',
        [Number(threshold)]
      );
      console.log('[backfill] ev_threshold <- config.default', threshold, 'rows:', r3.changes);
    } else {
      console.log('[backfill] Skipped ev_threshold backfill (no threshold available)');
    }

    // 4) ev_ok <- (ev >= ev_threshold)
    const r4 = await runSql(
      'UPDATE recommendations SET ev_ok = CASE WHEN ev >= ev_threshold THEN 1 ELSE 0 END WHERE ev_ok IS NULL AND ev IS NOT NULL AND ev_threshold IS NOT NULL'
    );
    console.log('[backfill] ev_ok <- (ev >= ev_threshold), rows:', r4.changes);

    await runSql('COMMIT');

    const after = await get(`SELECT 
      SUM(CASE WHEN expected_return IS NULL THEN 1 ELSE 0 END) AS missing_expected,
      SUM(CASE WHEN ev IS NULL THEN 1 ELSE 0 END) AS missing_ev,
      SUM(CASE WHEN ev_threshold IS NULL THEN 1 ELSE 0 END) AS missing_ev_threshold,
      SUM(CASE WHEN ev_ok IS NULL THEN 1 ELSE 0 END) AS missing_ev_ok,
      COUNT(*) AS total
      FROM recommendations`);

    console.log('[backfill] After:', after);

    // show a small sample of CLOSED rows for verification
    const sample = await all(`SELECT id, created_at, status, expected_return, ev, ev_threshold, ev_ok, pnl_percent
      FROM recommendations
      WHERE status='CLOSED'
      ORDER BY created_at DESC
      LIMIT 10`);
    console.log('[backfill] Sample of CLOSED rows (latest 10):');
    console.log(JSON.stringify(sample, null, 2));

  } catch (e) {
    try { await runSql('ROLLBACK'); } catch {}
    console.error('[backfill] Error:', e.message || String(e));
    process.exit(1);
  } finally {
    try { db.close(); } catch {}
  }
}

run();