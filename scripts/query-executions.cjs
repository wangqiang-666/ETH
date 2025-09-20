// scripts/query-executions.cjs
const sqlite3 = require('sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'recommendations.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open DB:', err.message);
    process.exit(1);
  }
});

const sql = `
SELECT id, created_at, event_type, symbol, direction, size,
       fill_price, fill_timestamp
FROM executions
ORDER BY COALESCE(fill_timestamp, CAST(STRFTIME('%s', created_at) * 1000 AS INTEGER)) DESC
LIMIT 10;
`;

db.all(sql, (err, rows) => {
  if (err) {
    console.error('Query error:', err.message);
    process.exit(1);
  }
  console.log(JSON.stringify(rows || [], null, 2));
  db.close();
});