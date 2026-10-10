import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup, apply, now } from './helpers.ts';
import { Engine, operator } from '../src/domain/engine.ts';
import type { LayoutChange } from '../src/contracts/layout-proposals.ts';

function fixture() {
  const x=setup();x.engine.setLayoutGrant(x.producer.id,{expectedControlRevision:x.engine.control().controlRevision,canProposeLayouts:true});
  const command=(sceneId='live'):LayoutChange=>{
    const layout=x.engine.overlayConfig().layouts.find(l=>l.overlayId==='overlay-1920x1080'&&l.sceneId===sceneId)!;
    const widgets=structuredClone(layout.widgets);widgets[0].x=120;widgets[0].settings.background='#8BF8';
    return {schemaVersion:'1.0',requestId:randomUUID(),intent:'propose',overlayId:layout.overlayId,sceneId,baseRevision:layout.revision,provenance:{disclosure:'public',observedAt:new Date().toISOString(),sourceRefs:['fixture:layout'],reason:'Improve broadcast geometry'},widgets};
  };
  const decision=(id:string)=>{const p=x.engine.layoutProposalPreview(id);return {decision:'approve',expectedProposalRevision:p.proposalRevision,expectedConfigRevision:p.configRevision,expectedLayoutRevision:p.layoutRevision,expectedControlRevision:p.controlRevision};};
  return {...x,command,decision};
}
const code=(expected:string)=>(error:any)=>error.code===expected;

test('agents can propose only a z-index change against legacy widgets and review reports that layer',()=>{
  const x=fixture();try{
    const legacy=x.engine.overlayConfig();legacy.layouts[0].widgets.forEach(w=>{delete w.zIndex;});x.store.put('overlays',legacy);
    const command=x.command();command.widgets=structuredClone(legacy.layouts[0].widgets);command.widgets[0].zIndex=8;
    const validation=x.engine.validateLayoutProposal(x.producer,command);assert.ok('changedPaths' in validation);
    assert.deepEqual(validation.changedPaths,[`/layouts/${command.overlayId}/live/widgets/${command.widgets[0].id}/zIndex`]);
    const receipt=x.engine.proposeLayout(x.producer,command),preview=x.engine.layoutProposalPreview(receipt.proposalId);
    assert.equal(preview.afterWidgets[0].zIndex,8);assert.equal(preview.after.overlay!.widgets[0].zIndex,8);
    x.engine.layoutDecision(receipt.proposalId,x.decision(receipt.proposalId));assert.equal(x.engine.output(command.overlayId).snapshot.overlay!.widgets[0].zIndex,8);
    const unchanged=x.command();unchanged.widgets=structuredClone(x.engine.overlayConfig().layouts[0].widgets);delete unchanged.widgets[1].zIndex;
    assert.throws(()=>x.engine.validateLayoutProposal(x.producer,unchanged),code('NO_LAYOUT_CHANGE'));
  }finally{x.store.close();}
});

test('layout proposals validate without writes, remain private, persist, replay receipts and expose only the author status',()=>{
  const x=fixture();try{
    const command=x.command(),before={config:x.engine.overlayConfig(),output:x.engine.output(command.overlayId),session:x.engine.session(x.session.id)};
    const audits=x.store.audits();const validation=x.engine.validateLayoutProposal(x.producer,command);assert.ok('change' in validation);assert.deepEqual(x.store.audits(),audits);assert.equal(x.store.list('layout-proposal:').length,0);
    const receipt=x.engine.proposeLayout(x.producer,command),p=x.engine.readLayoutProposal(x.producer,receipt.proposalId);assert.equal(p.change.widgets[0].settings.background,'#88bbff88');assert.deepEqual(p.baseWidgets,before.config.layouts[0].widgets);
    assert.equal(receipt.publication,'not_applicable');assert.deepEqual({config:x.engine.overlayConfig(),output:x.engine.output(command.overlayId),session:x.engine.session(x.session.id)},before);
    assert.deepEqual(new Engine(x.store).proposeLayout(x.producer,command),receipt);assert.deepEqual(x.engine.validateLayoutProposal(x.producer,command),{ok:true,receipt,replay:true});assert.equal(x.store.list('layout-proposal:').length,1);
    assert.throws(()=>x.engine.proposeLayout(x.producer,{...command,widgets:command.widgets.slice(1)}),code('IDEMPOTENCY_CONFLICT'));
    const other=x.engine.producer({name:'Other',expectedControlRevision:x.engine.control().controlRevision,canAutoPublish:false,canProposeLayouts:true,allowedSessions:['*'],allowedOperations:[],allowedPaths:[]});
    assert.throws(()=>x.engine.readLayoutProposal(other.producer,p.id),code('FORBIDDEN'));
    const preview=x.engine.layoutProposalPreview(p.id);assert.equal(preview.before.overlay!.widgets[0].x,before.config.layouts[0].widgets[0].x);assert.equal(preview.after.overlay!.widgets[0].x,120);assert.equal(preview.stale,false);
    x.engine.layoutDecision(p.id,x.decision(p.id));assert.equal(x.engine.readLayoutProposal(x.producer,p.id).status,'approved');assert.equal(x.engine.output(command.overlayId).snapshot.overlay!.widgets[0].x,120);assert.equal(x.engine.overlayConfig().layouts[0].revision,1);
    assert.deepEqual(x.engine.proposeLayout(x.producer,command),receipt);assert.throws(()=>x.engine.layoutDecision(p.id,x.decision(p.id)),code('PROPOSAL_CONFLICT'));
  }finally{x.store.close();}
});

test('layout approval guards reviewed revisions, stale replacements and restricted captions atomically',()=>{
  const x=fixture();try{
    const command=x.command();command.provenance.disclosure='restricted';command.widgets.at(-1)!.settings.message='PRIVATE_CAPTION';command.widgets.at(-1)!.visible=true;
    const {proposalId}=x.engine.proposeLayout(x.producer,command),review=x.decision(proposalId),config=x.engine.overlayConfig();
    assert.throws(()=>x.engine.layoutDecision(proposalId,review),code('DISCLOSURE_REVIEW_REQUIRED'));assert.deepEqual(x.engine.overlayConfig(),config);
    const widgets=structuredClone(config.layouts[0].widgets);widgets[0].y=42;x.engine.updateOverlays({action:'save_layout',expectedRevision:config.revision,overlayId:command.overlayId,sceneId:'live',widgets});
    assert.throws(()=>x.engine.layoutDecision(proposalId,{...review,allowDisclosure:true}),code('OVERLAY_REVISION_CONFLICT'));
    const fresh=x.decision(proposalId);assert.equal(x.engine.layoutProposalPreview(proposalId).stale,true);
    assert.throws(()=>x.engine.layoutDecision(proposalId,{...fresh,allowDisclosure:true}),code('STALE_PROPOSAL'));
    x.engine.setControl({mode:'hold',expectedControlRevision:x.engine.control().controlRevision});
    assert.throws(()=>x.engine.layoutDecision(proposalId,{...fresh,acknowledgeStale:true,allowDisclosure:true}),code('CONTROL_REVISION_CONFLICT'));
    const current=x.decision(proposalId);x.engine.layoutDecision(proposalId,{...current,acknowledgeStale:true,allowDisclosure:true});
    assert.equal(x.engine.overlayConfig().layouts[0].widgets[0].y,command.widgets[0].y);assert.ok(!JSON.stringify(x.engine.output(command.overlayId)).includes('PRIVATE_CAPTION'));
    assert.equal(x.engine.readLayoutProposal(operator,proposalId).change.baseRevision,command.baseRevision);
  }finally{x.store.close();}
});

test('layout grant, revocation, AI gate and widget validation never allow direct agent layout writes',()=>{
  const x=fixture();try{
    const command=x.command();x.engine.setLayoutGrant(x.producer.id,{expectedControlRevision:x.engine.control().controlRevision,canProposeLayouts:false});
    assert.throws(()=>x.engine.proposeLayout(x.producer,command),code('LAYOUT_FORBIDDEN'));assert.throws(()=>x.engine.renderPreview(x.producer,x.session.id,{overlayId:command.overlayId,widgets:command.widgets}),code('LAYOUT_FORBIDDEN'));
    x.engine.setLayoutGrant(x.producer.id,{expectedControlRevision:x.engine.control().controlRevision,canProposeLayouts:true});
    x.engine.setControl({expectedControlRevision:x.engine.control().controlRevision,aiWritesEnabled:false});assert.throws(()=>x.engine.proposeLayout(x.producer,command),code('AI_WRITES_DISABLED'));
    x.engine.setControl({expectedControlRevision:x.engine.control().controlRevision,aiWritesEnabled:true});
    assert.throws(()=>x.engine.proposeLayout(x.producer,{...command,intent:'apply'}),code('SCHEMA_VALIDATION'));
    assert.throws(()=>x.engine.proposeLayout(x.producer,{...command,baseRevision:9}),code('LAYOUT_REVISION_CONFLICT'));
    const invalid=structuredClone(command);invalid.widgets[0].x=1920;assert.throws(()=>x.engine.proposeLayout(x.producer,invalid),code('INVALID_LAYOUT'));
    invalid.widgets=command.widgets.slice();invalid.widgets[0]={...invalid.widgets[0],type:'unknown'};assert.throws(()=>x.engine.proposeLayout(x.producer,invalid),code('UNKNOWN_WIDGET'));
    assert.equal(x.store.list('layout-proposal:').length,0);const receipt=x.engine.proposeLayout(x.producer,command);
    x.engine.revoke(x.producer.id,x.engine.control().controlRevision);assert.throws(()=>x.engine.proposeLayout(x.producer,command),code('UNAUTHORIZED'));assert.throws(()=>x.engine.layoutDecision(receipt.proposalId,x.decision(receipt.proposalId)),code('UNAUTHORIZED'));
    x.engine.layoutDecision(receipt.proposalId,{decision:'reject',expectedProposalRevision:0});assert.equal(x.engine.readLayoutProposal(operator,receipt.proposalId).status,'rejected');
  }finally{x.store.close();}
});

test('approved layouts respect Auto, Hold, Hidden and inactive scenes without changing content or scene selection',()=>{
  for(const mode of ['auto','hold','hidden'] as const){const x=fixture();try{
    apply(x.engine,x.producer,x.session.id,[now()]);x.engine.setControl({expectedControlRevision:x.engine.control().controlRevision,mode});
    const command=x.command(),before=x.engine.output(command.overlayId).snapshot,session=x.engine.session(x.session.id),receipt=x.engine.proposeLayout(x.producer,command);x.engine.layoutDecision(receipt.proposalId,x.decision(receipt.proposalId));
    if(mode==='auto')assert.equal(x.engine.output(command.overlayId).snapshot.overlay!.widgets[0].x,120);else if(mode==='hidden')assert.ok(x.engine.output(command.overlayId).snapshot.overlay!.widgets.every(w=>!w.blocks.length));else assert.equal(x.engine.output(command.overlayId).snapshot.overlay!.widgets[0].x,before.overlay!.widgets[0].x);
    assert.deepEqual(x.engine.session(x.session.id),session);assert.equal(x.engine.overlayConfig().activeSceneId,'live');
    if(mode!=='auto'){x.engine.setControl({expectedControlRevision:x.engine.control().controlRevision,mode:'auto',confirmRestore:true});assert.equal(x.engine.output(command.overlayId).snapshot.overlay!.widgets[0].x,120);}
    const inactive=x.engine.proposeLayout(x.producer,x.command('break'));assert.equal(x.engine.layoutProposalPreview(inactive.proposalId).publication,'not_applicable');x.engine.layoutDecision(inactive.proposalId,x.decision(inactive.proposalId));assert.equal(x.engine.overlayConfig().activeSceneId,'live');
  }finally{x.store.close();}}
});

test('storage failure rolls back layout approval, proposal status, audit and publication together',()=>{
  const x=fixture();try{
    const receipt=x.engine.proposeLayout(x.producer,x.command()),input=x.decision(receipt.proposalId),before={config:x.engine.overlayConfig(),proposal:x.engine.readLayoutProposal(operator,receipt.proposalId),output:x.engine.output('overlay-1920x1080'),audit:x.store.audits()};
    const original=x.store.put.bind(x.store);let published=false;x.engine.onPublish=()=>{published=true;};
    x.store.put=(key,value)=>{if(key===`layout-proposal:${receipt.proposalId}`)throw new Error('Injected storage failure');original(key,value);};
    assert.throws(()=>x.engine.layoutDecision(receipt.proposalId,input),/Injected storage failure/);x.store.put=original;
    assert.deepEqual({config:x.engine.overlayConfig(),proposal:x.engine.readLayoutProposal(operator,receipt.proposalId),output:x.engine.output('overlay-1920x1080'),audit:x.store.audits()},before);assert.equal(published,false);
  }finally{x.store.close();}
});
