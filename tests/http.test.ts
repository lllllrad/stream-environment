import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { Store } from '../src/server/store.ts';
import { Engine } from '../src/domain/engine.ts';
import { createHttp } from '../src/server/http.ts';
import { change, now, event } from './helpers.ts';

async function setupHttp(options: {producerRate?:number;producerBurst?:number;allowedHosts?:string[];bindAddress?:string} = {}) {
  const store = new Store(':memory:'), engine = new Engine(store), token = 'test-operator-credential-long-enough';
  const { bindAddress = '127.0.0.1', ...httpOptions } = options;
  const app = createHttp(engine, { adminToken: token, heartbeatMs: 100, producerRate: 100, producerBurst: 100, ...httpOptions });
  await new Promise<void>(resolve => app.server.listen(0, bindAddress, resolve));
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
test('HTTP: operator login, CSRF, producer isolation, anonymous public outputs, protected private APIs and Host/Origin checks', async () => {
  const x = await setupHttp();
  try {
    const login = await x.call('/api/v1/admin/login', { token: x.token }, '');
    assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
    const operatorCookie = login.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await x.call('/api/v1/admin/control', { expectedControlRevision: 2, mode: 'hold' }, '', operatorCookie)).status, 403);
    assert.equal((await x.call('/api/v1/admin/control', { expectedControlRevision: 2, mode: 'hold' }, '', operatorCookie, login.body.csrfToken)).status, 200);
    assert.equal((await x.call('/api/v1/admin/state', undefined, x.publisher.token)).status, 403);
    assert.equal((await x.call('/api/v1/admin/control', { mode: 'auto', expectedControlRevision: 3 }, x.publisher.token)).status, 403);
    for (const screen of ['main-side','main-full','main-lower']) {
      const snapshot = await x.call(`/api/v1/display/${screen}/snapshot`, undefined, '');
      assert.equal(snapshot.status, 200); assert.equal(snapshot.headers.get('set-cookie'), null);
      assert.equal(snapshot.body.screenId, screen);
    }
    assert.equal((await x.call('/api/v1/admin/state', undefined, '')).status, 401);
    assert.equal((await x.call(`/api/v1/sessions/${x.session.id}/context`, undefined, '')).status, 401);
    assert.equal((await x.call('/api/v1/display/main-side/snapshot', {}, '')).status, 404);
    assert.equal((await x.call('/api/v1/display/main-side/authorize', { key: 'legacy' }, '')).status, 404);
    assert.equal((await x.call('/api/v1/display/missing/snapshot', undefined, '')).status, 404);
    const origin = await fetch(x.base + '/health/live', { headers: { Origin: 'https://untrusted.example' } }); assert.equal(origin.status, 403);
    const hostStatus = await new Promise<number>(resolve => { const r = httpRequest(x.base + '/health/live', { headers: { Host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode!); }); r.end(); }); assert.equal(hostStatus, 403);
  } finally { await x.close(); }
});
test('HTTP: network interface and configured DNS hosts support authenticated producers while rejecting foreign origins and hosts', async () => {
  const x = await setupHttp({ bindAddress: '0.0.0.0', allowedHosts: ['stream-pc:4310'] });
  try {
    assert.equal((x.app.server.address() as {address:string}).address, '0.0.0.0');
    const base = x.base.replace('127.0.0.1', '127.0.0.2');
    const request = async (path: string, headers: Record<string,string> = {}, data?: object) => {
      const response = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { ...headers, ...(data ? {'Content-Type':'application/json'} : {}) }, body: data ? JSON.stringify(data) : undefined });
      return { status: response.status, body: await response.json(), headers: response.headers };
    };
    // fetch normalizes Host; use the native client to exercise actual Host headers.
    const hostRequest = (headers: Record<string,string>) => new Promise<{status:number;body:any}>((resolve, reject) => {
      const req = httpRequest(base + '/health/live', {headers}, async response => {
        try {
          const parts: Buffer[] = [];
          for await (const part of response) parts.push(part);
          resolve({status:response.statusCode!, body:JSON.parse(Buffer.concat(parts).toString('utf8'))});
        } catch (error) { reject(error); }
      });
      req.on('error', reject); req.end();
    });
    assert.equal((await request('/health/live', {Origin:base})).status, 200);
    assert.equal((await request('/api/v1/capabilities')).status, 401);
    assert.equal((await request('/api/v1/capabilities', {Authorization:`Bearer ${x.publisher.token}`})).body.role, 'producer');
    const changeRequest = change(x.session, [now('Network producer content')]);
    assert.equal((await request(`/api/v1/sessions/${x.session.id}/changes`, {Authorization:`Bearer ${x.publisher.token}`}, changeRequest)).body.outcome, 'applied');
    const snapshot = await request('/api/v1/display/main-full/snapshot');
    assert.equal(snapshot.status, 200); assert.equal(snapshot.body.content.now.title, 'Network producer content');
    assert.equal(snapshot.headers.get('access-control-allow-origin'), null);
    assert.equal((await hostRequest({Host:'stream-pc:4310', Origin:'http://stream-pc:4310'})).status, 200);
    assert.equal((await hostRequest({Host:'unconfigured.example:4310'})).body.error.code, 'HOST_REJECTED');
    assert.equal((await request('/health/live', {Origin:x.base})).body.error.code, 'ORIGIN_REJECTED');
    assert.equal((await request('/health/live', {Origin:'https://untrusted.example'})).body.error.code, 'ORIGIN_REJECTED');
    assert.equal((await hostRequest({Host:'untrusted.example', 'X-Forwarded-Host':new URL(base).host})).body.error.code, 'HOST_REJECTED');
    const login = await request('/api/v1/admin/login', {Origin:base}, {token:x.token});
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await request('/api/v1/admin/control', {Cookie:cookie, Origin:base}, {mode:'hold', expectedControlRevision:x.engine.control().controlRevision})).body.error.code, 'CSRF_REJECTED');
  } finally { await x.close(); }
});

test('HTTP: public snapshot and SSE contain no proposed content; reconnect sends latest and emergency hide clears the stream', async () => {
  const x = await setupHttp();
  try {
    const proposed = change(x.session, [now('PRIVATE_NOT_PUBLISHED')], { intent: 'propose', provenance: { disclosure: 'restricted', reason: 'PRIVATE_REASON', sourceRefs: ['private:reference'], observedAt: new Date().toISOString() } });
    assert.equal((await x.call(`/api/v1/sessions/${x.session.id}/changes`, proposed, x.publisher.token)).body.outcome, 'proposed');
    const applied = change(x.session, [now('Public activity'), event()]);
    assert.equal((await x.call(`/api/v1/sessions/${x.session.id}/changes`, applied, x.publisher.token)).body.publication, 'published');
    const response = await fetch(x.base + '/api/v1/display/main-side/events', { headers: { 'Last-Event-ID': '0' } });
    const reader = response.body!.getReader(); const chunk = new TextDecoder().decode((await reader.read()).value);
    assert.match(chunk, /event: snapshot/); assert.match(chunk, /Public activity/); assert.ok(!chunk.includes('PRIVATE_')); assert.ok(!chunk.includes('sourceRefs')); assert.ok(!chunk.includes('actorId'));
    const firstRevision = x.engine.output('main-side').snapshot.publicRevision;
    x.engine.changes(x.publisher.producer, x.session.id, change(x.engine.session(x.session.id), [now('Latest activity')]));
    const next = new TextDecoder().decode((await reader.read()).value); assert.match(next, /Latest activity/); assert.ok(x.engine.output('main-side').snapshot.publicRevision > firstRevision);
    x.engine.setControl({ mode: 'hidden', expectedControlRevision: x.engine.control().controlRevision });
    const hidden = new TextDecoder().decode((await reader.read()).value);
    assert.match(hidden, /"mode":"hidden"/); assert.match(hidden, /"content":null/);
    await reader.cancel();
    const reconnect = await fetch(x.base + '/api/v1/display/main-side/events', { headers: { 'Last-Event-ID': '0' } });
    const latest = reconnect.body!.getReader();
    const initial = new TextDecoder().decode((await latest.read()).value);
    assert.match(initial, /"mode":"hidden"/); assert.ok(!initial.includes('Public activity')); assert.ok(!initial.includes('PRIVATE_'));
    await latest.cancel();
    assert.equal((await x.call('/api/v1/display/main-side/snapshot', undefined, '')).body.content, null);
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
test('HTTP: rendered proposal preview is operator-only, read-only and absent from anonymous display streams', async () => {
  const x = await setupHttp();
  try {
    const request = change(x.session, [now('PRIVATE_PREVIEW_TEXT')], { intent: 'propose', provenance: { disclosure: 'unknown', observedAt: new Date().toISOString(), sourceRefs: [], reason: 'PRIVATE_REASON' } });
    const receipt = (await x.call(`/api/v1/sessions/${x.session.id}/changes`, request, x.publisher.token)).body;
    const path = `/api/v1/admin/proposals/${receipt.proposalId}/preview?screenId=main-full`;
    assert.equal((await x.call(path, undefined, '')).status, 401); assert.equal((await x.call(path, undefined, x.publisher.token)).status, 403);
    const before = x.engine.session(x.session.id), preview = await x.call(path);
    assert.equal(preview.status, 200); assert.equal(preview.body.after.content.now.title, 'PRIVATE_PREVIEW_TEXT');
    assert.deepEqual(x.engine.session(x.session.id), before);
    assert.ok(!JSON.stringify((await x.call('/api/v1/display/main-full/snapshot', undefined, '')).body).includes('PRIVATE_'));
    assert.equal((await x.call(path.replace('main-full','missing'))).status, 404);
  } finally { await x.close(); }
});
