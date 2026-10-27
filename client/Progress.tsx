import React, { useMemo, useState } from 'react';
import { adherence } from '../domain/metrics.js';
import { live } from '../domain/model.js';
import { addDays, todayDate } from '../domain/calendar.js';
import { BODY_AREAS, areaWork, liftSeries, matchesArea, progressData, progressRange, strengthChange } from '../domain/progress.js';
import { ActivityCalendar, StrengthChart, WorkChart, Sparkline } from './ProgressCharts';
import { BodyWeight } from './BodyWeight';
import { weightHistoryStart } from '../domain/body-weight.js';
import { Row, dateText } from './ui';
import './progress.css';

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
const count = (value: number) => Math.round(value).toLocaleString('en-US');
const changeText = (delta: number) => `${delta > 0 ? '+' : ''}${number(delta)}%`;
const recordDate = (date: string) => `${dateText(date)} ${date.slice(0, 4)}`;
const basisText: Record<string,string> = { per_hand: 'per hand', per_side: 'per side', assisted: 'assistance', added_to_bodyweight: 'added load', total: 'total load' };
const measures: Record<string,string> = { estimate: 'Estimated strength', load: 'Recorded load', reps: 'Reps', seconds: 'Duration' };
const unitFor = (metric: string) => metric === 'seconds' ? 'sec' : metric === 'reps' ? 'reps' : 'kg';

function preferredMetric(lift: Row) {
  return ['estimate', 'seconds', 'load', 'reps'].find(metric => liftSeries(lift, metric).length) ?? 'estimate';
}

function ActualSet({ set, basis }: any) {
  return <>{set.weight != null && <>{number(set.weight)} {set.unit ?? '?'} {basis === 'assisted' ? 'assistance' : ['per_hand', 'per_side'].includes(basis) ? basisText[basis] : ''} · </>}{set.seconds != null ? `${number(set.seconds)} sec` : `${set.reps ?? '—'} reps`}{set.reps_left != null && ` · ${set.reps_left} reps left`}</>;
}

function LiftRecords({ lift, showSession }: any) {
  return <details className="chart-data"><summary>Recorded sets · {lift.records.length} sessions</summary>
    <div className="record-list">{[...lift.records].reverse().map((row: Row) => <div className="record-row" key={row.sessionId}>
      <button onClick={() => showSession(row.sessionId)} aria-label={`Open session ${recordDate(row.date)}`}>{recordDate(row.date)}<span aria-hidden="true">↗</span></button>
      <div>{row.sets.map((set: Row) => <p key={set.id}><ActualSet set={set} basis={lift.exercise?.weight_basis}/></p>)}
        {row.off && <p className="muted">Off session · excluded from the trend</p>}{row.provisional && <p className="muted">Imported · units await review</p>}
      </div></div>)}</div>
  </details>;
}

function LiftDetail({ lift, from, to, showSession }: any) {
  const [choice, setChoice] = useState(''), [session, setSession] = useState('');
  const available = Object.keys(measures).filter(metric => liftSeries(lift, metric).length);
  const metric = available.includes(choice) ? choice : preferredMetric(lift), points = liftSeries(lift, metric);
  const first = points[0], last = points.at(-1), change = metric === 'estimate' ? strengthChange(lift, points) : null;
  const selected = points.find(row => row.sessionId === session) ?? last, unit = unitFor(metric);
  return <div className="lift-detail">
    <div className="chart-heading"><div><h3>{lift.name}</h3><p>{lift.exercise?.equipment ?? 'Unclassified'} · {basisText[lift.exercise?.weight_basis] ?? 'load basis unknown'}</p></div>
      {available.length > 1 && <select aria-label="Measure" value={metric} onChange={event => setChoice(event.target.value)}>{available.map(value => <option value={value} key={value}>{measures[value]}</option>)}</select>}
    </div>
    {last ? <>
      <div className="strength-reading"><div><span className="chart-label">{measures[metric]}</span><p className="chart-value">{number(last.value)} <span>{unit}</span></p><span className="chart-label">Latest · {dateText(last.date)}</span></div>
        {change && <div className="chart-change"><strong>{changeText(change.delta)}</strong><span>from {number(first.value)} {unit}</span><span>{dateText(first.date)}</span></div>}
      </div>
      <StrengthChart points={points} from={from} to={to} unit={unit} name={measures[metric]}/>
      <p className="chart-note">{metric === 'estimate' ? 'Best estimate per normal session. Unrated sets assume two reps left.' : metric === 'load' && lift.exercise?.weight_basis === 'assisted' ? 'Assistance supplied by the machine. Less assistance means more body weight lifted.' : 'Best recorded value per normal session.'}</p>
      {metric === 'estimate' && change?.mark && <p className="chart-note">{change.mark === 'up' ? 'Increase' : 'Decrease'} exceeds the existing normal-variation threshold.</p>}
      {points.length === 1 && <p className="chart-note">One recorded point. A change appears after another session.</p>}
      <div className="point-picker"><label><span>Recorded session</span><select aria-label="Recorded session" value={selected.sessionId} onChange={event => setSession(event.target.value)}>{[...points].reverse().map(row => <option value={row.sessionId} key={row.sessionId}>{recordDate(row.date)} · {number(row.value)} {unit}</option>)}</select></label><button onClick={() => showSession(selected.sessionId)}>See sets ↗</button></div>
    </> : <div className="chart-empty"><h3>No comparable strength readings yet</h3><p>Recorded sets are below. Off sessions and imports awaiting review stay out of the trend.</p></div>}
    <LiftRecords lift={lift} showSession={showSession}/>
  </div>;
}

function LiftList({ lifts, selected, select }: any) {
  const [all, setAll] = useState(false);
  return <div className="lift-trends"><div className="chart-heading"><h3>Your lifts</h3><span className="chart-label">Latest in this range</span></div>
    {(all ? lifts : lifts.slice(0, 5)).map((lift: Row) => {
      const metric = preferredMetric(lift), points = liftSeries(lift, metric), last = points.at(-1);
      const change = metric === 'estimate' ? strengthChange(lift, points) : null;
      return <button key={lift.id} className="trend-row" aria-pressed={selected === lift.id} onClick={() => select(lift.id)}>
        <span><strong>{lift.name}</strong><small>{lift.exercise?.equipment ?? 'Unclassified'} · {basisText[lift.exercise?.weight_basis] ?? 'unknown basis'}</small></span>
        <Sparkline points={points}/><span className="trend-reading">{last ? `${number(last.value)} ${unitFor(metric)}` : 'No estimate'}<small>{change ? changeText(change.delta) : `${lift.records.length} sessions`}</small></span>
      </button>;
    })}{lifts.length > 5 && <button className="text-button" onClick={() => setAll(!all)}>{all ? 'Show fewer lifts' : `Show all ${lifts.length} lifts`}</button>}
  </div>;
}

function WeeklyWork({ progress, area, secondary, muscle }: any) {
  const weeks = areaWork(progress, area, secondary, muscle), total = weeks.reduce((sum, row) => sum + row.sets, 0);
  return <section className="progress-panel weekly-work"><div className="chart-heading"><h2>Weekly work</h2><span className="chart-label">{muscle || area}</span></div>
    <p className="work-reading"><strong>{number(total)}</strong> hard sets</p><p className="chart-note">{secondary ? 'Direct sets + half of secondary sets' : 'Direct sets only'}</p>
    <WorkChart weeks={weeks}/>
    <details className="chart-data"><summary>View weekly numbers</summary><table><caption>Hard sets · {muscle || area}</caption><thead><tr><th scope="col">Week of</th><th scope="col">Sets</th></tr></thead><tbody>{weeks.map(row => <tr key={row.date}><th scope="row">{dateText(row.date)}</th><td>{number(row.sets)}</td></tr>)}</tbody></table><p className="chart-note">Edge weeks include only dates in this range. Drop sets and rest-pause sets count with their working chain. Area counts can overlap.</p></details>
  </section>;
}

function PeriodDetails({ data, progress }: any) {
  const planned = adherence(data, progress.from, progress.to), total = progress.totals;
  const [open, setOpen] = useState(false);
  const length = (Date.parse(progress.to) - Date.parse(progress.from)) / 86400000 + 1;
  const previous = useMemo(() => open ? progressData(data, addDays(progress.from, -length), addDays(progress.from, -1)).totals : null, [data, progress.from, length, open]);
  return <details className="progress-panel period-details" onToggle={event => setOpen(event.currentTarget.open)}><summary>Period details</summary><dl>
    <div><dt>Hard sets</dt><dd>{count(total.hardSets)}</dd></div><div><dt>Recorded volume</dt><dd>{count(total.volumeKg)} kg{total.incompleteVolume && ' · partial'}</dd></div>
    <div><dt>Planned sessions</dt><dd>{planned.target ? `${planned.done} of ${number(planned.target)}` : 'No saved target'}</dd></div>
    <div><dt>Sets with recorded effort</dt><dd>{progress.effort.logged} of {progress.effort.sets}</dd></div>
    <div><dt>Training load</dt><dd>{count(progress.effort.load)} effort × minutes</dd></div>
  </dl>{previous && <><h3>Previous {length} days</h3><p className="chart-note">{previous.sessions} sessions · {count(previous.sets)} working sets · {count(previous.minutes)} minutes</p></>}{total.incompleteVolume && <p className="chart-note">Volume excludes unreviewed imported loads and sets without the required load or body-weight reading.</p>}</details>;
}

export function Progress({ data, showSession, local }: any) {
  const today = todayDate(), [range, setRange] = useState('12w'), [area, setArea] = useState('All areas');
  const [secondary, setSecondary] = useState(false), [muscle, setMuscle] = useState(''), [lift, setLift] = useState('');
  const [weightEarliest, setWeightEarliest] = useState<string | null>(null);
  const workoutEarliest = live(data.session).map((row: Row) => row.local_date).sort()[0] ?? today;
  const earliest = range === 'all' && weightEarliest && weightEarliest < workoutEarliest ? weightEarliest : workoutEarliest;
  const [from, to] = progressRange(range, today, earliest);
  const requestFrom = range === 'all' ? weightHistoryStart(today) : from;
  const progress = useMemo(() => progressData(data, from, to), [data, from, to]);
  const lifts = progress.lifts.filter(row => matchesArea(row, area, secondary, muscle));
  const selected = lifts.find(row => row.id === lift) ?? lifts.find(row => liftSeries(row, 'estimate').length) ?? lifts[0];
  const total = progress.totals, hours = total.minutes / 60;
  function chooseArea(value: string) { setArea(value); setMuscle(''); }
  return <>
    <div className="field progress-header"><div><h1>Progress</h1><p>Training over time</p></div>
      <div className="period-controls" aria-label="Progress date range">{[['4w', '4 weeks'], ['12w', '12 weeks'], ['1y', '1 year'], ['all', 'All']].map(([value, label]) => <button key={value} aria-pressed={range === value} onClick={() => setRange(value)}>{label}</button>)}</div>
    </div>
    <div className="progress-page">
      <div className="progress-period"><span>{dateText(from)} – {dateText(to)} · {from.slice(0, 4) === to.slice(0, 4) ? to.slice(0, 4) : `${from.slice(0, 4)}–${to.slice(0, 4)}`}</span>{/^\d{4}$/.test(range) && <button onClick={() => setRange('all')}>All years</button>}</div>
      <dl className="progress-totals"><div><dt>Sessions</dt><dd>{count(total.sessions)}</dd></div><div><dt>Working sets</dt><dd>{count(total.sets)}</dd></div><div><dt>Training time</dt><dd>{hours >= 1 ? number(hours) : count(total.minutes)} <span>{hours >= 1 ? 'hr' : 'min'}</span></dd></div></dl>
      {progress.openSessions > 0 && <p className="progress-notice">{progress.openSessions} unfinished {progress.openSessions === 1 ? 'session is' : 'sessions are'} separate from these totals.</p>}
      {progress.provisionalSessions > 0 && <p className="progress-notice">Imported history awaits review. Session and set counts are included; imported loads stay out of strength comparisons.</p>}
      <section className="area-controls" aria-label="Strength and work filters"><div className="chart-heading"><h2>Strength & work</h2><span className="chart-label">By body area</span></div>
        <div className="area-buttons">{['All areas', ...Object.keys(BODY_AREAS)].map(value => <button key={value} aria-pressed={area === value} onClick={() => chooseArea(value)}>{value}</button>)}</div>
        <div className="area-options">{area !== 'All areas' && <select aria-label="Muscle" value={muscle} onChange={event => setMuscle(event.target.value)}><option value="">All {area.toLowerCase()} muscles</option>{BODY_AREAS[area].map(value => <option key={value} value={value}>{value}</option>)}</select>}
          <label className="secondary-choice"><input type="checkbox" checked={secondary} onChange={event => setSecondary(event.target.checked)}/>Include secondary work</label>
        </div>
      </section>
      <section className="progress-panel strength-panel" aria-label="Lift progress">{selected ? <><LiftDetail key={selected.id} lift={selected} from={from} to={to} showSession={showSession}/><LiftList key={area+muscle} lifts={lifts} selected={selected.id} select={setLift}/></> : <div className="chart-empty"><h2>{total.sessions ? 'No lifts in this selection' : 'Your progress starts with a session'}</h2><p>{total.sessions ? 'Choose another area or a longer date range.' : 'Finish a workout to see your lifts and training history here.'}</p></div>}</section>
      <div className="progress-support"><WeeklyWork progress={progress} area={area} secondary={secondary} muscle={muscle}/><PeriodDetails data={data} progress={progress}/><BodyWeight local={local} from={from} to={to} requestFrom={requestFrom} allHistory={range === 'all'} onHistoryEarliest={setWeightEarliest}/></div>
      <ActivityCalendar progress={progress} allHistory={range === 'all'} chooseYear={setRange} showSession={showSession}/>
    </div>
  </>;
}
