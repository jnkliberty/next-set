import { createHash } from 'node:crypto';
import { canonical } from '../server/store.js';
import { validateOperation } from '../server/schema.js';

function content(row) {
  const { seq, rev, device_id, updated_at, ...data } = row;
  return canonical(data);
}

export function applyImport(store, operations) {
  const prepared = operations.map(op => {
    validateOperation(op);
    const existing = store.get(op.table, op.row.id);
    const row = { ...op.row };
    if (existing) {
      if (content(existing) !== content(row) && existing.device_id !== 'importer') throw new Error('Import would replace an app edit');
      row.rev = existing.rev + (content(existing) === content(row) ? 0 : 1);
      row.updated_at = existing.updated_at;
    }
    const digest = createHash('sha256').update(canonical(row)).digest('hex');
    return { table: op.table, row, id: `import:${op.table}:${row.id}:${digest}` };
  });
  const counts = { applied: 0, duplicate: 0, rejected: 0 };
  for (const op of prepared) {
    const answer = store.apply(op);
    counts[answer.status]++;
    if (answer.status === 'rejected') throw new Error('Import conflict');
  }
  return counts;
}
