import React, { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { boundedWeightPoints, cachedWeightMatches, dailyWeightPoints, validBodyWeightSeries, weightRange } from '../domain/body-weight.js';
import { dateTime } from '../domain/progress.js';
import { dateText } from './ui';

const CACHE_KEY = 'health-body-weight';
const kg = (grams: number) => grams / 1000;
const shownWeight = (grams: number, unit: string) => unit === 'lb' ? grams / 453.59237 : grams / 1000;
const fixed = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
const safeHealthUrl = (value: any) => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null; } catch { return null; } };

function WeightTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return <div className="progress-tooltip"><span>{dateText(payload[0].payload.date)}</span>{payload.map((item: any) => <strong key={item.dataKey}>{item.name}: {fixed(item.value)} kg</strong>)}</div>;
}

export function BodyWeight({ local, from, to, requestFrom = from, allHistory = false, onHistoryEarliest }: any) {
  const [saved, setSaved] = useState<any>(null), [state, setState] = useState<any>({ loading: true });
  const [tableOpen, setTableOpen] = useState(false), [shownCount, setShownCount] = useState(100);
  const query = weightRange(requestFrom, to);
  useEffect(() => setShownCount(100), [from, to]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState((previous: any) => ({ ...previous, loading: true }));
    (async () => {
      const cached = await local.db.get('meta', CACHE_KEY).catch(() => null);
      if (active && cachedWeightMatches(cached)) {
        setSaved(cached);
        if (allHistory) onHistoryEarliest(cached.series.measurements[0]?.date ?? null);
      }
      if (!active) return;
      try {
        const response = await fetch(`/api/body-weight?from=${query.from}&to=${query.to}`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!active) return;
        if (result.configured === false) {
          setSaved(null); setState({ configured: false }); if (allHistory) onHistoryEarliest(null); await local.db.delete('meta', CACHE_KEY).catch(() => {}); return;
        }
        if (result.available === true && typeof result.subjectId === 'string' && validBodyWeightSeries(result.series, result.subjectId, query.from, query.to)) {
          const entry = { series: result.series, savedAt: Date.now(), healthAppUrl: safeHealthUrl(result.healthAppUrl) };
          await local.db.put('meta', entry, CACHE_KEY).catch(() => {});
          if (active) { setSaved(entry); setState({ configured: true, available: true, healthAppUrl: entry.healthAppUrl }); if (allHistory) onHistoryEarliest(result.series.measurements[0]?.date ?? null); }
          return;
        }
        if (result.configured === true && result.available === false && typeof result.subjectId === 'string' && result.subjectId) {
          const current = await local.db.get('meta', CACHE_KEY).catch(() => null);
          if (!cachedWeightMatches(current, result.subjectId)) { if (active) { setSaved(null); if (allHistory) onHistoryEarliest(null); } await local.db.delete('meta', CACHE_KEY).catch(() => {}); }
          if (active) setState({ configured: true, available: false, subjectId: result.subjectId, healthAppUrl: safeHealthUrl(result.healthAppUrl) });
          return;
        }
        throw new Error();
      } catch {
        if (active && !controller.signal.aborted) setState({ unavailable: true });
      }
    })().catch(() => { if (active) setState({ unavailable: true }); });
    return () => { active = false; controller.abort(); };
  }, [local, query.from, query.to, allHistory, onHistoryEarliest]);

  const series = saved?.series, all = series?.measurements ?? [];
  const visible = useMemo(() => all.filter((row: any) => row.date >= from && row.date <= to), [all, from, to]);
  const rows = useMemo(() => dailyWeightPoints(all, to).filter((row: any) => row.date >= from), [all, from, to]);
  const plot = useMemo(() => boundedWeightPoints(rows), [rows]), chartRows = plot.map((row: any) => ({ ...row, time: dateTime(row.date), dailyKg: kg(row.grams), meanKg: row.meanGrams == null ? null : kg(row.meanGrams) }));
  if (state.configured === false || state.configured !== true && !saved) return null;
  const link = safeHealthUrl(state.healthAppUrl ?? saved?.healthAppUrl);
  const covered = !!series && series.interval.from <= query.from && series.interval.to >= query.to;
  const unavailable = state.available === false || state.unavailable;
  const start = dateTime(from), end = dateTime(to), domain = start === end ? [start - 43200000, end + 43200000] : [start, end];
  const savedText = saved ? `Saved ${new Date(saved.savedAt).toLocaleString()}.` : '';
  const coverageText = series && !covered ? ` Saved dates cover ${series.interval.from} to ${series.interval.to}; this range has gaps.` : '';
  return <section className="progress-panel body-weight" aria-label="Body weight">
    <div className="chart-heading"><h2>Body weight</h2><span className="chart-label">Health readings</span></div>
    <p className="chart-note">Daily readings and a trailing 7-day mean of measured days. Chart values use kg.</p>
    {rows.length > 180 && <p className="chart-note">The plot samples local highs and lows. All readings stay in the table.</p>}
    {rows.length > 0 && <div className="weight-chart" role="group" aria-label={`Daily body weight and trailing 7-day measured-days mean in kilograms. ${visible.length} source readings. Values and dates are in View all readings.`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={1}><LineChart data={chartRows} margin={{ top: 12, right: 12, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5"/><XAxis dataKey="time" type="number" scale="time" domain={domain} tickFormatter={value => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} tickLine={false} axisLine={false} minTickGap={24}/>
        <YAxis domain={['auto', 'auto']} tickFormatter={value => fixed(value)} width={44} tickLine={false} axisLine={false}/>
        <Tooltip content={<WeightTip/>} isAnimationActive={false}/>
        <Line dataKey="dailyKg" name="Daily reading" type="linear" stroke="var(--accent)" strokeWidth={0} dot={{ r: 4, fill: 'var(--accent)', stroke: 'var(--card)', strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false}/>
        <Line dataKey="meanKg" name="7-day mean" type="linear" stroke="var(--ink-muted)" strokeDasharray="5 4" strokeWidth={2} dot={{ r: 2, fill: 'var(--card)', strokeWidth: 1 }} activeDot={{ r: 5 }} isAnimationActive={false}/>
      </LineChart></ResponsiveContainer>
    </div>}
    {visible.length === 0 && <p className="chart-empty-note">{state.loading && !saved ? 'Checking Health for readings…' : unavailable && !saved ? 'Health weight history is unavailable. Try again while connected.' : 'No body-weight readings in this date range.'}</p>}
    {saved && <p className="chart-note">{savedText}{unavailable ? ' Health is unavailable; showing saved readings.' : ''}{coverageText}</p>}
    <details className="chart-data" onToggle={event => setTableOpen(event.currentTarget.open)}><summary>View all readings</summary>{tableOpen && <><table><caption>All Health readings in this date range, including same-day entries. Times use {series?.reportingZone ?? 'the Health reporting zone'}.</caption><thead><tr><th scope="col">Date and time</th><th scope="col">Weight</th></tr></thead><tbody>{visible.slice(0, shownCount).map((row: any) => <tr key={row.id}><td>{row.date} · {new Date(row.measuredAt).toLocaleTimeString(undefined, { timeZone: series.reportingZone })}</td><td>{fixed(shownWeight(row.grams, row.displayUnit))} {row.displayUnit}</td></tr>)}</tbody></table>{shownCount < visible.length && <button type="button" className="weight-more" onClick={() => setShownCount(count => Math.min(count + 100, visible.length))}>Show more readings</button>}</>}</details>
    {link && <a className="health-weight-link" href={link} target="_blank" rel="noreferrer">Open Health to add or edit readings</a>}
  </section>;
}
