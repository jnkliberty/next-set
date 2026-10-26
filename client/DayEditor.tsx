import React, { useEffect, useMemo, useRef, useState } from 'react';
import { byId, exerciseIdentity, live, trainingRows } from '../domain/model.js';
import { editProgram, editWorkout, withChanges } from '../domain/edits.js';
import { Button, Row, Sheet, rangeText, saveUndoable } from './ui';
import './program-editing.css';
import { ExerciseHistory } from './ExerciseHistory';

const GROUPS: [string, string[]][] = [['All', []], ['Back', ['lats', 'middle back', 'lower back', 'traps']], ['Chest', ['chest']], ['Legs', ['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors']],
  ['Shoulders', ['shoulders', 'neck']], ['Arms', ['biceps', 'triceps', 'forearms']], ['Core', ['abdominals']]];
const EQUIPMENT = ['Any', 'Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight'];
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const byPosition = (a: Row, b: Row) => a.position - b.position;

export function daySlots(data: any, day: Row, session?: Row) {
  return session ? live(data.session_slot).filter((slot: Row) => slot.session_id === session.id).sort(byPosition)
    : live(data.slot).filter((slot: Row) => slot.program_day_id === day?.id).sort(byPosition);
}

export function slotSets(data: any, slot: Row) {
  return live(slot.session_id ? data.set : data.slot_set).filter((row: Row) => (slot.session_id ? row.session_slot_id : row.slot_id) === slot.id).sort(byPosition);
}

function initialPlan(data: any, slot?: Row) {
  const first = slot ? slotSets(data, slot)[0] : null;
  return { count: slot ? slotSets(data, slot).length || 2 : 3, low: first?.reps_min ?? first?.target_reps_min ?? 8, high: first?.reps_max ?? first?.target_reps_max ?? 12,
    rest: slot?.rest_seconds ?? 90, type: first?.type ?? 'working', seconds: first?.seconds ?? first?.target_seconds ?? 30 };
}

// mode 'today' edits the shown workout and can reach the program; mode 'program' edits templates only.
export function DayEditor({ data, local, run, day: initialDay, session, mode, start, close, refresh, fail }: any) {
  const day = byId(data.program_day).get(initialDay?.id) ?? initialDay;
  const extra = mode === 'today' && session?.program_day_id === null;
  const scopes = mode === 'program' ? [['week', 'This week only'], ['program', 'Every week']] : extra ? [['today', 'Today only']] : [['today', 'Today only'], ['future', 'From now on'], ['program', 'Every week']];
  const [scope, setScope] = useState(scopes[0][0]), [step, setStep] = useState(start?.step ?? 'day'), [slot, setSlot] = useState<Row | null>(start?.slot ?? null);
  const [picked, setPicked] = useState<string[]>([]), [busy, setBusy] = useState(false), [history,setHistory]=useState<string|null>(null);
  const slots = daySlots(data, day, mode === 'today' ? session : null);
  async function apply(edits: Row[]) {
    if (busy) return; setBusy(true);
    try {
      let current = data, open = session, changes: any[] = [];
      for (const edit of edits) {
        const result = mode === 'program' ? editProgram(current, { day, scope, ...edit } as any) : editWorkout(current, { day, run, session: open, scope, ...edit } as any);
        changes.push(...result.changes); current = withChanges(current, result.changes);
        if (mode === 'today') open = byId(current.session).get(result.sessionId);
      }
      await saveUndoable(local, changes, `Saved · ${scopes.find(([key]) => key === scope)?.[1]}`); await refresh(); local.sync(); setStep('day'); setSlot(null); setPicked([]);
    } catch (error) { fail(error.message || 'The change did not save.'); } finally { setBusy(false); }
  }
  const back = () => setStep(step === 'setup' && !slot ? 'library' : 'day');
  const title = step === 'library' ? (slot ? 'Swap exercise' : `Add to Day ${day?.day ?? 1}`) : step === 'slot' ? slot?.name ?? data.exercise.find((row: Row) => row.id === slot?.exercise_id)?.name : step === 'setup' ? (slot ? 'Sets and reps' : 'Set up') : 'Edit day';
  if(history)return <ExerciseHistory data={data} exerciseId={history} close={()=>setHistory(null)}/>;
  return <Sheet title={title} close={close}>
    {step !== 'day' && <button className="text-button back" onClick={back}>‹ Back</button>}
    {step === 'day' && <DayStep data={data} day={day} extra={extra} slots={slots} apply={apply} busy={busy} mode={mode} scopes={scopes} scope={scope} setScope={setScope} open={(row: Row) => { setSlot(row); setStep('slot'); }} add={() => { setSlot(null); setPicked([]); setStep('library'); }}/>}
    {step === 'slot' && slot && <SlotMenu data={data} local={local} slot={slot} slots={slots} busy={busy} apply={apply} fail={fail} go={setStep} history={()=>setHistory(slot.exercise_id)}/>}
    {step === 'library' && <Library data={data} local={local} fail={fail} slots={slots} swap={!!slot} picked={picked} setPicked={setPicked} done={(ids: string[]) => slot ? apply([{ slot, action: 'swap', exerciseId: ids[0] }]) : setStep('setup')}/>}
    {step === 'setup' && <Setup data={data} slot={slot} picked={picked} busy={busy} save={(plan: Row) => apply(slot ? [{ slot, action: 'sets', ...plan }] : picked.map(exerciseId => ({ action: 'add', exerciseId, ...plan })))}/>}
  </Sheet>;
}

function DayStep({ data, day, extra, slots, scopes, scope, setScope, open, add, apply, busy, mode }: any) {
  const exercises = byId(data.exercise);
  const [drag,setDrag]=useState<number|null>(null),[over,setOver]=useState<number|null>(null);
  const targetAt=(event:React.PointerEvent)=>Number(document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-slot-index]')?.getAttribute('data-slot-index')??-1);
  return <>
    <h3 className="day-title">{extra ? 'Extra workout' : `Week ${day?.week ?? 1} · Day ${day?.day ?? 1}`}</h3>
    <div className="segmented" role="radiogroup" aria-label="Where changes go">{scopes.map(([key, label]: string[]) => <button key={key} role="radio" aria-checked={scope === key} onClick={() => setScope(key)}>{label}</button>)}</div>
    {mode==='program'&&<label className="day-name">Day name<input key={day.id+':'+(day.title??'')} defaultValue={day.title??''} maxLength={200} onBlur={event=>{if(event.target.value.trim()!==(day.title??''))apply([{action:'title',title:event.target.value}]);}}/></label>}
    <div className="card list">{slots.map((slot: Row,index:number) => { const sets = slotSets(data, slot), first = sets[0];
      const name=slot.name??exercises.get(slot.exercise_id)?.name;
      return <div className={`day-editor-row${over===index?' drag-over':''}`} key={slot.id} data-slot-index={index}>
        <button className="drag-handle" disabled={busy} aria-label={`Drag to reorder ${name}`} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);setDrag(index);setOver(index);}} onPointerMove={event=>{if(drag!==null){const target=targetAt(event);if(target>=0)setOver(target);}}} onPointerUp={event=>{const target=targetAt(event);if(drag!==null&&target>=0&&target!==drag)apply([{slot,action:'reorder',targetPosition:target}]);setDrag(null);setOver(null);}} onPointerCancel={()=>{setDrag(null);setOver(null);}}>≡</button>
        <button className="list-row" disabled={busy} onClick={() => open(slot)} aria-label={`Change ${name}`}><span className="row-main">{slot.group_kind==='superset'&&<span className="superset-mark">Superset {slots.findIndex((s:Row)=>s.group_id===slot.group_id)+1}</span>}<strong>{name}</strong><small>{sets.length} sets · {rangeText(first?.reps_min ?? first?.target_reps_min ?? null, first?.reps_max ?? first?.target_reps_max ?? null)} reps · {slot.rest_seconds??90} s rest</small></span><span className="more" aria-hidden="true">⋯</span></button></div>; })}
      {!slots.length && <p className="list-row muted">No exercises yet.</p>}</div>
    {!extra && <MuscleSets data={data} day={day}/>}
    <div className="sheet-cta"><Button primary onClick={add}>+ Add exercise</Button></div>
  </>;
}

function MuscleSets({ data, day }: any) {
  const exercises = byId(data.exercise), week = new Set(live(data.program_day).filter((row: Row) => row.program_id === day.program_id && (row.week ?? 1) === (day?.week ?? 1)).map((row: Row) => row.id));
  const counts = new Map<string, number>();
  for (const slot of live(data.slot).filter((row: Row) => week.has(row.program_day_id)))
    for (const muscle of exercises.get(slot.exercise_id)?.primary ?? []) counts.set(muscle, (counts.get(muscle) ?? 0) + slotSets(data, slot).length);
  const rows = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6), max = Math.max(1, ...rows.map(row => row[1]));
  if (!rows.length) return null;
  return <><h4 className="caption">Sets per muscle this week</h4><div className="muscle-bars">{rows.map(([muscle, sets]) => <div key={muscle}><span>{capital(muscle)}</span><span className="meter-bar" aria-hidden="true"><span style={{ width: `${sets / max * 100}%` }}/></span><strong>{sets}</strong></div>)}</div></>;
}

function SlotMenu({ data, local, slot, slots, busy, apply, fail, go, history }: any) {
  const index = slots.findIndex((row: Row) => row.id === slot.id), next = slots[index + 1];
  const table = slot.session_id ? 'session_slot' : 'slot';
  return <>
    <Button onClick={() => go('library')}>Swap exercise</Button>
    <Button onClick={() => go('setup')}>Change sets</Button>
    <Button onClick={history}>History</Button>
    <Button disabled={busy || index < 1} onClick={() => apply([{ slot, action: 'move' }])}>Move up</Button>
    <Button disabled={busy || !next} onClick={() => apply([{ slot: next, action: 'move' }])}>Move down</Button>
    <Button disabled={busy || (!next && !slot.group_id)} onClick={() => apply([{ slot, action: slot.group_id ? 'ungroup' : 'group' }])}>{slot.group_id ? 'Separate superset' : 'Superset with next exercise'}</Button>
    <Button disabled={busy} onClick={() => apply([{ slot, action: 'remove' }])}>Remove exercise</Button>
    <label>Program note<textarea defaultValue={slot.pinned_note ?? ''} onBlur={event => local.save([{ table, row: { id: slot.id, pinned_note: event.target.value } }]).then(() => local.sync()).catch(() => fail('The note did not save.'))}/></label>
  </>;
}

function rankedExercises(data: any, slots: Row[], favorites: Set<string>) {
  const exercises = byId(data.exercise), since = Date.now() - 56 * 86400000, freq = new Map<string, number>();
  for (const row of trainingRows(data).filter((row: Row) => row.started_at >= since)) freq.set(row.exercise_id, (freq.get(row.exercise_id) || 0) + row.sets.length);
  const inDay = new Set(slots.flatMap((slot: Row) => exercises.get(slot.exercise_id)?.primary ?? []));
  const score = (row: Row) => (freq.get(row.id) || 0) + (row.primary.some((muscle: string) => inDay.has(muscle)) ? 100000 : 0);
  return [...exercises.values()].filter((row: Row) => exerciseIdentity(exercises, row.id) === row.id)
    .sort((a: Row, b: Row) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)) || score(b) - score(a) || a.name.localeCompare(b.name));
}

function Library({ data, local, fail, slots, swap, picked, setPicked, done }: any) {
  const [query, setQuery] = useState(''), [group, setGroup] = useState('All'), [equipment, setEquipment] = useState('Any');
  const [favoritesOnly, setFavoritesOnly] = useState(false), [limit, setLimit] = useState(60), [starring, setStarring] = useState(false), savingStar = useRef(false);
  const favorites = useMemo(() => {
    const exercises = byId(data.exercise);
    return new Set<string>(live(data.setting).filter((row: Row) => row.id.startsWith('favorite:') && row.value === true).map((row: Row) => row.id.slice(9)).filter((id: string) => exercises.has(id) && exerciseIdentity(exercises, id) === id));
  }, [data]);
  const ranked = useMemo(() => rankedExercises(data, slots, favorites), [data, slots, favorites]);
  useEffect(() => { setLimit(60); }, [query, group, equipment, favoritesOnly]);
  useEffect(() => { if (!favorites.size) setFavoritesOnly(false); }, [favorites]);
  const muscles = GROUPS.find(([name]) => name === group)![1], words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = ranked.filter((row: Row) => (!favoritesOnly || favorites.has(row.id)) && (!muscles.length || row.primary.some((muscle: string) => muscles.includes(muscle))) && (equipment === 'Any' || row.equipment === equipment.toLowerCase())
    && words.every(word => row.name.toLowerCase().includes(word)));
  const toggle = (id: string) => swap ? done([id]) : setPicked(picked.includes(id) ? picked.filter((own: string) => own !== id) : [...picked, id]);
  async function favorite(id: string) {
    if (savingStar.current) return;
    savingStar.current = true; setStarring(true);
    try { await local.save([{ table: 'setting', row: { id: `favorite:${id}`, value: !favorites.has(id), deleted_at: null } }]); local.sync(); }
    catch { fail('The favorite did not save. Try again.'); }
    finally { savingStar.current = false; setStarring(false); }
  }
  return <>
    <label className="search"><span className="sr-only">Search exercises</span><input type="search" placeholder={`Search ${ranked.length.toLocaleString('en-US')} exercises`} value={query} onChange={event => setQuery(event.target.value)}/></label>
    <Chips label="Muscle" options={GROUPS.map(([name]) => name)} value={group} set={setGroup}/>
    <Chips label="Equipment" options={EQUIPMENT} value={equipment} set={setEquipment}/>
    {favorites.size > 0 && <div className="filter-chips"><button aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(!favoritesOnly)}>Favorites</button></div>}
    <h4 className="caption">{results.length.toLocaleString('en-US')} exercises</h4>
    <div className="card list">{results.slice(0, limit).map((row: Row) => <div className="exercise-choice" key={row.id}><button className="list-row" aria-pressed={swap ? undefined : picked.includes(row.id)} onClick={() => toggle(row.id)}>
      <span className="row-main"><strong>{row.name}{row.source === 'exercisedb' && <em className="tag-new"> New</em>}</strong><small>{row.primary.map(capital).join(', ') || 'Conditioning'} · {capital(row.equipment)}</small></span>
      <span className={`pick${picked.includes(row.id) ? ' on' : ''}`} aria-hidden="true">{picked.includes(row.id) ? '✓' : swap ? '›' : '+'}</span></button><button className="favorite" aria-label={`Favorite ${row.name}`} aria-pressed={favorites.has(row.id)} disabled={starring} onClick={() => favorite(row.id)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg></button></div>)}
      {!results.length && <p className="list-row muted">No match. Try fewer words or another filter.</p>}</div>
    {results.length > limit && <Button onClick={() => setLimit(limit + 60)}>Show more</Button>}
    {!swap && <div className="sheet-cta"><Button primary disabled={!picked.length} onClick={() => done(picked)}>{picked.length ? `Add ${picked.length} exercise${picked.length > 1 ? 's' : ''}` : 'Pick exercises'}</Button></div>}
  </>;
}

function Chips({ label, options, value, set }: any) {
  return <div className="filter-chips" role="radiogroup" aria-label={label}>{options.map((option: string) => <button key={option} role="radio" aria-checked={value === option} onClick={() => set(option)}>{option}</button>)}</div>;
}

function Setup({ data, slot, picked, busy, save }: any) {
  const [plan, setPlan] = useState(() => initialPlan(data, slot)), exercises = byId(data.exercise), only = picked.length === 1 ? exercises.get(picked[0]) : null;
  const set = (key: string) => (value: number) => setPlan(previous => ({ ...previous, [key]: value }));
  return <>
    {only && <p className="muted">{only.primary.concat(only.secondary).map(capital).join(', ')} · {capital(only.equipment)}</p>}
    {only?.instructions && <div className="card how"><h4 className="caption">How to</h4><ol>{only.instructions.split('\n').map((step: string, i: number) => <li key={i}>{step}</li>)}</ol></div>}
    {!slot && picked.length > 1 && <p className="muted">{picked.map((id: string) => exercises.get(id)?.name).join(', ')}</p>}
    <Stepper label="Sets" value={plan.count} set={set('count')} min={1} max={8}/>
    <label>Set type<select value={plan.type} onChange={event => setPlan(previous => ({ ...previous, type: event.target.value }))}>{[['working', 'Working'], ['warmup', 'Warm-up'], ['drop', 'Drop set'], ['rest_pause', 'Rest-pause'], ['failure', 'To failure'], ['timed', 'Timed interval']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {plan.type === 'timed' ? <Stepper label="Seconds" value={plan.seconds} set={set('seconds')} min={5} max={600} step={5}/> : <>
      <Stepper label="Minimum reps" value={plan.low} set={set('low')} min={1} max={plan.high}/>
      <Stepper label="Maximum reps" value={plan.high} set={set('high')} min={plan.low} max={99}/></>}
    <Stepper label="Rest seconds" value={plan.rest} set={set('rest')} min={0} max={600} step={15}/>
    <div className="sheet-cta"><Button primary disabled={busy} onClick={() => save(plan)}>{slot ? 'Save sets' : only ? `Add ${only.name}` : `Add ${picked.length} exercises`}</Button></div>
  </>;
}

function Stepper({ label, value, set, min, max, step = 1 }: any) {
  return <div className="config-stepper" role="group" aria-label={label}><span>{label}</span><button aria-label={`Decrease ${label.toLowerCase()}`} disabled={value <= min} onClick={() => set(Math.max(min, value - step))}>−</button><output>{value}</output><button aria-label={`Increase ${label.toLowerCase()}`} disabled={value >= max} onClick={() => set(Math.min(max, value + step))}>+</button></div>;
}
