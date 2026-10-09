import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Client, type CallToolResult } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { Store } from '../src/server/store.ts';
import { Engine, operator } from '../src/domain/engine.ts';
import { createHttp } from '../src/server/http.ts';
import { createDashboardMcp, dashboardUrl } from '../src/integrations/mcp.ts';
import { change, now } from './helpers.ts';

async function fixture(canAutoPublish = false) {
  const store = new Store(':memory:'), engine = new Engine(store), adminToken = 'mcp-test-operator-token-long-enough';
  const app = createHttp(engine, { adminToken, heartbeatMs: 100, producerRate: 100, producerBurst: 100 });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const session = engine.createSession({ title: 'Content proposal test', goal: 'Review external display wording', expectedControlRevision: 0 });
  engine.lifecycle(session.id, { action: 'start', expectedRevision: 0, expectedControlRevision: 0 });
  const issued = engine.producer({ name: 'External content system', canAutoPublish, allowedSessions: [session.id], allowedOperations: ['set_now','update_session','set_pin','upsert_event'], allowedPaths: ['/now','/session/recap','/pin','/events/*'], expectedControlRevision: 1 });
  const connect = async (token = issued.token) => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('scripts/mcp.ts')], env: { ...getDefaultEnvironment(), DASHBOARD_URL: base, DASHBOARD_PRODUCER_TOKEN: token }, stderr: 'pipe' });
    let stderr = ''; transport.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    const client = new Client({ name: 'integration-test', version: '1.0.0' });
    await client.connect(transport);
    const call = (name: string, args: object = {}) => client.callTool({ name, arguments: args as Record<string, unknown> }) as Promise<CallToolResult>;
    return { client, call, stderr: () => stderr };
  };
  return { store, engine, app, base, issued, session: engine.session(session.id), adminToken, connect, close: async () => { if (app.server.listening) await app.close(); store.close(); } };
}
const data = (result: CallToolResult) => result.structuredContent as any;

test('MCP stdio: discover content tools, validate/propose actual display wording, approve, publish and replay receipt', async () => {
  const x = await fixture(), mcp = await x.connect();
  try {
    const tools = await mcp.client.listTools();
    assert.deepEqual(tools.tools.map(t => t.name).sort(), ['apply','get_capabilities','get_context','heartbeat','propose','validate']);
    const proposedSchema = tools.tools.find(t => t.name === 'propose')!.inputSchema;
    assert.deepEqual((proposedSchema.properties as any).intent, { const: 'propose' });
    const capabilities = data(await mcp.call('get_capabilities'));
    assert.equal(capabilities.role, 'producer'); assert.equal(capabilities.canAutoPublish, false);
    assert.equal(capabilities.limits.sessionTitle, 120); assert.equal(capabilities.limits.goal, 300);
    const context = data(await mcp.call('get_context')).session;
    assert.equal(context.id, x.session.id); assert.equal(context.title, undefined); assert.equal(context.goal, undefined);
    const command = change(x.session, [now('Content suggested by another system'), { op: 'update_session', fields: { recap: ['External systems can suggest actual broadcast text.'] } }, { op: 'set_pin', value: { text: 'Review complete; viewer notice', expiresAt: null } }], { intent: 'propose', provenance: { disclosure: 'restricted', observedAt: new Date().toISOString(), sourceRefs: ['private:opaque-ref'], reason: 'PRIVATE_OPERATOR_REVIEW' } });
    const before = x.engine.output('main-full'), validated = await mcp.call('validate', command);
    assert.ok(!validated.isError); assert.equal(data(validated).after.now.title, 'Content suggested by another system');
    assert.deepEqual(x.engine.output('main-full'), before); assert.equal(x.store.list('proposal:').length, 0);
    const submitted = await mcp.call('propose', command), receipt = data(submitted);
    assert.ok(!submitted.isError); assert.equal(receipt.outcome, 'proposed'); assert.equal(receipt.publication, 'not_applicable');
    assert.equal(x.engine.session(x.session.id).revision, x.session.revision);
    const anonymous = await fetch(`${x.base}/api/v1/display/main-full/snapshot`).then(r => r.json());
    assert.ok(!JSON.stringify(anonymous).includes('suggested')); assert.ok(!JSON.stringify(anonymous).includes('PRIVATE_'));
    x.engine.decision(receipt.proposalId, { decision: 'approve', expectedProposalRevision: 0, expectedRevision: x.session.revision, allowDisclosure: true });
    const published = await fetch(`${x.base}/api/v1/display/main-full/snapshot`).then(r => r.json());
    assert.equal(published.content.now.title, command.operations[0].op === 'set_now' ? command.operations[0].value?.title : null);
    assert.deepEqual(published.content.recap, ['External systems can suggest actual broadcast text.']);
    assert.equal(published.content.pin.text, 'Review complete; viewer notice'); assert.ok(!JSON.stringify(published).includes('PRIVATE_'));
    assert.deepEqual(data(await mcp.call('propose', command)), receipt);
    assert.ok(data(await mcp.call('get_context')).session.locks.some((l: any) => l.path === '/now'));
    assert.equal(data(await mcp.call('heartbeat')).ok, true);
    const denied = await mcp.call('apply', { ...change(x.engine.session(x.session.id), [now('No publishing grant')]) });
    assert.equal(denied.isError, true); assert.equal(data(denied).error.code, 'DISCLOSURE_REQUIRED');
    assert.ok(!mcp.stderr().includes(x.issued.token));
  } finally { await mcp.client.close(); await x.close(); }
});

test('MCP stdio: apply shares server locks, revisions, scopes, intent validation, receipts and revocation', async () => {
  const x = await fixture(true), mcp = await x.connect();
  try {
    const command = change(x.session, [now('Verified public content')]);
    const applied = await mcp.call('apply', command); assert.ok(!applied.isError); assert.equal(data(applied).publication, 'published');
    assert.deepEqual(data(await mcp.call('apply', command)), data(applied));
    const conflict = await mcp.call('apply', change(x.session, [now('Stale content')]));
    assert.equal(conflict.isError, true); assert.equal(data(conflict).error.code, 'REVISION_CONFLICT');
    x.engine.changes(operator, x.session.id, change(x.engine.session(x.session.id), [now('Human correction')]));
    const current = x.engine.session(x.session.id);
    const locked = await mcp.call('apply', change(current, [now('Cannot override')]));
    assert.equal(data(locked).error.code, 'FIELD_LOCKED'); assert.equal(data(locked).error.currentRevision, current.revision);
    const scoped = await mcp.call('propose', change(current, [{ op: 'update_session', fields: { title: 'Ungrantable' } }], { intent: 'propose' }));
    assert.equal(scoped.isError, true); assert.equal(data(scoped).error.code, 'FIELD_FORBIDDEN');
    const wrongIntent = await mcp.call('propose', change(current, [now('Never silently changes intent')]));
    assert.equal(wrongIntent.isError, true); assert.equal(x.store.list('proposal:').length, 0);
    assert.equal(x.engine.session(x.session.id).revision, current.revision);
    const suggested = await mcp.call('propose', change(current, [now('Alternative wording')], { intent: 'propose' }));
    assert.equal(data(suggested).outcome, 'proposed');
    x.engine.revoke(x.issued.producer.id, x.engine.control().controlRevision);
    const revoked = await mcp.call('apply', command); assert.equal(revoked.isError, true); assert.equal(data(revoked).error.code, 'UNAUTHORIZED');
  } finally { await mcp.client.close(); await x.close(); }
});

test('MCP stdio: operator credentials cannot expose private context, no active session is explicit', async () => {
  const x = await fixture(), operatorClient = await x.connect(x.adminToken), producerClient = await x.connect();
  try {
    const denied = await operatorClient.call('get_context'); assert.equal(denied.isError, true); assert.equal(data(denied).error.code, 'PRODUCER_TOKEN_REQUIRED');
    assert.ok(!JSON.stringify(denied).includes('Review external display wording'));
    x.engine.lifecycle(x.session.id, { action: 'end', expectedRevision: x.session.revision, expectedControlRevision: x.engine.control().controlRevision });
    x.engine.setControl({ activeSessionId: null, expectedControlRevision: x.engine.control().controlRevision });
    assert.deepEqual(data(await producerClient.call('get_context')), { session: null });
    const missing = await producerClient.call('get_context', { sessionId: 'session_other' });
    assert.equal(missing.isError, true); assert.equal(data(missing).error.code, 'FORBIDDEN');
  } finally { await operatorClient.client.close(); await producerClient.client.close(); await x.close(); }
});

test('MCP adapter accepts only configured loopback origins and requires a token', () => {
  assert.equal(dashboardUrl('http://localhost:4310/'), 'http://localhost:4310');
  for (const url of ['https://example.com', 'http://127.0.0.1:4310/path', 'http://secret@localhost:4310', 'http://localhost:4310?token=secret', 'http://localhost:4310#secret', 'invalid']) assert.throws(() => dashboardUrl(url));
  assert.throws(() => createDashboardMcp({ url: 'http://127.0.0.1:4310', token: '' }));
});

test('MCP stdio: transport failure distinguishes unavailable reads from uncertain submissions without retries', async () => {
  const x = await fixture(), mcp = await x.connect();
  try {
    assert.ok(!((await mcp.call('get_capabilities')).isError));
    await x.app.close();
    const read = await mcp.call('get_context'); assert.equal(read.isError, true); assert.equal(data(read).error.code, 'DASHBOARD_UNAVAILABLE');
    const submission = await mcp.call('propose', change(x.session, [now('Uncertain submission')], { intent: 'propose' }));
    assert.equal(submission.isError, true); assert.equal(data(submission).error.code, 'REQUEST_OUTCOME_UNKNOWN');
    assert.match(data(submission).error.message, /exact command and requestId/);
    assert.equal(x.store.list('proposal:').length, 0); assert.equal(x.engine.session(x.session.id).revision, x.session.revision);
  } finally { await mcp.client.close(); await x.close(); }
});
