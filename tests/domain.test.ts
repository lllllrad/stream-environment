import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store.ts';
import { Engine, operator } from '../src/domain/engine.ts';
import { hash } from '../src/contracts/validation.ts';
import { DomainError } from '../src/contracts/errors.ts';
import type { ChangeSet, Proposal } from '../src/contracts/types.ts';
import { setup, change, apply, now, event } from './helpers.ts';
const code = (name: string) => (e: unknown) => e instanceof DomainError && e.code === name;

test('AC-02/05/06: atomic batch, stale versions, and persistent operator locks', () => {
  const { store, engine: e, producer: p, session: s } = setup();
  const stale = change(s, [now()]);
  apply(e, operator, s.id, [now('운영자가 정정한 내용')]);
  const before = e.session(s.id);
  assert.throws(() => e.changes(p, s.id, stale), code('REVISION_CONFLICT'));
  assert.throws(() => apply(e, p, s.id, [event(), now()]), code('FIELD_LOCKED'));
  assert.deepEqual(e.session(s.id), before);
  assert.equal(e.session(s.id).events.length, 0);
  apply(e, operator, s.id, [now('두 번째 수동 정정')]);
  assert.equal(e.session(s.id).locks.filter(l => l.path === '/now').length, 1);
  e.locks({ sessionId: s.id, expectedRevision: e.session(s.id).revision, path: '/now', locked: false });
  apply(e, p, s.id, [now()]); store.close();
});
test('AC-03/04: receipt replay precedes version checks and hashes normalized canonical bodies', () => {
  const { store, engine: e, producer: p, session: s } = setup();
  const request = change(s, [now('Café'), event()]);
  const receipt = e.changes(p, s.id, request);
  apply(e, p, s.id, [event('later')]);
  const revision = e.session(s.id).revision;
  const decomposed = JSON.parse(JSON.stringify(request).replace('Café', 'Cafe\u0301'));
  assert.equal(hash(request), hash(decomposed));
  assert.deepEqual(e.changes(p, s.id, decomposed), receipt);
  assert.equal(e.session(s.id).revision, revision);
  assert.throws(() => e.changes(p, s.id, { ...request, operations: [now('Other')] }), code('IDEMPOTENCY_CONFLICT')); store.close();
});
test('duplicate targets and unknown properties are rejected without partial writes', () => {
  const { store, engine: e, producer: p, session: s } = setup();
  assert.throws(() => apply(e, p, s.id, [now(), now()]), code('AMBIGUOUS_CHANGESET'));
  assert.throws(() => e.changes(p, s.id, { ...change(s, [now()]), force: true }), code('SCHEMA_VALIDATION'));
  assert.equal(e.session(s.id).revision, s.revision); store.close();
});
test('AC-07: old session responses cannot enter a new active session; public revision remains monotonic', () => {
  const { store, engine: e, producer: p, session: s } = setup();
  const late = change(s, [now()]); const prior = e.output('main-side').snapshot.publicRevision;
  e.lifecycle(s.id, { action: 'end', expectedRevision: s.revision, expectedControlRevision: e.control().controlRevision });
  const next = e.createSession({ title: '다음 활동', goal: '새로운 실험', expectedControlRevision: e.control().controlRevision });
  e.lifecycle(next.id, { action: 'start', expectedRevision: next.revision, expectedControlRevision: e.control().controlRevision });
  assert.throws(() => e.changes(p, s.id, late), code('REVISION_CONFLICT'));
  assert.equal(e.output('main-side').snapshot.sessionId, next.id);
  assert.ok(e.output('main-side').snapshot.publicRevision > prior); store.close();
});
test('AC-08: old current observations rejected, historical events allowed, future observations rejected', () => {
  const { store, engine: e, producer: p, session: s } = setup();
  apply(e, p, s.id, [now()]);
  const old = { disclosure: 'public' as const, observedAt: '2020-01-01T00:00:00Z', sourceRefs: [], reason: 'Historical observation' };
  assert.throws(() => apply(e, p, s.id, [now('늦게 도착한 분석')], { provenance: old }), code('STALE_OBSERVATION'));
  apply(e, p, s.id, [event('historical')], { provenance: old });
  assert.throws(() => apply(e, p, s.id, [event('future')], { provenance: { ...old, observedAt: new Date(Date.now() + 120000).toISOString() } }), code('INVALID_OBSERVATION_TIME')); store.close();
});
test('AC-09/10/11: private proposals and dry runs are isolated; stale and disclosure approvals require review', () => {
  const { store, engine: e, producer: p, session: s } = setup();
  const request = change(s, [now('PRIVATE CONTENT')], { intent: 'propose', provenance: { disclosure: 'restricted', observedAt: new Date().toISOString(), sourceRefs: ['private:ref'], reason: 'Internal review' } });
  const before = e.output('main-full'); const audits = store.audits();
  e.validate(p, s.id, request);
  assert.deepEqual(store.audits(), audits); assert.equal(store.list('proposal:').length, 0);
  assert.equal(store.receipt(p.id, s.id, request.requestId), undefined);
  assert.throws(() => e.changes(p, s.id, { ...request, intent: 'apply' }), code('DISCLOSURE_REQUIRED'));
  const receipt = e.changes(p, s.id, request);
  assert.equal(e.session(s.id).revision, s.revision); assert.deepEqual(e.output('main-full'), before);
  assert.ok(!JSON.stringify(e.output('main-full')).includes('PRIVATE CONTENT'));
  apply(e, p, s.id, [event()]);
  const review = { decision: 'approve', expectedProposalRevision: 0, expectedRevision: e.session(s.id).revision };
  assert.throws(() => e.decision(receipt.proposalId!, review), code('STALE_PROPOSAL'));
  assert.throws(() => e.decision(receipt.proposalId!, { ...review, acknowledgeStale: true }), code('DISCLOSURE_REVIEW_REQUIRED'));
  e.decision(receipt.proposalId!, { ...review, acknowledgeStale: true, allowDisclosure: true });
  assert.equal(e.session(s.id).now!.title, 'PRIVATE CONTENT'); assert.ok(e.session(s.id).locks.some(l => l.path === '/now')); store.close();
});
test('AC-12/13: hold preserves content but retraction and notice expiry remove published content', () => {
  const { store, engine: e, producer: p, session: s } = setup();
  apply(e, p, s.id, [now(), event(), { op: 'set_pin', value: { text: '공지', expiresAt: new Date(Date.now() + 10000).toISOString() } }]);
  e.setControl({ expectedControlRevision: e.control().controlRevision, mode: 'hold' });
  const held = e.output('main-side').snapshot;
  const result = apply(e, p, s.id, [now('미리보기에만 표시')]);
  assert.equal(result.publication, 'held'); assert.equal(e.preview('main-side').next.content!.now!.title, '미리보기에만 표시');
  assert.equal(e.output('main-side').snapshot.content!.now!.title, held.content!.now!.title);
  apply(e, p, s.id, [{ op: 'retract_event', id: 'comparison' }]);
  assert.equal(e.output('main-side').snapshot.content!.events!.length, 0);
  const output = e.output('main-side'); output.snapshot.content!.pin!.expiresAt = '2000-01-01T00:00:00Z'; store.put('output:main-side', output); e.tick();
  assert.equal(e.output('main-side').snapshot.content!.pin, undefined);
  assert.throws(() => e.setControl({ expectedControlRevision: e.control().controlRevision, mode: 'auto' }), code('RESTORE_CONFIRMATION_REQUIRED'));
  e.setControl({ expectedControlRevision: e.control().controlRevision, mode: 'auto', confirmRestore: true });
  assert.equal(e.output('main-side').snapshot.content!.now!.title, '미리보기에만 표시'); store.close();
});
test('AC-14/21: hidden, locks, snapshots, control and receipts survive restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'broadcast-test-')), path = join(dir, 'state.db');
  try {
    const { store, engine: e, producer: p, session: s } = setup(path);
    const request = change(s, [now()]), receipt = e.changes(p, s.id, request);
    e.locks({ sessionId: s.id, path: '/now', locked: true, expectedRevision: e.session(s.id).revision });
    e.setControl({ expectedControlRevision: e.control().controlRevision, mode: 'hidden' }); const revision = e.output('main-side').snapshot.publicRevision; store.close();
    const restored = new Store(path), recovered = new Engine(restored);
    assert.equal(recovered.control().mode, 'hidden'); assert.equal(recovered.output('main-side').snapshot.content, null);
    assert.equal(recovered.output('main-side').snapshot.publicRevision, revision);
    assert.equal(recovered.session(s.id).locks.length, 1); assert.deepEqual(recovered.changes(p, s.id, request), receipt);
    restored.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('AC-18/19: code point limits, NFC, controls, plain text and full object replacement', () => {
  const { store, engine: e, producer: p, session: s } = setup();
  apply(e, p, s.id, [now('😀'.repeat(48))]); assert.equal([...e.session(s.id).now!.title].length, 48);
  assert.throws(() => apply(e, p, s.id, [now('😀'.repeat(49))]), code('SCHEMA_VALIDATION'));
  assert.throws(() => apply(e, p, s.id, [now(' \t ')]), code('INVALID_TEXT'));
  assert.throws(() => apply(e, p, s.id, [now('a\nb')]), code('INVALID_TEXT'));
  apply(e, p, s.id, [now('<script>alert(1)</script>')]);
  assert.equal(e.output('main-full').snapshot.content!.now!.title, '<script>alert(1)</script>');
  const incomplete = change(e.session(s.id), [now()]); delete (incomplete.operations[0] as any).value.next;
  assert.throws(() => e.changes(p, s.id, incomplete), code('SCHEMA_VALIDATION')); store.close();
});
test('AC-20: producers cannot edit others, bypass field grants, or restore retracted IDs', () => {
  const { store, engine: e, producer: p, session: s } = setup();
  apply(e, p, s.id, [event()]);
  const { producer: other } = e.producer({ name: 'Other', expectedControlRevision: e.control().controlRevision, canAutoPublish: true, allowedSessions: [s.id], allowedOperations: ['upsert_event'], allowedPaths: ['/events/*'] });
  assert.throws(() => apply(e, other, s.id, [event()]), code('ITEM_OWNER_CONFLICT'));
  assert.throws(() => apply(e, other, s.id, [now()]), code('OPERATION_FORBIDDEN'));
  apply(e, p, s.id, [{ op: 'retract_event', id: 'comparison' }]);
  assert.throws(() => apply(e, p, s.id, [event()]), code('ITEM_RETRACTED'));
  apply(e, operator, s.id, [event()]); assert.equal(e.session(s.id).events[0].retractedAt, null); store.close();
});
test('AC-21: injected storage failure rolls back session, audit, receipt and all outputs', () => {
  const { store, engine: e, producer: p, session: s } = setup(); const original = store.put.bind(store);
  const prior = { s: e.session(s.id), output: e.output('main-full'), audit: store.audits() };
  const request = change(s, [now(), event()]);
  store.put = (k, v) => { if (k === 'output:main-side') throw new Error('Injected write failure'); original(k, v); };
  assert.throws(() => e.changes(p, s.id, request), /Injected write failure/);
  assert.deepEqual(e.session(s.id), prior.s); assert.deepEqual(e.output('main-full'), prior.output); assert.deepEqual(store.audits(), prior.audit);
  assert.equal(store.receipt(p.id, s.id, request.requestId), undefined); store.put = original;
  e.changes(p, s.id, request); store.close();
});
test('AC-22: identical content does not increase content or public revisions', () => {
  const { store, engine: e, producer: p, session: s } = setup();
  const operations = [now(), event(), { op: 'upsert_work_item' as const, workItem: { id: 'work', title: '比較', status: 'running' as const, publicResult: null } }];
  apply(e, p, s.id, operations); const revision = e.session(s.id).revision, publicRevision = e.output('main-full').snapshot.publicRevision;
  const receipt = apply(e, p, s.id, operations);
  assert.equal(receipt.outcome, 'no_change'); assert.equal(e.session(s.id).revision, revision); assert.equal(e.output('main-full').snapshot.publicRevision, publicRevision); store.close();
});
test('preset DTOs exclude hidden widget text, ownership, provenance, goals and detail', () => {
  const { store, engine: e, producer: p, session: s } = setup();
  apply(e, p, s.id, [now(), event(), { op: 'set_pin', value: { text: 'PIN', expiresAt: null } }, { op: 'upsert_work_item', workItem: { id: 'work', title: 'WORK_SECRET_ON_SIDE', status: 'failed', publicResult: 'PUBLIC_FAILURE_SUMMARY' } }, { op: 'update_session', fields: { recap: ['A','B','C'] } }]);
  const lower = JSON.stringify(e.output('main-lower').snapshot), side = JSON.stringify(e.output('main-side').snapshot), full = JSON.stringify(e.output('main-full').snapshot);
  for (const excluded of ['detail','recap','events','workItem','pin','goal','actorId','sourceRefs','tokenHash']) assert.ok(!lower.includes(`"${excluded}"`));
  assert.ok(!side.includes('WORK_SECRET_ON_SIDE')); assert.equal(e.output('main-side').snapshot.content!.recap!.length, 2);
  for (const excluded of ['actorId','sourceRefs','tokenHash','locks','reason','proposals']) assert.ok(!full.includes(`"${excluded}"`)); store.close();
});
test('undo patches only changed fields, locks them, and rejects later conflicts', () => {
  const { store, engine: e, producer: p, session: s } = setup();
  apply(e, p, s.id, [now('First')]); apply(e, p, s.id, [now('Second')]); const audit = store.audits()[0];
  apply(e, p, s.id, [event()]); e.undo(audit.id, e.session(s.id).revision);
  assert.equal(e.session(s.id).now!.title, 'First'); assert.equal(e.session(s.id).events.length, 1);
  assert.throws(() => e.undo(audit.id, e.session(s.id).revision), code('UNDO_UNAVAILABLE')); store.close();
});
test('AI write pause, scope-limited context, and credential revocation are enforced by the engine', () => {
  const { store, engine: e, producer: p, session: s } = setup();
  e.setControl({ expectedControlRevision: e.control().controlRevision, aiWritesEnabled: false });
  assert.throws(() => apply(e, p, s.id, [now()]), code('AI_WRITES_DISABLED'));
  apply(e, operator, s.id, [now()]); e.revoke(p.id, e.control().controlRevision);
  assert.throws(() => apply(e, p, s.id, [now()]), code('UNAUTHORIZED')); store.close();
});
test('sensitive session purge removes proposals, receipts, cached snapshots and audit text', () => {
  const { store, engine: e, producer: p, session: s } = setup();
  const secret = 'SENSITIVE_MARKER'; apply(e, p, s.id, [now(secret)]);
  apply(e, p, s.id, [now(secret)], { intent: 'propose' });
  e.purgeSession(s.id, { expectedRevision: e.session(s.id).revision, expectedControlRevision: e.control().controlRevision, confirm: true });
  assert.equal(store.get(`session:${s.id}`), undefined); assert.equal(store.list<Proposal>('proposal:').length, 0);
  assert.ok(!JSON.stringify(store.audits()).includes(secret)); assert.ok(!JSON.stringify(store.list('output:')).includes(secret)); store.close();
});
test('session limits accept 120/300 Unicode code points for creation and updates, reject overflow atomically', () => {
  const x = setup();
  try {
    const title = '😀'.repeat(120), goal = '가'.repeat(300);
    const created = x.engine.createSession({ title, goal, expectedControlRevision: x.engine.control().controlRevision });
    assert.equal(created.title, title); assert.equal(created.goal, goal);
    assert.throws(() => x.engine.createSession({ title: title + '가', goal, expectedControlRevision: x.engine.control().controlRevision }));
    assert.throws(() => x.engine.createSession({ title, goal: goal + '가', expectedControlRevision: x.engine.control().controlRevision }));
    apply(x.engine, x.producer, x.session.id, [{ op: 'update_session', fields: { title, goal } }]);
    const before = x.engine.session(x.session.id), output = x.engine.output('main-full');
    for (const fields of [{ title: title + '😀' }, { goal: goal + '가' }]) {
      assert.throws(() => apply(x.engine, x.producer, x.session.id, [{ op: 'update_session', fields }]));
      assert.deepEqual(x.engine.session(x.session.id), before); assert.deepEqual(x.engine.output('main-full'), output);
    }
  } finally { x.store.close(); }
});

test('public-output migration preserves snapshots, controls and operator credentials, removing old output secrets', () => {
  const x = setup();
  try {
    apply(x.engine, x.producer, x.session.id, [now()]);
    x.engine.setControl({ mode: 'hold', expectedControlRevision: x.engine.control().controlRevision });
    const output = x.engine.output('main-side'), control = x.engine.control();
    x.store.put('output:main-side', { ...output, keyHash: 'obsolete', generation: 4 });
    x.store.put('auth:display', { role: 'display', tokenHash: 'display', expiresAt: Date.now() + 1000 });
    x.store.put('auth:operator', { role: 'operator', tokenHash: 'operator', expiresAt: Date.now() + 1000 });
    const reopened = new Engine(x.store);
    assert.deepEqual(reopened.output('main-side'), output); assert.deepEqual(reopened.control(), control);
    assert.equal(x.store.get('auth:display'), undefined); assert.ok(x.store.get('auth:operator'));
  } finally { x.store.close(); }
});
test('rendered proposal previews simulate approval against latest content without changing hidden outputs, disclosure or receipts', () => {
  const x = setup();
  try {
    apply(x.engine, x.producer, x.session.id, [now('Original activity')]);
    const submitted = apply(x.engine, x.producer, x.session.id, [now('Private suggested activity'), { op: 'set_pin', value: { text: 'Suggested notice', expiresAt: null } }], { intent: 'propose', provenance: { disclosure: 'restricted', observedAt: new Date().toISOString(), sourceRefs: ['private:ref'], reason: 'PRIVATE_REASON' } });
    apply(x.engine, x.producer, x.session.id, [{ op: 'update_session', fields: { recap: ['New context after submission'] } }]);
    x.engine.setControl({ mode: 'hidden', expectedControlRevision: x.engine.control().controlRevision });
    const before = x.engine.session(x.session.id), proposal = x.store.get<Proposal>(`proposal:${submitted.proposalId}`)!, audit = x.store.audits(), outputs = x.store.list('output:');
    for (const preset of ['full','side','lower']) {
      const preview = x.engine.proposalPreview(proposal.id, `main-${preset}`);
      assert.equal(preview.stale, true); assert.equal(preview.sessionRevision, before.revision); assert.equal(preview.baseRevision, proposal.change.baseRevision);
      assert.equal(preview.publication, 'hidden'); assert.equal(preview.after.mode, 'auto');
      assert.equal(preview.before.content!.now!.title, 'Original activity'); assert.equal(preview.after.content!.now!.title, 'Private suggested activity');
      assert.ok(!JSON.stringify(preview).includes('PRIVATE_REASON')); assert.ok(!JSON.stringify(preview).includes('sourceRefs'));
      if (preset === 'lower') { assert.equal(preview.after.content!.pin, undefined); assert.equal(preview.after.content!.now!.detail, undefined); }
      else { assert.equal(preview.after.content!.pin!.text, 'Suggested notice'); assert.deepEqual(preview.after.content!.recap, ['New context after submission']); }
    }
    assert.deepEqual(x.engine.session(x.session.id), before); assert.deepEqual(x.store.get(`proposal:${proposal.id}`), proposal); assert.deepEqual(x.store.audits(), audit); assert.deepEqual(x.store.list('output:'), outputs);
    assert.throws(() => x.engine.decision(proposal.id, { decision: 'approve', expectedProposalRevision: 0, expectedRevision: before.revision }), code('STALE_PROPOSAL'));
    assert.throws(() => x.engine.decision(proposal.id, { decision: 'approve', expectedProposalRevision: 0, expectedRevision: before.revision, acknowledgeStale: true }), code('DISCLOSURE_REVIEW_REQUIRED'));
    const expected = x.engine.proposalPreview(proposal.id).after.content;
    x.engine.decision(proposal.id, { decision: 'approve', expectedProposalRevision: 0, expectedRevision: before.revision, acknowledgeStale: true, allowDisclosure: true });
    assert.equal(x.engine.output('main-full').snapshot.content, null);
    x.engine.setControl({ mode: 'auto', expectedControlRevision: x.engine.control().controlRevision, confirmRestore: true });
    assert.deepEqual(x.engine.output('main-full').snapshot.content, expected);
    assert.throws(() => x.engine.proposalPreview(proposal.id), code('PROPOSAL_CONFLICT'));
  } finally { x.store.close(); }
});
