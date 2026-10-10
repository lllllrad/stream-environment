import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

test('Swagger submits content and layout suggestions with no token, and operator review alone changes anonymous output',async({page,request,context})=>{
  const token='e2e-operator-credential-long-enough';
  const api=async(path:string,body?:object)=>{const response=await request.fetch('/api/v1'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`},data:body});const data=await response.json();expect(response.ok(),JSON.stringify(data)).toBeTruthy();return data;};
  let control=await api('/admin/control');
  if(control.activeSessionId){const active=await api(`/sessions/${control.activeSessionId}/context`);if(active.status!=='ended')await api(`/admin/sessions/${active.id}/lifecycle`,{action:'end',expectedRevision:active.revision,expectedControlRevision:control.controlRevision});}
  control=await api('/admin/control');await api('/admin/control',{expectedControlRevision:control.controlRevision,mode:'auto',aiWritesEnabled:true,confirmRestore:true});control=await api('/admin/control');
  const session=await api('/admin/sessions',{title:'Anonymous Swagger review',goal:'Verify token-free suggestions',expectedControlRevision:control.controlRevision});await api(`/admin/sessions/${session.id}/lifecycle`,{action:'start',expectedRevision:session.revision,expectedControlRevision:control.controlRevision});
  const current=await api(`/sessions/${session.id}/context`),provenance={disclosure:'public',observedAt:new Date().toISOString(),sourceRefs:[],reason:'Synthetic operator baseline'};
  await api(`/sessions/${session.id}/changes`,{schemaVersion:'1.0',requestId:randomUUID(),sessionId:session.id,baseRevision:current.revision,intent:'apply',provenance,operations:[{op:'set_now',value:{title:'Original public activity',detail:'Before review',status:'preparing',next:null}}]});
  const config=(await api('/admin/overlays')).config,original=config.layouts.find((l:any)=>l.overlayId==='overlay-1920x1080'&&l.sceneId==='live');original.widgets.find((w:any)=>w.id==='now').settings.message='PRIVATE_UNUSED_WIDGET_CAPTION';
  await api('/admin/layouts',{overlayId:original.overlayId,sceneId:original.sceneId,widgets:original.widgets,expectedRevision:config.revision});
  const display=await context.newPage(),admin=await context.newPage();
  const sentHeaders:Record<string,string>[]=[];page.on('request',r=>{if(r.url().includes('/api/v1/public/proposals/')||r.url().endsWith('/api/v1/sources'))sentHeaders.push(r.headers());});
  try{
    await display.goto('/display/overlay-1920x1080');await expect(display.locator('[data-widget="now"]')).toContainText('Original public activity');
    await page.goto('/swagger');const sourceDiscovery=page.locator('#operations-Discovery-getSources');await sourceDiscovery.locator('.opblock-summary').click();await sourceDiscovery.getByRole('button',{name:'Try it out',exact:true}).click();
    const sourceResponse=page.waitForResponse(r=>r.url().endsWith('/api/v1/sources'));await sourceDiscovery.getByRole('button',{name:'Execute',exact:true}).click();const receivedSources=await sourceResponse;expect(receivedSources.status()).toBe(200);expect((await receivedSources.json()).sources.length).toBeGreaterThan(0);
    const discovery=page.locator('[id$="-getPublicProposalContext"]');await discovery.locator('.opblock-summary').click();await discovery.getByRole('button',{name:'Try it out',exact:true}).click();
    let response=page.waitForResponse(r=>r.url().endsWith('/public/proposals/context'));await discovery.getByRole('button',{name:'Execute',exact:true}).click();const contextResponse=await response;expect(contextResponse.status()).toBe(200);const publicContext=await contextResponse.json();expect(JSON.stringify(publicContext)).not.toContain('PRIVATE_UNUSED_WIDGET_CAPTION');
    const submit=async(id:string,path:string,command:object)=>{const block=page.locator(`[id$="-${id}"]`);await block.locator('.opblock-summary').click();await block.getByRole('button',{name:'Try it out',exact:true}).click();await block.locator('textarea.body-param__text').fill(JSON.stringify(command));const received=page.waitForResponse(r=>r.url().endsWith(path));await block.getByRole('button',{name:'Execute',exact:true}).click();const result=await received;expect(result.status()).toBe(200);return await result.json();};
    const content={schemaVersion:'1.0',requestId:randomUUID(),sessionId:publicContext.session.id,baseRevision:publicContext.session.revision,intent:'propose',provenance:{...provenance,reason:'Anonymous Swagger content'},operations:[{op:'set_now',value:{title:'Approved anonymous suggestion',detail:'Visible only after review',status:'in_progress',next:null}}]};
    const receipt=await submit('proposePublicContent','/public/proposals/content',content);expect(receipt.outcome).toBe('proposed');
    const layout=publicContext.config.layouts.find((l:any)=>l.overlayId==='overlay-1920x1080'&&l.sceneId==='live'),widget=layout.widgets.find((w:any)=>w.id==='now');widget.x-=12;
    const geometry={schemaVersion:'1.0',requestId:randomUUID(),intent:'propose',overlayId:layout.overlayId,sceneId:layout.sceneId,baseRevision:layout.revision,provenance:{...provenance,reason:'Anonymous Swagger layout'},widgets:layout.widgets};
    expect((await submit('proposePublicLayout','/public/proposals/layouts',geometry)).outcome).toBe('proposed');
    await expect(display.locator('[data-widget="now"]')).toContainText('Original public activity');await expect(display.locator('[data-widget="now"]')).not.toHaveCSS('left',`${widget.x}px`);
    await admin.goto('/admin');await admin.getByLabel('운영자 키').fill(token);await admin.getByRole('button',{name:'운영 화면 열기',exact:true}).click();await admin.getByRole('button',{name:'변경 제안',exact:true}).click();
    const contentCard=admin.getByRole('article').filter({has:admin.getByRole('heading',{name:'Anonymous Swagger content',exact:true})});await contentCard.getByRole('button',{name:'승인하고 잠금',exact:true}).click();await expect(display.locator('[data-widget="now"]')).toContainText('Approved anonymous suggestion');
    const layoutCard=admin.getByRole('article',{name:'레이아웃 제안 Anonymous Swagger layout',exact:true});await layoutCard.getByRole('button',{name:'레이아웃 비교 열기',exact:true}).click();await layoutCard.getByLabel('배치·크기·표시 내용과 잘림·겹침을 검토했습니다.').check();await admin.screenshot({path:'artifacts/anonymous-proposal-review.png'});await layoutCard.getByRole('button',{name:'레이아웃 승인',exact:true}).click();await expect(display.locator('[data-widget="now"]')).toHaveCSS('left',`${widget.x}px`);
    const saved=(await api('/admin/overlays')).config.layouts.find((l:any)=>l.overlayId===layout.overlayId&&l.sceneId===layout.sceneId).widgets.find((w:any)=>w.id==='now');expect(saved.settings.message).toBe('PRIVATE_UNUSED_WIDGET_CAPTION');
    expect(sentHeaders).toHaveLength(4);for(const headers of sentHeaders){expect(headers.authorization).toBeUndefined();expect(headers.cookie).toBeUndefined();}
  }finally{
    await display.close();await admin.close();const latest=(await api('/admin/overlays')).config;
    original.widgets.find((w:any)=>w.id==='now').settings.message='잠시 자리 비움';await api('/admin/layouts',{expectedRevision:latest.revision,overlayId:original.overlayId,sceneId:original.sceneId,widgets:original.widgets});
  }
});
