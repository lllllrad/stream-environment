import type { Control, Output, PublicContent, PublicSnapshot, Session } from '../contracts/types.ts';
import { canonical } from '../contracts/validation.ts';

export function project(session: Session | undefined, output: Output, control: Control, leaseMs: number, now: string): PublicSnapshot {
  let content: PublicContent | null = null;
  const count = (value: string | null | undefined) => [...(value ?? '')].length;
  const recent = session?.events.filter(e => !e.retractedAt).sort((a,b) => b.occurredAt.localeCompare(a.occurredAt) || b.receivedAt.localeCompare(a.receivedAt)).slice(0,3) ?? [];
  const visibleWork = session?.workItems.filter(w => !w.retractedAt).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).find(w => !session.selectedWorkId || w.id === session.selectedWorkId);
  const auxiliary = session?.pin && (!session.pin.expiresAt || session.pin.expiresAt > now) && !session.selectedWorkId ? [session.pin.text] : [visibleWork?.title,visibleWork?.publicResult];
  const shownText = session ? [session.title,session.now?.title,session.now?.detail,session.now?.next,...session.recap.slice(0,output.preset==='side'?2:3),...recent.slice(0,output.preset==='side'?1:3).map(e=>e.text),...auxiliary,...(output.preset==='full'?[session.goal]:[])] : [];
  const compact = session ? [session.title, session.goal, session.now?.title ?? '', session.now?.detail ?? ''].some((v,i) => count(v) > [45,75,30,80][i]!) || session.recap.some(v => count(v) > 70) || recent.some(e => count(e.text) > 70) || auxiliary.some(v=>count(v)>70) || shownText.reduce((sum,v)=>sum+count(v),0)>(output.preset==='side'?230:500) : false;
  if (session && control.mode !== 'hidden') {
    const preset = output.preset;
    content = { title: session.title, status: session.status, now: session.status === 'ended' ? null : session.now ? structuredClone(session.now) : null };
    if (preset === 'lower') {
      if (content.now) content.now = { title: content.now.title, status: content.now.status } as PublicContent['now'];
    } else {
      if (preset === 'side' && compact && content.now) content.now.next = null;
      if (preset === 'full') content.goal = session.goal;
      content.recap = session.recap.slice(0, preset === 'full' ? 3 : 2);
      content.events = session.events.filter(e => !e.retractedAt).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.receivedAt.localeCompare(a.receivedAt)).slice(0, preset === 'full' ? compact ? 1 : 3 : compact ? 0 : 1).map(e => ({ id: e.id, kind: e.kind, text: e.text, occurredAt: e.occurredAt, certainty: e.certainty }));
      const pin = session.pin && (!session.pin.expiresAt || session.pin.expiresAt > now) ? { ...session.pin } : null;
      const works = session.workItems.filter(w => !w.retractedAt);
      const work = session.selectedWorkId ? works.find(w => w.id === session.selectedWorkId) : works.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (pin && !session.selectedWorkId) content.pin = pin;
      if (work && (!pin || session.selectedWorkId)) content.workItem = { id: work.id, title: work.title, status: work.status, publicResult: work.publicResult };
    }
  }
  return { screenId: output.screenId, preset: output.preset, publicRevision: output.snapshot.publicRevision, sessionId: control.mode === 'hidden' ? null : session?.id ?? null, mode: control.mode, leaseMs, publishedAt: now, content, compact: content ? compact : false };
}

export function filterHeld(snapshot: PublicSnapshot, session: Session | undefined, now: string): PublicSnapshot {
  const next = structuredClone(snapshot);
  if(next.overlay){
    const eventIds=new Set(session?.events.filter(e=>e.retractedAt).map(e=>e.id)),workIds=new Set(session?.workItems.filter(w=>w.retractedAt).map(w=>w.id));
    for(const widget of next.overlay.widgets)widget.blocks=widget.blocks.filter(b=>{
      if(b.path.startsWith('/widget/'))return true;
      if(!session||next.sessionId!==session.id)return false;
      if(b.expiresAt&&b.expiresAt<=now)return false;
      if(b.path.startsWith('/pin')&&!session.pin)return false;
      if(b.path.startsWith('/now')&&session.status==='ended')return false;
      if(b.path.startsWith('/events/')&&eventIds.has(b.path.split('/')[2]))return false;
      if(b.path.startsWith('/workItems/')&&workIds.has(b.path.split('/')[2]))return false;
      return true;
    });
  }
  if (!session || next.sessionId !== session.id) return { ...next, content: null, sessionId: null };
  if (next.content) {
    const retracted = new Set(session.events.filter(e => e.retractedAt).map(e => e.id));
    if (next.content.events) next.content.events = next.content.events.filter(e => !retracted.has(e.id));
    if (next.content.workItem && session.workItems.find(w => w.id === next.content!.workItem!.id)?.retractedAt) delete next.content.workItem;
    if (next.content.pin?.expiresAt && next.content.pin.expiresAt <= now) delete next.content.pin;
    if (!session.pin) delete next.content.pin;
    if (session.status === 'ended') { next.content.now = null; next.content.status = 'ended'; }
  }
  return next;
}

export function samePublic(a: PublicSnapshot, b: PublicSnapshot): boolean {
  const stable = (v: PublicSnapshot) => ({ ...v, publicRevision: 0, publishedAt: '' });
  return canonical(stable(a)) === canonical(stable(b));
}
