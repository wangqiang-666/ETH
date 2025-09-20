#!/usr/bin/env node
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const dbPath = path.resolve(__dirname, '..', 'data', 'recommendations.db');
const db = new sqlite3.Database(dbPath);

function q(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

(async () => {
  try {
    const totalMissing = await q(`SELECT COUNT(*) AS n FROM recommendations WHERE (status='CLOSED' OR status='EXPIRED') AND pnl_percent IS NULL`);
    console.log('Total CLOSED/EXPIRED with NULL pnl_percent:', totalMissing[0].n);

    const timeoutMissing = await q(`SELECT COUNT(*) AS n FROM recommendations WHERE (status='CLOSED' OR status='EXPIRED') AND (exit_reason='TIMEOUT' OR exit_label='TIMEOUT') AND pnl_percent IS NULL`);
    console.log('Of which TIMEOUT:', timeoutMissing[0].n);

    const sample = await q(`SELECT id, created_at, updated_at, status, exit_reason, exit_label, direction, leverage, entry_price, current_price, exit_price, position_size FROM recommendations WHERE (status='CLOSED' OR status='EXPIRED') AND pnl_percent IS NULL ORDER BY created_at DESC LIMIT 20`);
    console.table(sample);
  } catch (e) {
    console.error('diagnose error:', e.message);
  } finally {
    db.close();
  }
})();