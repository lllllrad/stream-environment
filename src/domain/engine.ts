import { randomBytes, randomUUID } from 'node:crypto';
import { Store } from '../server/store.ts';
import { ensure } from '../contracts/errors.ts';
import { canonical, hash, LIMITS, OPERATIONS, parseChange, pathAllowed, pathsFor, text, tokenHash, validPath } from '../contracts/validation.ts';
import type { Actor, Audit, ChangeSet, Control, Operation, Output, Proposal, ProposalPreview, PublicSnapshot, Receipt, Session } from '../contracts/types.ts';
import { filterHeld, project, samePublic } from './projection.ts';
import type { OverlayConfig, RenderPreview } from '../contracts/overlay.ts';
import { defaultOverlayConfig, defaultLayout, overlayPair, validatedWidgets, projectOverlay } from './overlays.ts';
import { attachInspection } from './inspection.ts';

export const operator: Actor = { id: 'operator', role: 'operator' };
const stamp = () => new Date().toISOString();
const secret = () => randomBytes(32).toString('base64url');
export class Engine {
  store: Store; leaseMs: number; onPublish: (ids: string[]) => void = () => {};
  constructor(store: Store, leaseMs = 30000) {
    this.store = store; this.leaseMs = leaseMs;
    this.store.transaction(() => {
      if (!this.store.get('control')) this.store.put('control', { activeSessionId: null, controlRevision: 0, mode: 'auto', aiWritesEnabled: true, timezone: 'Asia/Seoul' });
      for (const preset of ['full', 'side', 'lower'] as const) {
        const id = `main-${preset}`;
        const existing = this.store.get<Output>(`output:${id}`);
        // Drop obsolete output credentials while preserving every published snapshot.
        this.store.put(`output:${id}`, { screenId: id, preset, snapshot: existing?.snapshot ?? { screenId: id, preset, publicRevision: 0, sessionId: null, mode: 'auto', leaseMs, publishedAt: stamp(), content: null } });
      }
      for (const auth of this.store.list<{ role: string; tokenHash: string }>('auth:')) if (auth.role === 'display') this.store.delete(`auth:${auth.tokenHash}`);
      if (!this.store.get('overlays')) this.store.put('overlays',defaultOverlayConfig());
      for (const overlay of this.overlayConfig().overlays) if (!this.store.get(`output:${overlay.id}`)) {
        const control=this.control(),output:Output={screenId:overlay.id,preset:'full',overlayId:overlay.id,snapshot:{screenId:overlay.id,preset:'full',publicRevision:0,sessionId:null,mode:control.mode,leaseMs,publishedAt:stamp(),content:null}};
        output.snapshot=this.projected(control.mode==='auto'&&control.activeSessionId?this.session(control.activeSessionId):undefined,output,control);
        if(control.mode==='hold')for(const widget of output.snapshot.overlay!.widgets)widget.blocks=[];
        this.store.put(`output:${overlay.id}`,output);
      }
    });
  }
  control(): Control { return this.store.get<Control>('control')!; }
  overlayConfig():OverlayConfig { return this.store.get<OverlayConfig>('overlays')!; }
  private projected(session:Session|undefined,output:Output,control:Control,config=this.overlayConfig(),sceneId=config.activeSceneId,actor?:Actor):PublicSnapshot {
    if (!output.overlayId) return project(session,output,control,this.leaseMs,stamp());
    const overlay=projectOverlay(config,output.overlayId,control.mode==='hidden'?undefined:session,stamp(),sceneId,actor);
    if(control.mode==='hidden') for(const widget of overlay.widgets) widget.blocks=[];
    return {screenId:output.screenId,preset:'full',publicRevision:output.snapshot.publicRevision,sessionId:control.mode==='hidden'?null:session?.id??null,mode:control.mode,leaseMs:this.leaseMs,publishedAt:stamp(),content:null,overlay};
  }
  updateOverlays(input:{expectedRevision:number;action:string;overlayId?:string;sceneId?:string;sourceSceneId?:string;name?:string;width?:number;height?:number;widgets?:unknown}):OverlayConfig {
    return this.commit(()=>{
      const config=this.overlayConfig();
      ensure(config.revision===input.expectedRevision,'OVERLAY_REVISION_CONFLICT','Overlay configuration changed. Reload before saving.',409);
      if(input.action==='create_overlay'){
        ensure(Number.isInteger(input.width)&&Number.isInteger(input.height)&&input.width!>=640&&input.width!<=3840&&input.height!>=360&&input.height!<=2160,'INVALID_OVERLAY','Overlay size must be 640–3840 by 360–2160 pixels.');
        ensure(config.overlays.length<8&&!config.overlays.some(o=>o.width===input.width&&o.height===input.height),'OVERLAY_EXISTS','An overlay already exists at this resolution, or the eight-overlay limit is reached.');
        const overlay={id:`overlay-${input.width}x${input.height}`,name:text(input.name,60),width:input.width!,height:input.height!};
        config.overlays.push(overlay);config.layouts.push(...config.scenes.map(scene=>defaultLayout(overlay,scene)));
        this.store.put(`output:${overlay.id}`,{screenId:overlay.id,preset:'full',overlayId:overlay.id,snapshot:{screenId:overlay.id,preset:'full',publicRevision:0,sessionId:null,mode:'hidden',leaseMs:this.leaseMs,publishedAt:stamp(),content:null}});
      }else if(input.action==='create_scene'){
        const name=text(input.name,60);ensure(config.scenes.length<16&&!config.scenes.some(s=>s.name===name),'SCENE_EXISTS','Scene name exists, or the sixteen-scene limit is reached.');
        const source=input.sourceSceneId??config.activeSceneId;ensure(config.scenes.some(s=>s.id===source),'NOT_FOUND','Source scene not found.',404);
        const scene={id:`scene_${randomUUID()}`,name};config.scenes.push(scene);
        config.layouts.push(...config.overlays.map(overlay=>({...structuredClone(overlayPair(config,overlay.id,source).layout),sceneId:scene.id,revision:0})));
      }else if(input.action==='activate_scene'){
        ensure(config.scenes.some(s=>s.id===input.sceneId),'NOT_FOUND','Scene not found.',404);
        if(config.activeSceneId===input.sceneId)return config;
        config.activeSceneId=input.sceneId!;
      }else if(input.action==='save_layout'){
        const {overlay,layout}=overlayPair(config,input.overlayId!,input.sceneId!);
        const widgets=validatedWidgets(overlay,input.widgets);
        if(canonical(widgets)===canonical(layout.widgets))return config;
        layout.widgets=widgets;layout.revision++;
      }else ensure(false,'SCHEMA_VALIDATION','Unknown overlay action.');
      config.revision++;this.store.put('overlays',config);this.log(operator,null,null,`Overlay configuration: ${input.action}`,['/overlays'],null);return config;
    });
  }
  layoutPreview(overlayId:string,sceneId:string,widgets?:unknown):PublicSnapshot {
    const config=this.overlayConfig(),{overlay,layout}=overlayPair(config,overlayId,sceneId);
    if(widgets!==undefined)layout.widgets=validatedWidgets(overlay,widgets);
    const c=this.control();return this.projected(c.activeSessionId?this.session(c.activeSessionId):undefined,this.output(overlayId),{...c,mode:'auto'},config,sceneId);
  }
  renderPreview(actor:Actor,id:string,input:{overlayId:string;sceneId?:string;change?:unknown}):RenderPreview {
    if(actor.role==='producer')actor=this.actor(actor.id);
    let session=this.readSession(actor,id);const revision=session.revision;let changedPaths:string[]=[];
    if(input.change!==undefined){
      const prepared=this.prepare(actor,id,input.change);
      ensure(!prepared.receipt,'PREVIEW_REPLAY','This request already has a receipt. Use a new candidate ID to preview.',409);
      const candidate=this.candidate(actor,prepared.change);session=candidate.after;changedPaths=candidate.paths;
    }
    const config=this.overlayConfig(),output=this.output(input.overlayId);ensure(output.overlayId,'INVALID_OVERLAY','Rendering inspection requires a full-canvas overlay.');
    const sceneId=input.sceneId??config.activeSceneId,hypothetical={...this.control(),mode:'auto' as const};
    return attachInspection({snapshot:this.projected(session,output,hypothetical,config,sceneId,actor),sessionRevision:revision,configRevision:config.revision,changedPaths,hypothetical:true},this.projected(session,output,hypothetical,config,sceneId).overlay!);
  }
  session(id: string): Session { const s = this.store.get<Session>(`session:${id}`); ensure(s, 'NOT_FOUND', 'Session not found.', 404); return s; }
  output(id: string): Output { const o = this.store.get<Output>(`output:${id}`); ensure(o, 'NOT_FOUND', 'Output not found.', 404); return o; }
  actor(id: string): Actor { const a = this.store.get<Actor>(`producer:${id}`); ensure(a && !a.revoked, 'UNAUTHORIZED', 'Producer credential is revoked.', 401); return a; }
  readSession(actor: Actor, id: string): Session {
    if (actor.role === 'producer') { actor = this.actor(actor.id); ensure(actor.allowedSessions?.includes('*') || actor.allowedSessions?.includes(id), 'FORBIDDEN', 'Producer cannot access this session.', 403); }
    return this.session(id);
  }
  private publish(): string[] {
    const control = this.control(); const session = control.activeSessionId ? this.session(control.activeSessionId) : undefined; const changed: string[] = [];
    for (const output of this.store.list<Output>('output:')) {
      let next = this.projected(session, output, control);
      if (control.mode === 'hold') next = { ...filterHeld(output.snapshot, session, stamp()), mode: 'hold', leaseMs: this.leaseMs };
      if (!samePublic(next, output.snapshot)) {
        next.publicRevision = output.snapshot.publicRevision + 1; next.publishedAt = stamp();
        output.snapshot = next; this.store.put(`output:${output.screenId}`, output); changed.push(output.screenId);
      }
    }
    return changed;
  }
  private commit<T>(fn: () => T): T {
    let ids: string[] = [];
    const result = this.store.transaction(() => { const r = fn(); ids = this.publish(); return r; });
    if (ids.length) this.onPublish(ids);
    return result;
  }
  tick(): void {
    // No transaction when there is no expiring published notice.
    const now = stamp();
    if (this.store.list<Output>('output:').some(o => (o.snapshot.content?.pin?.expiresAt && o.snapshot.content.pin.expiresAt <= now)||o.snapshot.overlay?.widgets.some(w=>w.blocks.some(b=>b.expiresAt&&b.expiresAt<=now)))) this.commit(() => {});
  }
  preview(id: string): { published: PublicSnapshot; next: PublicSnapshot } {
    const output = this.output(id), c = this.control();
    return { published: output.snapshot, next: this.projected(c.activeSessionId ? this.session(c.activeSessionId) : undefined, output, { ...c, mode: 'auto' }) };
  }
  createSession(input: { title: unknown; goal: unknown; expectedControlRevision: number }): Session {
    return this.commit(() => {
      const c = this.control(); this.checkControl(c, input.expectedControlRevision);
      const s: Session = { id: `session_${randomUUID()}`, title: text(input.title, LIMITS.sessionTitle), goal: text(input.goal, LIMITS.goal), recap: [], status: 'prepared', revision: 0, createdAt: stamp(), startedAt: null, endedAt: null, now: null, nowObservedAt: null, pin: null, events: [], workItems: [], locks: [], selectedWorkId: null };
      this.store.put(`session:${s.id}`, s); this.log(operator, null, s, 'Session created', [], null);
      return s;
    });
  }
  lifecycle(id: string, input: { action: string; expectedRevision: number; expectedControlRevision: number }): Session {
    return this.commit(() => {
      const s = this.session(id), before = structuredClone(s), c = this.control();
      this.checkRevision(s, input.expectedRevision); this.checkControl(c, input.expectedControlRevision);
      const allowed: Record<string, [string[], Session['status']]> = { start: [['prepared'], 'active'], pause: [['active'], 'paused'], resume: [['paused'], 'active'], end: [['prepared', 'active', 'paused'], 'ended'] };
      const action = allowed[input.action]; ensure(action && action[0].includes(s.status), 'INVALID_TRANSITION', 'This lifecycle transition is not allowed.', 409);
      if (input.action === 'start' || input.action === 'resume') {
        if (c.activeSessionId && c.activeSessionId !== id) ensure(this.session(c.activeSessionId).status === 'ended', 'ACTIVE_SESSION_EXISTS', 'End the current session before starting another.', 409);
        c.activeSessionId = id; c.controlRevision++; this.store.put('control', c);
        s.startedAt ??= stamp();
      } else ensure(!c.activeSessionId || c.activeSessionId === id || s.status === 'prepared', 'INACTIVE_SESSION', 'This session is not active.', 409);
      s.status = action[1]; s.revision++;
      if (s.status === 'ended') { s.endedAt = stamp(); s.locks = []; }
      this.store.put(`session:${id}`, s); this.log(operator, before, s, `Session ${input.action}`, ['/session/status'], null);
      return s;
    });
  }
  checkRevision(s: Session, expected: number): void { ensure(Number.isInteger(expected) && s.revision === expected, 'REVISION_CONFLICT', 'Session has changed since it was read.', 409, [], s.revision); }
  checkControl(c: Control, expected: number): void { ensure(Number.isInteger(expected) && c.controlRevision === expected, 'CONTROL_REVISION_CONFLICT', 'Channel control has changed since it was read.', 409, [], c.controlRevision); }
  private prepare(actor: Actor, routeId: string, raw: unknown): { change: ChangeSet; digest: string; receipt?: Receipt } {
    if (actor.role === 'producer') {
      actor = this.actor(actor.id);
      this.readSession(actor, routeId);
      ensure(this.control().aiWritesEnabled, 'AI_WRITES_DISABLED', 'Producer writes are paused by the operator.', 403);
    }
    const normalizedHash = hash(raw), untyped = raw as any;
    // Receipt replay precedes schema/version/lock checks, but never authentication or session permission.
    if (untyped && typeof untyped.requestId === 'string') {
      const receipt = this.store.receipt(actor.id, routeId, untyped.requestId);
      if (receipt) { ensure(receipt.hash === normalizedHash, 'IDEMPOTENCY_CONFLICT', 'This request ID was already used for a different body.', 409); return { change: untyped, digest: normalizedHash, receipt: receipt.response }; }
    }
    const change = parseChange(raw);
    ensure(change.sessionId === routeId, 'SESSION_MISMATCH', 'Path and body session IDs must match.');
    return { change, digest: normalizedHash };
  }
  private candidate(actor: Actor, change: ChangeSet): { before: Session; after: Session; paths: string[]; changed: string[] } {
    const s = this.readSession(actor, change.sessionId), next = structuredClone(s), c = this.control();
    this.checkRevision(s, change.baseRevision);
    ensure(s.status !== 'ended', 'SESSION_ENDED', 'Ended sessions reject live changes.', 409);
    if (actor.role === 'producer') {
      ensure(c.activeSessionId === s.id && ['active', 'paused'].includes(s.status), 'INACTIVE_SESSION', 'Producer changes must target the current session.', 409);
      if (change.intent === 'apply') ensure(actor.canAutoPublish && change.provenance.disclosure === 'public', 'DISCLOSURE_REQUIRED', 'Automatic publication requires public provenance and a registered publishing grant.');
    }
    const allPaths = change.operations.flatMap(pathsFor);
    ensure(allPaths.length === new Set(allPaths).size, 'AMBIGUOUS_CHANGESET', 'A target appears more than once in this change set.');
    const observed = change.provenance.observedAt;
    ensure(Date.parse(observed) <= Date.now() + 60000, 'INVALID_OBSERVATION_TIME', 'Observation time is more than 60 seconds in the future.');
    for (const op of change.operations) {
      const paths = pathsFor(op);
      if (actor.role === 'producer') {
        ensure(actor.allowedOperations?.includes(op.op), 'OPERATION_FORBIDDEN', 'Producer is not granted this operation.', 403, paths);
        ensure(paths.every(p => pathAllowed(p, actor.allowedPaths)), 'FIELD_FORBIDDEN', 'Producer is not granted these fields.', 403, paths);
        if (change.intent === 'apply') {
          ensure(!s.locks.some(l => paths.includes(l.path)), 'FIELD_LOCKED', 'An operator lock protects this field.', 409, paths, s.revision);
          if (op.op === 'set_now' && s.nowObservedAt) ensure(Date.parse(observed) >= Date.parse(s.nowObservedAt), 'STALE_OBSERVATION', 'This observation predates the current activity.', 409, paths);
        }
      }
      if ('id' in op || op.op === 'upsert_event' || op.op === 'upsert_work_item') {
        const isEvent = op.op.includes('event');
        const itemId = 'id' in op ? op.id : op.op === 'upsert_event' ? op.event.id : (op as Extract<Operation, {op:'upsert_work_item'}>).workItem.id;
        const existing = (isEvent ? s.events : s.workItems).find(v => v.id === itemId);
        if (op.op.startsWith('retract')) ensure(existing, 'NOT_FOUND', 'The item to retract does not exist.', 404, paths);
        if (existing && actor.role === 'producer') {
          ensure(existing.actorId === actor.id || actor.canEditOthers, 'ITEM_OWNER_CONFLICT', 'Another producer owns this item.', 403, paths);
          if (!op.op.startsWith('retract')) ensure(!existing.retractedAt, 'ITEM_RETRACTED', 'Only the operator can restore a retracted item.', 409, paths);
        }
      }
      this.applyOperation(next, op, actor, observed);
    }
    const changed = allPaths.filter(p => canonical(this.valueAt(s, p)) !== canonical(this.valueAt(next, p)));
    if (actor.role === 'operator' && change.intent === 'apply') {
      for (const path of allPaths) if (!next.locks.some(l => l.path === path)) { next.locks.push({ path, actorId: actor.id, createdAt: stamp(), reason: change.provenance.reason }); if (!changed.includes(path)) changed.push(path); }
    }
    if (changed.length) next.revision++;
    return { before: s, after: next, paths: allPaths, changed };
  }
  private applyOperation(s: Session, op: Operation, actor: Actor, observed: string): void {
    switch (op.op) {
      case 'update_session': Object.assign(s, op.fields); break;
      case 'set_now': s.now = op.value; s.nowObservedAt = observed; break;
      case 'set_pin': s.pin = op.value; break;
      case 'upsert_event': {
        const existing = s.events.find(e => e.id === op.event.id);
        if (existing) Object.assign(existing, op.event, { retractedAt: null });
        else s.events.push({ ...op.event, actorId: actor.id, receivedAt: stamp(), retractedAt: null }); break;
      }
      case 'retract_event': { const e = s.events.find(e => e.id === op.id)!; e.retractedAt ??= stamp(); break; }
      case 'upsert_work_item': {
        const existing = s.workItems.find(w => w.id === op.workItem.id);
        if (existing) {
          const previous = { id: existing.id, title: existing.title, status: existing.status, publicResult: existing.publicResult };
          if (canonical(previous) !== canonical(op.workItem) || existing.retractedAt) Object.assign(existing, op.workItem, { updatedAt: stamp(), retractedAt: null });
        } else s.workItems.push({ ...op.workItem, actorId: actor.id, updatedAt: stamp(), retractedAt: null }); break;
      }
      case 'retract_work_item': { const w = s.workItems.find(w => w.id === op.id)!; w.retractedAt ??= stamp(); break; }
    }
  }
  valueAt(s: Session, path: string): unknown {
    if (path === '/now') return s.now;
    if (path === '/pin') return s.pin;
    if (path.startsWith('/session/')) return (s as any)[path.slice(9)];
    if (path.startsWith('/events/')) return s.events.find(e => e.id === path.slice(8)) ?? null;
    if (path.startsWith('/workItems/')) return s.workItems.find(w => w.id === path.slice(11)) ?? null;
    return null;
  }
  validate(actor: Actor, id: string, raw: unknown): unknown {
    if (actor.role === 'producer') actor = this.actor(actor.id);
    const { change, receipt } = this.prepare(actor, id, raw);
    if (receipt) return { ok: true, receipt, replay: true };
    const candidate = this.candidate(actor, change);
    return { ok: true, changedPaths: candidate.changed, before: this.context(actor, id), after: this.contextFrom(actor, candidate.after) };
  }
  changes(actor: Actor, id: string, raw: unknown): Receipt {
    return this.commit(() => {
      if (actor.role === 'producer') actor = this.actor(actor.id);
      const { change, digest, receipt } = this.prepare(actor, id, raw);
      if (receipt) return receipt;
      const candidate = this.candidate(actor, change);
      let result: Receipt;
      if (change.intent === 'propose') {
        const proposal: Proposal = { id: `proposal_${randomUUID()}`, revision: 0, status: 'pending', actorId: actor.id, createdAt: stamp(), reviewedAt: null, change };
        this.store.put(`proposal:${proposal.id}`, proposal);
        result = { ok: true, requestId: change.requestId, outcome: 'proposed', sessionId: id, appliedRevision: candidate.before.revision, publication: 'not_applicable', changedPaths: candidate.paths, proposalId: proposal.id, warnings: ['Saved for operator review; not published.'] };
      } else {
        this.store.put(`session:${id}`, candidate.after);
        result = { ok: true, requestId: change.requestId, outcome: candidate.changed.length ? 'applied' : 'no_change', sessionId: id, appliedRevision: candidate.after.revision, publication: this.control().activeSessionId === id ? this.publication() : 'not_applicable', changedPaths: candidate.changed, warnings: [] };
        if (candidate.changed.length) this.log(actor, candidate.before, candidate.after, change.provenance.reason, candidate.changed, change.requestId);
      }
      this.store.saveReceipt(actor.id, id, change.requestId, digest, result);
      if (actor.role === 'producer') this.store.put(`producer:${actor.id}`, { ...actor, lastSeenAt: stamp(), lastObservedAt: change.provenance.observedAt, lastError: null });
      return result;
    });
  }
  publication(): 'published' | 'held' | 'hidden' { return this.control().mode === 'auto' ? 'published' : this.control().mode === 'hold' ? 'held' : 'hidden'; }
  private log(actor: Actor, before: Session | null, after: Session | null, reason: string, paths: string[], requestId: string | null): void {
    const delta = (s: Session | null): Session | null => s ? { ...s, events: s.events.filter(e => paths.includes(`/events/${e.id}`)), workItems: s.workItems.filter(w => paths.includes(`/workItems/${w.id}`)), locks: s.locks.filter(l => paths.includes(l.path)) } : null;
    this.store.audit({ sessionId: after?.id ?? before?.id ?? null, actorId: actor.id, reason, receivedAt: stamp(), requestId, revision: after?.revision ?? null, publication: after && this.control().activeSessionId !== after.id ? 'not_applicable' : this.publication(), changedPaths: paths, before: delta(before), after: delta(after) });
  }
  contextFrom(actor: Actor, s: Session): unknown {
    if (actor.role === 'operator') return s;
    const allowed = (p: string) => pathAllowed(p, actor.allowedPaths);
    return { id: s.id, status: s.status, revision: s.revision, title: allowed('/session/title') ? s.title : undefined, goal: allowed('/session/goal') ? s.goal : undefined, recap: allowed('/session/recap') ? s.recap : undefined, now: allowed('/now') ? s.now : undefined, pin: allowed('/pin') ? s.pin : undefined, locks: s.locks.filter(l => allowed(l.path)).map(l => ({ path: l.path })), events: s.events.filter(e => allowed(`/events/${e.id}`)).slice(-30).map(e => ({ id: e.id, kind: e.kind, text: e.text, occurredAt: e.occurredAt, certainty: e.certainty, retractedAt: e.retractedAt })), workItems: s.workItems.filter(w => allowed(`/workItems/${w.id}`)).map(w => ({ id: w.id, title: w.title, status: w.status, publicResult: w.publicResult, retractedAt: w.retractedAt })) };
  }
  context(actor: Actor, id: string): unknown { if (actor.role === 'producer') actor = this.actor(actor.id); return this.contextFrom(actor, this.readSession(actor, id)); }
  locks(input: { sessionId: string; path: string; locked: boolean; expectedRevision: number; reason?: string }): Session {
    return this.commit(() => {
      const s = this.session(input.sessionId), before = structuredClone(s); this.checkRevision(s, input.expectedRevision);
      ensure(validPath(input.path), 'INVALID_PATH', 'This is not a lockable field path.');
      ensure(typeof input.locked === 'boolean', 'SCHEMA_VALIDATION', 'locked must be a boolean.');
      const found = s.locks.some(l => l.path === input.path);
      if (found !== input.locked) {
        s.locks = s.locks.filter(l => l.path !== input.path);
        if (input.locked) s.locks.push({ path: input.path, actorId: operator.id, createdAt: stamp(), reason: text(input.reason ?? 'Operator lock', 240) });
        s.revision++; this.store.put(`session:${s.id}`, s); this.log(operator, before, s, input.locked ? 'Field locked' : 'Automatic updates enabled', [input.path], null);
      }
      return s;
    });
  }
  setControl(input: { expectedControlRevision: number; mode?: Control['mode']; activeSessionId?: string | null; aiWritesEnabled?: boolean; confirmRestore?: boolean }): Control {
    return this.commit(() => {
      const c = this.control(); this.checkControl(c, input.expectedControlRevision);
      if (input.mode !== undefined) {
        ensure(['auto','hold','hidden'].includes(input.mode), 'SCHEMA_VALIDATION', 'Unknown publication mode.');
        if (input.mode === 'auto' && c.mode !== 'auto') ensure(input.confirmRestore === true, 'RESTORE_CONFIRMATION_REQUIRED', 'Review the next snapshot and explicitly confirm publication.');
      }
      if (input.activeSessionId !== undefined && input.activeSessionId !== c.activeSessionId) {
        if (input.activeSessionId !== null) ensure(this.session(input.activeSessionId).status !== 'ended', 'SESSION_ENDED', 'Cannot activate an ended session.', 409);
        if (c.activeSessionId) ensure(this.session(c.activeSessionId).status === 'ended', 'ACTIVE_SESSION_EXISTS', 'End the current session before switching.', 409);
      }
      if (input.aiWritesEnabled !== undefined) ensure(typeof input.aiWritesEnabled === 'boolean', 'SCHEMA_VALIDATION', 'aiWritesEnabled must be boolean.');
      const updated = { ...c, ...(input.mode !== undefined ? { mode: input.mode } : {}), ...(input.activeSessionId !== undefined ? { activeSessionId: input.activeSessionId } : {}), ...(input.aiWritesEnabled !== undefined ? { aiWritesEnabled: input.aiWritesEnabled } : {}) };
      if (canonical(c) !== canonical(updated)) { updated.controlRevision++; this.store.put('control', updated); this.log(operator, null, null, 'Channel control changed', ['/control'], null); }
      return updated;
    });
  }
  producer(input: { name: string; expectedControlRevision: number; canAutoPublish: boolean; allowedSessions: string[]; allowedOperations: string[]; allowedPaths: string[]; canEditOthers?: boolean }): { producer: Actor; token: string } {
    return this.commit(() => {
      const c = this.control(); this.checkControl(c, input.expectedControlRevision);
      ensure(typeof input.canAutoPublish === 'boolean' && Array.isArray(input.allowedSessions) && input.allowedSessions.length > 0 && input.allowedSessions.every(s => s === '*' || /^session_[A-Za-z0-9_-]+$/.test(s)), 'SCHEMA_VALIDATION', 'Invalid publishing grant or session scope.');
      ensure(Array.isArray(input.allowedOperations) && input.allowedOperations.every(op => OPERATIONS.includes(op)), 'SCHEMA_VALIDATION', 'Invalid operation scope.');
      ensure(Array.isArray(input.allowedPaths) && input.allowedPaths.every(p => p === '*' || ['/events/*','/workItems/*'].includes(p) || validPath(p)), 'SCHEMA_VALIDATION', 'Invalid field scope.');
      ensure(input.canEditOthers === undefined || typeof input.canEditOthers === 'boolean', 'SCHEMA_VALIDATION', 'canEditOthers must be boolean.');
      const token = secret(); const producer: Actor = { id: `producer_${randomUUID()}`, role: 'producer', name: text(input.name, 60), canAutoPublish: input.canAutoPublish, allowedSessions: input.allowedSessions, allowedOperations: input.allowedOperations, allowedPaths: input.allowedPaths, canEditOthers: input.canEditOthers === true, revoked: false, tokenHash: tokenHash(token), lastSeenAt: null, lastError: null };
      this.store.put(`producer:${producer.id}`, producer); c.controlRevision++; this.store.put('control', c); this.log(operator, null, null, 'Producer registered', ['/producers'], null);
      return { producer: { ...producer, tokenHash: undefined }, token };
    });
  }
  revoke(id: string, expected: number): void {
    this.commit(() => { const c = this.control(); this.checkControl(c, expected); const a = this.actor(id); a.revoked = true; this.store.put(`producer:${id}`, a); c.controlRevision++; this.store.put('control', c); this.log(operator, null, null, 'Producer revoked', ['/producers'], null); });
  }
  selectWork(id: string, input: { workItemId: string | null; expectedRevision: number }): Session {
    return this.commit(() => { const s = this.session(id), before = structuredClone(s); this.checkRevision(s, input.expectedRevision); ensure(input.workItemId === null || s.workItems.some(w => w.id === input.workItemId && !w.retractedAt), 'NOT_FOUND', 'Visible work item not found.', 404); if (s.selectedWorkId !== input.workItemId) { s.selectedWorkId = input.workItemId; s.revision++; this.store.put(`session:${id}`, s); this.log(operator, before, s, 'Displayed work selection changed', ['/selectedWorkId'], null); } return s; });
  }
  proposalPreview(id: string, screenId = 'main-full',sceneId=this.overlayConfig().activeSceneId): ProposalPreview {
    const p = this.store.get<Proposal>(`proposal:${id}`); ensure(p, 'NOT_FOUND', 'Proposal not found.', 404);
    ensure(p.status === 'pending', 'PROPOSAL_CONFLICT', 'Proposal is no longer pending.', 409);
    const s = this.session(p.change.sessionId), output = this.output(screenId), control = this.control();
    // Simulate the same operator candidate as approval, without receipts, writes or disclosure promotion.
    const candidate = this.candidate(operator, { ...p.change, intent: 'apply', baseRevision: s.revision });
    const now = stamp(), hypothetical = { ...control, mode: 'auto' as const };
    return { proposalId: p.id, proposalRevision: p.revision, sessionRevision: s.revision, baseRevision: p.change.baseRevision, stale: p.change.baseRevision !== s.revision, publication: control.activeSessionId === s.id ? this.publication() : 'not_applicable', changedPaths: candidate.changed, before: this.projected(candidate.before, output, hypothetical,this.overlayConfig(),sceneId), after: this.projected(candidate.after, output, hypothetical,this.overlayConfig(),sceneId) };
  }
  decision(id: string, input: { decision: string; expectedProposalRevision: number; expectedRevision: number; acknowledgeStale?: boolean; allowDisclosure?: boolean }): Proposal {
    return this.commit(() => {
      const p = this.store.get<Proposal>(`proposal:${id}`); ensure(p, 'NOT_FOUND', 'Proposal not found.', 404);
      ensure(p.status === 'pending' && p.revision === input.expectedProposalRevision, 'PROPOSAL_CONFLICT', 'Proposal is no longer pending at this version.', 409);
      const s = this.session(p.change.sessionId); this.checkRevision(s, input.expectedRevision);
      ensure(['approve','reject'].includes(input.decision), 'SCHEMA_VALIDATION', 'Invalid review decision.');
      if (input.decision === 'approve') {
        ensure(p.change.baseRevision === s.revision || input.acknowledgeStale === true, 'STALE_PROPOSAL', 'Review the proposal against the current content before approving.', 409);
        if (p.change.provenance.disclosure !== 'public') ensure(input.allowDisclosure === true, 'DISCLOSURE_REVIEW_REQUIRED', 'Explicitly confirm that the proposed content is suitable for public display.');
        const change: ChangeSet = { ...p.change, intent: 'apply', baseRevision: s.revision, requestId: randomUUID() };
        const result = this.candidate(operator, change); this.store.put(`session:${s.id}`, result.after);
        this.log(operator, result.before, result.after, `Approved proposal ${id}: ${p.change.provenance.reason}`, result.changed, change.requestId);
      }
      p.status = input.decision === 'approve' ? 'approved' : 'rejected'; p.reviewedAt = stamp(); p.revision++; this.store.put(`proposal:${id}`, p);
      if (input.decision === 'reject') this.log(operator, null, null, `Rejected proposal ${id}`, ['/proposals'], null);
      return p;
    });
  }
  undo(auditId: number, expectedRevision: number): Session {
    return this.commit(() => {
      const entry = this.store.auditById(auditId); ensure(entry?.before && entry.after && !entry.undoneAt, 'UNDO_UNAVAILABLE', 'This change cannot be undone.', 409);
      const s = this.session(entry.sessionId!), before = structuredClone(s); this.checkRevision(s, expectedRevision);
      ensure(entry.changedPaths.every(validPath), 'UNDO_UNAVAILABLE', 'Lifecycle and control changes must be reversed with their dedicated controls.', 409);
      for (const path of entry.changedPaths) ensure(canonical(this.valueAt(s, path)) === canonical(this.valueAt(entry.after, path)), 'UNDO_CONFLICT', 'A changed field was modified again; review it manually.', 409, [path]);
      for (const path of entry.changedPaths) {
        const value = this.valueAt(entry.before, path);
        if (path === '/now') { s.now = structuredClone(value) as Session['now']; s.nowObservedAt = stamp(); }
        else if (path === '/pin') s.pin = structuredClone(value) as Session['pin'];
        else if (path.startsWith('/session/')) (s as any)[path.slice(9)] = structuredClone(value);
        else if (path.startsWith('/events/')) { s.events = s.events.filter(e => e.id !== path.slice(8)); if (value) s.events.push(structuredClone(value) as Session['events'][number]); else { const removed = entry.after.events.find(e => e.id === path.slice(8))!; s.events.push({ ...removed, retractedAt: stamp() }); } }
        else if (path.startsWith('/workItems/')) { s.workItems = s.workItems.filter(w => w.id !== path.slice(11)); if (value) s.workItems.push(structuredClone(value) as Session['workItems'][number]); else { const removed = entry.after.workItems.find(w => w.id === path.slice(11))!; s.workItems.push({ ...removed, retractedAt: stamp() }); } }
        if (!s.locks.some(l => l.path === path)) s.locks.push({ path, actorId: operator.id, createdAt: stamp(), reason: 'Undo' });
      }
      s.revision++; this.store.put(`session:${s.id}`, s); entry.undoneAt = stamp(); this.store.updateAudit(entry); this.log(operator, before, s, `Undo change ${auditId}`, entry.changedPaths, null);
      return s;
    });
  }
  purgeSession(id: string, input: { expectedRevision: number; expectedControlRevision: number; confirm: boolean }): void {
    this.commit(() => {
      const s = this.session(id), c = this.control(); this.checkRevision(s, input.expectedRevision); this.checkControl(c, input.expectedControlRevision); ensure(input.confirm === true, 'CONFIRMATION_REQUIRED', 'Purging a session requires explicit confirmation.');
      if (c.activeSessionId === id) { c.activeSessionId = null; c.mode = 'hidden'; c.controlRevision++; this.store.put('control', c); }
      this.store.delete(`session:${id}`);
      for (const p of this.store.list<Proposal>('proposal:')) if (p.change.sessionId === id) this.store.delete(`proposal:${p.id}`);
      this.store.db.prepare('DELETE FROM receipts WHERE session_id=?').run(id);
      this.store.db.prepare('UPDATE audit SET value=? WHERE session_id=?').run(JSON.stringify({ sessionId: id, actorId: 'operator', reason: 'Session content purged', receivedAt: stamp(), requestId: null, revision: null, publication: 'hidden', changedPaths: [], before: null, after: null }), id);
      this.log(operator, null, null, `Purged session ${id}`, [], null);
    });
    this.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
  }
}
