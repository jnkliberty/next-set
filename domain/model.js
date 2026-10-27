import { findReference, nextTarget, weightGrid, weightIn } from './targets.js';

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export const live = rows => (rows || []).filter(row => row.deleted_at == null);
export const byId = rows => new Map(live(rows).map(row => [row.id, row]));
export const working = set => ['working', 'failure', 'drop', 'rest_pause'].includes(set.type) && set.done_at != null;

export function exerciseIdentity(exercises, id) {
  const seen = new Set();
  while (exercises.get(id)?.merged_into && !seen.has(id)) { seen.add(id); id = exercises.get(id).merged_into; }
  return id;
}

export function trainingRows(data) {
  const sessions = byId(data.session), slots = byId(data.session_slot), exercises = byId(data.exercise), rows = new Map();
  for (const set of live(data.set)) {
    if (!working(set) || ['drop', 'rest_pause'].includes(set.type) || !set.reps) continue;
    const slot = slots.get(set.session_slot_id), session = sessions.get(slot?.session_id);
    if (!session || exercises.get(slot.exercise_id)?.conditioning) continue;
    const key = `${slot.id}:${set.target_reps_min}:${set.target_reps_max}`;
    let row = rows.get(key);
    if (!row) {
      row = { id: key, exercise_id: exerciseIdentity(exercises, slot.exercise_id), session_id: session.id,
        started_at: session.started_at, date: session.local_date, off: session.off, run_id: session.run_id,
        position: slot.position, range: [set.target_reps_min, set.target_reps_max], sets: [] };
      rows.set(key, row);
    }
    row.sets.push(set);
  }
  for (const row of rows.values()) row.sets.sort((a, b) => a.position - b.position);
  return [...rows.values()].sort((a, b) => a.started_at - b.started_at || a.position - b.position);
}

export function targetsFor(rows, exercise, plans, { before = Date.now(), sessionId, unit = 'kg' } = {}) {
  const learned = rows.filter(row => row.exercise_id === exercise.id && row.started_at < before && row.session_id !== sessionId)
    .flatMap(row => row.sets.filter(set => set.unit === unit).map(set => set.weight));
  const grid = weightGrid(exercise.equipment, unit, learned);
  const targets = plans.map((plan, i) => {
    const range = [plan.reps_min ?? null, plan.reps_max ?? null];
    const reference = findReference(rows, exercise.id, range, before, sessionId);
    const ref = reference.row?.sets.map(set => ({ ...set, weight: weightIn(set, unit) })) || [];
    const ordinal = plans.slice(0, i).filter(other => other.reps_min === plan.reps_min && other.reps_max === plan.reps_max).length;
    const prior = ref[Math.min(ordinal, ref.length - 1)];
    const target = reference.kind === 'same_range' && plan.type === 'working' && range[0] != null ? nextTarget(ref, range, grid)
      : { weight: prior?.weight ?? null, reps: prior?.reps ?? plan.reps_min ?? 0, reason: reference.kind };
    return { ...target, reference: prior || null, reference_kind: reference.kind, reference_row: reference.row, unit };
  });
  return { targets, grid, reference: targets[0]?.reference_row ?? null };
}
