const fields = ['session_slot_id', 'type', 'position', 'weight', 'unit', 'reps', 'seconds', 'target_weight', 'target_reps_min', 'target_reps_max', 'target_seconds', 'target_reference', 'reference_set_id', 'done_at', 'deleted_at'];
export const draftBase = row => JSON.stringify(fields.map(field => row?.[field] ?? null));

export function draftStore(db) {
  const pending = new Map();
  function writeMany(changes) {
    const entry = { changes, promise: null, failed: false };
    for (const [key] of changes) pending.set(JSON.stringify(key), entry);
    const commit = async () => {
      const tx = db.transaction('meta', 'readwrite');
      try {
        for (const [key, value] of changes) (value == null ? tx.store.delete(key) : tx.store.put(value, key)).catch(() => {});
        await tx.done;
      } catch (error) {
        try { tx.abort(); } catch {}
        await tx.done.catch(() => {}); throw error;
      }
    };
    entry.promise = commit().then(() => {
      for (const [key] of changes) if (pending.get(JSON.stringify(key)) === entry) pending.delete(JSON.stringify(key));
    }, error => { entry.failed = true; throw error; });
    return entry.promise;
  }
  return {
    write: (key, value) => writeMany([[key, value]]), writeMany,
    hasPending: () => pending.size > 0,
    forgetSaved(changes) {
      const removed = removedDraftKeys(changes);
      for (const [id, entry] of pending) if (entry.changes.some(([key]) => JSON.stringify(key) === id && removed(key))) pending.delete(id);
    },
    async load(sessionId) {
      const range = IDBKeyRange.bound(['draft', sessionId], ['draft', sessionId, []]);
      const tx = db.transaction('meta'), keys = await tx.store.getAllKeys(range), values = await tx.store.getAll(range);
      await tx.done;
      return Object.fromEntries(keys.map((key, i) => [key[2], values[i]]));
    },
    async flush() {
      await Promise.all([...new Set(pending.values())].map(entry => entry.failed ? writeMany(entry.changes.filter(([key]) => pending.get(JSON.stringify(key)) === entry)) : entry.promise));
    },
  };
}

// Cleanup shares the row transaction: a failed log must retain its draft.
function removedDraftKeys(changes) {
  const sets = new Set(), sessions = new Set(), slots = new Set();
  for (const { table, row } of changes) {
    if (table === 'set' && (row.done_at != null || row.deleted_at != null)) sets.add(row.id);
    if (table === 'session' && row.deleted_at != null) sessions.add(row.id);
    if (table === 'session_slot' && row.deleted_at != null) slots.add(`unit:${row.id}`);
  }
  return key => Array.isArray(key) && ((key[0] === 'rest' && sessions.has(key[1])) || (key[0] === 'draft' && (sessions.has(key[1]) || sets.has(key[2]) || slots.has(key[2]))));
}

export async function clearSavedDrafts(tx, changes) {
  if (!changes.some(({ table, row }) => row.deleted_at != null || (table === 'set' && row.done_at != null))) return;
  const removed = removedDraftKeys(changes);
  const store = tx.objectStore('meta');
  for (const key of await store.getAllKeys()) if (removed(key)) await store.delete(key);
}
