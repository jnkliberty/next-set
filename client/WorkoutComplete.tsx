import React from 'react';
import { byId } from '../domain/model.js';
import { workoutResults } from '../domain/session.js';
import { weightIn } from '../domain/targets.js';
import { Button, Row, dateText, numberText, rangeText } from './ui';
import './workout-results.css';

export function WorkoutComplete({ data, session, local, changed, fail, back, seeSets, history, openSession, lastSetRating }: any) {
  const result = workoutResults(data, session), day = byId(data.program_day).get(session.program_day_id);
  const effort = (value: number) => local.save([{ table: 'session', row: { id: session.id, effort: session.effort === value ? null : value } }])
    .then(() => { local.sync(); changed(); }).catch(() => fail('The session effort did not save.'));
  return <section className="workout-results">
    <button className="bar-link end" onClick={openSession}>Session</button>
    <header className="results-heading"><h1>{session.status === 'finished_early' ? 'Finished early' : 'Workout complete'}</h1><p>{day ? `Week ${day.week ?? 1} · Day ${day.day ?? day.position + 1}` : 'Extra workout'}</p><p className="muted">{dateText(session.local_date)} · {result.minutes} min</p></header>
    <dl className="results-totals"><div><dt>Sets</dt><dd>{result.logged} of {result.total}</dd></div><div><dt>kg lifted</dt><dd>{result.volumeKg == null ? 'Unavailable' : numberText(result.volumeKg)}</dd></div>{result.comparison && <div><dt>kg lifted vs last Day {result.comparison.day} · {dateText(result.comparison.session.local_date)}</dt><dd>{result.comparison.percent > 0 ? '+' : ''}{result.comparison.percent}%</dd></div>}</dl>
    {result.volumeKg == null && <p className="muted">A logged set needs a weight or body weight before the total can be shown.</p>}
    {result.bests.length > 0 && <section><h2>New bests</h2><div className="results-list">{result.bests.map((best: Row) => <button key={best.set.id} onClick={() => history(best.exercise.id, best.range)}><strong><span aria-hidden="true">☆ </span>{best.exercise.name}</strong><span>{numberText(weightIn(best.set))} kg × {best.set.reps} · best for {rangeText(...best.range as [number, number])} reps</span><span className="muted">{weightIn(best.set) > weightIn(best.previous) ? `+${numberText(weightIn(best.set) - weightIn(best.previous))} kg` : `+${best.set.reps - best.previous.reps} reps`}</span></button>)}</div></section>}
    {result.next.length > 0 && <section><h2>Next time</h2><div className="results-list">{result.next.map((next: Row) => <div key={next.slot.id}><strong>{next.slot.name}</strong><span>{numberText(next.weight)} {next.unit} × {next.reps} reps</span></div>)}</div></section>}
    {lastSetRating}
    <section className="results-effort"><h2>How hard was it?</h2><p className="muted">Optional</p><div role="group" aria-label="Session effort">{[5, 6, 7, 8, 9, 10].map(value => <button key={value} aria-pressed={session.effort === value} onClick={() => effort(value)}>{value}{session.effort === value && <span className="sr-only"> selected</span>}</button>)}</div><p className="effort-ends"><span>5 · Easy</span><span>10 · All out</span></p></section>
    <button className="text-button" onClick={seeSets}>See sets</button><Button primary onClick={back}>Done</Button>
  </section>;
}
