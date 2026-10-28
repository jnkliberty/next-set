import { openDB } from 'idb';
import { tables, validateOperation } from '../server/schema.js';
import { fingerprints } from '../domain/fingerprint.js';
import { inverse } from '../domain/undo.js';
import { clearSavedDrafts, draftBase, draftStore } from './drafts.js';

export async function openLocal(changed = (_event) => {}) {
  const db = await openDB('workout-tracker', 1, {
    upgrade(database) {
      for (const table of tables) database.createObjectStore(table, { keyPath: 'id' });
      database.createObjectStore('meta');
      const outbox = database.createObjectStore('outbox', { keyPath: 'id' });
      outbox.createIndex('row_key', 'row_key');
      database.createObjectStore('event_queue', { keyPath: 'id' });
    },
    blocking() { db.close(); changed({ error: 'Storage changed. Reopen the app before your next set.' }); },
    terminated() { changed({ error: 'Storage disconnected. Reopen the app before your next set.' }); },
  });
  const meta = db.transaction('meta', 'readwrite');
  let device = await meta.store.get('device');
  if (!device) { device = crypto.randomUUID(); await meta.store.put(device, 'device'); }
  await meta.done;
  const channel = new BroadcastChannel('workout-tracker');
  const drafts = draftStore(db);
  const leaving = event => { if (drafts.hasPending()) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', leaving);
  channel.onmessage = () => changed({ reload: true });
  let syncing = null;
  let syncAgain = false;
  function notify(rows) { changed({ rows }); channel.postMessage('changed'); }

  async function snapshot() {
    const transaction = db.transaction(tables);
    const pairs = await Promise.all(tables.map(async table => [table, await transaction.objectStore(table).getAll()]));
    await transaction.done;
    return Object.fromEntries(pairs);
  }

  // Returns the saved rows, the changes that undo this save, and a guard. Saving the undo rows with that guard
  // fails inside the same transaction if this device saved anything since, or any touched row has a newer version.
  let saves = 0;
  const stale = () => Object.assign(new Error('Undo is off: something changed after that save.'), { stale: true });
  async function save(changes, guard = null, expected = {}, restoredDrafts = []) {
    const names = [...new Set(changes.map(change => change.table))];
    const tx = db.transaction([...names, 'outbox', 'meta'], 'readwrite'), result = [], before = new Map(), after = new Map();
    try {
      const originals = await Promise.all(changes.map(change => tx.objectStore(change.table).get(change.row.id))), current = new Map(), operations = [];
      for (const [i, change] of changes.entries()) {
        const key = `${change.table}:${change.row.id}`, previous = current.has(key) ? current.get(key) : originals[i];
        if (guard && (saves !== guard.count || (previous?.rev ?? null) !== guard.revs[key])) throw stale();
        // A number is the row version the screen showed; another tab or device saving first refuses this edit.
        if (typeof expected[key] === 'number' && !before.has(key) && (previous?.rev ?? 0) !== expected[key]) throw new Error('Another screen changed this first. Check it and try again.');
        if (typeof expected[key] === 'string' && draftBase(previous) !== expected[key]) throw new Error('This set changed. Choose the saved values or your draft before logging.');
        if (!before.has(key)) before.set(key, previous);
        const row = { ...previous, ...change.row, rev: (previous?.rev ?? 0) + 1, device_id: device, updated_at: Date.now(), deleted_at: Object.hasOwn(change.row, 'deleted_at') ? change.row.deleted_at : previous?.deleted_at ?? null };
        const operation = { id: crypto.randomUUID(), table: change.table, row };
        validateOperation(operation);
        current.set(key, row); operations.push(operation);
        result.push({ table: change.table, row }); after.set(key, row.rev);
      }
      // Queue the validated batch together; IndexedDB preserves request order within this transaction.
      await Promise.all(operations.map(async op => {
        await tx.objectStore(op.table).put(op.row);
        await tx.objectStore('outbox').put({ ...op, row_key: `${op.table}:${op.row.id}` });
      }));
      await clearSavedDrafts(tx, result);
      for (const [key, value] of restoredDrafts) await tx.objectStore('meta').put(value, key);
      await tx.done; drafts.forgetSaved(result); saves++; notify(result);
      return { rows: result, undo: inverse((table, id) => before.get(`${table}:${id}`), changes), guard: { count: saves, revs: Object.fromEntries(after) } };
    } catch (error) {
      try { tx.abort(); } catch {}
      await tx.done.catch(() => {}); throw error;
    }
  }

  async function record(kind, detail = {}, context = {}) {
    try {
      const row = { id: crypto.randomUUID(), rev: 1, device_id: device, updated_at: Date.now(), deleted_at: null,
        device, kind, time: Date.now(), detail, ...context };
      const operation = { id: `event:${row.id}`, table: 'event', row };
      validateOperation(operation);
      const tx = db.transaction(['event', 'event_queue'], 'readwrite');
      await tx.objectStore('event').put(row); await tx.objectStore('event_queue').put(operation); await tx.done;
    } catch { /* Tool events never block a set. */ }
  }

  async function post(path, body) {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('The server did not accept the sync. Your changes stay on this device.');
    return response.json();
  }

  async function acknowledge(operations, results, queue) {
    if (!Array.isArray(results) || operations.some(op => !results.some(result => result.id === op.id))) throw new Error('Incomplete sync answer');
    const tx = db.transaction([...new Set(operations.map(op => op.table)), queue, 'meta'], 'readwrite'), accepted = [];
    for (const result of results) {
      const op = operations.find(operation => operation.id === result.id);
      if (!op || !['applied', 'duplicate', 'rejected'].includes(result.status)) continue;
      const queued = await tx.objectStore(queue).get(op.id); if (!queued) continue;
      if (result.status === 'rejected' && (!result.row || result.reason === 'invalid_operation')) {
        await tx.objectStore('meta').put('A change was rejected. Export this device before resetting it.', 'sync_error');
        continue;
      }
      await tx.objectStore(queue).delete(op.id);
      const pending = queue === 'outbox' ? await tx.objectStore(queue).index('row_key').getAll(op.row_key) : [];
      if (!pending.length && result.row) {
        await tx.objectStore(op.table).put(result.row);
        accepted.push({ table: op.table, row: result.row });
      }
    }
    await clearSavedDrafts(tx, accepted);
    await tx.done; drafts.forgetSaved(accepted);
  }

  async function push(queue) {
    const operations = await db.getAll(queue, undefined, 200);
    if (!operations.length) return false;
    if (queue === 'outbox') await record('sync_try', { operations: operations.length });
    const body = await post('/api/sync', { operations: operations.map(({ id, table, row }) => ({ id, table, row })) });
    await acknowledge(operations, body.results, queue);
    if (queue === 'outbox') await record('sync_result', { answers: body.results.length });
    const pending = new Set(await db.getAllKeys(queue));
    return pending.size > 0 && operations.some(op=>!pending.has(op.id));
  }

  const trainingTables = tables.filter(table => !['event', 'set_edit'].includes(table));
  async function requeue(tx) {
    for (const table of trainingTables) for (const row of await tx.objectStore(table).getAll()) {
      await tx.objectStore('outbox').put({ id: crypto.randomUUID(), table, row, row_key: `${table}:${row.id}` });
    }
  }

  async function resend() {
    const tx = db.transaction([...trainingTables, 'outbox'], 'readwrite');
    await requeue(tx); await tx.done;
    changed({ reload: true });
  }

  async function pull() {
    let more = true;
    while (more) {
    const cursor = await db.get('meta', 'cursor') || 0;
    const response = await fetch(`/api/changes?since=${cursor}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('The server is unavailable. Your changes stay on this device.');
    const body = await response.json();
    if (!Array.isArray(body.rows) || !Number.isSafeInteger(body.cursor) || body.cursor < 0 || (body.more && body.cursor <= cursor)) throw new Error('Invalid server answer');
    const tx = db.transaction([...tables, 'outbox', 'event_queue', 'meta'], 'readwrite'), accepted = [];
    if (body.cursor < cursor) { await requeue(tx); syncAgain = true; }
    for (const { table, row } of body.rows) {
      if (!tables.includes(table) || typeof row?.id !== 'string') { tx.abort(); throw new Error('Invalid server row'); }
      const pending = await tx.objectStore('outbox').index('row_key').getAll(`${table}:${row.id}`);
      if (!pending.length && !(table === 'event' && await tx.objectStore('event_queue').get(`event:${row.id}`))) {
        await tx.objectStore(table).put(row);
        accepted.push({ table, row });
      }
    }
    await tx.objectStore('meta').put(body.cursor, 'cursor');
    await clearSavedDrafts(tx, accepted);
    await tx.done; drafts.forgetSaved(accepted);
    more = body.more === true;
    }
  }

  async function check() {
    if (await db.count('outbox')) return { waiting: true };
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
    const dates = Array.from({ length: 30 }, (_, i) => new Date(Date.parse(`${today}T12:00:00Z`) - i * 86400000).toISOString().slice(0, 10));
    const local = await fingerprints(await db.getAll('set'), dates);
    const remote = await post('/api/count-check', { dates });
    if (await db.count('outbox')) return { waiting: true };
    const ok = JSON.stringify(local) === JSON.stringify(remote.days);
    const result = { ok, checkedAt: Date.now(), local, remote: remote.days };
    const previous = await db.get('meta', 'count_check');
    await db.put('meta', result, 'count_check');
    if (!previous || JSON.stringify([ok, local, remote.days]) !== JSON.stringify([previous.ok, previous.local, previous.remote])) await record('count_check', { ok });
    return result;
  }

  async function sync() {
    if (syncing) { syncAgain = true; return syncing; }
    syncing = (async () => {
      do {
      syncAgain = false;
      try {
        let more = true;
        while (more) more = await push('outbox');
        await pull();
        await check();
        await push('event_queue');
        if (!(await db.count('outbox')) && !(await db.count('event_queue'))) await db.delete('meta', 'sync_error');
        changed({ reload: true, online: true }); channel.postMessage('changed');
      } catch (error) { changed({ online: false, syncMessage: error.message }); }
      } while (syncAgain);
    })().finally(()=>{syncing=null;});
    return syncing;
  }

  return { db, device, snapshot, save, record, sync, check, resend, drafts,
    async status() {
      const [waiting, events, check, error] = await Promise.all([db.count('outbox'), db.count('event_queue'), db.get('meta', 'count_check'), db.get('meta', 'sync_error')]);
      return { waiting, events, check, error };
    },
    close() { window.removeEventListener('beforeunload', leaving); channel.close(); db.close(); },
  };
}
