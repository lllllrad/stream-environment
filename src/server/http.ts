import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DomainError, ensure } from '../contracts/errors.ts';
import { LIMITS, OPERATIONS, pathAllowed, tokenHash } from '../contracts/validation.ts';
import type { Actor, Control, Output, Proposal, Session } from '../contracts/types.ts';
import { Engine, operator } from '../domain/engine.ts';

type Credential = { role: 'operator' | 'display'; tokenHash: string; csrf?: string; screenId?: string; generation?: number; expiresAt: number };
type Client = { response: ServerResponse; screenId: string; credentialHash: string; generation: number };
export type HttpOptions = { adminToken: string; heartbeatMs?: number; producerRate?: number; producerBurst?: number; webDir?: string; port?: number };
const key = () => randomBytes(32).toString('base64url');
function equal(a: string, b: string): boolean { return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
function cookie(req: IncomingMessage, name: string): string | undefined { return req.headers.cookie?.split(';').map(p => p.trim().split('=')).find(([k]) => k === name)?.[1]; }
function send(res: ServerResponse, data: unknown, status = 200): void { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
function fields(body: any, allowed: string[]): void { ensure(body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(k => allowed.includes(k)), 'SCHEMA_VALIDATION', 'Request has unexpected fields or is not an object.'); }
async function body(req: IncomingMessage): Promise<any> {
  ensure(req.headers['content-type']?.split(';')[0] === 'application/json', 'CONTENT_TYPE_REQUIRED', 'Send application/json.', 422);
  let size = 0; const parts: Buffer[] = [];
  for await (const part of req) { size += part.length; ensure(size <= LIMITS.maxBytes, 'BODY_TOO_LARGE', 'Request exceeds 64 KiB.', 422); parts.push(part); }
  try { const value = JSON.parse(Buffer.concat(parts).toString('utf8')); ensure(value && typeof value === 'object' && !Array.isArray(value), 'SCHEMA_VALIDATION', 'Expected a JSON object.'); return value; }
  catch (error) { if (error instanceof DomainError) throw error; throw new DomainError('INVALID_JSON', 'Request body is not valid JSON.'); }
}
function pageNumber(value: string | null, fallback: number): number { if (!value) return fallback; ensure(/^\d+$/.test(value) && Number.isSafeInteger(Number(value)), 'INVALID_CURSOR', 'Cursor must be a nonnegative integer.'); return Number(value); }

export function createHttp(engine: Engine, options: HttpOptions) {
  const clients = new Set<Client>(), buckets = new Map<string, { tokens: number; at: number }>();
  const stats = { requests: 0, rejected: {} as Record<string, number>, lastRequestMs: 0, totalRequestMs: 0 };
  const adminDigest = tokenHash(options.adminToken), rate = options.producerRate ?? 2, burst = options.producerBurst ?? 10;
  function credential(raw: string | undefined, role: Credential['role']): Credential | undefined {
    if (!raw) return undefined;
    const c = engine.store.get<Credential>(`auth:${tokenHash(raw)}`);
    return c && c.role === role && c.expiresAt > Date.now() ? c : undefined;
  }
  function actor(req: IncomingMessage): { actor: Actor; credential?: Credential } {
    const bearer = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (bearer) {
      const digest = tokenHash(bearer);
      if (equal(digest, adminDigest)) return { actor: operator };
      const producer = engine.store.list<Actor>('producer:').find(a => !a.revoked && a.tokenHash === digest);
      ensure(producer, 'UNAUTHORIZED', 'Credential is invalid or revoked.', 401);
      const now = performance.now(), bucket = buckets.get(producer.id) ?? { tokens: burst, at: now };
      bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.at) * rate / 1000); bucket.at = now;
      ensure(bucket.tokens >= 1, 'RATE_LIMITED', 'Producer request rate exceeded.', 429);
      bucket.tokens--; buckets.set(producer.id, bucket);
      return { actor: producer };
    }
    const c = credential(cookie(req, 'operator_session'), 'operator');
    ensure(c, 'UNAUTHORIZED', 'Operator authentication is required.', 401);
    if (req.method !== 'GET') ensure(req.headers['x-csrf-token'] === c.csrf, 'CSRF_REJECTED', 'CSRF token is missing or invalid.', 403);
    return { actor: operator, credential: c };
  }
  function displayCredential(req: IncomingMessage, screenId: string): Credential {
    const c = credential(cookie(req, 'display_session'), 'display'), output = engine.output(screenId);
    ensure(c && c.screenId === screenId && c.generation === output.generation, 'UNAUTHORIZED', 'Output credential is invalid, expired, or belongs to another screen.', 401);
    return c;
  }
  function streamSnapshot(client: Client): void {
    if (client.response.writableLength > 262144) { client.response.end(); return; }
    const snapshot = engine.output(client.screenId).snapshot;
    client.response.write(`id: ${snapshot.publicRevision}\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
  }
  engine.onPublish = ids => { for (const c of clients) if (ids.includes(c.screenId)) streamSnapshot(c); };
  const timer = setInterval(() => {
    try {
    engine.tick();
    for (const c of clients) {
      const auth = engine.store.get<Credential>(`auth:${c.credentialHash}`), output = engine.output(c.screenId);
      if (!auth || auth.expiresAt <= Date.now() || output.generation !== c.generation || c.response.writableLength > 262144) { c.response.write('event: revoked\ndata: {}\n\n'); c.response.end(); clients.delete(c); continue; }
      c.response.write(`event: heartbeat\ndata: ${JSON.stringify({ publicRevision: output.snapshot.publicRevision, leaseMs: engine.leaseMs })}\n\n`);
    }
    for (const c of engine.store.list<Credential>('auth:')) if (c.expiresAt <= Date.now()) engine.store.delete(`auth:${c.tokenHash}`);
    } catch { stats.rejected.SERVICE_UNAVAILABLE = (stats.rejected.SERVICE_UNAVAILABLE ?? 0) + 1; }
  }, options.heartbeatMs ?? 5000);
  timer.unref();
  const server = createServer(async (req, res) => {
    const began = performance.now(); let authenticated: Actor | undefined;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");
    try {
      const address = server.address(); const port = typeof address === 'object' && address ? address.port : options.port ?? 4310;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      ensure(hosts.includes(req.headers.host ?? ''), 'HOST_REJECTED', 'Host is not allowed for this local server.', 403);
      if (req.headers.origin) ensure(hosts.map(h => `http://${h}`).includes(req.headers.origin), 'ORIGIN_REJECTED', 'Origin is not allowed.', 403);
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`), path = url.pathname;
      const post = req.method === 'POST', get = req.method === 'GET';
      if (get && path === '/health/live') return send(res, { ok: true });
      if (get && path === '/health/ready') { engine.store.db.prepare('SELECT 1').get(); return send(res, { ok: true }); }
      if (post && path === '/api/v1/admin/login') {
        const b = await body(req); fields(b, ['token']); ensure(typeof b.token === 'string' && equal(tokenHash(b.token), adminDigest), 'UNAUTHORIZED', 'Invalid operator credential.', 401);
        const raw = key(), csrf = key(), digest = tokenHash(raw);
        engine.store.put(`auth:${digest}`, { role: 'operator', tokenHash: digest, csrf, expiresAt: Date.now() + 12 * 3600000 });
        res.setHeader('Set-Cookie', `operator_session=${raw}; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=43200`);
        return send(res, { ok: true, csrfToken: csrf });
      }
      const display = path.match(/^\/api\/v1\/display\/([A-Za-z0-9_-]+)\/(authorize|snapshot|events)$/);
      if (display) {
        const [, id, action] = display, output = engine.output(id);
        if (post && action === 'authorize') {
          const b = await body(req); fields(b, ['key']); ensure(typeof b.key === 'string' && equal(tokenHash(b.key), output.keyHash), 'UNAUTHORIZED', 'Invalid output key.', 401);
          const raw = key(), digest = tokenHash(raw);
          engine.store.put(`auth:${digest}`, { role: 'display', tokenHash: digest, screenId: id, generation: output.generation, expiresAt: Date.now() + 14 * 86400000 });
          res.setHeader('Set-Cookie', `display_session=${raw}; HttpOnly; SameSite=Strict; Path=/api/v1/display/${id}; Max-Age=1209600`);
          return send(res, { ok: true });
        }
        const c = displayCredential(req, id);
        if (get && action === 'snapshot') { engine.tick(); return send(res, engine.output(id).snapshot); }
        if (get && action === 'events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.flushHeaders();
          // Registration and initial read are synchronous, with no intervening await.
          const client: Client = { response: res, screenId: id, credentialHash: c.tokenHash, generation: output.generation };
          clients.add(client); streamSnapshot(client);
          res.on('close', () => clients.delete(client)); return;
        }
        throw new DomainError('NOT_FOUND', 'Endpoint not found.', 404);
      }
      if (path.startsWith('/api/v1/')) {
        const auth = actor(req); authenticated = auth.actor;
        const isAdmin = path.startsWith('/api/v1/admin/');
        if (isAdmin) ensure(auth.actor.role === 'operator', 'FORBIDDEN', 'Operator permission is required.', 403);
        if (get && path === '/api/v1/capabilities') return send(res, { schemaVersion: '1.0', operations: auth.actor.role === 'operator' ? OPERATIONS : auth.actor.allowedOperations, allowedPaths: auth.actor.role === 'operator' ? ['*'] : auth.actor.allowedPaths, canAutoPublish: auth.actor.role === 'operator' || auth.actor.canAutoPublish, limits: LIMITS, leaseMs: engine.leaseMs });
        if (get && path === '/api/v1/sessions/current') {
          const c = engine.control(); const s = c.activeSessionId ? engine.readSession(auth.actor, c.activeSessionId) : null;
          return send(res, { session: s ? { id: s.id, status: s.status, revision: s.revision } : null });
        }
        if (post && path === '/api/v1/producers/heartbeat') {
          ensure(auth.actor.role === 'producer', 'FORBIDDEN', 'This endpoint is for producers.', 403);
          const b = await body(req); fields(b, []);
          engine.store.put(`producer:${auth.actor.id}`, { ...auth.actor, lastSeenAt: new Date().toISOString() }); return send(res, { ok: true });
        }
        const sessionRoute = path.match(/^\/api\/v1\/sessions\/([A-Za-z0-9_-]+)\/(context|events|changes(?:\/validate)?)$/);
        if (sessionRoute) {
          const [, id, action] = sessionRoute;
          if (get && action === 'context') return send(res, engine.context(auth.actor, id));
          if (get && action === 'events') {
            const s = engine.readSession(auth.actor, id), cursor = pageNumber(url.searchParams.get('cursor'), 0);
            const allowed = s.events.filter(e => auth.actor.role === 'operator' || pathAllowed(`/events/${e.id}`, auth.actor.allowedPaths));
            const items = allowed.slice(cursor, cursor + 30).map(e => ({ id: e.id, kind: e.kind, text: e.text, occurredAt: e.occurredAt, certainty: e.certainty, retractedAt: e.retractedAt }));
            return send(res, { items, nextCursor: cursor + 30 < allowed.length ? cursor + 30 : null });
          }
          if (post && action.startsWith('changes')) { const b = await body(req); return send(res, action.endsWith('validate') ? engine.validate(auth.actor, id, b) : engine.changes(auth.actor, id, b)); }
        }
        if (get && path === '/api/v1/admin/me') return send(res, { ok: true, csrfToken: auth.credential?.csrf ?? null });
        if (post && path === '/api/v1/admin/logout') { const raw = cookie(req, 'operator_session'); if (raw) engine.store.delete(`auth:${tokenHash(raw)}`); res.setHeader('Set-Cookie', 'operator_session=; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=0'); return send(res, { ok: true }); }
        if (get && path === '/api/v1/admin/state') {
          const control = engine.control();
          return send(res, { control, sessions: engine.store.list<Session>('session:').map(s => ({ id: s.id, title: s.title, status: s.status, revision: s.revision, createdAt: s.createdAt })), session: control.activeSessionId ? engine.session(control.activeSessionId) : null, producers: engine.store.list<Actor>('producer:').map(a => ({ ...a, tokenHash: undefined })), outputs: engine.store.list<Output>('output:').map(o => ({ screenId: o.screenId, preset: o.preset, generation: o.generation, publicRevision: o.snapshot.publicRevision })), proposals: engine.store.list<Proposal>('proposal:').filter(p => p.status === 'pending'), audit: engine.store.audits(0, 15), diagnostics: { ...stats, sseConnections: clients.size } });
        }
        if (get && path === '/api/v1/admin/control') return send(res, engine.control());
        if (post && path === '/api/v1/admin/control') { const b = await body(req); fields(b, ['expectedControlRevision','mode','activeSessionId','aiWritesEnabled','confirmRestore']); return send(res, engine.setControl(b)); }
        if (post && path === '/api/v1/admin/sessions') { const b = await body(req); fields(b, ['title','goal','expectedControlRevision']); return send(res, engine.createSession(b), 201); }
        const lifecycle = path.match(/^\/api\/v1\/admin\/sessions\/([A-Za-z0-9_-]+)\/(lifecycle|select-work|purge)$/);
        if (post && lifecycle) {
          const b = await body(req), [, id, action] = lifecycle;
          if (action === 'lifecycle') { fields(b, ['action','expectedRevision','expectedControlRevision']); return send(res, engine.lifecycle(id, b)); }
          if (action === 'select-work') { fields(b, ['workItemId','expectedRevision']); return send(res, engine.selectWork(id, b)); }
          fields(b, ['expectedRevision','expectedControlRevision','confirm']); engine.purgeSession(id, b); return send(res, { ok: true });
        }
        if (post && path === '/api/v1/admin/locks') { const b = await body(req); fields(b, ['sessionId','path','locked','expectedRevision','reason']); return send(res, engine.locks(b)); }
        if (get && path === '/api/v1/admin/proposals') return send(res, { items: engine.store.list<Proposal>('proposal:').filter(p => p.status === 'pending') });
        const proposal = path.match(/^\/api\/v1\/admin\/proposals\/([A-Za-z0-9_-]+)\/decision$/);
        if (post && proposal) { const b = await body(req); fields(b, ['decision','expectedProposalRevision','expectedRevision','acknowledgeStale','allowDisclosure']); return send(res, engine.decision(proposal[1], b)); }
        if (get && path === '/api/v1/admin/preview') return send(res, engine.preview(url.searchParams.get('screenId') ?? 'main-side'));
        if (get && path === '/api/v1/admin/audit') { const items = engine.store.audits(pageNumber(url.searchParams.get('cursor'), 0)); return send(res, { items, nextCursor: items.length === 30 ? items.at(-1)!.id : null }); }
        const undo = path.match(/^\/api\/v1\/admin\/audit\/(\d+)\/undo$/);
        if (post && undo) { const b = await body(req); fields(b, ['expectedRevision']); return send(res, engine.undo(Number(undo[1]), b.expectedRevision)); }
        if (post && path === '/api/v1/admin/producers') { const b = await body(req); fields(b, ['name','expectedControlRevision','canAutoPublish','allowedSessions','allowedOperations','allowedPaths','canEditOthers']); return send(res, engine.producer(b), 201); }
        const revoke = path.match(/^\/api\/v1\/admin\/producers\/([A-Za-z0-9_-]+)\/revoke$/);
        if (post && revoke) { const b = await body(req); fields(b, ['expectedControlRevision']); engine.revoke(revoke[1], b.expectedControlRevision); return send(res, { ok: true }); }
        const rotate = path.match(/^\/api\/v1\/admin\/outputs\/([A-Za-z0-9_-]+)\/rotate-key$/);
        if (post && rotate) {
          const b = await body(req); fields(b, ['expectedControlRevision']); const result = engine.rotateOutput(rotate[1], b.expectedControlRevision);
          for (const c of clients) if (c.screenId === rotate[1]) { c.response.write('event: revoked\ndata: {}\n\n'); c.response.end(); clients.delete(c); }
          for (const c of engine.store.list<Credential>('auth:')) if (c.role === 'display' && c.screenId === rotate[1]) engine.store.delete(`auth:${c.tokenHash}`);
          return send(res, result);
        }
        throw new DomainError('NOT_FOUND', 'Endpoint not found.', 404);
      }
      if (get && options.webDir) {
        const assets: Record<string, [string, string]> = { '/': ['admin.html','text/html'], '/admin': ['admin.html','text/html'], '/admin.js': ['admin.js','text/javascript'], '/admin.css': ['admin.css','text/css'], '/display.js': ['display.js','text/javascript'], '/display.css': ['display.css','text/css'] };
        const asset = /^\/display\/main-(full|side|lower)$/.test(path) ? ['display.html','text/html'] : assets[path];
        if (asset) { const bytes = readFileSync(`${options.webDir}/${asset[0]}`); res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` }); res.end(bytes); return; }
      }
      throw new DomainError('NOT_FOUND', 'Page not found.', 404);
    } catch (error) {
      const failure = error instanceof DomainError ? error : new DomainError('SERVICE_UNAVAILABLE', 'The command could not be saved. Retry after checking server readiness.', 503);
      stats.rejected[failure.code] = (stats.rejected[failure.code] ?? 0) + 1;
      if (authenticated?.role === 'producer') {
        try { engine.store.put(`producer:${authenticated.id}`, { ...engine.actor(authenticated.id), lastSeenAt: new Date().toISOString(), lastError: failure.code }); } catch { /* Storage may be unavailable. */ }
      }
      if (!res.headersSent) send(res, failure.toJSON(), failure.status); else res.end();
    } finally { const elapsed = performance.now() - began; stats.requests++; stats.lastRequestMs = elapsed; stats.totalRequestMs += elapsed; }
  });
  return { server, clients, stats, close: async () => { clearInterval(timer); for (const c of clients) c.response.end(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
