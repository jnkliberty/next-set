import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBodyLimited } from '../server/body-weight.js';
import { boundedWeightPoints, cachedWeightMatches, dailyWeightPoints, validBodyWeightSeries, weightHistoryStart, weightRange } from '../domain/body-weight.js';

const fixture = () => ({
  schemaVersion: 1, source: 'health', subjectId: 'fixture-subject', reportingZone: 'America/Chicago',
  interval: { from: '2026-10-25', to: '2026-10-26' }, generatedAt: '2026-10-26T12:00:00.000Z',
  sourceRevision: 'a'.repeat(64), measurements: [
    { id: '550e8400-e29b-41d4-a716-446655440000', date: '2026-10-25', measuredAt: '2026-10-25T13:00:00.000Z', grams: 81200, displayUnit: 'kg', source: 'manual' },
  ],
});

test('Health series validation binds exact identity, interval, dates, and measurements', () => {
  const value = fixture();
  assert.equal(validBodyWeightSeries(value, 'fixture-subject', '2026-10-25', '2026-10-26'), true);
  assert.equal(validBodyWeightSeries(value, 'other-subject', '2026-10-25', '2026-10-26'), false);
  assert.equal(validBodyWeightSeries(value, 'fixture-subject', '2026-10-24', '2026-10-26'), false);
  assert.equal(validBodyWeightSeries({ ...value, extra: true }, 'fixture-subject', '2026-10-25', '2026-10-26'), false);
  assert.equal(validBodyWeightSeries({ ...value, reportingZone: 'Mars/Olympus' }, 'fixture-subject', '2026-10-25', '2026-10-26'), false);
  assert.equal(validBodyWeightSeries({ ...value, measurements: [{ ...value.measurements[0], date: '2026-10-26' }] }, 'fixture-subject', '2026-10-25', '2026-10-26'), false);
  assert.equal(validBodyWeightSeries({ ...value, measurements: [{ ...value.measurements[0], displayUnit: 'stone' }] }, 'fixture-subject', '2026-10-25', '2026-10-26'), false);
});

test('Health series validation rejects duplicate and out-of-order IDs and excess rows', () => {
  const value = fixture(), first = value.measurements[0];
  assert.equal(validBodyWeightSeries({ ...value, measurements: [first, first] }, 'fixture-subject', '2026-10-25', '2026-10-26'), false);
  const later = { ...first, id: '650e8400-e29b-41d4-a716-446655440000', date: '2026-10-26', measuredAt: '2026-10-26T13:00:00.000Z' };
  assert.equal(validBodyWeightSeries({ ...value, measurements: [later, first] }, 'fixture-subject', '2026-10-25', '2026-10-26'), false);
  assert.equal(validBodyWeightSeries({ ...value, measurements: Array.from({ length: 5001 }, (_, i) => ({ ...first, id: `${i}`, date: '2026-10-25' })) }, 'fixture-subject', '2026-10-25', '2026-10-26'), false);
});

test('Health response body is stopped when it exceeds the proxy limit', async () => {
  assert.equal(await readBodyLimited(new Response('fixture'), 10), 'fixture');
  await assert.rejects(readBodyLimited(new Response('x'.repeat(11)), 10));
});

test('weight chart uses last reading per day and a measured-days-only trailing mean', () => {
  const series = fixture();
  series.interval = { from: '2026-10-19', to: '2026-10-26' };
  series.measurements = [
    { id: '550e8400-e29b-41d4-a716-446655440001', date: '2026-10-20', measuredAt: '2026-10-20T13:00:00.000Z', grams: 80000, displayUnit: 'kg', source: 'manual' },
    { id: '550e8400-e29b-41d4-a716-446655440002', date: '2026-10-20', measuredAt: '2026-10-20T14:00:00.000Z', grams: 81000, displayUnit: 'kg', source: 'manual' },
    { id: '550e8400-e29b-41d4-a716-446655440003', date: '2026-10-26', measuredAt: '2026-10-26T13:00:00.000Z', grams: 83000, displayUnit: 'kg', source: 'manual' },
  ];
  assert.deepEqual(dailyWeightPoints(series.measurements, '2026-10-26'), [
    { date: '2026-10-20', grams: 81000, meanGrams: null },
    { date: '2026-10-26', grams: 83000, meanGrams: 82000 },
  ]);
  assert.deepEqual(weightRange('2026-10-26', '2026-10-26'), { from: '2026-10-20', to: '2026-10-26' });
});

test('All requests the full Health history cap including the six-day mean pad', () => {
  const to = '2026-10-26', start = weightHistoryStart(to), query = weightRange(start, to);
  assert.equal((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${query.from}T12:00:00Z`)) / 86400000 + 1, 36600);
  assert.deepEqual(query, { from: '1926-08-13', to });
  assert.deepEqual(weightRange('2026-10-01', to), { from: '2026-09-25', to }, 'short selected ranges keep their existing six-day pad');
});

test('cached Health readings are rejected when the known subject changes', () => {
  const cache = { series: fixture(), savedAt: 1, healthAppUrl: null };
  assert.equal(cachedWeightMatches(cache), true);
  assert.equal(cachedWeightMatches(cache, 'fixture-subject'), true);
  assert.equal(cachedWeightMatches(cache, 'other-subject'), false);
  assert.equal(cachedWeightMatches({ ...cache, savedAt: NaN }), false);
  assert.equal(cachedWeightMatches({ ...cache, extra: true }), false);
  assert.equal(cachedWeightMatches({ ...cache, healthAppUrl: 'javascript:alert(1)' }), false);
});

test('a 5,000-day plot stays bounded and keeps each overall raw extreme', () => {
  const start = '2000-01-01', measurements = Array.from({ length: 5000 }, (_, i) => {
    const date = new Date(Date.parse(`${start}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
    return { date, measuredAt: `${date}T13:00:00.000Z`, id: `${i}`, grams: i === 2100 ? 20000 : i === 4200 ? 150000 : 70000 };
  });
  const points = dailyWeightPoints(measurements, measurements.at(-1).date), plot = boundedWeightPoints(points);
  assert.ok(plot.length <= 180);
  assert.ok(plot.some(point => point.date === measurements[2100].date && point.grams === 20000));
  assert.ok(plot.some(point => point.date === measurements[4200].date && point.grams === 150000));
  assert.equal(dailyWeightPoints([measurements[0]], measurements[0].date)[0].meanGrams, null);
});
