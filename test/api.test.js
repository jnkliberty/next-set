import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { Store } from '../server/store.js';
import { createApi } from '../server/api.js';

async function setup(t, options) {
  const store = new Store(':memory:');
  const server = createApi(store, options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });
  const write = (body, headers = {}) => fetch(`${url}/api/sync`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: url, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { store, url, write };
}

function operation(id = 'op-a') {
  return { id, table: 'setting', row: { id: 'bodyweight', rev: 1, device_id: 'phone-a', updated_at: 1, deleted_at: null, value: 80000 } };
}

test('deployment health script uses the configured origin host without relaxing the host guard',async t=>{
  const origin='https://training.test:10443';
  const {url}=await setup(t,{origin});
  assert.equal((await fetch(`${url}/api/health`)).status,403);
  const child=spawn(process.execPath,['scripts/healthcheck.js'],{env:{...process.env,PORT:new URL(url).port,APP_ORIGIN:origin},stdio:'ignore'});
  const [code]=await once(child,'exit');
  assert.equal(code,0,'The deployed health check must pass with APP_ORIGIN set');
});

test('real HTTP sync persists a row and the cursor returns it once', async t => {
  const { url, write } = await setup(t);
  const saved = await write({ operations: [operation()] });
  assert.equal(saved.status, 200);
  const { results } = await saved.json();
  assert.equal(results[0].id, 'op-a');
  assert.equal(results[0].status, 'applied');
  const changes = await (await fetch(`${url}/api/changes?since=0`)).json();
  assert.equal(changes.rows.length, 1);
  assert.equal(changes.rows[0].row.value, 80000);
  const next = await (await fetch(`${url}/api/changes?since=${changes.cursor}`)).json();
  assert.deepEqual(next.rows, []);
  assert.equal((await fetch(`${url}/api/health`)).status, 200);
});

test('same-origin JSON guard rejects cross-origin, missing proof and malformed bodies', async t => {
  const { store, url, write } = await setup(t);
  for (const headers of [
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': '' },
    { origin: 'https://untrusted.invalid' }, { 'content-type': 'text/plain' },
  ]) assert.equal((await write({ operations: [operation()] }, headers)).status, 403);
  assert.equal((await write('{')).status, 400);
  assert.equal((await write({ operations: [] })).status, 400);
  assert.equal((await write(' '.repeat(1048577))).status, 413);
  assert.equal((await fetch(`${url}/api/changes?since=no`)).status, 400);
  assert.equal((await fetch(`${url}/api/changes?since=-1`)).status, 400);
  assert.equal((await fetch(`${url}/api/changes?since=1.1`)).status, 400);
  assert.equal(store.rows('setting').length, 0);
});

test('a malformed operation gets an ID answer without blocking a valid neighbor', async t => {
  const { write } = await setup(t);
  const bad = operation('bad');
  bad.row.rev = -1;
  const response = await write({ operations: [bad, operation('good')] });
  const { results } = await response.json();
  assert.deepEqual(results.map(x => [x.id, x.status]), [['bad', 'rejected'], ['good', 'applied']]);
  assert.equal(results[0].reason, 'invalid_operation');
});

test('storage failure stays retryable and does not leak the database path', async t => {
  const { store, write } = await setup(t);
  store.apply = () => { throw new Error('disk IO at /private/test.sqlite'); };
  const response = await write({ operations: [operation()] });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Request failed' });
});

test('daily summary HTTP route returns explicit rest days and rejects malformed or unbounded ranges', async t => {
  const { url } = await setup(t);
  const response = await fetch(`${url}/api/summary/daily?from=2026-01-01&to=2026-01-01`);
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessions, 0);
  assert.equal(rows[0].trainingLoadSource, null);
  for (const query of ['from=no&to=no', 'from=2026-02-30&to=2026-03-01', 'from=2026-01-02&to=2026-01-01', 'from=1900-01-01&to=2100-01-01']) {
    assert.equal((await fetch(`${url}/api/summary/daily?${query}`)).status, 400);
  }
});

test('integration summary has a route-only credential, strict query, bounded dates, DST interval, and old-client sync compatibility', async t => {
  const oldToken = process.env.WORKOUT_INTEGRATION_TOKEN, oldSubject = process.env.INTEGRATION_SUBJECT_ID;
  process.env.WORKOUT_INTEGRATION_TOKEN = 'invented-workout-token'; process.env.INTEGRATION_SUBJECT_ID = 'subject-test';
  t.after(() => { if (oldToken === undefined) delete process.env.WORKOUT_INTEGRATION_TOKEN; else process.env.WORKOUT_INTEGRATION_TOKEN = oldToken; if (oldSubject === undefined) delete process.env.INTEGRATION_SUBJECT_ID; else process.env.INTEGRATION_SUBJECT_ID = oldSubject; });
  const { store, url } = await setup(t);
  const route = `${url}/api/integration/v1/summary/daily?from=2026-03-08&to=2026-03-08`, auth = { authorization: 'Bearer invented-workout-token' };
  assert.equal((await fetch(route)).status, 401);
  assert.equal((await fetch(route, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(route, { method: 'POST', headers: auth })).status, 405);
  assert.equal((await fetch(`${url}/api/integration/v1/summary/daily?from=2026-03-08&from=2026-03-08&to=2026-03-08`, { headers: auth })).status, 400);
  assert.equal((await fetch(`${url}/api/integration/v1/summary/daily?from=2026-03-08&to=2026-03-08&extra=x`, { headers: auth })).status, 400);
  assert.equal((await fetch(`${url}/api/integration/v1/summary/daily?from=2026-01-01&to=2027-01-02`, { headers: auth })).status, 400);
  const response = await fetch(route, { headers: auth }), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.subjectId, 'subject-test'); assert.equal(body.days[0].recordState, 'no_record');
  assert.deepEqual(body.interval, { from: '2026-03-08T06:00:00.000Z', to: '2026-03-09T05:00:00.000Z' });
  assert.equal(body.coverage.phone, 'unknown');
  const unchanged = await (await fetch(route, { headers: auth })).json();
  assert.equal(unchanged.sourceRevision, body.sourceRevision, 'the date and unchanged store sequence produce a stable revision');
  assert.equal((await fetch(`${url}/api/changes?since=0`, { headers: auth })).status, 200, 'Workout token does not replace the browser route behavior');
  const event = { id: 'legacy-pull', table: 'event', row: { id: 'legacy-event', rev: 1, device_id: 'old-phone', updated_at: 1, deleted_at: null, device: 'old-phone', kind: 'shown', time: 1, detail: { set: 'telemetry' }, session_id: 'legacy-session' } };
  store.apply(event);
  const afterWrite = await (await fetch(route, { headers: auth })).json();
  assert.ok(BigInt(afterWrite.sourceRevision) > BigInt(body.sourceRevision), 'a stored row increases the revision within the date');
  const pulled = await (await fetch(`${url}/api/changes?since=0`)).json();
  assert.ok(pulled.rows.some(row => row.table === 'event' && row.row.id === 'legacy-event'));
  const saved = await fetch(`${url}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: url }, body: JSON.stringify({ operations: [{ id: 'old-set-save', table: 'set', row: { id: 'old-set', rev: 1, device_id: 'old-phone', updated_at: 2, deleted_at: null, session_slot_id: 'old-slot', position: 0, type: 'working', local_date: '2026-03-08' } }] }) });
  assert.equal((await saved.json()).results[0].status, 'applied');
});

test('Health proxy hides its credential and rejects wrong-subject upstream data', async t => {
  const names = ['HEALTH_ADVISORY_TOKEN', 'HEALTH_INTEGRATION_URL', 'INTEGRATION_SUBJECT_ID'], before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.HEALTH_ADVISORY_TOKEN = 'invented-health-token'; process.env.HEALTH_INTEGRATION_URL = 'http://health-service'; process.env.INTEGRATION_SUBJECT_ID = 'subject-test';
  const nativeFetch = globalThis.fetch; let upstreamSubject = 'other-subject';
  globalThis.fetch = async (input, options) => {
    if (!String(input).includes('health-service')) return nativeFetch(input, options);
    const now = Date.now();
    const metrics = ['sleep', 'hrv', 'rhr', 'temperature', 'steps'];
    return new Response(JSON.stringify({ schemaVersion: 1, source: 'health', subjectId: upstreamSubject, advisoryId: 'advisory', day: new Date(now).toISOString().slice(0, 10), policyVersion: 'v1', sourceRevision: 'r1', generatedAt: new Date(now - 1000).toISOString(), validUntil: new Date(now + 59000).toISOString(), computed: 'train', shown: 'train', headline: 'Guidance', ruleWords: 'Keep the plan.', missing: [], sets: { low: 1, high: 3 }, overridden: false, freshness: { measuredOn: Object.fromEntries(metrics.map(key => [key, null])), stale: Object.fromEntries(metrics.map(key => [key, false])) } }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = nativeFetch; for (const name of names) before[name] === undefined ? delete process.env[name] : process.env[name] = before[name]; });
  const { url } = await setup(t);
  const request = () => nativeFetch(`${url}/api/health-context`);
  const wrong = await (await request()).json(); assert.equal(wrong.available, false); assert.equal(JSON.stringify(wrong).includes('invented-health-token'), false);
  upstreamSubject = 'subject-test';
  const valid = await (await request()).json(); assert.equal(valid.available, true); assert.equal(valid.advisory.advisoryId, 'advisory');
  assert.equal((await nativeFetch(`${url}/api/health-context?unexpected=1`)).status, 400);
});
