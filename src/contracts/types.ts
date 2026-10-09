export type SessionStatus = 'prepared' | 'active' | 'paused' | 'ended';
export type Mode = 'auto' | 'hold' | 'hidden';
export type Preset = 'full' | 'side' | 'lower';
export type Now = { title: string; detail: string; status: 'preparing' | 'in_progress' | 'blocked' | 'paused' | 'complete'; next: string | null };
export type Event = { id: string; kind: 'topic' | 'progress' | 'decision' | 'result' | 'correction'; text: string; occurredAt: string; certainty: 'confirmed' | 'tentative' };
export type Work = { id: string; title: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; publicResult: string | null };
export type Pin = { text: string; expiresAt: string | null };
export type Operation =
  | { op: 'update_session'; fields: Partial<Pick<Session, 'title' | 'goal' | 'recap'>> }
  | { op: 'set_now'; value: Now | null }
  | { op: 'set_pin'; value: Pin | null }
  | { op: 'upsert_event'; event: Event }
  | { op: 'retract_event'; id: string }
  | { op: 'upsert_work_item'; workItem: Work }
  | { op: 'retract_work_item'; id: string };
export type ChangeSet = { schemaVersion: '1.0'; requestId: string; sessionId: string; baseRevision: number; intent: 'apply' | 'propose'; provenance: { disclosure: 'public' | 'unknown' | 'restricted'; observedAt: string; sourceRefs: string[]; reason: string }; operations: Operation[] };
export type StoredEvent = Event & { actorId: string; receivedAt: string; retractedAt: string | null };
export type StoredWork = Work & { actorId: string; updatedAt: string; retractedAt: string | null };
export type Lock = { path: string; actorId: string; createdAt: string; reason: string };
export type Session = { id: string; status: SessionStatus; title: string; goal: string; recap: string[]; revision: number; createdAt: string; startedAt: string | null; endedAt: string | null; now: Now | null; nowObservedAt: string | null; pin: Pin | null; events: StoredEvent[]; workItems: StoredWork[]; locks: Lock[]; selectedWorkId: string | null };
export type Actor = { id: string; role: 'operator' | 'producer'; canAutoPublish?: boolean; allowedSessions?: string[]; allowedOperations?: string[]; allowedPaths?: string[]; canEditOthers?: boolean; revoked?: boolean; tokenHash?: string; name?: string; lastSeenAt?: string | null; lastError?: string | null; lastObservedAt?: string | null };
export type Control = { activeSessionId: string | null; controlRevision: number; mode: Mode; aiWritesEnabled: boolean; timezone: string };
export type PublicContent = { title: string; status: SessionStatus; goal?: string; now: Now | null; recap?: string[]; events?: Event[]; pin?: Pin | null; workItem?: Work | null };
export type PublicSnapshot = { screenId: string; preset: Preset; publicRevision: number; sessionId: string | null; mode: Mode; leaseMs: number; publishedAt: string; content: PublicContent | null; compact?: boolean };
export type Output = { screenId: string; preset: Preset; keyHash: string; generation: number; snapshot: PublicSnapshot };
export type Receipt = { ok: true; requestId: string; outcome: 'applied' | 'proposed' | 'no_change'; sessionId: string; appliedRevision: number; publication: 'published' | 'held' | 'hidden' | 'not_applicable'; changedPaths: string[]; warnings: string[]; proposalId?: string };
export type Proposal = { id: string; revision: number; status: 'pending' | 'approved' | 'rejected'; actorId: string; createdAt: string; reviewedAt: string | null; change: ChangeSet };
export type Audit = { id: number; sessionId: string | null; actorId: string; reason: string; receivedAt: string; requestId: string | null; revision: number | null; publication: string; changedPaths: string[]; before: Session | null; after: Session | null; undoneAt?: string | null };
