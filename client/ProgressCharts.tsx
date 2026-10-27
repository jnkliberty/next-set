import React, { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { addDays, weekday } from '../domain/calendar.js';
import { dateTime } from '../domain/progress.js';
import { dateText } from './ui';

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
const shortDate = (value: number | string) => new Date(typeof value === 'number' ? value : dateTime(value)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const compact = (value: number) => value >= 1000 ? `${number(value / 1000)}k` : number(value);

function ChartTip({ active, payload, unit }: any) {
  if (!active || !payload?.length) return null;
  return <div className="progress-tooltip" role="status"><span>{dateText(payload[0].payload.date)} {payload[0].payload.date.slice(0, 4)}</span><strong>{number(payload[0].value)} {unit}</strong></div>;
}

function bounded(points: any[]) {
  if (points.length <= 180) return points;
  const size = Math.ceil(points.length / 178), result = [points[0]];
  for (let i = 1; i < points.length - 1; i += size) result.push(points.slice(i, Math.min(i + size, points.length - 1)).reduce((best, row) => row.value > best.value ? row : best));
  return [...result, points.at(-1)];
}

export function StrengthChart({ points, from, to, unit, name }: any) {
  const rows = bounded(points), start = dateTime(from), end = dateTime(to);
  const ticks = start === end ? [start] : [start, start + (end - start) / 2, end];
  const domain = start === end ? [start - 43200000, end + 43200000] : [start, end];
  const tickDate = (value: number) => from.slice(0, 4) === to.slice(0, 4) ? shortDate(value) : new Date(value).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  return <div className="strength-chart" role="group" aria-label={`${name}. ${points.length} recorded sessions. Values and dates are available under Recorded session.`}>
    <ResponsiveContainer width="100%" height="100%" minWidth={1}><LineChart data={rows} margin={{ top: 16, right: 16, left: 0, bottom: 0 }} accessibilityLayer>
      <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5"/>
      <XAxis dataKey="time" type="number" scale="time" domain={domain} ticks={ticks} tickFormatter={tickDate} tickLine={false} axisLine={false} minTickGap={12}/>
      <YAxis domain={['auto', 'auto']} tickFormatter={compact} tickLine={false} axisLine={false} width={44} tickCount={4}/>
      <Tooltip content={<ChartTip unit={unit}/>} cursor={{ stroke: 'var(--ink-muted)', strokeDasharray: '3 5' }} isAnimationActive={false}/>
      <Line dataKey="value" name={name} type="linear" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: rows.length > 70 ? 1.5 : 3, fill: 'var(--card)', strokeWidth: 2 }} activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false}/>
    </LineChart></ResponsiveContainer>{points.length > 180 && <p className="chart-note">The line shows peaks from groups of sessions. All recorded values are available below.</p>}
  </div>;
}

export function Sparkline({ points }: any) {
  if (points.length < 2) return <span className="mini-trend"/>;
  return <span className="mini-trend" aria-hidden="true"><ResponsiveContainer width="100%" height="100%" minWidth={1}><LineChart data={bounded(points)} accessibilityLayer={false}><XAxis hide type="number" dataKey="time" domain={['dataMin', 'dataMax']}/><YAxis hide domain={['dataMin', 'dataMax']}/><Line dataKey="value" stroke="var(--accent)" strokeWidth={1.5} dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></span>;
}

export function WorkChart({ weeks }: any) {
  const grouping = weeks.length > 520 ? 'year' : weeks.length > 52 ? 'month' : 'week';
  const groups = Map.groupBy<string, any>(weeks, row => grouping === 'year' ? row.date.slice(0, 4) : grouping === 'month' ? row.date.slice(0, 7) : row.date);
  const rows = [...groups].map(([date, own]) => ({ date: date.length === 4 ? `${date}-01-01` : date.length === 7 ? `${date}-01` : date, sets: own.reduce((sum, row) => sum + row.sets, 0) }));
  return <><div className="work-chart" role="group" aria-label={`Hard sets by ${grouping}. The data table is under View weekly numbers.`}><ResponsiveContainer width="100%" height="100%" minWidth={1}><BarChart data={rows} margin={{ top: 12, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
    <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5"/><XAxis dataKey="date" tickFormatter={value => grouping === 'year' ? value.slice(0, 4) : shortDate(value)} tickLine={false} axisLine={false} minTickGap={32}/>
    <YAxis domain={[0, 'auto']} width={32} tickCount={4} tickLine={false} axisLine={false} tickFormatter={compact}/>
    <Tooltip content={<ChartTip unit="hard sets"/>} cursor={{ fill: 'var(--fill)' }} isAnimationActive={false}/>
    <Bar dataKey="sets" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}/>
  </BarChart></ResponsiveContainer></div>{grouping !== 'week' && <p className="chart-note">Weekly totals grouped by {grouping} to fit this range.</p>}</>;
}

function Heatmap({ days, metric }: any) {
  const first = addDays(days[0].date, -weekday(days[0].date)), columns = Math.ceil((days.length + weekday(days[0].date)) / 7);
  const byDate = new Map(days.map((row: any) => [row.date, row])), max = Math.max(1, ...days.map((row: any) => row[metric]));
  const dates = Array.from({ length: columns }, (_, i) => addDays(first, i * 7));
  return <div className="heatmap-scroll"><svg className="activity-map" viewBox={`0 0 ${columns * 18 + 32} 152`} role="img" aria-label={`Activity across ${days.length} days. Use View sessions to choose a day.`}>
    {[1, 3, 5].map(day => <text x="0" y={37 + day * 18} key={day}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'][day]}</text>)}
    {dates.map((date, week) => <g key={date}>{(week === 0 || (date.slice(0, 7) !== dates[week - 1].slice(0, 7) && week > 1 && week < columns - 1)) && <text x={30 + week * 18} y="14">{new Date(dateTime(date)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</text>}
      {Array.from({ length: 7 }, (_, day) => { const value: any = byDate.get(addDays(date, day)); if (!value) return null; const level = value[metric] ? Math.max(1, Math.ceil(value[metric] / max * 4)) : 0; return <rect key={day} x={30 + week * 18} y={26 + day * 18} width="14" height="14" rx="3" className={`heat-${level}`}><title>{value.date}: {number(value[metric])}{value.incompleteVolume && metric === 'volumeKg' ? ' (partial)' : ''}</title></rect>; })}</g>)}
  </svg></div>;
}

function ActivitySessions({ progress, showSession }: any) {
  const [day, setDay] = useState(''), selected = progress.days.find((row: any) => row.date === day) ?? [...progress.days].reverse().find((row: any) => row.sessions) ?? progress.days.at(-1);
  return <details className="chart-data"><summary>View sessions</summary><label className="activity-day">Training date<input aria-label="Training date" type="date" min={progress.from} max={progress.to} value={selected.date} onChange={event => setDay(event.target.value)}/></label>
    {selected.sessionIds.length ? selected.sessionIds.map((id: string, i: number) => <button className="session-link" key={id} onClick={() => showSession(id)}>{dateText(selected.date)}{selected.sessionIds.length > 1 ? ` · session ${i + 1}` : ''}<span>See sets ↗</span></button>) : <p className="chart-note">No completed session on this date.</p>}
  </details>;
}

export function ActivityCalendar({ progress, allHistory, chooseYear, showSession }: any) {
  const [metric, setMetric] = useState('sets'), days = progress.days, active = days.filter((row: any) => row.sessions).length;
  const years = Map.groupBy<string, any>(days, row => row.date.slice(0, 4));
  return <section className="progress-panel activity-panel"><div className="chart-heading"><h2>Activity</h2><select aria-label="Activity measure" value={metric} onChange={event => setMetric(event.target.value)}><option value="sets">Working sets</option><option value="minutes">Time · minutes</option><option value="volumeKg">Volume · kg</option></select></div>
    {allHistory ? <div className="activity-years">{[...years].reverse().map(([year, own]) => <button key={year} onClick={() => chooseYear(year)}><strong>{year}</strong><span>{number(own.reduce((sum, row) => sum + row[metric], 0))} {metric === 'sets' ? 'sets' : metric === 'minutes' ? 'min' : 'kg'}<span aria-hidden="true"> ↗</span></span></button>)}</div> : <div className="activity-body"><div className="activity-reading"><strong>{active}</strong><span>active {active === 1 ? 'day' : 'days'}</span><p>{active ? `${number(progress.totals.sessions / Math.max(days.length / 7, 1))} sessions / week` : 'Your next session starts the pattern.'}</p></div><div className="activity-calendar"><Heatmap days={days} metric={metric}/><div className="heatmap-key" aria-hidden="true"><span>Less</span>{[0, 1, 2, 3, 4].map(value => <i className={`heat-${value}`} key={value}/>)}<span>More</span></div></div></div>}
    {metric === 'volumeKg' && progress.totals.incompleteVolume && <p className="chart-note">Partial volume. Some loads await review or lack a body-weight reading.</p>}
    <ActivitySessions progress={progress} showSession={showSession}/>
  </section>;
}
