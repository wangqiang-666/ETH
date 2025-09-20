#!/usr/bin/env node
const path = require('path');
const sqlite3 = require('sqlite3');
const dbPath = path.resolve(__dirname, '..', 'data', 'recommendations.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open DB:', err.message);
    process.exit(1);
  }
});

function qGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function qAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

(async () => {
  try {
    const total = (await qGet(`SELECT COUNT(*) c FROM recommendations`)).c;
    const closed = (await qGet(`SELECT COUNT(*) c FROM recommendations WHERE status='CLOSED'`)).c;
    const closedOrExpired = (await qGet(`SELECT COUNT(*) c FROM recommendations WHERE status IN ('CLOSED','EXPIRED')`)).c;
    const closedWithPnl = (await qGet(`SELECT COUNT(*) c FROM recommendations WHERE status='CLOSED' AND pnl_percent IS NOT NULL`)).c;
    const closedOrExpiredWithPnl = (await qGet(`SELECT COUNT(*) c FROM recommendations WHERE status IN ('CLOSED','EXPIRED') AND pnl_percent IS NOT NULL`)).c;
    const closedWithEV = (await qGet(`SELECT COUNT(*) c FROM recommendations WHERE status='CLOSED' AND (ev IS NOT NULL OR expected_return IS NOT NULL)`)).c;
    const closedOrExpiredWithEV = (await qGet(`SELECT COUNT(*) c FROM recommendations WHERE status IN ('CLOSED','EXPIRED') AND (ev IS NOT NULL OR expected_return IS NOT NULL)`)).c;
    const withThreshold = (await qGet(`SELECT COUNT(*) c FROM recommendations WHERE status IN ('CLOSED','EXPIRED') AND ev_threshold IS NOT NULL`)).c;
    const anyEV = (await qGet(`SELECT COUNT(*) c FROM recommendations WHERE (ev IS NOT NULL OR expected_return IS NOT NULL)`)).c;

    const abTop10 = await qAll(`SELECT COALESCE(ab_group,'(null)') AS ab_group, COUNT(*) c FROM recommendations GROUP BY ab_group ORDER BY c DESC LIMIT 10`);
    const extrema = await qGet(`SELECT MIN(created_at) AS min_created, MAX(created_at) AS max_created, MIN(updated_at) AS min_updated, MAX(updated_at) AS max_updated FROM recommendations`);

    const thresholdDist = await qAll(`SELECT ev_threshold, COUNT(*) c FROM recommendations WHERE ev_threshold IS NOT NULL GROUP BY ev_threshold ORDER BY ev_threshold`);

    const missingEVClosedSample = await qAll(`
      SELECT id, created_at, status, exit_reason, exit_label, direction, entry_price, exit_price, pnl_percent, ev, expected_return, ev_threshold
      FROM recommendations
      WHERE status IN ('CLOSED','EXPIRED') AND (ev IS NULL AND expected_return IS NULL)
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const haveEVClosedSample = await qAll(`
      SELECT id, created_at, status, direction, pnl_percent, ev, expected_return, ev_threshold
      FROM recommendations
      WHERE status IN ('CLOSED','EXPIRED') AND (ev IS NOT NULL OR expected_return IS NOT NULL)
      ORDER BY created_at DESC
      LIMIT 10
    `);

    console.log(JSON.stringify({
      dbPath,
      totals: { total, closed, closedOrExpired, closedWithPnl, closedOrExpiredWithPnl, closedWithEV, closedOrExpiredWithEV, withThreshold, anyEV },
      abTop10,
      extrema,
      thresholdDist,
      samples: { missingEVClosedSample, haveEVClosedSample }
    }, null, 2));
  } catch (e) {
    console.error('SQL error:', e.message);
    process.exit(1);
  } finally {
    db.close();
  }
})();