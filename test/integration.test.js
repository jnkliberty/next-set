import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyIntegration, integrationRevision, validHealthAdvisory } from '../server/integration.js';
import { integrationEvent, integrationRecord } from '../domain/integration-record.js';
import { finishChanges } from '../domain/session.js';

function fixture() {
  return {
    session: [
      { id: 'complete', status: 'finished_early', run_id: 'run', program_day_id: 'day', local_date: '2026-03-08', timezone: 'America/Chicago', started_at: Date.parse('2026-03-08T15:00:00Z'), ended_at: Date.parse('2026-03-08T15:30:00Z'), effort: null },
      { id: 'open', status: 'open', run_id: 'run', program_day_id: 'day', local_date: '2026-03-08', timezone: 'America/Chicago', started_at: Date.parse('2026-03-08T18:00:00Z'), ended_at: null, effort: null },
    ],
    session_slot: [{ id: 'slot', session_id: 'complete', exercise_id: 'ex' }, { id: 'open-slot', session_id: 'open', exercise_id: 'ex' }],
    exercise: [{ id: 'ex', name: 'Fixture lift', conditioning: false, weight_basis: 'added_to_bodyweight', primary: ['chest'], secondary: ['triceps'] }],
    set: [
      { id: 'recorded', session_slot_id: 'slot', type: 'working', done_at: 1, reps: 8, reps_left: 2, effort_source: 'logged', target_effort: 8, grams: 5000, bodyweight_grams: null, position: 0 },
      { id: 'assumed', session_slot_id: 'slot', type: 'working', done_at: 2, reps: 8, reps_left: null, effort_source: 'assumed', target_effort: 7, grams: 5000, bodyweight_grams: null, position: 1 },
      { id: 'open-set', session_slot_id: 'open-slot', type: 'working', done_at: 3, reps: 8, reps_left: 1, effort_source: 'logged', grams: 5000, position: 0 },
    ],
    event: [{ id: 'integration:session_choice:complete:choice', session_id: 'complete', kind: 'logged', time: 4, detail: { integration: { schemaVersion: 1, recordType: 'session_choice', reason: 'time', advisoryId: 'advisory-a' } } },
      { id: 'integration:original_plan:complete:slot', session_id: 'complete', kind: 'shown', time: 3, detail: { integration: { schemaVersion: 1, recordType: 'original_plan', slotId: 'slot', targets: [0, 1, 2].map(position => ({ position, type: 'working', repsMin: 8, repsMax: 10, seconds: null, weight: 5000, effort: 8 })) } } },
      { id: 'ordinary-telemetry', session_id: 'complete', kind: 'logged', time: 5, detail: { set: 'payload' } }],
    setting: [{ id: 'bodyweight', value: 90000 }], run: [], run_event: [], run_setting: [], program_day: [], slot: [], slot_set: [], program: [],
  };
}

test('integration daily summary keeps completed work, open state, recorded effort, missing bodyweight, and DST dates distinct', () => {
  const body = dailyIntegration(fixture(), '2026-03-08', '2026-03-08', 'subject-test', '10', Date.parse('2026-03-09T12:00:00Z'));
  const day = body.days[0];
  assert.equal(body.sourceRevision, '10'); assert.equal(body.interval.from, '2026-03-08T06:00:00.000Z'); assert.equal(body.interval.to, '2026-03-09T05:00:00.000Z');
  assert.equal(day.recordState, 'open'); assert.equal(day.openSessions, 1); assert.equal(day.sessions, 1); assert.equal(day.sets, 2);
  assert.equal(day.effort.recordedSets, 1); assert.equal(day.effort.assumedSets, 1); assert.equal(day.rpeCoverage, 0.5);
  assert.equal(day.volumeComplete, false, 'current bodyweight cannot fill missing historical bodyweight'); assert.equal(day.volumeLb, 0);
  assert.equal(day.sessionsDetail[0].closeReason, 'time'); assert.equal(day.sessionsDetail[0].advisoryId, 'advisory-a');
  assert.equal(day.sessionsDetail[0].originalPlannedWorkingSets, 3); assert.equal(day.sessionsDetail[0].completedWorkingSets, 2);
  assert.equal(day.sessionsDetail[1].status, 'open'); assert.equal(day.sessionsDetail[1].end, null);
  assert.equal(day.sessionsDetail[1].originalPlannedWorkingSets, null);
  assert.deepEqual(body.coverage, { server: 'complete', phone: 'unknown' });
  const fall = dailyIntegration(fixture(), '2026-11-01', '2026-11-01', 'subject-test', '11');
  assert.deepEqual(fall.interval, { from: '2026-11-01T05:00:00.000Z', to: '2026-11-02T06:00:00.000Z' });
});

test('source revision orders Chicago dates before database writes and stays stable within a date', () => {
  const beforeMidnight = Date.parse('2026-03-08T05:59:59.999Z');
  const afterMidnight = Date.parse('2026-03-08T06:00:00.000Z');
  const first = integrationRevision('42', beforeMidnight);
  assert.equal(integrationRevision('42', beforeMidnight), first);
  assert.ok(BigInt(integrationRevision('42', afterMidnight)) > BigInt(first));
  assert.ok(BigInt(integrationRevision('43', afterMidnight)) > BigInt(integrationRevision('42', afterMidnight)));
});

test('original session plan counts stay separate from later edited targets', () => {
  const data = fixture(), first = dailyIntegration(data, '2026-03-08', '2026-03-08', 'subject-test', '1').days[0].sessionsDetail[0];
  data.set[0].target_reps_min = 99; data.set[1].target_weight = 90000;
  const later = dailyIntegration(data, '2026-03-08', '2026-03-08', 'subject-test', '2').days[0].sessionsDetail[0];
  assert.equal(first.originalPlannedWorkingSets, 3); assert.equal(later.originalPlannedWorkingSets, 3); assert.equal(later.completedWorkingSets, 2);
});

test('integration event reader validates its discriminator and close choice saves with the session', () => {
  const record = integrationEvent('session-a', 'session_choice', { reason: 'recovery', advisoryId: 'advisory-a' });
  assert.equal(integrationRecord({ ...record.row })?.recordType, 'session_choice');
  assert.equal(integrationRecord({ ...record.row, detail: { set: 'ordinary telemetry' } }), null);
  assert.equal(integrationRecord({ ...record.row, detail: { integration: { schemaVersion: 1, recordType: 'session_choice', reason: 'invented' } } }), null);
  const changes = finishChanges({}, { id: 'session-a', run_id: null, program_day_id: null }, 5, true, 'recovery', 'advisory-a');
  assert.deepEqual(changes.map(row => row.table), ['session', 'event']);
  assert.equal(integrationRecord(changes[1].row)?.advisoryId, 'advisory-a');
  const unselected = finishChanges({}, { id: 'session-b', run_id: null, program_day_id: null }, 6, true, 'time', null);
  assert.equal(integrationRecord(unselected[1].row)?.advisoryId, null, 'an old receipt cannot imply selection');
});

test('Health advisory consumer rejects wrong identity, expired, and unknown-field responses', () => {
  const now = Date.parse('2026-03-08T12:00:00Z'), metrics = ['sleep', 'hrv', 'rhr', 'temperature', 'steps'], advisory = { schemaVersion: 1, source: 'health', subjectId: 'subject-test', advisoryId: 'advisory-test', day: '2026-03-08', policyVersion: 'rules-v1', sourceRevision: 'input-revisions', generatedAt: new Date(now - 1000).toISOString(), validUntil: new Date(now + 59000).toISOString(), computed: 'train', shown: 'lighter', headline: 'Use your normal plan.', ruleWords: 'Guidance only.', missing: [], sets: { low: 1.5, high: 3 }, overridden: false, freshness: { measuredOn: Object.fromEntries(metrics.map(key => [key, null])), stale: Object.fromEntries(metrics.map(key => [key, false])) } };
  assert.equal(validHealthAdvisory(advisory, 'subject-test', now), true);
  assert.equal(validHealthAdvisory(advisory, 'different-subject', now), false);
  assert.equal(validHealthAdvisory({ ...advisory, validUntil: new Date(now).toISOString() }, 'subject-test', now), false);
  assert.equal(validHealthAdvisory({ ...advisory, privateField: 'not allowed' }, 'subject-test', now), false);
  assert.equal(validHealthAdvisory({ ...advisory, freshness: { ...advisory.freshness, measuredOn: { ...advisory.freshness.measuredOn, privateField: 'raw data' } } }, 'subject-test', now), false);
});
