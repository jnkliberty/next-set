const recordTypes = new Set(['health_advisory', 'original_plan', 'session_choice']);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const utc = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const keysAre = (value, keys) => value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

export function integrationRecord(event) {
  const payload = event?.detail?.integration;
  if (!id(event?.id) || !id(event?.session_id) || !payload || payload.schemaVersion !== 1 || !recordTypes.has(payload.recordType)) return null;
  if (payload.recordType === 'health_advisory') return keysAre(payload, ['schemaVersion', 'recordType', 'advisoryId', 'state', 'policyVersion', 'displayedAt']) && event.id === `integration:health_advisory:${event.session_id}:${payload.advisoryId}` && id(payload.advisoryId) && payload.state === 'shown' && id(payload.policyVersion) && utc(payload.displayedAt) ? payload : null;
  if (payload.recordType === 'session_choice') return keysAre(payload, ['schemaVersion', 'recordType', 'reason', 'advisoryId']) && event.id === `integration:session_choice:${event.session_id}:choice` && ['time', 'interruption', 'recovery', 'difficulty', 'manual', null].includes(payload.reason) && (payload.advisoryId === null || id(payload.advisoryId)) ? payload : null;
  return keysAre(payload, ['schemaVersion', 'recordType', 'slotId', 'targets']) && event.id === `integration:original_plan:${event.session_id}:${payload.slotId}` && id(payload.slotId) && Array.isArray(payload.targets) && payload.targets.length <= 200 && payload.targets.every(target => keysAre(target, ['position', 'type', 'repsMin', 'repsMax', 'seconds', 'weight', 'effort']) && Number.isSafeInteger(target.position) && target.position >= 0 && ['working', 'warmup', 'drop', 'rest_pause', 'timed', 'failure'].includes(target.type) && ['repsMin', 'repsMax', 'seconds', 'weight', 'effort'].every(key => target[key] == null || Number.isFinite(target[key]) && target[key] >= 0)) && JSON.stringify(payload).length <= 19000 ? payload : null;
}

export function integrationEvent(sessionId, recordType, payload, kind = 'shown') {
  const detail = { integration: { schemaVersion: 1, recordType, ...payload } };
  if (JSON.stringify(detail).length > 19000) throw new Error('Integration record is too large.');
  const key = payload.slotId ?? (recordType === 'health_advisory' ? payload.advisoryId : 'choice');
  return { table: 'event', row: { id: `integration:${recordType}:${sessionId}:${key}`, device: 'workout', session_id: sessionId, kind, time: Date.now(), detail } };
}
