import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressData, progressRange, areaWork, liftSeries } from '../domain/progress.js';

function fixture() {
  const data = { exercise: [
    { id: 'squat', name: 'Squat', primary: ['quadriceps', 'glutes'], secondary: ['hamstrings', 'lower back'], weight_basis: 'total', equipment: 'barbell' },
    { id: 'alias', name: 'Old squat name', merged_into: 'squat' },
    { id: 'assist', name: 'Assisted pull-up', primary: ['lats'], secondary: ['biceps'], weight_basis: 'assisted', equipment: 'machine' },
    { id: 'hold', name: 'Plank', primary: ['abdominals'], secondary: [], weight_basis: 'total', equipment: 'bodyweight' },
  ], session: [], session_slot: [], set: [], setting: [{ id: 'bodyweight', value: 95000 }] };
  function add(id, date, exercise, sets, extra = {}) {
    data.session.push({ id, local_date: date, started_at: Date.parse(`${date}T23:30:00Z`), ended_at: Date.parse(`${date}T23:50:00Z`), status: 'done', source: 'app', ...extra });
    data.session_slot.push({ id, session_id: id, exercise_id: exercise });
    sets.forEach((set, i) => data.set.push({ id: `${id}-${i}`, session_slot_id: id, position: i, type: 'working', done_at: 1, weight: 100, unit: 'kg', reps: 6, reps_left: 2, ...set }));
  }
  return { data, add };
}

test('progress dates, totals and hard chains retain completed work without double counting area tags', () => {
  const { data, add } = fixture();
  add('a', '2026-10-01', 'alias', [{}, { type: 'drop', weight: 50 }, { type: 'warmup' }, { deleted_at: 2 }]);
  add('b', '2026-10-01', 'squat', [{}], { status: 'finished_early', off: true });
  add('open', '2026-10-02', 'squat', [{}], { status: 'open' });
  add('gone', '2026-10-02', 'squat', [{}], { deleted_at: 1 });
  add('old', '2026-09-30', 'squat', [{}]);
  const result = progressData(data, '2026-10-01', '2026-10-07');
  assert.equal(result.days.length, 7);
  assert.deepEqual(result.totals, { sessions: 2, sets: 3, hardSets: 2, minutes: 40, volumeKg: 1500, incompleteVolume: false });
  assert.equal(result.openSessions, 1);
  assert.equal(result.lifts.length, 1);
  assert.equal(result.lifts[0].id, 'squat');
  assert.equal(areaWork(result, 'Legs')[0].sets, 2);
  assert.equal(areaWork(result, 'Legs', true)[0].sets, 2);
  assert.equal(areaWork(result, 'Back')[0].sets, 0);
  assert.equal(areaWork(result, 'Back', true)[0].sets, 1);
  assert.equal(areaWork(result, 'All areas', true)[0].sets, 2);
  assert.equal(liftSeries(result.lifts[0], 'estimate').length, 1, 'off sessions remain in history, not normal strength');
  assert.deepEqual(result.days[0].sessionIds, ['a', 'b']);
});

test('strength normalizes units, keeps session dates and excludes unreviewed imports and missing loads', () => {
  const { data, add } = fixture();
  add('kg', '2026-10-01', 'squat', [{ weight: 45.359237 }]);
  add('lb', '2026-10-11', 'alias', [{ weight: 100, unit: 'lb' }]);
  add('same-day', '2026-10-11', 'squat', [{ weight: 50 }]);
  add('missing', '2026-10-12', 'squat', [{ weight: null }]);
  add('import', '2026-10-13', 'squat', [{ weight: 200 }], { source: 'stoppani' });
  const result = progressData(data, '2026-10-01', '2026-10-13');
  const points = liftSeries(result.lifts[0], 'estimate');
  assert.equal(points.length, 3);
  assert.ok(Math.abs(points[0].value - points[1].value) < 1e-6);
  assert.equal(points[1].time - points[0].time, 864000000);
  assert.equal(points[1].time, points[2].time);
  assert.equal(result.provisionalSessions, 1);
  assert.equal(result.totals.incompleteVolume, true);
  assert.equal(result.lifts[0].records.length, 5, 'original sets remain reachable');
});

test('assistance never uses current body weight to rewrite history and timed lifts retain their records', () => {
  const { data, add } = fixture();
  add('unknown-weight', '2026-10-01', 'assist', [{ weight: 20 }]);
  add('less-assist', '2026-10-02', 'assist', [{ weight: 20, bodyweight_grams: 80000 }]);
  add('more-assist', '2026-10-03', 'assist', [{ weight: 30, bodyweight_grams: 80000 }]);
  add('timed', '2026-10-04', 'hold', [{ type: 'timed', seconds: 45, reps: null, weight: null }]);
  const result = progressData(data, '2026-10-01', '2026-10-07');
  const points = liftSeries(result.lifts.find(row => row.id === 'assist'), 'estimate');
  assert.equal(points.length, 2);
  assert.ok(points[1].value < points[0].value);
  const timed = result.lifts.find(row => row.id === 'hold');
  assert.equal(liftSeries(timed, 'seconds')[0].value, 45);
  assert.equal(liftSeries(timed, 'estimate').length, 0);
});

test('empty, sparse, deleted-slot and unmapped histories have explicit dates and no invented strength', () => {
  const { data, add } = fixture();
  assert.deepEqual(progressRange('12w', '2026-10-26', '2020-01-01'), ['2026-08-04', '2026-10-26']);
  assert.deepEqual(progressRange('all', '2026-10-26', '2020-01-01'), ['2020-01-01', '2026-10-26']);
  assert.deepEqual(progressRange('all', '2026-10-26', '2026-10-27'), ['2026-10-26', '2026-10-26']);
  add('one', '2026-10-01', 'unknown', [{ weight: 10 }]);
  add('deleted-slot', '2026-10-02', 'squat', [{}]);
  data.session_slot[1].deleted_at = 1;
  const result = progressData(data, '2026-10-01', '2026-10-07');
  assert.equal(result.lifts.length, 1);
  assert.deepEqual(result.lifts[0].primaryAreas, ['Other']);
  assert.equal(liftSeries(result.lifts[0], 'estimate').length, 0);
  assert.equal(areaWork(result, 'Other')[0].sets, 1);
  assert.equal(progressData({}, '2026-10-01', '2026-10-07').totals.sessions, 0);
});
