import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { setup, change } from './helpers.ts';
import { createHttp } from '../src/server/http.ts';
import { RenderService } from '../src/server/render.ts';
import type { RenderPreview, VisibilityReport } from '../src/contracts/overlay.ts';

test('browser inspection measures Unicode, clipping, shrink, scroll, occlusion and transparent PNG without writes',async()=>{
  const x=setup(),dir=mkdtempSync(resolve(tmpdir(),'frame-render-'));
  await build({entryPoints:['src/web/render-preview.tsx'],outfile:resolve(dir,'render-preview.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic'});
  const token='operator-render-test-token-long-enough',app=createHttp(x.engine,{adminToken:token,webDir:dir,producerBurst:100});
  await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
  const producer=x.engine.producer({name:'Scoped inspector',expectedControlRevision:x.engine.control().controlRevision,canAutoPublish:false,allowedSessions:[x.session.id],allowedOperations:['set_now'],allowedPaths:['/now']});
  const command=change(x.engine.session(x.session.id),[{op:'set_now',value:{title:'😀 한글 표시 범위 확인 '.repeat(3),detail:'아주 긴 설명을 실제 브라우저의 픽셀 좌표로 검사합니다. '.repeat(3),status:'in_progress',next:null}}],{intent:'propose'});
  const inspect=async(includeImage=false)=>{const res=await fetch(`${base}/api/v1/sessions/${x.session.id}/render-preview`,{method:'POST',headers:{Authorization:`Bearer ${producer.token}`,'Content-Type':'application/json'},body:JSON.stringify({overlayId:'overlay-1920x1080',change:command,includeImage})});const value=await res.json();assert.equal(res.status,200,JSON.stringify(value));return value as RenderPreview&{report:VisibilityReport};};
  try{
    assert.equal((await fetch(`${base}/api/v1/overlays`)).status,401);
    assert.equal((await fetch(`${base}/api/v1/admin/overlays`,{headers:{Authorization:`Bearer ${producer.token}`}})).status,403);
    const config=x.engine.overlayConfig(),widgets=structuredClone(config.layouts[0].widgets);widgets.forEach(w=>{w.visible=w.type==='now';});const w=widgets.find(w=>w.type==='now')!;
    Object.assign(w,{x:10,y:10,width:240,height:105});Object.assign(w.settings,{fontSize:42,minFontSize:12,padding:4,maxLines:1,overflow:'ellipsis'});
    const save=()=>x.engine.updateOverlays({action:'save_layout',expectedRevision:x.engine.overlayConfig().revision,overlayId:config.overlays[0].id,sceneId:'live',widgets});save();
    assert.equal(command.operations[0].op,'set_now'); const title=command.operations[0].op==='set_now'?command.operations[0].value!.title:'';
    const before=x.engine.output(config.overlays[0].id),audit=x.store.audits(),session=x.engine.session(x.session.id),render=await inspect(true),field=render.report.widgets.find(w=>w.id==='now')!.fields[0];
    assert.equal(field.totalCodePoints,[...title].length);assert.equal(field.truncated,true);assert.ok(field.visibleCodePoints>0);assert.ok(field.visibleCodePoints<field.totalCodePoints);assert.equal([...field.visibleText].length,field.visibleCodePoints);assert.equal(field.visibleText,[...field.text].slice(0,field.visibleCodePoints).join(''));
    assert.equal(render.report.width,1920);assert.equal(render.report.height,1080);assert.ok(render.report.widgets.flatMap(w=>w.fields).every(f=>f.path.startsWith('/now/')));
    assert.equal(Buffer.from(render.image!.base64,'base64').subarray(1,4).toString(),'PNG');assert.deepEqual(x.engine.output(config.overlays[0].id),before);assert.deepEqual(x.store.audits(),audit);assert.deepEqual(x.engine.session(x.session.id),session);assert.equal(x.store.list('proposal:').length,0);
    w.settings.overflow='clip';save();const clip=(await inspect()).report.widgets.find(w=>w.id==='now')!.fields[0];assert.ok(clip.truncated);
    w.settings.overflow='shrink';save();const shrink=(await inspect()).report.widgets.find(w=>w.id==='now')!.fields[0];assert.ok(shrink.fontSize<clip.fontSize);assert.ok(shrink.visibleCodePoints>clip.visibleCodePoints);
    w.settings.overflow='scroll';save();assert.equal((await inspect()).report.widgets.find(w=>w.id==='now')!.scrolling,true);
    const cover=widgets.find(w=>w.type==='away')!;Object.assign(cover,{visible:true,x:10,y:10,width:240,height:105});save();const occluded=(await inspect()).report.widgets.find(w=>w.id==='now')!;assert.ok(occluded.overlaps.includes('away'));assert.equal(occluded.fields[0].visibleCodePoints,0);
    cover.visible=false;const secret=widgets.find(w=>w.type==='session')!;Object.assign(secret,{visible:true,x:10,y:10,width:240,height:105});widgets.splice(widgets.indexOf(secret),1);widgets.push(secret);save();const privateCover=await inspect(true);assert.equal(privateCover.report.widgets.find(w=>w.id==='now')!.fields[0].visibleCodePoints,0);assert.equal(privateCover.report.widgets.find(w=>w.id==='session')!.fields.length,0);assert.ok(!JSON.stringify(privateCover).includes(session.goal));
    const login=await fetch(`${base}/api/v1/admin/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}),cookie=login.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await fetch(`${base}/api/v1/admin/layouts`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:0})})).status,403);
  }finally{await app.close();x.store.close();rmSync(dir,{recursive:true,force:true});}
});

test('missing browser returns a structured render failure and leaves the server usable',async()=>{
  const x=setup(),renderer=new RenderService('directory-that-does-not-exist');
  try{await assert.rejects(renderer.render(x.engine.renderPreview(x.producer,x.session.id,{overlayId:'overlay-1280x720'})),(e:any)=>e.code==='RENDER_UNAVAILABLE');assert.equal(x.engine.session(x.session.id).revision,x.session.revision);}finally{await renderer.close();x.store.close();}
});
