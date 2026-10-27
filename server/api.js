import { createServer } from 'node:http';
import { writableTables, ValidationError } from './schema.js';
import { tables } from './schema.js';
import { dailySummary } from '../domain/metrics.js';
import { fingerprints } from '../domain/fingerprint.js';
import { serveStatic } from './static.js';
import { dailyIntegration, integrationRevision, sameCredential, validHealthAdvisory } from './integration.js';
import { validBodyWeightSeries, validWeightRange } from '../domain/body-weight.js';
import { healthAppUrl, readBodyLimited } from './body-weight.js';

function send(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin',
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size <= 1048576) chunks.push(chunk);
      else { chunks.length = 0; reject(Object.assign(new Error('Body too large'), { status: 413 })); }
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function answer(store, op) {
  try { return store.apply(op); }
  catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    const validId = typeof op?.id === 'string' && op.id.length <= 200;
    const row = writableTables.includes(op?.table) && typeof op?.row?.id === 'string'
      ? store.get(op.table, op.row.id) : null;
    return { id: validId ? op.id : null, status: 'rejected', reason: 'invalid_operation', row };
  }
}

function allowRequest(request, origin) {
  if (origin) return request.headers.host === new URL(origin).host;
  return /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(request.headers.host || '');
}

function allowWrite(request, origin) {
  const expected = origin || `http://${request.headers.host}`;
  return request.headers['sec-fetch-site'] === 'same-origin'
    && request.headers.origin === expected
    && /^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '');
}

async function bodyWeightRoute(request, response, url) {
  if (request.method !== 'GET' || request.headers['content-length'] && request.headers['content-length'] !== '0' || request.headers['transfer-encoding']) return send(response, 400, { error: 'Invalid request' });
  const params = [...url.searchParams.entries()], from = url.searchParams.get('from'), to = url.searchParams.get('to');
  if (params.length !== 2 || new Set(params.map(([key]) => key)).size !== 2 || params.some(([key]) => !['from', 'to'].includes(key)) || !validWeightRange(from, to)) return send(response, 400, { error: 'Invalid date range' });
  const token = process.env.HEALTH_WEIGHT_TOKEN, subjectId = process.env.INTEGRATION_SUBJECT_ID, base = process.env.HEALTH_INTEGRATION_URL;
  if (!token || !subjectId || !base) return send(response, 200, { configured: false });
  const link = healthAppUrl(process.env.HEALTH_APP_URL);
  try {
    const endpoint = new URL('/api/integration/v1/body-weight', base);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error();
    endpoint.search = new URLSearchParams({ from, to }).toString();
    const upstream = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!upstream.ok) throw new Error();
    const raw = await readBodyLimited(upstream, 1048576), series = JSON.parse(raw);
    if (!validBodyWeightSeries(series, subjectId, from, to)) throw new Error();
    return send(response, 200, { configured: true, available: true, subjectId, series, ...(link ? { healthAppUrl: link } : {}) });
  } catch {
    return send(response, 200, { configured: true, available: false, subjectId, ...(link ? { healthAppUrl: link } : {}) });
  }
}

function dailyIntegrationRoute(request, response, url, store) {
  if (!['GET'].includes(request.method) || request.headers['content-length'] && request.headers['content-length'] !== '0' || request.headers['transfer-encoding']) return send(response, 405, { error: 'GET without a body required' });
  const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
  if (!sameCredential(process.env.WORKOUT_INTEGRATION_TOKEN, token)) return send(response, 401, { error: 'Unauthorized' });
  const params = [...url.searchParams.entries()];
  if (params.length !== 2 || new Set(params.map(([key]) => key)).size !== 2 || params.some(([key]) => !['from', 'to'].includes(key))) return send(response, 400, { error: 'Invalid query' });
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 >= 366) return send(response, 400, { error: 'Invalid date range' });
  const subjectId = process.env.INTEGRATION_SUBJECT_ID;
  if (!subjectId) return send(response, 503, { error: 'Integration unavailable' });
  const data = Object.fromEntries(tables.map(table => [table, store.rows(table)]));
  const now = Date.now();
  const result = dailyIntegration(data, from, to, subjectId, integrationRevision(store.revision(), now), now);
  if (Buffer.byteLength(JSON.stringify(result)) > 5 * 1024 * 1024) return send(response, 413, { error: 'Summary too large' });
  return send(response, 200, result);
}

async function healthContextRoute(request, response, url) {
  if (request.method !== 'GET' || url.search || request.headers['content-length'] && request.headers['content-length'] !== '0' || request.headers['transfer-encoding']) return send(response, 400, { available: false, reason: 'Invalid request' });
  const token = process.env.HEALTH_ADVISORY_TOKEN, subjectId = process.env.INTEGRATION_SUBJECT_ID;
  if (!token || !subjectId) return send(response, 200, { available: false, reason: 'Health guidance is not connected.' });
  try {
    const base = process.env.HEALTH_INTEGRATION_URL;
    if (!base) throw new Error();
    const endpoint = new URL('/api/integration/v1/advisory', base);
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error();
    const upstream = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!upstream.ok) throw new Error();
    const raw = await upstream.text();
    if (raw.length > 65536) throw new Error();
    const value = JSON.parse(raw);
    if (!validHealthAdvisory(value, subjectId)) throw new Error();
    return send(response, 200, { available: true, advisory: value });
  } catch { return send(response, 200, { available: false, reason: 'Health guidance is unavailable. Try again while connected.' }); }
}

export function createApi(store, { origin } = {}) {
  if (origin && new URL(origin).origin !== origin) throw new Error('Invalid app origin');
  const rates = new Map();
  let windowStart = Date.now();
  return createServer({ requestTimeout: 10000, headersTimeout: 10000 }, async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const integrationRoute = url.pathname === '/api/integration/v1/summary/daily';
      if (!integrationRoute && !allowRequest(request, origin)) return send(response, 403, { error: 'Invalid host' });
      if (Date.now() - windowStart > 60000) { rates.clear(); windowStart = Date.now(); }
      const address = request.socket.remoteAddress;
      const count = (rates.get(address) || 0) + 1;
      rates.set(address, count);
      if (count > 1200) return send(response, 429, { error: 'Too many requests' });
      if (integrationRoute) return dailyIntegrationRoute(request, response, url, store);
      if (request.method === 'GET' && url.pathname === '/api/health') return send(response, 200, { ok: true });
      if (url.pathname === '/api/health-context') return await healthContextRoute(request, response, url);
      if (url.pathname === '/api/body-weight') return await bodyWeightRoute(request, response, url);
      if (request.method === 'GET' && url.pathname === '/api/summary/daily') {
        const from = url.searchParams.get('from'), to = url.searchParams.get('to');
        const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
        if (!valid(from) || !valid(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 3660) return send(response, 400, { error: 'Invalid date range' });
        const data = Object.fromEntries(tables.map(table => [table, store.rows(table)]));
        return send(response, 200, dailySummary(data, from, to));
      }
      if (request.method === 'GET' && url.pathname === '/api/changes') {
        const raw = url.searchParams.get('since');
        if (raw === null || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) return send(response, 400, { error: 'Invalid cursor' });
        return send(response, 200, store.changes(Number(raw)));
      }
      if (request.method === 'POST' && url.pathname === '/api/sync') {
        if (!allowWrite(request, origin)) return send(response, 403, { error: 'Same-origin JSON required' });
        const body = await readJson(request);
        if (!Array.isArray(body?.operations) || body.operations.length < 1 || body.operations.length > 200) {
          return send(response, 400, { error: 'Expected 1 to 200 operations' });
        }
        return send(response, 200, { results: body.operations.map(op => answer(store, op)) });
      }
      if (request.method === 'POST' && url.pathname === '/api/count-check') {
        if (!allowWrite(request, origin)) return send(response, 403, { error: 'Same-origin JSON required' });
        const body = await readJson(request);
        if (!Array.isArray(body?.dates) || body.dates.length > 31 || body.dates.some(date => typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) return send(response, 400, { error: 'Invalid dates' });
        return send(response, 200, { days: await fingerprints(store.rows('set', true), body.dates) });
      }
      if (serveStatic(request, response, url.pathname)) return;
      send(response, 404, { error: 'Not found' });
    } catch (error) {
      send(response, error.status || 500, { error: 'Request failed' });
    }
  });
}
