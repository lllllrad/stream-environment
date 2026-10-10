import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/server/store.ts';
import {Engine,operator} from '../src/domain/engine.ts';
import {CONTENT_SOURCES} from '../src/sources/registry.ts';
import {change,now,event} from './helpers.ts';
import {tokenHash} from '../src/contracts/validation.ts';
import {createHttp} from '../src/server/http.ts';

const code=(expected:string)=>(error:any)=>error.code===expected;
const target={overlayId:'overlay-1920x1080',sceneId:'break',widgetId:'away'};
function fixture(){const store=new Store(':memory:'),engine=new Engine(store);return {store,engine,issue:()=>engine.registerController({expectedControlRevision:engine.control().controlRevision,name:'Scene button',allowedSceneIds:['break'],widgets:[target]}),command:(extra:object={})=>({requestId:randomUUID(),expectedConfigRevision:engine.overlayConfig().revision,...target,...extra})};}

test('source policies default to reviewed proposals, reject whole apply batches, survive restart and independent widget visibility',()=>{
  const x=fixture(),e=x.engine;try{
    assert.ok(e.contentSources().every(s=>s.policy==='proposal_only'));
    const session=e.createSession({title:'Policy test',goal:'Synthetic content',expectedControlRevision:0});e.lifecycle(session.id,{action:'start',expectedRevision:0,expectedControlRevision:0});
    const {producer}=e.producer({name:'Publisher',canAutoPublish:true,allowedSessions:[session.id],allowedOperations:['set_now','upsert_event'],allowedPaths:['*'],expectedControlRevision:e.control().controlRevision});
    const request=()=>change(e.session(session.id),[now('Proposal only activity')]);
    assert.throws(()=>e.changes(producer,session.id,request()),code('SOURCE_REVIEW_REQUIRED'));assert.throws(()=>e.validate(producer,session.id,request()),code('SOURCE_REVIEW_REQUIRED'));
    assert.throws(()=>e.renderPreview(producer,session.id,{overlayId:target.overlayId,change:request()}),code('SOURCE_REVIEW_REQUIRED'));
    const proposal=e.changes(producer,session.id,{...request(),intent:'propose'});assert.equal(proposal.outcome,'proposed');assert.equal(e.session(session.id).now,null);
    e.decision(proposal.proposalId!,{decision:'approve',expectedProposalRevision:0,expectedRevision:e.session(session.id).revision});assert.equal(e.session(session.id).now!.title,'Proposal only activity');
    e.locks({sessionId:session.id,path:'/now',locked:false,expectedRevision:e.session(session.id).revision});
    e.setSourcePolicy({expectedControlRevision:e.control().controlRevision,sourceId:'now',policy:'apply_allowed'});
    assert.equal(new Engine(x.store).contentSources().find(s=>s.id==='now')!.policy,'apply_allowed');
    const before={session:e.session(session.id),outputs:x.store.list('output:'),audits:x.store.audits()},batch=change(e.session(session.id),[now('Allowed first operation'),event()]);
    assert.throws(()=>e.changes(producer,session.id,batch),code('SOURCE_REVIEW_REQUIRED'));assert.deepEqual({session:e.session(session.id),outputs:x.store.list('output:'),audits:x.store.audits()},before);assert.equal(x.store.receipt(producer.id,session.id,batch.requestId),undefined);
    assert.equal(e.changes(producer,session.id,change(e.session(session.id),[now('Explicit automatic source')])).outcome,'applied');
    e.setSourcePolicy({expectedControlRevision:e.control().controlRevision,sourceId:'now',policy:'proposal_only'});
    const config=e.overlayConfig(),layout=config.layouts[0];layout.widgets.forEach(w=>{w.visible=false});e.updateOverlays({action:'save_layout',expectedRevision:config.revision,overlayId:layout.overlayId,sceneId:layout.sceneId,widgets:layout.widgets});
    assert.throws(()=>e.changes(producer,session.id,request()),code('SOURCE_REVIEW_REQUIRED'));
    assert.throws(()=>e.setSourcePolicy({expectedControlRevision:0,sourceId:'now',policy:'apply_allowed'}),code('CONTROL_REVISION_CONFLICT'));
  }finally{x.store.close();}
});

test('trusted source policy plugins compose restrictively for shared paths',()=>{
  const x=fixture();try{
    const e=x.engine,s=e.createSession({title:'Plugin policy',goal:'Test shared paths',expectedControlRevision:0});e.lifecycle(s.id,{action:'start',expectedRevision:0,expectedControlRevision:0});
    const {producer}=e.producer({name:'Publisher',canAutoPublish:true,allowedSessions:[s.id],allowedOperations:['set_now'],allowedPaths:['/now'],expectedControlRevision:e.control().controlRevision});
    e.setSourcePolicy({expectedControlRevision:e.control().controlRevision,sourceId:'now',policy:'apply_allowed'});
    CONTENT_SOURCES.push({id:'reviewed-current',label:'Reviewed current',paths:['/now'],defaultPolicy:'proposal_only'});
    assert.equal(e.contentSources().at(-1)!.policy,'proposal_only');assert.throws(()=>e.changes(producer,s.id,change(e.session(s.id),[now()])),code('SOURCE_REVIEW_REQUIRED'));
    assert.equal(e.changes(producer,s.id,change(e.session(s.id),[now()],{intent:'propose'})).outcome,'proposed');
  }finally{CONTENT_SOURCES.pop();x.store.close();}
});

test('direct control scopes exact scenes/widgets/settings and revisions; tokens and receipts persist and revoke',()=>{
  const x=fixture(),e=x.engine;try{
    const issued=x.issue(),id=issued.controller.id;assert.equal(issued.controller.tokenHash,undefined);assert.ok(!JSON.stringify(e.controllers()).includes(issued.token));
    assert.throws(()=>e.registerController({expectedControlRevision:e.control().controlRevision,name:'Not eligible',allowedSceneIds:[],widgets:[{...target,widgetId:'now'}]}),code('CONTROL_FORBIDDEN'));
    const command=x.command({settings:{message:'Direct status',detail:'Optional detail'}}),sessions=x.store.list('session:');
    const receipt=e.directCommand(id,'widget',command);assert.equal(receipt.publication,'not_applicable');assert.equal(x.store.list('proposal:').length,0);assert.equal(x.store.list('layout-proposal:').length,0);assert.deepEqual(x.store.list('session:'),sessions);
    assert.deepEqual(new Engine(x.store).directCommand(id,'widget',command),receipt);assert.equal(new Engine(x.store).controlCredential(tokenHash(issued.token)).id,id);
    assert.throws(()=>e.directCommand(id,'widget',{...command,settings:{message:'Different'}}),code('IDEMPOTENCY_CONFLICT'));
    assert.throws(()=>e.directCommand(id,'widget',{...command,requestId:randomUUID()}),code('OVERLAY_REVISION_CONFLICT'));
    assert.throws(()=>e.directCommand(id,'widget',x.command({sceneId:'live',visible:true})),code('CONTROL_FORBIDDEN'));
    assert.throws(()=>e.directCommand(id,'widget',x.command({settings:{background:'#fff'}})),code('CONTROL_FORBIDDEN'));
    assert.throws(()=>e.directCommand(id,'widget',x.command({x:0,visible:true})),code('SCHEMA_VALIDATION'));
    assert.throws(()=>e.directCommand(id,'scene',{requestId:randomUUID(),expectedConfigRevision:e.overlayConfig().revision,sceneId:'live'}),code('CONTROL_FORBIDDEN'));
    assert.throws(()=>e.directCommand(id,'widget',x.command({settings:{message:'x'.repeat(161)}})),code('SCHEMA_VALIDATION'));
    const config=e.overlayConfig(),layout=config.layouts.find(l=>l.overlayId===target.overlayId&&l.sceneId===target.sceneId)!;layout.widgets.find(w=>w.id==='away')!.type='now';e.updateOverlays({action:'save_layout',expectedRevision:config.revision,...target,widgets:layout.widgets});
    assert.equal(e.directContext(id).widgets.length,0);assert.throws(()=>e.directCommand(id,'widget',x.command({visible:true})),code('CONTROL_FORBIDDEN'));
    e.revokeController(id,{expectedControlRevision:e.control().controlRevision});assert.throws(()=>e.directCommand(id,'widget',command),code('UNAUTHORIZED'));assert.throws(()=>e.controlCredential(tokenHash(issued.token)),code('UNAUTHORIZED'));
  }finally{x.store.close();}
});

test('direct commands work without a session and preserve Auto/Hold/Hidden and AI write gate',()=>{
  for(const mode of ['auto','hold','hidden'] as const){const x=fixture(),e=x.engine;try{
    const issued=x.issue();e.setControl({expectedControlRevision:e.control().controlRevision,mode,aiWritesEnabled:false});const prior=e.output(target.overlayId);
    e.directCommand(issued.controller.id,'widget',x.command({settings:{message:'Direct scene caption'}}));
    e.directCommand(issued.controller.id,'scene',{requestId:randomUUID(),expectedConfigRevision:e.overlayConfig().revision,sceneId:'break'});
    assert.equal(e.overlayConfig().activeSceneId,'break');assert.equal(e.control().mode,mode);assert.equal(e.control().activeSessionId,null);
    if(mode==='auto')assert.ok(JSON.stringify(e.output(target.overlayId)).includes('Direct scene caption'));
    else if(mode==='hold')assert.equal(e.output(target.overlayId).snapshot.overlay!.sceneId,prior.snapshot.overlay!.sceneId);
    else assert.ok(e.output(target.overlayId).snapshot.overlay!.widgets.every(w=>!w.blocks.length));
    if(mode!=='auto'){e.setControl({expectedControlRevision:e.control().controlRevision,mode:'auto',confirmRestore:true});assert.ok(JSON.stringify(e.output(target.overlayId)).includes('Direct scene caption'));}
  }finally{x.store.close();}}
});

test('failed direct receipt persistence rolls back layout, audit and publication',()=>{
  const x=fixture(),e=x.engine;try{
    const issued=x.issue(),before={config:e.overlayConfig(),outputs:x.store.list('output:'),audit:x.store.audits(),controllers:e.controllers()},put=x.store.put.bind(x.store);let published=false;e.onPublish=()=>{published=true;};
    x.store.put=(key,value)=>{if(key.startsWith('control-receipt:'))throw new Error('Injected receipt failure');put(key,value);};
    assert.throws(()=>e.directCommand(issued.controller.id,'widget',x.command({settings:{message:'Atomic caption'}})),/Injected receipt failure/);x.store.put=put;
    assert.deepEqual({config:e.overlayConfig(),outputs:x.store.list('output:'),audit:x.store.audits(),controllers:e.controllers()},before);assert.equal(published,false);
  }finally{x.store.close();}
});

test('HTTP direct control token isolation, source discovery, cookie CSRF and actual publication',async()=>{
  const x=fixture(),e=x.engine,admin='control-audit-operator-token-long-enough',app=createHttp(e,{adminToken:admin,producerBurst:100});await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
  const call=async(path:string,data?:unknown,token=admin,extra:Record<string,string>={})=>{const r=await fetch(base+'/api/v1'+path,{method:data===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{'Content-Type':'application/json'}),...(data===undefined?{}:{'Content-Type':'application/json'}),...extra},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json(),headers:r.headers};};
  try{
    const login=await call('/admin/login',{token:admin},''),cookie=login.headers.get('set-cookie')!.split(';')[0],credentials={name:'HTTP controller',allowedSceneIds:['break'],widgets:[target],expectedControlRevision:e.control().controlRevision};
    assert.equal((await call('/admin/controllers',credentials,'',{Cookie:cookie})).status,403);
    const issued=await call('/admin/controllers',credentials,'',{Cookie:cookie,'X-CSRF-Token':login.data.csrfToken});assert.equal(issued.status,201);const token=issued.data.token;
    const producer=e.producer({name:'Content only',canAutoPublish:true,allowedSessions:['*'],allowedOperations:['set_now'],allowedPaths:['/now'],expectedControlRevision:e.control().controlRevision});
    assert.equal((await call('/control/context',undefined,producer.token)).status,401);assert.equal((await call('/control/context',undefined,admin)).status,401);
    for(const path of ['/capabilities','/admin/state','/overlays','/sources'])assert.equal((await call(path,undefined,token)).status,401);
    const sources=await call('/sources',undefined,producer.token);assert.ok(sources.data.sources.every((s:any)=>s.policy==='proposal_only'));assert.equal((await call('/capabilities',undefined,producer.token)).data.sourcePolicies[0].policy,'proposal_only');
    const policy={expectedControlRevision:e.control().controlRevision,sourceId:'now',policy:'apply_allowed'};assert.equal((await call('/admin/source-policies',policy,producer.token)).status,403);assert.equal((await call('/admin/source-policies',policy,'',{Cookie:cookie})).status,403);assert.equal((await call('/admin/source-policies',policy,'',{Cookie:cookie,'X-CSRF-Token':login.data.csrfToken})).status,200);
    const context=(await call('/control/context',undefined,token)).data;assert.deepEqual(context.scenes.map((s:any)=>s.id),['break']);assert.equal(context.widgets.length,1);
    const command={requestId:randomUUID(),expectedConfigRevision:context.configRevision,sceneId:'break'};assert.equal((await call('/control/scene',command,token)).status,200);assert.equal((await call('/control/scene',command,token)).status,200);
    const caption=x.command({settings:{message:'HTTP direct caption'}});assert.equal((await call('/control/widgets',caption,token)).status,200);assert.ok(JSON.stringify(e.output(target.overlayId)).includes('HTTP direct caption'));
    assert.ok(!JSON.stringify((await call('/admin/controllers')).data).includes(token));assert.equal((await call(`/admin/controllers/${issued.data.controller.id}/revoke`,{expectedControlRevision:e.control().controlRevision})).status,200);assert.equal((await call('/control/widgets',caption,token)).status,401);
  }finally{await app.close();x.store.close();}
});
