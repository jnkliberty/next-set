import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sessions from '../domain/session.js';
import { carryForward, LB_TO_KG } from '../domain/targets.js';
import { withChanges } from '../domain/edits.js';
import { projectCalendar } from '../domain/calendar.js';
import { integrationRecord } from '../domain/integration-record.js';
import { targetReason } from '../domain/targets.js';
import { inverse } from '../domain/undo.js';

function fixture() {
  return { exercise:[{id:'e',name:'Example Press',equipment:'barbell'}],
    session:[{id:'old',started_at:Date.parse('2026-01-01T18:00:00Z'),local_date:'2026-01-01'}],
    session_slot:[{id:'old-slot',session_id:'old',exercise_id:'e',position:0}],
    set:[{id:'old-set',session_slot_id:'old-slot',position:0,type:'working',weight:50,unit:'lb',reps:5,done_at:1,target_reps_min:4,target_reps_max:6}],setting:[] };
}

test('pound weights stay in pounds in carry-forward and the next session targets',()=>{
  const data=fixture(), previous=data.set[0];
  const carried=carryForward({...previous,weight:22,unit:'kg',done_at:null},previous);
  assert.equal(carried.unit,'lb');assert.equal(carried.weight,50);
  const changes=sessions.instantiateSlot(data,{id:'new',local_date:'2026-01-02'},{exercise_id:'e',position:0},[{position:0,type:'working',reps_min:4,reps_max:6}],Date.parse('2026-01-02T18:00:00Z'));
  const set=changes.find(change=>change.table==='set').row;
  assert.equal(set.unit,'lb');assert.equal(set.weight,50);assert.equal(set.reps,6);
  assert.equal(set.grams,Math.round(50*LB_TO_KG*1000));
  assert.equal(changes.find(change => change.row.id === `target-reason:${set.id}`).row.value.code, 'add_rep');
});

test('a manual correction explains carry-forward without changing any set values', () => {
  assert.equal(typeof sessions.carryForwardReasonChanges, 'function');
  const base = { session_slot_id: 'slot', type: 'working', weight: 50, unit: 'kg', reps: 4, target_weight: 50, target_reps_min: 4, target_reps_max: 6, done_at: null };
  const sets = [0, 1, 2].map(position => ({ ...base, id: `set-${position}`, position }));
  const logged = { ...sets[0], weight: 55, reps: 5, grams: 55000, done_at: 1 };
  const changes = sessions.carryForwardReasonChanges(sets, logged);
  const updated = withChanges({ set: sets, setting: [] }, changes);
  assert.deepEqual(updated.set, sets);
  assert.equal(updated.setting[0].value.weight, carryForward(sets[1], logged).weight);
  assert.equal(updated.setting[0].value.reps, carryForward(sets[1], logged).reps);
  assert.equal(updated.setting[0].value.code, 'set_correction');
  assert.equal(targetReason(sets[1], updated.setting[0], new Map([[logged.id, logged]])).weight, 55);
  assert.equal(targetReason(sets[1], updated.setting[0], new Map([[logged.id, { ...logged, done_at: null }]])), null);
  assert.equal(targetReason(sets[1], updated.setting[0], new Map([[logged.id, { ...logged, weight: 60 }]])), null);
  sets[1] = { ...sets[1], done_at: 2, weight: 60 };
  assert.deepEqual(sessions.carryForwardReasonChanges(sets, logged), []);
});

test('return choices keep numeric targets and save their matching reason in the same change batch', () => {
  const original = fixture(), session = { id: 'new', status: 'open', local_date: '2026-01-21' };
  const created = sessions.instantiateSlot(original, session, { exercise_id: 'e', position: 0 }, [{ position: 0, type: 'working', reps_min: 4, reps_max: 6 }], Date.parse('2026-01-21T18:00:00Z'));
  const data = withChanges({ ...original, session: [...original.session, session] }, created), slot = data.session_slot.at(-1);
  for (const [reduction, expected, code] of [[0, 50, 'return_same'], [0.05, 45, 'return_5'], [0.1, 45, 'return_10']]) {
    const after = withChanges(data, sessions.returnTargetChanges(data, slot, reduction)), set = after.set.at(-1);
    const reason = targetReason(set, after.setting.find(row => row.id === `target-reason:${set.id}`));
    assert.equal(set.weight, expected); assert.equal(set.target_weight, expected); assert.equal(reason.code, code); assert.equal(reason.weight, expected);
  }
});

test('deleting or skipping a set removes its explanation and Undo restores both', () => {
  const original = fixture(), session = { id: 'new', status: 'open', local_date: '2026-01-02' };
  const created = sessions.instantiateSlot(original, session, { exercise_id: 'e', position: 0 }, [{ position: 0, type: 'working', reps_min: 4, reps_max: 6 }], Date.parse('2026-01-02T18:00:00Z'));
  const data = withChanges({ ...original, session: [...original.session, session] }, created), slot = data.session_slot.at(-1), set = data.set.at(-1);
  for (const changes of [sessions.skipRemainingChanges(data, session, slot), sessions.deleteSessionChanges(data, session)]) {
    const removed = withChanges(data, changes);
    assert.equal(targetReason(set, removed.setting.find(row => row.id === `target-reason:${set.id}`)), null);
    const restored = withChanges(removed, inverse((table, id) => data[table]?.find(row => row.id === id), changes));
    assert.equal(targetReason(restored.set.at(-1), restored.setting.find(row => row.id === `target-reason:${set.id}`)).code, 'add_rep');
  }
});

test('first log dates every set to the training day, then keeps that date after midnight',()=>{
  assert.equal(typeof sessions.startChanges,'function','First log must date a pre-opened session');
  const data={session_slot:[{id:'slot',session_id:'new'}],set:[{id:'a',session_slot_id:'slot',done_at:null},{id:'b',session_slot_id:'slot',done_at:null}]};
  const session={id:'new',local_date:'2026-01-01',started_at:1};
  const changes=sessions.startChanges(data,session,Date.parse('2026-01-03T05:30:00Z'));
  assert.deepEqual(changes.map(change=>[change.table,change.row.id,change.row.local_date]),[['session','new','2026-01-02'],['set','a','2026-01-02'],['set','b','2026-01-02']]);
  assert.equal(changes[0].row.started_at,Date.parse('2026-01-03T05:30:00Z'));
  data.set[0].done_at=1;
  assert.deepEqual(sessions.startChanges(data,{...session,local_date:'2026-01-02'},Date.parse('2026-01-03T07:00:00Z')),[]);
});

test('a swapped slot keeps its original planned exercise',()=>{
  const changes=sessions.instantiateSlot(fixture(),{id:'new',local_date:'2026-01-02'},{exercise_id:'e',planned_exercise_id:'original',position:0},[],Date.parse('2026-01-02T18:00:00Z'));
  assert.equal(changes[0].row.planned_exercise_id,'original');
});

test('new sessions save an immutable as-started plan record by slot', () => {
  const data = { exercise: [{ id: 'e', name: 'Fixture Press', equipment: 'barbell', primary: ['chest'], secondary: [], weight_basis: 'total', conditioning: false }], slot: [{ id: 'template-slot', program_day_id: 'd', exercise_id: 'e', position: 0 }], slot_set: [{ id: 'plan', slot_id: 'template-slot', position: 0, type: 'working', reps_min: 4, reps_max: 6, target_effort: 8 }], session: [], session_slot: [], set: [], setting: [], run: [], program_day: [], run_event: [] };
  const created = sessions.createSession(data, { id: 'd' }, null, Date.parse('2026-01-02T18:00:00Z'));
  const event = created.changes.find(change => change.table === 'event'), target = created.changes.find(change => change.table === 'set').row;
  const original = integrationRecord(event.row);
  assert.equal(original.recordType, 'original_plan'); assert.equal(event.row.kind, 'shown'); assert.equal(original.targets.length, 1);
  assert.deepEqual(original.targets[0], { position: 0, type: 'working', repsMin: 4, repsMax: 6, seconds: null, weight: target.target_weight, effort: 8 });
});

function resultsFixture() {
  return { exercise: [{ id: 'e', name: 'Example Press', equipment: 'barbell', weight_basis: 'total' }],
    program_day: [{ id: 'd0', program_id: 'p', position: 0, day: 1 }, { id: 'd1', program_id: 'p', position: 1, day: 1 }, { id: 'd2', program_id: 'p', position: 2, day: 2 }],
    run: [{ id: 'r', program_id: 'p', next_position: 2, status: 'active' }],
    session: [{ id: 'prior', run_id: 'r', program_day_id: 'd0', status: 'done', started_at: 100, ended_at: 60100 }, { id: 'now', run_id: 'r', program_day_id: 'd1', status: 'open', started_at: 200000, ended_at: 320000 }],
    session_slot: [{ id: 'prior-slot', session_id: 'prior', exercise_id: 'e' }, { id: 'now-slot', session_id: 'now', exercise_id: 'e' }],
    set: [{ id: 'prior-set', session_slot_id: 'prior-slot', type: 'working', weight: 50, unit: 'kg', reps: 8, target_reps_min: 8, target_reps_max: 10, done_at: 101 },
      { id: 'logged', session_slot_id: 'now-slot', type: 'working', weight: 55, unit: 'kg', reps: 8, target_reps_min: 8, target_reps_max: 10, done_at: 200001 },
      { id: 'pending', session_slot_id: 'now-slot', type: 'working', done_at: null }],
    run_event: [{ id: 'done:prior', run_id: 'r', kind: 'done', position: 0, session_id: 'prior' }], setting: [] };
}

test('skip removes only pending sets and finishes when no other sets remain', () => {
  const data = resultsFixture(), session = data.session[1];
  const changes = sessions.skipRemainingChanges(data, session, data.session_slot[1], 400000);
  assert.deepEqual(changes.filter(change => change.table === 'set'), [{ table: 'set', row: { id: 'pending', deleted_at: 400000 } }]);
  assert.equal(changes.find(change => change.table === 'session').row.status, 'done');
  data.session_slot.push({ id: 'other', session_id: 'now' });
  data.set.push({ id: 'other-set', session_slot_id: 'other', done_at: null });
  assert.equal(sessions.skipRemainingChanges(data, session, data.session_slot[1], 400000).some(change => change.table === 'session'), false);
});

test('finish skips omitted workout positions but an extra workout never advances its run', () => {
  const data = resultsFixture();
  data.run_event.push({ id: 'omit', run_id: 'r', kind: 'skipped', position: 2 });
  const changes = sessions.finishChanges(data, data.session[1], 400000);
  assert.deepEqual(changes.find(change => change.table === 'run').row, { id: 'r', next_position: 3, status: 'done' });
  assert.deepEqual(sessions.finishChanges(data, { ...data.session[1], program_day_id: null }, 400000), [{ table: 'session', row: { id: 'now', status: 'done', ended_at: 400000 } }]);
});

test('finishing a workout keeps a paused run and its open leave, including the final workout', () => {
  for (const final of [false, true]) {
    const data = resultsFixture();
    data.run[0] = { ...data.run[0], status: 'paused', start_date: '2026-10-01' };
    data.run_event.push({ id: 'leave', run_id: 'r', kind: 'leave', local_date: '2026-10-20' });
    if (final) data.run_event.push({ id: 'previous', run_id: 'r', kind: 'done', position: 1 });
    const session = { ...data.session[1], program_day_id: final ? 'd2' : 'd1' };
    const changes = sessions.finishChanges(data, session, 400000);
    assert.deepEqual(changes.find(change => change.table === 'run').row, { id: 'r', next_position: final ? 3 : 2, status: 'paused' });
    const after = withChanges(data, changes);
    assert.equal(projectCalendar(after, after.run[0], '2026-10-26', '2026-10-26', '2026-10-25')[0].state, 'leave');
  }
});

test('delete removes only this workout and keeps later workouts in place', () => {
  const data = resultsFixture();
  data.run_event.push({ id: 'done:now', run_id: 'r', kind: 'done', position: 1, session_id: 'now' }, { id: 'added', run_id: 'r', kind: 'added', session_id: 'now' });
  const changes = sessions.deleteSessionChanges(data, data.session[1], 400000);
  assert.deepEqual(changes.filter(change => change.row.deleted_at).map(change => change.row.id).sort(), ['added', 'done:now', 'logged', 'now', 'now-slot', 'pending']);
  assert.equal(changes.some(change => change.table === 'run'), false);
  const skipped = changes.find(change => change.table === 'run_event' && change.row.kind === 'skipped');
  assert.equal(skipped.row.position, 1); assert.equal(skipped.row.session_id, null);
  const after = withChanges(data, changes);
  assert.deepEqual(after.run, data.run);
  const later = sessions.finishChanges(after, { id: 'later', run_id: 'r', program_day_id: 'd2' }, 500000);
  assert.deepEqual(later.find(change => change.table === 'run').row, { id: 'r', next_position: 3, status: 'done' });
  data.run_event.push({ id: 'another-completion', run_id: 'r', kind: 'done', position: 1, session_id: 'another' });
  const duplicate = sessions.deleteSessionChanges(data, data.session[1], 400000);
  assert.equal(duplicate.some(change => change.table === 'run'), false);
  assert.equal(duplicate.some(change => change.row.kind === 'skipped'), false);
});

test('off sessions count as records but do not produce progression targets', () => {
  const data = resultsFixture(); data.session[1].off = true;
  assert.equal(sessions.workoutResults(data, data.session[1]).bests[0].set.id, 'logged');
  assert.deepEqual(sessions.workoutResults(data, data.session[1]).next, []);
  data.session[1].off = false; data.session[0].off = true;
  assert.equal(sessions.workoutResults(data, data.session[1]).bests[0].set.id, 'logged');
});

test('results compare completed work and award a best only against an earlier matching range', () => {
  const data = resultsFixture(), result = sessions.workoutResults(data, data.session[1]);
  assert.equal(result.logged, 1); assert.equal(result.total, 2); assert.equal(result.volumeKg, 440);
  assert.equal(result.comparison.percent, 10); assert.equal(result.bests[0].set.id, 'logged');
  data.set[0].target_reps_min = 4;
  assert.equal(sessions.workoutResults(data, data.session[1]).bests.length, 0);
  assert.equal(sessions.workoutResults(data, data.session[1]).comparison, null);
});

test('exercise history normalizes units, excludes unlogged sets and separates rep ranges', () => {
  const data = resultsFixture();
  data.set[0] = { ...data.set[0], weight: 150, unit: 'lb' };
  data.set.push({ id: 'warmup', session_slot_id: 'now-slot', type: 'warmup', weight: 100, unit: 'kg', reps: 2, done_at: 200001 });
  const history = sessions.exerciseHistory(data, 'e', [8, 10]);
  assert.equal(history.rows.length, 2); assert.equal(history.rows[0].sets.length, 1);
  assert.equal(history.rows[0].best.id, 'prior-set'); assert.equal(history.heaviestKg, 150 * LB_TO_KG);
  assert.equal(sessions.exerciseHistory(data, 'e', [4, 6]).rows.length, 0);
  data.set[1].weight = 200; data.set[1].reps = 1;
  assert.equal(sessions.exerciseHistory(data, 'e', [8, 10]).best.id, 'prior-set');
  assert.equal(sessions.workoutResults(data, data.session[1]).bests.length, 0);
});

test('unknown body weight leaves volume unavailable instead of counting missing loads as zero', () => {
  const data = resultsFixture(); data.exercise[0].weight_basis = 'added_to_bodyweight';
  assert.equal(sessions.workoutResults(data, data.session[1]).volumeKg, null);
  assert.equal(sessions.workoutResults(data, data.session[1]).comparison, null);
  assert.equal(sessions.exerciseHistory(data, 'e').rows[0].volumeKg, null);
});
