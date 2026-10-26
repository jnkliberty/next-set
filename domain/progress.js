import { addDays, weekday } from './calendar.js';
import { byId, exerciseIdentity, live, working } from './model.js';
import { estimatedMax, hardChains, progressMark, sessionSummary } from './metrics.js';
import { weightGrid, weightIn } from './targets.js';

export const BODY_AREAS = {
  Chest: ['chest'], Back: ['lats', 'middle back', 'lower back', 'traps'],
  Shoulders: ['shoulders'], Arms: ['biceps', 'triceps', 'forearms'],
  Legs: ['quadriceps', 'hamstrings', 'glutes', 'calves', 'abductors', 'adductors'],
  Core: ['abdominals'], Other: ['neck'],
};
const areas = muscles => [...new Set(muscles.map(muscle => Object.keys(BODY_AREAS).find(area => BODY_AREAS[area].includes(muscle)) ?? 'Other'))];
export const dateTime = date => Date.parse(`${date}T12:00:00Z`);

export function progressRange(range, today, earliest = today) {
  if (range === 'all') return [earliest < today ? earliest : today, today];
  if (/^\d{4}$/.test(range)) return [`${range}-01-01`, `${range}-12-31` < today ? `${range}-12-31` : today];
  return [addDays(today, -(range === '4w' ? 27 : range === '1y' ? 364 : 83)), today];
}

function tags(exercise) {
  const primary = exercise?.primary ?? [], secondary = exercise?.secondary ?? [];
  return { primary, secondary, primaryAreas: primary.length ? areas(primary) : ['Other'], secondaryAreas: areas(secondary) };
}

function comparable(set) {
  return ['kg', 'lb'].includes(set.unit) && Number.isFinite(set.weight);
}

function recordValues(sets, exercise, provisional) {
  const normal = sets.filter(set => !['drop', 'rest_pause'].includes(set.type));
  const weighted = provisional ? [] : normal.filter(comparable).map(set => ({ ...set, weight: weightIn(set), grams: weightIn(set) * 1000, unit: 'kg' }));
  const estimates = exercise ? weighted.map(set => ({ set, estimate: estimatedMax(set, exercise) })).filter(row => row.estimate) : [];
  const best = estimates.sort((a, b) => b.estimate.value - a.estimate.value)[0];
  const max = values => values.length ? Math.max(...values) : null;
  return { estimate: best?.estimate.value ?? null, estimateSet: best?.set, assumed: best?.estimate.assumed ?? false,
    load: max(weighted.map(set => set.weight)), reps: max(normal.filter(set => set.reps != null).map(set => set.reps)),
    seconds: max(normal.filter(set => set.seconds != null).map(set => set.seconds)) };
}

function addLift(lifts, exercise, slot, sets, session) {
  if (!sets.length || exercise?.conditioning) return;
  let lift = lifts.get(slot.exercise_id);
  if (!lift) {
    lift = { id: slot.exercise_id, name: exercise?.name ?? slot.name ?? 'Unclassified exercise', exercise, ...tags(exercise), records: [] };
    lifts.set(lift.id, lift);
  }
  let record = lift.records.find(row => row.sessionId === session.id);
  if (!record) {
    record = { sessionId: session.id, date: session.local_date, time: dateTime(session.local_date), off: !!session.off,
      provisional: session.source === 'stoppani', sets: [] };
    lift.records.push(record);
  }
  record.sets.push(...sets);
  Object.assign(record, recordValues(record.sets, exercise, record.provisional));
}

function sessionPart(session, slots, setsBySlot, exercises, lifts, work) {
  const ownSets = [];
  for (const slot of slots) {
    const exercise = exercises.get(slot.exercise_id), sets = setsBySlot.get(slot.id) ?? [];
    const completed = sets.filter(set => working(set) || (set.type === 'timed' && set.done_at != null));
    addLift(lifts, exercise, slot, completed, session);
    if (!exercise?.conditioning) work.push({ date: session.local_date, hard: hardChains(sets.filter(working)), ...tags(exercise) });
    // shortcut: imported units remain provisional; include loads after import review supplies approval metadata.
    ownSets.push(...sets.map(set => !exercise || session.source === 'stoppani' || !comparable(set) ? { ...set, weight: null, grams: null } : set));
  }
  return sessionSummary({ exercise: [...exercises.values()], session_slot: slots, set: ownSets }, session);
}

export function progressData(data, from, to) {
  const exercises = byId(data.exercise), lifts = new Map(), work = [];
  const sessions = live(data.session).filter(row => row.local_date >= from && row.local_date <= to).sort((a, b) => a.started_at - b.started_at);
  const slots = Map.groupBy(live(data.session_slot).map(slot => ({ ...slot, exercise_id: exerciseIdentity(exercises, slot.exercise_id) })), row => row.session_id);
  const sets = Map.groupBy(live(data.set).sort((a, b) => a.position - b.position), row => row.session_slot_id);
  const days = new Map(), effort = { logged: 0, sets: 0, load: 0 };
  for (let date = from; date <= to; date = addDays(date, 1)) days.set(date, { date, sessions: 0, sets: 0, hardSets: 0, minutes: 0, volumeKg: 0, incompleteVolume: false, sessionIds: [] });
  for (const session of sessions.filter(row => row.status !== 'open')) {
    const part = sessionPart(session, slots.get(session.id) ?? [], sets, exercises, lifts, work), day = days.get(session.local_date);
    day.sessions++; day.sessionIds.push(session.id);
    effort.logged += part.logged; effort.sets += part.sets; effort.load += part.trainingLoad;
    for (const key of ['sets', 'hardSets', 'minutes', 'volumeKg']) day[key] += part[key];
    day.incompleteVolume ||= part.missingBodyweight;
  }
  const values = [...days.values()], totals = { sessions: 0, sets: 0, hardSets: 0, minutes: 0, volumeKg: 0, incompleteVolume: false };
  for (const day of values) {
    for (const key of ['sessions', 'sets', 'hardSets', 'minutes', 'volumeKg']) totals[key] += day[key];
    totals.incompleteVolume ||= day.incompleteVolume;
  }
  return { from, to, days: values, totals, work, effort, lifts: [...lifts.values()].sort((a, b) => a.name.localeCompare(b.name)),
    openSessions: sessions.filter(row => row.status === 'open').length,
    provisionalSessions: sessions.filter(row => row.status !== 'open' && row.source === 'stoppani').length };
}

export function matchesArea(lift, area, secondary = false, muscle = '') {
  if (muscle) return lift.primary.includes(muscle) || (secondary && lift.secondary.includes(muscle));
  return area === 'All areas' || lift.primaryAreas.includes(area) || (secondary && lift.secondaryAreas.includes(area));
}

export function areaWork(progress, area = 'All areas', secondary = false, muscle = '') {
  const weeks = new Map();
  for (const day of progress.days) {
    const date = addDays(day.date, -weekday(day.date));
    if (!weeks.has(date)) weeks.set(date, { date, sets: 0 });
  }
  for (const row of progress.work) {
    const direct = muscle ? row.primary.includes(muscle) : area === 'All areas' || row.primaryAreas.includes(area);
    const indirect = muscle ? row.secondary.includes(muscle) : row.secondaryAreas.includes(area);
    const multiplier = direct ? 1 : secondary && indirect ? 0.5 : 0;
    weeks.get(addDays(row.date, -weekday(row.date))).sets += row.hard * multiplier;
  }
  return [...weeks.values()];
}

export function liftSeries(lift, metric) {
  return lift.records.filter(row => !row.off && !row.provisional && row[metric] != null).map(row => ({ ...row, value: row[metric] }));
}

export function strengthChange(lift, points) {
  if (points.length < 2 || !points[0].value) return null;
  const first = points[0].value, last = points.at(-1).value, set = points.at(-1).estimateSet;
  if (!set) return { delta: (last / first - 1) * 100, mark: null };
  const estimate = estimatedMax(set, lift.exercise), weight = weightIn(set);
  const grid = weightGrid(lift.exercise?.equipment, 'kg', points.map(row => row.estimateSet?.weight).filter(Number.isFinite));
  const floor = { stepPercent: 100 * (grid.step(weight, 1) - weight) / (estimate.value / (1 + estimate.reps / 30)), repPercent: 100 / (30 + estimate.reps) };
  return { ...progressMark(points.map(row => row.value), first, last, floor), delta: (last / first - 1) * 100 };
}
