import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { carryForward, LB_TO_KG, weightIn, targetReason, targetReasonChange, targetReasons } from '../domain/targets.js';
import { byId, live, trainingRows } from '../domain/model.js';
import { carryForwardReasonChanges, finishChanges, returnTargetChanges, skipRemainingChanges, startChanges } from '../domain/session.js';
import { compareSet } from '../domain/metrics.js';
import { HealthContext } from './HealthContext';
import { Button, Row, dateText, numberText, rangeText, saveUndoable, Sheet } from './ui';
import { WorkoutComplete } from './WorkoutComplete';
import { ExerciseHistory } from './ExerciseHistory';
import { useDrafts } from './useDrafts';
import { draftBase } from './drafts.js';
import { positionOrder, sessionFlow } from '../domain/session-flow.js';
import { useRest } from './useRest';

const byPosition = positionOrder;
const parse = (text: string | undefined) => { if (text == null || text.trim() === '') return null; const value = Number(text.replace(',', '.')); return Number.isFinite(value) ? value : null; };
const convert = (weight: number | null, from: string, to: string) => weight == null || from === to ? weight : Number((to === 'kg' ? weight * LB_TO_KG : weight / LB_TO_KG).toFixed(2));
const text = (value: number | null | undefined) => value == null ? '' : numberText(value);
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const setLabel = (set: Row, sets: Row[]) => set.type === 'warmup' ? 'W' : set.type === 'drop' ? 'D' : String(sets.filter(row => row.type !== 'warmup' && row.type !== 'drop' && row.position <= set.position).length);

function useRestAlert(restSeconds: number, active: boolean) {
  const audio = useRef<AudioContext | null>(null), previous = useRef(restSeconds);
  useEffect(() => {
    if (previous.current > 0 && restSeconds === 0 && active) {
      try {
        const ctx = audio.current!, start = ctx.currentTime;
        for (const offset of [0, 0.25]) {
          const tone = ctx.createOscillator(), gain = ctx.createGain(); tone.frequency.value = 880;
          gain.gain.setValueAtTime(0.0001, start + offset); gain.gain.exponentialRampToValueAtTime(0.3, start + offset + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.18);
          tone.connect(gain).connect(ctx.destination); tone.start(start + offset); tone.stop(start + offset + 0.2);
        }
      } catch {}
      navigator.vibrate?.([150, 100, 150]);
    }
    previous.current = restSeconds;
  }, [restSeconds]);
  // iOS plays sound only from a context that a tap created or resumed.
  return () => { try { audio.current ??= new AudioContext(); audio.current.resume(); } catch {} };
}

export function Logger({ data, local, session, back, changed, fail, openSession, waiting, onSwap }: any) {
  const index = useMemo(() => ({ set: byId(data.set), exercise: byId(data.exercise), session: byId(data.session), session_slot: byId(data.session_slot), program_day: byId(data.program_day), program: byId(data.program), setting: byId(data.setting) }), [data]);
  const { slots, setsBySlot } = useMemo(() => {
    const slots = live(data.session_slot).filter((slot: Row) => slot.session_id === session.id).sort(byPosition), ids = new Set(slots.map((slot: Row) => slot.id));
    const setsBySlot = Map.groupBy(live(data.set).filter((set: Row) => ids.has(set.session_slot_id)), (set: Row) => set.session_slot_id);
    for (const list of setsBySlot.values()) list.sort(byPosition);
    return { slots, setsBySlot };
  }, [data, session.id]);
  const setsOf = (slot: Row): Row[] => setsBySlot.get(slot.id) ?? [];
  const allSets = slots.flatMap(setsOf);
  const remaining = allSets.filter((set: Row) => set.done_at == null);
  const flow = sessionFlow(slots, allSets), { last, next } = flow;
  const drafts = useDrafts(local, session.id, fail, data.set), [closeReason, setCloseReason] = useState('');
  const [availableAdvisory, setAvailableAdvisory] = useState<Row | null>(null), [linkAdvisory, setLinkAdvisory] = useState(false);
  const rest = useRest(local, session.id, flow.rest, fail), restSeconds = rest.seconds, showRest = rest.active;
  const [large, setLarge] = useState<string | null>(null), [notes, setNotes] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<any>(null), [howTo, setHowTo] = useState<string | null>(null), [seeSets, setSeeSets] = useState(false);
  useEffect(() => { setSeeSets(false); }, [session.status]);
  const advisoryChanged = useCallback((advisory: Row | null) => { setAvailableAdvisory(advisory); setLinkAdvisory(false); }, [session.id]);
  const saving = useRef(false), toggled = useRef(new Map<string, number>()), taps = useRef(0), touched = useRef<number | null>(null), shown = useRef<string | null>(null);
  const day = index.program_day.get(session.program_day_id);
  const lastSlot = slots.find((slot: Row) => slot.id === last?.session_slot_id);
  const unlockSound = useRestAlert(restSeconds, !!flow.rest && !rest.skipped);
  useEffect(() => {
    let lock: any; const keepAwake = async () => { try { if (document.visibilityState === 'visible') lock = await navigator.wakeLock?.request('screen'); } catch {} };
    keepAwake(); document.addEventListener('visibilitychange', keepAwake);
    return () => { document.removeEventListener('visibilitychange', keepAwake); lock?.release(); };
  }, []);

  useEffect(() => {
    if (!next || shown.current === next.id) return;
    shown.current = next.id; touched.current = null; taps.current = 0;
    local.record('shown', { weight: next.weight, reps: next.reps, reference: next.target_reference }, { session_id: session.id, set_id: next.id });
  }, [next?.id]);

  const unitOf = (slot: Row) => drafts.unit(slot) ?? setsOf(slot).find((set: Row) => set.unit)?.unit ?? 'kg';
  function suggestion(set: Row, slot: Row) {
    const prior = setsOf(slot).filter((row: Row) => row.done_at != null && row.position < set.position).at(-1);
    const base = carryForward(set, prior), unit = unitOf(slot);
    return { weight: text(convert(base.weight, base.unit ?? 'kg', unit)), reps: text(base.reps ?? set.target_reps_min), seconds: text(base.seconds ?? set.target_seconds ?? 30) };
  }
  function shownValues(set: Row, slot: Row) {
    const unit = unitOf(slot);
    if (set.done_at != null) return { weight: text(convert(set.weight, set.unit ?? 'kg', unit)), reps: text(set.reps), seconds: text(set.seconds) };
    return { ...suggestion(set, slot), ...drafts.records[set.id]?.values };
  }
  const edit = (set: Row, field: string, value: string) => drafts.edit(set, field, value, unitOf(slots.find((slot: Row) => slot.id === set.session_slot_id)));
  function switchUnit(slot: Row) {
    const from = unitOf(slot), to = from === 'kg' ? 'lb' : 'kg';
    drafts.switchUnit(slot, setsOf(slot), to, (value, unit) => text(convert(parse(value), unit, to)));
  }
  const focus = (field: string, set: Row) => document.getElementById(`${field}-${set.id}`)?.focus();
  const returnFor = (slot: Row) => live(data.setting).find((row: Row) => row.id === `return:${slot.id}`);
  const pendingReturn = (slot: Row) => { const setting = returnFor(slot); return setting?.value?.choice == null ? setting?.value : null; };
  const learned = (slot: Row, unit: string) => trainingRows(data).filter((row: Row) => row.exercise_id === slot.exercise_id).flatMap((row: Row) => row.sets.filter((set: Row) => set.unit === unit).map((set: Row) => set.weight));

  async function log(set: Row, slot: Row, confirmed = false) {
    if (saving.current || !drafts.ready || drafts.conflict(set) || pendingReturn(slot)) return;
    const shownNow = shownValues(set, slot), unit = unitOf(slot);
    const weight = parse(shownNow.weight), reps = parse(shownNow.reps), seconds = parse(shownNow.seconds);
    if (set.type === 'timed') { if (!seconds || seconds < 1 || seconds > 9999 || !Number.isInteger(seconds)) { focus('seconds', set); return; } }
    else {
      if (weight == null || weight < 0 || weight > 999.75) { focus('weight', set); return; }
      if (!reps || reps < 1 || reps > 99 || !Number.isInteger(reps)) { focus('reps', set); return; }
    }
    const max = Math.max(0, ...learned(slot, unit));
    if (!confirmed && set.type !== 'timed' && max > 0 && weight! > max * 1.7 && !live(data.setting).find((row: Row) => row.id === 'unusual_numbers_disabled')?.value) { setLarge(set.id); return; }
    saving.current = true; setBusy(true);
    const time = Date.now(), start = performance.now(), elapsed = touched.current == null ? 0 : (performance.now() - touched.current) / 1000;
    try {
      const row: Row = set.type === 'timed'
        ? { id: set.id, seconds, unit, weight: set.weight ?? null, reps: set.reps ?? 0, grams: set.grams ?? null, done_at: time }
        : { id: set.id, weight, reps, unit, seconds: set.seconds ?? null, grams: Math.round(weight! * (unit === 'lb' ? LB_TO_KG : 1) * 1000), done_at: time };
      const initial = startChanges(data, session, time);
      const changes: any[] = [...initial, { table: 'set', row }, ...carryForwardReasonChanges(allSets, { ...set, ...row }), ...(session.status === 'open' ? [] : reopen())];
      if (remaining.length === 1 && remaining[0].id === set.id) changes.push(...finishChanges(data, { ...session, ...initial[0]?.row }, time));
      await local.drafts.flush();
      await local.save(changes, null, { [`set:${set.id}`]: draftBase(set) });
      await local.record('logged', { saveMs: performance.now() - start, taps: taps.current, seconds: elapsed, weight: row.weight, reps: row.reps }, { session_id: session.id, set_id: set.id });
      taps.current = 0; touched.current = null; toggled.current.set(set.id, Date.now());
      drafts.forget(set);
      setLarge(null); local.sync(); changed();
    } catch (error) { fail(error.message || 'This set did not save. Keep this screen open and try again.'); changed(); }
    finally { saving.current = false; setBusy(false); }
  }

  function reopen() {
    const changes: any[] = [{ table: 'session', row: { id: session.id, status: 'open', ended_at: null } }];
    const done = live(data.run_event).find((event: Row) => event.id === `done:${session.id}`);
    if (done) { changes.push({ table: 'run_event', row: { id: done.id, deleted_at: Date.now() } }); changes.push({ table: 'run', row: { id: session.run_id, next_position: done.position, status: byId(data.run).get(session.run_id)?.status === 'paused' ? 'paused' : 'active' } }); }
    return changes;
  }

  async function guarded(work: () => Promise<void>) {
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try { await work(); } finally { saving.current = false; setBusy(false); }
  }
  // One accepted tap per set per second, in both directions, so a double tap never logs and undoes.
  function toggle(set: Row, slot: Row) {
    const time = Date.now();
    if (time - (toggled.current.get(set.id) ?? 0) < 1000) return;
    toggled.current.set(set.id, time);
    return set.done_at != null ? undo(set, slot) : log(set, slot);
  }

  const addSet = (slot: Row) => guarded(async () => {
    const sets = setsOf(slot), base = sets.filter((set: Row) => set.type !== 'warmup').at(-1) ?? sets.at(-1);
    if (!base) return;
    const row: Row = { id: crypto.randomUUID(), session_slot_id: slot.id, position: Math.max(...sets.map((set: Row) => set.position)) + 1, type: base.type === 'drop' ? 'working' : base.type,
      target_reps_min: base.target_reps_min ?? null, target_reps_max: base.target_reps_max ?? null, target_seconds: base.target_seconds ?? null, target_weight: base.target_weight ?? null,
      target_effort: base.target_effort ?? 8, target_reference: base.target_reference ?? null, reference_set_id: base.reference_set_id ?? null,
      weight: base.weight ?? null, unit: base.unit ?? 'kg', grams: base.grams ?? null, reps: base.reps ?? null, seconds: base.seconds ?? null, reps_left: null, effort_source: 'assumed',
      bodyweight_grams: base.bodyweight_grams ?? null, done_at: null, local_date: session.local_date, note: '' };
    const prior = sets.filter((set: Row) => set.done_at != null).at(-1), suggested = carryForward(row, prior);
    const explanation = targetReasonChange(row, row.type === 'timed' ? 'timed_plan' : 'added_set', suggested, suggested === row ? null : prior);
    try { await local.save([{ table: 'set', row }, explanation, ...(session.status === 'open' ? [] : reopen())]); local.sync(); changed(); }
    catch { fail('The extra set did not save.'); }
  });

  const finishEarly = () => {
    return guarded(async () => {
      const advisoryId = linkAdvisory && availableAdvisory && Date.parse(availableAdvisory.validUntil) > Date.now() ? availableAdvisory.advisoryId : null;
      try { await saveUndoable(local, finishChanges(data, session, Date.now(), true, closeReason || null, advisoryId), 'Finished early · logged sets kept'); local.sync(); changed(); }
      catch { fail('The workout did not finish. Try again.'); }
    });
  };

  const undo = (set: Row, slot: Row) => guarded(async () => {
    const changes: any[] = [{ table: 'set', row: { id: set.id, done_at: null } }, ...reopen()];
    try {
      const values = shownValues(set, slot);
      shown.current = null;
      await local.save(changes); toggled.current.set(set.id, Date.now());
      taps.current = 0; touched.current = null;
      await drafts.update({ ...set, done_at: null }, values, unitOf(slot), true);
      local.sync(); changed();
    } catch { fail('Undo did not save.'); }
  });

  const chooseReturn = (slot: Row, reduction: number) => guarded(async () => {
    try {
      const setting = returnFor(slot), changes = returnTargetChanges(data, slot, reduction);
      await local.save(changes);
      for (const { table, row } of changes) if (table === 'set' && drafts.records[row.id]) {
        const { weight: _, ...values } = drafts.records[row.id].values;
        await drafts.update({ ...index.set.get(row.id), ...row }, values, drafts.records[row.id].unit, true);
      }
      await local.record('tap', { action: 'return-choice', days: setting.value.days, reduction }, { session_id: session.id, set_id: changes.find(change => change.table === 'set')?.row.id ?? null });
      local.sync(); changed();
    } catch { fail('The return choice did not save.'); }
  });

  const rate = last && (remaining.length === 0 || !remaining.some((set: Row) => set.session_slot_id === last.session_slot_id));
  const rating = (value: number) => { const reps_left = last.reps_left === value ? null : value; return local.save([{ table: 'set', row: { id: last.id, reps_left, effort_source: reps_left == null ? 'assumed' : 'logged' } }]).then(() => { local.sync(); changed(); }).catch(() => fail('The effort rating did not save.')); };
  const lastReference = index.set.get(last?.reference_set_id);
  const result = lastReference ? compareSet(last, lastReference, index.exercise.get(lastSlot?.exercise_id)) : null;
  const resultText = result ? result === 'behind' ? 'Behind last time' : result === 'same' ? 'Same as last time' : 'Beat last time' : null;
  const count = (event: React.SyntheticEvent) => { unlockSound(); if (!(event.target as HTMLElement).closest('button,input') || (event.target as HTMLElement).closest('[data-uncounted]')) return; if (touched.current == null) touched.current = performance.now(); taps.current++; };
  const doneCount = allSets.length - remaining.length;
  const groups = [...new Set(slots.map((slot: Row) => slot.group_id).filter((id: any) => id && slots.filter((other: Row) => other.group_id === id).length > 1))];
  const groupLabel = (slot: Row) => { const at = groups.indexOf(slot.group_id); if (at < 0) return null; const members = slots.filter((other: Row) => other.group_id === slot.group_id); return `${flow.guided.has(slot.id) ? 'Superset' : 'Group'} ${String.fromCharCode(65 + at)}${flow.memberNumbers.get(slot.id) ?? members.indexOf(slot) + 1}`; };

  const skip = (slot: Row) => guarded(async () => {
    try {
      await saveUndoable(local, skipRemainingChanges(data, session, slot), 'Remaining sets skipped · logged sets kept');
      setNotes(null); local.sync(); changed();
    } catch { fail('The remaining sets did not skip. Try again.'); }
  });
  const menuSlot = slots.find((slot: Row) => slot.id === notes);
  const historySheet = history && <ExerciseHistory data={data} exerciseId={history.id} initialRange={history.range} close={() => setHistory(null)}/>;
  if (session.status !== 'open' && !seeSets) return <><WorkoutComplete {...{ data, session, local, changed, fail, back, openSession }} lastSetRating={rate && <Rating last={last} rating={rating}/>} seeSets={() => setSeeSets(true)} history={(id: string, range: any) => setHistory({ id, range })}/>{historySheet}</>;

  return <section className="logger" onClickCapture={count}>
    <LoggerHeader {...{ back, day, index, openSession, waiting, remaining, doneCount, allSets }}/>
    {slots.map((slot: Row) => <ExerciseCard key={slot.id} {...{ slot, index, session, group: groupLabel(slot), addSet, sets: setsOf(slot), unit: unitOf(slot), shownValues, edit, switchUnit, log, toggle, busy: busy || !drafts.ready, large, setLarge, menu: () => setNotes(slot.id), local, fail, pending: pendingReturn(slot), chooseReturn, next, drafts }}/>)}
    {menuSlot && <ExerciseMenu {...{ slot: menuSlot, exercise: index.exercise.get(menuSlot.exercise_id), index, session, busy, local, fail, changed, onSwap, skip, addSet, setHowTo, setHistory }} sets={setsOf(menuSlot)} close={() => setNotes(null)}/>}
    {historySheet}
    {howTo && <Sheet title={`How to · ${index.exercise.get(howTo)?.name ?? 'Exercise'}`} close={() => setHowTo(null)}><p style={{ whiteSpace: 'pre-wrap' }}>{index.exercise.get(howTo)?.instructions || 'No instructions saved for this exercise.'}</p></Sheet>}
    {showRest && <div className="rest-bar" role="region" aria-label="Rest">
      <div className="rest-row"><div><span className="muted">Rest</span><strong role="timer" aria-label={`${restSeconds} seconds remaining`}>{clock(restSeconds)}</strong></div><button className="pill" data-uncounted onClick={rest.extend}>+15 s</button><button className="pill strong" data-uncounted onClick={rest.skip}>Skip</button></div>
      {resultText && <p className="set-result">{resultText}</p>}
      {rate && <Rating last={last} rating={rating}/>}
    </div>}
    {session.status === 'open' && <HealthContext session={session} data={data} local={local} onAdvisoryChange={advisoryChanged}/>}
    {remaining.length > 0 && session.status === 'open' && <><label>Why are you stopping?<select value={closeReason} onChange={event => setCloseReason(event.target.value)}><option value="">Choose if useful</option><option value="time">Time</option><option value="interruption">Interruption</option><option value="recovery">Recovery</option><option value="difficulty">Difficulty</option><option value="manual">Manual choice</option></select></label><label className="checkbox"><input type="checkbox" checked={linkAdvisory && !!availableAdvisory && Date.parse(availableAdvisory.validUntil) > Date.now()} disabled={!availableAdvisory || Date.parse(availableAdvisory.validUntil) <= Date.now()} onChange={event => setLinkAdvisory(event.target.checked)}/>I’m following this guidance</label><button className="text-button finish-early" disabled={busy} onClick={finishEarly}>Finish workout</button></>}
  </section>;
}

function Rating({ last, rating }: any) {
  return <div className="rating" data-uncounted><p>Reps left on the last set? <span className="muted">Optional</span></p><div className="chips">{[0, 1, 2, 3, 4].map(value => <button key={value} aria-pressed={last.reps_left === value} onClick={() => rating(value)}>{value === 4 ? '4+' : value}</button>)}</div></div>;
}

function describe(first: Row | undefined, index: any, session: Row) {
  const reference = index.set.get(first?.reference_set_id);
  const referenceSession = index.session.get(index.session_slot.get(reference?.session_slot_id)?.session_id);
  const referenceDay = index.program_day.get(referenceSession?.program_day_id), referenceDate = dateText(referenceSession?.local_date);
  const source = referenceSession?.run_id === session.run_id && referenceDay?.week ? `Week ${referenceDay.week}` : referenceDate;
  const range = first?.type === 'timed' ? 'Timed' : rangeText(first?.target_reps_min, first?.target_reps_max);
  if (first?.target_reference === 'same_range') return { range, subtitle: `Last time at ${range} · ${source}`, reason: null };
  if (first?.target_reference === 'other_range') return { range, subtitle: `First time at ${range}`, reason: `No ${range} history. These are your numbers from ${referenceDate}, at ${rangeText(reference?.target_reps_min, reference?.target_reps_max)}. Set 1 corrects them.` };
  return { range, subtitle: `${range} reps`, reason: null };
}

function ExerciseCard({ slot, index, session, group, addSet, sets, unit, shownValues, edit, switchUnit, log, toggle, busy, large, setLarge, menu, local, fail, pending, chooseReturn, next, drafts }: any) {
  const exercise = index.exercise.get(slot.exercise_id), first = sets.find((set: Row) => set.done_at == null) ?? sets[0];
  const { range, subtitle, reason } = describe(first, index, session);
  const timed = sets.some((set: Row) => set.type === 'timed'), complete = sets.every((set: Row) => set.done_at != null);
  return <article className={`card exercise${complete ? ' complete' : ''}${next?.session_slot_id === slot.id ? ' current' : ''}`} aria-label={slot.name}>
    <header className="exercise-head"><div>{group && <p className="eyebrow group">{group}</p>}<h2>{slot.name ?? exercise?.name}</h2><p className="muted subtitle">{subtitle}</p></div><button className="icon-button" aria-haspopup="dialog" aria-label={`Exercise menu for ${slot.name}`} onClick={menu}>⋯</button></header>
    {pending && <div className="return"><p><strong>Back after {pending.days} days.</strong> Choose your starting weight.</p><div className="return-choices">{[0, 0.05, 0.1].map(reduction => <button key={reduction} className="pill" disabled={busy} onClick={() => chooseReturn(slot, reduction)}>{reduction === 0 ? 'Same' : `${reduction * 100}% lighter`}{pending.recommended === reduction ? ' ✓' : ''}</button>)}</div></div>}
    <div className={`set-table${timed ? ' timed' : ''}`} role="table" aria-label={`${slot.name} sets`}>
      <div className="set-row head" role="row"><span role="columnheader">Set</span><span role="columnheader">Last</span>{timed ? <span role="columnheader">Sec</span> : <><span role="columnheader"><button className="unit-switch" disabled={busy} aria-label={`Weight in ${unit}. Switch to ${unit === 'kg' ? 'lb' : 'kg'}`} onClick={() => switchUnit(slot)}>{unit}</button></span><span role="columnheader">Reps</span></>}<span role="columnheader" className="sr-only">Done</span></div>
      {sets.map((set: Row) => <SetRow key={set.id} {...{ set, slot, sets, index, unit, timed, shownValues, edit, log, toggle, busy, large, setLarge, pending, drafts, next }}/>)}
    </div>
    <button className="add-set" disabled={busy} onClick={() => addSet(slot)}>+ Add set</button>
  </article>;
}

function SetRow({ set, slot, sets, index, unit, timed, shownValues, edit, log, toggle, busy, large, setLarge, pending, drafts, next }: any) {
  const values = shownValues(set, slot), done = set.done_at != null, label = setLabel(set, sets), ref = index.set.get(set.reference_set_id);
  const conflict = drafts.conflict(set);
        const lastText = ref ? set.type === 'timed' ? `${ref.seconds ?? ''} s` : `${numberText(weightIn(ref, unit))} × ${ref.reps}` : '';
        const field = (name: string, mode: 'decimal' | 'numeric', aria: string) => <input id={`${name}-${set.id}`} className="cell-input" inputMode={mode} enterKeyHint="done" autoComplete="off" aria-label={`Set ${label} ${aria}`} placeholder={name === 'weight' ? unit : ''} value={values[name]} readOnly={done} disabled={busy || !!conflict} onFocus={event => event.target.select()} onChange={event => edit(set, name, event.target.value)}/>;
        return <>
          <div className={`set-row${done ? ' done' : ''}`} role="row" aria-current={set.id === next?.id ? 'step' : undefined}>
            <span className={`set-label${set.type === 'warmup' || set.type === 'drop' ? ' tag' : ''}`} role="cell">{label}</span>
            <span className="last" role="cell">{lastText}</span>
            {set.type === 'timed' ? <span role="cell" className="wide">{field('seconds', 'numeric', 'seconds')}</span> : timed ? <span role="cell" className="wide">{field('reps', 'numeric', 'reps')}</span> : <><span role="cell">{field('weight', 'decimal', `weight in ${unit}`)}</span><span role="cell">{field('reps', 'numeric', 'reps')}</span></>}
            <span role="cell"><button className="check" aria-pressed={done} aria-label={done ? `Undo set ${label}` : `Log set ${label}`} disabled={busy || !!conflict || (!!pending && !done)} onClick={() => toggle(set, slot)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button></span>
          </div>
          {conflict && <div className="large" role="alert"><p>Set {label} changed elsewhere. Your draft is shown above.</p><div><button className="pill" onClick={() => drafts.resolve(set, false)}>Use saved values</button><button className="pill strong" onClick={() => drafts.resolve(set, true)}>Keep my draft</button></div></div>}
          {large === set.id && <div className="large" role="status"><p>{values.weight} {unit} is much higher than your recorded weights.</p><div><button className="pill" onClick={() => { setLarge(null); document.getElementById(`weight-${set.id}`)?.focus(); }}>Change</button><button className="pill strong" onClick={() => log(set, slot, true)}>Log anyway</button></div></div>}
        </>;
}

function LoggerHeader({ back, day, index, openSession, waiting, remaining, doneCount, allSets }: any) {
  return <>    <header className="bar"><button className="bar-link" onClick={back}>‹ Home</button><span className="bar-title">{day ? `Week ${day.week ?? 1} · Day ${day.day ?? day.position + 1}` : 'Extra sets'}</span><button className="bar-link end" onClick={openSession}>{waiting > 0 ? `${waiting} waiting` : 'Session'}</button></header>
    <div className="logger-head"><h1>{remaining.length ? index.program.get(day?.program_id)?.name ?? 'Extra sets' : 'Workout complete'}</h1><p className="muted">{doneCount} of {allSets.length} sets</p><div className="progress" aria-hidden="true"><span style={{ width: `${allSets.length ? doneCount / allSets.length * 100 : 0}%` }}/></div></div>
</>;
}

function ExerciseMenu({ slot, exercise, sets, index, session, busy, local, fail, changed, onSwap, skip, addSet, setHowTo, setHistory, close }: any) {
  const first = sets.find((set: Row) => set.done_at == null) ?? sets[0];
  const { reason } = describe(first, index, session);
  const saved = targetReason(first, index.setting.get(`target-reason:${first?.id}`), index.set);
  const target = saved?.seconds != null ? `${numberText(saved.seconds)} s` : saved?.weight != null ? `${numberText(saved.weight)} ${saved.unit} × ${numberText(saved.reps)}` : `${numberText(saved?.reps)} reps`;
  const note = (table: string, id: string, field: string, value: string) => local.save([{ table, row: { id, [field]: value } }]).then(() => { local.sync(); changed(); }).catch(() => fail('The note did not save.'));
  return <Sheet title={slot.name} close={close}><div className="exercise-menu">
    {onSwap && <button disabled={busy} onClick={() => { close(); onSwap(slot); }}>Swap for today</button>}
    <button disabled={busy || session.status !== 'open' || !sets.some((set: Row) => set.done_at == null)} onClick={() => skip(slot)}>Skip remaining sets</button>
    <button disabled={busy} onClick={() => { addSet(slot); close(); }}>Add a set</button>
    <button onClick={() => { setHowTo(slot.exercise_id); close(); }}>How to</button>
    <button onClick={() => { setHistory({ id: slot.exercise_id, range: null }); close(); }}>History</button>
    {saved ? <p className="muted target-reason">Suggested target: {target}. {targetReasons[saved.code]}</p> : reason && <p className="muted">{reason}</p>}
    {first && <label>Today's note<textarea defaultValue={first.note ?? ''} onBlur={event => note('set', first.id, 'note', event.target.value)}/></label>}
    {exercise && <label>Note for next time<textarea defaultValue={exercise.pinned_note ?? ''} onBlur={event => note('exercise', exercise.id, 'pinned_note', event.target.value)}/></label>}
  </div></Sheet>;
}
