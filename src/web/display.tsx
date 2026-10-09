import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Broadcast } from './renderer.tsx';
import { Lease } from './display-client.ts';
import type { PublicSnapshot } from '../contracts/types.ts';
import './display.css';
function Display() {
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null);
  useEffect(() => {
    const screenId = location.pathname.split('/').at(-1)!;
    const lease = new Lease(); let source: EventSource | null = null, stopped = false, refreshing = false; let current: PublicSnapshot | null = null;
    const hide = () => { lease.clear(); setSnapshot(null); };
    const accept = (value: PublicSnapshot) => {
      if (stopped || value.screenId !== screenId || value.publicRevision < lease.revision) return;
      const changed = lease.accept(value); current = value;
      if (changed || lease.deadline > performance.now()) setSnapshot(value);
    };
    const refresh = async () => {
      if (refreshing || stopped) return;
      refreshing = true;
      try { const response = await fetch(`/api/v1/display/${screenId}/snapshot`, { credentials: 'omit' }); if (response.ok) accept(await response.json()); }
      catch { /* Keep the last snapshot only within its lease. */ }
      finally { refreshing = false; }
    };
    // Previously issued fragment URLs remain usable; no credential is exchanged.
    const clearFragment = () => { if (location.hash) history.replaceState(null, '', location.pathname); };
    const start = async () => {
      clearFragment();
      await refresh(); if (stopped || !navigator.onLine) return;
      source?.close();
      source = new EventSource(`/api/v1/display/${screenId}/events`);
      source.addEventListener('snapshot', e => { try { accept(JSON.parse((e as MessageEvent).data)); } catch { hide(); } });
      source.addEventListener('heartbeat', e => {
        try { const data = JSON.parse((e as MessageEvent).data); if (lease.heartbeat(data.publicRevision, data.leaseMs) === 'refresh') void refresh(); else if (current && !lease.expired()) setSnapshot(current); } catch { hide(); }
      });
    };
    void start();
    const check = () => { if (lease.expired()) setSnapshot(null); };
    const visibility = () => { check(); if (!document.hidden) void refresh(); };
    const offline = () => { source?.close(); source = null; };
    const online = () => { if (!source) void start(); };
    const interval = setInterval(check, 250);
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pageshow', visibility); window.addEventListener('offline', offline); window.addEventListener('online', online); window.addEventListener('hashchange', clearFragment);
    return () => { stopped = true; source?.close(); clearInterval(interval); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pageshow', visibility); window.removeEventListener('offline', offline); window.removeEventListener('online', online); window.removeEventListener('hashchange', clearFragment); };
  }, []);
  return <Broadcast snapshot={snapshot} />;
}
createRoot(document.getElementById('root')!).render(<Display />);
