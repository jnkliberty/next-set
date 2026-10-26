import { useEffect, useState } from 'react';
import { Row } from './ui';

export function useRest(local: any, sessionId: string, rest: Row | null, fail: (message: string) => void) {
  const [saved, setSaved] = useState<Row | null>(null), [ready, setReady] = useState(false), [now, setNow] = useState(Date.now());
  useEffect(() => {
    let mounted = true;
    setReady(false); setSaved(null);
    local.db.get('meta', ['rest', sessionId]).then((value: any) => {
      if (mounted) { setSaved(value?.id && Number.isFinite(value.end) ? value : null); setReady(true); }
    }).catch(() => { if (mounted) { setReady(true); fail('The saved rest timer could not open.'); } });
    return () => { mounted = false; };
  }, [local, sessionId]);
  const end = saved?.id === rest?.id ? saved?.end : rest?.end;
  const seconds = ready && end ? Math.max(0, Math.ceil((end - now) / 1000)) : 0;
  useEffect(() => {
    setNow(Date.now());
    if (!end || end <= Date.now()) return;
    const interval = setInterval(() => { setNow(Date.now()); if (Date.now() >= end) clearInterval(interval); }, 500);
    const update = () => setNow(Date.now()); document.addEventListener('visibilitychange', update);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', update); };
  }, [end]);
  const adjust = (end: number) => {
    const value = { id: rest.id, end }; setSaved(value); setNow(Date.now());
    local.drafts.write(['rest', sessionId], value).catch(() => fail('The rest change did not save. Keep this screen open and try again.'));
  };
  return { seconds, active: !!rest && ready && seconds > 0, skipped: saved?.id === rest?.id && saved?.end === 0, extend: () => adjust(end + 15000), skip: () => adjust(0) };
}
