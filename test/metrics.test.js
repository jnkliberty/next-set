import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adherence, dailySummary, estimatedMax, compareSet, loadKg, progressMark, typicalError } from '../domain/metrics.js';
import { LB_TO_KG } from '../domain/targets.js';

test('adherence uses the run in force, prorates weekdays and excludes extra sessions',()=>{
  const data={run:[{id:'a',start_date:'2026-09-01'},{id:'b',start_date:'2026-10-01'}],run_setting:[
    {run_id:'a',from_date:'2026-09-01',weekly_target:4,weekdays:[1,2,4,5]},
    {run_id:'b',from_date:'2026-10-01',weekly_target:4,weekdays:[1,2,4,5]}
  ],session:[5,6,8,9].map(n=>({id:`s${n}`,run_id:'b',program_day_id:'fixture-day',status:'done',local_date:`2026-10-0${n}`})),run_event:[]};
  assert.deepEqual(adherence(data,'2026-10-04','2026-10-10'),{done:4,target:4,ratio:1});
  assert.deepEqual(adherence(data,'2026-10-07','2026-10-10'),{done:2,target:2,ratio:1});
  data.session.push({id:'extra',run_id:'b',program_day_id:null,status:'done',local_date:'2026-10-09'});
  data.session.push({id:'added-day',run_id:'b',program_day_id:'fixture-day',status:'done',local_date:'2026-10-09'});
  data.run_event.push({run_id:'b',kind:'added',session_id:'added-day',local_date:'2026-10-09'});
  assert.equal(adherence(data,'2026-10-07','2026-10-10').done,2);
});

test('daily contract adds rated and unrated sessions, counts chains once and excludes conditioning', () => {
  const data = {
    exercise: [{ id: 'press', primary: ['chest'], secondary: ['triceps'], weight_basis: 'per_hand' }, { id: 'squat', primary: ['quadriceps'], secondary: [], weight_basis: 'total' }, { id: 'bike', primary: [], secondary: [], conditioning: true }],
    session: [{ id: 'a', local_date: '2026-01-01', status: 'done', started_at: 0, ended_at: 600000, effort: 7 }, { id: 'b', local_date: '2026-01-01', status: 'done', started_at: 1200000, ended_at: 1800000, effort: null }],
    session_slot: [{ id: 'pa', session_id: 'a', exercise_id: 'press' }, { id: 'sa', session_id: 'b', exercise_id: 'squat' }, { id: 'ba', session_id: 'b', exercise_id: 'bike' }],
    set: [
      { id: 'w', session_slot_id: 'pa', position: 0, type: 'warmup', done_at: 1, weight: 5, unit: 'kg', reps: 10 },
      { id: 'p1', session_slot_id: 'pa', position: 1, type: 'working', done_at: 2, weight: 20, unit: 'kg', reps: 10, reps_left: 1 },
      { id: 'p2', session_slot_id: 'pa', position: 2, type: 'working', done_at: 3, weight: 10, unit: 'kg', reps: 10 },
      { id: 'p3', session_slot_id: 'pa', position: 3, type: 'drop', done_at: 4, weight: 5, unit: 'kg', reps: 5 },
      { id: 's1', session_slot_id: 'sa', position: 0, type: 'working', done_at: 5, weight: 10, unit: 'kg', reps: 5 },
      { id: 'b1', session_slot_id: 'ba', position: 0, type: 'working', done_at: 6, weight: 30, unit: 'kg', reps: 10 },
    ], setting: [],
  };
  const actual = dailySummary(data, '2026-01-01', '2026-01-02');
  assert.deepEqual(actual, [
    { date: '2026-01-01', sessions: 2, sets: 4, hardSets: 3, volumeLb: 700 / LB_TO_KG, minutes: 20, trainingLoad: 150, trainingLoadSource: 'setRpeAverage', rpeCoverage: 0.25, muscles: { chest: 2, triceps: 1, quadriceps: 1 }, musclesDirect: { chest: 2, quadriceps: 1 } },
    { date: '2026-01-02', sessions: 0, sets: 0, hardSets: 0, volumeLb: 0, minutes: 0, trainingLoad: 0, trainingLoadSource: null, rpeCoverage: null, muscles: {}, musclesDirect: {} },
  ]);
});

test('estimated maxima preserve assumed effort, rep limits, weight basis and one-rep comparison band', () => {
  const set = { weight: 100, unit: 'kg', reps: 10 };
  assert.deepEqual(estimatedMax(set), { value: 140, record: true, assumed: true, reps: 12 });
  assert.equal(estimatedMax({ ...set, reps: 11 }).record, false);
  assert.equal(estimatedMax({ ...set, weight: 20 }, { weight_basis: 'per_hand' }).value, 28);
  assert.equal(estimatedMax({ ...set, reps: 19 }), null);
  assert.equal(loadKg(set, { weight_basis: 'assisted' }), null);
  assert.equal(loadKg({ ...set, weight: 20, bodyweight_grams: 80000 }, { weight_basis: 'assisted' }), 60);
  assert.equal(compareSet({ ...set, weight: 105, reps: 8 }, set), 'same');
  assert.equal(compareSet({ ...set, reps_left: 3 }, { ...set, reps_left: 1 }), 'easier');
  assert.equal(progressMark(Array(9).fill(100), 100, 110).mark, null);
  assert.equal(progressMark(Array(20).fill(100), 100, 101, { stepPercent: 2.5, repPercent: 2 }).mark, null);
  assert.equal(progressMark(Array(20).fill(100), 100, 110, { stepPercent: 2.5, repPercent: 2 }).mark, 'up');
});

test('progress error keeps its floor for repeated numbers and weights rounded to the learned list', () => {
  for (const n of [10,20,40]) {
    const floor=2;
    assert.equal(typicalError(Array(n).fill(100),2.5,2),floor);
    for (const values of [Array(n).fill(100),Array.from({length:n},(_,i)=>[97.5,100,102.5,100][i%4])]) {
      assert.ok(typicalError(values,2.5,2)>=floor);
      assert.equal(progressMark(values,100,100,{stepPercent:2.5,repPercent:2}).mark,null);
    }
  }
});

test('P8 simulated unchanged and improved lifts estimate their own error, with one k at every sample size', () => {
  let seed = 81923;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + 1) / 4294967297; };
  const normal = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
  for (const n of [10, 20, 40]) {
    let falseMarks = 0, detected = 0;
    for (let trial = 0; trial < 4000; trial++) {
      const noise = [0.022, 0.059, 0.1][trial % 3];
      const values = Array.from({ length: n }, () => 100 * Math.exp(normal() * noise));
      const prev = Math.max(...values.slice(0, n / 2)), now = Math.max(...values.slice(n / 2));
      const options = { stepPercent: 1, repPercent: 2, k: 2.5 };
      if (progressMark(values, prev, now, options).mark) falseMarks++;
      const changed = values.map((value, i) => i < n / 2 ? value : value * Math.exp(4 * noise));
      if (progressMark(changed, prev, Math.max(...changed.slice(n / 2)), options).mark === 'up') detected++;
    }
    assert.ok(falseMarks / 4000 <= 0.1, `n=${n}, false marks=${falseMarks / 4000}`);
    if (n >= 20) assert.ok(detected / 4000 >= 0.8, `n=${n}, detected=${detected / 4000}`);
    console.log(`P8 n=${n}: false ${(falseMarks / 40).toFixed(1)}%; detected ${(detected / 40).toFixed(1)}%; k=2.5`);
  }
});
