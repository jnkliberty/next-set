// Changes that put back what `changes` overwrote. `before(table, id)` gives a row as it was before the save.
// Rows the save created come back deleted; changed fields get their old values.
export function inverse(before, changes, now = Date.now()) {
  const rows = new Map();
  for (const { table, row } of changes) {
    const key = `${table}:${row.id}`, own = rows.get(key) ?? { table, row: { id: row.id } }, old = before(table, row.id);
    if (!old) own.row.deleted_at = now;
    else for (const field of Object.keys(row)) if (field !== 'id' && !(field in own.row)) own.row[field] = old[field] ?? null;
    rows.set(key, own);
  }
  return [...rows.values()];
}
