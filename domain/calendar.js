import { live } from './model.js';

export const addDays = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export const todayDate = (now = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(now));
export const weekday = date => new Date(`${date}T12:00:00Z`).getUTCDay();

export function settingAt(settings, date) {
  return settings.filter(row => row.from_date <= date).sort((a, b) => b.from_date.localeCompare(a.from_date) || b.rev - a.rev)[0];
}

export function chooseRun(data, programId, date = todayDate()) {
  let selected = live(data.run).filter(row => row.program_id === programId && row.status !== 'done').at(-1);
  const changes = [], settings = live(data.run_setting);
  if (!selected) {
    selected = { id: crypto.randomUUID(), program_id: programId, start_date: date, next_position: 0, status: 'active' };
    changes.push({ table: 'run', row: selected });
  }
  const current = live(data.setting).find(row => row.id === 'current_run')?.value;
  for (const id of new Set([current, selected.id])) {
    if (!id) continue;
    const own = settings.filter(row => row.run_id === id), latest = settingAt(own, date);
    const weekdays = latest?.weekdays ?? [1,2,3,4,5,6];
    changes.push({ table: 'run_setting', row: { id: latest?.from_date === date ? latest.id : crypto.randomUUID(), run_id: id, from_date: date,
      days_per_week: weekdays.length, weekdays, weekly_target: id === selected.id ? weekdays.length : 0 } });
  }
  changes.push({ table: 'setting', row: { id: 'current_run', value: selected.id } });
  return changes;
}
export function projectCalendar(data, run, from, to, today = todayDate()) {
  if (!run) return [];
  const days = live(data.program_day).filter(day => day.program_id === run.program_id).sort((a, b) => a.position - b.position);
  const events = live(data.run_event).filter(event => event.run_id === run.id);
  const settings = live(data.run_setting).filter(setting => setting.run_id === run.id);
  const sessions = live(data.session).filter(session => session.run_id === run.id);
  const complete = new Set(events.filter(event => event.kind === 'done' || (event.kind === 'skipped' && event.position != null)).map(event => event.position));
  const finishedDates = new Set(sessions.filter(session => session.program_day_id != null && session.status !== 'open').map(session => session.local_date));
  const reservations = events.filter(event => {
    const date = event.to_date ?? event.local_date;
    return ['moved', 'added'].includes(event.kind) && event.position != null && !complete.has(event.position)
      && date >= today && !finishedDates.has(date) && !onLeave(events, run, date);
  });
  const reserved = new Set(reservations.map(event => event.position));
  const remaining = days.filter(day => day.position >= run.next_position && !complete.has(day.position) && !reserved.has(day.position));
  const planned = new Map(); let cursor = 0;
  for (let date = today > run.start_date ? today : run.start_date; date <= to; date = addDays(date, 1)) {
    if (onLeave(events, run, date) || finishedDates.has(date)) continue;
    const reservedHere = reservations.find(event => (event.to_date ?? event.local_date) === date);
    if (reservedHere) { planned.set(date, { state: reservedHere.kind === 'added' ? 'added' : 'planned', day: days.find(day => day.position === reservedHere.position) }); continue; }
    if (events.some(event => event.kind === 'skipped' && event.local_date === date)) continue;
    const movedFrom = reservations.some(event => event.kind === 'moved' && event.local_date === date);
    if (movedFrom) continue;
    if (!settingAt(settings, date)?.weekdays.includes(weekday(date)) || !remaining[cursor]) continue;
    let targetDate = date;
    for (const shift of events.filter(event => event.kind === 'moved' && event.reason === 'shift_rest' && event.position == null && date >= event.local_date)) {
      targetDate = addDays(targetDate, Math.round((Date.parse(shift.to_date) - Date.parse(shift.local_date)) / 86400000));
    }
    if (targetDate >= today) planned.set(targetDate, { state: 'planned', day: remaining[cursor++] });
  }
  const result = [];
  for (let date = from; date <= to; date = addDays(date, 1)) result.push(calendarDay(date, today, run, events, settings, sessions, planned, days));
  return result;
}

function onLeave(events, run, date) {
  return events.some(event => event.kind === 'leave' && date >= event.local_date && (event.to_date ? date <= event.to_date : run.status === 'paused'));
}

function calendarDay(date, today, run, events, settings, sessions, planned, days) {
  const onDate = sessions.filter(session => session.local_date === date);
  const done = onDate.filter(session => session.status !== 'open');
  // Extras on a date keep its planned program workout, so it still counts and can still be started.
  if (events.some(event => event.kind === 'added' && event.position == null && event.local_date === date)) return { date, state: 'added', sessions: onDate, ...(planned.get(date)?.day && { day: planned.get(date).day }) };
  if (done.length) return { date, state: events.some(event => event.kind === 'added' && event.local_date === date) ? 'added' : 'done', sessions: done };
  if (onDate.length) return { date, state: 'planned', sessions: onDate, day: days.find(day=>day.id===onDate[0].program_day_id) };
  if (date < run.start_date) return { date, state: 'rest' };
  if (onLeave(events, run, date)) return { date, state: 'leave' };
  if (planned.has(date)) return { date, ...planned.get(date) };
  if (events.some(event => event.kind === 'skipped' && event.local_date === date)) return { date, state: 'skipped' };
  if (events.some(event => event.kind === 'moved' && event.position != null && event.local_date === date)) return { date, state: 'moved' };
  if (date < today) return { date, state: settingAt(settings, date)?.weekdays.includes(weekday(date)) ? 'not_done' : 'rest' };
  return { date, ...(planned.get(date) || { state: 'rest' }) };
}

export function copyProgram(data, programId, name) {
  const program = live(data.program).find(row => row.id === programId);
  if (!program) throw new Error('Choose a program first.');
  const id = crypto.randomUUID(), changes = [{ table: 'program', row: { id, name, source: 'copy' } }];
  for (const day of live(data.program_day).filter(row => row.program_id === programId)) {
    changes.push(...cloneDay(data, day, id, day.position));
  }
  return { id, changes };
}

function cloneDay(data, day, programId, position) {
  const dayId = crypto.randomUUID(), changes = [{ table: 'program_day', row: { id: dayId, program_id: programId, position, week: day.week ?? null, day: day.day ?? null, title: day.title ?? '' } }];
  for (const slot of live(data.slot).filter(row => row.program_day_id === day.id)) {
    const slotId = crypto.randomUUID(), { rev, seq, device_id, updated_at, deleted_at, ...fields } = slot;
    changes.push({ table: 'slot', row: { ...fields, id: slotId, program_day_id: dayId } });
    for (const set of live(data.slot_set).filter(row => row.slot_id === slot.id)) {
      const { rev, seq, device_id, updated_at, deleted_at, ...fields } = set;
      changes.push({ table: 'slot_set', row: { ...fields, id: crypto.randomUUID(), slot_id: slotId } });
    }
  }
  return changes;
}
