import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { scenarios } from '../fixtures/scenarios.ts';
import type { ChangeSet, Control, Operation, Session } from '../src/contracts/types.ts';

const base = process.env.DASHBOARD_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4310}`;
const dataDir = resolve(process.env.DATA_DIR ?? '.data');
const operatorToken = process.env.ADMIN_TOKEN ?? readFileSync(resolve(dataDir, 'operator.key'), 'utf8').trim();
async function call(path: string, value?: unknown, token = operatorToken, expectedError?: string): Promise<any> {
  const response = await fetch(base + '/api/v1' + path, { method: value === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: value === undefined ? undefined : JSON.stringify(value) });
  const data = await response.json();
  if (expectedError) { if (data.error?.code !== expectedError) throw new Error(`Expected ${expectedError}, received ${data.error?.code ?? 'success'}.`); console.log(`Expected rejection: ${data.error.code}`); return data; }
  if (!response.ok) throw new Error(`${data.error?.code}: ${data.error?.message}`);
  return data;
}
function draft(s: Session, operations: Operation[], intent: 'apply'|'propose' = 'apply'): ChangeSet { return { schemaVersion: '1.0', requestId: randomUUID(), sessionId: s.id, baseRevision: s.revision, intent, provenance: { disclosure: 'public', observedAt: new Date().toISOString(), sourceRefs: ['demo:synthetic'], reason: 'Synthetic demonstration update' }, operations }; }
const args = process.argv.slice(2);
const recordPath = resolve(dataDir, 'demo-producer.json');
if (args.includes('--exercise') || args.includes('--end')) {
  const record = JSON.parse(readFileSync(recordPath, 'utf8')) as { sessionId: string; token: string };
  let control: Control = await call('/admin/control');
  if (control.activeSessionId !== record.sessionId) throw new Error('The demo session is no longer current. No content was changed.');
  let current: Session = await call(`/sessions/${record.sessionId}/context`);
  if (args.includes('--end')) { await call(`/admin/sessions/${current.id}/lifecycle`, { action: 'end', expectedRevision: current.revision, expectedControlRevision: control.controlRevision }); console.log('Demo session ended.'); }
  else {
    const sources = (await call('/sources', undefined, record.token)).sources;
    if (['now','events'].some(id => sources.find((source: {id:string;policy:string}) => source.id === id)?.policy !== 'apply_allowed')) throw new Error('Explicitly enable automatic publication for now and events in Producers before exercising the demo. Source policies were not changed.');
    const endpoint = `/sessions/${current.id}/changes`;
    const operation: Operation = { op: 'set_now', value: { title: '변경 안전성 확인', detail: '중복, 잠금, 보류, 철회와 복구를 확인하는 데모입니다.', status: 'in_progress', next: null } };
    if (current.locks.some(l => l.path === '/now')) throw new Error('Unlock /now explicitly in the operator UI before exercising the demo.');
    const request = draft(current, [operation]);
    const receipt = await call(endpoint, request, record.token); console.log(`Stored: ${receipt.outcome}; publication: ${receipt.publication}`);
    const replay = await call(endpoint, request, record.token); console.log(`Replay returns original revision ${replay.appliedRevision}.`);
    await call(endpoint, { ...request, operations: [{ op: 'set_now', value: null }] }, record.token, 'IDEMPOTENCY_CONFLICT');
    current = await call(`/sessions/${current.id}/context`);
    await call('/admin/locks', { sessionId: current.id, path: '/now', locked: true, expectedRevision: current.revision });
    current = await call(`/sessions/${current.id}/context`);
    await call(endpoint, draft(current, [operation]), record.token, 'FIELD_LOCKED');
    const proposal = await call(endpoint, draft(current, [operation], 'propose'), record.token); console.log(`Review required: ${proposal.outcome}; publication: ${proposal.publication}`);
    await call('/admin/control', { expectedControlRevision: control.controlRevision, mode: 'hold' });
    const event: Operation = { op: 'upsert_event', event: { id: 'demo_held', text: '게시 보류 중에 저장한 데모 사건입니다.', kind: 'progress', occurredAt: new Date().toISOString(), certainty: 'confirmed' } };
    const held = await call(endpoint, draft(current, [event]), record.token); console.log(`Stored during hold: ${held.publication}; not broadcast.`);
    current = await call(`/sessions/${current.id}/context`);
    await call(endpoint, draft(current, [{ op: 'retract_event', id: 'demo_held' }]), record.token);
    control = await call('/admin/control'); await call('/admin/control', { expectedControlRevision: control.controlRevision, mode: 'hidden' });
    console.log('All outputs hidden. Review the next snapshot in the operator UI and explicitly resume. /now remains locked.');
  }
} else {
  const name = args[args.indexOf('--scenario') + 1] ?? 'normal';
  const fixture = scenarios[name]; if (!fixture) throw new Error(`Unknown scenario. Choose: ${Object.keys(scenarios).join(', ')}`);
  let control: Control = await call('/admin/control');
  if (control.activeSessionId) { const current = await call(`/sessions/${control.activeSessionId}/context`); if (current.status !== 'ended') throw new Error('A session is already active. End it explicitly before creating a demo session.'); }
  const session: Session = await call('/admin/sessions', { title: fixture.title, goal: fixture.goal, expectedControlRevision: control.controlRevision });
  await call(`/admin/sessions/${session.id}/lifecycle`, { action: 'start', expectedRevision: session.revision, expectedControlRevision: control.controlRevision });
  control = await call('/admin/control');
  const producer = await call('/admin/producers', { name: 'Synthetic HTTP demo', canAutoPublish: true, allowedSessions: [session.id], allowedOperations: ['update_session','set_now','set_pin','upsert_event','retract_event','upsert_work_item','retract_work_item'], allowedPaths: ['*'], expectedControlRevision: control.controlRevision });
  mkdirSync(dataDir, { recursive: true }); writeFileSync(recordPath, JSON.stringify({ sessionId: session.id, token: producer.token }, null, 2), { mode: 0o600 });
  const current = await call(`/sessions/${session.id}/context`, undefined, producer.token);
  if (fixture.operations.length) {
    const receipt = await call(`/sessions/${session.id}/changes`, draft(current, fixture.operations, 'propose'), producer.token);
    const review = await call(`/admin/proposals/${receipt.proposalId}/preview`);
    await call(`/admin/proposals/${receipt.proposalId}/decision`, {decision:'approve',expectedProposalRevision:review.proposalRevision,expectedRevision:review.sessionRevision});
    console.log('Synthetic demo proposal approved using the operator credential. Source publication policies were not changed.');
  }
  if (fixture.hidden) { control = await call('/admin/control'); await call('/admin/control', { expectedControlRevision: control.controlRevision, mode: 'hidden' }); }
  const urls: Record<string,string> = {};
  for (const preset of ['full','side','lower']) urls[preset] = `${base}/display/main-${preset}`;
  writeFileSync(resolve(dataDir,'demo-outputs.json'), JSON.stringify(urls,null,2), { mode: 0o600 });
  console.log(`Synthetic scenario: ${name}. Output URLs saved privately to ${resolve(dataDir,'demo-outputs.json')}.\nNo AI account is required. Use --exercise for conflict/hold/hidden demonstrations, or --end to finish.`);
}
