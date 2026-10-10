import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

test('review renders real overlay geometry at fit and native scale, compares held/hidden broadcast and expands without publishing',async({page,request,context})=>{
  const token='e2e-operator-credential-long-enough';
  const api=async(path:string,body?:object)=>{const response=await request.fetch('/api/v1'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`},data:body});const data=await response.json();expect(response.ok(),JSON.stringify(data)).toBeTruthy();return data;};
  let control=await api('/admin/control');
  if(control.activeSessionId){const active=await api(`/sessions/${control.activeSessionId}/context`);if(active.status!=='ended')await api(`/admin/sessions/${active.id}/lifecycle`,{action:'end',expectedRevision:active.revision,expectedControlRevision:control.controlRevision});}
  control=await api('/admin/control');await api('/admin/control',{expectedControlRevision:control.controlRevision,mode:'auto',aiWritesEnabled:true,confirmRestore:true});control=await api('/admin/control');
  const session=await api('/admin/sessions',{title:'Rendered proposal review',goal:'Inspect actual overlay geometry',expectedControlRevision:control.controlRevision});await api(`/admin/sessions/${session.id}/lifecycle`,{action:'start',expectedRevision:session.revision,expectedControlRevision:control.controlRevision});
  const provenance={disclosure:'public',observedAt:new Date().toISOString(),sourceRefs:[],reason:'Synthetic screen review'};
  const change=async(title:string,intent='apply')=>{const current=await api(`/sessions/${session.id}/context`);return api(`/sessions/${session.id}/changes`,{schemaVersion:'1.0',requestId:randomUUID(),sessionId:session.id,baseRevision:current.revision,intent,provenance,operations:[{op:'set_now',value:{title,detail:'Inspect wrapping and clipping in the actual widget.',status:'in_progress',next:null}}]});};
  let config=(await api('/admin/overlays')).config;
  if(config.activeSceneId!=='live'){await api('/admin/scene',{sceneId:'live',expectedRevision:config.revision});config=(await api('/admin/overlays')).config;}
  const original=structuredClone(config.layouts.find((l:any)=>l.overlayId==='overlay-1920x1080'&&l.sceneId==='live').widgets),widgets=structuredClone(original),now=widgets.find((w:any)=>w.id==='now');
  Object.assign(now,{x:48,y:200,width:220,height:140});Object.assign(now.settings,{fontSize:28,maxLines:1,overflow:'ellipsis',background:'#8bf8'});
  await api('/admin/layouts',{overlayId:'overlay-1920x1080',sceneId:'live',widgets,expectedRevision:config.revision});await change('Already on air');
  const display=await context.newPage();
  try{
    await display.goto('/display/overlay-1920x1080');
    control=await api('/admin/control');await api('/admin/control',{expectedControlRevision:control.controlRevision,mode:'hold'});
    await change('Saved while output is held');await change('A proposed activity with a longer visible title','propose');
    await page.goto('/admin');await page.getByLabel('운영자 키').fill(token);await page.getByRole('button',{name:'운영 화면 열기',exact:true}).click();await page.getByRole('button',{name:'변경 제안',exact:true}).click();
    const card=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Synthetic screen review',exact:true})}),screen=card.getByRole('region',{name:'검토 화면 캔버스',exact:true});
    await expect(screen).toBeVisible();await expect(screen).toHaveAttribute('data-review-view','after');
    const field=screen.locator('[data-field="/now/title"]');await expect(field).toHaveAttribute('data-text','A proposed activity with a longer visible title');await expect(field).not.toHaveText('A proposed activity with a longer visible title');
    await expect(screen.locator('[data-widget="now"]')).toHaveCSS('left','48px');await expect(screen.locator('[data-widget="now"]')).toHaveCSS('background-color','rgba(136, 187, 255, 0.533)');
    await expect(card.locator('.visibility-details')).toContainText('잘린 필드');
    await card.getByRole('button',{name:'현재 저장된 화면',exact:true}).click();await expect(field).toHaveAttribute('data-text','Saved while output is held');
    await card.getByRole('button',{name:'현재 송출 화면',exact:true}).click();await expect(field).toHaveAttribute('data-text','Already on air');
    await card.getByRole('button',{name:'제안 적용 후',exact:true}).click();await card.getByLabel('검토 화면 배율').selectOption('0.5');expect(await screen.locator('.overlay-canvas').evaluate(el=>el.getBoundingClientRect().width)).toBe(960);await card.getByLabel('검토 화면 배율').selectOption('1');
    expect(await screen.locator('.overlay-canvas').evaluate(el=>el.getBoundingClientRect().width)).toBe(1920);expect(await screen.evaluate(el=>el.scrollWidth>el.clientWidth)).toBeTruthy();
    await card.getByRole('button',{name:'크게 보기',exact:true}).click();const dialog=page.getByRole('dialog',{name:'제안 화면 확대 검토',exact:true});await expect(dialog).toBeVisible();await dialog.getByLabel('검토 화면 배율').selectOption('fit');
    await expect.poll(()=>dialog.locator('.overlay-canvas').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(900);await expect.poll(()=>dialog.locator('.proposal-screen-viewport').evaluate(el=>el.scrollHeight<=el.clientHeight+1&&el.scrollWidth<=el.clientWidth+1)).toBeTruthy();await dialog.screenshot({path:'artifacts/proposal-screen-expanded.png'});
    await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(screen).toBeVisible();await expect(card.getByRole('button',{name:'크게 보기',exact:true})).toBeFocused();
    await page.setViewportSize({width:850,height:1000});await card.getByLabel('검토 화면 배율').selectOption('fit');await expect.poll(()=>screen.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
    expect(JSON.stringify(await (await request.get('/api/v1/display/overlay-1920x1080/snapshot')).json())).not.toContain('A proposed activity');
    control=await api('/admin/control');await api('/admin/control',{expectedControlRevision:control.controlRevision,mode:'hidden'});await card.getByRole('button',{name:'현재 송출 화면',exact:true}).click();await expect(screen.getByText('현재 출력이 숨겨져 있습니다.',{exact:true})).toBeVisible();await expect(screen.locator('[data-field]')).toHaveCount(0);
    await card.getByRole('button',{name:'제안 적용 후',exact:true}).click();await expect(field).toHaveAttribute('data-text','A proposed activity with a longer visible title');await expect(display.locator('[data-field]')).toHaveCount(0);
  }finally{await display.close();config=(await api('/admin/overlays')).config;await api('/admin/layouts',{expectedRevision:config.revision,overlayId:'overlay-1920x1080',sceneId:'live',widgets:original});}
});
