import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';

// Utility: compute target price from percent (leveraged) and direction
function computeTargetPrice(entry: number, leverage: number, percent: number, direction: 'LONG' | 'SHORT', type: 'tp' | 'sl'): number | null {
  if (!entry || !leverage || !percent || leverage <= 0 || percent <= 0) return null;
  const rawPct = percent / leverage / 100; // convert leveraged % back to underlying price move
  if (type === 'tp') {
    return direction === 'LONG' ? Number((entry * (1 + rawPct)).toFixed(2)) : Number((entry * (1 - rawPct)).toFixed(2));
  } else { // sl
    return direction === 'LONG' ? Number((entry * (1 - rawPct)).toFixed(2)) : Number((entry * (1 + rawPct)).toFixed(2));
  }
}

async function main() {
  const dbPath = path.join(process.cwd(), 'data', 'recommendations.db');
  if (!fs.existsSync(dbPath)) {
    console.error('[backfill] Database not found:', dbPath);
    process.exit(1);
  }

  const db = new sqlite3.Database(dbPath);
  const allRows = await new Promise<any[]>((resolve, reject) => {
    const sql = `
      SELECT id, entry_price, direction, leverage,
             take_profit_percent, stop_loss_percent,
             take_profit_price, stop_loss_price
      FROM recommendations
      WHERE (take_profit_price IS NULL AND take_profit_percent IS NOT NULL)
         OR (stop_loss_price IS NULL AND stop_loss_percent IS NOT NULL)
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });

  if (!allRows.length) {
    console.log('[backfill] No recommendations need backfill.');
    db.close();
    return;
  }

  console.log(`[backfill] Found ${allRows.length} recommendations need backfill...`);

  // Begin transaction
  await new Promise<void>((resolve, reject) => db.run('BEGIN TRANSACTION', [], err => err ? reject(err) : resolve()));

  let updated = 0;
  for (const r of allRows) {
    const id: string = r.id;
    const entry: number = Number(r.entry_price);
    const lev: number = Math.max(1, Number(r.leverage || 1));
    const dir: 'LONG' | 'SHORT' = (r.direction === 'SHORT') ? 'SHORT' : 'LONG';

    const tpPct: number | null = typeof r.take_profit_percent === 'number' ? r.take_profit_percent : (r.take_profit_percent ? Number(r.take_profit_percent) : null);
    const slPct: number | null = typeof r.stop_loss_percent === 'number' ? r.stop_loss_percent : (r.stop_loss_percent ? Number(r.stop_loss_percent) : null);

    const curTP: number | null = r.take_profit_price != null ? Number(r.take_profit_price) : null;
    const curSL: number | null = r.stop_loss_price != null ? Number(r.stop_loss_price) : null;

    const newTP = (curTP == null && tpPct != null && tpPct > 0) ? computeTargetPrice(entry, lev, tpPct, dir, 'tp') : null;
    const newSL = (curSL == null && slPct != null && slPct > 0) ? computeTargetPrice(entry, lev, slPct, dir, 'sl') : null;

    if (newTP == null && newSL == null) continue;

    const sets: string[] = ['updated_at = ?'];
    const params: any[] = [new Date().toISOString()];
    if (newTP != null) { sets.push('take_profit_price = ?'); params.push(newTP); }
    if (newSL != null) { sets.push('stop_loss_price = ?'); params.push(newSL); }
    params.push(id);

    await new Promise<void>((resolve, reject) => {
      const sql = `UPDATE recommendations SET ${sets.join(', ')} WHERE id = ?`;
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        updated += this && typeof this.changes === 'number' ? this.changes : 0;
        resolve();
      });
    });
  }

  await new Promise<void>((resolve, reject) => db.run('COMMIT', [], err => err ? reject(err) : resolve()));
  db.close();

  console.log(`[backfill] Completed. Rows updated: ${updated}`);
}

main().catch(err => {
  console.error('[backfill] Error:', err);
  process.exit(1);
});