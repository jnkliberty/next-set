import React, { useState } from 'react';
import { byId, exerciseIdentity } from '../domain/model.js';
import { exerciseHistory } from '../domain/session.js';
import { weightIn } from '../domain/targets.js';
import { Row, Sheet, dateText, numberText, rangeText } from './ui';
import './workout-results.css';

export function ExerciseHistory({ data, exerciseId, initialRange, close }: any) {
  const exercises = byId(data.exercise), exercise = exercises.get(exerciseIdentity(exercises, exerciseId));
  const all = exerciseHistory(data, exerciseId);
  const ranges = [...new Map(all.rows.flatMap((row: Row) => row.sets.filter((set: Row) => set.type !== 'timed').map((set: Row) => [[set.target_reps_min, set.target_reps_max].join(':'), [set.target_reps_min, set.target_reps_max]]))).values()] as any[];
  const [range, setRange] = useState<any>(initialRange ?? ranges[0] ?? null), [metric, setMetric] = useState('best');
  const history = exerciseHistory(data, exerciseId, range), rows = history.rows.slice(-8);
  const points = rows.map((row: Row) => ({ date: row.session.local_date, value: metric === 'volume' ? row.volumeKg : row.best ? weightIn(row.best) : null })).filter((row: Row) => row.value != null);
  return <Sheet title={exercise?.name ?? 'Exercise history'} close={close}><div className="exercise-history">
    {ranges.length > 0 && <label>Rep range<select value={range?.join(':') ?? ''} onChange={event => setRange(ranges.find(value => value.join(':') === event.target.value))}>{ranges.map(value => <option key={value.join(':')} value={value.join(':')}>{rangeText(value[0], value[1])} reps</option>)}</select></label>}
    <div className="history-metrics" role="group" aria-label="History metric"><button aria-pressed={metric === 'best'} onClick={() => setMetric('best')}>Best set</button><button aria-pressed={metric === 'volume'} onClick={() => setMetric('volume')}>kg lifted</button></div>
    {points.length ? <HistoryChart points={points} metric={metric}/>: <p>No logged sets{range ? ' at this rep range' : ''} yet.</p>}
    <p className="muted">{metric === 'best' ? 'Heaviest working set' : 'Weight × reps, excluding warm-ups'}{range ? ` for ${rangeText(range[0], range[1])} reps` : ''} · last {rows.length} sessions</p>
    {history.rows.length > 0 && <><h3>Records</h3><dl className="results-totals">{history.best && <div><dt>kg × reps · best set</dt><dd>{numberText(weightIn(history.best))} × {history.best.reps}</dd></div>}{history.heaviestKg != null && <div><dt>kg heaviest</dt><dd>{numberText(history.heaviestKg)}</dd></div>}<div><dt>Sessions</dt><dd>{history.sessions}</dd></div></dl><h3>Recent</h3><div className="results-list">{[...history.rows].reverse().map((row: Row) => <div key={row.session.id}><strong>{dateText(row.session.local_date)}{row.session.off ? ' · off session' : ''}</strong><span>{row.sets.map((set: Row) => set.type === 'timed' ? `${set.seconds} s` : `${numberText(set.weight)} ${set.unit} × ${set.reps}`).join(' · ')}</span></div>)}</div></>}
  </div></Sheet>;
}

function HistoryChart({ points, metric }: any) {
  const values = points.map((point: Row) => point.value), low = Math.min(...values), high = Math.max(...values), span = high - low || Math.max(1, high * 0.1);
  const x = (i: number) => points.length === 1 ? 163 : 24 + i * 278 / (points.length - 1), y = (value: number) => 120 - (value - low) / span * 80;
  const label = `${metric === 'volume' ? 'kg lifted' : 'Best set in kg'}, from ${numberText(points[0].value)} on ${dateText(points[0].date)} to ${numberText(points.at(-1).value)} on ${dateText(points.at(-1).date)}`;
  return <svg className="history-chart" viewBox="0 0 326 176" role="img" aria-label={label}><title>{label}</title><text x="24" y="20">{numberText(high)} kg</text><text x="302" y="140" textAnchor="end">{numberText(low)} kg</text><polyline points={points.map((point: Row, i: number) => `${x(i)},${y(point.value)}`).join(' ')}/>{points.map((point: Row, i: number) => <circle key={i} cx={x(i)} cy={y(point.value)} r="4"><title>{dateText(point.date)}: {numberText(point.value)} kg</title></circle>)}<text x="8" y="168">{dateText(points[0].date)}</text>{points.length > 1 && <text x="318" y="168" textAnchor="end">{dateText(points.at(-1).date)}</text>}</svg>;
}
