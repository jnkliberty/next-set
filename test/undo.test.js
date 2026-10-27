import test from 'node:test';
import assert from 'node:assert/strict';
import { inverse } from '../domain/undo.js';

const lookup = data => (table, id) => (data[table] || []).find(row => row.id === id);

test('inverse restores changed fields and deletes created rows', () => {
  const data = { session: [{ id: 's1', status: 'open', ended_at: null, note: 'kept' }], run_event: [] };
  const changes = [
    { table: 'session', row: { id: 's1', status: 'finished_early', ended_at: 5 } },
    { table: 'run_event', row: { id: 'e1', kind: 'done' } },
    { table: 'session', row: { id: 's1', note: 'changed' } },
  ];
  assert.deepEqual(inverse(lookup(data), changes, 9), [
    { table: 'session', row: { id: 's1', status: 'open', ended_at: null, note: 'kept' } },
    { table: 'run_event', row: { id: 'e1', deleted_at: 9 } },
  ]);
});

test('inverse of a delete brings the row back', () => {
  const data = { set: [{ id: 'x', deleted_at: null, reps: 8 }] };
  assert.deepEqual(inverse(lookup(data), [{ table: 'set', row: { id: 'x', deleted_at: 3 } }]), [{ table: 'set', row: { id: 'x', deleted_at: null } }]);
});
