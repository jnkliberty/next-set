export const LB_TO_KG = 0.45359237;
const rounded = value => Math.round(value * 1e6) / 1e6;
const sameRange = (a, b) => a?.[0] === b?.[0] && a?.[1] === b?.[1];

export function weightIn(set, unit = 'kg') {
  if (set.weight == null) return null;
  if (set.unit === unit || !set.unit) return set.weight;
  return set.unit === 'lb' ? set.weight * LB_TO_KG : set.weight / LB_TO_KG;
}

export function weightGrid(equipment = 'barbell', unit = 'kg', learned = []) {
  const size = ['cable', 'machine'].includes(equipment) ? 5 : 2.5;
  const stepSize = unit === 'lb' ? size * 2 : size;
  const points = [...new Set(learned.filter(x => Number.isFinite(x) && x > 0).map(rounded))].sort((a, b) => a - b);
  function lattice(lo, hi) {
    if (!points.length) {
      const start = Math.max(0, Math.floor(lo / stepSize) - 1), end = Math.ceil(hi / stepSize) + 1;
      return Array.from({ length: end - start + 1 }, (_, i) => rounded((start + i) * stepSize));
    }
    const result = [...points];
    for (let x = points.at(-1) + stepSize; x <= Math.max(hi, points.at(-1)) + stepSize + 1e-6; x += stepSize) result.push(rounded(x));
    for (let x = points[0] - stepSize; x >= Math.max(0, Math.min(lo, points[0]) - stepSize) - 1e-6; x -= stepSize) result.push(rounded(x));
    result.push(0);
    return [...new Set(result)].sort((a, b) => a - b);
  }
  return {
    stepSize, points,
    floor(value) { return lattice(value, value).filter(x => x <= value + 1e-6).at(-1) ?? 0; },
    step(value, direction) {
      const pts = lattice(value - stepSize, value + stepSize);
      return direction > 0 ? pts.find(x => x > value + 1e-6) ?? rounded(value + stepSize) : pts.filter(x => x < value - 1e-6).at(-1) ?? 0;
    },
    taps(a, b) {
      if (Math.abs(a - b) < 1e-6) return 0;
      const lo = Math.min(a, b), hi = Math.max(a, b), pts = lattice(lo, hi);
      return pts.filter(x => x > lo + 1e-6 && x <= hi + 1e-6).length + (pts.some(x => Math.abs(x - hi) < 1e-6) ? 0 : 1);
    },
  };
}

export function nextTarget(reference, [low, high], grid) {
  if (!reference.length) return { weight: null, reps: low ?? 0, reason: 'first_time' };
  const first = reference[0], { weight, reps } = first;
  const brake = reference.some(set => set.reps_left != null && ((set.reps_left === 0 && set.type !== 'failure') || 10 - set.reps_left >= (set.target_effort ?? 8) + 1));
  if (brake) return { weight, reps, reason: 'effort_brake' };
  if (reference.every(set => set.reps >= high) && weight > 0) {
    const next = grid.step(weight, 1);
    const estimatedReps = ((weight * (1 + (reps + 2) / 30)) / next - 1) * 30 - 2;
    if (estimatedReps >= low - 1e-6) return { weight: next, reps: low, reason: 'next_weight' };
    return { weight, reps: reps + 1, reason: 'jump_too_large' };
  }
  return { weight, reps: Math.max(reps, Math.min(high, reps + 1)), reason: 'add_rep' };
}

export function carryForward(target, previous) {
  if (target.type !== 'working' || previous?.type !== 'working' || previous.done_at == null
    || !sameRange([target.target_reps_min, target.target_reps_max], [previous.target_reps_min, previous.target_reps_max])) return target;
  return { ...target, weight: previous.weight, unit: previous.unit ?? target.unit ?? 'kg', reps: previous.reps };
}

export function returnChoice(days) {
  return days < 15 ? null : { days, recommended: days < 29 ? 0.05 : 0.1, choices: [0, 0.05, 0.1] };
}

export function findReference(rows, exerciseId, range, before, sessionId) {
  const eligible = rows.filter(row => row.exercise_id === exerciseId && !row.off && row.started_at < before && row.session_id !== sessionId && row.sets.length)
    .sort((a, b) => b.started_at - a.started_at || (b.position ?? 0) - (a.position ?? 0));
  const same = eligible.find(row => sameRange(row.range, range));
  return same ? { kind: 'same_range', row: same } : eligible.length ? { kind: 'other_range', row: eligible[0] } : { kind: 'none', row: null };
}

export const targetReasons = {
  first_time: 'No earlier working sets are available for this exercise.',
  same_range: 'Uses your last result in this rep range.',
  other_range: 'Uses your last result from a different rep range.',
  next_weight: 'You reached the top of the rep range, so the next weight is suggested.',
  jump_too_large: 'The next weight step is estimated to put you below this rep range, so one more rep is suggested.',
  add_rep: 'Keep the weight and build reps within this range.',
  effort_brake: 'Your last effort rating keeps the weight and reps unchanged.',
  set_correction: 'Uses the weight and reps from your earlier set today.',
  added_set: 'Copies the values from the previous set.',
  return_same: 'You chose your previous weight after a break.',
  return_5: 'You chose a 5% reduction after a break, rounded to an available weight.',
  return_10: 'You chose a 10% reduction after a break, rounded to an available weight.',
  timed_plan: 'Uses the duration in this workout.',
};
const targetSnapshot = set => ['type', 'target_weight', 'target_reps_min', 'target_reps_max', 'target_seconds', 'target_effort', 'target_reference', 'reference_set_id'].map(field => set[field] ?? null);
const sourceSnapshot = set => ['id', 'done_at', 'weight', 'unit', 'reps', 'type', 'target_reps_min', 'target_reps_max', 'session_slot_id', 'position'].map(field => set[field] ?? null);

export function targetReasonChange(set, code, suggestion = set, source = null) {
  code = code === 'none' ? 'first_time' : code;
  if (!Object.hasOwn(targetReasons, code)) throw new Error('Unknown target reason');
  return { table: 'setting', row: { id: `target-reason:${set.id}`, deleted_at: null, value: {
    version: 1, code, target: targetSnapshot(set), weight: suggestion.weight ?? null, reps: suggestion.reps ?? null,
    unit: suggestion.unit ?? 'kg', seconds: suggestion.seconds ?? null, source: source ? sourceSnapshot(source) : null,
  } } };
}

export function targetReason(set, setting, sets = new Map()) {
  const value = setting?.value;
  if (!set || !setting || setting.deleted_at != null || setting.id !== `target-reason:${set.id}` || value?.version !== 1) return null;
  if (!Object.hasOwn(targetReasons, value.code) || !['kg', 'lb'].includes(value.unit) || ![value.weight, value.reps, value.seconds].every(number => number === null || (Number.isFinite(number) && number >= 0))) return null;
  if (JSON.stringify(value.target) !== JSON.stringify(targetSnapshot(set))) return null;
  if (value.source != null) {
    const source = Array.isArray(value.source) && sets.get(value.source[0]);
    if (!source || source.deleted_at != null || source.done_at == null || JSON.stringify(value.source) !== JSON.stringify(sourceSnapshot(source))) return null;
  }
  if (set.done_at == null) {
    const prior = [...sets.values()].filter(row => row.deleted_at == null && row.done_at != null && row.session_slot_id === set.session_slot_id && row.position < set.position).sort((a, b) => a.position - b.position).at(-1);
    const shown = carryForward(set, prior);
    if (shown !== set && (shown.weight !== value.weight || shown.unit !== value.unit || shown.reps !== value.reps)) return null;
  }
  return value;
}

export function removeTargetReasons(data, sets, now = Date.now()) {
  const ids = new Set(sets.map(set => `target-reason:${set.id}`));
  return (data.setting ?? []).filter(row => row.deleted_at == null && ids.has(row.id)).map(row => ({ table: 'setting', row: { id: row.id, deleted_at: now } }));
}
