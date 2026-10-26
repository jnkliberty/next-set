import { byId, exerciseIdentity, live, trainingRows, working } from './model.js';
import { findReference, LB_TO_KG, weightIn, weightGrid } from './targets.js';
import { addDays, settingAt, weekday } from './calendar.js';

export const median = values => {
  if (!values.length) return 0;
  const xs = [...values].sort((a, b) => a - b), i = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[i] : (xs[i - 1] + xs[i]) / 2;
};
export const effort = set => set.reps_left == null ? set.target_effort ?? 8 : 10 - set.reps_left;

export function loadKg(set, exercise, bodyweightGrams) {
  const kg = set.grams == null ? weightIn(set, 'kg') : set.grams / 1000;
  if (kg == null) return null;
  const basis = exercise?.weight_basis;
  if (basis === 'per_hand' || basis === 'per_side') return kg * 2;
  if (basis === 'added_to_bodyweight' || basis === 'assisted') {
    const bodyweight = set.bodyweight_grams ?? bodyweightGrams;
    if (bodyweight == null) return null;
    return Math.max(0, bodyweight / 1000 + (basis === 'assisted' ? -kg : kg));
  }
  return kg;
}

export function estimatedMax(set, exercise, bodyweightGrams) {
  const reps = (set.reps ?? 0) + (set.reps_left ?? 2);
  const weight = ['per_hand', 'per_side'].includes(exercise?.weight_basis) ? weightIn(set) : loadKg(set, exercise, bodyweightGrams);
  if (weight == null || weight <= 0 || !set.reps || reps > 20) return null;
  return { value: weight * (1 + reps / 30), record: reps <= 12, assumed: set.reps_left == null, reps };
}

export function compareSet(current, previous, exercise) {
  const a = estimatedMax(current, exercise), b = estimatedMax(previous, exercise);
  const w = weightIn(current), old = weightIn(previous);
  if (w === old && current.reps === previous.reps) return effort(current) < effort(previous) ? 'easier' : 'same';
  if (w >= old && current.reps >= previous.reps) return 'beat';
  if (w <= old && current.reps <= previous.reps) return 'behind';
  if (!a || !b) return 'same';
  const band = Math.max(0, ['per_hand', 'per_side'].includes(exercise?.weight_basis) ? weightIn(previous) : loadKg(previous, exercise) ?? 0) / 30;
  return a.value > b.value + band + 1e-6 ? 'beat' : a.value < b.value - band - 1e-6 ? 'behind' : 'same';
}

export function typicalError(values, stepPercent = 0, repPercent = 0) {
  const changes = values.slice(1).map((value, i) => values[i] > 0 ? (value / values[i] - 1) * 100 : 0);
  const mid = median(changes), mad = median(changes.map(value => Math.abs(value - mid)));
  const floor = Math.min(stepPercent || Infinity, repPercent || Infinity);
  return Math.max(1.4826 * mad / Math.sqrt(2), Number.isFinite(floor) ? floor : 0);
}

export function progressMark(values, previous, current, { stepPercent = 0, repPercent = 0, k = 2.5 } = {}) {
  if (values.length < 10 || previous <= 0 || current <= 0) return { mark: null, error: null };
  const error = typicalError(values, stepPercent, repPercent), delta = (current / previous - 1) * 100;
  return { mark: Math.abs(delta) > k * error + 1e-6 ? delta > 0 ? 'up' : 'down' : null, error, delta };
}

function sessionSets(data, sessionId) {
  const slots = live(data.session_slot).filter(slot => slot.session_id === sessionId), exercises = byId(data.exercise);
  const sets = live(data.set).filter(working);
  return slots.map(slot => ({ slot, exercise: exercises.get(slot.exercise_id), sets: sets.filter(set => set.session_slot_id === slot.id).sort((a, b) => a.position - b.position) }))
    .filter(row => !row.exercise?.conditioning);
}

export function hardChains(sets) {
  const chains = [];
  for (const set of sets) {
    if (['drop', 'rest_pause'].includes(set.type) && chains.length) chains.at(-1).push(set);
    else chains.push([set]);
  }
  return chains.filter(chain => chain.some(set => effort(set) >= 7)).length;
}

export function sessionSummary(data, session, bodyweightGrams) {
  const rows = sessionSets(data, session.id), sets = rows.flatMap(row => row.sets);
  const minutes = Math.max(0, ((session.ended_at ?? session.started_at) - session.started_at) / 60000);
  const muscles = {}, musclesDirect = {};
  let volumeKg = 0, hardSets = 0, missingBodyweight = false;
  for (const row of rows) {
    const hard = hardChains(row.sets); hardSets += hard;
    for (const muscle of row.exercise?.primary || []) { muscles[muscle] = (muscles[muscle] || 0) + hard; musclesDirect[muscle] = (musclesDirect[muscle] || 0) + hard; }
    for (const muscle of row.exercise?.secondary || []) if (!row.exercise.primary.includes(muscle)) muscles[muscle] = (muscles[muscle] || 0) + 0.5 * hard;
    for (const set of row.sets) {
      const load = loadKg(set, row.exercise, bodyweightGrams);
      if (load == null) missingBodyweight = true;
      volumeKg += (load ?? 0) * (set.reps ?? 0);
    }
  }
  const average = sets.length ? sets.reduce((sum, set) => sum + effort(set), 0) / sets.length : 0;
  return { sets: sets.length, hardSets, volumeKg, missingBodyweight, minutes,
    trainingLoad: (session.effort ?? average) * minutes, rated: session.effort != null,
    logged: sets.filter(set => set.reps_left != null).length, muscles, musclesDirect };
}

export function dailySummary(data, from, to) {
  const byDate = Map.groupBy(live(data.session).filter(session => session.status !== 'open'), row => row.local_date);
  const bodyweight = live(data.setting).find(row => row.id === 'bodyweight')?.value;
  const result = [];
  for (let date = from; date <= to; date = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
    const sessions = byDate.get(date) || [], parts = sessions.map(session => sessionSummary(data, session, bodyweight));
    const total = key => parts.reduce((sum, row) => sum + row[key], 0);
    const muscles = {}, musclesDirect = {};
    for (const part of parts) for (const key of ['muscles', 'musclesDirect']) for (const [muscle, n] of Object.entries(part[key])) {
      const target = key === 'muscles' ? muscles : musclesDirect; target[muscle] = (target[muscle] || 0) + n;
    }
    result.push({ date, sessions: sessions.length, sets: total('sets'), hardSets: total('hardSets'), volumeLb: total('volumeKg') / LB_TO_KG,
      minutes: total('minutes'), trainingLoad: total('trainingLoad'), trainingLoadSource: !sessions.length ? null : parts.every(part => part.rated) ? 'sessionRpe' : 'setRpeAverage',
      rpeCoverage: total('sets') ? total('logged') / total('sets') : null, muscles, musclesDirect });
  }
  return result;
}

export function liftProgress(data) {
  const exercises = byId(data.exercise), rows = trainingRows(data), result = new Map();
  for (const row of rows) {
    const exercise = exercises.get(exerciseIdentity(exercises, row.exercise_id));
    const maxima = row.sets.map(set => estimatedMax(set, exercise)).filter(Boolean);
    const current = result.get(row.exercise_id) || { id: row.exercise_id, name: exercise?.name ?? row.exercise_id, sessions: [], record: null, beats: 0, behind: 0, compared: 0, stepPercent: 0, repPercent: 0 };
    if (maxima.length) {
      const value = Math.max(...maxima.map(max => max.value));
      if (!row.off) {
        const existing = current.sessions.find(point => point.session_id === row.session_id);
        if (existing) existing.value = Math.max(existing.value, value);
        else current.sessions.push({ date: row.date, value, session_id: row.session_id });
        Object.assign(current, errorFloor(row.sets, exercise, rows.filter(other=>other.exercise_id===row.exercise_id)));
      }
      const records = maxima.filter(max => max.record);
      if (records.length) current.record = Math.max(current.record ?? 0, ...records.map(max => max.value));
    }
    if (!row.off) {
      const previous = findReference(rows, row.exercise_id, row.range, row.started_at, row.session_id);
      if (previous.kind === 'same_range') {
        current.compared++;
        const matches = row.sets.map((set, k) => previous.row.sets[k] ? compareSet(set, previous.row.sets[k], exercise) : 'same');
        const beats = matches.filter(value => value === 'beat').length, behind = matches.filter(value => value === 'behind').length;
        if (beats > behind) current.beats++;
        if (behind > beats) current.behind++;
      }
    }
    result.set(row.exercise_id, current);
  }
  return [...result.values()];
}

function errorFloor(sets, exercise, rows) {
  const set = sets.find(set=>estimatedMax(set,exercise));
  if(!set)return {};
  const maximum=estimatedMax(set,exercise), weight=weightIn(set), strengthWeight=maximum.value/(1+maximum.reps/30);
  const grid=weightGrid(exercise?.equipment,'kg',rows.flatMap(row=>row.sets.filter(set=>set.unit==='kg').map(set=>set.weight)));
  return {stepPercent:100*(grid.step(weight,1)-weight)/strengthWeight,repPercent:100/(30+maximum.reps)};
}

export function adherence(data, from, to) {
  let target=0;
  const runs=live(data.run), settings=live(data.run_setting), events=live(data.run_event);
  for(let date=from;date<=to;date=addDays(date,1)){
    const active=runs.filter(run=>run.start_date<=date).map(run=>({run,setting:settingAt(settings.filter(setting=>setting.run_id===run.id),date)}))
      .filter(row=>row.setting?.weekly_target>0).sort((a,b)=>b.setting.from_date.localeCompare(a.setting.from_date)||b.run.start_date.localeCompare(a.run.start_date))[0];
    if(!active)continue;
    const {run,setting}=active;
    if(events.some(event=>event.run_id===run.id&&event.kind==='leave'&&event.local_date<=date&&(!event.to_date||event.to_date>=date)))continue;
    if(setting.weekdays.includes(weekday(date)))target+=setting.weekly_target/setting.weekdays.length;
  }
  target=Math.round(target*1e6)/1e6;
  const added=new Set(events.filter(event=>event.kind==='added').map(event=>event.session_id));
  const done=live(data.session).filter(session=>session.run_id&&session.program_day_id!=null&&!added.has(session.id)&&session.status!=='open'&&session.local_date>=from&&session.local_date<=to).length;
  return {done,target,ratio:target?done/target:null};
}
