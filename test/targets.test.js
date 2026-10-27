import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weightGrid, nextTarget, carryForward, returnChoice, findReference } from '../domain/targets.js';
import * as targets from '../domain/targets.js';

test('saved reasons explain the original target and disappear when its target fields change', () => {
  assert.equal(typeof targets.targetReasonChange, 'function');
  const set = { id: 's', type: 'working', unit: 'kg', target_weight: 112.5, target_reps_min: 4, target_reps_max: 6, reps: 4 };
  const change = targets.targetReasonChange(set, 'next_weight');
  assert.equal(change.table, 'setting'); assert.equal(change.row.id, 'target-reason:s');
  assert.equal(targets.targetReason({ ...set, weight: 115, reps: 5, done_at: 1 }, change.row).code, 'next_weight');
  assert.equal(targets.targetReason({ ...set, target_weight: 110 }, change.row), null);
  assert.equal(targets.targetReason(set, { ...change.row, deleted_at: 1 }), null);
  assert.equal(targets.targetReason(set, { ...change.row, value: { ...change.row.value, code: 'invented' } }), null);
  assert.equal(targets.targetReason(set, null), null);
});

test('an older client carry-forward change hides an outdated explanation instead of inventing a reason', () => {
  const set = { id: 'pending', session_slot_id: 'slot', position: 1, type: 'working', weight: 50, unit: 'kg', reps: 4, target_weight: 50, target_reps_min: 4, target_reps_max: 6 };
  const old = targets.targetReasonChange(set, 'next_weight').row;
  const prior = { ...set, id: 'earlier', position: 0, weight: 55, done_at: 1 }, index = new Map([[prior.id, prior]]);
  assert.equal(targets.targetReason(set, old, index), null);
  const current = targets.targetReasonChange(set, 'added_set', carryForward(set, prior), prior).row;
  assert.equal(targets.targetReason(set, current, index).weight, 55);
});

test('double progression, a large equipment jump, effort brakes and voluntary heavy sets', () => {
  const grid = weightGrid('barbell', 'kg', [110]);
  const range = [4, 6];
  const ref = Array.from({ length: 3 }, () => ({ weight: 110, reps: 6 }));
  assert.deepEqual(nextTarget(ref, range, grid), { weight: 112.5, reps: 4, reason: 'next_weight' });
  assert.deepEqual(nextTarget([{ weight: 40, reps: 6 }, { weight: 40, reps: 5 }], range, weightGrid('barbell')), { weight: 40, reps: 6, reason: 'add_rep' });
  assert.deepEqual(nextTarget([{ weight: 10, reps: 12 }], [10, 12], weightGrid('dumbbell')), { weight: 10, reps: 13, reason: 'jump_too_large' });
  assert.deepEqual(nextTarget([{ weight: 110, reps: 2 }], range, grid), { weight: 110, reps: 3, reason: 'add_rep' });
  assert.equal(nextTarget([{ weight: 110, reps: 6, reps_left: 0, type: 'working' }], range, grid).reason, 'effort_brake');
  assert.equal(nextTarget([{ weight: 110, reps: 6, reps_left: 0, type: 'failure', target_effort: 10 }], range, grid).reason, 'next_weight');
  assert.equal(nextTarget([{ weight: 110, reps: 6, target_effort: 8, reps_left: 1 }], range, grid).reason, 'effort_brake');
});

test('progression reads the completed sets of a shortened session without a missing-set failure penalty', () => {
  const grid = weightGrid('barbell', 'kg', [110]);
  const shortened = [{ weight: 110, reps: 6, type: 'working', reps_left: null }];
  assert.deepEqual(nextTarget(shortened, [4, 6], grid), { weight: 112.5, reps: 4, reason: 'next_weight' });
  assert.equal(nextTarget([{ ...shortened[0], reps_left: 0 }], [4, 6], grid).reason, 'effort_brake');
});

test('learned weights extend and arbitrary typed weights need no global lattice', () => {
  const grid = weightGrid('dumbbell', 'kg', [20, 25, 30]);
  assert.equal(grid.step(25, 1), 30);
  assert.equal(grid.step(30, 1), 32.5);
  assert.equal(grid.step(20, -1), 17.5);
  assert.equal(grid.step(27, 1), 30);
  assert.equal(grid.step(0, -1), 0);
  assert.equal(grid.taps(20, 27), 2);
  assert.equal(weightGrid('barbell').step(45.36, 1), 47.5);
  assert.equal(weightGrid('machine').step(10, 1), 15);
});

test('carry forward copies only same-range working sets and a return never changes weights on its own', () => {
  const target = { type: 'working', target_reps_min: 4, target_reps_max: 6, weight: 110, reps: 6 };
  const previous = { ...target, done_at: 1, weight: 105, reps: 7 };
  assert.equal(carryForward(target, previous).weight, 105);
  assert.equal(carryForward({ ...target, type: 'drop' }, previous).weight, 110);
  assert.equal(carryForward({ ...target, target_reps_min: 8 }, previous).weight, 110);
  assert.equal(returnChoice(14), null);
  assert.deepEqual(returnChoice(20), { days: 20, recommended: 0.05, choices: [0, 0.05, 0.1] });
  assert.equal(returnChoice(29).recommended, 0.1);
});

test('references prefer any-program same range; fallback copies raw numbers and ignores off sessions', () => {
  const rows = [
    { exercise_id: 'e', session_id: 'a', started_at: 10, range: [4, 6], sets: [{ weight: 100, reps: 6 }] },
    { exercise_id: 'e', session_id: 'b', started_at: 20, range: [4, 6], sets: [{ weight: 105, reps: 5 }] },
    { exercise_id: 'e', session_id: 'c', started_at: 30, range: [8, 10], sets: [{ weight: 80, reps: 10 }] },
    { exercise_id: 'e', session_id: 'd', started_at: 40, off: true, range: [4, 6], sets: [{ weight: 110, reps: 6 }] },
  ];
  assert.equal(findReference(rows, 'e', [4, 6], 50).row.session_id, 'b');
  const fallback = findReference(rows, 'e', [2, 3], 50);
  assert.equal(fallback.kind, 'other_range');
  assert.deepEqual(fallback.row.sets[0], { weight: 80, reps: 10 });
  assert.equal(findReference(rows, 'unknown', [4, 6], 50).kind, 'none');
});
