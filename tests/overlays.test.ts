import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, apply, now, event, change } from './helpers.ts';
import { operator, Engine } from '../src/domain/engine.ts';

test('new overlay outputs initialize current auto content but never introduce unpublished content during hold or hidden migration',()=>{
  for(const mode of ['auto','hold','hidden'] as const){const x=setup();try{apply(x.engine,x.producer,x.session.id,[now('Existing activity')]);if(mode!=='auto')x.engine.setControl({expectedControlRevision:x.engine.control().controlRevision,mode});for(const o of x.engine.overlayConfig().overlays)x.store.delete(`output:${o.id}`);const restarted=new Engine(x.store);const widgets=restarted.output('overlay-1920x1080').snapshot.overlay!.widgets;if(mode==='auto')assert.ok(widgets.flatMap(w=>w.blocks).some(b=>b.text==='Existing activity'));else assert.ok(widgets.every(w=>w.blocks.length===0));}finally{x.store.close();}}
});

test('overlay/scene matrix is complete, resolution unique, and geometry/settings edits are transactional and versioned',()=>{
  const x=setup(),e=x.engine;
  try{
    let config=e.overlayConfig();assert.equal(config.layouts.length,config.overlays.length*config.scenes.length);
    config=e.updateOverlays({expectedRevision:config.revision,action:'create_scene',name:'방송 시작 전'});
    config=e.updateOverlays({expectedRevision:config.revision,action:'create_overlay',name:'1440p',width:2560,height:1440});
    assert.equal(config.layouts.length,config.overlays.length*config.scenes.length);
    assert.throws(()=>e.updateOverlays({expectedRevision:config.revision,action:'create_overlay',name:'duplicate',width:1920,height:1080}));
    const layout=config.layouts[0],widgets=structuredClone(layout.widgets);widgets[0].x=50;
    const updated=e.updateOverlays({expectedRevision:config.revision,action:'save_layout',overlayId:layout.overlayId,sceneId:layout.sceneId,widgets});
    assert.equal(updated.layouts[0].widgets[0].x,50);assert.equal(updated.layouts[0].revision,1);
    assert.throws(()=>e.updateOverlays({expectedRevision:config.revision,action:'activate_scene',sceneId:'break'}));
    const bad=structuredClone(widgets);bad[0].width=3840;
    assert.throws(()=>e.updateOverlays({expectedRevision:updated.revision,action:'save_layout',overlayId:layout.overlayId,sceneId:layout.sceneId,widgets:bad}));
    assert.deepEqual(e.overlayConfig(),updated);
    const restored=new Engine(x.store);assert.deepEqual(restored.overlayConfig(),updated);
  }finally{x.store.close();}
});

test('overlay publication preserves hold, urgent removals, scene activation, hide and restore across all sizes',()=>{
  const x=setup(),e=x.engine;
  try{
    apply(e,x.producer,x.session.id,[now(),event(),{op:'set_pin',value:{text:'REMOVE_PIN',expiresAt:null}}]);
    const id=e.overlayConfig().overlays[0].id, before=e.output(id).snapshot;
    assert.ok(before.overlay?.widgets.some(w=>w.blocks.some(b=>b.text==='REMOVE_PIN')));
    e.setControl({mode:'hold',expectedControlRevision:e.control().controlRevision});
    e.updateOverlays({action:'activate_scene',expectedRevision:e.overlayConfig().revision,sceneId:'break'});
    apply(e,x.producer,x.session.id,[now('HELD_TEXT')]);
    assert.equal(e.output(id).snapshot.overlay?.sceneId,'live');assert.ok(!JSON.stringify(e.output(id)).includes('HELD_TEXT'));
    apply(e,x.producer,x.session.id,[{op:'set_pin',value:null},{op:'retract_event',id:'comparison'}]);
    assert.ok(!JSON.stringify(e.output(id).snapshot.overlay?.widgets.map(w=>w.blocks)).includes('REMOVE_PIN'));
    assert.ok(!e.output(id).snapshot.overlay?.widgets.some(w=>w.blocks.some(b=>b.path.startsWith('/events/comparison/'))));
    e.setControl({mode:'auto',confirmRestore:true,expectedControlRevision:e.control().controlRevision});
    assert.equal(e.output(id).snapshot.overlay?.sceneId,'break');assert.ok(e.output(id).snapshot.overlay?.widgets.find(w=>w.type==='away')?.blocks.length);
    e.setControl({mode:'hidden',expectedControlRevision:e.control().controlRevision});
    for(const overlay of e.overlayConfig().overlays){const snapshot=e.output(overlay.id).snapshot;assert.equal(snapshot.sessionId,null);assert.ok(snapshot.overlay?.widgets.every(w=>w.blocks.length===0&&w.settings.message===''));}
  }finally{x.store.close();}
});

test('candidate overlay inspection is scoped and read-only; hidden and omitted widget text stays out of the DTO',()=>{
  const x=setup(),e=x.engine;
  try{
    const issued=e.producer({name:'Now-only',canAutoPublish:false,allowedSessions:[x.session.id],allowedOperations:['set_now'],allowedPaths:['/now'],expectedControlRevision:e.control().controlRevision});
    const id=e.overlayConfig().overlays[0].id,config=e.overlayConfig(),widgets=structuredClone(config.layouts[0].widgets);
    widgets.find(w=>w.type==='events')!.visible=false;
    e.updateOverlays({action:'save_layout',expectedRevision:config.revision,overlayId:id,sceneId:'live',widgets});
    apply(e,x.producer,x.session.id,[event(),{op:'update_session',fields:{goal:'UNGRANTED_GOAL'}}]);
    const session=e.session(x.session.id),outputs=x.store.list('output:'),audits=x.store.audits(),inspection=e.renderPreview(issued.producer,session.id,{overlayId:id,change:change(session,[now('PRIVATE_CANDIDATE')],{intent:'propose'})});
    assert.ok(JSON.stringify(inspection).includes('PRIVATE_CANDIDATE'));assert.ok(!JSON.stringify(inspection).includes('UNGRANTED_GOAL'));
    assert.ok(!JSON.stringify(inspection).includes('비교를 시작함'));assert.deepEqual(e.session(session.id),session);assert.deepEqual(x.store.list('output:'),outputs);assert.deepEqual(x.store.audits(),audits);assert.equal(x.store.list('proposal:').length,0);
    const saved=e.changes(issued.producer,session.id,change(session,[now('PRIVATE_CANDIDATE')],{intent:'propose'}));
    assert.equal(e.proposalPreview(saved.proposalId!,id).after.overlay?.widgets.find(w=>w.type==='now')?.blocks[0].text,'PRIVATE_CANDIDATE');
    assert.ok(!JSON.stringify(e.output(id)).includes('PRIVATE_CANDIDATE'));
    assert.throws(()=>e.renderPreview(issued.producer,'ungranted',{overlayId:id}));
  }finally{x.store.close();}
});
