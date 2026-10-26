import { addDays } from './calendar.js';

function exactKeys(value, keys) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

export function validWeightDate(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

export function validWeightRange(from, to) {
  return validWeightDate(from) && validWeightDate(to) && from <= to && (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000 < 36600;
}

function validUtc(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function validBodyWeightSeries(value, subjectId, from, to) {
  const keys = ['schemaVersion', 'source', 'subjectId', 'reportingZone', 'interval', 'generatedAt', 'sourceRevision', 'measurements'];
  if (!exactKeys(value, keys) || !validWeightRange(from, to) || value.schemaVersion !== 1 || value.source !== 'health' || typeof subjectId !== 'string' || !subjectId || value.subjectId !== subjectId || typeof value.reportingZone !== 'string' || value.reportingZone.length > 100 || !validUtc(value.generatedAt) || !/^[a-f\d]{64}$/.test(value.sourceRevision)) return false;
  let formatter;
  try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone: value.reportingZone, year: 'numeric', month: '2-digit', day: '2-digit' }); } catch { return false; }
  if (!exactKeys(value.interval, ['from', 'to']) || value.interval.from !== from || value.interval.to !== to || !Array.isArray(value.measurements) || value.measurements.length > 5000) return false;
  const ids = new Set(); let prior = '';
  for (const item of value.measurements) {
    if (!exactKeys(item, ['id', 'date', 'measuredAt', 'grams', 'displayUnit', 'source']) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(item.id) || ids.has(item.id)
      || !validUtc(item.measuredAt) || !validWeightDate(item.date) || formatter.format(new Date(item.measuredAt)) !== item.date || item.date < from || item.date > to
      || !Number.isSafeInteger(item.grams) || item.grams < 1 || item.grams > 1000000 || !['kg', 'lb'].includes(item.displayUnit) || item.source !== 'manual') return false;
    const order = `${item.date}|${item.measuredAt}|${item.id}`;
    if (order < prior) return false;
    prior = order; ids.add(item.id);
  }
  return true;
}

export function weightHistoryStart(to) { return addDays(to, -(36600 - 1 - 6)); }

export function weightRange(from, to) {
  const padded = addDays(from, -6), earliest = addDays(to, -(36600 - 1));
  return { from: padded < earliest ? earliest : padded, to };
}

export function dailyWeightPoints(measurements, to) {
  const daily = new Map();
  for (const row of measurements) {
    const current = daily.get(row.date);
    if (!current || row.measuredAt > current.measuredAt || row.measuredAt === current.measuredAt && row.id > current.id) daily.set(row.date, row);
  }
  const ordered = [...daily].sort(([a], [b]) => a.localeCompare(b)), result = [];
  let start = 0, sum = 0;
  for (let i = 0; i < ordered.length && ordered[i][0] <= to; i++) {
    const [date, row] = ordered[i]; sum += row.grams;
    while (ordered[start][0] < addDays(date, -6)) sum -= ordered[start++][1].grams;
    const days = i - start + 1;
    result.push({ date, grams: row.grams, meanGrams: days >= 2 ? Math.round(sum / days) : null });
  }
  return result;
}

export function cachedWeightMatches(entry, expectedSubjectId) {
  const series = entry?.series;
  return exactKeys(entry, ['series', 'savedAt', 'healthAppUrl']) && Number.isSafeInteger(entry.savedAt) && entry.savedAt > 0
    && (entry.healthAppUrl === null || validHealthLink(entry.healthAppUrl))
    && !!series && validBodyWeightSeries(series, expectedSubjectId ?? series.subjectId, series.interval?.from, series.interval?.to);
}

function validHealthLink(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && value === url.origin; }
  catch { return false; }
}

export function boundedWeightPoints(points) {
  if (points.length <= 180) return points;
  const size = Math.ceil(points.length / 44), indices = new Set([0, points.length - 1]);
  for (let start = 0; start < points.length; start += size) {
    const end = Math.min(start + size, points.length), rows = points.slice(start, end);
    for (const key of ['grams', 'meanGrams']) {
      const valid = rows.map((row, offset) => row[key] == null ? null : { index: start + offset, value: row[key] }).filter(Boolean);
      if (valid.length) {
        indices.add(valid.reduce((best, row) => row.value < best.value ? row : best).index);
        indices.add(valid.reduce((best, row) => row.value > best.value ? row : best).index);
      }
    }
  }
  return [...indices].sort((a, b) => a - b).map(index => points[index]);
}
