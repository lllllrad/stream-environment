import { randomUUID } from 'node:crypto';
import { Store } from '../src/server/store.ts';
import { Engine } from '../src/domain/engine.ts';
import type { Actor, ChangeSet, Operation, Session } from '../src/contracts/types.ts';
export function setup(path = ':memory:') {
  const store = new Store(path), engine = new Engine(store);
  const session = engine.createSession({ title: '설정 비교 실험', goal: '같은 조건에서 결과의 차이를 확인합니다', expectedControlRevision: 0 });
  engine.lifecycle(session.id, { action: 'start', expectedRevision: 0, expectedControlRevision: 0 });
  const { producer } = engine.producer({ name: 'Test producer', expectedControlRevision: 1, canAutoPublish: true, allowedSessions: [session.id], allowedOperations: ['update_session','set_now','set_pin','upsert_event','retract_event','upsert_work_item','retract_work_item'], allowedPaths: ['*'] });
  return { store, engine, producer, session: engine.session(session.id) };
}
export function change(session: Session, operations: Operation[], overrides: Partial<ChangeSet> = {}): ChangeSet {
  return { schemaVersion: '1.0', requestId: randomUUID(), sessionId: session.id, baseRevision: session.revision, intent: 'apply', provenance: { disclosure: 'public', observedAt: new Date().toISOString(), sourceRefs: ['fixture:public'], reason: 'Test public update' }, operations, ...overrides };
}
export const now = (title = '두 설정의 결과 비교'): Operation => ({ op: 'set_now', value: { title, detail: '같은 조건에서 차이를 확인하는 중', status: 'in_progress', next: '차이가 생기는 조건 정리' } });
export const event = (id = 'comparison'): Operation => ({ op: 'upsert_event', event: { id, kind: 'topic', text: '비교를 시작함', occurredAt: new Date().toISOString(), certainty: 'confirmed' } });
export function apply(engine: Engine, actor: Actor, sessionId: string, operations: Operation[], overrides: Partial<ChangeSet> = {}) { return engine.changes(actor, sessionId, change(engine.session(sessionId), operations, overrides)); }
