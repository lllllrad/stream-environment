import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DomainError, ensure } from '../contracts/errors.ts';
import { LIMITS, OPERATIONS, pathAllowed, tokenHash } from '../contracts/validation.ts';
import type { Actor, Control, Output, Proposal, Session } from '../contracts/types.ts';
import { Engine, operator } from '../domain/engine.ts';
import { sessionExport, exportMarkdown } from '../domain/export.ts';
import { widgetCatalog } from '../widgets/registry.ts';
import { RenderService } from './render.ts';
import type { LayoutProposal } from '../contracts/layout-proposals.ts';

type Credential = { role: 'operator'; tokenHash: string; csrf?: string; expiresAt: number };
type Client = { response: ServerResponse; screenId: string };
export type HttpOptions = { adminToken: string; allowedHosts?: string[]; heartbeatMs?: number; producerRate?: number; producerBurst?: number; webDir?: string; port?: number };
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
  const renderer = new RenderService(options.webDir);
  const openapi = JSON.parse(readFileSync(new URL('../../contracts/openapi.json', import.meta.url), 'utf8'));
  const clients = new Set<Client>(), buckets = new Map<string, { tokens: number; at: number }>();
  const stats = { requests: 0, rejected: {} as Record<string, number>, lastRequestMs: 0, totalRequestMs: 0 };
  const adminDigest = tokenHash(options.adminToken), rate = options.producerRate ?? 2, burst = options.producerBurst ?? 10;
  function credential(raw: string | undefined, role: Credential['role']): Credential | undefined {
    if (!raw) return undefined;
    const c = engine.store.get<Credential>(`auth:${tokenHash(raw)}`);
    return c && c.role === role && c.expiresAt > Date.now() ? c : undefined;
  }
  function consume(id:string){
    const now=performance.now(),bucket=buckets.get(id)??{tokens:burst,at:now};
    bucket.tokens=Math.min(burst,bucket.tokens+(now-bucket.at)*rate/1000);bucket.at=now;
    ensure(bucket.tokens>=1,'RATE_LIMITED','Credential request rate exceeded.',429);bucket.tokens--;buckets.set(id,bucket);
  }
  function actor(req: IncomingMessage): { actor: Actor; credential?: Credential } {
    const bearer = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (bearer) {
      const digest = tokenHash(bearer);
      if (equal(digest, adminDigest)) return { actor: operator };
      const producer = engine.store.list<Actor>('producer:').find(a => !a.revoked && a.tokenHash === digest);
      ensure(producer, 'UNAUTHORIZED', 'Credential is invalid or revoked.', 401);
      consume(producer.id);
      return { actor: producer };
    }
    const c = credential(cookie(req, 'operator_session'), 'operator');
    ensure(c, 'UNAUTHORIZED', 'Operator authentication is required.', 401);
    if (req.method !== 'GET') ensure(req.headers['x-csrf-token'] === c.csrf, 'CSRF_REJECTED', 'CSRF token is missing or invalid.', 403);
    return { actor: operator, credential: c };
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
      const output = engine.output(c.screenId);
      if (c.response.writableLength > 262144) { c.response.end(); clients.delete(c); continue; }
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
      // The destination interface is server-owned; never infer trust from client/forwarded headers.
      const localAddress = req.socket.localAddress?.replace(/^::ffff:/, '');
      const localHost = localAddress?.includes(':') ? `[${localAddress}]` : localAddress;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...(localHost ? [`${localHost}:${port}`] : []), ...(options.allowedHosts ?? [])];
      const host = (req.headers.host ?? '').toLowerCase();
      ensure(hosts.includes(host), 'HOST_REJECTED', 'Host must match the server address or an explicitly allowed host.', 403);
      if (req.headers.origin) ensure(req.headers.origin === `http://${host}`, 'ORIGIN_REJECTED', 'Origin must match the request host.', 403);
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`), path = url.pathname;
      const post = req.method === 'POST', get = req.method === 'GET';
      if (get && path === '/openapi.json') return send(res, { ...openapi, servers: [{ url: `http://${host}`, description: 'Dashboard origin used to fetch this specification.' }] });
      if(get&&options.webDir){
        const swaggerAssets:Record<string,[string,string]>={
          '/swagger':['swagger.html','text/html'], '/swagger/':['swagger.html','text/html'],
          '/docs':['swagger.html','text/html'], '/docs/':['swagger.html','text/html'],
          '/swagger/swagger-ui.css':['swagger-ui.css','text/css'],
          '/swagger/swagger-ui-bundle.js':['swagger-ui-bundle.js','text/javascript'],
          '/swagger/init.js':['swagger.js','text/javascript'],
          '/swagger/LICENSE.txt':['swagger-LICENSE.txt','text/plain']
        };
        const asset=swaggerAssets[path];
        if(asset){const bytes=readFileSync(`${options.webDir}/${asset[0]}`);res.writeHead(200,{'Content-Type':`${asset[1]}; charset=utf-8`});res.end(bytes);return;}
      }
      if (get && path === '/health/live') return send(res, { ok: true });
      if (get && path === '/health/ready') { engine.store.db.prepare('SELECT 1').get(); return send(res, { ok: true }); }
      if (post && path === '/api/v1/admin/login') {
        const b = await body(req); fields(b, ['token']); ensure(typeof b.token === 'string' && equal(tokenHash(b.token), adminDigest), 'UNAUTHORIZED', 'Invalid operator credential.', 401);
        const raw = key(), csrf = key(), digest = tokenHash(raw);
        engine.store.put(`auth:${digest}`, { role: 'operator', tokenHash: digest, csrf, expiresAt: Date.now() + 12 * 3600000 });
        res.setHeader('Set-Cookie', `operator_session=${raw}; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=43200`);
        return send(res, { ok: true, csrfToken: csrf });
      }
      const display = path.match(/^\/api\/v1\/display\/([A-Za-z0-9_-]+)\/(snapshot|events)$/);
      if (display) {
        const [, id, action] = display; engine.output(id);
        if (get && action === 'snapshot') { engine.tick(); return send(res, engine.output(id).snapshot); }
        if (get && action === 'events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.flushHeaders();
          // Registration and initial read are synchronous, with no intervening await.
          const client: Client = { response: res, screenId: id };
          clients.add(client); streamSnapshot(client);
          res.on('close', () => clients.delete(client)); return;
        }
        throw new DomainError('NOT_FOUND', 'Endpoint not found.', 404);
      }
      if (path.startsWith('/api/v1/display/')) throw new DomainError('NOT_FOUND', 'Endpoint not found.', 404);
      if(path.startsWith('/api/v1/control/')){
        const bearer=req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];ensure(bearer,'UNAUTHORIZED','A separate direct control bearer token is required.',401);
        const controller=engine.controlCredential(tokenHash(bearer));consume(controller.id);
        if(get&&path==='/api/v1/control/context')return send(res,engine.directContext(controller.id));
        if(post&&path==='/api/v1/control/scene')return send(res,engine.directCommand(controller.id,'scene',await body(req)));
        if(post&&path==='/api/v1/control/widgets')return send(res,engine.directCommand(controller.id,'widget',await body(req)));
        throw new DomainError('NOT_FOUND','Control endpoint not found.',404);
      }
      if (path.startsWith('/api/v1/')) {
        const auth = actor(req); authenticated = auth.actor;
        const isAdmin = path.startsWith('/api/v1/admin/');
        if (isAdmin) ensure(auth.actor.role === 'operator', 'FORBIDDEN', 'Operator permission is required.', 403);
        if (get && path === '/api/v1/capabilities') return send(res, { schemaVersion: '1.0', role: auth.actor.role, operations: auth.actor.role === 'operator' ? OPERATIONS : auth.actor.allowedOperations, allowedPaths: auth.actor.role === 'operator' ? ['*'] : auth.actor.allowedPaths, canAutoPublish: auth.actor.role === 'operator' || auth.actor.canAutoPublish, canProposeLayouts:auth.actor.role==='operator'||auth.actor.canProposeLayouts===true, sourcePolicies:engine.contentSources(), limits: LIMITS, leaseMs: engine.leaseMs });
        if (get && (path === '/api/v1/overlays' || path === '/api/v1/admin/overlays')) return send(res,{config:engine.overlayConfig(),plugins:widgetCatalog(),sources:engine.contentSources()});
        if(get&&path==='/api/v1/sources')return send(res,{sources:engine.contentSources()});
        if(post&&path==='/api/v1/admin/source-policies'){const b=await body(req);fields(b,['expectedControlRevision','sourceId','policy']);return send(res,{sources:engine.setSourcePolicy(b)});}
        if(get&&path==='/api/v1/admin/controllers')return send(res,{items:engine.controllers()});
        if(post&&path==='/api/v1/admin/controllers'){const b=await body(req);fields(b,['expectedControlRevision','name','allowedSceneIds','widgets']);return send(res,engine.registerController(b),201);}
        const controllerRevoke=path.match(/^\/api\/v1\/admin\/controllers\/([A-Za-z0-9_-]+)\/revoke$/);
        if(post&&controllerRevoke){const b=await body(req);fields(b,['expectedControlRevision']);engine.revokeController(controllerRevoke[1],b);return send(res,{ok:true});}
        if(post&&path==='/api/v1/layout-proposals/validate')return send(res,engine.validateLayoutProposal(auth.actor,await body(req)));
        if(post&&path==='/api/v1/layout-proposals')return send(res,engine.proposeLayout(auth.actor,await body(req)));
        const layoutStatus=path.match(/^\/api\/v1\/layout-proposals\/([A-Za-z0-9_-]+)$/);
        if(get&&layoutStatus)return send(res,engine.readLayoutProposal(auth.actor,layoutStatus[1]));
        if(get&&path==='/api/v1/admin/layout-proposals')return send(res,{items:engine.store.list<LayoutProposal>('layout-proposal:').filter(p=>p.status==='pending')});
        const layoutReview=path.match(/^\/api\/v1\/admin\/layout-proposals\/([A-Za-z0-9_-]+)\/(preview|decision)$/);
        if(get&&layoutReview?.[2]==='preview')return send(res,engine.layoutProposalPreview(layoutReview[1]));
        if(post&&layoutReview?.[2]==='decision'){const b=await body(req);fields(b,['decision','expectedProposalRevision','expectedConfigRevision','expectedLayoutRevision','expectedControlRevision','acknowledgeStale','allowDisclosure']);return send(res,engine.layoutDecision(layoutReview[1],b));}
        const renderRoute = path.match(/^\/api\/v1\/sessions\/([A-Za-z0-9_-]+)\/render-preview$/);
        if (post && renderRoute) {const b=await body(req);fields(b,['overlayId','sceneId','change','widgets','includeImage']);ensure(typeof b.overlayId==='string'&&(b.sceneId===undefined||typeof b.sceneId==='string')&&(b.includeImage===undefined||typeof b.includeImage==='boolean'),'SCHEMA_VALIDATION','Invalid render preview options.');return send(res,await renderer.render(engine.renderPreview(auth.actor,renderRoute[1],b),b.includeImage));}
        if (post && path === '/api/v1/admin/layouts/preview') {const b=await body(req);fields(b,['overlayId','sceneId','widgets']);return send(res,engine.layoutPreview(b.overlayId,b.sceneId,b.widgets));}
        if (post && ['/api/v1/admin/overlays','/api/v1/admin/scenes','/api/v1/admin/scene','/api/v1/admin/layouts'].includes(path)) {
          const b=await body(req),actions:Record<string,string>={'/api/v1/admin/overlays':'create_overlay','/api/v1/admin/scenes':'create_scene','/api/v1/admin/scene':'activate_scene','/api/v1/admin/layouts':'save_layout'};
          const allowed:Record<string,string[]>={create_overlay:['expectedRevision','name','width','height'],create_scene:['expectedRevision','name','sourceSceneId'],activate_scene:['expectedRevision','sceneId'],save_layout:['expectedRevision','overlayId','sceneId','widgets']};const action=actions[path];fields(b,allowed[action]);return send(res,engine.updateOverlays({...b,action}));
        }
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
          return send(res, { control, sources:engine.contentSources(), controllers:engine.controllers(), sessions: engine.store.list<Session>('session:').map(s => ({ id: s.id, title: s.title, status: s.status, revision: s.revision, createdAt: s.createdAt })), session: control.activeSessionId ? engine.session(control.activeSessionId) : null, producers: engine.store.list<Actor>('producer:').map(a => ({ ...a, tokenHash: undefined })), outputs: engine.store.list<Output>('output:').filter(o => !o.overlayId).map(o => ({ screenId: o.screenId, preset: o.preset, publicRevision: o.snapshot.publicRevision })), proposals: engine.store.list<Proposal>('proposal:').filter(p => p.status === 'pending'), layoutProposals:engine.store.list<LayoutProposal>('layout-proposal:').filter(p=>p.status==='pending'), audit: engine.store.audits(0, 15), diagnostics: { ...stats, sseConnections: clients.size } });
        }
        if (get && path === '/api/v1/admin/control') return send(res, engine.control());
        if (post && path === '/api/v1/admin/control') { const b = await body(req); fields(b, ['expectedControlRevision','mode','activeSessionId','aiWritesEnabled','confirmRestore']); return send(res, engine.setControl(b)); }
        if (post && path === '/api/v1/admin/sessions') { const b = await body(req); fields(b, ['title','goal','expectedControlRevision']); return send(res, engine.createSession(b), 201); }
        const exportRoute = path.match(/^\/api\/v1\/admin\/sessions\/([A-Za-z0-9_-]+)\/export$/);
        if (get && exportRoute) {
          const format = url.searchParams.get('format') ?? 'json';
          ensure(['json','markdown'].includes(format), 'INVALID_EXPORT_FORMAT', 'Export format must be json or markdown.');
          const record = sessionExport(engine.session(exportRoute[1]), engine.control()), extension = format === 'json' ? 'json' : 'md';
          res.setHeader('Content-Disposition', `attachment; filename="${record.session.id}-r${record.session.revision}.${extension}"`);
          res.writeHead(200, { 'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8' });
          res.end(format === 'json' ? JSON.stringify(record, null, 2) + '\n' : exportMarkdown(record)); return;
        }
        const lifecycle = path.match(/^\/api\/v1\/admin\/sessions\/([A-Za-z0-9_-]+)\/(lifecycle|select-work|purge)$/);
        if (post && lifecycle) {
          const b = await body(req), [, id, action] = lifecycle;
          if (action === 'lifecycle') { fields(b, ['action','expectedRevision','expectedControlRevision']); return send(res, engine.lifecycle(id, b)); }
          if (action === 'select-work') { fields(b, ['workItemId','expectedRevision']); return send(res, engine.selectWork(id, b)); }
          fields(b, ['expectedRevision','expectedControlRevision','confirm']); engine.purgeSession(id, b); return send(res, { ok: true });
        }
        if (post && path === '/api/v1/admin/locks') { const b = await body(req); fields(b, ['sessionId','path','locked','expectedRevision','reason']); return send(res, engine.locks(b)); }
        if (get && path === '/api/v1/admin/proposals') return send(res, { items: engine.store.list<Proposal>('proposal:').filter(p => p.status === 'pending') });
        const proposalPreview = path.match(/^\/api\/v1\/admin\/proposals\/([A-Za-z0-9_-]+)\/preview$/);
        if (get && proposalPreview) return send(res, engine.proposalPreview(proposalPreview[1], url.searchParams.get('screenId') ?? 'main-full',url.searchParams.get('sceneId')??undefined));
        const proposal = path.match(/^\/api\/v1\/admin\/proposals\/([A-Za-z0-9_-]+)\/decision$/);
        if (post && proposal) { const b = await body(req); fields(b, ['decision','expectedProposalRevision','expectedRevision','acknowledgeStale','allowDisclosure']); return send(res, engine.decision(proposal[1], b)); }
        if (get && path === '/api/v1/admin/preview') return send(res, engine.preview(url.searchParams.get('screenId') ?? 'main-side'));
        if (get && path === '/api/v1/admin/audit') { const items = engine.store.audits(pageNumber(url.searchParams.get('cursor'), 0)); return send(res, { items, nextCursor: items.length === 30 ? items.at(-1)!.id : null }); }
        const undo = path.match(/^\/api\/v1\/admin\/audit\/(\d+)\/undo$/);
        if (post && undo) { const b = await body(req); fields(b, ['expectedRevision']); return send(res, engine.undo(Number(undo[1]), b.expectedRevision)); }
        const layoutGrant=path.match(/^\/api\/v1\/admin\/producers\/([A-Za-z0-9_-]+)\/layout-grant$/);
        if(post&&layoutGrant){const b=await body(req);fields(b,['expectedControlRevision','canProposeLayouts']);return send(res,engine.setLayoutGrant(layoutGrant[1],b));}
        if (post && path === '/api/v1/admin/producers') { const b = await body(req); fields(b, ['name','expectedControlRevision','canAutoPublish','allowedSessions','allowedOperations','allowedPaths','canEditOthers','canProposeLayouts']); return send(res, engine.producer(b), 201); }
        const revoke = path.match(/^\/api\/v1\/admin\/producers\/([A-Za-z0-9_-]+)\/revoke$/);
        if (post && revoke) { const b = await body(req); fields(b, ['expectedControlRevision']); engine.revoke(revoke[1], b.expectedControlRevision); return send(res, { ok: true }); }
        throw new DomainError('NOT_FOUND', 'Endpoint not found.', 404);
      }
      if (get && options.webDir) {
        const assets: Record<string, [string, string]> = { '/': ['admin.html','text/html'], '/admin': ['admin.html','text/html'], '/admin.js': ['admin.js','text/javascript'], '/admin.css': ['admin.css','text/css'], '/display.js': ['display.js','text/javascript'], '/display.css': ['display.css','text/css'] };
        const outputPage = path.match(/^\/display\/([A-Za-z0-9_-]+)$/);
        if (outputPage) engine.output(outputPage[1]);
        const asset = outputPage ? ['display.html','text/html'] : assets[path];
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
  return { server, clients, stats, close: async () => { clearInterval(timer); for (const c of clients) c.response.end(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await renderer.close(); } };
}
