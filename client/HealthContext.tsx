import React, { useCallback, useEffect, useRef, useState } from 'react';
import { integrationEvent, integrationRecord } from '../domain/integration-record.js';
import { live } from '../domain/model.js';

export function HealthContext({ session, data, local, onAdvisoryChange }: any) {
  const [context, setContext] = useState<any>(null), [loading, setLoading] = useState(false), [receiptError, setReceiptError] = useState('');
  const events = useRef(data.event), request = useRef<any>(null), requestId = useRef(0), receipts = useRef(new Set<string>());
  events.current = data.event;
  const refresh = useCallback(async () => {
    request.current?.abort();
    onAdvisoryChange(null);
    const controller = new AbortController(), id = ++requestId.current;
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 7000);
    setLoading(true);
    setReceiptError('');
    try {
      const response = await fetch('/api/health-context', { signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.available) throw new Error(result.reason || 'Health guidance is unavailable.');
      const advisory = result.advisory;
      if (!advisory || Date.parse(advisory.validUntil) <= Date.now()) throw new Error('Health guidance expired. Refresh to request a current copy.');
      if (id !== requestId.current || controller.signal.aborted) return;
      setContext({ sessionId: session.id, advisory, expires: Date.parse(advisory.validUntil) });
    } catch (error: any) {
      if (id === requestId.current) setContext({ sessionId: session.id, error: controller.signal.aborted ? 'Health guidance timed out. Refresh to try again.' : error?.message || 'Health guidance is unavailable. Refresh to try again.' });
    } finally {
      clearTimeout(timeout);
      if (id === requestId.current) { request.current = null; setLoading(false); }
    }
  }, [local, onAdvisoryChange, session.id]);

  useEffect(() => {
    refresh();
    return () => { requestId.current++; request.current?.abort(); request.current = null; };
  }, [refresh]);
  useEffect(() => {
    const advisory = context?.sessionId === session.id ? context.advisory : null;
    onAdvisoryChange(advisory && Date.parse(advisory.validUntil) > Date.now() ? advisory : null);
  }, [context?.advisory, context?.sessionId, onAdvisoryChange, session.id]);
  useEffect(() => () => onAdvisoryChange(null), [onAdvisoryChange]);
  useEffect(() => {
    const advisory = context?.sessionId === session.id ? context.advisory : null;
    if (!advisory) return;
    const eventId = `integration:health_advisory:${session.id}:${advisory.advisoryId}`;
    if (receipts.current.has(eventId) || live(events.current).some((event: any) => event.id === eventId)) return;
    receipts.current.add(eventId);
    let active = true;
    const record = integrationEvent(session.id, 'health_advisory', { advisoryId: advisory.advisoryId, state: 'shown', policyVersion: advisory.policyVersion, displayedAt: new Date().toISOString() });
    local.save([record]).then(() => local.sync()).catch(() => {
      receipts.current.delete(eventId);
      if (active) setReceiptError('Guidance is shown, but its receipt did not save. Refresh to retry.');
    });
    return () => { active = false; };
  }, [context?.advisory, context?.sessionId, local, session.id]);
  useEffect(() => {
    if (context?.sessionId !== session.id || !context?.expires) return;
    const timer = setTimeout(() => setContext({ sessionId: session.id, error: 'Health guidance expired. Refresh to request a current copy.' }), Math.max(0, context.expires - Date.now()));
    return () => clearTimeout(timer);
  }, [context?.expires, context?.sessionId, onAdvisoryChange, session.id]);

  const advisory = context?.sessionId === session.id ? context.advisory : null;
  const error = context?.sessionId === session.id ? context.error : null;
  return <section className="health-context" aria-label="Health guidance">
    <h3>Health guidance</h3>
    {advisory ? <><p>{advisory.headline}</p><p>{advisory.ruleWords}</p>{Array.isArray(advisory.missing) && advisory.missing.length > 0 && <p className="muted">Missing: {advisory.missing.join(', ')}</p>}{Object.values(advisory.freshness.stale).some(Boolean) && <p className="muted">Some Health readings are stale.</p>}{advisory.sets && <p className="muted">Guidance range: {Number((advisory.sets.low * 100).toFixed(1))}–{Number((advisory.sets.high * 100).toFixed(1))}% of planned sets. This does not change your workout.</p>}{receiptError && <p role="status">{receiptError}</p>}</>
      : <p role="status">{error || 'Checking for current guidance…'}</p>}
    <button type="button" className="control" disabled={loading} onClick={refresh}>{loading ? 'Refreshing…' : 'Refresh guidance'}</button>
  </section>;
}
