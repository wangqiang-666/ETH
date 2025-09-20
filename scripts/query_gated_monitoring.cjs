const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'recommendations.db');
const db = new sqlite3.Database(dbPath);

const limit = Number(process.env.LIMIT || 500);
const sql = `SELECT rowid, recommendation_id, check_time, current_price, extra_json FROM recommendation_monitoring ORDER BY rowid DESC LIMIT ${limit}`;

db.all(sql, [], (err, rows) => {
  if (err) {
    console.error('DB error:', err);
    process.exit(1);
  }
  const gated = [];
  for (const r of rows || []) {
    let ej = null;
    try { ej = JSON.parse(r.extra_json || 'null'); } catch (e) { ej = null; }
    const type = ej?.type || ej?.event?.type;
    if (type === 'GATED') {
      const reason = ej?.reason || ej?.event?.reason || null;
      const stage = ej?.stage || ej?.event?.stage || null;
      const source = ej?.source || ej?.event?.source || null;
      const symbol = ej?.symbol || ej?.event?.symbol || null;
      const direction = ej?.direction || ej?.event?.direction || null;
      const gid = ej?.gid || ej?.event?.gid || null;
      gated.push({ rowid: r.rowid, recommendation_id: r.recommendation_id, check_time: r.check_time, current_price: r.current_price, gid, symbol, direction, reason, stage, source });
    }
  }
  console.log(JSON.stringify(gated, null, 2));
  process.exit(0);
});