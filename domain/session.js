import { live, byId, exerciseIdentity, trainingRows, targetsFor } from './model.js';
import { todayDate } from './calendar.js';
import { carryForward, returnChoice, LB_TO_KG, weightGrid, weightIn, targetReasonChange, removeTargetReasons } from './targets.js';
import { loadKg } from './metrics.js';
import { integrationEvent } from './integration-record.js';

export function createSession(data, day, run, now = Date.now()) {
  const sessionId = crypto.randomUUID();
  const changes = [{ table: 'session', row: { id: sessionId, run_id: run?.id ?? null, program_day_id: day.id, started_at: now,
    timezone: 'America/Chicago', local_date: todayDate(now), status: 'open', off: false, effort: null, note: '', source: 'app', ended_at: null } }];
  for (const slot of live(data.slot).filter(row => row.program_day_id === day.id).sort((a, b) => a.position - b.position)) {
    const plans = live(data.slot_set).filter(row => row.slot_id === slot.id).sort((a, b) => a.position - b.position);
    const rows = instantiateSlot(data, changes[0].row, slot, plans, now);
    changes.push(...rows);
    const slotRow = rows.find(row => row.table === 'session_slot').row;
    const targets = rows.filter(row => row.table === 'set').map(({ row }) => ({ position: row.position, type: row.type, repsMin: row.target_reps_min, repsMax: row.target_reps_max, seconds: row.target_seconds, weight: row.target_weight, effort: row.target_effort }));
    try { changes.push(integrationEvent(sessionId, 'original_plan', { slotId: slotRow.id, targets })); } catch { /* An oversized record does not block starting a workout. */ }
  }
  return { sessionId, changes };
}

export function instantiateSlot(data, session, slot, plans, now = Date.now()) {
  const exercises = byId(data.exercise), exerciseId = exerciseIdentity(exercises, slot.exercise_id), exercise = exercises.get(exerciseId);
  if (!exercise) throw new Error('This exercise needs a valid name before it can start.');
  const history = trainingRows(data), slotId = crypto.randomUUID();
  const last = history.filter(row => row.exercise_id === exerciseId && row.started_at < now && row.session_id !== session.id).at(-1);
  const unit = last?.sets.at(-1)?.unit ?? 'kg';
  const { targets } = targetsFor(history, exercise, plans, { before: now, sessionId: session.id, unit });
  const changes = [{ table: 'session_slot', row: { id: slotId, session_id: session.id, position: slot.position, exercise_id: exerciseId, planned_exercise_id: slot.planned_exercise_id ?? slot.exercise_id,
    name: exercise.name, group_id: slot.group_id ?? null, group_kind: slot.group_kind ?? null, pinned_note: slot.pinned_note ?? '', rest_seconds: slot.rest_seconds ?? 90 } }];
  plans.forEach((plan, i) => {
    const target = targets[i];
    const row = { id: crypto.randomUUID(), session_slot_id: slotId, position: plan.position ?? i, type: exercise.conditioning ? 'timed' : plan.type,
      target_reps_min: plan.reps_min ?? null, target_reps_max: plan.reps_max ?? null, target_seconds: plan.seconds ?? null, target_weight: target.weight,
      target_effort: plan.target_effort ?? 8, target_reference: target.reference_kind, reference_set_id: target.reference?.id ?? null,
      weight: target.weight, unit, grams: target.weight == null ? null : Math.round(target.weight * (unit === 'lb' ? LB_TO_KG : 1) * 1000), reps: target.reps,
      seconds: plan.seconds ?? null, reps_left: null, effort_source: 'assumed', bodyweight_grams: live(data.setting).find(row => row.id === 'bodyweight')?.value ?? null,
      done_at: null, local_date: session.local_date, note: '' };
    changes.push({ table: 'set', row }, targetReasonChange(row, row.type === 'timed' ? 'timed_plan' : target.reason));
  });
  const lastNormal = history.filter(row => row.exercise_id === exerciseId && !row.off && row.started_at < now && row.session_id !== session.id).at(-1);
  const days = lastNormal ? Math.round((Date.parse(session.local_date) - Date.parse(lastNormal.date)) / 86400000) : 0;
  const prompt = returnChoice(days);
  if (prompt) changes.push({ table: 'setting', row: { id: `return:${slotId}`, value: { ...prompt, choice: null } } });
  return changes;
}

export function carryForwardReasonChanges(sets, logged) {
  const own = live(sets).filter(set => set.session_slot_id === logged.session_slot_id).map(set => set.id === logged.id ? logged : set).sort((a, b) => a.position - b.position);
  return own.filter(set => set.done_at == null).flatMap(set => {
    const prior = own.filter(row => row.done_at != null && row.position < set.position).at(-1);
    if (prior?.id !== logged.id) return [];
    const suggested = carryForward(set, prior);
    return suggested === set ? [] : [targetReasonChange(set, 'set_correction', suggested, prior)];
  });
}

export function returnTargetChanges(data, slot, reduction) {
  const setting = live(data.setting).find(row => row.id === `return:${slot.id}`);
  if (!setting || ![0, 0.05, 0.1].includes(reduction)) throw new Error('Choose one of the available starting weights.');
  const refs = byId(data.set), exercise = byId(data.exercise).get(slot.exercise_id), history = trainingRows(data).filter(row => row.exercise_id === slot.exercise_id);
  const changes = live(data.set).filter(set => set.session_slot_id === slot.id && set.done_at == null && set.type === 'working').flatMap(set => {
    const prior = refs.get(set.reference_set_id), base = prior ? weightIn(prior, set.unit) : set.weight;
    const learned = history.flatMap(row => row.sets.filter(old => old.unit === set.unit).map(old => old.weight));
    const weight = base == null ? null : reduction ? weightGrid(exercise?.equipment, set.unit, learned).floor(base * (1 - reduction)) : base;
    const row = { id: set.id, weight, target_weight: weight, grams: weight == null ? null : Math.round(weight * (set.unit === 'lb' ? LB_TO_KG : 1) * 1000) };
    return [{ table: 'set', row }, targetReasonChange({ ...set, ...row }, reduction ? `return_${reduction * 100}` : 'return_same')];
  });
  changes.push({ table: 'setting', row: { id: setting.id, value: { ...setting.value, choice: reduction } } });
  return changes;
}

export function startChanges(data, session, now = Date.now()) {
  const slots = new Set(live(data.session_slot).filter(row => row.session_id === session.id).map(row => row.id));
  const sets = live(data.set).filter(row => slots.has(row.session_slot_id));
  if (sets.some(row => row.done_at != null)) return [];
  const local_date = session.program_day_id === null ? session.local_date : todayDate(now);
  return [{ table: 'session', row: { id: session.id, started_at: now, local_date } },
    ...sets.map(row => ({ table: 'set', row: { id: row.id, local_date } }))];
}

export function finishChanges(data, session, now = Date.now(), early = false, reason = null, advisoryId = null) {
  const changes = [{ table: 'session', row: { id: session.id, status: early ? 'finished_early' : 'done', ended_at: now } }];
  if (early && reason != null) changes.push(integrationEvent(session.id, 'session_choice', { reason, advisoryId }));
  if (!session.run_id || session.program_day_id == null) return changes;
  const day = live(data.program_day).find(row => row.id === session.program_day_id), run = live(data.run).find(row => row.id === session.run_id);
  if (!run || !day) return changes;
  const completed = new Set(live(data.run_event).filter(row => row.run_id === run.id && ['done', 'skipped'].includes(row.kind) && row.position != null).map(row => row.position));
  completed.add(day.position);
  const next = live(data.program_day).filter(row => row.program_id === run.program_id && !completed.has(row.position)).sort((a, b) => a.position - b.position)[0];
  changes.push({ table: 'run_event', row: { id: `done:${session.id}`, deleted_at: null, run_id: run.id, kind: 'done', local_date: session.local_date, position: day.position, session_id: session.id } });
  changes.push({ table: 'run', row: { id: run.id, next_position: next?.position ?? Math.max(...live(data.program_day).filter(row => row.program_id === run.program_id).map(row => row.position)) + 1, status: run.status === 'paused' ? 'paused' : next ? 'active' : 'done' } });
  return changes;
}

export function skipRemainingChanges(data, session, slot, now = Date.now()) {
  if (slot.session_id !== session.id || session.status !== 'open') throw new Error('This exercise is not in an open workout.');
  const slots = new Set(live(data.session_slot).filter(row => row.session_id === session.id).map(row => row.id));
  const remaining = live(data.set).filter(row => slots.has(row.session_slot_id) && row.done_at == null);
  const skipped = remaining.filter(row => row.session_slot_id === slot.id);
  if (!skipped.length) return [];
  const changes = [...skipped.map(row => ({ table: 'set', row: { id: row.id, deleted_at: now } })), ...removeTargetReasons(data, skipped, now)];
  if (skipped.length === remaining.length) changes.push(...finishChanges(data, session, now));
  return changes;
}

export function deleteSessionChanges(data, session, now = Date.now()) {
  const slots = live(data.session_slot).filter(row => row.session_id === session.id), ids = new Set(slots.map(row => row.id));
  const events = live(data.run_event).filter(row => row.session_id === session.id);
  const remove = (table, rows) => rows.map(row => ({ table, row: { id: row.id, deleted_at: now } }));
  const sets = live(data.set).filter(row => ids.has(row.session_slot_id));
  const changes = [...remove('session', [session]), ...remove('session_slot', slots),
    ...remove('set', sets), ...removeTargetReasons(data, sets, now), ...remove('run_event', events)];
  const run = byId(data.run).get(session.run_id);
  if (!run || !events.some(row => row.kind === 'done')) return changes;
  const complete = new Set(live(data.run_event).filter(row => row.run_id === run.id && row.session_id !== session.id && ['done', 'skipped'].includes(row.kind) && row.position != null).map(row => row.position));
  for (const event of events.filter(row => row.kind === 'done' && row.position != null)) {
    if (complete.has(event.position)) continue;
    changes.push({ table: 'run_event', row: { id: `deleted:${session.id}:${event.position}`, deleted_at: null, run_id: run.id, kind: 'skipped', position: event.position, session_id: null, local_date: session.local_date } });
    complete.add(event.position);
  }
  return changes;
}

const sameRange = (set, range) => set.target_reps_min === range[0] && set.target_reps_max === range[1];
const inRange = set => set.reps > 0 && (set.target_reps_min == null || set.reps >= set.target_reps_min) && (set.target_reps_max == null || set.reps <= set.target_reps_max);
const bestSet = sets => [...sets].sort((a, b) => (weightIn(b) ?? 0) - (weightIn(a) ?? 0) || (b.reps ?? 0) - (a.reps ?? 0))[0];

export function exerciseHistory(data, exerciseId, range = null) {
  const exercises = byId(data.exercise), sessions = byId(data.session), id = exerciseIdentity(exercises, exerciseId);
  const slots = byId(data.session_slot), grouped = new Map();
  for (const set of live(data.set)) {
    const slot = slots.get(set.session_slot_id), session = sessions.get(slot?.session_id);
    if (!session || exerciseIdentity(exercises, slot.exercise_id) !== id || set.done_at == null || set.type === 'warmup') continue;
    if (range && !sameRange(set, range)) continue;
    const row = grouped.get(session.id) ?? { session, sets: [] };
    row.sets.push(set); grouped.set(session.id, row);
  }
  const rows = [...grouped.values()].sort((a, b) => a.session.started_at - b.session.started_at).map(row => ({ ...row,
    best: bestSet(row.sets.filter(set => !['drop', 'rest_pause', 'timed'].includes(set.type) && inRange(set))),
    volumeKg: row.sets.some(set => set.type !== 'timed' && loadKg(set, exercises.get(id)) == null) ? null : row.sets.reduce((sum, set) => sum + (loadKg(set, exercises.get(id)) ?? 0) * (set.reps ?? 0), 0) }));
  const sets = rows.flatMap(row => row.sets).filter(set => set.type !== 'timed');
  return { rows, heaviestKg: sets.length ? Math.max(...sets.map(set => weightIn(set) ?? 0)) : null, best: bestSet(rows.map(row => row.best).filter(Boolean)), sessions: rows.length };
}

function volumeFor(data, session) {
  const ids = new Set(live(data.session_slot).filter(row => row.session_id === session.id).map(row => row.id));
  const slots = byId(data.session_slot), exercises = byId(data.exercise);
  const sets = live(data.set).filter(row => ids.has(row.session_slot_id) && row.done_at != null && !['warmup', 'timed'].includes(row.type));
  const loads = sets.map(set => loadKg(set, exercises.get(slots.get(set.session_slot_id)?.exercise_id)));
  return { volumeKg: loads.some(value => value == null) ? null : loads.reduce((sum, load, i) => sum + load * (sets[i].reps ?? 0), 0), sets };
}

function volumeComparison(data, session, current) {
  const days = byId(data.program_day), day = days.get(session.program_day_id);
  if (!day || session.off || !current.volumeKg) return null;
  const previous = live(data.session).filter(row => {
    const priorDay = days.get(row.program_day_id);
    return row.id !== session.id && row.started_at < session.started_at && ['done', 'finished_early'].includes(row.status) && !row.off && priorDay?.program_id === day.program_id && priorDay?.day === day.day;
  }).sort((a, b) => b.started_at - a.started_at)[0];
  if (!previous) return null;
  const old = volumeFor(data, previous), slots = byId(data.session_slot);
  const shape = sets => sets.map(set => [slots.get(set.session_slot_id)?.exercise_id, set.type, set.target_reps_min, set.target_reps_max].join(':')).sort().join('|');
  if (!old.volumeKg || shape(old.sets) !== shape(current.sets)) return null;
  return { session: previous, day: day.day, percent: Math.round((current.volumeKg / old.volumeKg - 1) * 100) };
}

function recordsFor(data, session) {
  const rows = trainingRows(data), exercises = byId(data.exercise);
  return rows.filter(row => row.session_id === session.id).flatMap(row => {
    const best = bestSet(row.sets.filter(inRange)), prior = rows.filter(old => old.exercise_id === row.exercise_id && old.session_id !== session.id && old.started_at < session.started_at && old.range[0] === row.range[0] && old.range[1] === row.range[1]);
    const previous = bestSet(prior.flatMap(old => old.sets).filter(inRange));
    if (!previous || !best || !(weightIn(best) > weightIn(previous) || (weightIn(best) === weightIn(previous) && best.reps > previous.reps))) return [];
    return [{ exercise: exercises.get(row.exercise_id), set: best, previous, range: row.range }];
  });
}

export function workoutResults(data, session) {
  const slots = live(data.session_slot).filter(row => row.session_id === session.id), ids = new Set(slots.map(row => row.id));
  const sets = live(data.set).filter(row => ids.has(row.session_slot_id)), current = volumeFor(data, session);
  const history = trainingRows(data), exercises = byId(data.exercise);
  const next = session.off ? [] : slots.flatMap(slot => {
    const plans = sets.filter(set => set.session_slot_id === slot.id && set.done_at != null && set.type === 'working')
      .map(set => ({ type: set.type, reps_min: set.target_reps_min, reps_max: set.target_reps_max }));
    const exercise = exercises.get(exerciseIdentity(exercises, slot.exercise_id));
    if (!plans.length || !exercise || exercise.conditioning) return [];
    const target = targetsFor(history, exercise, plans, { before: Infinity }).targets[0];
    return target?.weight == null ? [] : [{ slot, weight: target.weight, reps: target.reps, unit: target.unit }];
  });
  return { logged: sets.filter(row => row.done_at != null).length, total: sets.length, volumeKg: current.volumeKg,
    minutes: Math.max(0, Math.round(((session.ended_at ?? session.started_at) - session.started_at) / 60000)),
    comparison: volumeComparison(data, session, current), bests: recordsFor(data, session), next };
}
