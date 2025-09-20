#!/usr/bin/env node
/*
  Backfill PnL for TIMEOUT-closed recommendations where pnl_percent is NULL.
  - Targets rows with status IN ('CLOSED','EXPIRED') AND (exit_reason='TIMEOUT' OR exit_label='TIMEOUT') AND pnl_percent IS NULL
  - exit_price fallback: exit_price ?? current_price ?? entry_price
  - pnl_percent = base_move_percent * leverage (default 1)
  - pnl_amount = (pnl_percent/100) * position_size (default 0)
  - If exit_price was NULL and we used a fallback, persist it
  - If exit_label is NULL and reason is TIMEOUT, set exit_label='TIMEOUT'
  - Idempotent: only updates when pnl_percent IS NULL
*/
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.resolve(__dirname, '..', 'data', 'recommendations.db');
const dryRun = process.argv.includes('--dry-run');

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[backfill-timeout-pnl] Failed to open DB:', err.message);
    process.exit(1);
  }
});

const selectSQL = `
SELECT id, symbol, direction, leverage, position_size,
       entry_price, current_price, exit_price,
       status, exit_reason, exit_label,
       created_at, updated_at
FROM recommendations
WHERE (status = 'CLOSED' OR status = 'EXPIRED')
  AND (exit_reason = 'TIMEOUT' OR exit_label = 'TIMEOUT')
  AND pnl_percent IS NULL
`;

function compute(r) {
  const entry = Number(r.entry_price);
  if (!isFinite(entry) || entry <= 0) return null;
  const lev = isFinite(Number(r.leverage)) && Number(r.leverage) > 0 ? Number(r.leverage) : 1;
  const hasExit = r.exit_price !== null && r.exit_price !== undefined && r.exit_price !== '';
  const hasCur = r.current_price !== null && r.current_price !== undefined && r.current_price !== '';
  const exitP = hasExit ? Number(r.exit_price) : (hasCur ? Number(r.current_price) : entry);
  if (!isFinite(exitP) || exitP <= 0) return null;

  let baseMove = ((exitP - entry) / entry) * 100; // LONG
  const dir = String(r.direction || 'LONG').toUpperCase();
  if (dir === 'SHORT') baseMove = -baseMove;
  const pnlPercent = baseMove * lev;
  const pos = isFinite(Number(r.position_size)) ? Number(r.position_size) : 0;
  const pnlAmount = (pnlPercent / 100) * pos;

  return {
    exitP,
    usedFallbackExit: !hasExit,
    pnlPercent: round2(pnlPercent),
    pnlAmount: round2(pnlAmount)
  };
}

function run() {
  db.all(selectSQL, [], (err, rows) => {
    if (err) {
      console.error('[backfill-timeout-pnl] Query failed:', err.message);
      process.exit(2);
    }
    if (!rows || rows.length === 0) {
      console.log('[backfill-timeout-pnl] No timeout-closed records need backfill.');
      db.close();
      return;
    }

    let updated = 0;
    let skipped = 0;

    const updates = [];
    for (const r of rows) {
      const comp = compute(r);
      if (!comp) { skipped++; continue; }
      updates.push({ id: r.id, exitP: comp.exitP, usedFallbackExit: comp.usedFallbackExit, pnlPercent: comp.pnlPercent, pnlAmount: comp.pnlAmount, reason: r.exit_reason, label: r.exit_label });
    }

    if (dryRun) {
      console.log(`[backfill-timeout-pnl] Dry-run. Candidates: ${updates.length}, skipped: ${skipped}`);
      console.table(updates.slice(0, 10));
      db.close();
      return;
    }

    db.serialize(() => {
      db.run('BEGIN IMMEDIATE TRANSACTION');
      const sql = `
        UPDATE recommendations
        SET
          pnl_amount = ?,
          pnl_percent = ?,
          exit_price = COALESCE(exit_price, ?),
          exit_label = CASE
            WHEN (exit_label IS NULL OR exit_label = '') AND exit_reason = 'TIMEOUT' THEN 'TIMEOUT'
            ELSE exit_label
          END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND pnl_percent IS NULL
      `;
      const stmt = db.prepare(sql);
      for (const u of updates) {
        stmt.run([u.pnlAmount, u.pnlPercent, u.exitP, u.id], function (e) {
          if (e) {
            console.error('[backfill-timeout-pnl] Update error for id', u.id, e.message);
            skipped++;
          } else {
            updated += this.changes || 0;
          }
        });
      }
      stmt.finalize((e) => {
        if (e) console.error('[backfill-timeout-pnl] finalize error:', e.message);
        db.run('COMMIT', (ce) => {
          if (ce) {
            console.error('[backfill-timeout-pnl] Commit error:', ce.message);
          }
          console.log(`[backfill-timeout-pnl] Done. Updated: ${updated}, skipped: ${skipped}, total considered: ${rows.length}`);
          db.close();
        });
      });
    });
  });
}

run();