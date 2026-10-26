import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionFlow } from '../domain/session-flow.js';
import { editWorkout, withChanges } from '../domain/edits.js';

function fixture() {
  const slots = ['a', 'b', 'c'].map((id, position) => ({ id, session_id: 'now', position, planned_exercise_id: id, exercise_id: id, rest_seconds: position ? 120 : 60, group_id: position < 2 ? 'pair' : null, group_kind: position < 2 ? 'superset' : null }));
  const sets = slots.flatMap(slot => [0, 1].map(position => ({ id: `${slot.id}${position + 1}`, session_slot_id: slot.id, position, type: 'working', done_at: null })));
  return { slots, sets };
}

test('a superset alternates by round, rests for its longest member and stops resting after the final set', () => {
  const { slots, sets } = fixture();
  for (const [i, id] of ['a1', 'b1', 'a2', 'b2', 'c1', 'c2'].entries()) {
    assert.equal(sessionFlow(slots, sets).next.id, id);
    sets.find(set => set.id === id).done_at = (i + 1) * 1000;
    const flow = sessionFlow(slots, sets);
    assert.equal(flow.rest?.seconds ?? 0, [0, 120, 0, 120, 120, 0][i]);
  }
  assert.equal(sessionFlow(slots, sets).next, undefined);
});

test('manual order, Undo, skipped members and unequal counts use actual saved rows', () => {
  const { slots, sets } = fixture(), flow = () => sessionFlow(slots, sets);
  sets.find(set => set.id === 'b1').done_at = 1000;
  assert.equal(flow().next.id, 'a1'); assert.equal(flow().rest, null);
  sets.find(set => set.id === 'a1').done_at = 2000;
  assert.equal(flow().next.id, 'a2'); assert.equal(flow().rest.end, 122000);
  sets.find(set => set.id === 'b1').done_at = null;
  assert.equal(flow().next.id, 'b1'); assert.equal(flow().rest, null);
  for (const set of sets.filter(set => set.session_slot_id === 'b')) set.deleted_at = 3000;
  assert.equal(flow().next.id, 'a2'); assert.equal(flow().rest.seconds, 120);
  sets.find(set => set.id === 'a2').done_at = 4000;
  assert.equal(flow().next.id, 'c1');
});

test('warmups stay outside rounds; unsupported chains and ungrouped slots keep ordinary order', () => {
  const { slots, sets } = fixture();
  sets.unshift({ id: 'warmup', session_slot_id: 'a', position: -1, type: 'warmup', done_at: null });
  assert.equal(sessionFlow(slots, sets).next.id, 'warmup');
  sets[0].done_at = 1; sets.find(set => set.id === 'a1').done_at = 2;
  assert.equal(sessionFlow(slots, sets).next.id, 'b1'); assert.equal(sessionFlow(slots, sets).rest, null);
  sets.find(set => set.id === 'b2').type = 'drop';
  assert.equal(sessionFlow(slots, sets).next.id, 'a2'); assert.equal(sessionFlow(slots, sets).rest.seconds, 60);
  for (const slot of slots) slot.group_kind = 'compound';
  assert.equal(sessionFlow(slots, sets).next.id, 'a2');
});

test('a partial swap preserves the member round and logged work despite tied slot positions', () => {
  const { slots, sets } = fixture(); sets[0].done_at = 1000;
  const data = { session_slot: slots, set: sets, exercise: ['a', 'b', 'c', 'replacement'].map(id => ({ id, name: id, equipment: 'barbell' })), session: [{ id: 'now', status: 'open', local_date: '2026-10-25' }], setting: [] };
  const edited = editWorkout(data, { session: data.session[0], slot: slots[0], action: 'swap', exerciseId: 'replacement' });
  const after = withChanges(data, edited.changes), flow = () => sessionFlow(after.session_slot, after.set);
  assert.equal(after.set.find(set => set.id === 'a1').done_at, 1000);
  assert.equal(flow().next.id, 'b1');
  after.set.find(set => set.id === 'b1').done_at = 2000;
  const replacement = after.session_slot.find(slot => slot.exercise_id === 'replacement');
  assert.equal(flow().next.session_slot_id, replacement.id);
  assert.equal(flow().rest.seconds, 120);
  assert.equal(flow().memberNumbers.get('a'), flow().memberNumbers.get(replacement.id));
  assert.equal(sessionFlow([...after.session_slot].reverse(), [...after.set].reverse()).next.id, flow().next.id);
});
