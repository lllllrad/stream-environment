import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { Store } from '../src/server/store.ts';
import { Engine } from '../src/domain/engine.ts';
import { createHttp } from '../src/server/http.ts';
import { change, now, event } from './helpers.ts';

async function setupHttp(options: {producerRate?:number;producerBurst?:number} = {}) {
  const store = new Store(':memory:'), engine = new Engine(store), token = 'test-operator-credential-long-enough';
  const app = createHttp(engine, { adminToken: token, heartbeatMs: 100, producerRate: 100, producerBurst: 100, ...options });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const port = (app.server.address() as {port:number}).port, base = `http://127.0.0.1:${port}`;
  const call = async (path: string, data?: any, credential = token, cookie?: string, csrf?: string) => {
    const res = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  const session = engine.createSession({ title: 'HTTP test', goal: 'Test boundaries', expectedControlRevision: 0 });
  engine.lifecycle(session.id, { action: 'start', expectedRevision: 0, expectedControlRevision: 0 });
  const publisher = engine.producer({ name: 'Publisher', canAutoPublish: true, allowedSessions: [session.id], allowedOperations: ['set_now','upsert_event'], allowedPaths: ['/now','/events/*'], expectedControlRevision: 1 });
  return { store, engine, app, base, call, token, session: engine.session(session.id), publisher, close: async () => { await app.close(); store.close(); } };
}
test('HTTP: operator login, CSRF, producer isolation, output-only cookies, per-screen access and Host/Origin checks', async () => {
  const x = await setupHttp();
  try {
    const login = await x.call('/api/v1/admin/login', { token: x.token }, '');
    assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
    const operatorCookie = login.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await x.call('/api/v1/admin/control', { expectedControlRevision: 2, mode: 'hold' }, '', operatorCookie)).status, 403);
    assert.equal((await x.call('/api/v1/admin/control', { expectedControlRevision: 2, mode: 'hold' }, '', operatorCookie, login.body.csrfToken)).status, 200);
    assert.equal((await x.call('/api/v1/admin/state', undefined, x.publisher.token)).status, 403);
    assert.equal((await x.call('/api/v1/admin/control', { mode: 'auto', expectedControlRevision: 3 }, x.publisher.token)).status, 403);
    const out = await x.call('/api/v1/admin/outputs/main-side/rotate-key', { expectedControlRevision: 3 });
    const displayAuth = await x.call('/api/v1/display/main-side/authorize', { key: out.body.key }, '');
    assert.equal(displayAuth.status, 200); assert.match(displayAuth.headers.get('set-cookie')!, /Path=\/api\/v1\/display\/main-side/);
    const displayCookie = displayAuth.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await x.call('/api/v1/display/main-side/snapshot', undefined, '', displayCookie)).status, 200);
    assert.equal((await x.call('/api/v1/display/main-full/snapshot', undefined, '', displayCookie)).status, 401);
    assert.equal((await x.call('/api/v1/admin/state', undefined, '', displayCookie)).status, 401);
    assert.equal((await x.call(`/api/v1/sessions/${x.session.id}/context`, undefined, '', displayCookie)).status, 401);
    const origin = await fetch(x.base + '/health/live', { headers: { Origin: 'https://untrusted.example' } }); assert.equal(origin.status, 403);
    const hostStatus = await new Promise<number>(resolve => { const r = httpRequest(x.base + '/health/live', { headers: { Host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode!); }); r.end(); }); assert.equal(hostStatus, 403);
  } finally { await x.close(); }
});
test('HTTP: public snapshot and SSE contain no proposed content; reconnect sends latest, rotation closes the stream', async () => {
  const x = await setupHttp();
  try {
    const output = x.engine.rotateOutput('main-side', x.engine.control().controlRevision);
    const auth = await x.call('/api/v1/display/main-side/authorize', { key: output.key }, ''); const c = auth.headers.get('set-cookie')!.split(';')[0];
    const proposed = change(x.session, [now('PRIVATE_NOT_PUBLISHED')], { intent: 'propose', provenance: { disclosure: 'restricted', reason: 'PRIVATE_REASON', sourceRefs: ['private:reference'], observedAt: new Date().toISOString() } });
    assert.equal((await x.call(`/api/v1/sessions/${x.session.id}/changes`, proposed, x.publisher.token)).body.outcome, 'proposed');
    const applied = change(x.session, [now('Public activity'), event()]);
    assert.equal((await x.call(`/api/v1/sessions/${x.session.id}/changes`, applied, x.publisher.token)).body.publication, 'published');
    const response = await fetch(x.base + '/api/v1/display/main-side/events', { headers: { Cookie: c, 'Last-Event-ID': '0' } });
    const reader = response.body!.getReader(); const chunk = new TextDecoder().decode((await reader.read()).value);
    assert.match(chunk, /event: snapshot/); assert.match(chunk, /Public activity/); assert.ok(!chunk.includes('PRIVATE_')); assert.ok(!chunk.includes('sourceRefs')); assert.ok(!chunk.includes('actorId'));
    const firstRevision = x.engine.output('main-side').snapshot.publicRevision;
    x.engine.changes(x.publisher.producer, x.session.id, change(x.engine.session(x.session.id), [now('Latest activity')]));
    const next = new TextDecoder().decode((await reader.read()).value); assert.match(next, /Latest activity/); assert.ok(x.engine.output('main-side').snapshot.publicRevision > firstRevision);
    const rotated = await x.call('/api/v1/admin/outputs/main-side/rotate-key', { expectedControlRevision: x.engine.control().controlRevision }); assert.equal(rotated.status, 200);
    let remainder = ''; for (;;) { const part = await reader.read(); if (part.done) break; remainder += new TextDecoder().decode(part.value); }
    assert.match(remainder, /event: revoked/);
    assert.equal((await x.call('/api/v1/display/main-side/snapshot', undefined, '', c)).status, 401);
    assert.equal((await x.call('/api/v1/display/main-side/authorize', { key: output.key }, '')).status, 401);
  } finally { await x.close(); }
});
test('HTTP: JSON/domain errors are structured, body limits and validate side effects are enforced', async () => {
  const x = await setupHttp();
  try {
    const endpoint = `/api/v1/sessions/${x.session.id}/changes`, request = change(x.session, [now()]);
    const before = x.engine.output('main-side');
    const validated = await x.call(endpoint + '/validate', request, x.publisher.token); assert.equal(validated.status, 200); assert.deepEqual(x.engine.output('main-side'), before);
    const bad = await x.call(endpoint, { ...request, operations: [now('x'.repeat(49))] }, x.publisher.token); assert.equal(bad.status, 422); assert.equal(bad.body.error.code, 'SCHEMA_VALIDATION');
    const mismatched = await x.call(endpoint, { ...request, sessionId: 'other' }, x.publisher.token); assert.equal(mismatched.body.error.code, 'SESSION_MISMATCH');
    const large = await x.call(endpoint, { ...request, extra: 'x'.repeat(65536) }, x.publisher.token); assert.equal(large.body.error.code, 'BODY_TOO_LARGE');
    const invalid = await fetch(x.base + endpoint, { method: 'POST', headers: { Authorization: `Bearer ${x.publisher.token}`, 'Content-Type': 'application/json' }, body: '{' }); assert.equal((await invalid.json()).error.code, 'INVALID_JSON');
    const applied = await x.call(endpoint, request, x.publisher.token); assert.equal(applied.body.outcome, 'applied'); assert.deepEqual((await x.call(endpoint, request, x.publisher.token)).body, applied.body);
    assert.equal((await x.call('/health/ready', undefined, '')).status, 200);
  } finally { await x.close(); }
});
test('HTTP: revoked producer is rejected even for a previously successful receipt', async () => {
  const x = await setupHttp();
  try {
    const request = change(x.session, [now()]), endpoint = `/api/v1/sessions/${x.session.id}/changes`;
    assert.equal((await x.call(endpoint, request, x.publisher.token)).status, 200);
    x.engine.revoke(x.publisher.producer.id, x.engine.control().controlRevision);
    assert.equal((await x.call(endpoint, request, x.publisher.token)).status, 401);
  } finally { await x.close(); }
});
test('HTTP: producer token bucket rejects requests above burst quota without changing content', async () => {
  const x = await setupHttp({producerRate:2,producerBurst:2});
  try {
    assert.equal((await x.call('/api/v1/capabilities',undefined,x.publisher.token)).status,200);
    assert.equal((await x.call(`/api/v1/sessions/${x.session.id}/context`,undefined,x.publisher.token)).status,200);
    const rejected=await x.call('/api/v1/producers/heartbeat',{},x.publisher.token);
    assert.equal(rejected.status,429);assert.equal(rejected.body.error.code,'RATE_LIMITED');assert.equal(x.engine.session(x.session.id).revision,x.session.revision);
  } finally {await x.close();}
});
