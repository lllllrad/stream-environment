import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { Store } from '../src/server/store.ts';
import { Engine } from '../src/domain/engine.ts';
import { createHttp } from '../src/server/http.ts';
import { DEFAULT_SETTINGS } from '../src/contracts/overlay.ts';

const spec = JSON.parse(readFileSync('contracts/openapi.json','utf8'));
function validator(document: any, schema: any) {
  const ajv = new Ajv2020({strict:false,allErrors:true});
  (addFormats as unknown as (a:Ajv2020)=>void)(ajv);
  return ajv.compile({...schema, components:document.components});
}
function assertSchema(document: any, schema: any, data: any) {
  const validate = validator(document, schema);
  assert.ok(validate(data), JSON.stringify(validate.errors));
}
function operation(document: any, id: string) {
  for (const [path, item] of Object.entries<any>(document.paths)) {
    for (const [method, definition] of Object.entries<any>(item)) {
      if (definition.operationId === id) return {path,method,definition};
    }
  }
  throw new Error(`Missing operation ${id}`);
}
async function fixture() {
  const store = new Store(':memory:'), engine = new Engine(store), adminToken = 'openapi-private-operator-token-long-enough';
  const app = createHttp(engine, {adminToken, heartbeatMs:100, producerRate:100, producerBurst:100});
  await new Promise<void>(resolve => app.server.listen(0,'0.0.0.0',resolve));
  const port = (app.server.address() as {port:number}).port, base = `http://127.0.0.2:${port}`;
  const session = engine.createSession({title:'PRIVATE_METADATA_SESSION',goal:'PRIVATE_METADATA_GOAL',expectedControlRevision:0});
  engine.lifecycle(session.id,{action:'start',expectedRevision:0,expectedControlRevision:0});
  const issued = engine.producer({name:'PRIVATE_METADATA_PRODUCER',canAutoPublish:false,allowedSessions:[session.id],allowedOperations:['set_now','update_session','set_pin','upsert_event'],allowedPaths:['/now','/session/recap','/pin','/events/*'],expectedControlRevision:1});
  return {store,engine,app,base,port,session,issued,adminToken,close:async()=>{await app.close();store.close();}};
}

test('OpenAPI is self-contained with resolvable pointers, unique operation IDs and explicit security', () => {
  assert.equal(spec.openapi,'3.1.0');
  assert.equal(spec.servers[0].url,'/');
  function visit(value: any) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      assert.ok(value.$ref.startsWith('#/'),`External reference: ${value.$ref}`);
      const resolved = value.$ref.slice(2).split('/').reduce((node: any,part: string)=>node?.[part.replace(/~1/g,'/').replace(/~0/g,'~')],spec);
      assert.notEqual(resolved,undefined,`Broken reference: ${value.$ref}`);
    }
    Object.values(value).forEach(visit);
  }
  visit(spec);
  const ids = new Set<string>();
  for (const [path,item] of Object.entries<any>(spec.paths)) for (const definition of Object.values<any>(item)) {
    assert.match(definition.operationId,/^[a-zA-Z][a-zA-Z0-9]*$/);
    assert.ok(!ids.has(definition.operationId)); ids.add(definition.operationId);
    assert.ok(Array.isArray(definition.security)); assert.ok(definition.tags.length);
    for (const [,name] of path.matchAll(/\{([^}]+)\}/g)) assert.ok(definition.parameters.some((p: any)=>p.name===name&&p.in==='path'&&p.required));
  }
  assert.deepEqual(spec.paths['/openapi.json'].get.security,[]);
  assert.deepEqual(operation(spec,'submitChanges').definition.tags,['Producer']);
  assert.ok(operation(spec,'submitChanges').definition.security.some((s: any)=>s.bearerAuth));
});

test('OpenAPI embedded schemas validate both request examples and enforce original content limits', () => {
  const submit = operation(spec,'submitChanges').definition;
  const validate = validator(spec,submit.requestBody.content['application/json'].schema);
  for (const example of Object.values<any>(submit.requestBody.content['application/json'].examples)) assert.ok(validate(example.value),JSON.stringify(validate.errors));
  const invalid = structuredClone(submit.requestBody.content['application/json'].examples.proposal.value);
  invalid.operations[0].value.title = 'x'.repeat(49);
  assert.equal(validate(invalid),false);
  assertSchema(spec,{$ref:'#/components/schemas/PublicSnapshot'},{screenId:'main-full',preset:'full',publicRevision:0,sessionId:null,mode:'hidden',leaseMs:30000,publishedAt:new Date().toISOString(),content:null});
});

test('OpenAPI widget colors accept RGB and RGBA lengths and reject incomplete values',()=>{
  const validate=validator(spec,spec.components.schemas.WidgetInstance.properties.settings);
  for(const color of ['#8BF','#8BF8','#88BBFF','#88BBFF88'])assert.ok(validate({...DEFAULT_SETTINGS,background:color,color}),JSON.stringify(validate.errors));
  assert.ok(validate({...DEFAULT_SETTINGS,background:'transparent',color:'#f000'}));
  for(const color of ['#8B','#8BF88','#88BBFF8','#88BBFF888','#GGG8'])assert.equal(validate({...DEFAULT_SETTINGS,background:color}),false);
});

test('HTTP OpenAPI discovery is public, read-only and uses the validated origin without exposing private state', async () => {
  const x = await fixture();
  try {
    const before = {session:x.engine.session(x.session.id),control:x.engine.control(),audits:x.store.audits(0,100)};
    const response = await fetch(`${x.base}/openapi.json`), document = await response.json();
    assert.equal(response.status,200); assert.match(response.headers.get('content-type')!,/application\/json/);
    assert.equal(response.headers.get('set-cookie'),null); assert.equal(response.headers.get('access-control-allow-origin'),null);
    assert.equal(document.servers[0].url,x.base);
    const serialized = JSON.stringify(document);
    for (const privateValue of ['PRIVATE_METADATA_',x.adminToken,x.issued.token,x.session.id]) assert.ok(!serialized.includes(privateValue));
    const local = await fetch(`http://localhost:${x.port}/openapi.json`).then(r=>r.json());
    assert.equal(local.servers[0].url,`http://localhost:${x.port}`); assert.equal(document.servers[0].url,x.base);
    const foreignOrigin = await fetch(`${x.base}/openapi.json`,{headers:{Origin:'https://untrusted.example'}});
    assert.equal(foreignOrigin.status,403);
    assert.equal((await fetch(`${x.base}/api/v1/capabilities`)).status,401);
    assert.equal((await fetch(`${x.base}/openapi.json`,{method:'POST'})).status,404);
    assert.deepEqual({session:x.engine.session(x.session.id),control:x.engine.control(),audits:x.store.audits(0,100)},before);
  } finally {await x.close();}
});

test('A network agent can discover OpenAPI operations, read context, validate and submit an actual private content proposal', async () => {
  const x = await fixture();
  try {
    const document = await fetch(`${x.base}/openapi.json`).then(r=>r.json());
    const call = async (id: string, body?: object, sessionId?: string) => {
      const op = operation(document,id), path = op.path.replace('{id}',sessionId??'');
      if (body) assertSchema(document,op.definition.requestBody.content['application/json'].schema,body);
      const response = await fetch(document.servers[0].url+path,{method:op.method.toUpperCase(),headers:{Authorization:`Bearer ${x.issued.token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
      const data = await response.json(); assert.equal(response.status,200,JSON.stringify(data));
      assertSchema(document,op.definition.responses['200'].content['application/json'].schema,data);
      return data;
    };
    assert.equal((await call('getCapabilities')).canAutoPublish,false);
    const current = await call('getCurrentSession'), context = await call('getSessionContext',undefined,current.session.id);
    const command = structuredClone(operation(document,'submitChanges').definition.requestBody.content['application/json'].examples.proposal.value);
    command.requestId=randomUUID(); command.sessionId=context.id; command.baseRevision=context.revision;
    command.provenance.observedAt=new Date().toISOString();
    for (const op of command.operations) if (op.op==='upsert_event') op.event.occurredAt=command.provenance.observedAt;
    const validated = await call('validateChanges',command,context.id);
    assert.equal(validated.after.now.title,command.operations[0].value.title);
    assert.equal(x.store.list('proposal:').length,0);
    const receipt = await call('submitChanges',command,context.id);
    assert.equal(receipt.outcome,'proposed'); assert.equal(x.store.list('proposal:').length,1);
    assert.ok(!JSON.stringify(x.engine.output('main-full').snapshot).includes(command.operations[0].value.title));
    assert.deepEqual(await call('submitChanges',command,context.id),receipt);
    assert.equal((await call('producerHeartbeat',{})).ok,true);
  } finally {await x.close();}
});
