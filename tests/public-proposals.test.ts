import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/server/store.ts';
import { Engine, operator } from '../src/domain/engine.ts';
import { createHttp } from '../src/server/http.ts';
import { change, now } from './helpers.ts';
import type { Proposal, Receipt } from '../src/contracts/types.ts';
import type { LayoutProposal } from '../src/contracts/layout-proposals.ts';

function fixture(){
  const store=new Store(':memory:'),engine=new Engine(store);
  const created=engine.createSession({title:'PRIVATE_SESSION_TITLE',goal:'PRIVATE_SESSION_GOAL',expectedControlRevision:0});
  engine.lifecycle(created.id,{action:'start',expectedRevision:0,expectedControlRevision:0});
  engine.changes(operator,created.id,change(engine.session(created.id),[now('PRIVATE_EDITORIAL_NOW')]));
  engine.setControl({expectedControlRevision:engine.control().controlRevision,mode:'hidden'});
  const config=engine.overlayConfig(),layout=config.layouts.find(l=>l.overlayId==='overlay-1920x1080'&&l.sceneId==='break')!;
  layout.widgets[0].settings.message='PRIVATE_WIDGET_CAPTION';
  engine.updateOverlays({action:'save_layout',expectedRevision:config.revision,overlayId:layout.overlayId,sceneId:layout.sceneId,widgets:layout.widgets});
  const content=()=>({...change(engine.session(created.id),[now('Anonymous suggested activity')]),intent:'propose' as const});
  const layoutChange=()=>{const layout=engine.publicProposalContext().config.layouts.find(l=>l.overlayId==='overlay-1920x1080'&&l.sceneId==='break')!;layout.widgets[0].x-=10;return {schemaVersion:'1.0',requestId:randomUUID(),intent:'propose',overlayId:layout.overlayId,sceneId:layout.sceneId,baseRevision:layout.revision,provenance:{disclosure:'restricted',observedAt:new Date().toISOString(),sourceRefs:[],reason:'Anonymous geometry suggestion'},widgets:layout.widgets};};
  const before=()=>({session:engine.session(created.id),config:engine.overlayConfig(),outputs:store.list('output:'),audit:store.audits()});
  return {store,engine,id:created.id,content,layoutChange,before};
}
const code=(expected:string)=>(error:any)=>error.code===expected;

test('anonymous content suggestions validate privately, never apply, replay and require ordinary human approval',()=>{
  const x=fixture();try{
    const context=x.engine.publicProposalContext(),serialized=JSON.stringify(context);
    for(const secret of ['PRIVATE_SESSION_TITLE','PRIVATE_SESSION_GOAL','PRIVATE_EDITORIAL_NOW','PRIVATE_WIDGET_CAPTION'])assert.ok(!serialized.includes(secret));
    assert.equal(context.session?.id,x.id);assert.equal(context.sources.every(s=>s.policy==='proposal_only'),true);
    const command=x.content(),before=x.before();
    assert.deepEqual(x.engine.publicContentProposal(command,true),{ok:true,changedPaths:['/now'],sessionRevision:context.session!.revision});assert.deepEqual(x.before(),before);
    assert.throws(()=>x.engine.publicContentProposal({...command,intent:'apply'}),code('PROPOSAL_ONLY'));
    const receipt=x.engine.publicContentProposal(command) as Receipt;assert.equal(receipt.outcome,'proposed');assert.equal(receipt.publication,'not_applicable');
    assert.deepEqual(x.engine.session(x.id),before.session);assert.deepEqual(x.store.list('output:'),before.outputs);
    const p=x.store.get<Proposal>(`proposal:${receipt.proposalId}`)!;assert.equal(p.actorId,'anonymous');
    const restarted=new Engine(x.store);assert.deepEqual(restarted.publicContentProposal(command),receipt);
    assert.throws(()=>restarted.publicContentProposal({...command,provenance:{...command.provenance,reason:'Different command'}}),code('IDEMPOTENCY_CONFLICT'));
    restarted.decision(p.id,{decision:'approve',expectedProposalRevision:p.revision,expectedRevision:restarted.session(x.id).revision});
    assert.equal(restarted.session(x.id).now?.title,'Anonymous suggested activity');assert.equal(restarted.control().mode,'hidden');
    assert.deepEqual(restarted.publicContentProposal(command),receipt);
    restarted.setSourcePolicy({expectedControlRevision:restarted.control().controlRevision,sourceId:'now',policy:'apply_allowed'});
    assert.throws(()=>restarted.publicContentProposal({...command,intent:'apply',requestId:randomUUID(),baseRevision:restarted.session(x.id).revision}),code('PROPOSAL_ONLY'));
    assert.throws(()=>restarted.publicContentProposal({...command,requestId:randomUUID()}),code('REVISION_CONFLICT'));
    restarted.setControl({expectedControlRevision:restarted.control().controlRevision,aiWritesEnabled:false});
    assert.throws(()=>restarted.publicContentProposal(command),code('AI_WRITES_DISABLED'));
  }finally{x.store.close();}
});

test('anonymous layout suggestions preserve omitted private captions, retain review acknowledgments and expose no merged content',()=>{
  const x=fixture();try{
    const command=x.layoutChange(),before=x.before(),validation=x.engine.publicLayoutProposal(command,true);
    assert.ok(!JSON.stringify(validation).includes('PRIVATE_WIDGET_CAPTION'));assert.deepEqual(x.before(),before);
    const receipt=x.engine.publicLayoutProposal(command) as any,p=x.store.get<LayoutProposal>(`layout-proposal:${receipt.proposalId}`)!;
    assert.equal(p.actorId,'anonymous');assert.equal(p.change.widgets[0].settings.message,'PRIVATE_WIDGET_CAPTION');
    assert.deepEqual(x.engine.overlayConfig(),before.config);assert.deepEqual(x.store.list('output:'),before.outputs);
    const restarted=new Engine(x.store);assert.deepEqual(restarted.publicLayoutProposal(command),receipt);
    assert.throws(()=>restarted.publicLayoutProposal({...command,widgets:[]}),code('IDEMPOTENCY_CONFLICT'));
    let preview=restarted.layoutProposalPreview(p.id);
    const decision={decision:'approve',expectedProposalRevision:preview.proposalRevision,expectedConfigRevision:preview.configRevision,expectedLayoutRevision:preview.layoutRevision,expectedControlRevision:preview.controlRevision};
    assert.throws(()=>restarted.layoutDecision(p.id,decision),code('DISCLOSURE_REVIEW_REQUIRED'));
    restarted.layoutDecision(p.id,{...decision,allowDisclosure:true});
    const saved=restarted.overlayConfig().layouts.find(l=>l.overlayId===command.overlayId&&l.sceneId===command.sceneId)!;
    assert.equal(saved.widgets[0].x,command.widgets[0].x);assert.equal(saved.widgets[0].settings.message,'PRIVATE_WIDGET_CAPTION');assert.equal(restarted.control().mode,'hidden');
    assert.deepEqual(restarted.publicLayoutProposal(command),receipt);
    assert.throws(()=>restarted.publicLayoutProposal({...command,requestId:randomUUID()}),code('LAYOUT_REVISION_CONFLICT'));
    const invalid=x.layoutChange();invalid.widgets[0].x=-1;assert.throws(()=>restarted.publicLayoutProposal(invalid),code('SCHEMA_VALIDATION'));
  }finally{x.store.close();}
});

test('public queue limits, stopped writes and receipt failures leave session/layout/publication unchanged',()=>{
  const x=fixture();try{
    const original=x.store.saveReceipt.bind(x.store),before=x.before();x.store.saveReceipt=()=>{throw Error('Injected receipt failure');};
    assert.throws(()=>x.engine.publicContentProposal(x.content()),/Injected receipt failure/);assert.deepEqual(x.before(),before);assert.equal(x.store.list('proposal:').length,0);x.store.saveReceipt=original;
    const put=x.store.put.bind(x.store);x.store.put=(key,value)=>{if(key.startsWith('layout-receipt:anonymous:'))throw Error('Injected layout receipt failure');put(key,value);};
    assert.throws(()=>x.engine.publicLayoutProposal(x.layoutChange()),/Injected layout receipt failure/);assert.deepEqual(x.before(),before);assert.equal(x.store.list('layout-proposal:').length,0);x.store.put=put;
    for(let i=0;i<32;i++)x.engine.publicContentProposal(x.content());
    assert.throws(()=>x.engine.publicContentProposal(x.content()),code('PROPOSAL_LIMIT'));assert.deepEqual(x.engine.session(x.id),before.session);assert.deepEqual(x.store.list('output:'),before.outputs);
    for(let i=0;i<32;i++)x.engine.publicLayoutProposal(x.layoutChange());assert.throws(()=>x.engine.publicLayoutProposal(x.layoutChange()),code('PROPOSAL_LIMIT'));
    x.engine.setControl({expectedControlRevision:x.engine.control().controlRevision,aiWritesEnabled:false});assert.throws(()=>x.engine.publicLayoutProposal(x.layoutChange()),code('AI_WRITES_DISABLED'));
  }finally{x.store.close();}
});

test('HTTP permits token-free proposals only and keeps private APIs, immediate publishing and control authenticated',async()=>{
  const x=fixture(),app=createHttp(x.engine,{adminToken:'public-proposal-operator-key-long-enough',producerBurst:100,producerRate:100});
  await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
  const call=async(path:string,body?:object)=>{const response=await fetch(base+'/api/v1'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};};
  try{
    const before=x.before(),sources=await call('/sources');assert.equal(sources.status,200);assert.deepEqual(sources.data,{sources:x.engine.contentSources()});assert.deepEqual(x.before(),before);
    for(const secret of ['PRIVATE_SESSION_TITLE','PRIVATE_SESSION_GOAL','PRIVATE_EDITORIAL_NOW','PRIVATE_WIDGET_CAPTION'])assert.ok(!JSON.stringify(sources.data).includes(secret));
    assert.equal((await fetch(base+'/api/v1/sources',{headers:{Origin:'https://untrusted.invalid'}})).status,403);
    assert.equal((await call('/sources',{policy:'apply_allowed'})).status,401);
    assert.equal((await call('/public/proposals/context')).status,200);
    const content=x.content();assert.equal((await call('/public/proposals/content/validate',content)).status,200);assert.equal((await call('/public/proposals/content',content)).data.outcome,'proposed');
    assert.equal((await call('/public/proposals/content',{...content,intent:'apply'})).data.error.code,'PROPOSAL_ONLY');
    const layout=x.layoutChange();assert.equal((await call('/public/proposals/layouts/validate',layout)).status,200);assert.equal((await call('/public/proposals/layouts',layout)).data.outcome,'proposed');
    for(const [path,body] of [[`/sessions/${x.id}/context`,undefined],[`/sessions/${x.id}/changes`,content],['/layout-proposals',layout],['/admin/state',undefined],['/admin/source-policies',{sourceId:'now',policy:'apply_allowed',expectedControlRevision:x.engine.control().controlRevision}],['/control/scene',{requestId:randomUUID(),sceneId:'break',expectedConfigRevision:x.engine.overlayConfig().revision}],['/control/context',undefined]] as const)assert.equal((await call(path,body)).status,401,path);
    const foreign=await fetch(base+'/api/v1/public/proposals/context',{headers:{Origin:'https://untrusted.invalid'}});assert.equal(foreign.status,403);
    assert.ok(!JSON.stringify((await call('/public/proposals/context')).data).includes('Anonymous suggested activity'));
  }finally{await app.close();x.store.close();}
});
