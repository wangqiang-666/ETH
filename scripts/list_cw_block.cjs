const sqlite3 = require('sqlite3');
const path = require('path');

(async () => {
  try {
    const dbPath = path.join(__dirname, '..', 'data', 'recommendations.db');
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('open error:', err.message);
        process.exit(1);
      }
    });
    const sql = "SELECT id, symbol, status, created_at FROM recommendations WHERE symbol LIKE 'CW-BLOCK-%' ORDER BY datetime(created_at) DESC LIMIT 50";
    db.all(sql, (err, rows) => {
      if (err) {
        console.error('SQL error:', err.message);
        process.exit(1);
      }
      console.log(JSON.stringify(rows || [], null, 2));
      db.close();
    });
  } catch (e) {
    console.error('fatal:', e && e.message ? e.message : e);
    process.exit(1);
  }
})();