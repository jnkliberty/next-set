import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createApi } from '../server/api.js';

const series = { schemaVersion: 1, source: 'health', subjectId: 'fixture-subject', reportingZone: 'America/Chicago', interval: { from: '2026-10-25', to: '2026-10-26' }, generatedAt: '2026-10-26T12:00:00.000Z', sourceRevision: 'a'.repeat(64), measurements: [] };

function get(port, path) {
  return new Promise((resolve, reject) => request({ host: '127.0.0.1', port, path }, response => {
    let body = ''; response.setEncoding('utf8'); response.on('data', chunk => body += chunk); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
  }).on('error', reject).end());
}

test('body-weight proxy stays optional, validates query shape, and returns only a checked Health series', async t => {
  const names = ['HEALTH_WEIGHT_TOKEN', 'HEALTH_INTEGRATION_URL', 'INTEGRATION_SUBJECT_ID', 'HEALTH_APP_URL'], before = Object.fromEntries(names.map(name => [name, process.env[name]])), originalFetch = globalThis.fetch;
  t.after(() => { for (const name of names) before[name] === undefined ? delete process.env[name] : process.env[name] = before[name]; globalThis.fetch = originalFetch; });
  for (const name of names) delete process.env[name];
  const server = createApi({}); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  assert.deepEqual((await get(port, '/api/body-weight?from=2026-10-25&to=2026-10-26')).body, { configured: false });
  assert.equal((await get(port, '/api/body-weight?from=2026-10-25&to=2026-10-26&from=2026-10-25')).status, 400);
  process.env.HEALTH_WEIGHT_TOKEN = 'fixture-token'; process.env.HEALTH_INTEGRATION_URL = 'https://health.example.test'; process.env.INTEGRATION_SUBJECT_ID = 'fixture-subject'; process.env.HEALTH_APP_URL = 'https://health.example.test/path';
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, '/api/integration/v1/body-weight');
    assert.equal(new URL(url).search, '?from=2026-10-25&to=2026-10-26');
    assert.equal(options.headers.authorization, 'Bearer fixture-token');
    return new Response(JSON.stringify(series));
  };
  assert.deepEqual((await get(port, '/api/body-weight?from=2026-10-25&to=2026-10-26')).body, { configured: true, available: true, subjectId: 'fixture-subject', series, healthAppUrl: 'https://health.example.test' });
  globalThis.fetch = async () => new Response(JSON.stringify({ ...series, subjectId: 'wrong-subject' }));
  assert.deepEqual((await get(port, '/api/body-weight?from=2026-10-25&to=2026-10-26')).body, { configured: true, available: false, subjectId: 'fixture-subject', healthAppUrl: 'https://health.example.test' });
});
