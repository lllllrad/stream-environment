import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { setup, apply, now, event } from './helpers.ts';
import { sessionExport, exportMarkdown } from '../src/domain/export.ts';
import { operator } from '../src/domain/engine.ts';
import { createHttp } from '../src/server/http.ts';

const ajv = new Ajv({ strict: true, allErrors: true });
(addFormats as unknown as (a: Ajv) => void)(ajv);
const validate = ajv.compile(JSON.parse(readFileSync('contracts/session-export.schema.json','utf8')));

test('session export excludes withdrawn/private fields, preserves all visible events and accurately records hidden editorial state', () => {
  const x = setup();
  try {
    apply(x.engine, x.producer, x.session.id, [now('Last recorded activity'), event('withdraw'), ...[1,2,3,4,5].map(i => event(`visible_${i}`)), { op: 'upsert_work_item', workItem: { id: 'withdraw_work', title: 'WITHDRAWN_WORK', status: 'failed', publicResult: 'WITHDRAWN_RESULT' } }, { op: 'upsert_work_item', workItem: { id: 'visible_work', title: 'Visible work', status: 'running', publicResult: null } }, { op: 'set_pin', value: { text: 'EXPIRED_NOTICE', expiresAt: new Date(Date.now() - 1000).toISOString() } }]);
    apply(x.engine, x.producer, x.session.id, [{ op: 'retract_event', id: 'withdraw' }, { op: 'retract_work_item', id: 'withdraw_work' }]);
    apply(x.engine, x.producer, x.session.id, [now('PRIVATE_PROPOSAL')], { intent: 'propose', provenance: { disclosure: 'restricted', observedAt: new Date().toISOString(), sourceRefs: ['PRIVATE_SOURCE'], reason: 'PRIVATE_REASON' } });
    x.engine.locks({ sessionId: x.session.id, path: '/now', expectedRevision: x.engine.session(x.session.id).revision, locked: true, reason: 'PRIVATE_LOCK_REASON' });
    x.engine.setControl({ mode: 'hidden', expectedControlRevision: x.engine.control().controlRevision });
    const before = x.engine.session(x.session.id), outputs = x.store.list('output:'), record = sessionExport(before, x.engine.control());
    assert.ok(validate(record), ajv.errorsText(validate.errors)); assert.equal(record.publication, 'hidden');
    assert.equal(record.session.events.length, 5); assert.equal(record.session.workItems.length, 1); assert.equal(record.session.pin, null);
    assert.equal(record.session.lastActivity!.title, 'Last recorded activity'); assert.equal(record.session.revision, before.revision);
    const json = JSON.stringify(record);
    for (const forbidden of ['PRIVATE_', 'EXPIRED_NOTICE', 'WITHDRAWN_', 'actorId', 'sourceRefs', 'tokenHash', 'receivedAt', 'locks', 'retractedAt', 'nowObservedAt']) assert.ok(!json.includes(forbidden), forbidden);
    assert.equal(validate({ ...record, proposals: [] }), false);
    assert.equal(validate({ ...record, session: { ...record.session, locks: [] } }), false);
    assert.deepEqual(x.engine.session(x.session.id), before); assert.deepEqual(x.store.list('output:'), outputs);
    x.engine.lifecycle(x.session.id, { action: 'end', expectedRevision: before.revision, expectedControlRevision: x.engine.control().controlRevision });
    const ended = sessionExport(x.engine.session(x.session.id), x.engine.control());
    assert.equal(ended.session.status, 'ended'); assert.match(exportMarkdown(ended), /not a live activity/);
  } finally { x.store.close(); }
});

test('Markdown export uses English headings and escapes content markup, HTML, URLs and table delimiters', () => {
  const x = setup();
  try {
    x.engine.changes(operator, x.session.id, { schemaVersion:'1.0',requestId:crypto.randomUUID(),sessionId:x.session.id,baseRevision:x.session.revision,intent:'apply',provenance:{disclosure:'public',observedAt:new Date().toISOString(),sourceRefs:[],reason:'Test literal content'},operations:[{op:'update_session',fields:{title:'# <script>alert(1)</script>',goal:'[click](https://example.com) & text | data',recap:['``` **literal** https://example.com']}}] });
    const record = sessionExport(x.engine.session(x.session.id), x.engine.control()), markdown = exportMarkdown(record);
    assert.match(markdown, /^# Session content export\n/); assert.match(markdown, /## Recap/);
    assert.ok(!markdown.includes('<script>')); assert.ok(!markdown.includes('[click](https://example.com)')); assert.ok(!markdown.includes('https://example.com'));
    assert.ok(markdown.includes('\\<script\\>')); assert.ok(markdown.includes('\\|')); assert.ok(markdown.includes('\\`\\`\\`'));
    assert.equal(record.session.title, '# <script>alert(1)</script>');
  } finally { x.store.close(); }
});

test('HTTP: session exports are operator-only attachments, immutable reads, and unavailable after purge', async () => {
  const x = setup(), token = 'export-test-operator-token-long-enough';
  const app = createHttp(x.engine, { adminToken: token, heartbeatMs: 100 });
  await new Promise<void>(resolve => app.server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
  const producer = x.engine.producer({ name:'Export reader',canAutoPublish:false,allowedSessions:[x.session.id],allowedOperations:['set_now'],allowedPaths:['/now'],expectedControlRevision:x.engine.control().controlRevision });
  const path = `${base}/api/v1/admin/sessions/${x.session.id}/export`;
  try {
    assert.equal((await fetch(path)).status,401); assert.equal((await fetch(path,{headers:{Authorization:`Bearer ${producer.token}`}})).status,403);
    const headers = { Authorization: `Bearer ${token}` }, before = x.engine.session(x.session.id), audit = x.store.audits();
    const response = await fetch(path,{headers}); assert.equal(response.status,200); assert.match(response.headers.get('content-disposition')!, /attachment; filename="session_[A-Za-z0-9_-]+-r\d+\.json"/); assert.equal(response.headers.get('cache-control'),'no-store');
    assert.ok(validate(await response.json()),ajv.errorsText(validate.errors));
    const markdown = await fetch(`${path}?format=markdown`,{headers}); assert.match(markdown.headers.get('content-type')!, /text\/markdown/); assert.match(markdown.headers.get('content-disposition')!, /\.md"/); assert.match(await markdown.text(), /^# Session content export/);
    const invalid = await fetch(`${path}?format=html`,{headers}); assert.equal(invalid.status,422); assert.equal((await invalid.json()).error.code,'INVALID_EXPORT_FORMAT');
    assert.deepEqual(x.engine.session(x.session.id),before); assert.deepEqual(x.store.audits(),audit);
    x.engine.purgeSession(x.session.id,{expectedRevision:before.revision,expectedControlRevision:x.engine.control().controlRevision,confirm:true});
    assert.equal((await fetch(path,{headers})).status,404);
  } finally { await app.close(); x.store.close(); }
});
