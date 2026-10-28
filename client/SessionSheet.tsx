import React, { useRef, useState } from 'react';
import { live, byId } from '../domain/model.js';
import { deleteSessionChanges, finishChanges } from '../domain/session.js';
import { exportData } from '../domain/export.js';
import { Button, Download, Row, Sheet, dateText, dateTimeText, numberText, saveUndoable } from './ui';
import './workout-results.css';

export function SessionSheet({ data, local, status, session, close, fail, refresh, pause, deleted }: any) {
  const [busy, setBusy] = useState(false), [closeReason, setCloseReason] = useState(''), saving = useRef(false);
  const bodyweight = live(data.setting).find((row: Row) => row.id === 'bodyweight')?.value;
  const slots = new Set(live(data.session_slot).filter((row: Row) => row.session_id === session?.id).map((row: Row) => row.id));
  const logged = live(data.set).filter((row: Row) => slots.has(row.session_slot_id) && row.done_at != null).length;
  const check = status.check;
  const checkedDates = (check?.local ?? []).map((day: Row) => day.date).sort();
  const syncError = status.error && <p role="status">{status.error}</p>;
  const run = (fn: () => Promise<any>) => fn().then(() => { refresh(); local.sync(); }).catch(() => fail('The change did not save.'));
  async function finish() {
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try {
      await saveUndoable(local, finishChanges(data, session, Date.now(), true, closeReason || null, null), 'Finished early · logged sets kept');
      await refresh(); local.sync(); close();
    } catch { fail('The workout did not finish. Try again.'); }
    finally { saving.current = false; setBusy(false); }
  }
  return <Sheet title="Session" close={close}><section className="proof"><h3>Saved on this device</h3><p>{status.waiting} changes waiting to sync</p><p>{status.waiting ? 'The check waits until changes sync.' : check?.ok === true ? 'Sets in this date range matched the server at the last check.' : check?.ok === false ? 'The set counts or contents differed at the last check.' : 'The first check needs a server connection.'}</p>{check && <><p className="muted">Last check: {dateTimeText(check.checkedAt)}</p><p className="muted">Set dates: {dateText(checkedDates[0])} to {dateText(checkedDates.at(-1))}. Older sets and workout details are not checked.</p></>}<Button onClick={() => local.check().then(refresh).catch(() => { fail('The server is unavailable. Your sets stay on this device.'); local.sync(); })}>Check now</Button><p className="muted">Sets save in this browser first, then copy to the training server that hosts this app. Export keeps your own copy.</p></section>
    {session && <><label className="checkbox"><input type="checkbox" role="switch" checked={!!session.off} onChange={event => run(() => local.save([{ table: 'session', row: { id: session.id, off: event.target.checked } }]))}/>Off session: keep records, pause progression</label><label>Workout note<textarea defaultValue={session.note ?? ''} onBlur={event => run(() => local.save([{ table: 'session', row: { id: session.id, note: event.target.value } }]))}/></label>
      {session.status === 'open' && <section><h3>If something comes up</h3><label>Why are you stopping?<select value={closeReason} onChange={event => setCloseReason(event.target.value)}><option value="">Choose if useful</option><option value="time">Time</option><option value="interruption">Interruption</option><option value="recovery">Recovery</option><option value="difficulty">Difficulty</option><option value="manual">Manual choice</option></select></label><Button disabled={busy} onClick={() => finish()}>Finish early · keep {logged} logged {logged === 1 ? 'set' : 'sets'}</Button><Button disabled={busy} onClick={() => { close(); pause?.(); }}>Pause, resume from Home</Button></section>}
      <DeleteWorkout {...{ data, session, local, close, fail, refresh, deleted }}/>
    </>}
    <label>Bodyweight in kg <span className="muted">Optional</span><input type="number" min="1" max="500" step="0.1" inputMode="decimal" defaultValue={bodyweight ? bodyweight / 1000 : ''} onBlur={event => { const value = Number(event.target.value); if (value > 0 && value <= 500) run(() => local.save([{ table: 'setting', row: { id: 'bodyweight', value: Math.round(value * 1000) } }])); }}/></label><label className="checkbox"><input type="checkbox" role="switch" checked={!live(data.setting).find((row: Row) => row.id === 'unusual_numbers_disabled')?.value} onChange={event => run(() => local.save([{ table: 'setting', row: { id: 'unusual_numbers_disabled', value: !event.target.checked } }]))}/>Check unusually high weights</label>
    {syncError}<Button onClick={() => run(() => local.resend())}>Send everything again</Button><p className="muted">Use this after a server restore. It copies every row on this device to the server again.</p>{live(data.session).some((row: Row) => row.source === 'stoppani') &&<p className="muted">Imported units and exercise labels remain provisional. The original entries stay available for review.</p>}<Download data={exportData(data)} name="workout-export.json">Export every table</Download><Download data={setCsv(data)} name="workout-sets.csv">Export sets as CSV</Download>
  </Sheet>;
}

function setCsv(data: any) {
  const slots = byId(data.session_slot);
  const cell = (value: any) => { const text = String(value ?? ''); return `"${(/^[=+\-@]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`; };
  return [['date','exercise','weight','unit','reps','seconds','reps_left','type','note'].join(','), ...live(data.set).filter((set: Row) => set.done_at != null).map((set: Row) => [set.local_date, slots.get(set.session_slot_id)?.name, set.weight, set.unit, set.reps, set.seconds, set.reps_left, set.type, set.note].map(cell).join(','))].join('\r\n');
}

export function HistorySession({ data, id, local, close, refresh, fail }: any) {
  const session = byId(data.session).get(id), slots = live(data.session_slot).filter((slot: Row) => slot.session_id === id).sort((a: Row,b: Row) => a.position-b.position);
  const save = (set: Row, field: string, raw: string) => {
    const value = field === 'unit' || field === 'note' ? raw : raw === '' ? null : Number(raw);
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0 || (field === 'reps' && !Number.isInteger(value)) || (field === 'reps_left' && value > 4))) { fail('Use a valid non-negative number.'); return; }
    if(value === (set[field] ?? null))return;
    const patch: Row = { id: set.id, [field]: value };
    if (field === 'weight' || field === 'unit') patch.grams = (field === 'weight' && value == null) ? null : Math.round((field === 'weight' ? Number(value) : set.weight) * ((field === 'unit' ? value : set.unit) === 'lb' ? 0.45359237 : 1) * 1000);
    if (field === 'reps_left') patch.effort_source = value == null ? 'assumed' : 'logged';
    local.save([{ table: 'set', row: patch }]).then(() => { refresh(); local.sync(); }).catch(() => fail('The set edit did not save.'));
  };
  return <Sheet title={session?.local_date ? dateText(session.local_date) : 'Session sets'} close={close}><p>Edits save on this device first. Earlier values remain in the edit log after sync.</p>{slots.map((slot: Row) => <section className="history-exercise" key={slot.id}><h3>{slot.name}</h3>{live(data.set).filter((set: Row) => set.session_slot_id === slot.id && set.done_at != null).sort((a: Row,b: Row) => a.position-b.position).map((set: Row) => <details key={set.id}><summary>Set {set.position + 1} · {numberText(set.weight)} {set.unit} × {set.reps}</summary><div className="edit-fields"><label>Weight<input type="number" min="0" step="0.01" defaultValue={set.weight ?? ''} onBlur={event => save(set, 'weight', event.target.value)}/></label><label>Unit<select value={set.unit} onChange={event => save(set, 'unit', event.target.value)}><option>kg</option><option>lb</option></select></label><label>Reps<input type="number" min="0" step="1" defaultValue={set.reps ?? ''} onBlur={event => save(set, 'reps', event.target.value)}/></label><label>Reps left<input type="number" min="0" max="4" defaultValue={set.reps_left ?? ''} onBlur={event => save(set, 'reps_left', event.target.value)}/></label></div><label>Set note<textarea defaultValue={set.note ?? ''} onBlur={event => save(set, 'note', event.target.value)}/></label></details>)}</section>)}{session && <DeleteWorkout {...{ data, session, local, close, refresh, fail }}/>}</Sheet>;
}

function DeleteWorkout({ data, session, local, close, fail, refresh, deleted }: any) {
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), saving = useRef(false);
  const slots = new Set(live(data.session_slot).filter((row: Row) => row.session_id === session.id).map((row: Row) => row.id));
  const logged = live(data.set).filter((row: Row) => slots.has(row.session_slot_id) && row.done_at != null).length;
  async function remove() {
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try {
      await saveUndoable(local, deleteSessionChanges(data, session), 'Workout deleted');
      await refresh(); local.sync(); close(); deleted?.();
    } catch { fail('The workout did not delete. Try again.'); }
    finally { saving.current = false; setBusy(false); }
  }
  return <section className="delete-workout">{confirm ? <div className="delete-confirm"><h3>Delete this workout?</h3><p>This removes {logged} logged {logged === 1 ? 'set' : 'sets'} from your history.</p><Button disabled={busy} onClick={remove}>Delete workout</Button><Button disabled={busy} onClick={() => setConfirm(false)}>Keep workout</Button></div> : <Button disabled={busy} onClick={() => setConfirm(true)}>Delete this workout</Button>}</section>;
}
