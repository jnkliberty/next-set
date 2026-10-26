import { useEffect, useRef, useState } from 'react';
import { draftBase } from './drafts.js';
import { Row } from './ui';

function validDraft(value: any) {
  return value && ['kg', 'lb'].includes(value.unit) && typeof value.base === 'string' && value.values &&
    Object.entries(value.values).every(([key, text]) => ['weight', 'reps', 'seconds'].includes(key) && typeof text === 'string');
}

export function useDrafts(local: any, sessionId: string, fail: (message: string) => void, sets: Row[]) {
  const [records, setRecords] = useState<Record<string, Row>>({}), current = useRef<Record<string, Row>>({});
  const [ready, setReady] = useState(false);
  const error = () => fail('These edits did not save on this device. Keep this screen open and try again.');
  useEffect(() => {
    let mounted = true;
    setReady(false); current.current = {}; setRecords({});
    local.drafts.load(sessionId).then((saved: Record<string, any>) => {
      if (!mounted) return;
      const accepted = Object.fromEntries(Object.entries(saved).filter(([id, value]) => id.startsWith('unit:') ? ['kg', 'lb'].includes(value?.unit) : validDraft(value)));
      current.current = accepted; setRecords(accepted); setReady(true);
    }).catch(error);
    return () => { mounted = false; };
  }, [local, sessionId]);
  useEffect(() => {
    if (!ready) return;
    const pending = new Set(sets.filter(set => set.done_at == null && set.deleted_at == null).map(set => set.id));
    const next = Object.fromEntries(Object.entries(current.current).filter(([id]) => id.startsWith('unit:') || pending.has(id)));
    if (Object.keys(next).length !== Object.keys(current.current).length) { current.current = next; setRecords(next); }
  }, [sets, ready]);

  function write(id: string, value: Row | null) {
    const next = { ...current.current };
    if (value == null) delete next[id]; else next[id] = value;
    current.current = next; setRecords(next);
    return local.drafts.write(['draft', sessionId, id], value);
  }
  function update(set: Row, values: Row, unit: string, rebase = false) {
    const prior = current.current[set.id];
    return write(set.id, { base: rebase ? draftBase(set) : prior?.base ?? draftBase(set), values, unit });
  }
  function edit(set: Row, field: string, value: string, unit: string) {
    update(set, { ...current.current[set.id]?.values, [field]: value }, unit).catch(error);
  }
  const unit = (slot: Row) => records[`unit:${slot.id}`]?.unit;
  const conflict = (set: Row) => set.done_at == null && records[set.id] && records[set.id].base !== draftBase(set);
  const resolve = (set: Row, keep: boolean) => (keep ? update(set, records[set.id].values, records[set.id].unit, true) : write(set.id, null)).catch(error);
  function switchUnit(slot: Row, sets: Row[], to: string, convert: (weight: string, from: string) => string) {
    const next = { ...current.current }, updates: any[] = [[['draft', sessionId, `unit:${slot.id}`], { unit: to }]];
    next[`unit:${slot.id}`] = { unit: to };
    for (const set of sets.filter(set => set.done_at == null && next[set.id])) {
      const record = next[set.id], values = { ...record.values };
      if (values.weight) values.weight = convert(values.weight, record.unit);
      next[set.id] = { ...record, values, unit: to }; updates.push([['draft', sessionId, set.id], next[set.id]]);
    }
    current.current = next; setRecords(next); local.drafts.writeMany(updates).catch(error);
  }
  return { records, ready, edit, update, unit, conflict, resolve, error,
    switchUnit,
    forget: (set: Row) => { const next = { ...current.current }; delete next[set.id]; current.current = next; setRecords(next); },
  };
}
