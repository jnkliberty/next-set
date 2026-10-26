import { live } from './model.js';

export const positionOrder = (a, b) => a.position - b.position || a.id.localeCompare(b.id, 'en');
const memberKey = slot => `${slot.position}:${slot.planned_exercise_id ?? slot.exercise_id ?? slot.id}`;

function groupRounds(members, setsOf) {
  const all = members.flatMap(setsOf);
  if (members.some(slot => slot.group_kind !== 'superset') || all.some(set => !['working', 'warmup'].includes(set.type))) return null;
  // A partial swap splits one member across slots while retaining its position and planned exercise.
  const parts = Map.groupBy(members, memberKey);
  const working = [...parts.values()].map(slots => slots.flatMap(setsOf).filter(set => set.type === 'working').sort(positionOrder));
  const seconds = Math.max(...members.map(slot => slot.rest_seconds ?? 90));
  const rounds = members.flatMap(slot => setsOf(slot).filter(set => set.type === 'warmup').map(set => ({ sets: [set], seconds: slot.rest_seconds ?? 90 })));
  for (let i = 0; i < Math.max(0, ...working.map(sets => sets.length)); i++) rounds.push({ sets: working.map(sets => sets[i]).filter(Boolean), seconds });
  return rounds;
}

export function sessionFlow(slots, sets) {
  const ordered = live(slots).sort(positionOrder), ids = new Set(ordered.map(slot => slot.id));
  const bySlot = Map.groupBy(live(sets).filter(set => ids.has(set.session_slot_id)).sort(positionOrder), set => set.session_slot_id);
  const setsOf = slot => bySlot.get(slot.id) ?? [], visited = new Set(), rounds = [], guided = new Set(), memberNumbers = new Map();
  for (const slot of ordered) {
    if (visited.has(slot.id)) continue;
    const members = slot.group_id ? ordered.filter(other => other.group_id === slot.group_id) : [];
    const group = members.length > 1 ? groupRounds(members, setsOf) : null;
    if (group) {
      const keys = [...new Set(members.map(memberKey))];
      rounds.push(...group); members.forEach(member => { visited.add(member.id); guided.add(member.id); memberNumbers.set(member.id, keys.indexOf(memberKey(member)) + 1); });
    } else rounds.push(...setsOf(slot).map(set => ({ sets: [set], seconds: slot.rest_seconds ?? 90 })));
  }
  const sequence = rounds.flatMap(round => round.sets), next = sequence.find(set => set.done_at == null);
  const last = sequence.filter(set => set.done_at != null).sort((a, b) => a.done_at - b.done_at || a.id.localeCompare(b.id, 'en')).at(-1);
  const round = last && rounds.find(round => round.sets.includes(last));
  const rest = next && round?.sets.every(set => set.done_at != null) ? { id: `${last.id}:${last.done_at}:${round.seconds}`, end: last.done_at + round.seconds * 1000, seconds: round.seconds } : null;
  return { next, last, rest, guided, memberNumbers };
}
