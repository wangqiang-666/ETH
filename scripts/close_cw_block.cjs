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
    const now = new Date().toISOString();
    const sql = "UPDATE recommendations SET status='CLOSED', updated_at = ? WHERE symbol LIKE 'CW-BLOCK-%' AND status='ACTIVE'";
    db.run(sql, [now], function(err) {
      if (err) {
        console.error('SQL error:', err.message);
        process.exit(1);
      }
      console.log(JSON.stringify({ changes: this.changes }, null, 2));
      db.close();
    });
  } catch (e) {
    console.error('fatal:', e && e.message ? e.message : e);
    process.exit(1);
  }
})();