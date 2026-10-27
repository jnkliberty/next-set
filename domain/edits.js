import { live, byId } from './model.js';
import { createSession, instantiateSlot } from './session.js';
import { removeTargetReasons } from './targets.js';

const remove = (table, id) => ({ table, row: { id, deleted_at: Date.now() } });
const plans = (count, low, high, type = 'working', seconds = 30) => Array.from({ length: count }, (_, position) => ({ position, type, reps_min: ['timed','failure'].includes(type) ? null : low, reps_max: ['timed','failure'].includes(type) ? null : high, seconds: type === 'timed' ? seconds : null, target_effort: type === 'failure' ? 10 : 8 }));

export function addExtraSets(data, run, date, edit) {
  const created = createSession(data, { id: null }, run);
  const session = { ...created.changes[0].row, local_date: date };
  const added = editWorkout(data, { ...edit, run, session, action: 'add', scope: 'today' });
  return { sessionId: session.id, changes: [{ table: 'session', row: session }, ...added.changes,
    ...(run ? [{ table: 'run_event', row: { id: crypto.randomUUID(), run_id: run.id, kind: 'added', local_date: date, session_id: session.id, position: null } }] : [])] };
}

// Program tab: change templates only. 'program' reaches this day number in every week; 'week' reaches this one day.
export function editProgram(data, { day, slot, action, exerciseId, count = 2, low = 4, high = 6, type = 'working', seconds = 30, rest = null, scope = 'week', title = undefined, targetPosition = undefined }) {
  check(count, low, high, type, seconds);
  const days = scope === 'week' ? [day] : live(data.program_day).filter(row => row.program_id === day.program_id && row.day === day.day);
  if (action === 'title') {
    if (typeof title !== 'string' || title.trim().length > 200) throw new Error('Use a day name of up to 200 characters.');
    return { changes: days.map(own => ({table:'program_day',row:{id:own.id,title:title.trim()}})) };
  }
  return { changes: days.flatMap(own => editTemplate(data, own, slot, { action, exerciseId, count, low, high, type, seconds, rest, title, targetPosition })) };
}

// Merge partial row changes, so several edits can build on each other before one save.
export function withChanges(data, changes) {
  const next = { ...data };
  for (const { table, row } of changes) {
    const rows = next[table] = [...(next[table] || [])], i = rows.findIndex(own => own.id === row.id);
    if (i < 0) rows.push(row); else rows[i] = { ...rows[i], ...row };
  }
  return next;
}

function check(count, low, high, type, seconds) {
  if (!Number.isInteger(count) || count < 1 || count > 8 || !Number.isInteger(low) || !Number.isInteger(high) || low < 1 || high < low) throw new Error('Use 1 to 8 sets and a valid rep range.');
  if (!['working','warmup','drop','rest_pause','timed','failure'].includes(type) || !Number.isFinite(seconds) || seconds < 1) throw new Error('Choose a valid set type and duration.');
}

export function editWorkout(data, { day, run, session, slot, action, exerciseId, count = 2, low = 4, high = 6, type = 'working', seconds = 30, rest = null, scope = 'today', targetPosition = undefined }) {
  check(count, low, high, type, seconds);
  let initial = [];
  if (!session) { initial = createSession(data, day, run).changes; session = initial[0].row; }
  const current = withChanges(data, initial);
  const sessionSlots = live(current.session_slot).filter(row => row.session_id === session.id);
  const target = slot && (sessionSlots.find(row => row.id === slot.id) ?? sessionSlots.find(row => row.position === slot.position && row.planned_exercise_id === (slot.planned_exercise_id ?? slot.exercise_id)));
  const changes = [...initial, ...editSession(current, session, sessionSlots, target, { action, exerciseId, count, low, high, type, seconds, rest, targetPosition })];
  if (scope !== 'today') {
    const days = live(data.program_day).filter(row => row.program_id === day.program_id && row.day === day.day && (scope === 'program' || row.position >= day.position));
    for (const own of days) changes.push(...editTemplate(data, own, slot, { action, exerciseId, count, low, high, type, seconds, rest, targetPosition }));
  }
  return { changes, sessionId: session.id };
}

function editSession(data, session, slots, slot, edit) {
  const { action, exerciseId, count, low, high, type, seconds, rest } = edit;
  const sets = live(data.set).filter(row => row.session_slot_id === slot?.id), logged = sets.filter(row => row.done_at != null), pending = sets.filter(row => row.done_at == null);
  if (action === 'add') return instantiateSlot(data, session, { exercise_id: exerciseId, position: Math.max(-1, ...slots.map(row => row.position)) + 1, rest_seconds: rest ?? 90 }, plans(count, low, high, type, seconds));
  if (!slot) throw new Error('This exercise is no longer in the workout.');
  const layout = editLayout('session_slot', slots, slot, edit);
  if (layout) return layout;
  if (action === 'move') {
    const order = [...slots].sort((a,b) => a.position-b.position), index = order.findIndex(row => row.id === slot.id), other = order[index - 1];
    return other ? [{ table: 'session_slot', row: { id: slot.id, position: other.position } }, { table: 'session_slot', row: { id: other.id, position: slot.position } }] : [];
  }
  const changes = [...pending.map(row => remove('set', row.id)), ...removeTargetReasons(data, pending)];
  if (action === 'remove' || action === 'swap') {
    if (!logged.length) changes.push(remove('session_slot', slot.id));
    if (action === 'swap' && pending.length) changes.push(...instantiateSlot(data, session, { ...slot, exercise_id: exerciseId }, pending.map(row => ({ position: row.position, type: row.type, reps_min: row.target_reps_min, reps_max: row.target_reps_max, seconds: row.target_seconds, target_effort: row.target_effort }))));
    return changes;
  }
  if (count < logged.length) throw new Error(`Keep at least ${logged.length} sets. Those sets are already logged.`);
  if (rest != null) changes.push({ table: 'session_slot', row: { id: slot.id, rest_seconds: rest } });
  const fresh = instantiateSlot(data, session, slot, plans(count - logged.length, low, high, type, seconds));
  changes.push(...fresh.filter(row => row.table === 'set').map((row,i) => ({ ...row, row: { ...row.row, session_slot_id: slot.id, position: Math.max(-1,...logged.map(row=>row.position)) + i + 1 } })));
  changes.push(...fresh.filter(row => row.table === 'setting' && row.row.id.startsWith('target-reason:')));
  return changes;
}

function editTemplate(data, day, original, edit) {
  const slots = live(data.slot).filter(row => row.program_day_id === day.id), { action, exerciseId, count, low, high, type, seconds, rest } = edit;
  const slot = slots.find(row => row.position === original?.position && row.exercise_id === (original?.planned_exercise_id ?? original?.exercise_id));
  if (action === 'add') {
    const id = crypto.randomUUID();
    return [{ table: 'slot', row: { id, program_day_id: day.id, position: Math.max(-1,...slots.map(row=>row.position))+1, exercise_id: exerciseId, rest_seconds: rest ?? 90 } }, ...plans(count,low,high,type,seconds).map(plan=>({table:'slot_set',row:{...plan,id:crypto.randomUUID(),slot_id:id}}))];
  }
  if (!slot) return [];
  const layout = editLayout('slot', slots, slot, edit);
  if (layout) return layout;
  if (action === 'swap') return [{ table: 'slot', row: { id: slot.id, exercise_id: exerciseId } }];
  if (action === 'move') {
    const other = slots.filter(row=>row.position<slot.position).sort((a,b)=>b.position-a.position)[0];
    return other ? [{ table:'slot',row:{id:slot.id,position:other.position}},{table:'slot',row:{id:other.id,position:slot.position}}] : [];
  }
  const changes = live(data.slot_set).filter(row=>row.slot_id===slot.id).map(row=>remove('slot_set',row.id));
  if (action === 'remove') changes.push(remove('slot',slot.id));
  else changes.push(...plans(count,low,high,type,seconds).map(plan=>({table:'slot_set',row:{...plan,id:crypto.randomUUID(),slot_id:slot.id}})), ...(rest == null ? [] : [{ table: 'slot', row: { id: slot.id, rest_seconds: rest } }]));
  return changes;
}

function editLayout(table, slots, slot, {action,targetPosition}) {
  const order=[...slots].sort((a,b)=>a.position-b.position), index=order.findIndex(row=>row.id===slot.id);
  if(action==='reorder') {
    if(!Number.isInteger(targetPosition)||targetPosition<0||targetPosition>=order.length)throw new Error('Choose a valid exercise position.');
    order.splice(index,1);order.splice(targetPosition,0,slot);
    return order.map((row,position)=>({table,row:{id:row.id,position}}));
  }
  if(action==='ungroup')return order.filter(row=>row.group_id&&row.group_id===slot.group_id).map(row=>({table,row:{id:row.id,group_id:null,group_kind:null}}));
  if(action!=='group')return null;
  const next=order[index+1];
  if(!next)throw new Error('Choose an exercise with another exercise after it.');
  const groupId=slot.group_id??next.group_id??crypto.randomUUID();
  return order.filter(row=>row.id===slot.id||row.id===next.id||(slot.group_id&&row.group_id===slot.group_id)||(next.group_id&&row.group_id===next.group_id)).map(row=>({table,row:{id:row.id,group_id:groupId,group_kind:'superset'}}));
}
