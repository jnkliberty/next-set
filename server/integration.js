import { timingSafeEqual } from 'node:crypto';
import { live, working } from '../domain/model.js';
import { sessionSummary } from '../domain/metrics.js';
import { LB_TO_KG } from '../domain/targets.js';
import { projectCalendar, todayDate } from '../domain/calendar.js';
import { integrationRecord } from '../domain/integration-record.js';

export function validHealthAdvisory(value, subjectId, now = Date.now()) {
  const keys = ['schemaVersion', 'source', 'subjectId', 'advisoryId', 'day', 'policyVersion', 'sourceRevision', 'generatedAt', 'validUntil', 'computed', 'shown', 'headline', 'ruleWords', 'missing', 'sets', 'overridden', 'freshness'];
  const metrics = ['sleep', 'hrv', 'rhr', 'temperature', 'steps'];
  const utc = item => typeof item === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(item) && Number.isFinite(Date.parse(item));
  const date = item => typeof item === 'string' && /^\d{4}-\d\d-\d\d$/.test(item) && Number.isFinite(Date.parse(`${item}T12:00:00Z`)) && new Date(`${item}T12:00:00Z`).toISOString().slice(0, 10) === item;
  const exactKeys = (object, expected) => object && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).sort().join(',') === [...expected].sort().join(',');
  const freshness = value?.freshness;
  const validFreshness = exactKeys(freshness, ['measuredOn', 'stale']) && exactKeys(freshness.measuredOn, metrics) && metrics.every(key => freshness.measuredOn[key] === null || date(freshness.measuredOn[key]))
    && exactKeys(freshness.stale, metrics) && metrics.every(key => typeof freshness.stale[key] === 'boolean');
  const validSets = value?.sets === null || exactKeys(value?.sets, ['low', 'high']) && Number.isFinite(value.sets.low) && value.sets.low >= 0 && Number.isFinite(value.sets.high) && value.sets.high >= value.sets.low;
  return !!value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
    && value.schemaVersion === 1 && value.source === 'health' && value.subjectId === subjectId && typeof value.advisoryId === 'string' && value.advisoryId.length > 0 && value.advisoryId.length <= 200
    && date(value.day) && typeof value.policyVersion === 'string' && value.policyVersion.length > 0 && value.policyVersion.length <= 100 && typeof value.sourceRevision === 'string' && /^.{1,100}$/.test(value.sourceRevision)
    && utc(value.generatedAt) && utc(value.validUntil) && Date.parse(value.validUntil) - Date.parse(value.generatedAt) === 60000 && Date.parse(value.generatedAt) <= now + 30000 && Date.parse(value.validUntil) > now
    && ['train', 'lighter', 'rest', 'not_enough_data'].includes(value.computed) && ['train', 'lighter', 'rest', 'not_enough_data'].includes(value.shown)
    && (typeof value.headline === 'string' && value.headline.length <= 2000) && typeof value.ruleWords === 'string' && value.ruleWords.length <= 10000
    && Array.isArray(value.missing) && value.missing.length <= 50 && value.missing.every(item => typeof item === 'string' && item.length <= 500)
    && validSets && typeof value.overridden === 'boolean' && validFreshness;
}


function validDate(value) {
  if (!/^\d{4}-\d\d-\d\d$/.test(value || '')) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function chicagoMidnight(date) {
  const wanted = Date.parse(`${date}T00:00:00Z`);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(guess);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    guess += wanted - Date.UTC(+values.year, +values.month - 1, +values.day, +values.hour, +values.minute, +values.second);
  }
  return new Date(guess).toISOString();
}

export function integrationRevision(sequence, now = Date.now()) {
  const digits = String(sequence);
  if (!/^(0|[1-9]\d*)$/.test(digits) || BigInt(digits) >= 10n ** 19n) throw new RangeError('Invalid integration sequence');
  const date = BigInt(todayDate(now).replaceAll('-', ''));
  return String(date * 10n ** 19n + BigInt(digits));
}

export function dailyIntegration(data, from, to, subjectId, sourceRevision, now = Date.now()) {
  const allSessions = live(data.session), sessions = allSessions.filter(session => session.local_date >= from && session.local_date <= to);
  const events = live(data.event).map(event => ({ event, record: integrationRecord(event) })).filter(row => row.record);
  const days = [];
  for (let date = from; date <= to; date = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
    const rows = sessions.filter(session => session.local_date === date), completed = rows.filter(session => session.status !== 'open');
    const parts = rows.map(session => sessionSummary(data, session, null));
    const completedParts = rows.map((session, i) => session.status === 'open' ? null : parts[i]).filter(Boolean);
    const effortSources = new Set(completed.map(session => session.effort != null ? 'sessionRpe' : 'setRpeAverage'));
    const muscles = {}, musclesDirect = {};
    for (const part of completedParts) for (const key of ['muscles', 'musclesDirect']) for (const [muscle, count] of Object.entries(part[key])) {
      const target = key === 'muscles' ? muscles : musclesDirect; target[muscle] = (target[muscle] || 0) + count;
    }
    const setRows = completed.flatMap(session => {
      const slots = new Set(live(data.session_slot).filter(slot => slot.session_id === session.id).map(slot => slot.id));
      return live(data.set).filter(set => slots.has(set.session_slot_id) && set.done_at != null && working(set));
    });
    const volumeKg = completedParts.reduce((sum, part) => sum + part.volumeKg, 0);
    const details = rows.map(session => {
      const ownEvents = events.filter(({ event }) => event.session_id === session.id);
      const choice = ownEvents.map(row => row.record).find(record => record.recordType === 'session_choice');
      const slots = live(data.session_slot).filter(slot => slot.session_id === session.id);
      const original = ownEvents.map(row => row.record).filter(record => record.recordType === 'original_plan');
      const completeOriginal = slots.length > 0 && original.length === slots.length && slots.every(slot => original.some(record => record.slotId === slot.id));
      const originalPlannedWorkingSets = completeOriginal ? original.reduce((sum, record) => sum + record.targets.filter(target => ['working', 'failure', 'drop', 'rest_pause'].includes(target.type)).length, 0) : null;
      const slotIds = new Set(slots.map(slot => slot.id));
      const completedWorkingSets = live(data.set).filter(set => slotIds.has(set.session_slot_id) && working(set)).length;
      return { id: session.id, start: new Date(session.started_at).toISOString(), end: session.ended_at == null ? null : new Date(session.ended_at).toISOString(), localDate: session.local_date, timezone: session.timezone || 'America/Chicago', status: session.status, programDayId: session.program_day_id ?? null, closeReason: choice?.reason ?? null, advisoryId: choice?.advisoryId ?? null, originalPlannedWorkingSets, completedWorkingSets };
    });
    days.push({ date, sessions: completed.length, sets: completedParts.reduce((sum, part) => sum + part.sets, 0), hardSets: completedParts.reduce((sum, part) => sum + part.hardSets, 0), volumeLb: volumeKg / LB_TO_KG, minutes: completedParts.reduce((sum, part) => sum + part.minutes, 0), trainingLoad: completedParts.reduce((sum, part) => sum + part.trainingLoad, 0), trainingLoadSource: effortSources.size > 1 ? 'mixed' : [...effortSources][0] ?? null, rpeCoverage: setRows.length ? setRows.filter(set => set.reps_left != null).length / setRows.length : null, muscles, musclesDirect, openSessions: rows.filter(session => session.status === 'open').length, recordState: rows.some(session => session.status === 'open') ? 'open' : completed.length ? 'recorded' : 'no_record', volumeComplete: completedParts.every(part => !part.missingBodyweight), effort: { recordedSets: setRows.filter(set => set.reps_left != null).length, assumedSets: setRows.filter(set => set.reps_left == null).length, sessionRatedSessions: completed.filter(session => session.effort != null).length }, sessionsDetail: details });
  }
  const today = todayDate(now), runId = live(data.setting).find(row => row.id === 'current_run')?.value;
  const run = live(data.run).find(row => row.id === runId) || live(data.run).filter(row => row.status === 'active' || row.status === 'paused').at(-1);
  const open = allSessions.find(session => session.status === 'open' && session.local_date === today);
  const planned = run && !open ? projectCalendar(data, run, today, today, today).find(row => row.state === 'planned' && row.day) : null;
  const day = planned?.day;
  const slots = day ? live(data.slot).filter(slot => slot.program_day_id === day.id) : [];
  const plan = open ? { status: 'open', programDayId: open.program_day_id ?? null, sessionId: open.id, label: live(data.program_day).find(row => row.id === open.program_day_id)?.title ?? null, exerciseCount: live(data.session_slot).filter(slot => slot.session_id === open.id).length, plannedSets: live(data.set).filter(set => live(data.session_slot).some(slot => slot.id === set.session_slot_id && slot.session_id === open.id)).length }
    : day ? { status: 'planned', programDayId: day.id, sessionId: null, label: day.title ?? null, exerciseCount: slots.length, plannedSets: slots.reduce((sum, slot) => sum + live(data.slot_set).filter(set => set.slot_id === slot.id).length, 0) }
      : { status: 'unavailable', programDayId: null, sessionId: null, label: null, exerciseCount: null, plannedSets: null };
  return { schemaVersion: 1, source: 'workout', subjectId, reportingZone: 'America/Chicago', interval: { from: chicagoMidnight(from), to: chicagoMidnight(new Date(Date.parse(`${to}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) }, generatedAt: new Date(now).toISOString(), sourceRevision, coverage: { server: 'complete', phone: 'unknown' }, days, plan };
}

export function sameCredential(expected, supplied) {
  if (typeof expected !== 'string' || !expected || typeof supplied !== 'string') return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
