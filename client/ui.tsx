import React, { useEffect, useRef, useSyncExternalStore } from 'react';

export type Row = Record<string, any>;
export const numberText = (value: number | null) => value == null ? '' : String(Number(value.toFixed(2)));
export const rangeText = (low: number | null, high: number | null) => low == null ? 'To failure' : low === high ? `${low}` : `${low} to ${high}`;
const localDateFormatter = new Intl.DateTimeFormat('en-US', { weekday:'short', day:'numeric', month:'short', timeZone:'America/Chicago' });
const utcDateFormatter = new Intl.DateTimeFormat('en-US', { weekday:'short', day:'numeric', month:'short', timeZone:'UTC' });
export function dateText(value: string | number | null) {
  if (value == null) return '';
  const date = new Date(typeof value === 'number' ? value : `${value}T12:00:00Z`);
  const parts = (typeof value === 'number' ? localDateFormatter : utcDateFormatter).formatToParts(date);
  const part = (type:string) => parts.find(value=>value.type===type)?.value;
  return `${part('weekday')} ${part('day')} ${part('month')}`;
}

export function Sheet({ title, children, close }: { title: string; children: React.ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { setUndo({ sheets: undo.sheets + 1 }); return () => setUndo({ sheets: undo.sheets - 1 }); }, []);
  useEffect(() => { const node = ref.current; node?.showModal(); node?.querySelector<HTMLElement>('h2')?.focus({preventScroll:true}); return () => { if (node?.open) node.close(); }; }, []);
  return <dialog ref={ref} onCancel={close} onClick={event=>{if(event.target===ref.current){const rect=ref.current!.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();}}} aria-label={title} className="sheet"><header><h2 tabIndex={-1}>{title}</h2><button onClick={close}>Close</button></header><div className="undo-slot"><UndoBar inSheet/></div>{children}</dialog>;
}

export function Button({ children, onClick, primary = false, disabled = false, ...props }: any) {
  return <button className={primary ? 'primary' : 'control'} onClick={onClick} disabled={disabled} {...props}>{children}</button>;
}

export function Download({ data, name, children }: { data: any; name: string; children: React.ReactNode }) {
  return <Button onClick={() => {
    const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: name.endsWith('.csv') ? 'text/csv' : 'application/json' });
    const href = URL.createObjectURL(blob), link = document.createElement('a'); link.href = href; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }}>{children}</Button>;
}

// Save, then offer Undo for 10 seconds. Undo writes back the old values; db.js refuses it if anything changed since.
type Offer = { text: string; rows: any[]; guard: any; local: any; afterUndo?: () => Promise<void> };
let undo: { offer: Offer | null; sheets: number } = { offer: null, sheets: 0 }, timer: any, handlers: any = {};
const listeners = new Set<() => void>();
const setUndo = (next: Partial<typeof undo>) => { undo = { ...undo, ...next }; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const undoPending = () => undo.offer != null;
export const setUndoHandlers = (next: { refresh: () => any; fail: (text: string) => void }) => { handlers = next; };

export async function saveUndoable(local: any, changes: any[], text: string, expected = {}, afterUndo?: () => Promise<void>) {
  const { undo: rows, guard } = await local.save(changes, null, expected);
  clearTimeout(timer); setUndo({ offer: { text, rows, guard, local, afterUndo } }); timer = setTimeout(() => setUndo({ offer: null }), 10000);
}

async function runUndo() {
  const offer = undo.offer!; clearTimeout(timer); setUndo({ offer: null });
  try { await offer.local.save(offer.rows, offer.guard); await offer.afterUndo?.(); await handlers.refresh?.(); offer.local.sync(); }
  catch (error: any) { handlers.fail?.(error?.stale ? error.message : 'Undo did not save.'); }
}

// The page shows the bar when no sheet is open; an open sheet shows it under its header, because a modal sheet covers the page.
export function UndoBar({ inSheet = false }: { inSheet?: boolean }) {
  const { offer, sheets } = useSyncExternalStore(subscribe, () => undo);
  if (!offer || (!inSheet && sheets > 0)) return null;
  return <div className="undo-bar" role="status"><span>{offer.text}</span><button onClick={runUndo}>Undo</button></div>;
}
