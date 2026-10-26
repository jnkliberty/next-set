import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';

function setup(t, path = ':memory:') {
  const store = new Store(path);
  t.after(() => store.close());
  return store;
}

function operation(id, rev, reps, device = 'phone-a', updated = 1000) {
  return { id, table: 'set', row: {
    id: 'set-1', rev, device_id: device, updated_at: updated, deleted_at: null,
    session_slot_id: 'slot-1', position: 1, type: 'working',
    weight: 50, unit: 'kg', grams: 50000, reps, local_date: '2026-10-21',
  } };
}

test('revision order preserves old and losing values, independent of device clocks', t => {
  const store = setup(t);
  assert.equal(store.apply(operation('op-1', 1, 8, 'phone-a', 9999999999)).status, 'applied');
  assert.equal(store.apply(operation('op-2', 2, 9, 'phone-a', 1)).status, 'applied');
  const lost = store.apply(operation('op-3', 1, 6, 'phone-z', 99999999999));
  assert.equal(lost.id, 'op-3');
  assert.equal(lost.status, 'rejected');
  assert.equal(lost.row.reps, 9);
  assert.equal(store.get('set', 'set-1').reps, 9);
  const edits = store.rows('set_edit');
  assert.ok(edits.some(x => x.field === 'reps' && x.old_value === 8 && x.new_value === 9 && x.reason === 'overwritten'));
  assert.ok(edits.some(x => x.field === 'reps' && x.old_value === 9 && x.new_value === 6 && x.reason === 'rejected'));
});

test('equal revisions use device IDs and each operation receives a final answer', t => {
  const store = setup(t);
  store.apply(operation('a', 1, 8));
  assert.equal(store.apply(operation('b', 1, 9, 'phone-b')).status, 'applied');
  assert.equal(store.apply(operation('c', 1, 7)).status, 'rejected');
  assert.equal(store.get('set', 'set-1').reps, 9);
  assert.equal(store.apply(operation('d', 1, 10, 'phone-b')).status, 'rejected');
});

test('retries survive restart and do not add changes or audit entries', t => {
  const dir = mkdtempSync(join(tmpdir(), 'workout-sync-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'test.sqlite');
  let store = new Store(path);
  const first = operation('a', 1, 8);
  store.apply(first);
  store.apply(operation('b', 2, 9));
  const before = store.changes(0);
  store.close();
  store = setup(t, path);
  const retry = store.apply(first);
  assert.equal(retry.status, 'duplicate');
  assert.equal(retry.row.reps, 9);
  assert.deepEqual(store.changes(0), before);
  assert.throws(() => store.apply(operation('a', 1, 10)), /operation ID/);
});

test('cursor 0 includes each latest row and tombstones; deletes hide live rows', t => {
  const store = setup(t);
  store.apply(operation('a', 1, 8));
  const cursor = store.changes(0).cursor;
  store.apply(operation('b', 2, 9));
  const del = operation('c', 3, 9);
  del.row.deleted_at = 2000;
  store.apply(del);
  assert.equal(store.rows('set').length, 0);
  const sets = store.changes(cursor).rows.filter(x => x.table === 'set');
  assert.equal(sets.length, 1);
  assert.equal(sets[0].row.deleted_at, 2000);
  const all = store.changes(0);
  assert.equal(new Set(all.rows.map(x => `${x.table}/${x.row.id}`)).size, all.rows.length);
  assert.deepEqual(store.changes(all.cursor), { rows: [], cursor: all.cursor, more: false });
});

test('untrusted tables, metadata and domain fields fail before any write', t => {
  const store = setup(t);
  const invalid = [
    x => { x.table = 'set; DROP TABLE exercise'; },
    x => { x.row.rev = 0; },
    x => { x.row.reps = -1; },
    x => { x.row.unit = 'stone'; },
    x => { x.row.grams = 1.5; },
    x => { x.row.local_date = '2026-02-30'; },
    x => { x.row.extra = true; },
    x => { x.row.reps_left = 6; },
    x => { x.row.device_id = ''; },
    x => { x.table = 'set_edit'; },
  ];
  for (const alter of invalid) {
    const op = operation('bad', 1, 8);
    alter(op);
    assert.throws(() => store.apply(op));
  }
  assert.deepEqual(store.changes(0), { rows: [], cursor: 0, more: false });
  assert.throws(() => store.changes(-1));
});

test('paged changes have ordered cursors and equal one large download, including deletes', t => {
  const store=setup(t);
  for(let i=0;i<1100;i++)store.apply({id:`page-${i}`,table:'setting',row:{id:`page-${i}`,rev:1,device_id:'fixture',updated_at:1,deleted_at:i%3===0?1:null,value:i}});
  const first=store.changes(0);
  assert.equal(first.more,true);assert.ok(first.rows.length<=500);
  const collected=[];let cursor=0,more=true;
  while(more){const page=store.changes(cursor);assert.ok(page.cursor>cursor);assert.equal(page.cursor,page.rows.at(-1).row.seq);collected.push(...page.rows);cursor=page.cursor;more=page.more;}
  assert.deepEqual(collected,store.changes(0,2000).rows);
});
