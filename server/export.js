import { tables, validateStoredRow } from './schema.js';
import { canonical } from './store.js';

export function restoreExport(store, payload) {
  if (payload?.version !== 1 || !payload.tables || Object.keys(payload.tables).some(table=>!tables.includes(table))) throw new Error('Invalid export');
  if (tables.some(table=>store.rows(table,true).length)) throw new Error('Restore requires an empty database');
  const seen = new Set();
  let maximum = 0;
  for (const table of tables) {
    if (!Array.isArray(payload.tables[table])) throw new Error('Incomplete export');
    for (const row of payload.tables[table]) {
      validateStoredRow(table,row);
      if (row.seq != null && (!Number.isSafeInteger(row.seq) || row.seq<1 || seen.has(row.seq))) throw new Error('Invalid sequence');
      if(row.seq!=null){seen.add(row.seq);maximum=Math.max(maximum,row.seq);}
    }
  }
  store.db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of tables) for (const row of payload.tables[table]) {
      const seq=row.seq??++maximum;
      store.db.prepare(`INSERT INTO "${table}" (id,seq,document) VALUES (?,?,?)`).run(row.id,seq,canonical({...row,seq}));
    }
    store.db.prepare('UPDATE _clock SET seq=? WHERE id=1').run(maximum);
    store.db.exec('COMMIT');
  } catch(error){store.db.exec('ROLLBACK');throw error;}
}
